/**
 * The answer, wired to the wire.
 *
 * This is the whole of `app/`'s involvement in the game's central mechanic, and
 * it is deliberately about forty lines. What is security-relevant was settled in
 * `net/protocol.ts` and `answer/BlindAnswer.tsx`:
 *
 *   · The server publishes the WHOLE card to every seat — question, both answers,
 *     both Ideologues, both payouts (`net/protocol.ts:AnswerPrompt`, and the
 *     identical `openQuestion` on `state`). Nothing is withheld from the table,
 *     because nothing is: the Ideology corpus is public JSON in this repository.
 *   · The ONE thing withheld is `order`, the seed-derived face order, and it is
 *     withheld because with the Ideologue now printed beside each answer, a client
 *     that knew it could publish which Ideologue the left-hand cell is — the channel
 *     PLAN.md §2 amendment A′ exists to prevent. This file does not consult it.
 *   · The two sides are the same element with the same class, and neither may be
 *     styled by anything that differs between them. `blindAnswer.css` fails the
 *     build if any positional or side-identity selector appears in it.
 *
 * So this file's job is arithmetic, not security: put the server's sides into the
 * component in the order the server sent them, and translate the committed wire
 * side back into the display index the server expects.
 *
 * ── THE ORDER, AND WHY THE CLIENT NEVER SORTS ──────────────────────────────
 *
 * `BlindAnswer` takes `sideA` / `sideB` and a `seed`, and renders them in a
 * seed-derived order. That is correct for a component that holds both sides
 * un-mapped. This app holds them ALREADY MAPPED: the server's `sides` tuple is
 * in display order, decided by the seed-derived `order` in `broadcast.ts`, and
 * the server maps the clicked display index back through that same `order` in
 * `room.ts#toEngineAction`.
 *
 * So the client does not re-derive an order. It puts `sides[0]` in `sideA` and
 * `sides[1]` in `sideB` and picks a seed that renders A first — which means the
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

import type { ClientState } from '@shasn/engine';

import type { AnswerPrompt, AnswerSide } from '../net/index.ts';
import { presentationOrder } from '../answer/BlindAnswer.tsx';

/**
 * A seed whose `presentationOrder` is `'ab'`, i.e. A renders first.
 *
 * A constant, chosen so that `sideA` (which this app sets to the server's
 * FIRST-displayed side) is the one the player sees on the left. There is no
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
  /** `sides[0]` — what the server put in the FIRST display position. */
  readonly sideA: AnswerSide;
  /** `sides[1]`. */
  readonly sideB: AnswerSide;
  readonly seed: number;
};

/**
 * The server's prompt, in the component's shape.
 *
 * The `sides` tuple is used positionally and is NEVER sorted, compared, or
 * branched on. There is no branch here at all, which is the point: the only
 * thing this function can do is copy.
 */
export function promptToProps(prompt: AnswerPrompt): WirePrompt {
  return {
    question: prompt.question,
    sideA: prompt.sides[0],
    sideB: prompt.sides[1],
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

/**
 * THE CARD ON THE TABLE, as the server published it for EVERY viewer.
 *
 * A server-side projection, not a field of `ClientState`: `openQuestionFor` takes
 * `(state, cards)` and no player, because at a physical table the question is read
 * aloud and belongs to the table (AUTHENTIC-SHASN-REFERENCE §7.2 step 1). It
 * arrives as an ordinary property of `state` for the same reason
 * `playableConspiracies` does — see `GameScreen.tsx` — and it is read here through the
 * same fail-closed narrow cast.
 *
 * ── WHAT IS IN IT NOW, AND WHAT IT COST ────────────────────────────────────
 *
 * Under full information it carries the whole card: the question, both answers, both
 * Ideologues and both payouts, to every seat and every spectator. That is a reversal of
 * §1.2's "no payouts, no ideologue names", and the reversal is deliberate — see
 * `broadcast.ts` for why the old withholding was protecting something that was already
 * public content, and for what the change costs the game rather than the wire.
 *
 * ── NO `order`, AND THAT IS NOW THE WHOLE POINT ────────────────────────────
 *
 * `order` says which face of the card a display position is. With the Ideologue printed
 * beside each answer, a client that could read `order` could publish the left-hand cell's
 * Ideologue in one line, which is precisely the channel PLAN.md §2 amendment A′ exists to
 * prevent — and A′ is the one property of the old blind design that survives this change
 * intact. So `PublishedOpenQuestion` admits no `order`, the validation below rejects a
 * payload that carries one, and the sides arrive ALREADY IN DISPLAY ORDER so the table and
 * the answerer are looking at one card rather than two orderings of it.
 */
export type PublishedOpenQuestion = {
  readonly question: string;
  readonly sides: readonly [PublishedOpenSide, PublishedOpenSide];
};

/** One published side. `pays` is a `Delta`: an absent pool means the card said nothing. */
export type PublishedOpenSide = {
  readonly label: string;
  readonly ideologue: 'capitalist' | 'supremo' | 'showstopper' | 'idealist';
  readonly pays: Readonly<Partial<Record<'funds' | 'clout' | 'media' | 'trust', number>>>;
};

const IDEOLOGUES: ReadonlySet<string> = new Set(['capitalist', 'supremo', 'showstopper', 'idealist']);
const POOLS: ReadonlySet<string> = new Set(['funds', 'clout', 'media', 'trust']);

/**
 * The open question, or `null`.
 *
 * FAIL-CLOSED, and the shape is validated rather than merely checked for
 * existence: a payload is attacker-adjacent input, so `undefined`, `null`, a
 * non-object, an empty question, a `sides` array of the wrong length, a side with
 * a blank label, an unknown Ideologue, a non-numeric payout, a payout naming a
 * pool that does not exist, and an `order` key all produce `null`.
 *
 * It is deliberately NOT keyed on the viewer's identity. Every seat, including a
 * spectator, gets the same card; the one thing that differs between seats is whether
 * `answer` — and with it the `order` draw and the commit control — was sent at all.
 */
export function openQuestionOf(state: ClientState): PublishedOpenQuestion | null {
  const raw = (state as { openQuestion?: unknown }).openQuestion;
  if (typeof raw !== 'object' || raw === null) return null;
  const q = raw as Record<string, unknown>;
  // An `order` on the table's copy is not a harmless extra field: it is the one thing
  // the `PublicQuestion` type does not admit, and a payload carrying it has been built
  // against a different (or forged) projection. Refuse the whole card rather than
  // render a card whose face order the server may have intended to be ambiguous.
  if ('order' in q) return null;
  if (typeof q['question'] !== 'string' || q['question'].length === 0) return null;
  const sides = q['sides'];
  if (!Array.isArray(sides) || sides.length !== 2) return null;
  const [first, second] = sides as unknown[];
  const a = readSide(first);
  const b = readSide(second);
  if (a === null || b === null) return null;
  return { question: q['question'], sides: [a, b] };
}

/** One side, validated. `null` for anything that is not a whole, readable side. */
function readSide(raw: unknown): PublishedOpenSide | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s['label'] !== 'string' || s['label'].length === 0) return null;
  const ideologue = s['ideologue'];
  if (typeof ideologue !== 'string' || !IDEOLOGUES.has(ideologue)) return null;
  const pays = s['pays'];
  if (typeof pays !== 'object' || pays === null) return null;
  const out: Record<string, number> = {};
  for (const [pool, amount] of Object.entries(pays as Record<string, unknown>)) {
    if (!POOLS.has(pool)) return null;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    out[pool] = amount;
  }
  return { label: s['label'], ideologue: ideologue as PublishedOpenSide['ideologue'], pays: out };
}
