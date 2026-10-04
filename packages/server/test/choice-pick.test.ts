/**
 * The two name-shaped decisions, and the arm that must refuse them.
 *
 * WHY A FILE FOR TWO ARMS
 *
 * `pickForChoice`'s `default: return null` is a deliberate guard with a comment saying a
 * new choice kind should FAIL LOUDLY rather than be answered with an empty area list.
 * When G1 (`'choose-player'`) and G16 (`'choose-zone'`) landed, it did exactly that: 35
 * failures across four files, all one message, from `nextAction`'s `no legal pick for
 * choice cNN`. The guard working and the suite going red are the same event, which means
 * the only honest record of it is a test that says so.
 *
 * Four claims, and each is the kind that fails loudly rather than passing quietly:
 *
 *  1. **Both kinds are ANSWERABLE.** A driver that cannot answer a decision its table is
 *     waiting on does not play badly, it deadlocks: `reduce` refuses every other action
 *     for a frozen player.
 *  2. **THE PICKS ARE INSIDE THE ENGINE'S ACCEPTED SET** — checked by handing them to
 *     `reduce` and requiring `ok`, not by re-deriving the set here. A second
 *     transcription in a test would agree with a broken driver for the same reason a
 *     broken driver agrees with itself.
 *  3. **THE SET IS NOT NARROWED BY HOLDINGS.** A player holding nothing is still a legal
 *     answer and still gets picked when they are the only candidate. A driver that
 *     filtered by resources would leak every opponent's mat through the option list — a
 *     seat's absence from a dialog is information about that seat — and this is the
 *     assertion that keeps that filter from coming back.
 *  4. **AN UNKNOWN KIND STILL FAILS LOUDLY.** `pickForChoice` returns `null` and
 *     `nextAction` throws with the kind in the message. Nothing here widens that arm, and
 *     a fifth `Choice` kind breaks this file until somebody teaches the driver about it —
 *     which is the entire design.
 */

import { describe, expect, it } from 'vitest';

import {
  playerView,
  reduce,
  setup,
  zoneOfArea,
  type CardIndex,
  type Choice,
  type ChoicePick,
  type ClientState,
  type Effect,
  type GameState,
  type PendingChoice,
  type PlayerID,
  type ZoneID,
} from '@shasn/engine';

import { loadCards, loadCtx } from '../src/index.ts';
import { decksOf } from '../src/store.ts';
import { nextAction, pickForChoice } from './driver.ts';

const cards: CardIndex = loadCards();

/** Four seats, so "somebody other than me" has more than one answer. */
function table(seed = 1): GameState {
  const players = ['p1', 'p2', 'p3', 'p4'];
  const names: Record<PlayerID, string> = {};
  for (const p of players) names[p] = p;
  return setup({ players, names, cards, seed, ...decksOf(cards) });
}

/**
 * Put pegs on the board, by hand.
 *
 * A fixture building a position by hand is the normal thing to do and this is not a
 * shortcut: the claims here are about which pick the driver makes from a projection, and
 * reaching these positions by play would make every case depend on a whole game's
 * trajectory — which is precisely how the states these assertions are about stopped being
 * reachable at all once the corpus grew.
 */
function withPegs(state: GameState, placements: Readonly<Record<string, PlayerID>>): GameState {
  const zones = state.zones.map((z) => ({
    ...z,
    areas: z.areas.map((a) => {
      const owner = placements[a.id];
      // `majority: false` is the p8 peg-symbol side; nothing here is about majority pegs.
      return owner === undefined ? a : { ...a, peg: { owner, majority: false } };
    }),
  }));
  return { ...state, zones };
}

function withChoice(state: GameState, id: string, player: PlayerID, choice: Choice): GameState {
  const pending: PendingChoice = { id, player, choice };
  return { ...state, choices: [...state.choices, pending] };
}

const view = (s: GameState, me: PlayerID): ClientState => playerView(s, me);

/** Hand the pick to the engine, which is the only authority on whether it is legal. */
function answer(s: GameState, chooser: PlayerID, id: string, pick: ChoicePick): ReturnType<typeof reduce> {
  return reduce(s, chooser, { type: 'RESOLVE_CHOICE', choiceId: id, pick }, loadCtx());
}

/** The `PendingChoice` at `id`, which every case above put there itself. */
function pendingOf(s: GameState, id: string): PendingChoice {
  const found = s.choices.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no choice ${id}`);
  return found;
}

/** One peg, by hand, on a fresh table — the majority side is p8's peg-symbol side. */
function withPeg(state: GameState, areaId: string, owner: PlayerID, majority: boolean): GameState {
  const zones = state.zones.map((z) => ({
    ...z,
    areas: z.areas.map((a) => (a.id === areaId ? { ...a, peg: { owner, majority } } : a)),
  }));
  return { ...state, zones };
}

function areaOwner(s: GameState, areaId: string): PlayerID | null {
  for (const z of s.zones) {
    for (const a of z.areas) if (a.id === areaId) return a.peg?.owner ?? null;
  }
  throw new Error(`no area ${areaId}`);
}

function areaMajority(s: GameState, areaId: string): boolean {
  for (const z of s.zones) {
    for (const a of z.areas) if (a.id === areaId) return a.peg?.majority ?? false;
  }
  throw new Error(`no area ${areaId}`);
}

/** The constituency an area name belongs to, from the BOARD rather than from the state. */
function zoneOf(areaId: string): string {
  return zoneOfArea(areaId);
}

describe('the driver answers the two name-shaped decisions', () => {
  it('choose-player: names a seat, and the engine accepts the answer', () => {
    // WHAT THE LONG FACE? / FATALITY's shape: the card's actor names a player and the
    // effect re-runs against them.
    const effect: Effect = { op: 'voters', n: 1, target: 'chosen-player' };
    const s = withChoice(table(), 'c-test-cp', 'p1', {
      kind: 'choose-player',
      count: 1,
      effects: [effect],
      source: 'p1',
      reason: 'test',
    });

    const pick = pickForChoice(view(s, 'p1'), pendingOf(s, 'c-test-cp'));
    expect(pick, 'the driver could not answer a choose-player').not.toBeNull();
    expect(pick?.kind).toBe('player');

    // Inside the accepted set, by the only measure that counts: the reducer agreed.
    const r = answer(s, 'p1', 'c-test-cp', pick as ChoicePick);
    expect(r.ok, r.ok ? '' : `the engine refused the driver's pick: ${r.error}`).toBe(true);

    // And it is a REAL seat, not the chooser: `turnOrder` minus the actor, which is the
    // expression `applyEffect` builds the candidate set from and `resolveChoice`
    // validates against. Naming yourself is the redirect nobody authorised.
    const named = (pick as { id: PlayerID }).id;
    expect(s.turnOrder).toContain(named);
    expect(named).not.toBe('p1');
    // The named seat now holds what the card said they would: one pending group.
    expect(r.ok ? (r.state.players[named]?.pending.length ?? 0) : -1).toBe(1);
  });

  it('choose-player: a player holding NOTHING is still offered, and is still the pick', () => {
    // THE LEAK ASSERTION, and the reason for it. A seat's ABSENCE from a dialog tells
    // the chooser that seat holds nothing, so filtering the candidate set by resources
    // makes the option list a readout of every opponent's mat. The engine offers the
    // whole table; the driver must offer the whole table too.
    //
    // Two seats, and the only candidate holds nothing at all: no resources, no
    // conspiracies, no pending voters. If any holdings filter exists anywhere in the
    // pick, this is the state that finds it.
    const players = ['p1', 'p2'];
    const names: Record<PlayerID, string> = { p1: 'p1', p2: 'p2' };
    const dealt: GameState = setup({ players, names, cards, seed: 2, ...decksOf(cards) });
    const p2 = dealt.players.p2;
    if (p2 === undefined) throw new Error('no p2');
    const stripped: GameState = {
      ...dealt,
      players: {
        ...dealt.players,
        p2: { ...p2, resources: { funds: 0, clout: 0, media: 0, trust: 0 }, conspiracies: [], pending: [] },
      },
    };
    const s = withChoice(stripped, 'c-test-empty', 'p1', {
      kind: 'choose-player',
      count: 1,
      effects: [{ op: 'voters', n: 1, target: 'chosen-player' }],
      source: 'p1',
      reason: 'test',
    });

    expect(s.players.p2?.resources).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
    expect(s.players.p2?.conspiracies).toEqual([]);
    expect(pickForChoice(view(s, 'p1'), pendingOf(s, 'c-test-empty')), 'a seat holding nothing was not offered').toEqual({
      kind: 'player',
      id: 'p2',
    });
    expect(answer(s, 'p1', 'c-test-empty', { kind: 'player', id: 'p2' }).ok).toBe(true);
  });

  it('choose-zone: names a constituency the engine will accept', () => {
    // CUT, COPY, AND PASTE's shape: `discard-voter` narrowed by `zone: 'chosen-zone'`.
    // `target: 'you'` is what makes `voterScope` return `'own'`, so the legal zones are
    // the ones holding a peg of the CHOOSER'S — the clause an approximation gets wrong by
    // using `'others'` for every voter op, which offers a zone the server refuses.
    const placed = withPegs(table(), { 'north_west-01': 'p2', 'north_west-02': 'p1' });
    const s = withChoice(placed, 'c-test-cz', 'p1', {
      kind: 'choose-zone',
      count: 1,
      effects: [{ op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' }],
      source: 'p1',
      reason: 'test',
    });

    const pick = pickForChoice(view(s, 'p1'), pendingOf(s, 'c-test-cz'));
    expect(pick?.kind, 'the driver could not answer a choose-zone').toBe('zone');
    const zoneId = (pick as { zoneId: ZoneID }).zoneId;
    expect(zoneId, 'the driver did not name the constituency holding my own voter').toBe('north_west');

    const r = answer(s, 'p1', 'c-test-cz', pick as ChoicePick);
    expect(r.ok, r.ok ? '' : `the engine refused the driver's zone: ${r.error}`).toBe(true);

    // OFFERED == ACCEPTED, in both directions. A zone the chooser holds nothing in is
    // not offered, and the engine refuses it: a dialog carrying a button the server
    // rejects is worse than not offering the choice at all, because the player believes
    // they have finished.
    const elsewhere = withPegs(table(), { 'central-01': 'p2' });
    const s2 = withChoice(elsewhere, 'c-test-cz2', 'p1', {
      kind: 'choose-zone',
      count: 1,
      effects: [{ op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' }],
      source: 'p1',
      reason: 'test',
    });
    expect(pickForChoice(view(s2, 'p1'), pendingOf(s2, 'c-test-cz2')), 'a zone with no voter of mine was offered').toBeNull();
    const refused = answer(elsewhere, 'p1', 'c-test-cz2', { kind: 'zone', zoneId: 'central' });
    expect(refused.ok, 'the engine accepted a zone the decision could not name').toBe(false);
  });

  /**
 * G1 — GREAT LEADER, BAD ECONOMY's decision, answered by somebody who is NOT the seat
 * whose voter moves.
 *
 * Four claims, and the second is the one a plausible driver gets wrong:
 *
 *  1. **The pair is ANSWERABLE, and the engine accepts it.** Checked by handing the
 *     driver's pick to `reduce` and requiring `ok` — never by re-deriving the accepted
 *     set here, for the reason this file's header gives: a second transcription agrees
 *     with a broken driver for exactly the same reason a broken driver agrees with
 *     itself. The peg is then read back off the resulting board, so "accepted" means
 *     the board moved rather than that a function returned true.
 *  2. **THE PEG BELONGS TO `source`, NOT TO THE ANSWERER.** `scope` is DESCRIPTIVE —
 *     `resolveChoice` decides on `peg.owner === c.source` and never reads `scope` — so a
 *     driver that filtered on `scope` would either find nothing at all (`scope: 'own'`
 *     compared against `choice.player` on GREAT LEADER's real shape) or name a
 *     different seat's voter. Both throw `no legal pick` on a table the engine had just
 *     made answerable.
 *  3. **A VOLATILE peg is not a candidate and an OCCUPIED area is not a destination.**
 *     Both clauses of `movablePegIds` / `pegDestinations`, asserted by building boards
 *     where the only thing wrong is that one of them was violated.
 *  4. **NO LEGAL PAIR IS `null`, not a guess.** `pegMoveOffered` guarantees a pair at
 *     raise time, so reaching this with `null` means the board moved under a stale
 *     dialog — and `nextAction` turns that into a throw rather than a silent bad move.
 */
describe('the driver answers a peg relocation, for a seat that does not own the peg', () => {
  const RELOCATE: Choice = {
    kind: 'choose-peg-dest',
    count: 1,
    // GREAT LEADER is played by one seat and answered by the player after them, which is
    // the only way `'others'` is ever produced.
    scope: 'others',
    source: 'p1',
    reason: 'test',
  };

  it("names one of the SOURCE's voters and an adjacent empty area, and the engine moves it", () => {
    // p1 (the card's actor) has one voter in `north_west`; p2 is the answerer and has
    // one of their own in `north_east-02`, which is a VOLATILE area — so it must be
    // skipped as a source and, being occupied, skipped as a destination too.
    const placed = withPegs(table(), { 'north_west-01': 'p1', 'north_east-02': 'p2' });
    const s = withChoice(placed, 'c-test-pd', 'p2', RELOCATE);

    const pick = pickForChoice(view(s, 'p2'), pendingOf(s, 'c-test-pd'));
    expect(pick?.kind, 'the driver could not answer a choose-peg-dest').toBe('peg-dest');
    const pair = pick as { areaId: string; toAreaId: string };

    // CLAIM 2. The peg on offer is the SOURCE's, and it is emphatically not the
    // answerer's: p2 owns a peg here and it was not the one named.
    expect(pair.areaId).toBe('north_west-01');
    expect(pair.areaId === 'north_east-02', 'the driver named the ANSWERER s volatile peg').toBe(false);

    // CLAIM 1, read off the board rather than off a return value.
    const r = answer(s, 'p2', 'c-test-pd', pick as ChoicePick);
    expect(r.ok, r.ok ? '' : `the engine refused the driver's pair: ${r.error}`).toBe(true);
    const after = r.ok ? r.state : s;
    expect(areaOwner(after, pair.areaId), 'the voter did not leave its area').toBeNull();
    expect(areaOwner(after, pair.toAreaId), 'the voter did not land where the driver said').toBe('p1');
    // And the peg kept its OWNER: a relocation moves position, not allegiance.
    expect(areaMajority(after, pair.toAreaId)).toBe(false);
  });

  it('refuses a VOLATILE peg as the source even when it is the only one the source owns', () => {
    // p1 owns exactly one peg and it stands in `north_east-02`, a Volatile Area: p18
    // makes a peg there permanent, so `movablePegIds` excludes it. There is no pair, so
    // the driver must say so rather than move a permanent peg.
    const placed = withPegs(table(), { 'north_east-02': 'p1' });
    const s = withChoice(placed, 'c-test-pd-vol', 'p2', RELOCATE);

    expect(
      pickForChoice(view(s, 'p2'), pendingOf(s, 'c-test-pd-vol')),
      'the driver offered to move a peg in a Volatile Area',
    ).toBeNull();
    // And the engine agrees, which is the measure rather than the driver's own opinion:
    // naming that area explicitly is refused by the reducer.
    const refused = answer(s, 'p2', 'c-test-pd-vol', { kind: 'peg-dest', areaId: 'north_east-02', toAreaId: 'north_east-01' });
    expect(refused.ok, 'the engine accepted a move out of a Volatile Area').toBe(false);
  });

  it('refuses a MAJORITY peg as the source', () => {
    // p1 holds the majority in `north_west`; a majority peg IS the score (p20), so
    // relocating one would move points rather than position.
    const placed = withPeg(table(), 'north_west-01', 'p1', true);
    const s = withChoice(placed, 'c-test-pd-maj', 'p2', RELOCATE);

    expect(
      pickForChoice(view(s, 'p2'), pendingOf(s, 'c-test-pd-maj')),
      'the driver offered to move a majority peg',
    ).toBeNull();
    expect(
      answer(s, 'p2', 'c-test-pd-maj', { kind: 'peg-dest', areaId: 'north_west-01', toAreaId: 'north-01' }).ok,
      'the engine accepted a move of a majority peg',
    ).toBe(false);
  });

  it('never names a destination that is not in a NEIGHBOURING zone', () => {
    // p1 owns one voter, in `central`. `central` neighbours north / west / east / south
    // and nothing else, so `south_east-01` — which is empty — is not a legal destination
    // however badly the driver wanted it. Walk every adjacent zone the driver might
    // reach and assert the destination is inside one of them, which is the claim
    // expressed as a property rather than as one lucky pair.
    const placed = withPegs(table(), { 'central-01': 'p1' });
    const s = withChoice(placed, 'c-test-pd-adj', 'p2', RELOCATE);
    const pick = pickForChoice(view(s, 'p2'), pendingOf(s, 'c-test-pd-adj')) as { toAreaId: string } | null;
    expect(pick, 'the driver could not answer with a voter in `central`').not.toBeNull();

    const central = s.zones.find((z) => z.id === 'central');
    expect(central).toBeDefined();
    const neighbours = central?.neighbours ?? [];
    expect(neighbours).toContain('north');
    expect(neighbours).not.toContain('south_east');
    expect(zoneOf(pick?.toAreaId ?? ''), 'the driver named a non-adjacent zone').not.toBe('south_east');
    expect(neighbours, 'the driver named a zone `central` does not touch').toContain(zoneOf(pick?.toAreaId ?? ''));

    // Same-zone relocation is refused as well — a peg lifted and put back in its own
    // constituency changes nothing, so the decision must never offer one.
    const sameZone = answer(s, 'p2', 'c-test-pd-adj', { kind: 'peg-dest', areaId: 'central-01', toAreaId: 'central-02' });
    expect(sameZone.ok, 'the engine accepted a relocation inside one constituency').toBe(false);
  });
});

it('an unknown choice kind still fails LOUDLY, and the default arm is what does it', () => {
    // The guard itself. A `Choice` kind this driver has never heard of gets `null` from
    // `pickForChoice`, and `nextAction` turns that `null` into a thrown error naming the
    // kind — which is the whole point of the arm, and the reason it must not be widened
    // into an empty area list.
    const unknown = {
      kind: 'choose-something-new',
      count: 1,
      effects: [],
      source: 'p1',
      reason: 'test',
    } as unknown as Choice;
    const s = withChoice(table(), 'c-test-unknown', 'p1', unknown);

    expect(pickForChoice(view(s, 'p1'), pendingOf(s, 'c-test-unknown')), 'an unknown kind was answered').toBeNull();

    let thrown: unknown = null;
    try {
      nextAction(view(s, 'p1'), 'p1');
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'an unknown choice kind did not stop the driver').toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toContain('choose-something-new');
  });
});