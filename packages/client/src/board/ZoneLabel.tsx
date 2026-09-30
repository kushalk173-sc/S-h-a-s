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

  return (
    <g
      className="shasn-zone-label"
      transform={`translate(${x} ${y})`}
      role="group"
      aria-label={zoneLabel}
      data-zone-id={zone.id}
      data-testid="zone-label"
    >
      {/* The seal disc. Required, not decorative: it is the only element of the
          majority lockup that survives greyscale AND is unambiguous at the
          12px rendered size of TYPE_ZONE_HOLDER — and on a narrow board, where
          the holder line is dropped, the disc is the whole signal. */}
      {holderFill !== null ? (
        <circle
          cx={-78}
          cy={-30}
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
        fontFamily="var(--font-display)"
        fontSize="var(--board-type-zone-name)"
        fontWeight={700}
        letterSpacing="0.06em"
        fill="var(--ink-900)"
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
        y={32}
        fontFamily="var(--font-numeric)"
        fontSize="var(--board-type-zone-fraction)"
        data-role="zone-fraction"
      >
        {fractionTspans}
        <tspan
          dx={10}
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
          y={54}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill={holderFill}
          data-role="zone-holder"
        >
          {`● ${holderName.toUpperCase()}`}
        </text>
      ) : null}

      {/* G1: the tie is stated, not omitted. */}
      {tied ? (
        <text
          textAnchor="middle"
          y={showHolder ? 72 : 54}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fill="var(--ink-500)"
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
          y={showHolder ? 90 : 72}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill={hasRights ? 'var(--positive)' : 'var(--ink-500)'}
          data-role="rights-badge"
        >
          {hasRights ? '⚑ RIGHTS' : '⊘ NO RIGHTS'}
        </text>
      ) : null}

      {oneZoneLocked ? (
        <text
          textAnchor="middle"
          y={showHolder ? 108 : 90}
          fontFamily="var(--font-ui)"
          fontSize="var(--board-type-zone-holder)"
          fontWeight={700}
          fill="var(--positive)"
          data-role="one-zone"
        >
          ONE ZONE
        </text>
      ) : null}

      {/* The progress rule. */}
      <g transform={`translate(0 62)`} aria-hidden="true">
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
