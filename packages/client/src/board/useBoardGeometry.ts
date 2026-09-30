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
