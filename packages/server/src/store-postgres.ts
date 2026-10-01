/**
 * The durable store.
 *
 * WHY IT EXISTS, GIVEN THE IN-MEMORY ONE IS THE DEFAULT. ARCHITECTURE §3.6 names
 * a single Postgres table with a JSONB `body`, one row per match. The reason it is
 * worth the code is not "Postgres is nicer" — it is that the in-memory store is
 * correct right up until the process restarts, and PLAN.md §9 risk #5 says a Shasn
 * match is 4–6 hours. A deployment at hour three is not an edge case for this
 * game; it is a Tuesday.
 *
 * WHY IT TAKES AN INJECTED DRIVER INSTEAD OF IMPORTING `pg`. Two reasons, and the
 * second is the important one.
 *
 *  1. The store is the seam that a future swap goes through. Taking a structural
 *     `SqlDriver` rather than a concrete client means swapping `pg` for `postgres`
 *     or a serverless driver is a constructor argument, not a rewrite of every
 *     query — which is the same reason `MatchRunner.dispatch` is the engine's only
 *     seam.
 *
 *  2. A production dependency that cannot be exercised in CI is a dependency that
 *     rots. This file has no way to run a query without a live database, so a
 *     direct `pg` import would be code that is typechecked once and never executed
 *     until the day it matters. The `SqlDriver` shape is small enough to be
 *     obviously correct by inspection, and `test/postgres-store.test.ts` runs it
 *     against a recording driver so the SQL and the row handling are covered.
 *
 * WHY ONE JSONB COLUMN AND NOT A `matches` PLUS A `match_actions` PAIR. §3.6 is
 * right that appending to a JSONB array is a whole-row rewrite, and also right that
 * it does not matter at the write rate involved: ~2 actions per minute against a
 * ~1 MB row, on a table with one row per match. The relational split is a
 * 30-minute change later and is listed in §9.1 as a known follow-up rather than
 * built now, because building it now would mean two things to be right on day one
 * instead of one.
 *
 * THE WRITE PATH IS THE SAME AS THE IN-MEMORY ONE. A whole row is rewritten on
 * every action. That is the cost of the single-row design and it is paid
 * deliberately: there is one code path for the durability story, so there is one
 * thing to be wrong.
 */

import type { GameState, PlayerID } from '@shasn/engine';

import type {
  LoggedAction,
  MatchId,
  MatchStore,
  NewMatch,
  StoredMatch,
  StoredPlayer,
} from './store.ts';
import { cardsVersion, rulesVersion } from './store.ts';

/**
 * The minimum a Postgres client has to do. Structurally typed, so any of `pg`,
 * `postgres`, or a serverless HTTP driver fits.
 */
export type SqlDriver = {
  query<T = unknown>(text: string, params?: readonly unknown[]): Promise<{ readonly rows: readonly T[] }>;
};

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS shasn_match (
  match_id   text PRIMARY KEY,
  body       jsonb NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

-- The resume lookup. Without it, reclaiming a seat after a deploy is a full scan
-- of every match body, which is a table scan of the answer key on the hot path of
-- somebody reconnecting.
--
-- resume_hash is a SHA-256, never a token. A leaked index is not a leaked
-- credential set, and the token is single-use anyway because the server rotates it
-- on every successful resume.
CREATE TABLE IF NOT EXISTS shasn_resume (
  resume_hash text PRIMARY KEY,
  match_id    text NOT NULL REFERENCES shasn_match(match_id) ON DELETE CASCADE,
  player_id   text NOT NULL
);
CREATE INDEX IF NOT EXISTS shasn_resume_match ON shasn_resume(match_id);

-- The action log is inside the body. A separate table is the §9.1 follow-up.
`;

export class PostgresMatchStore implements MatchStore {
  readonly #sql: SqlDriver;

  constructor(sql: SqlDriver) {
    this.#sql = sql;
  }

  async create(match: NewMatch, state: GameState): Promise<void> {
    const body: StoredMatch = {
      matchId: match.matchId,
      seed: match.seed,
      rulesVersion: rulesVersion(match.rules),
      cardsVersion: cardsVersion(match.cards),
      createdAt: match.now,
      updatedAt: match.now,
      players: match.players.map((p) => ({
        id: p.id,
        name: p.name,
        colour: p.colour,
        resumeHash: p.resumeHash,
        lastSeen: match.now,
        abandoned: false,
      })),
      log: [],
      snapshot: { viewId: 0, state },
      snapshotAtSeq: 0,
    };
    await this.#sql.query(
      `INSERT INTO shasn_match (match_id, body, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (match_id) DO NOTHING`,
      [match.matchId, JSON.stringify(body), match.now, match.now],
    );
    for (const p of match.players) {
      if (p.resumeHash === '') continue;
      await this.#sql.query(
        `INSERT INTO shasn_resume (resume_hash, match_id, player_id) VALUES ($1, $2, $3)
         ON CONFLICT (resume_hash) DO NOTHING`,
        [p.resumeHash, match.matchId, p.id],
      );
    }
  }

  async get(matchId: MatchId): Promise<StoredMatch | null> {
    const { rows } = await this.#sql.query<{ body: StoredMatch | string }>(
      `SELECT body FROM shasn_match WHERE match_id = $1`,
      [matchId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    // `jsonb` comes back parsed on most drivers and as a string on some. Accept
    // both rather than making the caller care which driver is wired in.
    return typeof row.body === 'string' ? (JSON.parse(row.body) as StoredMatch) : row.body;
  }

  async list(): Promise<readonly MatchId[]> {
    const { rows } = await this.#sql.query<{ match_id: string }>(
      `SELECT match_id FROM shasn_match ORDER BY updated_at DESC`,
    );
    return rows.map((r) => r.match_id);
  }

  async append(
    matchId: MatchId,
    action: LoggedAction,
    state: GameState,
    viewId: number,
    now: number,
  ): Promise<void> {
    const current = await this.get(matchId);
    if (current === null) return;
    const body: StoredMatch = { ...current, log: [...current.log, action], updatedAt: now };
    const snapshotEvery = 10;
    const next: StoredMatch =
      action.seq % snapshotEvery === 0
        ? { ...body, snapshot: { viewId, state }, snapshotAtSeq: action.seq }
        : body;
    await this.#write(matchId, next);
  }

  async saveSnapshot(matchId: MatchId, viewId: number, state: GameState, now: number): Promise<void> {
    const current = await this.get(matchId);
    if (current === null) return;
    await this.#write(matchId, {
      ...current,
      snapshot: { viewId, state },
      snapshotAtSeq: current.log.length,
      updatedAt: now,
    });
  }

  async updatePlayer(matchId: MatchId, playerId: PlayerID, patch: Partial<StoredPlayer>): Promise<void> {
    const current = await this.get(matchId);
    if (current === null) return;
    const players = current.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p));
    await this.#write(matchId, { ...current, players });
    // The resume index is a derived cache of `players[].resumeHash`, and rotation
    // changes that hash on every resume — so the index row has to move too, or a
    // reconnect after a deploy would not find the seat it just claimed.
    const seat = players.find((p) => p.id === playerId);
    if (seat === undefined) return;
    await this.#sql.query(`DELETE FROM shasn_resume WHERE match_id = $1 AND player_id = $2`, [
      matchId,
      playerId,
    ]);
    if (seat.resumeHash !== '') {
      await this.#sql.query(
        `INSERT INTO shasn_resume (resume_hash, match_id, player_id) VALUES ($1, $2, $3)
         ON CONFLICT (resume_hash) DO NOTHING`,
        [seat.resumeHash, matchId, playerId],
      );
    }
  }

  async findByResumeHash(hash: string): Promise<{ matchId: MatchId; playerId: PlayerID } | null> {
    // The index lookup, not a scan of every match body. A full scan here would read
    // the whole answer key on the hot path of somebody reconnecting.
    const { rows } = await this.#sql.query<{ match_id: string; player_id: string }>(
      `SELECT match_id, player_id FROM shasn_resume WHERE resume_hash = $1`,
      [hash],
    );
    const row = rows[0];
    return row === undefined ? null : { matchId: row.match_id, playerId: row.player_id };
  }

  async remove(matchId: MatchId): Promise<void> {
    await this.#sql.query(`DELETE FROM shasn_match WHERE match_id = $1`, [matchId]);
  }

  async #write(matchId: MatchId, body: StoredMatch): Promise<void> {
    await this.#sql.query(`UPDATE shasn_match SET body = $2::jsonb, updated_at = $3 WHERE match_id = $1`, [
      matchId,
      JSON.stringify(body),
      body.updatedAt,
    ]);
  }
}
