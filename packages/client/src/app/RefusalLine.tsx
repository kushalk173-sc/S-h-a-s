/**
 * THE LINE THAT SAYS WHY A PRESS DID NOTHING — because for a year of commits
 * there was nowhere to put it.
 *
 * ## WHAT WAS FOUND, IN A BROWSER, ON A REAL TABLE
 *
 * A three-seat run, turn 4. Seat 0 held `1 funds · 2 clout · 3 media · 1 trust`.
 * The HQ Mat showed `2 clout · 1 media · 1 trust — ◈ 3` and rendered the button
 * LIVE, with no shortfall printed beside it. The card was clicked.
 *
 *   - no frame left the socket (the page's own WebSocket tap recorded nothing),
 *   - no `error` toast appeared,
 *   - no market card changed,
 *   - and **nothing anywhere on the page said anything at all.**
 *
 * The reason was in the client the whole time. `setRefusal` had ~25 call sites
 * across `GameScreen` and `session.ts`, and `app.refusal` was rendered in exactly
 * two places — `PlacementBar` and `GerryBar` — both of which exist only while a
 * placement or a gerrymandering flow is open. Every refusal raised from the
 * market, the powers tray, the TRADE row, the Conspiracy buttons, the answer
 * screen, and `send`'s own *"That did not reach the table"* was written to state
 * and shown to nobody.
 *
 * That is this project's worst bug class — a control that visibly does nothing,
 * with no explanation — and it was worse than the reported one, because the
 * reported one at least had a diagnosis.
 *
 * ## WHY A SEPARATE SURFACE AND NOT THE PLACEMENT BAR'S
 *
 * `PlacementBar` treats `refusal` as a 1.2-second inline flash that *replaces*
 * its guidance line while the player is choosing slots — a good design, and the
 * right one for a decision being taken slot by slot. Lifting it out would take
 * that away. So the bar keeps its flash, `GerryBar` keeps its own, and this line
 * carries every refusal raised anywhere else. `suppressed` is how the two coexist
 * without saying the same sentence twice in the same frame.
 *
 * ## WHAT IT IS NOT
 *
 *  - **Not a control.** No dismiss button, no acknowledgement. A dismissal is a
 *    thing to click, and the rule is that a refusal must never be the only way
 *    out of a screen — adding a button here would invite exactly that.
 *  - **Not a toast.** It sits in the flow above the board beside `StandBanner`,
 *    `ResponseWindow` and `TableQuestion`, because it is a sentence about what
 *    just happened to *you*, and the space above the board is where this client
 *    already puts things a player has to read.
 *  - **Not sticky.** It clears itself after six seconds — the same life as
 *    `ErrorToast` — so a refusal from three turns ago is not still on screen
 *    claiming to be current. A refusal that never goes away is a decoration, and a
 *    decoration is not a reason.
 */

import { useEffect } from 'react';

export const REFUSAL_MS = 6000;

export type Refusal = { readonly text: string; readonly at: number } | null;

export function RefusalLine({
  refusal,
  suppressed,
  onExpire,
}: {
  readonly refusal: Refusal;
  /**
   * True when a bar that owns its own copy of the message is on screen — the
   * placement bar and the gerrymander bar both flash the refusal inline for
   * 1.2s. Two sentences saying the same thing in one frame is one sentence too
   * many.
   */
  readonly suppressed: boolean;
  /** Called once the line has said its piece and should go away. */
  readonly onExpire: () => void;
}) {
  /*
    Keyed on `at`, not on `text`. Two identical refusals in a row must re-arm the
    timer, and a dependency on the string alone cannot tell them apart — which is
    why the store made the counter monotonic in the first place.
  */
  useEffect(() => {
    if (refusal === null || suppressed) return;
    const t = setTimeout(onExpire, REFUSAL_MS);
    return () => clearTimeout(t);
  }, [refusal?.at, suppressed, onExpire]);

  if (refusal === null || suppressed) return null;
  return (
    <p
      className="refusal"
      role="status"
      aria-live="polite"
      data-testid="refusal"
      data-at={refusal.at}
    >
      {refusal.text}
    </p>
  );
}