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
 * 4. THE PAYOUT IS ONE FRAME. §9.3: no count-up, no flip, no reel, no delay, no
 *    comparison between the two sides. The reveal renders fully-formed numbers
 *    in a single 300ms fade — the same instant information arrives, not a
 *    sequence that paces it. See `.reveal` in `app.css`, whose only declaration
 *    is opacity, deliberately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientState, Pool } from '@shasn/engine';
import type { PlayerID, Resource } from '@shasn/engine';

import { BlindAnswer } from '../answer/BlindAnswer.tsx';
import type { CommitState } from '../answer/BlindAnswer.tsx';
import type { AnswerPrompt } from '../net/index.ts';

import { committedSideToDisplayIndex, promptToProps } from './blindWire.ts';
import { ResourcePicker } from './ResourcePicker.tsx';
import { RESOURCE_ORDER, UI_RULES, canAfford, deltaTotal, poolTotal } from './derive.ts';
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

        {/* ── THE REDRAW, AND WHAT IT NOW MEANS. p13 keeps it, and the reason it used
            to exist is gone. ─────────────────────────────────────────────────────
            "pay any 4 resources to have your Ideology Card redrawn before answering"
            was a BET: §7.2 step 2 says so in as many words — "Because the reading
            player does not know what the card pays, the redraw is a BET, not a
            decision." Under full information the payout is printed on the card
            above, so this is no longer a bet and the honest description is "pay 4 for
            a different card" — a reroll, priced at 4, which every player can now
            compute against the two payouts they are looking at.

            It is KEPT rather than deleted, and the ruling is on this bar: a mechanic
            whose justification evaporated is a decision to be made, not one to be
            quietly inherited, and the two available answers both close the game. Delete
            it and a player holding a genuinely bad card has no out, because the engine
            has no legal action that returns a card to the draw pile mid-turn. Keep it
            and it is the only priced escape from a dominated card — which, with the
            payout visible, is a real and frequent situation rather than a rare one.
            Deleting it would also be a rulebook change, and this is not the package
            that owns the rulebook.

            What it is NOT, and the copy below is what says so: it is not a hint about
            the card, and it contains no second commit affordance. It buys a different
            card, not a better answer to this one. */}
        <div
          className="row"
          style={{ justifyContent: 'center', maxWidth: '46rem', margin: '0 auto' }}
        >
          <button
            type="button"
            className="btn"
            onClick={props.onRedrawRequest}
            disabled={redrawBlocked}
            aria-disabled={redrawBlocked}
            data-testid="redraw-offer"
          >
            REDRAW — {UI_RULES.redrawCost} RESOURCES
          </button>
        </div>

        <p
          className="panel__note panel__note--quiet"
          style={{ textAlign: 'center', maxWidth: '46rem', margin: 'var(--sp-3) auto 0' }}
        >
          You must choose before the turn can continue. Redrawing costs {UI_RULES.redrawCost}{' '}
          resources and swaps the card for a different one — both payouts are printed, so you
          are buying a different question rather than taking a chance at this one.
          {/* The reason the control is dead, next to the control. A player on 0/0/2/0
              reading "costs 4 resources" above a button that will not press is owed
              the number they are short by. */}
          {!canPayRedraw && me !== undefined
            ? ` You hold ${poolTotal(me.resources)} of the ${UI_RULES.redrawCost} it costs, so there is no payment you can make.`
            : ''}
        </p>

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
        <div key={r} className="res__cell">
          <span className="res__num">{pool[r]}</span>
          <span className="res__name">{r}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The resolved-answer frame. §7.3 / §9.3.
 *
 * It renders for exactly one state and then the phase moves on, so this is not
 * an animation controller — it is a static frame with a 300ms fade on opacity.
 * The numbers come from the server's own `ClientState` (the answer's resources
 * are already in the pool, credited by the engine), so there is nothing here to
 * compute and therefore nothing here to get subtly wrong.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW: the other side's payout, a comparison, a
 * "you would have got" line, or a count-up. Every one of those animates on a
 * length that leaks, and the leak is permanent for everyone who saw it.
 */
export function AnswerReveal({
  state,
  you,
  answeredLabel,
}: {
  state: ClientState;
  you: PlayerID;
  /** The label the player committed to. Public per rules-reference.md:190-191. */
  readonly answeredLabel: string | null;
}) {
  const me = state.players[you];
  if (me === undefined) return null;
  return (
    <div className="reveal sheet" role="status" data-testid="answer-reveal">
      <h2 className="sheet__title">Answer recorded</h2>
      {answeredLabel === null ? null : (
        <p className="sheet__body">
          <span className="reveal__summary">{answeredLabel}</span>
        </p>
      )}
      <PoolNumbers pool={me.resources} />
      <p className="panel__note panel__note--quiet">
        {me.manifesto.length} card{me.manifesto.length === 1 ? '' : 's'} on your mat. The full
        resolution is in the log.
      </p>
    </div>
  );
}

/** Whether a drafted redraw payment is one the server will accept. */
export function redrawAffordable(pool: Pool, pick: Readonly<Record<string, number>>): boolean {
  const d = pick as Record<string, number>;
  return deltaTotal(d) === UI_RULES.redrawCost && canAfford(pool, d);
}
