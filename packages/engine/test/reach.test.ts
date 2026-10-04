/**
 * THE STAND OF THE BOARD — the detector, and the guard that keeps it honest.
 *
 * This file exists because a real three-seat browser run sat at 490 turns with
 * eight constituencies held, Central one vote short with its last empty slot
 * right there, and nothing anywhere said so. A player cannot concede a game they
 * do not know is over and cannot tell a dead table from a slow one.
 *
 * ## THE THREE THINGS PROVEN HERE, and why all three are needed
 *
 *  1. **The reported position is detected.** The shape from the playtest, built by
 *    hand — 112 pegs placed, 17 free slots, eight of nine constituencies held,
 *    Central one vote short — plus a three-voter Voter Card group in hand that
 *    fits nowhere. `Stand` names the stranded group and rules on every seat.
 *  2. **The dead verdict is proved, not guessed.** One constituency further on,
 *    with Central's last empty slot taken by a third seat, nobody can reach a
 *    majority there any more and `dead` is true. `reach.ts` argues why that is a
 *    proof and not a snapshot; this is the assertion.
 *  3. **A healthy game is never called dead.** The regression guard, and the one
 *    that matters most: a detector which announces a dead table in the middle of a
 *    game that finishes on turn 72 is worse than no detector at all, and
 *    `winnable.test.ts` cannot catch it because `reduce` reads none of this. So the
 *    guard is stated here, over 20 seeds x 4 seat counts on both corpora, and it
 *    asserts at EVERY state of every game — not only the last one.
 *
 * ## ONE HONEST FINDING, STATED WHERE IT BELONGS
 *
 * The reported position — Central one vote short with its last empty slot right
 * there — is **not** a dead board under the rule, and the reason is arithmetic
 * rather than editorial: a seat one vote short in a zone with one free slot
 * satisfies `pegsOf + free >= majority` exactly, so the zone is reachable and
 * `lost` is empty. What that position actually has is a STRANDED GROUP: a Voter
 * Card whose three voters no zone can take, which p10 answers by discarding all
 * three. Both halves are tested below, one peg apart, because the sentence a
 * player needs differs and conflating them is how a detector becomes a liar.
 */

import { describe, expect, it } from 'vitest';

import { allMajoritiesFormed, boardFull, recount } from '../src/board';
import { reduce } from '../src/reduce';
import { roomiestZone, seatReach, standOf, strandedGroups, zoneReach } from '../src/reach';
import { placeableAreas } from '../src/reduce';
import type { GameState, Peg, PlayerID, ZoneID } from '../src/state';
import { playFullGame } from './driver';
import { bigCtx, freshFull, freshShipped, seats, shippedCtx } from './helpers';

// ─────────────────────── a board builder ───────────────────────

/**
 * Fill a constituency to an exact arrangement. `plan` is one owner id per area,
 * so a test can say "6 to p1, 3 to p2, 2 empty" without counting.
 */
function fill(state: GameState, zoneId: ZoneID, plan: readonly (PlayerID | null)[]): GameState {
  const z = state.zones.find((x) => x.id === zoneId);
  if (z === undefined) throw new Error(`no such zone ${zoneId}`);
  if (plan.length > z.areas.length) {
    throw new Error(`${zoneId} has ${z.areas.length} areas, plan has ${plan.length}`);
  }
  // Short plans mean "the rest of this zone is empty", which is how every fixture
  // in this file says "N free slots here" without counting them out loud.
  const full = [...plan, ...Array.from({ length: z.areas.length - plan.length }, () => null)];
  const areas = z.areas.map((a, i) => {
    const owner = full[i] ?? null;
    return owner === null ? a : { ...a, peg: { owner, majority: false } satisfies Peg };
  });
  return { ...state, zones: state.zones.map((x) => (x.id === zoneId ? recount({ ...x, areas }) : x)) };
}

/**
 * A run-length plan: `plan(['p1', 6], ['p2', 3], [null, 2])` is "6 to p1, 3 to
 * p2, then two empty", and a plan shorter than the zone means the rest is empty.
 */
function plan(
  ...runs: readonly (readonly [PlayerID | null, number])[]
): (PlayerID | null)[] {
  const out: (PlayerID | null)[] = [];
  for (const [owner, n] of runs) for (let i = 0; i < n; i++) out.push(owner);
  return out;
}

/** Give a seat an un-placed voter group, the way `grantVoters` does. */
function withGroup(
  state: GameState,
  player: PlayerID,
  group: { count: number; sameZone: boolean; source: string },
): GameState {
  const p = state.players[player];
  if (p === undefined) throw new Error(`no such player ${player}`);
  const id = `g-test-${player}-${p.pending.length}`;
  return {
    ...state,
    players: { ...state.players, [player]: { ...p, pending: [...p.pending, { id, ...group }] } },
  };
}

function pegsOn(state: GameState): number {
  return state.zones.reduce((n, z) => n + z.areas.filter((a) => a.peg !== null).length, 0);
}

function freeOn(state: GameState): number {
  return state.zones.reduce((n, z) => n + z.areas.filter((a) => a.peg === null).length, 0);
}

/**
 * THE REPORTED POSITION, built by hand.
 *
 * Eight constituencies held — each by one seat, each with exactly two free slots
 * left, which is what puts the roomiest zone at 2 and makes a three-voter card
 * unplaceable — and Central holding four p1 pegs against four p2 pegs with one
 * empty area. 112 pegs on the board, 17 free of 129.
 *
 * `central: 'one-short'` is the playtest's shape. `central: 'lost'` is the same
 * board with the last Central slot taken, which is what it takes for no seat to
 * have a line there.
 */
function reportedPosition(
  central: 'one-short' | 'lost',
  opts: { readonly stranded?: boolean } = {},
): GameState {
  let s = freshShipped(1, seats(3));
  s = fill(s, 'north_west', plan(['p1', 6], ['p2', 3], [null, 2])); // 6 of 11 → p1
  s = fill(s, 'north', plan(['p2', 11], ['p3', 8], [null, 2])); // 11 of 21 → p2
  s = fill(s, 'north_east', plan(['p3', 6], ['p1', 3], [null, 2])); // 6 of 11 → p3
  s = fill(s, 'west', plan(['p1', 9], ['p2', 6], [null, 2])); // 9 of 17 → p1
  s = fill(s, 'east', plan(['p2', 9], ['p3', 6], [null, 2])); // 9 of 17 → p2
  s = fill(s, 'south_west', plan(['p3', 6], ['p2', 3], [null, 2])); // 6 of 11 → p3
  s = fill(s, 'south', plan(['p1', 11], ['p3', 8], [null, 2])); // 11 of 21 → p1
  s = fill(s, 'south_east', plan(['p2', 6], ['p1', 3], [null, 2])); // 6 of 11 → p2
  s =
    central === 'one-short'
      ? fill(s, 'central', plan(['p1', 4], ['p2', 4], [null, 1])) // 4 + 4 of 5, one free
      : fill(s, 'central', plan(['p1', 3], ['p2', 3], ['p3', 2], [null, 1])); // 3 + 3 + 2 of 5
  if (opts.stranded !== false) {
    s = withGroup(s, 'p3', { count: 3, sameZone: true, source: 'Voter Card' });
  }
  return s;
}

// ─────────────────────── the reported position ───────────────────────

describe('the reported position', () => {
  it('is the board from the playtest: 112 pegs, 17 free, eight of nine held', () => {
    // The shape first, so a failure later in this file cannot be a fixture
    // arithmetic error. `winnable.test.ts` measures MAJORITY pegs (69 of them);
    // this is every peg, majority or not, which is what "117 of 137 pegs" was
    // counting on a run that never got past turn 490.
    const s = reportedPosition('one-short');
    expect(pegsOn(s)).toBe(112);
    expect(freeOn(s)).toBe(129 - 112);
    expect(s.zones.filter((z) => z.majorityHolder !== null)).toHaveLength(8);
    expect(s.zones.find((z) => z.id === 'central')?.majorityHolder).toBeNull();
  });

  it('reports the unplaceable three-voter group, and p10 says all three go', () => {
    const s = reportedPosition('one-short');
    // The arithmetic: the roomiest zone on the board has TWO free slots, so a
    // group of three cannot go in any of the nine.
    expect(roomiestZone(s)).toBe(2);

    const stand = standOf(s);
    expect(stand.stranded).toHaveLength(1);
    const g = stand.stranded[0];
    expect(g).toMatchObject({
      player: 'p3',
      count: 3,
      sameZone: true,
      source: 'Voter Card',
      roomiestZoneFree: 2,
    });

    // …and the engine agrees, on the same numbers, through its own helper.
    // `placeableAreas` is what the client's legal set is derived from, so if the
    // two ever disagree the board would offer slots the engine refuses — which is
    // the "a control that offers an illegal move" defect rather than a cosmetic one.
    const clean = reportedPosition('one-short', { stranded: false });
    const withThree = withGroup(clean, 'p3', {
      count: 3,
      sameZone: true,
      source: 'Voter Card',
    });
    const groupId = withThree.players.p3?.pending[0]?.id ?? '';
    expect(placeableAreas(withThree, groupId, 'p3')).toEqual([]);
    // A two-voter group on the same board DOES fit, which is what makes the three
    // a dead end rather than the board being full.
    const withTwo = withGroup(clean, 'p3', { count: 2, sameZone: true, source: 'Voter Card' });
    const twoId = withTwo.players.p3?.pending[0]?.id ?? '';
    expect(placeableAreas(withTwo, twoId, 'p3')).not.toEqual([]);
    expect(strandedGroups(withTwo)).toEqual([]);
  });

  it('is NOT a dead board, and the arithmetic says exactly why', () => {
    // THE FINDING. One vote short with one free slot is REACHABLE: a seat with 4
    // of Central's 5 and one empty area satisfies `pegsOf + free >= majority`
    // exactly. So `lost` is empty and `dead` is false.
    //
    // This is the part worth stating plainly, because the alternative — shipping
    // a banner that says "no ending is left" here — would be a lie, and a player
    // who saw it on turn 400 and kept playing would have been told to stop by an
    // engine that had not checked anything.
    const s = reportedPosition('one-short');
    const central = zoneReach(s, 'p1', 'central');
    expect(central).toMatchObject({ owned: 4, free: 1, majority: 5, missing: 1 });
    expect(central.reachable).toBe(true);

    const stand = standOf(s);
    expect(stand.lost).toEqual([]);
    expect(stand.dead).toBe(false);
    // Eight constituencies held, Central the only one open.
    expect(stand.undecided).toEqual(['central']);
  });

  it('rules on every seat, and calls the trailing seat out', () => {
    const s = reportedPosition('one-short');
    const stand = standOf(s);

    // p1 holds north_west, west and south — 6 + 9 + 11 = 26 majority voters, and
    // Central is one vote short of reaching 31.
    const p1 = stand.seats.find((x) => x.player === 'p1');
    expect(p1).toMatchObject({
      majoritiesHeld: 3,
      heldMajorityVoters: 26,
      canStillWin: true,
      canReachNine: false,
    });
    // Reachable for p1, in BOARD order: the three it holds, plus Central, which
    // is one voter short with one slot there. Every other constituency is two
    // free slots short of its requirement for a seat with no pegs there.
    expect(p1?.reachableZones).toEqual(['north_west', 'west', 'central', 'south']);
    expect(p1?.maxMajorityVoters).toBe(6 + 9 + 11 + 5);

    // p3 holds north_east and south_west for 12, cannot reach anything else, and
    // 12 cannot beat 26 — so it is out, and this is the sentence the table needs.
    const p3 = stand.seats.find((x) => x.player === 'p3');
    expect(p3).toMatchObject({
      majoritiesHeld: 2,
      heldMajorityVoters: 12,
      reachableZones: ['north_east', 'south_west'],
      canStillWin: false,
    });
    expect(stand.out).toContain('p3');
    expect(stand.inPlay).toContain('p1');
    expect(stand.inPlay).toContain('p2');
  });
});

// ─────────────────────── the dead verdict ───────────────────────

describe('a constituency that can never be decided', () => {
  it('is detected one peg away, and it is the strongest claim available', () => {
    // Same board, but Central's last empty area now carries a third seat's peg:
    // 3 + 3 + 2 of a majority of 5, with one slot free. Every seat needs two
    // voters it cannot fit, so the zone satisfies `pegsOf + free >= majority` for
    // NOBODY and is `lost`.
    const s = reportedPosition('lost');
    for (const id of ['p1', 'p2', 'p3']) {
      expect(zoneReach(s, id, 'central').reachable, `${id} reaches Central`).toBe(false);
    }
    const stand = standOf(s);
    expect(stand.lost).toEqual(['central']);
    expect(stand.dead).toBe(true);
    // …and it is reported as a condition, never acted on. `reduce` has not heard
    // of it: the very next action is still legal.
    const r = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, shippedCtx());
    expect(r.ok).toBe(true);
  });

  it('the same board with Central decided is not dead', () => {
    // The boundary, one peg the other way: 4 + 5 of 5 is p2 holding Central, and
    // a decided constituency is never `lost`. A detector that fires on a full
    // board with all nine held would be reporting a finished game as unwinnable.
    let s = reportedPosition('lost', { stranded: false });
    s = fill(s, 'central', plan(['p2', 5], ['p1', 2], ['p3', 1], [null, 1]));
    const stand = standOf(s);
    expect(stand.lost).toEqual([]);
    expect(stand.dead).toBe(false);
    expect(stand.undecided).toEqual([]);
  });

  it('a FINISHED game is never dead, whatever the board says', () => {
    // The rulebook already gave the table a result. Calling it unwinnable would be
    // a lie about a result it has been handed.
    const { state } = playFullGame(freshFull(3, seats(3)), bigCtx());
    expect(state.finished).toBe(true);
    const stand = standOf(state);
    expect(stand.dead).toBe(false);
  });
});


// ----------------------- the regression guard -----------------------

/**
 * THE GUARD AGAINST CONSTRAINT 4, and the reason it is here rather than in
 * `winnable.test.ts`.
 *
 * `reduce` reads nothing from `reach.ts`, so no existing suite can notice if the
 * detector starts announcing dead tables in games that finish perfectly well. A
 * detector that fires in the first third of a game is worse than no detector: it
 * tells a player to stop playing a game that is going to be decided on turn 72.
 *
 * The shape of the guard is therefore not "no game is ever called dead" � that
 * would be false, and below is why. It is three measured claims about WHEN each
 * signal may fire, made over 20 seeds x 4 seat counts on both corpora and
 * asserted at every state of every game, not only the last one:
 *
 *   1. A game that ends with all nine majorities formed is never called dead at
 *      any point. This follows from `lost` being a proof rather than a snapshot,
 *      and it is the assertion that would fail first if someone softened `lost`
 *      into a heuristic.
 *   2. A game in which the condition ever became true ended on p20's board-full
 *      timer � which is what the condition MEANS, and saying so in a test is how
 *      it stops being mistaken for "the game never ends".
 *   3. None of the three signals fires while more than 100 of the board's 129
 *      slots are still free. Measured 0 occurrences of each over 23,636 shipped
 *      states and 30,150 big-corpus states; all three are endgame facts and a
 *      rule change that made one of them fire on turn 3 fails here.
 */
describe('the signals fire only when they are true', () => {
  const CORPORA = [
    ['shipped', shippedCtx, (seed: number, n: number) => freshShipped(seed, seats(n))],
    ['big', bigCtx, (seed: number, n: number) => freshFull(seed, seats(n))],
  ] as const;

  /** Slots the board must still have free for a signal to be considered "early". */
  const EARLY_FREE = 100;

  for (const [label, ctxFor, mk] of CORPORA) {
    it(`${label}: 20 seeds x 4 seat counts, checked at EVERY state`, () => {
      const ctx = ctxFor();
      let games = 0;
      let states = 0;
      let nineEndings = 0;
      let timerEndings = 0;
      const contradictions: string[] = [];
      const early: string[] = [];

      for (const n of [2, 3, 4, 5]) {
        for (let seed = 1; seed <= 20; seed++) {
          const tag = `${label} ${n} players seed ${seed}`;
          let everDead = false;
          const { state } = playFullGame(mk(seed, n), ctx, (s) => {
            states += 1;
            const stand = standOf(s);
            if (stand.dead) everDead = true;
            if (!stand.dead && !everDead) return;
            if (stand.dead && allMajoritiesFormed(s)) {
              contradictions.push(`${tag} turn ${s.turn}: called dead with all nine held`);
            }
            const free = freeOn(s);
            if (free <= EARLY_FREE) return;
            if (stand.dead) early.push(`${tag} turn ${s.turn} free ${free}: dead`);
            if (stand.out.length > 0) early.push(`${tag} turn ${s.turn} free ${free}: out`);
            if (stand.stranded.length > 0) {
              early.push(`${tag} turn ${s.turn} free ${free}: stranded`);
            }
          });
          games += 1;
          expect(state.finished, `${tag} did not finish`).toBe(true);
          const stand = standOf(state);
          // A game the rulebook has already ended is never reported as unwinnable.
          expect(stand.dead, `${tag} ended dead`).toBe(false);
          if (allMajoritiesFormed(state)) {
            nineEndings += 1;
            expect(everDead, `${tag} reached nine after being called dead`).toBe(false);
          } else {
            expect(boardFull(state), `${tag} finished by neither rule`).toBe(true);
            timerEndings += 1;
          }
        }
      }

      expect(games).toBe(80);
      expect(states).toBeGreaterThan(20_000);
      expect(nineEndings, `${label}: no game ended on nine majorities`).toBeGreaterThan(40);
      expect(timerEndings, `${label}: no game ended on the board-full timer`).toBeGreaterThan(20);
      expect(contradictions, `${label}: the condition contradicted its own ending`).toEqual([]);
      expect(early, `${label}: a signal fired with the board still open`).toEqual([]);
    });
  }

  it('the four games `winnable.test.ts` pins are open right through', () => {
    // The same seeds and seat counts that suite asserts win on a specific turn.
    // A detector that called any of them dead on any state would be announcing a
    // dead table in a game the repository has already proved is decided.
    const ctx = shippedCtx();
    const pinned: readonly (readonly [number, number])[] = [
      [19, 5],
      [1, 2],
      [1, 3],
      [1, 4],
      [29, 4],
    ];
    for (const [seed, n] of pinned) {
      const { state } = playFullGame(freshShipped(seed, seats(n)), ctx, (s) => {
        const stand = standOf(s);
        expect(stand.dead, `${n} players seed ${seed} turn ${s.turn} was called dead`).toBe(false);
        expect(stand.lost, `${n} players seed ${seed} turn ${s.turn} lost a constituency`).toEqual(
          [],
        );
      });
      expect(state.finished).toBe(true);
      expect(allMajoritiesFormed(state)).toBe(true);
    }
  });

  it('a fresh table is open to everybody', () => {
    // Setup: nine empty constituencies, every seat reachable in every one of
    // them. The banner must be silent and `inPlay` must be the whole table.
    for (const n of [2, 3, 4, 5]) {
      const stand = standOf(freshShipped(1, seats(n)));
      expect(stand.dead).toBe(false);
      expect(stand.lost).toEqual([]);
      expect(stand.stranded).toEqual([]);
      expect(stand.inPlay).toEqual(seats(n));
      expect(stand.out).toEqual([]);
      expect(stand.undecided).toHaveLength(9);
    }
  });

  it('reads the state and never writes it, so it cannot move a game', () => {
    // The whole purity contract of this module in one assertion: `standOf` is a
    // function of `state` and leaves `state` byte-identical. If it ever grew a
    // cache or a counter, a replay from seed + action log would stop reproducing
    // every intermediate state � R2, and the reason this is tested rather than
    // asserted in a comment.
    const s = reportedPosition('one-short');
    const before = structuredClone(s);
    const a = standOf(s);
    standOf(s);
    expect(s).toEqual(before);
    expect(standOf(s)).toEqual(a);
  });
});

// ----------------------- the rule itself -----------------------

describe('the reachability rule', () => {
  it('reads exactly `pegsOwned + freeSlots >= majority`, with free slots needed', () => {
    // Stated as a table so a future edit to the predicate cannot quietly change
    // what "reachable" means. Central is 5 of 9; p2 and p3 top up whatever p1
    // leaves, so only p1's own count and the room left are under test.
    const rows: readonly (readonly [number, number, boolean])[] = [
      [0, 5, true], // 5 empty, needs 5
      [0, 4, false], // 4 empty, needs 5
      [4, 1, true], // THE REPORTED CASE: one vote short, one slot right there
      [4, 0, false], // one vote short and nowhere to put it
      [5, 0, true], // already holds it, and the zone is full
      [3, 2, true], // two short with two slots
      [3, 1, false], // two short with one slot
    ];
    for (const [owned, free, reachable] of rows) {
      const others = 9 - owned - free;
      const half = Math.ceil(others / 2);
      const s = fill(
        freshShipped(1, seats(3)),
        'central',
plan(
          ['p1', owned] as const,
          ['p2', half] as const,
          ['p3', others - half] as const,
          [null, free] as const,
        ),
      );
      const r = zoneReach(s, 'p1', 'central');
      expect(r.free, `${owned} owned, ${free} free`).toBe(free);
      expect(r.owned).toBe(owned);
      expect(r.reachable, `${owned} owned + ${free} free vs 5`).toBe(reachable);
    }
  });

  it('throws on a constituency that does not exist, rather than reporting nonsense', () => {
    expect(() => zoneReach(freshShipped(1), 'p1', 'nowhere' as ZoneID)).toThrow();
  });

  it('is a pure function of the board: the same board always answers alike', () => {
    const s = reportedPosition('one-short');
    expect(standOf(s)).toEqual(standOf(s));
    expect(seatReach(s, 'p1', 26)).toEqual(seatReach(s, 'p1', 26));
  });
});
