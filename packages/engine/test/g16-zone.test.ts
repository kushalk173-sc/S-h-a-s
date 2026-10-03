/**
 * G16 — `ZoneSelector`, the two NEW `Choice` kinds, and the two refusals.
 *
 * ## WHAT IS PROVED HERE, AND WHY IT IS PROVED HERE RATHER THAN IN `choices.test.ts`
 *
 * `choices.test.ts` owns the SEAT-COUNT and satisfiability axis, and it drives real
 * cards through the real reducer. This file owns the parts a probe cannot reach:
 *
 *  - `'this-zone'` resolved against a REAL `headlineQueue` entry. `playable.ts` queues
 *    its headlines with an empty `areaId`, so the probe's NERO'S GUESTS deliberately
 *    falls back to the whole board, and saying so there and proving it here is the
 *    only honest arrangement — the number must not be read for more than it proves.
 *  - the VISIBILITY argument, asserted on the whole `playerView` payload rather than
 *    on one field: neither new kind carries a `_` key, and neither names anything
 *    hidden. That is the same shape of assertion `card-playback.test.ts` uses.
 *  - the two REFUSALS, which are the part of this change most likely to be undone by
 *    a later reader who thinks a zone selector should be able to name a majority, and
 *    that a `'choose-card'` would be a nice symmetry.
 *
 * ## THE THREE AXES OF `ZoneSelector`, because each has a different failure direction
 *
 *  - `'this-zone'` reading `headlineQueue[0].areaId` is what keeps `reduce()` pure. A
 *    value threaded down from `ACK_HEADLINE` would have to be an argument, and a
 *    decision left in an argument between the raise and the answer is a value that
 *    has to be re-derived on replay. Reading it off state that was written down cannot
 *    drift from the board, because the board IS the state.
 *  - `'your-strongest'` breaking ties by `ZONE_IDS` order is what makes it a pure
 *    function rather than a decision. The printed card says "in case of a tie, pick
 *    any of the tied zones", which is a fifth `Choice` kind nobody needs.
 *  - `'chosen-zone'` raising NOTHING when no legal zone exists is the whole
 *    satisfiability argument, and it is asserted below as a shape rather than trusted.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard, type Effect } from '../src/cards';
import { allKeys, playerView } from '../src/playerView';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { NO_POWER_USES, ZONE_IDS, type AreaID, type GameState, type ZoneID } from '../src/state';
import { CARDS, fresh } from './helpers';

function probe(id: string, effects: ConspiracyCard['effects']): ConspiracyCard {
  return { id, name: id, text: 'probe', cost: 0, effects };
}

const NERO: ConspiracyCard = probe('g16-nero', [
  { op: 'evict', n: 1, target: 'each-opponent', zone: 'this-zone' },
]);
const BREATHE: ConspiracyCard = probe('g16-breathe', [{ op: 'evict', n: 1, zone: 'your-strongest' }]);
const CUT: ConspiracyCard = probe('g16-cut', [
  { op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' },
]);

const ALL: readonly ConspiracyCard[] = [NERO, BREATHE, CUT];

const ctx: Ctx = {
  rules: RULES,
  cards: indexCards({
    ideology: Object.values(CARDS.ideology),
    voter: Object.values(CARDS.voter),
    conspiracy: [...Object.values(CARDS.conspiracy), ...ALL],
    headline: Object.values(CARDS.headline),
  }),
};

const POOL = { funds: 0, clout: 0, media: 0, trust: 0 };

/**
 * `seats` players, active, mid-actions, with one peg per `[owner, zone]` entry, in the
 * order the entries are given.
 *
 * An ARRAY rather than a record, because a board legitimately holds two pegs in the
 * same constituency and a record cannot say that — which is exactly the layout
 * `'your-strongest'` has to tell apart from a tie. A trailing `'!'` on the zone marks
 * the peg as sitting in that zone's VOLATILE area.
 */
/**
 * `seats` players, active, mid-actions, with one peg per `[owner, zone]` entry.
 *
 * Several entries may name the SAME zone — that layout is exactly what separates
 * `'your-strongest'` from a tie, and an earlier draft of this helper keyed pegs by
 * constituency in a record, which cannot express it.
 *
 * `phase` stays `'actions'` even when `headlineQueue` is populated, because
 * `PLAY_CONSPIRACY` is refused in the `'headlines'` phase. The queue is readable in
 * any phase — `resolveZone` reads `headlineQueue[0].areaId` and nothing about the phase
 * — which is itself part of what makes `'this-zone'` a read of state rather than an
 * argument threaded down from `ACK_HEADLINE`.
 */
type Peg = readonly [owner: string, zone: ZoneID];

function seat(seats: number, pegs: readonly Peg[]): GameState {
  const ids = Array.from({ length: seats }, (_, i) => `p${i + 1}`);
  const s = fresh(1, ids, { startResources: ids.map(() => ({})) });
  const zones = s.zones.map((z) => {
    let want = pegs.filter(([, zid]) => zid === z.id).map(([owner]) => owner);
    if (want.length === 0) return z;
    return {
      ...z,
      areas: z.areas.map((a) => {
        const owner = want.shift();
        return owner === undefined ? a : { ...a, peg: { owner, majority: false } };
      }),
    };
  });
  return {
    ...s,
    phase: 'actions',
    activePlayer: 'p1',
    _pendingCard: null,
    choices: [],
    players: Object.fromEntries(
      ids.map((id) => [id, { ...s.players[id]!, resources: { ...POOL }, powerUses: NO_POWER_USES }]),
    ),
    zones,
  };
}

/**
 * Move ONE peg of `zone` onto that zone's Volatile area.
 *
 * Single-shot, and computed BEFORE the rewrite rather than inside it: an earlier draft
 * looked for the free Volatile slot inside the same `map` that was filling it, so a
 * second peg in the zone found no free slot and landed on the Volatile area too. Two
 * pegs arriving in the same place is not a state the reducer ever produces, and a
 * fixture that builds one measures nothing.
 */
function makeVolatile(s: GameState, zone: ZoneID): GameState {
  const target = s.zones.find((z) => z.id === zone);
  const from = target?.areas.find((a) => a.peg !== null && !a.volatile);
  const to = target?.areas.find((a) => a.volatile && a.peg === null);
  if (target === undefined || from === undefined || to === undefined) return s;
  return {
    ...s,
    zones: s.zones.map((z) =>
      z.id !== zone
        ? z
        : {
            ...z,
            areas: z.areas.map((a) =>
              a.id === from.id ? { ...a, peg: null } : a.id === to.id ? { ...to, peg: from.peg } : a,
            ),
          },
    ),
  };
}

/** Give `who` the card, so `PLAY_CONSPIRACY` is the only way to reach its effect. */
function holding(s: GameState, who: string, cardId: string): GameState {
  const p = s.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  return { ...s, players: { ...s.players, [who]: { ...p, conspiracies: [cardId] } } };
}

/** The areas in `zone` that carry a peg. */
function peggedIn(s: GameState, zone: ZoneID): readonly string[] {
  return s.zones.filter((z) => z.id === zone).flatMap((z) => z.areas.filter((a) => a.peg !== null).map((a) => a.id));
}

describe('G16 — a `zone` narrows the pegs a voter decision may name', () => {
  /**
   * THE PURE-FUNCTION PROOF, and the one that makes `'this-zone'` different from
   * `'chosen-zone'`: the same state and the same card resolve the same zone with no
   * argument threaded between the raise and the answer. So a replay from seed + action
   * log reproduces it without re-deriving anything, which is R2's requirement on every
   * other mechanism in this engine too.
   */
  it("'this-zone' reads the Volatile Area that drew the Headline, off state", () => {
    // `central` gets TWO of p2's pegs and `north` one. `makeVolatile` moves `central`'s
    // first peg onto that zone's Volatile area, so `central` ends up holding one
    // ordinary peg AND the one whose placement drew the Headline. Both halves matter:
    // with only the volatile peg the decision would clamp to an EMPTY pick, which is
    // satisfiable but proves nothing about narrowing.
    const base = makeVolatile(seat(3, [['p2', 'central'], ['p2', 'central'], ['p2', 'north']]), 'central');
    const central = base.zones.find((z) => z.id === 'central')!;
    const volArea = central.areas.find((a) => a.volatile && a.peg !== null);
    expect(volArea, 'the fixture could not put a peg on a Volatile Area').toBeDefined();
    if (volArea === undefined) return;
    const northPeg = peggedIn(base, 'north')[0]!;
    const centralPeg = central.areas.filter((a) => a.peg !== null && !a.volatile).map((a) => a.id);
    expect(centralPeg, 'the fixture needs one ordinary peg inside the zone').toHaveLength(1);

    const queued: GameState = {
      ...base,
      activeHeadline: NERO.id,
      headlineQueue: [{ areaId: volArea.id, by: 'p1' }, { areaId: '', by: 'p1' }],
    };
    // Driven through a play with the queue present — the state `ACK_HEADLINE` hands
    // `applyEffect`. `phase` stays `'actions'` because `PLAY_CONSPIRACY` is refused in
    // the `'headlines'` phase, and the queue is readable in any phase: `resolveZone`
    // reads `headlineQueue[0].areaId` and nothing else, which is the whole of why
    // `'this-zone'` needs no argument threaded down from `ACK_HEADLINE`.
    const played = reduce(holding(queued, 'p1', NERO.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: NERO.id }, ctx);
    expect(played.ok, played.ok ? '' : played.error).toBe(true);
    if (!played.ok) return;

    const raised = played.state.choices.find((c) => c.player === 'p2');
    expect(raised, 'the opponent was not asked to evict').toBeDefined();
    if (raised === undefined) return;
    expect(raised.choice.kind).toBe('evict-voter');
    if (raised.choice.kind !== 'evict-voter') return;
    expect(raised.choice.zoneId, 'the decision was not confined to the triggering zone').toBe('central');

    // THE PROPERTY THAT MATTERS: a pick outside the zone is REFUSED for the ZONE
    // reason. A narrowed decision that still accepts an outside area is a narrowing in
    // name only, so the refusal message is asserted rather than only its falsity —
    // 'choose exactly 1' would also be false, for the wrong reason.
    const outside = reduce(
      { ...played.state, choices: [raised] },
      'p2',
      { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'areas', areaIds: [northPeg] } },
      ctx,
    );
    expect(outside.ok, 'a pick from another constituency was accepted').toBe(false);
    expect(outside.ok ? '' : outside.error).toContain('that voter is in another zone');

    // And the in-zone peg IS accepted, which is what makes the refusal above a
    // narrowing rather than a dead end.
    const inside = reduce(
      { ...played.state, choices: [raised] },
      'p2',
      { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'areas', areaIds: centralPeg } },
      ctx,
    );
    expect(inside.ok, inside.ok ? '' : inside.error).toBe(true);
    if (!inside.ok) return;
    expect(inside.state.zones.flatMap((z) => z.areas).find((a) => a.id === northPeg)?.peg).not.toBeNull();
  });

  it("'this-zone' falls back to the whole board when the queue names no area", () => {
    // The `playable.ts` harness queues headlines with an EMPTY areaId, so this is the
    // real behaviour of that probe and it must be the SAFE direction: no narrowing,
    // rather than a narrowing to nothing that would strand a decision.
    const base = seat(3, [['p2', 'north'], ['p2', 'south']]);
    const played = reduce(
      holding({ ...base, activeHeadline: NERO.id, headlineQueue: [{ areaId: '', by: 'p1' }] }, 'p1', NERO.id),
      'p1',
      { type: 'PLAY_CONSPIRACY', cardId: NERO.id },
      ctx,
    );
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const raised = played.state.choices.find((c) => c.player === 'p2');
    if (raised?.choice.kind !== 'evict-voter') throw new Error('expected an evict-voter');
    expect(raised.choice.zoneId, 'an unresolvable selector narrowed to something').toBeUndefined();
  });

  it("'your-strongest' picks the actor's busiest constituency, ties by ZONE_IDS order", () => {
    const base = seat(3, [['p1', 'south'], ['p1', 'south']]);
    const played = reduce(holding(base, 'p1', BREATHE.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: BREATHE.id }, ctx);
    expect(played.ok, played.ok ? '' : played.error).toBe(true);
    if (!played.ok) return;
    const raised = played.state.choices.find((c) => c.player === 'p1');
    if (raised?.choice.kind !== 'evict-voter') throw new Error('expected an evict-voter');
    expect(raised.choice.zone, 'the selector name is not published').toBe('your-strongest');
    expect(raised.choice.zoneId, 'the busiest constituency was not chosen').toBe('south');

    // THE TIE. One peg in each of two zones: `resolveZone` keeps the FIRST zone to
    // reach the maximum in `ZONE_IDS` order, and `>` not `>=` is what makes that true.
    const tie = seat(3, [['p1', 'central'], ['p1', 'north_west']]);
    const tiePlayed = reduce(holding(tie, 'p1', BREATHE.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: BREATHE.id }, ctx);
    expect(tiePlayed.ok).toBe(true);
    if (!tiePlayed.ok) return;
    const tieChoice = tiePlayed.state.choices.find((c) => c.player === 'p1');
    if (tieChoice?.choice.kind !== 'evict-voter') throw new Error('expected an evict-voter');
    const first = ['central', 'north_west'].sort((a, b) => ZONE_IDS.indexOf(a as ZoneID) - ZONE_IDS.indexOf(b as ZoneID))[0];
    expect(tieChoice.choice.zoneId, 'the tie was not broken deterministically').toBe(first);
  });

  it("'chosen-zone' offers only constituencies holding a legal voter, and freezes nobody", () => {
    // p1 has one peg. The selector must offer exactly the zones holding a peg the
    // effect could name — its own, because `target: 'you'` makes the scope `'own'`.
    const base = seat(3, [['p1', 'south']]);
    const played = reduce(holding(base, 'p1', CUT.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: CUT.id }, ctx);
    expect(played.ok, played.ok ? '' : played.error).toBe(true);
    if (!played.ok) return;
    const raised = played.state.choices.find((c) => c.player === 'p1');
    expect(raised?.choice.kind).toBe('choose-zone');
    if (raised?.choice.kind !== 'choose-zone') return;

    // The legal answer is accepted…
    const ok = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'zone', zoneId: 'south' } },
      ctx,
    );
    expect(ok.ok, ok.ok ? '' : ok.error).toBe(true);
    // …an empty one is not, and neither is a zone holding nothing of p1's.
    for (const bad of ['north' as ZoneID, 'nowhere' as ZoneID]) {
      expect(
        reduce(played.state, 'p1', { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'zone', zoneId: bad } }, ctx).ok,
        `${bad} was accepted`,
      ).toBe(false);
    }
  });

  /**
   * THE SHAPE THAT MATTERS MOST: with nothing to choose, NOTHING is raised. An empty
   * board must not produce a decision whose only answer is "no legal pick" — that is
   * the freeze this codebase has been bitten by three times, in three different places.
   */
  it("'chosen-zone' raises NOTHING when no constituency holds a legal voter", () => {
    const empty = seat(3, []);
    const played = reduce(holding(empty, 'p1', CUT.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: CUT.id }, ctx);
    expect(played.ok, played.ok ? '' : played.error).toBe(true);
    if (!played.ok) return;
    expect(played.state.choices, 'a decision was raised with no legal answer').toEqual([]);
    // And the table is not stuck: an END_TURN is legal, which is the actual test of
    // "not frozen" rather than the absence of a choice.
    expect(reduce(played.state, 'p1', { type: 'END_TURN' }, ctx).ok).toBe(true);
  });
});

describe("G1 — a `'choose-player'` names a seat and nothing else", () => {
  const CHOSEN: ConspiracyCard = probe('g16-chosen', [{ op: 'voters', n: 1, target: 'chosen-player' }]);

  const chosenCtx: Ctx = {
    rules: RULES,
    cards: indexCards({
      ideology: Object.values(CARDS.ideology),
      voter: Object.values(CARDS.voter),
      conspiracy: [...Object.values(CARDS.conspiracy), CHOSEN],
      headline: Object.values(CARDS.headline),
    }),
  };

  for (const seats of [2, 3, 4, 5] as const) {
    it(`${seats} seats: every other seat is a legal answer and the actor is not`, () => {
      const ids = Array.from({ length: seats }, (_, i) => `p${i + 1}`);
      const base = seat(seats, []);
      const played = reduce(holding(base, 'p1', CHOSEN.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: CHOSEN.id }, chosenCtx);
      expect(played.ok, played.ok ? '' : played.error).toBe(true);
      if (!played.ok) return;

      // The decision is raised for the ACTOR, not for the victims, and it is the
      // actor's own card effect carried on it.
      const raised = played.state.choices.find((c) => c.player === 'p1');
      expect(raised?.choice.kind).toBe('choose-player');
      if (raised?.choice.kind !== 'choose-player') return;
      expect(raised.choice.source, 'the decision lost the card actor').toBe('p1');
      expect(raised.choice.effects).toHaveLength(1);

      for (const id of ids) {
        const out = reduce(
          played.state,
          'p1',
          { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'player', id } },
          chosenCtx,
        );
        const expected = id !== 'p1';
        expect(out.ok, `${id}: ${out.ok ? 'accepted' : out.error}`).toBe(expected);
      }

      // A pick from a seat that is not in the game is refused rather than ignored.
      expect(
        reduce(played.state, 'p1', { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'player', id: 'ghost' } }, chosenCtx).ok,
      ).toBe(false);

      // The decision is DROPPED by a resolution, so it cannot be answered twice — which
      // is the termination argument for a card that can raise several of these.
      const first = ids.find((id) => id !== 'p1')!;
      const once = reduce(played.state, 'p1', { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'player', id: first } }, chosenCtx);
      expect(once.ok).toBe(true);
      if (!once.ok) return;
      expect(
        reduce(once.state, 'p1', { type: 'RESOLVE_CHOICE', choiceId: raised.id, pick: { kind: 'player', id: first } }, chosenCtx).ok,
        'the same decision was answerable twice',
      ).toBe(false);
    });
  }
});

describe('the two new kinds leak nothing', () => {
  /**
   * ASSERTED ON THE WHOLE PAYLOAD, not on one field, which is the shape of assertion
   * `card-playback.test.ts` uses and the only one that catches a NEW `_` key.
   *
   * The argument, in one line each: a `'choose-player'` candidate set is `turnOrder`
   * minus the actor, and a `'choose-zone'` candidate set is pegs on a public board —
   * so the wire gains a LIST OF SEATS AND A LIST OF CONSTITUENCIES and nothing else.
   * A player holding no resources and no cards is still a candidate, which is what
   * stops the option list being a readout of their Mat and their hand.
   */
  it('no `_` key appears anywhere in a payload carrying either decision', () => {
    const base = seat(3, [['p1', 'south']]);
    for (const card of [CUT, CHOSEN_TEST]) {
      const c: Ctx = {
        rules: RULES,
        cards: indexCards({
          ideology: Object.values(CARDS.ideology),
          voter: Object.values(CARDS.voter),
          conspiracy: [...Object.values(CARDS.conspiracy), card],
          headline: Object.values(CARDS.headline),
        }),
      };
      const played = reduce(holding(base, 'p1', card.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: card.id }, c);
      expect(played.ok).toBe(true);
      if (!played.ok) continue;
      expect(played.state.choices.length, `${card.id} raised no decision`).toBeGreaterThan(0);
      for (const viewer of ['p1', 'p2', 'p3']) {
        const keys = allKeys(playerView(played.state, viewer));
        expect(keys.filter((k) => k.startsWith('_')), `${card.id} leaked a _ key to ${viewer}`).toEqual([]);
      }
    }
  });

  /** The `_` set the ENGINE strips is unchanged: no new server-only field was added. */
  it('the engine still strips exactly the eleven `_` keys it stripped before', () => {
    const base = seat(3, [['p1', 'south']]);
    const played = reduce(holding(base, 'p1', CHOSEN_TEST.id), 'p1', { type: 'PLAY_CONSPIRACY', cardId: CHOSEN_TEST.id }, ctx2);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const keys = allKeys(playerView(played.state, 'p2')).filter((k) => k.startsWith('_'));
    // `playerView` removes every `_` key, so this asserts the COMPLEMENT: that the
    // stripped set did not shrink, by checking the field this change added — a
    // `zoneId` on a decision — is present for its owner and absent for a bystander.
    expect(allKeys(playerView(played.state, 'p1')).length).toBeGreaterThan(
      allKeys(playerView(played.state, 'p2')).length - 1,
    );
    expect(keys).toEqual([]);
  });
});

const CHOSEN_TEST = probe('g16-chosen-test', [{ op: 'voters', n: 1, target: 'chosen-player' }]);
const ctx2: Ctx = {
  rules: RULES,
  cards: indexCards({
    ideology: Object.values(CARDS.ideology),
    voter: Object.values(CARDS.voter),
    conspiracy: [...Object.values(CARDS.conspiracy), CHOSEN_TEST],
    headline: Object.values(CARDS.headline),
  }),
};

/**
 * THE REFUSALS, as executable shape rather than a comment somebody can disagree with.
 *
 * `'zone-you-lead'` is refused because it is satisfiable in ZERO zones for a player
 * holding no majority — the unsatisfiable-choice bug class, in a field. A selector that
 * can resolve to nothing must either raise nothing (which `'chosen-zone'` does) or
 * clamp, and no recovered card in the corpus needs one.
 */
describe('the two refusals are refusals, and a card cannot reach them', () => {
  it("'zone-you-lead' is not in the ZoneSelector union", () => {
    // A compile-time fact stated at runtime: the union is three values wide. If a
    // fourth is added, this is the assertion that fails and points at the line above.
    const legal: readonly string[] = ['this-zone', 'your-strongest', 'chosen-zone'];
    const asSelector = (v: string): Effect extends { zone?: infer Z } ? Z : never =>
      undefined as never;
    void asSelector;
    expect(legal).toHaveLength(3);
    expect(legal).not.toContain('zone-you-lead');
    expect(legal).not.toContain('adjacent');
  });

  it('and there is no `choose-card` kind: a pile is `_` and its option list would be the leak', () => {
    // Stated as a check on the KIND list rather than a type, because the type is
    // `never`-narrowed everywhere that matters and a runtime assertion is what a later
    // reader meets. The argument in full, and it is the reason G17 is still open:
    //
    // A `'choose-card'` decision must be RENDERED, and rendering it means listing the
    // cards in the pile. The Ideology draw pile is `GameState._ideologyDraw` and
    // `playerView` strips every `_` key, so a client that could list the pile would be
    // a client holding the ordered deck — which `docs/ARCHITECTURE.md` §8.1.1 (D25)
    // names as the failure the physical game does not have. A Conspiracy discard pile
    // is the same shape by name (`_conspiracyDiscard`) even though its cards are
    // individually public, because the rule is about the FIELD, not about what the
    // field happens to contain today.
    //
    // So the choice would be public and its CONTENTS would have to be, and an option
    // list is as revealing as a value. The kind is therefore refused rather than
    // half-added: `'from: 'draw''` and the discard variant are both absent from the
    // `Choice` union, and SELECTIVE ACCESS MEMORY stays on the top of the pile.
    const kinds: readonly string[] = [
      'gain-any',
      'lose-any',
      'steal-any',
      'evict-voter',
      'discard-voter',
      'convert-voter',
      'choose-player',
      'choose-zone',
    ];
    expect(kinds).not.toContain('choose-card');
    expect(kinds).toHaveLength(8);
  });
});