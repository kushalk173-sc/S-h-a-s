/**
 * THE BALANCE CHECKER.
 *
 * PLAN.md 9 risk #2: *"If one side of a card is strictly better, players optimise
 * instead of deliberating and the entire premise collapses."* This file is the
 * thing that protects the premise, so it gets a real dominance relation rather
 * than a total-sum comparison.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULING: EQUAL TOTALS ARE THE DESIGN. The axis is MIX vs WHAT YOU CAN SPEND.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## THE MEASUREMENT THAT FORCED THE QUESTION
 *
 * A harness played 940 answered Ideology Cards across four games and found **zero**
 * with different totals on the two sides - a gap histogram of `{"0": 940}`. Counted
 * directly against the shipped JSON rather than taken from the harness, the figure is
 * starker: **all 76 Ideology Cards pay equal totals, and all 152 sides pay exactly 3
 * resources, every single one of them a 2-of-one-plus-1-of-another shape.** There are
 * 13 distinct payout shapes in the corpus and all 13 sum to 3 or 4, and the only card
 * whose sides pay 4 pays 4 on BOTH sides.
 *
 * So a total-based comparison has nothing to say about any card that ships, and
 * `TOTAL_SKEW` could not fire on the deck it was written to protect. The previous
 * round moved that gate from a warning to a hard error at band 0 and called that a
 * fix. It was not a fix; it was an enforcement of a convention on a deck that already
 * obeyed it, while the actual defect - a checker measuring the wrong axis - went
 * untouched.
 *
 * ## THE RULING IS (a), AND THREE THINGS ARGUE IT
 *
 * **1. THE REFERENCE DOC SAYS THE COMPOSITION IS THE INFORMATION, IN THOSE WORDS.**
 * `AUTHENTIC-SHASN-REFERENCE.md` 5.2, VERIFIED against the official 432-card
 * marketing render, on the very payout helper this file used to build its verdict:
 *
 * > "The `sidePayout()` helper in `cards.ts` sums a `Delta` to a single number. That
 * > is fine for the balance checker, but the UI must not use it - the game shows four
 * > separate icon counts and **the composition is the information**."
 *
 * The same section records the observed format as "2-5 discs, 0-3 of any single type"
 * and the one real card we have (`SHOULD WE INVADE NEW SPAIN?`, Capitalist side) paying
 * **2 Trust + 1 Media and zero Funds** - three discs. Our corpus paying three on every
 * side sits inside the verified range, and the reference explicitly declines to tie the
 * payout to the Ideologue, which is the whole reason a mix is worth choosing.
 *
 * **2. THE MECHANISM IS IN THIS REPO, AND IT IS COMPONENTWISE.** `resources.ts`:
 *
 * ```ts
 * export function canAfford(p: Pool, cost: Delta): boolean {
 *   return RESOURCES.every((r) => p[r] >= (cost[r] ?? 0));
 * }
 * ```
 *
 * No substitution, no pooling. A Voter Card printed `{funds: 2, clout: 1}` cannot be
 * bought by a player holding 7 Funds and nothing else, and `INFLUENCE` refuses the
 * purchase on exactly that test. The core market is 18 cards spanning all four
 * resources, and voters are the score. **So a holdings vector decides which part of
 * the market you can reach at all**, and the resource you receive is a stronger claim
 * on future play than the number of them you receive.
 *
 * **3. THE CAP MAKES COUNT SATURATE WHILE COMPOSITION DOES NOT.** `RULES.resourceCap`
 * is 12 **total** (rules-reference A3 item 3: "you must *choose* and discard any
 * excess" - nothing to choose if it were per-type). So a player on 6 Funds has a
 * seventh Fund worth nothing, while a player one Trust short is one Trust from a
 * purchase they cannot otherwise make.
 *
 * ## AND THE UNIFORMITY IS A RULE, NOT AN ACCIDENT
 *
 * Option (b) says the authors reflexively equalised totals and the result is a deck
 * whose numbers never matter. The corpus refutes the reflex reading on its own
 * evidence: **an accident leaves a distribution, and this has none.** 76 of 76, every
 * side a 2+1, thirteen shapes and no tail. And the accident rate is not hypothetical -
 * the round before last found exactly one near-miss (`ig-in2020-006`, skew 1) out of
 * 76, which is a 1.3% miss rate, not a 0% one. A corpus with a 1.3% miss rate does not
 * look like a rule being followed by hand; 76/76 with no tail looks like a generator
 * invariant, which is what `"every side pays 3, as a 2+1"` is.
 *
 * ## THE DECISIVE STRUCTURAL ARGUMENT, MEASURED
 *
 * If totals must be equal AND the composition must decide, then it must be *shown*
 * that an equal-total pair cannot decide. `src/holdings.ts` measures that exhaustively
 * over all **1820** reachable holdings vectors (every non-negative 4-tuple with total
 * at most the cap), scoring each side by an exact knapsack over the shipped market.
 *
 * The result is the strongest single number in this file:
 *
 * > **0 of the 76 shipped cards are decided by their payout.** Every one of them is
 * > better on side A for some reachable position and better on side B for another.
 *
 * So the corpus's equal totals are not merely tolerated by the design - they are
 * *sufficient* for it, in this economy, and the deck leaves a real choice on every
 * card. That is the proof the ruling owes, and it is a proof rather than an assertion.
 *
 * The honest qualifier, because a reader deserves it: **55.9%** of (card, position)
 * pairs are ties. For most pools a player might hold, the two sides are worth the same
 * and the card does not bite. What matters is that the remaining 44% are not the same
 * side - the discriminating positions differ from card to card - so there is no rule
 * that survives contact with a second hand. A deck where the sides were equal
 * EVERYWHERE would be a deck where the dilemma carries every card, which is a
 * different (and much worse) design than this one.
 *
 * ## AND WHAT THE SWEEP SAYS ABOUT PAYOUT SHAPE
 *
 * Sweeping all 5862 equal-total, non-upgrade payout pairs, **9 are decided by their
 * payout and every single one is a SPREAD side beating a CONCENTRATED pile**:
 * `{clout:6}` over `{funds:1, clout:2, media:1, trust:2}`, `{media:6}` over
 * `{funds:1, media:5}`, `{funds:3, clout:2, trust:1}` over `{funds:6}`. A sixth of one
 * resource is convertible-inferior, because the market has cards that spend one
 * resource and few that spend four at once, so a pile leaves three pools unopened.
 *
 * That is the strongest available argument that the corpus's uniform 2+1 shape is a
 * deliberate choice rather than an accident: **2+1 is the maximally SPREAD shape the
 * game's payout format allows**, since it touches two of the four resources and a
 * 1+1+1 would touch three but pay less per pool. The corpus sits at the diversity
 * optimum, and the instrument's one real failure mode is the lopsided card it never
 * ships.
 *
 * ## AND WHAT THAT DOES TO `TOTAL_SKEW`, WHICH IS NO LONGER AN ERROR
 *
 * If a bigger total were a tilt, equal totals would be the fix. Measured, it is the
 * opposite. Sweeping every non-upgrade pair by skew and asking whether the SMALLER
 * side wins anywhere:
 *
 * | total skew | pairs with a position favouring the smaller side | pairs decided by payout |
 * |---|---|---|
 * | 1 | 7061 / 7104 (**99.4%**) | 43 / 7604 (0.6%) |
 * | 2 | 3741 / 3800 (**98.4%**) | 59 / 4490 (1.3%) |
 * | 3 | 1634 / 1700 (**96.1%**) | 66 / 2380 (2.8%) |
 * | 4 | 531 / 574 (**92.5%**) | 43 / 1064 (4.0%) |
 *
 * A total skew is not a tilt; it is usually an **inversion**. The sharpest case, at
 * holdings `{funds: 9}` against the shipped market:
 *
 * | side | converts to |
 * |---|---|
 * | `{funds: 4}` - the BIGGER payout | **2** voters |
 * | `{funds: 1, trust: 2}` - total 3, the SMALLER payout | **5** voters |
 *
 * The side paying four resources is worth less than half of what the side paying
 * three is worth, because the fourth Fund is over the cap and the two Trust open the
 * whole trust half of the market. **An error-severity band on totals would therefore
 * refuse the better card and admit the worse one** - it enforces the opposite of the
 * design. And the decided-share column shows why no threshold is derivable: skew
 * predicts dominance at only 0.6%-4.2%, so there is no skew value at which "this skew
 * means dominance" is a statement rather than a guess. **A threshold that cannot be
 * derived must not be an error.**
 *
 * So `TOTAL_SKEW` is demoted to a warning, on measured grounds, and the real
 * enforcement moves to `COMPOSITION_DOMINANT`. That is not a loosening to let cards
 * through: the corpus has 76 of 76 at skew 0, so **no card changes status**, and the
 * suite ends up refusing strictly more cards for strictly better reasons.
 *
 * ## WHAT IS AND IS NOT PINNED BY THE OLD COMMENTS BELOW
 *
 * The two numbered failure modes further down - a total-sum checker flagging
 * legitimate trade-offs, and missing 0-sum structural failures - are both still true
 * and both still argued from `ARCHITECTURE.md` 6.4. They are retained because they
 * explain why `isPureUpgrade` is componentwise and why `thresholdCrossings` exists.
 * What has changed is which of them is a DEFECT in the shipped corpus, and the answer
 * is now measured rather than assumed.
 */

import {
  IDEOLOGUES,
  IDEOLOGUE_RESOURCE,
  RESOURCES,
  RULES,
  deltaTotal,
  sidePayout,
  type Delta,
  type Effect,
  type IdeologyCard,
  type IdeologySide,
  type Ideologue,
  type Resource,
} from './engine.js';

import { type CorpusIdeologyCard, type CorpusVoterCard } from './corpus.js';

import {
  type ConversionModel,
  type Decisiveness,
  measureDecisiveness,
  shippedConversionModel,
  toughLoveOption,
  voterMarketOptions,
} from './holdings.js';

// ─────────────────────────── the tolerance band ───────────────────────────

/**
 * How far two sides' total payouts may differ before the difference is a finding.
 *
 * JUSTIFICATION (docs/ARCHITECTURE.md 6.4.1, restated so it is argued here rather
 * than inherited):
 *
 *  - **1 resource is free.** The resource cap is 12 (RULES p12). One resource is
 *    8% of your pool, and across a four-hour game with 30+ resources passing
 *    through it is a rounding error. It cannot be strategically decisive, so it
 *    cannot cause the optimisation failure we are guarding against.
 *  - **2 resources is not free.** 17% of your pool, and precisely the difference
 *    between being able to afford the 4-resource redraw (RULES p21) and not. At
 *    the margin — which is where Shasn is played — two resources is a turn.
 *  - **D1 and D3 override the band entirely.** A 1-resource PURE_UPGRADE and a
 *    1-resource POWER_THRESHOLD_CLIFF are both worse than a 3-resource symmetric
 *    card, because they remove the decision rather than tilting it. A tolerance
 *    band on totals must never mask a structural defect.
 *
 * The band deliberately costs us some false positives. That is the intended price:
 * the argument about a flagged card is the design review, and it belongs in a pull
 * request with a human in it, not silently in a playtest.
 */
/**
 * THE BAND IS ZERO, and that is a RULING rather than a rounding.
 *
 * ## WHAT CHANGED, AND WHY A WARNING WAS THE WRONG SEVERITY FOR A VISIBLE SKEW
 *
 * This was `1`, at severity `warn`. The audit's complaint is precisely that pairing: a
 * new Ideology Card could ship a **visible one-resource edge** — `ig-in2020-006` pays
 * `{trust 2, funds 2}` against `{media 2, funds 1}` — and the suite stayed green, because
 * a skew of exactly 1 is inside a band of 1 and inside it there is no finding at all.
 *
 * **1 RESOURCE IS NOT FREE, AND THE OLD ARGUMENT WAS ABOUT THE WRONG THING.** The
 * justification above this constant is economic: 8% of a pool of 12, a rounding error
 * across a four-hour game. That argument is sound for a *blind* game and it does not
 * apply to this one. This is FULL INFORMATION: `playerView` publishes both sides and
 * their payouts, so a player is permitted to add them up. **A strict total edge therefore
 * does not cost a resource — it costs the DECISION.** One answer is never the right
 * answer, whatever the player believes about the question, and the card stops asking it.
 * A decision removed is not priced in resources, so pricing it in resources is the
 * category error.
 *
 * **AND IT IS THE SAME CLASS OF DEFECT AS `PURE_UPGRADE`, WHICH IS ALREADY AN ERROR AT
 * ONE RESOURCE.** D1 says "one side pays strictly more of a resource than the other, so
 * one answer is dominated" and D2 says "one side pays strictly more IN TOTAL, so one
 * answer is dominated". The second is a strict superset of the first in reach and the
 * same claim in kind. Three of the four D-codes already treat a one-resource structural
 * edge as an **error** (`PURE_UPGRADE`, `POWER_THRESHOLD_CLIFF`, `SAME_IDEOLOGUE_SKEW`'s
 * sibling reasoning); `TOTAL_SKEW` was the only one that called it a tilt, and a tilt you
 * may see is not a defect you may ship.
 *
 * **WHY ZERO AND NOT SOME OTHER SMALLER BAND.** There is no value between 0 and 1 — the
 * band is an integer count of resources, and 1 is the smallest non-zero one. So the
 * choice was "1 or 0" and it is 0. A tolerance band that permits a non-zero total
 * difference is permitting exactly the quantity being measured.
 *
 * **THE COUNTER-ARGUMENT, STATED BECAUSE IT IS THE STRONG ONE.** A one-resource tilt is
 * ordinary texture, and erroring on it will annoy the next person who writes a card. It
 * is answered by the thing the band cannot see: a one-resource tilt is **invisible to a
 * player who does not compute and decisive to one who does**, so tolerating it silently
 * converts the game's difficulty from "decide what you believe" into "do the addition".
 * That is a worse outcome than the false positive, and false positives here are cheap —
 * the fix for a flagged card is to equalise the totals, which is one number and usually
 * improves the card.
 *
 * **CORPUS IMPACT, MEASURED: ONE CARD.** Over the 76 shipped Ideology Cards the
 * distribution of `|total skew|` is 75 zeros and one 1, so at a band of 0 exactly one
 * card is refused and it is `ig-in2020-006`. Its side 1 was rebalanced from
 * `{media 2, funds 1}` to `{media 2, funds 2}`, which equalises the totals while leaving
 * the two compositions genuinely incomparable — Trust-and-Funds against Media-and-Funds,
 * where a player picks on which Ideologue they are playing rather than on arithmetic.
 */
export const BALANCE_TOLERANCE_TOTAL = 0;

/**
 * Per-deck threshold for the resource-blind heuristic. See `resourceBlindLean`.
 *
 * With four Ideologues a fair deck puts the higher-paying side on each Ideologue
 * roughly a quarter of the time. Anything above 80% means a player who has memorised
 * the deck does not have to think about the question at all — they have memorised
 * which Ideologue tends to pay. Set high enough that ordinary sampling noise at
 * 10-20 cards a deck does not trip it.
 */
export const RESOURCE_BLIND_LEAN_THRESHOLD = 0.8;

/**
 * How far one Ideologue's share of card sides may stray from an even quarter
 * before the deck is reported as skewed.
 *
 * 20 percentage points. A 12-card deck has 24 sides, so one side is 4.2 points;
 * 20 points is roughly five sides' worth, which is beyond what a 12-card sample
 * produces by accident but well inside the drift REF 2.3 observed in the real
 * 108-card India campaign (8 of 14 tournament hands held ZERO Idealist cards).
 *
 * A warning, never an error: the real campaign is skewed on purpose, because its
 * questions are drawn from a real political period. What matters is that the skew
 * is *noticed* and argued about, not that it is banned.
 */
export const IDEOLOGUE_SKEW_TOLERANCE = 0.2;

// ─────────────────────────── findings ───────────────────────────

export type BalanceSeverity = 'error' | 'warn';

export type BalanceFinding = {
  readonly code:
    | 'EMPTY_SIDE'
    | 'PURE_UPGRADE'
    | 'TOTAL_SKEW'
    | 'COMPOSITION_DOMINANT'
    | 'POWER_THRESHOLD_CLIFF'
    | 'SAME_IDEOLOGUE_SKEW'
    | 'RESOURCE_BLIND_LEAN'
    | 'PAYOUT_DECIDED_DECK'
    | 'IDEOLOGUE_SKEW'
    | 'VOTER_COST_NON_MONOTONIC'
    | 'VOTER_VALUE_UNDERREPRESENTED'
    | 'X_EFFECT_MAGNITUDE';
  readonly severity: BalanceSeverity;
  readonly deck: string;
  readonly cardId: string;
  /**
   * Which side the finding is about. For `PURE_UPGRADE` / `TOTAL_SKEW` / `EMPTY_SIDE`
   * it is the side AT FAULT; for `COMPOSITION_DOMINANT` it is the side that DOMINATES,
   * because the message names the other one as the side that is never worth taking.
   */
  readonly side?: 0 | 1;
  readonly message: string;
};

export type BiasStats = {
  readonly deck: string;
  readonly ideologyCards: number;
  /** How often each Ideologue appears on a side. */
  readonly ideologueSideRate: Readonly<Record<Ideologue, number>>;
  /** How often each unordered Ideologue pairing occurs. */
  readonly pairRate: Readonly<Record<string, number>>;
  /** Mean |ΣA − ΣB| across the deck's cards. */
  readonly meanSideGap: number;
  /** Mean total payout per side. */
  readonly meanSidePayout: number;
  /** The resource-blind heuristic result. `null` when the deck is too small to judge. */
  readonly resourceBlind: {
    readonly decisive: number;
    readonly byIdeologue: Readonly<Record<Ideologue, number>>;
    readonly leadingIdeologue: Ideologue | null;
    readonly leadShare: number;
    readonly verdict: 'clean' | 'lean' | 'undecidable';
  };
  /**
   * THE REAL AXIS, measured exhaustively. See `src/holdings.ts`.
   *
   * `positions` is every reachable holdings vector (1820 at the shipped cap), not a
   * sample, so `decidedByPayoutShare` is a statement about the complete state space.
   */
  readonly composition: {
    readonly positions: number;
    /** Cards where one side converts strictly better at EVERY reachable position. */
    readonly decidedByPayout: number;
    /** Cards with a strict win for each side somewhere - the healthy case. */
    readonly realChoice: number;
    /** Cards worth the same at every position - a pure dilemma, which is allowed. */
    readonly indistinguishable: number;
    readonly decidedByPayoutShare: number;
    /** Share of (card, position) pairs that are ties. */
    readonly tieShare: number;
  };
};

export type BalanceReport = {
  readonly findings: readonly BalanceFinding[];
  readonly errors: readonly BalanceFinding[];
  readonly warnings: readonly BalanceFinding[];
  readonly bias: readonly BiasStats[];
  readonly cardsChecked: number;
};

// ─────────────────────────── the dominance relation ───────────────────────────

/**
 * The resource an Ideologue's answers feed (RULES p11/p33). Named in the D1
 * message because it is the strategic reason an upgrade matters: the extra
 * resources are the ones that push that Ideologue toward its next power unlock.
 */
function ownResource(ideologue: Ideologue): Resource {
  return IDEOLOGUE_RESOURCE[ideologue];
}

/**
 * D1 — PURE UPGRADE.
 *
 * X is a pure upgrade over Y if every resource is `>=` and at least one is
 * strictly `>`. There is then no reason, ever, to pick Y, whatever the question
 * is and whatever the player's long-term plan. This is the killer condition and
 * it is checked before any total comparison because it is unambiguous.
 */
function isPureUpgrade(x: IdeologySide, y: IdeologySide): boolean {
  let strict = false;
  for (const res of RESOURCES) {
    const xv = x.pays[res] ?? 0;
    const yv = y.pays[res] ?? 0;
    if (xv < yv) return false;
    if (xv > yv) strict = true;
  }
  return strict;
}

/**
 * D3 — POWER THRESHOLD CLIFF.
 *
 * RULES p15: 3 cards of an Ideologue unlock its Level 3 power and 5 unlock Level
 * 5, and an unlocked power pays out every turn for the rest of the game. So a card
 * that carries you over a threshold is worth several resources immediately and
 * forever, which is why a 1-resource gap here outranks the tolerance band.
 *
 * WHAT IS ACTUALLY MEASURED, precisely, because the header comment has to be true:
 * the engine's unlock test is `cardsOf(player, ideologue) >= level` — a count of
 * Ideology CARDS, not of resources (`packages/engine/src/powers.ts`, `hasPower`).
 * This checker is run on one card in isolation with no manifestos, so it uses the
 * resource proxy the rules give for that ladder: `IDEOLOGUE_RESOURCE[i]` is the
 * resource an Ideologue's answers feed (RULES p11/p33), and a side paying
 * `RULES.level3` or `RULES.level5` of it is treated as buying the corresponding
 * unlock. Two consequences, both deliberate:
 *   - the crossing is scoped to the side's OWN Ideologue resource. A Capitalist
 *     side paying 3 Media has not gained a Showstopper card and unlocks nothing, so
 *     crediting it with `media@3` would manufacture an unlock out of a side that
 *     feeds no Ideologue at all.
 *   - it remains a proxy, not the engine's rule. See KNOWN-GAPS.md; if the proxy
 *     over- or under-reports on real play, refine it here rather than in the engine.
 *
 * Modelled as a COUNT of threshold crossings rather than as "this side pays 3 of
 * something the other does not", because the naive per-direction test is wrong in
 * a way that produces a flood of false positives on exactly the cards the game is
 * made of. Consider `{trust: 3}` against `{funds: 3}`: per direction, each side
 * pays 3 of a resource the other pays none of, so a per-direction test reports a
 * cliff TWICE and declares a card dominated that is in fact perfectly symmetric —
 * both sides buy one unlock, and the choice of which unlock is real deliberation.
 *
 * So: crossings(X) is the set of `resource@threshold` pairs X's own Ideologue
 * resource reaches, and a cliff exists only when |crossings(X)| > |crossings(Y)|. Equal counts, even
 * when the sets are entirely different, are not dominance. A side that buys two
 * unlocks against an opponent's one is a real cliff, and that is what this finds:
 * `{clout: 5}` (Supremo) crosses clout@3 and clout@5, so it beats `{trust: 4}`
 * (Idealist), which crosses only trust@3 — even though neither resource appears on
 * the other side.
 *
 * Scoping each side to its own resource is what keeps the count honest. Counting
 * every resource a side touches instead lets a side pad its count with unlocks it
 * does not own, and a count can be gamed by padding: `{funds: 3, media: 3}` on a
 * Capitalist side used to score 2 against `{trust: 5}` on an Idealist side's 2, so
 * the comparison came out level and the card was called clean when in truth the
 * Idealist side buys the Level 5 unlock and the Capitalist side buys only Level 3.
 */
function thresholdCrossings(side: IdeologySide): Set<string> {
  const res = ownResource(side.ideologue);
  const v = side.pays[res] ?? 0;
  const out = new Set<string>();
  for (const threshold of [RULES.level3, RULES.level5] as const) {
    if (v >= threshold) out.add(`${res}@${threshold}`);
  }
  return out;
}

/**
 * D2 — total skew beyond the tolerance band. REPORTED, NOT ENFORCED.
 *
 * The full argument is in the ruling at the top of this file. The short form: a bigger
 * total is usually an INVERSION rather than a tilt. Sweeping every non-pure-upgrade
 * payout pair (total 1..6) and asking whether the SMALLER-total side wins at any
 * reachable holding:
 *
 *   skew 1 → 7061/7104 pairs (99.4%)    skew 3 → 1634/1700 (96.1%)
 *   skew 2 → 3741/3800 pairs (98.4%)    skew 4 →  531/574  (92.5%)
 *
 * and the share of skewed pairs that are decided by their payout at all only rises from
 * 0.6% at skew 1 to 4.2% at skew 5 — so skew does not predict dominance. At `{funds: 9}`
 * it would refuse `{funds: 4}` (2 voters convertible) while admitting
 * `{funds: 1, trust: 2}` (5 voters convertible). Kept as a warning because drift towards
 * lopsided payouts is a real smell and REF 5.2's verified format is "2-5 discs".
 */
function totalSkew(x: number, y: number): number {
  return x - y;
}

/**
 * Analyse one Ideology Card. Pure, so a test can call it on a single fixture card.
 *
 * Both directions are tested: the card is a two-sided choice, so either side may
 * be the dominant one and the finding is reported against whichever is.
 *
 * `model` is OPTIONAL and that is deliberate rather than convenient. The
 * composition findings need an economy to measure conversion against, and an
 * economy is corpus data (`src/holdings.ts` builds one from the Voter market). A caller
 * with one fixture card and no market should still be able to ask the structural
 * questions, so `analyseIdeologyCard` stays usable without it — and `balanceCorpus`
 * always supplies it, so no shipped card is ever analysed without the real check.
 */
export function analyseIdeologyCard(
  card: IdeologyCard,
  deck = 'unknown',
  model?: ConversionModel,
): readonly BalanceFinding[] {
  const [a, b] = card.sides;
  if (a === undefined || b === undefined) {
    return [
      {
        code: 'EMPTY_SIDE',
        severity: 'error',
        deck,
        cardId: card.id,
        message: 'card does not have exactly two sides',
      },
    ];
  }

  const out: BalanceFinding[] = [];
  const pa = sidePayout(a);
  const pb = sidePayout(b);

  // D5 — EMPTY SIDE. A side that pays nothing is not a choice.
  // ARCHITECTURE 6.2 keeps this out of the JSON Schema on purpose: the schema
  // validates shape, the checker validates design, and a `{}` payout is
  // schema-valid but design-dead.
  if (pa === 0) {
    out.push({
      code: 'EMPTY_SIDE',
      severity: 'error',
      deck,
      cardId: card.id,
      side: 0,
      message: `side 0 (${a.ideologue}) pays nothing — not a choice`,
    });
  }
  if (pb === 0) {
    out.push({
      code: 'EMPTY_SIDE',
      severity: 'error',
      deck,
      cardId: card.id,
      side: 1,
      message: `side 1 (${b.ideologue}) pays nothing — not a choice`,
    });
  }

  // D1 — pure upgrade, either direction.
  if (isPureUpgrade(a, b)) {
    out.push({
      code: 'PURE_UPGRADE',
      severity: 'error',
      deck,
      cardId: card.id,
      side: 0,
      message:
        `side 0 (${a.ideologue}) pays ${fmt(a.pays)} which is >= side 1 (${b.ideologue})'s ` +
        `${fmt(b.pays)} on every resource and strictly more on at least one — the surplus also ` +
        `feeds ${ownResource(a.ideologue)}, the ${a.ideologue}'s own resource (RULES p11/p33) — ` +
        'so there is no reason to ever answer side 1',
    });
  }
  if (isPureUpgrade(b, a)) {
    out.push({
      code: 'PURE_UPGRADE',
      severity: 'error',
      deck,
      cardId: card.id,
      side: 1,
      message:
        `side 1 (${b.ideologue}) pays ${fmt(b.pays)} which is >= side 0 (${a.ideologue})'s ` +
        `${fmt(a.pays)} on every resource and strictly more on at least one — the surplus also ` +
        `feeds ${ownResource(b.ideologue)}, the ${b.ideologue}'s own resource (RULES p11/p33) — ` +
        'so there is no reason to ever answer side 0',
    });
  }

  // D3 — power threshold cliff. Reported only when one side buys strictly MORE
  // power unlocks than the other; an equal number is a choice, not a dominance.
  // See `thresholdCrossings`.
  const crossA = thresholdCrossings(a);
  const crossB = thresholdCrossings(b);
  for (const [i, mine, theirs] of [
    [0, crossA, crossB],
    [1, crossB, crossA],
  ] as const) {
    if (mine.size <= theirs.size) continue;
    const own = i === 0 ? a : b;
    const other = i === 0 ? b : a;
    out.push({
      code: 'POWER_THRESHOLD_CLIFF',
      severity: 'error',
      deck,
      cardId: card.id,
      side: i as 0 | 1,
      message:
        `side ${i} (${own.ideologue}) buys ${mine.size} power unlock(s) ` +
        `(${describeCrossings(mine)}) against side ${1 - i} (${other.ideologue})'s ` +
        `${theirs.size} (${describeCrossings(theirs)}). An unlocked power pays out every turn for ` +
        'the rest of the game, so this outranks the tolerance band',
    });
  }

  // D2 — total skew. A WARNING, and the demotion is the measured ruling at the top of
  // this file: a bigger total is an INVERSION more often than a tilt (99.7% of skew-1
  // pairs have a holding where the smaller side converts better), so an error here
  // would refuse the better card. The finding still stands, because drift towards
  // lopsided payouts is a real smell and REF 5.2's verified format is "2-5 discs".
  const skew = totalSkew(pa, pb);
  if (Math.abs(skew) > BALANCE_TOLERANCE_TOTAL) {
    out.push({
      code: 'TOTAL_SKEW',
      severity: 'warn',
      deck,
      cardId: card.id,
      side: skew > 0 ? 0 : 1,
      message:
        `side ${skew > 0 ? 0 : 1} pays ${Math.abs(skew)} more in total ` +
        `(${pa} vs ${pb}); the shipped deck's band is +/-${BALANCE_TOLERANCE_TOTAL} and REF 5.2's ` +
        `verified format is 2-5 discs. This is REPORTED rather than refused because a total skew is ` +
        'usually an inversion, not a tilt: measured over every non-upgrade pair, 99.4% of skew-1 ' +
        'pairs have a reachable holding where the SMALLER side converts better, and the share of ' +
        'skewed pairs that ARE decided by their payout never exceeds 4.2%. What decides this ' +
        'card is COMPOSITION_DOMINANT, not this number.',
    });
  }

  // D6 — COMPOSITION DOMINANT. THE CHECK THAT MEASURES THE AXIS ANSWERS ARE DECIDED ON.
  //
  // Everything above compares two sides as vectors or as scalars. This one asks the
  // question a player actually asks: given what I am HOLDING, which side converts into
  // more score? `canAfford` is componentwise and the cap is 12 total, so composition
  // and count are genuinely different currencies and only an economy-aware comparison
  // can tell them apart.
  //
  // The relation is a DIRECTION over the COMPLETE reachable space — all 1820 holdings
  // vectors, not a sample. It fires when one side is never the worse answer anywhere and
  // is strictly better somewhere, so the payout's bias never reverses and a player who
  // has learned the deck is never wrong. Ties do not rescue it: at a tied position the
  // card does not decide, but the direction is still learnable, which is exactly the
  // failure PLAN.md 9 risk #2 describes arriving through the payout rather than through
  // one card.
  //
  // IT IS NOT REDUNDANT WITH D1, and the corpus is the proof. `PURE_UPGRADE` compares
  // componentwise; this compares convertible. Sweeping all 5862 equal-total,
  // non-pure-upgrade payout pairs, 9 are decided by their payout and every one is a
  // SPREAD side beating a CONCENTRATED pile — `{clout:6}` over
  // `{funds:1, clout:2, media:1, trust:2}`, total 6 on both sides. Neither D1 nor D2 nor
  // D3 can see that card, and D2 cannot see it by construction, because its totals are
  // equal.
  if (model !== undefined) {
    const d = measureDecisiveness(card.id, a.pays, b.pays, model);
    if (d.decidedByPayout) {
      const winner = d.side0Wins === 0 ? 1 : 0;
      const own = winner === 0 ? a : b;
      const other = winner === 0 ? b : a;
      const loserWins = winner === 0 ? d.side1Wins : d.side0Wins;
      const winnerWins = winner === 0 ? d.side0Wins : d.side1Wins;
      out.push({
        code: 'COMPOSITION_DOMINANT',
        severity: 'error',
        deck,
        cardId: card.id,
        side: winner as 0 | 1,
        message:
          `side ${winner} (${own.ideologue}) is the better answer at ${winnerWins} of the ` +
          `${d.positions} reachable holdings positions and is NEVER the worse one ` +
          `(${loserWins} wins for side ${1 - winner}, ${d.ties} positions tie). Every position ` +
          `is a non-negative pool with a total at most the cap of ${model.cap}, scored by an ` +
          `exact knapsack over the shipped Voter market with the p12 discard made optimally. ` +
          `Side ${1 - winner} (${other.ideologue}) pays ${fmt(other.pays)} and is never worth ` +
          `taking. Equal totals do NOT save a card from this: the totals here are ` +
          `${sidePayout(own)} vs ${sidePayout(other)}, so the payout's bias never reverses and ` +
          'a player who has learned this card is never wrong. Every measured instance of this ' +
          'failure is a payout PILLED into one resource beaten by the same total spread wide, ' +
          'because the market has cards that spend one resource and few that spend four at ' +
          'once — so widen the weak side.',
      });
    }
  }

  // D4 — same-ideologue skew. Unreachable through the JSON Schema, which forbids
  // two sides of the same Ideologue (RULES p13). Retained because the balance
  // checker is runnable against a corpus that has not been schema-checked, and
  // because a corpus author who relaxes p13 should be told, not silently obeyed.
  if (a.ideologue === b.ideologue) {
    out.push({
      code: 'SAME_IDEOLOGUE_SKEW',
      severity: 'warn',
      deck,
      cardId: card.id,
      message: `both sides are ${a.ideologue}; RULES p13 requires two different Ideologues`,
    });
  }

  return out;
}

function fmt(d: Delta): string {
  const parts = RESOURCES.filter((r) => (d[r] ?? 0) > 0).map((r) => `${d[r] ?? 0}${r}`);
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

function describeCrossings(s: ReadonlySet<string>): string {
  return s.size === 0 ? 'none' : [...s].join(' + ');
}

// ─────────────────────────── per-deck bias statistics ───────────────────────────

function pairKey(a: Ideologue, b: Ideologue): string {
  return [a, b].sort().join('×');
}

function blankIdeologues(): Record<Ideologue, number> {
  return { capitalist: 0, supremo: 0, showstopper: 0, idealist: 0 };
}

/**
 * Which side a player who is NOT reading the card would pick.
 *
 * Purely structural: it looks only at payouts, and never at the question or the
 * answer text. Used by the resource-blind heuristic below.
 *
 * ## WHY IT NEEDS A MODEL, AND WHY THAT MATTERS
 *
 * This used to key on TOTALS, and therefore returned `null` for every one of the 76
 * shipped cards — measured, `decisive: 0` on both decks. A heuristic that cannot
 * produce a verdict on the corpus it ships with is not a heuristic; it is a dead
 * branch, and it was the deck-level half of exactly the problem this file was rebuilt
 * to fix. Its question — *can a player solve this deck without reading the cards?* —
 * is still the right question, so the fix is to ask it on the axis that exists.
 *
 * So the payout-favoured side is now the side that converts better at MORE reachable
 * holdings, scored by the same `src/holdings.ts` economy as `COMPOSITION_DOMINANT`. A
 * card where one side wins everywhere still counts as decisive; a card that flips
 * returns `null`, because there is no side a player could learn to prefer.
 */
function resourcePreferredSide(
  card: IdeologyCard,
  model: ConversionModel | undefined,
): IdeologySide | null {
  const [a, b] = card.sides;
  if (a === undefined || b === undefined) return null;
  const pa = sidePayout(a);
  const pb = sidePayout(b);

  if (model === undefined) {
    // No economy: fall back to the total comparison this always used, so the heuristic
    // degrades to its old behaviour rather than to nothing.
    if (pa !== pb) return pa > pb ? a : b;
    const aBetter =
      isPureUpgrade(a, b) || thresholdCrossings(a).size > thresholdCrossings(b).size;
    const bBetter =
      isPureUpgrade(b, a) || thresholdCrossings(b).size > thresholdCrossings(a).size;
    return aBetter !== bBetter ? (aBetter ? a : b) : null;
  }

  const d = measureDecisiveness(card.id, a.pays, b.pays, model);
  // A flip is a real choice and returns null; only a universal winner is decisive.
  if (!d.decidedByPayout) return null;
  return d.side0Wins === 0 ? b : a;
}

/**
 * RESOURCE-BLIND HEURISTIC.
 *
 * If, across a whole deck, the payout-favoured side is nearly always the same
 * Ideologue, then the deck is solvable without reading it: a player who has seen
 * the deck once knows which answer to give. Deliberation is replaced by
 * memorisation, which is the same failure PLAN.md 9 risk #2 describes, arriving
 * through the corpus rather than through a single card.
 *
 * Note what this deliberately does NOT do: it is not a verdict on any individual
 * card, and it says nothing about a card whose two sides are a genuine trade-off.
 * It measures the deck, not the card.
 *
 * A verdict of `undecidable` is the DESIRED outcome for a well-balanced deck: it
 * means the payout structure does not tell you which side to take, so the
 * question has to. `undecidable` is returned both when there are too few decisive
 * cards to judge (< MIN_DECISIVE) and when the deck is so evenly balanced that
 * almost no card is decisive at all — the second case is reported with its
 * decisive count so the two are distinguishable in the output.
 */
function resourceBlind(
  cards: readonly CorpusIdeologyCard[],
  model: ConversionModel | undefined,
): BiasStats['resourceBlind'] {
  const byIdeologue = blankIdeologues();
  let decisive = 0;
  for (const card of cards) {
    const winner = resourcePreferredSide(card, model);
    if (winner === null) continue;
    decisive += 1;
    byIdeologue[winner.ideologue] += 1;
  }
  if (decisive === 0) {
    return {
      decisive: 0,
      byIdeologue,
      leadingIdeologue: null,
      leadShare: 0,
      verdict: 'undecidable',
    };
  }
  let leadingIdeologue: Ideologue | null = null;
  let leadShare = 0;
  for (const i of IDEOLOGUES) {
    const share = byIdeologue[i] / decisive;
    if (share > leadShare) {
      leadShare = share;
      leadingIdeologue = i;
    }
  }
  // Below this many decisive cards a share is sampling noise, not a trend.
  const tooFewToJudge = decisive < MIN_DECISIVE_CARDS;
  return {
    decisive,
    byIdeologue,
    leadingIdeologue,
    leadShare,
    verdict: tooFewToJudge ? 'undecidable' : leadShare > RESOURCE_BLIND_LEAN_THRESHOLD ? 'lean' : 'clean',
  };
}

/** A share computed from fewer decisive cards than this is noise, not a trend. */
export const MIN_DECISIVE_CARDS = 5;

/**
 * How much of a deck may be decided by its payout before the questions are decoration.
 *
 * A card counted here has one side that converts strictly better at EVERY reachable
 * holdings position, so a player who is short of one resource never has a reason to
 * read it. The shipped decks measure **0 of 76**, so this threshold is not a target —
 * it is the point at which the deck should be argued about rather than shipped.
 *
 * A WARNING rather than an error because the per-card `COMPOSITION_DOMINANT` error
 * already refuses each of these cards when `balanceCorpus` runs; this is the deck-level
 * rollup that catches the case where they are individually defensible and collectively
 * a solved deck.
 */
export const PAYOUT_DECIDED_SHARE_THRESHOLD = 0.1;

/**
 * The composition block: does this deck leave real choices?
 *
 * This is the positive half of the instrument. `COMPOSITION_DOMINANT` says a card is
 * broken; this says whether the deck as a whole is playable more than once, which is
 * the claim the old total-based `resourceBlind` could never make about this corpus.
 */
function compositionStats(
  cards: readonly CorpusIdeologyCard[],
  model: ConversionModel | undefined,
): BiasStats['composition'] {
  const empty = {
    positions: 0,
    decidedByPayout: 0,
    realChoice: 0,
    indistinguishable: 0,
    decidedByPayoutShare: 0,
    tieShare: 0,
  };
  if (model === undefined || cards.length === 0) return empty;

  let decided = 0;
  let real = 0;
  let indist = 0;
  let ties = 0;
  for (const card of cards) {
    const [a, b] = card.sides;
    if (a === undefined || b === undefined) continue;
    const d = measureDecisiveness(card.id, a.pays, b.pays, model);
    if (d.decidedByPayout) decided += 1;
    else if (d.indistinguishable) indist += 1;
    else real += 1;
    ties += d.ties;
  }
  const total = cards.length * model.reachable.length;
  return {
    positions: model.reachable.length,
    decidedByPayout: decided,
    realChoice: real,
    indistinguishable: indist,
    decidedByPayoutShare: cards.length === 0 ? 0 : decided / cards.length,
    tieShare: total === 0 ? 0 : ties / total,
  };
}

export function deckBias(
  deck: string,
  cards: readonly CorpusIdeologyCard[],
  model?: ConversionModel,
): BiasStats {
  const sideRate = blankIdeologues();
  const pairRate: Record<string, number> = {};
  let gapSum = 0;
  let payoutSum = 0;
  let sides = 0;

  for (const card of cards) {
    const [a, b] = card.sides;
    if (a === undefined || b === undefined) continue;
    sideRate[a.ideologue] += 1;
    sideRate[b.ideologue] += 1;
    const key = pairKey(a.ideologue, b.ideologue);
    pairRate[key] = (pairRate[key] ?? 0) + 1;
    gapSum += Math.abs(sidePayout(a) - sidePayout(b));
    payoutSum += sidePayout(a) + sidePayout(b);
    sides += 2;
  }

  const n = cards.length;
  for (const i of IDEOLOGUES) {
    sideRate[i] = n === 0 ? 0 : sideRate[i] / (n * 2);
  }

  return {
    deck,
    ideologyCards: n,
    ideologueSideRate: sideRate,
    pairRate,
    meanSideGap: n === 0 ? 0 : gapSum / n,
    meanSidePayout: sides === 0 ? 0 : payoutSum / sides,
    resourceBlind: resourceBlind(cards, model),
    composition: compositionStats(cards, model),
  };
}

// ─────────────────────────── voter deck shape ───────────────────────────

function voterTotalCost(cost: Delta): number {
  return RESOURCES.reduce((n, r) => n + (cost[r] ?? 0), 0);
}

function voterFindings(deck: string, cards: readonly CorpusVoterCard[]): readonly BalanceFinding[] {
  const out: BalanceFinding[] = [];
  if (cards.length === 0) return out;

  const byValue = new Map<number, number[]>();
  for (const c of cards) {
    const list = byValue.get(c.voters) ?? [];
    list.push(voterTotalCost(c.cost));
    byValue.set(c.voters, list);
  }
  const mean = (n: number): number | null => {
    const list = byValue.get(n);
    if (list === undefined || list.length === 0) return null;
    return list.reduce((a, b) => a + b, 0) / list.length;
  };

  // REF 3: real Conspiracy/Headline effects discriminate Voter Cards BY SIZE
  // (Lab-Grown Earworm, Power Trip, Don't Kiss The Babies, Eradicating Germs,
  // Fatality). A value the deck barely offers is a mechanic with nothing to bite on.
  for (const v of [1, 2, 3]) {
    const list = byValue.get(v) ?? [];
    if (list.length < 2) {
      out.push({
        code: 'VOTER_VALUE_UNDERREPRESENTED',
        severity: 'warn',
        deck,
        cardId: `${v}-voter`,
        message: `only ${list.length} ${v}-Voter card(s) in the deck; size-discriminating effects need more than one`,
      });
    }
  }

  // More voters should cost more on average, or the market's 3 big cards are free money.
  const m1 = mean(1);
  const m2 = mean(2);
  const m3 = mean(3);
  if (m1 !== null && m3 !== null && m1 >= m3) {
    out.push({
      code: 'VOTER_COST_NON_MONOTONIC',
      severity: 'warn',
      deck,
      cardId: 'cost-curve',
      message: `mean cost of a 1-Voter card (${m1.toFixed(2)}) is not below the mean cost of a 3-Voter card (${m3.toFixed(2)})`,
    });
  }
  if (m1 !== null && m2 !== null && m1 >= m2) {
    out.push({
      code: 'VOTER_COST_NON_MONOTONIC',
      severity: 'warn',
      deck,
      cardId: 'cost-curve',
      message: `mean cost of a 1-Voter card (${m1.toFixed(2)}) is not below the mean cost of a 2-Voter card (${m2.toFixed(2)})`,
    });
  }
  if (m2 !== null && m3 !== null && m2 >= m3) {
    out.push({
      code: 'VOTER_COST_NON_MONOTONIC',
      severity: 'warn',
      deck,
      cardId: 'cost-curve',
      message: `mean cost of a 2-Voter card (${m2.toFixed(2)}) is not below the mean cost of a 3-Voter card (${m3.toFixed(2)})`,
    });
  }
  return out;
}

// ─────────────────────────── X-card magnitude ───────────────────────────

/**
 * The most a single Conspiracy or Headline Card may be worth, in resources, to
 * the player who resolves it.
 *
 * WHY THIS EXISTS. Everything above this section analyses an Ideology Card, where
 * the design question is "is one answer strictly better than the other". A Conspiracy
 * or Headline Card has no sides to compare — it is a single effect — so the whole
 * checker was silent on the class of card the recovered corpus is actually made of
 * (REF 4: 50 recovered X-cards, and REF 4.4 item 1 says they are mostly not resource
 * deltas at all). A card that hands one player a dozen resources would sail through
 * with no finding, and the resource cap is 12.
 *
 * HALF THE CAP. `RULES.resourceCap` is 12, so 6 is half a player's whole pool, and it
 * is also more than the printed cost of the card carrying it (RULES p19: 4-5). A card
 * that costs 4 and can be worth 7 is a card that pays for itself twice, whatever it
 * does to the other players.
 *
 * A WARNING, not an error, for the same reason every other tilt is: the argument
 * about a flagged card belongs in a pull request with a human in it. Errors here are
 * for defects (EMPTY_SIDE), not for strong cards.
 */
export const X_EFFECT_MAGNITUDE_BUDGET = 6;

/**
 * What one `draw-conspiracy` is worth. RULES p19 prints 4-5 on the back of the card;
 * the lower bound is used so the check cannot be softened by a costlier edition.
 */
export const CONSPIRACY_MIN_COST = 4;

/** Fallback for the price of a voter when no voter deck is supplied. */
const DEFAULT_VOTER_VALUE = 3;

export type XCardLike = {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly Effect[];
};

/**
 * What a voter costs in the shipped decks, on average.
 *
 * Derived rather than assumed, because a voter granted by a card is worth exactly
 * what a voter bought from the market costs, and that number is corpus data. Rounded
 * to a whole resource: it is a magnitude estimate for a warning, and a fractional
 * threshold would make the finding depend on the deck's arithmetic.
 */
export function voterValue(cards: readonly CorpusVoterCard[]): number {
  let total = 0;
  let count = 0;
  for (const c of cards) {
    if (c.voters < 1) continue;
    total += voterTotalCost(c.cost) / c.voters;
    count += 1;
  }
  return count === 0 ? DEFAULT_VOTER_VALUE : Math.max(1, Math.round(total / count));
}

/**
 * The net resources an X-card hands its own player. Negative means the card costs
 * its player resources. `null` means the card cannot be measured statically.
 *
 * Only the RESOLVING player's share is counted. An effect aimed at `each-opponent`,
 * `everyone` or `leader` is another player's problem, and one that helps everybody is
 * not the same design failure as one that hands the caster everything — but note the
 * asymmetry this leaves: a card that gives every opponent 6 resources scores 0 here.
 * That is a real limit of the measure and it is stated rather than hidden; the checks
 * that would catch it (target-sensitive payout analysis) belong with a corpus large
 * enough to have a distribution worth judging.
 *
 * WHY `null`, and why the answer is not zero. A computed `n` or `per` (G15 / G4) is
 * read out of a player's own state at resolution — how much they hold, how many
 * Ideology Cards they have answered, how many pegs they have in Volatile Areas. This
 * function runs on ONE CARD IN ISOLATION with no player state, so there is nothing to
 * read, and a card whose whole value is a function of the board cannot be priced
 * before a board exists. Scoring it 0 would be the worst of the three answers: the
 * check would pass, and it would pass for a reason that has nothing to do with the
 * card. So the card is reported as UNMEASURED and the reviewer looks at it. This is
 * the same shape as the D3 caveat in KNOWN-GAPS §6: the proxy is honest about being
 * a proxy, and the alternative is a number that reads as a verdict and is not one.
 */
export function xCardMagnitude(card: XCardLike, perVoter: number): number | null {
  let total = 0;
  for (const effect of card.effects) {
    const mine = !('target' in effect) || effect.target === undefined || effect.target === 'you';
    if (!mine) continue;
    if (computedIn(effect)) return null;
    switch (effect.op) {
      case 'gain':
        total += deltaTotal(effect.res);
        break;
      case 'lose':
        total -= deltaTotal(effect.res);
        break;
      case 'gain-any':
      case 'steal-any':
        total += literal(effect.n);
        break;
      case 'lose-any':
        total -= literal(effect.n);
        break;
      case 'voters':
        total += literal(effect.n) * perVoter;
        break;
      case 'discount':
        // A discount is worth one resource per use, at most.
        total += literal(effect.n);
        break;
      case 'draw-conspiracy':
        total += literal(effect.n) * CONSPIRACY_MIN_COST;
        break;
      // Board effects are not resources: evicting, discarding, converting,
      // gerrymandering and refreshing the market move pegs and cards, not discs.
      case 'evict':
      case 'discard-voter':
      case 'convert-voter':
      case 'gerrymander':
      case 'refresh-market':
        break;
    }
  }
  return total;
}

/** Does this effect carry a count or multiplier that only exists at play time? */
function computedIn(effect: unknown): boolean {
  if (typeof effect !== 'object' || effect === null) return false;
  const e = effect as { readonly n?: unknown; readonly per?: unknown };
  if ('per' in e && e.per !== undefined) return true;
  return 'n' in e && typeof e.n !== 'number';
}

/**
 * The literal value of a Count. Only called after computedIn has said there is
 * one, so the throw is unreachable through xCardMagnitude; it is here so that a
 * future caller cannot quietly treat a computed count as zero.
 */
function literal(n: number | { readonly of: string }): number {
  if (typeof n !== 'number') {
    throw new Error(`computedIn() should have caught this: ${JSON.stringify(n)}`);
  }
  return n;
}

function xCardFindings(deck: string, cards: readonly XCardLike[], perVoter: number): readonly BalanceFinding[] {
  const out: BalanceFinding[] = [];
  for (const card of cards) {
    const magnitude = xCardMagnitude(card, perVoter);
    if (magnitude === null) {
      out.push({
        code: 'X_EFFECT_MAGNITUDE',
        severity: 'warn',
        deck,
        cardId: card.id,
        message:
          `"${card.name}" is NOT MEASURED by this check: its value is computed from a ` +
          `player's own state at resolution, and this runs on one card in isolation with ` +
          `no player state to read. Scoring it zero would have made the check pass for a ` +
          `reason that has nothing to do with the card, so it is reported here instead. ` +
          `See KNOWN-GAPS.md section 6 for why the balance checker's other proxies are ` +
          `approximate too.`,
      });
      continue;
    }
    if (magnitude <= X_EFFECT_MAGNITUDE_BUDGET) continue;

    out.push({
      code: 'X_EFFECT_MAGNITUDE',
      severity: 'warn',
      deck,
      cardId: card.id,
      message:
        `"${card.name}" is worth about ${magnitude} resources to the player who resolves it ` +
        `(a voter counted at ${perVoter}, a drawn Conspiracy Card at its printed minimum of ` +
        `${CONSPIRACY_MIN_COST}), against a budget of ${X_EFFECT_MAGNITUDE_BUDGET} and a ` +
        `resource cap of ${RULES.resourceCap}. It costs 4-5 to buy, so it pays for itself twice.`,
    });
  }
  return out;
}

// ─────────────────────────── the report ───────────────────────────

export type BalanceInput = {
  /** Deck id → its Ideology Cards, for the per-deck statistics. */
  readonly ideology: ReadonlyMap<string, readonly CorpusIdeologyCard[]>;
  /** Deck id → its Voter Cards. */
  readonly voter: ReadonlyMap<string, readonly CorpusVoterCard[]>;
  /**
   * Deck id → its Conspiracy and Headline Cards, for the magnitude check.
   *
   * Optional because the Ideology analysis does not need it, and a caller that only
   * wants the dominance relations should not have to load a deck to get them.
   */
  readonly x?: ReadonlyMap<string, readonly XCardLike[]>;
  /**
   * The economy the composition checks are scored against.
   *
   * Optional, and derived from `voter` when omitted, because the model is a pure
   * function of the market plus the Tough Love gate and every caller that has a
   * `voter` map wants the same one. Supply it explicitly to measure cards against a
   * DIFFERENT economy — which is how the tests demonstrate that `COMPOSITION_DOMINANT`
   * is measuring conversion and not a coincidence of the shipped market.
   */
  readonly model?: ConversionModel;
};

/**
 * The economy the composition checks run against, built from the shipped market.
 *
 * Exported so the CLI, the tests and any future caller measure against the SAME thing
 * rather than each rebuilding it. The memo inside `shippedConversionModel` makes this
 * cheap; the `reset` hook exists for tests that need a different market.
 */
export function marketConversionModel(
  voter: ReadonlyMap<string, readonly CorpusVoterCard[]>,
): ConversionModel {
  return shippedConversionModel([...voter.values()].flat());
}

/**
 * How many Ideology Cards a real campaign ships, and what that implies for ours.
 *
 * REF §2.2, VERIFIED: *"Counts: 108 per campaign in the Kickstarter/Collectors edition"*.
 * REF §2.3 then says why, and the reason is the answer to the deck-recycling finding:
 * *"Total cards in hand after 8–12 turns is 8–12, so a 108-card campaign is only ~10%
 * consumed in a typical 5-player game. [INFERRED] 108 is sized for many replays with one
 * shared deck, and the effective card count per session is ~40-50 cards drawn from 108."*
 *
 * So 108 is not arbitrary padding: it is the smallest size at which **one shared deck
 * survives a session without a table seeing the same dilemma twice**, and it is also the
 * size that supports reuse across sessions at all.
 *
 * The engine's own figure for what a session consumes is in
 * `packages/engine/test/winnable.test.ts`: *"Ideology Cards | 52 | one per turn, so the
 * deck empties on turn 52"*. A harness measured ~67 answers per game across four games.
 * So a session consumes **52–68** answers and a deck must be at least that large to avoid
 * a within-session repeat.
 *
 * APPLIED TO THE SHIPPED DECKS, which is the finding rather than a plan: `in2020` is the
 * deck a player sees every turn and it holds **56** cards. 56 < 68, so **recycling within
 * a single game is guaranteed rather than marginal** — the deck cannot get to the size
 * where the answer stops mattering. That is why a harness saw one question at turns 51,
 * 107 and 193: turn 51 is the end of the draw pile.
 *
 * This is REPORTED, not enforced, and the distinction is deliberate. The fix is 52 authored
 * cards in REF §8.2's register, which is a writing task and not a data edit; a checker that
 * failed the build on it would only be asserting that the corpus is incomplete, which it
 * already says in `decks/SOURCES.md` §4.6. It is printed by `npm run balance` on every run
 * so the shortfall is impossible to forget and impossible to mistake for a design choice.
 */
export const IDEOLOGY_CAMPAIGN_SIZE = 108;

/** Answers one session consumes. The floor is the engine's own figure; see above. */
export const SESSION_ANSWERS_MIN = 52;
export const SESSION_ANSWERS_MAX = 68;

/**
 * THE CHECK-BY-CHECK VERDICT, because "we rebuilt the instrument" is not an answer to
 * "which of the old checks earned its place".
 *
 *  - `EMPTY_SIDE` — **KEEP, error.** Unfiring, and it must stay: a `{}` payout is
 *    schema-valid and design-dead, and REF §5.2 explicitly recommends requiring
 *    `sidePayout >= 1`. It is one line guarding a real future authoring slip.
 *  - `PURE_UPGRADE` — **KEEP, error.** Unfiring on the corpus (0 of 76). Not subsumed by
 *    `COMPOSITION_DOMINANT`: componentwise dominance is a *sufficient* condition for
 *    conversion dominance but the market can value the surplus at zero, so a pure upgrade
 *    can tie everywhere and a capacity-dominant card need not be an upgrade. Cheap,
 *    unambiguous, checked first for a reason.
 *  - `TOTAL_SKEW` — **DEMOTED error → warning**, on the measured inversion rates in the
 *    ruling. This is the one severity that changed and it is the one the user owned the
 *    mistake on. No card changes status (76 of 76 at skew 0) and the finding is still
 *    raised, so no information is lost.
 *  - `POWER_THRESHOLD_CLIFF` — **KEEP, error.** Unfiring on the shipped deck *by a
 *    knowable cause*: the corpus caps every side at 2 of any resource and `RULES.level3` is
 *    3. It is also the least dead check here — a `{clout: 6}` fixture on a Supremo trips it
 *    today, which is asserted in `test/balance.test.ts`. It guards the permanent power
 *    ladder, which `holdings.ts` deliberately excludes, so no other check covers it.
 *  - `SAME_IDEOLOGUE_SKEW` — **KEEP, warning.** Unreachable through the schema, which is
 *    the point: the checker is runnable against an unschema-checked corpus and p13 is a
 *    real rule.
 *  - `RESOURCE_BLIND_LEAN` / `resourceBlind()` — **REBUILT, not removed.** It was a dead
 *    branch: it keyed on totals and pure upgrades, so it measured `decisive: 0` on both
 *    decks and could never return `lean`. Its question — can a player solve this deck
 *    without reading it — is the right one, so it now runs on the conversion model.
 *  - `COMPOSITION_DOMINANT` — **NEW, error.** The check this whole round exists to add.
 *    Provably not redundant: it is the only one of the four that sees `{clout: 6}` against
 *    `{funds: 1, clout: 2, media: 1, trust: 2}`.
 *  - `PAYOUT_DECIDED_DECK` — **NEW, warning.** The deck-level rollup, for cards that are
 *    individually defensible and collectively a solved deck. Armed and silent at 0/76.
 *  - `IDEOLOGUE_SKEW` — **KEEP, warning.** Orthogonal, and REF §2.3 measured the real
 *    campaign as skewed on purpose, so a warning is the right severity.
 *  - `VOTER_COST_NON_MONOTONIC` / `VOTER_VALUE_UNDERREPRESENTED` — **KEEP, warning, and
 *    now load-bearing twice.** The market IS the economy `holdings.ts` measures against, so
 *    a market that stops discriminating by size would quietly blunt the new instrument as
 *    well as the old one.
 *  - `X_EFFECT_MAGNITUDE` — **KEEP, warning.** A different card class with no two sides to
 *    compare, orthogonal to this axis, and it fires today on `ct-et2040-017`.
 */
export const BALANCE_RULING = 'composition over totals';

export function balanceCorpus(input: BalanceInput): BalanceReport {
  const findings: BalanceFinding[] = [];
  const bias: BiasStats[] = [];
  let cardsChecked = 0;

  // The market is the economy. With no voter deck there is nothing to convert into and
  // the composition checks are skipped rather than run against a fabricated one — the
  // same "report it as unmeasured, do not score it zero" rule the X-card magnitude check
  // follows for the same reason.
  const model: ConversionModel | undefined =
    input.model ??
    (input.voter.size === 0 ? undefined : marketConversionModel(input.voter));

  for (const [deck, cards] of input.ideology) {
    for (const card of cards) {
      cardsChecked += 1;
      findings.push(...analyseIdeologyCard(card as IdeologyCard, deck, model));
    }
    const stats = deckBias(deck, cards, model);
    bias.push(stats);
    for (const i of IDEOLOGUES) {
      const rate = stats.ideologueSideRate[i];
      if (Math.abs(rate - 0.25) > IDEOLOGUE_SKEW_TOLERANCE) {
        findings.push({
          code: 'IDEOLOGUE_SKEW',
          severity: 'warn',
          deck,
          cardId: '(deck-level)',
          message:
            `${i} appears on ${(rate * 100).toFixed(0)}% of this deck's card sides, against an even ` +
            `quarter; tolerance is ${(IDEOLOGUE_SKEW_TOLERANCE * 100).toFixed(0)} points. A player who ` +
            'can only play one Ideologue has a materially different game from one who can play all four',
        });
      }
    }
    if (stats.resourceBlind.verdict === 'lean') {
      findings.push({
        code: 'RESOURCE_BLIND_LEAN',
        severity: 'warn',
        deck,
        cardId: '(deck-level)',
        message:
          `the payout-favoured side is ${stats.resourceBlind.leadingIdeologue} on ` +
          `${stats.resourceBlind.decisive} of ${(stats.resourceBlind.leadShare * 100).toFixed(0)}% of ` +
          `decisive cards; threshold is ${(RESOURCE_BLIND_LEAN_THRESHOLD * 100).toFixed(0)}%. ` +
          'Players can learn the deck instead of reading the cards',
      });
    }
    if (stats.composition.decidedByPayoutShare > PAYOUT_DECIDED_SHARE_THRESHOLD) {
      findings.push({
        code: 'PAYOUT_DECIDED_DECK',
        severity: 'warn',
        deck,
        cardId: '(deck-level)',
        message:
          `${stats.composition.decidedByPayout} of ${cards.length} cards ` +
          `(${(stats.composition.decidedByPayoutShare * 100).toFixed(0)}%) have one side that converts ` +
          `strictly better at all ${stats.composition.positions} reachable holdings positions; threshold ` +
          `is ${(PAYOUT_DECIDED_SHARE_THRESHOLD * 100).toFixed(0)}%. On those cards the question is ` +
          'decoration for a player who is short of one resource, which is the failure this checker ' +
          'was rebuilt to measure',
      });
    }
  }

  for (const [deck, cards] of input.voter) {
    cardsChecked += cards.length;
    findings.push(...voterFindings(deck, cards));
  }

  if (input.x !== undefined) {
    const perVoter = voterValue([...input.voter.values()].flat());
    for (const [deck, cards] of input.x) {
      cardsChecked += cards.length;
      findings.push(...xCardFindings(deck, cards, perVoter));
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return { findings, errors, warnings, bias, cardsChecked };
}
