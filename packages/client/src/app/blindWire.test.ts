/**
 * `app/blindWire.ts` — the payload boundary, as a gate.
 *
 * This file is about the SEED-DERIVED ANSWER ORDER and the promise that the client
 * cannot disturb it. The order exists because a card's two answers belong to two
 * different Ideologues and the shipped pool is not balanced side-to-side, so a
 * fixed "side A is always on the left" is a channel: a player who noticed would
 * learn the slot instead of deliberating (PLAN.md §2 amendment A′).
 *
 * **AND UNDER FULL INFORMATION IT IS THE ONLY CHANNEL LEFT.** The Ideology Card is
 * published whole to every seat, Ideologue and payout included, so a client that could
 * read `order` could map "the left-hand face is the Capitalists'" in one line and the
 * position would carry the deck's flavour balance to anybody who cared to look. The
 * refusal below is therefore no longer tidiness about one field among several; it is
 * the whole of the surviving guarantee.
 *
 * THE ORDER IS THE SERVER'S, and this suite is what holds the client to that. The
 * server picks a seed-derived order, sends `sides` ALREADY IN DISPLAY ORDER, and
 * maps the clicked index back through the same `order` on the way in. The client's
 * job is to copy the tuple positionally and re-derive NOTHING — a second draw would
 * mean one of the two draws is the one that leaks, and a client that could override
 * the order would make the whole exercise decorative (`net/protocol.ts`).
 *
 * `WIRE_ORDER_SEED` is the constant that makes the shared component's own ordering
 * an identity function, so the server's order is what reaches the screen. It is
 * documented in `blindWire.ts` as being asserted by a test; this is that test, and
 * it is the thing that turns "the constant happens to work today" into a gate —
 * if `presentationOrder` ever changes, this fails and the constant becomes a
 * visible decision rather than a silent reversal of the server's order.
 *
 * `openQuestionOf` is asserted here too, for the same reason `promptToProps` is: it
 * is the boundary where a payload becomes props, and what this screen may and may not
 * carry is a property of that boundary rather than of any component.
 */

import { describe, expect, it } from 'vitest';

import type { ClientState } from '@shasn/engine';
import type { AnswerSide } from '../net/index.ts';

import { presentationOrder } from '../answer/BlindAnswer.tsx';
import {
  WIRE_ORDER_SEED,
  committedSideToDisplayIndex,
  openQuestionOf,
  promptToProps,
} from './blindWire';

const QUESTION = 'The trusts have quietly bought the land your party needs for a bypass.';
const SIDE_ZERO = 'Sue them and stall the project for three years.';
const SIDE_ONE = 'Let it stand. The bypass goes in, and the party gets the credit.';

/** A whole printed side, as the server sends it under full information. */
function printed(label: string, ideologue: AnswerSide['ideologue'], funds: number): AnswerSide {
  return { label, ideologue, pays: { funds } };
}
const PRINTED_ZERO = printed(SIDE_ZERO, 'idealist', 4);
const PRINTED_ONE = printed(SIDE_ONE, 'capitalist', 1);

/** A `state` carrying nothing but the one field under test. */
function stateWith(openQuestion: unknown): ClientState {
  return { openQuestion } as unknown as ClientState;
}

describe('the presentation order is the server order, and the client never re-draws it', () => {
  it('WIRE_ORDER_SEED renders "as given", which is the whole reason the constant exists', () => {
    expect(presentationOrder(WIRE_ORDER_SEED)).toBe('ab');
    expect(
      promptToProps({ question: QUESTION, sides: [PRINTED_ZERO, PRINTED_ONE], order: 'ba' }).seed,
    ).toBe(WIRE_ORDER_SEED);
  });

  it('copies the server sides positionally, in BOTH server orders, and never sorts', () => {
    // `order: 'ab'` and `order: 'ba'` are two different cards presented two
    // different ways. The props must come out identical in shape and content, and
    // `sides[0]` must be `sideA` in both — a `sort()` here, or a branch on
    // `order`, would be the client deciding which face is which, which is the one
    // thing it must never do.
    for (const order of ['ab', 'ba'] as const) {
      const props = promptToProps({ question: QUESTION, sides: [PRINTED_ZERO, PRINTED_ONE], order });
      expect(props).toEqual({
        question: QUESTION,
        sideA: PRINTED_ZERO,
        sideB: PRINTED_ONE,
        seed: WIRE_ORDER_SEED,
      });
    }
  });

  it('the two mappings are the same mapping, or a click buys the other side', () => {
    // The invariant the whole arrangement rests on: 'A' renders first (asserted
    // above), so 'A' is display index 0 and 'B' is 1, and the server maps display
    // index back through its own `order`. If these ever drift, a player who
    // committed a side silently receives the other one's payout and the game still
    // looks like it is working.
    expect(committedSideToDisplayIndex('A')).toBe(0);
    expect(committedSideToDisplayIndex('B')).toBe(1);
  });
});

describe('the open question is the WHOLE card, in the one safe shape', () => {
  it('reads a well-formed card and preserves display order positionally', () => {
    // Positionally, and never sorted: the server already put them in the order the
    // table is to see them, and re-ordering here would be a second random draw.
    expect(openQuestionOf(stateWith({ question: QUESTION, sides: [PRINTED_ZERO, PRINTED_ONE] }))).toEqual({
      question: QUESTION,
      sides: [PRINTED_ZERO, PRINTED_ONE],
    });
    expect(openQuestionOf(stateWith({ question: QUESTION, sides: [PRINTED_ONE, PRINTED_ZERO] }))).toEqual({
      question: QUESTION,
      sides: [PRINTED_ONE, PRINTED_ZERO],
    });
  });

  it('fails closed on every malformed payload rather than rendering half a card', () => {
    // `undefined` (a server that does not send it), `null`, a non-object, a missing
    // or non-string question, an empty question, a non-array `sides`, a one- or
    // three-element `sides`, a side with no label, an unknown Ideologue, a missing or
    // non-object `pays`, a non-numeric payout, and a payout naming a pool that does not
    // exist. Each must be `null`, which is the caller's "there is nothing on the
    // table" — never a half-rendered card, and never a card with a side the client
    // cannot name.
    const bad: unknown[] = [
      undefined,
      null,
      'a question, as a bare string',
      42,
      {},
      { question: QUESTION },
      { sides: [PRINTED_ZERO, PRINTED_ONE] },
      { question: '', sides: [PRINTED_ZERO, PRINTED_ONE] },
      { question: 7, sides: [PRINTED_ZERO, PRINTED_ONE] },
      { question: QUESTION, sides: PRINTED_ZERO },
      { question: QUESTION, sides: [PRINTED_ZERO] },
      { question: QUESTION, sides: [PRINTED_ZERO, PRINTED_ONE, { label: 'a third door' }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { label: '', ideologue: 'idealist', pays: {} }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, label: 7 }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, ideologue: 'libertarian' }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, ideologue: 7 }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, pays: undefined }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, pays: '4 Funds' }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, pays: { funds: '4' } }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, pays: { funds: Number.NaN } }] },
      { question: QUESTION, sides: [{ ...PRINTED_ZERO }, { ...PRINTED_ONE, pays: { influence: 2 } }] },
    ];
    for (const raw of bad) {
      expect(openQuestionOf(stateWith(raw)), `payload ${JSON.stringify(raw)}`).toBeNull();
    }
  });

  it('REFUSES a card carrying `order`, rather than quietly ignoring it', () => {
    // The one payload field that is not the card's content. `order` is what says which
    // face the first display position is, and with the Ideologue now on the card it is
    // the one field whose disclosure would rebuild the position channel A′ forbids. The
    // other three (`campaign`, `cardId`, and a stray top-level `payout`) ARE silently
    // dropped, because a card id is a lookup key into a public corpus and naming a
    // campaign changes nothing a player can use — but `order` gets the whole card
    // refused, because a payload carrying it has been built against a different (or
    // forged) projection and rendering half of it would be worse than rendering none.
    const withOrder = stateWith({ question: QUESTION, sides: [PRINTED_ZERO, PRINTED_ONE], order: 'ba' });
    expect(openQuestionOf(withOrder)).toBeNull();

    const smuggled = stateWith({
      question: QUESTION,
      sides: [PRINTED_ZERO, PRINTED_ONE],
      campaign: 'Land Reform',
      cardId: 't-ide-0054',
      pays: { funds: 12 },
    });
    expect(openQuestionOf(smuggled)).toEqual({ question: QUESTION, sides: [PRINTED_ZERO, PRINTED_ONE] });
  });
});