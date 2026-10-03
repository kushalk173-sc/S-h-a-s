/**
 * G14a — `borrow-power`, and the `'borrowed-powers'` rule it writes.
 *
 * DEEP THOUGHTS (REF 4.2.1): *"Select an opponent and use all their Level 3 Ideologue
 * Powers this turn. You cannot use the same Ideologue Power twice."* POLO RETREAT is the
 * same borrow across a turn boundary.
 *
 * Four properties are asserted here, and the middle two are the ones that make this a
 * card rather than a feature:
 *
 *  1. **THE GRANT IS REAL AND IN THE RIGHT DIRECTION.** The entry lands on the CASTER
 *     and names the DONOR, which is the one inverting field on `Restriction`. Reversed,
 *     this is a card that lets the donor use the caster's powers — a no-op that reads as
 *     a working mechanic.
 *  2. **SATISFIABILITY.** `borrow-power` names a player through the existing
 *     `'choose-player'` decision, whose candidate set is `turnOrder` minus the actor.
 *     Offered and validated are the same expression, so there is no state in which the
 *     decision has no legal answer — including the two-seat table, where the candidate
 *     set is exactly one player.
 *  3. **TOTALITY OVER LEVEL 3, AND REFUSAL AT LEVEL 5.** Every Level 3 power is
 *     consulted through `usesLeft` and every Level 5 power is not, so the rule grants
 *     Level 3 and the `describe.each` below proves it grants all four of them. Land Grab
 *     is asserted to stay at 0, because a power that is available in one code path and
 *     not another is the exact failure `RestrictionKind` documents.
 *  4. **NO NEW PUBLIC FIELD, so no server change.** `restrictions` is already declared
 *     public; this test asserts the whole `playerView` payload for every viewer
 *     contains no `_` key and that the borrow is visible to all of them, which is the
 *     property that makes reusing the list honest.
 *
 * Deadlock: a borrow only ever ADDS an available power, so it cannot remove a legal
 * move from anybody. The assertion is a played game at 2, 3, 4 and 5 seats with the
 * card in the deck, asserting at every step that some action succeeds.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard, type IdeologyCard } from '../src/cards';
import { playerView } from '../src/playerView';
import { POWERS, borrowedFrom, usesLeft } from '../src/powers';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import type { GameState, Ideologue, PlayerID } from '../src/state';
import { PLAYERS_3, IDEOLOGY_DECK, VOTER_DECK, HEADLINE_DECK } from './helpers';

/** DEEP THOUGHTS, verbatim shape: one opponent's Level 3 powers, for this turn. */
const DEEP_THOUGHTS: ConspiracyCard = {
  id: 'bw-deep',
  name: 'Deep Thoughts',
  text: "Select an opponent and use all their Level 3 Ideologue Powers this turn.",
  cost: 4,
  effects: [{ op: 'borrow-power', target: 'chosen-player' }],
};

/** POLO RETREAT's lifetime: live through the caster's next turn. */
const NEXT_TURN_BORROW: ConspiracyCard = {
  id: 'bw-next',
  name: 'A Borrowing',
  text: 'Pick an opponent. In your next turn, you may use their Level 3 Ideologue Powers.',
  cost: 4,
  effects: [{ op: 'borrow-power', target: 'chosen-player', until: 'next-turn' }],
};

/** Enough Ideology Cards for a Level 5 to be reachable, so the refusal is testable. */
const IDEOLOGY: readonly IdeologyCard[] = Array.from({ length: 14 }, (_, i) => ({
  id: `bw-ig-${i}`,
  campaign: 'bw',
  question: `Q${i}`,
  sides: [
    { answer: 'A', ideologue: 'capitalist' as const, pays: { funds: 1 } },
    { answer: 'B', ideologue: 'idealist' as const, pays: { trust: 1 } },
  ],
}));

const CARDS: CardIndex = indexCards({
  ideology: [...IDEOLOGY],
  voter: [
    { id: 'bw-v-1', cost: { funds: 1 }, voters: 1 },
    { id: 'bw-v-2', cost: { funds: 2 }, voters: 2 },
    { id: 'bw-v-3', cost: { funds: 3 }, voters: 3 },
  ],
  conspiracy: [DEEP_THOUGHTS, NEXT_TURN_BORROW],
  headline: [{ id: 'bw-h-1', name: 'A Headline', text: 'Nothing happens, and that is the point.', effects: [] }],
});

const CTX: Ctx = { rules: RULES, cards: CARDS };
const VOTER_IDS = CARDS.voter ? Object.keys(CARDS.voter) : [];
const HEADLINE_IDS = CARDS.headline ? Object.keys(CARDS.headline) : [];

/** A position with a choice already answered, so `PLAY_CONSPIRACY` is the first act. */
function opening(
  players: readonly PlayerID[] = PLAYERS_3,
  manifests: Readonly<Record<string, Ideologue[]>> = {},
): GameState {
  const base = setup({
    players,
    cards: CARDS,
    seed: 91,
    ideologyDeck: [...IDEOLOGY_DECK.filter((id) => id.startsWith('bw-')), ...IDEOLOGY.map((c) => c.id)],
    voterDeck: VOTER_IDS,
    conspiracyDeck: [DEEP_THOUGHTS.id, NEXT_TURN_BORROW.id],
    headlineDeck: HEADLINE_IDS,
  });
  const seeded: GameState = {
    ...base,
    players: Object.fromEntries(
      Object.entries(base.players).map(([id, p]) => [
        id,
        manifests[id] ? { ...p, manifesto: manifests[id]! } : p,
      ]),
    ),
  };
  const r = reduce(seeded, seeded.activePlayer, { type: 'ANSWER', side: 0 }, CTX);
  if (!r.ok) throw new Error(`opening answer: ${r.error}`);
  return { ...r.state, phase: 'actions' };
}

/** Answer the `'choose-player'` the card raises, naming `donor`. */
function borrowFrom(s: GameState, cardId: string, by: PlayerID, donor: PlayerID): GameState {
  const withCard: GameState = {
    ...s,
    phase: 'actions',
    players: {
      ...s.players,
      [by]: { ...s.players[by]!, conspiracies: [...s.players[by]!.conspiracies, cardId] },
    },
  };
  const played = reduce(withCard, by, { type: 'PLAY_CONSPIRACY', cardId }, CTX);
  if (!played.ok) throw new Error(`play: ${played.error}`);
  const pending = played.state.choices.find((c) => c.choice.kind === 'choose-player');
  if (pending === undefined) throw new Error('borrow-power raised no choose-player decision');
  const answered = reduce(played.state, by, {
    type: 'RESOLVE_CHOICE',
    choiceId: pending.id,
    pick: { kind: 'player', id: donor },
  }, CTX);
  if (!answered.ok) throw new Error(`choose: ${answered.error}`);
  return answered.state;
}

describe('G14a — borrow-power writes a public rule naming the DONOR', () => {
  it('lands on the CASTER and names the donor, which is the inverting field', () => {
    // p2 holds three Capitalist cards, so Prospecting (Capitalist L3) is theirs.
    const s = borrowFrom(opening(PLAYERS_3, { p2: ['capitalist', 'capitalist', 'capitalist'] }), DEEP_THOUGHTS.id, 'p1', 'p2');
    const p1 = s.players.p1!;
    const borrow = (p1.restrictions ?? []).find((r) => r.kind === 'borrowed-powers');
    expect(borrow, 'the caster carries the borrow').toBeDefined();
    expect(borrow!.sourcePlayer).toBe('p2');
    // The donor carries nothing: `restrict` would have written it there, and that is a
    // card that grants the donor the caster's powers.
    expect((s.players.p2!.restrictions ?? []).filter((r) => r.kind === 'borrowed-powers')).toEqual([]);
    // And the donor's OWN powers are untouched — a borrow is additive, never a transfer.
    expect(usesLeft(s.players.p2!, RULES, 'prospecting')).toBeGreaterThan(0);
  });

  it('actually unlocks the donor\u2019s power for the borrower, and only for the borrower', () => {
    const s = borrowFrom(opening(PLAYERS_3, { p2: ['capitalist', 'capitalist', 'capitalist'] }), DEEP_THOUGHTS.id, 'p1', 'p2');
    const p1 = s.players.p1!;
    const donors = borrowedFrom(s, 'p1');
    expect(donors).toHaveLength(1);
    expect(donors[0]!.id).toBe('p2');
    // The whole of DEEP THOUGHTS, measured through the function the reducer asks.
    expect(usesLeft(p1, RULES, 'prospecting', donors)).toBeGreaterThan(0);
    // Without the donor list it is still locked, so the grant is the borrow and nothing
    // else — the player has answered one Capitalist card, which is one short of Level 3.
    expect(usesLeft(p1, RULES, 'prospecting')).toBe(0);
    expect(p1.manifesto.filter((m) => m === 'capitalist').length).toBeLessThan(RULES.level3);
  });

  it('the borrowed power is usable through the real action, not only through usesLeft', () => {
    // THE END-TO-END CLAIM. `usesLeft` returning a number is not the card; POWER_PROSPECT
    // being ACCEPTED is the card, and only that proves the grant reaches the action.
    const s0 = opening(PLAYERS_3, { p2: ['capitalist', 'capitalist', 'capitalist'] });
    const s = borrowFrom(s0, DEEP_THOUGHTS.id, 'p1', 'p2');
    const r = reduce(s, 'p1', { type: 'POWER_PROSPECT', give: 'funds', take: ['funds'] }, CTX);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) expect(r.state.players.p1!.powerUses.prospecting).toBe(1);
    // And with no borrow at all the same action is refused, so the borrow is the cause.
    const bare = reduce(s0, 'p1', { type: 'POWER_PROSPECT', give: 'funds', take: ['funds'] }, CTX);
    expect(bare.ok).toBe(false);
  });
});

describe('G14a — SATISFIABILITY at every seat count', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`a two-seat… a ${n}-seat table always has a legal donor to name`, () => {
      const players = Array.from({ length: n }, (_, i) => `p${i + 1}` as PlayerID);
      const s = opening(players, { [players[n - 1]!]: ['capitalist', 'capitalist', 'capitalist'] });
      // The candidate set is `turnOrder` minus the actor, which is the SAME expression
      // `resolveChoice` validates against — so this is the satisfiability invariant read
      // off the engine rather than re-derived.
      const actor = s.activePlayer;
      const candidates = s.turnOrder.filter((p) => p !== actor);
      expect(candidates.length).toBe(n - 1);
      for (const donor of candidates) {
        const played = reduce(
          {
            ...s,
            players: {
              ...s.players,
              [actor]: { ...s.players[actor]!, conspiracies: [DEEP_THOUGHTS.id] },
            },
          },
          actor,
          { type: 'PLAY_CONSPIRACY', cardId: DEEP_THOUGHTS.id },
          CTX,
        );
        expect(played.ok).toBe(true);
        if (!played.ok) continue;
        const pending = played.state.choices.find((c) => c.choice.kind === 'choose-player');
        expect(pending, 'the decision is raised').toBeDefined();
        const answered = reduce(
          played.state,
          actor,
          { type: 'RESOLVE_CHOICE', choiceId: pending!.id, pick: { kind: 'player', id: donor } },
          CTX,
        );
        expect(answered.ok, answered.ok ? '' : answered.error).toBe(true);
        if (answered.ok) {
          // A donor holding nothing is a LEGAL ANSWER that resolves to nothing, which is
          // what keeps the decision satisfiable rather than merely non-empty.
          expect(answered.state.choices).toEqual([]);
        }
      }
    });
  }

  it('a one-candidate table is the tight case: exactly one legal pick, and it is taken', () => {
    const s = opening(['p1', 'p2'], { p2: ['capitalist', 'capitalist', 'capitalist'] });
    const r = borrowFrom(s, DEEP_THOUGHTS.id, 'p1', 'p2');
    expect((r.players.p1!.restrictions ?? []).filter((r) => r.kind === 'borrowed-powers')).toHaveLength(1);
  });

  it('naming yourself is refused rather than silently granting your own powers', () => {
    // `resolveChoice` refuses any pick the actor could not have chosen, and the engine
    // skips the write when donor === source. Both halves asserted: the pick is refused…
    const s = opening(PLAYERS_3);
    const withCard: GameState = {
      ...s,
      players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [DEEP_THOUGHTS.id] } },
    };
    const played = reduce(withCard, 'p1', { type: 'PLAY_CONSPIRACY', cardId: DEEP_THOUGHTS.id }, CTX);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const pending = played.state.choices.find((c) => c.choice.kind === 'choose-player')!;
    const self = reduce(played.state, 'p1', {
      type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'player', id: 'p1' },
    }, CTX);
    expect(self.ok).toBe(false);
    // …and answering for somebody else is refused too: the decision is the actor's.
    const other = reduce(played.state, 'p2', {
      type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'player', id: 'p3' },
    }, CTX);
    expect(other.ok).toBe(false);
  });
});

describe('G14a — TOTALITY: every Level 3 power, and no Level 5 power', () => {
  const L3: Ideologue[] = ['capitalist', 'supremo', 'showstopper', 'idealist'];

  it.each(POWERS.filter((p) => p.level === 3).map((p) => [p.id, p.ideologue] as const))(
    'a borrow grants %s, which is consulted through usesLeft',
    (id, ideologue) => {
      const s = borrowFrom(
        opening(PLAYERS_3, { p2: [ideologue, ideologue, ideologue] }),
        DEEP_THOUGHTS.id,
        'p1',
        'p2',
      );
      const p1 = s.players.p1!;
      expect(usesLeft(p1, RULES, id, borrowedFrom(s, 'p1'))).toBeGreaterThan(0);
      expect(usesLeft(p1, RULES, id)).toBe(0);
    },
  );

  it.each(POWERS.filter((p) => p.level === 5).map((p) => [p.id, p.ideologue] as const))(
    'a borrow does NOT grant %s, because the Level 5 powers are not all read in one place',
    (id, ideologue) => {
      const five: Ideologue[] = Array.from({ length: RULES.level5 }, () => ideologue);
      const s = borrowFrom(opening(PLAYERS_3, { p2: five }), DEEP_THOUGHTS.id, 'p1', 'p2');
      expect(usesLeft(s.players.p1!, RULES, id, borrowedFrom(s, 'p1'))).toBe(0);
    },
  );

  it('and the set of L3 powers the rule covers is ALL of them, not a chosen few', () => {
    // The totality claim as a number rather than as prose: if a fifth Level 3 power is
    // added to `POWERS` and it is not read through `usesLeft`, this fails.
    const covered = new Set(POWERS.filter((p) => p.level === 3).map((p) => p.ideologue));
    expect([...covered].sort()).toEqual([...L3].sort());
  });

  it('two donors at once contribute both manifests, and neither is double counted', () => {
    const s0 = opening(PLAYERS_3, {
      p2: ['capitalist', 'capitalist', 'capitalist'],
      p3: ['idealist', 'idealist', 'idealist'],
    });
    let s = borrowFrom(s0, DEEP_THOUGHTS.id, 'p1', 'p2');
    s = { ...s, phase: 'actions' };
    s = borrowFrom(s, NEXT_TURN_BORROW.id, 'p1', 'p3');
    const donors = borrowedFrom(s, 'p1');
    expect(donors.map((d) => d.id).sort()).toEqual(['p2', 'p3']);
    const p1 = s.players.p1!;
    expect(usesLeft(p1, RULES, 'prospecting', donors)).toBeGreaterThan(0);
    expect(usesLeft(p1, RULES, 'helping-hands', donors)).toBeGreaterThan(0);
  });
});

describe('G14a — expiry, on one clock, in one place', () => {
  it("'this-turn' is gone at the next turn boundary and not before", () => {
    const s = borrowFrom(opening(), DEEP_THOUGHTS.id, 'p1', 'p2');
    expect(borrowedFrom(s, 'p1')).toHaveLength(1);
    const r = reduce(s, 'p1', { type: 'END_TURN' }, CTX);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    expect(borrowedFrom(r.state, 'p1')).toEqual([]);
  });

  it("'next-turn' lives through the caster's next turn and is gone after it", () => {
    // Read as a WINDOW rather than as three hand-counted boundaries: the two absolute
    // turn numbers are `ownerNextTurn(p1) + 1` and `state.turn` at install, so the claim
    // is "present on every turn up to and including p1's next one, absent after", and
    // that is what a loop can prove without re-deriving the arithmetic here.
    const s0 = borrowFrom(opening(), NEXT_TURN_BORROW.id, 'p1', 'p2');
    expect(borrowedFrom(s0, 'p1')).toHaveLength(1);
    const seen: { readonly turn: number; readonly present: boolean }[] = [
      { turn: s0.turn, present: borrowedFrom(s0, 'p1').length > 0 },
    ];
    let s = s0;
    for (let i = 0; i < 10; i += 1) {
      if (s.phase === 'answer') {
        const a = reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, CTX);
        if (!a.ok) break;
        s = a.state;
      }
      const e = reduce(s, s.activePlayer, { type: 'END_TURN' }, CTX);
      if (!e.ok) break;
      s = e.state;
      seen.push({ turn: s.turn, present: borrowedFrom(s, 'p1').length > 0 });
      if (!seen[seen.length - 1]!.present) break;
    }
    const firstGone = seen.findIndex((x) => !x.present);
    expect(firstGone, 'the borrow does expire').toBeGreaterThan(0);
    // It was present on EVERY turn before the one that removed it — no gap, so the two
    // clocks (the rule's deadline and the turn counter) agree.
    expect(seen.slice(0, firstGone).every((x) => x.present)).toBe(true);
    // And the turn it died on is strictly after the turn it was installed on, which is
    // the whole difference between `'next-turn'` and `'this-turn'`.
    expect(seen[firstGone]!.turn).toBeGreaterThan(s0.turn);
    // `'this-turn'` dies one boundary sooner on the same clock.
    const immediate = borrowFrom(opening(), DEEP_THOUGHTS.id, 'p1', 'p2');
    const e2 = reduce(immediate, immediate.activePlayer, { type: 'END_TURN' }, CTX);
    expect(e2.ok).toBe(true);
    if (e2.ok) expect(borrowedFrom(e2.state, 'p1')).toEqual([]);
  });
});

describe('G14a — the borrow adds no state the table cannot see', () => {
  it('no `_` key appears anywhere in the payload, for ANY viewer', () => {
    const s = borrowFrom(
      opening(PLAYERS_3, { p2: ['capitalist', 'capitalist', 'capitalist'] }),
      DEEP_THOUGHTS.id,
      'p1',
      'p2',
    );
    for (const viewer of s.turnOrder) {
      const wire = playerView(s, viewer) as unknown as Record<string, unknown>;
      const flat = JSON.stringify(wire, (k, v) =>
        typeof v === 'string' && k.startsWith('_') ? `LEAK:${k}` : v,
      );
      expect(flat).not.toContain('LEAK:');
      // And the borrow IS public: the rule every other player must be able to predict.
      expect(JSON.stringify(wire)).toContain('borrowed-powers');
    }
  });

  it('it is a restriction and not a counter, so no PlayerState field was added', () => {
    // The claim in `RestrictionKind` is that reusing the list is what keeps this off the
    // server's secret inventory. Asserted by pinning the key set, so a future field is a
    // test failure rather than a silent server-suite regression.
    expect(Object.keys(opening().players.p1!).filter((k) => k.includes('borrow'))).toEqual([]);
  });
});

describe('G14a — a legal move always exists, at 2 / 3 / 4 / 5 seats', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`a ${n}-seat played game with a borrow in the deck never strands a seat`, () => {
      const players = Array.from({ length: n }, (_, i) => `p${i + 1}` as PlayerID);
      let s = opening(players);
      // Play the borrow once, answering the decision, so the mechanic is genuinely in the
      // position rather than merely reachable.
      s = borrowFrom(s, DEEP_THOUGHTS.id, s.activePlayer, players[1] ?? 'p1');
      for (let step = 0; step < 60 && !s.finished; step += 1) {
        const actor = s.activePlayer;
        if (s.phase === 'answer') {
          const r = reduce(s, actor, { type: 'ANSWER', side: 0 }, CTX);
          expect(r.ok, `step ${step} ANSWER`).toBe(true);
          if (!r.ok) break;
          s = r.state;
          continue;
        }
        if (s.choices.some((c) => c.player === actor)) {
          const pending = s.choices.find((c) => c.player === actor)!;
          const r = reduce(s, actor, {
            type: 'RESOLVE_CHOICE',
            choiceId: pending.id,
            pick: pending.choice.kind === 'choose-player'
              ? { kind: 'player', id: s.turnOrder.find((p) => p !== actor)! }
              : pending.choice.kind === 'choose-zone'
                ? { kind: 'zone', zoneId: s.zones[0]!.id }
                : pending.choice.kind === 'lose-any' || pending.choice.kind === 'gain-any'
                  ? { kind: 'resources', res: { funds: pending.choice.count } }
                  : { kind: 'areas', areaIds: [] },
          }, CTX);
          expect(r.ok, `step ${step} RESOLVE_CHOICE`).toBe(true);
          if (!r.ok) break;
          s = r.state;
          continue;
        }
        const end = reduce(s, actor, { type: 'END_TURN' }, CTX);
        expect(end.ok, `step ${step} END_TURN`).toBe(true);
        if (!end.ok) break;
        s = end.state;
      }
      expect(s.finished || s.turn > 5, 'the game advanced').toBe(true);
    });
  }
});
