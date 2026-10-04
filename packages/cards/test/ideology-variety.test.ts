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

import { DECK_IDS, loadIdeologyDeck } from '../src/corpus.js';
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
    // `ig-in2020-006` WAS the one unequal card and it was named here rather than deleted,
    // on the grounds that swapping a shipped card for a tidier one is the corpus swap
    // `KNOWN-GAPS.md` §4 records as having regressed the server suite, and
    // `packages/cards` may not make that trade alone. **That trade has since been made,
    // deliberately and one number at a time**: D2's tolerance band is now 0 and
    // `TOTAL_SKEW` is an error, so a visible one-resource edge is refused rather than
    // warned about, and this card's side 1 was rebalanced from `{media 2, funds 1}` to
    // `{media 2, funds 2}` — one resource, on the one card that had it. The two
    // compositions stay incomparable, which is the point of the checker: the player picks
    // on which Ideologue they are playing rather than on arithmetic. See
    // `BALANCE_TOLERANCE_TOTAL` in `src/balance.ts`.
    const unequal = india.filter((c) => sidePayout(c.sides[0]) !== sidePayout(c.sides[1]));
    expect(unequal.map((c) => c.id), 'a card pays its two sides different totals; D2 now refuses the corpus').toEqual([]);
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

  it('spans more than one question per subject, because a deck can be large and monotonous', () => {    // A coarse, honest proxy: the six most common words in the questions are counted
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

  it('gives every card two sides that ARGUE WITH EACH OTHER, not one argument twice', () => {
    // THE WRITING CONSEQUENCE OF THE PAYOUT NEVER DECIDING, AND THE ONE DECK DEFECT
    // THAT IS ACTUALLY MECHANICAL.
    //
    // `npm run balance` measures that 0 of 76 cards are decided by their payout, so the
    // dilemma is the ONLY thing that decides an answer. That puts the whole burden on the
    // two answer strings — and it turns out three cards were not carrying it. They opened
    // both sides with the SAME three-word action frame, so each "No" told the reader to
    // do the thing its own "No" refused:
    //
    //   ig-in2020-016  Q: digitise land records?   No. *Digitise it now* and ...
    //   ig-in2020-023  Q: publish a deserter?      No. *Publish it* and ...
    //   ig-in2020-029  Q: name the schools?        No. *Name the schools* and ...
    //
    // On those cards the polarity token was the entire difference between the sides, so
    // the card asked nothing. All three answers were rewritten on 2026-10-04 and each
    // rewrite is recorded in that card's own `source` field and in `decks/SOURCES.md`.
    //
    // NO BALANCE CHECK CAN CATCH THIS, which is the point of putting it here: the payout
    // is identical on both sides of all three cards and always was, so the instrument
    // that governs this deck had nothing to say and said nothing. The screen is
    // deliberately mechanical — the first three content words of both answers, after the
    // polarity token — so it costs nothing and cannot rot into a matter of opinion.
    //
    // WHY THREE WORDS AND NOT ONE. One word is far too loose: "Teach the old one" against
    // "Teach the new one" (ig-et2040-005) and "Count them where they sleep" against
    // "Count them where they vote" (ig-in2020-027) are both REAL dilemmas that happen to
    // open with a shared verb, and a one-word rule would have flagged two good cards. The
    // three-word frame includes the verb's object, which is where the two sides have to
    // diverge for the card to be asking anything.
    const STOP = new Set([
      'should', 'the', 'a', 'an', 'be', 'to', 'of', 'for', 'and', 'is', 'it', 'in', 'on',
      'its', 'their', 'every', 'that', 'with', 'by', 'from', 'one', 'this', 'we', 'our',
      'us', 'they', 'them', 'not', 'but', 'so', 'if', 'as', 'at', 'do', 'does', 'did',
      'has', 'have', 'had', 'will', 'would', 'can', 'could', 'than', 'then', 'there',
      'what', 'when', 'who', 'how', 'all', 'any', 'more', 'most', 'only', 'also', 'into',
      'over', 'under', 'out', 'up', 'down', 'about', 'after', 'before', 'because',
      'been', 'being', 'both', 'each', 'few', 'other', 'some', 'such', 'own', 'same',
      'too', 'very', 'just', 'now', 'get', 'make', 'take', 'give', 'let', 'put', 'see',
      'say', 'tell', 'ask', 'use', 'need', 'want', 'like', 'good', 'better', 'bad',
      'worse', 'never', 'always', 'still', 'yet', 'even', 'while', 'where', 'why',
      'whether', 'which', 'during', 'above', 'below', 'between', 'through', 'against',
      'among', 'within', 'without', 'along', 'across', 'behind', 'beyond', 'near',
      'off', 'per', 'via', 'two', 'three', 'no', 'yes',
    ]);
    const content = (s: string): string[] =>
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w));
    const polarity = (s: string): string =>
      /^\s*yes\b/i.test(s) ? 'Yes' : /^\s*no\b/i.test(s) ? 'No' : '??';

    const offenders: string[] = [];
    for (const deck of DECK_IDS) {
      for (const card of loadIdeologyDeck(deck)) {
        const [a, b] = card.sides;
        const p0 = polarity(a.answer);
        const p1 = polarity(b.answer);
        // Same polarity on both sides is a different (and legitimate) shape; only an
        // OPPOSED pair can be the "one argument, two tokens" failure.
        if (p0 === p1 || p0 === '??' || p1 === '??') continue;
        const b0 = content(a.answer);
        const b1 = content(b.answer);
        if (b0.length < 3 || b1.length < 3) continue;
        if (b0.slice(0, 3).join(' ') === b1.slice(0, 3).join(' ')) offenders.push(card.id);
      }
    }
    expect(
      offenders,
      'both sides open with the same action frame, so the polarity token is the only ' +
        'difference and the card asks nothing — rewrite one answer, do NOT rebalance',
    ).toEqual([]);
  });
});