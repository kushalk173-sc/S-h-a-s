/**
 * G20, PART ONE — `PlayerState.ideologyCards` exists, and it is a hand.
 *
 * The ruling this file exists to pin is the long one on `PlayerState.ideologyCards`
 * in `state.ts`, and the three properties below are the load-bearing halves of it.
 * The mechanics (`move-card`, the turn-boundary drain) are in
 * `card-transfer.test.ts`; this file is about the FIELD, because a field that is
 * declared hidden and then shipped readable is the failure the whole ruling is
 * written to prevent, and it fails silently — the structural `_`-prefix walk in
 * `playerView.test.ts` cannot see an unprefixed field, which is exactly the R1 lesson
 * ARCHITECTURE §8.1.1 records.
 */

import { describe, expect, it } from 'vitest';

import { allKeys, playerView, PRIVATE_PLAYER_KEYS } from '../src/playerView';
import { reduce } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { IDEOLOGUES, ideologyHandOf, type GameState, type PlayerID } from '../src/state';
import type { IdeologyCard } from '../src/cards';
import { indexCards } from '../src/cards';
import { CARDS, fresh, PLAYERS_3 } from './helpers';

/** A hand of three real Ideology Card ids, so a leak test has something to find. */
const HAND = ['ide-01', 'ide-05', 'ide-09'] as const;

function withHand(s: GameState, who: PlayerID, cards: readonly string[] = HAND): GameState {
  const p = s.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  return { ...s, players: { ...s.players, [who]: { ...p, ideologyCards: cards } } };
}

describe('G20 — a held Ideology Card is a hidden hand', () => {
  it('setup writes an empty one, so the field is never absent in an engine state', () => {
    const s = fresh(1);
    for (const id of s.turnOrder) {
      expect(s.players[id]?.ideologyCards).toEqual([]);
      expect(ideologyHandOf(s.players[id])).toEqual([]);
    }
  });

  it('is in PRIVATE_PLAYER_KEYS, and that list is not a no-op', () => {
    expect([...PRIVATE_PLAYER_KEYS]).toContain('ideologyCards');
    expect([...PRIVATE_PLAYER_KEYS]).toContain('conspiracies');
    expect(PRIVATE_PLAYER_KEYS.length).toBeGreaterThan(1);
  });

  it('is stripped for every viewer, INCLUDING the player it was given to', () => {
    // The recipient is the viewer who would win the most from reading it, and the
    // physical game hands a card face down. See the ruling: p13 keeps a card hidden
    // "until the active player confirms their answer", and an unanswered card is
    // hidden from the table AND from whoever is holding it.
    const s = withHand(fresh(1), 'p2');
    for (const viewer of s.turnOrder) {
      const client = playerView(s, viewer);
      for (const pid of s.turnOrder) {
        expect(client.players[pid]?.ideologyCards, `${viewer} seeing ${pid}`).toEqual([]);
      }
    }
  });

  it('leaks no card id into any payload, to anybody', () => {
    // R1's second half, and the part the key-strip alone does not prove: a key that
    // survives with a non-empty value somewhere else in the graph would pass the
    // `players[pid][key] === []` check above. A string scan does not have that gap.
    const s = withHand(fresh(1), 'p2');
    for (const viewer of s.turnOrder) {
      const json = JSON.stringify(playerView(s, viewer));
      for (const id of HAND) {
        expect(json, `${viewer} must not see ${id}`).not.toContain(id);
      }
      // Not a payout either, for the same reason the pending card's sides are checked.
      for (const id of HAND) {
        const card = CARDS.ideology[id];
        if (!card) continue;
        for (const side of card.sides) {
          expect(json).not.toContain(JSON.stringify(side.pays));
        }
      }
    }
  });

  it('the whole hand graph still walks without an underscore key appearing', () => {
    const s = withHand(fresh(1), 'p1', HAND);
    for (const viewer of s.turnOrder) {
      expect(allKeys(playerView(s, viewer)).filter((k) => k.startsWith('_'))).toEqual([]);
    }
  });

  it('does not mutate the state it is given', () => {
    const s = withHand(fresh(1), 'p2');
    const before = structuredClone(s);
    for (const v of s.turnOrder) playerView(s, v);
    expect(s).toEqual(before);
    expect(s.players.p2?.ideologyCards).toEqual(HAND);
  });

  it('an absent field reads as an empty hand, not as a crash', () => {
    // `ideologyCards` is OPTIONAL (state.ts says why, and it is the same reason
    // `restrictions` is: hand-built PlayerState literals in packages/client and
    // packages/server do not carry it). Every read goes through one accessor.
    const s = fresh(1);
    const stripped: GameState = {
      ...s,
      players: Object.fromEntries(
        Object.entries(s.players).map(([id, p]) => {
          const { ideologyCards: _dropped, ...rest } = p;
          return [id, rest];
        }),
      ),
    };
    for (const id of stripped.turnOrder) {
      expect(ideologyHandOf(stripped.players[id])).toEqual([]);
    }
    // And the state still projects, because `playerView` writes `[]` for the key
    // whether or not the key was there.
    expect(playerView(stripped, 'p1').players.p1?.ideologyCards).toEqual([]);
  });

  it('a hand does not become public by being answered later, and an answer does not read a hand', () => {
    // The two fields are on opposite sides of p13's line and must not leak into each
    // other. Concretely: the card that was PUT to p1 is the one that becomes public on
    // ANSWER, and it is not one of the cards p1 was holding. A hand that was quietly
    // treated as a manifesto would make a player "answer" a card nobody dealt them.
    const cards = twoCardCtx();
    const s: GameState = setup({
      players: PLAYERS_3,
      cards: cards.cards,
      seed: 7,
      ideologyDeck: ['hand-ide-1', 'hand-ide-2'],
    });
    // The seeded shuffle decides which card was dealt, and the point of the test is
    // that the HELD card is the OTHER one. Read the dealt id rather than assuming it.
    const dealt = s._pendingCard;
    expect(dealt).not.toBeNull();
    if (dealt === null) return;
    const held = dealt === 'hand-ide-1' ? 'hand-ide-2' : 'hand-ide-1';

    const holding = withHand(s, 'p1', [held]);
    const answered = reduce(holding, 'p1', { type: 'ANSWER', side: 0 }, { rules: RULES, cards: cards.cards });
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;

    // The DEALT card became public; the HELD card did not, and is still held.
    expect(answered.state.players.p1?.manifestoCards).toEqual([dealt]);
    expect(ideologyHandOf(answered.state.players.p1)).toEqual([held]);

    // So a viewer learns the dealt card and not the held one.
    const json = JSON.stringify(playerView(answered.state, 'p1'));
    expect(json).toContain(dealt);
    expect(json).not.toContain(held);
  });
});

/** A deck of two real cards, so a hand can be put somewhere and then answered. */
function twoCardCtx(): { cards: ReturnType<typeof indexCards> } {
  const ideology: IdeologyCard[] = [
    {
      id: 'hand-ide-1',
      campaign: 'hand',
      question: 'q1',
      sides: [
        { answer: 'a1', ideologue: IDEOLOGUES[0] as IdeologyCard['sides'][0]['ideologue'], pays: { funds: 1 } },
        { answer: 'b1', ideologue: IDEOLOGUES[1] as IdeologyCard['sides'][0]['ideologue'], pays: { trust: 1 } },
      ],
    },
    {
      id: 'hand-ide-2',
      campaign: 'hand',
      question: 'q2',
      sides: [
        { answer: 'a2', ideologue: IDEOLOGUES[2] as IdeologyCard['sides'][0]['ideologue'], pays: { media: 1 } },
        { answer: 'b2', ideologue: IDEOLOGUES[3] as IdeologyCard['sides'][0]['ideologue'], pays: { clout: 1 } },
      ],
    },
  ];
  return { cards: indexCards({ ideology, voter: [], conspiracy: [], headline: [] }) };
}
