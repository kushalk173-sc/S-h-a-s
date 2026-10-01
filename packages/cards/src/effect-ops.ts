/**
 * The `Effect` op list, kept in lockstep with `cards.ts`.
 *
 * JSON Schema cannot import a TypeScript type, so the op enum in
 * `schema/card.schema.json` and the union in `packages/engine/src/cards.ts` are
 * two independent lists that can drift. These two declarations are the compile-time
 * bridge: if a variant is added to `Effect` and not listed here, or listed here
 * but not in `Effect`, this file stops compiling.
 */

import type { Effect } from './engine.js';

export const EFFECT_OPS = [
  'gain',
  'lose',
  'gain-any',
  'lose-any',
  'steal-any',
  'voters',
  'evict',
  'discard-voter',
  'convert-voter',
  'gerrymander',
  'draw-conspiracy',
  'refresh-market',
  'restrict',
  'discount',
] as const satisfies readonly Effect['op'][];

/**
 * Compiles only while `Effect['op']` and EFFECT_OPS are identical. Add an op to
 * cards.ts and this becomes `{ [x: string]: never }`-shaped and errors.
 */
const NO_MISSING_OPS: Readonly<Record<Exclude<Effect['op'], (typeof EFFECT_OPS)[number]>, never>> =
  {};

export const EFFECT_OP_SET: ReadonlySet<string> = new Set<string>(EFFECT_OPS);

export function isKnownEffectOp(op: string): boolean {
  return EFFECT_OP_SET.has(op);
}

export type { Effect };
