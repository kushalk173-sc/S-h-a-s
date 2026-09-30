import { describe, expect, it } from 'vitest';

import { RULES } from '../src/engine.js';
import { corpusSchema, validateDeckFile, validateEffect } from '../src/schema.js';
import { EFFECT_OP_SET } from '../src/effect-ops.js';
import { validateCorpus, validateDecks, type DeckInput } from '../src/validate.js';

const FILE = 'decks/fixture/fixture.json';

/** Wrap cards in a deck file. The kind is supplied per call, not baked in. */
function deckFile(campaign: string, cards: unknown[]): unknown {
  return { deck: 'fixture', campaign, cards };
}

/** A valid Ideology Card, for tests that then break one thing about it. */
function goodIdeologyCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ig-fixture-001',
    source: 'original; register per REF 8.2',
    provenance: 'inferred',
    campaign: 'Fixture',
    question: 'Should the archive be opened to anyone who asks?',
    sides: [
      {
        answer: 'Yes. An archive that answers to one family is a family album.',
        ideologue: 'idealist',
        pays: { trust: 2, funds: 1 },
      },
      {
        answer: 'No. Someone has to pay for the humidity control.',
        ideologue: 'capitalist',
        pays: { funds: 2, trust: 1 },
      },
    ],
    ...overrides,
  };
}

function problems(data: unknown, kind: Parameters<typeof validateDeckFile>[2]) {
  return validateDeckFile(FILE, data, kind);
}

describe('schema: the shipped corpus', () => {
  it('validates with no findings', () => {
    const report = validateCorpus();
    expect(report.errors.map((f) => `${f.code} ${f.cardId ?? ''} ${f.message}`)).toEqual([]);
  });

  it('ships every card type, with a full market', () => {
    const report = validateCorpus();
    for (const kind of ['ideology', 'voter', 'conspiracy', 'headline'] as const) {
      expect(report.counts[kind], `${kind} card count`).toBeGreaterThan(0);
    }
    expect(report.counts.voter).toBeGreaterThanOrEqual(RULES.marketSize);
    expect(report.counts.total).toBe(report.counts.ideology + report.counts.voter + report.counts.conspiracy + report.counts.headline);
  });

  it('carries a provenance tag and a source on every card', () => {
    const report = validateCorpus();
    expect(report.provenance.verbatim + report.provenance.adapted + report.provenance.inferred).toBe(
      report.counts.total,
    );
  });
});

describe('schema: malformed cards are rejected with a card id and a pointer', () => {
  it('rejects a card with no sides', () => {
    const card = goodIdeologyCard({ sides: undefined });
    const found = problems(deckFile('Fixture', [card]), 'ideology');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.cardId).toBe('ig-fixture-001');
    expect(found[0]?.pointer).toMatch(/^\/cards\/0/);
  });

  it('rejects three sides', () => {
    const base = goodIdeologyCard();
    const sides = [...(base.sides as unknown[]), { answer: 'Maybe.', ideologue: 'supremo', pays: { clout: 1 } }];
    const found = problems(deckFile('Fixture', [goodIdeologyCard({ sides })]), 'ideology');
    expect(found.some((p) => p.pointer === '/cards/0/sides' && p.keyword === 'maxItems')).toBe(true);
  });

  it('rejects an answer that does not open with Yes. or No.', () => {
    const base = goodIdeologyCard();
    const sides = JSON.parse(JSON.stringify(base.sides)) as Record<string, unknown>[];
    (sides[0] as { answer: string }).answer = 'Absolutely not. It would be cheaper to keep it shut.';
    const found = problems(deckFile('Fixture', [goodIdeologyCard({ sides })]), 'ideology');
    expect(found.some((p) => p.pointer === '/cards/0/sides/0/answer' && p.keyword === 'pattern')).toBe(true);
  });

  it('rejects a typo\'d payout key instead of silently paying nothing', () => {
    const base = goodIdeologyCard();
    const sides = JSON.parse(JSON.stringify(base.sides)) as Record<string, unknown>[];
    (sides[0] as { pays: unknown }).pays = { trust: 2, fudns: 1 };
    const found = problems(deckFile('Fixture', [goodIdeologyCard({ sides })]), 'ideology');
    expect(
      found.some((p) => p.pointer === '/cards/0/sides/0/pays' && p.message.includes('unknown property "fudns"')),
    ).toBe(true);
  });

  it('rejects a negative payout', () => {
    const base = goodIdeologyCard();
    const sides = JSON.parse(JSON.stringify(base.sides)) as Record<string, unknown>[];
    (sides[0] as { pays: unknown }).pays = { trust: 2, funds: -1 };
    const found = problems(deckFile('Fixture', [goodIdeologyCard({ sides })]), 'ideology');
    expect(found.some((p) => p.pointer === '/cards/0/sides/0/pays/funds' && p.keyword === 'minimum')).toBe(true);
  });

  it('rejects a side that does not state the resource its own Ideologue maps to', () => {
    // REF 5.2: a Capitalist answer may pay ZERO Funds, but it must say so. This is
    // the ideology -> resource cross-check, and the zero is legal.
    const missing = goodIdeologyCard({
      sides: [
        { answer: 'No. Ownership is the only argument that has survived a recession.', ideologue: 'capitalist', pays: { trust: 2 } },
        { answer: 'Yes. The argument was never about ownership at all.', ideologue: 'idealist', pays: { trust: 2, media: 1 } },
      ],
    });
    const found = problems(deckFile('Fixture', [missing]), 'ideology');
    expect(found.length).toBeGreaterThan(0);

    const explicitZero = goodIdeologyCard({
      sides: [
        { answer: 'No. It would be far more lucrative to expand our fishing territories.', ideologue: 'capitalist', pays: { funds: 0, trust: 2, media: 1 } },
        { answer: 'Yes. The strait was ours before it was theirs.', ideologue: 'supremo', pays: { clout: 2, media: 1 } },
      ],
    });
    // A Capitalist side paying 0 Funds is a real, shipped card (REF 5.2) and must
    // not be rejected. The other cross-checks (two different ideologues, all
    // shapes) still pass, so this must be schema-clean.
    expect(problems(deckFile('Fixture', [explicitZero]), 'ideology')).toEqual([]);
  });

  it('rejects two sides of the same Ideologue (RULES p13)', () => {
    const card = goodIdeologyCard({
      sides: [
        { answer: 'Yes. Give them the floor and they will build the walls themselves.', ideologue: 'idealist', pays: { trust: 2, funds: 1 } },
        { answer: 'No. Free is not a policy, it is a queue with a nicer name.', ideologue: 'idealist', pays: { funds: 1, media: 2 } },
      ],
    });
    const found = problems(deckFile('Fixture', [card]), 'ideology');
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects a card id that is not namespaced', () => {
    const found = problems(deckFile('Fixture', [goodIdeologyCard({ id: 'card-1' })]), 'ideology');
    expect(found.some((p) => p.pointer === '/cards/0/id' && p.keyword === 'pattern')).toBe(true);
  });

  it('rejects a Voter Card that pays 4 voters (RULES p10 says 1, 2 or 3)', () => {
    const card = {
      id: 'vo-fixture-001',
      source: 'original; register per REF 8.2',
      provenance: 'inferred',
      cost: { funds: 4 },
      voters: 4,
    };
    const found = problems(deckFile('Fixture', [card]), 'voter');
    expect(found.some((p) => p.pointer === '/cards/0/voters' && p.keyword === 'enum')).toBe(true);
  });

  it('rejects a Voter Card with an empty cost', () => {
    const card = { id: 'vo-fixture-001', source: 'original; register per REF 8.2', provenance: 'inferred', cost: {}, voters: 1 };
    const found = problems(deckFile('Fixture', [card]), 'voter');
    expect(found.some((p) => p.pointer === '/cards/0/cost' && p.keyword === 'minProperties')).toBe(true);
  });

  it('rejects a Conspiracy Card outside the printed 4-5 cost (RULES p19)', () => {
    const card = {
      id: 'ct-fixture-001',
      source: 'original; x',
      provenance: 'inferred',
      name: 'Something',
      text: 'A rules text long enough to clear the schema minimum length.',
      cost: 3,
      effects: [{ op: 'gain-any', n: 1 }],
    };
    const found = problems(deckFile('Fixture', [card]), 'conspiracy');
    expect(found.some((p) => p.pointer === '/cards/0/cost' && p.keyword === 'minimum')).toBe(true);
  });

  it('rejects a Headline Card that carries a cost (REF 5.5: headlines are free)', () => {
    const card = {
      id: 'hl-fixture-001',
      source: 'original; x',
      provenance: 'inferred',
      name: 'Something',
      text: 'A rules text long enough to clear the schema minimum length.',
      cost: 4,
      effects: [{ op: 'gain-any', n: 1 }],
    };
    const found = problems(deckFile('Fixture', [card]), 'headline');
    expect(found.some((p) => p.message.includes('unknown property "cost"'))).toBe(true);
  });

  it('rejects an unknown provenance tag', () => {
    const found = problems(deckFile('Fixture', [goodIdeologyCard({ provenance: 'probably-fine' })]), 'ideology');
    expect(found.some((p) => p.pointer === '/cards/0/provenance' && p.keyword === 'enum')).toBe(true);
  });
});

describe('schema: the effect union', () => {
  it('rejects an op that is not in the Effect union, and names the valid set', () => {
    const found = validateEffect(FILE, { op: 'hostage', n: 4 }, EFFECT_OP_SET);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('is not one of:');
    expect(found[0]?.message).toContain('steal-any');
  });

  it('rejects a payload field the op does not have (gerrymander has no target)', () => {
    // Caught in the real corpus: `gerrymander` is the one resource-shaped op in
    // cards.ts with no `target`. See KNOWN-GAPS.md G8.
    const found = validateEffect(FILE, { op: 'gerrymander', n: 1, target: 'everyone' }, EFFECT_OP_SET);
    expect(found.some((p) => p.message.includes('unknown property "target"'))).toBe(true);
  });

  it('rejects an n of zero, which would be a silent no-op', () => {
    const found = validateEffect(FILE, { op: 'voters', n: 0 }, EFFECT_OP_SET);
    expect(found.some((p) => p.pointer === '/n' && p.keyword === 'minimum')).toBe(true);
  });

  it('rejects a gain with an empty resource delta', () => {
    const found = validateEffect(FILE, { op: 'gain', res: {} }, EFFECT_OP_SET);
    expect(found.length).toBeGreaterThan(0);
  });

  it('accepts every op the engine declares', () => {
    const samples: Record<string, unknown> = {
      gain: { op: 'gain', res: { funds: 1 } },
      lose: { op: 'lose', res: { funds: 1 }, target: 'each-opponent' },
      'gain-any': { op: 'gain-any', n: 2 },
      'lose-any': { op: 'lose-any', n: 2, target: 'leader' },
      'steal-any': { op: 'steal-any', n: 1 },
      voters: { op: 'voters', n: 3, target: 'everyone' },
      evict: { op: 'evict', n: 1 },
      'discard-voter': { op: 'discard-voter', n: 2 },
      'convert-voter': { op: 'convert-voter', n: 2 },
      gerrymander: { op: 'gerrymander', n: 1 },
      'draw-conspiracy': { op: 'draw-conspiracy', n: 2 },
      'refresh-market': { op: 'refresh-market' },
      discount: { op: 'discount', n: 1 },
    };
    for (const op of EFFECT_OP_SET) {
      expect(validateEffect(FILE, samples[op], EFFECT_OP_SET), op).toEqual([]);
    }
  });
});

describe('structural cross-checks the schema cannot express', () => {
  const minimalCorpus = (): DeckInput[] => [
    {
      deck: 'fixture',
      kind: 'ideology',
      file: FILE,
      data: deckFile('Fixture', [goodIdeologyCard()]),
    },
    {
      deck: 'fixture',
      kind: 'voter',
      file: FILE,
      data: deckFile('Fixture', [
        { id: 'vo-fixture-001', source: 'original; register per REF 8.2', provenance: 'inferred', cost: { funds: 2 }, voters: 1 },
        { id: 'vo-fixture-002', source: 'original; register per REF 8.2', provenance: 'inferred', cost: { funds: 3 }, voters: 2 },
        { id: 'vo-fixture-003', source: 'original; register per REF 8.2', provenance: 'inferred', cost: { funds: 4 }, voters: 3 },
      ]),
    },
    {
      deck: 'fixture',
      kind: 'conspiracy',
      file: FILE,
      data: deckFile('Fixture', [
        {
          id: 'ct-fixture-001',
          source: 'original; register per REF 8.2',
          provenance: 'inferred',
          name: 'Annex',
          text: 'A rules text long enough to clear the schema minimum length.',
          cost: 4,
          effects: [{ op: 'gain-any', n: 1 }],
        },
      ]),
    },
    {
      deck: 'fixture',
      kind: 'headline',
      file: FILE,
      data: deckFile('Fixture', [
        {
          id: 'hl-fixture-001',
          source: 'original; register per REF 8.2',
          provenance: 'inferred',
          name: 'Ceiling',
          text: 'A rules text long enough to clear the schema minimum length.',
          effects: [{ op: 'voters', n: 1 }],
        },
      ]),
    },
  ];

  it('passes a well-formed minimal corpus', () => {
    const report = validateDecks(minimalCorpus());
    expect(report.errors).toEqual([]);
  });

  it('flags a duplicate id, which indexCards would silently swallow', () => {
    const inputs = minimalCorpus();
    inputs.push({
      deck: 'other',
      kind: 'ideology',
      file: 'decks/other/ideology.json',
      data: deckFile('Fixture', [goodIdeologyCard()]),
    });
    const report = validateDecks(inputs);
    const dup = report.errors.find((f) => f.code === 'DUPLICATE_ID');
    expect(dup).toBeDefined();
    expect(dup?.message).toContain('indexCards would silently drop one of them');
  });

  it('flags a missing card type', () => {
    const report = validateDecks(minimalCorpus().filter((i) => i.kind !== 'headline'));
    expect(report.errors.some((f) => f.code === 'TYPE_MISSING' && f.message.includes('headline'))).toBe(true);
  });

  it(`flags a market that cannot be filled to RULES.marketSize (${RULES.marketSize})`, () => {
    const inputs = minimalCorpus();
    const voter = inputs.find((i) => i.kind === 'voter');
    const cards = (voter?.data as { cards: unknown[] }).cards;
    voter!.data = deckFile('Fixture', cards.slice(0, 2));
    const report = validateDecks(inputs);
    const finding = report.errors.find((f) => f.code === 'MARKET_FILL');
    expect(finding).toBeDefined();
    expect(finding?.message).toContain(String(RULES.marketSize));
  });

  it('flags a missing Voter Card size', () => {
    const inputs = minimalCorpus();
    const voter = inputs.find((i) => i.kind === 'voter');
    const cards = (voter?.data as { cards: Record<string, unknown>[] }).cards.map((c) => ({ ...c, voters: 2 }));
    voter!.data = deckFile('Fixture', cards);
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'MARKET_VALUE_COVERAGE')).toBe(true);
  });

  it('flags a card whose id prefix does not match its file kind', () => {
    const inputs = minimalCorpus();
    const headline = inputs.find((i) => i.kind === 'headline');
    const cards = (headline?.data as { cards: Record<string, unknown>[] }).cards;
    headline!.data = deckFile('Fixture', [{ ...cards[0], id: 'ct-fixture-001' }]);
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'ID_KIND_PREFIX')).toBe(true);
  });

  it('flags a card whose id deck segment does not match the directory', () => {
    const inputs = minimalCorpus();
    const conspiracy = inputs.find((i) => i.kind === 'conspiracy');
    const cards = (conspiracy?.data as { cards: Record<string, unknown>[] }).cards;
    conspiracy!.data = deckFile('Fixture', [{ ...cards[0], id: 'ct-elsewhere-001' }]);
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'ID_DECK_SEGMENT')).toBe(true);
  });

  it('flags a duplicate question (ARCHITECTURE 6.3 check 9)', () => {
    const inputs = minimalCorpus();
    inputs.push({
      deck: 'other',
      kind: 'ideology',
      file: 'decks/other/ideology.json',
      data: deckFile('Fixture', [goodIdeologyCard({ id: 'ig-other-001' })]),
    });
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'QUESTION_DUPLICATE')).toBe(true);
  });

  it('flags a card campaign that disagrees with its deck file', () => {
    const inputs = minimalCorpus();
    const ideology = inputs.find((i) => i.kind === 'ideology');
    ideology!.data = deckFile('Fixture', [goodIdeologyCard({ campaign: 'Somewhere Else' })]);
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'CAMPAIGN_MISMATCH')).toBe(true);
  });

  it('refuses an uncited adapted card', () => {
    const inputs = minimalCorpus();
    const ideology = inputs.find((i) => i.kind === 'ideology');
    ideology!.data = deckFile('Fixture', [goodIdeologyCard({ provenance: 'adapted', source: 'trust me' })]);
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'SOURCE_NOT_CITED')).toBe(true);
  });

  it('refuses an inferred card that does not declare itself original', () => {
    const inputs = minimalCorpus();
    const ideology = inputs.find((i) => i.kind === 'ideology');
    ideology!.data = deckFile('Fixture', [goodIdeologyCard({ source: 'scribd 515528021' })]);
    const report = validateDecks(inputs);
    expect(report.errors.some((f) => f.code === 'SOURCE_NOT_CITED')).toBe(true);
  });
});

describe('the schema document itself', () => {
  it('is a draft 2020-12 schema with an $id', () => {
    const schema = corpusSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(typeof schema.$id).toBe('string');
  });
});
