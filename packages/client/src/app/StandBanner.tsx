/**
 * THE STAND OF THE BOARD — the one line that says whether this election is still
 * going anywhere.
 *
 * ## WHY IT IS A BANNER ABOVE THE BOARD AND NOT A BADGE
 *
 * The defect was not a missing badge. It was a real three-seat run that sat at
 * 490 turns — eight constituencies held, Central one vote short with its last
 * empty slot right there — while every screen showed a normal game. A player in
 * that position has one question and it is not a decorative one: *do I keep
 * playing, or is this over?* So this is a sentence, in prose, in the flow above
 * the board, visible to every seat and to spectators.
 *
 * It is placed where `ResponseWindow` and `TableQuestion` sit, and for the reason
 * those two do: it is table information, and the place a table reads is the space
 * above the board rather than a tab three panels away.
 *
 * ## WHAT IT IS NOT ALLOWED TO DO
 *
 *  - **It does not end the game, and it does not say the game is over.** There is
 *    no rulebook provision for a table declaring itself unwinnable. `dead` means a
 *    constituency can never be decided, which closes p7's "all nine" ending, and
 *    the sentence says precisely that and no more.
 *  - **It is not a control.** No buttons, no dismiss, no acknowledgement. It is
 *    information and it disappears when it stops being true, which the engine's
 *    own report decides and nothing local does.
 *  - **It renders nothing at all when there is nothing true to say.** An empty
 *    banner that reserves space is a permanent reminder that the game might be
 *    broken, which is the opposite of the point.
 */

import type { ClientState } from '@shasn/engine';

import { standVerdict } from './derive.ts';

export function StandBanner({ state }: { readonly state: ClientState }) {
  const verdict = standVerdict(state);
  if (verdict.sentence === null) return null;
  return (
    <section
      className={`stand stand--${verdict.tone}`}
      role="status"
      data-testid="stand-banner"
      data-tone={verdict.tone}
    >
      <p className="eyebrow">
        {verdict.tone === 'dead' ? 'NO ENDING ON NINE' : 'THE STAND'}
      </p>
      <p className="stand__sentence" data-testid="stand-sentence">
        {verdict.sentence}
      </p>
    </section>
  );
}