/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE NUMBER ON THE CARD IS THE NUMBER THE ENGINE CHARGES — FOR EVERY COMBINATION
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## WHAT WAS REPORTED, TWICE
 *
 * "Clicking a market card that looks affordable sometimes does nothing at all."
 *
 * The first cause was found and fixed: `MarketStrip` priced `slot.cost` while
 * `buyMarketCard` charged `applyDiscounts(cost, discounts)`, so with Helping Hands
 * armed a `2 funds · 2 trust` card rendered dead against a `1 funds · 3 trust` hand
 * while the engine would have accepted it.
 *
 * The second cause is one clause further down the engine and was still open:
 *
 * ```ts
 * // reduce.ts, INFLUENCE
 * const discounted = applyDiscounts(slot.cost, discounts);
 * const cost = surcharge > 0 ? { ...discounted, funds: (discounted.funds ?? 0) + surcharge } : discounted;
 * if (!canAfford(self.resources, cost)) return fail('you cannot afford that Voter Card');
 * ```
 *
 * Every surcharge this player carries is added **in Funds, after** the discounts.
 * PYTHONPOST and SNOOP B-O-DOUBLE-T put one there, and they sum. So a player holding
 * exactly a card's printed price saw a live button, pressed it, and was told they
 * could not afford it. Same defect, same symptom, one more clause away.
 *
 * ## WHAT THIS FILE PROVES
 *
 * For **every** discount combination over all four resources and a range of
 * surcharges:
 *
 *   1. the numerals the strip PRINTS add up to the price `marketCharge` returns, and
 *      to what the engine's own source says it charges;
 *   2. the button is enabled exactly when `canAfford(resources, charged)` holds, so
 *      the strip can never render a card live that the dispatch guard will refuse;
 *   3. a card the ENGINE would refuse is never rendered live — which is the property
 *      the tester actually reported.
 *
 * And the mirror itself: `marketCharge.test.tsx` reads `reduce.ts`'s own source and
 * fails if the INFLUENCE price stops being "discounts then surcharge", so the client
 * copy cannot quietly become a second, different rule.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  ClientState,
  MarketSlot,
  PlayerID,
  PlayerState,
  Pool,
  Resource,
  ZoneID,
} from '@shasn/engine';

import { MarketStrip } from './YourMat.tsx';
import { RESOURCE_ORDER, applyDiscounts, marketCharge, marketLockout, surchargeOf } from './derive.ts';

const ME: PlayerId2 = 'p1';

// ─────────────────────────── fixtures ───────────────────────────

type PlayerId2 = PlayerID;

const ZERO: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

function seat(pool: Pool, restrictions: readonly { kind: string; value: number }[] = []): PlayerState {
  return {
    id: ME,
    name: 'ME',
    colour: '#fff',
    resources: pool,
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    restrictions,
    pending: [],
    powerUses: {
      prospecting: 0,
      landGrab: 0,
      donations: 0,
      payback: 0,
      goingViral: 0,
      helpingHands: 0,
      toughLove: 0,
      gerrymandered: {},
    },
    isBot: false,
  } as unknown as PlayerState;
}

const slot = (cost: Partial<Record<Resource, number>>, voters = 3): MarketSlot =>
  ({ cardId: `v-${voters}-${JSON.stringify(cost)}`, cost, voters }) as unknown as MarketSlot;

/** One constituency with plenty of room, so nothing else can disable the strip. */
function table(pool: Pool, market: readonly MarketSlot[], restrictions: readonly { kind: string; value: number }[] = []) {
  return {
    players: { [ME]: seat(pool, restrictions) },
    market,
    zones: [
      {
        id: 'central' as ZoneID,
        name: 'Central',
        majority: 5,
        capacity: 9,
        neighbours: [],
        majorityHolder: null,
        areas: Array.from({ length: 9 }, (_, i) => ({
          id: `central-0${i + 1}`,
          zone: 'central',
          volatile: false,
          peg: null,
        })),
      },
    ],
    turnOrder: [ME],
  } as unknown as ClientState;
}

/** Every subset of the four resources, in a stable order. */
function everyCombination(): Resource[][] {
  const out: Resource[][] = [];
  for (let bits = 0; bits < 1 << RESOURCE_ORDER.length; bits += 1) {
    out.push(RESOURCE_ORDER.filter((_, i) => (bits & (1 << i)) !== 0));
  }
  return out;
}

/**
 * The engine's own rule, written out independently of the client's helper, from
 * `reduce.ts`. If the two ever disagree, this is the one that is right.
 */
function engineCharges(
  cost: Partial<Record<Resource, number>>,
  discounts: readonly Resource[],
  surcharge: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of RESOURCE_ORDER) {
    const n = cost[r] ?? 0;
    if (n <= 0) continue;
    out[r] = n;
  }
  // "A surcharge is added AFTER Helping Hands, and that ordering is a ruling."
  for (const r of discounts) {
    const have = out[r] ?? 0;
    if (have <= 0) continue;
    out[r] = have - 1;
  }
  for (const r of Object.keys(out)) {
    const n = out[r] ?? 0;
    if (n <= 0) delete out[r];
  }
  if (surcharge > 0) out.funds = (out.funds ?? 0) + surcharge;
  return out;
}

// ─────────────────────────── 1. the mirror, and its source ───────────────────────────

describe('marketCharge is a mirror of the engine, and the engine is the one that is right', () => {
  const CARDS: readonly Partial<Record<Resource, number>>[] = [
    { funds: 2, trust: 2 },
    { funds: 1 },
    { trust: 3 },
    { funds: 2, clout: 1, media: 1, trust: 1 },
    {},
  ];

  it('agrees with reduce.ts INFLUENCE for every discount combination and surcharge', () => {
    for (const cost of CARDS) {
      const marketSlot = slot(cost);
      for (const discounts of everyCombination()) {
        for (const surcharge of [0, 1, 2, 3]) {
          const state = table({ ...ZERO, funds: 9 }, [marketSlot], [
            { kind: 'surcharge', value: surcharge },
          ]);
          expect(marketCharge(state, ME, marketSlot, discounts)).toEqual(
            engineCharges(cost, discounts, surcharge),
          );
        }
      }
    }
  });

  it('takes the surcharge from the player, and only from that player', () => {
    const marketSlot = slot({ funds: 2, trust: 2 });
    const taxed = table({ ...ZERO, funds: 9 }, [marketSlot], [{ kind: 'surcharge', value: 2 }]);
    const clean = table({ ...ZERO, funds: 9 }, [marketSlot], []);
    expect(surchargeOf(taxed, ME)).toBe(2);
    expect(surchargeOf(clean, ME)).toBe(0);
    expect(marketCharge(taxed, ME, marketSlot)).toEqual({ funds: 4, trust: 2 });
    expect(marketCharge(clean, ME, marketSlot)).toEqual({ funds: 2, trust: 2 });
    // A seat that is not in the game has no surcharge rather than a crash.
    expect(surchargeOf(taxed, 'p9' as PlayerID)).toBe(0);
  });

  it('sums two surcharges, because two cards mean two', () => {
    const marketSlot = slot({ funds: 1 });
    const state = table({ ...ZERO, funds: 9 }, [marketSlot], [
      { kind: 'surcharge', value: 2 },
      { kind: 'surcharge', value: 1 },
      { kind: 'no-power', value: 99 },
    ]);
    expect(surchargeOf(state, ME)).toBe(3);
    expect(marketCharge(state, ME, marketSlot)).toEqual({ funds: 4 });
  });

  it('never waives a denomination the card does not charge, and never goes below zero', () => {
    // "a Helping Hands use is spent whether or not it buys anything" — so a discount
    // on an absent resource is spent and gains nothing. The engine's `discount`
    // returns the cost unchanged when the resource is not on it.
    expect(applyDiscounts({ funds: 2 }, ['trust', 'media', 'clout'])).toEqual({ funds: 2 });
    expect(applyDiscounts({ funds: 1 }, ['funds'])).toEqual({});
  });

  it('the engine still charges discounts-then-surcharge, so this mirror cannot rot', () => {
    // Read the engine's own source. If INFLUENCE stops pricing this way, the client
    // copy above is a second rule and this test is what says so.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', '..', '..', 'engine', 'src', 'reduce.ts'), 'utf8');
    const influence = src.slice(src.indexOf("case 'INFLUENCE'"), src.indexOf("case 'POWER_PROSPECT'"));
    expect(influence).toContain('applyDiscounts(slot.cost, discounts)');
    expect(influence).toMatch(/discounted\.funds \?\? 0\) \+ surcharge/);
    expect(influence).toContain('canAfford(self.resources, cost)');
  });
});

// ─────────────── 2. the printed price IS the charged price ───────────────

describe('the numerals on the card are the numerals the engine charges', () => {
  const COST: Partial<Record<Resource, number>> = { funds: 2, clout: 1, media: 2, trust: 2 };

  /**
   * Pull the chargeable numerals back out of the rendered string.
   *
   * The waivers are annotations, not amounts, and the tax is printed as `+N Funds tax`
   * rather than as a bare number, so both are excluded here and asserted
   * separately. Everything left is a price the player will be charged.
   */
  function printedNumbers(text: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const part of text.split('·')) {
      const seg = part.trim();
      const tax = /^\+(\d+) Funds tax$/.exec(seg);
      if (tax) {
        out.funds = (out.funds ?? 0) + Number(tax[1]);
        continue;
      }
      const m = /^(\d+) ([FCMT])/.exec(seg);
      if (m) {
        const r = { F: 'funds', C: 'clout', M: 'media', T: 'trust' }[m[2] as 'F'] as Resource;
        out[r] = (out[r] ?? 0) + Number(m[1]);
      }
    }
    return out;
  }

  it('for every discount combination the printed total equals the charged total', () => {
    for (const discounts of everyCombination()) {
      for (const surcharge of [0, 1, 2]) {
        const marketSlot = slot(COST);
        const state = table({ ...ZERO, funds: 12 }, [marketSlot], [
          { kind: 'surcharge', value: surcharge },
        ]);
        const { unmount } = render(
          <MarketStrip
            state={state}
            you={ME}
            disabled={false}
            disabledReason={null}
            armed={{ slot: 0, discounts }}
            onBuy={() => undefined}
          />,
        );
        const text = screen.getByTestId('market-charge').textContent ?? '';
        expect({ discounts: discounts.join('+'), surcharge, printed: printedNumbers(text) }).toEqual({
          discounts: discounts.join('+'),
          surcharge,
          printed: engineCharges(COST, discounts, surcharge),
        });
        unmount();
      }
    }
  });

  it('a waived denomination that goes to zero says "waived" rather than printing a lie', () => {
    const state = table({ ...ZERO, funds: 12 }, [slot({ funds: 1, trust: 1 })]);
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={{ slot: 0, discounts: ['funds', 'trust'] }}
        onBuy={() => undefined}
      />,
    );
    const text = screen.getByTestId('market-charge').textContent ?? '';
    expect(text).toContain('Funds waived');
    expect(text).toContain('Trust waived');
    expect(printedNumbers(text)).toEqual({});
    unmount();
  });

  it('a partial waiver prints the reduced price AND the denomination that is waived', () => {
    const state = table({ ...ZERO, funds: 12 }, [slot({ funds: 3 })]);
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={{ slot: 0, discounts: ['funds'] }}
        onBuy={() => undefined}
      />,
    );
    const text = screen.getByTestId('market-charge').textContent ?? '';
    expect(printedNumbers(text)).toEqual({ funds: 2 });
    expect(text).toContain('2 Funds (waived)');
    unmount();
  });

  it('names the tax, because a price larger than the sticker with no reason is the bug', () => {
    const state = table({ ...ZERO, funds: 12 }, [slot({ funds: 2 })], [
      { kind: 'surcharge', value: 2 },
    ]);
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    const text = screen.getByTestId('market-charge').textContent ?? '';
    expect(text).toContain('+2 Funds tax');
    expect(printedNumbers(text)).toEqual({ funds: 4 });
    unmount();
  });
});

// ─────────────── 3. never live when the engine would refuse ───────────────

describe('the strip is live exactly when the engine would accept', () => {
  const COST: Partial<Record<Resource, number>> = { funds: 2, trust: 2 };

  function canAffordPool(pool: Pool, cost: Record<string, number>): boolean {
    return RESOURCE_ORDER.every((r) => pool[r] >= (cost[r] ?? 0));
  }

  it('holds for every pool, every discount combination and every surcharge', () => {
    const POOLS: readonly Pool[] = [
      { funds: 0, clout: 0, media: 0, trust: 0 },
      { funds: 1, clout: 0, media: 0, trust: 1 },
      { funds: 1, clout: 0, media: 0, trust: 3 },
      { funds: 2, clout: 0, media: 0, trust: 2 },
      { funds: 3, clout: 0, media: 0, trust: 2 },
      { funds: 12, clout: 12, media: 12, trust: 12 },
    ];
    for (const pool of POOLS) {
      for (const discounts of everyCombination()) {
        for (const surcharge of [0, 1, 2]) {
          const marketSlot = slot(COST);
          const state = table(pool, [marketSlot], [{ kind: 'surcharge', value: surcharge }]);
          const { unmount } = render(
            <MarketStrip
              state={state}
              you={ME}
              disabled={false}
              disabledReason={null}
              armed={{ slot: 0, discounts }}
              onBuy={() => undefined}
            />,
          );
          const live = screen.getByTestId('market-card').hasAttribute('disabled') === false;
          expect({
            pool: `${pool.funds}/${pool.trust}`,
            discounts: discounts.join('+') || 'none',
            surcharge,
            live,
          }).toEqual({
            pool: `${pool.funds}/${pool.trust}`,
            discounts: discounts.join('+') || 'none',
            surcharge,
            live: canAffordPool(pool, engineCharges(COST, discounts, surcharge)),
          });
          unmount();
        }
      }
    }
  });

  it('THE REPORTED CASE, with the tax: sticker affordable, purchase not', () => {
    // A `2 clout · 2 trust` card, which charges NO funds at all, and a pool with
    // exactly the funds the card's sticker asks for and one less than the tax adds.
    // The old strip read the sticker, said affordable, and the engine refused with a
    // toast saying the player could not afford a card whose printed price they could
    // afford. Here the tax is the ONLY reason the purchase fails.
    const marketSlot = slot({ clout: 2, trust: 2 });
    const state = table({ funds: 1, clout: 2, media: 0, trust: 2 }, [marketSlot], [
      { kind: 'surcharge', value: 2 },
    ]);
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    const card = screen.getByTestId('market-card');
    expect(card.hasAttribute('disabled')).toBe(true);
    expect(card.textContent).toContain('1 funds short');
    expect(screen.getByTestId('market-charge').textContent).toContain('+2 Funds tax');
    // …and one more Fund and it is live, which is what makes it a plan and not a wall.
    unmount();
    const richer = table({ funds: 2, clout: 2, media: 0, trust: 2 }, [marketSlot], [
      { kind: 'surcharge', value: 2 },
    ]);
    const second = render(
      <MarketStrip
        state={richer}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    expect(screen.getByTestId('market-card').hasAttribute('disabled')).toBe(false);
    second.unmount();
  });

  it('and the lockout sentence is about the charged price, not the sticker', () => {
    // A pool that affords the cheapest card's PRINTED cost and nothing more. The
    // sentence has to name the number the engine will actually charge, or it is a
    // plan that does not work.
    const state = table(
      { funds: 2, clout: 0, media: 0, trust: 0 },
      [slot({ funds: 2 }), slot({ funds: 5 })],
      [{ kind: 'surcharge', value: 1 }],
    );
    const lock = marketLockout(state, ME);
    expect(lock).not.toBeNull();
    expect(lock?.cheapest).toEqual({ funds: 3 });
    expect(lock?.short).toEqual({ funds: 1 });
    expect(lock?.sentence).toContain('costs 3 funds');
    expect(lock?.sentence).toContain('1 funds short');
    expect(lock?.sentence).toContain('taxing every purchase');
  });

  it('a taxed player who CAN afford a card gets no lockout at all', () => {
    const state = table({ funds: 3, clout: 0, media: 0, trust: 0 }, [slot({ funds: 2 })], [
      { kind: 'surcharge', value: 1 },
    ]);
    expect(marketLockout(state, ME)).toBeNull();
  });
});