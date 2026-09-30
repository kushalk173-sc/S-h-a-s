/**
 * The blind answer, wired to the wire.
 *
 * This is the whole of `app/`'s involvement in the game's central mechanic, and
 * it is deliberately about forty lines. Everything security-relevant was already
 * settled before this file existed:
 *
 *   · The server sends `{question, labels, order}` and NOTHING ELSE. No payout,
 *     no Ideologue, no card id, no number (`net/protocol.ts:BlindPrompt`).
 *   · `BlindAnswer` has no prop through which a payout could arrive, proven at
 *     the type level (`answer/blindAnswer.types.ts`) and at the DOM level
 *     (`answer/blindAnswer.test.tsx`).
 *   · The two sides are the same element with the same class, and
 *     `blindAnswer.css` fails the build if any positional or side-identity
 *     selector appears in it.
 *
 * So this file's job is arithmetic, not security: put the server's display
 * labels into the component in the order the server sent them, and translate the
 * committed wire side back into the display index the server expects.
 *
 * ── THE ORDER, AND WHY THE CLIENT NEVER SORTS ──────────────────────────────
 *
 * `BlindAnswer` takes `labelA` / `labelB` and a `seed`, and renders them in a
 * seed-derived order. That is correct for a component that holds both sides
 * un-mapped. This app holds them ALREADY MAPPED: the server's `labels` tuple is
 * in display order, decided by the seed-derived `order` in `broadcast.ts`, and
 * the server maps the clicked display index back through that same `order` in
 * `room.ts#toEngineAction`.
 *
 * So the client does not re-derive an order. It puts `labels[0]` in `labelA` and
 * `labels[1]` in `labelB` and picks a seed that renders A first — which means the
 * component's own ordering becomes an identity function and the server's order
 * is what the player sees. The `order` field is not consulted, and could not be:
 * it names which side of the card is which, and a client that branched on it
 * would be branching on the very thing the mechanic protects.
 *
 * WHY A SEED PROP AT ALL, THEN. Because `BlindAnswer` is a shared component with
 * a mutation-tested gate and I do not own `answer/**`'s contract; changing its
 * props would mean editing a file whose type-level proof another agent's tests
 * depend on. Instead the seed is used for the one thing it can safely do here:
 * force the presentation order to be "as given", which is what the server asked
 * for. `WIRE_ORDER_SEED` is a constant, not a per-card draw, so it carries zero
 * information — and the test below asserts the two facts that make it true.
 */

import type { BlindPrompt } from '../net/index.ts';
import { presentationOrder } from '../answer/BlindAnswer.tsx';

/**
 * A seed whose `presentationOrder` is `'ab'`, i.e. A renders first.
 *
 * A constant, chosen so that `labelA` (which this app sets to the server's
 * FIRST-displayed label) is the one the player sees on the left. There is no
 * randomness here and no per-card variation: the server already randomised the
 * order before it reached us, and doing it twice would mean one of the two
 * randoms is the one that leaks.
 *
 * `app.test.tsx` asserts `presentationOrder(WIRE_ORDER_SEED) === 'ab'`, so if
 * the hash ever changes this constant becomes a compile-time no-op rather than a
 * silent reversal of the server's order.
 */
export const WIRE_ORDER_SEED = 1;

/** The props `BlindAnswer` needs, derived from the server's prompt and nothing else. */
export type WirePrompt = {
  readonly question: string;
  /** `labels[0]` — what the server put in the FIRST position. */
  readonly labelA: string;
  /** `labels[1]`. */
  readonly labelB: string;
  readonly seed: number;
};

/**
 * The server's prompt, in the component's shape.
 *
 * The `labels` tuple is used positionally and is NEVER sorted, compared, or
 * branched on. There is no branch here at all, which is the point: the only
 * thing this function can do is copy.
 */
export function promptToProps(prompt: BlindPrompt): WirePrompt {
  return {
    question: prompt.question,
    labelA: prompt.labels[0],
    labelB: prompt.labels[1],
    seed: WIRE_ORDER_SEED,
  };
}

/**
 * Translate the committed wire side into the display index the server wants.
 *
 * `ANSWER.side` is a DISPLAY index, not the card's own `sides` tuple — the server
 * remaps it through the same `order` it used to build the prompt
 * (`room.ts#toEngineAction`), which is what makes a fixed left/right pair safe.
 * Because the presentation seed above guarantees A renders first, `'A'` is
 * display index 0 and `'B'` is 1.
 *
 * The two mappings are the same mapping, and that is the invariant worth
 * asserting: if they ever disagree, a player who committed a side silently gets
 * the other one's payout, and the game is still "working".
 */
export function committedSideToDisplayIndex(side: 'A' | 'B'): 0 | 1 {
  return side === 'A' ? 0 : 1;
}
