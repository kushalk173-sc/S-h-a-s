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

export function winners(state: GameState): PlayerID[] {
  const s = scores(state);
  const best = Math.max(0, ...Object.values(s));
  return Object.entries(s)
    .filter(([, v]) => v === best)
    .map(([k]) => k);
}

/** Total voters on the board for a player, majority or not. */
export function totalVoters(state: GameState, player: PlayerID): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) if (a.peg?.owner === player) n += 1;
  }
  return n;
}
