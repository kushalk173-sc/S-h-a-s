/**
 * G1 — `'choose-peg-dest'` CANNOT BE RAISED INTO A STATE NOBODY CAN ANSWER.
 *
 * ## THE DEFECT, in the shape it actually took
 *
 * `'choose-peg-dest'` (GREAT LEADER, BAD ECONOMY, `hl-et2040-022`) is the one `Choice`
 * kind whose candidate sets are read off the **BOARD**, and the board is public to every
 * seat. `applyEffect` gated the raise on `pegMoveOffered` — at raise time — and
 * `resolveChoice` re-derived both halves live at answer time. Both halves of that are
 * correct. The gap is between them:
 *
 *  - the peg on offer belongs to `c.source`, the card's **ACTOR**;
 *  - `blockedBy` freezes `pending.player`, the **ANSWERER**, who is *"the player after
 *    you"* — a different seat;
 *  - so the actor, who is the ACTIVE PLAYER on their own turn, is free to keep acting,
 *    and the board can empty both candidate sets while nobody is looking at the dialog.
 *
 * Reproduced with legal actions only, two seats: p1 plays GREAT LEADER, p1 influences a
 * 3-Voter Card (the trigger fires, p2 owes the relocation), and p1 then completes a
 * majority in `north_west` — 5 more of their own voters — which `recount` flips so that
 * p1's **only** peg becomes a `majority` peg, i.e. the score. From that moment
 * `movablePegIds(p1)` is empty, so **0 of the 16 (peg, destination) pairs are legal**,
 * every pick is refused, and p2 is refused `END_TURN` too — while p1's `END_TURN` still
 * succeeds. The table turns forever and p2 never plays again.
 *
 * ## THE INVARIANT THIS FILE ASSERTS, and it is stronger than the one it broke
 *
 * A pending decision must be satisfiable in **every state reachable while it is open**,
 * not merely in the state it was raised in. `state.ts`'s `capOverride` ruling states the
 * same shape for `lose-any`, whose ask is clamped DOWN to what the chooser holds at
 * answer time; the old docstring here wrongly transferred that argument to a kind whose
 * candidate set the answerer does not own at all.
 *
 * The fix is in two independent layers and this file proves each one, because either
 * alone would leave a hole:
 *
 *  1. **THE STALENESS GATE** (`reduce`): while a LIVE `'choose-peg-dest'` is open, every
 *     action is refused except the three that discharge one. Asserted below as *"the
 *     documented route into the stale board does not exist"* — the actor cannot finish
 *     the majority, cannot influence again, cannot end the turn.
 *  2. **THE WITHDRAWAL** (`resolveChoice`'s `drop`): a `'choose-peg-dest'` whose pick space
 *     has emptied closes itself the moment any decision resolves, freeing the frozen seat
 *     without moving anything. Asserted below on the hand-built stale board and on the ONE
 *     route the gate cannot close — a second decision belonging to another seat, which
 *     `RESOLVE_CHOICE` must stay exempt from so that a player frozen by p12 can thaw.
 *
 * **THE RESOLVER'S REFUSALS ARE UNCHANGED, and that is a requirement rather than a
 * side-effect.** A stale PICK is still refused in the same words, because the printed clause
 * says *non-majority* voters and the peg in the answerer's hand is now the score. The engine
 * does not accept a move its own rules forbid and it does not pick a different one on the
 * player's behalf; it withdraws the OFFER. `packages/server`'s
 * `peg-dest-boundary.test.ts` pins that co-extensiveness against the wire and passes
 * unchanged.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { NO_POWER_USES, type AreaID, type GameState, type PendingChoice, type PlayerID, type Pool } from '../src/state';
import { CARDS, fresh } from './helpers';

/** GREAT LEADER, BAD ECONOMY's own op, aimed at the seat the printed card names. */
const LEAD: ConspiracyCard = {
  id: 'probe-leader-bad-economy',
  name: 'Great Leader, Bad Economy',
  text: 'probe',
  cost: 0,
  effects: [{ op: 'move-peg', n: 1, target: 'player-after' }],
};

/** A second decision that can lift p1's LAST peg off the board. Layer 2's reason. */
const EVICT_OWN: ConspiracyCard = {
  id: 'probe-evict-own',
  name: 'probe evict own',
  text: 'probe',
  cost: 0,
  effects: [{ op: 'evict', n: 1, target: 'you' }],
};

/** An ordinary, decision-free card — the lever that withdraws a stale offer. */
const GAIN_ONE: ConspiracyCard = {
  id: 'probe-gain-one',
  name: 'probe gain one',
  text: 'probe',
  cost: 0,
  effects: [{ op: 'gain', res: { funds: 1 } }],
};

const probeCards: CardIndex = indexCards({
  ideology: Object.values(CARDS.ideology),
  voter: Object.values(CARDS.voter),
  conspiracy: [...Object.values(CARDS.conspiracy), LEAD, EVICT_OWN, GAIN_ONE],
  headline: Object.values(CARDS.headline),
});
const ctx: Ctx = { rules: RULES, cards: probeCards };

const SEAT_COUNTS = [2, 3, 4, 5] as const;

/** p1's one and only peg. `north_west` majority is 6 and it neighbours `north`. */
const PEG: AreaID = 'north_west-01';
/** Five more of p1's own areas in the same zone — the five that complete the majority. */
const FILLERS: readonly AreaID[] = ['north_west-02', 'north_west-03', 'north_west-04', 'north_west-05', 'north_west-06'];
/** An empty area in `north`, which neighbours `north_west` and so is a legal landing. */
const LANDING: AreaID = 'north-01';
/** An empty area in `west`, which neighbours `north` and `north_west`. */
const LANDING_WEST: AreaID = 'west-01';

/**
 * Enough to buy a Voter Card and UNDER the cap of 12, because a pool over the cap raises
 * p12's own decision and every assertion in this file would then be measuring that.
 *
 * Applied to the seats after `setup()` rather than through `startResources`, whose
 * declared type is `Record<string, Partial<Record<Resource, number>>>` — a value shape no
 * flat pool satisfies, which is why `choices.test.ts` passes `{}` and sets pools by hand.
 */
const POOL_BUYING: Pool = { funds: 3, clout: 0, media: 0, trust: 0 };

/**
 * A live table: `p1` is active and in `actions`, holds exactly one peg, and can afford
 * to influence a face-up Voter Card — i.e. every legal action the reported reproduction
 * used is available here.
 */
function stage(seats: readonly PlayerID[]): GameState {
  const base = fresh(1, seats);
  const withPools: GameState = {
    ...base,
    players: Object.fromEntries(seats.map((id) => [id, { ...base.players[id]!, resources: POOL_BUYING }])) as GameState['players'],
  };
  const answered = reduce(withPools, 'p1', { type: 'ANSWER', side: 0 }, ctx);
  if (!answered.ok) throw new Error(`fixture could not answer: ${answered.error}`);
  const s = answered.state;
  if (s.choices.length > 0) throw new Error('the fixture opening left a pending decision');
  const seeded: GameState = {
    ...s,
    phase: 'actions',
    activePlayer: 'p1',
    _pendingCard: null,
    choices: [],
    zones: s.zones.map((z) => ({ ...z, areas: z.areas.map((a) => (a.id === PEG ? { ...a, peg: { owner: 'p1' as PlayerID, majority: false } } : a)) })),
    players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, { ...p, powerUses: NO_POWER_USES }])) as GameState['players'],
  };
  return seeded;
}

/** p1 plays GREAT LEADER and the `'choose-peg-dest'` for the seat after p1 is raised. */
function raiseRelocation(s: GameState): { readonly state: GameState; readonly pending: PendingChoice } {
  const inHand: GameState = { ...s, players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [LEAD.id] } } };
  const r = reduce(inHand, 'p1', { type: 'PLAY_CONSPIRACY', cardId: LEAD.id }, ctx);
  if (!r.ok) throw new Error(`GREAT LEADER was refused: ${r.error}`);
  const pending = r.state.choices.find((c) => c.choice.kind === 'choose-peg-dest');
  if (pending === undefined) throw new Error('GREAT LEADER raised no relocation at all, so nothing is proved');
  return { state: r.state, pending };
}

/** Every (pegged area, empty area) pair on the board, plus the two halves crossed wrongly. */
function everyPair(s: GameState): readonly { readonly areaId: AreaID; readonly toAreaId: AreaID }[] {
  const areas = s.zones.flatMap((z) => z.areas);
  return areas.flatMap((a) => areas.map((b) => ({ areaId: a.id, toAreaId: b.id })));
}

function pegsOf(s: GameState, who: PlayerID): readonly { readonly id: AreaID; readonly majority: boolean }[] {
  return s.zones
    .flatMap((z) => z.areas)
    .filter((a) => a.peg?.owner === who)
    .map((a) => ({ id: a.id, majority: a.peg?.majority === true }));
}

/** A flat fingerprint of the board, so "the board did not move" is an assertion. */
function boardOf(s: GameState): readonly string[] {
  return s.zones.flatMap((z) => z.areas).map((a) => `${a.id}:${a.peg?.owner ?? '-'}:${a.peg?.majority === true ? 'M' : '-'}`);
}

/**
 * Did this resolution actually RELOCATE anything?
 *
 * Not "did it return `ok`" — after the fix a stale offer resolves successfully and moves
 * nothing, so `ok` is precisely the wrong signal and counting it would have hidden the
 * defect this file exists for. A relocation emits a `gerrymandered` event and changes the
 * board, and both are read here.
 */
function relocated(r: ReturnType<typeof reduce>, before: GameState): boolean {
  if (!r.ok) return false;
  if (r.events.some((e) => e.type === 'gerrymandered')) return true;
  return boardOf(r.state).join('|') !== boardOf(before).join('|');
}

describe("G1 — the staleness gate: the reported route into a stale 'choose-peg-dest' does not exist", () => {
  it('at 2/3/4/5 seats the actor can do NOTHING that moves the board while the relocation is open', () => {
    for (const n of SEAT_COUNTS) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const where = `${n} seats`;
      const start = stage(seats);

      // The preconditions of the reported reproduction, asserted rather than assumed: the
      // actor CAN influence a face-up Voter Card (so the refused `INFLUENCE` is refused by
      // the gate and not by an empty mat or an empty purse), p1 owns exactly one peg, it is
      // NOT a majority peg, and the answerer is a different seat.
      expect(start.market.length, `${where}: no open Voter Card, so INFLUENCE proves nothing`).toBeGreaterThan(0);
      expect(start.players.p1?.resources.funds ?? 0, `${where}: p1 cannot afford to influence`).toBeGreaterThanOrEqual(2);
      expect(reduce(start, 'p1', { type: 'INFLUENCE', slot: 0 }, ctx).ok, `${where}: the fixture cannot influence`).toBe(true);

      const { state: raised, pending } = raiseRelocation(start);
      expect(pegsOf(raised, 'p1'), `${where}: fixture`).toEqual([{ id: PEG, majority: false }]);
      expect(pending.player, `${where}: the answerer must not be the actor`).not.toBe('p1');

      // The actions the reproduction used. All are refused, and the reason is the staleness
      // gate rather than the per-player freeze — p1 holds no decision of their own, so
      // `blockedBy` is not what stops them.
      const attempts: readonly { readonly label: string; readonly action: Parameters<typeof reduce>[2] }[] = [
        { label: 'INFLUENCE', action: { type: 'INFLUENCE', slot: 0 } },
        { label: 'END_TURN', action: { type: 'END_TURN' } },
        { label: 'PLAY_CONSPIRACY', action: { type: 'PLAY_CONSPIRACY', cardId: EVICT_OWN.id } },
        { label: 'GERRYMANDER', action: { type: 'GERRYMANDER', zoneId: 'north_west', fromAreaId: PEG, toAreaId: LANDING } },
        { label: 'POWER_LAND_GRAB', action: { type: 'POWER_LAND_GRAB', areaId: LANDING } },
        { label: 'POWER_PAYBACK', action: { type: 'POWER_PAYBACK', areaId: PEG, pay: 'funds' } },
      ];
      for (const attempt of attempts) {
        const r = reduce(raised, 'p1', attempt.action, ctx);
        expect(r.ok, `${where}: the actor was allowed to ${attempt.label} with a relocation open`).toBe(false);
        if (!r.ok) expect(r.error, `${where}: ${attempt.label}`).toBe('a voter relocation is being answered — resolve it first');
      }
      expect(boardOf(raised), `${where}: the gate let the board move`).toEqual(boardOf(start));

      // The board therefore never moved, so a legal pair exists — and not just one: the
      // whole (peg, destination) space of p1's single peg into `north`, `north_east` and
      // `west`, every one of them accepted.
      const peg = raised.zones.flatMap((z) => z.areas).find((a) => a.id === PEG);
      expect(peg?.peg, `${where}: the peg vanished`).toBeDefined();
      const legal = everyPair(raised).filter((pair) =>
        reduce(raised, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: pair.areaId, toAreaId: pair.toAreaId } }, ctx).ok,
      );
      expect(legal.length, `${where}: NO legal pair, which is the defect`).toBeGreaterThan(0);
      // Same-zone landings and occupied landings are among the refused ones, so "many
      // accepted" cannot mean the adjacency and occupancy guards are off.
      const sameZone = everyPair(raised).filter((pair) => pair.areaId === PEG && pair.toAreaId.startsWith('north_west-'));
      expect(sameZone.length, `${where}: fixture`).toBeGreaterThan(0);
      for (const pair of sameZone) {
        const r = reduce(raised, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: pair.areaId, toAreaId: pair.toAreaId } }, ctx);
        expect(relocated(r, raised), `${where}: ${pair.toAreaId} is in the peg's OWN zone and must not be a legal landing`).toBe(false);
      }
      expect(legal.length, `${where}: only ${legal.length} pairs were accepted out of ${everyPair(raised).length}`).toBeLessThan(everyPair(raised).length);
    }
  });

  it('and the answerer CAN discharge it, which is the point of the gate being narrow', () => {
    for (const n of SEAT_COUNTS) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const { state: raised, pending } = raiseRelocation(stage(seats));
      const r = reduce(raised, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: PEG, toAreaId: LANDING } }, ctx);
      expect(r.ok, `${n} seats: the relocation could not be discharged`).toBe(true);
      if (!r.ok) continue;
      expect(r.state.choices, `${n} seats: the decision did not close`).toHaveLength(0);
      // …and the peg really moved: p1 has no peg in `north_west` and one in `north`.
      expect(r.state.zones.flatMap((z) => z.areas).find((a) => a.id === PEG)?.peg, `${n} seats`).toBeNull();
      expect(r.state.zones.flatMap((z) => z.areas).find((a) => a.id === LANDING)?.peg?.owner, `${n} seats`).toBe('p1');
      // …and the actor's turn is unblocked again, so the table carries on.
      const end = reduce(r.state, 'p1', { type: 'END_TURN' }, ctx);
      expect(end.ok, `${n} seats: the table is still wedged after the relocation`).toBe(true);
    }
  });
});

describe('G1 — the stale board itself: 0 legal pairs, and the decision still closes', () => {
  /**
   * THE STALE STATE, built BY HAND because `reduce` now refuses the route to it.
   *
   * It is exactly what the reported reproduction produced: p1's single peg in
   * `north_west` completed into a majority by five more of p1's own voters, so
   * `recount` (`board.ts`'s majority block) has flagged every p1 peg in that zone and
   * `movablePegIds` is empty. Written here as the post-`recount` board rather than
   * assembled action by action, because assembling it action by action is the thing the
   * staleness gate forbids — which is the whole of the first layer of the fix.
   */
  function staleBoard(s: GameState): GameState {
    const filled = new Set<AreaID>([PEG, ...FILLERS]);
    return {
      ...s,
      zones: s.zones.map((z) =>
        z.id === 'north_west'
          ? {
              ...z,
              majorityHolder: 'p1',
              areas: z.areas.map((a) => (filled.has(a.id) ? { ...a, peg: { owner: 'p1' as PlayerID, majority: true } } : a)),
            }
          : z,
      ),
    };
  }

  it('documents the hard lock: at 2/3/4/5 seats NOTHING can be moved off the stale board', () => {
    // The pre-fix symptom, asserted rather than assumed away. On the stale board the
    // pick space really is empty and every pick really is refused in the engine's own
    // words — this is the DEFECT, and the only thing standing between it and a dead table
    // is the withdrawal in the next two tests. `relocated` rather than `ok`, because the
    // question is whether a peg moved, and after the fix a refusal is no longer the only
    // possible outcome of an attempt.
    for (const n of SEAT_COUNTS) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const { state: raised, pending } = raiseRelocation(stage(seats));
      const stale = staleBoard(raised);
      expect(pegsOf(stale, 'p1').every((p) => p.majority), `${n} seats: fixture is not the reported board`).toBe(true);
      expect(pegsOf(stale, 'p1').length, `${n} seats: the actor must own nothing movable`).toBe(6);
      const attempts = everyPair(stale).map((pair) =>
        reduce(stale, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: pair.areaId, toAreaId: pair.toAreaId } }, ctx),
      );
      expect(attempts.filter((r) => relocated(r, stale)).length, `${n} seats: a majority peg moved on the stale board`).toBe(0);
      expect(attempts.every((r) => !r.ok), `${n} seats: a stale pick was accepted`).toBe(true);
      // …and the player is frozen on everything else, which is what made it a DEAD TABLE
      // rather than a card that did nothing.
      expect(reduce(stale, pending.player, { type: 'END_TURN' }, ctx).ok, `${n} seats: END_TURN should be refused while a relocation is open`).toBe(false);
      // …but the staleness gate has LIFTED, because the offer is no longer live. This is
      // the half that makes the withdrawal reachable: a gate that fired on a stale offer
      // would freeze the very state it has to be allowed to leave.
      expect(reduce(stale, 'p1', { type: 'END_TURN' }, ctx).ok, `${n} seats: the gate is still holding a dead offer`).toBe(true);
    }
  });

  it('and the stale offer is WITHDRAWN by the next action any seat takes: nothing moves, the seat is freed', () => {
    for (const n of SEAT_COUNTS) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const { state: raised, pending } = raiseRelocation(stage(seats));
      const stale = staleBoard(raised);
      const before = boardOf(stale);

      // The actor plays an ordinary card. Nothing about the relocation is resolved — the
      // offer withdraws ITSELF, because `drop` re-reads every open relocation against the
      // board the action just produced.
      const inHand: GameState = { ...stale, players: { ...stale.players, p1: { ...stale.players.p1!, conspiracies: [GAIN_ONE.id] } } };
      const r = reduce(inHand, 'p1', { type: 'PLAY_CONSPIRACY', cardId: GAIN_ONE.id }, ctx);
      expect(r.ok, `${n} seats: an ordinary card was refused: ${r.ok ? '' : r.error}`).toBe(true);
      if (!r.ok) continue;
      expect(r.state.choices.some((c) => c.id === pending.id), `${n} seats: the stale relocation is still open`).toBe(false);
      expect(r.state.zones.flatMap((z) => z.areas).map((a) => `${a.id}:${a.peg?.owner ?? '-'}:${a.peg?.majority === true ? 'M' : '-'}`), `${n} seats: the withdrawal moved a peg`).toEqual(before);
      expect(r.state.log.some((l) => /relocation lapses/i.test(l.text)), `${n} seats: the withdrawal was silent`).toBe(true);
      // …and the frozen seat is free: it is no longer anybody's pending decision, and the
      // table turns. This is the assertion the old code could not make.
      expect(r.state.choices.filter((c) => c.player === pending.player), `${n} seats: the answerer is still frozen`).toHaveLength(0);
      expect(reduce(r.state, 'p1', { type: 'END_TURN' }, ctx).ok, `${n} seats: the table is still dead`).toBe(true);
    }
  });

  it('the one route the gate cannot close — another seat\'s decision — also lapses rather than deadlocking', () => {
    // Layer 1 is not a proof, and this is why. `RESOLVE_CHOICE` MUST stay exempt from the
    // staleness gate or a player frozen by p12 could never thaw, so a decision belonging
    // to a DIFFERENT seat can still be answered while a relocation is open — and answering
    // it can lift the very peg the relocation needed. The state is hand-built because the
    // gate is precisely what stops the second decision being RAISED here; the assertion
    // that matters is what happens next.
    for (const n of [3, 4, 5] as const) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const where = `${n} seats`;
      const raised0 = stage(seats);

      // The gate refuses to let p1 raise that second decision while the first is open.
      const both: GameState = {
        ...raised0,
        players: { ...raised0.players, p1: { ...raised0.players.p1!, conspiracies: [LEAD.id, EVICT_OWN.id] } },
      };
      const first = reduce(both, 'p1', { type: 'PLAY_CONSPIRACY', cardId: LEAD.id }, ctx);
      expect(first.ok, `${where}: the fixture could not raise the relocation`).toBe(true);
      if (!first.ok) continue;
      const second = reduce(first.state, 'p1', { type: 'PLAY_CONSPIRACY', cardId: EVICT_OWN.id }, ctx);
      expect(second.ok, `${where}: the gate let a second decision be raised under an open relocation`).toBe(false);

      // The stacked state, hand-built: p1 owns an eviction of their own last voter.
      const pegDest = first.state.choices.find((c) => c.choice.kind === 'choose-peg-dest');
      expect(pegDest, `${where}: no relocation`).toBeDefined();
      if (pegDest === undefined) continue;
      const stacked: GameState = {
        ...first.state,
        choices: [
          { id: 'c-stacked-evict', player: 'p1', choice: { kind: 'evict-voter', count: 1, scope: 'own', reason: 'Card effect' } },
          pegDest,
        ],
      };

// p1 answers their own decision — permitted, and the peg leaves the board.
      const evicted = reduce(stacked, 'p1', { type: 'RESOLVE_CHOICE', choiceId: 'c-stacked-evict', pick: { kind: 'areas', areaIds: [PEG] } }, ctx);
      expect(evicted.ok, `${where}: the other seat's decision was refused`).toBe(true);
      if (!evicted.ok) continue;
      expect(evicted.state.zones.flatMap((z) => z.areas).find((a) => a.id === PEG)?.peg, `${where}: the eviction did nothing`).toBeNull();
      // …and the very same action withdraws p2's now-empty relocation. That is the case
      // the gate cannot prevent and this is why the withdrawal cannot live inside the gate.
      const stillOpen = evicted.state.choices.find((c) => c.choice.kind === 'choose-peg-dest');
      expect(stillOpen, `${where}: the stale relocation survived the eviction — a dead table`).toBeUndefined();
      expect(evicted.state.choices.filter((c) => c.player === pegDest.player), `${where}: the answerer is still frozen`).toHaveLength(0);
      expect(evicted.state.log.some((l) => /relocation lapses/i.test(l.text)), `${where}: the withdrawal was silent`).toBe(true);
      // …and nothing relocated: the only peg that moved was the one the eviction named.
      expect(evicted.state.zones.flatMap((z) => z.areas).filter((a) => a.peg !== null).length, `${where}: the withdrawal moved a peg`).toBe(0);
      expect(reduce(evicted.state, 'p1', { type: 'END_TURN' }, ctx).ok, `${where}: the table is still dead`).toBe(true);
    }
  });
});

describe('G1 — the regression halves that keep the two layers honest', () => {
  it('a relocation whose peg is merely a MAJORITY peg, with another peg free, still moves legally', () => {
    // The withdrawal must not fire early. `pegMoveOffered` is about the PAIR SPACE, not
    // about the peg the player picked, so a board where p1 holds one majority peg and one
    // movable peg must accept the movable one and refuse the majority one.
    for (const n of SEAT_COUNTS) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const base = stage(seats);
      const seeded: GameState = {
        ...base,
        zones: base.zones.map((z) => ({
          ...z,
          areas: z.areas.map((a) => {
            if (a.id === PEG) return { ...a, peg: { owner: 'p1' as PlayerID, majority: true } };
            if (a.id === LANDING) return { ...a, peg: { owner: 'p1' as PlayerID, majority: false } };
            return a;
          }),
        })),
      };
      const { state: raised, pending } = raiseRelocation(seeded);
      // `north` neighbours `west`, so `west-01` is a legal landing for the peg in `north`
      // and `north-02` is not — the peg's own zone.
      const good = reduce(raised, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: LANDING, toAreaId: LANDING_WEST } }, ctx);
      expect(good.ok, `${n} seats: a movable peg beside a majority peg was refused`).toBe(true);
      expect(good.ok && relocated(good, raised), `${n} seats: nothing moved`).toBe(true);
      const bad = reduce(raised, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: PEG, toAreaId: LANDING_WEST } }, ctx);
      expect(bad.ok, `${n} seats: a majority peg was movable`).toBe(false);
      const sameZone = reduce(raised, pending.player, { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'peg-dest', areaId: LANDING, toAreaId: 'north-02' } }, ctx);
      expect(sameZone.ok, `${n} seats: a same-zone landing was accepted`).toBe(false);
    }
  });

  it('the gate does not fire when NO relocation is open, so the table plays normally', () => {
    // The regression half of the regression half: a gate that is too wide is its own
    // dead table, so the ordinary turn — answer, influence, end turn — must still work
    // with nothing pending.
    for (const n of SEAT_COUNTS) {
      const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const base = fresh(1, seats);
      const withPools: GameState = {
        ...base,
        players: Object.fromEntries(seats.map((id) => [id, { ...base.players[id]!, resources: POOL_BUYING }])) as GameState['players'],
      };
      const answered = reduce(withPools, 'p1', { type: 'ANSWER', side: 0 }, ctx);
      expect(answered.ok, `${n} seats: ANSWER`).toBe(true);
      if (!answered.ok) continue;
      expect(answered.state.choices, `${n} seats: the opening raised something`).toHaveLength(0);
      const influenced = reduce(answered.state, 'p1', { type: 'INFLUENCE', slot: 0 }, ctx);
      expect(influenced.ok, `${n} seats: INFLUENCE with nothing pending: ${influenced.ok ? '' : influenced.error}`).toBe(true);
      if (!influenced.ok) continue;
      const ended = reduce(influenced.state, 'p1', { type: 'END_TURN' }, ctx);
      expect(ended.ok, `${n} seats: END_TURN with nothing pending: ${ended.ok ? '' : ended.error}`).toBe(true);
    }
  });

  it('and the fix added no mutable state: the same fixture twice is byte-identical', () => {
    // The gate is a pure read of `state.choices` and the lapse writes only what every
    // other resolution writes, so replay determinism is untouched. `rng.test.ts`'s
    // "a full replay from seed + action log reproduces every intermediate state" owns the
    // exhaustive version; this is the assertion that the fix itself is pure, stated where
    // the fix is, and it fails if anybody reaches for module scope to implement the gate.
    const a = raiseRelocation(stage(['p1', 'p2']));
    const b = raiseRelocation(stage(['p1', 'p2']));
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.pending)).toBe(JSON.stringify(b.pending));
  });
});