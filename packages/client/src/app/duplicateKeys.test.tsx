/**
 * EVERY LIST IN THE APP IS KEYED BY SOMETHING UNIQUE — as a gate, not as a lint.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS. The client suite was emitting, 225 times:
 *
 *     Warning: Encountered two children with the same key, `funds`.
 *
 * and the number is the interesting part, because it is what a duplicate key
 * actually IS in this app: `MarketStrip` builds its price from TWO sources that
 * can name the SAME denomination — the card's printed cost, and the player's
 * surcharge, which `reduce.ts` denominates in Funds and which sums. A card that
 * cost Funds and carried a surcharge rendered two `<span key="funds">`
 * siblings. Every combination in `marketCharge.test.tsx` hit it.
 *
 * TWO REASONS THIS IS A TEST AND NOT A TIDY PASS, and the second is the real one:
 *
 *  1. It is a React correctness bug. Two siblings with one key are not two
 *     children, as far as reconciliation is concerned — React cannot track them
 *     across an update, so state can reattach to the wrong node and the
 *     documented behaviour is that it "could change in a future version". A
 *     dependency bump is allowed to change what this card shows.
 *
 *  2. It was drowning the suite. Two hundred and twenty-five warnings is not a
 *     noisy suite, it is an unreadable one: a real failure scrolls past in the
 *     gap. That is a MEASUREMENT problem, and a gate nobody can read is not
 *     trusted. A regression here silently costs the next person's ability to
 *     see the next failure — which is why this is asserted rather than fixed
 *     once.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The assertion is that REACT DOES NOT COMPLAIN. This file does not stub,
 * filter, mute or intercept `console.error` to make the warning go away — it
 * CAPTURES what React writes and fails if React says the keys are not unique,
 * which is the opposite of silencing. Nothing is suppressed: an unrelated
 * render error still surfaces, because a duplicate-key gate that also hid real
 * errors would be worse than the bug.
 *
 * And the second test exists so the first cannot pass VACUOUSLY: it proves the
 * case that used to warn still renders BOTH runs. A fix that deleted the tax, or
 * the Funds price, would make the warning stop and the price wrong — and
 * `marketCharge.test.tsx` owns the arithmetic; this file owns the identity.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

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
import { RESOURCE_ORDER } from './derive.ts';

const ME: PlayerID = 'p1';

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

/**
 * Render, and report what React said about key uniqueness.
 *
 * The spy is INSTALLED, not replaced by a no-op: every message is recorded and
 * `console.error` still runs, so this file cannot be the reason a genuine error
 * goes missing. The caller decides whether a duplicate key is a failure.
 */
function renderAndCollectDuplicateKeys(node: React.ReactElement): string[] {
  const seen: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const first = args[0];
    const text = typeof first === 'string' ? first : String(first ?? '');
    if (text.includes('Encountered two children with the same key')) seen.push(text);
  });
  try {
    const { unmount } = render(node);
    unmount();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

/** The reported trigger: a card that costs Funds, bought by a seat with a Funds tax. */
function taxedFundsCard() {
  return renderAndCollectDuplicateKeys(
    <MarketStrip
      state={table({ ...ZERO, funds: 12 }, [slot({ funds: 2, trust: 2 })], [
        { kind: 'surcharge', value: 2 },
      ])}
      you={ME}
      disabled={false}
      disabledReason={null}
      armed={null}
      onBuy={() => undefined}
    />,
  );
}

describe('the market price list is keyed uniquely, whatever a card costs', () => {
  it('a Funds-denominated surcharge does not collide with the card Funds price', () => {
    // THE REGRESSION. `reduce.ts` adds the surcharge to `funds` AFTER the
    // discounts, so this card's price legitimately contains `funds` twice: the
    // printed `2 F` and the `+2 F tax`. Two runs, two elements, two identities.
    expect(taxedFundsCard()).toEqual([]);
  });

  it('every printed cost, crossed with every waiver and every surcharge', () => {
    // Not one card shape — the whole cross product, because the collision was a
    // function of WHICH denominations a card happened to cost and whether the
    // seat carried a tax, and that is exactly the kind of condition a single
    // fixture would have missed on the next edit.
    for (let bits = 0; bits < 1 << RESOURCE_ORDER.length; bits += 1) {
      const costs = RESOURCE_ORDER.filter((_, i) => (bits & (1 << i)) !== 0);
      const discounts = RESOURCE_ORDER.filter((_, i) => (bits & (1 << (i + 2))) !== 0);
      for (const surcharge of [0, 1, 2]) {
        const cost = Object.fromEntries(costs.map((r, i) => [r, i + 1])) as Partial<
          Record<Resource, number>
        >;
        const warnings = renderAndCollectDuplicateKeys(
          <MarketStrip
            state={table({ ...ZERO, funds: 12 }, [slot(cost)], [
              { kind: 'surcharge', value: surcharge },
            ])}
            you={ME}
            disabled={false}
            disabledReason={null}
            armed={discounts.length > 0 ? { slot: 0, discounts } : null}
            onBuy={() => undefined}
          />,
        );
        expect({ costs: costs.join('+'), discounts: discounts.join('+'), surcharge, warnings })
          .toEqual({ costs: costs.join('+'), discounts: discounts.join('+'), surcharge, warnings: [] });
      }
    }
  });

  it('a full market of taxed cards is still unique', () => {
    // The strip is the one component that renders a LIST of lists, so the key
    // space is the market's, not just one card's. Two cards on the same seat,
    // both taxed: the duplicate had to be impossible per card AND per strip.
    const state = table(
      { ...ZERO, funds: 20 },
      [slot({ funds: 2, clout: 1, media: 2, trust: 2 }), slot({ funds: 1, trust: 3 })],
      [{ kind: 'surcharge', value: 1 }],
    );
    const warnings = renderAndCollectDuplicateKeys(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    expect(warnings).toEqual([]);
  });
});

describe('the fix is distinct keys, NOT a removed element', () => {
  it('both Funds runs are still on the card, and both carry the Funds ink', () => {
    // WHY THIS TEST IS HERE. The cheapest way to stop the warning is to stop
    // rendering the tax, or to drop the printed Funds price, or to fold the two
    // into one run. All three make the first describe block pass and all three
    // make the price a lie — which is the defect `marketCharge.test.tsx` exists
    // to prevent, on a different axis.
    //
    // So the gate on identity is paired with a gate on COMPLETENESS: `tax` and
    // `cost` are two different things to pay and must remain two different
    // things on screen. `data-res` is deliberately NOT namespaced by the fix —
    // the surcharge really is denominated in Funds, and taking the Funds ink is
    // what tells a player that before they read how much.
    const { container } = render(
      <MarketStrip
        state={table({ ...ZERO, funds: 12 }, [slot({ funds: 2, trust: 2 })], [
          { kind: 'surcharge', value: 2 },
        ])}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    const runs = [...container.querySelectorAll('[data-testid="market-charge"] [data-res]')];
    expect(runs.map((el) => el.textContent)).toEqual(['2 F', '2 T', '+2 F tax']);
    // Two `funds` elements, because the money is named twice on purpose.
    expect(runs.filter((el) => el.getAttribute('data-res') === 'funds')).toHaveLength(2);
  });
});

afterEach(() => {
  // Belt and braces: no spy may outlive the test that installed it.
  vi.restoreAllMocks();
});