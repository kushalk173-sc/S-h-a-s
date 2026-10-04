/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE POWER CHOOSER MUST NOT OFFER A CARD THE PLAYER CAN NEVER BUY
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## WHAT WAS FOUND, IN A BROWSER, ON A REAL TABLE
 *
 * Helping Hands was armed on a `2 media` card against a pool holding no media.
 * Arming is free and local — `reduce.ts` takes `viral` and `discounts` as fields
 * on `INFLUENCE`, so nothing is spent until the card is bought — so the sheet
 * happily took the click. The market panel then said, truthfully:
 *
 *     1 M (waived) ◈ 1 — 11 media short
 *
 * …and the note under the strip said *"Buy that card to spend it, or press the
 * power again to cancel."* About a card that cannot be bought. The player had a
 * dead power and a sentence telling them to spend it.
 *
 * The chooser listed three cards and refused none of them, which makes it a
 * control that leads nowhere: four instances of this class, in one component.
 *
 * ## THE BAR, AND WHY IT IS THE BEST CASE
 *
 * Helping Hands waives at most one of each denomination the card charges, so a
 * card unaffordable **even with every one of them waived** can never be bought
 * with this power on it. Anything affordable at the sticker price is affordable
 * under the best case too, so the rule refuses nothing that could have worked —
 * it only refuses the cards whose purchase is impossible, and it says which and
 * why on the button rather than leaving a mystery.
 *
 * Going Viral waives nothing, so its best case is the sticker price, and the same
 * comparison does the job with no second rule.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ClientState, MarketSlot, PlayerID, PlayerState, Pool, Resource } from '@shasn/engine';

import { MarketModifierDialog } from './PowerDialog.tsx';

const ME: PlayerID = 'p1';

const slot = (cost: Partial<Record<Resource, number>>, voters: number): MarketSlot =>
  ({ cardId: `v-${voters}-${JSON.stringify(cost)}`, cost, voters }) as unknown as MarketSlot;

function table(pool: Pool, market: readonly MarketSlot[]): ClientState {
  const me = {
    id: ME,
    name: 'ME',
    colour: '#fff',
    resources: pool,
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
    pending: [],
    powerUses: {
      prospecting: 0, landGrab: 0, donations: 0, payback: 0,
      goingViral: 0, helpingHands: 0, toughLove: 0, gerrymandered: {},
    },
    isBot: false,
  } as unknown as PlayerState;
  return {
    players: { [ME]: me },
    market,
    turnOrder: [ME],
    activePlayer: ME,
    phase: 'actions',
    turn: 3,
    zones: [],
  } as unknown as ClientState;
}

const POOL: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

function open(power: 'going-viral' | 'helping-hands', pool: Pool, market: readonly MarketSlot[]) {
  const onArm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <MarketModifierDialog state={table(pool, market)} you={ME} power={power} left={2} onArm={onArm} onCancel={onCancel} />,
  );
  return { ...utils, onArm, onCancel };
}

const slotButtons = () => screen.getAllByTestId('market-power-slot') as HTMLButtonElement[];
/** The first chooser button, or a loud failure — an absent one is not a result. */
const firstSlot = (): HTMLButtonElement => {
  const b = slotButtons()[0];
  if (b === undefined) throw new Error('the chooser offered no cards at all');
  return b;
};
const btn = (testid: string): HTMLButtonElement => screen.getByTestId(testid) as HTMLButtonElement;
const isLive = (b: Element) =>
  !(b instanceof HTMLButtonElement && b.disabled === true) &&
  b.getAttribute('aria-disabled') !== 'true';

describe('the chooser never offers a purchase that cannot happen', () => {
  it('THE REPORTED CASE: Helping Hands on a card with no media in the pool', () => {
    const { unmount } = open('helping-hands', POOL, [slot({ media: 2 }, 1)]);
    expect(isLive(firstSlot())).toBe(false);
    // …and it says which resource and how much, rather than leaving a puzzle.
    expect(firstSlot().textContent).toContain('1 media short');
    unmount();
  });

  it('a card the player CAN pay for is still offered', () => {
    const { unmount, onArm } = open('going-viral', { funds: 5, clout: 0, media: 0, trust: 0 }, [
      slot({ funds: 2 }, 3),
    ]);
    const b = firstSlot();    expect(isLive(b)).toBe(true);
    fireEvent.click(b);
    // Step two, which is where the ARM lives.
    const arm = screen.getByTestId('market-power-arm');
    expect(isLive(arm)).toBe(true);
    fireEvent.click(arm);
    expect(onArm).toHaveBeenCalledWith(0, []);
    unmount();
  });

  it('Going Viral, which waives nothing, uses the sticker price as its bar', () => {
    const { unmount } = open('going-viral', { funds: 1, clout: 0, media: 0, trust: 0 }, [
      slot({ funds: 2 }, 3),
    ]);
    expect(isLive(firstSlot())).toBe(false);
    expect(firstSlot().textContent).toContain('1 funds short');
    unmount();
  });

  it('the BEST case is the bar, so a card payable only at full price is never refused', () => {
    // Helping Hands would take this from `2 funds` to `1 funds`, and the player has
    // `1`. Refusing it would be refusing a purchase that works.
    const { unmount } = open('helping-hands', { funds: 1, clout: 0, media: 0, trust: 0 }, [
      slot({ funds: 2 }, 3),
    ]);
    expect(isLive(firstSlot())).toBe(true);
    unmount();
  });

it('a 1-media card is FREE after the waiver, so it IS offered on an empty pool', () => {
    // The other direction, and the reason the bar is the best case rather than the
    // sticker price: Helping Hands takes `1 media` to nothing, so this purchase CAN
    // happen on an empty pool. A rule that priced the card at its sticker would have
    // refused a legal play — and refusing a legal play is the worse mistake of the
    // two, because it takes a power away from a player who earned it.
    const { unmount } = open('helping-hands', POOL, [slot({ media: 1 }, 2)]);
    expect(isLive(firstSlot())).toBe(true);
    expect(firstSlot().textContent).not.toContain('short');
    unmount();
  });

  it('a surcharge is part of the bar, because the engine adds it after the waiver', () => {
    const state = table({ funds: 3, clout: 0, media: 0, trust: 0 }, [slot({ funds: 3 }, 3)]);
    (state.players[ME] as unknown as { restrictions: unknown[] }).restrictions = [
      { kind: 'surcharge', value: 1 },
    ];
    const { unmount } = render(
      <MarketModifierDialog state={state} you={ME} power="going-viral" left={1} onArm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(isLive(firstSlot())).toBe(false);
    expect(firstSlot().textContent).toContain('1 funds short');
    unmount();
  });

  it('and when NOBODY can be bought it says so, instead of three dead options', () => {
    const { unmount, onCancel } = open('going-viral', POOL, [
      slot({ funds: 2 }, 1),
      slot({ clout: 1 }, 1),
      slot({ trust: 2 }, 1),
    ]);
    expect(screen.getByTestId('market-power-none').textContent).toContain('nothing to spend itself on');
    expect(slotButtons()).toHaveLength(3);
    for (const b of slotButtons()) expect(isLive(b)).toBe(false);
    // The way out is still there. Six instances of "no enabled control" so far.
    const cancel = screen.getByRole('button', { name: /CANCEL/i });
    expect(isLive(cancel)).toBe(true);
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
    unmount();
  });

  it('a FREE card is always offerable, waiver or not', () => {
    const { unmount } = open('going-viral', POOL, [slot({}, 1)]);
    expect(isLive(firstSlot())).toBe(true);
    unmount();
  });
});


