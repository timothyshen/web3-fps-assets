import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inject } from "vitest";
import type { PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

declare module "vitest" {
  interface ProvidedContext {
    baseUrl: string;
    rpcUrl: string;
    webOrigin: string;
    internalToken: string;
    contracts: {
      gameAssetRegistry: string;
      weaponSkin: string;
      rewardDistributor: string;
      skinMarket: string;
      matchAttestation: string;
      tournamentEscrow: string;
    };
  }
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export function testEnv() {
  return {
    baseUrl: inject("baseUrl"),
    rpcUrl: inject("rpcUrl"),
    webOrigin: inject("webOrigin"),
    internalToken: inject("internalToken"),
    contracts: inject("contracts"),
  };
}

export async function api<T = any>(
  baseUrl: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let bodyInit: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    bodyInit = JSON.stringify(options.body);
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: bodyInit });
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T };
}

export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 20_000, intervalMs = 250 } = {},
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fetcher();
    if (predicate(value)) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pollUntil timed out; last value: ${JSON.stringify(value)}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Mirrors web/src/lib/siwe.ts buildBindMessage exactly. */
export function siweMessageFor(
  webOrigin: string,
  input: {
    address: `0x${string}`;
    nonce: string;
    sessionId: string;
    expiresAt: string;
    chainId?: number;
  },
): string {
  return createSiweMessage({
    domain: new URL(webOrigin).host,
    uri: webOrigin,
    address: input.address,
    chainId: input.chainId ?? 31337,
    version: "1",
    nonce: input.nonce,
    statement:
      `Link this wallet to your game account (bind session ${input.sessionId}). ` +
      "Signing is free and authorizes no transaction or spending.",
    issuedAt: new Date(),
    expirationTime: new Date(input.expiresAt),
    requestId: input.sessionId,
  });
}

/** Full happy-path bind: begin → challenge → sign → complete. */
export async function bindWalletFlow(
  baseUrl: string,
  webOrigin: string,
  playerToken: string,
  account: PrivateKeyAccount,
): Promise<void> {
  const begin = await api(baseUrl, "POST", "/v1/wallet/bind", { token: playerToken });
  if (begin.status !== 200) throw new Error(`bind begin failed: ${JSON.stringify(begin)}`);
  const sessionId = begin.body.sessionId as string;
  const challenge = await api(baseUrl, "GET", `/v1/wallet/bind/${sessionId}/challenge`);
  const message = siweMessageFor(webOrigin, {
    address: account.address,
    nonce: challenge.body.nonce,
    sessionId,
    expiresAt: challenge.body.expiresAt,
  });
  const signature = await account.signMessage({ message });
  const complete = await api(baseUrl, "POST", `/v1/wallet/bind/${sessionId}/complete`, {
    body: { message, signature },
  });
  if (complete.status !== 200) throw new Error(`bind complete failed: ${JSON.stringify(complete)}`);
}

/**
 * Spawns an EXTRA backend instance against the shared anvil/contracts with
 * custom env (e.g. a CONFIRMATION_BLOCKS window) and its own SQLite file.
 */
export async function spawnBackend(options: {
  port: number;
  env?: Record<string, string>;
}): Promise<{ baseUrl: string; kill: () => Promise<void> }> {
  const shared = testEnv();
  const backendDir = resolve(import.meta.dirname, "..");
  const tmpDir = mkdtempSync(join(tmpdir(), "asset-backend-extra-"));
  const baseUrl = `http://127.0.0.1:${options.port}`;

  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: backendDir,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      SKIP_DOTENV: "1",
      PORT: String(options.port),
      HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
      RPC_URL: shared.rpcUrl,
      CHAIN_ID: "31337",
      CHAIN_NAME: "Anvil (test)",
      NATIVE_SYMBOL: "ETH",
      IS_TESTNET: "true",
      EXPLORER_BASE_URL: "https://example-explorer.invalid",
      DEPLOYMENTS_FILE: "",
      ADDR_GAME_ASSET_REGISTRY: shared.contracts.gameAssetRegistry,
      ADDR_WEAPON_SKIN: shared.contracts.weaponSkin,
      ADDR_REWARD_DISTRIBUTOR: shared.contracts.rewardDistributor,
      ADDR_SKIN_MARKET: shared.contracts.skinMarket,
      ADDR_MATCH_ATTESTATION: shared.contracts.matchAttestation,
      ADDR_TOURNAMENT_ESCROW: shared.contracts.tournamentEscrow,
      OPERATOR_PRIVATE_KEY:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      JWT_SECRET: "integration-test-jwt-secret",
      INTERNAL_SERVICE_TOKEN: shared.internalToken,
      WEB_ORIGIN: shared.webOrigin,
      DB_PATH: join(tmpDir, "backend.sqlite3"),
      ...options.env,
    },
  });
  child.stderr?.on("data", (chunk: Buffer) =>
    process.stderr.write(`[backend:${options.port}] ${chunk.toString()}`),
  );

  const started = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}/v1/config`)).ok) break;
    } catch {
      // keep polling
    }
    if (Date.now() - started > 30_000) {
      child.kill("SIGKILL");
      throw new Error(`extra backend on :${options.port} did not come up`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    baseUrl,
    kill: () =>
      new Promise<void>((resolveKill) => {
        if (child.exitCode !== null) {
          rmSync(tmpDir, { recursive: true, force: true });
          return resolveKill();
        }
        child.once("exit", () => {
          rmSync(tmpDir, { recursive: true, force: true });
          resolveKill();
        });
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 3000).unref();
      }),
  };
}

/**
 * Minimal ABI fragments the TESTS need for direct chain access
 * (hand-copied from contracts/src — createTournament is not part of the
 * backend's own ABI surface because the backend never writes tournaments).
 */
export const testEscrowAbi = [
  {
    type: "function",
    name: "createTournament",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "resultSubmitter", type: "address" },
          { name: "entryFee", type: "uint96" },
          { name: "minParticipants", type: "uint32" },
          { name: "maxParticipants", type: "uint32" },
          { name: "registrationDeadline", type: "uint64" },
          { name: "resultDeadline", type: "uint64" },
          { name: "organizerFeeBps", type: "uint16" },
          { name: "payoutBps", type: "uint16[]" },
        ],
      },
    ],
    outputs: [{ name: "tournamentId", type: "uint256" }],
  },
] as const;
