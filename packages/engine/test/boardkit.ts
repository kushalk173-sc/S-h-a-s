/**
 * A state builder for unit tests that need pegs on the board.
 *
 * Every reducer test starts from a `setup()` position but almost all of them need
 * a specific arrangement of voters first. Rebuilding that by issuing real
 * INFLUENCE/PLACE_VOTERS actions is slow and hides what the test is actually
 * asserting, so this writes pegs directly through the same `recount` the reducer
 * uses — meaning the board invariants under test are the real ones.
 */

import { recount } from '../src/board';
import type { AreaID, GameState, Peg, PlayerID, ZoneID } from '../src/state';
import { emptyIn } from './helpers';

/**
 * Give `owner` exactly `n` pegs in `zone`, adding more on top of any they already
 * hold there. Absolute rather than incremental, so a test can say "p1 has 6 in
 * north_west" without tracking how many it already placed.
 */
export function withPegs(
  s: GameState,
  owner: PlayerID,
  zone: ZoneID,
  n: number,
  opts: { readonly from?: readonly AreaID[] } = {},
): GameState {
  const z = s.zones.find((x) => x.id === zone);
  if (!z) throw new Error(`no such zone ${zone}`);
  const already = z.areas.filter((a) => a.peg?.owner === owner).map((a) => a.id);
  const need = n - already.length;
  if (need <= 0) return s;
  const free = (opts.from ?? z.areas.filter((a) => a.peg === null).map((a) => a.id))
    .filter((id) => !already.includes(id));
  if (free.length < need) {
    throw new Error(`${zone} has only ${free.length} free areas, needed ${need}`);
  }
  const want = new Set(free.slice(0, need));
  const areas = z.areas.map((a) =>
    want.has(a.id) ? { ...a, peg: { owner, majority: false } satisfies Peg } : a,
  );
  return { ...s, zones: s.zones.map((x) => (x.id === zone ? recount({ ...x, areas }) : x)) };
}

/** Put one peg on one named area, wherever it is. */
export function withPegAt(s: GameState, areaId: AreaID, owner: PlayerID): GameState {
  const zoneId = areaId.slice(0, areaId.lastIndexOf('-')) as ZoneID;
  return withPegs(s, owner, zoneId, 1, { from: [areaId] });
}

/** The first `n` non-volatile free areas in a zone — for gerrymander destinations. */
export function plainFreeIn(s: GameState, zone: ZoneID, n: number): AreaID[] {
  const z = s.zones.find((x) => x.id === zone);
  if (!z) return [];
  return z.areas.filter((a) => a.peg === null && !a.volatile).map((a) => a.id).slice(0, n);
}

export function areaOf(s: GameState, areaId: AreaID) {
  for (const z of s.zones) {
    const a = z.areas.find((x) => x.id === areaId);
    if (a) return a;
  }
  throw new Error(`no such area ${areaId}`);
}

/** Replace one area wholesale. */
export function setAreaState(
  s: GameState,
  areaId: AreaID,
  peg: Peg | null,
): GameState {
  const zoneId = areaId.slice(0, areaId.lastIndexOf('-')) as ZoneID;
  return {
    ...s,
    zones: s.zones.map((z) =>
      z.id === zoneId
        ? { ...z, areas: z.areas.map((a) => (a.id === areaId ? { ...a, peg } : a)) }
        : z,
    ),
  };
}

/** A state where `p` has already answered, so the turn phase is `actions`. */
export function answered(
  s: GameState,
  p: PlayerID,
  opts: { readonly manifesto?: number; readonly side?: 0 | 1 } = {},
): GameState {
  const side = opts.side ?? 0;
  const n = opts.manifesto ?? 0;
  const cur = s.players[p];
  if (!cur) throw new Error(`no such player ${p}`);
  const manifesto = [...cur.manifesto];
  for (let i = 0; i < n; i++) manifesto.push('capitalist');
  const resources = { ...cur.resources, funds: cur.resources.funds + 6 + n * 2 };
  return {
    ...s,
    activePlayer: p,
    phase: 'actions',
    _pendingCard: null,
    players: {
      ...s.players,
      [p]: { ...cur, manifesto, resources, powerUses: { ...cur.powerUses } },
    },
  };
}
