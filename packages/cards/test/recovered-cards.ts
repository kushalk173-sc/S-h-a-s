/**
 * THE RECOVERED REAL CARDS, and whether `reduce()` can actually play them.
 *
 * ## Why this file exists
 *
 * `KNOWN-GAPS.md` counts recovered X-cards by whether they SHIP, and `executable.ts`
 * refuses any card the reducer does not perform. Neither number answers the question
 * that matters: **how many of the real cards can a table actually play?** A card can
 * pass the validator, ship, and still be a lie the moment it resolves — which is
 * exactly what happened to three shipped cards whose text said "discard 2 of your
 * own voters" over an op that could only reach an opponent's.
 *
 * So this file is the measurement, and it measures by PLAYING. Every entry carries:
 *
 *  - the **verbatim** text recovered in `docs/AUTHENTIC-SHASN-REFERENCE.md` Â§4, so a
 *    reader can check the claim against the source rather than against this file;
 *  - the **drops**: the clauses the engine cannot say, named one by one. An entry
 *    with drops is an ADAPTED card — playable, but smaller than the paper one, and
 *    `source` on a shipped card has to say so;
 *  - a **`check`** that asserts the state change the card promises, run against the
 *    real reducer rather than a reading of its source.
 *
 * A card is counted playable only if its `check` passes. That is the whole honesty
 * rule, and it is why an entry cannot be added to the count without an assertion that
 * fails when the engine stops doing what the card says.
 *
 * ## Why the cards are declared HERE and not in `decks/`
 *
 * The deck files are another author's and grow independently. This file is the
 * engine's own measurement of itself, so it declares the cards it can play and never
 * waits on a corpus edit. Promoting an entry into a deck file is a separate, later
 * step; nothing here depends on it.
 */

import { RULES, type ConspiracyCard, type HeadlineCard } from '../src/engine.js';

import type { Action } from '../../engine/src/actions';
import { reduce, type Ctx } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import {
  findArea,
  type AreaID,
  type GameState,
  type PendingChoice,
  type PlayerID,
} from '../../engine/src/state';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ the entry type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type RecoveredCard = {
  readonly name: string;
  /** Where in AUTHENTIC-SHASN-REFERENCE.md Â§4 this card's text is recovered. */
  readonly ref: string;
  readonly kind: 'conspiracy' | 'headline';
  /** The recovered rules text, quoted from REF. */
  readonly verbatim: string;
  /** Clauses the engine cannot say. Empty means the card is whole. */
  readonly drops: readonly string[];
  /** How the engine says it. */
  readonly card: ConspiracyCard | HeadlineCard;
  /**
   * Extra reducer actions needed before or after the card resolves, for a card whose
   * effect is about a purchase or a turn boundary. Omit for a card that resolves on
   * its own.
   */
  readonly drive?: (s: GameState, ctx: Ctx) => GameState;
  /**
   * Assert the promised state change.
   *
   * `raised` is the state the moment the card resolved, decisions still open; `after`
   * is the table with every decision answered. A card about who is ASKED asserts on
   * the first, a card about what the board then looks like on the second.
   */
  readonly check: (
    raised: GameState,
    before: GameState,
    ctx: Ctx,
    after: GameState,
  ) => void;
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ driving the reducer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function must(r: ReturnType<typeof reduce>): GameState {
  if (!r.ok) throw new Error(`reducer refused: ${r.error}`);
  return r.state;
}

/**
 * A legal pick for a pending decision, chosen the way a player would: shed from the
 * largest pile, steal from whoever holds the most, and take voters only where the
 * choice's scope allows them.
 *
 * This exists so a card can be *played* without a human answering it. It is not a
 * rules claim: where the choice's denomination changes what the card is worth, the
 * entry's `check` asserts the specific outcome instead of relying on this.
 */
export function pickFor(state: GameState, c: PendingChoice): Action {
  const me = c.player;
  const pool = state.players[me]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
  switch (c.choice.kind) {
    case 'gain-any':
      return { type: 'RESOLVE_CHOICE', choiceId: c.id, pick: { kind: 'resources', res: { funds: c.choice.count } } };
    case 'lose-any': {
      // Shed from the largest pile first, so the pick is always affordable.
      const res: Record<string, number> = {};
      let left = c.choice.count;
      for (const r of ['funds', 'clout', 'media', 'trust'] as const) {
        if (left <= 0) break;
        const take = Math.min(pool[r], left);
        if (take > 0) {
          res[r] = take;
          left -= take;
        }
      }
      if (left > 0) throw new Error(`cannot afford a lose-any of ${c.choice.count}`);
      return { type: 'RESOLVE_CHOICE', choiceId: c.id, pick: { kind: 'resources', res } };
    }
    case 'steal-any': {
      const victimId = c.choice.from ?? firstWithResources(state, me);
      if (victimId === null) throw new Error('nothing to steal');
      const n = Math.min(c.choice.count, total(state.players[victimId]?.resources));
      if (n <= 0) throw new Error('nothing to steal');
      const res: Record<string, number> = {};
      let left = n;
      for (const r of ['funds', 'clout', 'media', 'trust'] as const) {
        if (left <= 0) break;
        const take = Math.min(state.players[victimId]?.resources[r] ?? 0, left);
        if (take > 0) {
          res[r] = take;
          left -= take;
        }
      }
      return { type: 'RESOLVE_CHOICE', choiceId: c.id, pick: { kind: 'steal', from: victimId, res } };
    }
    case 'evict-voter':
    case 'discard-voter':
    case 'convert-voter': {
      const ids = targetAreas(state, me, c.choice.kind, c.choice.scope, c.choice.count);
      if (ids.length < c.choice.count) throw new Error(`only ${ids.length} legal targets for ${c.choice.kind}`);
      return { type: 'RESOLVE_CHOICE', choiceId: c.id, pick: { kind: 'areas', areaIds: ids.slice(0, c.choice.count) } };
    }
  }
}

function total(p: { funds: number; clout: number; media: number; trust: number } | undefined): number {
  return p ? p.funds + p.clout + p.media + p.trust : 0;
}

function firstWithResources(state: GameState, exclude: PlayerID): PlayerID | null {
  for (const id of state.turnOrder) {
    if (id === exclude) continue;
    if (total(state.players[id]?.resources) > 0) return id;
  }
  return null;
}

/** The areas a voter decision may name, in board order, honouring the card's scope. */
export function targetAreas(
  state: GameState,
  chooser: PlayerID,
  kind: string,
  scope: 'any' | 'others' | 'own',
  want: number,
): AreaID[] {
  const out: AreaID[] = [];
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (a.peg === null || a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== chooser) continue;
      if (scope === 'others' && a.peg.owner === chooser) continue;
      if (kind === 'convert-voter' && a.peg.owner === chooser) continue;
      out.push(a.id);
      if (out.length === want) return out;
    }
  }
  return out;
}

/** Resolve every open decision, whoever owns it, the way a table would. */
export function drainChoices(s: GameState, ctx: Ctx, guard = 20): GameState {
  let state = s;
  let n = 0;
  while (state.choices.length > 0) {
    if (n++ > guard) throw new Error('choices did not drain');
    const open = state.choices[0];
    if (!open) break;
    state = must(reduce(state, open.player, pickFor(state, open), ctx));
  }
  return state;
}

/** Answer, so the table is in the `actions` phase where a Conspiracy may be played. */
export function answer(s: GameState, who: PlayerID, ctx: Ctx): GameState {
  return must(reduce(s, who, { type: 'ANSWER', side: 0 }, ctx));
}

/** Play a Conspiracy Card from `who`'s hand, as PLAY_CONSPIRACY would. */
export function playConspiracy(s: GameState, who: PlayerID, card: ConspiracyCard, ctx: Ctx): GameState {
  const held: GameState = {
    ...s,
    players: {
      ...s.players,
      [who]: { ...s.players[who]!, conspiracies: [...s.players[who]!.conspiracies, card.id] },
    },
  };
  return must(reduce(held, who, { type: 'PLAY_CONSPIRACY', cardId: card.id }, ctx));
}

/**
 * Resolve a Headline the way the post-turn queue does, attributed to `who`.
 *
 * `queueDepth` of 2 keeps `ACK_HEADLINE` from draining into `advanceTurn`, which
 * resets the incoming player's `powerUses` and would hide what the card did. Use 1
 * when the turn boundary is the thing under test.
 */
export function resolveHeadline(
  s: GameState,
  who: PlayerID,
  card: HeadlineCard,
  ctx: Ctx,
  queueDepth = 1,
): GameState {
  const active: GameState = {
    ...s,
    phase: 'headlines',
    activeHeadline: card.id,
    headlineQueue: Array.from({ length: queueDepth }, () => ({ areaId: '', by: who })),
  };
  return must(reduce(active, who, { type: 'ACK_HEADLINE' }, ctx));
}

/** Put a peg on the board directly, so a card about board state has something to act on. */
export function withPeg(s: GameState, areaId: AreaID, owner: PlayerID): GameState {
  const area = findArea(s, areaId);
  if (!area) throw new Error(`no area ${areaId}`);
  return {
    ...s,
    zones: s.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a) => (a.id === areaId ? { ...a, peg: { owner, majority: false } } : a)),
    })),
  };
}

/**
 * One peg per seat, on the first legal (non-volatile, empty) areas.
 *
 * A card that acts on the board cannot be exercised on an empty one, and placing a
 * peg by hand is a fixture operation, not a rules claim: the assertions are about what
 * the CARD did to a board that already had voters on it.
 */
export function withPegsFor(s: GameState, owners: readonly PlayerID[]): GameState {
  const free = s.zones
    .flatMap((z) => z.areas)
    .filter((a) => a.peg === null && !a.volatile)
    .map((a) => a.id);
  let state = s;
  owners.forEach((owner, i) => {
    const areaId = free[i];
    if (areaId === undefined) throw new Error(`no free area for ${owner}`);
    state = withPeg(state, areaId, owner);
  });
  return state;
}

export function pegsOf(s: GameState, owner: PlayerID): number {
  return s.zones.flatMap((z) => z.areas).filter((a) => a.peg?.owner === owner).length;
}

export function totalOf(s: GameState, id: PlayerID): number {
  return total(s.players[id]?.resources);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ the fixture â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * The fixture's own Ideology Cards, so a measurement never moves when a deck does.
 *
 * `ANSWER` pays `side.pays` plus the p28 passive bonus, so a corpus-derived draw can
 * push the answering player over `RULES.resourceCap` and raise a cap discard that
 * then sits in front of the decision under test. A declared payout small enough that
 * a player starting at 6 cannot reach the cap removes that whole class of flake.
 */
export const FIXTURE_IDEOLOGY = [
  {
    id: 'ig-recovered-a',
    campaign: 'recovered',
    question: 'Does the ceiling move, or does the room?',
    sides: [
      { answer: 'It moves.', ideologue: 'capitalist' as const, pays: { funds: 2 } },
      { answer: 'The room.', ideologue: 'idealist' as const, pays: { trust: 2 } },
    ],
  },
  {
    id: 'ig-recovered-b',
    campaign: 'recovered',
    question: 'And the floor?',
    sides: [
      { answer: 'It stays.', ideologue: 'supremo' as const, pays: { clout: 2 } },
      { answer: 'It goes.', ideologue: 'showstopper' as const, pays: { media: 2 } },
    ],
  },
  {
    id: 'ig-recovered-c',
    campaign: 'recovered',
    question: 'Who signs for it?',
    sides: [
      { answer: 'Nobody signs.', ideologue: 'capitalist' as const, pays: { funds: 1 } },
      { answer: 'Somebody always does.', ideologue: 'idealist' as const, pays: { trust: 1 } },
    ],
  },
] as const;

/** Three Voter Cards of known price, so a purchase-driven card has a price to pay. */
export const FIXTURE_VOTERS = [
  { id: 'vo-recovered-1', cost: { funds: 1 }, voters: 1 },
  { id: 'vo-recovered-2', cost: { funds: 1 }, voters: 2 },
  { id: 'vo-recovered-3', cost: { funds: 1 }, voters: 3 },
  { id: 'vo-recovered-4', cost: { funds: 1 }, voters: 1 },
  { id: 'vo-recovered-5', cost: { funds: 1 }, voters: 2 },
] as const;

/** Conspiracy Cards in the draw pile. `draw-conspiracy` reads the top of this. */
export const FIXTURE_CONSPIRACIES = [
  { id: 'ct-recovered-1', name: 'Fill 1', text: 'A filler Conspiracy Card for the draw pile, priced at the printed minimum.', cost: 4, effects: [{ op: 'gain' as const, res: { funds: 1 } }] },
  { id: 'ct-recovered-2', name: 'Fill 2', text: 'A second filler Conspiracy Card for the draw pile, priced at the printed minimum.', cost: 4, effects: [{ op: 'gain' as const, res: { funds: 1 } }] },
  { id: 'ct-recovered-3', name: 'Fill 3', text: 'A third filler Conspiracy Card for the draw pile, priced at the printed minimum.', cost: 5, effects: [{ op: 'gain' as const, res: { funds: 1 } }] },
] as const;

export const FIXTURE_HEADLINE_PILE = [
  { id: 'hl-recovered-fill-1', name: 'Filler 1', text: 'A filler Headline Card for the draw pile, so the queue is never empty.', effects: [{ op: 'gain' as const, res: { funds: 1 } }] },
  { id: 'hl-recovered-fill-2', name: 'Filler 2', text: 'A second filler Headline Card for the draw pile, so the queue is never empty.', effects: [{ op: 'gain' as const, res: { funds: 1 } }] },
] as const;

export type Fixture = {
  readonly ctx: Ctx;
  readonly game: GameState;
};

/**
 * A three-seat position, answered, in the `actions` phase.
 *
 * `extra` cards are registered on the index, because `PLAY_CONSPIRACY` and
 * `ACK_HEADLINE` look the card up by id in `ctx.cards` — a card the reducer cannot
 * find is a card the reducer cannot play, and measuring the wrong thing.
 *
 * Every seat starts at `{funds: 4, clout: 2, media: 2, trust: 2}` — 10 against a cap
 * of 12, so answering (up to 2 more) cannot cross it, and a card can still hand out
 * resources. Anything the answer does raise is drained here, because a pending cap
 * discard sits in front of every later decision and would make an entry assert the
 * wrong thing.
 */
export function fixture(extra: readonly (ConspiracyCard | HeadlineCard)[] = []): Fixture {
  const conspiracy: Record<string, ConspiracyCard> = Object.fromEntries(
    FIXTURE_CONSPIRACIES.map((c) => [c.id, c]),
  );
  const headline: Record<string, HeadlineCard> = Object.fromEntries(
    FIXTURE_HEADLINE_PILE.map((c) => [c.id, c]),
  );
  for (const c of extra) {
    if ('cost' in c) conspiracy[c.id] = c;
    else headline[c.id] = c;
  }
  const index = {
    ideology: Object.fromEntries(FIXTURE_IDEOLOGY.map((c) => [c.id, c])),
    voter: Object.fromEntries(FIXTURE_VOTERS.map((c) => [c.id, c])),
    conspiracy,
    headline,
  };
  const ctx: Ctx = { rules: RULES, cards: index as Ctx['cards'] };
  const start = setup({
    players: ['p1', 'p2', 'p3'],
    cards: ctx.cards,
    seed: 19770213,
    startResources: [
      { funds: 4, clout: 2, media: 2, trust: 2 },
      { funds: 4, clout: 2, media: 2, trust: 2 },
      { funds: 4, clout: 2, media: 2, trust: 2 },
    ],
    ideologyDeck: FIXTURE_IDEOLOGY.map((c) => c.id),
    voterDeck: FIXTURE_VOTERS.map((c) => c.id),
    conspiracyDeck: FIXTURE_CONSPIRACIES.map((c) => c.id),
    headlineDeck: FIXTURE_HEADLINE_PILE.map((c) => c.id),
  });
  return { ctx, game: drainChoices(answer(start, 'p1', ctx), ctx) };
}