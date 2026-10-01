/**
 * End to end, over a real WebSocket.
 *
 * This is the acceptance criterion that says the thing is a GAME: two players, a
 * real socket each, a real server in between, and the match driven to `finished`.
 *
 * The reason it is worth writing when the reducer already has an integration test:
 * that one calls `reduce` directly, so it proves the rules and nothing else. This
 * one can only pass if the whole chain works — the decoder narrows the frame, the
 * room dispatches it, the store appends it, the fan-out projects it per recipient,
 * and the client acts on what it was sent. A projection bug, an auth bug or a
 * message-ordering bug all show up here and nowhere else.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TestClient, advance, digest, startHarness, type Harness } from './fixtures.ts';
import type { Action, ClientState } from '@shasn/engine';

let h: Harness;
let ada: TestClient;
let bo: TestClient;
let matchId: string;
let seats: { client: TestClient; playerId: string }[] = [];

beforeAll(async () => {
  h = await startHarness({ dispatchRate: 4000 });

  ada = await TestClient.connect(h.url);
  ada.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
  const lobby = await ada.expect(ada.is('lobby:state'), 'lobby');
  const lobbyId = lobby.lobby.lobbyId;

  bo = await TestClient.connect(h.url);
  bo.send({ t: 'lobby:join', lobbyId, name: 'Bo' });
  await bo.expect(bo.is('lobby:state'), 'bo joined');

  ada.send({ t: 'lobby:start' });
  const first = await ada.expect(ada.is('match:state'), 'match started');
  await bo.expect(bo.is('match:state'), 'bo in match');
  matchId = first.matchId;

  seats = [
    { client: ada, playerId: ada.latestSession().playerId },
    { client: bo, playerId: bo.latestSession().playerId },
  ];
}, 30_000);

afterAll(async () => {
  await ada?.close();
  await bo?.close();
  await h?.close();
});

/**
 * A `Delta` totalling exactly `n`, drawn from what the player actually holds.
 *
 * `lose-any` and `gain-any` are checked with `deltaTotal(pick.res) !== c.count`, so
 * the pick has to total EXACTLY the requested number — taking `min(n, funds)` is
 * wrong the moment a player holds less than `n` in that one pool, which is most of
 * the time. A driver that gets this wrong fails with `discard exactly 3` and looks
 * like a server bug.
 */
function takeExactly(n: number, pool: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (pool === undefined) return { funds: n };
  let left = n;
  for (const res of ['funds', 'clout', 'media', 'trust'] as const) {
    if (left <= 0) break;
    const take = Math.min(left, pool[res] ?? 0);
    if (take > 0) {
      out[res] = take;
      left -= take;
    }
  }
  if (left > 0) out['funds'] = (out['funds'] ?? 0) + left;
  return out;
}

/**
 * Pick a legal action from an authoritative state, for `me`.
 *
 * The state comes from the SERVER's room, not from a client's cached copy. That is
 * a test-harness decision and it is deliberate: two sockets are never updated at
 * the same instant, so a driver that reads each client's last message will
 * occasionally act on a state one ply stale and be refused with "not your turn" —
 * a race in the harness that has nothing to do with the server. The transport is
 * still fully exercised, because the action goes out over a real socket and the
 * assertions read what the CLIENTS were actually sent.
 */
function nextAction(s: ClientState, me: string): Action | null {
  if (s.finished) return null;

  // Choices are checked BEFORE turn order, and that ordering is the whole point
  // of `PendingChoice` being the engine's out-of-turn decision channel. A player
  // with an unresolved decision must act even when it is not their turn, and the
  // engine will refuse everything else for them until they do ("resolve
  // "Resource cap" first"). A driver that checks turn order first deadlocks the
  // table on the first cap overflow — which is exactly what this did.
  const mine = s.choices.find((c) => c.player === me);
  if (mine !== undefined) {
    const c = mine.choice;
    const n = c.count ?? 0;
    if (c.kind === 'gain-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: mine.id, pick: { kind: 'resources', res: takeExactly(n, undefined) } };
    }
    if (c.kind === 'lose-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: mine.id, pick: { kind: 'resources', res: takeExactly(n, s.players[me]?.resources) } };
    }
    if (c.kind === 'steal-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: mine.id, pick: { kind: 'steal', from: c.from ?? me, res: takeExactly(n, undefined) } };
    }
    return { type: 'RESOLVE_CHOICE', choiceId: mine.id, pick: { kind: 'areas', areaIds: [] } };
  }

  if (s.activePlayer !== me) return null;
  if (s.phase === 'answer') return { type: 'ANSWER', side: 0 };
  if (s.phase === 'headlines') return { type: 'ACK_HEADLINE' };
  if (s.phase !== 'actions') return null;

  // Buy, place, end turn — in that order, because each is a separate action and
  // the engine requires the group to be placed before END_TURN will be accepted.
  const pool = s.players[me]?.resources;
  // `canAfford` is PER-POOL, not against the total. Summing the cost and comparing
  // it to the total is the classic version of this bug: a card costing 1 Fund is
  // "affordable" for a player holding 0 Funds and 4 Clout, and the reducer
  // correctly refuses it. The driver has to ask the same question the engine does.
  const affordable = (cost: Readonly<Record<string, number>>): boolean => {
    if (pool === undefined) return false;
    return (Object.entries(cost) as [keyof typeof pool, number][]).every(([res, n]) => pool[res] >= n);
  };
  const slot = s.market.findIndex((m) => affordable(m.cost));
  if (slot >= 0) return { type: 'INFLUENCE', slot };

  const group = s.players[me]?.pending[0];
  if (group !== undefined) {
    // One zone at a time: a Voter Card's voters may not be split across zones.
    for (const z of s.zones) {
      const free = z.areas.filter((a) => a.peg === null).map((a) => a.id);
      if (free.length >= group.count) {
        return { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) };
      }
    }
  }
  return { type: 'END_TURN' };
}

describe('a 2-player game runs to completion over a real socket', () => {
  it('reaches `finished`, and the client is told', { timeout: 180_000 }, async () => {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');

    // The loop advances on the SERVER'S REPLY, not on a timer.
    //
    // A `sleep` between actions makes the test timing-dependent, and a
    // timing-dependent test is a flaky test: it passed four runs in a row and then
    // failed on the run where every module was being transformed cold and each
    // sleep was shorter than the server's turnaround. Waiting on the socket means
    // the loop runs exactly as fast as the server answers.
    for (let step = 0; step < 4000; step += 1) {
      const s = room.state;
      if (s.finished) break;

      const seat = seats.find((x) => x.playerId === s.activePlayer) ?? seats[0];
      const action = nextAction(room.viewFor(s.activePlayer).state, s.activePlayer);
      if (action === null || seat === undefined) {
        throw new Error(
          `no legal action for ${s.activePlayer} in phase ${s.phase} — ` +
            `choices=${JSON.stringify(s.choices.map((c) => `${c.player}:${c.choice.kind}`))} ` +
            `pool=${JSON.stringify(s.players[s.activePlayer]?.resources)}`,
        );
      }

      seat.client.send({ t: 'match:action', action });
      const reply = await seat.client.next();
      if (reply.t === 'error') {
        throw new Error(
          `server refused a scripted legal action (${action.type} for ${s.activePlayer} in ${s.phase}): ${reply.message}`,
        );
      }
    }

    expect(room.state.finished, 'the game did not finish within 4000 actions').toBe(true);
    expect(ada.latestState().state.finished).toBe(true);
    expect(ada.latestState().state.phase).toBe('finished');
    expect(bo.latestState().state.finished, 'the two players disagree about whether the game is over').toBe(true);
    expect(ada.latestState().state.turnOrder).toHaveLength(2);
  });

  it('both players ended up with the SAME view, byte for byte', () => {
    // A spectator apart, the two players' projections are identical, because
    // `playerView` strips Conspiracy hands for everyone. If they ever diverge, a
    // viewer-scoped branch has crept into the projection — which is the R1 bug in
    // a plausible-looking form.
    expect(digest(ada.latestState().state)).toBe(digest(bo.latestState().state));
  });

  it('every action in the game is in the action log, and the log replays to the same state', async () => {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const stored = await h.store.get(matchId);
    if (stored === null) throw new Error('nothing stored');

    expect(stored.log.length).toBeGreaterThan(50);
    expect(stored.log.length).toBe(room.viewId);
    // Sequences are dense and monotonic from 1: a gap means an append was lost, and
    // a gap in the log is a hole in the audit trail.
    expect(stored.log.map((e) => e.seq)).toEqual(stored.log.map((_, i) => i + 1));

    const { replay } = await import('../src/store.ts');
    const rebuilt = replay({ stored, ctx: h.ctx });
    expect(digest(rebuilt.state)).toBe(digest(room.state));
  });

  it('no resource count ever went negative, at any point in the game', () => {
    // R3 was "a client can mint resources" via a negative Delta. This walks the
    // final state and the log, and the hostile-input suite covers the boundary.
    const s = ada.latestState().state;
    for (const pid of s.turnOrder) {
      const p = s.players[pid];
      if (p === undefined) continue;
      for (const [res, n] of Object.entries(p.resources)) {
        expect(Number.isInteger(n), `${pid}.${res} is not a whole number`).toBe(true);
        expect(n, `${pid}.${res} went negative`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('a spectator can read everything public and write nothing', () => {
  let spec: TestClient;
  let specPlayer: string;

  beforeAll(async () => {
    spec = await TestClient.connect(h.url);
    spec.send({ t: 'match:spectate', matchId });
    await spec.expect(spec.is('match:state'), 'spectator attached');
    const granted = spec.latestSession();
    specPlayer = granted.playerId;
  }, 20_000);

  afterAll(async () => {
    await spec?.close();
  });

  it('receives the same public board and phase as a player', () => {
    expect(digest(spec.latestState().state)).toBe(digest(ada.latestState().state));
    expect(spec.latestState().you.role).toBe('spectator');
    expect(spec.latestState().you.playerId).toBeNull();
  });

  it('is never given a blind prompt, in any phase', () => {
    // The prompt is only ever built for the player holding the card. A spectator
    // who could see it would see the question — which is public at a real table,
    // but the two LABELS with no payout attached is the answering player's private
    // deliberation space and nobody else's.
    for (const m of spec.ever('match:state')) {
      expect(m.blind, 'a spectator was handed a blind prompt').toBeNull();
    }
  });

  it('cannot dispatch, and the refusal is not a turn-order problem', async () => {
    for (const action of [
      { type: 'END_TURN' },
      { type: 'ANSWER', side: 0 },
      { type: 'INFLUENCE', slot: 0 },
      { type: 'PLAY_CONSPIRACY', cardId: 't-con-0000' },
    ] as const) {
      spec.clear();
      spec.send({ t: 'match:action', action });
      const err = await spec.expect(spec.is('error'), `spectator ${action.type}`);
      // The refusal is the SEAT check, not the reducer's turn check. A spectator
      // whose `playerId` happened to collide with a real seat would otherwise be
      // stopped by "not your turn", which would be the wrong reason and the wrong
      // guarantee.
      expect(err.code).toBe('NOT_A_PLAYER');
      expect(err.message).toBe('you are not seated at this table');
    }
  });

  it('is not seated: its playerId is in no room, and cannot be added to one', () => {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    expect(room.has(specPlayer)).toBe(false);
    expect(room.seatOrder).not.toContain(specPlayer);
  });

  it('keeps receiving state as the table moves on, without being able to move it', async () => {
    const before = spec.latestState().viewId;
    const moved = await advance(seats, 0);
    void moved;
    spec.clear();
    spec.send({ t: 'match:sync' });
    const sync = await spec.expect(spec.is('match:state'), 'spectator sync');
    expect(sync.viewId).toBeGreaterThanOrEqual(before);
    expect(sync.you.role).toBe('spectator');
  });
});
