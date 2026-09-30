/**
 * Dev fixtures: real geometry, plausible peg states.
 *
 * The zones here are built from the same `ZoneSpec[]` the board renders from, so
 * a fixture can never invent a slot that does not exist. `makeZone` mirrors
 * `freshZones()` in `packages/engine/src/board.ts:16`, and `putPeg` mirrors the
 * same file's `withArea` + `recount`, including the rule that exactly
 * `zone.majority` pegs flip symbol-side up and that Volatile pegs flip first
 * (they are immovable anyway, so spending them on the majority leaves the
 * mobile pegs free — `board.ts:72-77`).
 *
 * Fixtures exist so the reviewer can SEE every row of the §4.6 matrix and every
 * state the dev harness advertises, without the engine running.
 */

import { BOARD } from './geometry';
import { pegsFilled } from './pegsOf';
import type { BoardPlayer, BoardZone, BoardZoneID, Peg } from './types';

export const PLAYERS: readonly BoardPlayer[] = [
  { id: 'p1', name: 'Ria', seat: 1 },
  { id: 'p2', name: 'Dev', seat: 2 },
  { id: 'p3', name: 'Anu', seat: 3 },
  { id: 'p4', name: 'Kabir', seat: 4 },
  { id: 'p5', name: 'Meher', seat: 5 },
];

/** A fresh, empty board. Mirrors `freshZones()`. */
export function makeZones(): BoardZone[] {
  return BOARD.map((spec) => ({
    id: spec.id,
    name: spec.name,
    majority: spec.majority,
    capacity: spec.capacity,
    neighbours: spec.neighbours,
    majorityHolder: null,
    areas: spec.areas.map((a) => ({
      id: a.id,
      zone: spec.id,
      volatile: a.volatile,
      peg: null,
    })),
  }));
}

/**
 * Place one peg and recount, mirroring `withArea` + `recount`. Recount is a
 * faithful reimplementation, not an approximation: it is what makes the harness
 * show pegs symbol-side up the moment a majority forms, which is the single
 * most consequential state transition in the game (§6.1.4).
 */
export function putPeg(zones: BoardZone[], areaId: string, owner: string): BoardZone[] {
  return zones.map((zone) => {
    if (!zone.areas.some((a) => a.id === areaId)) return zone;
    const areas = zone.areas.map((a) =>
      a.id === areaId ? { ...a, peg: { owner, majority: false } satisfies Peg } : a,
    );
    return recount({ ...zone, areas });
  });
}

/** Place many pegs at once, in order. */
export function putPegs(zones: BoardZone[], placements: readonly (readonly [string, string])[]): BoardZone[] {
  return placements.reduce((acc, [areaId, owner]) => putPeg(acc, areaId, owner), zones);
}

/** `recount` from `packages/engine/src/board.ts:56-87`. */
export function recount(zone: BoardZone): BoardZone {
  const counts = new Map<string, number>();
  for (const a of zone.areas) {
    if (a.peg === null) continue;
    counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
  }

  let holder: string | null = null;
  for (const [p, n] of counts) if (n >= zone.majority) holder = p;

  if (holder === null) {
    return {
      ...zone,
      majorityHolder: null,
      areas: zone.areas.map((a) =>
        a.peg?.majority === true ? { ...a, peg: { ...a.peg, majority: false } } : a,
      ),
    };
  }

  // Volatile pegs flip first: they are immovable, so spending them on the
  // majority leaves the player's mobile pegs free to be gerrymandered.
  const flipped = new Set(
    zone.areas
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.peg?.owner === holder)
      .sort((x, y) => Number(y.a.volatile) - Number(x.a.volatile) || x.i - y.i)
      .slice(0, zone.majority)
      .map(({ a }) => a.id),
  );

  return {
    ...zone,
    majorityHolder: holder,
    areas: zone.areas.map((a) => {
      if (a.peg === null) return a;
      const want = flipped.has(a.id);
      return a.peg.majority === want ? a : { ...a, peg: { ...a.peg, majority: want } };
    }),
  };
}

function zone(zones: readonly BoardZone[], id: BoardZoneID): BoardZone {
  const z = zones.find((x) => x.id === id);
  if (z === undefined) throw new Error(`no zone ${id}`);
  return z;
}

/** How full a zone is, for the harness captions. */
export function fill(zones: readonly BoardZone[], id: BoardZoneID): string {
  const z = zone(zones, id);
  return `${pegsFilled(z)}/${z.capacity}`;
}
