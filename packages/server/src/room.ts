/**
 * One match. Owns the `GameState`, the action log, and the connections watching it.
 *
 * THE SEAM. `room.dispatch(playerId, action)` is the entire interface to the
 * engine, in both directions. Swapping the transport later touches the protocol
 * handler and nothing else. Three rules hold here, and each is worth stating
 * because breaking one is how a second rule implementation gets born:
 *
 *  1. THE SERVER NEVER RE-IMPLEMENTS A RULE. Turn order, phase legality, costs and
 *     caps are the reducer's business. The only server-side rejections are "you are
 *     not in this match", "that is not your seat", "the message was malformed", and
 *     the answer-prompt remap, which is a presentation concern rather than a rule.
 *     Every other refusal is `Result.error` forwarded verbatim. The cost is that a
 *     determined client can fuzz engine internals out of error strings; the
 *     benefit is that there is exactly one implementation of Shasn.
 *
 *  2. THERE IS NO INTERRUPT FRAMEWORK. `PendingChoice` is the engine's existing
 *     general channel for a decision it owes someone, and `reduce` already encodes
 *     the two out-of-turn exceptions. This file does not track whose turn it is,
 *     keep a pending-interrupt queue, or hold a timer. A second notion of "whose
 *     turn is it" would be a second authority, which is the failure mode that
 *     shows up in hour three of a four-hour session.
 *
 *  3. `dispatch` is synchronous end to end. The engine is pure and synchronous and
 *     the process is single-threaded, so a dispatch is atomic with respect to every
 *     other dispatch in this room. No mutex, no queue, no optimistic version
 *     counter is needed for correctness. The store write is fire-and-forget so a
 *     slow database cannot stall an answer.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { reduce, type Action, type Ctx, type GameEvent, type GameState, type PlayerID, type Result } from '@shasn/engine';

import { answerSideFor, answerPromptFor, viewFor } from './broadcast.ts';
import type { AnswerPrompt } from './protocol.ts';
import {
  cardsVersion,
  rulesVersion,
  sha,
  type LoggedAction,
  type MatchId,
  type MatchStore,
  type StoredMatch,
} from './store.ts';

export type RoomErrorCode = 'MATCH_NOT_FOUND' | 'NOT_A_PLAYER';

export class RoomError extends Error {
  constructor(
    readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}

export type Seat = {
  readonly playerId: PlayerID;
  readonly name: string;
  readonly colour: string;
  /** SHA-256 of the CURRENT resume token. The token rotates on every resume. */
  resumeHash: string;
  connected: boolean;
  lastSeen: number;
  ready: boolean;
};

export type RoomOptions = {
  readonly matchId: MatchId;
  readonly ctx: Ctx;
  readonly store: MatchStore;
  readonly seed: number;
  readonly state: GameState;
  readonly seats: readonly Seat[];
  readonly now: number;
  /** Snapshot cadence in actions. Bounds worst-case replay cost. */
  readonly snapshotEvery?: number;
  /** How long a disconnected seat is held before it is released. */
  readonly graceMs?: number;
};

/** Everything one viewer receives, already projected. */
export type ViewerView = {
  readonly viewer: PlayerID | null;
  readonly viewId: number;
  readonly state: ReturnType<typeof viewFor>;
  readonly answer: AnswerPrompt | null;
};

/**
 * Called after every committed action, and on connect / resume / sync.
 *
 * The events ride along rather than being looked up, because a subscriber that
 * has to ask the room what just happened will eventually get the answer at the
 * wrong `viewId` and the client will drop or duplicate an animation.
 */
export type Broadcast = (view: ViewerView, events: readonly GameEvent[]) => void;

export const SNAPSHOT_EVERY = 10;
/** A 4–6 hour match has to survive a deploy, so seats are held generously. */
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

export class Room {
  readonly matchId: MatchId;
  readonly ctx: Ctx;
  readonly seed: number;
  readonly createdAt: number;

  #store: MatchStore;
  #state: GameState;
  #viewId: number;
  #seq: number;
  readonly #seats: Map<PlayerID, Seat>;
  readonly #order: readonly PlayerID[];
  readonly #snapshotEvery: number;
  readonly #graceMs: number;
  readonly #listeners = new Set<Broadcast>();

  constructor(opts: RoomOptions) {
    this.matchId = opts.matchId;
    this.ctx = opts.ctx;
    this.seed = opts.seed;
    this.#store = opts.store;
    this.#state = opts.state;
    this.#viewId = 0;
    this.#seq = 0;
    this.createdAt = opts.now;
    this.#snapshotEvery = opts.snapshotEvery ?? SNAPSHOT_EVERY;
    this.#graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
    this.#seats = new Map(opts.seats.map((s) => [s.playerId, { ...s }]));
    this.#order = Object.freeze(opts.seats.map((s) => s.playerId));
  }

  /**
   * Rebuild a room from the durable store after a restart.
   *
   * This is the whole of "survive a deploy": the action log is the authority and
   * replaying it reproduces the table exactly, including which card is face down
   * in front of whom and what phase everyone is in. `viewId` comes out of the
   * replay rather than being invented, so a client holding a `viewId` from before
   * the restart can still tell whether it is behind.
   */
  static async restore(
    opts: Omit<RoomOptions, 'state' | 'seed' | 'seats' | 'now'> & {
      stored: StoredMatch;
    },
  ): Promise<Room> {
    const { replay } = await import('./store.ts');
    const stored = opts.stored;
    const rebuilt = replay({ stored, ctx: opts.ctx });
    const room = new Room({
      matchId: opts.matchId,
      ctx: opts.ctx,
      store: opts.store,
      seed: stored.seed,
      state: rebuilt.state,
      now: stored.createdAt,
      ...(opts.snapshotEvery === undefined ? {} : { snapshotEvery: opts.snapshotEvery }),
      ...(opts.graceMs === undefined ? {} : { graceMs: opts.graceMs }),
      seats: stored.players.map((p) => ({
        playerId: p.id,
        name: p.name,
        colour: p.colour,
        resumeHash: p.resumeHash,
        connected: false,
        lastSeen: p.lastSeen,
        ready: true,
      })),
    });
    room.#viewId = rebuilt.viewId;
    room.#seq = stored.log.length;
    return room;
  }

  get state(): GameState {
    return this.#state;
  }

  get viewId(): number {
    return this.#viewId;
  }

  get seats(): readonly Seat[] {
    return this.#order.flatMap((id) => {
      const s = this.#seats.get(id);
      return s === undefined ? [] : [s];
    });
  }

  get seatOrder(): readonly PlayerID[] {
    return this.#order;
  }

  get graceMs(): number {
    return this.#graceMs;
  }

  onBroadcast(fn: Broadcast): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  // ─────────────────────── the projection, per viewer ───────────────────────

  /**
   * The full client payload for one viewer.
   *
   * The structural leak test walks exactly this path, not `playerView` in
   * isolation: a test that only walked the engine's projection would pass while
   * the server shipped something else.
   */
  viewFor(viewer: PlayerID | null): ViewerView {
    return {
      viewer,
      viewId: this.#viewId,
      state: viewFor(this.#state, this.ctx.cards, viewer),
      answer: viewer === null ? null : answerPromptFor(this.#state, this.ctx.cards, viewer),
    };
  }

  // ─────────────────────────── the write door ───────────────────────────

  /**
   * The engine-facing action, after the answer-prompt remap.
   *
   * The client sends the DISPLAY position it was shown, because that is all it
   * was shown. `reduce` is written against the card's own `sides` tuple, so the
   * translation happens here — and it happens here rather than in the handler
   * because it is a secret-state question, and those live in `broadcast.ts`.
   */
  #toEngineAction(playerId: PlayerID, action: Action): Action {
    if (action.type !== 'ANSWER') return action;
    const real = answerSideFor(this.#state, this.ctx.cards, playerId, action.side);
    if (real === null) return action;
    return { type: 'ANSWER', side: real };
  }

  /**
   * Apply one action. Synchronous end to end.
   *
   * On success: commit, log, enqueue the snapshot write, push a fresh projection
   * to every subscriber. On failure: nothing changes and the engine's error string
   * comes back verbatim. A rejected action produces no state message at all, so
   * there is nothing for a client to roll back — the client never applied it.
   */
  dispatch(playerId: PlayerID, action: Action, now: number): Result {
    const seat = this.#seats.get(playerId);
    if (seat === undefined) {
      throw new RoomError('NOT_A_PLAYER', 'you are not seated at this table');
    }

    const engineAction = this.#toEngineAction(playerId, action);
    const result = reduce(this.#state, playerId, engineAction, this.ctx);
    if (!result.ok) return result;

    this.#state = result.state;
    this.#viewId += 1;
    this.#seq += 1;
    seat.lastSeen = now;

    // The log records the ENGINE-FACING action, not what the client sent.
    //
    // This is the difference between a working replay and a broken one. An ANSWER
    // arrives as a DISPLAY index and is remapped above; logging the display index
    // would mean a replay applied `sides[0]` to a card whose first-rendered side
    // was `sides[1]`, so a restarted server would silently hand a player a
    // different payout for the same click. Caught by a byte-identity test on
    // `JSON.stringify(state)` after replay, which is exactly the sort of bug that
    // no unit test on the reducer would ever see.
    //
    // Not a secret: `answered` already broadcasts `{cardId, side}` to every client
    // for an answered card, so the side index is public by the time it is logged.
    const entry: LoggedAction = { seq: this.#seq, playerId, action: engineAction };
    // Fire and forget, deliberately. A store hiccup must not stall the answer
    // that just landed; the write is durable-by-append and replay repairs a gap.
    void this.#store
      .append(this.matchId, entry, this.#state, this.#viewId, now)
      .catch(() => undefined);
    if (this.#seq % this.#snapshotEvery === 0) {
      void this.#store.saveSnapshot(this.matchId, this.#viewId, this.#state, now).catch(() => undefined);
    }

    this.#publish(result.events);
    return result;
  }

  #publish(events: readonly GameEvent[]): void {
    for (const fn of this.#listeners) {
      try {
        fn(this.viewFor(null), events);
      } catch {
        // One bad subscriber must not take the table with it.
      }
    }
  }

  /** Push the current projection to every subscriber. Connect / resume / sync. */
  refresh(): void {
    this.#publish([]);
  }

  // ─────────────────────────── seats and resume ───────────────────────────

  setConnected(playerId: PlayerID, connected: boolean, now: number): void {
    const seat = this.#seats.get(playerId);
    if (seat === undefined) return;
    seat.connected = connected;
    if (connected) seat.lastSeen = now;
  }

  setReady(playerId: PlayerID, ready: boolean): void {
    const seat = this.#seats.get(playerId);
    if (seat === undefined) return;
    seat.ready = ready;
  }

  /** Mint and install a fresh token. Whatever was there stops working now. */
  issueToken(playerId: PlayerID): string {
    const token = newToken();
    const seat = this.#seats.get(playerId);
    if (seat !== undefined) seat.resumeHash = hashToken(token);
    return token;
  }

  /** Install a token hash the session store already minted. */
  setTokenHash(playerId: PlayerID, hash: string): void {
    const seat = this.#seats.get(playerId);
    if (seat !== undefined) seat.resumeHash = hash;
  }

  /**
   * Constant-time comparison against the stored hash.
   *
   * Timing-safe is not paranoia here: a match id and a seat id are both in the
   * lobby snapshot, so an attacker already knows the candidate set and only needs
   * the timing to break one hash.
   */
  verifyToken(playerId: PlayerID, token: string): boolean {
    const seat = this.#seats.get(playerId);
    if (seat === undefined || seat.resumeHash === '') return false;
    const stored = Buffer.from(seat.resumeHash, 'hex');
    const given = Buffer.from(hashToken(token), 'hex');
    if (stored.length !== given.length || stored.length === 0) return false;
    return timingSafeEqual(stored, given);
  }

  /** Has every seat been gone for longer than the grace window? */
  allSeatsExpired(now: number): boolean {
    const seats = this.seats;
    if (seats.length === 0) return true;
    return seats.every((s) => !s.connected && now - s.lastSeen > this.#graceMs);
  }

  has(playerId: PlayerID): boolean {
    return this.#seats.has(playerId);
  }

  seat(playerId: PlayerID): Seat | undefined {
    return this.#seats.get(playerId);
  }

  /** Write current seat bookkeeping (token hashes, liveness) to the store. */
  async persistSeats(): Promise<void> {
    for (const s of this.#seats.values()) {
      await this.#store.updatePlayer(this.matchId, s.playerId, {
        resumeHash: s.resumeHash,
        lastSeen: s.lastSeen,
      });
    }
  }

  versions(): { readonly rules: string; readonly cards: string } {
    return { rules: rulesVersion(this.ctx.rules), cards: cardsVersion(this.ctx.cards) };
  }

  /** Serialise a socket, the only way out of this class. */
  encode(value: unknown): string {
    return JSON.stringify(value);
  }
}

// ─────────────────────────── tokens and ids ───────────────────────────

/**
 * 256 bits of `crypto.randomBytes`. A match id or a seat index is not a
 * credential: anyone who learns a match id must not thereby be able to take a seat.
 *
 * `node:crypto` rather than a UUID library, deliberately: the token is 32 bytes of
 * entropy, and `crypto.randomUUID` is already in the platform, so a dependency
 * would buy nothing. UUID v4 is 122 bits and is not what a resume credential wants.
 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return sha(token);
}

export function newId(prefix: string, bytes = 12): string {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

export function newPlayerId(): string {
  return newId('p', 9);
}
