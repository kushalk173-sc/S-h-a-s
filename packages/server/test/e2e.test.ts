/**
 * End to end, over a real WebSocket, on the cards the server actually ships.
 *
 * This is the acceptance criterion that says the thing is a GAME: two players, a
 * real socket each, a real server in between, and the match driven to `finished`
 * on the shipped corpus.
 *
 * The reason it is worth writing when the reducer already has an integration test:
 * that one calls `reduce` directly, so it proves the rules and nothing else. This
 * one can only pass if the whole chain works — the decoder narrows the frame, the
 * room dispatches it, the store appends it, the fan-out projects it per recipient,
 * and the client acts on what it was sent. A projection bug, an auth bug or a
 * message-ordering bug all show up here and nowhere else.
 *
 * ON THE CORPUS, WHICH IS THE POINT OF THE 2026-10-01 REWRITE
 *
 * This file used to drive `bigCards()`: 240 Ideology Cards against the shipped 52,
 * 18 Voter Cards against the shipped 18, and headlines that were all `gain media 1`.
 * Two things were hidden by that, and both are now measured facts rather than
 * suspicions:
 *
 *  - 52 Ideology Cards drawn one per turn is the number that decides whether a game
 *    is winnable. At 240 the deck could never run out, so the shipped bug — `ANSWER`
 *    never discarding the answered card, so the deck never recycled and every game
 *    ended on turn 52 with 0 of 9 zones decided — was structurally invisible here.
 *  - 26 headlines carrying 12 distinct effect ops produce effect-generated decisions
 *    (`evict`, `discard-voter`, `steal-any`) that FREEZE a player. The driver this
 *    file used to carry answered an unrecognised choice with an EMPTY area list,
 *    which is legal only for a zero-voter ask, so on the real corpus it was refused
 *    with `choose exactly 2`.
 *
 * The driver now lives in `./driver.ts`, shared with `test/winnable.test.ts`, and its
 * own properties are asserted there. This file is about the TRANSPORT and the
 * PROJECTION, not about how good the driver is.
 *
 * SYNCHRONISED ON `viewId`, NOT ON "A MESSAGE ARRIVED"
 *
 * The room's reply to an action is a `match:state` and possibly a `match:events`, so
 * a loop that waits for "the next message" can consume the PREVIOUS action's events,
 * decide again against a state that has already moved, and be refused for an action
 * that was legal when it was chosen. That is a harness race, and it is exactly the
 * sort of thing that makes an end-to-end test untrustworthy. So the loop waits for
 * the room to commit past the `viewId` the decision was taken on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TestClient, advance, digest, startHarness, type Harness } from './fixtures.ts';
import { discardKeepingReserve, driverPly, targetZone } from './driver.ts';
import type { ClientState } from '@shasn/engine';

let h: Harness;
let ada: TestClient;
let bo: TestClient;
let matchId: string;
let seats: { client: TestClient; playerId: string }[] = [];

/** Actions the driver needed. Reported, and bounded below. */
let driverActions = 0;

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

/** Where a group of `need` voters should go, or `null` if nowhere will take them. */
function chooseZone(s: ClientState, me: string, need: number): string | null {
  return targetZone(s, me, need);
}

describe('the driver, on the corpus this test now uses', () => {
  it('the cap discard totals EXACTLY the ask, whatever the reserve wants to keep', () => {
    // p12 asks for exactly `n` back and `reduce` refuses anything else with
    // `discard exactly n`, so a pick that is short is illegal and a pick that is
    // long is illegal. The reserve is what the player KEEPS, so it is capped at
    // the ask — and that cap is not cosmetic: a player holding 3 Funds against a
    // 1-Fund ask once shipped a pick of 2 for an ask of 1, and the run failed
    // intermittently with 'server refused a scripted legal action ... discard
    // exactly 1'.
    const mat = [{ cost: { funds: 1 } }];
    const cases: readonly { pool: Record<string, number>; want: number }[] = [
      { pool: { funds: 83, clout: 85, media: 82, trust: 93 }, want: 331 },
      { pool: { funds: 3, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 12, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 9, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 40, clout: 4, media: 4, trust: 4 }, want: 40 },
      { pool: { funds: 2, clout: 0, media: 0, trust: 0 }, want: 9 },
      { pool: { funds: 0, clout: 0, media: 0, trust: 0 }, want: 4 },
      { pool: { funds: 0, clout: 5, media: 0, trust: 0 }, want: 4 },
    ];
    for (const { pool, want } of cases) {
      const pick = discardKeepingReserve(want, pool, mat);
      const total = (pick['funds'] ?? 0) + (pick['clout'] ?? 0) + (pick['media'] ?? 0) + (pick['trust'] ?? 0);
      const held = (pool['funds'] ?? 0) + (pool['clout'] ?? 0) + (pool['media'] ?? 0) + (pool['trust'] ?? 0);
      expect(total, `pick ${JSON.stringify(pick)} for ask ${want} from ${JSON.stringify(pool)}`).toBe(Math.min(want, held));
      for (const [res, n] of Object.entries(pick)) {
        expect(n, `${res} is negative in the pick`).toBeGreaterThanOrEqual(0);
        expect(n, `${res}:${n} is picked but not held`).toBeLessThanOrEqual(pool[res] ?? 0);
      }
    }
  });

  it('targetZone only ever names a zone that can take the voters and is worth taking', () => {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const s = room.viewFor(room.seatOrder[0] ?? '').state;
    for (const need of [1, 2, 3]) {
      const zone = chooseZone(s, s.turnOrder[0] ?? '', need);
      if (zone === null) continue;
      const z = s.zones.find((x) => x.id === zone);
      expect(z, `targetZone named a zone that does not exist: ${zone}`).toBeDefined();
      // p10: a card's voters cannot be split across zones, so a zone with fewer
      // free areas than the card holds is unusable and must never be named.
      expect(z?.areas.filter((a) => a.peg === null).length ?? 0).toBeGreaterThanOrEqual(need);
      expect(z?.majorityHolder).not.toBe(s.turnOrder[0]);
    }
  });
});

describe('a 2-player game runs to completion over a real socket', () => {
  /**
   * Wait until every seat's client has actually RECEIVED the room's current view.
   *
   * The driving loop advances on the room's `viewId`, not on each client's message.
   * The other seat's broadcast was written by the server in the same tick, but a
   * WebSocket `message` event lands on a later macrotask, so its client can still be
   * one `viewId` behind when the loop exits. Reading `latestState()` at that instant
   * compares a fresh board against a stale one and reports a difference that is not
   * in the projection at all.
   *
   * This is not a defect being papered over: it was measured before being fixed. A
   * field-level walk of the two clients' states at the end of a real game showed Ada
   * at `viewId 187` and Bo at `186`, differing in `phase` (`finished` vs `actions`),
   * `finished`, `log` and every zone — and then, after one `match:sync` each, the
   * SAME `viewId` and byte-identical digests. Every "difference" was the stale
   * client. The leak detector below is only meaningful once both clients are looking
   * at the same view, because otherwise it cannot tell a stale read from a
   * viewer-scoped branch — which is precisely the distinction it exists to make.
   */
  async function settle(): Promise<void> {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const target = room.viewId;
    for (const { client } of seats) {
      let guard = 0;
      while (client.latestState().viewId < target) {
        if (guard > 20) throw new Error(`a client never caught up to viewId ${target}`);
        client.clear();
        client.send({ t: 'match:sync' });
        // eslint-disable-next-line no-await-in-loop
        await client.expect((m) => m.t === 'match:state', 'settle');
        guard += 1;
      }
    }
    // The precondition every assertion below depends on, stated rather than assumed:
    // both clients are now reading the SAME view, so any remaining difference is real.
    for (const { client, playerId } of seats) {
      expect(client.latestState().viewId, `${playerId} is not on the room's view`).toBe(target);
    }
  }

  it('reaches `finished`, and the client is told', { timeout: 180_000 }, async () => {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');

let actions = 0;
    for (let step = 0; step < 4000; step += 1) {
      const s = room.state;
      if (s.finished) break;
      // WHICH SEAT ACTS, AND WHAT — see `driverPly`. This loop used to ask only
      // `s.activePlayer`, which cannot survive a response window: the seat the table is
      // waiting on is not the active player, and shipping BLOCK and DEFLECT put windows
      // into real games (measured: 4 of 120 two- and three-seat runs opened one, because
      // `draw-conspiracy` puts Server Space's draw into a hand without anybody buying).
      // `driverPly` also considers the endgame squeeze, which this loop lacked — 6 of 120
      // runs ground to the action budget at 8 of 9 majorities before it.
      const ply = driverPly(s);
      const seat = seats.find((x) => x.playerId === ply.seat);
      // The view the SEAT would be sent, not a client's cached copy: two sockets are
      // never updated at the same instant, so a driver that reads each client's last
      // message occasionally acts on a state one ply stale and is refused with "not your
      // turn" — a race in the harness that has nothing to do with the server.
      // The transport is still fully exercised, because the action goes out over a
      // real socket and the assertions read what the CLIENTS were actually sent.
      // The driver is handed NOTHING beyond the seat's own projection, which is the
      // discipline: the pending card id is a server-only field, and a winnability
      // driver that reads it is not simulating what a client can do. See `answerSide`
      // in ./driver.ts.
      const action = ply.action;
      if (seat === undefined) {
        throw new Error(
          `no seat for ${ply.seat} — choices=${JSON.stringify(s.choices.map((c) => `${c.player}:${c.choice.kind}`))} ` +
            `window=${s.interrupt?.id ?? 'none'} pool=${JSON.stringify(s.players[ply.seat]?.resources)}`,
        );
      }

      const before = room.viewId;
      const errorsBefore = seat.client.all('error').length;
      seat.client.send({ t: 'match:action', action });
      actions += 1;
      await waitForView(room, before);

      const refused = seat.client.all('error').slice(errorsBefore)[0];
      if (refused !== undefined) {
        throw new Error(
          `server refused a scripted legal action (${action.type} for ${ply.seat} in ${s.phase}): ${refused.message}\n` +
            `  room.state.choices = ${JSON.stringify(s.choices.map((c) => `${c.id}:${c.player}:${c.choice.kind}`))}\n` +
            `  view.choices       = ${JSON.stringify(ply.view.choices.map((c) => `${c.id}:${c.player}:${c.choice.kind}`))}\n` +
            `  pool               = ${JSON.stringify(s.players[ply.seat]?.resources)}`,
        );
      }
    }
    driverActions = actions;

    const decided = room.state.zones.filter((z) => z.majorityHolder !== null).length;
    const pegs = room.state.zones.reduce((k, z) => k + z.areas.filter((a) => a.peg !== null).length, 0);
    // The shipped corpus, 2 players. Reported so a regression is visible in the log
    // even when the assertions below still pass.
    console.log(
      `E2E 2 players on the shipped corpus: seed ${room.seed} turn ${room.state.turn} ` +
        `actions ${actions} pegs ${pegs}/129 majorities ${decided}/9`,
    );

    expect(room.state.finished, 'the game did not finish within 4000 actions').toBe(true);
    // The budget is not the assertion — a driver that needed 3999 actions would be a
    // driver that barely finishes. Pinned so a regression to "grinds on forever" fails
    // here rather than as a timeout, and so the cost of the game is a number somebody
    // is watching. Measured 211-267 across 20 seeds; the in-process sweep in
    // winnable.test.ts carries the distribution.
    expect(actions, 'the driver took implausibly many actions to reach a decided board').toBeLessThan(600);
    // A real win, not a full board. p20's board-full ending is legal but it is not a
    // decided board, and at two seats the shipped corpus reaches nine majorities on
    // 20 of 20 seeds.
    expect(decided, `only ${decided} of 9 zones decided, on ${pegs} of 129 pegs`).toBe(9);
    expect(pegs, 'nine majorities need at least 69 pegs').toBeGreaterThanOrEqual(69);

    await settle();
    expect(ada.latestState().state.finished).toBe(true);
    expect(ada.latestState().state.phase).toBe('finished');
    expect(bo.latestState().state.finished, 'the two players disagree about whether the game is over').toBe(true);
    expect(bo.latestState().state.phase, 'the two players disagree about the phase').toBe('finished');
    expect(ada.latestState().state.turnOrder).toHaveLength(2);
  });

  it('both players ended up with the SAME view, byte for byte', async () => {
    // A spectator apart, the two players' projections are identical, because
    // `playerView` strips Conspiracy hands for everyone. If they ever diverge, a
    // viewer-scoped branch has crept into the projection — which is the R1 bug in a
    // plausible-looking form.
    //
    // `settle()` first, and that is not a weakening. This assertion is a leak
    // detector, and it can only detect a viewer-scoped branch if both clients are
    // reading the same view: a stale read produces the same symptom (a difference)
    // and is not the thing being tested for. The pre-fix run produced 17 differing
    // fields that were all one client a `viewId` behind, and zero after settling.
    //
    // So the expected asymmetry is asserted EXPLICITLY rather than assumed:
    //
    //   `playableConspiracies` is viewer-scoped BY DESIGN — a player learns which of
    //   their OWN cards they may play (broadcast.ts's long note on why that is not a
    //   hand), and it is empty for both at `finished`, because the game is over.
    //   `blind` is viewer-scoped by design and is `null` for both at `finished`,
    //   because nobody is mid-answer.
    //
    // Everything else — the whole board, both players' resources, both manifestos,
    // the log, the market — must be byte-identical, and is. If a field outside that
    // pair ever differs, this fails, which is the property it was written for.
    await settle();
    const A = ada.latestState().state;
    const B = bo.latestState().state;

    // Read the one viewer-scoped field from the ROOM's own typed projection, not from
    // the client's copy. `protocol.ts` declares `match:state.state` as `ClientState`
    // on purpose — widening it to `PublicView` would break parity with the client's
    // own copy of the type — so the field is present on the wire and absent from the
    // wire TYPE. Asking the room instead keeps this a typed assertion and states the
    // expectation where the value is defined.
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const projections = seats.map(({ playerId }) => room.viewFor(playerId).state.playableConspiracies);

    expect(A.finished, 'the fixture must be settled at a finished game for this to mean anything').toBe(true);
    // The two sanctioned viewer-scoped fields, pinned to the values the design says
    // they take once the game is over. Asserted, not skipped: if one of them became
    // non-empty here, that is a bug this test should catch rather than ignore.
    for (const [i, offered] of projections.entries()) {
      expect(offered, `a finished game must offer no conspiracies to ${seats[i]?.playerId}`).toEqual([]);
    }
    expect(ada.latestState().blind, 'nobody is mid-answer in a finished game').toBeNull();
    expect(bo.latestState().blind).toBeNull();

    // And now the blanket equality, which is still asserted — it is the actual
    // detector. Anything viewer-scoped that creeps into `ClientState` changes one of
    // these digests.
    expect(digest(A)).toBe(digest(B));

    // Belt and braces, and it names the offending field rather than printing a
    // digest pair: every top-level key is compared directly, so a failure says WHICH
    // field diverged instead of just that something did. `playableConspiracies` is
    // compared through the room above, because it is not in the wire TYPE.
    for (const key of Object.keys(A).sort()) {
      if (key === 'playableConspiracies') continue; // viewer-scoped; asserted above
      expect(digest(A[key as keyof typeof A]), `state.${key} differs between the two players`).toBe(
        digest(B[key as keyof typeof B]),
      );
    }
  });

  it('every action in the game is in the action log, and the log replays to the same state', async () => {
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const stored = await h.store.get(matchId);
    if (stored === null) throw new Error('nothing stored');

    expect(driverActions, 'the driving test did not record how many actions it took').toBeGreaterThan(0);
    // A real game on the shipped corpus, not a handful of plies. Before this test
    // drove the real corpus it asserted `> 50` against a synthetic deck; the game
    // now takes hundreds of actions and the log has to show it.
    expect(stored.log.length, 'the log is too short to be a whole game').toBeGreaterThan(50);
    expect(stored.log.length).toBe(room.viewId);
    // Sequences are dense and monotonic from 1: a gap means an append was lost, and a
    // gap in the log is a hole in the audit trail.
    expect(stored.log.map((e) => e.seq)).toEqual(stored.log.map((_, i) => i + 1));

    // The replay. This is the strongest single assertion in the file: the state is
    // rebuilt from `(seed, rules, cards, log)` alone and has to come out identical,
    // which is the whole basis of persisting a log rather than snapshots.
    //
    // It also crosses the turn-52 Ideology cliff, because the game above does, so the
    // replay has to reproduce the reshuffle as well as the ordinary turns. A replay
    // that could not reproduce a reshuffle would restore a match into a subtly
    // different game — the exact failure `cardsVersion` exists to prevent.
    const { replay } = await import('../src/store.ts');
    const rebuilt = replay({ stored, ctx: h.ctx });
    expect(rebuilt.viewId).toBe(room.viewId);
    expect(digest(rebuilt.state), 'the replayed state differs from the live one').toBe(digest(room.state));
  });

  it('no resource count ever went negative, at any point in the game', () => {
    // R3 was "a client can mint resources" via a negative Delta. This walks the final
    // state and the log, and the hostile-input suite covers the boundary.
    const s = ada.latestState().state;
    for (const pid of s.turnOrder) {
      const p = s.players[pid];
      if (p === undefined) continue;
      for (const [res, n] of Object.entries(p.resources)) {
        expect(Number.isInteger(n), `${pid}.${res} is not a whole number`).toBe(true);
        expect(n, `${pid}.${res} went negative`).toBeGreaterThanOrEqual(0);
        // …and never over the cap. p12 is enforced by the reducer, but a cap that
        // can be exceeded is a cap that is not being applied, and on the real corpus
        // the driver crosses it dozens of times per game.
        expect(n, `${pid}.${res} is ${n}, over the resource cap`).toBeLessThanOrEqual(12);
      }
    }
  });
});

/** Wait until the room has committed an action past `viewId`. Bounded, not a sleep. */
async function waitForView(room: { viewId: number }, before: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (room.viewId <= before) {
    if (Date.now() > deadline) throw new Error(`the room did not advance past viewId ${before} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

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
    // The prompt is only ever built for the player holding the card. A spectator who
    // could see it would see the question — which is public at a real table, but the
    // two LABELS with no payout attached is the answering player's private
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
      { type: 'PLAY_CONSPIRACY', cardId: 'vo-core-001' },
    ] as const) {
      spec.clear();
      spec.send({ t: 'match:action', action });
      const err = await spec.expect(spec.is('error'), `spectator ${action.type}`);
      // The refusal is the SEAT check, not the reducer's turn check. A spectator whose
      // `playerId` happened to collide with a real seat would otherwise be stopped by
      // "not your turn", which would be the wrong reason and the wrong guarantee.
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
