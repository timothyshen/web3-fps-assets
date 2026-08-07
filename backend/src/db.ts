import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * Durable state lives in SQLite (better-sqlite3, WAL mode):
 * bind sessions, playerId↔wallet bindings, rewards (with the
 * UNIQUE(match_id, player_id, slot) idempotency index), match results,
 * loadouts and entitlement snapshots.
 */

export type RewardStateDb =
  | "earned"
  | "held"
  | "claimable"
  | "processing"
  | "pending_chain"
  | "confirmed"
  | "failed";

export interface BindSessionRow {
  session_id: string;
  player_id: string;
  nonce: string;
  state: "pending" | "bound" | "expired" | "failed";
  wallet: string | null;
  error: string | null;
  created_at: number;
  expires_at: number;
}

export interface BindingRow {
  player_id: string;
  wallet: string;
  bound_at: number;
  session_id: string | null;
}

export interface RewardRow {
  reward_id: string;
  match_id: string;
  player_id: string;
  slot: number;
  skin_def_id: number;
  wear: number; // raw uint16 万分比
  season_id: number;
  rarity: number;
  name: string;
  state: RewardStateDb;
  request_id: string;
  token_id: string | null;
  tx_hash: string | null;
  /** Block the mint landed in (known from our own receipt); finality fallback. */
  minted_block: number | null;
  /** 1 = review-rejected: state "failed" is terminal, claim retries refused. */
  terminal: number;
  error: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface MatchRow {
  match_id: string;
  canonical_json: string;
  result_hash: string;
  match_id_key: string;
  attest_state: "pending" | "attested" | "failed";
  attest_tx_hash: string | null;
  attested_at: number | null;
  attest_error: string | null;
  attest_attempts: number;
  next_attempt_at: number;
  created_at: number;
}

export interface LoadoutRow {
  player_id: string;
  token_ids_json: string;
  updated_at: number;
}

export interface SnapshotRow {
  snapshot_id: string;
  match_id: string;
  player_id: string;
  payload_json: string;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bind_sessions (
  session_id TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'pending',
  wallet     TEXT,
  error      TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bindings (
  player_id  TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  bound_at   INTEGER NOT NULL,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS rewards (
  reward_id   TEXT PRIMARY KEY,
  match_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  slot        INTEGER NOT NULL,
  skin_def_id INTEGER NOT NULL,
  wear        INTEGER NOT NULL,
  season_id   INTEGER NOT NULL,
  rarity      INTEGER NOT NULL DEFAULT 0,
  name        TEXT NOT NULL,
  state       TEXT NOT NULL,
  request_id  TEXT NOT NULL,
  token_id    TEXT,
  tx_hash     TEXT,
  minted_block INTEGER,
  terminal    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(match_id, player_id, slot)
);

CREATE TABLE IF NOT EXISTS matches (
  match_id        TEXT PRIMARY KEY,
  canonical_json  TEXT NOT NULL,
  result_hash     TEXT NOT NULL,
  match_id_key    TEXT NOT NULL,
  attest_state    TEXT NOT NULL DEFAULT 'pending',
  attest_tx_hash  TEXT,
  attested_at     INTEGER,
  attest_error    TEXT,
  attest_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loadouts (
  player_id      TEXT PRIMARY KEY,
  token_ids_json TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement_snapshots (
  snapshot_id  TEXT PRIMARY KEY,
  match_id     TEXT NOT NULL,
  player_id    TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
`;

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // Lightweight migration for databases created before these columns existed.
  for (const column of ["minted_block INTEGER", "terminal INTEGER NOT NULL DEFAULT 0"]) {
    try {
      db.exec(`ALTER TABLE rewards ADD COLUMN ${column}`);
    } catch {
      // column already present
    }
  }

  const now = () => Date.now();

  return {
    raw: db,

    // ---- bind sessions -------------------------------------------------
    createBindSession(row: Omit<BindSessionRow, "state" | "wallet" | "error">) {
      db.prepare(
        `INSERT INTO bind_sessions (session_id, player_id, nonce, state, created_at, expires_at)
         VALUES (@session_id, @player_id, @nonce, 'pending', @created_at, @expires_at)`,
      ).run(row);
    },

    getBindSession(sessionId: string): BindSessionRow | undefined {
      return db
        .prepare(`SELECT * FROM bind_sessions WHERE session_id = ?`)
        .get(sessionId) as BindSessionRow | undefined;
    },

    /** Lazily expires a pending session whose deadline passed. */
    freshBindSession(sessionId: string): BindSessionRow | undefined {
      const row = this.getBindSession(sessionId);
      if (row && row.state === "pending" && row.expires_at < now()) {
        db.prepare(`UPDATE bind_sessions SET state = 'expired' WHERE session_id = ?`).run(sessionId);
        row.state = "expired";
      }
      return row;
    },

    markSessionBound(sessionId: string, wallet: string) {
      db.prepare(
        `UPDATE bind_sessions SET state = 'bound', wallet = ? WHERE session_id = ?`,
      ).run(wallet, sessionId);
    },

    // ---- bindings ------------------------------------------------------
    getBindingByPlayer(playerId: string): BindingRow | undefined {
      return db.prepare(`SELECT * FROM bindings WHERE player_id = ?`).get(playerId) as
        | BindingRow
        | undefined;
    },

    getBindingByWallet(wallet: string): BindingRow | undefined {
      return db
        .prepare(`SELECT * FROM bindings WHERE wallet = ? COLLATE NOCASE`)
        .get(wallet) as BindingRow | undefined;
    },

    /**
     * Atomically records playerId ↔ wallet and marks the session bound.
     * The UNIQUE constraints are the final race guard.
     */
    bindWallet(playerId: string, wallet: string, sessionId: string) {
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO bindings (player_id, wallet, bound_at, session_id)
           VALUES (?, ?, ?, ?)`,
        ).run(playerId, wallet, now(), sessionId);
        this.markSessionBound(sessionId, wallet);
      });
      tx();
    },

    // ---- rewards -------------------------------------------------------
    insertRewardIfAbsent(
      row: Omit<
        RewardRow,
        "token_id" | "tx_hash" | "minted_block" | "terminal" | "error" | "updated_at"
      >,
    ) {
      db.prepare(
        `INSERT INTO rewards
           (reward_id, match_id, player_id, slot, skin_def_id, wear, season_id, rarity, name,
            state, request_id, expires_at, created_at, updated_at)
         VALUES
           (@reward_id, @match_id, @player_id, @slot, @skin_def_id, @wear, @season_id, @rarity,
            @name, @state, @request_id, @expires_at, @created_at, @created_at)
         ON CONFLICT(match_id, player_id, slot) DO NOTHING`,
      ).run(row);
    },

    getReward(rewardId: string): RewardRow | undefined {
      return db.prepare(`SELECT * FROM rewards WHERE reward_id = ?`).get(rewardId) as
        | RewardRow
        | undefined;
    },

    /** Finality fallback: the mint block of a token we minted ourselves. */
    getRewardByTokenId(tokenId: string): RewardRow | undefined {
      return db.prepare(`SELECT * FROM rewards WHERE token_id = ?`).get(tokenId) as
        | RewardRow
        | undefined;
    },

    listPendingRewards(playerId: string): RewardRow[] {
      return db
        .prepare(
          `SELECT * FROM rewards
           WHERE player_id = ? AND state != 'confirmed'
           ORDER BY created_at DESC`,
        )
        .all(playerId) as RewardRow[];
    },

    /**
     * Claims the reward for processing only if it is still in a claimable
     * state — the WHERE clause makes concurrent claims race-safe.
     */
    tryMarkProcessing(rewardId: string): boolean {
      const result = db
        .prepare(
          `UPDATE rewards SET state = 'processing', error = NULL, updated_at = ?
           WHERE reward_id = ? AND state IN ('claimable', 'failed') AND terminal = 0`,
        )
        .run(now(), rewardId);
      return result.changes === 1;
    },

    /** Anti-cheat review gate: held → claimable. Returns false if not held. */
    releaseHeldReward(rewardId: string): boolean {
      const result = db
        .prepare(
          `UPDATE rewards SET state = 'claimable', error = NULL, updated_at = ?
           WHERE reward_id = ? AND state = 'held'`,
        )
        .run(now(), rewardId);
      return result.changes === 1;
    },

    /** Anti-cheat review gate: held → terminal failed with a reason code. */
    rejectHeldReward(rewardId: string, reason: string): boolean {
      const result = db
        .prepare(
          `UPDATE rewards SET state = 'failed', terminal = 1, error = ?, updated_at = ?
           WHERE reward_id = ? AND state = 'held'`,
        )
        .run(reason.slice(0, 100), now(), rewardId);
      return result.changes === 1;
    },

    setRewardPendingChain(rewardId: string, txHash: string) {
      db.prepare(
        `UPDATE rewards SET state = 'pending_chain', tx_hash = ?, updated_at = ?
         WHERE reward_id = ?`,
      ).run(txHash, now(), rewardId);
    },

    setRewardConfirmed(
      rewardId: string,
      tokenId: string,
      txHash: string | null,
      mintedBlock: number | null,
    ) {
      db.prepare(
        `UPDATE rewards SET state = 'confirmed', token_id = ?, tx_hash = COALESCE(?, tx_hash),
           minted_block = COALESCE(?, minted_block), error = NULL, updated_at = ?
         WHERE reward_id = ?`,
      ).run(tokenId, txHash, mintedBlock, now(), rewardId);
    },

    setRewardFailed(rewardId: string, error: string) {
      db.prepare(
        `UPDATE rewards SET state = 'failed', error = ?, updated_at = ? WHERE reward_id = ?`,
      ).run(error.slice(0, 500), now(), rewardId);
    },

    // ---- matches -------------------------------------------------------
    insertMatch(row: Pick<MatchRow, "match_id" | "canonical_json" | "result_hash" | "match_id_key">) {
      db.prepare(
        `INSERT INTO matches (match_id, canonical_json, result_hash, match_id_key, created_at)
         VALUES (@match_id, @canonical_json, @result_hash, @match_id_key, @created_at)`,
      ).run({ ...row, created_at: now() });
    },

    getMatch(matchId: string): MatchRow | undefined {
      return db.prepare(`SELECT * FROM matches WHERE match_id = ?`).get(matchId) as
        | MatchRow
        | undefined;
    },

    dueAttestations(limit = 10): MatchRow[] {
      return db
        .prepare(
          `SELECT * FROM matches
           WHERE attest_state = 'pending' AND next_attempt_at <= ?
           ORDER BY created_at ASC LIMIT ?`,
        )
        .all(now(), limit) as MatchRow[];
    },

    recordAttestAttempt(matchId: string, nextAttemptAt: number, error: string | null) {
      db.prepare(
        `UPDATE matches SET attest_attempts = attest_attempts + 1,
           next_attempt_at = ?, attest_error = ?
         WHERE match_id = ?`,
      ).run(nextAttemptAt, error ? error.slice(0, 500) : null, matchId);
    },

    markAttested(matchId: string, txHash: string | null) {
      db.prepare(
        `UPDATE matches SET attest_state = 'attested', attest_tx_hash = COALESCE(?, attest_tx_hash),
           attested_at = ?, attest_error = NULL
         WHERE match_id = ?`,
      ).run(txHash, now(), matchId);
    },

    markAttestFailed(matchId: string, error: string) {
      db.prepare(
        `UPDATE matches SET attest_state = 'failed', attest_error = ? WHERE match_id = ?`,
      ).run(error.slice(0, 500), matchId);
    },

    // ---- loadouts ------------------------------------------------------
    saveLoadout(playerId: string, tokenIds: string[]) {
      db.prepare(
        `INSERT INTO loadouts (player_id, token_ids_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(player_id) DO UPDATE SET token_ids_json = excluded.token_ids_json,
           updated_at = excluded.updated_at`,
      ).run(playerId, JSON.stringify(tokenIds), now());
    },

    getLoadout(playerId: string): LoadoutRow | undefined {
      return db.prepare(`SELECT * FROM loadouts WHERE player_id = ?`).get(playerId) as
        | LoadoutRow
        | undefined;
    },

    // ---- entitlement snapshots ----------------------------------------
    saveSnapshot(row: Omit<SnapshotRow, "created_at">) {
      db.prepare(
        `INSERT INTO entitlement_snapshots (snapshot_id, match_id, player_id, payload_json, created_at)
         VALUES (@snapshot_id, @match_id, @player_id, @payload_json, @created_at)`,
      ).run({ ...row, created_at: now() });
    },

    close() {
      db.close();
    },
  };
}
