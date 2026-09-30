import { BOARD } from './board.generated';
import {
  pegsFilled,
  type Area,
  type AreaID,
  type GameState,
  type PlayerID,
  type Zone,
  type ZoneID,
} from './state';

export { BOARD, BOARD_HEIGHT, BOARD_WIDTH, COASTLINE, TOTAL_AREAS } from './board.generated';
export type { AreaSpec, ZoneSpec } from './board.generated';

/** A fresh, empty board. */
export function freshZones(): Zone[] {
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

export function zoneOfArea(areaId: AreaID): ZoneID {
  const dash = areaId.lastIndexOf('-');
  return areaId.slice(0, dash) as ZoneID;
}

export function areNeighbours(a: ZoneID, b: ZoneID): boolean {
  const zone = BOARD.find((z) => z.id === a);
  return zone ? zone.neighbours.includes(b) : false;
}

/**
 * Recompute a zone's majority after any change to its pegs.
 *
 * p8: a majority forms the instant the requirement is met, and exactly as many
 * voters as the requirement are flipped symbol-side up. Extra voters stay blank.
 * p9: if the holder drops below the requirement the majority breaks and their
 * remaining voters flip back.
 *
 * Which pegs get flipped is the player's choice at the table. We flip the ones in
 * Volatile Areas first — those are immovable anyway (p18), so spending them on the
 * majority leaves the player's mobile pegs free to be gerrymandered. That is what a
 * competent player would do, and it makes the result deterministic.
 */
export function recount(zone: Zone): Zone {
  const counts = new Map<PlayerID, number>();
  for (const a of zone.areas) {
    if (a.peg) counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
  }

  let holder: PlayerID | null = null;
  // R4 — VERIFIED DEAD ON THIS BOARD, independently of the audit. The audit (R4)
  // claimed "north_west is 6/11 so 6+6 is reachable"; it is not. Every one of the
  // nine zones has `capacity === 2 * majority - 1` (6/11, 11/21, 6/11, 9/17, 5/9,
  // 9/17, 6/11, 11/21, 6/11 — `board.generated.ts`), so two players would need
  // `2 * majority === capacity + 1` pegs in a zone that has `capacity` areas. No
  // arrangement of pegs reaches that, so at most one player can ever satisfy
  // `n >= zone.majority` and the last-write-wins below can never actually pick a
  // winner over an equal one. The tie is unreachable, so it needs no tie handling
  // today, and `recount` cannot disagree with `gerrymanderRights` — which does
  // handle ties, returning null (rules-reference.md:311) — because there is never
  // a majority tie to disagree about.
  //
  // This is a latent-defect record, not a fix. If a future board (or the 7-zone
  // 2-player board, 6/11 through 9/17, PLAN.md §6 row 7) has
  // `capacity >= 2 * majority` in any zone, this becomes a live bug and needs the
  // ruling that `rules-reference.md` §16 #7 still records as unsettled. The
  // geometry is pinned by a test in board.test.ts ("a simultaneous majority is
  // geometrically impossible on this board") so that change fails loudly.
  for (const [p, n] of counts) if (n >= zone.majority) holder = p;

  if (holder === null) {
    const areas = zone.areas.map((a) =>
      a.peg?.majority ? { ...a, peg: { ...a.peg, majority: false } } : a,
    );
    return { ...zone, areas, majorityHolder: null };
  }

  const order = zone.areas
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.peg?.owner === holder)
    .sort((x, y) => Number(y.a.volatile) - Number(x.a.volatile) || x.i - y.i)
    .slice(0, zone.majority)
    .map(({ a }) => a.id);
  const flipped = new Set(order);

  const areas = zone.areas.map<Area>((a) => {
    if (!a.peg) return a;
    const want = flipped.has(a.id);
    return a.peg.majority === want ? a : { ...a, peg: { ...a.peg, majority: want } };
  });

  return { ...zone, areas, majorityHolder: holder };
}

/** Replace one zone in the state and recount it. */
export function withZone(state: GameState, zone: Zone): GameState {
  const next = recount(zone);
  return { ...state, zones: state.zones.map((z) => (z.id === next.id ? next : z)) };
}

/** Replace one area, recounting the zone it belongs to. */
export function withArea(state: GameState, area: Area): GameState {
  const zone = state.zones.find((z) => z.id === area.zone);
  if (!zone) return state;
  return withZone(state, {
    ...zone,
    areas: zone.areas.map((a) => (a.id === area.id ? area : a)),
  });
}

export function boardFull(state: GameState): boolean {
  return state.zones.every((z) => pegsFilled(z) >= z.capacity);
}

/** p7/p20: the game ends when a majority has been formed in every zone. */
export function allMajoritiesFormed(state: GameState): boolean {
  return state.zones.every((z) => z.majorityHolder !== null);
}

/** Every majority voter a player holds. This is the score. p20. */
export function majorityVoters(state: GameState, player: PlayerID): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) if (a.peg?.owner === player && a.peg.majority) n += 1;
  }
  return n;
}

export function scores(state: GameState): Record<PlayerID, number> {
  const out: Record<PlayerID, number> = {};
  for (const id of state.turnOrder) out[id] = majorityVoters(state, id);
  return out;
}

/**
 * Who won. R5, ruled.
 *
 * p7/p20 (`rules-reference.md` §1): "The player with the highest number of
 * majority voters wins the game." Two things follow from that sentence and are
 * decided here:
 *
 *  1. **A tie is a genuine draw, reported as one.** p20's tie-breaker is the
 *     "privilege" rule, which §1 records as explicitly non-binding, social, and
 *     out of scope for a digital implementation, and it says "The engine reports
 *     a tie". So every player tied at the top score is returned. Neither total
 *     voters on the board nor manifesto size is used as a tie-breaker: p20 names
 *     only majority voters, and `totalVoters` is a number the rules never ask
 *     for. This closes `rules-reference.md` §16 #8.
 *
 *  2. **A game in which nobody holds a majority voter has no winner.** Before the
 *     fix the best score was floored at 0, so on an all-zero board `best === 0`
 *     matched every seat and the `game-over` event named the whole table as
 *     winners. The floor existed only to keep `Math.max(...[]) === -Infinity` off
 *     an empty turn order, which `setup` (2..5 players) already makes impossible.
 *
 * Is case 2 reachable in a real game? No, and that is deliberate rather than
 * accidental. `endOfGame` is reached either when every zone has a majority holder
 * (so the 69 majority voters exist and someone has them) or when the board is
 * full — and every zone has `capacity === 2 * majority - 1` areas, so a full
 * zone always contains a majority by pigeonhole. The guard is here so that a
 * *direct* call to `winners()` on a scoreless board reports "nobody" instead of
 * "everybody", and so that a future board with `capacity >= 2 * majority` (where
 * a full zone genuinely could have no majority) is already handled.
 */
export function winners(state: GameState): PlayerID[] {
  const entries = Object.entries(scores(state));
  if (entries.length === 0) return [];
  const best = Math.max(...entries.map(([, v]) => v));
  if (best <= 0) return [];
  return entries.filter(([, v]) => v === best).map(([k]) => k);
}

/** Total voters on the board for a player, majority or not. */
export function totalVoters(state: GameState, player: PlayerID): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) if (a.peg?.owner === player) n += 1;
  }
  return n;
}
