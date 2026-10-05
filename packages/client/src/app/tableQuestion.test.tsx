/**
 * THE TABLE'S VIEW OF THE CARD — and the properties that make it safe under full
 * information.
 *
 * WHAT IS UNDER TEST. The payload `openQuestion`, which `broadcast.ts` builds from
 * `(state, cards)` with NO viewer in it, now carries the WHOLE card: the question, both
 * answers, both Ideologues and both payouts, for every seat and every spectator. This file
 * asserts the client half of that:
 *
 *   1. THE TABLE SEES THE WHOLE CARD — and the two faces are the same box. §8.8's
 *      `getComputedStyle` equality gate, run over the table's copy of the card rather than
 *      only the answerer's. The table is looking at one card; if its two faces computed
 *      differently from each other, the thing being read aloud would be two objects — and
 *      since the Ideologue is now printed on the card, a per-face style would publish which
 *      Ideologue the server happened to put in the first position, which is the channel
 *      PLAN.md §2 amendment A′ exists to prevent.
 *   2. THERE IS NO COMMIT CONTROL HERE, because this seat cannot answer. Not a
 *      disabled one: a `COMMIT ANSWER` button that can never fire is §9.10's
 *      prohibited control, and the two-commit-controls defect was exactly this
 *      failure wearing a different hat. The answering seat's single commit control
 *      is asserted where it lives, in `answer/blindAnswer.test.tsx`.
 *   3. NO SIDE-DERIVED ATTRIBUTE OR INLINE STYLE, because the payout and the Ideologue
 *      are now on the card and a stylesheet must have nothing to key on.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE USED TO ASSERT, AND WHY THAT PREMISE IS GONE
 *
 * It was "the table sees the question and both labels, and nothing else", and its last
 * test asserted that the panel showed no digit and no resource NAME — `Funds`, `Clout`,
 * `Media`, `Trust` — anywhere. That was true, and it was the client half of the old type
 * proof. Full information reverses it: the payout is on the card, printed in those words.
 * A test asserting their absence would be asserting something the codebase no longer
 * believes, so it is replaced by the test that matters now — that the panel prints exactly
 * the card it was given, and that the ONE thing it must not carry is `order`.
 *
 * What IS NOT here, and why it is not a hole. `order` — the seed-derived presentation
 * coin flip from PLAN.md §2 amendment A′ — is still deliberately not published, and under
 * full information it is the ONLY thing still withheld, because the Ideologue is now on
 * the card: a table that could read `order` could map position to Ideologue in one line.
 * `broadcast.ts` asserts that on the server side and `blindWire.test.ts` asserts it at the
 * payload boundary; the client cannot assert the absence of a field it never receives, so
 * what is asserted here is that this component has no prop through which one could arrive.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { TableQuestion } from './TableQuestion';

// The table's panel is styled by the ANSWERER's stylesheet, because it reuses that
// component's classes on purpose — so the symmetry assertion below is only
// meaningful if both sheets are actually loaded. Guarded by the assertions on
// `min-height` and the resolved tokens, which fail vacuously without them.
import '../theme/tokens.css';
import '../answer/blindAnswer.css';

const QUESTION = 'The trusts have quietly bought the land your party needs for a bypass.';
const FIRST = 'Sue them and stall the project for three years.';
const SECOND = 'Let it stand. The bypass goes in, and the party gets the credit.';

/**
 * A published card with the two sides DELIBERATELY different in the three ways they are
 * now allowed to differ: the text, the Ideologue and the payout. A fixture whose two
 * sides were identical would let a symmetry test pass vacuously.
 */
const CARD = {
  question: QUESTION,
  sides: [
    { label: FIRST, ideologue: 'idealist', pays: { funds: 4, trust: 1 } },
    { label: SECOND, ideologue: 'capitalist', pays: { funds: 1 } },
  ],
} as const;

/**
 * The §1.2 contract table, as computed properties. The same list
 * `answer/blindAnswer.test.tsx` uses, kept separate rather than imported so the
 * two suites cannot be weakened by one edit to a shared constant.
 */
const CONTRACT_PROPERTIES = [
  'background-color',
  'color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'min-height',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'font-style',
  'text-align',
  'text-transform',
  'letter-spacing',
  'opacity',
  'box-shadow',
  'filter',
  'transform',
  'width',
  'height',
] as const;

function snapshot(el: Element): Record<string, string> {
  const cs = window.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of CONTRACT_PROPERTIES) out[prop] = cs.getPropertyValue(prop);
  return out;
}

function sides(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.blind-answer__side')];
}

describe('the panel shows the table the whole card, and it is inert', () => {
  it('renders the question, both sides in the order given, and the answerer by name', () => {
    const { container, getByTestId } = render(
      <TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />,
    );
    expect(getByTestId('table-question-text').textContent).toBe(QUESTION);
    // The two faces carry label, Ideologue AND payout, in the order the server sent.
    expect(sides(container).map((s) => s.textContent)).toEqual([
      `${FIRST}the Idealists' answerpays 4 Fund · 1 Trust`,
      `${SECOND}the Capitalists' answerpays 1 Fund`,
    ]);
    expect(container.textContent).toContain('Ria');
    // The instruction to choose is NOT here: this seat has no choice to make, and a
    // "CHOOSE ONE" eyebrow on a panel that cannot be chosen from would be the same
    // class of lie as a dead commit button.
    expect(getByTestId('table-question-choose').textContent).not.toMatch(/choose/i);
    // And the answerer's two step-words stay the answerer's: nothing on this panel
    // claims to commit, or that anything has been committed.
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/commit/i);
    expect(text).not.toMatch(/\bsent\b|recorded|committed/i);
    expect(text).not.toContain('Confirm');
  });

  it('carries NO commit control and nothing focusable', () => {
    const { container } = render(
      <TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />,
    );
    // Zero buttons. Not a disabled `COMMIT ANSWER` either: this seat cannot answer,
    // and a control that looks like it works and does not is §9.10's prohibited case.
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[data-testid="commit-answer"]')).toBeNull();
    // Nothing is focusable, so a keyboard user tabbing the table does not land on
    // two faces of a card they cannot touch.
    expect(container.querySelectorAll('[tabindex], [onclick], a[href]')).toHaveLength(0);
    // Not a dialog either: during the answer window the rest of the table is still
    // allowed to act (p19 lets anybody play a Conspiracy before an opponent answers),
    // and a takeover here would take that away from the seats being informed.
    expect(container.querySelector('[aria-modal]')).toBeNull();
  });

  it('computes both sides to identical styles — the table is looking at ONE card', () => {
    // §8.8's gate, over the table's copy of the card. It is not a re-run of the
    // answerer's test: this is a different component with a different job, and the
    // property that matters here is that ITS two faces are indistinguishable — a
    // table that rendered a "first" and a "second" would be telling players which
    // position the server happened to put the Capitalist-flavoured answer in, which
    // is the leak PLAN.md §2 amendment A′ exists to prevent.
    //
    // AND THE FIXTURE IS THE HARD CASE: the two sides carry DIFFERENT Ideologues and
    // DIFFERENT payouts, so anything that tinted a face by either would show up here.
    const { container } = render(
      <TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />,
    );
    const [left, right] = sides(container);
    expect(left, 'two sides rendered').toBeDefined();
    expect(right, 'two sides rendered').toBeDefined();
    if (left === undefined || right === undefined) return;
    const a = snapshot(left);
    const b = snapshot(right);
    for (const prop of CONTRACT_PROPERTIES) {
      expect(a[prop], `${prop} differs between the two faces of the table's card`).toBe(b[prop]);
    }
    // The geometry is the §1.2 geometry, not a lookalike: same class, same box.
    expect(a['min-height']).toBe('150px');
    expect(a['background-color']).toBe('var(--paper-100)');
    expect(a['border-top-width']).toBe('2px');
  });

  it('gives both sides the same class list, no inline style, and no side-derived attribute', () => {
    const { container } = render(
      <TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />,
    );
    for (const el of sides(container)) {
      expect(el.className).toBe('blind-answer__side');
      expect(el.getAttribute('style')).toBeNull();
      // No side-derived attribute a stylesheet could key on — and this matters MORE
      // now the Ideologue is printed. `data-testid` is the test hook and names
      // nothing about which side this is.
      const attrs = [...el.attributes].map((x) => x.name).sort();
      expect(attrs).toEqual(['class', 'data-testid']);
      // …and the Ideologue and payout lines are plain text on the plain class, so a
      // per-side rule would have to key on the TEXT, which is what the stylesheet
      // audit in `blindAnswer.test.tsx` forbids.
      for (const inner of el.querySelectorAll('span')) {
        expect(inner.getAttribute('class')).toMatch(/^blind-answer__(label|faction|payout)$/);
        expect(inner.getAttribute('style')).toBeNull();
        expect(inner.getAttribute('title')).toBeNull();
        expect(inner.getAttribute('data-ideologue')).toBeNull();
        expect(inner.getAttribute('data-pays')).toBeNull();
      }
    }
  });

  it('announces one group of two, not two loose strings', () => {
    const { container, getByTestId } = render(
      <TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />,
    );
    const panel = getByTestId('table-question-panel');
    expect(panel.getAttribute('role')).toBe('group');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).not.toBeNull();
  });

  it('prints the payout in prose and in one frame — no icon, no tooltip, no meter', () => {
    const { container } = render(
      <TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />,
    );
    // UI-SPEC §9 anti-patterns 1 and 3 SURVIVE the reversal of the payout ban: there
    // is no count-up and nothing that reveals, because a graphical reading of a number
    // is a number both seats can compare at a glance in a way prose is not, and there
    // is nothing to reveal — the payout was on the card from the first frame.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelector('progress')).toBeNull();
    expect(container.querySelector('meter')).toBeNull();
    // The numbers that ARE here are the card's own: two payouts and nothing else.
    const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toContain('4 Fund · 1 Trust');
    expect(text).toContain('1 Fund');
    // And a pool the card did not print is not printed as a zero.
    expect(text).not.toContain('0 Fund');
  });

  it('has no prop through which the `order` draw could arrive', () => {
    // The type-level half is `PublishedOpenQuestion` in `app/blindWire.ts`; the
    // payload boundary is `blindWire.test.ts`. What is asserted here is the last
    // mile: the component renders its three lines from the side and has nowhere else
    // to read from, so a smuggled `order` cannot reach the DOM.
    const smuggled = { ...CARD, sides: [...CARD.sides], order: 'ba' } as unknown as typeof CARD;
    const clean = render(<TableQuestion question={{ ...CARD, sides: [...CARD.sides] }} answererName="Ria" />);
    const dirty = render(<TableQuestion question={smuggled} answererName="Ria" />);
    expect(dirty.container.innerHTML).toBe(clean.container.innerHTML);
  });
});