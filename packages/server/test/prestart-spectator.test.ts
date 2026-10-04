/**
 * Watching a room that has not started yet.
 *
 * ## THE GAP THIS FILE CLOSES
 *
 * The browser agent proved one half of spectating: a spectator who clicks WATCH on a
 * room that is ALREADY running reaches the match. That half works because
 * `lobby:spectate` hands the connection the room's own `lobby:state`, and for a started
 * room that snapshot already carries `matchId` (`LobbyHub#lobbyView` reads it off any
 * member). The client's effect in `Lobby.tsx` sees a non-null `matchId` on arrival and
 * sends `match:spectate`.
 *
 * The other half was untested and was broken: a spectator who joins BEFORE the host
 * presses START holds a snapshot whose `matchId` is `null`, and before this fix the
 * server never told them otherwise. `LobbyHub#startMatch` writes `matchId` onto every
 * member (lobby.ts, the loop over `lobby.members`) and `#startMatch` on the socket
 * replied only to seats — `session:granted` + `match:state`, with the member loop
 * `continue`-ing past spectators. So the spectator sat in a waiting room for a game that
 * had already begun, polling a view that could not change, and the table looked hung.
 *
 * This is the shape the seat-orphan bug had: a connection whose view of the world was
 * replaced or withheld and nothing ever told it. It cannot be caught client-side,
 * because the client faithfully renders what it was sent and the update was never sent.
 *
 * ## WHAT IS ASSERTED, AND WHY IT IS NOT "A MESSAGE ARRIVED"
 *
 * A `lobby:state` with a `matchId` proves the plumbing and nothing about the game. The
 * claim worth protecting is that the spectator ends up HOLDING A USABLE MATCH: attached,
 * receiving every later broadcast, with a projection covering the real seats. So each
 * test drives a ply after the handoff and asserts the spectator's `viewId` moved. A
 * spectator that got one frame and then went quiet has not reached the match; it has
 * been told the match exists.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Lobby, SeatCount } from '../src/protocol.ts';
import { TestClient, startHarness, type Harness } from './fixtures.ts';

let harness: Harness | null = null;
const clients: TestClient[] = [];

async function boot(): Promise<Harness> {
  const h = await startHarness({ dispatchRate: 500 });
  harness = h;
  return h;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  if (harness !== null) {
    await harness.close();
    harness = null;
  }
});

type Table = {
  readonly h: Harness;
  readonly lobbyId: string;
  readonly players: readonly TestClient[];
  readonly spectator: TestClient;
};

/**
 * A room with `seats` players and ONE spectator who joined BEFORE the match started.
 *
 * The spectator's own arrival snapshot is asserted to have `matchId === null`, so a test
 * that later passes on a matchId cannot be passing because the room was already running
 * — which is the only half that already worked.
 */
async function preStartTable(seats: SeatCount): Promise<Table> {
  const h = await boot();
  const players: TestClient[] = [];

  const host = await TestClient.connect(h.url);
  clients.push(host);
  players.push(host);
  host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: seats, isPrivate: false });
  const created = await host.expect(host.is('lobby:state'), 'the host lobby');

  for (let i = 1; i < seats; i += 1) {
    const p = await TestClient.connect(h.url);
    clients.push(p);
    players.push(p);
    p.send({ t: 'lobby:join', lobbyId: created.lobby.lobbyId, name: `P${i + 1}` });
    await p.expect(p.is('lobby:state'), `player ${i + 1}'s lobby`);
  }

  // The spectator arrives while the room is still a waiting room. This is the case the
  // browser proof missed and the one that was broken.
  const spectator = await TestClient.connect(h.url);
  clients.push(spectator);
  spectator.send({ t: 'lobby:spectate', lobbyId: created.lobby.lobbyId });
  const arrived = await spectator.expect(spectator.is('lobby:state'), 'the spectator lobby');
  expect(arrived.lobby.matchId, 'the room had already started — this is not the case under test').toBeNull();
  expect(arrived.lobby.seats, 'a spectator must not take a seat').toHaveLength(seats);

  return { h, lobbyId: created.lobby.lobbyId, players, spectator };
}

/** The last `lobby:state` this socket has been sent, over its whole life. */
const latestLobby = (c: TestClient): Lobby => {
  const all = c.ever('lobby:state');
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('this client has received no lobby:state');
  return last.lobby;
};

/**
 * Drop every message received so far, so the next `expect` cannot match something
 * from BEFORE the start.
 *
 * This is not hygiene, it is correctness. `TestClient.expect` scans `received` in
 * arrival order and returns the FIRST match, so without this an assertion about the
 * post-start world quietly reads the pre-start snapshot — which is a test that passes
 * for the wrong reason, or fails for the wrong one. Both happened while writing this
 * file. `ever`/`history` is never cleared, so the pre-start facts stay auditable.
 */
function forget(c: TestClient): void {
  c.clear();
}

describe('a spectator who joined BEFORE the match started reaches the match', () => {
  for (const seats of [2, 3] as const) {
    it(`at ${seats} seats`, async () => {
      const { h, lobbyId, players, spectator } = await preStartTable(seats);
      const host = players[0];
      if (host === undefined) throw new Error('no host');

      for (const c of [...players, spectator]) forget(c);
      host.send({ t: 'lobby:start' });
      const matchId = (await host.expect(host.is('match:state'), 'the host match:state')).matchId;

      // 1. THE UPDATE. The room's snapshot now names the match, for the spectator too.
      //    This is the frame the fix adds; before it, this await times out.
      const update = await spectator.expect(spectator.is('lobby:state'), 'the spectator lobby update');
      expect(update.lobby.lobbyId).toBe(lobbyId);
      expect(update.lobby.matchId, 'the spectator was never told which match started').toBe(matchId);

      // 2. THE HANDOFF. Exactly what `Lobby.tsx`'s effect does when it sees a non-null
      //    matchId: send the frame that actually attaches a connection to a live room.
      spectator.clear();
      spectator.send({ t: 'match:spectate', matchId: update.lobby.matchId ?? '' });
      const granted = await spectator.expect(spectator.is('session:granted'), 'the spectator session');
      expect(granted.session.role).toBe('spectator');
      expect(granted.session.matchId).toBe(matchId);
      // A spectator is given a player id — the session type has no null there — so the
      // claim that it is not seated is made where it is actually testable: that id is
      // not one of the room's seats.
      const room0 = h.server.hub.rooms.get(matchId);
      if (room0 === undefined) throw new Error('no room');
      expect(room0.seats.map((s) => s.playerId), 'the spectator took a seat').not.toContain(
        granted.session.playerId,
      );

      // 3. A USABLE MATCH STATE, not merely a message that arrived. Every seat is in
      //    the projection, the turn order is the real one, and the spectator is looking
      //    at the live board rather than an empty shell.
      const state = await spectator.expect(spectator.is('match:state'), 'the spectator match:state');
      expect(state.matchId).toBe(matchId);
      expect(state.you.role).toBe('spectator');
      // `you.playerId` is the nullable one, and null is the whole point: a spectator's
      // projection belongs to nobody at the table.
      expect(state.you.playerId).toBeNull();
      expect(state.state.turnOrder).toHaveLength(seats);
      expect(Object.keys(state.state.players)).toHaveLength(seats);
      expect(state.state.phase).toBe('answer');
      const room = h.server.hub.rooms.get(matchId);
      if (room === undefined) throw new Error('no room');
      expect(room.seats, 'the spectator took a seat').toHaveLength(seats);

      // 4. STILL ATTACHED. One ply is committed by whichever seat is on move, and the
      //    spectator's viewId must move with it. A spectator holding one stale frame and
      //    no subscription has NOT reached the match, which is why this is not folded
      //    into the assertions above.
      const before = state.viewId;
      const mover = players.find((p) => p.latestState().state.activePlayer === p.latestSession().playerId);
      if (mover === undefined) throw new Error('no active player found');
      const onMove = mover.latestState().state;
      mover.clear();
      forget(spectator);
      mover.send({
        t: 'match:action',
        action: onMove.phase === 'answer' ? { type: 'ANSWER', side: 0 } : { type: 'END_TURN' },
      });
      const after = await spectator.expect(spectator.is('match:state'), 'the spectator follow-up state');
      expect(after.viewId, 'the spectator stopped receiving the match after its first state').toBeGreaterThan(before);
    });
  }

  it('and the spectator never became a seat, at any seat count', async () => {
    // The second half of "usable": a spectator who reaches the match by being counted as
    // a player would pass a `match:state` assertion and break the table. One room per
    // seat count, because the seat count is what the loop above parameterises.
    for (const seats of [2, 3, 4, 5] as const) {
      const { players, spectator } = await preStartTable(seats);
      const host = players[0];
      if (host === undefined) throw new Error('no host');
      for (const c of [...players, spectator]) forget(c);
      host.send({ t: 'lobby:start' });
      const matchId = (await host.expect(host.is('match:state'), `host state at ${seats}`)).matchId;
      const update = await spectator.expect(spectator.is('lobby:state'), `spectator update at ${seats}`);
      expect(update.lobby.matchId).toBe(matchId);
      expect(update.lobby.seats, `at ${seats} seats the spectator took one`).toHaveLength(seats);
      spectator.send({ t: 'match:spectate', matchId });
      const granted = await spectator.expect(spectator.is('session:granted'), `spectator grant at ${seats}`);
      expect(granted.session.role, `at ${seats} seats the spectator was seated`).toBe('spectator');
      expect(granted.session.lobbyId).toBeNull();
      // Tear the table down between iterations so the next one is its own room.
      for (const c of clients.splice(0)) await c.close();
      if (harness !== null) {
        await harness.close();
        harness = null;
      }
    }
  });
});

describe('starting a match leaves NO connection in that lobby holding a stale view', () => {
  for (const seats of [2, 3, 4, 5] as const) {
    it(`at ${seats} seats, every connection in the room is told the match id`, async () => {
      const { h, lobbyId, players, spectator } = await preStartTable(seats);
      const host = players[0];
      if (host === undefined) throw new Error('no host');

      // Everyone's PRE-start view, captured before the start so "stale" is a fact about
      // a snapshot that really existed rather than an assumption.
      for (const c of [...players, spectator]) {
        expect(latestLobby(c).matchId, 'a connection entered the room already knowing the match').toBeNull();
      }

      for (const c of [...players, spectator]) forget(c);
      host.send({ t: 'lobby:start' });
      const matchId = (await host.expect(host.is('match:state'), 'the host match:state')).matchId;

      // The server's own truth first: the source of the staleness is `matchId` being
      // null on the members, so that is asserted directly rather than only on the wire.
      const lobby = h.server.hub.getLobby(lobbyId);
      if (lobby === undefined) throw new Error('the lobby vanished');
      for (const member of lobby.members.values()) {
        expect(member.matchId, 'a member was left without a match id after the start').toBe(matchId);
      }

      // Then every connection, each one AWAITED rather than read out of history. The
      // host's `match:state` leaves the socket before the broadcast is written, so a
      // synchronous read of what has arrived so far is a race that fails on a fast
      // machine and passes on a slow one.
      for (const c of [...players, spectator]) {
        const post = await c.expect(c.is('lobby:state'), 'a post-start lobby view');
        expect(post.lobby.matchId, 'a connection was told about the match but not which one').toBe(matchId);
      }
      // And every connection's LATEST view is the post-start one. A connection whose
      // newest lobby view still says `null` is a connection that will sit in a waiting
      // room for a game that has begun — the exact failure, and the exact shape the
      // seat-orphan bug had: the world moved on and this connection was never told.
      for (const c of [...players, spectator]) {
        expect(latestLobby(c).matchId, 'a connection is left holding the pre-start view').toBe(matchId);
        expect(latestLobby(c).lobbyId).toBe(lobbyId);
      }

      // And no connection is left half-attached: a seated player in this room is in the
      // match, holding the credential for it. A connection that is "in the room" but
      // not in the match is the orphan class in its other form.
      for (const p of players) {
        expect(p.latestSession().role, 'a seated player was downgraded').toBe('player');
        expect(p.latestSession().matchId, 'a seated player was left outside the match').toBe(matchId);
      }
      // The spectator is the one connection that is deliberately still only in the room:
      // attaching is its client's move (`match:spectate`), and the test above proves it
      // can now make it.
      expect(spectator.latestSession().role).toBe('spectator');
      expect(spectator.latestSession().matchId).toBeNull();

      // The room list agrees, so the waiting-room card does not keep advertising a table
      // that has not started either.
      host.clear();
      host.send({ t: 'lobby:list' });
      const list = await host.expect(host.is('lobby:list'), 'the room list');
      const row = list.lobbies.find((l) => l.lobbyId === lobbyId);
      expect(row?.inProgress, 'the room list still shows the table as not started').toBe(true);
    });
  }

  it('a spectator that reaches the match stops being a lobby viewer, so it cannot be handed a stale one', async () => {
    // The handoff REPLACES the connection's session (`#spectate` mints a spectator
    // session and re-points the socket at it). The new record must not still claim the
    // room: a connection that keeps a `lobbyId` after it is watching a match is one more
    // `lobby:ready` or seat change away from being handed a view of a room it has left,
    // and it is the same release-what-it-held discipline as the seat orphan.
    const { h, lobbyId, players, spectator } = await preStartTable(2);
    const host = players[0];
    if (host === undefined) throw new Error('no host');
    for (const c of [...players, spectator]) forget(c);
    host.send({ t: 'lobby:start' });
    const matchId = (await host.expect(host.is('match:state'), 'the host match:state')).matchId;

    spectator.send({ t: 'match:spectate', matchId });
    const granted = await spectator.expect(spectator.is('session:granted'), 'the spectator session');
    expect(granted.session.lobbyId, 'the watching connection still claims the room').toBeNull();
    expect(granted.session.matchId).toBe(matchId);

    const held = h.server.sessions.all().find((r) => r.sessionId === granted.session.sessionId);
    expect(held, 'the new session was never recorded').toBeDefined();
    expect(held?.lobbyId).toBeNull();
    expect(held?.role).toBe('spectator');

    // And no LATER lobby mutation in that room reaches it: the host marks itself ready
    // again, which broadcasts, and the watching connection must not be handed it.
    host.clear();
    spectator.clear();
    host.send({ t: 'lobby:ready', ready: true });
    await host.expect(host.is('lobby:state'), 'the host lobby refresh');
    const stillThere = spectator.all('lobby:state');
    expect(stillThere.length, 'a watching connection was handed a lobby view after leaving the room').toBe(0);
  });
});