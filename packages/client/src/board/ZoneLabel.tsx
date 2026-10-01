/**
 * The zone label block.
 *
 * From the real board (`docs/AUTHENTIC-SHASN-REFERENCE.md` §6.1 layer 8,
 * VERIFIED): "Small-caps condensed name **above** a large `majority/capacity`
 * fraction, with a **tiny direction word below**." Three stacked elements,
 * centred on `ZoneSpec.label` — the anchor exists for exactly this.
 *
 * The lockup is the same three elements UI-SPEC §4.4 specifies, in the same
 * order, so the two documents agree on the object:
 *
 *      NORTH WEST                    TYPE_ZONE_NAME, 24 SVG px, tracking .06em
 *        6/11                        TYPE_ZONE_FRACTION, 28 SVG px, numeric
 *   ● CRIMSON · 8/17                 TYPE_ZONE_HOLDER 19 + tally chip
 *   ▔▔▔▔▔▔▔▔·▔▔▔▔▔▔▔▔▔                4px progress rule, tick at the threshold
 *
 * THREE CHANNELS AT ONCE for a held majority (§2.9), because colour is never
 * the only channel: an 18px filled seal disc before the name, a 3px seat
 * border on the zone (drawn by ZoneOutline), and the literal `● CRIMSON` text.
 * Remove colour and a majority zone is still unmistakable.
 */

import type { BoardZone, Point } from './types';

export const PROGRESS_RULE_W = 96;
export const PROGRESS_RULE_H = 4;
export const SEAL_DISC_R = 9;

export type ZoneLabelProps = {
  readonly zone: BoardZone;
  /** `ZoneSpec.label` — where the block is anchored. */
  readonly anchor: Point;
  /**
   * The unmodified `ZoneSpec.label`, kept so the group can report whether the
   * block had to move off it. A label that had to dodge its own slots is
   * recorded, not hidden — see `labelAnchors` in `./useBoardGeometry`.
   */
  readonly declaredAnchor?: Point;
  /** Pegs in this zone, majority or not. */
  readonly pegsFilled: number;
  /** Seat fill token of the majority holder, or null. */
  readonly holderFill: string | null;
  /** Display name of the majority holder, or null. */
  readonly holderName: string | null;
  /**
   * `⊘` — nobody holds gerrymanding rights here because it is tied
   * (`gerrymanderingRights()` returns null on a tie). Explicit "nobody" beats
   * an absent badge, which reads as "not loaded" (§4.4, G1).
   */
  readonly tied: boolean;
  /** Show `TYPE_ZONE_HOLDER`; false below the 500px board floor (§3.6.1). */
  readonly showHolder: boolean;
  /** `⚑ RIGHTS` / `⊘ NO RIGHTS` badge — both states, during a gerrymander (G1). */
  readonly showRightsBadge: boolean;
  readonly hasRights: boolean;
  /** `ONE ZONE` badge while a sameZone group is locked to this zone (§6.1.2). */
  readonly oneZoneLocked: boolean;
};

export function ZoneLabel({
  zone,
  anchor,
  declaredAnchor,
  pegsFilled,
  holderFill,
  holderName,
  tied,
  showHolder,
  showRightsBadge,
  hasRights,
  oneZoneLocked,
}: ZoneLabelProps) {
  const [x, y] = anchor;
  const { majority, capacity } = zone;
  const moved =
    declaredAnchor !== undefined &&
    (Math.abs(declaredAnchor[0] - x) > 0.5 || Math.abs(declaredAnchor[1] - y) > 0.5);

  /**
   * THE LABEL HALO — a defect found by rendering.
   * --------------------------------------------
   * On the rendered board the label lockup was printed straight through its own
   * constituency's voter dots and pegs: `CENTRAL 5/9 5/9` had pegs on both
   * numerals, and the full board put a jade peg through the `W` of `WEST`.
   * Moving the anchor off the dots fixes 6 of 9 zones, but North and South are
   * 21-slot grids with 61-unit row spacing, so no point in either zone clears a
   * 184-unit-wide footprint — no anchor move can save those two.
   *
   * The cartographic answer, and the one that does not hide information, is a
   * halo: `paint-order: stroke` paints the stroke UNDER the fill, so each glyph
   * gets a paper-coloured outline that separates it from whatever is behind it
   * while the glyph's own shape — and therefore its legibility — is untouched.
   * A solid backing plate would also work and would be worse: it would occlude
   * voter dots, which are the board's primary information.
   */
  const halo = {
    paintOrder: 'stroke' as const,
    stroke: 'var(--map-land)',
    strokeWidth: 5,
    strokeLinejoin: 'round' as const,
  };

  // The printed fraction. It is a static board element, not a computed HUD:
  // the number is printed on the physical board, so it never changes colour or
  // value when a majority forms. The numerator is set heavy and dark because it
  // is the number the player counts to; the denominator recedes.
  const fractionTspans = (
    <>
      <tspan fontWeight={800} fill="var(--ink-900)" data-testid="fraction-majority">
        {majority}
      </tspan>
      <tspan fontWeight={700} fill="var(--ink-500)" dx={2}>
        /{capacity}
      </tspan>
    </>
  );

  // The progress rule is a non-colour channel: the tick position is readable in
  // greyscale, and "filled to the tick" IS the majority.
  const fillFraction = Math.min(pegsFilled / majority, 1);
  const tickX = -PROGRESS_RULE_W / 2 + PROGRESS_RULE_W;

  const zoneLabel = [
    zone.name,
    `majority ${majority} of ${capacity}`,
    zone.majorityHolder !== null && holderName !== null ? `held by ${holderName}` : 'unheld',
  ].join(', ');

  /**
   * THE VERTICAL STACK — a defect found by rendering.
   * ---------------------------------------------
   * §4.4 draws the block as name / fraction+tally / holder / progress rule, and
   * the original implementation put the holder baseline at y=54 and the
   * progress rule at y=62. TYPE_ZONE_HOLDER is 19 units, so the holder's
   * descenders reach y≈59 and the 4-unit rule starts at 62 — and on the
   * rendered full board the seat-coloured rule was drawn straight THROUGH
   * `● ME` in West. Worse, the tie and rights lines were positioned relative to
   * `showHolder`, so dropping the holder line below the 500px floor moved them
   * onto the progress rule: every zone in the gerrymander render had
   * `⊘ NO RIGHTS` sitting on its own progress rule.
   *
   * The stack below is fixed, non-overlapping, and — importantly — IDENTICAL
   * whether or not the holder line is shown, so nothing shifts when the board
   * crosses the 500px floor.
   */
  const Y_NAME = 0;
  const Y_FRACTION = 32;
  const Y_HOLDER = 56;
  const Y_RULE = 70;
  const Y_TIE = 94;
  const Y_RIGHTS = 114;
  const Y_ONE_ZONE = 134;

  return (
    <g
      className="shasn-zone-label"
      transform={`translate(${x} ${y})`}
      role="group"
      aria-label={zoneLabel}
      data-zone-id={zone.id}
      data-testid="zone-label"
      data-anchor-moved={moved ? 'true' : 'false'}
    >
      {/* The seal disc. Required, not decorative: it is the only element of the
          majority lockup that survives greyscale AND is unambiguous at the
          12px rendered size of TYPE_ZONE_HOLDER — and on a narrow board, where
          the holder line is dropped, the disc is the whole signal.

          A defect found by rendering: this was parked at a hard-coded
          `cx=-78, cy=-30`, "before the name". But the name is centred and
          centred text has no fixed left edge — `NORTH EAST` at 24 SVG px is
          about 200 units wide, so a disc at x=-78 landed INSIDE the name, and
          on the majority render `SOUTH EAST` had a crimson disc sitting on the
          `E`. It now sits on its own line above the name, centred, so its
          position cannot depend on how long the zone's name is. */}
      {holderFill !== null ? (
        <circle
          cx={0}
          cy={Y_NAME - 30}
          r={SEAL_DISC_R}
          fill={holderFill}
          stroke="var(--paper-000)"
          strokeWidth={2}
          data-testid="seal-disc"
        />
      ) : null}

      {/* TYPE_ZONE_NAME — uppercase, tracking .06em. One of exactly three
          things in the product permitted to be uppercase (§3.2). */}
      <text
        textAnchor="middle"
        y={Y_NAME}
        fontFamily="var(--font-display)"
        fontSize="var(--board-type-zone-name)"
        fontWeight={700}
        letterSpacing="0.06em"
        fill="var(--ink-900)"
        {...halo}
        data-role="zone-name"
      >
        {zone.name.toUpperCase()}
      </text>

      {/* TYPE_ZONE_FRACTION + the tally chip. The tally is deliberately
          separate from the majority fraction: "how full is the zone" and "how
          many do I need to take it" are different questions, and merging them
          produces the misread where a player thinks 8/17 means 8 from winning. */}
      <text
        textAnchor="middle"
        y={Y_FRACTION}
        fontFamily="var(--font-numeric)"
        fontSize="var(--board-type-zone-fraction)"
        {...halo}
        data-role="zone-fraction"
      >
        {fractionTspans}
        <tspan
          dx={12}
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill="var(--ink-700)"
          data-role="tally"
        >
          {pegsFilled}/{capacity}
        </tspan>
      </text>

      {/* TYPE_ZONE_HOLDER. Dropped below the 500px board width, where it would
          render under 10px (§3.6.1). */}
      {showHolder && holderFill !== null && holderName !== null ? (
        <text
          textAnchor="middle"
          y={Y_HOLDER}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill={holderFill}
          {...halo}
          data-role="zone-holder"
        >
          {`● ${holderName.toUpperCase()}`}
        </text>
      ) : null}

      {/* G1: the tie is stated, not omitted. */}
      {tied ? (
        <text
          textAnchor="middle"
          y={Y_TIE}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fill="var(--ink-500)"
          {...halo}
          data-role="no-rights"
        >
          <tspan aria-hidden="true">⊘ </tspan>
          <tspan>no rights</tspan>
        </text>
      ) : null}

      {/* Both rights states are always rendered during a gerrymander; absence is
          never the signal (G1, §8.2). */}
      {showRightsBadge ? (
        <text
          textAnchor="middle"
          y={Y_RIGHTS}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill={hasRights ? 'var(--positive)' : 'var(--ink-500)'}
          {...halo}
          data-role="rights-badge"
        >
          {hasRights ? '⚑ RIGHTS' : '⊘ NO RIGHTS'}
        </text>
      ) : null}

      {oneZoneLocked ? (
        <text
          textAnchor="middle"
          y={Y_ONE_ZONE}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill="var(--positive)"
          {...halo}
          data-role="one-zone"
        >
          ONE ZONE
        </text>
      ) : null}

      {/* The progress rule. Its own line, clear of every text row above. */}
      <g transform={`translate(0 ${Y_RULE})`} aria-hidden="true">
        <rect
          x={-PROGRESS_RULE_W / 2}
          y={0}
          width={PROGRESS_RULE_W}
          height={PROGRESS_RULE_H}
          rx={2}
          fill="var(--paper-300)"
          data-testid="progress-track"
        />
        <rect
          x={-PROGRESS_RULE_W / 2}
          y={0}
          width={PROGRESS_RULE_W * fillFraction}
          height={PROGRESS_RULE_H}
          rx={2}
          fill={holderFill ?? 'var(--paper-400)'}
          data-testid="progress-fill"
        />
        {/* The threshold tick. Once the fill reaches it, the fill gains a cap,
            so the eye can compare two zones without reading a number. */}
        <rect
          x={tickX - 1}
          y={-2}
          width={2}
          height={PROGRESS_RULE_H + 4}
          fill="var(--ink-900)"
          data-testid="progress-tick"
        />
      </g>
    </g>
  );
}

export default ZoneLabel;
