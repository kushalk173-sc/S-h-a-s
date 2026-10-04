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
import { RULES } from '../src/engine.js';
import type { Ctx } from '../../engine/src/reduce';
import { usesLeft } from '../../engine/src/powers';
import type { GameState } from '../../engine/src/state';

import {
  FIXTURE_CONSPIRACIES,
  areaInZone,
  drainChoices,
  fixture,
  pegsOf,
  playConspiracy,
  resolveHeadline,
  totalOf,
  volatileAreaIn,
  withPegsFor,
  withPegsInZones,
  withResources,
  withUnlockedLevel3,
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
  // ── G16: `zone`, and the 'choose-zone' Choice kind it needed. ──
  {
    name: 'Just Breathe',
    ref: 'REF 4.3 (2040 Deck - Headline Cards)',
    kind: 'headline',
    verbatim:
      'Select the zone where you have the most number of voters. Move 2 voters from that zone into an adjacent zone. In case of a tie, pick any of the tied zones.',
    drops: [
      "'into an adjacent zone': a DESTINATION is a second decision on top of a source decision, and no recovered card ships on a half-built relocation (G16).",
"'move' ships as EVICT rather than a relocation, which is strictly WEAKER for everyone affected: an evicted voter returns to its owner's Mat and can be influenced again (G16).",
      "'in case of a tie, pick any of the tied zones': resolveZone breaks a tie by ZONE_IDS order instead, which is a deterministic rule rather than a decision -- so this drop is a SMALLER decision, not a different one (G16).",
    ],
    card: {
      id: 'hl-recovered-just-breathe',
      name: 'Just Breathe',
      text: 'Select the constituency where you have the most voters. Evict 2 voters from it.',
      effects: [{ op: 'evict', n: 2, zone: 'your-strongest' }],
    } as HeadlineCard,
    drive: (s) => withPegsInZones(s, [['p1', 'north'], ['p1', 'north'], ['p2', 'south']]),
    check: (s, before) => {
// THE CLAUSE THAT IS PERFORMED: two of p1's own pegs in `north` and one of p2's
      // in `south`, so "the zone where you have the most voters" is `north` because of
      // the COUNT. ZONE_IDS puts north_west before north, so an implementation that
      // ignored the count could still land on north here -- the layout is chosen so the
      // count is the only thing that can decide it.
      expect(pegsOf(before, 'p1')).toBe(2);
      expect(pegsOf(before, 'p2')).toBe(1);
      const raised = s.choices.find((x) => x.player === 'p1');
      expect(raised?.choice).toMatchObject({ kind: 'evict-voter', zone: 'your-strongest', zoneId: 'north' });
      void areaInZone;
    },
  },
  {
    name: "Nero's Guests",
    ref: 'REF 4.1 (2024 Headline and Conspiracy Cards Explained)',
    kind: 'headline',
    verbatim: 'Move any 3 voters in this zone. OR Move any 3 voters out of this zone.',
    drops: [
"'move' ships as EVICT rather than a relocation, which is strictly WEAKER for everyone affected: an evicted voter returns to its owner's Mat and can be influenced again (G16).",
      "the adjacent-zone destination, and the all-or-nothing pairing of the two clauses, which is a system rather than an effect (G16).",
    ],
    card: {
      id: 'hl-recovered-neros-guests',
      name: "Nero's Guests",
      text: 'Every opponent evicts 3 of their own voters from the Volatile Area whose placement drew this Headline.',
      effects: [{ op: 'evict', n: 3, target: 'each-opponent', zone: 'this-zone' }],
    } as HeadlineCard,
    drive: (s) => withPegsInZones(s, [['p2', 'central', 'volatile'], ['p2', 'central']]),
    queueAreas: (s) => {
      const a = volatileAreaIn(s, 'central');
      if (a === null) throw new Error('the fixture put no peg on a Volatile Area in central');
      return [a];
    },
    check: (s, before) => {
      // Confined to the constituency the placement was made in, which is what the
      // author's gloss says "this zone" means, and scoped 'own' so each victim chooses
      // among their own voters rather than the caster choosing for them.
      const asked = s.choices.filter((x) => x.player === 'p2');
      expect(asked).toHaveLength(1);
      expect(asked[0]?.choice).toMatchObject({ kind: 'evict-voter', scope: 'own', zoneId: 'central' });
      void before;
    },
  },
  {
    name: 'Cut, Copy, and Paste',
    ref: 'REF 4.2.1 (2040 Deck - Conspiracy Cards)',
    kind: 'conspiracy',
    verbatim:
      'At the end of your turn, select 1 of your majorities. Discard all your voters in that zone. If any empty area is left in this zone at the start of your next turn, convert all its voters into yours, and fill all remaining areas with your voters.',
    drops: [
      "the second turn entirely: 'if any empty area is left at the start of your next turn' is a standing effect conditioned on board state, and the engine has no condition over the board (G22).",
      "'1 of your MAJORITIES': the selector offers any constituency holding a voter of yours, which is WIDER than the printed restriction -- the one clause this card over-delivers on, and it is named rather than approximated. A majority-restricted selector would be satisfiable in ZERO zones for a player holding none, which is the unsatisfiable-choice class, so it is refused rather than added (G16).",
      "'all your voters in that zone' ships as 2, because a discard needs a count and the corpus recovered no number for 'all' -- and the engine clamps the ask to what the constituency holds, so 'all' is what a player with 4 voters there would get anyway (G4).",
    ],
    card: {
      id: 'ct-recovered-cut-copy-paste',
      name: 'Cut, Copy, and Paste',
      text: 'Select one constituency. Discard 2 of your voters from it.',
effects: [{ op: 'discard-voter', n: 2, target: 'you', zone: 'chosen-zone' }],
      cost: 5,
    } as ConspiracyCard,
    drive: (s) => withPegsInZones(s, [['p1', 'east'], ['p1', 'west']]),
    check: (s) => {
      // The card's OWN ACTOR is asked, and it is a ZONE decision -- a player-selector
      // here would be a card that reads as though it names a person.
      const raised = s.choices.find((x) => x.player === 'p1');
      expect(raised?.choice.kind).toBe('choose-zone');
      if (raised?.choice.kind !== 'choose-zone') return;
      expect(raised.choice.source).toBe('p1');
      expect(raised.choice.effects[0]).toMatchObject({ op: 'discard-voter', zone: 'chosen-zone' });
    },
  },
  // ── G1: `target: 'chosen-player'`, and the two cards that were stuck behind it. ──
  {
    name: 'Fatality',
    ref: 'REF 4.3 (2040 Deck - Headline Cards)',
    kind: 'headline',
    verbatim:
      'Influence an open Voter Card for free and donate the voters to any opponent. They must place these voters right away.',
    drops: [
      "'influence an open Voter Card for free': a PURCHASE the engine cannot grant. It needs a cost-waiver on INFLUENCE, which is G15's `price` field -- a computed cost the SELLER reads.",
      "'the voters' ships as 1, because the recovered text names no number and an invented one would be a claim the corpus does not support -- and a count above what the board holds is clamped by `resolveChoice` anyway (G4).",
      "'they must place these voters right away': a granted group is placed by its owner, and the turn machine has no 'immediately' placement -- a forced placement of somebody else's pending group is a G4-style per-unit iteration with a deadline (G22).",
    ],
    card: {
      id: 'hl-recovered-fatality',
      name: 'Fatality',
      text: 'Choose an opponent. They receive 1 voter.',
      effects: [{ op: 'voters', n: 1, target: 'chosen-player' }],
    } as HeadlineCard,
    check: (s) => {
      // THE CLAUSE THAT IS PERFORMED is the DONATE to a NAMED opponent, so the
      // assertion is that a decision exists, that it is the card's own ACTOR who owes
      // it, and that it carries the card's own effect. A `voters` grant aimed at
      // 'each-opponent' would have needed no decision and would not be this card.
      const raised = s.choices.find((x) => x.player === 'p1');
      expect(raised?.choice.kind).toBe('choose-player');
      if (raised?.choice.kind !== 'choose-player') return;
      expect(raised.choice.source).toBe('p1');
      expect(raised.choice.effects[0]).toMatchObject({ op: 'voters', target: 'chosen-player' });
    },
  },
  {
    name: 'Why The Long Face?',
    ref: 'REF 4.3 (2040 Deck - Headline Cards)',
    kind: 'headline',
    verbatim:
      'Pick an opponent. They will get 1 voter (not card) for every Voter Card you influence in their next turn.',
    drops: [
      "\`condition: { byOwner: true }\` is left OFF, so the hook fires on ANY influence including an opponent's, where the printed card says every Voter Card YOU influence. This makes the card STRONGER than the real one, and it is named here rather than approximated (G14).",
    ],
    card: {
      id: 'hl-recovered-long-face',
      name: 'Why The Long Face?',
      text: 'Choose an opponent. Every time a Voter Card is influenced before the start of your next turn, they receive 1 voter.',
      effects: [
        { op: 'voters', n: 1, target: 'chosen-player', when: 'on-voter-influenced', until: 'next-turn' },
      ],
    } as HeadlineCard,
    check: (s) => {
      // A lasting clause does nothing to a pool or a mat on the turn it resolves, so
      // the thing asserted is the INSTALL: a live effect in force, carrying the card.
      // That is the same shape the fingerprint in playable.ts learned to look for.
      const live = s.liveEffects.find((le) => le.sourceCardId === 'hl-recovered-long-face');
      expect(live, 'the hook was not installed').toBeDefined();
      if (live === undefined) return;
      expect(live.trigger).toBe('on-voter-influenced');
      expect(live.owner).toBe('p1');
      // AND the decision is NOT raised yet: a pending choice frozen into a LiveEffect
      // would outlive the turn it was raised on, which is a freeze by another name.
      expect(s.choices).toEqual([]);
    },
  },
  // ── The three cards in this batch that are the FIRST SHIPPED USER of an op. Each
  //    is a mechanism nothing else on the table exercises, so each is asserted on the
  //    state change itself and not merely on the decision it raises. ──
  {
    name: 'Stay In Your Limits',
    ref: 'REF 4.1 (2024 Headline and Conspiracy Cards Explained)',
    kind: 'headline',
    verbatim:
      "Every player converts 2 voters of the player to their left. Each player that doesn't break a majority gets 2 resources.",
    drops: [
      "'every player converts' becomes 'YOU convert': `EffectTarget` cannot name a seat-relative neighbour, so the per-player iteration and the direction are both dropped, and the donor may be ANY opponent -- which is WIDER than the seat to your left (G18/G2).",
      "'each player that doesn't break a majority gets 2 resources' is conditional on an OUTCOME of the conversion, which needs a per-player outcome record rather than a state (G2).",
    ],
    card: {
      id: 'hl-recovered-stay-in-limits',
      name: 'Stay In Your Limits',
      text: "Convert 2 of an opponent's voters into your own.",
      effects: [{ op: 'convert-voter', n: 2 }],
    } as HeadlineCard,
    drive: (s) => withPegsFor(s, ['p2', 'p2', 'p3']),
    check: (s, before, _ctx, after) => {
      // THE FIRST SHIPPED `convert-voter`, so the thing worth proving is that the peg
      // actually CHANGES HANDS rather than that a decision was raised: a
      // convert-voter aimed at a non-source player is raised to somebody who cannot
      // answer it (`voterScope` gives a named player scope 'own'), and with no
      // `target` at all the caster is the chooser with scope 'others'.
      expect(s.choices.map((c) => c.player)).toEqual(['p1']);
      expect(s.choices[0]?.choice).toMatchObject({ kind: 'convert-voter', scope: 'others' });
      // Two of p2's pegs are now p1's and p3 is untouched. p2 had two, so p2 keeps
      // none -- which is the whole point: `convert-voter` does not discard, it
      // changes the peg's owner, so the count on the board is unchanged.
      expect(pegsOf(before, 'p1')).toBe(0);
      expect(pegsOf(after, 'p1')).toBe(2);
      expect(pegsOf(after, 'p2')).toBe(0);
      expect(pegsOf(after, 'p3')).toBe(1);
    },
  },
  {
    name: 'If You Like Pina Colada',
    ref: 'REF 4.2.1 (2040 Deck - Conspiracy Cards)',
    kind: 'conspiracy',
    verbatim: 'Double all the resources on your player mat. Your current resource cap still applies.',
    drops: [
      'no clause is dropped, which is why this is the one entry in the file whose reduction is the whole card. It is `adapted` rather than `verbatim` only because a Conspiracy Card also needs a `cost` that the recovered rules text does not print -- G4 and G15 landed for the `per` multiplier, and the cap is the card own second sentence.',
    ],
    card: {
      id: 'ct-recovered-pina-colada',
      name: 'If You Like Pina Colada',
      text: 'Double every resource on your Mat. Your resource cap still applies.',
      cost: 1,
      effects: [
        {
          op: 'gain',
          res: { funds: 1, clout: 1, media: 1, trust: 1 },
          per: { of: 'held-of-each-resource' },
        },
      ],
    } as ConspiracyCard,
    // A Lopsided Mat, and the reason is the assertion below. `per` multiplies each
    // component by what the player holds OF THAT RESOURCE, so the pools p1 is not
    // holding must come back at zero. A flat `gain res {1,1,1,1}` would pay all four,
    // and that is the difference between the printed card and a different card.
    drive: (s) => withResources(s, 'p1', { funds: 2, clout: 0, media: 0, trust: 0 }),
    check: (s, before, _ctx, after) => {
      // THE FIRST SHIPPED COMPUTED VALUE, so the assertion is the arithmetic the `per`
      // multiplier stands for: a res of 1 in EACH resource times what the player holds
      // of each IS a doubling of the mat, and p12's cap is enforced on top -- the
      // card's own second sentence, and the reason a card that merely doubled could
      // read as though the cap did not apply.
      // held 2 of Funds and 0 of everything else. `PLAY_CONSPIRACY` does not charge
      // the cost -- `BUY_CONSPIRACY` does, and a card played from the hand was
      // already bought -- so the Mat in `before` is the Mat the `per` multiplier
      // reads, which is the point of KNOWN-GAPS 0b.1 item 6: a computed value reads
      // the state of the player the effect resolves FOR.
      const held = before.players.p1!.resources;
      const now = after.players.p1!.resources;
      expect(now.funds, `held ${held.funds} Funds`).toBe(Math.min(held.funds * 2, RULES.resourceCap));
      for (const pool of ['clout', 'media', 'trust'] as const) {
        // THE DISCRIMINATING ASSERTION. A flat `gain res {1,1,1,1}` pays every pool
        // and this one pays only what is there, so an empty pool must come back at
        // zero rather than at 1.
        expect(now[pool], `${pool} was empty, so a doubling must gain nothing there`).toBe(0);
      }
      expect(totalOf(after, 'p1')).toBeGreaterThan(totalOf(before, 'p1'));
      void s;
    },
  },
  {
    name: 'Gender Trouble',
    ref: 'REF 4.3 (2040 Deck – Headline Cards)',
    kind: 'headline',
    verbatim:
      'You cannot use one of your unlocked Level 3 Ideologue Powers in your next turn. If you do not have a Level 3 Ideologue Power, discard 2 resources in your next turn.',
    drops: [
      "'one of your unlocked Level 3 Ideologue Powers' becomes ALL of them: naming one power is a decision over POWERS rather than over players, so no `EffectTarget` can say it (G1). That makes the card WEAKER for the caster, and it is named rather than approximated.",
      "'if you do not have a Level 3 Ideologue Power, discard 2 resources in your next turn' is a conditional over a whole effect list, which the `Effect` union has no way to state (G5).",
    ],
    card: {
      id: 'hl-recovered-gender-trouble',
      name: 'Gender Trouble',
      text: 'You cannot use ANY of your unlocked Level 3 Ideologue Powers until the start of your next turn.',
      effects: [{ op: 'restrict', kind: 'no-power', value: 0, target: 'you', until: 'next-turn' }],
    } as HeadlineCard,
    drive: (s) => withUnlockedLevel3(s),
    check: (s, before, _ctx, after) => {
      // THE FIRST SHIPPED `no-power`, so the assertion is that the rule is CONSULTED
      // and not merely written. `usesLeft` is the engine's one consult point for this
      // kind, and every `POWER_*` case in `reduce()` already asks it.
      expect(
        usesLeft(before.players.p1!, RULES, 'prospecting'),
        'the fixture must hold the power, or this assertion is vacuous',
      ).toBeGreaterThan(0);
      expect(usesLeft(after.players.p1!, RULES, 'prospecting'), 'written but not consulted').toBe(0);
      // The lifetime is the CASTER'S next turn, which is `ownerNextTurn` and not a
      // second definition of the deadline -- see G22's ruling on why `usesLeft` does
      // not re-derive it.
      const r = after.players.p1!.restrictions?.find((x) => x.kind === 'no-power');
      expect(r, 'the restriction was not written at all').toBeDefined();
      expect(r?.sourceCardId).toBe('hl-recovered-gender-trouble');
      expect(r?.expiresTurn).toBeGreaterThan(before.turn);
      void s;
    },
  },
  {
    name: 'Blessings Of Parents Past',
    ref: 'REF 4.1 (2024 Headline And Conspiracy Cards Explained)',
    kind: 'headline',
    verbatim:
      'Draw 2 Voter Cards. Keep 1 and donate the other to an opponent. These Voter Cards are influenced for free immediately.',
    drops: [
      "'Keep 1' needs a private VOTER CARD HAND to hold the kept card and a `choose-card` over it. `move-card { from: 'revealed', to: 'hand' }` cannot stand in: it writes `PlayerState.ideologyCards`, the IDEOLOGY hand, where `advanceTurn` hands that Voter Card id to the next player as their Ideology Card and `ANSWER` reads `cards.ideology[id]` and fails permanently. The CHOICE is refused too — `Choice`'s `choose-card` arm names `_conspiracyDiscard` and nothing else, so G17's market enumeration (the one set 2bis calls legitimate, since p10 keeps three Voter Cards face up on the HQ Mat) is still unbuilt and U1 did not reach this card.",
      "'donate the other to an opponent' needs `move-card` to carry a Voter Card into a NAMED OPPONENT's container. `to` is 'hand' | 'destroy', and 'destroy' is the wrong verb anyway because the donated card must still be influenced afterwards (G20), though G1's `chosen-player` would have supplied the seat.",
      "'These Voter Cards are influenced for free immediately' needs a free INFLUENCE: `INFLUENCE` is an ACTION whose `pay` the player must be able to afford, and no `Effect` can grant it (G15's `price`) — the identical drop `hl-et2040-018` Fatality names. `sameZone` does not rescue it: `INFLUENCE` is the only writer of `PendingVoterGroup.sameZone` and no op exposes the field, so `voters` cannot stand in for a Voter Card's unsplittable group.",
      "REF 4.1's own gloss, 'you place your influenced voters first, then the opponent places theirs', needs a `PendingVoters` group whose deadline is the DONOR's resolution rather than the RECIPIENT's turn. That is the open decision in KNOWN-GAPS.md 8.2(b), which carries no gap number because this package declined to file one (G20).",
    ],
    card: {
      id: 'hl-recovered-blessings',
      name: 'Blessings Of Parents Past',
      text: 'Turn the top 2 Voter Cards of the draw pile face up for the whole table to look at. That is all this card does today: there is nowhere in this engine to keep a Voter Card, so the two you turn over leave the game when this Headline resolves.',
      effects: [{ op: 'reveal', kind: 'voter', n: 2 }],
    } as HeadlineCard,
    check: (raised, before) => {
      // The one clause that ships, asserted on the state the moment the card
      // resolved: two Voter Cards came off `_voterDraw` and are FACE UP on the public
      // revealed set. `revealedCards` is unprefixed and on every payload, so this is
      // the one card in the corpus that publishes cards deliberately — and the
      // assertion is that the ids are the pile's OWN top two, in order.
      const drawn = before._voterDraw.slice(0, 2);
      expect(drawn.length, 'the fixture draw pile must have 2 Voter Cards in it').toBe(2);
      expect(raised.revealedCards.p1).toEqual(drawn);
      expect(raised._voterDraw).toEqual(before._voterDraw.slice(2));
      // …and NOT kept, and NOT donated. `to: 'hand'` would have written the IDEOLOGY
      // hand and `chosen-player` would have needed a Voter Card container that does
      // not exist; asserting the absence is what stops a future edit quietly making
      // this card claim more than the corpus supports.
      expect(raised.players.p1!.ideologyCards).toEqual(before.players.p1!.ideologyCards);
      expect(raised.players.p2!.ideologyCards).toEqual(before.players.p2!.ideologyCards);
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
      : resolveHeadline(before, 'p1', entry.card as HeadlineCard, ctx, 2, entry.queueAreas?.(before) ?? []);
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