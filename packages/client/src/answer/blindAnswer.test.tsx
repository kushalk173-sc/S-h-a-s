/**
 * The answer card's symmetry test. The filename keeps its `blind` because the class names
 * do, and because the AVERAGE mechanic — which side of the card a display position is — is
 * still what this file guards.
 *
 * §8.8: "Test the symmetry, don't assume it: a unit test asserting
 * `getComputedStyle` equality on every property in the §1.2 contract table, for
 * both sides, in both orderings, is a release gate. It is the cheapest possible
 * guard on the game's central mechanic."
 *
 * §1.1 quoted "the blind answer is the product; everything else is table furniture", and §1.2
 * quoted "a design that is 5% better at everything else and leaks one bit is a failed design".
 * **The payout half of that sentence no longer applies** — full information publishes the
 * whole card — so the "one bit" that must not leak is now the `order` draw and nothing else,
 * and the measurement that says so is in `packages/server/src/FULL-INFORMATION.md` §6: position 0
 * holds the Capitalists' answer in 34 of the shipped 76 cards.
 *
 * So this file has three jobs, and all three are gates rather than smoke tests:
 *
 *   1. BOTH SIDES COMPUTE TO IDENTICAL STYLES. Every property in the §1.2
 *      contract table, on both sides, in BOTH orderings, and in the chosen
 *      state. Plus a guard that the CSS actually reached the document, because
 *      without `css: true` in vitest.config.ts this whole file would pass
 *      vacuously. **And this is the gate with new teeth:** the fixture's two sides carry
 *      DIFFERENT Ideologues and DIFFERENT payouts, so anything that tinted a face by either
 *      would fail here — which, with the Ideologue printed on the card, is exactly the
 *      position leak.
 *   2. THE ORDER IS SEED-DERIVED AND ACTUALLY VARIES. If the draw collapsed to
 *      a constant, the positional bias would come straight back — and per §6 of the record
 *      that bias is large enough to be worth a game.
 *   3. THE WHOLE CARD IS ON SCREEN, AND THE `order` DRAW IS NOT. The type-level half of the
 *      surviving guarantee lives in `blindAnswer.types.ts` and is gated by
 *      `npm run typecheck`; this is the runtime half, and it works by smuggling an `order`
 *      past the types with a cast and asserting the DOM is byte-identical to a clean
 *      render's.
 */

import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import {
  BlindAnswer,
  commitLabel,
  commitStatus,
  hashSeed,
  orderedSides,
  presentationOrder,
  type CommitState,
} from './BlindAnswer';
// `?raw` gives the stylesheet source itself, so the symmetry audit reads the
// file that ships rather than a processed approximation of it. Bundler-native,
// so it works under any cwd.
import css from './blindAnswer.css?raw';
import '../theme/tokens.css';

const QUESTION = 'The trusts have quietly bought the land your party needs for a bypass. Do you let the deal stand, or sue?';
const LABEL_A = 'Sue them and stall the project for three years.';
const LABEL_B = 'Let it stand. The bypass goes in, and the party gets the credit.';

/** Side A as the server sends it under full information: label, Ideologue, payout. */
const SIDE_A = { label: LABEL_A, ideologue: 'idealist', pays: { funds: 4, trust: 1 } } as const;
/** Side B. A DIFFERENT Ideologue and a smaller payout, which is the case that matters. */
const SIDE_B = { label: LABEL_B, ideologue: 'capitalist', pays: { funds: 1 } } as const;

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

/**
 * `jest-dom` is not a dependency of this package, so the two matchers this file
 * needs are read straight off the DOM rather than added for six assertions.
 */
function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled;
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
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
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
        <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={seed} />,
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
          sideA={SIDE_A}
          sideB={SIDE_B}
          seed={1}
          selected={side}
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
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
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
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
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
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
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
    const one = render(<BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={ab} />);
    const firstOrder = sides(one.container).map((s) => s.getAttribute('data-wire-side'));
    const firstLabels = sides(one.container).map((s) => s.textContent);
    one.unmount();

    const two = render(<BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={ba} />);
    const secondOrder = sides(two.container).map((s) => s.getAttribute('data-wire-side'));
    const secondLabels = sides(two.container).map((s) => s.textContent);
    two.unmount();

    // Position swaps…
    expect(firstOrder).toEqual(['A', 'B']);
    expect(secondOrder).toEqual(['B', 'A']);
    // …while the WHOLE SIDE follows it. A player cannot learn "the long one is always
    // on the right", "the Trusts' answer is always first", or — and this is the part
    // that only became checkable under full information — "the Capitalists' answer is
    // always on the left". A side is label, Ideologue and payout together, and all
    // three move as one.
    const wholeSide = (label: string, side: typeof SIDE_A | typeof SIDE_B): string =>
      `${label}${side.ideologue === 'idealist' ? "the Idealists'" : "the Capitalists'"} answerpays ${
        side.ideologue === 'idealist' ? '4 Fund · 1 Trust' : '1 Fund'
      }`;
    expect(firstLabels).toEqual([wholeSide(LABEL_A, SIDE_A), wholeSide(LABEL_B, SIDE_B)]);
    expect(secondLabels).toEqual([wholeSide(LABEL_B, SIDE_B), wholeSide(LABEL_A, SIDE_A)]);
  });
});

/**
 * FULL INFORMATION: the whole card is on screen, and the only thing that cannot reach
 * the DOM is the `order` draw.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THIS DESCRIBE USED TO ASSERT THE OPPOSITE, and the replacement is stated first
 * because a reader who only reads the old comment would be misled about what the
 * component does.
 *
 * It was called `no payout can reach the DOM`, and every test in it was about a card
 * whose payout and Ideologue were withheld. Full information reverses that: the server
 * publishes the whole card to every seat (`PublicQuestion` in the server's
 * `broadcast.ts`), so the question, both answers, both Ideologues and both payouts are
 * now on the card from the first frame, and the tests below assert THAT rather than its
 * absence.
 *
 * What is still forbidden is the one field that remains: `order`, the seed-derived face
 * order. With the Ideologue printed beside each answer, a client that knew `order` could
 * publish which Ideologue the left-hand position is — the channel PLAN.md §2 amendment A′
 * exists to prevent, and the last surviving property of the old design. So: no prop
 * carries it, no `order` key appears in the DOM, and nothing in the markup encodes it.
 */
describe('the whole card is on screen, and the `order` draw is not', () => {
  it('renders the scenario, both answers, both Ideologues and both payouts', () => {
    const { container } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    expect(container.querySelector('[data-testid="scenario"]')?.textContent).toBe(QUESTION);

    // The three lines per side, in the order the card prints them.
    const faction = [...container.querySelectorAll('[data-testid="side-ideologue"]')].map((e) => e.textContent);
    expect([...faction].sort()).toEqual(["the Capitalists' answer", "the Idealists' answer"].sort());
    const payout = [...container.querySelectorAll('[data-testid="side-payout"]')].map((e) => e.textContent);
    expect([...payout].sort()).toEqual(['pays 1 Fund', 'pays 4 Fund · 1 Trust'].sort());

    // …and the whole prompt is EXACTLY those parts, in DOM order. Built from the
    // pieces the component rendered rather than from hard-coded prose, so a rewording
    // that added something could not pass and one that dropped something could not
    // either — and read per-SIDE, because that is the order they appear in: a side is
    // its label, then its Ideologue, then its payout, and they travel together.
    const perSide = [...sides(container)].map((el) => [
      el.querySelector('[data-testid="side-label"]')?.textContent ?? '',
      el.querySelector('[data-testid="side-ideologue"]')?.textContent ?? '',
      el.querySelector('[data-testid="side-payout"]')?.textContent ?? '',
    ]);
    const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toBe(
      [
        QUESTION,
        'CHOOSE ONE',
        ...perSide.flat(),
        commitLabel('idle'),
        commitStatus('idle'),
      ].join(''),
    );
  });

  it('names every pool the card prints, and only those', () => {
    // The rule the old version asserted inverted. A `Delta` is PARTIAL: a pool the
    // card does not mention is absent, not zero, so "pays 1 Fund" must not print Clout,
    // Media or Trust as zeroes — a player reading "0 Clout" would learn nothing and a
    // reader of the card would learn something false.
    const { container } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    const b = [...container.querySelectorAll('[data-testid="side-payout"]')].find(
      (e) => e.textContent === 'pays 1 Fund',
    );
    expect(b?.textContent).toBe('pays 1 Fund');
    for (const absent of ['Clout', 'Media', 'Trust', '₹']) {
      expect(b?.textContent ?? '', `${absent} must not be printed for a side that does not pay it`).not.toContain(absent);
    }
    // And a side that pays nothing at all says so, rather than printing an empty line.
    const { container: flat } = render(
      <BlindAnswer
        question={QUESTION}
        sideA={{ label: 'a', ideologue: 'supremo', pays: {} }}
        sideB={{ label: 'b', ideologue: 'showstopper', pays: {} }}
        seed={1}
      />,
    );
    expect(flat.querySelector('[data-testid="side-payout"]')?.textContent).toBe('pays nothing');
  });

  it('carries NO `order`, and no attribute or node that could stand in for it', () => {
    const { container } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    // No `order` anywhere in the markup, and no attribute a stylesheet could key the
    // position's identity on: the only data attribute is `data-wire-side`, which is the
    // wire side ('A'/'B') and not the card's side — mapping it back needs the `order`
    // this component cannot see.
    expect(container.innerHTML).not.toMatch(/order/i);
    const attrs = new Set<string>();
    for (const el of container.querySelectorAll('*')) {
      for (const a of el.attributes) attrs.add(a.name);
    }
    for (const forbidden of ['data-side', 'data-ideologue', 'data-pays', 'data-face']) {
      expect([...attrs], `${forbidden} would let CSS key the position's Ideologue`).not.toContain(forbidden);
    }
    // The Ideologue and the payout are TEXT, so a per-side rule would need a selector
    // over the text — which the stylesheet audit below forbids.
    for (const el of container.querySelectorAll('.blind-answer__faction, .blind-answer__payout')) {
      expect(el.className).toBe(el.className.trim());
      expect(el.getAttribute('style')).toBeNull();
      expect(el.getAttribute('title')).toBeNull();
    }
  });

  it('has no element that could carry a value out of band: no icon, meter, bar or title', () => {
    const { container } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    // UI-SPEC §9 anti-patterns 1 and 3 survive the reversal of the payout ban: there is
    // still no icon, no meter and no `title` tooltip, because a graphical reading of a
    // number is a number that can be compared between the two sides at a glance in a way
    // prose is not — and the payout is the one thing both seats may read.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('progress')).toBeNull();
    expect(container.querySelector('meter')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
    for (const el of sides(container)) expect(el.getAttribute('aria-label')).toBeNull();
  });

  it('drops an `order` smuggled past the types, rather than rendering it', () => {
    // The runtime half of guarantee 3. Even with the types bypassed by a cast, an
    // `order` prop has nowhere to go: it is not read, so it cannot be rendered.
    const smuggled = {
      question: QUESTION,
      sideA: SIDE_A,
      sideB: SIDE_B,
      seed: 1,
      order: 'ba',
      faceA: 1,
      cardId: 'id-core-001',
    } as unknown as React.ComponentProps<typeof BlindAnswer>;

    const clean = render(<BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />);
    const smuggledRender = render(<BlindAnswer {...smuggled} />);
    expect(smuggledRender.container.innerHTML).toBe(clean.container.innerHTML);
  });

  it('reports only the wire side on selection — never a value', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} onSelect={onSelect} />,
    );
    for (const el of sides(container)) fireEvent.click(el);
    const reported = onSelect.mock.calls.map((c) => c[0]).sort();
    // Exactly the two wire sides, once each. Not numbers, not objects.
    expect(reported).toEqual(['A', 'B']);
    for (const arg of onSelect.mock.calls.flat()) {
      expect(['A', 'B']).toContain(arg);
    }
  });
});


/**
 * THE REGRESSION GATE FOR THE TWO-COMMIT-CONTROLS DEFECT.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `BlindAnswer` rendered a button labelled "Confirm" which, after a
 * click, read "Answer committed" — but that click only SELECTED a side.
 * `AnswerScreen` rendered a second control, "COMMIT ANSWER", and that was the one
 * that actually dispatched `ANSWER` to the server. So a player who pressed
 * "Confirm" was told, by the most safety-critical screen in the game, that their
 * answer had been committed when it had not been sent. The premise of the whole
 * mechanic is that nothing about the payout is visible before the commit; a
 * control that lies about having committed is the same class of failure one step
 * along.
 *
 * WHY THIS IS A TEST AND NOT A WORDING REVIEW. Every assertion below is about
 * behaviour — which callback fires, what the label says, whether the control is
 * disabled — rather than about the presence of a substring. A future edit that
 * reintroduced a second committing control, or moved the commit back into local
 * state, fails here instead of in a screenshot.
 */
describe('exactly one control commits, and it is the only one that says so', () => {
  it('pressing a side SELECTS and never commits — the defect itself', () => {
    const onCommit = vi.fn();
    // The component is CONTROLLED: it holds no state of its own, so the harness
    // stands in for `AnswerScreen` and mirrors the real wiring. This is the
    // point of the prop contract — the old defect was a component that decided
    // for itself that it had committed.
    function Harness() {
      const [selected, setSelected] = useState<'A' | 'B' | null>(null);
      return (
        <BlindAnswer
          question={QUESTION}
          sideA={SIDE_A}
          sideB={SIDE_B}
          seed={1}
          selected={selected}
          commitState={selected === null ? 'idle' : 'ready'}
          onSelect={setSelected}
          onCommit={onCommit}
        />
      );
    }
    const { container, getByTestId } = render(<Harness />);
    const commit = getByTestId('commit-answer');
    // Nothing chosen: the commit control is dead, and says why.
    expect(isDisabled(commit)).toBe(true);
    expect(commit.textContent).toBe(commitLabel('idle'));

    // THE WHOLE POINT: pressing the selection control does NOT commit.
    fireEvent.click(sides(container)[0]!);
    expect(onCommit, 'pressing a side must never send anything').not.toHaveBeenCalled();

    // It selected — the tick is on exactly one side — and it did not CLAIM to
    // have committed. The label is still the unsent one, with no "committed",
    // "sent" or "recorded" anywhere on the screen.
    expect(container.querySelectorAll('[data-testid="chosen-check"]')).toHaveLength(1);
    expect(commit.textContent).toBe(commitLabel('ready'));
    expect(container.textContent).not.toMatch(/committed|recorded/i);
    expect(container.textContent).not.toMatch(/\bsent\b/i);

    // And NOW the control is live — which is the only honest progression: a
    // selection arms the commit, and the commit is still the player's to press.
    expect(isDisabled(commit)).toBe(false);
  });

  it('the component renders exactly one button that can send, and it is the commit', () => {
    const onSelect = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <BlindAnswer
        question={QUESTION}
        sideA={SIDE_A}
        sideB={SIDE_B}
        seed={1}
        selected="A"
        commitState="ready"
        onSelect={onSelect}
        onCommit={onCommit}
      />,
    );

    // Three buttons: two sides, one commit. Anything more is a second path out.
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(3);
    const committing = buttons.filter((b) =>
      /commit|send/i.test(b.textContent ?? ''),
    );
    expect(committing, 'only the commit control may use commit/send wording').toHaveLength(1);

    // Only the commit button is wired to the sending callback. Pressing both
    // sides fires `onSelect` twice and `onCommit` zero times.
    fireEvent.click(sides(container)[0]!);
    fireEvent.click(sides(container)[1]!);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();

    // The commit control sends, and takes no side argument — the caller owns the
    // mapping, so there is no way for the component to send the wrong one.
    fireEvent.click(container.querySelector('[data-testid="commit-answer"]')!);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith();
  });

  it('the two steps never share a word: "choose" selects, "commit" sends', () => {
    const { container, getByTestId } = render(
      <BlindAnswer
        question={QUESTION}
        sideA={SIDE_A}
        sideB={SIDE_B}
        seed={1}
        selected="A"
        commitState="ready"
      />,
    );
    const choose = getByTestId('choose-label').textContent ?? '';
    const commit = getByTestId('commit-answer').textContent ?? '';
    expect(choose).toMatch(/choose/i);
    expect(commit).toMatch(/commit/i);
    // No shared verb. "Confirm" is the word that caused it: it reads as a synonym
    // for committing, so it may not appear anywhere on this screen.
    const all = (container.textContent ?? '').toLowerCase();
    expect(all, '"Confirm" may not appear on the blind answer').not.toContain('confirm');
  });

  it('commit state comes from the caller, so a failed dispatch cannot claim success', () => {
    const onCommit = vi.fn();
    // The prop is the ONLY source of commit state. Rendered in `ready` — a side
    // chosen, nothing sent — the button is live and says nothing about success.
    const { getByTestId, rerender } = render(
      <BlindAnswer
        question={QUESTION}
        sideA={SIDE_A}
        sideB={SIDE_B}
        seed={1}
        selected="A"
        commitState="ready"
        onCommit={onCommit}
      />,
    );
    expect(getByTestId('commit-answer').textContent).toBe(commitLabel('ready'));
    expect(isDisabled(getByTestId('commit-answer'))).toBe(false);

    // A frame IN FLIGHT is not a commit. The label must not claim it is sent.
    rerender(
      <BlindAnswer
        question={QUESTION}
        sideA={SIDE_A}
        sideB={SIDE_B}
        seed={1}
        selected="A"
        commitState="sending"
        onCommit={onCommit}
      />,
    );
    const inFlight = getByTestId('commit-answer');
    expect(isDisabled(inFlight)).toBe(true);
    expect(inFlight.textContent).toMatch(/sending/i);
    expect(inFlight.textContent, 'a frame in flight is not a committed answer')
      .not.toMatch(/sent|recorded|committed/i);
    // And it cannot be pressed twice.
    fireEvent.click(inFlight);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('once the server has it, the control is dead and says so unambiguously', () => {
    const onSelect = vi.fn();
    const onCommit = vi.fn();
    const { container, getByTestId } = render(
      <BlindAnswer
        question={QUESTION}
        sideA={SIDE_A}
        sideB={SIDE_B}
        seed={1}
        selected="A"
        commitState="committed"
        onSelect={onSelect}
        onCommit={onCommit}
      />,
    );
    const commit = getByTestId('commit-answer');
    expect(isDisabled(commit)).toBe(true);
    expect(commit.getAttribute('aria-disabled')).toBe('true');
    expect(commit.textContent).toBe(commitLabel('committed'));
    expect(getByTestId('commit-status').textContent).toBe(commitStatus('committed'));

    // Dead means dead: neither the commit nor the selection responds.
    fireEvent.click(commit);
    fireEvent.click(sides(container)[1]!);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    // The selection is locked too, so a late click cannot restate it.
    for (const side of sides(container)) expect(isDisabled(side)).toBe(true);
  });

  it('labels every state, and none of them says committed while in flight', () => {
    const states: readonly CommitState[] = ['idle', 'ready', 'sending', 'committed'];
    const labels = states.map(commitLabel);
    expect(new Set(labels).size, 'two states sharing a label is how this recurs').toBe(3);
    // Exactly ONE state may use the "it is in" wording, and it must be the
    // server-confirmed one.
    for (const [i, label] of labels.entries()) {
      if (i === states.indexOf('committed')) {
        expect(label).toMatch(/sent|recorded/i);
      } else {
        expect(label).not.toMatch(/sent|recorded|committed/i);
      }
    }
    // Every state's status line names a step, and none leaks a number.
    for (const state of states) {
      const status = commitStatus(state);
      expect(status.length).toBeGreaterThan(0);
      expect(status).not.toMatch(/\d/);
      expect(status).not.toMatch(/Funds|Clout|Media|Trust|₹/);
    }
  });

  it('a keyboard user gets the same single commit affordance', () => {
    const onCommit = vi.fn();
    const { container, getByTestId } = render(
      <BlindAnswer
        question={QUESTION}
        sideA={SIDE_A}
        sideB={SIDE_B}
        seed={1}
        selected="A"
        commitState="ready"
        onCommit={onCommit}
      />,
    );

    // The sides are real buttons with `aria-pressed`, so a screen reader reads
    // the selection state as pressed/not-pressed rather than as a styled class —
    // which is also what keeps the chosen state identical on both sides.
    // Looked up BY WIRE SIDE, not by position: which side is 'A' is the
    // seed-derived order, and a test that assumed position would be asserting a
    // fixed left/right layout — the exact thing §1.2 forbids.
    const bySide = new Map(sides(container).map((s) => [s.getAttribute('data-wire-side'), s]));
    // `selected="A"` above, so A is the pressed one and B is not.
    const chosen = bySide.get('A');
    const unchosen = bySide.get('B');
    expect(chosen?.tagName).toBe('BUTTON');
    expect(chosen?.getAttribute('aria-pressed')).toBe('true');
    expect(unchosen?.getAttribute('aria-pressed')).toBe('false');

    // The commit control is a real button with a name and a live-region status,
    // so the whole step is reachable and announced without sight or a mouse.
    const commit = getByTestId('commit-answer');
    expect(commit.tagName).toBe('BUTTON');
    expect(commit.textContent?.trim()).not.toBe('');
    expect(commit.getAttribute('aria-disabled')).toBe('false');
    expect(getByTestId('commit-status').getAttribute('role')).toBe('status');

    // The panel is a labelled group, so the two sides are announced as one
    // question with two options rather than as two loose buttons.
    const panel = getByTestId('panel');
    expect(panel.getAttribute('role')).toBe('group');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(container.querySelector(`#${labelledBy}`)).not.toBeNull();

    // Every interactive element is a native button, so Space and Enter both fire
    // it and nothing depends on a key handler that might be missed.
    const interactive = [...container.querySelectorAll('[onclick], [tabindex]')];
    expect(interactive).toHaveLength(0);
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
    // The permitted state qualifiers are all things BOTH sides share: the pointer
    // being over either, the keyboard being on either, either being the chosen
    // one, and either being locked because the answer is in flight. `:disabled`
    // qualifies because it is driven by the single `locked` flag above the
    // commit control — it is a statement about the ANSWER, not about a side.
    // Nothing here may distinguish A from B.
    const allowed =
      /^\.blind-answer__side(:hover|:focus|:focus-visible|:disabled|\[aria-pressed='true'\])?(\s+\.blind-answer__label)?$/;
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

/**
 * BOTH ANSWERS FIT THE VIEWPORT — the rule that keeps the published half of the card
 * on the screen.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, and why it is a source-level assertion rather than a jsdom one.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The audit measured, at 390px in real Chrome: side 0 at x 53→336, side 1 at
 * x 352→**625**. Answer B ran 235px past the right edge of a 390px viewport, with
 * `documentElement.scrollWidth === innerWidth` — so there was no scroll to reach it
 * and no element wider than the viewport to blame. The `.scrim` was clipping. On a
 * phone, one of the two answers was simply not there.
 *
 * TWO CAUSES, and the first is the one everybody gets wrong:
 *
 *   1. `grid-template-columns: 1fr 1fr` is `minmax(auto, 1fr)`, and a grid item's
 *      automatic minimum size is its MIN-CONTENT width. So each column was floored
 *      at the width its content refused to wrap under. `minmax(0, 1fr)` is what
 *      `1fr` is usually assumed to mean and is not.
 *   2. `.blind-answer__side` is a `<button>`, and a button has the same automatic
 *      minimum size. `min-width: 0` on the side removes the floor from the item as
 *      well as from the track.
 *
 * And with two columns even shrinkable, 390px leaves each answer ~172px — so below
 * 620px the panel collapses to ONE column and each answer takes the full width.
 *
 * jsdom performs no layout, so nothing here can measure a box; these assertions
 * are on the stylesheet SOURCE, which is what would have to change for the defect
 * to come back. The measured proof that both answers are inside a 390px viewport
 * is a browser measurement, and it is recorded in the commit that landed this.
 */
describe('the three lines of a side have three DIFFERENT types', () => {
  /**
   * THE PAYOUT HAD NO RULE AT ALL.
   *
   * Full information added two unstyled `<span>`s inside `.blind-answer__side`, and
   * the stylesheet had no rule for `.blind-answer__payout` or `.blind-answer__faction`
   * — so both inherited the answer label's every visual property: 17px, 700, INK_900,
   * the display serif. Inside a `flex-direction: row` that made the payout a 53px-wide,
   * five-line ragged strip reading "pays / 2 / Fund / · 1 / Media", with the Ideologue
   * as a second ragged strip beside it. The audit's closing judgement was that this is
   * "the least legible thing on the card" — and it is the one datum the full-information
   * ruling exists to publish.
   *
   * WHY IT SURVIVED EVERY GATE. Each existing assertion is about the two sides being
   * EQUAL to each other. The payout and the Ideologue are perfectly symmetric — both
   * sides carry the same class with the same inherited style — and completely
   * unreadable. Symmetry and legibility are orthogonal and only the first was under
   * test. So the assertion here is not "the payout is styled" but "the three lines
   * are styled DIFFERENTLY from each other", which is the property that was missing.
   *
   * These are computed styles, so they read the stylesheet that actually reached the
   * document — not a source regex. The values are literal px rather than a `font:`
   * token because jsdom does not expand shorthands, and the reason the side rule is
   * written in longhand is the same one.
   */
  function typeOf(container: HTMLElement, cls: string): Record<string, string> {
    const el = container.querySelector<HTMLElement>(`.${cls}`);
    expect(el, `${cls} rendered`).not.toBeNull();
    const cs = window.getComputedStyle(el as Element);
    const out: Record<string, string> = {};
    for (const prop of [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'text-align',
      'text-transform',
      'border-top-width',
      'border-top-style',
      'letter-spacing',
    ]) {
      out[prop] = cs.getPropertyValue(prop);
    }
    return out;
  }

  it('the payout has its own size, weight, leading and colour — not the label\'s', () => {
    const { container, unmount } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    const label = typeOf(container, 'blind-answer__label');
    const payout = typeOf(container, 'blind-answer__payout');

    // Real type, and not an accident of inheritance.
    expect(payout['font-size'], 'the payout needs its own font-size').toBe('15px');
    expect(payout['line-height'], 'and its own leading, or it is set solid').toBe('21px');
    expect(payout['font-weight']).toBe('700');
    // DIFFERENT from the answer's, which is the whole point: three lines, three
    // levels. 17px/23px for the prose, 15px/21px for the figure.
    expect(payout['font-size']).not.toBe(label['font-size']);
    expect(payout['line-height']).not.toBe(label['line-height']);
    // And a hairline above it, so it reads as a figure rather than as the last
    // sentence of the answer.
    expect(payout['border-top-width']).toBe('1px');
    expect(payout['border-top-style']).toBe('solid');
    expect(payout['text-align']).toBe('center');
    // Tabular figures, so two payouts compare down the column without the numerals
    // shifting when they differ in digit count. jsdom does not resolve
    // `font-variant-numeric`, so this one is read from the source.
    expect(CSS_RULES).toMatch(/\.blind-answer__payout\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/);
    unmount();
  });

  it('the Ideologue reads as an attribution, not as a second clause of the answer', () => {
    const { container, unmount } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    const label = typeOf(container, 'blind-answer__label');
    const faction = typeOf(container, 'blind-answer__faction');
    const payout = typeOf(container, 'blind-answer__payout');

    expect(faction['font-size']).toBe('13px');
    expect(faction['font-weight']).toBe('600');
    expect(faction['line-height']).toBe('16px');
    // The three levels are strictly ordered, so the eye can rank them at a glance:
    // the answer is the largest, the payout next, the attribution a caption.
    expect(Number(faction['font-size'].replace('px', ''))).toBeLessThan(
      Number(payout['font-size'].replace('px', '')),
    );
    expect(Number(payout['font-size'].replace('px', ''))).toBeLessThan(
      Number(label['font-size'].replace('px', '')),
    );
    // Tracked and uppercased, which is what makes a fragment read as a name rather
    // than as prose continuing the sentence above it.
    expect(faction['text-transform']).toBe('uppercase');
    expect(faction['letter-spacing']).not.toBe('normal');
    expect(faction['letter-spacing']).not.toBe(label['letter-spacing']);
    unmount();
  });

  it('the three lines stack down the card, side by side with nothing', () => {
    // The row was the reason the other two were squeezed: three flex children
    // competing for one line, each shrunk to its min-content width. A column is what
    // a printed card does, and it is one declaration covering both sides.
    const start = CSS_RULES.indexOf('.blind-answer__side {');
    const base = CSS_RULES.slice(start, CSS_RULES.indexOf('}', start));
    expect(base).toContain('flex-direction: column;');
    expect(base).not.toMatch(/flex-direction:\s*row/);
    // `align-items: center` (not `stretch`) so each line is its own natural width up
    // to its own max-width, instead of all three being stretched to the panel.
    expect(base).toContain('align-items: center;');
  });

  it('the payout and the Ideologue are the SAME on both sides, byte for byte', () => {
    // The hierarchy above must not become a channel. Each line is a single class
    // applied to both sides, so their computed styles are equal — and this is the
    // assertion that would fail first if anyone ever styled one of them per side.
    const { container, unmount } = render(
      <BlindAnswer question={QUESTION} sideA={SIDE_A} sideB={SIDE_B} seed={1} />,
    );
    const each = sides(container).map((side) => [
      typeOf(side, 'blind-answer__label'),
      typeOf(side, 'blind-answer__faction'),
      typeOf(side, 'blind-answer__payout'),
    ]);
    expect(each).toHaveLength(2);
    for (const line of [0, 1, 2]) {
      const [a, b] = each.map((e) => e[line]);
      expect(a, `line ${line} differs between the two sides`).toEqual(b);
    }
    unmount();
  });
});

describe('the three lines of a side are laid out by single-class rules', () => {
  it('neither new rule qualifies by side, position, or Ideologue', () => {
    // `blindAnswer.test.tsx`'s own stylesheet audit forbids a narrowed SIDE rule;
    // these two rules name a CHILD of the side, so that audit does not see them.
    // This is the assertion that covers the gap: a rule that reached into
    // `.blind-answer__side` to tint or resize one of its lines per side would publish
    // the position's Ideologue, which is the one channel PLAN.md 2 amendment A'
    // exists to prevent — and with the Ideologue printed on the card it is now a
    // real channel rather than a hypothetical one.
    const selectors = [...CSS_RULES.matchAll(/([^{}]+)\{/g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((s) => s.includes('blind-answer__payout') || s.includes('blind-answer__faction'));
    expect(selectors.length, 'both lines have a rule').toBeGreaterThanOrEqual(2);
    for (const selector of selectors) {
      expect(
        ['.blind-answer__payout', '.blind-answer__faction'],
        `"${selector}" qualifies a line rule`,
      ).toContain(selector);
    }
  });

  it('neither line is keyed on anything that arrives from the wire', () => {
    // No attribute selector anywhere in the stylesheet may mention a side, a face,
    // an Ideologue or a payout VALUE — the audit's `carries NO order` test proves
    // the markup has nothing to key on, and this proves the CSS does not go looking.
    //
    // `[aria-pressed]` is deliberately NOT in this list: the chosen state uses it, it
    // is a statement about the ANSWER rather than about a side, and it is drawn
    // identically whichever side is chosen (asserted above). What must never appear
    // is an attribute that says WHICH SIDE or WHAT it holds.
    for (const forbidden of [
      /\[data-wire-side/i,
      /\[data-side/i,
      /\[data-ideologue/i,
      /\[data-pays/i,
      /\[data-face/i,
    ]) {
      expect(CSS_RULES.match(forbidden), `blindAnswer.css must not contain ${forbidden}`).toBeNull();
    }
    // And no descendant selector reaches from a side to one of its lines at all.
    expect(CSS_RULES).not.toMatch(/\.blind-answer__side\s+\.blind-answer__/);
  });
});

describe('both answers fit the viewport, at every width', () => {
  it('the panel grid can shrink below its content — minmax(0, 1fr), never bare 1fr', () => {
    const decls = [...CSS_RULES.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1] ?? '');
    expect(decls.length, 'the panel declares its tracks').toBeGreaterThan(0);
    for (const value of decls) {
      // Delete every EXPLICITLY shrinkable track, then nothing may be left that
      // carries an automatic minimum: a bare `1fr` or an `auto` is `minmax(auto, …)`
      // wearing a hat, and both are the floor this whole fix is about.
      const rest = value.replace(/minmax\(\s*0\s*,\s*1fr\s*\)/g, '');
      expect(rest, `"${value}" contains a track that cannot shrink`).not.toMatch(/\b1fr\b/);
      expect(rest, `"${value}" contains an automatic minimum`).not.toMatch(/\bauto\b/);
    }
    // Spelled out, because the failure is easy to reintroduce by tidying.
    expect(CSS_RULES).not.toMatch(/grid-template-columns:\s*1fr\s+1fr/);
  });

  it('a side may shrink below its own min-content width', () => {
    const start = CSS_RULES.indexOf('.blind-answer__side {');
    const base = CSS_RULES.slice(start, CSS_RULES.indexOf('}', start));
    expect(base).toContain('min-width: 0;');
  });

  it('below 620px the two answers stack, so each gets the full width', () => {
    const at = CSS_RULES.indexOf('@media (max-width: 620px)');
    expect(at, 'the narrow-viewport rule exists').toBeGreaterThan(-1);
    // The INNER block: the first `{` after the media query's own is the rule's.
    const open = CSS_RULES.indexOf('{', at);
    const block = CSS_RULES.slice(open, CSS_RULES.indexOf('}', open));
    expect(block).toContain('.blind-answer__panel');
    // ONE shrinkable track, spelled out. Two tracks would be a comma OUTSIDE the
    // `minmax()`, and `auto` anywhere would reinstate the min-content floor this fix
    // exists to remove — in either form the phone goes back to two 172px columns and
    // answer B goes off the edge.
    const decl = /grid-template-columns:\s*([^;]+);/.exec(block);
    expect(decl, 'the narrow rule sets grid-template-columns').not.toBeNull();
    expect((decl?.[1] ?? '').trim()).toBe('minmax(0, 1fr)');
    expect(decl?.[1] ?? '').not.toContain('auto');
  });
});
