/**
 * §3.6 POWER UNLOCK THRESHOLDS AND PER-TURN LIMITS — powers.ts, rules.ts:23-24,
 * rules-reference.md:200-205 and 214-237.
 */

import { describe, expect, it } from 'vitest';

import type { Action } from '../src/actions';
import { reduce, type Ctx } from '../src/reduce';
import {
  archetype,
  cardsOf,
  hasPower,
  passiveBonus,
  POWERS,
  powerSpec,
  unlockedPowers,
  usesLeft,
  type PowerID,
} from '../src/powers';
import { RULES } from '../src/rules';
import type { GameState, Ideologue, PlayerID, PlayerState, ZoneID } from '../src/state';
import { plainFreeIn, setAreaState, withPegs } from './boardkit';
import { fresh, makeCtx } from './helpers';

const ctx: Ctx = makeCtx();

/** A player holding `n` cards of one Ideologue, in the `actions` phase. */
function withManifesto(s: GameState, p: PlayerID, ideologue: Ideologue, n: number): GameState {
  const cur = s.players[p];
  if (!cur) throw new Error(`no ${p}`);
  const next: PlayerState = {
    ...cur,
    manifesto: Array(n).fill(ideologue),
    manifestoCards: Array(n).fill('ide-01'),
    resources: { funds: 12, clout: 0, media: 0, trust: 0 },
  };
  return {
    ...s,
    activePlayer: p,
    phase: 'actions',
    _pendingCard: null,
    players: { ...s.players, [p]: next },
  };
}

function act(s: GameState, p: PlayerID, a: Action) {
  return reduce(s, p, a, ctx);
}

describe('unlock thresholds', () => {
  it('at 2 cards no power is unlocked; at exactly 3 the L3 power unlocks', () => {
    // rules.ts level3 === 3.
    expect(RULES.level3).toBe(3);
    for (const n of [0, 1, 2]) {
      const s = withManifesto(fresh(1), 'p1', 'capitalist', n);
      expect(unlockedPowers(s.players.p1!, RULES)).toEqual([]);
    }
    const three = withManifesto(fresh(1), 'p1', 'capitalist', 3);
    expect(unlockedPowers(three.players.p1!, RULES)).toContain('prospecting');
  });

  it('L5 unlocks at exactly 5, not 4', () => {
    // rules.ts level5 === 5.
    expect(RULES.level5).toBe(5);
    const four = withManifesto(fresh(1), 'p1', 'capitalist', 4);
    const five = withManifesto(fresh(1), 'p1', 'capitalist', 5);
    expect(unlockedPowers(four.players.p1!, RULES)).toEqual(['prospecting']);
    expect(unlockedPowers(four.players.p1!, RULES)).not.toContain('land-grab');
    expect(unlockedPowers(five.players.p1!, RULES)).toEqual(['prospecting', 'land-grab']);
  });

  it('unlockedPowers is derived, never cached: losing a card loses the power', () => {
    // powers.ts:4-7. p22 makes this mandatory, and coalitions (D5) will exercise
    // it. The reducer stores no power state, so a test only has to prove the
    // derivation follows the manifesto.
    const five = withManifesto(fresh(1), 'p1', 'capitalist', 5);
    expect(hasPower(five.players.p1!, RULES, 'land-grab')).toBe(true);
    const four = withManifesto(five, 'p1', 'capitalist', 4);
    expect(hasPower(four.players.p1!, RULES, 'land-grab')).toBe(false);
    expect(cardsOf(four.players.p1!, 'capitalist')).toBe(4);
  });

  it('usesLeft returns 0 for a locked power even with counters at 0', () => {
    const s = withManifesto(fresh(1), 'p1', 'capitalist', 0);
    expect(usesLeft(s.players.p1!, RULES, 'prospecting')).toBe(0);
  });

  it('every power maps to the Ideologue and level its name claims', () => {
    for (const spec of POWERS) {
      expect(powerSpec(spec.id)).toBe(spec);
      expect([3, 5]).toContain(spec.level);
    }
    expect(POWERS).toHaveLength(8);
    const ids = POWERS.map((p) => p.id).sort();
    expect(ids).toEqual(
      ['donations', 'election-fever', 'going-viral', 'helping-hands', 'land-grab', 'payback', 'prospecting', 'tough-love'],
    );
  });
});

describe('passiveBonus', () => {
  it('passiveBonus is floor(cards/2) per Ideologue, paid on the turn you answer', () => {
    // rules.ts passiveBonusPer === 2; rules-reference.md:194-196.
    expect(RULES.passiveBonusPer).toBe(2);
    const four = withManifesto(fresh(1), 'p1', 'capitalist', 4);
    // Four Capitalists plus one Supremo: Funds floor(4/2) = 2, Clout floor(1/2) = 0.
    const mixed: PlayerState = {
      ...four.players.p1!,
      manifesto: ['capitalist', 'capitalist', 'capitalist', 'capitalist', 'supremo'],
    };
    expect(passiveBonus(mixed, RULES)).toEqual({ funds: 2 });

    // Floor, not round: 3 Capitalists is 1, not 2.
    const three: PlayerState = {
      ...four.players.p1!,
      manifesto: ['capitalist', 'capitalist', 'capitalist'],
    };
    expect(passiveBonus(three, RULES)).toEqual({ funds: 1 });

    // Two different Ideologues pay independently.
    const split: PlayerState = {
      ...four.players.p1!,
      manifesto: ['capitalist', 'capitalist', 'supremo', 'supremo'],
    };
    expect(passiveBonus(split, RULES)).toEqual({ funds: 1, clout: 1 });
  });

  it('the threshold bonus applies in the very turn it is reached', () => {
    // rules-reference.md:198, reduce.ts:476-478 — the bonus is computed AFTER the
    // card is added, so the second Capitalist pays out immediately.
    let s = fresh(1);
    s = {
      ...s,
      players: { ...s.players, p1: { ...s.players.p1!, manifesto: ['capitalist'], manifestoCards: ['ide-01'] } },
    };
    const r = act(s, 'p1', { type: 'ANSWER', side: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ide-01 side 0 pays {funds: 1}; the manifesto is now 2 Capitalists so the
    // bonus is another 1 Funds.
    expect(r.state.players.p1?.manifesto).toHaveLength(2);
    expect(r.state.players.p1?.resources.funds).toBe(2);
  });
});

describe('archetype', () => {
  it('is the most-held Ideologue, and null on a tie or an empty manifesto', () => {
    const s = fresh(1);
    const p = s.players.p1!;
    expect(archetype(p)).toBeNull();
    expect(archetype({ ...p, manifesto: ['capitalist', 'capitalist', 'supremo'] })).toBe('capitalist');
    expect(archetype({ ...p, manifesto: ['capitalist', 'supremo'] })).toBeNull();
  });
});

describe('per-turn limits', () => {
  it('each powers allowance matches the rulebook and the Nth+1 use fails', () => {
    // rules.ts:61-71. The Nth use succeeds; the N+1th is refused with the power's
    // OWN message, so a future generic guard cannot mask which power failed.
    const cases: readonly {
      readonly id: PowerID;
      readonly ideologue: Ideologue;
      readonly n: number;
      readonly perTurn: number;
      readonly action: (use: number) => Action;
    }[] = [
      {
        id: 'prospecting',
        ideologue: 'capitalist',
        n: 3,
        perTurn: RULES.prospectingPerTurn,
        action: () => ({ type: 'POWER_PROSPECT', give: 'funds', take: ['funds', 'clout'] }),
      },
      {
        id: 'donations',
        ideologue: 'supremo',
        n: 3,
        perTurn: RULES.donationsPerTurn,
        action: (use) => ({ type: 'POWER_DONATIONS', from: use % 2 === 0 ? 'p2' : 'p3', res: 'clout' }),
      },
      {
        id: 'going-viral',
        ideologue: 'showstopper',
        n: 3,
        perTurn: RULES.goingViralPerTurn,
        action: () => ({ type: 'INFLUENCE', slot: 0, viral: true }),
      },
      {
        id: 'helping-hands',
        ideologue: 'idealist',
        n: 3,
        perTurn: RULES.helpingHandsPerTurn,
        action: () => ({ type: 'INFLUENCE', slot: 0, discounts: ['funds'] }),
      },
    ];

    for (const c of cases) {
      let s = withManifesto(fresh(1), 'p1', c.ideologue, c.n);
      // Give the table enough resources and board that only the limit stops us.
      // Enough to afford every purchase, but deliberately UNDER the cap: a power
      // that gains resources can otherwise cross it, raise a `lose-any` choice, and
      // freeze the player — which would test the cap, not the allowance.
      s = {
        ...s,
        market: [
          { cardId: 'vot-01', cost: { funds: 1 }, voters: 1 },
          { cardId: 'vot-02', cost: { funds: 1 }, voters: 1 },
          { cardId: 'vot-03', cost: { funds: 1 }, voters: 1 },
        ],
        _voterDraw: [],
        _voterDiscard: [],
        players: Object.fromEntries(
          s.turnOrder.map((id) => [
            id,
            {
              ...s.players[id]!,
              resources:
                id === 'p1'
                  ? { funds: 8, clout: 0, media: 0, trust: 0 }
                  : { funds: 0, clout: 8, media: 0, trust: 0 },
            },
          ]),
        ),
      };
      expect(hasPower(s.players.p1!, RULES, c.id), `${c.id} not unlocked`).toBe(true);
      expect(usesLeft(s.players.p1!, RULES, c.id), `${c.id} allowance`).toBe(c.perTurn);

      let last: ReturnType<typeof act> | null = null;
      for (let use = 0; use < c.perTurn; use++) {
        last = act(s, 'p1', c.action(use));
        expect(last.ok, `${c.id} use ${use + 1} of ${c.perTurn}`).toBe(true);
        if (!last.ok) break;
        s = last.state;
      }
      const over = act(s, 'p1', c.action(c.perTurn));
      expect(over.ok, `${c.id} use ${c.perTurn + 1} should fail`).toBe(false);
    }
  });

  it('a locked power is refused with its own specific message', () => {
    // Guards against a future generic-guard refactor masking which power failed.
    const s = withManifesto(fresh(1), 'p1', 'capitalist', 0);
    const spent = withManifesto(fresh(1), 'p1', 'capitalist', 5);
    const expect1 = act(s, 'p1', { type: 'POWER_PROSPECT', give: 'funds', take: ['funds'] });
    expect(expect1.ok).toBe(false);
    if (!expect1.ok) expect(expect1.error).toBe('Prospecting is not available');

    // Going Viral is unlocked at 3 Showstopper but the *counter* is what makes it
    // unavailable, so exhaust it rather than asserting on a locked power.
    const show = withManifesto(fresh(1), 'p1', 'showstopper', 3);
    const spentViral = {
      ...show,
      players: {
        ...show.players,
        p1: { ...show.players.p1!, powerUses: { ...show.players.p1!.powerUses, goingViral: 2 } },
      },
    };
    const viral = act(spentViral, 'p1', { type: 'INFLUENCE', slot: 0, viral: true });
    expect(viral.ok).toBe(false);
    if (!viral.ok) expect(viral.error).toBe('Going Viral is spent for this turn');

    // Helping Hands likewise: the allowance is 2, so a third discount is refused.
    const ideal = withManifesto(fresh(1), 'p1', 'idealist', 3);
    const hands = act(ideal, 'p1', {
      type: 'INFLUENCE',
      slot: 0,
      discounts: ['funds', 'funds', 'funds'],
    });
    expect(hands.ok).toBe(false);
    if (!hands.ok) expect(hands.error).toBe('not enough Helping Hands discounts left');

    // Land Grab: unlocked, but there is no voter to evict.
    const grab = act(spent, 'p1', { type: 'POWER_LAND_GRAB', areaId: 'central-01' });
    expect(grab.ok).toBe(false);
    if (!grab.ok) expect(grab.error).toBe('there is no voter there');
  });

  it('Donations cannot be aimed at yourself', () => {
    const s = withManifesto(fresh(1), 'p1', 'supremo', 3);
    const r = act(s, 'p1', { type: 'POWER_DONATIONS', from: 'p1', res: 'clout' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('snatch from someone else');
  });

  it('Tough Love rejects a mixed-owner or mixed-zone pair', () => {
    // rules-reference.md:235-236.
    let s = withManifesto(fresh(1), 'p1', 'idealist', 5);
    s = withPegs(s, 'p2', 'central', 2);
    s = withPegs(s, 'p3', 'central', 1);
    s = withPegs(s, 'p2', 'west', 1);

    const z = s.zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    const owned = z.areas.filter((a) => a.peg !== null).map((a) => a.id);
    const a = owned[0];
    const b = owned[owned.length - 1];
    if (!a || !b) throw new Error('setup');

    const mixedOwner = act(s, 'p1', {
      type: 'POWER_TOUGH_LOVE',
      areaIds: [a, b],
      pay: { trust: 2, funds: 2 },
    });
    expect(mixedOwner.ok).toBe(false);
    if (!mixedOwner.ok) {
      expect([
        'both voters must belong to the same player',
        'Tough Love targets an opponent',
      ]).toContain(mixedOwner.error);
    }

    // Same owner, different zones.
    const westId = s.zones.find((x) => x.id === 'west')?.areas.find((x) => x.peg !== null)?.id;
    if (!westId) throw new Error('setup');
    const sameOwner = s.zones.find((x) => x.id === 'central')?.areas.find((x) => x.peg?.owner === 'p2')?.id;
    if (!sameOwner) throw new Error('setup');
    const mixedZone = act(s, 'p1', {
      type: 'POWER_TOUGH_LOVE',
      areaIds: [sameOwner, westId],
      pay: { trust: 2, funds: 2 },
    });
    expect(mixedZone.ok).toBe(false);
    if (!mixedZone.ok) expect(mixedZone.error).toBe('both voters must be in the same zone');
  });

  it('Tough Love costs 2 Trust PLUS 2 of anything and rejects underpayment', () => {
    // rules-reference.md:32 text; reduce.ts:858-861.
    let s = withManifesto(fresh(1), 'p1', 'idealist', 5);
    s = withPegs(s, 'p2', 'central', 2);
    const ids = s.zones.find((x) => x.id === 'central')?.areas.filter((a) => a.peg !== null).map((a) => a.id) ?? [];
    const [a, b] = ids;
    if (!a || !b) throw new Error('setup');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, resources: { funds: 6, clout: 0, media: 0, trust: 6 } },
      },
    };

    const under = act(s, 'p1', { type: 'POWER_TOUGH_LOVE', areaIds: [a, b], pay: { trust: 2, funds: 1 } });
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.error).toBe('Tough Love costs 2 Trust plus 2 of anything');

    const exact = act(s, 'p1', { type: 'POWER_TOUGH_LOVE', areaIds: [a, b], pay: { trust: 2, funds: 2 } });
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    // Both voters now belong to p1, in the same areas.
    for (const id of [a, b]) {
      const area = exact.state.zones.flatMap((x) => x.areas).find((x) => x.id === id);
      expect(area?.peg?.owner).toBe('p1');
    }
  });

  it('a Volatile Area voter resists Land Grab, Payback and Tough Love alike', () => {
    // rules-reference.md:215, 221, 237.
    const base = fresh(1);
    const vol = base.zones.find((z) => z.id === 'central')?.areas.find((a) => a.volatile);
    if (!vol) throw new Error('central has no Volatile Area');

    // Land Grab (Capitalist L5).
    let lg = withManifesto(fresh(1), 'p1', 'capitalist', 5);
    lg = setAreaState(lg, vol.id, { owner: 'p2', majority: false });
    const grab = act(lg, 'p1', { type: 'POWER_LAND_GRAB', areaId: vol.id });
    expect(grab.ok).toBe(false);
    if (!grab.ok) expect(grab.error).toBe('voters in a Volatile Area cannot be evicted');

    // Payback (Supremo L5).
    let pb = withManifesto(fresh(1), 'p1', 'supremo', 5);
    pb = setAreaState(pb, vol.id, { owner: 'p2', majority: false });
    const payback = act(pb, 'p1', { type: 'POWER_PAYBACK', areaId: vol.id, pay: 'clout' });
    expect(payback.ok).toBe(false);
    if (!payback.ok) expect(payback.error).toBe('voters in a Volatile Area cannot be discarded');

    // Tough Love (Idealist L5).
    let tl = withManifesto(fresh(1), 'p1', 'idealist', 5);
    tl = setAreaState(tl, vol.id, { owner: 'p2', majority: false });
    const other = plainFreeIn(tl, 'central', 1)[0];
    if (!other) throw new Error('setup');
    const mate = tl.zones.find((z) => z.id === 'central')?.areas.find(
      (x) => x.peg === null && !x.volatile,
    )?.id;
    if (!mate) throw new Error('setup');
    tl = setAreaState(tl, mate, { owner: 'p2', majority: false });
    const love = act(tl, 'p1', {
      type: 'POWER_TOUGH_LOVE',
      areaIds: [vol.id, mate],
      pay: { trust: 2, funds: 2 },
    });
    expect(love.ok).toBe(false);
    if (!love.ok) expect(love.error).toBe('voters in a Volatile Area cannot be converted');
  });

  it('a power is usable in the SAME turn it unlocks', () => {
    // rules-reference.md:203. Two Capitalists in the manifesto, then answer a third
    // Capitalist card: the L3 power must be live on that very turn, because
    // `usesLeft` is derived from the manifesto the ANSWER just updated.
    const base = fresh(1);
    const s: GameState = {
      ...base,
      _pendingCard: 'ide-01', // side 0 is capitalist
      phase: 'answer',
      players: {
        ...base.players,
        p1: {
          ...base.players.p1!,
          manifesto: ['capitalist', 'capitalist'],
          manifestoCards: ['ide-09', 'ide-10'],
          resources: { funds: 4, clout: 0, media: 0, trust: 0 },
        },
      },
    };
    const a1 = act(s, 'p1', { type: 'ANSWER', side: 0 });
    expect(a1.ok, a1.ok ? '' : a1.error).toBe(true);
    if (!a1.ok) return;
    expect(a1.state.players.p1?.manifesto.filter((m) => m === 'capitalist')).toHaveLength(3);
    expect(hasPower(a1.state.players.p1!, RULES, 'prospecting')).toBe(true);
    const prospect = act(a1.state, 'p1', {
      type: 'POWER_PROSPECT',
      give: 'funds',
      take: ['funds', 'clout'],
    });
    expect(prospect.ok).toBe(true);
  });
});
