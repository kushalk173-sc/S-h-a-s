/**
 * G13 — THE RESPONSE WINDOW: a BLOCK and a DEFLECT.
 *
 * Four properties, and each has a test rather than a comment:
 *
 *  1. **IT IS A PHASE MACHINE, not an effect.** A played card's effects are HELD in
 *     `GameState.interrupt` for exactly as long as somebody could answer them. The
 *     shipped corpus holds no card carrying an `interrupt`, so the whole of this file
 *     is unreachable for it — which is asserted, not assumed.
 *  2. **NO TABLE DEADLOCKS.** Every window is closable in at most `n - 1` declines,
 *     including the two hostile cases the rules create: a BLOCK aimed at the player
 *     who is about to answer, and a BLOCK aimed at the player whose out-of-turn
 *     conspiracy is in the window. `expectALegalMove` walks the action union rather
 *     than asserting the one move we remembered to write.
 *  3. **IT TERMINATES.** One answer per window, because a Block "cannot be reversed
 *     or deflected". Two opponents each holding two reactive cards cannot cascade.
 *  4. **IT LEAKS NOTHING.** The window carries no `responders` list — that is the
 *     field that would tell every client who is holding a BLOCK — and the payload
 *     walks the same structural check `playerView.test.ts` uses.
 */

import { describe, expect, it } from 'vitest';

import type { Ctx } from '../src';
import { RULES } from '../src/rules';
import { reduce } from '../src/reduce';
import { setup } from '../src/setup';
import { allKeys, playerView } from '../src/playerView';
import type {
  CardIndex,
  ConspiracyCard,
  GameState,
  HeadlineCard,
  IdeologyCard,
  Interrupt,
  PlayerID,
  VoterCard,
} from '../src';
import type { Action } from '../src/actions';

// ─────────────────────────── the fixture deck ───────────────────────────

/** BLOCK, verbatim enough to be the real card's mechanism. REF §4.2.1. */
const BLOCK: ConspiracyCard = {
  id: 'int-block',
  name: 'Block',
  text: 'Play this immediately out of turn when an opponent plays a Conspiracy Card to negate its effect.',
  cost: 4,
  effects: [],
  interrupt: { op: 'block', window: 'always', target: 'any-card' },
};

/** DEFLECT, REF §4.2.1. */
const DEFLECT: ConspiracyCard = {
  id: 'int-deflect',
  name: 'Deflect',
  text: 'When an opponent plays a card that affects you, you may play this immediately to redirect its effect.',
  cost: 4,
  effects: [],
  interrupt: { op: 'deflect', window: 'always', target: 'any-card' },
};

/** The card under response. Its whole point is that it moves a pool. */
const PAYOUT: ConspiracyCard = {
  id: 'int-payout',
  name: 'A Payout',
  text: 'Gain 3 Funds.',
  cost: 4,
  effects: [{ op: 'gain', res: { funds: 3 } }],
};

/** The same payout, aimed past its player — for `target: 'card-affecting-you'`. */
const WIDE: ConspiracyCard = {
  id: 'int-wide',
  name: 'A Wide Payout',
  text: 'Each opponent gains 1 resource.',
  cost: 4,
  effects: [{ op: 'gain', res: { funds: 1 }, target: 'each-opponent' }],
};

const HEADLINE_UNDER_RESPONSE: HeadlineCard = {
  id: 'int-hed',
  name: 'A Disgrace',
  text: 'Gain 3 Funds.',
  effects: [{ op: 'gain', res: { funds: 3 } }],
};

/**
 * A second Headline, so draining the queue draws a DIFFERENT card. With one card in
 * the deck `draw` recycles it and the queue only looks stuck.
 */
const HEADLINE_NEXT: HeadlineCard = {
  id: 'int-hed-2',
  name: 'A Rumour',
  text: 'Gain 1 Funds.',
  effects: [{ op: 'gain', res: { funds: 1 } }],
};

const IDEOLOGY: readonly IdeologyCard[] = [
  {
    id: 'int-ig-0',
    campaign: 'interrupt',
    question: 'Question 0?',
    sides: [
      { answer: 'Yes.', ideologue: 'capitalist', pays: { funds: 1 } },
      { answer: 'No.', ideologue: 'idealist', pays: { trust: 1 } },
    ],
  },
  {
    id: 'int-ig-1',
    campaign: 'interrupt',
    question: 'Question 1?',
    sides: [
      { answer: 'Yes.', ideologue: 'supremo', pays: { clout: 1 } },
      { answer: 'No.', ideologue: 'showstopper', pays: { media: 1 } },
    ],
  },
  {
    id: 'int-ig-2',
    campaign: 'interrupt',
    question: 'Question 2?',
    sides: [
      { answer: 'Yes.', ideologue: 'idealist', pays: { trust: 1 } },
      { answer: 'No.', ideologue: 'capitalist', pays: { funds: 1 } },
    ],
  },
  {
    id: 'int-ig-3',
    campaign: 'interrupt',
    question: 'Question 3?',
    sides: [
      { answer: 'Yes.', ideologue: 'showstopper', pays: { media: 1 } },
      { answer: 'No.', ideologue: 'supremo', pays: { clout: 1 } },
    ],
  },
];

const VOTERS: readonly VoterCard[] = [
  { id: 'int-vo-1', cost: { funds: 2 }, voters: 2 },
  { id: 'int-vo-2', cost: { funds: 2 }, voters: 2 },
  { id: 'int-vo-3', cost: { funds: 2 }, voters: 2 },
];

const XCARDS: readonly ConspiracyCard[] = [BLOCK, DEFLECT, PAYOUT, WIDE];
const HEADLINES: readonly HeadlineCard[] = [HEADLINE_UNDER_RESPONSE, HEADLINE_NEXT];

const CTX: Ctx = {
  rules: RULES,
  cards: {
    ideology: Object.fromEntries(IDEOLOGY.map((c) => [c.id, c])),
    voter: Object.fromEntries(VOTERS.map((c) => [c.id, c])),
    conspiracy: Object.fromEntries(XCARDS.map((c) => [c.id, c])),
    headline: Object.fromEntries(HEADLINES.map((c) => [c.id, c])),
  } as CardIndex,
};

/** A turn-1 position with `hand` dealt out, answered into the `actions` phase by default. */
function position(
  hand: Readonly<Record<PlayerID, readonly string[]>>,
  n = 3,
  opts: { readonly answer?: boolean } = {},
): GameState {
  const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const base = setup({
    players,
    cards: CTX.cards,
    seed: 77,
    startResources: Array.from({ length: n }, () => ({ funds: 1, clout: 1, media: 1, trust: 1 })),
    ideologyDeck: IDEOLOGY.map((c) => c.id),
    voterDeck: VOTERS.map((c) => c.id),
    conspiracyDeck: [PAYOUT.id, WIDE.id],
    headlineDeck: HEADLINES.map((c) => c.id),
  });
  const given: GameState = {
    ...base,
    players: Object.fromEntries(
      players.map((p) => [p, { ...base.players[p]!, conspiracies: hand[p] ?? [] }]),
    ),
  };
  if (opts.answer === false) return given;
  const answered = reduce(given, 'p1', { type: 'ANSWER', side: 0 }, CTX);
  if (!answered.ok) throw new Error(answered.error);
  return answered.state;
}

function step(state: GameState, p: PlayerID, a: Action): GameState {
  const r = reduce(state, p, a, CTX);
  if (!r.ok) throw new Error(`${p} ${JSON.stringify(a)} -> ${r.error}`);
  return r.state;
}

function funds(s: GameState, p: PlayerID): number {
  return s.players[p]?.resources.funds ?? -1;
}

/**
 * THE DEADLOCK GATE.
 *
 * Walks a spread of the action union and asserts at least one is legal. Written as a
 * search rather than as a named action on purpose: a test that asserts "PASS_INTERRUPT
 * works" passes even when the window is *also* stuck for the player who matters, and
 * this is the property the whole design exists to guarantee.
 */
function expectALegalMove(s: GameState, where: string): Action {
  const candidates: readonly (readonly [PlayerID, Action])[] = [
    ['p1', { type: 'ANSWER', side: 0 }],
    ['p1', { type: 'END_TURN' }],
    ['p1', { type: 'ACK_HEADLINE' }],
    ['p1', { type: 'PLAY_CONSPIRACY', cardId: BLOCK.id }],
    ['p1', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }],
    ['p1', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p3' }],
    ['p1', { type: 'PASS_INTERRUPT' }],
    ['p2', { type: 'PASS_INTERRUPT' }],
    ['p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }],
    ['p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p3' }],
    ['p3', { type: 'PASS_INTERRUPT' }],
    ['p3', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }],
    ['p3', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p1' }],
  ];
  for (const [p, a] of candidates) {
    if (!s.players[p]) continue;
    if (reduce(s, p, a, CTX).ok) return a;
  }
  for (const c of s.choices) {
    const a: Action = {
      type: 'RESOLVE_CHOICE',
      choiceId: c.id,
      pick: { kind: 'resources', res: { funds: 0 } },
    };
    if (reduce(s, c.player, a, CTX).ok) return a;
  }
  throw new Error(`the table is stuck in ${where}: no action in the union is legal`);
}

// ─────────────────────────── 1. the mechanism ───────────────────────────

describe('G13 — the window opens only when somebody could actually answer', () => {
  it('a card nobody can answer resolves immediately and leaves no window', () => {
    const s = position({ p1: [PAYOUT.id] });
    const after = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    expect(after.interrupt).toBeNull();
    expect(funds(after, 'p1')).toBe(funds(s, 'p1') + 3);
  });

  it('a card somebody CAN answer is held, and nothing it would do has happened', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const after = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    expect(after.interrupt).not.toBeNull();
    expect(after.interrupt?.cardId).toBe(PAYOUT.id);
    expect(after.interrupt?.actor).toBe('p1');
    // THE load-bearing assertion: the staged effect has NOT been applied.
    expect(funds(after, 'p1')).toBe(funds(s, 'p1'));
    // And the table is not stuck.
    expectALegalMove(after, 'a held card');
  });

  it('the actor cannot answer their own card, so a self-held BLOCK is inert', () => {
    const s = position({ p1: [PAYOUT.id, BLOCK.id] });
    const after = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    // `canBeAnswered` skips the actor, so nothing was held in the first place.
    expect(after.interrupt).toBeNull();
    expect(funds(after, 'p1')).toBe(funds(s, 'p1') + 3);
  });

  it('a card with no effects at all is never held — there is nothing to block', () => {
    const s = position({ p1: [BLOCK.id], p2: [BLOCK.id] });
    const after = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: BLOCK.id });
    expect(after.interrupt).toBeNull();
  });

  it('the whole table is frozen except the two window moves and RESOLVE_CHOICE', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    for (const a of [
      { type: 'END_TURN' },
      { type: 'ANSWER', side: 0 },
      { type: 'ACK_HEADLINE' },
      { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id },
    ] as const) {
      const who = a.type === 'PLAY_CONSPIRACY' ? 'p2' : 'p1';
      const r = reduce(held, who, a, CTX);
      expect(r.ok, `${who} ${a.type}`).toBe(false);
    }
  });
});

describe('G13 — a BLOCK negates the card', () => {
  it('cancels the effects entirely', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const after = step(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id });

    expect(after.interrupt).toBeNull();
    expect(funds(after, 'p1')).toBe(funds(s, 'p1'));
    expect(after.log.at(-1)?.text).toBe('Blocked "A Payout".');
  });

  it('the block itself is played, discarded and logged — it is not a free erasure', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const after = step(
      step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }),
      'p2',
      { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id },
    );
    expect(after.players.p2?.conspiracies).toEqual([]);
    expect(after._conspiracyDiscard).toContain(BLOCK.id);
    expect(after.log.some((e) => e.text === 'Played "Block".' && e.player === 'p2')).toBe(true);
  });

  it('a lasting clause blocked is not installed, which is the printed rule', () => {
    const lasting: ConspiracyCard = {
      id: 'int-lasting',
      name: 'A Standing Curse',
      text: 'Every turn, gain 1 voter.',
      cost: 4,
      duration: 'rest-of-game',
      effects: [{ op: 'voters', n: 1 }],
    };
    const ctx: Ctx = {
      ...CTX,
      cards: { ...CTX.cards, conspiracy: { ...CTX.cards.conspiracy, [lasting.id]: lasting } },
    };
    const base = position({ p1: [lasting.id], p2: [BLOCK.id] });
    const held = reduce(base, 'p1', { type: 'PLAY_CONSPIRACY', cardId: lasting.id }, ctx);
    expect(held.ok && held.state.interrupt).not.toBeNull();
    if (!held.ok) return;
    const blocked = reduce(held.state, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }, ctx);
    expect(blocked.ok).toBe(true);
    if (blocked.ok) expect(blocked.state.liveEffects).toEqual([]);
  });
});

describe('G13 — a DEFLECT redirects the resolution', () => {
  it('moves the whole effect list onto the named player', () => {
    const s = position({ p1: [PAYOUT.id], p2: [DEFLECT.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const after = step(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p3' });

    expect(after.interrupt).toBeNull();
    expect(funds(after, 'p1')).toBe(funds(s, 'p1'));
    expect(funds(after, 'p3')).toBe(funds(s, 'p3') + 3);
  });

  it('refuses the one player the card excludes — the actor', () => {
    const s = position({ p1: [PAYOUT.id], p2: [DEFLECT.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const r = reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p1' }, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('back at the player who played it');
    // It refused, the window is still open, and the window is still closable.
    expect(held.interrupt).not.toBeNull();
    expectALegalMove(held, 'a refused deflection');
  });

  it('requires a target — a deflect with nowhere to point is not a card', () => {
    const s = position({ p1: [PAYOUT.id], p2: [DEFLECT.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const r = reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id }, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('name the player');
  });

  it('refuses a target on a BLOCK, which has nothing to redirect', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const r = reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id, at: 'p3' }, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('nothing to redirect');
  });

  it('a held card nobody answers resolves as if there were no window at all', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const oneDown = step(step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }), 'p2', {
      type: 'PASS_INTERRUPT',
    });
    // p3 has not declined yet, so the window is still open.
    expect(oneDown.interrupt).not.toBeNull();
    const done = step(oneDown, 'p3', { type: 'PASS_INTERRUPT' });
    expect(done.interrupt).toBeNull();
    expect(funds(done, 'p1')).toBe(funds(s, 'p1') + 3);
  });
});

// ─────────────────────────── 2. `window` and `target` are READ ───────────────────────────

describe('G13 — the narrowing fields decide, they are not decoration', () => {
  const narrow = (interrupt: Interrupt): ConspiracyCard => ({
    id: 'int-narrow',
    name: 'Narrow',
    text: 'A card with a narrower window.',
    cost: 4,
    effects: [],
    interrupt,
  });
  const withCard = (card: ConspiracyCard): Ctx => ({
    ...CTX,
    cards: { ...CTX.cards, conspiracy: { ...CTX.cards.conspiracy, [card.id]: card } },
  });

  it("'pre-answer' is refused outside the answer phase", () => {
    const card = narrow({ op: 'block', window: 'pre-answer' });
    const ctx = withCard(card);
    const s = position({ p1: [PAYOUT.id], p2: [card.id] });
    const held = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }, ctx);
    expect(held.ok && held.state.interrupt).not.toBeNull();
    if (!held.ok) return;
    expect(held.state.phase).toBe('actions');
    const r = reduce(held.state, 'p2', { type: 'RESPOND_INTERRUPT', cardId: card.id }, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('before an opponent answers');
  });

  it('and honoured during the answer phase, which is the p19 window it names', () => {
    const card = narrow({ op: 'block', window: 'pre-answer' });
    const ctx = withCard(card);
    const s = position({ p2: [PAYOUT.id], p3: [card.id] }, 3, { answer: false });
    expect(s.phase).toBe('answer');
    const held = reduce(s, 'p2', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }, ctx);
    if (!held.ok) throw new Error(held.error);
    const r = reduce(held.state, 'p3', { type: 'RESPOND_INTERRUPT', cardId: card.id }, ctx);
    expect(r.ok).toBe(true);
  });

  it("'card-affecting-you' is refused for a card that only helps its own player", () => {
    const card = narrow({ op: 'block', window: 'always', target: 'card-affecting-you' });
    const ctx = withCard(card);
    const s = position({ p1: [PAYOUT.id], p2: [card.id] });
    const held = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }, ctx);
    if (!held.ok) throw new Error(held.error);
    const r = reduce(held.state, 'p2', { type: 'RESPOND_INTERRUPT', cardId: card.id }, ctx);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('other than the one who played it');
  });

  it('and accepted for a card that reaches past its own player', () => {
    const card = narrow({ op: 'block', window: 'always', target: 'card-affecting-you' });
    const ctx = withCard(card);
    const s = position({ p1: [WIDE.id], p2: [card.id] });
    const held = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: WIDE.id }, ctx);
    if (!held.ok) throw new Error(held.error);
    const r = reduce(held.state, 'p2', { type: 'RESPOND_INTERRUPT', cardId: card.id }, ctx);
    expect(r.ok).toBe(true);
  });
});

// ─────────────────────────── 3. no deadlock, and it terminates ───────────────────────────

describe('G13 — the window can always be closed', () => {
  it('HOSTILE CASE: a BLOCK on the player who is about to answer', () => {
    // p1 is in `answer`; p2 plays a conspiracy out of turn (p19); p3 blocks it. This
    // is the shape the rules create and the one a naive implementation stalls on,
    // because the active player is mid-answer with a card they cannot put down.
    const s = position({ p2: [PAYOUT.id], p3: [BLOCK.id] }, 3, { answer: false });
    expect(s.phase).toBe('answer');
    const held = step(s, 'p2', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    expect(held.interrupt).not.toBeNull();
    expectALegalMove(held, 'a block on the player about to answer');

    // p1, who has not answered, can decline. So can p3 — by blocking.
    const oneDown = step(held, 'p1', { type: 'PASS_INTERRUPT' });
    expect(oneDown.interrupt).not.toBeNull();
    const done = step(oneDown, 'p3', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id });
    expect(done.interrupt).toBeNull();
    // And the game is still mid-answer on p1, with their card still in front of them.
    expect(done.phase).toBe('answer');
    expect(done._pendingCard).not.toBeNull();
    expectALegalMove(done, 'after the block, mid-answer');
  });

  it('HOSTILE CASE: a block on the conspiracy whose own player is mid-window', () => {
    const s = position({ p2: [PAYOUT.id], p3: [BLOCK.id] }, 3, { answer: false });
    const held = step(s, 'p2', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    // The actor cannot decline and cannot answer. Everyone else can.
    expect(reduce(held, 'p2', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(false);
    expect(reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: PAYOUT.id }, CTX).ok).toBe(false);
    const oneDown = step(held, 'p1', { type: 'PASS_INTERRUPT' });
    for (const mid of [held, oneDown]) expectALegalMove(mid, 'mid pass-round');
    // p1 and p3 decline, which is every player the window was waiting on.
    const done = step(oneDown, 'p3', { type: 'PASS_INTERRUPT' });
    expect(done.interrupt).toBeNull();
    expect(funds(done, 'p2')).toBe(funds(s, 'p2') + 3);
  });

  it('closes in at most n-1 declines, at every seat count the game supports', () => {
    for (const n of [2, 3, 4, 5]) {
      const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      const s = position({ [players[0]!]: [PAYOUT.id], [players[1]!]: [BLOCK.id] }, n);
      let cur = step(s, players[0]!, { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
      let declines = 0;
      while (cur.interrupt !== null && declines <= n + 1) {
        const who = cur.interrupt.actor;
        const next = players.find((p) => p !== who && !cur.interrupt?.passed.includes(p));
        if (next === undefined) break;
        cur = step(cur, next, { type: 'PASS_INTERRUPT' });
        declines += 1;
        expectALegalMove(cur, `${n} seats, ${declines} declines`);
      }
      expect(cur.interrupt, `${n} seats`).toBeNull();
      expect(declines, `${n} seats`).toBeLessThanOrEqual(n - 1);
    }
  });

  it('a frozen player is not required to decline, and can always thaw', () => {
    // p3 is over their resource cap and owes a `lose-any`. The window must not make
    // them a hostage, and `RESOLVE_CHOICE` must stay legal inside it.
    const s: GameState = {
      ...position({ p1: [PAYOUT.id], p2: [BLOCK.id] }),
      choices: [{ id: 'c-test', player: 'p3', choice: { kind: 'lose-any', count: 1, reason: 'Resource cap' } }],
    };
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    // p3 is frozen, so a pass from them is refused by the per-player freeze…
    expect(reduce(held, 'p3', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(false);
    // …and p1 is the actor, who is not asked to decline at all…
    expect(reduce(held, 'p1', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(false);
    // …so p2 ALONE closes the window: the required set is p2, with p3 excluded
    // because it cannot act and p1 because it played the card.
    const cur = step(held, 'p2', { type: 'PASS_INTERRUPT' });
    expect(cur.interrupt).toBeNull();
    // The choice is untouched throughout, and still answerable.
    expect(cur.choices.map((c) => c.player)).toEqual(['p3']);
    const thawed = reduce(
      cur,
      'p3',
      { type: 'RESOLVE_CHOICE', choiceId: 'c-test', pick: { kind: 'resources', res: { funds: 1 } } },
      CTX,
    );
    expect(thawed.ok).toBe(true);
  });

  it('TERMINATION: a window takes exactly one answer, so reactive cards cannot cascade', () => {
    // Two opponents each hold a Block and a Deflect — four reactive cards on the
    // table — and the window still closes on the first one that is played.
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id, DEFLECT.id], p3: [BLOCK.id, DEFLECT.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const once = step(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id });
    expect(once.interrupt).toBeNull();
    // Every remaining reactive card is back in somebody's hand, still playable later.
    expect(once.players.p2?.conspiracies).toEqual([DEFLECT.id]);
    expect(once.players.p3?.conspiracies).toEqual([BLOCK.id, DEFLECT.id]);
    expectALegalMove(once, 'after a cascade attempt');
  });

  it('a second answer to the same window is refused', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id], p3: [BLOCK.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const after = step(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id });
    expect(after.interrupt).toBeNull();
    // The window is gone, so there is nothing left to answer.
    expect(reduce(after, 'p3', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }, CTX).ok).toBe(false);
  });

  it('a declined player cannot decline twice, and the actor can do neither', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    const held = step(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id });
    const once = step(held, 'p2', { type: 'PASS_INTERRUPT' });
    expect(reduce(once, 'p2', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(false);
    expect(reduce(once, 'p1', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(false);
    expect(reduce(once, 'p1', { type: 'RESPOND_INTERRUPT', cardId: PAYOUT.id }, CTX).ok).toBe(false);
  });

  it('the two window moves are refused outright when no window is open', () => {
    const s = position({ p1: [PAYOUT.id], p2: [BLOCK.id] });
    expect(reduce(s, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }, CTX).ok).toBe(false);
    expect(reduce(s, 'p2', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(false);
  });
});

// ─────────────────────────── 4. a Headline can be answered too ───────────────────────────

describe('G13 — DEFLECT covers a Headline, and the queue still drains', () => {
  function headlinePosition(): GameState {
    const s = position({ p2: [DEFLECT.id] });
    return {
      ...s,
      phase: 'headlines',
      activeHeadline: HEADLINE_UNDER_RESPONSE.id,
      // Two deep, for the same reason `scripts/playable.ts` uses two: with one,
      // `ACK_HEADLINE` runs the queue into `advanceTurn` and the turn boundary is
      // what moves, not the card. The draw pile is pinned so draining the queue
      // provably puts a DIFFERENT card up — with one card in the deck `draw`
      // recycles it and the queue only looks stuck.
      _headlineDraw: [HEADLINE_NEXT.id, HEADLINE_UNDER_RESPONSE.id],
      headlineQueue: [
        { areaId: '', by: 'p1' },
        { areaId: '', by: 'p1' },
      ],
    };
  }

  it('a deflected Headline resolves onto the named player and the queue carries on', () => {
    const s = headlinePosition();
    const held = step(s, 'p1', { type: 'ACK_HEADLINE' });
    expect(held.interrupt).not.toBeNull();
    expect(held.interrupt?.kind).toBe('headline');
    expectALegalMove(held, 'a held Headline');

    const done = step(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p3' });
    expect(done.interrupt).toBeNull();
    expect(done.phase).toBe('headlines');
    // The queue advanced exactly one Headline, not to the end of the turn.
    expect(done.headlineQueue.length).toBe(1);
    expect(done.activeHeadline).toBe(HEADLINE_NEXT.id);
    expect(funds(done, 'p3')).toBe(funds(s, 'p3') + 3);
  });

  it('the Headline is discarded whether or not it was answered', () => {
    const s = headlinePosition();
    const held = step(s, 'p1', { type: 'ACK_HEADLINE' });
    expect(held._headlineDiscard).toContain(HEADLINE_UNDER_RESPONSE.id);
    const done = step(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p3' });
    expect(done._headlineDiscard).toContain(HEADLINE_UNDER_RESPONSE.id);
  });
});

// ─────────────────────────── 5. purity, replay, and the leak gate ───────────────────────────

describe('G13 — it is a pure function of (state, action, ctx)', () => {
  const script: readonly { p: PlayerID; a: Action }[] = [
    { p: 'p1', a: { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id } },
    { p: 'p2', a: { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p3' } },
    { p: 'p1', a: { type: 'END_TURN' } },
  ];

  const run = (): string[] => {
    let s = position({ p1: [PAYOUT.id], p2: [DEFLECT.id], p3: [BLOCK.id] });
    const out: string[] = [];
    for (const { p, a } of script) {
      const r = reduce(s, p, a, CTX);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
      out.push(JSON.stringify(s));
    }
    return out;
  };

  it('a full replay from seed + action log reproduces every intermediate state', () => {
    const recorded = run();
    // Interleave unrelated games, which is what makes module-scope state visible.
    run();
    step(position({ p1: [WIDE.id], p3: [BLOCK.id] }, 4), 'p1', { type: 'PLAY_CONSPIRACY', cardId: WIDE.id });
    step(
      step(position({ p1: [PAYOUT.id], p2: [BLOCK.id] }), 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }),
      'p2',
      { type: 'PASS_INTERRUPT' },
    );
    expect(run()).toEqual(recorded);
  });

  it('the recorded run really does go THROUGH a window', () => {
    // Otherwise the replay above would be proving determinism about a path nothing
    // exercised, which is the failure mode a green determinism test has.
    const first = reduce(position({ p1: [PAYOUT.id], p2: [DEFLECT.id], p3: [BLOCK.id] }), 'p1', {
      type: 'PLAY_CONSPIRACY',
      cardId: PAYOUT.id,
    }, CTX);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.interrupt).not.toBeNull();
    let s = first.state;
    for (const { p, a } of script.slice(1)) s = step(s, p, a);
    expect(s.interrupt).toBeNull();
  });

  it('the window leaks nothing, at any depth, to any viewer', () => {
    const held = step(position({ p1: [PAYOUT.id], p2: [BLOCK.id], p3: [DEFLECT.id] }), 'p1', {
      type: 'PLAY_CONSPIRACY',
      cardId: PAYOUT.id,
    });
    const states = [
      held,
      step(held, 'p3', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT.id, at: 'p2' }),
    ];
    for (const st of states) {
      for (const viewer of st.turnOrder) {
        const client = playerView(st, viewer);
        expect(allKeys(client).filter((k) => k.startsWith('_')), viewer).toEqual([]);
        for (const q of client.turnOrder) {
          expect(client.players[q]?.conspiracies, `${viewer} seeing ${q}`).toEqual([]);
        }
      }
    }
  });

  it('and it names NOBODY who could respond — that is the field that must never exist', () => {
    const held = step(position({ p1: [PAYOUT.id], p2: [BLOCK.id], p3: [DEFLECT.id] }), 'p1', {
      type: 'PLAY_CONSPIRACY',
      cardId: PAYOUT.id,
    });
    const w = held.interrupt;
    expect(w).not.toBeNull();
    if (w === null) return;
    // The load-bearing property, asserted rather than argued: while the window is
    // OPEN, no player who could answer it is named anywhere in it. `responder` and
    // `deflectedTo` are null until somebody has already played a card face up, and
    // the only list of seats is `passed` — a list of people who DECLINED, and so
    // have revealed nothing at all about their hands.
    expect(w.responder).toBeNull();
    expect(w.deflectedTo).toBeNull();
    for (const key of Object.keys(w)) {
      const value = (w as unknown as Record<string, unknown>)[key];
      if (!Array.isArray(value) || key === 'passed') continue;
      const seats = value.filter((v) => typeof v === 'string' && held.players[v as PlayerID] !== undefined);
      expect(seats, `${key} names a seat`).toEqual([]);
    }
    // And the two cards that could answer it are in NO client's payload.
    const json = JSON.stringify(playerView(held, 'p1'));
    expect(json).not.toContain(BLOCK.id);
    expect(json).not.toContain(DEFLECT.id);
  });

  it('the window carries only a card that is already face up', () => {
    const held = step(position({ p1: [PAYOUT.id], p2: [BLOCK.id] }), 'p1', {
      type: 'PLAY_CONSPIRACY',
      cardId: PAYOUT.id,
    });
    // The card under response is public: the same action logged it and discarded it.
    expect(held.log.some((e) => e.text === 'Played "A Payout".')).toBe(true);
    expect(held._conspiracyDiscard).toContain(PAYOUT.id);
    for (const v of held.turnOrder) {
      expect(JSON.stringify(playerView(held, v))).toContain(PAYOUT.id);
    }
  });
});

describe('G13 — the shipped corpus is untouched by the staging branch', () => {
  it('no shipped card carries an interrupt, so no game can ever open a window', async () => {
    // The reason the blast radius is this small: `canBeAnswered` is only ever true
    // for a Conspiracy Card with an executable `interrupt`, and the deck files
    // contain none. `packages/cards/test/reducer-parity.test.ts` asserts the same
    // fact over the corpus; this one asserts the consequence in the engine.
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../cards/decks/', import.meta.url);
    const files = readdirSync(dir, { recursive: true }) as string[];
    const decks = files.filter((f) => f.endsWith('.json'));
    expect(decks.length).toBeGreaterThan(0);
    for (const f of decks) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(text.includes('"interrupt"'), f).toBe(false);
    }
  });
});
