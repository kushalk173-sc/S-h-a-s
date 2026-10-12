/**
 * The contour texture.
 *
 * CRITICAL VISUAL FACT (`docs/AUTHENTIC-SHASN-REFERENCE.md` §6.1, VERIFIED by
 * inspection of the official `map.png` render): the real Shasn board is a
 * **topographic contour map, not a choropleth**. The landmass is a pale cream
 * base overlaid with **fine concentric contour lines**, and this texture — not
 * an elevation fill, not a colour ramp — is the dominant graphic element of the
 * board. Zones are separated by borders only, and the land texture continues
 * straight through them.
 *
 * The contours are generated here rather than shipped as path data because
 * they are decoration, not state: 100% of the information on the board lives
 * in `geometry.ts`, and a contour line that drifts is a non-event. They are
 * clipped to the real COASTLINE at render time, so they can never spill onto
 * the dark ground.
 *
 * Determinism: a fixed 32-bit LCG, no `Math.random`. Two renders of the same
 * board are byte-identical, which is what makes the build output diffable.
 */

import { COASTLINE } from './geometry';
import type { Point } from './types';

/** Deterministic 32-bit LCG (Numerical Recipes constants). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One closed contour loop: a wobbly ring, not a circle. */
function loop(cx: number, cy: number, radius: number, phase: number): string {
  const STEPS = 72;
  const pts: string[] = [];
  for (let i = 0; i < STEPS; i += 1) {
    const a = (i / STEPS) * Math.PI * 2;
    // Three harmonics: the broad landform, a secondary fold, and a fine ripple.
    const r =
      radius *
      (1 + 0.15 * Math.sin(3 * a + phase) + 0.08 * Math.sin(5 * a + phase * 1.7) + 0.04 * Math.sin(8 * a + phase * 0.5));
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

/**
 * Summit centres for the landmass, chosen to spread the ranges the way a
 * survey sheet does — a broad northern range, a western massif, the central
 * highland, and the southern hills. Coordinates are board units inside the
 * coastline, chosen against the real vertex list in `geometry.ts`.
 */
const SUMMITS: readonly (readonly [number, number, number])[] = [
  [430, 300, 1.0], // North West massif
  [640, 260, 0.78], // North East range
  [300, 640, 0.86], // Western hills
  [500, 720, 0.62], // Central highland
  [700, 660, 0.9], // Eastern plateau
  [300, 1180, 0.72], // South West hills
  [500, 1080, 0.94], // Southern range
  [700, 1180, 0.68], // South East downs
  [500, 1360, 0.5], // Southern coastal scarp
];

/** Contour intervals per summit, innermost first. */
const INTERVALS = 7;

/**
 * The contour paths, innermost ring first per summit so that at any board size
 * the tight rings read as texture and the broad ones read as landform.
 */
export function buildContourPaths(seed = 0x5348_4153): string[] {
  const rand = lcg(seed);
  const out: string[] = [];
  for (const [cx, cy, scale] of SUMMITS) {
    // The innermost ring of a range is small; the outer rings are wide. The
    // step is deliberately non-uniform so the map does not read as a target.
    let radius = 34 * scale;
    for (let i = 0; i < INTERVALS; i += 1) {
      out.push(loop(cx + (rand() - 0.5) * 10, cy + (rand() - 0.5) * 10, radius, rand() * Math.PI * 2));
      radius *= 1.3 + rand() * 0.16;
    }
  }
  return out;
}

/**
 * A coastline-hugging inset rule, derived from the REAL COASTLINE rather than a
 * second hand-typed copy of it.
 *
 * A map sheet has a neatline: a thin rule just inside the coast. It is drawn as
 * a printed rule and not a gradient, because §1.6 ("print, don't glow") and A.2
 * ("no gradients anywhere") forbid gradients, and because a second copy of the
 * coastline in this file would be a second thing to keep in sync with the
 * generated data.
 */
export function buildCoastInsetPaths(): string[] {
  return [insetAbout(COASTLINE, 0.93)];
}

/**
 * Shrink a closed ring toward its centroid by a fixed factor, in board units.
 * At 0.93 the rule sits ~20 units inside the coast on the long axis — inside the
 * 48-unit hit-rect half-width, so it can never be mistaken for a boundary.
 */
function insetAbout(points: readonly Point[], factor: number): string {
  if (points.length === 0) return '';
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  const d = points.map(
    ([x, y]) => `${(cx + (x - cx) * factor).toFixed(1)} ${(cy + (y - cy) * factor).toFixed(1)}`,
  );
  return `M ${d.join(' L ')} Z`;
}