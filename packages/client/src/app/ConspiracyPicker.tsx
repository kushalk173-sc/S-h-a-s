/**
 * THE CONSPIRACY DIALOG, and the rule that decides everything in it.
 *
 * THE RULE: this component renders ONLY what the server put in `playable`, and it
 * never constructs, remembers, guesses or infers a hand. It has no card index, no
 * card data of its own, and no memory between renders. If the server sends three
 * cards, it draws three rows; if it sends none, it says so.
 *
 * WHY THAT RULE, GIVEN THAT A CONSPIRACY IS "BOUGHT AND HELD" (rules-reference.md
 * §12). A held card is a private possession, and ARCHITECTURE §8.1.1 (D25, overturned)
 * is explicit that `playerView` strips every player's `conspiracies` — the viewer's
 * own included — with no viewer-scoped exception. The reason is not squeamishness:
 * a client holding its own hand decides for itself what to play, and the deduction
 * that is supposed to happen at the table never happens at all. That is the same
 * defect as shipping the blind answer's payout, one layer out.
 *
 * So how is the mechanic usable? The engine's own docstring names the way out: the
 * client learns a card is *playable* from a public flag, never by reading the hand.
 * `viewFor` computes, per viewer, exactly the cards `reduce` will accept for a
 * `PLAY_CONSPIRACY` right now, and sends id + printed name + printed text. Three
 * consequences worth stating, because they are what makes this safe:
 *
 *   1. Every id in `playable` is one the viewer ALREADY OWNS. Learning the name of
 *      a card in your own hand tells you nothing about anyone else's hand.
 *   2. The list is empty at every moment the viewer could not play a conspiracy
 *      anyway — outside the `actions`/`answer` windows, when it is not their turn,
 *      and while they owe a `PendingChoice`. So it is not a persistent window onto
 *      the hand; it appears at the one instant the player must decide, and vanishes.
 *   3. The client is still not told what it holds. `players[you].conspiracies`
 *      arrives as `[]`, and this component has no access to anything else.
 *
 * THE EMPTY STATES ARE THREE, NOT ONE, and each says something different:
 *
 *   `undefined`  the server did not send the field (an older server, or a payload
 *                that has not landed). Fail CLOSED: say what is known, say why
 *                nothing is listed, and still offer the buy. Never a spinner, never
 *                a blank panel, never a fabricated card.
 *   `[]`         the server sent the field and the answer is genuinely none right
 *                now — wrong turn, wrong phase, or a decision owed first.
 *   non-empty    render the printed cards, with a PLAY button on each.
 *
 * The buy half of the dialog is unchanged and still needed in every state: a
 * Conspiracy can be bought at any point in the turn, and it goes to the top of the
 * hand unlooked-at, which is exactly what the rules intend.
 */

import type { Pool } from '@shasn/engine';

import { ResourcePicker } from './ResourcePicker.tsx';

/**
 * One Conspiracy Card, as the server named it.
 *
 * Declared here rather than imported from the server package: `net/protocol.ts` is a
 * type-only mirror and `@shasn/engine` owns neither this shape nor the payload, and
 * the client must not acquire a dependency on the server to describe three strings.
 */
export type PlayableConspiracy = {
  readonly id: string;
  readonly name: string;
  /** The printed effect text, in the players' own words. */
  readonly text: string;
};

export type ConspiracyPickerProps = {
  readonly pool: Pool;
  /** The printed cost of the top Conspiracy Card, or 0 when the deck is empty. */
  readonly total: number;
  readonly pick: Readonly<Record<string, number>>;
  /**
   * The server's list, verbatim. `undefined` means the field was absent, which is
   * a different statement from "you hold nothing playable" and is rendered as one.
   */
  readonly playable: readonly PlayableConspiracy[] | undefined;
  readonly onPick: (next: Readonly<Record<string, number>>) => void;
  readonly onConfirm: (pay: Readonly<Record<string, number>>) => void;
  /** Play a card by id. The server re-checks legality; this only asks. */
  readonly onPlay: (cardId: string) => void;
  readonly onCancel: () => void;
};

export function ConspiracyPicker({
  pool,
  total,
  pick,
  playable,
  onPick,
  onConfirm,
  onPlay,
  onCancel,
}: ConspiracyPickerProps) {
  // A price of 0 is not a Conspiracy Card the player cannot afford — the deck is
  // empty. Say that, rather than rendering nothing at all and leaving a modal open
  // with no content in it.
  if (total <= 0) {
    return (
      <div className="scrim">
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Conspiracy Card">
          <h2 className="sheet__title">No Conspiracy Card is purchasable</h2>
          <p className="sheet__body">
            The Conspiracy deck is empty, so there is nothing to buy. Your hand, if you hold any
            cards, is unchanged.
          </p>
          <button type="button" className="btn btn--primary" onClick={onCancel} data-testid="conspiracy-close">
            CLOSE
          </button>
        </div>
      </div>
    );
  }

  if (playable === undefined) {
    // THE HONEST EMPTY STATE. Not a spinner, not a blank panel, not a fabricated
    // card: a plain statement of what is known, why nothing is listed, and what
    // the player can still do. §9.10 — a control that cannot do what it looks like
    // says so, rather than pretending.
    return (
      <div className="scrim">
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Conspiracy Card">
          <h2 className="sheet__title">Nothing to choose from — yet</h2>
          <p className="sheet__body">
            A Conspiracy Card is bought and held face down, so this client is not told what you are
            holding and cannot show you a list of it. The server has not sent the set of cards you
            may legally play, so rather than guess — and rather than show you your own hand, which
            would be information the other players do not have — this panel says nothing.
          </p>
          <p className="sheet__body">
            You can still buy the top card for any <strong>{total}</strong> resources. It goes to
            the top of your hand unlooked-at, exactly as the rules intend.
          </p>
        </div>
        <div style={{ maxWidth: '46rem', width: '100%', marginTop: 'var(--sp-3)' }}>
          <ResourcePicker
            pool={pool}
            total={total}
            pick={pick}
            onPick={onPick}
            heading={`Buy the top Conspiracy Card — any ${total} resources`}
            confirmLabel={`BUY — ${total} RESOURCES`}
            onConfirm={() => onConfirm(pick)}
            onCancel={onCancel}
          />
        </div>
      </div>
    );
  }

  // A server-sent list. Each row is the PRINTED card — name and effect text, exactly
  // as the server sent them — plus one PLAY button. The id is carried as a data
  // attribute for the test and for the click handler, and is never rendered as text:
  // a card id is a database key, not something a player reads.
  return (
    <div className="scrim">
      <div className="sheet sheet--wide" role="dialog" aria-modal="true" aria-label="Conspiracy Card">
        <h2 className="sheet__title">Play a Conspiracy Card</h2>
        <p className="sheet__body">
          {playable.length === 0
            ? 'You hold no Conspiracy Card you may play at the moment.'
            : `The server says ${playable.length} of your cards may be played. You may also buy the top card for any ${total} resources.`}
        </p>

        {playable.length === 0 ? null : (
          <ul className="con" data-testid="conspiracy-list">
            {playable.map((card) => (
              <li key={card.id} className="con__card" data-conspiracy-id={card.id}>
                <h3 className="con__name">{card.name}</h3>
                <p className="con__text">{card.text}</p>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => onPlay(card.id)}
                  data-testid={`play-conspiracy-${card.id}`}
                  aria-label={`Play ${card.name}. ${card.text}`}
                >
                  PLAY &ldquo;{card.name}&rdquo;
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ maxWidth: '46rem', width: '100%', marginTop: 'var(--sp-3)' }}>
        <ResourcePicker
          pool={pool}
          total={total}
          pick={pick}
          onPick={onPick}
          heading={`Buy the top Conspiracy Card — any ${total} resources`}
          confirmLabel={`BUY — ${total} RESOURCES`}
          onConfirm={() => onConfirm(pick)}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
