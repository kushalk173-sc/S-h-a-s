/**
 * Generates `src/board.generated.ts` — the 129 voter Areas of the SHASN board.
 *
 * The nine zone polygons below are traced from the printed board (see
 * docs/rules-reference.md §2): six outer zones in a ring, and North / Central /
 * South forming the lightning-bolt column down the middle. Shared vertices are
 * named so that neighbouring zones provably share an edge — the adjacency table
 * in the rules is a consequence of this geometry, not an independent assertion.
 *
 * Slot positions are not hand-placed. For each zone we inset the polygon by the
 * peg radius, lay a hexagonal grid over it, binary-search the grid spacing until
 * at least `capacity` points land inside, then drop the points nearest the border
 * until exactly `capacity` remain. The result is an even, organic-looking fill
 * that always matches the printed capacity.
 *
 * Run: node scripts/gen-board.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─────────────────────────── shared vertices ───────────────────────────
// Coastline, clockwise from top centre.
const T   = [500,   25];  // top centre — NW/NE border meets the coast
const A1  = [700,   45];
const A2  = [880,  130];
const A3  = [950,  320];
const R1  = [960,  560];  // right coast — NE/E border
const A4  = [930,  800];
const R2  = [955, 1030];  // right coast — E/SE border
const A5  = [880, 1260];
const A6  = [690, 1410];
const B   = [500, 1470];  // bottom centre — SW/SE border meets the coast
const A7  = [310, 1420];
const A8  = [130, 1300];
const L2  = [ 65, 1040];  // left coast — W/SW border
const A9  = [ 95,  800];
const L1  = [ 40,  545];  // left coast — NW/W border
const A10 = [ 75,  270];
const A11 = [255,   55];

// Interior vertices of the central bolt.
const N_TOP   = [500,  235];
const N_TL    = [345,  320];
const N_LEFT  = [320,  455];
const N_TR    = [730,  345];
const N_RIGHT = [755,  530];
const N_BL    = [400,  610];  // North ↔ Central ↔ West junction
const N_BR    = [600,  625];  // North ↔ Central ↔ East junction
const C_BL    = [300,  835];  // Central ↔ South ↔ West junction
const C_BR    = [500,  850];  // Central ↔ South ↔ East junction
const S_RIGHT = [640,  980];
const S_RB    = [570, 1215];
const S_BOT   = [450, 1290];  // South ↔ SW ↔ SE junction
const S_LB    = [250, 1230];
const S_LEFT  = [180, 1010];

const ZONES = [
  { id: 'north_west', name: 'North West', majority: 6,  capacity: 11, volatile: 1,
    poly: [T, N_TOP, N_TL, N_LEFT, L1, A10, A11] },
  { id: 'north',      name: 'North',      majority: 11, capacity: 21, volatile: 1,
    poly: [N_TOP, N_TR, N_RIGHT, N_BR, N_BL, N_LEFT, N_TL] },
  { id: 'north_east', name: 'North East', majority: 6,  capacity: 11, volatile: 1,
    poly: [T, A1, A2, A3, R1, N_RIGHT, N_TR, N_TOP] },
  { id: 'west',       name: 'West',       majority: 9,  capacity: 17, volatile: 2,
    poly: [L1, N_LEFT, N_BL, C_BL, S_LEFT, L2, A9] },
  { id: 'central',    name: 'Central',    majority: 5,  capacity: 9,  volatile: 1,
    poly: [N_BL, N_BR, C_BR, C_BL] },
  { id: 'east',       name: 'East',       majority: 9,  capacity: 17, volatile: 2,
    poly: [N_BR, N_RIGHT, R1, A4, R2, S_RIGHT, C_BR] },
  { id: 'south_west', name: 'South West', majority: 6,  capacity: 11, volatile: 1,
    poly: [L2, S_LEFT, S_LB, S_BOT, B, A7, A8] },
  { id: 'south',      name: 'South',      majority: 11, capacity: 21, volatile: 1,
    poly: [C_BL, C_BR, S_RIGHT, S_RB, S_BOT, S_LB, S_LEFT] },
  { id: 'south_east', name: 'South East', majority: 6,  capacity: 11, volatile: 1,
    poly: [S_RIGHT, R2, A5, A6, B, S_BOT, S_RB] },
];

// ─────────────────────────── geometry ───────────────────────────

function inside(poly, [x, y]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Signed clearance: distance to the nearest edge, negative outside the polygon. */
function clearance(poly, p) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distToSegment(p, poly[j], poly[i]));
  }
  return inside(poly, p) ? best : -best;
}

function bbox(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const PEG_MARGIN = 34; // keep slot centres this far off a zone border

/** Hexagonal lattice points with the required clearance, for a given spacing. */
function lattice(poly, spacing) {
  const [x0, y0, x1, y1] = bbox(poly);
  const rowH = spacing * Math.sqrt(3) / 2;
  const pts = [];
  let row = 0;
  for (let y = y0 + rowH / 2; y <= y1; y += rowH, row++) {
    const offset = row % 2 ? spacing / 2 : 0;
    for (let x = x0 + offset; x <= x1; x += spacing) {
      const c = clearance(poly, [x, y]);
      if (c >= PEG_MARGIN) pts.push({ x, y, c });
    }
  }
  return pts;
}

/**
 * Exactly `n` well-spread points inside `poly`.
 * Binary-search the lattice spacing for the tightest grid that still yields ≥ n
 * points, then drop the points closest to the border.
 */
function slotsFor(poly, n) {
  let lo = 8;
  let hi = 400;
  let best = null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const pts = lattice(poly, mid);
    if (pts.length >= n) {
      best = pts;
      lo = mid; // try a wider (sparser) grid — still enough points
    } else {
      hi = mid;
    }
  }
  if (!best) throw new Error('no lattice found');
  const kept = [...best].sort((a, b) => b.c - a.c).slice(0, n);
  // Reading order: top-to-bottom, then left-to-right within a row band.
  kept.sort((a, b) => (Math.abs(a.y - b.y) > 18 ? a.y - b.y : a.x - b.x));
  return kept.map((p) => [Math.round(p.x), Math.round(p.y)]);
}

/**
 * Pick `k` volatile areas per zone.
 *
 * Candidates are restricted to the interior half of the zone — a Volatile Area
 * drawn right on a border reads as belonging to the neighbour. Among those, greedy
 * farthest-point sampling scatters them the way the printed board does.
 */
function pickVolatile(poly, slots, k) {
  const scored = slots.map((p, i) => ({ i, p, c: clearance(poly, p) }));
  const ranked = [...scored].sort((a, b) => b.c - a.c);
  const pool = ranked.slice(0, Math.max(k, Math.ceil(slots.length * 0.6))).map((s) => s.i);

  const chosen = [pool[0]]; // most interior slot
  while (chosen.length < k) {
    let bestI = -1;
    let bestD = -1;
    for (const i of pool) {
      if (chosen.includes(i)) continue;
      const d = Math.min(
        ...chosen.map((j) => Math.hypot(slots[i][0] - slots[j][0], slots[i][1] - slots[j][1])),
      );
      if (d > bestD) { bestD = d; bestI = i; }
    }
    chosen.push(bestI);
  }
  return chosen.sort((a, b) => a - b);
}

// ─────────────────────────── adjacency from geometry ───────────────────────────

const key = (p) => `${p[0]},${p[1]}`;

function sharedEdge(a, b) {
  const edges = (poly) => {
    const out = new Set();
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      out.add([key(p), key(q)].sort().join('|'));
    }
    return out;
  };
  const ea = edges(a);
  for (const e of edges(b)) if (ea.has(e)) return true;
  // Zones can also meet along a sub-divided border (three shared vertices in a row).
  const va = new Set(a.map(key));
  const shared = b.filter((p) => va.has(key(p)));
  return shared.length >= 2;
}

// ─────────────────────────── emit ───────────────────────────

const zones = ZONES.map((z) => {
  const slots = slotsFor(z.poly, z.capacity);
  const volatileIdx = new Set(pickVolatile(z.poly, slots, z.volatile));
  return {
    ...z,
    slots,
    areas: slots.map((p, i) => ({
      id: `${z.id}-${String(i + 1).padStart(2, '0')}`,
      x: p[0],
      y: p[1],
      volatile: volatileIdx.has(i),
    })),
    neighbours: ZONES.filter((o) => o.id !== z.id && sharedEdge(z.poly, o.poly)).map((o) => o.id),
  };
});

const totalAreas = zones.reduce((n, z) => n + z.areas.length, 0);
const totalVolatile = zones.reduce((n, z) => n + z.areas.filter((a) => a.volatile).length, 0);
if (totalAreas !== 129) throw new Error(`expected 129 areas, got ${totalAreas}`);
if (totalVolatile !== 11) throw new Error(`expected 11 volatile areas, got ${totalVolatile}`);
for (const z of zones) {
  if (z.neighbours.length === 0) throw new Error(`${z.id} is an island`);
  for (const n of z.neighbours) {
    const other = zones.find((o) => o.id === n);
    if (!other.neighbours.includes(z.id)) throw new Error(`asymmetric adjacency ${z.id}/${n}`);
  }
}

const out = `/**
 * GENERATED FILE — do not edit. Run \`node scripts/gen-board.mjs\`.
 *
 * The SHASN board: 9 zones, ${totalAreas} voter areas, ${totalVolatile} volatile areas.
 * Coordinates are in a ${'1000'} × ${'1500'} viewBox; the client renders them directly.
 */

import type { ZoneID } from './state';

export type AreaSpec = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly volatile: boolean;
};

export type ZoneSpec = {
  readonly id: ZoneID;
  readonly name: string;
  readonly majority: number;
  readonly capacity: number;
  readonly neighbours: readonly ZoneID[];
  /** Polygon outline in board coordinates. */
  readonly poly: readonly (readonly [number, number])[];
  /** Where to anchor the "6/11" label. */
  readonly label: readonly [number, number];
  readonly areas: readonly AreaSpec[];
};

export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 1500;

/** The coastline, drawn behind the zones. */
export const COASTLINE: readonly (readonly [number, number])[] = [
${[T, A1, A2, A3, R1, A4, R2, A5, A6, B, A7, A8, L2, A9, L1, A10, A11]
  .map((p) => `  [${p[0]}, ${p[1]}],`)
  .join('\n')}
];

export const BOARD: readonly ZoneSpec[] = [
${zones
  .map((z) => {
    const cx = Math.round(z.poly.reduce((s, p) => s + p[0], 0) / z.poly.length);
    const cy = Math.round(z.poly.reduce((s, p) => s + p[1], 0) / z.poly.length);
    return `  {
    id: '${z.id}',
    name: '${z.name}',
    majority: ${z.majority},
    capacity: ${z.capacity},
    neighbours: [${z.neighbours.map((n) => `'${n}'`).join(', ')}],
    label: [${cx}, ${cy}],
    poly: [${z.poly.map((p) => `[${p[0]}, ${p[1]}]`).join(', ')}],
    areas: [
${z.areas
      .map((a) => `      { id: '${a.id}', x: ${a.x}, y: ${a.y}, volatile: ${a.volatile} },`)
      .join('\n')}
    ],
  },`;
  })
  .join('\n')}
];

export const TOTAL_AREAS = ${totalAreas};
export const TOTAL_MAJORITY_VOTERS = ${zones.reduce((n, z) => n + z.majority, 0)};
`;

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, '..', 'src', 'board.generated.ts'), out);

console.log(`board.generated.ts written: ${totalAreas} areas, ${totalVolatile} volatile`);
for (const z of zones) {
  console.log(
    `  ${z.name.padEnd(11)} ${z.majority}/${z.capacity}`.padEnd(28) +
      `volatile=${z.areas.filter((a) => a.volatile).length}  adj=${z.neighbours.join(',')}`,
  );
}
