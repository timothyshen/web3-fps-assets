import type { FastifyInstance } from "fastify";
import { errors } from "../errors.js";
import type { AppContext } from "../context.js";
import type { RewardRow } from "../db.js";

/**
 * POST /v1/rewards/{rewardId}/claim — push path: triggers
 * RewardDistributor.mintDirect in the background; idempotent per openapi
 * (a repeat call never re-mints — DB unique index + on-chain requestId).
 * GET  /v1/rewards/{rewardId} — poll the reward state machine.
 */
export function registerRewardRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.post<{ Params: { rewardId: string } }>("/v1/rewards/:rewardId/claim", async (request) => {
    const playerId = await ctx.auth.requirePlayer(request);
    const reward = db.getReward(request.params.rewardId);
    // A reward belonging to another player is a 404, not a 403 — reward ids
    // are not to be probed.
    if (!reward || reward.player_id !== playerId) {
      throw errors.notFound("reward_not_found", "Unknown reward.");
    }

    if (!db.getBindingByPlayer(playerId)) {
      throw errors.conflict("wallet_not_bound", "Bind a wallet before claiming rewards.");
    }

    switch (reward.state) {
      case "held":
      case "earned":
        throw errors.conflict("reward_held", "Reward is not cleared for claiming yet.");
      case "confirmed":
      case "processing":
      case "pending_chain":
        // Idempotent repeat: report current progress, mint nothing new.
        return toClaimTicket(reward);
      case "claimable":
      case "failed": {
        if (reward.expires_at < Date.now()) {
          throw errors.conflict("reward_expired", "Reward has expired.");
        }
        if (db.tryMarkProcessing(reward.reward_id)) {
          ctx.minting.enqueueMint(reward.reward_id);
        }
        const updated = db.getReward(reward.reward_id) ?? reward;
        return toClaimTicket(updated);
      }
      default:
        throw errors.conflict("reward_held", `Reward in unexpected state ${reward.state as string}.`);
    }
  });

  app.get<{ Params: { rewardId: string } }>("/v1/rewards/:rewardId", async (request) => {
    const playerId = await ctx.auth.requirePlayer(request);
    const reward = db.getReward(request.params.rewardId);
    if (!reward || reward.player_id !== playerId) {
      throw errors.notFound("reward_not_found", "Unknown reward.");
    }
    return {
      rewardId: reward.reward_id,
      state: reward.state,
      ...(reward.token_id ? { tokenId: reward.token_id } : {}),
      ...(reward.tx_hash ? { txHash: reward.tx_hash } : {}),
      ...(reward.error ? { error: reward.error } : {}),
    };
  });
}

function toClaimTicket(reward: RewardRow) {
  return {
    rewardId: reward.reward_id,
    state: reward.state,
    // Push path: backend pays gas, the player does nothing (MVP default).
    requiresPlayerAction: false,
  };
}
