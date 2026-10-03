/**
 * THE TABLE'S VIEW OF THE CARD — and the three properties that make it safe.
 *
 * WHAT IS UNDER TEST. Change A of the ruling (question + both labels visible to
 * the whole table) and change B (the chosen side is public after the commit) are
 * both delivered by the payload `openQuestion`, which `broadcast.ts` builds from
 * `(state, cards)` with NO viewer in it. This file asserts the client half of that:
 *
 *   1. THE TABLE SEES THE QUESTION AND BOTH LABELS, AND NOTHING ELSE. The prop type
 *      is `{question, labels}` — no `Delta`, no Ideologue, no card id, no `order`,
 *      no number — so this file smuggles a payout past the types with a cast, the
 *      same way `blindAnswer.test.tsx` does, and asserts nothing appears in the DOM.
 *      That is the runtime half of "the payout stays unreachable"; the type-level
 *      half is `OpenQuestion` in `app/blindWire.ts`, gated by `npm run typecheck`.
 *   2. THE TWO SIDES ARE THE SAME BOX. §8.8's `getComputedStyle` equality gate,
 *      run over the table's copy of the card rather than only the answerer's. The
 *      table is looking at one card; if its two faces computed differently from
 *      each other, the thing being read aloud would be two objects.
 *   3. THERE IS NO COMMIT CONTROL HERE, because this seat cannot answer. Not a
 *      disabled one: a `COMMIT ANSWER` button that can never fire is §9.10's
 *      prohibited control, and the two-commit-controls defect was exactly this
 *      failure wearing a different hat. The answering seat's single commit control
 *      is asserted where it lives, in `answer/blindAnswer.test.tsx`.
 *
 * What IS NOT here, and why it is not a hole. `order` — the seed-derived
 * presentation coin flip from PLAN.md §2 amendment A′ — is deliberately not
 * published, because it is what says which face of the card a position is, and a
 * table that could line positions up against the deck's Ideologue balance would be
 * back to "guess the slot". `broadcast.ts` asserts that on the server side; the
 * client cannot assert the absence of a field it never receives, so what is asserted
 * here is that this component has no prop through which one could arrive. The
 * payload reader itself is asserted in `blindWire.test.ts`, which is where the
 * boundary between a payload and a prop lives.
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

describe('the panel shows the table one card, and it is inert', () => {
  it('renders the question, both labels in the order given, and the answerer by name', () => {
    const { container, getByTestId } = render(
      <TableQuestion question={{ question: QUESTION, labels: [FIRST, SECOND] }} answererName="Ria" />,
    );
    expect(getByTestId('table-question-text').textContent).toBe(QUESTION);
    expect(sides(container).map((s) => s.textContent)).toEqual([FIRST, SECOND]);
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
      <TableQuestion question={{ question: QUESTION, labels: [FIRST, SECOND] }} answererName="Ria" />,
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
    const { container } = render(
      <TableQuestion question={{ question: QUESTION, labels: [FIRST, SECOND] }} answererName="Ria" />,
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
    expect(a['min-height']).toBe('88px');
    expect(a['background-color']).toBe('var(--paper-100)');
    expect(a['border-top-width']).toBe('2px');
  });

  it('gives both sides the same class list and no inline style', () => {
    const { container } = render(
      <TableQuestion question={{ question: QUESTION, labels: [FIRST, SECOND] }} answererName="Ria" />,
    );
    for (const el of sides(container)) {
      expect(el.className).toBe('blind-answer__side');
      expect(el.getAttribute('style')).toBeNull();
      // No side-derived attribute a stylesheet could key on. `data-testid` is the
      // test hook and names nothing about which side this is.
      const attrs = [...el.attributes].map((x) => x.name).sort();
      expect(attrs).toEqual(['class', 'data-testid']);
    }
  });

  it('announces one group of two, not two loose strings', () => {
    const { container, getByTestId } = render(
      <TableQuestion question={{ question: QUESTION, labels: [FIRST, SECOND] }} answererName="Ria" />,
    );
    const panel = getByTestId('table-question-panel');
    expect(panel.getAttribute('role')).toBe('group');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).not.toBeNull();
  });

  it('shows no number and no resource name anywhere — no payout, not even by name', () => {
    const { container } = render(
      <TableQuestion question={{ question: QUESTION, labels: [FIRST, SECOND] }} answererName="Ria" />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    // No digits: no cost, no payout, no count, no turn number, no resource total.
    expect(text).not.toMatch(/\d/);
    for (const word of ['Funds', 'Clout', 'Media', 'Trust', '₹']) {
      expect(text, `the table's card must not mention ${word}`).not.toContain(word);
    }
    // And nothing that could carry a value out of band.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
  });
});