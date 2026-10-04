/**
 * GAP 1 — THE ENDING. Nine majorities, the scoreboard, and every winner branch.
 *
 * WHY THIS FILE EXISTS
 *
 * The browser auditor reached round 6, turn 11, one majority, and said plainly that
 * it never got to the end. So nothing in the repository had ever walked a real game
 * through `finished` and then asked the questions that only exist after it:
 *
 *  - is the ending the STANDARD one (p7/p20, nine majorities) or p20's timer ending?
 *  - does the final state carry a scoreboard, and is it the SAME board for every
 *    seat and for a spectator?
 *  - does `winners()` name the right seats, and what happens when they tie?
 *
 * `winnable.test.ts` proves a game finishes. It asserts `finished` and counts
 * majority holders. It never asks who won, never reads a score, and never executes
 * the tie branch — so a game that ended with the wrong seat named the winner would
 * pass every test in the repository.
 *
 * THE THREE WINNER BRANCHES, AND WHY ALL THREE ARE HERE
 *
 * `winners()` in `packages/engine/src/board.ts:177` has exactly three behaviours. The
 * third had never been executed by any test:
 *
 *  1. **A clear winner** — the top score, alone. Twenty driven games hit this.
 *  2. **A tie** — every seat tied at the top is returned, as a genuine draw. p20's
 *     "privilege" tie-breaker is recorded as explicitly non-binding and out of scope
 *     for a digital implementation, so the engine reports the tie and applies none.
 *     Constructed below, because a driven game essentially never produces one.
 *  3. **A scoreless board** — `best <= 0` returns `[]`, i.e. NOBODY. That branch is
 *     the one the docstring says was a real bug: the old floor at 0 made `best === 0`
 *     match every seat, and `game-over` named the whole table as winners. Asserted
 *     here on a real `setup` at every seat count, and then shown to be UNREACHABLE
 *     through play — so it is a guard against a future board, not a rule in use.
 *
 * ## THE SCOREBOARD IS DERIVED. THE WINNER LIST IS SENT. THE TWO ARE NOT THE SAME
 * CLAIM, AND THE DISTINCTION IS THE POINT
 *
 * `match:over` used to be declared in `packages/server/src/protocol.ts:148`, handled
 * as a no-op by `packages/client/src/net/store.ts`, walked by `test/render-all.ts`'s
 * exhaustive renderer — and produced by NOTHING. `rg 'match:over' packages/` found the
 * declaration, the client's no-op arm and the renderer, and no producer.
 *
 * That is now fixed and the fix is deliberately narrow: the message is now SENT, and it
 * carries `winners` — taken from the engine's own `game-over` event, so the list on the
 * wire is the list the engine computed when it ended the game rather than a
 * recomputation that could disagree with it.
 *
 * **The SCOREBOARD is still derived, and that is unchanged.** `match:over` carries no
 * scores, because the score is `majorityCount` per seat — a pure function of the board
 * every viewer already has. Shipping a second copy of a derived number would create a
 * value that could then disagree with the projection it was derived from, which is
 * exactly the class of bug this file exists to catch. So what a player sees as the
 * scoreboard is still `scoreboard(state, you)` in
 * `packages/client/src/app/derive.ts:798`, and the consequence is the same as it was:
 * **the scoreboard can only be correct if the FINAL broadcast is complete.** A
 * projection that dropped a peg, a `majority` flag or a zone at the end of a game would
 * render a scoreboard that disagrees with the engine, and nothing client-side could
 * notice, because there is no server-sent scoreboard to disagree with.
 *
 * So section D asserts that every seat's own final projection — and the spectator's —
 * computes exactly `scores(finalState)`, that the one winner list that crosses the wire
 * names the same seats, and that `match:over` and the `game-over` event agree with each
 * other and with the engine. Three sources for one fact, which is the point: none of
 * them is a reimplementation.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  allMajoritiesFormed,
  playerView,
  scores,
  setup,
  totalVoters,
  winners,
  withArea,
  type Area,
  type ClientState,
  type Ctx,
  type GameState,
  type PlayerID,
} from '@shasn/engine';

import { viewFor } from '../src/broadcast.ts';
import { loadCtx } from '../src/index.ts';
import { decksOf } from '../src/store.ts';
import { BOARD, factsOf } from './corpus-facts.ts';
import { TestClient, startHarness, type Harness, type TestClient as Client } from './fixtures.ts';
import { driverPly, freshShippedCorpus, majoritiesOn, pegsOn, playInProcess } from './driver.ts';

const ctx: Ctx = loadCtx();
const SEATS = [2, 3, 4, 5] as const;
const SEEDS = [1, 2, 3, 4, 5] as const;
const ZONES = BOARD.zones;
const MAJORITY_PEGS = BOARD.majorityPegs;

/** p7/p20's closing line, which `endOfGame` writes to the PUBLIC log. */
const DECIDED = 'The election is decided.';

function seatIds(n: number): PlayerID[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function seatNames(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of seatIds(n)) out[p] = p;
  return out;
}

/**
 * `majorityCount` from `packages/client/src/app/derive.ts:237`, transcribed.
 *
 * TRANSCRIBED, NOT IMPORTED. The client is not a dependency of the server package,
 * and the claim under test is that the SERVER's final broadcast carries enough for a
 * client to compute this. Importing the client's function would prove the two agree
 * with each other and say nothing about the wire, which is the point.
 */
function scoreboardOf(state: ClientState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of state.turnOrder) {
    let n = 0;
    for (const z of state.zones) {
      for (const a of z.areas) {
        if (a.peg !== null && a.peg.owner === id && a.peg.majority) n += 1;
      }
    }
    out[id] = n;
  }
  return out;
}

/** `zonesHeld` from the same file: the zones a seat's `majorityHolder` names. */
function zonesHeldBy(state: ClientState, player: PlayerID): readonly string[] {
  return state.zones.filter((z) => z.majorityHolder === player).map((z) => z.name);
}

function sortedRecord(r: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(r).sort()) out[k] = r[k] ?? 0;
  return out;
}

/**
 * A fully decided board whose nine zone majorities are split as evenly as the zone
 * sizes allow between `holders`.
 *
 * Pegs go on through the engine's own `withArea`, which recounts the zone, so the
 * `majority` flags and `majorityHolder` in the resulting state are the ENGINE's and
 * not this file's. A hand-written `majority: true` would let the test pass on a board
 * the engine would have scored differently, which is the failure mode a fixture for a
 * scoring rule is most prone to.
 *
 * The split is NOT round-robin, and that was the first thing this got wrong. The nine
 * zone majorities on this board are 6, 11, 6, 9, 5, 9, 6, 11, 6 — sum 69 — and a plain
 * round-robin hands out 21 / 27 / 21, which is no tie at all. What produces an exact
 * tie is LARGEST-FIRST onto the currently-smallest seat: 11→p1, 11→p2, 9→p3, 9→p3, 6→p1,
 * 6→p2, 6→p1, 6→p2, 5→p3 gives 23 / 23 / 23. So the grouping is computed rather than
 * listed, which means it stays right if a future board changes the zone sizes — and the
 * test then states the number it achieved, so a board that cannot be split evenly fails
 * with the arithmetic rather than quietly asserting a tie that is not there.
 */
function decideZonesFor(state: GameState, holders: readonly PlayerID[]): GameState {
  const sums = new Map<PlayerID, number>(holders.map((p) => [p, 0]));
  const smallest = (): PlayerID => {
    let best = holders[0] ?? '';
    for (const p of holders) if ((sums.get(p) ?? 0) < (sums.get(best) ?? 0)) best = p;
    return best;
  };
  const order = [...state.zones].sort((a, b) => b.majority - a.majority || a.id.localeCompare(b.id));
  const ownerOf = new Map<string, PlayerID>();
  for (const zone of order) {
    const holder = smallest();
    ownerOf.set(zone.id, holder);
    sums.set(holder, (sums.get(holder) ?? 0) + zone.majority);
  }

  let s = state;
  for (const zone of state.zones) {
    const holder = ownerOf.get(zone.id);
    if (holder === undefined) throw new Error('decideZonesFor: a zone was left unassigned');
    let placed = 0;
    for (const area of zone.areas) {
      if (placed >= zone.majority) break;
      s = withArea(s, { ...area, peg: { owner: holder, majority: false } } as Area);
      placed += 1;
    }
  }
  return s;
}

// ─────────────────────── A. the ending, in process, at every seat count ───────────────────────

describe('a real game reaches the standard ending and names its winner, at every seat count', () => {
  for (const n of SEATS) {
    it(`${n} players: ${SEEDS.length} seeds finish on nine majorities, and the winner is the top score`, () => {
      const rows = SEEDS.map((seed) => ({
        seed,
        run: playInProcess(freshShippedCorpus(seed, n, ctx), ctx, { maxActions: 1200 }),
      }));

      expect(
        rows.filter((r) => !r.run.state.finished).map((r) => `seed ${r.seed}: ${r.run.reason}`),
        `${n} players: a game never reached the ending`,
      ).toEqual([]);
      let winnerIsNotMostZones = 0;
      const spread = (xs: readonly number[]): string => `${Math.min(...xs)}..${Math.max(...xs)}`;

      for (const { seed, run } of rows) {
        const s = run.state;
        const tag = `seed ${seed}`;

        // 1. THE ENDING IS THE STANDARD ONE. `allMajoritiesFormed` is the engine's own
        //    predicate and it is literally the condition `endOfGame` was called on, so
        //    this asserts the branch rather than a proxy for it. p20's timer ending
        //    (a full board) would fail it.
        expect(s.phase, `${tag}: finished in phase ${s.phase}`).toBe('finished');
        expect(majoritiesOn(s), `${tag}: ended on ${majoritiesOn(s)} of ${ZONES} majorities`).toBe(ZONES);
        expect(allMajoritiesFormed(s), `${tag}: the engine disagrees with its own count`).toBe(true);
        expect(pegsOn(s), `${tag}: decided ${ZONES} zones on only ${pegsOn(s)} pegs`).toBeGreaterThanOrEqual(MAJORITY_PEGS);

        // 2. THE ENDING IS ANNOUNCED on the PUBLIC log, exactly once, last. A client
        //    can therefore render it without the server telling it separately — which
        //    it has to, because `match:over` does not exist.
        expect(s.log.filter((l) => l.text === DECIDED).length, `${tag}: the closing line is not logged exactly once`).toBe(1);
        expect(s.log[s.log.length - 1]?.text, `${tag}: something was logged after the closing line`).toBe(DECIDED);

        // 3. THE SCORE. A fully decided board carries exactly `majority` majority
        //    voters per zone, so the scores must sum to the board constant. A per-zone
        //    `majority` flag disagreeing with `majorityHolder` breaks this.
        const sc = scores(s);
        expect(Object.keys(sc).sort(), `${tag}: scores omit a seat`).toEqual([...s.turnOrder].sort());
        const total = s.turnOrder.reduce((k, p) => k + (sc[p] ?? 0), 0);
        expect(total, `${tag}: the scores sum to ${total}, not the ${MAJORITY_PEGS} majority pegs on a decided board`).toBe(
          MAJORITY_PEGS,
        );

        // 4. THE WINNER. `winners()` returns the argmax set and nobody else.
        const w = winners(s);
        expect(w.length, `${tag}: a board with ${total} majority voters named ${w.length} winner(s)`).toBeGreaterThan(0);
        const best = Math.max(...s.turnOrder.map((p) => sc[p] ?? 0));
        const argmax = s.turnOrder.filter((p) => sc[p] === best);
        expect([...w].sort(), `${tag}: winners() disagreed with the top score`).toEqual([...argmax].sort());
        expect(best, `${tag}: a winner was named on a scoreless board`).toBeGreaterThan(0);
        for (const p of w) expect(sc[p], `${tag}: ${p} named a winner on ${sc[p]} of ${best}`).toBe(best);

        // 5. THE BOARD AND THE WINNER ARE CONSISTENT, read back off PROJECTIONS rather
        //    than off the state, so this is the computation the client performs.
        //
        //    WHAT IS ASSERTED IS NOT "the winner holds the most zones", because that is
        //    FALSE and measurably so: p20 scores MAJORITY VOTERS, and the zones are
        //    worth 5, 6, 9 or 11 each. A seat that takes the three big zones (11+11+9 =
        //    31) can lose to a seat that takes four small ones and a fifth (6+6+6+6+5 =
        //    29 — and beat it on zones). The invariant that does hold is exactly one
        //    holder per zone, and the winner is the top score.
        const bySeat = Object.fromEntries(s.turnOrder.map((p) => [p, zonesHeldBy(playerView(s, p), p).length]));
        expect(
          s.turnOrder.reduce((k, p) => k + (bySeat[p] ?? 0), 0),
          `${tag}: zone majorities are not partitioned across the seats: ${JSON.stringify(bySeat)}`,
        ).toBe(ZONES);
        for (const p of w) {
          expect(
            bySeat[p],
            `${tag}: ${p} is a winner on ${sc[p]} majority voters but holds no zone at all`,
          ).toBeGreaterThan(0);
        }
        let mostZonesSeat = s.turnOrder[0] ?? '';
        for (const p of s.turnOrder) if ((bySeat[p] ?? 0) > (bySeat[mostZonesSeat] ?? 0)) mostZonesSeat = p;
        if (mostZonesSeat !== w[0]) winnerIsNotMostZones += 1;

        // 6. AND EVERY SEAT'S OWN PROJECTION COMPUTES THE SAME SCOREBOARD. This is the
        //    scoreboard claim: no `match:over` exists, so the final broadcast IS the
        //    scoreboard and has to be complete for every viewer.
        for (const p of [...s.turnOrder, null] as const) {
          const wire = scoreboardOf(viewFor(s, ctx.cards, p));
          expect(sortedRecord(wire), `${tag}: the ${p ?? "spectator"} projection scores the board differently`).toEqual(
            sortedRecord(sc),
          );
        }
      }

      console.log(
        `ENDING n=${n} seeds ${SEEDS.join(',')}: turn ${spread(rows.map((r) => r.run.state.turn))} | ` +
          `pegs ${spread(rows.map((r) => pegsOn(r.run.state)))}/${BOARD.areas} | ` +
          `${rows.map((r) => `${r.seed}:${winners(r.run.state).join('+')}(${JSON.stringify(scores(r.run.state))})`).join(' ')} | ` +
          `winner-is-not-most-zones ${winnerIsNotMostZones}/${rows.length}`,
      );
    });
  }
});

// ────────────────────────────── B. the tie branch ──────────────────────────────

describe('the tie branch of the winner rule executes, and it is a draw', () => {
  it('three seats on exactly 23 majority voters each are ALL named winners', () => {
    const tied = decideZonesFor(freshShippedCorpus(1, 3, ctx), ['p1', 'p2', 'p3']);

    // The constructed board really is fully decided, by the engine's own predicate.
    expect(allMajoritiesFormed(tied), 'the constructed board is not fully decided').toBe(true);
    const sc = scores(tied);
    expect(sc, `the constructed board is not a three-way tie: ${JSON.stringify(sc)}`).toEqual({ p1: 23, p2: 23, p3: 23 });

    // THE BRANCH. Three seats tied at the top, all three returned, in turn order.
    expect(winners(tied), 'a three-way tie did not name all three seats').toEqual(['p1', 'p2', 'p3']);

    // AND NO TIE-BREAKER IS SILENTLY APPLIED. p20 names only majority voters, so a
    // tie-break on total pegs would pick one of the three on a rule nobody printed.
    // Total pegs are made deliberately unequal here: zones get their majority pegs and
    // nothing else, so a 11-majority zone and a 5-majority zone differ.
    const totals = Object.fromEntries(tied.turnOrder.map((p) => [p, totalVoters(tied, p)]));
    expect(totals, 'the tie-board does not distinguish the seats by total pegs').toEqual({ p1: 23, p2: 23, p3: 23 });
    // …so distinguish them a different way: give one seat a SPARE peg in a zone it
    // already holds and the tie must survive it. `recount` flips only `majority`
    // voters symbol-side up (p8), so a spare peg raises `totalVoters` without raising
    // the score — and a `winners()` that tie-broke on total pegs would break here.
    const spareZone = tied.zones.find((z) => z.majorityHolder === 'p1' && z.areas.some((a) => a.peg === null));
    if (spareZone === undefined) throw new Error('no zone held by p1 with a free area');
    const free = spareZone.areas.find((a) => a.peg === null);
    if (free === undefined) throw new Error('unreachable');
    const before = totalVoters(tied, 'p1');
    const padded = withArea(tied, { ...free, peg: { owner: 'p1', majority: false } } as Area);
    expect(totalVoters(padded, 'p1'), 'the spare peg did not land').toBe(before + 1);
    expect(scores(padded), 'a spare peg changed the SCORE, which would be a scoring bug').toEqual(sc);
    expect(winners(padded), 'a spare total-voter peg broke the tie').toEqual(['p1', 'p2', 'p3']);
  });

  it('a tie is arithmetically IMPOSSIBLE at two seats, and that is a fact rather than an omission', () => {
    // Nine zones carry 69 majority voters and 69 is odd, so two seats cannot both sit
    // on the top score of a fully decided board. Stated so the two-seat sweep above is
    // not read as "the tie case was forgotten at 2 seats".
    expect(
      MAJORITY_PEGS % 2 === 1,
      `the board carries an EVEN number of majority voters (${MAJORITY_PEGS}), so a two-seat tie became possible and this test's premise is wrong`,
    ).toBe(true);

    const split = decideZonesFor(freshShippedCorpus(1, 2, ctx), ['p1', 'p2']);
    expect(allMajoritiesFormed(split), 'the two-seat constructed board is not decided').toBe(true);
    const sc = scores(split);
    expect(sc.p1 === sc.p2, `a two-seat tie occurred, which should be impossible: ${JSON.stringify(sc)}`).toBe(false);
    expect(winners(split).length, 'the two-seat board named two winners').toBe(1);

    // A ZONE-level majority tie is geometrically impossible on this board for a
    // separate reason, recorded on `recount` in board.ts: every zone has
    // `capacity === 2 * majority - 1`, so two players cannot both reach the threshold.
    // Asserted here because it is the reason the scoreboard cannot produce a two-way
    // tie at ANY zone count by another route.
    for (const z of split.zones) {
      const counts = new Map<PlayerID, number>();
      for (const a of z.areas) if (a.peg !== null) counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
      const reached = [...counts.values()].filter((v) => v >= z.majority);
      expect(reached.length, `${z.id} was reachable by ${reached.length} seats at once`).toBeLessThanOrEqual(1);
      expect(z.capacity, `${z.id} is not 2*majority-1, so a zone majority tie became possible`).toBe(2 * z.majority - 1);
    }
  });
});

// ───────────────────────────── C. the scoreless-board branch ─────────────────────────────

describe('the scoreless-board branch executes and returns NOBODY', () => {
  for (const n of SEATS) {
    it(`${n} players: a freshly dealt board has no winner rather than the whole table`, () => {
      const base = freshShippedCorpus(1, n, ctx);

      // The precondition the branch exists for: `best === 0` for EVERY seat.
      const sc = scores(base);
      expect(Object.values(sc).every((v) => v === 0), `a fresh board is not scoreless: ${JSON.stringify(sc)}`).toBe(true);
      expect(pegsOn(base), 'a fresh board has pegs on it').toBe(0);
      expect(allMajoritiesFormed(base), 'a fresh board is already decided').toBe(false);

      // THE BRANCH. With the old `Math.max(0, …)` floor this returned the whole turn
      // order and `game-over` named every seat as a winner of a game nobody played.
      expect(winners(base), 'a scoreless board named a winner').toEqual([]);
    });
  }

  it('CHARACTERISATION: the branch is unreachable through play, at any deck size', () => {
    // The honest half. `endOfGame` is reached from exactly two places — p7/p20's nine
    // majorities, and R10's exhausted-Ideology-deck escape — and this measures both.
    // What it guarantees is that `best <= 0` in board.ts is a guard against a FUTURE
    // board rather than a rule in use today; what it characterises is that no deck the
    // driver can be handed today produces a scoreless `endOfGame`.
    //
    // Deck size 1 is the tightest case and is why it is in the list: with one Ideology
    // Card the draw pile empties on turn one, so if `ANSWER` did not discard the card
    // back, the very next draw would have nothing to draw and the game's answer would
    // be `Ideology deck is exhausted` — the shipped bug, whose branch IS `endOfGame`.
    const shipped = factsOf(ctx.cards).dealt.ideology;
    const sizes = [1, 2, 3, 8, 20, shipped];
    const rows: string[] = [];
    const scorelessFinished: string[] = [];
    const runs = 6;
    for (const size of sizes) {
      const cards = { ...ctx.cards, ideology: Object.fromEntries(Object.entries(ctx.cards.ideology).slice(0, size)) };
      const small: Ctx = { rules: ctx.rules, cards };
      let exhausted = 0;
      let finished = 0;
      for (let seed = 1; seed <= runs; seed += 1) {
        const r = playInProcess(
          setup({ players: seatIds(2), names: seatNames(2), cards, seed, ...decksOf(cards) }),
          small,
          { maxActions: 1200 },
        );
        if (r.state.log.some((l) => l.text.includes('Ideology deck is exhausted'))) exhausted += 1;
        if (r.state.finished) {
          finished += 1;
          // THE REACHABILITY CLAIM, stated on the states that actually ended.
          if (winners(r.state).length === 0) scorelessFinished.push(`deck ${size} seed ${seed}`);
        }
      }
      rows.push(`deck ${size}: finished ${finished}/${runs} exhausted ${exhausted}/${runs}`);
    }
    console.log(`DRAW-BRANCH reachability, 2 seats, ${runs} seeds per deck: ${rows.join(' | ')}`);

    // (a) R10's escape never fires, so the exhaustion route to a scoreless `endOfGame`
    //     is closed. This is the property that used to be tested by a turn-count proxy
    //     and is now the branch itself.
    expect(rows.filter((r) => !r.includes('exhausted 0/6')), 'the Ideology deck exhausted in at least one run').toEqual([]);
    // (b) And no game that FINISHED did so on a scoreless board, which is the direct
    //     statement that `winners()`'s `best <= 0` arm is not reached by play. A
    //     one-card Ideology deck is in the list precisely because it is the tightest
    //     case: turn one empties the draw pile, and if `ANSWER` did not discard the
    //     card back, the next draw would have nothing and this is the branch.
    expect(scorelessFinished, 'a game finished on a scoreless board, so the draw branch IS reachable').toEqual([]);
  });
});

// ───────────────────────────── D. the ending over a real socket ─────────────────────────────

describe('the ending survives the wire, with a spectator watching', () => {
  const open: Harness[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close().catch(() => undefined);
    for (const h of open.splice(0)) await h.close().catch(() => undefined);
  });

  /**
   * `n` seats and ONE spectator, driven to `finished` over real WebSockets.
   *
   * The spectator is here for the reason that is the point of the section: with no
   * `match:over` on the wire the scoreboard is DERIVED from the broadcast, so a
   * spectator's view of the result is computed from a projection nobody has checked
   * against the engine. It is checked here, and it is the only assertion in this file
   * that would notice if the final fan-out skipped anybody.
   */
  async function driveToTheEnd(n: number): Promise<{
    state: GameState;
    matchId: string;
    actionCount: number;
    seats: readonly { client: Client; playerId: string }[];
    spectator: Client;
  }> {
    const harness = await startHarness({ dispatchRate: 4000, messageRate: 4000 });
    open.push(harness);

    const host = await TestClient.connect(harness.url);
    clients.push(host);
    host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: n as 2, isPrivate: false });
    const created = await host.expect(host.is('lobby:state'), 'the lobby');
    const lobbyId = created.lobby.lobbyId;

    const seats: { client: Client; playerId: string }[] = [
      { client: host, playerId: host.latestSession().playerId },
    ];
    for (let i = 1; i < n; i += 1) {
      const c = await TestClient.connect(harness.url);
      clients.push(c);
      c.send({ t: 'lobby:join', lobbyId, name: `P${i + 1}` });
      await c.expect(c.is('lobby:state'), `seat ${i + 1} joined`);
      seats.push({ client: c, playerId: c.latestSession().playerId });
    }

    const spectator = await TestClient.connect(harness.url);
    clients.push(spectator);
    spectator.send({ t: 'lobby:spectate', lobbyId });
    await spectator.expect(spectator.is('lobby:state'), 'the spectator arrived');

    host.send({ t: 'lobby:start' });
    const started = await host.expect(host.is('match:state'), 'the match started');
    const matchId = started.matchId;
    const update = await spectator.expect(spectator.is('lobby:state'), 'the spectator was told the match id');
    spectator.clear();
    spectator.send({ t: 'match:spectate', matchId: update.lobby.matchId ?? matchId });
    await spectator.expect(spectator.is('session:granted'), 'the spectator attached');

    const room = harness.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');

    let actionCount = 0;
    for (let step = 0; step < 4000 && !room.state.finished; step += 1) {
      const s = room.state;
      // THE DRIVER IS `driverPly`, the same one `winnable.test.ts` and `e2e.test.ts`
      // use — not a hand-rolled ply chooser. An earlier version of this helper chose
      // `END_TURN` on the actions phase and bought nothing at all, so no voter ever
      // reached the board, no zone was ever decided, and four socket runs ground to
      // the 4000-step budget while holding every `match:state` they had been sent in
      // memory (which is what took the worker out with an OOM). Using the driver is
      // also the only honest option: a weaker driver would measure the ending of a
      // different game.
      const ply = driverPly(s);
      const who = seats.find((x) => x.playerId === ply.seat);
      if (who === undefined) throw new Error(`no socket for ${ply.seat} at ${n} seats`);

      const before = room.viewId;
      const errorsBefore = who.client.all('error').length;
      who.client.send({ t: 'match:action', action: ply.action });
      actionCount += 1;
      await waitForView(room, before, () => who.client.all('error').length - errorsBefore);
      const refused = who.client.all('error').slice(errorsBefore)[0];
      if (refused !== undefined) {
        throw new Error(
          `the server refused a scripted legal action at ${n} seats: ${refused.message} ${JSON.stringify(ply.action)}`,
        );
      }
    }
    return { state: room.state, matchId, actionCount, seats, spectator };
  }

  /**
   * Wait until EVERY connection has actually been sent the finished board.
   *
   * The room commits an action and THEN publishes, so `room.state.finished` becomes
   * true a moment before the last `match:state` has crossed the wire. Reading
   * `latestState()` the instant the loop exits therefore races the final broadcast —
   * and it failed on the HOST seat on all four seat counts when it was written that
   * way, which is a harness race and not a server bug. So this is a bounded poll on an
   * observable per connection rather than a sleep and not an assumption.
   */
  async function awaitFinalBroadcast(conns: readonly Client[], label: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    const pending = (): Client[] => conns.filter((c) => c.ever('match:state').at(-1)?.state.finished !== true);
    while (pending().length > 0) {
      if (Date.now() > deadline) {
        throw new Error(
          `${label}: ${pending().length} connection(s) never received the finished board (last viewIds ` +
            `${conns.map((c) => String(c.ever('match:state').at(-1)?.viewId ?? 'none')).join(',')})`,
        );
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async function waitForView(
    room: { viewId: number },
    before: number,
    refused: () => number,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (room.viewId <= before) {
      if (refused() > 0) return;
      if (Date.now() > deadline) throw new Error(`the room did not advance past viewId ${before} within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  for (const n of SEATS) {
    it(
      `${n} players over a socket: every seat AND the spectator are sent the finished board, and the same scoreboard`,
      { timeout: 240_000 },
      async () => {
        const run = await driveToTheEnd(n);
        const s = run.state;
        expect(s.finished, `${n} players: the socket game did not finish`).toBe(true);
        expect(majoritiesOn(s), `${n} players: ${majoritiesOn(s)} of ${ZONES} majorities over a socket`).toBe(ZONES);

        const engineScores = scores(s);
        const engineWinners = winners(s);

        const everyConnection = [...run.seats.map((x) => x.client), run.spectator];
        await awaitFinalBroadcast(everyConnection, `${n} players over a socket`);
        console.log(
          `SOCKET ENDING n=${n}: turn ${s.turn} actions ${run.actionCount} pegs ${pegsOn(s)}/${BOARD.areas} ` +
            `scores ${JSON.stringify(engineScores)} winners ${JSON.stringify(engineWinners)}`,
        );

        // 1. EVERY CONNECTION GOT THE FINISHED BOARD — each socket's LAST
        //    `match:state`, not one shared read. A fan-out that skipped the spectator,
        //    or the seat that did not make the last move, would leave one connection
        //    rendering a board that is still in play.
        const views: { who: string; state: ClientState }[] = [];
        for (const { client, playerId } of run.seats) {
          const msg = client.latestState();
          expect(msg.state.finished, `${playerId} was never sent the finished board`).toBe(true);
          expect(msg.state.phase, `${playerId}'s last state is in phase ${msg.state.phase}`).toBe('finished');
          expect(msg.you.role, `${playerId} was downgraded at the end of the game`).toBe('player');
          expect(msg.you.playerId, `${playerId}'s final state has the wrong player id`).toBe(playerId);
          views.push({ who: playerId, state: msg.state });
        }
        const spec = run.spectator.latestState();
        expect(spec.state.finished, 'the spectator was never sent the finished board').toBe(true);
        expect(spec.state.phase, `the spectator's last state is in phase ${spec.state.phase}`).toBe('finished');
        expect(spec.you.role).toBe('spectator');
        views.push({ who: 'spectator', state: spec.state });

        // 2. AND THEY ALL COMPUTE THE SAME SCOREBOARD. No scoreboard is sent on the
        //    wire, so this equality IS the scoreboard's correctness.
        for (const { who, state } of views) {
          expect(sortedRecord(scoreboardOf(state)), `${who} scored the finished board differently`).toEqual(
            sortedRecord(engineScores),
          );
          expect(state.log.some((l) => l.text === DECIDED), `${who} has a finished board whose log does not say so`).toBe(
            true,
          );
        }

        // 3. THE `game-over` EVENT, which IS broadcast, names the same seats. Together with
        //    `match:over` it is the winner list on the wire, and it has to be right — and
        //    it reaches every watcher, spectator included.
        const all = everyConnection;
        const overEvents = all
          .flatMap((c) => c.all('match:events').flatMap((m) => m.events))
          .filter((e): e is Extract<typeof e, { type: 'game-over' }> => e.type === 'game-over');
        expect(overEvents.length, 'no connection was ever sent a game-over event').toBeGreaterThan(0);
        for (const over of overEvents) {
          expect([...over.winners].sort(), 'the game-over event named the wrong seats').toEqual([...engineWinners].sort());
        }
        for (const c of all) {
          const own = c
            .all('match:events')
            .flatMap((m) => m.events)
            .filter((e): e is Extract<typeof e, { type: 'game-over' }> => e.type === 'game-over');
          expect(own.length, 'a watcher never received the game-over event').toBeGreaterThan(0);
        }

        // 4. `match:over` IS SENT NOW, once per watcher, and it agrees with everything
        //    else. This replaces a characterisation assertion that the server never sent
        //    it — which was true, and was the reason a client author building against
        //    the declaration would have found nothing on the wire.
        //
        //    It is asserted as AGREEMENT rather than as presence alone, because presence
        //    is the easy half: three sources now name the winner (this message, the
        //    `game-over` event, and `winners(state)`) and the only interesting claim is
        //    that none of them is a reimplementation.
        const overs = all.flatMap((c) => c.all('match:over'));
        expect(overs.length, 'no connection was ever sent a match:over').toBe(all.length);
        for (const over of overs) {
          expect(over.matchId, 'match:over named the wrong match').toBe(run.matchId);
          expect([...over.winners].sort(), 'match:over named the wrong seats').toEqual([...engineWinners].sort());
        }
        for (const c of all) {
          const own = c.all('match:over');
          expect(own, 'a watcher received match:over more than once — the end is being announced repeatedly').toHaveLength(1);
        }

        // …and it carries NO SCORE, deliberately: the scoreboard is derived from the
        // board every viewer already has, and a second copy of a derived number is a
        // value that can then disagree with the projection it came from. Pinned because
        // "we added the scoreboard while we were here" is the obvious next change and it
        // is the one that would break section 2 above.
        for (const over of overs) {
          expect(Object.keys(over).sort(), 'match:over grew a field the derived-scoreboard claim does not allow').toEqual([
            'matchId',
            't',
            'winners',
          ]);
        }

        // 5. The store agrees, because the log is the authority.
        const harness = open[0];
        const stored = await harness?.store.get(run.matchId);
        expect(stored, 'the finished match was not persisted').not.toBeNull();
        expect(stored?.seed).toBe(harness?.server.hub.rooms.get(run.matchId)?.seed ?? -1);
      },
    );
  }
});