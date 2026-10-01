/**
 * WHAT `reduce()` CAN ACTUALLY DO.
 *
 * ## Why this file exists
 *
 * A schema that PARSES a card the engine cannot EXECUTE is worse than no schema:
 * the game would accept the card, the player would read the text, and the effect
 * would simply never happen. Nothing in the type system catches that. JSON Schema
 * cannot see the reducer, and `Effect` cannot see the reducer either — it is a
 * declaration of what a card MAY say, not a promise about what the interpreter
 * WILL do.
 *
 * So the promise is written down here, once, from reading
 * `packages/engine/src/reduce.ts`, and the corpus validator enforces it:
 *
 *  1. every op a card uses must have a `case` in `applyEffect`;
 *  2. every FIELD on that op must be one the `case` actually reads.
 *
 * Rule 2 is not pedantry. `reduce.ts` computes `const target = 'target' in effect
 * ? … : 'you'` for every effect and then only consults `target` in the five cases
 * that take it. Adding `target` to any other op looks like a working feature and
 * is silently ignored — the exact failure this file exists to prevent.
 *
 * ## How it is kept honest
 *
 * `test/reducer-parity.test.ts` reads `packages/engine/src/reduce.ts`, extracts the
 * `case '…':` arms out of `applyEffect`, and asserts the list equals
 * `EXECUTED_OPS`. The registry therefore cannot drift from the reducer without a
 * test failure, and the same test walks the whole shipped corpus. If an op is
 * added to `Effect` and the schema and the corpus starts using it before the
 * reducer grows a `case` for it, `npm run validate` fails with the line to add.
 *
 * ## The reserved shapes
 *
 * `duration`, `timing`, `interrupt`, `when`, `until` and a dynamic `n` are real,
 * specified, wanted — and inert. They are accepted by the JSON Schema so a card
 * author gets a precise explanation instead of "unknown property", and rejected
 * here with the exact engine change each one is waiting on. See
 * `packages/cards/KNOWN-GAPS.md`.
 */

import type { Effect } from './engine.js';

// ─────────────────────────── the registry ───────────────────────────

/**
 * Every op `reduce()` has a `case` for, and the fields that case reads.
 *
 * `reads` is read straight off the `case` bodies in `applyEffect`
 * (packages/engine/src/reduce.ts). Adding a field the body ignores is the bug this
 * table prevents, so the entries are deliberately exhaustive rather than minimal.
 */
export const EXECUTED_OPS: Readonly<Record<Effect['op'], readonly string[]>> = {
  gain: ['res', 'target'],
  lose: ['res', 'target'],
  'gain-any': ['n', 'target'],
  'lose-any': ['n', 'target'],
  'steal-any': ['n', 'target'],
  voters: ['n', 'target'],
  evict: ['n', 'target'],
  'discard-voter': ['n', 'target'],
  'convert-voter': ['n', 'target'],
  gerrymander: ['n', 'target'],
  'draw-conspiracy': ['n', 'target'],
  'refresh-market': [],
  discount: ['n', 'target'],
};

export const EXECUTED_OP_SET: ReadonlySet<string> = new Set<string>(Object.keys(EXECUTED_OPS));

/**
 * Fields the reducer ignores EXCEPT at the value that means "do nothing new".
 *
 * Empty today, and deliberately kept as a mechanism rather than deleted: it is the
 * honest place for an op whose `case` honours `target` at exactly one value, and a
 * validator that refuses the rest is how that stays visible. `gerrymander` was the
 * only entry (KNOWN-GAPS G8) and its case now loops `resolveTargets`, so any
 * `EffectTarget` is honoured.
 */
const FIELD_EXECUTABLE_WHEN: Readonly<Record<string, (value: unknown) => boolean>> = {};

/**
 * Fields `applyEffect` accepts on EVERY op because it reads them off the effect
 * object itself, rather than inside one `case`.
 */
export const EFFECT_INTRINSIC_FIELDS: readonly string[] = ['op'];

/**
 * Fields the reducer ignores, and the exact change each one is waiting on.
 *
 * Keyed `op.field`. A field with no bespoke entry still fails, with the generic
 * message from `unexecutedEffectFindings`; these are the ones an author is most
 * likely to reach for, written out so the message is actionable on its own.
 */
const IGNORED_FIELD_FIX: Readonly<Record<string, string>> = {
  // Empty today. It is kept as a mechanism, not as a table: an op whose case reads
  // `target` only for one value would be listed here with a validator message
  // naming the fix, and that is how the six ops below stopped needing one.
  // G8 (gerrymander) was the last entry and its case now loops `resolveTargets`.
};

// ─────────────────────────── the reserved (inert) shapes ───────────────────────────

/**
 * `duration: 'this-turn'` is the ONE reserved value the engine already performs:
 * the effects resolve once and the card is discarded. It is accepted because it is
 * a statement of fact rather than a request for new behaviour. Everything else in
 * this enum needs a live-effects list in `GameState`.
 */
export const EXECUTABLE_DURATIONS: ReadonlySet<string> = new Set(['this-turn']);

export const DURATION_FIX =
  'reduce() resolves a Conspiracy/Headline once and discards the card (applyEffects, then ' +
  'discardTo). A lasting effect needs a live-effects list on GameState that the reducer ' +
  're-applies on each event and expires on a turn boundary — state.ts plus a tick in ' +
  'advanceTurn(). See KNOWN-GAPS G9 and G22; this is the single largest engine change the ' +
  'corpus exposes.';

export const TIMING_FIX =
  'reduce() has no clock on an effect. "next turn" needs the owning player\'s turn index, so ' +
  'the effect has to be stored with an expiry and checked at the top of that player\'s turn in ' +
  'advanceTurn(). See KNOWN-GAPS G22.';

export const INTERRUPT_FIX =
  'reduce() has no interrupt window: PLAY_CONSPIRACY is gated on phase/actions|answer for the ' +
  'card owner alone, there is no auction, no vote, and no way to cancel an effect that has ' +
  'already resolved. See KNOWN-GAPS G13.';

export const WHEN_FIX =
  'reduce() applies an effect list once, at resolution. A hook on another player\'s action needs ' +
  'a trigger registry on GameState that INFLUENCE, BUY_CONSPIRACY, GERRYMANDER, PLACE_VOTERS and ' +
  'setArea consult. See KNOWN-GAPS G14.';

export const DYNAMIC_N_FIX =
  'reduce() reads `effect.n` as a number and pushes it straight into a Choice.count / a loop ' +
  'bound. A computed value has to be resolved before applyEffect pushes anything, which means ' +
  'the same read-the-player-state plumbing as G14. See KNOWN-GAPS G15.';

// ─────────────────────────── the check ───────────────────────────

export type ExecutionProblem = {
  readonly code: 'EFFECT_NOT_EXECUTED' | 'EFFECT_FIELD_NOT_EXECUTED';
  /** The object path inside the card, for the report. */
  readonly pointer: string;
  readonly message: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Everything about `effect` that `reduce()` would not act on.
 *
 * Pure, so a test can call it on one fixture effect. Returns `[]` for an effect the
 * engine fully performs — which is the only thing a shipped card is allowed to be.
 */
export function unexecutedEffectProblems(effect: unknown, pointer: string): readonly ExecutionProblem[] {
  if (!isPlainObject(effect)) return [];
  const out: ExecutionProblem[] = [];

  const op = effect.op;
  if (typeof op !== 'string' || !EXECUTED_OP_SET.has(op)) {
    // Unreachable through the schema (an unknown op is rejected there first) but
    // reachable by anyone who hand-builds a CardIndex, and `applyEffect`'s switch
    // has no `default` — an unknown op returns undefined and the next `reduce`
    // call throws on it. Say so rather than pass it through.
    out.push({
      code: 'EFFECT_NOT_EXECUTED',
      pointer,
      message:
        `op ${JSON.stringify(op)} has no case in reduce.ts applyEffect, so it would resolve to ` +
        'undefined and corrupt the next reduce(). Add the `case` before shipping a card that uses it.',
    });
    return out;
  }

  const reads = EXECUTED_OPS[op as Effect['op']];
  for (const field of Object.keys(effect)) {
    if (EFFECT_INTRINSIC_FIELDS.includes(field)) continue;

    // The two reserved scope fields ride on every op, so they are matched by name
    // rather than by `op.field`.
    if (field === 'when') {
      out.push({
        code: 'EFFECT_FIELD_NOT_EXECUTED',
        pointer: `${pointer}/when`,
        message:
          `"when" is on every Effect in cards.ts but applyEffect ignores it, so a trigger clause ` +
          `would read as a live hook and fire exactly never. ${WHEN_FIX}`,
      });
      continue;
    }
    if (field === 'until') {
      out.push({
        code: 'EFFECT_FIELD_NOT_EXECUTED',
        pointer: `${pointer}/until`,
        message:
          `"until" is on every Effect in cards.ts but applyEffect ignores it, so a lasting clause ` +
          `would read as a duration and behave as a one-shot. ${DURATION_FIX}`,
      });
      continue;
    }

    if (reads.includes(field)) continue;

    const key = `${op}.${field}`;
    if (FIELD_EXECUTABLE_WHEN[key]?.(effect[field]) === true) continue;
    const bespoke = IGNORED_FIELD_FIX[key];
    out.push({
      code: 'EFFECT_FIELD_NOT_EXECUTED',
      pointer: `${pointer}/${field}`,
      message:
        `"${field}" is on the ${op} op in cards.ts but applyEffect's case for ${op} does not read ` +
        `it, so the card would resolve without it — a card that reads as if something happens and ` +
        `does not. ${bespoke ?? `Either remove the field or make the ${op} case honour it.`}`,
    });
  }

  // A computed `n` passes the field check — `n` IS a field the case reads — so the
  // value is what has to be checked. reduce() pushes it into a Choice.count (typed
  // `number`) and loops on it.
  if ('n' in effect && typeof effect.n !== 'number') {
    out.push({
      code: 'EFFECT_FIELD_NOT_EXECUTED',
      pointer: `${pointer}/n`,
      message:
        `a computed n (${JSON.stringify(effect.n)}) is not something reduce() can evaluate: ` +
        `applyEffect reads effect.n as a literal and pushes it straight into a Choice.count and a ` +
        `loop bound. ${DYNAMIC_N_FIX}`,
    });
  }
  return out;
}

/**
 * Everything about an X-card that `reduce()` would not act on.
 *
 * The check is on the card object, not on the effect list, because `duration`,
 * `timing` and `interrupt` are card-level: the reducer applies `effects` and
 * discards, and never looks at anything else on the card.
 */
export function unexecutedCardProblems(card: unknown, pointer: string): readonly ExecutionProblem[] {
  if (!isPlainObject(card)) return [];
  const out: ExecutionProblem[] = [];

  if ('duration' in card && typeof card.duration === 'string') {
    if (!EXECUTABLE_DURATIONS.has(card.duration)) {
      out.push({
        code: 'EFFECT_NOT_EXECUTED',
        pointer: `${pointer}/duration`,
        message:
          `duration "${card.duration}" is not performed by reduce(): the effects resolve once and ` +
          `the card is discarded, so a lasting effect would simply never expire — or never re-apply. ` +
          `Only "this-turn" is accepted, because that is what the engine already does. ${DURATION_FIX}`,
      });
    }
  }
  if ('timing' in card) {
    out.push({
      code: 'EFFECT_NOT_EXECUTED',
      pointer: `${pointer}/timing`,
      message: `"timing" is not read by reduce(). ${TIMING_FIX}`,
    });
  }
  if ('interrupt' in card) {
    out.push({
      code: 'EFFECT_NOT_EXECUTED',
      pointer: `${pointer}/interrupt`,
      message:
        `"interrupt" is not read by reduce(): a BLOCK, DEFLECT, AUCTION, VOTE or PASS is a change of ` +
        `phase, not of resources, and there is no window in which the engine would offer it. ` +
        `${INTERRUPT_FIX}`,
    });
  }

  const effects = card.effects;
  if (Array.isArray(effects)) {
    effects.forEach((effect, i) => {
      out.push(...unexecutedEffectProblems(effect, `${pointer}/effects/${i}`));
    });
  }
  return out;
}