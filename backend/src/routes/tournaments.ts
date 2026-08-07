import type { FastifyInstance } from "fastify";
import { formatEther, parseEventLogs, zeroAddress } from "viem";
import { errors } from "../errors.js";
import { TtlCache } from "../cache.js";
import { TOURNAMENT_STATUS, tournamentEscrowAbi } from "../chain/abi.js";
import { isRpcUnavailable, revertErrorName } from "../chain/client.js";
import type { AppContext } from "../context.js";

/**
 * Tournaments are read straight from TournamentEscrow. The contract DOES
 * support enumeration (`tournamentCount` is a public counter and ids are
 * 1..count), so no off-chain registry is needed. Gaps that are event-only
 * on-chain (cancel reason, settle resultHash, winners) are recovered via
 * getLogs over the escrow's own events.
 *
 * Known gap: the contract stores no display title — summaries use
 * "Tournament #<id>" (openapi title is optional).
 */

interface TournamentCore {
  tournamentId: bigint;
  organizer: `0x${string}`;
  entryFee: bigint;
  resultSubmitter: `0x${string}`;
  maxParticipants: number;
  minParticipants: number;
  organizerFeeBps: number;
  status: (typeof TOURNAMENT_STATUS)[number];
  registrationDeadline: bigint;
  resultDeadline: bigint;
  participantCount: number;
  prizePool: bigint;
}

const PAGE_SIZE = 20;

export function registerTournamentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;
  const coreCache = new TtlCache<TournamentCore>(10_000);

  const amount = (wei: bigint) => ({
    wei: wei.toString(10),
    formatted: formatEther(wei),
    symbol: config.nativeSymbol,
  });

  async function readCore(id: bigint): Promise<TournamentCore | undefined> {
    const cached = coreCache.getFresh(id.toString());
    if (cached) return cached.value;
    try {
      const t = await ctx.chain.publicClient.readContract({
        address: config.contracts.tournamentEscrow,
        abi: tournamentEscrowAbi,
        functionName: "getTournament",
        args: [id],
      });
      const core: TournamentCore = {
        tournamentId: id,
        organizer: t.organizer,
        entryFee: t.entryFee,
        resultSubmitter: t.resultSubmitter,
        maxParticipants: t.maxParticipants,
        minParticipants: t.minParticipants,
        organizerFeeBps: t.organizerFeeBps,
        status: TOURNAMENT_STATUS[t.status] ?? "none",
        registrationDeadline: t.registrationDeadline,
        resultDeadline: t.resultDeadline,
        participantCount: t.participantCount,
        prizePool: t.prizePool,
      };
      coreCache.set(id.toString(), core);
      return core;
    } catch (error) {
      if (revertErrorName(error) === "TournamentNotFound") return undefined;
      throw error;
    }
  }

  async function boundWallet(playerId: string): Promise<`0x${string}` | undefined> {
    const binding = ctx.db.getBindingByPlayer(playerId);
    return binding ? (binding.wallet as `0x${string}`) : undefined;
  }

  async function isRegistered(id: bigint, wallet: `0x${string}` | undefined): Promise<boolean> {
    if (!wallet) return false;
    try {
      return await ctx.chain.publicClient.readContract({
        address: config.contracts.tournamentEscrow,
        abi: tournamentEscrowAbi,
        functionName: "isRegistered",
        args: [id, wallet],
      });
    } catch {
      return false;
    }
  }

  function toSummary(core: TournamentCore, registered: boolean) {
    return {
      tournamentId: core.tournamentId.toString(10),
      title: `Tournament #${core.tournamentId}`,
      status: core.status,
      entryFee: amount(core.entryFee),
      prizePool: amount(core.prizePool),
      participantCount: core.participantCount,
      minParticipants: core.minParticipants,
      maxParticipants: core.maxParticipants,
      registrationDeadline: new Date(Number(core.registrationDeadline) * 1000).toISOString(),
      isRegistered: registered,
    };
  }

  // ---- list ------------------------------------------------------------
  app.get<{ Querystring: { status?: string; cursor?: string } }>(
    "/v1/tournaments",
    async (request) => {
      const playerId = await ctx.auth.requirePlayer(request);
      const statusFilter = request.query.status;
      if (statusFilter && !["open", "settled", "cancelled"].includes(statusFilter)) {
        throw errors.badRequest("invalid_status", "status must be open|settled|cancelled");
      }
      const cursor = request.query.cursor ? BigInt(request.query.cursor) : 0n;

      try {
        const count = await ctx.chain.publicClient.readContract({
          address: config.contracts.tournamentEscrow,
          abi: tournamentEscrowAbi,
          functionName: "tournamentCount",
        });

        const wallet = await boundWallet(playerId);
        const items = [];
        let lastId = cursor;
        for (let id = cursor + 1n; id <= count && items.length < PAGE_SIZE; id++) {
          lastId = id;
          const core = await readCore(id);
          if (!core || core.status === "none") continue;
          if (statusFilter && core.status !== statusFilter) continue;
          items.push(toSummary(core, await isRegistered(id, wallet)));
        }
        return {
          items,
          ...(lastId < count ? { nextCursor: lastId.toString(10) } : {}),
        };
      } catch (error) {
        if (isRpcUnavailable(error)) {
          throw errors.degraded("Chain RPC unavailable; tournament list not readable.");
        }
        throw error;
      }
    },
  );

  // ---- detail ----------------------------------------------------------
  app.get<{ Params: { tournamentId: string } }>(
    "/v1/tournaments/:tournamentId",
    async (request) => {
      const playerId = await ctx.auth.requirePlayer(request);
      const id = parseTournamentId(request.params.tournamentId);
      try {
        const core = await readCore(id);
        if (!core || core.status === "none") {
          throw errors.notFound("tournament_not_found", "Unknown tournament.");
        }

        const wallet = await boundWallet(playerId);
        const [payoutBps, registered] = await Promise.all([
          ctx.chain.publicClient.readContract({
            address: config.contracts.tournamentEscrow,
            abi: tournamentEscrowAbi,
            functionName: "getPayoutBps",
            args: [id],
          }),
          isRegistered(id, wallet),
        ]);

        const detail: Record<string, unknown> = {
          ...toSummary(core, registered),
          organizer: core.organizer,
          resultSubmitter: core.resultSubmitter,
          organizerFeeBps: core.organizerFeeBps,
          payoutBps: [...payoutBps],
          resultDeadline: new Date(Number(core.resultDeadline) * 1000).toISOString(),
        };

        if (core.status === "settled") {
          const settledInfo = await readSettlement(ctx, id);
          if (settledInfo.resultHash) detail.resultHash = settledInfo.resultHash;
          detail.winners = settledInfo.winners;
        }
        if (core.status === "cancelled") {
          const reason = await readCancelReason(ctx, id);
          if (reason) detail.cancelReason = reason;
        }
        if (wallet) {
          const [prize, refundable] = await Promise.all([
            ctx.chain.publicClient.readContract({
              address: config.contracts.tournamentEscrow,
              abi: tournamentEscrowAbi,
              functionName: "prizeOf",
              args: [id, wallet],
            }),
            ctx.chain.publicClient.readContract({
              address: config.contracts.tournamentEscrow,
              abi: tournamentEscrowAbi,
              functionName: "refundableOf",
              args: [id, wallet],
            }),
          ]);
          detail.myClaimable = amount(prize);
          detail.myRefundable = amount(refundable);
        }
        return detail;
      } catch (error) {
        if (isRpcUnavailable(error)) {
          throw errors.degraded("Chain RPC unavailable; tournament not readable.");
        }
        throw error;
      }
    },
  );

  // ---- intents ---------------------------------------------------------
  app.post<{ Params: { tournamentId: string; action: string } }>(
    "/v1/tournaments/:tournamentId/intents/:action",
    async (request) => {
      const playerId = await ctx.auth.requirePlayer(request);
      const action = request.params.action;
      if (!["register", "sponsor", "claim-prize", "claim-refund"].includes(action)) {
        throw errors.badRequest("invalid_action", "action must be register|sponsor|claim-prize|claim-refund");
      }
      const id = parseTournamentId(request.params.tournamentId);

      try {
        const core = await readCore(id);
        if (!core || core.status === "none") {
          throw errors.notFound("tournament_not_found", "Unknown tournament.");
        }
        const wallet = await boundWallet(playerId);
        const nowSec = BigInt(Math.floor(Date.now() / 1000));

        // Feasibility precheck only — the contract remains the enforcer.
        switch (action) {
          case "register": {
            if (core.status !== "open") throw errors.conflict("wrong_status", "Tournament is not open.");
            if (nowSec > core.registrationDeadline) {
              throw errors.conflict("registration_closed", "Registration deadline has passed.");
            }
            if (core.participantCount >= core.maxParticipants) {
              throw errors.conflict("tournament_full", "Tournament is full.");
            }
            if (wallet && (await isRegistered(id, wallet))) {
              throw errors.conflict("already_registered", "This wallet is already registered.");
            }
            break;
          }
          case "sponsor": {
            if (core.status !== "open") throw errors.conflict("wrong_status", "Tournament is not open.");
            if (nowSec > core.registrationDeadline) {
              throw errors.conflict("registration_closed", "Sponsoring closes with registration.");
            }
            break;
          }
          case "claim-prize": {
            if (core.status !== "settled") {
              throw errors.conflict("wrong_status", "Prizes are only claimable after settlement.");
            }
            if (wallet) {
              const prize = await ctx.chain.publicClient.readContract({
                address: config.contracts.tournamentEscrow,
                abi: tournamentEscrowAbi,
                functionName: "prizeOf",
                args: [id, wallet],
              });
              if (prize === 0n) throw errors.conflict("nothing_to_claim", "No prize for the bound wallet.");
            }
            break;
          }
          case "claim-refund": {
            if (core.status !== "cancelled") {
              throw errors.conflict("wrong_status", "Refunds are only available after cancellation.");
            }
            if (wallet) {
              const refundable = await ctx.chain.publicClient.readContract({
                address: config.contracts.tournamentEscrow,
                abi: tournamentEscrowAbi,
                functionName: "refundableOf",
                args: [id, wallet],
              });
              if (refundable === 0n) {
                throw errors.conflict("nothing_to_claim", "No refund for the bound wallet.");
              }
            }
            break;
          }
        }

        return {
          tournamentId: id.toString(10),
          action,
          // The web app owns these pages; a well-formed URL is the contract.
          actionUrl: `${config.webOrigin}/tournaments/${id}/${action}`,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      } catch (error) {
        if (isRpcUnavailable(error)) {
          throw errors.degraded("Chain RPC unavailable; cannot validate the intent.");
        }
        throw error;
      }
    },
  );
}

function parseTournamentId(raw: string): bigint {
  if (!/^[0-9]{1,18}$/.test(raw)) {
    throw errors.notFound("tournament_not_found", "Unknown tournament.");
  }
  return BigInt(raw);
}

async function readSettlement(ctx: AppContext, id: bigint) {
  const logs = await ctx.chain.publicClient.getLogs({
    address: ctx.config.contracts.tournamentEscrow,
    events: tournamentEscrowAbi.filter(
      (item) => item.type === "event" && (item.name === "Settled" || item.name === "PrizeAssigned"),
    ) as never,
    fromBlock: 0n,
  });
  const parsed = parseEventLogs({ abi: tournamentEscrowAbi, logs });

  let resultHash: string | undefined;
  const winners: { rank: number; wallet: string; playerId?: string; amount: unknown }[] = [];
  for (const log of parsed) {
    if (log.eventName === "Settled" && log.args.tournamentId === id) {
      resultHash = log.args.resultHash;
    }
    if (log.eventName === "PrizeAssigned" && log.args.tournamentId === id) {
      const wallet = log.args.winner ?? zeroAddress;
      const playerId = ctx.db.getBindingByWallet(wallet)?.player_id;
      winners.push({
        rank: log.args.rank ?? 0,
        wallet,
        ...(playerId ? { playerId } : {}),
        amount: {
          wei: (log.args.amount ?? 0n).toString(10),
          formatted: formatEther(log.args.amount ?? 0n),
          symbol: ctx.config.nativeSymbol,
        },
      });
    }
  }
  // PrizeAssigned rank 0 markers never exist (ranks start at 1); the
  // organizer-fee assignment also emits no PrizeAssigned. Sort by rank.
  winners.sort((a, b) => a.rank - b.rank);
  return { resultHash, winners };
}

async function readCancelReason(ctx: AppContext, id: bigint): Promise<string | undefined> {
  const logs = await ctx.chain.publicClient.getLogs({
    address: ctx.config.contracts.tournamentEscrow,
    event: tournamentEscrowAbi.find(
      (item) => item.type === "event" && item.name === "Cancelled",
    ) as Extract<(typeof tournamentEscrowAbi)[number], { type: "event" }>,
    args: { tournamentId: id },
    fromBlock: 0n,
  });
  const parsed = parseEventLogs({ abi: tournamentEscrowAbi, logs, eventName: "Cancelled" });
  return parsed.find((log) => log.args.tournamentId === id)?.args.reason;
}
