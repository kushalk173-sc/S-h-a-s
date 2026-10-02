/**
 * A competent, rule-obeying game driver, for the tests that have to finish a game.
 *
 * WHY THIS IS NOT THE DRIVER THAT USED TO LIVE IN `e2e.test.ts`
 *
 * The old driver drove `bigCards()`, a synthetic deck. That corpus cannot fail in
 * the ways the shipped one fails, for two structural reasons, both measured:
 *
 *  1. **Deck size.** `bigCards()` deals 240 Ideology Cards. The shipped corpus has
 *     52, and a game draws exactly one per turn, so the shipped deck is the binding
 *     constraint on how long a game can last. This is the failure that shipped: the
 *     real corpus ended every game on turn 52 with 0 of 9 zones decided, and no
 *     test noticed because every fixture had 77x the Ideology deck.
 *
 *  2. **Choice kinds.** Every synthetic Headline Card is `gain media 1`, so the
 *     synthetic corpus NEVER produces an effect-generated `PendingChoice`. The
 *     shipped corpus's 26 headlines carry twelve distinct ops — `evict`,
 *     `discard-voter`, `steal-any`, `lose-any`, `gerrymander`, `refresh-market`,
 *     `draw-conspiracy`, `discount` — and `evict`/`discard-voter`/`steal-any`
 *     each open a decision that FREEZES A PLAYER. The old driver's fallback for an
 *     unrecognised choice was `pick: { kind: 'areas', areaIds: [] }`, which is a
 *     valid answer only for a zero-voter ask. Against the real corpus that is a
 *     refusal, and a refusal on a frozen player is a dead table.
 *
 * So this driver is written against the real corpus and handles every choice kind
 * the engine can raise. `test/corpus.test.ts` pins the corpus's size and
 * composition so neither failure can come back unnoticed.
 *
 * WHAT "COMPETENT" MEANS HERE, AND WHY IT IS NOT CHEATING
 *
 * Three competences, each one something a competent human does, and each one
 * load-bearing — measured, with the numbers, in `test/winnable.test.ts`:
 *
 *  - **Never place voters into a zone you cannot win.** This is the big one. The
 *    old `targetZone` fell back to "first zone with room" whenever no winnable
 *    zone existed, which spends voters on zones that can never reach a majority.
 *    Dropping that fallback took the nine-majority rate across 48 real-corpus games
 *    (12 seeds x 4 seat counts) from 29/48 to 48/48, and removed the board-full
 *    endings entirely: before, 19 of 48 games filled all 129 areas and ended with
 *    only 6-8 of 9 zones decided; after, none of them did.
 *  - **Answer the side that pays.** Both sides of an Ideology Card are public to
 *    the answering player; side 0 of the shipped corpus pays Funds on 22 of 52
 *    cards against side 1's 4, and Voter Cards cost mostly Funds. Always answering
 *    side 0 is legal but it is not how anyone plays.
 *  - **Buy the best voters-per-resource card that a winnable zone can take.**
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never plays a Conspiracy, never uses an Ideologue Power, and never
 * gerrymanders. Those are separate rule surfaces with their own tests, and a driver
 * that reached for them would make a failure ambiguous: "the driver could not find
 * a legal move" and "the rules have no legal move" would look the same.
 *
 * G13 — THE RESPONSE WINDOW, and the one thing this driver CANNOT decide from its
 * projection
 *
 * `reduce` freezes the whole table while `GameState.interrupt` is open, and the two
 * actions it still accepts are `RESPOND_INTERRUPT` and `PASS_INTERRUPT`. So before
 * G13 this driver did not merely play badly during a window, it had no legal move
 * at all: `nextAction` returned `END_TURN` or `INFLUENCE`, the reducer answered
 * `"<card>" is resolving - answer it or decline first`, and the run reported a
 * stall. That is why BLOCK and DEFLECT were kept out of the shipped decks.
 *
 * What it CAN decide from a projection is who owes a response. `turnOrder` is
 * public, `choices` is public, and `InterruptWindow.actor` / `passed` are public, so
 * `requiredDecliners` and `responseOrder` below are transcriptions of the engine's
 * own `mustRespond` with no private input at all.
 *
 * What it CANNOT decide is whether to ANSWER, and this is the interesting
 * constraint rather than an inconvenience. `PRIVATE_PLAYER_KEYS` in
 * `packages/engine/src/playerView.ts` is `['conspiracies']`, and `playerView`
 * strips it for EVERY viewer including the owner — with a docstring saying that a
 * `(pid === viewer)` branch there "is the R1 bug in a plausible-looking form". So a
 * `ClientState` contains no Conspiracy Card id anywhere, for anybody, and a driver
 * reading only the projection is structurally incapable of naming a BLOCK.
 *
 * So responding takes an EXPLICIT, OPTIONAL, SEAT-SCOPED input: `SeatKnowledge`,
 * built by `ownKnowledge(state, me, cards)` and carrying nothing but the named
 * seat's own hand plus the printed card bodies. A player at a physical table knows
 * the cards in their own hand, so this is not information a person lacks; it is
 * information a `ClientState` cannot carry. The distinction that matters and is
 * asserted in `./interrupt-window.test.ts` is:
 *
 *  - `ownKnowledge` reads `state.players[me].conspiracies` and nothing else. There
 *    is no parameter through which another seat's hand could be supplied, and no
 *    default, so the re-introduction of the old peek has to be written on purpose.
 *  - without `SeatKnowledge` the driver DECLINES, every time, and a table driven
 *    that way still terminates (also asserted). That is the honest fallback: if the
 *    driver cannot know, it declines, and it says so rather than guessing.
 */

import {
  RESOURCES,
  playerView,
  reduce,
  setup,
  type Action,
  type CardID,
  type CardIndex,
  type ChoicePick,
  type ClientState,
  type ConspiracyCard,
  type Ctx,
  type GameState,
  type InterruptWindow,
  type PendingChoice,
  type PlayerID,
  type Resource,
} from '@shasn/engine';

import { decksOf } from '../src/store.ts';

/** Resources in the order the engine declares them, for deterministic walks. */
const POOLS: readonly Resource[] = RESOURCES;

function sum(d: Readonly<Record<string, number>> | undefined): number {
  if (d === undefined) return 0;
  let total = 0;
  for (const r of POOLS) total += d[r] ?? 0;
  return total;
}

/** An exact `n`, taken from what the player actually holds. */
export function takeExactly(
  n: number,
  pool: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (pool === undefined) return { funds: n };
  let left = n;
  for (const res of POOLS) {
    if (left <= 0) break;
    const take = Math.min(left, pool[res] ?? 0);
    if (take > 0) {
      out[res] = take;
      left -= take;
    }
  }
  if (left > 0) out.funds = (out.funds ?? 0) + left;
  return out;
}

/**
 * A `lose-any` pick that totals EXACTLY the ask, and leaves the player able to buy.
 *
 * Three requirements, and the third is the one that is easy to get wrong in a way
 * that looks like a working driver.
 *
 * **1. Exactly `n`.** p12 asks for exactly `n` back and `reduce` refuses anything
 * else with `discard exactly n`. Short is illegal and long is illegal, so the ask
 * wins over everything else, even when satisfying it means eating the last resource.
 *
 * **2. Do not starve.** The obvious rule — walk the pools in `RESOURCES` order,
 * which is Funds first — throws away the currency the board is priced in. Measured
 * on the shipped corpus, a driver doing that reached a state of
 * `{funds: 12, clout: 0, media: 0, trust: 0}` with a Mat of
 * `media 3 / funds 2 + trust 2 / clout 2 + trust 1`: no card it could afford, ever.
 * The turn income kept arriving and the cap kept taking it back, so the table
 * ground to turn 398 with 12 pegs on the board and never finished.
 *
 * **3. A Funds-only reserve is not a reserve.** Ten of the shipped corpus's 18 Voter
 * Cards are priced without any Funds at all, and `refresh-market` reshuffles the
 * Mat, so a player holding only Funds can be shown a Mat it cannot buy. The
 * previous version of this function held back a reserve denominated in Funds and
 * shed every other pool, which is precisely how it happened.
 *
 * So the reserve is PER POOL: `need(r)` is the cheapest amount of `r` that any card
 * on the current Mat asks for, and the pools are shed by descending surplus
 * `held(r) - need(r)`. A pool no card on the Mat uses has `need(r) = 0` and is
 * shed first, which is right — it buys nothing. A pool every affordable card needs
 * is held.
 */
export function discardKeepingReserve(
  n: number,
  pool: Readonly<Record<string, number>>,
  market: readonly { readonly cost: Readonly<Record<string, number>> }[],
): Record<string, number> {
  const held = sum(pool);
  const want = Math.min(n, held);

  // What each pool must keep to be able to buy SOMETHING that is on the Mat now.
  const need = new Map<Resource, number>();
  for (const r of POOLS) {
    let cheapest = Number.POSITIVE_INFINITY;
    for (const slot of market) {
      const c = slot.cost[r] ?? 0;
      if (c > 0) cheapest = Math.min(cheapest, c);
    }
    need.set(r, Number.isFinite(cheapest) ? cheapest : 0);
  }
  const surplus = (r: Resource): number => (pool[r] ?? 0) - (need.get(r) ?? 0);

  const out: Record<string, number> = {};
  let left = want;

  // 1. By descending surplus: the resources the Mat does not need go first.
  for (const r of [...POOLS].sort((a, b) => surplus(b) - surplus(a))) {
    if (left <= 0) break;
    const take = Math.min(left, pool[r] ?? 0);
    if (take > 0) out[r] = take;
    left -= take;
  }

  // 2. Still short: the ask wins and the reserve goes. p12 wants EXACTLY `want`,
  //    and reaching here means holding nothing but essentials, in which case
  //    "stay able to buy" and "obey the cap" are the same impossibility.
  if (left > 0) {
    for (const r of [...POOLS].sort((a, b) => (pool[b] ?? 0) - (pool[a] ?? 0))) {
      if (left <= 0) break;
      const take = Math.min(left, pool[r] ?? 0);
      if (take > 0) out[r] = (out[r] ?? 0) + take;
      left -= take;
    }
  }

  return out;
}

/** Non-Funds pegs a choice could legally take, most-contested first. */
function foreignAreas(
  s: ClientState,
  me: PlayerID,
  want: number,
): readonly string[] {
  const out: string[] = [];
  for (const z of s.zones) {
    for (const a of z.areas) {
      // A Volatile Area cannot be evicted or converted — p18.
      if (a.peg === null || a.volatile) continue;
      if (a.peg.owner === me) continue;
      out.push(a.id);
      if (out.length === want) return out;
    }
  }
  return out;
}

/** Areas a `steal-any` could legally take from `victim`. */
function stealable(
  s: ClientState,
  me: PlayerID,
  n: number,
): { from: PlayerID; res: Record<string, number> } | null {
  for (const id of s.turnOrder) {
    if (id === me) continue;
    const victim = s.players[id];
    if (victim === undefined) continue;
    const want = Math.min(n, sum(victim.resources));
    if (want <= 0) continue;
    const res = takeExactly(want, victim.resources);
    // The other half of what `reduce` checks: the pick must be affordable FOR THE
    // VICTIM, so a player cannot be drained below zero by a steal.
    const legal = (POOLS.every((r) => (res[r] ?? 0) <= (victim.resources[r] ?? 0))) && sum(res) === want;
    if (legal) return { from: id, res };
  }
  return null;
}

/**
 * A legal pick for a `PendingChoice`, whatever raised it.
 *
 * Every branch is reachable against the shipped corpus. The `evict-voter`,
 * `discard-voter` and `convert-voter` arms are the ones the synthetic corpus could
 * never produce, and each of them freezes its owner until answered — so a driver
 * that cannot answer them does not merely play badly, it deadlocks the table.
 */
export function pickForChoice(s: ClientState, choice: PendingChoice): ChoicePick | null {
  const me = choice.player;
  const self = s.players[me];
  if (self === undefined) return null;
  const n = choice.choice.count ?? 0;

  switch (choice.choice.kind) {
    case 'gain-any':
      return { kind: 'resources', res: { funds: n } };
    case 'lose-any':
      return { kind: 'resources', res: discardKeepingReserve(n, self.resources, s.market) };
    case 'steal-any': {
      const hit = stealable(s, me, n);
      return hit === null ? null : { kind: 'steal', from: hit.from, res: hit.res };
    }
    case 'evict-voter':
      return { kind: 'areas', areaIds: [...foreignAreas(s, me, n)] };
    case 'discard-voter':
    case 'convert-voter':
      return { kind: 'areas', areaIds: [...foreignAreas(s, me, n)] };
    default:
      // Unreachable against a corpus the cards package has validated. Returning
      // `null` makes the caller throw with the kind in the message, which is the
      // right outcome: a new choice kind should FAIL LOUDLY rather than be
      // silently answered with an empty area list.
      return null;
  }
}

/**
 * The zone this seat should spend voters in, or `null` for "nowhere worth it".
 *
 * The `null` is the whole point, and it is a deliberate change of behaviour from
 * the driver this replaces. A zone qualifies only if `mine + free >= majority` —
 * that is, only if spending here can still produce a majority.
 *
 * The old driver fell back to the first zone with room when nothing was winnable,
 * with the reasoning that it "fills the board toward p20's board-full ending". It
 * does fill the board. It also throws the voters away: measured over 48 shipped-
 * corpus games, that fallback produced 19 games that filled all 129 areas and still
 * ended with 6 to 8 of 9 zones undecided, because the votes went to zones that
 * could never reach a threshold. With the fallback removed, all 48 reached nine
 * majorities.
 *
 * Among the zones that qualify, the one this seat already holds the most pegs in:
 * concentrating is what turns a majority of individual pegs into a majority of
 * zones, and p10 forbids splitting one card's voters across zones so the
 * concentration has to happen one card at a time.
 *
 * There is deliberately NO "any zone with room" fallback here. Relaxing the "can win
 * it" test to "has room" was measured and it is much worse: across 20 seeds at each
 * seat count it took 4 seats from 20/20 nine-majority endings to 12/20 and 5 seats
 * from 20/20 to 6/20, because a seat with no winnable zone spends its voters filling
 * a board that will then hit p20's board-full ending before the last two zones are
 * ever decided. It was also measured as a fix for the one seed that stalls
 * (3 seats, seed 11) and it did not fix it. See `test/winnable.test.ts`.
 */
export function targetZone(s: ClientState, me: PlayerID, need: number): string | null {
  let best: string | null = null;
  let bestMine = -1;
  for (const z of s.zones) {
    // p10: a Voter Card's voters cannot be split across zones, so a zone with
    // fewer free areas than the card holds is unusable and must never be named.
    const free = z.areas.filter((a) => a.peg === null).length;
    if (free < need) continue;
    if (z.majorityHolder === me) continue; // already won; nothing to gain
    const mine = z.areas.filter((a) => a.peg?.owner === me).length;
    if (mine >= z.majority) continue; // lost it; nothing to gain
    if (mine + free < z.majority) continue; // cannot win it; do not spend here
    if (mine > bestMine) {
      best = z.id;
      bestMine = mine;
    }
  }
  return best;
}

/**
 * The seats the engine is waiting on: `turnOrder` minus the actor minus anybody
 * frozen by a pending decision.
 *
 * A transcription of `mustRespond` in `reduce.ts`, and derived the same way — from
 * the state, never from a stored list. Three things make it safe to transcribe
 * rather than read off the window:
 *
 *  - `turnOrder` is public, so the ORDER is knowable. `InterruptWindow` has no
 *    `responders` field (deliberately — see the type's docstring), so the driver
 *    recomputes the same set the reducer computes.
 *  - `choices` is public, so "somebody is frozen" is knowable, which is what stops
 *    the driver demanding a decline from a player who cannot act at all.
 *  - `actor` and `passed` are public for the reasons argued on `InterruptWindow`:
 *    the actor played a card that is already face up, and a player who declines has
 *    revealed nothing.
 *
 * So this function reads nothing private. If it ever needed to, the right response
 * is a new argument, not a peek into the projection.
 */
export function requiredDecliners(view: ClientState, w: InterruptWindow): readonly PlayerID[] {
  return view.turnOrder.filter((p) => p !== w.actor && !view.choices.some((c) => c.player === p));
}

/**
 * The required seats in the order the table asks them: `turnOrder` cycled forward
 * from the seat AFTER the actor.
 *
 * The engine does not store an order — `mustRespond` returns a set and
 * `PASS_INTERRUPT` is accepted from anyone outstanding — so the driver has to pick
 * one, and this is the pick a table would make: the player whose turn is next. It
 * is a convention, stated here so it is visible rather than emergent, and it is why
 * the sweep sees both outcomes: a seat holding a reactive card that is asked first
 * answers, and one asked after a decline answers later or not at all.
 */
export function responseOrder(view: ClientState, w: InterruptWindow): readonly PlayerID[] {
  const required = new Set(requiredDecliners(view, w));
  const order = view.turnOrder;
  const start = order.indexOf(w.actor);
  const out: PlayerID[] = [];
  for (let i = 1; i <= order.length; i += 1) {
    const p = order[(start + i) % order.length];
    if (p !== undefined && required.has(p)) out.push(p);
  }
  return out;
}

/** The ONE seat the table is waiting on, or `null` when no window is open. */
export function windowResponder(view: ClientState): PlayerID | null {
  const w = view.interrupt;
  if (w === null) return null;
  if (w.responder !== null) return null; // answered; the window is already closing
  for (const p of responseOrder(view, w)) {
    if (!w.passed.includes(p)) return p;
  }
  return null;
}

/**
 * What a seat knows that its projection cannot tell it. See the G13 note in the
 * header for why this is an explicit input rather than a read.
 *
 * `ownConspiracies` is the seat's OWN hand and nothing else. There is deliberately
 * no field for "any other player's hand", so the driver has no way to be handed
 * one — the absence is the assertion.
 */
export type SeatKnowledge = {
  readonly ownConspiracies: readonly CardID[];
  /** Printed card bodies. Rulebook text, identical for every seat at the table. */
  readonly conspiracyCards: Readonly<Record<CardID, ConspiracyCard>>;
};

/**
 * Build a seat's `SeatKnowledge` from authoritative state.
 *
 * READS EXACTLY ONE PLAYER'S HAND, and the shape is the guarantee: the only state
 * read is `state.players[me]`, chosen by the caller's own `me`. There is no second
 * parameter through which another seat could be named, so "the driver read a hidden
 * hand" cannot be reintroduced by accident — it has to be written.
 *
 * Throws on an unknown seat rather than returning an empty hand, because an empty
 * hand here means "decline", and a typo would produce a sweep with no answers in it
 * that still passes.
 */
export function ownKnowledge(state: GameState, me: PlayerID, cards: CardIndex): SeatKnowledge {
  const self = state.players[me];
  if (self === undefined) throw new Error(`ownKnowledge: ${me} is not a seat`);
  return { ownConspiracies: self.conspiracies, conspiracyCards: cards.conspiracy };
}

/** Is a card's `interrupt` one this engine actually acts on? Mirrors `isReactive`. */
function isReactiveOp(op: string): op is 'block' | 'deflect' {
  return op === 'block' || op === 'deflect';
}

/**
 * `mayRespond` again, from the engine — the card's own two fields plus the phase.
 *
 * Both inputs are public: `phase` is on the projection, and `'card-affecting-you'`
 * resolves through `reachesPastActor` over `w.effects`, which are the effects of a
 * card that is already face up.
 */
function mayAnswer(view: ClientState, card: ConspiracyCard): boolean {
  const interrupt = card.interrupt;
  if (interrupt === undefined) return false;
  if (!isReactiveOp(interrupt.op)) return false;
  if (interrupt.window === 'pre-answer' && view.phase !== 'answer') return false;
  if (interrupt.target === 'card-affecting-you') {
    const reachesPastActor = (view.interrupt?.effects ?? []).some(
      (e) => 'target' in e && e.target !== undefined && e.target !== 'you',
    );
    if (!reachesPastActor) return false;
  }
  return true;
}

/**
 * The seat's own choice of card to answer the window with, or `null` to decline.
 *
 * PREFERENCE IS BLOCK, THEN DEFLECT, and the ordering is not tidiness: a BLOCK
 * needs no target and cannot be refused for a missing one, so a hand holding both
 * answers with the BLOCK, and a hand holding only a DEFLECT uses `at`. Determinism
 * also means the same game replays the same way, which the room's action log
 * depends on.
 *
 * DEFLECT's TARGET is the first seat in `turnOrder` that is neither the responder
 * nor the actor, which is exactly what `RESPOND_INTERRUPT` allows (`at === w.actor`
 * and `at === playerId` are both refused). **At two seats that set is empty**, so a
 * two-player table cannot answer with a DEFLECT at all — not a driver limitation
 * but the printed rule meeting the smallest possible table. It is measured in
 * `./interrupt-window.test.ts` rather than papered over.
 */
export function reactiveAnswer(
  view: ClientState,
  me: PlayerID,
  knowledge: SeatKnowledge | undefined,
): Extract<Action, { type: 'RESPOND_INTERRUPT' }> | null {
  const w = view.interrupt;
  if (w === null || knowledge === undefined) return null;
  if (w.actor === me || w.responder !== null) return null;

  const inHand = knowledge.ownConspiracies
    .map((id) => knowledge.conspiracyCards[id])
    .filter((c): c is ConspiracyCard => c !== undefined && mayAnswer(view, c));

  const block = inHand.find((c) => c.interrupt?.op === 'block');
  if (block !== undefined) return { type: 'RESPOND_INTERRUPT', cardId: block.id };

  const deflect = inHand.find((c) => c.interrupt?.op === 'deflect');
  if (deflect === undefined) return null;
  const target = view.turnOrder.find((p) => p !== me && p !== w.actor);
  if (target === undefined) return null; // no third player: a DEFLECT has nowhere to go
  return { type: 'RESPOND_INTERRUPT', cardId: deflect.id, at: target };
}

/**
 * Which side of the pending Ideology Card to answer.
 *
 * ALWAYS THE LEFT LABEL, and that is not a simplification — it is the point.
 *
 * `ANSWER` takes the DISPLAY index the player was shown, and the room remaps it to
 * the card's own `sides` tuple, so the client never learns which real side it picked.
 * A driver that wants to pick the better-paying side has to read the card off the
 * authoritative state, which means reading the pending-card id — a server-only field
 * the server's own secrets gate forbids any test but the leak suite from naming.
 *
 * So the gate is right and the driver is wrong. Choosing the side by its payout was
 * never something a player can do: the two labels are all they get, and the payout
 * is what the blind is hiding. "Always answer the left label" is what a player with
 * no private information does, so the winnability claim below is now a claim about
 * the game as a client experiences it rather than one that peeks.
 *
 * The `cards` / `pendingCardId` parameters this function used to take are GONE, and
 * their absence is the assertion. They are not defaulted and not threaded through:
 * a defaulted parameter is one `undefined` away from being passed again, and a
 * re-introduced peek would be invisible in every caller.
 */
export function answerSide(): 0 | 1 {
  return 0;
}

/**
 * Pick a legal action from an authoritative view of the table, for `me`.
 *
 * `view` is the projection the SEAT would be sent, so a decision this function
 * makes is one the seat could have made. There is no longer an `opts` escape hatch,
 * and that is deliberate — see `answerSide`, which used to be where one lived.
 *
 * `knowledge` is the ONE thing the projection cannot supply: whether this seat holds
 * a reactive card. Omit it and the driver still handles a window correctly — it
 * declines — because declining is always legal and always closes. Pass
 * `ownKnowledge(state, me, cards)` and it will answer when it legally can.
 *
 * Returns `null` only when the table is finished, it is somebody else's move, or a
 * window is open and it is not this seat's moment in it. A driver that returns
 * `null` for a seat that IS on move is a driver bug, and the callers turn that into
 * a thrown error rather than a skip.
 */
export function nextAction(view: ClientState, me: PlayerID, knowledge?: SeatKnowledge): Action | null {
  if (view.finished) return null;

  // Choices are resolved BEFORE turn order, and that ordering is the whole point of
  // `PendingChoice` being the engine's out-of-turn decision channel. A player with
  // an unresolved decision must act even when it is not their turn, and the engine
  // refuses everything else for them until they do.
  //
  // Which is also why this arm comes FIRST of the two "someone else must act" rules:
  // `reduce` leaves `RESOLVE_CHOICE` legal during a window precisely so a player
  // frozen by p12 can thaw, and a frozen seat is excluded from `requiredDecliners`
  // anyway, so the two rules cannot disagree about this seat.
  const mine = view.choices.find((c) => c.player === me);
  if (mine !== undefined) {
    const pick = pickForChoice(view, mine);
    if (pick === null) {
      throw new Error(`no legal pick for choice ${mine.id} (${mine.choice.kind})`);
    }
    return { type: 'RESOLVE_CHOICE', choiceId: mine.id, pick };
  }

  // G13 — an open window freezes the whole table, so this is the next thing after
  // choices and BEFORE anything turn-shaped.
  //
  // `view.interrupt !== null` means EVERY action except `RESPOND_INTERRUPT`,
  // `PASS_INTERRUPT` and `RESOLVE_CHOICE` is refused, so returning an ordinary
  // play here is returning a guaranteed refusal — which is precisely how this
  // driver used to stall on any game whose deck held a BLOCK.
  //
  // When it is not this seat's moment, the answer is `null` rather than a doomed
  // action, so the caller advances to the seat `windowResponder` names instead of
  // firing at the table and being refused.
  if (view.interrupt !== null) {
    if (windowResponder(view) !== me) return null;
    return reactiveAnswer(view, me, knowledge) ?? { type: 'PASS_INTERRUPT' };
  }

  if (view.activePlayer !== me) return null;
  if (view.phase === 'answer') {
    return { type: 'ANSWER', side: answerSide() };
  }
  if (view.phase === 'headlines') return { type: 'ACK_HEADLINE' };
  if (view.phase !== 'actions') return null;

  const pool = view.players[me]?.resources;
  if (pool === undefined) return null;

  // `canAfford` is PER-POOL, not against the total: a card costing 1 Fund is not
  // affordable for a player holding 0 Funds and 4 Clout, and the reducer is right
  // to refuse it.
  const affordable = (cost: Readonly<Record<string, number>>): boolean =>
    POOLS.every((r) => (pool[r] ?? 0) >= (cost[r] ?? 0));

  // Place what is already in hand BEFORE buying more. p10 discards unplaced voters
  // at end of turn, so buying first spends money on voters that may not fit
  // anywhere.
  const group = view.players[me]?.pending[0];
  if (group !== undefined) {
    const zone = targetZone(view, me, group.count);
    if (zone !== null) {
      const free =
        view.zones.find((z) => z.id === zone)?.areas.filter((a) => a.peg === null).map((a) => a.id) ?? [];
      if (free.length >= group.count) {
        return { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) };
      }
    }
  }

  // Buy the best voters-per-resource card that a winnable zone can still take.
  const slots = view.market
    .map((slot, i) => ({ slot, i }))
    .sort((a, b) => value(b.slot) - value(a.slot));
  for (const { slot, i } of slots) {
    if (!affordable(slot.cost)) continue;
    if (targetZone(view, me, slot.voters) === null) continue;
    return { type: 'INFLUENCE', slot: i };
  }

  return { type: 'END_TURN' };
}

/** Voters bought per resource spent. Bigger is a better use of the turn. */
function value(slot: { readonly cost: Readonly<Record<string, number>>; readonly voters: number }): number {
  return slot.voters / Math.max(1, sum(slot.cost));
}

/**
 * Endgame squeeze: buy a card that fits, when no card on the Mat can be won with.
 *
 * Once the board is down to its last few slots, no Voter Card with two or three
 * voters can be placed at all, because p10 forbids splitting a card's voters
 * across zones. The table deadlocks on cards the driver cannot use. p10 also says
 * unplaced voters are discarded at end of turn, so buying one we cannot place is
 * legal and cycles the Mat until a card that fits comes up — which is what a human
 * does. Bounded, so a genuine livelock still fails rather than spinning.
 */
export function shouldSqueeze(view: ClientState, me: PlayerID): boolean {
  const pool = view.players[me]?.resources;
  if (pool === undefined) return false;
  if (targetZone(view, me, 1) !== null) return false; // there is somewhere worth it
  return view.market.some((slot) => POOLS.every((r) => (pool[r] ?? 0) >= (slot.cost[r] ?? 0)));
}

// ─────────────────────────── the in-process runner ───────────────────────────

/**
 * Play a whole game in process, driving the SAME `nextAction` the socket tests use.
 *
 * Three reasons this is not a second driver. It keeps one set of decisions under
 * test — a competence fix and a winnability fix measured on the socket are the same
 * competence fix measured in process — and it makes a seed sweep affordable, which
 * is what turns "this seed wins" into "wins across a range".
 *
 * It reads each seat's own projection via `playerView`, exactly as the room does, so
 * a decision here is one the seat could have made. The single piece of operator-side
 * information it passes at all is `ownKnowledge(state, seat, cards)` for the seat it
 * is currently acting for — that seat's OWN hand. See the G13 note in the header for
 * why that is a separate input and not a read of the projection.
 *
 * `knowOwnHand: false` reproduces the pure-client driver, which is what the
 * decline-only termination claim is measured on: a table whose seats know nothing
 * still has to close every window, and declining is the only move it has.
 */
export function playInProcess(
  start: GameState,
  ctx: Ctx,
  opts: { readonly maxActions?: number; readonly maxSqueezes?: number; readonly knowOwnHand?: boolean } = {},
): RunResult {
  const maxActions = opts.maxActions ?? 1200;
  const maxSqueezes = opts.maxSqueezes ?? 80;
  const knowOwnHand = opts.knowOwnHand ?? true;

  let state = start;
  let actions = 0;
  let squeezes = 0;
  let stuckTurn = 0;
  const refusals: string[] = [];
  const choiceKinds = new Set<string>();
  const windows = emptyTally();

  /** The knowledge for a seat, or `undefined` for a client that cannot know. */
  const knowledgeFor = (seat: PlayerID): SeatKnowledge | undefined =>
    knowOwnHand ? ownKnowledge(state, seat, ctx.cards) : undefined;

  const done = (): RunResult => ({
    state,
    actions,
    finished: state.finished,
    stalled: !state.finished,
    reason: state.finished ? null : 'unfinished',
    refusals,
    choiceKinds,
    // Computed HERE rather than tracked, so it cannot drift from the final state:
    // a window that never closed shows up as a count, not as a missing assertion.
    windows: { ...windows, unclosedAtEnd: state.interrupt === null ? 0 : 1 },
  });

  while (!state.finished) {
    if (actions >= maxActions) {
      return { ...done(), reason: `budget: ${maxActions} actions` };
    }

    // 1. Any open decision, whoever owns it, first.
    const open = state.choices[0];
    if (open !== undefined) {
      choiceKinds.add(open.choice.kind);
      const action = nextAction(playerView(state, open.player), open.player);
      if (action === null) {
        return { ...done(), reason: `no action for open choice ${open.choice.kind}` };
      }
      const r = reduce(state, open.player, action, ctx);
      if (!r.ok) {
        return { ...done(), reason: `choice refused: ${r.error}` };
      }
      state = r.state;
      actions += 1;
      continue;
    }

    // 2. An open response window, for the ONE seat the table is waiting on.
    //
    //    Placed above every turn-shaped rule and below the choices for two reasons.
    //    Above: `reduce` refuses everything else while a window is open, so asking
    //    the active player for a move here produces a refusal and nothing else.
    //    Below the choices: `RESOLVE_CHOICE` stays legal during a window precisely so
    //    a frozen player can thaw, and a frozen seat is excluded from the required
    //    set anyway — but the choice really does need answering before the table can
    //    move, and p12's cap is a per-player freeze, not a table one.
    const openWindow = state.interrupt;
    if (openWindow !== null) {
      windows.opened.add(openWindow.id);
      const seat = windowResponder(playerView(state, state.activePlayer));
      if (seat === null) {
        // Every required seat has declined and the reducer has not closed it, or the
        // window was already answered. Either way the table is stuck with a window
        // open, which is the exact hang this suite exists to rule out.
        return { ...done(), reason: `window ${openWindow.id} is open but no seat owes a response` };
      }
      const action = nextAction(playerView(state, seat), seat, knowledgeFor(seat));
      if (action === null) {
        return { ...done(), reason: `no action for window ${openWindow.id} with ${seat} on the hook` };
      }
      const r = reduce(state, seat, action, ctx);
      if (!r.ok) {
        return { ...done(), reason: `window ${openWindow.id} refused ${action.type} for ${seat}: ${r.error}` };
      }
      if (action.type === 'RESPOND_INTERRUPT') windows.answered += 1;
      if (action.type === 'PASS_INTERRUPT') windows.declined += 1;
      if (r.state.interrupt === null) {
        windows.closed += 1;
        if (action.type === 'RESPOND_INTERRUPT') windows.closedByAnswer += 1;
        if (action.type === 'PASS_INTERRUPT') windows.closedByAllDeclines += 1;
      }
      state = r.state;
      actions += 1;
      continue;
    }

    const p = state.activePlayer;
    const view = playerView(state, p);

    // 3. The endgame squeeze, before the ordinary buy. It only fires when
    //    `nextAction` would otherwise have nothing worth buying, so it cannot
    //    pre-empt a real purchase.
    if (view.phase === 'actions' && squeezes < maxSqueezes && shouldSqueeze(view, p)) {
      const cheap = view.market
        .map((slot, i) => ({ slot, i }))
        .filter(({ slot }) => POOLS.every((r) => (view.players[p]?.resources[r] ?? 0) >= (slot.cost[r] ?? 0)))
        .sort((a, b) => value(a.slot) - value(b.slot))[0];
      if (cheap !== undefined) {
        const r = reduce(state, p, { type: 'INFLUENCE', slot: cheap.i }, ctx);
        if (r.ok) {
          // p10: a card that cannot be placed is discarded at end of turn, which
          // is what cycles the Mat. Place it if it fits anywhere first — and in the
          // squeeze "anywhere" really does mean anywhere, because the point of the
          // squeeze is to drive the board to p20's board-full ending.
          const after = playerView(r.state, p);
          const group = after.players[p]?.pending.at(-1);
          const zone = group === undefined ? null : targetZone(after, p, group.count);
          if (group !== undefined && zone !== null) {
            const free = after.zones.find((z) => z.id === zone)?.areas.filter((a) => a.peg === null).map((a) => a.id) ?? [];
            if (free.length >= group.count) {
              const placed = reduce(r.state, p, { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) }, ctx);
              if (placed.ok) {
                state = placed.state;
                actions += 2;
                squeezes += 1;
                continue;
              }
            }
          }
          state = r.state;
          actions += 1;
          squeezes += 1;
          continue;
        }
      }
    }

    const action = nextAction(view, p);
    if (action === null) {
      return { ...done(), reason: `no legal action in phase ${view.phase}` };
    }

    const r = reduce(state, p, action, ctx);
    if (!r.ok) {
      refusals.push(r.error);
      // A stall detector, not an excuse to skip. Two identical refusals in a row at
      // the same turn means the driver and the reducer disagree, and that is a bug
      // worth failing on rather than looping past.
      stuckTurn = state.turn === stuckTurn ? stuckTurn + 1 : 0;
      if (stuckTurn >= 2) {
        return { ...done(), reason: `refused twice at turn ${state.turn}: ${r.error}` };
      }
      return { ...done(), reason: `refused: ${r.error}` };
    }
    state = r.state;
    actions += 1;
  }

  return done();
}

/**
 * What a run observed about the response windows it played through.
 *
 * The claim the G13 tests need is not "a window opened" but "a window CLOSED, and
 * the table kept going". `closed` is therefore counted separately from `opened`, and
 * `unclosedAtEnd` is the number that must be zero for a run that reports `finished`
 * — a window still open when the game ends is the stall this whole mechanism
 * exists to prevent.
 *
 * `answered` versus `declined` matters because a driver that only ever declines
 * proves termination but proves nothing about responding. A run with
 * `answered > 0` exercised the real path.
 */
/** The mutable accumulator a run fills in. The exported `WindowStats` is a snapshot. */
type WindowTally = {
  opened: Set<string>;
  closed: number;
  closedByAnswer: number;
  closedByAllDeclines: number;
  answered: number;
  declined: number;
};

function emptyTally(): WindowTally {
  return {
    opened: new Set<string>(),
    closed: 0,
    closedByAnswer: 0,
    closedByAllDeclines: 0,
    answered: 0,
    declined: 0,
  };
}

export type WindowStats = {
  /** Every window id this run saw open, for the "each closed exactly once" claim. */
  readonly opened: ReadonlySet<string>;
  readonly closed: number;
  /** Closed by someone spending a reactive card, not by everyone declining. */
  readonly closedByAnswer: number;
  /** Closed by every required seat declining — the termination path. */
  readonly closedByAllDeclines: number;
  readonly answered: number;
  readonly declined: number;
  /** Windows still open when the run ended. Must be 0 for a run that finished. */
  readonly unclosedAtEnd: number;
};

export function emptyWindowStats(): WindowStats {
  return { ...emptyTally(), unclosedAtEnd: 0 };
}

export type RunResult = {
  readonly state: GameState;
  readonly actions: number;
  readonly finished: boolean;
  readonly stalled: boolean;
  readonly reason: string | null;
  readonly refusals: readonly string[];
  readonly choiceKinds: ReadonlySet<string>;
  readonly windows: WindowStats;
};

/** Deal a real-corpus game with `n` seats, exactly the way `lobby.ts` deals one. */
export function freshShippedCorpus(seed: number, n: number, ctx: Ctx): GameState {
  const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const names: Record<PlayerID, string> = {};
  for (const p of players) names[p] = p;
  return setup({ players, names, cards: ctx.cards, seed, ...decksOf(ctx.cards) });
}

/** Pegs on the board. 129 is a full board; 69 is enough for nine majorities. */
export function pegsOn(state: GameState): number {
  return state.zones.reduce((k, z) => k + z.areas.filter((a) => a.peg !== null).length, 0);
}

/** Zones holding a majority. Nine is a decided board by majority. */
export function majoritiesOn(state: GameState): number {
  return state.zones.filter((z) => z.majorityHolder !== null).length;
}
