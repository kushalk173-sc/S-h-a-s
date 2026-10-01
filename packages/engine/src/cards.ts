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
 * Every field below is **inert**. `reduce()` (`packages/engine/src/reduce.ts`,
 * `applyEffect`) does not read any of them, so a card that sets one resolves
 * exactly as if it were absent. That is not a licence to ship such a card — it
 * is the reason the corpus validator rejects them.
 *
 * WHY THEY ARE HERE AT ALL, in this file, rather than only in
 * `packages/cards/schema/card.schema.json`: a shape nobody has written down is a
 * shape nobody will implement, and this is the one file the engine owner reads.
 * They are grouped here, named `RESERVED`, and every one of them is listed in
 * `packages/cards/KNOWN-GAPS.md` with the reducer change it waits on.
 *
 * THE RULE, and it is the only rule that matters for these fields:
 * **a card must not ship using behaviour the engine does not perform.** The
 * validator in `packages/cards/src/validate.ts` enforces that (finding codes
 * `EFFECT_NOT_EXECUTED`, `EFFECT_FIELD_NOT_EXECUTED`, `CARD_FIELD_NOT_EXECUTED`),
 * and `packages/cards/test/reducer-parity.test.ts` re-asserts it over the whole
 * shipped corpus, so an inert field cannot reach a deck.
 */

/** G9/G22 — how long an effect's effect lasts. See `packages/cards/KNOWN-GAPS.md` G9, G22. */
export type EffectDuration = 'this-turn' | 'round' | 'next-turn' | 'rest-of-game';

/** G22 — when a persistent effect starts. `'next-turn'` must not apply to the resolving turn. */
export type EffectTiming = 'now' | 'next-turn' | 'after-this-turn';

/** G14 — the events an effect can be installed as a hook on. */
export type EffectTrigger =
  | 'on-purchase'
  | 'on-voter-influenced'
  | 'on-volatile-placement'
  | 'on-gerrymander'
  | 'on-majority-formed';

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
 * RESERVED — per-effect scope. Inert today; see the block comment above.
 *
 * `when` (G14) installs the effect as a hook on another player's action;
 * `until` (G9/G22) gives it a lifetime. Both need a list of active effects in
 * `GameState` that the reducer re-reads on every event, which is engine work
 * this package cannot do.
 */
export type EffectScope = {
  /** RESERVED, not executed by `reduce()`. See G14. */
  readonly when?: EffectTrigger;
  /** RESERVED, not executed by `reduce()`. See G9/G22. */
  readonly until?: EffectDuration;
};

export type Effect = (
  /** Gain a fixed set of resources from the Public Reserve. */
  | { readonly op: 'gain'; readonly res: Delta; readonly target?: EffectTarget }
  /** Pay a fixed set to the Public Reserve. Capped at what the player holds. */
  | { readonly op: 'lose'; readonly res: Delta; readonly target?: EffectTarget }
  /** Gain N resources of the recipient's choice. */
  | { readonly op: 'gain-any'; readonly n: number; readonly target?: EffectTarget }
  /** Discard N resources of the recipient's choice. */
  | { readonly op: 'lose-any'; readonly n: number; readonly target?: EffectTarget }
  /** p34 Snatch: take N resources from a chosen opponent, nothing in return. */
  | { readonly op: 'steal-any'; readonly n: number }
  /** Gain N voters to place. Splittable across zones (they are not from a Voter Card). */
  | { readonly op: 'voters'; readonly n: number; readonly target?: EffectTarget }
  /** p34 Evict: back to the owner's mat, replaceable next turn. */
  | { readonly op: 'evict'; readonly n: number }
  /** p34 Discard: off the board permanently. */
  | { readonly op: 'discard-voter'; readonly n: number }
  /** p34 Convert: replace an opponent's voter in the same area with your own. */
  | { readonly op: 'convert-voter'; readonly n: number }
  /**
   * Extra gerrymander moves this turn, above the normal per-zone allowance.
   *
   * G8: `target` is now on the op — this was the one resource-shaped op with no
   * target field, which is why "every player can Gerrymander 1" could not be
   * written at all. **`reduce()` does not read it yet** (`applyEffect` credits the
   * bonus to `source` only, see reduce.ts:303), so a card that sets it is
   * rejected by the corpus validator with the one-line fix named. `target: 'you'`
   * and an absent `target` are equivalent and both fine.
   */
  | { readonly op: 'gerrymander'; readonly n: number; readonly target?: EffectTarget }
  /** Draw the top Conspiracy Card(s) for free. */
  | { readonly op: 'draw-conspiracy'; readonly n: number }
  /** Discard all face-up Voter Cards and deal fresh ones. */
  | { readonly op: 'refresh-market' }
  /** Additional purchase discounts this turn. */
  | { readonly op: 'discount'; readonly n: number }
) &
  EffectScope;

/**
 * The three fields the two X-card types share. See the RESERVED block above: none
 * of them is interpreted by `reduce()` today.
 */
export type XCardScope = {
  /**
   * RESERVED, not executed by `reduce()`. G9/G22.
   *
   * `'this-turn'` is the one value the engine already honours — by resolving the
   * effects once and discarding the card — so it is accepted as a statement of
   * fact. Every other value needs a list of live effects in `GameState` that the
   * reducer re-applies, and a card asking for one is rejected by the validator.
   */
  readonly duration?: EffectDuration;
  /** RESERVED, not executed by `reduce()`. G22. */
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
