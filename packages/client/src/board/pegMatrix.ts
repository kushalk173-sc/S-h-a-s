/**
 * The §4.6 peg state matrix, implemented literally.
 *
 * UI-SPEC §4.6 is NORMATIVE: "Read this table as the implementation spec." So
 * it is transcribed here as data, one cell per cell, exactly as printed — not
 * re-derived from rules. If a rule in the engine ever disagrees with this
 * table, the bug is in the table, because the table is what the spec says and
 * what the reviewer reads against.
 *
 * Rows are every combination of {empty, own, other} × {minority, majority} ×
 * {normal, volatile} — all 10. Columns are every interaction mode — all 7.
 *
 * Cell codes, from the §4.6 key:
 *   ○  hollow  — fill paper-000, stroke SEAT_FILL_n, 3px
 *   ●  solid   — fill SEAT_FILL_n, stroke ink-900, 1.5px, chevron in paper-000
 *   ◇  as ○/● but the hole is the rounded square (Volatile) + asterisk
 *   ●◇ solid in a rounded square + asterisk
 *   w  well only — stroke paper-400 1.5px, fill none
 *   w▪ volatile well — rounded square, paper-400 1.5px, ink-900 asterisk
 *   h  45° hatch, table-900 @22%, 3-unit pitch — the unavailable/illegal channel
 *   d  opacity 0.42 — "context, not option"
 *   ⌾  3px POSITIVE outer ring at r=21 — legal target
 *   ⌾* ⌾ + 4px POSITIVE tick upper-right — already chosen for this group
 *   ✕  3px NEGATIVE outer ring at r=21, h applied, d applied — illegal target
 *   ⟲  3px SEAL dashed ring at r=21, dasharray 4 3 — gerrymander source
 *   ◈  ⌾ + 2px INK_900 diagonal chevron at the disc's lower-left — legal dest
 */

import type { BoardMode, SlotInteraction } from './types';

/** Which 10 of the 3 × 2 × 2 states a slot is in. */
export type PegRow =
  | 'empty-normal' // 1
  | 'empty-volatile' // 2
  | 'own-minority-normal' // 3
  | 'own-minority-volatile' // 4
  | 'own-majority-normal' // 5
  | 'own-majority-volatile' // 6
  | 'other-minority-normal' // 7
  | 'other-minority-volatile' // 8
  | 'other-majority-normal' // 9
  | 'other-majority-volatile'; // 10

/** The seven columns of §4.6, in order. */
export type PegColumn =
  | 'idle'
  | 'place-legal'
  | 'place-illegal'
  | 'place-selected'
  | 'gerry-src'
  | 'gerry-dest-legal'
  | 'gerry-dest-illegal';

/**
 * A §4.6 cell code: the `head[+additions]` string the spec prints, e.g. `○+✕`.
 * Kept as `string` rather than a literal union on purpose — the union would be
 * 70 hand-written literals that TypeScript would reject on any typo, and the
 * point of the table is that it is a transcription, checked by
 * `board.test.tsx` which walks all 70 cells.
 */
export type PegCellCode = string;

/** The seven columns, as a fixed-length tuple, so no row can lose a column. */
export type PegCells = readonly [
  PegCellCode,
  PegCellCode,
  PegCellCode,
  PegCellCode,
  PegCellCode,
  PegCellCode,
  PegCellCode,
];

/**
 * The matrix, verbatim from §4.6. Index [row][column].
 *
 * Row 4 (`own` + minority + volatile) is `◇ + ✕` in EVERY `GERRY src`/`dest`
 * cell, and row 6 (`own` + majority + volatile) is `●◇ + ✕` in all of them —
 * a Volatile voter is permanent (rules-reference p18: cannot be gerrymandered,
 * converted, moved, evicted, discarded, or affected in any way). Row 8
 * (`other` + minority + volatile) is `◈` in `GERRY dest legal`, because you
 * may move an opponent's voter into a Volatile Area; the Headline it triggers
 * is surfaced in the tooltip and the confirm chip, not by making it illegal.
 */
export const PEG_MATRIX: Readonly<Record<PegRow, PegCells>> = {
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

/** The resolved visual state a `VoterSlot` renders. */
export type PegVisual = {
  /** The printed well — a ring, never a fill. Always present. */
  readonly well: 'circle' | 'square';
  /** The peg body on the well, or null when the slot is empty. */
  readonly body: 'minority' | 'majority' | null;
  /** Overlay rings at r=21, in draw order. */
  readonly rings: readonly PegRing[];
  /** 45° hatch overlay — the unavailable/illegal channel. Never colour alone. */
  readonly hatch: boolean;
  /** opacity 0.42 — context, not option. */
  readonly dim: boolean;
  /** The `◈` diagonal chevron at the disc's lower-left. */
  readonly destMark: boolean;
  /** The `⌾*` POSITIVE tick at the slot's upper-right. */
  readonly chosenTick: boolean;
  /** The Volatile asterisk. Additive, never the primary channel. */
  readonly asterisk: boolean;
  /** The raw cell code, for the aria-label/debug and for the test walk. */
  readonly code: string;
};

export type PegRing =
  | { readonly kind: 'legal'; readonly token: 'var(--positive)'; readonly width: 3; readonly dash: null }
  | { readonly kind: 'illegal'; readonly token: 'var(--negative)'; readonly width: 3; readonly dash: null }
  | { readonly kind: 'source'; readonly token: 'var(--seal)'; readonly width: 3; readonly dash: '4 3' };

/** Which row of the matrix a slot is in, from its facts. */
export function pegRow(input: {
  readonly peg: { readonly owner: string; readonly majority: boolean } | null;
  readonly volatile: boolean;
  readonly isOwn: boolean;
}): PegRow {
  const { peg, volatile, isOwn } = input;
  if (peg === null) return volatile ? 'empty-volatile' : 'empty-normal';
  const face = peg.majority ? 'majority' : 'minority';
  const who = isOwn ? 'own' : 'other';
  return `${who}-${face}-${volatile ? 'volatile' : 'normal'}` as PegRow;
}

/**
 * Which column of the matrix a slot is in.
 *
 * The caller never names a column. It reports the slot's legality for the
 * current mode and this function maps that onto the matrix, so the mode
 * vocabulary in the UI cannot drift from the mode vocabulary in the spec.
 */
export function pegColumn(input: {
  readonly mode: BoardMode;
  readonly interaction: SlotInteraction;
  /** A gerrymander source has been picked up: destinations now resolve. */
  readonly hasGerrySource: boolean;
  /** Resolve source legality for every slot (G3/G4 teaching). Off on mode entry. */
  readonly resolveGerrySources: boolean;
}): PegColumn {
  const { mode, interaction, hasGerrySource, resolveGerrySources } = input;
  if (mode === 'place') {
    if (interaction.chosen === true) return 'place-selected';
    return interaction.legality === 'legal' || interaction.legality === 'destination'
      ? 'place-legal'
      : 'place-illegal';
  }
  if (mode === 'gerry') {
    // A picked-up source turns the board into destination resolution (§6.2
    // "Pick up: Legal destinations resolve now").
    if (hasGerrySource) {
      return interaction.legality === 'destination' ? 'gerry-dest-legal' : 'gerry-dest-illegal';
    }
    // Otherwise the board shows source eligibility, so the two rules that
    // surprise people — majority pegs and Volatile pegs never move — are
    // visible without a tutorial. §6.2 G3/G4.
    if (resolveGerrySources) return 'gerry-src';
    return 'idle';
  }
  return 'idle';
}

/**
 * Parse a §4.6 cell code into everything a slot needs to draw itself.
 *
 * The head is not only a body/well code: §4.6 writes some cells with the
 * overlay IN the head, because the overlay is the whole point of the cell.
 * Row 1 `PLACE legal` is `⌾`, not `w+⌾`; row 2 is `⌾▪`; row 1
 * `GERRY dest legal` is `◈`; row 3 `GERRY src` is `⟲`. So the head is scanned
 * for an overlay glyph first and any remainder is read as the well/body.
 */
export function resolveCell(code: string): PegVisual {
  const parts = code.split('+');
  const head = parts[0] ?? 'w';
  const tail = parts.slice(1);

  // The well shape is carried by `▪` (empty volatile) or `◇` (occupied
  // volatile). `◇` also marks a minority body, so shape is decided by glyph
  // presence, not by the head's identity.
  const square = head.includes('▪') || head.includes('◇');
  const well: 'circle' | 'square' = square ? 'square' : 'circle';
  const asterisk = square;

  // A solid peg is written `●`; a hollow one `○` in a circle and `◇` in a
  // Volatile square. `●◇` is solid in a square.
  const body: 'minority' | 'majority' | null = head.includes('●')
    ? 'majority'
    : head.includes('○') || head.includes('◇')
      ? 'minority'
      : null;

  const rings: PegRing[] = [];
  let hatch = false;
  let dim = false;
  let destMark = false;
  let chosenTick = false;

  const apply = (part: string): void => {
    switch (part) {
      case 'h':
        hatch = true;
        break;
      case 'd':
        dim = true;
        break;
      case '⌾':
        rings.push({ kind: 'legal', token: 'var(--positive)', width: 3, dash: null });
        break;
      case '✕':
        rings.push({ kind: 'illegal', token: 'var(--negative)', width: 3, dash: null });
        // The key defines ✕ as ring + h + d together, so they are not optional.
        hatch = true;
        dim = true;
        break;
      case '⟲':
        rings.push({ kind: 'source', token: 'var(--seal)', width: 3, dash: '4 3' });
        break;
      case '◈':
        rings.push({ kind: 'legal', token: 'var(--positive)', width: 3, dash: null });
        destMark = true;
        break;
      case '⌾*':
        rings.push({ kind: 'legal', token: 'var(--positive)', width: 3, dash: null });
        chosenTick = true;
        break;
      default:
        break;
    }
  };

  // Overlays carried in the head, then the tail. `d` and `h` also lead some
  // heads — `d+w` is row 1 `GERRY src` and `d+○` is row 7 — and neither glyph
  // is a substring of any well/body glyph, so the scan is unambiguous.
  for (const glyph of ['⌾*', '◈', '⌾', '⟲', '✕', 'd', 'h']) {
    if (head.includes(glyph)) apply(glyph);
  }
  for (const part of tail) apply(part);

  return { well, body, rings, hatch, dim, destMark, chosenTick, asterisk, code };
}

/** A resolved cell plus its coordinates in the matrix, for the test walk. */
export type ResolvedPeg = PegVisual & { readonly row: PegRow; readonly column: PegColumn };

/** Resolve a slot to its exact §4.6 cell. */
export function resolvePegVisual(input: {
  readonly peg: { readonly owner: string; readonly majority: boolean } | null;
  readonly volatile: boolean;
  readonly isOwn: boolean;
  readonly mode: BoardMode;
  readonly interaction: SlotInteraction;
  readonly hasGerrySource: boolean;
  readonly resolveGerrySources: boolean;
}): ResolvedPeg {
  const row = pegRow(input);
  const column = pegColumn(input);
  const cells = PEG_MATRIX[row];
  const code = cells[PEG_COLUMN_ORDER.indexOf(column)] ?? 'w';
  return { ...resolveCell(code), row, column };
}

/** Column order, for indexing the matrix rows. */
export const PEG_COLUMN_ORDER: readonly PegColumn[] = [
  'idle',
  'place-legal',
  'place-illegal',
  'place-selected',
  'gerry-src',
  'gerry-dest-legal',
  'gerry-dest-illegal',
];
