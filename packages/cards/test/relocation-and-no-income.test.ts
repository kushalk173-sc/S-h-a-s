/**
 * THE TWO CARDS THIS ITERATION ADDED TO THE CORPUS, played through the real reducer.
 *
 * `hl-et2040-022` GREAT LEADER, BAD ECONOMY and `hl-et2040-023` BRAVE NEW WORLDS are the
 * first two cards this package has shipped that turn on a **`LiveEffect` with a `Choice`
 * kind the corpus has never raised before** and on a **restriction consulted by a phase
 * the card does not own**. Neither shape is covered by `reactive-cards.test.ts` (which is
 * about `interrupt`), by `card-playback.test.ts` (which is about four one-shot cards), or
 * by `reducer-parity.test.ts` (which checks that the corpus does not exceed what
 * `reduce()` can do, not that a card actually does anything). So this file is the argument
 * that both are live in a real game:
 *
 *  1. **THE TRIGGER PATH.** GREAT LEADER installs nothing at play time — it installs a
 *     hook, and the hook does not fire until its owner influences a **3**-Voter Card. A
 *     test that only plays the card proves the card parses. This drives the whole chain:
 *     `PLAY_CONSPIRACY` → `INFLUENCE` → `fireTriggers` → the decision, and it pins the
 *     two things that would make it a lie: a **2**-Voter Card does not fire it, and
 *     somebody ELSE influencing a 3-Voter Card does not fire it either (`byOwner`).
 *  2. **THE DECISION BELONGS TO THE SEAT AFTER THE ACTOR**, and `source` is the actor.
 *     Those are different fields and conflating them is the exact bug `convert-voter`'s
 *     self-guard records, so it is asserted rather than inferred from a successful play.
 *  3. **`no-income` SUPPRESSES, IT NEVER REFUSES.** BRAVE NEW WORLDS' promise is that the
 *     answer still happens and the resources do not arrive. An `ANSWER` that returned
 *     `ok: false` would be a table-stalling lock on a card nobody can escape, so both
 *     halves are asserted: the answer succeeds, and the mat is untouched.
 *  4. **THE DROPPED CLAUSES STAY DROPPED.** Both cards are `adapted`, and an `adapted`
 *     card's text is a bounded promise. A later editor "improving" either text toward the
 *     recovered wording would produce the card that lies, which is state (b) in
 *     KNOWN-GAPS.md §0.
 */

import { describe, expect, it } from 'vitest';

import { loadCorpus, toEngineConspiracyCard } from '../src/corpus.js';
import { indexCards, RULES, type CardID, type CardIndex, type PlayerID } from '../src/engine.js';

import { reduce } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import type { Area, AreaID, GameState } from '../../engine/src/state';

const corpus = loadCorpus();

const LEADER: CardID = 'hl-et2040-022';
const BRAVE: CardID = 'hl-et2040-023';

const INDEX: CardIndex = indexCards({
  ideology: corpus.ideology.map((c) => ({ id: c.id, campaign: c.campaign, question: c.question, sides: c.sides })),
  voter: corpus.voter.map((c) => ({ id: c.id, cost: c.cost, voters: c.voters })),
  conspiracy: corpus.conspiracy.map(toEngineConspiracyCard),
  headline: corpus.headline.map((c) => ({ id: c.id, name: c.name, text: c.text, effects: c.effects })),
});

const CTX = { rules: RULES, cards: INDEX };

function must(result: ReturnType<typeof reduce>, why: string): GameState {
  if (!result.ok) throw new Error(`${why}: ${result.error}`);
  return result.state;
}

/**
 * Three seats, EXACTLY AT THE CAP, p1 already past its answer and holding `held`.
 *
 * `3` of each resource is `RULES.resourceCap / 4`, so every seat opens at 12 of 12 — and
 * that is load-bearing rather than tidy. p12 says a player who is over their cap may not
 * take any other action, so `ACK_HEADLINE` and `INFLUENCE` both refuse with *"resolve
 * 'Resource cap' first"*, and the card under test would never resolve at all. `ANSWER`
 * pays out, so `drainCap` discharges whatever that pushes over — a fixture that left it
 * pending would measure the cap rule rather than the card.
 */
function position(held: readonly CardID[] = []): GameState {
  const base = setup({
    players: ['p1', 'p2', 'p3'],
    cards: INDEX,
    seed: 20260103,
    startResources: [
      { funds: 3, clout: 3, media: 3, trust: 3 },
      { funds: 3, clout: 3, media: 3, trust: 3 },
      { funds: 3, clout: 3, media: 3, trust: 3 },
    ],
    ideologyDeck: corpus.ideology.map((c) => c.id),
    voterDeck: corpus.voter.map((c) => c.id),
    conspiracyDeck: corpus.conspiracy.map((c) => c.id),
    headlineDeck: corpus.headline.map((c) => c.id),
  });
  const p1 = base.players.p1;
  if (p1 === undefined) throw new Error('no p1');
  return drainCap({
    ...base,
    players: { ...base.players, p1: { ...p1, conspiracies: [...held] } },
  });
}

/**
 * Settle every open cap discard, the way a player would: shed Funds first.
 *
 * `ANSWER` pays a side's resources and a passive bonus on top, so a seat opened at the cap
 * is over it the moment it answers. p12 then refuses every other action until the excess is
 * gone, which would make `ACK_HEADLINE` and `INFLUENCE` fail for a reason that has nothing
 * to do with the card under test.
 */
function drainCap(s: GameState): GameState {
  let cur = s;
  for (let i = 0; i < 8 && cur.choices.length > 0; i += 1) {
    const pending = cur.choices[0];
    if (pending === undefined) break;
    if (pending.choice.kind !== 'lose-any') break;
    cur = must(
      reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'resources', res: { funds: pending.choice.count } } }, CTX),
      'discard the cap excess',
    );
  }
  return cur;
}

/**
 * Put one of `who`'s voters in the first area of the first zone, so the board has a peg
 * with somewhere to go: `north_west-01`'s zone (`north_west`) neighbours `north`, and
 * `north-01` is empty on any fresh board.
 */
function pegFor(s: GameState, who: PlayerID, areaId: AreaID = 'north_west-01'): GameState {
  const area = s.zones.flatMap((z) => z.areas).find((a) => a.id === areaId);
  if (area === undefined) throw new Error(`no area ${areaId}`);
  const filled: Area = { ...area, peg: { owner: who, majority: false } };
  return {
    ...s,
    zones: s.zones.map((z) => ({ ...z, areas: z.areas.map((a) => (a.id === areaId ? filled : a)) })),
  };
}

/**
 * Queue `id` as the Headline face up and resolve it.
 *
 * `ACK_HEADLINE` reads TWO fields, not one: the `phase` and `activeHeadline`. A card that
 * changes only the phase is refused with *"there is no Headline to resolve"*, which is
 * what the first draft of this helper did — and the failure mode is worth naming, because
 * a helper that resolves the wrong card would pass everything and measure nothing.
 */
function resolveHeadline(s: GameState, id: CardID): GameState {
  const queued: GameState = {
    ...s,
    phase: 'headlines',
    headlineQueue: [...s.headlineQueue, { areaId: 'north_west-01', by: 'p1' as PlayerID }],
    activeHeadline: id,
  };
  const after = must(reduce(queued, 'p1', { type: 'ACK_HEADLINE' }, CTX), `resolve ${id}`);
  // The effects are the point; a leftover cap discard is not, and would make the next
  // action fail for a reason that has nothing to do with the card.
  return toActionsOf(drainCap(after), 'p1');
}

/**
 * Put `who` on move in free play, answering nothing.
 *
 * A FIXTURE, and it is stated rather than smuggled. Resolving the Headline runs the
 * headlines phase to its end, which advances the turn, so a test that wanted "p1
 * influences a 3-Voter Card next" would otherwise have to walk a whole round of `END_TURN`
 * / `ANSWER` before it reached its subject — and every one of those steps is a second
 * moving part that can fail for its own reasons. `INFLUENCE` checks `activePlayer` and the
 * phase and nothing else, so naming them directly is the same technique
 * `packages/engine/test/choices.test.ts` uses for every fixture it builds.
 */
function toActionsOf(s: GameState, who: PlayerID): GameState {
  return { ...s, phase: 'actions', activePlayer: who, _pendingCard: null, activeHeadline: null };
}

const pegDestChoices = (s: GameState) => s.choices.filter((c) => c.choice.kind === 'choose-peg-dest');

/** Put the card on the Mat, influence a Voter Card of `voters`, and return the state. */
function influence(s: GameState, voters: number): GameState {
  const slot = s.market.findIndex((m) => m !== null && m.voters === voters);
  if (slot < 0) {
    // p10 keeps three face-up Voter Cards and the market is dealt from a seeded pile, so
    // a size the opening does not hold is a FIXTURE problem and not a finding. Fail loudly
    // rather than buying a different card and measuring the wrong thing.
    throw new Error(`the market holds no ${voters}-Voter Card`);
  }
  return must(reduce(s, 'p1', { type: 'INFLUENCE', slot }, CTX), `influence a ${voters}-Voter Card`);
}

describe('hl-et2040-022 GREAT LEADER, BAD ECONOMY — the hook fires, and only when it should', () => {
  it('plays as a hook, not as a resolution: nothing happens at play time', () => {
    // A Headline Card is resolved through the QUEUE, so this is the headline path and not
    // `PLAY_CONSPIRACY` — a card under test resolved by the wrong action measures nothing.
    const resolved = resolveHeadline(position(), LEADER);
    expect(pegDestChoices(resolved), 'the card must install a hook, not a decision').toHaveLength(0);
    expect(resolved.liveEffects.some((le) => le.sourceCardId === LEADER), 'a live effect was installed').toBe(true);
  });

  it('a 3-Voter Card influenced by its OWN owner raises the decision for the seat AFTER them', () => {
    const installed = resolveHeadline(pegFor(position(), 'p1'), LEADER);
    const bought = influence(installed, 3);
    const raised = pegDestChoices(bought);
    expect(raised, 'the hook did not fire on a 3-Voter Card').toHaveLength(1);
    const only = raised[0];
    if (only === undefined) throw new Error('no decision');
    // The turn order is p1, p2, p3, so the seat after the actor is p2 — and NOT p1.
    expect(only.player).toBe('p2');
    if (only.choice.kind === 'choose-peg-dest') {
      // `source` is the card's ACTOR, whose voter may be moved. Confusing the two would
      // make the beneficiary's own voter the only movable one, which is the
      // `convert-voter` self-guard bug in a new place.
      expect(only.choice.source).toBe('p1');
      expect(only.choice.scope).toBe('others');
    }
  });

  it('a 2-Voter Card does NOT fire it — the printed condition is a 3', () => {
    const installed = resolveHeadline(pegFor(position(), 'p1'), LEADER);
    const bought = influence(installed, 2);
    expect(pegDestChoices(bought), 'the hook fired on a 2-Voter Card').toHaveLength(0);
  });

  it('somebody ELSE influencing a 3-Voter Card does NOT fire it — the card says "you influence"', () => {
    const installed = resolveHeadline(pegFor(position(), 'p2'), LEADER);
    const slot = installed.market.findIndex((m) => m !== null && m.voters === 3);
    expect(slot, 'the market holds no 3-Voter Card').toBeGreaterThanOrEqual(0);
    // p2 buys it, so `fire.actor` is p2 while the live effect's owner is p1, and
    // `conditionHolds`'s `byOwner` does not hold. `toActionsOf` is what puts p2 on move —
    // the same fixture seam the other tests use, and the only reason this is not simply
    // "p1 buys it", which would be the `byOwner` case and prove nothing.
    const p2sTurn = toActionsOf(installed, 'p2');
    const bought = must(reduce(p2sTurn, 'p2', { type: 'INFLUENCE', slot }, CTX), 'p2 influences');
    expect(pegDestChoices(bought), 'the hook fired on somebody else\'s purchase').toHaveLength(0);
  });

  it('and the decision MOVES the voter rather than describing that it could', () => {
    const installed = resolveHeadline(pegFor(position(), 'p1'), LEADER);
    const bought = influence(installed, 3);
    const pending = pegDestChoices(bought)[0];
    if (pending === undefined) throw new Error('the hook did not fire');
    const area = (s: GameState, id: AreaID) => s.zones.flatMap((z) => z.areas).find((a) => a.id === id);
    expect(area(bought, 'north_west-01')?.peg?.owner).toBe('p1');

    const moved = must(
      reduce(bought, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' } }, CTX),
      'answer the relocation',
    );
    expect(area(moved, 'north_west-01')?.peg, 'the origin is vacated').toBeNull();
    // The peg KEEPS ITS OWNER. This card hands the beneficiary a relocation, not a
    // conversion, and `convert-voter` is the verb that changes an owner.
    expect(area(moved, 'north-01')?.peg?.owner, "the peg is still p1's").toBe('p1');
  });
});

describe('hl-et2040-023 BRAVE NEW WORLDS — the answer happens and pays nothing', () => {
  it('an answer under `no-income` SUCCEEDS and credits nothing', () => {
    // `resolveHeadline` hands back p1 on move, and `END_TURN` is what puts the NEXT seat's
    // Ideology Card to them — so the answer measured here is p2's, under p2's own copy of
    // the restriction, which is the printed shape (*"no player receives any resources"*).
    const installed = resolveHeadline(position(), BRAVE);
    expect(
      installed.players.p2?.restrictions?.some((r) => r.kind === 'no-income'),
      'the card did not reach the seat that is about to answer',
    ).toBe(true);

    const boundary = must(reduce(installed, 'p1', { type: 'END_TURN' }, CTX), 'end turn');
    expect(boundary.phase, 'the boundary did not open an answer window').toBe('answer');
    const who = boundary.activePlayer;
    const before = boundary.players[who]?.resources;
    if (before === undefined) throw new Error('no active player');

    const answered = must(reduce(boundary, who, { type: 'ANSWER', side: 0 }, CTX), 'answer');
    const after = answered.players[who]?.resources;
    if (after === undefined) throw new Error('the answering seat vanished');

    // 1. THE ANSWER HAPPENED. A `no-income` that made `ANSWER` illegal would be a
    //    table-stalling lock on a card the player cannot escape — the ruling is that it
    //    SUPPRESSES and never REFUSES, and this is the assertion for that half.
    expect(answered.players[who]?.manifesto.length, 'the answer did not join the manifesto').toBeGreaterThan(0);
    expect(answered.phase, 'the answer did not return the table to free play').toBe('actions');
    // 2. THE SUPPRESSION WAS ANNOUNCED. A silent suppression is a player who cannot tell
    //    the card fired from a card that did nothing.
    expect(
      answered.log.some((l) => l.text === 'No resources for this answer.'),
      'the suppression was not announced',
    ).toBe(true);
    // 3. AND THE ARITHMETIC, which is the half that can be wrong in the direction that
    //    quietly pays: the pool is bit-for-bit what it was. p13 pays the side's resources
    //    and p28 adds a passive bonus, so "nothing arrived" is two suppressed credits and
    //    this is the only assertion that catches a regression in either.
    expect(after, 'the answer paid something under `no-income`').toEqual(before);
  });
});

describe('both cards: their `adapted` promises are bounded', () => {
  it('neither text promises the answer sweep or the refusal that was ruled out', () => {
    const leader = corpus.headline.find((c) => c.id === LEADER);
    const brave = corpus.headline.find((c) => c.id === BRAVE);
    expect(leader, 'GREAT LEADER is not in the corpus').toBeDefined();
    expect(brave, 'BRAVE NEW WORLDS is not in the corpus').toBeDefined();
    if (leader === undefined || brave === undefined) return;
    // KNOWN-GAPS.md §8.2(a): the out-of-band answer sweep is a NAMED DECISION, not a
    // shipped clause. A text that says "every player answers immediately" would be a card
    // that lies, because `reduce()` has one writer for the answer window.
    expect(brave.text).not.toMatch(/answers? an Ideology Card immediately/i);
    expect(brave.text).not.toMatch(/in order of turn/i);
    // §8.1: GREAT LEADER's "MAY" is read as the chooser spending the decision, and a
    // Volatile-Area peg is immovable, so the text says so rather than implying otherwise.
    expect(leader.text).toMatch(/Volatile Area/i);
    expect(leader.text).toMatch(/majority/i);
  });
});