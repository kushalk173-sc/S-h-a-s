/**
 * G13 — THE RESPONSE WINDOW: a BLOCK and a DEFLECT.
 *
 * Five properties, and each has a test rather than a comment:
 *
 *  1. **IT IS A PHASE MACHINE, not an effect.** A played card's effects are HELD in
 *     `GameState.interrupt` for exactly as long as somebody could answer them.
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
 *  5. **THE SHIPPED CORPUS IS EXECUTABLE.** BLOCK and DEFLECT ship as `ct-et2040-014`
 *     / `ct-et2040-015`, so the window is reachable for the real decks — and the last
 *     describe block drives those two real cards through `reduce` to prove it. That
 *     block also records WHY the ban it replaced existed; read the long comment above
 *     it before touching anything in it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';

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

// ─────────────────────── 4. the shipped corpus, and what it now relies on ───────────────────────

/**
 * ## WHAT REPLACED THE BAN, AND WHY THIS IS STRONGER
 *
 * There WAS a test here that read every deck file and asserted the string
 * `"interrupt"` appeared in none of them. It was not a style rule. It was the
 * mechanical statement of a real hazard:
 *
 *  - `canBeAnswered` (reduce.ts) is true only when another player holds a
 *    Conspiracy Card whose `interrupt` the engine acts on, and `resolveCard` then
 *    STAGES the played card's effects in `GameState.interrupt` instead of applying
 *    them. A window needs up to `n - 1` declines to close.
 *  - At the time, nothing could act during one. `packages/server/test/driver.ts`
 *    could not drive a window, and the client rendered no pass control, so a player
 *    holding a BLOCK would watch a played card sit unresolved with no legal move
 *    available. That is why BLOCK and DEFLECT were deliberately held out of the
 *    shipped decks.
 *
 * Two things now discharge that obligation, and they are the reason the ban is
 * replaced rather than lifted:
 *
 *  1. **the server driver acts during a window** — `packages/server/test/driver.ts`
 *     answers a response window, so a held card is always closable over the wire;
 *  2. **the client renders one with a pass control**, so a human always has the
 *     `PASS_INTERRUPT` move on screen.
 *
 * So a reactive card is now shippable, and the hazard this file guarded against has
 * moved DOWNSTREAM — to those two packages. What is left for the ENGINE to assert is
 * therefore no longer "reactive cards are banned" but the stronger, more precise
 * claim the corpus actually relies on:
 *
 *  - **exactly two** shipped cards carry an executed interrupt, by id. A third is a
 *    change somebody makes on purpose; the count notices.
 *  - **each one's op is a key of the registry `reduce.ts` declares**, re-derived here
 *    from `reduce.ts`'s own source text, the way
 *    `packages/cards/test/reducer-parity.test.ts` does it — so the guard cannot be
 *    satisfied by editing the check.
 *  - **each one is actually EXECUTABLE**: the real card, out of the real deck file,
 *    is driven through `reduce` and must open a window and then answer it. This is
 *    the part that is strictly stronger than a ban. A ban could only ever say "no";
 *    this says "these two, and the engine does something with them". A card that
 *    executes but whose downstream support does not exist is the same failure, one
 *    boundary further out — so the boundary is asserted where the obligation now is.
 *
 * `packages/cards/test/reducer-parity.test.ts` pins the same two ids from the cards
 * side (what a card MAY say) and this file pins them from the engine side (what
 * `reduce` DOES). Both oracles, neither able to satisfy the other.
 */

/** One deck file's `cards` array, with the path for the failure message. */
type DeckFile = { readonly file: string; readonly cards: readonly unknown[] };

/** Every deck file the cards package ships, parsed. Read-only: nothing here writes. */
function shippedDecks(): readonly DeckFile[] {
  // Imported statically rather than with a dynamic `await import`, because a test
  // that has to remember to be async before it can see the corpus is a test that can
  // be skipped by an early return above it.
  const dir = new URL('../../cards/decks/', import.meta.url);
  const files = (readdirSync(dir, { recursive: true }) as string[])
    // Normalised to `/` because `readdirSync(recursive)` hands back the platform
    // separator, and a pinned path string is not a thing to assert on Windows.
    .map((f) => f.split(sep).join('/'))
    .filter((f) => f.endsWith('.json'));
  // Non-zero, or "the corpus is empty" and every assertion below is vacuously true.
  // The cards package is a sibling workspace, not a dependency of the engine, so
  // this is a filesystem read and NOT an import of `packages/cards/src` — the engine
  // has zero runtime dependencies and keeps them that way.
  if (files.length === 0) throw new Error(`no deck files under ${dir.href}`);
  return files.map((f) => {
    const parsed = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as {
      readonly cards?: readonly unknown[];
    };
    if (!Array.isArray(parsed.cards)) throw new Error(`${f} has no cards array`);
    return { file: f, cards: parsed.cards };
  });
}

/** A shipped card that carries an `interrupt`, read as narrowly as the engine type. */
type Reactive = {
  readonly id: string;
  readonly file: string;
  readonly card: ConspiracyCard;
  readonly interrupt: Interrupt;
};

function isReactiveCard(value: unknown): value is ConspiracyCard & { readonly interrupt: Interrupt } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'interrupt' in value &&
    (value as { interrupt?: unknown }).interrupt !== undefined
  );
}

/** Every card carrying an `interrupt`, across `decks`, in a stable order. */
function reactiveCardsIn(decks: readonly DeckFile[]): readonly Reactive[] {
  const out: Reactive[] = [];
  for (const deck of decks) {
    for (const raw of deck.cards) {
      if (!isReactiveCard(raw)) continue;
      out.push({ id: raw.id, file: deck.file, card: raw, interrupt: raw.interrupt });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The two ids the corpus relies on, sorted — the one pinned list in this file. */
const PINNED_REACTIVE_IDS: readonly string[] = ['ct-et2040-014', 'ct-et2040-015'];

/**
 * The corpus assertion, as a function so the teeth test can run the SAME one against
 * a deliberately broken corpus rather than a paraphrase of it.
 */
function assertPinnedCorpus(found: readonly Reactive[]): void {
  expect(found.map((r) => r.id)).toEqual(PINNED_REACTIVE_IDS);
}

/**
 * The ops `RESPOND_INTERRUPT` acts on, re-derived from `reduce.ts`'s own source.
 *
 * The same derivation `packages/cards/test/reducer-parity.test.ts` performs, done
 * again here because the engine is where the promise lives: the registry is a
 * `const` inside `reduce.ts`, not something exported, and this package may not edit
 * `packages/cards/` to reach it. A guard that imported the registry would be checking
 * the cards package's copy of a promise about this file.
 */
function reactiveOpsInReducer(): readonly string[] {
  const src = readFileSync(new URL('../src/reduce.ts', import.meta.url), 'utf8');
  const start = src.indexOf('const REACTIVE_INTERRUPTS');
  expect(start, 'reduce.ts still has REACTIVE_INTERRUPTS').toBeGreaterThan(-1);
  const close = src.indexOf('};', start);
  expect(close, 'reduce.ts still closes REACTIVE_INTERRUPTS').toBeGreaterThan(-1);
  const body = src.slice(start, close);
  return [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!).sort();
}

/**
 * The `window` / `target` values `mayRespond` DISTINGUISHES.
 *
 * `'always'` and `'any-card'` have no literal to find — they are the absence of a
 * refusal, the `else` — so this is a subset check in one direction, exactly as
 * `reducer-parity` frames it. The direction with teeth is: everything the reducer
 * distinguishes must be a value the engine's own `Interrupt` type declares, or the
 * reducer is acting on a value no card can name.
 */
function mayRespondDistinguishes(field: 'window' | 'target'): readonly string[] {
  const src = readFileSync(new URL('../src/reduce.ts', import.meta.url), 'utf8');
  const start = src.indexOf('function mayRespond');
  expect(start, 'reduce.ts still has mayRespond').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}', start));
  const out = new Set<string>();
  for (const m of body.matchAll(new RegExp(`interrupt\\.${field} === '([a-z-]+)'`, 'g'))) {
    if (m[1] !== undefined) out.add(m[1]);
  }
  return [...out].sort();
}

/** The declared enums, spelled out from the engine's own union so they cannot drift. */
const DECLARED_WINDOWS: readonly Interrupt['window'][] = ['always', 'pre-answer'];
const DECLARED_TARGETS: readonly Interrupt['target'][] = ['any-card', 'card-affecting-you'];

/** A Ctx carrying one real shipped reactive card on top of the fixture deck. */
function ctxWith(reactive: Reactive): Ctx {
  return {
    ...CTX,
    cards: {
      ...CTX.cards,
      conspiracy: { ...CTX.cards.conspiracy, [reactive.card.id]: reactive.card },
    },
  };
}

/**
 * A turn-1 position dealt `hand`, in a Ctx of our own choosing.
 *
 * `position` is hard-wired to `CTX`; this is the same construction with the ctx as
 * a parameter, so the executability test can drive the REAL card rather than a
 * fixture that only resembles it.
 */
function positionIn(
  ctx: Ctx,
  hand: Readonly<Record<PlayerID, readonly string[]>>,
  n = 3,
): GameState {
  const players = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const base = setup({
    players,
    cards: ctx.cards,
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
  const answered = reduce(given, 'p1', { type: 'ANSWER', side: 0 }, ctx);
  if (!answered.ok) throw new Error(answered.error);
  return answered.state;
}

describe('G13d — the shipped corpus, and the support it now relies on', () => {
  it('carries exactly two reactive cards, by id, and a third would fail here', () => {
    // THE PIN. A reactive card is now shippable, so the load-bearing claim is the
    // exact size of the set rather than its emptiness. `assertPinnedCorpus` is a
    // function precisely so the next case can run this same assertion against a
    // broken corpus — see "it has teeth" below.
    const found = reactiveCardsIn(shippedDecks());
    assertPinnedCorpus(found);
    // Named, so the failure says WHICH card and WHICH deck file, not just two arrays
    // that differ. A third card in a deck nobody opened is otherwise invisible.
    expect(found.map((r) => `${r.id} in ${r.file}`).join('\n')).toBe(
      'ct-et2040-014 in et2040/conspiracy.json\nct-et2040-015 in et2040/conspiracy.json',
    );
  });

  it('has teeth: a third reactive card, or either card losing its interrupt, fails the pin', () => {
    // NON-VACUITY, as a permanent test rather than a one-off manual mutation. The two
    // edits a future agent is most likely to make are exactly these two, and both are
    // checked against the SAME `assertPinnedCorpus` the corpus case above runs — so
    // this cannot pass by testing a weaker thing than the thing that guards the decks.
    const decks = shippedDecks();
    const found = reactiveCardsIn(decks);

    // (a) A third card gains an interrupt.
    const third: DeckFile = {
      file: 'synthetic/et2040-conspiracy.json',
      cards: [
        {
          id: 'ct-et2040-016',
          name: 'A Third Reaction',
          text: 'A card that is not in the corpus.',
          cost: 5,
          effects: [],
          interrupt: { op: 'block', window: 'always', target: 'any-card' },
        },
      ],
    };
    expect(reactiveCardsIn([...decks, third]).length).toBe(found.length + 1);
    expect(() => assertPinnedCorpus(reactiveCardsIn([...decks, third]))).toThrow();

    // (b) Either shipped card loses its `interrupt` block — the shape the ban used
    // to enforce, and the one that silently makes the card a 5-cost "gain 1 Clout"
    // that can never answer anything.
    for (const victim of PINNED_REACTIVE_IDS) {
      const withoutIt = decks.map((d) => ({
        file: d.file,
        cards: d.cards.map((c) => {
          if (typeof c !== 'object' || c === null) return c;
          const card = c as { id?: string };
          if (card.id !== victim) return c;
          const { interrupt: _dropped, ...rest } = c as Record<string, unknown>;
          return rest;
        }),
      }));
      const reduced = reactiveCardsIn(withoutIt);
      expect(reduced.map((r) => r.id), `${victim} lost its interrupt`).not.toContain(victim);
      expect(() => assertPinnedCorpus(reduced)).toThrow();
    }
  });

  it('every shipped interrupt names an op RESPOND_INTERRUPT acts on, re-derived from reduce.ts', () => {
    // Not a hardcoded `['block','deflect']`. The registry is read out of
    // `REACTIVE_INTERRUPTS` in `reduce.ts` itself, so this file cannot drift from the
    // reducer — the same seam `reducer-parity` cuts, cut again from the engine side
    // because the engine is the package that owns the promise.
    const ops = reactiveOpsInReducer();
    // Not empty, or the check above is satisfied by asserting nothing.
    expect(ops.length).toBeGreaterThan(0);
    for (const r of reactiveCardsIn(shippedDecks())) {
      expect(ops, `${r.id} carries interrupt op ${r.interrupt.op}`).toContain(r.interrupt.op);
    }
  });

  it('and every window and target it names is one mayRespond reads', () => {
    // `mayRespond` distinguishes the narrow value and falls through on the wide one,
    // so the declared enum must be a superset of what it names. A card naming
    // anything else is a declaration the engine ignores, which is the exact failure
    // the old ban existed to keep out of the corpus.
    expect(mayRespondDistinguishes('window')).toEqual(['pre-answer']);
    expect(mayRespondDistinguishes('target')).toEqual(['card-affecting-you']);
    for (const r of reactiveCardsIn(shippedDecks())) {
      expect(DECLARED_WINDOWS, `${r.id} window`).toContain(r.interrupt.window);
      expect(DECLARED_TARGETS, `${r.id} target`).toContain(r.interrupt.target);
    }
  });

  it('EXECUTABILITY: the real card, out of the real deck file, opens a window and answers it', () => {
    // THE STRONGER GUARD, and the reason this replaces a ban rather than being
    // deleted. The ban could only say "no reactive card ships". This drives each
    // shipped card through `reduce` — no fixture, no card object written by hand in
    // this file — and requires that it (a) makes a window open at all, which is
    // `canBeAnswered` consulting `isReactive(card.interrupt.op)` and nothing else, and
    // (b) is then accepted by `RESPOND_INTERRUPT` and performs its op.
    //
    // A card that ships with an `interrupt` the engine ignores would pass every
    // absence/presence check and fail HERE, which is the failure the old assertion
    // was reaching for by a blunter route.
    const found = reactiveCardsIn(shippedDecks());
    expect(found.length).toBe(PINNED_REACTIVE_IDS.length);

    for (const r of found) {
      const ctx = ctxWith(r);
      const s = positionIn(ctx, { p1: [PAYOUT.id], p2: [r.id] });

      // (a) The card is what makes the window exist at all. Without it, `PAYOUT`
      // resolves immediately and there is nothing to answer.
      const held = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }, ctx);
      expect(held.ok, `${r.id}: p1 could not play ${PAYOUT.id}`).toBe(true);
      if (!held.ok) continue;
      expect(held.state.interrupt, `${r.id} opens no window`).not.toBeNull();
      expect(held.state.interrupt?.cardId).toBe(PAYOUT.id);
      expect(funds(held.state, 'p1'), `${r.id}: the staged gain already happened`).toBe(
        funds(s, 'p1'),
      );

      // (b) `RESPOND_INTERRUPT` accepts it and the op is performed. `mayRespond` is
      // consulted for real here, so a `window`/`target` the reducer refuses fails
      // rather than being assumed harmless.
      const action: Action =
        r.interrupt.op === 'deflect'
          ? { type: 'RESPOND_INTERRUPT', cardId: r.id, at: 'p3' }
          : { type: 'RESPOND_INTERRUPT', cardId: r.id };
      const answered = reduce(held.state, 'p2', action, ctx);
      expect(answered.ok, `${r.id} is not executable by RESPOND_INTERRUPT`).toBe(true);
      if (!answered.ok) continue;
      expect(answered.state.interrupt, `${r.id} left the window open`).toBeNull();

      // And the consequence of the op, which is what distinguishes an executed
      // interrupt from a merely accepted one.
      if (r.interrupt.op === 'block') {
        expect(funds(answered.state, 'p1'), `${r.id} did not negate the card`).toBe(
          funds(held.state, 'p1'),
        );
      } else {
        expect(funds(answered.state, 'p3'), `${r.id} did not redirect the resolution`).toBe(
          funds(held.state, 'p3') + 3,
        );
        expect(funds(answered.state, 'p1'), `${r.id} resolved for the actor anyway`).toBe(
          funds(held.state, 'p1'),
        );
      }
      // Played face up, not a free erasure: it is out of the responder's hand, on the
      // discard pile, and in the public log.
      expect(answered.state.players.p2?.conspiracies, `${r.id} stayed in hand`).not.toContain(
        r.id,
      );
      expect(answered.state._conspiracyDiscard).toContain(r.id);
      expect(answered.state.log.some((e) => e.player === 'p2')).toBe(true);
    }
  });
});

describe('G13 — the engine refuses other actions while a window is open', () => {
  it('including PLAY_CONSPIRACY, and the server must offer nothing while it does', () => {
    // Recorded here, on the engine side, because `playableConspiraciesFor` in
    // `packages/server/src/broadcast.ts` is the thing that has to agree with it.
    //
    // THE VERDICT: the refusal is CORRECT and belongs in the engine. Two reasons, and
    // the first is not a matter of taste:
    //
    //  1. `PLAY_CONSPIRACY` routes through `resolveCard` (reduce.ts:2038), which
    //     RETURNS A NEW `state.interrupt` (reduce.ts:1362-1381) when the card it is
    //     playing is itself answerable. It does not merge, queue, or nest. So a
    //     `PLAY_CONSPIRACY` admitted during an open window would REPLACE the window,
    //     and the first card's staged `effects` — the ones still sitting in
    //     `InterruptWindow.effects` — would never be applied by anything. The public
    //     log has already said `Played "X".` and `PLAY_CONSPIRACY` has already
    //     discarded the card to `_conspiracyDiscard`. The card's effects would vanish
    //     with the card face up on the table and in the discard pile. That is a
    //     permanent, silent loss of a resolved effect, which is the strongest
    //     possible argument for the freeze.
    //  2. The window's termination proof is `mustRespond` + `PASS_INTERRUPT`: at most
    //     `n - 1` declines, ONE answer, then `closeInterrupt`. Admitting a second
    //     card play mid-window lets the table inject new work into a countdown whose
    //     whole invariant is that the staged effects are the only thing in it.
    //
    // p19's out-of-turn play is NOT the counter-argument: that is the `answer`-phase
    // window, honoured separately by `outOfTurnOk` (reduce.ts:1596) and by
    // `PLAY_CONSPIRACY`'s own phase check (reduce.ts:2025). It is a licence to act
    // during the answer phase, not during a G13 window.
    const s = position({ p1: [PAYOUT.id, WIDE.id], p2: [BLOCK.id] });
    const held = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }, CTX);
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.state.interrupt).not.toBeNull();

    // The active player, mid-window, with a second card in hand: refused, and the
    // window is untouched and still closable.
    const refused = reduce(held.state, 'p1', { type: 'PLAY_CONSPIRACY', cardId: WIDE.id }, CTX);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toBe(
      '"A Payout" is resolving — answer it or decline first',
    );
    expect(held.state.interrupt?.cardId).toBe(PAYOUT.id);
    expect(held.state.players.p1?.conspiracies).toContain(WIDE.id);
    expectALegalMove(held.state, 'a refused mid-window conspiracy play');

    // And the two moves that ARE legal, so the freeze is a phase and not a deadlock:
    // the holder answers, and a player with nothing to answer declines.
    expect(
      reduce(held.state, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK.id }, CTX).ok,
    ).toBe(true);
    expect(reduce(held.state, 'p3', { type: 'PASS_INTERRUPT' }, CTX).ok).toBe(true);
  });
});
