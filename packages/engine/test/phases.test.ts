/**
 * §3.8 HEADLINE QUEUE AND §3.10 PHASE / TURN-ORDERING INVARIANTS.
 *
 * Headlines are the one place where an action is legal for a player who is not
 * the active one, so the phase guards around them are worth pinning precisely.
 */

import { describe, expect, it } from 'vitest';

import type { Action, ChoicePick } from '../src/actions';
import type { Effect } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import type { GameState, PlayerID } from '../src/state';
import { answered, areaOf, plainFreeIn, setAreaState, withPegs } from './boardkit';
import { fresh, makeCtx } from './helpers';

const ctx: Ctx = makeCtx();

function act(s: GameState, p: PlayerID, a: Action) {
  return reduce(s, p, a, ctx);
}

function step(s: GameState, p: PlayerID, a: Action): GameState {
  const r = reduce(s, p, a, ctx);
  if (!r.ok) throw new Error(`${p} ${JSON.stringify(a)} -> ${r.error}`);
  return r.state;
}

function giveGroup(s: GameState, p: PlayerID, count: number, sameZone: boolean): GameState {
  const cur = s.players[p];
  if (!cur) throw new Error(`no ${p}`);
  const id = `g${s._idSeq + 1}`;
  return {
    ...s,
    players: {
      ...s.players,
      [p]: {
        ...cur,
        pending: [...cur.pending, { id, count, sameZone, source: 'test' }],
      },
    },
  };
}

function freeIn(s: GameState, zone: string, n: number): string[] {
  const z = s.zones.find((x) => x.id === zone);
  if (!z) return [];
  return z.areas.filter((a) => a.peg === null).map((a) => a.id).slice(0, n);
}

function volatileIds(s: GameState, zone: string, n: number): string[] {
  const z = s.zones.find((x) => x.id === zone);
  if (!z) return [];
  return z.areas.filter((a) => a.peg === null && a.volatile).map((a) => a.id).slice(0, n);
}

describe('headline queue', () => {
  it('each voter placed in a Volatile Area queues exactly one Headline', () => {
    // rules-reference.md:272-273.
    const base = answered(fresh(1), 'p1');
    // west has 2 Volatile Areas, so a group of 2 can go there.
    const ids = volatileIds(base, 'west', 2);
    expect(ids.length).toBeGreaterThan(0);
    let s = giveGroup(base, 'p1', ids.length, true);
    const r = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: ids });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.headlineQueue).toEqual(ids.map((areaId) => ({ areaId, by: 'p1' })));
  });

  it('the queue drains in the order the voters were placed', () => {
    const base = answered(fresh(1), 'p1');
    const west = volatileIds(base, 'west', 2);
    const central = volatileIds(base, 'central', 1);
    if (west.length < 2 || central.length < 1) throw new Error('expected Volatile Areas');

    let s = giveGroup(base, 'p1', 2, true);
    const g = s.players.p1?.pending[0]?.id ?? '';
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: west });
    s = giveGroup(s, 'p1', 1, true);
    const g2 = s.players.p1?.pending[0]?.id ?? '';
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: g2, areaIds: central });
    expect(s.headlineQueue.map((q) => q.areaId)).toEqual([...west, ...central]);

    s = step(s, 'p1', { type: 'END_TURN' });
    expect(s.phase).toBe('headlines');
    const drained: string[] = [];
    while (s.phase === 'headlines') {
      const card = s.activeHeadline;
      if (!card) throw new Error('headlines phase with no active card');
      drained.push(card);
      s = step(s, s.activePlayer, { type: 'ACK_HEADLINE' });
    }
    expect(drained).toHaveLength(3);
    // The log records them in order, and the queue is empty at the end.
    const headlines = s.log.filter((l) => l.text.startsWith('HEADLINE'));
    expect(headlines).toHaveLength(3);
    expect(s.headlineQueue).toEqual([]);
  });

  it('placing a NON-volatile voter queues nothing', () => {
    const base = answered(fresh(1), 'p1');
    const ids = plainFreeIn(base, 'central', 1);
    if (!ids[0]) throw new Error('setup');
    let s = giveGroup(base, 'p1', 1, true);
    const r = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [ids[0]] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.headlineQueue).toEqual([]);
    expect(r.events.some((e) => e.type === 'volatile')).toBe(false);
  });

  it('Headlines resolve only AFTER the turn ends', () => {
    const base = answered(fresh(1), 'p1');
    const ids = volatileIds(base, 'west', 1);
    if (!ids[0]) throw new Error('setup');
    let s = giveGroup(base, 'p1', 1, true);
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [ids[0]] });
    expect(s.phase).toBe('actions');
    const early = act(s, 'p1', { type: 'ACK_HEADLINE' });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error).toBe('there is no Headline to resolve');
  });

  it('END_TURN is refused while headlines are pending', () => {
    const base = answered(fresh(1), 'p1');
    const ids = volatileIds(base, 'west', 1);
    if (!ids[0]) throw new Error('setup');
    let s = giveGroup(base, 'p1', 1, true);
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [ids[0]] });
    s = step(s, 'p1', { type: 'END_TURN' });
    expect(s.phase).toBe('headlines');
    const r = act(s, s.activePlayer, { type: 'END_TURN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('resolve the Headline first');
  });

  it('END_TURN with an empty queue goes straight to the next player', () => {
    const s = step(answered(fresh(1), 'p1'), 'p1', { type: 'END_TURN' });
    expect(s.headlineQueue).toEqual([]);
    expect(s.activePlayer).toBe('p2');
    expect(s.phase).toBe('answer');
    expect(s.log.some((l) => l.text.startsWith('HEADLINE'))).toBe(false);
  });

  it('a resolved Headline card is discarded', () => {
    const base = answered(fresh(1), 'p1');
    const ids = volatileIds(base, 'west', 1);
    if (!ids[0]) throw new Error('setup');
    let s = giveGroup(base, 'p1', 1, true);
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [ids[0]] });
    s = step(s, 'p1', { type: 'END_TURN' });
    const card = s.activeHeadline;
    if (!card) throw new Error('no headline drawn');
    expect(s._headlineDiscard).not.toContain(card);
    s = step(s, s.activePlayer, { type: 'ACK_HEADLINE' });
    expect(s._headlineDiscard).toContain(card);
  });

  it('if the Headline deck is empty the queue is dropped and the turn advances', () => {
    // The branch that prevents a permanent soft-lock.
    const base = answered(fresh(1), 'p1');
    const ids = volatileIds(base, 'west', 1);
    if (!ids[0]) throw new Error('setup');
    let s: GameState = {
      ...base,
      _headlineDraw: [],
      _headlineDiscard: [],
    };
    s = giveGroup(s, 'p1', 1, true);
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [ids[0]] });
    expect(s.headlineQueue).toHaveLength(1);
    s = step(s, 'p1', { type: 'END_TURN' });
    // No card to draw: the queue is dropped and the turn advances, not stuck.
    expect(s.headlineQueue).toEqual([]);
    expect(s.phase).not.toBe('headlines');
    expect(s.activePlayer).toBe('p2');
  });

  it('a Headline targeting opponents raises choices for THEM, resolvable mid-queue', () => {
    // hed-01 gives each opponent 1 Media via a `gain`, which is direct — use a
    // Headline that raises a decision instead: PLAY_CONSPIRACY out of turn is
    // scoped to the answer phase, so the decision path here is a Cap choice that
    // an opponent already owns.
    const base = answered(fresh(1), 'p1');
    const s: GameState = {
      ...base,
      phase: 'headlines',
      activeHeadline: 'hed-01',
      headlineQueue: [{ areaId: 'central-01', by: 'p1' }],
      _pendingCard: null,
      players: {
        ...base.players,
        p2: { ...base.players.p2!, resources: { funds: 12, clout: 12, media: 0, trust: 0 } },
      },
    };
    const r = step(s, 'p1', { type: 'ACK_HEADLINE' });
    // hed-01 gives each opponent 1 Media; p2 is at 24, so the Cap fires for p2.
    const forP2 = r.choices.filter((c) => c.player === 'p2');
    expect(forP2).toHaveLength(1);
    if (!forP2[0]) throw new Error('no choice');
    // p2 is at 24, gains 1 Media, and the cap is a TOTAL (p12, §16 #3), so the
    // excess is 25 - 12 = 13.
    expect(forP2[0].choice).toEqual({ kind: 'lose-any', count: 13, reason: 'Resource cap' });

    // A non-active player may resolve their own decision.
    const pick: ChoicePick = { kind: 'resources', res: { funds: 12, clout: 1 } };
    const done = act(r, 'p2', { type: 'RESOLVE_CHOICE', choiceId: forP2[0].id, pick });
    expect(done.ok).toBe(true);
  });

  it('an unplaced Voter Card group is discarded at end of turn', () => {
    // p10 / rules-reference.md:165.
    const base = answered(fresh(1), 'p1');
    const s = giveGroup(base, 'p1', 3, true);
    expect(s.players.p1?.pending).toHaveLength(1);
    const t = step(s, 'p1', { type: 'END_TURN' });
    expect(t.players.p1?.pending).toEqual([]);
    expect(t.log.some((l) => l.text === '3 unplaced voters discarded.')).toBe(true);
  });

  it('a partial placement leaves the remainder on the mat', () => {
    // A non-Voter-Card group (sameZone false) may be placed in part.
    const base = answered(fresh(1), 'p1');
    let s = giveGroup(base, 'p1', 3, false);
    const g = s.players.p1?.pending[0]?.id ?? '';
    const ids = freeIn(s, 'central', 2);
    if (ids.length < 2) throw new Error('setup');
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: ids });
    expect(s.players.p1?.pending[0]?.count).toBe(1);
  });

  it('END_TURN is blocked by YOUR decision, not by an opponent\'s', () => {
    // R7, ruled and fixed. rules-reference.md:140 (p12) freezes only "you": "You
    // cannot take any other actions until you do so." The check used to be
    // `state.choices.length > 0`, so p1 could not end their turn while p2 had
    // anything pending — and p19 lets any player drop a decision on anyone in the
    // pre-answer window, so that was a real stall, not a theoretical one.
    //
    // The regression is the first assertion: before the fix this returned
    // `there are unresolved decisions` and the turn never advanced.
    const base = answered(fresh(1), 'p1');
    const s: GameState = {
      ...base,
      choices: [{ id: 'c9', player: 'p2', choice: { kind: 'lose-any', count: 1, reason: 'test' } }],
    };
    const r = act(s, 'p1', { type: 'END_TURN' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The turn moved on, and p2's decision is still theirs to resolve.
    expect(r.state.activePlayer).toBe('p2');
    expect(r.state.phase).toBe('answer');
    expect(r.state.choices.map((c) => c.player)).toEqual(['p2']);
  });

  it('a player frozen by their OWN decision still cannot end their turn', () => {
    // The half of R7 that must not change: the freeze is real, it is just scoped
    // to the player who is frozen. p1 is blocked by the per-player freeze at the
    // top of `reduce` before the END_TURN case is even reached.
    const base = answered(fresh(1), 'p1');
    const s: GameState = {
      ...base,
      choices: [{ id: 'c8', player: 'p1', choice: { kind: 'lose-any', count: 1, reason: 'test' } }],
    };
    const r = act(s, 'p1', { type: 'END_TURN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('resolve "test" first');

    // Resolving it unblocks the turn.
    const resolved = reduce(
      s,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: 'c8', pick: { kind: 'resources', res: { funds: 1 } } },
      ctx,
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const after = act(resolved.state, 'p1', { type: 'END_TURN' });
    expect(after.ok).toBe(true);
  });
});

describe('phase and turn ordering', () => {
  it('a non-active player is refused every action except RESOLVE_CHOICE and the pre-answer window', () => {
    const s = answered(fresh(1), 'p1');
    const others = s.turnOrder.filter((p) => p !== s.activePlayer);
    expect(others.length).toBeGreaterThan(0);
    const other = others[0] as string;

    const every: readonly Action[] = [
      { type: 'REDRAW_IDEOLOGY', pay: { funds: 4 } },
      { type: 'ANSWER', side: 0 },
      { type: 'INFLUENCE', slot: 0 },
      { type: 'PLACE_VOTERS', groupId: 'g1', areaIds: [] },
      { type: 'GERRYMANDER', zoneId: 'central', fromAreaId: 'central-01', toAreaId: 'central-02' },
      { type: 'TRADE', withPlayer: 'p1', give: { funds: 1 }, receive: { funds: 1 } },
      { type: 'BUY_CONSPIRACY', pay: { funds: 4 } },
      { type: 'PLAY_CONSPIRACY', cardId: 'con-01' },
      { type: 'POWER_PROSPECT', give: 'funds', take: ['funds'] },
      { type: 'POWER_LAND_GRAB', areaId: 'central-01' },
      { type: 'POWER_DONATIONS', from: 'p1', res: 'funds' },
      { type: 'POWER_PAYBACK', areaId: 'central-01', pay: 'funds' },
      { type: 'POWER_TOUGH_LOVE', areaIds: [], pay: { trust: 2, funds: 2 } },
      { type: 'ACK_HEADLINE' },
      { type: 'END_TURN' },
      { type: 'RESOLVE_CHOICE', choiceId: 'nope', pick: { kind: 'resources', res: { funds: 1 } } },
    ];
    for (const a of every) {
      const r = act(s, other, a);
      if (a.type === 'RESOLVE_CHOICE') {
        // Allowed through the turn guard, then refused on its own merits.
        expect(r.ok === false && r.error !== 'not your turn', `${a.type}`).toBe(true);
      } else if (a.type === 'PLAY_CONSPIRACY') {
        // The pre-answer window is opened by `phase === 'answer'`, and this state
        // is in 'actions', so a non-active player is refused by the turn guard.
        // (An active player has no such guard — that is R9, pinned separately.)
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('not your turn');
      } else {
        expect(r.ok, `${a.type} should be refused`).toBe(false);
        if (!r.ok) expect(r.error, `${a.type}`).toBe('not your turn');
      }
    }
  });

  it('the active player CANNOT play a Conspiracy Card during the headlines phase', () => {
    // R9, ruled and fixed. rules-reference.md:282-283 scopes conspiracy play to
    // "at any point during your turn" and "immediately before an opponent
    // answers" — two windows, and neither is open while the post-turn Headline
    // queue drains. PLAY_CONSPIRACY was the only turn action with no
    // `phase !== 'actions'` check of its own, and the turn guard exempts the
    // ACTIVE player, so a conspiracy could resolve mid-queue: mutating the board
    // and pushing new choices while Headlines were still pending.
    //
    // The first assertion is the regression — before the fix `during.ok` was true.
    let s = answered(fresh(1), 'p1');
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1!, conspiracies: ['con-01'] } } };

    // During your own turn: legal.
    const inActions = act(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: 'con-01' });
    expect(inActions.ok).toBe(true);

    // Mid-Headline-queue: refused, card still in hand, board untouched.
    const midQueue: GameState = {
      ...s,
      phase: 'headlines',
      activeHeadline: 'hed-01',
      headlineQueue: [{ areaId: 'central-01', by: 'p1' }],
      _pendingCard: null,
    };
    const during = act(midQueue, 'p1', { type: 'PLAY_CONSPIRACY', cardId: 'con-01' });
    expect(during.ok).toBe(false);
    if (!during.ok) expect(during.error).toBe('resolve the Headline first');
    expect(midQueue.players.p1?.conspiracies).toEqual(['con-01']);
    expect(midQueue.zones.flatMap((z) => z.areas).filter((a) => a.peg !== null)).toHaveLength(0);
  });

  it('any player may play a Conspiracy Card in the pre-answer window', () => {
    // rules-reference.md:283 — p19 "immediately before an opponent answers".
    const s: GameState = {
      ...fresh(1),
      phase: 'answer',
      players: {
        ...fresh(1).players,
        p2: { ...fresh(1).players.p2!, conspiracies: ['con-01'] },
      },
    };
    const r = act(s, 'p2', { type: 'PLAY_CONSPIRACY', cardId: 'con-01' });
    expect(r.ok).toBe(true);
  });

  it('an exhausted Ideology deck ends the game rather than soft-locking the turn', () => {
    // R10, ruled and fixed. The headline path has always handled an empty deck
    // (`nextHeadlineOrAdvance` drops the queue and advances); the ideology path
    // did not, and had no way to: a turn that begins with no card has no legal
    // first move. Before the fix this state ended up in `phase: 'answer'` with
    // `_pendingCard: null`, where ANSWER fails "no card has been put to you",
    // REDRAW_IDEOLOGY fails "no card to redraw", and END_TURN fails "answer your
    // Ideology Card first" — a permanent stall, which is the regression.
    const base = answered(fresh(1), 'p1');
    const s: GameState = { ...base, _ideologyDraw: [], _ideologyDiscard: [] };

    const r = act(s, 'p1', { type: 'END_TURN' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Play ends and the board's standing is the result, as at p20's timer ending.
    expect(r.state.finished).toBe(true);
    expect(r.state.phase).toBe('finished');
    expect(r.state._pendingCard).toBeNull();
    expect(r.events.map((e) => e.type)).toEqual(['turn-ended', 'game-over']);
    expect(r.state.log.some((l) => l.text === 'The Ideology deck is exhausted.')).toBe(true);
    // Over is over: nothing is legal, and nothing is stuck.
    expect(act(r.state, 'p1', { type: 'END_TURN' }).ok).toBe(false);
    expect(act(r.state, 'p2', { type: 'ANSWER', side: 0 }).ok).toBe(false);

    // The guard fires only when there is genuinely nothing left: a non-empty
    // discard reshuffles (p10) and the turn starts normally.
    const withDiscards: GameState = {
      ...base,
      _ideologyDraw: [],
      _ideologyDiscard: ['ide-05', 'ide-06'],
    };
    const ok = act(withDiscards, 'p1', { type: 'END_TURN' });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.state.finished).toBe(false);
    expect(ok.state.phase).toBe('answer');
    expect(['ide-05', 'ide-06']).toContain(ok.state._pendingCard);
  });

  it('advanceTurn increments round only when the outgoing player was last in turn order', () => {
    let s = step(answered(fresh(1), 'p1'), 'p1', { type: 'END_TURN' });
    expect(s.round).toBe(1);
    expect(s.turn).toBe(2);
    s = step(step(s, 'p2', { type: 'ANSWER', side: 0 }), 'p2', { type: 'END_TURN' });
    expect(s.round).toBe(1);
    expect(s.turn).toBe(3);
    s = step(step(s, 'p3', { type: 'ANSWER', side: 0 }), 'p3', { type: 'END_TURN' });
    expect(s.round).toBe(2);
    expect(s.turn).toBe(4);
    expect(s.activePlayer).toBe('p1');
  });

  it('powerUses reset for exactly one player - the incoming one', () => {
    let s = answered(fresh(1), 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: {
          ...s.players.p1!,
          powerUses: { ...s.players.p1!.powerUses, prospecting: 1, gerrymandered: { central: 1 } },
        },
      },
    };
    s = step(s, 'p1', { type: 'END_TURN' });
    // The outgoing player keeps their counters.
    expect(s.players.p1?.powerUses.prospecting).toBe(1);
    expect(s.players.p1?.powerUses.gerrymandered).toEqual({ central: 1 });
    // The incoming player is reset.
    expect(s.players.p2?.powerUses.prospecting).toBe(0);
    expect(s.players.p2?.powerUses.gerrymandered).toEqual({});
  });

  it('every action is refused once the game is finished', () => {
    const base = fresh(1);
    const done: GameState = { ...base, finished: true, phase: 'finished' };
    const r = act(done, 'p1', { type: 'END_TURN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('the game is over');
  });

  it('a player with a pending decision can resolve only their own', () => {
    const base = answered(fresh(1), 'p1');
    const s: GameState = {
      ...base,
      choices: [{ id: 'c1', player: 'p1', choice: { kind: 'lose-any', count: 1, reason: 'test' } }],
    };
    const r = act(s, 'p2', {
      type: 'RESOLVE_CHOICE',
      choiceId: 'c1',
      pick: { kind: 'resources', res: { funds: 1 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('that decision is not yours');
  });
});

describe('PLACE_VOTERS validation', () => {
  it('refuses a same-zone group split across two zones', () => {
    // rules-reference.md:163-164.
    const base = answered(fresh(1), 'p1');
    let s = giveGroup(base, 'p1', 2, true);
    const a = freeIn(s, 'central', 1)[0];
    const b = freeIn(s, 'west', 1)[0];
    if (!a || !b) throw new Error('setup');
    const r = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [a, b] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('voters from one Voter Card cannot be split across zones');
  });

  it('allows a non-Voter-Card group to be split across zones', () => {
    // state.ts:122 — `sameZone: false` for evictions, headlines, conspiracies.
    const base = answered(fresh(1), 'p1');
    let s = giveGroup(base, 'p1', 2, false);
    const a = freeIn(s, 'central', 1)[0];
    const b = freeIn(s, 'west', 1)[0];
    if (!a || !b) throw new Error('setup');
    s = step(s, 'p1', { type: 'PLACE_VOTERS', groupId: s.players.p1?.pending[0]?.id ?? '', areaIds: [a, b] });
    expect(areaOf(s, a).peg?.owner).toBe('p1');
    expect(areaOf(s, b).peg?.owner).toBe('p1');
  });

  it('refuses a duplicate area, an occupied area, and a count over the group', () => {
    const base = answered(fresh(1), 'p1');
    let s = giveGroup(base, 'p1', 2, false);
    const g = s.players.p1?.pending[0]?.id ?? '';
    const a = freeIn(s, 'central', 1)[0];
    const b = freeIn(s, 'west', 1)[0];
    const c = freeIn(s, 'east', 1)[0];
    if (!a || !b || !c) throw new Error('setup');

    const dup = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: [a, a] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe('duplicate area');

    const tooMany = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: [a, b, c] });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe('you do not have that many voters');

    const taken = setAreaState(s, b, { owner: 'p3', majority: false });
    const occupied = act(taken, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: [a, b] });
    expect(occupied.ok).toBe(false);
    if (!occupied.ok) expect(occupied.error).toBe('that area is already taken');

    const none = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toBe('place at least one voter');

    const missing = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: g, areaIds: ['nowhere-99'] });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('unknown area');

    const noGroup = act(s, 'p1', { type: 'PLACE_VOTERS', groupId: 'nope', areaIds: [a] });
    expect(noGroup.ok).toBe(false);
    if (!noGroup.ok) expect(noGroup.error).toBe('no such group of voters');
  });
});

describe('the HQ Mat', () => {
  it('starts with exactly 3 face-up Voter Cards', () => {
    // rules-reference.md:161-162. This is the silent §2 B2 defect: `setup` never
    // populated `market` and `refillMarket` is unreachable before the first
    // INFLUENCE, so the Mat stayed empty for the whole game.
    const s = fresh(1);
    expect(RULES.marketSize).toBe(3);
    expect(s.market).toHaveLength(3);
    expect(new Set(s.market.map((m) => m.cardId)).size).toBe(3);
  });

  it('is refilled to 3 immediately after an INFLUENCE', () => {
    const base = answered(fresh(1), 'p1');
    const first = base.market[0];
    if (!first) throw new Error('empty market');
    const s = step(base, 'p1', { type: 'INFLUENCE', slot: 0 });
    expect(s.market).toHaveLength(RULES.marketSize);
    expect(s.market.some((m) => m.cardId === first.cardId)).toBe(false);
    expect(s._voterDiscard).toContain(first.cardId);
  });
});

describe('Ideology Cards and the redraw', () => {
  it('a redraw costs exactly 4 total and is refused on under- or overpayment', () => {
    // rules-reference.md:106-107.
    expect(RULES.redrawCost).toBe(4);
    const base = fresh(1);
    // p1 holds 2 Funds and 2 Trust, so `{funds: 2, trust: 2}` is affordable.
    const base2: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...base.players.p1!, resources: { funds: 2, clout: 0, media: 0, trust: 2 } },
      },
    };
    const under = act(base2, 'p1', { type: 'REDRAW_IDEOLOGY', pay: { funds: 3 } });
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.error).toBe('a redraw costs exactly 4 resources');

    const over = act(base2, 'p1', { type: 'REDRAW_IDEOLOGY', pay: { funds: 5 } });
    expect(over.ok).toBe(false);

    const exact = act(base2, 'p1', { type: 'REDRAW_IDEOLOGY', pay: { funds: 2, trust: 2 } });
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    // A different card, and the old one is discarded.
    expect(exact.state._pendingCard).not.toBe(base2._pendingCard);
    expect(exact.state._ideologyDiscard).toContain(base2._pendingCard);
  });

  it('Ideology Cards cannot be traded; only Conspiracies move', () => {
    // rules-reference.md:144. The reducer checks card ownership against
    // `conspiracies` only, so an Ideology Card id in `giveCards` is simply not found
    // there — the manifesto is never a tradeable.
    const f = fresh(1);
    let s = answered(f, 'p1');
    s = {
      ...s,
      players: {
        ...s.players,
        p1: { ...s.players.p1!, conspiracies: ['con-01', 'con-02'], manifestoCards: ['ide-01', 'ide-02'], resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
        p2: { ...s.players.p2!, conspiracies: [], manifestoCards: ['ide-03'], resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
      },
    };
    const t = step(s, 'p1', {
      type: 'TRADE',
      withPlayer: 'p2',
      give: { funds: 1 },
      receive: { funds: 1 },
      giveCards: ['con-01'],
    });
    expect(t.players.p1?.conspiracies).toEqual(['con-02']);
    expect(t.players.p1?.manifestoCards).toEqual(['ide-01', 'ide-02']);
    expect(t.players.p2?.manifestoCards).toEqual(['ide-03']);

    // Naming an Ideology Card as a tradeable is refused: it is not in the hand.
    const withCard = {
      ...s,
      players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [] } },
    };
    const r = act(withCard, 'p1', {
      type: 'TRADE',
      withPlayer: 'p2',
      give: { funds: 1 },
      receive: { funds: 1 },
      giveCards: ['ide-01'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('you do not hold that card');
  });

  it('TRADE requires at least 1 resource from BOTH sides and forbids self-trade', () => {
    // rules-reference.md:142-143.
    const base = answered(fresh(1), 'p1');
    const self = act(base, 'p1', { type: 'TRADE', withPlayer: 'p1', give: { funds: 1 }, receive: { funds: 1 } });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error).toBe('you cannot trade with yourself');

    const oneSided = act(base, 'p1', { type: 'TRADE', withPlayer: 'p2', give: { funds: 1 }, receive: {} });
    expect(oneSided.ok).toBe(false);
    if (!oneSided.ok) expect(oneSided.error).toBe('both sides must exchange at least one resource');

    const otherSide = act(base, 'p1', { type: 'TRADE', withPlayer: 'p2', give: {}, receive: { funds: 1 } });
    expect(otherSide.ok).toBe(false);

    const unknown = act(base, 'p1', { type: 'TRADE', withPlayer: 'nope', give: { funds: 1 }, receive: { funds: 1 } });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBe('unknown player');
  });
});

describe('Conspiracy Cards', () => {
  it('may only be bought if it is on top of the draw pile, and the top cost is public', () => {
    // rules-reference.md:281. `syncConspiracyTop` publishes the cost because it is
    // printed on the card's back, even though the identity is secret.
    const base = answered(fresh(1), 'p1');
    const top = base._conspiracyDraw[0];
    expect(top).toBeDefined();
    if (!top) throw new Error('setup');
    expect(base.conspiracyTopCost).toBe(ctx.cards.conspiracy[top]?.cost);
    expect(base.conspiracyRemaining).toBe(base._conspiracyDraw.length);
  });

  it('buying costs the printed total in ANY combination, less discounts', () => {
    // p19 / rules-reference.md:280.
    const base = answered(fresh(1), 'p1');
    const top = base._conspiracyDraw[0];
    const card = top ? ctx.cards.conspiracy[top] : undefined;
    if (!card) throw new Error('setup');
    const p: GameState = {
      ...base,
      players: {
        ...base.players,
        p1: { ...base.players.p1!, resources: { funds: 4, clout: 4, media: 0, trust: 0 } },
      },
    };
    const split = act(p, 'p1', { type: 'BUY_CONSPIRACY', pay: { funds: 2, clout: 2 } });
    if (card.cost === 4) {
      expect(split.ok).toBe(true);
    } else {
      expect(split.ok).toBe(false);
    }

    const wrong = act(p, 'p1', { type: 'BUY_CONSPIRACY', pay: { funds: 3, clout: 2 } });
    if (card.cost === 5) {
      expect(wrong.ok).toBe(true);
    } else {
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.error).toBe(`that costs ${card.cost} resources in any combination`);
    }
  });

  it('a played Conspiracy Card leaves the hand and is not placed on the board', () => {
    // The `voters` op is the one that could plausibly put something on the board;
    // con-03 has it. con-01 is `gain`, so it is a control.
    const base = answered(fresh(1), 'p1');
    const withCard: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1!, conspiracies: ['con-01'] } },
    };
    const r = step(withCard, 'p1', { type: 'PLAY_CONSPIRACY', cardId: 'con-01' });
    expect(r.players.p1?.conspiracies).toEqual([]);
    expect(r._conspiracyDiscard).toContain('con-01');
    const filled = r.zones.reduce((n, z) => n + z.areas.filter((a) => a.peg !== null).length, 0);
    expect(filled).toBe(0);
  });

  it('draw-conspiracy puts the drawn cards in the hand, not on the board', () => {
    // Reached through PLAY_CONSPIRACY of a card that has the op. The bespoke index
    // keeps the shared fixture deck unchanged.
    const bespoke: Ctx = {
      ...ctx,
      cards: {
        ...ctx.cards,
        conspiracy: {
          ...ctx.cards.conspiracy,
          'con-dc': {
            id: 'con-dc',
            name: 'Insider',
            text: 'Draw 2 Conspiracy Cards.',
            cost: 4,
            effects: [{ op: 'draw-conspiracy', n: 2 } satisfies Effect],
          },
        },
      },
    };
    // A real game cannot have a card in hand that is still on the pile: BUY_CONSPIRACY
    // slices the pile when it hands the card over. So the pile starts past `con-dc`.
    const a = answered(fresh(1), 'p1');
    const base: GameState = {
      ...a,
      _conspiracyDraw: ['con-01', 'con-02', 'con-03'],
      _conspiracyDiscard: ['con-dc'],
      conspiracyTopCost: 4,
      players: { ...a.players, p1: { ...a.players.p1!, conspiracies: ['con-dc'] } },
    };
    const r = reduce(base, 'p1', { type: 'PLAY_CONSPIRACY', cardId: 'con-dc' }, bespoke);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The played card is gone, the two drawn ones are in hand, and the next one up
    // is still on the pile with its cost published.
    expect(r.state.players.p1?.conspiracies).toEqual(['con-01', 'con-02']);
    expect(r.state._conspiracyDraw).toEqual(['con-03']);
    expect(r.state._conspiracyDiscard).toEqual(['con-dc', 'con-dc']);
    expect(r.state.conspiracyTopCost).toBe(4);
    expect(r.state.conspiracyRemaining).toBe(1);
  });

  it('effects: refresh-market discards every open card and deals 3 fresh ones', () => {
    const bespoke = {
      ...ctx,
      cards: {
        ...ctx.cards,
        conspiracy: {
          ...ctx.cards.conspiracy,
          'con-rm': {
            id: 'con-rm',
            name: 'Scoop',
            text: 'Refresh the HQ Mat.',
            cost: 4,
            effects: [{ op: 'refresh-market' } satisfies Effect],
          },
        },
      },
    };
    const base = answered(fresh(1), 'p1');
    const open = base.market.map((m) => m.cardId);
    const discardBefore = base._voterDiscard.length;
    const t: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1!, conspiracies: ['con-rm'] } },
    };
    const r = reduce(t, 'p1', { type: 'PLAY_CONSPIRACY', cardId: 'con-rm' }, bespoke);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.market).toHaveLength(RULES.marketSize);
    expect(r.state._voterDiscard.length).toBe(discardBefore + open.length);
    for (const id of open) expect(r.state._voterDiscard).toContain(id);
    for (const id of open) expect(r.state.market.some((m) => m.cardId === id)).toBe(false);
  });

  it('the leader effect target resolves to nobody on a scoring tie', () => {
    // reduce.ts resolveTargets 'leader': a Headline that takes 1 Funds from the leader.
    const bespoke: Ctx = {
      ...ctx,
      cards: {
        ...ctx.cards,
        headline: {
          ...ctx.cards.headline,
          'hed-lead': {
            id: 'hed-lead',
            name: 'Audit',
            text: 'The leader loses 1 Funds.',
            effects: [{ op: 'lose', res: { funds: 1 }, target: 'leader' } satisfies Effect],
          },
        },
      },
    };
    const base = answered(fresh(1), 'p1');
    const tie: GameState = {
      ...base,
      phase: 'headlines',
      activeHeadline: 'hed-lead',
      headlineQueue: [{ areaId: 'central-01', by: 'p1' }],
      _pendingCard: null,
    };
    // All scores are zero, so there is no leader and nobody is charged.
    const r = reduce(tie, 'p1', { type: 'ACK_HEADLINE' }, bespoke);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const p of r.state.turnOrder) {
      expect(r.state.players[p]?.resources.funds).toBe(tie.players[p]?.resources.funds);
    }
  });

  it('the leader effect target skips a zero-scoring player when someone else leads', () => {
    const bespoke = {
      ...ctx,
      cards: {
        ...ctx.cards,
        headline: {
          ...ctx.cards.headline,
          'hed-lead': {
            id: 'hed-lead',
            name: 'Audit',
            text: 'The leader loses 1 Funds.',
            effects: [{ op: 'lose', res: { funds: 1 }, target: 'leader' } satisfies Effect],
          },
        },
      },
    };
    let base = answered(fresh(1), 'p1');
    base = withPegs(base, 'p2', 'central', 5);
    const s: GameState = {
      ...base,
      phase: 'headlines',
      activeHeadline: 'hed-lead',
      headlineQueue: [{ areaId: 'central-01', by: 'p1' }],
      _pendingCard: null,
      players: {
        ...base.players,
        p1: { ...base.players.p1!, resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
        p2: { ...base.players.p2!, resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
        p3: { ...base.players.p3!, resources: { funds: 6, clout: 0, media: 0, trust: 0 } },
      },
    };
    const r = reduce(s, 'p1', { type: 'ACK_HEADLINE' }, bespoke);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // p2 leads central with 5 majority voters, so p2 pays and p1/p3 do not.
    expect(r.state.players.p2?.resources.funds).toBe(5);
    expect(r.state.players.p1?.resources.funds).toBe(6);
    expect(r.state.players.p3?.resources.funds).toBe(6);
  });
});
