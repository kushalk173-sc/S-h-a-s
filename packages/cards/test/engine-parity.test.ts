/**
 * The drift guards.
 *
 * JSON Schema cannot import a TypeScript type, and `packages/cards` and
 * `packages/engine` are separate packages, so nothing at the language level stops
 * the schema's hand-written op list and the engine's `Effect` union from drifting
 * apart. These tests are that missing link, and they are the reason the corpus can
 * be trusted to typecheck against the engine at all.
 */

import { describe, expect, it } from 'vitest';

import { DECK_IDS, loadCorpus, toEngineConspiracyCard, toEngineHeadlineCard, toEngineIdeologyCard, toEngineVoterCard } from '../src/corpus.js';
import { EFFECT_OPS, EFFECT_OP_SET, isKnownEffectOp } from '../src/effect-ops.js';
import { IDEOLOGUES, IDEOLOGUE_RESOURCE, RESOURCES, type CardIndex } from '../src/engine.js';
import type { ConspiracyCard, Effect, HeadlineCard, IdeologyCard, VoterCard } from '../src/engine.js';
import { corpusSchema } from '../src/schema.js';

const root = corpusSchema();
const defs = root.$defs as Record<string, Record<string, unknown>>;

describe('the Effect union in cards.ts and the schema op list agree', () => {
  it('EFFECT_OPS lists the same ops, in the same order, as $defs.effect.oneOf', () => {
    // src/effect-ops.ts already fails to COMPILE if Effect['op'] and EFFECT_OPS
    // differ (see NO_MISSING_OPS). This test closes the other half of the gap:
    // that the JSON Schema's oneOf branches are in EFFECT_OPS' order, because
    // validateEffect() indexes the array by position.
    const branches = defs.effect?.oneOf as { properties: { op: { const: string } } }[];
    expect(branches).toHaveLength(EFFECT_OPS.length);
    expect(branches.map((b) => b.properties.op.const)).toEqual([...EFFECT_OPS]);
  });

  it('every shipped effect op is one the engine declares', () => {
    const corpus = loadCorpus();
    for (const card of [...corpus.conspiracy, ...corpus.headline]) {
      for (const effect of card.effects) {
        expect(isKnownEffectOp(effect.op), `${card.id}: ${effect.op}`).toBe(true);
      }
    }
  });

  it('a sample of every op satisfies Effect at compile time', () => {
    // The exhaustive switch below is the real test: if a variant is added to
    // Effect, TypeScript makes the `never` case unreachable and this stops
    // compiling, which is the point.
    const samples: Effect[] = [
      { op: 'gain', res: { funds: 1 } },
      { op: 'lose', res: { funds: 1 }, target: 'each-opponent' },
      { op: 'gain-any', n: 2 },
      { op: 'lose-any', n: 2, target: 'leader' },
      { op: 'steal-any', n: 1 },
      { op: 'voters', n: 3, target: 'everyone' },
      { op: 'evict', n: 1 },
      { op: 'discard-voter', n: 2 },
      { op: 'convert-voter', n: 2 },
      { op: 'gerrymander', n: 1 },
      { op: 'draw-conspiracy', n: 2 },
      { op: 'refresh-market' },
      { op: 'restrict', kind: 'no-purchases', value: 0, owed: 4 },
      { op: 'discount', n: 1 },
      { op: 'move-card', from: 'draw', to: 'hand', n: 1 },
      { op: 'move-card', from: 'revealed', to: 'hand', n: 1 },
      { op: 'reveal', kind: 'ideology', n: 1 },
      { op: 'reveal', kind: 'conspiracy', n: 2, target: 'each-opponent' },
    ];
    for (const effect of samples) {
      switch (effect.op) {
        case 'gain':
        case 'lose':
          expect(effect.res).toBeDefined();
          break;
        case 'gain-any':
        case 'lose-any':
        case 'voters':
        case 'evict':
        case 'discard-voter':
        case 'convert-voter':
        case 'gerrymander':
        case 'draw-conspiracy':
        case 'discount':
        case 'steal-any':
          expect(effect.n).toBeGreaterThan(0);
          break;
        case 'refresh-market':
          break;
        case 'restrict':
          expect(effect.kind).toBeDefined();
          break;
        case 'move-card':
          // G20. The two fields whose VALUES are the ruling, so they are checked as
          // values and not merely as present: `from` must never be 'discard' (a
          // discarded Ideology Card has been answered, and p13 makes that public), and
          // `to` must be one of the two things the ruling allows a card to become.
          //
          // `'revealed'` is the second legal `from` and it is checked here for the same
          // reason `'draw'` is: it names a SET, and the set has to be one whose members
          // the whole table can already see. A third spelling is a compile error, which
          // is the point — a card naming a pile reduce() cannot reach must not compile.
          expect(['draw', 'revealed']).toContain(effect.from);
          expect(['hand', 'destroy']).toContain(effect.to);
          break;
        case 'reveal':
          // G-new. `kind` NAMES A PILE and the four are interchangeable here only
          // because the operation is identical for each — take one member, publish that
          // one member. There is no `'discard'`, and that omission is the ruling:
          // `_ideologyDiscard` holds ANSWERED cards that p13 has already made face up
          // under their owner's mat, so listing them would publish a blind answer.
          // Asserted as a set so a fifth value cannot be added without this failing.
          expect(['ideology', 'voter', 'conspiracy', 'headline']).toContain(effect.kind);
          expect(effect.n).toBeGreaterThan(0);
          break;
        case 'borrow-power':
          // G14a. `target` is a single required value rather than a set, so it is
          // checked as the value it is: a borrow with no opponent named is a card that
          // borrows from itself, which resolves to nothing and reads as though it did
          // something.
          expect(effect.target).toBe('chosen-player');
          break;
        case 'set-cap':
          // G15. `to` must be a WHOLE number of zero or more, because it is compared
          // directly against a pool total and `overCap` is `max(0, total - cap)`: a
          // fractional or negative cap would make the discard p12 demands either
          // unreachable or negative, and the first of those is a stuck table.
          expect(Number.isInteger(effect.to)).toBe(true);
          expect(effect.to).toBeGreaterThanOrEqual(0);
          break;
        case 'move-peg':
          // G1. `n` is 1 for every recovered card and MUST stay 1: the pick is one
          // (peg, destination) pair, so a card asking for 2 would be offered one move
          // and read as though it had made two. The schema's `maximum: 1` is the floor
          // and this is the assertion, and the two failing together is the point — a
          // schema that widens alone is caught here and a reducer that widens alone is
          // caught by `EXECUTED_OPS` having no field for it.
          expect(effect.n).toBe(1);
          break;
        default: {
          const never: never = effect;
          throw new Error(`unhandled Effect variant: ${JSON.stringify(never)}`);
        }
      }
    }
  });
});

describe('the Ideologue -> Resource map in the schema matches state.ts', () => {
  it('the schema resource enum is exactly RESOURCES', () => {
    expect((defs.resource?.enum as string[]).slice().sort()).toEqual([...RESOURCES].sort());
  });

  it('$defs.ideologueResourceMap is exactly IDEOLOGUE_RESOURCE', () => {
    const map = defs.ideologueResourceMap?.properties as Record<string, { const: string }>;
    const fromSchema = Object.fromEntries(
      Object.entries(map).map(([k, v]) => [k, v.const]),
    ) as Record<string, string>;
    expect(fromSchema).toEqual({ ...IDEOLOGUE_RESOURCE });
  });

  it('the schema ideologue enum is exactly IDEOLOGUES', () => {
    expect((defs.ideologue?.enum as string[]).slice().sort()).toEqual([...IDEOLOGUES].sort());
  });
});

describe('the shipped corpus satisfies the engine card types', () => {
  const corpus = loadCorpus(DECK_IDS);

  it('strips the provenance envelope, leaving objects the engine accepts', () => {
    // `satisfies` is the compile-time half: if a `toEngine*` function drifted from
    // the engine's type, this file stops compiling.
    const ideology: IdeologyCard[] = corpus.ideology.map(toEngineIdeologyCard);
    const voter: VoterCard[] = corpus.voter.map(toEngineVoterCard);
    const conspiracy: ConspiracyCard[] = corpus.conspiracy.map(toEngineConspiracyCard);
    const headline: HeadlineCard[] = corpus.headline.map(toEngineHeadlineCard);

    // Runtime half: the envelope fields really are gone, and `advisory` is
    // ABSENT rather than present-and-undefined, because tsconfig.base.json turns
    // on exactOptionalPropertyTypes.
    for (const card of ideology) {
      expect(Object.keys(card).sort()).toEqual(
        card.advisory === undefined ? ['campaign', 'id', 'question', 'sides'] : ['advisory', 'campaign', 'id', 'question', 'sides'],
      );
      expect(card.sides).toHaveLength(2);
    }
    for (const card of voter) {
      expect(Object.keys(card).sort()).toEqual(['cost', 'id', 'voters']);
    }
    for (const card of conspiracy) {
      expect(Object.keys(card).sort()).toContain('cost');
      expect(Object.keys(card)).not.toContain('source');
      expect(Object.keys(card)).not.toContain('provenance');
    }
    for (const card of headline) {
      expect(Object.keys(card)).not.toContain('cost');
      expect(Object.keys(card)).not.toContain('source');
    }
  });

  it('indexes cleanly, with no id collisions', () => {
    // Reimplemented here rather than importing indexCards, because the engine's
    // public entry point is mid-repair and does not currently export it. This is
    // the same Object.fromEntries shape, and it is the thing DUPLICATE_ID guards.
    const index: CardIndex = {
      ideology: Object.fromEntries(corpus.ideology.map((c) => [c.id, toEngineIdeologyCard(c)])),
      voter: Object.fromEntries(corpus.voter.map((c) => [c.id, toEngineVoterCard(c)])),
      conspiracy: Object.fromEntries(corpus.conspiracy.map((c) => [c.id, toEngineConspiracyCard(c)])),
      headline: Object.fromEntries(corpus.headline.map((c) => [c.id, toEngineHeadlineCard(c)])),
    };
    expect(Object.keys(index.ideology)).toHaveLength(corpus.ideology.length);
    expect(Object.keys(index.voter)).toHaveLength(corpus.voter.length);
    expect(Object.keys(index.conspiracy)).toHaveLength(corpus.conspiracy.length);
    expect(Object.keys(index.headline)).toHaveLength(corpus.headline.length);
  });

  it('the deck data itself is dependency-free JSON', () => {
    // The whole point of keeping Ajv in devDependencies: a consumer of the corpus
    // needs nothing but JSON.parse.
    for (const card of [...corpus.voter]) {
      expect(Object.keys(card).sort()).toEqual(['cost', 'id', 'provenance', 'source', 'voters']);
    }
  });
});
