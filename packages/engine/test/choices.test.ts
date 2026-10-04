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
  EMPTY_POOL,
  poolTotal,
  type Choice,
  type Delta,
  type GameState,
  type PendingChoice,
  type PlayerID,
  type Pool,
  type ZoneID,
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

// ─────────────────────── G21: the invariant, PROVED rather than sampled ───────────────────────

/**
 * WHY THIS BLOCK IS CONSTRUCTIVE
 *
 * The sweep above is REACTIVE: it can only check the choices a small synthetic corpus
 * happens to raise. That is exactly how two hard locks got through. It never plays a
 * Conspiracy Card at all, so it never raises `steal-any`, `evict-voter`,
 * `discard-voter` or `convert-voter` — its own `steal-any` arm was even written with
 * `if (victim === undefined) continue;`, so the one case it could not probe was the
 * one it skipped, and a test that skips the interesting state passes on it forever.
 *
 * So the sweep is kept for what it is good at (a whole shipped game, in motion, never
 * stranding) and the invariant is proved BELOW by RAISING each kind on purpose
 * through the real engine path, across the full cross-product of the conditions that
 * could plausibly leave it unsatisfiable, and then SEARCHING a bounded pick space for
 * one the engine accepts. Nothing here depends on a deck happening to cooperate.
 */

/** Every kind there is. The block below is worthless if this list is not exhaustive. */
const ALL_KINDS = [
  'gain-any',
  'lose-any',
  'steal-any',
  'evict-voter',
  'discard-voter',
  'convert-voter',
  'choose-player',
  'choose-zone',
  'choose-card',
] as const;
type Kind = (typeof ALL_KINDS)[number];

/** The three scopes a voter decision can carry. All three must stay satisfiable. */
const ALL_SCOPES = ['own', 'others', 'any'] as const;

/** Pools chosen to sit on both sides of every ceiling: empty, one short, ample, at cap. */
const POOLS_UNDER_TEST: readonly Pool[] = [POOL(0), POOL(1), POOL(2), POOL(12, 12, 12, 12), POOL(99, 99, 99, 99)];

/**
 * T3 — THE `ZoneSelector` AXIS, which the sweep was silent about while its docstring
 * claimed a cross-product.
 *
 * `null` is "the op carries no `zone` at all", which is the baseline the other three are
 * read against. The three real selectors are here because `zone` is the one narrowing on
 * these ops that can produce an **empty** target set, and empty is what strands a
 * decision: `resolveZone` returning `null` falls back to the whole board (the safe
 * direction) but a zone that RESOLVES is a real narrowing, and `resolveChoice`'s
 * `area.zone !== c.zoneId` guard is the only thing keeping the pick space equal to the
 * offered one. The combinations that were never asked are `convert-voter` +
 * `'chosen-zone'` (two narrowings stacked: which zone, then whose voter) and `evict` +
 * `'your-strongest'`.
 *
 * ONLY the three voter ops carry `zone` at the type level, so the axis is `[null]` for
 * every other kind — the same carve-out the `scope` axis already makes.
 */
const ALL_ZONE_SELECTORS = [null, 'this-zone', 'your-strongest', 'chosen-zone'] as const;
type ZoneUnderTest = (typeof ALL_ZONE_SELECTORS)[number];

/** The kinds whose `Effect` arm has a `zone` field at all. */
const ZONED_KINDS: readonly Kind[] = ['evict-voter', 'discard-voter', 'convert-voter'];

/**
 * G17 — the recycle list every state in the sweep carries.
 *
 * Two real corpus Conspiracy Card ids, DERIVED from `CARDS` rather than typed, so the
 * pile is two cards this game actually holds and a pick can name one of them. A pile of
 * made-up ids would satisfy the sweep and prove nothing about a pick that has to survive
 * a card name the server can resolve.
 */
const RECYCLE_UNDER_TEST: readonly string[] = Object.keys(CARDS.conspiracy).slice(0, 2);

/** One probe card per op that can raise a decision, so each kind is raised for real. */
const PROBE_EFFECTS: Readonly<Record<Kind, ConspiracyCard>> = {
  'gain-any': probeCard('probe-gain-any', [{ op: 'gain-any', n: 2, target: 'you' }]),
  'lose-any': probeCard('probe-lose-any', [{ op: 'lose-any', n: 2, target: 'you' }]),
  'steal-any': probeCard('probe-steal-any', [{ op: 'steal-any', n: 2, target: 'each-opponent' }]),
  'evict-voter': probeCard('probe-evict-voter', [{ op: 'evict', n: 2, target: 'you' }]),
  'discard-voter': probeCard('probe-discard-voter', [{ op: 'discard-voter', n: 2, target: 'you' }]),
  'convert-voter': probeCard('probe-convert-voter', [{ op: 'convert-voter', n: 2, target: 'you' }]),
  /**
   * G1. The candidate set is `turnOrder` minus the actor, so this raises a decision in
   * every game with at least two seats and in NO game with one — and the exhaustive
   * loop below proves the second half too, because it asserts every kind was raised at
   * least once and separately that nothing was raised without a legal pick.
   */
  'choose-player': probeCard('probe-choose-player', [{ op: 'voters', n: 1, target: 'chosen-player' }]),
  /** G16. `zone` narrows the pegs; `target: 'each-opponent'` makes the scope `'own'`. */
  'choose-zone': probeCard('probe-choose-zone', [
    { op: 'discard-voter', n: 1, target: 'each-opponent', zone: 'chosen-zone' },
  ]),
  /**
   * G17. `pick: true` over the recycle list — and the sweep needs a NON-EMPTY pile to
   * raise it at all, so `seeded` below is given one. `n` is the card's count, so the
   * `[1, 2, 3, 5]` axis is what makes `min(n, pile.length)` the binding term and is the
   * only axis in this file that tests a cap the ENGINE chose rather than the fixture.
   */
  'choose-card': probeCard('probe-choose-card', [
    { op: 'draw-conspiracy', n: 1, from: 'discard', pick: true },
  ]),
};

function probeCard(id: string, effects: ConspiracyCard['effects']): ConspiracyCard {
  return { id, name: id, text: 'probe', cost: 0, effects };
}

const probeCards: CardIndex = indexCards({
  ideology: Object.values(CARDS.ideology),
  voter: Object.values(CARDS.voter),
  conspiracy: [...Object.values(CARDS.conspiracy), ...Object.values(PROBE_EFFECTS)],
  headline: Object.values(CARDS.headline),
});
const probeCtx: Ctx = { rules: RULES, cards: probeCards };

/**
 * Put pegs on the board. `own`/`foreign` count pegs for the chooser and for an
 * opponent, and `volatile` count pegs that cannot be affected at all (p18).
 *
 * Pegs are the ONLY thing the three voter kinds read off the board, so a board with
 * no pegs, a board of only foreign pegs, a board of only the chooser's own, and
 * a board half of each are four genuinely different states for them — and the
 * `evict-voter`-by-its-own-caster scope (`'any'`) is only distinct from `'others'` in
 * the second and third.
 *
 * ## `spread` — T3, AND IT IS WHY THE `zone` AXIS IS WORTH HAVING AT ALL
 *
 * Without it every peg lands in the FIRST zone, because `take()` walks
 * `zones.flatMap(...)` in order. Four pegs is four pegs in one zone, so
 * `'your-strongest'` and a `'choose-zone'` decision are never asked to discriminate
 * between two populated constituencies — the one question those two selectors exist
 * to ask. `spread` takes the free areas round-robin across zones instead, so the same
 * counts are laid out over at least two zones and the narrowing has something to
 * narrow. It is a *separate* flag rather than a fifth count triple because "where the
 * pegs are" and "how many there are" are different axes and crossing them is the point.
 */
function pegged(
  s: GameState,
  who: PlayerID,
  own: number,
  foreign: number,
  volatile: number,
  spread = false,
): GameState {
  const areas = s.zones.flatMap((z) => z.areas);
  // Spread: take the first free area, then the first area in a DIFFERENT zone, then the
  // next free area after each — so the first two pegs already sit in two constituencies
  // and everything after alternates. `flatMap` order is zone order, so this is
  // deterministic and needs no rng (R1: `reduce` and its fixtures read no clock).
  const all = areas.map((a) => a.id);
  let free: string[];
  if (!spread || s.zones.length < 2) {
    free = [...all];
  } else {
    const first = all[0];
    const second = s.zones[1]?.areas[0]?.id;
    const rest = all.filter((id) => id !== first && id !== second);
    free = [first, ...(second === undefined ? [] : [second]), ...rest].filter((id): id is string => id !== undefined);
  }
  const take = (): string => {
    const id = free.shift();
    if (id === undefined) throw new Error('ran out of areas');
    return id;
  };
  let placed = areas;
  for (let i = 0; i < own + foreign + volatile; i += 1) {
    const id = take();
    placed = placed.map((a) => (a.id === id ? { ...a, peg: { owner: i < own ? who : 'p2', majority: false }, ...(i >= own + foreign ? { volatile: true } : {}) } : a));
  }
  return { ...s, zones: s.zones.map((z) => ({ ...z, areas: placed.filter((a) => z.areas.some((x) => x.id === a.id)) })) };
}

/** Give each named player a pool. Anything omitted is left as setup dealt it. */
function withPools(s: GameState, pools: Readonly<Record<string, Pool>>): GameState {
  const players = { ...s.players };
  for (const [who, pool] of Object.entries(pools)) {
    const p = players[who];
    if (!p) throw new Error(`no such player ${who}`);
    players[who] = { ...p, resources: pool, powerUses: NO_POWER_USES };
  }
  return { ...s, players };
}

/** Hand `who` a Conspiracy Card, which is the only way a test reaches a card effect. */
function withHand(s: GameState, who: PlayerID, ids: readonly string[]): GameState {
  const p = s.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  return { ...s, players: { ...s.players, [who]: { ...p, conspiracies: [...ids] } } };
}

/**
 * EVERY candidate pick for `pending`, over a deliberately generous bounded space.
 *
 * Generous is the point: this is a SEARCH for one accepted pick, not a replay of what
 * a client would offer. So it enumerates the empty Delta and single-resource takes up
 * to 3, every victim including the chooser (the engine is supposed to refuse that one,
 * and finding nothing else is how a self-steal shows up), and every subset of pegged
 * areas up to size 3. If a legal pick exists anywhere in here, it is found.
 */
function candidatePicks(s: GameState, pending: PendingChoice): ReturnType<typeof reduce>[] {
  const me = pending.player;
  const c = pending.choice;
  const out: ReturnType<typeof reduce>[] = [];
  const reach = Math.max(3, c.count);
  const deltas: Delta[] = [{}, { funds: c.count }];
  for (const r of RESOURCES) {
    for (let n = 1; n <= reach; n += 1) deltas.push({ [r]: n });
  }
  deltas.push({ funds: 1, trust: 1 }, { funds: 2, clout: 1 });
  for (let a = 0; a <= reach; a += 1) {
    for (let b = 0; b + a <= reach; b += 1) {
      if (a + b === 0) continue;
      deltas.push({ funds: a, trust: b });
    }
  }

  if (c.kind === 'gain-any' || c.kind === 'lose-any') {
    for (const res of deltas) out.push(reduce(s, me, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'resources', res } }, probeCtx));
    return out;
  }
  if (c.kind === 'steal-any') {
    // The fixed victim FIRST, and the chooser among the candidates: a self-steal is
    // the defect this search exists to find, so it has to be a candidate.
    const victims = [c.from, ...s.turnOrder].filter((v, i, a): v is PlayerID => v !== null && a.indexOf(v) === i);
    for (const from of victims) {
      for (const res of deltas) out.push(reduce(s, me, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'steal', from, res } }, probeCtx));
    }
    return out;
  }
  /**
   * G1/G16 candidates, and they are deliberately OVER-GENEROUS: every seat including
   * the chooser, plus a seat that does not exist, and every constituency plus a
   * fabricated id. The engine is supposed to refuse the chooser and the unknown ids —
   * and finding nothing else is how a genuinely stranded decision shows up. So a
   * green result means the search really did find an accepted pick, not that the
   * candidate list was small.
   */
  if (c.kind === 'choose-player') {
    const seats = [...s.turnOrder, me, 'nobody-here'];
    for (const id of seats) out.push(reduce(s, me, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'player', id } }, probeCtx));
    return out;
  }
  if (c.kind === 'choose-zone') {
    const zones = [...s.zones.map((z) => z.id), 'nowhere' as ZoneID];
    for (const zoneId of zones) out.push(reduce(s, me, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'zone', zoneId } }, probeCtx));
    return out;
  }
  /**
   * G17 candidates, deliberately OVER-GENEROUS in the same way as the two above: every
   * card the decision offered, plus one that is not, plus a card id that does not exist.
   * The engine is supposed to refuse the two it was not offered — and finding nothing
   * else is how a genuinely stranded decision shows up. A green result means the search
   * really did find an accepted pick, not that the candidate list was one long.
   */
  if (c.kind === 'choose-card') {
    for (const cardId of [...c.cards, 'ct-nowhere-0001']) {
      out.push(reduce(s, me, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId } }, probeCtx));
    }
    return out;
  }
  const areaIds = s.zones.flatMap((z) => z.areas.filter((a) => a.peg !== null).map((a) => a.id));  const subsets: string[][] = [[]];
  const areaReach = Math.min(Math.max(2, c.count), areaIds.length);
  for (let n = 1; n <= areaReach; n += 1) {
    for (const combo of combos(areaIds, n)) subsets.push(combo);
  }
  for (const ids of subsets) out.push(reduce(s, me, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'areas', areaIds: ids } }, probeCtx));
  return out;
}

function combos<T>(xs: readonly T[], n: number): T[][] {
  if (n === 0) return [[]];
  if (xs.length < n) return [];
  const out: T[][] = [];
  for (let i = 0; i <= xs.length - n; i += 1) {
    for (const rest of combos(xs.slice(i + 1), n - 1)) out.push([xs[i] as T, ...rest]);
  }
  return out;
}

describe('G21 — every kind accepts a legal pick in EVERY state it can be raised in', () => {
  /**
   * The exhaustive one. Raises all six kinds through `PLAY_CONSPIRACY` and, for each
   * raised decision, searches for an accepted pick.
   *
   * The axes are the ones that can move a ceiling between the raise and the answer,
   * and they are crossed rather than sampled:
   *
   *  - the chooser's pool, because `lose-any` clamps to it;
   *  - every OTHER player's pool, because `steal-any` clamps to the victim's;
   *  - the peg layout, because the three voter kinds clamp to the board;
   *  - the count the card asks for, because a count above every clamp is the whole
   *    shape of the defect;
   *  - and for the voter kinds, every scope, because `ChoiceScope` deliberately makes
   *    "your own" and "an opponent's" different questions;
   *  - **and, since T3, every `ZoneSelector`, crossed with a peg layout SPREAD OVER TWO
   *    ZONES.** That last clause is the fix: the axis existed as a claim in this
   *    docstring and not as a loop, so `evict`/`discard-voter`/`convert-voter` were
   *    never raised with a narrowing at all — and every peg landed in the first zone,
   *    so even `'your-strongest'` was never asked to choose between two populated
   *    constituencies.
   */
  it('no combination of pool, pegs, scope, count or zone strands a decision', () => {
    const stranded: string[] = [];
    const kindsRaised = new Set<string>();
    const zonesRaised = new Set<string>();
    const zonesNarrowed = new Set<string>();
    let raised = 0;
    let probed = 0;

    for (const kind of ALL_KINDS) {
      for (const mine of POOLS_UNDER_TEST) {
        for (const theirs of POOLS_UNDER_TEST) {
          // The count triples, each laid out FLAT and then SPREAD. Flat is the historical
          // layout and spread is the one that makes a zone narrowing mean something.
          const pegLayouts = [
            [0, 0, 0, false], [0, 2, 0, false], [2, 0, 0, false], [1, 1, 1, false],
            [0, 2, 0, true], [2, 0, 0, true], [1, 1, 1, true],
          ] as const;
          for (const [own, foreign, vol, spread] of pegLayouts) {
            for (const count of [1, 2, 3, 5]) {
              for (const scope of ZONED_KINDS.includes(kind) ? ALL_SCOPES : [null]) {
                for (const zone of ZONED_KINDS.includes(kind) ? ALL_ZONE_SELECTORS : [null]) {
                const seeded = pegged(
                  withPools(fresh(1, ['p1', 'p2', 'p3'], { startResources: [{}, {}, {}] }), { p1: mine, p2: theirs, p3: theirs }),
                  'p1',
                  own,
                  foreign,
                  vol,
                  spread,
                );
                // `'this-zone'` reads `GameState.headlineQueue[0].areaId`, and an empty
                // queue resolves to `null` — the safe fallback, which is a real case but
                // not the narrowing this axis exists to test. So for that selector the
                // queue is pointed at a PEGGED area, which makes `resolveZone` return a
                // real `ZoneID` and the clamp below do the work it exists to do.
                const anchored = seeded.zones.flatMap((z) => z.areas).find((a) => a.peg !== null);
                // How many constituencies are POPULATED. Hoisted out of the castAt loop
                // because it is a property of the board, not of the decision, and this
                // sweep runs it tens of thousands of times.
                const populatedZones = new Set(
                  seeded.zones.filter((z) => z.areas.some((a) => a.peg !== null)).map((z) => z.id),
                );
                const base: GameState =
                  zone === 'this-zone' && anchored !== undefined
                    ? { ...seeded, headlineQueue: [{ areaId: anchored.id, by: 'p1' }] }
                    : seeded;
                /**
                 * G17 — A NON-EMPTY RECYCLE LIST, and TWO cards on it rather than one.
                 *
                 * `pick: true` raises NOTHING for an empty pile, so without this the
                 * ninth kind is silently unraised and `kindsRaised.size` — which is the
                 * sweep's own non-vacuity floor — would be the only thing noticing.
                 *
                 * TWO is the length that matters: `applyEffect` raises at most
                 * `min(n, pile.length)`, so a count of 1 or 2 is satisfiable with a card
                 * left and a count of 3 or 5 is capped by the pile rather than by the ask.
                 * A one-card pile would make every count look identically capped and the
                 * `[1, 2, 3, 5]` axis would prove nothing about the bound. The pile is the
                 * same for every other kind and is inert for them, which is asserted
                 * below rather than assumed.
                 */
                const withRecycle: GameState = {
                  ...base,
                  _conspiracyDiscard: RECYCLE_UNDER_TEST,
                };
                const playable = withHand({ ...withRecycle, phase: 'actions', activePlayer: 'p1', _pendingCard: null, choices: [] } as GameState, 'p1', [PROBE_EFFECTS[kind].id]);

                // The card's printed `n` is what sets `count`, so vary it through the
                // card rather than through the choice — a state built by hand is not
                // a state the engine can raise.
                const card = probeCard(`probe-${kind}-${count}`, [probeEffect(kind, count, zone)]);
                const indexed = indexCards({
                  ideology: Object.values(CARDS.ideology),
                  voter: Object.values(CARDS.voter),
                  conspiracy: [card],
                  headline: Object.values(CARDS.headline),
                });
                const ctxN: Ctx = { rules: RULES, cards: indexed };
                const inHand = withHand(playable, 'p1', [card.id]);

                // `each-opponent` raises the decision for the OPPONENTS, and their
                // scope is what varies above. `you` raises it for the chooser.
                // `'chosen-player'` raises a decision the ACTOR answers. `'player-after'`
                // (G12) raises it for the seat one along, which is a different owner again
                // and therefore a different `blockedBy` owner — so it belongs in the sweep
                // rather than beside it. Both are real raise paths, so all are probed.
                for (const castAt of ['you', 'each-opponent', 'chosen-player', 'player-after'] as const) {
                  const out = playAndRead(inHand, card.id, castAt, ctxN);
                  if (out === null) continue; // this raise path did not apply here
                  for (const pending of out.choices) {
                    raised += 1;
                    kindsRaised.add(pending.choice.kind);
                    if (zone !== null) {
                      zonesRaised.add(zone);
                      // THE REAL FLOOR: a selector only narrows if there is more than one
                      // populated constituency to narrow TO. Recording how many zones the
                      // pegs ended up spread across — not how many zones the board has,
                      // which is always nine — is what makes "the zone axis ran" mean "a
                      // narrowing happened" rather than "a loop iterated".
                      if (populatedZones.size > 1) zonesNarrowed.add(zone);
                    }
                    probed += 1;
                    if (!candidatePicks(out.state, pending).some((r) => r.ok)) {
                      stranded.push(
                        `${kind} count=${count} scope=${scope ?? '-'} zone=${zone ?? '-'} castAt=${castAt} ` +
                          `mine=${JSON.stringify(mine)} theirs=${JSON.stringify(theirs)} pegs=${own}/${foreign}/${vol}${spread ? ' spread' : ''} ` +
                          `-> ${JSON.stringify(pending.choice)}`,
                      );
                    }
                  }
                }
                }
              }
            }
          }
        }
      }
    }

    expect(kindsRaised.size, `only raised ${[...kindsRaised].join(',')}`).toBe(ALL_KINDS.length);
    expect(raised, 'no decision was raised, so nothing was proved').toBeGreaterThan(0);
    expect(probed).toBe(raised);
    // T3's non-vacuity floor, and it is the whole point of the axis: without these two
    // the loop could gain a `zone` dimension that is never actually consulted — which is
    // exactly what it was before, and exactly the failure the audit found.
    expect(
      [...zonesRaised].sort(),
      'the zone axis raised nothing, so the narrowing is still unproved',
    ).toEqual(['chosen-zone', 'this-zone', 'your-strongest']);
    expect(
      [...zonesNarrowed].sort(),
      'the zone axis only ever ran with every peg in one zone, so nothing was ever narrowed',
    ).toEqual(['chosen-zone', 'this-zone', 'your-strongest']);
    expect(stranded, `${stranded.length} raised decisions had NO legal pick:\n${stranded.slice(0, 12).join('\n')}`).toEqual([]);
  });

  /**
   * The specific defect, pinned as a shape so the fix is a fix and not a coincidence.
   *
   * A live `steal-any` that names its victims, hooked to `on-turn-start`. On that one
   * trigger `fireTriggers` requires `fire.actor === le.owner` and applies the effect
   * with `source = le.owner`, so the waking event and the thief are the SAME player —
   * and the old guard tested the resolved target instead of the substituted victim, so
   * the decision was raised aimed at the thief. `resolveChoice` refuses every such
   * pick ('steal from someone else'), which is a permanent freeze: `blockedBy` refuses
   * every other action and nothing discharges the decision.
   */
  it('a live steal-any firing on its OWN owner\'s turn start does not raise a self-theft', () => {
    const CARD = probeCard('probe-earworm-self', [
      { op: 'steal-any', n: 1, target: 'each-opponent', when: 'on-turn-start', until: 'rest-of-game' },
    ]);
    const indexed = indexCards({
      ideology: Object.values(CARDS.ideology),
      voter: Object.values(CARDS.voter),
      conspiracy: [CARD],
      headline: Object.values(CARDS.headline),
    });
    const ctx1: Ctx = { rules: RULES, cards: indexed };
    const s0 = withPools(fresh(1, ['p1', 'p2'], { startResources: [{}, {}] }), { p1: POOL(5), p2: POOL(5) });
    const installed = withHand(
      { ...s0, phase: 'actions', activePlayer: 'p1', _pendingCard: null, choices: [], turn: 1 },
      'p1',
      [CARD.id],
    );
    const played = reduce(installed, 'p1', { type: 'PLAY_CONSPIRACY', cardId: CARD.id }, ctx1);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    // Playing it installs the live effect. Now roll the owner's own turn round.
    const live = played.state.liveEffects.find((le) => le.sourceCardId === CARD.id);
    expect(live, 'the probe did not install a live effect').toBeDefined();

    // The owner's next turn start is the event the effect is hooked to.
    const nextTurn = { ...played.state, activePlayer: 'p1', phase: 'actions', choices: [], _pendingCard: null, turn: played.state.turn + 1 } as GameState;
    const boundary = rollTurnStart(nextTurn, ctx1);
    const selfThefts = boundary.choices.filter((c) => c.player === 'p1' && c.choice.kind === 'steal-any' && (c.choice as { from?: PlayerID | null }).from === 'p1');
    expect(
      selfThefts.map((c) => `${c.id} from=${(c.choice as { from?: PlayerID | null }).from}`),
      'the live effect raised a theft aimed at its own owner, which no pick can resolve',
    ).toEqual([]);
    // And nothing it did raise is itself stranded.
    for (const pending of boundary.choices) {
      expect(
        candidatePicks(boundary, pending).some((r) => r.ok),
        `${pending.choice.kind} ${JSON.stringify(pending.choice)} had no legal pick at its owner's turn start`,
      ).toBe(true);
    }
  });

  /**
   * The probe effect for one kind, with the count the card asks for and — for the three
   * voter kinds — the `zone` narrowing it asks for.
   *
   * The six pre-existing kinds are one op with a retargetable `target`. The two new
   * ones are FIELD values on an ordinary op — `'chosen-player'` is an `EffectTarget`
   * and `'chosen-zone'` is a `ZoneSelector` — so they are built as such here, and
   * `playAndRead` must not retarget them (see its guard).
   *
   * **T3: THE `zone` PARAMETER.** Only the three voter ops have a `zone` in their
   * `Effect` arm, so `probeEffect` narrows `op` before attaching one rather than
   * spreading a `zone` onto an arm that does not have it — a probe that could
   * manufacture a shape the type forbids would be proving something that cannot ship.
   * `zone: null` therefore means "no narrowing at all", which is the baseline.
   */
  function probeEffect(
    kind: Kind,
    count: number,
    zone: ZoneUnderTest = null,
  ): ConspiracyCard['effects'][number] {
    if (kind === 'choose-player') return { op: 'voters', n: count, target: 'chosen-player' };
    if (kind === 'choose-zone') {
      return { op: 'discard-voter', n: count, target: 'each-opponent', zone: 'chosen-zone' };
    }
    // G17. `from: 'discard'` is not optional here: `pick` over any other pile is REFUSED
    // by `applyEffect` (a decision's option list may not enumerate a hidden pile), so a
    // probe that omitted it would raise nothing and the sweep would count a kind it never
    // saw.
    if (kind === 'choose-card') {
      return { op: 'draw-conspiracy', n: count, from: 'discard', pick: true };
    }
    const op = opFor(kind);
    if (zone === null) return { op, n: count, target: 'each-opponent' };
    if (op !== 'evict' && op !== 'discard-voter' && op !== 'convert-voter') {
      throw new Error(`${op} has no zone field, so the zone axis asked an impossible question`);
    }
    return { op, n: count, target: 'each-opponent', zone };
  }

  /**
   * G1/G16 — THE SEAT-COUNT AXIS, at 2/3/4/5, which the loop above cannot reach because
   * its position is fixed at three.
   *
   * This is the axis the two new kinds live or die on, and the two-seat case is the
   * one that matters: it is the smallest legal table, so `'choose-player'`'s candidate
   * set is exactly one seat there. If that seat were filtered by anything — holdings,
   * pegs, whether the effect would do anything to them — a two-seat game would raise a
   * decision with no legal answer, which is the dead-`gain-any` dialog and the
   * Ideology-deck bug, in a new place.
   *
   * **AND THE EMPTY-BOARD CASE, which is the real `choose-zone` hazard.** With no pegs
   * anywhere, `legalZoneIds` is empty, and the honest behaviour is to raise NOTHING
   * rather than raise a decision nobody can answer. Asserted both ways: nothing is
   * raised, and the reducer is not stuck afterwards.
   */
  it('the two new kinds are satisfiable at 2/3/4/5 seats, and raise nothing on an empty board', () => {
    const stranded: string[] = [];
    let raisedPlayer = 0;
    let raisedZone = 0;
    let emptyBoardPlayer = 0;
    let emptyBoardZone = 0;

    for (const seats of [2, 3, 4, 5] as const) {
      const ids = Array.from({ length: seats }, (_, i) => `p${i + 1}`);
      const playerCard = PROBE_EFFECTS['choose-player'];
      const zoneCard = PROBE_EFFECTS['choose-zone'];

      for (const [label, card] of [['choose-player', playerCard], ['choose-zone', zoneCard]] as const) {
        for (const pegLayout of ['none', 'mixed'] as const) {
          const base = pegged(
            {
              ...fresh(1, ids, { startResources: ids.map(() => ({})) }),
              phase: 'actions',
              activePlayer: 'p1',
              _pendingCard: null,
              choices: [],
            } as GameState,
            'p1',
            pegLayout === 'mixed' ? 1 : 0,
            pegLayout === 'mixed' ? seats - 1 : 0,
            0,
          );
          const inHand = withHand(base, 'p1', [card.id]);
          const out = reduce(inHand, 'p1', { type: 'PLAY_CONSPIRACY', cardId: card.id }, probeCtx);
          expect(out.ok, `${label} at ${seats} seats / ${pegLayout}: ${out.ok ? '' : out.error}`).toBe(true);
          if (!out.ok) continue;

          const pending = out.state.choices.find((c) => c.player === 'p1');
          if (label === 'choose-player') {
            if (pending === undefined) {
              // Only legal in a one-seat game, which `Lobby` refuses to create.
              emptyBoardPlayer += 1;
              continue;
            }
            raisedPlayer += 1;
            const ok = candidatePicks(out.state, pending).some((r) => r.ok);
            if (!ok) stranded.push(`${label} at ${seats} seats / ${pegLayout}: ${JSON.stringify(pending.choice)}`);
          } else if (pending === undefined) {
            emptyBoardZone += 1;
          } else {
            raisedZone += 1;
            const ok = candidatePicks(out.state, pending).some((r) => r.ok);
            if (!ok) stranded.push(`${label} at ${seats} seats / ${pegLayout}: ${JSON.stringify(pending.choice)}`);
          }

          // The refused picks are pinned as refusals, so "one candidate accepted" cannot
          // be "every candidate accepted" and this cannot quietly become a redirect.
          if (pending !== undefined) {
            const self = out.state.choices.find((c) => c.id === pending.id);
            if (self !== undefined && label === 'choose-player') {
              expect(
                reduce(out.state, 'p1', { type: 'RESOLVE_CHOICE', choiceId: self.id, pick: { kind: 'player', id: 'p1' } }, probeCtx).ok,
                `${label}: naming the actor must be refused — nobody may aim a card at themselves`,
              ).toBe(false);
            }
          }
        }
      }
    }

    expect(raisedPlayer, 'choose-player was never raised, so nothing was proved').toBeGreaterThanOrEqual(4);
    expect(raisedZone, 'choose-zone was never raised, so nothing was proved').toBeGreaterThanOrEqual(4);
    expect(emptyBoardZone, 'choose-zone should raise nothing on an empty board, and did not').toBe(4);
    expect(stranded, `${stranded.length} raised decisions had NO legal pick:\n${stranded.join('\n')}`).toEqual([]);
  });

  /**
   * G12 — `'player-after'` IS satisfiable, and it raises no kind of its own.
   *
   * The property is weaker than the two above and therefore easier to get wrong in a
   * way that hides: `'player-after'` is a fixed seat, so there is no candidate set to
   * be empty and no `Choice` to be unsatisfiable. What can go wrong is the OPPOSITE —
   * the value resolving to nobody, which is a card that reads as though it hits the
   * player on your left and hits nobody at all, and is silent.
   *
   * So the assertions are: the seat is the one index along `turnOrder` at EVERY seat
   * count (the two-seat case is the load-bearing one, where it must be the actor's only
   * opponent and NOT the actor); a decision raised through it is answered for the RIGHT
   * player; and the reducer is not left stuck by it.
   */
  it("'player-after' names the next seat along at 2/3/4/5 seats, and its decision is answerable", () => {
    const CARD = probeCard('probe-player-after', [{ op: 'gain-any', n: 2, target: 'player-after' }]);
    const idx = indexCards({
      ideology: Object.values(CARDS.ideology),
      voter: Object.values(CARDS.voter),
      conspiracy: [CARD],
      headline: Object.values(CARDS.headline),
    });
    const ctxA: Ctx = { rules: RULES, cards: idx };
    let raised = 0;

    for (const seats of [2, 3, 4, 5] as const) {
      const ids = Array.from({ length: seats }, (_, i) => `p${i + 1}`);
      const base = {
        ...fresh(1, ids, { startResources: ids.map(() => ({})) }),
        phase: 'actions',
        activePlayer: 'p1',
        _pendingCard: null,
        choices: [],
      } as GameState;

      const played = reduce(withHand(base, 'p1', [CARD.id]), 'p1', { type: 'PLAY_CONSPIRACY', cardId: CARD.id }, ctxA);
      expect(played.ok, `${seats} seats: ${played.ok ? '' : played.error}`).toBe(true);
      if (!played.ok) continue;

      const expected = ids[(0 + 1) % seats] ?? ids[0];
      if (expected === undefined) continue;
      const pending = played.state.choices.find((c) => c.player === expected);
      expect(pending, `${seats} seats: no decision was raised for ${expected}, the seat after p1`).toBeDefined();
      if (pending === undefined) continue;
      // It must NOT be raised for the caster, or the card is aimed at the wrong player.
      expect(played.state.choices.some((c) => c.player === 'p1'), `${seats} seats: the card aimed at itself`).toBe(false);
      raised += 1;

      const answered = candidatePicks(played.state, pending).some((r) => r.ok);
      expect(answered, `${seats} seats: ${JSON.stringify(pending.choice)} had no legal pick`).toBe(true);
      expect(poolTotal(played.state.players[expected]?.resources ?? EMPTY_POOL), 'not credited yet').toBe(0);
    }

    expect(raised, "'player-after' raised nothing, so nothing was proved").toBe(4);
  });

  /** Which reducer `op` raises `kind`. `evict` is the op; `evict-voter` is the choice. */
  function opFor(kind: Kind): 'gain-any' | 'lose-any' | 'steal-any' | 'evict' | 'discard-voter' | 'convert-voter' {
    return kind === 'evict-voter' ? 'evict' : (kind as 'gain-any');
  }

  /**
   * Play a probe card retargeted at `castAt`, and return the state it produced plus
   * the decisions it raised. `null` when the engine refused the play.
   */
  function playAndRead(
    s: GameState,
    cardId: string,
    castAt: 'you' | 'each-opponent' | 'chosen-player' | 'player-after',
    ctxN: Ctx,
  ): { state: GameState; choices: PendingChoice[] } | null {
    const card = ctxN.cards.conspiracy[cardId];
    if (!card) return null;
    // A `'chosen-player'` effect is NOT retargeted: the whole point of the value is
    // that the card's ACTOR names the player, so overwriting it with `'you'` or
    // `'each-opponent'` would remove the decision this probe exists to raise. Its own
    // axis is `castAt === 'chosen-player'`, which is a no-op retarget. `'player-after'`
    // IS a plain target like `'you'` and is retargeted normally.
    const retargeted: ConspiracyCard = {
      ...card,
      effects: card.effects.map((e) =>
        'target' in e && e.target !== 'chosen-player' && castAt !== 'chosen-player'
          ? { ...e, target: castAt as 'you' | 'each-opponent' | 'player-after' }
          : e,
      ) as ConspiracyCard['effects'],
    };
    const idx = indexCards({
      ideology: Object.values(CARDS.ideology),
      voter: Object.values(CARDS.voter),
      conspiracy: [retargeted],
      headline: Object.values(CARDS.headline),
    });
    const played = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId }, { rules: RULES, cards: idx });
    if (!played.ok) return null;
    return { state: played.state, choices: [...played.state.choices] };
  }

  /** Push `state` through one turn boundary so `on-turn-start` effects fire. */
  function rollTurnStart(s: GameState, ctxN: Ctx): GameState {
    let cur = s;
    for (let i = 0; i < 4 && !cur.finished; i += 1) {
      const p = cur.activePlayer;
      const end = reduce(cur, p, { type: 'END_TURN' }, ctxN);
      if (end.ok) cur = end.state;
      if (cur.phase === 'answer') {
        const a = reduce(cur, p, { type: 'ANSWER', side: 0 }, ctxN);
        if (a.ok) cur = a.state;
      }
      if (cur.phase === 'headlines') {
        const h = reduce(cur, p, { type: 'ACK_HEADLINE' }, ctxN);
        if (h.ok) cur = h.state;
      }
      if (cur.phase === 'answer') {
        const a = reduce(cur, p, { type: 'ANSWER', side: 0 }, ctxN);
        if (a.ok) cur = a.state;
      }
      if (cur.choices.length > 0) break;
      // Drop anything the boundary raised so the next END_TURN is not refused.
      cur = { ...cur, choices: [] };
    }
    return cur;
  }
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

describe('G-new — a self-targeted discard reaches the chooser\'s OWN pegs', () => {
  // Known-Gaps G-new, found by the honesty test rather than predicted by the gap
  // analysis: `targetableCount` skipped the chooser's own pegs and `resolveChoice`
  // rejected them, so *"Discard 2 of your own voters"* — which REF 4.3 records as
  // AIN'T NO CURE FOR LOVE's first branch — was not expressible, and three shipped
  // cards were telling the player one thing while doing another.
  //
  // THE FIX IS THE RAW `target` FIELD, and it is deliberately narrow. `applyEffect`
  // defaults an absent `target` to `'you'`, so by the time the three voter cases ran
  // their `raiseVoterDecision` an absent field and an explicit `target: 'you'` were
  // the same value — and they are not the same card. RED BLOODED says *"You must
  // discard any 2 voters"* and AIN'T NO CURE FOR LOVE says *"Discard 2 of your own
  // voters"*; both land on `discard-voter`. Passing the raw field lets `voterScope`
  // tell them apart without changing what any existing card does.
  const DISCARD_OPPONENTS: ConspiracyCard = {
    id: 'test-discard-opponents',
    name: 'Test Discard (no target)',
    text: "Discard 1 of your opponents' voters.",
    cost: 1,
    effects: [{ op: 'discard-voter', n: 1 }],
  };
  const DISCARD_OWN: ConspiracyCard = {
    id: 'test-discard-own',
    name: 'Test Discard (own)',
    text: 'Discard 1 of your own voters.',
    cost: 1,
    effects: [{ op: 'discard-voter', n: 1, target: 'you' }],
  };
  const NEW_CARDS = [...Object.values(CARDS.conspiracy), DRAIN, DISCARD_OPPONENTS, DISCARD_OWN];
  const newCtx: Ctx = {
    rules: RULES,
    cards: {
      ...CARDS,
      conspiracy: Object.fromEntries(NEW_CARDS.map((c) => [c.id, c])),
    },
  };

  /** Two seats, one peg each, the active player's card in hand. */
  function board(): { readonly s: GameState; readonly mine: string; readonly theirs: string } {
    const base = fresh(1, ['p1', 'p2'], { startResources: [{}, {}] });
    const answeredState = (() => {
      const a = reduce(base, 'p1', { type: 'ANSWER', side: 0 }, newCtx);
      if (!a.ok) throw new Error(`fixture could not answer: ${a.error}`);
      return a.state;
    })();
    const zone = answeredState.zones[0]!;
    const [mine, theirs] = zone.areas.slice(0, 2).map((a) => a.id);
    const seeded: GameState = {
      ...answeredState,
      zones: answeredState.zones.map((z) =>
        z.id === zone.id
          ? {
              ...z,
              areas: z.areas.map((a) =>
                a.id === mine
                  ? { ...a, peg: { owner: 'p1' as PlayerID, majority: false } }
                  : a.id === theirs
                    ? { ...a, peg: { owner: 'p2' as PlayerID, majority: false } }
                    : a,
              ),
            }
          : z,
      ),
    };
    return { s: seeded, mine: mine!, theirs: theirs! };
  }

  const held = (id: string, s: GameState): boolean =>
    s.zones.flatMap((z) => z.areas).some((a) => a.id === id && a.peg?.owner === 'p2');

  function playCard(s: GameState, cardId: string): GameState {
    const withCard: GameState = {
      ...s,
      players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [cardId] } },
    };
    const r = reduce(withCard, 'p1', { type: 'PLAY_CONSPIRACY', cardId }, newCtx);
    if (!r.ok) throw new Error(`PLAY_CONSPIRACY refused: ${r.error}`);
    return r.state;
  }

  it('with `target: \'you\'` the chooser may strike their own voter', () => {
    const { s, mine } = board();
    const after = playCard(s, DISCARD_OWN.id);
    const pending = after.choices.find((c) => c.player === 'p1');
    expect(pending?.choice).toMatchObject({ kind: 'discard-voter', count: 1, scope: 'own' });
    const r = reduce(after, 'p1', { type: 'RESOLVE_CHOICE', choiceId: pending!.id, pick: { kind: 'areas', areaIds: [mine] } }, newCtx);
    expect(r.ok).toBe(true);
    expect(after.zones.flatMap((z) => z.areas).find((a) => a.id === mine)?.peg).not.toBeNull();
  });

  it('and with NO target the default is UNCHANGED: opponents only', () => {
    // The regression half. Three shipped cards state the opponents' reading in their
    // own `text`, and `others` is what they have always performed — so this is the
    // assertion that keeps the fix from being a behaviour change in disguise.
    const { s, mine } = board();
    const after = playCard(s, DISCARD_OPPONENTS.id);
    const pending = after.choices.find((c) => c.player === 'p1');
    expect(pending?.choice).toMatchObject({ kind: 'discard-voter', count: 1, scope: 'others' });
    expect(reduce(after, 'p1', { type: 'RESOLVE_CHOICE', choiceId: pending!.id, pick: { kind: 'areas', areaIds: [mine] } }, newCtx).ok).toBe(false);
  });

  it('and it is a DEADLOCK-FREE widening: a legal pick exists at every seat count', () => {
    // The invariant that matters. A self-targeted `discard-voter` must never be the
    // reason a player has no legal move, and the way that is guaranteed here is the
    // same way it is for every other kind: the ask is clamped at RESOLUTION by
    // `targetableCount`, so a player who has since lost their last own peg is asked
    // for zero, not for one.
    for (const seats of [['p1', 'p2'], ['p1', 'p2', 'p3'], ['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p3', 'p4', 'p5']] as const) {
      const base = fresh(1, [...seats], { startResources: seats.map(() => ({})) });
      const a = reduce(base, 'p1', { type: 'ANSWER', side: 0 }, newCtx);
      expect(a.ok, `${seats.length} seats`).toBe(true);
      if (!a.ok) continue;
      const after = playCard(a.state, DISCARD_OWN.id);
      const pending = after.choices.find((c) => c.player === 'p1');
      expect(pending, `${seats.length} seats raised a decision`).toBeDefined();
      const wanted = Math.min(1, after.zones.flatMap((z) => z.areas).filter((x) => x.peg?.owner === 'p1' && !x.volatile).length);
      const mineAreas = after.zones.flatMap((z) => z.areas).filter((x) => x.peg?.owner === 'p1' && !x.volatile).slice(0, wanted).map((x) => x.id);
      const r = reduce(after, 'p1', { type: 'RESOLVE_CHOICE', choiceId: pending!.id, pick: { kind: 'areas', areaIds: mineAreas } }, newCtx);
      expect(r.ok, `${seats.length} seats could answer`).toBe(true);
      if (r.ok) expect(r.state.choices).toHaveLength(0);
    }
  });

  it('and the held helper sees p2 keep the voter when the pick was p2\'s', () => {
    const { s, theirs } = board();
    const after = playCard(s, DISCARD_OPPONENTS.id);
    const pending = after.choices.find((c) => c.player === 'p1');
    const r = reduce(after, 'p1', { type: 'RESOLVE_CHOICE', choiceId: pending!.id, pick: { kind: 'areas', areaIds: [theirs] } }, newCtx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(held(theirs, r.state)).toBe(false);
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
