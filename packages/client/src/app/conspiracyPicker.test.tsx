/**
 * THE CONSPIRACY PICKER renders the SERVER'S LIST, and nothing else.
 *
 * WHAT THIS FILE GUARDS, and it is one property with four faces:
 *
 *   The client is not told what it holds (D25, ARCHITECTURE §8.1.1 — `playerView`
 *   strips every player's `conspiracies`, the viewer's own included), so the picker
 *   has exactly one legitimate source for a card: the server's list of cards this
 *   player may legally play. Everything here is about whether that source is used
 *   faithfully, and about the failure that is easiest to introduce by accident —
 *   the component quietly constructing, caching or inventing a card so the dialog
 *   does not look empty.
 *
 * So the assertions are paired. For a NON-EMPTY list, the printed name and the
 * printed effect text must be on screen, and pressing PLAY must name that card's
 * id. For an EMPTY list, and for an ABSENT list, no card row may exist anywhere in
 * the DOM — and that second half is the one that has teeth, because "renders the
 * cards" is satisfied by a component that renders cards unconditionally.
 *
 * The buy half is asserted in every priced state, because the buy is the one thing
 * the player can always do and the dialog must not become a dead end.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { Pool } from '@shasn/engine';

import { ConspiracyPicker, type PlayableConspiracy } from './ConspiracyPicker.tsx';

const POOL: Pool = { funds: 6, clout: 0, media: 0, trust: 0 };
const PICK = { funds: 0, clout: 0, media: 0, trust: 0 };

function noop(): void {
  /* cancel is inert in these tests; they press only what they assert */
}

const CARDS: readonly PlayableConspiracy[] = [
  { id: 'cs-0001', name: 'Petty Grand', text: 'Gain 1 Clout from the Public Reserve.' },
  { id: 'cs-0002', name: 'Paper Delay', text: 'Draw the top Conspiracy Card for free.' },
];

/**
 * A CONTROLLED harness, because the dialog is controlled.
 *
 * `pick` is a prop, not internal state: `GameScreen` owns the draft and feeds it
 * back. Driving the component with a bare `onPick = vi.fn()` would leave the draft
 * frozen at zero forever, so a test that clicked "+funds" four times would be
 * testing a component that ignores its own contract. This is the same one-way loop
 * the real screen runs.
 */
function Harness({
  playable,
  total,
  onPlay,
  onConfirm,
}: {
  playable: readonly PlayableConspiracy[] | undefined;
  total: number;
  onPlay: (cardId: string) => void;
  onConfirm: (pay: Readonly<Record<string, number>>) => void;
}) {
  const [pick, setPick] = useState<Readonly<Record<string, number>>>(PICK);
  return (
    <ConspiracyPicker
      pool={POOL}
      total={total}
      pick={pick}
      playable={playable}
      onPick={setPick}
      onConfirm={onConfirm}
      onPlay={onPlay}
      onCancel={noop}
    />
  );
}

function mount(playable: readonly PlayableConspiracy[] | undefined, total = 4) {
  const onPlay = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <Harness playable={playable} total={total} onPlay={onPlay} onConfirm={onConfirm} />,
  );
  return { ...view, onPlay, onConfirm };
}

describe('the conspiracy picker renders the server list and invents nothing', () => {
  it('prints each card name and its printed effect text', () => {
    mount(CARDS);
    for (const card of CARDS) {
      expect(screen.getByText(card.name)).toBeTruthy();
      expect(screen.getByText(card.text)).toBeTruthy();
    }
    const list = screen.getByTestId('conspiracy-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(CARDS.length);
  });

  it('PLAY asks for the id the server sent, and for nothing else', () => {
    const { onPlay } = mount(CARDS);
    fireEvent.click(screen.getByTestId(`play-conspiracy-${CARDS[1]?.id ?? ''}`));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith('cs-0002');
    // One click, one card. A picker that fires every card on any click would be a
    // picker that plays the table's whole conspiracy for you.
    expect(onPlay.mock.calls).toHaveLength(1);
  });

  it('never renders a card id as visible text', () => {
    // The id is a database key. It rides along as a data attribute and as the testid
    // the click handler needs, and nothing else — a player reading "cs-0002" on a
    // card is a player being shown a debug artefact as though it were the card.
    mount(CARDS);
    for (const card of CARDS) {
      expect(screen.queryByText(card.id)).toBeNull();
    }
  });

  it('an EMPTY list renders the honest empty state and NOT a card', () => {
    // The assertion that has teeth: `[]` and `undefined` must both produce zero card
    // rows. A component that fell back to "show something anyway" would satisfy every
    // other test in this file and fail here.
    mount([]);
    expect(screen.getByText('You hold no Conspiracy Card you may play at the moment.')).toBeTruthy();
    expect(screen.queryByTestId('conspiracy-list')).toBeNull();
    expect(document.querySelectorAll('[data-conspiracy-id]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="play-conspiracy-"]')).toHaveLength(0);
  });

  it('an ABSENT list says the server has not sent one, which is a different claim', () => {
    // `undefined` means "I do not know what you may play"; `[]` means "you may play
    // nothing". Collapsing them would tell a player with a full hand that they hold
    // nothing, on the server's behalf, from data the server never sent.
    mount(undefined);
    expect(screen.getByText('Nothing to choose from — yet')).toBeTruthy();
    expect(screen.queryByText('You hold no Conspiracy Card you may play at the moment.')).toBeNull();
    expect(document.querySelectorAll('[data-conspiracy-id]')).toHaveLength(0);
  });

  it('an empty deck is its own state, and offers no rows at all', () => {
    // `total === 0` means the Conspiracy deck is exhausted — NOT that the player
    // cannot afford a card. Rendering the priced dialog there would send the player
    // looking for a Conspiracy that does not exist.
    mount(CARDS, 0);
    expect(screen.getByText('No Conspiracy Card is purchasable')).toBeTruthy();
    expect(document.querySelectorAll('[data-conspiracy-id]')).toHaveLength(0);
    expect(screen.queryByTestId('resource-picker')).toBeNull();
  });

  it('the buy half is reachable in every state that has a price', () => {
    // A Conspiracy may be bought at any point in the turn, so the dialog must not
    // become a dead end in any of the three "nothing to play" states — and a dialog
    // with no way out is a stall, not a cosmetic problem.
    for (const playable of [[], undefined, CARDS] as const) {
      const { unmount } = mount(playable as readonly PlayableConspiracy[] | undefined);
      const picker = screen.getByTestId('resource-picker');
      expect(within(picker).getByText('Buy the top Conspiracy Card — any 4 resources')).toBeTruthy();
      expect(within(picker).getByTestId('picker-confirm')).toBeTruthy();
      unmount();
    }
  });

  it('the buy still pays the printed cost, and stays disabled until the pick adds up', () => {
    // Guards against the dialog being repointed at the play half by accident: buying
    // must still go through the resource picker for the top card's printed price, and
    // an empty draft must not be confirmable — §9.10's control that looks live.
    const { onConfirm } = mount([], 5);
    const confirm = screen.getByTestId('picker-confirm');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    // Five is the top card's printed cost, so four of six funds is not enough.
    fireEvent.click(screen.getByLabelText('Add one funds. You hold 6, 0 chosen.'));
    fireEvent.click(screen.getByLabelText('Add one funds. You hold 6, 1 chosen.'));
    expect(screen.getByTestId('picker-status').textContent).toContain('2 of 5 chosen');
    expect(screen.getByTestId('picker-confirm').hasAttribute('disabled')).toBe(true);
  });

  it('a completed draft confirms for exactly that draft', () => {
    const { onConfirm } = mount(CARDS, 4);
    fireEvent.click(screen.getByLabelText('Add one funds. You hold 6, 0 chosen.'));
    fireEvent.click(screen.getByLabelText('Add one funds. You hold 6, 1 chosen.'));
    fireEvent.click(screen.getByLabelText('Add one funds. You hold 6, 2 chosen.'));
    fireEvent.click(screen.getByLabelText('Add one funds. You hold 6, 3 chosen.'));
    fireEvent.click(screen.getByTestId('picker-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({ funds: 4, clout: 0, media: 0, trust: 0 });
  });
});
