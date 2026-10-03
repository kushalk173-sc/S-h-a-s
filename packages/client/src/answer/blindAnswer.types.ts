/**
 * Type-level proof that `BlindAnswer` cannot receive the ONE thing still forbidden:
 * which face of the card a display position is.
 *
 * There is no runtime way to assert "this prop does not exist" — TypeScript
 * erases types before the code runs. So the assertion lives here, in the type
 * system, and `npm run typecheck` is the gate that runs it. If someone adds an
 * `order` prop, the `@ts-expect-error` lines below stop being errors, `tsc` fails with
 * "Unused '@ts-expect-error' directive", and the leak is caught at the gate rather
 * than in a screenshot.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE USED TO PROVE, AND WHY THE PREMISE IS GONE
 *
 * It was called "proof that `BlindAnswer` cannot receive payout data", and every case
 * below was about a component with no `payout`, no `ideologue`, no `resources` and no
 * number anywhere in its props. That was the type-level half of §1.2, and it was true.
 * Full information makes it false: the server publishes the whole card to every seat, so
 * the payout and the Ideologue are now PROPS, printed on the card, and pretending
 * otherwise would leave a gate asserting a premise the codebase no longer holds.
 *
 * So the guarantee is restated on the thing that survives — and what survives is
 * `order`. It says which face of the card the first display position is, and with the
 * Ideologue now printed beside each answer, a client that knew it could publish which
 * Ideologue the left-hand cell is. That is PLAN.md §2 amendment A′, it is the last
 * property of the old blind design, and this file is where it is pinned at the type
 * level. What it does NOT prove any more is that a payout cannot arrive: a payout
 * arrives, on purpose, in `sideA.pays` and `sideB.pays`.
 *
 * The runtime half of the surviving guarantee — that nothing in the DOM encodes the
 * order — is in `blindAnswer.test.tsx`.
 */

import type { ComponentProps } from 'react';
import { BlindAnswer } from './BlindAnswer';
import './blindAnswer.css';

type Props = ComponentProps<typeof BlindAnswer>;

/**
 * The complete, closed set of things this component can be told. Eight fields.
 *
 * Two are strings, two are whole printed sides (`label` + `ideologue` + `pays`, which is
 * the card and is deliberately public), one is a number that is provably a presentation
 * pin rather than a match seed, two are callbacks and the last two are a nullable side
 * and a four-value union of server-derived states. None of them is an `order`, a card
 * id, or any value that says which face of the card a position is.
 */
const EXHAUSTIVE: Props = {
  question: 'string',
  sideA: { label: 'a', ideologue: 'capitalist', pays: { funds: 4 } },
  sideB: { label: 'b', ideologue: 'idealist', pays: { trust: 2 } },
  seed: 0,
  onSelect: (_side) => undefined,
  selected: null,
  commitState: 'idle',
  onCommit: () => undefined,
};
void EXHAUSTIVE;

// NOTE on excess-property errors: TypeScript reports an excess property on a
// fresh object literal ONCE, on the first offending property. So each literal
// below carries exactly one `@ts-expect-error`; a second one would be reported
// as an unused directive even though the intent is the same.

const noOrder: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
  // @ts-expect-error — no `order` prop exists. This is the whole guarantee.
  order: 'ba',
};
void noOrder;

const noOrderAlias: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
  // @ts-expect-error — nor under any other spelling a dev might reach for. `face`
  // is the other name the same concept has had in this repo.
  face: 1,
};
void noOrderAlias;

// ── 1. A printed side is the whole side, and nothing identifies the card. ────
const noCardId: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
  // @ts-expect-error — a card id is a lookup key into the deck, and `PublicQuestion`
  // deliberately does not publish one. See `broadcast.ts` for why the id stays out
  // even though the card's content is now public.
  cardId: 'id-core-001',
};
void noCardId;

const sidesAreWholeNotPartial: Props = {
  question: 'q',
  // @ts-expect-error — a side is `{label, ideologue, pays}` as a unit. A bare string
  // would let the component render an answer with no payout, which is the shape of a
  // card the client got half of — and half a card is a silent bug, not a loud one.
  sideA: 'a',
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
};
void sidesAreWholeNotPartial;

// ── 2. The Ideologue is a closed union, so nothing can be styled by an open set. ──
const ideologueIsOneOfFour: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  // @ts-expect-error — four Ideologues exist. An open `string` here would let a
  // payload name a faction the client has no name for and no styles for, and the
  // whole "print it as a word, never as a class" rule depends on a closed set.
  sideB: { label: 'b', ideologue: 'libertarian', pays: {} },
  seed: 1,
};
void ideologueIsOneOfFour;

// ── 3. No value-bearing numbers at all, except the presentation pin. ───────
const seedMustBeANumber: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  // @ts-expect-error — `seed` is a number, not an arbitrary payload.
  seed: { order: 'ba' },
};
void seedMustBeANumber;

const onSelectGetsASideNotAValue: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
  // @ts-expect-error — the selection callback receives the wire side, not a
  // value. Note the name: it SELECTS. It is not the commit path, which is what
  // makes "pressing a side must not mark the answer committed" checkable here
  // as well as at the DOM level.
  onSelect: (side: number) => side,
};
void onSelectGetsASideNotAValue;

const commitStateIsAServerDerivedUnion: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
  // @ts-expect-error — `commitState` is one of four literals. There is no way to
  // hand this component a fifth state, and in particular no way to invent
  // 'committed' from a local click: the caller owns it.
  commitState: 'sent-with-the-payout',
};
void commitStateIsAServerDerivedUnion;

// ── 4. A payout is a `Delta`: PARTIAL, and only `Delta`s. ───────────────────
const absentPoolsAreLegal: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: { funds: 4 } },
  // VALID, and deliberately not an error: a card that prints only Funds is a legal
  // card, so the three absent pools must be legal too. This case exists because the
  // obvious "tighten the type" instinct is wrong here — see the note below.
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
};
void absentPoolsAreLegal;

const explicitZeroesAreAlsoLegal: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: { funds: 4 } },
  // ALSO VALID, and this is the point. `{funds: 4}` and `{funds: 4, clout: 0}` are
  // different STATEMENTS that must render identically, so the type admits both and the
  // RENDERER is where the normalisation happens — `payoutLine` skips every pool that is
  // absent or zero. Tightening this to an all-required record would have hidden the
  // difference at the type level and moved the bug to a client that printed "0 Clout".
  sideB: { label: 'b', ideologue: 'idealist', pays: { funds: 0, clout: 0, media: 0, trust: 0 } },
  seed: 1,
};
void explicitZeroesAreAlsoLegal;

const payoutMustBeANumber: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  // @ts-expect-error — a payout is numbers. A stringified number is the shape a
  // hand-rolled JSON payload produces, and it would render as `4 Fund` only by luck.
  sideB: { label: 'b', ideologue: 'idealist', pays: { funds: '4' } },
  seed: 1,
};
void payoutMustBeANumber;

const payoutRejectsAnUnknownPool: Props = {
  question: 'q',
  sideA: { label: 'a', ideologue: 'capitalist', pays: {} },
  // @ts-expect-error — four pools exist. An open index signature would let a
  // payload print a resource name this client has no label for, and the payout line
  // is prose built from a closed `Record` for exactly that reason.
  sideB: { label: 'b', ideologue: 'idealist', pays: { influence: 2 } },
  seed: 1,
};
void payoutRejectsAnUnknownPool;

// ── 5. Labels are plain strings, so no side can arrive pre-styled. ────────
const labelsArePlainStrings: Props = {
  question: 'q',
  // @ts-expect-error — a label is a string, not a pre-styled node. This is the half
  // of the old proof that SURVIVES unchanged: the Ideologue and the payout are now
  // allowed through, but a side may still not arrive carrying its own styling.
  sideA: { label: { text: 'a', tone: 'positive' }, ideologue: 'capitalist', pays: {} },
  sideB: { label: 'b', ideologue: 'idealist', pays: {} },
  seed: 1,
};
void labelsArePlainStrings;