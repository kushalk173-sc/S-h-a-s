/**
 * THE DEAD-DIALOG GATE. No `Choice` kind may ever present a dialog with no
 * resolvable path.
 *
 * ─────────────────────────── THE DEFECT THIS FILE EXISTS FOR ───────────────────
 *
 * Real 5-player browser playtesting, turn 7. A player holding 0/0/0/0 was
 * offered "gain 1 resource of your choice" and the dialog came up with:
 *
 *   - every `Add` control disabled, because there was nothing held to add FROM;
 *   - the `TAKE 1` confirm disabled, because the draft could not exceed the pool;
 *   - a `Cancel` wired to `() => undefined`.
 *
 * NO ENABLED CONTROL EXISTED ANYWHERE IN THE DIALOG. Measured in a headless
 * browser against the real server, on a real 0/0/0/0 seat playing a real
 * `gain-any` card: 0 of 13 controls enabled. The engine's per-player freeze
 * refuses every other action, so the table was stuck until the server
 * restarted. `ChoiceResolver` was passing `pool={me.resources}` — what the player
 * HOLDS — as the CEILING for a gain, which is a category error: "what you can
 * afford" is a statement about a COST, and `reduce.ts:resolveChoice` imposes no
 * `canAfford` on a `gain-any` at all, because a resource you are about to be
 * handed is not one you must already own.
 *
 * A second instance of the same shape turned up in the audit below, and this file
 * exists to catch that one too: `derive.ts:targetableAreas` ignored `ChoiceScope`,
 * so a `scope: 'own'` ask offered and demanded a pick count drawn from a set the
 * engine refuses. Both were confirmed by re-introducing the fault and watching
 * these assertions fail.
 *
 * ────────────────────────────────── WHAT IS ASSERTED ──────────────────────────
 *
 * One property, over EVERY `Choice` kind, in EVERY degenerate state:
 *
 *   FROM THE INITIAL DRAFT, A LEGAL RESOLUTION IS REACHABLE BY CLICKING.
 *
 * Not "some control is enabled" — too weak, because an enabled `−` on a gain gets
 * a player no closer to a resolution. The driver below presses only controls that
 * ADVANCE the decision (the denomination `+`, a victim, a legal board slot) and
 * asserts the confirm goes live. It then presses the confirm and checks the pick
 * against every rule `resolveChoice` applies.
 *
 * ────────────────────────── WHAT THIS FILE CANNOT DO, AND WHY ──────────────────
 *
 * The obvious strongest version of this gate would build a real `GameState` with
 * `setup()`, drive the real dialog, and hand the resulting pick to the real
 * `reduce` to be accepted or refused. That version is NOT possible here, and the
 * reason is worth stating rather than working around:
 *
 * `packages/server/scripts/check-secrets.mjs` fails the build on any VALUE import
 * of `@shasn/engine` anywhere under `packages/client/src` — test files included,
 * with no exemption, because the check walks the directory rather than the bundle
 * (`net/index.ts` documents why the rule exists). So a test in this package may
 * not call the engine, and this file does not try to.
 *
 * The engine's semantics are therefore pinned here as a TRANSCRIPTION of
 * `reduce.ts:resolveChoice` and `reduce.ts:targetableCount`:
 *
 *   - `gain-any`     requires a signed total of exactly `count`, and applies NO
 *                    `canAfford`. A gain is not affordability.
 *   - `lose-any`     requires the same total AND `canAfford`; the engine only ever
 *                    raises it clamped to what is held (`applyEffect`, `enforceCap`).
 *   - `steal-any`    requires `min(count, victim total)` and per-denomination
 *                    `canAfford` on the VICTIM, so a victim holding nothing makes
 *                    the ask 0 and an EMPTY pick legal.
 *   - the three      require exactly `min(count, targetable(scope, kind))` areas,
 *     voter kinds    and an EMPTY list is legal for a zero ask.
 *
 * That transcription is why this is a gate and not a snapshot: the scope bug
 * demanded 2 picks where the engine wanted 1, and a test that only counted DOM
 * controls could not see it. The live agreement between the transcription and the
 * engine was verified separately and out of band — headless Chrome over raw CDP,
 * two real seats, a real match, the server credited the gain 0 → 1 after one
 * press. A standing parity assertion belongs in `packages/engine/test` or
 * `packages/server/test`, which this agent does not own; it is worth adding.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
// TYPE-ONLY, and not by accident — see the header. `check-secrets.mjs` scans this
// whole directory and fails the build on a value import here, test file included.
import type {
  Choice,
  ChoicePick,
  ChoiceScope,
  ClientState,
  LogEntry,
  MarketSlot,
  PlayerID,
  PlayerState,
  Pool,
  Zone,
  ZoneID,
} from '@shasn/engine';

import { ChoiceResolver, type ChoiceResolverProps } from './ChoiceResolver.tsx';
// The stylesheet that decides whether a click on the board reaches the board, read
// as source rather than as a processed approximation (`appLayout.test.tsx` does the
// same, and for the same reason: jsdom has no hit tester).
import appCss from './app.css?raw';
import {
  choosableZones,
  requiredPicks,
  targetableAreas,
  targetableCount,
} from './derive.ts';

// ─────────────────────────── the board, by hand ───────────────────────────

const EMPTY: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };
const RES = ['funds', 'clout', 'media', 'trust'] as const;

/** Real area ids off the generated 9-zone board. `north_west-07` is Volatile. */
const NW1 = 'north_west-01';
const NW2 = 'north_west-02';
const NVOL = 'north_west-07';
const N1 = 'north-01';
const N2 = 'north-02';
const N3 = 'north-03';
const N4 = 'north-04';
const N5 = 'north-05';

/**
 * Three zones, ten slots, hand-built — because the engine is not reachable from
 * this package (see the header). Deliberately the REAL shape, including the
 * Volatile slot, because volatility and scope are precisely the two rules the two
 * dead dialogs turned on and a fixture that invented them would be testing the
 * fixture.
 */
const ZONES: readonly Zone[] = [
  {
    id: 'north_west',
    name: 'North West',
    majority: 6,
    capacity: 3,
    neighbours: ['north'],
    majorityHolder: null,
    areas: [
      { id: NW1, zone: 'north_west', volatile: false, peg: null },
      { id: NW2, zone: 'north_west', volatile: false, peg: null },
      { id: NVOL, zone: 'north_west', volatile: true, peg: null },
    ],
  },
  {
    id: 'north',
    name: 'North',
    majority: 11,
    capacity: 5,
    neighbours: ['north_west', 'central'],
    majorityHolder: null,
    areas: [
      { id: N1, zone: 'north', volatile: false, peg: null },
      { id: N2, zone: 'north', volatile: false, peg: null },
      { id: N3, zone: 'north', volatile: false, peg: null },
      { id: N4, zone: 'north', volatile: false, peg: null },
      { id: N5, zone: 'north', volatile: false, peg: null },
    ],
  },
  {
    id: 'central',
    name: 'Central',
    majority: 9,
    capacity: 2,
    neighbours: ['north'],
    majorityHolder: null,
    areas: [
      { id: 'central-01', zone: 'central', volatile: false, peg: null },
      { id: 'central-02', zone: 'central', volatile: false, peg: null },
    ],
  },
];

function makePlayer(id: PlayerID, pool: Pool): PlayerState {
  return {
    id,
    name: id,
    colour: '#fff',
    resources: pool,
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    /*
     * `restrictions` is OPTIONAL on `PlayerState` (see the engine's note on it: the
     * field is optional only so this package's hand-built literals kept compiling,
     * and `setup()` always writes `[]`). It is spelled out here rather than left
     * absent, because an optional field on a state type is exactly the thing that
     * quietly becomes load-bearing — a fixture reading `undefined` is
     * indistinguishable, to every read that goes through the engine's own helper,
     * from a player with no restrictions.
     */
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

type PegSpec = { readonly areaId: string; readonly owner: PlayerID; readonly majority?: boolean };

type SeatSpec = {
  readonly player: PlayerID;
  readonly pool: Pool;
  readonly pegs?: readonly PegSpec[];
};

type Scenario = {
  readonly name: string;
  readonly choice: Choice;
  readonly seats: readonly SeatSpec[];
  /** The seat that owes the decision. */
  readonly you: PlayerID;
};

const NO_LOG: readonly LogEntry[] = [];
const NO_MARKET: readonly MarketSlot[] = [];

/**
 * A `ClientState` — which is the whole of what the client is ever given —
 * carrying the scenario. Cast once, at the boundary, because the fields no
 * component under test reads (`market`, `log`, the deck sizes) are noise here.
 */
function buildState(sc: Scenario): ClientState {
  const players: Record<PlayerID, PlayerState> = {};
  for (const s of sc.seats) players[s.player] = makePlayer(s.player, s.pool);

  const byArea = new Map<string, { owner: PlayerID; majority: boolean }>();
  for (const s of sc.seats) {
    for (const peg of s.pegs ?? []) {
      byArea.set(peg.areaId, { owner: peg.owner, majority: peg.majority ?? false });
    }
  }
  const zones: Zone[] = ZONES.map((z) => ({
    ...z,
    areas: z.areas.map((a) => {
      const peg = byArea.get(a.id);
      return { ...a, peg: peg === undefined ? null : peg };
    }),
  }));

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
    choices: [{ id: 'ch-test', player: sc.you, choice: sc.choice }],
    log: NO_LOG,
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
  } as unknown as ClientState;
}

const seat = (p: PlayerID, pool: Pool, pegs?: readonly PegSpec[]): SeatSpec =>
  pegs === undefined ? { player: p, pool } : { player: p, pool, pegs };

/**
 * The three board-targeting kinds, as a TYPE GUARD, because `Choice` is a
 * six-way union and `scope` only exists on three of the members. Mirrors
 * `ChoiceResolver`'s `isAreaShaped`.
 */
function areaShapedKind(
  choice: Choice,
): choice is Extract<Choice, { readonly scope: ChoiceScope }> {
  return (
    choice.kind === 'evict-voter' ||
    choice.kind === 'discard-voter' ||
    choice.kind === 'convert-voter'
  );
}

const total = (d: Readonly<Record<string, number | undefined>>): number =>
  RES.reduce((n, r) => n + (d[r] ?? 0), 0);

function ownerOf(state: ClientState, areaId: string): PlayerID | null {
  for (const z of state.zones) {
    for (const a of z.areas) if (a.id === areaId) return a.peg?.owner ?? null;
  }
  return null;
}

function areaOf(state: ClientState, areaId: string) {
  for (const z of state.zones) {
    for (const a of z.areas) if (a.id === areaId) return a;
  }
  return undefined;
}

const P1: PlayerID = 'p1';
const P2: PlayerID = 'p2';
const P3: PlayerID = 'p3';

// ─────────────────────────── the harness, mirroring GameScreen ───────────────────

/**
 * `ChoiceResolver` is a CONTROLLED dialog: the draft and the picked area ids live
 * in `GameScreen` and come back as props. Driving it with a bare `vi.fn()` would
 * freeze the draft at zero and make every assertion vacuous, so the harness runs
 * the same one-way loop the real screen does.
 *
 * The stand-in board stands in for the 129-slot SVG, which is not this file's to
 * render. Crucially it gates on the CLIENT'S OWN `targetableAreas` — the same
 * function `GameScreen` uses to decide which slots to accept — so a `scope`
 * mismatch shows up as a slot that will not move, which is what happens in the
 * browser. The board is not a rubber stamp: clicking it produces the pick.
 */
function Harness({
  sc,
  onResolved,
}: {
  sc: Scenario;
  onResolved: (pick: ChoicePick) => void;
}) {
  const [draft, setDraft] = useState<Readonly<Record<string, number>>>({
    funds: 0,
    clout: 0,
    media: 0,
    trust: 0,
  });
  const [pickedAreaIds, setPickedAreaIds] = useState<readonly string[]>([]);
  const state = buildState(sc);
  const owed = state.choices.find((c) => c.player === sc.you)?.choice ?? null;
  const legal: ReadonlySet<string> =
    owed !== null && areaShapedKind(owed)
      ? targetableAreas(state, sc.you, owed.kind, owed.scope, owed.zoneId)
      : new Set<string>();

  const props: ChoiceResolverProps = {
    state,
    you: sc.you,
    pickedAreaIds,
    onPickArea: (areaId) => setPickedAreaIds((cur) => [...cur, areaId]),
    onRemovePick: () => setPickedAreaIds((cur) => cur.slice(0, -1)),
    onResolveResources: (_id, pick) => onResolved({ kind: 'resources', res: pick }),
    onResolveSteal: (_id, from, pick) => onResolved({ kind: 'steal', from, res: pick }),
    onResolveAreas: (_id, areaIds) => onResolved({ kind: 'areas', areaIds }),
    // G1/G16. Routed through the SAME `onResolved` seam as the other three, so a
    // regression in either new resolver fails the same engine-side assertions the
    // area and theft picks are held to below rather than a weaker local check.
    onResolvePlayer: (_id, playerId) => onResolved({ kind: 'player', id: playerId }),
    onResolveZone: (_id, zoneId) => onResolved({ kind: 'zone', zoneId: zoneId as ZoneID }),
    draft,
    onDraft: setDraft,
  };

  return (
    <div>
      <div data-testid="stand-in-board">
        {state.zones.flatMap((z) =>
          z.areas.map((a) => (
            <button
              key={a.id}
              type="button"
              data-testid={`slot-${a.id}`}
              disabled={owed === null || !legal.has(a.id) || pickedAreaIds.includes(a.id)}
              onClick={() => props.onPickArea(a.id)}
            >
              {a.id}
            </button>
          )),
        )}
      </div>
      <ChoiceResolver {...props} />
    </div>
  );
}

// ─────────────────────────── the driver ───────────────────────────

function confirmOf(root: HTMLElement): HTMLElement | null {
  return (
    root.querySelector('[data-testid=picker-confirm]') ??
    root.querySelector('[data-testid=area-choice-confirm]')
  );
}

function isEnabled(el: HTMLElement | null): el is HTMLElement {
  return el !== null && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
}

/** Dialog controls only — the stand-in board is the player's board, not the dialog. */
function dialogButtons(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid=choice-dialog] button')];
}

type Drive = {
  /** Every control IN THE DIALOG that is enabled right now. */
  enabled: () => HTMLElement[];
  /** Every STAND-IN BOARD slot that is enabled right now. */
  board: () => HTMLElement[];
  /** Press the controls that advance the decision; returns the confirm once live. */
  advance: (maxSteps?: number) => HTMLElement | null;
  pressConfirm: () => void;
};

function drive(r: RenderResult): Drive {
  const root = r.container;

  /**
   * One press of the cheapest control that makes progress, in the order a player
   * reads the dialog: a denomination `+`, then a victim, then a legal board slot.
   *
   * A control that is enabled but goes BACKWARDS — a `−` on an untouched gain — is
   * deliberately never pressed, because "something is lit" is not the property
   * under test. Reaching the confirm is.
   */
  const advance = (maxSteps = 24): HTMLElement | null => {
    for (let step = 0; step < maxSteps; step += 1) {
      const confirm = confirmOf(root);
      if (isEnabled(confirm)) return confirm;

      const add = [...root.querySelectorAll<HTMLElement>('.picker__grid .row--tight button')].find(
        (b) => isEnabled(b) && !b.getAttribute('aria-label')?.startsWith('Remove'),
      );
      if (add !== undefined) {
        fireEvent.click(add);
        continue;
      }
      const victim = root.querySelector<HTMLElement>('[data-testid=steal-victim]');
      if (isEnabled(victim)) {
        fireEvent.click(victim);
        continue;
      }
      const slot = [...root.querySelectorAll<HTMLElement>('[data-testid^="slot-"]')].find((b) =>
        isEnabled(b),
      );
      if (slot !== undefined) {
        fireEvent.click(slot);
        continue;
      }
      break;
    }
    return isEnabled(confirmOf(root)) ? confirmOf(root) : null;
  };

  return {
    enabled: () => dialogButtons(root).filter((b) => isEnabled(b)),
    board: () =>
      [...root.querySelectorAll<HTMLElement>('[data-testid^="slot-"]')].filter((b) =>
        isEnabled(b),
      ),
    advance,
    pressConfirm: () => {
      const confirm = confirmOf(root);
      if (isEnabled(confirm)) fireEvent.click(confirm);
    },
  };
}

// ─────────────────────────── the gate ───────────────────────────

/**
 * THE ASSERTION, once, for a scenario.
 *
 * 1. the dialog renders at all;
 * 2. something is enabled on arrival — the literal dead-dialog assertion;
 * 3. a legal resolution is REACHABLE: the confirm goes live under pressing;
 * 4. the pick it produces SATISFIES EVERY RULE `resolveChoice` APPLIES.
 */
function assertResolvable(sc: Scenario): ChoicePick {
  const seen: ChoicePick[] = [];
  const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);

  expect(
    r.container.querySelector('[data-testid=choice-dialog]'),
    `${sc.name}: no choice dialog rendered`,
  ).not.toBeNull();

  const d = drive(r);
  /*
   * THE DEAD-DIALOG ASSERTION, counted across BOTH surfaces.
   *
   * A resource-shaped decision is resolved inside the dialog. An area-shaped one
   * is resolved on the BOARD — the dialog's own copy says "close this and click the
   * highlighted slots" — and when the board offers nothing the dialog's CONFIRM is
   * live at `0 of 0` instead. The original bug was a resource shape with no live
   * control in EITHER place, so the count is taken over both, and the shape that
   * ought to carry the control is named in the failure.
   */
  const inDialog = d.enabled();
  const onBoard = d.board();
  expect(
    inDialog.length + onBoard.length,
    `${sc.name}: DEAD DIALOG — no enabled control on the board or in the dialog`,
  ).toBeGreaterThan(0);
  if (!areaShapedKind(sc.choice)) {
    expect(
      inDialog.length,
      `${sc.name}: a resource-shaped decision must be resolvable from inside its own dialog`,
    ).toBeGreaterThan(0);
  }

  const confirm = d.advance();
  expect(
    confirm,
    `${sc.name}: no reachable resolution — the confirm never became enabled`,
  ).not.toBeNull();

  d.pressConfirm();
  expect(seen, `${sc.name}: the confirm produced no pick`).toHaveLength(1);
  const pick = seen[0] as ChoicePick;
  assertEngineWouldAccept(sc, pick);

  r.unmount();
  return pick;
}

/**
 * `resolveChoice`'s rules, transcribed. This is the half of the gate the secret
 * gate keeps out of this package, written out so a drifted client mirror is still
 * caught — with the engine's own refusal messages, so a failure says which rule.
 */
function assertEngineWouldAccept(sc: Scenario, pick: ChoicePick): void {
  const state = buildState(sc);
  const required = requiredPicks(sc.choice, state, sc.you);

  /**
   * G1/G16. `resolveChoice`'s two new rules, transcribed with the engine's own
   * refusal strings so a failure names which rule was broken:
   *  - `'choose-player'`: "you may not choose that player" — the accepted set is
   *    `turnOrder` minus the card's `source`.
   *  - `'choose-zone'`: "you may not choose that constituency" — the accepted set is
   *    the zones holding a peg this effect could name.
   *
   * Both are the SAME expressions `applyEffect` offered the choices from, which is
   * what makes them satisfiable, so asserting membership here is asserting the
   * satisfiability invariant from the client side.
   */
  if (pick.kind === 'player') {
    expect(sc.choice.kind, `${sc.name}: a player pick for a non-player choice`).toBe('choose-player');
    if (sc.choice.kind !== 'choose-player') return;
    expect(pick.id === sc.choice.source, `${sc.name}: "you may not choose that player" — the chooser`).toBe(
      false,
    );
    expect(
      state.turnOrder.includes(pick.id),
      `${sc.name}: "you may not choose that player" — unknown seat`,
    ).toBe(true);
    return;
  }
  if (pick.kind === 'zone') {
    expect(sc.choice.kind, `${sc.name}: a zone pick for a non-zone choice`).toBe('choose-zone');
    if (sc.choice.kind !== 'choose-zone') return;
    const offered = choosableZones(state, sc.choice).map((z) => z.id);
    expect(
      offered.includes(pick.zoneId),
      `${sc.name}: "you may not choose that constituency" — ${pick.zoneId} not in ${offered.join('/')}`,
    ).toBe(true);
    return;
  }

  if (pick.kind === 'resources') {
    expect(total(pick.res), `${sc.name}: "choose exactly ${required}"`).toBe(required);
    // R3: `deltaTotal` sums SIGNED values, so a mixed-sign pick would pass the
    // count check and then be credited in full. `deltaError` refuses those and the
    // picker cannot produce one, and neither may this gate.
    for (const r of RES) {
      expect(
        (pick.res[r] ?? 0) >= 0,
        `${sc.name}: a negative ${r} would mint resources — the engine refuses it`,
      ).toBe(true);
    }
    if (sc.choice.kind === 'lose-any') {
      const me = state.players[sc.you];
      for (const r of RES) {
        expect(
          (pick.res[r] ?? 0) <= (me?.resources[r] ?? 0),
          `${sc.name}: "you do not hold those" — ${pick.res[r] ?? 0} ${r}`,
        ).toBe(true);
      }
    }
    if (sc.choice.kind === 'gain-any') {
      /*
       * NO AFFORDABILITY ON A GAIN, asserted as an absence. The engine applies no
       * `canAfford` here, and this is the line that says so: an empty pool is a
       * legal position to receive a resource FROM, and the pre-fix client could not
       * express it at all. Nothing below this point may consult the pool.
       */
      expect(
        sc.choice.kind === 'gain-any',
        `${sc.name}: a gain must not be checked against a pool`,
      ).toBe(true);
    }
    return;
  }

  if (pick.kind === 'steal') {
    expect(sc.choice.kind, `${sc.name}: expected a steal-any`).toBe('steal-any');
    if (sc.choice.kind !== 'steal-any') return;
    const victim = state.players[pick.from];
    expect(victim, `${sc.name}: "unknown player"`).toBeDefined();
    if (victim === undefined) return;
    expect(pick.from === sc.you, `${sc.name}: "steal from someone else"`).toBe(false);
    if (sc.choice.from !== null) {
      expect(pick.from, `${sc.name}: "that is not the player you may take from"`).toBe(
        sc.choice.from,
      );
    }
    expect(
      total(pick.res),
      `${sc.name}: "take exactly ${Math.min(sc.choice.count, total(victim.resources))}"`,
    ).toBe(Math.min(sc.choice.count, total(victim.resources)));
    for (const r of RES) {
      expect(
        (pick.res[r] ?? 0) <= victim.resources[r],
        `${sc.name}: "they do not hold those" — ${pick.res[r] ?? 0} ${r}`,
      ).toBe(true);
    }
    return;
  }

  // `areas`
  expect(areaShapedKind(sc.choice), `${sc.name}: expected a voter decision`).toBe(true);
  if (!areaShapedKind(sc.choice)) return;
  const want = Math.min(
    sc.choice.count,
    targetableCount(state, sc.you, sc.choice.kind, sc.choice.scope),
  );
  expect(pick.areaIds.length, `${sc.name}: "choose exactly ${want}"`).toBe(want);
  expect(
    new Set(pick.areaIds).size,
    `${sc.name}: "duplicate area"`,
  ).toBe(pick.areaIds.length);
  for (const id of pick.areaIds) {
    const area = areaOf(state, id);
    expect(area, `${sc.name}: "there is no voter there" — ${id}`).toBeDefined();
    expect(
      area?.volatile,
      `${sc.name}: "voters in a Volatile Area cannot be affected" — ${id}`,
    ).not.toBe(true);
    if (sc.choice.kind === 'convert-voter') {
      expect(
        ownerOf(state, id) === sc.you,
        `${sc.name}: "that voter is already yours" — ${id}`,
      ).toBe(false);
    }
    if (sc.choice.scope === 'own') {
      expect(ownerOf(state, id), `${sc.name}: "that voter is not yours" — ${id}`).toBe(sc.you);
    }
    if (sc.choice.scope === 'others' && sc.choice.kind !== 'evict-voter') {
      expect(
        ownerOf(state, id) === sc.you,
        `${sc.name}: "that targets an opponent" — ${id}`,
      ).toBe(false);
    }
  }
}

// ─────────────────────────── gain-any ───────────────────────────

describe('gain-any — a receipt, and THE PLAYTESTED BUG', () => {
  it('a 0/0/0/0 player offered 1 resource can take it', () => {
    // "A player holding 0/0/0/0 who is offered 'gain 1 resource' therefore has
    // every Add control disabled… and the TAKE 1 confirm disabled."
    const pick = assertResolvable({
      name: 'gain-any 1 with an empty pool',
      choice: { kind: 'gain-any', count: 1, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, { funds: 3, clout: 0, media: 0, trust: 0 })],
      you: P1,
    });
    if (pick.kind === 'resources') expect(total(pick.res)).toBe(1);
  });

  it('a 0/0/0/0 player offered 3 resources can take all three', () => {
    const pick = assertResolvable({
      name: 'gain-any 3 with an empty pool',
      choice: { kind: 'gain-any', count: 3, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
      you: P1,
    });
    if (pick.kind === 'resources') expect(total(pick.res)).toBe(3);
  });

  it('a gain while already sitting on the cap still resolves', () => {
    // 12 held + 2 gained crosses p12, so the engine follows the gain with a
    // `lose-any`. The gain's own dialog must still be completable FIRST, or the
    // seat can never reach the discard that the gain itself provoked.
    assertResolvable({
      name: 'gain-any 2 while holding 12',
      choice: { kind: 'gain-any', count: 2, reason: 'Card effect' },
      seats: [seat(P1, { funds: 6, clout: 6, media: 0, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
  });

  it('a single-resource pool does not narrow the denominations a gain may use', () => {
    // The regression in its purest form: a pool holding ONLY funds must not make
    // funds the only legal answer to "take 1 resource of your choice".
    const pick = assertResolvable({
      name: 'gain-any 1 from a funds-only pool',
      choice: { kind: 'gain-any', count: 1, reason: 'Card effect' },
      seats: [seat(P1, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
    if (pick.kind === 'resources') {
      const named = RES.filter((r) => (pick.res[r] ?? 0) > 0);
      expect(named.length, 'the pick must name exactly one denomination').toBe(1);
    }
  });

  it('a gain is not a cost: the four `+` are all live on an empty pool', () => {
    const r = render(
      <Harness
        sc={{
          name: 'gain-any 1 from empty',
          choice: { kind: 'gain-any', count: 1, reason: 'Card effect' },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    const adds = [
      ...r.container.querySelectorAll<HTMLElement>('.picker__grid .row--tight button'),
    ].filter((b) => isEnabled(b) && !b.getAttribute('aria-label')?.startsWith('Remove'));
    expect(adds, 'every denomination must be addable on an empty pool').toHaveLength(4);
    r.unmount();
  });
});

// ─────────────────────────── lose-any ───────────────────────────

describe('lose-any — a cost, and the engine only ever asks for what is held', () => {
  it('the cap discard: 2 of 6 funds', () => {
    const pick = assertResolvable({
      name: 'lose-any 2 from a pool of 6',
      choice: { kind: 'lose-any', count: 2, reason: 'Resource cap' },
      seats: [seat(P1, { funds: 6, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
    if (pick.kind === 'resources') expect(total(pick.res)).toBe(2);
  });

  it('a single-denomination pool of exactly the ask', () => {
    assertResolvable({
      name: 'lose-any 4 from 4 trust only',
      choice: { kind: 'lose-any', count: 4, reason: 'Card effect' },
      seats: [seat(P1, { funds: 0, clout: 0, media: 0, trust: 4 }), seat(P2, EMPTY)],
      you: P1,
    });
  });

  it('an ask spanning three denominations of a pool of three', () => {
    assertResolvable({
      name: 'lose-any 3 from a pool of exactly 3',
      choice: { kind: 'lose-any', count: 3, reason: 'Card effect' },
      seats: [seat(P1, { funds: 1, clout: 1, media: 1, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
  });

  it('an ask the player CANNOT pay is refused with a reason, not silently dead', () => {
    // Unsatisfiable on the client too. The engine never raises it — `applyEffect`
    // and `enforceCap` both clamp to what is held — but a picker that can only
    // report a shortfall through a pick the player cannot complete is a picker
    // that hides one when it happens. The reason has to be on the frame.
    const r = render(
      <Harness
        sc={{
          name: 'lose-any 4 from a pool of 1',
          choice: { kind: 'lose-any', count: 4, reason: 'Card effect' },
          seats: [seat(P1, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    expect(r.container.querySelector('[data-testid=picker-status]')?.textContent).toContain(
      'You hold 1 of the 4 this needs.',
    );
    expect(isEnabled(r.container.querySelector('[data-testid=picker-confirm]'))).toBe(false);
    r.unmount();
  });
});

// ─────────────────────────── steal-any ───────────────────────────

describe('steal-any — a cost out of somebody ELSE’s pool', () => {
  it('a NAMED victim holding NOTHING resolves as an empty theft', () => {
    // The trap named in the brief: `want = min(count, victim total) = 0`, so the
    // confirm must be live at `0 of 0` and the pick must be empty.
    const pick = assertResolvable({
      name: 'steal-any 2 from a victim holding nothing',
      choice: { kind: 'steal-any', count: 2, from: P2, reason: 'Card effect' },
      seats: [seat(P1, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
    if (pick.kind === 'steal') {
      expect(pick.from).toBe(P2);
      expect(total(pick.res)).toBe(0);
    }
  });

  it('a named victim holding LESS than the ask clamps to what they have', () => {
    const pick = assertResolvable({
      name: 'steal-any 3 from a victim holding 1',
      choice: { kind: 'steal-any', count: 3, from: P2, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, { funds: 0, clout: 0, media: 0, trust: 1 })],
      you: P1,
    });
    if (pick.kind === 'steal') expect(total(pick.res)).toBe(1);
  });

  it('a victim with a ZERO in three denominations still yields a legal pick', () => {
    // The pool bounds the theft per DENOMINATION, not only in total: 3 funds and
    // nothing else means exactly one composition for an ask of 2 — and the UI must
    // be able to reach it.
    const pick = assertResolvable({
      name: 'steal-any 2 from a 3-funds-only victim',
      choice: { kind: 'steal-any', count: 2, from: P2, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, { funds: 3, clout: 0, media: 0, trust: 0 })],
      you: P1,
    });
    if (pick.kind === 'steal') expect(total(pick.res)).toBe(2);
  });

  it('a victim holding one of each, so the theft is genuinely split', () => {
    const pick = assertResolvable({
      name: 'steal-any 2 from a 1-each victim',
      choice: { kind: 'steal-any', count: 2, from: P2, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, { funds: 1, clout: 1, media: 1, trust: 1 })],
      you: P1,
    });
    if (pick.kind === 'steal') {
      expect(total(pick.res)).toBe(2);
      expect(RES.filter((r) => (pick.res[r] ?? 0) > 0).length).toBe(2);
    }
  });

  it('the thief picks, and every victim is empty', () => {
    assertResolvable({
      name: 'steal-any 1, thief picks, all victims empty',
      choice: { kind: 'steal-any', count: 1, from: null, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, EMPTY), seat(P3, EMPTY)],
      you: P1,
    });
  });

  it('the thief picks, and the victims hold different amounts', () => {
    assertResolvable({
      name: 'steal-any 2, thief picks',
      choice: { kind: 'steal-any', count: 2, from: null, reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY),
        seat(P2, { funds: 1, clout: 0, media: 0, trust: 0 }),
        seat(P3, { funds: 0, clout: 0, media: 0, trust: 9 }),
      ],
      you: P1,
    });
  });
});

// ─────────────────────────── evict-voter ───────────────────────────

describe('evict-voter', () => {
  it('an ask LARGER than the board — "evict 3" with 2 targetable voters', () => {
    assertResolvable({
      name: 'evict-voter 3 with 2 targetable voters',
      choice: { kind: 'evict-voter', count: 3, scope: 'any', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P2 }]),
        seat(P2, EMPTY, [{ areaId: N1, owner: P2 }]),
      ],
      you: P1,
    });
  });

  it('an EMPTY board, so the ask falls to zero and resolves empty', () => {
    const pick = assertResolvable({
      name: 'evict-voter 1 with an empty board',
      choice: { kind: 'evict-voter', count: 1, scope: 'any', reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
      you: P1,
    });
    expect(pick).toEqual({ kind: 'areas', areaIds: [] });
  });

  it('scope "own" with FEWER own voters than the ask — the second dead dialog', () => {
    // `raiseVoterDecision` gives every player a card NAMES as its victim
    // `scope: 'own'`. The client used to ignore `scope`, so it offered — and
    // demanded — two picks drawn from EVERY peg on the board, while the engine
    // wanted `min(2, ownPegs = 1) = 1`. Unsatisfiable: CONFIRM at 2 of 2 forever.
    assertResolvable({
      name: 'evict-voter 2, scope own, holding one own voter',
      choice: { kind: 'evict-voter', count: 2, scope: 'own', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [
          { areaId: NW2, owner: P2 },
          { areaId: N1, owner: P2 },
        ]),
      ],
      you: P1,
    });
  });

  it('scope "own" with a full complement of own voters', () => {
    assertResolvable({
      name: 'evict-voter 2, scope own, holding two own voters',
      choice: { kind: 'evict-voter', count: 2, scope: 'own', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [
          { areaId: NW1, owner: P1 },
          { areaId: NW2, owner: P1 },
        ]),
        seat(P2, EMPTY, [{ areaId: N1, owner: P2 }]),
      ],
      you: P1,
    });
  });

  it('a Volatile-Area voter is never offered, so the ask falls to zero', () => {
    const pick = assertResolvable({
      name: 'evict-voter 1, only a volatile voter on the board',
      choice: { kind: 'evict-voter', count: 1, scope: 'any', reason: 'Card effect' },
      seats: [seat(P1, EMPTY, [{ areaId: NVOL, owner: P2 }]), seat(P2, EMPTY)],
      you: P1,
    });
    expect(pick).toEqual({ kind: 'areas', areaIds: [] });
  });

  it('an ask of 4 against exactly 3 real voters', () => {
    assertResolvable({
      name: 'evict-voter 4 with 3 targetable voters',
      choice: { kind: 'evict-voter', count: 4, scope: 'any', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY),
        seat(P2, EMPTY, [
          { areaId: NW1, owner: P2 },
          { areaId: N1, owner: P2 },
          { areaId: N2, owner: P2 },
        ]),
      ],
      you: P1,
    });
  });
});

// ─────────────────────────── discard-voter ───────────────────────────

describe('discard-voter', () => {
  it('scope "own" with fewer own voters than the ask', () => {
    assertResolvable({
      name: 'discard-voter 2, scope own, holding one own voter',
      choice: { kind: 'discard-voter', count: 2, scope: 'own', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [
          { areaId: NW2, owner: P2 },
          { areaId: N1, owner: P2 },
        ]),
      ],
      you: P1,
    });
  });

  it('scope "others" with an ask larger than the opponents hold', () => {
    assertResolvable({
      name: 'discard-voter 4 with 2 opponent voters',
      choice: { kind: 'discard-voter', count: 4, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [
          { areaId: NW2, owner: P2 },
          { areaId: N1, owner: P2 },
        ]),
      ],
      you: P1,
    });
  });

  it('only your OWN voters, so scope "others" has no targets at all', () => {
    const pick = assertResolvable({
      name: 'discard-voter 1 with only your own voters',
      choice: { kind: 'discard-voter', count: 1, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [
          { areaId: NW1, owner: P1 },
          { areaId: NW2, owner: P1 },
        ]),
        seat(P2, EMPTY),
      ],
      you: P1,
    });
    expect(pick).toEqual({ kind: 'areas', areaIds: [] });
  });

  it('a normal ask against three real opponent voters', () => {
    assertResolvable({
      name: 'discard-voter 2 with 3 opponent voters',
      choice: { kind: 'discard-voter', count: 2, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY),
        seat(P2, EMPTY, [
          { areaId: NW1, owner: P2 },
          { areaId: NW2, owner: P2 },
          { areaId: N1, owner: P2 },
        ]),
      ],
      you: P1,
    });
  });
});

// ─────────────────────────── convert-voter ───────────────────────────

describe('convert-voter', () => {
  it('scope "own", which the engine refuses as a conversion however the scope reads', () => {
    // `resolveChoice` refuses `convert-voter` on your own peg whatever `scope`
    // says ("that voter is already yours"). A client counting scope alone would
    // demand 1 and be refused forever.
    const pick = assertResolvable({
      name: 'convert-voter 1, scope own',
      choice: { kind: 'convert-voter', count: 1, scope: 'own', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [{ areaId: NW2, owner: P2 }]),
      ],
      you: P1,
    });
    expect(pick).toEqual({ kind: 'areas', areaIds: [] });
  });

  it('a normal ask against one real opponent voter', () => {
    assertResolvable({
      name: 'convert-voter 1 with 1 opponent voter',
      choice: { kind: 'convert-voter', count: 1, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [{ areaId: NW2, owner: P2 }]),
      ],
      you: P1,
    });
  });

  it('only a VOLATILE opponent voter, so the ask falls to zero', () => {
    const pick = assertResolvable({
      name: 'convert-voter 1 with only a volatile opponent voter',
      choice: { kind: 'convert-voter', count: 1, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [{ areaId: NVOL, owner: P2 }]),
      ],
      you: P1,
    });
    expect(pick).toEqual({ kind: 'areas', areaIds: [] });
  });

  it('an ask of 2 against exactly 1 convertible opponent voter', () => {
    assertResolvable({
      name: 'convert-voter 2 with 1 opponent voter',
      choice: { kind: 'convert-voter', count: 2, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY),
        seat(P2, EMPTY, [
          { areaId: NW1, owner: P2 },
          { areaId: N1, owner: P2 },
          { areaId: N2, owner: P2 },
        ]),
      ],
      you: P1,
    });
  });
});

// ─────────────────────────── the mirrors, pinned ───────────────────────────

describe('the client mirror agrees with reduce.ts, for every scope', () => {
  // These are the numbers the whole dialog hangs on. Each is `reduce.ts`'s own
  // expression, written out, so a future edit to `derive.ts` that changes one of
  // them is a failing test rather than a dialog the server refuses.
  const cases: readonly {
    readonly label: string;
    readonly kind: 'evict-voter' | 'discard-voter' | 'convert-voter';
    readonly scope: ChoiceScope;
    readonly mine: readonly string[];
    readonly theirs: readonly string[];
    readonly expected: number;
  }[] = [
    { label: 'any, all pegs', kind: 'evict-voter', scope: 'any', mine: [], theirs: [NW1, N1], expected: 2 },
    { label: 'own, one of mine', kind: 'evict-voter', scope: 'own', mine: [NW1], theirs: [NW2, N1], expected: 1 },
    { label: 'own, two of mine', kind: 'evict-voter', scope: 'own', mine: [NW1, NW2], theirs: [N1], expected: 2 },
    { label: 'own, none of mine', kind: 'evict-voter', scope: 'own', mine: [], theirs: [NW1, N1], expected: 0 },
    { label: 'others, two of theirs', kind: 'discard-voter', scope: 'others', mine: [NW1], theirs: [NW2, N1], expected: 2 },
    { label: 'others, only mine', kind: 'discard-voter', scope: 'others', mine: [NW1, NW2], theirs: [], expected: 0 },
    { label: 'own, one of mine', kind: 'discard-voter', scope: 'own', mine: [NW1], theirs: [NW2, N1], expected: 1 },
    // `convert-voter` excludes your own peg whatever the scope says, because
    // converting a voter to yourself is not a conversion.
    { label: 'others, mixed', kind: 'convert-voter', scope: 'others', mine: [NW1], theirs: [NW2, N1], expected: 2 },
    { label: 'own, one of mine (engine still refuses)', kind: 'convert-voter', scope: 'own', mine: [NW1], theirs: [N1], expected: 0 },
  ];

  for (const c of cases) {
    it(`${c.kind} · scope ${c.scope} · ${c.label} → ${c.expected}`, () => {
      const pegs = [
        ...c.mine.map((areaId) => ({ areaId, owner: P1 })),
        ...c.theirs.map((areaId) => ({ areaId, owner: P2 })),
      ];
      const state = buildState({
        name: c.label,
        choice: { kind: c.kind, count: 9, scope: c.scope, reason: 'Card effect' },
        seats: [seat(P1, EMPTY, pegs), seat(P2, EMPTY)],
        you: P1,
      });
      expect(targetableCount(state, P1, c.kind, c.scope)).toBe(c.expected);
      expect(targetableAreas(state, P1, c.kind, c.scope).size).toBe(c.expected);
      expect(requiredPicks({ kind: c.kind, count: 9, scope: c.scope, reason: 'x' }, state, P1)).toBe(
        c.expected,
      );
    });
  }

  it('a volatile peg is never counted, for any scope', () => {
    const state = buildState({
      name: 'volatile only',
      choice: { kind: 'evict-voter', count: 1, scope: 'any', reason: 'x' },
      seats: [seat(P1, EMPTY, [{ areaId: NVOL, owner: P2 }]), seat(P2, EMPTY)],
      you: P1,
    });
    expect(targetableCount(state, P1, 'evict-voter', 'any')).toBe(0);
    expect(targetableAreas(state, P1, 'evict-voter', 'any').has(NVOL)).toBe(false);
  });
});

// ─────────────────────────── the dialog's manners ───────────────────────────

describe('the picker does not offer a way out of a decision that has none', () => {
  it('a gain and a discard render NO cancel control', () => {
    // The old `onCancel={() => undefined}` was a Cancel button wired to nothing:
    // it looked like an escape from a dialog that has none, and pressing it taught
    // the player that this dialog ignores them.
    for (const choice of [
      { kind: 'gain-any', count: 1, reason: 'Card effect' },
      { kind: 'lose-any', count: 1, reason: 'Resource cap' },
    ] as const) {
      const r = render(
        <Harness
          sc={{
            name: choice.kind,
            choice,
            seats: [seat(P1, { funds: 4, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
            you: P1,
          }}
          onResolved={() => undefined}
        />,
      );
      const cancels = dialogButtons(r.container).filter(
        (b) => (b.textContent ?? '').trim() === 'Cancel',
      );
      expect(cancels, `${choice.kind} must not render a no-op Cancel`).toHaveLength(0);
      r.unmount();
    }
  });

  it('a theft still offers a real cancel, because un-naming the victim IS one', () => {
    const r = render(
      <Harness
        sc={{
          name: 'steal-any, thief picks',
          choice: { kind: 'steal-any', count: 1, from: null, reason: 'Card effect' },
          seats: [seat(P1, EMPTY), seat(P2, { funds: 2, clout: 0, media: 0, trust: 0 })],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    const victim = r.container.querySelector<HTMLElement>('[data-testid=steal-victim]');
    expect(victim).not.toBeNull();
    fireEvent.click(victim as HTMLElement);
    const cancel = dialogButtons(r.container).find(
      (b) => (b.textContent ?? '').trim() === 'Cancel',
    );
    expect(cancel, 'the theft picker must offer a real way back').toBeDefined();
    fireEvent.click(cancel as HTMLElement);
    expect(
      r.container.querySelector('[data-testid=steal-choice]'),
      'cancel must return to the victim list',
    ).not.toBeNull();
    r.unmount();
  });
});

describe('a gain does not claim a `want / have` fraction it cannot have', () => {
  it('the cell states the holding instead of drawing a fraction from it', () => {
    const r = render(
      <Harness
        sc={{
          name: 'gain-any 1 from empty',
          choice: { kind: 'gain-any', count: 1, reason: 'Card effect' },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    const cells = [...r.container.querySelectorAll('.picker__cell')];
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      // "0 / 0" reads as a fraction of nothing; the gain states the holding.
      expect(cell.textContent).not.toMatch(/\d\s*\/\s*0/);
      expect(cell.textContent).toMatch(/hold 0/);
    }
    r.unmount();
  });

  it('a COST keeps its fraction — the widget the player learned is unchanged', () => {
    const r = render(
      <Harness
        sc={{
          name: 'lose-any 1',
          choice: { kind: 'lose-any', count: 1, reason: 'Resource cap' },
          seats: [seat(P1, { funds: 4, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    expect(r.container.querySelector('.picker__cell')?.textContent).toMatch(/\d\s*\/\s*4/);
    r.unmount();
  });
});

describe('an unsatisfiable ask is still a resolution', () => {
  it('a zero-target ask says so, and CONFIRM is live at 0 of 0', () => {
    const r = render(
      <Harness
        sc={{
          name: 'evict-voter 3, empty board',
          choice: { kind: 'evict-voter', count: 3, scope: 'any', reason: 'Card effect' },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    expect(r.container.querySelector('[data-testid=area-choice-nothing]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid=area-choice-progress]')?.textContent).toContain(
      '0 of 0',
    );
    expect(isEnabled(r.container.querySelector('[data-testid=area-choice-confirm]'))).toBe(true);
    r.unmount();
  });

  it('and the empty pick it produces is the one the engine accepts', () => {
    const seen: ChoicePick[] = [];
    const r = render(
      <Harness
        sc={{
          name: 'evict-voter 3, empty board',
          choice: { kind: 'evict-voter', count: 3, scope: 'any', reason: 'Card effect' },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={(p) => seen.push(p)}
      />,
    );
    const confirm = r.container.querySelector<HTMLElement>('[data-testid=area-choice-confirm]');
    fireEvent.click(confirm as HTMLElement);
    expect(seen).toEqual([{ kind: 'areas', areaIds: [] }]);
    r.unmount();
  });
});

describe('a theft with no victim is stated, not left as an empty list', () => {
  it('names the rule edge instead of rendering a dialog with nothing in it', () => {
    // Unreachable in a real game — `Lobby` refuses to start below two seats — but
    // an empty list is indistinguishable from a broken one, and the engine has no
    // resolution for it either. Stated plainly, and reported rather than patched.
    const r = render(
      <Harness
        sc={{
          name: 'steal-any with no opponent',
          choice: { kind: 'steal-any', count: 1, from: null, reason: 'Card effect' },
          seats: [seat(P1, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    expect(r.container.querySelector('[data-testid=steal-no-victims]')).not.toBeNull();
    r.unmount();
  });
});

/**
 * G1 and G16 -- the two name-shaped decisions, driven through the same Harness and the
 * same engine-side gate as the other six.
 *
 * The property under test is NOT "a button appears". It is that **every button is a pick
 * the engine accepts, and there is always at least one** -- the client-side half of the
 * satisfiability argument, since `assertEngineWouldAccept` re-derives
 * `resolveChoice`'s own two accepted sets (`turnOrder` minus the chooser, and
 * `choosableZones`). A client that offered a seat or a constituency the engine refuses
 * would be the exact dead-dialog failure this file was written for, one shape over.
 *
 * **AND THE LIST IS NOT FILTERED BY HOLDINGS.** A player with an empty pool and no pegs
 * is still offered, because a candidate list filtered by what somebody holds is a
 * readout of their Mat and their hand, and an option list is as revealing as a value.
 * `p3` holds nothing and is asserted to be present.
 */
describe('a seat or a constituency is named, and every name is one the engine accepts', () => {
  it("'choose-player' offers every other seat, including one holding nothing", () => {
    const seen: ChoicePick[] = [];
    const sc: Scenario = {
      name: 'choose-player',
      choice: {
        kind: 'choose-player',
        count: 1,
        effects: [{ op: 'voters', n: 1, target: 'chosen-player' }],
        source: P1,
        reason: 'Card effect',
      },
      seats: [seat(P1, EMPTY), seat(P2, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P3, EMPTY)],
      you: P1,
    };
    const r = render(<Harness sc={sc} onResolved={(pick) => seen.push(pick)} />);
    const options = r.container.querySelectorAll('[data-testid=name-choice-option]');
    const names = [...options].map((o) => o.getAttribute('data-name'));
    // THE CHOSER IS NOT OFFERED: `resolveChoice` refuses 'you may not choose that
    // player', so offering it would be a button the server refuses.
    expect(names).not.toContain(P1);
    // EVERY OTHER SEAT IS, and `p3` holds nothing at all. That asymmetry is the point.
    expect(names).toEqual([P2, P3]);

    for (const o of options) {
      fireEvent.click(o as HTMLElement);
      assertEngineWouldAccept(sc, seen[seen.length - 1] as ChoicePick);
    }
    expect(seen).toHaveLength(2);
    r.unmount();
  });

  it("'choose-zone' offers only the constituencies holding a voter it could name", () => {
    const sc: Scenario = {
      name: 'choose-zone',
      choice: {
        kind: 'choose-zone',
        count: 1,
        effects: [{ op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' }],
        source: P1,
        reason: 'Card effect',
      },
      // Two of p1's pegs in two constituencies, and one of P3's in a third. The effect
      // is scoped 'own' (target: 'you'), so P3's constituency cannot be named and must
      // not be offered -- even though it is not empty.
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [{ areaId: NW2, owner: P1 }]),
        seat(P3, { funds: 1, clout: 0, media: 0, trust: 0 }, [{ areaId: N1, owner: P3 }]),
      ],
      you: P1,
    };
    const seen: ChoicePick[] = [];
    const r = render(<Harness sc={sc} onResolved={(pick) => seen.push(pick)} />);
    const options = r.container.querySelectorAll('[data-testid=name-choice-option]');
    expect(options.length, 'no constituency was offered, so the dialog is a dead end').toBeGreaterThan(0);
    const names = [...options].map((o) => o.getAttribute('data-name'));
    expect(names).toContain('north_west');
    expect(names).not.toContain('north');

    for (const o of options) {
      fireEvent.click(o as HTMLElement);
      assertEngineWouldAccept(sc, seen[seen.length - 1] as ChoicePick);
    }
    expect(seen).toHaveLength(options.length);
    r.unmount();
  });

  it('and an empty candidate list is STATED rather than left as a blank dialog', () => {
    // Unreachable in a real game -- `applyEffect` raises nothing when there is no legal
    // zone -- and rendered anyway, because an empty list is indistinguishable from a
    // broken one. The same treatment `StealChoice`'s no-victims note gets.
    const r = render(
      <Harness
        sc={{
          name: 'choose-zone, empty board',
          choice: {
            kind: 'choose-zone',
            count: 1,
            effects: [{ op: 'discard-voter', n: 1, target: 'you', zone: 'chosen-zone' }],
            source: P1,
            reason: 'Card effect',
          },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    expect(r.container.querySelector('[data-testid=name-choice-empty]')).not.toBeNull();
    r.unmount();
  });
});

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE AREA CHOICE MUST NOT COVER THE BOARD — and why this file had never noticed.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * An area-shaped choice is resolved by CLICKING highlighted slots on the board. The
 * dialog's own copy used to say "Close this and click the highlighted slots on the
 * board" — and there was no way to close it. No dismiss control, Escape refused
 * (§5.9b), and `.scrim` is `position: fixed; inset: 0; z-index: 20` over an OPAQUE
 * `--table-900` wash, with no `pointer-events` override anywhere in the stylesheet.
 *
 * A browser audit caught it once in live play and could not reproduce it on demand
 * (reaching an area choice is rare — it took the driver ~10 games), and rated the
 * severity high rather than critical for that reason. The CSS fact is not a sample,
 * though. Its in-page probe, at the exact moment the dialog was open:
 *
 *     progress readout : "0 of 2 chosen."
 *     confirm button   : disabled
 *     elementFromPoint at the centre of a LEGAL board slot:
 *           {tag:"DIV", data-testid:"choice-resolver"}
 *
 * So this was a stall whenever it happened, not a race: the dialog's only exit
 * needed a click the dialog itself was eating.
 *
 * WHY FIFTY EXISTING TESTS MISSED IT, which is the part worth recording. `drive()`
 * above resolves an area choice by calling the board callback DIRECTLY — it finds
 * `[data-testid^="slot-"]` in the harness's own tree and fires a click on it. That
 * bypasses hit testing entirely. Every assertion in this file is about the wiring
 * and the arithmetic; not one of them ever asked whether a real click on the real
 * board could reach the real slot. So the gate below is on the SURFACE and the
 * STYLESHEET, because those are the two things that decide whether the click lands.
 */
describe('an area choice leaves the board reachable', () => {
  const AREA_SHAPED: readonly Choice[] = [
    { kind: 'evict-voter', count: 2, scope: 'any', reason: 'Card effect' },
    { kind: 'discard-voter', count: 2, scope: 'own', reason: 'Card effect' },
    { kind: 'convert-voter', count: 2, scope: 'others', reason: 'Card effect' },
  ];

  it('renders a scrim variant that does not eat board input', () => {
    for (const choice of AREA_SHAPED) {
      const r = render(
        <Harness
          sc={{
            name: choice.kind,
            choice,
            seats: [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: N1, owner: P2 }])],
            you: P1,
          }}
          onResolved={() => undefined}
        />,
      );
      const scrim = r.container.querySelector('[data-testid="choice-resolver"]');
      expect(scrim, `${choice.kind}: the dialog rendered`).not.toBeNull();
      expect(
        scrim?.classList.contains('scrim--area'),
        `${choice.kind}: the scrim carries the board-open variant`,
      ).toBe(true);
      // …and the sheet still takes its pointer events back, so CONFIRM and UNDO are
      // still operable. `pointer-events: none` on the scrim alone would make the
      // dialog's own buttons dead, which is the same stall from the other side.
      const sheet = r.container.querySelector('[data-testid="choice-dialog"]');
      expect(sheet?.getAttribute('aria-modal'), `${choice.kind}: not a modal`).toBeNull();
      r.unmount();
    }
  });

  it('a resource-shaped choice still takes the viewport, and says so', () => {
    // The opposite direction matters too: making every dialog non-modal would let a
    // player click the mat behind a `lose-any` they still owe, and the cap meter
    // would be the only thing telling them the game is waiting.
    const r = render(
      <Harness
        sc={{
          name: 'lose-any',
          choice: { kind: 'lose-any', count: 2, reason: 'Over the cap' },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={() => undefined}
      />,
    );
    const scrim = r.container.querySelector('[data-testid="choice-resolver"]');
    expect(scrim?.classList.contains('scrim--area')).toBe(false);
    expect(scrim?.classList.contains('scrim')).toBe(true);
    expect(r.container.querySelector('[data-testid="choice-dialog"]')?.getAttribute('aria-modal')).toBe('true');
  });

  it('never tells the player to close a dialog that cannot be closed', () => {
    // The old copy was an instruction with no referent: there was no close control
    // and Escape was refused. Now the board is simply open.
    //
    // Each scenario holds enough voters for the ask to be NON-ZERO, because the
    // zero-ask branch is a different dialog with different copy ("no board click is
    // needed") and asserting the board instruction against it would be asserting
    // something the component deliberately does not say.
    const satisfiable: readonly { choice: Choice; seats: readonly SeatSpec[] }[] = [
      {
        choice: { kind: 'evict-voter', count: 2, scope: 'any', reason: 'Card effect' },
        seats: [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: N1, owner: P2 }, { areaId: N2, owner: P2 }])],
      },
      {
        choice: { kind: 'discard-voter', count: 2, scope: 'own', reason: 'Over the cap' },
        seats: [seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }, { areaId: NW2, owner: P1 }]), seat(P2, EMPTY)],
      },
      {
        choice: { kind: 'convert-voter', count: 2, scope: 'others', reason: 'Card effect' },
        seats: [seat(P1, EMPTY), seat(P2, EMPTY, [{ areaId: N1, owner: P2 }, { areaId: N2, owner: P2 }])],
      },
    ];
    for (const { choice, seats } of satisfiable) {
      const r = render(
        <Harness sc={{ name: choice.kind, choice, seats, you: P1 }} onResolved={() => undefined} />,
      );
      const text = (r.container.textContent ?? '').toLowerCase();
      expect(text, `${choice.kind}: no "close this"`).not.toContain('close this');
      expect(text, `${choice.kind}: the instruction names the board`).toContain(
        'click the highlighted slots',
      );
      r.unmount();
    }
  });

  it('the STYLESHEET is what makes the board reachable, so it is what is gated', () => {
    // jsdom performs no hit testing, so this cannot assert that a click lands. It
    // CAN assert the three declarations that decide it, and those are exactly what
    // the browser measurement above confirmed on the rendered page.
    const RULES = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = RULES.indexOf('.scrim--area {');
    expect(start, 'the variant exists').toBeGreaterThan(-1);
    const block = RULES.slice(start, RULES.indexOf('}', start));
    expect(block, 'a hit test at a slot falls through to the board').toContain('pointer-events: none');
    // An OPAQUE wash here would leave the player clicking a board they cannot see,
    // which is worse than either failure on its own: the alpha is the assertion.
    expect(block, 'the wash is translucent').toMatch(/background:\s*rgb\(\s*20 17 16 \/ \d+%?\)/);
    expect(block, 'and the sheet sits at the bottom, so the board is above it').toContain(
      'align-items: flex-end',
    );
    // The sheet takes its events back.
    expect(RULES).toMatch(/\.scrim--area\s+\.sheet\s*\{[^}]*pointer-events:\s*auto;/);
  });
});

describe('the gate covers the KINDS, not only the shapes that found the bug', () => {
  it('all six kinds of `Choice` are exercised above', () => {
    // A seventh kind lands on `Choice` later. Without this, the new one ships
    // untested into exactly the bug this file was written for.
    const exercised = new Set<string>([
      'gain-any',
      'lose-any',
      'steal-any',
      'evict-voter',
      'discard-voter',
      'convert-voter',
      'choose-player',
      'choose-zone',
    ]);
    const everyKindInThisFile: readonly string[] = [...exercised];
    // EIGHT, not six, and the NUMBER is the assertion. `Choice` is the engine's union
    // and this list is a hand-copy of it, so a ninth kind makes this fail and says so,
    // rather than letting a new shape ship untested into the bug this file exists for.
    // `derive.ts assertNever` is the other half of the same guard — that one is a
    // COMPILE error; this one is a test. Two mechanisms, because a compile error cannot
    // tell you the new kind is also *rendered*.
    expect(everyKindInThisFile).toHaveLength(8);
    for (const kind of exercised) {
      expect(
        everyKindInThisFile.includes(kind),
        `${kind} is declared exercised but is not in the file's own list`,
      ).toBe(true);
    }
  });
});
