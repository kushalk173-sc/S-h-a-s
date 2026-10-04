/**
 * SEMANTIC AGREEMENT: does a card's PRINTED TEXT mean what its reduction DOES?
 *
 * ## THE HOLE THIS FILLS, and it is the one C1 walked through
 *
 * `reducer-parity.test.ts` is the strongest honesty suite in this repository and it
 * is **not** sufficient. It re-derives the op set, the per-op read fields, the trigger
 * raise sites and the target switch out of `reduce.ts`'s own source text, in both
 * directions, with non-vacuity assertions. What it cannot see is whether the SEMANTICS
 * of a reduction match the SENTENCE on the card.
 *
 * The audit's C1 is the proof: KHAKI TERROR was fully executable, schema-valid,
 * registry-valid, and its printed text and its behaviour disagreed in three separate
 * ways — an opponent's drain cleared the lock, "1 resource of each type" had been
 * reduced to a scalar, and the card's own donation did not count against its own lock.
 * It shipped green through every check this repository had.
 *
 * **THE DESIGN IS OBLIGATIONS DERIVED PER OP, NOT PROSE MATCHING.** Matching a card's
 * text against a template is unbounded and would rot into a keyword linter; it cannot
 * distinguish "donate 1 of each" from "lose any 4 Funds" because both contain a number
 * and a resource word. So nothing here reads the text to decide *what to check*. The
 * text is read once, only to decide **WHETHER a check is armed**, and every armed
 * check is then a claim about MEASURED STATE rather than about strings. Each obligation
 * is falsifiable on its own: it is a predicate over a state difference, and a
 * reduction that is wrong in the direction the op promises fails it.
 *
 * **THE MEASUREMENT IS LEAVE-ONE-OUT, and that is what makes it per-CLAUSE.** A card
 * with `gain` and `lose` nets to zero in one pool, so a whole-card diff cannot tell
 * which clause did what — and the honest answer to "does the `gain` clause gain" is not
 * "the pool went up". So each card is resolved N+1 times: once whole, and once with
 * each clause deleted. The obligation for clause *i* is then measured on
 * `whole − without_i`, which attributes every movement to the clause that caused it.
 *
 * ## WHAT IS *NOT* CLAIMED, because claiming it would be the failure mode
 *
 * This is not exhaustive. A printed sentence can contain reasons, conditions,
 * seat-relative directions, "of their choice", "under the normal rules" and narrative
 * that names a dropped clause — and none of that is checkable by watching a state. Every
 * such claim is in `EXCLUDED` below, WITH A REASON, and the test fails if an exclusion
 * stops matching any card in the corpus (a rotted exclusion list is worse than none).
 * **The exclusion list is a deliverable, not an apology.** A reader who wants to know
 * what is NOT verified reads it rather than inferring it from silence.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadCorpus, toEngineConspiracyCard, toEngineHeadlineCard, toEngineIdeologyCard, toEngineVoterCard } from '../src/corpus.js';
import { RULES, RESOURCES, deltaTotal, type CardID, type CardIndex, type ConspiracyCard, type Effect, type HeadlineCard, type PlayerID } from '../src/engine.js';

import { reduce, type Ctx } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import type { Delta, GameState, Pool } from '../../engine/src/state';

// ─────────────────────────── the fixture ───────────────────────────

const corpus = loadCorpus();

/**
 * The fixture's OWN Ideology deck, and its own pinned deck ids, for the reason
 * `card-playback.test.ts` gives at length: a fixture built from `loadCorpus()` re-shuffles
 * whenever a card is added, so a test about the REDUCER starts failing because somebody
 * added a Voter Card. Same shape, same reason, copied rather than shared so this file
 * has no dependency on another test file's internals.
 */
const FIXTURE_IDEOLOGY = [
  {
    id: 'ig-sem-a',
    campaign: 'fixture',
    question: 'Does the ceiling move, or does the room?',
    sides: [
      { answer: 'It moves.', ideologue: 'capitalist' as const, pays: { funds: 2 } },
      { answer: 'The room.', ideologue: 'idealist' as const, pays: { trust: 2 } },
    ],
  },
  {
    id: 'ig-sem-b',
    campaign: 'fixture',
    question: 'And the floor?',
    sides: [
      { answer: 'It stays.', ideologue: 'supremo' as const, pays: { clout: 2 } },
      { answer: 'It goes.', ideologue: 'showstopper' as const, pays: { media: 2 } },
    ],
  },
] as const;

const INDEX: CardIndex = {
  ideology: {
    ...Object.fromEntries(corpus.ideology.map((c) => [c.id, toEngineIdeologyCard(c)])),
    ...Object.fromEntries(FIXTURE_IDEOLOGY.map((c) => [c.id, c])),
  },
  voter: Object.fromEntries(corpus.voter.map((c) => [c.id, toEngineVoterCard(c)])),
  conspiracy: Object.fromEntries(corpus.conspiracy.map((c) => [c.id, toEngineConspiracyCard(c)])),
  headline: Object.fromEntries(corpus.headline.map((c) => [c.id, toEngineHeadlineCard(c)])),
};

const CTX = { rules: RULES, cards: INDEX };

/** Six in total, under the cap of 12, so answering cannot raise a cap discard. */
const OPENING = [{ funds: 3, clout: 1, media: 1, trust: 1 }] as const;

/**
 * A position where as many ops as possible actually BITE: pegs on the board for every
 * seat, a market with cards in it, and a draw pile with something in it.
 *
 * A fixture with an empty board cannot tell "the card moved a voter" from "there were
 * no voters", which is the whole measurement, so this is not decoration.
 */
function game(): GameState {
  const s = setup({
    players: ['p1', 'p2', 'p3'],
    cards: INDEX,
    seed: 20240917,
    startResources: [OPENING[0], { funds: 4, clout: 3, media: 3, trust: 3 }, { funds: 4, clout: 3, media: 3, trust: 3 }],
    ideologyDeck: FIXTURE_IDEOLOGY.map((c) => c.id),
    voterDeck: ['vo-core-001', 'vo-core-002', 'vo-core-003', 'vo-core-004', 'vo-core-005', 'vo-core-006'],
    conspiracyDeck: ['ct-et2040-001', 'ct-et2040-002', 'ct-et2040-003'],
    headlineDeck: ['hl-et2040-001', 'hl-et2040-002', 'hl-et2040-003'],
  });
  const seeded: GameState = {
    ...s,
    zones: s.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a, i) =>
        a.volatile || i > 2 ? a : { ...a, peg: { owner: (['p1', 'p2', 'p3'] as const)[i]!, majority: false } },
      ),
    })),
  };
  const answered = reduce(seeded, 'p1', { type: 'ANSWER', side: 0 }, CTX);
  if (!answered.ok) throw new Error(`fixture could not answer: ${answered.error}`);
  if (answered.state.choices.length > 0) throw new Error('the fixture opening left a pending decision');
  // ONE card in the Conspiracy DISCARD pile, because `draw-conspiracy` with
  // `from: 'discard'` reaches into it and a freshly-built game has an empty one — so
  // without this the checker reports a working card as having done NOTHING, which is the
  // one wrong answer a measurement of this kind must never give. (Same argument, same
  // fixture, as `playable.ts` and `card-playback.test.ts` make independently.)
  return { ...answered.state, _conspiracyDiscard: ['ct-et2040-002'] };
}

/**
 * Do two effect lists say the same thing?
 *
 * **BY CONTENT, AND THE BY-IDENTITY VERSION OF THIS QUESTION WAS A SILENT NO-OP.** Both
 * `play` and `resolveHeadline` used to ask "is the effect list I was handed the same object
 * as the one on the spec?" and take the unmodified `CTX` when it was. That is true for a
 * card resolved whole — and also true for a DELIBERATELY CORRUPTED card, because the
 * corrupted list is the corruptor's own array and so is trivially identical to itself. So
 * `disagreements(corruptedCard, …)` measured the card in the INDEX, not the card it was
 * given, and every "checker has teeth" case that leaned on it was leaning on nothing. A
 * corrupted card's text stays, its clause does not, and the index does not know.
 */
function sameEffects(a: readonly Effect[], b: readonly Effect[]): boolean {
  return a.length === b.length && a.every((e, i) => JSON.stringify(e) === JSON.stringify(b[i]));
}

/**
 * Resolve a Conspiracy Card, or a Headline, through the path its kind really takes, and
 * answer whatever decisions it raised — greedily, because the question is "does a legal
 * resolution exist and does it move the promised thing", not which pick a player would
 * prefer.
 *
 * The greedy answer is applied TWICE, because a decision can raise another: the loop is
 * bounded at 12 rounds and `Playable` cards in the corpus routinely chain.
 */
function settle(s: GameState): GameState {
  let cur = s;
  for (let round = 0; round < 12 && cur.choices.length > 0; round += 1) {
    const pending = cur.choices[0];
    if (pending === undefined) break;
    const player = cur.players[pending.player];
    if (player === undefined) break;
    const c = pending.choice;
    let next: ReturnType<typeof reduce> | null = null;
    /**
     * G17. The FIRST card on the offered list, and the reason this arm exists at all:
     * `pick: true` defers the whole effect until a decision is answered, so a settle
     * loop that does not know the kind leaves the decision open, the hand unchanged, and
     * reports a card whose printed sentence is fully implemented as having done nothing.
     *
     * The FIRST rather than the last deliberately: this checker measures whether a
     * clause fires, and `packages/cards/scripts/playable.ts` separately measures that the
     * player can name a card that is not the top — so the two together cover both halves
     * of "pick any card, in any order" without this file growing a preference.
     */
    if (c.kind === 'choose-card') {
      const cardId = c.cards[0];
      if (cardId === undefined) break;
      next = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId } }, CTX);
    } else if (c.kind === 'gain-any' || c.kind === 'lose-any') {
      let left = c.count;
      const res: Delta = {};
      for (const r of RESOURCES) {
        if (left === 0) break;
        const take = Math.min(left, player.resources[r]);
        if (take > 0) {
          res[r] = take;
          left -= take;
        }
      }
      if (left > 0 && c.kind === 'gain-any') {
        res.funds = (res.funds ?? 0) + left;
        left = 0;
      }
      next = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'resources', res } }, CTX);
    } else if (c.kind === 'steal-any') {
      const victim = c.from ?? cur.turnOrder.find((id) => id !== pending.player);
      if (victim === undefined) break;
      // `resolveChoice` demands EXACTLY `count` resources ("take exactly N"), so a fixed
      // pick of 1 is refused on any card asking for more — and a refused pick means the
      // card is measured as having stolen nothing. So the denominations are searched.
      const held = cur.players[victim]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
      const offers: Delta[] = [{ funds: c.count }];
      for (const r of RESOURCES) offers.push({ [r]: c.count });
      for (const r of RESOURCES) {
        const rest = c.count - 1;
        if (rest < 1) continue;
        offers.push({ funds: rest, [r]: 1 });
      }
      next = offers
        .map((res) => reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'steal', from: victim, res } }, CTX))
        .find((a) => a.ok) ?? null;
      if (next === null) {
        // Nothing the victim holds sums to `count`, so the honest fallback is to take
        // everything they have rather than to report a working theft as a no-op.
        const all: Delta = {};
        let left = c.count;
        for (const r of RESOURCES) {
          const take = Math.min(left, held[r]);
          if (take > 0) {
            all[r] = take;
            left -= take;
          }
        }
        if (left > 0) break;
        next = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'steal', from: victim, res: all } }, CTX);
      }
    } else if (c.kind === 'choose-player') {
      const seat = cur.turnOrder.find((id) => id !== pending.player);
      if (seat === undefined) break;
      next = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'player', id: seat } }, CTX);
    } else if (c.kind === 'choose-zone') {
      const zone = cur.zones.find((z) => z.areas.some((a) => a.peg !== null));
      if (zone === undefined) break;
      next = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'zone', zoneId: zone.id } }, CTX);
    } else if (c.kind === 'choose-peg-dest') {
      // G1. A SEARCH over the (peg, adjacent empty area) pairs, mirroring
      // `reduce.ts:movablePegIds` / `pegDestinations`. `source` is the card's ACTOR and
      // not the answerer, which is the whole of GREAT LEADER's effect — so this must
      // not filter by `pending.player` the way the voter branch below does. A fixed
      // heuristic pick would be refused whenever the board has no empty area adjacent to
      // the actor's only peg, and a refused pick means the card is measured as having done
      // NOTHING, which is the one wrong answer this file must never give.
      let donePeg = false;
      for (const z of cur.zones) {
        if (donePeg) break;
        for (const a of z.areas) {
          if (donePeg) break;
          if (a.peg === null || a.peg.owner !== c.source) continue;
          if (a.peg.majority || a.volatile) continue;
          for (const nz of cur.zones) {
            if (nz.id === z.id || !z.neighbours.includes(nz.id)) continue;
            const spot = nz.areas.find((x) => x.peg === null);
            if (spot === undefined) continue;
            const attempt = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: a.id, toAreaId: spot.id } }, CTX);
            if (attempt.ok) {
              next = attempt;
              donePeg = true;
              break;
            }
          }
        }
      }
      if (!donePeg) break;
    } else {
      // THE VOTER BRANCH IS A SEARCH, NOT A GUESS, and the reason is `voterScope`.
      // `evict`/`discard-voter`/`convert-voter` read a `ChoiceScope`, and the same op with
      // `target: 'you'` resolves over the chooser's OWN pegs while `target:
      // 'each-opponent'` resolves over somebody else's — so a fixed heuristic pick is
      // refused half the time and a refused pick means the card is measured as having
      // done NOTHING, which is the one wrong answer this file must never give. Same
      // argument, same technique, as `choices.test.ts`'s `candidatePicks`.
      const wanted = Math.min(c.count, 4);
      // OWN PEGS FIRST, and the reason is the search cap: `areaPicks` stops after 200
      // candidates per size, so with 27 pegged areas a size-2 sweep would never reach the
      // pair the engine actually wants if the pair is not near the front. `voterScope`
      // decides whether the legal set is the chooser's own or somebody else's, and it is
      // not knowable here — so both orders are tried and the engine picks.
      const peggedAreas = cur.zones.flatMap((z) => z.areas.filter((a) => a.peg !== null));
      const mine = peggedAreas.filter((a) => a.peg?.owner === pending.player).map((a) => a.id);
      const theirs = peggedAreas.filter((a) => a.peg?.owner !== pending.player).map((a) => a.id);
      let done = false;
      for (const order of [mine, theirs]) {
        if (done || order.length === 0) continue;
        for (const pick of areaPicks(order, wanted)) {
          const attempt = reduce(cur, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'areas', areaIds: pick } }, CTX);
          if (attempt.ok) {
            cur = attempt.state;
            done = true;
            break;
          }
        }
      }
      if (!done) break;
      continue;
    }
    if (next === null || !next.ok) break;
    cur = next.state;
  }
  return cur;
}

/**
 * Every subset of `xs` of size exactly `n`, plus the shorter ones, largest first.
 *
 * A voter decision's `count` is clamped to `targetableCount`, so the engine may accept
 * FEWER areas than the card asked for. Offering every size from `n` down to 1 is what
 * lets the search find that legal answer instead of giving up on a card that works.
 */
function areaPicks(xs: readonly string[], n: number): string[][] {
  const out: string[][] = [];
  const reach = Math.min(n, xs.length);
  for (let size = reach; size >= 1; size -= 1) {
    const walk = (start: number, acc: string[]): void => {
      if (acc.length === size) {
        out.push([...acc]);
        return;
      }
      for (let i = start; i < xs.length; i += 1) walk(i + 1, [...acc, xs[i] as string]);
    };
    walk(0, []);
    // Cap the branching factor: a board of 20 pegged areas would otherwise be 20^4 picks,
    // and the FIRST legal one is found within the first few hundred in practice.
    if (out.length > 200) break;
  }
  return out;
}

/** A card this file can play, real or synthetic. */
type Playable = { readonly id: CardID; readonly name: string; readonly text: string; readonly effects: readonly Effect[] };

/**
 * Play a Conspiracy Card by id, or play a synthetic one, from a copy of `s` with it in
 * p1's hand. Returns BOTH forms, and the difference matters:
 *
 *  - `raw` is the state the moment the card resolved, decisions NOT yet answered. This is
 *    where *"gain N resources of their choice"* is visible, because the sentence is
 *    satisfied by the CHOICE being offered and `gain-any`'s obligation has to be allowed
 *    to see it. Measuring only the settled form reports a card whose every pool movement
 *    is offset by its own other clause as a no-op, which is a measurement artefact and
 *    not a finding.
 *  - `settled` is `raw` after the decisions have been answered greedily. This is where
 *    *"discard 2 voters"* is visible, because until the pick is made no peg has moved.
 *
 * The synthetic path is how the C1 block gets at a reduction the corpus does not ship.
 * It builds a context rather than mutating `CTX`, because `reduce()` must stay a pure
 * function of its arguments and a fixture that reached inside the index would be testing
 * a shape the engine cannot raise.
 */
function play(
  s: GameState,
  card: Playable | CardID,
  override?: readonly Effect[],
  actor: PlayerID = 'p1',
): { readonly raw: GameState; readonly settled: GameState } | { readonly error: string } {
  const spec: Playable | undefined = typeof card === 'string' ? SHIPPED.find((x) => x.id === card) : card;
  if (spec === undefined) return { error: `no card ${String(card)}` };
  const effects = override ?? spec.effects;
  const synthetic = CTX.cards.conspiracy[spec.id] === undefined;
  const indexed = CTX.cards.conspiracy[spec.id];
  const ctx: Ctx = synthetic
    ? {
        ...CTX,
        cards: {
          ...CTX.cards,
          conspiracy: {
            ...CTX.cards.conspiracy,
            [spec.id]: { id: spec.id, name: spec.name, text: spec.text, cost: 1, effects },
          },
        },
      }
    : sameEffects(effects, indexed?.effects ?? [])
      ? CTX
      : {
          ...CTX,
          cards: {
            ...CTX.cards,
            conspiracy: {
              ...CTX.cards.conspiracy,
              [spec.id]: { ...(indexed as ConspiracyCard), effects },
            },
          },
        };
  const held: GameState = {
    ...s,
    // A Conspiracy Card is playable out of turn ONLY in the pre-answer window (p19), so a
    // card played by somebody who is not having their turn is put back into `answer`
    // rather than reaching past the reducer. The C1 block needs exactly that: the drain
    // has to come from p2 while p1 is the one who is locked.
    ...(actor === s.activePlayer ? {} : { phase: 'answer' as const }),
    players: { ...s.players, [actor]: { ...s.players[actor]!, conspiracies: [...s.players[actor]!.conspiracies, spec.id] } },
  };
  const r = reduce(held, actor, { type: 'PLAY_CONSPIRACY', cardId: spec.id }, ctx);
  if (!r.ok) return { error: r.error };
  return { raw: r.state, settled: settle(r.state) };
}

// ─────────────────────────── the measurement ───────────────────────────

/** Everything this file is willing to look at. Nothing here is a private field. */
type Snapshot = {
  readonly pools: ReadonlyMap<PlayerID, Pool>;
  readonly pegs: ReadonlyMap<PlayerID, number>;
  /**
   * Voters HELD but not yet placed — the HQ Mat.
   *
   * `voters` grants to the mat and not to the board, so a snapshot that counted only
   * board pegs would report the most common op in the corpus as having done NOTHING.
   * That is not a subtle distinction: "gain N voters" means N more pegs in hand, and a
   * checker that cannot see a hand cannot check the sentence.
   */
  readonly mat: ReadonlyMap<PlayerID, number>;
  readonly restrictions: ReadonlyMap<PlayerID, number>;
  readonly restrictionKinds: ReadonlyMap<PlayerID, readonly string[]>;
  readonly liveEffects: number;
  readonly caps: ReadonlyMap<PlayerID, number | null>;
  readonly helpingHands: ReadonlyMap<PlayerID, number>;
  readonly gerrymandered: ReadonlyMap<PlayerID, number>;
  readonly majors: number;
  readonly market: readonly string[];
  readonly conspiracyHands: ReadonlyMap<PlayerID, number>;
  readonly ideologyHands: ReadonlyMap<PlayerID, number>;
  readonly draws: { readonly voter: number; readonly conspiracy: number; readonly ideology: number };
  readonly pendingChoices: number;
};

function snapshot(s: GameState): Snapshot {
  const pools = new Map<PlayerID, Pool>();
  const pegs = new Map<PlayerID, number>();
  const mat = new Map<PlayerID, number>();
  const restrictions = new Map<PlayerID, number>();
  const restrictionKinds = new Map<PlayerID, readonly string[]>();
  const caps = new Map<PlayerID, number | null>();
  const helpingHands = new Map<PlayerID, number>();
  const gerrymandered = new Map<PlayerID, number>();
  const conspiracyHands = new Map<PlayerID, number>();
  const ideologyHands = new Map<PlayerID, number>();
  let majors = 0;
  for (const id of s.turnOrder) {
    const p = s.players[id];
    if (p === undefined) continue;
    pools.set(id, p.resources);
    pegs.set(id, s.zones.flatMap((z) => z.areas).filter((a) => a.peg?.owner === id).length);
    mat.set(id, p.pending.reduce((n, g) => n + g.count, 0));
    restrictions.set(id, (p.restrictions ?? []).length);
    restrictionKinds.set(id, (p.restrictions ?? []).map((r) => r.kind));
    caps.set(id, p.capOverride?.to ?? null);
    helpingHands.set(id, p.powerUses.helpingHands);
    gerrymandered.set(id, Object.values(p.powerUses.gerrymandered).reduce((a, b) => a + b, 0));
    conspiracyHands.set(id, p.conspiracies.length);
    ideologyHands.set(id, (p as unknown as { ideologyCards?: unknown[] }).ideologyCards?.length ?? 0);
  }
  for (const z of s.zones) for (const a of z.areas) if (a.peg?.majority === true) majors += 1;
  return {
    pools,
    pegs,
    mat,
    restrictions,
    restrictionKinds,
    liveEffects: s.liveEffects.length,
    caps,
    helpingHands,
    gerrymandered,
    majors,
    market: s.market.map((m) => m.cardId),
    conspiracyHands,
    ideologyHands,
    draws: { voter: s._voterDraw.length, conspiracy: s._conspiracyDraw.length, ideology: s._ideologyDraw.length },
    pendingChoices: s.choices.length,
  };
}

/**
 * WHAT ONE CLAUSE DID, and this is the unit every obligation is written against.
 *
 * `whole − without`, per seat and per field, so an obligation never has to reason about
 * a card's OTHER clauses. All of it is a signed number, and every obligation is a
 * statement about a SIGN — a `gain` claims an increase, a `lose` claims a decrease, a
 * theft claims a decrease in one pool and an equal increase in another. Signs are what
 * the printed verbs mean; magnitudes are what a card's own `n` says and are somebody
 * else's check.
 */
type ClauseEffect = {
  readonly seats: readonly PlayerID[];
  readonly caster: PlayerID;
  /** pool total per seat, after minus before. */
  readonly poolDelta: ReadonlyMap<PlayerID, number>;
  /** peg count ON THE BOARD per seat, after minus before. */
  readonly pegDelta: ReadonlyMap<PlayerID, number>;
  /**
   * Pegs in HAND (the HQ Mat) per seat, after minus before.
   *
   * `voters` is the op that makes this necessary, and it is why `pegDelta` alone is not
   * enough: a card printing "gain 1 voter" moves nothing on the board at all until the
   * player chooses to place it, so a board-only measurement reports the corpus's most
   * common clause as a no-op.
   */
  readonly matDelta: ReadonlyMap<PlayerID, number>;
  /** restriction count per seat, after minus before. */
  readonly restrictionDelta: ReadonlyMap<PlayerID, number>;
  /** the kinds of restriction that appeared on any seat, minus those that went away. */
  readonly restrictionKindsAdded: readonly string[];
  readonly liveEffectDelta: number;
  readonly majorsDelta: number;
  /** How much the cap came DOWN by (before − after, so a reduction is positive). */
  readonly capDelta: ReadonlyMap<PlayerID, number>;
  readonly helpingHandsDelta: ReadonlyMap<PlayerID, number>;
  readonly gerrymanderedDelta: ReadonlyMap<PlayerID, number>;
  readonly marketChanged: boolean;
  readonly conspiracyHandDelta: ReadonlyMap<PlayerID, number>;
  readonly ideologyHandDelta: ReadonlyMap<PlayerID, number>;
  readonly drawDelta: { readonly voter: number; readonly conspiracy: number; readonly ideology: number };
  /** decisions raised by this clause and not by the rest of the card. */
  readonly choiceDelta: number;
};

function mapDelta<T>(before: ReadonlyMap<PlayerID, T>, after: ReadonlyMap<PlayerID, T>, of: (b: T, a: T) => number): ReadonlyMap<PlayerID, number> {
  const out = new Map<PlayerID, number>();
  for (const id of after.keys()) out.set(id, of(before.get(id) as T, after.get(id) as T));
  return out;
}

function clauseEffect(whole: GameState, without: GameState, caster: PlayerID): ClauseEffect {
  const a = snapshot(whole);
  const b = snapshot(without);
  const kindsAdded: string[] = [];
  for (const id of a.restrictionKinds.keys()) {
    const now = a.restrictionKinds.get(id) ?? [];
    const was = b.restrictionKinds.get(id) ?? [];
    for (const k of now) if (!was.includes(k)) kindsAdded.push(k);
  }
  return {
    seats: [...a.pools.keys()],
    caster,
    poolDelta: mapDelta(b.pools, a.pools, (x, y) => deltaTotal(y) - deltaTotal(x)),
    pegDelta: mapDelta(b.pegs, a.pegs, (x, y) => y - x),
    matDelta: mapDelta(b.mat, a.mat, (x, y) => y - x),
    restrictionDelta: mapDelta(b.restrictions, a.restrictions, (x, y) => y - x),
    restrictionKindsAdded: kindsAdded,
    liveEffectDelta: a.liveEffects - b.liveEffects,
    majorsDelta: a.majors - b.majors,
    capDelta: mapDelta<number | null>(b.caps, a.caps, (x, y) => (x ?? 0) - (y ?? 0)),
    helpingHandsDelta: mapDelta(b.helpingHands, a.helpingHands, (x, y) => y - x),
    gerrymanderedDelta: mapDelta(b.gerrymandered, a.gerrymandered, (x, y) => y - x),
    marketChanged: a.market.join('|') !== b.market.join('|'),
    conspiracyHandDelta: mapDelta(b.conspiracyHands, a.conspiracyHands, (x, y) => y - x),
    ideologyHandDelta: mapDelta(b.ideologyHands, a.ideologyHands, (x, y) => y - x),
    drawDelta: {
      voter: a.draws.voter - b.draws.voter,
      conspiracy: a.draws.conspiracy - b.draws.conspiracy,
      ideology: a.draws.ideology - b.draws.ideology,
    },
    choiceDelta: a.pendingChoices - b.pendingChoices,
  };
}

const ANY = <T>(m: ReadonlyMap<PlayerID, T>, f: (v: T) => boolean): boolean => [...m.values()].some(f);

/**
 * The ops whose `until` is the DEADLINE OF A RULE WRITTEN NOW rather than a hook's
 * lifetime, re-derived from `reduce.ts isScoped`'s own `if (effect.op === '…') return false`
 * lines rather than typed here.
 *
 * **WHY IT IS DERIVED AND NOT TYPED.** `isScoped` is the single authority on whether an
 * effect is installed or applied, and a fourth op carving itself out there would change
 * what every `until` on that op means. A hand-written list in this file would go stale
 * silently and this checker would keep asserting "a lasting clause installed no live
 * effect" about a card that is working perfectly — which is the false negative that costs
 * a real bug and hides a fake one. Slicing the reducer is the same technique
 * `reducer-parity.test.ts` runs on `applyEffect` and `fireTriggers`, and for the same
 * reason: the registry is only worth anything if it is derived from the thing it describes.
 *
 * `set-cap` is in the set and ships on no card today, which is why nothing caught this
 * before THE QUIET ROOM did. That is the argument for deriving rather than for testing
 * each case.
 */
const DEADLINE_OPS: ReadonlySet<string> = new Set(
  ((): string[] => {
    const src = readFileSync(fileURLToPath(new URL('../../engine/src/reduce.ts', import.meta.url)), 'utf8');
    const start = src.indexOf('function isScoped(');
    expect(start, 'reduce.ts no longer declares isScoped where this reader expects it').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\nfunction applyEffects', start));
    return [...body.matchAll(/if \(effect\.op === '([^']+)'\) return false;/g)].map((m) => m[1] as string);
  })(),
);

const ANY_SEAT_BUT = <T>(m: ReadonlyMap<PlayerID, T>, except: PlayerID, f: (v: T) => boolean): boolean =>
  [...m.entries()].some(([k, v]) => k !== except && f(v));

// ─────────────────────────── the obligations, one per op ───────────────────────────

/**
 * `because` is the printed claim the op makes on the card, quoted in the shape a card
 * would write it. It is documentation of the PROMISE, not a pattern to match against:
 * nothing below reads it. `holds` is the falsifiable part.
 */
type Obligation = {
  readonly because: string;
  readonly holds: (e: ClauseEffect) => boolean;
};

const someSeatGained = (e: ClauseEffect): boolean => ANY(e.poolDelta, (d) => d > 0);
const someSeatLost = (e: ClauseEffect): boolean => ANY(e.poolDelta, (d) => d < 0);

const OBLIGATIONS: Readonly<Record<Effect['op'], Obligation>> = {
  gain: {
    because: '"you gain N resources"',
    holds: (e) => someSeatGained(e) || e.choiceDelta > 0,
  },
  lose: {
    because: '"N loses N" / "donate N"',
    holds: (e) => someSeatLost(e) || e.choiceDelta > 0,
  },
  'gain-any': {
    because: '"gain N resources of their choice"',
    // A decision is the honest observation: the player has not chosen yet, and the
    // choice is where the printed sentence lives. Counting a decision rather than
    // demanding a movement is what keeps this from firing on a card whose caster is at
    // the cap — a real position where the pool cannot rise and the card is not lying.
    holds: (e) => e.choiceDelta > 0 || someSeatGained(e),
  },
  'lose-any': {
    because: '"discard N resources of their choice"',
    holds: (e) => e.choiceDelta > 0 || someSeatLost(e),
  },
  'steal-any': {
    because: '"take N resources FROM an opponent"',
    // THE SIGNATURE OBLIGATION, and the one the brief names: a theft must measurably
    // reduce ANOTHER seat's pool. `ANY_SEAT_BUT` rather than `ANY` is the whole content
    // — a `steal-any` retargeted to `you` moves a pool but steals nothing, and this is
    // the assertion that says so. The conservation half (the thief gains what the victim
    // loses) is deliberately NOT asserted here: the pool can cross the cap on the way in,
    // which is a rule working, not a lie.
    holds: (e) => ANY_SEAT_BUT(e.poolDelta, e.caster, (d) => d < 0),
  },
  voters: {
    because: '"gain N voters"',
    // ON THE MAT, not on the board — see `matDelta`. Both are accepted because a card
    // may legitimately place immediately as part of the same resolution, and the printed
    // sentence is satisfied either way.
    holds: (e) => ANY(e.pegDelta, (d) => d > 0) || ANY(e.matDelta, (d) => d > 0),
  },
  evict: {
    because: '"evict N voters" — a peg LEAVES the board, and the owner gets it back',
    // THE SIGN IS THE CLAIM AND NOTHING ELSE IS. An eviction must reduce the board's peg
    // count; whether the voter returns to its owner's hand is `hand`-shaped and is not
    // what the word says.
    holds: (e) => ANY(e.pegDelta, (d) => d < 0) || ANY(e.matDelta, (d) => d > 0),
  },
  'discard-voter': {
    because: '"discard N voters"',
    holds: (e) => ANY(e.pegDelta, (d) => d < 0) || ANY(e.matDelta, (d) => d > 0),
  },
  'convert-voter': {
    because: '"convert N of an opponent\'s voters into your own"',
    // THE CONSERVATION OBLIGATION, IN AGGREGATE. A conversion moves a peg; it does not make
    // one and it does not destroy one. Pegs on the BOARD only, because a conversion is about
    // placed voters; the mat is where the two sides would meet and mixing them would let a
    // card satisfy the claim by creating and discarding nothing.
    //
    // **AGGREGATE, AND THE PER-PAIR FORM WAS WRONG — a finding, not a preference.** The
    // first version demanded that ONE seat rise by a count that appears verbatim among the
    // seats that fell. That holds only when a card takes both of its voters from ONE
    // opponent, and it fired the moment headline coverage was switched on, on
    // `hl-in2020-012` STAY IN YOUR LIMITS: *"Convert 2 of an opponent's voters into your
    // own"*, which with two opponents on the board and no target converts one from each —
    // `board p1 +2, p2 -1, p3 -1`. That is the printed sentence performed exactly, and the
    // obligation called it a lie. The corrected claim is the one the card makes: the gain
    // is ONE seat's, that seat is the caster, it is positive, and the total taken equals the
    // total gained.
    //
    // Teeth, so this is a correction and not a relaxation: `voters` fails (it creates, so
    // the downs do not balance the ups), `evict` and `discard-voter` fail (nothing rises),
    // and a conversion that hands a peg to a second seat fails on `ups.length !== 1` —
    // which is the specific thing that separates a conversion from a grant.
    holds: (e) => {
      const ups = [...e.pegDelta.entries()].filter(([, d]) => d > 0);
      const downs = [...e.pegDelta.entries()].filter(([, d]) => d < 0);
      if (ups.length !== 1) return false;
      const [seat, gained] = ups[0] as [PlayerID, number];
      const taken = downs.reduce((sum, [, d]) => sum - d, 0);
      return seat === e.caster && gained > 0 && gained === taken;
    },
  },
  gerrymander: {
    because: '"Gerrymander N" — a peg flips, so a MAJORITY appears or a right is earned',
    holds: (e) => e.majorsDelta !== 0 || ANY(e.gerrymanderedDelta, (d) => d !== 0),
  },
  'draw-conspiracy': {
    because: '"draw N Conspiracy Cards"',
    holds: (e) => e.drawDelta.conspiracy < 0 || ANY(e.conspiracyHandDelta, (d) => d > 0),
  },
  'refresh-market': {
    because: '"discard every open Voter Card and deal fresh ones"',
    holds: (e) => e.marketChanged,
  },
  restrict: {
    because: '"you may not …" / "every purchase costs …"',
    // A restriction is a RULE, and the honest observation is that the list it lands on
    // GREW. Which rule is checked separately, and much more sharply, by
    // `RESTRICTION_KIND_CLAIMS` below — because "a rule appeared" and "the rule the
    // card printed appeared" are different claims and C1 lived in the gap between them.
    holds: (e) => ANY(e.restrictionDelta, (d) => d > 0),
  },
  discount: {
    because: '"a discount on N purchases"',
    holds: (e) => ANY(e.helpingHandsDelta, (d) => d < 0),
  },
  'move-card': {
    because: '"this is an extra Ideology Card" / "take N cards"',
    holds: (e) => e.drawDelta.ideology < 0 || ANY(e.ideologyHandDelta, (d) => d > 0),
  },
  'borrow-power': {
    because: '"use all their Level 3 Ideologue Powers this turn"',
    holds: (e) => e.restrictionKindsAdded.includes('borrowed-powers') || e.choiceDelta > 0,
  },
'set-cap': {
    because: '"reduce your resource cap to N"',
    // NOT "a cap exists" - that is `hold` for the `restrict` op and it is the weaker
    // claim. This one asserts the cap actually came DOWN, because a cap raised by a card
    // that says it reduces one is a card lying in the direction that helps its owner.
    holds: (e) => ANY(e.capDelta, (d) => d > 0),
  },
  'move-peg': {
    because: '"the player after you may move 1 of your non-majority voters to an adjacent zone"',
    // THE OBLIGATION IS THE OFFER, and the reason is the same one `gain-any` gives: the
    // printed sentence is satisfied by the DECISION existing, because the beneficiary
    // has not chosen yet and the choice is where the sentence lives. A board on which
    // the actor holds no movable voter raises nothing at all, and that is the
    // unsatisfiable-choice rule rather than the card failing to work - so asserting a
    // peg MOVED would fail on exactly the correct behaviour.
    //
    // `majorsDelta` is deliberately not consulted. A relocation can form or break a
    // majority on either side of the move, and it can do neither; a peg moving at all is
    // the only claim that is true every time, and it is what `packages/engine`'s own
    // `choose-peg-dest` test asserts directly.
    holds: (e) => e.choiceDelta > 0,
  },
};

/**
 * THE CLAUSE THAT NEEDS A KIND, NOT JUST A GROWTH.
 *
 * `restrict`'s obligation above can only say "a rule appeared". C1 is the case where
 * that is not enough: the card printed *"you cannot make any purchases until you
 * donate"*, the engine imposed a `no-purchases` entry, and the entry was then discharged
 * by an opponent's drain. Nothing about GROWTH catches that, and nothing about the KIND
 * catches it either — so the kind is checked here, and the DISCHARGE is checked in the
 * C1 block further down, which is behavioural and does not read this table.
 */
const RESTRICTION_KIND_CLAIMS: readonly { readonly kind: string; readonly printed: RegExp; readonly why: string }[] = [
  { kind: 'no-purchases', printed: /cannot make any purchases|may not purchase|cannot purchase/i, why: 'p12\'s purchase freeze' },
  { kind: 'surcharge', printed: /costs? (?:any )?\d+ extra|extra resource for every/i, why: 'a permanent purchase tax' },
  { kind: 'no-power', printed: /cannot use (?:any|all|one of your|your)/i, why: 'a power lock-out' },
  { kind: 'no-income', printed: /will not receive any resources/i, why: 'G18\'s suppressed answer payout' },
  { kind: 'voter-shortfall', printed: /get \d+ less voter|less voter on/i, why: 'G14b\'s shortened Voter Cards' },
];

// ─────────────────────────── the EXCLUSION list, which is a deliverable ───────────────────────────

/**
 /**
 * THE CLAIMS THAT NEED NO POSITION, because the promise is about the SHAPE of the
 * reduction rather than about a number moving.
 *
 * ## WHY THIS ARM EXISTS AT ALL, and it is the brief's own example
 *
 * *"a card claiming 'steal' measurably reduces another seat's pool"* needs a seat to
 * reduce. That measurement is the per-op obligation above and it is the strong claim —
 * but it can only be made about a clause that EXISTS, so it cannot see a card whose
 * printed verb has no clause at all. C1's corpus-side shape is exactly that: a printed
 * sentence and a reduction that never attempts what the sentence names.
 *
 * These are reduction-shape claims, checked for every card including Headline Cards, and
 * each is falsifiable: swap one op for another and it fires.
 */
const SHAPE_CLAIMS: readonly { readonly printed: RegExp; readonly says: string; readonly needs: (e: Effect) => boolean }[] = [
  {
    printed: /take \d+ resources? of your choice from a chosen opponent/i,
    says: 'takes resources FROM an opponent',
    needs: (e) => e.op === 'steal-any',
  },
  {
    printed: /every opponent (?:discards?|loses?)/i,
    says: 'takes from EVERY opponent',
    // `lose` AND `lose-any`: "discards 1 Funds" is a fixed amount and "discards 1 of
    // their choice" is a decision, and both really do take from every opponent. Only the
    // TARGET is the claim here — the amount is the card's own business.
    needs: (e) => (e.op === 'lose' || e.op === 'lose-any') && e.target === 'each-opponent',
  },
  {
    printed: /every (?:player|opponent) may gerrymander/i,
    says: 'lets EVERY seat Gerrymander',
    needs: (e) => e.op === 'gerrymander' && (e.target === 'everyone' || e.target === 'each-opponent'),
  },
  {
    printed: /donate \d+ (?:funds|clout|media|trust|resources)/i,
    says: 'takes resources from the caster themselves',
    needs: (e) => e.op === 'lose' && (e.target === undefined || e.target === 'you'),
  },
];

/**
 * PRINTED CLAIMS THIS FILE DELIBERATELY DOES NOT CHECK, each with the reason.
 *
 * Every entry is a pattern that matches real card text, and the test asserts that each
 * one still matches at least one card — because an exclusion list that has rotted into
 * naming nothing is worse than no list: it reads as coverage.
 */
const EXCLUDED: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /of (?:their|your) choice/i, why: 'the CHOICE is verified (a decision is raised); which denomination was picked is a player choice, and a greedy fixture pick is not a claim about the card' },
  { pattern: /immediately|right away|at once/i, why: 'TIMING. A card\'s clauses resolve in list order inside one `reduce()` call, and there is no clock in state to observe an ordering claim against. Refusing it would mean asserting something about the reducer\'s internals, which is `reducer-parity`\'s job and not this file\'s' },
  { pattern: /under the normal gerrymander\w* rules|normal rules/i, why: 'a CROSS-REFERENCE to the rulebook rather than a state claim; what the rules require is `gerrymander`\'s obligation here, and the reference itself has no measurable content' },
  { pattern: /may |can |up to \d+|or\b/i, why: 'OPTIONALITY AND BRANCHING. "may", "can", "up to N" and "either/or" are all statements about what a player is PERMITTED, and permission is the absence of a refusal — which needs a player who deliberately attempts the forbidden thing to observe' },
  { pattern: /cannot be converted|volatile/i, why: 'a NEGATIVE about the board\'s own state ("Voters in Volatile Areas cannot be converted"). It is checkable — `g16-zone.test.ts` checks it — but it is a property of the FIXTURE rather than of the card, so the card passes or fails on the fixture and the signal would be noise' },
  { pattern: /is (?:not )?(?:performed|expressed|dropped)|DROPPED/i, why: 'the corpus NARRATES its own dropped clauses in `source` and sometimes in `text`. That is the project being honest, and this file must not read an admission of a dropped clause as a claim to verify' },
  { pattern: /\b(?:2|3|two|three|each|all)\s+(?:other\s+)?(?:separate\s+|different\s+)?(?:players?|opponents?)\b/i, why: 'PLURALITY beyond one seat. `applyEffect` computes ONE `target` for a whole effect list, so a card printing "2 opponents" cannot express it, and a check here would fire on every such card for a reason that is a documented drop rather than a regression' },
  { pattern: /if |unless |when you|should the|does the/i, why: 'CONDITIONALS. No op reads board state to decide a payout (G2), so every conditional clause in the corpus is a documented drop. Checking them would mean asserting that a card with an `if` in its text does less than it says, which is true of most of the corpus and is therefore not a finding' },
];

// ─────────────────────────── the corpus sweep ───────────────────────────

type ShippedCard = {
  readonly id: CardID;
  readonly name: string;
  readonly text: string;
  readonly effects: readonly Effect[];
  readonly kind: 'conspiracy' | 'headline';
};

const SHIPPED: readonly ShippedCard[] = [
  ...corpus.conspiracy.map((c) => ({ id: c.id, name: c.name, text: c.text, effects: c.effects as readonly Effect[], kind: 'conspiracy' as const })),
  ...corpus.headline.map((c) => ({ id: c.id, name: c.name, text: c.text, effects: c.effects as readonly Effect[], kind: 'headline' as const })),
];

/**
 * Resolve a HEADLINE through the path its kind really takes, with `override` standing in
 * for the card's own effect list.
 *
 * ## THE OBSTRUCTION THIS DISSOLVES, and it is a real one
 *
 * A Headline resolves through the post-turn queue, and the queue drains inside
 * `ACK_HEADLINE`, which calls `nextHeadlineOrAdvance` — and that **advances the turn** when
 * the queue empties. A leave-one-out measurement compares two states, so a turn boundary
 * between them rewrites the active player, pays a different passive bonus, draws the next
 * Ideology Card and can raise p12's own decision. Every delta would be that noise, and the
 * honest-looking answer would be to stop measuring Headlines at all — which is exactly what
 * `disagreements` used to do, silently, in one line: `if (card.kind !== 'conspiracy') return`.
 *
 * ## THE FIX IS A TWO-ENTRY QUEUE, and it is not a trick
 *
 * `ACK_HEADLINE` advances the turn **only when the queue empties**. So a position with the
 * card under test `activeHeadline` and a SECOND entry still queued comes back with the
 * card's effects applied, the first entry sliced off, and the turn exactly where it was.
 * The comparison is then between two states that differ only by the clause. The second
 * entry needs a card in the draw pile to resolve to, or `draw` returns `null` and the
 * advance happens anyway.
 *
 * Nothing here reaches around the engine: the position is a `GameState`, the action is the
 * real `ACK_HEADLINE`, and the effects are applied by `reduce`.
 */
function resolveHeadline(s: GameState, card: ShippedCard, override?: readonly Effect[]): { readonly raw: GameState; readonly settled: GameState } | { readonly error: string } {
  const effects = override ?? card.effects;
  const original = CTX.cards.headline[card.id];
  if (original === undefined) return { error: `no headline card ${card.id} in the index` };
  // CONTENT, not identity — see `sameEffects`. A corrupted Headline's effect list is the
  // corruptor's own array, so the identity test this replaced was always true for one and
  // the corruption never reached the engine.
  const ctx: Ctx = sameEffects(effects, original.effects)
    ? CTX
    : { ...CTX, cards: { ...CTX.cards, headline: { ...CTX.cards.headline, [card.id]: { ...original, effects: effects as HeadlineCard['effects'] } } } };
  // A Volatile Area whose placement drew the Headline — the shape p18 describes, and what
  // `zone: 'this-zone'` reads off `headlineQueue[0].areaId`. The AREA does not have to be
  // volatile for this file: `zone: 'this-zone'` needs the entry, and a headline that does
  // not use the selector ignores it.
  const areaId = s.zones.flatMap((z) => z.areas).find((a) => a.volatile)?.id ?? s.zones[0]?.areas[0]?.id;
  if (areaId === undefined) return { error: 'the fixture board has no areas' };
  // ONE card still to come, so the queue does not empty and the turn does not advance.
  const nextUp = corpus.headline.map((h) => h.id).find((id) => id !== card.id);
  if (nextUp === undefined) return { error: 'the corpus has no second headline to queue' };
  const staged: GameState = {
    ...s,
    phase: 'headlines',
    activeHeadline: card.id,
    headlineQueue: [
      { areaId, by: 'p1' },
      { areaId, by: 'p1' },
    ],
    _headlineDraw: [nextUp, ...s._headlineDraw.filter((id) => id !== nextUp)],
  };
  const r = reduce(staged, 'p1', { type: 'ACK_HEADLINE' }, ctx);
  if (!r.ok) return { error: r.error };
  return { raw: r.state, settled: settle(r.state) };
}

/**
 * THE CHECK, once per card, over the card's OWN effect list.
 *
 * Returns every clause that failed its op's obligation, or `[]` when the card agrees with
 * itself. It is an exported plain function so the TEETH block below can call it on a
 * deliberately corrupted reduction — the only honest way to claim a checker has teeth is
 * to show it biting.
 *
 * ## IT WALKS HEADLINES TOO, and until 2026-10 it did not
 *
 * The old first line was `if (card.kind !== 'conspiracy') return bad;`, and the comment
 * above it gave a real reason — a Headline resolves through the queue and could not be
 * leave-one-out-ed from a fixed position. The reason was true and the conclusion was not:
 * `resolveHeadline` above solves it with a two-entry queue, so **every** shipped effect is
 * measured, Headline included. That matters because the ops only a Headline ships are
 * exactly the ops nothing else reached: `move-peg` (GREAT LEADER, BAD ECONOMY),
 * `borrow-power` and `set-cap`. A suite that skips a whole card kind is a suite whose
 * second list is a list of CLAIMS rather than of coverage, and the card that caused a
 * five-instance dead-table class was on the skipped side of the line.
 */
export function disagreements(card: ShippedCard, position: GameState): readonly string[] {
  const bad: string[] = [];
  if (card.effects.length === 0) return bad;
  const resolve = card.kind === 'conspiracy' ? play : resolveHeadline;
  const base = resolve(position, card);
  if ('error' in base) return [`${card.id} was refused outright: ${base.error}`];
  for (const [i, effect] of card.effects.entries()) {
    const rest = card.effects.filter((_, j) => j !== i) as Effect[];
    const without = resolve(position, card, rest);
    if ('error' in without) {
      bad.push(`${card.id} clause ${i} (${effect.op}): removing it changed the refusal (${without.error}), so the clause cannot be measured`);
      continue;
    }
    // TWO measurements of the same clause. `settled` is what the card's EFFECT did; `raw`
    // is what it OFFERED. An obligation may be satisfied by either, and which one carries
    // the claim is a property of the verb — "gain N of their choice" is satisfied by the
    // offer, "discard N voters" by the settled board.
    const settled = clauseEffect(base.settled, without.settled, 'p1');
    const raw = clauseEffect(base.raw, without.raw, 'p1');
    // A SCOPED CLAUSE IS NOT MEASURED BY ITS OP, and this is where that is decided rather
    // than assumed. `when`/`until`/`condition` puts the effect on a live hook: nothing
    // happens at resolution, so every op obligation would report it as a no-op and the
    // honest question is a different one — did the card install anything at all? That is
    // `liveEffectDelta`, and it is asserted for EVERY op rather than per op, because it is
    // a claim about the card rather than about the verb.
    //
    // `ct-et2040-019` is the fixture that forces this: POWER TRIP hooks
    // `on-voter-influenced` and does nothing on the turn it resolves.
    const scoped = effect.when !== undefined || effect.until !== undefined || effect.condition !== undefined;
    // …AND THE CARVE-OUT, which is `isScoped`'s own and is re-derived from the reducer's
    // own source rather than typed here. Three ops carry `until` WITHOUT being scoped:
    // `restrict` and `borrow-power` write a `Restriction` and `set-cap` writes a cap, and on
    // all three `until` is the DEADLINE OF THE RULE BEING WRITTEN NOW rather than a hook's
    // lifetime. `reduce.ts isScoped` argues that separately for each of the three. Without
    // the carve-out this block asserts a falsehood about every lasting `restrict` in the
    // corpus — and it surfaced only when THE QUIET ROOM shipped one, which is the usual
    // way a checker's blind spot is found.
    if (scoped && !DEADLINE_OPS.has(effect.op)) {
      if (settled.liveEffectDelta <= 0 && raw.liveEffectDelta <= 0) {
        bad.push(`${card.id} clause ${i} (${effect.op}) — a lasting clause — installed NO live effect`);
      }
      continue;
    }
    const obligation = OBLIGATIONS[effect.op];
    if (!obligation.holds(settled) && !obligation.holds(raw)) {
      bad.push(`${card.id} clause ${i} (${effect.op}) — ${obligation.because} — settled: ${explain(settled)} | offered: ${explain(raw)}`);
    }
  }
  return bad;
}

/** A short, readable account of what a clause actually did, for a failure message. */
function explain(e: ClauseEffect): string {
  const parts: string[] = [];
  const pools = [...e.poolDelta.entries()].filter(([, d]) => d !== 0).map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`);
  if (pools.length > 0) parts.push(`pools ${pools.join(', ')}`);
  const pegs = [...e.pegDelta.entries()].filter(([, d]) => d !== 0).map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`);
  if (pegs.length > 0) parts.push(`board ${pegs.join(', ')}`);
  const mat = [...e.matDelta.entries()].filter(([, d]) => d !== 0).map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`);
  if (mat.length > 0) parts.push(`mat ${mat.join(', ')}`);
  if (ANY(e.restrictionDelta, (d) => d !== 0)) parts.push(`restrictions ${[...e.restrictionDelta].filter(([, d]) => d !== 0).map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`).join(', ')}`);
  if (e.restrictionKindsAdded.length > 0) parts.push(`kinds +${e.restrictionKindsAdded.join('+')}`);
  if (e.capDelta.size > 0 && ANY(e.capDelta, (d) => d !== 0)) parts.push('cap moved');
  if (e.helpingHandsDelta.size > 0 && ANY(e.helpingHandsDelta, (d) => d !== 0)) parts.push('helpingHands moved');
  if (e.majorsDelta !== 0) parts.push(`majors ${e.majorsDelta > 0 ? '+' : ''}${e.majorsDelta}`);
  if (e.marketChanged) parts.push('market changed');
  if (e.drawDelta.conspiracy !== 0) parts.push(`conspiracy draw ${e.drawDelta.conspiracy}`);
  if (e.drawDelta.ideology !== 0) parts.push(`ideology draw ${e.drawDelta.ideology}`);
  if (e.choiceDelta !== 0) parts.push(`choices ${e.choiceDelta > 0 ? '+' : ''}${e.choiceDelta}`);
  return parts.length === 0 ? 'NOTHING AT ALL' : parts.join('; ');
}

describe('semantic agreement — every clause of every shipped card does what its op promises', () => {
  it('no shipped card clause contradicts the op it is written with, CONSPIRACY OR HEADLINE', () => {
    // THE HEADLINES ARE IN HERE NOW, and their being here is the fix. `disagreements` used
    // to return `[]` for every Headline on its first line, so the sweep asserted a clause
    // count that was silently conspiracy-only and the ops a Headline alone ships —
    // `move-peg`, `borrow-power`, `set-cap` — were never measured by anything in this file.
    // `resolveHeadline`'s two-entry queue is what makes the measurement possible at all.
    const position = game();
    const failures: string[] = [];
    let checked = 0;
    let headlines = 0;
    for (const card of SHIPPED) {
      if (card.effects.length === 0) continue;
      failures.push(...disagreements(card, position));
      checked += 1;
      if (card.kind === 'headline') headlines += 1;
    }
    expect(checked, 'no card was checked, so nothing was proved').toBeGreaterThan(20);
    expect(headlines, 'no HEADLINE was checked, so the skipped half is back').toBeGreaterThanOrEqual(20);
    expect(failures, `${failures.length} clause(s) do not do what their op promises:\n${failures.join('\n')}`).toEqual([]);
  });

  it('and every op a CONSPIRACY CARD uses HAS an obligation, so none is unchecked by omission', () => {
    // The failure this guards is a new op shipping with no obligation: it would simply
    // not be asserted, and a checker with a silent hole is the thing this file exists to
    // be different from.
    //
    // The direction is deliberately ONE-WAY, and the other direction is the interesting
    // one: an obligation may exist for an op no Conspiracy Card uses. Three ops are in
    // that position — `borrow-power`, `set-cap` and `move-peg` — and all three ship on
    // HEADLINE Cards ONLY. That is now a fact about the SWEEP rather than about coverage:
    // the clause checker above walks every shipped effect, headline included, through
    // `OBLIGATIONS` and fails on one that does not hold, so "no Conspiracy Card uses it" is
    // no longer the same sentence as "nothing checks it". `set-cap` and `borrow-power` are
    // additionally checked by kind (`RESTRICTION_KIND_CLAIMS`' shadow: a `borrowed-powers`
    // entry and a `capOverride`) and `packages/cards/test/card-playback.test.ts` drives
    // both; `move-peg` has a behavioural probe of its own in the `move-peg` block below,
    // because its obligation (`choiceDelta > 0`) is about the OFFER and the offer needs the
    // trigger to fire, which a headline's own resolution does not do.
    //
    // `gain-any` LEFT this list when FEED THE TICKER shipped as `ct-et2040-020`, which is
    // the assertion working: an op that used to have no Conspiracy Card at all now has one,
    // and the list says so.
    const used = new Set<Effect['op']>();
    for (const card of SHIPPED) {
      if (card.kind !== 'conspiracy') continue;
      for (const e of card.effects) used.add(e.op);
    }
    expect([...used].filter((op) => !(op in OBLIGATIONS)), 'a Conspiracy Card uses an op with no obligation').toEqual([]);
    // …and the obligations that no Conspiracy Card reaches are exactly those named.
    expect(Object.keys(OBLIGATIONS).filter((op) => !used.has(op as Effect['op'])).sort()).toEqual(['borrow-power', 'convert-voter', 'gerrymander', 'move-peg', 'set-cap']);
  });

  it('and a card printing a RESTRICTION names the kind it actually imposes', () => {
    // The `restrict` obligation can only say "a rule appeared". This says WHICH, by
    // matching the printed claim against the kinds in the effect list — a shape claim,
    // not a position claim, so it covers Headline Cards too.
    const failures: string[] = [];
    for (const card of SHIPPED) {
      for (const claim of RESTRICTION_KIND_CLAIMS) {
        if (!claim.printed.test(card.text)) continue;
        const kinds = card.effects.filter((e) => e.op === 'restrict').map((e) => (e as { kind: string }).kind);
        if (!kinds.includes(claim.kind)) {
          failures.push(`${card.id} "${card.name}" prints ${claim.why} but restricts ${kinds.join('/') || 'nothing'}`);
        }
      }
    }
    expect(failures, `${failures.length} card(s) print a restriction they do not impose:\n${failures.join('\n')}`).toEqual([]);
  });

  it('and a card printing a SHAPE claim contains a clause of the shape it promises', () => {
    // The reduction-shape arm, and the one that covers Headline Cards. C1's corpus-side
    // shape lives here: a printed sentence naming a verb, and a reduction that never
    // attempts it.
    const failures: string[] = [];
    let armed = 0;
    for (const card of SHIPPED) {
      for (const claim of SHAPE_CLAIMS) {
        if (!claim.printed.test(card.text)) continue;
        armed += 1;
        if (!card.effects.some(claim.needs)) {
          failures.push(`${card.id} "${card.name}" prints that it ${claim.says}, and no clause does: ${JSON.stringify(card.effects.map((e) => e.op))}`);
        }
      }
    }
    expect(armed, 'no shape claim was armed, so the arm is not reaching the corpus').toBeGreaterThan(0);
    expect(failures, `${failures.length} card(s) print a shape they do not have:\n${failures.join('\n')}`).toEqual([]);
  });

  it('and the exclusions still match real cards, so the list has not rotted', () => {
    // Every entry is a pattern; a pattern that matches nothing is a permission slip that
    // reads as coverage. And the armed-plus-excluded count is asserted so a card whose
    // text falls through BOTH is visible rather than silent.
    const unused = EXCLUDED.filter((x) => !SHIPPED.some((c) => x.pattern.test(c.text))).map((x) => `${x.pattern} — ${x.why}`);
    expect(unused, `${unused.length} exclusion(s) match no shipped card:\n${unused.join('\n')}`).toEqual([]);
    const covered = SHIPPED.filter((c) => EXCLUDED.some((x) => x.pattern.test(c.text)) || RESTRICTION_KIND_CLAIMS.some((k) => k.printed.test(c.text)));
    expect(covered.length, 'no shipped card text is covered by any claim or exclusion, so the arms are not reaching the corpus').toBeGreaterThan(0);
  });
});

// ─────────────────────────── `move-peg`: the probe that HAS to be behavioural ───────────────────────────

/**
 * GREAT LEADER, BAD ECONOMY (`hl-et2040-022`), and the reason this block exists at all.
 *
 * ## WHAT THE CLAUSE SWEEP CANNOT SEE ABOUT THIS OP
 *
 * `move-peg`'s obligation is `choiceDelta > 0` — *"the OFFER was made"* — and that is the
 * right shape for a card whose printed sentence lives inside a decision. But GREAT LEADER
 * is a SCOPED clause: `when: 'on-voter-influenced'`, `until: 'rest-of-game'` and a
 * three-voter condition. Resolving the Headline therefore installs a live effect and
 * offers nothing, so the sweep's `scoped` branch measures `liveEffectDelta` — "did it
 * install a hook" — and stops. The hook never fires in a headline resolution.
 *
 * Before headline coverage existed the sweep did not even reach that branch, because
 * `disagreements` returned `[]` for every Headline on its first line. So **the op had an
 * obligation, and nothing in this file ran it**, and the list at
 * "an op a CONSPIRACY CARD uses" cited this very clause as its justification for keeping
 * `move-peg` on a reached-by-nobody list. That is a claim about coverage made by a
 * coverage list, which is not evidence.
 *
 * ## SO THIS IS A BEHAVIOURAL PROBE, and it is the instrument the C1 block already uses
 *
 * Drive the real card from the real engine: resolve the Headline, then have its owner
 * influence a 3-Voter Card, and assert that a `'choose-peg-dest'` is raised for the seat
 * AFTER them — naming the OWNER's peg, which is the whole of the card — and that
 * answering it moves that peg to an empty area in a NEIGHBOURING zone.
 *
 * This is also the honest answer to "does `reduce()` execute `move-peg` at all": **yes**,
 * in two places. `applyEffect`'s `case 'move-peg'` raises the decision and
 * `resolveChoice`'s `case 'choose-peg-dest'` performs the two `setArea` calls. The engine
 * was never the problem; the checker was the only thing in the repository that could not
 * see it.
 */
describe('move-peg is EXECUTED, which is the only thing a per-clause sweep cannot show', () => {
  /** A 3-Voter Card, priced in Funds, taken from the shipped corpus rather than invented. */
  const THREE_VOTERS = 'vo-core-009';

  /** The card under test, taken from `SHIPPED` so the fixture is the shipped reduction. */
  function leader(): ShippedCard {
    const c = SHIPPED.find((x) => x.id === 'hl-et2040-022');
    if (c === undefined) throw new Error('GREAT LEADER, BAD ECONOMY is not in the corpus');
    return c;
  }

  /**
   * `game()`, arranged so the card has something to offer: p1 owns one NON-MAJORITY peg in
   * `north_west`, `north` is empty and adjacent, and the HQ Mat's first slot is a
   * 3-Voter Card p1 can afford — because `influencedVotersAtLeast: 3` is read off the
   * PURCHASED CARD, not off a running total.
   */
  function arranged(): GameState {
    const base = game();
    return {
      ...base,
      market: [{ cardId: THREE_VOTERS, cost: { funds: 3 }, voters: 3 }, ...base.market.slice(1)],
      players: {
        ...base.players,
        p1: { ...base.players.p1!, resources: { funds: 6, clout: 1, media: 1, trust: 1 } },
      },
      zones: base.zones.map((z) => ({
        ...z,
        areas: z.areas.map((a) => {
          // The peg the card may offer: p1's, non-majority, in a zone with free neighbours.
          if (a.id === 'north_west-01') return { ...a, peg: { owner: 'p1' as PlayerID, majority: false } };
          // And no other peg anywhere, so "the peg on offer" is unambiguous.
          return a.peg === null ? a : { ...a, peg: null };
        }),
      })),
    };
  }

  /**
   * THE INSTALLED HOOK, grafted onto a live `actions` position.
   *
   * **A FIXTURE EDIT, and it is labelled because it is the one thing in this block that is
   * not the engine talking.** A Headline resolves through the post-turn queue, so the state
   * the engine hands back is a `headlines` phase with the NEXT Headline queued — there is no
   * action a player can take from it, and `INFLUENCE` is refused with *"answer your Ideology
   * Card first"*. Draining the queue would advance the turn and take the card's owner out of
   * the active seat, and `byOwner: true` means the influencer has to BE the owner.
   *
   * So the two halves are separated, which is what the block wants to assert anyway:
   *
   *  - "resolving the Headline installed the hook" is measured on the engine's own result;
   *  - "the hook FIRES on the right event, names the right seat and the right owner, and the
   *    answer relocates that peg" is measured on a position whose `liveEffects` is that
   *    engine-produced array and whose everything else is a fixture.
   *
   * Nothing about the trigger is asserted by proxy: the `INFLUENCE` below is a real action
   * through the real reducer, and `reduce` has no way to know the hook was grafted.
   */
  function installedOnLivePosition(): GameState {
    const base = arranged();
    const resolved = resolveHeadline(base, leader());
    if ('error' in resolved) throw new Error(`GREAT LEADER was refused: ${resolved.error}`);
    expect(resolved.raw.liveEffects.length, 'the Headline installed no live effect to graft').toBeGreaterThan(0);
    return { ...base, liveEffects: resolved.raw.liveEffects };
  }

  it('installs a live effect and NOTHING else when the Headline resolves', () => {
    const before = snapshot(arranged());
    const r = resolveHeadline(arranged(), leader());
    expect('error' in r, `the Headline was refused: ${'error' in r ? r.error : ''}`).toBe(false);
    if ('error' in r) return;
    const after = snapshot(r.settled);
    expect(after.liveEffects - before.liveEffects, 'a lasting clause installed no live effect').toBeGreaterThan(0);
    // The OFFER is the thing the trigger owes, and it is emphatically not owed at install.
    expect(after.pendingChoices, 'the Headline offered a relocation before anything was influenced').toBe(before.pendingChoices);
  });

  it('and the trigger FIRES: the owner influences a 3-Voter Card and the NEXT seat is offered the owner\'s peg', () => {
    const fired = reduce(installedOnLivePosition(), 'p1', { type: 'INFLUENCE', slot: 0 }, CTX);
    expect(fired.ok, `INFLUENCE was refused: ${fired.ok ? '' : fired.error}`).toBe(true);
    if (!fired.ok) return;

    const offered = fired.state.choices.find((c) => c.choice.kind === 'choose-peg-dest');
    expect(offered, 'influencing a 3-Voter Card raised no relocation offer at all').toBeDefined();
    if (offered === undefined) return;
    // THE SEAT, THE OWNER AND THE SCOPE — the three facts that make this card the card.
    expect(offered.player, "the card says 'the player after you'").toBe('p2');
    expect(offered.player === 'p1', 'the beneficiary must not be the actor').toBe(false);
    expect(offered.choice.kind === 'choose-peg-dest' && offered.choice.source, 'the peg offered must be the ACTOR\'s').toBe('p1');
    expect(offered.choice.kind === 'choose-peg-dest' && offered.choice.scope).toBe('others');
  });

  it('and answering it RELOCATES the owner\'s peg into a neighbouring zone, and only there', () => {
    const start = installedOnLivePosition();
    const fired = reduce(start, 'p1', { type: 'INFLUENCE', slot: 0 }, CTX);
    if (!fired.ok) throw new Error(`INFLUENCE was refused: ${fired.error}`);
    const offered = fired.state.choices.find((c) => c.choice.kind === 'choose-peg-dest');
    if (offered === undefined) throw new Error('no relocation offer, so nothing to answer');

    const moved = reduce(fired.state, offered.player, { type: 'RESOLVE_CHOICE', choiceId: offered.id, pick: { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' } }, CTX);
    expect(moved.ok, `the relocation was refused: ${moved.ok ? '' : moved.error}`).toBe(true);
    if (!moved.ok) return;
    const areas = moved.state.zones.flatMap((z) => z.areas);
    expect(areas.find((a) => a.id === 'north_west-01')?.peg, 'the peg did not leave').toBeNull();
    expect(areas.find((a) => a.id === 'north-01')?.peg, 'the peg did not land').toEqual({ owner: 'p1', majority: false });
    expect(moved.events.some((e) => e.type === 'gerrymandered'), 'the client is told about the move').toBe(true);
    // …and the negative half, because "it moved" alone would pass for a board-wide teleport.
    const sameZone = reduce(fired.state, offered.player, { type: 'RESOLVE_CHOICE', choiceId: offered.id, pick: { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north_west-02' } }, CTX);
    expect(sameZone.ok, 'a same-zone landing is not "adjacent" and must be refused').toBe(false);
  });

  it('and the clause sweep ALONE would not have caught any of that, which is why this block is separate', () => {
    // The instrument-validity assertion, and the reason the two blocks are not merged. The
    // sweep sees GREAT LEADER as a SCOPED clause and stops at "did it install a live effect",
    // which is true of the shipped card and of a card whose hook never fires at all. If
    // `disagreements` ever grows the power to fire the trigger, the first assertion below
    // fails and the prose above can be deleted rather than left as a claim.
    const base = arranged();
    expect(disagreements(leader(), base), 'the sweep now detects the corruption this probe exists for').toEqual([]);
    // …and the corruption the sweep DOES see: the hook removed, leaving a card that prints a
    // relocation and can never perform one on its own trigger.
    const unscoped: ShippedCard = { ...leader(), effects: [{ op: 'move-peg', n: 1, target: 'player-after' } as Effect] };
    const installed = resolveHeadline(base, unscoped);
    expect('error' in installed, `the unscoped card was refused: ${'error' in installed ? installed.error : ''}`).toBe(false);
    if ('error' in installed) return;
    expect(installed.raw.choices.some((c) => c.choice.kind === 'choose-peg-dest'), 'an unscoped move-peg offered nothing on resolution').toBe(true);
    // …which is `applyEffect`'s arm being reachable at all, so the two engine sites are named
    // here rather than left as a claim in a docstring.
    expect(settle(installed.raw).zones.flatMap((z) => z.areas).find((a) => a.id === 'north_west-01')?.peg, 'answering the unscoped offer did not relocate the peg').toBeNull();
  });
});

// ─────────────────────────── the C1 obligation, in behavioural form ───────────────────────────

/**
 * THE AUDIT'S DEFECT AS A BEHAVIOURAL OBLIGATION, and the reason this file exists.
 *
 * `reducer-parity` could not see C1 and will never see it, because C1 is not an
 * unexecuted field or an unknown op — it is a fully executed reduction whose *discharge
 * condition* was wrong. So the check is the only place it can live, and it is stated as
 * two measurements rather than as a reading of the source:
 *
 *  1. a card printing *"you cannot make any purchases until you donate"* must impose a
 *     `no-purchases` restriction (the KIND arm above) — and
 *  2. **that restriction must be discharged by a DONATION and by nothing else.** An
 *     opponent's drain must leave it exactly where it was.
 *
 * (2) is the falsifiable one, and it is checked here against the real reducer with the
 * real corpus op vocabulary, using synthetic cards because no corpus card ships a
 * `no-purchases` lock — which is itself a finding, asserted below.
 */
describe('C1 — a purchase lock is discharged by a donation and by nothing else', () => {
  /** The printed sentence, verbatim from the audit's finding. */
  const LOCKING = {
    id: 'sem-khaki' as CardID,
    name: 'A Terror',
    text: 'Donate 1 resource of each type to the Public Reserve. You cannot make any purchases until you do so.',
    effects: [
      { op: 'restrict', kind: 'no-purchases', value: 0, owed: 4, owedRes: { funds: 1, clout: 1, media: 1, trust: 1 }, until: 'rest-of-game' },
      { op: 'lose', res: { funds: 1, clout: 1, media: 1, trust: 1 } },
    ] as Effect[],
  };
  /** Somebody else's drain, with no donation clause at all. */
  const DRAIN: Playable = {
    id: 'sem-drain' as CardID,
    name: 'A Drain',
    text: 'Every opponent loses any 4 Funds.',
    effects: [{ op: 'lose', res: { funds: 4 }, target: 'each-opponent' }],
  };
  /** A real donation: the locked player gives to the Public Reserve. */
  const DONATE: Playable = {
    id: 'sem-donate' as CardID,
    name: 'A Donation',
    text: 'Donate 1 resource of each type to the Public Reserve.',
    effects: [{ op: 'lose', res: { funds: 1, clout: 1, media: 1, trust: 1 } }],
  };
  const shipped: ShippedCard = { ...LOCKING, kind: 'conspiracy' };

  /** The two orders, because the ORDER is half of C1 and only one of them leaves a lock. */
  const tight = (): GameState => must('tight', play(game(), LOCKING, LOCKING.effects)).settled;
  const loose = (): GameState => must('loose', play(game(), LOCKING, [LOCKING.effects[1]!, LOCKING.effects[0]!])).settled;
  function must(what: string, r: { readonly raw: GameState; readonly settled: GameState } | { readonly error: string }): { readonly raw: GameState; readonly settled: GameState } {
    if ('error' in r) throw new Error(`${what}: ${r.error}`);
    return r;
  }
  /** The locks on p1, as `kind:remaining`, so a remainder change is visible. */
  const lockOf = (s: GameState): readonly string[] => (s.players['p1']?.restrictions ?? []).map((r) => `${r.kind}:${r.remaining}`);
  const isLocked = (s: GameState): boolean => lockOf(s).some((k) => k.startsWith('no-purchases'));

  it('the corpus ships NO card printing the lock, which is why C1 was invisible', () => {
    // A fact about the corpus, and the reason the audit had to hand-build the probe. If
    // a card ever starts shipping one, this fails — and the sweep above then covers it,
    // which is the point of failing.
    const claiming = SHIPPED.filter((c) => RESTRICTION_KIND_CLAIMS.find((k) => k.kind === 'no-purchases')?.printed.test(c.text));
    expect(claiming.map((c) => c.id)).toEqual([]);
  });

  it('the card\'s OWN donation discharges its own lock, which is what the second sentence means', () => {
    // `restrict` then `lose`: the lock exists on the board when the donation lands, and
    // the donation is the actor's own giving, so it discharges. Asserted because the
    // ORIGINAL reduction had the clauses the other way round and left a player owing the
    // whole ask they had just paid.
    expect(lockOf(tight())).toEqual([]);
  });

  it('an opponent\'s drain measurably does NOT clear a lock that is standing', () => {
    // THE FALSIFIABLE HALF, and the exact probe the audit ran. `loose` puts the `lose`
    // first, so the card's own donation cannot discharge its own lock and a real lock is
    // left standing; p2 then drains 4 Funds off p1 and p1 donates nothing.
    const before = loose();
    expect(isLocked(before), `the loose-order card left no lock (${JSON.stringify(lockOf(before))}), so the discharge rule is unobservable`).toBe(true);
    const drained = must('the drain', play(before, DRAIN, undefined, 'p2')).settled;
    // p1 measurably lost the resources…
    expect(deltaTotal(drained.players['p1']?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 })).toBeLessThan(
      deltaTotal(before.players['p1']?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 }),
    );
    // …and the lock is exactly where it was: same kind, same remainder.
    expect(lockOf(drained), 'the lock moved and nothing was donated').toEqual(lockOf(before));
  });

  it('while a DONATION by the locked player measurably does clear it', () => {
    // The other falsifiable half, kept as its own assertion because the original defect
    // broke exactly one of the two.
    const before = loose();
    expect(isLocked(before)).toBe(true);
    const donated = must('the donation', play(before, DONATE)).settled;
    expect(lockOf(donated)).toEqual([]);
  });

  it('and the KIND arm reports a card that PRINTS the lock and does not impose it', () => {
    // The corpus-side shape of C1, and the one the audit's own reading of `hl-in2020-007`
    // describes: a card whose printed text makes the purchase-freeze claim while its
    // reduction restricts nothing of the kind. `EXECUTED_OPS` cannot see it — `restrict`
    // is not in the reduction at all — and neither can a per-op obligation, because there
    // is no clause to attribute. The only instrument that sees it is matching the PRINTED
    // claim against the kinds actually imposed, which is what `RESTRICTION_KIND_CLAIMS` is.
    const printedButNotImposed: ShippedCard = {
      ...LOCKING,
      effects: [LOCKING.effects[1]!],
      kind: 'conspiracy',
    };
    const reported: string[] = [];
    for (const claim of RESTRICTION_KIND_CLAIMS) {
      if (!claim.printed.test(printedButNotImposed.text)) continue;
      const kinds = printedButNotImposed.effects.filter((e) => e.op === 'restrict').map((e) => (e as { kind: string }).kind);
      if (!kinds.includes(claim.kind)) reported.push(`prints ${claim.why} but restricts ${kinds.join('/') || 'nothing'}`);
    }
    expect(reported, 'a card printing a purchase freeze it does not impose was accepted').not.toEqual([]);
    // …and the real `hl-in2020-007` is NOT in that shape, which is why it is on the board.
    expect(RESTRICTION_KIND_CLAIMS.find((k) => k.kind === 'no-purchases')?.printed.test(SHIPPED.find((c) => c.id === 'hl-in2020-007')?.text ?? '')).toBe(false);
  });
});

// ─────────────────────────── does the checker actually bite? ───────────────────────────

/**
 * TEETH. A checker nobody has watched fail is indistinguishable from a checker that
 * cannot fail — the same argument `playable.ts` makes for its negative control, and the
 * same one `recovered-cards.test.ts` makes for a capability that is merely absent.
 *
 * Each case takes a REAL corpus card, corrupts its reduction in one specific way, and
 * asserts that `disagreements` reports the corruption. Three corruptions, aimed at the
 * three claims the file makes:
 *
 *  - a CLAUSE REMOVED — the card keeps its printed sentence and loses the behaviour;
 *  - a TARGET MOVED — the behaviour happens but not to the seat the verb names;
 *  - a KIND SWAPPED — a rule of a different kind is imposed under the printed one.
 */
describe('the checker has teeth — three corruptions of real cards, three reports', () => {
  const position = game();
  const find = (id: CardID): ShippedCard => {
    const c = SHIPPED.find((x) => x.id === id);
    if (c === undefined) throw new Error(`no card ${id}`);
    return c;
  };

  /**
   * THE TWO PRINTED-SENTENCE ARMS, as functions, so that every case below runs the SAME
   * code the sweep above runs. They were inlined in each case before, which is how a case
   * came to assert the opposite of its own title: a copy of an arm that reports nothing is
   * indistinguishable from an arm that detects nothing, and the copy is the one under test.
   *
   * **EACH CASE NOW ASSERTS ITS OWN CONTROL** — that the arm is SILENT on the uncorrupted
   * card — before asserting that it fires on the corrupted one. That is the difference
   * between a detection and a demonstration that a regex matched a string: without the
   * control, `not.toEqual([])` is satisfied by an arm that reports everything.
   */
  const shapeReports = (card: ShippedCard): readonly string[] => {
    const out: string[] = [];
    for (const claim of SHAPE_CLAIMS) {
      if (!claim.printed.test(card.text)) continue;
      if (!card.effects.some(claim.needs)) out.push(`prints that it ${claim.says}, and no clause does`);
    }
    return out;
  };
  const restrictionReports = (card: ShippedCard): readonly string[] => {
    const out: string[] = [];
    for (const claim of RESTRICTION_KIND_CLAIMS) {
      if (!claim.printed.test(card.text)) continue;
      const kinds = card.effects.filter((e) => e.op === 'restrict').map((e) => (e as { kind: string }).kind);
      if (!kinds.includes(claim.kind)) out.push(`prints ${claim.why} but restricts ${kinds.join('/') || 'nothing'}`);
    }
    return out;
  };

  it('reports a card whose DONATION clause was deleted but whose text still donates', () => {
    // KHAKI TERROR is the audit's own card, so this is the C1 shape exactly: the printed
    // first sentence is a claim about the player's pool, and deleting the `lose` leaves
    // the text intact and the behaviour gone.
    //
    // ## IT USED TO ASSERT THE OPPOSITE OF ITS OWN TITLE, and that is worth recording
    //
    // The old body was `expect(disagreements(stripped, position)).toEqual([])` over a
    // **Headline** fixture — and `disagreements` returned `[]` for every Headline on its
    // first line, so the assertion could not have failed for any reason at all. A test
    // named for a detection that performs no detection is worse than no test: it
    // manufactures the confidence a reader is supposed to draw from its title. The one
    // thing it did check was an unrelated negative — that KHAKI TERROR does not print the
    // `no-purchases` lock, which is a fact about a DIFFERENT arm and about the real card.
    //
    // So the detection is now done by `SHAPE_CLAIMS`, the instrument that reads the
    // PRINTED sentence, and the sibling below already establishes that the per-op
    // obligation is blind to exactly this corruption: with the clause gone there is no
    // clause to attribute anything to, so `disagreements` is *expected* to be silent. That
    // silence is asserted here as a boundary of the instrument rather than smuggled in as
    // the detection.
    const original = find('hl-in2020-007');
    expect(original.text).toMatch(/Donate/i);
    const stripped: ShippedCard = { ...original, effects: [] };

    // THE CONTROL, first: the arm is armed on the real card and reports nothing, so a
    // report below is a finding and not an artefact of a pattern that matches everything.
    expect(shapeReports(original), 'the donation arm is not armed on the fixture').toEqual([]);
    // THE DETECTION: same text, the donation clause deleted.
    expect(shapeReports(stripped), 'a card whose text still donates and whose donation clause was deleted was accepted').not.toEqual([]);
    // …and named, so the failure message says which claim fired rather than just that one
    // did.
    expect(shapeReports(stripped).join(' ')).toMatch(/takes resources from the caster themselves/);
    // …and the boundary, honestly: with no clause left there is nothing to measure, which
    // is why this corruption is caught by the printed-sentence arm and not by the per-op
    // obligation. Asserted so it stays a stated limit rather than a silent one.
    expect(disagreements(stripped, position), 'the per-op obligation is no longer blind here, so the boundary note above is stale').toEqual([]);
  });

  it('reports a card printing THEFT that was written as a GAIN', () => {
    // "take 2 resources of your choice from a chosen opponent" is the brief's own example
    // and it is on a REAL shipped card. Swapping its `steal-any` for `gain-any` keeps the
    // op valid, the schema satisfied, the count intact and every `reducer-parity`
    // assertion green — and the card becomes a card that takes from nobody.
    //
    // The instrument is `SHAPE_CLAIMS`, not the per-op obligation, and that is the point
    // worth recording: the per-op obligation would look up `gain-any`'s obligation for
    // the corrupted clause and pass it, because the corruption made the card internally
    // CONSISTENT. Only a claim about the printed sentence survives that, which is exactly
    // the class of defect C1 was.
    const original = find('ct-et2040-001');
    expect(original.text).toMatch(/take 2 resources of your choice from a chosen opponent/i);
    const corrupted: ShippedCard = {
      ...original,
      effects: original.effects.map((e) => (e.op === 'steal-any' ? { op: 'gain-any', n: 2 } : e)) as Effect[],
    };
    expect(shapeReports(original), 'the shape arm is not silent on the real card, so the report below proves nothing').toEqual([]);
    expect(shapeReports(corrupted), 'a card that prints a theft and performs a gain was accepted').not.toEqual([]);
    // And the per-op obligation is BLIND to it, which is why the shape arm is not optional.
    expect(disagreements(corrupted, position), 'the per-op obligation saw the corruption').toEqual([]);
  });

  it('reports a DONATION aimed at somebody else, which is C1 in one edit', () => {
    // KHAKI TERROR's own sentence, with the one edit that turns a donation into a drain.
    // Everything stays executable and schema-valid; the direction is the whole defect.
    const original = find('hl-in2020-007');
    expect(original.text).toMatch(/donate 1/i);
    const corrupted: ShippedCard = {
      ...original,
      effects: original.effects.map((e) => ('target' in e ? e : { ...e, target: 'each-opponent' as const })) as Effect[],
    };
    expect(shapeReports(original), 'the shape arm is not silent on the real card, so the report below proves nothing').toEqual([]);
    expect(shapeReports(corrupted), 'a card that prints a donation and drains an opponent was accepted').not.toEqual([]);
  });

  it('reports a PURCHASE TAX that was written as a purchase BAN', () => {
    // The printed sentence says one thing and the `restrict` kind says another. Growth
    // alone cannot see it — the list got longer either way — which is precisely why the
    // KIND arm exists as a separate assertion.
    const PYTHONPOST = find('hl-et2040-021');
    expect(RESTRICTION_KIND_CLAIMS.find((k) => k.kind === 'surcharge')?.printed.test(PYTHONPOST.text), 'the fixture is not a tax card').toBe(true);
    const swapped: ShippedCard = {
      ...PYTHONPOST,
      effects: PYTHONPOST.effects.map((e) => (e.op === 'restrict' ? { ...e, kind: 'no-purchases' as const, owed: 99 } : e)),
    };
    expect(restrictionReports(PYTHONPOST), 'the kind arm is not silent on the real card, so the report below proves nothing').toEqual([]);
    expect(restrictionReports(swapped), 'a surcharge printed as a no-purchases ban was accepted').not.toEqual([]);
  });
});