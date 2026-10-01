/**
 * Core state types for SHASN.
 *
 * Every rule referenced here is recorded in `docs/rules-reference.md` with a page
 * number from the Collectors Edition rulebook.
 *
 * CONVENTION: any field prefixed with `_` is SERVER-ONLY and must be stripped
 * before the state is sent to a client. See `playerView.ts`. This is not a style
 * choice — the blind-answer mechanic dies if card payouts reach the client, so the
 * underscore is load-bearing and enforced by test.
 */

import type { Effect, EffectCondition, EffectTrigger } from './cards';

export type PlayerID = string;
export type CardID = string;
export type AreaID = string;

/** The nine constituencies. Fixed set — the board is not procedurally generated. */
export type ZoneID =
  | 'north_west'
  | 'north'
  | 'north_east'
  | 'west'
  | 'central'
  | 'east'
  | 'south_west'
  | 'south'
  | 'south_east';

export const ZONE_IDS: readonly ZoneID[] = [
  'north_west',
  'north',
  'north_east',
  'west',
  'central',
  'east',
  'south_west',
  'south',
  'south_east',
] as const;

/** The four Ideologues. Every Ideology Card answer belongs to exactly one. */
export type Ideologue = 'capitalist' | 'supremo' | 'showstopper' | 'idealist';

/** The four resources. Each maps one-to-one onto an Ideologue. */
export type Resource = 'funds' | 'clout' | 'media' | 'trust';

export const IDEOLOGUES: readonly Ideologue[] = [
  'capitalist',
  'supremo',
  'showstopper',
  'idealist',
] as const;

export const RESOURCES: readonly Resource[] = ['funds', 'clout', 'media', 'trust'] as const;

/** Rulebook p11 & p33. Capitalist→Funds, Supremo→Clout, Showstopper→Media, Idealist→Trust. */
export const IDEOLOGUE_RESOURCE: Readonly<Record<Ideologue, Resource>> = {
  capitalist: 'funds',
  supremo: 'clout',
  showstopper: 'media',
  idealist: 'trust',
};

export const RESOURCE_IDEOLOGUE: Readonly<Record<Resource, Ideologue>> = {
  funds: 'capitalist',
  clout: 'supremo',
  media: 'showstopper',
  trust: 'idealist',
};

/** A fully-populated resource pool. Never partial. */
export type Pool = { readonly [R in Resource]: number };

/** A cost or payout. Partial — omitted resources mean zero. */
export type Delta = Partial<Record<Resource, number>>;

/**
 * One voter peg sitting in one Area.
 * `majority` is the physical act of flipping the peg symbol-side up (p8).
 */
export type Peg = {
  readonly owner: PlayerID;
  readonly majority: boolean;
};

/** One slot on the board. p34: "Each slot on the board where a voter can be placed." */
export type Area = {
  readonly id: AreaID;
  readonly zone: ZoneID;
  /** p18. A peg here is permanent and triggers a Headline when placed. */
  readonly volatile: boolean;
  readonly peg: Peg | null;
};

export type Zone = {
  readonly id: ZoneID;
  readonly name: string;
  /** Voters one player needs to take the zone. The numerator of the printed fraction. */
  readonly majority: number;
  /** Total areas. The denominator of the printed fraction. */
  readonly capacity: number;
  readonly neighbours: readonly ZoneID[];
  readonly areas: readonly Area[];
  /** Who currently holds the majority here, or null. Derived; cached for the UI. */
  readonly majorityHolder: PlayerID | null;
};

/**
 * Voters a player has influenced but not yet placed.
 *
 * p10: voters from a single Voter Card cannot be split across zones; voters from
 * any other source can be.
 *
 * A group lives on the mat of the player who must place it, and is discarded at the
 * end of *that player's* turn. That single rule covers both published cases: voters
 * you influence must be placed the same turn (p10), and an evicted voter is placed
 * on its owner's next turn or discarded (p34).
 */
export type PendingVoters = {
  readonly id: string;
  readonly count: number;
  /** true for Voter Card groups, false for evictions, headlines, conspiracies. */
  readonly sameZone: boolean;
  readonly source: string;
};

/** Per-turn use counters for Ideologue Powers. Reset at the start of every turn. */
export type PowerUses = {
  readonly prospecting: number;
  readonly landGrab: number;
  readonly donations: number;
  readonly payback: number;
  readonly goingViral: number;
  readonly helpingHands: number;
  readonly toughLove: number;
  /** Zone IDs already gerrymandered from this turn, and how many moves used there. */
  readonly gerrymandered: Readonly<Record<string, number>>;
};

export const NO_POWER_USES: PowerUses = {
  prospecting: 0,
  landGrab: 0,
  donations: 0,
  payback: 0,
  goingViral: 0,
  helpingHands: 0,
  toughLove: 0,
  gerrymandered: {},
};

export type PlayerState = {
  readonly id: PlayerID;
  readonly name: string;
  /** Peg colour. Purely presentational, but stable and server-assigned. */
  readonly colour: string;
  readonly resources: Pool;
  /** One entry per answered Ideology Card, in answer order. p13. */
  readonly manifesto: readonly Ideologue[];
  /** Card IDs of answered Ideology Cards, parallel to `manifesto`. Public — the card
   *  is face up under the mat once answered. */
  readonly manifestoCards: readonly CardID[];
  readonly conspiracies: readonly CardID[];
  readonly pending: readonly PendingVoters[];
  readonly powerUses: PowerUses;
  readonly isBot: boolean;
};

/**
 * Which pegs a voter-targeting decision may name.
 *
 * THE RULING, and it is a ruling because the corpus needs two different answers.
 * RED BLOODED (REF 4.3) says *"You must discard any 2 voters"* — any peg on the
 * board. AIN'T NO CURE FOR LOVE (REF 4.3) says *"Discard 2 of your own voters"* —
 * only the chooser's own. Both are real cards, both land on `discard-voter`, and
 * the engine cannot tell them apart without a second field on the op.
 *
 * So the scope is derived from WHO is being asked, which is the one thing the card
 * always states and the one thing that reads correctly either way:
 *
 * | who resolves it | scope | why |
 * |---|---|---|
 * | the caster, no `target` | `'others'` | the card did not say "your own"; the three shipped cards say "your opponents'" |
 * | a player the card named | `'own'` | *"All your opponents evict 1 voter"* — they choose which of theirs, exactly as a victim of a theft picks the denomination |
 * | the caster, evicting | `'any'` | eviction already allowed any peg before this field existed, and `evict` is the one op whose real text says "any voter" |
 *
 * `'others'` is the default and it is deliberately unchanged from what `resolveChoice`
 * did before this type existed, so no shipped card's behaviour moves and the client's
 * own copy of this rule (`packages/client/src/app/derive.ts`) keeps agreeing with it.
 * `'own'` is reachable only by naming the victim with `target`, which is what makes
 * "discard 2 of your own voters" expressible at all.
 */
export type ChoiceScope = 'any' | 'others' | 'own';

/**
 * A decision the engine is waiting on. Conspiracies and Headlines are data, and
 * some of their effects need a target the engine cannot pick for the player.
 */
export type Choice =
  | { readonly kind: 'gain-any'; readonly count: number; readonly reason: string }
  | { readonly kind: 'lose-any'; readonly count: number; readonly reason: string }
  | {
      readonly kind: 'steal-any';
      readonly count: number;
      /**
       * The fixed victim, or null when the thief picks one.
       *
       * Set when the card named its victims (`target`), and also when a live effect
       * fires on somebody's purchase — LAB-GROWN EARWORM's victim is whoever just
       * bought, which is event context rather than a card field. `resolveChoice`
       * REQUIRES a pick to name this player, so a client cannot redirect the theft.
       */
      readonly from: PlayerID | null;
      readonly reason: string;
    }
  | { readonly kind: 'evict-voter'; readonly count: number; readonly scope: ChoiceScope; readonly reason: string }
  | { readonly kind: 'discard-voter'; readonly count: number; readonly scope: ChoiceScope; readonly reason: string }
  | { readonly kind: 'convert-voter'; readonly count: number; readonly scope: ChoiceScope; readonly reason: string };

/** Whose decision it is. Headlines can penalise a player who is not the active one. */
export type PendingChoice = {
  readonly id: string;
  readonly player: PlayerID;
  readonly choice: Choice;
};

export type Phase =
  /** The active player has an Ideology Card put to them and has not answered. */
  | 'answer'
  /** Free-form turn actions, any order, repeatable. p21. */
  | 'actions'
  /** Post-turn: one Headline per voter placed in a Volatile Area this turn. p18. */
  | 'headlines'
  | 'finished';

export type LogEntry = {
  readonly turn: number;
  readonly player: PlayerID | null;
  readonly text: string;
  readonly kind: 'answer' | 'voters' | 'majority' | 'gerrymander' | 'power' | 'card' | 'system';
};

/** A face-up Voter Card on the HQ Mat. Public information. */
export type MarketSlot = {
  readonly cardId: CardID;
  readonly cost: Delta;
  readonly voters: number;
};

/**
 * G9 / G22 — AN EFFECT THAT OUTLIVES THE CARD THAT INSTALLED IT.
 *
 * Before this type, `reduce()` resolved a Conspiracy or Headline Card's `effects`
 * once, discarded the card, and had no way to remember that the card had said
 * anything lasting. Every real card in that position — PYTHONPOST, GROWING
 * DISSENT, SNOOP B-O-DOUBLE-T, THE BIG FREEZE — therefore had to ship as a lie or
 * not at all (KNOWN-GAPS §2 G9, §3 item 2).
 *
 * ## Visibility: PUBLIC, and that is a ruling with an argument, not an omission
 *
 * `playerView.ts` strips `_`-prefixed keys and separately blanks
 * `PlayerState.conspiracies`, because a Conspiracy Card is a hidden hand
 * (rules-reference.md:284-286). A live effect is neither:
 *
 *  - It can only be created by a card that is being RESOLVED — `PLAY_CONSPIRACY`
 *    or `ACK_HEADLINE` — and both of those put the card face up on the discard pile
 *    in the same breath. There is no path from a card in a hidden hand to a
 *    `LiveEffect`, so `sourceCardId` can never name a card anybody is still holding
 *    secretly.
 *  - Every real card that creates one announces it. KHAKI TERROR's whole point is
 *    that everyone can see you cannot buy; a surcharge on somebody's purchases is
 *    a cost every other player must be able to predict. "A Headline is in force
 *    until my next turn" is a public condition with public parameters.
 *
 * So `liveEffects` is unprefixed and reaches every client. That is also why no
 * change is owed to `packages/server/test/secret-inventory.ts`: a new `_` field
 * would have needed a deliberate entry there, and this avoided the need entirely.
 * If a future card ever needs a *hidden* live effect — THE PSYCHOHISTORIAN's
 * unrevealed three-action detector is G7, and it is exactly that case — the
 * mechanism is a `_`-prefixed twin list, not a re-interpretation of this one.
 *
 * ## Why the lifetime is two integers and not a rule
 *
 * `activeFrom` / `expiresAt` are ABSOLUTE turn numbers, computed once at install
 * from the installing turn and the seat order. A live effect therefore needs no
 * "whose turn is it" logic at expiry time, and — the load-bearing part — a replay
 * from seed + action log reproduces it exactly, because the numbers are already in
 * the state that was written down. `null` on `expiresAt` is "rest of game".
 */
export type LiveEffect = {
  /** `L<n>` from `GameState._idSeq`. R2: no module-scope counter. */
  readonly id: string;
  /**
   * The player the effect belongs to. Its `target` resolves against them, and it
   * is the seat whose turn boundary a standing effect acts on.
   */
  readonly owner: PlayerID;
  /** The card that installed it. Public for the reason in the note above. */
  readonly sourceCardId: CardID;
  /**
   * The event that fires this effect, or `null` for a STANDING effect — one with a
   * lifetime but no event, re-applied at the top of every one of the owner's turns
   * until it expires. That is ERADICATING GERMS' "discard an open Voter Card every
   * turn (mandatory)".
   */
  readonly trigger: EffectTrigger | null;
  /** Narrowing on the firing event. Absent means "always". */
  readonly condition?: EffectCondition;
  readonly effects: readonly Effect[];
  /** The first turn number on which this effect may act. */
  readonly activeFrom: number;
  /** The turn number on which it is removed. `null` = rest of game. */
  readonly expiresAt: number | null;
};

/** Is this live effect in force on `turn`? Dormant-before and expired-both read false. */
export function isInForce(le: LiveEffect, turn: number): boolean {
  if (le.activeFrom > turn) return false;
  return le.expiresAt === null || le.expiresAt > turn;
}

/**
 * The turn number on which `owner` next takes their turn.
 *
 * `turnOrder` is the seat order, and turn N belongs to `turnOrder[(N-1) % n]` —
 * `setup()` deals the first card to `turnOrder[0]` and `advanceTurn` walks the list
 * from the outgoing player's own index, so the offset arithmetic below is exact
 * rather than approximate. An unknown seat falls back to "the very next turn",
 * which is the conservative answer: expire sooner, never later.
 */
export function ownerNextTurn(state: GameState, owner: PlayerID): number {
  const n = state.turnOrder.length;
  const a = state.turnOrder.indexOf(state.activePlayer);
  const o = state.turnOrder.indexOf(owner);
  if (n === 0 || a < 0 || o < 0) return state.turn + 1;
  const step = (o - a + n) % n;
  return state.turn + (step === 0 ? n : step);
}

/**
 * The first turn number of the round AFTER the one in progress — i.e. the
 * `'round'` expiry, for GROWING DISSENT's "starting this turn, for 1 round".
 *
 * Turn 1 is `turnOrder[0]`'s, so the round in progress ends after the last seat's
 * turn and the next round begins on `turn + (n - (turn - 1) mod n)`. With three
 * players: turn 1 -> 4, turn 2 -> 4, turn 3 -> 4, turn 4 -> 7.
 */
export function roundEndTurn(state: GameState): number {
  const n = Math.max(1, state.turnOrder.length);
  return state.turn + (n - ((state.turn - 1 + n) % n));
}

export type GameState = {
  readonly zones: readonly Zone[];
  readonly players: Readonly<Record<PlayerID, PlayerState>>;
  readonly turnOrder: readonly PlayerID[];
  readonly activePlayer: PlayerID;
  readonly phase: Phase;
  readonly turn: number;
  readonly round: number;
  readonly finished: boolean;

  /** Three face-up Voter Cards. p10: three must always be available. */
  readonly market: readonly MarketSlot[];
  /** Cost of the top Conspiracy Card. The cost is printed on the back, so it is public. */
  readonly conspiracyTopCost: number | null;
  readonly conspiracyRemaining: number;

  /** Volatile-Area placements made this turn, in order. Each resolves one Headline. p18. */
  readonly headlineQueue: readonly { readonly areaId: AreaID; readonly by: PlayerID }[];
  /** The Headline currently face up and being resolved, if any. */
  readonly activeHeadline: CardID | null;

  readonly choices: readonly PendingChoice[];

  /**
   * G9 / G22 — effects still in force. See `LiveEffect` for the full visibility
   * argument; the short form is that a live effect is always a PUBLIC condition
   * installed by a card that is already face up, so it is unprefixed and reaches
   * every client deliberately.
   */
  readonly liveEffects: readonly LiveEffect[];

  /**
   * Set when the board fills before every majority forms (p20). Everyone gets one
   * more turn, starting with whoever filled the last area.
   */
  readonly finalRoundFrom: PlayerID | null;

  readonly log: readonly LogEntry[];

  // ─────────── SERVER ONLY — stripped by playerView ───────────
  /** The card put to the active player. They answer without seeing it. */
  readonly _pendingCard: CardID | null;
  readonly _ideologyDraw: readonly CardID[];
  readonly _ideologyDiscard: readonly CardID[];
  readonly _voterDraw: readonly CardID[];
  readonly _voterDiscard: readonly CardID[];
  readonly _conspiracyDraw: readonly CardID[];
  readonly _conspiracyDiscard: readonly CardID[];
  readonly _headlineDraw: readonly CardID[];
  readonly _headlineDiscard: readonly CardID[];
  /** Deterministic PRNG cursor. The engine never calls Math.random. */
  readonly _seed: number;

  /**
   * Monotonic counter for generated ids (choices, voter groups).
   *
   * It lives in state, not at module scope, because `reduce` must be pure: the
   * same state plus the same action must always produce the same ids, or a
   * replay from seed + action log is worthless and a client holding a `choiceId`
   * across a server restart is holding a dead reference. R2.
   */
  readonly _idSeq: number;
};

// ─────────────────────────── derived helpers ───────────────────────────

export const EMPTY_POOL: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

export function poolTotal(p: Pool): number {
  return p.funds + p.clout + p.media + p.trust;
}

export function deltaTotal(d: Delta): number {
  return (d.funds ?? 0) + (d.clout ?? 0) + (d.media ?? 0) + (d.trust ?? 0);
}

export function findZone(state: GameState, id: ZoneID): Zone | undefined {
  return state.zones.find((z) => z.id === id);
}

export function findArea(state: GameState, id: AreaID): Area | undefined {
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === id);
    if (a) return a;
  }
  return undefined;
}

/** Pegs a player holds in a zone, majority or not. */
export function pegsOf(zone: Zone, player: PlayerID): number {
  return zone.areas.reduce((n, a) => n + (a.peg?.owner === player ? 1 : 0), 0);
}

export function pegsFilled(zone: Zone): number {
  return zone.areas.reduce((n, a) => n + (a.peg ? 1 : 0), 0);
}

export function slotsFree(zone: Zone): number {
  return zone.capacity - pegsFilled(zone);
}

export function emptyAreas(zone: Zone): readonly Area[] {
  return zone.areas.filter((a) => a.peg === null);
}

/**
 * p16 / p34. Gerrymandering Rights belong to whoever has strictly more voters in a
 * zone than any other player. A tie gives nobody rights.
 */
export function gerrymanderRights(zone: Zone): PlayerID | null {
  const counts = new Map<PlayerID, number>();
  for (const a of zone.areas) {
    if (!a.peg) continue;
    counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
  }
  let best: PlayerID | null = null;
  let bestN = 0;
  let tied = false;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied || bestN === 0 ? null : best;
}

/** How many cards of each Ideologue sit in a player's manifesto. p15. */
export function tally(manifesto: readonly Ideologue[]): Record<Ideologue, number> {
  const out: Record<Ideologue, number> = {
    capitalist: 0,
    supremo: 0,
    showstopper: 0,
    idealist: 0,
  };
  for (const i of manifesto) out[i] += 1;
  return out;
}
