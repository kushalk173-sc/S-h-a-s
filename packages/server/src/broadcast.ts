/**
 * THE ONLY EXIT TO THE WIRE.
 *
 * Every byte of `GameState` that reaches a socket passes through this file, and
 * nowhere else. There are exactly two projections and they are deliberately
 * separate:
 *
 *   viewFor        — the broad public view. `playerView`, plus the strip of
 *                    every other player's Conspiracy hand, plus the one
 *                    viewer-scoped addition described below, plus
 *                    `openQuestion`: the card on the table, said in public.
 *   blindPromptFor — the narrow one. Question text and two answer strings, and
 *                    nothing else that could help a player choose.
 *
 * THE PUBLIC QUESTION IS NOT A THIRD PROJECTION, and the distinction is the
 * interesting one. `openQuestion` is a FIELD of the broad view rather than a
 * projection of its own, because it has no viewer in it at all: `openQuestionFor`
 * takes `(state, cards)` and no player, because at a physical table the question
 * is read aloud and belongs to the table (AUTHENTIC-SHASN-REFERENCE §7.2 step 1).
 * What is private is not the question — it is the seed-derived `order` coin flip
 * and the commit control, and both of those arrive on the `blind` field, which is
 * still built for the answering player alone. So the table sees one card and the
 * answerer additionally holds the means to answer it.
 *
 * THE VIEWER-SCOPED ADDITION — `playableConspiracies` — and why it is here and
 * not in `playerView.ts`. The D25 ruling (ARCHITECTURE §8.1.1) holds that a hand
 * is private: `playerView` strips every player's `conspiracies`, the viewer's own
 * included, and that is load-bearing, because a client holding its own hand
 * decides for itself what to play and the deduction never has to happen at the
 * table. But "the client may not see its hand" is not the same as "the client may
 * not use its cards", and the engine's own docstring names the way out: the client
 * learns a card is *playable* from a public flag, never by reading the hand. So
 * `viewFor` computes, per viewer, the set of that viewer's OWN Conspiracy Cards
 * that are legally playable right now, and attaches it to the view.
 *
 * WHY SENDING THE ID IS SAFE, which is the sentence the next reader needs:
 *
 *   Every id in the list is an id the viewer ALREADY OWNS. Learning the name of
 *   a card in your own hand tells you nothing about anybody else's hand, because
 *   the list is built from `state.players[viewer].conspiracies` and from no other
 *   player's state. There is no union, no "possible cards" set, no count of what
 *   another player might hold. A player who sees `playableConspiracies: [X]` has
 *   learned one thing: X is in their own hand and X is playable now — which is
 *   precisely the information a player holding a physical card already has.
 *
 * AND WHY IT IS NOT A HAND. The list is empty at every moment the viewer could not
 * legally play a conspiracy anyway: outside the `actions`/`answer` windows, when it
 * is not their turn, and while they owe a `PendingChoice`. A player therefore sees
 * their cards at the one instant they must decide, and at no other time — so the
 * payload cannot be used as a persistent view of the hand, which is the thing D25
 * was ruling out. `secret-state.test.ts` asserts both halves: the list is a subset
 * of the viewer's hand, and every card in it is one the engine will actually
 * accept a `PLAY_CONSPIRACY` for.
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
 * ONE Conspiracy Card the viewer may legally play right now, named.
 *
 * `name` and `text` are the printed card, and they are here rather than looked up
 * by the client for a reason worth stating: the client has no card index. It could
 * not render a card list at all from ids alone, and the alternative — shipping the
 * whole Conspiracy deck to the browser so the client could resolve them — would
 * publish the pool of conspiracies in this match's deck, which is a change in what
 * the game is about even though every individual card is public once played. So the
 * server sends the two strings alongside the id, for the viewer's own cards only.
 */
export type PlayableConspiracy = {
  readonly id: CardID;
  readonly name: string;
  /** The printed rules text — the effect, in the players' own words. */
  readonly text: string;
};

/**
 * THE OPEN QUESTION — what is on the table, said in public.
 *
 * ── THE RULING, AND THE THREE THINGS IT IS ABOUT ──────────────────────────
 *
 * Before this field, only the player holding the card was told the question. That
 * was a fidelity DEVIATION, and the rulebook says so plainly:
 *
 *   · `docs/AUTHENTIC-SHASN-REFERENCE.md` §7.2 step 1 (p764): "The player to your
 *     right takes the top Ideology Card and READS BOTH SIDES ALOUD TO YOU." Reading
 *     aloud to a table is a public act. Every other player is looking at the same
 *     two faces of the same piece of card.
 *   · §7.2 step 2 (p768-770): the redraw window is open to "ANY player", which is
 *     only a decision-shaped window if the table knows which question is being
 *     gambled on. A digital table that cannot see the question cannot participate
 *     in the moment the rulebook calls the social centre (§7.4 step 3, p815).
 *
 * So the QUESTION and BOTH LABELS are public while the card is out. That is change
 * A, and it is the physical game.
 *
 * WHAT IS NOT PUBLIC, AND WHY NOT — the line is drawn by the rulebook, not by
 * taste. §7.2 step 3 (p774-775): "You answer. You say which side. The card goes
 * under your mat, answer-side up, into the notch. THE ▼ AND THE PAYOUT ARE NOW
 * REVEALED." The payout is revealed *after* the answer, and §7.2 step 2 (p772)
 * spells out why that ordering is load-bearing: "Because the reading player does
 * not know what the card pays, the redraw is a BET, not a decision." Publicising
 * the question therefore does not turn the redraw into a decision, and publicising
 * the payout would. Change C — payout before anyone answers — is REFUSED here, and
 * this type is the proof: there is no `Delta`, no `Ideologue`, no `CardID` and no
 * number anywhere in it, exactly as in `BlindPrompt` (§7.2 step 1, p767: "no
 * payouts, no ideologue names").
 *
 * `order` IS DELIBERATELY ABSENT, and that is the seed-derived draw from PLAN.md §2
 * amendment A′: it says which face of the card a position is, so it is the one
 * field the table must not be able to line up against the deck's Ideologue balance.
 * The answerer gets it from `blind`, and it is the answerer's alone. What the table
 * gets instead is `labels` ALREADY IN DISPLAY ORDER, so everybody is looking at one
 * card rather than at two orderings of it — and position still carries no
 * information, because which position means which face is not published.
 *
 * PUBLIC BY CONTENT, NOT BY ID, AND THE PRECEDENT IS `manifestoCards`. The
 * rulebook's line is "until the active player confirms their answer" (p13, quoted
 * in `playerView.ts`): an ANSWED card is face up on the mat and is published by id
 * in `PlayerState.manifestoCards`, which is safe precisely because the payout has
 * already been paid and revealed, so the id adds nothing. An UNANSWERED card is on
 * the other side of that line, and every card in the shipped corpus is public
 * content — so publishing its id would hand the table a lookup key into the payout
 * table for a card nobody has answered yet. Content-only is therefore the same
 * ruling the project already applies to `manifestoCards`, not a third category.
 */
export type PublicQuestion = {
  readonly question: string;
  /** Display order, and the SAME order the answerer is shown. Never `order`. */
  readonly labels: readonly [string, string];
};

/**
 * `ClientState` plus the one viewer-scoped field and the one table-wide field.
 * Exported because the wire type declares `match:state.state` as `ClientState` and
 * widening it to `PublicView` there would break protocol parity with the client's
 * copy — see `protocol.ts`.
 */
export type PublicView = ClientState & {
  readonly playableConspiracies: readonly PlayableConspiracy[];
  readonly openQuestion: PublicQuestion | null;
};

/**
 * The public projection. One code path for players and spectators alike, which is
 * the only reason the structural leak test can be meaningful: a separate spectator
 * projection would be a second projection, and second projections leak.
 *
 * `cards` is required rather than optional for a specific reason. It is the only
 * thing that can turn an id into a name, so an optional parameter would mean a
 * caller who forgot it produced a payload with an empty `playableConspiracies` —
 * a picker that silently shows nothing, which is the exact failure this field
 * exists to fix and which no test would catch, because an empty list is legal.
 */
export function viewFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID | null,
): PublicView {
  const base = playerView(state, viewer ?? NO_VIEWER);
  return {
    ...base,
    playableConspiracies: playableConspiraciesFor(state, cards, viewer),
    openQuestion: openQuestionFor(state, cards),
  };
}

/**
 * The card on the table, in public, for EVERY viewer including a spectator.
 *
 * NO VIEWER PARAMETER, and that is the assertion the signature makes: the question
 * is a property of the state and the cards, not of who is asking, because at a
 * physical table it is a property of the table. It is computed per call rather than
 * cached, for the same reason `playableConspiraciesFor` is — a redraw swaps the
 * card and therefore the question and both labels, and the next projection must say
 * so with no invalidation step to forget.
 *
 * `null` at every moment there is no card out: wrong phase, no pending card, or a
 * card the index cannot read. It is `null`, never a partial object, so a client can
 * distinguish "no question on the table" from "a question I could not read" without
 * a second flag.
 */
export function openQuestionFor(state: GameState, cards: CardIndex): PublicQuestion | null {
  if (state.phase !== 'answer') return null;
  const prompt = pendingPromptFor(state, cards);
  if (prompt === null) return null;
  return { question: prompt.question, labels: prompt.labels };
}

/** The empty list. Shared so the common case allocates nothing per viewer. */
const NO_CONSPIRACIES: readonly PlayableConspiracy[] = Object.freeze([]);

/**
 * The Conspiracy Cards THIS viewer may legally play right now. Never anybody's else.
 *
 * Every guard below is a transcription of a guard the engine's own `reduce` applies
 * to `PLAY_CONSPIRACY`, in the engine's order, and each one is there because the
 * projection and the reducer must agree exactly. If they ever disagree the client
 * offers a button the server refuses, which is a control that looks like it works
 * and does not — §9.10's prohibited case. So the guards are:
 *
 *   1. no viewer (a spectator) or no such seat
 *   2. `state.finished`                     — reduce: 'the game is over'
 *   3. an open `state.interrupt`            — reduce: '"X" is resolving — answer
 *                                              it or decline first'
 *   4. a pending `PendingChoice`            — reduce: `blockedBy`, which freezes
 *                                              a player until the choice resolves
 *   5. the turn window: not your turn is legal ONLY in the `answer` window
 *                                              (reduce's `outOfTurnOk`), because
 *                                              p19 lets a conspiracy be played
 *                                              immediately before an opponent
 *                                              answers
 *   6. the phase window: `actions` or `answer` only (reduce's own phase check),
 *      and specifically NOT `headlines`
 *   7. the card is in the viewer's hand and is readable from the index
 *
 * GUARD 3 IS A BLANKET BAN, AND THAT IS THE RULE RATHER THAN THE EASY ANSWER.
 * `reduce.ts` places the window check FIRST, above the per-player freeze and above
 * the turn check, and exempts three ACTION TYPES — `RESPOND_INTERRUPT`,
 * `PASS_INTERRUPT`, `RESOLVE_CHOICE` — rather than three seats or three phases.
 * So an open window refuses `PLAY_CONSPIRACY` for the actor as well as for every
 * other seat, and in `actions` as well as in `answer`. Two narrower rules would
 * both be wrong: exempting the actor (they are refused too), and exempting a phase
 * (the window is deliberately not a `Phase` member, and it can be open in either).
 *
 * AND IT CANNOT BREAK RESPONDING, which is the thing a reader of this file should
 * check before changing it. Answering is not a conspiracy *played* — it is a card
 * spent through the separate `RESPOND_INTERRUPT` action, which is on the reducer's
 * exemption list and never reaches guard 7 at all. This list describes the PLAY
 * button and only the PLAY button, so emptying it during a window takes away one
 * dead control and leaves `RESPOND_INTERRUPT` and `PASS_INTERRUPT` untouched.
 * `interrupt-window.test.ts` asserts both halves: nothing offered that `reduce`
 * refuses, and a window still closed by a real BLOCK after the guard is in place.
 *
 * Note what is NOT a guard: nothing here looks at another player. `self` is the
 * only `PlayerState` read, so the list cannot contain a card the viewer does not
 * hold even by accident.
 *
 * COMPUTED, NEVER CACHED. There is no memo: the function is called on every
 * projection, for every viewer, on every action and on every sync, and it reads
 * `state` rather than anything derived from an earlier state. A conspiracy that is
 * bought, played, traded away or drawn changes the answer on the very next
 * projection, with no invalidation step that can be forgotten. The alternative —
 * a cache invalidated on some subset of actions — is how a card you no longer hold
 * stays on screen.
 */
export function playableConspiraciesFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID | null,
): readonly PlayableConspiracy[] {
  if (viewer === null) return NO_CONSPIRACIES;
  const self = state.players[viewer];
  if (self === undefined) return NO_CONSPIRACIES;
  if (state.finished) return NO_CONSPIRACIES;
  // G13: an open response window freezes the table. `reduce` checks this BEFORE the
  // per-player freeze and before the turn check, and exempts three action types rather
  // than any seat or phase — so `PLAY_CONSPIRACY` is refused here for the actor as
  // well as for every other seat. Answering is not this action: it is
  // `RESPOND_INTERRUPT`, which the reducer exempts outright, so emptying this list
  // removes the dead PLAY button without touching the two moves the window exists for.
  if (state.interrupt !== null) return NO_CONSPIRACIES;
  if (state.choices.some((c) => c.player === viewer)) return NO_CONSPIRACIES;
  if (viewer !== state.activePlayer && state.phase !== 'answer') return NO_CONSPIRACIES;
  if (state.phase !== 'actions' && state.phase !== 'answer') return NO_CONSPIRACIES;

  const out: PlayableConspiracy[] = [];
  for (const id of self.conspiracies) {
    const card = cards.conspiracy[id];
    // A held id the index cannot read is not offered: `reduce` answers
    // 'unknown conspiracy card' for it, so listing it would be a dead button.
    if (card === undefined) continue;
    out.push({ id: card.id, name: card.name, text: card.text });
  }
  return out;
}

/**
 * The one place a card's *content* is ever written to a socket.
 *
 * Returns `null` for anyone who is not the player currently holding the card,
 * which is every other player and every spectator. The type admits no `Delta`, no
 * `Ideologue`, no `CardID` and no number. Those other players and that spectator
 * are told the same words by `openQuestionFor` instead — see the ruling on
 * `PublicQuestion` — and the difference between the two payloads is exactly the
 * `order` coin flip and the fact that only one of them comes with a commit control.
 */
export function blindPromptFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID,
): BlindPrompt | null {
  if (viewer !== state.activePlayer) return null;
  const prompt = pendingPromptFor(state, cards);
  if (prompt === null) return null;
  return { question: prompt.question, labels: prompt.labels, order: prompt.order };
}

/**
 * The pending card's words and its presentation order, computed ONCE.
 *
 * Both public projections read this, and that is the whole reason it exists: the
 * table's copy of the question and the answerer's copy are the same card seen from
 * the same two positions, so a second transcription of the label order would be a
 * place where the table and the answerer could silently disagree about which face
 * is on the left — and the answerer's click would then buy the other side's
 * payout. One computation, two narrow projections over it.
 */
function pendingPromptFor(state: GameState, cards: CardIndex): PendingPrompt | null {
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

/** What both projections publish. `order` is the answerer's alone; see above. */
type PendingPrompt = {
  readonly question: string;
  readonly labels: readonly [string, string];
  readonly order: AnswerOrder;
};

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
