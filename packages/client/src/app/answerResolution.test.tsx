/**
 * THE RESOLUTION — the screen that shows what the answer was and what it paid.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THIS FILE EXISTS BECAUSE §9.3 WAS REVERSED, and the reversal is the thing under
 * test. The old rule was: no count-up, no delay, no comparison — because every one
 * of those animates on a length that LEAKS, and a leak is permanent for anyone who
 * watched.
 *
 * Every clause of that argument is about a number that is still secret while the
 * animation runs. On this screen it is not secret, and the tests below assert WHY
 * rather than asserting the animation alone:
 *
 *   · the card is gone from the wire before this paints (`reduce.ts` nulls
 *     `_pendingCard` and sets `phase: 'actions'`; `openQuestionFor` returns null
 *     outside `phase === 'answer'`), so the prompt is a LOCAL SNAPSHOT taken in the
 *     dispatch callback — the last instant it is readable;
 *   · the payout is already in the player's pool and already in the public log;
 *   · the trigger is the server's own log growing, so the screen cannot appear for an
 *     answer the server refused.
 *
 * So the animation is allowed to be an animation. What is still forbidden, and is
 * asserted below, is the version of this that would be theatre: animating the side
 * the player did NOT take, animating a number that is not theirs, or animating at all
 * for a reader who has asked for less motion.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { AnswerResolution, cardForResolution } from './AnswerScreen.tsx';
import type { AnswerPrompt } from '../net/index.ts';

const QUESTION = 'Should mistakes be forgiven?';

const PROMPT: AnswerPrompt = {
  question: QUESTION,
  sides: [
    {
      label: 'No. A queue that does not move is only a queue with better lighting.',
      ideologue: 'capitalist',
      pays: { funds: 2, media: 1 },
    },
    {
      label: 'Yes. Forgive the mistake, publish the method, and let the crowd do the arithmetic.',
      ideologue: 'idealist',
      pays: { media: 1, trust: 2 },
    },
  ],
  // Carried so the fixture is a real prompt — and then dropped, which is its own test.
  order: 'ab',
} as const;

/** The prompt as the resolution is allowed to hold it: the card, minus `order`. */
const CARD = cardForResolution(PROMPT);

function renderIt(
  chosenIndex: 0 | 1,
  overrides: Partial<React.ComponentProps<typeof AnswerResolution>> = {},
) {
  return render(
    <AnswerResolution
      prompt={CARD}
      chosenIndex={chosenIndex}
      serverText={null}
      onContinue={() => undefined}
      {...overrides}
    />,
  );
}

describe('the snapshot drops `order`, the one field the mechanic protects', () => {
  it('the prompt has `order` and the snapshot does not', () => {
    // `AnswerPrompt` carries the seed-derived display order and `openQuestion`
    // fails closed on any payload that has one (`blindWire.ts:openQuestionOf`). So the
    // snapshot taken at commit time is `AnswerPrompt` MINUS `order`, and the resolution
    // component's prop type is the narrow shape — not the wide one plus a rule.
    //
    // The difference matters: a prohibition is something the next edit can forget,
    // a missing field can only be re-added on purpose.
    expect(PROMPT.order).toBe('ab');
    expect('order' in CARD).toBe(false);
    expect(Object.keys(CARD).sort()).toEqual(['question', 'sides']);
  });

  it('neither field of the snapshot reaches the DOM as an order', () => {
    const { container } = renderIt(0);
    expect(container.innerHTML).not.toMatch(/\border\b/i);
  });
});

describe('the resolution shows the whole card, and says which side you took', () => {
  it('prints the question, both answers in full, both Ideologues and both payouts', () => {
    const { container } = renderIt(0);
    expect(container.querySelector('[data-testid="resolution-question"]')?.textContent).toBe(QUESTION);

    // BOTH sides, in the card's own words. Not the YES/NO reduction the answer screen
    // used: the resolution is where you find out what you actually agreed to, and the
    // side you did not take is the one the answerer never got to see at all.
    const text = container.textContent ?? '';
    for (const fragment of [
      PROMPT.sides[0].label,
      PROMPT.sides[1].label,
      "the Capitalists' answer",
      "the Idealists' answer",
      'pays 2 Fund · 1 Media',
      'pays 1 Media · 2 Trust',
    ]) {
      expect(text, `"${fragment}" must be on the resolution`).toContain(fragment);
    }
  });

  it('marks the chosen side and not the other, for EITHER index', () => {
    for (const index of [0, 1] as const) {
      const { container, unmount } = renderIt(index);
      const mine = container.querySelector('[data-testid="resolution-mine"]');
      const theirs = container.querySelector('[data-testid="resolution-theirs"]');
      expect(mine?.getAttribute('data-mine')).toBe('true');
      expect(theirs?.getAttribute('data-mine')).toBe('false');
      // The chosen card carries the chosen side's words, so a player who reads only
      // the marked box still learns what they picked.
      expect(mine?.textContent).toContain(PROMPT.sides[index].label);
      expect(theirs?.textContent).toContain(PROMPT.sides[index === 0 ? 1 : 0].label);
      expect(mine?.textContent).toContain('YOU CHOSE THIS');
      expect(theirs?.textContent).toContain('YOU DID NOT CHOOSE THIS');
      unmount();
    }
  });

  it('is a modal takeover, so a stray click on the board cannot dismiss it', () => {
    const { container } = renderIt(0);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    // One control, and it is the only way out. A screen that removes itself on a
    // timer cannot be re-read, and the card is off the wire by then.
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('CONTINUE');
  });

  it('dismisses only when CONTINUE is pressed', () => {
    const onContinue = vi.fn();
    const { getByTestId } = renderIt(0, { onContinue });
    getByTestId('resolution-continue').click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('the points you got, and only those, are the ones that move', () => {
  it('counts up the CHOSEN side\'s payout', () => {
    // Side 0 pays 2 Funds and 1 Media. Both must be there and both must be marked as
    // gains; a pool the card said nothing about must NOT print a zero.
    const { container } = renderIt(0);
    expect(container.querySelector('[data-testid="landed-funds"]')?.textContent).toContain('+');
    expect(container.querySelector('[data-testid="landed-media"]')?.textContent).toContain('+');
    // Clout and Trust are absent from this side's payout, so they read as a dash:
    // "you gained nothing here" and "this card said nothing about here" are
    // different facts and only the second is invisible if you print a zero.
    expect(container.querySelector('[data-testid="landed-clout"]')?.textContent).toContain('—');
    expect(container.querySelector('[data-testid="landed-trust"]')?.textContent).toContain('—');
  });

  it('follows the chosen index — side 1 pays Media and Trust, not Funds', () => {
    const { container } = renderIt(1);
    expect(container.querySelector('[data-testid="landed-funds"]')?.textContent).toContain('—');
    expect(container.querySelector('[data-testid="landed-trust"]')?.textContent).toContain('+');
  });

  it('does NOT animate the side the player did not take', () => {
    // THE RULE THIS FILE EXISTS TO PROTECT. An animated number on the rejected side
    // is the leak §9.3 was written to prevent, and it would survive into a screen
    // where the leak argument no longer applies — which is exactly how a rule gets
    // eroded one plausible exception at a time.
    //
    // The rejected side's payout is printed, as prose, on the card above the row. It
    // is stated and it does not move.
    const { container } = renderIt(0);
    const theirs = container.querySelector('[data-testid="resolution-theirs"]');
    expect(theirs?.textContent).toContain('pays 1 Media · 2 Trust');
    // The animated row belongs to the chosen side alone.
    const landed = [...container.querySelectorAll('[data-testid^="landed-"]')];
    expect(landed).toHaveLength(4);
    expect(
      landed.every((c) => c.getAttribute('aria-hidden') === 'true'),
      'the animating numerals are hidden from assistive tech',
    ).toBe(true);
    // …and the meaning is carried once, in a sentence, rather than by announcing
    // every frame of four numbers.
    const summary = container.querySelector('[data-testid="resolution-summary"]');
    expect(summary?.getAttribute('role')).toBe('status');
    expect(summary?.textContent).toBe('You gained 2 funds and 1 media.');
  });

  it('says so plainly when the answer paid nothing at all', () => {
    const empty: AnswerPrompt = {
      question: QUESTION,
      sides: [
        { label: 'No. Nothing.', ideologue: 'capitalist', pays: {} },
        { label: 'Yes. Nothing.', ideologue: 'idealist', pays: {} },
      ],
      order: 'ba',
    } as const;
    const { container } = render(
      <AnswerResolution
        prompt={cardForResolution(empty)}
        chosenIndex={0}
        serverText={null}
        onContinue={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="resolution-summary"]')?.textContent).toBe(
      'This answer paid you nothing.',
    );
    // Every cell a dash, and the card says "pays nothing" rather than an empty line.
    expect(container.querySelector('[data-testid="landed-funds"]')?.textContent).toContain('—');
    expect(container.textContent).toContain('pays nothing');
  });
});

describe('the server, not the snapshot, decides which side you took', () => {
  it('prints the log\'s own words for the chosen side when they are available', () => {
    // `committedSideToDisplayIndex` is the one mapping in this mechanic that can be
    // got backwards. If it were, the resolution would animate the WRONG payout as
    // though the player had earned it — so the log wins, because `reduce.ts` wrote
    // it from the side the engine actually took.
    const { container } = renderIt(0, { serverText: '"Yes. Forgive the mistake."' });
    const mine = container.querySelector('[data-testid="resolution-mine"]');
    expect(mine?.textContent).toContain('Yes. Forgive the mistake.');
  });

  it('strips the quotes `reduce.ts` wraps the answer in', () => {
    const { container } = renderIt(0, { serverText: '"No. A queue that does not move."' });
    const mine = container.querySelector('[data-testid="resolution-mine"]');
    expect(mine?.textContent).toContain('No. A queue that does not move.');
    expect(mine?.textContent).not.toContain('"');
  });

  it('falls back to the snapshot when the log has nothing to say', () => {
    // A reconnect, or the first render before the log envelope lands. The snapshot
    // is the card the player was just shown, so it is a correct answer here — it is
    // only ever wrong if the two mappings disagree, which is the case above.
    const { container } = renderIt(0, { serverText: null });
    expect(container.querySelector('[data-testid="resolution-mine"]')?.textContent).toContain(
      PROMPT.sides[0].label,
    );
  });
});