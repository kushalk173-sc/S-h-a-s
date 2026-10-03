/**
 * `app/blindWire.ts` — the arithmetic between the wire and the prompt, as a gate.
 *
 * This file is about the SEED-DERIVED ANSWER ORDER and the promise that the client
 * cannot disturb it. The order exists because a card's two answers belong to two
 * different Ideologues and the shipped pool is not balanced side-to-side, so a
 * fixed "side A is always on the left" is a channel: a player who noticed would
 * learn the slot instead of deliberating (PLAN.md §2 amendment A′).
 *
 * THE ORDER IS THE SERVER'S, and this suite is what holds the client to that. The
 * server picks a seed-derived order, sends `labels` ALREADY IN DISPLAY ORDER, and
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
 * is the boundary where a payload becomes props, and the payout property of this
 * screen is a property of that boundary rather than of any component.
 */

import { describe, expect, it } from 'vitest';

import type { ClientState } from '@shasn/engine';

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

/** A `state` carrying nothing but the one field under test. */
function stateWith(openQuestion: unknown): ClientState {
  return { openQuestion } as unknown as ClientState;
}

describe('the presentation order is the server order, and the client never re-draws it', () => {
  it('WIRE_ORDER_SEED renders "as given", which is the whole reason the constant exists', () => {
    expect(presentationOrder(WIRE_ORDER_SEED)).toBe('ab');
    expect(promptToProps({ question: QUESTION, labels: [SIDE_ZERO, SIDE_ONE], order: 'ba' }).seed).toBe(
      WIRE_ORDER_SEED,
    );
  });

  it('copies the server labels positionally, in BOTH server orders, and never sorts', () => {
    // `order: 'ab'` and `order: 'ba'` are two different cards presented two
    // different ways. The props must come out identical in shape and content, and
    // `labels[0]` must be `labelA` in both — a `sort()` here, or a branch on
    // `order`, would be the client deciding which face is which, which is the one
    // thing it must never do.
    for (const order of ['ab', 'ba'] as const) {
      const props = promptToProps({ question: QUESTION, labels: [SIDE_ZERO, SIDE_ONE], order });
      expect(props).toEqual({
        question: QUESTION,
        labelA: SIDE_ZERO,
        labelB: SIDE_ONE,
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

describe('the open question is readable from the payload, and only in the one safe shape', () => {
  it('reads a well-formed {question, labels} and preserves display order positionally', () => {
    // Positionally, and never sorted: the server already put them in the order the
    // table is to see them, and re-ordering here would be a second random draw.
    expect(openQuestionOf(stateWith({ question: QUESTION, labels: [SIDE_ZERO, SIDE_ONE] }))).toEqual({
      question: QUESTION,
      labels: [SIDE_ZERO, SIDE_ONE],
    });
    expect(openQuestionOf(stateWith({ question: QUESTION, labels: [SIDE_ONE, SIDE_ZERO] }))).toEqual({
      question: QUESTION,
      labels: [SIDE_ONE, SIDE_ZERO],
    });
  });

  it('fails closed on every malformed payload rather than rendering half a card', () => {
    // `undefined` (a server that does not send it), `null`, a non-object, a missing
    // or non-string question, an empty question, a non-array `labels`, a one- or
    // three-element `labels`, and a non-string inside it. Each must be `null`, which
    // is the caller's "there is nothing on the table" — never a half-rendered card.
    const bad: unknown[] = [
      undefined,
      null,
      'a question, as a bare string',
      42,
      {},
      { question: QUESTION },
      { labels: [SIDE_ZERO, SIDE_ONE] },
      { question: '', labels: [SIDE_ZERO, SIDE_ONE] },
      { question: 7, labels: [SIDE_ZERO, SIDE_ONE] },
      { question: QUESTION, labels: SIDE_ZERO },
      { question: QUESTION, labels: [SIDE_ZERO] },
      { question: QUESTION, labels: [SIDE_ZERO, SIDE_ONE, 'a third door'] },
      { question: QUESTION, labels: [SIDE_ZERO, 9] },
      { question: QUESTION, labels: ['', SIDE_ONE] },
    ];
    for (const raw of bad) {
      expect(openQuestionOf(stateWith(raw)), `payload ${JSON.stringify(raw)}`).toBeNull();
    }
  });

  it('drops a payout, an Ideologue, an order and a card id if a server ever sends them', () => {
    // Change C — the payout visible before anyone answers — is refused by the TYPE,
    // and this is the runtime half: `OpenQuestion` is two strings and a pair of
    // strings, so there is nowhere for what a side pays to sit. A smuggled payload
    // is reduced to the two fields and the rest is discarded here rather than being
    // carried into a component.
    const smuggled = stateWith({
      question: QUESTION,
      labels: [SIDE_ZERO, SIDE_ONE],
      pays: { funds: 12, clout: 0, media: 0, trust: 0 },
      ideologue: 'capitalist',
      order: 'ab',
      cardId: 't-ide-0054',
      payoutA: 12,
      payoutB: 3,
    });
    expect(openQuestionOf(smuggled)).toEqual({
      question: QUESTION,
      labels: [SIDE_ZERO, SIDE_ONE],
    });
  });
});