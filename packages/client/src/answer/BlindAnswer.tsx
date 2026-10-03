/**
 * The answer.
 *
 * The filename and the class names still say `blind`, and they are kept rather than
 * renamed for one reason worth stating: the AVERAGE mechanic is still the property that
 * is protected. What the player may not learn is which SIDE of the card a display
 * position is, because a card's two answers belong to two different Ideologues and the
 * shipped answer pool is not balanced side-to-side. Everything else about the card — the
 * question, both answers, both Ideologues, both payouts — is published to the whole
 * table before anybody answers.
 *
 * ── THE THREE GUARANTEES THAT SURVIVED, and the one that did not ─────────────
 *
 * WHAT DID NOT SURVIVE, stated first because a reader who only reads the old comment
 * would be misled: the payout is now printed on the card, for the answering player and
 * for everyone else. §1.2's "no payouts, no ideologue names" is deliberately reversed, and
 * the reversal is recorded — in `net/protocol.ts`, in `app/blindWire.ts` and in the
 * server's `PublicQuestion` — together with what it costs the GAME rather than the wire:
 * with the payout visible, a player computes the better side instead of deliberating, so
 * dominance in the shipped Ideology deck is now permanently exploitable rather than
 * merely risky. That is a balance problem for the corpus, and the balance checker is
 * where it is argued; it is not a leak and there is no version of this component that
 * could have prevented it while also showing the payout.
 *
 * 1. ORDER IS RANDOMISED PER CARD, FROM THE SEED.  ← STILL LOAD-BEARING, AND MORE SO
 *    The draw is a deterministic function of the match seed — never `Math.random`, so a
 *    replay renders identically — and it is applied by the SERVER
 *    (`broadcast.ts#orderFor`), not here. This component takes a seed that pins the
 *    order to "as given" and has no way to learn which side of the card that is. The
 *    player therefore cannot build a position-independent left/right heuristic, and — the
 *    part that is new — neither can a stylesheet: see 2.
 *
 * 2. BOTH SIDES ARE THE SAME ELEMENT WITH THE SAME CLASS.
 *    Not "similar styles" — the same class, the same tokens, the same geometry. There is
 *    no `nth-child`, no `data-side` selector, no modifier class, and no per-side inline
 *    style anywhere in `blindAnswer.css`. **And now the payout and the Ideologue are on
 *    screen, so this rule has teeth it did not have before**: the Ideologue is per-side
 *    and differs between the two cells, so tinting a cell by its Ideologue would publish
 *    which Ideologue the left-hand position is — a position channel, and exactly what
 *    PLAN.md §2 amendment A′ forbids. The chosen state is also identical on both sides
 *    (`aria-pressed`, not a class).
 *
 * 3. THERE IS NO PROP THROUGH WHICH THE `order` DRAW COULD ARRIVE.
 *    It used to say "no prop through which a PAYOUT could arrive". Full information
 *    makes that false, so the guarantee is restated on the thing that is still protected:
 *    the component has no prop carrying which face of the card a position is, no prop
 *    carrying a card id, and no numeric field except the presentation seed — which is
 *    pinned to a constant by `app/blindWire.ts` and is therefore not a channel.
 *    `blindAnswer.types.ts` proves the closed prop set at the type level and
 *    `blindAnswer.test.tsx` proves the identical-styles rule at the DOM level.
 *
 * And what must not exist here at all, per §1.2 and §9.6, restated for a card whose
 * payout IS printed: no per-side tint, no positional selector, no `order` reaching the
 * DOM, no tween or count-up on the payout, and no "reveal" affordance — the payout is
 * simply there, in the same frame as the answer, because a reveal implies it was hidden.
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
 * that lies about commitment is not a wording bug, and under full information it
 * is WORSE: with the payout on screen, a player who believes they have committed
 * a side and has not is a player who believes they have banked a resource they
 * have not.
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

/**
 * One side of the card, as printed. `pays` is a `Delta`: a pool the card does not
 * mention is absent rather than zero, so the payout line prints only what the card
 * printed and a side that pays nothing reads as a side that pays nothing.
 */
export type PrintedSide = {
  readonly label: string;
  readonly ideologue: 'capitalist' | 'supremo' | 'showstopper' | 'idealist';
  readonly pays: Readonly<Partial<Record<'funds' | 'clout' | 'media' | 'trust', number>>>;
};

export type BlindAnswerProps = {
  /** The scenario prose. `TYPE_CARD_SCENARIO` — 17/27, INK_700. */
  readonly question: string;
  /**
   * Side A, PRE-MAPPED by the server: label, Ideologue and payout together. Deliberately
   * not derived from anything client-side: side identity ("the Trusts' answer") must
   * never be a client-side lookup keyed on A/B, or the mapping itself becomes the leak.
   */
  readonly sideA: PrintedSide;
  /** Side B, pre-mapped. Same contract as `sideA`. */
  readonly sideB: PrintedSide;
  /**
   * Presentation pin, NOT a channel. It is the constant `WIRE_ORDER_SEED`, so
   * `presentationOrder` is the identity on the server's already-display-ordered sides.
   * There is no per-card value here for a stylesheet or a devtools reader to learn.
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
   * What the SERVER has done with this answer. The caller derives all four;
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
 * other.
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
 * A side's payout as the card printed it, in the card's own pool order.
 *
 * NO COUNT-UP AND NO REVEAL, because there is nothing to reveal: UI-SPEC §9
 * anti-patterns 1 and 3 are about animating a number a player did not have, and
 * with the payout on the card from the first frame an animation of it would be
 * theatre. One string, in the frame the card was dealt.
 *
 * POOL ORDER IS `RESOURCES` ORDER AND NOT IDEOLOGUE ORDER, deliberately. The Ideologue
 * is printed separately as a NAME — "the Trusts' answer" — because that is how the card
 * reads aloud, and the resource names are printed in the engine's fixed order rather
 * than sorted by amount, so a card that pays 4 Funds cannot be told apart at a glance
 * from one that pays 1 Fund by how many words come first.
 */
export function payoutLine(pays: PrintedSide['pays']): string {
  const parts: string[] = [];
  for (const pool of ['funds', 'clout', 'media', 'trust'] as const) {
    const n = pays[pool];
    if (n === undefined || n === 0) continue;
    parts.push(`${n} ${POOL_NAMES[pool]}`);
  }
  return parts.length === 0 ? 'nothing' : parts.join(' · ');
}

/**
 * §1.2's names, spelled the way the rulebook spells them. A `Record` rather than four
 * constants so the loop above cannot drift from the spelling and a new pool cannot be
 * printed as its raw key.
 */
const POOL_NAMES: Readonly<Record<'funds' | 'clout' | 'media' | 'trust', string>> = {
  funds: 'Fund',
  clout: 'Clout',
  media: 'Media',
  trust: 'Trust',
};

/** How an Ideologue is named on a printed card. Capitalised: it is a faction. */
export const IDEOLOGUE_FACTION: Readonly<Record<PrintedSide['ideologue'], string>> = {
  capitalist: "the Capitalists'",
  supremo: "the Supremos'",
  showstopper: "the Showstoppers'",
  idealist: "the Idealists'",
};

/**
 * A deterministic 32-bit integer hash (FNV-1a) of the seed, so the order is a
 * pure function of the seed with no dependence on call order, no shared
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
 *
 * **THE SERVER DECIDES, AND THIS IS NOT WHERE THE CARD'S ORDER IS DRAWN.** The draw
 * that matters is `broadcast.ts#orderFor`, a function of the match seed and the card id,
 * and it has already happened by the time these sides arrive. The only thing this
 * function is still used for is pinning a locally-authored fixture's order, so the app
 * passes a constant (`WIRE_ORDER_SEED`) and the value is the identity. Keeping the helper
 * is what lets `blindAnswer.test.tsx` exercise both orders without a server.
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
  sideA,
  sideB,
  seed,
  onSelect,
  selected = null,
  commitState = 'idle',
  onCommit,
}: BlindAnswerProps) {
  const order = useMemo(() => orderedSides(seed), [seed]);

  // The side lookup is by side, and it is the ONLY content in the button.
  const sideFor = (side: BlindSide): PrintedSide => (side === 'A' ? sideA : sideB);

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
          const printed = sideFor(side);
          const chosen = selected === side;
          return (
            <button
              key={side}
              type="button"
              /* THE SAME CLASS ON BOTH SIDES. There is no second class, no
                 modifier, no per-side style, and no side-derived attribute that
                 any stylesheet could key on. `data-wire-side` is the WIRE side
                 (which side came from the server), never anything about value;
                 no rule in blindAnswer.css matches it. In particular there is
                 nothing here an Ideologue could be styled by — see the header. */
              className="blind-answer__side"
              data-wire-side={side}
              aria-pressed={chosen}
              disabled={locked}
              onClick={() => {
                if (!locked) onSelect?.(side);
              }}
            >
              <span className="blind-answer__label" data-testid="side-label">
                {printed.label}
              </span>
              {/* THE FULLY VISIBLE CARD, in one frame. The Ideologue is a NAME in
                  prose, the payout is a NAME in prose, and neither is given a
                  class, an icon, a colour or a `title`. The point of printing them
                  as words rather than badges is structural: a word cannot be
                  styled per-side without a stylesheet rule keyed on it, and the
                  audit in blindAnswer.test.tsx forbids exactly that. */}
              <span className="blind-answer__faction" data-testid="side-ideologue">
                {IDEOLOGUE_FACTION[printed.ideologue]} answer
              </span>
              <span className="blind-answer__payout" data-testid="side-payout">
                pays {payoutLine(printed.pays)}
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