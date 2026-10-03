/**
 * THE CARD ON THE TABLE — what every seat except the answerer's sees.
 *
 * THE DEFECT THIS FIXES IS A FIDELITY ONE, NOT A LEAK. In the physical game the
 * player to your right takes the top Ideology Card and reads both sides aloud
 * (`docs/AUTHENTIC-SHASN-REFERENCE.md` §7.2 step 1, p764), so the question and the
 * two answers are the table's business while the answerer deliberates — which is
 * also what makes the redraw window a decision-shaped window open to "any player"
 * (step 2, p768) and the interception window "the social centre of the game"
 * (§7.4 step 3, p815). A digital table that could not see the question was not
 * playing the same game.
 *
 * ── WHAT IS DELIBERATELY NOT HERE, AND IT IS THE SAME LIST `BlindAnswer` HAS ──
 *
 * No payout, no Ideologue, no card id, no `order`, no number, and — the one that
 * matters most for the control count — NO COMMIT CONTROL. Not a disabled one
 * either. This seat cannot answer this card, so a `COMMIT ANSWER` button here would
 * be a control that looks like it works and does not, which is UI-SPEC §9.10's
 * named prohibited case; and the whole point of the two-commit-controls fix was
 * that exactly one control in the product may claim a commitment. The answering
 * seat has it. This one has none, and the two sides here are not even focusable.
 *
 * ── WHY THE SAME CLASSES, AND WHY THAT IS THE POINT ─────────────────────────
 *
 * The scenario, the panel and both sides reuse `blind-answer__*` verbatim rather
 * than getting a lookalike. Every seat is looking at ONE card: if the table's copy
 * of a side were a different box from the answerer's copy of the same side, the
 * thing being read aloud and the thing on screen would be two objects, and the
 * fidelity being restored here would be cosmetic. Reusing the class makes that
 * structural rather than aspirational — `tableQuestion.test.tsx` asserts the two
 * sides here compute to identical styles by the same `getComputedStyle` equality
 * route §8.8 requires of the answerer's screen.
 *
 * Two consequences of reusing the class are handled rather than inherited:
 *
 *   1. `.blind-answer__side` sets `cursor: pointer`, because on the answerer's
 *      screen a side IS clickable. Here it is not, so `app.css` narrows the
 *      cursor with a descendant selector — higher specificity, and in `app.css`
 *      rather than `blindAnswer.css`, whose stylesheet audit fails the build on
 *      any selector that qualifies a side.
 *   2. `.blind-answer__choose` says "CHOOSE ONE", which is an instruction to the
 *      one seat that has a choice to make. It reads "THE TWO ANSWERS" here: the
 *      same eyebrow styling, and the same `aria-labelledby` wiring so a screen
 *      reader announces one group of two rather than two loose strings.
 *
 * IT IS NOT A DIALOGUE. No `aria-modal`, no scrim, no focus trap: the answer window
 * is the one moment in this game the rest of the table is still allowed to act in
 * (p19 lets anybody play a Conspiracy immediately before an opponent answers), and a
 * takeover here would take that away from the seats this component exists to inform.
 */

import type { OpenQuestion } from './blindWire.ts';

export type TableQuestionProps = {
  /** The published question and its two labels, in display order. */
  readonly question: OpenQuestion;
  /** Whose card it is. A name, never an id — this panel is prose, not state. */
  readonly answererName: string;
};

export function TableQuestion({ question, answererName }: TableQuestionProps) {
  const [first, second] = question.labels;
  return (
    <section className="table-question" data-testid="table-question">
      <p className="eyebrow">ON THE TABLE</p>
      <p className="panel__note panel__note--quiet">
        {answererName} is answering, blind to the payout.
      </p>

      <p className="blind-answer__scenario" data-testid="table-question-text">
        {question.question}
      </p>

      {/* The same label the answerer's panel is labelled by, and the same eyebrow
          styling — with the one word that differs, because this seat is not being
          asked to do anything. */}
      <p className="blind-answer__choose" id="table-question-answers" data-testid="table-question-choose">
        THE TWO ANSWERS
      </p>

      {/* ONE group, TWO read-only faces. Same classes as the answerer's panel, so
          the table is looking at the same card; not buttons, so there is nothing
          here to press and nothing that claims a commitment. */}
      <div
        className="blind-answer__panel"
        role="group"
        aria-labelledby="table-question-answers"
        data-testid="table-question-panel"
      >
        <p className="blind-answer__side" data-testid="table-question-side">
          <span className="blind-answer__label">{first}</span>
        </p>
        <p className="blind-answer__side" data-testid="table-question-side">
          <span className="blind-answer__label">{second}</span>
        </p>
      </div>

      {/* The honest statement of what happens next, and where B is delivered: the
          chosen side is announced, exactly as it is at a table ("You say which
          side", §7.2 step 3, p774), and it lands in the log every seat reads. */}
      <p className="panel__note panel__note--quiet">
        The side they choose goes in the log for everyone.
      </p>
    </section>
  );
}

export default TableQuestion;