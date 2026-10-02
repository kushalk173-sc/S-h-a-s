/**
 * THE RESPONSE WINDOW, as a player sees it.
 *
 * ─────────────────────────── ONE FIELD, TWO PRESENTATIONS ───────────────────────────
 *
 * `GameState.interrupt` is a nullable field rather than a `Phase` because
 * `packages/server/src/broadcast.ts` gates hand visibility on
 * `phase === 'actions' || 'answer'` — a new phase member would black out every
 * player's Conspiracy hand for as long as the window is open, including the hand of
 * the player who is supposed to be holding the BLOCK. So the game has not stopped.
 * One card's resolution is being argued about.
 *
 * This component therefore has TWO presentations of the same fact, chosen by the
 * SEAT and not by a flag:
 *
 *   A MODAL SHEET for the one role that has a decision to make — the player the
 *   window is waiting on. It takes the viewport because it is the only control
 *   that matters until it is pressed, and because a scrim is the most robust way to
 *   guarantee a stray click on the board behind it cannot be mistaken for a decline.
 *
 *   A BANNER for everybody else — the player who played the card, a player who has
 *   already declined, a player frozen by a decision of their own, and a spectator.
 *   A modal with nothing to press is the dead dialog this repository has a whole
 *   gate file about (`choiceResolver.test.tsx`), so those seats get a status and no
 *   control at all.
 *
 * ─────────────────────────── THE DECLINE IS A DECISION ───────────────────────────
 *
 * A decline is not a dismissal, it is a move: it is one of the `n - 1` that closes
 * the window, and it is irreversible for that window. So:
 *
 *   - it is a labelled `<button type="button">`, not a timeout and not an automatic
 *     fallback. There is no timer anywhere in this file, and there is no code path
 *     that dispatches a decline the player did not press. A silent auto-decline
 *     would make the table unstallable by removing the decision, which is the one
 *     thing the window is for.
 *   - FOCUS IS MOVED TO THE DIALOG, NEVER TO THE BUTTON. A modal that autofocuses
 *     its only action turns a stray <Enter> — the key a screen-reader user presses
 *     to move on, and the key a muscle-memory user presses without looking — into a
 *     decline they did not choose. The container takes focus instead: the dialog is
 *     announced, and <Enter> on it does nothing at all, because it is not a
 *     control. `responseWindow.test.tsx` asserts that.
 *   - the consequence is stated next to the control, in words, before it is
 *     pressed: the card resolves as it would have with nobody holding anything.
 *
 * ─────────────────────────── WHAT IS SHOWN, AND WHERE IT CAME FROM ───────────────────────────
 *
 *   the card under response   its printed NAME, out of the public log the server
 *                              sent (`reduce.ts` logs the play in the same action
 *                              that opens the window, and the card is face up on the
 *                              discard pile by then)
 *   what it would do          `InterruptWindow.effects`, described in this client's
 *                              own words — server-sent structure, never remembered
 *                              and never guessed
 *   whether it has happened   NOT YET, stated as a word and a glyph, because the
 *                              most damaging failure here is a player believing a
 *                              resolution has landed when it is still held
 *   who may respond           nobody is named. The state does not say, and this
 *                              client must not imply it.
 *
 * A reactive card in the responder's OWN hand cannot be shown, because this client is
 * never told what it holds (`playerView` blanks every hand, the viewer's included —
 * the D25 ruling). So the respond path is built entirely from a server-sent list,
 * exactly as `ConspiracyPicker` is, and fails CLOSED: no list, no control, and a
 * plain statement of what is missing and why. Nothing about the hand is inferred,
 * counted or hinted at.
 */

import { useEffect, useRef } from 'react';

import type { ClientState, InterruptWindow, PlayerID } from '@shasn/engine';

import {
  describeEffects,
  mayDecline,
  mustRespond,
  outstanding,
  stagedCardLabel,
  windowOutcomeSentence,
  windowRole,
  windowStage,
  type WindowRole,
  type WindowStage,
} from './interrupt.ts';

/**
 * One card the SERVER says this player may play into the open window.
 *
 * Declared here rather than imported from the server package, for the reason
 * `ConspiracyPicker` gives: `net/protocol.ts` is a type-only mirror and the client
 * must not acquire a dependency on the server to describe four strings. `op` is
 * carried because the two reactive ops need genuinely different things from the
 * player — a BLOCK takes no target, a DEFLECT must name one — and a client that
 * cannot tell them apart would offer a target a Block refuses.
 *
 * `text` is the printed effect wording, and it is the SERVER'S string. This client
 * has no card index and must not be given one.
 */
export type ResponsiveCard = {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly op: 'block' | 'deflect';
};

export type ResponseWindowProps = {
  readonly state: ClientState;
  /** The open window. `null` renders nothing at all. */
  readonly window: InterruptWindow | null;
  readonly you: PlayerID | null;
  readonly isSpectator: boolean;
  /**
   * The cards the server says this viewer may answer the window with, verbatim.
   * `undefined` means the field was absent, which is a different statement from
   * "you hold nothing that can answer" and is rendered as one.
   */
  readonly responsive: readonly ResponsiveCard[] | undefined;
  readonly onDecline: () => void;
  /** Name the player a DEFLECT redirects to. `undefined` for a BLOCK. */
  readonly onRespond: (cardId: string, at: PlayerID | undefined) => void;
  /** A DEFLECT target has been picked. `null` clears the choice. */
  readonly deflectTarget: PlayerID | null;
  readonly onDeflectTarget: (at: PlayerID | null) => void;
};

export function ResponseWindow({
  state,
  window: w,
  you,
  isSpectator,
  responsive,
  onDecline,
  onRespond,
  deflectTarget,
  onDeflectTarget,
}: ResponseWindowProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const role: WindowRole = w === null ? 'absent' : windowRole(state, w, you, isSpectator);
  const mayPress = w === null ? false : mayDecline(state, w, you, isSpectator);
  const isModal = mayPress;

  // FOCUS THE DIALOG, NOT THE CONTROL — and only for the modal. See the header: the
  // point of this effect is that <Enter> on a non-activating element does nothing at
  // all, so a stray <Enter> can never be somebody's decline. A BANNER, by contrast,
  // must never take focus at all: a panel that appears mid-turn and steals the caret
  // out from under a player who is reading their own mat is a worse defect than one
  // that is merely announced. It is keyed on the transition, not on every render, so
  // a re-render mid-window does not yank focus back to the top of the dialog either.
  useEffect(() => {
    if (isModal) dialogRef.current?.focus();
  }, [isModal]);

  if (w === null) return null;

  const actor = state.players[w.actor];
  const actorName = actor?.name ?? 'Someone';
  const stage = windowStage(w);
  const outcome = stage === 'answered' ? windowOutcomeSentence(w) : null;
  const card = stagedCardLabel(state.log, w);
  const effects = describeEffects(w.effects, w.duration);
  const waiting = outstanding(state, w);
  const required = mustRespond(state, w);
  /*
    DOES THIS SEAT OWE SOMETHING THE WINDOW HAS FROZEN?

    `reduce.ts` refuses every action except the two window moves and
    `RESOLVE_CHOICE`, and `GameScreen` hides the two overlays whose commit is one of
    those refusals — the blind answer and the Headline acknowledgement. So a seat
    can be looking at a window while an action of theirs is owed and unreachable:
    the actor who played a Conspiracy out of turn *during* somebody's answer is
    mid-answer and cannot answer until the window closes. Saying so is the
    difference between a player who knows to wait and a player who thinks the game
    has eaten their card.
  */
  const owedElsewhere =
    state.phase === 'answer' && state.awaitingAnswer && you === state.activePlayer;
  const body = (
    <>
      <p className="eyebrow window__eyebrow">
        {w.kind === 'headline' ? 'HEADLINE' : 'CONSPIRACY'} · RESPONSE WINDOW
      </p>
      <h2 className="sheet__title window__title">{titleFor(stage, role)}</h2>

      {/*
        THE STATE, TWICE OVER, NEVER BY COLOUR ALONE (§8.2).

        A word and a glyph, both plain text, both always rendered: `HELD` with a
        pause mark while the resolution is staged, `ANSWERED` with a tick once it has
        been. Colour is not used for this at all — the only colour in the panel is
        the seal on the sheet's own edge, which is the house treatment and carries
        no meaning. A greyscale render, a colour-blind player and a screen reader
        all read the same sentence.
      */}
      <p className="window__state" data-state={stage} data-testid="window-state">
        <span className="window__glyph" aria-hidden="true">
          {stage === 'open' ? '‖' : '✔'}
        </span>{' '}
        <span className="window__word">{stage === 'open' ? 'HELD — NOT YET APPLIED' : 'ANSWERED'}</span>
        {outcome === null ? null : <span className="window__outcome"> · {outcome}</span>}
      </p>

      <p className="sheet__body" data-testid="window-card">
        {actorName} played {card}.{' '}
        {stage === 'open'
          ? 'What it does is being held: nothing has been applied yet, and nothing will be until the window closes.'
          : 'The window has closed and this card has been settled.'}
      </p>

      {/*
        THE EFFECTS, AS THE SERVER SENT THEM. This is the decision the window
        exists for — whether to let this land — so the numbers have to be legible
        before the control, not summarised in the log afterwards. §9.3: it is one
        static list. Nothing counts up, nothing flips, no length encodes anything,
        and there is no "you would have got" counterfactual.
      */}
      <ul className="window__effects" data-testid="window-effects">
        {effects.map((line, i) => (
          <li key={`${i}-${line}`} className="window__effect">
            {line}
          </li>
        ))}
      </ul>

      <p className="panel__note panel__note--quiet">
        The printed wording of the card is not part of the state this client is given,
        so this is a description of its effects rather than the card&apos;s own text.
      </p>

      {stage === 'open' ? waitingLine(role, required.length, waiting.length, owedElsewhere) : null}

      {mayPress ? (
        <div className="row window__actions">
          {/*
            THE ONE CONTROL, and it is the only thing in this dialog that does
            anything. One press, one `PASS_INTERRUPT`, no optimistic local state:
            the button stays enabled until the server's next state says the decline
            landed, which is the same discipline as every other control here.
          */}
          <button
            type="button"
            className="btn btn--primary btn--wide"
            onClick={onDecline}
            data-testid="interrupt-decline"
            aria-describedby="interrupt-decline-why"
          >
            DECLINE — LET THE CARD RESOLVE
          </button>
          <p className="panel__note panel__note--quiet window__why" id="interrupt-decline-why">
            Declining spends nothing and cannot be taken back. The card resolves as it
            would have with nobody answering it, and you are not asked again for this
            window.
          </p>
        </div>
      ) : null}

      {mayPress
        ? respondBlock(state, w, you, responsive, deflectTarget, onRespond, onDeflectTarget)
        : null}
    </>
  );

  // ── the modal: the one seat with a decision to make ──
  if (isModal) {
    return (
      <div className="scrim window-scrim" data-testid="interrupt-window-modal">
        <div
          className="sheet window-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="A card is being answered"
          aria-describedby="window-card"
          tabIndex={-1}
          ref={dialogRef}
          data-testid="interrupt-window"
          data-role={role}
        >
          {body}
        </div>
      </div>
    );
  }

  // ── everything else: a status, and no control at all ──
  return (
    <section
      className="window-band"
      role="group"
      aria-label="A card is being answered"
      data-testid="interrupt-window-banner"
      data-role={role}
    >
      {/*
        NOT A LIVE REGION, DELIBERATELY. The shell has exactly one — the board's
        (§8.5) — and `interrupt.ts` extends its sentence for every stage and every
        seat. A second polite region beside this banner would announce the same
        event twice on every screen reader, and a duplicated announcement is worse
        than one that arrives a beat late.
      */}
      <div className="window-band__inner" tabIndex={-1} ref={dialogRef}>
        {body}
      </div>
    </section>
  );
}

// ─────────────────────────── the copy, per stage and seat ───────────────────────────

function titleFor(stage: WindowStage, role: WindowRole): string {
  if (stage === 'answered') return 'The card has been answered';
  switch (role) {
    case 'decliner':
      return 'A card is being answered — it is your move';
    case 'actor':
      return 'Your card is being answered';
    case 'declined':
      return 'You have declined — the table is still deciding';
    case 'frozen':
      return 'A card is being answered';
    case 'spectator':
      return 'A card is being answered';
    default:
      return 'A card is being answered';
  }
}

/**
 * One line saying who the window is still waiting on — and it never says who is
 * holding anything. The engine's required set is `turnOrder` minus the actor minus
 * the frozen, and it is computed here from the state on every render, so a frozen
 * player is never counted as someone the table is waiting on.
 */
function waitingLine(
  role: WindowRole,
  requiredCount: number,
  outstandingCount: number,
  owedElsewhere: boolean,
): string | null {
  if (role === 'decliner') {
    return 'If you hold a card that can answer this, you may play it instead. You may also decline.';
  }
  if (role === 'actor') {
    const wait = owedElsewhere
      ? ' An Ideology Card is still put to you, and it cannot be answered until this window closes.'
      : '';
    return `You played this card, so you may not answer it. Nobody can move until the window closes.${wait}`;
  }
  if (role === 'declined') {
    return outstandingCount === 1
      ? 'The window closes when the last player declines. One player still has to.'
      : `The window closes when everyone has declined. ${outstandingCount} still have to.`;
  }
  if (role === 'frozen') {
    return `You have a decision of your own to settle first, so the table is not waiting on you. ${outstandingCount} other${
      outstandingCount === 1 ? ' player has' : ' players have'
    } to go.`;
  }
  if (role === 'spectator') {
    return 'You are watching. The players may respond; you cannot act.';
  }
  if (requiredCount === 0) return null;
  return `${outstandingCount} player${outstandingCount === 1 ? '' : 's'} may still decline.`;
}

/**
 * The respond path, and its three honest states.
 *
 * `[]` and `undefined` are different claims and are rendered differently, exactly
 * as `ConspiracyPicker` renders them. Neither renders a control, because a card
 * this client cannot see is a card it must not offer (§9.10: a control that cannot
 * do what it looks like is worse than no control at all).
 */
function respondBlock(
  state: ClientState,
  w: InterruptWindow,
  you: PlayerID | null,
  responsive: readonly ResponsiveCard[] | undefined,
  deflectTarget: PlayerID | null,
  onRespond: (cardId: string, at: PlayerID | undefined) => void,
  onDeflectTarget: (at: PlayerID | null) => void,
) {
  if (responsive === undefined) {
    return (
      <div className="window__respond" data-testid="window-respond-unknown">
        <p className="sheet__body">
          Answering would mean playing a card from your hand, and this client is not
          told what you hold — a Conspiracy Card is a hidden hand, so the server sends
          only the cards you may legally play, and it has not sent that list for a
          response window. So there is no card to show you here, and this panel will
          not guess at one.
        </p>
        <p className="panel__note panel__note--quiet">
          Declining below is always available and always closes your part of the
          window.
        </p>
      </div>
    );
  }

  if (responsive.length === 0) {
    return (
      <div className="window__respond" data-testid="window-respond-none">
        <p className="sheet__body">
          You hold no card the server will accept as an answer to this one. That is
          the ordinary case — declining is a real move, not a failure to find a card.
        </p>
      </div>
    );
  }

  /*
    THE DEFLECT TARGET LIST. A DEFLECT must name a player, and the engine refuses
    both players the card's own text excludes: the actor (the effect may not be
    redirected back at whoever played it) and the responder (a DEFLECT aimed at
    yourself is a no-op dressed as a card). So the picker offers exactly
    `turnOrder` minus those two, from the public state — no hand, no inference.
  */
  const targets = state.turnOrder.filter((p) => p !== w.actor && p !== you);

  return (
    <div className="window__respond" data-testid="window-respond-list">
      <p className="sheet__body">
        The server says {responsive.length} of your card{responsive.length === 1 ? '' : 's'} may
        answer this one. Playing one is final — the card goes face up and the window closes.
      </p>
      <ul className="con" data-testid="window-cards">
        {responsive.map((card) => (
          <li key={card.id} className="con__card" data-responsive-id={card.id} data-op={card.op}>
            <h3 className="con__name">{card.name}</h3>
            <p className="con__text">{card.text}</p>
            {card.op === 'deflect' ? (
              <div className="window__deflect">
                <span className="field__label">REDIRECT IT TO</span>
                <div className="row row--tight">
                  {targets.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="btn btn--sm"
                      aria-pressed={deflectTarget === p}
                      onClick={() => onDeflectTarget(p)}
                      data-testid={`window-deflect-target-${p}`}
                    >
                      {state.players[p]?.name ?? p}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={card.op === 'deflect' && deflectTarget === null}
              aria-disabled={card.op === 'deflect' && deflectTarget === null}
              onClick={() => onRespond(card.id, card.op === 'deflect' ? (deflectTarget ?? undefined) : undefined)}
              data-testid={`window-respond-${card.id}`}
              aria-label={
                card.op === 'block'
                  ? `Play ${card.name} to block this card. ${card.text}`
                  : `Play ${card.name} to deflect this card to ${
                      state.players[deflectTarget ?? '']?.name ?? 'nobody yet'
                    }. ${card.text}`
              }
            >
              {card.op === 'block' ? 'BLOCK IT' : 'DEFLECT IT'}
            </button>
          </li>
        ))}
      </ul>
      {responsive.some((c) => c.op === 'deflect' && c.id === deflectTarget) ? (
        <p className="panel__note panel__note--quiet" data-testid="window-deflect-note">
          {state.players[deflectTarget ?? '']?.name ?? 'That player'} will be the one the card
          resolves for — the whole effect list, not one clause of it.
        </p>
      ) : null}
    </div>
  );
}
