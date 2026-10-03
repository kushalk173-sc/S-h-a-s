/**
 * The client store: a fold over the message stream, and nothing else.
 *
 * WHY IT IS HAND-WRITTEN. Not Redux, not Zustand, not Jotand, not TanStack Query.
 * One `useSyncExternalStore` over a plain module-level object, three mutators, no
 * reducer, no middleware, no thunks. The reason is structural rather than
 * aesthetic: the "no optimistic state" rule is a load-bearing property of a game
 * whose central mechanic is hidden information, and it is only really enforced if
 * there is no `dispatch(action)` in the client for a future contributor to
 * optimistically mutate. A bespoke store of ~150 lines is a library's worth of
 * code, and what it buys is that the rule survives the team.
 *
 * THE THREE MUTATORS, AND WHY THERE IS NO FOURTH:
 *
 *   applyState   commit a full ClientState, replacing the old one wholesale
 *   applyEvents  buffer events until the state they belong to has landed
 *   clearBlind   drop the prompt the instant it is no longer this player's turn
 *
 * `match:state` and `match:events` are produced by one `reduce` call and must be
 * delivered atomically per recipient, or the client briefly renders a state whose
 * events it has not seen. They are separate messages sharing a `viewId`, so
 * `applyEvents` buffers and `applyState` flushes. Twenty lines of explicit
 * ordering beats the alternative, which was one message carrying both — a full
 * state on every action, ~150 MB per 4-hour match.
 *
 * `clearBlind` is the third mutator and it is the one that matters most. The
 * prompt is dropped the instant `phase !== 'answer'` or `activePlayer !== me`.
 * There is deliberately no "what did I pick?" history, no ref retaining the
 * question, and nothing written to `sessionStorage`: the log records the chosen
 * answer, which is what players actually remember from a physical game anyway.
 */

import type { ClientState, GameEvent, PlayerID } from '@shasn/engine';

import type { AnswerPrompt, Lobby, LobbySummary, ServerMessage, Session } from './protocol.ts';

export type Phase = 'offline' | 'connecting' | 'lobby' | 'match';

export type PendingError = {
  readonly code: ServerMessage extends { t: 'error'; code: infer C } ? C : string;
  readonly message: string;
  /** Monotonic, so a repeated identical error still re-renders a toast. */
  readonly at: number;
};

export type ClientStore = {
  readonly phase: Phase;
  readonly session: Session | null;
  readonly lobbies: readonly LobbySummary[];
  readonly lobby: Lobby | null;
  readonly matchId: string | null;
  /** Folded from `match:state`. Replaced wholesale, never patched. */
  readonly state: ClientState | null;
  readonly viewId: number;
  /** Buffered until the matching `match:state` lands. */
  readonly pendingEvents: readonly { readonly viewId: number; readonly events: readonly GameEvent[] }[];
  readonly recentEvents: readonly GameEvent[];
  /**
   * From the server: the whole card, plus the `order` draw. Cleared the moment it is
   * not this player's turn to answer it.
   *
   * NOTE WHAT IS NOT HERE ANY MORE. This used to be described as the private half of a
   * blind answer, and the card content in it was withheld from the table. Under full
   * information `state.openQuestion` carries the identical card to every seat, so the
   * only thing stored here that is not already public is `order` — and it is stored for
   * the same reason as before, which is not secrecy: a client must not keep rendering a
   * card the player is no longer being asked about.
   */
  readonly answer: AnswerPrompt | null;
  readonly error: PendingError | null;
  readonly you: { readonly role: 'player' | 'spectator'; readonly playerId: PlayerID | null };
};

const INITIAL: ClientStore = {
  phase: 'offline',
  session: null,
  lobbies: [],
  lobby: null,
  matchId: null,
  state: null,
  viewId: 0,
  pendingEvents: [],
  recentEvents: [],
  answer: null,
  error: null,
  you: { role: 'spectator', playerId: null },
};

let store: ClientStore = INITIAL;
const listeners = new Set<() => void>();
let errSeq = 0;

function emit(): void {
  for (const fn of listeners) fn();
}

function set(patch: Partial<ClientStore>): void {
  store = { ...store, ...patch };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getStore(): ClientStore {
  return store;
}

/** For tests and for a hard "start over" without a page reload. */
export function resetStore(): void {
  store = INITIAL;
  errSeq = 0;
  emit();
}

// ─────────────────────────── the three mutators ───────────────────────────

/**
 * Commit a full state. Replaces, never merges.
 *
 * The flush of buffered events is part of this function rather than a separate
 * step, because "state and its events are delivered together" is the invariant and
 * the only place that can enforce it is the place that knows both arrived.
 */
export function applyState(msg: {
  readonly matchId: string;
  readonly viewId: number;
  readonly state: ClientState;
  readonly answer: AnswerPrompt | null;
  readonly you: { readonly role: 'player' | 'spectator'; readonly playerId: PlayerID | null };
}): void {
  const flushable = store.pendingEvents.filter((e) => e.viewId <= msg.viewId);
  const stillWaiting = store.pendingEvents.filter((e) => e.viewId > msg.viewId);
  const recent = flushable.flatMap((e) => e.events).slice(-200);

  const mine = msg.you.playerId;
  const owed =
    msg.answer !== null &&
    msg.state.phase === 'answer' &&
    msg.state.activePlayer === mine &&
    msg.you.role === 'player';

  set({
    phase: 'match',
    matchId: msg.matchId,
    viewId: msg.viewId,
    state: msg.state,
    you: msg.you,
    // The prompt is not stored because the server said so; it is stored because it
    // is still this player's to answer. Anything else and the UI would be showing
    // a question the player is no longer being asked, which is a UX bug and the
    // one thing this field is still gatekeeping: the stale `order` draw.
    answer: owed ? msg.answer : null,
    pendingEvents: stillWaiting,
    recentEvents: [...store.recentEvents, ...recent].slice(-200),
  });
}

export function applyEvents(viewId: number, events: readonly GameEvent[]): void {
  if (viewId <= store.viewId) {
    // Already covered by a state we hold. Dropping rather than appending is what
    // makes a reconnect idempotent: the same `viewId` can arrive twice, and
    // appending it twice would double every animation.
    return;
  }
  if (viewId === store.viewId + 1 && store.state !== null && store.pendingEvents.length === 0) {
    // In order and nothing outstanding: safe to apply straight away, which is the
    // common case and the one that must not need a state message to be legible.
    set({ recentEvents: [...store.recentEvents, ...events].slice(-200) });
    return;
  }
  set({ pendingEvents: [...store.pendingEvents, { viewId, events }] });
}

/**
 * Drop the prompt.
 *
 * Called on `phase`/`activePlayer` change and on `session:ended`. The engine's
 * `answered` event is public, so `recentEvents` keeps the record of what was
 * chosen — what it must never keep is the QUESTION or the two labels of a card
 * that is still face down, and it does not.
 */
export function clearAnswer(): void {
  if (store.answer === null) return;
  set({ answer: null });
}

export function applyServerMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case 'pong':
      return;
    case 'session:granted':
      set({ session: msg.session, error: null });
      return;
    case 'session:ended':
      // The credential is gone. Everything derived from it is meaningless now, and
      // leaving a stale ClientState on screen would be a state the player believes
      // but is not.
      set({ session: null, matchId: null, state: null, answer: null, phase: 'offline', viewId: 0 });
      return;
    case 'lobby:list':
      set({ lobbies: msg.lobbies });
      return;
    case 'lobby:state':
      set({ lobby: msg.lobby, phase: 'lobby' });
      return;
    case 'match:state':
      applyState(msg);
      return;
    case 'match:events':
      applyEvents(msg.viewId, msg.events);
      return;
    case 'match:log':
    case 'match:over':
      return;
    case 'error':
      errSeq += 1;
      set({ error: { code: msg.code, message: msg.message, at: errSeq } });
      return;
    default: {
      // Exhaustiveness. A new message type that carries state must be handled here
      // or it will be silently dropped — and "silently dropped" is how a client
      // ends up rendering a board that is one ply behind with no error anywhere.
      const never: never = msg;
      void never;
    }
  }
}

export function setPhase(phase: Phase): void {
  set({ phase });
}

export function clearError(): void {
  set({ error: null });
}

// ─────────────────────────── selectors ───────────────────────────

/**
 * Components subscribe to PRIMITIVES through `useSyncExternalStore`, so one peg
 * changing does not re-render the 129-slot board. This is the only selector layer;
 * there is no memoisation library because there is nothing to memoise.
 */
export function select<T>(sel: (s: ClientStore) => T): T {
  return sel(store);
}

export function myId(): PlayerID | null {
  return store.you.playerId;
}

export function isMyTurn(): boolean {
  if (store.state === null) return false;
  return store.you.role === 'player' && store.state.activePlayer === store.you.playerId;
}

export function awaitingMyAnswer(): boolean {
  if (store.state === null) return false;
  return isMyTurn() && store.state.phase === 'answer' && store.answer !== null;
}

/** Decisions the engine owes THIS player. The engine's out-of-turn channel. */
export function myChoices() {
  const s = store.state;
  const me = store.you.playerId;
  if (s === null || me === null) return [];
  return s.choices.filter((c) => c.player === me);
}

export function amSeated(): boolean {
  return store.you.role === 'player' && store.you.playerId !== null;
}
