import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import type { AppContext } from "../context.js";
import type { RewardRow } from "../db.js";

/**
 * POST /v1/rewards/{rewardId}/claim — push path: triggers
 * RewardDistributor.mintDirect in the background; idempotent per openapi
 * (a repeat call never re-mints — DB unique index + on-chain requestId).
 * GET  /v1/rewards/{rewardId} — poll the reward state machine.
 * POST /internal/v1/rewards/{rewardId}/review — anti-cheat review gate
 * (serviceToken): resolves a held reward to claimable, or rejects it into
 * a terminal failed state whose reason code the client can display.
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

    // Review-rejected rewards are terminal: no retry may revive them.
    if (reward.terminal === 1) {
      throw errors.conflict(
        "reward_rejected",
        `Reward was rejected by review${reward.error ? ` (${reward.error})` : ""}.`,
      );
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

  // ---- anti-cheat review gate (internal-only; docs/security.md T4:
  // all risk control must happen BEFORE the irreversible mint) -----------
  const reviewSchema = z.object({
    decision: z.enum(["release", "reject"]),
    /** Machine-readable reason code stored on rejection (client-displayable). */
    reason: z
      .string()
      .regex(/^[a-z0-9_]{1,64}$/, "reason must be a lowercase_snake_case code")
      .optional(),
  });

  app.post<{ Params: { rewardId: string } }>(
    "/internal/v1/rewards/:rewardId/review",
    async (request) => {
      ctx.auth.requireService(request);
      const parsed = reviewSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw errors.badRequest(
          "invalid_decision",
          parsed.error.issues[0]?.message ?? "decision must be release|reject",
        );
      }
      const reward = db.getReward(request.params.rewardId);
      if (!reward) throw errors.notFound("reward_not_found", "Unknown reward.");

      const { decision } = parsed.data;
      const reason = parsed.data.reason ?? "rejected_by_review";

      if (decision === "release") {
        if (db.releaseHeldReward(reward.reward_id)) {
          return { rewardId: reward.reward_id, state: "claimable" };
        }
        // Idempotent repeat: already released and not rejected → echo state.
        if (reward.terminal === 0 && reward.state !== "held") {
          return { rewardId: reward.reward_id, state: reward.state };
        }
        throw errors.conflict("wrong_state", `Cannot release a ${reward.state} reward.`);
      }

      // decision === "reject"
      if (db.rejectHeldReward(reward.reward_id, reason)) {
        return { rewardId: reward.reward_id, state: "failed", error: reason };
      }
      if (reward.terminal === 1) {
        // Idempotent repeat of a rejection.
        return { rewardId: reward.reward_id, state: "failed", error: reward.error ?? reason };
      }
      throw errors.conflict("wrong_state", `Cannot reject a ${reward.state} reward.`);
    },
  );
}

function toClaimTicket(reward: RewardRow) {
  return {
    rewardId: reward.reward_id,
    state: reward.state,
    // Push path: backend pays gas, the player does nothing (MVP default).
    requiresPlayerAction: false,
  };
}
