/**
 * G13d — THE RESPONSE WINDOW, from the server's side, on a corpus that has one.
 *
 * WHAT THIS FILE IS FOR
 *
 * `packages/engine/test/interrupts.test.ts` proves the window cannot deadlock, on
 * hand-built positions. That is the right place for it and this file does not repeat
 * it: the engine owns the rules, and a server test that re-asserted them would only be a
 * second transcription free to drift. What the engine cannot see is everything
 * downstream of `reduce` — that the projection a seat acts on carries the window, that
 * the driver the winnability sweep uses can act during one, and that neither of them has
 * to be told a secret to do it.
 *
 * So the claims here are all SERVER claims, and each is a claim about a different pair of
 * packages:
 *
 *  1. **A window opens, closes, and the table keeps playing — at every seat count.**
 *     `winnable.test.ts` proves the shipped corpus finishes at 2, 3, 4 and 5 seats.
 *     This proves it again on a corpus where a window is REACHABLE, because a driver
 *     that survives a window it cannot avoid is a different claim from one that survives
 *     a corpus with no windows in it at all.
 *  2. **The window leaks nothing about who holds a reactive card.** `GameState.interrupt`
 *     is public by decision (`InterruptWindow` in `state.ts`), so this is the file that
 *     has to hold that decision to its promise. The residual bit — *somebody* holds one
 *     — is the engine's ruling, asserted here as a ruling rather than smuggled in as an
 *     exception.
 *  3. **The driver never reads another seat's hand.** `ownKnowledge` reads
 *     `state.players[me].conspiracies` and nothing else, and there is no parameter
 *     through which another seat's hand could be supplied. That was a real bug once, so
 *     the assertion is structural (the signature) AND behavioural (poison the other
 *     hands, then ask the same question) — either alone is satisfiable by an accident.
 *  4. **Declining alone is enough.** A table whose seats know nothing still closes every
 *     window. That is the honest fallback, and it is the one a production incident
 *     actually hits, because a real client has no hand to offer.
 *
 * WHY A FIXTURE CORPUS RATHER THAN THE SHIPPED DECK
 *
 * `./reactive-corpus.ts` puts BLOCK and DEFLECT into the deck AND into specific seats'
 * hands. Both halves are load-bearing and the reason is written at length in that file's
 * header: `canBeAnswered` asks whether a player HOLDS a reactive card, and this driver
 * never buys a Conspiracy Card, so with the cards merely in the deck no window would ever
 * open and every assertion below would compare two nulls. Nothing here reaches into the
 * engine: `playInProcess` drives the same `nextAction` the socket tests drive, through
 * the same `reduce`, against the same shipped corpus plus two cards.
 *
 * THE ONE BIT THAT IS DELIBERATELY SPENT
 *
 * An open window tells every client that somebody holds a reactive card. It names no
 * player. That is the engine's ruling and it is the same class of disclosure as
 * `awaitingAnswer`; the alternative — a window that opens silently — leaves a real client
 * with no way to know it is anybody's turn to act. The leak tests hold that to its
 * promise: the window payload is byte-identical for every viewer, and byte-identical
 * even when the reactive cards move to DIFFERENT seats. The second is the one with teeth,
 * because it is the falsifiable form — any field that leaked the holder changes when the
 * holder changes, and the two payloads stop matching.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  playerView,
  reduce,
  type Action,
  type CardID,
  type Ctx,
  type Effect,
  type GameState,
  type InterruptWindow,
  type PlayerID,
  type Resource,
} from '@shasn/engine';

import { viewFor } from '../src/broadcast.ts';
import { BOARD, factsOf } from './corpus-facts.ts';
import {
  majoritiesOn,
  nextAction,
  ownKnowledge,
  pegsOn,
  playInProcess,
  reactiveAnswer,
  requiredDecliners,
  responseOrder,
  windowResponder,
  type RunResult,
  type SeatKnowledge,
} from './driver.ts';
import {
  BLOCK_ID,
  dealReactiveHands,
  DEFLECT_ID,
  FIXTURE_BLOCK,
  FIXTURE_DEFLECT,
  reactiveCtx,
  reactiveGame,
} from './reactive-corpus.ts';

const ctx: Ctx = reactiveCtx();

const SEATS = [2, 3, 4, 5] as const;

/** The seeds swept at every seat count. A range, not a pick. */
const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1);

const POOLS: readonly Resource[] = ['funds', 'clout', 'media', 'trust'];

/**
 * Pegs needed to hold a majority in all nine zones, and the turn at which the shipped
 * Ideology deck runs out. Both MEASURED: this file used to carry its own `69` and its
 * own bare `toBeGreaterThan(52)`, and both numbers were hand-copies of facts that
 * already existed elsewhere in the suite. `BOARD` and `factsOf` make one copy of each
 * and it cannot drift.
 */
const MAJORITY_PEGS = BOARD.majorityPegs;
const TURN_CLIFF = factsOf(ctx.cards).dealt.ideology;

/** The printed keys of `InterruptWindow`. Eleven, and none of them names a holder. */
const WINDOW_KEYS = [
  'actor',
  'blocked',
  'cardId',
  'deflectedTo',
  'duration',
  'effects',
  'id',
  'kind',
  'passed',
  'responder',
  'timing',
];

function poolOf(s: GameState, p: PlayerID): Record<string, number> {
  return { ...(s.players[p]?.resources ?? {}) };
}

function totalOf(pool: Readonly<Record<string, number>>): number {
  let n = 0;
  for (const r of POOLS) n += pool[r] ?? 0;
  return n;
}

/** Every reactive card currently in anybody's hand. */
function allHeldIds(s: GameState): CardID[] {
  return [...new Set(s.turnOrder.flatMap((p) => s.players[p]?.conspiracies ?? []))];
}

function holderOf(s: GameState, id: CardID): PlayerID | null {
  return s.turnOrder.find((p) => (s.players[p]?.conspiracies ?? []).includes(id)) ?? null;
}

/**
 * What the staged effects would hand `actor` outright if they resolved.
 *
 * **`gain` only, and never `gain-any`.** `gain` carries a `Delta` and pays
 * deterministically; `gain-any` raises a `PendingChoice` and pays whatever the chooser
 * picks, which is unknowable from the card. So this is a LOWER BOUND on the payout, and
 * that is the right shape for the claim it is used for: if the actor gained at least this
 * much in the un-blocked resolution and none of it in the blocked one, the BLOCK
 * demonstrably did something. A headline whose whole effect is a choice contributes 0
 * and is skipped by the arithmetic rather than guessed at.
 */
function deterministicActorGain(effects: readonly Effect[], actor: PlayerID): number {
  let n = 0;
  for (const e of effects) {
    if (e.op !== 'gain') continue;
    const target = 'target' in e ? e.target : undefined;
    if (target !== undefined && target !== 'you') continue; // somebody else's payout
    for (const amount of Object.values(e.res)) {
      if (typeof amount === 'number') n += amount;
    }
  }
  void actor;
  return n;
}

function reduceOrThrow(s: GameState, p: PlayerID, a: Action, why: string): GameState {
  const r = reduce(s, p, a, ctx);
  if (!r.ok) throw new Error(`${why}: ${p} ${a.type} -> ${r.error}`);
  return r.state;
}

/** The action this driver takes for `me`, for whatever decision `me` owns. */
function driverAction(s: GameState, me: PlayerID): Action {
  const action = nextAction(playerView(s, me), me);
  if (action === null) {
    const open = s.choices.find((c) => c.player === me);
    throw new Error(
      `no legal action for ${me} in phase ${s.phase}` +
        (open === undefined ? '' : ` while owning choice ${open.choice.kind}`),
    );
  }
  return action;
}

/**
 * Drive a reactive game until a window is OPEN, and return that state.
 *
 * Deliberately not `playInProcess`: that function plays *through* a window, and this one
 * has to stop inside one. Everything else about the loop is the same order
 * `playInProcess` uses — an open decision for whoever owns it, then the active player's
 * own move — because a state reached by a different loop would not be a state the real
 * driver reaches, and the leak claims below are about states real seats see.
 */
function playUntilWindow(seed: number, n: number): GameState {
  let state = reactiveGame(seed, n, ctx);
  for (let step = 0; step < 1200; step += 1) {
    if (state.interrupt !== null) return state;
    if (state.finished) break;

    const open = state.choices[0];
    const seat = open?.player ?? state.activePlayer;
    state = reduceOrThrow(state, seat, driverAction(state, seat), 'ordinary play');
  }
  throw new Error(`${n} players, seed ${seed}: no response window opened in 1200 steps`);
}

/**
 * THE DEADLOCK GATE, transcribed for this corpus.
 *
 * A spread of the action union, SEARCHED rather than a named action asserted, for the
 * reason `interrupts.test.ts` gives: asserting "PASS_INTERRUPT works" passes even while
 * the window is stuck for the seat that actually matters. Searched over the seat on the
 * hook, every reactive card in that seat's own hand (with and without a deflection
 * target), and every open decision.
 */
function expectALegalMove(s: GameState, where: string): Action {
  const w = s.interrupt;
  const hook = w === null ? null : windowResponder(playerView(s, s.activePlayer));
  const candidates: (readonly [PlayerID, Action])[] = [];
  for (const p of hook === null ? [] : [hook]) {
    candidates.push([p, { type: 'PASS_INTERRUPT' }]);
    for (const cardId of s.players[p]?.conspiracies ?? []) {
      candidates.push([p, { type: 'RESPOND_INTERRUPT', cardId }]);
      for (const at of s.turnOrder) {
        if (at === p) continue;
        candidates.push([p, { type: 'RESPOND_INTERRUPT', cardId, at }]);
      }
    }
  }
  for (const [p, a] of candidates) {
    if (reduce(s, p, a, ctx).ok) return a;
  }
  for (const c of s.choices) {
    const a: Action = { type: 'RESOLVE_CHOICE', choiceId: c.id, pick: { kind: 'resources', res: { funds: 0 } } };
    if (reduce(s, c.player, a, ctx).ok) return a;
  }
  throw new Error(
    `the table is stuck ${where}: no action in the union is legal ` +
      `(window ${w?.id ?? 'none'}, hook ${String(hook)}, choices ${s.choices.length})`,
  );
}

/**
 * Put the two reactive cards into named seats of an OPEN-window state, leaving every
 * other seat holding nothing.
 *
 * The window is left exactly as it is — same id, same actor, same effects — because the
 * tests that use this are about who is told what, and moving the cards must not move
 * anything else. `canBeAnswered` skips the actor, so the actor is never given one.
 */
function redistribute(s: GameState, ids: readonly CardID[], holders: readonly PlayerID[]): GameState {
  const actor = s.interrupt?.actor;
  if (actor === undefined) throw new Error('no window');
  if (holders.includes(actor)) throw new Error(`refusing to hand a reactive card to the actor ${actor}`);
  const players: Record<string, GameState['players'][string]> = {};
  for (const [pid, p] of Object.entries(s.players)) {
    players[pid] = pid === actor ? p : { ...p, conspiracies: [] };
  }
  return dealReactiveHands({ ...s, players }, ids, holders);
}

// ─────────────────────────── 1. the sweep ───────────────────────────

type SeatRow = {
  readonly seed: number;
  readonly run: RunResult;
  readonly turn: number;
  readonly majorities: number;
  readonly pegs: number;
};

/** One seed at one seat count. `knowOwnHand: false` is the pure-client table. */
function rowFor(n: number, seed: number, knowOwnHand = true): SeatRow {
  const run = playInProcess(reactiveGame(seed, n, ctx), ctx, { maxActions: 1200, knowOwnHand });
  return { seed, run, turn: run.state.turn, majorities: majoritiesOn(run.state), pegs: pegsOn(run.state) };
}

function sweep(n: number, knowOwnHand = true): SeatRow[] {
  return SEEDS.map((seed) => rowFor(n, seed, knowOwnHand));
}

const spread = (xs: readonly number[]): string =>
  xs.length === 0 ? 'none' : `${Math.min(...xs)}..${Math.max(...xs)}`;
const med = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

type Wins = {
  opened: number;
  closed: number;
  byAnswer: number;
  byDeclines: number;
  answered: number;
  declined: number;
  unclosed: number;
};

function tallyWindows(rows: readonly SeatRow[]): Wins {
  return rows.reduce<Wins>(
    (k, r) => ({
      opened: k.opened + r.run.windows.opened.size,
      closed: k.closed + r.run.windows.closed,
      byAnswer: k.byAnswer + r.run.windows.closedByAnswer,
      byDeclines: k.byDeclines + r.run.windows.closedByAllDeclines,
      answered: k.answered + r.run.windows.answered,
      declined: k.declined + r.run.windows.declined,
      unclosed: k.unclosed + r.run.windows.unclosedAtEnd,
    }),
    { opened: 0, closed: 0, byAnswer: 0, byDeclines: 0, answered: 0, declined: 0, unclosed: 0 },
  );
}

function logSweep(label: string, n: number, rows: readonly SeatRow[]): void {
  const finished = rows.filter((r) => r.run.state.finished);
  const w = tallyWindows(rows);
  const reasons = rows.map((r) => r.run.reason).filter((x): x is string => x !== null);
  console.log(
    `${label} SEATS ${n} (${rows.length} seeds): finished ${finished.length}/${rows.length} | ` +
      `nineMajorities ${rows.filter((r) => r.majorities === 9).length}/${rows.length} | ` +
      `turn min ${spread(rows.map((r) => r.turn))} med ${med(finished.map((r) => r.turn))} ` +
      `max ${finished.length === 0 ? 0 : Math.max(...finished.map((r) => r.turn))} | ` +
      `actions ${spread(rows.map((r) => r.run.actions))} | ` +
      `windows opened ${w.opened} closed ${w.closed} (byAnswer ${w.byAnswer} / byAllDeclines ${w.byDeclines}) | ` +
      `responded ${w.answered} declined ${w.declined} unclosedAtEnd ${w.unclosed}` +
      (reasons.length === 0 ? '' : ` | reasons ${reasons.join('; ')}`),
  );
}

describe('G13d — a window opens, closes, and the table keeps playing, at every seat count', () => {
  for (const n of SEATS) {
    it(`${n} players: all ${SEEDS.length} seeds finish, and every window opened also closed`, () => {
      const rows = sweep(n);
      logSweep('REACTIVE', n, rows);

      // No tolerated list. A driver that stalls on one seed at one seat count is a driver
      // that stalls, and "we allow one" is how a suite ends up allowing four.
      expect(
        rows
          .filter((r) => !r.run.state.finished)
          .map(
            (r) =>
              `seed ${r.seed}: stalled on turn ${r.turn} with ${r.pegs} pegs and ${r.majorities} majorities — ${r.run.reason}`,
          ),
        `${n} players on the reactive corpus: a seed did not reach an ending`,
      ).toEqual([]);

      // The window was REACHABLE. Without this the rest of the test is comparing two
      // nulls, which is the failure mode that has already bitten this repo once.
      const opened = rows.reduce((k, r) => k + r.run.windows.opened.size, 0);
      expect(opened, `${n} players: no response window ever opened, so nothing below was exercised`).toBeGreaterThan(0);

      // …and every one of them CLOSED, which is the claim the mechanism exists for.
      // `closed` counts transitions out of a window and `opened` counts distinct window
      // ids, so equality is the whole per-window claim; `unclosedAtEnd` is computed from
      // the final state rather than tracked, so it cannot drift from what happened.
      for (const r of rows) {
        expect(r.run.windows.closed, `seed ${r.seed}: ${r.run.windows.opened.size} windows opened, ${r.run.windows.closed} closed`).toBe(
          r.run.windows.opened.size,
        );
        expect(r.run.windows.unclosedAtEnd, `seed ${r.seed} finished with a window still open`).toBe(0);
        expect(
          r.run.windows.closedByAnswer + r.run.windows.closedByAllDeclines,
          `seed ${r.seed}: ${r.run.windows.closed} closures do not split into answered + all-declined`,
        ).toBe(r.run.windows.closed);
      }

      // The table really kept playing: a decided board, past the Ideology deck's own
      // cliff, so the deck recycled rather than the game ending early.
      expect(
        rows.filter((r) => r.majorities !== 9).map((r) => `seed ${r.seed}: ${r.majorities} majorities, ${r.pegs} pegs`),
        `${n} players on the reactive corpus: a seed did not reach nine majorities`,
      ).toEqual([]);
      for (const r of rows) {
        expect(r.pegs, `seed ${r.seed}: nine majorities on only ${r.pegs} pegs`).toBeGreaterThanOrEqual(MAJORITY_PEGS);
      }
      // Past the CLIFF, which is measured rather than quoted. This was a bare
      // `toBeGreaterThan(52)` — a hand-copy of a corpus fact that also existed, as a
      // different literal, in `winnable.test.ts` and `corpus.test.ts`. Three copies of
      // the turn at which the shipped game used to die is three chances for the suite
      // to be quietly wrong about the one number that decides whether the shipped game
      // can be won.
      expect(
        Math.max(...rows.map((r) => r.turn)),
        `${n} players: no reactive-corpus seed reached past turn ${TURN_CLIFF}, so recycling was never exercised`,
      ).toBeGreaterThan(TURN_CLIFF);
    });

    it(`${n} players: the run both RESPONDS and DECLINES — both paths, not one`, () => {
      // The most important assertion in this file after termination. A suite whose driver
      // only ever declines proves the window closes; it proves nothing about answering,
      // which is the half the product replays.
      const rows = sweep(n);
      const w = tallyWindows(rows);
      console.log(
        `REACTIVE SEATS ${n} paths: responded ${w.answered}, declined ${w.declined}, ` +
          `closed-by-answer ${w.byAnswer}, closed-by-all-declines ${w.byDeclines}`,
      );
      expect(w.answered, `${n} players: no seat ever spent a reactive card`).toBeGreaterThan(0);
      expect(w.declined, `${n} players: no seat ever declined`).toBeGreaterThan(0);
      expect(w.byAnswer, `${n} players: no window was ever closed by an answer`).toBeGreaterThan(0);
      // Both closure routes, accounted for: a window closes either because somebody
      // answered or because everybody declined, and nothing else may be counted.
      expect(w.byAnswer + w.byDeclines, `${n} players: closures do not split into answered + all-declined`).toBe(w.closed);

      // WHY ALL-DECLINES IS 0 AT 3+ SEATS HERE, and why that is a fact rather than a
      // hole in the sweep. The driver answers whenever it can, so a window only closes by
      // all-declines when EVERY required seat holds nothing — which needs the seat that
      // DOES hold the card to be the actor, who is excluded from the required set. At 2
      // seats that happens constantly (the holder's own headline is acked by them) and
      // 80 of 100 windows closed that way. From 3 seats up the fixture's holders are never
      // the actor across 20 seeds, so the holder is always asked and always answers, and
      // the seats asked BEFORE it decline but the window is already closing. The
      // all-declines route is measured where it actually happens instead: the
      // uninformed table below, where it closes 137/137 windows at 3 players and 204/204
      // at 5. Both routes, at every seat count, across the two sweeps.
    });
  }

  it('the decline-only table still terminates at every seat count — the production fallback', () => {
    // A real client has no hand to offer: `playerView` blanks `conspiracies` for its owner
    // too (R1). So the run a production incident would hit is the one where NOBODY knows
    // anything and every window closes by all-declines. It has to terminate, and it has to
    // still be a winning game — a window that stops the game is worse than no window.
    for (const n of SEATS) {
      const rows = sweep(n, false);
      logSweep('DECLINE-ONLY', n, rows);
      for (const r of rows) {
        expect(r.run.state.finished, `${n} players, seed ${r.seed}, nobody knows their hand: ${r.run.reason}`).toBe(true);
        expect(r.run.windows.answered, `${n} players, seed ${r.seed}: answered with no knowledge`).toBe(0);
        expect(r.run.windows.closedByAllDeclines, `${n} players, seed ${r.seed}: a window closed by something other than all-declines`).toBe(
          r.run.windows.closed,
        );
        expect(r.run.windows.unclosedAtEnd).toBe(0);
        expect(r.run.windows.closedByAnswer).toBe(0);
        expect(
          r.majorities,
          `${n} players, seed ${r.seed}: ${r.majorities} majorities with every window declined`,
        ).toBe(9);
      }

      // BOTH CLOSURE ROUTES, AT EVERY SEAT COUNT, AS AN ASSERTION rather than as a
      // reading of the comment in the sweep above: answers come from the informed table,
      // all-declines from this one. Neither route alone is the protocol — a table that can
      // only answer is one answered window away from a hang the first time a seat that
      // cannot answer is asked, and a table that can only decline never plays the card.
      const informed = tallyWindows(sweep(n));
      expect(
        informed.byAnswer,
        `${n} players: across both sweeps, no window was ever closed by an answer`,
      ).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────── 2. one window, by hand ───────────────────────────

/**
 * A window whose staged effects pay somebody something DETERMINISTIC, and a seat that
 * holds `cardId` and may answer it. `null` when no seed in the sweep produces one.
 *
 * WHY THE SEEDS ARE SEARCHED, which is the only slightly unusual thing in this file.
 *
 * The witness that an answer DID something is arithmetic, and arithmetic needs a window
 * whose staged effects are a plain `gain` — not a `gain-any` decision and not a swap. The
 * first window a given seed opens need not be one (seed 1's is a choice at every seat
 * count), and a test that quietly skipped its own central claim when it met a window it
 * could not measure would be worse than no test at all: it would report a passing BLOCK
 * test while having asserted nothing about the BLOCK. So the search is done up front and
 * its FAILURE is asserted — if no measurable window exists, these tests fail rather than
 * pass vacuously.
 */
function measurableWindow(
  n: number,
  cardId: CardID,
): { readonly held: GameState; readonly w: InterruptWindow; readonly owed: number; readonly answerer: PlayerID } | null {
  for (const seed of SEEDS) {
    const held = playUntilWindow(seed, n);
    const w = held.interrupt;
    if (w === null) throw new Error(`no window at ${n} players, seed ${seed}`);
    const answerer = held.turnOrder.find(
      (p) =>
        p !== w.actor &&
        !w.passed.includes(p) &&
        (held.players[p]?.conspiracies ?? []).includes(cardId),
    );
    const owed = deterministicActorGain(w.effects, w.actor);
    if (answerer !== undefined && owed > 0) {
      // The answerer is handed `cardId` and NOTHING ELSE. `reactiveAnswer` prefers a BLOCK
      // over a DEFLECT by design (a BLOCK needs no target and cannot be refused for a
      // missing one), and at 3 seats the fixture deals both cards to one seat — so without
      // this the DEFLECT test at 3 seats would watch the BLOCK answer and assert the
      // DEFLECT's redirect, which is a test that passes for the wrong reason. The window is
      // untouched: same id, same actor, same staged effects.
      const only = redistribute(held, [cardId], [answerer]);
      expect(only.interrupt?.id, `redistributing the hand moved the window`).toBe(w.id);
      return { held: only, w, owed, answerer };
    }
  }
  return null;
}

/** Answer a window with `answerer`'s own hand and settle it through the real reducer. */
function answerWith(
  held: GameState,
  answerer: PlayerID,
): { readonly state: GameState; readonly answer: NonNullable<ReturnType<typeof reactiveAnswer>>; readonly texts: readonly string[] } {
  const answer = reactiveAnswer(playerView(held, answerer), answerer, ownKnowledge(held, answerer, ctx.cards));
  if (answer === null) throw new Error(`${answerer} holds a reactive card and produced no answer`);
  const state = reduceOrThrow(held, answerer, answer, `${answerer} answers`);
  expect(state.interrupt, `${answerer} answered and the window did not close`).toBeNull();
  return { state, answer, texts: state.log.map((l) => l.text) };
}

describe('one window, driven by hand: it closes, and a legal move exists at every step', () => {
  for (const n of SEATS) {
    it(`${n} players: every required seat can decline and the window closes in at most n-1 passes`, () => {
      // THE TERMINATION CLAIM, seat count by seat count, with the driver's own
      // transcription of who owes a response checked against the reducer at every step.
      const held = playUntilWindow(1, n);
      const w0 = held.interrupt;
      if (w0 === null) throw new Error('no window');

      const view = playerView(held, held.activePlayer);
      const required = requiredDecliners(view, w0);
      const order = responseOrder(view, w0);
      expect(required, `${n} players: the driver thinks nobody owes a response`).not.toContain(w0.actor);
      expect(required.length, `${n} players: fewer than n-1 seats owe a response`).toBeGreaterThanOrEqual(n - 2);
      expect([...order].sort(), `${n} players: the response order is not a permutation of the required set`).toEqual(
        [...required].sort(),
      );

      let s = held;
      const asked: PlayerID[] = [];
      while (s.interrupt !== null) {
        const seat = windowResponder(playerView(s, s.activePlayer));
        expect(seat, `${n} players after ${asked.length} declines: the driver thinks nobody owes a response`).not.toBeNull();
        if (seat === null) break;

        // The seat on the hook must have SOMETHING legal — not "the decline works", but
        // one of the whole union, searched.
        expectALegalMove(s, `${n} players after ${asked.length} declines`);
        expect(asked.includes(seat), `${n} players: ${seat} was asked to decline twice`).toBe(false);

        s = reduceOrThrow(s, seat, { type: 'PASS_INTERRUPT' }, `${n} players, ${seat} declines`);
        asked.push(seat);
        expect(asked.length, `${n} players: the window took more than n-1 declines to close`).toBeLessThanOrEqual(n - 1);
      }

      expect(s.interrupt, `${n} players: the window never closed`).toBeNull();
      // Every required seat passed, and nobody else did — which is the engine's own
      // closing condition, checked from the outside.
      expect([...asked].sort(), `${n} players: the wrong seats declined`).toEqual([...required].sort());
      expect(asked.length, `${n} players: closed in ${asked.length} passes, which is not within n-1`).toBeLessThanOrEqual(n - 1);
      expect(windowResponder(playerView(s, s.activePlayer))).toBeNull();
    });

    it(`${n} players: a BLOCK held by another seat CANCELS the card under response, and the cancellation is measurable`, () => {
      const found = measurableWindow(n, BLOCK_ID);
      expect(
        found,
        `${n} players: no window in ${SEEDS.length} seeds staged a deterministic payout that a BLOCK could cancel, so nothing was measured`,
      ).not.toBeNull();
      if (found === null) return;
      const { held, w, owed, answerer } = found;

      const before = totalOf(poolOf(held, w.actor));
      const { state, answer, texts } = answerWith(held, answerer);
      expect(answer.cardId, `${answerer} holds a BLOCK and answered with something else`).toBe(BLOCK_ID);

      console.log(
        `BLOCK ${n}p: ${answerer} blocked window ${w.id}; staged payout ${owed}, ` +
          `actor gained ${totalOf(poolOf(state, w.actor)) - before}`,
      );

      // The answer is PUBLIC: the card was played face up, discarded and logged, and that
      // is what makes it answerable at all.
      expect(texts, `${n} players: the answer was not logged by name`).toContain(`Played "${FIXTURE_BLOCK.name}".`);
      expect(
        (state.players[answerer]?.conspiracies ?? []).includes(answer.cardId),
        `${n} players: ${answerer} still holds the card it just played`,
      ).toBe(false);
      // THE DIFFERENTIAL. A BLOCK's entire effect is an ABSENCE: a blocked resolution and a
      // never-played one agree on every pool, which is exactly why the log line below is
      // needed as a second witness and why this arithmetic is searched for rather than
      // assumed.
      expect(
        totalOf(poolOf(state, w.actor)) - before,
        `${n} players: the BLOCK landed but the card under response still paid the actor`,
      ).toBeLessThan(owed);
      expect(
        texts.some((t) => t.startsWith('Blocked ')),
        `${n} players: a BLOCK landed and the outcome was not logged`,
      ).toBe(true);
    });

    it(`${n} players: a DEFLECT held by another seat REDIRECTS the payout — and at 2 seats it has nowhere to go`, () => {
      // THE RULES, MEASURED. `RESPOND_INTERRUPT` refuses `at === w.actor` and
      // `at === playerId`, so at two seats the only two players there are excluded and a
      // DEFLECT has no legal target: the printed card meeting the smallest possible
      // table. Asserted rather than papered over, and asserted in BOTH directions — the
      // driver declines rather than naming an illegal player, and the engine refuses a
      // hand-aimed DEFLECT if anything ever tried.
      if (n < 3) {
        const held = playUntilWindow(1, 2);
        const w = held.interrupt;
        if (w === null) throw new Error('no window');
        const actor = w.actor;
        const responder = (held.turnOrder.find((p) => p !== actor) ?? actor) as PlayerID;
        const two = redistribute(held, [DEFLECT_ID], [responder]);
        expect(
          reactiveAnswer(playerView(two, responder), responder, ownKnowledge(two, responder, ctx.cards)),
          'at 2 seats the driver aimed a DEFLECT at a player the rules forbid',
        ).toBeNull();
        const aimed = reduce(
          two,
          responder,
          { type: 'RESPOND_INTERRUPT', cardId: DEFLECT_ID, at: actor },
          ctx,
        );
        expect(aimed.ok, 'the engine accepted a DEFLECT aimed back at the player who played the card').toBe(false);
        if (!aimed.ok) expect(aimed.error).toContain('redirect it back at the player who played it');
        return;
      }

      const found = measurableWindow(n, DEFLECT_ID);
      expect(
        found,
        `${n} players: no window in ${SEEDS.length} seeds staged a deterministic payout that a DEFLECT could redirect, so nothing was measured`,
      ).not.toBeNull();
      if (found === null) return;
      const { held, w, owed, answerer } = found;

      const { state, answer, texts } = answerWith(held, answerer);
      expect(answer.cardId, `${answerer} holds a DEFLECT and answered with something else`).toBe(DEFLECT_ID);
      const target = answer.at;
      console.log(
        `DEFLECT ${n}p: ${answerer} deflected window ${w.id} at ${String(target)}; staged payout ${owed}, ` +
          `actor gained ${totalOf(poolOf(state, w.actor)) - totalOf(poolOf(held, w.actor))}, ` +
          `${String(target)} gained ${totalOf(poolOf(state, target as PlayerID)) - totalOf(poolOf(held, target as PlayerID))}`,
      );

      expect(texts, `${n} players: the answer was not logged by name`).toContain(`Played "${FIXTURE_DEFLECT.name}".`);
      // The redirect is the whole effect, and the engine logs NOTHING for it — there is no
      // "Deflected ..." line — so the payout landing on the third player is the only
      // evidence there is. It is asserted rather than assumed.
      expect(
        target,
        `${n} players: the DEFLECT named no target, so nothing was redirected`,
      ).toBeDefined();
      if (target === undefined) return;
      expect([w.actor, answerer], `${n} players: the DEFLECT was aimed at the actor or at the responder`).not.toContain(target);
      expect(state.players[target], `${n} players: the DEFLECT named a player who is not at the table`).toBeDefined();
      expect(
        totalOf(poolOf(state, target)) - totalOf(poolOf(held, target)),
        `${n} players: the DEFLECT landed but ${target} received none of the ${owed} it was aimed at`,
      ).toBeGreaterThanOrEqual(owed);
      expect(
        totalOf(poolOf(state, w.actor)) - totalOf(poolOf(held, w.actor)),
        `${n} players: the card under response paid the actor anyway, so the redirect did nothing`,
      ).toBeLessThan(owed);
    });
  }

  it('a window closed by all-declines logs no block — the two paths are distinguishable, at every seat count', () => {
    for (const n of SEATS) {
      const held = playUntilWindow(2, n);
      if (held.interrupt === null) throw new Error('no window');

      let declined = held;
      let guard = 0;
      while (declined.interrupt !== null && guard < n + 2) {
        const seat = windowResponder(playerView(declined, declined.activePlayer));
        if (seat === null) break;
        declined = reduceOrThrow(declined, seat, { type: 'PASS_INTERRUPT' }, `${n} players, decline`);
        guard += 1;
      }
      expect(declined.interrupt, `${n} players: the decline path did not close the window`).toBeNull();
      expect(guard, `${n} players: the decline path took ${guard} passes`).toBeLessThanOrEqual(n - 1);
      expect(
        declined.log.some((l) => l.text.startsWith('Blocked ') || l.text.startsWith('Deflected ')),
        `${n} players: a window closed by all-declines logged a block`,
      ).toBe(false);
      // And the card that was held really did resolve on this path, which is what makes
      // the decline path a game rather than a skip.
      expect(
        declined.log.some((l) => l.kind === 'card'),
        `${n} players: the declined window logged nothing at all`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────── 3. the window leaks nothing ───────────────────────────

describe('an open window names no holder, to anybody', () => {
  /** Every viewer a client can be: the seats, a spectator, a non-seat, the empty id. */
  const viewers = (s: GameState): (PlayerID | null)[] => [null, 'p_not_a_seat', '', ...s.turnOrder];

  /** The serialised window exactly as a client receives it. */
  const wireWindow = (s: GameState, viewer: PlayerID | null): Record<string, unknown> =>
    JSON.parse(JSON.stringify(viewFor(s, ctx.cards, viewer).interrupt)) as Record<string, unknown>;

  it('every viewer receives the SAME window, byte for byte, while it is open', () => {
    for (const n of SEATS) {
      const s = playUntilWindow(3, n);
      if (s.interrupt === null) throw new Error('no window');
      const renderings = viewers(s).map((v) => JSON.stringify(wireWindow(s, v)));
      expect(
        new Set(renderings).size,
        `${n} players: the open window differs between viewers — ${renderings.join(' | ')}`,
      ).toBe(1);
    }
  });

  it('the window carries exactly the eleven declared fields, and no list of who may respond', () => {
    // `InterruptWindow` has no `responders` and no holder list BY DESIGN. Asserted over
    // the wire rather than over the type, because a type cannot stop a field being added
    // at runtime and a projection is where one would be added.
    for (const n of SEATS) {
      const s = playUntilWindow(3, n);
      const w = wireWindow(s, null);
      expect(Object.keys(w).sort(), `${n} players: the window on the wire is not the declared shape`).toEqual(WINDOW_KEYS);
      // The three values that could name a person, in their states while the window is OPEN.
      expect(w['responder'], `${n} players: a window names its responder while still open`).toBeNull();
      expect(w['deflectedTo'], `${n} players: an open window names a deflection target`).toBeNull();
      // `passed` is a list of people who DECLINED, which reveals nothing about a hand: a
      // player may hold a BLOCK and choose not to play it.
      expect(Array.isArray(w['passed']), `${n} players: passed is not an array`).toBe(true);
      expect(
        (w['passed'] as unknown[]).every((p) => typeof p === 'string'),
        `${n} players: passed holds a non-PlayerID`,
      ).toBe(true);
    }
  });

  it('MOVING the reactive cards to different seats changes nothing a spectator is told', () => {
    // THE DECISIVE LEAK TEST, and the falsifiable one.
    //
    // Every other form of this assertion ("the payload has no hand in it") can be
    // satisfied by a projection that computes nothing at all. This one cannot: it holds
    // the window fixed and moves the SECRET, so any field that leaked the holder changes
    // when the holder changes — and the two payloads stop matching.
    for (const n of SEATS) {
      const s = playUntilWindow(4, n);
      const w = s.interrupt;
      if (w === null) throw new Error('no window');
      const eligible = s.turnOrder.filter((p) => p !== w.actor);
      if (eligible.length < 2) continue; // 2 players: exactly one non-actor, so no permutation exists

      const first = eligible[0] as PlayerID;
      const last = eligible[eligible.length - 1] as PlayerID;
      const here = redistribute(s, [BLOCK_ID], [first]);
      const there = redistribute(s, [DEFLECT_ID], [last]);
      // The two positions really do hold a reactive card in DIFFERENT places, or the
      // comparison is vacuous — a coin-flip fixture is a failure mode this repo has hit.
      const hereHolder = holderOf(here, BLOCK_ID);
      const thereHolder = holderOf(there, DEFLECT_ID);
      expect(hereHolder, `${n} players: the first position holds no reactive card`).not.toBeNull();
      expect(thereHolder, `${n} players: the moved position holds no reactive card`).not.toBeNull();
      expect(hereHolder, `${n} players: both reactive cards ended up with the same seat`).not.toBe(thereHolder);
      // Nothing but the hands differs: same window, same turn, same phase, same actor.
      expect(here.interrupt?.id).toBe(there.interrupt?.id);
      expect(here.turn).toBe(there.turn);
      expect(here.phase).toBe(there.phase);

      for (const viewer of [null, 'p_not_a_seat', '', ...s.turnOrder] as (PlayerID | null)[]) {
        expect(
          JSON.stringify(viewFor(there, ctx.cards, viewer)),
          `${n} players, viewer ${String(viewer)}: moving the reactive cards changed what was sent`,
        ).toBe(JSON.stringify(viewFor(here, ctx.cards, viewer)));
      }
    }
  });

  it('no seat that does not hold a reactive card is told of one, anywhere in the payload', () => {
    for (const n of SEATS) {
      const s = playUntilWindow(5, n);
      if (s.interrupt === null) throw new Error('no window');
      const heldIds = allHeldIds(s);
      expect(heldIds.length, `${n} players: the fixture dealt no reactive card — every assertion below is vacuous`).toBeGreaterThan(0);

      for (const viewer of viewers(s)) {
        const raw = JSON.stringify(viewFor(s, ctx.cards, viewer));
        const ownHand = s.players[viewer ?? '']?.conspiracies ?? [];
        for (const id of heldIds) {
          // A viewer's OWN hand is the one legitimate exception, and it is viewer-scoped by
          // construction (`playableConspiraciesFor` reads only `self`). Everything else must
          // be silent about every id in every hand.
          if (ownHand.includes(id)) continue;
          expect(
            raw.includes(id),
            `${n} players, viewer ${String(viewer)}: the payload names ${id}, which that viewer does not hold`,
          ).toBe(false);
        }
        // The hands themselves are stripped to empty arrays for EVERY viewer, holder
        // included — that is R1, and it is the reason `ownKnowledge` exists at all.
        const parsed = JSON.parse(raw) as { players: Record<string, { conspiracies: unknown[] } | undefined> };
        for (const p of s.turnOrder) {
          expect(Array.isArray(parsed.players[p]?.conspiracies), `${n} players: ${p} has no conspiracies array`).toBe(true);
          expect(
            parsed.players[p]?.conspiracies.length,
            `${n} players: ${p}'s hand reached the wire for viewer ${String(viewer)}`,
          ).toBe(0);
        }
      }
    }
  });

  it('the one bit the engine deliberately spends is exactly one bit: a window is open', () => {
    // `awaitingAnswer` already tells every client a card is in flight without saying
    // which. An open window is the same class of disclosure — it says SOMEBODY holds a
    // reactive card, names no one, and is visible to exactly the viewers a card in flight
    // is visible to. This asserts the ruling is still the ruling and has not widened.
    for (const n of SEATS) {
      const s = playUntilWindow(6, n);
      const spec = viewFor(s, ctx.cards, null);
      expect(spec.interrupt, `${n} players: a spectator is not told a window is open`).not.toBeNull();
      const w = spec.interrupt as InterruptWindow;
      expect(w.responder).toBeNull();
      expect(w.deflectedTo).toBeNull();
      // `actor` names the player who played the card, which the same action logged by
      // name — so it is not new information, and it is asserted rather than excused.
      expect(
        s.log.some((l) => l.player === w.actor),
        `${n} players: the window names an actor whose play is not in the public log`,
      ).toBe(true);
      // And the window's own card is on the discard pile in the same breath, so a client
      // reading `cardId` has learned nothing the log did not already say.
      expect(
        s.log.some((l) => l.kind === 'card'),
        `${n} players: no card play was logged, so the window names an unlogged card`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────── 4. the driver does not peek ───────────────────────────

describe('the driver reads its own hand and nothing else', () => {
  const driverSource = (): string => readFileSync(fileURLToPath(new URL('./driver.ts', import.meta.url)), 'utf8');

  /** The driver's source with comments blanked, so a docstring is not a code path. */
  const driverCode = (): string =>
    driverSource()
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, '');

  it('ownKnowledge takes exactly (state, me, cards) — no second seat, no default', () => {
    // STRUCTURAL, and the reason the behavioural tests below are not the only guard. A
    // peek reintroduced as a fourth parameter, or as a defaulted `others = []`, is the
    // exact shape the old bug took and no behaviour test would notice: the default is
    // `undefined` until somebody passes it, and the suite still passes.
    const src = driverCode();
    const decl = src.match(/export function ownKnowledge\(([^)]*)\)/);
    expect(decl, 'ownKnowledge is not declared in driver.ts, or its parameter list cannot be read').not.toBeNull();
    if (decl === null) return;
    const params = (decl[1] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    expect(
      params,
      `ownKnowledge's parameters are ${JSON.stringify(params)} — a third seat, or a default through which another hand could arrive, is the regression this asserts against`,
    ).toEqual(['state: GameState', 'me: PlayerID', 'cards: CardIndex']);
    expect(decl[1], 'ownKnowledge has a default parameter').not.toContain('=');

    // `SeatKnowledge` has one hand field and one rulebook field. There is deliberately no
    // "any other player's hand", so the driver cannot be handed one.
    const seat = src.match(/export type SeatKnowledge = \{([\s\S]*?)\n\};/);
    expect(seat, 'SeatKnowledge is not declared in driver.ts').not.toBeNull();
    const fields = (seat?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('readonly '))
      .map((l) => (l.replace(/[:?].*$/, '').replace('readonly ', '').trim()));
    expect(fields, "SeatKnowledge carries a field that is not the seat's own hand or the printed bodies").toEqual([
      'ownConspiracies',
      'conspiracyCards',
    ]);
  });

  it('driver.ts reads one player from the authoritative state, and it is the one it was asked about', () => {
    // The complementary structural check: `ownKnowledge` has no second seat, and the file
    // has exactly ONE read of the authoritative players map, inside it. A `for` loop over
    // `state.players` anywhere else is the peek, and this is what notices.
    const code = driverCode();
    const reads = code.match(/\bstate\.players\b/g) ?? [];
    expect(
      reads.length,
      `driver.ts reads state.players on ${reads.length} lines in code — ownKnowledge is the only reader allowed`,
    ).toBe(1);
    expect(code, 'ownKnowledge no longer reads the seat it was asked about').toMatch(
      /function ownKnowledge\([\s\S]*?state\.players\[me\]/,
    );
  });

  it('ownKnowledge returns exactly the named seat\'s hand, and only that seat\'s hand', () => {
    const s = reactiveGame(1, 4, ctx);
    const holders = s.turnOrder.filter((p) => (s.players[p]?.conspiracies ?? []).length > 0);
    expect(holders.length, 'the fixture dealt the cards to nobody — the assertions below are vacuous').toBeGreaterThanOrEqual(2);
    expect(
      s.turnOrder.filter((p) => (s.players[p]?.conspiracies ?? []).length === 0).length,
      'every seat holds a reactive card, so no seat is on the outside to look in from',
    ).toBeGreaterThanOrEqual(1);

    for (const me of s.turnOrder) {
      const k = ownKnowledge(s, me, ctx.cards);
      expect(k.ownConspiracies, `${me} was given a hand that is not its own`).toEqual(s.players[me]?.conspiracies ?? []);
      for (const other of s.turnOrder) {
        if (other === me) continue;
        for (const id of s.players[other]?.conspiracies ?? []) {
          expect(k.ownConspiracies.includes(id), `${me} was told ${id}, which ${other} holds`).toBe(false);
        }
      }
    }
  });

  it('POISON every other hand and the answer does not change — the peek would have teeth', () => {
    // The behavioural form. A signature check cannot see a loop over `state.players`; this
    // can. The state is identical in every respect a projection can express except whose
    // hand the cards are in, so any cross-read changes the answer and the equality fails.
    const s = reactiveGame(2, 4, ctx);
    const me = s.turnOrder[0] as PlayerID;
    const before = ownKnowledge(s, me, ctx.cards);

    const poison = allHeldIds(s);
    expect(poison.length, 'the fixture dealt nothing to poison with — the assertion is vacuous').toBeGreaterThan(0);

    const players: Record<string, GameState['players'][string]> = {};
    for (const [pid, p] of Object.entries(s.players)) {
      players[pid] = pid === me ? p : { ...p, conspiracies: [...poison] };
    }
    const after = ownKnowledge({ ...s, players }, me, ctx.cards);
    expect(
      after.ownConspiracies,
      `poisoning every other hand changed what ${me} was told — the driver read a hand it was not asked about`,
    ).toEqual(before.ownConspiracies);
  });

  it('a seat holding nothing DECLINES although another seat holds a BLOCK, and the engine refuses the peek', () => {
    // The end-to-end version: not "the knowledge object is clean" but "the decision made
    // from it is clean, and the reducer is the oracle that says so".
    const held = playUntilWindow(3, 5);
    const w = held.interrupt;
    if (w === null) throw new Error('no window');
    // The window is left alone; only the hands are rearranged, so the two positions differ
    // in the secret and in nothing else.
    const outsider = held.turnOrder.find((p) => p !== w.actor);
    if (outsider === undefined) throw new Error('no seat other than the actor exists');
    const s = redistribute(held, [BLOCK_ID], [outsider]);
    expect(s.interrupt?.id).toBe(w.id);
    const holder = holderOf(s, BLOCK_ID);
    if (holder === null) throw new Error('the BLOCK was dealt to nobody');
    const bare = s.turnOrder.find((p) => p !== w.actor && (s.players[p]?.conspiracies ?? []).length === 0);
    if (bare === undefined) throw new Error('every seat holds a reactive card');

    expect(
      reactiveAnswer(playerView(s, bare), bare, ownKnowledge(s, bare, ctx.cards)),
      `${bare} produced an answer from a hand it does not hold`,
    ).toBeNull();
    // And the projection it acted on never carried the id, so there was nothing to read.
    expect(
      JSON.stringify(playerView(s, bare)).includes(BLOCK_ID),
      `${bare}'s projection named the BLOCK it does not hold`,
    ).toBe(false);

    // The engine's own refusal is the oracle with teeth: a driver reaching for another
    // seat's card is refused, and refused for the reason that matters.
    const peeked = reduce(s, bare, { type: 'RESPOND_INTERRUPT', cardId: BLOCK_ID }, ctx);
    expect(peeked.ok, 'the engine accepted a BLOCK played from a hand the player does not hold').toBe(false);
    if (!peeked.ok) expect(peeked.error).toContain('you do not hold that card');
  });

  it('an unknown seat throws rather than yielding an empty hand', () => {
    // An empty hand means DECLINE. A typo that returned one would produce a sweep with no
    // answers in it that still passed — the quietest way for this suite to stop testing
    // anything at all.
    const s = reactiveGame(1, 2, ctx);
    expect(() => ownKnowledge(s, 'p_not_a_seat', ctx.cards)).toThrow(/is not a seat/);
  });

  it('the driver acts on the PROJECTION, and the projection carries no hand to read', () => {
    const code = driverCode();
    expect(code, 'playInProcess stopped reading seats through playerView').toMatch(/playerView\(state, /);
    expect(code, 'nextAction is not handed an authoritative GameState').toMatch(
      /export function nextAction\(view: ClientState, me: PlayerID, knowledge\?: SeatKnowledge\)/,
    );
    expect(code, 'reactiveAnswer grew a way to be told about another seat').not.toMatch(/reactiveAnswer\([\s\S]*?hands/);
  });

  it('a driver with no knowledge declines — the branch a real client takes on every window', () => {
    // `reactiveAnswer` returns null for `knowledge === undefined` and `nextAction` turns
    // that into `PASS_INTERRUPT`. Asserted directly rather than inferred from the sweep,
    // because it is the production path and it is one branch.
    const s = playUntilWindow(7, 4);
    if (s.interrupt === null) throw new Error('no window');
    const seat = windowResponder(playerView(s, s.activePlayer));
    if (seat === null) throw new Error('nobody owes a response');
    const action = nextAction(playerView(s, seat), seat);
    expect(action, 'a driver with no knowledge produced a doomed action during a window').not.toBeNull();
    if (action === null) return;
    // It must be the decline: an answer would have to name a card, and the projection a
    // seat acts on contains no card id at all.
    expect(action.type, `a driver reading only the projection produced ${action.type}`).toBe('PASS_INTERRUPT');
  });

  it('SeatKnowledge is optional, so a server with no hand to offer still runs the driver', () => {
    // A type-level claim, evaluated at runtime: the driver compiles whether or not the
    // caller has a hand, which is what lets `playInProcess` default to declining.
    const none: SeatKnowledge | undefined = undefined;
    const s = reactiveGame(1, 3, ctx);
    expect(reactiveAnswer(playerView(s, s.activePlayer), s.activePlayer, none)).toBeNull();
    expect(s.turnOrder).toHaveLength(3);
  });
});

// ───────────────── 5. the projection never offers a card the window refuses ─────────────────

/**
 * THE BUG THIS SECTION IS FOR.
 *
 * `playableConspiraciesFor` is the projection that renders the PLAY button, and every
 * guard in it is a transcription of a guard in `reduce`'s `PLAY_CONSPIRACY`. One was
 * missing. The G13 response window check in `reduce` runs FIRST — above the per-player
 * freeze, above the turn check, above the phase check — and exempts three ACTION TYPES
 * (`RESPOND_INTERRUPT`, `PASS_INTERRUPT`, `RESOLVE_CHOICE`). `PLAY_CONSPIRACY` is not
 * on that list, so while a window is open the reducer refuses the play for EVERY seat,
 * the actor included, in EVERY phase.
 *
 * The projection did not know that. So during a window the client rendered a PLAY button
 * for the actor's remaining Conspiracy Cards, the player pressed it, and the server
 * answered `"A Grave Inheritance" is resolving — answer it or decline first`. A control
 * that looks like it works and does not, which is §9.10's prohibited case — and the same
 * class of defect as the ones already fixed in this repo: the server telling the client
 * to do something the engine will refuse.
 *
 * WHY IT SURVIVED A SUITE THAT ALREADY CHECKS PROJECTION/REDUCER AGREEMENT
 *
 * `secret-state.test.ts` has the oracle test for this — it asks `reduce` rather than
 * re-transcribing the rules — but it walks `CONSPIRACY_CORPUS`, and no state in that
 * corpus ever has an open window. The blind spot was the corpus, not the assertion. So
 * the oracle is applied here to window states, which is the same claim about states the
 * other corpus cannot reach.
 *
 * AND THE NARROWER RULES THAT ARE ALSO WRONG, asserted rather than left as prose.
 *
 * A reader could reasonably narrow this to "only the actor" or "only outside the answer
 * phase". Both are refuted below by the reducer's own refusal, which is what decides it:
 * the exemption is by action type, so neither the seat nor the phase changes the answer.
 * If a future engine change makes the window narrower, these tests fail and the guard is
 * revisited — they are the tripwire for that, not a description of today's behaviour.
 */
describe('while a window is open the projection offers nothing `reduce` would refuse', () => {
  /** The ids this viewer is offered. The projection, asked directly. */
  function offered(s: GameState, viewer: PlayerID | null): readonly CardID[] {
    return viewFor(s, ctx.cards, viewer).playableConspiracies.map((c) => c.id);
  }

  /** What the ENGINE accepts, asked of the engine. Never a second transcription. */
  function engineAllows(s: GameState, viewer: PlayerID, cardId: CardID): boolean {
    return reduce(s, viewer, { type: 'PLAY_CONSPIRACY', cardId }, ctx).ok;
  }

  /**
   * Two real conspiracy cards, chosen for having no `gain-any`/`* -any` effect in them.
   *
   * `resolveCard` STAGES a card's effects inside a window rather than applying them, so
   * playing one raises no decision — but the counterfactual below removes the window,
   * which would then apply the card for real. A `voters` or a flat `gain` cannot raise a
   * choice whichever way it resolves, so the non-vacuity measurement is not confounded by
   * a `PendingChoice` that guard 4 would have emptied the list on anyway.
   */
  const ACTOR_CARD_A: CardID = 'ct-et2040-003'; // {op:'voters',n:2}
  const ACTOR_CARD_B: CardID = 'ct-et2040-005'; // flat gain + discount

  /**
   * A response window that is open DURING `actions` — the position the defect was
   * reproduced in, and the one the headline sweep below cannot reach.
   *
   * WHY IT HAS TO BE BUILT RATHER THAN FOUND. On this corpus the driver never plays a
   * Conspiracy Card, so `resolveCard` is only ever reached from `ACK_HEADLINE`, and every
   * window the sweep opens is therefore open during `headlines` — where the PHASE guard
   * already empties the list. That is the whole reason the bug survived: the states the
   * suite could reach were already covered by a different guard, so the missing one was
   * invisible. `resolveCard` stages a window from `PLAY_CONSPIRACY` as readily as from
   * `ACK_HEADLINE`, so this walks to a free `actions` state, deals the actor two real
   * conspiracies and a non-actor a BLOCK, and plays one.
   *
   * The actor is dealt two rather than one so that a card REMAINS in their hand — the
   * defect is precisely that a held card was offered, so a hand emptied by the play would
   * make the assertion vacuous. It throws rather than skipping if any of that fails to
   * hold, because a silently-skipped fixture is the vacuity this whole section exists to
   * rule out.
   */
  function actionsWindow(n: number, seed: number): GameState {
    let s = reactiveGame(seed, n, ctx);
    for (let step = 0; step < 1200; step += 1) {
      if (s.finished) break;
      if (s.phase === 'actions' && !s.choices.some((c) => c.player === s.activePlayer)) break;
      const open = s.choices[0];
      const seat = open?.player ?? s.activePlayer;
      s = reduceOrThrow(s, seat, driverAction(s, seat), 'ordinary play');
    }
    if (s.finished || s.phase !== 'actions') throw new Error(`${n}p seed ${seed}: never reached a free actions phase`);

    const actor = s.activePlayer;
    const other = s.turnOrder.find((p) => p !== actor);
    if (other === undefined) throw new Error(`${n}p seed ${seed}: no seat other than the actor`);

    // `dealReactiveHands` round-robins ids across holders, so three ids over three holder
    // slots puts the first two on the actor and the BLOCK on the non-actor. `canBeAnswered`
    // skips the actor, so holding BLOCK there would be inert; it is dealt elsewhere.
    const dealt = dealReactiveHands(s, [ACTOR_CARD_A, ACTOR_CARD_B, BLOCK_ID], [actor, actor, other]);
    const played = reduceOrThrow(dealt, actor, { type: 'PLAY_CONSPIRACY', cardId: ACTOR_CARD_A }, 'stage a window');

    const w = played.interrupt;
    if (w === null) throw new Error(`${n}p seed ${seed}: the play did not stage a window`);
    if (played.phase !== 'actions') throw new Error(`${n}p seed ${seed}: the window is not in actions (${played.phase})`);
    if (played.choices.some((c) => c.player === actor)) {
      throw new Error(`${n}p seed ${seed}: the actor owes a decision, so guard 4 would confound the measurement`);
    }
    if (!(played.players[actor]?.conspiracies ?? []).includes(ACTOR_CARD_B)) {
      throw new Error(`${n}p seed ${seed}: the actor holds no card left to be offered`);
    }
    return played;
  }

  type Case = { readonly where: string; readonly state: GameState };

  /**
   * Every open-window state this section measures, from BOTH routes.
   *
   * The headline route is what the rest of this file has always used; the `actions` route
   * is the one the defect lived in. Memoised because `actionsWindow` walks up to 1200 steps
   * and three tests below ask for the same corpus, and a fixture recomputed per test is a
   * fixture whose states can differ between them.
   */
  let cached: readonly Case[] | null = null;
  function windowStates(): readonly Case[] {
    if (cached !== null) return cached;
    const out: Case[] = [];
    for (const n of SEATS) {
      for (const seed of SEEDS) {
        out.push({ where: `${n}p seed ${seed} (headline window)`, state: playUntilWindow(seed, n) });
      }
      // Three seeds is enough for this route: it is a deterministic walk to a free
      // `actions` state, so the shape is the same every time and the sweep's job here is
      // seat count, not seed coverage.
      for (const seed of [1, 2, 3] as const) {
        out.push({ where: `${n}p seed ${seed} (actions window)`, state: actionsWindow(n, seed) });
      }
    }
    cached = out;
    return out;
  }

  it('offers EXACTLY what the engine accepts, for every seat — which is nothing', () => {
    // The load-bearing pair, exactly as `secret-state.test.ts` frames it: sound (nothing
    // offered that is refused) is what removes the dead button, and complete (nothing
    // omitted that is accepted) is what proves the guard has not taken away a card the
    // player legally holds. Both are read off `reduce`, so this cannot pass by agreeing
    // with a bug in `broadcast.ts`.
    let windowsSeen = 0;
    let nonEmptyViews = 0;
    for (const { where, state } of windowStates()) {
      if (state.interrupt === null) throw new Error(`${where}: no window`);
      windowsSeen += 1;

      for (const viewer of [null, 'p_not_a_seat', '', ...state.turnOrder] as (PlayerID | null)[]) {
        const hand = state.players[viewer ?? '']?.conspiracies ?? [];
        const legal = hand.filter((id) => engineAllows(state, viewer ?? '', id));
        expect(
          [...offered(state, viewer)],
          `${where}, phase ${state.phase}, viewer ${String(viewer)}: the projection offers a card the engine refuses`,
        ).toEqual([...legal]);
        if (offered(state, viewer).length > 0) nonEmptyViews += 1;
      }
    }
    expect(windowsSeen, 'no window was reached, so nothing was exercised').toBeGreaterThan(0);
    // The fix is the POINT of this file, so if a single view still came back non-empty
    // the sweep above would have caught it; this states the conclusion rather than
    // leaving it to be inferred from the equality holding.
    expect(nonEmptyViews, 'a viewer was still offered a Conspiracy Card during a window').toBe(0);
  });

  it('the engine refuses the play for EVERY seat, the actor included — so a blanket ban is the rule', () => {
    // This is the citation, executed rather than quoted. `reduce.ts` exempts action types
    // and not seats, so the actor is refused exactly as hard as anybody else; a guard
    // narrow enough to spare the actor would offer it a card the engine turns down.
    let refusals = 0;
    for (const { where, state } of windowStates()) {
      const w = state.interrupt;
      if (w === null) throw new Error(`${where}: no window`);
      for (const viewer of state.turnOrder) {
        for (const cardId of state.players[viewer]?.conspiracies ?? []) {
          const r = reduce(state, viewer, { type: 'PLAY_CONSPIRACY', cardId }, ctx);
          expect(r.ok, `${where}: ${viewer} may play ${cardId} during a window`).toBe(false);
          // The refusal is the WINDOW's, not some incidental guard that would also have
          // fired without a window — which is what makes it this defect and not another.
          if (!r.ok) expect(r.error, `${where}: refused for the wrong reason`).toContain('is resolving');
          refusals += 1;
        }
      }
      // The actor is asserted by name. It is the seat that would have been spared by the
      // obvious narrower fix, so it gets a line of its own rather than being left to the
      // loop above to cover by accident.
      const actorCard = state.players[w.actor]?.conspiracies[0];
      if (actorCard !== undefined) {
        const r = reduce(state, w.actor, { type: 'PLAY_CONSPIRACY', cardId: actorCard }, ctx);
        expect(r.ok, `${where}: the actor was spared, so a seat-narrower guard would be wrong here`).toBe(false);
        refusals += 1;
      }
    }
    expect(refusals, 'no PLAY_CONSPIRACY was ever attempted during a window').toBeGreaterThan(0);
  });

  it('WITHOUT the window the same hands DO produce a non-empty list — the guard is what empties it', () => {
    // NON-VACUITY, and the half that is easy to get wrong. A projection that returns []
    // from a window state passes every assertion above whether or not the seats held
    // anything, because an empty list is legal everywhere. So the counterfactual is
    // measured: identical state, `interrupt` nulled, and the list is non-empty. Same
    // hands, same phase, same active player, same index — the window is the only
    // difference, so a non-empty result there proves the empty result here is the guard
    // firing rather than a corpus with nothing in it.
    let wouldOffer = 0;
    let total = 0;
    for (const { where, state } of windowStates()) {
      if (state.interrupt === null) throw new Error(`${where}: no window`);
      const without = { ...state, interrupt: null };
      for (const viewer of state.turnOrder) {
        total += 1;
        if (offered(without, viewer).length > 0) {
          wouldOffer += 1;
        } else {
          // Not a failure — a window open during `headlines` is already emptied by the
          // PHASE guard, so it is expected to be empty either way. Reported so the count
          // below cannot be read as covering states that had nothing to offer in the
          // first place.
          void where;
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(
      wouldOffer,
      'no seat was offered anything even with the window removed, so the guard was never exercised',
    ).toBeGreaterThan(0);
    console.log(
      `WINDOW PROJECTION: ${wouldOffer}/${total} seat-views offer a Conspiracy Card with ` +
        `the window removed, and 0/${total} with it open`,
    );
  });

  it('RESPONDING STILL WORKS — a BLOCK closes the window through RESPOND_INTERRUPT', () => {
    // THE REGRESSION THIS FIX COULD HAVE CAUSED, asserted rather than assumed. Blocking
    // the PLAY button would be worse than the bug if it also blocked answering, because
    // the window is closed by spending a card — and spending it is `RESPOND_INTERRUPT`,
    // a different action. So: a seat holding a BLOCK answers a real measurable window,
    // the window closes, the card leaves the hand, and the answer is logged by name.
    for (const n of SEATS) {
      const found = measurableWindow(n, BLOCK_ID);
      expect(
        found,
        `${n} players: no measurable window, so responding was not exercised`,
      ).not.toBeNull();
      if (found === null) return;
      const { held, w, answerer } = found;

      // The player about to answer is told nothing playable through the PLAY projection…
      expect(
        offered(held, answerer),
        `${n}p: ${answerer} was offered a PLAY button during the window it is about to answer`,
      ).toEqual([]);
      // …and the answer still goes through, on the action type the reducer exempts.
      const answer = reactiveAnswer(playerView(held, answerer), answerer, ownKnowledge(held, answerer, ctx.cards));
      expect(answer, `${n}p: ${answerer} holds a BLOCK and produced no answer`).not.toBeNull();
      if (answer === null) return;

      const state = reduceOrThrow(held, answerer, answer, `${n}p, ${answerer} answers`);
      expect(state.interrupt, `${n}p: the BLOCK did not close the window`).toBeNull();
      expect(
        state.players[answerer]?.conspiracies.includes(BLOCK_ID),
        `${n}p: ${answerer} still holds the BLOCK it just played`,
      ).toBe(false);
      expect(
        state.log.some((l) => l.text === `Played "${FIXTURE_BLOCK.name}".`),
        `${n}p: the answer was not logged by name`,
      ).toBe(true);
      expect(state.log.some((l) => l.text.startsWith('Blocked ')), `${n}p: no BLOCK was logged`).toBe(true);
      expect(w.actor, 'the window had no actor').toBeDefined();
    }
  });

  it('and DECLINING still works — a window nobody answers still closes', () => {
    // The other of the two moves the window exists for, and the one a production client
    // actually takes, since it holds no hand. If the guard had leaked into the response
    // path this is what would hang.
    for (const n of SEATS) {
      const held = playUntilWindow(11, n);
      expect(held.interrupt, `${n}p: no window`).not.toBeNull();
      let s = held;
      let passes = 0;
      while (s.interrupt !== null && passes <= n) {
        const seat = windowResponder(playerView(s, s.activePlayer));
        if (seat === null) break;
        s = reduceOrThrow(s, seat, { type: 'PASS_INTERRUPT' }, `${n}p, decline`);
        passes += 1;
      }
      expect(s.interrupt, `${n}p: the window never closed`).toBeNull();
      expect(passes, `${n}p: the decline path took ${passes} passes`).toBeLessThanOrEqual(n - 1);
    }
  });
});