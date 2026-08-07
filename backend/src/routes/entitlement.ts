import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { AppContext } from "../context.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;

interface ResolvedSkin {
  slot: number;
  tokenId?: string;
  skinDefId: number;
  contentHash: string;
  isDefault: boolean;
}

interface RejectedToken {
  tokenId: string;
  reason: "not_owned" | "not_confirmed" | "content_hash_mismatch" | "unknown_token";
}

/**
 * POST /internal/v1/entitlement-check — the game server's pre-match
 * ownership verification (serviceToken auth; deliberately NOT in
 * IGameAssetGateway — clients must never reach it).
 *
 * Verifies every requested tokenId against the bound wallet of the
 * playerId via fresh chain reads, resolves skinDefId + contentHash per
 * slot, falls back to the default skin for anything rejected, and persists
 * a snapshotId the game server holds for the whole match.
 *
 * Degradation (PRD AST-006): if dependencies are down this returns an
 * allowed=true, degraded=true default-skin snapshot — never a refusal.
 */
export function registerEntitlementRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  const bodySchema = z.object({
    playerId: z.string().min(1),
    matchId: z.string().min(1),
    wallet: z.string().optional(),
    tokenIds: z.array(z.string().regex(/^$|^[0-9]{1,78}$/)).max(32),
  });

  app.post("/internal/v1/entitlement-check", async (request) => {
    ctx.auth.requireService(request);

    const parsed = bodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw errors.badRequest(
        "invalid_request",
        parsed.error.issues[0]?.message ?? "playerId, matchId, tokenIds required",
      );
    }
    const { playerId, matchId, tokenIds } = parsed.data;

    // The DB binding is the truth; the wallet in the payload is advisory
    // only (the game server may be echoing stale data).
    const binding = db.getBindingByPlayer(playerId);
    const wallet = binding?.wallet.toLowerCase();

    const resolvedSkins: ResolvedSkin[] = [];
    const rejectedTokenIds: RejectedToken[] = [];
    let degraded = false;

    for (let slot = 0; slot < tokenIds.length; slot++) {
      const tokenId = tokenIds[slot]!;
      if (tokenId === "") {
        resolvedSkins.push(defaultSlot(slot));
        continue;
      }
      if (!wallet) {
        rejectedTokenIds.push({ tokenId, reason: "not_owned" });
        resolvedSkins.push(defaultSlot(slot));
        continue;
      }
      try {
        const owner = await ctx.reads.ownerOf(BigInt(tokenId));
        if (owner === null) {
          rejectedTokenIds.push({ tokenId, reason: "unknown_token" });
          resolvedSkins.push(defaultSlot(slot));
          continue;
        }
        if (owner.toLowerCase() !== wallet) {
          rejectedTokenIds.push({ tokenId, reason: "not_owned" });
          resolvedSkins.push(defaultSlot(slot));
          continue;
        }
        const data = await ctx.reads.skinDataOf(BigInt(tokenId));
        const def = await ctx.reads.getSkinDef(data.skinDefId);
        resolvedSkins.push({
          slot,
          tokenId,
          skinDefId: data.skinDefId,
          contentHash: def.contentHash,
          isDefault: false,
        });
      } catch (error) {
        // Dependency failure → default skin for this slot, match proceeds.
        request.log.warn({ err: error, tokenId }, "entitlement check degraded");
        degraded = true;
        resolvedSkins.push(defaultSlot(slot));
      }
    }

    const snapshotId = `snap_${randomUUID()}`;
    const payload = {
      allowed: true, // never blocks a match (PRD AST-006)
      snapshotId,
      resolvedSkins,
      rejectedTokenIds,
      cacheAgeSeconds: 0, // fresh reads (or live degradation) — no cache layer here
      degraded,
    };
    db.saveSnapshot({
      snapshot_id: snapshotId,
      match_id: matchId,
      player_id: playerId,
      payload_json: JSON.stringify(payload),
    });
    return payload;
  });
}

/** Slot resolution for the built-in default skin (skinDefId 0). */
function defaultSlot(slot: number): ResolvedSkin {
  return { slot, skinDefId: 0, contentHash: ZERO_HASH, isDefault: true };
}
