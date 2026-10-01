import { describe, expect, it } from 'vitest';

import {
  BALANCE_TOLERANCE_TOTAL,
  CONSPIRACY_MIN_COST,
  IDEOLOGUE_SKEW_TOLERANCE,
  RESOURCE_BLIND_LEAN_THRESHOLD,
  X_EFFECT_MAGNITUDE_BUDGET,
  analyseIdeologyCard,
  balanceCorpus,
  deckBias,
  voterValue,
  xCardMagnitude,
  type BalanceFinding,
  type XCardLike,
} from '../src/balance.js';
import { RULES, type Effect } from '../src/engine.js';
import type { CorpusIdeologyCard, CorpusVoterCard } from '../src/corpus.js';
import { DECK_IDS, loadConspiracyDeck, loadHeadlineDeck, loadIdeologyDeck, loadVoterDeck } from '../src/corpus.js';

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
    // once the gap is stated honestly as 1, because 1 is exactly what the
    // tolerance band swallows and exactly what removes the decision.)
    expect(Math.abs(3 - 4)).toBe(BALANCE_TOLERANCE_TOTAL);
    const c = card(
      { answer: 'Yes. Divert the industrial supply for the tankers.', ideologue: 'idealist', pays: { funds: 1, trust: 2 } },
      { answer: 'No. Divert the industrial supply and keep the factories.', ideologue: 'capitalist', pays: { funds: 2, trust: 2 } },
    );
    expect(codes(analyseIdeologyCard(c, 'test'))).not.toContain('TOTAL_SKEW');
    const upgrade = analyseIdeologyCard(c, 'test').find((f) => f.code === 'PURE_UPGRADE');
    expect(upgrade).toBeDefined();
    expect(upgrade?.severity).toBe('error');
    expect(upgrade?.side).toBe(1);
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

describe('dominance: D2 TOTAL_SKEW and the tolerance band', () => {
  it(`tolerates a gap of exactly BALANCE_TOLERANCE_TOTAL (${BALANCE_TOLERANCE_TOTAL})`, () => {
    const c = card(
      { answer: 'Yes. Publish the whole file and let the room decide.', ideologue: 'showstopper', pays: { media: 3, trust: 1 } },
      { answer: 'No. Publish the summary and keep the file closed.', ideologue: 'capitalist', pays: { funds: 3, media: 1 } },
    );
    const findings = analyseIdeologyCard(c, 'test');
    expect(codes(findings)).toEqual([]);
  });

  it(`flags a gap of ${BALANCE_TOLERANCE_TOTAL + 1} as a warning, not an error`, () => {
    // 5 against 3. Not coordinatewise comparable in either direction, so D1 is
    // clear; the only finding is the tilt.
    const c = card(
      { answer: 'Yes. Publish the whole file and let the room decide.', ideologue: 'showstopper', pays: { media: 4, trust: 1 } },
      { answer: 'No. Publish the summary and keep the file closed.', ideologue: 'capitalist', pays: { funds: 3 } },
    );
    const skew = analyseIdeologyCard(c, 'test').find((f) => f.code === 'TOTAL_SKEW');
    expect(skew).toBeDefined();
    expect(skew?.severity).toBe('warn');
    expect(skew?.message).toContain('tolerance band is +/-1');
  });
});

describe('dominance: D3 POWER_THRESHOLD_CLIFF — overrides the band', () => {
  it(`catches a 1-resource gap across the level-${RULES.level3} unlock`, () => {
    // A difference of one resource, well inside the tolerance band, but 3 Trust
    // is the Idealist level-3 threshold (RULES p15): crossing it unlocks a power
    // that pays out every turn for the rest of the game. The other side crosses
    // nothing at all, so its crossing set is a strict subset.
    expect(Math.abs(3 - 2)).toBeLessThanOrEqual(BALANCE_TOLERANCE_TOTAL);
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
    // Totals 6 against 5: inside the band, so D2 stays silent too.
    expect(codes(findings)).not.toContain('TOTAL_SKEW');
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

  it('has no warnings either, so the corpus is reviewable in one pass', () => {
    expect(report.warnings.map((f) => `${f.code} ${f.deck} ${f.message}`)).toEqual([]);
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
