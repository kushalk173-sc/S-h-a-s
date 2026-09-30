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
 * Deterministic fallback trim, used by bots and by the "auto-discard" convenience.
 * Sheds from the largest pool first so a player never loses their scarcest resource.
 */
export function trimToCap(p: Pool, cap: number): Pool {
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
