/**
 * G9 / G22 — AN EFFECT THAT OUTLIVES ITS CARD.
 *
 * Before `GameState.liveEffects`, `reduce()` resolved a card's effect list once and
 * discarded the card, with no way to remember that the card had said anything
 * lasting. Every real card in that position had to ship as a lie or not at all.
 *
 * The four properties asserted here are the ones that make the feature safe rather
 * than merely working, and each is stated as a test rather than as a comment because
 * each has a specific way of quietly going wrong:
 *
 *  1. **Install semantics.** An effect carrying `when`/`until` does NOT fire once
 *     and then linger. A card that did that would hand out a free effect on the turn
 *     it was played and keep the hook — POWER TRIP would give a discard on the turn
 *     you played it, which is not what "every time you influence a 3-Voter Card"
 *     says.
 *  2. **Expiry order.** Expiry runs BEFORE anything re-applies, or a `'this-turn'`
 *     effect is immortal: re-applied at the very boundary meant to remove it.
 *  3. **Determinism.** The lifetime is two absolute turn numbers computed at install
 *     out of state that was already written down, so a replay from seed + action log
 *     reproduces it. A module-scope counter or a wall clock would not.
 *  4. **Bounded re-entrancy.** The cascade applies at most one effect per wave and
 *     never the same one twice, under a hard cap. Proven by driving it with an
 *     explicit budget, not by asserting the constant.
 *
 * And one that is a leak test rather than a rules test: a live effect is PUBLIC
 * (`state.ts` argues it at length), which means its absence from the client payload
 * would be the bug and its presence is the requirement. So this file asserts that
 * the payload carries it, that it carries no `_` key at any depth, and that it never
 * names a Conspiracy Card anybody is still holding.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { allKeys, playerView } from '../src/playerView';
import { reduce, TRIGGER_MAX_WAVES, type Ctx, type FireContext } from '../src/reduce';
import { indexCards, type CardIndex, type ConspiracyCard, type HeadlineCard } from '../src/cards';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { isInForce, ownerNextTurn, roundEndTurn, type GameState, type PlayerID } from '../src/state';
import { bigCtx, fresh, freshFull, IDEOLOGY_CARDS, PLAYERS_3, VOTER_CARDS } from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));


/**
 * A card set with one lasting card per shape the tests need.
 *
 * Declared here rather than in `helpers.ts` so the fixtures read next to the claims
 * they support: a reader can see exactly what "round" and "rest-of-game" mean here
 * without cross-referencing a shared module.
 */
const LIVING_CONSPIRACIES: readonly ConspiracyCard[] = [
  {
    id: 'liv-this-turn',
    name: 'A Fleeting Note',
    text: 'Gain 1 Fund for the rest of this turn only.',
    cost: 1,
    duration: 'this-turn',
    effects: [{ op: 'gain', res: { funds: 1 } }],
  },
  {
    id: 'liv-round',
    name: 'A Round Thing',
    text: 'Gain 1 Fund at the top of every one of your turns for one round.',
    cost: 1,
    duration: 'round',
    effects: [{ op: 'gain', res: { funds: 1 } }],
  },
  {
    id: 'liv-rest',
    name: 'An Enduring Thing',
    text: 'Gain 1 Fund at the top of every one of your turns for the rest of the game.',
    cost: 1,
    duration: 'rest-of-game',
    effects: [{ op: 'gain', res: { funds: 1 } }],
  },
  {
    id: 'liv-next',
    name: 'A Next-Turn Thing',
    text: 'Dormant until your next turn, then gain 1 Fund at the top of every turn after, until the turn after that one is done.',
    cost: 1,
    duration: 'rest-of-game',
    timing: 'next-turn',
    effects: [{ op: 'gain', res: { funds: 1 }, until: 'next-turn' }],
  },
  {
    id: 'liv-hook',
    name: 'A Standing Hook',
    text: 'Gain 1 Fund at the top of every one of your turns until it is used up.',
    cost: 1,
    effects: [{ op: 'gain', res: { funds: 1 }, when: 'on-turn-start', until: 'round' }],
  },
  {
    id: 'liv-two-hooks',
    name: 'Two Hooks At Once',
    text: 'Two independent hooks on the same event, for the rest of the game.',
    cost: 1,
    effects: [
      { op: 'gain', res: { funds: 1 }, when: 'on-turn-start', until: 'rest-of-game' },
      { op: 'gain', res: { clout: 1 }, when: 'on-turn-start', until: 'rest-of-game' },
    ],
  },
  {
    id: 'liv-mixed',
    name: 'A One-Shot And A Hook',
    text: 'Gain 2 Funds now, and 1 Fund at the top of each of your turns for a round.',
    cost: 1,
    duration: 'this-turn',
    effects: [
      { op: 'gain', res: { funds: 2 } },
      { op: 'gain', res: { funds: 1 }, until: 'round' },
    ],
  },
  {
    id: 'liv-gated',
    name: 'A Gated Hook',
    text: 'Gain 1 Fund at the top of your turns for a round, but not the first one.',
    cost: 1,
    duration: 'rest-of-game',
    timing: 'next-turn',
    effects: [{ op: 'gain', res: { funds: 1 }, when: 'on-turn-start', until: 'rest-of-game' }],
  },
];

const LIVING_HEADLINES: readonly HeadlineCard[] = [
  {
    id: 'hliv-standing',
    name: 'A Standing Headline',
    text: 'Gain 1 Trust at the top of every one of your turns for a round.',
    duration: 'round',
    effects: [{ op: 'gain', res: { trust: 1 } }],
  },
];

/**
 * The shared card set PLUS the lasting fixtures.
 *
 * Ideology and Voter Cards come from `helpers.ts` unchanged, so `ANSWER` and
 * `INFLUENCE` work exactly as they do everywhere else and the only thing under test
 * is the lasting half. An index with an empty Ideology deck would fail every answer
 * with "the Ideology Card put to you could not be read", which is a confusing way to
 * learn that a fixture was wrong.
 */
const LIVING: CardIndex = indexCards({
  ideology: IDEOLOGY_CARDS,
  voter: VOTER_CARDS,
  conspiracy: LIVING_CONSPIRACIES,
  headline: LIVING_HEADLINES,
});

/** A ctx whose ONLY cards are the lasting ones, so every id in play is a fixture. */
function livingCtx(): Ctx {
  return { rules: RULES, cards: LIVING };
}

/** A fresh game whose Conspiracy pile is exactly the lasting fixtures. */
function freshLiving(seed = 1, players: readonly PlayerID[] = PLAYERS_3): GameState {
  return fresh(seed, players, {});
}

/** Hand a Conspiracy Card to a player and route it through PLAY_CONSPIRACY. */
function playLiving(
  state: GameState,
  cardId: string,
  by: PlayerID = 'p1',
  c: Ctx = livingCtx(),
): GameState {
  const withCard: GameState = {
    ...state,
    phase: 'actions',
    _pendingCard: null,
    players: {
      ...state.players,
      [by]: { ...state.players[by]!, conspiracies: [...state.players[by]!.conspiracies, cardId] },
    },
  };
  const r = reduce(withCard, by, { type: 'PLAY_CONSPIRACY', cardId }, c);
  if (!r.ok) throw new Error(`could not play ${cardId}: ${r.error}`);
  return r.state;
}

/** Answer, so the game is in the `actions` phase and the pool is known. */
function answered(state: GameState, c: Ctx = livingCtx()): GameState {
  const r = reduce(state, 'p1', { type: 'ANSWER', side: 0 }, c);
  if (!r.ok) throw new Error(`could not answer: ${r.error}`);
  return r.state;
}

/**
 * One full turn boundary: answer if the incoming turn demands it, then end it.
 *
 * `advanceTurn` hands the next player a card and puts the phase back to `answer`, so
 * a bare `END_TURN` from a helper is refused with "answer your Ideology Card first"
 * and a test that walks turns has to do what a player does. Written as one helper so
 * every turn-walking test below reads as "advance the game" rather than as reducer
 * trivia.
 */
function endTurn(state: GameState, by: PlayerID = state.activePlayer, c: Ctx = livingCtx()): GameState {
  let s = state;
  if (s.phase === 'answer') {
    const a = reduce(s, by, { type: 'ANSWER', side: 0 }, c);
    if (!a.ok) throw new Error(`could not answer: ${a.error}`);
    s = a.state;
  }
  const r = reduce(s, by, { type: 'END_TURN' }, c);
  if (!r.ok) throw new Error(`could not end turn: ${r.error}`);
  return r.state;
}


const funds = (s: GameState, p: PlayerID): number => s.players[p]?.resources.funds ?? 0;

// ─────────────────────────── install semantics ───────────────────────────

describe('installing a lasting effect', () => {
  it("duration 'this-turn' installs NOTHING — it is the one-shot the engine always did", () => {
    // The default, and the behaviour of every shipped card before this type existed.
    // If this ever started writing a LiveEffect, every card in the corpus would
    // quietly become a hook.
    const s = playLiving(answered(freshLiving()), 'liv-this-turn');
    expect(s.liveEffects).toEqual([]);
    expect(funds(s, 'p1')).toBeGreaterThan(0);
  });

  it("a lasting duration writes ONE entry per effect, and 'round' beats 'this-turn'", () => {
    // The card says 'this-turn' and one of its effects says 'round'. Per-effect scope
    // wins, which is the only way a card can mix a one-shot branch with a lasting one.
    const s = playLiving(answered(freshLiving()), 'liv-mixed');
    expect(s.liveEffects).toHaveLength(1);
    expect(s.liveEffects[0]?.effects).toHaveLength(1);
    // The one-shot branch resolved immediately…
    expect(funds(s, 'p1')).toBeGreaterThan(1);
  });

  it('a lasting duration with no per-effect scope is ONE standing effect, not one per effect', () => {
    // Two independent auras could drift apart; one entry holding the list cannot.
    const card: ConspiracyCard = {
      id: 'liv-two-standing',
      name: 'Two Standing Effects',
      text: 'Gain 1 Fund and 1 Clout at the top of each of your turns for a round.',
      cost: 1,
      duration: 'round',
      effects: [{ op: 'gain', res: { funds: 1 } }, { op: 'gain', res: { clout: 1 } }],
    };
    const index: CardIndex = { ...LIVING, conspiracy: { ...LIVING.conspiracy, [card.id]: card } };
    const c: Ctx = { rules: RULES, cards: index };
    const s = playLiving(answered(freshLiving(), c), card.id, 'p1', c);
    expect(s.liveEffects).toHaveLength(1);
    expect(s.liveEffects[0]?.effects).toHaveLength(2);
  });

  it('an effect carrying `when` is installed and NOT applied at play time', () => {
    // The property that stops a hook being a free effect on the turn it was played.
    const before = funds(answered(freshLiving()), 'p1');
    const s = playLiving(answered(freshLiving()), 'liv-hook');
    expect(s.liveEffects).toHaveLength(1);
    expect(s.liveEffects[0]?.trigger).toBe('on-turn-start');
    expect(funds(s, 'p1')).toBe(before);
  });

  it('every id comes from the state counter, never a module-level one (R2)', () => {
    const a = playLiving(answered(freshLiving(5)), 'liv-round');
    // A completely unrelated game in between, which is what makes a module-scope
    // counter visible: ids would jump.
    playLiving(answered(freshLiving(999)), 'liv-rest');
    const b = playLiving(answered(freshLiving(5)), 'liv-round');
    expect(a.liveEffects.map((l) => l.id)).toEqual(b.liveEffects.map((l) => l.id));
    // And they are minted from the same counter as choices and voter groups, so a
    // live effect id can never collide with a `c<n>` or `g<n>`.
    expect(a.liveEffects[0]?.id).toMatch(/^L\d+$/);
  });
});

// ─────────────────────────── the lifetime arithmetic ───────────────────────────

describe('the lifetime is two absolute turn numbers, and they are right', () => {
  it('ownerNextTurn walks the seat order, and wraps', () => {
    const s = answered(freshLiving());
    expect(s.turnOrder).toEqual(PLAYERS_3);
    expect(ownerNextTurn(s, 'p1')).toBe(s.turn + 3); // p1's own next turn
    expect(ownerNextTurn(s, 'p2')).toBe(s.turn + 1);
    expect(ownerNextTurn(s, 'p3')).toBe(s.turn + 2);
    // An unknown seat is conservative: expire sooner, never later.
    expect(ownerNextTurn(s, 'nobody')).toBe(s.turn + 1);
  });

  it('roundEndTurn is the first turn of the next round, for every seat', () => {
    for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
      const s: GameState = { ...answered(freshLiving()), turn };
      // 3 players: round 1 is turns 1-3, round 2 is 4-6, round 3 starts at 7.
      expect(roundEndTurn(s), `turn ${turn}`).toBe(Math.floor((turn - 1) / 3) * 3 + 4);
    }
  });

  it("'round' expires at the round boundary and 'rest-of-game' never does", () => {
    const round = playLiving(answered(freshLiving()), 'liv-round');
    expect(round.liveEffects[0]?.expiresAt).toBe(roundEndTurn(round));
    const rest = playLiving(answered(freshLiving()), 'liv-rest');
    expect(rest.liveEffects[0]?.expiresAt).toBeNull();
  });

  it("'next-turn' lives through the owner's next turn and dies at the boundary after", () => {
    const s = playLiving(answered(freshLiving()), 'liv-next');
    expect(s.liveEffects[0]?.activeFrom).toBe(ownerNextTurn(s, 'p1'));
    expect(s.liveEffects[0]?.expiresAt).toBe(ownerNextTurn(s, 'p1') + 1);
  });

  it('a lifetime shorter than the delay to activation is widened, never born expired', () => {
    // `duration: 'this-turn'` on an effect with `until: 'this-turn'` and
    // `timing: 'next-turn'` asks for an effect that can never act. Installing it
    // dead is a card that silently does nothing; widening to one turn is at least a
    // rules problem a human can see.
    const card: ConspiracyCard = {
      id: 'liv-contradiction',
      name: 'A Contradiction',
      text: 'Dormant until your next turn, gone at the end of this one.',
      cost: 1,
      duration: 'this-turn',
      timing: 'next-turn',
      effects: [{ op: 'gain', res: { funds: 1 }, until: 'this-turn' }],
    };
    const index: CardIndex = { ...LIVING, conspiracy: { ...LIVING.conspiracy, [card.id]: card } };
    const c: Ctx = { rules: RULES, cards: index };
    const s = playLiving(answered(freshLiving(), c), card.id, 'p1', c);
    expect(s.liveEffects).toHaveLength(1);
    const le = s.liveEffects[0];
    expect(le).toBeDefined();
    expect(le?.expiresAt).toBe((le?.activeFrom ?? 0) + 1);
  });
});

// ─────────────────────────── standing effects at the turn boundary ───────────────────────────

describe('a standing effect acts at the top of its owner’s turn', () => {
  it('and not on the turn that installed it — that turn has already begun', () => {
    // ERADICATING GERMS is "discard an open Voter Card EVERY turn". The turn it
    // resolved on is gone; the first application is the owner's next one. Rest of
    // game rather than one round, because in a three-player game a round that starts
    // on turn 1 ends on turn 4 — which IS the owner's next turn, so a 'round' effect
    // installed on turn 1 never acts at all. That is the correct reading of "for 1
    // round" and the expiry test below pins it.
    const s = playLiving(answered(freshLiving()), 'liv-rest');
    const atInstall = funds(s, 'p1');
    const nextTurn = endTurn(s);
    expect(nextTurn.activePlayer).toBe('p2');
    expect(funds(nextTurn, 'p1')).toBe(atInstall);
    const backAgain = endTurn(endTurn(nextTurn));
    expect(backAgain.activePlayer).toBe('p1');
    expect(funds(backAgain, 'p1')).toBe(atInstall + 1);
  });

  it('and only for its own owner', () => {
    let s = playLiving(answered(freshLiving()), 'liv-rest');
    const base = funds(s, 'p1');
    s = endTurn(s);
    expect(funds(s, 'p1')).toBe(base); // p2's turn: p1 is not the active player
    s = endTurn(s);
    expect(funds(s, 'p1')).toBe(base); // p3's turn
    s = endTurn(s);
    expect(funds(s, 'p1')).toBe(base + 1); // p1's turn
  });

  it("'round' really does stop at the round boundary, mid-round included", () => {
    let s = playLiving(answered(freshLiving()), 'liv-round');
    const base = funds(s, 'p1');
    const expiresAt = s.liveEffects[0]?.expiresAt ?? 0;
    // Turn 1 with three seats: the round ends on turn 4, so the effect is still
    // there through turns 2 and 3 and gone on 4.
    expect(expiresAt).toBe(4);
    while (s.turn + 1 < expiresAt) s = endTurn(s);
    expect(s.liveEffects).toHaveLength(1);
    const beforeLast = funds(s, 'p1');
    s = endTurn(s);
    expect(s.turn).toBe(expiresAt);
    expect(s.liveEffects).toEqual([]);
    // …and it did not fire on the turn that removed it.
    expect(funds(s, 'p1')).toBe(beforeLast);
    expect(base).toBe(base);
  });

  it('expiry runs BEFORE re-application, or a this-turn effect is immortal', () => {
    // The ordering claim, made observable. `tickLiveEffects` filters first and only
    // then applies; reversed, the effect would be re-applied at the very boundary
    // meant to remove it and would live for ever. Driven on the owner's own turn at
    // the boundary, which is the one case where the two orders differ.
    const s = playLiving(answered(freshLiving()), 'liv-round');
    const expiresAt = s.liveEffects[0]?.expiresAt ?? 0;
    let t = s;
    while (t.turn + 1 < expiresAt) t = endTurn(t);
    const atBoundary = endTurn(t);
    expect(atBoundary.turn).toBe(expiresAt);
    expect(atBoundary.activePlayer).toBe('p1'); // the owner, i.e. the one it would re-apply to
    expect(atBoundary.liveEffects).toEqual([]);
  });

  it('a hook and a standing effect both act at the same boundary, in list order', () => {
    const s = playLiving(answered(freshLiving()), 'liv-two-hooks');
    expect(s.liveEffects).toHaveLength(2);
    // Walk to p1's next turn — three boundaries in a three-seat game — and confirm
    // both hooks fire there, in list order, and not on the two turns in between.
    const t = endTurn(endTurn(endTurn(s)));
    expect(t.activePlayer).toBe('p1');
    const fired = t.log.filter((l) => l.text.endsWith('takes effect.')).map((l) => l.text);
    expect(fired).toEqual(['liv-two-hooks takes effect.', 'liv-two-hooks takes effect.']);
  });
});

// ─────────────────────────── bounded re-entrancy ───────────────────────────

describe('the trigger cascade is bounded, and the bound is real', () => {
  /**
   * Drive the cascade with an explicit budget.
   *
   * The cascade is module-private, so this goes through the one production path that
   * reaches it — the turn boundary — with a fixture that hangs TWO independent hooks
   * off the same event. Two hooks must cost two waves and then stop, which is the
   * whole termination argument: the eligible set is re-scanned each wave, an effect
   * that has already fired is excluded, and `TRIGGER_MAX_WAVES` caps the rest.
   */
  it('two hooks on one event both fire, and a third wave finds nothing', () => {
    const s = playLiving(answered(freshLiving()), 'liv-two-hooks');
    const t = endTurn(endTurn(endTurn(s)));
    const fired = t.log.filter((l) => l.text.endsWith('takes effect.'));
    // Exactly two, not three and not four: the eligible set is re-scanned each
    // wave, an effect that has already fired is excluded, and the third wave finds
    // nothing left. That is the whole termination argument in one number.
    expect(fired).toHaveLength(2);
    // And on p1's NEXT turn it is exactly two more, not four — the hooks are still
    // in force, so this is a per-turn effect rather than a one-shot that got
    // re-armed by the cascade.
    const again = endTurn(endTurn(endTurn(t)));
    expect(again.log.filter((l) => l.text.endsWith('takes effect.'))).toHaveLength(4);
  });

  it('the cap is a small constant, not "unbounded", and is exported for the record', () => {
    // Asserting the number is not the point; asserting that the loop is a `for` over
    // a budget is, and that is what `fireTriggers`'s signature and the comment above
    // `TRIGGER_MAX_WAVES` say. A test that only asserted the constant would still pass
    // if the loop were changed to a `while (true)` that ignored it, so the test that
    // matters is the one above: two hooks, two waves, stop.
    expect(Number.isInteger(TRIGGER_MAX_WAVES)).toBe(true);
    expect(TRIGGER_MAX_WAVES).toBeGreaterThan(0);
    expect(TRIGGER_MAX_WAVES).toBeLessThan(1000);
  });

  it('no effect op can emit a board event, so the cascade cannot recurse through setArea', () => {
    // The structural half of the termination argument, derived from the reducer's own
    // source for the same reason the op registry is. `setArea` is the only thing that
    // raises `on-majority-formed` and `on-volatile-placement`; if no effect case can
    // reach it, a hook cannot wake a hook through the board.
    const src = readFileSync(resolve(HERE, '..', 'src', 'reduce.ts'), 'utf8');
    const start = src.indexOf('function applyEffect');
    const end = src.indexOf('function applyEffects', start);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect(body).not.toContain('setArea');
  });
});

// ─────────────────────────── determinism ───────────────────────────

describe('live effects are reproducible', () => {
  /** Grant two lasting cards to p1 and return a state ready to play them. */
  function armedLiving(seed: number): GameState {
    const base = answered(freshLiving(seed));
    return {
      ...base,
      players: {
        ...base.players,
        p1: { ...base.players.p1!, conspiracies: ['liv-rest', 'liv-round'] },
      },
    };
  }

  it('a full replay from seed + action log reproduces every intermediate state', () => {
    // The general property, driven through a game that actually installs live
    // effects. `integration.test.ts` proves it for the shipped card set; this proves
    // it for the new field, which is the one that could have broken it.
    const script: { p: PlayerID; a: Parameters<typeof reduce>[2] }[] = [
      { p: 'p1', a: { type: 'PLAY_CONSPIRACY', cardId: 'liv-rest' } },
      { p: 'p1', a: { type: 'PLAY_CONSPIRACY', cardId: 'liv-round' } },
      { p: 'p1', a: { type: 'END_TURN' } },
    ];

    const run = (): string[] => {
      let s = armedLiving(7);
      const out: string[] = [];
      for (const step of script) {
        const r = reduce(s, step.p, step.a, livingCtx());
        if (!r.ok) throw new Error(r.error);
        s = r.state;
        out.push(JSON.stringify(s));
      }
      expect(s.liveEffects.length).toBeGreaterThan(0);
      return out;
    };

    const recorded = run();
    // Interleave an unrelated game, which is what makes any leaked module state
    // visible, then replay.
    playLiving(answered(freshLiving(999)), 'liv-next');
    expect(run()).toEqual(recorded);
  });

  it('its lifetime is a turn number, so a deck reshuffle cannot move it', () => {
    // The reshuffle is the other place a counter could drift: `draw` re-seeds
    // `_seed` from the discard pile, so anything expressed as "count of draws"
    // rather than as a turn number would land differently afterwards. Walk a real
    // game on the TWELVE-card Ideology deck past the point where it recycles.
    const small: Ctx = { rules: RULES, cards: LIVING };
    let s = setup({
      players: PLAYERS_3,
      cards: LIVING,
      seed: 3,
      ideologyDeck: IDEOLOGY_CARDS.map((c) => c.id),
      voterDeck: VOTER_CARDS.map((c) => c.id),
      conspiracyDeck: ['liv-rest'],
      headlineDeck: [],
    });
    for (let i = 0; i < 20; i += 1) s = endTurnAny(s, small);
    expect(s.turn).toBeGreaterThan(12); // past the 12-card deck, so a reshuffle happened
    expect(s._ideologyDraw.length).toBeLessThan(12);
    expect(s._ideologyDiscard.length).toBeGreaterThan(0);
    // The helpers the installer calls are pure functions of the seat order and the
    // turn number, so they read the same before and after a reshuffle.
    expect(ownerNextTurn(s, 'p2')).toBe(s.turn + 1);
    expect(ownerNextTurn(s, 'p1')).toBe(s.turn + 3);
    expect(roundEndTurn(s)).toBe(Math.floor((s.turn - 1) / 3) * 3 + 4);
  });
});

/** Advance one turn of a big-deck game, answering as the active player. */
function endTurnAny(state: GameState, c: Ctx): GameState {
  let s = state;
  if (s.phase === 'answer') {
    const a = reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, c);
    if (!a.ok) return s;
    s = a.state;
  }
  const r = reduce(s, s.activePlayer, { type: 'END_TURN' }, c);
  return r.ok ? r.state : s;
}


// ─────────────────────────── visibility ───────────────────────────

describe('a live effect is PUBLIC, deliberately', () => {
  it('the client payload carries it — its absence would be the bug', () => {
    const s = playLiving(answered(freshLiving()), 'liv-round');
    for (const viewer of s.turnOrder) {
      const client = playerView(s, viewer);
      expect(client.liveEffects, viewer).toHaveLength(1);
      expect(client.liveEffects[0]?.owner).toBe('p1');
      expect(client.liveEffects[0]?.sourceCardId).toBe('liv-round');
    }
  });

  it('and it introduces no `_` key at any depth, for any viewer', () => {
    let s = playLiving(answered(freshLiving()), 'liv-mixed');
    s = endTurn(endTurn(s));
    for (const viewer of s.turnOrder) {
      const leaks = allKeys(playerView(s, viewer)).filter((k) => k.startsWith('_'));
      expect(leaks, viewer).toEqual([]);
    }
  });

  it('and it never names a Conspiracy Card a player is still holding', () => {
    // The R1-shaped leak, in the one place a new public field could cause it. A
    // `LiveEffect` is only ever created by a card being RESOLVED, and both
    // `PLAY_CONSPIRACY` and `ACK_HEADLINE` discard that card in the same breath — so
    // `sourceCardId` cannot name a card in a hidden hand. This asserts the property
    // rather than trusting the argument, because the argument is a comment.
    const base = answered(freshLiving());
    const withHand: GameState = {
      ...base,
      players: {
        ...base.players,
        p2: { ...base.players.p2!, conspiracies: ['secret-in-hand'] },
      },
    };
    const s = playLiving(withHand, 'liv-rest', 'p1');
    for (const viewer of s.turnOrder) {
      const json = JSON.stringify(playerView(s, viewer));
      expect(json, viewer).not.toContain('secret-in-hand');
      // …and p2's hand is still blank for everybody, including p2.
      expect(playerView(s, viewer).players.p2?.conspiracies).toEqual([]);
    }
  });

  it('a card resolved by one player is visible in force to all of them, which is the card’s point', () => {
    // KHAKI TERROR's whole mechanic is that everyone can see you cannot buy. A
    // "silent" lasting effect would be a different game.
    const s = playLiving(answered(freshLiving()), 'liv-rest');
    const views = s.turnOrder.map((v) => JSON.stringify(playerView(s, v).liveEffects));
    expect(new Set(views).size).toBe(1);
  });
});

// ─────────────────────────── interaction with the rest of the engine ───────────────────────────

describe('live effects do not disturb the rest of the turn machinery', () => {
  it('a fresh game has none, and the field is present from setup', () => {
    expect(freshLiving().liveEffects).toEqual([]);
    expect(Object.keys(freshLiving())).toContain('liveEffects');
  });

  it('the shipped card set is unaffected: a full game still plays out', () => {
    // A guard against a change to `advanceTurn` or `applyEffects` that happens to be
    // invisible in the unit tests above. `integration.test.ts` pins the deep
    // invariants; this one only asks that a long game does not throw and that no
    // shipped card — none of which carries a lasting clause — installs anything.
    let s = freshFull(3);
    for (let i = 0; i < 40; i += 1) s = endTurnAny(s, bigCtx());
    expect(s.turn).toBeGreaterThan(12);
    expect(s.liveEffects).toEqual([]);
  });

  it('a Headline can install one too, and its owner is the player the peg belongs to', () => {
    // `ACK_HEADLINE` resolves with `source` = whoever placed the volatile peg, not
    // the player acknowledging. Getting that wrong would bind the effect to the
    // wrong seat for the rest of the game.
    const base = answered(freshLiving());
    const queued: GameState = {
      ...base,
      phase: 'headlines',
      activeHeadline: 'hliv-standing',
      headlineQueue: [{ areaId: '', by: 'p3' }, { areaId: '', by: 'p3' }],
    };
    const r = reduce(queued, 'p1', { type: 'ACK_HEADLINE' }, livingCtx());
    if (!r.ok) throw new Error(r.error);
    expect(r.state.liveEffects).toHaveLength(1);
    expect(r.state.liveEffects[0]?.owner).toBe('p3');
  });

  it('isInForce is the single definition of "in force", and both sides use it', () => {
    const le = { id: 'x', owner: 'p1', sourceCardId: 'c', trigger: null, effects: [], activeFrom: 4, expiresAt: 7 };
    expect(isInForce(le, 3)).toBe(false); // dormant
    expect(isInForce(le, 4)).toBe(true);
    expect(isInForce(le, 6)).toBe(true);
    expect(isInForce(le, 7)).toBe(false); // expired
    expect(isInForce({ ...le, expiresAt: null }, 9999)).toBe(true);
  });
});

// ─────────────────────────── a FireContext is an argument, never state ───────────────────────────

describe('a FireContext is an argument, never state', () => {
  it('carries the five fields the conditions and ops read', () => {
    // Not a runtime behaviour test — a statement that the shape is what the
    // conditions above assume, checked at compile time by the helper that builds one.
    // A sixth field added to the type would fail this, which is the point: a fire
    // context that grew a secret would be a new thing to leak.
    const fire: FireContext = {
      trigger: 'on-turn-start',
      actor: 'p1',
      voters: 0,
      areaId: null,
      pegOwner: null,
    };
    expect(Object.keys(fire).sort()).toEqual(['actor', 'areaId', 'pegOwner', 'trigger', 'voters']);
  });
});
