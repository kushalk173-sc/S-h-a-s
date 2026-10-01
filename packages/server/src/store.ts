/**
 * Persistence: the action log is the source of truth, the snapshot is a cache.
 *
 * WHY THIS EXISTS, given PLAN.md §3 said "in-memory first": PLAN.md §9 risk #5
 * says a Shasn match is 4–6 hours. Those two lines contradict each other, and a
 * game that only persists at the end loses four hours on the first deploy. So
 * persistence is not deferred — it is just that the *shape* makes deferral cheap,
 * because the engine is pure and seeded.
 *
 * The shape: persist `(seed, rulesVersion, cardsVersion, ordered action log)`, and
 * rebuild any state by replaying the log through `reduce`. A snapshot is written
 * every N actions purely to bound replay time. If a snapshot is lost, corrupt, or
 * stale, the log still reconstructs the game exactly.
 *
 * THE REASON THE LOG IS SAFE TO KEEP: every action in it is a public intent.
 * `ANSWER` records `{side: 0|1}` and the player it was submitted by, which is the
 * same information the `answered` event already broadcasts. Nothing in this file
 * records a payout or a card identity, so the durable record is not the answer key.
 * A store that had cached full `GameState` snapshots as its *authority* would be
 * one that had; that is precisely why the snapshot is a cache.
 *
 * The in-memory implementation is the default so the server runs with zero setup.
 * `store-postgres.ts` is the durable one behind the same interface.
 */

import { createHash } from 'node:crypto';

import {
  reduce,
  setup,
  type Action,
  type CardID,
  type CardIndex,
  type Ctx,
  type GameState,
  type PlayerID,
  type Rules,
} from '@shasn/engine';

export type MatchId = string;

/** One row per player, for seat and resume bookkeeping. */
export type StoredPlayer = {
  readonly id: PlayerID;
  readonly name: string;
  readonly colour: string;
  /**
   * SHA-256 of the resume token. The token itself is never written to the store:
   * a leaked store is then not a leaked credential. The token is also single-use
   * (it rotates on every successful resume), so this is the *current* token's hash
   * and nothing older will verify.
   */
  readonly resumeHash: string;
  readonly lastSeen: number;
  readonly abandoned: boolean;
};

export type LoggedAction = {
  readonly seq: number;
  readonly playerId: PlayerID;
  readonly action: Action;
};

export type StoredMatch = {
  readonly matchId: MatchId;
  /** The mulberry32 seed. The whole game is in this one integer. */
  readonly seed: number;
  /** Hash of RULES at creation. Replay refuses on mismatch rather than diverging. */
  readonly rulesVersion: string;
  /** Hash of the deck manifest at creation. Same reasoning. */
  readonly cardsVersion: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly players: readonly StoredPlayer[];
  /** Append-only. The audit trail and the replay source. */
  readonly log: readonly LoggedAction[];
  /** A cache to bound replay time. Never the authority. */
  readonly snapshot: { readonly viewId: number; readonly state: GameState } | null;
  readonly snapshotAtSeq: number;
};

export type NewMatch = {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly rules: Rules;
  readonly cards: CardIndex;
  readonly players: readonly { readonly id: PlayerID; readonly name: string; readonly colour: string; readonly resumeHash: string }[];
  readonly now: number;
};

export type MatchStore = {
  create(match: NewMatch, state: GameState): Promise<void>;
  get(matchId: MatchId): Promise<StoredMatch | null>;
  list(): Promise<readonly MatchId[]>;
  /** Append one action. Must be atomic with respect to the log's order. */
  append(matchId: MatchId, action: LoggedAction, state: GameState, viewId: number, now: number): Promise<void>;
  /** Write the replay cache. Purely an optimisation. */
  saveSnapshot(matchId: MatchId, viewId: number, state: GameState, now: number): Promise<void>;
  updatePlayer(matchId: MatchId, playerId: PlayerID, patch: Partial<StoredPlayer>): Promise<void>;
  findByResumeHash(hash: string): Promise<{ matchId: MatchId; playerId: PlayerID } | null>;
  remove(matchId: MatchId): Promise<void>;
};

// ─────────────────────────── replay ───────────────────────────

/**
 * The four deck arrays, read off a `CardIndex`.
 *
 * `setup` takes deck ARRAYS; the reducer takes the index. This is the single place
 * the two meet, so there is exactly one answer to "what was in the draw piles" and
 * it cannot drift between the room that was dealt and the replay that rebuilds it
 * — which is the whole basis of the action log being authoritative.
 *
 * Key order is `Object.keys` order, i.e. file order for the JSON corpus. The seed
 * does the shuffling, so the order here only has to be STABLE: a different but
 * stable order would be equally correct, and an unstable one would silently break
 * replay after a restart.
 */
export function decksOf(cards: CardIndex): {
  ideologyDeck: readonly CardID[];
  voterDeck: readonly CardID[];
  conspiracyDeck: readonly CardID[];
  headlineDeck: readonly CardID[];
} {
  return {
    ideologyDeck: Object.keys(cards.ideology),
    voterDeck: Object.keys(cards.voter),
    conspiracyDeck: Object.keys(cards.conspiracy),
    headlineDeck: Object.keys(cards.headline),
  };
}

/** Content hash of the rule tunables, pinned at match creation. */
export function rulesVersion(rules: Rules): string {
  return sha(JSON.stringify(rules, Object.keys(rules).sort()));
}

/**
 * Content hash of the card corpus, pinned at match creation.
 *
 * Hashes the card BODIES, not just their ids. Ids alone are not enough and the
 * gap is exactly the dangerous one: a balance pass that changes a payout, a
 * copy-edit that changes a question, a rules-lint fix that changes a conspiracy's
 * effects — all of those leave every id untouched, so an id-only hash reports
 * "unchanged" and a replay proceeds under cards that are not the ones the players
 * are halfway through answering.
 *
 * Keys are sorted so the hash does not depend on file order, and each card is
 * stringified whole so no field can be quietly omitted.
 */
export function cardsVersion(cards: CardIndex): string {
  const byId = <T>(xs: Readonly<Record<string, T>>): string =>
    Object.keys(xs)
      .sort()
      .map((id) => `${id}=${JSON.stringify(xs[id])}`)
      .join('|');
  return sha(
    JSON.stringify({
      ideology: byId(cards.ideology),
      voter: byId(cards.voter),
      conspiracy: byId(cards.conspiracy),
      headline: byId(cards.headline),
    }),
  );
}

export function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class ReplayMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayMismatch';
  }
}

export type ReplayInput = {
  readonly stored: StoredMatch;
  readonly ctx: Ctx;
};

/**
 * Rebuild a match from its seed and action log.
 *
 * Two ways to do it, and the order matters:
 *  1. from the snapshot, then replay the tail — bounded work, and correct only if
 *     the snapshot really is the state at `snapshotAtSeq`;
 *  2. from `setup`, then replay everything — always correct, and only `reduce`
 *     calls, which are microseconds.
 *
 * The snapshot is used opportunistically. It is a cache, so it is *verified* by
 * checking the log length it was taken at; if the store ever hands back a snapshot
 * that does not line up, path 1 is skipped rather than trusted.
 *
 * A `rulesVersion` or `cardsVersion` mismatch is a hard error, not a warning. The
 * alternative — silently replaying a match under different rules — produces a game
 * that diverges from the one the players are in the middle of, which is worse than
 * refusing to start.
 */
export function replay(input: ReplayInput): { state: GameState; viewId: number } {
  const { stored, ctx } = input;

  const liveRules = rulesVersion(ctx.rules);
  if (stored.rulesVersion !== liveRules) {
    throw new ReplayMismatch(
      `match ${stored.matchId} was created under a different rule set (stored ${stored.rulesVersion.slice(0, 12)}, now ${liveRules.slice(0, 12)})`,
    );
  }
  const liveCards = cardsVersion(ctx.cards);
  if (stored.cardsVersion !== liveCards) {
    throw new ReplayMismatch(
      `match ${stored.matchId} was created against a different card corpus (stored ${stored.cardsVersion.slice(0, 12)}, now ${liveCards.slice(0, 12)})`,
    );
  }

  const seatIds = stored.players.map((p) => p.id);
  const names: Record<PlayerID, string> = {};
  for (const p of stored.players) names[p.id] = p.name;

  // `viewId` counts committed actions, and the log only ever receives an entry
  // after `reduce` returned ok, so the two are the same number by construction.
  const viewId = stored.log.length;

  // The snapshot is used only if it is a consistent point on this log. It is a
  // cache, so it is checked rather than trusted.
  const snap = stored.snapshot;
  const tail = snap !== null && stored.snapshotAtSeq <= stored.log.length ? stored.snapshotAtSeq : 0;

  let state: GameState =
    tail > 0 && snap !== null
      ? snap.state
      : setup({
          players: seatIds,
          names,
          cards: ctx.cards,
          seed: stored.seed,
          ...decksOf(ctx.cards),
        });

  for (let i = tail; i < stored.log.length; i += 1) {
    const entry = stored.log[i];
    if (entry === undefined) break;
    const r = reduce(state, entry.playerId, entry.action, ctx);
    if (!r.ok) {
      // The log is authoritative and was only ever appended after a successful
      // reduce, so a failure here means the store is corrupt. Refuse loudly: a
      // partially-replayed match is a game nobody is playing any more.
      throw new ReplayMismatch(
        `match ${stored.matchId} failed to replay at seq ${entry.seq}: ${r.error}`,
      );
    }
    state = r.state;
  }

  return { state, viewId };
}

// ─────────────────────── the default: in-memory ───────────────────────

/**
 * The default store. The server runs with no database, no Docker, no env vars.
 *
 * It is a real implementation of the interface, not a stub: the tests exercise the
 * same append/replay path that Postgres will, which is what makes the Postgres
 * implementation a substitution rather than a rewrite.
 */
export class InMemoryMatchStore implements MatchStore {
  readonly #matches = new Map<MatchId, StoredMatch>();

  create(match: NewMatch, state: GameState): Promise<void> {
    this.#matches.set(match.matchId, {
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
    });
    return Promise.resolve();
  }

  get(matchId: MatchId): Promise<StoredMatch | null> {
    return Promise.resolve(this.#matches.get(matchId) ?? null);
  }

  list(): Promise<readonly MatchId[]> {
    return Promise.resolve([...this.#matches.keys()]);
  }

  append(
    matchId: MatchId,
    action: LoggedAction,
    state: GameState,
    viewId: number,
    now: number,
  ): Promise<void> {
    const m = this.#matches.get(matchId);
    if (m === undefined) return Promise.resolve();
    this.#matches.set(matchId, { ...m, log: [...m.log, action], updatedAt: now });
    // Writing a snapshot on every action makes it authoritative-by-accident if a
    // future reader trusts it. `snapshotAtSeq` is what distinguishes "as of seq N".
    if (action.seq % 10 === 0) {
      this.#matches.set(matchId, {
        ...this.#matches.get(matchId)!,
        snapshot: { viewId, state },
        snapshotAtSeq: action.seq,
        updatedAt: now,
      });
    }
    return Promise.resolve();
  }

  saveSnapshot(matchId: MatchId, viewId: number, state: GameState, now: number): Promise<void> {
    const m = this.#matches.get(matchId);
    if (m === undefined) return Promise.resolve();
    this.#matches.set(matchId, {
      ...m,
      snapshot: { viewId, state },
      snapshotAtSeq: m.log.length,
      updatedAt: now,
    });
    return Promise.resolve();
  }

  updatePlayer(matchId: MatchId, playerId: PlayerID, patch: Partial<StoredPlayer>): Promise<void> {
    const m = this.#matches.get(matchId);
    if (m === undefined) return Promise.resolve();
    this.#matches.set(matchId, {
      ...m,
      players: m.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)),
      updatedAt: m.updatedAt,
    });
    return Promise.resolve();
  }

  findByResumeHash(hash: string): Promise<{ matchId: MatchId; playerId: PlayerID } | null> {
    for (const m of this.#matches.values()) {
      for (const p of m.players) {
        if (p.resumeHash === hash) return Promise.resolve({ matchId: m.matchId, playerId: p.id });
      }
    }
    return Promise.resolve(null);
  }

  remove(matchId: MatchId): Promise<void> {
    this.#matches.delete(matchId);
    return Promise.resolve();
  }
}
