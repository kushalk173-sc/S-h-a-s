/**
 * §3.7 DETERMINISTIC RNG AND REPLAY — rng.ts, and the property that a game is
 * reproducible from its seed and its action log.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { reduce, type Ctx } from '../src/reduce';
import { nextSeed, random, shuffle } from '../src/rng';
import type { GameState } from '../src/state';
import { fresh, makeCtx } from './helpers';

const ctx: Ctx = makeCtx();
const SRC = join(__dirname, '..', 'src');

describe('nextSeed', () => {
  it('is a pure 32-bit LCG step that never leaves int32 range', () => {
    let s = 12345;
    for (let i = 0; i < 10_000; i++) {
      s = nextSeed(s);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(s).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });
});

describe('random', () => {
  it('is deterministic for a given seed and lies in [0,1)', () => {
    expect(random(42)).toBe(random(42));
    for (let i = 0; i < 10_000; i++) {
      const v = random(i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('never returns exactly 1', () => {
    // `random` divides by 2**32 after `>>> 0`, so the largest possible value is
    // 1 - 2**-32. This pins it: an off-by-one in the divisor would make 1.0
    // reachable and every Fisher-Yates index could read `out[i]` as itself.
    let max = 0;
    for (let i = 0; i < 100_000; i++) max = Math.max(max, random(i));
    expect(max).toBeLessThan(1);
  });
});

describe('shuffle', () => {
  const items = Array.from({ length: 129 }, (_, i) => i);

  it('is a permutation: no element lost or duplicated', () => {
    const [out] = shuffle(items, 7);
    expect([...out].sort((a, b) => a - b)).toEqual([...items].sort((a, b) => a - b));
    expect(new Set(out).size).toBe(129);
  });

  it('with the same seed yields the same order, and different seeds differ', () => {
    // The second half guards a seed-ignoring refactor, which a same-seed-only
    // test would happily accept.
    expect(shuffle(items, 7)[0]).toEqual(shuffle(items, 7)[0]);
    expect(shuffle(items, 7)[0]).not.toEqual(shuffle(items, 8)[0]);
  });

  it('does not mutate its input', () => {
    const before = [...items];
    shuffle(items, 99);
    expect(items).toEqual(before);
  });

  it('handles the degenerate inputs without throwing', () => {
    expect(shuffle([], 1)[0]).toEqual([]);
    expect(shuffle(['a'], 1)[0]).toEqual(['a']);
  });
});

describe('the engine never calls Math.random and never reads a clock', () => {
  it('has zero non-comment call sites across src/', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    const offenders: string[] = [];
    for (const f of files) {
      const raw = readFileSync(join(SRC, f), 'utf8');
      // Strip block and line comments first: the file headers *say* "the engine
      // never calls Math.random", and a naive substring search flags its own
      // documentation.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const pat of [/Math\s*\.\s*random\s*\(/, /Date\s*\.\s*now\s*\(/, /new\s+Date\s*\(/]) {
        if (pat.test(code)) offenders.push(`${f}: ${pat}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('deck drawing', () => {
  it('drawing past the end of a pile reshuffles the discard and advances the seed', () => {
    // Reached through a turn advance: `advanceTurn` draws the next player's
    // Ideology Card, and with an empty draw pile and a full discard `draw` must
    // reshuffle the discard and hand back a card from it.
    const base = fresh(1);
    const s: GameState = {
      ...base,
      phase: 'actions',
      _pendingCard: null,
      _ideologyDraw: [],
      _ideologyDiscard: ['ide-07', 'ide-03'],
    };
    const r = reduce(s, 'p1', { type: 'END_TURN' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(['ide-07', 'ide-03']).toContain(r.state._pendingCard);
    expect(r.state._ideologyDiscard).toEqual([]);
    expect(r.state._ideologyDraw).toHaveLength(1);
    expect(r.state._seed).not.toBe(s._seed);
  });

  it('an empty draw pile AND empty discard returns null rather than throwing or looping', () => {
    // With nothing to draw, `draw` returns null and the pending card is null, so
    // ANSWER is refused instead of spinning inside the reshuffle.
    const s: GameState = {
      ...fresh(1),
      _ideologyDraw: [],
      _ideologyDiscard: [],
      _pendingCard: null,
    };
    const r = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no card has been put to you');
  });
});
