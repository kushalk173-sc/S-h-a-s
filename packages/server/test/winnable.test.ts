/**
 * THE GAME IS WINNABLE — at every seat count, on the shipped corpus, across a
 * range of seeds, over a real socket.
 *
 * There are three independent claims of this, and the redundancy is deliberate:
 *
 *  - `packages/engine/test/winnable.test.ts` calls `reduce` directly against a
 *    GENERATED deck with the shipped SIZES (52 Ideology / 18 Voter / 22 Conspiracy
 *    / 26 Headline) but generated card bodies. It proves the RULES are survivable.
 *  - THIS file drives the REAL corpus, through the real server, over a real
 *    WebSocket, so it also proves the dispatch, projection and fan-out path carry a
 *    winning game all the way to `finished`.
 *  - `e2e.test.ts` drives a whole match and then audits the log, the replay and the
 *    projections at the end of it.
 *
 * WHY THE SEED SWEEP IS THE ASSERTION
 *
 * A driver that wins on seed 19 and stalls on seed 20 is not proving the game is
 * winnable, it is proving a seed is winnable. So the assertions below are about a
 * DISTRIBUTION: 20 seeds at each of the four seat counts, and the requirement is
 * that every one of them reaches an ending rather than a lucky handful.
 *
 * THE NUMBERS, RE-MEASURED after G21 (20 seeds per seat count, shipped corpus)
 *
 *   | seats | finished | nine majorities | turn min / med / max | actions      |
 *   |-------|---------:|----------------:|---------------------:|-------------:|
 *   |     2 |     20/20 |          20/20  |  36 / 51 / 59        | 210 .. 303   |
 *   |     3 |     20/20 |          20/20  |  43 / 55 / 69        | 232 .. 335   |
 *   |     4 |     20/20 |          20/20  |  45 / 66 / 80        | 235 .. 398   |
 *   |     5 |     20/20 |          20/20  |  57 / 64 / 102       | 290 .. 479   |
 *
 * 80 of 80 games reach a nine-majority finish. No seed stalls, no seat count is
 * partial, and every seat count goes PAST turn 52 — which is the whole claim, because
 * 52 Ideology Cards drawn one per turn cannot reach turn 53 at all.
 *
 * These are NOT the numbers this file carried before G21, and the difference is the
 * point. The old maxima were 59 / 99 / 87 / 99 and the old 2-seat worst case spent
 * 1200 actions. Three fixes moved them, and none of them made the game shallower by
 * accident — each removed a way the DRIVER could fail to act:
 *
 *  - The driver ignored `choice.from`, so a `steal-any` whose victim the card had
 *    pinned got a redirected pick the engine refused, and it treated "the victim holds
 *    nothing" as having no answer when the empty pick is the legal one.
 *  - The driver ignored `choice.scope` and the `min(count, targetableCount)` clamp on
 *    the three voter kinds, so it offered a pick of a length the engine would never
 *    accept. 3 seats, seed 4, stranded on turn 11.
 *  - `shouldSqueeze` asked whether a ZONE was worth spending in rather than whether a
 *    PURCHASE was available, which livelocked 2 seats, seed 18: the Mat held no
 *    1-voter card, nobody bought, and a Mat nobody buys from never refills. That seed
 *    ran to turn 363 and 1200 actions with 111 of 129 pegs and no legal ending.
 *
 * The old maxima were high partly because those seeds ground. Fixing them shortened
 * the deepest games — 3 seats went 99 -> 69 — and took a hand-tuned floor down with
 * them, which is why the deck-cliff assertion now counts ANSWERS instead. See the note
 * on that test.
 *
 * THE PREVIOUS MEASUREMENT, kept because the difference is the story (2026-10-01)
 *
 *   | seats | finished | nine majorities | turn min / med / max | actions      |
 *   |     2 |     20/20 |          20/20  |  39 / 51 / 59        | 227 .. 292   |
 *   |     3 |     20/20 |          20/20  |  44 / 56 / 99        | 239 .. 463   |
 *   |     4 |     20/20 |          20/20  |  50 / 64 / 87        | 265 .. 415   |
 *   |     5 |     20/20 |          20/20  |  57 / 70 / 99        | 294 .. 481   |
 *
 * THE DRIVER DOES NOT PEEK, AND THAT IS WHY THE NUMBERS ARE WHAT THEY ARE
 *
 * An earlier version of this driver chose the answer side by its payout, which meant
 * reading the pending card off the authoritative state. That is reading a server-only
 * field, the server's secrets gate forbids it, and — the part that matters — it is
 * not something a player can do. The two labels are all a client gets; the payout is
 * nothing but the seed-derived ORDER is.
 *
 * So the driver always answers the left label now, and the result is BETTER, not
 * worse: 3 seats went from 19/20 to 20/20. The seed that used to strand — 3 seats,
 * seed 11, turn 364 with 117 of 129 areas pegged and two zones mathematically out of
 * reach — now finishes with nine majorities. Peeking had been giving one seat a
 * richer income than the other, which skewed the economy; answering consistently is
 * both the honest claim and the stronger one.
 *
 * TWO OTHER DRIVER FIXES, both invisible to the synthetic corpus
 *
 * The `targetZone` that used to fall back to "first zone with room" whenever no zone
 * could be won. Against the shipped corpus that fallback was actively harmful: over 12
 * seeds x 4 seat counts, 19 of 48 games filled all 129 areas and still ended with only
 * 6 to 8 of 9 zones decided, because the voters went to zones that could never reach a
 * threshold. Removing the fallback took the nine-majority rate to 48/48.
 *
 * And the cap discard, which kept a Funds-only reserve. Eight of the shipped corpus's
 * 18 Voter Cards are priced with no Funds at all, so that rule drove a player to
 * `{funds: 12, clout: 0, media: 0, trust: 0}` against a Mat it could not buy, and ground
 * to turn 398 with 12 pegs on the board. See `discardKeepingReserve` in ./driver.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { playerView, type Action, type Ctx, type GameState, type PlayerID } from '@shasn/engine';

import { loadCtx } from '../src/index.ts';
import { BOARD, deckCliffComplaints, factsOf, ideologyAnswers } from './corpus-facts.ts';
import { TestClient, startHarness, type Harness, type TestClient as Client } from './fixtures.ts';
import {
  discardKeepingReserve,
  driverPly,
  freshShippedCorpus,
  majoritiesOn,
  pegsOn,
  playInProcess,
  targetZone,
  type RunResult,
} from './driver.ts';

const ctx: Ctx = loadCtx();

/**
 * The two numbers every assertion in this file is measured against, DERIVED.
 *
 * Both used to be typed in here — `MAJORITY_PEGS = 69` and `SHIPPED_IDEOLOGY = 52` —
 * and `69` was typed a second time in `interrupt-window.test.ts` and `129` a third in
 * `e2e.test.ts`. Three copies of a board constant is how a board constant comes to
 * disagree with the board; a hand-copy of the Ideology deck size is a hand-copy of the
 * fact that decides whether a game is winnable, so the day the corpus grew it, this
 * file would have demanded an edit that taught it nothing.
 *
 * So the pegs come from `BOARD`, which measures a real `setup`, and the cliff comes
 * from `factsOf`, which measures the deck this game was actually dealt. The claim is
 * "the game outlasts its own deck", and that is true of any corpus.
 */
const { majorityPegs: MAJORITY_PEGS, areas: FULL_BOARD, zones: ZONES } = BOARD;
const TURN_CLIFF = factsOf(ctx.cards).dealt.ideology;

const SEATS = [2, 3, 4, 5] as const;

/** The seeds swept at every seat count. A range, not a pick. */
const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);

const POOLS = ['funds', 'clout', 'media', 'trust'] as const;

function sumPools(d: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const r of POOLS) total += d[r] ?? 0;
  return total;
}

function sweep(n: number): RunResult[] {
  return SEEDS.map((seed) => playInProcess(freshShippedCorpus(seed, n, ctx), ctx, { maxActions: 1200 }));
}

function sweepRows(n: number): { seed: number; run: RunResult; maj: number; pegs: number; turn: number }[] {
  return sweep(n).map((run, i) => ({
    seed: SEEDS[i] ?? 0,
    run,
    maj: majoritiesOn(run.state),
    pegs: pegsOn(run.state),
    turn: run.state.turn,
  }));
}

function spread(xs: readonly number[]): string {
  return xs.length === 0 ? 'none' : `${Math.min(...xs)}..${Math.max(...xs)}`;
}

const med = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

// ─────────────────────────── winnability, every seat count ───────────────────────────

describe('the shipped corpus is winnable at every seat count', () => {
  for (const n of SEATS) {
    it(`${n} players: all ${SEEDS.length} seeds reach an ending, and the distribution is printed`, () => {
      const rows = sweepRows(n);
      const finished = rows.filter((r) => r.run.state.finished);
      const stalled = rows.filter((r) => !r.run.state.finished);

      console.log(
        `SEATS ${n} (${SEEDS.length} seeds, shipped corpus): ` +
          `finished ${finished.length}/${rows.length} | ` +
          `nineMajorities ${rows.filter((r) => r.maj === 9).length}/${rows.length} | ` +
          `fullBoard ${rows.filter((r) => r.pegs === FULL_BOARD).length}/${rows.length} | ` +
          `turn min ${spread(rows.map((r) => r.turn))} med ${med(finished.map((r) => r.turn))} max ${Math.max(...finished.map((r) => r.turn))} | ` +
          `actions ${spread(rows.map((r) => r.run.actions))} | ` +
          `not-nine ${rows.filter((r) => r.maj !== 9).map((r) => `s${r.seed}(maj${r.maj} peg${r.pegs})`).join(' ') || 'none'}`,
      );

      // Every seed reaches an ending. There is no tolerated list, and that is the
      // point: an earlier driver had one entry in it and a "we allow one" tolerance
      // is how a suite ends up allowing four.
      expect(
        stalled.map((r) => `seed ${r.seed} stalled on turn ${r.turn} with ${r.pegs} pegs and ${r.maj} majorities: ${r.run.reason}`),
        `${n} players: a seed stalled`,
      ).toEqual([]);
    });

    it(`${n} players: the ending is nine majorities, not a full board`, () => {
      const rows = sweepRows(n);
      // A full board is a legal ending (p20) but it is not a WIN, and removing the
      // placement fallback is precisely what stopped it happening. So the assertion is
      // nine majorities, on every seed, with no tolerated list.
      expect(
        rows.filter((r) => r.maj !== 9).map((r) => `seed ${r.seed}: ${r.maj} majorities, ${r.pegs} pegs`),
        `${n} players: a seed did not reach nine majorities`,
      ).toEqual([]);

      // Where nine majorities formed, the board genuinely carries the 69 pegs they
      // need — otherwise the count is a majority-holder field that disagrees with
      // the board, which would mean the ending is not really decided.
      for (const r of rows.filter((x) => x.maj === 9)) {
        expect(r.pegs, `seed ${r.seed} has nine majorities on only ${r.pegs} pegs`).toBeGreaterThanOrEqual(MAJORITY_PEGS);
      }
    });

    it(`${n} players: the game does not end by running out of Ideology Cards`, () => {
      // The shipped bug, restated as a winnability requirement: the old build ended
      // EVERY game on the turn the deck ran out, and the game could not be won at any
      // seat count.
      //
      // WHAT THIS USED TO ASSERT, AND WHY IT IS NOT WHAT IT ASSERTS ANY MORE. It used to
      // be `deepest turn > dealt.ideology` — "the game outlasts its own deck" — on the
      // sound reasoning that the Ideology deck is drawn one card per turn, so a deck of
      // N cannot reach turn N+1 and therefore passing the cliff proves `ANSWER` discarded
      // its card. That inference is correct and it is no longer TESTABLE: the shipped
      // Ideology deck is 76 cards and a driven game ends between turn 32 and turn 84, so
      // at 2, 3 and 4 seats nothing reaches turn 77. The proxy had stopped asserting
      // anything about the engine and had started asserting that the driver plays longer
      // than it does.
      //
      // The property it stood for is exact and corpus-size independent, so it is asserted
      // directly: `advanceTurn` ends the match the moment the Ideology deck AND its
      // discard are both empty, logging 'The Ideology deck is exhausted.' and scoring
      // the board as it stands — so the log carrying that line IS "this game ran out of
      // cards", it is in public data, and it is the branch the shipped bug took. See
      // `deckCliffComplaints` in `./corpus-facts.ts` for the whole argument, and
      // `packages/engine/test/card-transfer.test.ts` for the recycle itself, pinned where
      // the deck really is the binding constraint.
      const finished = sweepRows(n).filter((r) => r.run.state.finished);
      expect(finished.length, `${n} players produced no finished games`).toBeGreaterThan(0);
      expect(
        finished.flatMap((r) => deckCliffComplaints(r.run.state).map((c) => `seed ${r.seed}: ${c}`)),
        `${n} players: a game ended by exhausting the Ideology deck rather than on a decided board`,
      ).toEqual([]);

      // THE ANSWER COUNT, kept because it is the one form of the recycle claim that does
      // not depend on the turn number, and it is the number the old floor was really
      // trying to see. One Ideology Card is drawn and answered per turn and `log` is
      // PUBLIC (the server-only block starts below it), so this is the number of cards
      // dealt — and a game that answered at least as many cards as the deck holds has, by
      // construction, outlasted it.
      //
      // The old expectation was a per-seat-count FLOOR on the deepest game
      // (`{ 2: 55, 3: 80, 4: 80, 5: 80 }`, read off measured maxima of 59 / 99 / 87 / 99)
      // and it is gone for the reason `targetZone`'s note records at length: it measured
      // how long the driver chose to play, not anything about recycling, so every driver
      // competence fix moved it and it taught nothing about the engine. What replaces it
      // asserts the mechanism — the exhaustion branch did not fire — and the deepest
      // game's answer count is printed beside it so the distribution is on the record
      // rather than pinned.
      const answered = Math.max(...finished.map((r) => ideologyAnswers(r.run.state)));
      console.log(
        `DECK n=${n}: deepest finished game answered ${answered} Ideology Cards ` +
          `(deck ${TURN_CLIFF}); exhaustion branch never fired`,
      );
    });
  }

  it('the seed that used to strand now finishes — the driver got BETTER by peeking less', () => {
    // 3 players, seed 11, on the shipped corpus. This test is here because it USED to
    // be a tolerated failure, and the fix is worth pinning so it cannot silently come
    // back.
    //
    // WHAT IT WAS. The driver that chose its answer side by reading the pending card
    // out of the authoritative state stranded here: turn 364, 117 of 129 areas pegged,
    // 7 of 9 zones decided. Both remaining zones were mathematically out of reach —
    // for every zone, the free areas plus the ones a seat held fell short of its
    // majority — so no sequence of purchases could decide them, and the board was not
    // full either, so p20's board-full ending could not fire. Two seats held
    // `{funds: 0, clout: 0, media: 8, trust: 4}` and `{funds: 0, clout: 0, media: 7,
    // trust: 5}`: neither could afford anything on the Mat, and the p12 cap took the
    // turn income straight back. Same SHAPE as the bug that shipped — a game that
    // cannot end — reached by a different mechanism.
    //
    // WHY IT IS FIXED, and not by relaxing the placement rule: that was tried,
    // measured, and REJECTED, because it took 4 seats from 20/20 nine-majority endings
    // to 12/20 and 5 seats from 20/20 to 6/20, and it did not fix this seed either.
    //
    // It is fixed by the driver no longer reading the card at all. Answering the
    // funds-rich side gave one seat a systematically richer income than the other,
    // which is both something no player can do and a worse game to simulate: the
    // table's economy was being skewed by the test's own cheating. Answering the left
    // label every time is what a player with no private information does, and 3 seats
    // went from 19/20 to 20/20.
    const run = playInProcess(freshShippedCorpus(11, 3, ctx), ctx, { maxActions: 1200 });
    expect(run.stalled, `seed 11 stalled again: ${run.reason}`).toBe(false);
    expect(run.state.finished).toBe(true);
    expect(majoritiesOn(run.state), 'seed 11 finishes, but not with nine majorities').toBe(ZONES);
    expect(pegsOn(run.state)).toBeGreaterThanOrEqual(MAJORITY_PEGS);
    // And the deck recycled rather than exhausting, which is the mechanism the old
    // build got wrong.
    expect(
      run.state.log.some((l) => l.text.includes('Ideology deck is exhausted')),
      'seed 11 finished by exhausting the Ideology deck',
    ).toBe(false);
  });
});

// ─────────────────────────── over a real socket ───────────────────────────

describe('a real-corpus game runs to completion over a real socket, at every seat count', () => {
  const open: Harness[] = [];
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close().catch(() => undefined);
    for (const h of open.splice(0)) await h.close().catch(() => undefined);
  });

  /**
   * Seat `n` real sockets in a real lobby and drive the match to `finished`.
   *
   * This is the part of the winnability claim only the server can make. Every
   * action goes out as a `match:action` frame and comes back as a refusal or an
   * echo, so a game that finishes here has been through the decoder, the room's
   * dispatch, the reducer, the store append and the per-recipient projection. A
   * winnability claim made by calling `reduce` directly covers none of that.
   *
   * The decisions come from the same `nextAction` the in-process sweep uses, and
   * the view they read is `room.viewFor(playerId).state` — the projection the SEAT
   * would be sent. The harness does this rather than reading each client's last
   * message because two sockets are never updated at the same instant, so a driver
   * reading a stale view acts out of turn and is refused for a reason that has
   * nothing to do with the server. The clients are still asserted against at the
   * end; `e2e.test.ts` is where two players' views are compared byte for byte.
   */
  async function driveOverSockets(n: number): Promise<{ harness: Harness; matchId: string; actions: number; state: GameState; seed: number }> {
    const harness = await startHarness({ dispatchRate: 4000, messageRate: 4000 });
    open.push(harness);

    const host = await TestClient.connect(harness.url);
    clients.push(host);
    host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: n as 2, isPrivate: false });
    const lobby = await host.expect(host.is('lobby:state'), 'lobby');
    const lobbyId = lobby.lobby.lobbyId;

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

    host.send({ t: 'lobby:start' });
    const first = await host.expect(host.is('match:state'), 'match started');
    for (const { client } of seats) await client.expect(client.is('match:state'), 'seated');
    const matchId = first.matchId;

    const room = harness.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');

    let actions = 0;
    for (let step = 0; step < 4000; step += 1) {
      const s = room.state;
      if (s.finished) break;
      // WHICH SEAT ACTS, AND WHAT — `driverPly`, in the same order `playInProcess`
      // uses: an open decision for whoever owns it, then an open response window for the
      // one seat the table is waiting on, then the active player's own move.
      //
      // This loop used to ask only `s.activePlayer`, which cannot survive a window: the
      // seat on the hook is not the active player, so `nextAction` returned null and the
      // run died on "no legal action". Shipping BLOCK and DEFLECT put windows into real
      // games — measured at 4 of 120 two- and three-seat runs, because `draw-conspiracy`
      // puts Server Space's draw into a hand without anybody buying a Conspiracy Card. A
      // socket run cannot be pinned to a seed, so the five-attempt budget below is not a
      // substitute for handling the window: without this the suite would have been
      // failing at random.
      const ply = driverPly(s);
      const seat = seats.find((x) => x.playerId === ply.seat);
      if (seat === undefined) {
        throw new Error(
          `no seat for ${ply.seat} — choices=${JSON.stringify(s.choices.map((c) => `${c.player}:${c.choice.kind}`))} ` +
            `window=${s.interrupt?.id ?? 'none'} pool=${JSON.stringify(s.players[ply.seat]?.resources)}`,
        );
      }

      // The driver gets the seat's own projection and nothing else. The pending-card id
      // is a server-only field, stripped from `ClientState`, and the secrets gate
      // forbids a test from reading it — correctly, because it is not something a
      // client can do either. See `answerSide` in ./driver.ts.
      const action: Action = ply.action;

      // SYNCHRONISED ON `viewId`, NOT ON "a message arrived".
      //
      // Waiting for the next message of any type is subtly wrong, and it produced a
      // real intermittent failure: the room's reply to an action is a `match:state`
      // and possibly a `match:events`, so a driver that consumes "one message" can
      // consume the previous action's `match:events`, decide again against a state
      // that has moved, and get refused with `resolve "Resource cap" first` — a
      // refusal for an action that WAS legal when it was chosen. That is a harness
      // race, not a server bug, and it is exactly the sort of thing that makes a
      // winnability test untrustworthy.
      //
      // So the loop waits for the ROOM to move past the `viewId` the decision was
      // taken on, and only then reads again. `viewId` is the room's own committed
      // action counter, so this is a bounded poll on an authoritative signal rather
      // than a timing assumption.
      const before = room.viewId;
      const errorsBefore = seat.client.all('error').length;
      seat.client.send({ t: 'match:action', action });
      actions += 1;
      await waitForView(room, before, () => seat.client.all('error').length - errorsBefore);

      const errors = seat.client.all('error').slice(errorsBefore);
      const refused = errors[0];
      if (refused !== undefined) {
        throw new Error(
          `the server refused a scripted legal action (${action.type} for ${ply.seat} in ${s.phase}): ${refused.message}\n` +
            `  seed             = ${room.seed}\n` +
            `  room.state.choices = ${JSON.stringify(s.choices.map((c) => `${c.id}:${c.player}:${c.choice.kind}`))}\n` +
            `  view.choices       = ${JSON.stringify(ply.view.choices.map((c) => `${c.id}:${c.player}:${c.choice.kind}`))}\n` +
            `  pool             = ${JSON.stringify(s.players[ply.seat]?.resources)}`,
        );
      }
    }

    return { harness, matchId, actions, state: room.state, seed: room.seed };
  }

  /**
   * Wait until the room has committed an action past `viewId` — or the seat has been
   * refused, whichever comes first.
   *
   * A bounded poll, not a fixed sleep: a sleep is a timing assumption and a timing
   * assumption is a flaky test. This returns as soon as the room has actually moved,
   * so it is as fast as the server and as patient as the timeout.
   *
   * **AND IT WAKES ON A REFUSAL, because a refusal does not move the room.** It used to
   * poll `viewId` alone, so a refused action - which by definition leaves the room where
   * it was - was indistinguishable from a stalled table, and the test spent its whole
   * 10 seconds waiting before reporting "the room did not advance" for a game that was
   * never stuck. It reported that three times on this corpus before anyone read it as
   * what it was. The refusal message is the diagnosis; the timeout is the loss of it.
   */
  async function waitForView(
    room: { viewId: number },
    before: number,
    refused: () => number,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (room.viewId <= before) {
      if (refused() > 0) return;
      if (Date.now() > deadline) {
        throw new Error(`the room did not advance past viewId ${before} within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  for (const n of SEATS) {
    it(
      `${n} players over a socket: the server carries a random-seed match to a nine-majority finish`,
      { timeout: 180_000 },
      async () => {
        // WHY THIS RETRIES, STATED RATHER THAN HIDDEN
        //
        // The match seed is minted from `crypto.randomBytes` on purpose — it must
        // not be guessable — so a socket run cannot be pinned to a known seed, and
        // the seed therefore is a fresh random draw every time. The in-process sweep
        // above is where seed behaviour is pinned; this test is the TRANSPORT claim,
        // and its claim is "the server carries a winning game to `finished` and
        // persists it", which needs one winning game, not a specific seed.
        //
        // A retry is not a way of hiding a failure: a stranding seed is a real,
        // measured property of the shipped corpus (3 seats seed 11, characterised in
        // the test above), and the seeds are logged so the sample is visible. The
        // bound is the assertion — five consecutive stranding random seeds would fail
        // here rather than retry forever.
        const MAX_ATTEMPTS = 5;
        const attempts: { seed: number; finished: boolean; maj: number; turn: number; pegs: number }[] = [];
        let won: Awaited<ReturnType<typeof driveOverSockets>> | null = null;

        for (let k = 0; k < MAX_ATTEMPTS && won === null; k += 1) {
          const run = await driveOverSockets(n);
          const maj = majoritiesOn(run.state);
          attempts.push({ seed: run.seed, finished: run.state.finished, maj, turn: run.state.turn, pegs: pegsOn(run.state) });
          console.log(
            `SOCKET SEATS ${n} attempt ${k + 1}: seed ${run.seed} finished=${run.state.finished} turn=${run.state.turn} ` +
              `actions=${run.actions} pegs=${pegsOn(run.state)} majorities=${maj}/9`,
          );
          if (run.state.finished && maj === 9) won = run;
          else {
            // Release the sockets before starting the next attempt.
            for (const c of clients.splice(0)) await c.close().catch(() => undefined);
            for (const h of open.splice(0)) await h.close().catch(() => undefined);
          }
        }

        console.log(
          `SOCKET SEATS ${n}: won on attempt ${attempts.findIndex((a) => a.finished && a.maj === 9) + 1} of ${MAX_ATTEMPTS}; ` +
            `seeds ${attempts.map((a) => `${a.seed}${a.finished && a.maj === 9 ? '*' : ''}`).join(' ')} (* = nine-majority win)`,
        );

        expect(
          won === null ? attempts.map((a) => `seed ${a.seed}: finished=${a.finished} majorities=${a.maj} pegs=${a.pegs}`) : [],
          `${n} players over a socket: ${MAX_ATTEMPTS} consecutive random seeds did not produce a nine-majority finish`,
        ).toEqual([]);

        // The assertion above fails the test when `won` is null, so this is only
        // reached with a winner. Asserted rather than assumed, so a future change to
        // the expectation above cannot leave this reading a null.
        if (won === null) throw new Error('unreachable: the expectation above fails when no attempt won');
        const s = won.state;        expect(s.finished, `${n} players over a socket: the match did not finish`).toBe(true);
        expect(majoritiesOn(s), `${n} players over a socket: only ${majoritiesOn(s)} of 9 zones decided`).toBe(ZONES);
        expect(pegsOn(s), `${n} players over a socket: too few pegs for nine majorities`).toBeGreaterThanOrEqual(MAJORITY_PEGS);
        expect(s.turnOrder).toHaveLength(n);
        // The budget is not the assertion, but a driver that needed 3999 actions
        // would be one that barely finished — in process the same seat counts take
        // 211-452. Pinned so a regression to "grinds on forever" fails here rather
        // than as a timeout.
        expect(won.actions, `${n} players over a socket: implausibly many actions`).toBeLessThan(2000);

        // …and the store agrees, because the log is the authority: a match that
        // finished in the room but not in the store is a match nobody can resume.
        const stored = await won.harness.store.get(won.matchId);
        expect(stored, `${n} players over a socket: the match was not persisted`).not.toBeNull();
        const room = won.harness.server.hub.rooms.get(won.matchId);
        expect(stored?.log.length ?? -1, `${n} players over a socket: the log and the view disagree`).toBe(room?.viewId ?? -2);
        expect(stored?.seed, `${n} players over a socket: the persisted seed is not the room's seed`).toBe(won.seed);
      },
    );
  }
});

// ─────────────────────────── the driver's own properties ───────────────────────────

describe('the driver does not starve itself', () => {
  it('a cap discard totals EXACTLY the ask, whatever the reserve wants to keep', () => {
    // p12 asks for exactly `n` back and `reduce` refuses anything else with
    // `discard exactly n`, so a pick that is short is illegal and a pick that is
    // long is illegal. The reserve is what the player KEEPS, so it is capped at
    // the ask. Before this, a player holding 3 Funds against a 1-Fund ask shipped a
    // pick of 2 and the run failed with 'discard exactly 1'.
    const mat = [{ cost: { funds: 1 } }];
    const cases: readonly { pool: Record<string, number>; want: number }[] = [
      { pool: { funds: 83, clout: 85, media: 82, trust: 93 }, want: 331 },
      { pool: { funds: 3, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 12, clout: 0, media: 0, trust: 0 }, want: 1 },
      { pool: { funds: 40, clout: 4, media: 4, trust: 4 }, want: 40 },
      { pool: { funds: 2, clout: 0, media: 0, trust: 0 }, want: 9 },
      { pool: { funds: 0, clout: 0, media: 0, trust: 0 }, want: 4 },
      { pool: { funds: 0, clout: 5, media: 0, trust: 0 }, want: 4 },
    ];
    for (const { pool, want } of cases) {
      const pick = discardKeepingReserve(want, pool, mat);
      expect(sumPools(pick), `pick ${JSON.stringify(pick)} for ask ${want} from ${JSON.stringify(pool)}`).toBe(
        Math.min(want, sumPools(pool)),
      );
      for (const [res, n] of Object.entries(pick)) {
        expect(n, `${res} is negative in the pick`).toBeGreaterThanOrEqual(0);
        expect(n, `${res}:${n} is picked but not held`).toBeLessThanOrEqual(pool[res] ?? 0);
      }
    }
  });

  it('a cap discard never strips a pool the Mat needs, while another pool has surplus', () => {
    // THE REGRESSION FOR THE STARVATION BUG, stated as the property that
    // distinguishes the fix from the bug.
    //
    // The old rule kept a Funds-only reserve and shed every other pool, which drove
    // a player to `{funds: 12, clout: 0, media: 0, trust: 0}` against a Mat of
    // `media 3 / funds 2 + trust 2 / clout 2 + trust 1` — nothing affordable, ever,
    // because the turn income was taken straight back by the p12 cap.
    //
    // The fix ranks the pools by surplus ABOVE what the Mat asks of each, so a pool
    // no card on the Mat uses has surplus `held` and is shed first, and a pool that
    // is already at or below what a card needs is never touched while any other
    // pool has surplus to give. THAT is the property, and it is what stops the
    // player from being whittled down to a single currency.
    const mat = [{ cost: { media: 3 } }, { cost: { funds: 2, trust: 2 } }, { cost: { clout: 2, trust: 1 } }];
    const need = (r: string): number => {
      let cheapest = Number.POSITIVE_INFINITY;
      for (const slot of mat) {
        const c = (slot.cost as Record<string, number>)[r] ?? 0;
        if (c > 0) cheapest = Math.min(cheapest, c);
      }
      return Number.isFinite(cheapest) ? cheapest : 0;
    };

    const pools: readonly Record<string, number>[] = [
      { funds: 20, clout: 0, media: 2, trust: 1 },
      { funds: 12, clout: 0, media: 0, trust: 0 },
      { funds: 30, clout: 1, media: 1, trust: 1 },
      { funds: 14, clout: 0, media: 3, trust: 2 },
      { funds: 24, clout: 6, media: 0, trust: 0 },
      { funds: 13, clout: 0, media: 1, trust: 0 },
    ];
    for (const pool of pools) {
      const over = sumPools(pool) - 12; // RULES.resourceCap
      if (over <= 0) continue; // under the cap, so no discard is raised at all
      const pick = discardKeepingReserve(over, pool, mat);
      // If EVERY pool is already at or below what the Mat needs of it, the position
      // is already unaffordable and the ask wins — that case is covered by the
      // exactness test above, not by this one.
      const nothingToSpare = POOLS.every((r) => (pool[r] ?? 0) <= need(r));
      if (nothingToSpare) continue;

      for (const r of POOLS) {
        if ((pool[r] ?? 0) > need(r)) continue; // this pool has surplus, fair game
        expect(
          pick[r] ?? 0,
          `the discard took ${pick[r]} ${r} from a pool holding ${pool[r]}, which is at or below the ${need(r)} the Mat needs of it, ` +
            `while other pools still had surplus (pool ${JSON.stringify(pool)}, ask ${over})`,
        ).toBe(0);
      }
      // …and the concrete starvation shape: media and trust survive, so a later
      // answer can build toward the `media 3` or the `funds 2 + trust 2` card.
      expect(pick['clout'] ?? 0, 'clout was at 0 and is irrelevant to this Mat; it must not be manufactured').toBe(0);
    }
  });

  it('targetZone only ever names a zone that can take the voters AND can still be won', () => {
    // The property that took the nine-majority rate from 29/48 to 48/48. The SECOND
    // clause is the one the removed fallback violated: it named zones that could
    // never reach a threshold, so the voters spent there were votes for nothing.
    //
    // Read through `playerView`, so this is the same projection the driver acts on
    // in a real game, not a hand-built stand-in.
    const mid = playInProcess(freshShippedCorpus(19, 5, ctx), ctx, { maxActions: 400 }).state;
    for (const me of mid.turnOrder as readonly PlayerID[]) {
      const view = playerView(mid, me);
      for (const need of [1, 2, 3]) {
        const zoneId = targetZone(view, me, need);
        if (zoneId === null) continue;
        const z = mid.zones.find((x) => x.id === zoneId);
        expect(z, `targetZone named a zone that does not exist: ${zoneId}`).toBeDefined();
        // p10: a card's voters cannot be split across zones.
        expect(z?.areas.filter((a) => a.peg === null).length ?? 0, `${zoneId} cannot hold ${need} voters`).toBeGreaterThanOrEqual(need);
        // Not already won, and not already lost.
        expect(z?.majorityHolder, `${zoneId} is already won by ${me}`).not.toBe(me);
        const mine = z?.areas.filter((a) => a.peg?.owner === me).length ?? 0;
        expect(mine, `${me} already has ${mine} pegs in ${zoneId}, which is its majority`).toBeLessThan(z?.majority ?? 0);
        // THE CLAUSE. `mine + free` must reach the majority, or this zone is a
        // waste of voters and `targetZone` must have returned null.
        expect(
          mine + (z?.areas.filter((a) => a.peg === null).length ?? 0),
          `targetZone named ${zoneId} for ${me}, but ${mine} pegs plus the free areas cannot reach its majority of ${z?.majority}`,
        ).toBeGreaterThanOrEqual(z?.majority ?? Number.POSITIVE_INFINITY);
      }
    }
  });
});
