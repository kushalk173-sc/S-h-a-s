/**
 * Ideologue Powers. p15, p28–33.
 *
 * Powers are *derived* from the manifesto, never stored. p22 makes this mandatory:
 * an Elite loses its power the moment its requirement lapses, and the same logic
 * applies to a Level 5 power if cards ever leave a manifesto (coalitions do exactly
 * that). Caching unlocked powers would make that a bug waiting to happen.
 */

import type { Rules } from './rules';
import {
  IDEOLOGUES,
  IDEOLOGUE_RESOURCE,
  tally,
  type Delta,
  type GameState,
  type Ideologue,
  type PlayerID,
  type PlayerState,
} from './state';

export type PowerID =
  | 'prospecting' // Capitalist L3 — trade 1 resource for 2
  | 'land-grab' // Capitalist L5 — evict 3 voters
  | 'donations' // Supremo L3 — snatch 2 resources
  | 'payback' // Supremo L5 — discard 2 voters
  | 'going-viral' // Showstopper L3 — +1 voter per Voter Card, twice
  | 'election-fever' // Showstopper L5 — +1 gerrymander per zone
  | 'helping-hands' // Idealist L3 — 2 purchase discounts
  | 'tough-love'; // Idealist L5 — convert 2 voters

export type PowerSpec = {
  readonly id: PowerID;
  readonly ideologue: Ideologue;
  readonly level: 3 | 5;
  readonly name: string;
  readonly text: string;
};

export const POWERS: readonly PowerSpec[] = [
  {
    id: 'prospecting',
    ideologue: 'capitalist',
    level: 3,
    name: 'Prospecting',
    text: 'Once per turn, give 1 resource to the Public Reserve to get up to 2 resources of your choice.',
  },
  {
    id: 'land-grab',
    ideologue: 'capitalist',
    level: 5,
    name: 'Land Grab',
    text: 'Three times per turn, evict any 1 voter from the board and send it back to its player (including majority voters).',
  },
  {
    id: 'donations',
    ideologue: 'supremo',
    level: 3,
    name: 'Donations',
    text: 'Twice per turn, snatch 1 resource from another player.',
  },
  {
    id: 'payback',
    ideologue: 'supremo',
    level: 5,
    name: 'Payback',
    text: "Twice per turn, spend 1 resource to discard an opponent's voter (including majority voters).",
  },
  {
    id: 'going-viral',
    ideologue: 'showstopper',
    level: 3,
    name: 'Going Viral',
    text: 'Twice per turn, get +1 voter for any Voter Card that you influence.',
  },
  {
    id: 'election-fever',
    ideologue: 'showstopper',
    level: 5,
    name: 'Election Fever',
    text: 'Gerrymander 2 voters instead of 1 for every zone where you have Gerrymandering Rights (including majority voters).',
  },
  {
    id: 'helping-hands',
    ideologue: 'idealist',
    level: 3,
    name: 'Helping Hands',
    text: 'Twice per turn, get a 1-resource discount on any purchase.',
  },
  {
    id: 'tough-love',
    ideologue: 'idealist',
    level: 5,
    name: 'Tough Love',
    text: "Once per turn, spend 2 Trust + any 2 resources to convert 2 of an opponent's voters into yours.",
  },
];

const BY_ID = new Map(POWERS.map((p) => [p.id, p]));

export function powerSpec(id: PowerID): PowerSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`unknown power ${id}`);
  return spec;
}

/** How many Ideology Cards of one Ideologue a player holds. */
export function cardsOf(player: PlayerState, ideologue: Ideologue): number {
  return tally(player.manifesto)[ideologue];
}

export function hasPower(player: PlayerState, rules: Rules, id: PowerID, borrowedFrom?: readonly PlayerState[]): boolean {
  const spec = powerSpec(id);
  const need = spec.level === 3 ? rules.level3 : rules.level5;
  if (cardsOf(player, spec.ideologue) >= need) return true;
  // G14a. A BORROWED power is a LEVEL 3 power, and the level check is the ruling
  // rather than a detail: `RestrictionKind`'s `'borrowed-powers'` note is the long
  // version, and the short version is that every Level 3 power is consulted through
  // `usesLeft` (this file) while Election Fever is passive and is read by
  // `gerrymanderAllowance` in `reduce.ts`. Borrowing a Level 5 power would therefore be
  // a power that is available when its action checks `usesLeft` and unavailable when
  // it does not. Both real cards ask for Level 3, so nothing is narrowed.
  if (spec.level !== 3) return false;
  return (borrowedFrom ?? []).some((donor) => cardsOf(donor, spec.ideologue) >= need);
}

/**
 * G14a — the players whose manifests this player may currently count.
 *
 * Read out of `restrictions` rather than stored, for the reason `hasPower` is derived
 * from the manifesto and never cached (p22, and the note at the top of this file): a
 * borrow that outlived its donor's manifesto would be an Elite keeping a power their
 * requirement no longer supports.
 *
 * **`expiresTurn` IS NOT CHECKED HERE**, for exactly the reason `usesLeft` does not
 * check it for `no-power`: `expiresTurn` is an absolute turn number and
 * `expireRestrictions` in `advanceTurn` is the single place that removes what has run
 * out, on the same clock that resets `powerUses`. Re-deriving the deadline here would
 * be a second definition of the same expiry.
 *
 * Reads only public state — a `PlayerState.manifesto` is face-up under a player's own
 * mat (p13) and is on every client's payload — so it adds no `_` field and owes
 * `packages/server/test/secret-inventory.ts` nothing.
 */
export function borrowedFrom(state: GameState, player: PlayerID): readonly PlayerState[] {
  const out: PlayerState[] = [];
  const seen = new Set<PlayerID>();
  for (const r of state.players[player]?.restrictions ?? []) {
    if (r.kind !== 'borrowed-powers') continue;
    if (seen.has(r.sourcePlayer)) continue;
    const donor = state.players[r.sourcePlayer];
    if (donor === undefined) continue;
    seen.add(r.sourcePlayer);
    out.push(donor);
  }
  return out;
}

export function unlockedPowers(player: PlayerState, rules: Rules): PowerID[] {
  return POWERS.filter((p) => hasPower(player, rules, p.id)).map((p) => p.id);
}

/**
 * p15/p28: "For every 2 Ideology Cards you hold of an Ideologue, get 1 extra
 * resource of that type." Paid at the start of the turn, when the card is answered.
 */
export function passiveBonus(player: PlayerState, rules: Rules): Delta {
  const counts = tally(player.manifesto);
  const out: Delta = {};
  for (const i of IDEOLOGUES) {
    const n = Math.floor(counts[i] / rules.passiveBonusPer);
    if (n > 0) out[IDEOLOGUE_RESOURCE[i]] = (out[IDEOLOGUE_RESOURCE[i]] ?? 0) + n;
  }
  return out;
}

/**
 * The Ideologue a player most resembles. Cosmetic — the rules never key off it —
 * but it is the identity the UI shows, and players care about it a great deal.
 */
export function archetype(player: PlayerState): Ideologue | null {
  const counts = tally(player.manifesto);
  let best: Ideologue | null = null;
  let bestN = 0;
  let tied = false;
  for (const i of IDEOLOGUES) {
    const n = counts[i];
    if (n > bestN) {
      best = i;
      bestN = n;
      tied = false;
    } else if (n === bestN && n > 0) {
      tied = true;
    }
  }
  return tied || bestN === 0 ? null : best;
}

/** Remaining uses of a power this turn, or 0 if it is not unlocked. */
export function usesLeft(
  player: PlayerState,
  rules: Rules,
  id: PowerID,
  borrowedFrom?: readonly PlayerState[],
): number {
  // G5's `no-power`, and THE consult point for it. Every `POWER_*` case in `reduce()`
  // already asks this function whether the power is available, so returning 0 here is
  // what makes the restriction total across the whole vocabulary — one edit rather
  // than seven, and it cannot drift: a power added later consults the restriction the
  // moment its action asks, which every one of them must do already.
  //
  // It is `0` rather than a reduced allowance because the printed card says "you
  // CANNOT USE" and not "you have fewer uses". Expiry is NOT tested here and that is
  // deliberate: `expiresTurn` is absolute and `expireRestrictions` in `advanceTurn`
  // removes what has run out, on the same clock that resets `powerUses`. This function
  // takes a `PlayerState`, not a `GameState`, so it cannot see the turn, and
  // re-deriving the deadline from the player alone would be a SECOND definition of the
  // same expiry — which is how a restriction lives one turn too long in one place and
  // not another. See `RestrictionKind` in state.ts.
  if ((player.restrictions ?? []).some((r) => r.kind === 'no-power')) return 0;
  if (!hasPower(player, rules, id, borrowedFrom)) return 0;
  const u = player.powerUses;
  switch (id) {
    case 'prospecting':
      return rules.prospectingPerTurn - u.prospecting;
    case 'land-grab':
      return rules.landGrabPerTurn - u.landGrab;
    case 'donations':
      return rules.donationsPerTurn - u.donations;
    case 'payback':
      return rules.paybackPerTurn - u.payback;
    case 'going-viral':
      return rules.goingViralPerTurn - u.goingViral;
    case 'helping-hands':
      return rules.helpingHandsPerTurn - u.helpingHands;
    case 'tough-love':
      return rules.toughLovePerTurn - u.toughLove;
    case 'election-fever':
      // Passive while held — no per-turn counter.
      return 1;
  }
}
