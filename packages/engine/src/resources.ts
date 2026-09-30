import { EMPTY_POOL, RESOURCES, poolTotal, type Delta, type Pool, type Resource } from './state';

export function pool(d: Delta): Pool {
  return {
    funds: d.funds ?? 0,
    clout: d.clout ?? 0,
    media: d.media ?? 0,
    trust: d.trust ?? 0,
  };
}

export function add(a: Pool, b: Delta): Pool {
  return {
    funds: a.funds + (b.funds ?? 0),
    clout: a.clout + (b.clout ?? 0),
    media: a.media + (b.media ?? 0),
    trust: a.trust + (b.trust ?? 0),
  };
}

export function subtract(a: Pool, b: Delta): Pool {
  return {
    funds: a.funds - (b.funds ?? 0),
    clout: a.clout - (b.clout ?? 0),
    media: a.media - (b.media ?? 0),
    trust: a.trust - (b.trust ?? 0),
  };
}

export function canAfford(p: Pool, cost: Delta): boolean {
  return RESOURCES.every((r) => p[r] >= (cost[r] ?? 0));
}

/**
 * Reject a client-supplied `Delta` that is not a non-negative cost or payout.
 *
 * `Delta` is `Partial<Record<Resource, number>>` and `number` includes negatives,
 * so this cannot be a type. Without this guard, `deltaTotal` sums *signed* values
 * and every total-based check passes: `{funds: 5, trust: -3}` totals 2, satisfies
 * a "choose exactly 2" pick, and `takeResources` skips the negative entirely while
 * `addResources` credits the positive — so the player mints 5 Funds. R3.
 *
 * Non-integer and non-finite values are rejected for the same reason: they would
 * desync the pool arithmetic across clients.
 *
 * Returns an error string, or null when the delta is acceptable. Call sites in
 * the reducer turn it into a `fail(...)`.
 */
export function deltaError(d: Delta, label: string): string | null {
  for (const r of RESOURCES) {
    const v = d[r];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return `${label}: ${r} must be a finite number`;
    }
    if (!Number.isInteger(v)) return `${label}: ${r} must be a whole number`;
    if (v < 0) return `${label}: ${r} cannot be negative`;
  }
  return null;
}

/** How much of `cost` the pool is short by, per resource. Used for UI hints and bots. */
export function shortfall(p: Pool, cost: Delta): Pool {
  return {
    funds: Math.max(0, (cost.funds ?? 0) - p.funds),
    clout: Math.max(0, (cost.clout ?? 0) - p.clout),
    media: Math.max(0, (cost.media ?? 0) - p.media),
    trust: Math.max(0, (cost.trust ?? 0) - p.trust),
  };
}

export function isEmpty(d: Delta): boolean {
  return RESOURCES.every((r) => (d[r] ?? 0) === 0);
}

/** Resources over the cap. p12: the player must choose what to discard. */
export function overCap(p: Pool, cap: number): number {
  return Math.max(0, poolTotal(p) - cap);
}

/**
 * A bot's guess at what to discard, down to the cap. NOT a rule.
 *
 * p12 (`rules-reference.md:110`): "If at any time you cross your resource cap,
 * you must **choose** and discard any excess resources down to your current
 * resource cap. You cannot take any other actions until you do so." The verb is
 * *choose* — the discard is the player's, which is why the real path is the
 * `lose-any` choice the reducer raises in `enforceCap` and a human resolves. This
 * function is the stand-in for a machine that cannot pick: it sheds from the
 * largest pool first so a bot never throws away its scarcest resource, and it
 * breaks ties by `RESOURCES` declaration order (`funds`, `clout`, `media`,
 * `trust`), so equal pools shed Funds first.
 *
 * R11, ruled: those two tie-breaks are *decisions*, not rules — the rulebook
 * settles neither, and neither has any claim to being good play. So the function is
 * renamed `botTrimToCap` and documented as the heuristic it is. Renaming rather
 * than deleting keeps it available to the bot and "auto-discard" callers it was
 * written for while removing the claim that the engine itself would trim this way;
 * nothing in `reduce` calls it, and a test pins that fact by showing a player over
 * the cap is *asked* rather than trimmed. Nothing in this repository imported the
 * old name.
 */
export function botTrimToCap(p: Pool, cap: number): Pool {
  let out = { ...p };
  let excess = overCap(out, cap);
  while (excess > 0) {
    let biggest: Resource = 'funds';
    for (const r of RESOURCES) if (out[r] > out[biggest]) biggest = r;
    if (out[biggest] === 0) break;
    out = { ...out, [biggest]: out[biggest] - 1 };
    excess -= 1;
  }
  return out;
}

/** Apply a discount: pay 1 less of `res`. p32 Helping Hands. Never below zero. */
export function discount(cost: Delta, res: Resource): Delta {
  const have = cost[res] ?? 0;
  if (have <= 0) return cost;
  return { ...cost, [res]: have - 1 };
}

export function applyDiscounts(cost: Delta, discounts: readonly Resource[]): Delta {
  return discounts.reduce<Delta>((c, r) => discount(c, r), cost);
}

export { EMPTY_POOL, poolTotal };
