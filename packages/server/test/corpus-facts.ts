/**
 * THE CORPUS FACTS, DERIVED. Nothing in here is a number somebody typed.
 *
 * WHY THIS FILE EXISTS, and the failure it is the answer to
 *
 * The suite used to carry the shipped deck's sizes as literals (`SHIPPED`), and every
 * time the corpus grew — 118 cards, then 122, then the conspiracy additions — those
 * literals went red. Two of the numbers were then "fixed" by arithmetic (22 -> 24,
 * measured against whatever the code happened to do) rather than by deriving them,
 * which is the worst outcome available: the test was made to agree with the code, so
 * it can no longer disagree with it.
 *
 * That is the same structural blindness the engine's own game-loop fixtures had, one
 * layer up. Those dealt 4000 synthetic Ideology Cards, so they could not reach the
 * bug where `ANSWER` never discarded the answered card and every game ended on turn
 * 52 with 0 of 9 zones decided. A fixture that pins a number instead of deriving it
 * cannot fail on the change it exists to catch — it can only fail on the day somebody
 * remembers to go and edit it, which is a different day from the one it is needed on.
 *
 * So every corpus fact lives here, computed from a `CardIndex` that is passed IN. Two
 * consequences, and both are the point:
 *
 *  1. `factsOf(loadCards())` is the shipped corpus, and every assertion in
 *     `corpus.test.ts` compares facts to other facts or to a RULE (p10's "1, 2 or 3
 *     voters"), never to a footprint. Adding a card moves these numbers and turns
 *     nothing red.
 *  2. `factsOf(<a bigger corpus>)` is equally valid, which is what makes the drift
 *     guard possible at all: `corpus-drift.test.ts` grows the corpus by a headline
 *     carrying an op no shipped headline uses — GENDER TROUBLE's `restrict` — and
 *     asserts that the whole invariant set still holds. That is the regression test
 *     for "shipping a card must not require editing a number in this suite".
 *
 * The one thing that is deliberately NOT here is a table of expected values. See
 * `corpusProblems()` for why the invariants are a function of the corpus rather than
 * a list of answers.
 */

import { setup, type CardIndex, type GameState } from '@shasn/engine';

import { decksOf } from '../src/store.ts';
import { bigCards } from './fixtures.ts';

/** The four decks `setup` deals, in the order the file has always named them. */
export const DECK_KINDS = ['ideology', 'voter', 'conspiracy', 'headline'] as const;
export type DeckKind = (typeof DECK_KINDS)[number];

/** p12: the four resource pools. Also the currencies an effect may pay in. */
export const POOLS = ['funds', 'clout', 'media', 'trust'] as const;

export type CorpusFacts = {
  /** What `decksOf` assembles — the deck a game is actually dealt. */
  readonly dealt: Readonly<Record<DeckKind, number>>;
  /** What the index holds, per kind. Equal to `dealt` unless a deck is hand-built. */
  readonly indexed: Readonly<Record<DeckKind, number>>;
  /** Distinct effect ops the shipped headlines use. */
  readonly headlineOps: ReadonlySet<string>;
  /** Distinct effect ops the shipped conspiracies use. */
  readonly conspiracyOps: ReadonlySet<string>;
  /** What an ANSWER pays, summed over both sides of every Ideology Card. */
  readonly answerPay: { readonly min: number; readonly max: number };
  /** Voter Cards: printed cost, printed voter count, and which pools are priced. */
  readonly voter: {
    readonly minCost: number;
    readonly maxCost: number;
    readonly totalVoters: number;
    /** The `voters` value of every card, in file order. p10's 1 / 2 / 3. */
    readonly sizes: readonly number[];
    /** Cards priced in each pool at all. */
    readonly pricedIn: Readonly<Record<string, number>>;
    /** Cards priced WITHOUT each pool — the soft-lock fixtures the driver needs. */
    readonly unpricedIn: Readonly<Record<string, number>>;
  };
};

function sumDelta(d: Readonly<Record<string, number | undefined>>): number {
  let total = 0;
  for (const v of Object.values(d)) total += v ?? 0;
  return total;
}

function opsOf(cards: CardIndex, kind: 'conspiracy' | 'headline'): Set<string> {
  const ops = new Set<string>();
  for (const card of Object.values(cards[kind])) {
    for (const e of card.effects) ops.add(e.op);
  }
  return ops;
}

/** Every corpus fact, measured off a `CardIndex`. No argument means the shipped one. */
export function factsOf(cards: CardIndex): CorpusFacts {
  const d = decksOf(cards);
  const pays: number[] = [];
  for (const c of Object.values(cards.ideology)) {
    for (const side of c.sides) pays.push(sumDelta(side.pays));
  }

  const costs = Object.values(cards.voter).map((v) => sumDelta(v.cost));
  const pricedIn: Record<string, number> = {};
  const unpricedIn: Record<string, number> = {};
  for (const pool of POOLS) {
    pricedIn[pool] = 0;
    unpricedIn[pool] = 0;
  }
  for (const v of Object.values(cards.voter)) {
    for (const pool of POOLS) {
      if ((v.cost[pool] ?? 0) > 0) pricedIn[pool] = (pricedIn[pool] ?? 0) + 1;
      else unpricedIn[pool] = (unpricedIn[pool] ?? 0) + 1;
    }
  }

  return {
    dealt: {
      ideology: d.ideologyDeck.length,
      voter: d.voterDeck.length,
      conspiracy: d.conspiracyDeck.length,
      headline: d.headlineDeck.length,
    },
    indexed: {
      ideology: Object.keys(cards.ideology).length,
      voter: Object.keys(cards.voter).length,
      conspiracy: Object.keys(cards.conspiracy).length,
      headline: Object.keys(cards.headline).length,
    },
    headlineOps: opsOf(cards, 'headline'),
    conspiracyOps: opsOf(cards, 'conspiracy'),
    answerPay: { min: Math.min(...pays), max: Math.max(...pays) },
    voter: {
      minCost: Math.min(...costs),
      maxCost: Math.max(...costs),
      totalVoters: Object.values(cards.voter).reduce((k, v) => k + v.voters, 0),
      sizes: Object.values(cards.voter).map((v) => v.voters),
      pricedIn,
      unpricedIn,
    },
  };
}

/**
 * THE BLAND FIXTURE'S OP VOCABULARY, measured rather than remembered.
 *
 * `bigCards()` is the synthetic corpus this suite used to play: every headline was
 * `gain media 1` and every conspiracy was `voters n: 1`. Its op count is therefore
 * the number the shipped corpus has to beat, and it is the honest comparison for
 * "the corpus is not inert" — it names the thing that actually happened rather than a
 * tally that drifts every time a card ships.
 *
 * Asserting `headlineOps.size > this` instead of `=== 12` also fixes the POLARITY.
 * The equality could only fail in one direction — a corpus that GAINED an op — and
 * gaining an op is the outcome this project wants; GENDER TROUBLE is unshippable
 * today for no reason other than that. A floor cannot punish progress.
 */
export function syntheticOps(): { readonly headline: number; readonly conspiracy: number } {
  const syn = bigCards();
  return { headline: opsOf(syn, 'headline').size, conspiracy: opsOf(syn, 'conspiracy').size };
}

/**
 * Ops a headline must carry, by NAME, because each one is a behaviour rather than a
 * count. This list is a floor — a new op cannot break it — and every entry earns its
 * place:
 *
 *  - `evict`         raises an `evict-voter` decision: choose areas, FREEZES a player.
 *  - `discard-voter` raises a `discard-voter` decision: same freeze, different pick.
 *  - `steal-any`     raises a `steal-any` decision: pick a player AND resources.
 *  - `lose-any`      "discard N resources of your choice" — the answer to a cap.
 *  - `voters`        places voters, which is how a headline reaches the board.
 *  - `gain`          a plain payout, i.e. a headline that does not open a decision.
 *
 * The first three are the ones the synthetic corpus NEVER produced, which is the whole
 * reason this file exists: a driver that cannot answer them deadlocks the table,
 * because `reduce` refuses every other action for a frozen player.
 */
export const REQUIRED_HEADLINE_OPS = ['evict', 'discard-voter', 'steal-any', 'lose-any', 'voters', 'gain'] as const;

/**
 * The board, measured off a real `setup` rather than quoted from p20.
 *
 * Not a corpus fact at all — the board is a rule — but it was pinned twice in this
 * suite by hand, in two files, which is how 69 and 129 came to disagree with each
 * other the first time somebody changed a zone. Deriving them from the engine's own
 * `setup` means there is exactly one copy and it cannot rot.
 */
export const BOARD = (() => {
  const cards = bigCards();
  const z = setup({
    players: ['p1', 'p2'],
    names: { p1: 'a', p2: 'b' },
    cards,
    seed: 1,
    ...decksOf(cards),
  });
  const areas = z.zones.reduce((k, zone) => k + zone.areas.length, 0);
  const majorityPegs = z.zones.reduce((k, zone) => k + zone.majority, 0);
  return { areas, majorityPegs, zones: z.zones.length } as const;
})();

// ─────────────────── the Ideology-deck claim, stated exactly ───────────────────

/**
 * WHY THE TURN-COUNT PROXY WAS REPLACED, AND WHAT REPLACED IT.
 *
 * Three files in this suite used to assert `game.turn > dealt.ideology` — "the game
 * outlasts its own deck" — on the reasoning that the Ideology deck is drawn one card per
 * turn, so a deck of N cards cannot reach turn N+1, and therefore passing the cliff is
 * proof that `ANSWER` discarded its card and the deck recycled. That was the shipped bug
 * (every game ended on turn 52 with 0 of 9 zones decided) and the proxy is a fair reading
 * of it.
 *
 * **It stopped being true when the corpus grew past the length of a game.** The shipped
 * Ideology deck is 76 cards and the driver finishes a shipped-corpus game between turn
 * 32 and turn 84, so at 2, 3 and 4 seats NO game reaches turn 77 and the proxy is
 * vacuously unmeetable — it had stopped asserting anything and started demanding a longer
 * game. Nothing about the engine had broken; the instrument had.
 *
 * The property it was a proxy for is exact, cheap, corpus-size independent, and already
 * visible in public data, so it is asserted directly instead:
 *
 *  - `advanceTurn` ends the match — `finished: true`, `phase: 'finished'` — the moment
 *    the Ideology deck AND its discard are both empty, logging `'The Ideology deck is
 *    exhausted.'` and scoring the board as it stands. So the exhaustion branch firing is
 *    precisely and only "the game ended because it ran out of cards", and the log line
 *    is public (`log` starts above the server-only block), so a client can see it too.
 *  - A game that reached NINE majorities therefore did not exhaust: the exhaustion branch
 *    cannot produce nine majorities, because it fires at the turn boundary with whatever
 *    is on the board.
 *
 * So `deckCliffComplaints` reports the exhaustion directly, and the deeper claim — that
 * the recycle fires when the deck IS the binding constraint — is left to
 * `packages/engine/test/card-transfer.test.ts`, which builds the short-deck position on
 * purpose. Three files asserting a number that depends on how long the driver chose to
 * play was one copy too many anyway.
 */

/** True when the match ended because the Ideology deck and its discard both ran out. */
export function exhaustedIdeologyDeck(state: GameState): boolean {
  return state.log.some((l) => l.text.includes('Ideology deck is exhausted'));
}

/**
 * Ideology Cards answered, counted from the PUBLIC log.
 *
 * `log` is public by design (the server-only block starts below it), and one Ideology
 * Card is drawn and answered per turn, so this is also the number of cards dealt. More
 * answers than the deck holds cards can only mean the deck recycled — which is the exact
 * claim the turn-count proxy was making, kept in the one form that does not depend on how
 * long the driver played.
 */
export function ideologyAnswers(state: GameState): number {
  return state.log.filter((l) => l.kind === 'answer').length;
}

/**
 * Every way a finished game can be said to have short-changed the Ideology deck, as a
 * list of human-readable violations. Empty is the pass, for the reason `corpusProblems`
 * gives: a list of violations is a relation between things the engine produced, so it is
 * true of this corpus and of every future one.
 *
 * Deliberately ONE entry, and deliberately not the positive claim. A game that answered
 * more Ideology Cards than the deck holds is proof the recycle fired, but whether any
 * game is long enough to need that is a property of the DRIVER, not of the engine — and
 * the engine's recycle is pinned where the deck really is the binding constraint, in
 * `packages/engine/test/card-transfer.test.ts`, which builds the short-deck position on
 * purpose. Putting the positive claim here would put it back on the hook of "how long
 * did the driver choose to play", which is what it was removed to stop depending on.
 */
export function deckCliffComplaints(state: GameState): string[] {
  if (exhaustedIdeologyDeck(state)) {
    return ['the game ended because the Ideology deck ran out rather than on a decided board'];
  }
  return [];
}

/**
 * Every corpus invariant this suite holds, as a list of human-readable violations.
 *
 * WHY A FUNCTION AND NOT A LIST OF ANSWERS: each entry is a RELATION between two
 * things the corpus or the rules produced, so it is true of the shipped corpus and of
 * every future one. `corpus.test.ts` asserts this list is empty (with per-invariant
 * `it()`s that say what each is FOR), and `corpus-drift.test.ts` asserts it is still
 * empty for a corpus with a card added. An expected-value table cannot do both.
 */
export function corpusProblems(f: CorpusFacts): string[] {
  const bad: string[] = [];
  const syn = syntheticOps();

  // The four decks are four separate card pools. An id in two of them is a card the
  // table can hold twice, and it would make `Object.keys(cards[k]).length` disagree
  // with what any one deck holds — the exact shape of the "hardcoded size said 26 and
  // the deck had 26" bug, one level down.
  for (const kind of DECK_KINDS) {
    if (f.dealt[kind] <= 0) bad.push(`the ${kind} deck is empty; a game cannot be dealt`);
    if (f.dealt[kind] !== f.indexed[kind]) {
      bad.push(`the ${kind} deck holds ${f.dealt[kind]} of ${f.indexed[kind]} indexed cards`);
    }
  }

  // p10: "Voter Cards can contain 1, 2 or 3 voters." A RULE, so a literal is the right
  // kind of expectation here — and it is the one that keeps a card with a typo'd
  // `voters: 4` out of the corpus rather than quietly making a zone unfinishable.
  //
  // The second half is the reason the OLD test pinned the exact 6/6/6 split, and it is
  // the half worth keeping: a zone with one slot left can only be finished by a card
  // that carries exactly one voter, and a zone with three slots left by one that
  // carries three. So the requirement is that ALL THREE exist — a floor over the
  // corpus, which no card addition can break and no card deletion should.
  for (const size of f.voter.sizes) {
    if (![1, 2, 3].includes(size)) bad.push(`a Voter Card prints ${size} voters; p10 allows 1, 2 or 3`);
  }
  for (const size of [1, 2, 3]) {
    if (!f.voter.sizes.includes(size)) {
      bad.push(`no Voter Card carries exactly ${size} voter${size === 1 ? '' : 's'}, so a zone with ${size} slot${size === 1 ? '' : 's'} left cannot be finished`);
    }
  }

  // THE ECONOMY HAS TO BE SPENDABLE, IN EVERY POOL. This is what the old "10 of 18
  // are priced with Funds" test was reaching for, and it is the same claim without the
  // footprint: for each pool there is a card that pool can buy and a card it cannot.
  //
  // The second half is the one that used to cost a debugging session. A cap-discard
  // rule that keeps a Funds-only reserve leaves a player holding
  // `{funds: 12, clout: 0, media: 0, trust: 0}` facing a Mat of
  // `media 3 / funds 2 + trust 2 / clout 2 + trust 1` — nothing it can buy, ever.
  // `discardKeepingReserve` holds a per-pool reserve for exactly that, and that rule
  // is untested against a corpus where every card is priced in every pool.
  for (const pool of POOLS) {
    if ((f.voter.pricedIn[pool] ?? 0) <= 0) bad.push(`no Voter Card is priced in ${pool}`);
    if ((f.voter.unpricedIn[pool] ?? 0) <= 0) bad.push(`every Voter Card is priced in ${pool}, so a ${pool}-only hand can never be stuck`);
  }

  // A turn's income has to be able to buy a turn's action, or the driver is spending
  // a resource it does not have and the whole winnability claim is about a game
  // nobody can play. Derived, not pinned: it compares the cheapest ANSWER against the
  // cheapest VOTER CARD.
  if (f.answerPay.min < f.voter.minCost) {
    bad.push(`the cheapest ANSWER pays ${f.answerPay.min}, less than the cheapest Voter Card costs ${f.voter.minCost}`);
  }

  // "THE CORPUS IS NOT INERT", stated as the comparison that means something: strictly
  // more of the effect vocabulary than the synthetic fixture that hid the blindness.
  if (f.headlineOps.size <= syn.headline) {
    bad.push(`the headlines use ${f.headlineOps.size} effect ops, no more than the synthetic fixture's ${syn.headline}`);
  }
  if (f.conspiracyOps.size <= syn.conspiracy) {
    bad.push(`the conspiracies use ${f.conspiracyOps.size} effect ops, no more than the synthetic fixture's ${syn.conspiracy}`);
  }

  // The named ops, which are behaviours rather than a tally. See the list's docstring
  // for why these six and why a floor.
  for (const op of REQUIRED_HEADLINE_OPS) {
    if (!f.headlineOps.has(op)) bad.push(`no shipped headline uses \`${op}\`; the corpus changed shape`);
  }

  // A payout in a currency the board does not use is a wasted turn, and a NEGATIVE one
  // is a card that takes resources a player does not have. `POOLS` is the rule, and it
  // is checked where the corpus is walked rather than here, because it needs the card
  // bodies; `corpus.test.ts` owns that walk and says why.
  return bad;
}
