/**
 * The wire protocol, mirrored for the client.
 *
 * WHY THIS IS A COPY. The architect's §1.2 answer was a fourth package,
 * `@shasn/shared`, holding the wire types and depending on nothing but
 * `@shasn/engine` for types. That is the right answer and it is not available
 * here: the packages this milestone owns are `packages/server/**` and
 * `packages/client/src/net/**`, so `packages/shared` cannot be created. The two
 * remaining options were both rejected in §1.2 for stated reasons — importing the
 * server's types drags `ws` and `node:*` into the browser's type graph, and
 * "manually keep two files in sync" is a lie that shows up as a silently dropped
 * state message.
 *
 * So the copy is here, and the drift is made a COMPILE ERROR instead of a promise:
 * `packages/server/test/protocol-parity.test.ts` imports both sides and asserts
 * they are mutually assignable. Add a field to one and the other stops compiling.
 * That is the property §1.2 was buying, obtained without the package.
 *
 * WHEN `packages/shared` IS CREATED, delete this file, delete the server's, move
 * both to `shared/src/protocol.ts`, and delete the parity test. Nothing else in
 * either package imports this file by path.
 *
 * ENGINE IMPORTS ARE TYPE-ONLY, WITHOUT EXCEPTION. A value import would pull
 * `reduce.ts` — and with it every deck, every payout and the whole rule engine —
 * into the browser bundle. A bundler is a leak channel nobody reviews, which is
 * why `packages/server/scripts/check-secrets.mjs` fails the build on one.
 */

import type { Action, ClientState, GameEvent, LogEntry, PlayerID } from '@shasn/engine';

export type MatchId = string;
export type LobbyId = string;
export type SeatId = string;

export type Session = {
  readonly sessionId: string;
  readonly resumeToken: string;
  readonly playerId: PlayerID;
  readonly matchId: MatchId | null;
  readonly lobbyId: LobbyId | null;
  readonly role: 'player' | 'spectator';
  readonly name: string;
};

/**
 * The game modes a room can be created in — a mirror of the IDS in
 * `packages/server/src/modes.ts`, never its registry (the registry names decks, and
 * the browser must not learn which decks exist). The parity test keeps the two in step.
 */
export type ModeId = 'standard' | 'azadi';

// ─────────────────────────── client → server ───────────────────────────

export type ClientMessage =
  | { readonly t: 'ping'; readonly nonce?: string }
  | { readonly t: 'lobby:list' }
  | { readonly t: 'lobby:create'; readonly name: string; readonly maxPlayers: SeatCount; readonly isPrivate: boolean; readonly mode: ModeId }
  | { readonly t: 'lobby:join'; readonly lobbyId: LobbyId; readonly name: string }
  | { readonly t: 'lobby:leave' }
  | { readonly t: 'lobby:ready'; readonly ready: boolean }
  | { readonly t: 'lobby:start' }
  | { readonly t: 'lobby:spectate'; readonly lobbyId: LobbyId }
  | { readonly t: 'match:action'; readonly action: Action }
  | { readonly t: 'match:sync' }
  | { readonly t: 'session:resume'; readonly resumeToken: string }
  | { readonly t: 'match:spectate'; readonly matchId: MatchId };

export type SeatCount = 2 | 3 | 4 | 5;

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
  | { readonly t: 'session:granted'; readonly session: Session }
  | { readonly t: 'session:ended'; readonly reason: string }
  | { readonly t: 'lobby:list'; readonly lobbies: readonly LobbySummary[] }
  | { readonly t: 'lobby:state'; readonly lobby: Lobby }
  | {
      readonly t: 'match:state';
      readonly matchId: MatchId;
      readonly viewId: number;
      readonly state: ClientState;
      readonly answer: AnswerPrompt | null;
      readonly you: { readonly role: 'player' | 'spectator'; readonly playerId: PlayerID | null };
    }
  | {
      readonly t: 'match:events';
      readonly matchId: MatchId;
      readonly viewId: number;
      readonly events: readonly GameEvent[];
    }
  | { readonly t: 'match:log'; readonly matchId: MatchId; readonly entries: readonly LogEntry[] }
  | { readonly t: 'match:over'; readonly matchId: MatchId; readonly winners: readonly PlayerID[] }
  | { readonly t: 'error'; readonly id?: string; readonly code: ErrorCode; readonly message: string };

/** One side of the card: the printed answer, its Ideologue, and what it pays. */
export type AnswerSide = {
  readonly label: string;
  readonly ideologue: 'capitalist' | 'supremo' | 'showstopper' | 'idealist';
  readonly pays: Readonly<Partial<Record<'funds' | 'clout' | 'media' | 'trust', number>>>;
};

/**
 * The answer prompt — the WHOLE card, plus the one thing the table does not have.
 *
 * It is not blind and the name says so. The card used to be withheld here and published
 * to nobody; now `openQuestion` on `state` carries the same card to every seat and this
 * field adds exactly one thing on top: `order`, the seed-derived coin flip saying which
 * face of the card is the first display position.
 *
 * ── WHAT THE CLIENT MUST NOT DO WITH ANY OF IT, which is now the whole rule ──
 *
 * `sides[0]` is what renders first, in a fixed DOM position. `order` says which side of
 * the card that is, and the server maps the clicked index back through it — the client
 * must NOT try to work it out or use it. It has nothing to work it out from beyond this
 * one field, and a client that branched on it would make the whole exercise decorative.
 *
 * **AND THE SIDE MUST NOT BE STYLED BY ITS IDEOLOGUE.** This is the sharpest form of the
 * old rule and it is the reason `order` is still worth protecting: with the Ideologue
 * printed beside each answer, a stylesheet that tinted the left cell by Ideologue would
 * publish the left-hand cell's Ideologue, which is exactly the position channel PLAN.md
 * §2 amendment A′ exists to prevent. Same text, same geometry, same class on both cells;
 * the payout differs because the payout differs, and NOTHING ELSE may.
 */
export type AnswerPrompt = {
  readonly question: string;
  readonly sides: readonly [AnswerSide, AnswerSide];
  readonly order: 'ab' | 'ba';
};

export type LobbySeat = {
  readonly seatId: SeatId;
  readonly playerId: PlayerID;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly you: boolean;
};

export type Lobby = {
  readonly lobbyId: LobbyId;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly hostId: PlayerID;
  readonly maxPlayers: SeatCount;
  readonly mode: ModeId;
  readonly modeLabel: string;
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
  readonly mode: ModeId;
  readonly modeLabel: string;
};
