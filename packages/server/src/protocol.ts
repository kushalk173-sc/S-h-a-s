/**
 * The wire protocol.
 *
 * Client and server agree on this file. The client keeps a type-only mirror at
 * `packages/client/src/net/protocol.ts`; `test/protocol-parity.test.ts` asserts the
 * two are mutually assignable, so a field added on one side without the other is a
 * compile error rather than a silently dropped state message.
 *
 * DESIGN RULE, from docs/ARCHITECTURE.md §3.3: the protocol has no richer
 * vocabulary than the rules. There is no `match:setState`, no `match:cheat`, no
 * admin message. The only way to change a match is `match:action`, and its payload
 * is exactly the engine's `Action` union. A patched client can send an action the
 * reducer rejects, and nothing else.
 *
 * Everything crossing this boundary is a plain JSON value. No functions, no class
 * instances, no `undefined`-valued keys — `exactOptionalPropertyTypes` is on and
 * the client will not survive an `undefined` where an absent key was meant.
 */

import type { Action, GameEvent, LogEntry, PlayerID } from '@shasn/engine';
import type { ClientState } from '@shasn/engine';

export type MatchId = string;
export type LobbyId = string;
export type SeatId = string;

/**
 * The resume credential. Issued on every successful connect or reconnect and
 * rotated on every use, so a leaked token is single-use.
 */
export type Session = {
  readonly sessionId: string;
  readonly resumeToken: string;
  /** Opaque and server-assigned. Never a name, never a seat index. */
  readonly playerId: PlayerID;
  readonly matchId: MatchId | null;
  readonly lobbyId: LobbyId | null;
  readonly role: 'player' | 'spectator';
  readonly name: string;
};

// ─────────────────────────── client → server ───────────────────────────

export type ClientMessage =
  /** Liveness. Answered with `pong` carrying the echoed nonce. */
  | { readonly t: 'ping'; readonly nonce?: string }
  /** Ask for the public room list. */
  | { readonly t: 'lobby:list' }
  | { readonly t: 'lobby:create'; readonly name: string; readonly maxPlayers: SeatCount; readonly isPrivate: boolean }
  | { readonly t: 'lobby:join'; readonly lobbyId: LobbyId; readonly name: string }
  | { readonly t: 'lobby:leave' }
  | { readonly t: 'lobby:ready'; readonly ready: boolean }
  | { readonly t: 'lobby:start' }
  | { readonly t: 'lobby:spectate'; readonly lobbyId: LobbyId }
  /**
   * The only write door. `action` is the engine's `Action` union verbatim, so
   * there is no second action vocabulary to keep in sync — and no richer one.
   */
  | { readonly t: 'match:action'; readonly action: Action }
  /** Ask for a fresh full `ClientState`. Always a full state, never a delta. */
  | { readonly t: 'match:sync' }
  /** Reclaim a seat after a refresh, a deploy, or a two-hour absence. */
  | { readonly t: 'session:resume'; readonly resumeToken: string }
  /** Attach to a running match as a spectator. Read-only, forever. */
  | { readonly t: 'match:spectate'; readonly matchId: MatchId };

export type SeatCount = 2 | 3 | 4 | 5;

/** Correlates a request with the error it caused. Echoed on `error`. */
export type CorrelationId = string;

// ─────────────────────────── server → client ───────────────────────────

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'TOO_LARGE'
  | 'RATE_LIMITED'
  | 'NOT_IN_LOBBY'
  | 'NOT_HOST'
  | 'LOBBY_FULL'
  | 'LOBBY_CLOSED'
  | 'SEAT_TAKEN'
  | 'NOT_A_PLAYER'
  | 'MATCH_NOT_FOUND'
  | 'RESUME_INVALID'
  | 'ILLEGAL_ACTION'
  | 'INTERNAL';

export type ServerMessage =
  | { readonly t: 'pong'; readonly nonce: string }
  /**
   * Issued on connect and on every successful resume. Carries the token the
   * client must present to reclaim its seat. The ONLY message that does.
   */
  | { readonly t: 'session:granted'; readonly session: Session }
  | { readonly t: 'session:ended'; readonly reason: string }

  | { readonly t: 'lobby:list'; readonly lobbies: readonly LobbySummary[] }
  | { readonly t: 'lobby:state'; readonly lobby: Lobby }

  /**
   * THE ONLY MESSAGE THAT CARRIES GAME STATE.
   *
   * `state` came out of `viewFor`, and `blind` out of `blindPromptFor`. Neither
   * admits a card payout, a card id, an Ideologue, or a PRNG cursor. `blind` is
   * populated only for the player who is actually answering.
   *
   * ONE FIELD IS UNDER-DECLARED, AND IT IS DELIBERATE. `viewFor` returns a
   * `PublicView` — `ClientState` plus `playableConspiracies`, the viewer's own
   * legally-playable Conspiracy Cards by id, name and printed text. Every id in it
   * is an id that viewer already owns, so it reveals nothing about anyone else, and
   * it is empty at every moment the viewer could not play one anyway; see
   * `broadcast.ts` for the full argument and `secret-state.test.ts` for the gates.
   *
   * It rides inside `state` rather than beside it for one reason: the client's
   * `net/store.ts` adopts `msg.state` wholesale and passes no other envelope field
   * through, so a sibling field would have to be threaded through a module this
   * change does not own. `PublicView` is assignable to `ClientState`, which is what
   * keeps protocol parity in both directions, and the client's
   * `app/GameScreen.tsx` reads it through a narrow cast that fails closed.
   *
   * `order` is a seed-derived coin flip deciding which side of the card renders
   * first. Without it, "the left one" is a channel: a card's two sides belong to
   * different Ideologues and the answer pool is not balanced side-to-side, so a
   * fixed order lets a player learn the slot instead of deliberating.
   */
  | {
      readonly t: 'match:state';
      readonly matchId: MatchId;
      readonly viewId: number;
      readonly state: ClientState;
      readonly blind: BlindPrompt | null;
      readonly you: {
        readonly role: 'player' | 'spectator';
        readonly playerId: PlayerID | null;
      };
    }
  /**
   * Per-recipient events, tagged with the same `viewId` as the `match:state` they
   * belong to. `GameEvent` is public by design — `answered` carries `{player,
   * cardId, side}` for an *already answered* card, not the payout.
   */
  | { readonly t: 'match:events'; readonly matchId: MatchId; readonly viewId: number; readonly events: readonly GameEvent[] }
  | { readonly t: 'match:log'; readonly matchId: MatchId; readonly entries: readonly LogEntry[] }
  | { readonly t: 'match:over'; readonly matchId: MatchId; readonly winners: readonly PlayerID[] }
  | { readonly t: 'error'; readonly id?: string; readonly code: ErrorCode; readonly message: string };

/**
 * The blind prompt. Its type is the security control: there is no `Delta`, no
 * `Ideologue`, no `CardID`, no `campaign`, and no numeric payout field, so there
 * is nothing for a later refactor to accidentally bind into the DOM.
 *
 * `labels` are in DISPLAY order. `labels[0]` is what the player sees first, and
 * `order` says which side of the underlying card that is. The client sends the
 * index it clicked; the server maps it back through `order` before the reducer
 * ever sees the action. The order is derived on the server from the match seed —
 * never from a value the client can see, or a patched client just overrides it.
 */
export type BlindPrompt = {
  readonly question: string;
  readonly labels: readonly [string, string];
  /** 'ab' — labels[0] is side 0. 'ba' — labels[0] is side 1. */
  readonly order: 'ab' | 'ba';
};

export type LobbySeat = {
  readonly seatId: SeatId;
  readonly playerId: PlayerID;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  /** True when this seat belongs to the socket that received this message. */
  readonly you: boolean;
};

export type Lobby = {
  readonly lobbyId: LobbyId;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly hostId: PlayerID;
  readonly maxPlayers: SeatCount;
  readonly seats: readonly LobbySeat[];
  readonly matchId: MatchId | null;
};

export type LobbySummary = {
  readonly lobbyId: LobbyId;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly seated: number;
  readonly maxPlayers: SeatCount;
  readonly inProgress: boolean;
};
