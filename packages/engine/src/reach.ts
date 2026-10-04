/**
 * THE STAND OF THE BOARD — can anybody still win, and is anything in hand
 * stranded?
 *
 * ## THE DEFECT THIS EXISTS FOR
 *
 * A real three-seat browser run stalled at 490 turns: 117 pegs placed, 20 free
 * slots, eight of nine constituencies holding a majority, and Central one vote
 * short with its last empty slot right there. Nothing on the wire said so. The
 * table had no way to know whether to keep playing or to stop, and the game had
 * no way to end — `advanceTurn`'s doors are `allMajoritiesFormed` and p20's
 * board-full final round, and a board whose free slots are all in constituencies
 * that cannot decide anything reaches the first of those very slowly and the
 * second not at all.
 *
 * ## WHAT IS REPORTED AND WHAT IS NOT
 *
 * **Reported: the arithmetic, and only the arithmetic.** For every seat and every
 * constituency: how many voters that seat has, how many empty slots the zone has
 * left, how many more it needs, and whether the two still add up. Everything in
 * `Stand` is a pure function of `state.zones` and `state.players[].pending` —
 * both unprefixed, both on every client payload — so this satisfies
 * `KNOWN-GAPS.md` §2bis in its strict form: a decision may enumerate a set only
 * if the set is already public when the decision is raised, and this enumerates
 * only the board and the un-placed voter groups, which are the most public
 * things in the game.
 *
 * **Not reported: an ending.** There is no rulebook provision for a table
 * declaring itself unwinnable, and this module does not add one. `Stand.dead` is
 * a CONDITION; `reduce` never reads it, `finished` is never set from it, and no
 * game ends one turn earlier because of anything in this file. That non-change
 * is the design, not an omission: an engine that ended a game by declaring it
 * unwinnable would pass every winnability suite in the repository — `dead` is
 * *true* is not an assertion any of them makes — while destroying the game.
 *
 * ## THE REACHABILITY RULE, in one line, exactly as it is applied
 *
 * > A zone can still produce a majority for a seat `p` when
 * > `pegsOf(p, zone) + freeSlots(zone) >= zone.majority`, and free slots remain.
 *
 * Both halves are load-bearing. The sum alone says a majority is arithmetically
 * possible; `freeSlots(zone) > 0` says it is possible **by placement**, because
 * the only way a peg ever enters a zone is by filling an empty area in it — a
 * Gerrymander lands on an empty slot (p16) and a conversion does too. A seat
 * already holding the majority has `pegsOf >= majority`, so `missing` is floored
 * at zero and its zone reads reachable with no free slot at all, which is
 * correct: it is holding it.
 *
 * ## `dead` IS THE STRONG CLAIM AND IT IS PROVABLE. `canStillWin` IS THE USEFUL ONE
 *
 * There are two different questions here and conflating them is how a detector
 * becomes a lie.
 *
 *  - **`dead`** — *some constituency can no longer be decided by anybody.* That is
 *    `lost.length > 0`, and it is the honest reading of "no line to nine exists":
 *    a zone no seat can reach is a zone nobody can ever hold, so
 *    `allMajoritiesFormed` can never become true, so p7's ending is shut for
 *    good. It is a **proof**, not a heuristic, for the direction that matters: a
 *    peg can only ever enter a zone by filling an empty area, so a zone with no
 *    empty area left and no majority in it is closed to everybody, and adding
 *    seats elsewhere cannot reopen it. It fires rarely and it is never wrong.
 *
 *    The narrower reading — "no *single seat* can reach all nine" — is **not**
 *    used, and had better be explained. It is true of almost every healthy
 *    mid-game: eight constituencies each being reachable only by their own
 *    incumbent is the normal shape of a board, not a fault. A detector that
 *    fired on it would announce a dead table in the middle of a game that then
 *    finishes normally on turn 72, which is the regression
 *    `winnable.test.ts` exists to prevent and which a flag this engine reads
 *    nothing from would not be caught by.
 *
 *  - **`canStillWin`** — *can this seat still finish above the current leader?*
 *    p7/p20 do not award the board to whoever reaches nine; they stop play once
 *    all nine are held and score the **majority voters**, so a seat that can
 *    never hold nine can absolutely still win. The honest upper bound is
 *    `maxMajorityVoters(p)` = the sum of the requirements of every constituency
 *    `p` can still take, and `p` is `out` when that cannot beat the seat already
 *    in front. This is what the table actually wants to know, and it is what the
 *    client prints.
 *
 * ## WHAT THE RULE STILL IS NOT, because the honest limits are load-bearing
 *
 *  - **It is a statement about the board as it stands, not a proof about every
 *    board reachable from here.** `pegsOf` can fall and `freeSlots` can rise
 *    again: a Gerrymander moves a peg out of a zone it holds and another in from
 *    next door, and effects convert and evict. So `reachable` can be true now
 *    and false later, or the reverse. The report is recomputed on every
 *    projection and is never cached, and `canStillWin` is deliberately the
 *    CONSERVATIVE reading of it — a seat is only called `out` when it cannot win
 *    from here, never the other way round.
 *  - **It knows nothing about the economy.** Whether a seat can *afford* the
 *    voters that would close a gap is a question about resources, the market and
 *    the manifestos, and none of that is derivable from the board. The endgame
 *    really is economic rather than spatial, which is exactly why a spatially
 *    reachable position can still be a table nobody enjoys — and why
 *    `Stand.stranded` exists as a separate fact rather than being folded in.
 *  - **It says nothing about atomic groups** except in `StrandedGroup`, which is
 *    the separate p10 fact below.
 */

import { pegsOf, slotsFree, type GameState, type PlayerID, type ZoneID } from './state';

/** The arithmetic behind one zone, for one seat. Every field is public. */
export type ZoneReach = {
  readonly zoneId: ZoneID;
  readonly zoneName: string;
  /** Voters one seat needs for this zone's majority. p8. */
  readonly majority: number;
  /** Empty slots left in the zone. p34. */
  readonly free: number;
  /** Pegs this seat already has here, majority voters included. */
  readonly owned: number;
  /** `majority - owned`, floored at zero. */
  readonly missing: number;
  /** `owned + free >= majority` and `free > 0`, or the seat already holds it. */
  readonly reachable: boolean;
};

/** What one seat can still reach, and whether it can still win. */
export type SeatReach = {
  readonly player: PlayerID;
  /** Constituencies whose majority this seat holds right now. */
  readonly majoritiesHeld: number;
  /** Majority VOTERS this seat is scoring right now. p20. */
  readonly heldMajorityVoters: number;
  /** Constituencies this seat can still take. */
  readonly reachableZones: readonly ZoneID[];
  /** How many of the nine that is. */
  readonly reachableCount: number;
  /**
   * The most majority voters this seat can finish on: the sum of the
   * requirements of every constituency it can still take. Upper bound, not a
   * plan — it ignores the economy entirely, on purpose.
   */
  readonly maxMajorityVoters: number;
  /** `reachableCount === zones.length`: the only line to holding the board. */
  readonly canReachNine: boolean;
  /** This seat can still finish above the seat in front. See the header. */
  readonly canStillWin: boolean;
  /** The per-zone arithmetic, in board order. This is the reasoning. */
  readonly zones: readonly ZoneReach[];
};

/**
 * A voter group in hand that fits nowhere.
 *
 * p10 (`rules-reference.md:204-210`) makes a Voter Card's voters ATOMIC per zone
 * and then says what happens when there is nowhere to put them: *"If no single
 * zone has enough empty areas for a card's voters, all voters from that card are
 * discarded."* So this is not a bug state — it is a position the rulebook has
 * already ruled on, and the only thing missing was telling anybody.
 *
 * The rule's own discard is the end-of-turn sweep in `advanceTurn`, so the voters
 * do leave. The player is simply never told, which is how a table sits here for
 * hundreds of turns believing it is still buying voters.
 */
export type StrandedGroup = {
  readonly player: PlayerID;
  readonly groupId: string;
  /** Voters in the group, after anything already placed from it. */
  readonly count: number;
  /** `true` for a Voter Card group — the p10 case. */
  readonly sameZone: boolean;
  /** Printed source, e.g. `Voter Card`. */
  readonly source: string;
  /**
   * The most free slots in any single zone — the number this group has to beat.
   * `count > roomiestZoneFree` is exactly p10's discard condition.
   */
  readonly roomiestZoneFree: number;
};

/** The whole board's standing, in one value. Public, and derived on demand. */
export type Stand = {
  /** Constituencies on the board. Nine on every shipped board. */
  readonly zonesTotal: number;
  /** Constituencies with no majority holder. p8. */
  readonly undecided: readonly ZoneID[];
  /**
   * Constituencies NO seat can still take a majority in. Non-empty is
   * `allMajoritiesFormed` unreachable — see the header.
   */
  readonly lost: readonly ZoneID[];
  /** True when some constituency can never be decided again. */
  readonly dead: boolean;
  /** Seats that can still finish above the leader, in turn order. */
  readonly inPlay: readonly PlayerID[];
  /** Seats that cannot, in turn order. */
  readonly out: readonly PlayerID[];
  /** Per-seat arithmetic, in turn order. */
  readonly seats: readonly SeatReach[];
  /** Voter groups that fit nowhere. p10. */
  readonly stranded: readonly StrandedGroup[];
};

/** Empty slots in the roomiest zone on the board. */
export function roomiestZone(state: GameState): number {
  let best = 0;
  for (const z of state.zones) best = Math.max(best, slotsFree(z));
  return best;
}

/** The arithmetic for one seat in one zone. */
export function zoneReach(state: GameState, player: PlayerID, zoneId: ZoneID): ZoneReach {
  const z = state.zones.find((x) => x.id === zoneId);
  if (z === undefined) throw new Error(`no such zone: ${zoneId}`);
  const owned = pegsOf(z, player);
  const free = slotsFree(z);
  const missing = Math.max(0, z.majority - owned);
  // `missing === 0` means the seat already holds this majority, so it needs no
  // empty slot to keep it. Folding that in is what stops `canReachNine` reading
  // a seat that is already holding the board as momentarily unreachable.
  const reachable = missing === 0 || (free > 0 && owned + free >= z.majority);
  return {
    zoneId: z.id,
    zoneName: z.name,
    majority: z.majority,
    free,
    owned,
    missing,
    reachable,
  };
}

/** What one seat can still reach. `leaderScore` is the seat in front, on p20's score. */
export function seatReach(state: GameState, player: PlayerID, leaderScore: number): SeatReach {
  const zones = state.zones.map((z) => zoneReach(state, player, z.id));
  const reachableZones = zones.filter((r) => r.reachable).map((r) => r.zoneId);
  const maxMajorityVoters = zones
    .filter((r) => r.reachable)
    .reduce((n, r) => n + r.majority, 0);
  const heldMajorityVoters = state.zones
    .filter((z) => z.majorityHolder === player)
    .reduce((n, z) => n + z.majority, 0);
  return {
    player,
    majoritiesHeld: state.zones.filter((z) => z.majorityHolder === player).length,
    heldMajorityVoters,
    reachableZones,
    reachableCount: reachableZones.length,
    maxMajorityVoters,
    canReachNine: reachableZones.length === state.zones.length,
    // `<=` and not `<`: a tie is a genuine draw (p20, and `board.ts:winners`), so
    // a seat that can only draw is still in it. Calling a seat out on a tie it
    // could win is the one version of this sentence a player would call a lie.
    canStillWin: maxMajorityVoters > leaderScore,
    zones,
  };
}

/**
 * Voter groups waiting on somebody's mat that cannot be placed anywhere.
 *
 * One pass over `players[].pending`, which is public on every payload. p10's own
 * condition is the test: the roomiest zone on the board must have fewer free
 * slots than the group needs. A group already partly placed is judged on what is
 * LEFT of it, which is the number `PLACE_VOTERS` checks.
 */
export function strandedGroups(state: GameState): StrandedGroup[] {
  const roomiest = roomiestZone(state);
  const out: StrandedGroup[] = [];
  for (const id of state.turnOrder) {
    const p = state.players[id];
    if (p === undefined) continue;
    for (const g of p.pending) {
      if (g.count <= 0) continue;
      // p10's atomic group is the only kind that can be stranded while the board
      // still has room. Everything else — evictions, headlines, conspiracies — is
      // splittable, so it goes down one voter at a time and p34's end-of-turn
      // sweep already resolves the whole-board-full case.
      if (!g.sameZone) continue;
      if (g.count <= roomiest) continue;
      out.push({
        player: id,
        groupId: g.id,
        count: g.count,
        sameZone: g.sameZone,
        source: g.source,
        roomiestZoneFree: roomiest,
      });
    }
  }
  return out;
}

/**
 * THE STAND OF THE BOARD. One call, everything a client needs to tell a player
 * whether this game is still going anywhere.
 *
 * Pure, and a function of `state` alone: no clock, no seed, no module scope, and
 * not one `_`-prefixed field. `packages/server`'s secret gate walks every file it
 * scans for a `._` read, and this module has none — which is why the report goes
 * on the wire whole instead of one derived boolean at a time.
 */
export function standOf(state: GameState): Stand {
  const zonesTotal = state.zones.length;
  const undecided = state.zones.filter((z) => z.majorityHolder === null).map((z) => z.id);

  // The strongest reading of "no line to nine exists", and the only one that is a
  // proof rather than a snapshot: a constituency with no majority that no seat
  // can still take. `lost` non-empty means `allMajoritiesFormed` can never
  // become true whatever anybody does from here.
  const lost = state.zones
    .filter(
      (z) =>
        z.majorityHolder === null &&
        state.turnOrder.every((id) => !zoneReach(state, id, z.id).reachable),
    )
    .map((z) => z.id);

  // p20's score is the SUM of majority voters a seat holds, not the size of its
  // biggest zone, so the seat in front is found by summing per seat first. Getting
  // this wrong would make `canStillWin` answer against the wrong number, and the
  // whole point of the field is that a player can trust it.
  const scoreOf = (id: PlayerID): number =>
    state.zones
      .filter((z) => z.majorityHolder === id)
      .reduce((n, z) => n + z.majority, 0);
  const leaderScore = state.turnOrder.reduce((n, id) => Math.max(n, scoreOf(id)), 0);

  const seats = state.turnOrder.map((id) => seatReach(state, id, leaderScore));

  return {
    zonesTotal,
    undecided,
    lost,
    // A finished game has already ended by one of the rulebook's own doors, so it
    // is never "dead". Announcing a decided game as unwinnable would be a lie
    // about a result the table has already been given.
    dead: !state.finished && lost.length > 0,
    inPlay: seats.filter((s) => s.canStillWin).map((s) => s.player),
    out: seats.filter((s) => !s.canStillWin).map((s) => s.player),
    seats,
    stranded: strandedGroups(state),
  };
}