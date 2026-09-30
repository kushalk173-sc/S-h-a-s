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
   * Player n starts with n resources of their choice (rules-reference.md:92-93).
   * The *choice* is the player's, so this is supplied by the caller rather than
   * invented here. With `RULES.staggeredStart` on and no entry for a seat, that
   * seat starts empty — the engine does not guess a split.
   */
  readonly startResources?: readonly Readonly<Record<PlayerID, Delta>>[];
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

  const stagger = opts.startResources ?? [];
  const players: Record<PlayerID, PlayerState> = {};
  ids.forEach((id, i) => {
    const start: Delta = stagger[i] ?? {};
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
      pending: [],
      powerUses: NO_POWER_USES,
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
