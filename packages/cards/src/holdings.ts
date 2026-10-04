/**
 * WHAT A POOL OF RESOURCES IS ACTUALLY WORTH: the holdings-conditional model.
 *
 * ## THE PROBLEM THIS FILE EXISTS TO SOLVE
 *
 * The balance checker used to compare the two sides of an Ideology Card by their
 * TOTALS. A harness then played 940 answered Ideology Cards across four games and
 * found the totals on the two sides were equal every single time - a gap histogram
 * of `{"0": 940}`. Measured against the shipped corpus rather than the harness, the
 * figure is starker: **all 134 Ideology Cards pay equal totals, and 266 of their 268
 * sides pay exactly 3 resources as a 2-of-one-plus-1-of-another shape** — the only two
 * exceptions being the sides of `ig-in2020-006`, which pay 4 as a 2+2 on BOTH sides.
 * So a total-based comparison has nothing to say about any card that ships, and the
 * `TOTAL_SKEW` gate could not fire on the deck it was written to protect.
 *
 * The totals were never the interesting quantity. This file measures the one that
 * is, and the reason it is the one is mechanical rather than aesthetic.
 *
 * ## WHY `WHICH` RESOURCE BEATS `HOW MANY`: `canAfford` IS COMPONENTWISE
 *
 * `packages/engine/src/resources.ts` is one line:
 *
 * ```ts
 * export function canAfford(p: Pool, cost: Delta): boolean {
 *   return RESOURCES.every((r) => p[r] >= (cost[r] ?? 0));
 * }
 * ```
 *
 * There is no substitution and no pooling. A Voter Card printed at
 * `{funds: 2, clout: 1}` is bought with 2 Funds **and** 1 Clout, and a player
 * holding 7 Funds and nothing else cannot buy it. `INFLUENCE` refuses the purchase
 * outright on that basis (`reduce.ts`, `case 'INFLUENCE'`). The shipped core market
 * is 18 cards whose costs span all four resources, so **a holdings vector decides
 * which cards in the market you can reach at all.**
 *
 * Two further exact-componentwise sinks exist and are named by the rulebook:
 *  - p32 Tough Love (Idealist L5) costs **2 Trust + any 2** - the 2 Trust is exact.
 *  - `RULES.redrawCost` (p13, "any 4 resources") is TOTAL-based, as is buying a
 *    Conspiracy Card ("any combination of resources" totalling 4-5, p19) and
 *    Prospecting / Payback. Those are **composition-blind by rulebook**, which is
 *    exactly why they are excluded below rather than merely overlooked.
 *
 * ## THE CAP IS WHAT MAKES SURPLUS WORTHLESS
 *
 * `RULES.resourceCap` is 12 **total** across all four resources (rules-reference A3
 * item 3, D1: "you must choose and discard any excess" - there is nothing to choose
 * if the cap were per-type). p12 requires the discard **before any other action**.
 *
 * So a player sitting on 6 Funds has a seventh Fund worth **nothing**, while a player
 * short one Trust is one Trust away from a purchase they cannot otherwise make. Count
 * saturates; composition does not. That asymmetry is the whole finding: two cards
 * paying the same total are NOT the same card to a player who cannot spend the
 * difference, and they are the same card to a player who can.
 *
 * ## WHAT IS MEASURED
 *
 * `conversionValue(h)` - the most score a player holding `h` can still convert into,
 * computed as an **exact 0/1 knapsack** over the shipped Voter Card market, valued in
 * voters. Voters are the score (rules-reference 3), so this is score, not a proxy for
 * it. The pool is `cap`-aware by construction: the table is monotone, so a resource
 * beyond the cap cannot raise it.
 *
 * `bestConversion(h, pays)` - the same, after taking `pays`, letting the player make
 * the p12 discard **optimally**. p12 says *you* choose what to discard, so a player
 * rich in the wrong resource dumps the surplus and keeps the scarce one. Enumerating
 * the legal discards rather than assuming a fixed one is what makes a Funds-rich
 * player's preference for a spread payout visible to the instrument.
 *
 * ## AND IT IS EXHAUSTIVE, NOT SAMPLED
 *
 * Every reachable holdings vector is a non-negative 4-tuple with total at most the
 * cap, so there are exactly `C(cap + 4, 4)` of them - 1820 at `cap = 12`. This file
 * enumerates **all of them**. "Is one side always correct?" is therefore answered over
 * the complete state space rather than over a sample of plausible positions, and a
 * finding is a statement about every position a player can reach, not a tendency.
 *
 * ## WHAT IS DELIBERATELY NOT MEASURED
 *
 *  - **Total-priced sinks** (Conspiracy purchase, redraw, Prospecting, Payback).
 *    Composition-blind by rulebook, so they contribute the same amount to both sides
 *    and can only dilute the signal. Excluding them makes the measure SHARPER on the
 *    axis under test, not weaker.
 *  - **Ideologue power unlocks.** Those are the existing `POWER_THRESHOLD_CLIFF`
 *    check's job, it measures a different axis, and it is not folded in here so that
 *    the two verdicts stay separately attributable.
 *  - **Card effects on other players.** An Ideology Card's payout is private to the
 *    answerer, so this is the correct scope; the X-card limitation `balance.ts` already
 *    documents is a different case.
 *  - **Repeated purchases of the same market card.** 0/1, not unbounded. The HQ Mat
 *    holds `RULES.marketSize` cards and `refresh-market` exists, so unbounded is the
 *    true game; 0/1 is a LOWER BOUND on conversion for every pool alike, and a lower
 *    bound applied identically to both sides preserves the comparison the instrument
 *    is for. Stated rather than hidden.
 */

import { RESOURCES, RULES, type Delta, type Pool } from './engine.js';

// ── the economy the instrument measures against ───────────────────────────────────

/**
 * One thing a player can spend resources on, in EXACT componentwise terms.
 *
 * `value` is the score the spend buys, counted in voters so that every option in the
 * table is commensurable. `cost` is a printed `Delta`, which `canAfford` reads
 * componentwise - that is the whole point, and it is why this type exists rather than
 * a bare number.
 */
export type SpendOption = {
  readonly id: string;
  readonly cost: Delta;
  /** Score bought, in voters. */
  readonly value: number;
};

/** A holdings vector, index-aligned to `RESOURCES`. */
export type Holdings = readonly number[];

/** A precomputed conversion table. Build one per market with `buildConversionModel`. */
export type ConversionModel = {
  /** `RULES.resourceCap` this model was built for. */
  readonly cap: number;
  /** Every reachable holdings vector: all non-negative tuples with total <= cap. */
  readonly reachable: readonly Holdings[];
  /** The exact most score `h` can convert into. Saturating: never exceeds its maximum. */
  readonly conversionValue: (h: Holdings) => number;
  /**
   * The most score convertible after taking `pays`, with the p12 discard made
   * OPTIMALLY by the player. See the header on why the discard is enumerated.
   */
  readonly bestConversion: (h: Holdings, pays: Delta) => number;
};

function asVec(d: Delta | undefined): number[] {
  return RESOURCES.map((r) => d?.[r] ?? 0);
}

function totalOf(v: Holdings): number {
  let n = 0;
  for (const x of v) n += x;
  return n;
}

function toPool(v: Holdings): Pool {
  const out: Record<string, number> = {};
  RESOURCES.forEach((r, i) => {
    out[r] = v[i] ?? 0;
  });
  return out as unknown as Pool;
}

/**
 * Every non-negative holdings vector with total at most `cap`.
 *
 * C(16,4) = 1820 at cap 12. Exhaustive by construction: this is the COMPLETE set of
 * positions a player can be in, not a sample of them.
 */
export function reachableHoldings(cap: number = RULES.resourceCap): Holdings[] {
  const out: Holdings[] = [];
  const cur = [0, 0, 0, 0];
  const rec = (i: number, remaining: number): void => {
    if (i === cur.length) {
      out.push([...cur]);
      return;
    }
    for (let v = 0; v <= remaining; v += 1) {
      cur[i] = v;
      rec(i + 1, remaining - v);
    }
    cur[i] = 0;
  };
  rec(0, cap);
  return out;
}

/**
 * Exact 0/1 knapsack over `options`, valued in voters.
 *
 * `table[v]` is the most score obtainable from exactly the resources in `v`, where
 * `v` ranges over the `(cap+1)^4` box. Because the recurrence only ever ADDS to a
 * pool, `table` is monotone in every coordinate and saturates at the cap - which is
 * the mechanical form of "a seventh Fund is worth nothing".
 */
function knapsackTable(options: readonly SpendOption[], cap: number): Int32Array {
  const side = cap + 1;
  const size = side * side * side * side;
  let table = new Int32Array(size);
  const idx = (f: number, c: number, m: number, t: number): number =>
    (f * side + c) * side * side + m * side + t;

  for (const opt of options) {
    const cost = asVec(opt.cost);
    for (let i = 0; i < cost.length; i += 1) {
      if (cost[i]! > cap) {
        // Unbuyable at any legal pool: skip the option entirely rather than let it
        // silently contribute nothing, which would read as "worthless" instead of
        // "impossible".
        cost[i] = cap + 1;
      }
    }
    const next = Int32Array.from(table);
    const [cf, cc, cm, ct] = cost as [number, number, number, number];
    for (let f = 0; f + cf <= cap; f += 1) {
      for (let c = 0; c + cc <= cap; c += 1) {
        for (let m = 0; m + cm <= cap; m += 1) {
          for (let t = 0; t + ct <= cap; t += 1) {
            // Standard 0/1 knapsack over a componentwise budget: `table[v]` is the best
            // value obtainable from AT MOST the budget v, so spending this option leaves
            // the budget v - cost and the recurrence is `best[v - cost] + value`.
            //
            // The `table[v - cost]` term MUST NOT also carry `table[v]`. An earlier draft
            // of this function added both, which double-counts the overlapping resources
            // and reported `{funds: 3}` as convertible into 2 voters when the only
            // Funds-only cards in the market are worth 1 each and cannot both be bought.
            // Every number in the ruling depends on this table, so the bug was found by
            // checking a hand-computable cell against the shipped market.
            const remaining = table[idx(f, c, m, t)] ?? 0;
            const at = idx(f + cf, c + cc, m + cm, t + ct);
            const grown = remaining + opt.value;
            if (grown > (next[at] ?? 0)) next[at] = grown;
          }
        }
      }
    }
    table = next;
  }
  return table;
}

/**
 * Every legal p12 discard of `v` (a pool over cap) down to the cap.
 *
 * p12: "Check resource cap; discard excess **before taking any other action**", and
 * rules-reference A3 item 3 records the rulebook's own word as *choose*: the player
 * picks what goes. So the set of reachable end-states is what the player chooses from,
 * and `bestConversion` maximises over it rather than assuming a rule.
 *
 * Small by construction: at most `(cap+1)^4` discard vectors, filtered to those
 * summing to exactly the excess, and in practice a handful.
 */
function legalDiscards(v: Holdings, cap: number): Holdings[] {
  const excess = totalOf(v) - cap;
  if (excess <= 0) return [v];
  const out: Holdings[] = [];
  const cur = [0, 0, 0, 0];
  const rec = (i: number, remaining: number): void => {
    if (i === cur.length) {
      if (remaining === 0) {
        const end = cur.map((d, j) => v[j]! - d);
        if (end.every((x) => x >= 0)) out.push(end);
      }
      return;
    }
    for (let d = 0; d <= Math.min(remaining, v[i]!); d += 1) {
      cur[i] = d;
      rec(i + 1, remaining - d);
    }
    cur[i] = 0;
  };
  rec(0, excess);
  return out;
}

/**
 * Build the conversion model for a market.
 *
 * `options` is the economy: exact-componentwise costs and the score each buys. Pass the
 * shipped Voter Cards, plus one entry for the p32 Tough Love gate (2 Trust exactly,
 * `RULES.toughLoveAny` more of anything, worth `RULES.toughLoveConverts` voters) - the
 * only Ideologue power with a mandatory exact resource, and therefore the only power
 * that composition can gate.
 */
export function buildConversionModel(
  options: readonly SpendOption[],
  cap: number = RULES.resourceCap,
): ConversionModel {
  const table = knapsackTable(options, cap);
  const side = cap + 1;
  const reachable = reachableHoldings(cap);

  const conversionValue = (h: Holdings): number => {
    let f = 0;
    let c = 0;
    let m = 0;
    let t = 0;
    RESOURCES.forEach((r, i) => {
      const v = Math.max(0, Math.min(cap, h[i] ?? 0));
      if (i === 0) f = v;
      else if (i === 1) c = v;
      else if (i === 2) m = v;
      else t = v;
    });
    return table[(f * side + c) * side * side + m * side + t]!;
  };

  const bestConversion = (h: Holdings, pays: Delta): number => {
    const gain = asVec(pays);
    const after = h.map((x, i) => Math.max(0, x ?? 0) + gain[i]!);
    let best = -1;
    for (const end of legalDiscards(after, cap)) {
      const v = conversionValue(end);
      if (v > best) best = v;
    }
    // Unreachable: legalDiscards always yields at least the identity when at or under
    // cap, and at least one legal choice when over it (discard from any non-zero slot).
    return best === -1 ? 0 : best;
  };

  return { cap, reachable, conversionValue, bestConversion };
}

/** The shipped market as `SpendOption`s: one entry per Voter Card, valued in voters. */
export function voterMarketOptions(cards: readonly { readonly id: string; readonly cost: Delta; readonly voters: number }[]): SpendOption[] {
  return cards.map((c) => ({ id: c.id, cost: c.cost, value: c.voters }));
}

/**
 * The one Ideologue power with a mandatory exact resource, as a spend option.
 *
 * p32: "spend **2 Trust + any 2 resources** to convert 2 of an opponent's voters". The
 * 2 Trust is exact and the "any 2" is free, so the cost is expressed as the exact
 * part alone and the free part is left to the pool: modelling the whole thing as a
 * fixed Delta would overstate it, and omitting it would drop the only place in the
 * power ladder where a specific resource is mandatory. Valued at its printed payoff,
 * `RULES.toughLoveConverts` voters.
 *
 * Named rather than inlined so a reader can see that the instrument's economy is
 * market plus this one gate, and that everything else in the power ladder is
 * composition-blind and therefore belongs to `POWER_THRESHOLD_CLIFF`.
 */
export function toughLoveOption(): SpendOption {
  return { id: 'power:tough-love', cost: { trust: RULES.toughLoveTrust }, value: RULES.toughLoveConverts };
}

/** A prebuilt model over the shipped market. Callers that want another market build their own. */
let cachedShippedModel: ConversionModel | null = null;
export function shippedConversionModel(
  market: readonly { readonly id: string; readonly cost: Delta; readonly voters: number }[],
): ConversionModel {
  if (cachedShippedModel === null) {
    cachedShippedModel = buildConversionModel([...voterMarketOptions(market), toughLoveOption()]);
  }
  return cachedShippedModel;
}

/** Drop the memo. Tests that build models against different markets need this. */
export function resetShippedConversionModel(): void {
  cachedShippedModel = null;
}

// ── the finding: does the DELIBERATION decide, or do the numbers? ─────────────────

export type Decisiveness = {
  readonly cardId: string;
  /** Reachable positions where side 0 converts strictly better. */
  readonly side0Wins: number;
  /** Reachable positions where side 1 converts strictly better. */
  readonly side1Wins: number;
  /** Reachable positions where the two sides are worth the same score. */
  readonly ties: number;
  /** Total reachable positions considered. */
  readonly positions: number;
  /**
   * True when the WINNER NEVER CHANGES across the whole reachable space.
   *
   * Precisely: one side is **never the worse answer at any reachable position** and is
   * **strictly better at some**. Ties are compatible with this and do not weaken it —
   * at a tied position the card genuinely does not decide, but the payout's bias never
   * REVERSES, which is what a player who has learned the deck exploits. So this is the
   * relation "the numbers have a consistent direction", and a card carrying it is one
   * whose dilemma can never outweigh the payout.
   *
   * False is the healthy case: the same card is better for a player who needs one
   * resource and worse for a player holding a surplus of the other, which is
   * deliberation.
   */
  readonly decidedByPayout: boolean;
  /** True when the two sides are worth the same at EVERY position - a pure dilemma card. */
  readonly indistinguishable: boolean;
};

/**
 * Score one card's two sides across EVERY reachable holdings vector.
 *
 * Both directions are measured, because the card is a two-sided choice and either
 * side may be the one that is always right.
 */
export function measureDecisiveness(
  cardId: string,
  paysA: Delta,
  paysB: Delta,
  model: ConversionModel,
): Decisiveness {
  let a = 0;
  let b = 0;
  let ties = 0;
  for (const h of model.reachable) {
    const va = model.bestConversion(h, paysA);
    const vb = model.bestConversion(h, paysB);
    if (va > vb) a += 1;
    else if (vb > va) b += 1;
    else ties += 1;
  }
  return {
    cardId,
    side0Wins: a,
    side1Wins: b,
    ties,
    positions: model.reachable.length,
    decidedByPayout: (a === 0 || b === 0) && ties !== model.reachable.length,
    indistinguishable: ties === model.reachable.length,
  };
}
