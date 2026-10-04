import type { GameState, PlayerID } from './state';

/**
 * The single most important function in this package.
 *
 * ── WHAT IT PROTECTS NOW, AFTER FULL INFORMATION ─────────────────────────────
 *
 * It used to protect the Ideology Card's payout: "if the client ever receives the card's
 * payout, a player opens devtools, reads the network payload, and the game is over —
 * permanently, for everyone, because there is no way to un-know it." **That is no longer a
 * threat, and pretending otherwise would be a lie in a comment.** The payout is published to
 * every seat, in `broadcast.ts`, by decision. See `packages/server/src/FULL-INFORMATION.md`
 * for the record of that decision and what it costs.
 *
 * What this function still protects, and protects exactly as before:
 *
 *  - **THE DECKS.** The four draw piles and the four discard piles. A client that learns
 *    the Ideology draw pile learns the order of every card still to come, and the Ideology
 *    draw order is seed-derived.
 *  - **THE SEED.** It is the PRNG cursor and it is the input to the seed-derived answer
 *    ORDER — which is now the only channel by which a display position could carry the
 *    deck's Ideologue balance (PLAN.md §2 amendment A′). Measured: position 0 holds the
 *    Capitalists' answer in 34 of the shipped 76 cards, so the order draw is not tidiness.
 *  - **THE PENDING CARD'S ID**, with the card's content public and its pointer not. The
 *    ruling is on `GameState._pendingCard` and, at length, in `FULL-INFORMATION.md` §2.
 *  - **`_idSeq`**, because a client holding a `choiceId` across a restart is holding a
 *    dead reference.
 *
 * So: strip every `_`-prefixed key, and the reasoning is now "the decks, the seed, and the
 * pointer to the card in front of you" rather than "the payout". `playerView.test.ts`
 * asserts this structurally rather than field-by-field, so new secret state added later is
 * covered automatically as long as it follows the underscore convention.
 *
 * The prefix convention is necessary but not sufficient. A field can be secret
 * and still be unprefixed — `PlayerState.conspiracies` is a hidden hand, and
 * shipping it turns a bluffing mechanic into a solved one (R1). Those fields are
 * listed in `PRIVATE_PLAYER_KEYS` below, and the leak test walks the whole graph
 * looking for them.
 */

/** Every `_` field on `GameState`. Keep in sync by way of the `Omit` below. */
export type ServerOnlyKeys =
  | '_pendingCard'
  | '_ideologyDraw'
  | '_ideologyDiscard'
  | '_voterDraw'
  | '_voterDiscard'
  | '_conspiracyDraw'
  | '_conspiracyDiscard'
  | '_headlineDraw'
  | '_headlineDiscard'
  | '_seed'
  | '_idSeq';

/**
 * What a client is allowed to see. Eleven `_` fields removed; two derived,
 * non-revealing fields added.
 *
 * ── UNCHANGED BY FULL INFORMATION, and the reasoning is on `GameState._pendingCard` ──
 *
 * The Ideology Card's CONTENT — question, both answers, both Ideologues, both payouts —
 * is now published to every seat by the server's `PublicQuestion`, in
 * `packages/server/src/broadcast.ts`. None of that is a `GameState` field: it is computed
 * there from the card index, because the engine does not hold the corpus.
 *
 * What is published is therefore NOT a reason to un-underscore anything here. In
 * particular `_pendingCard` keeps its underscore: the card is public, its ID is not, and the
 * thing keeping the ID off the wire is the name-based grep in
 * `packages/server/scripts/check-secrets.mjs`, which works by the field being `_`-prefixed.
 * The whole argument, and the measurements behind it, are in
 * `packages/server/src/FULL-INFORMATION.md` §2.
 */
export type ClientState = Omit<GameState, ServerOnlyKeys> & {
  /**
   * Counts only. Never which deck is about to be reshuffled.
   *
   * **AND THE CONTENTS OF A DISCARD PILE ARE NOT IN HERE**, which is worth saying
   * because it is a new thing to be true of: `PublicView.conspiracyRecycle` in
   * `packages/server/src/broadcast.ts` publishes the ordered contents of one of the
   * eight `_` piles this type omits, and it is NOT on `ClientState` — the same split
   * `playableConspiracies` and `openQuestion` already make, and for the same reason:
   * naming a card needs the server's `CardIndex`, which this package does not have. So
   * the ids reach the wire through the server projection beside this block, never
   * through here, and this docstring's "counts only" is still literally true of the
   * four numbers it describes.
   */
  readonly deckSizes: {
    readonly ideology: number;
    readonly voter: number;
    readonly conspiracy: number;
    readonly headline: number;
  };
  /**
   * True while the active player has a card put to them. No card data.
   *
   * Still the only thing this projection says about the answer window, and still worth
   * keeping: the whole card is on the table now, but whether a card is out at all is what
   * tells a client to render the question panel at all.
   */
  readonly awaitingAnswer: boolean;
};

/**
 * Per-player fields that are private but are NOT `_`-prefixed. R1.
 *
 * A Conspiracy Card is "bought and held" (rules-reference.md:284-286) — the
 * client learns that a card is *playable* from a public flag, never by reading the
 * hand. There is deliberately no viewer-scoped exception: see the note in
 * `playerView`.
 *
 * G20 adds `ideologyCards`, an Ideology Card handed to a player by a card. It is the
 * same class of field for a stronger reason: the counterpart of an unanswered card
 * is that its holder does not know what it is, and the answer to a card whose payout
 * is not shown is a coin flip the player makes. **The full ruling is on `PlayerState.ideologyCards` in
 * `state.ts`**, and the short form is that the rulebook draws the line at *answered*
 * — p13 keeps a card hidden "until the active player confirms their answer"
 * (rules-reference.md:239), and a donated card has not been answered, so it is on
 * the hidden side of the line along with `conspiracies` and not on the public side
 * along with `manifestoCards`.
 *
 * **THE SAME ENTRY IS OWED `packages/server/test/secret-inventory.ts`**
 * (`LEAK_PATHS`, beside `conspiracyHand`). That file is not this package's to change.
 * It does not make the strip above optional: the strip is what stops the leak, and
 * the server's entry is what keeps a future refactor from "simplifying" it away.
 *
 * ── WHAT FULL INFORMATION DID AND DID NOT DO TO THIS LIST ────────────────────
 *
 * The rulebook's line is at *answered*, not at *known*, and full information moved the
 * payout out of hiding without touching that line. A donated Ideology Card is just as
 * hidden as it was — its content is on no viewer's screen — while the card on the table is
 * entirely public. So **both entries stay**, for different reasons than they did before:
 * `conspiracies` because a hand is a hand whoever is looking, and `ideologyCards` because
 * p13 says "until the active player confirms their answer" and a donated card has not been
 * answered.
 *
 * The tempting move is to drop `ideologyCards` on the grounds that a card's content is public
 * now anyway — and it is the wrong move for a reason worth writing down. The content is
 * public for the card ON THE TABLE, published by `broadcast.ts` from the pending card only.
 * Nothing publishes a card in a hand, and a rule that reads "hidden cards are fine now
 * because *some* card is public" is precisely how the next hidden card ships.
 */
export const PRIVATE_PLAYER_KEYS = ['conspiracies', 'ideologyCards'] as const;

export function playerView(state: GameState, _viewer: PlayerID): ClientState {
  const client: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith('_')) continue; // the eleven server-only fields, by convention
    if (key === 'players') {
      // Conspiracy hands and held Ideology Cards are hidden from EVERYONE, including
      // their owner. There is no `(pid === viewer)` branch here on purpose: adding one
      // is the R1 bug in a plausible-looking form. Write `clone[k] = []` and rethink.
      const safe: Record<string, unknown> = {};
      const players = value as Record<string, Record<string, unknown>>;
      for (const [pid, p] of Object.entries(players)) {
        const clone = { ...p };
        for (const k of PRIVATE_PLAYER_KEYS) clone[k] = [];
        safe[pid] = clone;
      }
      client['players'] = safe;
      continue;
    }
    client[key] = value;
  }

  // Derived, non-revealing. Counts only, and a boolean that says nothing about
  // which card or what it pays.
  client['deckSizes'] = {
    ideology: state._ideologyDraw.length,
    voter: state._voterDraw.length,
    conspiracy: state._conspiracyDraw.length,
    headline: state._headlineDraw.length,
  };
  client['awaitingAnswer'] = state._pendingCard !== null;

  return client as unknown as ClientState;
}

/** Recursively collect every key in an object graph. Used by the leak test. */
export function allKeys(value: unknown, seen = new Set<object>()): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap((v) => allKeys(v, seen));
  return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v, seen)]);
}
