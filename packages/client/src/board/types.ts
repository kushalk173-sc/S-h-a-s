/**
 * Local prop types for the Shasn board.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The board component is *pure presentational*: it takes geometry and peg
 * state through typed props and imports NOTHING from `@shasn/engine`. The
 * engine is mid-repair and does not currently compile, and coupling the client
 * to it would block the entire board. So the shapes the board needs are
 * mirrored here.
 *
 * THESE TYPES MUST STAY STRUCTURALLY COMPATIBLE WITH THE ENGINE
 * -----------------------------------------------------------
 * Every type below mirrors a type in `packages/engine/src/`:
 *
 *   local                  mirrors
 *   ─────────────────────  ──────────────────────────────────────────
 *   BoardZoneID            state.ts:18  ZoneID
 *   Peg                    state.ts:81  Peg
 *   Area                   state.ts:87  Area
 *   BoardZone              state.ts:95  Zone
 *   ZoneSpec               board.generated.ts:17  ZoneSpec
 *   AreaSpec               board.generated.ts:10  AreaSpec
 *
 * The engine marks all of these fields `readonly`, and so are these. That is
 * load-bearing, not cosmetic: it is what lets a caller pass an engine `Zone`
 * straight through without a cast, because TS structural typing accepts a
 * readonly source into a readonly target. If a field is widened to mutable
 * here, an engine value stops being assignable and the wiring step below
 * stops being mechanical.
 *
 * HOW TO VERIFY THE MIRROR (runtime-free, no cast, no `as`)
 * ------------------------------------------------------------
 * Once the engine compiles, the following is the whole verification. Add it
 * to a test file — it is type-level only, so it needs no runtime and no
 * engine `instanceof`:
 *
 *   import type {
 *     Area as EngineArea, Zone as EngineZone, Peg as EnginePeg,
 *     ZoneID as EngineZoneID,
 *   } from '@shasn/engine';
 *   import type { Area, BoardZone, Peg, BoardZoneID } from './types';
 *
 *   // Fails to compile if the mirror drifts in either direction.
 *   const _area: Area = {} as EngineArea;
 *   const _zone: BoardZone = {} as EngineZone;
 *   const _peg:  Peg  = {} as EnginePeg;
 *   const _zid:  BoardZoneID = {} as EngineZoneID;
 *
 * The same check must also run the other way, because assignability is not
 * symmetric when readonly is involved:
 *
 *   const _back: EngineArea = {} as Area;
 *
 * Both directions green ⇒ the board can consume engine state with no cast.
 * Until the engine compiles, `packages/client` deliberately has no reference
 * to it, so this file is the only place that would break — by design.
 */

/** Mirrors `state.ts:18` ZoneID. Fixed nine, not procedurally generated. */
export type BoardZoneID =
  | 'north_west'
  | 'north'
  | 'north_east'
  | 'west'
  | 'central'
  | 'east'
  | 'south_west'
  | 'south'
  | 'south_east';

/**
 * Mirrors `state.ts:81` Peg.
 * `majority` is the physical act of flipping the peg symbol-side up (p8).
 */
export type Peg = {
  readonly owner: string;
  readonly majority: boolean;
};

/** Mirrors `state.ts:87` Area. */
export type Area = {
  readonly id: string;
  readonly zone: BoardZoneID;
  /** p18. A peg here is permanent and triggers a Headline when placed. */
  readonly volatile: boolean;
  readonly peg: Peg | null;
};

/** Mirrors `state.ts:95` Zone. */
export type BoardZone = {
  readonly id: BoardZoneID;
  readonly name: string;
  /** Voters one player needs to take the zone. Numerator of the printed fraction. */
  readonly majority: number;
  /** Total areas. Denominator of the printed fraction. */
  readonly capacity: number;
  readonly neighbours: readonly BoardZoneID[];
  readonly areas: readonly Area[];
  /** Who currently holds the majority here, or null. Derived; cached for the UI. */
  readonly majorityHolder: string | null;
};

/** Mirrors `board.generated.ts:10` AreaSpec. */
export type AreaSpec = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly volatile: boolean;
};

/** Mirrors `board.generated.ts:17` ZoneSpec. */
export type ZoneSpec = {
  readonly id: BoardZoneID;
  readonly name: string;
  readonly majority: number;
  readonly capacity: number;
  readonly neighbours: readonly BoardZoneID[];
  /** Polygon outline in board coordinates. */
  readonly poly: readonly (readonly [number, number])[];
  /** Where to anchor the "6/11" label block. */
  readonly label: readonly [number, number];
  readonly areas: readonly AreaSpec[];
};

/** A `[x, y]` pair in board coordinates. */
export type Point = readonly [number, number];

/**
 * A player's public identity. Mirrors the parts of `state.ts` PlayerState the
 * board is allowed to know: a seat colour index and a display name. The board
 * never needs resources, manifesto, or pending groups.
 */
export type BoardPlayer = {
  readonly id: string;
  /** Display name, e.g. `RIA`. Shown in zone labels and peg labels. */
  readonly name: string;
  /**
   * 1–5, the index into the five seat colours. This is the *identity* slot;
   * the render fill is `--seat-N` (see tokens.css §2.5 for why seat 3 is
   * darkened on light surfaces).
   */
  readonly seat: 1 | 2 | 3 | 4 | 5;
};

/**
 * The interaction mode the board is currently in. This is the column axis of
 * the §4.6 peg state matrix, and it is exhaustive on purpose: adding a mode
 * here is a change to the normative matrix, not an additive refactor.
 */
export type BoardMode =
  /** §4.6 column 1. No preview; hover shows a read-only tooltip only. */
  | 'idle'
  /** §4.6 columns 2–4. Placing a pending voter group. */
  | 'place'
  /** §4.6 columns 5–7. Gerrymandering. */
  | 'gerry';

/** Where a slot sits within the current mode, for the `aria-label` clause (§8.5). */
export type SlotLegality =
  /** Neutral. No clause appended. */
  | 'neutral'
  /** ` · legal target` */
  | 'legal'
  /** ` · illegal: <reason>` — a refusal always names its reason (§6.1.2). */
  | 'illegal'
  /** ` · already chosen for this group` */
  | 'chosen'
  /** ` · gerrymander source` */
  | 'source'
  /** ` · not a legal destination` */
  | 'not-destination'
  /** ` · legal destination` */
  | 'destination';

/** Per-slot interaction inputs the matrix needs but cannot derive itself. */
export type SlotInteraction = {
  /** Is this slot a legal target in the current mode? Drives `⌾` / `◈` / `✕`. */
  readonly legality: SlotLegality;
  /** Why it is illegal. Rendered in the tooltip and the aria-label, never swallowed. */
  readonly reason?: string;
  /** Already picked for the group in progress. Drives the `⌾*` tick. */
  readonly chosen?: boolean;
  /**
   * The `PLAYER src` / `⟲` state. Row 4 and 6 of §4.6 are `own` + volatile and
   * majority, which are `✕` in `GERRY src` — a hatch, not just a dim, because
   * they are the cells where a player owns something they still cannot use.
   */
  readonly gerrySource?: 'eligible' | 'blocked';
};

/** Everything the board needs that is not geometry. */
export type BoardState = {
  /** One entry per zone, in `ZONE_IDS` order (§8.4 traversal order). */
  readonly zones: readonly BoardZone[];
  /** The player whose decision it is. Drives `own` vs `other` in the matrix. */
  readonly activePlayerId: string;
  /** The current mode. Column axis of the §4.6 matrix. */
  readonly mode: BoardMode;
  /** Known players, for seat colours and display names. */
  readonly players: readonly BoardPlayer[];
  /**
   * Not your turn. §4.6 "Non-slot states": whole board at `opacity 0.92`,
   * every slot `tabindex="-1"`, `aria-disabled` on the board group, and
   * **no hover lift**. The board must never look broken while you wait.
   */
  readonly disabled?: boolean;
  /**
   * `sameZone: true` locks placement into one zone after the first pick
   * (§6.1.2 step 2). Supplied by the caller because only the engine knows which
   * zone was locked; the board just narrows the legal set with it.
   */
  readonly lockedZoneId?: BoardZoneID;
  /** Area ids already picked for the group in progress (§4.7.3 same-zone tether). */
  readonly pickedAreaIds?: readonly string[];
  /**
   * The gerrymander source the player has picked up, if any. Drives `⟲` on the
   * source and `◈` / `✕` on destinations (§4.7.2).
   */
  readonly gerrySourceAreaId?: string;
};
