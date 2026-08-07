import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, errors } from "../errors.js";
import { isRpcUnavailable } from "../chain/client.js";
import type { AppContext } from "../context.js";
import type { RewardRow } from "../db.js";

/**
 * GET /v1/assets — closet + pending rewards (lobby-time only, cached).
 * PUT /v1/loadout — 204 on success, 403 {code,message} on any non-owned or
 * non-confirmed token (openapi setLoadout).
 */
export function registerAssetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get("/v1/assets", async (request) => {
    const playerId = await ctx.auth.requirePlayer(request);
    const binding = db.getBindingByPlayer(playerId);
    const pendingRewards = db.listPendingRewards(playerId).map(toPendingReward);

    // Unbound wallet → empty closet, wallet "" (never null: Unity's
    // JsonUtility chokes on null), zero staleness, NOT an error.
    if (!binding) {
      return { playerId, wallet: "", items: [], pendingRewards, stalenessSeconds: 0 };
    }

    const wallet = binding.wallet as `0x${string}`;
    const cacheKey = wallet.toLowerCase();

    const fresh = ctx.assetsCache.getFresh(cacheKey);
    if (fresh) {
      return {
        playerId,
        wallet,
        items: fresh.value,
        pendingRewards,
        stalenessSeconds: fresh.ageSeconds,
      };
    }

    try {
      const items = await ctx.reads.readCloset(wallet);
      ctx.assetsCache.set(cacheKey, items);
      return { playerId, wallet, items, pendingRewards, stalenessSeconds: 0 };
    } catch (error) {
      // Degradation matrix: RPC down → serve the stale cache with an honest
      // age. With no cache at all, report degraded instead of lying.
      const stale = ctx.assetsCache.getStale(cacheKey);
      if (stale) {
        request.log.warn({ err: error }, "serving stale closet (RPC unavailable)");
        return {
          playerId,
          wallet,
          items: stale.value,
          pendingRewards,
          stalenessSeconds: stale.ageSeconds,
        };
      }
      if (isRpcUnavailable(error)) {
        throw errors.degraded("Chain RPC unavailable and no cached inventory yet.");
      }
      throw error;
    }
  });

  // ---- loadout ---------------------------------------------------------
  const loadoutSchema = z.object({
    tokenIdsBySlot: z
      .array(z.string().regex(/^$|^[0-9]{1,78}$/, "decimal tokenId string or empty"))
      .max(16),
  });

  app.put("/v1/loadout", async (request, reply) => {
    const playerId = await ctx.auth.requirePlayer(request);
    const parsed = loadoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw errors.badRequest(
        "invalid_loadout",
        parsed.error.issues[0]?.message ?? "tokenIdsBySlot required",
      );
    }
    const tokenIds = parsed.data.tokenIdsBySlot;
    const nonEmpty = tokenIds.filter((id) => id !== "");

    if (nonEmpty.length > 0) {
      const binding = db.getBindingByPlayer(playerId);
      if (!binding) {
        throw new ApiError(
          403,
          "not_owned",
          "No wallet bound; only default skins (empty slots) are allowed.",
        );
      }
      const wallet = binding.wallet.toLowerCase();

      // Server-side revalidation of every token — the client is never
      // trusted (openapi 铁律 1). Fresh ownerOf reads, not the cache.
      try {
        for (const tokenId of nonEmpty) {
          const owner = await ctx.reads.ownerOf(BigInt(tokenId));
          if (owner === null) {
            throw new ApiError(403, "unknown_token", `Token ${tokenId} does not exist.`);
          }
          if (owner.toLowerCase() !== wallet) {
            throw new ApiError(403, "not_owned", `Token ${tokenId} is not owned by the bound wallet.`);
          }
          // Items read from settled chain state are `confirmed` under the
          // demo finality policy (see ChainReads.toSkinItem), so no extra
          // not_confirmed branch exists here.
        }
      } catch (error) {
        if (isRpcUnavailable(error)) {
          throw errors.degraded("Chain RPC unavailable; cannot verify loadout ownership now.");
        }
        throw error;
      }
    }

    db.saveLoadout(playerId, tokenIds);
    return reply.code(204).send();
  });
}

export function toPendingReward(row: RewardRow) {
  return {
    rewardId: row.reward_id,
    skinDefId: row.skin_def_id,
    name: row.name,
    rarity: row.rarity,
    state: row.state,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
