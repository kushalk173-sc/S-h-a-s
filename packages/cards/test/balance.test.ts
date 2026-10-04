import { describe, expect, it } from 'vitest';

import {
  BALANCE_TOLERANCE_TOTAL,
  CONSPIRACY_MIN_COST,
  IDEOLOGUE_SKEW_TOLERANCE,
  PAYOUT_DECIDED_SHARE_THRESHOLD,
  RESOURCE_BLIND_LEAN_THRESHOLD,
  X_EFFECT_MAGNITUDE_BUDGET,
  analyseIdeologyCard,
  balanceCorpus,
  deckBias,
  marketConversionModel,
  voterValue,
  xCardMagnitude,
  type BalanceFinding,
  type XCardLike,
} from '../src/balance.js';
import {
  buildConversionModel,
  measureDecisiveness,
  reachableHoldings,
  toughLoveOption,
  voterMarketOptions,
  type ConversionModel,
} from '../src/holdings.js';
import { RESOURCES, RULES, type Effect } from '../src/engine.js';
import type { CorpusIdeologyCard, CorpusVoterCard } from '../src/corpus.js';
import { DECK_IDS, loadConspiracyDeck, loadHeadlineDeck, loadIdeologyDeck, loadVoterDeck } from '../src/corpus.js';
import { deltaTotal } from '../../engine/src/state';

/** The economy every shipped card is measured against. Built once; the model is pure. */
const shippedModel = (): ConversionModel =>
  marketConversionModel(new Map([['core', loadVoterDeck('core')]]));

let nextId = 0;

/** Build a two-sided Ideology Card. Both sides state their own resource. */
function card(
  a: { answer: string; ideologue: CorpusIdeologyCard['sides'][0]['ideologue']; pays: Record<string, number> },
  b: { answer: string; ideologue: CorpusIdeologyCard['sides'][0]['ideologue']; pays: Record<string, number> },
): CorpusIdeologyCard {
  nextId += 1;
  const id = `ig-test-${String(nextId).padStart(3, '0')}`;
  return {
    id,
    source: 'original; test fixture',
    provenance: 'inferred',
    campaign: 'Test',
    question: `Should the test number ${nextId} be allowed to stand?`,
    sides: [
      { answer: a.answer, ideologue: a.ideologue, pays: a.pays },
      { answer: b.answer, ideologue: b.ideologue, pays: b.pays },
    ],
  };
}

function codes(findings: readonly BalanceFinding[]): string[] {
  return findings.map((f) => f.code);
}

describe('dominance: D1 PURE_UPGRADE — the failure a totals checker misses', () => {
  it('catches a 1-resource pure upgrade that sits INSIDE the tolerance band', () => {
    // funds 2 >= funds 1 and trust 2 == trust 2, so side 1 dominates side 0 on
    // every resource and strictly on one. The totals differ by exactly 1, which
    // is inside BALANCE_TOLERANCE_TOTAL — a totals-only checker is silent, and
    // the band alone would not save the card.
    //
    // (docs/ARCHITECTURE.md 6.4.3 presents this as a 0-sum card. The arithmetic
    // there does not hold: if X >= Y componentwise and X != Y then sum(X) > sum(Y)
    // strictly, so a pure upgrade can never be 0-sum. The argument survives intact
    // once the gap is stated honestly as 1. The gap is no longer swallowed — the band
    // is 0 — so D2 fires on this card as well as D1, which is the ruling's whole point:
    // a card this dominated is refused twice over.)
    expect(Math.abs(3 - 4)).toBe(1);
    expect(BALANCE_TOLERANCE_TOTAL).toBeLessThan(Math.abs(3 - 4));
    const c = card(
      { answer: 'Yes. Divert the industrial supply for the tankers.', ideologue: 'idealist', pays: { funds: 1, trust: 2 } },
      { answer: 'No. Divert the industrial supply and keep the factories.', ideologue: 'capitalist', pays: { funds: 2, trust: 2 } },
    );
    const upgrade = analyseIdeologyCard(c, 'test').find((f) => f.code === 'PURE_UPGRADE');
    expect(upgrade).toBeDefined();
    expect(upgrade?.severity).toBe('error');
    expect(upgrade?.side).toBe(1);
    // The wider reach, asserted because it is what the band at 1 used to hide: D2 sees it
    // too now.
    expect(codes(analyseIdeologyCard(c, 'test'))).toContain('TOTAL_SKEW');
  });

  it('catches a pure upgrade in the other direction', () => {
    const c = card(
      { answer: 'Yes. Divert the industrial supply and keep the factories.', ideologue: 'capitalist', pays: { funds: 2, trust: 2 } },
      { answer: 'No. Divert the industrial supply for the tankers.', ideologue: 'idealist', pays: { funds: 1, trust: 2 } },
    );
    const upgrade = analyseIdeologyCard(c, 'test').find((f) => f.code === 'PURE_UPGRADE');
    expect(upgrade?.side).toBe(0);
  });

  it('does NOT flag a genuine trade-off of the same size', () => {
    // Same totals, same resources available, but each side gives a different one.
    // The player is choosing which resource they need — this is the deliberation
    // the game is made of, and it must survive the checker.
    const c = card(
      { answer: 'Yes. Move the money to the schools this year.', ideologue: 'idealist', pays: { trust: 2, funds: 1 } },
      { answer: 'No. Leave the money where it already clears fastest.', ideologue: 'capitalist', pays: { funds: 2, media: 1 } },
    );
    expect(codes(analyseIdeologyCard(c, 'test'))).toEqual([]);
  });

  it('does NOT flag a symmetric threshold crossing', () => {
    // 3 Trust against 3 Funds. Each side pays 3 of a resource the other pays none
    // of, so a naive per-direction cliff test calls this dominated twice. It is
    // not: both sides buy exactly one unlock and the choice of which is real.
    const c = card(
      { answer: 'Yes. Move the money to the schools this year.', ideologue: 'idealist', pays: { trust: 3 } },
      { answer: 'No. Leave the money where it already clears fastest.', ideologue: 'capitalist', pays: { funds: 3 } },
    );
    expect(codes(analyseIdeologyCard(c, 'test'))).toEqual([]);
  });
});

/**
 * Pins the arithmetic of the header comment in `src/balance.ts`.
 *
 * The comment once claimed `{funds:3}` vs `{funds:2, media:1}` "is 0-sum and yet
 * a pure upgrade for anyone who needs funds". The first half is true and the second
 * half is false: `media` is 0 on side A and 1 on side B, so side B is NOT >= side A
 * componentwise. These assertions make the wrong claim unrepresentable, so it cannot
 * creep back into a comment as if it were a worked example.
 */
describe('the corrected arithmetic behind the header comment', () => {
  const A: Record<string, number> = { funds: 3 };
  const B: Record<string, number> = { funds: 2, media: 1 };

  /** Componentwise `x >= y` on every resource, with at least one strict. */
  const dominates = (x: Record<string, number>, y: Record<string, number>): boolean => {
    const keys = ['funds', 'trust', 'media', 'clout'];
    let strict = false;
    for (const k of keys) {
      const xv = x[k] ?? 0;
      const yv = y[k] ?? 0;
      if (xv < yv) return false;
      if (xv > yv) strict = true;
    }
    return strict;
  };

  const sum = (d: Record<string, number>): number =>
    ['funds', 'trust', 'media', 'clout'].reduce((n, k) => n + (d[k] ?? 0), 0);

  it('the worked example IS 0-sum', () => {
    expect(sum(A)).toBe(3);
    expect(sum(B)).toBe(3);
    expect(sum(A)).toBe(sum(B));
  });

  it('the worked example is NOT a pure upgrade in either direction', () => {
    // media: A = 0, B = 1 — so B is short nothing, but A is short one Media, and
    // A is not short anything B has either. Neither side dominates.
    expect(A.media ?? 0).toBe(0);
    expect(B.media ?? 0).toBe(1);
    expect(dominates(A, B)).toBe(false);
    expect(dominates(B, A)).toBe(false);
  });

  it('a pure upgrade can NEVER be 0-sum — the identity the bad claim rested on', () => {
    // if X >= Y componentwise and X != Y then sum(X) > sum(Y), strictly. Enumerated
    // rather than asserted, so the whole small space of 0-3 payouts is covered.
    const space = [0, 1, 2, 3];
    let compared = 0;
    for (const f of space)
      for (const t of space)
        for (const m of space)
          for (const cl of space) {
            const x = { funds: f, trust: t, media: m, clout: cl };
            for (const g of space)
              for (const u of space)
                for (const v of space)
                  for (const w of space) {
                    const y = { funds: g, trust: u, media: v, clout: w };
                    compared += 1;
                    if (dominates(x, y)) expect(sum(x)).toBeGreaterThan(sum(y));
                    if (dominates(y, x)) expect(sum(y)).toBeGreaterThan(sum(x));
                  }
          }
    expect(compared).toBe(4 ** 8);
  });

  it('the good-card example is 3 apart per resource and EQUAL in total', () => {
    // `{funds:3}` vs `{trust:3}`: the two sides differ by 3 on Funds and by 3 on
    // Trust, as large a componentwise gap as a card can have — and their TOTALS are
    // identical, 3 against 3. So this card is invisible to a totals checker AND to
    // a componentwise checker, and it is the good one. (Saying "a 3-resource
    // difference" without "per resource" is what made this comment wrong before.)
    const G: Record<string, number> = { trust: 3 };
    expect(Math.abs((A.funds ?? 0) - (G.funds ?? 0))).toBe(3);
    expect(Math.abs((A.trust ?? 0) - (G.trust ?? 0))).toBe(3);
    expect(sum(A)).toBe(3);
    expect(sum(G)).toBe(3);
    expect(sum(A)).toBe(sum(G));
    expect(dominates(A, G)).toBe(false);
    expect(dominates(G, A)).toBe(false);
  });

  it('and the checker agrees with both: the good card is clean', () => {
    const good = card(
      { answer: 'Yes. Move the money to the schools this year.', ideologue: 'capitalist', pays: { funds: 3 } },
      { answer: 'No. Keep the money where it already clears fastest.', ideologue: 'idealist', pays: { trust: 3 } },
    );
    expect(codes(analyseIdeologyCard(good, 'test'))).toEqual([]);
  });
});

describe('dominance: D2 TOTAL_SKEW — REPORTED, and measured to be the wrong error', () => {
  it('still reports a one-resource total edge, and says it is not enforced', () => {
    // WHAT CHANGED, AND WHY THIS IS NOT THE CHECK BEING WEAKENED TO PASS CARDS.
    //
    // This test used to assert `severity === 'error'`. That assertion is gone because
    // the severity was wrong, and the reason it was wrong is measured rather than
    // preferred — see the ruling at the top of `src/balance.ts` and, here, the two
    // assertions below that make the mistake impossible to reintroduce by accident.
    //
    // The FINDING IS STILL RAISED. A visible total edge is still reported, still names
    // the side at fault and still carries the reason it is not an error, so the
    // information reaches a pull request instead of being thrown away.
    const c = card(
      { answer: 'Yes. Publish the whole file and let the room decide.', ideologue: 'showstopper', pays: { media: 3, trust: 1 } },
      { answer: 'No. Publish the summary and keep the file closed.', ideologue: 'capitalist', pays: { funds: 4 } },
    );
    // 4 against 4 — inside the band, and the card is clean.
    expect(codes(analyseIdeologyCard(c, 'test'))).not.toContain('TOTAL_SKEW');

    const tilted = card(
      { answer: 'Yes. Publish the whole file and let the room decide.', ideologue: 'showstopper', pays: { media: 3, trust: 2 } },
      { answer: 'No. Publish the summary and keep the file closed.', ideologue: 'capitalist', pays: { funds: 4 } },
    );
    const skew = analyseIdeologyCard(tilted, 'test').find((f) => f.code === 'TOTAL_SKEW');
    expect(skew, 'a visible one-resource edge was not even reported').toBeDefined();
    expect(skew?.side).toBe(0);
    expect(skew?.message).toContain('REPORTED rather than refused');
    expect(skew?.message).toContain('99.4%');
  });

  it('a total edge is usually an INVERSION, which is why an error band would be wrong', () => {
    // THE MEASUREMENT, asserted rather than described. `canAfford` is componentwise and
    // the cap is 12 TOTAL, so surplus of one resource is worthless while a missing one is
    // a purchase. At `{funds: 9}` the bigger payout converts to 2 voters and the smaller
    // to 5 — so an error-severity band on totals would refuse the better card.
    const model = marketConversionModel(new Map([['core', loadVoterDeck('core')]]));
    const rich = [9, 0, 0, 0];
    const bigger = model.bestConversion(rich, { funds: 4 });
    const smaller = model.bestConversion(rich, { funds: 1, trust: 2 });
    expect(deltaTotal({ funds: 4 }), 'the fixture must really be the bigger payout').toBeGreaterThan(
      deltaTotal({ funds: 1, trust: 2 }),
    );
    expect(bigger, 'the LARGER total converted better, which would vindicate error severity').toBeLessThan(
      smaller,
    );
  });

  it('and the band is still zero, so the corpus invariant is unchanged', () => {
    // Asserted rather than merely configured, because the number is still the shipped
    // convention. Demoting the SEVERITY did not widen the band: the corpus invariant
    // "both sides of every card pay the same total" is untouched, and the next test
    // proves it over the shipped decks.
    expect(BALANCE_TOLERANCE_TOTAL).toBe(0);
  });

  it('and NO shipped Ideology Card has a visible skew, which is the corpus measurement', () => {
    // Unchanged by this round, and asserted over the corpus rather than as a number in a
    // commit message: the ruling is (a), so equal totals are PRESERVED, not relaxed.
    const skewed = DECK_IDS.flatMap((d) => loadIdeologyDeck(d))
      .map((c) => ({ id: c.id, a: deltaTotal(c.sides[0].pays), b: deltaTotal(c.sides[1].pays) }))
      .filter((r) => Math.abs(r.a - r.b) > BALANCE_TOLERANCE_TOTAL);
    expect(skewed.map((r) => `${r.id} ${r.a} vs ${r.b}`)).toEqual([]);
    const band1 = DECK_IDS.flatMap((d) => loadIdeologyDeck(d)).filter((c) => Math.abs(deltaTotal(c.sides[0].pays) - deltaTotal(c.sides[1].pays)) === 1);
    expect(band1.map((c) => c.id), 'a card sits exactly on the old tolerance band').toEqual([]);
  });

  it('EVERY shipped side pays 2+1, which is the shape the ruling depends on', () => {
    // The ruling's factual base, pinned so it cannot rot silently. 76 of 76 cards pay
    // equal totals and every one of the 152 sides is a 2-of-one-plus-1-of-another shape
    // of 3 (two cards pay 4 on BOTH sides). This is the "a rule, not an accident" half of
    // the argument, and if a future edit breaks it the ruling's premise needs revisiting.
    const sides = DECK_IDS.flatMap((d) => loadIdeologyDeck(d)).flatMap((c) => c.sides);
    const shapes = new Map<string, number>();
    for (const s of sides) {
      const present = RESOURCES.filter((r) => (s.pays[r] ?? 0) > 0);
      const key = present.map((r) => (s.pays[r] ?? 0).toString()).sort().join('+');
      shapes.set(key, (shapes.get(key) ?? 0) + 1);
    }
    expect([...shapes.entries()].sort(), 'a shipped side pays a shape other than 1+2 or 2+2').toEqual(
      expect.arrayContaining([
        ['1+2', expect.any(Number)],
        ['2+2', expect.any(Number)],
      ]),
    );
    const bad = [...shapes.keys()].filter((k) => k !== '1+2' && k !== '2+2');
    expect(bad, `a shipped side pays a shape other than 1+2 or 2+2: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('dominance: D3 POWER_THRESHOLD_CLIFF — overrides the band', () => {
  it(`catches a 1-resource gap across the level-${RULES.level3} unlock`, () => {
    // A difference of one resource, well inside the tolerance band, but 3 Trust
    // is the Idealist level-3 threshold (RULES p15): crossing it unlocks a power
    // that pays out every turn for the rest of the game. The other side crosses
    // nothing at all, so its crossing set is a strict subset.
    expect(BALANCE_TOLERANCE_TOTAL).toBeLessThan(Math.abs(3 - 2));
    const c = card(
      { answer: 'Yes. The fund should publish every payment it makes.', ideologue: 'idealist', pays: { trust: 3 } },
      { answer: 'No. The fund should publish nothing at all.', ideologue: 'showstopper', pays: { media: 2 } },
    );
    const cliff = analyseIdeologyCard(c, 'test').find((f) => f.code === 'POWER_THRESHOLD_CLIFF');
    expect(cliff).toBeDefined();
    expect(cliff?.severity).toBe('error');
    expect(cliff?.message).toContain(`trust@${RULES.level3}`);
  });

  it(`also fires when one side crosses BOTH the level-${RULES.level3} and level-${RULES.level5} lines`, () => {
    const c = card(
      { answer: 'Yes. Hold the seat until the matter is finished.', ideologue: 'supremo', pays: { clout: 5 } },
      { answer: 'No. Concede the seat before the gallery is told.', ideologue: 'idealist', pays: { trust: 4, media: 1 } },
    );
    const cliff = analyseIdeologyCard(c, 'test').find((f) => f.code === 'POWER_THRESHOLD_CLIFF');
    expect(cliff?.message).toContain(`buys 2 power unlock(s) (clout@${RULES.level3} + clout@${RULES.level5})`);
    expect(cliff?.message).toContain(`against side 1 (idealist)'s 1 (trust@${RULES.level3})`);
  });

  // ── the two halves of the corrected header comment, as executable assertions ──

  it(`MUST flag the header's own worked example: {funds:${RULES.level3}} vs {funds:${RULES.level3 - 1}, media:1}`, () => {
    // This is the corrected form of case 2 in the file header. It is 0-sum, so
    // TOTAL_SKEW is silent; it is NOT componentwise dominated, so PURE_UPGRADE is
    // silent. The ONLY thing the checker can see is the cliff: 3 Funds is
    // RULES.level3, so side 0 buys the Capitalist Level 3 power and side 1, whose
    // own Ideologue resource is Media and which pays 1 of it, buys nothing.
    const c = card(
      { answer: 'Yes. Release the tender figures in full.', ideologue: 'capitalist', pays: { funds: 3 } },
      { answer: 'No. Release the figures two at a time, in summary.', ideologue: 'showstopper', pays: { funds: 2, media: 1 } },
    );
    const findings = analyseIdeologyCard(c, 'test');
    expect(codes(findings)).not.toContain('TOTAL_SKEW');
    expect(codes(findings)).not.toContain('PURE_UPGRADE');
    const cliff = findings.find((f) => f.code === 'POWER_THRESHOLD_CLIFF');
    expect(cliff).toBeDefined();
    expect(cliff?.severity).toBe('error');
    expect(cliff?.side).toBe(0);
    expect(cliff?.message).toContain(`buys 1 power unlock(s) (funds@${RULES.level3})`);
    expect(cliff?.message).toContain('against side 1 (showstopper)\'s 0 (none)');
  });

  it('MUST NOT flag the same-total trade-off that does NOT straddle a threshold', () => {
    // The un-cliffed sibling of the example above: identical total, identical
    // shape, 2 Funds and 2 Media instead of 3 and 1. Nothing crosses
    // RULES.level3 on either side's own resource and neither side dominates, so
    // this is the card the game is made of and it must stay silent.
    const c = card(
      { answer: 'Yes. Release the tender figures in full.', ideologue: 'capitalist', pays: { funds: 2, media: 1 } },
      { answer: 'No. Release the figures two at a time, in summary.', ideologue: 'showstopper', pays: { media: 2, funds: 1 } },
    );
    expect(codes(analyseIdeologyCard(c, 'test'))).toEqual([]);
  });

  it('does not let a side pad its crossing count with resources it does not own', () => {
    // A count is gameable if a side is allowed to score unlocks for other
    // Ideologues. Capitalist {funds:3, media:3} scores only funds@3 — it has not
    // gained a Showstopper card, so media@3 is not an unlock it can spend. Idealist
    // {trust:5} scores trust@3 + trust@5. Unscoped, the two counts came out 2 and 2
    // and this card was called clean while the Idealist side quietly held the Level
    // 5 power and the Capitalist side held only Level 3.
    const c = card(
      { answer: 'Yes. Publish the register and the commentary together.', ideologue: 'capitalist', pays: { funds: 3, media: 3 } },
      { answer: 'No. Publish the register and let the commentary follow.', ideologue: 'idealist', pays: { trust: 5 } },
    );
    const findings = analyseIdeologyCard(c, 'test');
    // Totals 6 against 5: outside the band of 0, so D2 fires as well. The point of D3 is
    // unchanged - it is still the code that names the cliff - and D2 naming it too is
    // the ruling: a visible one-resource edge is an error in its own right.
    expect(codes(findings)).toContain('TOTAL_SKEW');
    const cliff = findings.find((f) => f.code === 'POWER_THRESHOLD_CLIFF');
    expect(cliff).toBeDefined();
    expect(cliff?.side).toBe(1);
    expect(cliff?.message).toContain(`buys 2 power unlock(s) (trust@${RULES.level3} + trust@${RULES.level5})`);
    expect(cliff?.message).toContain(`against side 0 (capitalist)'s 1 (funds@${RULES.level3})`);
    // The padding resource is named nowhere in the finding.
    expect(cliff?.message).not.toContain('media@');
  });
});

describe('dominance: D5 EMPTY_SIDE', () => {
  it('catches a side that pays nothing', () => {
    const c = card(
      { answer: 'Yes. Say the whole of it on the record.', ideologue: 'idealist', pays: { trust: 3, media: 1 } },
      { answer: 'No. Say nothing and let the record stay empty.', ideologue: 'supremo', pays: { clout: 0 } },
    );
    const findings = analyseIdeologyCard(c, 'test');
    const empty = findings.find((f) => f.code === 'EMPTY_SIDE');
    expect(empty).toBeDefined();
    expect(empty?.severity).toBe('error');
    expect(empty?.side).toBe(1);
  });
});

describe('D4 SAME_IDEOLOGUE_SKEW', () => {
  it('flags two sides of the same Ideologue, which RULES p13 forbids', () => {
    // Unreachable through the JSON Schema, which already forbids it. Retained
    // because the balance checker is runnable against an unschema-checked corpus.
    const c = card(
      { answer: 'Yes. Move the money to the schools this year.', ideologue: 'idealist', pays: { trust: 2, funds: 1 } },
      { answer: 'No. Leave the money where it already clears fastest.', ideologue: 'idealist', pays: { funds: 1, media: 2 } },
    );
    expect(codes(analyseIdeologyCard(c, 'test'))).toContain('SAME_IDEOLOGUE_SKEW');
  });
});

describe('the resource-blind heuristic', () => {
  it('reports "lean" when the payout-favoured side is always the same Ideologue', () => {
    // Eight cards, and on every one the CAPITALIST side is the one the payouts
    // favour. A player who has seen the deck once never has to read a card.
    const skewed: CorpusIdeologyCard[] = [];
    for (let i = 0; i < 8; i++) {
      skewed.push(
        card(
          { answer: 'Yes. The measure should be published in full.', ideologue: 'capitalist', pays: { funds: 3, media: 1 } },
          { answer: 'No. The measure should be published in summary.', ideologue: 'idealist', pays: { trust: 2, media: 1 } },
        ),
      );
    }
    const stats = deckBias('skewed', skewed);
    expect(stats.resourceBlind.verdict).toBe('lean');
    expect(stats.resourceBlind.leadingIdeologue).toBe('capitalist');
    expect(stats.resourceBlind.leadShare).toBeGreaterThan(RESOURCE_BLIND_LEAN_THRESHOLD);
  });

  it('reports "clean" when the favoured Ideologue is spread across the deck', () => {
    const even: CorpusIdeologyCard[] = [];
    for (let i = 0; i < 8; i++) {
      even.push(
        card(
          { answer: 'Yes. Publish the schedule before the season.', ideologue: 'capitalist', pays: { funds: 3, media: 1 } },
          { answer: 'No. Publish the schedule after the season.', ideologue: 'idealist', pays: { trust: 2, media: 1 } },
        ),
      );
    }
    for (let i = 0; i < 8; i++) {
      even.push(
        card(
          { answer: 'Yes. Hold the count until the third reading.', ideologue: 'idealist', pays: { trust: 3, media: 1 } },
          { answer: 'No. Hold the count until after the third reading.', ideologue: 'showstopper', pays: { media: 2, funds: 1 } },
        ),
      );
    }
    for (let i = 0; i < 8; i++) {
      even.push(
        card(
          { answer: 'Yes. Name the officer in the first line.', ideologue: 'showstopper', pays: { media: 3, trust: 1 } },
          { answer: 'No. Name the office in the first line.', ideologue: 'supremo', pays: { clout: 2, funds: 1 } },
        ),
      );
    }
    const stats = deckBias('even', even);
    expect(stats.resourceBlind.verdict).toBe('clean');
  });

  it('reports "undecidable" when the deck is too evenly balanced to have a resource answer', () => {
    const cards = loadIdeologyDeck('in2020');
    const stats = deckBias('in2020', cards);
    // This is the DESIRED outcome for a well-balanced corpus: the payout structure
    // does not tell you which side to take, so the question has to.
    expect(stats.resourceBlind.verdict).toBe('undecidable');
    expect(stats.meanSideGap).toBeLessThan(1);
  });
});

describe('per-deck bias statistics', () => {
  it('flags an Ideologue that is over-represented on card sides', () => {
    // Twenty cards, nineteen of which carry a capitalist side. REF 2.3 observed
    // exactly this drift in the real 108-card India campaign.
    const skewed: CorpusIdeologyCard[] = [];
    for (let i = 0; i < 19; i++) {
      skewed.push(
        card(
          { answer: 'Yes. The tender should go to the lowest bidder.', ideologue: 'capitalist', pays: { funds: 2, media: 1 } },
          { answer: 'No. The tender should go to the highest bidder.', ideologue: 'idealist', pays: { trust: 2, media: 1 } },
        ),
      );
    }
    skewed.push(
      card(
        { answer: 'Yes. Publish the tender and the bidder together.', ideologue: 'supremo', pays: { clout: 2, media: 1 } },
        { answer: 'No. Publish the tender and the bidder separately.', ideologue: 'showstopper', pays: { media: 2, funds: 1 } },
      ),
    );
    const report = balanceCorpus({ ideology: new Map([['skewed', skewed]]), voter: new Map() });
    const skew = report.findings.find((f) => f.code === 'IDEOLOGUE_SKEW');
    expect(skew).toBeDefined();
    expect(skew?.severity).toBe('warn');
    expect(skew?.message).toContain('capitalist');
    expect(IDEOLOGUE_SKEW_TOLERANCE).toBeGreaterThan(0);
  });
});

describe('the voter deck cost curve', () => {
  it('flags a deck where bigger cards are not more expensive', () => {
    const backwards: CorpusVoterCard[] = [
      { id: 'vo-test-001', source: 'original; test', provenance: 'inferred', cost: { funds: 5 }, voters: 1 },
      { id: 'vo-test-002', source: 'original; test', provenance: 'inferred', cost: { funds: 4 }, voters: 2 },
      { id: 'vo-test-003', source: 'original; test', provenance: 'inferred', cost: { funds: 2 }, voters: 3 },
    ];
    const report = balanceCorpus({ ideology: new Map(), voter: new Map([['backwards', backwards]]) });
    expect(codes(report.findings)).toContain('VOTER_COST_NON_MONOTONIC');
  });

  it('flags a size the deck barely offers', () => {
    const thin: CorpusVoterCard[] = [
      { id: 'vo-test-001', source: 'original; test', provenance: 'inferred', cost: { funds: 5 }, voters: 1 },
      { id: 'vo-test-002', source: 'original; test', provenance: 'inferred', cost: { funds: 2 }, voters: 3 },
      { id: 'vo-test-003', source: 'original; test', provenance: 'inferred', cost: { funds: 1 }, voters: 3 },
    ];
    const report = balanceCorpus({ ideology: new Map(), voter: new Map([['thin', thin]]) });
    const under = report.findings.filter((f) => f.code === 'VOTER_VALUE_UNDERREPRESENTED');
    // No 2-Voter cards at all, and only one 1-Voter card.
    expect(under.some((f) => f.message.includes('2-Voter card(s) in the deck'))).toBe(true);
    expect(under.some((f) => f.message.includes('1 1-Voter card(s)'))).toBe(true);
  });
});

describe('X-card magnitude: a card with no second side still has a value', () => {
  const xCard = (effects: Effect[]): XCardLike => ({ id: 'ct-test-001', name: 'A Test Card', effects });

  it('sums what the card hands its OWN player, counting a voter at the deck price', () => {
    // 3 Funds + 2 voters at 3 each = 9, over the budget of 6.
    expect(xCardMagnitude(xCard([{ op: 'gain', res: { funds: 3 } }, { op: 'voters', n: 2 }]), 3)).toBe(9);
  });

  it('subtracts what the card costs its player', () => {
    expect(xCardMagnitude(xCard([{ op: 'gain', res: { funds: 4 } }, { op: 'lose-any', n: 2 }]), 3)).toBe(2);
  });

  it("ignores what it does to OTHER players, which is not its caster's payoff", () => {
    // Every opponent losing 3 is 0 to the player resolving the card, and must not be
    // scored as if it were a 3-resource gift to them.
    expect(
      xCardMagnitude(
        xCard([
          { op: 'lose-any', n: 3, target: 'each-opponent' },
          { op: 'gain', res: { trust: 1 }, target: 'everyone' },
        ]),
        3,
      ),
    ).toBe(0);
  });

  it('counts a drawn Conspiracy Card at its printed minimum, and a discount at one per use', () => {
    expect(xCardMagnitude(xCard([{ op: 'draw-conspiracy', n: 2 }]), 3)).toBe(2 * CONSPIRACY_MIN_COST);
    expect(xCardMagnitude(xCard([{ op: 'discount', n: 2 }]), 3)).toBe(2);
  });

  it('counts board effects as zero — they move pegs, not discs', () => {
    expect(
      xCardMagnitude(
        xCard([
          { op: 'evict', n: 3 },
          { op: 'discard-voter', n: 3 },
          { op: 'convert-voter', n: 3 },
          { op: 'gerrymander', n: 3 },
          { op: 'refresh-market' },
        ]),
        3,
      ),
    ).toBe(0);
  });

  it('flags a card over the budget, and does not flag one inside it', () => {
    const loud = xCard([{ op: 'gain-any', n: 5 }, { op: 'voters', n: 1 }]);
    const quiet = xCard([{ op: 'gain-any', n: 2 }, { op: 'voters', n: 1 }]);
    const report = balanceCorpus({
      ideology: new Map(),
      voter: new Map(),
      x: new Map([['test', [loud, quiet]]]),
    });
    const flagged = report.findings.filter((f) => f.code === 'X_EFFECT_MAGNITUDE');
    expect(flagged.map((f) => f.cardId)).toEqual(['ct-test-001']);
    expect(flagged[0]?.severity).toBe('warn');
    expect(flagged[0]?.message).toContain(String(X_EFFECT_MAGNITUDE_BUDGET));
  });

  it('derives the price of a voter from the deck rather than assuming it', () => {
    // 2/1 = 2, 4/2 = 2, 9/3 = 3. Mean 2.33, rounded to a whole resource because a
    // fractional threshold would make the finding depend on deck arithmetic.
    expect(
      voterValue([
        { id: 'vo-test-001', source: 'original; test', provenance: 'inferred', cost: { funds: 2 }, voters: 1 },
        { id: 'vo-test-002', source: 'original; test', provenance: 'inferred', cost: { funds: 4 }, voters: 2 },
        { id: 'vo-test-003', source: 'original; test', provenance: 'inferred', cost: { funds: 9 }, voters: 3 },
      ]),
    ).toBe(2);
    expect(voterValue([])).toBeGreaterThan(0);
  });
});

describe('the holdings-conditional instrument: mix vs what you can spend', () => {
  const model = shippedModel();

  it('enumerates EVERY reachable holdings vector, not a sample', () => {
    // C(12+4, 4) = 1820. Asserted as a count AND as a property, because the whole
    // soundness of "one side is always correct" rests on the space being complete:
    // a sampled sweep could only ever say "no counterexample found".
    const all = reachableHoldings(RULES.resourceCap);
    expect(all).toHaveLength(1820);
    expect(all.every((h) => h.reduce((a, b) => a + b, 0) <= RULES.resourceCap)).toBe(true);
    // Closed under the definition: no reachable vector is missing.
    const seen = new Set(all.map((h) => h.join(',')));
    expect(seen.size).toBe(1820);
    expect(all).toContainEqual([0, 0, 0, 0]);
    expect(all).toContainEqual([12, 0, 0, 0]);
    expect(model.reachable).toHaveLength(1820);
  });

  it('SATURATES at the cap, which is what makes count and composition different things', () => {
    // rules-reference A3 item 3: the cap is 12 TOTAL, so a seventh Fund is worth
    // nothing. If conversion did not saturate, total count would decide everything and
    // this whole instrument would be a relabelled totals checker.
    //
    // The figures are hand-checkable against the shipped market, and being able to check
    // them is the point: the only Funds-only cards are `vo-core-001` ({funds:2}, 1 voter)
    // and `vo-core-004` ({funds:3}, 1 voter), and they cannot both be bought with 3 Funds.
    // So 3 Funds buys 1 voter, and no amount of Funds buys more than those 2 voters.
    expect(model.conversionValue([3, 0, 0, 0])).toBe(1);
    expect(model.conversionValue([2, 0, 0, 0])).toBe(1);
    expect(model.conversionValue([12, 0, 0, 0])).toBe(2);
    // 9 Funds and 12 Funds are worth the same: the cap saturates the pool.
    expect(model.conversionValue([9, 0, 0, 0])).toBe(model.conversionValue([12, 0, 0, 0]));
  });

  it('COMPOSITION gates what you can buy, because canAfford is componentwise', () => {
    // The mechanism, asserted directly on the economy rather than argued in a comment.
    // Same TOTAL, different composition, and a large difference in what each can buy:
    // this is the whole ruling in one line.
    const fundsOnly = model.conversionValue([9, 0, 0, 0]);
    const spread = model.conversionValue([3, 3, 3, 0]);
    expect(
      9,
      'the fixtures must hold the same TOTAL, or this proves nothing about composition',
    ).toBe(3 + 3 + 3);
    expect(spread, 'equal totals gave equal reach, so composition would not matter').toBeGreaterThan(
      fundsOnly * 2,
    );
  });

  it('lets the player make the p12 discard OPTIMALLY, so a rich player is not punished', () => {
    // p12 says the player CHOOSES what to discard. Taking `{funds: 4}` from `{funds: 9}`
    // overflows the cap by 1, and dumping the surplus Fund rather than a scarce Clout is
    // what makes the concentrated payout worth as much as it is.
    const capped = model.bestConversion([9, 0, 0, 0], { funds: 4 });
    expect(capped).toBe(model.bestConversion([8, 0, 0, 0], { funds: 4 }));
  });

  it('DEMONSTRATION: catches a card that TOTAL_SKEW cannot see, by construction', () => {
    // THE PROOF THE INSTRUMENT EARNS ITS PLACE. Equal totals, so `TOTAL_SKEW` is blind
    // by definition. Neither side dominates componentwise, so `PURE_UPGRADE` is silent.
    // Neither side buys more power unlocks, so `POWER_THRESHOLD_CLIFF` is silent. And
    // the composition check refuses it anyway.
    //
    // This is a REAL pair from the sweep, not a contrived one: of the 9 equal-total
    // payout pairs in the corpus's whole format space that are decided by their payout,
    // every one is a spread side beating a pile. `{clout:6}` opens only the Clout cards
    // in the market; `{funds:1, clout:2, media:1, trust:2}` opens all four.
    //
    // The Ideologues are chosen so `POWER_THRESHOLD_CLIFF` is ALSO silent, which is the
    // whole claim: three independent checks and only this one sees the card. A Capitalist
    // side pays 0 Funds so it crosses nothing on its own ladder, and an Idealist side
    // paying 2 Trust is below `RULES.level3`. (Put `{clout: 6}` on a *Supremo* instead and
    // D3 fires on it too — it crosses clout@3 and clout@5 — which is a fair reminder that
    // D3 is not the dead branch it looks like on the shipped deck.)
    const trap = card(
      { answer: 'A. Everything into the one resource that pays best.', ideologue: 'capitalist', pays: { clout: 6 } },
      { answer: 'B. Spread it, so every part of the market is open to me.', ideologue: 'idealist', pays: { funds: 1, clout: 2, media: 1, trust: 2 } },
    );
    expect(deltaTotal(trap.sides[0].pays), 'fixture must be equal-total').toBe(
      deltaTotal(trap.sides[1].pays),
    );
    expect(codes(analyseIdeologyCard(trap, 'test', model))).not.toContain('PURE_UPGRADE');
    expect(codes(analyseIdeologyCard(trap, 'test', model))).not.toContain('TOTAL_SKEW');
    expect(codes(analyseIdeologyCard(trap, 'test', model))).not.toContain('POWER_THRESHOLD_CLIFF');

    const d = measureDecisiveness(trap.id, trap.sides[0].pays, trap.sides[1].pays, model);
    expect(d.decidedByPayout, 'the spread side should never be the worse answer').toBe(true);
    expect(d.side0Wins, 'the piled side is the better answer somewhere - the relation is not one-sided').toBe(0);
    expect(d.side1Wins, 'the spread side should win a large share of positions').toBeGreaterThan(0);
    expect(d.side1Wins + d.ties, 'every position is a win for one side or a tie').toBe(d.positions);

    const finding = analyseIdeologyCard(trap, 'test', model).find(
      (f) => f.code === 'COMPOSITION_DOMINANT',
    );
    expect(finding, 'the checker did not catch the card it exists to catch').toBeDefined();
    expect(finding?.severity).toBe('error');
    expect(finding?.side, 'the WINNING side must be the one named').toBe(1);
    expect(finding?.message).toContain('Equal totals do NOT save a card from this');
  });

  it('DEMONSTRATION: a genuinely equal-total 2+1 card is CLEAN, and that is the proof', () => {
    // THE OTHER HALF OF THE PROOF OBLIGATION, and it is the one that settles ruling (a).
    // Every shipped card has this shape, and every one of them must pass: for some
    // reachable holding side A converts better, and for another side B does. If that
    // ever stops being true, equal totals would have stopped being sufficient for the
    // design and the ruling would need revisiting.
    const good = card(
      { answer: 'A. Funds and media.', ideologue: 'capitalist', pays: { funds: 2, media: 1 } },
      { answer: 'B. Trust and media.', ideologue: 'idealist', pays: { trust: 2, media: 1 } },
    );
    const d = measureDecisiveness(good.id, good.sides[0].pays, good.sides[1].pays, model);
    expect(d.decidedByPayout).toBe(false);
    expect(d.side0Wins, 'side A is never better - the dilemma would be decoration').toBeGreaterThan(0);
    expect(d.side1Wins, 'side B is never better - the dilemma would be decoration').toBeGreaterThan(0);
    expect(codes(analyseIdeologyCard(good, 'test', model))).not.toContain('COMPOSITION_DOMINANT');
  });

  it('is measuring CONVERSION, not a coincidence of the shipped market', () => {
    // If COMPOSITION_DOMINANT only fired against one particular market it would be a
    // lookup table. Against a market that spends ONLY funds, a side whose second resource
    // is worthless is strictly worse everywhere it matters — so the check follows the
    // ECONOMY, which is what makes it a measurement rather than a fact about 18 cards.
    const fundsOnlyMarket = buildConversionModel([
      { id: 'a', cost: { funds: 2 }, value: 1 },
      { id: 'b', cost: { funds: 3 }, value: 2 },
      { id: 'c', cost: { funds: 4 }, value: 3 },
    ]);
    const pair = card(
      { answer: 'A. Funds, which this market actually buys.', ideologue: 'capitalist', pays: { funds: 2, media: 1 } },
      { answer: 'B. Mostly media, which this market never buys.', ideologue: 'showstopper', pays: { funds: 1, media: 2 } },
    );
    const lean = measureDecisiveness(pair.id, pair.sides[0].pays, pair.sides[1].pays, fundsOnlyMarket);
    expect(lean.side0Wins, 'side A should be better at some holding').toBeGreaterThan(0);
    expect(lean.side1Wins, 'side B is never better against a Funds-only market').toBe(0);
    expect(lean.decidedByPayout).toBe(true);
    // And the SAME card against the shipped market, which does buy media, is clean. The
    // verdict follows the economy, not the card id — which is the only thing that makes
    // this a check rather than a table.
    const shipped = measureDecisiveness(
      pair.id,
      pair.sides[0].pays,
      pair.sides[1].pays,
      model,
    );
    expect(shipped.decidedByPayout, 'the verdict must follow the economy, not the card id').toBe(
      false,
    );
    expect(codes(analyseIdeologyCard(pair, 'test', model))).not.toContain('COMPOSITION_DOMINANT');
  });

  it('a card worth the same at EVERY position is allowed - that is a pure dilemma', () => {
    // NOT a finding, deliberately. Under ruling (a) a card whose two sides cost a player
    // the same purchasing power is the HEALTHY case: the dilemma decides and the numbers
    // stay out of it. Flagging this would push authors toward the exact skew the checker
    // just proved is usually an inversion.
    const pure = card(
      { answer: 'A. Two of this, one of that.', ideologue: 'capitalist', pays: { funds: 2, media: 1 } },
      { answer: 'B. The mirror image.', ideologue: 'idealist', pays: { media: 2, funds: 1 } },
    );
    const d = measureDecisiveness(pure.id, pure.sides[0].pays, pure.sides[1].pays, model);
    // Mirror-image 2+1 payouts are convertible to the same score, and must not be an error.
    expect(d.decidedByPayout).toBe(false);
    expect(codes(analyseIdeologyCard(pure, 'test', model))).not.toContain('COMPOSITION_DOMINANT');
  });

  it('the model is derived from the shipped market, not hardcoded', () => {
    // Both halves: the market options come from the Voter Cards, and the one power with
    // a mandatory exact resource is added explicitly rather than being forgotten.
    const market = loadVoterDeck('core');
    const options = voterMarketOptions(market);
    expect(options).toHaveLength(market.length);
    expect(options.map((o) => o.value)).toEqual(market.map((c) => c.voters));
    // p32 Tough Love: 2 Trust EXACTLY, worth its printed payoff.
    const tl = toughLoveOption();
    expect(tl.cost).toEqual({ trust: RULES.toughLoveTrust });
    expect(tl.value).toBe(RULES.toughLoveConverts);
    // And it is load-bearing rather than decorative: 2 Trust is worth its full payoff
    // (2 voters) where the market's own {trust: 2} card is worth 1, and a single Trust
    // is worth nothing at all — so Trust has an exact threshold the other pools do not.
    expect(model.conversionValue([0, 0, 0, 2])).toBe(RULES.toughLoveConverts);
    expect(model.conversionValue([0, 0, 0, 1])).toBe(0);
  });
});

describe('the shipped decks leave real choices — the positive proof', () => {
  const report = balanceCorpus({
    ideology: new Map([
      ['et2040', loadIdeologyDeck('et2040')],
      ['in2020', loadIdeologyDeck('in2020')],
    ]),
    voter: new Map([['core', loadVoterDeck('core')]]),
  });

  it('ZERO of the shipped cards are decided by their payout', () => {
    // THE NUMBER THE RULING RESTS ON, asserted over the corpus so it cannot rot. 76
    // cards, 76 with a strict win for EACH side somewhere across all 1820 reachable
    // holdings. This is what "equal totals are sufficient for the design" means when
    // you actually check it rather than assume it.
    for (const b of report.bias) {
      expect(
        b.composition.decidedByPayout,
        `${b.deck}: ${b.composition.decidedByPayout} card(s) are decided by payout alone`,
      ).toBe(0);
      expect(b.composition.realChoice).toBe(b.ideologyCards);
      expect(b.composition.positions).toBe(1820);
    }
    expect(report.errors.filter((f) => f.code === 'COMPOSITION_DOMINANT')).toEqual([]);
  });

  it('ties are common but the DISCRIMINATING positions are not the same side', () => {
    // The honest shape of the result, asserted as a range rather than as a slogan. Most
    // pools a player might hold cannot tell the two sides apart — 55.9% of (card,
    // position) pairs are ties — and that is realistic rather than alarming: you are
    // usually indifferent, and the card bites when your pool is lopsided.
    //
    // What must hold is the lower bound. If ties approached 100% the instrument would be
    // measuring nothing, and if they approached 0% the deck would be decided by holdings
    // alone. The deck sits comfortably inside, and 0 cards are universally decided.
    for (const b of report.bias) {
      expect(b.composition.tieShare, `${b.deck} tie share`).toBeGreaterThan(0.2);
      expect(b.composition.tieShare, `${b.deck} tie share`).toBeLessThan(0.8);
    }
  });

  it('the deck-level gate is armed but silent, because the deck is clean', () => {
    // The rollup exists for the case where cards are individually defensible and
    // collectively a solved deck. It must be WIRED (so it would fire) and must not be
    // firing now (so the corpus is not paying for it).
    expect(PAYOUT_DECIDED_SHARE_THRESHOLD).toBeGreaterThan(0);
    for (const b of report.bias) {
      expect(b.composition.decidedByPayoutShare).toBeLessThanOrEqual(
        PAYOUT_DECIDED_SHARE_THRESHOLD,
      );
    }
    expect(report.findings.filter((f) => f.code === 'PAYOUT_DECIDED_DECK')).toEqual([]);
  });

  it('every card is measured against the REAL market, never skipped', () => {
    // `balanceCorpus` derives the model from the voter map it was given. If that
    // derivation ever silently yielded `undefined`, every composition check would be
    // skipped and the deck would pass VACUOUSLY — which is the exact failure mode the
    // X-card magnitude check documents for scoring an unmeasurable card zero, and the
    // reason the empty case has to be pinned rather than assumed unreachable.
    const withMarket = balanceCorpus({
      ideology: new Map([['in2020', loadIdeologyDeck('in2020')]]),
      voter: new Map([['core', loadVoterDeck('core')]]),
    });
    const withoutMarket = balanceCorpus({
      ideology: new Map([['in2020', loadIdeologyDeck('in2020')]]),
      voter: new Map(),
    });
    expect(withMarket.bias[0]?.composition.positions).toBe(1820);
    expect(withMarket.bias[0]?.composition.realChoice).toBeGreaterThan(0);
    // With no market the block is honestly empty rather than fabricated.
    expect(withoutMarket.bias[0]?.composition.positions).toBe(0);
    expect(withoutMarket.bias[0]?.composition.realChoice).toBe(0);
  });

  it('the resource-blind heuristic is no longer a dead branch', () => {
    // It used to read TOTALS, so it returned `decisive: 0` on both decks and could
    // never produce a verdict. It is now scored on the real axis. The shipped decks are
    // clean, so `decisive` is legitimately 0 — but for the RIGHT reason now: no card has
    // a universally better side, so there is nothing to be biased toward.
    for (const b of report.bias) {
      expect(b.resourceBlind.decisive).toBe(0);
      expect(b.resourceBlind.verdict).toBe('undecidable');
    }
    // And it is armed: a deck containing one payout-decided card must register it.
    const trap = card(
      { answer: 'A. Everything into one pool.', ideologue: 'supremo', pays: { clout: 6 } },
      { answer: 'B. Spread wide.', ideologue: 'idealist', pays: { funds: 1, clout: 2, media: 1, trust: 2 } },
    );
    const armed = balanceCorpus({
      ideology: new Map([['probe', [trap]]]),
      voter: new Map([['core', loadVoterDeck('core')]]),
    });
    expect(armed.bias[0]?.resourceBlind.decisive).toBe(1);
    expect(armed.errors.map((f) => f.code)).toContain('COMPOSITION_DOMINANT');
  });
});

describe('the shipped decks', () => {
  const report = balanceCorpus({
    ideology: new Map([
      ['et2040', loadIdeologyDeck('et2040')],
      ['in2020', loadIdeologyDeck('in2020')],
    ]),
    voter: new Map([['core', loadVoterDeck('core')]]),
    x: new Map([
      ['et2040', [...loadConspiracyDeck('et2040'), ...loadHeadlineDeck('et2040')]],
      ['in2020', [...loadConspiracyDeck('in2020'), ...loadHeadlineDeck('in2020')]],
    ]),
  });

  it('has no dominance errors', () => {
    // PLAN.md 9 risk #2. If this ever fails, do NOT loosen the checker — fix the card.
    expect(report.errors.map((f) => `${f.code} ${f.cardId} ${f.message}`)).toEqual([]);
  });

  it('every warning is the checker saying NOT MEASURED, and the set is the computed set', () => {
    // WHAT CHANGED HERE, AND WHY IT IS NOT A LOOSENING.
    //
    // `xCardMagnitude` runs one card in isolation with no player state, so a card
    // whose value is computed FROM a player's own state at resolution has no value
    // to read. `balance.ts` reports that as `severity: 'warn'` with the code
    // `X_EFFECT_MAGNITUDE` and says so in the message, deliberately, because
    // scoring it 0 would make the dominance check pass for a reason that has
    // nothing to do with the card (KNOWN-GAPS 0b.1 item 7). IF YOU LIKE PINA
    // COLADA is the first shipped card in that position: a `per` multiplier of
    // `held-of-each-resource` IS "double your mat", and it is unmeasurable here.
    //
    // The old assertion was `warnings === []`, which can only be satisfied by not
    // shipping a card the engine performs correctly - i.e. by deleting a real
    // recovered card to keep a reporting channel empty. That is the same blindness
    // the rest of this file argues against, and `PLAN.md 9 risk #2` is about the
    // DOMINANCE checker, which is untouched: `has no dominance errors` above is
    // still `errors === []` and still says "do NOT loosen the checker - fix the
    // card".
    //
    // WHAT IS ASSERTED INSTEAD, and it is STRONGER on the thing the gate exists
    // for: every warning must be a NOT MEASURED one, and the set of warning card
    // ids must be exactly the set of shipped cards whose magnitude is `null`. Both
    // sides are DERIVED from the decks and from the checker's own function, so a
    // second unmeasurable card fails here, a card that becomes measurable fails
    // here, and any warning of any other kind - a dominance warning, a lean
    // warning, a resource-blind warning - fails here too. The old assertion would
    // have passed all three of those if only the offending card were removed.
    const warnings = report.warnings.map((f) => `${f.code} ${f.deck} ${f.message}`);
    for (const w of warnings) {
      expect(w, `a warning that is not the NOT MEASURED verdict: ${w}`).toContain(
        'is NOT MEASURED by this check',
      );
    }
    // THE THIRD DERIVATION, and the one that gives this gate its teeth. Deriving
    // both sides from `xCardMagnitude` alone would be a tautology: a SECOND
    // unmeasurable card would grow both sides together and pass. So the
    // unmeasurable set is also derived STRUCTURALLY, by walking the deck files and
    // asking which cards name a computed quantity at all -- a question about the
    // JSON, with no reference to the checker's opinion. All three routes must agree:
    // the structural set, the checker's own `null` verdicts, and the warnings.
    const withComputedValue = [
      ...loadConspiracyDeck('et2040'),
      ...loadHeadlineDeck('et2040'),
      ...loadConspiracyDeck('in2020'),
      ...loadHeadlineDeck('in2020'),
    ]
      .filter((c) =>
        c.effects.some(
          (e) =>
            typeof (e as { n?: unknown }).n === 'object' ||
            typeof (e as { per?: unknown }).per === 'object',
        ),
      )
      .map((c) => c.id)
      .sort();

    const unmeasurable = [...loadConspiracyDeck('et2040'), ...loadHeadlineDeck('et2040'), ...loadConspiracyDeck('in2020'), ...loadHeadlineDeck('in2020')]
      .filter((c) => xCardMagnitude(c, voterValue(loadVoterDeck('core'))) === null)
      .map((c) => c.id)
      .sort();

    expect(
      withComputedValue,
      'a card names a computed quantity but the checker measured it anyway',
    ).toEqual(unmeasurable);
    expect(
      unmeasurable,
      'the checker says NOT MEASURED about a card that names no computed quantity - ' +
        'its null verdict is about something other than a computed value',
    ).toEqual(report.warnings.map((f) => f.cardId).sort());
    expect(unmeasurable.length, 'a warning exists for no card the checker could not measure').toBe(
      warnings.length,
    );
  });

  it('checks every card that ships, and knows it without a hardcoded count', () => {
    // The claim this test exists to make is COVERAGE: an X-card is analysed, not
    // just an Ideology Card. Expressed as a hardcoded `8 + 12 + 12 + xCount`, the
    // claim rots the moment the corpus grows — it reported 80 cards checked while
    // the checker had actually looked at 118, which is the failure mode this form
    // invites: a stale number that looks like a passing gate.
    //
    // So it is derived from the decks the same way `balanceCorpus` derives it, plus
    // the assertion that the X-card class is non-empty, which is the part that would
    // actually rot.
    const shipped =
      DECK_IDS.flatMap((d) => loadIdeologyDeck(d)).length +
      DECK_IDS.flatMap((d) => loadVoterDeck(d)).length +
      DECK_IDS.flatMap((d) => loadConspiracyDeck(d)).length +
      DECK_IDS.flatMap((d) => loadHeadlineDeck(d)).length;
    expect(report.cardsChecked).toBe(shipped);

    // The coverage claim itself: Conspiracies and Headlines are in the report.
    const xCount =
      loadConspiracyDeck('et2040').length +
      loadHeadlineDeck('et2040').length +
      loadConspiracyDeck('in2020').length +
      loadHeadlineDeck('in2020').length;
    expect(xCount).toBeGreaterThan(0);
  });

  it('reports one bias row per deck', () => {
    expect(report.bias.map((b) => b.deck).sort()).toEqual(['et2040', 'in2020']);
    for (const b of report.bias) {
      expect(b.ideologyCards).toBeGreaterThan(0);
      const total = Object.values(b.ideologueSideRate).reduce((a, n) => a + n, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });
});
