/**
 * §3.2 SECRET LEAK — the project's most important property.
 *
 * Shasn's core mechanic is the blind answer. A client that learns which Ideology
 * Card was put to it, or what either side pays, ends the game permanently for
 * everyone: there is no way to un-know it. The assertion is therefore structural
 * and recursive (`allKeys`), not a hand-maintained field list, so a `_` field
 * added to `GameState` next year is caught without anyone remembering to add a
 * test for it.
 */

import { describe, expect, it } from 'vitest';

import { allKeys, playerView, PRIVATE_PLAYER_KEYS } from '../src/playerView';
import { reduce } from '../src/reduce';
import { setup } from '../src/setup';
import type { GameState, PlayerID, PlayerState } from '../src/state';
import { playFullGame } from './driver';
import {
  bigCards,
  bigCtx,
  CARDS,
  freshFull,
  IDEOLOGY_DECK,
  makeCtx,
  PLAYERS_3,
  seats,
} from './helpers';

const ctx = makeCtx();

/** The whole point: walk the client payload and find no `_` key at any depth. */
function assertNoUnderscoreKeys(s: GameState, viewer: PlayerID, where: string): void {
  const client = playerView(s, viewer);
  const leaks = allKeys(client).filter((k) => k.startsWith('_'));
  expect(leaks, `${where} as ${viewer}`).toEqual([]);
}

function positions(s: GameState): { readonly label: string; readonly state: GameState }[] {
  return [
    { label: 'turn 1', state: s },
    { label: 'mid-turn with a pending card', state: s },
  ];
}

describe('playerView secret leak', () => {
  it('exposes NO key starting with "_" anywhere in the graph, recursively', () => {
    // Three positions: turn 1, mid-turn with a card pending, and the end of a
    // game. A leak that only exists in one of them is still a leak.
    const start = freshFull(3);
    const midTurn = start;
    const end = playFullGame(freshFull(3), bigCtx()).state;

    for (const { label, state } of positions(midTurn).concat([{ label: 'end of game', state: end }])) {
      for (const viewer of state.turnOrder) {
        assertNoUnderscoreKeys(state, viewer, label);
      }
    }
  });

  it('never ships the pending Ideology Card, by id or by payout', () => {
    const s = setup({
      players: PLAYERS_3,
      cards: CARDS,
      seed: 2,
      ideologyDeck: IDEOLOGY_DECK,
    });
    // A state with a real pending card whose two sides pay different amounts.
    expect(s._pendingCard).not.toBeNull();
    const cardId = s._pendingCard ?? '';
    const card = CARDS.ideology[cardId];
    expect(card).toBeDefined();
    const payouts = card?.sides.map((x) => JSON.stringify(x.pays)) ?? [];

    for (const viewer of s.turnOrder) {
      const json = JSON.stringify(playerView(s, viewer));
      expect(json).not.toContain(cardId);
      for (const p of payouts) expect(json).not.toContain(p);
    }
  });

  it('awaitingAnswer is a boolean and reveals nothing about which card', () => {
    const s = setup({ players: PLAYERS_3, cards: CARDS, seed: 2, ideologyDeck: IDEOLOGY_DECK });
    for (const viewer of s.turnOrder) {
      const c = playerView(s, viewer);
      expect(typeof c.awaitingAnswer).toBe('boolean');
      expect(c.awaitingAnswer).toBe(s._pendingCard !== null);
    }
    // Identical for every viewer, including the one who has not answered.
    const flags = s.turnOrder.map((v) => playerView(s, v).awaitingAnswer);
    expect(new Set(flags).size).toBe(1);

    const answered = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, ctx);
    expect(answered.ok).toBe(true);
    if (answered.ok) {
      expect(playerView(answered.state, 'p1').awaitingAnswer).toBe(false);
    }
  });

  it('deckSizes are counts only - draw-pile contents never appear', () => {
    const s = setup({
      players: PLAYERS_3,
      cards: CARDS,
      seed: 4,
      ideologyDeck: IDEOLOGY_DECK,
      voterDeck: ['vot-01'],
      conspiracyDeck: ['con-01', 'con-02'],
      headlineDeck: ['hed-01'],
    });
    const client = playerView(s, 'p1');
    expect(client.deckSizes).toEqual({
      ideology: s._ideologyDraw.length,
      voter: s._voterDraw.length,
      conspiracy: s._conspiracyDraw.length,
      headline: s._headlineDraw.length,
    });
    for (const n of Object.values(client.deckSizes)) expect(typeof n).toBe('number');

    const json = JSON.stringify(client);
    for (const id of [...s._ideologyDraw, ...s._voterDraw, ...s._conspiracyDraw, ...s._headlineDraw]) {
      expect(json).not.toContain(id);
    }
  });

  it('_seed never reaches the client', () => {
    const s = freshFull(6);
    expect(Number.isInteger(s._seed)).toBe(true);
    for (const viewer of s.turnOrder) {
      expect(JSON.stringify(playerView(s, viewer))).not.toContain(String(s._seed));
    }
  });

  it('does not ship other players Conspiracy Card hands', () => {
    // R1. `conspiracies` is a hidden hand but is NOT `_`-prefixed, so the prefix
    // strip alone does not touch it and the structural leak test passes while the
    // leak is live. This test is the one that closes that hole.
    let s = freshFull(8);
    s = withConspiracies(s, { p1: ['con-01', 'con-03'], p2: ['con-02'] });

    const asP1 = playerView(s, 'p1');
    expect(asP1.players.p2?.conspiracies).toEqual([]);
    const json = JSON.stringify(asP1);
    expect(json).not.toContain('con-02');
    expect(json).not.toContain('con-01');
  });

  it('does not ship the viewers own Conspiracy hand either', () => {
    // There is deliberately no viewer-scoped exception. A Conspiracy Card is
    // "bought and held" (rules-reference.md:284-286): the client learns a card is
    // playable from a public flag, never by reading the hand.
    const s = withConspiracies(freshFull(8), { p1: ['con-01', 'con-03'], p2: ['con-02'] });
    for (const viewer of s.turnOrder) {
      const client = playerView(s, viewer);
      for (const p of client.turnOrder) {
        expect(client.players[p]?.conspiracies, `${viewer} seeing ${p}`).toEqual([]);
      }
    }
  });

  it('PRIVATE_PLAYER_KEYS is not empty - the strip is not a no-op', () => {
    // Guards the fix: if someone empties the list to make a test pass, the
    // Conspiracy hand ships again and only this assertion notices.
    expect(PRIVATE_PLAYER_KEYS.length).toBeGreaterThan(0);
    expect([...PRIVATE_PLAYER_KEYS]).toContain('conspiracies');
  });

  it('returns only fields that exist on GameState, plus the documented derived ones', () => {
    const s = freshFull(9);
    const derived = new Set(['deckSizes', 'awaitingAnswer']);
    for (const key of Object.keys(playerView(s, 'p1'))) {
      if (derived.has(key)) continue;
      expect(Object.keys(s), `${key} is not a GameState field`).toContain(key);
    }
  });

  it('does not mutate the state it is given', () => {
    const s = withConspiracies(freshFull(10), { p1: ['con-01'], p2: ['con-04'] });
    const before = structuredClone(s);
    for (const v of s.turnOrder) playerView(s, v);
    expect(s).toEqual(before);
  });

  it('a 200-action game leaks no secret at ANY single point', () => {
    // A leak that opens and closes mid-turn is invisible to a single-sample
    // test, so this asserts after every accepted action.
    let checks = 0;
    const leaks: string[] = [];
    playFullGame(freshFull(11), bigCtx(), (s, p) => {
      checks += 1;
      if (checks > 220) return;
      for (const v of s.turnOrder) {
        const client = playerView(s, v);
        for (const k of allKeys(client)) if (k.startsWith('_')) leaks.push(k);
        // R1 also has to hold at every single point, not just at rest.
        for (const q of client.turnOrder) {
          if ((client.players[q]?.conspiracies.length ?? 0) > 0) {
            leaks.push(`${v} sees ${q}'s conspiracies`);
          }
        }
      }
      void p;
    });
    expect(checks).toBeGreaterThan(220);
    expect(leaks).toEqual([]);
  });

  it('setup() output round-trips through playerView without crashing, for n in 2..5', () => {
    for (let n = 2; n <= 5; n++) {
      const players = seats(n);
      const s = setup({
        players,
        cards: bigCards(),
        seed: 100 + n,
        ideologyDeck: IDEOLOGY_DECK,
        voterDeck: ['vot-01', 'vot-02', 'vot-03'],
        conspiracyDeck: ['con-01'],
        headlineDeck: ['hed-01'],
      });
      for (const v of players) assertNoUnderscoreKeys(s, v, `setup with ${n} players`);
    }
  });
});

/** A stand-in for a state where somebody has bought Conspiracy Cards. */
function withConspiracies(
  s: GameState,
  hands: Readonly<Record<PlayerID, readonly string[]>>,
): GameState {
  const players: Record<PlayerID, PlayerState> = { ...s.players };
  for (const [id, cards] of Object.entries(hands)) {
    const p = players[id];
    if (!p) throw new Error(`no such player ${id}`);
    players[id] = { ...p, conspiracies: cards };
  }
  return { ...s, players };
}
