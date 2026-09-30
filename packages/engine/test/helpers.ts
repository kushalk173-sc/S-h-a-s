/**
 * Shared fixtures for the engine test suite.
 *
 * Two card sets live here, for two different jobs:
 *
 *  - `CARDS` / `makeCtx()` — a *small*, fully hand-specified set. 12 Ideology
 *    Cards so a 5-card Capitalist manifesto is reachable without reshuffling, and
 *    6 Voter Cards so `syncConspiracyTop` / market-refill behaviour is easy to
 *    read in a failure message. Unit tests use this.
 *
 *  - `bigCtx()` — a *generated* set with a deck large enough for a whole game.
 *    A full game runs one ANSWER per turn, and the board needs ~65 Voter Card
 *    influences before all nine majorities can form, so the Ideology deck must be
 *    far deeper than 12 or it exhausts. (Deck exhaustion mid-game is R10, a
 *    documented soft-lock that this suite deliberately does not exercise.)
 *
 * Every shuffle in the engine runs off a seed — test 80 asserts the source never
 * calls `Math.random` — so both sets are fully deterministic.
 */

import type { Action } from '../src/actions';
import {
  indexCards,
  type CardIndex,
  type ConspiracyCard,
  type HeadlineCard,
  type IdeologyCard,
  type VoterCard,
} from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import type { Delta, GameState, Ideologue, PlayerID, ZoneID } from '../src/state';

export const PLAYERS_3: readonly PlayerID[] = ['p1', 'p2', 'p3'];

const IDEOLOGUES: readonly Ideologue[] = ['capitalist', 'supremo', 'showstopper', 'idealist'];

function ideologyCard(i: number, width = 2): IdeologyCard {
  const a = IDEOLOGUES[i % 4] as Ideologue;
  const b = IDEOLOGUES[(i + 1) % 4] as Ideologue;
  const n = String(i + 1).padStart(width, '0');
  return {
    id: `ide-${n}`,
    campaign: `campaign ${n}`,
    question: `question ${n}`,
    sides: [
      { answer: `answer ${n}a`, ideologue: a, pays: { funds: 1 } },
      { answer: `answer ${n}b`, ideologue: b, pays: { trust: 1 } },
    ],
  };
}

/**
 * 12 Ideology Cards. Both answers on a card always belong to *different*
 * Ideologues — rules-reference.md:188-189.
 */
export const IDEOLOGY_CARDS: readonly IdeologyCard[] = Array.from({ length: 12 }, (_, i) =>
  ideologyCard(i),
);

export const VOTER_CARDS: readonly VoterCard[] = Array.from({ length: 6 }, (_, i) => ({
  id: `vot-${String(i + 1).padStart(2, '0')}`,
  cost: { funds: 2 },
  voters: 2,
}));

/** Costs vary so "any combination totalling the printed cost" is testable. */
export const CONSPIRACY_CARDS: readonly ConspiracyCard[] = [
  {
    id: 'con-01',
    name: 'Redacted Files',
    text: 'Gain 2 resources.',
    cost: 4,
    effects: [{ op: 'gain', res: { funds: 2 } }],
  },
  {
    id: 'con-02',
    name: 'Whistleblower',
    text: 'Gain 3 resources.',
    cost: 5,
    effects: [{ op: 'gain', res: { clout: 3 } }],
  },
  {
    id: 'con-03',
    name: 'Smoke Screen',
    text: 'Gain 3 voters.',
    cost: 4,
    effects: [{ op: 'voters', n: 3 }],
  },
  {
    id: 'con-04',
    name: 'Petty Theft',
    text: 'Take 2 resources from an opponent.',
    cost: 4,
    effects: [{ op: 'steal-any', n: 2 }],
  },
];

export const HEADLINE_CARDS: readonly HeadlineCard[] = [
  {
    id: 'hed-01',
    name: 'Scandal',
    text: 'Each opponent gains 1 resource.',
    effects: [{ op: 'gain', res: { media: 1 }, target: 'each-opponent' }],
  },
  {
    id: 'hed-02',
    name: 'Audit',
    text: 'The leader loses 1 resource.',
    effects: [{ op: 'lose', res: { funds: 1 }, target: 'leader' }],
  },
  {
    id: 'hed-03',
    name: 'Raid',
    text: 'Each opponent loses 1 resource.',
    effects: [{ op: 'lose', res: { trust: 1 }, target: 'each-opponent' }],
  },
  {
    id: 'hed-04',
    name: 'Groundbreaking',
    text: 'Gain 1 resource and 2 voters.',
    effects: [{ op: 'gain', res: { funds: 1 } }, { op: 'voters', n: 2 }],
  },
  {
    id: 'hed-05',
    name: 'Purge',
    text: 'Each opponent loses 1 resource and 1 voter.',
    effects: [
      { op: 'lose', res: { media: 1 }, target: 'each-opponent' },
      { op: 'voters', n: 1, target: 'each-opponent' },
    ],
  },
  {
    id: 'hed-06',
    name: 'Sympathy',
    text: 'Everyone gains 1 resource.',
    effects: [{ op: 'gain', res: { funds: 1 }, target: 'everyone' }],
  },
];

export const CARDS: CardIndex = indexCards({
  ideology: [...IDEOLOGY_CARDS],
  voter: [...VOTER_CARDS],
  conspiracy: [...CONSPIRACY_CARDS],
  headline: [...HEADLINE_CARDS],
});

/** The small set, for unit tests that want a readable deck. */
export function makeCtx(rules = RULES): Ctx {
  return { rules, cards: CARDS };
}

// ─────────────────────── the full-game set ───────────────────────

// A whole game runs one ANSWER per turn. Depending on the seat count and how the
// board fills, that can exceed 400 turns, and the Ideology deck must never run
// dry mid-game — that is R10, a documented soft-lock this suite does not exercise.
const BIG_IDEOLOGY = 4000;
const BIG_VOTER = 600;
const BIG_CONSPIRACY = 40;
const BIG_HEADLINE = 200;

let bigIndex: CardIndex | null = null;

/**
 * A deck deep enough for a whole game. Costs rise every 4th Voter Card so the
 * driver has to earn resources over time rather than buying on turn 1.
 */
export function bigCards(): CardIndex {
  if (bigIndex) return bigIndex;
  const ideology = Array.from({ length: BIG_IDEOLOGY }, (_, i) => ideologyCard(i, 4));
  const voter: VoterCard[] = Array.from({ length: BIG_VOTER }, (_, i) => ({
    id: `bvot-${String(i + 1).padStart(3, '0')}`,
    // p10: "Voter Cards can contain 1, 2 or 3 voters." The mix matters — a
    // one-voter card is the only way to fill a zone that has exactly one slot
    // left, which the endgame needs.
    cost: { funds: 2 + (i % 4) },
    voters: 1 + (i % 3),
  }));
  const conspiracy: ConspiracyCard[] = Array.from({ length: BIG_CONSPIRACY }, (_, i) => ({
    id: `bcon-${String(i + 1).padStart(3, '0')}`,
    name: `Conspiracy ${i + 1}`,
    text: 'Gain 2 resources.',
    cost: 4 + (i % 2),
    effects: [{ op: 'gain', res: { funds: 2 } } as const],
  }));
  const headline: HeadlineCard[] = Array.from({ length: BIG_HEADLINE }, (_, i) => ({
    id: `bhed-${String(i + 1).padStart(3, '0')}`,
    name: `Headline ${i + 1}`,
    text: 'Everyone gains 1 resource.',
    effects: [{ op: 'gain', res: { funds: 1 }, target: 'everyone' as const }],
  }));
  bigIndex = indexCards({ ideology, voter, conspiracy, headline });
  return bigIndex;
}

const BIG_IDEOLOGY_DECK: readonly string[] = Object.keys(bigCards().ideology);
const BIG_VOTER_DECK: readonly string[] = Object.keys(bigCards().voter);
const BIG_CONSPIRACY_DECK: readonly string[] = Object.keys(bigCards().conspiracy);
const BIG_HEADLINE_DECK: readonly string[] = Object.keys(bigCards().headline);

export function bigCtx(): Ctx {
  return { rules: RULES, cards: bigCards() };
}

export { BIG_IDEOLOGY_DECK, BIG_VOTER_DECK, BIG_CONSPIRACY_DECK, BIG_HEADLINE_DECK };

export const IDEOLOGY_DECK: readonly string[] = IDEOLOGY_CARDS.map((c) => c.id);
export const VOTER_DECK: readonly string[] = VOTER_CARDS.map((c) => c.id);
export const CONSPIRACY_DECK: readonly string[] = CONSPIRACY_CARDS.map((c) => c.id);
export const HEADLINE_DECK: readonly string[] = HEADLINE_CARDS.map((c) => c.id);

export function fresh(
  seed = 1,
  players: readonly PlayerID[] = PLAYERS_3,
  opts: { readonly startResources?: readonly Readonly<Record<PlayerID, Delta>>[] } = {},
): GameState {
  return setup({
    players,
    cards: CARDS,
    seed,
    ideologyDeck: IDEOLOGY_DECK,
    voterDeck: VOTER_DECK,
    conspiracyDeck: CONSPIRACY_DECK,
    headlineDeck: HEADLINE_DECK,
    ...(opts.startResources ? { startResources: opts.startResources } : {}),
  });
}

/** A full-game starting position: big decks, so nothing exhausts mid-game. */
export function freshFull(
  seed = 1,
  players: readonly PlayerID[] = PLAYERS_3,
  startResources?: readonly Readonly<Record<PlayerID, Delta>>[],
): GameState {
  return setup({
    players,
    cards: bigCards(),
    seed,
    ideologyDeck: BIG_IDEOLOGY_DECK,
    voterDeck: BIG_VOTER_DECK,
    conspiracyDeck: BIG_CONSPIRACY_DECK,
    headlineDeck: BIG_HEADLINE_DECK,
    ...(startResources ? { startResources } : {}),
  });
}

export type Step = { readonly p: PlayerID; readonly a: Action };

/** Apply a script, asserting every action succeeds. */
export function play(s: GameState, script: readonly Step[], ctx: Ctx = makeCtx()): GameState {
  for (const { p, a } of script) {
    const r = reduce(s, p, a, ctx);
    if (!r.ok) throw new Error(`script broke: ${p} ${JSON.stringify(a)} -> ${r.error}`);
    s = r.state;
  }
  return s;
}

/** A seat list for n players. */
export function seats(n: number): PlayerID[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

export function areasIn(state: GameState, zone: ZoneID): readonly string[] {
  return state.zones.find((z) => z.id === zone)?.areas.map((a) => a.id) ?? [];
}

/** The first n still-empty area ids in a zone. */
export function emptyIn(state: GameState, zone: ZoneID, n: number): string[] {
  const z = state.zones.find((x) => x.id === zone);
  if (!z) return [];
  return z.areas.filter((a) => a.peg === null).map((a) => a.id).slice(0, n);
}

/** Every area id in a zone, empty or not. */
export function allIn(state: GameState, zone: ZoneID): string[] {
  return [...areasIn(state, zone)];
}
