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

export type Effect =
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
  /** Extra gerrymander moves this turn, above the normal per-zone allowance. */
  | { readonly op: 'gerrymander'; readonly n: number }
  /** Draw the top Conspiracy Card(s) for free. */
  | { readonly op: 'draw-conspiracy'; readonly n: number }
  /** Discard all face-up Voter Cards and deal fresh ones. */
  | { readonly op: 'refresh-market' }
  /** Additional purchase discounts this turn. */
  | { readonly op: 'discount'; readonly n: number };

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
};

export type HeadlineCard = {
  readonly id: CardID;
  readonly name: string;
  readonly text: string;
  readonly effects: readonly Effect[];
  readonly excludeInTwoPlayer?: boolean;
};

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
