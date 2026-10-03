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
  type ChoiceScope,
  type ClientState,
  type ConspiracyCard,
  type Ctx,
  type Effect,
  type EffectTarget,
  type GameState,
  type InterruptWindow,
  type PendingChoice,
  type PlayerID,
  type Resource,
  type ZoneID,
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

/**
 * Non-Funds pegs a choice could legally take, most-contested first.
 *
 * `scope` is the CHOICE'S, not the driver's, and the distinction is load-bearing —
 * this function used to ignore it and only ever offer pegs the chooser did NOT own.
 * `reduce` computes `wanted = min(count, targetableCount(state, me, kind, scope))` and
 * `targetableCount` filters by scope too, so for `scope: 'any'` — which is what
 * `raiseVoterDecision` gives an `evict` the caster played at themselves — the ceiling
 * counts the chooser's OWN pegs while the pick did not offer any. A chooser holding
 * one peg against a 2-voter evict on a board with one opponent peg got
 * `wanted = 2` and a 1-area pick, and the engine answered `choose exactly 2` forever.
 * That is a hard lock reached through a driver bug, and it is the reason this
 * function takes the scope and the kind at all.
 */
function foreignAreas(
  s: ClientState,
  me: PlayerID,
  want: number,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
  scope: ChoiceScope | undefined,
  zoneId: ZoneID | undefined,
): readonly string[] {
  const out: string[] = [];
  for (const z of s.zones) {
    // G16. The constituency is the CARD's, already resolved by the time the decision
    // exists, and `reduce` refuses any pick outside it ("that voter is in another
    // zone"). Mirrored here clause for clause, like everything else in this function:
    // the driver picks from the set the engine will accept, not from the whole board.
    if (zoneId !== undefined && z.id !== zoneId) continue;
    for (const a of z.areas) {
      // A Volatile Area cannot be evicted or converted — p18.
      if (a.peg === null || a.volatile) continue;
      // Mirrors `targetableCount` in reduce.ts, clause for clause. Converting your own
      // voter into your own voter is not a conversion, so it is not a target either.
      if (scope === 'own' && a.peg.owner !== me) continue;
      if (scope === 'others' && a.peg.owner === me) continue;
      if (kind === 'convert-voter' && a.peg.owner === me) continue;
      out.push(a.id);
      if (out.length === want) return out;
    }
  }
  return out;
}

/**
 * Areas a choice could legally take, at the EXACT count the engine will demand.
 *
 * The clamp is `min(count, targetableCount(...))` and it is applied HERE rather than
 * left to fail: `reduce` refuses a pick of the wrong length outright, so a pick built
 * from the printed `count` is refused whenever the board offers fewer pegs. Offering
 * the empty list is not a cop-out either — it is the only legal answer to a zero-voter
 * ask, which is a real state (a card that evicted the last voter on the board).
 */
function areaPick(
  s: ClientState,
  me: PlayerID,
  count: number,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
  scope: ChoiceScope | undefined,
  zoneId: ZoneID | undefined,
): { kind: 'areas'; areaIds: string[] } {
  const usable = countableAreas(s, me, kind, scope, zoneId);
  const wanted = Math.min(count, usable);
  return { kind: 'areas', areaIds: [...foreignAreas(s, me, wanted, kind, scope, zoneId)] };
}

/** How many pegs satisfy the same filters `reduce`'s `targetableCount` applies. */
function countableAreas(
  s: ClientState,
  me: PlayerID,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
  scope: ChoiceScope | undefined,
  zoneId: ZoneID | undefined,
): number {
  let n = 0;
  for (const z of s.zones) {
    if (zoneId !== undefined && z.id !== zoneId) continue;
    for (const a of z.areas) {
      if (a.peg === null || a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== me) continue;
      if (scope === 'others' && a.peg.owner === me) continue;
      if (kind === 'convert-voter' && a.peg.owner === me) continue;
      n += 1;
    }
  }
  return n;
}

/**
 * A legal `steal-any` pick: a victim and exactly the resources the engine will credit.
 *
 * `fixed` is `choice.from`, and honouring it is the whole point. A card with a
 * `target` pins the victim at raise time — "take N from EVERY opponent" is only
 * writable that way — and `resolveChoice` then refuses any pick naming anybody else
 * with 'that is not the player you may take from'. This function used to walk
 * `turnOrder` and take the first seat with resources, which is a redirect of the theft
 * the engine will not accept.
 *
 * Two consequences worth stating, because both are silent-until-they-are-not:
 *
 *  - With a pinned victim, the victim is not a CHOICE. There is exactly one candidate
 *    and the driver either satisfies it or has no pick at all.
 *  - `want` may be ZERO, and that is a legal answer rather than a failure: the engine
 *    clamps to `min(count, poolTotal(victim))`, so a victim holding nothing is asked
 *    for nothing and an empty Delta resolves. Treating zero as "nothing to do" is what
 *    made this return `null` and throw `no legal pick` on a table it could have played.
 */
function stealable(
  s: ClientState,
  me: PlayerID,
  n: number,
  fixed: PlayerID | null,
): { from: PlayerID; res: Record<string, number> } | null {
  const candidates: readonly PlayerID[] =
    fixed !== null
      ? [fixed]
      : s.turnOrder.filter((id) => id !== me);
  for (const id of candidates) {
    if (id === me) continue; // the engine refuses a theft naming the chooser, always
    const victim = s.players[id];
    if (victim === undefined) continue;
    const want = Math.min(n, sum(victim.resources));
    // `want === 0` is legal: `deltaTotal({}) === 0 === want` and `canAfford` holds.
    const res = want === 0 ? {} : takeExactly(want, victim.resources);
    // The other half of what `reduce` checks: the pick must be affordable FOR THE
    // VICTIM, so a player cannot be drained below zero by a steal.
    const legal = (POOLS.every((r) => (res[r] ?? 0) <= (victim.resources[r] ?? 0))) && sum(res) === want;
    if (legal) return { from: id, res };
  }
  return null;
}

/**
 * The three ops that share the `zone` field and therefore the decision — a
 * transcription of `voterKindOf` in `reduce.ts`.
 *
 * The default is the engine's own, deliberately: `reduce.ts` maps anything it does
 * not recognise to `'discard-voter'`, so a fourth op growing `zone` lands here on
 * the same branch the engine uses rather than on a branch of its own.
 */
function voterKindOf(op: string): 'evict-voter' | 'discard-voter' | 'convert-voter' {
  if (op === 'evict') return 'evict-voter';
  if (op === 'convert-voter') return 'convert-voter';
  return 'discard-voter';
}

/**
 * The first constituency a `'choose-zone'` decision may name, or `null` for none.
 *
 * ## OFFERED == ACCEPTED, AND THAT IS THE WHOLE POINT
 *
 * `applyEffect` builds the candidate list with `legalZoneIds(state, source, effect)`
 * and `resolveChoice` validates the pick against the *same call*. So this function is
 * a transcription of that one predicate, clause for clause — the zone it returns is
 * inside the engine's accepted set by construction rather than by luck, which is what
 * lets a driver answer a decision it did not raise without a rollback loop.
 *
 * Two clauses are worth naming because they are the ones an approximation gets wrong:
 *
 *  - **The effect's `target` decides the scope.** `voterScope` is one expression over
 *    `(chooser, source, kind, target)`, and the `target: 'you'` case in particular is
 *    what makes CUT COPY AND PASTE's `discard-voter` offer the chooser's OWN pegs.
 *    A driver that used `'others'` for every voter op would offer a zone the server
 *    refuses. The `chooser !== source` arm of `voterScope` cannot fire here — a
 *    `'choose-zone'` decision is raised for the card's own actor, so chooser and
 *    source are the same seat by construction.
 *  - **A Volatile Area is not a peg this effect can name** (p18), exactly as in
 *    `targetableCount`, which is the other filter the pick is validated against.
 *
 * ## WHY THERE IS NO PREFERENCE AMONG THE LEGAL ZONES
 *
 * The engine offers a set, not a ranking, and `resolveChoice` accepts any member of
 * it — so the first legal zone is a legal answer and this driver does not invent a
 * strategy the rules do not contain. Same reasoning as `answerSide` below, and the
 * same honesty: the driver's competence lives in not placing voters it cannot win
 * with (`targetZone`), not in pretending to optimise an effect's damage.
 */
function legalZone(s: ClientState, me: PlayerID, effect: Effect | undefined): ZoneID | null {
  if (effect === undefined) return null;
  const named: EffectTarget | undefined = 'target' in effect ? effect.target : undefined;
  const kind = voterKindOf(effect.op);
  // `voterScope` with `chooser === source === me`: see the note above.
  const scope: ChoiceScope =
    kind === 'evict-voter' ? 'any' : kind === 'convert-voter' ? 'others' : named === 'you' ? 'own' : 'others';
  for (const z of s.zones) {
    const has = z.areas.some(
      (a) =>
        a.peg !== null &&
        !a.volatile &&
        !(scope === 'own' && a.peg.owner !== me) &&
        !(scope === 'others' && a.peg.owner === me) &&
        !(effect.op === 'convert-voter' && a.peg.owner === me),
    );
    if (has) return z.id;
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
      const hit = stealable(s, me, n, choice.choice.from);
      return hit === null ? null : { kind: 'steal', from: hit.from, res: hit.res };
    }
    case 'evict-voter':
      return areaPick(s, me, n, 'evict-voter', choice.choice.scope, choice.choice.zoneId);
    case 'discard-voter':
    case 'convert-voter':
      return areaPick(s, me, n, choice.choice.kind, choice.choice.scope, choice.choice.zoneId);
    /**
     * G1 — the card's actor named a player.
     *
     * **THE CANDIDATE SET IS `turnOrder` MINUS THE CHOOSER, AND IT IS NOT NARROWED BY
     * HOLDINGS.** That is the engine's own set (`applyEffect` raises the decision
     * exactly when `turnOrder.filter(p => p !== source)` is non-empty, and
     * `resolveChoice` validates the pick against that same expression), so the first
     * other seat is legal by construction and `null` is reachable only on a one-seat
     * table, which `Lobby` refuses to create.
     *
     * Filtering by holdings here — "name a seat that can actually be stolen from", say
     * — would be a leak dressed as competence, and it is the same leak the engine
     * declines to commit twice over. A filtered option list is a readout of every
     * opponent's mat and hand: the absence of a seat from the dialog tells the chooser
     * that seat holds nothing. The engine offers the whole table for exactly that
     * reason, and a driver that quietly re-narrows the list reports to the test what a
     * real chooser is not shown. Holding nothing is therefore still an OFFER, and the
     * driver names a seat whether or not there is anything there — a `steal-any`
     * against an empty victim is a legal zero-width answer, not a failure.
     *
     * **AND NO PREFERENCE IS EXPRESSED AMONG THE SEATS, WHICH WAS ALSO MEASURED.** The
     * obvious refinement is to name the seat a single voter can still win a
     * constituency with — `targetZone(view, them, 1) !== null` — and it does fix a real
     * seed: 5 players, seed 14, decline-only, which hands its free voters to the seats
     * that can use them and finishes at 370 actions where naming the first seat spent
     * 1200 and stalled with `south` one free area short. But it fills the board faster
     * and strands two other seeds at 4 players (3 and 16) on 114-119 of 129 pegs with a
     * full zone and no majority in it, which is a stalemate no purchase can fix. Trading
     * one seed for two is not a competence, so the driver names the first seat on the
     * table: the pick a table makes, and the one the engine's own driver makes.
     */
    case 'choose-player': {
      const first = s.turnOrder.find((p) => p !== me);
      return first === undefined ? null : { kind: 'player', id: first };
    }
    /**
     * G16 — the card's actor named a constituency. The set is `legalZone`'s, which is
     * `legalZoneIds` in `reduce.ts` transcribed, so the pick is in the engine's
     * accepted set rather than in one that happens to overlap it.
     */
    case 'choose-zone': {
      const zone = legalZone(s, me, choice.choice.effects[0]);
      return zone === null ? null : { kind: 'zone', zoneId: zone };
    }
    default:
      // Unreachable against a corpus the cards package has validated. Returning
      // `null` makes the caller throw with the kind in the message, which is the
      // right outcome: a new choice kind should FAIL LOUDLY rather than be
      // silently answered with an empty area list. That it did exactly this when
      // G1 and G16 landed — 35 failures, one message — is the guard working, not the
      // guard failing.
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
 *
 * ## AND WHAT A TIE IS NOT: a lead. Measured, and it did not pay.
 *
 * `mine + free >= majority` is a test about ONE seat, and two seats routinely pass it
 * at the same time, so the seat that moves second does not learn that the zone is dead
 * — it finds a zone it can still win and puts a peg into a race it is about to lose.
 * The shape that costs the game is measured: `north_west`, 11 areas, 6 for a majority,
 * finishing `p4 p4 p3 _ p3 p3 p1 p3 p1 p1 p1` — four for one seat, four for another,
 * one free, and no way for either to reach six. So ranking a zone this seat does not
 * LEAD below every zone it does is the obvious refinement.
 *
 * **IT WAS MEASURED AND IT IS NOT IN THE CODE.** It fixed nothing: the same
 * unwinnable-last-zone shape appeared in five of the 160 reactive-corpus games with
 * the refinement and four without, in different seeds. What it does do is perturb every
 * trajectory, so it buys a reshuffle of the same failure rather than an exit from it —
 * which is the signature of a fix aimed at the symptom. It is recorded here because
 * the next person to read `mine + free >= majority` will have the same idea.
 *
 * The same goes for ranking by FEWEST FREE AREAS — "a zone one placement from a majority
 * is worth more than a zone with room", which is true and which made things worse: 3
 * players went from a 392-action maximum to 928 and a 241-turn maximum, and the failures
 * went from nine to ten. Deciding zones faster is not the same as being able to decide
 * the LAST one.
 *
 * **THE REAL CONSTRAINT, WHICH IS NOT IN THIS FUNCTION.** Once a zone satisfies
 * `max(mine) + free < majority` for every seat, no action in the driver's union can win
 * it: `PLACE_VOTERS` needs room, `INFLUENCE` needs a card, and there is no player action
 * that moves somebody else's peg. The board cannot fill either, so p20's timer ending is
 * unreachable and the game has no ending at all — `END_TURN` for 1200 actions. See
 * `./winnable.test.ts`, which is where that is asserted rather than absorbed.
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
    // A CONTESTED zone this seat can still LOSE needs a spare area, because every other
    // seat gets a turn before this seat does and `mine + free >= majority` is a test
    // about one seat at one moment.
    const rival = Math.max(
      0,
      ...s.turnOrder.filter((p) => p !== me).map((p) => z.areas.filter((a) => a.peg?.owner === p).length),
    );
    if (rival + free >= z.majority && mine + free - 1 < z.majority) continue;
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
  // to refuse it. The PRICE is `purchasePrice`'s, which is the printed cost plus
  // whatever this seat is being charged on top of it.
  const affordable = (cost: Readonly<Record<string, number>>): boolean => {
    const price = purchasePrice(view, me, cost);
    return price !== null && POOLS.every((r) => (pool[r] ?? 0) >= (price[r] ?? 0));
  };

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
/**
 * What a purchase of `cost` will ACTUALLY be charged to `me`, or `null` if this seat
 * may not buy at all.
 *
 * ## THE PRINTED COST IS NOT THE PRICE, AND THE DIFFERENCE IS A REFUSAL
 *
 * `reduce`'s `INFLUENCE` charges `applyDiscounts(slot.cost, …)` and then adds
 * `surchargeFor(state, playerId)` on top, so the printed cost is a LOWER bound and a
 * driver that checks only the printed cost will happily fire a purchase the reducer
 * refuses with `'you cannot afford that Voter Card'`. That is not a rare corner: PYTHONPOST
 * taxes every purchase in the table until it expires, and KHAKI TERROR refuses purchases
 * outright while a donation is still owed.
 *
 * `playInProcess` turns a refusal into `reason: 'refused: …'` and the run is reported as
 * a stall, which is the correct handling of a driver bug and not a way to live with one.
 * So the driver reads the two `Restriction`s that move a price — both of which are PUBLIC,
 * because `PlayerState.restrictions` is not in `PRIVATE_PLAYER_KEYS` and the projection
 * already carries every other live rule — and prices the card the way the reducer will.
 *
 * Discounts are deliberately NOT credited. Ignoring a discount makes the driver require
 * MORE than the engine demands, which is the safe direction for the same reason the
 * `stealable` clamp is: a pick the engine accepts is a pick that was always going to
 * work. Two cards that each tax you are SUMMED here, matching `surchargeFor`'s own
 * "which is what two cards means".
 */
export function purchasePrice(
  view: ClientState,
  me: PlayerID,
  cost: Readonly<Record<string, number>>,
): Record<string, number> | null {
  const self = view.players[me];
  if (self === undefined) return null;
  let surcharge = 0;
  for (const r of self.restrictions ?? []) {
    if (r.kind === 'no-purchases' && r.remaining > 0) return null;
    if (r.kind === 'surcharge') surcharge += Math.max(0, r.value);
  }
  if (surcharge === 0) return { ...cost };
  return { ...cost, funds: (cost.funds ?? 0) + surcharge };
}

export function shouldSqueeze(view: ClientState, me: PlayerID): boolean {
  const pool = view.players[me]?.resources;
  if (pool === undefined) return false;
  const affordable = (cost: Readonly<Record<string, number>>): boolean => {
    const price = purchasePrice(view, me, cost);
    return price !== null && POOLS.every((r) => (pool[r] ?? 0) >= (price[r] ?? 0));
  };
  const slots = view.market.filter((slot) => affordable(slot.cost));
  if (slots.length === 0) return false;
  // If ANY affordable card can be placed somewhere it can still win, buy it the
  // ordinary way and do not squeeze.
  //
  // This replaces `targetZone(view, me, 1) !== null`, which was the wrong question and
  // stranded a real seed. 2 players, seed 18: south and south_east each had exactly
  // ONE free area, so `targetZone(1)` was non-null and the driver sat on its hands
  // forever. But the Mat held no 1-voter card at all, so that one free area could
  // never be filled — and because `refillMarket` only runs off a PURCHASE, a Mat that
  // nobody buys from never changes. The table had no legal ending and no way to reach
  // one: turn 363, 111 of 129 pegs, 7 majorities, 1200 actions spent. A livelock, not
  // a hard lock, and the same "the game cannot end" shape the seed-11 note records.
  //
  // The old guard could not see it because it asked whether a ZONE was worth spending
  // in rather than whether a PURCHASE was available, and it fired far too eagerly when
  // it did fire — squeezing past a perfectly good 2-voter buy because no single-voter
  // zone existed. Asking the question the driver actually faces is both narrower and
  // sufficient.
  if (slots.some((slot) => targetZone(view, me, slot.voters) !== null)) return false;
  return true;
}

/**
 * THE PLY: which seat acts next, and what it does — for a driver that sends ONE action
 * at a time over a socket.
 *
 * `playInProcess` below cannot use this, because it also tallies windows and choice
 * kinds. The two socket drivers (`e2e.test.ts`, `winnable.test.ts`) are the ones that
 * need it, and they were the two that could not survive a window: each drove
 * `state.activePlayer` unconditionally, so a window whose seat on the hook was somebody
 * else left `nextAction` returning `null` and the run died on "no legal action". That is
 * what shipping BLOCK and DEFLECT exposed, measured over 60 seeds at 2 and 3 seats: 4 of
 * 120 runs opened a window and could not act in it. A seat reaches a reactive card
 * without buying one — `draw-conspiracy` puts Server Space's draw straight into a hand —
 * so this is roughly a 3% event per game, not a corner case.
 *
 * So the dispatch is here, in ONE place, in the same order `playInProcess` uses:
 *
 *  1. **an open decision, whoever owns it.** A frozen player cannot play and `reduce`
 *     refuses everything else for them, so this outranks turn order — and it outranks the
 *     window because `RESOLVE_CHOICE` is legal throughout a window, which is exactly what
 *     lets a p12-frozen player thaw instead of becoming a hostage.
 *  2. **an open response window**, for the ONE seat the table is waiting on.
 *  3. **the active player's own move**, with the endgame squeeze considered first.
 *
 * Read through `playerView` for every seat it picks, so a decision made here is one that
 * seat could have made — and so the answer to a window is derived from the projection,
 * which is the only place a client could get it from. No hand, and therefore no peek:
 * step 2 passes no `SeatKnowledge`, so the driver declines, which is what a real client
 * does.
 *
 * Throws rather than returning null. A driver that returns "I have nothing" for a seat
 * that IS on move is a driver bug, and every caller turns null into a skip; the
 * diagnostic names the phase, the window and the open decisions so the failure says which
 * of the three arms went wrong.
 */
export type DriverPly = { readonly seat: PlayerID; readonly view: ClientState; readonly action: Action };

export function driverPly(state: GameState): DriverPly {
  const choice = state.choices[0];
  const window = state.interrupt;

  let seat: PlayerID | null;
  if (choice !== undefined) seat = choice.player;
  else if (window === null) seat = state.activePlayer;
  else seat = windowResponder(playerView(state, state.activePlayer));

  if (seat === null || seat === undefined) {
    throw new Error(
      `window ${window?.id ?? 'none'} is open but no seat owes a response — ` +
        `turnOrder ${JSON.stringify(state.turnOrder)} passed ${JSON.stringify(window?.passed ?? [])}`,
    );
  }

  const view = playerView(state, seat);
  const arm: 'choice' | 'window' | 'turn' = choice !== undefined ? 'choice' : window !== null ? 'window' : 'turn';
  // The squeeze is the TURN arm only. In the other two the seat is not free to buy
  // anything — it owes a decision or a decline — and buying there is refused with
  // 'resolve "Resource cap" first' or '"<card>" is resolving'. Measured: a squeeze that
  // ignored that stalled 35 of 120 runs, every one of them on the cap refusal.
  const action =
    arm === 'turn' ? squeezeBuy(view, seat) ?? nextAction(view, seat) : nextAction(view, seat);
  if (action === null) {
    throw new Error(
      `no legal action for ${seat} on the ${arm} arm in phase ${state.phase} — ` +
        `choices=${JSON.stringify(state.choices.map((c) => `${c.player}:${c.choice.kind}`))} ` +
        `window=${window?.id ?? 'none'} pool=${JSON.stringify(view.players[seat]?.resources)}`,
    );
  }
  return { seat, view, action };
}

/**
 * The endgame squeeze, for a driver that drives ONE seat at a time.
 *
 * `playInProcess` has this as step 3 of its own loop; the socket drivers reach the same
 * decision through `driverPly`. They had no squeeze at all, and the cost was measured
 * rather than argued: over 60 seeds at 2 and 3 seats on the deck WITHOUT the reactive
 * cards, 6 of 120 runs ground to the 4000-action budget at 8 of 9 majorities with every
 * seat on `{funds 0, clout 0, media 12, trust 0}` — a Mat nobody can place on, which
 * p20's board-full ending can never resolve because the last free areas cannot be filled.
 * That is the same livelock `shouldSqueeze`'s own note records for 2 players seed 18, and
 * it predates this work.
 *
 * `null` means "do not squeeze": either the ordinary driver has a purchase worth making,
 * or there is nothing affordable on the Mat at all. The caller sends the buy and lets its
 * NEXT ply place the voters, because `nextAction` places a pending group before it buys
 * anything — so no second action is needed in the same ply, and the socket drivers do not
 * have to reimplement placement.
 */
function squeezeBuy(view: ClientState, me: PlayerID): { readonly type: 'INFLUENCE'; readonly slot: number } | null {
  if (view.phase !== 'actions') return null;
  if (!shouldSqueeze(view, me)) return null;
  const pool = view.players[me]?.resources;
  if (pool === undefined) return null;
  const affordable = view.market
    .map((slot, i) => ({ slot, i }))
    .filter(({ slot }) => POOLS.every((r) => (pool[r] ?? 0) >= (slot.cost[r] ?? 0)))
    .sort((a, b) => value(a.slot) - value(b.slot))[0];
  return affordable === undefined ? null : { type: 'INFLUENCE', slot: affordable.i };
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
        .filter(({ slot }) => {
          // The same price `nextAction` would charge, for the same reason: a squeeze
          // that fires a purchase the reducer refuses is a stall, not a squeeze.
          const price = purchasePrice(view, p, slot.cost);
          return price !== null && POOLS.every((r) => (view.players[p]?.resources[r] ?? 0) >= (price[r] ?? 0));
        })
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
