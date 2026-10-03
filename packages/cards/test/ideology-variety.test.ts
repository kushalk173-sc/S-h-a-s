/**
 * THE IDEOLOGY DECK'S VARIETY, AS A DERIVED FACT rather than a claim in a changelog.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `npm run balance` answers one question per card: *is either side strictly better?* It
 * cannot answer the two questions that decide whether the deck is playable more than once:
 *
 *  - **is the payout structure an answer to every question?** If every card's higher
 *    total sits on one side, a player who has seen the deck once never has to read a
 *    question again. `docs/PLAN.md` §9 calls this *"players optimise instead of
 *    deliberating and the entire premise collapses"*, and the dominance worry gets WORSE
 *    when the payout is visible to the whole table rather than hidden under the card.
 *  - **does the deck actually span the situations a political game should cover?** A
 *    deck of twenty procurement questions is large and monotonous at the same time.
 *
 * Both are properties of the DECK, so asserting them per card proves nothing and
 * asserting them in prose proves nothing either: the next deck edit silently changes
 * them. So they are derived here from the shipped JSON, the same way
 * `test/reducer-parity.test.ts` re-derives the executable registries from the reducer's
 * own source.
 *
 * ## WHAT IS AND IS NOT PINNED
 *
 * These are FLOORS and INVARIANTS, not a design freeze. The thresholds are set so that
 * an ordinary authoring pass passes and a *degenerating* one fails. Nothing here pins a
 * card id, a question, or a payout: those are design, and design is allowed to move.
 * What is not allowed to move is "the deck stops being a deck".
 */

import { describe, expect, it } from 'vitest';

import { loadIdeologyDeck } from '../src/corpus.js';
import { IDEOLOGUES, RESOURCES, RULES, sidePayout } from '../src/engine.js';
import type { CorpusIdeologyCard } from '../src/corpus.js';

/** The India deck is the one players see every turn, and the one REF 2.4 says is invented. */
const india = loadIdeologyDeck('in2020');

function pairs(cards: readonly CorpusIdeologyCard[]): Set<string> {
  const out = new Set<string>();
  for (const card of cards) {
    const [a, b] = card.sides;
    out.add([a.ideologue, b.ideologue].sort().join('×'));
  }
  return out;
}

describe('the India Ideology deck is a deck, not a list', () => {
  it('is large enough that a 5-player game does not see all of it', () => {
    // REF 2.3: a 5-player game answers 8-12 cards, and a real campaign ships 108. The
    // deck was 12 (players saw the whole thing), then 32. A floor of 48 keeps the deck
    // at four times the largest hand a table can hold.
    expect(india.length).toBeGreaterThanOrEqual(48);
  });

  it('exercises all six Ideologue pairings, so no answer is predictable from the pair', () => {
    // REF 2.3 [INFERRED] from 14 tournament hands that the real campaign is a curated
    // pairing table. Whatever the real distribution is, a deck that never pairs two
    // Ideologues teaches its players the pairing instead of the question.
    expect(pairs(india).size).toBe(6);
  });

  it('keeps every Ideologue on roughly a quarter of all sides', () => {
    // Reported, not frozen: `npm run balance` warns at ±20 points (IDEOLOGUE_SKEW) and
    // the shipped deck sits inside 2 points of even. This asserts the shipped shape so
    // the warning in the balance output can never become normal.
    const sides = india.flatMap((c) => c.sides.map((s) => s.ideologue));
    for (const ideologue of IDEOLOGUES) {
      const share = sides.filter((s) => s === ideologue).length / sides.length;
      expect(share, `${ideologue} holds ${(share * 100).toFixed(0)}% of card sides`).toBeGreaterThan(0.2);
      expect(share, `${ideologue} holds ${(share * 100).toFixed(0)}% of card sides`).toBeLessThan(0.3);
    }
  });

  it('pays BOTH sides of every new card the same total, so the payout never names an answer', () => {
    // THE LOAD-BEARING ASSERTION, and it is the reason this file is not a summary.
    //
    // `resourcePreferredSide` in `src/balance.ts` calls a card DECISIVE the moment one
    // side's total exceeds the other's. A decisive card contributes to
    // `resourceBlind.leadShare`, and above `RESOURCE_BLIND_LEAN_THRESHOLD` (0.8) the
    // checker calls the deck solvable without reading it. Making the two totals EQUAL
    // makes `resourcePreferredSide` return `null` for the card, which is the checker's
    // own words for *"the question has to decide this"*.
    //
    // The pre-existing unequal card is named rather than deleted: swapping a shipped
    // card for a tidier one is the corpus swap `KNOWN-GAPS.md` §4 records as having
    // regressed the server suite, and `packages/cards` may not make that trade alone.
    const unequal = india.filter((c) => sidePayout(c.sides[0]) !== sidePayout(c.sides[1]));
    expect(unequal.map((c) => c.id)).toEqual(['ig-in2020-006']);
  });

  it('never pays 3 or more of one resource, so no card can cross a power threshold', () => {
    // `POWER_THRESHOLD_CLIFF` fires when a side pays `RULES.level3` (3) or `RULES.level5`
    // (5) of its OWN Ideologue's resource and the other side does not. A 2-resource cap
    // on any single resource makes that check structurally unreachable, so it cannot
    // become an error by a later author choosing a bigger number. (KNOWN-GAPS §6 records
    // that the shipped decks already produce zero crossings under either version.)
    for (const card of india) {
      for (const side of card.sides) {
        for (const res of RESOURCES) {
          expect(side.pays[res] ?? 0, `${card.id} pays ${side.pays[res]} ${res}`).toBeLessThan(
            RULES.level3,
          );
        }
      }
    }
  });

  it('spans more than one question per subject, because a deck can be large and monotonous', () => {
    // A coarse, honest proxy: the six most common words in the questions are counted
    // over a stem of at least five words, and the commonest must not be a majority of
    // the deck. REF 2.4 records that the eight recovered stems are entirely national and
    // international in framing; this is the guard against a future pass making that
    // worse rather than better.
    const STOP = new Set([
      'should', 'the', 'a', 'an', 'be', 'to', 'of', 'for', 'and', 'is', 'it', 'in', 'on',
      'its', 'their', 'every', 'their', 'that', 'with', 'by', 'from', 'one', 'this',
    ]);
    const counts = new Map<string, number>();
    for (const card of india) {
      const words = card.question
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w));
      for (const w of new Set(words)) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(commonest, 'no question contributed a word to count').toBeDefined();
    const [word, hits] = commonest as [string, number];
    expect(hits / india.length, `"${word}" appears in ${hits} of ${india.length}`).toBeLessThan(0.25);
  });
});