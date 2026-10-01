/**
 * §3.1 INTEGRATION — the game is WINNABLE at the deck size the server deals.
 *
 * This file exists because of a real 5-player browser playtest on 2026-10-01 in
 * which two games were played and both ended at turn 52 with 0 of 9 zones holding
 * a majority and 45 pegs on the board. The game could not be won at ANY seat
 * count, and no test noticed, for a reason this file is built to make impossible
 * to repeat:
 *
 * `helpers.ts`'s `bigCards()` deals 4000 Ideology Cards. One ANSWER per turn means
 * the deck ran out after 52 turns, so every test in the suite has been playing a
 * game with 77 times the Ideology deck the server actually shuffles. Every fixture
 * was structurally incapable of reaching the bug. `freshShipped` below deals the
 * real numbers, and these tests are the first in the package to do so.
 *
 * The numbers that decide whether a game is winnable, and where they come from
 * (`loadCorpus` over the in-repo JSON, measured 2026-10-01):
 *
 *   | deck            | shipped | what a wrong number would hide                    |
 *   |-----------------|--------:|---------------------------------------------------|
 *   | Ideology Cards  |      52 | one per turn, so the deck empties on turn 52      |
 *   | Voter Cards     |      18 | 36 voters, but they RECYCLE, so this is not a cap  |
 *   | Conspiracy Cards|      22 |                                                   |
 *   | Headline Cards  |      26 |                                                   |
 *
 * The board needs 69 pegs to form all nine majorities and 129 to fill. 45 is what a
 * table gets before the deck dies, which is what the tester saw.
 */

import { describe, expect, it } from 'vitest';

import { allMajoritiesFormed, boardFull, scores, winners } from '../src/board';
import { reduce } from '../src/reduce';
import { setup } from '../src/setup';
import type { GameState, PlayerID } from '../src/state';
import { playFullGame } from './driver';
import {
  CARDS,
  CONSPIRACY_DECK,
  HEADLINE_DECK,
  IDEOLOGY_DECK,
  VOTER_DECK,
  fresh,
  freshShipped,
  makeCtx,
  seats,
  shippedCtx,
} from './helpers';

const ctx = shippedCtx();

/** The shipped Ideology deck, as `loadCorpus` assembles it. 20 + 32. */
const SHIPPED_IDEOLOGY = 52;

/** Pegs needed to hold a majority in all nine zones: 6+11+6+9+5+9+6+11+6. */
const MAJORITY_PEGS = 69;

function runShipped(seed: number, n: number) {
  return playFullGame(freshShipped(seed, seats(n)), ctx);
}

function pegsOn(state: GameState): number {
  return state.zones.reduce((k, z) => k + z.areas.filter((a) => a.peg !== null).length, 0);
}

// ─────────────────────── the recycle, unit level ───────────────────────

describe('the Ideology discard pile', () => {
  it('gains the answered card, so the deck can recycle', () => {
    // THE line under test. `ANSWER` is the only ordinary path an Ideology Card
    // takes, and until it discarded, `_ideologyDiscard` was written by nothing but
    // the paid `REDRAW_IDEOLOGY` — so in ordinary play the pile was always empty
    // and `draw`'s reshuffle could never fire.
    const small = makeCtx();
    let s = fresh(1);
    expect(s._ideologyDiscard).toEqual([]);
    const first = s._pendingCard;
    expect(first).not.toBeNull();

    const r = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, small);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state._ideologyDiscard).toEqual([first]);
    // …and it is the same card the player now holds in public, so this is not a
    // secret-state change.
    expect(r.state.players.p1?.manifestoCards).toEqual([first]);
  });

  it('one card in the discard per ANSWER, and the deck is conserved', () => {
    const small = makeCtx();
    let s = fresh(1);
    for (let i = 0; i < 5; i++) {
      const before = s._ideologyDiscard.length;
      const a = reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, small);
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      s = a.state;
      expect(s._ideologyDiscard.length).toBe(before + 1);
      const e = reduce(s, s.activePlayer, { type: 'END_TURN' }, small);
      expect(e.ok).toBe(true);
      if (!e.ok) return;
      s = e.state;
    }
    expect(s._ideologyDiscard.length).toBe(5);
    // Nothing is duplicated and nothing is lost. The three places a card can be
    // are the two piles and the one card in the answering player's hand, and they
    // always sum to the deck that was dealt.
    expect(s._ideologyDraw.length + s._ideologyDiscard.length + (s._pendingCard ? 1 : 0)).toBe(12);
  });
});

describe('the Ideology reshuffle', () => {
  it('a draw pile that empties is rebuilt from the discard, with the seed threaded', () => {
    // Direct, and independent of any game: deal a 2-card deck, answer both cards
    // so the draw pile empties, and watch the third card come off the reshuffle.
    const small = makeCtx();
    let s = fresh(1, ['p1', 'p2'], { startResources: [{}, {}] });
    expect(s._pendingCard).not.toBeNull();
    // Narrow to exactly two cards: one in hand, one in the draw pile.
    s = { ...s, _pendingCard: 'ide-01', _ideologyDraw: ['ide-02'] };

    // p1 answers, so card A lands on the discard pile.
    const answered = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, small);
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    s = answered.state;
    expect(s._ideologyDiscard).toEqual(['ide-01']);
    expect(s._ideologyDraw).toEqual(['ide-02']);

    // p1 ends the turn. The draw pile still holds a card, so no reshuffle yet: p2
    // is put card B and the discard keeps card A.
    const first = reduce(s, 'p1', { type: 'END_TURN' }, small);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    s = first.state;
    expect(s.finished).toBe(false);
    expect(s.turn).toBe(2);
    expect(s._pendingCard).toBe('ide-02');
    expect(s._ideologyDraw).toEqual([]);
    expect(s._ideologyDiscard).toEqual(['ide-01']);
    const seedBeforeReshuffle = s._seed;

    // p2 answers card B, which empties BOTH piles' draw side and fills the discard.
    const b = reduce(s, 'p2', { type: 'ANSWER', side: 0 }, small);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    s = b.state;
    expect(s._ideologyDraw).toEqual([]);
    expect(s._ideologyDiscard).toEqual(['ide-01', 'ide-02']);

    // p2 ends the turn. NOW the draw pile is empty, and this is the reshuffle that
    // used to be unreachable: both cards come back, and the seed advances so the
    // order is a function of state rather than of chance.
    const second = reduce(s, 'p2', { type: 'END_TURN' }, small);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    s = second.state;
    expect(s.finished).toBe(false);
    expect(s.turn).toBe(3);
    expect(s._seed).not.toBe(seedBeforeReshuffle);
    expect(s._ideologyDiscard).toEqual([]);
    expect(s._ideologyDraw.length).toBe(1); // one card put to p1, one still stacked
    expect([s._pendingCard, ...s._ideologyDraw].sort()).toEqual(['ide-01', 'ide-02']);
    // Both cards are in play again, none lost and none duplicated.
    expect(s._ideologyDraw.length + s._ideologyDiscard.length + (s._pendingCard ? 1 : 0)).toBe(2);
  });

  it('an answer never costs a card: the deck is conserved across a whole game', () => {
    // The property that makes recycling sound. A card is drawn exactly once per
    // turn and put on the discard exactly once per answer, so the two piles always
    // sum to the dealt deck.
    const { state } = runShipped(1, 3);
    expect(state._ideologyDraw.length + state._ideologyDiscard.length).toBe(SHIPPED_IDEOLOGY);
  });
});

// ─────────────────────── the game is winnable ───────────────────────

describe('a game at the SHIPPED deck size can be won', () => {
  it('5 players, seed 19: a majority in all 9 zones, won on turn 72', () => {
    // The configuration the tester hit, and the number that matters: 72 > 52. The
    // old build could not reach this turn at all — it ended at 52.
    const { state, steps } = runShipped(19, 5);
    expect(state.finished).toBe(true);
    expect(state.turn).toBeGreaterThan(SHIPPED_IDEOLOGY);
    expect(allMajoritiesFormed(state)).toBe(true);
    for (const z of state.zones) expect(z.majorityHolder, `zone ${z.id} has no majority`).not.toBeNull();
    expect(pegsOn(state)).toBeGreaterThanOrEqual(MAJORITY_PEGS);
    expect(steps.length).toBeLessThan(2000);

    // The board is decided, and the standing is a real scoreboard: a single winner
    // on the sum of flipped pegs.
    const s = scores(state);
    expect(s).toEqual({ p1: 0, p2: 28, p3: 5, p4: 15, p5: 21 });
    expect(winners(state)).toEqual(['p2']);
  });

  it('2-, 3-, 4- and 5 players all reach a decided board on the shipped decks', () => {
    // p7's staggered start is part of why this now works at 5 seats: a 5-player
    // table starts 1..5, so the last player is not a turn behind the first on a
    // board this size.
    const decided: Record<number, { seed: number; turn: number; majorities: number }> = {
      2: { seed: 1, turn: 50, majorities: 9 },
      3: { seed: 1, turn: 58, majorities: 9 },
      4: { seed: 1, turn: 65, majorities: 9 },
      5: { seed: 19, turn: 72, majorities: 9 },
    };
    for (const n of [2, 3, 4, 5]) {
      const pin = decided[n];
      if (!pin) throw new Error('unpinned seat count');
      const { state } = runShipped(pin.seed, n);
      expect(state.finished, `${n} players did not finish`).toBe(true);
      const majorities = state.zones.filter((z) => z.majorityHolder !== null).length;
      expect(majorities, `${n} players left a zone undecided`).toBe(pin.majorities);
      expect(state.turn, `${n} players ended on an unexpected turn`).toBe(pin.turn);
      // A decided board is the win condition; p20's board-full ending is the other
      // legal one, so accept either rather than assuming.
      expect(
        allMajoritiesFormed(state) || boardFull(state),
        `${n} players finished with neither nine majorities nor a full board`,
      ).toBe(true);
    }
  });

  it('the recycle fires mid-game rather than the game ending at turn 52', () => {
    // The bug, pinned as an observation. `_ideologyDraw` only ever SHRINKS between
    // reshuffles, so any increase is a reshuffle — and a game that reaches turn
    // 72 with a 52-card deck must have reshuffled at least once.
    let reshuffles = 0;
    let last = freshShipped(19, seats(5))._ideologyDraw.length;
    const { state } = playFullGame(freshShipped(19, seats(5)), ctx, (s) => {
      const now = s._ideologyDraw.length;
      if (now > last) reshuffles += 1;
      last = now;
    });
    expect(reshuffles).toBeGreaterThan(0);
    expect(state.turn).toBeGreaterThan(SHIPPED_IDEOLOGY);
    // And the game did not end because the deck ran out.
    expect(state.log.some((l) => l.text.includes('Ideology deck is exhausted'))).toBe(false);
  });

  it('a shipped-size game is reproducible: same seed + same log = identical state', () => {
    // The recycle runs a shuffle off `_seed`, so this is where a determinism
    // regression would hide. Assert the whole graph, not a summary.
    const a = runShipped(2, 5);
    const b = runShipped(2, 5);
    expect(b.steps.length).toBe(a.steps.length);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });

  it('a full replay of a shipped game past the turn-52 cliff reproduces every state', () => {
    // The stronger form, and the one that covers the reshuffle itself: 78 turns,
    // one or more shuffles, every intermediate state identical.
    const recorded: string[] = [];
    const { steps } = playFullGame(freshShipped(2, seats(5)), ctx, (s) => recorded.push(JSON.stringify(s)));
    expect(steps.length).toBeGreaterThan(SHIPPED_IDEOLOGY);

    let s = freshShipped(2, seats(5));
    const again: string[] = [];
    for (const { p, a } of steps) {
      const r = reduce(s, p, a, ctx);
      if (!r.ok) throw new Error(`replay diverged: ${p} ${JSON.stringify(a)} -> ${r.error}`);
      s = r.state;
      again.push(JSON.stringify(s));
    }
    expect(again).toEqual(recorded);
  });
});

// ─────────────────────── the regression, named ───────────────────────

describe('the turn-52 regression', () => {
  it('a shipped 5-player game passes turn 52 and is still playable there', () => {
    // The minimum acceptance bar, stated as its own test so a future change that
    // re-breaks this fails with a message that says what broke. At turn 52 the old
    // build had `finished: true` and no legal action of any kind.
    //
    // Driven by `playFullGame` rather than a hand-rolled stepper, because the point
    // is what a REAL game does at turn 53 and a weaker driver would answer a
    // different question.
    const onTurn53: GameState[] = [];
    const { state } = playFullGame(freshShipped(19, seats(5)), ctx, (s) => {
      if (s.turn === 53) onTurn53.push(s);
    });

    expect(onTurn53.length, `no state was ever reached on turn 53; the game ended on turn ${state.turn}`).toBeGreaterThan(0);
    const at53 = onTurn53[0];
    if (!at53) return;
    expect(at53.finished).toBe(false);
    // A card is genuinely in the answering player's hand, drawn off the reshuffle.
    expect(at53.phase).toBe('answer');
    expect(at53._pendingCard).not.toBeNull();
    // …and answering it is a legal move.
    const answer = reduce(at53, at53.activePlayer, { type: 'ANSWER', side: 0 }, ctx);
    expect(answer.ok, 'turn 53 had no legal ANSWER').toBe(true);
    // The pile is doing the work. Turn 53's card was dealt off a RESHUFFLE: all 52
    // cards had been answered into the discard, the draw pile was refilled from
    // them, and one came out. A build without the fix has no turn 53 at all.
    expect(at53._ideologyDraw.length).toBe(SHIPPED_IDEOLOGY - 1);
    expect(at53._ideologyDiscard.length).toBe(0);
  });

  it('the exhausted-deck ending is now unreachable while a card is in play', () => {
    // The `cardId === null` branch in `advanceTurn` is not dead code and must not
    // become a soft-lock. But once ANSWER discards, the two piles can only BOTH be
    // empty if no card exists at all, so the branch cannot fire mid-game — which is
    // the whole point of the fix. The only way to reach it is a deck that was empty
    // at setup, and `setup` already refuses to leave that soft-locked: it deals the
    // first card precisely so turn 1 has a legal move.
    const small = makeCtx();
    const decks = {
      ideologyDeck: IDEOLOGY_DECK,
      voterDeck: VOTER_DECK,
      conspiracyDeck: CONSPIRACY_DECK,
      headlineDeck: HEADLINE_DECK,
    };
    // 1. An empty Ideology deck has no card to deal, and that IS a soft-lock at
    //    turn 1 — a fixture defect, not a game state, which is why `setup`'s own
    //    docstring makes dealing the first card a requirement rather than a nicety.
    const empty = setup({ players: ['p1', 'p2'], cards: CARDS, seed: 1, ...decks, ideologyDeck: [] });
    expect(empty._pendingCard).toBeNull();
    expect(reduce(empty, 'p1', { type: 'ANSWER', side: 0 }, small).ok).toBe(false);
    expect(reduce(empty, 'p1', { type: 'END_TURN' }, small).ok).toBe(false);

    // 2. With even ONE card, the recycle keeps the game alive indefinitely, so the
    //    ending can never be reached no matter how many turns are played. Answering
    //    over and over walks both players into the resource cap (p12), so the loop
    //    has to clear the resulting `lose-any` decision or `END_TURN` is refused —
    //    which is itself worth proving, because a frozen player is the soft-lock
    //    this whole branch was written to avoid.
    let s = setup({ players: ['p1', 'p2'], cards: CARDS, seed: 1, ...decks, ideologyDeck: ['ide-01'] });
    expect(s._pendingCard).toBe('ide-01');
    let capsCleared = 0;
    for (let turn = 0; turn < 20; turn++) {
      const a = reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, small);
      expect(a.ok, `turn ${turn} ANSWER refused`).toBe(true);
      if (!a.ok) return;
      s = a.state;
      // p12: cross the cap and you must discard before any other action.
      const cap = s.choices.find((c) => c.player === s.activePlayer);
      if (cap) {
        expect(cap.choice.kind).toBe('lose-any');
        const n = cap.choice.count;
        const r = reduce(
          s,
          cap.player,
          { type: 'RESOLVE_CHOICE', choiceId: cap.id, pick: { kind: 'resources', res: { funds: n } } },
          small,
        );
        expect(r.ok, `turn ${turn} cap discard refused`).toBe(true);
        if (!r.ok) return;
        s = r.state;
        capsCleared += 1;
      }
      const e = reduce(s, s.activePlayer, { type: 'END_TURN' }, small);
      expect(e.ok, `turn ${turn} END_TURN refused`).toBe(true);
      if (!e.ok) return;
      s = e.state;
      if (s.finished) break;
    }
    // 20 ANSWERs on a 1-card deck, still live: the same card comes round again and
    // again, which is precisely what the old build could not do.
    expect(s.finished).toBe(false);
    expect(s.turn).toBe(21); // 20 answers, and the 20th END_TURN dealt the 21st card
    expect(s._pendingCard).toBe('ide-01');
    expect(capsCleared).toBeGreaterThan(0);
    expect(s.log.some((l) => l.text.includes('Ideology deck is exhausted'))).toBe(false);
  });
});

describe('the staggered start carries the win', () => {
  it('5 players on the shipped decks win BOTH with and without it, and it is not a coin flip', () => {
    // Not a claim that the game is unwinnable without p7 — it is not, the driver
    // grinds through. The claim is the one the playtest supports: a table that
    // opens 0/0/0/0 across five seats is a table where the last player is a full
    // turn behind on a 129-area board, which is the shape of the bug report.
    const withStart = runShipped(19, 5);
    expect(allMajoritiesFormed(withStart.state)).toBe(true);

    // A caller that wants the old opening can still ask for it explicitly, and
    // that is the point of the ruling: the rule is a DEFAULT, not a forced hand.
    const noStart = playFullGame(freshShipped(19, seats(5), [{}, {}, {}, {}, {}]), ctx);
    expect(noStart.state.finished).toBe(true);
    expect(noStart.steps.length).toBeLessThan(2000);
  });

  it('the win is not an artefact of the driver: a 4-player game is decided too', () => {
    // `freshShipped` takes no `startResources`, so every seat is on p7's default —
    // which is what the server path (`lobby.ts:262`, which passes nothing) deals.
    const { state, steps } = runShipped(29, 4);
    expect(state.finished).toBe(true);
    expect(state.turn).toBeGreaterThan(SHIPPED_IDEOLOGY);
    expect(state.zones.filter((z) => z.majorityHolder !== null).length).toBe(9);
    expect(steps.length).toBeLessThan(2000);
  });
});
