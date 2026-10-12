/**
 * ═════════════════════════════════════════════════════════════════════════════
 * A GAME THAT STOPPED BEING WONNABLE SAYS SO — AND THE VOTERS THAT FIT NOWHERE
 * SAY SO AT THE MOMENT THEY ARE DEALT
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## WHAT WAS REPORTED
 *
 * A real three-seat browser run reached 490 turns: 117 pegs placed, 20 free slots,
 * eight of nine constituencies holding a majority, and Central one vote short
 * with its last empty slot right there. A second run, from the same driver,
 * finished properly on turn 38 — so the difference between the two was never
 * obvious from the outside. Nothing on any screen said which kind of game this was.
 *
 * The player in the stalled run has exactly one question and it is not a
 * decorative one: *keep playing, or stop?* A badge cannot answer it. So this file
 * asserts three separable things, in the order a player meets them:
 *
 *   1. **THE STAND IS STATED.** One sentence, above the board, naming what is
 *      true — a constituency that can never be decided, or which seats can still
 *      win — and nothing at all when the game is still going.
 *   2. **THE UNPLACEABLE GROUP SAYS SO ON DEAL**, not after the player opens the
 *      placement bar and finds it empty. p10 already rules on this: *"If no single
 *      zone has enough empty areas for a card's voters, all voters from that card
 *      are discarded."*
 *   3. **AN AFFORDABLE CARD IS NEVER A DEAD BUTTON**, and a card whose voters
 *      cannot be placed is warned about before it is bought rather than refused,
 *      because p10 does not make the purchase illegal.
 *
 * ## WHAT IS ASSERTED NOT TO HAPPEN
 *
 * The banner must NOT appear on a healthy board, and `derive.ts`'s `standOf` must
 * read a payload with no `stand` field as OPEN. A table told its game is over on
 * the strength of a field that is not there is worse than a table told nothing.
 */

import { describe, expect, it } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';
import { render, screen } from '@testing-library/react';
// TYPE-ONLY. See `derive.ts`'s header: the secret gate scans this directory whole.
import type {
  ClientState,
  MarketSlot,
  PendingVoters,
  PlayerID,
  PlayerState,
  Pool,
  Stand,
  ZoneID,
} from '@shasn/engine';

import { PlacementBar } from './BoardBars.tsx';
import { StandBanner } from './StandBanner.tsx';
import { MarketStrip, PendingGroups } from './YourMat.tsx';
import {
  cardStranded,
  roomiestFree,
  standOf,
  standVerdict,
  strandedIds,
  strandedSentence,
} from './derive.ts';

const ME: PlayerID = 'p1';
const THEM: PlayerID = 'p2';
const THIRD: PlayerID = 'p3';
const EMPTY: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

// ─────────────────────────── fixtures ───────────────────────────

function seat(id: PlayerID, pool: Pool = EMPTY, pending: readonly PendingVoters[] = []): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    colour: '#fff',
    resources: pool,
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
    pending: [...pending],
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
  } as unknown as PlayerState;
}

/** One constituency, `capacity` areas of which `free` are empty. */
function zone(id: ZoneID, name: string, majority: number, capacity: number, free: number, holder: PlayerID | null) {
  return {
    id,
    name,
    majority,
    capacity,
    neighbours: [],
    majorityHolder: holder,
    areas: Array.from({ length: capacity }, (_, i) => ({
      id: `${id}-${String(i + 1).padStart(2, '0')}`,
      zone: id,
      volatile: false,
      peg: i < capacity - free ? { owner: holder ?? 'p9', majority: false } : null,
    })),
  };
}

/** Nine constituencies: `free` per zone, `holders[n]` holding constituency n. */
function board(free: readonly number[], holders: readonly (PlayerID | null)[]) {
  const spec: readonly (readonly [string, string, number, number])[] = [
    ['north_west', 'North West', 6, 11],
    ['north', 'North', 11, 21],
    ['north_east', 'North East', 6, 11],
    ['west', 'West', 9, 17],
    ['central', 'Central', 5, 9],
    ['east', 'East', 9, 17],
    ['south_west', 'South West', 6, 11],
    ['south', 'South', 11, 21],
    ['south_east', 'South East', 6, 11],
  ];
  return spec.map(([id, name, majority, capacity], i) =>
    zone(id as ZoneID, name, majority, capacity, free[i] ?? 0, holders[i] ?? null),
  );
}

const marketSlot = (cost: Partial<Record<string, number>>, voters: number): MarketSlot =>
  ({ cardId: `v-${voters}-${Object.keys(cost).join('-')}`, cost, voters }) as unknown as MarketSlot;

function stand(over: Partial<Stand> = {}): Stand {
  return {
    zonesTotal: 9,
    undecided: [],
    lost: [],
    dead: false,
    inPlay: [ME, THEM, THIRD],
    out: [],
    seats: [],
    stranded: [],
    ...over,
  } as unknown as Stand;
}

function table(over: { readonly zones?: unknown; readonly stand?: Stand; readonly pool?: Pool } = {}): ClientState {
  return {
    players: {
      [ME]: seat(ME, over.pool ?? EMPTY),
      [THEM]: seat(THEM),
      [THIRD]: seat(THIRD),
    },
    turnOrder: [ME, THEM, THIRD],
    activePlayer: ME,
    phase: 'actions',
    turn: 490,
    round: 160,
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
    zones: over.zones ?? board([2, 2, 2, 2, 1, 2, 2, 2, 2], [ME, THEM, THIRD, ME, null, THEM, THIRD, ME, THEM]),
    stand: over.stand,
  } as unknown as ClientState;
}

// ─────────────────────────── 1. the stand ───────────────────────────

describe('the stand of the board is stated, and only when it is true', () => {
  const reported = table({
    zones: board([2, 2, 2, 2, 1, 2, 2, 2, 2], [ME, THEM, THIRD, ME, null, THEM, THIRD, ME, THEM]),
    stand: stand({ undecided: ['central'], inPlay: [ME, THEM], out: [THIRD] }),
  });

  it('a healthy game says nothing at all, so silence means "still going"', () => {
    const open = standVerdict(table());
    expect(open.tone).toBe('open');
    expect(open.sentence).toBeNull();
    const { container, unmount } = render(<StandBanner state={table()} />);
    expect(container.querySelector('[data-testid="stand-banner"]')).toBeNull();
    unmount();
  });

  it('names the constituency that can never be decided, and says what follows', () => {
    // The strong claim, and the sentence it earns. `lost` is a PROOF — a peg only
    // ever enters a zone by filling an empty area, so a zone no seat can reach is
    // closed to everybody — and what it actually means is that p7's "all nine"
    // ending is gone. The sentence must not say the game is over, because the
    // rulebook has no such ending and the server has not sent one.
    const dead = standVerdict(
      table({ stand: stand({ dead: true, lost: ['central'], undecided: ['central'], inPlay: [], out: [ME, THEM, THIRD] }) }),
    );
    expect(dead.tone).toBe('dead');
    expect(dead.sentence).toContain('Central');
    expect(dead.sentence).toContain('can never be decided');
    expect(dead.sentence).toMatch(/nine constituencies can no longer be held/);
    expect(dead.sentence).not.toMatch(/\bthe game is over\b/i);
  });

  it('names who can still win, and who cannot', () => {
    // The reported run's shape: eight held, Central open, one seat out of it.
    const v = standVerdict(reported);
    expect(v.tone).toBe('decided');
    expect(v.namedSeats).toEqual([THIRD.toUpperCase()]);
    expect(v.sentence).toContain('P3');
    expect(v.sentence).toMatch(/cannot win from here/);
    expect(v.sentence).not.toMatch(/the game is over/i);
  });

  it('a single seat left in it gets its own sentence', () => {
    const v = standVerdict(
      table({ stand: stand({ inPlay: [ME], out: [THEM, THIRD] }) }),
    );
    expect(v.sentence).toContain('P1 is the only seat that can still win');
    expect(v.sentence).toContain('P2 and P3 cannot win from here');
  });

  it('a payload with NO stand field reads as open, never as dead', () => {
    // The cross-version path: a client talking to a server older than this field.
    // The safe direction is the only one defensible — a table must never be told
    // its game is over on the strength of something that is not there.
    const legacy = table();
    expect((legacy as { stand?: Stand }).stand).toBeUndefined();
    expect(standOf(legacy).dead).toBe(false);
    expect(standVerdict(legacy).sentence).toBeNull();
  });

  it('the banner renders the sentence, and it is a live region', () => {
    const dead = table({
      stand: stand({ dead: true, lost: ['central'], inPlay: [], out: [ME, THEM, THIRD] }),
    });
    const { unmount } = render(<StandBanner state={dead} />);
    const banner = screen.getByTestId('stand-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('data-tone')).toBe('dead');
    expect(screen.getByTestId('stand-sentence').textContent).toContain('Central');
    unmount();
  });

  it('renders no control at all — it is information, not a decision', () => {
    // §9.10: nothing here may look pressable. No button, no dismiss, nothing to
    // acknowledge; the sentence disappears when the engine stops saying it.
    const dead = table({
      stand: stand({ dead: true, lost: ['central'], inPlay: [], out: [ME, THEM, THIRD] }),
    });
    const { container, unmount } = render(<StandBanner state={dead} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    unmount();
  });
});

// ─────────────────────── 2. the unplaceable group ───────────────────────

const STRANDED = stand({
  stranded: [
    {
      player: THIRD,
      groupId: 'g7',
      count: 3,
      sameZone: true,
      source: 'Voter Card',
      roomiestZoneFree: 2,
    },
  ],
});

const group = (id: string, count: number): PendingVoters => ({
  id,
  count,
  sameZone: true,
  source: 'Voter Card',
});

describe('a voter group that fits nowhere says so the moment it is dealt', () => {
  const strandedState = table({ stand: STRANDED });

  it('the sentence is p10s own rule, with the number that settles it', () => {
    const s = strandedSentence(strandedState, 'g7');
    expect(s).toContain('No constituency has 3 empty slots');
    expect(s).toContain('the roomiest has 2');
    expect(s).toContain('All 3 voters from this Voter Card are discarded');
    expect(s).toContain('cannot be split across constituencies');
  });

  it('it is absent for a group that DOES fit, so the sentence means something', () => {
    const roomy = table({ zones: board([9, 9, 9, 9, 9, 9, 9, 9, 9], Array(9).fill(null)), stand: stand() });
    expect(roomiestFree(roomy)).toBe(9);
    expect(strandedSentence(roomy, 'g7')).toBeNull();
    expect(strandedIds(roomy, THIRD)).toEqual([]);
  });

  it('the chip carries a badge and the tray carries the sentence', () => {
    const { unmount } = render(
      <PendingGroups
        state={strandedState}
        groups={[group('g7', 3)]}
        placingGroupId={null}
        pickedCount={0}
        disabled={false}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId('group-stranded').textContent).toContain('NO ROOM ANYWHERE');
    expect(screen.getByTestId('group-stranded-note').textContent).toContain('are discarded');
    unmount();
  });

  it('the placement bar says it ON ENTRY, not after a player tries a slot', () => {
    // The difference between a player who understands the game and a player who
    // thinks the game is broken: the question "can I place these?" is answered
    // before they look for an answer, not after.
    const { unmount } = render(
      <PlacementBar
        state={strandedState}
        you={THIRD}
        group={group('g7', 3)}
        picks={[]}
        refusal={null}
        onUndo={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByTestId('placement-stranded')).toBeTruthy();
    const constraint = screen.getByTestId('placement-constraint').textContent ?? '';
    expect(constraint).toContain('the roomiest has 2');
    expect(constraint).not.toContain('Pick a slot');
    unmount();
  });

  it('a group with room keeps the ordinary instruction', () => {
    const { unmount } = render(
      <PlacementBar
        state={table({ stand: stand() })}
        you={ME}
        group={group('g1', 2)}
        picks={[]}
        refusal={null}
        onUndo={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.queryByTestId('placement-stranded')).toBeNull();
    expect(screen.getByTestId('placement-constraint').textContent).toContain('Pick a slot');
    unmount();
  });
});

// ────────────────── 3. the market: warn, never refuse ──────────────────

describe('a Voter Card that cannot be placed is warned about, never refused', () => {
  const strandedMarket = table({ stand: stand() });
  const roomyMarket = table({ zones: board([9, 9, 9, 9, 9, 9, 9, 9, 9], Array(9).fill(null)) });

  it('the card is still BUYABLE and says what happens to its voters', () => {
    // p10 discards the VOTERS; it does not make the purchase illegal. A disabled
    // button here would be a rule the rulebook does not contain AND a control that
    // cannot do anything, which §9.10 names as the prohibited case.
    const { unmount } = render(
      <MarketStrip
        state={strandedMarket}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    const state = { ...strandedMarket, market: [marketSlot({ funds: 2 }, 3)] };
    expect(cardStranded(state, 3)).toBe(true);
    expect(cardStranded(state, 2)).toBe(false);
    unmount();
  });

  it('the warning is printed on the card itself', () => {
    const affordable = { ...strandedMarket, pool: undefined, market: [marketSlot({ funds: 2 }, 3)] };
    const state = {
      ...strandedMarket,
      players: { ...strandedMarket.players, [ME]: seat(ME, { funds: 4, clout: 0, media: 0, trust: 0 }) },
      market: [marketSlot({ funds: 2 }, 3)],
    } as unknown as ClientState;
    void affordable;
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    expect(screen.getByTestId('market-stranded').textContent).toContain('NO ROOM FOR THESE');
    // Affordable, therefore pressable: the warning is prose, never a disabled button.
    expect(screen.getByTestId('market-card').hasAttribute('disabled')).toBe(false);
    unmount();
  });

  it('and it is silent when the board has room for it', () => {
    const state = { ...roomyMarket, market: [marketSlot({ funds: 2 }, 3)] } as unknown as ClientState;
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    expect(screen.queryByTestId('market-stranded')).toBeNull();
    unmount();
  });
});

// ───────────────── 4. the affordable card that did nothing ─────────────────

describe('an affordable Voter Card is never a dead button', () => {
  /**
   * THE REPORTED CLICK. "An affordable card click sometimes does nothing" was
   * `MarketStrip` pricing a card against `slot.cost` while `GameScreen`'s
   * `buyMarketCard` charged `applyDiscounts(cost, discounts)` — the engine's own
   * comment on that function says checking the undiscounted cost "would refuse a
   * buy the Helping Hands discount has already made legal", and the strip did
   * exactly that. So: arm Helping Hands on a `2 funds · 2 trust` card while holding
   * `1 funds · 3 trust`. The engine accepts the purchase. The strip rendered the
   * button dead, and nothing anywhere said why.
   */
  const POOL: Pool = { funds: 1, clout: 0, media: 0, trust: 3 };
  const CARD = marketSlot({ funds: 2, trust: 2 }, 2);
  const state = { ...table({ pool: POOL }), market: [CARD] } as unknown as ClientState;

  it('with no power armed the card is genuinely unaffordable, and says which resource', () => {
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={null}
        onBuy={() => undefined}
      />,
    );
    const card = screen.getByTestId('market-card');
    expect(card.hasAttribute('disabled')).toBe(true);
    expect(card.textContent).toContain('1 funds short');
    unmount();
  });

  it('with Helping Hands armed on it, the SAME card is live — that is the fix', () => {
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={{ slot: 0, discounts: ['funds'] }}
        onBuy={() => undefined}
      />,
    );
    const card = screen.getByTestId('market-card');
    expect(card.hasAttribute('disabled'), 'a purchase the engine accepts must be pressable').toBe(
      false,
    );
    expect(card.className).not.toContain('mkt--unavail');
    unmount();
  });

  it('and the waived denomination is shown, so the price on screen is the price charged', () => {
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={{ slot: 0, discounts: ['funds'] }}
        onBuy={() => undefined}
      />,
    );
    const text = screen.getByTestId('market-card').textContent ?? '';
    expect(text).toContain('1 Funds (waived)');
    expect(text).toContain('2 T');
    unmount();
  });

  it('a discount on a resource the card does not charge is not shown as a saving', () => {
    // A Helping Hands use is SPENT whether or not it buys anything, so printing
    // "0 M (waived)" on a card with no Media in its price would be a player
    // spending a power for nothing because the UI told them it saved something.
    const { unmount } = render(
      <MarketStrip
        state={state}
        you={ME}
        disabled={false}
        disabledReason={null}
        armed={{ slot: 0, discounts: ['media'] }}
        onBuy={() => undefined}
      />,
    );
    const text = screen.getByTestId('market-card').textContent ?? '';
    expect(text).not.toContain('waived');
    unmount();
  });

  it('every branch of buyMarketCard either ACTS or NAMES ITS REASON', () => {
    // §9.10, pinned where jsdom cannot measure it — the same shape as
    // `powerInvariant.test.tsx`'s assertion over `onSlotActivate`. The bare
    // `if (me === undefined || slot === undefined) return;` was the silent branch
    // this whole section is about, and a bare `return` with nothing above it is
    // exactly what a future edit would put back.
    const source = gameScreenSource;
    const at = source.indexOf('function buyMarketCard(');
    expect(at, 'buyMarketCard is gone from GameScreen').toBeGreaterThan(-1);
    const body = source.slice(at, source.indexOf('\n}', at));
    const lines = body.split(/\r?\n/);
    const silent: string[] = [];
    lines.forEach((line, i) => {
      if (!/^\s*return;\s*$/.test(line)) return;
      const before = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
      if (!before.includes('setRefusal(')) silent.push(`line ${i}: ${line.trim()}`);
    });
    expect(silent, 'a branch of buyMarketCard returns without naming a reason').toEqual([]);
  });
});