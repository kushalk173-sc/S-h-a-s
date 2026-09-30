/**
 * The blind answer.
 *
 * "The blind answer is the product; everything else is table furniture."
 * — UI-SPEC §1.1. A player answering an Ideology Card sees ONLY the scenario
 * text and two neutral labels. No resource icons, no payout numerals, no
 * colour, no ordering convention, nothing that hints which Ideologue a side
 * favours. A design that is 5% better at everything else and leaks one bit is a
 * failed design.
 *
 * THREE SEPARATE GUARANTEES, because "don't leak the payout" is not one
 * requirement but three failure modes:
 *
 * 1. ORDER IS RANDOMISED PER CARD, FROM THE SEED.
 *    A card's two answers belong to two DIFFERENT Ideologues, and card authors
 *    will not be balanced left-vs-right mechanically. So a fixed "A is on the
 *    left" would leak the deck's Ideologue balance, and a player who noticed
 *    could exploit it. The draw is a deterministic function of the engine's
 *    `_seed` — never `Math.random`, so a replay renders identically — and it is
 *    applied here rather than trusting the network to send an `order` field
 *    (UI-SPEC B1 flags that field as an open PLAN.md amendment).
 *    A player therefore cannot build a position-independent left/right
 *    heuristic. This is the single most important line in §1.2.
 *
 * 2. BOTH SIDES ARE THE SAME ELEMENT WITH THE SAME CLASS.
 *    Not "similar styles" — the same class, the same tokens, the same geometry.
 *    There is no `nth-child`, no `data-side` selector, no modifier class, and
 *    no per-side inline style anywhere in `blindAnswer.css`. The chosen state
 *    is also identical on both sides (`aria-pressed`, not a class).
 *
 * 3. THERE IS NO PROP THROUGH WHICH A PAYOUT COULD ARRIVE.
 *    The type below has six fields and none of them is numeric, monetary, or
 *    Ideologue-shaped. The client has never held the value, so there is nothing
 *    for an accessibility technology, a devtools inspector, or a curious player
 *    to find. `blindAnswer.types.ts` proves it at the type level and
 *    `blindAnswer.test.tsx` proves it at the DOM level.
 *
 * And what must not exist here at all, per §1.2 and §9.6: no resource icon, no
 * payout numeral, no Ideologue colour, no `title=` or `aria-label=` naming a
 * resource, no tween or count-up, and no "reveal" affordance other than the
 * confirm button itself.
 */

import { useMemo } from 'react';
import './blindAnswer.css';

export type BlindAnswerProps = {
  /** The scenario prose. `TYPE_CARD_SCENARIO` — 17/27, INK_700. */
  readonly question: string;
  /**
   * Side A's label, PRE-MAPPED by the server. Deliberately not derived from
   * anything client-side: side identity ("the Trusts' answer") must never be a
   * client-side lookup keyed on A/B, or the mapping itself becomes the leak.
   */
  readonly labelA: string;
  /** Side B's label, pre-mapped. Same contract as `labelA`. */
  readonly labelB: string;
  /**
   * The engine's deterministic PRNG cursor, `_seed`. Presentation order is a
   * pure function of this, so replays are stable.
   */
  readonly seed: number;
  /** Called with the wire side on confirm. `'A' | 'B'` — never a value. */
  readonly onCommit?: (side: 'A' | 'B') => void;
  /** The committed side, if any. Rendered identically on both sides. */
  readonly committed?: 'A' | 'B' | null;
};

/** The two wire sides. Rendered in seed-derived order, never in wire order. */
export type BlindSide = 'A' | 'B';

/**
 * A deterministic 32-bit integer hash (FNV-1a) of the seed, so the order is a
 * pure function of `_seed` with no dependence on call order, no shared
 * mutable PRNG cursor on the client, and no `Math.random` anywhere.
 */
export function hashSeed(seed: number): number {
  let h = 2166136261 >>> 0;
  const s = String(Math.trunc(seed) >>> 0);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which side renders first, for this card.
 *
 * `'ab'` puts A in the left cell; `'ba'` puts B there. Exactly half of all
 * seeds take each branch, so over a deck the order carries no information
 * about which side is which Ideologue.
 */
export function presentationOrder(seed: number): 'ab' | 'ba' {
  return (hashSeed(seed) & 1) === 0 ? 'ab' : 'ba';
}

/** The two sides in presentation order. Pure, and the ONLY place order is set. */
export function orderedSides(seed: number): readonly [BlindSide, BlindSide] {
  return presentationOrder(seed) === 'ab' ? ['A', 'B'] : ['B', 'A'];
}

export function BlindAnswer({
  question,
  labelA,
  labelB,
  seed,
  onCommit,
  committed = null,
}: BlindAnswerProps) {
  const order = useMemo(() => orderedSides(seed), [seed]);

  // The label lookup is by side, and it is the ONLY content in the button.
  const labelFor = (side: BlindSide): string => (side === 'A' ? labelA : labelB);

  return (
    <div className="blind-answer" data-testid="blind-answer">
      {/* The prompt's own language is symmetric: "Choose the answer you can
          defend." Never "Which do you back?", whose grammar privileges a side. */}
      <p className="blind-answer__scenario" data-testid="scenario">
        {question}
      </p>

      {/* One contiguous panel, one background, one 2-column grid: the two
          options read as one question with two doors, not as
          option-one-primary and option-two-secondary. */}
      <div className="blind-answer__panel" data-testid="panel">
        {order.map((side) => {
          const chosen = committed === side;
          return (
            <button
              key={side}
              type="button"
              /* THE SAME CLASS ON BOTH SIDES. There is no second class, no
                 modifier, no per-side style, and no side-derived attribute that
                 any stylesheet could key on. `data-wire-side` is the WIRE side
                 (which label came from the server), never anything about value;
                 no rule in blindAnswer.css matches it. */
              className="blind-answer__side"
              data-wire-side={side}
              aria-pressed={chosen}
              onClick={() => onCommit?.(side)}
            >
              <span className="blind-answer__label" data-testid="side-label">
                {labelFor(side)}
              </span>
              {/* The chosen state is identical on both: the same seal border,
                  the same paper fill, the same check glyph in the same corner. */}
              {chosen ? (
                <span className="blind-answer__check" aria-hidden="true" data-testid="chosen-check">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* The confirm control. It is the ONLY reveal affordance on the screen. */}
      <button
        type="button"
        className="blind-answer__confirm"
        disabled={committed === null}
        onClick={() => {
          if (committed !== null) onCommit?.(committed);
        }}
      >
        {committed === null ? 'Confirm' : 'Answer committed'}
      </button>
    </div>
  );
}

export default BlindAnswer;
