/**
 * The cap-discard dialog's LAYOUT, as a gate.
 *
 * THE DEFECT. Playing on a phone (390px) found the cap-discard dialog's nested
 * sheet overflowing its container. Measured, not guessed: with `.sheet` on the
 * default `content-box`, `width: 100%` sizes the CONTENT and the 20px padding
 * plus 2px border are added on top. A `.sheet` nested inside another `.sheet` —
 * which is what `ChoiceResolver` + `ResourcePicker` produced — therefore rendered
 * 358px wide inside a 356px content box, and 22px of it was clipped off the
 * right edge. That clipped 22px was the player's own resource numerals: the
 * denominations they were being asked to discard. §5.9b makes that decision the
 * only thing the player can legally do, so a clipped denomination is a stall,
 * not a cosmetic defect.
 *
 * WHY A TEST, GIVEN THAT jsdom CANNOT LAY OUT. jsdom has no box model — it does
 * not resolve `getComputedStyle` widths, and it will happily report that a
 * `content-box` element is fine. So this file cannot assert the overflow is gone
 * by measuring, and it does not pretend to. What it CAN assert is every CAUSE,
 * which is what actually has to hold:
 *
 *   1. `.sheet` is `box-sizing: border-box`, so `width: 100%` cannot exceed the
 *      space it was given by its padding and border.
 *   2. The nested picker contributes NO chrome of its own — no background, no
 *      border, no shadow, no padding, no max-width — so it adds zero width.
 *   3. It renders as a plain `<section>`, not a second `aria-modal` dialog.
 *   4. It is still a modal dialog when NOT nested (the redraw, a Conspiracy buy,
 *      a trade, Prospecting) — one widget, two containers, one body.
 *   5. The phone rules bound the dialog to the dynamic viewport so the DISCARD
 *      control at the bottom can always be scrolled to, and nothing is hidden.
 *
 * The browser check that measures the real box model is run separately over CDP;
 * this file is the part that keeps running in CI on every commit.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { Pool } from '@shasn/engine';

import { ResourcePicker } from '../app/ResourcePicker.tsx';
import css from '../app/app.css?raw';
import '../theme/tokens.css';

const POOL: Pool = { funds: 4, clout: 4, media: 4, trust: 1 };
const PICK = { funds: 0, clout: 0, media: 0, trust: 0 };

const noop = () => undefined;

/** The stylesheet with its comments stripped, so the rules can be audited. */
const RULES = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The declaration blocks of every rule whose selector list mentions `selector`,
 * at the TOP LEVEL of the stylesheet only.
 *
 * Split on braces rather than trying to match a rule with a regex: this file
 * contains nested `@media` blocks and multi-selector rules, and a regex written
 * to cope with both ends up being wrong in a way that fails silently — which is
 * the failure mode a layout gate must not have.
 *
 * "Top level only" is load-bearing: a naive scan walks straight out of a rule
 * and into every rule after it, so asking "does `.picker__nested` declare
 * padding?" would find the padding belonging to something else entirely.
 */
function rulesFor(selector: string): string[] {
  const out: string[] = [];
  const selRe = new RegExp(`(^|[\\s,])${selector.replace(/\./g, '\\.')}([\\s,:]|$)`);
  let selStart = 0;
  let i = 0;
  while (i < RULES.length) {
    const ch = RULES[i];
    if (ch === '{') {
      const end = RULES.indexOf('}', i);
      if (end === -1) break;
      if (selRe.test(RULES.slice(selStart, i))) {
        out.push(RULES.slice(i + 1, end));
        // Skip the whole rule, including its selector, so the next scan starts
        // at the rule AFTER it.
        selStart = end + 1;
        i = end + 1;
        continue;
      }
      i = end + 1;
      // A rule we did not match: keep scanning for the next selector, but do not
      // treat its declarations as part of the next rule's selector text.
      selStart = end + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Every rule inside a given `@media` block, as `[selector, declarations]`. */
function mediaRules(condition: string): string[] {
  const at = RULES.indexOf(`@media (${condition}) {`);
  if (at === -1) return [];
  const bodyStart = at + `@media (${condition}) {`.length;
  let depth = 1;
  let i = bodyStart;
  while (i < RULES.length && depth > 0) {
    if (RULES[i] === '{') depth += 1;
    else if (RULES[i] === '}') depth -= 1;
    i += 1;
  }
  const body = RULES.slice(bodyStart, i - 1);
  const out: string[] = [];
  let selStart = 0;
  let j = 0;
  while (j < body.length) {
    if (body[j] === '{') {
      const end = body.indexOf('}', j);
      if (end === -1) break;
      out.push(body.slice(selStart, j));
      out.push(body.slice(j + 1, end));
      selStart = end + 1;
      j = end + 1;
      continue;
    }
    j += 1;
  }
  return out;
}

/** The declaration block for `selector` inside a media block, or ''. */
function mediaRule(condition: string, selector: string): string {
  const rules = mediaRules(condition);
  for (let i = 0; i + 1 < rules.length; i += 2) {
    const sel = (rules[i] ?? '').trim();
    if (sel.split(',').some((s) => s.trim() === selector)) return rules[i + 1] ?? '';
  }
  return '';
}

describe('the cap-discard dialog fits its container at phone widths', () => {
  it('.sheet is border-box, so width:100% cannot exceed the space it was given', () => {
    const rules = rulesFor('.sheet');
    expect(rules.length, 'the .sheet rule must exist').toBeGreaterThan(0);
    // THE ROOT CAUSE. Without this, `width: 100%` is a CONTENT width and the
    // padding and border are added on top of whatever the parent allocated.
    const base = rules.find((r) => r.includes('background')) ?? '';
    expect(base).toMatch(/box-sizing:\s*border-box/);
  });

  it('the nested picker adds no chrome, so it contributes no width', () => {
    const rules = rulesFor('.picker__nested');
    expect(rules.length, 'the .picker__nested rule must exist').toBeGreaterThan(0);
    const rule = rules.join('\n');
    // It is a flow child, not a second sheet. If any of these ever comes back,
    // the 42px of nested padding returns with it.
    //
    // Matched on the PROPERTY NAME at the start of a declaration, not as a
    // substring: `box-sizing: border-box` contains "border", and a naive
    // `not.toContain('border')` would forbid the very declaration that makes the
    // rule safe. A gate that cannot be satisfied correctly gets deleted, so it
    // has to be written right the first time.
    const declared = new Set(
      [...rule.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/g)].map((m) => m[1] ?? ''),
    );
    for (const prop of ['background', 'background-color', 'border', 'box-shadow', 'padding']) {
      expect(declared.has(prop), `.picker__nested must not declare ${prop}; it declares ${[...declared].join(', ')}`).toBe(false);
    }
    // …and it is explicitly width-safe, which is the whole job of this rule.
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).toMatch(/width:\s*100%/);
    // `max-width: 100%` is required here, not forbidden: it is what stops the
    // child from being WIDER than its parent, which is the defect itself. The
    // `.sheet` rule's `max-width: 720px` is the thing that must not be inherited.
    expect(declared.has('max-width')).toBe(true);
    expect(rule).toMatch(/max-width:\s*100%/);
    // `min-width: 0` is what lets a grid/flex child shrink below its content;
    // without it a wide child silently pushes the parent.
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('a phone bounds the dialog to the dynamic viewport and lets it scroll', () => {
    // The DISCARD control is the LAST thing in the dialog. If the dialog is
    // taller than a phone, that button is unreachable, and an unreachable
    // confirm on a modal decision is a deadlock caused by layout.
    const phoneSheet = mediaRule('max-width: 599px', '.sheet');
    expect(phoneSheet, 'the phone rules must bound .sheet').not.toBe('');
    expect(phoneSheet).toMatch(/max-height:/);
    expect(phoneSheet).toMatch(/overflow-y:\s*auto/);
    // `100dvh`, not `100vh`: mobile browser chrome eats the bottom of a `vh`,
    // which is exactly where the confirm button lives.
    expect(phoneSheet).toMatch(/100dvh/);
    // The scrim scrolls, so nothing is truncated — the player reads every
    // resource they are discarding by scrolling rather than by having the type
    // shrunk for them.
    expect(mediaRule('max-width: 599px', '.scrim')).toMatch(/padding:/);
    const scrim = rulesFor('.scrim').join('\n');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    // The picker reflows to two columns rather than overflowing four.
    expect(mediaRule('max-width: 599px', '.picker__grid')).toMatch(/repeat\(2,\s*1fr\)/);
  });
});

describe('the resource picker is a dialog only when it is not already inside one', () => {
  it('nested, it is plain content — no second modal dialog', () => {
    const { container, getByTestId } = render(
      <ResourcePicker
        pool={POOL}
        total={1}
        pick={PICK}
        onPick={noop}
        heading="Discard exactly 1"
        confirmLabel="DISCARD 1"
        onConfirm={noop}
        onCancel={noop}
        nested
      />,
    );
    const picker = getByTestId('resource-picker');
    expect(picker.className).toBe('picker__nested');
    expect(picker.getAttribute('role'), 'two aria-modal dialogs is a contradiction').toBeNull();
    expect(picker.getAttribute('aria-modal')).toBeNull();
    expect(container.querySelectorAll('[aria-modal="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('.sheet')).toHaveLength(0);
  });

  it('standalone, it is still a modal dialog — one widget, two containers', () => {
    const { getByTestId } = render(
      <ResourcePicker
        pool={POOL}
        total={1}
        pick={PICK}
        onPick={noop}
        heading="Redraw — choose any 4 resources"
        confirmLabel="CHOOSE 4"
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    const picker = getByTestId('resource-picker');
    expect(picker.className).toBe('sheet');
    expect(picker.getAttribute('role')).toBe('dialog');
    expect(picker.getAttribute('aria-modal')).toBe('true');
    expect(picker.getAttribute('aria-label')).toBe('Redraw — choose any 4 resources');
  });

  it('the body is byte-identical either way, so the player learns it once', () => {
    // §5.4's reasoning applied to choices: this widget is met in the cap discard,
    // the redraw, a Conspiracy purchase, Prospecting and a trade. If `nested`
    // changed ANYTHING inside, the player would be learning two widgets.
    const props = {
      pool: POOL,
      total: 1,
      pick: PICK,
      onPick: noop,
      heading: 'Discard exactly 1',
      confirmLabel: 'DISCARD 1',
      onConfirm: noop,
      onCancel: noop,
    };
    const a = render(<ResourcePicker {...props} nested />);
    const nestedBody = a.getByTestId('resource-picker').innerHTML;
    a.unmount();
    const b = render(<ResourcePicker {...props} />);
    const standaloneBody = b.getByTestId('resource-picker').innerHTML;

    // The only difference allowed is the wrapper's own tag.
    expect(nestedBody).toBe(standaloneBody);

    // And everything the player must be able to READ is still there: all four
    // denominations, each with its held count, plus the status and the control.
    const c = render(<ResourcePicker {...props} nested />);
    const cells = [...c.container.querySelectorAll('.picker__cell')];
    expect(cells).toHaveLength(4);
    for (const r of ['funds', 'clout', 'media', 'trust']) {
      const cell = cells.find((el) => (el.textContent ?? '').toLowerCase().includes(r));
      expect(cell, `the ${r} denomination must be present and readable`).toBeDefined();
      // "0 / 4" — the number chosen of the number held. This is the text that
      // was being clipped.
      expect(cell?.textContent).toMatch(/\d\s*\/\s*\d/);
    }
    // Scoped to `c.container`, not `document.body` — the previous two renders are
    // still mounted, so an unscoped query finds the FIRST render's nodes.
    expect(c.container.querySelector('[data-testid="picker-status"]')).not.toBeNull();
    expect(c.container.querySelector('[data-testid="picker-confirm"]')).not.toBeNull();
  });
});