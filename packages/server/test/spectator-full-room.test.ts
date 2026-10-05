/**
 * SPECTATING, AT EVERY SEAT COUNT, AND IN A FULL ROOM.
 *
 * WHY THIS FILE EXISTS
 *
 * `prestart-spectator.test.ts` covers a spectator who clicks WATCH on a room that has
 * not started, at 2 and 3 seats. Three things were left, and all three are the shapes
 * that broke before:
 *
 *  1. **4 and 5 seats.** The seat count is a parameter of the pre-start fan-out and of
 *     `#startMatch`'s member loop, and it was only ever run at two of the four values.
 *  2. **A FULL room.** The case most likely to still be broken, because `#joinLobby`'s
 *     spectator branch does NOT go through `LobbyHub#joinLobby` and therefore does not
 *     pass the `lobby.members.size >= lobby.maxPlayers` check that refuses a sixth
 *     player. Whether that is CORRECT (a spectator is not a seat, so a full room should
 *     still admit one) or a hole (a spectator is a connection with a session and a
 *     `lobbyId`, so "full" may mean something different in practice) is exactly the kind
 *     of question that has to be measured rather than assumed — and the bug this file is
 *     named after, a `WATCH INSTEAD` frame that orphaned a seat and hung the table
 *     permanently, was a spectator-handling bug that only manifested at particular seat
 *     counts.
 *  3. **THE CAPACITY ASYMMETRY ITSELF**, asserted rather than assumed: a full room
 *     refuses a player and admits a spectator. If that ever inverts, or if the spectator
 *     quietly becomes a member, the room's own `seated` count lies and `#startMatch`
 *     seats somebody who is not there.
 *
 * WHAT IS ASSERTED IS "THE SPECTATOR IS HOLDING A USABLE MATCH", NOT "A MESSAGE ARRIVED"
 *
 * A `lobby:state` proves plumbing. The claim worth protecting is that the spectator ends
 * up attached, receiving every later broadcast, with a projection covering all the real
 * seats — so each test here drives a ply after the handoff and asserts the spectator's
 * `viewId` moved. A spectator that got one frame and then went quiet has been told the
 * match exists; it has not reached it.
 *
 * THE WRITE DOOR IS CLOSED TOO, because a spectator at a table of five is five seats'
 * worth of board to break. `#spectate` mints a `playerId` that is in no room's seat
 * table, so every write door rejects it — there is no flag to forget to check, and this
 * asserts that at the two seat counts it was not asserted at before.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { SeatCount } from '../src/protocol.ts';
import { TestClient, startHarness, type Harness } from './fixtures.ts';

let harness: Harness | null = null;
const clients: TestClient[] = [];

async function boot(): Promise<Harness> {
  const h = await startHarness({ dispatchRate: 500 });
  harness = h;
  return h;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  if (harness !== null) {
    await harness.close();
    harness = null;
  }
});

type Table = {
  readonly h: Harness;
  readonly lobbyId: string;
  readonly players: readonly TestClient[];
};

/**
 * A room with `seats` players, all seats taken.
 *
 * FULL by construction: the last player to join is what makes it full, so every test
 * that uses this is testing a room at `members.size === maxPlayers`, which is the state
 * the spectator then walks into.
 */
async function fullTable(seats: SeatCount): Promise<Table> {
  const h = await boot();
  const players: TestClient[] = [];

  const host = await TestClient.connect(h.url);
  clients.push(host);
  players.push(host);
  host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: seats, isPrivate: false, mode: 'standard' });
  const created = await host.expect(host.is('lobby:state'), 'the host lobby');
  const lobbyId = created.lobby.lobbyId;

  for (let i = 1; i < seats; i += 1) {
    const p = await TestClient.connect(h.url);
    clients.push(p);
    players.push(p);
    p.send({ t: 'lobby:join', lobbyId, name: `P${i + 1}` });
    await p.expect(p.is('lobby:state'), `player ${i + 1}'s lobby`);
  }

  const lobby = h.server.hub.getLobby(lobbyId);
  if (lobby === undefined) throw new Error('the lobby vanished');
  expect(lobby.members.size, `the room is not full at ${seats} seats`).toBe(lobby.maxPlayers);

  return { h, lobbyId, players };
}

/** A spectator who walks into a room that is already full. */
async function watchFullRoom(lobbyId: string): Promise<TestClient> {
  const spectator = await TestClient.connect(clients[0]?.socket.url ?? '');
  clients.push(spectator);
  spectator.clear();
  spectator.send({ t: 'lobby:spectate', lobbyId });
  const arrived = await spectator.expect(spectator.is('lobby:state'), 'the spectator lobby in a full room');
  return spectator;
}

const latestLobby = (c: TestClient) => {
  const all = c.ever('lobby:state');
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('this client has received no lobby:state');
  return last.lobby;
};

describe('a spectator is admitted to a FULL room, at 4 and 5 seats', () => {
  for (const seats of [4, 5] as const) {
    it(`at ${seats} seats: the room stays at ${seats} seats, and the spectator reaches the match and keeps receiving it`, async () => {
      const { h, lobbyId, players } = await fullTable(seats);
      const host = players[0];
      if (host === undefined) throw new Error('no host');

      const spectator = await watchFullRoom(lobbyId);

      // 1. THE ROOM IS STILL FULL AND STILL ${seats} SEATS. A spectator that became a
      //    lobby member would take the room past `maxPlayers`, and `lobbyView`'s seat
      //    list is what the room's own card renders — so this is the claim that the
      //    count on screen is true.
      const arrived = latestLobby(spectator);
      expect(arrived.matchId, 'the room had already started — this is not the case under test').toBeNull();
      expect(arrived.seats, `a spectator took a seat in a full ${seats}-seat room`).toHaveLength(seats);
      expect(arrived.maxPlayers).toBe(seats);
      const lobby = h.server.hub.getLobby(lobbyId);
      if (lobby === undefined) throw new Error('the lobby vanished');
      expect(lobby.members.size, 'a spectator became a lobby member').toBe(lobby.maxPlayers);
      // …and no seat was taken, which is the other half: the seat list is identical to
      // the one the players are looking at.
      const playerSeats = latestLobby(host).seats.map((s) => s.playerId);
      expect(arrived.seats.map((s) => s.playerId)).toEqual(playerSeats);
      expect(arrived.seats.some((s) => s.name === 'Spectator'), 'a spectator appears in the seat list').toBe(false);

      // 2. AND NOBODY WAS REFUSED. The spectator branch of `#joinLobby` creates its own
      //    session rather than going through `LobbyHub#joinLobby`, so `LOBBY_FULL`
      //    cannot fire for it. Asserted from the wire: a refusal would be an `error`
      //    frame, and the fact that a `lobby:state` arrived at all is the claim. The
      //    explicit check is here so a future error-then-state pair cannot pass.
      expect(spectator.all('error'), 'the spectator was refused entry to a full room').toEqual([]);
      const granted = spectator.latestSession();
      expect(granted.role, 'the spectator was not granted a spectator session').toBe('spectator');
      expect(granted.lobbyId, 'the spectator was not told which room it is in').toBe(lobbyId);
      expect(granted.matchId, 'a spectator was given a match id before one existed').toBeNull();

      // 3. THE ROOM STILL STARTS. A full room plus a spectator must still produce a
      //    match — this is the `WATCH INSTEAD` shape, where a spectator's presence kept
      //    the host from starting and hung the table.
      for (const c of [...players, spectator]) c.clear();
      host.send({ t: 'lobby:start' });
      const matchId = (await host.expect(host.is('match:state'), `the host match:state at ${seats}`)).matchId;
      const update = await spectator.expect(spectator.is('lobby:state'), 'the spectator was told the match id');
      expect(update.lobby.matchId, 'the spectator in a full room was never told the match began').toBe(matchId);

      // 4. THE HANDOFF, and a usable match rather than a frame.
      spectator.clear();
      spectator.send({ t: 'match:spectate', matchId });
      const spec = await spectator.expect(spectator.is('session:granted'), 'the spectator session');
      expect(spec.session.role).toBe('spectator');
      expect(spec.session.lobbyId, 'the watching connection still claims the room').toBeNull();
      const state = await spectator.expect(spectator.is('match:state'), 'the spectator match:state');
      expect(state.state.finished).toBe(false);
      expect(state.you.role).toBe('spectator');
      expect(state.you.playerId, 'a spectator projection belongs to a seat').toBeNull();
      expect(state.state.turnOrder, 'the spectator does not see every seat').toHaveLength(seats);
      expect(Object.keys(state.state.players), 'the spectator does not see every player').toHaveLength(seats);

      const room = h.server.hub.rooms.get(matchId);
      if (room === undefined) throw new Error('no room');
      expect(room.seats, 'a spectator took a seat in the live room').toHaveLength(seats);
      expect(room.seats.map((s) => s.playerId), 'the spectator is in the seat table').not.toContain(spec.session.playerId);

      // 5. STILL ATTACHED. One committed ply and the spectator's viewId must move.
      const before = state.viewId;
      const mover = players.find((p) => p.latestState().state.activePlayer === p.latestSession().playerId);
      if (mover === undefined) throw new Error('no active player found');
      const onMove = mover.latestState().state;
      mover.clear();
      spectator.clear();
      mover.send({
        t: 'match:action',
        action: onMove.phase === 'answer' ? { type: 'ANSWER', side: 0 } : { type: 'END_TURN' },
      });
      const after = await spectator.expect(spectator.is('match:state'), 'the spectator follow-up state');
      expect(after.viewId, 'the spectator stopped receiving the match after its first state').toBeGreaterThan(before);
    });
  }

  it('at 4 and 5 seats: a full room refuses a PLAYER and admits a SPECTATOR — the asymmetry, asserted', () => {
    // The refusal and the admission are different code paths and the difference is the
    // whole question. `LobbyHub#joinLobby` throws `LOBBY_FULL` past `maxPlayers`;
    // `#joinLobby`'s spectator branch never calls it, because a spectator is not a
    // member. If a future change routes spectators through `joinLobby`, this fails and
    // the change has to decide which of the two behaviours was intended.
    return (async () => {
      for (const seats of [4, 5] as const) {
        const { h, lobbyId } = await fullTable(seats);

        const sixth = await TestClient.connect(clients[0]?.socket.url ?? '');
        clients.push(sixth);
        sixth.clear();
        sixth.send({ t: 'lobby:join', lobbyId, name: 'P6' });
        const refusal = await sixth.expect(sixth.is('error'), `the refusal at ${seats} seats`);
        expect(refusal.code, `at ${seats} seats a full room refused with the wrong code`).toBe('LOBBY_FULL');
        expect(sixth.all('lobby:state'), 'a refused player was also given a room view').toEqual([]);
        expect(
          h.server.hub.getLobby(lobbyId)?.members.size,
          'a refused player became a member anyway',
        ).toBe(seats);

        const spectator = await watchFullRoom(lobbyId);
        expect(spectator.all('error'), `at ${seats} seats a full room refused a spectator`).toEqual([]);
        expect(spectator.latestSession().role).toBe('spectator');
        expect(
          h.server.hub.getLobby(lobbyId)?.members.size,
          'admitting a spectator changed the room occupancy',
        ).toBe(seats);

        // Tear down between iterations so each seat count is its own room.
        for (const c of clients.splice(0)) await c.close().catch(() => undefined);
        if (harness !== null) {
          await harness.close();
          harness = null;
        }
      }
    })();
  });
});

describe('spectating a room that is ALREADY running, at 4 and 5 seats', () => {
  for (const seats of [4, 5] as const) {
    it(`at ${seats} seats: a spectator who arrives mid-game reaches the match on the first frame`, async () => {
      // The other half of spectating, and the half that already worked before the
      // pre-start fix — because for a started room the arrival snapshot already carries
      // `matchId`, so the client's effect fires immediately. Extended to 4 and 5 seats
      // because the pre-start file only claimed 2 and 3.
      const { h, lobbyId, players } = await fullTable(seats);
      const host = players[0];
      if (host === undefined) throw new Error('no host');
      host.send({ t: 'lobby:start' });
      const matchId = (await host.expect(host.is('match:state'), `the host state at ${seats}`)).matchId;

      const spectator = await TestClient.connect(clients[0]?.socket.url ?? '');
      clients.push(spectator);
      spectator.send({ t: 'lobby:spectate', lobbyId });
      const arrived = await spectator.expect(spectator.is('lobby:state'), 'the spectator arrived at a running room');
      expect(arrived.lobby.matchId, 'a running room did not advertise its match to a new spectator').toBe(matchId);
      expect(arrived.lobby.seats, `a spectator took a seat in a running ${seats}-seat room`).toHaveLength(seats);

      spectator.clear();
      spectator.send({ t: 'match:spectate', matchId: arrived.lobby.matchId });
      const granted = await spectator.expect(spectator.is('session:granted'), 'the spectator session');
      expect(granted.session.role).toBe('spectator');
      const state = await spectator.expect(spectator.is('match:state'), 'the spectator state');
      expect(state.state.turnOrder).toHaveLength(seats);

      // …and the room still has exactly `seats` seats after all of that.
      const room = h.server.hub.rooms.get(matchId);
      expect(room?.seats).toHaveLength(seats);
      expect(room?.seats.map((s) => s.playerId)).not.toContain(granted.session.playerId);

      // And it keeps receiving: one ply moves the spectator's viewId.
      const before = state.viewId;
      const mover = players.find((p) => p.latestState().state.activePlayer === p.latestSession().playerId);
      if (mover === undefined) throw new Error('no active player found');
      const onMove = mover.latestState().state;
      mover.clear();
      spectator.clear();
      mover.send({
        t: 'match:action',
        action: onMove.phase === 'answer' ? { type: 'ANSWER', side: 0 } : { type: 'END_TURN' },
      });
      const after = await spectator.expect(spectator.is('match:state'), 'the spectator follow-up state');
      expect(after.viewId, 'a mid-game spectator stopped receiving the match').toBeGreaterThan(before);
      void h;
    });
  }
});

describe('the write door is closed to a spectator, at 4 and 5 seats', () => {
  for (const seats of [4, 5] as const) {
    it(`at ${seats} seats: every action type is refused, and the room does not move`, async () => {
      // `#spectate` mints a `playerId` that is in no room's seat table, so the refusal
      // is structural rather than a flag. Asserted across the action vocabulary rather
      // than for one action, because "spectators cannot dispatch" is only true if it is
      // true of the actions nobody thought to check.
      const { h, lobbyId, players } = await fullTable(seats);
      const host = players[0];
      if (host === undefined) throw new Error('no host');
      host.send({ t: 'lobby:start' });
      const matchId = (await host.expect(host.is('match:state'), `the host state at ${seats}`)).matchId;

      const spectator = await TestClient.connect(clients[0]?.socket.url ?? '');
      clients.push(spectator);
      spectator.send({ t: 'lobby:spectate', lobbyId });
      const arrived = await spectator.expect(spectator.is('lobby:state'), 'the spectator arrived');
      spectator.send({ t: 'match:spectate', matchId: arrived.lobby.matchId });
      await spectator.expect(spectator.is('session:granted'), 'the spectator session');

      const room = h.server.hub.rooms.get(matchId);
      if (room === undefined) throw new Error('no room');
      const viewIdBefore = room.viewId;

      const actions = [
        { type: 'ANSWER', side: 0 },
        { type: 'END_TURN' },
        { type: 'ACK_HEADLINE' },
        { type: 'INFLUENCE', slot: 0 },
        { type: 'PLACE_VOTERS', groupId: 'g0', areaIds: [] },
        { type: 'PASS_INTERRUPT' },
        { type: 'RESPOND_INTERRUPT', cardId: 'x' },
      ] as const;

      spectator.clear();
      for (const action of actions) {
        spectator.send({ t: 'match:action', action });
      }
      // One refusal per action, every one of them `NOT_A_PLAYER` — the seat-table check
      // in `Room#dispatch` — and no refusal names a seat, because the spectator's id is
      // in no seat table at all.
      const deadline = Date.now() + 5_000;
      while (spectator.all('error').length < actions.length && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const errors = spectator.all('error');
      expect(errors.length, `a spectator got ${errors.length} refusals for ${actions.length} actions`).toBe(actions.length);
      for (const e of errors) {
        expect(e.code, `a spectator refusal came back as ${e.code}: ${e.message}`).toBe('NOT_A_PLAYER');
        expect(e.message, 'a refusal named a seat the spectator does not hold').toBe('you are not seated at this table');
      }
      expect(room.viewId, 'a spectator advanced the room').toBe(viewIdBefore);
      expect(room.seats, 'a spectator changed the seat table').toHaveLength(seats);
      expect(room.state.activePlayer, 'a spectator changed whose turn it was').toBe(room.state.turnOrder[0]);
      void h;
    });
  }
});

describe('more spectators than seats, and the room list', () => {
  it('a full 5-seat room admits three spectators and none of them appears as a seat', async () => {
    const { h, lobbyId, players } = await fullTable(5);
    const host = players[0];
    if (host === undefined) throw new Error('no host');

    const watchers: TestClient[] = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await TestClient.connect(clients[0]?.socket.url ?? '');
      clients.push(c);
      watchers.push(c);
      c.send({ t: 'lobby:spectate', lobbyId });
      const arrived = await c.expect(c.is('lobby:state'), `spectator ${i + 1} arrived`);
      expect(arrived.lobby.seats, `spectator ${i + 1} took a seat`).toHaveLength(5);
      expect(c.all('error'), `spectator ${i + 1} was refused`).toEqual([]);
    }
    expect(h.server.hub.getLobby(lobbyId)?.members.size, 'a spectator became a member').toBe(5);

    for (const c of [...players, ...watchers]) c.clear();
    host.send({ t: 'lobby:start' });
    const matchId = (await host.expect(host.is('match:state'), 'the match started')).matchId;
    for (const [i, c] of watchers.entries()) {
      const update = await c.expect(c.is('lobby:state'), `spectator ${i + 1} was told the match id`);
      expect(update.lobby.matchId).toBe(matchId);
      c.send({ t: 'match:spectate', matchId });
      await c.expect(c.is('session:granted'), `spectator ${i + 1} attached`);
    }
    expect(h.server.hub.rooms.get(matchId)?.seats, 'the room grew past five seats').toHaveLength(5);

    // The room list reports occupancy, and it must not count spectators.
    host.clear();
    host.send({ t: 'lobby:list' });
    const list = await host.expect(host.is('lobby:list'), 'the room list');
    const row = list.lobbies.find((l) => l.lobbyId === lobbyId);
    expect(row?.seated, 'the room list counts spectators as seated').toBe(5);
    expect(row?.maxPlayers).toBe(5);
  });
});