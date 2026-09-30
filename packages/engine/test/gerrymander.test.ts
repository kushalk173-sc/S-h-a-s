/**
 * §3.4 GERRYMANDER RIGHTS AND TIES — state.ts:306-325, reduce.ts GERRYMANDER,
 * rules-reference.md:249-261.
 */

import { describe, expect, it } from 'vitest';

import type { Action } from '../src/actions';
import { gerrymanderRights } from '../src/state';
import { reduce, type Ctx } from '../src/reduce';
import type { GameState, PlayerID, ZoneID } from '../src/state';
import { answered, areaOf, plainFreeIn, setAreaState, withPegs } from './boardkit';
import { fresh, makeCtx } from './helpers';

const ctx: Ctx = makeCtx();

/** `reduce` that throws on failure — for multi-step setup sequences. */
function step(s: GameState, p: PlayerID, a: Action): GameState {
  const r = reduce(s, p, a, ctx);
  if (!r.ok) throw new Error(`${p} ${JSON.stringify(a)} -> ${r.error}`);
  return r.state;
}

function gerry(s: GameState, p: PlayerID, zoneId: ZoneID, from: string, to: string) {
  return reduce(s, p, { type: 'GERRYMANDER', zoneId, fromAreaId: from, toAreaId: to }, ctx);
}

/** p1's pegs in `zoneId`, as area ids, in board order. */
function pegsOf(s: GameState, p: PlayerID, zoneId: ZoneID): string[] {
  const z = s.zones.find((x) => x.id === zoneId);
  if (!z) throw new Error(`no zone ${zoneId}`);
  return z.areas.filter((a) => a.peg?.owner === p).map((a) => a.id);
}

describe('gerrymanderRights', () => {
  it('goes to the player with strictly the most voters in the zone', () => {
    const s = withPegs(withPegs(fresh(1), 'p1', 'central', 3), 'p2', 'central', 2);
    const z = s.zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    expect(gerrymanderRights(z)).toBe('p1');
  });

  it('a TIE gives NOBODY gerrymander rights', () => {
    // rules-reference.md:258.
    const s = withPegs(withPegs(fresh(1), 'p1', 'central', 3), 'p2', 'central', 3);
    const z = s.zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    expect(gerrymanderRights(z)).toBeNull();

    const acting = answered(s, 'p1');
    const mine = pegsOf(acting, 'p1', 'central');
    const dest = plainFreeIn(acting, 'central', 1)[0];
    if (!mine[0] || !dest) throw new Error('setup');
    const r = gerry(acting, 'p1', 'central', mine[0], dest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('you do not hold Gerrymandering Rights in Central');
  });

  it('a three-way tie also gives nobody rights', () => {
    // The `tied` flag in state.ts is order-sensitive; a 3-way tie must still be null.
    const s = withPegs(
      withPegs(withPegs(fresh(1), 'p1', 'central', 2), 'p2', 'central', 2),
      'p3',
      'central',
      2,
    );
    const z = s.zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    expect(gerrymanderRights(z)).toBeNull();
  });

  it('an empty zone gives nobody rights', () => {
    const z = fresh(1).zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    expect(gerrymanderRights(z)).toBeNull();
  });

  it('ONE voter in an otherwise-empty zone DOES grant rights', () => {
    // rules-reference.md:260 — the guard is `bestN === 0`, not `bestN < 2`.
    const s = withPegs(fresh(1), 'p1', 'central', 1);
    const z = s.zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    expect(gerrymanderRights(z)).toBe('p1');
  });
});

describe('GERRYMANDER scoping', () => {
  it('may not move your only voter out of the zone whose rights you are using', () => {
    let s = withPegs(fresh(1), 'p1', 'central', 1);
    s = answered(s, 'p1');
    const [only] = pegsOf(s, 'p1', 'central');
    const dest = plainFreeIn(s, 'north', 1)[0];
    if (!only || !dest) throw new Error('setup');
    const r = gerry(s, 'p1', 'central', only, dest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('only voter here');
  });

  it('with 2 voters in the rights zone you may move one out', () => {
    let s = withPegs(fresh(1), 'p1', 'central', 2);
    s = answered(s, 'p1');
    const mine = pegsOf(s, 'p1', 'central');
    const dest = plainFreeIn(s, 'north', 1)[0];
    if (!mine[0] || !dest) throw new Error('setup');
    const r = gerry(s, 'p1', 'central', mine[0], dest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pegsOf(r.state, 'p1', 'central')).toHaveLength(1);
    expect(pegsOf(r.state, 'p1', 'north')).toContain(dest);
  });

  it('the allowance is one gerrymander per zone per turn, tracked per zone', () => {
    // rights.ts:59 — one per zone, so two zones means two moves.
    let s = withPegs(fresh(1), 'p1', 'central', 3);
    s = withPegs(s, 'p1', 'north', 3);
    s = answered(s, 'p1');

    const a = pegsOf(s, 'p1', 'central')[0];
    const b = pegsOf(s, 'p1', 'north')[0];
    const d1 = plainFreeIn(s, 'west', 1)[0];
    const d2 = plainFreeIn(s, 'east', 1)[0];
    if (!a || !b || !d1 || !d2) throw new Error('setup');

    const first = gerry(s, 'p1', 'central', a, d1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A second move in the SAME zone is refused.
    const again = pegsOf(first.state, 'p1', 'central')[0];
    if (!again) throw new Error('setup');
    const d3 = plainFreeIn(first.state, 'west', 1)[0];
    if (!d3) throw new Error('setup');
    const second = gerry(first.state, 'p1', 'central', again, d3);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain('already gerrymandered');

    // But the allowance is per zone, so a different zone still has its own.
    const b2 = pegsOf(first.state, 'p1', 'north')[0];
    const d4 = plainFreeIn(first.state, 'east', 1)[0];
    if (!b2 || !d4) throw new Error('setup');
    const other = gerry(first.state, 'p1', 'north', b2, d4);
    expect(other.ok).toBe(true);
  });

  it('the allowance resets for the next player', () => {
    let s = withPegs(fresh(1), 'p1', 'central', 3);
    s = answered(s, 'p1');
    const a = pegsOf(s, 'p1', 'central')[0];
    const d = plainFreeIn(s, 'west', 1)[0];
    if (!a || !d) throw new Error('setup');
    const first = gerry(s, 'p1', 'central', a, d);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Round-robin the turn past the other two seats; NO_POWER_USES is applied to
    // whoever comes in, so p1 must be able to gerrymander again on their turn.
    let t = step(first.state, 'p1', { type: 'END_TURN' });
    t = step(t, 'p2', { type: 'ANSWER', side: 0 });
    t = step(t, 'p2', { type: 'END_TURN' });
    t = step(t, 'p3', { type: 'ANSWER', side: 0 });
    t = step(t, 'p3', { type: 'END_TURN' });
    expect(t.activePlayer).toBe('p1');
    expect(t.phase).toBe('answer');
    // p1 is back at the start of their own turn: answer, and their allowance is
    // fresh because `advanceTurn` writes NO_POWER_USES to the incoming player only.
    t = step(t, 'p1', { type: 'ANSWER', side: 0 });
    expect(t.players.p2?.powerUses.gerrymandered).toEqual({});

    const a2 = pegsOf(t, 'p1', 'central')[0];
    const d2 = plainFreeIn(t, 'west', 1)[0];
    if (!a2 || !d2) throw new Error('setup');
    const again = gerry(t, 'p1', 'central', a2, d2);
    expect(again.ok, again.ok ? '' : again.error).toBe(true);
  });

  it('a move between two zones where you hold NO rights is refused', () => {
    // R6. rules-reference.md:253-254 scopes the right to "into that zone, out of
    // it, or between it and an adjacent zone". A move wholly outside the rights
    // zone is none of the three, and the old code let it through whenever the
    // *source* happened to neighbour the rights zone — then charged the
    // allowance to the rights zone.
    let s = withPegs(fresh(1), 'p1', 'north', 3);
    s = withPegs(s, 'p1', 'central', 1);
    s = answered(s, 'p1');
    // p1's rights are in `north` (3 pegs vs nobody). The move is central -> east.
    // north and central are neighbours, so the old guard passed it; central and
    // east are neighbours too, but neither is the rights zone.
    const from = pegsOf(s, 'p1', 'central')[0];
    const to = plainFreeIn(s, 'east', 1)[0];
    if (!from || !to) throw new Error('setup');
    expect(gerry(s, 'p1', 'north', from, to).ok).toBe(false);
  });

  it('a move into, out of, or within the rights zone is allowed', () => {
    // The three readings of rules-reference.md:253-254, each pinned.
    // (a) out of the rights zone.
    let a = withPegs(fresh(1), 'p1', 'north', 3);
    a = answered(a, 'p1');
    const outFrom = pegsOf(a, 'p1', 'north')[0];
    const outTo = plainFreeIn(a, 'west', 1)[0];
    if (!outFrom || !outTo) throw new Error('setup');
    expect(gerry(a, 'p1', 'north', outFrom, outTo).ok).toBe(true);

    // (b) into the rights zone, from an adjacent zone.
    let b = withPegs(fresh(1), 'p1', 'north', 3);
    b = withPegs(b, 'p1', 'west', 1);
    b = answered(b, 'p1');
    const inFrom = pegsOf(b, 'p1', 'west')[0];
    const inTo = plainFreeIn(b, 'north', 1)[0];
    if (!inFrom || !inTo) throw new Error('setup');
    expect(gerry(b, 'p1', 'north', inFrom, inTo).ok).toBe(true);

    // (c) within the rights zone.
    let c = withPegs(fresh(1), 'p1', 'north', 3);
    c = answered(c, 'p1');
    const mine = pegsOf(c, 'p1', 'north');
    const withinTo = plainFreeIn(c, 'north', 1)[0];
    if (!mine[0] || !withinTo) throw new Error('setup');
    expect(gerry(c, 'p1', 'north', mine[0], withinTo).ok).toBe(true);
  });

  it('a move to a non-adjacent zone is refused', () => {
    let s = withPegs(fresh(1), 'p1', 'north', 3);
    s = answered(s, 'p1');
    const from = pegsOf(s, 'p1', 'north')[0];
    const to = plainFreeIn(s, 'south', 1)[0];
    if (!from || !to) throw new Error('setup');
    const r = gerry(s, 'p1', 'north', from, to);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('zones are not adjacent');
  });

  it('may gerrymander an OPPONENTs voter', () => {
    // rules-reference.md:256.
    let s = withPegs(fresh(1), 'p1', 'north', 3);
    s = withPegs(s, 'p2', 'north', 1);
    s = answered(s, 'p1');
    const theirs = pegsOf(s, 'p2', 'north')[0];
    const dest = plainFreeIn(s, 'west', 1)[0];
    if (!theirs || !dest) throw new Error('setup');
    const r = gerry(s, 'p1', 'north', theirs, dest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(areaOf(r.state, dest).peg?.owner).toBe('p2');
    expect(pegsOf(r.state, 'p2', 'north')).not.toContain(theirs);
  });

  it('refuses a majority voter without a power', () => {
    // rules-reference.md:255, 226-227.
    let s = withPegs(fresh(1), 'p1', 'north', 11);
    s = withPegs(s, 'p1', 'north_west', 3);
    s = answered(s, 'p1');
    const z = s.zones.find((x) => x.id === 'north');
    if (!z) throw new Error('no north');
    const majorityPeg = z.areas.find((a) => a.peg?.majority === true)?.id;
    if (!majorityPeg) throw new Error('expected a majority peg');
    const dest = plainFreeIn(s, 'west', 1)[0];
    if (!dest) throw new Error('setup');
    const r = gerry(s, 'p1', 'north', majorityPeg, dest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('majority voters cannot be gerrymandered');
  });

  it('allows a majority voter with Election Fever (5 Showstopper)', () => {
    let s = withPegs(fresh(1), 'p1', 'north', 11);
    s = withPegs(s, 'p1', 'north_west', 3);
    s = answered(s, 'p1', { manifesto: 5 });
    // `answered` writes 5 Capitalists; swap them for Showstoppers.
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, manifesto: Array(5).fill('showstopper') },
      },
    };
    const z = s.zones.find((x) => x.id === 'north');
    if (!z) throw new Error('no north');
    const majorityPeg = z.areas.find((a) => a.peg?.majority === true)?.id;
    const dest = plainFreeIn(s, 'west', 1)[0];
    if (!majorityPeg || !dest) throw new Error('setup');
    const r = gerry(s, 'p1', 'north', majorityPeg, dest);
    expect(r.ok).toBe(true);
  });

  it('Election Fever raises the allowance to 2 per zone', () => {
    let s = withPegs(fresh(1), 'p1', 'north', 5);
    s = answered(s, 'p1', { manifesto: 5 });
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, manifesto: Array(5).fill('showstopper') },
      },
    };
    let t = s;
    for (let i = 0; i < 2; i++) {
      const from = pegsOf(t, 'p1', 'north')[0];
      const dest = plainFreeIn(t, 'west', 1)[0];
      if (!from || !dest) throw new Error('setup');
      const r = gerry(t, 'p1', 'north', from, dest);
      expect(r.ok, `move ${i + 1}`).toBe(true);
      if (!r.ok) return;
      t = r.state;
    }
    const from = pegsOf(t, 'p1', 'north')[0];
    const dest = plainFreeIn(t, 'west', 1)[0];
    if (!from || !dest) throw new Error('setup');
    const third = gerry(t, 'p1', 'north', from, dest);
    expect(third.ok).toBe(false);
  });

  it('a Volatile Area voter can never be gerrymandered, even with Election Fever', () => {
    // rules-reference.md:259. Kept adjacent to the majority-voter test so the two
    // refusals are visibly distinct: one is about the peg's *status*, the other
    // about where it *sits*.
    const base = fresh(1);
    const z = base.zones.find((x) => x.id === 'north');
    if (!z) throw new Error('no north');
    const vol = z.areas.find((a) => a.volatile);
    if (!vol) throw new Error('north has no Volatile Area');

    let s = withPegs(fresh(1), 'p1', 'north', 3);
    s = answered(s, 'p1', { manifesto: 5 });
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, manifesto: Array(5).fill('showstopper') },
      },
    };
    s = setAreaState(s, vol.id, { owner: 'p1', majority: false });
    const dest = plainFreeIn(s, 'west', 1)[0];
    if (!dest) throw new Error('setup');
    const r = gerry(s, 'p1', 'north', vol.id, dest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('voters in a Volatile Area cannot be moved');
  });

  it('a gerrymandered-into Volatile Area queues exactly one Headline', () => {
    // D6, RULED. The rulebook never names gerrymandering as a placement, so this
    // is a ruling and the evidence is the rulebook's own card text plus two
    // structural arguments:
    //
    //  - **A real card treats it as a placement.** SUBMERGED / New Face Who Dis
    //    (one card, printed twice; AUTHENTIC-SHASN-REFERENCE.md:270 and :345) reads
    //    "every player can Gerrymander 1 majority or non-majority voter
    //    immediately. **These voters cannot be placed into Volatile Areas.**" A
    //    gerrymander is legal and unremarkable under the normal rules, so the only
    //    reason a card would need to forbid it is that placing a voter into a cog
    //    brings p18's Volatile Area rule with it. The rulebook's own vocabulary
    //    calls a gerrymandering-into-a-cog a placement.
    //  - **The trigger is keyed to the board event, not the verb.** Quantum
    //    Wristband (:299): "When a voter is placed in a Volatile Area, go through
    //    the Headlines draw pile" — analysed there as *overriding the Headline
    //    trigger*. An override only has a scope if the trigger has one, and p18's
    //    scope is "a voter is placed in a Volatile Area".
    //  - p18 also permits the mover to be anyone: "You may place your own or an
    //    opponent's voter into a Volatile Area" (rules-reference.md:324). The
    //    gerrymandering an *opponent's* voter into a cog is therefore not a new
    //    case at all — it is the same case the placement path already covers.
    //  - The alternative (no Headline) makes identical board positions — a peg in
    //    a cog, visible to everyone at the table — carry different consequences
    //    depending on how the peg got there, which is not information any player
    //    can observe.
    //
    // *** A future ruling for "no Headline" changes exactly ONE assertion here:
    // `expect(r.state.headlineQueue).toEqual([...])` becomes
    // `expect(r.state.headlineQueue).toEqual([])`. Everything else in this test,
    // including the `volatile` event and the permanence of the peg, is
    // independent of the ruling. ***
    let s = withPegs(fresh(1), 'p1', 'north', 3);
    s = answered(s, 'p1');
    const from = pegsOf(s, 'p1', 'north')[0];
    const northVol = s.zones.find((z) => z.id === 'north')?.areas.find((a) => a.volatile && a.peg === null);
    if (!from || !northVol) throw new Error('setup');
    // Move within north, into the Volatile Area.
    const r = gerry(s, 'p1', 'north', from, northVol.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.headlineQueue).toEqual([{ areaId: northVol.id, by: 'p1' }]);
    // The peg lands, and p18's permanence applies to it immediately — a peg in a
    // Volatile Area can never be gerrymandered, converted, evicted or discarded.
    expect(areaOf(r.state, northVol.id).peg?.owner).toBe('p1');
    expect(areaOf(r.state, northVol.id).volatile).toBe(true);
    expect(r.state.players.p1?.powerUses.gerrymandered).toEqual({ north: 1 });
  });

  it('the Headline from a gerrymanded-into Volatile Area belongs to the mover, not the voter\'s owner', () => {
    // Same ruling (see above), on the case p18 explicitly contemplates: the voter
    // moved in belongs to an opponent. The obligation attaches to the *act* —
    // "placing a voter in a Volatile Area triggers a Headline", in whose turn it
    // happened — so it queues against the gerrymandering player and resolves in
    // their post-turn window, and it does not appear as an obligation on the owner.
    let s = withPegs(fresh(1), 'p1', 'north', 3);
    s = withPegs(s, 'p2', 'north', 2);
    s = answered(s, 'p1');
    const from = pegsOf(s, 'p2', 'north')[0];
    const northVol = s.zones.find((z) => z.id === 'north')?.areas.find((a) => a.volatile && a.peg === null);
    if (!from || !northVol) throw new Error('setup');
    const r = gerry(s, 'p1', 'north', from, northVol.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(areaOf(r.state, northVol.id).peg?.owner).toBe('p2');
    expect(r.state.headlineQueue).toEqual([{ areaId: northVol.id, by: 'p1' }]);

    // It resolves at the end of p1's turn, like any other volatile placement, and
    // p2 is not made to wait for it.
    const ended = step(r.state, 'p1', { type: 'END_TURN' });
    expect(ended.phase).toBe('headlines');
    expect(ended.activeHeadline).not.toBeNull();
  });

  it('rights gained mid-turn are usable the same turn', () => {
    // rules-reference.md:257. Form a majority during your own turn via a real
    // PLACE_VOTERS, then gerrymander in that zone before END_TURN.
    let s = answered(fresh(1), 'p1', { manifesto: 0 });
    // Give p1 six voters to place. Six, not five: central needs a majority of 5, so
    // a sixth peg is the only one left blank side up and therefore the only one a
    // non-Election-Fever gerrymander is allowed to move.
    s = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1!,
          pending: [{ id: 'g1', count: 6, sameZone: true, source: 'test' }],
        },
      },
    };
    const z = s.zones.find((x) => x.id === 'central');
    if (!z) throw new Error('no central');
    const free = z.areas.filter((a) => a.peg === null).slice(0, 6).map((a) => a.id);
    const placed = reduce(
      s,
      'p1',
      { type: 'PLACE_VOTERS', groupId: 'g1', areaIds: free },
      ctx,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const held = placed.state.zones.find((x) => x.id === 'central');
    expect(held?.majorityHolder).toBe('p1');
    expect(held?.areas.filter((a) => a.peg?.owner === 'p1' && a.peg.majority)).toHaveLength(5);

    const movable = held?.areas.find((a) => a.peg?.owner === 'p1' && a.peg.majority === false)?.id;
    const dest = held?.areas.find((a) => a.peg === null)?.id;
    if (!movable || !dest) throw new Error('setup');
    const g = gerry(placed.state, 'p1', 'central', movable, dest);
    expect(g.ok).toBe(true);
  });

  it('refuses when the action is not a legal move at all', () => {
    const s = answered(fresh(1), 'p1');
    const noRights: Action = { type: 'GERRYMANDER', zoneId: 'central', fromAreaId: 'central-01', toAreaId: 'central-02' };
    const r = reduce(s, 'p1', noRights, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Gerrymandering Rights');
  });
});
