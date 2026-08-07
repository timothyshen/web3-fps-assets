import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAddress, recoverMessageAddress } from "viem";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { errors } from "../errors.js";
import type { AppContext } from "../context.js";
import type { BindSessionRow } from "../db.js";

/**
 * Wallet binding (docs/integration.md 钱包绑定 + web/README.md).
 *
 * Unity-facing (api/openapi.yaml, gameSession JWT):
 *   POST /v1/wallet/bind                  → { sessionId, bindUrl, expiresAt }
 *   GET  /v1/wallet/bind/{sessionId}      → WalletBindStatus (pending→bound)
 *
 * Web-facing (web/README.md "Assumed backend contract", no game JWT — the
 * browser page only has the sessionId from the URL):
 *   GET  /v1/wallet/bind/{sessionId}/challenge
 *   POST /v1/wallet/bind/{sessionId}/complete { message, signature }
 *
 * SIWE verification: parse EIP-4361 → domain whitelist, chainId, nonce
 * (single-use), Request ID = sessionId, expiry → recover signer == message
 * address. The backend never holds player keys; it records an address.
 */
export function registerBindRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  // ---- Unity: begin bind ----------------------------------------------
  app.post("/v1/wallet/bind", async (request) => {
    const playerId = await ctx.auth.requirePlayer(request);

    const existing = db.getBindingByPlayer(playerId);
    if (existing) {
      // openapi: 409 该账号已绑定钱包，换绑需重新认证 (re-bind flow not in demo scope)
      throw errors.conflict("already_bound", `Player is already bound to ${existing.wallet}.`);
    }

    const sessionId = randomUUID();
    const now = Date.now();
    const expiresAtMs = now + config.bindSessionTtlSeconds * 1000;
    db.createBindSession({
      session_id: sessionId,
      player_id: playerId,
      nonce: generateSiweNonce(), // EIP-4361: >= 8 alphanumeric chars
      created_at: now,
      expires_at: expiresAtMs,
    });

    return {
      sessionId,
      bindUrl: `${config.webOrigin}/bind/${sessionId}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  });

  // ---- Unity: poll bind status ----------------------------------------
  app.get<{ Params: { sessionId: string } }>("/v1/wallet/bind/:sessionId", async (request) => {
    const playerId = await ctx.auth.requirePlayer(request);
    const session = db.freshBindSession(request.params.sessionId);
    if (!session || session.player_id !== playerId) {
      throw errors.notFound("session_not_found", "Unknown bind session.");
    }
    return {
      state: session.state,
      wallet: session.wallet ?? "",
      error: session.error ?? "",
    };
  });

  // ---- Web: fetch challenge (no game JWT — browser context) ------------
  app.get<{ Params: { sessionId: string } }>(
    "/v1/wallet/bind/:sessionId/challenge",
    async (request) => {
      const session = db.freshBindSession(request.params.sessionId);
      if (!session) throw errors.notFound("session_not_found", "Unknown bind session.");
      return {
        sessionId: session.session_id,
        nonce: session.nonce,
        expiresAt: new Date(session.expires_at).toISOString(),
        state: session.state,
        ...(session.wallet ? { wallet: session.wallet } : {}),
      };
    },
  );

  // ---- Web: complete bind with SIWE message + signature ----------------
  const completeSchema = z.object({
    message: z.string().min(1).max(10_000),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "hex signature expected"),
  });

  app.post<{ Params: { sessionId: string } }>(
    "/v1/wallet/bind/:sessionId/complete",
    async (request) => {
      const sessionId = request.params.sessionId;
      const session = db.freshBindSession(sessionId);
      if (!session) throw errors.notFound("session_not_found", "Unknown bind session.");
      if (session.state === "bound") {
        throw errors.conflict("already_bound", "This bind session already completed.");
      }
      if (session.state === "expired") {
        throw errors.gone("session_expired", "Bind session expired; start again from the game.");
      }
      if (session.state === "failed") {
        throw errors.conflict("already_bound", "This bind session is no longer usable.");
      }

      const parsedBody = completeSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        throw errors.badRequest(
          "invalid_message",
          parsedBody.error.issues[0]?.message ?? "message and signature are required",
        );
      }
      const { message, signature } = parsedBody.data;

      const wallet = await verifySiweBind(ctx, session, message, signature as `0x${string}`);

      // One playerId ↔ one wallet, both directions.
      const walletOwner = db.getBindingByWallet(wallet);
      if (walletOwner && walletOwner.player_id !== session.player_id) {
        throw errors.conflict(
          "wallet_already_bound",
          "This wallet is already linked to another player account.",
        );
      }
      const playerBinding = db.getBindingByPlayer(session.player_id);
      if (playerBinding) {
        throw errors.conflict(
          "already_bound",
          `Player is already bound to ${playerBinding.wallet}.`,
        );
      }

      try {
        db.bindWallet(session.player_id, wallet, sessionId);
      } catch {
        // UNIQUE-constraint race (two tabs completing simultaneously).
        throw errors.conflict("wallet_already_bound", "Binding raced with another completion.");
      }

      return { state: "bound", wallet };
    },
  );
}

/** Full EIP-4361 verification; returns the checksummed wallet address. */
async function verifySiweBind(
  ctx: AppContext,
  session: BindSessionRow,
  message: string,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  const { config } = ctx;

  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    throw errors.badRequest("invalid_message", "Message is not a valid EIP-4361 string.");
  }

  const fail = (reason: string): never => {
    throw errors.badRequest("invalid_message", reason);
  };

  if (!parsed.address || !parsed.domain || !parsed.nonce) {
    fail("Message is missing address, domain or nonce.");
  }
  if (!config.allowedSiweDomains.has(parsed.domain!)) {
    fail(`Domain "${parsed.domain}" is not an allowed bind origin.`);
  }
  if (parsed.chainId !== undefined && parsed.chainId !== config.chainId) {
    fail(`Wrong chainId ${parsed.chainId}; expected ${config.chainId}.`);
  }
  // Nonce is per-session and single-use: it matches exactly one pending
  // session, and completing that session retires it (replays hit the
  // state !== 'pending' guards above).
  if (parsed.nonce !== session.nonce) {
    fail("Nonce does not match this bind session.");
  }
  if (parsed.requestId !== session.session_id) {
    fail("Request ID does not carry this bind session id.");
  }
  const now = Date.now();
  if (parsed.expirationTime && parsed.expirationTime.getTime() < now) {
    fail("Message expiration time has passed.");
  }
  if (parsed.notBefore && parsed.notBefore.getTime() > now) {
    fail("Message is not valid yet (Not Before).");
  }

  const address = getAddress(parsed.address!);

  // EOA path first (works offline, keeps binding alive through RPC
  // outages); fall back to an on-chain ERC-1271/6492 check for smart
  // wallets when the RPC is reachable.
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (getAddress(recovered) === address) return address;
  } catch {
    // not a plain EOA signature — try the contract path below
  }
  try {
    const valid = await ctx.chain.publicClient.verifyMessage({ address, message, signature });
    if (valid) return address;
  } catch {
    // RPC unreachable or verification failed — fall through
  }
  throw errors.badRequest(
    "invalid_signature",
    "Signature does not recover to the message address.",
  );
}
