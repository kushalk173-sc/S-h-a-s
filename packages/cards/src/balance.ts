/**
 * THE BALANCE CHECKER.
 *
 * PLAN.md 9 risk #2: *"If one side of a card is strictly better, players optimise
 * instead of deliberating and the entire premise collapses."* This file is the
 * thing that protects the premise, so it gets a real dominance relation rather
 * than a total-sum comparison.
 *
 * WHY TOTAL-SUM COMPARISON IS NOT ENOUGH (docs/ARCHITECTURE.md 6.4):
 *   - It flags legitimate trade-offs. `{funds:3}` vs `{trust:3}` is a 3-resource
 *     difference and a perfectly good card — the choice is "which resource do I
 *     need", which is the deliberation the game is made of.
 *   - It misses the real failures. `{funds:3}` vs `{funds:2, media:1}` is 0-sum and
 *     yet a pure upgrade for anyone who needs funds. And a card paying 3 of one
 *     resource on side A and 2 on side B straddles the level-3 power threshold,
 *     so A is worth far more than 1 resource.
 */

import {
  IDEOLOGUES,
  IDEOLOGUE_RESOURCE,
  RESOURCES,
  RULES,
  sidePayout,
  type Delta,
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
 *  - **D1 and D3 override the band entirely.** A 0-sum PURE_UPGRADE and a
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
    | 'VOTER_VALUE_UNDERREPRESENTED';
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
 * 5, and an unlocked power pays out every turn for the rest of the game. So a
 * card that carries you over a threshold is worth several resources immediately
 * and forever, which is why a 1-resource gap here outranks the tolerance band.
 *
 * Modelled as a COUNT of threshold crossings rather than as "this side pays 3 of
 * something the other does not", because the naive per-direction test is wrong in
 * a way that produces a flood of false positives on exactly the cards the game is
 * made of. Consider `{trust: 3}` against `{funds: 3}`: per direction, each side
 * pays 3 of a resource the other pays none of, so a per-direction test reports a
 * cliff TWICE and declares a card dominated that is in fact perfectly symmetric —
 * both sides buy one unlock, and the choice of which unlock is real deliberation.
 *
 * So: crossings(X) is the set of `resource@threshold` pairs X's payout reaches, and
 * a cliff exists only when |crossings(X)| > |crossings(Y)|. Equal counts, even
 * when the sets are entirely different, are not dominance. A side that buys two
 * unlocks against an opponent's one is a real cliff, and that is what this finds:
 * `{clout: 5}` crosses clout@3 and clout@5, so it beats `{trust: 4}`, which
 * crosses only trust@3 — even though neither resource appears on the other side.
 */
function thresholdCrossings(side: IdeologySide): Set<string> {
  const out = new Set<string>();
  for (const res of RESOURCES) {
    const v = side.pays[res] ?? 0;
    for (const threshold of [RULES.level3, RULES.level5] as const) {
      if (v >= threshold) out.add(`${res}@${threshold}`);
    }
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

// ─────────────────────────── the report ───────────────────────────

export type BalanceInput = {
  /** Deck id → its Ideology Cards, for the per-deck statistics. */
  readonly ideology: ReadonlyMap<string, readonly CorpusIdeologyCard[]>;
  /** Deck id → its Voter Cards. */
  readonly voter: ReadonlyMap<string, readonly CorpusVoterCard[]>;
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

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return { findings, errors, warnings, bias, cardsChecked };
}
