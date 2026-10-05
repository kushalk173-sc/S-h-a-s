/**
 * NO SEAT EVER HAS NO LEGAL ACTION — and a probe that can prove it when one does.
 *
 * ## WHY A SCRIPTED SWEEP IS NOT ENOUGH, and this is the measurement
 *
 * Every game-completion sweep in this package drives `playInProcess` from
 * `test/driver.ts`, and `playInProcess` is a competent player. That is the problem,
 * not the reassurance. A driver that always finds a legal move is a driver that CANNOT
 * FIND A SOFT-LOCK: `nextAction` ends in an unconditional `{ type: 'END_TURN' }`, and
 * `reduce`'s own comment states the engine's guarantee in the same words — *"A table
 * always has a legal move — the active player can always answer their Ideology Card or
 * end their turn."* So a sweep of scripted games tests the claim on the driver's
 * itinerary. A soft-lock is a state the driver's policy never visits, so it is invisible
 * to every sweep that only runs the driver's policy. It became visible once, in a prior
 * measurement, only when the driver was randomized away from its own choices.
 *
 * The second thing this file exists for is a hazard that DID ship. A `reveal` op
 * permanently deleted cards; one seed went from finishing inside the action budget to
 * still running at turn 3975, and the only reason anybody noticed is that a corpus test
 * happened to walk that seed. That is not a guard, that is luck. This file is the guard:
 * a permanent sweep whose verdict is about the RULES rather than about the driver.
 *
 * ## THE PROBE, AND WHY IT IS OMNISCIENT
 *
 * At every decision point, for the seat the table is waiting on, the probe builds a
 * candidate action set and asks `reduce` — the rules engine, the only authority on
 * legality — whether ANY candidate is legal. Legality is therefore never inferred from
 * the driver, and the candidate set is generated from AUTHORITATIVE `GameState`,
 * including `state.players[seat].conspiracies`. The driver reads `playerView`, and
 * `PRIVATE_PLAYER_KEYS` strips that field for every viewer including the owner, so the
 * driver is structurally incapable of naming a BLOCK. The probe can.
 *
 * The probe's candidate list puts the driver's own action FIRST. That is not deference:
 * when the reducer accepts it, the reducer has just proven a legal action existed, and
 * the sweep therefore costs the same number of reducer calls a plain sweep costs while
 * still answering the question at every single decision point. Anything after the first
 * is the omniscient net — the moves no client is told about.
 *
 * ## THE FALSE POSITIVE THIS FILE IS NOT GOING TO REPEAT
 *
 * A previous attempt at this prober reported a hard freeze at turn 337 that did not
 * exist. The cause: it did not wire in `pickForChoice`. `lose-any` for N resources is
 * answered by a `Delta` that totals EXACTLY N and is affordable, and the naive pick —
 * `{ kind: 'resources', res: {} }`, which is what the old synthetic driver used to
 * answer everything — totals 0, so `reduce` refuses it. The prober read "no candidate
 * was accepted" as "no action is legal" and blamed the rules.
 *
 * So the answer logic here is the engine's own: `pickForChoice` from `test/driver.ts`,
 * which handles every `Choice` kind `applyEffect` can raise, and which is what
 * `nextAction` itself uses. It is never reimplemented. `structuralPicks` below is a NET
 * underneath it, not a replacement for it, it is capped, and every candidate it
 * contributes is put through `reduce` anyway — so the worst a stale net can do is fail to
 * find an answer that exists, which is reported as class (b) and never as a lock.
 *
 * ## THE FOUR CLASSES, KEPT APART, because they are four different bugs
 *
 *   (a) REAL SOFT-LOCK          — no seat has any legal action. The rules are wrong.
 *   (b) DRIVER LIMITATION       — the driver had no action, or its action was refused,
 *                                  but a legal action existed. The driver is wrong.
 *   (c) DRIVER/ENGINE DISAGREE  — the driver emitted an action `reduce` refused. Both
 *                                  are "right" in isolation and the table is still stuck.
 *   (d) RUN-DOWN                — a legal action always existed and no ending was
 *                                  reached inside the action budget. A livelock, not a
 *                                  lock: it is a policy problem, not a rules problem.
 *
 * Only (a) and (c) are asserted. (b) and (d) are printed, because a gate that is false on
 * day one teaches a team to build a tolerated list, and a tolerated list is how the
 * `reveal` bug got shipped in the first place.
 *
 * ## THE ACTION BUDGET IS THE ONE THE OTHER SWEEPS USE
 *
 * `ACTION_BUDGET` is `playInProcess`'s own default and the value every shipped-corpus
 * sweep passes explicitly (`test/winnable.test.ts`, `test/corpus.test.ts`,
 * `test/endgame-scoreboard.test.ts`, `test/interrupt-window.test.ts`). It is not tuned
 * here, because a completion number from this file and a completion number from
 * `winnable.test.ts` have to be comparable or neither of them means anything.
 *
 * ## WHAT IS ASSERTED IS A MECHANISM, NEVER A CARD COUNT
 *
 * No deck size, no op count, no card count is written down here. `test/corpus-drift.ts`
 * enforces that across this directory and this file adds nothing to its ALLOWED list.
 */

import { describe, expect, it } from 'vitest';

import {
  playerView,
  reduce,
  RESOURCES,
  type Action,
  type ChoicePick,
  type ClientState,
  type Ctx,
  type Delta,
  type GameState,
  type PendingChoice,
  type PlayerID,
  type Resource,
} from '@shasn/engine';

import { loadCtx } from '../src/index.ts';
import {
  freshShippedCorpus,
  nextAction,
  ownKnowledge,
  pickForChoice,
  purchasePrice,
  shouldSqueeze,
  windowResponder,
} from './driver.ts';

const ctx: Ctx = loadCtx();

/**
 * `playInProcess`'s own default, and the value every shipped-corpus sweep passes.
 * See the header: matching it is what makes the completion numbers comparable.
 */
const ACTION_BUDGET = 1200;

const SEAT_COUNTS = [2, 3, 4, 5] as const;

/**
 * A range, not a pick.
 *
 * Wider than `winnable.test.ts`'s 20, and sized against the measurement this file has to
 * be comparable with: seeds at four seat counts lands in the same order of magnitude as
 * the prior sweep whose two budget-hitting seeds are what this file refuses to gate on.
 * Rare shapes need volume - one in a thousand is not a rate anybody would see in eighty -
 * and the cost is bounded because the probe answers the reducer exactly once per decision
 * point on the happy path, so a whole seat count's sweep is seconds rather than minutes
 * against a twenty-second per-test timeout.
 */
const SEEDS: readonly number[] = Array.from({ length: 250 }, (_, i) => i + 1);

/**
 * A ceiling on the *net* candidates generated for one frozen seat, so a pathological
 * board cannot turn a probe into an enumeration. Hitting it is reported (`capped`) and
 * never silently swallowed: a net that ran out of candidates has NOT proved a lock, and
 * `probeState` says so.
 */
const NET_CAP = 400;

// ─────────────────────────── the four classes ───────────────────────────

type Classes = {
  /** (a) no seat has any legal action. Must be zero. */
  readonly softLocks: number;
  /** (b) the driver had nothing / was refused, and a legal action existed. */
  readonly driverLimitations: number;
  /** (c) the driver emitted an action `reduce` refused. Must be zero. */
  readonly disagreements: number;
  /** (d) no ending inside the action budget, with a legal action always available. */
  readonly runDowns: number;
};

/** The mutable accumulator a run fills in; `Classes` is the readonly snapshot. */
type Tally = { softLocks: number; driverLimitations: number; disagreements: number; runDowns: number };

function emptyTally(): Tally {
  return { softLocks: 0, driverLimitations: 0, disagreements: 0, runDowns: 0 };
}

// ─────────────────────────── the probe ───────────────────────────

type Move = { readonly seat: PlayerID; readonly action: Action };

/** The driver at one decision point: which arm, which seat, and what it wanted. */
type Policy = {
  readonly arm: 'choice' | 'window' | 'turn';
  readonly seat: PlayerID | null;
  readonly action: Action | null;
  /** `nextAction` THROWS rather than returning null for a seat that is on move. */
  readonly threw: string | null;
};

type Step = {
  readonly policy: Policy;
  /** An action `reduce` accepted, with the seat that owns it. Null means class (a). */
  readonly witness: Move | null;
  readonly next: GameState | null;
  /** The reducer's own answer to the driver's action, asked separately and always. */
  readonly driverRefusal: string | null;
  /** Candidates generated beyond the driver's own action. */
  readonly netCandidates: number;
  /** True when the net ran out of candidates, which weakens the lock verdict. */
  readonly capped: boolean;
};

/**
 * `nextAction` without the throw.
 *
 * The driver throws when a seat that IS on move produces no action, which is a driver
 * bug the callers want loud. The probe wants it loud too — but as class (b), a count,
 * rather than as an exception that ends the sweep and hides the classes after it.
 */
function safeNextAction(view: ClientState, seat: PlayerID, knowledge?: Parameters<typeof nextAction>[2]): Action | null {
  try {
    return nextAction(view, seat, knowledge);
  } catch (e) {
    return null;
  }
}

function safePickForChoice(view: ClientState, choice: PendingChoice): ChoicePick | null {
  try {
    return pickForChoice(view, choice);
  } catch {
    return null;
  }
}

/** `playInProcess`'s dispatch, in its order: open decision, then window, then the turn. */
function policyOf(state: GameState): Policy {
  const open = state.choices[0];
  if (open !== undefined) {
    const view = playerView(state, open.player);
    let action: Action | null = null;
    let threw: string | null = null;
    try {
      action = nextAction(view, open.player);
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    return { arm: 'choice', seat: open.player, action, threw };
  }

  const window = state.interrupt;
  if (window !== null) {
    const seat = windowResponder(playerView(state, state.activePlayer));
    if (seat === null) return { arm: 'window', seat: null, action: null, threw: null };
    return {
      arm: 'window',
      seat,
      action: safeNextAction(playerView(state, seat), seat, ownKnowledge(state, seat, ctx.cards)),
      threw: null,
    };
  }

  const seat = state.activePlayer;
  const view = playerView(state, seat);
  return { arm: 'turn', seat, action: turnMove(view, seat), threw: null };
}

/**
 * The turn arm, including the endgame squeeze, because `playInProcess` includes it and a
 * sweep that dropped it would walk a different trajectory and report a different
 * completion rate under the same name. `shouldSqueeze` and `purchasePrice` are the
 * driver's own exported helpers, so this is a re-ordering of the driver's decision rather
 * than a second policy.
 *
 * The squeeze BUYS only. `playInProcess` follows a purchase with a `PLACE_VOTERS` for the
 * group it just bought, and the socket drivers do not — they let the next ply's
 * `nextAction` place it. This is the socket path, and it is the same placement:
 * `nextAction`'s `pending[0]` arm asks `targetZone` and falls back to `fillZone` under
 * `nineMajoritiesReachable`, which is what `placeSqueezed` does. The squeeze cannot fire
 * with a group already pending, because the placement arm runs first and places it. So the
 * game evolves identically; only the ply on which it happens differs.
 */
function turnMove(view: ClientState, seat: PlayerID): Action | null {
  if (view.phase === 'actions' && shouldSqueeze(view, seat)) {
    const pool = view.players[seat]?.resources;
    if (pool !== undefined) {
      const affordable = view.market
        .map((slot, i) => ({ slot, i }))
        .filter(({ slot }) => {
          const price = purchasePrice(view, seat, slot.cost);
          return price !== null && RESOURCES.every((r) => (pool[r] ?? 0) >= (price[r] ?? 0));
        })
        .sort((a, b) => value(a.slot) - value(b.slot))[0];
      if (affordable !== undefined) return { type: 'INFLUENCE', slot: affordable.i };
    }
  }
  return safeNextAction(view, seat);
}

/** Voters bought per resource spent. `driver.ts`'s own `value`, re-stated. */
function value(slot: { readonly cost: Readonly<Record<string, number>>; readonly voters: number }): number {
  let total = 0;
  for (const r of RESOURCES) total += slot.cost[r] ?? 0;
  return slot.voters / Math.max(1, total);
}

function single(r: Resource, k: number): Delta {
  if (r === 'funds') return { funds: k };
  if (r === 'clout') return { clout: k };
  if (r === 'media') return { media: k };
  return { trust: k };
}

/**
 * `structuralPicks` is the NET UNDER `pickForChoice`, never a replacement for it.
 *
 * Every pick it returns is put through `reduce`, which is the only authority on
 * legality, so a wrong or stale pick here costs a reducer call and nothing else. Its
 * whole purpose is the case `pickForChoice` deliberately does not cover — a `Choice`
 * kind it returns `null` for, such as `choose-card` — and the case where the board moved
 * between the offer and the answer.
 *
 * `pickForChoice` is always tried first, and `capped` is returned when this runs out of
 * room, because a net that ran out of candidates has not proved anything.
 */
function structuralPicks(
  view: ClientState,
  choice: PendingChoice,
  cap: number,
): { readonly picks: ChoicePick[]; readonly capped: boolean } {
  const me = choice.player;
  const c = choice.choice;
  const n = 'count' in c ? (c.count ?? 0) : 0;
  const out: ChoicePick[] = [];
  let capped = false;

  /** Every push past `cap` is dropped, and the truncation is reported. */
  const room = (): boolean => {
    if (out.length < cap) return true;
    capped = true;
    return false;
  };

  switch (c.kind) {
    case 'gain-any':
    case 'lose-any':
      // One pool at a time, which is the shape of answer a table gives. A mixed answer
      // is also legal but it never rescues a state `pickForChoice` could not answer.
      for (const r of RESOURCES) {
        if (!room()) break;
        out.push({ kind: 'resources', res: single(r, n) });
      }
      return { picks: out, capped };

    case 'steal-any':
      for (const victim of view.turnOrder) {
        if (victim === me) continue;
        if (c.from !== null && c.from !== victim) continue;
        for (const r of RESOURCES) {
          if (!room()) return { picks: out, capped };
          out.push({ kind: 'steal', from: victim, res: single(r, n) });
        }
      }
      return { picks: out, capped };

    case 'evict-voter':
    case 'discard-voter':
    case 'convert-voter': {
      // The zero-width answer first: `resolveChoice` clamps the ask DOWN to what is
      // targetable, so a decision with nothing to target is answered by `[]`. Reading
      // that as a lock is the `evict` half of the same mistake `lose-any` caused.
      out.push({ kind: 'areas', areaIds: [] });
      for (const z of view.zones) {
        const pegged = z.areas.filter((a) => a.peg !== null).map((a) => a.id);
        for (const combo of combinations(pegged, Math.min(n, pegged.length))) {
          if (!room()) return { picks: out, capped };
          out.push({ kind: 'areas', areaIds: combo });
        }
      }
      return { picks: out, capped };
    }

    case 'choose-player':
      // The engine's own candidate set: `turnOrder` minus the chooser. Narrowing it by
      // holdings would be a peek, and `pickForChoice`'s note says so at length.
      return {
        picks: view.turnOrder
          .filter((p) => p !== me)
          .slice(0, cap)
          .map((id) => ({ kind: 'player', id })),
        capped: view.turnOrder.filter((p) => p !== me).length > cap,
      };

    case 'choose-zone':
      return {
        picks: view.zones.slice(0, cap).map((z) => ({ kind: 'zone', zoneId: z.id })),
        capped: view.zones.length > cap,
      };

    case 'choose-peg-dest': {
      for (const source of view.zones) {
        for (const a of source.areas) {
          if (a.peg === null || a.peg.owner !== c.source || a.peg.majority || a.volatile) continue;
          for (const nz of view.zones) {
            if (nz.id === source.id || !source.neighbours.includes(nz.id)) continue;
            for (const spot of nz.areas) {
              if (spot.peg !== null) continue;
              if (!room()) return { picks: out, capped };
              out.push({ kind: 'peg-dest', areaId: a.id, toAreaId: spot.id });
            }
          }
        }
      }
      return { picks: out, capped };
    }

    case 'choose-card':
      return { picks: c.cards.slice(0, cap).map((cardId) => ({ kind: 'card', cardId })), capped: c.cards.length > cap };

    default:
      return { picks: out, capped };
  }
}

/** Size-`k` combinations of `items`, in board order. */
function* combinations(items: readonly string[], k: number): Generator<string[]> {
  if (k <= 0) {
    yield [];
    return;
  }
  if (k > items.length) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    yield idx.map((i) => items[i] as string);
    let i = k - 1;
    while (i >= 0 && (idx[i] as number) >= items.length - k + i) i -= 1;
    if (i < 0) return;
    idx[i] = (idx[i] as number) + 1;
    for (let j = i + 1; j < k; j += 1) idx[j] = (idx[j - 1] as number) + 1;
  }
}

/**
 * THE PROBE. One decision point, answered by `reduce`.
 *
 * The candidate list is, in order:
 *
 *   1. the driver's own action, so the accepted-by-the-reducer fast path costs one call;
 *   2. for EVERY open decision and EVERY seat that owns one, `pickForChoice` — the
 *      engine's own answer logic — then the structural net;
 *   3. for an open window, `PASS_INTERRUPT` and a reactive `RESPOND_INTERRUPT` for every
 *      seat, read from `state.players[seat].conspiracies`, which is exactly the hand the
 *      projection hides from the driver;
 *   4. for the turn arm, the shape of every action `Action` admits, for the active
 *      player (and for every seat in the answer phase, where `PLAY_CONSPIRACY` is
 *      out-of-turn legal).
 *
 * `legal` is therefore "the reducer accepted at least one move some seat can make", which
 * is the engine's own liveness guarantee read back out of the reducer rather than
 * assumed from the driver.
 */
function probeState(state: GameState, policy: Policy): Step {
  // FAST PATH, and it is not deference. When the driver produced an action and the
  // REDUCER accepted it, the reducer has just answered the only question this file
  // asks — "does a seat have a legal action here?" — affirmatively, and from
  // authoritative state rather than from the driver's projection. The net below is then
  // dead weight, so it is not built. Every decision point is still probed; only the
  // fallback's cost is deferred to the decision points that need it.
  let driverRefusal: string | null = null;
  if (policy.seat !== null && policy.action !== null) {
    const r = reduce(state, policy.seat, policy.action, ctx);
    if (r.ok) {
      return {
        policy,
        witness: { seat: policy.seat, action: policy.action },
        next: r.state,
        driverRefusal: null,
        netCandidates: 0,
        capped: false,
      };
    }
    driverRefusal = r.error;
  }

  const net: Move[] = [];
  let capped = false;

  // 2. Every open decision, whoever owns it. `blockedBy` refuses everything except
  //    RESOLVE_CHOICE for a frozen seat, so this IS that seat's whole move set, and
  //    iterating every entry rather than `choices[0]` is what lets a state in which the
  //    FIRST decision is unanswerable still be classified honestly.
  for (const choice of state.choices) {
    const view = playerView(state, choice.player);
    const answer = safePickForChoice(view, choice);
    if (answer !== null) {
      net.push({ seat: choice.player, action: { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick: answer } });
    }
    const structural = structuralPicks(view, choice, NET_CAP);
    capped = capped || structural.capped;
    for (const pick of structural.picks) {
      net.push({ seat: choice.player, action: { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick } });
    }
  }

  // 3. The response window. Every seat that has not already declined and did not play
  //    the card, whether or not the driver thinks it is their moment — that
  //    disagreement is itself class (b)/(c) and must not hide behind the driver's view.
  const window = state.interrupt;
  if (window !== null) {
    for (const seat of state.turnOrder) {
      if (seat === window.actor || window.passed.includes(seat)) continue;
      net.push({ seat, action: { type: 'PASS_INTERRUPT' } });
      for (const cardId of state.players[seat]?.conspiracies ?? []) {
        const interrupt = ctx.cards.conspiracy[cardId]?.interrupt;
        if (interrupt?.op === 'block') {
          net.push({ seat, action: { type: 'RESPOND_INTERRUPT', cardId } });
        } else if (interrupt?.op === 'deflect') {
          const at = state.turnOrder.find((p) => p !== seat && p !== window.actor);
          if (at !== undefined) net.push({ seat, action: { type: 'RESPOND_INTERRUPT', cardId, at } });
        }
      }
    }
  }

  // 4. The turn arm.
  const active = state.activePlayer;
  const view = playerView(state, active);
  if (state.phase === 'answer') {
    net.push({ seat: active, action: { type: 'ANSWER', side: 0 } });
    net.push({ seat: active, action: { type: 'ANSWER', side: 1 } });
    net.push({ seat: active, action: { type: 'REDRAW_IDEOLOGY', pay: single('funds', ctx.rules.redrawCost) } });
    // p19: a Conspiracy Card may be played out of turn, immediately before an answer.
    for (const seat of state.turnOrder) {
      for (const cardId of state.players[seat]?.conspiracies ?? []) {
        net.push({ seat, action: { type: 'PLAY_CONSPIRACY', cardId } });
      }
    }
  } else if (state.phase === 'headlines') {
    net.push({ seat: active, action: { type: 'ACK_HEADLINE' } });
  } else if (state.phase === 'actions') {
    for (const group of state.players[active]?.pending ?? []) {
      for (const z of state.zones) {
        const free = z.areas.filter((a) => a.peg === null).map((a) => a.id);
        if (free.length >= group.count) {
          net.push({ seat: active, action: { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) } });
        }
      }
    }
    view.market.forEach((_, slot) => {
      net.push({ seat: active, action: { type: 'INFLUENCE', slot } });
    });
    for (const other of state.turnOrder) {
      if (other === active) continue;
      net.push({ seat: active, action: { type: 'TRADE', withPlayer: other, give: single('funds', 1), receive: single('clout', 1) } });
    }
    for (const cardId of state.players[active]?.conspiracies ?? []) {
      net.push({ seat: active, action: { type: 'PLAY_CONSPIRACY', cardId } });
    }
    for (const id of freeAreaIds(view)) {
      net.push({ seat: active, action: { type: 'POWER_LAND_GRAB', areaId: id } });
    }
    for (const other of state.turnOrder) {
      if (other === active) continue;
      net.push({ seat: active, action: { type: 'POWER_DONATIONS', from: other, res: 'funds' } });
    }
    net.push({ seat: active, action: { type: 'END_TURN' } });
  }

  for (const move of net) {
    const r = reduce(state, move.seat, move.action, ctx);
    if (r.ok) {
      return { policy, witness: move, next: r.state, driverRefusal, netCandidates: net.length, capped };
    }
  }

  return { policy, witness: null, next: null, driverRefusal, netCandidates: net.length, capped };
}

// ─────────────────────────── the sweep ───────────────────────────

type Run = {
  readonly seed: number;
  readonly seats: number;
  readonly finished: boolean;
  readonly actions: number;
  readonly turn: number;
  readonly classes: Classes;
  /** Decision points the probe answered. One `reduce` call each on the fast path. */
  readonly steps: number;
  /**
   * Decision points where `nextAction` THREW rather than returning null. That is a
   * stronger statement than declining — the driver declaring "this seat is on move and I
   * have nothing" — so it is carried and printed rather than being indistinguishable from
   * a driver that simply had no turn.
   */
  readonly driverThrew: string[];
  /**
   * Decision points where the driver's answer was not enough and the NET supplied the
   * accepted move. Zero means `pickForChoice` sufficed on every single decision point of
   * the sweep, which is the claim the header makes about the engine's own answer logic.
   */
  readonly netWins: number;
  readonly softLockDetail: string[];
};

function sweepOne(seed: number, seats: number): Run {
  let state = freshShippedCorpus(seed, seats, ctx);
  let actions = 0;
  let steps = 0;
  let netWins = 0;
  const tally = emptyTally();
  const driverThrew: string[] = [];
  const softLockDetail: string[] = [];

  while (!state.finished) {
    if (actions >= ACTION_BUDGET) break;

    const policy = policyOf(state);
    const step = probeState(state, policy);
    steps += 1;

    if (step.witness === null) {
      // (a) The reducer accepted nothing any seat can do, out of the whole candidate set.
      tally.softLocks += 1;
      softLockDetail.push(
        `seed ${seed} ${seats} seats, turn ${state.turn}, phase ${state.phase}: the reducer accepted ` +
          `none of the ${step.netCandidates + 1} candidates` +
          (step.driverRefusal === null ? '' : `; the driver was refused "${step.driverRefusal}"`) +
          (step.capped ? ' (NET CAPPED — this is NOT a proved lock)' : ''),
      );
      break;
    }

    // (c) The driver emitted something the reducer refused. Counted whether or not the
    // net then found something, because "the driver is wrong" and "the table is stuck"
    // are different facts and both need a count.
    if (step.driverRefusal !== null) {
      tally.disagreements += 1;
      tally.driverLimitations += 1;
    } else if (policy.action === null) {
      // (b) The driver produced nothing at all, and the reducer says there was something.
      tally.driverLimitations += 1;
    }

    if (step.netCandidates > 0) netWins += 1;
    if (policy.threw !== null) {
      driverThrew.push(`seed ${seed} ${seats} seats turn ${state.turn}: ${policy.threw}`);
    }

    state = step.next as GameState;
    actions += 1;
  }

  return {
    seed,
    seats,
    finished: state.finished,
    actions,
    turn: state.turn,
    classes: tally,
    steps,
    netWins,
    driverThrew,
    softLockDetail,
  };
}

function freeAreaIds(view: ClientState): string[] {
  return view.zones.flatMap((z) => z.areas.filter((a) => a.peg === null).map((a) => a.id));
}

/**
 * One sweep per seat count, memoised so every assertion sees the same games.
 *
 * Per seat count rather than as one union for two reasons. The `corpus.test.ts` argument
 * applies: a union claim cannot mask a 2-seat regression behind 3-, 4- and 5-seat runs.
 * And the run is split so no single `it` inherits the whole sweep's wall clock against a
 * per-test timeout — 100 seeds at 5 seats is a lot of games for one assertion.
 */
const cache = new Map<number, readonly Run[]>();
function sweep(seats: number): readonly Run[] {
  const hit = cache.get(seats);
  if (hit !== undefined) return hit;
  const rows = SEEDS.map((seed) => sweepOne(seed, seats));
  cache.set(seats, rows);
  return rows;
}

function allRuns(): readonly Run[] {
  return SEAT_COUNTS.flatMap((seats) => sweep(seats));
}

function totals(rows: readonly Run[]): Classes {
  return rows.reduce<Classes>(
    (acc, r) => ({
      softLocks: acc.softLocks + r.classes.softLocks,
      driverLimitations: acc.driverLimitations + r.classes.driverLimitations,
      disagreements: acc.disagreements + r.classes.disagreements,
      runDowns: acc.runDowns + (r.finished ? 0 : 1),
    }),
    emptyTally(),
  );
}

function table(rows: readonly Run[]): string {
  return SEAT_COUNTS.map((seats) => {
    const at = sweep(seats);
    const done = at.filter((r) => r.finished).length;
    const t = totals(at);
    return (
      `seats ${seats}: ${done}/${at.length} finished, locks ${t.softLocks}, ` +
      `driver-limitation ${t.driverLimitations}, disagreement ${t.disagreements}, run-down ${t.runDowns}`
    );
  }).join('\n  ');
}

// ─────────────────────────── the teeth: a lock I can make on purpose ───────────────────────────

/**
 * A `choose-zone` decision on a board with NO voters on it.
 *
 * `legalZoneIds` filters the nine constituencies down to those holding at least one peg
 * the effect could name, and the engine raises this kind ONLY when that set is non-empty
 * — so the engine cannot produce it. Constructed by hand it is the real thing: a frozen
 * seat whose only action the reducer refuses, forever. `resolveChoice` validates the pick
 * against the same `legalZoneIds`, so every pick fails with `'you may not choose that
 * constituency'`.
 *
 * `blockedBy` refuses everything except `RESOLVE_CHOICE` for a seat with an open decision,
 * so freezing EVERY seat with one of these is a table where NO seat has any legal action.
 * This is a constructed state, not a reachable one, and that is the point: it is the only
 * way to show the detector can report class (a) at all. A probe that has never reported a
 * real lock has not been shown to work.
 */
function lockedTable(seats: number, frozen: readonly PlayerID[]): GameState {
  const base = freshShippedCorpus(1, seats, ctx);
  const choices: PendingChoice[] = frozen.map((player, i) => ({
    id: `test-lock-${i}`,
    player,
    choice: {
      kind: 'choose-zone',
      count: 1,
      source: player,
      reason: 'TEST-ONLY unanswerable decision',
      effects: [{ op: 'discard-voter', n: 1, zone: 'chosen-zone' as const }],
    },
  }));
  // `phase: 'actions'` on purpose. A freshly dealt table opens in `'answer'` with one
  // seat on move, and freezing that seat alone would already leave nobody able to act —
  // so a lock built there would be half about the phase rather than about the freeze.
  // In `'actions'` the active player has `END_TURN`, which `blockedBy` refuses, and every
  // other seat is refused `'not your turn'`. So the ONLY reason nobody can move is the
  // decision, which is what makes this a lock and not a phase artefact.
  return { ...base, phase: 'actions', choices };
}

/**
 * Every action shape `Action` admits, for every seat, built independently of `probeState`.
 *
 * This exists so the claim "that state has no legal action" is checked by brute force over
 * the action TYPE rather than by asking the thing under test. If it went through
 * `probeState` it would be the probe agreeing with itself, which is not evidence.
 */
function everyNamedMove(state: GameState): Move[] {
  const out: Move[] = [];
  const seats = state.turnOrder;
  const forEach = (fn: (seat: PlayerID) => void): void => {
    for (const seat of seats) fn(seat);
  };

  forEach((seat) => {
    const view = playerView(state, seat);
    for (const action of [
      { type: 'END_TURN' } as Action,
      { type: 'ACK_HEADLINE' } as Action,
      { type: 'ANSWER', side: 0 } as Action,
      { type: 'ANSWER', side: 1 } as Action,
      { type: 'PASS_INTERRUPT' } as Action,
      { type: 'REDRAW_IDEOLOGY', pay: single('funds', ctx.rules.redrawCost) } as Action,
    ]) {
      out.push({ seat, action });
    }
    view.market.forEach((_, slot) => {
      out.push({ seat, action: { type: 'INFLUENCE', slot } });
    });
    for (const group of state.players[seat]?.pending ?? []) {
      for (const z of view.zones) {
        const free = z.areas.filter((a) => a.peg === null).map((a) => a.id);
        if (free.length >= group.count) {
          out.push({ seat, action: { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) } });
        }
      }
    }
    for (const other of seats) {
      if (other === seat) continue;
      out.push({ seat, action: { type: 'TRADE', withPlayer: other, give: single('funds', 1), receive: single('clout', 1) } });
      out.push({ seat, action: { type: 'POWER_DONATIONS', from: other, res: 'funds' } });
    }
    for (const cardId of state.players[seat]?.conspiracies ?? []) {
      out.push({ seat, action: { type: 'PLAY_CONSPIRACY', cardId } });
      out.push({ seat, action: { type: 'RESPOND_INTERRUPT', cardId } });
    }
    for (const areaId of view.zones[0]?.areas.map((a) => a.id) ?? []) {
      out.push({ seat, action: { type: 'POWER_LAND_GRAB', areaId } });
    }
  });

  // Every open decision, answered by anybody at all — a decision is only its owner's, and
  // the whole point of `blockedBy` is that this is the ONLY move a frozen seat has.
  for (const choice of state.choices) {
    const view = playerView(state, choice.player);
    const structural = structuralPicks(view, choice, NET_CAP);
    const picks = [safePickForChoice(view, choice), ...structural.picks].filter(
      (p): p is ChoicePick => p !== null,
    );
    for (const seat of seats) {
      for (const pick of picks) {
        out.push({ seat, action: { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick } });
      }
    }
  }

  return out;
}

/** The reducer's own verdict on every one of those, asked directly. */
function reducerAcceptedActions(state: GameState): Move[] {
  return everyNamedMove(state).filter((m) => reduce(state, m.seat, m.action, ctx).ok);
}

/** One `lose-any` decision that the naive `{ res: {} }` pick cannot answer. */
function frozenOnLoseAny(): GameState {
  const base = freshShippedCorpus(1, 2, ctx);
  const seat: PlayerID = 'p1';
  const holding = { funds: 2, clout: 0, media: 0, trust: 0 };
  return {
    ...base,
    players: { ...base.players, [seat]: { ...base.players[seat]!, resources: holding } },
    choices: [
      {
        id: 'test-lose-any',
        player: seat,
        choice: { kind: 'lose-any', count: 2, reason: 'TEST-ONLY discard two' },
      },
    ],
  };
}

// ─────────────────────────── the tests ───────────────────────────

describe('no seat is ever left without a legal action', () => {
  // Per seat count, and that is deliberate. `corpus.test.ts` makes the argument: a claim
  // over the union of the seat counts cannot mask a 2-seat regression behind the runs at
  // 3, 4 and 5. It also keeps each assertion's wall clock against a per-test timeout.
  for (const seats of SEAT_COUNTS) {
    it(`${seats} seats: no soft-lock and no driver/engine disagreement across the seed range`, () => {
      const rows = sweep(seats);
      const t = totals(rows);
      const detail = rows.flatMap((r) => r.softLockDetail).join('\n');
      expect(
        t.softLocks,
        `A SOFT-LOCK at ${seats} seats: a state in which no seat has any legal action. The ` +
          `reducer refused every candidate the probe generated, which means 'blockedBy' has ` +
          `frozen the table on a decision nobody can answer. This is the bug class that ` +
          `shipped in a \`reveal\` op and was caught by luck. \n${detail}`,
      ).toBe(0);
      const offenders = rows
        .filter((r) => r.classes.disagreements > 0)
        .map((r) => `seed ${r.seed} turn ${r.turn}`)
        .join(', ');
      expect(
        t.disagreements,
        `at ${seats} seats the driver and the engine disagreed about legality at ` +
          `${t.disagreements} decision point(s). Both can be right in isolation and the table is ` +
          `still stuck, so this is a defect in one of them: ${offenders}`,
      ).toBe(0);
    });
  }

  it('the engine’s own answer logic sufficed at every decision point of the whole sweep', () => {
    // The vacuity floor, and it is a claim about the MECHANISM rather than a count. If
    // the net had ever supplied the accepted move then this run walked a trajectory the
    // driver did not choose, and the sweep would no longer be comparable with
    // `winnable.test.ts`'s. It is also the assertion that fails first if somebody
    // replaces `pickForChoice` with an invented pick — see the lose-any test below.
    const rows = allRuns();
    const rescued = rows.flatMap((r) =>
      r.netWins > 0 ? [`seed ${r.seed} at ${r.seats} seats, turn ${r.turn}`] : [],
    );
    expect(
      rescued,
      'the net supplied the accepted move, so the sweep left the driver policy. That is fine for ' +
        'a liveness sweep and NOT fine for a completion number read as comparable with the other ' +
        `sweeps. \n${rescued.join('\n')}`,
    ).toEqual([]);
  });

  it('the sweep covered every seat count and every seed, and probed every decision point', () => {
    const rows = allRuns();
    expect(rows.map((r) => r.seats)).toEqual(SEAT_COUNTS.flatMap((s) => SEEDS.map(() => s)));
    expect(rows.map((r) => r.seed)).toEqual(SEAT_COUNTS.flatMap(() => SEEDS));
    // One probe per action taken, plus one at the decision point that ended the game.
    expect(
      rows.filter((r) => r.steps < r.actions),
      'a run took more actions than it had decision points, so some move skipped the reducer',
    ).toEqual([]);
  });

  it('the completion rate, measured and printed rather than asserted', () => {
    // NOT a gate. A prior measurement found seeds that reach the action budget for a
    // pre-existing and separately-understood reason, so a completion assertion here
    // would be false on day one — and a gate that starts false teaches a team to build a
    // tolerated list, which is how the bug this file exists for shipped in the first
    // place. The number is reported so a change in it is visible; the classes are what
    // are asserted.
    const rows = allRuns();
    const t = totals(rows);
    const done = rows.filter((r) => r.finished).length;
    const actions = rows.filter((r) => r.finished).map((r) => r.actions);
    const steps = rows.reduce((k, r) => k + r.steps, 0);
    const ranDown = rows
      .filter((r) => !r.finished)
      .map((r) => `${r.seats} seats seed ${r.seed} (turn ${r.turn}, ${r.actions} actions)`);
    const threw = rows.flatMap((r) => r.driverThrew);
    console.log(
      `LIVENESS SWEEP: ${rows.length} runs, seeds ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]}, ` +
        `seat counts ${SEAT_COUNTS.join('/')}, action budget ${ACTION_BUDGET}, ` +
        `${steps} decision points probed\n  ${table(rows)}\n` +
        `  completed ${done}/${rows.length}; actions ${Math.min(...actions)}..${Math.max(...actions)}; ` +
        `(a) locks ${t.softLocks}, (b) driver-limitation ${t.driverLimitations}, ` +
        `(c) disagreement ${t.disagreements}, (d) run-down ${t.runDowns}` +
        (ranDown.length === 0 ? '' : `\n  class (d), NOT a lock: ${ranDown.join('; ')}`) +
        (threw.length === 0
          ? ''
          : `\n  driver threw (class b), NOT a lock: ${threw.slice(0, 5).join('; ')}`),
    );
    // A driver throw is a driver bug, so it is a count and not a silent swallow. It is
    // reported rather than asserted, because it is the driver being wrong about a table
    // the reducer says is fine — class (b)'s territory.
    expect(rows.flatMap((r) => r.driverThrew), 'the driver threw and the log hid it').toEqual([]);
    // The measurement is only a measurement if it was actually taken.
    expect(rows.every((r) => typeof r.finished === 'boolean')).toBe(true);
    expect(done).toBeGreaterThan(0);
  });
});

describe('the probe can still see a real lock', () => {
  it('reports class (a) when every seat is frozen on an unanswerable decision', () => {
    for (const seats of SEAT_COUNTS) {
      const frozen = Array.from({ length: seats }, (_, i) => `p${i + 1}` as PlayerID);
      const state = lockedTable(seats, frozen);
      const step = probeState(state, policyOf(state));
      expect(
        step.witness,
        `at ${seats} seats with every seat frozen on an unanswerable decision the probe found ` +
          `a legal action: ${JSON.stringify(step.witness)}. Either the probe is not asking ` +
          `the reducer, or this is not a lock — and the reducer's own answer below says which.`,
      ).toBeNull();
      expect(step.capped, 'the net was capped, so this verdict is not a proved lock').toBe(false);
      expect(step.next).toBeNull();
    }
  });

  it('the reducer itself refuses every move in that state, so the lock is the rules’', () => {
    for (const seats of SEAT_COUNTS) {
      const frozen = Array.from({ length: seats }, (_, i) => `p${i + 1}` as PlayerID);
      const state = lockedTable(seats, frozen);
      const accepted = reducerAcceptedActions(state);
      expect(
        accepted.map((m) => `${m.seat}:${m.action.type}`),
        `at ${seats} seats the reducer accepted a move in a state with no legal action`,
      ).toEqual([]);
      // And the obvious escape hatches are refused with the reason the rules give.
      const seat = frozen[0] as PlayerID;
      for (const action of [{ type: 'END_TURN' } as Action, { type: 'ACK_HEADLINE' } as Action, { type: 'PASS_INTERRUPT' } as Action]) {
        const r = reduce(state, seat, action, ctx);
        expect(r.ok, `${action.type} was accepted on a frozen seat`).toBe(false);
      }
    }
  });

  it('the same brute-force enumeration accepts moves one seat down, so the empty result is real', () => {
    // The vacuity guard on the assertion above. An enumeration that names nothing, or one
    // whose every member is malformed, would produce the same empty answer for a state
    // that is perfectly playable — so the enumeration is run against the near-identical
    // state with the last freeze lifted, where it must find a legal move.
    for (const seats of SEAT_COUNTS) {
      const all = Array.from({ length: seats }, (_, i) => `p${i + 1}` as PlayerID);
      const full = lockedTable(seats, all);
      const near = lockedTable(seats, all.filter((p) => p !== full.activePlayer));
      expect(
        reducerAcceptedActions(near).map((m) => `${m.seat}:${m.action.type}`),
        `at ${seats} seats the enumeration found no legal move in a table that still has a free ` +
          `seat, so "the reducer refuses everything" above is about the enumeration rather ` +
          `than about the lock`,
      ).not.toEqual([]);
    }
  });

  it('reports NO lock when one seat is left free, so class (a) is a discrimination', () => {
    // The negative control. If the probe reported (a) for every frozen state it would
    // be reporting the freeze rather than the lock, and the sweep assertion would be
    // green for the wrong reason on the very first card effect that freezes a seat.
    // The free seat is the ACTIVE one, so it has `END_TURN` and is not frozen — the
    // only difference from the lock above is the last decision.
    for (const seats of SEAT_COUNTS) {
      const all = Array.from({ length: seats }, (_, i) => `p${i + 1}` as PlayerID);
      const state = lockedTable(seats, all);
      const frozen = all.filter((p) => p !== state.activePlayer);
      const partial = lockedTable(seats, frozen);
      const step = probeState(partial, policyOf(partial));
      expect(
        step.witness,
        `at ${seats} seats with ${frozen.length} of ${all.length} seats frozen the probe called ` +
          `a lock, so class (a) is measuring the freeze rather than the absence of a legal action`,
      ).not.toBeNull();
      expect(state.activePlayer, 'the fixture did not leave a distinguishable free seat').toBe(all[0]);
    }
  });

  it('answers a lose-any decision through the engine’s own logic, not an empty pick', () => {
    // THE REGRESSION FOR THE FALSE POSITIVE IN THE HEADER. The state below is frozen on
    // a `lose-any` for 2 resources from a seat holding exactly 2, so `reduce` refuses
    // `{ kind: 'resources', res: {} }` — it totals 0 against an ask of 2 — and the naive
    // pick reads as a lock on a table that is perfectly answerable. A prober that invents
    // its own answer reports a hard freeze on a healthy game.
    const state = frozenOnLoseAny();
    const seat: PlayerID = 'p1';
    const choice = state.choices[0];
    expect(choice, 'the fixture raised no decision').toBeDefined();

    const naive = reduce(state, seat, { type: 'RESOLVE_CHOICE', choiceId: choice!.id, pick: { kind: 'resources', res: {} } }, ctx);
    expect(naive.ok, 'the naive empty pick was accepted, so this fixture no longer reproduces the trap').toBe(false);

    const step = probeState(state, policyOf(state));
    expect(
      step.witness,
      `a lose-any the reducer could answer was reported as a lock. \`pickForChoice\` must be the ` +
        `first candidate: the reducer said "${naive.ok ? '' : 'discard exactly 2'}" to the empty pick.`,
    ).not.toBeNull();
  });
});