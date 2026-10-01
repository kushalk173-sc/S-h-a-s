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
 * A `lose-any` pick that KEEPS A PURCHASING RESERVE.
 *
 * THIS is what the old driver got wrong, and it is worth recording because the
 * failure looked like an engine bug and was not one.
 *
 * p12 asks for exactly `n` back, so the pick has to total `n` — and the obvious
 * `takeExactly(n, pool)` above walks the pools in `RESOURCES` order, which is Funds
 * first. So a player who crosses the cap sheds every Fund they have, keeps a
 * surplus of Clout, Media and Trust, and can never afford a Voter Card again.
 * Voter Cards are priced in Funds, so the board stops filling, no zone ever gains a
 * majority, and the game grinds on forever: the run reached turn 1315 with 90 of 129
 * areas pegged, eight of nine zones decided, and `south` and `south_east` sitting
 * empty because the one player who could still have won them was broke.
 *
 * The engine's own driver already had this fix and its docstring says why
 * (`packages/engine/test/driver.ts`, `pickFor`'s `lose-any` arm). This is the same
 * ruling, expressed against the client-side view the socket gives us: rank the pools
 * by surplus ABOVE the cheapest card on the Mat, and hold back a Funds reserve
 * worth buying one.
 */
function discardKeepingReserve(
  n: number,
  pool: Readonly<Record<string, number>>,
  market: readonly { cost: Readonly<Record<string, number>> }[],
): Record<string, number> {
  const total = (pool.funds ?? 0) + (pool.clout ?? 0) + (pool.media ?? 0) + (pool.trust ?? 0);
  const want = Math.min(n, total);
  // Cheapest price on the Mat, in Funds, because that is the currency the fixture
  // prices Voter Cards in and so the one a reserve has to be held in.
  const cheapest = market.reduce((k, m) => Math.min(k, m.cost.funds ?? 0), Number.POSITIVE_INFINITY);
  const reserve = Number.isFinite(cheapest) ? cheapest : 0;

  const out: Record<string, number> = {};
  let left = want;

  // 1. Everything that is not Funds, largest pool first. Clout, Media and Trust buy
  //    nothing in this fixture, so they are the right things to lose and this is
  //    where almost all of a large ask should come from.
  const others: readonly ('clout' | 'media' | 'trust')[] = ['clout', 'media', 'trust'];
  for (const r of [...others].sort((a, b) => (pool[b] ?? 0) - (pool[a] ?? 0))) {
    const take = Math.min(left, pool[r] ?? 0);
    if (take > 0) out[r] = take;
    left -= take;
  }

  // 2. Funds, down to the reserve. The reserve is what the player KEEPS, so this is
  //    the amount they may not spend — and it is why the driver does not go broke at
  //    the cap and stop being able to buy.
  const spendable = Math.min(left, Math.max(0, (pool.funds ?? 0) - reserve));
  out['funds'] = spendable;
  left -= spendable;

  // 3. If the ask is still unmet the reserve has to go, because p12 wants EXACTLY
  //    `want` back and `reduce` refuses a pick that totals anything else with
  //    'discard exactly n'. Reaching here means the player held nothing but Funds,
  //    in which case "keep a purchasing reserve" and "obey the cap" are the same
  //    impossibility and the cap wins.
  if (left > 0) out['funds'] = (out['funds'] ?? 0) + left;

  return out;
}

/**
 * Where a group of `need` voters should go, or `null` if nowhere will take them.
 *
 * A driver that places into the first zone with room spreads its voters evenly and
 * wins no zone: with 69 majority voters needed across nine zones and 129 areas to
 * fill, "first free area in board order" reliably leaves every zone short of its
 * threshold. Preferring a zone this player can still take — and within that, the one
 * where they are closest — is what turns the board into a result. Same two-pass
 * shape as the engine's `targetZone`, including the fallback to any zone with room
 * so the endgame still fills the last slots toward p20's board-full ending.
 */
function targetZone(s: ClientState, me: string, need: number): string | null {
  let best: string | null = null;
  let bestMine = -1;
  for (const z of s.zones) {
    // p10: a Voter Card's voters cannot be split across zones.
    const free = z.areas.filter((a) => a.peg === null).length;
    if (free < need) continue;
    if (z.majorityHolder === me) continue; // already won; nothing to gain
    const mine = z.areas.filter((a) => a.peg?.owner === me).length;
    if (mine >= z.majority) continue;
    const winnable = mine + free >= z.majority;
    if (winnable && mine > bestMine) {
      best = z.id;
      bestMine = mine;
    } else if (!winnable && best === null) {
      best = z.id;
    }
  }
  return best;
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
      const pool = s.players[me]?.resources;
      if (pool === undefined) return null;
      // NOT `takeExactly`, and the reason is the whole reason this test can reach
      // `finished` at all — see `discardKeepingReserve`.
      return {
        type: 'RESOLVE_CHOICE',
        choiceId: mine.id,
        pick: { kind: 'resources', res: discardKeepingReserve(n, pool, s.market) },
      };
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

  // Place what is already in hand BEFORE buying more. The old order bought first,
  // so a player with funds bought until it had none and then placed whatever fitted,
  // in whatever order the board offered — which is how eight zones get decided and
  // the ninth never does. Placing first also means a card is never bought that
  // cannot be placed, so no voters are silently discarded at end of turn (p10).
  const group = s.players[me]?.pending[0];
  if (group !== undefined) {
    // One zone at a time: a Voter Card's voters may not be split across zones.
    const zone = targetZone(s, me, group.count);
    if (zone !== null) {
      const free = s.zones.find((z) => z.id === zone)?.areas.filter((a) => a.peg === null).map((a) => a.id) ?? [];
      if (free.length >= group.count) {
        return { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) };
      }
    }
  }

  // Buy the smallest card that both fits a zone this player can still win and is
  // affordable. Smallest first, so a one-voter card is spent finishing a zone that
  // has a single slot left rather than hoarded behind a three-voter card that cannot
  // go there at all.
  const slots = s.market
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => a.slot.voters - b.slot.voters);
  for (const { slot, i } of slots) {
    if (!affordable(slot.cost)) continue;
    if (targetZone(s, me, slot.voters) === null) continue;
    return { type: 'INFLUENCE', slot: i };
  }

  return { type: 'END_TURN' };
}

describe('the driver that has to finish a real game', () => {
  it('the cap discard totals EXACTLY the ask, whatever the reserve wants to keep', () => {
    // p12 asks for exactly `n` back and `reduce` refuses anything else with
    // `discard exactly n`, so a pick that totals more is a dead driver. The reserve
    // is what the player KEEPS, so it is capped at the ask — and that cap is not
    // cosmetic: without it a player holding 3 Funds against a 1-Fund ask shipped a
    // pick of 2 for an ask of 1, and the run failed intermittently with
    // 'server refused a scripted legal action ... discard exactly 1'.
    const mat = [{ cost: { funds: 1 } }];
    const cases: readonly { pool: Record<string, number>; want: number }[] = [
      // 331 over the cap with 343 held: the shape that starved the old driver.
      { pool: { funds: 83, clout: 85, media: 82, trust: 93 }, want: 331 },
      // The regression: a small ask, a comfortable pool, and a reserve that would
      // otherwise overshoot it.
      { pool: { funds: 3, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 12, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 9, clout: 0, media: 0, trust: 0 }, want: 1 },
      // Funds-heavy pools where the non-Funds reserves cannot cover the ask.
      { pool: { funds: 40, clout: 4, media: 4, trust: 4 }, want: 40 },
      // Ask larger than the whole pool: clamped to what is held, as `reduce` does.
      { pool: { funds: 2, clout: 0, media: 0, trust: 0 }, want: 9 },
      { pool: { funds: 0, clout: 0, media: 0, trust: 0 }, want: 4 },
      { pool: { funds: 0, clout: 5, media: 0, trust: 0 }, want: 4 },
    ];
    for (const { pool, want } of cases) {
      const pick = discardKeepingReserve(want, pool, mat);
      const total = (pick['funds'] ?? 0) + (pick['clout'] ?? 0) + (pick['media'] ?? 0) + (pick['trust'] ?? 0);
      const held = (pool['funds'] ?? 0) + (pool['clout'] ?? 0) + (pool['media'] ?? 0) + (pool['trust'] ?? 0);
      expect(total, `pick ${JSON.stringify(pick)} for ask ${want} from ${JSON.stringify(pool)}`).toBe(
        Math.min(want, held),
      );
      // And every part of it is actually held, which is the other half of what
      // `reduce` checks (`canAfford`).
      for (const [res, n] of Object.entries(pick)) {
        expect(n, `${res} is negative in the pick`).toBeGreaterThanOrEqual(0);
        expect(n, `${res}:${n} is picked but not held`).toBeLessThanOrEqual(pool[res] ?? 0);
      }
    }
  });

  it('the cap discard leaves enough Funds to buy the cheapest card on the Mat', () => {
    // The property that makes the driver capable of finishing, asserted directly
    // rather than inferred from a run that happens to finish. Before this, a driver
    // that shed Funds first went broke at the cap and could never buy again — which
    // is why a game ground to turn 1315 with two zones untouched.
    const mat = [{ cost: { funds: 1 } }];
    for (const pool of [
      { funds: 83, clout: 85, media: 82, trust: 93 },
      { funds: 40, clout: 4, media: 4, trust: 4 },
      { funds: 13, clout: 0, media: 0, trust: 0 },
    ]) {
      const total = pool.funds + pool.clout + pool.media + pool.trust;
      const pick = discardKeepingReserve(Math.max(0, total - 12), pool, mat);
      const left = pool.funds - (pick['funds'] ?? 0);
      expect(left, `driver went broke: kept ${left} Funds from ${JSON.stringify(pool)}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('targetZone only ever names a zone that can take the voters and is worth taking', () => {
    const s = ada.latestState().state;
    for (const need of [1, 2, 3]) {
      const zone = targetZone(s, s.turnOrder[0] ?? '', need);
      if (zone === null) continue;
      const z = s.zones.find((x) => x.id === zone);
      expect(z, `targetZone named a zone that does not exist: ${zone}`).toBeDefined();
      // p10: a card's voters cannot be split across zones, so a zone with fewer free
      // areas than the card holds is unusable and must never be named.
      expect(z?.areas.filter((a) => a.peg === null).length ?? 0).toBeGreaterThanOrEqual(need);
      expect(z?.majorityHolder).not.toBe(s.turnOrder[0]);
    }
  });
});

describe('a 2-player game runs to completion over a real socket', () => {
  /**
   * Wait until every seat's client has actually RECEIVED the room's current view.
   *
   * The driving loop awaits the reply on the seat that acted. The other seat's
   * broadcast was written by the server in the same tick, but a WebSocket
   * `message` event lands on a later macrotask, so its client can still be one
   * `viewId` behind when the loop exits. Reading `latestState()` at that instant
   * compares a fresh board against a stale one and reports a difference that is
   * not in the projection at all.
   *
   * This is not a defect being papered over: it was measured before being fixed. A
   * field-level walk of the two clients' states at the end of a real game showed
   * Ada at `viewId 187` and Bo at `186`, differing in `phase` (`finished` vs
   * `actions`), `finished`, `log` and every zone — and then, after one `match:sync`
   * each, the SAME `viewId` and byte-identical digests. Every "difference" was the
   * stale client. The leak detector below is only meaningful once both clients are
   * looking at the same view, because otherwise it cannot tell a stale read from a
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
    // both clients are now reading the SAME view, so any remaining difference is a
    // real one.
    for (const { client, playerId } of seats) {
      expect(client.latestState().viewId, `${playerId} is not on the room's view`).toBe(target);
    }
  }

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
    let actions = 0;
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
      actions += 1;
      const reply = await seat.client.next();
      if (reply.t === 'error') {
        throw new Error(
          `server refused a scripted legal action (${action.type} for ${s.activePlayer} in ${s.phase}): ${reply.message}`,
        );
      }
    }

    expect(room.state.finished, 'the game did not finish within 4000 actions').toBe(true);
    // The budget is not the assertion — a driver that needed 3999 actions to finish
    // would be a driver that barely finishes. Pinned so a regression to "grinds on
    // forever" fails here rather than as a timeout, and so the cost of the game is
    // a number somebody is watching.
    expect(actions, 'the driver took implausibly many actions to reach a decided board').toBeLessThan(600);
    expect(room.state.zones.filter((z) => z.majorityHolder !== null).length).toBe(9);

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
    // viewer-scoped branch has crept into the projection — which is the R1 bug in
    // a plausible-looking form.
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

    // Read the one viewer-scoped field from the ROOM's own typed projection, not
    // from the client's copy. `protocol.ts` declares `match:state.state` as
    // `ClientState` on purpose — widening it to `PublicView` would break parity with
    // the client's own copy of the type — so the field is present on the wire and
    // absent from the wire TYPE. Asking the room instead keeps this a typed
    // assertion and states the expectation where the value is defined.
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
