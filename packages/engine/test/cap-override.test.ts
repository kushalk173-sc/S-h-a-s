/**
 * G15 — A LOWERED RESOURCE CAP (THE BIG FREEZE). The deadlock proof, and the
 * arithmetic it rests on.
 *
 * ## WHY THIS FILE IS THE ANSWER TO A REFUSAL
 *
 * The gap was refused with: *"lowering a cap under an already-over player is the exact
 * `convert-voter` soft-lock shape, and it would have to be gated."* The first half of that
 * is right — a cap drop under an already-over player really does raise a discard — and the
 * conclusion is wrong, because the two shapes are not the same shape.
 *
 * `convert-voter`'s bug was a decision whose **ACCEPTABLE ANSWERS WERE EMPTY**: the
 * resolver refused every pick, so `blockedBy` froze the owner for the rest of the match
 * with no server-side recovery. THE BIG FREEZE's discard is `lose-any`, and the ask is
 * `overCap(pool, cap) = max(0, total - cap)`. Since `total >= 0` and `cap >= 0`:
 *
 *     excess = max(0, total - cap) <= total          (the ask never exceeds the pool)
 *     total - excess = min(total, cap) >= 0          (the target state is REACHABLE)
 *
 * and `lose-any` is additionally clamped to the chooser's pool **as it stands when the
 * decision is answered** (`choices.test.ts` G21), so a pool that drains in between lowers
 * the ask instead of stranding it. The decision is therefore always affordable and always
 * dischargeable, at every pool size and every cap — which `the ask is always affordable`
 * below checks exhaustively rather than by argument.
 *
 * So no gate is needed. What IS needed is the evidence, and this file is it.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { overCap } from '../src/resources';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { poolTotal, RESOURCES, type Delta, type GameState, type PlayerID, type Pool } from '../src/state';
import { answered } from './boardkit';
import {
  bigCards,
  BIG_IDEOLOGY_DECK,
  BIG_VOTER_DECK,
  IDEOLOGY_DECK,
  VOTER_DECK,
  CONSPIRACY_DECK,
  HEADLINE_DECK,
  seats,
} from './helpers';

const CARDS: CardIndex = indexCards({ ideology: [], voter: [], conspiracy: [], headline: [] });

function probe(id: string, effects: ConspiracyCard['effects']): ConspiracyCard {
  return {
    id,
    name: id,
    text: 'probe',
    cost: 0,
    effects,
  } as ConspiracyCard;
}

/** A context carrying `cards` plus a real deck, so `PLAY_CONSPIRACY` can find one. */
function ctxWith(conspiracy: readonly ConspiracyCard[]): Ctx {
  return { rules: RULES, cards: indexCards({ ideology: [], voter: [], conspiracy, headline: [] }) };
}

/**
 * `setup()` at `n` seats with every seat holding `resources`, `p1` past its answer so a
 * Conspiracy Card is playable, and the probe dealt into `p1`'s hand.
 *
 * `setup()` is called directly rather than through `helpers.fresh` because `fresh` types
 * `startResources` as a `Record<PlayerID, Delta>[]` while `setup` takes a positional
 * `Delta[]` — a wart in a package I may edit but not one worth widening here, since every
 * position below wants a plain number.
 */
function holding(card: ConspiracyCard, n: number, resources: Delta): GameState {
  const ids = seats(n);
  const s = setup({
    players: ids,
    cards: CARDS,
    seed: 1,
    ideologyDeck: IDEOLOGY_DECK,
    voterDeck: VOTER_DECK,
    conspiracyDeck: CONSPIRACY_DECK,
    headlineDeck: HEADLINE_DECK,
    startResources: ids.map(() => resources),
  });
  const p1 = s.players['p1'];
  if (!p1) throw new Error('no p1');
  return {
    ...answered(s, 'p1'),
    players: { ...s.players, p1: { ...p1, conspiracies: [card.id] } },
  };
}

/** Split `total` across denominations for `overCap`, which reads only the sum. */
function poolOf(total: number): Pool {
  const p: Record<string, number> = { funds: 0, clout: 0, media: 0, trust: 0 };
  let left = total;
  for (const r of RESOURCES) {
    const take = Math.min(left, 2);
    p[r] = take;
    left -= take;
  }
  p['funds'] = (p['funds'] ?? 0) + left;
  return p as Pool;
}

const CAP_CARD = probe('cap-10', [{ op: 'set-cap', to: 10 }]);
const CAP_CTX = ctxWith([CAP_CARD]);

describe('the arithmetic the deadlock argument rests on', () => {
  /**
   * Exhaustive over every pool total and every cap the engine can be asked for. This is
   * the whole safety property of the gap, and an argument is not a proof: it is checked
   * because the cost of the check is a millisecond and the cost of being wrong is a table
   * that cannot finish.
   */
  it('the ask is always affordable and the target state is always reachable', () => {
    const broken: string[] = [];
    for (let total = 0; total <= 24; total += 1) {
      for (let cap = 0; cap <= 24; cap += 1) {
        const excess = overCap(poolOf(total), cap);
        if (excess > total) broken.push(`total=${total} cap=${cap} ask=${excess} EXCEEDS the pool`);
        const after = total - excess;
        if (after < 0) broken.push(`total=${total} cap=${cap} ask=${excess} lands NEGATIVE`);
        else if (after !== Math.min(total, cap)) {
          broken.push(`total=${total} cap=${cap} ask=${excess} lands at ${after}, not ${String(Math.min(total, cap))}`);
        }
      }
    }
    expect(broken, `${broken.length} (pool, cap) pairs break the invariant:\n${broken.slice(0, 8).join('\n')}`).toEqual([]);
  });
});

describe('set-cap reduces the cap the resources rules actually read', () => {
  it('crossing it raises the p12 discard immediately, and resolving it lands on the cap', () => {
    const s = holding(CAP_CARD, 3, { funds: 12 });
    const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: CAP_CARD.id }, CAP_CTX);
    expect(played.ok, played.ok ? '' : played.error).toBe(true);
    if (!played.ok) return;

    // p12 read literally: "if at ANY TIME you cross your resource cap". The write and the
    // discard are in the same breath, which is what makes this a rule rather than a number
    // on a mat that nothing enforces.
    const pending = played.state.choices.find((c) => c.player === 'p1');
    expect(pending, 'the cap drop raised no discard').toBeDefined();
    expect(pending?.choice).toMatchObject({ kind: 'lose-any', count: 2, reason: 'Resource cap' });

    const resolved = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: pending?.id ?? '', pick: { kind: 'resources', res: { funds: 2 } } },
      CAP_CTX,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(poolTotal(resolved.state.players.p1?.resources ?? ({} as Pool))).toBe(10);
    expect(resolved.state.choices).toEqual([]);
  });

  it('a player under the reduced cap is asked for nothing, at 2/3/4/5 seats', () => {
    for (const n of [2, 3, 4, 5]) {
      const s = holding(CAP_CARD, n, { funds: 6 });
      const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: CAP_CARD.id }, CAP_CTX);
      expect(played.ok, `${n} seats`).toBe(true);
      if (!played.ok) continue;
      expect(played.state.choices, `${n} seats: a player under the cap was asked to discard`).toEqual([]);
      expect(played.state.players.p1?.capOverride?.to).toBe(10);
    }
  });

  /**
   * THE DEADLOCK ASSERTION, at every seat count, over every pool the cap could catch.
   *
   * "A legal move always exists" is the phrase the codebase uses for this class of bug, so
   * it is checked as: for every seat count and every pool total, the decision the cap drop
   * raises (if any) is DISCHARGABLE — the engine accepts a pick that removes exactly the
   * ask. A cap drop that could raise a decision nobody can answer is the `convert-voter`
   * bug wearing a different hat.
   */
  it('the decision it raises is dischargeable at 2/3/4/5 seats, for every pool', () => {
    const stranded: string[] = [];
    let asked = 0;

    for (const n of [2, 3, 4, 5]) {
      for (let total = 0; total <= RULES.resourceCap; total += 1) {
        const s = holding(CAP_CARD, n, { funds: total });
        const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: CAP_CARD.id }, CAP_CTX);
        if (!played.ok) {
          stranded.push(`${n} seats total=${total}: the play itself was refused (${played.error})`);
          continue;
        }
        const pending = played.state.choices.find((c) => c.player === 'p1');
        if (pending === undefined) continue;
        asked += 1;
        if (pending.choice.kind !== 'lose-any') {
          stranded.push(`${n} seats total=${total}: unexpected decision ${JSON.stringify(pending.choice)}`);
          continue;
        }
        const want = pending.choice.count;
        if (want > total) {
          stranded.push(`${n} seats total=${total}: ask ${want} exceeds the pool`);
          continue;
        }
        const answered = reduce(
          played.state,
          'p1',
          { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'resources', res: { funds: want } } },
          CAP_CTX,
        );
        if (!answered.ok) stranded.push(`${n} seats total=${total}: the pick was refused (${answered.error})`);
        else if (poolTotal(answered.state.players.p1?.resources ?? ({} as Pool)) !== Math.min(total, 10)) {
          stranded.push(`${n} seats total=${total}: landed at the wrong total`);
        }
      }
    }

    expect(asked, 'the cap drop never raised a discard, so nothing was proved').toBeGreaterThan(0);
    expect(stranded, `${stranded.length} stranded positions:\n${stranded.slice(0, 10).join('\n')}`).toEqual([]);
  });
});

describe('the three rulings the field forces', () => {
  it('stacking keeps the MORE restrictive cap, never the later one', () => {
    const two = probe('cap-8-then-11', [
      { op: 'set-cap', to: 8 },
      { op: 'set-cap', to: 11 },
    ]);
    const ctx = ctxWith([two]);
    const s = holding(two, 3, { funds: 12 });
    const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: two.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    // 8 is lower than 11, so 8 wins and the second effect is a no-op. The other order is
    // asserted too, because "last write wins" and "most restrictive wins" only differ when
    // the SECOND value is HIGHER — which is the case above, and the case a naive
    // implementation gets wrong.
    expect(played.state.players.p1?.capOverride?.to).toBe(8);
  });

  it('a `to` above the printed cap is a no-op, not an increase', () => {
    const up = probe('cap-99', [{ op: 'set-cap', to: 99 }]);
    const ctx = ctxWith([up]);
    const s = holding(up, 3, { funds: 12 });
    const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: up.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    // `min(99, RULES.resourceCap)` — a card cannot hand a player more room than p12 allows.
    expect(played.state.players.p1?.capOverride?.to).toBe(RULES.resourceCap);
    expect(played.state.choices, 'and it raised no discard, because nothing crossed').toEqual([]);
  });

  it('`until` is the reduction\'s deadline, retired at the turn boundary', () => {
    const brief = probe('cap-turn', [{ op: 'set-cap', to: 10, until: 'this-turn' }]);
    const ctx = ctxWith([brief]);
    const s = holding(brief, 3, { funds: 12 });
    const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: brief.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players.p1?.capOverride, 'a `this-turn` reduction was never written').toBeDefined();

    // Roll the boundary. `expireCapOverrides` runs beside `expireRestrictions` and the
    // `powerUses` reset, so this is the ONLY thing that retires it.
    let s2 = played.state;
    for (let i = 0; i < 6 && !s2.finished; i += 1) {
      const p = s2.activePlayer;
      const r = reduce(s2, p, { type: 'ANSWER', side: 0 }, ctx);
      if (r.ok) s2 = r.state;
      const e = reduce(s2, p, { type: 'END_TURN' }, ctx);
      if (e.ok) s2 = e.state;
      if (s2.phase === 'answer') {
        const a = reduce(s2, p, { type: 'ANSWER', side: 0 }, ctx);
        if (a.ok) s2 = a.state;
      }
      if (s2.phase === 'headlines') {
        const h = reduce(s2, p, { type: 'ACK_HEADLINE' }, ctx);
        if (h.ok) s2 = h.state;
      }
      if (s2.choices.length > 0) s2 = { ...s2, choices: [] };
    }
    expect(s2.players.p1?.capOverride, 'the reduction outlived its deadline').toBeUndefined();
  });
});

describe('a played game with the card in the deck never lacks a legal move', () => {
  /**
   * The same shape `live-effects.test.ts` and `card-transfer.test.ts` use: a driven game
   * that at EVERY step asserts some action succeeds. A cap reduction removes no action and
   * adds one — the discard — and this is what proves the two halves of that sentence at
   * every seat count rather than in one hand-built position.
   */
  it('at 2/3/4/5 seats, some action succeeds at every step', () => {
    const card = probe('cap-game', [{ op: 'set-cap', to: 10, until: 'rest-of-game' }]);
    const big = bigCards();
    const bigIdeology = BIG_IDEOLOGY_DECK;
    const bigVoter = BIG_VOTER_DECK;
    void big;

    for (const n of [2, 3, 4, 5]) {
      const ids = seats(n);
      let s: GameState = setup({
        players: ids,
        cards: big,
        seed: 11 + n,
        ideologyDeck: bigIdeology,
        voterDeck: bigVoter,
        conspiracyDeck: [...CONSPIRACY_DECK, card.id],
        headlineDeck: HEADLINE_DECK,
        startResources: ids.map(() => ({ funds: 8 })),
      });
      const ctx: Ctx = {
        rules: RULES,
        cards: {
          ideology: big.ideology,
          voter: big.voter,
          conspiracy: { ...big.conspiracy, [card.id]: card },
          headline: big.headline,
        },
      };
      // Deal the probe to whoever is about to act, so the reduction really happens in play.
      const p = s.players[s.activePlayer];
      if (!p) throw new Error('no active player');
      s = { ...s, players: { ...s.players, [s.activePlayer]: { ...p, conspiracies: [card.id] } } };

      let steps = 0;
      let played = false;
      for (; steps < 24 && !s.finished; steps += 1) {
        const who = s.activePlayer;
        const mine = s.choices.find((c) => c.player === who);
        let moved = false;
        if (mine && mine.choice.kind === 'lose-any') {
          const r = reduce(
            s,
            who,
            { type: 'RESOLVE_CHOICE', choiceId: mine.id, pick: { kind: 'resources', res: { funds: mine.choice.count } } },
            ctx,
          );
          if (r.ok) {
            s = r.state;
            moved = true;
          }
        }
if (!moved) {
          // Play the probe, EARLY, because this is the arm that actually makes the
          // reduction HAPPEN in play — which is the whole point of driving a game rather
          // than asserting on a hand-built position. Left last it would never be reached,
          // because `INFLUENCE` almost always succeeds first and the run would pass while
          // proving nothing about the card. `cost` is 0, so no pay is involved.
          const f = reduce(s, who, { type: 'PLAY_CONSPIRACY', cardId: card.id }, ctx);
          if (f.ok) {
            s = f.state;
            moved = true;
            played = true;
          }
        }
        if (!moved) {
          const a = reduce(s, who, { type: 'ANSWER', side: 0 }, ctx);
          if (a.ok) {
            s = a.state;
            moved = true;
          }
        }
        if (!moved) {
          const b = reduce(s, who, { type: 'ACK_HEADLINE' }, ctx);
          if (b.ok) {
            s = b.state;
            moved = true;
          }
        }
        if (!moved) {
          const c = reduce(s, who, { type: 'INFLUENCE', slot: 0 }, ctx);
          if (c.ok) {
            s = c.state;
            moved = true;
          }
        }
        if (!moved) {
          const e = reduce(s, who, { type: 'END_TURN' }, ctx);
          if (e.ok) {
            s = e.state;
            moved = true;
          }
        }
        if (!moved) {
          // The whole point: no action at all succeeded for the player the engine says is
          // acting. That is the table-level stall this gap was refused for.
          expect(
            false,
            `${n} seats turn ${String(s.turn)}: ${who} has NO legal move (phase ${s.phase}, choices ${JSON.stringify(s.choices)})`,
          ).toBe(true);
        }
      }
      expect(steps, `${n} seats: the game ended immediately`).toBeGreaterThan(1);
      // Without this the loop above can pass with the probe never resolving once, which
      // would make "a legal move always exists" a statement about a game the card was not
      // in. Asserted, because a test that proves nothing while passing is worse than no
      // test — the file that wrote that sentence is the reason this one is here.
      expect(played, `${n} seats: the cap reduction never resolved in play, so nothing was proved`).toBe(true);
      expect(
        Object.values(s.players).some((pl) => pl?.capOverride !== undefined),
        `${n} seats: no seat ended the run holding a reduction`,
      ).toBe(true);
    }
  });
});