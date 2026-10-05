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
  // font stack (`--font-display`, Bitter/Georgia) has no reliable ₹ and a missing
  // glyph renders as tofu, which on a payment screen is a lie.
  //
  // Two bars, a stem, and the leg. The leg is a CUBIC, not a straight diagonal,
  // and that is the whole glyph: it leaves the right end of the lower bar going
  // straight DOWN and only then hooks left, which is the ₹'s silhouette. A
  // straight diagonal from the same two points was measured against both this
  // and the curve at 12/14/18px and reads as a "7" — the hook is what separates
  // "rupee" from "number with a bar through it".
  funds: ['M4.5 4.5 H15.5', 'M4.5 8.5 H15.5', 'M8 8.5 V16', 'M15.5 8.5 C 15.5 12 12.5 14.5 8 16'],
  // CLOUT — the raised fist. A palm block with a thumb lobe on its left and THREE
  // knuckle bumps on its top edge.
  //
  // Three, not four, and the bumps sit ON the silhouette rather than inside it.
  // Four interior knuckle arcs were drawn first, at the spec's "four 3px
  // knuckle arcs", and at 18px the four arcs and the palm merged into a single
  // rounded blob with no interior detail at all. Bumps on the outline survive
  // because they change the SHAPE; interior arcs do not survive because they only
  // change the fill. Two alternatives that read better at 110px (a vertical block
  // with finger divisions = a filing cabinet; a closed palm with scallops = a
  // crate) were both rejected at 18px.
  clout: [
    'M5 16.5 V11.5 H4 A1.75 1.75 0 0 1 4 8 H15 A1.75 1.75 0 0 1 15 11.5 V16.5 Z',
    'M7.5 8 V6.5 A1.25 1.25 0 0 1 10 6.5 V8',
    'M10 8 V6.5 A1.25 1.25 0 0 1 12.5 6.5 V8',
    'M12.5 8 V6.5 A1.25 1.25 0 0 1 15 6.5 V8',
  ],
  // MEDIA — the megaphone. Cone narrow at the mouth, flaring right, and two
  // sound arcs. Both arcs sweep clockwise (sweep-flag 1) from a downward chord,
  // which bulges them to the RIGHT, away from the cone.
  media: ['M3.5 9.5 L12.5 6.5 V14.5 L3.5 11.5 Z', 'M14.3 8.6 A2.4 2.4 0 0 1 14.3 12.4', 'M16.2 6.4 A4.6 4.6 0 0 1 16.2 14.6'],
  // TRUST — two interlocking links, offset vertically so they read as a chain.
  //
  // §3.4 SPECIFIED "clasped hands — two mirrored 4px mitten arcs overlapping",
  // AND THAT WAS ATTEMPTED AND MEASURED. A mitten needs a palm, a thumb and a
  // finger division to read as a mitten; at 18px with a 2px stroke those three
  // features are within one stroke-width of each other, and every construction
  // tried resolved into a different object at 18px: two arcs into a moustache, a
  // rounded palm into an arch, five fingers into a BAR CHART. Six candidates
  // were rendered at 110px, 18px, 14px and 12px before this one was chosen.
  //
  // The links keep the spec's actual construction — two mirrored rounded arcs,
  // overlapping — and drop only the noun. They survive 12px, and "bound together"
  // is the truer reading of the Idealist's resource anyway: Trust in Shasn is a
  // commitment you are held to, not a sentiment you are feeling.
  //
  // If a mitten is wanted back, the fix is a heavier stroke or a 28px token, not
  // a redrawn path. See docs/UI-SPEC.md §3.4.
  trust: [
    'M5.5 4 H8 A3.5 3.5 0 0 1 8 11 H5.5 A3.5 3.5 0 0 1 5.5 4 Z',
    'M12 8.5 H14.5 A3.5 3.5 0 0 1 14.5 15.5 H12 A3.5 3.5 0 0 1 12 8.5 Z',
  ],
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