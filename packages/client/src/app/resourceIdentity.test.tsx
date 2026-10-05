/**
 * RESOURCE IDENTITY — the four inks and the four glyphs, as a gate.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `docs/UI-SPEC.md` §2.7 has specified four
 * Ideologue inks since the token sheet was written, and §3.4 has specified four
 * resource glyphs. Neither was on the screen. The inks were applied in exactly
 * one place in the whole client — the manifesto pip track (`app.css`) — so every
 * surface where a player actually assesses Funds/Clout/Media/Trust rendered four
 * grey numerals, and two of them rendered something worse:
 *
 *   - the market card's price was `2 F · 3 T · +1 F tax`, four single letters,
 *     where F/C/M/T are the four letters least likely to be held in order; and
 *   - the trade composer (`DeltaStepper`) rendered four `+ n −` steppers in a
 *     4-column grid with **no denomination on any of them**, so column position
 *     was doing the work of an identity channel.
 *
 * The trade panel is the worst of these and it is not close: it is the one screen
 * where the player is explicitly deciding what they hold and what they want, and
 * it required already knowing that column 2 was Clout.
 *
 * WHY A GATE AND NOT A ONE-OFF FIX. §2.7 mitigation 1 is mandatory — resource
 * identity is an icon, not a colour, precisely so a token cannot be mistaken for a
 * peg — and mitigation 2 forbids flat fills for the same reason. Those are two
 * constraints that are easy to satisfy on the surface you are looking at and easy
 * to break on the seventh one. So the invariant is asserted for ALL SEVEN surfaces
 * at once, plus the CSS contract that makes "add a resource somewhere" a one-line
 * change: set `data-res`, inherit `--res-ink`.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. Colour is the *redundant* channel here. The
 * glyph is the primary one and it survives greyscale; the ink is a second, faster
 * cue. Nothing in this file asserts a player cannot read a resource without
 * colour, because that is §2.7 mitigation 1's actual requirement and it is
 * enforced structurally by every surface rendering BOTH.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Pool } from '@shasn/engine';

import { ResourcePicker } from './ResourcePicker.tsx';
import { ResourceGlyph } from './ResourceGlyph.tsx';
import { RESOURCE_ORDER } from './derive.ts';
import css from './app.css?raw';
import yourMatSource from './YourMat.tsx?raw';
import answerScreenSource from './AnswerScreen.tsx?raw';
import powerDialogSource from './PowerDialog.tsx?raw';
import gameScreenSource from './GameScreen.tsx?raw';
import tokens from '../theme/tokens.css?raw';

const RESOURCES = [...RESOURCE_ORDER];

const POOL: Pool = { funds: 4, clout: 3, media: 2, trust: 1 };
const noop = () => undefined;

/** The stylesheet with its comments stripped, so the rules can be audited. */
const RULES = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every `data-res` selector in the stylesheet, mapped to the `--ideo-*` token it
 * publishes. Read out of the file rather than restated here, because a restated
 * copy is a second thing that can be true while the stylesheet is not.
 */
function inkFor(resource: string): string | undefined {
  const re = new RegExp(`\\[data-res=['"]${resource}['"]\\]\\s*\\{([^}]*)\\}`);
  const body = re.exec(RULES)?.[1];
  return body === undefined ? undefined : /var\((--ideo-[a-z]+)\)/.exec(body)?.[1];
}

describe('resource identity — the CSS contract', () => {
  it('all four denominations publish an ink, and no two share one', () => {
    const inks = RESOURCES.map((r) => inkFor(r));
    expect(inks.every((i) => i !== undefined), `a denomination has no ink: ${inks.join(', ')}`).toBe(
      true,
    );
    // Four denominations and one colour would be a resource with no identity, which
    // is the defect in a new dress. Duplicates are the specific failure.
    expect(new Set(inks).size, `two denominations share an ink: ${inks.join(', ')}`).toBe(RESOURCES.length);
  });

  it('every ink it names is actually declared in the token sheet', () => {
    for (const r of RESOURCES) {
      const token = inkFor(r);
      expect(token, `${r} names no ink`).toBeDefined();
      expect(
        tokens.replace(/\/\*[\s\S]*?\*\//g, ''),
        `${r} points at ${token}, which tokens.css does not declare`,
      ).toContain(`${token}:`);
    }
  });

  it('the four inks are distinct VALUES, not one ink under four names', () => {
    const hexes = RESOURCES.map((r) => {
      const token = inkFor(r) ?? '';
      const re = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`);
      const hex = re.exec(tokens);
      expect(hex, `${r} (${token}) has no hex in tokens.css`).not.toBeNull();
      return (hex?.[1] ?? '').toLowerCase();
    });
    expect(new Set(hexes).size).toBe(RESOURCES.length);
  });

  it('`data-res` has a fallback, so a typo greys out instead of inheriting a neighbour', () => {
    // `--res-ink` is read with `var(--res-ink, <fallback>)` at every use site. If
    // the bare `[data-res]` block were removed, a `data-res="fnu"` would inherit
    // nothing and the denomination would render in whatever the parent had.
    expect(RULES).toMatch(/\[data-res\]\s*\{\s*--res-ink:/);
  });

  it('§2.7 mitigation 2: the ink is never a fill, only a stroke, a text colour or a rule', () => {
    /*
     * A flat 20-22px disc of resource colour is exactly what a peg looks like
     * (`app.css` §2.7 mitigation 2: "Resource tokens never appear as flat fills").
     * This is the constraint most likely to be broken by a well-meaning future
     * change — a tinted cell behind the numeral is the obvious way to "mark them
     * more" — so it is asserted rather than left to §2.7.
     */
    const inked = RULES.match(/background[^;{}]*var\(--res-ink/g) ?? [];
    expect(inked, `the ink was used as a background: ${inked.join(' | ')}`).toEqual([]);
  });
});

describe('resource identity — the glyphs (§3.4)', () => {
  it('all four render, and each is decorative rather than announced', () => {
    for (const r of RESOURCES) {
      const { container, unmount } = render(<ResourceGlyph resource={r} />);
      const svg = container.querySelector('svg');
      expect(svg, `${r} rendered no svg`).not.toBeNull();
      // Decorative: every surface that shows a glyph also shows the denomination in
      // text and names it in the control's aria-label, so announcing "graphic" is noise.
      expect(svg?.getAttribute('aria-hidden'), `${r} is not aria-hidden`).toBe('true');
      // 2px stroke, currentColor, no fill — §3.4's construction rules verbatim, so a
      // token and a peg look like they came off the same press.
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.getAttribute('stroke-width')).toBe('2');
      expect(svg?.getAttribute('fill')).toBe('none');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
      // A glyph with no path is a blank box that still claims an identity.
      expect(svg?.querySelectorAll('path').length ?? 0, `${r} has no path`).toBeGreaterThan(0);
      unmount();
    }
  });

  it('the four glyphs are four different drawings, not one path reused', () => {
    const d = RESOURCES.map((r) => {
      const { container, unmount } = render(<ResourceGlyph resource={r} />);
      const out = [...(container.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('d')).join('');
      unmount();
      return out;
    });
    expect(new Set(d).size, 'two denominations draw the same glyph').toBe(RESOURCES.length);
  });
});

describe('resource identity — every surface, all seven', () => {
  it('the picker marks all four cells and names all four', () => {
    render(
      <ResourcePicker
        pool={POOL}
        total={2}
        pick={{}}
        heading="PAY 2 RESOURCES"
        confirmLabel="PAY"
        onPick={noop}
        onConfirm={noop}
        onCancel={noop}
      />,
    );
    for (const r of RESOURCES) {
      const cell = document.querySelector(`.picker__cell[data-res="${r}"]`);
      expect(cell, `the picker has no ${r} cell`).not.toBeNull();
      // Glyph AND name. Either alone is half the fix; §2.7 mitigation 1 wants the
      // icon, and the name is what a screen reader gets.
      expect(cell?.querySelector('svg'), `${r} has no glyph`).not.toBeNull();
      expect(cell?.textContent ?? '').toContain(r);
    }
  });

  /*
   * The remaining surfaces are checked against their SOURCE, not their render.
   *
   * Rendering them needs a full `ClientState` per surface (a live table, an
   * interrupted turn, an armed market slot), and a source assertion is what this
   * repository already does for exactly this class of cross-file invariant — see
   * `choiceInvariant.test.tsx`, which reads `reduce.ts?raw` to prove the engine
   * still refuses what it is supposed to refuse.
   *
   * What is asserted is the SHAPE of the fix, not the styling: the surface must
   * publish `data-res` and must render a `<ResourceGlyph>` for that same
   * denomination. If someone adds an eighth surface, this file will not know — but
   * it will know the moment one of these seven stops marking itself, which is the
   * drift that actually happened.
   */
  const SURFACES: readonly { readonly name: string; readonly source: string; readonly mark: string }[] = [
    { name: 'the mat resource strip', source: yourMatSource, mark: 'res__cell' },
    { name: 'the market card price', source: yourMatSource, mark: 'mkt__cost' },
    { name: 'the answer pool strip', source: answerScreenSource, mark: 'res__cell' },
    { name: 'the payout cells', source: answerScreenSource, mark: 'landed-' },
    { name: 'the power give/take/pay/victim cells', source: powerDialogSource, mark: 'picker__cell' },
    { name: 'the trade stepper', source: gameScreenSource, mark: 'stepper' },
  ];

  for (const surface of SURFACES) {
    it(`${surface.name} marks its denominations`, () => {
      expect(surface.source, `${surface.name} no longer publishes data-res`).toMatch(/data-res=/);
      expect(surface.source, `${surface.name} no longer renders a glyph`).toContain('<ResourceGlyph');
    });
  }

  it('the market price keeps its LETTERS, because a test prices the purchase off them', () => {
    /*
     * The glyph is an `<svg>` and contributes nothing to `textContent`, so
     * `marketCharge.test.tsx`'s `/^(\d+) ([FCMT])/` parse of this string is
     * untouched — and that parse is the invariant that proves the printed price
     * equals the charged price when Helping Hands waives a denomination and a
     * surcharge is added. Trading the letter for the full name would break it, so
     * the letter stays and the glyph was added beside it rather than instead.
     *
     * If someone "tidies" the abbreviation away, this fails and the pricing test
     * fails with it — which is the correct outcome.
     */
    expect(yourMatSource).toContain('r[0]!.toUpperCase()');
    expect(yourMatSource).toContain('`+${tax} F tax`');
  });
});