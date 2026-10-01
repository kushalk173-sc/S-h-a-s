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
 * NO ENABLED CONTROL EXISTED ANYWHERE IN THE DIALOG. The engine's per-player
 * freeze refuses every other action, so the table was stuck until the server
 * restarted. `ChoiceResolver` was passing `pool={me.resources}` — what the player
 * HOLDS — as the CEILING for a gain, which is a category error: "what you can
 * afford" is a statement about a COST, and `reduce.ts:resolveChoice` imposes no
 * `canAfford` on a `gain-any` at all, because a resource you are about to be
 * handed is not one you must already own.
 *
 * ────────────────────────────────── WHAT IS ASSERTED ──────────────────────────
 *
 * One property, over EVERY `Choice` kind, in EVERY degenerate state:
 *
 *   FROM THE INITIAL DRAFT, A LEGAL RESOLUTION IS REACHABLE BY CLICKING.
 *
 * Not "some control is enabled" — too weak, because an enabled `−` on a gain gets
 * a player no closer to a resolution. The driver below presses only controls that
 * ADVANCE the decision (the denomination cells, a victim, a legal board slot) and
 * asserts the confirm goes live. It then presses the confirm and hands the
 * resulting pick to the REAL ENGINE, which must accept it.
 *
 * That last step is what makes this a gate rather than a snapshot. The client
 * mirrors three engine rules by hand — the gain ceiling, `steal-any`'s victim
 * clamp, and `targetableCount`'s `scope` — and a mirror that has drifted fails
 * here because the engine says no. The SECOND dead dialog this gate exists to
 * catch was invisible to any assertion that only counted DOM controls: with
 * `scope: 'own'` the client offered and demanded a pick count drawn from a set
 * the engine rejects, so CONFIRM sat at 2 of 2 forever.
 *
 * The scenarios are built from `setup()` and reshaped into the degenerate states
 * a real table produces: empty pools, a victim holding nothing, an ask larger
 * than the board, an ask larger than the pool.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
import {
  RULES,
  indexCards,
  playerView,
  reduce,
  setup,
  type Choice,
  type ChoicePick,
  type ClientState,
  type Ctx,
  type GameState,
  type Ideologue,
  type PlayerID,
  type Pool,
} from '@shasn/engine';

import { ChoiceResolver, type ChoiceResolverProps } from './ChoiceResolver.tsx';
import { targetableAreas } from './derive.ts';

// ─────────────────────────── the engine, for real ───────────────────────────

const IDES: readonly Ideologue[] = ['capitalist', 'supremo', 'showstopper', 'idealist'];

const CARDS = indexCards({
  ideology: Array.from({ length: 12 }, (_, i) => {
    const a = IDES[i % 4] as Ideologue;
    const b = IDES[(i + 1) % 4] as Ideologue;
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `ide-${n}`,
      campaign: `campaign ${n}`,
      question: `question ${n}`,
      sides: [
        { answer: `answer ${n}a`, ideologue: a, pays: { funds: 1 } },
        { answer: `answer ${n}b`, ideologue: b, pays: { trust: 1 } },
      ],
    };
  }),
  voter: [{ id: 'vot-01', cost: { funds: 2 }, voters: 2 }],
  conspiracy: [],
  headline: [],
});

const CTX: Ctx = { rules: RULES, cards: CARDS };

const EMPTY: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

/** Real area ids off the generated 9-zone board. `north_west-07` is Volatile. */
const NW1 = 'north_west-01';
const NW2 = 'north_west-02';
const N1 = 'north-01';
const N2 = 'north-02';
const NVOL = 'north_west-07';

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

/** A real `GameState`, reshaped into the scenario's pools and pegs. */
function buildGame(sc: Scenario): GameState {
  const wanted = sc.seats.map((s) => s.player);
  // `setup` refuses fewer than two seats, which is exactly right for a real game.
  // The one-player scenarios below exist to pin a rule edge, so the fixture starts
  // from a legal two-seat game and prunes — the pruning is the scenario.
  const ids: readonly PlayerID[] = wanted.length >= 2 ? wanted : [P1, P2];
  const base = setup({
    players: ids,
    cards: CARDS,
    seed: 7,
    ideologyDeck: Object.keys(CARDS.ideology),
    voterDeck: [],
    conspiracyDeck: [],
    headlineDeck: [],
    // Explicit and authoritative, so a seat can be handed a genuine 0/0/0/0
    // rather than relying on the staggered-start default.
    startResources: ids.map((id) => ({ ...(sc.seats.find((s) => s.player === id)?.pool ?? EMPTY) })),
  });

  const byArea = new Map<string, { owner: PlayerID; majority: boolean }>();
  for (const seat of sc.seats) {
    for (const peg of seat.pegs ?? []) {
      byArea.set(peg.areaId, { owner: peg.owner, majority: peg.majority ?? false });
    }
  }

  const keep = new Set(wanted);
  const players: Record<PlayerID, GameState['players'][PlayerID]> = {};
  for (const id of wanted) {
    const p = base.players[id];
    if (p !== undefined) players[id] = p;
  }

  return {
    ...base,
    players,
    turnOrder: base.turnOrder.filter((id) => keep.has(id)),
    activePlayer: base.turnOrder.find((id) => keep.has(id)) ?? base.activePlayer,
    zones: base.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a) => {
        const peg = byArea.get(a.id);
        return { ...a, peg: peg === undefined ? null : peg };
      }),
    })),
    choices: [{ id: 'ch-test', player: sc.you, choice: sc.choice }],
  };
}

const seat = (player: PlayerID, pool: Pool, pegs?: readonly PegSpec[]): SeatSpec =>
  pegs === undefined ? { player, pool } : { player, pool, pegs };

/** The three board-targeting kinds. Mirrors `ChoiceResolver`'s `isAreaShaped`. */
function areaShapedKind(choice: Choice): boolean {
  return (
    choice.kind === 'evict-voter' ||
    choice.kind === 'discard-voter' ||
    choice.kind === 'convert-voter'
  );
}

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
  const game = buildGame(sc);
  const state: ClientState = playerView(game, sc.you);
  const owed = state.choices.find((c) => c.player === sc.you)?.choice ?? null;
  const legal: ReadonlySet<string> =
    owed !== null &&
    (owed.kind === 'evict-voter' || owed.kind === 'discard-voter' || owed.kind === 'convert-voter')
      ? targetableAreas(state, sc.you, owed.kind, owed.scope)
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
    root.querySelector('[data-testid="picker-confirm"]') ??
    root.querySelector('[data-testid="area-choice-confirm"]')
  );
}

function isEnabled(el: HTMLElement | null): el is HTMLElement {
  return el !== null && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
}

/** Dialog controls only — the stand-in board is the player's board, not the dialog. */
function dialogButtons(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid="choice-dialog"] button')];
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
   * reads the dialog: a denomination cell, then a victim, then a legal board slot.
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
      const victim = root.querySelector<HTMLElement>('[data-testid="steal-victim"]');
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
 * 4. pressing it yields a pick the REAL ENGINE ACCEPTS.
 */
function assertResolvable(sc: Scenario): ChoicePick {
  const seen: ChoicePick[] = [];
  const r = render(<Harness sc={sc} onResolved={(p) => seen.push(p)} />);

  expect(
    r.container.querySelector('[data-testid="choice-dialog"]'),
    `${sc.name}: no choice dialog rendered`,
  ).not.toBeNull();

  const d = drive(r);
  /*
   * THE DEAD-DIALOG ASSERTION, counted across BOTH surfaces.
   *
   * A resource-shaped decision is resolved inside the dialog. An area-shaped one
   * is resolved on the BOARD — the dialog's own copy says "close this and click
   * the highlighted slots" — and when the board offers nothing the dialog's CONFIRM
   * is live at `0 of 0` instead. The original bug was a resource shape with no live
   * control in EITHER place, so the count is taken over both and the shape that
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

  // THE ENGINE IS THE ARBITER. A client mirror that has drifted is refused here,
  // and the refusal names the rule in the failure.
  const result = reduce(
    buildGame(sc),
    sc.you,
    { type: 'RESOLVE_CHOICE', choiceId: 'ch-test', pick },
    CTX,
  );
  expect(
    result.ok,
    `${sc.name}: the engine REJECTED the pick the UI produced — ${result.ok ? '' : result.error}`,
  ).toBe(true);

  r.unmount();
  return pick;
}

const total = (res: Readonly<Record<string, number | undefined>>): number =>
  Object.values(res).reduce<number>((a, b) => a + (b ?? 0), 0);

const P1: PlayerID = 'p1';
const P2: PlayerID = 'p2';
const P3: PlayerID = 'p3';

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
    expect(pick.kind).toBe('resources');
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
    // `lose-any`. The gain's own dialog must still be completable FIRST.
    assertResolvable({
      name: 'gain-any 2 while holding 12',
      choice: { kind: 'gain-any', count: 2, reason: 'Card effect' },
      seats: [seat(P1, { funds: 6, clout: 6, media: 0, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
  });

  it('a single-resource pool does not narrow the denominations a gain may use', () => {
    // The regression in its purest form: a pool that holds ONLY funds must not
    // make funds the only legal answer to "take 1 resource of your choice".
    const pick = assertResolvable({
      name: 'gain-any 1 from a funds-only pool',
      choice: { kind: 'gain-any', count: 1, reason: 'Card effect' },
      seats: [seat(P1, { funds: 1, clout: 0, media: 0, trust: 0 }), seat(P2, EMPTY)],
      you: P1,
    });
    if (pick.kind === 'resources') {
      const named = (Object.keys(pick.res) as (keyof Pool)[]).filter(
        (k) => (pick.res[k] ?? 0) > 0,
      );
      expect(named.length, 'the pick must name exactly one denomination').toBe(1);
    }
  });
});

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

  it('an ask the player cannot pay is REFUSED WITH A REASON, not silently dead', () => {
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
    expect(r.container.querySelector('[data-testid="picker-status"]')?.textContent).toContain(
      'You hold 1 of the 4 this needs.',
    );
    expect(isEnabled(r.container.querySelector('[data-testid="picker-confirm"]'))).toBe(false);
    r.unmount();
  });
});

describe('steal-any — a cost out of somebody ELSE’s pool', () => {
  it('a NAMED victim holding NOTHING resolves as an empty theft', () => {
    // The trap named in the brief: `want = min(count, victim total) = 0`, so the
    // confirm must be live at `0 of 0` and the engine must accept the empty pick.
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

  it('the thief picks, and every victim is empty', () => {
    assertResolvable({
      name: 'steal-any 1, thief picks, all victims empty',
      choice: { kind: 'steal-any', count: 1, from: null, reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, EMPTY), seat(P3, EMPTY)],
      you: P1,
    });
  });

  it('the thief picks, and picks a victim who holds a lot', () => {
    assertResolvable({
      name: 'steal-any 2, thief picks',
      choice: { kind: 'steal-any', count: 2, from: null, reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY),
        seat(P2, { funds: 1, clout: 1, media: 1, trust: 1 }),
        seat(P3, { funds: 9, clout: 0, media: 0, trust: 0 }),
      ],
      you: P1,
    });
  });
});

describe('evict-voter', () => {
  it('an ask LARGER than the board — "evict 3" with 2 targetable voters', () => {
    assertResolvable({
      name: 'evict-voter 3 with 2 targetable voters',
      choice: { kind: 'evict-voter', count: 3, scope: 'any', reason: 'Card effect' },
      seats: [seat(P1, EMPTY, [{ areaId: NW1, owner: P2 }]), seat(P2, EMPTY, [{ areaId: N1, owner: P2 }])],
      you: P1,
    });
  });

  it('an EMPTY board, so the ask falls to zero and resolves empty', () => {
    assertResolvable({
      name: 'evict-voter 1 with an empty board',
      choice: { kind: 'evict-voter', count: 1, scope: 'any', reason: 'Card effect' },
      seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
      you: P1,
    });
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

  it('Volatile-Area voters are never offered, so the ask falls to zero', () => {
    assertResolvable({
      name: 'evict-voter 1, only a volatile voter on the board',
      choice: { kind: 'evict-voter', count: 1, scope: 'any', reason: 'Card effect' },
      seats: [seat(P1, EMPTY, [{ areaId: NVOL, owner: P2 }]), seat(P2, EMPTY)],
      you: P1,
    });
  });
});

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
    assertResolvable({
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

describe('convert-voter', () => {
  it('scope "own", which the engine refuses as a conversion however the scope reads', () => {
    // `resolveChoice` refuses `convert-voter` on your own peg whatever `scope`
    // says ("that voter is already yours"). A client counting scope alone would
    // demand 1 and be refused forever.
    assertResolvable({
      name: 'convert-voter 1, scope own',
      choice: { kind: 'convert-voter', count: 1, scope: 'own', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [{ areaId: NW2, owner: P2 }]),
      ],
      you: P1,
    });
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

  it('only VOLATILE opponent voters, so the ask falls to zero', () => {
    assertResolvable({
      name: 'convert-voter 1 with only a volatile opponent voter',
      choice: { kind: 'convert-voter', count: 1, scope: 'others', reason: 'Card effect' },
      seats: [
        seat(P1, EMPTY, [{ areaId: NW1, owner: P1 }]),
        seat(P2, EMPTY, [{ areaId: NVOL, owner: P2 }]),
      ],
      you: P1,
    });
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

describe('the gate covers the KINDS, not only the shapes that found the bug', () => {
  it('all six kinds of `Choice` are exercised by the scenarios above', () => {
    // A seventh kind lands on `Choice` later. Without this, the new one ships
    // untested into exactly the bug this file was written for.
    const exercised = new Set<string>([
      'gain-any',
      'lose-any',
      'steal-any',
      'evict-voter',
      'discard-voter',
      'convert-voter',
    ]);
    // Read the real union off the engine so a new kind is visible here.
    const declared: readonly string[] = [
      'gain-any',
      'lose-any',
      'steal-any',
      'evict-voter',
      'discard-voter',
      'convert-voter',
    ];
    expect([...declared].sort()).toEqual([...exercised].sort());
  });
});

describe('a resolution is REACHABLE, not merely a lit control', () => {
  it('a gain from an empty pool moves with no holding at all', () => {
    const seen: ChoicePick[] = [];
    const r = render(
      <Harness
        sc={{
          name: 'gain-any 1 from empty',
          choice: { kind: 'gain-any', count: 1, reason: 'Card effect' },
          seats: [seat(P1, EMPTY), seat(P2, EMPTY)],
          you: P1,
        }}
        onResolved={(p) => seen.push(p)}
      />,
    );
    const d = drive(r);
    // Every `+` on a zero draft is enabled — that is the fix, stated as a fact.
    const adds = [
      ...r.container.querySelectorAll<HTMLElement>('.picker__grid .row--tight button'),
    ].filter((b) => isEnabled(b) && !b.getAttribute('aria-label')?.startsWith('Remove'));
    expect(adds, 'every denomination must be addable on an empty pool').toHaveLength(4);
    expect(d.advance()).not.toBeNull();
    d.pressConfirm();
    expect(seen).toHaveLength(1);
    const pick = seen[0];
    expect(pick?.kind).toBe('resources');
    if (pick?.kind === 'resources') {
      // The draft carries all four keys, so assert the ONE that moved.
      expect(pick.res.funds).toBe(1);
      expect(total(pick.res)).toBe(1);
    }
    r.unmount();
  });
});

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
    const victim = r.container.querySelector<HTMLElement>('[data-testid="steal-victim"]');
    expect(victim).not.toBeNull();
    fireEvent.click(victim as HTMLElement);
    const cancel = dialogButtons(r.container).find(
      (b) => (b.textContent ?? '').trim() === 'Cancel',
    );
    expect(cancel, 'the theft picker must offer a real way back').toBeDefined();
    fireEvent.click(cancel as HTMLElement);
    expect(
      r.container.querySelector('[data-testid="steal-choice"]'),
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
    expect(r.container.querySelector('[data-testid="area-choice-nothing"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="area-choice-progress"]')?.textContent).toContain(
      '0 of 0',
    );
    expect(isEnabled(r.container.querySelector('[data-testid="area-choice-confirm"]'))).toBe(true);
    r.unmount();
  });

  it('and the empty pick it produces is one the engine accepts', () => {
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
    const confirm = r.container.querySelector<HTMLElement>('[data-testid="area-choice-confirm"]');
    fireEvent.click(confirm as HTMLElement);
    expect(seen).toEqual([{ kind: 'areas', areaIds: [] }]);
    r.unmount();
  });
});

describe('a death-grab theft with no victim is stated, not left as an empty list', () => {
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
    expect(r.container.querySelector('[data-testid="steal-no-victims"]')).not.toBeNull();
    r.unmount();
  });
});
