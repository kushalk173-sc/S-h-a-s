import { freshZones } from './board';
import type { CardIndex } from './cards';
import { PLAYER_COLOURS, RULES, type Rules } from './rules';
import { shuffle } from './rng';
import {
  EMPTY_POOL,
  NO_POWER_USES,
  type CardID,
  type Delta,
  type GameState,
  type PlayerID,
  type PlayerState,
  type Pool,
} from './state';

export type SetupOptions = {
  /** Seat order. Also the clockwise turn order and the colour order. */
  readonly players: readonly PlayerID[];
  readonly names?: Readonly<Record<PlayerID, string>>;
  readonly rules?: Rules;
  /**
   * Card data. Required, because `market` and `conspiracyTopCost` are copies of
   * printed card numbers and the engine has no module-level singleton to reach
   * into. The same index is handed to `reduce` as `Ctx.cards`.
   */
  readonly cards: CardIndex;
  /** Deck inputs, in order. Omit to start that deck empty. */
  readonly ideologyDeck?: readonly CardID[];
  readonly voterDeck?: readonly CardID[];
  readonly conspiracyDeck?: readonly CardID[];
  readonly headlineDeck?: readonly CardID[];
  /** Mandatory entropy. 32-bit int. Same seed + same inputs = same game. */
  readonly seed: number;
  /**
   * Player n starts with n resources of their choice (p7 / rules-reference.md:111-112).
   *
   * Positional, parallel to `players`: `startResources[i]` is seat `i`'s opening
   * pool. THE CONTRACT, ruled 2026-10-01 after a real 5-player browser playtest
   * found every seat sitting on 0/0/0/0:
   *
   *  - **Omitted entirely** -> the rulebook rule applies. Seat `i` receives
   *    `i + 1` Campaign Funds, because `RULES.staggeredStart` is `true` and a
   *    declared-but-unapplied rule is worse than no rule: it makes every seat
   *    empty-handed, which is not a neutral default but an undeclared rule of its
   *    own ("nobody starts with anything"). It is also what manufactures the
   *    empty-handed players that hit a client's dead `gain-any` dialog.
   *  - **Supplied** -> the caller's array is authoritative, verbatim, for every
   *    seat. A seat with no entry in a supplied array starts empty.
   *
   * Why the default is Funds and not a spread: p7 makes the split the PLAYER's
   * choice, and a digital table cannot ask. Funds is the deterministic stand-in
   * because the Mat is priced in it (p11: "Campaign Funds - business-friendly
   * policy, market demand"; the shipped Voter Cards are 12/18 funds-bearing), so
   * the grant actually buys something on turn 1 rather than sitting under the cap.
   * A caller that cares asks its players and passes the result.
   *
   * The engine does NOT validate that a supplied total equals `i + 1`. The
   * `Delta` IS the player's choice, and the engine has no way to tell a deliberate
   * 8 Funds from a mistake — while the replay path (`store.ts` rebuilding a match
   * from its log) cannot ask anybody at all, so a validating `setup` would make
   * every recorded match un-replayable. `RULES.staggeredStart` is the default,
   * not an invariant.
   */
  readonly startResources?: readonly Delta[];
  /** Populate the HQ Mat with face-up Voter Cards. Default true. p10. */
  readonly dealMarket?: boolean;
};

/**
 * Build a legal, playable opening position.
 *
 * Two things this must get right, both of which a type checker cannot see:
 *  1. The first player's Ideology Card is already drawn and held face down. The
 *     reducer draws at turn *advance*, so an opening state without a pending card
 *     is a soft-lock: ANSWER says "no card has been put to you" and END_TURN says
 *     "answer your Ideology Card first", and no legal move exists.
 *  2. The HQ Mat is dealt. p10: "three open Voter Cards must always be available",
 *     and `refillMarket` is not reachable before the first INFLUENCE.
 */
export function setup(opts: SetupOptions): GameState {
  const rules = opts.rules ?? RULES;

  // rules-reference.md:26-40 supports 2..5 seats. The 9-zone board is the
  // 3-5 player board; the 2-player board (rules-reference.md:338-348) is a
  // separate layout and is not implemented, so 2 players here is a supported but
  // approximate configuration.
  if (opts.players.length < 2) throw new Error('Shasn needs at least 2 players');
  if (opts.players.length > 5) throw new Error('Shasn supports at most 5 players');
  const ids = [...opts.players];
  if (new Set(ids).size !== ids.length) throw new Error('Shasn seats must be distinct');
  const first = ids[0];
  if (first === undefined) throw new Error('Shasn needs at least 2 players');

  // freshZones() rebuilds every Zone/Area from the generated spec on each call,
  // so no two games can ever share mutable peg data.
  const zones = freshZones();

  // Seeded shuffle of every deck, threading the seed forward. Never Math.random
  // (rng.ts). The chain is a fold rather than a destructuring tuple so the seed
  // is threaded explicitly and each pile is read off the right line.
  let seed = opts.seed | 0;
  const ideShuffled = shuffle(opts.ideologyDeck ?? [], seed);
  seed = ideShuffled[1];
  const votShuffled = shuffle(opts.voterDeck ?? [], seed);
  seed = votShuffled[1];
  const conShuffled = shuffle(opts.conspiracyDeck ?? [], seed);
  seed = conShuffled[1];
  const hedShuffled = shuffle(opts.headlineDeck ?? [], seed);
  seed = hedShuffled[1];
  const ideologyDraw: readonly CardID[] = ideShuffled[0];
  const voterDraw: readonly CardID[] = votShuffled[0];
  const conspiracyDraw: readonly CardID[] = conShuffled[0];
  const headlineDraw: readonly CardID[] = hedShuffled[0];
  const ideologyDiscard: readonly CardID[] = [];
  const voterDiscard: readonly CardID[] = [];
  const conspiracyDiscard: readonly CardID[] = [];
  const headlineDiscard: readonly CardID[] = [];

  // p7: "Player n receives n resources of their choice." Omitting `startResources`
  // no longer means "nobody starts with anything" — it means "nobody chose", so
  // the rulebook quantity applies. See the `startResources` docstring for the full
  // contract, including why the total is not validated.
  const stagger = opts.startResources;
  const players: Record<PlayerID, PlayerState> = {};
  ids.forEach((id, i) => {
    const start: Delta = stagger
      ? (stagger[i] ?? {})
      : rules.staggeredStart
        ? { funds: i + 1 }
        : {};
    const resources: Pool = {
      funds: start.funds ?? 0,
      clout: start.clout ?? 0,
      media: start.media ?? 0,
      trust: start.trust ?? 0,
    };
    const colour = PLAYER_COLOURS[i];
    players[id] = {
      id,
      name: opts.names?.[id] ?? `Player ${i + 1}`,
      colour: colour ?? '#888888',
      resources,
      manifesto: [],
      manifestoCards: [],
      conspiracies: [],
      // G20: nobody is holding an Ideology Card on turn 1 — a card only enters a hand
      // when a card effect moves one there. HIDDEN, and stripped for every viewer
      // including the holder: see the long ruling on `PlayerState.ideologyCards` in
      // state.ts, which is the deliverable for this field, and the note there about
      // the `LEAK_PATHS` entry this owes the server's secret inventory.
      ideologyCards: [],
      pending: [],
      powerUses: NO_POWER_USES,
      // Nobody is restricted on turn 1. PUBLIC: see `Restriction` in state.ts, which
      // also names the server secret-inventory entry this owes.
      restrictions: [],
      isBot: false,
    };
  });

  // The opening Ideology Card is dealt to the first player immediately.
  const pendingCard = ideologyDraw[0] ?? null;
  const draw = pendingCard === null ? ideologyDraw : ideologyDraw.slice(1);

  // p10: three face-up Voter Cards on the HQ Mat.
  const marketSize = rules.marketSize;
  const openCards = (opts.dealMarket ?? true) ? voterDraw.slice(0, marketSize) : [];
  const market = openCards.map((cardId) => {
    const card = opts.cards.voter[cardId];
    return { cardId, cost: card?.cost ?? {}, voters: card?.voters ?? 0 };
  });
  const voterRest = voterDraw.slice(market.length);

  // The Conspiracy cost is printed on the card's back, so the number is public
  // even though the identity is not. state.ts:227-228.
  const conspiracyTop = conspiracyDraw[0];
  const conspiracyTopCost =
    conspiracyTop === undefined ? undefined : opts.cards.conspiracy[conspiracyTop]?.cost;

  return {
    zones,
    players,
    turnOrder: ids,
    activePlayer: first,
    phase: 'answer',
    turn: 1,
    round: 1,
    finished: false,

    market,
    conspiracyTopCost: conspiracyTopCost ?? null,
    conspiracyRemaining: conspiracyDraw.length,

    headlineQueue: [],
    activeHeadline: null,
    choices: [],
    // Nothing is in force on turn 1. PUBLIC, deliberately: see `LiveEffect` in
    // state.ts for the visibility argument, which is why this line is above the
    // server-only block rather than inside it.
    liveEffects: [],
    // G13: no card is being answered. PUBLIC for the same reason, and for the same
    // per-field argument, as `liveEffects` above — see `InterruptWindow` in state.ts.
    interrupt: null,
    finalRoundFrom: null,
    log: [],

    // ─────────── SERVER ONLY. The '_' prefix is load-bearing. ───────────
    _pendingCard: pendingCard,
    _ideologyDraw: draw,
    _ideologyDiscard: ideologyDiscard,
    _voterDraw: voterRest,
    _voterDiscard: voterDiscard,
    _conspiracyDraw: conspiracyDraw,
    _conspiracyDiscard: conspiracyDiscard,
    _headlineDraw: headlineDraw,
    _headlineDiscard: headlineDiscard,
    _seed: seed,
    _idSeq: 0,
  };
}
