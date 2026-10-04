/**
 * G17, WIDENED — a `'choose-card'` decision over the VOTER CARD MARKET.
 *
 * `card-transfer.test.ts` pins the mechanic of a card moving between places. This file
 * pins the other thing a card decision can do, which is not move a card but NAME one:
 * `Choice`'s `'choose-card'` arm is an allow-list of PUBLIC SETS, `pool` names which of
 * them a given decision is over, and this file is the proof that the second member of
 * that list is safe and that the two can never be mixed.
 *
 * ## WHY THE MARKET AND NOT A THIRD PILE
 *
 * The market is already public, and that is the whole reason it needs **no new server
 * projection**: `GameState.market` is unprefixed, is not in `PRIVATE_PLAYER_KEYS`, and
 * rides every client payload with its slot order intact. Every id a market decision
 * offers is a card every viewer is already looking at, so the OPTION LIST — which is as
 * revealing as a value, and is the disclosure §2bis is about — discloses nothing.
 *
 * The four sets that are still refused are refused for reasons written on `CardPool`:
 * a hidden hand, and the four `_`-prefixed piles. The Voter pile BENEATH the market is
 * one of them, and the market's presence in the union is not a hole in that refusal: it
 * is the difference between the mat and the deck under it.
 *
 * ## WHAT IS ASSERTED, and why each is not the same claim twice
 *
 *  - the offer IS the market, in slot order, and the payload is otherwise untouched;
 *  - no offered id is in any `_` pile or any hand, and none is `_`-prefixed;
 *  - a pick outside the OFFER is refused, and a market id offered to a RECYCLE decision
 *    (and the reverse) is refused — the no-mixing property, asserted from both sides;
 *  - an EMPTY market raises NOTHING, which is the anti-soft-lock half.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard } from '../src/cards';
import { playerView } from '../src/playerView';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { ideologyHandOf, type GameState, type PlayerID } from '../src/state';
import { CARDS, PLAYERS_3, VOTER_CARDS } from './helpers';

// ─────────────────────────── fixtures ───────────────────────────

/** `{ op: 'take-voter', pick: true }` — the shape that enumerates the market. */
const TAKE_CHOSEN: ConspiracyCard = {
  id: 'pool-take-chosen',
  name: 'Take One Of Your Choosing',
  text: 'Take a Voter Card from the market.',
  cost: 0,
  effects: [{ op: 'take-voter', n: 1, pick: true }],
};

/** `{ op: 'draw-conspiracy', from: 'discard', pick: true }` — G17's original set. */
const PICK_RECYCLE: ConspiracyCard = {
  id: 'pool-pick-recycle',
  name: 'Pick From The Discard Pile',
  text: 'Pick a Conspiracy Card from the recycle pile.',
  cost: 0,
  effects: [{ op: 'draw-conspiracy', n: 1, from: 'discard', pick: true }],
};

const POOL_CARDS: readonly ConspiracyCard[] = [TAKE_CHOSEN, PICK_RECYCLE];

function poolCards(): CardIndex {
  return indexCards({
    ideology: Object.values(CARDS.ideology),
    voter: [...VOTER_CARDS],
    conspiracy: [...POOL_CARDS],
    headline: Object.values(CARDS.headline),
  });
}

const CTX: Ctx = { rules: RULES, cards: poolCards() };

/**
 * p1 on their own turn, holding `cardId`, with the market as given.
 *
 * `phase: 'actions'` and a null `_pendingCard` are what a Conspiracy Card needs to be
 * playable at all, and `conspiracyDeck` is exactly the two fixtures so no shuffle can put
 * an unwanted card in the actor's hand.
 *
 * **THE MARKET IS `setup()`'s OWN, or empty with the whole pile put back.** A fixture that
 * overwrote `market` with made-up ids while leaving `setup()`'s `_voterDraw` alone would
 * put the SAME card on the mat and in the pile beneath it, and then
 * `_voterDraw not.toContain(offeredId)` would fail for a reason that has nothing to do
 * with the engine — `card-transfer.test.ts`'s `withDraw` header names that exact trap.
 * So: a full market is the one `setup()` dealt, and an empty one is the same six cards
 * all in `_voterDraw`, which is what "the mat is bare" really is.
 */
function staging(who: PlayerID, cardId: string, market: 'full' | 'empty' = 'full'): GameState {
  const base = setup({
    players: PLAYERS_3,
    cards: poolCards(),
    seed: 4,
    ideologyDeck: Object.keys(CARDS.ideology),
    voterDeck: VOTER_CARDS.map((c) => c.id),
    conspiracyDeck: POOL_CARDS.map((c) => c.id),
  });
  const p = base.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  const bare = market === 'empty';
  return {
    ...base,
    phase: 'actions',
    _pendingCard: null,
    market: bare ? [] : base.market,
    _voterDraw: bare ? VOTER_CARDS.map((c) => c.id) : base._voterDraw,
    players: {
      ...base.players,
      [who]: { ...p, conspiracies: [cardId], resources: { funds: 9, clout: 0, media: 0, trust: 0 } },
    },
  };
}

/** The market `staging('full')` deals, in slot order. */
function matOf(s: GameState): readonly string[] {
  return s.market.map((slot) => slot.cardId);
}

function play(s: GameState, cardId: string) {
  return reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId }, CTX);
}

/**
 * The one open decision, or a thrown error — every fixture here raises at most one.
 *
 * The `choice` is re-read into a local before the narrowing so the RETURNED type keeps
 * it: narrowing a property of the value you return does not narrow the return type, and
 * every call site here reads `pool` and `cards` off it.
 */
function open(s: GameState) {
  const c = s.choices[0];
  if (c === undefined) throw new Error('no decision was raised');
  const choice = c.choice;
  if (choice.kind !== 'choose-card') throw new Error(`not a choose-card: ${choice.kind}`);
  return { ...c, choice };
}

/** The payload as a string, which is what a devtools user actually reads. */
function payload(s: GameState, viewer: PlayerID): string {
  return JSON.stringify(playerView(s, viewer));
}

// ─────────────────────────── the market ───────────────────────────

describe('G17 - a decision over the PUBLIC VOTER CARD MARKET', () => {
  it('offers EXACTLY the market cards, in slot order', () => {
    const before = staging('p1', TAKE_CHOSEN.id);
    const mat = matOf(before);
    expect(mat.length, 'p10: three cards must always be available').toBe(3);
    const played = play(before, TAKE_CHOSEN.id);
    expect(played.ok, 'the picking card must resolve').toBe(true);
    if (!played.ok) return;

    const pending = open(played.state);
    expect(pending.choice.pool, 'the decision names WHICH public set it is over').toBe('voter-market');
    expect(pending.choice.cards, 'the offer is the market, in slot order').toEqual(mat);
    expect(pending.player, 'and it is owed by the resolved recipient').toBe('p1');
    // Nothing was taken while the decision is open — which is the whole difference
    // between a pick and a draw.
    expect(matOf(played.state)).toEqual(mat);
  });

  it('the payload is otherwise UNCHANGED: the decision is the only difference', () => {
    const before = staging('p1', TAKE_CHOSEN.id);
    const played = play(before, TAKE_CHOSEN.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    // **BYTE-IDENTICAL once the decision and the play line are removed**, for every
    // viewer. That is the strongest form of "the offer publishes nothing": not "the offer
    // happens to be ids the client already had" but "the world a client sees is the same
    // world, plus a dialog". The `Played` line is scrubbed because it is public by
    // construction, and it is asserted separately below so the scrub cannot hide it.
    const scrubbed = (s: GameState, viewer: PlayerID): string => {
      const v = playerView(s, viewer);
      return JSON.stringify({
        ...v,
        choices: [],
        log: v.log.filter((l) => !l.text.startsWith('Played ')),
      });
    };
    const viewers = [...played.state.turnOrder, 'nobody' as PlayerID];
    expect(viewers.length).toBe(4);
    for (const viewer of viewers) {
      expect(scrubbed(played.state, viewer), `${String(viewer)}: raising changed the world`).toBe(
        scrubbed(before, viewer),
      );
      // And the positive form of the same claim: every offered id was ALREADY in that
      // viewer's payload, because `GameState.market` is on it.
      const json = payload(before, viewer);
      for (const id of matOf(before)) expect(json, `${String(viewer)} could not see ${id}`).toContain(id);
    }
    // The one legitimate difference is the card the player played, which is public by
    // construction and is the only new log line.
    const fresh = played.state.log.map((l) => l.text).filter((t) => !before.log.map((l) => l.text).includes(t));
    expect(fresh).toEqual(['Played "Take One Of Your Choosing".']);
  });

  it('NO offered id is a `_` id, and none is in any hidden pile or any hand', () => {
    // A Voter Card hand does not exist, so the only place a market id could hide is a
    // `_` pile — and the market's own draw pile is the one that matters, because the
    // market sits ON it and a card in it has never been face up.
    const played = play(staging('p1', TAKE_CHOSEN.id), TAKE_CHOSEN.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const offered = open(played.state).choice.cards;

    for (const id of offered) {
      expect(id.startsWith('_'), `${id} is a server-only id`).toBe(false);
      expect(played.state._voterDraw, `${id} is in the pile beneath the market`).not.toContain(id);
      expect(played.state._ideologyDraw).not.toContain(id);
      expect(played.state._conspiracyDraw).not.toContain(id);
      expect(played.state._ideologyDiscard).not.toContain(id);
      expect(played.state._conspiracyDiscard).not.toContain(id);
      expect(played.state._headlineDraw).not.toContain(id);
      for (const p of played.state.turnOrder) {
        expect(ideologyHandOf(played.state.players[p]), `${id} is in a hidden hand`).not.toContain(id);
        expect(played.state.players[p]?.conspiracies, `${id} is in a Conspiracy hand`).not.toContain(id);
      }
    }
    // And the offer is IN the market, which is the positive statement of the same thing.
    expect(new Set(offered)).toEqual(new Set(matOf(played.state)));
    // The contrast that keeps this from being vacuous: the pile beneath the mat really
    // does hold cards, and none of them is on offer.
    expect(played.state._voterDraw.length, 'the fixture must have a pile under the mat').toBeGreaterThan(0);
  });

  it('accepts a member of the offer and REFUSES anything else', () => {
    const before = staging('p1', TAKE_CHOSEN.id);
    const mat = matOf(before);
    const played = play(before, TAKE_CHOSEN.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const pending = open(played.state);
    const named = before.market[2];
    if (!named) throw new Error('no third slot');

    // NOT OFFERED, and asked FIRST so the decision is still open. A card that was never
    // in the dialog — including one that is in the pile beneath the mat, i.e. the very
    // thing §2bis refuses to publish — must be REFUSED, not silently swapped for another
    // card, and the refusal must leave the decision open so the player can still answer.
    const stranger = VOTER_CARDS.map((c) => c.id).find((id) => !mat.includes(id));
    if (stranger === undefined) throw new Error('no unoffered card in the fixture');
    const unoffered = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId: stranger } },
      CTX,
    );
    expect(unoffered.ok, `an unoffered card (${stranger}) was accepted`).toBe(false);
    if (!unoffered.ok) expect(unoffered.error).toBe('that card was not one of the options');
    expect(played.state.choices.map((c) => c.id), 'the refusal closed the dialog').toEqual([pending.id]);

    // THE MIDDLE SLOT, which no deterministic take could ever reach.
    const answered = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId: named.cardId } },
      CTX,
    );
    expect(answered.ok, 'naming a member of the offer must be accepted').toBe(true);
    if (!answered.ok) return;
    expect(answered.state.choices, 'and the decision is closed').toEqual([]);
    // The named card LEFT the market, and the market was refilled to its printed size.
    expect(matOf(answered.state)).not.toContain(named.cardId);
    expect(answered.state.market.length, 'p10: three cards must always be available').toBe(mat.length);
    expect(answered.state._voterDiscard, 'a taken card is filed on the discard, as INFLUENCE files one').toContain(
      named.cardId,
    );
    // NO VOTERS WERE GRANTED: there is no Voter Card hand in this engine and a free
    // influence is G15's missing `price`, which this op does not smuggle in.
    expect(answered.state.players.p1?.pending, 'a free influence happened').toEqual([]);
  });

  it('THE TWO SETS CANNOT BE MIXED, and it is asserted from BOTH sides', () => {
    // A recycle offer and a market offer are different questions, `pool` says which is
    // which, and neither offer contains a single id from the other set. So a cross-pool
    // pick is not a near-miss: it names a card the dialog never showed, and the engine
    // refuses it.
    const recycleSeed: GameState = {
      ...staging('p1', PICK_RECYCLE.id),
      // A DIFFERENT card from the one being played, so the pile never holds two copies of
      // one id — the conservation trap `card-transfer.test.ts` names in its header.
      _conspiracyDiscard: [TAKE_CHOSEN.id],
    };
    const recycled = play(recycleSeed, PICK_RECYCLE.id);
    expect(recycled.ok).toBe(true);
    if (!recycled.ok) return;
    const recycleDecision = open(recycled.state);
    expect(recycleDecision.choice.pool, 'the recycle decision names ITS set').toBe('conspiracy-recycle');
    expect(recycleDecision.choice.cards).toEqual([TAKE_CHOSEN.id]);
    const marketId = matOf(recycleSeed)[1];
    if (marketId === undefined) throw new Error('no second slot');
    const crossed = reduce(
      recycled.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: recycleDecision.id, pick: { kind: 'card', cardId: marketId } },
      CTX,
    );
    expect(crossed.ok, 'a MARKET card was accepted by a RECYCLE decision').toBe(false);
    if (!crossed.ok) expect(crossed.error).toBe('that card was not one of the options');
    expect(recycled.state._conspiracyDiscard, 'and the recycle list is untouched').toEqual([
      TAKE_CHOSEN.id,
      PICK_RECYCLE.id,
    ]);

    // The other direction: a conspiracy id offered to a MARKET decision.
    const marketSeed = staging('p1', TAKE_CHOSEN.id);
    const marketPlayed = play(marketSeed, TAKE_CHOSEN.id);
    expect(marketPlayed.ok).toBe(true);
    if (!marketPlayed.ok) return;
    const marketDecision = open(marketPlayed.state);
    const back = reduce(
      marketPlayed.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: marketDecision.id, pick: { kind: 'card', cardId: PICK_RECYCLE.id } },
      CTX,
    );
    expect(back.ok, 'a CONSPIRACY card was accepted by a MARKET decision').toBe(false);
    expect(matOf(marketPlayed.state), 'and the market is untouched').toEqual(matOf(marketSeed));
  });

  it('an EMPTY market raises NOTHING — said here, and proved rather than assumed', () => {
    // **THE CHOICE MADE IS: RAISE NOTHING.** Not "raise it with zero options": a
    // decision whose acceptable answers are empty is the `convert-voter` soft-lock
    // class, and `blockedBy` would freeze the seat on a clause with nothing to act on.
    // The market is refilled only by `refresh-market` and by `draw()`'s reshuffle, so an
    // empty market is a real position — the endgame of a long game — and the card must
    // resolve through it.
    const bare = staging('p1', TAKE_CHOSEN.id, 'empty');
    expect(bare.market).toEqual([]);
    expect(bare._voterDraw.length, 'the whole pile is under the bare mat').toBe(VOTER_CARDS.length);
    const played = play(bare, TAKE_CHOSEN.id);
    expect(played.ok, 'an empty market must not fail the card').toBe(true);
    if (!played.ok) return;
    expect(played.state.choices, 'a decision with no legal pick was raised').toEqual([]);
    expect(played.state.market, 'and nothing was taken').toEqual([]);

    // PROOF THAT THE SEAT IS NOT FROZEN: the very next action the player could take
    // still succeeds, and the table still turns. This is the soft-lock shape the whole
    // class of bug has, asserted directly rather than inferred.
    const answered = reduce(played.state, 'p1', { type: 'END_TURN' }, CTX);
    expect(answered.ok, 'the chooser was left unable to act').toBe(true);
    if (!answered.ok) return;
    expect(answered.state.activePlayer, 'and the table could not turn').toBe('p2');

    // The deterministic shape agrees: with no `pick` an empty market is also a no-op,
    // which is the same rule by another road.
    const blunt: ConspiracyCard = {
      id: 'pool-take-top',
      name: 'Take One',
      text: 'Take a Voter Card from the market.',
      cost: 0,
      effects: [{ op: 'take-voter', n: 1 }],
    };
    const cards = indexCards({
      ideology: Object.values(CARDS.ideology),
      voter: [...VOTER_CARDS],
      conspiracy: [blunt, ...POOL_CARDS],
      headline: Object.values(CARDS.headline),
    });
    const ctx: Ctx = { rules: RULES, cards };
    const bluntSeed = staging('p1', blunt.id, 'empty');
    const seeded: GameState = {
      ...bluntSeed,
      players: { ...bluntSeed.players, p1: { ...bluntSeed.players.p1!, conspiracies: [blunt.id] } },
    };
    const top = reduce(seeded, 'p1', { type: 'PLAY_CONSPIRACY', cardId: blunt.id }, ctx);
    expect(top.ok).toBe(true);
    if (!top.ok) return;
    expect(top.state.choices, 'the deterministic take raised a decision too').toEqual([]);
    expect(top.state.market).toEqual([]);
  });

  it('`n` above the market is capped at the market, which is what makes the k-th answerable', () => {
    const greedy: ConspiracyCard = {
      id: 'pool-take-many',
      name: 'Take Several',
      text: 'Take Voter Cards from the market.',
      cost: 0,
      effects: [{ op: 'take-voter', n: 5, pick: true }],
    };
    const cards = indexCards({
      ideology: Object.values(CARDS.ideology),
      voter: [...VOTER_CARDS],
      conspiracy: [greedy, ...POOL_CARDS],
      headline: Object.values(CARDS.headline),
    });
    const ctx: Ctx = { rules: RULES, cards };
    const seedBase = staging('p1', greedy.id);
    const mat = matOf(seedBase);
    const seeded: GameState = {
      ...seedBase,
      players: { ...seedBase.players, p1: { ...seedBase.players.p1!, conspiracies: [greedy.id] } },
    };
    const played = reduce(seeded, 'p1', { type: 'PLAY_CONSPIRACY', cardId: greedy.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const openOnes = played.state.choices.filter((c) => c.player === 'p1');
    expect(openOnes.length, 'n: 5 over a three-card market raises three, not five').toBe(mat.length);

    // And every one of them is answerable, in any order, until the market has nothing
    // this decision offered left. That is the satisfiability claim, walked.
    let s = played.state;
    const order = [mat[2], mat[0], mat[1]].filter((id): id is string => id !== undefined);
    for (const cardId of order) {
      const next = s.choices.find((c) => c.player === 'p1');
      expect(next, 'a decision was stranded').toBeDefined();
      if (next === undefined) return;
      const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: next.id, pick: { kind: 'card', cardId } }, ctx);
      expect(r.ok, `${cardId} was refused`).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.choices, 'every decision is closed and none replaced them').toEqual([]);
    // Every offered card left the market and the mat is refilled from the pile beneath
    // it, so the game still has the three face-up cards p10 promises.
    for (const id of order) expect(s._voterDiscard).toContain(id);
    expect(s.market.length).toBe(mat.length);
  });
});