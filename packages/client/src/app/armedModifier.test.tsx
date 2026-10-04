/**
 * ═════════════════════════════════════════════════════════════════════════════
 * AN ARMED POWER HAS TO SURVIVE THE NEXT BROADCAST — IT USED TO DIE ON IT
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## WHAT WAS FOUND, IN A BROWSER, ON A REAL TABLE
 *
 * Going Viral was ARMED. The sheet said so in its own words:
 *
 *   "A power is armed on market card 1. Buy that card to spend it, or press the
 *    power again to cancel."
 *
 * And then the modifier was gone — dropped by the next `match:state` envelope,
 * from any seat, for any reason. The driver armed the same modifier thirty-odd
 * times in a row and could never get one to survive long enough to buy the card.
 *
 * ## WHY
 *
 * `reduce.ts` takes `viral` and `discounts` as **fields on `INFLUENCE`**: the
 * power is only spent when the card is bought. So a modifier that evaporates is a
 * power use that can never be spent, and Going Viral and Helping Hands — shipped,
 * wired, unit-tested, never once played — were unreachable in practice.
 *
 * The mechanism:
 *
 * ```ts
 * useEffect(() => { clearTurnInteraction(); }, [store.viewId, state?.turn]);
 * ```
 *
 * `store.viewId` is the sync ENVELOPE's counter (`net/protocol.ts`), so this runs
 * on **every `match:state` the server sends**, and `clearTurnInteraction` nulled
 * `marketModifier` and `pendingMarketPower`.
 *
 * This is the same defect shape as the picker draft, which this repo already fixed
 * and already wrote down: the thing must not live in a slot that every broadcast
 * clears. The remedy here is the one the picker got — keep the intent out of the
 * broadcast's reach and end it on the events that genuinely end it.
 *
 * ## WHAT IS ASSERTED
 *
 *  1. The armed note **survives a rerender with a fresh `ClientState`**, which is
 *     exactly what `net/store.ts` hands the tree when a peer's action lands.
 *  2. It survives several of them, and it still names the slot it was aimed at.
 *  3. It is still **spendable** — buying the armed card still dispatches the
 *     modifier, because surviving is only worth anything if the purchase keeps it.
 *  4. A **new turn** does end it, and says so, because the HQ Mat refills and a
 *     slot index aimed at yesterday's card is worse than no modifier at all.
 *  5. The structural clause: `clearTurnInteraction` must not clear the modifier by
 *     default, so a future caller that forgets the flag cannot reopen this.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ClientState, PlayerID, Resource } from '@shasn/engine';

import gameScreenSource from './GameScreen.tsx?raw';
import storeText from './store.ts?raw';
import {
  clearArmedModifier,
  clearTurnInteraction,
  getAppState,
  resetApp,
  setMarketModifier,
  setMarketPower,
} from './store.ts';
import { MarketPanel } from './YourMat.tsx';

const ME: PlayerID = 'p1';

function table(over: Partial<ClientState> = {}): ClientState {
  return {
    players: {
      [ME]: {
        id: ME,
        name: 'ME',
        colour: '#fff',
        resources: { funds: 6, clout: 0, media: 0, trust: 0 },
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
      },
    },
    turnOrder: [ME],
    activePlayer: ME,
    phase: 'actions',
    turn: 5,
    round: 1,
    finished: false,
    zones: [],
    market: [
      { cardId: 'v1', cost: { funds: 2 }, voters: 3 },
      { cardId: 'v2', cost: { funds: 2 }, voters: 3 },
      { cardId: 'v3', cost: { funds: 2 }, voters: 3 },
    ],
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    ...over,
  } as unknown as ClientState;
}

// ─────────────────────────── 1 & 2 & 4. the store contract ───────────────────────────

describe('the armed modifier is turn-scoped, not frame-scoped', () => {
  beforeEach(() => resetApp());

  const ARMED = { power: 'helping-hands' as const, slot: 1, discounts: ['funds'] as Resource[], viral: false };

  it('a BROADCAST does not drop it — this is the whole fix, behaviourally', () => {
    setMarketModifier(ARMED);
    // `clearTurnInteraction({keepArmedModifier:true})` is what GameScreen runs on
    // every `match:state` envelope. Three times, because one is a fluke.
    for (let i = 0; i < 3; i += 1) clearTurnInteraction({ keepArmedModifier: true });
    expect(getAppState().marketModifier).toEqual(ARMED);
  });

  it('and it is still the SAME modifier, aimed at the same slot, with the same waiver', () => {
    setMarketModifier(ARMED);
    clearTurnInteraction({ keepArmedModifier: true });
    const m = getAppState().marketModifier;
    expect(m?.slot).toBe(1);
    expect(m?.discounts).toEqual(['funds']);
    // A slot index aimed at a card the HQ Mat has since refilled is worse than no
    // modifier, so this is the field that must not silently drift.
    expect(m?.viral).toBe(false);
  });

  it('the open chooser survives a broadcast too, or the ARM press is lost the same way', () => {
    setMarketPower('going-viral');
    clearTurnInteraction({ keepArmedModifier: true });
    expect(getAppState().pendingMarketPower).toBe('going-viral');
  });

  it('a NEW TURN ends it — and the note says so instead of vanishing', () => {
    setMarketModifier(ARMED);
    setMarketPower('going-viral');
    clearArmedModifier();
    expect(getAppState().marketModifier).toBeNull();
    expect(getAppState().pendingMarketPower).toBeNull();
    // The sentence is in GameScreen's turn effect, and it has to be there: a
    // modifier that disappears on its own is this bug wearing a different hat.
    expect(gameScreenSource).toContain('your turn passed with the power still armed');
  });

  it('the default still clears it, so a caller that forgets the flag is not silently wrong', () => {
    setMarketModifier(ARMED);
    clearTurnInteraction();
    expect(getAppState().marketModifier).toBeNull();
  });

  it('the structural clause, so the default cannot drift back', () => {
    expect(storeText).toMatch(
      /\.\.\.\(keepArmed \? \{\} : \{ marketModifier: null, pendingMarketPower: null \}\)/,
    );
    expect(gameScreenSource).toContain('clearTurnInteraction({ keepArmedModifier: true })');
    expect(gameScreenSource).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,2400}?clearArmedModifier\(\);\s*\}, \[state\?\.turn\]\);/,
    );
  });
});

// ─────────────────────────── 3. it is still spendable ───────────────────────────

describe('a modifier that survived is still usable', () => {
  beforeEach(() => resetApp());

  it('the market panel prints which card it is armed on, and that it can be cancelled', () => {
    render(
      <MarketPanel
        state={table()}
        you={ME}
        disabled={false}
        disabledReason={null}
        onBuy={() => undefined}
        onBuyConspiracy={() => undefined}
        playableConspiracies={[]}
        onPlayConspiracy={() => undefined}
        armed={{ slot: 0, discounts: [] }}
      />,
    );
    const note = screen.getByTestId('armed-modifier').textContent ?? '';
    expect(note).toContain('market card 1');
    expect(note).toContain('Buy that card to spend it');
    // The way out, in the sentence itself: pressing the power again cancels.
    expect(note).toContain('press the power again to cancel');
  });

  it('the armed slot is priced at the discounted cost, so the buy can be sent at all', () => {
    // The other half of the same repair: a modifier that survives but renders the
    // card at its sticker price is the silent click again, one step downstream.
    render(
      <MarketPanel
        state={table()}
        you={ME}
        disabled={false}
        disabledReason={null}
        onBuy={() => undefined}
        onBuyConspiracy={() => undefined}
        playableConspiracies={[]}
        onPlayConspiracy={() => undefined}
        armed={{ slot: 0, discounts: ['funds'] }}
      />,
    );
    expect(screen.getAllByTestId('market-charge')[0]?.textContent ?? '').toContain('F');
  });
});

