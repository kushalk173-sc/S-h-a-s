/**
 * One of the 129 slots: the printed well, the peg on it, the interaction
 * overlay, and the accessible name.
 *
 * This is where UI-SPEC §4.6 is rendered. It reads a resolved `PegVisual` from
 * `./pegMatrix` and draws it; it holds no opinion about rules.
 *
 * Hit target (§4.3 rule 2, §8.1)
 * --------------------------------
 * A 48-unit invisible rect, 2.4× the visible 34-unit well, so an imprecise
 * cursor still lands on the slot. 48 units is 29.8 CSS px at the 620px
 * reference render and exactly 24.0px at the 500px floor — WCAG 2.1 SC 2.5.8
 * Target Size (Minimum) with nothing to spare. Adjacent rects cannot overlap
 * because 48 < 52.84, the measured minimum centre-to-centre distance.
 *
 * Accessibility
 * -------------
 * `role="button"` on the group, a descriptive `aria-label` naming zone,
 * position, occupant and majority state (§8.5), plus one clause appended for
 * the current mode so a screen-reader user receives the same legality
 * information a sighted user gets from the hatching, at the same moment. The
 * name begins with the zone name, which is the visible text a pointer user
 * reads, satisfying SC 2.5.3 Label in Name.
 */

import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { VolatileRosette } from './VolatileRosette';
import type { ResolvedPeg } from './pegMatrix';
import type { BoardSlot } from './useBoardGeometry';
import type { SlotInteraction } from './types';

export const HIT_RECT = 48;
export const HIT_RECT_COARSE = 56;
export const PEG_R = 17;
export const WELL_STROKE = 1.5;
export const VOLATILE_WELL = 34;
export const VOLATILE_WELL_RX = 6;
export const OVERLAY_RING_R = 21;
export const MINORITY_STROKE = 3;
export const MAJORITY_STROKE = 1.5;

/** What the slot needs to know about the seat that owns a peg. */
export type SeatLookup = {
  /** Seat colour token for a player id, e.g. `var(--seat-3)`. */
  readonly fill: (playerId: string) => string;
  /** Display name for a player id, e.g. `RIA`. */
  readonly name: (playerId: string) => string;
};

export type VoterSlotProps = {
  readonly slot: BoardSlot;
  readonly peg: { readonly owner: string; readonly majority: boolean } | null;
  /** Is `peg.owner` the active player? Selects the `own` rows of §4.6. */
  readonly isOwn: boolean;
  /** The resolved §4.6 cell. */
  readonly visual: ResolvedPeg;
  readonly interaction: SlotInteraction;
  /** The zone's printed majority requirement, for the empty-slot sentence. */
  readonly zoneMajority: number;
  /** `majority / capacity` as printed on the board, e.g. `6/11`. */
  readonly seats: SeatLookup;
  /** Roving tabindex: exactly one slot is 0 at a time (§8.4 rule 2). */
  readonly tabbable: boolean;
  /** The whole board is not your turn → no tab stop, no hover lift (§4.6). */
  readonly disabled: boolean;
  /**
   * Below the 500px board floor the focus ring is boosted from 2+2 to 3+3 SVG
   * units, so it never renders under ~1.5 CSS px (§8.4 rule 3). A focus
   * indicator below 2px effectively does not exist for low-vision users.
   */
  readonly boostFocus: boolean;
  /** Coarse pointers grow the hit rect to 56 units (§8.1). */
  readonly coarsePointer: boolean;
  readonly focused: boolean;
  readonly onActivate: (areaId: string) => void;
  readonly onFocus: (areaId: string) => void;
  readonly onBlur: (areaId: string) => void;
  readonly onHover: (areaId: string | null) => void;
  /** The same-zone tether polyline (§4.7.3), drawn by the parent. */
  readonly children?: ReactNode;
};

/**
 * The chevron that marks a symbol-side-up peg. 11 units wide × 7 tall, a 2.6-unit
 * round-capped polyline — NOT a filled triangle, which mushes at the 21px
 * rendered diameter of a peg (§4.5).
 */
function PegChevron({ colour, square }: { colour: string; square: boolean }) {
  const y = square ? 0 : -1;
  return (
    <path
      d={`M -5.5 ${y + 3.5} L 0 ${y - 3.5} L 5.5 ${y + 3.5}`}
      fill="none"
      stroke={colour}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    />
  );
}

/** Six ink arms — the Volatile marker, 11px across (§4.5). */
function Asterisk({ colour }: { colour: string }) {
  const arms: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const dx = Math.cos(a) * 5;
    const dy = Math.sin(a) * 5;
    arms.push(`M ${(-dx).toFixed(2)} ${(-dy).toFixed(2)} L ${dx.toFixed(2)} ${dy.toFixed(2)}`);
  }
  return (
    <path
      d={arms.join(' ')}
      stroke={colour}
      strokeWidth={1.8}
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
      data-testid="volatile-asterisk"
    />
  );
}

/** The `◈` diagonal chevron at the disc's lower-left — a legal destination. */
function DestinationMark() {
  return (
    <path
      d="M -13.5 6.5 L -7.5 12.5 L -3.5 8.5"
      fill="none"
      stroke="var(--ink-900)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="dest-mark"
    />
  );
}

/** The `⌾*` POSITIVE tick at the slot's upper-right — already chosen. */
function ChosenTick() {
  return (
    <path
      d="M 12 -20 L 16 -16 L 22 -23"
      fill="none"
      stroke="var(--positive)"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="chosen-tick"
    />
  );
}

/**
 * Build the accessible name. Built from state, never from a template that
 * could drift (§8.5), and always ending with the line that teaches the §6.2
 * constraints without a tutorial: `Gerrymanderable.` /
 * `Permanent — Volatile Area.` / `Worth 1 point; not gerrymanderable.`
 *
 * Note the ordering. A majority peg states its points in the LAST line rather
 * than in a sentence of its own, because that line is the one the player is
 * looking for, and duplicating it would make the label read like a form. A
 * Volatile peg states permanence in addition to points rather than instead of
 * them, so §8.5's `Central, slot 5 … worth 1 point. Not gerrymanderable.` and
 * §4.7.1's `Permanent — Volatile Area.` are both satisfied.
 *
 * The zone name comes first because it is the visible text a pointer user
 * reads, which is what SC 2.5.3 Label in Name requires.
 */
export function buildSlotLabel(input: {
  readonly slot: BoardSlot;
  readonly peg: { readonly owner: string; readonly majority: boolean } | null;
  readonly isOwn: boolean;
  readonly zoneMajority: number;
  readonly interaction: SlotInteraction;
  readonly seats: SeatLookup;
}): string {
  const { slot, peg, isOwn, zoneMajority, interaction, seats } = input;

  // "North West, slot 7" [, "Volatile Area"]
  let label = `${slot.zoneName}, slot ${slot.indexInZone}`;
  if (slot.volatile) label += ', Volatile Area';

  if (peg === null) {
    label += ', empty.';
    label += slot.volatile
      ? ' A voter here is permanent and triggers a Headline.'
      : ` Need ${zoneMajority} to hold this constituency.`;
  } else {
    const who = isOwn ? 'Your voter' : `${seats.name(peg.owner)}'s voter`;
    label += `, ${who}, ${peg.majority ? 'majority' : 'minority'}.`;
    // Minority pegs state their zero; majority pegs state theirs in the last
    // line, where the "not gerrymanderable" clause already lives.
    if (!peg.majority) label += ' Worth 0 points.';
  }

  // The always-present last line. This is how the §6.2 constraints become
  // visible on every peg, permanently, in the place the player is looking.
  if (peg !== null && peg.majority) label += ' Worth 1 point; not gerrymanderable.';
  if (slot.volatile) label += ' Permanent — Volatile Area.';
  else if (peg === null || !peg.majority) label += ' Gerrymanderable.';

  // One clause for the current mode, so parity with the sighted channels.
  switch (interaction.legality) {
    case 'legal':
      label += ' · legal target';
      break;
    case 'destination':
      label += ' · legal destination';
      break;
    case 'not-destination':
      // The reason is appended when there is one, for the same reason the
      // illegal clause carries one: §6.2's "Arm (hover)" table gives a
      // distinct reason per refusal, and a refusal that does not name its
      // reason is a puzzle rather than a constraint.
      label +=
        interaction.reason === undefined
          ? ' · not a legal destination'
          : ` · not a legal destination: ${interaction.reason}`;
      break;
    case 'source':
      label += ' · gerrymander source';
      break;
    case 'chosen':
      label += ' · already chosen for this group';
      break;
    case 'illegal':
      // A refusal always names its reason (§6.1.2, §9.10). Silent refusal
      // would be indistinguishable from a broken board.
      label += ` · illegal: ${interaction.reason ?? 'not a legal target'}`;
      break;
    case 'neutral':
      break;
  }

  return label;
}

export const VoterSlot = forwardRef<SVGGElement, VoterSlotProps>(function VoterSlot(
  {
    slot,
    peg,
    isOwn,
    visual,
    interaction,
    zoneMajority,
    seats,
    tabbable,
    disabled,
    boostFocus,
    coarsePointer,
    focused,
    onActivate,
    onFocus,
    onBlur,
    onHover,
    children,
  },
  ref,
) {
  const { x, y, areaId, volatile: isVolatile } = slot;
  const square = visual.well === 'square';
  const hit = coarsePointer ? HIT_RECT_COARSE : HIT_RECT;
  const seatFill = peg === null ? 'transparent' : seats.fill(peg.owner);

  const label = buildSlotLabel({
    slot,
    peg,
    isOwn,
    zoneMajority,
    interaction,
    seats,
  });

  // The cursor states the §6.2 "Arm (hover)" table names, kept in step with the
  // ring: grab on an eligible source, not-allowed on a blocked one.
  const cursor = (() => {
    if (disabled) return 'default';
    if (interaction.gerrySource === 'eligible') return 'grab';
    if (interaction.gerrySource === 'blocked') return 'not-allowed';
    if (visual.rings.length > 0) return 'pointer';
    return 'default';
  })();

  // Asterisk ink follows the peg: INK_900 on paper or hollow, PAPER_000 on a
  // solid seat fill (min case jade, 3.14 — non-text, so it passes).
  const asteriskColour =
    visual.body === 'majority' ? 'var(--paper-000)' : 'var(--ink-900)';

  const focusIn = boostFocus ? 3 : 2;
  const focusOut = boostFocus ? 3 : 2;

  return (
    <g
      ref={ref}
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={tabbable && !disabled ? 0 : -1}
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-area-id={areaId}
      data-zone-id={slot.zoneId}
      data-cell={visual.code}
      data-row={visual.row}
      data-column={visual.column}
      className="shasn-slot"
      style={{ opacity: visual.dim ? 0.42 : 1, cursor }}
      onPointerDown={() => {
        if (!disabled) onHover(areaId);
      }}
      onPointerEnter={() => {
        if (!disabled) onHover(areaId);
      }}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onFocus(areaId)}
      onBlur={() => onBlur(areaId)}
      onClick={() => {
        if (!disabled) onActivate(areaId);
      }}
      onKeyDown={(e) => {
        // Enter/Space activate. The board's spatial arrow keys are handled one
        // level up by the roving-tabindex controller in BoardSvg.
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (!disabled) onActivate(areaId);
        }
      }}
    >
      {children}

      {/* ── The printed well. Drawn in the paper ramp, never in ink or a seat
             colour, and empty of content: 129 marks is a lot of ink, and the
             solution is that the wells carry no information at rest (§4.3). */}
      {square ? (
        <rect
          x={-VOLATILE_WELL / 2}
          y={-VOLATILE_WELL / 2}
          width={VOLATILE_WELL}
          height={VOLATILE_WELL}
          rx={VOLATILE_WELL_RX}
          fill="none"
          stroke="var(--paper-400)"
          strokeWidth={WELL_STROKE}
        />
      ) : (
        <circle
          r={PEG_R}
          fill="none"
          stroke="var(--paper-400)"
          strokeWidth={WELL_STROKE}
        />
      )}

      {/* The Volatile cog, from the real board's art. Behind the well. */}
      {isVolatile ? <VolatileRosette x={0} y={0} /> : null}

      {/* ── The peg. Blank side up is an OUTLINE; symbol side up is SOLID.
             Solid vs hollow is a silhouette difference, readable at 21px, in
             greyscale, by every kind of colour vision — the single most
             important decision in the board spec (§4.5). */}
      {visual.body === 'minority' ? (
        square ? (
          <rect
            x={-VOLATILE_WELL / 2}
            y={-VOLATILE_WELL / 2}
            width={VOLATILE_WELL}
            height={VOLATILE_WELL}
            rx={VOLATILE_WELL_RX}
            fill="var(--paper-000)"
            stroke={seatFill}
            strokeWidth={MINORITY_STROKE}
          />
        ) : (
          <circle
            r={PEG_R}
            fill="var(--paper-000)"
            stroke={seatFill}
            strokeWidth={MINORITY_STROKE}
          />
        )
      ) : null}

      {visual.body === 'majority' ? (
        square ? (
          <rect
            x={-VOLATILE_WELL / 2}
            y={-VOLATILE_WELL / 2}
            width={VOLATILE_WELL}
            height={VOLATILE_WELL}
            rx={VOLATILE_WELL_RX}
            fill={seatFill}
            stroke="var(--ink-900)"
            strokeWidth={MAJORITY_STROKE}
          />
        ) : (
          <circle
            r={PEG_R}
            fill={seatFill}
            stroke="var(--ink-900)"
            strokeWidth={MAJORITY_STROKE}
          />
        )
      ) : null}

      {/* No seat fill reaches 4.5:1 against paper or ink uniformly, so pegs
          carry no text — identity is shape + ring, and the chevron is a
          symbol, not a glyph of a number (§2.5). */}
      {visual.body === 'majority' ? <PegChevron colour="var(--paper-000)" square={square} /> : null}

      {visual.asterisk ? <Asterisk colour={asteriskColour} /> : null}

      {/* The hatch is the unavailable/illegal channel. It is never colour
          alone, and never low contrast alone (§2.6, §9.2). */}
      {visual.hatch ? (
        square ? (
          <rect
            x={-VOLATILE_WELL / 2}
            y={-VOLATILE_WELL / 2}
            width={VOLATILE_WELL}
            height={VOLATILE_WELL}
            rx={VOLATILE_WELL_RX}
            fill="url(#shasn-hatch)"
            data-testid="hatch"
          />
        ) : (
          <circle r={PEG_R} fill="url(#shasn-hatch)" data-testid="hatch" />
        )
      ) : null}

      {/* Overlay rings, all at r=21 so they never touch the well. */}
      {visual.rings.map((ring, i) => (
        <circle
          key={ring.kind}
          r={OVERLAY_RING_R}
          fill="none"
          stroke={ring.token}
          strokeWidth={ring.width}
          strokeDasharray={ring.dash ?? undefined}
          data-testid={`ring-${ring.kind}`}
          opacity={i === 0 ? 1 : 0.001}
        />
      ))}

      {visual.destMark ? <DestinationMark /> : null}
      {visual.chosenTick ? <ChosenTick /> : null}

      {/* Dual-tone focus ring, drawn in SVG user space so it scales with the
          board. Both tones guarantee visibility against parchment AND any
          seat fill: #141110 is 17.41 on paper, #FFFFFF is ≥3.39 on every seat
          fill (§8.3). */}
      {focused ? (
        <g aria-hidden="true" data-testid="focus-ring" pointerEvents="none">
          <circle
            r={OVERLAY_RING_R + focusIn}
            fill="none"
            stroke="var(--focus-outer)"
            strokeWidth={focusOut}
          />
          <circle
            r={OVERLAY_RING_R + focusIn + focusOut}
            fill="none"
            stroke="var(--focus-inner)"
            strokeWidth={focusOut}
          />
        </g>
      ) : null}

      {/* ── The hit target. 2.4× the visible well, and 48 < 52.84 so it can
             never overlap a neighbour's. `pointer-events: all` because the
             fill is transparent. */}
      <rect
        x={-hit / 2}
        y={-hit / 2}
        width={hit}
        height={hit}
        fill="transparent"
        pointerEvents="all"
        data-testid="hit-rect"
      />
    </g>
  );
});

export default VoterSlot;
