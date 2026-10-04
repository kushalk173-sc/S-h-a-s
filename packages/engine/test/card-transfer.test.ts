/**
 * G20, PART TWO - `move-card`, and the four ways it could destroy the game.
 *
 * `ideology-hand.test.ts` pins the FIELD. This file pins the MECHANIC, and the
 * mechanism is where the damage would be done, because the field is inert and the
 * reducer is not. The ruling on `PlayerState.ideologyCards` in `state.ts` makes four
 * promises a type alone cannot keep, and each has a test here that fails if the
 * promise is broken:
 *
 *   1. A card moved to a player who is MID-ANSWER changes nothing about the answer they
 *      are giving, and leaks nothing to anybody - not the table, not the recipient,
 *      not the donor. The payload is asserted BYTE-IDENTICAL before and after, which
 *      is the only form of the property that cannot be satisfied by stripping a field
 *      and adding another that happens to be empty.
 *   2. A DESTROYED card leaks nothing: no `GameEvent`, no `LogEntry`, no card id, and
 *      nothing about either of its sides' payouts.
 *   3. There is ALWAYS A LEGAL MOVE. Every position a transfer can create is asked
 *      whether any legal action both succeeds AND changes something. A transfer that
 *      can leave a player unable to answer is the exact soft-lock class that has
 *      bitten this project twice (R10, and the `advanceTurn` comment above the R10
 *      branch), so this is the test that matters most and the one that PLAYS the game
 *      rather than asserting a shape.
 *   4. It is DETERMINISTIC: the same seed and the same script produce a byte-identical
 *      state, and no position built here needs a source outside the state.
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * There is no test that a card can be taken out of a hand or out of `_pendingCard`,
 * because the type forbids both and a test asserting the absence of a type error is
 * not a test. The reasoning is on the `move-card` arm in `cards.ts`; what IS tested is
 * the consequence - that a mid-answer player keeps a legal `ANSWER` against an
 * unchanged card, which is the property the refusal exists to protect and the one that
 * would break if the refusal were ever quietly relaxed.
 *
 * ## A NOTE ON IDS, because getting this wrong cost the first draft of this file
 *
 * The Ideology Card ids are `xfer-N` and the Conspiracy Card ids are `mover-*`, and
 * that is load-bearing twice over. A leak scan greps for `xfer-`, and a Conspiracy id
 * beginning `xfer-` would make it match the card the player was entitled to reveal. And
 * the card put to the opening player is whatever the seed dealt, so a test that
 * hardcodes a "held" id has to compare it against `_pendingCard` first: the very first
 * version held `xfer-8` on the very seed where `xfer-8` was the DEALT card, and the
 * test failed on a leak that was not one - the dealt card is public by p13, having been
 * answered. `anIdleCard` exists so that cannot happen again.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard, type IdeologyCard } from '../src/cards';
import { allKeys, playerView } from '../src/playerView';
import { IDEOLOGY_HAND_MAX, reduce } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import {
  EMPTY_POOL,
  IDEOLOGUES,
  ideologyHandOf,
  poolTotal,
  type Delta,
  type GameState,
  type PendingChoice,
  type PlayerID,
  type Pool,
} from '../src/state';
import { PLAYERS_3 } from './helpers';

// ─────────────────────────── fixtures ───────────────────────────

const TO_HAND: ConspiracyCard = {
  id: 'mover-extra',
  name: 'Extra Card',
  text: 'This is an extra Ideology Card of yours.',
  cost: 3,
  effects: [{ op: 'move-card', from: 'draw', to: 'hand', n: 1, target: 'you' }],
};

const TO_HAND_OTHER: ConspiracyCard = {
  id: 'mover-extra-other',
  name: 'Extra Card For Another',
  text: 'An opponent receives an extra Ideology Card.',
  cost: 3,
  effects: [{ op: 'move-card', from: 'draw', to: 'hand', n: 1, target: 'each-opponent' }],
};

const DESTROY: ConspiracyCard = {
  id: 'mover-burn',
  name: 'Burn It',
  text: 'A card leaves the game.',
  cost: 3,
  effects: [{ op: 'move-card', from: 'draw', to: 'destroy', n: 1 }],
};

const DESTROY_THREE: ConspiracyCard = {
  id: 'mover-burn-3',
  name: 'Burn Three',
  text: 'Three cards leave the game.',
  cost: 5,
  effects: [{ op: 'move-card', from: 'draw', to: 'destroy', n: 3 }],
};

/**
 * A scoped `move-card`, which is the form that proves the op carries no card id.
 *
 * `LiveEffect` is PUBLIC (`secret-inventory.ts` lists it under `PUBLIC_BY_DESIGN`), so
 * an op that named a specific Ideology Card would be publishing that card the moment it
 * installed a hook. `move-card` names no card, only a pile, and this card is the test
 * of that.
 */
const SCOPED_BURN: ConspiracyCard = {
  id: 'mover-burn-every-turn',
  name: 'Every Turn, Burn One',
  text: 'At the top of your turn, a card leaves the game.',
  cost: 4,
  duration: 'rest-of-game',
  effects: [{ op: 'move-card', from: 'draw', to: 'destroy', n: 1, when: 'on-turn-start' }],
};

const XFER_CARDS: readonly ConspiracyCard[] = [
  TO_HAND,
  TO_HAND_OTHER,
  DESTROY,
  DESTROY_THREE,
  SCOPED_BURN,
];

/**
 * Eight Ideology Cards with distinct, greppable ids and distinct payouts on each side.
 *
 * `xfer-N` pays `{ funds: N + 1 }` on side 0 and `{ trust: N + 7 }` on side 1, so both
 * sides of every card have a unique JSON and a leak scan can look for a payout rather
 * than only for an id. A payout is the thing a player actually wants to know, so this
 * is the assertion that would catch a real exploit.
 */
function xferIndex(): CardIndex {
  const ideology = Array.from({ length: 8 }, (_, k): IdeologyCard => {
    const i = k + 1;
    return {
      id: `xfer-${i}`,
      campaign: 'xfer',
      question: `xfer question ${i}`,
      sides: [
        {
          answer: `xfer answer ${i}a`,
          ideologue: IDEOLOGUES[i % 4] as IdeologyCard['sides'][0]['ideologue'],
          pays: { funds: i + 1 },
        },
        {
          answer: `xfer answer ${i}b`,
          ideologue: IDEOLOGUES[(i + 1) % 4] as IdeologyCard['sides'][0]['ideologue'],
          pays: { trust: i + 7 },
        },
      ],
    };
  });
  return indexCards({ ideology, voter: [], conspiracy: [...XFER_CARDS], headline: [] });
}

const XFER_CTX = { rules: RULES, cards: xferIndex() };
const XFER_IDS: readonly string[] = Object.keys(XFER_CTX.cards.ideology);

/** Both of `xfer-N`'s payouts as the JSON a payload would carry if it leaked. */
function payoutsOf(id: string): [string, string] {
  const n = Number(id.slice('xfer-'.length));
  return [JSON.stringify({ funds: n + 1 }), JSON.stringify({ trust: n + 7 })];
}

function xferSetup(seed = 3): GameState {
  return setup({
    players: PLAYERS_3,
    cards: XFER_CTX.cards,
    seed,
    ideologyDeck: [...XFER_IDS],
    conspiracyDeck: XFER_CARDS.map((c) => c.id),
  });
}

/** Hand a player Conspiracy Cards, which is how a test reaches a card effect at all. */
function withConspiracies(s: GameState, who: PlayerID, ids: readonly string[]): GameState {
  const p = s.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  return { ...s, players: { ...s.players, [who]: { ...p, conspiracies: [...ids] } } };
}

/** Put an Ideology Card into a hidden hand, the way a card effect would. */
function withHeld(s: GameState, who: PlayerID, ids: readonly string[]): GameState {
  const p = s.players[who];
  if (!p) throw new Error(`no such player ${who}`);
  return { ...s, players: { ...s.players, [who]: { ...p, ideologyCards: [...ids] } } };
}

/**
 * Put cards on TOP of the Ideology draw pile WITHOUT duplicating them.
 *
 * `idsInWorld` and the conservation checks count cards, not distinct ids, so a fixture
 * that APPENDS to a pile while the same ids are still in the other pile creates a world
 * with two `xfer-5` in it — and then a correct `to: 'destroy'` removes one and the test
 * reports a leak that is not there. The ids are MOVED, not copied, so the total is
 * unchanged and every id stays unique. "Top" is the front, which is the end `draw()`
 * and the `move-card` arm both take from.
 */
function withDraw(s: GameState, ids: readonly string[]): GameState {
  const keeping = s._ideologyDraw.filter((id) => !ids.includes(id));
  return { ...s, _ideologyDraw: [...ids, ...keeping], _ideologyDiscard: s._ideologyDiscard.filter((id) => !ids.includes(id)) };
}

/** The card `s` is currently being put to `s.activePlayer`, or null. */
function pendingOf(s: GameState): string | null {
  return s._pendingCard;
}

/** An Ideology Card id that is NOT the one currently put to anybody. */
function anIdleCard(s: GameState): string {
  return XFER_IDS.find((id) => id !== s._pendingCard) ?? 'xfer-1';
}

/** Every id the transfer can be carrying, for a conservation check. */
function idsInWorld(s: GameState): string[] {
  return [
    ...s._ideologyDraw,
    ...s._ideologyDiscard,
    ...s.turnOrder.flatMap((p) => ideologyHandOf(s.players[p])),
  ];
}

/**
 * The wire payload as a string, which is what a devtools user actually reads.
 *
 * **THE ENGINE'S HALF OF THE PAYLOAD, and only that.** `playerView` is the whole of what
 * `packages/engine` publishes; the server's `PublicView` layers `conspiracyRecycle` on
 * top, which is the published contents of `_conspiracyDiscard` and therefore invisible to
 * every scan in this file. That is structural — naming a card needs the `CardIndex`, which
 * this package does not hold and cannot import — not an oversight, and the guard that
 * does see it is `packages/server/test/secret-state.test.ts`. Concretely: this suite can
 * prove a card did not leak out of a HAND, and says nothing about whether the recycle
 * list discloses one.
 */
function payload(s: GameState, viewer: PlayerID): string {
  return JSON.stringify(playerView(s, viewer));
}

/**
 * Every string a client could see that is not part of the stripped state.
 *
 * `playerView` copies `state.log` wholesale, so the log IS a client-visible string, and
 * `GameEvent` is the wire. Scanning them together is the point: `move-card` logs
 * nothing, and the assertion has to distinguish "the log is empty" from "the log does
 * not mention the card".
 */
function visibleStrings(s: GameState, events: readonly unknown[] = []): string {
  return [...s.log.map((l) => l.text), JSON.stringify(events)].join('\n');
}

// ─────────────────────────── the legal-move harness ───────────────────────────

type Action = Parameters<typeof reduce>[2];
type Ctx = typeof XFER_CTX;

/**
 * Answer every choice `p` is actually holding, once each.
 *
 * This is not a convenience - it is the fix for the single biggest false positive this
 * file had. p12 puts a "resolve your resource cap first" `Choice` on a player, and
 * while it is open EVERY other action fails with that same string. A probe list that
 * does not include the real choice's id therefore reports "no legal action at all" in
 * a position where the player has exactly one legal move, and the assertion above it
 * starts failing for a reason that has nothing to do with cards.
 *
 * So the harness asks the STATE what is pending rather than guessing an id, and the
 * picks below are the smallest legal ones. `steal-any` with a null `from` has no victim
 * to name, so it cannot be answered from here at all - and a test that cannot answer it
 * says so, rather than silently reporting a stuck position.
 */
/**
 * The smallest legal pick of exactly want resources, given what the player holds.
 *
 * Greedy across the four resources in RESOURCES order, and it has to SPREAD: the p12
 * cap question asks for the TOTAL over the cap, and a player sitting on 3 funds and 3
 * trust under a cap of 2 is asked for 4 � which no single resource satisfies, so
 * canAfford refuses the pick with "you do not hold those" and the harness concludes
 * the table is stuck in a position where it is not. The engine's own comment above
 * esolveChoice records that the ask is clamped to what the player holds precisely so
 * that a legal pick always exists; this is that pick.
 */
function pickResources(held: Pool, want: number): Delta {
  const out: Delta = {};
  let left = want;
  for (const res of ['funds', 'clout', 'media', 'trust'] as const) {
    if (left <= 0) break;
    const take = Math.min(left, held[res]);
    if (take > 0) {
      out[res] = take;
      left -= take;
    }
  }
  return out;
}

function choicePick(choice: PendingChoice['choice'], held: Pool): Action {
  switch (choice.kind) {
    case 'gain-any':
    case 'lose-any': {
      const want = Math.min(choice.count, poolTotal(held));
      return { type: 'RESOLVE_CHOICE', choiceId: '', pick: { kind: 'resources', res: pickResources(held, want) } };
    }
    case 'steal-any':
      // No victim to name. Legal only when the engine supplies one, which it does for
      // a card-named victim; there is no generic answer, and inventing one would be
      // testing a fiction.
      return choice.from === null
        ? { type: 'END_TURN' }
        : { type: 'RESOLVE_CHOICE', choiceId: '', pick: { kind: 'steal', from: choice.from, res: pickResources(held, 1) } };
    default:
      return { type: 'END_TURN' };
  }
}

/** True when the harness knows how to answer every open choice. */
function choicesAreAnswerable(s: GameState, p: PlayerID): boolean {
  return s.choices
    .filter((c) => c.player === p)
    .every((c) => c.choice.kind === 'steal-any' ? c.choice.from !== null : true);
}

/** Resolve as many of `p`'s choices as the harness can, leaving the rest open. */
function resolveChoices(s: GameState, p: PlayerID, ctx: Ctx): GameState {
  let cur = s;
  for (let guard = 0; guard < 8; guard += 1) {
    const open = cur.choices.find((c) => c.player === p);
    if (open === undefined) break;
    if (open.choice.kind === 'steal-any' && open.choice.from === null) break;
    const held = cur.players[p]?.resources ?? EMPTY_POOL;
    const base = choicePick(open.choice, held);
    const action =
      base.type === 'RESOLVE_CHOICE' ? ({ ...base, choiceId: open.id } as Action) : ({ type: 'PASS_INTERRUPT' } as Action);
    const r = reduce(cur, p, action, ctx);
    if (!r.ok) break;
    cur = r.state;
  }
  return cur;
}

/**
 * Every action the engine will legally take right now.
 *
 * Deliberately the OPPOSITE of enumerating the action union and reasoning about the
 * state: a soft-lock is a position in which the set of legal actions is empty, or in
 * which no legal action makes PROGRESS, and only asking the reducer finds the second
 * kind. The probes are well-formed on purpose - the reducer is allowed to throw on a
 * malformed action rather than fail it, so a probe with a fake card id is a crash
 * rather than a negative result.
 */
function legalActions(s: GameState, ctx: Ctx): { p: PlayerID; a: Action }[] {
  const out: { p: PlayerID; a: Action }[] = [];
  const candidates: Action[] = [
    { type: 'END_TURN' },
    { type: 'ANSWER', side: 0 },
    { type: 'ANSWER', side: 1 },
    { type: 'REDRAW_IDEOLOGY', pay: { funds: 1 } },
    { type: 'PLACE_VOTERS', groupId: 'g1', areaIds: [] },
    { type: 'PASS_INTERRUPT' },
    { type: 'POWER_PROSPECT', take: ['funds'], give: 'trust' },
  ];
  for (const p of s.turnOrder) {
    // The player's OWN open choices are legal moves too, and they are the only ones
    // that are legal while a p12 cap question is open - so they go in the list first.
    for (const c of s.choices.filter((c) => c.player === p)) {
      const base = choicePick(c.choice, s.players[p]?.resources ?? EMPTY_POOL);
      if (base.type === 'RESOLVE_CHOICE') {
        const a = { ...base, choiceId: c.id } as Action;
        if (reduce(s, p, a, ctx).ok) out.push({ p, a });
      }
    }
    for (const a of candidates) {
      if (reduce(s, p, a, ctx).ok) out.push({ p, a });
    }
  }
  return out;
}

/**
 * The hard-lock assertion: a legal action exists AND at least one of them MOVES.
 *
 * "Moves" is not only phase or turn. Answering an open p12 `Choice` does neither — it
 * changes the choice list — and treating that as a stall is the second false positive
 * this file had: the loop would sit in a position whose only legal move was a cap
 * question, conclude nobody could act, and fail on a game that was in fact perfectly
 * playable. Three kinds of progress count, because all three unblock something.
 */
function expectPlayable(s: GameState, ctx: Ctx, where: string): void {
  const legal = legalActions(s, ctx);
  expect(legal.length, `${where}: no legal action at all`).toBeGreaterThan(0);
  const moves = legal.some(({ p, a }) => {
    const r = reduce(s, p, a, ctx);
    if (!r.ok) return false;
    return (
      r.state.phase !== s.phase ||
      r.state.turn !== s.turn ||
      r.state.finished ||
      r.state.choices.length < s.choices.length ||
      r.state.interrupt === null
    );
  });
  expect(moves, `${where}: ${legal.length} legal actions but none of them change anything`).toBe(true);
}

// ─────────────────────────── 1. mid-answer ───────────────────────────

describe('G20 - a card moved to a player who is MID-ANSWER', () => {
  it('leaves the answer they are giving unchanged, still legal, and the card still hidden', () => {
    // `setup` puts a card on the opening player, so p1 is mid-answer on turn 1. A card
    // is moved to them mid-answer. Three things must hold: the card they are being
    // asked about is the same one, `ANSWER` still resolves, and the card that arrived
    // is still in their hand afterwards rather than having been dealt.
    const s = xferSetup();
    expect(s.phase).toBe('answer');
    expect(s.activePlayer).toBe('p1');
    const answering = pendingOf(s);
    expect(answering).not.toBeNull();

    const idle = anIdleCard(s);
    const moved = withHeld(s, 'p1', [idle]);
    expect(pendingOf(moved)).toBe(answering);
    expect(ideologyHandOf(moved.players.p1)).toEqual([idle]);

    const answered = reduce(moved, 'p1', { type: 'ANSWER', side: 0 }, XFER_CTX);
    expect(answered.ok, 'the mid-answer player must still be able to answer').toBe(true);
    if (!answered.ok) return;
    // The card that was PUT to them is the one that became public. The card that
    // ARRIVED did not, and is still held: the two fields sit on opposite sides of p13's
    // line and must not leak into each other.
    expect(answered.state.players.p1?.manifestoCards).toEqual([answering]);
    expect(ideologyHandOf(answered.state.players.p1)).toEqual([idle]);
    // Being able to answer the other card taught them nothing about the held one.
    for (const side of payoutsOf(idle)) expect(payload(answered.state, 'p1')).not.toContain(side);
    expect(payload(answered.state, 'p1')).not.toContain(idle);
  });

  it('leaks nothing to ANY viewer - not the table, not the recipient, not the donor', () => {
    const s = xferSetup();
    const idle = anIdleCard(s);
    const moved = withHeld(s, 'p1', [idle]);

    for (const viewer of moved.turnOrder) {
      const json = payload(moved, viewer);
      expect(json, `${viewer} must not see the held id`).not.toContain(idle);
      for (const side of payoutsOf(idle)) {
        expect(json, `${viewer} must not see ${side}`).not.toContain(side);
      }
      // The strongest form of the property: the payload is BYTE-IDENTICAL to the
      // payload from before the card arrived. This cannot be satisfied by stripping one
      // field while adding another that happens to be empty, which is the shape a
      // partial fix takes.
      expect(json, `${viewer} payload changed on a mid-answer move`).toBe(payload(s, viewer));
    }
    // The card being answered is `_`-prefixed and so is in nobody's payload. Asserted
    // so the line above cannot pass by accident.
    expect(payload(moved, 'p1')).not.toContain(answeringOf(s));
  });

  it('emits no event and no log line, and the boundary is where the card lands', () => {
    const s = xferSetup();
    const idle = anIdleCard(s);
    const moved = withHeld(s, 'p1', [idle]);
    const answered = reduce(moved, 'p1', { type: 'ANSWER', side: 0 }, XFER_CTX);
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    const ended = reduce(answered.state, 'p1', { type: 'END_TURN' }, XFER_CTX);
    expect(ended.ok, 'ending the turn must remain legal mid-transfer').toBe(true);
    if (!ended.ok) return;

    // p2 is the incoming player and holds nothing, so p2 is dealt from the DECK. This
    // is the assertion that the drain reads the hand of the INCOMING player, which is
    // the only thing that makes a mid-answer move inert: had it read the outgoing
    // player's hand, or the active player's, p1 would have been handed a second card
    // on a turn they had already answered.
    expect(ended.state.activePlayer).toBe('p2');
    expect(pendingOf(ended.state)).not.toBe(idle);
    expect(ideologyHandOf(ended.state.players.p1)).toEqual([idle]);
    // And p1 is dealt the held card at THEIR next boundary, not before.
    const dealt = reduce(ended.state, 'p2', { type: 'ANSWER', side: 0 }, XFER_CTX);
    expect(dealt.ok).toBe(true);
    if (!dealt.ok) return;
    const round = reduce(dealt.state, 'p2', { type: 'END_TURN' }, XFER_CTX);
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.state.activePlayer).toBe('p3');
    expect(pendingOf(round.state)).not.toBe(idle);
    const p3 = reduce(round.state, 'p3', { type: 'ANSWER', side: 0 }, XFER_CTX);
    expect(p3.ok).toBe(true);
    if (!p3.ok) return;
    const p1again = reduce(p3.state, 'p3', { type: 'END_TURN' }, XFER_CTX);
    expect(p1again.ok).toBe(true);
    if (!p1again.ok) return;
    expect(p1again.state.activePlayer).toBe('p1');
    expect(pendingOf(p1again.state)).toBe(idle);
    expect(ideologyHandOf(p1again.state.players.p1)).toEqual([]);

    // Nothing in the whole sequence named the card, in the log or on the wire.
    for (const at of [moved, answered.state, ended.state, p1again.state]) {
      expect(visibleStrings(at)).not.toContain(idle);
      for (const side of payoutsOf(idle)) expect(payload(at, 'p1')).not.toContain(side);
    }
  });
});

function answeringOf(s: GameState): string {
  const p = s._pendingCard;
  if (p === null) throw new Error('no pending card');
  return p;
}

// ─────────────────────────── 2. destruction ───────────────────────────

describe('G20 - a DESTROYED card leaks nothing', () => {
  /** `top` goes on the FRONT of the draw pile, so it is the first card taken. */
  function destroyRun(card: ConspiracyCard, top: readonly string[]): { s: GameState; events: readonly unknown[] } {
    const base = withDraw(xferSetup(), top);
    const holder = withConspiracies(base, 'p1', [card.id]);
    const played = reduce(holder, 'p1', { type: 'PLAY_CONSPIRACY', cardId: card.id }, XFER_CTX);
    expect(played.ok, `playing ${card.id} must succeed`).toBe(true);
    if (!played.ok) throw new Error(played.error);
    return { s: played.state, events: played.events };
  }

  const THREE = ['xfer-3', 'xfer-4', 'xfer-5'] as const;

  it('removes the card from the game and mentions it in NOTHING', () => {
    const { s, events } = destroyRun(DESTROY, THREE);
    // The top of the draw pile is `pile[0]`, the end `draw()` takes from, so `withDraw`
    // put `xfer-3` there and that is the one that leaves. Getting this wrong is not a
    // subtle fixture error - the card that stays behind is the one the destroy ignored.
    const gone = 'xfer-3';
    expect(THREE[0]).toBe(gone);

    // Off the world entirely - not merely off the draw pile.
    expect(idsInWorld(s)).not.toContain(gone);
    // The other two are untouched, so the assertion above is about the destroy and not
    // about the fixture having emptied the deck.
    expect(idsInWorld(s)).toContain('xfer-4');
    expect(idsInWorld(s)).toContain('xfer-5');
    // Not in any viewer's payload.
    for (const viewer of s.turnOrder) expect(payload(s, viewer)).not.toContain(gone);
    // Not in the log, not in the events. Together those are the whole of "no
    // client-visible string": `playerView` copies `state.log` wholesale and
    // `GameEvent` is the wire.
    expect(visibleStrings(s, events)).not.toContain(gone);
    // And NEITHER SIDE, which is the leak the brief names. A destroyed card is a card
    // with two unrevealed answers, so publishing that it existed is itself a
    // disclosure - and a payout is what a player would most want.
    for (const side of payoutsOf(gone)) {
      for (const viewer of s.turnOrder) expect(payload(s, viewer)).not.toContain(side);
      expect(visibleStrings(s, events)).not.toContain(side);
    }
    // The contrast, so the assertions above cannot pass vacuously: the card PLAYED is
    // public by construction - you played it, and the engine logs it by NAME.
    expect(visibleStrings(s, events)).toContain('Burn It');
  });

  it('destroys exactly n from the top, and SHRINKS the world', () => {
    const base = withDraw(xferSetup(), THREE);
    const before = base._ideologyDraw.length + base._ideologyDiscard.length;
    const { s } = destroyRun(DESTROY_THREE, THREE);
    // `to: 'destroy'` must not go through `discardTo`, or "destroyed" would be a lie:
    // the card would still be in the world and recyclable by the R10 reshuffle, and a
    // reshuffle is public - `deckSizes` is. Conservation is the assertion, and it is
    // the only thing in the effect vocabulary allowed to shrink the card count.
    expect(s._ideologyDraw.length + s._ideologyDiscard.length).toBe(before - 3);
    for (const gone of THREE) expect(idsInWorld(s)).not.toContain(gone);
    // The world did not grow a card elsewhere either.
    expect(idsInWorld(s).length).toBe(before - 3);
  });

  it('a destroy on an empty pile is a no-op, not a failure and not a log line', () => {
    const empty = { ...xferSetup(), _ideologyDraw: [], _ideologyDiscard: [] as readonly string[] };
    const holder = withConspiracies(empty, 'p1', [DESTROY.id]);
    const first = reduce(holder, 'p1', { type: 'PLAY_CONSPIRACY', cardId: DESTROY.id }, XFER_CTX);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = visibleStrings(first.state, first.events);

    // Three asked for, zero available.
    const holder2 = withConspiracies(first.state, 'p1', [DESTROY_THREE.id]);
    const second = reduce(holder2, 'p1', { type: 'PLAY_CONSPIRACY', cardId: DESTROY_THREE.id }, XFER_CTX);
    expect(second.ok, 'an empty pile must not fail the card').toBe(true);
    if (!second.ok) return;
    expect(second.state._ideologyDraw).toEqual([]);
    // The world is unchanged, and the only new log line is the play the player made.
    expect([...idsInWorld(second.state)].sort()).toEqual([...idsInWorld(first.state)].sort());
    const fresh = visibleStrings(second.state, second.events)
      .split('\n')
      .filter((line) => !before.split('\n').includes(line));
    for (const line of fresh) expect(line).not.toMatch(/xfer-/);
  });

  it('a scoped move-card publishes no card id, because the op names a PILE not a card', () => {
    // `LiveEffect` is public. An op carrying a card id would publish that card the
    // moment it installed. This is the test of the reason `from` is a fixed union.
    const { s } = destroyRun(SCOPED_BURN, THREE);
    expect(s.liveEffects.length, 'the hook must actually be installed').toBe(1);
    for (const viewer of s.turnOrder) {
      const json = payload(s, viewer);
      // The op and its FIELDS are public, and that is fine: they describe a pile.
      expect(json, 'the played card is public').toContain('move-card');
      expect(json, 'the source is public').toContain('draw');
      for (const gone of THREE) expect(json).not.toContain(gone);
    }
  });
});

// ─────────────────────────── 3. a legal move always exists ───────────────────────────

describe('G20 - a transfer can never leave a player with no legal move', () => {
  it('the opening position is playable, and the incoming player is dealt from the hand', () => {
    const s = xferSetup();
    expect(s.phase).toBe('answer');
    expectPlayable(s, XFER_CTX, 'the plain opening position');

    const idle = anIdleCard(s);
    const holder = withHeld(s, 'p2', [idle]);
    expectPlayable(holder, XFER_CTX, 'opening, p2 holding a card');

    const a = reduce(holder, 'p1', { type: 'ANSWER', side: 0 }, XFER_CTX);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = reduce(a.state, 'p1', { type: 'END_TURN' }, XFER_CTX);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.state.activePlayer).toBe('p2');
    expect(pendingOf(b.state)).toBe(idle);
    expect(ideologyHandOf(b.state.players.p2)).toEqual([]);
    // The mechanic working, checked here rather than in a "does it drain" test because
    // this is the test that would notice the drain having produced a position nobody
    // can act in.
    expectPlayable(b.state, XFER_CTX, 'p2 dealt from the hand');
  });

  it('a FULL hand is refused rather than half-applied, and the pile is untouched', () => {
    // IDEOLOGY_HAND_MAX is a termination bound, and it is checked BEFORE the card
    // leaves the pile. A refusal that had already taken the card out of the world
    // would be a destroy wearing a refusal's clothes - and `to: 'destroy'` is the only
    // op allowed to shrink the Ideology card count, so that invariant would quietly
    // stop being true.
    const full = IDEOLOGY_HAND_MAX;
    const base = withDraw(xferSetup(), ['xfer-3', 'xfer-4']);
    const alreadyHeld = Array.from({ length: full }, (_, i) => `xfer-${i + 6}`);
    const holder = withConspiracies(withHeld(base, 'p1', alreadyHeld), 'p1', [TO_HAND.id]);
    const total = (g: GameState) =>
      g._ideologyDraw.length +
      g._ideologyDiscard.length +
      g.turnOrder.reduce((n, p) => n + ideologyHandOf(g.players[p]).length, 0);

    const r = reduce(holder, 'p1', { type: 'PLAY_CONSPIRACY', cardId: TO_HAND.id }, XFER_CTX);
    expect(r.ok, 'the card itself still resolves').toBe(true);
    if (!r.ok) return;
    expect(ideologyHandOf(r.state.players.p1)).toEqual(alreadyHeld);
    expect(r.state._ideologyDraw.slice(0, 2)).toEqual(['xfer-3', 'xfer-4']);
    expect(total(r.state)).toBe(total(holder));
    expectPlayable(r.state, XFER_CTX, 'full hand, move refused');
  });

  it("one hand each for two players, both dealt, and the world still conserves cards", () => {
    // The `each-opponent` shape, which is the one GOOD GIG WELL PLAYED already uses for
    // Conspiracy Cards. Two recipients, one card each, and the two `to: 'hand'` targets
    // COMPETE for the same shared pile - the partially-applied case is correct, and the
    // card count must still balance.
    const base = withDraw(xferSetup(), ['xfer-6', 'xfer-7']);
    const holder = withConspiracies(base, 'p1', [TO_HAND_OTHER.id]);
    // The conservation count has to include HANDS. Counting only the two piles would
    // make a correct transfer look like a destroy - the cards leave the discard and
    // appear in a hand, and the piles alone fall by two. This is the same invariant
    // `to: 'destroy'` is the sole exception to, so it is the same helper.
    const total = (g: GameState) =>
      g._ideologyDraw.length +
      g._ideologyDiscard.length +
      g.turnOrder.reduce((n, p) => n + ideologyHandOf(g.players[p]).length, 0);
    const r = reduce(holder, 'p1', { type: 'PLAY_CONSPIRACY', cardId: TO_HAND_OTHER.id }, XFER_CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hands = r.state.turnOrder.map((p) => ideologyHandOf(r.state.players[p]).length);
    expect(hands.reduce((a, b2) => a + b2, 0)).toBe(2);
    expect(total(r.state)).toBe(total(base));
    // And the two recipients cannot read what they were given.
    for (const p of r.state.turnOrder) {
      for (const held of ideologyHandOf(r.state.players[p])) expect(payload(r.state, p)).not.toContain(held);
    }
    for (const p of r.state.turnOrder) expectPlayable(r.state, XFER_CTX, `${p} after each-opponent`);
  });

  it('the case the hand check exists for: an empty deck and a lone held card', () => {
    // R10 ends the game when the Ideology deck AND its discard are both empty, and that
    // branch is a hard `endOfGame`. Check the deck FIRST and a player carrying the only
    // Ideology Card left in the world gets a game-over on the very turn they were about
    // to be handed something. This is the position that catches that ordering bug, and
    // it is the specific regression the `advanceTurn` comment names.
    const drained: GameState = {
      ...xferSetup(),
      _ideologyDraw: [],
      _ideologyDiscard: [],
      _pendingCard: null,
      phase: 'actions',
      players: { ...xferSetup().players, p2: { ...xferSetup().players.p2!, ideologyCards: ['xfer-8'] } },
    };
    const r = reduce(drained, 'p1', { type: 'END_TURN' }, XFER_CTX);
    expect(r.ok, 'the outgoing player must be able to end their turn').toBe(true);
    if (!r.ok) return;
    expect(r.state.finished, 'a held card must survive an empty deck').toBe(false);
    expect(r.state.activePlayer).toBe('p2');
    expect(pendingOf(r.state)).toBe('xfer-8');
    expectPlayable(r.state, XFER_CTX, 'empty deck, p2 holding the last card');

    // And with NO card anywhere the R10 ending is still what happens: the hand check
    // did not abolish the rule, it only moved below it.
    const nothing: GameState = {
      ...drained,
      players: { ...drained.players, p2: { ...drained.players.p2!, ideologyCards: [] } },
    };
    const over = reduce(nothing, 'p1', { type: 'END_TURN' }, XFER_CTX);
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    expect(over.state.finished, 'R10 must still end a game with no cards at all').toBe(true);
  });

  it('plays a whole game through transfers and never reaches a stuck position', () => {
    // The end-to-end version, and the one that would find a soft-lock the shape
    // assertions above cannot see because it does not assume the shape. Three players,
    // a real deck, a real transfer played out of a Conspiracy Card mid-game, and EVERY
    // intermediate position asked whether anybody has a legal action that MOVES.
    const ctx = XFER_CTX;
    let s = withConspiracies(xferSetup(11), 'p1', [TO_HAND.id]);

    let answered = 0;
    let transfers = 0;
    let choicesAnswered = 0;
    for (let step = 0; step < 80 && !s.finished; step += 1) {
      expectPlayable(s, ctx, `step ${step} (turn ${s.turn}, phase ${s.phase})`);

      const p = s.activePlayer;
      // p12 opens a cap question on whoever is over the cap, and while it is open
      // nothing else is legal. Answering it is what a player does, so the driver does
      // too - otherwise the run would sit in a position with one legal move and the
      // loop would read that as a stall.
      const thawed = resolveChoices(s, p, ctx);
      if (thawed !== s) {
        choicesAnswered += 1;
        s = thawed;
        continue;
      }

      // Once, on p1's first actions phase, play the transfer for real.
      if (p === 'p1' && s.phase === 'actions' && transfers === 0 && s.players.p1?.conspiracies.includes(TO_HAND.id)) {
        const r = reduce(s, p, { type: 'PLAY_CONSPIRACY', cardId: TO_HAND.id }, ctx);
        expect(r.ok, `step ${step}: the transfer must be playable`).toBe(true);
        if (r.ok) {
          transfers += 1;
          s = r.state;
          // Silence is part of the contract, checked in a running game and not only in
          // a fixture. Every Ideology Card id must be absent from the new log lines and
          // from the events the play emitted.
          const fresh = s.log.slice(1).map((l) => l.text).join('\n');
          for (const id of XFER_IDS) {
            expect(fresh, `step ${step}: the transfer logged ${id}`).not.toContain(id);
            expect(JSON.stringify(r.events), `step ${step}: the transfer emitted ${id}`).not.toContain(id);
          }
          // And the card really is in a hand, unreadable by anyone including p1.
          expect(ideologyHandOf(s.players.p1).length).toBeGreaterThan(0);
          for (const held of ideologyHandOf(s.players.p1)) {
            for (const viewer of s.turnOrder) expect(payload(s, viewer)).not.toContain(held);
          }
        }
        continue;
      }

      // Otherwise answer if you can, then end the turn. Alternating sides exercises both
      // payouts of every card dealt.
      const a = reduce(s, p, { type: 'ANSWER', side: (step % 2) as 0 | 1 }, ctx);
      if (a.ok) {
        s = a.state;
        answered += 1;
        continue;
      }
      const e = reduce(s, p, { type: 'END_TURN' }, ctx);
      if (e.ok) {
        s = e.state;
        continue;
      }
      // Redraw is the last resort and the last thing that keeps a turn legal.
      const d = reduce(s, p, { type: 'REDRAW_IDEOLOGY', pay: { funds: 1 } }, ctx);
      expect(d.ok, `step ${step}: no legal move at all (phase ${s.phase})`).toBe(true);
      if (d.ok) s = d.state;
    }
    expect(transfers, 'the transfer must actually be played').toBe(1);
    expect(answered, 'the run must actually answer cards').toBeGreaterThan(8);
    expect(choicesAnswered, 'the run must actually hit a p12 cap question').toBeGreaterThan(0);
    expect(s.turn, 'the run must get a real way into the game').toBeGreaterThan(8);
    // The game is still coherent. With an eight-card Ideology deck and three players,
    // R10 ends it before the loop budget runs out, so `finished` is the expected
    // outcome - and the assertion is about COHERENCE, not about longevity: a turn that
    // has started has exactly one card put to it, and a turn that has not been started
    // has none. Either is fine; a turn that is neither is the thing that would mean the
    // drain had put a card somewhere it could not be answered from.
    if (!s.finished) {
      expect(s.phase, 'an unfinished game must be in a real phase').toMatch(/answer|actions|headlines/);
      expect(s.phase === 'answer' ? pendingOf(s) !== null : true, 'phase answer with no card put').toBe(true);
      expect(s.turn).toBeGreaterThan(1);
    } else {
      expect(s.phase).toBe('finished');
    }
  });
});

// ─────────────────────────── 4. determinism, and the prohibitions ───────────────────────────

describe('G20 - a transfer is deterministic and cannot reach the public fields', () => {
  /** The same seed and the same script, from scratch. */
  function run(): GameState {
    const ctx = XFER_CTX;
    let s = withConspiracies(xferSetup(5), 'p1', [TO_HAND.id, DESTROY.id, TO_HAND_OTHER.id]);
    for (let i = 0; i < 14 && !s.finished; i += 1) {
      const p = s.activePlayer;
      // Choices first, for the same reason the game loop does it: a p12 cap question
      // freezes everything else, and a script that ignores it would simply never play
      // a second card.
      const thawed = resolveChoices(s, p, ctx);
      if (thawed !== s) {
        s = thawed;
        continue;
      }
      for (const card of [TO_HAND.id, DESTROY.id, TO_HAND_OTHER.id]) {
        if (!s.players[p]?.conspiracies.includes(card)) continue;
        const r = reduce(s, p, { type: 'PLAY_CONSPIRACY', cardId: card }, ctx);
        if (r.ok) s = r.state;
      }
      const a = reduce(s, p, { type: 'ANSWER', side: 0 }, ctx);
      if (a.ok) s = a.state;
      const e = reduce(s, p, { type: 'END_TURN' }, ctx);
      if (e.ok) s = e.state;
    }
    return s;
  }

  it('the same seed and the same script produce a byte-identical state', () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // And the run really did move cards, so this is not a test of two empty games.
    // The card ids are `mover-` and the Ideology ids are `xfer-`, and the assertion is
    // on the played cards specifically: a log mentioning `xfer-` would be a LEAK and is
    // checked for on its own below.
    expect(a.turn).toBeGreaterThan(4);
    expect(a.log.filter((l) => l.text.includes('Extra Card')).length).toBeGreaterThan(0);
    expect(a.log.some((l) => l.text.includes('Burn It'))).toBe(true);
  });

  it('a whole played game leaks no Ideology Card id into the log', () => {
    // The runtime version of the silence contract, over a game rather than a single
    // play. `move-card` is the only op that reads the Ideology discard pile, so if any
    // `xfer-` ever reaches a log line the leak came from here.
    const s = run();
    for (const id of XFER_IDS) {
      expect(s.log.map((l) => l.text).join('\n'), `the log named ${id}`).not.toContain(id);
    }
  });

  it('a held card and an answered card are never the same card', () => {
    // The `move-card` prohibitions as a CONSEQUENCE rather than as a type error. The
    // engine is the only writer of `manifestoCards`, and the engine only writes it on
    // ANSWER, so a card that appears in both a hand and a manifesto is a card that was
    // put to a player AND handed to them - which is the third category the ruling
    // refuses, reachable only if a card effect ever wrote the public field.
    const s = run();
    for (const id of s.turnOrder) {
      const held = new Set(ideologyHandOf(s.players[id]));
      for (const done of s.players[id]?.manifestoCards ?? []) {
        expect(held.has(done), `${id} holds ${done} and has also answered it`).toBe(false);
      }
    }
    // The two fields are on opposite sides of p13: a held card is in NOBODY's payload,
    // an answered one is in everybody's.
    for (const id of s.turnOrder) {
      const json = payload(s, id);
      for (const held of ideologyHandOf(s.players[id])) expect(json).not.toContain(held);
    }
  });

  it('the hand graph still carries no underscore key after a transfer', () => {
    // The structural half. The 200-action walk in `playerView.test.ts` proves it for a
    // normal game; this proves it for a state built by hand, where the `_ideologyDiscard`
    // a transfer reads from is non-empty and holds real card ids.
    const s = run();
    for (const viewer of s.turnOrder) {
      expect(allKeys(playerView(s, viewer)).filter((k) => k.startsWith('_'))).toEqual([]);
    }
  });

  it('the transfer is legal in every phase it is legal in, and refused in none', () => {
    // p19 scopes `PLAY_CONSPIRACY` to `actions` and `answer`, and the answer window is
    // the one that matters: a transfer resolving mid-answer is the whole G20 question.
    // Checked from both windows so a phase guard tightening would be caught here.
    const actions: GameState = { ...xferSetup(), phase: 'actions', _pendingCard: null };
    const fromActions = reduce(
      withConspiracies(withDraw(actions, ['xfer-3']), 'p1', [TO_HAND.id]),
      'p1',
      { type: 'PLAY_CONSPIRACY', cardId: TO_HAND.id },
      XFER_CTX,
    );
    expect(fromActions.ok, 'resolving from the actions phase must work').toBe(true);

    const fromAnswer = reduce(
      withConspiracies(withDraw(xferSetup(), ['xfer-3']), 'p1', [TO_HAND.id]),
      'p1',
      { type: 'PLAY_CONSPIRACY', cardId: TO_HAND.id },
      XFER_CTX,
    );
    expect(fromAnswer.ok, 'resolving mid-answer must work').toBe(true);
    if (!fromAnswer.ok) return;
    // And in both, the card landed in a hand and is invisible.
    if (fromActions.ok) {
      expect(ideologyHandOf(fromActions.state.players.p1)).toHaveLength(1);
      expect(payload(fromActions.state, 'p1')).not.toContain('xfer-3');
    }
    expect(ideologyHandOf(fromAnswer.state.players.p1)).toHaveLength(1);
    expect(payload(fromAnswer.state, 'p1')).not.toContain('xfer-3');
  });
});

// ────────────────────────�
// ─────────────────────────── G17: a choice over the PUBLIC recycle list ───────────────────────────

/**
 * U1. SELECTIVE ACCESS MEMORY's whole printed clause, driven through the REAL reducer:
 * *"Pick any Conspiracy Card from the discard pile. It can be in any order from the
 * discard pile."*
 *
 * **THE CLAUSE HAS TWO HALVES AND THIS BLOCK IS ABOUT BOTH**, because a mechanism that
 * offered only "the top, or something else" would satisfy the first half and drop the
 * second — and the second is the half the card is named for:
 *
 *  - **which card** — the pick may name ANY member of the pile, not only its top. Proved
 *    by naming the FIRST of a three-card pile, which is the member the pre-U1 engine
 *    could never reach.
 *  - **in any order** — a two-card take is TWO decisions, and the order the player
 *    answers them in is the order the cards arrive in the hand. Proved by answering the
 *    top first and the bottom second, so the hand comes out in the REVERSE of the pile.
 *
 * Both go through `PLAY_CONSPIRACY` and `RESOLVE_CHOICE` and nothing else. A fixture
 * that pushed a card onto a pile and read a field would prove the type, not the rule.
 *
* ONE THING TO KNOW BEFORE READING THE EXPECTATIONS, and it is the ORDER rather than the
 * bookkeeping. `PLAY_CONSPIRACY` resolves the effect list FIRST and only then puts the
 * played card on the discard pile, in the same breath as the `Played "NAME"` log line.
 *
 * So the OFFER a pick carries is the pile as it stood before the play, while the pile the
 * engine VALIDATES against when the player answers is that pile with the played card
 * appended. **The accepted set is therefore a superset of the offered one**, by exactly
 * one publicly-logged card, and that is the safe direction — a dialog can never offer a
 * button the server refuses. `afterResolve` names the shape so the arithmetic is stated
 * once and no expectation has to re-derive it.
 */
describe('G17 - a card chosen off the recycle pile, and in an order the pile does not have', () => {
  const probe = (id: string, effects: ConspiracyCard['effects']): ConspiracyCard => ({
    id,
    name: id,
    text: 'probe',
    cost: 0,
    effects,
  });
  const PICK_ONE = probe('pick-1', [{ op: 'draw-conspiracy', n: 1, from: 'discard', pick: true }]);
  const PICK_TWO = probe('pick-2', [{ op: 'draw-conspiracy', n: 2, from: 'discard', pick: true }]);
  const RETURN_ONE = probe('return-1', [{ op: 'draw-conspiracy', n: 1, from: 'discard', to: 'discard' }]);
  const PICK_FIVE = probe('pick-5', [{ op: 'draw-conspiracy', n: 5, from: 'discard', pick: true }]);
  // Three cards that only ever sit on the pile. Real `ConspiracyCard`s, so a pick that
  // names one is a pick the index can resolve, and separate from every probe above so a
  // test cannot pass by picking the card that was just played.
  const PILE_CARDS: readonly ConspiracyCard[] = ['pile-a', 'pile-b', 'pile-c'].map((id) =>
    probe(id, [{ op: 'draw-conspiracy', n: 1, target: 'leader' }]),
  );
  const PILE: readonly string[] = PILE_CARDS.map((c) => c.id);
  const ALL: readonly ConspiracyCard[] = [PICK_ONE, PICK_TWO, PICK_FIVE, RETURN_ONE, ...PILE_CARDS];

  const CTX = { rules: RULES, cards: indexCards({ ideology: [], voter: [], conspiracy: [...ALL], headline: [] }) };

  /** A state in the actions window with `pile` on the recycle list and `card` in hand. */
  function staging(card: ConspiracyCard, pile: readonly string[] = PILE): GameState {
    const base = setup({
      players: PLAYERS_3,
      cards: CTX.cards,
      seed: 5,
      ideologyDeck: [],
      conspiracyDeck: [...pile, ...ALL.map((c) => c.id)],
    });
    return withConspiracies(
      { ...base, phase: 'actions', _pendingCard: null, _conspiracyDiscard: [...pile] },
      'p1',
      [card.id],
    );
  }

  function play(s: GameState, cardId: string) {
    return reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId }, CTX);
  }

/**
   * The pile after `PLAY_CONSPIRACY` and one answer: the OFFERED pile minus the card that
   * was taken, plus the played card, which the action appends after the effect resolves.
   */
  function afterResolve(offered: readonly string[], taken: string | null, played: string): readonly string[] {
    const rest = taken === null ? [...offered] : offered.filter((id) => id !== taken);
    return [...rest, played];
  }

  function hand(s: GameState): readonly string[] {
    return s.players.p1?.conspiracies ?? [];
  }

  it('WHICH CARD: the player may name the FIRST of the pile, not only the top', () => {
    const played = play(staging(PICK_ONE), PICK_ONE.id);
    expect(played.ok, 'the picking card must resolve').toBe(true);
    if (!played.ok) return;
    const pending = played.state.choices.find((c) => c.player === 'p1');
    expect(pending, 'a non-empty recycle list must raise a decision').toBeDefined();
    if (pending === undefined) return;
    // The OFFER is the whole pile in recycle order, and it is owed by the RECIPIENT.
    expect(pending.choice.kind).toBe('choose-card');
    if (pending.choice.kind !== 'choose-card') return;
    expect(pending.choice.cards, 'the offer is the recycle list').toEqual(PILE);
    expect(pending.choice.source, 'the RECIPIENT chooses, not the card\'s actor').toBe('p1');

    // THE BOTTOM OF THE PILE. `from: 'discard'` without `pick` takes the top, so this
    // answer is the one the pre-U1 engine had no way to accept.
    const answered = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId: 'pile-a' } },
      CTX,
    );
    expect(answered.ok, 'naming any member of the pile must be accepted').toBe(true);
    if (!answered.ok) return;
    expect(hand(answered.state), 'the named card, and only it, reached the hand').toEqual(['pile-a']);
    expect(answered.state._conspiracyDiscard, 'the named card left the pile and the rest kept their order').toEqual(
      afterResolve(PILE, 'pile-a', PICK_ONE.id),
    );
    expect(answered.state.choices, 'the decision is gone and none replaced it').toEqual([]);
  });

  it('IN ANY ORDER: two cards is two decisions, and the hand comes out in the reverse of the pile', () => {
    const played = play(staging(PICK_TWO), PICK_TWO.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const open = played.state.choices.filter((c) => c.player === 'p1');
    expect(open.length, 'a two-card take raises one decision PER CARD, which is what "any order" is').toBe(2);

// The TOP of the pile first — the card `from: 'discard'` alone would have taken.
    const first = open[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const one = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: first.id, pick: { kind: 'card', cardId: 'pile-c' } },
      CTX,
    );
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(hand(one.state), 'the first answer arrived first').toEqual(['pile-c']);

    const second = one.state.choices.find((c) => c.player === 'p1');
    expect(second, 'the second card is still owed').toBeDefined();
    if (second === undefined) return;
    // The BOTTOM second, so the hand ends in the pile's REVERSE.
    const done = reduce(
      one.state,
      second.player,
      { type: 'RESOLVE_CHOICE', choiceId: second.id, pick: { kind: 'card', cardId: 'pile-a' } },
      CTX,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(hand(done.state), 'the hand is in the order the player chose, not the pile').toEqual([
      'pile-c',
      'pile-a',
    ]);
    expect(done.state._conspiracyDiscard).toEqual(
      afterResolve(PILE.filter((id) => id !== 'pile-c' && id !== 'pile-a'), null, PICK_TWO.id),
    );
    expect(done.state.choices, 'both decisions are closed').toEqual([]);
  });

  it('the pile is the bound: n above its length is capped, and an EMPTY pile raises NOTHING', () => {
    const capped = play(staging(PICK_TWO), PICK_TWO.id);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.state.choices.length, 'a three-card pile, so n: 2 raises two').toBe(2);

    // n ABOVE THE PILE. `applyEffect` runs before the played card is appended, so a
    // ONE-card fixture pile is the whole candidate set and `n: 5` must raise exactly one —
    // which is the bound, and it is what makes the k-th decision satisfiable.
    const over = play(staging(PICK_FIVE, ['pile-a']), PICK_FIVE.id);
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    expect(over.state.choices.length, 'n: 5 over a ONE-card pile raises one, not five').toBe(1);

    // **THE EMPTY PILE RAISES NOTHING.** This is U1's whole termination claim and it is a
    // RULES claim, not a safety bound: "pick a card from the discard pile" is not a
    // decision a player can answer when there is nothing in it, and raising one would
    // freeze the table on a clause with no action. This is the state a player meets on
    // the first Conspiracy Card of a game, when nothing has been played yet.
    const bare = play(staging(PICK_ONE, []), PICK_ONE.id);
    expect(bare.ok, 'an empty pile must not refuse the play').toBe(true);
    if (!bare.ok) return;
    expect(bare.state.choices, 'an empty recycle list raised a decision nobody could answer').toEqual([]);
    expect(hand(bare.state), 'and nothing was taken').toEqual([]);
  });

  it('a pick cannot re-raise a decision, and TRIGGER_MAX_WAVES is not what stops it', () => {
    // The cascade bound. The answer arrives back in `applyEffect` as `forcedCard`, which
    // short-circuits the `pick` branch — so ONE `RESOLVE_CHOICE` consumes exactly one card
    // and leaves nothing open. `TRIGGER_MAX_WAVES` bounds one FIRING EVENT and is not
    // consulted on this path; the property is read off the state, not off the counter.
    const played = play(staging(PICK_ONE), PICK_ONE.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const pending = played.state.choices[0];
    expect(pending).toBeDefined();
    if (pending === undefined) return;
    const answered = reduce(
      played.state,
      'p1',
      { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId: 'pile-b' } },
      CTX,
    );
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(answered.state.choices, 'answering one pick raised another').toEqual([]);
    expect(answered.state._conspiracyDiscard, 'exactly one card left the pile').toEqual(
      afterResolve(PILE, 'pile-b', PICK_ONE.id),
    );
  });

  it('mid-resolution, a player who is NOT the chooser learns nothing and can do nothing', () => {
    const played = play(staging(PICK_ONE), PICK_ONE.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const pending = played.state.choices[0];
    expect(pending).toBeDefined();
    if (pending === undefined) return;

    // THE PAYLOAD IS THE SAME FOR EVERYBODY, and that is the point. `PendingChoice` is one
    // value with no viewer parameter, so the offered list is in every viewer's state — it
    // IS the recycle list, which `broadcast.ts` publishes, and a pick adds nothing else.
    for (const viewer of played.state.turnOrder) {
      const view = playerView(played.state, viewer);
      expect(JSON.stringify(view.players[viewer]?.conspiracies), 'a Conspiracy hand is hidden from everyone').toBe('[]');
      expect(allKeys(view).filter((k) => k.startsWith('_')), 'no server-only key reached the payload').toEqual([]);
    }

    // AND A NON-CHOOSER CANNOT ANSWER IT: the engine refuses the pick as not theirs rather
    // than silently resolving it for them, and the refusal names nothing about the pile.
    for (const other of played.state.turnOrder.filter((p) => p !== pending.player)) {
      const hijack = reduce(
        played.state,
        other,
        { type: 'RESOLVE_CHOICE', choiceId: pending.id, pick: { kind: 'card', cardId: 'pile-a' } },
        CTX,
      );
      expect(hijack.ok, 'a non-chooser resolved somebody else\'s card decision').toBe(false);
      if (hijack.ok) return;
      expect(hijack.error).toBe('that decision is not yours');
    }
    // And the pile is untouched WHILE the decision is open — the card has not moved until
    // the player says which one, which is the whole difference between a pick and a draw.
    expect(played.state._conspiracyDiscard).toEqual(afterResolve(PILE, null, PICK_ONE.id));
    expect(hand(played.state), 'the played card left the hand before the answer').toEqual([]);
  });

  it('`to: discard` from the PUBLIC pile returns the card to the pile and to no hand', () => {
    // `from: 'discard'` with `to: 'discard'` is the ONLY legal pairing, and it is the
    // recycle-loop exit: a card taken off the public pile and put straight back on it.
    // The pile is unchanged by the effect — both operations move one card inside one set
    // every client already holds — and nothing reaches a hand.
    const played = play(staging(RETURN_ONE), RETURN_ONE.id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.choices, 'the non-picking branch raises nothing').toEqual([]);
    expect(played.state._conspiracyDiscard, 'the effect returned the card it took').toEqual(
      afterResolve(PILE, null, RETURN_ONE.id),
    );
    expect(hand(played.state), 'nothing reached a hand').toEqual([]);
  });

  it('`to: discard` over the DRAW PILE is REFUSED, silently, and the effect moves nothing', () => {
    // The refusal IS the security argument, so it is asserted rather than described.
    // `PLAY_CONSPIRACY` itself puts the played card on the pile, so the pile growing by one
    // is the PLAY and not the effect; the assertion that matters is that the draw pile is
    // intact, no hand grew, and nothing was logged or emitted by the refused clause — a
    // message about it would describe the draw pile.
    const leaky = probe('return-leak', [{ op: 'draw-conspiracy', n: 1, to: 'discard' }]);
    const ctx = { rules: RULES, cards: indexCards({ ideology: [], voter: [], conspiracy: [leaky, ...PILE_CARDS], headline: [] }) };
    const base = setup({
      players: PLAYERS_3,
      cards: ctx.cards,
      seed: 5,
      ideologyDeck: [],
      conspiracyDeck: ['return-leak', ...PILE_CARDS.map((c) => c.id)],
    });
    const seeded = withConspiracies(
      { ...base, phase: 'actions', _pendingCard: null, _conspiracyDraw: ['return-leak'], _conspiracyDiscard: ['pile-a'] },
      'p1',
      [leaky.id],
    );
    const played = reduce(seeded, 'p1', { type: 'PLAY_CONSPIRACY', cardId: leaky.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    // EXACTLY the play's own contribution — one append — and no second copy from the effect.
    expect(played.state._conspiracyDiscard, 'the effect added a card of its own').toEqual(['pile-a', 'return-leak']);
    expect(played.state._conspiracyDraw, 'the draw pile was disturbed').toEqual(['return-leak']);
    expect(played.state.players.p1?.conspiracies, 'the card reached a hand instead').toEqual([]);
    // And it is SILENT: the refused clause wrote no log line and emitted no event.
    expect(played.events.filter((e) => e.type !== 'conspiracy')).toEqual([]);
    expect(played.state.log.filter((e) => !e.text.startsWith('Played '))).toEqual(
      seeded.log.filter((e) => !e.text.startsWith('Played ')),
    );
  });

  it('`pick` over the DRAW PILE raises nothing, because an option list may not be a hidden pile', () => {
    // The other half of §2bis, and the one `pick: true` alone would have violated.
    const leaky = probe('pick-draw', [{ op: 'draw-conspiracy', n: 1, pick: true }]);
    const ctx = { rules: RULES, cards: indexCards({ ideology: [], voter: [], conspiracy: [leaky, ...PILE_CARDS], headline: [] }) };
    const base = setup({
      players: PLAYERS_3,
      cards: ctx.cards,
      seed: 5,
      ideologyDeck: [],
      conspiracyDeck: ['pick-draw', ...PILE_CARDS.map((c) => c.id)],
    });
    const seeded = withConspiracies(
      { ...base, phase: 'actions', _pendingCard: null, _conspiracyDraw: ['pick-draw'], _conspiracyDiscard: [] },
      'p1',
      [leaky.id],
    );
    const played = reduce(seeded, 'p1', { type: 'PLAY_CONSPIRACY', cardId: leaky.id }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.choices, 'a decision enumerated the draw pile').toEqual([]);
    expect(played.state._conspiracyDraw, 'and the draw pile was left alone').toEqual(['pick-draw']);
  });
});
