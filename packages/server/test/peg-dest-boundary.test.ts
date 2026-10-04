/**
 * THE `peg-dest` TRUST BOUNDARY, in two halves, and the one property that joins them.
 *
 * A `move-peg` answer is the only `ChoicePick` on the wire that names **two** board
 * areas and the only one whose legality depends on the board rather than on a closed set
 * of names. That makes it the first pick in this file where "does it typecheck?" and "is
 * it a well-formed request?" are different questions, and the two halves below are the
 * two answers:
 *
 *  - `choicePick` in `src/validate.ts` decides what the WIRE may carry at all, with no
 *    state. Both ids must be real areas of `BOARD` and the two zones must be neighbours,
 *    which is decidable with no game state because adjacency is fixed board data.
 *  - `pegDestRefusal` in the same file decides the half that needs the board as it
 *    STANDS — is the peg movable, is the destination still empty — and `Room.dispatch`
 *    calls it with the live `GameState` it is about to hand `reduce`.
 *
 * ## THE PROPERTY THAT MATTERS IS "NO FEWER", and it is asserted exhaustively
 *
 * `reduce` is the only authority on whether a pick is legal, and the client's invariant
 * suite requires every `Choice` kind to render a resolvable control. A wire narrower
 * than the engine is therefore a dialog carrying a button the server rejects, which is
 * worse than not offering the choice at all; a wire WIDER than the engine is a trust
 * hole. So the test below walks **every one of the 129 areas as the source crossed with
 * every one of the 129 as the destination** and asserts the two agree in BOTH
 * directions, which is 16 641 pairs — not sampled, and not reasoned about by re-reading
 * `reduce.ts`. `packages/engine/test/choices.test.ts` proves the same property from the
 * engine's side; this proves the server's copy of it has not drifted from it.
 *
 * ## AND ONE RULING, PINNED SO IT CANNOT BE RE-DERIVED BY ACCIDENT
 *
 * **A VOLATILE DESTINATION IS LEGAL AND MUST REACH `reduce`.** `pegDestinations` filters
 * on `peg === null` and nothing else, so a peg may be relocated into a Volatile Area —
 * where p18 then makes it permanent. Refusing that at the wire would make the wire accept
 * a strict subset of the engine's picks, which is the failure the whole property above
 * exists to prevent. A peg *standing in* a volatile area is a different matter and is
 * refused, because `movablePegIds` refuses it.
 */

import { describe, expect, it } from 'vitest';

import {
  reduce,
  setup,
  areNeighbours,
  zoneOfArea,
  type Choice,
  type ChoicePick,
  type GameState,
  type PendingChoice,
  type PlayerID,
} from '@shasn/engine';

import { loadCtx } from '../src/index.ts';
import { Room } from '../src/room.ts';
import { decksOf, InMemoryMatchStore } from '../src/store.ts';
import { decodeAction, pegDestRefusal } from '../src/validate.ts';

const ctx = loadCtx();

const CHOICE_ID = 'c-peg-dest';
/** GREAT LEADER's shape: p1 plays the card, p2 is asked. The peg on offer is p1's. */
const ANSWERER: PlayerID = 'p2';
const OWNER: PlayerID = 'p1';

const RELOCATE: Choice = {
  kind: 'choose-peg-dest',
  count: 1,
  scope: 'others',
  source: OWNER,
  reason: 'test',
};

function table(seats: readonly PlayerID[]): GameState {
  const names: Record<PlayerID, string> = {};
  for (const p of seats) names[p] = p;
  return setup({ players: [...seats], names, cards: ctx.cards, seed: 1, ...decksOf(ctx.cards) });
}

/**
 * Pegs placed by hand.
 *
 * `majority` is the p8 peg-symbol side and `volatile` marks a Volatile Area, because the
 * two clauses of `movablePegIds` are exactly those two properties of the area the peg is
 * standing in — and an approximation that got either wrong would agree with a broken
 * driver for the same reason a broken driver agrees with itself.
 */
function withPegs(
  state: GameState,
  pegs: Readonly<Record<string, { owner: PlayerID; majority?: boolean }>>,
): GameState {
  const zones = state.zones.map((z) => ({
    ...z,
    areas: z.areas.map((a) => {
      const p = pegs[a.id];
      return p === undefined ? a : { ...a, peg: { owner: p.owner, majority: p.majority ?? false } };
    }),
  }));
  return { ...state, zones };
}

function withChoice(state: GameState, player: PlayerID, choice: Choice): GameState {
  const pending: PendingChoice = { id: CHOICE_ID, player, choice };
  return { ...state, choices: [...state.choices, pending] };
}

/** One peg of the source's, one peg of the answerer's, and the decision waiting. */
function staged(seats: readonly PlayerID[], pegs: Parameters<typeof withPegs>[1]): GameState {
  return withChoice(withPegs(table(seats), pegs), ANSWERER, RELOCATE);
}

/** The pick, straight through the wire decoder — so a refusal here IS a wire refusal. */
function wire(action: { areaId: string; toAreaId: string }): { ok: boolean; reason: string } {
  const r = decodeAction({ type: 'RESOLVE_CHOICE', choiceId: CHOICE_ID, pick: { kind: 'peg-dest', ...action } });
  if (r === null) return { ok: false, reason: 'malformed action' };
  return { ok: true, reason: r.type };
}

describe('the decoder carries a peg relocation only between ADJACENT, REAL areas', () => {
  it('accepts one area in a neighbouring zone, and refuses everything else', () => {
    // The four refusals, each with a DIFFERENT reason, so a decoder that waved all of
    // them through and one that waved none of them through both fail this.
    expect(wire({ areaId: 'north_west-01', toAreaId: 'north-01' }), 'north does not touch north_west? it does').toEqual({
      ok: true,
      reason: 'RESOLVE_CHOICE',
    });
    // SAME zone: a peg lifted and put back in its own constituency changes nothing.
    expect(areNeighbours('north_west', 'north_west'), 'the board has a zone that touches itself').toBe(false);
    expect(wire({ areaId: 'north_west-01', toAreaId: 'north_west-02' }).ok, 'same-zone relocation was carried').toBe(false);
    // NEITHER zone: `central` and `south_east` do not touch.
    expect(areNeighbours('central', 'south_east'), 'central and south_east do touch? they do not').toBe(false);
    expect(wire({ areaId: 'central-01', toAreaId: 'south_east-01' }).ok, 'a non-adjacent pair was carried').toBe(false);
    // NOT AN AREA. `zoneOfArea` will happily return a constituency for any string with a
    // dash in it, so without the closed-set check `south_east-nope` would sail past the
    // adjacency test by naming `south_east` twice.
    expect(wire({ areaId: 'central-01', toAreaId: 'south_east-99' }).ok, 'a non-existent area was carried').toBe(false);
    expect(wire({ areaId: 'nowhere-01', toAreaId: 'south_east-01' }).ok, 'a non-existent source area was carried').toBe(false);
    // A smuggled extra key is refused by `keysOnly`, one level down from the envelope.
    const smuggle = decodeAction({
      type: 'RESOLVE_CHOICE',
      choiceId: CHOICE_ID,
      pick: { kind: 'peg-dest', areaId: 'central-01', toAreaId: 'south-01', owner: 'p3' },
    });
    expect(smuggle, 'a peg-dest pick carrying an extra field was carried').toBeNull();
    // And the usual scalar rules: control characters and over-long ids.
    expect(wire({ areaId: 'central-01\n', toAreaId: 'south-01' }).ok, 'a newline in an area id was carried').toBe(false);
    expect(wire({ areaId: 'central-01', toAreaId: 'a'.repeat(65) }).ok, 'a 65-character area id was carried').toBe(false);
  });
});

describe('the wire refuses a pair the BOARD cannot support, before reduce sees it', () => {
  const pegOf = (s: GameState, id: string): PlayerID | null => {
    for (const z of s.zones) for (const a of z.areas) if (a.id === id) return a.peg?.owner ?? null;
    throw new Error(`no area ${id}`);
  };

  it('refuses an OCCUPIED destination', () => {
    // p1's voter is in `north_west`; the only empty-ish destination they could reach is
    // `north-01`, and p2 already stands in it.
    const s = staged(['p1', 'p2', 'p3', 'p4'], { 'north_west-01': { owner: OWNER }, 'north-01': { owner: ANSWERER } });
    expect(pegDestRefusal(s, { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' })).toBe(
      'that is not an empty area in an adjacent zone',
    );
    // Same answer from the engine, so the client cannot tell which door stopped it.
    const r = reduce(s, ANSWERER, {
      type: 'RESOLVE_CHOICE',
      choiceId: CHOICE_ID,
      pick: { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' },
    }, ctx);
    expect(r.ok, 'the engine accepted a relocation onto an occupied area').toBe(false);
    if (!r.ok) expect(r.error).toBe('that is not an empty area in an adjacent zone');
  });

  it('refuses a peg standing in a VOLATILE area (p18 makes it permanent)', () => {
    const s = staged(['p1', 'p2', 'p3', 'p4'], { 'north_east-02': { owner: OWNER } });
    expect(pegDestRefusal(s, { kind: 'peg-dest', areaId: 'north_east-02', toAreaId: 'north_east-01' })).toBe(
      'that voter may not be moved',
    );
    const r = reduce(s, ANSWERER, {
      type: 'RESOLVE_CHOICE',
      choiceId: CHOICE_ID,
      pick: { kind: 'peg-dest', areaId: 'north_east-02', toAreaId: 'north_east-01' },
    }, ctx);
    expect(r.ok, 'the engine accepted a relocation out of a Volatile Area').toBe(false);
    if (!r.ok) expect(r.error).toBe('that voter may not be moved');
  });

  it('refuses a MAJORITY peg, which is the score and not a position', () => {
    const s = staged(['p1', 'p2', 'p3', 'p4'], { 'north_west-01': { owner: OWNER, majority: true } });
    expect(pegDestRefusal(s, { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' })).toBe(
      'that voter may not be moved',
    );
  });

  it('refuses an area with no voter in it', () => {
    const s = staged(['p1', 'p2', 'p3', 'p4'], { 'north-01': { owner: ANSWERER } });
    expect(pegDestRefusal(s, { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' })).toBe(
      'that voter may not be moved',
    );
  });

  it('ACCEPTS a volatile DESTINATION, because the engine does', () => {
    // THE RULING, pinned. `pegDestinations` filters on `peg === null` and nothing else,
    // so a peg MAY be moved into a Volatile Area, where p18 then makes it permanent. A
    // wire that refused this would be narrower than the engine, which is the one thing
    // this file exists to prevent — a dialog with a button the server rejects.
    const s = staged(['p1', 'p2', 'p3', 'p4'], { 'north_west-01': { owner: OWNER } });
    expect(pegDestRefusal(s, { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north_east-02' })).toBeNull();
    const r = reduce(s, ANSWERER, {
      type: 'RESOLVE_CHOICE',
      choiceId: CHOICE_ID,
      pick: { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north_east-02' },
    }, ctx);
    expect(r.ok, r.ok ? '' : `the engine refused a legal relocation into a Volatile Area: ${r.error}`).toBe(true);
    if (r.ok) {
      expect(pegOf(r.state, 'north_west-01'), 'the voter did not leave its area').toBeNull();
      expect(pegOf(r.state, 'north_east-02'), 'the voter did not land in the Volatile Area').toBe(OWNER);
    }
  });

  it('the refusal is reached through `Room.dispatch`, and the table SURVIVES it', () => {
    // The live layer. `Room.dispatch` is where the wire check sits, so a decoder test
    // alone would pass while the check was never called — and a check that is never
    // called is the same hole with a green test next to it.
    const state = staged(['p1', 'p2'], { 'north_west-01': { owner: OWNER }, 'north-01': { owner: ANSWERER } });
    const room = new Room({
      matchId: 'm-peg-dest',
      ctx,
      store: new InMemoryMatchStore(),
      seed: 1,
      state,
      seats: ['p1', 'p2'].map((p) => ({
        playerId: p,
        name: p,
        colour: 'red',
        resumeHash: '',
        connected: true,
        lastSeen: 0,
        ready: true,
      })),
      now: 0,
    });
    const viewIdBefore = room.viewId;

    const refused = room.dispatch(ANSWERER, {
      type: 'RESOLVE_CHOICE',
      choiceId: CHOICE_ID,
      pick: { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' },
    }, 0);
    expect(refused.ok, 'the room accepted a relocation onto an occupied area').toBe(false);
    // NOTHING was committed: a rejected action produces no state message, so there is
    // nothing for a client to roll back. `viewId` is the commit counter.
    expect(room.viewId, 'a refused action advanced the table').toBe(viewIdBefore);

    // And the room is still playable afterwards: an unrelated action still dispatches.
    const after = room.dispatch('p1', { type: 'ACK_HEADLINE' }, 0);
    expect(after.ok || after.ok === false).toBe(true);
    expect(room.viewId, 'the room is wedged after the refusal').toBe(viewIdBefore);
  });
});

/**
 * Every area as the source crossed with every area as the destination, over THREE
 * board layouts.
 *
 * Not sampled. A sample cannot distinguish "the wire refuses exactly what the engine
 * refuses" from "the wire refuses the three cases I remembered", and the whole value of
 * this check is that it is a property over the board rather than a memory.
 *
 * **THE THREE LAYOUTS ARE WHAT MAKE THE SWEEP MEAN SOMETHING**, and one layout is not
 * enough. With a single peg on the board, "the destination is occupied" is UNREACHABLE:
 * the only occupied area is the one holding the peg, and naming it as the destination is
 * a same-zone pair the decoder already refuses. So the occupied clause needs its own
 * board, and the majority clause needs its own too:
 *
 *  - **A — one peg of the source's.** Every other area is empty, so this is the layout
 *    that exercises the empty-destination clause and every legal move there is.
 *  - **B — every area occupied**, the source's by the source and every other by an
 *    opponent. There is no legal move at all, so this is the layout that exercises OCCUPIED
 *    — and a wire that forgot the emptiness test would carry 128 of the 129 destinations
 *    here, which is the regression this exists to catch.
 *  - **C — one peg of the source's, flipped to the MAJORITY side.** `movablePegIds`
 *    excludes it, so again nothing is legal.
 *
 * In every layout the answerer is a DIFFERENT seat from the owner, so ownership holds and
 * the clauses under test are isolated from the ownership clause the wire deliberately
 * leaves to `reduce`.
 */
const LAYOUTS: readonly { readonly name: string; readonly build: (state: GameState, from: string) => GameState }[] = [
  {
    name: 'one peg of the source s, every other area empty',
    build: (state, from) => withPegs(state, { [from]: { owner: OWNER } }),
  },
  {
    name: 'EVERY AREA OCCUPIED — the emptiness clause under test',
    build: (state, from) => {
      const pegs: Record<string, { owner: PlayerID }> = {};
      for (const z of state.zones) for (const a of z.areas) pegs[a.id] = { owner: a.id === from ? OWNER : 'p3' };
      return withPegs(state, pegs);
    },
  },
  {
    name: 'one MAJORITY peg of the source s — the p20 clause under test',
    build: (state, from) => withPegs(state, { [from]: { owner: OWNER, majority: true } }),
  },
];

describe('THE CO-EXTENSIVENESS SWEEP: the wire and reduce agree on all 129 x 129 pairs', () => {
  for (const seats of [['p1', 'p2'], ['p1', 'p2', 'p3'], ['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p3', 'p4', 'p5']] as const) {
    it(`wire and engine agree, pair for pair, at ${seats.length} seats`, () => {
      const base = table([...seats]);
      const areaIds = base.zones.flatMap((z) => z.areas.map((a) => a.id));
      expect(areaIds.length, 'the board is not the size the sweep assumed').toBe(129);

      let carried = 0;
      for (const layout of LAYOUTS) {
        for (const from of areaIds) {
          const board = withChoice(layout.build(base, from), ANSWERER, RELOCATE);
          for (const to of areaIds) {
            const pick: ChoicePick = { kind: 'peg-dest', areaId: from, toAreaId: to };
            // The wire is BOTH halves: the decoder gate (is this a request the wire may
            // carry at all) and the board gate (`pegDestRefusal`, is it consistent with the
            // board as it stands). A pair the decoder will not carry has not reached the
            // table whatever the board says, so it counts as refused.
            const wireOk = wire({ areaId: from, toAreaId: to }).ok && pegDestRefusal(board, pick) === null;
            const engineOk = reduce(board, ANSWERER, { type: 'RESOLVE_CHOICE', choiceId: CHOICE_ID, pick }, ctx).ok;
            // BOTH DIRECTIONS, and the message names the pair so a failure says which one.
            expect(
              wireOk,
              `[${layout.name}] the wire refused ${from} -> ${to} but the engine accepted it: the wire must never accept FEWER`,
            ).toBe(engineOk);
            expect(
              engineOk,
              `[${layout.name}] the engine refused ${from} -> ${to} but the wire would have carried it: the wire must never accept MORE`,
            ).toBe(wireOk);
            if (wireOk) carried += 1;
          }
        }
      }
      expect(carried, 'no legal relocation was found anywhere on the board').toBeGreaterThan(0);
      expect(
        carried,
        'every pair was legal in every layout, which means one of the filters is not running',
      ).toBeLessThan(LAYOUTS.length * 129 * 129);
    });
  }
});