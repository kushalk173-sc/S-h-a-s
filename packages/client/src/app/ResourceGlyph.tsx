/**
 * The four resource glyphs.
 *
 * UI-SPEC §3.4, implemented. The spec drew them and nothing built them: the four
 * `IDEO_INK_*` tokens existed from §2.7 and were applied in exactly one place
 * (the manifesto pip track, `app.css:562-565`), so on every actual resource
 * surface — the mat strip, the market price, the trade steppers, the power
 * dialogs — the four denominations were four grey numerals and, on the market
 * card, four single letters (`2 F · 3 T`).
 *
 * WHY THEY EXIST AT ALL, since §2.7 says colour is not the identity channel
 * ----------------------------------------------------------------------------
 * §2.7's three mitigations are mandatory and mitigation 1 is "resource identity
 * is an icon, not a colour". That is not a preference; it is what stops a
 * resource from being mistaken for a peg, because the inks are deliberately
 * desaturated near-monochrome and two of them sit near seat colours. So this
 * file is not an alternative to the inks — it is the thing that makes the inks
 * *legal* to use widely. Colour is the redundant second channel here; the glyph
 * is the one that survives greyscale, low vision, and a player who has never
 * opened the box.
 *
 * CONSTRUCTION (normative, from §3.4)
 *  - 20×20 viewBox, 2px stroke, `currentColor`, **no fill** — identical rules to
 *    the board glyphs (§4.5), so a resource token and a peg look like they came
 *    off the same press.
 *  - `stroke-linecap: round` on every path.
 *  - 18px rendered inside the 22px token disc. The viewBox is 20 so the 1px
 *    breathing room is in the geometry, not in a negative margin.
 *
 * NO SPARKLES. §3.4 forbids them on Media and §9.9 forbids them generally:
 * "game-y" is a style, not a flourish.
 *
 * Decorative, and `aria-hidden`: every surface that renders a glyph also renders
 * the denomination in text (`res__name`, `picker__name`, or the market card's
 * letter), and the `aria-label` on each interactive control already names the
 * resource in full. A glyph announced as "graphic" would be noise.
 */

import type { Resource } from '@shasn/engine';

/**
 * The four paths, in `RESOURCE_ORDER` (`derive.ts:151`) — funds, clout, media,
 * trust — which is also the engine's `state.ts:RESOURCES` order and the order the
 * Ideologues are printed in. Kept as one array so the mapping cannot drift from
 * a hand-maintained record of four entries in five places.
 */
const GLYPH_PATHS: Readonly<Record<Resource, readonly string[]>> = {
  // FUNDS — the rupee, drawn as paths rather than set as a glyph because the
  // font stack (`--font-display`, Bitter/Georgia) has no reliable ₹ and a
  // missing glyph renders as tofu, which on a payment screen is a lie.
  // Two bars, a stem, and the leg sweeping from the right end of the lower bar
  // down to the stem's foot — the leg lands ON the stem's baseline, which is what
  // makes it read as ₹ and not as a 2 with a bar through it.
  funds: [
    'M4 5 H16',
    'M4 8.5 H16',
    'M8 8.5 V16',
    'M16 8.5 C 14.5 11.5 11.5 14 8 16',
  ],
  // CLOUT — the raised fist. A rounded-rect palm, four knuckle ridges standing
  // on its top edge, and the thumb as a wedge across the palm's left.
  clout: [
    'M3.5 11.5 A2 2 0 0 1 5.5 9.5 H14 A2 2 0 0 1 16 11.5 V14 A2 2 0 0 1 14 16 H5.5 A2 2 0 0 1 3.5 14 Z',
    'M3.9 9.5 V8.2 A1.2 1.2 0 0 1 6.3 8.2 V9.5',
    'M6.85 9.5 V8.2 A1.2 1.2 0 0 1 9.25 8.2 V9.5',
    'M9.8 9.5 V8.2 A1.2 1.2 0 0 1 12.2 8.2 V9.5',
    'M12.75 9.5 V8.2 A1.2 1.2 0 0 1 15.15 8.2 V9.5',
    'M3.5 12.8 L6.8 11',
  ],
  // MEDIA — the megaphone. Cone narrow at the mouth, flaring right, and two
  // sound arcs. Both arcs sweep clockwise (sweep-flag 1) from a downward chord,
  // which bulges them to the RIGHT, away from the cone.
  media: ['M3.5 9.5 L12.5 6.5 V14.5 L3.5 11.5 Z', 'M14.3 8.6 A2.4 2.4 0 0 1 14.3 12.4', 'M16.2 6.4 A4.6 4.6 0 0 1 16.2 14.6'],
  // TRUST — clasped hands. Two mirrored arms, each with a 2.6-radius mitten arc
  // at the cuff, crossing in the middle rather than meeting: the overlap is what
  // makes it a clasp and not an X.
  trust: ['M3 16 V10.5 A2.6 2.6 0 0 1 7.6 9.6 L13.4 13.6', 'M17 16 V10.5 A2.6 2.6 0 0 0 12.4 9.6 L6.6 13.6'],
};

export type ResourceGlyphProps = {
  /** Which denomination. Drives the path set and nothing else. */
  readonly resource: Resource;
  /**
   * Rendered px square. Defaults to §3.4's 18px. The stroke scales WITH the box
   * (`vector-effect` is deliberately NOT used): §3.4's 2px is specified at 18px,
   * and a glyph whose stroke stays 2px at 12px reads as a blob, which is the one
   * thing a 12px glyph is for.
   */
  readonly size?: number;
  /** Test hook. The `data-res` on the wrapping element is the real assertion target. */
  readonly testId?: string;
};

/**
 * One denomination's glyph, in the caller's colour.
 *
 * `currentColor` is the whole contract: it takes `--res-ink` off the nearest
 * `data-res` ancestor, so the same component is the coloured one on the mat and
 * whatever the surrounding context asks for inside a button that is already
 * tinted. Nothing here knows a hex value.
 */
export function ResourceGlyph({ resource, size = 18, testId }: ResourceGlyphProps) {
  return (
    <svg
      className="res__glyph"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid={testId ?? `glyph-${resource}`}
    >
      {GLYPH_PATHS[resource].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export default ResourceGlyph;