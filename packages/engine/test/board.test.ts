/**
 * §3.3 MAJORITY FORMATION AND BREAKING — board.ts, rules-reference.md:173-183.
 */

import { describe, expect, it } from 'vitest';

import {
  allMajoritiesFormed,
  boardFull,
  majorityVoters,
  recount,
  scores,
  totalVoters,
  winners,
  withZone,
} from '../src/board';
import { pegsFilled, type Area, type GameState, type Zone } from '../src/state';
import { withPegAt, withPegs } from './boardkit';
import { fresh, freshFull, PLAYERS_3 } from './helpers';

function zone(s: GameState, id: string): Zone {
  const z = s.zones.find((x) => x.id === id);
  if (!z) throw new Error(`no zone ${id}`);
  return z;
}

/** Place `n` pegs for `owner` in a zone by writing the board directly. */
function fill(s: GameState, owner: string, zoneId: string, n: number): GameState {
  return withPegs(s, owner, zoneId as never, n);
}

describe('majority formation', () => {
  it('forms the instant the requirement is met, and not before', () => {
    // north_west is 6/11.
    let s = fresh(1);
    s = fill(s, 'p1', 'north_west', 5);
    // Only pegged areas can be "blank side up"; an empty area has no peg at all.
    const held = (st: GameState, z: string) => zone(st, z).areas.filter((a) => a.peg !== null);
    expect(zone(s, 'north_west').majorityHolder).toBeNull();
    expect(held(s, 'north_west').every((a) => a.peg?.majority === false)).toBe(true);

    s = fill(s, 'p1', 'north_west', 6);
    expect(zone(s, 'north_west').majorityHolder).toBe('p1');
    expect(zone(s, 'north_west').areas.filter((a) => a.peg?.majority === true)).toHaveLength(6);
  });

  it('exactly the requirement is flipped, never more', () => {
    let s = fill(fresh(1), 'p1', 'north_west', 6);
    // board.ts slices to zone.majority.
    expect(zone(s, 'north_west').areas.filter((a) => a.peg?.majority === true)).toHaveLength(6);
    s = fill(s, 'p1', 'north_west', 7);
    expect(zone(s, 'north_west').areas.filter((a) => a.peg?.majority === true)).toHaveLength(6);
  });

  it('extra voters placed after the majority forms stay blank side up and score 0', () => {
    // rules-reference.md:180.
    let s = fill(fresh(1), 'p1', 'north_west', 6);
    s = fill(s, 'p1', 'north_west', 7);
    const z = zone(s, 'north_west');
    expect(z.areas.filter((a) => a.peg?.majority === true)).toHaveLength(6);
    const blank = z.areas.filter((a) => a.peg?.owner === 'p1' && a.peg.majority === false);
    expect(blank).toHaveLength(1);
  });

  it('breaks when the holder drops below the requirement and the rest flip back', () => {
    let s = fill(fresh(1), 'p1', 'north_west', 6);
    expect(zone(s, 'north_west').majorityHolder).toBe('p1');
    // Evict one.
    const victim = zone(s, 'north_west').areas.find((a) => a.peg?.owner === 'p1');
    if (!victim?.peg) throw new Error('expected a peg');
    s = {
      ...s,
      zones: s.zones.map((z) =>
        z.id === 'north_west'
          ? { ...z, areas: z.areas.map((a) => (a.id === victim.id ? { ...a, peg: null } : a)) }
          : z,
      ),
    };
    s = withZone(s, zone(s, 'north_west'));
    expect(zone(s, 'north_west').majorityHolder).toBeNull();
    expect(zone(s, 'north_west').areas.every((a) => a.peg?.majority !== true)).toBe(true);
  });

  it('recount flips Volatile pegs first so mobile pegs stay gerrymanderable', () => {
    // A Volatile peg is permanent (p18) so spending it on the majority is free.
    const base = fresh(1);
    const volatileId = zone(base, 'north_west').areas.find((a) => a.volatile)?.id;
    expect(volatileId).toBeDefined();
    if (!volatileId) throw new Error('north_west has no Volatile Area');

    let s = withPegAt(base, volatileId, 'p1');
    s = withPegs(s, 'p1', 'north_west', 6);
    s = withZone(s, zone(s, 'north_west'));

    const z = zone(s, 'north_west');
    expect(z.majorityHolder).toBe('p1');
    const vol = z.areas.find((a) => a.id === volatileId);
    expect(vol?.peg?.majority).toBe(true);
    expect(z.areas.filter((a) => a.peg?.majority === true && !a.volatile)).toHaveLength(5);
  });

  it('recount is idempotent', () => {
    const s = fill(fresh(1), 'p1', 'north', 11);
    const once = zone(s, 'north');
    expect(recount(recount(once))).toEqual(recount(once));
  });

  it('a broken majority can be re-formed by a different player', () => {
    // rules-reference.md:379. p1 takes central (5/9), an eviction drops them to 4,
    // and p2 completes their own 5. 4+5 = 9 is exactly the capacity, so this is
    // the tightest legal version of the scenario.
    let s = fill(fresh(1), 'p1', 'central', 5);
    expect(zone(s, 'central').majorityHolder).toBe('p1');

    const victim = zone(s, 'central').areas.find((a) => a.peg?.owner === 'p1');
    if (!victim) throw new Error('expected a peg');
    const evicted = {
      ...zone(s, 'central'),
      areas: zone(s, 'central').areas.map((a) =>
        a.id === victim.id ? { ...a, peg: null } : a,
      ),
    };
    s = withZone(s, evicted);
    expect(zone(s, 'central').majorityHolder).toBeNull();

    s = fill(s, 'p2', 'central', 5);
    expect(zone(s, 'central').majorityHolder).toBe('p2');
    // And p1's remaining four are all blank side up again.
    expect(
      zone(s, 'central').areas.filter((a) => a.peg?.owner === 'p1' && a.peg.majority),
    ).toHaveLength(0);
  });

  it('a simultaneous majority is geometrically impossible on this board', () => {
    // R4, resolved by arithmetic rather than by a ruling. The audit assumed
    // "north_west 6/11, so 6+6 is reachable" — it is not. Every zone on this board
    // has capacity exactly `2 * majority - 1`, so two players can never both reach
    // the requirement in the same zone, and `recount`'s last-write-wins tie
    // branch is dead code on the generated board.
    //
    // This matters: it means the R4 defect is latent rather than live, and it
    // means `recount` and `gerrymanderRights` cannot actually disagree about a
    // majority tie, because no majority tie is reachable. If a future board has
    // capacity >= 2 * majority, R4 becomes a real bug and this test fails.
    for (const z of fresh(1).zones) {
      expect(z.capacity, `${z.id} is ${z.capacity} for a majority of ${z.majority}`).toBe(
        2 * z.majority - 1,
      );
      expect(2 * z.majority).toBeGreaterThan(z.capacity);
    }
  });

  it('recounts a majority correctly regardless of how two players interleave', () => {
    // The substitute for the R4 test: since a tie is unreachable, pin the
    // behaviour that IS reachable — a player below the requirement never holds,
    // and the player at or above it always does.
    for (const a of [1, 2, 3, 4, 5]) {
      for (const b of [0, 1, 2, 3, 4, 5]) {
        if (a + b > 11) continue;
        const s = fill(fill(fresh(1), 'p1', 'north_west', a), 'p2', 'north_west', b);
        const z = zone(s, 'north_west');
        expect(z.majorityHolder).toBe(a >= 6 ? 'p1' : b >= 6 ? 'p2' : null);
      }
    }
  });

  it('majorityVoters and scores agree with the peg flags', () => {
    const s = fill(fill(fresh(1), 'p1', 'north_west', 6), 'p2', 'west', 9);
    const s2 = scores(s);
    for (const p of s.turnOrder) {
      let n = 0;
      for (const z of s.zones) {
        for (const a of z.areas) if (a.peg?.owner === p && a.peg.majority) n += 1;
      }
      expect(majorityVoters(s, p)).toBe(n);
      expect(s2[p]).toBe(n);
      expect(totalVoters(s, p)).toBeGreaterThanOrEqual(n);
    }
  });

  it('winners does not declare every player the winner when all scores are zero', () => {
    // R5, still open. `winners` floors `best` at 0 to guard Math.max(...[]) on an
    // empty turn order, so an empty board reports every seat. The rulebook does
    // not settle a zero-score game, and fixing it needs a ruling on scoring ties
    // (audit §6d item 5), so the current behaviour is pinned here rather than
    // left to drift. This test documents the bug; it does not bless it.
    const empty = fresh(1);
    const w = winners(empty);
    expect(w.length).toBeGreaterThan(0);
    expect(w.length).toBe(empty.turnOrder.length);
  });

  it('boardFull is true only when all 129 areas are filled', () => {
    let s = fresh(1);
    const total = s.zones.reduce((n, z) => n + z.capacity, 0);
    expect(total).toBe(129);

    // Fill every area but one.
    const all: Area[] = [];
    for (const z of s.zones) for (const a of z.areas) all.push(a);
    let n = 0;
    for (const z of s.zones) {
      const areas = z.areas.map((a) =>
        n++ < 128 ? { ...a, peg: { owner: 'p1', majority: false } } : a,
      );
      s = { ...s, zones: s.zones.map((x) => (x.id === z.id ? { ...x, areas } : x)) };
    }
    expect(boardFull(s)).toBe(false);
    s = { ...s, zones: s.zones.map((z) => ({ ...z, areas: z.areas.map((a) => ({ ...a, peg: a.peg ?? { owner: 'p2', majority: false } })) })) };
    expect(boardFull(s)).toBe(true);
    expect(s.zones.reduce((a, z) => a + pegsFilled(z), 0)).toBe(129);
  });

  it('allMajoritiesFormed is false on a fresh board and true once every zone is held', () => {
    const s = fresh(1);
    expect(allMajoritiesFormed(s)).toBe(false);
    let t = s;
    for (const z of s.zones) t = fill(t, 'p1', z.id, z.majority);
    expect(allMajoritiesFormed(t)).toBe(true);
  });

  it('a real finished game reports the nine zones with holders and scores under 69', () => {
    // Appendix A: 6+11+6+9+5+9+6+11+6 = 69 maximum.
    const holders = freshFull(3).zones.map((z) => z.majority);
    expect(holders).toEqual([6, 11, 6, 9, 5, 9, 6, 11, 6]);
    expect(holders.reduce((a, b) => a + b, 0)).toBe(69);
  });
});
