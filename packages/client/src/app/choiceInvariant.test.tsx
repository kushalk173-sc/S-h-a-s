/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DIALOG INVARIANT: EVERY `Choice` KIND, IN EVERY DEGENERATE STATE, HAS AT
 * LEAST ONE ENABLED CONTROL THAT RESOLVES IT — ON THE REAL BOARD.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## THE BUG CLASS, AND WHY IT HAS NOW HIT FIVE TIMES
 *
 * "A dialog with zero enabled controls." A dead `gain-any`. A cap discard. And
 * then, in one 270-turn harness run, two more:
 *
 *   - **Defect A.** `evict-voter`/`discard-voter`/`convert-voter`. The dialog
 *     said "click the highlighted slots on the board" and the board highlighted
 *     every slot the decision *cannot* touch. Proved in the live DOM: every
 *     `legal target` was EMPTY, every OCCUPIED slot read
 *     `illegal: already occupied`, and CONFIRM sat permanently disabled with no
 *     cancel anywhere on the frame.
 *   - **Defect B.** `lose-any 41` against a pool of 40. "40 of 41 chosen. 1
 *     still to choose." CONFIRM could never enable, again with no cancel.
 *
 * The engine has `expectALegalMove`-style proofs that its own reductions cannot
 * strand a table. **None of them can see a dead dialog**, because a dialog is a
 * client artefact. This file is the instrument that can.
 *
 * ## WHAT IS ACTUALLY ASSERTED, AND WHY IT IS NOT A CLASS-NAME ASSERTION
 *
 * For every scenario, over the REAL `BoardSvg` and the REAL `ChoiceResolver`:
 *
 *   1. a dialog renders;
 *   2. at least one enabled control exists, on the board OR in the dialog —
 *      the literal dead-dialog assertion, counted over both surfaces;
 *   3. pressing only controls that ADVANCE the decision reaches an enabled
 *      CONFIRM (or, for the two kinds that resolve on press, dispatches a pick);
 *   4. **no slot the board itself calls `legal target` is refused when clicked**
 *      — the assertion Defect A had no instrument for;
 *   5. the dispatched pick satisfies every rule `reduce.ts:resolveChoice`
 *      applies, quoted with the engine's own refusal strings.
 *
 * ## WHY THE BOARD IS THE REAL ONE
 *
 * `choiceResolver.test.tsx` resolves an area choice through a stand-in board it
 * renders itself, gating on the client's own `targetableAreas`. That stand-in is
 * why Defect A got through fifty green assertions: the stand-in was right and
 * `BoardSvg` was wrong, and the stand-in was the only board under test. Here the
 * board is `BoardSvg`, the interaction is `derive.ts:choiceBoardInteraction` —
 * **the same function `GameScreen` calls**, not a copy of it — and the targets
 * are found the way a screen-reader player finds them, off the `aria-label` the
 * board prints ("§8.5"). A dialog that names one set and a board that highlights
 * another is then not expressible.
 *
 * ## WHY THE ENGINE'S RULES ARE TRANSCRIBED, NOT CALLED
 *
 * `packages/server/scripts/check-secrets.mjs` fails the build on a value import of
 * `@shasn/engine` anywhere under `packages/client/src`, test files included with
 * no exemption. So this file cannot hand a pick to the real `reduce`, and the
 * engine's half of every rule below is written out with its own refusal strings.
 *
 * Two things make that a gate rather than a snapshot:
 *
 *   - the mirrors this file exercises are the SAME functions `GameScreen` uses,
 *     so a client-side drift is a red test here, not a refused action in play;
 *   - `the mirrors are pinned to reduce.ts's own source text` at the bottom reads
 *     the engine's bytes (`?raw`, the route `derive.test.ts` already uses) and
 *     fails if the expressions these rules rest on are no longer literally there.
 *
 * The residual hole — a semantic change to `resolveChoice` that keeps its
 * expressions' shape — is stated in that test rather than papered over, and it is
 * closed in play by the harness runs, where the real server accepts or refuses
 * the real pick.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
// The BYTES of the two files whose wiring this defect was in. `?raw` is the route
// `derive.test.ts` established, and it reads what the bundler sees rather than a
// copy of it — see `the mirrors these rules rest on are still literally in
// reduce.ts` below for why a source assertion is a gate and not a snapshot.
import gameScreenSource from './GameScreen.tsx?raw';
import resolverSource from './ChoiceResolver.tsx?raw';
// TYPE-ONLY. See the header: the secret gate scans this directory whole.
import type {
  Choice,
  ChoicePick,
  ClientState,
  LogEntry,
  MarketSlot,
  PlayerID,
  PlayerState,
  Pool,
  ZoneID,
} from '@shasn/engine';
// The engine's own BYTES. A value import would fail the secret gate; `?raw` is
// the route `derive.test.ts` established for exactly this reason.
import engineReduceSource from '../../../engine/src/reduce.ts?raw';

import { BoardSvg } from '../board/BoardSvg.tsx';
// Real geometry, so a fixture can never invent a slot that does not exist.
import { makeZones, putPeg } from '../board/fixtures.ts';

import { ChoiceResolver, type ChoiceResolverProps } from './ChoiceResolver.tsx';
import {
  choiceBoardInteraction,
  isVoterDecision,
  pegMoveOptions,
  pegMovePick,
  requiredPicks,
  targetableAreas,
  targetableCount,
  toBoardState,
  VOTER_KINDS,
  type VoterChoiceKind,
} from './derive.ts';

// ─────────────────────────── the fixture ───────────────────────────

const RES = ['funds', 'clout', 'media', 'trust'] as const;
const EMPTY: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

const P1: PlayerID = 'p1';
const P2: PlayerID = 'p2';
const P3: PlayerID = 'p3';

/** Real area ids, read off the generated board so the two can never drift. */
const A = {
  nw1: 'north_west-01',
  nw2: 'north_west-02',
  /** Volatile, by the generated board's own flags. */
  nwVol: 'north_west-07',
  n1: 'north-01',
  n2: 'north-02',
  n3: 'north-03',
  w1: 'west-01',
  c1: 'central-01',
  c2: 'central-02',
} as const;

function player(id: PlayerID, pool: Pool): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    colour: '#fff',
    resources: pool,
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
    pending: [],
    powerUses: {
      prospecting: 0,
      landGrab: 0,
      donations: 0,
      payback: 0,
      goingViral: 0,
      helpingHands: 0,
      toughLove: 0,
      gerrymandered: {},
    },
    isBot: false,
  };
}

type PegSpec = { readonly areaId: string; readonly owner: PlayerID };
type SeatSpec = {
  readonly player: PlayerID;
  readonly pool: Pool;
  readonly pegs?: readonly PegSpec[];
};

type Scenario = {
  readonly name: string;
  readonly choice: Choice;
  readonly seats: readonly SeatSpec[];
  readonly you: PlayerID;
  /**
   * The engine has NO legal pick for this state — `steal-any` with no victim,
   * `choose-zone` with nothing legal in any zone, `choose-card` with an empty
   * recycle list. `applyEffect` raises nothing for any of them, so they are
   * unreachable, and the client is required to STATE the rule edge rather than
   * present an empty sheet. Asserted differently, and named, rather than
   * skipped: a scenario list that quietly dropped them would stop covering them.
   */
  readonly engineHasNoAnswer?: boolean;
  /** The `data-testid` of the sentence that must state the rule edge. */
  readonly statedBy?: string;
  /**
   * The decision's id, defaulting to one constant.
   *
   * It is settable because Defect C's fix keys the resource draft on the DECISION
   * (`ChoiceResolver`'s own `pending.id`), so "a different decision starts from
   * nothing" is a property of the fix and has to be assertable — and a harness
   * that could only ever produce one id could not tell a key from a constant.
   */
  readonly choiceId?: string;
  /** Turn number, so "a turn boundary does not wipe the draft" is assertable too. */
  readonly turn?: number;
};

const NO_LOG: readonly LogEntry[] = [];
const NO_MARKET: readonly MarketSlot[] = [];
const seat = (p: PlayerID, pool: Pool, pegs?: readonly PegSpec[]): SeatSpec =>
  pegs === undefined ? { player: p, pool } : { player: p, pool, pegs };

/** A `ClientState` carrying the scenario, over the real 129-slot board. */
function buildState(sc: Scenario): ClientState {
  const players: Record<PlayerID, PlayerState> = {};
  for (const s of sc.seats) players[s.player] = player(s.player, s.pool);

  let zones = makeZones();
  for (const s of sc.seats) {
    for (const peg of s.pegs ?? []) zones = putPeg(zones, peg.areaId, peg.owner);
  }

  return {
    zones,
    players,
    turnOrder: sc.seats.map((s) => s.player),
    activePlayer: sc.you,
    phase: 'actions',
    turn: sc.turn ?? 1,
    round: 1,
    finished: false,
    market: NO_MARKET,
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices: [{ id: sc.choiceId ?? 'ch-invariant', player: sc.you, choice: sc.choice }],
    log: NO_LOG,
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
  } as unknown as ClientState;
}

/** G17's named recycle list, read off the decision itself — the engine's offer. */
function recycleFor(sc: Scenario): readonly { readonly id: string; readonly name: string }[] {
  if (sc.choice.kind !== 'choose-card') return [];
  return sc.choice.cards.map((id) => ({ id, name: `CARD ${id.toUpperCase()}` }));
}

/**
 * What a click on the board was REFUSED for. Defect A's assertion is that this
 * list stays empty for every slot the board labelled `legal target`, so it is
 * collected rather than inferred.
 */
type Refusal = { readonly areaId: string; readonly reason: string };

// ─────────────────────────── the harness ───────────────────────────

/**
 * The real dialog and the real board, wired the way `GameScreen` wires them:
 * `choiceBoardInteraction` is the function `GameScreen` calls (not a copy), and
 * the slot handler applies the same three gates `GameScreen`'s `onSlotActivate`
 * does — legal set, toggle, then the DERIVED cap.
 */
function Harness({ sc, onResolved }: { sc: Scenario; onResolved: (p: ChoicePick) => void }) {
  const [picks, setPicks] = useState<readonly string[]>([]);
  const [refusals, setRefusals] = useState<readonly Refusal[]>([]);

  const state = buildState(sc);
  const owed = state.choices.find((c) => c.player === sc.you)?.choice ?? null;
  const interaction = choiceBoardInteraction(state, sc.you, picks);

  const props: ChoiceResolverProps = {
    state,
    you: sc.you,
    pickedAreaIds: picks,
    onPickArea: () => undefined,
    onRemovePick: () => setPicks((cur) => cur.slice(0, -1)),
    onResolveResources: (_id, res) => onResolved({ kind: 'resources', res }),
    onResolveSteal: (_id, from, res) => onResolved({ kind: 'steal', from, res }),
    onResolveAreas: (_id, areaIds) => onResolved({ kind: 'areas', areaIds }),
    // G1. One pick carrying BOTH halves, in the engine's own field order, so the
    // transcriptions below are checking the same object the resolver would read.
    onResolvePegDest: (_id, areaId, toAreaId) =>
      onResolved({ kind: 'peg-dest', areaId, toAreaId }),
    onResolvePlayer: (_id, id) => onResolved({ kind: 'player', id }),
    onResolveZone: (_id, zoneId) => onResolved({ kind: 'zone', zoneId: zoneId as ZoneID }),
    onResolveCard: (_id, cardId) => onResolved({ kind: 'card', cardId }),
    recycle: recycleFor(sc),
  };

  const onSlotActivate = (areaId: string): void => {
    if (owed === null) return;
    /*
       G1 — THE TWO-PLACE PICK, THROUGH THE SAME EXPRESSION `GameScreen` CALLS.
       `pegMovePick` is one function for the stage transition and the legal set, so
       this harness cannot accept a slot the dialog would refuse (Defect A) nor refuse
       one it offers. It is a REFUSAL LIST rather than a throw because the whole point
       of assertion (4b) below is that this list stays empty.
     */
    if (owed.kind === 'choose-peg-dest') {
      const step = pegMovePick(state, owed, picks, areaId);
      if (!step.ok) {
        setRefusals((cur) => [...cur, { areaId, reason: step.reason }]);
        return;
      }
      setPicks(step.picks);
      return;
    }
    if (!isVoterDecision(owed)) return;
    const legal = targetableAreas(state, sc.you, owed.kind, owed.scope, owed.zoneId);
    if (!legal.has(areaId)) {
      setRefusals((cur) => [...cur, { areaId, reason: 'not in targetableAreas' }]);
      return;
    }
    if (picks.includes(areaId)) {
      setPicks((cur) => cur.filter((x) => x !== areaId));
      return;
    }
    if (picks.length >= requiredPicks(owed, state, sc.you)) {
      setRefusals((cur) => [...cur, { areaId, reason: 'past the derived cap' }]);
      return;
    }
    setPicks((cur) => [...cur, areaId]);
  };

  return (
    <div>
      {interaction === null ? null : (
        <BoardSvg state={toBoardState(state, interaction)} onSlotActivate={onSlotActivate} />
      )}
      <ChoiceResolver {...props} />
      <ul data-testid="refusals">
        {refusals.map((r, i) => (
          <li key={`${r.areaId}-${i}`}>{`${r.areaId}: ${r.reason}`}</li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────── the driver ───────────────────────────

const enabled = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement &&
  !el.hasAttribute('disabled') &&
  el.getAttribute('aria-disabled') !== 'true';

function confirmOf(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector('[data-testid=picker-confirm]') ??
    root.querySelector('[data-testid=area-choice-confirm]') ??
    root.querySelector('[data-testid=peg-dest-confirm]')
  );
}

/** Every board slot the BOARD calls a legal target — the §8.5 contract, read. */
function boardTargets(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('g[role="button"][data-area-id]')].filter((g) =>
    (g.getAttribute('aria-label') ?? '').includes('legal target'),
  );
}

function allSlots(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('g[role="button"][data-area-id]')];
}

function dialogButtons(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid="choice-dialog"] button')];
}

/**
 * Press only what ADVANCES the decision, until it is dispatched or the confirm
 * goes live. Returns why it stopped, because every caller asserts on the reason.
 *
 * The order is the order a player reads the dialog: the board's own highlighted
 * slots first (an area decision is resolved on the board), then a denomination
 * `+`, then the two kinds that RESOLVE on press — a victim, a seat, a
 * constituency, a card.
 */
function driveToResolution(r: RenderResult): { readonly done: boolean; readonly why: string } {
  const root = r.container;
  for (let step = 0; step < 60; step += 1) {
    if (r.container.querySelector('[data-testid=choice-dialog]') === null) {
      return { done: true, why: 'the dialog closed' };
    }
    const confirm = confirmOf(root);
    if (enabled(confirm)) return { done: true, why: 'CONFIRM is enabled' };

    // A press that resolves the decision outright: no confirm exists for these.
    // A VICTIM press does not — it only names the pool the next screen edits — so
    // it falls through to the loop rather than ending it.
    const resolves = root.querySelector<HTMLElement>(
      '[data-testid=name-choice-option], [data-testid=card-choice-option]',
    );
    if (enabled(resolves)) {
      fireEvent.click(resolves);
      return { done: true, why: 'a resolving option was pressed' };
    }
    const victim = root.querySelector<HTMLElement>('[data-testid=steal-victim]');
    if (enabled(victim)) {
      fireEvent.click(victim);
      continue;
    }

    const slot = boardTargets(root).find((g) => !g.hasAttribute('aria-disabled'));
    if (slot !== undefined) {
      fireEvent.click(slot);
      continue;
    }
    const add = [...root.querySelectorAll<HTMLElement>('.picker__grid .row--tight button')].find(
      (b) => enabled(b) && !(b.getAttribute('aria-label') ?? '').startsWith('Remove'),
    );
    if (add !== undefined) {
      fireEvent.click(add);
      continue;
    }
    return {
      done: false,
      why: `nothing left to press (dialog buttons: ${dialogButtons(root)
        .map((b) => `${(b.textContent ?? '').trim()}:${enabled(b) ? 'on' : 'off'}`)
        .join(', ')})`,
    };
  }
  return { done: false, why: 'the driver ran out of steps' };
}

// ─────────────────────────── the engine's rules, transcribed ───────────────────────────

const total = (d: Readonly<Record<string, number | undefined>>): number =>
  RES.reduce((n, r) => n + (d[r] ?? 0), 0);

function ownerOf(state: ClientState, areaId: string): PlayerID | null {
  for (const z of state.zones) for (const a of z.areas) if (a.id === areaId) return a.peg?.owner ?? null;
  return null;
}

function areaOf(state: ClientState, areaId: string) {
  for (const z of state.zones) for (const a of z.areas) if (a.id === areaId) return a;
  return undefined;
}

/**
 * Every rule `reduce.ts:resolveChoice` applies to the pick this dialog
 * dispatched, in the engine's own words. A failure names the refusal string, so
 * the report says which rule the dialog broke.
 */
function assertEngineAccepts(sc: Scenario, pick: ChoicePick): void {
  const state = buildState(sc);
  const c = sc.choice;

  if (pick.kind === 'player') {
    expect(c.kind, `${sc.name}: a player pick for a non-player choice`).toBe('choose-player');
    if (c.kind !== 'choose-player') return;
    expect(pick.id === c.source, `${sc.name}: "you may not choose that player"`).toBe(false);
    expect(state.turnOrder.includes(pick.id), `${sc.name}: "you may not choose that player"`).toBe(true);
    return;
  }

  if (pick.kind === 'zone') {
    expect(c.kind, `${sc.name}: a zone pick for a non-zone choice`).toBe('choose-zone');
    if (c.kind !== 'choose-zone') return;
    expect(pick.zoneId === c.source ? false : true, 'zone ids are not player ids').toBe(true);
    expect(
      state.zones.some((z) => z.id === pick.zoneId && z.areas.some((a) => a.peg !== null)),
      `${sc.name}: "you may not choose that constituency" — ${pick.zoneId} holds no voter`,
    ).toBe(true);
    return;
  }

  if (pick.kind === 'card') {
    expect(c.kind, `${sc.name}: expected a choose-card`).toBe('choose-card');
    if (c.kind !== 'choose-card') return;
    expect(c.cards.includes(pick.cardId), `${sc.name}: "malformed action" — unnamed card`).toBe(true);
    return;
  }

  if (pick.kind === 'steal') {
    expect(c.kind, `${sc.name}: expected a steal-any`).toBe('steal-any');
    if (c.kind !== 'steal-any') return;
    const victim = state.players[pick.from];
    expect(victim, `${sc.name}: "unknown player"`).toBeDefined();
    if (victim === undefined) return;
    expect(pick.from === sc.you, `${sc.name}: "steal from someone else"`).toBe(false);
    if (c.from !== null) {
      expect(pick.from, `${sc.name}: "that is not the player you may take from"`).toBe(c.from);
    }
    const want = Math.min(c.count, total(victim.resources));
    expect(total(pick.res), `${sc.name}: "take exactly ${want}"`).toBe(want);
    for (const r of RES) {
      expect(
        (pick.res[r] ?? 0) <= victim.resources[r],
        `${sc.name}: "they do not hold those" — ${pick.res[r] ?? 0} ${r}`,
      ).toBe(true);
    }
    return;
  }

  if (pick.kind === 'resources') {
    const required = requiredPicks(c, state, sc.you);
    expect(total(pick.res), `${sc.name}: "choose exactly ${required}"`).toBe(required);
    for (const r of RES) {
      expect((pick.res[r] ?? 0) >= 0, `${sc.name}: a negative ${r} would mint resources`).toBe(true);
    }
    if (c.kind === 'lose-any') {
      const me = state.players[sc.you];
      for (const r of RES) {
        expect(
          (pick.res[r] ?? 0) <= (me?.resources[r] ?? 0),
          `${sc.name}: "you do not hold those" — ${pick.res[r] ?? 0} ${r}`,
        ).toBe(true);
      }
      /*
       * AND THE CLAMP IS THE ENGINE'S, restated: `resolveChoice` wants
       * `min(count, poolTotal(now))`. `requiredPicks` must agree with that number,
       * because it is the number CONFIRM waits for — a client that waits for the
       * uncapped `count` is a dead dialog whenever the pool has shrunk, which is
       * Defect B.
       */
      expect(
        required,
        `${sc.name}: requiredPicks must be min(count, held) — the engine clamps at RESOLUTION time`,
      ).toBe(Math.min(c.count, total(state.players[sc.you]?.resources ?? EMPTY)));
    }
    if (c.kind === 'gain-any') {
      // `resolveChoice` imposes NO `canAfford` on a gain, so nothing below this
      // point may consult the pool. Asserted as an absence: an empty pool is a
      // legal position to receive a resource FROM.
      expect(c.kind, `${sc.name}: a gain must not be checked against a pool`).toBe('gain-any');
    }
    return;
  }

  /*
     G1 — `'peg-dest'`, transcribed from `reduce.ts:resolveChoice`'s arm with its own
     refusal strings, in the order the arm checks them. Every clause is one the engine
     enforces against a LIVE board, which is why this is asserted after the picks were
     made rather than against the offer: a majority can form and a hole can fill
     between the raise and the answer, and the engine's answer to that is to REFUSE the
     stale pair rather than clamp it.
  */
  if (pick.kind === 'peg-dest') {
    expect(c.kind, `${sc.name}: expected a choose-peg-dest`).toBe('choose-peg-dest');
    if (c.kind !== 'choose-peg-dest') return;
    expect(pick.areaId, `${sc.name}: "choose a voter and where it goes" — no voter`).toBeTruthy();
    expect(pick.toAreaId, `${sc.name}: "choose a voter and where it goes" — no place`).toBeTruthy();
    expect(pick.areaId, `${sc.name}: a voter cannot land on itself`).not.toBe(pick.toAreaId);

    const from = areaOf(state, pick.areaId);
    expect(from, `${sc.name}: "there is no voter there" — ${pick.areaId}`).toBeDefined();
    // `movablePegIds`: the card's ACTOR's peg, not a majority, not in a Volatile Area.
    expect(
      ownerOf(state, pick.areaId),
      `${sc.name}: "that voter may not be moved" — ${pick.areaId} is not ${c.source}'s`,
    ).toBe(c.source);
    expect(
      from?.peg?.majority,
      `${sc.name}: "that voter may not be moved" — ${pick.areaId} is a majority voter`,
    ).not.toBe(true);
    expect(
      from?.volatile,
      `${sc.name}: "that voter may not be moved" — ${pick.areaId} is in a Volatile Area`,
    ).not.toBe(true);

    // `pegDestinations`: EMPTY, in an adjacent constituency, never the same one.
    const to = areaOf(state, pick.toAreaId);
    expect(
      to?.peg,
      `${sc.name}: "that area is taken" — ${pick.toAreaId} is occupied`,
    ).toBeNull();
    expect(
      from?.zone === to?.zone,
      `${sc.name}: a move inside one constituency is a no-op, and the engine offers none`,
    ).toBe(false);
    const zone = state.zones.find((z) => z.id === from?.zone);
    expect(
      zone?.neighbours.includes(to?.zone ?? ('' as ZoneID)),
      `${sc.name}: "that is not an empty area in an adjacent zone" — ${pick.toAreaId}`,
    ).toBe(true);
    return;
  }

  // `areas`
  expect(isVoterDecision(c), `${sc.name}: expected a voter decision`).toBe(true);
  if (!isVoterDecision(c)) return;
  expect(pick.kind, `${sc.name}: an areas pick for a non-area decision`).toBe('areas');
  if (pick.kind !== 'areas') return;
  const want = Math.min(c.count, targetableCount(state, sc.you, c.kind, c.scope, c.zoneId));
  expect(pick.areaIds.length, `${sc.name}: "choose exactly ${want}"`).toBe(want);
  expect(new Set(pick.areaIds).size, `${sc.name}: "duplicate area"`).toBe(pick.areaIds.length);
  for (const id of pick.areaIds) {
    const area = areaOf(state, id);
    expect(area, `${sc.name}: "there is no voter there" — ${id}`).toBeDefined();
    expect(area?.volatile, `${sc.name}: "voters in a Volatile Area cannot be affected" — ${id}`).not.toBe(
      true,
    );
    expect(
      area !== undefined && (c.zoneId === undefined || area.zone === c.zoneId),
      `${sc.name}: "that voter is in another zone" — ${id}`,
    ).toBe(true);
    if (c.kind === 'convert-voter') {
      expect(ownerOf(state, id) === sc.you, `${sc.name}: "that voter is already yours" — ${id}`).toBe(false);
    }
    if (c.scope === 'own') {
      expect(ownerOf(state, id), `${sc.name}: "that voter is not yours" — ${id}`).toBe(sc.you);
    }
    if (c.scope === 'others' && c.kind !== 'evict-voter') {
      expect(ownerOf(state, id) === sc.you, `${sc.name}: "that targets an opponent" — ${id}`).toBe(false);
    }
  }
}

// ─────────────────────────── the gate ───────────────────────────

/** Run one scenario end to end and assert every property the header lists. */
function assertResolvable(sc: Scenario): ChoicePick {
  const seen: ChoicePick[] = [];
  const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
  try {
    expect(
      r.container.querySelector('[data-testid="choice-dialog"]'),
      `${sc.name}: no choice dialog rendered`,
    ).not.toBeNull();

    if (sc.engineHasNoAnswer === true) {
      // STATED, NOT DEAD: an unreachable state must name itself on the frame.
      // A scenario list that quietly dropped these would stop covering them, so
      // they are asserted, not skipped.
      expect(
        r.container.querySelector(`[data-testid="${sc.statedBy ?? ''}"]`),
        `${sc.name}: the rule edge is not stated on the frame`,
      ).not.toBeNull();
      return { kind: 'areas', areaIds: [] };
    }

    // (2) THE DEAD-DIALOG ASSERTION, over BOTH surfaces.
    const inDialog = dialogButtons(r.container).filter((b) => enabled(b));
    const onBoard = boardTargets(r.container);
    expect(
      inDialog.length + onBoard.length,
      `${sc.name}: DEAD DIALOG — ${inDialog.length} enabled control(s) in the dialog, ` +
        `${onBoard.length} legal target(s) on the board`,
    ).toBeGreaterThan(0);

    // (4) DEFECT A, ASSERTED DIRECTLY, BEFORE ANY CLICK: a slot the board calls a
    // legal target must be one the click handler will accept. Pre-fix this was
    // empty for every voter decision, because the board offered the empty ones.
    if (isVoterDecision(sc.choice)) {
      const state = buildState(sc);
      const legal = targetableAreas(state, sc.you, sc.choice.kind, sc.choice.scope, sc.choice.zoneId);
      for (const g of boardTargets(r.container)) {
        const id = g.getAttribute('data-area-id') ?? '';
        expect(
          legal.has(id),
          `${sc.name}: the board calls ${id} a legal target and the engine's set does not`,
        ).toBe(true);
        expect(
          (g.getAttribute('aria-label') ?? '').includes(', empty.'),
          `${sc.name}: ${id} is highlighted as a legal target but holds no voter — ` +
            'an eviction has nothing to remove here',
        ).toBe(false);
      }
    }

    /*
       (4c) G1 — THE SAME ASSERTION FOR A TWO-PLACE PICK, PLUS THE ONE THAT ONLY IT
       NEEDS: the legal set CHANGES with the stage, so a board that offered every peg
       and every empty area at once would pass a stage-blind test and fail in play. The
       stage is read off `choiceBoardInteraction` — the same function `GameScreen`
       calls — and the sets it is compared against are the engine's own two
       expressions, `movablePegIds` and `pegDestinations`, reached through the single
       `pegMovePick` transition the click handler uses.
     */
    // `=== undefined`, not `!== true`: the `engineHasNoAnswer === true` branch above
    // has already narrowed the field to `false | undefined`, and spelling the other
    // way round is a comparison the compiler refuses.
    if (sc.choice.kind === 'choose-peg-dest' && sc.engineHasNoAnswer === undefined) {
      const state = buildState(sc);
      // STAGE ONE: the only legal targets are OCCUPIED, movable, the actor's own slots.
      const stage1 = pegMoveOptions(state, sc.choice);
      expect(stage1.size, `${sc.name}: nothing on the board can move`).toBeGreaterThan(0);
      const first = boardTargets(r.container).map((g) => g.getAttribute('data-area-id') ?? '');
      expect(
        first.sort(),
        `${sc.name}: stage one must offer exactly the movable voters, nothing else`,
      ).toEqual([...stage1.keys()].sort());
      for (const g of boardTargets(r.container)) {
        const id = g.getAttribute('data-area-id') ?? '';
        expect(
          ownerOf(state, id),
          `${sc.name}: ${id} is offered to be moved and is not the card actor's voter`,
        ).toBe(sc.choice.source);
        expect(
          (g.getAttribute('aria-label') ?? '').includes(', empty.'),
          `${sc.name}: ${id} is offered as the SOURCE of a move and holds no voter`,
        ).toBe(false);
      }

      // STAGE TWO, by pressing the one peg the driver would: the legal set must have
      // become that peg's destinations and nothing else, and every one of them must be
      // EMPTY and in another constituency.
      const peg = [...stage1.keys()][0] as string;
      fireEvent.click(allSlots(r.container).find((g) => g.getAttribute('data-area-id') === peg) as HTMLElement);
      const stage2 = stage1.get(peg) ?? new Set<string>();
      const second = boardTargets(r.container).map((g) => g.getAttribute('data-area-id') ?? '');
      expect(
        second.sort(),
        `${sc.name}: stage two must offer exactly the empty areas adjacent to ${peg}`,
      ).toEqual([...stage2].sort());
      for (const id of second) {
        expect(areaOf(state, id)?.peg, `${sc.name}: ${id} is offered as a landing and is occupied`).toBeNull();
        expect(areaOf(state, id)?.zone, `${sc.name}: ${id} is offered as a landing and is in the peg's own constituency`).not.toBe(
          areaOf(state, peg)?.zone,
        );
      }
      // AND THE CHOSEN PEG IS SAYING SO, in its own accessible name (§8.5): a keyboard
      // player has to be able to tell what they are holding.
      expect(
        allSlots(r.container).find((g) => g.getAttribute('data-area-id') === peg)?.getAttribute('aria-label') ?? '',
        `${sc.name}: the picked voter does not say it is being moved`,
      ).toContain('the voter you picked up to move');
    }

    // (3) A RESOLUTION IS REACHABLE.
    const drive = driveToResolution(r);
    expect(drive.done, `${sc.name}: no reachable resolution — ${drive.why}`).toBe(true);

    if (confirmOf(r.container) !== null) {
      fireEvent.click(confirmOf(r.container) as HTMLElement);
    }
    expect(seen, `${sc.name}: nothing was dispatched`).toHaveLength(1);

    // (4b) AND NO LEGAL TARGET WAS REFUSED BY THE CLICK HANDLER.
    const refused = [...r.container.querySelectorAll('[data-testid=refusals] li')].map(
      (li) => li.textContent ?? '',
    );
    expect(refused, `${sc.name}: the dialog refused its own legal target(s)`).toEqual([]);

    // (5) THE PICK IS ONE `resolveChoice` ACCEPTS.
    const pick = seen[0] as ChoicePick;
    assertEngineAccepts(sc, pick);
    return pick;
  } finally {
    r.unmount();
  }
}

// ─────────────────────────── the scenarios ───────────────────────────

const OVER_CAP = (count: number, held: Pool): Scenario => ({
  name: `lose-any ${count} against a pool of ${total(held)}`,
  choice: { kind: 'lose-any', count, reason: 'Resource cap' },
  seats: [seat(P1, held), seat(P2, EMPTY)],
  you: P1,
});

const VOTER = (
  kind: VoterChoiceKind,
  count: number,
  scope: 'any' | 'own' | 'others',
  seats: readonly SeatSpec[],
  extra: { readonly zoneId?: ZoneID } = {},
): Scenario => ({
  name: `${kind} ${count} · scope ${scope}${extra.zoneId === undefined ? '' : ` · zone ${extra.zoneId}`}`,
  choice: { kind, count, scope, reason: 'Card effect', ...extra },
  seats,
  you: P1,
});

/** Every area id in a constituency, read off the real board so none is invented. */
function zoneAreaIds(zoneId: string): readonly string[] {
  const z = makeZones().find((x) => x.id === zoneId);
  if (z === undefined) throw new Error(`no zone ${zoneId}`);
  return z.areas.map((a) => a.id);
}

/** Peg specs filling a whole constituency — for "no ADJACENT area is empty". */
function fill(zoneId: string, owner: PlayerID): readonly PegSpec[] {
  return zoneAreaIds(zoneId).map((areaId) => ({ areaId, owner }));
}

/**
 * G1 — the two-place pick. `VOTER` cannot build one: it is a helper for the three
 * area-LIST kinds, and `peg-dest` shares nothing with them but the fact that the board
 * is open. So it gets its own constructor, which is the point — the kinds are kept
 * apart rather than merged into one shape that fits all ten and describes none.
 */
const PEG_DEST = (
  name: string,
  source: PlayerID,
  you: PlayerID,
  seats: readonly SeatSpec[],
  engineHasNoAnswer?: boolean,
): Scenario => ({
  name,
  choice: {
    kind: 'choose-peg-dest',
    count: 1,
    // `scope` is DESCRIPTIVE — `resolveChoice` decides on `peg.owner === c.source` —
    // so it is stated the way the engine states it: `'own'` when the answerer is the
    // card's actor, `'others'` when they are not.
    scope: you === source ? 'own' : 'others',
    source,
    reason: 'Card effect',
  },
  seats,
  you,
  ...(engineHasNoAnswer === true
    ? { engineHasNoAnswer: true, statedBy: 'peg-dest-nothing' }
    : {}),
});

/**
 * EVERY `Choice` KIND, in its degenerate states. The count is asserted below, so
 * a kind that arrives and is not added here is a failing test rather than a
 * silent gap — the fourth time this suite would have caught a defect had it been
 * extended.
 */
const SCENARIOS: readonly Scenario[] = [
  // ── gain-any: a receipt. The pool is a label, never a ceiling. ──
  { name: 'gain-any 1, empty pool', choice: { kind: 'gain-any', count: 1, reason: 'Card effect' }, seats: [seat(P1, EMPTY), seat(P2, EMPTY)], you: P1 },
  { name: 'gain-any 3, empty pool', choice: { kind: 'gain-any', count: 3, reason: 'Card effect' }, seats: [seat(P1, EMPTY), seat(P2, EMPTY)], you: P1 },
  { name: 'gain-any 1, funds-only pool', choice: { kind: 'gain-any', count: 1, reason: 'Card effect' }, seats: [seat(P1, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)], you: P1 },
  { name: 'gain-any 2 while already over the cap', choice: { kind: 'gain-any', count: 2, reason: 'Card effect' }, seats: [seat(P1, { funds: 6, clout: 6, media: 0, trust: 0 }), seat(P2, EMPTY)], you: P1 },

  // ── lose-any: a cost out of the player's own pool. ──
  { name: 'lose-any 2 of 6 funds (the cap discard)', choice: { kind: 'lose-any', count: 2, reason: 'Resource cap' }, seats: [seat(P1, { funds: 6, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)], you: P1 },
  { name: 'lose-any 4 of 4 trust', choice: { kind: 'lose-any', count: 4, reason: 'Card effect' }, seats: [seat(P1, { funds: 0, clout: 0, media: 0, trust: 4 }), seat(P2, EMPTY)], you: P1 },
  { name: 'lose-any 3 spread over three denominations', choice: { kind: 'lose-any', count: 3, reason: 'Card effect' }, seats: [seat(P1, { funds: 1, clout: 1, media: 1, trust: 0 }), seat(P2, EMPTY)], you: P1 },
  /* DEFECT B. The engine raises a cap discard as `poolTotal - cap`, and clamps it
     again AT RESOLUTION time (`reduce.ts:3246`) because a pending decision is not
     a lock the answering player holds: a Conspiracy Card can strip a Fund from
     every opponent between the ask and the answer, and the recorded real case was
     "Discard 41" against a pool of 40 — CONFIRM dead at "40 of 41 chosen", with
     no cancel on the frame. Two shapes of the same over-cap ask, because a
     one-unit and a nine-unit overshoot fail for the same reason. */
  OVER_CAP(41, { funds: 10, clout: 10, media: 10, trust: 10 }),
  OVER_CAP(12, { funds: 1, clout: 0, media: 0, trust: 0 }),

  // ── steal-any: a cost out of somebody ELSE's pool. ──
  { name: 'steal-any 2 from a victim holding nothing', choice: { kind: 'steal-any', count: 2, from: P2, reason: 'Card effect' }, seats: [seat(P1, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)], you: P1 },
  { name: 'steal-any 3 from a victim holding 1', choice: { kind: 'steal-any', count: 3, from: P2, reason: 'Card effect' }, seats: [seat(P1, EMPTY), seat(P2, { funds: 0, clout: 0, media: 0, trust: 1 })], you: P1 },
  { name: 'steal-any 2 from a 3-funds-only victim', choice: { kind: 'steal-any', count: 2, from: P2, reason: 'Card effect' }, seats: [seat(P1, EMPTY), seat(P2, { funds: 3, clout: 0, media: 0, trust: 0 })], you: P1 },
  { name: 'steal-any 1, thief picks, every victim empty', choice: { kind: 'steal-any', count: 1, from: null, reason: 'Card effect' }, seats: [seat(P1, EMPTY), seat(P2, EMPTY), seat(P3, EMPTY)], you: P1 },
  { name: 'steal-any 2, thief picks, mixed pools', choice: { kind: 'steal-any', count: 2, from: null, reason: 'Card effect' }, seats: [seat(P1, EMPTY), seat(P2, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P3, { funds: 0, clout: 0, media: 0, trust: 9 })], you: P1 },

  // ── evict-voter: scope 'any', so every peg on the board. ──
  VOTER('evict-voter', 3, 'any', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.n1, owner: P2 }, { areaId: A.n2, owner: P2 }])]),
  VOTER('evict-voter', 1, 'any', [seat(P1, EMPTY), seat(P2, EMPTY)]),
  VOTER('evict-voter', 1, 'any', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.nwVol, owner: P2 }])]),
  VOTER('evict-voter', 4, 'any', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.n1, owner: P2 }, { areaId: A.n2, owner: P2 }, { areaId: A.n3, owner: P2 }])]),

  // ── discard-voter: `raiseVoterDecision` gives a NAMED victim scope 'own'. ──
  VOTER('discard-voter', 2, 'own', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }]), seat(P2, EMPTY, [{ areaId: A.nw2, owner: P2 }, { areaId: A.n1, owner: P2 }])]),
  VOTER('discard-voter', 2, 'own', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }, { areaId: A.nw2, owner: P1 }]), seat(P2, EMPTY)]),
  VOTER('discard-voter', 4, 'others', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }]), seat(P2, EMPTY, [{ areaId: A.nw2, owner: P2 }, { areaId: A.n1, owner: P2 }])]),
  VOTER('discard-voter', 1, 'others', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }, { areaId: A.nw2, owner: P1 }]), seat(P2, EMPTY)]),
  VOTER('discard-voter', 2, 'others', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.n1, owner: P2 }, { areaId: A.n2, owner: P2 }, { areaId: A.n3, owner: P2 }])]),

  // ── convert-voter: never your own peg, whatever `scope` says. ──
  VOTER('convert-voter', 1, 'own', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }]), seat(P2, EMPTY, [{ areaId: A.nw2, owner: P2 }])]),
  VOTER('convert-voter', 1, 'others', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }]), seat(P2, EMPTY, [{ areaId: A.nw2, owner: P2 }])]),
  VOTER('convert-voter', 1, 'others', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }]), seat(P2, EMPTY, [{ areaId: A.nwVol, owner: P2 }])]),
  VOTER('convert-voter', 2, 'others', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.n1, owner: P2 }, { areaId: A.n2, owner: P2 }, { areaId: A.n3, owner: P2 }])]),

  // ── THE CARD'S CONSTITUENCY. A `zoneId` narrows the legal set, and omitting
  // it (which GameScreen and ChoiceResolver both did) offered out-of-zone voters
  // the engine refuses with "that voter is in another zone". ──
  VOTER('discard-voter', 1, 'own', [
    seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }, { areaId: A.n1, owner: P1 }]),
    seat(P2, EMPTY),
  ], { zoneId: 'north_west' }),
  VOTER('evict-voter', 2, 'any', [
    seat(P1, EMPTY),
    seat(P2, EMPTY, [{ areaId: A.nw1, owner: P2 }, { areaId: A.w1, owner: P2 }]),
  ], { zoneId: 'north_west' }),

  // ── choose-player / choose-zone / choose-card. ──
  {
    name: 'choose-player in a TWO-seat game (exactly one candidate)',
    choice: {
      kind: 'choose-player',
      count: 1,
      effects: [{ op: 'voters', n: 1, target: 'chosen-player' }],
      source: P1,
      reason: 'Card effect',
    },
    seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
    you: P1,
  },
  {
    name: 'choose-player with a seat holding nothing at all',
    choice: {
      kind: 'choose-player',
      count: 1,
      effects: [{ op: 'voters', n: 1, target: 'chosen-player' }],
      source: P1,
      reason: 'Card effect',
    },
    seats: [seat(P1, EMPTY), seat(P2, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P3, EMPTY)],
    you: P1,
  },
  {
    name: 'choose-zone, two constituencies holding the chooser’s own voters',
    choice: {
      kind: 'choose-zone',
      count: 1,
      effects: [{ op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' }],
      source: P1,
      reason: 'Card effect',
    },
    seats: [
      seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }, { areaId: A.n1, owner: P1 }]),
      seat(P2, EMPTY),
      seat(P3, EMPTY, [{ areaId: A.c1, owner: P3 }]),
    ],
    you: P1,
  },
  {
    name: 'choose-card, two named cards on the recycle list',
    choice: {
      kind: 'choose-card',
      count: 1,
      cards: ['ct-et2040-001', 'ct-et2040-002'],
      effects: [{ op: 'draw-conspiracy', n: 1, from: 'discard', pick: true }],
      source: P1,
      reason: 'Card effect',
    },
    seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
    you: P1,
  },

  // ── G1, choose-peg-dest: the TENTH kind, and the only TWO-PLACE pick.
  //
  // A source peg AND an adjacent empty destination is the whole offer; the two
  // candidate sets are computed by `pegMoveOptions`, which is `pegMoveOffered`
  // computed rather than assumed. So the table below is a table of peg layouts.

  /* THE SHIPPED SHAPE. GREAT LEADER's answerer is "the player after you", so `you` is
     NOT `source` and `scope` is `'others'` — which is exactly the case a client that
     filters on `scope` gets wrong: the peg offered belongs to the card's actor, not to
     the seat answering. One peg in Central, an empty board around it, and the answer
     has to reach it. */
  PEG_DEST(
    'choose-peg-dest · the actor’s voter, answered by another seat (scope others)',
    P2,
    P1,
    [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.c1, owner: P2 }])],
  ),
  /* The other side of the same coin, which is a DIFFERENT case and not a duplicate:
     `you === source` means `scope: 'own'`, and the dialog must offer the answerer's
     own peg rather than refusing it as "not yours". */
  PEG_DEST(
    'choose-peg-dest · answered by the actor themselves (scope own)',
    P1,
    P1,
    [seat(P1, EMPTY, [{ areaId: A.c1, owner: P1 }]), seat(P2, EMPTY)],
  ),
  /* A MAJORITY voter is never offered. Six pegs in Central, where the majority is 5:
     `recount` flips five of them, so exactly one is left mobile and the dialog must
     offer that ONE — five illegal slots and one legal, or the mirror image of it. */
  PEG_DEST(
    'choose-peg-dest · five majority voters are immovable, the sixth is not',
    P2,
    P1,
    [
      seat(P1, EMPTY),
      seat(P2, EMPTY, [
        { areaId: A.c1, owner: P2 },
        { areaId: A.c2, owner: P2 },
        { areaId: 'central-03', owner: P2 },
        { areaId: 'central-04', owner: P2 },
        { areaId: 'central-05', owner: P2 },
        { areaId: 'central-06', owner: P2 },
      ]),
    ],
  ),
  /* p18: a peg in a Volatile Area is PERMANENT, so it cannot move at all. The peg
     beside it can, and the dialog must offer that one only. */
  PEG_DEST(
    'choose-peg-dest · a voter in a Volatile Area is permanent',
    P2,
    P1,
    [
      seat(P1, EMPTY),
      seat(P2, EMPTY, [
        { areaId: A.nwVol, owner: P2 },
        { areaId: A.n1, owner: P2 },
      ]),
    ],
  ),

  // ── THE THREE STATES THE ENGINE ITSELF CANNOT ANSWER. `applyEffect` raises
  // none of them, so they are unreachable — and each must STATE itself on the
  // frame rather than present an empty sheet with nothing on it. ──
  {
    name: 'steal-any with no opponent at all',
    choice: { kind: 'steal-any', count: 1, from: null, reason: 'Card effect' },
    seats: [seat(P1, EMPTY)],
    you: P1,
    engineHasNoAnswer: true,
    statedBy: 'steal-no-victims',
  },
  {
    name: 'choose-zone with no constituency holding a legal voter',
    choice: {
      kind: 'choose-zone',
      count: 1,
      effects: [{ op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' }],
      source: P1,
      reason: 'Card effect',
    },
    seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
    you: P1,
    engineHasNoAnswer: true,
    statedBy: 'name-choice-empty',
  },
  {
    name: 'choose-card with an empty recycle list',
    choice: {
      kind: 'choose-card',
      count: 1,
      cards: [],
      effects: [{ op: 'draw-conspiracy', n: 1, from: 'discard', pick: true }],
      source: P1,
      reason: 'Card effect',
    },
    seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
    you: P1,
    engineHasNoAnswer: true,
    statedBy: 'card-choice-empty',
  },
  /*
     G1, THE OFFER TEST'S TWO FAILURES, and they fail for OPPOSITE reasons — which is
     why they are two cases and not one.

     `pegMoveOffered` is `movablePegIds(...).some(id => pegDestinations(...).length > 0)`,
     so there are exactly two ways to get nothing, and a client that only handled one of
     them would be half right:

       1. NO SOURCE — the actor holds nothing that can move. Here the only peg is in a
          Volatile Area, so it is permanent and the set is empty before adjacency is
          even consulted.
       2. NO DESTINATION — a movable peg whose every ADJACENT constituency is full. Every
          neighbour of Central is filled here (21 + 17 + 17 + 21 areas), which also makes
          this the assertion that WITHIN-ZONE relocation is not offered: Central still
          has eight empty slots, a move "to another slot right there" would be a no-op on
          the board's own terms, and the engine offers none.
  */
  PEG_DEST(
    'choose-peg-dest with NO MOVABLE voter (the actor’s only peg is permanent)',
    P1,
    P1,
    [seat(P1, EMPTY, [{ areaId: A.nwVol, owner: P1 }]), seat(P2, EMPTY)],
    true,
  ),
  PEG_DEST(
    'choose-peg-dest with a movable voter and NO ADJACENT EMPTY AREA — its own slots are not a destination',
    P1,
    P1,
    [
      seat(
        P1,
        EMPTY,
        [
          { areaId: A.c1, owner: P1 },
          ...fill('north', P2),
          ...fill('west', P2),
          ...fill('east', P2),
          ...fill('south', P2),
        ],
      ),
      seat(P2, EMPTY),
    ],
    true,
  ),
];

describe('EVERY Choice kind, in EVERY degenerate state, is answerable', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      assertResolvable(sc);
    });
  }

  it(`covers all ten kinds — ${SCENARIOS.length} scenarios`, () => {
    // THE CASE COUNT, and the kinds list. `Choice` is the engine's union, so this
    // hand-copy of it is the thing that goes stale; the number is the assertion
    // that makes the staleness loud. `derive.ts assertNever` is the other half of
    // the guard — that one is a COMPILE error, this one is a test, and a compile
    // error cannot tell you the new kind is also *rendered*.
    const kinds = new Set(SCENARIOS.map((s) => s.choice.kind));
    expect([...kinds].sort()).toEqual([
      'choose-card',
      'choose-peg-dest',
      'choose-player',
      'choose-zone',
      'convert-voter',
      'discard-voter',
      'evict-voter',
      'gain-any',
      'lose-any',
      'steal-any',
    ]);
    expect(SCENARIOS.length, 'the scenario table shrank — every case is a promise').toBe(42);
    // And each of the three board-resolved kinds is present with at least one
    // SATISFIABLE case, not only the degenerate ones: a suite that only ever
    // tested "nothing to do" would pass on a board that highlights nothing.
    // `'choose-peg-dest'` is in that list for the same reason — it is board-resolved,
    // and three of its six cases are the unreachable half.
    for (const kind of [
      'evict-voter',
      'discard-voter',
      'convert-voter',
      'choose-peg-dest',
    ] as const) {
      const satisfiable = SCENARIOS.filter(
        (s) => s.choice.kind === kind && s.engineHasNoAnswer !== true,
      );
      expect(satisfiable.length, `${kind} has no satisfiable case`).toBeGreaterThan(0);
    }
    // …and G1's two unreachable halves are BOTH present, because they fail the offer
    // test for opposite reasons and a client that only handled one would be half right.
    const pegDest = SCENARIOS.filter((s) => s.choice.kind === 'choose-peg-dest');
    expect(
      pegDest.filter((s) => s.engineHasNoAnswer === true).length,
      'choose-peg-dest must cover both ways pegMoveOffered can be false',
    ).toBe(2);
  });

  it('the area-LIST guard names exactly the three list kinds, and the engine agrees', () => {
    // G1. `isVoterDecision` was typed `Extract<Choice, { scope: ChoiceScope }>`, and
    // the tenth kind carries a `scope` too — so the guard's TYPE claimed a member its
    // BODY rejects. This is the runtime half of that proof: the three names are the
    // client's own, and every one of them is really an area-shaped `Choice`. A fourth
    // board-resolved kind that is NOT a list would be added to `VOTER_KINDS` and
    // caught here, rather than inheriting a `zoneId` it does not have.
    for (const kind of VOTER_KINDS) {
      expect(
        isVoterDecision({ kind, count: 1, scope: 'any', reason: 'test' } as Choice),
        `${kind} should be a voter decision`,
      ).toBe(true);
    }
    // The peg move is board-resolved and is NOT this kind of decision.
    expect(
      isVoterDecision({
        kind: 'choose-peg-dest',
        count: 1,
        scope: 'own',
        source: P1,
        reason: 'test',
      }),
      'a two-place pick is not a list of pegs',
    ).toBe(false);
  });
});

// ─────────────────────────── the two named defects ───────────────────────────

describe('Defect A — an eviction ask is answerable in the real DOM', () => {
  it('the board highlights OCCUPIED, IN-SCOPE voters and accepts the click', () => {
    // The exact shape the harness found: "Evict 3 voters from the board", three
    // opponent pegs on the board, `0 of 3 chosen`, CONFIRM disabled, every
    // `legal target` an EMPTY slot and every occupied slot
    // `illegal: already occupied`.
    const sc = VOTER('evict-voter', 3, 'any', [
      seat(P1, EMPTY),
      seat(P2, EMPTY, [
        { areaId: A.n1, owner: P2 },
        { areaId: A.n2, owner: P2 },
        { areaId: A.n3, owner: P2 },
      ]),
    ]);
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);

    // THE THREE PEGS ARE THE TARGETS, and nothing else is.
    const targets = boardTargets(r.container).map((g) => g.getAttribute('data-area-id'));
    expect(targets.sort()).toEqual([A.n1, A.n2, A.n3].sort());
    // …and each one says so in the accessible name, at the same moment as the
    // highlight (§8.5): an occupied slot, not "empty".
    for (const g of boardTargets(r.container)) {
      expect(g.getAttribute('aria-label') ?? '').not.toContain(', empty.');
    }

    const drive = driveToResolution(r);
    expect(drive.why).toBe('CONFIRM is enabled');
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    const pick = seen[0] as ChoicePick;
    expect(pick.kind).toBe('areas');
    if (pick.kind === 'areas') expect(pick.areaIds.length).toBe(3);
    assertEngineAccepts(sc, pick);
    r.unmount();
  });

  it('the three kinds all reach CONFIRM on the real board, not just on the count', () => {
    const cases: readonly Scenario[] = [
      VOTER('evict-voter', 2, 'any', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.n1, owner: P2 }, { areaId: A.n2, owner: P2 }])]),
      VOTER('discard-voter', 2, 'own', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }, { areaId: A.nw2, owner: P1 }]), seat(P2, EMPTY)]),
      VOTER('convert-voter', 2, 'others', [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.n1, owner: P2 }, { areaId: A.n2, owner: P2 }])]),
    ];
    for (const sc of cases) {
      const seen: ChoicePick[] = [];
      const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
      const drive = driveToResolution(r);
      expect(drive.why, `${sc.name} — ${drive.why}`).toBe('CONFIRM is enabled');
      fireEvent.click(confirmOf(r.container) as HTMLElement);
      expect(seen, `${sc.name}: nothing dispatched`).toHaveLength(1);
      assertEngineAccepts(sc, seen[0] as ChoicePick);
      r.unmount();
    }
  });

  it('a ZONE-SCOPED ask offers only that constituency’s voters', () => {
    // `reduce.ts:3295` refuses an out-of-zone pick with "that voter is in
    // another zone". A board that offered the whole board would be offering a
    // button the server refuses — the same dead-control shape, one click earlier.
    const sc = VOTER(
      'evict-voter',
      1,
      'any',
      [
        seat(P1, EMPTY),
        seat(P2, EMPTY, [{ areaId: A.nw1, owner: P2 }, { areaId: A.w1, owner: P2 }]),
      ],
      { zoneId: 'north_west' },
    );
    const r = render(<Harness sc={sc} onResolved={() => undefined} />);
    const targets = boardTargets(r.container).map((g) => g.getAttribute('data-area-id'));
    expect(targets).toEqual([A.nw1]);
    const west = allSlots(r.container).find((g) => g.getAttribute('data-area-id') === A.w1);
    expect(west?.getAttribute('aria-label') ?? '').toContain('illegal');
    r.unmount();
  });
});

describe('Defect B — an over-cap discard is answerable in the real DOM', () => {
  it('"Discard 41" against a pool of 40 reaches an enabled CONFIRM', () => {
    // The recorded case, verbatim: `40 of 41 chosen. 1 still to choose.`,
    // `DISCARD 41` disabled, no cancel. `resolveChoice` wants
    // `min(count, poolTotal(now))` = 40, so the dialog that waited for 41 was
    // waiting for a number the engine will refuse.
    const sc = OVER_CAP(41, { funds: 10, clout: 10, media: 10, trust: 10 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);

    // The ask on the frame is the DERIVED one, and it is payable: 40, not 41.
    expect(r.container.querySelector('[data-testid=picker-status]')?.textContent).toContain(
      '0 of 40 chosen.',
    );
    const drive = driveToResolution(r);
    expect(drive.why).toBe('CONFIRM is enabled');
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    const pick = seen[0] as ChoicePick;
    if (pick.kind === 'resources') expect(total(pick.res)).toBe(40);
    assertEngineAccepts(sc, pick);
    r.unmount();
  });

  it('and an ask the player cannot pay at all is not merely refused with no way out', () => {
    // `poolTotal = 1`, ask 12: the derived ask is 1, which is payable. The
    // widget still says what it holds beside the control (§9.2), so even this
    // shape states its shortfall rather than going quiet.
    const sc = OVER_CAP(12, { funds: 1, clout: 0, media: 0, trust: 0 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    expect(r.container.querySelector('[data-testid=picker-status]')?.textContent).toContain(
      '0 of 1 chosen.',
    );
    const drive = driveToResolution(r);
    expect(drive.why).toBe('CONFIRM is enabled');
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
    r.unmount();
  });
});

describe('every dialog can be left, and the way out is honest', () => {
  const RESOLVABLE: readonly Scenario[] = SCENARIOS.filter(
    (s) => s.engineHasNoAnswer !== true,
  );

  it('every resolvable decision reaches a dispatched pick — no dialog is a dead end', () => {
    // The exit is the RESOLUTION, not a Cancel button. §5.9b gives a decision no
    // exit because there is nothing behind it, so a Cancel here would be a button
    // that lies; the honest way out of every one of these is a pick the engine
    // accepts, and `assertResolvable` asserts exactly that for all of them.
    expect(RESOLVABLE.length).toBe(37);
    for (const sc of RESOLVABLE) assertResolvable(sc);
  });

  it('no dialog renders a Cancel wired to nothing', () => {
    for (const sc of RESOLVABLE) {
      const r = render(<Harness sc={sc} onResolved={() => undefined} />);
      const cancels = dialogButtons(r.container).filter(
        (b) => (b.textContent ?? '').trim() === 'Cancel',
      );
      for (const c of cancels) {
        fireEvent.click(c);
        // A Cancel is only honest if pressing it CHANGES the frame. If it does
        // not, it is the old `onCancel={() => undefined}` wearing a label.
        expect(
          r.container.querySelector('[data-testid="choice-dialog"]'),
          `${sc.name}: Cancel is present but changes nothing`,
        ).not.toBeNull();
      }
      r.unmount();
    }
  });

  it('an area decision whose ask is ZERO is left by CONFIRM, which is live at 0 of 0', () => {
    for (const sc of [
      VOTER('evict-voter', 3, 'any', [seat(P1, EMPTY), seat(P2, EMPTY)]),
      VOTER('discard-voter', 1, 'others', [seat(P1, EMPTY, [{ areaId: A.nw1, owner: P1 }]), seat(P2, EMPTY)]),
      VOTER('convert-voter', 1, 'others', [seat(P1, EMPTY, [{ areaId: A.nwVol, owner: P2 }]), seat(P2, EMPTY)]),
    ]) {
      const seen: ChoicePick[] = [];
      const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
      expect(r.container.querySelector('[data-testid=area-choice-nothing]')).not.toBeNull();
      const confirm = confirmOf(r.container);
      expect(enabled(confirm), `${sc.name}: CONFIRM is not live at 0 of 0`).toBe(true);
      fireEvent.click(confirm as HTMLElement);
      expect(seen, `${sc.name}: the empty pick was not dispatched`).toEqual([
        { kind: 'areas', areaIds: [] },
      ]);
      r.unmount();
    }
  });
});

// ─────────────────── G1: the two-place pick, on its own ───────────────────

describe('G1 — a move is two presses, and the dialog says which half it wants', () => {
  const SHIPPED = PEG_DEST(
    'the actor’s voter, answered by another seat',
    P2,
    P1,
    [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.c1, owner: P2 }])],
  );

  it('the first ask names the SOURCE, and the second names the pair', () => {
    const r = render(<Harness sc={SHIPPED} onResolved={() => undefined} />);
    // Stage one: the pegs, counted, and the rule stated — not "Choose a voter" with no
    // indication that a destination is coming.
    const stage1 = r.container.querySelector('[data-testid=peg-dest-progress]')?.textContent ?? '';
    expect(stage1).toContain('Choose which voter to move');
    expect(stage1).toContain('1 can go');
    expect(stage1).toContain('adjacent constituency');
    // CONFIRM is NOT live yet: half a move is not a move, and a live CONFIRM here would
    // dispatch an empty half — the dead-dialog bug's mirror image.
    expect(enabled(confirmOf(r.container))).toBe(false);

    fireEvent.click(allSlots(r.container).find((g) => g.getAttribute('data-area-id') === A.c1) as HTMLElement);
    const stage2 = r.container.querySelector('[data-testid=peg-dest-progress]')?.textContent ?? '';
    expect(stage2).toContain('Moving Central, slot 1');
    expect(stage2).toContain('Choose where it lands');
    r.unmount();
  });

  it('a move dialog never renders the resource picker it would fall through to', () => {
    // THE FAILURE THIS KIND WOULD HAVE SHIPPED WITH. `choose-peg-dest` had no branch,
    // so it fell to the `<ResourcePicker>` fallback — a dialog titled "Discard exactly 1",
    // four denomination `Add` buttons and a `TAKE 1` that sends a `Delta` the server
    // refuses as `malformed action`. Semantic agreement: the dialog's TEXT has to match
    // what it DOES, and a resource picker says it is a resource picker.
    const r = render(<Harness sc={SHIPPED} onResolved={() => undefined} />);
    expect(r.container.querySelector('[data-testid=peg-dest-choice]')).not.toBeNull();
    for (const gone of ['picker-confirm', 'picker-status', 'picker__grid']) {
      expect(r.container.querySelector(`[data-testid=${gone}]`), `${gone} is the wrong dialog`).toBeNull();
    }
    expect(r.container.textContent).not.toContain('Discard exactly');
    expect(r.container.textContent).not.toContain('Take exactly');
    r.unmount();
  });

  it('the board is keyboard reachable and the held voter says so in its own name', () => {
    // §8.5: the accessible name and the visible highlight are the same fact. A spatial
    // two-step is only operable without a mouse if you can hear what you are holding —
    // and the board is ONE tab stop with a roving tabindex (§8.4 rule 2), so the
    // assertion is that there is a single stop and that Enter on a slot drives the
    // same transition a click does.
    const r = render(<Harness sc={SHIPPED} onResolved={() => undefined} />);
    expect(
      allSlots(r.container).filter((g) => g.getAttribute('tabindex') === '0').length,
      'the board is a single tab stop with a roving tabindex, not 129 of them',
    ).toBe(1);
    const slot = allSlots(r.container).find((g) => g.getAttribute('data-area-id') === A.c1);
    expect(slot?.getAttribute('role')).toBe('button');
    expect(slot?.getAttribute('aria-label') ?? '').toContain('legal target');

    // KEYBOARD, not a click: Enter on the voter picks it up, exactly as a press would.
    fireEvent.keyDown(slot as HTMLElement, { key: 'Enter' });
    const held = allSlots(r.container).find((g) => g.getAttribute('data-area-id') === A.c1);
    expect(held?.getAttribute('aria-label') ?? '').toContain('the voter you picked up to move');
    // And the destination is announced as an empty slot in the second stage, which is
    // what makes "legal" and "empty" the same sentence for a screen-reader player.
    const dest = boardTargets(r.container)[0];
    expect(dest?.getAttribute('aria-label') ?? '').toContain('legal target');
    expect(dest?.getAttribute('aria-label') ?? '').toContain(', empty.');
    fireEvent.keyDown(dest as HTMLElement, { key: 'Enter' });
    expect(enabled(confirmOf(r.container)), 'Enter on a landing did not complete the pair').toBe(true);
    r.unmount();
  });

  it('the scrim does not cover the board, because the board is half the answer', () => {
    // The one that hard-locked the table twice: a full-viewport scrim with the only
    // controls behind it. `.scrim--area` is what makes an area decision's board live,
    // and this kind is board-resolved, so it has to be in that set.
    const r = render(<Harness sc={SHIPPED} onResolved={() => undefined} />);
    const scrim = r.container.querySelector('[data-testid=choice-resolver]');
    expect(scrim?.className).toContain('scrim--area');
    expect(
      r.container.querySelector('[data-testid=choice-dialog]')?.getAttribute('aria-modal'),
      'telling a screen reader the rest of the page is inert is only true while it is',
    ).toBeNull();
    r.unmount();
  });
});

describe('G1 — the transition itself: two halves, four refusals, two ways back', () => {
  const sc = PEG_DEST(
    'the actor’s voter, answered by another seat',
    P2,
    P1,
    [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: A.c1, owner: P2 }])],
  );
  const state = buildState(sc);
  const choice = sc.choice.kind === 'choose-peg-dest' ? sc.choice : null;
  const opts = choice === null ? new Map() : pegMoveOptions(state, choice);

  it('the fixture is the shape the assertions assume', () => {
    // A vacuous block below would pass for the wrong reason, which is the failure mode
    // the whole file is written against.
    expect(choice).not.toBeNull();
    expect([...opts.keys()]).toEqual([A.c1]);
    expect(opts.get(A.c1)?.size ?? 0).toBeGreaterThan(0);
  });

  it('accepts the peg, then a destination of THAT peg, and only that peg’s', () => {
    if (choice === null) return;
    const dests = [...(opts.get(A.c1) ?? new Set<string>())];
    const first = pegMovePick(state, choice, [], A.c1);
    expect(first).toEqual({ ok: true, picks: [A.c1] });
    const hole = dests[0] as string;
    expect(pegMovePick(state, choice, [A.c1], hole)).toEqual({ ok: true, picks: [A.c1, hole] });
    // An empty area that is NOT adjacent to the peg is refused by name — an adjacent-zone
    // rule the engine enforces with "that is not an empty area in an adjacent zone".
    const elsewhere = state.zones
      .flatMap((z) => z.areas)
      .find((a) => a.peg === null && !dests.includes(a.id));
    expect(pegMovePick(state, choice, [A.c1], elsewhere?.id ?? '')).toEqual({
      ok: false,
      reason: 'that is not an empty area in an adjacent constituency',
    });
    // An OCCUPIED slot is not a destination either.
    expect(pegMovePick(state, choice, [], A.c1).ok).toBe(true);
  });

  it('presses what is already pressed to step BACK a half, not to do nothing', () => {
    if (choice === null) return;
    const hole = [...(opts.get(A.c1) ?? new Set<string>())][0] as string;
    expect(pegMovePick(state, choice, [A.c1, hole], hole)).toEqual({ ok: true, picks: [A.c1] });
    expect(pegMovePick(state, choice, [A.c1, hole], A.c1)).toEqual({ ok: true, picks: [] });
    // A THIRD slot, once the pair is complete, is neither half: it steps nothing back
    // and it is not a destination, so it is refused rather than silently ignored.
    expect(pegMovePick(state, choice, [A.c1, hole], A.nw1)).toEqual({
      ok: false,
      reason: 'this move is already complete',
    });
  });

  it('refuses a first pick that is not a movable voter, and says why', () => {
    if (choice === null) return;
    // An empty slot: the inverse of the list kinds, and the one a stage-blind board
    // would offer every time.
    expect(pegMovePick(state, choice, [], A.n1)).toEqual({
      ok: false,
      reason: 'only a voter that can move is the source of this move',
    });
    // A peg belonging to somebody else — the `scope: 'others'` trap the engine warns
    // about in its own field docs.
    const someoneElse = buildState({
      ...sc,
      seats: [seat(P1, EMPTY, [{ areaId: A.n1, owner: P1 }]), seat(P2, EMPTY)],
    });
    expect(pegMovePick(someoneElse, choice, [], A.n1)).toEqual({
      ok: false,
      reason: 'only a voter that can move is the source of this move',
    });
    // A peg that STOPPED being movable while the dialog was open: refused by the
    // engine's own wording rather than silently ignored.
    expect(pegMovePick(state, choice, [A.nwVol], A.c1)).toEqual({
      ok: false,
      reason: 'that voter may not be moved',
    });
  });
});

describe('the mirrors these rules rest on are still literally in reduce.ts', () => {
  it('the two peg-move candidate sets are still the three clauses and the adjacency read', () => {
    // G1's half of the pinning, and the reason `pegMoveOptions` is worth having: the
    // client mirrors two ENGINE EXPRESSIONS, so those expressions have to still be
    // there. `movablePegIds` is three `continue`s; `pegDestinations` is the
    // neighbour read plus the emptiness test. A change to any of them in the engine
    // without the mirror is a board that highlights what the resolver refuses — the
    // exact bug class this file exists for, and the one Defect A could not see.
    for (const clause of [
      'if (a.peg === null || a.peg.owner !== owner) continue;',
      'if (a.peg.majority) continue;',
      'if (a.volatile) continue;',
      'if (a.peg === null) out.push(a.id);',
      "if (z.id === from.zone) continue;",
      'if (!areNeighbours(from.zone, z.id)) continue;',
    ]) {
      expect(engineReduceSource, `reduce.ts no longer reads: ${clause}`).toContain(clause);
    }
  });

  it('the OFFER is still a boolean, and the resolver still refuses a stale pair', () => {
    // The deadlock argument, in the engine's own two lines. `pegMoveOffered` false means
    // the card raises NOTHING — which is what makes an empty pick space unreachable
    // rather than a locked table — and the resolver's guards are re-read against a live
    // board, so a player holding a stale dialog still has a legal pick to make. The
    // transcriptions above are only sound while these are the rules.
    expect(engineReduceSource).toContain(
      'return movablePegIds(state, owner).some((id) => pegDestinations(state, id).length > 0);',
    );
    for (const refusal of [
      "if (pick.kind !== 'peg-dest') return fail('choose a voter and where it goes');",
      "if (!movablePegIds(state, c.source).includes(pick.areaId)) {",
      "if (!pegDestinations(state, pick.areaId).includes(pick.toAreaId)) {",
    ]) {
      expect(engineReduceSource, `reduce.ts no longer refuses with: ${refusal}`).toContain(refusal);
    }
  });

  /** The body of `function targetableCount(` up to its closing brace at column 0. */
  const targetableCountBody = (): string => {
    const at = engineReduceSource.indexOf('function targetableCount(');
    expect(at, 'targetableCount is gone from reduce.ts').toBeGreaterThan(-1);
    return engineReduceSource.slice(at, engineReduceSource.indexOf('\n}', at));
  };

  /** The `case 'evict-voter': case 'discard-voter': case 'convert-voter':` arm. */
  const voterArm = (): string => {
    const at = engineReduceSource.indexOf("    case 'evict-voter':");
    expect(at, 'the voter arm is gone from resolveChoice').toBeGreaterThan(-1);
    // The three kinds are STACKED case labels, so slicing to "the next case" would
    // stop at `case 'convert-voter':` and read an empty arm. The next arm is
    // `choose-player` — the one the engine documents as following it.
    const end = engineReduceSource.indexOf("case 'choose-player':", at);
    expect(end, 'the voter arm no longer ends where it used to').toBeGreaterThan(at);
    return engineReduceSource.slice(at, end);
  };

  it('the accepted count is still min(count, targetableCount(...)) with the scope', () => {
    expect(voterArm()).toContain(
      'const wanted = Math.min(c.count, targetableCount(state, playerId, c.kind, c.scope, c.zoneId));',
    );
    // …and the pick it accepts is the mirror's own legal set, not a re-derivation:
    // the refusals below are the whole of `resolveChoice`'s per-area validation,
    // so a client that offers a slot any of them names is offering a dead button.
    for (const refusal of [
      'if (!area?.peg) return fail(\'there is no voter there\');',
      'if (area.volatile) return fail(\'voters in a Volatile Area cannot be affected\');',
      "return fail('that voter is in another zone');",
      "return fail('that voter is not yours');",
      "return fail('that targets an opponent');",
      "return fail('that voter is already yours');",
    ]) {
      expect(voterArm(), `reduce.ts no longer refuses with: ${refusal}`).toContain(refusal);
    }
  });

  it('the count is still "a real peg, not volatile, on the right side of scope"', () => {
    const body = targetableCountBody();
    // Each line is one clause of `derive.ts:targetableAreas`, which is what makes
    // the board's legal set the same set. A change to any of them in the engine
    // without the mirror is exactly the bug class this file exists for.
    expect(body).toContain('if (!a.peg || a.volatile) continue;');
    expect(body).toContain("if (scope === 'own' && a.peg.owner !== playerId) continue;");
    expect(body).toContain("if (scope === 'others' && a.peg.owner === playerId) continue;");
    expect(body).toContain("if (kind === 'convert-voter' && a.peg.owner === playerId) continue;");
    expect(body).toContain('if (zoneId !== undefined && z.id !== zoneId) continue;');
  });

  it('the discard is still clamped to what is held NOW, not to what was held at the ask', () => {
    // Defect B's whole cause, in the engine's own line. `reduce.ts:3227-3245`
    // documents why: a pending decision is not a lock the answering player holds,
    // so the pool can shrink under an open ask, so the RESOLUTION clamps.
    expect(engineReduceSource).toContain(
      'const wanted = Math.min(c.count, poolTotal(self.resources));',
    );
    expect(engineReduceSource).toContain(
      "if (deltaTotal(pick.res) !== wanted) return fail(`discard exactly ${wanted}`);",
    );
    // …while a GAIN is deliberately not clamped, which is why its picker is in
    // `gain` mode with the pool as a label. If this ever acquires a clamp, the
    // gain's ceiling must change with it — so it is pinned.
    expect(engineReduceSource).toContain('if (deltaTotal(pick.res) !== c.count) return fail(`choose exactly ${c.count}`);');
  });

it('the theft is still clamped to the victim’s pool at resolution time', () => {
    expect(engineReduceSource).toContain(
      'const want = Math.min(c.count, poolTotal(victim.resources));',
    );
  });
});

// ─────────────────────────── Defect C ───────────────────────────

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * DEFECT C — AN OVER-CAP ASK COULD NOT BE DISCHARGED, IN TEN PLAYTHROUGHS
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The sixth and worst recurrence of this project's dead-dialog class, and the only
 * one where the dialog was not dead but UNREACHABLE: every seat sat at CONFIRM's
 * threshold minus one, for three hundred turns, with a live table.
 *
 * The cause was not arithmetic — `requiredPicks` already mirrored the engine's
 * clamp, and Defect B's suite above already drove an ask of 41 to CONFIRM. The
 * cause was WHERE THE DRAFT LIVES. It was `app.picker.pick`, one store slot
 * shared with three payment widgets, and `GameScreen` nulls it on
 * `[store.viewId, state?.turn]` — `store.viewId` being the sync envelope's
 * counter. **Every `match:state` the server sent erased a half-entered
 * discard.**
 *
 * So the ask was dischargeable only if the player could bank every press between
 * two broadcasts. At an ask of 41, that is a permanent lock. And the ask GROWS
 * while the budget does not: p12's ask is `held - cap`, nothing returns resources
 * except card payouts (max 4), so a seat that crosses and cannot discharge climbs
 * every turn — the recorded arcs hold 53 (ask 41) and 83 (ask 71) against a cap
 * of 12.
 *
 * The tell in the arcs is that the status line NEVER moved off the same number:
 * `$TEMP/opencode/shasn-play/client-verify.json` holds 41 consecutive
 * `picker-unsolved` events, every one reading `"40 of 41 chosen. 1 still to
 * choose."` — and never `"39 of 41"`, which is what a surviving draft reads on
 * the second attempt.
 *
 * THESE TESTS SIMULATE THE BROADCAST, which is the part the old suite could not
 * see: `rerender` with a freshly-built `ClientState` is exactly what
 * `net/store.ts` hands the tree when a peer's action lands, and `Harness` builds
 * a new state object on every render, so a bare `rerender` IS a new envelope.
 */

/** `"N of M chosen"`, read off the status line the way the harness reads it. */
function pickerProgress(root: HTMLElement): { chosen: number; need: number } {
  const txt = (root.querySelector('[data-testid=picker-status]')?.textContent ?? '').replace(
    /\s+/g,
    ' ',
  );
  const m = /(\d+)\s+of\s+(\d+)\s+chosen/i.exec(txt);
  if (m === null) throw new Error(`status not parseable: "${txt}"`);
  return { chosen: Number(m[1]), need: Number(m[2]) };
}

/** The one enabled `+` in the picker grid — a denomination with headroom. */
function enabledPlus(root: HTMLElement): HTMLElement | null {
  return (
    [...root.querySelectorAll<HTMLElement>('.picker__grid .row--tight button')].find(
      (b) => enabled(b) && !(b.getAttribute('aria-label') ?? '').startsWith('Remove'),
    ) ?? null
  );
}

/** The `Delta` of a `resources` pick, once narrowed — the shape these asks dispatch. */
function resOf(pick: ChoicePick): Readonly<Record<string, number | undefined>> {
  expect(pick.kind, `expected a resources pick, got ${pick.kind}`).toBe('resources');
  return pick.kind === 'resources' ? pick.res : {};
}

/**
 * Press `+` until CONFIRM goes live, re-rendering between EVERY press.
 *
 * The re-render is the point, and it is deliberately the worst case rather than a
 * realistic one: it asserts the draft survives a fresh `ClientState` on every
 * single press, which is strictly stronger than "survives some of them" and is
 * what the recorded failure needed to not happen.
 */
function fillAcrossBroadcasts(
  r: RenderResult,
  sc: Scenario,
  onResolved: (p: ChoicePick) => void,
  limit = 200,
): void {
  for (let i = 0; i < limit; i += 1) {
    const confirm = confirmOf(r.container);
    if (enabled(confirm)) return;
    const plus = enabledPlus(r.container);
    expect(plus, `${sc.name}: the picker ran out of enabled + at ${JSON.stringify(pickerProgress(r.container))}`).not.toBeNull();
    fireEvent.click(plus as HTMLElement);
    // A NEW `ClientState`, as `net/store.ts` delivers on every `match:state`. The
    // `onResolved` seam is re-supplied because a rerender replaces every prop, and
    // a seam replaced with a no-op would make the dispatch assertions vacuous.
    r.rerender(<Harness sc={sc} onResolved={onResolved} />);
  }
  expect(confirmOf(r.container), `${sc.name}: CONFIRM never went live`).not.toBeNull();
  expect(enabled(confirmOf(r.container)), `${sc.name}: CONFIRM never went live`).toBe(true);
}

describe('Defect C — an over-cap ask is DISCHARGEABLE, across a broadcast on every press', () => {
  it('the recorded 53-held / cap-12 shape (ask 41) reaches a dispatched pick', () => {
    // `$TEMP/opencode/shasn-play/client-verify.json`, `unsatisfiablePicker`:
    //   { seat 1, demand 41, offer 13, status: "40 of 41 chosen. 1 still to choose." }
    // `offer` is the harness's own headroom sum, `poolTotal - chosen`, so 13 + 40
    // fixes the held pool at **53** — which is 41 asked and 13 spare, and why the
    // status could read "1 still to choose" with thirteen resources in hand.
    const held: Pool = { funds: 21, clout: 15, media: 14, trust: 3 };
    expect(total(held), 'the recorded arc held 53, not 40').toBe(53);
    const sc = OVER_CAP(41, held);
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    expect(pickerProgress(r.container), 'the ask is not the cap excess').toEqual({
      chosen: 0,
      need: 41,
    });
    fillAcrossBroadcasts(r, sc, (p) => seen.push(p));
    fireEvent.click(confirmOf(r.container) as HTMLElement);

    expect(seen, 'the 41-resource discard was never dispatched').toHaveLength(1);
    const res = resOf(seen[0] as ChoicePick);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
    expect(total(res), 'the pick does not discharge the whole ask').toBe(41);
    const left = RES.reduce((n, r2) => n + held[r2] - (res[r2] ?? 0), 0);
    expect(left, 'a player over a cap of 12 must be brought DOWN TO the cap').toBe(12);
  });

  it('the 459-turn shape — 0/0/12/12 against a cap of 12 — discharges', () => {
    // The state every one of the ten playthroughs ended in, read off the DOM:
    // `0 funds 0 clout 12 media 12 trust` with `12/12 held`. Three seats, all of
    // them locked, for 300+ turns. Ask 12, and it goes.
    const sc = OVER_CAP(12, { funds: 0, clout: 0, media: 12, trust: 12 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    expect(pickerProgress(r.container), 'the ask is not the cap excess').toEqual({
      chosen: 0,
      need: 12,
    });
    fillAcrossBroadcasts(r, sc, (p) => seen.push(p));
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
    expect(total(resOf(seen[0] as ChoicePick))).toBe(12);
  });

  it('a draft is NOT the sum of the table: 71 against a cap of 12 is dischargeable too', () => {
    // `lean-4.json` ends with a seat at 83 held, asking for 71. The seat that got
    // there climbed one turn at a time because the ask never went down, and the
    // largest recorded ask is the one this asserts, because it is the case where
    // "press + until it works" stops being a strategy at all.
    const held: Pool = { funds: 21, clout: 15, media: 33, trust: 14 };
    expect(total(held), 'the recorded lean-4 seat held 83').toBe(83);
    const sc = OVER_CAP(71, held);
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    expect(pickerProgress(r.container).need).toBe(71);
    fillAcrossBroadcasts(r, sc, (p) => seen.push(p));
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
    expect(total(resOf(seen[0] as ChoicePick))).toBe(71);
  });

  it('the draft survives a TURN boundary as well as a broadcast', () => {
    // `clearTurnInteraction` was keyed on `[store.viewId, state?.turn]` — two
    // dependencies, so pinning only the first would have left half the bug.
    const sc = OVER_CAP(12, { funds: 0, clout: 0, media: 12, trust: 12 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(enabledPlus(r.container) as HTMLElement);
      r.rerender(<Harness sc={{ ...sc, turn: (sc.turn ?? 1) + i + 1 }} onResolved={() => undefined} />);
    }
    expect(pickerProgress(r.container).chosen, 'a turn boundary wiped the draft').toBe(5);
    fillAcrossBroadcasts(r, sc, (p) => seen.push(p));
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    expect(total(resOf(seen[0] as ChoicePick))).toBe(12);
  });

  it('a DIFFERENT decision starts from nothing — the draft is keyed, not sticky', () => {
    // The other half of the fix. Keying the draft on `pending.id` is what makes it
    // safe to stop clearing it on every broadcast: a decision the table has moved
    // on from must not inherit the previous one's arithmetic, or CONFIRM would go
    // live against a draft composed for a different ask.
    const first = OVER_CAP(12, { funds: 0, clout: 0, media: 12, trust: 12 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={{ ...first, choiceId: 'ch-one' }} onResolved={(p) => seen.push(p)} />);
    for (let i = 0; i < 7; i += 1) fireEvent.click(enabledPlus(r.container) as HTMLElement);
    expect(pickerProgress(r.container).chosen).toBe(7);

    const second = { ...first, choiceId: 'ch-two', choice: { kind: 'gain-any' as const, count: 2, reason: 'Card effect' as const } };
    r.rerender(<Harness sc={second} onResolved={(p) => seen.push(p)} />);
    expect(
      pickerProgress(r.container),
      'the new decision inherited the old decision’s draft',
    ).toEqual({ chosen: 0, need: 2 });
  });

  it('the discard draft is NOT written into the shared payment picker any more', () => {
    // The cross-contamination half. `onDraft` used to write into `app.picker.pick`,
    // and when nothing was open it wrote `openPicker({ forKind: 'redraw', total: 0 })`
    // — a redraw offer with nothing to pay, summoned by pressing `+` on a discard.
    // `reduce.ts` keeps `RESOLVE_CHOICE` legal for the whole of an answer window,
    // so that offer could appear on the answer screen, which is a full-viewport
    // takeover that is supposed to own exactly one commit control.
    //
    // Asserted on the SOURCE rather than on a render, because the symptom was a
    // store write from a component that has no store: there is no DOM to catch it.
    // `?raw` is the route `derive.test.ts` established, and it reads the bytes the
    // bundler sees rather than a copy of them.
    expect(resolverSource, 'ChoiceResolver takes a draft from the store again').not.toMatch(
      /readonly draft:/,
    );
    expect(resolverSource, 'ChoiceResolver takes an onDraft from the store again').not.toMatch(
      /readonly onDraft:/,
    );
    expect(
      gameScreenSource,
      'GameScreen passes a store-backed draft into the choice resolver again',
    ).not.toMatch(/draft=\{app\.picker\?\.pick/);
    // …and the placeholder that made a free redraw offer is gone with it.
    expect(
      gameScreenSource,
      'GameScreen writes a redraw picker with no payment into the shared slot again',
    ).not.toContain("openPicker({ forKind: 'redraw', total: 0, pick: next })");
  });
});

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * DEFECT C, SECOND HALF — THE ASK IS ENTERED BY DENOMINATION, NOT BY RESOURCE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Defect C had two halves and only one of them was the wipe. The other is that a
 * cap discard is the ONE unbounded ask in the game: p12 makes it `held - cap`, and
 * nothing returns resources except card payouts (max 4), so a seat that crosses
 * and cannot discharge climbs every turn. `lean-4.json` ends at 83 held against a
 * cap of 12 — an ask of 71 — and the widget moved the draft by ONE per press.
 *
 * Seventy-one presses is not a hard lock (the draft now survives broadcasts, so
 * they all land), but it is the difference between a rule a player obeys and a
 * rule a player abandons, and an abandoned p12 discard is the original bug with
 * extra steps. So each denomination carries an `ALL` that moves it by everything
 * the decision still needs.
 *
 * The property asserted is NOT "the button exists". It is that **`ALL` never puts
 * the draft in a state CONFIRM cannot leave**, because a bulk control that
 * overshoots is the same dead dialog in a new place: "47 of 41 chosen", and the
 * only way out is `−` on each of four columns.
 */
describe('Defect C, second half — a bulk adder never overshoots the ask', () => {
  /** Press `ALL` on each denomination in turn, until CONFIRM is live or nothing moves. */
  function pressAll(r: RenderResult): void {
    for (let round = 0; round < 8; round += 1) {
      if (enabled(confirmOf(r.container))) return;
      const before = pickerProgress(r.container).chosen;
      for (const r2 of RES) {
        const all = r.container.querySelector<HTMLElement>(`[data-testid=picker-max-${r2}]`);
        if (all !== null && enabled(all)) fireEvent.click(all);
      }
      expect(
        pickerProgress(r.container).chosen,
        'ALL is enabled but moved nothing — a button that cannot act',
      ).toBeGreaterThan(before);
      expect(
        pickerProgress(r.container).chosen,
        'ALL overshot the ask, which CONFIRM can never accept',
      ).toBeLessThanOrEqual(pickerProgress(r.container).need);
    }
  }

  it('discharges the recorded 83-held / cap-12 ask of 71 in four presses', () => {
    const sc = OVER_CAP(71, { funds: 21, clout: 15, media: 33, trust: 14 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    pressAll(r);
    const presses = new Set(
      [...r.container.querySelectorAll<HTMLElement>('[data-testid^=picker-max-]')].map(
        (b) => b.getAttribute('data-testid'),
      ),
    );
    expect(pickerProgress(r.container)).toEqual({ chosen: 71, need: 71 });
    // Four denominations, and the whole ask went without naming a single `+`.
    expect(presses.size, 'the bulk control must be reachable on every denomination').toBe(4);
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
    expect(total(resOf(seen[0] as ChoicePick))).toBe(71);
  });

  it('stops exactly at the ask when one denomination holds more than is left to choose', () => {
    // funds 21, and the ask is 12: `ALL` on funds must take TWELVE, not twenty-one,
    // because `chosen > total` is the state CONFIRM cannot be talked out of.
    const sc = OVER_CAP(12, { funds: 21, clout: 0, media: 0, trust: 0 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    fireEvent.click(r.container.querySelector<HTMLElement>('[data-testid=picker-max-funds]') as HTMLElement);
    expect(pickerProgress(r.container), 'ALL took more than the whole ask').toEqual({
      chosen: 12,
      need: 12,
    });
    expect(
      (r.container.querySelector('[data-testid=picker-confirm]')?.hasAttribute('disabled') ?? true),
      'the bulk adder left CONFIRM disabled',
    ).toBe(false);
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
  });

  it('never claims more than is HELD, on a cost — the canAfford half of the engine rule', () => {
    // `canAfford` is the other of `resolveChoice`'s two checks on a `lose-any`. A
    // bulk control that ignored the ceiling would produce a pick that totals the
    // right number and still gets `you do not hold those`.
    const sc = OVER_CAP(9, { funds: 3, clout: 3, media: 3, trust: 3 });
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);
    pressAll(r);
    fireEvent.click(confirmOf(r.container) as HTMLElement);
    expect(seen).toHaveLength(1);
    assertEngineAccepts(sc, seen[0] as ChoicePick);
    for (const r2 of RES) {
      expect(
        (resOf(seen[0] as ChoicePick)[r2] ?? 0) <= 3,
        `ALL claimed ${resOf(seen[0] as ChoicePick)[r2] ?? 0} ${r2} of a pool holding 3`,
      ).toBe(true);
    }
  });

  it('is inert once the ask is met, rather than an enabled control that does nothing', () => {
    // §9.10. `want >= total` disables it, so a player holding a complete draft is
    // never offered a control that cannot act — the failure `ResourcePicker`'s own
    // header records for the `+` cell before it was given the same treatment.
    const sc = OVER_CAP(2, { funds: 4, clout: 0, media: 0, trust: 0 });
    const r = render(<Harness sc={sc} onResolved={() => undefined} />);
    const all = (): HTMLElement => r.container.querySelector<HTMLElement>('[data-testid=picker-max-funds]') as HTMLElement;
    expect(enabled(all()), 'ALL must be live while the ask is unmet').toBe(true);
    fireEvent.click(all());
    expect(enabled(all()), 'ALL must be dead once the ask is met').toBe(false);
    expect(pickerProgress(r.container)).toEqual({ chosen: 2, need: 2 });
  });
});
