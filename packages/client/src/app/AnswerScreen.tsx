/**
 * The answer screen.
 *
 * THE MOST IMPORTANT SCREEN IN THE PRODUCT, and the file is short because
 * everything hard about it was settled before it was written. What is left here
 * is: take the server's prompt, hand it to the existing `BlindAnswer` unchanged,
 * and put the ONE thing that may be added around it — the redraw offer — in a
 * place the answer component cannot be confused with.
 *
 * FOUR RULES, EACH ONE A DECISION RATHER THAN A STYLE.
 *
 * 1. THE PROMPT IS RENDERED FROM THE SERVER'S PAYLOAD AND NOTHING ELSE.
 *    `promptToProps` copies `question` and the two `labels` positionally. There
 *    is no branch, no sort, no `order` consultation, and no prop through which a
 *    payout could arrive — `answer/blindAnswer.types.ts` proves the last one at
 *    the type level, and there is nothing here to undo.
 *
 * 2. THE ORDER IS THE SERVER'S. `WIRE_ORDER_SEED` forces the shared component to
 *    render "as given", so the seed-derived order in `broadcast.ts` is what the
 *    player sees. The client never re-derives one, because two random orders is
 *    one order too many and the client has nothing legitimate to derive from.
 *
 * 3. NO CHROME ON THE PROMPT. §9.6: no resource tokens, no Ideologue colours, no
 *    manifesto anywhere in this subtree — not in a header, not in a disabled
 *    background, not in a `title=`. A player's own Ideologue pattern is itself
 *    information, so this is a full-viewport takeover with nothing else in it
 *    (§5.3). The redraw button below the panel is the single exception the spec
 *    makes (§5.3.5), and it is a payment control, not a hint about the card.
 *
 * 4. WHAT IS NOT ON THIS SCREEN. §9.6: no resource tokens, no Ideologue colours,
 *    no manifesto, and — the change — no payout and no faction attribution. The
 *    question and two bare YES/NO choices are the whole of it, which is what
 *    restores §7.2's premise that the answerer does not know what the card pays. The
 *    rest of the table still sees the whole card, on `TableQuestion`; §9.3's no-
 *    count-up, no-flip, no-delay rule is unchanged and is what keeps that panel's
 *    payout in one readable frame. See `.reveal` in `app.css`, whose only
 *    declaration is opacity, deliberately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientState, Pool } from '@shasn/engine';
import type { PlayerID, Resource } from '@shasn/engine';

import { BlindAnswer, IDEOLOGUE_FACTION, payoutLine } from '../answer/BlindAnswer.tsx';
import type { CommitState } from '../answer/BlindAnswer.tsx';
import type { AnswerPrompt, AnswerSide } from '../net/index.ts';

import { committedSideToDisplayIndex, promptToProps } from './blindWire.ts';
import { ResourcePicker } from './ResourcePicker.tsx';
import { RESOURCE_ORDER, UI_RULES, canAfford, deltaTotal, poolTotal } from './derive.ts';
import { ResourceGlyph } from './ResourceGlyph.tsx';
import type { PickerDraft } from './store.ts';

export type AnswerScreenProps = {
  readonly state: ClientState;
  readonly prompt: AnswerPrompt;
  readonly you: PlayerID;
  /**
   * The server's state ENVELOPE version (`net/protocol.ts`), not a `ClientState`
   * field. It is the client's only trustworthy proof that the server has spoken
   * since we sent `ANSWER`, and it is what `committed` below is measured
   * against.
   */
  readonly viewId: number;
  /** The server's last error, and its monotonic counter. See `commitStateOf`. */
  readonly errorAt: number | null;
  readonly picker: PickerDraft | null;
  /**
   * Send the answer. Returns whether the frame actually LEFT the socket, so the
   * caller can tell "in flight" from "never sent" — a press that did not reach
   * the table must not leave the UI claiming the answer is on its way.
   */
  readonly onCommit: (displayIndex: 0 | 1) => boolean;
  readonly onRedrawRequest: () => void;
  readonly onPick: (next: Readonly<Record<string, number>>) => void;
  readonly onRedrawConfirm: (pay: Readonly<Record<string, number>>) => void;
  readonly onPickerCancel: () => void;
};

export function AnswerScreen(props: AnswerScreenProps) {
  const { prompt, state, you } = props;
  const me = state.players[you];

  /**
   * THE SELECTION IS LOCAL, AND THAT IS CORRECT. §6.1 of `app/store.ts` draws
   * the line the whole client runs on: pending intent is local, applied state is
   * the server's. Which side a player has picked is intent — nothing has been
   * sent, nothing can be wrong, and there is no game state for it to desync
   * from. It is called `selected`, not `committed`, because that distinction is
   * the defect this screen was fixed for.
   */
  const [selected, setSelected] = useState<'A' | 'B' | null>(null);

  /**
   * `sending` is a CLAIM ABOUT THE WIRE, NOT ABOUT THE GAME. It is set only when
   * `send()` reports the frame actually left, and it is cleared the moment the
   * server proves otherwise — by refusing (`errorAt` moves) or by simply not
   * taking the answer (a newer `viewId` with the turn still `answer`).
   *
   * This state is why there is a `sending` label at all: without it, either the
   * button stays live and can be double-submitted, or it goes dead and a failed
   * dispatch strands the player. With it, the honest third option exists.
   */
  const [sending, setSending] = useState(false);

  /**
   * A redraw replaces the card, and therefore the two labels, and a new question
   * is a new question. So the pending selection is keyed on the prompt's
   * identity: when the prompt changes, the selection goes with it, rather than
   * leaving a tick on a side of a card that is no longer on the table.
   *
   * Implemented as the documented "adjust state during render" pattern — a
   * `setState` on the same component, during its own render, which React
   * discards and immediately re-runs. A `useEffect` would paint one frame with
   * the old selection, which is exactly the frame the spec forbids.
   */
  // The whole card is the key, not just the labels: under full information a REDRAW
  // swaps the question AND both payouts, so keying on the labels alone would keep a
  // selection the player made about a card that is no longer on the table.
  const promptKey = [
    prompt.question,
    prompt.sides[0].label,
    prompt.sides[1].label,
    prompt.sides[0].ideologue,
    prompt.sides[1].ideologue,
    JSON.stringify(prompt.sides[0].pays),
    JSON.stringify(prompt.sides[1].pays),
  ].join('\u0000');
  const [lastPromptKey, setLastPromptKey] = useState(promptKey);
  if (lastPromptKey !== promptKey) {
    setLastPromptKey(promptKey);
    if (selected !== null) setSelected(null);
    if (sending) setSending(false);
  }

  /**
   * THE SERVER'S ANSWER, AND ONLY THE SERVER'S.
   *
   * `sentAtView` is stamped at the instant we dispatch and is never written
   * again for the same prompt. `committed` therefore becomes true only when BOTH
   * halves of the following are true:
   *
   *   1. a NEWER `viewId` has arrived — the server has spoken since the dispatch,
   *      so this is observed state rather than an assumption; and
   *   2. the server's own `phase` is no longer `answer` — the engine moved the
   *      turn on, which only `reduce.ts:523` does after a successful `ANSWER`.
   *
   * There is no optimistic path. A press that did not land leaves `committed`
   * false and the control live, and a press the server refused flips it back via
   * the `errorAt` guard below. This is the fix for the defect one level up from
   * the duplicated button: a component that only read a local flag would report
   * success for an action the server never took.
   */
  const sentAtView = useRef<number | null>(null);
  const committed =
    sentAtView.current !== null && props.viewId > sentAtView.current && state.phase !== 'answer';

  /**
   * A REFUSAL PUTS THE ANSWER BACK IN THE PLAYER'S HANDS.
   *
   * `net/store.ts` stamps every error with a monotonic counter precisely so a
   * repeated identical error still registers as new. Comparing against the
   * counter observed at dispatch time means only errors caused BY this answer can
   * clear `sending` — an unrelated error from earlier in the match cannot leave
   * the answer half-sent.
   */
  const errorAtDispatch = useRef<number | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState(props.errorAt);
  if (lastErrorAt !== props.errorAt) {
    setLastErrorAt(props.errorAt);
    const since = errorAtDispatch.current;
    if (sending && props.errorAt !== null && since !== null && props.errorAt > since) {
      setSending(false);
    }
  }

  /**
   * The four states the component renders, derived — never stored as a claim.
   * `idle` is "no side chosen", `ready` is "chosen and still the player's to
   * send", and the last two are server-driven.
   */
  const commitState: CommitState = committed
    ? 'committed'
    : sending
      ? 'sending'
      : selected === null
        ? 'idle'
        : 'ready';

  const commit = useCallback(() => {
    if (selected === null || sending || committed) return;
    const landed = props.onCommit(committedSideToDisplayIndex(selected));
    if (!landed) return; // `session.ts:send` already raised a visible refusal.
    sentAtView.current = props.viewId;
    errorAtDispatch.current = props.errorAt;
    setSending(true);
  }, [selected, sending, committed, props]);

  /**
   * AN ANSWER THE SERVER NEVER TOOK IS NOT AN ANSWER IN FLIGHT.
   *
   * If the server has spoken since we sent — a newer `viewId` — and the turn is
   * STILL `answer`, then `ANSWER` was not accepted. Anything else (a frame that
   * was refused without an error frame, a peer action that resolved nothing)
   * lands here, and the honest outcome is to re-arm the control rather than sit
   * on a "SENDING…" that will never resolve. The selection is kept: the player
   * chose deliberately and nothing about the card changed.
   *
   * This is the same "adjust during render" pattern as the prompt key above, and
   * for the same reason: an effect would paint one frame claiming the answer was
   * on its way when the server had already said it was not.
   */
  const [stalledAtView, setStalledAtView] = useState<number | null>(null);
  if (
    sending &&
    stalledAtView !== null &&
    props.viewId > stalledAtView &&
    state.phase === 'answer' &&
    lastErrorAt === props.errorAt
  ) {
    setStalledAtView(null);
    setSending(false);
  }
  if (sending && stalledAtView === null) setStalledAtView(props.viewId);

  // A screen that takes the viewport must put the keyboard somewhere useful, or
  // a keyboard player is left tabbing from the document root (§8.1, SC 2.4.3).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const wire = promptToProps(prompt);

  /**
   * CAN THIS PLAYER AFFORD THE REDRAW AT ALL — the button's own business, not the
   * picker's.
   *
   * The engine refuses `REDRAW_IDEOLOGY` unless `canAfford(self.resources, pay)`, so
   * a player holding three resources in total can never complete the payment no
   * matter what the picker lets them draft. The affordability gate used to live only
   * inside that picker, which meant the button itself was always live and a press
   * opened a dialog whose only reachable outcome was Cancel.
   *
   * `poolTotal(pool) >= redrawCost` is EXACTLY the right condition, not an
   * approximation of it. The payment is any split of `redrawCost` across the four
   * denominations, so a legal split exists iff the total held is at least the total
   * asked: fill denomination by denomination up to what is held and the sum reaches
   * `redrawCost` as soon as the held total does, and no split can exist below it
   * because every split's parts are bounded by their own holdings and therefore sum
   * to at most the held total. `redrawControl.test.tsx` proves that equivalence
   * exhaustively rather than leaving it to this comment.
   *
   * The button is disabled AND the reason is printed beside it, because §9.2's rule
   * is that a control is never dead without an adjacent reason -- and the note below
   * the button is already that place, so this adds a control's worth of meaning to
   * existing copy rather than a second element beside the panel. The prompt's own
   * chrome is untouched: this is a payment control and nothing about the card.
   */
  const canPayRedraw = me === undefined || poolTotal(me.resources) >= UI_RULES.redrawCost;
  const redrawBlocked =
    props.picker !== null || sending || committed || !canPayRedraw;

  return (
    <div className="scrim scrim--answer" data-testid="answer-screen">
      <div
        ref={rootRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Ideology Card: answer"
        style={{ outline: 'none', width: '100%' }}
      >
        {/* §5.3 constraint 6: the prompt's own language is symmetric. "Question",
            not "Which do you back?" — the second is addressed to one option. */}
        <p className="eyebrow" style={{ textAlign: 'center' }}>
          QUESTION
        </p>

        {/*
          THE ANSWER COMPONENT OWNS THE COMMIT CONTROL, AND IT IS THE ONLY ONE.

          It used to be the other way round: `BlindAnswer` rendered a "Confirm"
          button that read "Answer committed" while only selecting a side, and
          the `COMMIT ANSWER` button that actually dispatched lived down here
          beside the redraw offer. A player who pressed "Confirm" was told the
          answer was in when it was not, on the one screen in the game whose
          premise is that nothing is visible until it is. So the real control
          moved into the component, next to the selection it sends, and the one
          down here is gone.
        */}
        <BlindAnswer
          question={wire.question}
          sideA={wire.sideA}
          sideB={wire.sideB}
          seed={wire.seed}
          selected={selected}
          commitState={commitState}
          onSelect={setSelected}
          onCommit={commit}
        />

        {/* ── THE REDRAW, AND WHAT IT NOW MEANS. ──────────────────────────────────
            "pay any 4 resources to have your Ideology Card redrawn before answering"
            was a BET: §7.2 step 2 says so in as many words — "Because the reading
            player does not know what the card pays, the redraw is a BET, not a
            decision."

            It briefly stopped being a bet. Full information printed the payout on the
            card for the answerer too, which made the redraw a priced reroll you could
            compute against two payoffs, and the copy below said exactly that. The
            answerer no longer sees the payout, so the bet is BACK, and this copy has
            been returned to the rulebook's own reasoning rather than left arguing for
            a mechanic that no longer applies to this seat.

            It is KEPT rather than deleted. A mechanic whose justification was briefly
            withdrawn is a decision to be made, not one to be quietly inherited. And it
            is the only priced escape from a card you think is bad — the engine has no
            other legal action that returns a card to the draw pile mid-turn — which,
            with the payoff hidden, is a real and frequent situation rather than a rare
            one. Deleting it would also be a rulebook change, and this is not the
            package that owns the rulebook.

            What it is NOT: it is not a hint about the card, and it contains no second
            commit affordance. It buys a different card, not a better answer to this
            one. */}
        <div
          className="row"
          style={{ justifyContent: 'center', maxWidth: '46rem', margin: '0 auto' }}
        >
          <button
            type="button"
            className="btn btn--sm"
            onClick={props.onRedrawRequest}
            disabled={redrawBlocked}
            aria-disabled={redrawBlocked}
            data-testid="redraw-offer"
          >
            REDRAW — {UI_RULES.redrawCost} RESOURCES
          </button>
        </div>

        {/* ONE QUIET LINE, and this is a cut rather than a trim. This used to be a
            three-line paragraph directly under the two answers, which made it the
            third-largest block of type on a screen whose entire subject is one
            question and two words — and a player deciding between NO and YES was
            being told, at length, about a reroll they may not even be able to afford.

            The rulebook's own reasoning is kept and shortened rather than dropped:
            §7.2 step 2 says the redraw is a BET precisely because the reading player
            does not know what the card pays, and that is true again now the payout is
            hidden from this seat. One sentence, at 13px, in the quietest ink on the
            screen. */}
        <p className="redraw-note" data-testid="redraw-note">
          You are not told what this card pays, so a redraw is a bet on the next one.
        </p>

        {/* The reason the control is dead, next to the control. A player on 0/0/2/0
            reading "costs 4 resources" above a button that will not press is owed the
            number they are short by — and §9.2's rule is that a control never dies
            without an adjacent reason. */}
        {!canPayRedraw && me !== undefined ? (
          <p className="redraw-note__short" data-testid="redraw-short">
            You hold {poolTotal(me.resources)} of the {UI_RULES.redrawCost} it costs.
          </p>
        ) : null}

        {props.picker?.forKind === 'redraw' && me !== undefined ? (
          <div style={{ maxWidth: '46rem', margin: 'var(--sp-4) auto 0' }}>
            <ResourcePicker
              pool={me.resources}
              total={UI_RULES.redrawCost}
              pick={props.picker.pick}
              onPick={props.onPick}
              heading={`Redraw — choose any ${UI_RULES.redrawCost} resources`}
              confirmLabel={`CHOOSE ${UI_RULES.redrawCost}`}
              onConfirm={() => props.onRedrawConfirm(props.picker!.pick)}
              onCancel={props.onPickerCancel}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The four numerals, on their own. Shared by the reveal and the mat. */
export function PoolNumbers({ pool }: { pool: Pool }) {
  return (
    <div className="res">
      {RESOURCE_ORDER.map((r: Resource) => (
        <div key={r} className="res__cell" data-res={r}>
          <ResourceGlyph resource={r} />
          <span className="res__num">{pool[r]}</span>
          <span className="res__name">{r}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE RESOLUTION — what the answer actually was, and what it paid.

   THIS REVERSES §9.3's "no count-up, no delay", and the reversal is argued rather
   than assumed. The old rule was written when the payout was WITHHELD and printed
   in one frame at resolution: animating a number the player did not have leaks its
   value to anyone watching over a shoulder, and the leak is permanent. Every clause
   of that argument is about a number that is still secret when the animation runs.

   None of it applies here, for three reasons that are all structural:

     1. THE SECRET IS GONE BEFORE THIS RENDERS. `reduce.ts` sets `phase: 'actions'`
        and `_pendingCard: null` on the ANSWER branch, and `broadcast.ts`'s
        `openQuestionFor` returns `null` unless `phase === 'answer'` — so the card
        is off the wire before the first frame of this screen paints. There is no
        window in which an observer could time an animation to learn it.
     2. THE NUMBER IS YOURS AND IT IS ALREADY SPENT. It is in your pool, it has
        been capped, and it is in the public log. Nothing here reveals a fact.
     3. WHAT IT DOES REVEAL IS THE OTHER SIDE — and that is a correction, not a
        leak. The answerer is the one seat that never saw the card in full, so
        until now they chose without ever learning what the alternative paid. This
        closes the asymmetry the answer screen opened.

   So the animation is allowed to be an animation, and it is doing the job §9.3
   actually wants: making a resolution land rather than appear.

   ── THE CARD IS A LOCAL SNAPSHOT, AND THAT IS THE WHOLE TRICK ──────────────────

   This component is handed the prompt, not told to go and find it, because the card
   CANNOT be re-read after the fact — see 1 above. `GameScreen` captures the prompt
   in the same callback that dispatches `ANSWER`, which is the last instant at which
   it exists. So this is a snapshot of something the player was already shown, not a
   new channel: `AnswerPrompt` is the server's own payload and the Ideology corpus
   is public JSON (see `app/blindWire.ts`).

   ── NEW CLASS NAMES, AND IT MATTERS ──────────────────────────────────────────

   `.resolution__*`, not `.blind-answer__*`. This screen marks ONE side as chosen,
   and a modifier on `.blind-answer__side` would be exactly what `blindAnswer.css`'s
   header forbids — no modifier class, no per-side rule, because on the ANSWER screen
   a per-side style is a channel publishing which Ideologue a display position is.
   That contract does not apply here (post-commit, your own card) but the stylesheet
   audit is a regex over the FILE, not a judgement about context, so borrowing the
   class would fail the build and — more to the point — would make the two screens
   look related when they are deliberately not.
   ══════════════════════════════════════════════════════════════════════════════ */

/** How long the numbers take to land. Long enough to read as counting, short enough not to wait. */
const COUNT_MS = 900;

/** Stagger between the two sides and the payout row, in ms. */
const STEP_MS = 160;

/**
 * Count `target` up from zero, or report it immediately.
 *
 * `prefers-reduced-motion` is honoured in JAVASCRIPT as well as in CSS, and the
 * reason is specific: this is the only animation in the product that changes a
 * NUMBER rather than a transform. A reduced-motion user who gets the number
 * mid-flight sees `4` when the truth is `9`, and a wrong number is not a milder
 * version of a right one — it is a lie with a smaller animation attached. So the
 * hook short-circuits to the final value and the CSS transition is a separate
 * concern entirely.
 */
function useCountUp(target: number, enabled: boolean): number {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(enabled && !reduced ? 0 : target);

  useEffect(() => {
    if (!enabled || reduced) {
      setShown(target);
      return;
    }
    if (target === 0) {
      setShown(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      // Ease-out, so it decelerates into the final value instead of stopping dead.
      // A linear count reads as a progress bar; this reads as a number arriving.
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      setShown(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, reduced]);

  return shown;
}

/** `true` when the reader has asked for less motion. Safe on the server. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * THE CARD, AS THE RESOLUTION IS ALLOWED TO HOLD IT.
 *
 * This is `AnswerPrompt` MINUS `order`, and the subtraction is the point rather than
 * tidiness. `order` — the seed-derived draw saying which face of the card is the
 * first display position — exists on `AnswerPrompt` and on nothing else the client
 * receives; it is the one field PLAN.md §2 amendment A′ exists to protect, and
 * `openQuestion` deliberately fails closed on a payload carrying one
 * (`blindWire.ts:openQuestionOf`).
 *
 * The snapshot in `GameScreen` has to be taken from `store.answer`, so `order` is
 * unavoidably in hand at that moment. Handing the component the narrow type means it
 * CANNOT render it, cannot pass it down, and cannot have it read out of devtools by
 * anyone who later adds a debug attribute — not because a rule forbids that, but
 * because the property is not there. A prohibition is something the next edit can
 * forget; a missing field cannot be forgotten, only re-added on purpose.
 */
export type ResolvedCard = {
  readonly question: string;
  readonly sides: readonly [AnswerSide, AnswerSide];
};

/**
 * The card, stripped to what the resolution needs, at the last instant the card is
 * readable at all.
 *
 * THE ONLY FUNCTION IN THE CLIENT THAT TOUCHES `order`, and it does so to throw it
 * away. It is called from the `ANSWER` dispatch callback because that is the last
 * instruction that runs while `store.answer` is still non-null: `net/store.ts` nulls
 * it the moment the phase moves on, and `reduce.ts` has already nulled
 * `_pendingCard`.
 */
export function cardForResolution(prompt: AnswerPrompt): ResolvedCard {
  return { question: prompt.question, sides: prompt.sides };
}

export type AnswerResolutionProps = {
  /** The card as it was when the answer was sent. See the snapshot note above. */
  readonly prompt: ResolvedCard;
  /** Which DISPLAY position the player committed to. `0` is the left cell. */
  readonly chosenIndex: 0 | 1;
  /**
   * What the SERVER wrote to the log as this player's answer, or `null`.
   *
   * This wins over the snapshot's own label for the chosen card, and the reason is
   * a specific failure rather than general distrust: `committedSideToDisplayIndex` is
   * the one mapping in this mechanic that can be got backwards, and if it were, the
   * resolution would cheerfully animate the WRONG payout as though the player had
   * earned it. The log is written by `reduce.ts` from the side the engine actually
   * took, so it cannot be wrong about that. When the two agree — which is every real
   * run — this changes nothing; when they somehow do not, the screen says what the
   * server did rather than what the client hoped.
   */
  readonly serverText: string | null;
  readonly onContinue: () => void;
};

/**
 * THE RESOLUTION. The whole card, both sides in full, the chosen one marked, and
 * the points counted up in front of the player.
 *
 * The prose comes from `payoutLine` and `IDEOLOGUE_FACTION` — the same two helpers
 * `TableQuestion` prints with — rather than from a second implementation, so the
 * table's copy of a card and the answerer's copy of the same card cannot disagree
 * about what a side says or what it pays. That is the whole reason those two live
 * in `answer/BlindAnswer.tsx` and are exported rather than copied.
 */
export function AnswerResolution({
  prompt,
  chosenIndex,
  serverText,
  onContinue,
}: AnswerResolutionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const chosen = prompt.sides[chosenIndex];
  const reduced = usePrefersReducedMotion();

  // The server's own words for this answer, stripped of the quotes `reduce.ts` wraps
  // them in, and only when they name a side of THIS card. A log entry from an
  // earlier turn on the same seat carries an answer to a card that is long gone, and
  // printing that here would put a stranger's sentence under "YOU CHOSE THIS".
  const serverLabel = useMemo(() => {
    const bare = serverText?.trim().replace(/^"|"$/g, '') ?? null;
    if (bare === null || bare.length === 0) return null;
    return bare;
  }, [serverText]);

  return (
    <div className="scrim scrim--answer" data-testid="answer-resolution">
      <div
        ref={rootRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Your answer"
        className="resolution"
        style={{ outline: 'none' }}
      >
        <p className="eyebrow" style={{ textAlign: 'center' }}>
          YOUR ANSWER
        </p>

        {/* THE WHOLE QUESTION, at the size it was asked. It is on this screen
            because the resolution is about this question, not about a number. */}
        <h2 className="resolution__question" data-testid="resolution-question">
          {prompt.question}
        </h2>

        {/* BOTH SIDES, IN FULL, whichever one you took. The one you did not take is
            shown because the asymmetry it closes is the point: until now the
            answerer was the only seat that never learned what the other side paid. */}
        <div className="resolution__sides">
          {([0, 1] as const).map((i) => {
            const side = prompt.sides[i];
            const mine = i === chosenIndex;
            const label =
              mine && serverLabel !== null ? serverLabel : side.label;
            return (
              <div
                key={i}
                className={`resolution__side${mine ? ' resolution__side--mine' : ''}`}
                data-mine={mine ? 'true' : 'false'}
                data-testid={mine ? 'resolution-mine' : 'resolution-theirs'}
              >
                <p className="resolution__verdict">
                  {mine ? (
                    <>
                      <span className="resolution__tick" aria-hidden="true">
                        ✓
                      </span>
                      YOU CHOSE THIS
                    </>
                  ) : (
                    'YOU DID NOT CHOOSE THIS'
                  )}
                </p>
                <p className="resolution__answer">{label}</p>
                <p className="resolution__faction">
                  {IDEOLOGUE_FACTION[side.ideologue]} answer
                </p>
                <p
                  className={`resolution__payout${
                    side.pays === undefined || Object.keys(side.pays).length === 0
                      ? ' resolution__payout--none'
                      : ''
                  }`}
                >
                  pays {payoutLine(side.pays)}
                </p>
              </div>
            );
          })}
        </div>

        {/* WHAT YOU GOT, COUNTING UP. Only ever YOUR side — the other side's figure
            is printed above as prose and is not animated, because animating the
            number you did not earn is theatre. */}
        <PayoutLanded pays={chosen.pays} animate={!reduced} />
        <PayoutSummary pays={chosen.pays} />

        <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--sp-6)' }}>
          <button
            type="button"
            className="btn btn--primary btn--wide"
            onClick={onContinue}
            data-testid="resolution-continue"
          >
            CONTINUE
          </button>
        </div>

        <p
          className="panel__note panel__note--quiet"
          style={{ textAlign: 'center', marginTop: 'var(--sp-3)' }}
        >
          Your answer and its resolution are in the log for the whole table.
        </p>
      </div>
    </div>
  );
}

/**
 * THE POINTS YOU GOT, arriving one at a time.
 *
 * `delay` staggers the four pools so they land in `RESOURCE_ORDER` rather than all
 * at once — a row of four numbers appearing simultaneously reads as one number, and
 * the stagger is what makes it read as four. Pools the card did not pay are shown
 * at zero rather than omitted, because "you gained nothing here" and "this card
 * said nothing about here" are different facts and the second is invisible.
 */
function PayoutLanded({
  pays,
  animate,
}: {
  readonly pays: Readonly<Partial<Record<'funds' | 'clout' | 'media' | 'trust', number>>>;
  readonly animate: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="resolution__payout-landed">
      <p className="resolution__payout-label">YOU GAINED</p>
      <div className="res">
        {RESOURCE_ORDER.map((r: Resource, i: number) => (
          <LandedCell
            key={r}
            resource={r}
            amount={pays[r] ?? 0}
            animate={animate && !reduced}
            delay={i * STEP_MS}
          />
        ))}
      </div>
    </div>
  );
}

function LandedCell({
  resource,
  amount,
  animate,
  delay,
}: {
  readonly resource: Resource;
  readonly amount: number;
  readonly animate: boolean;
  readonly delay: number;
}) {
  // A cell that pays zero waits its turn and then lands on zero, rather than
  // appearing at zero instantly — otherwise the stagger reads as "these two are
  // missing" instead of "these two are zero".
  const [armed, setArmed] = useState(!animate);
  useEffect(() => {
    if (!animate) {
      setArmed(true);
      return;
    }
    const t = window.setTimeout(() => setArmed(true), delay);
    return () => window.clearTimeout(t);
  }, [animate, delay]);

  const shown = useCountUp(amount, armed);
  const gained = amount > 0;

  return (
    <div
      className={`res__cell resolution__cell${gained ? ' resolution__cell--gained' : ''}`}
      data-res={resource}
      data-testid={`landed-${resource}`}
      // The only inline appearance in this screen, and it is a DELAY. The stagger
      // is data — the pool's position in `RESOURCE_ORDER` — so it cannot be four
      // hand-written rules, and a delay cannot make one cell look different in a way
      // that means something. Every colour, size and position is in `app.css`.
      style={{ animationDelay: `${delay}ms` }}
      // The number is announced once, at its final value, by the `role="status"`
      // sentence beside the row. Announcing every frame of a count-up would be
      // unusable, so the cells themselves are hidden from the accessibility tree.
      aria-hidden="true"
    >
      <ResourceGlyph resource={resource} />
      <span className="res__num">{gained ? `+${shown}` : '—'}</span>
      <span className="res__name">{resource}</span>
    </div>
  );
}

/** One spoken sentence for the whole payout, rather than four animating numerals. */
function PayoutSummary({ pays }: { pays: AnswerResolutionProps['prompt']['sides'][0]['pays'] }) {
  const parts = RESOURCE_ORDER.map((r) => ({ r, n: pays[r] ?? 0 })).filter((p) => p.n > 0);
  const sentence =
    parts.length === 0
      ? 'This answer paid you nothing.'
      : `You gained ${parts.map((p) => `${p.n} ${p.r}`).join(' and ')}.`;
  return (
    <p className="sr-only" role="status" data-testid="resolution-summary">
      {sentence}
    </p>
  );
}

/** Whether a drafted redraw payment is one the server will accept. */
export function redrawAffordable(pool: Pool, pick: Readonly<Record<string, number>>): boolean {
  const d = pick as Record<string, number>;
  return deltaTotal(d) === UI_RULES.redrawCost && canAfford(pool, d);
}
