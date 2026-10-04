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
  requiredPicks,
  targetableAreas,
  targetableCount,
  toBoardState,
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
    turn: 1,
    round: 1,
    finished: false,
    market: NO_MARKET,
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices: [{ id: 'ch-invariant', player: sc.you, choice: sc.choice }],
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
  const [draft, setDraft] = useState<Readonly<Record<string, number>>>({
    funds: 0,
    clout: 0,
    media: 0,
    trust: 0,
  });
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
    onResolvePlayer: (_id, id) => onResolved({ kind: 'player', id }),
    onResolveZone: (_id, zoneId) => onResolved({ kind: 'zone', zoneId: zoneId as ZoneID }),
    onResolveCard: (_id, cardId) => onResolved({ kind: 'card', cardId }),
    recycle: recycleFor(sc),
    draft,
    onDraft: setDraft,
  };

  const onSlotActivate = (areaId: string): void => {
    if (owed === null || !isVoterDecision(owed)) return;
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
    root.querySelector('[data-testid=area-choice-confirm]')
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

  // `areas`
  expect(isVoterDecision(c), `${sc.name}: expected a voter decision`).toBe(true);
  if (!isVoterDecision(c)) return;
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
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
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
];

describe('EVERY Choice kind, in EVERY degenerate state, is answerable', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      assertResolvable(sc);
    });
  }

  it(`covers all nine kinds — ${SCENARIOS.length} scenarios`, () => {
    // THE CASE COUNT, and the kinds list. `Choice` is the engine's union, so this
    // hand-copy of it is the thing that goes stale; the number is the assertion
    // that makes the staleness loud. `derive.ts assertNever` is the other half of
    // the guard — that one is a COMPILE error, this one is a test, and a compile
    // error cannot tell you the new kind is also *rendered*.
    const kinds = new Set(SCENARIOS.map((s) => s.choice.kind));
    expect([...kinds].sort()).toEqual([
      'choose-card',
      'choose-player',
      'choose-zone',
      'convert-voter',
      'discard-voter',
      'evict-voter',
      'gain-any',
      'lose-any',
      'steal-any',
    ]);
    expect(SCENARIOS.length, 'the scenario table shrank — every case is a promise').toBe(36);
    // And each of the three board-resolved kinds is present with at least one
    // SATISFIABLE case, not only the degenerate ones: a suite that only ever
    // tested "nothing to do" would pass on a board that highlights nothing.
    for (const kind of ['evict-voter', 'discard-voter', 'convert-voter'] as const) {
      const satisfiable = SCENARIOS.filter(
        (s) => s.choice.kind === kind && s.engineHasNoAnswer !== true,
      );
      expect(satisfiable.length, `${kind} has no satisfiable case`).toBeGreaterThan(0);
    }
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
    expect(RESOLVABLE.length).toBe(33);
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

// ─────────────────────────── the mirrors, pinned to the engine's own text ───────────────────────────

describe('the mirrors these rules rest on are still literally in reduce.ts', () => {
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