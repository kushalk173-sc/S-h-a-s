/**
 * Board tests: the geometry helpers that need no browser, and the rendering
 * assertions that need only jsdom.
 *
 * Nothing here imports `@shasn/engine`. The board is pure presentational, so
 * every assertion is against the local geometry copy and the local type
 * mirrors — which is the whole reason the board can be verified while the
 * engine is still broken.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BOARD, BOARD_HEIGHT, BOARD_WIDTH, COASTLINE, TOTAL_AREAS } from './geometry';
import {
  LABEL_HALF_H,
  LABEL_HALF_W,
  VOLATILE_INK_R,
  buildGeometry,
  flattenSlots,
  labelAnchors,
  minCentreDistance,
  nearestSlot,
  pointInPolygon,
  stepSlot,
  toClosedPath,
  zoneAtPoint,
} from './useBoardGeometry';
import {
  PEG_COLUMN_ORDER,
  PEG_MATRIX,
  pegColumn,
  pegRow,
  resolveCell,
  resolvePegVisual,
  type PegRow,
} from './pegMatrix';
import { HIT_RECT, PEG_R, buildSlotLabel } from './VoterSlot';
import { makeZones, putPegs, PLAYERS } from './fixtures';
import { BoardSvg } from './BoardSvg';
import type { BoardState, SlotInteraction } from './types';

const geometry = buildGeometry(BOARD);

// ─────────────────────────── geometry: the real numbers ────────────────────

describe('board geometry', () => {
  it('is the real board: 1000 × 1500, 9 zones, 129 areas, 11 volatile', () => {
    expect(BOARD_WIDTH).toBe(1000);
    expect(BOARD_HEIGHT).toBe(1500);
    expect(BOARD).toHaveLength(9);
    expect(geometry.slots).toHaveLength(129);
    expect(TOTAL_AREAS).toBe(129);
    const volatile = geometry.slots.filter((s) => s.volatile).map((s) => s.areaId);
    expect(volatile).toHaveLength(11);
    // The eleven, exactly as §4.1 tabulates them.
    expect(volatile).toEqual([
      'north_west-07',
      'north-11',
      'north_east-02',
      'west-09',
      'west-16',
      'central-05',
      'east-04',
      'east-11',
      'south_west-09',
      'south-11',
      'south_east-05',
    ]);
  });

  it('majories sum to 69 of 129', () => {
    expect(BOARD.reduce((n, z) => n + z.majority, 0)).toBe(69);
  });

  it('measures a minimum centre-to-centre distance of 52.84', () => {
    // MEASURED, and the hard constraint on peg size: 48-unit hit rects cannot
    // overlap because 48 < 52.84 (§4.3 rule 2, §8.1).
    expect(geometry.minCentreDistance).toBeCloseTo(52.84, 2);
    expect(HIT_RECT).toBeLessThan(geometry.minCentreDistance);
  });

  it('keeps the slots inside the coastline margins §4.1 records', () => {
    const xs = geometry.slots.map((s) => s.x);
    const ys = geometry.slots.map((s) => s.y);
    expect(Math.min(...xs)).toBe(87);
    expect(Math.max(...xs)).toBe(915);
    expect(Math.min(...ys)).toBe(148);
    expect(Math.max(...ys)).toBe(1408);
  });

  it('traverses in ZONE_IDS order, then areaId ascending (§8.4 rule 1)', () => {
    // Lexicographic areaId order must be numeric order, because the generated
    // ids are zero-padded. If the padding ever changed, traversal would
    // silently become 1, 10, 11, 2 and the keyboard order would be nonsense.
    const north = geometry.slots.filter((s) => s.zoneId === 'north');
    expect(north.map((s) => s.indexInZone)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
    expect(geometry.slots[0]?.areaId).toBe('north_west-01');
    expect(geometry.slots.map((s) => s.traversalIndex)).toEqual(
      geometry.slots.map((_, i) => i),
    );
    // Zone order matches ZONE_IDS in state.ts:29-38.
    const zoneOrder = [...new Set(geometry.slots.map((s) => s.zoneId))];
    expect(zoneOrder).toEqual([
      'north_west',
      'north',
      'north_east',
      'west',
      'central',
      'east',
      'south_west',
      'south',
      'south_east',
    ]);
  });

  it('renders the coastline as a real closed path from the 17 COASTLINE points', () => {
    expect(COASTLINE).toHaveLength(17);
    const d = geometry.landPath;
    expect(d.startsWith('M 500 25')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // One `L` per remaining vertex.
    expect(d.split('L')).toHaveLength(17);
    expect(geometry.coastlinePath.endsWith('Z')).toBe(false);
  });

  it('builds the same slot list whether flattened fresh or through the hook model', () => {
    expect(flattenSlots(BOARD)).toHaveLength(129);
    expect(minCentreDistance(geometry.slots)).toBeCloseTo(52.84, 2);
  });
});

// ─────────────────────────── geometry: hit tests ───────────────────────────

describe('point-in-zone hit test', () => {
  it('resolves a point inside a zone to that zone', () => {
    const central = BOARD.find((z) => z.id === 'central');
    expect(central).toBeDefined();
    // The `label` anchor of every zone lies inside its own polygon by
    // construction, so it is a sound interior probe for all nine.
    for (const zone of BOARD) {
      const hit = zoneAtPoint(BOARD, zone.label);
      expect(hit?.id).toBe(zone.id);
    }
  });

  it('rejects a point outside every zone', () => {
    // (10, 10) is outside the coastline and outside all nine polygons.
    expect(zoneAtPoint(BOARD, [10, 10])).toBeNull();
    expect(zoneAtPoint(BOARD, [500, 25])).toBeNull(); // the north vertex itself
  });

  it('handles a degenerate polygon without throwing', () => {
    expect(pointInPolygon([0, 0], [])).toBe(false);
    expect(pointInPolygon([0, 0], [[1, 1]])).toBe(false);
  });

  it('closes the path so a polygon renders as a shape, not an open line', () => {
    expect(toClosedPath([])).toBe('');
    expect(toClosedPath([[0, 0], [10, 0], [10, 10]])).toBe('M 0 0 L 10 0 L 10 10 Z');
  });
});

describe('nearest-slot lookup', () => {
  it('finds the slot at a known centre', () => {
    const target = geometry.slots.find((s) => s.areaId === 'central-05');
    expect(target).toBeDefined();
    if (target === undefined) return;
    expect(nearestSlot(geometry.slots, [target.x, target.y])?.areaId).toBe('central-05');
  });

  it('snaps a slightly-off cursor to the right slot', () => {
    const target = geometry.slots.find((s) => s.areaId === 'north-11');
    if (target === undefined) throw new Error('north-11 missing');
    // 20 units away — inside the 28-unit half-width of a coarse hit rect.
    expect(nearestSlot(geometry.slots, [target.x + 20, target.y + 4], 28)?.areaId).toBe('north-11');
  });

  it('answers "no target" beyond the radius instead of snapping to the furthest', () => {
    // The coarse-pointer resolution rule (§8.1): exact point, then nearest
    // centre within 28 units, then NO target. (200, 200) is inside the
    // coastline and inside North West, but more than 28 units from every slot.
    expect(nearestSlot(geometry.slots, [200, 200], 28)).toBeNull();
  });

  it('is deterministic on a tie, taking traversal order', () => {
    // A point exactly between two slots must resolve the same way every time.
    const a = geometry.slots[0];
    const b = geometry.slots[1];
    if (a === undefined || b === undefined) throw new Error('slots missing');
    const mid: readonly [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const first = nearestSlot(geometry.slots, mid);
    for (let i = 0; i < 20; i += 1) {
      expect(nearestSlot(geometry.slots, mid)?.areaId).toBe(first?.areaId);
    }
  });
});

describe('keyboard traversal steps (§8.4 rule 2)', () => {
  it('walks all slots with ←/→ and wraps', () => {
    const first = geometry.slots[0];
    if (first === undefined) throw new Error('no slots');
    const second = stepSlot(geometry.slots, first, 'all', 1);
    expect(second?.areaId).toBe(geometry.slots[1]?.areaId);
    const wrapped = stepSlot(geometry.slots, first, 'all', -1);
    expect(wrapped?.areaId).toBe(geometry.slots[128]?.areaId);
  });

  it('stays inside the zone with ↑/↓', () => {
    const inNorth = geometry.slots.find((s) => s.areaId === 'north-10');
    if (inNorth === undefined) throw new Error('north-10 missing');
    const next = stepSlot(geometry.slots, inNorth, 'zone', 1);
    expect(next?.zoneId).toBe('north');
    // North has 21 slots, so stepping +1 from 10 is 11, not a wrap to North West.
    expect(next?.indexInZone).toBe(11);
  });
});

// ─────────────────── the §4.6 matrix, walked cell by cell ──────────────────

const ALL_ROWS: readonly PegRow[] = [
  'empty-normal',
  'empty-volatile',
  'own-minority-normal',
  'own-minority-volatile',
  'own-majority-normal',
  'own-majority-volatile',
  'other-minority-normal',
  'other-minority-volatile',
  'other-majority-normal',
  'other-majority-volatile',
];

/** The table exactly as §4.6 prints it, for a literal diff. */
const SPEC_TABLE: Readonly<Record<PegRow, readonly string[]>> = {
  'empty-normal': ['w', '⌾', 'w+h', 'w+⌾*', 'd+w', '◈', 'w+h'],
  'empty-volatile': ['w▪', '⌾▪', 'w▪+h', 'w▪+⌾*', 'd+w▪', '◈▪', 'w▪+h'],
  'own-minority-normal': ['○', '○+⌾', '○+✕', '○+⌾*', '⟲', '○+◈', '○+✕'],
  'own-minority-volatile': ['◇', '◇+⌾', '◇+✕', '◇+⌾*', '◇+✕', '◇+✕', '◇+✕'],
  'own-majority-normal': ['●', '●+✕', '●+✕', '●+✕', '●+✕', '●+✕', '●+✕'],
  'own-majority-volatile': ['●◇', '●◇+✕', '●◇+✕', '●◇+✕', '●◇+✕', '●◇+✕', '●◇+✕'],
  'other-minority-normal': ['○', '○+✕', '○+✕', '○+✕', 'd+○', '○+◈', '○+✕'],
  'other-minority-volatile': ['◇', '◇+✕', '◇+✕', '◇+✕', 'd+◇', '◇+◈', '◇+✕'],
  'other-majority-normal': ['●', '●+✕', '●+✕', '●+✕', 'd+●', '●+◈', '●+✕'],
  'other-majority-volatile': ['●◇', '●◇+✕', '●◇+✕', '●◇+✕', 'd+●◇', '●◇+◈', '●◇+✕'],
};

describe('§4.6 peg state matrix', () => {
  it('has 10 rows × 7 columns and matches the spec table exactly', () => {
    expect(ALL_ROWS).toHaveLength(10);
    expect(PEG_COLUMN_ORDER).toHaveLength(7);
    for (const row of ALL_ROWS) {
      const cells = PEG_MATRIX[row];
      expect(cells, `${row} has no row`).toBeDefined();
      expect(cells, `${row} must have 7 cells`).toHaveLength(7);
      for (const [i, code] of cells.entries()) {
        const column = PEG_COLUMN_ORDER[i] ?? 'idle';
        expect(code, `${row} / ${column}`).toBe(SPEC_TABLE[row][i]);
      }
    }
  });

  it('resolves every one of the 70 cells into a drawable visual', () => {
    for (const row of ALL_ROWS) {
      for (const [i, code] of PEG_MATRIX[row].entries()) {
        const column = PEG_COLUMN_ORDER[i] ?? 'idle';
        const head = (code ?? '').split('+')[0] ?? '';
        const visual = resolveCell(code ?? '');
        const where = `${row} / ${column} (${code})`;

        // Shape: the Volatile slot is a rounded square in EVERY cell, at every
        // scale, in greyscale, and it never collides with a seat colour (§4.5).
        expect(visual.well, `${where} shape`).toBe(head.includes('▪') || head.includes('◇') ? 'square' : 'circle');
        expect(visual.asterisk, `${where} asterisk`).toBe(visual.well === 'square');

        // Fill: solid vs hollow is the primary channel and the single most
        // important decision in the board spec.
        expect(visual.body, `${where} body`).toBe(
          head.startsWith('●') ? 'majority' : head === '○' || head === '◇' ? 'minority' : null,
        );

        // Rings.
        const kinds = visual.rings.map((r) => r.kind);
        const hasPositive = kinds.includes('legal');
        const hasNegative = kinds.includes('illegal');
        const hasSource = kinds.includes('source');

        if (code?.includes('✕')) {
          // The key defines ✕ as ring + hatch + dim together. Never colour alone.
          expect(hasNegative, `${where} needs a NEGATIVE ring`).toBe(true);
          expect(visual.hatch, `${where} needs the hatch`).toBe(true);
          expect(visual.dim, `${where} needs the dim`).toBe(true);
        }
        if (code?.includes('⌾') || code?.includes('◈')) {
          expect(hasPositive, `${where} needs a POSITIVE ring`).toBe(true);
        }
        if (code?.includes('⟲')) {
          expect(hasSource, `${where} needs the SEAL source ring`).toBe(true);
          const ring = visual.rings.find((r) => r.kind === 'source');
          // A dashed ring, not a solid one — shape distinguishes it from ⌾.
          expect(ring?.dash, `${where} source ring must be dashed`).toBe('4 3');
        }
        if (code?.includes('◈')) expect(visual.destMark, `${where} dest mark`).toBe(true);
        if (code?.includes('⌾*')) expect(visual.chosenTick, `${where} chosen tick`).toBe(true);
        if (code?.includes('h')) expect(visual.hatch, `${where} hatch`).toBe(true);
        if (code?.includes('d')) expect(visual.dim, `${where} dim`).toBe(true);
        if (!code?.includes('h') && !code?.includes('✕')) {
          expect(visual.hatch, `${where} must not be hatched`).toBe(false);
        }
        if (!code?.includes('d') && !code?.includes('✕')) {
          expect(visual.dim, `${where} must not be dimmed`).toBe(false);
        }
      }
    }
  });

  it('routes each mode to the right column', () => {
    const neutral: SlotInteraction = { legality: 'neutral' };
    expect(pegColumn({ mode: 'idle', interaction: neutral, hasGerrySource: false, resolveGerrySources: true })).toBe('idle');
    expect(pegColumn({ mode: 'place', interaction: { legality: 'legal' }, hasGerrySource: false, resolveGerrySources: false })).toBe('place-legal');
    expect(pegColumn({ mode: 'place', interaction: { legality: 'illegal' }, hasGerrySource: false, resolveGerrySources: false })).toBe('place-illegal');
    expect(pegColumn({ mode: 'place', interaction: { legality: 'chosen', chosen: true }, hasGerrySource: false, resolveGerrySources: false })).toBe('place-selected');
    // On mode entry nothing resolves, so the board does not flash (§6.2).
    expect(pegColumn({ mode: 'gerry', interaction: neutral, hasGerrySource: false, resolveGerrySources: false })).toBe('idle');
    expect(pegColumn({ mode: 'gerry', interaction: neutral, hasGerrySource: false, resolveGerrySources: true })).toBe('gerry-src');
    // A picked-up source flips the whole board to destination resolution.
    expect(pegColumn({ mode: 'gerry', interaction: { legality: 'destination' }, hasGerrySource: true, resolveGerrySources: true })).toBe('gerry-dest-legal');
    expect(pegColumn({ mode: 'gerry', interaction: { legality: 'not-destination' }, hasGerrySource: true, resolveGerrySources: true })).toBe('gerry-dest-illegal');
  });

  it('routes each occupancy/face/slot fact to the right row', () => {
    const mine = { owner: 'p1', majority: false };
    expect(pegRow({ peg: null, volatile: false, isOwn: false })).toBe('empty-normal');
    expect(pegRow({ peg: null, volatile: true, isOwn: false })).toBe('empty-volatile');
    expect(pegRow({ peg: mine, volatile: false, isOwn: true })).toBe('own-minority-normal');
    expect(pegRow({ peg: mine, volatile: true, isOwn: true })).toBe('own-minority-volatile');
    expect(pegRow({ peg: { ...mine, majority: true }, volatile: false, isOwn: true })).toBe('own-majority-normal');
    expect(pegRow({ peg: { ...mine, majority: true }, volatile: true, isOwn: true })).toBe('own-majority-volatile');
    expect(pegRow({ peg: { ...mine, owner: 'p2' }, volatile: false, isOwn: false })).toBe('other-minority-normal');
    expect(pegRow({ peg: { ...mine, owner: 'p2' }, volatile: true, isOwn: false })).toBe('other-minority-volatile');
  });

  it('end-to-end: an armed gerrymander source in a volatile area is hatched, not offered', () => {
    // Row 4 of §4.6 — the one cell where a player owns something they still
    // cannot use, so it gets the hatch rather than just a dim.
    const visual = resolvePegVisual({
      peg: { owner: 'p1', majority: false },
      volatile: true,
      isOwn: true,
      mode: 'gerry',
      interaction: { legality: 'neutral', gerrySource: 'blocked' },
      hasGerrySource: false,
      resolveGerrySources: true,
    });
    expect(visual.code).toBe('◇+✕');
    expect(visual.hatch).toBe(true);
    expect(visual.dim).toBe(true);
    expect(visual.well).toBe('square');
  });
});

// ───────────────────────────── slot labels (§8.5) ──────────────────────────

describe('accessible slot labels', () => {
  const seats = {
    fill: (id: string) => `var(--seat-${id === 'p1' ? 1 : 2})`,
    name: (id: string) => (id === 'p1' ? 'Ria' : 'Dev'),
  };
  const slot = geometry.slotById.get('north-11');
  if (slot === undefined) throw new Error('north-11 missing');

  it('names the volatile area, its occupant, and permanence', () => {
    const label = buildSlotLabel({
      slot,
      peg: null,
      isOwn: false,
      zoneMajority: 11,
      interaction: { legality: 'neutral' },
      seats,
    });
    expect(label).toBe(
      'North, slot 11, Volatile Area, empty. A voter here is permanent and triggers a Headline. Permanent — Volatile Area.',
    );
  });

  it('names an empty normal slot with the majority requirement', () => {
    const volatile = geometry.slotById.get('north_west-07');
    const normal = geometry.slotById.get('north_west-08');
    if (volatile === undefined || normal === undefined) throw new Error('slots missing');
    const label = buildSlotLabel({
      slot: normal,
      peg: null,
      isOwn: false,
      zoneMajority: 6,
      interaction: { legality: 'neutral' },
      seats,
    });
    expect(label).toBe(
      'North West, slot 8, empty. Need 6 to hold this constituency. Gerrymanderable.',
    );
    expect(volatile.volatile).toBe(true);
  });

  it('names occupant, face, and points', () => {
    const minority = buildSlotLabel({
      slot,
      peg: { owner: 'p1', majority: false },
      isOwn: true,
      zoneMajority: 11,
      interaction: { legality: 'neutral' },
      seats,
    });
    expect(minority).toBe(
      'North, slot 11, Volatile Area, Your voter, minority. Worth 0 points. Permanent — Volatile Area.',
    );

    // §8.5's own example, on the slot it names: central-05 is a Volatile Area,
    // so the label carries BOTH the points and the permanence.
    const majority = buildSlotLabel({
      slot: geometry.slotById.get('central-05') ?? slot,
      peg: { owner: 'p1', majority: true },
      isOwn: true,
      zoneMajority: 5,
      interaction: { legality: 'neutral' },
      seats,
    });
    expect(majority).toBe(
      'Central, slot 5, Volatile Area, Your voter, majority. Worth 1 point; not gerrymanderable. Permanent — Volatile Area.',
    );

    const opponent = buildSlotLabel({
      slot: geometry.slotById.get('south-09') ?? slot,
      peg: { owner: 'p2', majority: true },
      isOwn: false,
      zoneMajority: 11,
      interaction: { legality: 'neutral' },
      seats,
    });
    expect(opponent).toBe(
      "South, slot 9, Dev's voter, majority. Worth 1 point; not gerrymanderable.",
    );
  });

  it('appends exactly one mode clause, and an illegal one always names its reason', () => {
    const legal = buildSlotLabel({
      slot,
      peg: null,
      isOwn: false,
      zoneMajority: 11,
      interaction: { legality: 'legal' },
      seats,
    });
    expect(legal.endsWith('· legal target')).toBe(true);

    const illegal = buildSlotLabel({
      slot,
      peg: null,
      isOwn: false,
      zoneMajority: 11,
      interaction: { legality: 'illegal', reason: 'different zone, these voters must share one' },
      seats,
    });
    expect(illegal.endsWith('· illegal: different zone, these voters must share one')).toBe(true);

    const bare = buildSlotLabel({
      slot,
      peg: null,
      isOwn: false,
      zoneMajority: 11,
      interaction: { legality: 'illegal' },
      seats,
    });
    // Even with no reason supplied, it never reads as a bare "illegal".
    expect(bare.endsWith('· illegal: not a legal target')).toBe(true);
  });
});

// ─────────────────────────── rendering the board ───────────────────────────

function stateFor(over: Partial<BoardState> = {}): BoardState {
  return {
    zones: makeZones(),
    activePlayerId: 'p1',
    mode: 'idle',
    players: PLAYERS,
    ...over,
  };
}

describe('<BoardSvg />', () => {
  it('renders 129 distinct labelled hit targets', () => {
    const { container } = render(<BoardSvg state={stateFor()} />);
    const groups = container.querySelectorAll('g[role="button"]');
    expect(groups).toHaveLength(129);

    const ids = [...groups].map((g) => g.getAttribute('data-area-id'));
    expect(new Set(ids).size).toBe(129);

    // Every one is a distinct, non-empty accessible name, and every one begins
    // with its zone name so SC 2.5.3 Label in Name holds.
    const labels = [...groups].map((g) => g.getAttribute('aria-label') ?? '');
    expect(new Set(labels).size).toBe(129);
    for (const [i, label] of labels.entries()) {
      expect(label.length, `slot ${String(ids[i])} has a label`).toBeGreaterThan(10);
      expect(label.startsWith('North West, slot ')).toBe(i < 11);
    }

    // 48-unit hit rects on all 129, and 48 < 52.84 so none can overlap.
    const hits = container.querySelectorAll('g[role="button"] rect[data-testid="hit-rect"]');
    expect(hits).toHaveLength(129);
    for (const hit of hits) {
      expect(hit.getAttribute('width')).toBe('48');
      expect(hit.getAttribute('height')).toBe('48');
      expect(hit.getAttribute('fill')).toBe('transparent');
    }
  });

  it('renders one rosette and one asterisk per Volatile Area, and no more', () => {
    const { container } = render(<BoardSvg state={stateFor()} />);
    expect(container.querySelectorAll('[data-testid="volatile-rosette"]')).toHaveLength(11);
    expect(container.querySelectorAll('[data-testid="volatile-asterisk"]')).toHaveLength(11);
  });

  it('draws the contour-map ground from the real coastline, with zone borders and no zone fill', () => {
    const { container } = render(<BoardSvg state={stateFor()} />);

    // Ground, land, and a single confident coastline.
    const sheet = container.querySelector('[data-testid="board-sheet"]');
    expect(sheet?.getAttribute('fill')).toBe('var(--map-ground)');
    const land = container.querySelector('[data-testid="land-fill"]');
    expect(land?.getAttribute('d')).toBe(geometry.landPath);
    expect(land?.getAttribute('fill')).toBe('var(--map-land)');
    const coast = container.querySelector('[data-testid="coastline"]');
    expect(coast?.getAttribute('stroke')).toBe('var(--map-border)');
    expect(coast?.getAttribute('stroke-width')).toBe('2.5');

    // The contour texture: fine concentric lines, clipped to the land.
    expect(container.querySelectorAll('[data-testid="contour"]').length).toBeGreaterThan(40);
    const clipped = container.querySelector('[data-testid="land"] g[clip-path]');
    expect(clipped?.getAttribute('clip-path')).toBe('url(#shasn-land-clip)');

    // Zone borders with NO fill. Only `central` is filled, because the real
    // board draws it as a printed olive inset with a heavier border.
    const outlines = container.querySelectorAll('.shasn-zone-outline');
    expect(outlines).toHaveLength(9);
    for (const zone of BOARD) {
      const g = container.querySelector(`.shasn-zone-outline[data-zone-id="${zone.id}"]`);
      const isCentral = zone.id === 'central';
      const wantWidth = isCentral ? '6' : '4';
      const borders = [...(g?.querySelectorAll(`path[stroke-width="${wantWidth}"]`) ?? [])].filter(
        (p) => p.getAttribute('fill') === (isCentral ? 'var(--map-central)' : 'none'),
      );
      expect(borders.length, `${zone.id} has one ${wantWidth}px border`).toBe(1);
      // Nothing else in the zone group is a filled polygon, so the contour
      // texture runs uninterrupted through it. `central` is the one exception:
      // the real board draws it as a printed olive inset.
      const filled = [...(g?.querySelectorAll('path[fill]:not([fill="none"])') ?? [])].filter((p) => {
        if ((p.getAttribute('fill-opacity') ?? '1') === '0.08') return false;
        return !(isCentral && p.getAttribute('fill') === 'var(--map-central)');
      });
      expect(filled.length, `${zone.id} has no zone fill`).toBe(0);
    }
    expect(container.querySelectorAll('[data-testid="central-fill"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="central-dashed"]')).not.toBeNull();
  });

  it('uses the darkened amber for seat 3, not the printed #E0A020', () => {
    const zones = putPegs(makeZones(), [['north-01', 'p3']]);
    const { container } = render(<BoardSvg state={stateFor({ zones })} />);
    // The peg body, not the well: the hollow peg is the 3px-stroked circle.
    const peg = container.querySelector(
      'g[role="button"][data-area-id="north-01"] circle[stroke-width="3"]',
    );
    expect(peg?.getAttribute('stroke')).toBe('var(--seat-3)');
    expect(peg?.getAttribute('fill')).toBe('var(--paper-000)');
  });

  it('gives a held majority three simultaneous channels, none of them colour alone', () => {
    const zones = putPegs(
      makeZones(),
      Array.from({ length: 6 }, (_, i): readonly [string, string] => [`central-0${i + 1}`, 'p1']),
    );
    const { container } = render(<BoardSvg state={stateFor({ zones })} />);
    // (a) 3px seat border on the zone
    const border = container.querySelector('[data-testid="held-border"]');
    expect(border?.getAttribute('stroke-width')).toBe('3');
    expect(border?.getAttribute('stroke')).toBe('var(--seat-1)');
    // (b) the filled seal disc
    expect(container.querySelectorAll('[data-testid="seal-disc"]').length).toBeGreaterThanOrEqual(1);
    // (c) the literal holder line
    const holder = container.querySelector('[data-role="zone-holder"]');
    expect(holder?.textContent).toContain('RIA');
    // And the flipped pegs: exactly `majority` of them are solid. Four are
    // circles and one — central-05 — is a Volatile rounded square, because
    // recount flips Volatile pegs first (they are immovable anyway).
    const inCentral = container.querySelectorAll('g[role="button"][data-zone-id="central"]');
    const solidShapes = [...inCentral].filter(
      (g) => g.querySelector('circle[stroke="var(--ink-900)"]') !== null || g.querySelector('rect[stroke="var(--ink-900)"]') !== null,
    );
    expect(solidShapes).toHaveLength(5);
    const solidInVolatile = solidShapes.find((g) => g.getAttribute('data-area-id') === 'central-05');
    expect(solidInVolatile?.querySelector('rect[stroke="var(--ink-900)"]')).not.toBeNull();
  });

  it('states a tie explicitly rather than showing nothing (§4.4, G1)', () => {
    const zones = putPegs(makeZones(), [
      ['west-01', 'p1'],
      ['west-02', 'p2'],
      ['west-03', 'p1'],
      ['west-04', 'p2'],
    ]);
    const { container } = render(<BoardSvg state={stateFor({ zones, mode: 'gerry' })} />);
    const noRights = container.querySelector('g[data-zone-id="west"] [data-role="no-rights"]');
    expect(noRights).not.toBeNull();
    expect(noRights?.textContent).toContain('no rights');
    // Both rights states are rendered in the mode; absence is never the signal.
    const badges = [...container.querySelectorAll('[data-role="rights-badge"]')].map((b) => b.textContent ?? '');
    expect(badges).toHaveLength(9);
    expect(badges.every((b) => b.includes('RIGHTS'))).toBe(true);
  });

  it('shows both legal and illegal destinations during a gerrymander', () => {
    const zones = putPegs(makeZones(), [
      ['north-01', 'p1'],
      ['north-02', 'p1'],
      ['north-03', 'p2'],
    ]);
    const { container } = render(
      <BoardSvg state={stateFor({ zones, mode: 'gerry', gerrySourceAreaId: 'north-01' })} />,
    );

    // An empty slot is a legal destination: POSITIVE ring + the ◈ mark.
    const dest = container.querySelector('g[data-area-id="north-04"]');
    expect(dest?.getAttribute('data-cell')).toBe('◈');
    expect(dest?.querySelector('[data-testid="ring-legal"]')).not.toBeNull();
    expect(dest?.querySelector('[data-testid="dest-mark"]')).not.toBeNull();

    // §6.2's surprise, made visible: you may gerrymander ANY player's voters,
    // including theirs, so an opponent's non-majority peg is ALSO a legal
    // destination (row 7, `○+◈`).
    const theirs = container.querySelector('g[data-area-id="north-03"]');
    expect(theirs?.getAttribute('data-cell')).toBe('○+◈');

    // Dropping on a slot you occupy with your own voter is illegal — the
    // engine's rule is a move, not a swap — so it gets ✕ + hatch + dim.
    const mine = container.querySelector('g[data-area-id="north-02"]');
    expect(mine?.getAttribute('data-cell')).toBe('○+✕');
    expect(mine?.querySelector('[data-testid="ring-illegal"]')).not.toBeNull();
    expect(mine?.querySelector('[data-testid="hatch"]')).not.toBeNull();
    expect(mine?.getAttribute('style')).toContain('0.42');
    expect(mine?.getAttribute('aria-label')).toContain('you already hold that slot');

    // The POSITIVE adjacency seam on the source zone and its neighbours.
    expect(container.querySelectorAll('[data-testid="adjacency-seam"]').length).toBeGreaterThan(0);
  });

  it('narrows placement to one zone once a sameZone group is locked (§6.1.2)', () => {
    const { container } = render(
      <BoardSvg state={stateFor({ mode: 'place', lockedZoneId: 'central' })} />,
    );
    expect(container.querySelector('g[data-area-id="central-01"]')?.getAttribute('data-cell')).toBe('⌾');
    const outside = container.querySelector('g[data-area-id="north-01"]');
    expect(outside?.getAttribute('data-cell')).toBe('w+h');
    expect(outside?.getAttribute('aria-label')).toContain('different zone, these voters must share one');
    expect(container.querySelector('[data-role="one-zone"]')).not.toBeNull();
  });

  it('renders a chosen pick as ⌾* with a tick', () => {
    const { container } = render(
      <BoardSvg state={stateFor({ mode: 'place', pickedAreaIds: ['central-01'] })} />,
    );
    const chosen = container.querySelector('g[data-area-id="central-01"]');
    expect(chosen?.getAttribute('data-cell')).toBe('w+⌾*');
    expect(chosen?.querySelector('[data-testid="chosen-tick"]')).not.toBeNull();
  });

  it('is one Tab stop, not 129, when it is not your turn', () => {
    const on = render(<BoardSvg state={stateFor()} />);
    const tabbable = on.container.querySelectorAll('g[role="button"][tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    on.unmount();

    // DISABLED: no tab stops at all, aria-disabled, and no hover lift.
    const off = render(<BoardSvg state={stateFor({ disabled: true })} />);
    expect(off.container.querySelectorAll('g[role="button"][tabindex="0"]')).toHaveLength(0);
    expect(off.container.querySelector('svg')?.getAttribute('aria-disabled')).toBe('true');
    expect(off.container.querySelectorAll('g[role="button"][aria-disabled="true"]')).toHaveLength(129);
    off.unmount();
  });

  it('uses a 17-unit peg radius, inside the 52.84 minimum centre distance', () => {
    expect(PEG_R).toBe(17);
    // 2r + hit rect would collide if the hit rect were ≥ the min distance.
    expect(HIT_RECT).toBeLessThan(geometry.minCentreDistance);
  });
});

/**
 * THE ZONE LABEL MUST CLEAR THE INK, NOT THE SLOT'S CENTRE.
 *
 * A defect found by cropping the real render at 4x and reading the pixels:
 * NORTH's tally chip `0/21` had a Volatile rosette drawn straight through it �
 * the cog's ring cutting `0/2`, its asterisk sitting on the `1`. The printed
 * fraction is the board's primary information, so a cog through it is an
 * unreadable board, not a cosmetic overlap.
 *
 * The cause was in the anchor search, and it was a real modelling error rather
 * than a tolerance that was simply too small. `labelAnchors` counted a slot as
 * an obstacle only when the slot's CENTRE fell inside the label's footprint.
 * That is right for a voter dot, which is essentially all at its centre, and
 * wrong for a rosette: `VolatileRosette` draws a ring reaching
 * `VOLATILE_INK_R` units out from that centre, so a label could be placed
 * "clear of every slot" and still have a cog through its numerals. The geometry
 * said clear and the pixels said otherwise, which is the only kind of evidence
 * worth acting on for a board.
 */
describe('the zone label anchor reserves room for a rosette, not just for a dot', () => {
  const slots = flattenSlots(BOARD);
  const anchors = labelAnchors(BOARD, slots);

  it('agrees with the rosette about how far its own ink reaches', () => {
    // If these two drift apart the anchor search silently under-reserves again.
    // `VolatileRosette`'s default `outerRadius` is 27.
    expect(VOLATILE_INK_R).toBe(27);
  });

it('clears the rosette ink from the two zones the play session reported', () => {
    // NORTH and NORTH WEST are the two measured with a cog on the glyphs. Named
    // so a regression names itself.
    for (const id of ['north', 'north_west']) {
      const anchor = anchors.get(id);
      expect(anchor, `${id} must have an anchor`).toBeDefined();
      if (anchor === undefined) continue;
      const [ax, ay] = anchor;
      const hits = slots.filter(
        (s) =>
          s.volatile &&
          s.zoneId === id &&
          Math.abs(s.x - ax) - VOLATILE_INK_R <= LABEL_HALF_W &&
          Math.abs(s.y - ay) - VOLATILE_INK_R <= LABEL_HALF_H,
      );
      expect(hits.map((s) => s.areaId), `${id} must have no rosette on its label`).toEqual([]);
    }
  });

  it('does not make the two geometrically impossible zones any worse', () => {
    /*
     * AN HONEST LIMIT, PINNED SO IT CANNOT DECAY.
     *
     * `central` and `south_west` cannot be fully cleared, and no amount of work
     * on this function will change that. `labelAnchors` only moves a label to a
     * point inside its own polygon with at most one sample point of overhang;
     * `central` is a 200x240 diamond and `south_west` a narrow wedge, so the
     * measured result is that `central`'s best candidate is its ORIGINAL spec
     * anchor (0 units of movement — there is nowhere else legal to put it) and
     * `south_west` still has a rosette inside the box after moving 100 units.
     *
     * So these two are carried by the paper halo rather than by geometry, which
     * is the documented fallback and is why the halo exists at all. What this
     * assertion does is pin the WORST remaining case: if a future change makes
     * the intrusion larger, or moves a label further from its spec, this fails.
     * Asserting zero here would be asserting a falsehood, and a gate that has
     * to be deleted to go green is worse than no gate.
     */
    const worst: Record<string, { maxIntrusion: number; maxMove: number }> = {
      central: { maxIntrusion: 92, maxMove: 0 },
      south_west: { maxIntrusion: 51, maxMove: 100 },
    };
    for (const [id, limit] of Object.entries(worst)) {
      const zone = BOARD.find((z) => z.id === id);
      const anchor = anchors.get(id);
      expect(zone, `${id} must exist`).toBeDefined();
      expect(anchor, `${id} must have an anchor`).toBeDefined();
      if (zone === undefined || anchor === undefined) continue;
      const [ax, ay] = anchor;
      let worstIntrusion = 0;
      for (const s of slots) {
        if (!s.volatile || s.zoneId !== id) continue;
        const dx = LABEL_HALF_W - (Math.abs(s.x - ax) - VOLATILE_INK_R);
        const dy = LABEL_HALF_H - (Math.abs(s.y - ay) - VOLATILE_INK_R);
        if (dx > 0 && dy > 0) worstIntrusion = Math.max(worstIntrusion, Math.min(dx, dy));
      }
      expect(
        worstIntrusion,
        `${id}'s worst rosette intrusion grew past the measured limit`,
      ).toBeLessThanOrEqual(limit.maxIntrusion);
      expect(
        Math.round(Math.hypot(ax - zone.label[0], ay - zone.label[1])),
        `${id}'s label moved further from its spec than the measured limit`,
      ).toBeLessThanOrEqual(limit.maxMove);
    }
  });

  it('every label still stays inside its own constituency and near its spec anchor', () => {
    // The rosette clearance must not be bought by moving a label somewhere it
    // does not belong: that would be a worse defect than the one being fixed.
    for (const zone of BOARD) {
      const anchor = anchors.get(zone.id);
      expect(anchor).toBeDefined();
      if (anchor === undefined) continue;
      expect(
        pointInPolygon(anchor, zone.poly),
        `${zone.id}'s anchor left its own constituency`,
      ).toBe(true);
      const [dx, dy] = zone.label;
      expect(Math.hypot(anchor[0] - dx, anchor[1] - dy)).toBeLessThanOrEqual(150);
    }
  });

  it('is deterministic, so two renders of the same board agree', () => {
    const again = labelAnchors(BOARD, slots);
    for (const zone of BOARD) {
      expect(again.get(zone.id)).toEqual(anchors.get(zone.id));
    }
  });
});
