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
   * `state` came out of `viewFor` and `answer` out of `answerPromptFor`, and under
   * full information BOTH carry the whole card — question, both answers, both
   * Ideologues, both payouts. The Ideology corpus is public JSON in this repository,
   * so a card's payout was always one lookup away; what is deliberately NOT here is a
   * card id, and `answer` alone carries the `order` draw. Both of those rulings, and
   * what they cost, are argued on `PublicQuestion` in `broadcast.ts`.
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
   * `answer` is renamed from `blind`, and that is a rename rather than a redefinition:
   * it is still the per-answerer payload and it is still the only field carrying the
   * commit side. What changed is its CONTENT, and a field called `blind` carrying two
   * payouts would have left the codebase asserting a premise it no longer holds.
   */
  | {
      readonly t: 'match:state';
      readonly matchId: MatchId;
      readonly viewId: number;
      readonly state: ClientState;
      readonly answer: AnswerPrompt | null;
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
 * ONE SIDE OF THE CARD AS THE ANSWERER SEES IT. Mirrors the server's
 * `PublishedSide`; the two are kept mutually assignable by `protocol-parity.test.ts`.
 *
 * `pays` is `Partial<Record<Resource, number>>` and deliberately so: it is the engine's
 * `Delta`, in which an absent pool means zero. A hand-written all-required record would
 * force the projection to invent `{funds: 0, clout: 0, media: 0, trust: 0}` for a side that
 * pays nothing in three pools, and the client would then have to decide whether a zero it
 * was handed is the same thing as a pool the card does not mention. It is not, for a
 * payout line: a card that says "2 Funds" says two Funds and says nothing about Clout,
 * and the UI must be able to print only what the card printed.
 */
export type AnswerSide = {
  readonly label: string;
  readonly ideologue: 'capitalist' | 'supremo' | 'showstopper' | 'idealist';
  readonly pays: Readonly<Partial<Record<'funds' | 'clout' | 'media' | 'trust', number>>>;
};

/**
 * THE ANSWER PROMPT — the whole card, plus the one thing the table does not have.
 *
 * ── IT IS NOT BLIND, AND THE RENAME IS THE POINT ─────────────────────────────
 *
 * This type used to be `BlindPrompt` and its type WAS the security control: no
 * `Delta`, no `Ideologue`, no `CardID`, no number, "so there is nothing for a later
 * refactor to accidentally bind into the DOM". Full information makes that a
 * description of a type that no longer exists, so it is renamed rather than left
 * behind asserting something false. A prompt carrying two payouts and still called
 * `BlindPrompt` would be a lie in a name, and a lie in a name is how the next person
 * decides the payout is still hidden.
 *
 * ── WHAT IS STILL PROTECTED, AND IT IS ONE FIELD ─────────────────────────────
 *
 * `order`. It says which face of the card a display position is, and the Ideologue
 * is now printed beside each answer, so publishing `order` to the table would let a
 * client line the deck's Ideologue balance up against the left-hand cell — the
 * channel PLAN.md §2 amendment A′ exists to prevent. `order` therefore stays on a
 * field that is populated for the answering player alone, and `PublicQuestion`
 * carries the same card without it. The two payloads are one computation apart, and
 * `secret-state.test.ts` asserts they are byte-identical in every other field, so
 * "the table sees the same card the answerer does" is checked rather than claimed.
 *
 * `sides` are in DISPLAY order. `sides[0]` is what the player sees first, and
 * `order` says which side of the underlying card that is. The client sends the
 * index it clicked; the server maps it back through `order` before the reducer ever
 * sees the action. The order is derived on the server from the match seed — never
 * from a value the client can see, or a patched client just overrides it.
 */
export type AnswerPrompt = {
  readonly question: string;
  readonly sides: readonly [AnswerSide, AnswerSide];
  /** 'ab' — sides[0] is side 0. 'ba' — sides[0] is side 1. */
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
