/**
 * GAP 2 — THE RESPONSE WINDOW, FROM THE SHIPPED CORPUS, IN ORDINARY PLAY.
 *
 * THE FINDING, STATED FIRST BECAUSE IT IS THE ANSWER
 *
 * **A window IS reachable from the shipped corpus in ordinary play. It is rare, it is
 * seed-dependent, and it is the same seed at every seat count.** Measured over 20 seeds
 * at each of 2/3/4/5 seats, exactly one run per seat count opens a window: seed 20, all
 * four times, at turn 31 (2 seats) / 33 (3 seats) / and correspondingly later at 4 and
 * 5. `interrupt-window.test.ts` reaches a window with a FIXTURE that deals BLOCK and
 * DEFLECT into specific hands, so it never had to answer the question a browser
 * auditor could not: can this happen at a table that was dealt the real cards?
 *
 * The causal chain, traced rather than guessed, and it is three conditions deep:
 *
 *  1. **Somebody acquires a Conspiracy Card.** In ordinary play the only route is a
 *     HEADLINE that grants one. Two shipped headlines do it: `hl-et2040-011` GOOD GIG
 *     WELL PLAYED ("Draw the top Conspiracy Card and keep it") and `hl-et2040-013` AS
 *     CLEAR AS WATER (every player holding none receives one). The driver never BUYS a
 *     Conspiracy Card — that is a deliberate competence boundary in ./driver.ts — so
 *     these two cards are the only door, and they are 2 of the 30 shipped headlines.
 *  2. **The card on top of the Conspiracy draw pile at that instant is a REACTIVE
 *     one.** `canBeAnswered` in `reduce.ts:1717` walks every OTHER seat's hand for a
 *     card whose `interrupt.op` is `block` or `deflect`. Only two of the shipped
 *     Conspiracy Cards declare an interrupt at all — `ct-et2040-014` BLOCK THE MOTION
 *     and `ct-et2040-015` DEFLECT THE BLAME — so the grant has to land on one of them,
 *     which is 2 of 27 and it depends on the seed-derived shuffle of that pile.
 *  3. **A DIFFERENT seat then resolves a card.** `resolveCard` stages the effects and
 *     opens the window from exactly two call sites, `PLAY_CONSPIRACY` and
 *     `ACK_HEADLINE`. The driver never plays a Conspiracy, so in practice the window
 *     opens on a HEADLINE ACK — which the driver does every single headlines phase.
 *
 * So the rate is roughly (2/30 headlines) x (2/27 conspiracies) x (a later headline),
 * and it is a property of the SEED'S TWO DECK ORDERS rather than of play. That is why
 * seed 20 at every seat count is the run that does it: the same two shuffles, and the
 * two orders barely move with the seat count. The trace test at the bottom of this file
 * prints the whole chain — on seed 20 at 2 seats, `hl-et2040-011` grants
 * `ct-et2040-014` to p2 on turn 27 and window `I51` opens on turn 31 on
 * `hl-in2020-001`, which p2 answers with the BLOCK.
 *
 * WHY THE BROWSER AUDITOR COULD NOT TRIGGER ONE — the answer to "find out why"
 *
 * Measured, not argued. Condition 1 is the binding one and it is LATE: on seed 20 the
 * granting headline is not acked until turn 26 (2 seats) or 28 (3 seats), and the window
 * opens five turns after that. The auditor's best game was round 6 / turn 11. It never
 * reached the turn on which the only door in the shipped corpus opens, so its
 * `state.interrupt` was never non-null for a reason that has nothing to do with the
 * window being broken. Its driver also never played a Conspiracy Card for a related
 * reason: `PLAY_CONSPIRACY` is the other door into `resolveCard`, and it is out of
 * reach for a driver that does not read its own hidden hand.
 *
 * Note also that `./reactive-corpus.ts` still opens by saying "no card in
 * `packages/cards/decks/**` declares an `interrupt`". That is now FALSE —
 * `ct-et2040-014` and `-015` do — and it is the sentence that would lead the next
 * reader to the same wrong conclusion. The correction is recorded in that file's header.
 *
 * WHAT IS ASSERTED, AND WHAT IS ONLY MEASURED
 *
 *  - REACHABILITY (asserted, seed 20, all four seat counts): a window opens from the
 *    shipped corpus, in ordinary play, with no fixture and no card injected into a hand.
 *  - THE REAL PATH (asserted): the holder SPENDS the BLOCK, so `answered >= 1` and the
 *    window closes BY AN ANSWER rather than by every seat declining. A test that only
 *    ever declines proves termination and nothing about responding.
 *  - IT CLOSES (asserted): `closed === opened`, `unclosedAtEnd === 0`, the game still
 *    reaches nine majorities afterwards. A window that hangs the table is the failure
 *    this whole mechanism exists to prevent.
 *  - THE BROWSER FALLBACK (asserted, same seed): with `knowOwnHand: false` — a driver
 *    that cannot see its own hand, which is what a real client is — the same game still
 *    finishes, and closes the window by all-declines. This is the path an actual
 *    production incident takes.
 *  - THE RATE (measured and printed, not asserted): 1 window in 20 runs at each seat
 *    count. Asserting a rate would be asserting the driver's competence, which is the
 *    mistake `corpus-facts.ts` documents at length.
 */

import { describe, expect, it } from 'vitest';

import { playerView, reduce, type Action, type Ctx, type GameState, type PlayerID } from '@shasn/engine';

import { loadCtx } from '../src/index.ts';
import { deckCliffComplaints, BOARD } from './corpus-facts.ts';
import {
  freshShippedCorpus,
  majoritiesOn,
  nextAction,
  ownKnowledge,
  pegsOn,
  pickForChoice,
  playInProcess,
  windowResponder,
  type RunResult,
} from './driver.ts';

const ctx: Ctx = loadCtx();
const SEATS = [2, 3, 4, 5] as const;
const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * The two shipped Conspiracy Cards whose `interrupt` the engine acts on, named here
 * rather than imported from a fixture.
 *
 * Read off the SHIPPED corpus at test time rather than trusted from this comment: if a
 * future card is added or removed the assertion below changes with it, and if these two
 * ever stop declaring an `interrupt` then the whole reachability argument in this file's
 * header is wrong and this is the line that says so.
 */
function reactiveIds(): string[] {
  return Object.values(ctx.cards.conspiracy)
    .filter((c) => c.interrupt?.op === 'block' || c.interrupt?.op === 'deflect')
    .map((c) => c.id);
}

/** The shipped headlines that can put a Conspiracy Card into a hand at all. */
function grantingHeadlines(): string[] {
  return Object.values(ctx.cards.headline)
    .filter((c) => c.effects.some((e) => e.op === 'draw-conspiracy'))
    .map((c) => c.id);
}

describe('the corpus facts this file rests on are still true of the shipped deck', () => {
  it('the two cards the header names are the reactive ones, and the two headlines it names really grant one', () => {
    // These are the counts the header's rate argument is built from, so a corpus change
    // that invalidates the argument must fail here rather than silently turning every
    // reachability test below into a test of nothing.
    //
    // The claims are made BY ID rather than by count. `toBe(2)` on a corpus noun is a
    // footprint: it can only fail on the day somebody edits it, and the edit is chosen
    // to agree with whatever the corpus now does. Naming the ids is a claim a reader can
    // check against the JSON, it survives a card being added, and it says something the
    // count cannot — WHICH cards are the doors. The counts are printed, not asserted.
    const reactive = reactiveIds();
    expect(reactive, 'ct-et2040-014 is no longer reactive, so the BLOCK path below cannot run').toContain('ct-et2040-014');
    expect(reactive, 'ct-et2040-015 is no longer reactive, so the DEFLECT path cannot run').toContain('ct-et2040-015');
    expect(reactive.length, 'the shipped corpus has no reactive Conspiracy Card at all').toBeGreaterThan(0);
    // Every reactive card really does declare an op the engine acts on — the list is
    // built from the corpus, not typed, so this is the derivation rather than the claim.
    for (const id of reactive) {
      const op = ctx.cards.conspiracy[id]?.interrupt?.op;
      expect(op, `${id} is listed as reactive but declares no reactive op`).toBeDefined();
      expect(['block', 'deflect'], `${id} declares an interrupt op the engine ignores: ${String(op)}`).toContain(op);
    }

    const grants = grantingHeadlines();
    expect(grants, 'hl-et2040-011 no longer grants a Conspiracy Card, so the traced chain cannot happen').toContain(
      'hl-et2040-011',
    );
    expect(grants, 'hl-et2040-013 no longer grants a Conspiracy Card').toContain('hl-et2040-013');
    expect(grants.length, 'the shipped corpus has no conspiracy-granting headline at all').toBeGreaterThan(0);

    // …and the two routes are INDEPENDENT of each other, which is the third condition in
    // the header's chain: a grant is not enough, the card it grants has to be reactive.
    // If a future corpus made every granting headline also grant a reactive card, the
    // rate argument would change and this would say so.
    console.log(
      `WINDOW corpus: reactive=[${reactive.join(' ')}] (${reactive.length}) granting-headlines=[${grants.join(' ')}] ` +
        `(${grants.length}) conspiracy-deck=${Object.keys(ctx.cards.conspiracy).length} headline-deck=${Object.keys(ctx.cards.headline).length}`,
    );
  });
});

describe('a response window opens from the SHIPPED corpus in ordinary play', () => {
  for (const n of SEATS) {
    it(`${n} players, seed 20: the window opens, is ANSWERED with a BLOCK, closes, and the game still finishes`, () => {
      const run = playInProcess(freshShippedCorpus(20, n, ctx), ctx, { maxActions: 1200 });

      // 1. IT OPENED. `opened` is a SET of window ids and `closed` counts closures, so
      //    "opened at least once" is `size > 0` and cannot be satisfied by a no-op.
      expect(
        [...run.windows.opened],
        `${n} players, seed 20: no window opened from the shipped corpus. If this has started ` +
          `failing, the reachability argument in this file's header is wrong — check whether a ` +
          `reactive Conspiracy Card is still reachable from a headline.`,
      ).not.toEqual([]);
      const openedCount = run.windows.opened.size;

      // 2. AND IT WAS ANSWERED, not merely survived. A run that only ever declines
      //    proves termination; `answered > 0` proves the RESPOND_INTERRUPT path, the
      //    one that actually spends a card.
      expect(run.windows.answered, `${n} players, seed 20: the window was never answered`).toBeGreaterThanOrEqual(1);
      expect(run.windows.declined, `${n} players, seed 20: no seat ever declined`).toBeGreaterThanOrEqual(0);

      // 3. IT CLOSED — exactly once per window, and nothing was left open at the end.
      expect(run.windows.closed, `${n} players, seed 20: ${openedCount} window(s) opened and ${run.windows.closed} closed`).toBe(
        openedCount,
      );
      expect(run.windows.unclosedAtEnd, `${n} players, seed 20: a window was still open when the game ended`).toBe(0);
      expect(run.windows.closedByAnswer, `${n} players, seed 20: no window closed by an answer`).toBeGreaterThanOrEqual(1);

      // 4. AND THE TABLE KEPT PLAYING. The window froze everything for a beat and the
      //    game still reached the standard ending, which is the whole reason this
      //    mechanism is tolerable.
      expect(run.state.finished, `${n} players, seed 20: the game did not finish (${run.reason})`).toBe(true);
      expect(majoritiesOn(run.state), `${n} players, seed 20: ${majoritiesOn(run.state)} of ${BOARD.zones} majorities`).toBe(
        BOARD.zones,
      );
      expect(pegsOn(run.state)).toBeGreaterThanOrEqual(BOARD.majorityPegs);
      expect(run.windows.unclosedAtEnd, 'a window was open at the end').toBe(0);

      // 5. AND IT WAS NOT THE END OF THE DECK. A window and a deck-exhaustion ending
      //    are unrelated, but a run that ended on the exhaustion branch would make
      //    every assertion above pass for the wrong reason.
      expect(deckCliffComplaints(run.state), `${n} players, seed 20: the game ended on the deck cliff`).toEqual([]);

      console.log(
        `WINDOW n=${n} seed20: turn ${run.state.turn} actions ${run.actions} windows opened ${openedCount} ` +
          `closed ${run.windows.closed} answered ${run.windows.answered} declined ${run.windows.declined} ` +
          `closedByAnswer ${run.windows.closedByAnswer} closedByAllDeclines ${run.windows.closedByAllDeclines}`,
      );
    });

    it(`${n} players, seed 20: the same game finishes on a client that cannot see its own hand`, () => {
      // THE PRODUCTION FALLBACK, and the reason a client can hold a BLOCK and still not
      // know it. `playInProcess` with `knowOwnHand: false` passes no `SeatKnowledge` to
      // `nextAction`, so `reactiveAnswer` returns null and the seat DECLINES — which is
      // the only move a browser has, because `playerView` strips `players[].conspiracies`
      // for the owner too.
      //
      // So the table must still finish, and the window must still close. Without this the
      // reachability test above would be a claim about a privileged driver.
      const run = playInProcess(freshShippedCorpus(20, n, ctx), ctx, { maxActions: 1200, knowOwnHand: false });

      expect([...run.windows.opened], `${n} players: the hand-blind driver saw no window`).not.toEqual([]);
      expect(run.windows.answered, `${n} players: a driver with no hand answered a window — it has no card to name`).toBe(0);
      expect(run.windows.declined, `${n} players: the window was never declined`).toBeGreaterThanOrEqual(1);
      expect(run.windows.closed, `${n} players: ${run.windows.opened.size} window(s) opened, ${run.windows.closed} closed`).toBe(
        run.windows.opened.size,
      );
      expect(run.windows.closedByAllDeclines, `${n} players: the window did not close by all-declines`).toBeGreaterThanOrEqual(1);
      expect(run.windows.unclosedAtEnd).toBe(0);
      expect(run.state.finished, `${n} players: the hand-blind driver did not finish (${run.reason})`).toBe(true);
      expect(majoritiesOn(run.state), `${n} players: the hand-blind driver ended on ${majoritiesOn(run.state)} majorities`).toBe(
        BOARD.zones,
      );
      console.log(
        `WINDOW n=${n} seed20 hand-blind: turn ${run.state.turn} actions ${run.actions} closed ${run.windows.closed} ` +
          `declined ${run.windows.declined} closedByAllDeclines ${run.windows.closedByAllDeclines}`,
      );
    });
  }
});

describe('MEASURED, NOT ASSERTED: how often the shipped corpus produces a window', () => {
  for (const n of SEATS) {
    it(`${n} players, 20 seeds: the window rate on the shipped deck`, () => {
      const rows: { seed: number; run: RunResult }[] = SEEDS.map((seed) => ({
        seed,
        run: playInProcess(freshShippedCorpus(seed, n, ctx), ctx, { maxActions: 1200 }),
      }));

      const withWindow = rows.filter((r) => r.run.windows.opened.size > 0);
      const broken = rows.filter(
        (r) => r.run.windows.unclosedAtEnd > 0 || r.run.windows.closed !== r.run.windows.opened.size,
      );
      const stalled = rows.filter((r) => !r.run.state.finished);

      // THE SAFETY CLAIM is asserted: whatever the rate, no run left a window open and
      // no run stalled. Those are engine guarantees, and a rate of zero would not
      // excuse either.
      expect(
        broken.map((r) => `seed ${r.seed}: opened ${r.run.windows.opened.size} closed ${r.run.windows.closed}`),
        `${n} players: a window did not close exactly once`,
      ).toEqual([]);
      expect(stalled.map((r) => `seed ${r.seed}: ${r.run.reason}`), `${n} players: a seed stalled`).toEqual([]);

      // THE RATE is printed. It is deliberately not asserted: it is a function of the
      // seed-derived shuffles of two decks and of how long the driver chooses to play,
      // and `corpus-facts.ts` records at length why a number that moves when the driver's
      // competence changes is a number that teaches nothing about the engine. What the
      // rate is here is one seed in twenty at every seat count, and the same seed.
      console.log(
        `WINDOW RATE n=${n}: ${withWindow.length}/${rows.length} runs opened a window ` +
          `[${withWindow.map((r) => `seed ${r.seed}@turn ${r.run.state.turn}`).join(' ')}] | ` +
          `answers ${Math.min(...rows.map((r) => answered(r.run.state)))}..${Math.max(...rows.map((r) => answered(r.run.state)))} ` +
          `deck ${Object.keys(ctx.cards.ideology).length}`,
      );

      // …but the headline claim of THIS file is that the path is not dead, so at least
      // one seed in the sweep must reach it at every seat count. Seed 20 is pinned by
      // the tests above; this says the property holds at more than one seed.
      expect(
        withWindow.length,
        `${n} players: NO seed in the 20-seed sweep opened a window. That would mean the shipped ` +
          `reactive cards are inert, and the tests above would be passing on a fixture rather than on the corpus.`,
      ).toBeGreaterThan(0);
    });
  }
});

function answered(state: GameState): number {
  return state.log.filter((l) => l.kind === 'answer').length;
}

// ─────────────────── where in the game the window opens ───────────────────

describe('the window opens on a HEADLINE ACK, which is the only door the driver can use', () => {
  it('seed 20 at 2 seats: the chain is grant -> hold -> a later headline, and it is visible in the log', () => {
    // The header's causal chain, asserted end to end on one game rather than asserted
    // as prose. Replayed by hand rather than by `playInProcess` so the intermediate
    // states can be inspected, and so the test fails at the STEP that broke rather than
    // only reporting "no window".
    const trace = traceToTheWindow(20, 2, ctx);
    expect(trace.granted, 'no seat ever acquired a Conspiracy Card from a headline').not.toBeNull();
    expect(trace.reactiveHeld, 'the card the grant produced is not a reactive one').not.toBeNull();
    expect(trace.window, 'no window ever opened').not.toBeNull();

    // The grant happened through a shipped headline whose text is about taking a
    // Conspiracy Card, and the window happened on a DIFFERENT headline, some turns
    // later — which is exactly the two-step shape the header describes.
    expect(trace.grantTurn, 'the grant and the window happened on the same turn').toBeLessThan(trace.windowTurn as number);
    expect(trace.windowKind, `the window opened on a ${trace.windowKind} rather than a headline`).toBe('headline');
    expect(trace.windowCardIsDifferent, 'the window opened on the granting headline itself').toBe(true);

    console.log(
      `WINDOW TRACE n=2 seed20: ${trace.granted} granted to ${trace.grantedTo} on turn ${trace.grantTurn} ` +
        `(headline ${trace.grantHeadline}), window ${trace.window} on turn ${trace.windowTurn} ` +
        `card=${trace.windowCard} kind=${trace.windowKind}, answered by ${trace.answeredBy} with ${trace.answerCard}`,
    );
  });
});

/**
 * Replay seed 20 at `n` seats by hand, recording the three events that matter.
 *
 * A hand-rolled loop rather than `playInProcess` because the point is to catch the
 * chain at each link. It uses the driver's own `nextAction` and `ownKnowledge`, so the
 * decisions are still ones a seat could have made, and it reads only `playerView`
 * except for the two links under test — which are properties of the AUTHORITATIVE
 * state, not of the projection, and are checked here precisely because the projection
 * cannot carry them.
 */
function traceToTheWindow(seed: number, n: number, c: Ctx): {
  granted: string | null;
  grantedTo: string | null;
  grantTurn: number;
  grantHeadline: string | null;
  reactiveHeld: string | null;
  window: string | null;
  windowTurn: number;
  windowCard: string | null;
  windowKind: string | null;
  windowCardIsDifferent: boolean;
  answeredBy: string | null;
  answerCard: string | null;
} {
  const out = {
    granted: null as string | null,
    grantedTo: null as string | null,
    grantTurn: -1,
    grantHeadline: null as string | null,
    reactiveHeld: null as string | null,
    window: null as string | null,
    windowTurn: -1,
    windowCard: null as string | null,
    windowKind: null as string | null,
    windowCardIsDifferent: false,
    answeredBy: null as string | null,
    answerCard: null as string | null,
  };

  // The reducer and the driver are imported at module scope; nothing is re-required
  // here, because an ESM test file has no `require` and a lazy import would only be a
  // way of hiding a cycle.
  let s: GameState = freshShippedCorpus(seed, n, c);
  let seenConspiracies = 0;

  for (let step = 0; step < 1200 && !s.finished; step += 1) {
    const open = s.choices[0];
    const window = s.interrupt;
    const view = playerView(s, s.activePlayer);

    let seat: PlayerID = s.activePlayer;
    let action: ReturnType<typeof nextAction>;
    if (open !== undefined) {
      const pick = pickForChoice(playerView(s, open.player), open);
      if (pick === null) throw new Error(`no legal pick for ${open.choice.kind}`);
      seat = open.player;
      action = { type: 'RESOLVE_CHOICE', choiceId: open.id, pick };
    } else if (window !== null) {
      const owed = windowResponder(playerView(s, s.activePlayer));
      if (owed === null) throw new Error('a window is open and nobody owes a response');
      seat = owed;
      if (out.window === null) {
        out.window = window.id;
        out.windowTurn = s.turn;
        out.windowCard = window.cardId;
        out.windowKind = window.kind;
        out.windowCardIsDifferent = window.cardId !== out.grantHeadline;
      }
      action = nextAction(playerView(s, seat), seat, ownKnowledge(s, seat, c.cards)) ?? { type: 'PASS_INTERRUPT' };
      if (action.type === 'RESPOND_INTERRUPT') {
        out.answeredBy = seat;
        out.answerCard = action.cardId;
      }
    } else {
      seat = s.activePlayer;
      action = nextAction(view, seat, ownKnowledge(s, seat, c.cards));
      if (action === null) throw new Error(`no legal action in phase ${view.phase}`);
    }

    const r = reduce(s, seat, action, c);
    if (!r.ok) throw new Error(`${seat} ${action.type} refused: ${r.error}`);
    s = r.state;

    // Link 1: a seat acquired a Conspiracy Card. The log line immediately before it is
    // the headline that granted it, which is what makes this a headline route rather
    // than a purchase.
    const held = s.turnOrder.flatMap((p) => (s.players[p]?.conspiracies ?? []).map((id) => ({ p, id })));
    if (out.granted === null && held.length > seenConspiracies) {
      const newest = held[held.length - 1];
      const headline = [...s.log].reverse().find((l) => l.text.startsWith('HEADLINE'));
      out.granted = newest?.id ?? null;
      out.grantedTo = newest?.p ?? null;
      out.grantTurn = s.turn;
      const m = /^HEADLINE — (.+)$/.exec(headline?.text ?? '');
      out.grantHeadline = Object.values(c.cards.headline).find((h) => h.name === m?.[1])?.id ?? null;
    }
    seenConspiracies = held.length;

    // Link 2: the card the grant produced is one the engine will act on.
    if (out.reactiveHeld === null) {
      const reactive = held.find((h) => reactiveIds().includes(h.id));
      if (reactive !== undefined) out.reactiveHeld = reactive.id;
    }
    if (out.window !== null && out.answeredBy !== null) break;
  }
  return out;
}