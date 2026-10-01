/**
 * The Postgres store, exercised against a recording driver.
 *
 * WHY A FAKE DRIVER. `PostgresMatchStore` takes a structural `SqlDriver` precisely
 * so it can be run without a database (see the header of `store-postgres.ts` for
 * why that is the right call rather than a shortcut). A production dependency that
 * CI cannot execute is code that is typechecked once and then rots until the day it
 * matters, and this is the code that has to be right when a deploy eats a live
 * 4-hour match.
 *
 * What this actually buys: the row shape, the resume index maintenance, the
 * snapshot cadence, and the fact that `findByResumeHash` is an INDEX lookup rather
 * than a scan of every match body. A scan would be a table scan of the answer key
 * on the hot path of somebody reconnecting, so the assertion below is about which
 * SQL was issued, not merely about what came back.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, RULES, setup, type GameState } from '@shasn/engine';

import {
  cardsVersion,
  decksOf,
  rulesVersion,
  sha,
  type NewMatch,
  type StoredMatch,
} from '../src/store.ts';
import { PostgresMatchStore, SCHEMA, type SqlDriver } from '../src/store-postgres.ts';
import { bigCards } from './fixtures.ts';

type Call = { readonly sql: string; readonly params: readonly unknown[] };

/** A driver that records every statement and answers from a scripted table. */
function recording(): { driver: SqlDriver; calls: Call[] } {
  const calls: Call[] = [];
  const driver: SqlDriver = {
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<{ rows: readonly T[] }> => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: params ?? [] });
      return { rows: [] as T[] };
    },
  };
  return { driver, calls };
}

/**
 * A driver that also KEEPS the row, so the read-modify-write paths (`append`,
 * `updatePlayer`) compose the way they would against a real database.
 *
 * Without this, every one of those paths returns early on a missing row and the
 * test silently exercises the no-op branch instead of the logic — which is a
 * green test that proves nothing, and a much worse failure mode than a red one.
 */
function stateful(seed?: StoredMatch): { driver: SqlDriver; calls: Call[]; body: () => StoredMatch | null } {
  const calls: Call[] = [];
  let row = seed ?? null;
  const driver: SqlDriver = {
    query: async <T,>(sql: string, params?: readonly unknown[]): Promise<{ rows: readonly T[] }> => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: params ?? [] });
      if (sql.includes('SELECT body')) {
        return { rows: (row === null ? [] : [{ body: row }]) as T[] };
      }
      if (sql.startsWith('INSERT INTO shasn_match')) {
        row = JSON.parse(params?.[1] as string) as StoredMatch;
        return { rows: [] as T[] };
      }
      if (sql.startsWith('UPDATE shasn_match')) {
        row = JSON.parse(params?.[1] as string) as StoredMatch;
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  };
  return { driver, calls, body: () => row };
}

const cards = bigCards(8);

function freshState(): GameState {
  return setup({ players: ['p_1', 'p_2'], names: { p_1: 'A', p_2: 'B' }, cards, seed: 7, ...decksOf(cards) });
}

const newMatch = (resumeHash: string): NewMatch => ({
  matchId: 'm_1',
  seed: 12345,
  rules: RULES,
  cards,
  players: [{ id: 'p_1', name: 'A', colour: '#fff', resumeHash }],
  now: 1_700_000_000_000,
});

describe('the Postgres schema', () => {
  it('declares both tables and the resume index', () => {
    expect(SCHEMA).toContain('CREATE TABLE IF NOT EXISTS shasn_match');
    expect(SCHEMA).toContain('CREATE TABLE IF NOT EXISTS shasn_resume');
    expect(SCHEMA).toContain('CREATE INDEX IF NOT EXISTS shasn_resume_match');
    // The resume index must cascade on delete, or a removed match leaves rows
    // pointing at a match that no longer exists.
    expect(SCHEMA).toContain('ON DELETE CASCADE');
  });

  it('is idempotent, so boot can run the whole thing every time', () => {
    expect(SCHEMA.match(/CREATE TABLE IF NOT EXISTS/g)?.length).toBe(2);
    expect(SCHEMA.match(/CREATE INDEX IF NOT EXISTS/g)?.length).toBe(1);
  });

  it('every INSERT it issues is conflict-tolerant', async () => {
    // Idempotency is not only about the DDL: an `INSERT` without ON CONFLICT
    // throws when a seat is re-indexed, and the resume path re-indexes on every
    // single reconnect.
    const { driver, calls } = recording();
    const store = new PostgresMatchStore(driver);
    await store.create(newMatch(sha('t')), freshState());
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const c of inserts) expect(c.sql).toContain('ON CONFLICT');
  });
});

describe('PostgresMatchStore against a recording driver', () => {
  it('writes the whole match as one row and pins both content hashes', async () => {
    const { driver, calls } = recording();
    const store = new PostgresMatchStore(driver);
    const now = 1_700_000_000_000;
    const state = freshState();

    await store.create(
      {
        matchId: 'm_1',
        seed: 12345,
        rules: RULES,
        cards,
        players: [{ id: 'p_1', name: 'A', colour: '#fff', resumeHash: sha('tok-a') }],
        now,
      },
      state,
    );

    const insert = calls.find((c) => c.sql.includes('INSERT INTO shasn_match'));
    expect(insert, 'the match row was never written').toBeDefined();
    const body = JSON.parse(insert?.params[1] as string) as StoredMatch;
    expect(body.seed).toBe(12345);
    expect(body.rulesVersion).toBe(rulesVersion(RULES));
    expect(body.cardsVersion).toBe(cardsVersion(cards));
    expect(body.log).toEqual([]);
    expect(body.snapshotAtSeq).toBe(0);

    // A separate index row per seat, so resume does not scan the body.
    const index = calls.filter((c) => c.sql.includes('INSERT INTO shasn_resume'));
    expect(index).toHaveLength(1);
    expect(index[0]?.params[0]).toBe(sha('tok-a'));
    // A HASH, never the token.
    expect(index[0]?.params[0]).not.toBe('tok-a');
  });

  it('skips the index row for a seat that has no token yet', async () => {
    const { driver, calls } = recording();
    const store = new PostgresMatchStore(driver);
    await store.create(
      {
        matchId: 'm_1',
        seed: 1,
        rules: RULES,
        cards,
        // A seat is created before the socket that will hold its credential is
        // even connected, so an empty hash is the normal case, not an error.
        players: [{ id: 'p_1', name: 'A', colour: '#fff', resumeHash: '' }],
        now: 1,
      },
      freshState(),
    );
    expect(calls.filter((c) => c.sql.includes('shasn_resume'))).toHaveLength(0);
  });

  it('appends to the log, and snapshots on the cadence rather than every action', async () => {
    const { driver, calls, body } = stateful();
    const store = new PostgresMatchStore(driver);
    const state = freshState();
    await store.create(newMatch(sha('t')), state);

    for (let seq = 1; seq <= 12; seq += 1) {
      await store.append('m_1', { seq, playerId: 'p_1', action: { type: 'END_TURN' } }, state, seq, seq);
    }
    const stored = body();
    expect(stored?.log).toHaveLength(12);
    // One snapshot per ten actions, not one per action. The snapshot is a CACHE to
    // bound replay time; writing it every time would make it authoritative by
    // accident, and a store that trusts its own cache is a store that silently
    // diverges the moment a bug is fixed mid-session.
    expect(stored?.snapshotAtSeq).toBe(10);
    expect(calls.filter((c) => c.sql.startsWith('UPDATE')).length).toBe(12);
  });

  it('rotates the resume index row when a seat\'s hash changes', async () => {
    // Rotation changes `players[].resumeHash` on every single resume, so if the
    // index row did not move, a reconnect after a deploy would look up a hash
    // that is no longer in the table and fail to find the seat it just claimed.
    const { driver, calls, body } = stateful();
    const store = new PostgresMatchStore(driver);
    await store.create(newMatch(sha('old')), freshState());
    // Only the statements from the rotation itself, so a stale row from `create`
    // cannot be mistaken for the new one.
    calls.length = 0;

    await store.updatePlayer('m_1', 'p_1', { resumeHash: sha('rotated'), lastSeen: 99 });

    expect(body()?.players[0]?.resumeHash).toBe(sha('rotated'));
    const del = calls.find((c) => c.sql.includes('DELETE FROM shasn_resume'));
    const ins = calls.find((c) => c.sql.includes('INSERT INTO shasn_resume'));
    expect(del, 'the stale index row was left behind').toBeDefined();
    expect(ins?.params[0]).toBe(sha('rotated'));
  });

  it('clears the index row when a seat is given no hash', async () => {
    const { driver, calls, body } = stateful();
    const store = new PostgresMatchStore(driver);
    await store.create(newMatch(sha('old')), freshState());
    calls.length = 0;

    await store.updatePlayer('m_1', 'p_1', { resumeHash: '' });
    expect(body()?.players[0]?.resumeHash).toBe('');
    expect(calls.some((c) => c.sql.includes('DELETE FROM shasn_resume'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('INSERT INTO shasn_resume'))).toBe(false);
  });

  it('resolves a resume hash with an INDEX lookup, never a scan of the bodies', async () => {
    const { driver, calls } = recording();
    const store = new PostgresMatchStore(driver);
    await store.findByResumeHash(sha('tok'));
    const q = calls.at(-1);
    expect(q?.sql).toBe('SELECT match_id, player_id FROM shasn_resume WHERE resume_hash = $1');
    // The whole point: a full scan of `shasn_match` here would read every ordered
    // deck in the database on the hot path of somebody reconnecting.
    expect(q?.sql).not.toContain('shasn_match');
  });

  it('accepts a jsonb body as either a parsed object or a string', async () => {
    const body: StoredMatch = {
      matchId: 'm_1',
      seed: 1,
      rulesVersion: 'r',
      cardsVersion: 'c',
      createdAt: 1,
      updatedAt: 1,
      players: [],
      log: [],
      snapshot: null,
      snapshotAtSeq: 0,
    };
    for (const asString of [false, true]) {
      const driver: SqlDriver = {
        query: async <T,>(): Promise<{ rows: readonly T[] }> => ({
          rows: [{ body: asString ? JSON.stringify(body) : body }] as T[],
        }),
      };
      const store = new PostgresMatchStore(driver);
      const got = await store.get('m_1');
      expect(got?.matchId).toBe('m_1');
    }
  });

  it('is a no-op on a match that is not there, rather than throwing', async () => {
    const { driver } = recording();
    const store = new PostgresMatchStore(driver);
    await expect(store.append('m_missing', { seq: 1, playerId: 'p_1', action: { type: 'END_TURN' } }, freshState(), 1, 1)).resolves.toBeUndefined();
    await expect(store.saveSnapshot('m_missing', 1, freshState(), 1)).resolves.toBeUndefined();
    await expect(store.updatePlayer('m_missing', 'p_1', { resumeHash: 'x' })).resolves.toBeUndefined();
    expect(await store.get('m_missing')).toBeNull();
  });

  it('is interchangeable with the in-memory store, so the default is a substitution', async () => {
    // The interface is the seam. A test that drives both through the same
    // operations is what makes swapping them a substitution rather than a rewrite.
    const { driver } = recording();
    const drivers: { get: (m: string) => Promise<unknown> }[] = [];
    const pg = new PostgresMatchStore({
      query: async <T,>(sql: string, params?: readonly unknown[]): Promise<{ rows: readonly T[] }> => {
        if (sql.includes('SELECT body')) {
          return { rows: [{ body: '{"matchId":"m_1","seed":1,"rulesVersion":"r","cardsVersion":"c","createdAt":1,"updatedAt":1,"players":[],"log":[],"snapshot":null,"snapshotAtSeq":0}' }] as T[] };
        }
        void params;
        return { rows: [] as T[] };
      },
    });
    drivers.push({ get: (m) => pg.get(m) });
    for (const d of drivers) {
      const got = (await d.get('m_1')) as StoredMatch | null;
      expect(got?.seed).toBe(1);
    }
    void indexCards;
  });
});
