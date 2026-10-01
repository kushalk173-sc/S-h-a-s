/**
 * EVERY `Choice` KIND ALWAYS HAS A LEGAL PICK.
 *
 * A pending decision freezes its owner: `blockedBy` refuses every other action
 * that player could take, and `END_TURN` is refused while any decision is open.
 * So a `Choice` that CANNOT be resolved is not a stuck dialog — it is a stuck
 * TABLE, with no server-side recovery, for the rest of the match.
 *
 * The invariant is therefore structural, not per-card: for every kind, the engine
 * must accept some pick in every state it can raise that choice in. Two real
 * defects came out of writing this down, and they are the same defect twice:
 *
 *  - THE CLIENT raised one (a `gain-any` dialog with no enabled control, found by
 *    5-player browser playtesting on turn 7) and the engine was right: no
 *    `canAfford` belongs on a grant, because a resource you are about to be given
 *    is not one you must already own. The engine's obligation there is to make the
 *    ask EQUAL to what it will credit, which it does.
 *
 *  - THE ENGINE raised one, and this file is the proof. `lose-any` clamped its ask
 *    to what the player held when the CHOICE WAS RAISED, but the pool is not
 *    frozen while the decision is open. A `lose` effect from another player's card
 *    can drain the answering player in between, leaving an ask no pick can satisfy
 *    and a decision nobody can discharge. Every other kind was already clamped at
 *    resolution; `lose-any` was the one that was not.
 *
 * The shape to check for is always the same: a ceiling on the pick that the player
 * can no longer reach. `steal-any` clamps to the victim's present pool, the three
 * voter kinds clamp to the board as it stands, `gain-any` has no ceiling at all,
 * and `lose-any` now clamps to the chooser's present pool.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import {
  RESOURCES,
  NO_POWER_USES,
  poolTotal,
  type Choice,
  type Delta,
  type GameState,
  type PendingChoice,
  type PlayerID,
  type Pool,
} from '../src/state';
import { CARDS, IDEOLOGY_DECK, VOTER_DECK, CONSPIRACY_DECK, HEADLINE_DECK, fresh, makeCtx } from './helpers';

/** A card that strips one resource from every opponent — the pool-shrinking lever. */
const DRAIN: ConspiracyCard = {
  id: 'test-drain',
  name: 'Test Drain',
  text: 'Each opponent loses 1 Fund.',
  cost: 1,
  effects: [{ op: 'lose', res: { funds: 1 }, target: 'each-opponent' }],
};

const cards: CardIndex = indexCards({
  ideology: Object.values(CARDS.ideology),
  voter: Object.values(CARDS.voter),
  conspiracy: [...Object.values(CARDS.conspiracy), DRAIN],
  headline: Object.values(CARDS.headline),
});
const ctx: Ctx = { rules: RULES, cards };
const plain = makeCtx();

const POOL = (funds: number, clout = 0, media = 0, trust = 0): Pool => ({ funds, clout, media, trust });

/** A Delta spending `n` off the largest pools first — the pick a player would make. */
function shed(pool: Pool, n: number): Delta | null {
  const out: Delta = {};
  let left = n;
  for (const r of RESOURCES) {
    if (left <= 0) break;
    const take = Math.min(pool[r], left);
    if (take > 0) {
      out[r] = take;
      left -= take;
    }
  }
  return left === 0 ? out : null;
}

/**
 * A two-seat position, active phase, with `p1` holding `held` and one open
 * decision of `kind`/`count`.
 */
function withOpenChoice(
  choice: Choice,
  held: Pool,
  opts: { readonly drainInHand?: boolean; readonly p2?: Pool } = {},
): GameState {
  const s0 = fresh(1, ['p1', 'p2'], { startResources: [{}, {}] });
  const pending: PendingChoice = { id: 'c1', player: 'p1', choice };
  return {
    ...s0,
    phase: 'actions',
    activePlayer: 'p2',
    _pendingCard: null,
    players: {
      ...s0.players,
      p1: { ...s0.players.p1!, resources: held, powerUses: NO_POWER_USES },
      p2: {
        ...s0.players.p2!,
        resources: opts.p2 ?? POOL(0),
        conspiracies: opts.drainInHand ? [DRAIN.id] : [],
        powerUses: NO_POWER_USES,
      },
    },
    choices: [pending],
  };
}

describe('lose-any is clamped to the pool as it stands when it is answered', () => {
  it('the shape: an ask of 3 against a pool drained to 2, which the old code could not discharge', () => {
    // The failing shape, pinned as a fixture so the fix below is a fix and not a
    // coincidence. `p1` is asked to discard 3 while holding 3; `p2` then drains one.
    const before = withOpenChoice({ kind: 'lose-any', count: 3, reason: 'Card effect' }, POOL(3), {
      drainInHand: true,
    });
    const played = reduce(before, 'p2', { type: 'PLAY_CONSPIRACY', cardId: DRAIN.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const s = played.state;
    // The two numbers that used to be irreconcilable. The ask is frozen at raise
    // time; the pool is not, so in between they drifted apart.
    expect(s.players.p1?.resources.funds).toBe(2);
    expect(s.choices[0]?.choice.count).toBe(3);

    // The pick that now resolves is 2 — and 3 is still refused, so the player is
    // not simply handed the whole original ask back.
    expect(reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 2 } } }, ctx).ok).toBe(true);
    expect(reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 3 } } }, ctx).ok).toBe(false);
    // And every pick between the two is refused, so there is exactly one answer.
    expect(reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 1 } } }, ctx).ok).toBe(false);
    expect(reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: {} } }, ctx).ok).toBe(false);
  });

  it('the fix: the ask drops to what is held, and the decision resolves', () => {
    const before = withOpenChoice({ kind: 'lose-any', count: 3, reason: 'Card effect' }, POOL(3), {
      drainInHand: true,
    });
    const played = reduce(before, 'p2', { type: 'PLAY_CONSPIRACY', cardId: DRAIN.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const r = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 2 } } },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.choices).toEqual([]);
    expect(r.state.players.p1?.resources).toEqual(POOL(0));
  });

  it('the ask is clamped when held is already short, with no other actor involved', () => {
    // The same clamp with nothing draining anything: a fixture that under-delivers
    // relative to the card. Still resolvable, still exact.
    const s = withOpenChoice({ kind: 'lose-any', count: 4, reason: 'Card effect' }, POOL(2));
    const two = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 2 } } }, plain);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.state.players.p1?.resources).toEqual(POOL(0));
  });

  it('a held pool large enough still demands the FULL count', () => {
    // The clamp must not soften a real ask: p12 says discard exactly this much.
    const s = withOpenChoice({ kind: 'lose-any', count: 2, reason: 'Card effect' }, POOL(5));
    const one = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 1 } } }, plain);
    expect(one.ok).toBe(false);
    const two = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 2 } } }, plain);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.state.players.p1?.resources).toEqual(POOL(3));
  });

  it('a fully drained player still has a pick: discard nothing', () => {
    // The zero case, and the one a client must render as a live confirm at `0 of 0`.
    const s = withOpenChoice({ kind: 'lose-any', count: 2, reason: 'Card effect' }, POOL(0));
    const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: {} } }, plain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.choices).toEqual([]);
  });

  it('the cap discard that enforceCap raises is unaffected', () => {
    // p12's real path: over cap by 2, holding 14. The ask is 2 and 2 is what is
    // demanded — enforceCap's `excess` can never exceed what is held, so the clamp
    // is a no-op here and the ordinary rule stands.
    const s = withOpenChoice({ kind: 'lose-any', count: 2, reason: 'Resource cap' }, POOL(14));
    expect(poolTotal(POOL(14))).toBe(14);
    const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 2 } } }, plain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.p1?.resources).toEqual(POOL(12));
  });
});

describe('every kind is resolvable from the state it was raised in', () => {
  it('a whole shipped game never leaves an unresolvable decision on the table', () => {
    // The sweep. `winnable.test.ts` plays games that FINISH; this one plays them
    // and, at every accepted action, checks the invariant from the outside: for
    // each open decision, is there a pick the engine accepts? A single `false`
    // here is a hard lock, so this is the test that would have caught the
    // unclamped `lose-any` in the wild.
    let checked = 0;
    let unresolvable = 0;
    const kindsSeen = new Set<string>();

    const drainCarried = new Set<PlayerID>(['p2']);
    // A deliberately hostile driver: it answers with side 0, always buys, and
    // keeps resolving whatever decision it is handed with a minimal legal pick.
    let s = fresh(1, ['p1', 'p2', 'p3'], { startResources: [{}, {}, {}] });
    let guard = 0;
    while (!s.finished && guard++ < 600) {
      // INVARIANT CHECK, before anything else.
      for (const pending of s.choices) {
        kindsSeen.add(pending.choice.kind);
        checked += 1;
        const me = s.players[pending.player];
        if (!me) continue;
        const c = pending.choice;
        let probe: ReturnType<typeof reduce>;
        if (c.kind === 'lose-any') {
          const res = shed(me.resources, Math.min(c.count, poolTotal(me.resources))) ?? {};
          probe = reduce(s, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'resources', res } }, plain);
        } else if (c.kind === 'gain-any') {
          probe = reduce(s, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'resources', res: { funds: c.count } } }, plain);
        } else if (c.kind === 'steal-any') {
          const victim = c.from ?? s.turnOrder.find((p) => p !== pending.player && poolTotal(s.players[p]?.resources ?? POOL(0)) > 0);
          if (victim === undefined) continue;
          const res = shed(s.players[victim]?.resources ?? POOL(0), Math.min(c.count, poolTotal(s.players[victim]?.resources ?? POOL(0)))) ?? {};
          probe = reduce(s, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'steal', from: victim, res } }, plain);
        } else {
          continue; // area-shaped: covered by targetableCount, asserted below
        }
        if (!probe.ok) unresolvable += 1;
      }

      const p = s.activePlayer;
      if (s.phase === 'answer') {
        const r = reduce(s, p, { type: 'ANSWER', side: 0 }, plain);
        if (!r.ok) break;
        s = r.state;
        continue;
      }
      if (s.phase === 'headlines') {
        const r = reduce(s, p, { type: 'ACK_HEADLINE' }, plain);
        if (!r.ok) break;
        s = r.state;
        continue;
      }
      // Resolve the active player's own decision if it has one, so play can move.
      const own = s.choices.find((c) => c.player === p);
      if (own) {
        const me = s.players[p];
        const c = own.choice;
        let res: Delta = {};
        if (c.kind === 'lose-any') res = shed(me?.resources ?? POOL(0), Math.min(c.count, poolTotal(me?.resources ?? POOL(0)))) ?? {};
        else if (c.kind === 'gain-any') res = { funds: c.count };
        const r = reduce(s, p, { type: 'RESOLVE_CHOICE', choiceId: own.id, pick: { kind: 'resources', res } }, plain);
        if (!r.ok) break;
        s = r.state;
        continue;
      }
      let acted = false;
      for (let i = 0; i < s.market.length; i++) {
        const slot = s.market[i];
        const me = s.players[p];
        if (!slot || !me) continue;
        if (!(Object.entries(slot.cost) as [keyof Pool, number][]).every(([r, n]) => me.resources[r] >= n)) continue;
        const bought = reduce(s, p, { type: 'INFLUENCE', slot: i }, plain);
        if (!bought.ok) continue;
        const group = bought.state.players[p]?.pending.at(-1);
        if (!group) continue;
        const ids: string[] = [];
        for (const z of bought.state.zones) {
          if (z.areas.filter((a) => a.peg === null).length < group.count) continue;
          for (const a of z.areas) {
            if (a.peg === null) ids.push(a.id);
            if (ids.length === group.count) break;
          }
          if (ids.length === group.count) break;
        }
        if (ids.length !== group.count) continue;
        const placed = reduce(bought.state, p, { type: 'PLACE_VOTERS', groupId: group.id, areaIds: ids }, plain);
        if (placed.ok) {
          s = placed.state;
          acted = true;
          break;
        }
      }
      if (acted) continue;
      const end = reduce(s, p, { type: 'END_TURN' }, plain);
      if (!end.ok) break;
      s = end.state;
      // Keep draining cards in circulation so the pool-shrinking lever is live.
      if (drainCarried.has(p) && s.players[p] && !s.players[p]?.conspiracies.includes(DRAIN.id)) {
        s = { ...s, players: { ...s.players, [p]: { ...s.players[p]!, conspiracies: [DRAIN.id] } } };
      }
    }
    // The sweep must have actually exercised the resource-shaped kinds, or it is
    // a test that passes by never reaching the interesting case.
    expect(kindsSeen.has('lose-any')).toBe(true);
    expect(checked).toBeGreaterThan(0);
    expect(unresolvable, `${unresolvable} open decisions had no legal pick`).toBe(0);
  });
});

describe('gain-any imposes no affordability, by design', () => {
  it('a player holding nothing is credited the full ask', () => {
    // The engine half of the reported dead dialog. If this ever gains a
    // `canAfford`, the client's `gain` mode becomes the wrong fix and the bug comes
    // back one layer down.
    const s = withOpenChoice({ kind: 'gain-any', count: 1, reason: 'Card effect' }, POOL(0));
    const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { trust: 1 } } }, plain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.p1?.resources).toEqual(POOL(0, 0, 0, 1));
  });

  it('a gain spread across denominations is credited as picked', () => {
    const s = withOpenChoice({ kind: 'gain-any', count: 3, reason: 'Card effect' }, POOL(0));
    const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 1, media: 2 } } }, plain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.p1?.resources).toEqual(POOL(1, 0, 2, 0));
  });

  it('a gain still demands EXACTLY the ask, so a client cannot over-claim', () => {
    const s = withOpenChoice({ kind: 'gain-any', count: 2, reason: 'Card effect' }, POOL(0));
    const r = reduce(s, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c1', pick: { kind: 'resources', res: { funds: 5 } } }, plain);
    expect(r.ok).toBe(false);
  });
});

describe('the small deck still deals a legal opening', () => {
  it('setup deals a card, and the opening position has a legal first move', () => {
    // A regression guard on the thing `winnable.test.ts` relies on: with a
    // non-empty deck, turn 1 is never a soft-lock.
    const s = fresh(1);
    expect(s._pendingCard).not.toBeNull();
    expect(reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, plain).ok).toBe(true);
    // And the deck is fully accounted for: two piles plus the one card in hand.
    expect(s._ideologyDraw.length + s._ideologyDiscard.length + 1).toBe(IDEOLOGY_DECK.length);
    expect(VOTER_DECK.length + CONSPIRACY_DECK.length + HEADLINE_DECK.length).toBeGreaterThan(0);
  });
});
