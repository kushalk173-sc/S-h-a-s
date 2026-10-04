/**
 * The `Effect` op list, kept in lockstep with `cards.ts`.
 *
 * JSON Schema cannot import a TypeScript type, so the op enum in
 * `schema/card.schema.json` and the union in `packages/engine/src/cards.ts` are
 * two independent lists that can drift. These two declarations are the compile-time
 * bridge: if a variant is added to `Effect` and not listed here, or listed here
 * but not in `Effect`, this file stops compiling.
 */

import type { Effect, Interrupt } from './engine.js';

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
  'move-card',
  'borrow-power',
  'set-cap',
  'move-peg',
] as const satisfies readonly Effect['op'][];

/**
 * Compiles only while `Effect['op']` and EFFECT_OPS are identical. Add an op to
 * cards.ts and this becomes `{ [x: string]: never }`-shaped and errors.
 */
const NO_MISSING_OPS: Readonly<Record<Exclude<Effect['op'], (typeof EFFECT_OPS)[number]>, never>> =
  {};

// ─────────────────────────── G13: the interrupt enums ───────────────────────────

/**
 * The same bridge for `Interrupt`, which has THREE independent lists that can drift:
 * the union in `packages/engine/src/cards.ts`, the enum in
 * `schema/card.schema.json`, and the values `EXECUTED_INTERRUPT_*` in
 * `executable.ts` says `reduce()` honours.
 *
 * The last of those is the one that matters and it CANNOT be bridged at compile time,
 * because whether the engine honours a value is a property of a function body.
 * `test/reducer-parity.test.ts` re-derives it from `reduce.ts`'s own source text, in
 * the same spirit as the op registry. What these two declarations below buy is that
 * the TYPE and the shipped SCHEMA cannot drift from each other, and that a value the
 * reducer honours is always declared — the assertion is in the test, and the
 * declaration is here.
 */
export const INTERRUPT_OPS = [
  'block',
  'deflect',
  'auction',
  'vote',
  'pass-card',
] as const satisfies readonly Interrupt['op'][];

export const INTERRUPT_WINDOWS = ['pre-answer', 'always'] as const satisfies readonly Interrupt['window'][];

export const INTERRUPT_TARGETS = ['any-card', 'card-affecting-you'] as const satisfies readonly NonNullable<
  Interrupt['target']
>[];

const NO_MISSING_INTERRUPT_OPS: Readonly<
  Record<Exclude<Interrupt['op'], (typeof INTERRUPT_OPS)[number]>, never>
> = {};

const NO_MISSING_INTERRUPT_WINDOWS: Readonly<
  Record<Exclude<Interrupt['window'], (typeof INTERRUPT_WINDOWS)[number]>, never>
> = {};

const NO_MISSING_INTERRUPT_TARGETS: Readonly<
  Record<
    Exclude<NonNullable<Interrupt['target']>, (typeof INTERRUPT_TARGETS)[number]>,
    never
  >
> = {};

export const EFFECT_OP_SET: ReadonlySet<string> = new Set<string>(EFFECT_OPS);

export function isKnownEffectOp(op: string): boolean {
  return EFFECT_OP_SET.has(op);
}

export type { Effect, Interrupt };
