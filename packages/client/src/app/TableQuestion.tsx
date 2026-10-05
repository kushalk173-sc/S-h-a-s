/**
 * THE CARD ON THE TABLE — what every seat except the answerer's sees.
 *
 * ── FULL INFORMATION, AND WHAT THIS PANEL IS NOW ───────────────────────────
 *
 * It used to show the question and the two printed answers and nothing else, because
 * that was all the server published to the table. Under full information the server
 * publishes the WHOLE card and so does this: question, both answers, both Ideologues and
 * both payouts, for every seat and every spectator, before anyone answers.
 *
 * ── THE TWO COPIES OF THE CARD ARE NOT IDENTICAL, AND THAT IS NOW A DECISION ──
 *
 * The answerer's panel prints the question and two bare YES/NO choices. This one
 * prints the question, both answers in full, both Ideologues and both payouts. So the
 * "one card, two panels" claim below is about the CARD, not about the copy: same
 * question, same sides, same classes — and the answerer sees less of it than the table
 * does. The asymmetry is deliberate: hiding the payoff from the seat that is deciding
 * is what puts the deliberation back, and §7.2's "the reading player does not know
 * what the card pays" depends on it.
 *
 * IT IS NOT FREE, and the honest cost is worth stating: a player at this table can
 * read the payout off this panel and compute the better side while the person
 * answering cannot. If that turns out to matter in play, the fix is to hide this
 * panel for the length of the answer window — not to change the wiring below, which
 * is correct either way.
 *
 * THE ONE THING STILL MISSING IS `order`, and that is not an omission — it is the whole
 * remaining mechanic. `order` says which face of the card the first display position is,
 * and with the Ideologue now printed beside each answer, a table that knew it could line
 * positions up against the deck's Ideologue balance (PLAN.md §2 amendment A′).
 *
 * ── WHAT IS DELIBERATELY NOT HERE, AND IT IS ONLY ONE THING ────────────────
 *
 * No commit control. Not a disabled one either. This seat cannot answer this card, so a
 * `COMMIT ANSWER` button here would be a control that looks like it works and does not,
 * which is UI-SPEC §9.10's named prohibited case; and the whole point of the
 * two-commit-controls fix was that exactly one control in the product may claim a
 * commitment. The answering seat has it. This one has none, and the two sides here are
 * not even focusable.
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

import { IDEOLOGUE_FACTION, payoutLine, type PrintedSide } from '../answer/BlindAnswer.tsx';
import type { PublishedOpenQuestion } from './blindWire.ts';

export type TableQuestionProps = {
  /** The published card: question and both sides, in display order. */
  readonly question: PublishedOpenQuestion;
  /** Whose card it is. A name, never an id — this panel is prose, not state. */
  readonly answererName: string;
};

export function TableQuestion({ question, answererName }: TableQuestionProps) {
  const [first, second] = question.sides;
  return (
    <section className="table-question" data-testid="table-question">
      <p className="eyebrow">ON THE TABLE</p>
      <p className="panel__note panel__note--quiet">
        {answererName} is answering, and the whole card is visible to everyone.
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
        {[first, second].map((side, i) => (
          <p className="blind-answer__side" data-testid="table-question-side" key={i}>
            <span className="blind-answer__label">{side.label}</span>
            <span className="blind-answer__faction">{IDEOLOGUE_FACTION[side.ideologue]} answer</span>
            <span className="blind-answer__payout">pays {payoutLine(side.pays)}</span>
          </p>
        ))}
      </div>

      {/* The honest statement of what happens next, and where it is delivered: the
          chosen side is announced, exactly as it is at a table ("You say which
          side", §7.2 step 3, p774), and it lands in the log every seat reads. */}
      <p className="panel__note panel__note--quiet">
        The side they choose goes in the log for everyone.
      </p>
    </section>
  );
}

export type { PrintedSide };

export default TableQuestion;