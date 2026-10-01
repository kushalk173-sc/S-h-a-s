/**
 * THE BALANCE CHECKER.
 *
 * PLAN.md 9 risk #2: *"If one side of a card is strictly better, players optimise
 * instead of deliberating and the entire premise collapses."* This file is the
 * thing that protects the premise, so it gets a real dominance relation rather
 * than a total-sum comparison.
 *
 * WHY TOTAL-SUM COMPARISON IS NOT ENOUGH (docs/ARCHITECTURE.md 6.4):
 *
 * Two failures, in opposite directions. They are easy to conflate and must be kept
 * apart, because only one of them is a defect.
 *
 *   1. IT FLAGS LEGITIMATE TRADE-OFFS. `{funds:3}` vs `{trust:3}` is as large a
 *      componentwise gap as a card can hold — 3 Funds against 0 Funds, 3 Trust
 *      against 0 Trust — and its TOTALS are identical, 3 against 3. It is a
 *      perfectly good card: the question the player is answering is "which
 *      resource do I need", and that choice is the deliberation the game is made
 *      of. Note that this card is invisible to a totals checker *and* to a
 *      componentwise one; a total-sum checker flags it only by accident, and
 *      "3-resource difference" without "per resource" is how this bullet went
 *      wrong the first time.
 *
 *   2. IT MISSES STRUCTURAL FAILURES THAT ARE 0-SUM. `{funds:3}` vs
 *      `{funds:2, media:1}` pays out 3 on each side, so totals are silent — and so
 *      is D1, because `media` is 0 on the first side and 1 on the second, so the
 *      second side is NOT >= the first componentwise. It is not a pure upgrade.
 *      Ideologue resource thresholds do not rescue the claim either: the two sides
 *      pay different resources, so they feed different Ideologues and do not even
 *      sit on the same power ladder.
 *
 *      What is actually wrong with that card is a POWER THRESHOLD CLIFF. 3 Funds
 *      is `RULES.level3`, so a side paying 3 of a resource unlocks that Ideologue's
 *      Level 3 power, which pays out every turn for the rest of the game (RULES
 *      p15). A card paying 3 of a resource on one side and 2 on the other is worth
 *      a whole power, not the 1 resource its totals differ by. No total-sum
 *      comparison and no componentwise comparison can see that, which is what D3
 *      exists for.
 *
 * THE EXAMPLE THAT WAS HERE BEFORE WAS WRONG. An earlier draft read: *"`{funds:3}`
 * vs `{funds:2, media:1}` is 0-sum and yet a pure upgrade for anyone who needs
 * funds"*. It was 0-sum; it was not a pure upgrade. A pure upgrade can never be
 * 0-sum: if X >= Y componentwise and X != Y then sum(X) > sum(Y) strictly. The
 * corrected claim in (2) is the real one, and `test/balance.test.ts` pins both the
 * identity and the worked example so the bad version cannot creep back.
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
export const BALANCE_TOLERANCE_TOTAL = 1;

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
    | 'POWER_THRESHOLD_CLIFF'
    | 'SAME_IDEOLOGUE_SKEW'
    | 'RESOURCE_BLIND_LEAN'
    | 'IDEOLOGUE_SKEW'
    | 'VOTER_COST_NON_MONOTONIC'
    | 'VOTER_VALUE_UNDERREPRESENTED'
    | 'X_EFFECT_MAGNITUDE';
  readonly severity: BalanceSeverity;
  readonly deck: string;
  readonly cardId: string;
  /** Which side is at fault, for PURE_UPGRADE / TOTAL_SKEW / EMPTY_SIDE. */
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

/** D2 — total skew beyond the tolerance band. */
function totalSkew(x: number, y: number): number {
  return x - y;
}

/**
 * Analyse one Ideology Card. Pure, so a test can call it on a single fixture card.
 *
 * Both directions are tested: the card is a two-sided choice, so either side may
 * be the dominant one and the finding is reported against whichever is.
 */
export function analyseIdeologyCard(card: IdeologyCard, deck = 'unknown'): readonly BalanceFinding[] {
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

  // D2 — total skew outside the tolerance band. A tilt, not a removal.
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
        `(${pa} vs ${pb}); tolerance band is +/-${BALANCE_TOLERANCE_TOTAL}`,
    });
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
 */
function resourcePreferredSide(card: IdeologyCard): IdeologySide | null {
  const [a, b] = card.sides;
  if (a === undefined || b === undefined) return null;
  const pa = sidePayout(a);
  const pb = sidePayout(b);
  if (pa !== pb) return pa > pb ? a : b;
  // Equal totals. Fall back to the structural findings, which are still purely
  // about resources: if exactly one side has a structural advantage, that is the
  // side the payout structure favours.
  const aBetter =
    isPureUpgrade(a, b) || thresholdCrossings(a).size > thresholdCrossings(b).size;
  const bBetter =
    isPureUpgrade(b, a) || thresholdCrossings(b).size > thresholdCrossings(a).size;
  if (aBetter !== bBetter) return aBetter ? a : b;
  // Zero-sum, neither side structurally favoured: the card genuinely has no
  // resource answer. This is the good case.
  return null;
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
function resourceBlind(cards: readonly CorpusIdeologyCard[]): BiasStats['resourceBlind'] {
  const byIdeologue = blankIdeologues();
  let decisive = 0;
  for (const card of cards) {
    const winner = resourcePreferredSide(card);
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

export function deckBias(deck: string, cards: readonly CorpusIdeologyCard[]): BiasStats {
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
    resourceBlind: resourceBlind(cards),
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
};

export function balanceCorpus(input: BalanceInput): BalanceReport {
  const findings: BalanceFinding[] = [];
  const bias: BiasStats[] = [];
  let cardsChecked = 0;

  for (const [deck, cards] of input.ideology) {
    for (const card of cards) {
      cardsChecked += 1;
      findings.push(...analyseIdeologyCard(card as IdeologyCard, deck));
    }
    const stats = deckBias(deck, cards);
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
          `the higher-paying side is ${stats.resourceBlind.leadingIdeologue} on ` +
          `${stats.resourceBlind.decisive} of ${(stats.resourceBlind.leadShare * 100).toFixed(0)}% of ` +
          `decisive cards; threshold is ${(RESOURCE_BLIND_LEAN_THRESHOLD * 100).toFixed(0)}%. ` +
          'Players can learn the deck instead of reading the cards',
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
