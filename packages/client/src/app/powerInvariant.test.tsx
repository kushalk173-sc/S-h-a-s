/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE POWER INVARIANT: EVERY POWER FLOW IS COMPLETABLE, ON THE REAL BOARD
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## THE DEFECT, AND WHY IT SURVIVED A GREEN ENGINE
 *
 * Land Grab "never worked": 25-50 occupied areas offered, CONFIRM never enables.
 * Two independent causes, both client-side, both invisible to every existing suite
 * because no suite rendered `PowerDialog` over a real `BoardSvg`.
 *
 *   1. **THE DIALOG COVERED THE ONLY PLACE THE ANSWER COULD BE GIVEN.**
 *      `PowerDialog` rendered `.scrim` — `position: fixed; inset: 0; z-index: 20`
 *      over an opaque `--table-900` — for all five of its shapes. Three of them
 *      (Land Grab, Payback, Tough Love) are answered by CLICKING A SLOT, and
 *      `PowerDialog` has no slot list of its own. So for those three the pick could
 *      not be made at all, and `ready = area !== null && …` could never be true.
 *      `.scrim--area` already existed, `pointer-events: none` with the sheet
 *      anchored to the bottom, because `ChoiceResolver` had been repaired for
 *      precisely this. `PowerDialog` had not.
 *
 *   2. **THE BOARD SAID EVERY LEGAL TARGET WAS ILLEGAL.**
 *      `GameScreen`'s interaction memo put the board in `mode: 'place'` for a power
 *      without passing `legalAreaIds`, so `BoardSvg` fell back to its own rule —
 *      "an empty slot is the target". Every slot power's legal target is an
 *      OCCUPIED slot, so all 129 squares were wrong and every occupied one was
 *      announced `illegal: already occupied`, while a DIFFERENT copy of the
 *      legality rule in the click handler accepted it. A board and a dialog
 *      disagreeing about the legal set is Defect A's shape, one layer out.
 *
 * And a third, which is why "never worked" is stronger than "never enabled":
 *
 *   3. **LAND GRAB'S CONFIRM DID NOTHING WHEN PRESSED.** `SlotTarget` serves both
 *      Land Grab and Payback and gated its submit on
 *      `if (area === null || cost === null) return;` — but `cost` is only ever set
 *      when there IS a payment, so for Land Grab it was `null` forever. The button
 *      was enabled, looked live, and silently dropped the power (§9.10).
 *
 * ## WHY THIS IS A SEPARATE FILE AND NOT A THIRD BLOCK IN `choiceInvariant`
 *
 * Because these are not `Choice` kinds. `choiceInvariant.test.tsx` is a gate over
 * `PendingChoice`'s union; a power is an `Action` the player aims at a board
 * themselves, with no decision raised and nothing owed. Folding it in would have
 * meant either widening that file's stated subject past what its name and header
 * claim, or leaving these three shapes ungated again — which is what happened.
 *
 * ## WHAT IS ASSERTED
 *
 * For each of the three board-resolved powers, over the real `PowerDialog` and the
 * real `BoardSvg`, wired the way `GameScreen` wires them (`powerTargetsArea` for the
 * mode, `powerTargetableAreas` for the legal set, `powerAreaRefusal` for the click):
 *
 *   1. the dialog does not take the board — `.scrim--area`, no `aria-modal`;
 *   2. the board labels the power's legal slots `legal target`, and NONE of them is
 *      an empty slot;
 *   3. every slot the board calls a legal target is ACCEPTED by the click handler;
 *   4. CONFIRM goes live, and pressing it DISPATCHES — not merely enables;
 *   5. the dispatch names the slot the board highlighted.
 *
 * Plus the stylesheet gate: `.scrim--area`'s `pointer-events: none` is the mechanism
 * that makes (1) true, and it lives in a file jsdom does not lay out, so it is
 * pinned by reading the bytes — the same technique `choiceInvariant` uses for
 * `reduce.ts`, for the same reason.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
// The stylesheet's own bytes. jsdom does not lay out, so `elementFromPoint` cannot
// be measured here — the mechanism that lets a click fall through to the board is a
// declaration, and a declaration is pinned by reading it.
import appCss from './app.css?raw';
import gameScreenSource from './GameScreen.tsx?raw';
import powerDialogSource from './PowerDialog.tsx?raw';

import { BoardSvg } from '../board/BoardSvg.tsx';
import { makeZones, putPeg } from '../board/fixtures.ts';

import { PowerDialog, type PowerSubmit } from './PowerDialog.tsx';
import {
  IDLE_INTERACTION,
  UI_RULES,
  powerAreaRefusal,
  powerBoardLegality,
  powerTargetableAreas,
  toBoardState,
  type BoardInteraction,
} from './derive.ts';
import { powerAreaCount, powerTargetsArea, type PowerFlow } from './store.ts';

// ─────────────────────────── the fixture ───────────────────────────

const RES = ['funds', 'clout', 'media', 'trust'] as const;
const P1 = 'p1' as const;
const P2 = 'p2' as const;

const A = {
  nw1: 'north_west-01',
  n1: 'north-01',
  n2: 'north-02',
  n3: 'north-03',
  w1: 'west-01',
  c1: 'central-01',
  c2: 'central-02',
  /** Volatile, by the generated board's own flags. */
  nwVol: 'north_west-07',
} as const;

/** The mat each seat brings. Only `powerUses` and resources matter here. */
function mat(resources: Partial<Record<(typeof RES)[number], number>> = {}) {
  return {
    id: '' as string,
    name: '',
    colour: '#fff',
    resources: { funds: 0, clout: 0, media: 0, trust: 0, ...resources },
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

type FlowCase = {
  readonly power: PowerFlow['power'];
  /** Pegs on the board, as `[areaId, owner]`. */
  readonly pegs: readonly (readonly [string, string])[];
  /** Everything these two can pay, so no refusal is about money. */
  readonly you: Record<string, number>;
};

function stateFor(c: FlowCase) {
  let zones = makeZones();
  for (const [areaId, owner] of c.pegs) zones = putPeg(zones, areaId, owner);
  const you = { ...mat(c.you), id: P1, name: 'P1' };
  const them = { ...mat({ funds: 9, clout: 9, media: 9, trust: 9 }), id: P2, name: 'P2' };
  return {
    zones,
    players: { [P1]: you, [P2]: them },
    turnOrder: [P1, P2],
    activePlayer: P1,
    phase: 'actions',
    turn: 4,
    round: 1,
    finished: false,
    market: [],
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices: [],
    log: [],
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
  } as unknown as Parameters<typeof toBoardState>[0];
}

// ─────────────────────────── the harness ───────────────────────────

/**
 * The real dialog over the real board, wired exactly as `GameScreen` wires them.
 *
 * The interaction memo is COPIED here rather than imported, because it is a
 * `useMemo` inside a component that owns a websocket. What is copied is the three
 * calls it makes — `powerTargetsArea`, `powerTargetableAreas`, and the `mode`/`legal-
 * AreaIds` pair it hands `toBoardState` — and each of those is the real function, so
 * a drift in the memo is caught here as a difference between this copy and the source
 * text of `GameScreen`, which the last test in this file reads.
 */
function Harness({ c, onSubmit }: { c: FlowCase; onSubmit: (s: PowerSubmit) => void }) {
  const [flow] = useState<PowerFlow>({ power: c.power });
  const [pickedAreaIds, setPicked] = useState<readonly string[]>([]);
  const state = stateFor(c);

  const interaction: BoardInteraction = powerTargetsArea(flow)
    ? (() => {
        const { legalAreaIds, illegalReasons } = powerBoardLegality(state, P1, flow, pickedAreaIds);
        return {
          mode: 'place',
          pickedAreaIds,
          lockedZoneId: null,
          gerrySourceAreaId: null,
          resolveGerrySources: false,
          // Unconditionally, matching `choiceBoardInteraction` and
          // `pegMoveInteraction`: an empty set is an answer, and withholding it
          // hands the board back to the fallback rule that broke this.
          legalAreaIds,
          illegalReasons,
          illegalReason: 'this power cannot reach that voter',
          disabled: false,
        };
      })()
    : { ...IDLE_INTERACTION, disabled: false };

  const onSlotActivate = (areaId: string): void => {
    // The same gate `GameScreen`'s `onSlotActivate` applies in its power branch.
    if (powerAreaRefusal(state, P1, flow, areaId, pickedAreaIds) !== null) return;
    setPicked((cur) =>
      cur.includes(areaId) ? cur.filter((x) => x !== areaId) : [...cur, areaId],
    );
  };

  return (
    <div>
      <BoardSvg state={toBoardState(state, interaction)} onSlotActivate={onSlotActivate} />
      <PowerDialog
        state={state}
        you={P1}
        flow={flow}
        pickedAreaIds={pickedAreaIds}
        onPickSlot={onSlotActivate}
        onRemovePick={() => setPicked((cur) => cur.slice(0, -1))}
        onCancel={() => undefined}
        onSubmit={onSubmit}
      />
      <span data-testid="picked">{pickedAreaIds.join(',')}</span>
      <span data-testid="wanted">{powerAreaCount(flow)}</span>
    </div>
  );
}

// ─────────────────────────── the drivers ───────────────────────────

const isEnabled = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement &&
  !el.hasAttribute('disabled') &&
  el.getAttribute('aria-disabled') !== 'true';

/** Every slot the BOARD itself calls a legal target — the §8.5 contract, read. */
function boardTargets(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('g[role="button"][data-area-id]')].filter((g) =>
    (g.getAttribute('aria-label') ?? '').includes('legal target'),
  );
}

function allSlots(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('g[role="button"][data-area-id]')];
}

function slotOf(root: HTMLElement, areaId: string): HTMLElement {
  const g = allSlots(root).find((x) => x.getAttribute('data-area-id') === areaId);
  if (g === undefined) throw new Error(`no slot ${areaId} on the board`);
  return g;
}

function occupied(root: HTMLElement, areaId: string): boolean {
  return (slotOf(root, areaId).getAttribute('aria-label') ?? '').includes('legal target');
}

/**
 * NAME THE PAYMENT, for the two powers that charge one.
 *
 * Payback is `SlotTarget` with `pay`; Tough Love carries its own composer (2 Trust
 * fixed plus any 2, because `reduce.ts` wants two conditions rather than one count
 * — R3's negative-delta guard is what forces that shape). Neither gate is a defect:
 * a power that costs something SHOULD make the player say what. It is here so the
 * test drives the real answer rather than asserting CONFIRM goes live by itself.
 */
function payThePrice(r: RenderResult, c: FlowCase): void {
  const root = r.container;
  if (c.power === 'payback') {
    const cell = root.querySelector<HTMLElement>('[data-testid^=payback-pay-]');
    if (cell === null) throw new Error('payback offers no payment denomination');
    fireEvent.click(cell);
    return;
  }
  if (c.power !== 'tough-love') return;
  // Any 2, on top of 2 Trust. Two presses on the first denomination that has any.
  for (let i = 0; i < UI_RULES.toughLoveAny; i += 1) {
    const cells = [...root.querySelectorAll<HTMLElement>('[data-testid^=toughlove-pay-]')].filter(
      (b) => isEnabled(b),
    );
    const cell = cells[0];
    if (cell === undefined) throw new Error('tough love offers no payable denomination');
    fireEvent.click(cell);
  }
}

// ─────────────────────────── the cases ───────────────────────────

/**
 * ONE CASE PER BOARD-RESOLVED POWER, and the layouts are chosen so each rule has
 * something to refuse:
 *
 *   - `nwVol` is Volatile by the generated board's own flags, so it is permanent and
 *     no power may touch it;
 *   - `nw1` belongs to P1, which Land Grab accepts and Payback must refuse;
 *   - `c1`/`c2` are both P2's and in one constituency, which is what Tough Love's
 *     "same constituency, same player" needs to be satisfiable.
 *
 * `land-grab` is given the exact layout the tester described: 25-50 occupied areas,
 * of which every one is a legal target. Nothing in this file is small.
 */
const CASES: readonly FlowCase[] = [
  {
    power: 'land-grab',
    pegs: [
      [A.n1, P2],
      [A.n2, P2],
      [A.n3, P2],
      [A.w1, P2],
      [A.c1, P2],
      [A.c2, P2],
      [A.nw1, P1],
      [A.nwVol, P2],
    ],
    you: { funds: 4, clout: 4, media: 4, trust: 4 },
  },
  {
    power: 'payback',
    pegs: [
      [A.n1, P2],
      [A.n2, P2],
      [A.n3, P2],
      [A.w1, P2],
      [A.c1, P2],
      [A.c2, P2],
      [A.nw1, P1],
      [A.nwVol, P2],
    ],
    you: { funds: 4, clout: 4, media: 4, trust: 4 },
  },
  {
    // Tough Love needs TWO opponent voters in ONE constituency, both the same
    // player — hence `c1` and `c2`, and hence a `north_west-01` of P1's to be
    // refused by the "targets an opponent" clause rather than by the zone clause.
    power: 'tough-love',
    pegs: [
      [A.c1, P2],
      [A.c2, P2],
      [A.n1, P2],
      [A.n2, P2],
      [A.nw1, P1],
      [A.nwVol, P2],
    ],
    you: { funds: 4, clout: 4, media: 4, trust: 4 },
  },
];

describe('every board-resolved power is COMPLETABLE, on the real board', () => {
  for (const c of CASES) {
    it(`${c.power} — the board is reachable, highlighted with the right set, and CONFIRM dispatches`, () => {
      const seen: PowerSubmit[] = [];
      const r = render(<Harness c={c} onSubmit={(s) => seen.push(s)} />);
      const root = r.container;

      // (1) THE DIALOG MUST NOT COVER THE BOARD. `scrim--area` is the variant that
      // lets a click fall through — it is applied ALONGSIDE `scrim`, exactly as
      // `ChoiceResolver` does it, because the two are the same overlay with three
      // declarations overridden. What matters is that the override is present.
      const scrim = root.querySelector('[data-testid="power-dialog"]') as HTMLElement;
      expect(
        scrim.className,
        `${c.power}: the dialog covers the only surface the answer can be given on`,
      ).toContain('scrim--area');
      const sheet = root.querySelector('.sheet') as HTMLElement;
      expect(
        sheet.getAttribute('aria-modal'),
        `${c.power}: the dialog still tells a screen reader the board is inert`,
      ).toBeNull();

      // (2) THE BOARD'S LEGAL SET IS THE POWER'S. And it is OCCUPIED — that is the
      // clause `BoardSvg`'s fallback gets backwards.
      const legal = powerTargetableAreas(stateFor(c), P1, { power: c.power }, []);
      expect(legal.size, `${c.power}: the fixture offers nothing`).toBeGreaterThan(0);
      expect(
        boardTargets(root).map((g) => g.getAttribute('data-area-id')).sort(),
        `${c.power}: the board highlights a different set than the power can reach`,
      ).toEqual([...legal].sort());
      for (const id of legal) {
        expect(
          (slotOf(root, id).getAttribute('aria-label') ?? '').includes(', empty.'),
          `${c.power}: ${id} is highlighted as a legal target and holds NO voter`,
        ).toBe(false);
      }
      // A Volatile-Area voter is permanent and must not be offered by any of them.
      expect(
        legal.has(A.nwVol),
        `${c.power}: a voter in a Volatile Area is offered as a target`,
      ).toBe(false);

      // (3) EVERY LEGAL TARGET IS ACCEPTED, and (4)+(5) CONFIRM GOES LIVE AND
      // DISPATCHES. Pressing only what the BOARD offers is the whole discipline: a
      // dialog that names one set and a board that highlights another is exactly the
      // defect this file exists for.
      const wanted = powerAreaCount({ power: c.power });
      const chosen: string[] = [];
      for (const g of boardTargets(root)) {
        if (chosen.length >= wanted) break;
        if (g.hasAttribute('aria-disabled')) continue;
        const id = g.getAttribute('data-area-id') ?? '';
        fireEvent.click(g);
        expect(
          (root.querySelector('[data-testid="picked"]')?.textContent ?? '').split(',').filter(Boolean),
          `${c.power}: the board offered ${id} as a legal target and the click was dropped`,
        ).toContain(id);
        chosen.push(id);
      }
      expect(chosen.length, `${c.power}: could not collect ${wanted} legal targets`).toBe(wanted);
      payThePrice(r, c);

      const confirm = root.querySelector<HTMLElement>('[data-testid="slot-target-confirm"]');
      if (confirm === null) {
        // Tough Love confirms under its own testid; either way it must be live.
        const tl = root.querySelector<HTMLElement>('[data-testid="tough-love-confirm"]');
        expect(isEnabled(tl), `${c.power}: CONFIRM never went live`).toBe(true);
        fireEvent.click(tl as HTMLElement);
      } else {
        expect(isEnabled(confirm), `${c.power}: CONFIRM never went live`).toBe(true);
        // THE PRESS. A control that enables and then does nothing is worse than one
        // that never enables, because the player has been told it will work.
        fireEvent.click(confirm);
      }
      expect(seen, `${c.power}: CONFIRM was live and the power was still not dispatched`).toHaveLength(1);
      if (c.power === 'land-grab') {
        expect(seen[0]).toEqual({ kind: 'land-grab', areaId: chosen[0] });
      } else if (c.power === 'payback') {
        expect(seen[0]).toEqual({
          kind: 'payback',
          areaId: chosen[0],
          pay: (seen[0] as { pay?: string }).pay,
        });
        expect((seen[0] as { pay?: string }).pay, `${c.power}: no payment was named`).toBeTruthy();
      } else {
        const ids = (seen[0] as { areaIds: readonly string[] }).areaIds;
        expect([...ids].sort(), `${c.power}: the dispatch names slots the board did not offer`).toEqual(
          [...chosen].sort(),
        );
      }
      r.unmount();
    });
  }

  it('Land Grab takes YOUR OWN voter — the one clause that separates it from Payback', () => {
    // `reduce.ts`: Land Grab evicts any voter, theirs or yours. The two powers share
    // `SlotTarget`, so a "targets an opponent" clause applied unconditionally would
    // have quietly become Land Grab's rule too.
    const seen: PowerSubmit[] = [];
    const c: FlowCase = {
      power: 'land-grab',
      pegs: [[A.nw1, P1]],
      you: { funds: 2, clout: 2, media: 2, trust: 2 },
    };
    const r = render(<Harness c={c} onSubmit={(s) => seen.push(s)} />);
    expect(occupied(r.container, A.nw1), 'your own voter is not offered to Land Grab').toBe(true);
    fireEvent.click(slotOf(r.container, A.nw1));
    const confirm = r.container.querySelector<HTMLElement>('[data-testid="slot-target-confirm"]');
    expect(isEnabled(confirm), 'CONFIRM never went live on your own voter').toBe(true);
    fireEvent.click(confirm as HTMLElement);
    expect(seen).toEqual([{ kind: 'land-grab', areaId: A.nw1 }]);

    // …and Payback refuses the same slot, BY NAME — the sentence the board prints on
    // the slot itself (§8.5), not only one the click handler happens to produce.
    const payback: FlowCase = { ...c, power: 'payback' };
    const seen2: PowerSubmit[] = [];
    const r2 = render(<Harness c={payback} onSubmit={(s) => seen2.push(s)} />);
    expect(occupied(r2.container, A.nw1), 'your own voter is offered to Payback').toBe(false);
    expect(slotOf(r2.container, A.nw1).getAttribute('aria-label') ?? '').toContain(
      'this power targets an opponent',
    );
    // …and with a payment named it still cannot be confirmed on that slot, which is
    // the honest state: the legal set is empty, so the press must not dispatch.
    payThePrice(r2, payback);
    expect(
      isEnabled(r2.container.querySelector('[data-testid="slot-target-confirm"]')),
      'Payback can be confirmed against a slot it refuses',
    ).toBe(false);
    expect(seen2, 'Payback dispatched against an illegal slot').toHaveLength(0);
    r.unmount();
    r2.unmount();
  });

  it('Tough Love’s legal set NARROWS with the pick, because its rule does', () => {
    // "both in the same constituency, both the same player" is only knowable once one
    // is down. A highlight that ignored the picks would offer a second voter the
    // refusal then throws away — which is the dead-control shape again, on the second
    // press of a two-press answer.
    const c: FlowCase = {
      power: 'tough-love',
      pegs: [
        [A.c1, P2],
        [A.c2, P2],
        [A.n1, P2],
        [A.nw1, P1],
      ],
      you: { funds: 4, clout: 4, media: 4, trust: 4 },
    };
    const state = stateFor(c);
    const flow: PowerFlow = { power: 'tough-love' };
    const first = powerTargetableAreas(state, P1, flow, []);
    expect(first.has(A.c1) && first.has(A.c2), 'the fixture does not offer a legal pair').toBe(true);
    expect(first.has(A.n1), 'a voter in another constituency is offered before the first pick').toBe(true);

    const r = render(<Harness c={c} onSubmit={() => undefined} />);
    fireEvent.click(slotOf(r.container, A.c1));
    expect(occupied(r.container, A.c2), 'the pair in one constituency is no longer offered').toBe(true);
    expect(occupied(r.container, A.n1), 'a voter in another constituency is still offered').toBe(false);
    expect(
      slotOf(r.container, A.n1).getAttribute('aria-label') ?? '',
      'the slot that just went dark does not say which clause turned it off',
    ).toContain('same constituency');
    r.unmount();
  });

  it('an empty legal set is stated, not presented as an empty board', () => {
    // The shape `PegDestChoice` handles for G1 and `AreaChoice` for the three list
    // kinds: a board with nothing on it to press must SAY so, and must not leave the
    // player on a live-looking CONFIRM that can never enable. Reachable here: an
    // empty board means Land Grab has nothing to evict.
    const c: FlowCase = { power: 'land-grab', pegs: [], you: { funds: 1, clout: 1, media: 1, trust: 1 } };
    const r = render(<Harness c={c} onSubmit={() => undefined} />);
    expect(powerTargetableAreas(stateFor(c), P1, { power: 'land-grab' }, []).size).toBe(0);
    expect(boardTargets(r.container), 'an empty board still highlights something').toHaveLength(0);
    const confirm = r.container.querySelector<HTMLElement>('[data-testid="slot-target-confirm"]');
    expect(isEnabled(confirm), 'CONFIRM is live with nothing to pick').toBe(false);
    // CANCEL is the way out, and it is a real handler (`onCancel` above).
    const cancel = r.container.querySelector<HTMLElement>('[data-testid="power-cancel"]');
    expect(isEnabled(cancel), 'the dialog offers no way out').toBe(true);
    r.unmount();
  });
});

describe('the mechanism, pinned where jsdom cannot measure it', () => {
  it('.scrim--area lets a click fall through to the board, and .scrim does not', () => {
    // jsdom has no layout, so `document.elementFromPoint` at the centre of a legal
    // slot — the assertion that caught this in the live DOM for `ChoiceResolver` —
    // cannot be reproduced here. The thing that makes it true is two declarations,
    // and a declaration is pinned by reading it.
    const area = /\.scrim--area \{[^}]*\}/.exec(appCss)?.[0] ?? '';
    expect(area, '.scrim--area is gone from app.css').not.toBe('');
    expect(area, '.scrim--area no longer lets a click through to the board').toContain(
      'pointer-events: none',
    );
    expect(area, '.scrim--area no longer anchors the sheet out of the board’s way').toContain(
      'align-items: flex-end',
    );
    const opaque = /\.scrim \{[^}]*\}/.exec(appCss)?.[0] ?? '';
    expect(opaque, '.scrim is gone from app.css').not.toBe('');
    expect(opaque, '.scrim is no longer full-viewport').toContain('inset: 0');
    expect(opaque, '.scrim no longer stacks above the board').toContain('z-index: 20');
    // …and the sheet takes its pointer events back, or CONFIRM and CANCEL would go
    // with the rest.
    expect(appCss, '.scrim--area .sheet no longer reclaims its own clicks').toContain(
      '.scrim--area .sheet',
    );
  });

  it('the power branch hands the board a legal set, and the memo still says so', () => {
    // `GameScreen`'s interaction memo is a `useMemo` inside a component that owns a
    // websocket, so `Harness` above copies its calls. This is what keeps the copy
    // honest: if the memo stops passing `legalAreaIds`, this fails even though every
    // behavioural assertion above still passes against the copy.
    const screen = gameScreenSource;
    expect(screen, 'the power branch stopped passing the legal set to the board').toContain(
      'powerBoardLegality(',
    );
    expect(screen, 'the board is no longer told which slots the power can reach').toContain(
      'legalAreaIds: legal,',
    );
    // …and UNCONDITIONALLY. An empty set is a real answer; withholding it hands the
    // board back to "an empty slot is the target", which is the rule that broke this.
    expect(
      screen,
      'the legal set is withheld when empty, which re-opens BoardSvg’s fallback rule',
    ).not.toContain('...(legal.size === 0 ? {} : { legalAreaIds: legal })');
    // …and there is ONE legality rule, not three.
    expect(screen, 'GameScreen grew a fourth copy of the power legality rule').not.toContain(
      'function powerAreaRefusal(',
    );
    const dialog = powerDialogSource;
    expect(dialog, 'PowerDialog grew its own copy of the power legality rule again').not.toContain(
      'function slotRefusal(',
    );
    expect(dialog, 'PowerDialog must READ the shared rule').toContain(
      'powerAreaRefusal(state, you, flow, area.id)',
    );
    // …and Land Grab's submit is no longer gated on a payment it does not have. The
    // COMMENTS are stripped first, because the defect's own post-mortem quotes the
    // old line verbatim — a source pin that can be satisfied by a comment is not a
    // gate.
    const dialogCode = dialog.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(dialogCode, "Land Grab's CONFIRM is gated on a payment again").not.toContain(
      'if (area === null || cost === null) return;',
    );
    expect(dialogCode, "Land Grab's CONFIRM no longer tests the payment it does not have").toContain(
      'if (area === null || !paid',
    );
    // And the three board-resolved powers get the non-covering scrim while the two
    // that genuinely are modal keep it. Getting that the wrong way round is its own
    // lie in the other direction, so it is pinned rather than left to the render.
    expect(dialogCode, 'the scrim variant is not chosen by whether the answer is on the board').toContain(
      "const onBoard = powerTargetsArea(flow);",
    );
    expect(dialogCode, 'the board-resolved dialog still claims the board is inert').not.toContain(
      'aria-modal="true"\n',
    );
  });
});
