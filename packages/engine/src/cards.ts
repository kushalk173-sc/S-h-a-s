/**
 * Card shapes and the effect language.
 *
 * The engine interprets effects; it never authors them. Actual card content lives
 * in `@shasn/cards` as JSON, so a card is reviewable in a pull request and a
 * balance bug is a data fix, not a code change.
 */

import type { CardID, Delta, Ideologue, Resource } from './state';

// ─────────────────────────── Ideology Cards ───────────────────────────

export type IdeologySide = {
  /** The answer as the right-hand player reads it aloud. */
  readonly answer: string;
  readonly ideologue: Ideologue;
  /** p13: "Every answer will yield a different set of resources." */
  readonly pays: Delta;
};

export type Advisory = 'mature' | 'trigger';

export type IdeologyCard = {
  readonly id: CardID;
  readonly campaign: string;
  readonly question: string;
  /** p14: cards with sensitive themes may be removed before the game begins. */
  readonly advisory?: Advisory;
  readonly sides: readonly [IdeologySide, IdeologySide];
};

// ─────────────────────────── Voter Cards ───────────────────────────

export type VoterCard = {
  readonly id: CardID;
  /** The printed resource combination. p10. */
  readonly cost: Delta;
  /** p10: "Voter Cards can contain 1, 2 or 3 voters." */
  readonly voters: number;
};

// ─────────────────────────── effects ───────────────────────────

/** Who an effect lands on. Defaults to the card's player. */
export type EffectTarget =
  | 'you'
  | 'each-opponent'
  | 'everyone'
  /** The player currently holding the most majority voters. Ties → nobody. */
  | 'leader';

/**
 * FIELDS THAT ARE PART OF THE CARD CONTRACT BUT NOT YET INTERPRETED.
 *
 * Exactly one family is still inert: `interrupt` (G13). `reduce()`
 * (`packages/engine/src/reduce.ts`) does not read it, so a card that sets one
 * resolves exactly as if it were absent. That is not a licence to ship such a
 * card — it is the reason the corpus validator rejects them.
 *
 * CLOSED SINCE THIS BLOCK WAS WRITTEN, and kept here so the next reader does not
 * re-derive the same history:
 *  - `duration` / `timing` (G9 / G22) — EXECUTED by `installLiveEffects`, which
 *    writes a `GameState.liveEffects` entry whose `activeFrom` / `expiresAt` are
 *    absolute turn numbers, ticked in `advanceTurn`.
 *  - `when` / `until` / `condition` (G14) — EXECUTED by `fireTriggers`, a bounded
 *    cascade consulted by `INFLUENCE`, `BUY_CONSPIRACY`, `GERRYMANDER`, `setArea`
 *    and the turn boundary.
 *  - `target` on `gerrymander` (G8) — EXECUTED; the case loops `resolveTargets`.
 *
 * WHY THE INERT ONE IS HERE AT ALL, in this file rather than only in
 * `packages/cards/schema/card.schema.json`: a shape nobody has written down is a
 * shape nobody will implement, and this is the one file the engine owner reads.
 * It is grouped here, named RESERVED, and it is listed in
 * `packages/cards/KNOWN-GAPS.md` with the reducer change it waits on.
 *
 * THE RULE, and it is the only rule that matters:
 * **a card must not ship using behaviour the engine does not perform.** The
 * validator in `packages/cards/src/validate.ts` enforces that (finding codes
 * `EFFECT_NOT_EXECUTED`, `EFFECT_FIELD_NOT_EXECUTED`, `CARD_FIELD_NOT_EXECUTED`),
 * and `packages/cards/test/reducer-parity.test.ts` re-asserts it over the whole
 * shipped corpus against BOTH `applyEffect`'s and `installLiveEffects`'s own
 * source text, so an inert field cannot reach a deck.
 */

/** G9/G22 — how long an effect lasts. EXECUTED by `installLiveEffects`. */
export type EffectDuration = 'this-turn' | 'round' | 'next-turn' | 'rest-of-game';

/** G22 — when a persistent effect starts. `'next-turn'` must not apply to the resolving turn. */
export type EffectTiming = 'now' | 'next-turn' | 'after-this-turn';

/**
 * G14 — the events an effect can be installed as a hook on. EXECUTED by
 * `fireTriggers`, which `INFLUENCE`, `BUY_CONSPIRACY`, `GERRYMANDER`, `setArea` and
 * the turn boundary all consult.
 */
export type EffectTrigger =
  /** The top of a turn, after expiry has been ticked. */
  | 'on-turn-start'
  /** INFLUENCE or BUY_CONSPIRACY: a purchase of anything. */
  | 'on-purchase'
  /** INFLUENCE only: a Voter Card was bought. `FireContext.voters` carries its size. */
  | 'on-voter-influenced'
  /** `setArea` put a peg into a Volatile Area. p18. */
  | 'on-volatile-placement'
  /** A GERRYMANDER moved a voter. `FireContext.pegOwner` says whose. */
  | 'on-gerrymander'
  /** `setArea` formed or broke a majority. */
  | 'on-majority-formed';

/**
 * G15 / G4 — a count read out of player state instead of written on the card.
 *
 * `of` names WHAT is read, and the value is always read from the player the effect
 * is resolved FOR (the recipient, or the thief for `steal-any`). A card that says
 * "as many as you hold" therefore means the recipient's own pool.
 */
export type ComputedSource =
  /** Total resources the player holds. */
  | 'your-pool'
  /**
   * The Ideologue LEVEL the player has reached. See the long note on the
   * implementation in `reduce.ts` `computedValue`: the engine's real unlock rule
   * counts Ideology **Cards** answered (`powers.ts` `hasPower`), not resources
   * paid, and this reads the engine's rule rather than the balance checker's
   * resource proxy.
   */
  | 'ideologue-level'
  /** Gerrymander moves the player may still make this turn, across every zone. */
  | 'your-gerrymander-rights'
  /** Pegs the player owns that sit in a Volatile Area. p18 pegs there are permanent. */
  | 'volatile-voters'
  /**
   * For `per` only: what the player holds OF THE RESOURCE BEING GAINED. This is
   * what makes IF YOU LIKE PIÑA COLADA's "double all the resources on your player
   * mat" expressible — `res` of 1 in each resource, multiplied by the holder's own
   * count of that resource, is a doubling. The cap still applies afterwards, which
   * is the card's own second sentence.
   */
  | 'held-of-each-resource';

export type ComputedCount = { readonly of: ComputedSource };

/**
 * G14 — narrowing on the event that woke a hook. All present keys must hold.
 *
 * Every key is optional and the semantics are AND, because the two real cards that
 * need one need two at once: POWER TRIP is "every time **you** influence a
 * **3**-Voter Card", which is `byOwner` plus `influencedVotersAtLeast`.
 */
export type EffectCondition = {
  /** The event's actor is the effect's own `owner`. */
  readonly byOwner?: boolean;
  /** The purchase that woke the hook was a Voter Card with at least this many voters. */
  readonly influencedVotersAtLeast?: number;
  /** The voter the event moved belongs to the effect's `owner`. GROWING DISSENT. */
  readonly movedMyVoter?: boolean;
};


/**
 * G13 — phase-changing ops.
 *
 * These are deliberately NOT in `Effect`. REF 5.4 is emphatic and the recovered
 * card text bears it out: a BLOCK, a DEFLECT, an AUCTION and a VOTE change *which
 * phase of play is running*, not how many resources anyone holds, so no amount of
 * parameterising the effect list will express them. They are a sibling field on
 * the X-card types for exactly that reason, and `reduce()` ignores this whole
 * object — a card carrying an `interrupt` is rejected by the corpus validator.
 */
export type Interrupt = {
  readonly op: 'block' | 'deflect' | 'auction' | 'vote' | 'pass-card';
  /** When the window is open. */
  readonly window: 'out-of-turn' | 'pre-answer' | 'always';
  readonly target?: 'any-card' | 'card-affecting-you' | 'any-player';
};

/**
 * LIFETIME AND TRIGGER — the two scope fields every `Effect` carries.
 *
 * Both are EXECUTED, by `installLiveEffects` and `fireTriggers` in
 * `packages/engine/src/reduce.ts`, not by `applyEffect`. The distinction is
 * load-bearing for the honesty gate: `packages/cards/test/reducer-parity.test.ts`
 * slices `applyEffect`'s body to learn which fields each op reads, and `when` /
 * `until` / `condition` are read one function above it. The same test therefore
 * also re-derives `SCOPE_FIELDS_READ_BY_INSTALL` from `installLiveEffects`'s own
 * source text, so a scope field cannot be declared and then ignored.
 *
 * THE SEMANTICS, because they are a ruling and not an implementation detail:
 *
 *  - An effect carrying `when` or `until` is INSTALLED, not applied. It does not
 *    resolve once at play time and then sit there; it does nothing until its event
 *    fires or its standing turn arrives.
 *  - An effect carrying NEITHER is applied once, immediately. That is every shipped
 *    card's behaviour today and it is unchanged.
 */
export type EffectScope = {
  /** G14 — install this effect as a hook on an event. EXECUTED. */
  readonly when?: EffectTrigger;
  /** G9/G22 — how long the hook lives. Defaults to the card's `duration`. EXECUTED. */
  readonly until?: EffectDuration;
  /** G14 — narrowing on the firing event. Only meaningful alongside `when`. EXECUTED. */
  readonly condition?: EffectCondition;
};


export type Effect = (
  /**
   * Gain a fixed set of resources from the Public Reserve.
   *
   * `per` multiplies `res` by a quantity read out of the recipient's own state —
   * `{ of: 'held-of-each-resource' }` on a `res` of 1 in each resource is IF YOU
   * LIKE PIÑA COLADA's *"Double all the resources on your player mat"*, and the cap
   * still applies on top, which is the card's own second sentence.
   */
  | { readonly op: 'gain'; readonly res: Delta; readonly per?: ComputedCount; readonly target?: EffectTarget }
  /** Pay a fixed set to the Public Reserve. Capped at what the player holds. `per` as for `gain`. */
  | { readonly op: 'lose'; readonly res: Delta; readonly per?: ComputedCount; readonly target?: EffectTarget }
  /** Gain N resources of the recipient's choice. `n` may be computed. */
  | { readonly op: 'gain-any'; readonly n: Count; readonly target?: EffectTarget }
  /** Discard N resources of the recipient's choice. `n` may be computed. */
  | { readonly op: 'lose-any'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * p34 Snatch: take N resources from a chosen opponent, nothing in return.
   *
   * `target` is the SET OF VICTIMS, not the thief: with no target the thief picks
   * the victim (`from: null` on the choice) and with a target one theft decision is
   * raised per resolved player, so `'each-opponent'` reads "take N from every
   * opponent" and nothing else. It cannot mean "donate to a chosen player" — that
   * is G1, and it needs a different op.
   *
   * A computed `n` is read from the THIEF, who is the player the effect resolves
   * for.
   */
  | { readonly op: 'steal-any'; readonly n: Count; readonly target?: EffectTarget }
  /** Gain N voters to place. Splittable across zones (they are not from a Voter Card). */
  | { readonly op: 'voters'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * p34 Evict: back to the owner's mat, replaceable next turn.
   *
   * `target` names who is asked to make the eviction. A player named by the card
   * chooses among their OWN voters; the caster chooses from the whole board.
   */
  | { readonly op: 'evict'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * p34 Discard: off the board permanently. `target` as for `evict`.
   *
   * With no target the caster picks from every peg on the board that is not their
   * own — the reading three shipped cards state in their text. See
   * `ChoiceScope` for why "your own voters" needs the target rather than a flag.
   */
  | { readonly op: 'discard-voter'; readonly n: Count; readonly target?: EffectTarget }
  /** p34 Convert: replace an opponent's voter in the same area with your own. `target` as for `evict`. */
  | { readonly op: 'convert-voter'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * Extra gerrymander moves this turn, above the normal per-zone allowance.
   *
   * G8: `target` is on the op and `reduce()` honours every `EffectTarget` — the
   * case loops `resolveTargets`, which is what makes "starting with you, every
   * player can Gerrymander 1" (SUBMERGED / NEW FACE WHO DIS) writable. The grant
   * lands in `powerUses.gerrymandered`, which `advanceTurn` resets at the start of
   * each player's own turn, so a cross-player grant is spendable only by the player
   * whose turn the card resolved on; a lasting cross-player grant is a `LiveEffect`
   * with `duration`, not a bigger `n`.
   */
  | { readonly op: 'gerrymander'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * Draw the top Conspiracy Card(s). `target` says who receives them, so
   * `'each-opponent'` is GOOD GIG WELL PLAYED's gift. Hands are hidden from every
   * viewer including their owner (`playerView`), so handing a card to an opponent
   * leaks nothing the caster's own play did not.
   *
   * `from: 'discard'` reaches the DISCARD pile instead of the draw pile (G17) — the
   * top of a discard pile being the most recently discarded card, because that is
   * the order `discardTo` pushes them in and the reducer is not allowed to invent
   * another. SELECTIVE ACCESS MEMORY's "pick ANY Conspiracy Card from the discard
   * pile, in ANY order" still needs a choice among the pile's contents, which is a
   * `Choice` this engine does not have.
   */
  | {
      readonly op: 'draw-conspiracy';
      readonly n: Count;
      readonly target?: EffectTarget;
      readonly from?: 'draw' | 'discard';
    }
  /** Discard all face-up Voter Cards and deal fresh ones. */
  | { readonly op: 'refresh-market' }
  /**
   * G5 — attach a RULE to a player that other actions must consult.
   *
   * The one op that is not a change to a pool, a mat or the board. It writes a
   * `PlayerState.restrictions` entry, and `INFLUENCE` and `BUY_CONSPIRACY` are the
   * two actions that consult it today: `'no-purchases'` refuses both outright, and
   * `'surcharge'` adds `value` to the computed cost.
   *
   * `until` (from `EffectScope`) is the lifetime, and it is read here rather than
   * being left to `installLiveEffects`: a restriction is not a live effect — it has
   * no trigger and no effect list, and a hook that fired on an event could not
   * refund a price. Expiry is ticked in `advanceTurn` alongside live effects.
   *
   * `owed` is the KHAKI TERROR condition, and it is the field the soft-lock ruling
   * lives in: see `Restriction` in state.ts. It is the amount the card ASKS for; the
   * engine decrements `remaining` by what was ACTUALLY donated, so a player who
   * cannot afford the whole ask can still clear it.
   */
  | {
      readonly op: 'restrict';
      readonly kind: 'no-purchases' | 'surcharge';
      /** Extra resources per purchase, for `'surcharge'`. Zero for `'no-purchases'`. */
      readonly value: number;
      /** For `'no-purchases'`: what the player must give before buying again. */
      readonly owed?: number;
      readonly target?: EffectTarget;
    }
  /**
   * Additional purchase discounts this turn. `target` grants them to somebody else,
   * which is a write to another player's `powerUses` — the only such write in the
   * effect vocabulary, and the reason it is a card field rather than a resource.
   */
  | { readonly op: 'discount'; readonly n: Count; readonly target?: EffectTarget }
) &
  EffectScope;


/**
 * The `n` of a non-resource Effect: a literal, or a quantity read out of player
 * state.
 *
 * G15 / G4. The widening is safe *because* `reduce()` resolves it before it pushes
 * anything: `Choice.count` is still a `number` at the point it is constructed, so
 * TypeScript still stops a computed count from reaching the engine as one. See
 * `resolveCount` in reduce.ts.
 */
export type Count = number | ComputedCount;


/**
 * The fields the two X-card types share.
 *
 * `duration` and `timing` are EXECUTED — `installLiveEffects` turns a lasting
 * `duration` into a `GameState.liveEffects` entry and `timing` sets when it may
 * first act. `interrupt` is still inert, because it is not an effect at all (see
 * `Interrupt` above).
 */
export type XCardScope = {
  /**
   * G9/G22. `'this-turn'` — the default, and the value every shipped card means —
   * is what the engine always did: resolve the effects once, discard the card. Any
   * other value installs them as a `LiveEffect` that lives until the named expiry.
   *
   * A lasting `duration` with no per-effect `when` installs ONE standing effect
   * holding the whole list, re-applied at the top of every one of the owner's turns
   * until it expires. Per-effect `when` / `until` take precedence and are installed
   * one entry each, so a card may mix a one-shot branch with a lasting hook.
   */
  readonly duration?: EffectDuration;
  /** G22 — `'now'` (default) or `'next-turn'` (dormant until the owner's next turn). */
  readonly timing?: EffectTiming;
  /** RESERVED, not executed by `reduce()`. G13. */
  readonly interrupt?: Interrupt;
};


export type ConspiracyCard = {
  readonly id: CardID;
  readonly name: string;
  /** Player-facing rules text. Must describe exactly what `effects` does. */
  readonly text: string;
  /** p19: "bought for any 4-5 resources, denoted on the back of the card." */
  readonly cost: number;
  readonly effects: readonly Effect[];
  /** p27: cards marked 2✕ are removed in the two-player game. */
  readonly excludeInTwoPlayer?: boolean;
} & XCardScope;

export type HeadlineCard = {
  readonly id: CardID;
  readonly name: string;
  readonly text: string;
  readonly effects: readonly Effect[];
  readonly excludeInTwoPlayer?: boolean;
} & XCardScope;

// ─────────────────────────── the index handed to the reducer ───────────────────────────

export type CardIndex = {
  readonly ideology: Readonly<Record<CardID, IdeologyCard>>;
  readonly voter: Readonly<Record<CardID, VoterCard>>;
  readonly conspiracy: Readonly<Record<CardID, ConspiracyCard>>;
  readonly headline: Readonly<Record<CardID, HeadlineCard>>;
};

export function indexCards(input: {
  readonly ideology: readonly IdeologyCard[];
  readonly voter: readonly VoterCard[];
  readonly conspiracy: readonly ConspiracyCard[];
  readonly headline: readonly HeadlineCard[];
}): CardIndex {
  const by = <T extends { id: CardID }>(xs: readonly T[]): Record<CardID, T> =>
    Object.fromEntries(xs.map((x) => [x.id, x]));
  return {
    ideology: by(input.ideology),
    voter: by(input.voter),
    conspiracy: by(input.conspiracy),
    headline: by(input.headline),
  };
}

/** Total resources an Ideology Card side pays. Used by the balance checker. */
export function sidePayout(side: IdeologySide): number {
  return (side.pays.funds ?? 0) + (side.pays.clout ?? 0) + (side.pays.media ?? 0) + (side.pays.trust ?? 0);
}

export type { Resource };
