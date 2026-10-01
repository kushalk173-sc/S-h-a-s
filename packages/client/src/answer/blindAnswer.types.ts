/**
 * Type-level proof that `BlindAnswer` cannot receive payout data.
 *
 * There is no runtime way to assert "this prop does not exist" — TypeScript
 * erases types before the code runs. So the assertion lives here, in the type
 * system, and `npm run typecheck` is the gate that runs it. If someone adds a
 * `payoutA` prop, or widens `seed` to a value that could carry one, the
 * `@ts-expect-error` lines below stop being errors, `tsc` fails with
 * "Unused '@ts-expect-error' directive", and the blind answer is caught at the
 * gate rather than in a screenshot.
 *
 * This file is compiled by `tsc --noEmit` (it is inside `src`), and it is also
 * imported by nothing at runtime — it exists to be typechecked.
 *
 * The runtime half of the guarantee — that no payout can reach the DOM even if
 * a caller smuggles one past the types with a cast — is in
 * `blindAnswer.test.tsx`.
 */

import type { ComponentProps } from 'react';
import { BlindAnswer } from './BlindAnswer';
import './blindAnswer.css';

type Props = ComponentProps<typeof BlindAnswer>;

/**
 * The complete, closed set of things this component can be told. Eight fields.
 *
 * Four are strings, one is a number that is provably the PRNG cursor, one is a
 * callback whose argument is the WIRE side — never a value — one is another
 * callback that takes NO arguments at all, and the last two are a nullable side
 * and a four-value union of server-derived states. None of them is a resource,
 * a payout, an Ideologue, or a quantity.
 */
const EXHAUSTIVE: Props = {
  question: 'string',
  labelA: 'string',
  labelB: 'string',
  seed: 0,
  onSelect: (_side) => undefined,
  selected: null,
  commitState: 'idle',
  onCommit: () => undefined,
};
void EXHAUSTIVE;

// ── 1. There is no payout prop, in any spelling a dev might reach for. ──────
const noPayout: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // @ts-expect-error — no `payout` prop exists.
  payout: 7,
};
void noPayout;

// NOTE on excess-property errors: TypeScript reports an excess property on a
// fresh object literal ONCE, on the first offending property. So each literal
// below carries exactly one `@ts-expect-error`; a second one would be reported
// as an unused directive even though the intent is the same.

const noPerSidePayout: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // @ts-expect-error — no per-side payout props exist, in any spelling.
  payoutA: 7,
};
void noPerSidePayout;

// ── 2. No Ideologue identity, so nothing can be tinted per side. ───────────
const noIdeologue: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // @ts-expect-error — an Ideologue would let the client tint a side.
  ideologueA: 'capitalist',
};
void noIdeologue;

const noIdeologyRow: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // @ts-expect-error — a resource name would be the same leak in a different
  // costume, and §1.2 forbids the words Funds/Clout/Media/Trust here outright.
  resources: { funds: 4, clout: 0, media: 0, trust: 0 },
};
void noIdeologyRow;

// ── 3. No value-bearing numbers at all, except the PRNG cursor. ───────────
const seedMustBeANumber: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  // @ts-expect-error — `seed` is a number, not an arbitrary payload.
  seed: { payout: 4 },
};
void seedMustBeANumber;

const committedIsOnlyASide: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // Valid — this is the whole legal set.
  selected: 'A',
  // @ts-expect-error — nothing else, and in particular not a value.
  payout: 7,
};
void committedIsOnlyASide;

const onSelectGetsASideNotAValue: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // @ts-expect-error — the selection callback receives the wire side, not a
  // payout. Note the name: it SELECTS. It is not the commit path, which is what
  // makes "pressing a side must not mark the answer committed" checkable here
  // as well as at the DOM level.
  onSelect: (side: number) => side,
};
void onSelectGetsASideNotAValue;

const commitStateIsAServerDerivedUnion: Props = {
  question: 'q',
  labelA: 'a',
  labelB: 'b',
  seed: 1,
  // @ts-expect-error — `commitState` is one of four literals. There is no way to
  // hand this component a fifth state, and in particular no way to invent
  // 'committed' from a local click: the caller owns it.
  commitState: 'sent-with-the-payout',
};
void commitStateIsAServerDerivedUnion;

// ── 4. Labels are plain strings, so no side can arrive pre-styled. ────────
const labelsArePlainStrings: Props = {
  question: 'q',
  // @ts-expect-error — a label is a string, not a pre-styled node.
  labelA: { text: 'a', tone: 'positive' },
  labelB: 'b',
  seed: 1,
};
void labelsArePlainStrings;
