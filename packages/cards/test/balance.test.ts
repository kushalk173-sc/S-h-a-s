import { describe, expect, it } from 'vitest';

import {
  BALANCE_TOLERANCE_TOTAL,
  IDEOLOGUE_SKEW_TOLERANCE,
  RESOURCE_BLIND_LEAN_THRESHOLD,
  analyseIdeologyCard,
  balanceCorpus,
  deckBias,
  type BalanceFinding,
} from '../src/balance.js';
import { RULES } from '../src/engine.js';
import type { CorpusIdeologyCard, CorpusVoterCard } from '../src/corpus.js';
import { loadIdeologyDeck, loadVoterDeck } from '../src/corpus.js';

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

describe('the shipped decks', () => {
  const report = balanceCorpus({
    ideology: new Map([
      ['et2040', loadIdeologyDeck('et2040')],
      ['in2020', loadIdeologyDeck('in2020')],
    ]),
    voter: new Map([['core', loadVoterDeck('core')]]),
  });

  it('has no dominance errors', () => {
    // PLAN.md 9 risk #2. If this ever fails, do NOT loosen the checker — fix the card.
    expect(report.errors.map((f) => `${f.code} ${f.cardId} ${f.message}`)).toEqual([]);
  });

  it('has no warnings either, so the corpus is reviewable in one pass', () => {
    expect(report.warnings.map((f) => `${f.code} ${f.deck} ${f.message}`)).toEqual([]);
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
