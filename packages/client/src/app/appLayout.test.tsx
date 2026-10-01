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
    if (RULES[i] === '{') {
      // Brace-aware, not `indexOf('}')`: inside an `@media` block the first `}`
      // belongs to the rule, but a nested at-rule closes later. Using the first
      // `}` makes the parser read a media block's declarations as if they were
      // top-level rules — which is exactly the class of confusion this whole file
      // exists to prevent.
      let depth = 0;
      let end = -1;
      for (let j = i; j < RULES.length; j += 1) {
        if (RULES[j] === '{') depth += 1;
        else if (RULES[j] === '}') {
          depth -= 1;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end === -1) break;

      // An at-rule (`@media`, `@keyframes`) is never a selector we match on, and
      // skipping its ENTIRE body is what keeps "top level only" true.
      const selectorText = RULES.slice(selStart, i).trim();
      const isAtRule = selectorText.startsWith('@');
      if (!isAtRule && selRe.test(selectorText)) {
        out.push(RULES.slice(i + 1, end));
      }
      selStart = end + 1;
      i = end + 1;
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

/**
 * THE TOP-LEVEL STRUCTURE OF THE STYLESHEET.
 *
 * Each entry is a rule with the media condition it sits inside, or `null` for a
 * top-level rule. This is the shape that actually matters, and it is not the
 * same as "are the braces balanced".
 *
 * WHY THAT IS THE DISTINCTION — a real defect I introduced
 * ------------------------------------------------------
 * Adding the phone rules for the cap-discard dialog, I closed the
 * `@media (max-width: 599px)` block one rule too early. Every rule after that
 * point — including `[data-tabpanel]:not([data-active='true']) { display: none }`
 * — became UNCONDITIONAL.
 *
 * The consequence on a 1440px desktop was not cosmetic: the mat, the market and
 * the log were all `display: none` and 0×0. A player had no resources, no cap
 * meter, no manifesto and no market.
 *
 * IT SURVIVED 84 PASSING TESTS AND A TYPECHECK, and the reason is the useful
 * part: **brace counting does not catch it.** Removing one `}` does not unbalance
 * the file — the rules after it are simply re-parented into the media block, and
 * the depth still returns to zero at EOF. A gate that counts braces would have
 * passed this bug forever.
 *
 * So the load-bearing assertion is not balance. It is: *which media condition is
 * this rule inside?* A rule that belongs to the phone must report the phone.
 */
type TopRule = {
  readonly selector: string;
  readonly declarations: string;
  /** The `@media` condition this rule is inside, or null at the top level. */
  readonly inMedia: string | null;
};

function topLevelRules(): TopRule[] {
  const out: TopRule[] = [];
  // Only at-rules open a scope that later rules belong to, and this stylesheet
  // does not nest one media query inside another — so a plain depth counter is
  // enough and much easier to reason about than a stack.
  let media: string | null = null;
  let selStart = 0;
  let i = 0;
  while (i < RULES.length) {
    if (RULES[i] === '{') {
      const selectorText = RULES.slice(selStart, i).trim();
      let depth = 0;
      let end = -1;
      for (let j = i; j < RULES.length; j += 1) {
        if (RULES[j] === '{') depth += 1;
        else if (RULES[j] === '}') {
          depth -= 1;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end === -1) break;

      if (selectorText.startsWith('@media')) {
        // Entering a media query: everything until its closing brace is inside it.
        const inner = topLevelRulesFrom(RULES.slice(i + 1, end), selectorText);
        for (const r of inner) out.push(r);
        selStart = end + 1;
        i = end + 1;
        // Skip past the query's own closing brace without treating it as content.
        continue;
      }
      if (selectorText.startsWith('@')) {
        // @keyframes / @supports: a scope, but not a media condition.
        selStart = end + 1;
        i = end + 1;
        continue;
      }
      out.push({
        selector: selectorText,
        declarations: RULES.slice(i + 1, end),
        inMedia: media,
      });
      selStart = end + 1;
      i = end + 1;
      continue;
    }
    i += 1;
  }
  void media;
  return out;
}

/** Rules inside a media query's body, all attributed to `condition`. */
function topLevelRulesFrom(body: string, condition: string): TopRule[] {
  const out: TopRule[] = [];
  let selStart = 0;
  let i = 0;
  while (i < body.length) {
    if (body[i] === '{') {
      const sel = body.slice(selStart, i).trim();
      let depth = 0;
      let end = -1;
      for (let j = i; j < body.length; j += 1) {
        if (body[j] === '{') depth += 1;
        else if (body[j] === '}') {
          depth -= 1;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end === -1) break;
      if (!sel.startsWith('@')) {
        out.push({ selector: sel, declarations: body.slice(i + 1, end), inMedia: condition });
      }
      selStart = end + 1;
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

describe('every rule sits in the media query it is meant to be in', () => {
  it('the tab-panel rule that hides the mat, market and log is PHONE-ONLY', () => {
    /*
     * This is the assertion that would have caught the defect above, and it is
     * structural rather than stylistic: on a desktop the mat, market and log are
     * COLUMNS in the side rail, not tabs. Hiding them unconditionally leaves a
     * player with a board and nothing else.
     */
    const rules = topLevelRules();
    const hidden = rules.filter(
      (r) =>
        r.selector.includes('[data-tabpanel]') &&
        /display:\s*none/.test(r.declarations),
    );
    expect(hidden.length, 'the tab-panel hide rule must exist').toBeGreaterThan(0);
    for (const r of hidden) {
      expect(
        r.inMedia,
        `"${r.selector}" must be inside a @media query, not global`,
      ).not.toBeNull();
      expect(r.inMedia).toMatch(/max-width:\s*599px/);
    }
  });

  it('the phone dialog rules are inside the phone query and nowhere else', () => {
    // If `max-height: 100dvh` escapes its media query, every dialog on a desktop
    // becomes a phone sheet. Same class of bug, asserted on the rules I added.
    const rules = topLevelRules();
    const phoneSheets = rules.filter(
      (r) => r.selector === '.sheet' && /100dvh/.test(r.declarations),
    );
    expect(phoneSheets.length, 'exactly one .sheet rule may carry 100dvh').toBe(1);
    expect(phoneSheets[0]?.inMedia).toMatch(/max-width:\s*599px/);

    // The tab bar and the END TURN dock are phone chrome: hidden by DEFAULT and
    // switched on inside the phone query. That is the correct direction, and the
    // bug to catch is the reverse — a rule that HIDES something globally which
    // should be a desktop column. So assert the intended pair exists.
    for (const selector of ['.tabbar', '.endturn-dock']) {
      const rules = topLevelRules().filter((r) => r.selector === selector);
      expect(rules.length, `${selector} must exist`).toBeGreaterThan(0);
      const base = rules.find((r) => r.inMedia === null);
      expect(base, `${selector} must have a base rule`).toBeDefined();
      expect(base?.declarations, `${selector} is hidden by default on desktop`).toMatch(
        /display:\s*none/,
      );
      const phone = rules.find((r) => r.inMedia !== null);
      expect(phone, `${selector} must be switched on inside the phone query`).toBeDefined();
      expect(phone?.declarations).toMatch(/display:\s*flex|display:\s*block/);
    }
  });

  it('the base .sheet rule is the desktop one: border-box, no phone max-height', () => {
    const base = topLevelRules().find((r) => r.selector === '.sheet' && r.inMedia === null);
    expect(base, 'the base .sheet rule must exist').toBeDefined();
    expect(base?.declarations).toMatch(/box-sizing:\s*border-box/);
    expect(base?.declarations).not.toContain('100dvh');
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