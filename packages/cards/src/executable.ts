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
 * `interrupt` and a dynamic `n` are real, specified, wanted — and inert. They are
 * accepted by the JSON Schema so a card author gets a precise explanation instead
 * of "unknown property", and rejected here with the exact engine change each one
 * is waiting on. See `packages/cards/KNOWN-GAPS.md`.
 *
 * `duration`, `timing`, `when`, `until` and `condition` are no longer on that list:
 * they are EXECUTED, by `installLiveEffects` and `fireTriggers` in the reducer, and
 * `SCOPE_FIELDS_READ_BY_INSTALL` below is the registry that says so — re-derived
 * from the reducer's own source by `test/reducer-parity.test.ts`, like everything
 * else in this file.
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
  gain: ['res', 'per', 'target'],
  lose: ['res', 'per', 'target'],
  'gain-any': ['n', 'target'],
  'lose-any': ['n', 'target'],
  'steal-any': ['n', 'target'],
  voters: ['n', 'target'],
  evict: ['n', 'target'],
  'discard-voter': ['n', 'target'],
  'convert-voter': ['n', 'target'],
  gerrymander: ['n', 'target'],
  'draw-conspiracy': ['n', 'target', 'from'],
  'refresh-market': [],
  restrict: ['kind', 'value', 'owed', 'target'],
  discount: ['n', 'target'],
};


export const EXECUTED_OP_SET: ReadonlySet<string> = new Set<string>(Object.keys(EXECUTED_OPS));

// ─────────────────────────── G13: the phase-changing ops ───────────────────────────

/**
 * The `interrupt` ops `RESPOND_INTERRUPT` actually performs, re-derived from
 * `REACTIVE_INTERRUPTS` in `reduce.ts` by `test/reducer-parity.test.ts`.
 *
 * ## WHY THIS IS A SEPARATE REGISTRY AND NOT A THIRD ENTRY IN `EXECUTED_OPS`
 *
 * `EXECUTED_OPS` is re-derived by slicing `applyEffect`'s own source text between
 * its `case '…':` marks, and `interrupt` is read one function a very long way above
 * it, in a different `case` of `reduce` itself. Putting it in that table would make
 * the re-derivation a lie: the slice would not find it, and the test would have to
 * be weakened to accommodate the registry rather than the registry matching the
 * reducer. This is the third honesty seam, and it is cut the same way as the second
 * (`SCOPE_FIELDS_READ_BY_INSTALL`, read by `installLiveEffects`).
 *
 * ## THE THREE THAT ARE NOT HERE, and why, in one line each
 *
 *  - `auction` — needs a `PlayerState` debt field, an IOU token, and a ruling on
 *    p12's "check your resource cap before any other action" read against a bid you
 *    do not have to be able to afford. A whole rules system, not an op.
 *  - `vote` — needs a ballot, a no-self-vote rule, a re-vote loop that is a genuine
 *    termination hazard, and a payoff (NEXT BILLION DATA POINTS hands a Conspiracy
 *    Card to a player) that is G20 card movement, so the vote alone buys no card.
 *  - `pass-card` — needs something to pass the card ON TO: G12's in-flight queue and
 *    G20's `move-card`. With neither, `pass-card` is an op with no referent.
 *
 * KNOWN-GAPS G13 carries the full argument and the cost. An op listed here that the
 * reducer cannot honour is a card that lies, so the registry names only what is real.
 */
export const EXECUTED_INTERRUPT_OPS: ReadonlySet<string> = new Set(['block', 'deflect']);

/**
 * `interrupt.window` values `RESPOND_INTERRUPT` honours, re-derived from
 * `mayRespond` in `reduce.ts` by `test/reducer-parity.test.ts`.
 *
 * The enum in `cards.ts` was NARROWED from three values to two to make this list
 * true rather than aspirational. `'out-of-turn'` was dropped because
 * `RESPOND_INTERRUPT` already refuses the actor, which was the whole of its meaning,
 * and a value the engine cannot distinguish from another is a value it is not reading.
 */
export const EXECUTED_INTERRUPT_WINDOWS: ReadonlySet<string> = new Set([
  'always',
  'pre-answer',
]);

/**
 * `interrupt.target` values `RESPOND_INTERRUPT` honours, re-derived from
 * `mayRespond` in `reduce.ts`. `'any-player'` was dropped for the same reason
 * `'out-of-turn'` was: indistinguishable from `'any-card'` in every position the
 * window can be in.
 */
export const EXECUTED_INTERRUPT_TARGETS: ReadonlySet<string> = new Set([
  'any-card',
  'card-affecting-you',
]);

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
 * The quantities a computed `n` or a `per` multiplier may be read from.
 *
 * Mirrors `ComputedSource` in `packages/engine/src/cards.ts`, and the JSON Schema's
 * `dynamicCount.of` enum. Three of the five, so a typo in a deck file gets the
 * registry's message rather than a silently-zero count.
 *
 *  - `your-pool` — the total the player holds.
 *  - `ideologue-level` — 1, 3 or 5, from the count of Ideology CARDS answered. NOT
 *    the balance checker's resource proxy: KNOWN-GAPS §6 says that proxy
 *    over-reports, and `powers.ts hasPower` counts cards. The engine reads cards.
 *  - `your-gerrymander-rights` — moves still available across every zone they lead.
 *  - `volatile-voters` — their pegs in Volatile Areas. p18 makes those permanent, so
 *    it only grows.
 *  - `held-of-each-resource` — for `per` only: what the player holds of the resource
 *    in `res`. A `res` of 1 in each resource with this multiplier is IF YOU LIKE
 *    PIÑA COLADA's doubling of the whole mat.
 */
export const EXECUTABLE_COMPUTED_SOURCES: ReadonlySet<string> = new Set([
  'your-pool',
  'ideologue-level',
  'your-gerrymander-rights',
  'volatile-voters',
  'held-of-each-resource',
]);

export const COMPUTED_SOURCE_FIX =
  'reduce() reads a computed value through computedValue() in reduce.ts, and only ' +
  'these sources are implemented. An unknown `of` resolves to zero, which is the ' +
  'worst possible answer: a card that reads as though it doubles something and ' +
  'doubles nothing. See ComputedSource in packages/engine/src/cards.ts and ' +
  'KNOWN-GAPS.md G15 and G4.';


/**
 * The scope fields `applyEffect` does NOT read but the card contract honours
 * anyway, because ONE FUNCTION ABOVE IT does: `installLiveEffects` in
 * `packages/engine/src/reduce.ts`.
 *
 * This is the second honesty seam, and it exists because the first one cannot see
 * these. `test/reducer-parity.test.ts` re-derives the per-op field list by slicing
 * `applyEffect`'s body between its `case` marks — a field read by the installer
 * would be invisible there, and declaring one in `EXECUTED_OPS` would be a lie in
 * the other direction. So the registry names them separately, and the parity test
 * re-derives THIS list from `installLiveEffects`'s own source text too. A scope
 * field that the installer stops reading fails the test; one it never read fails
 * the validator.
 */
export const SCOPE_FIELDS_READ_BY_INSTALL: readonly string[] = ['when', 'until', 'condition'];


/**
 * Fields the reducer ignores, and the exact change each one is waiting on.
 *
 * Keyed `op.field`. A field with no bespoke entry still fails, with the generic
 * message from `unexecutedEffectProblems`; these are the ones an author is most
 * likely to reach for, written out so the message is actionable on its own.
 */
const IGNORED_FIELD_FIX: Readonly<Record<string, string>> = {
  // Empty today. It is kept as a mechanism, not as a table: an op whose case reads
  // `target` only for one value would be listed here with a validator message
  // naming the fix, and that is how the six ops below stopped needing one.
  // G8 (gerrymander) was the last entry and its case now loops `resolveTargets`.
};

// ─────────────────────────── the scope fields the installer reads ───────────────────────────

/**
 * The trigger values the reducer actually raises.
 *
 * This is a list of PROMISES about `reduce()`, so it is re-derived from the
 * reducer's own source by `test/reducer-parity.test.ts`, which greps every
 * `trigger: '…'` raise site and asserts the two sets are equal. A value added here
 * without a raise site fails that test; a raise site added without a value here
 * fails it the other way. And a card naming an event the reducer never raises is
 * refused by the validator rather than shipping a hook that never wakes.
 *
 * WHERE each one is raised:
 *  - `on-turn-start` — `tickLiveEffects`, after expiry, for the incoming player.
 *  - `on-purchase` / `on-voter-influenced` — `INFLUENCE` raises both, the
 *    voter-specific one first; `BUY_CONSPIRACY` raises the general one only.
 *  - `on-gerrymander` — `GERRYMANDER`, with the moved peg's owner in `pegOwner`.
 *  - `on-volatile-placement` / `on-majority-formed` — `setArea`, which every peg
 *    change in the engine routes through, so the three powers and `resolveChoice`'s
 *    voter branch raise them too without knowing they exist.
 */
export const EXECUTABLE_TRIGGERS: ReadonlySet<string> = new Set([
  'on-turn-start',
  'on-purchase',
  'on-voter-influenced',
  'on-volatile-placement',
  'on-gerrymander',
  'on-majority-formed',
]);


/** `timing` values `installLiveEffects` honours. `'after-this-turn'` is the gap. */
export const EXECUTABLE_TIMINGS: ReadonlySet<string> = new Set(['now', 'next-turn']);

/**
 * Every card-level `duration` is now performed.
 *
 * `'this-turn'` was always performed — resolve once, discard the card — and it
 * remains the DEFAULT, so a card that omits `duration` behaves exactly as it did
 * before this list existed. The other three install a `GameState.liveEffects`
 * entry whose `activeFrom` / `expiresAt` are absolute turn numbers computed at
 * install and ticked in `advanceTurn`. See KNOWN-GAPS.md G9 and G22.
 */
export const EXECUTABLE_DURATIONS: ReadonlySet<string> = new Set([
  'this-turn',
  'round',
  'next-turn',
  'rest-of-game',
]);

export const DURATION_FIX =
  'Every card-level duration is now installed as a GameState.liveEffects entry (reduce.ts ' +
  'installLiveEffects) and expired in advanceTurn, so there is nothing left to wait for. If a ' +
  'card is still refused for a duration, that is a bug in the registry above, not a missing ' +
  'engine feature.';

export const TIMING_FIX =
  'reduce() honours timing "now" (the default) and "next-turn" (dormant until the owner\'s next ' +
  'turn, via state.ts ownerNextTurn). "after-this-turn" has no anchor — it would need a queue of ' +
  'effects to run between advanceTurn and the next player\'s first action, and nothing in the ' +
  'corpus needs one. See KNOWN-GAPS.md G22.';

export const INTERRUPT_FIX =
  '`reduce()` now runs a response window: a played card whose effects somebody could ' +
  'answer is held in GameState.interrupt until RESPOND_INTERRUPT or PASS_INTERRUPT ' +
  'settles it, and RESPOND_INTERRUPT acts on a Conspiracy Card carrying an executed ' +
  '`interrupt`. `block` and `deflect` are the two ops it acts on. `auction`, `vote` ' +
  'and `pass-card` are still refused, each for a named reason in the message above, ' +
  'because each needs a system the engine does not have rather than a new op. ' +
  'See KNOWN-GAPS.md G13.';

export const WHEN_FIX =
  'A `when` the reducer never raises would install a hook that never wakes — a card that reads ' +
  'as though something happens on every purchase and nothing does, ever. The raised events are ' +
  'listed in EXECUTABLE_TRIGGERS and each one is re-derivable from reduce.ts by ' +
  'test/reducer-parity.test.ts.';

export const CONDITION_FIX =
  '`condition` narrows a `when`, so it needs a `when` to narrow: a condition on an effect with no ' +
  'trigger is never evaluated, and the engine drops it silently. Write the trigger first.';

export const DYNAMIC_N_FIX =
  'Every implemented source is resolved by computedValue() in reduce.ts, against the ' +
  'player the effect resolves FOR, before anything is pushed — so Choice.count is still a ' +
  'number at the point it is built. The caveat that matters is ideologue-level: the engine ' +
  'unlocks a power by counting Ideology CARDS answered (powers.ts hasPower), NOT resources ' +
  'paid, so this reads cards. KNOWN-GAPS.md §6 explains why the balance checker\'s resource ' +
  'proxy is only an approximation and over-reports. See G15 and G4.';



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

    // The three scope fields are read by `installLiveEffects`, one function above
    // `applyEffect`. They are checked here by VALUE rather than skipped, because
    // "the installer reads it" and "the installer honours this value" are different
    // claims: a `when` the reducer never raises installs a hook that never wakes.
    if (field === 'when') {
      const when = effect[field];
      if (typeof when !== 'string' || !EXECUTABLE_TRIGGERS.has(when)) {
        out.push({
          code: 'EFFECT_FIELD_NOT_EXECUTED',
          pointer: `${pointer}/when`,
          message:
            `when ${JSON.stringify(when)} is not an event reduce() raises, so the hook would be ` +
            `installed and never fire — a card that reads as though something happens on every ` +
            `purchase, and nothing ever happens. ${WHEN_FIX}`,
        });
      }
      continue;
    }
    if (field === 'until') {
      if (typeof effect[field] !== 'string' || !EXECUTABLE_DURATIONS.has(effect[field])) {
        out.push({
          code: 'EFFECT_FIELD_NOT_EXECUTED',
          pointer: `${pointer}/until`,
          message:
            `until ${JSON.stringify(effect[field])} is not a lifetime reduce() can expire. ${DURATION_FIX}`,
        });
      }
      continue;
    }
    if (field === 'condition') {
      if (effect.when === undefined) {
        out.push({
          code: 'EFFECT_FIELD_NOT_EXECUTED',
          pointer: `${pointer}/condition`,
          message: CONDITION_FIX,
        });
      }
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

  // A computed `n` is a FIELD the case reads, so the field check above passes it;
  // what has to be checked is the VALUE. reduce() resolves it against the player the
  // effect resolves for, before it constructs a Choice.count or a loop bound, so the
  // only way to get this wrong is to name a source the reducer cannot read.
  if ('n' in effect && typeof effect.n !== 'number') {
    const of = isPlainObject(effect.n) ? effect.n['of'] : undefined;
    if (typeof of !== 'string' || !EXECUTABLE_COMPUTED_SOURCES.has(of)) {
      out.push({
        code: 'EFFECT_FIELD_NOT_EXECUTED',
        pointer: `${pointer}/n`,
        message:
          `a computed n of ${JSON.stringify(effect.n)} names no quantity reduce() can read. ` +
          `${COMPUTED_SOURCE_FIX}`,
      });
    }
  }
  // `per` is the same question about a multiplier, and it is only meaningful on
  // `gain` / `lose` — but that is already covered by the field check above, because
  // `per` is registered as read on exactly those two ops and nowhere else.
  if ('per' in effect) {
    const of = isPlainObject(effect.per) ? effect.per['of'] : undefined;
    if (typeof of !== 'string' || !EXECUTABLE_COMPUTED_SOURCES.has(of)) {
      out.push({
        code: 'EFFECT_FIELD_NOT_EXECUTED',
        pointer: `${pointer}/per`,
        message:
          `a per multiplier of ${JSON.stringify(effect.per)} names no quantity reduce() can read. ` +
          `${COMPUTED_SOURCE_FIX}`,
      });
    } else if (of !== 'held-of-each-resource') {
      // The multiplier is applied PER RESOURCE, so any other source would multiply
      // the same number into four components, which is not what any recovered card
      // means. Naming the one legal value is more useful than letting it through.
      out.push({
        code: 'EFFECT_FIELD_NOT_EXECUTED',
        pointer: `${pointer}/per`,
        message:
          'per is a multiplier applied to EACH component of `res`, so the only source ' +
          `that means anything is 'held-of-each-resource' — what the player holds of the ` +
          `resource being gained. "${of}" would multiply one number into every resource. ` +
          `${COMPUTED_SOURCE_FIX}`,
      });
    }
  }
  return out;
}

/**
 * Everything about one `interrupt` that `RESPOND_INTERRUPT` would not act on.
 *
 * The mirror of `unexecutedEffectProblems` for the sibling card field, and the third
 * honesty seam. `applyEffect`'s body cannot see `interrupt` at all — it is read in a
 * `case` of `reduce` itself — so this registry is a promise about a different part of
 * the engine, and `test/reducer-parity.test.ts` re-derives all three of its sets
 * (`EXECUTED_INTERRUPT_OPS`, `…_WINDOWS`, `…_TARGETS`) from `reduce.ts`'s own source
 * text rather than trusting this file.
 */
export function unexecutedInterruptProblems(
  interrupt: unknown,
  pointer: string,
): readonly ExecutionProblem[] {
  if (!isPlainObject(interrupt)) return [];
  const out: ExecutionProblem[] = [];
  const op = interrupt['op'];

  if (typeof op !== 'string' || !EXECUTED_INTERRUPT_OPS.has(op)) {
    out.push({
      code: 'EFFECT_NOT_EXECUTED',
      pointer,
      message: UNEXECUTED_INTERRUPT_OP_FIX[op as string] ?? INTERRUPT_FIX,
    });
    return out;
  }

  const window = interrupt['window'];
  if (typeof window !== 'string' || !EXECUTED_INTERRUPT_WINDOWS.has(window)) {
    out.push({
      code: 'EFFECT_NOT_EXECUTED',
      pointer: `${pointer}/window`,
      message:
        `window ${JSON.stringify(window)} is not a window RESPOND_INTERRUPT honours. reduce() ` +
        `reads 'always' (any phase in which a window is open) and 'pre-answer' (only while ` +
        `phase === 'answer', the p19 window). The enum in cards.ts was narrowed to those two ` +
        `because 'out-of-turn' is already enforced by the rule that the actor of a card cannot ` +
        `answer it - a third value the engine cannot distinguish is a value it is not reading. ` +
        `${INTERRUPT_FIX}`,
    });
  }

  if ('target' in interrupt) {
    const target = interrupt['target'];
    if (typeof target !== 'string' || !EXECUTED_INTERRUPT_TARGETS.has(target)) {
      out.push({
        code: 'EFFECT_NOT_EXECUTED',
        pointer: `${pointer}/target`,
        message:
          `target ${JSON.stringify(target)} is not a narrowing reduce() applies. It honours ` +
          `'any-card' and 'card-affecting-you' (which is the engine's approximation of "a card ` +
          `that affects you" - it reads whether any effect in the list aims past its own player, ` +
          `because the narrower question is G1 and a new Choice kind this package cannot add). ` +
          `'any-player' was dropped as indistinguishable from 'any-card'. ${INTERRUPT_FIX}`,
      });
    }
  }
  return out;
}

/**
 * What each of the three unexecuted ops is actually waiting on, in one line each.
 *
 * Written out rather than left to the generic message because a card author reaching
 * for `auction` deserves to know that the blocker is a missing `PlayerState` field and
 * not a missing `case`, which are very different amounts of work.
 */
const UNEXECUTED_INTERRUPT_OP_FIX: Readonly<Record<string, string>> = {
  auction:
    '`auction` is not an op this engine is missing, it is a rules SYSTEM it is missing: ' +
    'rules-reference.md §6 (p25) lets a bidder commit up to their cap WITHOUT holding the ' +
    'resources, settles on an IOU token, and stops the winner buying anything until it is ' +
    'paid in full. That needs a `PlayerState` debt field that persists, expires, appears in ' +
    'the client payload and is consulted by INFLUENCE and BUY_CONSPIRACY, plus a ruling on ' +
    'p12 ("check your resource cap before any other action") read against a bid the bidder ' +
    'cannot afford - and debt is negative resources, which every pool read in the engine ' +
    '(canAfford, enforceCap, poolTotal) and the balance checker currently assume is ' +
    'non-negative. It would also buy no card on its own: both real auction cards (A CALL ' +
    'FROM KARACHI, QUANTUM WRISTBAND) are also G17 deck search and G20 card movement. See ' +
    'KNOWN-GAPS.md G13.',
  vote:
    '`vote` needs a ballot per player, a no-self-vote rule, and a re-vote-on-tie loop that is ' +
    'a genuine termination hazard rather than a formality. It would also buy no card: the one ' +
    'real vote card (NEXT BILLION DATA POINTS) hands "the next Conspiracy Card in the draw ' +
    'pile" to a chosen player, which is G20 card movement, and the deal mechanism is G17. ' +
    'Building the ballot and not the payoff is the half-built system KNOWN-GAPS G13 warns ' +
    'against. See KNOWN-GAPS.md G13.',
  'pass-card':
    '`pass-card` has no referent: there is nothing to pass the card ON TO. It needs G12 (a ' +
    'GameState queue of in-flight cards, an owner, a position in the turn order and a ' +
    'turn-boundary deadline) and G20 (a `move-card` op and a `PlayerState.ideologyCards` list), ' +
    'and the two real cards that need it are blocked on those anyway - HIGGS MORON on the G10 ' +
    'token counter as well, A COWARD OR A JOURNALIST? and CARD GAMES on the card movement. ' +
    'See KNOWN-GAPS.md G13.',
};

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
          `duration "${card.duration}" is not a lifetime reduce() can install. ${DURATION_FIX}`,
      });
    }
  }
  if ('timing' in card) {
    if (typeof card.timing !== 'string' || !EXECUTABLE_TIMINGS.has(card.timing)) {
      out.push({
        code: 'EFFECT_NOT_EXECUTED',
        pointer: `${pointer}/timing`,
        message:
          `timing ${JSON.stringify(card.timing)} is not read by reduce(). ${TIMING_FIX}`,
      });
    }
  }
  if ('interrupt' in card) {
    // G13, and this is a VALUE check rather than a blanket refusal: `block` and
    // `deflect` are executed, so a card carrying one is shippable, while the other
    // three ops each get the specific reason they are not. The narrow `window` and
    // `target` enums are checked against what `mayRespond` in `reduce.ts` honours,
    // because a window the engine cannot act in is a window that is never open.
    const out2 = unexecutedInterruptProblems(card['interrupt'], `${pointer}/interrupt`);
    if (out2.length > 0) {
      for (const p of out2) out.push(p);
    }
  }

  const effects = card.effects;
  if (Array.isArray(effects)) {
    effects.forEach((effect, i) => {
      out.push(...unexecutedEffectProblems(effect, `${pointer}/effects/${i}`));
    });
  }
  return out;
}