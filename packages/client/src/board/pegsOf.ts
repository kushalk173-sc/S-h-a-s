/**
 * One local count, mirroring `state.ts:290-292` (`pegsFilled`).
 *
 * Two lines over `Zone.areas`, duplicated for the same reason the geometry is:
 * the engine does not currently compile, and the board needs this to draw the
 * per-zone tally chip and the progress rule. See `./types.ts` for the
 * structural-compatibility note — this takes the mirrored `BoardZone`, so an
 * engine `Zone` is assignable without a cast.
 *
 * `pegsOf` and `slotsFree` (`state.ts:286` and `:294`) are deliberately NOT
 * duplicated: nothing on the board needs them yet, and when the engine
 * compiles they are imported from there rather than copied. Copying
 * speculative helpers is how two engines start disagreeing.
 */

import type { BoardZone } from './types';

/** Pegs in the zone, anyone's. */
export function pegsFilled(zone: BoardZone): number {
  return zone.areas.reduce((n, a) => n + (a.peg ? 1 : 0), 0);
}