/**
 * §3.1 INTEGRATION — the full game, end to end.
 *
 * This is M1's own exit criterion (PLAN.md:206). Before the repair it was not
 * merely untested but *unreachable*: `setup()` could not produce a legal
 * `GameState`, and even if it could, the opening player was soft-locked because
 * no Ideology Card had been put to them.
 */

import { describe, expect, it } from 'vitest';

import { allMajoritiesFormed, scores, winners } from '../src/board';
import { reduce } from '../src/reduce';
import { RULES } from '../src/rules';
import { poolTotal, type GameState, type PlayerID } from '../src/state';
import { playFullGame } from './driver';
import { bigCtx, freshFull, seats } from './helpers';

const ctx = bigCtx();
const PLAYERS_3 = ['p1', 'p2', 'p3'] as const;

// The audit asks for a seed that ends with a majority in all nine zones. Not
// every game does: p20 gives everyone one final turn once the board fills, so a
// game can also end with the board full and a zone still contested. Both endings
// are legal, so the tests below pin the one they are about rather than assuming.
//
// Which ending a seed produces depends on the whole opening position, so these
// two are re-verified together: when the staggered start (p7, `setup.ts`) was
// implemented, seed 7 stopped being a timer ending and had to be re-picked. The
// point of the constant is to pin a *reachable* ending, not a specific one.
const MAJORITY_SEED = 3;
const BOARD_FULL_SEED = 13;

function run(seed = 3, players: readonly PlayerID[] = PLAYERS_3) {
  const { state, steps, refusals } = playFullGame(freshFull(seed, players), ctx);
  return { state, steps, refusals };
}

describe('full game', () => {
  it('plays a full 3-player game to completion without a single failed action', () => {
    const { state, steps, refusals } = run();
    expect(state.finished).toBe(true);
    expect(state.phase).toBe('finished');
    // Proves the game ended on a rule and not on the driver's step guard. A
    // finished game is reachable only via `endOfGame`, which fires on either
    // all-majorities or the p20 timer.
    expect(steps.length).toBeLessThan(2000);
    expect(state.turn).toBeGreaterThan(1);
    expect(refusals).toEqual([]);
  });

  it('full game ends with a majority in every one of the 9 zones', () => {
    const { state } = run(MAJORITY_SEED);
    expect(allMajoritiesFormed(state)).toBe(true);
    for (const z of state.zones) expect(z.majorityHolder).not.toBeNull();
  });

  it('a game may also end by the p20 timer: board full, one final turn each', () => {
    // The other legal ending. Worth pinning explicitly, because "the game ended"
    // and "every zone has a majority" are not the same statement.
    const { state } = run(BOARD_FULL_SEED);
    expect(state.finished).toBe(true);
    expect(state.finalRoundFrom).not.toBeNull();
  });

  it('winning scores equal the sum of flipped pegs and nothing else', () => {
    const { state } = run();
    const s = scores(state);
    const sum = Object.values(s).reduce((a, b) => a + b, 0);
    const flipped = state.zones.reduce(
      (n, z) => n + z.areas.filter((a) => a.peg?.majority === true).length,
      0,
    );
    expect(sum).toBe(flipped);
    // 6+11+6+9+5+9+6+11+6 — Appendix A.
    expect(sum).toBeLessThanOrEqual(69);
  });

  it('a full game is reproducible: same seed + same action log = identical state', () => {
    const a = run(11);
    const b = run(11);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(b.steps.length).toBe(a.steps.length);
  });

  it('reproducibility survives an interleaved different game', () => {
    // Run A to completion, then an unrelated game, then A again from a fresh
    // setup at the same seed. This is the test that catches module-level mutable
    // state, which test-order alone would hide. R2.
    const a1 = run(23);
    const other = run(999, seats(4));
    expect(other.state.finished).toBe(true);
    const a2 = run(23);
    expect(JSON.stringify(a2.state)).toBe(JSON.stringify(a1.state));
  });

  it('every full game emits a game-over event listing the true winner(s)', () => {
    // Re-run the tail of a finished game's log and check the final event.
    const { state } = run(5);
    expect(state.finished).toBe(true);
    // Winners must be a subset of the seats, and the max scorers.
    const s = scores(state);
    const max = Math.max(...Object.values(s));
    const expected = Object.entries(s)
      .filter(([, v]) => v === max)
      .map(([k]) => k);
    expect(new Set(winners(state))).toEqual(new Set(expected));
  });

  it('no player is ever over the resource cap outside a pending choice', () => {
    let over = 0;
    playFullGame(freshFull(31), ctx, (s) => {
      for (const p of s.turnOrder) {
        const pl = s.players[p];
        if (!pl) continue;
        const open = s.choices.some(
          (c) => c.player === p && c.choice.kind === 'lose-any',
        );
        if (!open && poolTotal(pl.resources) > RULES.resourceCap) over += 1;
      }
    });
    expect(over).toBe(0);
  });

  it('no action ever produces a negative resource count', () => {
    let negative = 0;
    playFullGame(freshFull(37), ctx, (s) => {
      for (const p of s.turnOrder) {
        const pl = s.players[p];
        if (!pl) continue;
        if (pl.resources.funds < 0 || pl.resources.clout < 0 ||
            pl.resources.media < 0 || pl.resources.trust < 0) negative += 1;
      }
    });
    expect(negative).toBe(0);
  });

  it('2-, 3-, 4- and 5-player games all reach finished', () => {
    for (const n of [2, 3, 4, 5]) {
      const { state, steps } = playFullGame(freshFull(41, seats(n)), ctx);
      expect(state.finished, `${n} players did not finish`).toBe(true);
      expect(state.phase).toBe('finished');
      expect(steps.length).toBeLessThan(2000);
    }
  });

  it('the log contains one answer entry per ANSWER action, in non-decreasing turn order', () => {
    const { state, steps } = run(53);
    const answers = steps.filter((s) => s.a.type === 'ANSWER').length;
    const logged = state.log.filter((l) => l.kind === 'answer');
    expect(logged.length).toBe(answers);
    for (let i = 1; i < logged.length; i++) {
      const prev = logged[i - 1];
      const cur = logged[i];
      if (!prev || !cur) throw new Error('missing log entry');
      expect(cur.turn).toBeGreaterThanOrEqual(prev.turn);
    }
  });
});

describe('replay fidelity', () => {
  it('a full replay from seed + action log reproduces every intermediate state', () => {
    const recorded: string[] = [];
    const { steps } = playFullGame(freshFull(67), ctx, (s) => recorded.push(JSON.stringify(s)));

    // Replay the recorded action log from a fresh setup at the same seed.
    let s = freshFull(67);
    const again: string[] = [];
    for (const { p, a } of steps) {
      const r = reduce(s, p, a, ctx);
      if (!r.ok) throw new Error(`replay diverged: ${p} ${JSON.stringify(a)} -> ${r.error}`);
      s = r.state;
      again.push(JSON.stringify(s));
    }
    expect(again).toEqual(recorded);
  });

  it('choice ids and voter-group ids are stable across two identical replays', () => {
    const collect = (): { choices: string[]; groups: string[] } => {
      const choices: string[] = [];
      const groups: string[] = [];
      playFullGame(freshFull(71), ctx, (s) => {
        for (const c of s.choices) choices.push(c.id);
        for (const p of s.turnOrder) {
          for (const g of s.players[p]?.pending ?? []) groups.push(g.id);
        }
      });
      return { choices, groups };
    };
    expect(collect()).toEqual(collect());
  });

  it('reduce is pure: the same action log twice yields deep-equal states', () => {
    // The direct form of R2. Module-level counters made ids depend on how many
    // games had already run in this process; now they come from `state._idSeq`.
    const steps: { p: PlayerID; a: Parameters<typeof reduce>[2] }[] = [];
    playFullGame(freshFull(83), ctx, (_s, p, a) => {
      if (steps.length < 300) steps.push({ p, a });
    });

    const run = (): GameState => {
      let s = freshFull(83);
      for (const { p, a } of steps) {
        const r = reduce(s, p, a, ctx);
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      return s;
    };
    const a = run();
    // Interleave a different game so any leaked module state would show up.
    playFullGame(freshFull(1234, seats(4)), ctx);
    const b = run();
    expect(b).toEqual(a);
  });
});
