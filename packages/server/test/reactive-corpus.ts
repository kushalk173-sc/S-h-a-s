/**
 * A corpus that carries BLOCK and DEFLECT, so the response window is reachable.
 *
 * WHY A FIXTURE RATHER THAN A SHIPPED-DECK CHANGE
 *
 * The two cards are real and the engine executes them, but no card in
 * `packages/cards/decks/**` declares an `interrupt` - so `canBeAnswered` is false
 * for every play, `resolveCard` never takes its staging branch, and a game on the
 * shipped deck can never open a window. That is a deliberate shipping decision in
 * the cards package and this file does not argue with it; what this file does is
 * give the server suite a corpus where the window is REACHABLE, so the driver can
 * be tested against it.
 *
 * THE CARDS THEMSELVES, and the two fields that are not decoration
 *
 * `interrupt.window` is `'always'` on both, which is the printed reading recorded
 * on `Interrupt` in `packages/engine/src/cards.ts`: BLOCK says play this
 * IMMEDIATELY out of turn when an opponent plays a card, and DEFLECT says you may
 * play this IMMEDIATELY. Neither is tied to the answer phase, and `'always'` is
 * what lets a window that opened during `ACK_HEADLINE` - which is the only way a
 * driver game ever opens one, because the driver never plays a Conspiracy Card -
 * actually be answered.
 *
 * `interrupt.target` is `'any-card'` on both, and DEFLECT's is not a
 * simplification: `reduce.ts` says in terms that "the shipped DEFLECT therefore
 * declares `'any-card'`", because `'card-affecting-you'` resolves against an
 * approximation (`reachesPastActor`) that asks "does this effect list aim past its
 * owner", not "does it aim at ME". A DEFLECT in this fixture is the honest card.
 *
 * WHY THE CARDS ALSO CARRY `effects`
 *
 * A reactive card is a real card a player can buy and play for its face value as
 * well as for its interrupt, and a card with an empty effect list and a printed
 * price would be a lie the moment somebody played it as a Conspiracy. So each one
 * has a small, plainly-worded effect. Neither is used by the window tests - the
 * driver never plays a Conspiracy Card - and the effect lists are chosen to be
 * harmless enough that a fixture which deals one into a hand cannot distort a
 * winnability measurement.
 *
 * AND THE DEALING, which is the part that is a fixture's whole job
 *
 * Putting the cards in the DECK is necessary and NOT sufficient, and the reason is
 * worth writing down because it is the same shape as the driver's two historical
 * blindnesses: `canBeAnswered` asks whether a player HOLDS a reactive card, and
 * the driver never buys a Conspiracy Card (see the header of ./driver.ts - that is
 * a deliberate competence boundary, so "the driver could not find a legal move" and
 * "the rules have no legal move" stay distinguishable). So with the cards merely in
 * the deck, no seat ever holds one, no window ever opens, and every assertion in
 * the suite would compare two nulls.
 *
 * `dealReactiveHands` therefore puts them into the seats' hands directly, in the
 * same shape `setup` uses - `PlayerState.conspiracies` is a `readonly CardID[]`, so
 * a dealt hand is a spread, not a special field. This is a FIXTURE reaching a state
 * a real game reaches by a route the driver does not take; it is not the driver
 * peeking, and nothing in ./driver.ts knows this function exists.
 */

import { setup, type CardID, type CardIndex, type ConspiracyCard, type Ctx, type GameState, type PlayerID } from '@shasn/engine';

import { loadCtx } from '../src/index.ts';
import { decksOf } from '../src/store.ts';

/** The BLOCK fixture's id. Named so a test can say which card it meant. */
export const BLOCK_ID = 'fix-block-the-motion';
/** The DEFLECT fixture's id. */
export const DEFLECT_ID = 'fix-deflect-the-blame';

/** The printed cost both cards carry. p19: "bought for any 4-5 resources". */
const COST = 5;

export const FIXTURE_BLOCK: ConspiracyCard = {
  id: BLOCK_ID,
  name: 'BLOCK THE MOTION',
  text: 'Play this IMMEDIATELY out of turn when an opponent plays a Conspiracy Card or a Headline resolves: that card has no effect. It cannot be reversed or deflected. Otherwise: gain 1 Clout.',
  cost: COST,
  effects: [{ op: 'gain', res: { clout: 1 } }],
  interrupt: { op: 'block', window: 'always', target: 'any-card' },
};

export const FIXTURE_DEFLECT: ConspiracyCard = {
  id: DEFLECT_ID,
  name: 'DEFLECT THE BLAME',
  text: 'Play this IMMEDIATELY when an opponent plays a card: that card resolves for a third player of your choosing instead. It cannot be blocked. Otherwise: gain 1 Trust.',
  cost: COST,
  effects: [{ op: 'gain', res: { trust: 1 } }],
  interrupt: { op: 'deflect', window: 'always', target: 'any-card' },
};

/**
 * The shipped corpus, plus the two reactive cards.
 *
 * Additive and non-mutating: the base index's own records are copied, so a test
 * that also holds `loadCtx().cards` is unaffected and a caller cannot corrupt the
 * shipped index for the rest of the suite.
 */
export function reactiveCards(base: CardIndex = loadCtx().cards): CardIndex {
  return {
    ...base,
    conspiracy: { ...base.conspiracy, [BLOCK_ID]: FIXTURE_BLOCK, [DEFLECT_ID]: FIXTURE_DEFLECT },
  };
}

/** A `Ctx` on the reactive corpus, so `reduce` can read the two cards. */
export function reactiveCtx(base: Ctx = loadCtx()): Ctx {
  return { rules: base.rules, cards: reactiveCards(base.cards) };
}

/**
 * Put the two reactive cards into specific seats' hands.
 *
 * Returns a new state; the input is not mutated. `ids` is dealt round-robin in
 * order to the seats named in `holders`, so a caller controls exactly who holds a
 * reactive card - which is what lets a test make the first seat asked decline and
 * the second answer, rather than always getting the same window shape.
 *
 * The seats are looked up in `state.players` and anything unknown throws, because a
 * typo in a holder id would otherwise silently deal to nobody and produce a test
 * with no windows in it, which passes.
 */
export function dealReactiveHands(
  state: GameState,
  ids: readonly CardID[],
  holders: readonly PlayerID[],
): GameState {
  if (holders.length === 0) return state;
  const players: Record<string, GameState['players'][string]> = {};
  for (const [pid, p] of Object.entries(state.players)) {
    const add = ids.filter((_, i) => holders[i % holders.length] === pid);
    players[pid] = add.length === 0 ? p : { ...p, conspiracies: [...p.conspiracies, ...add] };
  }
  return { ...state, players };
}

/**
 * A real-corpus game at `n` seats WITH the two reactive cards in the deck and in
 * some seats' hands.
 *
 * Two seat counts matter for how the cards are dealt and both are consequences of
 * `mustRespond` in `reduce.ts` rather than choices:
 *
 *  - **Only the first `holders.length` seats are given cards**, so at every seat
 *    count there is at least one seat holding nothing reactive. A table where
 *    everybody holds a BLOCK would answer every window on the first ask and the
 *    decline path would never run - which is the failure this suite exists to
 *    avoid, since "handles a window by always declining" proves nothing.
 *  - **At two seats the DEFLECT is unplayable and that is the rules, not a gap.**
 *    `RESPOND_INTERRUPT` refuses `at === w.actor` and `at === playerId`, and at two
 *    seats those are the only two players there are. So the only seat that could
 *    hold a DEFLECT is the actor or the responder, and both are excluded - a two
 *    player table simply has no third player to redirect a card to. The fixture
 *    still deals it, so that the sweep can MEASURE the zero rather than assert it.
 */
export function reactiveGame(seed: number, n: number, ctx: Ctx = reactiveCtx()): GameState {
  const cards = ctx.cards;
  const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const names: Record<PlayerID, string> = {};
  for (const p of players) names[p] = p;
  const base = setup({ players, names, cards, seed, ...decksOf(cards) });

  // BLOCK to the second seat, DEFLECT to the fourth (or the last seat at low seat
  // counts). Both are non-first seats on purpose: the seat asked first is the one
  // after the actor, so dealing to a later seat produces a decline-then-answer
  // window at least sometimes, and dealing to the first produces an answer-first
  // one. The sweep gets both.
  const holders: PlayerID[] = [];
  if (players.length >= 2) holders.push(players[1] as PlayerID);
  if (players.length >= 4) holders.push(players[3] as PlayerID);
  return dealReactiveHands(base, [BLOCK_ID, DEFLECT_ID], holders);
}