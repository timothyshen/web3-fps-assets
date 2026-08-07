import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, errors } from "../errors.js";
import { isRpcUnavailable } from "../chain/client.js";
import type { ClosetEntry, SkinItemDto } from "../chain/reads.js";
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
        items: await itemsWithLiveFinality(ctx, fresh.value),
        pendingRewards,
        stalenessSeconds: fresh.ageSeconds,
      };
    }

    try {
      const entries = await ctx.reads.readCloset(
        wallet,
        (tokenId) => db.getRewardByTokenId(tokenId)?.minted_block,
      );
      ctx.assetsCache.set(cacheKey, entries);
      return {
        playerId,
        wallet,
        items: entries.map((entry) => entry.item),
        pendingRewards,
        stalenessSeconds: 0,
      };
    } catch (error) {
      // Degradation matrix: RPC down → serve the stale cache with an honest
      // age. With no cache at all, report degraded instead of lying.
      const stale = ctx.assetsCache.getStale(cacheKey);
      if (stale) {
        request.log.warn({ err: error }, "serving stale closet (RPC unavailable)");
        return {
          playerId,
          wallet,
          items: stale.value.map((entry) => entry.item),
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
          // Finality window (docs/security.md T6, openapi AST-004): a token
          // inside the CONFIRMATION_BLOCKS window is pending and cannot be
          // part of a formal loadout.
          const finality = await ctx.reads.tokenFinalityState(
            owner,
            BigInt(tokenId),
            db.getRewardByTokenId(tokenId)?.minted_block,
          );
          if (finality === "pending") {
            throw new ApiError(
              403,
              "not_confirmed",
              `Token ${tokenId} has not reached chain finality yet.`,
            );
          }
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

/**
 * Cache hits keep the acquisition block per entry, so `state` is re-derived
 * against the live head — a token pending at fetch time flips to confirmed
 * as blocks arrive, without waiting out the cache TTL. If the head is not
 * readable (RPC down), the cached states stand.
 */
async function itemsWithLiveFinality(
  ctx: AppContext,
  entries: ClosetEntry[],
): Promise<SkinItemDto[]> {
  if (ctx.config.confirmationBlocks === 0 || entries.length === 0) {
    return entries.map((entry) => entry.item);
  }
  let currentBlock: bigint | undefined;
  try {
    currentBlock = await ctx.reads.currentBlockNumber();
  } catch {
    return entries.map((entry) => entry.item);
  }
  return entries.map((entry) => ({
    ...entry.item,
    state: ctx.reads.deriveFinalityState(entry.acquisitionBlock, currentBlock),
  }));
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
