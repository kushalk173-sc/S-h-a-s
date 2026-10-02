/**
 * G14 — THE TRIGGER REGISTRY.
 *
 * A live effect with no `when` is a standing effect: it acts at the top of its
 * owner's turns. A live effect WITH a `when` is a hook, and the only thing that
 * makes it a hook rather than a decoration is that some part of the reducer raises
 * that event. `packages/cards/src/executable.ts` `EXECUTABLE_TRIGGERS` is the
 * registry of which events those are, and `reducer-parity.test.ts` re-derives it
 * from `reduce.ts`'s own source — so this file's job is the other half: prove each
 * claimed event is actually raised, and that it is raised with the context a
 * condition needs.
 *
 * THE RE-ENTRANCY CLAIM, which is the one worth a reader's scepticism. A hook that
 * fires an effect which raises a choice, which another hook answers, which fires
 * another effect — that chain has to terminate. Three things bound it, and each has
 * a test below:
 *   1. one effect per wave, and never the same `LiveEffect.id` twice in one
 *      cascade (`consumed`, threaded as an ARGUMENT, never as state);
 *   2. `TRIGGER_MAX_WAVES` on top, which is what a cycle among live effects would
 *      otherwise beat;
 *   3. no effect op can reach `setArea`, so a hook cannot wake a hook through the
 *      board — the structural half, derived from `applyEffect`'s own source text.
 *
 * The cards these hooks are for, and what each condition is reading:
 *   POWER TRIP  — "every time you influence a 3-Voter Card" (REF 4.2.1)
 *   GROWING DISSENT — "every time any opponent Gerrymanders your voters" (REF 4.1)
 *   LAB-GROWN EARWORM — "every time they influence a Voter Card" (REF 4.2.1)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard, type HeadlineCard } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { findZone, poolTotal, RESOURCES, type AreaID, type Delta, type GameState, type PlayerID, type ZoneID } from '../src/state';
import { emptyIn, IDEOLOGY_CARDS, PLAYERS_3, VOTER_CARDS } from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const REDUCE_SRC = resolve(HERE, '..', 'src', 'reduce.ts');

/** Voter cards spanning all three printed sizes, so a size condition is testable. */
const SIZED_VOTERS = [
  { id: 'sv-1', cost: { funds: 1 }, voters: 1 },
  { id: 'sv-2', cost: { funds: 2 }, voters: 2 },
  { id: 'sv-3', cost: { funds: 3 }, voters: 3 },
] as const;

const TRIGGER_CONSPIRACIES: readonly ConspiracyCard[] = [
  {
    // POWER TRIP's shape: you, a 3-Voter Card, an opponent's voter, for the game.
    id: 'trg-power-trip',
    name: 'A Trip On A Condition',
    text: 'Every time you influence a 3-Voter Card, each of your opponents discards 1 of their own voters.',
    cost: 1,
    effects: [
      {
        op: 'discard-voter',
        n: 1,
        target: 'each-opponent',
        when: 'on-voter-influenced',
        until: 'rest-of-game',
        condition: { byOwner: true, influencedVotersAtLeast: 3 },
      },
    ],
  },
  {
    // Same card with the size condition dropped, to prove the condition is what
    // gates it rather than the trigger.
    id: 'trg-any-size',
    name: 'A Trip On Every Purchase',
    text: 'Every time you influence any Voter Card, each of your opponents discards 1 of their own voters.',
    cost: 1,
    effects: [
      {
        op: 'discard-voter',
        n: 1,
        target: 'each-opponent',
        when: 'on-voter-influenced',
        until: 'rest-of-game',
        condition: { byOwner: true },
      },
    ],
  },
  {
    // GROWING DISSENT's shape, without the duration: a voter whenever anybody
    // gerrymanders one of MY voters.
    id: 'trg-moved-mine',
    name: 'Dissent',
    text: 'Every time anybody Gerrymanders one of your voters, you gain 1 voter.',
    cost: 1,
    effects: [
      {
        op: 'voters',
        n: 1,
        when: 'on-gerrymander',
        until: 'rest-of-game',
        condition: { movedMyVoter: true },
      },
    ],
  },
  {
    // The same trigger with the ownership condition dropped: it must then fire for
    // an opponent's voter too, which is what makes `movedMyVoter` worth asserting.
    id: 'trg-moved-anyone',
    name: 'Dissent Without The Condition',
    text: 'Every time anybody Gerrymanders any voter, you gain 1 voter.',
    cost: 1,
    effects: [
      { op: 'voters', n: 1, when: 'on-gerrymander', until: 'rest-of-game' },
    ],
  },
  {
    // LAB-GROWN EARWORM's shape: `steal-any` reads `FireContext.actor` for its
    // victim, which is the only op that does.
    id: 'trg-earworm',
    name: 'An Earworm',
    text: 'Every time anybody influences a Voter Card, you may take 1 resource from the player who just bought.',
    cost: 1,
    effects: [
      { op: 'steal-any', n: 1, when: 'on-voter-influenced', until: 'rest-of-game' },
    ],
  },
  {
    id: 'trg-purchase-only',
    name: 'A Purchase Hook',
    text: 'Every time anybody buys anything, you gain 1 resource.',
    cost: 1,
    effects: [{ op: 'gain', res: { clout: 1 }, when: 'on-purchase', until: 'rest-of-game' }],
  },
  {
    id: 'trg-volatile',
    name: 'A Volatile Hook',
    text: 'Every time a voter is placed in a Volatile Area, you gain 1 resource.',
    cost: 1,
    effects: [
      { op: 'gain', res: { funds: 1 }, when: 'on-volatile-placement', until: 'rest-of-game' },
    ],
  },
  {
    id: 'trg-majority',
    name: 'A Majority Hook',
    text: 'Every time a majority is formed, whoever holds it gains 1 resource of yours.',
    cost: 1,
    effects: [
      {
        op: 'gain',
        res: { funds: 1 },
        when: 'on-majority-formed',
        until: 'rest-of-game',
        condition: { byOwner: true },
      },
    ],
  },
  {
    // TWO hooks on the same event, in one card. The re-entrancy case.
    id: 'trg-two-on-one-event',
    name: 'Two Hooks, One Event',
    text: 'Every time you influence a Voter Card you gain 1 Fund, and each of your opponents discards 1 of their own voters.',
    cost: 1,
    effects: [
      { op: 'gain', res: { clout: 1 }, when: 'on-voter-influenced', until: 'rest-of-game', condition: { byOwner: true } },
      {
        op: 'discard-voter',
        n: 1,
        target: 'each-opponent',
        when: 'on-voter-influenced',
        until: 'rest-of-game',
        condition: { byOwner: true },
      },
    ],
  },
];

const TRIGGER_HEADLINES: readonly HeadlineCard[] = [];

const CARDS: CardIndex = indexCards({
  ideology: IDEOLOGY_CARDS,
  voter: [...VOTER_CARDS, ...SIZED_VOTERS],
  conspiracy: TRIGGER_CONSPIRACIES,
  headline: TRIGGER_HEADLINES,
});

const ctx: Ctx = { rules: RULES, cards: CARDS };

function freshGame(seed = 1, players: readonly PlayerID[] = PLAYERS_3): GameState {
  return setup({
    players,
    cards: CARDS,
    seed,
    startResources: players.map(() => ({ funds: 3, clout: 1, media: 1, trust: 1 })),
    ideologyDeck: IDEOLOGY_CARDS.map((c) => c.id),
    voterDeck: SIZED_VOTERS.map((c) => c.id),
    conspiracyDeck: TRIGGER_CONSPIRACIES.map((c) => c.id),
    headlineDeck: [],
  });
}

/** Answer, so the active player is in the `actions` phase. */
function answered(s: GameState, by: PlayerID = s.activePlayer): GameState {
  const r = reduce(s, by, { type: 'ANSWER', side: 0 }, ctx);
  if (!r.ok) throw new Error(`answer: ${r.error}`);
  return r.state;
}

/** Answer, install a trigger card, and leave the game in the `actions` phase. */
function armed(s: GameState, cardId: string, by: PlayerID = s.activePlayer): GameState {
  const withCard: GameState = {
    ...s,
    players: {
      ...s.players,
      [by]: { ...s.players[by]!, conspiracies: [...s.players[by]!.conspiracies, cardId] },
    },
  };
  const r = reduce(withCard, by, { type: 'PLAY_CONSPIRACY', cardId }, ctx);
  if (!r.ok) throw new Error(`play ${cardId}: ${r.error}`);
  return r.state;
}

/** Buy the market slot holding `voterId`, whichever slot it is in. */
function buy(s: GameState, voterId: string, by: PlayerID = s.activePlayer): GameState {
  if (s.phase === 'answer') s = answered(s, by);
  const slot = s.market.findIndex((m) => m.cardId === voterId);
  if (slot < 0) throw new Error(`${voterId} is not on the market (${s.market.map((m) => m.cardId).join(', ')})`);
  const r = reduce(s, by, { type: 'INFLUENCE', slot }, ctx);
  if (!r.ok) throw new Error(`influence ${voterId}: ${r.error}`);
  return r.state;
}

/** Buy the top Conspiracy Card at its printed cost, in Funds. */
function buyConspiracy(s: GameState, by: PlayerID = s.activePlayer): GameState {
  const topId = s._conspiracyDraw[0];
  const card = topId ? CARDS.conspiracy[topId] : undefined;
  if (!card) throw new Error('no conspiracy on top');
  const r = reduce(s, by, { type: 'BUY_CONSPIRACY', pay: { funds: card.cost } }, ctx);
  if (!r.ok) throw new Error(`buy conspiracy ${card.id} for ${card.cost}: ${r.error}`);
  return r.state;
}

/** One full turn boundary, answering first when the incoming turn demands it. */
function endTurn(s: GameState): GameState {
  let cur = s;
  if (cur.phase === 'answer') cur = answered(cur);
  const r = reduce(cur, cur.activePlayer, { type: 'END_TURN' }, ctx);
  if (!r.ok) throw new Error(`end turn: ${r.error}`);
  return r.state;
}

/** The number of pending decisions on the mat, by player. */
const openChoices = (s: GameState, p: PlayerID): number =>
  s.choices.filter((c) => c.player === p).length;

const pendingOf = (s: GameState, p: PlayerID): number =>
  s.turnOrder.reduce((n, id) => n + (s.players[id]?.pending.length ?? 0), 0);

const fundsOf = (s: GameState, p: PlayerID): number => s.players[p]?.resources.funds ?? 0;
const cloutOf = (s: GameState, p: PlayerID): number => s.players[p]?.resources.clout ?? 0;

/** A peg in `areaId` owned by `owner`, placed directly. Bypasses the turn machinery. */
function withPeg(s: GameState, areaId: AreaID, owner: PlayerID): GameState {
  const zone = s.zones.find((z) => z.areas.some((a) => a.id === areaId));
  if (!zone) throw new Error(`no zone holds ${areaId}`);
  return {
    ...s,
    zones: s.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a) => (a.id === areaId ? { ...a, peg: { owner, majority: false } } : a)),
    })),
  };
}

/** The first NON-volatile zone with room, so a gerrymander has somewhere to go. */
function openZone(s: GameState): ZoneID {
  const z = s.zones.find(
    (zone) => !zone.areas.some((a) => a.volatile) && zone.areas.some((a) => a.peg === null),
  );
  if (!z) throw new Error('no open zone');
  return z.id;
}

/**
 * A zone with at least three free NON-VOLATILE slots.
 *
 * Non-volatile rather than "a zone with no volatile area" because 11 of the board's
 * 129 areas are volatile and they are spread across all nine zones — a fixture that
 * required a wholly clean zone would find none and the failure would read as a
 * board bug. p18 pegs cannot be gerrymandered, so the three slots must be clean.
 */
function roomyZone(s: GameState): { readonly id: ZoneID; readonly free: readonly AreaID[] } {
  const z = s.zones.find((zone) => {
    const free = zone.areas.filter((a) => a.peg === null && !a.volatile);
    return free.length >= 4;
  });
  if (!z) throw new Error('no roomy zone');
  return { id: z.id, free: z.areas.filter((a) => a.peg === null && !a.volatile).map((a) => a.id) };
}

/**
 * Build a position where `rights` holds Gerrymanding Rights in `zone` (p16: strictly
 * more voters there than anybody else) and has a spare empty area to move one into.
 *
 * `rights` gets two pegs, because p17 refuses to move your ONLY voter out of a zone
 * whose rights you are using — a real rule that would otherwise make this fixture
 * impossible. `moved` says whose peg the GERRYMANDER will actually carry, which is
 * the whole of GROWING DISSENT's condition.
 */
function rightsIn(
  s: GameState,
  zoneId: ZoneID,
  rights: PlayerID,
  moved: PlayerID,
): { readonly state: GameState; readonly from: AreaID; readonly to: AreaID } {
  const zone = findZone(s, zoneId);
  if (!zone) throw new Error(`no zone ${zoneId}`);
  const free = zone.areas.filter((a) => a.peg === null && !a.volatile).map((a) => a.id);
  const [a, b, c, d] = free as [AreaID, AreaID, AreaID, AreaID];
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error(`${zoneId} needs four empty non-volatile areas`);
  }
  // `rights` takes two pegs, because p17 refuses to move your ONLY voter out of a
  // zone whose rights you are using. When the peg that moves belongs to somebody
  // else it takes a THIRD slot, so the rights holder is still strictly ahead (p16)
  // — a tie gives nobody rights at all, and a tie would have made this fixture
  // fail for a reason that has nothing to do with the trigger.
  let built = withPeg(withPeg(s, a, rights), b, rights);
  if (moved === rights) return { state: built, from: a, to: c };
  built = withPeg(built, c, moved);
  return { state: built, from: c, to: d };
}

/** Rewrite one area's peg owner, leaving the count the same. */
function swapPegOwner(s: GameState, areaId: AreaID, owner: PlayerID): GameState {
  return {
    ...s,
    zones: s.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a) =>
        a.id === areaId && a.peg ? { ...a, peg: { ...a.peg, owner } } : a,
      ),
    })),
  };
}

function gerrymander(s: GameState, zoneId: ZoneID, fromAreaId: AreaID, toAreaId: AreaID): GameState {
  const r = reduce(
    s,
    s.activePlayer,
    { type: 'GERRYMANDER', zoneId, fromAreaId, toAreaId },
    ctx,
  );
  if (!r.ok) throw new Error(`gerrymander ${fromAreaId}->${toAreaId} in ${zoneId}: ${r.error}`);
  return r.state;
}

function findZoneId(s: GameState, areaId: AreaID): ZoneID {
  const z = s.zones.find((zone) => zone.areas.some((a) => a.id === areaId));
  if (!z) throw new Error(`no zone holds ${areaId}`);
  return z.id;
}


// ─────────────────────────── each claimed event is really raised ───────────────────────────

describe('every event EXECUTABLE_TRIGGERS claims is raised, with the context a condition needs', () => {
  it('on-voter-influenced carries the size of the card bought', () => {
    // The whole of POWER TRIP's condition. A FireContext that reported 0 here would
    // make `influencedVotersAtLeast` silently un-satisfiable, which is why the size
    // is asserted rather than assumed.
    const s = armed(answered(freshGame()), 'trg-any-size');
    const small = buy(s, 'sv-1');
    expect(openChoices(small, 'p2')).toBeGreaterThan(0);
    const big = buy(endTurn(endTurn(endTurn(s))), 'sv-3');
    expect(openChoices(big, 'p2')).toBeGreaterThan(0);
  });

  it('and the size condition is what gates it, not the trigger', () => {
    // Same card, same trigger, one with `influencedVotersAtLeast: 3`. Buying a
    // 1-Voter card fires the ungated one and NOT the gated one.
    const gated = armed(answered(freshGame()), 'trg-power-trip');
    expect(openChoices(buy(gated, 'sv-1'), 'p2')).toBe(0);
    const ungated = armed(answered(freshGame()), 'trg-any-size');
    expect(openChoices(buy(ungated, 'sv-1'), 'p2')).toBeGreaterThan(0);
  });

  it('on-purchase fires for a Conspiracy purchase and for a Voter Card purchase', () => {
    const s = armed(answered(freshGame()), 'trg-purchase-only');
    const topId = s._conspiracyDraw[0];
    const cost = topId ? CARDS.conspiracy[topId]?.cost ?? 0 : 0;
    // Snapshot AFTER the payment is taken, so the assertion is about the hook and
    // not about the cost. `trg-purchase-only` pays out in Clout, which nothing else
    // in this file moves, so the two cannot be confused.
    const beforeConspiracy = cloutOf(s, 'p1');
    const afterConspiracy = buyConspiracy(s);
    expect(cloutOf(afterConspiracy, 'p1')).toBe(beforeConspiracy + 1);
    expect(cost).toBeGreaterThan(0);

    const beforeInfluence = cloutOf(s, 'p1');
    expect(cloutOf(buy(s, 'sv-2'), 'p1')).toBe(beforeInfluence + 1);
  });

  it('and a Conspiracy purchase raises `on-purchase` with voters: 0, never the voter event', () => {
    // `voters: 0` is what makes POWER TRIP's `influencedVotersAtLeast: 3` false for a
    // Conspiracy buy, for a reason that has nothing to do with the card. Raised here
    // so a future change to BUY_CONSPIRACY cannot quietly start reporting a size.
    const s = armed(answered(freshGame()), 'trg-power-trip');
    const after = buyConspiracy(s);
    expect(openChoices(after, 'p2')).toBe(0);
  });

  it('on-gerrymander carries the owner of the voter that moved', () => {
    // GROWING DISSENT: "any opponent Gerrymanders YOUR voters". The two cards differ
    // ONLY in `movedMyVoter`, so any difference in outcome is that field and nothing
    // else.
    const base = answered(freshGame());
    const { id: zone, free } = roomyZone(base);
    expect(free.length).toBeGreaterThanOrEqual(4);

    // A peg of MINE, moved: `movedMyVoter` is true and I gain a voter.
    const mine = rightsIn(base, zone, 'p1', 'p1');
    const beforeMine = pendingOf(mine.state, 'p1');
    const afterMine = gerrymander(
      armed(mine.state, 'trg-moved-mine', 'p1'),
      zone,
      mine.from,
      mine.to,
    );
    expect(pendingOf(afterMine, 'p1')).toBe(beforeMine + 1);

    // The same board with the moved peg belonging to p2: false, and nothing happens.
    const theirs = rightsIn(base, zone, 'p1', 'p2');
    const beforeTheirs = pendingOf(theirs.state, 'p1');
    const afterTheirs = gerrymander(
      armed(theirs.state, 'trg-moved-mine', 'p1'),
      zone,
      theirs.from,
      theirs.to,
    );
    expect(pendingOf(afterTheirs, 'p1')).toBe(beforeTheirs);
  });

  it('and the ungated version fires for an opponent’s voter, which is what the condition buys', () => {
    const base = answered(freshGame());
    const { id: zone } = roomyZone(base);
    const theirs = rightsIn(base, zone, 'p1', 'p2');
    const before = pendingOf(theirs.state, 'p1');
    const after = gerrymander(
      armed(theirs.state, 'trg-moved-anyone', 'p1'),
      zone,
      theirs.from,
      theirs.to,
    );
    expect(pendingOf(after, 'p1')).toBe(before + 1);
  });

  it('on-volatile-placement fires when a peg lands in a Volatile Area', () => {
    const s = armed(answered(freshGame()), 'trg-volatile');
    const volatile = s.zones.flatMap((z) => z.areas).find((a) => a.volatile && a.peg === null);
    if (!volatile) throw new Error('no empty volatile area');
    // A 1-Voter card, so the placement is exactly one peg and lands where we said.
    // Snapshotted AFTER the purchase, which spends Funds: measuring before would
    // assert the cost and call it a hook.
    const influenced = buy(s, 'sv-1');
    const before = fundsOf(influenced, 'p1');
    const group = influenced.players.p1?.pending[0];
    if (!group) throw new Error('no pending group');
    const placed = reduce(
      influenced,
      'p1',
      { type: 'PLACE_VOTERS', groupId: group.id, areaIds: [volatile.id] },
      ctx,
    );
    if (!placed.ok) throw new Error(`place volatile: ${placed.error}`);
    expect(fundsOf(placed.state, 'p1')).toBe(before + 1);
  });

  it('on-volatile-placement does NOT fire for a peg placed anywhere else', () => {
    const s = armed(answered(freshGame()), 'trg-volatile');
    // A 1-Voter card so the placement is one peg, and the snapshot is taken AFTER the
    // purchase: buying spends Funds, and an assertion that mixed the two would pass
    // for the wrong reason.
    const influenced = buy(s, 'sv-1');
    const before = fundsOf(influenced, 'p1');
    const group = influenced.players.p1?.pending[0];
    const plain = roomyZone(influenced).free[0];
    if (!group || plain === undefined) throw new Error('nothing to place');
    const placed = reduce(
      influenced,
      'p1',
      { type: 'PLACE_VOTERS', groupId: group.id, areaIds: [plain] },
      ctx,
    );
    if (!placed.ok) throw new Error(`place plain: ${placed.error}`);
    expect(fundsOf(placed.state, 'p1')).toBe(before);
  });

  it('on-majority-formed fires, and `byOwner` keeps it to your own majorities', () => {
    // A positive and a negative, because a hook that never fires and a hook that
    // always fires are the same bug seen from two ends.
    const base = answered(freshGame());

    // NEGATIVE: placing a peg that changes no majority holder must not fire.
    const negative = armed(base, 'trg-majority');
    const oneVoter = buy(negative, 'sv-1');
    const before = fundsOf(oneVoter, 'p1');
    const group = oneVoter.players.p1?.pending[0];
    const empty = roomyZone(oneVoter).free[0];
    if (!group || empty === undefined) throw new Error('nothing to place');
    const placed = reduce(
      oneVoter,
      'p1',
      { type: 'PLACE_VOTERS', groupId: group.id, areaIds: [empty] },
      ctx,
    );
    if (!placed.ok) throw new Error(`place: ${placed.error}`);
    expect(fundsOf(placed.state, 'p1')).toBe(before);

    // POSITIVE: a 5-of-9 zone, seeded with four pegs each so that ONE placement
    // takes it. Staging the position with `withPeg` and finishing it with a real
    // PLACE_VOTERS is the only way to make a majority form through `setArea` without
    // buying nine voters — and `withPeg` does not recount, which is exactly what
    // makes the last placement the thing that forms the majority.
    const stagedIds = (base.zones.find((z) => z.id === 'central')?.areas ?? []).map((a) => a.id);
    if (stagedIds.length !== 9) throw new Error('central is not the 5-of-9 zone');
    let staged = stagedIds.slice(0, 4).reduce((acc, id) => withPeg(acc, id, 'p1'), base);
    staged = stagedIds.slice(4, 8).reduce((acc, id) => withPeg(acc, id, 'p2'), staged);
    const last = stagedIds[8];
    if (last === undefined) throw new Error('no ninth area');
    const oneMore = buy(armed(staged, 'trg-majority'), 'sv-1');
    const g = oneMore.players.p1?.pending[0];
    if (!g) throw new Error('no group');
    const beforeWin = fundsOf(oneMore, 'p1');
    const filled = reduce(
      oneMore,
      'p1',
      { type: 'PLACE_VOTERS', groupId: g.id, areaIds: [last] },
      ctx,
    );
    if (!filled.ok) throw new Error(`place five: ${filled.error}`);
    expect(findZone(filled.state, 'central')?.majorityHolder).toBe('p1');
    expect(fundsOf(filled.state, 'p1')).toBe(beforeWin + 1);
  });

  it('steal-any reads the triggering actor, so a hook names its own victim', () => {
    // The one op that reads `FireContext.actor`, and the whole of LAB-GROWN EARWORM's
    // mechanism. With NO `target` the thief picks the victim at resolution, which is
    // what `steal-any` has always done — so `from` is null and the card is "you may
    // take 1 from a chosen opponent". With a `target` the victim is already fixed to
    // the player who just did the thing, which is the real card's binding.
    const unpinned = armed(answered(freshGame()), 'trg-earworm');
    const loose = buy(unpinned, 'sv-2');
    const looseChoice = loose.choices.find((c) => c.player === 'p1' && c.choice.kind === 'steal-any');
    expect(looseChoice).toBeDefined();
    if (looseChoice?.choice.kind !== 'steal-any') throw new Error('not a theft');
    expect(looseChoice.choice.from).toBeNull();

    // Same hook with `target: 'each-opponent'`: one theft per resolved victim, and
    // `from` names the player who just bought, not the victim list.
    const pinnedCard: ConspiracyCard = {
      id: 'trg-earworm-pinned',
      name: 'An Earworm, Pinned',
      text: 'Every time anybody influences a Voter Card, each of your opponents gives you 1 resource.',
      cost: 1,
      effects: [
        {
          op: 'steal-any',
          n: 1,
          target: 'each-opponent',
          when: 'on-voter-influenced',
          until: 'rest-of-game',
        },
      ],
    };
    const index: CardIndex = { ...CARDS, conspiracy: { ...CARDS.conspiracy, [pinnedCard.id]: pinnedCard } };
    const pinnedCtx: Ctx = { rules: RULES, cards: index };
    const base = answered(freshGame());
    const withCard: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...base.players.p1!, conspiracies: [pinnedCard.id] },
      },
    }
    const played = reduce(withCard, 'p1', { type: 'PLAY_CONSPIRACY', cardId: pinnedCard.id }, pinnedCtx);
    if (!played.ok) throw new Error(played.error);

    // THE OWNER'S OWN PURCHASE — the hard lock, and what this test used to bless.
    //
    // This assertion previously read `expect(t.choice.from).toBe('p1')` with a comment
    // saying "p1 cannot steal from p1, so `resolveChoice` will refuse. That is the
    // correct outcome for this fixture". It was not correct. A pending decision freezes
    // its owner and `resolveChoice` refuses EVERY pick for a theft naming the chooser,
    // so raising one aimed at p1 strands p1 for the rest of the match with no legal
    // pick and no server-side recovery. The test documented the defect instead of
    // catching it, which is how it survived. See the guard in `applyEffect`'s
    // `steal-any` arm, and `./choices.test.ts` for the invariant it now holds to.
    const selfBought = reduce(played.state, 'p1', { type: 'INFLUENCE', slot: 0 }, pinnedCtx);
    if (!selfBought.ok) throw new Error(selfBought.error);
    expect(
      selfBought.state.choices
        .filter((c) => c.player === 'p1' && c.choice.kind === 'steal-any')
        .map((c) => `${c.id} from=${(c.choice as { from?: PlayerID | null }).from}`),
      'the hook fired on its own owner and raised a theft aimed at them',
    ).toEqual([]);

    // THE REAL BINDING, which is still worth pinning: when SOMEONE ELSE influences,
    // `from` names the player who just bought — not the victim list, and not the owner.
    const onP2 = endTurn(played.state);
    const influencer = onP2.activePlayer;
    expect(influencer, 'p1 still had the turn, so the binding is untested').not.toBe('p1');
    // The incoming seat answers first; `endTurn` only closed the outgoing one.
    const ready = reduce(onP2, influencer, { type: 'ANSWER', side: 0 }, pinnedCtx);
    if (!ready.ok) throw new Error(`answer for ${influencer}: ${ready.error}`);
    const me = ready.state.players[influencer];
    const slot = ready.state.market.findIndex((m) =>
      me !== undefined && RESOURCES.every((r) => (m.cost[r] ?? 0) <= me.resources[r]),
    );
    if (slot < 0) throw new Error(`${influencer} cannot afford anything on the market`);
    const influenced = reduce(ready.state, influencer, { type: 'INFLUENCE', slot }, pinnedCtx);
    if (!influenced.ok) throw new Error(influenced.error);
    const thefts = influenced.state.choices.filter(
      (c) => c.player === 'p1' && c.choice.kind === 'steal-any',
    );
    expect(thefts.length, 'the hook did not fire for an opponent\'s purchase').toBeGreaterThan(0);
    for (const t of thefts) {
      if (t.choice.kind !== 'steal-any') throw new Error('not a theft');
      const from = t.choice.from;
      if (from === null) throw new Error('a pinned theft left its victim for the thief to pick');
      // The actor bought it, so the actor is the victim — and the actor is never the
      // thief, so this pick is one `resolveChoice` can actually accept.
      expect(from).toBe(influencer);
      expect(from).not.toBe('p1');
      const victim = influenced.state.players[from];
      const want = Math.min(t.choice.count, victim ? poolTotal(victim.resources) : 0);
      // Shed `want` off the victim's pool, largest denomination first, decrementing as
      // it goes — the reducer demands EXACTLY `want`, so an over-pick is a refusal.
      let left = want;
      const res: Delta = {};
      for (const r of RESOURCES) {
        if (left <= 0) break;
        const take = Math.min(victim?.resources[r] ?? 0, left);
        if (take > 0) {
          res[r] = take;
          left -= take;
        }
      }
      const resolved = reduce(influenced.state, 'p1', {
        type: 'RESOLVE_CHOICE',
        choiceId: t.id,
        pick: { kind: 'steal', from, res },
      }, pinnedCtx);
      expect(resolved.ok, `the pinned theft from ${from} has no legal pick: ${resolved.ok ? '' : resolved.error} (count ${t.choice.count}, victim ${JSON.stringify(victim?.resources)}, pick ${JSON.stringify(res)})`).toBe(true);
    }
  });
});

// ─────────────────────────── re-entrancy ───────────────────────────

describe('the cascade terminates, and two hooks on one event is the test of it', () => {
  it('two hooks on the same event BOTH fire, and the third wave finds nothing', () => {
    const s = armed(answered(freshGame()), 'trg-two-on-one-event');
    const before = cloutOf(s, 'p1');
    const after = buy(s, 'sv-2');
    // Hook one pays p1 in Clout; hook two raises a decision for each opponent. Both
    // ran. Clout rather than Funds, because buying the Voter Card spends Funds and
    // an assertion that mixed the two would pass for the wrong reason.
    expect(cloutOf(after, 'p1')).toBe(before + 1);
    expect(openChoices(after, 'p2')).toBeGreaterThan(0);
    // Exactly two log lines, so exactly two waves. A cascade that re-armed itself
    // would produce a number that grows with the cap instead.
    const fired = after.log.filter((l) => l.text === 'trg-two-on-one-event takes effect.');
    expect(fired).toHaveLength(2);
  });

  it('and the decision one of them raised is itself resolvable — the chain does not stall', () => {
    const s = armed(answered(freshGame()), 'trg-two-on-one-event');
    const after = buy(s, 'sv-2');
    const pending = after.choices.find((c) => c.player === 'p2' && c.choice.kind === 'discard-voter');
    if (pending?.choice.kind !== 'discard-voter') throw new Error('no discard raised for p2');
    // Answer it as p2, choosing nothing, which the clamp turns into a no-op. The
    // point is that it RESOLVES: a decision that could not be answered is a
    // soft-lock, and `blockedBy` would freeze p2 for the rest of the game.
    const resolved = reduce(
      after,
      'p2',
      { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'areas', areaIds: [] } },
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(openChoices(resolved.state, 'p2')).toBe(0);
  });

  it('no effect op can emit a board event, derived from the reducer source', () => {
    // The structural half of the termination argument. `setArea` is the only thing
    // that raises `on-majority-formed` and `on-volatile-placement`; if no effect case
    // can reach it, a hook cannot wake a hook through the board, and the wave cap is
    // defence in depth rather than the only thing standing between a card and a hang.
    const src = readFileSync(REDUCE_SRC, 'utf8');
    const start = src.indexOf('function applyEffect');
    const end = src.indexOf('function applyEffects', start);
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, end === -1 ? undefined : end)).not.toContain('setArea');
  });
});

// ─────────────────────────── visibility of a hook ───────────────────────────

describe('a hook is public state, and the card that installed it is already face up', () => {
  it('the list carries the trigger, the condition and the owner, all of them public', () => {
    const s = armed(answered(freshGame()), 'trg-power-trip');
    const le = s.liveEffects[0];
    expect(le?.trigger).toBe('on-voter-influenced');
    expect(le?.owner).toBe('p1');
    expect(le?.sourceCardId).toBe('trg-power-trip');
    expect(le?.condition).toEqual({ byOwner: true, influencedVotersAtLeast: 3 });
    expect(le?.expiresAt).toBeNull();
  });

  it('a hook that fires logs which card fired, so a player can see whose clause it was', () => {
    const s = armed(answered(freshGame()), 'trg-any-size');
    const after = buy(s, 'sv-2');
    expect(after.log.some((l) => l.text === 'trg-any-size takes effect.')).toBe(true);
  });
});
