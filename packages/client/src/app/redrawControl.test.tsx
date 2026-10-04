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

import type { ClientState, Delta, PlayerID, PlayerState, Pool } from '@shasn/engine';

import { AnswerScreen, redrawAffordable } from './AnswerScreen.tsx';
import { YourMat } from './YourMat.tsx';
import { UI_RULES, canAfford, deltaTotal, poolTotal } from './derive.ts';
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

/** `table()` with this seat holding something else. */
function tableWith(pool: Pool): ClientState {
  const s = table();
  const me = s.players[ME];
  if (me === undefined) throw new Error('the fixture seat is missing');
  return { ...s, players: { ...s.players, [ME]: { ...me, resources: pool } } };
}

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
        inertReason={null}
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
        inertReason={null}
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

/**
 * THE BUTTON REFLECTS AFFORDABILITY, and the reason is printed beside it.
 *
 * The browser audit reported that "neither REDRAW control was disabled for
 * affordability — the affordability gate lives inside the picker, so the button
 * itself is always enabled". Half of that report is now history: the mat's copy was
 * deleted last round as a duplicate, so there is exactly one control left and it is
 * the one that means anything. The other half was true and is fixed here.
 *
 * WHY THE CONDITION IS `poolTotal(pool) >= redrawCost` RATHER THAN A PICKER CHECK
 * is proved EXHAUSTIVELY below rather than asserted in a comment, because getting it
 * wrong in either direction is a defect: too strict and the button is dead for a
 * player who can pay; too lax and it opens a dialog whose only outcome is Cancel.
 */
describe('the one redraw control is live only when a payment exists, and says why', () => {
  /** Render the answer screen at one pool and hand back the button. */
  function redrawAt(pool: Pool): HTMLButtonElement {
    const { container } = render(
      <AnswerScreen
        state={tableWith(pool)}
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
    const btn = container.querySelector('[data-testid="redraw-offer"]');
    expect(btn, 'the answer screen offers the redraw').not.toBeNull();
    return btn as HTMLButtonElement;
  }

  it('is live when the player can pay', () => {
    // The existing fixture holds 2/1/0/1 = 4, which is exactly the price.
    expect(redrawAt(POOL).disabled).toBe(false);
    // And comfortably over.
    expect(redrawAt({ funds: 5, clout: 5, media: 0, trust: 0 }).disabled).toBe(false);
  });

  it('is dead when no payment can be made, whatever the split', () => {
    // Three in total, spread three different ways, because the condition is on the
    // TOTAL and a per-denomination reading would disable a different set each time.
    for (const pool of [
      { funds: 3, clout: 0, media: 0, trust: 0 },
      { funds: 1, clout: 2, media: 0, trust: 0 },
      { funds: 0, clout: 0, media: 0, trust: 3 },
      { funds: 0, clout: 0, media: 0, trust: 0 },
    ]) {
      const btn = redrawAt(pool);
      expect(btn.disabled, `held ${JSON.stringify(pool)}`).toBe(true);
      expect(btn.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('prints the shortfall next to the control, because §9.2 forbids a bare dead button', () => {
    const { container } = render(
      <AnswerScreen
        state={tableWith({ funds: 1, clout: 2, media: 0, trust: 0 })}
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
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    // The number they hold, and the number it costs — the two facts a player needs
    // to know the button is not broken.
    expect(text).toContain('You hold 3 of the 4 it costs');
    expect(text).toContain('no payment you can make');
  });

  it('says nothing about affordability when the control is live', () => {
    const { container } = render(
      <AnswerScreen
        state={tableWith(POOL)}
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
    expect(container.textContent ?? '').not.toContain('no payment you can make');
  });

  it('still does not offer a second redraw when it is dead', () => {
    // Disabling must not become removing AND some other copy appearing: the count of
    // controls is what a player sees, and it is one either way.
    const { container } = render(
      <AnswerScreen
        state={tableWith({ funds: 0, clout: 0, media: 0, trust: 0 })}
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
    expect(redrawControls(container)).toHaveLength(1);
  });

  it('the button gate IS the engine gate, exhaustively', () => {
    // THE PROOF, and the reason the condition above is written as a total rather
    // than as a per-denomination check. The engine refuses a redraw unless
    // `canAfford(pool, pay)` for SOME delta totalling `redrawCost`. So the button is
    // right exactly when "some such delta exists" and "held total >= cost" agree --
    // and this walks every pool with each denomination in 0..4 (625 pools) against
    // every delta with each denomination in 0..4 (625 deltas) and asserts they never
    // disagree.
    const pools: Pool[] = [];
    for (let f = 0; f <= 4; f += 1) {
      for (let c = 0; c <= 4; c += 1) {
        for (let m = 0; m <= 4; m += 1) {
          for (let t = 0; t <= 4; t += 1) pools.push({ funds: f, clout: c, media: m, trust: t });
        }
      }
    }
    const deltas: Delta[] = [];
    for (let f = 0; f <= 4; f += 1) {
      for (let c = 0; c <= 4; c += 1) {
        for (let m = 0; m <= 4; m += 1) {
          for (let t = 0; t <= 4; t += 1) deltas.push({ funds: f, clout: c, media: m, trust: t });
        }
      }
    }
    expect(pools.length).toBe(625);
    expect(deltas.length).toBe(625);

    const disagreements: string[] = [];
    let affordable = 0;
    for (const pool of pools) {
      // "Some legal payment exists" — exactly the engine's own test, including the
      // `redrawAffordable` wrapper this package already used for the drafted pick.
      const engineAllowsSomething = deltas.some(
        (d) => deltaTotal(d) === UI_RULES.redrawCost && canAfford(pool, d),
      );
      if (engineAllowsSomething) affordable += 1;
      const buttonWouldBeLive = poolTotal(pool) >= UI_RULES.redrawCost;
      if (engineAllowsSomething !== buttonWouldBeLive) {
        disagreements.push(JSON.stringify(pool));
      }
    }
    expect(disagreements, 'the button gate and the engine gate disagree').toEqual([]);
    // Non-vacuity in the other direction: the sweep must have found both classes,
    // or it proved nothing about a condition that never varies.
    expect(affordable).toBeGreaterThan(0);
    expect(affordable).toBeLessThan(pools.length);
    // And the boundary itself, which is the only place a `>=` could have been a `>`.
    expect(redrawAt({ funds: 3, clout: 1, media: 0, trust: 0 }).disabled).toBe(false);
    expect(redrawAt({ funds: 2, clout: 1, media: 0, trust: 0 }).disabled).toBe(true);
  });

  it('the drafted pick is still validated against the pool, unchanged', () => {
    // The picker's own gate is a DIFFERENT question and is untouched: a draft may be
    // exactly the right total and still exceed what is held in one denomination,
    // which the button's total-based condition cannot see and is not meant to.
    const pool: Pool = { funds: 3, clout: 3, media: 0, trust: 0 };
    expect(redrawAffordable(pool, { funds: 4 })).toBe(false); // right total, no funds
    expect(redrawAffordable(pool, { funds: 3, clout: 1 })).toBe(true);
    expect(redrawAffordable(pool, { funds: 2, clout: 2 })).toBe(true);
    expect(redrawAffordable(pool, { funds: 3, clout: 0, media: 1 })).toBe(false);
    expect(redrawAffordable(pool, { funds: 3 })).toBe(false); // short
    expect(redrawAffordable(pool, { funds: 1, clout: 1, media: 1, trust: 1 })).toBe(false); // trust: 0 held
    expect(redrawAffordable(pool, { funds: 2, clout: 1, media: 1 })).toBe(false); // media: 0 held
    expect(redrawAffordable(pool, { funds: 2, clout: 2 })).toBe(true);
    expect(redrawAffordable(pool, { funds: 1, clout: 3 })).toBe(true);
    // (`RESOURCE_ORDER` itself is pinned against the engine in `derive.test.ts`;
    // this block is about the payment rule, not the vocabulary.)
  });
});
