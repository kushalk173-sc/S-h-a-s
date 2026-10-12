/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE ENDGAME IS LEGIBLE: A PLAYER WHO CANNOT BUY ANYTHING IS TOLD WHY
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## WHAT WAS REPORTED, AND IT WAS NOT A BUG
 *
 * A tester measured off the DOM of a real game and reported:
 *
 *   - the board had **32-44 free slots**;
 *   - two of three seats had `afford = 0` on all three market cards;
 *   - every one of those seats read `0 funds 0 clout 12 media 12 trust`, which the
 *     mat printed as **`12/12 held`**;
 *   - and the tester concluded the game was over and the table was stuck.
 *
 * Every number in that report is correct. The conclusion is the design failure, and
 * it is worth being exact about why, because the fix is not "show more numbers":
 *
 *   - `12/12 held` says FULL. Full is indistinguishable from WINNING on this mat,
 *     because the mat reports a resource COUNT and the constraint is about a
 *     resource KIND.
 *   - the constraint is real and hard. **10 of the 18 Voter Cards cost Funds and 7
 *     cost Clout** — a pool of Media and Trust reaches none of them, and a resource
 *     is a key to specific cards and nothing else. So a full pool of the wrong two
 *     denominations can have *no legal purchase at all*.
 *   - and it does not resolve by itself: the only income is your Ideology Card's
 *     payout and the powers, so relief is a turn away at best — while the next
 *     resource taken comes straight back as a discard, because `enforceCap` fires
 *     the moment the pool crosses the cap. **At the cap, the first resource you take
 *     has to be given straight back.** That sentence was nowhere on screen, and it
 *     is the whole of the endgame.
 *
 * So this file asserts two separable things, and the second is the one that was
 * actually missing:
 *
 *   1. `marketLockout` is CORRECT — null when anything is affordable, and the
 *      cheapest card's exact shortfall when nothing is;
 *   2. the SENTENCE REACHES THE PLAYER, in the market panel, beside the three cards
 *      they cannot press. A derivation nothing renders is not a fix, and that is
 *      the failure mode of half the legibility work this project has done.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
// TYPE-ONLY. See `derive.ts`'s header: the secret gate scans this directory whole.
import type { ClientState, MarketSlot, PlayerID, PlayerState, Pool } from '@shasn/engine';

import { MarketPanel, PowersTray, ResourceStrip } from './YourMat.tsx';
import { UI_RULES, canAfford, marketLockout, overCap } from './derive.ts';

const ME: PlayerID = 'p1';
const THEM: PlayerID = 'p2';

/**
 * THE EXACT POOL FROM THE REPORT — and read it carefully, because it is the whole
 * point. The DOM read
 *
 *     YOUR MAT 0 funds 0 clout 0 media 12 trust 12/12 held
 *
 * so the pool is `0 / 0 / 0 / 12`: **exactly at the cap**, a full twelve, in ONE
 * denomination — and not one of the two that 17 of the 18 Voter Cards are priced in.
 * There is no overflow here and no shortage. Every number on that mat is correct and
 * the mat is a dead end.
 */
const REPORTED: Pool = { funds: 0, clout: 0, media: 0, trust: 12 };
const EMPTY: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

function seat(id: PlayerID, pool: Pool, manifesto: readonly string[] = []): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    colour: '#fff',
    resources: pool,
    manifesto: [...manifesto],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
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

const slot = (cost: Partial<Record<string, number>>, voters = 3): MarketSlot =>
  ({ cardId: `v-${Object.keys(cost).join('-')}`, cost, voters }) as unknown as MarketSlot;

function table(pool: Pool, market: readonly MarketSlot[]): ClientState {
  return {
    players: { [ME]: seat(ME, pool), [THEM]: seat(THEM, EMPTY) },
    turnOrder: [ME, THEM],
    activePlayer: ME,
    phase: 'actions',
    turn: 200,
    round: 40,
    finished: false,
    market,
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices: [],
    log: [],
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
    zones: [],
  } as unknown as ClientState;
}

/** THE REPORTED MARKET: every card costs Funds or Clout, none of which is held. */
const FUNDS_AND_CLOUT_ONLY: readonly MarketSlot[] = [
  slot({ funds: 3, clout: 2 }),
  slot({ funds: 2, media: 1 }),
  slot({ clout: 4 }),
];

describe('the endgame: nothing affordable is a STATE, and it says so', () => {
  it('the reported pool is full, over nothing, and cannot buy anything — and all three are named', () => {
    // The arithmetic first, because the whole complaint is that these three facts
    // look like ONE fact on screen. `12/12 held` is TRUE, so is "cannot buy
    // anything", and neither implies the other.
    const state = table(REPORTED, FUNDS_AND_CLOUT_ONLY);
    expect(
      overCap(REPORTED, UI_RULES.resourceCap),
      'the reported pool is AT the cap, not over it — that is why nothing forced a discard',
    ).toBe(0);
    for (const s of FUNDS_AND_CLOUT_ONLY) {
      expect(canAfford(REPORTED, s.cost), 'the fixture must be genuinely unaffordable').toBe(false);
    }
    // And the mat's fraction, which is what the tester read.
    const strip = render(<ResourceStrip pool={REPORTED} />);
    expect(strip.container.textContent ?? '').toContain('12/12 held');
    // …and the caption now says FULL rather than leaving it to be inferred from a
    // fraction that reads like a healthy one.
    const caption = strip.container.querySelector('[data-testid=meter-caption]')?.textContent ?? '';
    expect(caption, 'the mat does not name the full state').toMatch(/at your cap of 12/i);
    expect(
      caption,
      'the mat does not say the next resource comes straight back',
    ).toMatch(/comes back as a discard/);
    strip.unmount();
  });

  it('the sentence NAMES the cheapest card and the exact shortfall, not "you cannot buy"', () => {
    const lock = marketLockout(table(REPORTED, FUNDS_AND_CLOUT_ONLY), ME);
    expect(lock, 'the reported pool produced no lockout').not.toBeNull();
    if (lock === null) return;
    // Cheapest by TOTAL cost: `funds 2, media 1` totals 3, `clout 4` totals 4, and
    // `funds 3, clout 2` totals 5. The point of naming one is that the player gets
    // ONE number to go and earn, not three.
    expect(lock.cheapest).toEqual({ funds: 2, media: 1 });
    expect(
      lock.short,
      'the shortfall is not computed against the cheapest card',
    ).toEqual({ funds: 2, media: 1 });
    expect(lock.sentence).toContain('Nothing on the HQ Mat is affordable');
    expect(lock.sentence).toContain('2 funds');
    expect(lock.sentence).toContain('1 media');
    // …and it says where relief comes from, which is the actionable half. NOT the
    // cap clause: this pool is AT the cap, so the honest statement is about the
    // market and about earning, and the two are kept apart rather than blurred.
    expect(lock.overCap, 'the reported pool is AT the cap and must not be called over it').toBe(false);
    expect(lock.sentence).not.toMatch(/over your cap/);
    expect(lock.sentence).toMatch(/Ideology Card/);
  });

  it('a pool genuinely OVER the cap gets the other clause: the next gain is a discard', () => {
    // The sibling case, and it is a different sentence rather than a louder one. At
    // 24 against a cap of 12 the market lockout gains a clause the at-cap case must
    // NOT print, because "you are over your cap" is false of a player sitting on it.
    const over: Pool = { funds: 0, clout: 0, media: 0, trust: 24 };
    expect(overCap(over, UI_RULES.resourceCap)).toBe(12);
    const lock = marketLockout(table(over, FUNDS_AND_CLOUT_ONLY), ME);
    expect(lock).not.toBeNull();
    if (lock === null) return;
    expect(lock.overCap).toBe(true);
    expect(lock.sentence).toMatch(/over your cap of 12/);
    expect(lock.sentence).toMatch(/straight back as a discard/);
    // And the mat says OVER rather than AT for the same pool.
    const strip = render(<ResourceStrip pool={over} />);
    expect(strip.container.querySelector('[data-testid=meter-caption]')?.textContent ?? '').toMatch(
      /over your cap of 12/i,
    );
    strip.unmount();
  });

  it('says NOTHING when a purchase exists — a permanent warning is a warning nobody reads', () => {
    expect(
      marketLockout(table(REPORTED, [...FUNDS_AND_CLOUT_ONLY, slot({ trust: 2 })]), ME),
      'a lockout was reported while a Trust-priced card was affordable',
    ).toBeNull();
    // Funds alone are not enough either — the fixture's cards all also want Clout or
    // Media, and holding half the price is still a lockout. Asserted because "short
    // on SOME denominations" is exactly the reported state's shape, and a lockout
    // test that only ever checked an empty pool would pass on a predicate that
    // ignored half the cost.
    expect(marketLockout(table({ ...REPORTED, funds: 5 }, FUNDS_AND_CLOUT_ONLY), ME)).not.toBeNull();
    // …and the same market with a full purse is not a lockout at all.
    expect(
      marketLockout(
        table({ funds: 9, clout: 9, media: 9, trust: 9 }, FUNDS_AND_CLOUT_ONLY),
        ME,
      ),
    ).toBeNull();
    // An empty mat is not a lockout; it is an empty mat.
    expect(marketLockout(table(REPORTED, []), ME)).toBeNull();
    // …and the seat holding nothing at all is locked out too, which is the state the
    // very first dead `gain-any` dialog was found in.
    expect(marketLockout(table(EMPTY, FUNDS_AND_CLOUT_ONLY), ME)).not.toBeNull();
  });

  it('THE REACHABILITY TEST: the sentence is on the panel, next to the cards it explains', () => {
    // A derivation nothing renders is not a fix. This is the assertion that failed
    // for every legibility change this project has made that stopped at the maths.
    const r = render(
      <MarketPanel
        state={table(REPORTED, FUNDS_AND_CLOUT_ONLY)}
        you={ME}
        disabled={false}
        disabledReason={null}
        onBuy={() => undefined}
        onBuyConspiracy={() => undefined}
        playableConspiracies={[]}
        onPlayConspiracy={() => undefined}
        armed={null}
      />,
    );
    const said = r.container.querySelector('[data-testid=market-lockout]');
    expect(said, 'the panel does not render the lockout').not.toBeNull();
    expect(said?.textContent ?? '').toContain('Nothing on the HQ Mat is affordable');
    // …as a live region, so a screen-reader user is told when it appears rather than
    // finding it by exploring the panel.
    expect(said?.getAttribute('role'), 'the lockout is not announced').toBe('status');
    // …and it is INSIDE the market panel, after the cards, so it is adjacent to the
    // controls it explains (§9.2).
    expect(r.container.querySelector('[data-testid=market-panel]')).not.toBeNull();
    const panel = r.container.querySelector('[data-testid=market-panel]') as HTMLElement;
    expect(panel.contains(said as Node)).toBe(true);
    expect(r.container.querySelectorAll('[data-testid=market-card]')).toHaveLength(3);
    r.unmount();
  });

  it('at the cap but NOT over it, the caption is AT — never OVER', () => {
    // The reported state is exactly this one, and the two captions are different
    // sentences rather than one sentence at two volumes. "OVER your cap of 12" on a
    // player holding 12 would be a lie the player can check in half a second.
    const strip = render(<ResourceStrip pool={{ funds: 4, clout: 4, media: 2, trust: 2 }} />);
    const caption = strip.container.querySelector('[data-testid=meter-caption]')?.textContent ?? '';
    expect(strip.container.textContent ?? '').toContain('12/12 held');
    expect(caption).toMatch(/at your cap of 12/i);
    expect(caption, 'a player ON the cap is told they are OVER it').not.toMatch(/over your cap/i);
    strip.unmount();
  });
});

describe('item 2 — an unavailable control LOOKS unavailable, and says which it is', () => {
  const panel = (disabled: boolean, reason: string | null) =>
    render(
      <MarketPanel
        state={table({ funds: 9, clout: 9, media: 9, trust: 9 }, [slot({ funds: 1 }), slot({ funds: 2 }), slot({ funds: 3 })])}
        you={ME}
        disabled={disabled}
        disabledReason={reason}
        onBuy={() => undefined}
        onBuyConspiracy={() => undefined}
        playableConspiracies={[]}
        onPlayConspiracy={undefined as unknown as () => void}
        armed={null}
      />,
    );

  it('a card that is not yours to press is HATCHED, not merely unclickable', () => {
    // The reported defect: `mkt--unavail` was gated on `!afford` alone, so on every
    // seat but the active one the three cards looked identical to live ones — same
    // fill, same ink, no affordance — while being unpressable. A player had no way to
    // tell "not my turn" from "I cannot afford this".
    const live = panel(false, null);
    const liveCard = live.container.querySelector('[data-testid=market-card]') as HTMLElement;
    expect((liveCard as HTMLButtonElement).disabled, 'the fixture card is not affordable at 9 funds').toBe(false);
    expect(liveCard.className, 'an affordable card is marked unavailable').not.toContain('mkt--unavail');
    live.unmount();

    const inert = panel(true, 'Waiting for P2 — your powers and the HQ Mat come alive on your turn.');
    const card = inert.container.querySelector('[data-testid=market-card]') as HTMLElement;
    expect((card as HTMLButtonElement).disabled).toBe(true);
    expect(
      card.className,
      "a card that is merely another seat's turn does not LOOK unavailable",
    ).toContain('mkt--unavail');
    // …and the reason is on the card, adjacent to it (§9.2).
    const why = inert.container.querySelector('[data-testid=market-inert]');
    expect(why, 'the reason is not adjacent to the control').not.toBeNull();
    expect(why?.textContent ?? '').toContain('Waiting for P2');
    inert.unmount();
  });

  it('the two reasons do not collide: not-my-turn is not not-affordable', () => {
    // Both render `.mkt__short`, and the wrong one appearing would be a lie. The
    // inert reason is suppressed the moment the panel is live, and the shortfall is
    // suppressed per-card when there is none.
    const rich = table({ funds: 1, clout: 9, media: 9, trust: 9 }, [slot({ funds: 3 }), slot({ funds: 0 })]);
    const r = render(
      <MarketPanel
        state={rich}
        you={ME}
        disabled={false}
        disabledReason={null}
        onBuy={() => undefined}
        onBuyConspiracy={() => undefined}
        playableConspiracies={[]}
        onPlayConspiracy={() => undefined}
        armed={null}
      />,
    );
    expect(r.container.querySelector('[data-testid=market-inert]')).toBeNull();
    const shorts = [...r.container.querySelectorAll('.mkt__short')].map((n) => n.textContent ?? '');
    expect(shorts.join(' '), 'a shortfall appeared on the FREE card').toContain('2 funds short');
    r.unmount();
  });

  it('the powers tray names its own inertness too — "3 of 3 left" with no reason is item 3', () => {
    const rich = seat(ME, { funds: 4, clout: 4, media: 4, trust: 4 }, [
      'capitalist',
      'capitalist',
      'capitalist',
      'capitalist',
      'capitalist',
    ]);
    const state = { players: { [ME]: rich, [THEM]: seat(THEM, EMPTY) } } as unknown as ClientState;
    const r = render(
      <PowersTray
        state={state}
        you={ME}
        disabled
        disabledReason="Waiting for P2 — your powers and the HQ Mat come alive on your turn."
        onPower={() => undefined}
      />,
    );
    // Unlocked (Capitalist 5 ≥ 3), uses left, and unpressable: the exact reported
    // shape. The reason is now on the tray.
    const landGrab = r.container.querySelector('[data-testid=power-land-grab]') as HTMLElement;
    expect(landGrab.textContent ?? '').toContain('3 of 3 left');
    expect((landGrab as HTMLButtonElement).disabled, 'the fixture power is pressable').toBe(true);
    const why = r.container.querySelector('[data-testid=powers-inert]');
    expect(why, 'the powers tray does not name its own inertness').not.toBeNull();
    expect(why?.textContent ?? '').toContain('Waiting for P2');
    // …and a LOCKED power still names its own requirement rather than the turn's
    // excuse, because those are different facts and the player has to aim at one.
    expect(r.container.querySelector('[data-testid=power-tough-love]')?.textContent ?? '').toContain(
      'Unlocks at Idealist 5',
    );
    r.unmount();
  });
});
