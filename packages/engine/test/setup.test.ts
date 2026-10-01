/**
 * §3.9 `setup()` — the thing the whole suite is built on.
 *
 * The previous `setup.ts` was written against a pre-refactor `GameState` and was
 * wrong in nine ways, only five of which the compiler could see. These tests pin
 * the *silent* four: the turn-1 soft-lock, the empty HQ Mat, the missing `round`,
 * and the missing seed/head start.
 */

import { describe, expect, it } from 'vitest';

import { freshZones } from '../src/board';
import { PLAYER_COLOURS, RULES } from '../src/rules';
import { setup } from '../src/setup';
import { NO_POWER_USES, pegsFilled, poolTotal, type Delta, type GameState } from '../src/state';
import { allKeys, playerView } from '../src/playerView';
import {
  CARDS,
  CONSPIRACY_DECK,
  HEADLINE_DECK,
  IDEOLOGY_DECK,
  PLAYERS_3,
  VOTER_DECK,
  seats,
} from './helpers';

function at(players: readonly string[]) {
  return {
    players,
    cards: CARDS,
    seed: 1,
    ideologyDeck: IDEOLOGY_DECK,
    voterDeck: VOTER_DECK,
    conspiracyDeck: CONSPIRACY_DECK,
    headlineDeck: HEADLINE_DECK,
  };
}

describe('seat-count guards', () => {
  it('rejects fewer than 2 players', () => {
    expect(() => setup(at(['p1']))).toThrow('Shasn needs at least 2 players');
    expect(() => setup(at([]))).toThrow('Shasn needs at least 2 players');
  });

  it('rejects more than 5 players', () => {
    expect(() => setup(at(seats(6)))).toThrow('Shasn supports at most 5 players');
  });

  it('rejects duplicate seats', () => {
    expect(() => setup(at(['p1', 'p1']))).toThrow('distinct');
  });
});

describe('the board', () => {
  it('builds 9 zones totalling 129 areas and 11 volatile', () => {
    // Cross-checked against scripts/gen-board.mjs:229-230, which asserts the same.
    const s = setup(at(PLAYERS_3));
    expect(s.zones).toHaveLength(9);
    expect(s.zones.reduce((n, z) => n + z.capacity, 0)).toBe(129);
    expect(s.zones.reduce((n, z) => n + z.areas.length, 0)).toBe(129);
    expect(s.zones.reduce((n, z) => n + z.areas.filter((a) => a.volatile).length, 0)).toBe(11);
    // W and E hold 2 each; the other seven hold 1 each. rules-reference.md:380.
    const perZone = Object.fromEntries(s.zones.map((z) => [z.id, z.areas.filter((a) => a.volatile).length]));
    expect(perZone).toEqual({
      north_west: 1,
      north: 1,
      north_east: 1,
      west: 2,
      central: 1,
      east: 2,
      south_west: 1,
      south: 1,
      south_east: 1,
    });
  });

  it('every zone carries its own majority/capacity from the generated board', () => {
    const s = setup(at(PLAYERS_3));
    const map = Object.fromEntries(s.zones.map((z) => [z.id, `${z.majority}/${z.capacity}`]));
    expect(map).toEqual({
      north_west: '6/11',
      north: '11/21',
      north_east: '6/11',
      west: '9/17',
      central: '5/9',
      east: '9/17',
      south_west: '6/11',
      south: '11/21',
      south_east: '6/11',
    });
  });

  it('starts with every area empty and every majorityHolder null', () => {
    const s = setup(at(PLAYERS_3));
    for (const z of s.zones) {
      expect(pegsFilled(z)).toBe(0);
      expect(z.majorityHolder).toBeNull();
      expect(z.areas.every((a) => a.peg === null)).toBe(true);
    }
  });

  it('does not share mutable state between boards', () => {
    // freshZones() rebuilds from BOARD every call. If anyone ever caches the
    // generated spec and hands out the same Area objects, pegs from one game
    // would appear in another.
    const a = setup(at(PLAYERS_3));
    const b = setup(at(PLAYERS_3));
    expect(a.zones[0]?.areas[0]).not.toBe(b.zones[0]?.areas[0]);
    expect(freshZones()[0]?.areas[0]).not.toBe(freshZones()[0]?.areas[0]);
  });
});

describe('seats', () => {
  it('for n in 2..5: n players, turnOrder is the input order, activePlayer is the first', () => {
    for (let n = 2; n <= 5; n++) {
      const players = seats(n);
      const s = setup(at(players));
      expect(Object.keys(s.players)).toHaveLength(n);
      expect(s.turnOrder).toEqual(players);
      expect(s.activePlayer).toBe(players[0]);
      expect(s.round).toBe(1);
      expect(s.turn).toBe(1);
      expect(s.finished).toBe(false);
      expect(s.phase).toBe('answer');
    }
  });

  it('for n in 2..5: players get distinct colours from PLAYER_COLOURS', () => {
    expect(PLAYER_COLOURS.length).toBeGreaterThanOrEqual(5);
    for (let n = 2; n <= 5; n++) {
      const s = setup(at(seats(n)));
      const colours = s.turnOrder.map((p) => s.players[p]?.colour ?? '');
      expect(new Set(colours).size).toBe(n);
      for (const c of colours) expect(PLAYER_COLOURS).toContain(c);
    }
  });

  it('for n in 2..5: every player starts with a FULL Pool, not a partial one', () => {
    // state.ts:72 "Never partial" — a partial `{}` silently breaks `poolTotal` and
    // `canAfford`, neither of which guards for missing keys. All four keys must be
    // present on every seat whatever the staggered start hands out.
    for (let n = 2; n <= 5; n++) {
      const s = setup(at(seats(n)));
      for (const p of s.turnOrder) {
        expect(s.players[p]?.resources).toEqual({
          funds: expect.any(Number),
          clout: expect.any(Number),
          media: expect.any(Number),
          trust: expect.any(Number),
        });
      }
    }
  });

  it('for n in 2..5: the start reaches the cap only as a full Pool of one type', () => {
    // The companion invariant to the one above: p7's grant is a *count*, so the
    // other three pools must stay exactly 0 rather than picking up a stray value.
    for (let n = 2; n <= 5; n++) {
      const s = setup(at(seats(n)));
      s.turnOrder.forEach((p, i) => {
        expect(s.players[p]?.resources).toEqual({ funds: i + 1, clout: 0, media: 0, trust: 0 });
      });
    }
  });

  it('for n in 2..5: empty manifesto, manifestoCards, conspiracies, pending, and NO_POWER_USES', () => {
    for (let n = 2; n <= 5; n++) {
      const s = setup(at(seats(n)));
      for (const p of s.turnOrder) {
        const pl = s.players[p];
        expect(pl?.manifesto).toEqual([]);
        expect(pl?.manifestoCards).toEqual([]);
        expect(pl?.conspiracies).toEqual([]);
        expect(pl?.pending).toEqual([]);
        expect(pl?.powerUses).toEqual(NO_POWER_USES);
        expect(pl?.isBot).toBe(false);
      }
    }
  });

  it('uses the supplied names, and sensible defaults otherwise', () => {
    const s = setup({ ...at(PLAYERS_3), names: { p2: 'Ada' } });
    expect(s.players.p1?.name).toBe('Player 1');
    expect(s.players.p2?.name).toBe('Ada');
    expect(s.players.p3?.name).toBe('Player 3');
  });
});

describe('the staggered start', () => {
  it('gives player n exactly n resources when startResources says so', () => {
    // rules-reference.md:92-93: "Player n receives n resources of their choice."
    // The CHOICE is the player's, so `setup` takes it as an input rather than
    // inventing a split — see the design note in setup.ts.
    expect(RULES.staggeredStart).toBe(true);
    const start: readonly Delta[] = [
      { funds: 1 },
      { funds: 1, clout: 1 },
      { trust: 1, media: 1, funds: 1 },
    ];
    const s = setup({ ...at(PLAYERS_3), startResources: start });
    expect(s.players.p1?.resources.funds).toBe(1);
    expect(s.players.p2?.resources.funds).toBe(1);
    expect(s.players.p2?.resources.clout).toBe(1);
    expect(s.players.p3?.resources.trust).toBe(1);
    expect(s.players.p3?.resources.media).toBe(1);
    expect(s.players.p3?.resources.funds).toBe(1);
  });

  it('a seat with no entry in a SUPPLIED array starts empty, not partially filled', () => {
    // The `startResources` contract is two-sided: omitted => p7 applies, supplied =>
    // the caller is authoritative for every seat. Once a caller has spoken, a
    // missing entry means "nothing for that seat", NOT "fall back to i+1" — a
    // half-filled array that silently topped the rest up would be worse than
    // either reading.
    const s = setup({ ...at(PLAYERS_3), startResources: [{ funds: 1 }] });
    expect(s.players.p1?.resources).toEqual({ funds: 1, clout: 0, media: 0, trust: 0 });
    expect(s.players.p2?.resources).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
    expect(s.players.p3?.resources).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
  });

  // ─────────────── the omitted-array default, RULED 2026-10-01 ───────────────
  //
  // `RULES.staggeredStart` is `true` and p7 (rules-reference.md:111-112) says
  // player n receives n resources. Before this ruling `setup` read a missing
  // `startResources` as `[]`, so the rule was declared in rules.ts, spec'd in the
  // rulebook transcription, documented in UI-SPEC, and NEVER APPLIED: every seat
  // sat on 0/0/0/0 at every seat count. Real 5-player browser playtest, 2026-10-01.
  //
  // A declared-but-unapplied rule is not a neutral default. "Nobody starts with
  // anything" is itself a rule, and an undeclared one — it hands Player 5 a worse
  // position than Player 1 in a game whose first-turn economy is one Voter Card
  // wide, and it is what manufactures the empty-handed players that reach a
  // client's dead `gain-any` dialog with nothing to add from.

  it('RULED: omitting startResources gives seat n exactly n resources, 2 seats', () => {
    expect(RULES.staggeredStart).toBe(true);
    const s = setup(at(seats(2)));
    expect(s.players.p1?.resources.funds).toBe(1);
    expect(s.players.p2?.resources.funds).toBe(2);
    expect(poolTotal(s.players.p1!.resources) + poolTotal(s.players.p2!.resources)).toBe(3);
  });

  it('RULED: omitting startResources gives seat n exactly n resources, 3 seats', () => {
    const s = setup(at(seats(3)));
    expect(s.turnOrder.map((p) => s.players[p]?.resources.funds)).toEqual([1, 2, 3]);
    expect(poolTotal(s.players.p1!.resources) + poolTotal(s.players.p2!.resources) +
      poolTotal(s.players.p3!.resources)).toBe(6);
  });

  it('RULED: omitting startResources gives seat n exactly n resources, 4 seats', () => {
    const s = setup(at(seats(4)));
    expect(s.turnOrder.map((p) => s.players[p]?.resources.funds)).toEqual([1, 2, 3, 4]);
    expect(poolTotal(s.players.p1!.resources) + poolTotal(s.players.p2!.resources) +
      poolTotal(s.players.p3!.resources) + poolTotal(s.players.p4!.resources)).toBe(10);
  });

  it('RULED: omitting startResources gives seat n exactly n resources, 5 seats', () => {
    const s = setup(at(seats(5)));
    expect(s.turnOrder.map((p) => s.players[p]?.resources.funds)).toEqual([1, 2, 3, 4, 5]);
    expect(poolTotal(s.players.p1!.resources) + poolTotal(s.players.p2!.resources) +
      poolTotal(s.players.p3!.resources) + poolTotal(s.players.p4!.resources) +
      poolTotal(s.players.p5!.resources)).toBe(15);
  });

  it('RULED: the grant is seat-1-relative, so a 2-player game still opens 1 vs 2', () => {
    // p7 counts from Player 1, not from the seat count. A 2-player game hands out
    // 1 and 2, not 0 and 1 — a "fair 1 each" reading would hand the last seat of a
    // 5-player game more than the first, which is the opposite of the designer's
    // note ("offsets first-player advantage", rules-reference.md:113).
    const two = setup(at(seats(2)));
    expect(poolTotal(two.players.p1!.resources)).toBe(1);
    expect(poolTotal(two.players.p2!.resources)).toBe(2);
  });

  it('RULED: the default never pushes a seat over the resource cap', () => {
    // The largest default is seat 5's 5, and the cap is 12 — so no seat opens over
    // cap, which matters because an over-cap seat must open with a `lose-any`
    // decision (p12) and that is a choice the player never made.
    for (let n = 2; n <= 5; n++) {
      const s = setup(at(seats(n)));
      for (const p of s.turnOrder) {
        expect(poolTotal(s.players[p]!.resources)).toBeLessThanOrEqual(RULES.resourceCap);
      }
    }
  });

  it('RULED: a supplied array overrides the default entirely, wrong totals included', () => {
    // The engine does not validate that a supplied total equals n, because the
    // Delta IS the player's choice (p7: "of their choice") and the replay path in
    // `store.ts` rebuilds a match from its log without anyone to ask. The grant is
    // a default, not an invariant.
    const s = setup({ ...at(PLAYERS_3), startResources: [{ funds: 8 }, { funds: 6, clout: 2 }, { funds: 5, media: 3 }] });
    expect(s.players.p1?.resources).toEqual({ funds: 8, clout: 0, media: 0, trust: 0 });
    expect(s.players.p2?.resources).toEqual({ funds: 6, clout: 2, media: 0, trust: 0 });
    expect(s.players.p3?.resources).toEqual({ funds: 5, clout: 0, media: 3, trust: 0 });
  });

  it('RULED: with staggeredStart off, omitting startResources really does mean zero', () => {
    // The default is driven by the rule, not hardcoded — so a house-rules table
    // that switches the toggle off gets a genuinely empty-handed start, which is
    // the old behaviour and remains reachable.
    const off = { ...RULES, staggeredStart: false };
    const s = setup({ ...at(seats(5)), rules: off });
    for (const p of s.turnOrder) {
      expect(s.players[p]?.resources).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
    }
  });
});

describe('determinism', () => {
  it('the setup shuffle is seeded, not random', () => {
    const a = setup(at(PLAYERS_3));
    const b = setup(at(PLAYERS_3));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('two setup() calls with different seeds produce different deck orders', () => {
    // Guards against the seed being threaded but unused.
    const a = setup({ ...at(PLAYERS_3), seed: 1 });
    const b = setup({ ...at(PLAYERS_3), seed: 2 });
    expect(JSON.stringify(a._ideologyDraw)).not.toBe(JSON.stringify(b._ideologyDraw));
  });

  it('_seed is an integer and advances through the four deck shuffles', () => {
    const s = setup(at(PLAYERS_3));
    expect(Number.isInteger(s._seed)).toBe(true);
    expect(s._seed).not.toBe(1);
  });

  it('_idSeq starts at zero so ids are reproducible from the opening position', () => {
    const s = setup(at(PLAYERS_3));
    expect(s._idSeq).toBe(0);
  });
});

describe('the opening position', () => {
  it('the first players Ideology Card is already drawn and hidden', () => {
    // THE test that catches the turn-1 soft-lock. `advanceTurn` draws at turn
    // advance, so an opening state with no pending card leaves no legal move:
    // ANSWER says "no card has been put to you" and END_TURN says "answer your
    // Ideology Card first".
    const s = setup(at(PLAYERS_3));
    expect(s.phase).toBe('answer');
    expect(s._pendingCard).not.toBeNull();
    const id = s._pendingCard ?? '';
    // The audit asked for the id to be in `_ideologyDraw ∪ _ideologyDiscard`. That
    // assumption is wrong for a card that has been *dealt to a player*: `setup`
    // takes it off the top of the pile, so it is in neither. The real invariant is
    // the stronger and more useful one — it came from the deck, and the pile is one
    // shorter than the deck.
    expect(IDEOLOGY_DECK).toContain(id);
    expect(s._ideologyDraw).not.toContain(id);
    expect(s._ideologyDiscard).not.toContain(id);
    expect(s._ideologyDraw).toHaveLength(IDEOLOGY_DECK.length - 1);
  });

  it('the market starts with exactly 3 face-up Voter Cards', () => {
    // rules-reference.md:161-162. The old `setup` never populated `market`, and
    // `refillMarket` is only reachable from INFLUENCE, so the Mat stayed empty for
    // the whole game.
    const s = setup(at(PLAYERS_3));
    expect(s.market).toHaveLength(RULES.marketSize);
    expect(new Set(s.market.map((m) => m.cardId)).size).toBe(RULES.marketSize);
    for (const slot of s.market) {
      const card = CARDS.voter[slot.cardId];
      expect(card).toBeDefined();
      expect(slot.cost).toEqual(card?.cost);
      expect(slot.voters).toBe(card?.voters);
    }
    // The open cards came off the draw pile.
    expect(s._voterDraw).toHaveLength(VOTER_DECK.length - RULES.marketSize);
  });

  it('dealMarket: false starts with an empty Mat', () => {
    const s = setup({ ...at(PLAYERS_3), dealMarket: false });
    expect(s.market).toEqual([]);
    expect(s._voterDraw).toHaveLength(VOTER_DECK.length);
  });

  it('all four draw piles and all four discard piles are initialised as arrays', () => {
    const s = setup(at(PLAYERS_3));
    for (const key of [
      '_ideologyDraw',
      '_ideologyDiscard',
      '_voterDraw',
      '_voterDiscard',
      '_conspiracyDraw',
      '_conspiracyDiscard',
      '_headlineDraw',
      '_headlineDiscard',
    ] as const) {
      expect(Array.isArray(s[key]), key).toBe(true);
    }
    expect(s._ideologyDiscard).toEqual([]);
    expect(s._voterDiscard).toEqual([]);
    expect(s._conspiracyDiscard).toEqual([]);
    expect(s._headlineDiscard).toEqual([]);
  });

  it('publishes the Conspiracy cost but not the identity', () => {
    // state.ts:227-228 — the cost is printed on the card's back, so the number is
    // public even though the card is not.
    const s = setup(at(PLAYERS_3));
    const top = s._conspiracyDraw[0];
    expect(top).toBeDefined();
    if (!top) throw new Error('setup');
    expect(s.conspiracyTopCost).toBe(CARDS.conspiracy[top]?.cost);
    expect(s.conspiracyRemaining).toBe(s._conspiracyDraw.length);
  });

  it('starts with no open state: empty queue, no headline, no choices, no log', () => {
    const s = setup(at(PLAYERS_3));
    expect(s.headlineQueue).toEqual([]);
    expect(s.activeHeadline).toBeNull();
    expect(s.choices).toEqual([]);
    expect(s.log).toEqual([]);
    expect(s.finalRoundFrom).toBeNull();
  });

  it('the opening position passes playerView for n in 2..5, for every viewer', () => {
    // The end-to-end version of the leak test: a fresh game must not ship a `_` key.
    for (let n = 2; n <= 5; n++) {
      const players = seats(n);
      const s: GameState = setup(at(players));
      for (const v of players) {
        const leaks = allKeys(playerView(s, v)).filter((k) => k.startsWith('_'));
        expect(leaks, `n=${n} viewer=${v}`).toEqual([]);
      }
    }
  });
});

describe('the rules override', () => {
  it('honours a custom Rules object', () => {
    const custom = { ...RULES, marketSize: 1, resourceCap: 5 };
    const s = setup({ ...at(PLAYERS_3), rules: custom });
    expect(s.market).toHaveLength(1);
  });

  it('defaults to RULES', () => {
    const s = setup(at(PLAYERS_3));
    expect(s.market).toHaveLength(RULES.marketSize);
  });
});
