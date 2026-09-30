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

// ─────────────────────────── client → server ───────────────────────────

export type ClientMessage =
  | { readonly t: 'ping'; readonly nonce?: string }
  | { readonly t: 'lobby:list' }
  | { readonly t: 'lobby:create'; readonly name: string; readonly maxPlayers: SeatCount; readonly isPrivate: boolean }
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
      readonly blind: BlindPrompt | null;
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

/**
 * The blind prompt.
 *
 * The security control is the TYPE, not the runtime filter: there is no `pays`, no
 * `ideologue`, no `cardId` and no number anywhere in it, so there is nothing for a
 * later refactor to bind into the DOM by accident.
 *
 * `labels` are in DISPLAY order. `labels[0]` is what the player sees first, in a
 * fixed DOM position — the two cells must never be styled differently
 * (UI-SPEC §9 anti-pattern 1), so position carries no information. `order` is a
 * seed-derived coin flip saying which side of the card that is, and the server maps
 * the clicked index back through it. The client must NOT try to work it out: it
 * has nothing to work it out from, and a client that could override it would make
 * the whole exercise decorative.
 */
export type BlindPrompt = {
  readonly question: string;
  readonly labels: readonly [string, string];
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
