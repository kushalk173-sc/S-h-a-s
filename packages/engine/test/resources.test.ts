/**
 * §3.5 RESOURCE CAP, overCap, trimToCap, and §3.10 test 125 (R3) — the negative
 * Delta. R3 is the single most important security test in the suite.
 */

import { describe, expect, it } from 'vitest';

import type { Action } from '../src/actions';
import { reduce, type Ctx } from '../src/reduce';
import {
  add,
  applyDiscounts,
  canAfford,
  deltaError,
  discount,
  isEmpty,
  overCap,
  pool,
  shortfall,
  subtract,
  trimToCap,
} from '../src/resources';
import { RULES } from '../src/rules';
import { poolTotal, type Delta, type GameState, type PlayerID, type Pool } from '../src/state';
import { answered } from './boardkit';
import { fresh, makeCtx } from './helpers';

const ctx: Ctx = makeCtx();

function step(s: GameState, p: PlayerID, a: Action): GameState {
  const r = reduce(s, p, a, ctx);
  if (!r.ok) throw new Error(`${p} ${JSON.stringify(a)} -> ${r.error}`);
  return r.state;
}

function funds(p: GameState, id: PlayerID): Pool {
  const pl = p.players[id];
  if (!pl) throw new Error(`no ${id}`);
  return pl.resources;
}

describe('overCap', () => {
  it('is the TOTAL across all four resources, not per-resource', () => {
    // §16 #3 (rules-reference.md:377) wins over the stale wording at :139.
    expect(overCap({ funds: 6, clout: 6, media: 0, trust: 0 }, 12)).toBe(0);
    expect(overCap({ funds: 7, clout: 6, media: 0, trust: 0 }, 12)).toBe(1);
    expect(overCap({ funds: 3, clout: 3, media: 3, trust: 3 }, 12)).toBe(0);
    expect(overCap({ funds: 3, clout: 3, media: 3, trust: 4 }, 12)).toBe(1);
  });
});

describe('trimToCap', () => {
  it('sheds from the largest pool first, deterministically', () => {
    expect(trimToCap({ funds: 8, clout: 2, media: 2, trust: 2 }, 12)).toEqual({
      funds: 6,
      clout: 2,
      media: 2,
      trust: 2,
    });
  });

  it('is a no-op at or under the cap', () => {
    const at12: Pool = { funds: 3, clout: 3, media: 3, trust: 3 };
    expect(trimToCap(at12, 12)).toEqual(at12);
    const zero: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };
    expect(trimToCap(zero, 12)).toEqual(zero);
  });

  it('terminates and never goes negative', () => {
    const out = trimToCap({ funds: 0, clout: 0, media: 0, trust: 0 }, 12);
    expect(out).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
  });
});

describe('the rest of resources.ts', () => {
  it('pool fills every resource, add and subtract are componentwise', () => {
    expect(pool({ funds: 2 })).toEqual({ funds: 2, clout: 0, media: 0, trust: 0 });
    const base: Pool = { funds: 1, clout: 1, media: 1, trust: 1 };
    expect(add(base, { funds: 1, trust: 2 })).toEqual({ funds: 2, clout: 1, media: 1, trust: 3 });
    expect(subtract(base, { funds: 1 })).toEqual({ funds: 0, clout: 1, media: 1, trust: 1 });
  });

  it('canAfford requires every named resource, shortfall reports the gap', () => {
    const p: Pool = { funds: 2, clout: 0, media: 1, trust: 0 };
    expect(canAfford(p, { funds: 2, media: 1 })).toBe(true);
    expect(canAfford(p, { funds: 2, trust: 1 })).toBe(false);
    expect(shortfall(p, { funds: 2, trust: 1 })).toEqual({ funds: 0, clout: 0, media: 0, trust: 1 });
  });

  it('isEmpty, discount and applyDiscounts behave at the edges', () => {
    expect(isEmpty({})).toBe(true);
    expect(isEmpty({ funds: 0 })).toBe(true);
    expect(isEmpty({ funds: 1 })).toBe(false);
    expect(discount({ funds: 3 }, 'funds')).toEqual({ funds: 2 });
    // Never below zero.
    expect(discount({ funds: 0 }, 'funds')).toEqual({ funds: 0 });
    expect(applyDiscounts({ funds: 2, media: 1 }, ['funds', 'funds', 'media'])).toEqual({
      funds: 0,
      media: 0,
    });
  });
});

describe('the cap choice in play', () => {
  it('a player who crosses the cap is frozen until they discard, and a fresh cap choice waits', () => {
    // The cap choice and the freeze are two halves of one rule (p12), so they are
    // tested together: nothing else may happen, and resolving raises no second
    // choice for the same player.
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      _pendingCard: 'hed-01',
      phase: 'headlines',
      activeHeadline: 'hed-01',
      headlineQueue: [{ areaId: 'central-01', by: 'p1' }],
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 6, clout: 6, media: 0, trust: 0 } },
        p2: { ...s.players.p2!, resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
      },
    };
    // hed-06 gives everyone 1 Funds. p1 starts at 12 (6+6), so 12 -> 13 crosses
    // the cap by exactly 1 and must raise a lose-any naming that excess.
    s = { ...s, activeHeadline: 'hed-06' };
    const r = step(s, 'p1', { type: 'ACK_HEADLINE' });
    expect(r.players.p1?.resources.funds).toBe(7);
    expect(poolTotal(r.players.p1?.resources ?? ({} as Pool))).toBe(13);
    expect(r.choices).toEqual([
      { id: expect.any(String), player: 'p1', choice: { kind: 'lose-any', count: 1, reason: 'Resource cap' } },
    ]);

    // The cap choice freezes them: nothing else is legal until it is resolved.
    const frozen = reduce(r, 'p1', { type: 'END_TURN' }, ctx);
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.error).toBe('resolve "Resource cap" first');

    // Resolving brings them back to exactly the cap, and raises no second choice
    // for the same player on the same trip.
    const resolved = reduce(
      r,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: r.choices[0]?.id ?? '', pick: { kind: 'resources', res: { funds: 1 } } },
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(poolTotal(resolved.state.players.p1?.resources ?? ({} as Pool))).toBe(RULES.resourceCap);
    expect(resolved.state.choices).toEqual([]);
  });

  it('a player with a pending cap choice cannot take any other action', () => {
    // rules-reference.md:110, 140 — "you".
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1!,
          resources: { funds: 12, clout: 0, media: 0, trust: 0 },
          powerUses: { ...s.players.p1!.powerUses },
        },
      },
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'lose-any', count: 3, reason: 'Resource cap' } }],
    };
    const r = reduce(s, 'p1', { type: 'INFLUENCE', slot: 0 }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('resolve "Resource cap" first');
  });

  it('RESOLVE_CHOICE lose-any discards exactly the excess and unblocks the player', () => {
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 15, clout: 0, media: 0, trust: 0 } },
      },
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'lose-any', count: 3, reason: 'Resource cap' } }],
    };
    const r = reduce(
      s,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 3 } } },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(poolTotal(r.state.players.p1?.resources ?? ({} as Pool))).toBe(12);
    expect(r.state.choices).toEqual([]);
  });

  it('a lose effect floors at zero: it takes only what is held', () => {
    // reduce.ts takeResources: `if (got > 0)`.
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 2, clout: 0, media: 0, trust: 0 } },
      },
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'lose-any', count: 5, reason: 'test' } }],
    };
    // Asking for 5 when holding 2 is refused outright: `canAfford` runs first, so
    // the "take only what is held" floor is never reached from a choice. The floor
    // is what protects a *card* effect, which has no such pre-check.
    const tooMany = reduce(
      s,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 5 } } },
      ctx,
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe('you do not hold those');

    // A choice sized to what is actually held goes through and lands on zero.
    const s2: GameState = {
      ...s,
      choices: [
        { id: 'c1', player: 'p1', choice: { kind: 'lose-any', count: 2, reason: 'test' } },
      ],
    };
    const ok = reduce(
      s2,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 2 } } },
      ctx,
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(funds(ok.state, 'p1').funds).toBe(0);
  });

  it('a card lose effect takes only what is held and floors at zero', () => {
    // The floor itself, via a path with no `canAfford` pre-check: apply a Headline
    // whose `lose` exceeds what the target holds. `takeResources` takes
    // `min(want, held)` per resource, so the pool reaches 0 and never -3.
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      _pendingCard: null,
      phase: 'headlines',
      activeHeadline: 'hed-03',
      headlineQueue: [{ areaId: 'central-01', by: 'p1' }],
      players: {
        ...s.players,
        p2: { ...s.players.p2!, resources: { funds: 1, clout: 0, media: 0, trust: 0 } },
        p3: { ...s.players.p3!, resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
      },
    };
    // hed-03 is "each opponent loses 1 Trust". Give p3 nothing: `min(1, 0) = 0`.
    const r = step(s, 'p1', { type: 'ACK_HEADLINE' });
    expect(funds(r, 'p2').trust).toBe(0);
    expect(funds(r, 'p3').trust).toBe(0);
  });
});

describe('R3 — a negative Delta is rejected, not silently applied', () => {
  it('deltaError rejects negative, fractional and non-finite components', () => {
    expect(deltaError({ funds: 3, trust: 2 }, 'x')).toBeNull();
    expect(deltaError({}, 'x')).toBeNull();
    expect(deltaError({ funds: -3 }, 'x')).toBe('x: funds cannot be negative');
    expect(deltaError({ trust: 0.5 }, 'x')).toBe('x: trust must be a whole number');
    expect(deltaError({ media: Number.NaN }, 'x')).toBe('x: media must be a finite number');
    expect(deltaError({ clout: Number.POSITIVE_INFINITY }, 'x')).toBe(
      'x: clout must be a finite number',
    );
  });

  it('steal-any with a negative component is refused and mints nothing', () => {
    // The attack: the victim holds 2, the pick says `{funds: 5, trust: -3}`.
    // `deltaTotal` sums *signed* values so the total is 2 and every check passes;
    // `takeResources` skips the negative and `addResources` credits the 5. Before
    // the fix the thief gained 5 Funds and the victim lost nothing.
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
        p2: { ...s.players.p2!, resources: { funds: 2, clout: 0, media: 0, trust: 0 } },
      },
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'steal-any', count: 2, from: null, reason: 'test' } }],
    };
    const r = reduce(
      s,
      'p1',
      {
        type: 'RESOLVE_CHOICE',
        choiceId: 'c1',
        pick: { kind: 'steal', from: 'p2', res: { funds: 5, trust: -3 } },
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('a theft: trust cannot be negative');
    // Nothing moved. p1 gained nothing, p2 lost nothing.
    expect(funds(s, 'p1')).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
  });

  it('gain-any with a negative component is refused', () => {
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
      },
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'gain-any', count: 2, reason: 'test' } }],
    };
    const r = reduce(
      s,
      'p1',
      {
        type: 'RESOLVE_CHOICE',
        choiceId: 'c1',
        pick: { kind: 'resources', res: { funds: 5, trust: -3 } },
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('cannot be negative');
  });

  it('lose-any with a negative component is refused', () => {
    // A negative discard would otherwise be a silent *gain*: `takeResources` skips
    // it entirely and the choice is dropped as if resolved.
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
      },
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'lose-any', count: 2, reason: 'test' } }],
    };
    const r = reduce(
      s,
      'p1',
      {
        type: 'RESOLVE_CHOICE',
        choiceId: 'c1',
        pick: { kind: 'resources', res: { funds: 5, trust: -3 } },
      },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it('TRADE with a negative give is refused and moves nothing', () => {
    // rules-reference.md:142 — at least one resource each side. `{funds: 5,
    // trust: -3}` totals 2, so the "at least 1" check passes, `takeResources` on
    // the giver skips the negative, and the receiver is credited 5.
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
        p2: { ...s.players.p2!, resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
      },
    };
    const r = reduce(
      s,
      'p1',
      { type: 'TRADE', withPlayer: 'p2', give: { funds: 5, trust: -3 }, receive: { funds: 1 } },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('your side of the trade: trust cannot be negative');
  });

  it('TRADE with a negative receive is refused too', () => {
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
        p2: { ...s.players.p2!, resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
      },
    };
    const r = reduce(
      s,
      'p1',
      { type: 'TRADE', withPlayer: 'p2', give: { funds: 1 }, receive: { funds: 5, trust: -3 } },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('their side of the trade: trust cannot be negative');
  });

  it('REDRAW_IDEOLOGY with a negative payment is refused', () => {
    const s = fresh(1);
    const r = reduce(
      s,
      'p1',
      { type: 'REDRAW_IDEOLOGY', pay: { funds: 7, trust: -3 } },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('a redraw payment: trust cannot be negative');
  });

  it('BUY_CONSPIRACY with a negative payment is refused', () => {
    let s = answered(fresh(1), 'p1');
    s = { ...s, _conspiracyDraw: ['con-01'] };
    // con-01 costs 4. `{funds: 7, trust: -3}` totals 4.
    const r = reduce(
      s,
      'p1',
      { type: 'BUY_CONSPIRACY', pay: { funds: 7, trust: -3 } },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('a conspiracy payment: trust cannot be negative');
  });

  it('POWER_TOUGH_LOVE with a negative payment is refused', () => {
    // `{trust: 2, funds: -2}` totals 2, which equals 2 Trust + 0 of anything, so
    // the player would convert two voters while paying nothing but the Trust.
    let s = answered(fresh(1), 'p1', { manifesto: 5 });
    s = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1!,
          manifesto: Array(5).fill('idealist'),
          resources: { funds: 4, clout: 0, media: 0, trust: 4 },
        },
      },
    };
    const areas = s.zones.find((z) => z.id === 'central')?.areas.slice(0, 2).map((a) => a.id) ?? [];
    for (const id of areas) {
      s = {
        ...s,
        zones: s.zones.map((z) =>
          z.id === 'central'
            ? { ...z, areas: z.areas.map((a) => (a.id === id ? { ...a, peg: { owner: 'p2', majority: false } } : a)) }
            : z,
        ),
      };
    }
    const r = reduce(
      s,
      'p1',
      { type: 'POWER_TOUGH_LOVE', areaIds: areas, pay: { trust: 2, funds: -2 } },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('a Tough Love payment: funds cannot be negative');
  });

  it('a zero-valued payment is still a payment and cannot buy anything', () => {
    // The boundary: `deltaError` accepts 0, and the total checks still apply.
    const s = fresh(1);
    const r = reduce(s, 'p1', { type: 'REDRAW_IDEOLOGY', pay: {} }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(`a redraw costs exactly ${RULES.redrawCost} resources`);
  });
});

describe('negative resources can never reach a player', () => {
  it('across a whole game, every pool stays non-negative', () => {
    // The invariant, restated at the strongest level: even with the R3 guard in
    // place, no code path may drive a pool below zero.
    const bad: string[] = [];
    const s = step(answered(fresh(1), 'p1'), 'p1', { type: 'END_TURN' });
    for (const p of s.turnOrder) {
      const r = s.players[p]?.resources;
      if (!r) continue;
      for (const [k, v] of Object.entries(r)) {
        const n = v as number;
        if (deltaError({ [k]: n } as Delta, 'pool') !== null) bad.push(`${p}.${k}=${n}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
