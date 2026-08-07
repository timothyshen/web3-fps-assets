import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { errors } from "../errors.js";
import { canonicalJsonOf, matchIdKeyOf, resultHashOf, rewardRequestId } from "../hashing.js";
import { assignRewardSkin, skinName } from "../catalog.js";
import type { AppContext } from "../context.js";
import type { MatchRow } from "../db.js";

/**
 * POST /internal/v1/matches — authoritative game server pushes the result
 * package. The backend canonicalizes (RFC 8785), derives
 * resultHash = keccak256(canonical UTF-8 bytes), persists, creates rewards
 * from rewardSlots and queues the MatchAttestation submission. Attestation
 * failure never fails this endpoint (PRD MAT-006).
 *
 * Idempotency key is matchId: identical re-push → 200 with the existing
 * record; same matchId with DIFFERENT canonical content (hash mismatch) →
 * 409 (published results are immutable, PRD MAT-002).
 *
 * GET /v1/matches/{matchId} — public (openapi security: []): serves
 * canonicalJson so anyone can independently re-hash and compare with the
 * on-chain attestation.
 */
export function registerMatchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  const playerSchema = z.object({
    playerId: z.string().min(1),
    teamId: z.string(),
    kills: z.number().int(),
    deaths: z.number().int(),
    score: z.number().int(),
    placement: z.number().int(),
    result: z.enum(["win", "loss", "draw"]),
  });

  const matchResultSchema = z
    .object({
      version: z.string(),
      matchId: z.string().min(1).max(128),
      modeId: z.string(),
      mapId: z.string(),
      startedAt: z.number().int().nonnegative(),
      endedAt: z.number().int().nonnegative(),
      serverBuild: z.string(),
      tournamentId: z.string().nullable().optional(),
      players: z.array(playerSchema).min(1),
      antiCheatState: z.enum(["passed", "held", "rejected"]),
      rewardSlots: z
        .array(
          z.object({
            slot: z.number().int().min(0).max(255), // uint8 in the requestId encoding
            playerId: z.string().min(1),
            rewardId: z.string().min(1).max(128),
          }),
        )
        .optional(),
    })
    .loose(); // extra fields are allowed and hashed — the hash covers every byte

  app.post("/internal/v1/matches", async (request) => {
    ctx.auth.requireService(request);

    const parsed = matchResultSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw errors.badRequest(
        "invalid_match_result",
        `${issue?.path.join(".") ?? "body"}: ${issue?.message ?? "invalid"}`,
      );
    }
    const result = parsed.data;
    if (result.endedAt < result.startedAt) {
      throw errors.badRequest("invalid_match_result", "endedAt must be >= startedAt");
    }
    // Business rule from the PRD (not JCS): players sorted by playerId asc.
    for (let i = 1; i < result.players.length; i++) {
      if (result.players[i]!.playerId <= result.players[i - 1]!.playerId) {
        throw errors.badRequest(
          "invalid_match_result",
          "players must be sorted by playerId ascending (PRD 7.2)",
        );
      }
    }

    // Canonicalize the RAW body (not the zod output) so unknown fields the
    // game server sent are part of the hashed record.
    const canonicalJson = canonicalJsonOf(request.body);
    const resultHash = resultHashOf(canonicalJson);

    const existing = db.getMatch(result.matchId);
    if (existing) {
      if (existing.result_hash === resultHash) {
        return toMatchRecord(ctx, existing); // duplicate push — fine
      }
      throw errors.conflict(
        "match_conflict",
        "This matchId is already recorded with different content; published results are immutable.",
      );
    }

    db.insertMatch({
      match_id: result.matchId,
      canonical_json: canonicalJson,
      result_hash: resultHash,
      match_id_key: matchIdKeyOf(result.matchId),
    });

    // Rewards: claimable when anti-cheat passed; held while under review;
    // none at all for rejected matches (mints are irreversible — risk
    // control must happen before the mint, docs/security.md T4).
    if (result.antiCheatState !== "rejected") {
      const state = result.antiCheatState === "passed" ? "claimable" : "held";
      const expiresAt = Date.now() + config.rewardExpiryDays * 24 * 3600 * 1000;
      for (const slot of result.rewardSlots ?? []) {
        const { skinDefId, wear } = assignRewardSkin(slot.rewardId);
        const rarity = await ctx.reads
          .getSkinDef(skinDefId)
          .then((def) => def.rarity)
          .catch(() => 0); // cosmetic only; degrade quietly if RPC is down
        db.insertRewardIfAbsent({
          reward_id: slot.rewardId,
          match_id: result.matchId,
          player_id: slot.playerId,
          slot: slot.slot,
          skin_def_id: skinDefId,
          wear,
          season_id: config.defaultSeasonId,
          rarity,
          name: skinName(skinDefId),
          state,
          request_id: rewardRequestId(result.matchId, slot.playerId, slot.slot),
          expires_at: expiresAt,
          created_at: Date.now(),
        });
      }
    }

    // Nudge the attestation worker; its failures stay its own.
    setImmediate(() => void ctx.attestation.tick());

    const stored = db.getMatch(result.matchId);
    if (!stored) throw new Error("match row vanished after insert");
    return toMatchRecord(ctx, stored);
  });

  app.get<{ Params: { matchId: string } }>("/v1/matches/:matchId", async (request) => {
    const match = db.getMatch(request.params.matchId);
    if (!match) throw errors.notFound("match_not_found", "Unknown match.");
    return toMatchRecord(ctx, match);
  });
}

function toMatchRecord(ctx: AppContext, match: MatchRow) {
  return {
    matchId: match.match_id,
    resultHash: match.result_hash,
    canonicalJson: match.canonical_json,
    result: JSON.parse(match.canonical_json) as unknown,
    attestation: {
      state: match.attest_state,
      ...(match.attest_tx_hash
        ? {
            txHash: match.attest_tx_hash,
            explorerUrl: `${ctx.config.explorerBaseUrl}/tx/${match.attest_tx_hash}`,
          }
        : {}),
      ...(match.attested_at ? { attestedAt: new Date(match.attested_at).toISOString() } : {}),
    },
  };
}
