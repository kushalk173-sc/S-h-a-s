/**
 * The Shasn board.
 *
 * 129 pegs, 9 zones, one 1000 × 1500 viewBox. This component owns the viewBox,
 * the contour-map ground, the layer order, and the roving-tabindex keyboard
 * controller. It renders no rules of its own: every legality question is
 * answered by the caller through `BoardState`, and every appearance comes from
 * the §4.6 matrix in `./pegMatrix`.
 *
 * It imports NOTHING from `@shasn/engine` — see `./types.ts` for why, and for
 * the mechanical step that wires it up once the engine compiles.
 *
 * Layer order, back to front, per UI-SPEC §4.1, with the board's ground
 * re-based on the real artifact (a topographic contour map, not a parchment
 * sheet — docs/AUTHENTIC-SHASN-REFERENCE.md §6.1):
 *
 *   0  Board sheet      near-black olive ground + a printed neatline rule
 *   1  Coastline        cream landmass, fine concentric contours, one confident
 *                       outline. The contour texture is the dominant element.
 *   2  Zone outlines    thick slate, NO fill — the land runs straight through
 *   3  Majority tint     holder's seat @ 8%, multiply. Carries nothing (1.17:1)
 *   4  Zone borders      4px slate; 3px seat when a majority is held
 *   5  Zone labels       name / fraction / holder / progress rule
 *   6  Slot wells        all 129, in the paper ramp, empty of content
 *   7  Pegs              placed pegs only
 *   8  Overlays          hatch, rings, ◈, ⌾*, focus ring, 48-unit hit rects
 *   9  Floating chrome   drag ghost, tethers, tooltips
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import './board.css';
import { buildContourPaths, buildCoastInsetPaths } from './contours';
import { BOARD } from './geometry';
import { pegsFilled } from './pegsOf';
import { resolvePegVisual } from './pegMatrix';
import { useBoardGeometry, stepSlot, type BoardGeometry, type BoardSlot } from './useBoardGeometry';
import { useBoardScale } from './useBoardScale';
import { VoterSlot, type SeatLookup } from './VoterSlot';
import { ZoneLabel } from './ZoneLabel';
import { ZoneOutline } from './ZoneOutline';
import type { BoardState, BoardZone, SlotInteraction, ZoneSpec } from './types';

const SEAT_TOKENS = [
  'var(--seat-1)',
  'var(--seat-2)',
  'var(--seat-3)',
  'var(--seat-4)',
  'var(--seat-5)',
] as const;

/** `seat` is 1-based, so a bad value must not read `undefined`. */
function seatToken(seat: number): string {
  return SEAT_TOKENS[seat - 1] ?? 'var(--seat-1)';
}

/** Coarse pointers grow the hit rect to 56 units (§8.1, SC 2.5.5 AAA). */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setCoarse(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

export type BoardSvgProps = {
  readonly state: BoardState;
  /** Zone geometry. Defaults to the real board. */
  readonly specs?: readonly ZoneSpec[];
  /** Called on activation (§8.4: Enter/Space, click, or tap). */
  readonly onSlotActivate?: (areaId: string) => void;
  /**
   * Show source eligibility for every slot while no source is armed. On by
   * default because that is how G3/G4 become visible without a tutorial; a real
   * interaction controller sets it false on mode entry, because §6.2 is
   * explicit that entering the mode must not make the board flash.
   */
  readonly resolveGerrySources?: boolean;
  /** Rendered width. `100%` of the board column by default. */
  readonly width?: number | string;
  /** Rendered height; defaults to the viewBox aspect at `width`. */
  readonly height?: number | string;
  /** Forwarded ref, so a parent can measure the rendered board. */
  readonly svgRef?: Ref<SVGSVGElement>;
  /** Extra chrome drawn in layer 9. */
  readonly overlay?: ReactNode;
  /** A polite live-region sentence for state changes with no focus target. */
  readonly liveMessage?: string;
  readonly className?: string;
};

/**
 * Derive the per-slot interaction from the board state.
 *
 * The board does not decide legality — the engine does. What the board *can* do
 * without rules is refuse to contradict them, and that means: when the caller has
 * told us the legal set, THAT SET IS THE ANSWER (`legalAreaIds`), and when it has
 * not, the only rule this component knows is the one true of every placement that
 * has ever used it — an empty slot is the target.
 *
 * The second half of that sentence is exactly what made an eviction unanswerable,
 * and it is now scoped rather than removed: a voter DECISION passes
 * `legalAreaIds`, and the fallback below can only ever run for a placement, which
 * is the one case it is true of. See `types.ts:legalAreaIds` for the whole story.
 */
function slotInteraction(input: {
  readonly state: BoardState;
  readonly slot: BoardSlot;
  readonly peg: { readonly owner: string; readonly majority: boolean } | null;
}): SlotInteraction {
  const { state, slot, peg } = input;

  if (state.mode === 'place') {
    if (state.pickedAreaIds?.includes(slot.areaId) === true) {
      // G1: a two-place pick names what the slot is holding, so the clause is the
      // caller's. Default unchanged for every other interaction.
      return state.chosenReason === undefined
        ? { legality: 'chosen', chosen: true }
        : { legality: 'chosen', chosen: true, chosenReason: state.chosenReason };
    }
    /*
     * THE CALLER OWNS LEGALITY, checked BEFORE anything below can narrow it —
     * including `lockedZoneId`, because a caller that computed a legal set has
     * already applied whatever narrowing it meant to apply.
     */
    const supplied = state.legalAreaIds;
    if (supplied !== undefined) {
      if (supplied.has(slot.areaId)) return { legality: 'legal' };
      return {
        legality: 'illegal',
        // THE CALLER'S PER-SLOT SENTENCE IF IT SUPPLIED ONE. A single
        // `illegalReason` is right for a voter decision, where every refused slot is
        // refused for the same reason; it is wrong for the slot powers, whose legal
        // set NARROWS as the picks are made — and a slot that was legal one press ago
        // has to say which clause turned it off. See `types.ts:illegalReasons`.
        reason: state.illegalReasons?.get(slot.areaId) ?? state.illegalReason ?? 'not a legal target',
      };
    }
    const locked = state.lockedZoneId;
    if (locked !== undefined && slot.zoneId !== locked) {
      return { legality: 'illegal', reason: 'different zone, these voters must share one' };
    }
    if (peg === null) return { legality: 'legal' };
    return { legality: 'illegal', reason: 'already occupied' };
  }

  if (state.mode === 'gerry') {
    const source = state.gerrySourceAreaId;
    if (source === undefined) {
      // Source eligibility is exactly: yours, non-majority, non-volatile.
      // Nothing else moves, ever. Empty slots and opponents' pegs are context,
      // not options, so they dim rather than hatch (§4.6 rows 1–2, 7–10).
      if (peg === null) return { legality: 'neutral' };
      if (peg.owner !== state.activePlayerId) return { legality: 'neutral' };
      if (slot.volatile) {
        return { legality: 'neutral', gerrySource: 'blocked', reason: 'Permanent — Volatile Area.' };
      }
      if (peg.majority) {
        return { legality: 'neutral', gerrySource: 'blocked', reason: 'Majority voters do not move.' };
      }
      return { legality: 'source', gerrySource: 'eligible' };
    }
    if (slot.areaId === source) return { legality: 'source', gerrySource: 'eligible' };
    // §6.2: "Drop on a slot you occupy with your own voter — not a swap. The
    // engine's rule is a move, so an occupied destination is illegal."
    if (peg !== null && peg.owner === state.activePlayerId) {
      return { legality: 'not-destination', reason: 'you already hold that slot' };
    }
    if (peg !== null && peg.majority) {
      return { legality: 'not-destination', reason: 'Majority voters do not move.' };
    }
    if (slot.volatile && peg !== null) {
      return { legality: 'not-destination', reason: 'Permanent — Volatile Area.' };
    }
    return { legality: 'destination' };
  }

  return { legality: 'neutral' };
}

/**
 * Gerrymanding rights, as G1 states them: strictly more voters wins, and a tie
 * gives NOBODY rights. The tie is reported separately so the board can render
 * it explicitly — an absent badge reads as "not loaded" (§4.4, §8.2).
 */
function rightsIn(zone: BoardZone, activePlayerId: string): { readonly activeHasRights: boolean; readonly tied: boolean } {
  const counts = new Map<string, number>();
  for (const a of zone.areas) {
    if (a.peg === null) continue;
    counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
  }
  if (counts.size === 0) return { activeHasRights: false, tied: false };
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (top === undefined) return { activeHasRights: false, tied: false };
  if (second !== undefined && second[1] === top[1]) return { activeHasRights: false, tied: true };
  return { activeHasRights: top[0] === activePlayerId, tied: false };
}

export function BoardSvg({
  state,
  specs = BOARD,
  onSlotActivate,
  resolveGerrySources = true,
  width = '100%',
  height,
  className,
  svgRef,
  overlay,
  liveMessage,
}: BoardSvgProps) {
  const geometry: BoardGeometry = useBoardGeometry(specs);
  const innerRef = useRef<SVGSVGElement | null>(null);
  const setRef = useCallback(
    (node: SVGSVGElement | null) => {
      innerRef.current = node;
      if (svgRef === undefined) return;
      if (typeof svgRef === 'function') svgRef(node);
      else (svgRef as { current: SVGSVGElement | null }).current = node;
    },
    [svgRef],
  );
  const { belowFloor, boostFocus } = useBoardScale(innerRef);
  const coarsePointer = useCoarsePointer();

  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null);
  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null);
  const [tabIndex, setTabIndex] = useState(0);

  const contourPaths = useMemo(() => buildContourPaths(), []);
  const coastInsets = useMemo(() => buildCoastInsetPaths(), []);

  const seatOf = useMemo(() => {
    const byId = new Map(state.players.map((p) => [p.id, p]));
    return (playerId: string): { fill: string; name: string } => {
      const p = byId.get(playerId);
      return { fill: seatToken(p?.seat ?? 1), name: p?.name ?? 'Unknown' };
    };
  }, [state.players]);

  const seats: SeatLookup = useMemo(
    () => ({ fill: (id) => seatOf(id).fill, name: (id) => seatOf(id).name }),
    [seatOf],
  );

  const zoneById = useMemo(() => new Map(state.zones.map((z) => [z.id, z])), [state.zones]);

  // The one zone that lifts, §4.2. Only one at a time.
  const liftedZoneId = useMemo(() => {
    const id = focusedAreaId ?? hoveredAreaId;
    if (id === null) return null;
    return geometry.slotById.get(id)?.zoneId ?? null;
  }, [focusedAreaId, hoveredAreaId, geometry]);

  /**
   * Adjacency seams during a gerrymander: 4px POSITIVE between exactly the
   * legal zone pairs, from `ZoneSpec.neighbours`, which are provably adjacent —
   * so the highlight cannot be wrong. Illegal seams are never drawn; the
   * remaining slots dim instead (§4.2, §6.2 G5).
   */
  const adjacencyZones = useMemo(() => {
    if (state.mode !== 'gerry' || state.gerrySourceAreaId === undefined) {
      return new Set<string>();
    }
    const src = geometry.slotById.get(state.gerrySourceAreaId);
    if (src === undefined) return new Set<string>();
    const spec = geometry.zoneById.get(src.zoneId);
    if (spec === undefined) return new Set<string>();
    return new Set<string>([src.zoneId, ...spec.neighbours]);
  }, [state.mode, state.gerrySourceAreaId, geometry]);

  const hasGerrySource = state.gerrySourceAreaId !== undefined;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<SVGSVGElement>) => {
      const from =
        focusedAreaId === null
          ? geometry.slots[tabIndex]
          : geometry.slotById.get(focusedAreaId);
      if (from === undefined) return;

      // §8.4 rule 2. The board is ONE Tab stop with a roving tabindex, so 129
      // slots never make the rest of the UI unreachable in practice.
      const moves: Record<string, { scope: 'all' | 'zone'; step: 1 | -1 } | null> = {
        ArrowRight: { scope: 'all', step: 1 },
        ArrowLeft: { scope: 'all', step: -1 },
        ArrowDown: { scope: 'zone', step: 1 },
        ArrowUp: { scope: 'zone', step: -1 },
      };

      const go = (target: BoardSlot | null | undefined): void => {
        if (target === null || target === undefined) return;
        e.preventDefault();
        setTabIndex(target.traversalIndex);
        setFocusedAreaId(target.areaId);
      };

      if (e.key === 'Home' || e.key === 'End') {
        const inZone = geometry.slots.filter((s) => s.zoneId === from.zoneId);
        go(e.key === 'Home' ? inZone[0] : inZone[inZone.length - 1]);
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        const zoneIds = specs.map((z) => z.id);
        const at = zoneIds.indexOf(from.zoneId);
        const nextZone = zoneIds[(at + (e.key === 'PageDown' ? 1 : -1) + zoneIds.length) % zoneIds.length];
        if (nextZone === undefined) return;
        go(geometry.slots.find((s) => s.zoneId === nextZone));
        return;
      }

      const move = moves[e.key];
      if (move == null) return;
      go(stepSlot(geometry.slots, from, move.scope, move.step));
    },
    [focusedAreaId, geometry, specs, tabIndex],
  );

  return (
    <svg
      ref={setRef}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      width={width}
      height={height}
      className={`shasn-board ${className ?? ''}`.trim()}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Shasn board: 9 constituencies, 129 voter areas"
      aria-disabled={state.disabled === true ? true : undefined}
      onKeyDown={handleKeyDown}
      data-testid="board-svg"
      data-below-floor={belowFloor ? 'true' : 'false'}
    >
      <title>Shasn board</title>
      <defs>
        {/* The 45° hatch: the unavailable/illegal channel. 3-unit pitch at 22%
            — fine enough to read as texture, coarse enough to read as a refusal.
            Never colour alone, never low contrast alone (§9.2). */}
        <pattern
          id="shasn-hatch"
          width={3}
          height={3}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={3}
            stroke="var(--table-900)"
            strokeWidth={1.4}
            strokeOpacity={0.22}
          />
        </pattern>
        {/* Contours are clipped to the real landmass, so they can never spill
            onto the dark ground however the summits are placed. */}
        <clipPath id="shasn-land-clip">
          <path d={geometry.landPath} />
        </clipPath>
      </defs>

      {/* ── z0  Board sheet: the near-black olive ground. The reference's radial
             vignette is drawn as a printed neatline rule rather than a
             gradient, because §1.6 and A.2 forbid gradients. ─────────────── */}
      <rect
        x={0}
        y={0}
        width={geometry.width}
        height={geometry.height}
        rx={18}
        fill="var(--map-ground)"
        data-testid="board-sheet"
      />
      <rect
        x={10}
        y={10}
        width={geometry.width - 20}
        height={geometry.height - 20}
        rx={14}
        fill="none"
        stroke="var(--map-ground-edge)"
        strokeWidth={6}
        opacity={0.75}
        aria-hidden="true"
        data-testid="board-neatline"
      />

      {/* ── z1  The land: cream base, fine concentric contours, one confident
             outline. This texture is the dominant graphic element of the real
             board, and it runs uninterrupted through every zone. ──────────── */}
      <g aria-hidden="true" data-testid="land">
        <path d={geometry.landPath} fill="var(--map-land)" data-testid="land-fill" />
        <g clipPath="url(#shasn-land-clip)" opacity={0.9}>
          {contourPaths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--map-contour)" strokeWidth={1} data-testid="contour" />
          ))}
          {coastInsets.map((d, i) => (
            <path
              key={`inset-${i}`}
              d={d}
              fill="none"
              stroke="var(--map-contour)"
              strokeWidth={1.5}
              strokeOpacity={0.7}
            />
          ))}
        </g>
        {/* The coastline: a single confident line with round joins (§4.1). Its
            job is to stop the land reading as a rounded rectangle. */}
        <path
          d={geometry.landPath}
          fill="none"
          stroke="var(--map-border)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          data-testid="coastline"
        />
      </g>

      {/* ── z2–z4  Zones: borders, no fill. ─────────────────────────────── */}
      {specs.map((spec) => {
        const zone = zoneById.get(spec.id);
        if (zone === undefined) return null;
        const holder = zone.majorityHolder;
        return (
          <ZoneOutline
            key={spec.id}
            zone={zone}
            poly={spec.poly}
            holderFill={holder === null ? null : seatOf(holder).fill}
            lifted={liftedZoneId === spec.id}
            adjacencyHighlight={adjacencyZones.has(spec.id)}
          />
        );
      })}

{/* ── z6–z8  The 129 slots. ────────────────────────────────────────── */}
      {specs.flatMap((spec) => {
        const zone = zoneById.get(spec.id);
        if (zone === undefined) return [];
        return zone.areas.map((area) => {
          const slot = geometry.slotById.get(area.id);
          if (slot === undefined) return null;
          const isOwn = area.peg !== null && area.peg.owner === state.activePlayerId;
          const interaction = slotInteraction({ state, slot, peg: area.peg });
          const visual = resolvePegVisual({
            peg: area.peg,
            volatile: area.volatile,
            isOwn,
            mode: state.mode,
            interaction,
            hasGerrySource,
            resolveGerrySources,
          });
          return (
            <VoterSlot
              key={area.id}
              slot={slot}
              peg={area.peg}
              isOwn={isOwn}
              visual={visual}
              interaction={interaction}
              zoneMajority={zone.majority}
              seats={seats}
              // Roving tabindex: exactly one slot is a tab stop at a time.
              tabbable={slot.traversalIndex === tabIndex}
              disabled={state.disabled === true}
              boostFocus={boostFocus}
              coarsePointer={coarsePointer}
              focused={focusedAreaId === area.id}
              onActivate={(id) => onSlotActivate?.(id)}
              onFocus={(id) => {
                const s = geometry.slotById.get(id);
                if (s !== undefined) setTabIndex(s.traversalIndex);
                setFocusedAreaId(id);
              }}
              onBlur={(id) => {
                setFocusedAreaId((current) => (current === id ? null : current));
              }}
              onHover={setHoveredAreaId}
            />
          );
        });
      })}

      {/*
        * ── z9  Zone labels. DRAWN LAST, AND THAT IS THE FIX. ─────────────────
        *
        * A defect found by cropping the render at 4× and reading the pixels.
        *
        * The labels used to render at z5, BEFORE the 129 slots at z6–z8. That
        * ordering silently defeated the one mechanism `ZoneLabel` relies on to
        * stay readable over a busy background: the paper-coloured halo, which
        * works because `paint-order: stroke` paints the outline UNDER the glyph
        * fill. A halo under the rosette is worth nothing — the rosette's ring
        * and asterisk were painted straight over the numerals afterwards.
        *
        * Measured on the real board: NORTH's tally chip `0/21` had a volatile
        * rosette centred 26px away with a 21×14px overlap, and the magnified
        * crop showed the cog's ring cutting through `0/2` with its asterisk on
        * the `1`. The printed fraction is the board's primary information; a
        * rosette drawn through it is not a cosmetic overlap.
        *
        * Rendered after the slots, the halo does what it was designed to do: the
        * glyph keeps its shape, the rosette's own silhouette is still fully
        * visible through and around it, and NOT ONE voter slot is occluded. That
        * is why the fix is paint order and not a backing plate — a plate would
        * hide a voter dot, and the dot is the information.
        *
        * SOUTH was measured clean (its rosette sits clear below the block), so
        * the report that both zones overlapped was proximity, not a defect. Only
        * NORTH and NORTH WEST had real overlap.
        */}
      {specs.map((spec) => {
        const zone = zoneById.get(spec.id);
        if (zone === undefined) return null;
        const rights = rightsIn(zone, state.activePlayerId);
        const holder = zone.majorityHolder;
        return (
          <ZoneLabel
            key={`label-${spec.id}`}
            zone={zone}
            anchor={geometry.labelAnchors.get(spec.id) ?? spec.label}
            declaredAnchor={spec.label}
            pegsFilled={pegsFilled(zone)}
            holderFill={holder === null ? null : seatOf(holder).fill}
            holderName={holder === null ? null : seatOf(holder).name}
            tied={rights.tied}
            hasRights={rights.activeHasRights}
            showHolder={!belowFloor}
            showRightsBadge={state.mode === 'gerry'}
            oneZoneLocked={state.lockedZoneId === spec.id}
          />
        );
      })}

      {/* ── z10  Floating chrome from the caller. ────────────────────────── */}
      {overlay}

      {/* The polite live region. State changes with no focus target announce
          here; the engine-facing caller supplies the sentence (§8.5). */}
      {liveMessage !== undefined ? (
        <text x={-9999} y={-9999} aria-live="polite" aria-atomic="true" data-testid="board-live">
          {liveMessage}
        </text>
      ) : null}
    </svg>
  );
}

export default BoardSvg;
