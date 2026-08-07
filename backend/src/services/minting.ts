import { parseEventLogs } from "viem";
import type { AppConfig } from "../config.js";
import type { Db, RewardRow } from "../db.js";
import type { TtlCache } from "../cache.js";
import type { ClosetEntry } from "../chain/reads.js";
import { rewardDistributorAbi } from "../chain/abi.js";
import { isRpcUnavailable, revertErrorName, type ChainContext } from "../chain/client.js";

/**
 * Push-path reward minting (docs/roadmap.md: demo 用 push).
 *
 * State machine written to the DB so pollers observe it
 * (claimable → processing → pending_chain → confirmed | failed):
 *  - `processing`   claim accepted, transaction being prepared
 *  - `pending_chain` tx submitted, txHash recorded
 *  - `confirmed`    receipt final, tokenId recorded
 *  - `failed`       retryable via a new claim call
 *
 * Idempotency layers:
 *  1. DB UNIQUE(match_id, player_id, slot) — one reward row ever.
 *  2. tryMarkProcessing's guarded UPDATE — one in-flight job per reward.
 *  3. On-chain requestId — even a confused backend cannot double-mint.
 */
export class MintingService {
  private inflight = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly ctx: ChainContext,
    private readonly assetsCache: TtlCache<ClosetEntry[]>,
  ) {}

  /** Kicks the mint job off in the background; never throws. */
  enqueueMint(rewardId: string): void {
    if (this.inflight.has(rewardId)) return;
    this.inflight.add(rewardId);
    void this.runMint(rewardId)
      .catch((error: unknown) => {
        // Last-resort guard; runMint records its own failures.
        this.db.setRewardFailed(rewardId, String(error instanceof Error ? error.message : error));
      })
      .finally(() => this.inflight.delete(rewardId));
  }

  private async runMint(rewardId: string): Promise<void> {
    const reward = this.db.getReward(rewardId);
    if (!reward || reward.state !== "processing") return;

    const binding = this.db.getBindingByPlayer(reward.player_id);
    if (!binding) {
      this.db.setRewardFailed(rewardId, "wallet_not_bound");
      return;
    }
    const wallet = binding.wallet as `0x${string}`;
    const requestId = reward.request_id as `0x${string}`;

    try {
      // Crash recovery / duplicate protection: if the chain already
      // processed this requestId, do NOT send another tx — find the token.
      const processed = await this.ctx.publicClient.readContract({
        address: this.config.contracts.rewardDistributor,
        abi: rewardDistributorAbi,
        functionName: "isRequestProcessed",
        args: [requestId],
      });
      if (processed) {
        await this.recoverProcessedRequest(reward, wallet, requestId);
        return;
      }

      const txHash = await this.ctx.withTxLock(async () => {
        const { request } = await this.ctx.publicClient.simulateContract({
          account: this.ctx.operator,
          address: this.config.contracts.rewardDistributor,
          abi: rewardDistributorAbi,
          functionName: "mintDirect",
          args: [wallet, reward.skin_def_id, reward.wear, reward.season_id, requestId],
        });
        return this.ctx.walletClient.writeContract(request);
      });

      this.db.setRewardPendingChain(rewardId, txHash);

      const receipt = await this.ctx.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
      if (receipt.status !== "success") {
        this.db.setRewardFailed(rewardId, `transaction reverted: ${txHash}`);
        return;
      }

      const minted = parseEventLogs({
        abi: rewardDistributorAbi,
        logs: receipt.logs,
        eventName: "RewardMinted",
      }).find((log) => log.args.requestId === requestId);
      if (!minted) {
        this.db.setRewardFailed(rewardId, `RewardMinted event missing in receipt ${txHash}`);
        return;
      }

      // Record the mint block: it is the token's acquisition block for the
      // finality window even when Transfer-log queries are unavailable.
      this.db.setRewardConfirmed(
        rewardId,
        minted.args.tokenId.toString(10),
        txHash,
        Number(receipt.blockNumber),
      );
      this.assetsCache.delete(wallet.toLowerCase());
    } catch (error) {
      const revertName = revertErrorName(error);
      if (revertName === "RequestAlreadyProcessed") {
        await this.recoverProcessedRequest(reward, wallet, requestId).catch((e: unknown) =>
          this.db.setRewardFailed(rewardId, `recover failed: ${String(e)}`),
        );
        return;
      }
      const message = isRpcUnavailable(error)
        ? "chain_unavailable: RPC unreachable, retry later"
        : `mint failed${revertName ? ` (${revertName})` : ""}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`;
      this.db.setRewardFailed(rewardId, message);
    }
  }

  /**
   * The chain says this requestId already minted (an earlier attempt whose
   * confirmation we lost). Recover the tokenId from RewardMinted logs.
   */
  private async recoverProcessedRequest(
    reward: RewardRow,
    wallet: `0x${string}`,
    requestId: `0x${string}`,
  ): Promise<void> {
    const logs = await this.ctx.publicClient.getLogs({
      address: this.config.contracts.rewardDistributor,
      event: rewardDistributorAbi.find(
        (item) => item.type === "event" && item.name === "RewardMinted",
      ) as Extract<(typeof rewardDistributorAbi)[number], { type: "event" }>,
      args: { player: wallet },
      fromBlock: 0n,
    });
    const match = logs.find((log) => log.args.requestId === requestId);
    if (!match || match.args.tokenId === undefined) {
      this.db.setRewardFailed(
        reward.reward_id,
        "requestId already processed on-chain but RewardMinted log not found",
      );
      return;
    }
    this.db.setRewardConfirmed(
      reward.reward_id,
      match.args.tokenId.toString(10),
      match.transactionHash,
      match.blockNumber === null ? null : Number(match.blockNumber),
    );
    this.assetsCache.delete(wallet.toLowerCase());
  }
}
