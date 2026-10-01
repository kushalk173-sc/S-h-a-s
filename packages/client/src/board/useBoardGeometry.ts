/**
 * Board geometry: derived lookups over the copied `ZoneSpec[]`.
 *
 * This module owns every geometric calculation the board does, and nothing
 * else. It is deliberately free of React state and of peg logic, so the
 * hit-testing and nearest-slot helpers in it are unit-testable in plain Node
 * with no DOM and no engine (see `board.test.tsx`).
 *
 * All coordinates are board units in the 1000 × 1500 viewBox.
 */

import { useMemo } from 'react';
import { BOARD, BOARD_HEIGHT, BOARD_WIDTH, COASTLINE, TOTAL_AREAS } from './geometry';
import type { BoardZoneID, Point, ZoneSpec } from './types';

/** One slot, flattened out of its zone. */
export type BoardSlot = {
  readonly areaId: string;
  readonly zoneId: BoardZoneID;
  readonly zoneName: string;
  readonly x: number;
  readonly y: number;
  readonly volatile: boolean;
  /**
   * Position within the zone, 1-based — `north-11` is position 11. This is the
   * "slot N" in the screen-reader label (§8.5) and the anchor of the §8.4
   * keyboard traversal.
   */
  readonly indexInZone: number;
  /**
   * Position in the whole board's traversal order, 0-based. Traversal is
   * `ZONE_IDS` order then `areaId` ascending within the zone (§8.4 rule 1) —
   * a reading order, not the visual order.
   */
  readonly traversalIndex: number;
};

/**
 * The rendered footprint of a zone label block, in board units.
 *
 * The block is `name / fraction + tally / holder / progress rule` stacked on the
 * anchor, so it is roughly twice as wide as the 96-unit progress rule and about
 * 85 units tall. These two numbers are what the label anchor has to dodge.
 */
export const LABEL_HALF_W = 88;
export const LABEL_HALF_H = 70;

/**
 * Where a label block's extent is sampled for the containment test. The four
 * corners plus the four edge midpoints: enough that a label hanging over a
 * border is caught, without demanding a rectangle fit inside a diamond-shaped
 * constituency that no rectangle can satisfy.
 */
const BLOCK_SAMPLES: readonly Point[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
/**
 * The label anchor each zone's block is actually DRAWN at.
 *
 * WHY THIS EXISTS — a defect found by rendering, not by asserting
 * -----------------------------------------------------------
 * `ZoneSpec.label` is a verbatim copy of the generated geometry and is marked
 * DO NOT HAND-EDIT, so it cannot be moved here. What was measured instead is how
 * close those anchors sit to the 129 slots:
 *
 *     central   nearest slot  10.3 units   6 wells inside the label block
 *     west      nearest slot  22.0 units   4 wells inside the label block
 *     north     nearest slot  24.3 units   6 wells inside the label block
 *     south     nearest slot  38.3 units   2 wells inside the label block
 *
 * So on the rendered board the label lockup was printed straight through its own
 * constituency's voter dots — `CENTRAL 5/9 5/9` had pegs sitting on both
 * numerals, and `WEST` had a peg through the `W`. Structural assertions could
 * never have caught this: the anchor was exactly where the spec said to put it.
 *
 * THE FIX, in two independent parts, because either alone is insufficient:
 *
 *   1. This function. For each zone it picks, among the points inside that
 *      zone's own polygon, the one whose label footprint overlaps the fewest
 *      slot centres, breaking ties by distance from the declared anchor — so
 *      the label stays recognisably in its own constituency and the movement is
 *      the smallest one that buys clearance. It is a pure function of the
 *      geometry, memoised with it, so two renders of the same board agree.
 *   2. A paper-coloured halo on the label text (`paint-order: stroke` in
 *      `ZoneLabel`), which is the standard cartographic answer to a label that
 *      has to sit on top of texture. North and South are 21-slot grids with
 *      61-unit row spacing, so NO point in either zone clears a 184-unit-wide
 *      footprint — for those two the halo is what makes the text readable, and
 *      it does so without hiding a single slot, which a solid backing plate
 *      would.
 *
 * Bounded search: at most `LABEL_SEARCH_R` from the declared anchor, so a label
 * can never wander into a neighbouring constituency.
 */
export const LABEL_SEARCH_R = 150;

/** How far a label block may hang outside its own constituency, in units. */
const LABEL_OVERHANG_BUDGET = 1;

/**
 * How far a VOLATILE slot's ink reaches from its centre, in board units.
 *
 * `VolatileRosette` draws a ring out to `outerRadius = 27`, so a slot centre
 * that is "clear" of the label box by anything less than this still puts the
 * cog's spokes on the numerals. This is the number the anchor search has to
 * reserve, and it is deliberately read as a constant rather than imported: the
 * rosette's own defaults live in `VolatileRosette.tsx`, and the two are asserted
 * to agree in `board.test.tsx` so they cannot drift apart silently.
 */
export const VOLATILE_INK_R = 27;

/**
 * What one rosette costs the anchor score, versus 1 for a plain voter dot.
 *
 * Large enough that clearing a single rosette outranks any number of dots: nine
 * dots clipping the corners of the box is a slightly busy label, while one cog
 * through the fraction is an unreadable one.
 */
const VOLATILE_PENALTY = 100;

/**
 * Pick a drawable anchor per zone: inside the polygon, off the slots, and as
 * close to the declared anchor as the geometry allows.
 */
export function labelAnchors(
  zones: readonly ZoneSpec[],
  slots: readonly BoardSlot[],
): ReadonlyMap<string, Point> {
  const out = new Map<string, Point>();
  for (const zone of zones) {
    const [ax, ay] = zone.label;
    let best: Point = [ax, ay];
    let bestScore = Number.POSITIVE_INFINITY;

    for (let r = 0; r <= LABEL_SEARCH_R; r += 4) {
      for (let a = 0; a < 360; a += 4) {
        const rad = (a * Math.PI) / 180;
        const p: Point = [ax + Math.cos(rad) * r, ay + Math.sin(rad) * r];
        // Must remain in its own constituency. A label inside the wrong zone
        // is worse than a label over a dot.
        if (!pointInPolygon(p, zone.poly)) continue;

        // How far the block hangs outside its own constituency, as a COUNT of
        // the eight sample points that fall out. A strict containment test was
        // tried first and rejected: `central` is a 200 × 240 diamond and
        // `south_west` a narrow wedge, and neither can contain ANY 176 × 140
        // rectangle at any position, so a hard test left those two labels on
        // their original anchors with six voter dots under them. A soft cost
        // degrades instead of failing — it buys as much containment as the
        // shape allows and no more.
        let overhang = 0;
        for (const [sx, sy] of BLOCK_SAMPLES) {
          if (!pointInPolygon([p[0] + sx * LABEL_HALF_W, p[1] + sy * LABEL_HALF_H], zone.poly)) {
            overhang += 1;
          }
        }
        if (overhang > LABEL_OVERHANG_BUDGET) continue;

        /*
         * WHAT THE LABEL HAS TO CLEAR IS THE INK, NOT THE SLOT'S CENTRE.
         *
         * A defect found by cropping the render at 4× and reading the pixels:
         * NORTH's tally chip `0/21` had a Volatile rosette drawn straight through
         * it — the cog's ring cutting `0/2`, its asterisk on the `1`.
         *
         * The search below counted a slot as an obstacle only when the slot's
         * CENTRE fell inside the label box. That is right for a plain voter dot,
         * which is essentially all at its centre, and badly wrong for a
         * rosette: `VolatileRosette` draws a 54-unit ring around that centre
         * (`outerRadius = 27`), so its ink reaches 27 units past a point the test
         * considered clear. A label could therefore be placed "clear of every
         * slot" and still have a cog through its numerals — which is precisely
         * what the geometry reported and the pixels contradicted.
         *
         * So an obstacle is its centre PLUS whatever that slot draws. Weighted,
         * not binary: a dot that clips a corner of the box is a lesser problem
         * than a rosette sitting on the glyphs, and the score has to be able to
         * express that rather than treat them alike.
         */
        let overlaps = 0;
        for (const s of slots) {
          // The ink radius of this slot. See `VolatileRosette`.
          const ink = s.volatile ? VOLATILE_INK_R : 0;
          const dx = Math.abs(s.x - p[0]) - ink;
          const dy = Math.abs(s.y - p[1]) - ink;
          if (dx <= LABEL_HALF_W && dy <= LABEL_HALF_H) {
            // Heavier than a dot: a rosette on the glyphs is the defect that was
            // measured, so it must dominate a dot on the same box.
            overlaps += s.volatile ? VOLATILE_PENALTY : 1;
          }
        }
        // Lexicographic and therefore deterministic: stay in the zone first,
        // then clear the dots, then move as little as possible.
        const score = overhang * 1_000_000 + overlaps * 10_000 + r;
        if (score < bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    out.set(zone.id, best);
  }
  return out;
}

/** The derived model every board component reads from. */
export type BoardGeometry = {
  readonly width: number;
  readonly height: number;
  /** 17-point closed coastline, verbatim from the generated file. */
  readonly coastline: readonly Point[];
  /** The landmass, i.e. the same closed shape, as an SVG path `d` string. */
  readonly landPath: string;
  /** The coastline as an open polyline `d` (the printed outline, not a sea). */
  readonly coastlinePath: string;
  /** All 129 slots, in traversal order. */
  readonly slots: readonly BoardSlot[];
  readonly slotById: ReadonlyMap<string, BoardSlot>;
  readonly zoneById: ReadonlyMap<BoardZoneID, ZoneSpec>;
  /** Measured minimum centre-to-centre distance between any two slots. */
  readonly minCentreDistance: number;
  /** Where each zone's label block is actually drawn. See `labelAnchors`. */
  readonly labelAnchors: ReadonlyMap<string, Point>;
};

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/** A closed polyline/polygon as an SVG path. `Z` closes the shape. */
export function toClosedPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points as [Point, ...Point[]];
  let d = `M ${first[0]} ${first[1]}`;
  for (const [x, y] of rest) d += ` L ${x} ${y}`;
  return `${d} Z`;
}

/** The same points as an open polyline — the printed coastline outline. */
export function toOpenPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points as [Point, ...Point[]];
  let d = `M ${first[0]} ${first[1]}`;
  for (const [x, y] of rest) d += ` L ${x} ${y}`;
  return d;
}

/**
 * Even-odd ray cast. Inclusive of the left/top edge, exclusive of the
 * right/bottom, so a point exactly on a shared vertex resolves to one polygon
 * rather than both.
 */
export function pointInPolygon(point: Point, poly: readonly Point[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a === undefined || b === undefined) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const straddles = yi > py !== yj > py;
    if (!straddles) continue;
    const t = (py - yi) / (yj - yi);
    if (px < xi + t * (xj - xi)) inside = !inside;
  }
  return inside;
}

/**
 * Which zone contains a board-space point, or `null`.
 *
 * Zones share vertices by construction (`gen-board.mjs` names them `N_TOP`,
 * `C_BL`, `S_BOT`, …), so a point on a shared seam is inside more than one
 * polygon. Ties are broken by returning the first zone in traversal order, so
 * the answer is deterministic and matches the keyboard traversal order.
 */
export function zoneAtPoint(
  zones: readonly ZoneSpec[],
  point: Point,
): ZoneSpec | null {
  for (const zone of zones) {
    if (pointInPolygon(point, zone.poly)) return zone;
  }
  return null;
}

/**
 * The slot whose centre is nearest to a board-space point.
 *
 * Returns `null` when the nearest centre is further than `maxDistance`, which
 * is the coarse-pointer resolution rule from §8.1: on a 560-unit hit rect the
 * exact-point-then-nearest-centre search must still be able to answer "no
 * target" rather than snapping to whatever is furthest away.
 */
export function nearestSlot(
  slots: readonly BoardSlot[],
  point: Point,
  maxDistance = Number.POSITIVE_INFINITY,
): BoardSlot | null {
  const [px, py] = point;
  let best: BoardSlot | null = null;
  let bestD = maxDistance;
  for (const slot of slots) {
    const d = dist(px, py, slot.x, slot.y);
    // `<` not `<=`, so the first slot in traversal order wins a tie.
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  return best;
}

/**
 * The next slot in a direction, per §8.4 rule 2.
 * `scope: 'all'` walks traversal order (←/→); `scope: 'zone'` stays inside the
 * current zone (↑/↓, Home/End).
 */
export function stepSlot(
  slots: readonly BoardSlot[],
  from: BoardSlot,
  scope: 'all' | 'zone',
  step: 1 | -1,
): BoardSlot | null {
  const inScope =
    scope === 'all' ? slots : slots.filter((s) => s.zoneId === from.zoneId);
  if (inScope.length === 0) return null;
  const at = inScope.indexOf(from);
  if (at === -1) return null;
  const next = (at + step + inScope.length) % inScope.length;
  return inScope[next] ?? null;
}

/** Flatten the zone specs into traversal-ordered slots (§8.4 rule 1). */
export function flattenSlots(zones: readonly ZoneSpec[]): BoardSlot[] {
  const out: BoardSlot[] = [];
  for (const zone of zones) {
    // areaId ascending within the zone. The generated ids are zero-padded to
    // two digits, so lexicographic order is numeric order — asserted in tests.
    const areas = [...zone.areas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    areas.forEach((area, i) => {
      out.push({
        areaId: area.id,
        zoneId: zone.id,
        zoneName: zone.name,
        x: area.x,
        y: area.y,
        volatile: area.volatile,
        indexInZone: i + 1,
        traversalIndex: out.length,
      });
    });
  }
  return out;
}

/** The measured minimum centre-to-centre distance across all slot pairs. */
export function minCentreDistance(slots: readonly BoardSlot[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < slots.length; i += 1) {
    const a = slots[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < slots.length; j += 1) {
      const b = slots[j];
      if (b === undefined) continue;
      const d = dist(a.x, a.y, b.x, b.y);
      if (d < min) min = d;
    }
  }
  return min;
}

/** Build the derived model once. Pure; the copy cost is 129 slots. */
export function buildGeometry(zones: readonly ZoneSpec[] = BOARD): BoardGeometry {
  const slots = flattenSlots(zones);
  return {
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    coastline: COASTLINE,
    landPath: toClosedPath(COASTLINE),
    coastlinePath: toOpenPath(COASTLINE),
    slots,
    slotById: new Map(slots.map((s) => [s.areaId, s])),
    zoneById: new Map(zones.map((z) => [z.id, z])),
    minCentreDistance: minCentreDistance(slots),
    labelAnchors: labelAnchors(zones, slots),
  };
}

/**
 * Memoised geometry. `zones` defaults to the built-in board; the dev harness
 * and tests pass the same array every render, so the memo holds.
 */
export function useBoardGeometry(zones: readonly ZoneSpec[] = BOARD): BoardGeometry {
  return useMemo(() => buildGeometry(zones), [zones]);
}

export { BOARD, BOARD_HEIGHT, BOARD_WIDTH, COASTLINE, TOTAL_AREAS };
