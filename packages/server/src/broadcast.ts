/**
 * THE ONLY EXIT TO THE WIRE.
 *
 * Every byte of `GameState` that reaches a socket passes through this file, and
 * nowhere else. There are exactly two projections and they are deliberately
 * separate:
 *
 *   viewFor        — the broad public view. `playerView`, plus the strip of
 *                    every other player's Conspiracy hand.
 *   blindPromptFor — the narrow one. Question text and two answer strings, and
 *                    nothing else that could help a player choose.
 *
 * The separator is the design. A single `playerView` that conditionally included
 * the prompt would still pass the structural leak test, because a prompt is not a
 * `_`-prefixed key — the game would be dead and the test green. Keeping them apart
 * means the prompt's output type is `{question, labels, order}`, which admits no
 * payout, no Ideologue and no card id, and which can therefore be asserted
 * structurally too.
 *
 * This is also the ONLY file in the server permitted to read a `_`-prefixed field.
 * `scripts/check-secrets.mjs` fails the build on any other occurrence, in any
 * file, including in a comment — so the rule cannot be softened by rewording.
 *
 * The two `order`-related reads below are the reason that file needs the
 * `_pendingCard` and `_seed` at all, and they are here rather than in the dispatch
 * path for exactly that reason: the mapping from "the button the player pressed" to
 * "the side of the card" is a secret-state question, and secret-state questions
 * live in this file.
 */

import {
  playerView,
  type CardID,
  type CardIndex,
  type ClientState,
  type GameState,
  type PlayerID,
} from '@shasn/engine';

import type { BlindPrompt } from './protocol.ts';

/**
 * Which side of the card the player was shown first.
 *
 * PLAN.md §2 amendment A': a card's two answers belong to two different
 * Ideologues, and the shipped answer pool is not balanced side-to-side, so a
 * fixed left/right order is a channel. Players who notice that one flavour
 * clusters on one side learn the position instead of deliberating — the same class
 * of leak as shipping the payout, only slower.
 *
 * The draw is a pure function of the match's own PRNG cursor and the card being
 * answered. It is NEVER `Math.random`: replay determinism is what makes the action
 * log authoritative (ARCHITECTURE §3.6), and a server-side coin flip would make a
 * replayed match present a different question order than the original.
 *
 * Consequences of it being a pure function of state, which are all the point:
 *  - a client that reconnects mid-answer is shown the SAME order it was shown
 *    before, so a click is never silently reinterpreted;
 *  - a redraw changes the card and therefore the order, which is correct: it is a
 *    different question, and the client simply re-renders the prompt;
 *  - a spectator and the other players see no order at all, because the prompt is
 *    only ever built for the player who is answering.
 */
export type AnswerOrder = BlindPrompt['order'];

/**
 * Placeholder viewer for spectators.
 *
 * The engine currently types `playerView(state, viewer: PlayerID)` and ignores the
 * argument outright — Conspiracy hands are stripped for everyone, owner included,
 * which is deliberate (a hidden hand shipped to its owner turns a bluffing
 * mechanic into a solved one). Widening the engine signature to `PlayerID | null`
 * is the engine package's call, not this one's, so the server passes a value that
 * matches no seat.
 *
 * This is safe against that signature being widened later: `''` is not a player
 * id, so a viewer-scoped branch would take the spectator path, which is the
 * correct behaviour anyway. It is a pinned decision, not an oversight — if the
 * engine ever starts branching on the viewer, this constant must be revisited.
 */
const NO_VIEWER = '';

/**
 * The public projection. One code path for players and spectators alike, which is
 * the only reason the structural leak test can be meaningful: a separate spectator
 * projection would be a second projection, and second projections leak.
 */
export function viewFor(state: GameState, viewer: PlayerID | null): ClientState {
  return playerView(state, viewer ?? NO_VIEWER);
}

/**
 * The one place a card's *content* is ever written to a socket.
 *
 * Returns `null` for anyone who is not the player currently holding the card,
 * which is every other player and every spectator. The type admits no `Delta`, no
 * `Ideologue`, no `CardID` and no number.
 */
export function blindPromptFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID,
): BlindPrompt | null {
  if (viewer !== state.activePlayer) return null;
  if (state.phase !== 'answer') return null;
  const cardId = readPendingCard(state);
  if (cardId === null) return null;
  const card = cards.ideology[cardId];
  if (card === undefined) return null;

  const a = card.sides[0];
  const b = card.sides[1];
  if (a === undefined || b === undefined) return null;

  const order = orderFor(state, cardId);
  // Display order. `labels[0]` is what renders first, always, in a fixed DOM
  // position — the client is forbidden from styling the two cells differently
  // (UI-SPEC §9 anti-pattern 1), so position carries no information.
  const labels: readonly [string, string] = order === 'ab' ? [a.answer, b.answer] : [b.answer, a.answer];
  return { question: card.question, labels, order };
}

/**
 * Map the index the player *pressed* to the side of the card they *meant*.
 *
 * The client sends a display position, because that is all it was shown. The
 * reducer's `ANSWER` action is written against the card's own `sides` tuple, so
 * the translation has to happen somewhere. It happens here, in the one file that
 * is allowed to know the answer key, and it is the reason the two answer buttons
 * can be a fixed symmetric pair with a random order behind them.
 *
 * Returns `null` when there is no blind prompt to answer — no pending card, wrong
 * phase, wrong player, or a card that cannot be read. The caller turns that into
 * a plain rejection, so an unanswerable request never reaches the reducer.
 */
export function answerSideFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID,
  displayIndex: 0 | 1,
): 0 | 1 | null {
  const prompt = blindPromptFor(state, cards, viewer);
  if (prompt === null) return null;
  return displayIndex === 0 ? (prompt.order === 'ab' ? 0 : 1) : prompt.order === 'ab' ? 1 : 0;
}

/**
 * Is this player the one who must answer right now?
 *
 * Deliberately coarse: it says whether a prompt is owed, and nothing about which
 * card. It reads the pending card only so that "no card" and "card I cannot read"
 * are not confused with "your turn", and it does not return the card's contents.
 */
export function owesBlindPrompt(state: GameState, viewer: PlayerID): boolean {
  return (
    viewer === state.activePlayer && state.phase === 'answer' && readPendingCard(state) !== null
  );
}

// ─────────────────────── the two sanctioned reads ───────────────────────

/** The card put to the active player. Used only to answer "is there a prompt". */
function readPendingCard(state: GameState): CardID | null {
  return state._pendingCard;
}

/**
 * A seed-derived coin flip for presentation order.
 *
 * FNV-1a is used for the card id, then two avalanche steps with the match's PRNG
 * cursor folded in. Note *which* bit is taken, because FNV-1a has a well-known
 * weakness and it is exactly here: the low bit of an FNV hash is the parity of the
 * XOR of the input bytes, because the prime is odd and an odd multiply preserves
 * the low bit of its addend. Two card ids of the same length differ mostly in
 * their trailing digits, so a raw low bit is close to a checksum of the id — an
 * attacker could enumerate the deck and predict the presentation order.
 *
 * So the draw is taken from bit 16, which is fully mixed, after the cursor is
 * folded in. The cost is one constant. The alternative — take the low bit of a
 * stronger hash — would mean a second hash implementation in a file whose job is
 * to be obviously correct, and this is measurably uniform (see the distribution
 * test in the secret-state suite, which is why it is a test and not a claim).
 *
 * It is written out rather than pulled from `rng.ts` because the engine's
 * `shuffle` would ADVANCE the cursor, and advancing the cursor outside the reducer
 * is precisely the impurity that makes replay worthless (ENGINE-AUDIT R2).
 */
function orderFor(state: GameState, cardId: CardID): AnswerOrder {
  const seed = state._seed;
  let h = 0x811c9dc5;
  for (let i = 0; i < cardId.length; i += 1) {
    h ^= cardId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = Math.imul(h ^ (seed | 0), 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h >>> 16) & 1) === 0 ? 'ab' : 'ba';
}
