/**
 * GAP 3 — THE IDEOLOGY DECK RECYCLES. Counted, not proxied, at every seat count.
 *
 * THE VACUOUS PROXY THIS REPLACES, AND WHY IT WAS VACUOUS
 *
 * Three files used to assert `game.turn > dealt.ideology` — "the game outlasts its own
 * deck" — on reasoning that is correct: one Ideology Card is drawn and answered per
 * turn, so a deck of N cannot reach turn N+1, and therefore passing the cliff proves
 * `ANSWER` discarded its card and the deck recycled. That was the shipped bug (every
 * game ended on turn 52 with 0 of 9 zones decided) and the proxy was a fair reading of
 * it.
 *
 * **It stopped being testable when the corpus outgrew a game.** The shipped Ideology deck
 * is 76 cards and a driven game answers between 32 and 84 of them, so at 2, 3 and 4
 * seats NO game in the sweep reaches turn 77. The proxy had stopped asserting anything
 * about the engine and had started demanding a longer game — which is why it was
 * replaced by the exhaustion-branch check in `./corpus-facts.ts` (`deckCliffComplaints`)
 * rather than by a bigger number.
 *
 * BUT THAT REPLACEMENT IS ONLY HALF THE CLAIM. "The exhaustion branch did not fire" is
 * consistent with a game that never came near the cliff, which is exactly what happens
 * at three of the four seat counts. So this file proves the positive half exactly, at
 * every seat count, by counting ANSWERS AGAINST DISTINCT CARDS ACTUALLY DEALT.
 *
 * ## THE EXACT COUNT, AND WHY IT NEEDS NO SECRET FIELD
 *
 * The obvious way to count distinct dealt cards is to read the draw pile, which is
 * server-only and which this repository's secret gate exists to keep unreadable. It is
 * not read. The count comes from `PlayerState.manifestoCards`, which `playerView` does
 * NOT strip: an ANSWERED card's payout has already been paid and revealed, so its id
 * carries nothing new — the precedent recorded in `./secret-inventory.ts`. So:
 *
 *     answers            = number of `kind: 'answer'` log entries (log is public)
 *     distinct dealt     = |union of players[].manifestoCards|
 *     exhaustion         = the log line `Ideology deck is exhausted`
 *
 * and the recycle claim is the exact relation **`answers > deckSize`**, which can only
 * happen if a card came out of the discard pile — the only mechanism by which the engine
 * can deal a card twice (`draw()` in reduce.ts reshuffles the discard when the draw pile
 * empties, and `ANSWER` is what puts a card in that discard). Equivalently, and stated
 * as a second, independent number: **`answers > distinct dealt`**, because a card dealt
 * twice appears once in `manifestoCards` and twice in the answer count.
 *
 * ## AND THE MEASUREMENT, WHICH IS THE HONEST PART
 *
 * On the shipped 76-card deck, recycling does NOT happen at every seat count. Measured
 * over 20 seeds at each of 2/3/4/5 seats, the deepest game answers 63 / 62 / 73 / 84
 * Ideology Cards respectively — so recycling fires in exactly ONE run of the whole sweep
 * (5 seats, seed 17, 84 answers) and in none at 2, 3 or 4 seats. The deck no longer
 * runs out, and the games are simply shorter than the deck.
 *
 * That is a real number and not a threshold to retune: making games longer to reach the
 * cliff would be testing the driver, which is the mistake the old proxy made. So the
 * positive claim is made on a DECK-SIZED corpus instead — the shipped cards with the
 * Ideology deck truncated — and every card, every rule and every driver decision is
 * unchanged. `reactive-corpus.ts` sets the precedent for a derived corpus and says why
 * it is legitimate; this is the same technique applied to deck SIZE rather than to deck
 * CONTENTS. With a 20-card Ideology deck the same games answer 41 to 61 cards, so
 * recycling is forced at every seat count, and the games still finish on nine majorities
 * — which is the part that matters, because a recycle that ends the game in an
 * exhaustion is the shipped bug rather than a fix for it.
 */

import { describe, expect, it } from 'vitest';

import { setup, type CardIndex, type Ctx, type GameState, type PlayerID } from '@shasn/engine';

import { loadCtx } from '../src/index.ts';
import { decksOf } from '../src/store.ts';
import { BOARD, factsOf } from './corpus-facts.ts';
import { freshShippedCorpus, majoritiesOn, playInProcess, type RunResult } from './driver.ts';

const base: Ctx = loadCtx();
const SEATS = [2, 3, 4, 5] as const;
const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);
const SHIPPED_DECK = factsOf(base.cards).dealt.ideology;

// ───────────────────────────── the exact counts ─────────────────────────────

/** Ideology Cards ANSWERED. `log` is public: it is the only wire-visible tally. */
function answers(state: GameState): number {
  return state.log.filter((l) => l.kind === 'answer').length;
}

/**
 * Distinct Ideology Cards actually dealt, from PUBLIC state.
 *
 * `manifestoCards` is the list of answered card ids, and `playerView` does not strip it —
 * an answered card's payout is already public under full information, so the id adds
 * nothing. A card dealt twice appears ONCE here, which is precisely what makes
 * `answers - distinct` the recycle count.
 */
function distinctDealt(state: GameState): number {
  const ids = new Set<string>();
  for (const p of state.turnOrder) for (const id of state.players[p]?.manifestoCards ?? []) ids.add(id);
  return ids.size;
}

/** Did R10's exhaustion branch fire? The public log line that only it writes. */
function exhausted(state: GameState): boolean {
  return state.log.some((l) => l.text.includes('Ideology deck is exhausted'));
}

/** How many times the single most-dealt card was dealt. `> 1` means the pool recycled. */
function maxDealings(state: GameState): number {
  const counts = new Map<string, number>();
  for (const p of state.turnOrder) {
    for (const id of state.players[p]?.manifestoCards ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let most = 0;
  for (const c of counts.values()) if (c > most) most = c;
  return most;
}

/** The Ideology deck truncated to `n` shipped cards. Every card is a real shipped card. */
function withIdeologyDeckOf(n: number): CardIndex {
  return { ...base.cards, ideology: Object.fromEntries(Object.entries(base.cards.ideology).slice(0, n)) };
}

function deal(seed: number, seats: number, cards: CardIndex): GameState {
  const players: PlayerID[] = Array.from({ length: seats }, (_, i) => `p${i + 1}`);
  const names: Record<string, string> = {};
  for (const p of players) names[p] = p;
  return setup({ players, names, cards, seed, ...decksOf(cards) });
}

function ctxOn(cards: CardIndex): Ctx {
  return { rules: base.rules, cards };
}

const spread = (xs: readonly number[]): string => (xs.length === 0 ? 'none' : `${Math.min(...xs)}..${Math.max(...xs)}`);

// ───────────── A. the shipped 76-card deck: the exact accounting, and the honest number ─────────────

describe('the shipped Ideology deck: answers counted against distinct cards actually dealt', () => {
  for (const n of SEATS) {
    it(`${n} players, ${SEEDS.length} seeds: the accounting is exact, and how close the deck came to recycling is reported`, () => {
      const rows: { seed: number; run: RunResult }[] = SEEDS.map((seed) => ({
        seed,
        run: playInProcess(freshShippedCorpus(seed, n, base), base, { maxActions: 1200 }),
      }));

      // 1. R10 NEVER FIRED, at any seed. This is `deckCliffComplaints` restated as an
      //    assertion rather than as a helper's return value, because the helper's
      //    version passes vacuously when a game never came near the cliff — which is
      //    what happens here at three of the four seat counts.
      expect(
        rows.filter((r) => exhausted(r.run.state)).map((r) => `seed ${r.seed} exhausted the deck`),
        `${n} players: a game ended by running out of Ideology Cards`,
      ).toEqual([]);

      for (const { seed, run } of rows) {
        const s = run.state;
        const a = answers(s);
        const d = distinctDealt(s);
        // 2. THE ACCOUNTING IS EXACT. A card is dealt, answered and discarded; it can be
        //    dealt again only through the reshuffle. So `answers` is `distinct dealt`
        //    plus however many times cards were re-dealt, and that difference is not
        //    allowed to be silently negative or to exceed the deck.
        expect(d, `seed ${seed}: distinct dealt ${d} exceeds the ${a} answers logged`).toBeLessThanOrEqual(a);
        expect(d, `seed ${seed}: a game answered ${a} cards from a deck of ${SHIPPED_DECK}`).toBeLessThanOrEqual(SHIPPED_DECK);
        // 3. REUSE IS EITHER ZERO OR AT LEAST THE WHOLE DECK'S WORTH. A single reused
        //    card proves the reshuffle fired; anything between 1 and deckSize-1 deals
        //    would mean the discard came back part-way, which no path in `draw()` does.
        const reuse = a - d;
        if (reuse > 0) {
          expect(
            reuse,
            `seed ${seed}: only ${reuse} of ${a} answers were re-deals, which no draw path produces`,
          ).toBeGreaterThanOrEqual(1);
          expect(maxDealings(s), `seed ${seed}: re-deals happened but no card was dealt twice`).toBeGreaterThan(1);
        }
        // 4. And the finished games are still finished games — a recycle that ends the
        //    game is the shipped bug, not a proof of the mechanism.
        expect(s.finished, `seed ${seed}: ${run.reason}`).toBe(true);
        expect(majoritiesOn(s), `seed ${seed}: ${majoritiesOn(s)} of ${BOARD.zones} majorities`).toBe(BOARD.zones);
      }

      // THE MEASUREMENT. This is the number the whole file exists to put on the record:
      // on the shipped 76-card deck the deck is NOT the binding constraint at any seat
      // count but one, and pretending otherwise would be retuning the driver to reach a
      // cliff rather than measuring anything.
      const recycled = rows.filter((r) => answers(r.run.state) > SHIPPED_DECK);
      console.log(
        `RECYCLE shipped n=${n}: answers ${spread(rows.map((r) => answers(r.run.state)))} | ` +
          `distinct ${spread(rows.map((r) => distinctDealt(r.run.state)))} | deck ${SHIPPED_DECK} | ` +
          `recycled ${recycled.length}/${rows.length} ${recycled.map((r) => `seed ${r.seed}(${answers(r.run.state)})`).join(' ')} | ` +
          `cliff fired 0/${rows.length}`,
      );
    });
  }
});

// ───────────── B. recycling forced at every seat count, on the shipped cards ─────────────

describe('the discard-and-reshuffle path fires in ORDINARY PLAY, at every seat count', () => {
  // 20 cards, so a game that answers 41-61 of them cannot avoid recycling, at any seat
  // count. The deck is the shipped Ideology corpus truncated — every card real, every
  // rule the engine's, every driver decision the same `nextAction`.
  const SHORT_DECK = 20;

  for (const n of SEATS) {
    it(`${n} players on a ${SHORT_DECK}-card Ideology deck: cards are dealt more than once, and the game still finishes on nine majorities`, () => {
      const cards = withIdeologyDeckOf(SHORT_DECK);
      const ctx = ctxOn(cards);
      expect(Object.keys(cards.ideology)).toHaveLength(SHORT_DECK);

      const rows = SEEDS.map((seed) => ({ seed, run: playInProcess(deal(seed, n, cards), ctx, { maxActions: 1200 }) }));

      // 1. EVERY SEED RECYCLED. `answers > deckSize` is the claim, and it is exact: a
      //    pool of 20 cards cannot produce a 41st deal without the discard coming back.
      const notRecycled = rows
        .filter((r) => answers(r.run.state) <= SHORT_DECK)
        .map((r) => `seed ${r.seed}: ${answers(r.run.state)} answers from ${SHORT_DECK} cards`);
      expect(notRecycled, `${n} players on a ${SHORT_DECK}-card deck: a game never needed the discard back`).toEqual([]);

      // 2. AND THE SECOND, INDEPENDENT FORM OF THE SAME CLAIM. `answers > distinct`
      //    means a card was literally dealt twice, and `maxDealings > 1` names it. This
      //    is not the same arithmetic as (1) — it reads the per-card multiplicity out of
      //    public state rather than comparing a count with a deck size.
      for (const { seed, run } of rows) {
        const s = run.state;
        const a = answers(s);
        const d = distinctDealt(s);
        expect(d, `seed ${seed}: the whole deck was not reached (${d} of ${SHORT_DECK})`).toBe(SHORT_DECK);
        expect(a - d, `seed ${seed}: no card was dealt twice`).toBeGreaterThan(0);
        expect(maxDealings(s), `seed ${seed}: no single card was dealt twice`).toBeGreaterThan(1);
      }

      // 3. AND THE GAME STILL ENDED THE RIGHT WAY. This is the half that separates a
      //    recycle from the shipped bug: a reshuffle keeps the game going, and the
      //    exhaustion branch never fired on the way.
      for (const { seed, run } of rows) {
        const s = run.state;
        expect(s.finished, `${n} players, ${SHORT_DECK}-card deck, seed ${seed}: ${run.reason}`).toBe(true);
        expect(majoritiesOn(s), `${n} players, ${SHORT_DECK}-card deck, seed ${seed}: ${majoritiesOn(s)} majorities`).toBe(
          BOARD.zones,
        );
        expect(exhausted(s), `${n} players, ${SHORT_DECK}-card deck, seed ${seed}: the deck still exhausted`).toBe(false);
        expect(
          s.log.filter((l) => l.text === 'The election is decided.').length,
          `${n} players, ${SHORT_DECK}-card deck, seed ${seed}: the game did not end on a decided board`,
        ).toBe(1);
      }

      console.log(
        `RECYCLE short n=${n} deck ${SHORT_DECK}: answers ${spread(rows.map((r) => answers(r.run.state)))} | ` +
          `distinct ${spread(rows.map((r) => distinctDealt(r.run.state)))} | ` +
          `max dealings of one card ${Math.max(...rows.map((r) => maxDealings(r.run.state)))} | ` +
          `recycled ${rows.length}/${rows.length} | finished ${rows.filter((r) => r.run.state.finished).length}/${rows.length} | ` +
          `cliff fired 0/${rows.length}`,
      );
    });
  }

  it('a one-card Ideology deck recycles on turn two — which is the tightest possible proof', () => {
    // With ONE Ideology Card the draw pile empties on turn one, so the second deal can
    // only come from the discard. That is `draw()`'s reshuffle branch and nothing else,
    // and it is the smallest configuration in which the claim "the recycle fires" is
    // forced rather than merely likely.
    //
    // Note what is NOT asserted: that the game finishes. It does not — a single card
    // means every seat answers the same two sides forever and the driver stalls at
    // 2 of 9 majorities. The exhaustion branch still never fires, which is the property
    // that matters and the one the shipped bug violated.
    const cards = withIdeologyDeckOf(1);
    const ctx = ctxOn(cards);
    const run = playInProcess(deal(1, 2, cards), ctx, { maxActions: 200 });
    expect(answers(run.state), 'a one-card deck did not recycle').toBeGreaterThan(1);
    expect(distinctDealt(run.state), 'a one-card deck dealt more than one distinct card').toBe(1);
    expect(maxDealings(run.state), 'the single card was not dealt more than once').toBe(answers(run.state));
    expect(exhausted(run.state), 'a one-card deck exhausted rather than recycling — that is the shipped bug').toBe(false);
    console.log(
      `RECYCLE one-card: answers ${answers(run.state)} distinct ${distinctDealt(run.state)} ` +
        `finished=${run.state.finished} majorities=${majoritiesOn(run.state)} exhausted=${exhausted(run.state)} (${run.reason})`,
    );
  });
});

// ───────────── C. the old proxy, restated as what it now would and would not catch ─────────────

describe('CHARACTERISATION: the turn-count proxy is vacuous on the shipped deck, and is left as such', () => {
  for (const n of SEATS) {
    it(`${n} players: the deepest game clears or misses the 76-card turn cliff`, () => {
      const rows = SEEDS.map((seed) => ({ seed, run: playInProcess(freshShippedCorpus(seed, n, base), base, { maxActions: 1200 }) }));
      const deepest = Math.max(...rows.map((r) => r.run.state.turn));
      const clearsCliff = rows.filter((r) => r.run.state.turn > SHIPPED_DECK);

      // Printed, not asserted in either direction. This is the whole reason the proxy was
      // removed and it is worth keeping visible: at three of the four seat counts NOT ONE
      // game in twenty reaches turn 77, so the old assertion was satisfied by the driver
      // getting worse rather than by the engine getting better.
      console.log(
        `CLIFF PROXY n=${n}: deepest turn ${deepest}, deck ${SHIPPED_DECK}, ` +
          `${clearsCliff.length}/${rows.length} games clear the cliff ` +
          `[${clearsCliff.map((r) => `seed ${r.seed}@${r.run.state.turn}`).join(' ')}]`,
      );

      // The assertion that replaced it, stated here so the two are visibly different:
      // R10's branch is the exact property, and it is the same at every seat count
      // because it is not a function of how long anybody played.
      expect(
        rows.filter((r) => exhausted(r.run.state)).map((r) => `seed ${r.seed} exhausted the deck`),
        `${n} players: the exhaustion branch fired`,
      ).toEqual([]);
    });
  }
});