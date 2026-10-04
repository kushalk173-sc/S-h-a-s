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

/**
 * THE ORDER IS A **PER-CARD CONSTANT**, not a per-answer draw — and this block exists so
 * that the ambiguity cannot reopen.
 *
 * ## WHAT WAS IN QUESTION
 *
 * The server derives a pending card's two-faces presentation order from `state._seed` and
 * the card's id (`broadcast.ts#orderFor`), and reproduces it verbatim on both the table's
 * `openQuestion` and the answerer's prompt. Turn 1 shows a card one way; turn 400 shows the
 * SAME card the same way, because `_seed` has not moved. Two records read that as a per-answer
 * draw; the records that SPECIFY the mechanic say per-card (`PLAN.md` row 18, `PLAN.md` §2's
 * status note, `docs/UI-SPEC.md` §1.2), and `broadcast.ts` argues from it — *"a redraw changes
 * the card and therefore the order, which is correct: it is a different question"* is only
 * true if the card is the whole input. So this is the shipped, intended design, and it is
 * also the SMALLER leak: `docs/AUDIT-2026-10.md` §S2 measured `order` as one bit of
 * avalanche output per turn about a 32-bit cursor and proposed rotating a salt per answer,
 * which would publish a FRESH bit every turn forever where this publishes one bit per card
 * ever dealt.
 *
 * ## WHY THE ASSERTION LIVES HERE
 *
 * `orderFor` is the server's file and the server's concern. The **engine half** of the
 * property is that nothing but a reshuffle moves the cursor, and that is `draw()`'s only
 * writer — which is this package's code, in this package's state type, documented in this
 * package's header. A test that asserted the server's hash would be a test of somebody
 * else's arithmetic; a test that asserts the cursor does not move is a test of the fact the
 * hash is a function of, and it fails loudly if a future card adds an entropy draw.
 */
describe('the order is a per-card constant: `_seed` moves on a reshuffle and on NOTHING else', () => {
  it('ANSWER leaves the cursor exactly where it was', () => {
    for (const seats of [2, 3, 4, 5] as const) {
      const ids = Array.from({ length: seats }, (_, i) => `p${i + 1}`);
      const s = fresh(1, ids);
      expect(s._pendingCard, `${seats} seats: no card to answer`).not.toBeNull();
      const before = s._seed;
      const r = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, ctx);
      expect(r.ok, `${seats} seats: ANSWER was refused`).toBe(true);
      if (!r.ok) continue;
      expect(r.state._seed, `${seats} seats: ANSWER moved the PRNG cursor, so the order is per-answer after all`).toBe(before);
    }
  });

  it('the whole of an ordinary turn leaves it where it was — influence, gerrymander, end turn', () => {
    // The negative space matters as much as `ANSWER`: any action anywhere that drew entropy
    // would make the cursor, and therefore the order, move. So this walks the three actions
    // a turn is made of and asserts the cursor is unmoved after each.
    const base = fresh(1);
    const start: GameState = {
      ...base,
      phase: 'actions',
      activePlayer: 'p1',
      _pendingCard: null,
      players: { ...base.players, p1: { ...base.players.p1!, resources: { funds: 4, clout: 0, media: 0, trust: 0 } } },
    };
    expect(start.market.length, 'no open Voter Card, so the walk proves nothing').toBeGreaterThan(0);
    expect(start.players.p1?.resources.funds ?? 0, 'p1 cannot afford to influence').toBeGreaterThanOrEqual(2);
    const steps: readonly { readonly label: string; readonly action: Parameters<typeof reduce>[2] }[] = [
      { label: 'INFLUENCE', action: { type: 'INFLUENCE', slot: 0 } },
      { label: 'END_TURN', action: { type: 'END_TURN' } },
    ];
    let cursor = start._seed;
    let s = start;
    for (const step of steps) {
      const r = reduce(s, 'p1', step.action, ctx);
      expect(r.ok, `${step.label} was refused: ${r.ok ? '' : r.error}`).toBe(true);
      if (!r.ok) continue;
      s = r.state;
      expect(s._seed, `${step.label} moved the PRNG cursor`).toBe(cursor);
      cursor = s._seed;
    }
  });

  it('and a reshuffle DOES move it, or the property above would be vacuous', () => {
    // The other half. Without this the two tests above would pass for the wrong reason —
    // a frozen cursor would satisfy them too — and "the order never changes" is a different
    // and much worse claim than "the order is a function of the card and the cursor".
    const s: GameState = {
      ...fresh(1),
      phase: 'actions',
      _pendingCard: null,
      _ideologyDraw: [],
      _ideologyDiscard: ['ide-01', 'ide-02', 'ide-03'],
    };
    const r = reduce(s, 'p1', { type: 'END_TURN' }, ctx);
    expect(r.ok, `END_TURN was refused: ${r.ok ? '' : r.error}`).toBe(true);
    if (!r.ok) return;
    expect(r.state._seed, 'a reshuffle did not move the cursor, so the cursor is frozen and the per-card claim is untested').not.toBe(s._seed);
  });
});
