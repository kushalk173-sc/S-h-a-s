/**
 * ONE REDRAW CONTROL, and it is on the screen that explains what a redraw now is.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEFECT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The browser audit measured, on the answering seat's screen, at the same moment:
 *
 *     BUTTON:open-redraw    disabled=false  vis=true    (in YOUR MAT)
 *     BUTTON:redraw-offer   disabled=false  vis=true    (in the answer overlay)
 *
 * Two controls, one action, one identical label: "REDRAW — 4 RESOURCES". A player
 * who cannot tell which is which has two keys for one thing, and the only way to
 * find out is to press one and see whether anything happened.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE MAT'S COPY WAS THE WRONG ONE, which is the part that decides the fix.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `REDRAW_IDEOLOGY` is refused by `reduce.ts` with "no card to redraw" unless
 * `_pendingCard !== null`. A pending card is precisely the state in which
 * `AnswerScreen` renders as a full-viewport takeover — `position: fixed; inset: 0;
 * z-index: 20` — over the whole shell, this mat included. So the mat's copy was not
 * merely a duplicate: it was a control that was enabled, visible to a DOM query,
 * and UNREACHABLE at the only moment it could do anything. `document.elementFromPoint`
 * at its own centre returns the scrim.
 *
 * The copy that survives is also the only one that means anything. Under full
 * information the redraw is no longer a bet, and the sentence that says so — "both
 * payouts are printed, so you are buying a different question rather than taking a
 * chance at this one" — is only true next to the two payouts, which live on that
 * screen. Removing the mat's button therefore removes a dead control and a
 * contradiction at the same time.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { ClientState, PlayerID, PlayerState, Pool } from '@shasn/engine';

import { AnswerScreen } from './AnswerScreen.tsx';
import { YourMat } from './YourMat.tsx';
import type { AnswerPrompt } from '../net/index.ts';
import yourMatSource from './YourMat.tsx?raw';
import answerScreenSource from './AnswerScreen.tsx?raw';

const POOL: Pool = { funds: 2, clout: 1, media: 0, trust: 1 };
const ME = 'p1';
const OTHER = 'p2';

function player(id: PlayerID): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    colour: '#000',
    resources: POOL,
    manifesto: [],
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
  };
}

/** A table mid-answer, with this seat on move. */
function table(): ClientState {
  const players: Record<PlayerID, PlayerState> = { [ME]: player(ME), [OTHER]: player(OTHER) };
  return {
    players,
    turnOrder: [ME, OTHER],
    activePlayer: ME,
    phase: 'answer',
    turn: 3,
    round: 1,
    finished: false,
    market: [],
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices: [],
    liveEffects: [],
    interrupt: null,
    finalRoundFrom: null,
    log: [],
    deckSizes: { ideology: 40, voter: 60, conspiracy: 10, headline: 8 },
    awaitingAnswer: true,
  } as unknown as ClientState;
}

const PROMPT: AnswerPrompt = {
  question: 'Should the pension age rise with life expectancy?',
  sides: [
    { label: 'Yes. Tie it to expectancy.', ideologue: 'supremo', pays: { funds: 1 } },
    { label: 'No. Lower it instead.', ideologue: 'idealist', pays: { funds: 2, trust: 1 } },
  ],
  order: 'ab',
};

/** Every control on the page whose label offers a redraw. */
function redrawControls(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) =>
    /redraw/i.test(b.textContent ?? ''),
  );
}

const noop = () => undefined;

describe('exactly one redraw control exists, and it is the one that explains itself', () => {
  it('the mat does not offer a redraw at all', () => {
    // With controls shown, i.e. a seated player on their own turn: the widest set of
    // circumstances in which the old button used to render.
    const { container } = render(
      <YourMat
        state={table()}
        you={ME}
        pending={[]}
        placingGroupId={null}
        pickedCount={0}
        isMyTurn
        link="live"
        showControls
        framed={false}
        onSelectGroup={noop}
        onGerry={noop}
        onPower={noop}
        onEndTurn={noop}
        onTradeWith={noop}
      />,
    );
    expect(redrawControls(container), 'YOUR MAT must not offer a redraw').toHaveLength(0);
    // And the mat's own actions are untouched by the removal.
    expect(container.querySelector('[data-testid="enter-gerry"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="power-prospecting"]').length).toBe(1);
  });

  it('the answer screen offers exactly one, and says what it costs', () => {
    const { container } = render(
      <AnswerScreen
        state={table()}
        prompt={PROMPT}
        you={ME}
        viewId={7}
        errorAt={null}
        picker={null}
        onCommit={() => true}
        onRedrawRequest={noop}
        onPick={noop}
        onRedrawConfirm={noop}
        onPickerCancel={noop}
      />,
    );
    const controls = redrawControls(container);
    expect(controls, 'the answer screen offers exactly one redraw').toHaveLength(1);
    expect(controls[0]?.getAttribute('data-testid')).toBe('redraw-offer');
    // The price is in the label, and the sentence that gives the redraw its
    // full-information meaning is on this screen and not on any other.
    expect(controls[0]?.textContent).toMatch(/4/);
    expect(container.textContent ?? '').toMatch(/both payouts are printed/i);
  });

  it('the two screens together still offer one — the count is what a player sees', () => {
    // Rendered together, because that is the state the audit measured: the answer
    // takeover is on top of a shell that still contains the mat underneath it.
    const mat = render(
      <YourMat
        state={table()}
        you={ME}
        pending={[]}
        placingGroupId={null}
        pickedCount={0}
        isMyTurn
        link="live"
        showControls
        framed={false}
        onSelectGroup={noop}
        onGerry={noop}
        onPower={noop}
        onEndTurn={noop}
        onTradeWith={noop}
      />,
    );
    const answer = render(
      <AnswerScreen
        state={table()}
        prompt={PROMPT}
        you={ME}
        viewId={7}
        errorAt={null}
        picker={null}
        onCommit={() => true}
        onRedrawRequest={noop}
        onPick={noop}
        onRedrawConfirm={noop}
        onPickerCancel={noop}
      />,
    );
    const all = [...redrawControls(mat.container), ...redrawControls(answer.container)];
    expect(all).toHaveLength(1);
    // And the two labels can never collide again, because there is only one label.
    expect(new Set(all.map((b) => b.textContent)).size).toBe(1);
  });

  it('the removed control is gone from the mat\'s source, not merely hidden', () => {
    // A button that is merely `display: none`, or `disabled`, or behind a scrim is
    // still a second control: it is in the DOM, in the tab order, and one
    // `aria-label` away from being announced. So the gate is on the WIRING — the mat
    // must contain no redraw control and no callback to open one, and
    // `YourMatProps` no longer has an `onRedraw` key, which is what stops a future
    // call site from passing one.
    //
    // `?raw` reads the file that ships rather than a processed approximation, the
    // same route `blindAnswer.test.tsx` uses for its stylesheet audit. Comments are
    // stripped first, because the file's own comment has to be able to SAY what was
    // removed and why — the same concession that file makes.
    const yourMatCode = yourMatSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(yourMatCode, 'no redraw callback anywhere in the mat').not.toMatch(/onRedraw/);
    expect(yourMatCode, 'no redraw testid anywhere in the mat').not.toMatch(/open-redraw/);
    expect(yourMatCode, 'no redraw label anywhere in the mat').not.toMatch(/REDRAW/);
    // …while the answer screen keeps its own, so this is a move and not a deletion.
    expect(answerScreenSource).toMatch(/redraw-offer/);
    // And the mat keeps the actions that are genuinely its own.
    expect(yourMatSource).toMatch(/enter-gerry/);
  });
});
