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

import { useEffect, useRef, useState } from 'react';

import type { ClientState, Pool } from '@shasn/engine';
import type { PlayerID, Resource } from '@shasn/engine';

import { BlindAnswer } from '../answer/BlindAnswer.tsx';
import type { BlindPrompt } from '../net/index.ts';

import { committedSideToDisplayIndex, promptToProps } from './blindWire.ts';
import { ResourcePicker } from './ResourcePicker.tsx';
import { RESOURCE_ORDER, UI_RULES, canAfford, deltaTotal } from './derive.ts';
import type { PickerDraft } from './store.ts';

export type AnswerScreenProps = {
  readonly state: ClientState;
  readonly prompt: BlindPrompt;
  readonly you: PlayerID;
  readonly picker: PickerDraft | null;
  readonly onCommit: (displayIndex: 0 | 1) => void;
  readonly onRedrawRequest: () => void;
  readonly onPick: (next: Readonly<Record<string, number>>) => void;
  readonly onRedrawConfirm: (pay: Readonly<Record<string, number>>) => void;
  readonly onPickerCancel: () => void;
};

export function AnswerScreen(props: AnswerScreenProps) {
  const { prompt, state, you } = props;
  const [committed, setCommitted] = useState<'A' | 'B' | null>(null);
  const me = state.players[you];

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
  const promptKey = [prompt.question, prompt.labels[0], prompt.labels[1]].join('\u0000');
  const [lastPromptKey, setLastPromptKey] = useState(promptKey);
  if (lastPromptKey !== promptKey) {
    setLastPromptKey(promptKey);
    if (committed !== null) setCommitted(null);
  }

  // A screen that takes the viewport must put the keyboard somewhere useful, or
  // a keyboard player is left tabbing from the document root (§8.1, SC 2.4.3).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const wire = promptToProps(prompt);

  return (
    <div className="scrim scrim--answer" data-testid="answer-screen">
      <div
        ref={rootRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Ideology Card: answer blind"
        style={{ outline: 'none', width: '100%' }}
      >
        {/* §5.3 constraint 6: the prompt's own language is symmetric. "Question",
            not "Which do you back?" — the second is addressed to one option. */}
        <p className="eyebrow" style={{ textAlign: 'center' }}>
          QUESTION
        </p>

        <BlindAnswer
          question={wire.question}
          labelA={wire.labelA}
          labelB={wire.labelB}
          seed={wire.seed}
          committed={committed}
          onCommit={(side) => setCommitted(side)}
        />

        {/* The commit control is the answer component's own; this bar carries the
            redraw offer (§5.3.5) and the honest statement that the payout is not
            shown. Nothing before the commit is derived from the card's contents,
            which is the promise the copy makes. */}
        <div
          className="row"
          style={{ justifyContent: 'center', maxWidth: '46rem', margin: '0 auto' }}
        >
          <button
            type="button"
            className="btn"
            onClick={props.onRedrawRequest}
            disabled={props.picker !== null}
            data-testid="redraw-offer"
          >
            REDRAW — {UI_RULES.redrawCost} RESOURCES
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={committed === null || props.picker !== null}
            aria-disabled={committed === null}
            onClick={() => {
              if (committed !== null) props.onCommit(committedSideToDisplayIndex(committed));
            }}
            data-testid="commit-answer"
          >
            COMMIT ANSWER
          </button>
        </div>

        <p
          className="panel__note panel__note--quiet"
          style={{ textAlign: 'center', maxWidth: '46rem', margin: 'var(--sp-3) auto 0' }}
        >
          You must choose before the turn can continue. The payout is not shown until you
          commit.
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
