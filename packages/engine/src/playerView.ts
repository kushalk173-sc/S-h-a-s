import type { GameState, PlayerID } from './state';

/**
 * The single most important function in this package.
 *
 * Shasn's core mechanic is that you answer a card you cannot see. If the client
 * ever receives the card's payout, a player opens devtools, reads the network
 * payload, and the game is over — permanently, for everyone, because there is
 * no way to un-know it.
 *
 * So: strip every `_`-prefixed key. `playerView.test.ts` asserts this
 * structurally rather than field-by-field, so new secret state added later is
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
 */
export type ClientState = Omit<GameState, ServerOnlyKeys> & {
  /** Counts only. Never contents. Never which deck is about to be reshuffled. */
  readonly deckSizes: {
    readonly ideology: number;
    readonly voter: number;
    readonly conspiracy: number;
    readonly headline: number;
  };
  /** True while the active player has a card put to them. No card data. */
  readonly awaitingAnswer: boolean;
};

/**
 * Per-player fields that are private but are NOT `_`-prefixed. R1.
 *
 * A Conspiracy Card is "bought and held" (rules-reference.md:284-286) — the
 * client learns that a card is *playable* from a public flag, never by reading
 * the hand. There is deliberately no viewer-scoped exception: see the note in
 * `playerView`.
 */
export const PRIVATE_PLAYER_KEYS = ['conspiracies'] as const;

export function playerView(state: GameState, _viewer: PlayerID): ClientState {
  const client: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith('_')) continue; // the eleven server-only fields, by convention
    if (key === 'players') {
      // Conspiracy hands are hidden from EVERYONE, including their owner. There
      // is no `(pid === viewer)` branch here on purpose: adding one is the R1
      // bug in a plausible-looking form. Write `clone[k] = []` and rethink.
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
