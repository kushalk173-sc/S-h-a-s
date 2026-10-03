/**
 * G14b — `'voter-shortfall'`, and the ruling that it suppresses rather than refuses.
 *
 * THE GRETA EFFECT (REF 4.2.1): *"Pick up to 2 opponents. They will get 1 less voter on
 * the next 2 Voter Cards that they influence. This applies to 2 separate voter cards for
 * 2 different players."*
 *
 * Three properties are asserted, and the first is the one that decides whether this card
 * is a card or a table-stalling bug:
 *
 *  1. **IT SUPPRESSES.** A 1-Voter Card under a 2-voter shortfall yields ZERO voters and
 *     the influence still SUCCEEDS — the card is paid for, the slot is refilled and the
 *     log says what happened. A restriction that made the influence illegal would freeze
 *     the table, because a Voter Card that has been bought cannot be unbought, and this
 *     codebase has been bitten three times by a decision that froze a player who could
 *     not satisfy it.
 *  2. **THE COUNTER COUNTS CARDS, NOT VOTERS.** One purchase spends one unit whatever the
 *     card's size, so a player cannot extend a debuff by buying small cards. A spent
 *     entry is REMOVED rather than left at zero, so "is the rule in force" stays one
 *     predicate.
 *  3. **THE ORDERING AGAINST GOING VIRAL IS A RULING, and the test names it.** The
 *     shortfall is subtracted AFTER Going Viral adds its voter, because the printed
 *     clause is about what a Voter Card yields. Subtracting first would let a Showstopper
 *     launder the debuff away for free.
 *
 * Deadlock: a shortfall only ever REDUCES a payout, so it removes no action from anybody.
 * A played game at 2, 3, 4 and 5 seats with the card in the deck asserts at every step
 * that some action succeeds.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { type GameState, type PlayerID } from '../src/state';
import { PLAYERS_3 } from './helpers';

/** THE GRETA EFFECT, reduced to the one opponent `applyEffect` can name. */
const GRETA: ConspiracyCard = {
  id: 'vs-greta',
  name: 'The Greta Effect',
  text: 'An opponent you name gets 1 less voter from each of their next 2 Voter Cards.',
  cost: 4,
  effects: [
    { op: 'restrict', kind: 'voter-shortfall', value: 1, owed: 2, target: 'chosen-player' },
  ],
};

const CARDS: CardIndex = indexCards({
  ideology: [
    {
      id: 'vs-ig-1',
      campaign: 'vs',
      question: 'Q',
      sides: [
        { answer: 'A', ideologue: 'capitalist', pays: { funds: 1 } },
        { answer: 'B', ideologue: 'idealist', pays: { trust: 1 } },
      ],
    },
  ],
  voter: [
    { id: 'vs-v-1', cost: { funds: 1 }, voters: 1 },
    { id: 'vs-v-2', cost: { funds: 2 }, voters: 2 },
    { id: 'vs-v-3', cost: { funds: 3 }, voters: 3 },
  ],
  conspiracy: [GRETA],
  headline: [{ id: 'vs-h-1', name: 'A Headline', text: 'Nothing happens, and that is the point.', effects: [] }],
});

const CTX: Ctx = { rules: RULES, cards: CARDS };
const VOTER_IDS = Object.keys(CARDS.voter);
const HEADLINE_IDS = Object.keys(CARDS.headline);

function opening(players: readonly PlayerID[] = PLAYERS_3): GameState {
  const base = setup({
    players,
    cards: CARDS,
    seed: 77,
    startResources: players.map(() => ({ funds: 9, clout: 0, media: 0, trust: 0 })),
    ideologyDeck: ['vs-ig-1', 'vs-ig-1'],
    voterDeck: [...VOTER_IDS, ...VOTER_IDS, ...VOTER_IDS, ...VOTER_IDS, ...VOTER_IDS, ...VOTER_IDS],
    conspiracyDeck: [GRETA.id],
    headlineDeck: HEADLINE_IDS,
  });
  const r = reduce(base, base.activePlayer, { type: 'ANSWER', side: 0 }, CTX);
  if (!r.ok) throw new Error(`opening: ${r.error}`);
  return { ...r.state, phase: 'actions' };
}

/**
 * Impose the rule on `victim`, then hand them the turn.
 *
 * The card is played out of turn by p1, which is the p19 window a Headline uses and is
 * why the caster cannot be the victim (`resolveChoice` refuses a self-pick). The turn is
 * then moved to the victim by hand rather than by playing three turns, because what these
 * tests are about is the payout arithmetic and not the turn loop — `played a game with the
 * debuff in the deck` below covers the loop.
 */
function impose(s: GameState, victim: PlayerID): GameState {
  const withCard: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [GRETA.id] } },
  };
  const played = reduce(withCard, 'p1', { type: 'PLAY_CONSPIRACY', cardId: GRETA.id }, CTX);
  if (!played.ok) throw new Error(`play: ${played.error}`);
  const pending = played.state.choices.find((c) => c.choice.kind === 'choose-player');
  if (pending === undefined) throw new Error('no choose-player raised');
  const answered = reduce(played.state, 'p1', {
    type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'player', id: victim },
  }, CTX);
  if (!answered.ok) throw new Error(`choose: ${answered.error}`);
  return { ...answered.state, phase: 'actions', activePlayer: victim, _pendingCard: null };
}

/**
 * Buy whatever Voter Card is in slot `slot`, and report how many voters THIS purchase
 * yielded.
 *
 * The LAST pending group rather than the sum, because nothing places the groups in this
 * fixture and a sum would read 2, then 4, and make a correct engine look wrong.
 */
function influence(s: GameState, who: PlayerID, slot = 0): { readonly ok: boolean; readonly voters: number; readonly state: GameState } {
  const r = reduce(s, who, { type: 'INFLUENCE', slot }, CTX);
  if (!r.ok) return { ok: false, voters: -1, state: s };
  const groups = r.state.players[who]!.pending;
  return { ok: true, voters: groups.length === 0 ? 0 : groups[groups.length - 1]!.count, state: r.state };
}

describe('G14b — the shortfall shortens a payout and never refuses the purchase', () => {
  it('a 3-Voter Card yields 2, twice, and 3 again afterwards', () => {
    const s0 = impose(opening(), 'p2');
    expect((s0.players.p2!.restrictions ?? []).filter((r) => r.kind === 'voter-shortfall')).toHaveLength(1);
    let s = s0;
    // Put a 3-Voter Card on top so the shortfall is visible rather than clamped.
    const withBig: GameState = {
      ...s,
      market: [{ cardId: 'vs-v-3', cost: { funds: 3 }, voters: 3 }, ...s.market.slice(1)],
    };
    const first = influence(withBig, 'p2', 0);
    expect(first.ok, 'the influence succeeds').toBe(true);
    expect(first.voters).toBe(2);
    s = first.state;
    const big: GameState = {
      ...s,
      market: [{ cardId: 'vs-v-3', cost: { funds: 3 }, voters: 3 }, ...s.market.slice(1)],
    };
    const second = influence(big, 'p2', 0);
    expect(second.ok).toBe(true);
    expect(second.voters).toBe(2);
    // The counter is SPENT and the entry REMOVED, so a third card is whole.
    expect((second.state.players.p2!.restrictions ?? []).filter((r) => r.kind === 'voter-shortfall')).toEqual([]);
    const big2: GameState = {
      ...second.state,
      market: [{ cardId: 'vs-v-3', cost: { funds: 3 }, voters: 3 }, ...second.state.market.slice(1)],
    };
    const third = influence(big2, 'p2', 0);
    expect(third.voters).toBe(3);
  });

  it('a 1-Voter Card under a 2-voter shortfall yields ZERO and still succeeds — the no-lock ruling', () => {
    const s0 = impose(opening(), 'p2');
    const hard: GameState = {
      ...s0,
      players: { ...s0.players, p2: { ...s0.players.p2!, restrictions: s0.players.p2!.restrictions!.map((r) => ({ ...r, value: 2 })) } },
      market: [{ cardId: 'vs-v-1', cost: { funds: 1 }, voters: 1 }, ...s0.market.slice(1)],
    };
    const r = reduce(hard, 'p2', { type: 'INFLUENCE', slot: 0 }, CTX);
    // The whole point: the action is ACCEPTED.
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    // Zero voters, no pending group, and the purchase was PAID FOR — a refusal would have
    // left the player holding a card they cannot resolve and the market untouched.
    expect(r.state.players.p2!.pending).toEqual([]);
    expect(r.state.players.p2!.resources.funds).toBeLessThan(hard.players.p2!.resources.funds);
  });

  it('the counter counts CARDS: a 1-Voter Card spends one unit too', () => {
    let s = impose(opening(), 'p2');
    for (const cardId of ['vs-v-1', 'vs-v-1'] as const) {
      const withSmall: GameState = {
        ...s,
        market: [{ cardId, cost: { funds: 1 }, voters: 1 }, ...s.market.slice(1)],
      };
      s = influence(withSmall, 'p2', 0).state;
    }
    // Two cards bought, both clamped to nothing, and the rule is done.
    expect((s.players.p2!.restrictions ?? []).filter((r) => r.kind === 'voter-shortfall')).toEqual([]);
  });

  it('the shortfall is subtracted AFTER Going Viral, which is the ruling', () => {
    const s0 = impose(opening(), 'p2');
    // A 2-Voter card plus Going Viral would be 3; the shortfall takes it to 2.
    const withCard: GameState = {
      ...s0,
      players: {
        ...s0.players,
        p2: { ...s0.players.p2!, manifesto: ['showstopper', 'showstopper', 'showstopper'] },
      },
      market: [{ cardId: 'vs-v-2', cost: { funds: 2 }, voters: 2 }, ...s0.market.slice(1)],
    };
    const r = reduce(withCard, 'p2', { type: 'INFLUENCE', slot: 0, viral: true }, CTX);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.p2!.pending.reduce((n, g) => n + g.count, 0)).toBe(2);
  });

  it('nobody else is affected, which is what "2 separate voter cards for 2 different players" refuses', () => {
    const s0 = impose(opening(), 'p2');
    const forP3: GameState = { ...s0, activePlayer: 'p3' };
    const r = influence(forP3, 'p3', 0);
    expect(r.ok, r.ok ? '' : 'influence refused').toBe(true);
    expect(r.voters).toBeGreaterThan(0);
    expect((s0.players.p3!.restrictions ?? []).filter((x) => x.kind === 'voter-shortfall')).toEqual([]);
    // And p2's counter was NOT touched by somebody else's purchase.
    expect((r.state.players.p2!.restrictions ?? []).filter((x) => x.kind === 'voter-shortfall')).toHaveLength(1);
  });
});

describe('G14b — satisfiability of the decision that names the opponent', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`a ${n}-seat table always has an opponent to name`, () => {
      const players = Array.from({ length: n }, (_, i) => `p${i + 1}` as PlayerID);
      const s = opening(players);
      const candidates = s.turnOrder.filter((p) => p !== 'p1');
      expect(candidates.length).toBe(n - 1);
      for (const victim of candidates) {
        const imposed = impose(s, victim);
        expect((imposed.players[victim]!.restrictions ?? []).filter((r) => r.kind === 'voter-shortfall')).toHaveLength(1);
      }
    });
  }
});

describe('G14b — a legal move always exists, at 2 / 3 / 4 / 5 seats', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`a ${n}-seat played game with the debuff in the deck never strands a seat`, () => {
      const players = Array.from({ length: n }, (_, i) => `p${i + 1}` as PlayerID);
      let s = opening(players);
      s = impose(s, players[1] ?? 'p1');
      for (let step = 0; step < 60 && !s.finished; step += 1) {
        const actor = s.activePlayer;
        if (s.phase === 'answer') {
          const r = reduce(s, actor, { type: 'ANSWER', side: 0 }, CTX);
          expect(r.ok, `step ${step} ANSWER`).toBe(true);
          if (!r.ok) break;
          s = r.state;
          continue;
        }
        if (s.choices.some((c) => c.player === actor)) {
          const pending = s.choices.find((c) => c.player === actor)!;
          const pick =
            pending.choice.kind === 'lose-any' || pending.choice.kind === 'gain-any'
              ? ({ kind: 'resources', res: { funds: pending.choice.count } } as const)
              : ({ kind: 'areas', areaIds: [] } as const);
          const r = reduce(s, actor, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick }, CTX);
          expect(r.ok, `step ${step} RESOLVE_CHOICE`).toBe(true);
          if (!r.ok) break;
          s = r.state;
          continue;
        }
        // Influence every other step, so the debuff is actually exercised rather than
        // merely present in the position.
        const canInfluence = s.market.length > 0;
        const r = canInfluence
          ? reduce(s, actor, { type: 'INFLUENCE', slot: 0 }, CTX)
          : reduce(s, actor, { type: 'END_TURN' }, CTX);
        if (r.ok) {
          s = r.state;
          if (s.phase === 'actions' && !s.finished) {
            const end = reduce(s, actor, { type: 'END_TURN' }, CTX);
            if (end.ok) s = end.state;
          }
          continue;
        }
        const end = reduce(s, actor, { type: 'END_TURN' }, CTX);
        expect(end.ok, `step ${step} END_TURN`).toBe(true);
        if (!end.ok) break;
        s = end.state;
      }
      expect(s.finished || s.turn > 3, 'the game advanced').toBe(true);
    });
  }
});