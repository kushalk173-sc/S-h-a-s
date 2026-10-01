/**
 * THE HONESTY TEST: no shipped card may describe behaviour `reduce()` does not
 * perform.
 *
 * Three layers, each of which fails loudly rather than silently:
 *
 *  1. `EXECUTED_OPS` in `src/executable.ts` is re-derived here by reading
 *     `packages/engine/src/reduce.ts` and pulling the `case '…':` arms out of
 *     `applyEffect`. If the reducer grows or loses an op, this test fails before
 *     any card can use the difference.
 *  2. The same source is used to check the FIELD list per op — `target` is read in
 *     five cases and ignored in the other eight, which is invisible from the type
 *     and is exactly how a card ends up reading as if it did something to every
 *     player while doing it to one.
 *  3. The shipped corpus is walked. Every effect on every Conspiracy and Headline
 *     Card must be fully executable. This is the layer the brief asks for, and it
 *     runs over the real deck files, not over a fixture.
 *
 * Layer 3 is duplicated, deliberately, by `validateCorpus()` — which runs in
 * `npm run validate`. A card that slips in fails the test suite AND the CI gate,
 * and neither failure can be satisfied by editing the check itself: the registry
 * is compared against the reducer's own source text.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DECK_IDS, loadCorpus } from '../src/corpus.js';
import { EFFECT_OPS, EFFECT_OP_SET } from '../src/effect-ops.js';
import {
  EXECUTED_OPS,
  unexecutedCardProblems,
  unexecutedEffectProblems,
} from '../src/executable.js';
import { validateEffect, validateDeckFile, type SchemaProblem } from '../src/schema.js';
import { validateCorpus, validateDecks, shippedDeckInputs, type DeckInput } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REDUCE_SRC = resolve(HERE, '..', '..', 'engine', 'src', 'reduce.ts');
const FILE = 'decks/fixture/fixture.json';

/**
 * The `case` arms of `applyEffect`, keyed by op.
 *
 * Deliberately a text read rather than an import: `reduce()` is not a pure
 * function of a card, and the point of this file is to check the ENGINE SOURCE, so
 * the engine source is what it looks at. A missing arm and an added arm both show
 * up as a diff against `EXECUTED_OPS`.
 */
function reducerCaseBodies(): Record<string, string> {
  const src = readFileSync(REDUCE_SRC, 'utf8');
  const start = src.indexOf('function applyEffect');
  expect(start, 'reduce.ts still has applyEffect').toBeGreaterThan(-1);
  const end = src.indexOf('function applyEffects', start);
  const body = src.slice(start, end === -1 ? undefined : end);

  const out: Record<string, string> = {};
  const re = /^ {4}case '([^']+)':/gm;
  const marks: { op: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) marks.push({ op: m[1], at: m.index });
  }
  marks.forEach((mark, i) => {
    const next = marks[i + 1];
    out[mark.op] = body.slice(mark.at, next ? next.at : body.length);
  });
  return out;
}

const CASES = reducerCaseBodies();

// ─────────────────────────── layer 1: the op set ───────────────────────────

describe('EXECUTED_OPS is exactly what reduce() has a case for', () => {
  it('every declared op has a case, and every case has a declared op', () => {
    expect(Object.keys(EXECUTED_OPS).slice().sort()).toEqual(Object.keys(CASES).sort());
  });

  it('and it is the same op list as Effect and as the schema', () => {
    expect(Object.keys(EXECUTED_OPS).slice().sort()).toEqual([...EFFECT_OPS].slice().sort());
  });

  it('reduces the corpus to the same set (a card cannot use an op outside it)', () => {
    const corpus = loadCorpus(DECK_IDS);
    const used = new Set<string>();
    for (const card of [...corpus.conspiracy, ...corpus.headline]) {
      for (const effect of card.effects) used.add(effect.op);
    }
    for (const op of used) {
      expect(EXECUTED_OPS[op as keyof typeof EXECUTED_OPS], op).toBeDefined();
    }
  });
});

// ─────────────────────────── layer 2: the field set ───────────────────────────

describe('EXECUTED_OPS says which fields each case reads, and that is true', () => {
  it('`target` is read exactly where the registry claims it is', () => {
    const readsTarget = Object.entries(EXECUTED_OPS)
      .filter(([, reads]) => reads.includes('target'))
      .map(([op]) => op)
      .sort();
    const sourceMentionsTarget = Object.entries(CASES)
      .filter(([, body]) => /\btarget\b/.test(body))
      .map(([op]) => op)
      .sort();
    expect(sourceMentionsTarget).toEqual(readsTarget);
  });

  it('`n` is read exactly where the registry claims it is', () => {
    for (const [op, body] of Object.entries(CASES)) {
      const readsN = (EXECUTED_OPS as Record<string, readonly string[]>)[op]?.includes('n') ?? false;
      expect(/\beffect\.n\b/.test(body), `${op} reads effect.n`).toBe(readsN);
    }
  });

  it('`res` is read exactly where the registry claims it is', () => {
    for (const [op, body] of Object.entries(CASES)) {
      const readsRes = (EXECUTED_OPS as Record<string, readonly string[]>)[op]?.includes('res') ?? false;
      expect(/\beffect\.res\b/.test(body), `${op} reads effect.res`).toBe(readsRes);
    }
  });
});

// ─────────────────────────── layer 3: the corpus ───────────────────────────

describe('no shipped card uses an effect the reducer cannot execute', () => {
  const corpus = loadCorpus(DECK_IDS);

  it('every Conspiracy and Headline Card is fully executable', () => {
    const offenders: string[] = [];
    for (const card of [...corpus.conspiracy, ...corpus.headline]) {
      const problems = unexecutedCardProblems(card, '');
      for (const p of problems) offenders.push(`${card.id} ${p.pointer}: ${p.message}`);
    }
    expect(offenders).toEqual([]);
  });

  it('and no card carries a reserved duration / timing / interrupt', () => {
    for (const card of [...corpus.conspiracy, ...corpus.headline]) {
      expect(card.duration ?? 'this-turn', `${card.id} duration`).toBe('this-turn');
      expect('timing' in card, `${card.id} timing`).toBe(false);
      expect('interrupt' in card, `${card.id} interrupt`).toBe(false);
    }
  });

  it('the CI gate agrees with the test', () => {
    // Same corpus, different entry point. If these two ever disagree, the one that
    // matters is the stricter — so make both fail rather than choosing.
    expect(
      validateCorpus().errors.map((f) => `${f.code} ${f.cardId ?? ''} ${f.message}`),
    ).toEqual([]);
  });
});

// ─────────────────────────── the new shapes, accepted and rejected ───────────────────────────

/**
 * Validate the shipped decks with one Headline Card replaced.
 *
 * Reuses a real card so that everything except the field under test is already
 * known-good, which keeps each assertion about exactly one thing.
 */
function validateWithHeadline(headline: Record<string, unknown>) {
  const inputs: DeckInput[] = [...shippedDeckInputs()];
  const index = inputs.findIndex((i) => i.kind === 'headline' && i.deck === 'et2040');
  if (index < 0) throw new Error('no et2040 headline deck file');
  const original = inputs[index]!.data as { cards: Record<string, unknown>[] };
  inputs[index]!.data = { ...original, cards: [headline] };
  return validateDecks(inputs);
}

function baseHeadline(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'hl-et2040-001',
    source: 'original; register per REF 8.2',
    provenance: 'inferred',
    name: 'A Fixture Headline',
    text: 'A rules text long enough to clear the schema minimum length.',
    effects: [{ op: 'voters', n: 1 }],
    ...overrides,
  };
}

/** Findings for one effect, with the card otherwise valid. */
function findingsForEffect(effect: Record<string, unknown>) {
  return validateWithHeadline(baseHeadline({ effects: [effect] }));
}

function codes(report: { errors: readonly { code: string }[] }): string[] {
  return report.errors.map((e) => e.code);
}

describe('G8 — target on gerrymander, closed on the reducer', () => {
  it('the case now honours every EffectTarget, so no value is special-cased', () => {
    for (const target of ['you', 'each-opponent', 'everyone', 'leader'] as const) {
      expect(codes(findingsForEffect({ op: 'gerrymander', n: 1, target })), target).toEqual([]);
    }
    // …and with no `target` at all, which is the same as 'you'.
    expect(codes(findingsForEffect({ op: 'gerrymander', n: 1 }))).toEqual([]);
  });

  it('so the registry keeps no "executable only when" escape for this op', () => {
    // The mechanism survives as an empty table on purpose: an op whose case honours
    // `target` at exactly one value would be listed here, and the validator would
    // refuse the rest. Nothing is listed, because nothing is special-cased.
    expect(unexecutedEffectProblems({ op: 'gerrymander', n: 1, target: 'everyone' }, '')).toEqual([]);
    expect(unexecutedEffectProblems({ op: 'gerrymander', n: 1, target: 'leader' }, '')).toEqual([]);
  });
});

describe('a field the reducer ignores is rejected however it is spelled', () => {
  it('every op that reads `target` accepts every EffectTarget', () => {
    // The six ops below used to be the registry's whole list of "field the type
    // carries and the reducer ignores". Each now loops resolveTargets, so a card
    // naming a target is held to it.
    for (const op of ['steal-any', 'evict', 'discard-voter', 'convert-voter', 'draw-conspiracy', 'discount'] as const) {
      for (const target of ['you', 'each-opponent', 'everyone', 'leader'] as const) {
        expect(
          codes(findingsForEffect({ op, n: 1, target })),
          `${op} target ${target}`,
        ).toEqual([]);
      }
    }
  });

  it('rejects a computed n, which reduce() would push into a Choice.count', () => {
    expect(validateEffect(FILE, { op: 'gain-any', n: { of: 'your-pool' } }, EFFECT_OP_SET)).toEqual([]);
    const report = findingsForEffect({ op: 'gain-any', n: { of: 'your-pool' } });
    expect(codes(report)).toEqual(['EFFECT_FIELD_NOT_EXECUTED']);
    expect(report.errors[0]?.message).toContain('KNOWN-GAPS G15');
  });

  it('rejects a malformed effect twice over: shape AND executability', () => {
    // `when` on a card that also has a nonsense n. Both problems must be reported;
    // neither is a duplicate of the other.
    const report = findingsForEffect({ op: 'gain-any', n: 1, when: 'on-purchase' });
    expect(codes(report)).toEqual(['EFFECT_FIELD_NOT_EXECUTED']);
    expect(report.errors[0]?.message).toContain('KNOWN-GAPS G14');
  });

  it('rejects `when` and `until` on any op, and says which gap is waiting', () => {
    expect(validateEffect(FILE, { op: 'voters', n: 1, until: 'round' }, EFFECT_OP_SET)).toEqual([]);
    const until = findingsForEffect({ op: 'voters', n: 1, until: 'round' });
    expect(codes(until)).toEqual(['EFFECT_FIELD_NOT_EXECUTED']);
    expect(until.errors[0]?.message).toContain('KNOWN-GAPS G9');
  });

  it('rejects an op with no case at all, rather than letting it reach reduce()', () => {
    // `applyEffect`'s switch has no `default`, so an unknown op resolves to
    // undefined and the NEXT reduce() call throws. Unreachable through the schema
    // (EFFECT_OP_UNKNOWN catches it first) and through validateDecks; reachable by
    // anyone hand-building a CardIndex, which is what this asserts.
    const problems = unexecutedEffectProblems({ op: 'hostage', n: 4 }, '/effects/0');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('EFFECT_NOT_EXECUTED');
    expect(problems[0]?.message).toContain('undefined');
  });
});

describe('G9 / G22 — duration and timing', () => {
  it("accepts duration: 'this-turn', because that is what the engine already does", () => {
    const report = validateWithHeadline(baseHeadline({ duration: 'this-turn' }));
    expect(codes(report)).toEqual([]);
  });

  it('rejects every lasting duration, with the state change it needs', () => {
    for (const duration of ['round', 'next-turn', 'rest-of-game']) {
      const report = validateWithHeadline(baseHeadline({ duration }));
      expect(codes(report), duration).toEqual(['EFFECT_NOT_EXECUTED']);
      expect(report.errors[0]?.message, duration).toContain('never expire');
      expect(report.errors[0]?.message, duration).toContain('advanceTurn()');
    }
  });

  it('rejects timing, even with a harmless-looking value', () => {
    const report = validateWithHeadline(baseHeadline({ timing: 'next-turn' }));
    expect(codes(report)).toEqual(['EFFECT_NOT_EXECUTED']);
    expect(report.errors[0]?.message).toContain('no clock on an effect');
  });
});

describe('G13 — the phase-changing ops are not effects', () => {
  it('rejects an interrupt, and explains that it is not an Effect at all', () => {
    for (const op of ['block', 'deflect', 'auction', 'vote', 'pass-card'] as const) {
      const report = validateWithHeadline(baseHeadline({ interrupt: { op, window: 'out-of-turn' } }));
      expect(codes(report), op).toEqual(['EFFECT_NOT_EXECUTED']);
      expect(report.errors[0]?.message, op).toContain('change of phase');
    }
  });

  it('the shape is schema-valid, so the error the author sees is the engine one', () => {
    // If this ever fails, the author gets "unknown property interrupt" from four
    // card branches at once instead of the explanation above.
    expect(
      schemaProblems({
        ...baseHeadline({}),
        interrupt: { op: 'block', window: 'out-of-turn', target: 'any-card' },
      }),
    ).toEqual([]);
  });
});

describe('the reserved shapes are still shapes', () => {
  it('the JSON Schema accepts duration, timing, interrupt, when, until and a computed n', () => {
    // Asserted as SCHEMA acceptance, not as validator acceptance: the whole point
    // of modelling them is that the author is told what the ENGINE cannot do.
    expect(
      schemaProblems({
        ...baseHeadline({}),
        duration: 'rest-of-game',
        timing: 'next-turn',
        interrupt: { op: 'vote', window: 'always' },
        effects: [{ op: 'voters', n: { of: 'your-pool' }, when: 'on-purchase', until: 'round' }],
      }),
    ).toEqual([]);
  });

  it('and the validator rejects every one of them', () => {
    const report = validateWithHeadline(
      baseHeadline({
        duration: 'rest-of-game',
        timing: 'next-turn',
        interrupt: { op: 'vote', window: 'always' },
        effects: [{ op: 'voters', n: 1, when: 'on-purchase', until: 'round' }],
      }),
    );
    expect(codes(report).slice().sort()).toEqual([
      'EFFECT_FIELD_NOT_EXECUTED',
      'EFFECT_FIELD_NOT_EXECUTED',
      'EFFECT_NOT_EXECUTED',
      'EFFECT_NOT_EXECUTED',
      'EFFECT_NOT_EXECUTED',
    ]);
  });
});

/** The schema alone, with no validator pass on top. */
function schemaProblems(card: Record<string, unknown>): readonly SchemaProblem[] {
  return validateDeckFile(FILE, { deck: 'et2040', campaign: 'Earth 2040', cards: [card] }, 'headline');
}