/**
 * `packages/client/src/net` — the client's whole relationship with the server.
 *
 * Three files, and the dependency between them is one-directional:
 *
 *   protocol.ts    the wire types. Type-only imports from the engine.
 *   store.ts       a fold over the message stream. No socket, no network.
 *   connection.ts  the socket, the backoff, the resume.
 *
 * `store.ts` does not import `connection.ts` and never will: a store that can
 * reach the network is a store that can be made to apply an action optimistically,
 * and the "no optimistic state" rule is enforced by the shape of the module graph
 * rather than by a convention. `connection.ts` is the only thing that knows a
 * WebSocket exists.
 *
 * LAYER-3 ENFORCEMENT. Every engine import in this directory is `import type`.
 * A value import would pull `reduce.ts` — every deck, every payout, the whole rule
 * engine — into the browser bundle, and a bundler is a leak channel nobody reviews.
 * `packages/server/scripts/check-secrets.mjs` fails the whole build on one, and it
 * scans this directory as well as the server's.
 *
 * The wire types are duplicated from `packages/server/src/protocol.ts` because a
 * `packages/shared` package could not be created in this milestone. The drift is a
 * compile error rather than a promise: `packages/server/test/protocol-parity.test.ts`
 * asserts the two are mutually assignable.
 */

export { Connection, getConnection, disposeConnection, DEFAULT_BACKOFF } from './connection.ts';
export type {
  ConnectionOptions,
  ConnectionStatus,
  BackoffOptions,
  WebSocketLike,
} from './connection.ts';

export {
  subscribe,
  getStore,
  resetStore,
  applyState,
  applyEvents,
  clearAnswer,
  applyServerMessage,
  setPhase,
  clearError,
  select,
  myId,
  isMyTurn,
  awaitingMyAnswer,
  myChoices,
  amSeated,
} from './store.ts';
export type { ClientStore, Phase, PendingError } from './store.ts';

export type {
  AnswerPrompt,
  AnswerSide,
  ClientMessage,
  ErrorCode,
  Lobby,
  LobbySeat,
  LobbySummary,
  MatchId,
  SeatCount,
  ServerMessage,
  Session,
} from './protocol.ts';
