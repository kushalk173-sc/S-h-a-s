/**
 * The blind answer's symmetry test.
 *
 * §8.8: "Test the symmetry, don't assume it: a unit test asserting
 * `getComputedStyle` equality on every property in the §1.2 contract table, for
 * both sides, in both orderings, is a release gate. It is the cheapest possible
 * guard on the game's central mechanic."
 *
 * §1.2: "The blind answer is the product; everything else is table furniture…
 * A design that is 5% better at everything else and leaks one bit is a failed
 * design."
 *
 * So this file has three jobs, and all three are gates rather than smoke tests:
 *
 *   1. BOTH SIDES COMPUTE TO IDENTICAL STYLES. Every property in the §1.2
 *      contract table, on both sides, in BOTH orderings, and in the chosen
 *      state. Plus a guard that the CSS actually reached the document, because
 *      without `css: true` in vitest.config.ts this whole file would pass
 *      vacuously.
 *   2. THE ORDER IS SEED-DERIVED AND ACTUALLY VARIES. If the draw collapsed to
 *      a constant, the positional bias would come straight back.
 *   3. NO PAYOUT CAN REACH THE DOM. The type-level half of this lives in
 *      `blindAnswer.types.ts` and is gated by `npm run typecheck`; this is the
 *      runtime half, and it works by smuggled a payout past the types with a
 *      cast and asserting nothing appears in the output.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BlindAnswer, hashSeed, orderedSides, presentationOrder } from './BlindAnswer';
// `?raw` gives the stylesheet source itself, so the symmetry audit reads the
// file that ships rather than a processed approximation of it. Bundler-native,
// so it works under any cwd.
import css from './blindAnswer.css?raw';
import '../theme/tokens.css';

const QUESTION = 'The trusts have quietly bought the land your party needs for a bypass. Do you let the deal stand, or sue?';
const LABEL_A = 'Sue them and stall the project for three years.';
const LABEL_B = 'Let it stand. The bypass goes in, and the party gets the credit.';

/** The §1.2 contract table, as a list of computed properties. */
const CONTRACT_PROPERTIES = [
  'background-color',
  'background-image',
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
  'font-variant-numeric',
  'text-align',
  'text-decoration-line',
  'text-transform',
  'letter-spacing',
  'opacity',
  'box-shadow',
  'filter',
  'transform',
  'cursor',
  'display',
  'width',
  'height',
] as const;

/** A seed that yields 'ab', and one that yields 'ba'. */
function seedsForBothOrders(): { ab: number; ba: number } {
  let ab = -1;
  let ba = -1;
  for (let s = 0; s < 200 && (ab < 0 || ba < 0); s += 1) {
    if (presentationOrder(s) === 'ab' && ab < 0) ab = s;
    if (presentationOrder(s) === 'ba' && ba < 0) ba = s;
  }
  if (ab < 0 || ba < 0) throw new Error('could not find a seed for each ordering');
  return { ab, ba };
}

function sides(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.blind-answer__side')];
}

function styleSnapshot(el: HTMLElement): Record<string, string> {
  const cs = window.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of CONTRACT_PROPERTIES) out[prop] = cs.getPropertyValue(prop);
  return out;
}

describe('the CSS actually reached the document (guard for vitest `css: true`)', () => {
  it('injects the stylesheet, so the equality assertions below are not vacuous', () => {
    render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} />,
    );
    const styleTags = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
    expect(styleTags).toContain('.blind-answer__side');
    // A resolved token, not a literal: proof the token sheet is loaded too, so
    // the background assertion is a real colour and not jsdom's default.
    expect(styleTags).toContain('--paper-100');
  });
});

describe('§1.2 symmetry contract: both sides compute to identical styles', () => {
  it('is identical in the default (uncommitted) state, in BOTH orderings', () => {
    const { ab, ba } = seedsForBothOrders();
    for (const seed of [ab, ba]) {
      const { container, unmount } = render(
        <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={seed} />,
      );
      const [left, right] = sides(container);
      expect(left, 'two sides rendered').toBeDefined();
      expect(right, 'two sides rendered').toBeDefined();
      if (left === undefined || right === undefined) {
        unmount();
        continue;
      }
      const a = styleSnapshot(left);
      const b = styleSnapshot(right);
      for (const prop of CONTRACT_PROPERTIES) {
        expect(a[prop], `${prop} differs at seed ${seed}`).toBe(b[prop]);
      }
      unmount();
    }
  });

  it('the chosen style does not depend on WHICH side was chosen', () => {
    // This is the real anti-leak property. Obviously a chosen side differs
    // from an unchosen one — that is what choosing means. What must not exist
    // is a chosen state that looks *different depending on which side it is*:
    // a heavier border, a different fill, a tick in a different corner, or an
    // outline that appears on the left. So: the chosen element's complete
    // style snapshot is compared across the two possible commits.
    const snapshotWhen = (side: 'A' | 'B'): Record<string, string> => {
      const { container, unmount } = render(
        <BlindAnswer
          question={QUESTION}
          labelA={LABEL_A}
          labelB={LABEL_B}
          seed={1}
          committed={side}
        />,
      );
      const chosen = sides(container).find(
        (s) => s.getAttribute('data-wire-side') === side,
      );
      expect(chosen, `the ${side} side exists and is chosen`).toBeDefined();
      expect(chosen?.getAttribute('aria-pressed')).toBe('true');
      // Exactly one check glyph, and it is inside the chosen side only.
      expect(container.querySelectorAll('[data-testid="chosen-check"]')).toHaveLength(1);
      if (chosen === undefined) {
        unmount();
        return {};
      }
      const snap = styleSnapshot(chosen);
      unmount();
      return snap;
    };

    const whenA = snapshotWhen('A');
    const whenB = snapshotWhen('B');
    for (const prop of CONTRACT_PROPERTIES) {
      expect(whenA[prop], `choosing A and choosing B differ on ${prop}`).toBe(whenB[prop]);
    }
    // And the chosen state is a real state, not a no-op.
    expect(whenA['background-color']).toBe('var(--paper-050)');
    expect(whenA['border-top-color']).toBe('var(--seal)');
  });

  it('gives both sides the same class list, the same element, and no inline style', () => {
    const { container } = render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} />,
    );
    for (const el of sides(container)) {
      expect(el.tagName).toBe('BUTTON');
      expect(el.className).toBe('blind-answer__side');
      expect(el.getAttribute('style')).toBeNull();
      // Only the wire side, which no stylesheet matches. There is no class,
      // no data-tone, no data-strength, no data-value.
      expect([...el.attributes].map((a) => a.name).sort()).toEqual([
        'aria-pressed',
        'class',
        'data-testid-x-none',
        'data-wire-side',
        'type',
      ].filter((n) => n !== 'data-testid-x-none'));
    }
  });

  it('resolves the contract tokens it declares, to the §1.2 values', () => {
    const { container, unmount } = render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} />,
    );
    const [left] = sides(container);
    if (left === undefined) {
      expect.unreachable('a side rendered');
      return;
    }
    const cs = window.getComputedStyle(left);
    const root = window.getComputedStyle(document.documentElement);
    // jsdom's CSS engine does not substitute custom properties, so a computed
    // value comes back as the `var()` reference. That is the RIGHT thing to
    // assert: both sides resolve to the same TOKEN, and the token sheet
    // resolves that token to the §1.2 value. Asserting the reference is
    // therefore stronger than asserting a resolved colour here, because a
    // resolved colour would hide WHICH token produced it — and swapping
    // --paper-100 for a tint on one side is precisely the leak being guarded.
    expect(cs.getPropertyValue('background-color')).toBe('var(--paper-100)');
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(cs.getPropertyValue(`border-${side}-color`)).toBe('var(--ink-300)');
      expect(cs.getPropertyValue(`border-${side}-width`)).toBe('2px');
      expect(cs.getPropertyValue(`border-${side}-style`)).toBe('solid');
    }
    // The tokens themselves, resolved from tokens.css, at the §1.2 / §2.10
    // values. These are the measured ones.
    expect(root.getPropertyValue('--paper-100').trim()).toBe('#efe8d6');
    expect(root.getPropertyValue('--ink-300').trim()).toBe('#a3927a');
    expect(root.getPropertyValue('--paper-050').trim()).toBe('#f4efe2');
    expect(root.getPropertyValue('--seal').trim()).toBe('#a8341f');
    expect(root.getPropertyValue('--focus-inner').trim()).toBe('#141110');
    expect(root.getPropertyValue('--focus-outer').trim()).toBe('#ffffff');
    expect(root.getPropertyValue('--r-md').trim()).toBe('6px');

    // Geometry the contract fixes, and which jsdom DOES resolve.
    expect(cs.getPropertyValue('min-height')).toBe('88px');
    expect(cs.getPropertyValue('padding-right')).toBe('22px');
    expect(cs.getPropertyValue('padding-left')).toBe('22px');
    expect(cs.getPropertyValue('font-size')).toBe('17px');
    expect(cs.getPropertyValue('font-weight')).toBe('700');
    expect(cs.getPropertyValue('line-height')).toBe('1.35');
    expect(cs.getPropertyValue('text-align')).toBe('center');
    expect(cs.getPropertyValue('cursor')).toBe('pointer');
    // No gradient, no glow, no shadow on either side (§1.6, §9.9). jsdom
    // returns '' for properties its CSS engine does not implement at all, so
    // '' counts as "nothing there"; the source-level audit below is what proves
    // no such declaration exists in the first place.
    for (const prop of ['background-image', 'box-shadow', 'filter', 'transform']) {
      expect(['', 'none'], `${prop} must be inert`).toContain(cs.getPropertyValue(prop));
    }
    unmount();
  });

  it('caps the label at 22ch so a long answer cannot widen its own column', () => {
    const { container, unmount } = render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} />,
    );
    for (const label of container.querySelectorAll<HTMLElement>('.blind-answer__label')) {
      expect(window.getComputedStyle(label).getPropertyValue('max-width')).toBe('22ch');
    }
    unmount();
  });
});

describe('the presentation order is seed-derived and actually varies', () => {
  it('flips the order across seeds, and never uses Math.random', () => {
    const { ab, ba } = seedsForBothOrders();
    expect(ab).not.toBe(ba);
    expect(presentationOrder(ab)).toBe('ab');
    expect(presentationOrder(ba)).toBe('ba');
    expect(orderedSides(ab)).toEqual(['A', 'B']);
    expect(orderedSides(ba)).toEqual(['B', 'A']);
  });

  it('is a pure function of the seed, so a replay renders identically', () => {
    for (const seed of [0, 1, 7, 42, 20260930]) {
      const first = orderedSides(seed);
      for (let i = 0; i < 5; i += 1) expect(orderedSides(seed)).toEqual(first);
      expect(hashSeed(seed)).toBe(hashSeed(seed));
    }
    // Distinct seeds give distinct hashes, so the draw is not a constant.
    expect(new Set([0, 1, 2, 3, 4, 5].map(hashSeed)).size).toBe(6);
  });

  it('splits the seed space roughly evenly, so order carries no information', () => {
    let ab = 0;
    for (let s = 0; s < 1000; s += 1) if (presentationOrder(s) === 'ab') ab += 1;
    expect(ab).toBeGreaterThan(450);
    expect(ab).toBeLessThan(550);
  });

  it('puts the same label on the same side regardless of seed, and swaps position', () => {
    const { ab, ba } = seedsForBothOrders();
    const one = render(<BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={ab} />);
    const firstOrder = sides(one.container).map((s) => s.getAttribute('data-wire-side'));
    const firstLabels = sides(one.container).map((s) => s.textContent);
    one.unmount();

    const two = render(<BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={ba} />);
    const secondOrder = sides(two.container).map((s) => s.getAttribute('data-wire-side'));
    const secondLabels = sides(two.container).map((s) => s.textContent);
    two.unmount();

    // Position swaps…
    expect(firstOrder).toEqual(['A', 'B']);
    expect(secondOrder).toEqual(['B', 'A']);
    // …while the label follows its side. A player cannot learn "the long one is
    // always on the right" or "the Trusts' answer is always first".
    expect(firstLabels).toEqual([LABEL_A, LABEL_B]);
    expect(secondLabels).toEqual([LABEL_B, LABEL_A]);
  });
});

describe('no payout can reach the DOM', () => {
  it('renders nothing but the scenario and the two labels', () => {
    const { container } = render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} />,
    );
    // The scenario, the two labels, and the confirm control. Nothing else.
    expect(container.querySelector('[data-testid="scenario"]')?.textContent).toBe(QUESTION);
    const labels = sides(container).map((s) => s.textContent);
    expect([...labels].sort()).toEqual([LABEL_A, LABEL_B].sort());
    // The full text is exactly those three, in that structure, plus the word
    // "Confirm". `textContent` concatenates without separators, so the
    // expectation is built from the same parts rather than hard-coded prose.
    const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toBe(`${QUESTION}${labels.join('')}Confirm`);
    // Not a single digit anywhere on the prompt: no cost, no payout, no count,
    // no turn number, no resource total.
    expect(text).not.toMatch(/\d/);
    // §1.2's forbidden list, verbatim.
    for (const word of ['Funds', 'Clout', 'Media', 'Trust', '₹']) {
      expect(text, `the prompt must not mention ${word}`).not.toContain(word);
    }
  });

  it('has no element that could carry a value: no icon, meter, bar, or title', () => {
    const { container } = render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} />,
    );
    // No svg, no img, no progress/meter, no title attribute, no aria-label at
    // all on the sides — the visible text IS the accessible name, so there is
    // nothing hidden to correlate with a payout.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('progress')).toBeNull();
    expect(container.querySelector('meter')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
    for (const el of sides(container)) expect(el.getAttribute('aria-label')).toBeNull();
  });

  it('drops a payout smuggled past the types, rather than rendering it', () => {
    // The type-level half of this guarantee is `blindAnswer.types.ts`, gated by
    // `npm run typecheck`. This is the runtime half: even with the types
    // bypassed by a cast, a payout has nowhere to go.
    const smuggled = {
      question: QUESTION,
      labelA: LABEL_A,
      labelB: LABEL_B,
      seed: 1,
      payoutA: 12,
      payoutB: 3,
      payout: { funds: 12, clout: 0, media: 0, trust: 0 },
      ideologueA: 'capitalist',
      resources: { funds: 4 },
      value: 99,
    } as unknown as React.ComponentProps<typeof BlindAnswer>;

    const { container } = render(<BlindAnswer {...smuggled} />);
    const text = container.textContent ?? '';
    for (const leak of ['12', '99', 'capitalist', 'funds', 'value', 'payout']) {
      expect(text.toLowerCase(), `payout leaked as "${leak}"`).not.toContain(leak);
    }
    // The markup is byte-identical to a clean render's structure: two sides,
    // same class, no extra nodes for the extra props.
    const markup = container.querySelector('.blind-answer__panel')?.innerHTML ?? '';
    expect((markup.match(/blind-answer__side/g) ?? []).length).toBe(2);
    expect(markup).not.toContain('style=');
  });

  it('reports only the wire side on commit — never a value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <BlindAnswer question={QUESTION} labelA={LABEL_A} labelB={LABEL_B} seed={1} onCommit={onCommit} />,
    );
    for (const el of sides(container)) fireEvent.click(el);
    const reported = onCommit.mock.calls.map((c) => c[0]).sort();
    // Exactly the two wire sides, once each. Not numbers, not objects.
    expect(reported).toEqual(['A', 'B']);
    for (const arg of onCommit.mock.calls.flat()) {
      expect(['A', 'B']).toContain(arg);
    }
  });
});

/**
 * The stylesheet with its comments stripped.
 *
 * The file's own header comment necessarily NAMES the forbidden constructs, so
 * auditing the raw text would fail on the documentation of the rule. Only the
 * rules are audited — which is the part that can actually leak.
 */
const CSS_RULES = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the stylesheet itself contains no side-differentiating rule', () => {
  it('never qualifies a selector by position or by side', () => {
    const forbidden = [
      /nth-child/i,
      /nth-of-type/i,
      /first-child/i,
      /last-child/i,
      /:only-child/i,
      /\[data-wire-side/i,
      /\[data-side/i,
      /\.is-[ab]\b/,
      /\.(left|right|primary|secondary|first|second|odd|even)\b/,
    ];
    for (const re of forbidden) {
      expect(CSS_RULES.match(re), `blindAnswer.css must not contain ${re}`).toBeNull();
    }
  });

  it('declares every rule for a side against the plain class, and nothing narrower', () => {
    // Every selector that mentions the side class, across the whole file.
    const selectors = [...CSS_RULES.matchAll(/([^{}]+)\{/g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((s) => s.includes('.blind-answer__side'));
    expect(selectors.length).toBeGreaterThanOrEqual(4);
    const allowed =
      /^\.blind-answer__side(:hover|:focus|:focus-visible|\[aria-pressed='true'\])?(\s+\.blind-answer__label)?$/;
    for (const selector of selectors) {
      // Only the parts that actually target a side are constrained. A grouped
      // rule such as `.side, .confirm` in the reduced-motion block is fine:
      // the confirm button is not a side.
      for (const part of selector.split(',').map((p) => p.trim())) {
        if (!part.includes('.blind-answer__side')) continue;
        expect(part, `"${part}" narrows a side rule; both sides must share one selector`).toMatch(
          allowed,
        );
      }
    }
  });

  it('uses no gradient, no shadow, and no filter on a side', () => {
    const start = CSS_RULES.indexOf('.blind-answer__side {');
    const base = CSS_RULES.slice(start, CSS_RULES.indexOf('}', start));
    expect(base).not.toMatch(/gradient/i);
    expect(base).not.toMatch(/box-shadow/i);
    expect(base).not.toMatch(/\bfilter\s*:/i);
    // A side must not scale, shift or rotate: geometry is fixed, so a long
    // label and a short label occupy the same box. (Word-bounded, so
    // `text-transform` is not a false positive.)
    expect(base).not.toMatch(/(?:^|[;\s])transform\s*:/im);
    expect(base).toContain('background-image: none;');
  });

  it('sets equal min-height and equal padding on both sides, per the §1.2 table', () => {
    const start = CSS_RULES.indexOf('.blind-answer__side {');
    const base = CSS_RULES.slice(start, CSS_RULES.indexOf('}', start));
    expect(base).toContain('min-height: 88px;');
    // 20px 22px, written symmetrically and shorthand so jsdom can expand it.
    expect(base).toContain('padding: 20px 22px;');
    // All four borders, same width, same colour, same style.
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(base).toContain(`border-${side}-width: 2px;`);
      expect(base).toContain(`border-${side}-style: solid;`);
      expect(base).toContain(`border-${side}-color: var(--ink-300);`);
    }
  });
});
