import type { AppConfig } from "../config.js";
import type { Db, MatchRow } from "../db.js";
import { matchAttestationAbi } from "../chain/abi.js";
import { revertErrorName, type ChainContext } from "../chain/client.js";

/**
 * Background MatchAttestation submitter.
 *
 * POST /internal/v1/matches only persists the match and enqueues here —
 * attestation failure must NEVER fail the submit endpoint (PRD MAT-006:
 * 存证失败不影响赛后页与战绩展示). Retries with exponential backoff up to
 * attestMaxAttempts, then parks the match as attest_state = "failed"
 * (still fully served by GET /v1/matches/{matchId}).
 *
 * Hackathon scope: in-process poller over a SQLite queue. Production wants
 * a durable external queue — see backend/README.md production TODOs.
 */
export class AttestationWorker {
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    private readonly config: AppConfig,
    private readonly db: Db,
    private readonly ctx: ChainContext,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.config.attestIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Also called right after a match submit so tests/demos see fast attestation. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const match of this.db.dueAttestations()) {
        await this.attestOne(match);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async attestOne(match: MatchRow): Promise<void> {
    const matchIdKey = match.match_id_key as `0x${string}`;
    const resultHash = match.result_hash as `0x${string}`;
    try {
      // Someone (a previous crashed attempt, another operator) may have
      // attested already — the contract forbids re-attesting.
      const existing = await this.ctx.publicClient.readContract({
        address: this.config.contracts.matchAttestation,
        abi: matchAttestationAbi,
        functionName: "resultOf",
        args: [matchIdKey],
      });
      if (existing !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        if (existing === resultHash) {
          this.db.markAttested(match.match_id, null);
        } else {
          this.db.markAttestFailed(
            match.match_id,
            `on-chain attestation differs: ${existing}`,
          );
        }
        return;
      }

      const txHash = await this.ctx.withTxLock(async () => {
        const { request } = await this.ctx.publicClient.simulateContract({
          account: this.ctx.operator,
          address: this.config.contracts.matchAttestation,
          abi: matchAttestationAbi,
          functionName: "attest",
          args: [matchIdKey, resultHash],
        });
        return this.ctx.walletClient.writeContract(request);
      });
      const receipt = await this.ctx.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });
      if (receipt.status === "success") {
        this.db.markAttested(match.match_id, txHash);
      } else {
        this.scheduleRetry(match, `attest tx reverted: ${txHash}`);
      }
    } catch (error) {
      if (revertErrorName(error) === "AlreadyAttested") {
        // Race with another submitter — re-check on the next tick.
        this.db.recordAttestAttempt(match.match_id, Date.now(), "AlreadyAttested race");
        return;
      }
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      this.scheduleRetry(match, message);
    }
  }

  private scheduleRetry(match: MatchRow, error: string): void {
    const attempts = match.attest_attempts + 1;
    if (attempts >= this.config.attestMaxAttempts) {
      this.db.markAttestFailed(match.match_id, `gave up after ${attempts} attempts: ${error}`);
      return;
    }
    const backoffMs = Math.min(60_000, 1000 * 2 ** attempts);
    this.db.recordAttestAttempt(match.match_id, Date.now() + backoffMs, error);
  }
}
