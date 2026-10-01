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
 *    The type below has eight fields and none of them is numeric, monetary, or
 *    Ideologue-shaped. The client has never held the value, so there is nothing
 *    for an accessibility technology, a devtools inspector, or a curious player
 *    to find. `blindAnswer.types.ts` proves it at the type level and
 *    `blindAnswer.test.tsx` proves it at the DOM level.
 *
 * And what must not exist here at all, per §1.2 and §9.6: no resource icon, no
 * payout numeral, no Ideologue colour, no `title=` or `aria-label=` naming a
 * resource, no tween or count-up, and no "reveal" affordance other than the
 * commit button itself.
 *
 * ── ONE COMMIT CONTROL, AND TWO WORDS FOR TWO STEPS ───────────────────────
 *
 * A defect found by playing it rather than by reading it. This component used
 * to render its own `Confirm` button, which read "Answer committed" after a
 * click — but that click only SELECTED a side. `AnswerScreen` separately
 * rendered `COMMIT ANSWER`, which was the control that actually dispatched
 * `ANSWER` to the server. So a player who pressed "Confirm" was told, in the
 * most safety-critical screen in the game, that something had happened when
 * nothing had: they had selected a side and had not committed it. A control
 * that lies about commitment on the one screen whose entire premise is that
 * you cannot see the payout before committing is not a wording bug.
 *
 * The rule now, and it is a structural one rather than a copy one:
 *
 *   · EXACTLY ONE control in this component sends anything. It is the commit
 *     button, and it is the only button here whose label contains the word
 *     "commit". The two sides SELECT; they never commit, and their callback is
 *     named `onSelect` so the type says so too.
 *   · THE TWO STEPS DO NOT SHARE A WORD. Selecting is "CHOOSE ONE"; sending is
 *     "COMMIT ANSWER". "Confirm" belonged to neither — it reads as a synonym for
 *     committing, which is exactly the confusion being removed.
 *   · THE COMMIT LABEL IS DERIVED FROM SERVER STATE, NEVER FROM A LOCAL CLICK.
 *     `commitState` is a prop. This component holds no state of its own about
 *     whether the answer was committed, so it is structurally incapable of
 *     claiming a commitment the server did not accept — which was the same
 *     defect one level up. `sending` is not `committed`: it says the frame is
 *     in flight, and only a confirmed server state may say the answer is in.
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
  /**
   * A side was CHOSEN. Selects; does not commit, and is handed the wire side —
   * never a value. Named to keep "choose" and "commit" apart at the type level.
   */
  readonly onSelect?: (side: 'A' | 'B') => void;
  /** The chosen side, if any. Rendered identically on both sides. */
  readonly selected?: 'A' | 'B' | null;
  /**
   * What the SERVER has done with this answer. The caller derives all three;
   * this component stores none of them.
   *
   *   `idle`      nothing chosen — the commit control is disabled
   *   `ready`     a side is chosen and the answer is still this player's to send
   *   `sending`   the frame is in flight; NOT yet committed, and labelled so
   *   `committed` the server has accepted the answer and moved the turn on
   *
   * `sending` is deliberately not folded into `committed`. A dispatch that
   * fails — a dead socket, a refused action — must leave the player able to
   * commit, which it cannot do if the UI already said the answer was in.
   */
  readonly commitState?: CommitState;
  /** Send the chosen answer. Called with nothing: the side is the caller's. */
  readonly onCommit?: () => void;
};

/** The two wire sides. Rendered in seed-derived order, never in wire order. */
export type BlindSide = 'A' | 'B';

/** Server-derived answer state. See `BlindAnswerProps.commitState`. */
export type CommitState = 'idle' | 'ready' | 'sending' | 'committed';

/**
 * The commit control's label, in each of the four states.
 *
 * A function rather than four inline ternaries so the wording is asserted in one
 * place by the regression test — the bug this replaced was wording that lived in
 * the component and contradicted the wiring, and wording that cannot be read in
 * one place is wording that will drift again.
 *
 * Note what is NOT here: nothing reads "Answer committed" for `sending`. A frame
 * in flight has not been accepted, and a screen that says otherwise is the bug.
 */
export function commitLabel(state: CommitState): string {
  switch (state) {
    case 'idle':
      return 'COMMIT ANSWER';
    case 'ready':
      return 'COMMIT ANSWER';
    case 'sending':
      return 'SENDING YOUR ANSWER…';
    case 'committed':
      return 'ANSWER SENT';
  }
}

/**
 * The status line's text, in each state. `role="status"`, so this is what a
 * screen-reader user hears when the answer state changes — the same information
 * the button's own label carries, so neither audience is worse served than the
 * other. No digits and no resource names, per §1.2.
 */
export function commitStatus(state: CommitState): string {
  switch (state) {
    case 'idle':
      return 'Choose one answer, then send it.';
    case 'ready':
      return 'Answer chosen. Send it when you are ready.';
    case 'sending':
      return 'Sending your answer to the table.';
    case 'committed':
      return 'Your answer has been recorded.';
  }
}

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
  onSelect,
  selected = null,
  commitState = 'idle',
  onCommit,
}: BlindAnswerProps) {
  const order = useMemo(() => orderedSides(seed), [seed]);

  // The label lookup is by side, and it is the ONLY content in the button.
  const labelFor = (side: BlindSide): string => (side === 'A' ? labelA : labelB);

  // Once the frame is in flight or the server has taken the answer, the sides
  // stop being selectable — a second selection after a commit is a state the
  // engine has no meaning for. `sending` and `committed` both lock, because
  // both are server-driven, and neither is guessable from a local click.
  const locked = commitState === 'sending' || commitState === 'committed';
  const canCommit = !locked && selected !== null && commitState !== 'idle';

  return (
    <div className="blind-answer" data-testid="blind-answer">
      {/* The prompt's own language is symmetric: "Choose the answer you can
          defend." Never "Which do you back?", whose grammar privileges a side. */}
      <p className="blind-answer__scenario" data-testid="scenario">
        {question}
      </p>

      {/* STEP ONE, named as step one. "CHOOSE ONE" says which of the two verbs
          on this screen is being asked for, which is the whole defect: the two
          steps used to share the single word "Confirm". */}
      <p className="blind-answer__choose" id="blind-answer-choose" data-testid="choose-label">
        CHOOSE ONE
      </p>

      {/* One contiguous panel, one background, one 2-column grid: the two
          options read as one question with two doors, not as
          option-one-primary and option-two-secondary. */}
      <div
        className="blind-answer__panel"
        data-testid="panel"
        role="group"
        aria-labelledby="blind-answer-choose"
      >
        {order.map((side) => {
          const chosen = selected === side;
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
              disabled={locked}
              onClick={() => {
                if (!locked) onSelect?.(side);
              }}
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

      {/* The ONE control that sends anything. It is the only button in this
          component whose label contains "commit", and the only one wired to
          `onCommit` — the sides above call `onSelect` and nothing else. */}
      <button
        type="button"
        className="blind-answer__commit"
        disabled={!canCommit}
        aria-disabled={!canCommit}
        onClick={() => {
          if (canCommit) onCommit?.();
        }}
        data-testid="commit-answer"
      >
        {commitLabel(commitState)}
      </button>

      {/* Announced on change, so the commit state reaches a screen-reader user
          through a live region rather than only through the button's label. */}
      <p className="blind-answer__status" role="status" data-testid="commit-status">
        {commitStatus(commitState)}
      </p>
    </div>
  );
}

export default BlindAnswer;