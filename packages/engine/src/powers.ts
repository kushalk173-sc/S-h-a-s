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
  type Ideologue,
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

export function hasPower(player: PlayerState, rules: Rules, id: PowerID): boolean {
  const spec = powerSpec(id);
  const need = spec.level === 3 ? rules.level3 : rules.level5;
  return cardsOf(player, spec.ideologue) >= need;
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
export function usesLeft(player: PlayerState, rules: Rules, id: PowerID): number {
  if (!hasPower(player, rules, id)) return 0;
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
