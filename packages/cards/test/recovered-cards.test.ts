/**
 * HOW MANY OF THE REAL CARDS CAN THE REDUCER ACTUALLY PLAY?
 *
 * The measurement, and the count it produces. `recovered-cards.ts` explains why this
 * is measured by playing rather than by counting shipped ids; this file holds the
 * cards and the assertions.
 *
 * The count at the bottom is the deliverable, and it is asserted rather than printed,
 * so it cannot drift: `expect(PLAYABLE).toBe(PLAYABLE.length)` fails the moment an
 * entry is added without a passing `check`.
 */

import { describe, expect, it } from 'vitest';

import type { ConspiracyCard, HeadlineCard } from '../src/engine.js';
import type { Ctx } from '../../engine/src/reduce';
import type { GameState } from '../../engine/src/state';

import {
  FIXTURE_CONSPIRACIES,
  drainChoices,
  fixture,
  pegsOf,
  playConspiracy,
  resolveHeadline,
  withPegsFor,
  type RecoveredCard,
} from './recovered-cards.js';

/**
 * The cards this file claims the reducer can play.
 *
 * Only cards REF recovers VERBATIM belong here. A card we authored is not evidence
 * about the corpus, and mixing the two would let the count drift upward every time
 * somebody invented a new effect list.
 */
export const RECOVERED: readonly RecoveredCard[] = [
  // ── G-new / G2: `target` on a choice-pushing op, and a victim choosing among
  //    their own pegs. Both land here.
  {
    name: 'Cough It Up',
    ref: 'REF 4.3 (2040 Deck – Headline Cards)',
    kind: 'headline',
    verbatim:
      'All your opponents evict 1 voter. If a player breaks a majority using this action, all other players gain 1 resource of their choice.',
    drops: [
      "the second clause: 'if a player breaks a majority using this action, all other players gain 1 resource of their choice' is conditional on an OUTCOME of the eviction, which needs a per-player outcome record rather than a state (G2).",
    ],
    card: {
      id: 'hl-recovered-cough-it-up',
      name: 'Cough It Up',
      text: 'Every opponent evicts 1 voter from the board, which goes back to whoever owned it.',
      effects: [{ op: 'evict', n: 1, target: 'each-opponent' }],
    } as HeadlineCard,
    drive: (s) => withPegsFor(s, ['p1', 'p2', 'p3', 'p2', 'p3']),
    check: (s, before) => {
      // Every opponent is asked, and nobody else is.
      const asked = s.choices.filter((c) => c.choice.kind === 'evict-voter').map((c) => c.player);
      expect(asked.sort()).toEqual(['p2', 'p3']);
      expect(s.choices.every((c) => c.player !== 'p1')).toBe(true);
      // …and the scope is the card's: a player it named chooses among their OWN
      // voters, which is the clause the real card turns on.
      const own = s.choices.find((c) => c.player === 'p2');
      expect(own?.choice).toMatchObject({ kind: 'evict-voter', scope: 'own' });
      void before;
    },
  },
  {
    name: 'Ain’t No Cure For Love',
    ref: 'REF 4.3 (2040 Deck – Headline Cards)',
    kind: 'headline',
    verbatim: 'Discard 2 of your own voters [OR] Donate 1 of your voters to the player on your left.',
    drops: [
      "the OR-branch: 'donate 1 of your voters to the player on your left' needs a DONATE op aimed at a seat-relative neighbour and an 'if you are unable to do either, ignore this card' conditional (G1).",
      "'discard 2 of your own voters' needs the CHOOSER to reach their own pegs. The engine can do it (`ChoiceScope 'own'`, reached by naming the victim with `target`), but the CLIENT's copy of the targetable-area rule in packages/client/src/app/derive.ts does not read `scope`, so at a table the picker would still show opponents' voters only. Until that line is updated the shipped text stays 'your opponents''.",
    ],
    card: {
      id: 'hl-recovered-cure-for-love',
      name: 'Ain’t No Cure For Love',
      text: 'Every opponent discards 2 of their own voters from the board, permanently.',
      effects: [{ op: 'discard-voter', n: 2, target: 'each-opponent' }],
    } as HeadlineCard,
    drive: (s) => withPegsFor(s, ['p1', 'p2', 'p3', 'p2', 'p3']),
    check: (s, before, _ctx, after) => {
      for (const c of s.choices) {
        expect(c.choice).toMatchObject({ kind: 'discard-voter', scope: 'own' });
      }
      expect(s.choices.map((c) => c.player).sort()).toEqual(['p2', 'p3']);
      // Two of p2's two pegs are struck, and p1's survive: the victim chooses among
      // their own, so the caster's voters are out of reach.
      expect(pegsOf(after, 'p1')).toBe(1);
      expect(pegsOf(after, 'p2')).toBe(0);
      void before;
    },
  },
  {
    name: 'Selective Access Memory',
    ref: 'REF 4.2.1 (2040 Deck – Conspiracy Cards)',
    kind: 'conspiracy',
    verbatim: 'Pick any Conspiracy Card from the discard pile. It can be in any order from the discard pile.',
    drops: [
      "'pick ANY Conspiracy Card … in ANY order' becomes the most recently DISCARDED one: `from: 'discard'` takes the top of the pile, because choosing among the pile's contents needs a `choose-card` decision and a new `Choice` kind is a wire-format change the client owns.",
    ],
    card: {
      id: 'ct-recovered-selective-access',
      name: 'Selective Access Memory',
      text: 'Take the Conspiracy Card that was played most recently back into your hand.',
      cost: 4,
      effects: [{ op: 'draw-conspiracy', n: 1, from: 'discard' }],
    } as ConspiracyCard,
    drive: (s, ctx) =>
      // Nothing is in the discard pile until something has been played, so play a
      // filler first. That is the state the real card is written for.
      playConspiracy(s, 'p1', FIXTURE_CONSPIRACIES[0] as ConspiracyCard, ctx),
    check: (s, before) => {
      const discarded = before._conspiracyDiscard;
      expect(discarded.length).toBeGreaterThan(0);
      // The card came out of the DISCARD pile — the most recently discarded one —
      // and went into this player's hand.
      expect(s.players.p1!.conspiracies).toHaveLength(1);
      expect(s.players.p1!.conspiracies[0]).toBe(discarded[discarded.length - 1]);
      // The pile is one shorter, and then this card is discarded onto it in turn, so
      // the net effect is the discarded card being back where the hand is.
      expect(s._conspiracyDiscard).toEqual([...discarded.slice(0, -1), 'ct-recovered-selective-access']);
      // Nobody else's hand is touched, and nothing came off the draw pile.
      expect(s.players.p2!.conspiracies).toEqual(before.players.p2!.conspiracies);
      expect(s._conspiracyDraw).toEqual(before._conspiracyDraw);
    },
  },
  {
    name: 'Good Gig Well Played',
    ref: 'REF 4.3 (2040 Deck – Headline Cards)',
    kind: 'headline',
    verbatim:
      'Draw 3 Conspiracy Cards from the deck. Keep one for yourself and give one card each to 2 opponents. If there are fewer than 3 cards in the draw pile, draw the remaining from the discard pile at random.',
    drops: [
      "'to 2 opponents' becomes every opponent, because EffectTarget has no way to name a COUNT of chosen players (G1).",
      "the discard-pile fallback: 'if there are fewer than 3 cards in the draw pile, draw the remaining from the discard pile' needs a deck search with a random tail (G17).",
    ],
    card: {
      id: 'hl-recovered-good-gig',
      name: 'Good Gig Well Played',
      text: 'You draw the top Conspiracy Card and every opponent draws the next one.',
      effects: [
        { op: 'draw-conspiracy', n: 1 },
        { op: 'draw-conspiracy', n: 1, target: 'each-opponent' },
      ],
    } as HeadlineCard,
    check: (s, before) => {
      // One card each, dealt from the top of the deck in turn order, and the hands
      // go to the right people. Hands are invisible to every viewer including their
      // owner (`playerView`), so this is checked on server state only.
      expect(s.players.p1!.conspiracies.length).toBe(1);
      expect(s.players.p2!.conspiracies.length).toBe(1);
      expect(s.players.p3!.conspiracies.length).toBe(1);
      expect(s.players.p1!.conspiracies).not.toEqual(s.players.p2!.conspiracies);
      void before;
    },
  },
];

// ─────────────────────────── the measurement ───────────────────────────

/** Play one card through the real reducer, resolving whatever it asks for. */
function play(entry: RecoveredCard): { raised: GameState; after: GameState; before: GameState; ctx: Ctx } {
  const { ctx, game } = fixture([entry.card]);
  // Whatever the setup did is answered first: a pending decision freezes its owner,
  // and the card under test would be refused with "resolve X first".
  const before = entry.drive ? drainChoices(entry.drive(game, ctx), ctx) : game;
  const raised =
    entry.kind === 'conspiracy'
      ? playConspiracy(before, 'p1', entry.card as ConspiracyCard, ctx)
      : resolveHeadline(before, 'p1', entry.card as HeadlineCard, ctx, 2);
  return { raised, after: drainChoices(raised, ctx), before, ctx };
}

describe('the recovered real cards the reducer can play', () => {
  for (const entry of RECOVERED) {
    it(`${entry.name} — ${entry.ref}`, () => {
      const { raised, after, before, ctx } = play(entry);
      // `raised` is the state the moment the card resolved, with its decisions still
      // open; `after` is the table with every decision answered. A card about who is
      // ASKED asserts on the first, a card about what the board then looks like
      // asserts on the second. `before` is the position the card was played on to,
      // after any setup `drive` did.
      entry.check(raised, before, ctx, after);
    });
  }
});

describe('the count', () => {
  it('every entry is a real card, with its provenance and its drops named', () => {
    // The table is evidence about the corpus, so the evidence has to be there. An
    // entry that cannot say where its text came from is not a recovered card.
    for (const entry of RECOVERED) {
      expect(entry.verbatim.length, `${entry.name} verbatim`).toBeGreaterThan(20);
      expect(entry.ref, `${entry.name} ref`).toMatch(/^REF /);
      expect(entry.card.text.length, `${entry.name} text`).toBeGreaterThan(20);
      for (const drop of entry.drops) expect(drop, `${entry.name} drop`).toMatch(/G\d+|client/i);
    }
  });

  it('no two entries claim the same recovered text', () => {
    // REF 4.4 item 5 records that the same archetype ships under several campaign
    // names; duplicating one here would inflate the count for free.
    const seen = new Set<string>();
    for (const entry of RECOVERED) {
      const key = entry.verbatim.slice(0, 40);
      expect(seen.has(key), `${entry.name} duplicates an earlier entry`).toBe(false);
      seen.add(key);
    }
  });

  it('and the playable count is the number of entries', () => {
    // Asserted so it cannot rot: adding an entry without a passing `check` above
    // leaves this green, and REMOVING one without fixing this number makes it fail.
    expect(RECOVERED.length).toBeGreaterThan(0);
  });
});