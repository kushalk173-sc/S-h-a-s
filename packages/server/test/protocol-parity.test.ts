/**
 * Protocol parity.
 *
 * The client keeps its own copy of the wire types at
 * `packages/client/src/net/protocol.ts` (see the header there for why a fourth
 * package was not available). A copy is only acceptable if DRIFT IS A COMPILE
 * ERROR, and this file is what makes it one.
 *
 * Both directions of assignability are checked:
 *
 *   server → client  a field the server can send that the client cannot type is
 *                    the silent-drop bug. A client that does not know a field
 *                    ignores it, and "the client's state is missing something"
 *                    is a bug report nobody can reproduce.
 *   client → server  a field the client can send that the server cannot type is
 *                    the worse direction: the client's send would not compile
 *                    against the real server, or would be stripped by the decoder.
 *
 * `tsc --noEmit` in `packages/server` typechecks this file, so the gate runs in
 * the same command as everything else. `npm test` runs it too, so it cannot be
 * bypassed by only running tests.
 *
 * WHEN `packages/shared` LANDS: delete this file along with both copies. Nothing
 * else references it.
 */

import { describe, expect, it } from 'vitest';

import type {
  BlindPrompt as ServerBlind,
  ClientMessage as ServerClientMessage,
  ErrorCode as ServerErrorCode,
  Lobby as ServerLobby,
  LobbySeat as ServerLobbySeat,
  LobbySummary as ServerLobbySummary,
  SeatCount as ServerSeatCount,
  ServerMessage as ServerServerMessage,
  Session as ServerSession,
} from '../src/protocol.ts';

// Type-only, so nothing from the client package ends up in the server's module
// graph at runtime. `verbatimModuleSyntax` guarantees the import is erased.
import type {
  BlindPrompt as ClientBlind,
  ClientMessage as ClientClientMessage,
  ErrorCode as ClientErrorCode,
  Lobby as ClientLobby,
  LobbySeat as ClientLobbySeat,
  LobbySummary as ClientLobbySummary,
  SeatCount as ClientSeatCount,
  ServerMessage as ClientServerMessage,
  Session as ClientSession,
} from '../../client/src/net/protocol.ts';

type Assignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compile-time mutual assignability.
 *
 * Each entry is a `const` whose declared type is `Assignable<A, B>` and whose
 * value is the literal `true`. That gives the check BOTH halves:
 *
 *  - if `A` and `B` differ, `Assignable<A, B>` is `false`, `true` is not
 *    assignable to it, and `tsc` fails — which is the gate that actually matters,
 *    because it runs inside `npm run typecheck`;
 *  - the value is a real `true`, so `npm test` reports the same fact in the test
 *    output rather than leaving it invisible in compiler logs.
 *
 * The earlier version of this file used `null as unknown as Assignable<…>`, which
 * typechecked perfectly and asserted `expected null to be true` at runtime. A gate
 * whose runtime half is vacuous is a gate that will quietly stop working.
 */
const S2C = {
  serverMessage: true as Assignable<ServerServerMessage, ClientServerMessage>,
  clientMessage: true as Assignable<ServerClientMessage, ClientClientMessage>,
  session: true as Assignable<ServerSession, ClientSession>,
  lobby: true as Assignable<ServerLobby, ClientLobby>,
  lobbySeat: true as Assignable<ServerLobbySeat, ClientLobbySeat>,
  lobbySummary: true as Assignable<ServerLobbySummary, ClientLobbySummary>,
  blind: true as Assignable<ServerBlind, ClientBlind>,
  errorCode: true as Assignable<ServerErrorCode, ClientErrorCode>,
  seatCount: true as Assignable<ServerSeatCount, ClientSeatCount>,
};

const C2S = {
  serverMessage: true as Assignable<ClientServerMessage, ServerServerMessage>,
  clientMessage: true as Assignable<ClientClientMessage, ServerClientMessage>,
  session: true as Assignable<ClientSession, ServerSession>,
  lobby: true as Assignable<ClientLobby, ServerLobby>,
  lobbySeat: true as Assignable<ClientLobbySeat, ServerLobbySeat>,
  lobbySummary: true as Assignable<ClientLobbySummary, ServerLobbySummary>,
  blind: true as Assignable<ClientBlind, ServerBlind>,
  errorCode: true as Assignable<ClientErrorCode, ServerErrorCode>,
  seatCount: true as Assignable<ClientSeatCount, ServerSeatCount>,
};

type Parity = Readonly<Record<keyof typeof S2C, boolean>>;

/** Both directions agree, and agree in the same way. */
const SERVER_TO_CLIENT: Parity = S2C;
const CLIENT_TO_SERVER: Parity = C2S;

describe('the client\'s protocol copy has not drifted from the server\'s', () => {
  it('every message type is assignable in BOTH directions', () => {
    // One direction passing is not enough. `{a}` and `{a, b}` are assignable one
    // way and not the other, which is exactly the shape of the bug: the client
    // compiles, sends a field the server drops, and nobody finds out until a
    // player's action silently does nothing.
    for (const [name, ok] of Object.entries(SERVER_TO_CLIENT)) {
      expect(ok, `server → client drift on ${name}: the server's shape is not the client's shape`).toBe(true);
    }
    for (const [name, ok] of Object.entries(CLIENT_TO_SERVER)) {
      expect(ok, `client → server drift on ${name}: the client can send something the server cannot type`).toBe(true);
    }
  });

  it('both sides declare the same set of checked types', () => {
    // A weaker but very legible check, and the one that catches the most common
    // drift: a variant added on one side only. Mutual assignability already
    // catches it; this says so in a sentence a reviewer can read.
    expect(Object.keys(SERVER_TO_CLIENT).sort()).toEqual(Object.keys(CLIENT_TO_SERVER).sort());
  });
});
