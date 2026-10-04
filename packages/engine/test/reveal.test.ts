/**
 * G-new, PART ONE — `reveal`, `move-card { from: 'revealed' }` and
 * `'revealed-card'`, and the FIVE security invariants they owe.
 *
 * The type surface for this mechanic landed first and inert, with its security argument
 * written out on `Effect`'s `reveal` arm in `cards.ts` and on `GameState.revealedCards`
 * in `state.ts`. This file is the other half: it drives the mechanic through the REAL
 * reducer — `PLAY_CONSPIRACY`, `RESOLVE_CHOICE`, `END_TURN`, nothing else — and asserts
 * the five promises the ruling makes, each with a mutation that turns the test red if
 * the promise is broken.
 *
 * ## WHY THE FIXTURES PAUSE INSTEAD OF FINISHING
 *
 * A resolution can be caught mid-flight and that is not an accident of the fixtures, it
 * is the whole reason the mechanic is reachable at all. Any effect can raise a decision,
 * and the state that pauses at one is a state the server keeps and re-serves, so a
 * `reveal` placed before a decision has to still be there when it is answered. Every
 * test below therefore either reads a state that is paused at a `choose-player`
 * (`REVEAL_THEN_PAUSE`) or reads a state whose turn boundary has already run
 * (`advanceTurn`'s clear). A test that only ever read finished resolutions would pass
 * against an implementation that cleared the set too eagerly — which loses the mechanic
 * — so both windows are asserted and neither is the only one.
 *
 * ## WHY THE IDS ARE `rvl-`
 *
 * Every Ideology Card id here shares a prefix, so a leak scan can grep one string, and
 * the payouts are `{ funds: 1 }` / `{ trust: 1 }` so a cap question is never opened by an
 * answer and the test never has to thaw a p12 `Choice` to reach the state it is about.
 * `withTop` MOVES ids onto the front of the draw pile rather than appending to it, for
 * the reason `card-transfer.test.ts` gives: a fixture that copies ids into a pile while
 * they are still elsewhere builds a world with two of the same card, and then a correct
 * conservation assertion reports a leak that is not there.
 */

import { describe, expect, it } from 'vitest';

import {
  indexCards,
  type CardIndex,
  type ConspiracyCard,
  type Effect,
  type IdeologyCard,
} from '../src/cards';
import { playerView } from '../src/playerView';
import { IDEOLOGY_HAND_MAX, reduce } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import {
  EMPTY_POOL,
  IDEOLOGUES,
  ideologyHandOf,
  poolTotal,
  revealedCardsOf,
  type Delta,
  type GameState,
  type PlayerID,
} from '../src/state';
import { PLAYERS_3 } from './helpers';

// ─────────────────────────── fixtures ───────────────────────────

/** A Conspiracy Card built from raw effects, so each test reads as one clause. */
function probe(id: string, effects: readonly Effect[]): ConspiracyCard {
  return { id, name: id, text: `probe ${id}`, cost: 0, effects };
}

/** One card off the top of a draw pile, face up. */
const REVEAL_ONE = probe('rvl-reveal-1', [{ op: 'reveal', kind: 'ideology', n: 1 }]);
/** Five asked for, which is more than most fixtures hold — the short-pile shape. */
const REVEAL_FIVE = probe('rvl-reveal-5', [{ op: 'reveal', kind: 'ideology', n: 5 }]);
/** Off the Conspiracy pile, whose LENGTH is a public field. */
const REVEAL_CONSPIRACY = probe('rvl-reveal-con', [{ op: 'reveal', kind: 'conspiracy', n: 1 }]);
/** One per opponent, from a pile they all share. */
const REVEAL_EACH = probe('rvl-reveal-each', [
  { op: 'reveal', kind: 'ideology', n: 2, target: 'each-opponent' },
]);
/** Reveal, then read the count back with `'revealed-card'`. */
const COUNT_THE_REVEALED = probe('rvl-count', [
  { op: 'reveal', kind: 'ideology', n: 2 },
  { op: 'move-card', from: 'draw', to: 'destroy', n: { of: 'revealed-card' } },
]);
/** Take the top of the revealed list into a hand. */
const TAKE_REVEALED = probe('rvl-take', [
  { op: 'reveal', kind: 'ideology', n: 2 },
  { op: 'move-card', from: 'revealed', to: 'hand', n: 1 },
]);
/** Take the top of the revealed list out of the world. */
const BURN_REVEALED = probe('rvl-burn', [
  { op: 'reveal', kind: 'ideology', n: 1 },
  { op: 'move-card', from: 'revealed', to: 'destroy', n: 1 },
]);
/** Take from a revealed list nothing has ever been put on. */
const TAKE_FROM_NOTHING = probe('rvl-take-empty', [
  { op: 'move-card', from: 'revealed', to: 'hand', n: 3 },
]);
/** Reveal three, off the top of the Ideology pile. */
const REVEAL_THREE = probe('rvl-reveal-3', [{ op: 'reveal', kind: 'ideology', n: 3 }]);
/**
 * The PAUSE. `voters` with `target: 'chosen-player'` is intercepted one function above
 * the switch and becomes a decision, so the reveal before it has already happened and the
 * state the reducer returns still carries it. This is the only way a test can see
 * `revealedCards` at all, and it is why the mechanic is observable rather than
 * theoretical. `voters` and not `steal-any`, because `steal-any` answers by raising a
 * SECOND decision for the actor — a paused resolution that leaves the player holding an
 * unanswerable dialog is a fixture problem, not a mechanic.
 */
const REVEAL_THEN_PAUSE = probe('rvl-pause', [
  { op: 'reveal', kind: 'ideology', n: 1 },
  { op: 'voters', n: 1, target: 'chosen-player' },
]);

const PROBES: readonly ConspiracyCard[] = [
  REVEAL_ONE,
  REVEAL_FIVE,
  REVEAL_CONSPIRACY,
  REVEAL_EACH,
  COUNT_THE_REVEALED,
  TAKE_REVEALED,
  BURN_REVEALED,
  TAKE_FROM_NOTHING,
  REVEAL_THEN_PAUSE,
  REVEAL_THREE,
];

/** Filler Conspiracy Cards, so the Conspiracy draw pile holds no Ideology Card id. */
const FILLER: readonly ConspiracyCard[] = Array.from({ length: 6 }, (_, i) =>
  probe(`rvl-filler-${i + 1}`, [{ op: 'gain', res: { funds: 1 } }]),
);

const ALL_CONSPIRACY: readonly ConspiracyCard[] = [...PROBES, ...FILLER];

/**
 * Twenty Ideology Cards, `rvl-NN`, paying one resource a side so nothing goes over cap.
 *
 * Twenty rather than eight because the whole-game sweep in (a) reveals on every one of
 * p1's turns and R10 ends a game whose Ideology deck has run dry — a mechanic test that
 * ran out of cards would be testing the exhaustion rule.
 */
function revealIndex(): CardIndex {
  const ideology = Array.from({ length: 20 }, (_, k): IdeologyCard => {
    const i = k + 1;
    // Zero-padded to two digits, and that is load-bearing rather than cosmetic: a leak
    // scan is `json.not.toContain(id)`, and an unpadded `rvl-1` is a PREFIX of `rvl-10`,
    // so a payload holding only `rvl-10` would satisfy a scan for `rvl-1`.
    const n = String(i).padStart(2, '0');
    return {
      id: `rvl-${n}`,
      campaign: 'rvl',
      question: `rvl question ${n}`,
      sides: [
        {
          answer: `rvl answer ${n}a`,
          ideologue: IDEOLOGUES[i % 4] as IdeologyCard['sides'][0]['ideologue'],
          pays: { funds: 1 },
        },
        {
          answer: `rvl answer ${n}b`,
          ideologue: IDEOLOGUES[(i + 1) % 4] as IdeologyCard['sides'][0]['ideologue'],
          pays: { trust: 1 },
        },
      ],
    };
  });
  return indexCards({
    ideology,
    voter: [],
    conspiracy: [...ALL_CONSPIRACY],
    headline: [],
  });
}

const CTX = { rules: RULES, cards: revealIndex() };
const RVL_IDS: readonly string[] = Object.keys(CTX.cards.ideology);
const PROBE_IDS: readonly string[] = ALL_CONSPIRACY.map((c) => c.id);

function rvlSetup(seed = 7): GameState {
  return setup({
    players: PLAYERS_3,
    cards: CTX.cards,
    seed,
    ideologyDeck: [...RVL_IDS],
    conspiracyDeck: [...PROBE_IDS],
  });
}

/** Hand a player Conspiracy Cards, which is how a test reaches a card effect at all. */
function withConspiracies(s: GameState, who: PlayerID, ids: readonly string[]): GameState {
  const p = s.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  return { ...s, players: { ...s.players, [who]: { ...p, conspiracies: [...ids] } } };
}

/**
 * `k` Ideology Card ids that are safe to put on a pile: everything in the deck EXCEPT
 * the card `setup` has already put to p1.
 *
 * This is not tidiness. `setup` deals one card and leaves the rest on the draw pile, so
 * the dealt card is in BOTH `_pendingCard` and `_ideologyDraw`; a fixture that names it
 * in `withTop` builds a world holding two of the same card, the conservation oracle
 * counts a duplicate, and the assertions below report a leak that is the fixture. It is
 * the same trap `card-transfer.test.ts` documents as `anIdleCard`.
 */
function pileIds(s: GameState, k: number): string[] {
  return RVL_IDS.filter((id) => id !== s._pendingCard).slice(0, k);
}

/**
 * Put the first `k` safe Ideology Card ids on the FRONT of the draw pile — the end
 * `draw()` and `reveal` both take from — by MOVING them, so the world never holds two of
 * the same card.
 */
function withTop(s: GameState, k: number): GameState {
  const ids = pileIds(s, k);
  const keeping = s._ideologyDraw.filter((id) => !ids.includes(id));
  return { ...s, _ideologyDraw: [...ids, ...keeping] };
}

/** The engine's own half of the wire payload, for one viewer. */
function payload(s: GameState, viewer: PlayerID): Record<string, unknown> {
  return playerView(s, viewer) as unknown as Record<string, unknown>;
}

/** Play a probe card as p1, out of p1's hand. p1 is mid-answer on turn 1, which p19 allows. */
function play(s: GameState, cardId: string): GameState {
  const held = withConspiracies(s, 'p1', [cardId]);
  const r = reduce(held, 'p1', { type: 'PLAY_CONSPIRACY', cardId }, CTX);
  expect(r.ok, `playing ${cardId} must succeed`).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** The one `choose-player` decision the pause raises, or a hard failure if there is none. */
function theDecision(s: GameState): string {
  const open = s.choices.find((c) => c.player === 'p1');
  if (open === undefined) throw new Error('expected an open choose-player decision');
  expect(open.choice.kind).toBe('choose-player');
  return open.id;
}

function answer(s: GameState, choiceId: string, who: PlayerID = 'p2'): GameState {
  const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId, pick: { kind: 'player', id: who } }, CTX);
  expect(r.ok, 'the pause must be answerable').toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/**
 * Answer the Ideology Card and end the turn, which is what runs the turn boundary.
 * Split out because EVERY test in this file that needs the set cleared needs both
 * actions, and the boundary is on the END of the turn rather than on the answer.
 */
function toNextTurn(s: GameState): GameState {
  const a = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, CTX);
  expect(a.ok, 'answering must stay legal').toBe(true);
  if (!a.ok) throw new Error(a.error);
  const e = reduce(a.state, 'p1', { type: 'END_TURN' }, CTX);
  expect(e.ok, 'ending the turn must stay legal').toBe(true);
  if (!e.ok) throw new Error(e.error);
  return e.state;
}

/**
 * Every IDEOLOGY Card in the world, wherever it is. The conservation oracle.
 *
 * **Ideology Cards only, and the Conspiracy piles are left out on purpose**: `playing
 * this test's probe card` puts the played card on `_conspiracyDiscard`, so a world count
 * that included the Conspiracy piles would move by one on every single assertion here and
 * report a leak that is the play itself. The reveal touches Ideology Cards exclusively,
 * and this is the set the "moved, never copied" promise is about.
 */
function worldIds(s: GameState): string[] {
  return [
    ...s._ideologyDraw,
    ...s._ideologyDiscard,
    ...s.turnOrder.flatMap((p) => ideologyHandOf(s.players[p])),
    ...s.turnOrder.flatMap((p) => revealedCardsOf(s, p)),
  ];
}

/** Nothing on the wire carries an underscore key, whatever the state. */
function noServerKeys(s: GameState): void {
  for (const viewer of s.turnOrder) {
    const json = JSON.stringify(payload(s, viewer));
    for (const k of Object.keys(payload(s, viewer))) expect(k, `${viewer} payload key`).not.toMatch(/^_/);
    expect(json, `${viewer} payload`).not.toMatch(/"_[a-z]/);
  }
}

// ─────────────────────────── the mechanic ───────────────────────────

describe('reveal turns the top of a draw pile face up, off the pile', () => {
  it('takes pile[0] — the end draw() takes from — and the deck count falls by one', () => {
    const base = withTop(rvlSetup(), 2);
    const top = pileIds(base, 2);
    const before = base._ideologyDraw.length;
    expect(base._ideologyDraw.slice(0, 2)).toEqual(top);

    const s = play(base, REVEAL_ONE.id);

    expect(revealedCardsOf(s, 'p1')).toEqual([top[0]]);
    // MOVED, not copied. A revealed card still sitting in `_ideologyDraw` would be a
    // second copy of pile contents on the wire by another route, which is the exact
    // failure `to: 'discard'` is refused over `_conspiracyDraw` for.
    expect(s._ideologyDraw).not.toContain(top[0]);
    expect(s._ideologyDraw[0]).toBe(top[1]);
    expect(s._ideologyDraw.length).toBe(before - 1);
    // And the world is whole: nothing created, nothing destroyed.
    expect(worldIds(s).sort()).toEqual(worldIds(base).sort());
  });

  it('reveals n cards in pile order, and leaves the pile below them where it was', () => {
    const base = withTop(rvlSetup(), 3);
    const top = pileIds(base, 3);
    const s = play(base, REVEAL_THREE.id);
    expect(revealedCardsOf(s, 'p1')).toEqual(top);
    expect(s._ideologyDraw.slice(0, 2)).toEqual(base._ideologyDraw.slice(3, 5));
  });

  it("'revealed-card' counts the resolved player's revealed cards", () => {
    // `COUNT_THE_REVEALED` reveals two and then destroys `n: { of: 'revealed-card' }`
    // cards off the draw pile, so the number of cards that leave the pile IS the count.
    const base = withTop(rvlSetup(), 4);
    const top = pileIds(base, 4);
    const s = play(base, COUNT_THE_REVEALED.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([top[0], top[1]]);
    // Two left the pile, and the two that left are the two the reveal did NOT take —
    // which is only true if the count read back was 2 and the take ran twice. Against
    // the pre-execution `return 0` the pile would be untouched and this would fail.
    expect(s._ideologyDraw).not.toContain(top[0]);
    expect(s._ideologyDraw).not.toContain(top[1]);
    expect(s._ideologyDraw).not.toContain(top[2]);
    expect(s._ideologyDraw).not.toContain(top[3]);
    expect(s._ideologyDraw.length).toBe(base._ideologyDraw.length - 4);
    // And a player who has revealed nothing has nothing to count, which is the honest
    // answer rather than the fallback that used to be returned for every player.
    const one = play(rvlSetup(), REVEAL_ONE.id);
    expect(revealedCardsOf(one, 'p1')).toHaveLength(1);
    expect(revealedCardsOf(one, 'p2')).toEqual([]);
    expect(revealedCardsOf(one, 'p3')).toEqual([]);
  });

  it('re-syncs the public Conspiracy counters, because that pile LENGTH is on the wire', () => {
    const base = rvlSetup();
    expect(base._conspiracyDraw.length).toBeGreaterThan(1);
    const before = base.conspiracyRemaining;
    const s = play(base, REVEAL_CONSPIRACY.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([base._conspiracyDraw[0]]);
    expect(s._conspiracyDraw.length).toBe(before - 1);
    // A stale count here is a public field reporting a number the engine no longer
    // believes, and it would be the only way this op could disclose pile contents.
    expect(s.conspiracyRemaining).toBe(before - 1);
  });

  it('lands one card per resolved target, and the two targets never share one', () => {
    const base = withTop(rvlSetup(), 4);
    const top = pileIds(base, 4);
    const s = play(base, REVEAL_EACH.id);
    expect(revealedCardsOf(s, 'p2')).toEqual([top[0], top[1]]);
    expect(revealedCardsOf(s, 'p3')).toEqual([top[2], top[3]]);
    // p1 played it and is not a target, which is the `target` axis working.
    expect(revealedCardsOf(s, 'p1')).toEqual([]);
    for (const id of top) expect(s._ideologyDraw).not.toContain(id);
    expect(worldIds(s).sort()).toEqual(worldIds(base).sort());
  });
});

describe("move-card { from: 'revealed' } takes from what is face up", () => {
  it('moves the TOP of the revealed list into the hand and REMOVES it from the set', () => {
    const base = withTop(rvlSetup(), 2);
    const top = pileIds(base, 2);
    const s = play(base, TAKE_REVEALED.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([top[1]]);
    // Leaving the taken card listed would publish its identity after it has been put
    // back in a HIDDEN hand — the `choose-card` refusal arriving by another route.
    expect(revealedCardsOf(s, 'p1')).not.toContain(top[0]);
    expect(ideologyHandOf(s.players.p1)).toEqual([top[0]]);
    // And a card in a hand is in nobody's payload.
    for (const viewer of s.turnOrder) expect(JSON.stringify(payload(s, viewer))).not.toContain(top[0]);
    expect(worldIds(s).sort()).toEqual(worldIds(base).sort());
  });

  it("to: 'destroy' off a revealed card is the only way it leaves the world, and it does", () => {
    const base = withTop(rvlSetup(), 1);
    const top = pileIds(base, 1);
    const s = play(base, BURN_REVEALED.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([]);
    expect(worldIds(s)).not.toContain(top[0]);
    // The one contrast, so the assertion above is about the destroy: the card PLAYED is
    // public by construction, and the engine logs it by name.
    expect(s.log.map((l) => l.text).join('\n')).toContain(BURN_REVEALED.name);
    for (const viewer of s.turnOrder) expect(JSON.stringify(payload(s, viewer))).not.toContain(top[0]);
  });

  it('an EMPTY revealed list is a safe no-op: not a failure, not a throw, not a card', () => {
    const before = rvlSetup();
    const s = play(before, TAKE_FROM_NOTHING.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([]);
    expect(ideologyHandOf(s.players.p1)).toEqual([]);
    // Three asked for, nothing to give, and the world is untouched.
    expect(worldIds(s).sort()).toEqual(worldIds(before).sort());
    expect(s._ideologyDraw).toEqual(before._ideologyDraw);
  });

  it('a FULL hand refuses the take and leaves the card where it was, on the table', () => {
    // The cap is checked BEFORE the card leaves the revealed set, for the reason the
    // draw path checks it before the card leaves the pile: a refused take must leave the
    // world exactly as it was, and `to: 'destroy'` is the only op allowed to shrink the
    // Ideology count. The two cards in the hand are MOVED there off the draw pile, which
    // is what `advanceTurn`'s drain does, so the world holds no card twice.
    const base = rvlSetup();
    const inHand = pileIds(base, IDEOLOGY_HAND_MAX);
    const staged: GameState = {
      ...base,
      _ideologyDraw: base._ideologyDraw.filter((id) => !inHand.includes(id)),
      players: { ...base.players, p1: { ...base.players.p1!, ideologyCards: [...inHand] } },
    };
    const before = worldIds(staged);
    const s = play(staged, TAKE_REVEALED.id);
    expect(revealedCardsOf(s, 'p1'), 'a refused take keeps the card face up').toHaveLength(2);
    expect(ideologyHandOf(s.players.p1)).toEqual(inHand);
    expect(worldIds(s).sort()).toEqual(before.sort());
  });
});

/**
 * The smallest legal answer to a p12 cap question, or `s` unchanged when there is none.
 *
 * p12 opens a `Choice` on whoever is over the resource cap, and while it is open EVERY
 * other action fails — so a driver that does not answer it reports a stuck table in a
 * position where the player has exactly one legal move. `card-transfer.test.ts` builds
 * the same harness and says why the pick has to SPREAD across the four resources rather
 * than take them greedily from one.
 */
function thaw(s: GameState): GameState {
  const p = s.activePlayer;
  const open = s.choices.find((c) => c.player === p);
  if (open === undefined) return s;
  if (open.choice.kind !== 'gain-any' && open.choice.kind !== 'lose-any') return s;
  const held = s.players[p]?.resources ?? EMPTY_POOL;
  const want = Math.min(open.choice.count, poolTotal(held));
  const res: Delta = {};
  let left = want;
  for (const r of ['funds', 'clout', 'media', 'trust'] as const) {
    if (left <= 0) break;
    const take = Math.min(left, held[r]);
    if (take > 0) {
      res[r] = take;
      left -= take;
    }
  }
  const r = reduce(s, p, { type: 'RESOLVE_CHOICE', choiceId: open.id, pick: { kind: 'resources', res } }, CTX);
  return r.ok ? r.state : s;
}

// ─────────────────────────── (a) empty outside a resolution ───────────────────────────

describe('(a) the revealed set is EMPTY in every state outside a resolution', () => {
  it('is empty at setup, non-empty while the resolution runs, and empty at the boundary', () => {
    const start = rvlSetup();
    expect(start.revealedCards, 'setup writes {}').toEqual({});
    for (const p of start.turnOrder) expect(revealedCardsOf(start, p)).toEqual([]);

    const staged = withTop(start, 1);
    const top = pileIds(staged, 1)[0] as string;
    const paused = play(staged, REVEAL_THEN_PAUSE.id);
    // NON-VACUITY. Without this the two assertions below pass against an implementation
    // that never reveals anything at all, which is the pre-execution stub.
    expect(revealedCardsOf(paused, 'p1')).toEqual([top]);

    const settled = answer(paused, theDecision(paused));
    // The resolution is still the same resolution: same turn, same player, no clause of
    // it left to run, and the set is still there. A clear placed too eagerly — at the end
    // of the action rather than at the turn boundary — would empty it here and silently
    // break every card that reveals and then reads.
    expect(settled.turn).toBe(paused.turn);
    expect(settled.activePlayer).toBe('p1');
    expect(revealedCardsOf(settled, 'p1')).toEqual([top]);

    const next = toNextTurn(settled);
    // THE BOUNDARY. The next player inherits none of it.
    expect(next.revealedCards, 'the turn boundary clears the set outright').toEqual({});
    for (const p of next.turnOrder) expect(revealedCardsOf(next, p)).toEqual([]);
    expect(next.activePlayer).toBe('p2');
  });

  it('never hands a player a stale entry across a whole played game', () => {
    // The sweep version: eleven turns, a reveal played on every one p1 can, and the
    // assertion at EVERY turn boundary rather than at one hand-picked moment.
    let s = withConspiracies(rvlSetup(11), 'p1', [REVEAL_ONE.id]);
    expect(s.revealedCards).toEqual({});
    let reveals = 0;
    let boundaries = 0;
    let lastRevealedTurn = -1;

    for (let step = 0; step < 60 && !s.finished; step += 1) {
      const p = s.activePlayer;
      // p12's cap question freezes everything else while it is open — including the play
      // of a card — so it is answered first rather than read as a stuck table. See
      // `thaw`.
      const t = thaw(s);
      if (t !== s) {
        s = t;
        continue;
      }
      // Once per turn, and only in the actions window — a reveal played on every loop
      // would never let the turn end, and the sweep is about the boundary.
      if (
        p === 'p1' &&
        s.phase === 'actions' &&
        s.turn !== lastRevealedTurn &&
        s.players.p1?.conspiracies.includes(REVEAL_ONE.id)
      ) {
        const after = play(s, REVEAL_ONE.id);
        reveals += 1;
        lastRevealedTurn = after.turn;
        // Handed straight back, so the run reveals on every one of p1's turns rather
        // than on the first. The card is the mechanic's, not the game's, and this test
        // is about the ENGINE's clock rather than about a deck.
        s = withConspiracies(after, 'p1', [...(after.players.p1?.conspiracies ?? []), REVEAL_ONE.id]);
        continue;
      }
      const a = reduce(s, p, { type: 'ANSWER', side: 0 }, CTX);
      if (a.ok) {
        s = a.state;
        continue;
      }
      const e = reduce(s, p, { type: 'END_TURN' }, CTX);
      if (e.ok) {
        s = e.state;
        boundaries += 1;
        // The invariant, asserted at every instant the engine hands the next player a
        // state rather than only at the one the fixture chose.
        expect(s.revealedCards, `turn ${s.turn}: a stale revealed set survived the boundary`).toEqual({});
        continue;
      }
      throw new Error(`no legal move at turn ${s.turn}, phase ${s.phase}`);
    }
    expect(reveals, 'the run must actually reveal').toBeGreaterThan(2);
    expect(boundaries, 'the run must actually cross several turn boundaries').toBeGreaterThan(2);
  });
});

// ─────────────────────────── (b) only legitimately drawn ids ───────────────────────────

describe('(b) every revealed id is a card the game legitimately drew', () => {
  it('came off the DRAW pile and is on no other list — pile, discard, hand or pending', () => {
    const base = withTop(rvlSetup(), 3);
    const top = pileIds(base, 3);
    const inDrawBefore = base._ideologyDraw;
    // An answered card in the discard pile, and a card in a hidden hand, so the
    // assertions below have something they could plausibly have picked up. Both are
    // chosen OFF `top`, so nothing is in the world twice and the conservation oracle at
    // the end is about the mechanic rather than about the fixture.
    const spare = RVL_IDS.filter((id) => !top.includes(id) && id !== base._pendingCard);
    const [discarded, handed] = [spare[0] as string, spare[1] as string];
    const staged: GameState = {
      ...base,
      _ideologyDiscard: [discarded],
      players: {
        ...base.players,
        p2: { ...base.players.p2!, ideologyCards: [handed] },
      },
    };
    const s = play(staged, REVEAL_THREE.id);

    const revealed = revealedCardsOf(s, 'p1');
    expect(revealed).toEqual(top);
    // Each one was on the draw pile an instant before, which is the whole of "the game
    // legitimately drew it".
    for (const id of revealed) expect(inDrawBefore).toContain(id);
    // And each one is on NO other list. A discard id, a hand id or `_pendingCard` here
    // would be a card the game never dealt.
    for (const id of revealed) {
      expect(s._ideologyDiscard, 'a discard id').not.toContain(id);
      for (const who of s.turnOrder) expect(ideologyHandOf(s.players[who]), 'a hand id').not.toContain(id);
      expect(id, '_pendingCard').not.toBe(s._pendingCard);
      // And still not on the pile it came off — moved, not copied.
      expect(s._ideologyDraw, 'still on the draw pile').not.toContain(id);
    }
    // The two the fixture staged are exactly where they were.
    expect(s._ideologyDiscard).toEqual([discarded]);
    expect(ideologyHandOf(s.players.p2)).toEqual([handed]);
    // Conservation, which is the same claim stated as a number.
    expect(worldIds(s).sort()).toEqual(worldIds(staged).sort());
  });

  it('reads the DRAW pile and nothing else: an empty draw pile reveals nothing', () => {
    // The deck is empty and the DISCARD pile holds three real cards, so a reveal that
    // reached for the wrong one would have something to reach. p13 has already made
    // those cards face up under their owner's mat, which is why an op naming a discard
    // pile is refused outright rather than merely undocumented.
    const rest = rvlSetup();
    const parked = RVL_IDS.filter((id) => id !== rest._pendingCard).slice(0, 3);
    const discarded = parked[0] as string;
    const base: GameState = {
      ...rvlSetup(),
      _ideologyDraw: [],
      _ideologyDiscard: [discarded],
    };
    const s = play(base, REVEAL_FIVE.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([]);
    expect(s._ideologyDiscard, 'the discard pile is untouched').toEqual([discarded]);
    expect(s._ideologyDraw).toEqual([]);
    expect(worldIds(s).sort()).toEqual(worldIds(base).sort());
  });
});

// ─────────────────────────── (c) the wire ───────────────────────────

describe('(c) the wire carries the set while it is live, and nothing after it is cleared', () => {
  it('publishes it VERBATIM to every viewer — unprefixed, unfiltered, unviewer-scoped', () => {
    // `revealedCards` is public by RULING, not by convenience: every id in it was turned
    // face up. So the payload carries it as it stands, for every seat. A viewer-scoped
    // branch here would be the R1 bug (a hidden hand published) in a plausible-looking
    // form, and the loop is here to catch it.
    const staged = withTop(rvlSetup(), 1);
    const top = pileIds(staged, 1)[0] as string;
    const s = play(staged, REVEAL_THEN_PAUSE.id);
    for (const viewer of s.turnOrder) {
      const json = JSON.stringify(payload(s, viewer));
      expect(json, `${viewer} must be able to see a face-up card`).toContain(top);
      expect(json, `${viewer} payload key`).toContain('revealedCards');
    }
    noServerKeys(s);
  });

  it('the clearing removes EXACTLY that field, and leaves no trace of the id', () => {
    const staged = withTop(rvlSetup(), 1);
    const top = pileIds(staged, 1)[0] as string;
    const s = play(staged, REVEAL_THEN_PAUSE.id);
    const cleared = { ...s, revealedCards: {} };
    // The payload before the resolution and the payload after it differ in ONE key. This
    // is the byte-identity the clearing promises, stated structurally so a partial fix —
    // stripping the field and adding another that happens to be empty — cannot satisfy.
    for (const viewer of s.turnOrder) {
      const live = payload(s, viewer);
      const gone = payload(cleared, viewer);
      expect({ ...live, revealedCards: {} }, `${viewer}: only revealedCards may differ`).toEqual(gone);
      expect(gone.revealedCards).toEqual({});
      expect(live.revealedCards).toEqual({ p1: [top] });
    }

    // And the other direction, which is the one a leak would take: after the boundary,
    // the revealed id is on NO wire at all — including nowhere in the log, which
    // `playerView` copies wholesale.
    const next = toNextTurn(answer(s, theDecision(s)));
    for (const viewer of next.turnOrder) {
      const json = JSON.stringify(payload(next, viewer));
      expect(json, `${viewer}: a cleared reveal must not still be on the wire`).not.toContain(top);
      expect(payload(next, viewer).revealedCards).toEqual({});
    }
    expect(next.log.map((l) => l.text).join('\n')).not.toContain(top);
    noServerKeys(next);
  });
});

// ─────────────────────────── (d) no duplicates ───────────────────────────

describe('(d) a reveal cannot make the same card appear twice in one revealed list', () => {
  it('five asks of a five-card pile give five DISTINCT cards', () => {
    const base = withTop(rvlSetup(), 5);
    const top = pileIds(base, 5);
    const s = play(base, REVEAL_FIVE.id);
    const revealed = revealedCardsOf(s, 'p1');
    expect(revealed).toEqual(top);
    expect(new Set(revealed).size, 'the list must hold five distinct cards').toBe(5);
    // Seven are on the pile, five are taken, and none of the five is among the two that
    // stayed. A copy rather than a move would show the top id sitting in both lists.
    expect(s._ideologyDraw.length).toBe(base._ideologyDraw.length - 5);
    for (const id of revealed) expect(s._ideologyDraw).not.toContain(id);
  });

  it('two opponents taking from one shared pile get two DISJOINT lists', () => {
    const base = withTop(rvlSetup(), 6);
    const s = play(base, REVEAL_EACH.id);
    for (const who of s.turnOrder) {
      const mine = revealedCardsOf(s, who);
      expect(new Set(mine).size, `${who} holds a duplicate`).toBe(mine.length);
    }
    const two = [...revealedCardsOf(s, 'p2'), ...revealedCardsOf(s, 'p3')];
    expect(new Set(two).size, 'the two lists must not overlap').toBe(two.length);
    expect(two.length).toBe(4);
    // Four left the pile: nothing was revealed twice to make up the difference, and none of
    // the four is still where it came from.
    expect(s._ideologyDraw.length).toBe(base._ideologyDraw.length - 4);
    for (const id of two) expect(s._ideologyDraw).not.toContain(id);
  });
});

// ─────────────────────────── (e) an empty pile ───────────────────────────

describe('(e) a reveal from an empty pile is a no-op and reveals nothing', () => {
  it('the card still resolves, the pile stays empty, and the world is untouched', () => {
    const base: GameState = { ...rvlSetup(), _ideologyDraw: [], _ideologyDiscard: ['rvl-1'] };
    const before = worldIds(base);
    const s = play(base, REVEAL_FIVE.id);
    expect(revealedCardsOf(s, 'p1')).toEqual([]);
    expect(s.revealedCards).toEqual({});
    expect(s._ideologyDraw).toEqual([]);
    expect(s._ideologyDiscard, 'an empty reveal must not recycle anything').toEqual(['rvl-1']);
    expect(worldIds(s).sort()).toEqual(before.sort());
    // And the play itself went through — a partially-applied reveal is correct, not a
    // failure, exactly as a partially-applied `move-card` is.
    expect(s.log.map((l) => l.text).join('\n')).toContain(REVEAL_FIVE.name);
  });

  it('is also a no-op per target when the target list is empty', () => {
    const base: GameState = { ...rvlSetup(), _ideologyDraw: [] };
    const s = play(base, REVEAL_EACH.id);
    expect(s.revealedCards).toEqual({});
    for (const who of s.turnOrder) expect(revealedCardsOf(s, who)).toEqual([]);
  });
});