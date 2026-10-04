/**
 * G5 — `PlayerState.restrictions`, and the two rulings it forces.
 *
 * The first ruling is KHAKI TERROR's condition, and the card is a soft-lock without
 * it. *"Donate 1 resource of each type to the Public Reserve. You cannot make any
 * purchases until you do so."* (REF 4.1) The only card in the corpus that can clear
 * the lock is the lock itself, so a player who cannot pay the full ask is stuck at
 * the table for ever. `lose` never takes more than a player holds, so the ruling is
 * that **`remaining` is decremented by what was ACTUALLY taken**. Every test below
 * that says "still locked" or "unlocked" is that ruling, and the one that matters
 * most is the player who holds no Media at all.
 *
 * The second ruling is that `restrictions` is PUBLIC and a deliberate non-secret, so
 * `packages/server/test/secret-inventory.ts` owes it an entry. The argument is on
 * `Restriction` in state.ts; what is asserted here is the consequence — every viewer
 * sees every restriction, and no `_` key appears anywhere in the payload.
 *
 * And one more that was not specified and had to be decided: a surcharge stacks ON TOP
 * of a Helping Hands discount rather than being discountable by it. Helping Hands is
 * the Idealist's own L3 power (p32, *"reduce the cost of any purchase"*), so letting
 * it discount somebody else's tax would let a player buy their way out of another
 * player's card. PYTHONPOST says *"an EXTRA resource"*, not "one resource less than
 * usual".
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard } from '../src/cards';
import { allKeys, playerView } from '../src/playerView';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { usesLeft } from '../src/powers';
import { setup } from '../src/setup';
import { poolTotal, type Delta, type GameState, type PlayerID, type Resource } from '../src/state';
import { IDEOLOGY_CARDS, PLAYERS_3, VOTER_CARDS } from './helpers';

const VOTERS = [
  { id: 'rv-1', cost: { funds: 1 }, voters: 1 },
  { id: 'rv-2', cost: { funds: 2 }, voters: 2 },
] as const;

/** KHAKI TERROR, in the order the engine can honour: lock, then the donation. */
const KHAKI: ConspiracyCard = {
  id: 'rsv-khaki',
  name: 'A Terror',
  text: 'Donate 1 resource of each type to the Public Reserve. You cannot make any purchases until you do so.',
  cost: 1,
  effects: [
    { op: 'restrict', kind: 'no-purchases', value: 0, owed: 4, owedRes: { funds: 1, clout: 1, media: 1, trust: 1 }, until: 'rest-of-game' },
    { op: 'lose', res: { funds: 1, clout: 1, media: 1, trust: 1 } },
  ],
};

/**
 * THE OPPOSITE ORDER, and it is here as a fixture rather than as a test of a bad idea.
 *
 * `lose` first means `creditDonation` runs before any `'no-purchases'` entry exists, so
 * the card's own donation cannot count against its own lock and the player is left owed
 * the whole ask they just paid. The audit found the corpus probe written this way; it
 * is kept here so the ordering is a *checked* property rather than a comment.
 */
const KHAKI_LOOSE_ORDER: ConspiracyCard = {
  id: 'rsv-khaki-loose',
  name: 'A Terror, Backwards',
  text: 'Donate 1 resource of each type to the Public Reserve.',
  cost: 1,
  effects: [
    { op: 'lose', res: { funds: 1, clout: 1, media: 1, trust: 1 } },
    { op: 'restrict', kind: 'no-purchases', value: 0, owed: 4, owedRes: { funds: 1, clout: 1, media: 1, trust: 1 }, until: 'rest-of-game' },
  ],
};

/** Somebody else's drain, with no donation clause at all. C1's original probe. */
const DRAIN: ConspiracyCard = {
  id: 'rsv-drain',
  name: 'A Drain',
  text: 'Every opponent loses any 4 Funds.',
  cost: 1,
  effects: [{ op: 'lose', res: { funds: 4 }, target: 'each-opponent' }],
};

/** The two halves apart, so each can be driven on its own. */
const DONATE_ONLY: ConspiracyCard = {
  id: 'rsv-donate',
  name: 'A Donation',
  text: 'Donate 1 resource of each type to the Public Reserve.',
  cost: 1,
  effects: [{ op: 'lose', res: { funds: 1, clout: 1, media: 1, trust: 1 } }],
};

const LOCK_ONLY: ConspiracyCard = {
  id: 'rsv-lock',
  name: 'A Lock',
  text: 'You cannot make any purchases until you have donated 2 resources.',
  cost: 1,
  effects: [{ op: 'restrict', kind: 'no-purchases', value: 0, owed: 2, until: 'rest-of-game' }],
};

/** PYTHONPOST / SNOOP B-O-DOUBLE-T: an extra resource per Conspiracy purchase. */
const PYTHONPOST: ConspiracyCard = {
  id: 'rsv-surcharge',
  name: 'A Tax',
  text: 'For the rest of the game, every Conspiracy Card that you buy costs any 1 extra resource.',
  cost: 1,
  effects: [
    { op: 'restrict', kind: 'surcharge', value: 1, target: 'each-opponent', until: 'rest-of-game' },
  ],
};

/** Two taxes on one player, so the sum rather than the max is what is charged. */
const DOUBLE_TAX: ConspiracyCard = {
  id: 'rsv-double-tax',
  name: 'Two Taxes',
  text: 'Every purchase that you make costs any 2 extra resources.',
  cost: 1,
  effects: [
    { op: 'restrict', kind: 'surcharge', value: 2, target: 'each-opponent', until: 'rest-of-game' },
  ],
};

/** A deadline rather than a condition: gone at the end of the turn it resolved on. */
const SHORT_TAX: ConspiracyCard = {
  id: 'rsv-short-tax',
  name: 'A Brief Tax',
  text: 'For the rest of THIS turn only, your purchases cost any 1 extra resource.',
  cost: 1,
  effects: [
    { op: 'restrict', kind: 'surcharge', value: 1, target: 'each-opponent', until: 'this-turn' },
  ],
};

/** GENDER TROUBLE: no Ideologue Power for the owner's next turn. */
const NO_POWER: ConspiracyCard = {
  id: 'rsv-no-power',
  name: 'A Blank',
  text: 'You cannot use any of your Ideologue Powers before the end of your next turn.',
  cost: 1,
  effects: [{ op: 'restrict', kind: 'no-power', value: 0, target: 'you', until: 'next-turn' }],
};

const CARDS: CardIndex = indexCards({
  ideology: IDEOLOGY_CARDS,
  voter: [...VOTER_CARDS, ...VOTERS],
  conspiracy: [KHAKI, KHAKI_LOOSE_ORDER, DRAIN, DONATE_ONLY, LOCK_ONLY, PYTHONPOST, DOUBLE_TAX, SHORT_TAX, NO_POWER],
  headline: [],
});

const ctx: Ctx = { rules: RULES, cards: CARDS };

/** Eight resources each: under the cap of 12, with room for a tax to be paid. */
const PLENTY: readonly Delta[] = [
  { funds: 2, clout: 2, media: 2, trust: 2 },
  { funds: 4, clout: 2, media: 1, trust: 1 },
  { funds: 4, clout: 2, media: 1, trust: 1 },
];

function freshGame(startResources: readonly Delta[] = PLENTY, seed = 1): GameState {
  return setup({
    players: PLAYERS_3,
    cards: CARDS,
    seed,
    startResources,
    ideologyDeck: IDEOLOGY_CARDS.map((c) => c.id),
    voterDeck: VOTERS.map((c) => c.id),
    conspiracyDeck: [PYTHONPOST.id],
    headlineDeck: [],
  });
}

function answered(s: GameState, by: PlayerID = s.activePlayer): GameState {
  const r = reduce(s, by, { type: 'ANSWER', side: 0 }, ctx);
  if (!r.ok) throw new Error(`answer: ${r.error}`);
  return r.state;
}

function play(s: GameState, cardId: string, by: PlayerID = s.activePlayer): GameState {
  const withCard: GameState = {
    ...s,
    phase: 'actions',
    _pendingCard: null,
    players: {
      ...s.players,
      [by]: { ...s.players[by]!, conspiracies: [...s.players[by]!.conspiracies, cardId] },
    },
  };
  const r = reduce(withCard, by, { type: 'PLAY_CONSPIRACY', cardId }, ctx);
  if (!r.ok) throw new Error(`play ${cardId}: ${r.error}`);
  return r.state;
}

/** Play a card as somebody other than the active player, which a Headline does. */
/**
 * Play a card as somebody who is NOT the active player.
 *
 * p19 / rules-reference.md:283 — a Conspiracy Card may be played out of turn, but
 * only in the pre-answer window, so the state is put back into `answer` rather than
 * reaching past the reducer. That is also how a Headline resolves against a player
 * who is not having a turn, which is the position several of these cards need.
 */
function playAs(s: GameState, cardId: string, by: PlayerID): GameState {
  const withCard: GameState = {
    ...s,
    phase: 'answer',
    players: {
      ...s.players,
      [by]: { ...s.players[by]!, conspiracies: [...s.players[by]!.conspiracies, cardId] },
    },
  };
  const r = reduce(withCard, by, { type: 'PLAY_CONSPIRACY', cardId }, ctx);
  if (!r.ok) throw new Error(`play ${cardId} as ${by}: ${r.error}`);
  // The pre-answer window is an opening, not a phase the game rests in: the fixture
  // returns to the `actions` phase the position was built in, so the next `endTurn`
  // is a legal one. (Leaving it at `answer` with `_pendingCard: null` would make
  // ANSWER fail with "no card has been put to you", which says nothing about
  // restrictions and a great deal about the fixture.)
  return { ...r.state, phase: 'actions' };
}

function tryInfluence(s: GameState, by: PlayerID = s.activePlayer, slot = 0): string {
  const r = reduce(s, by, { type: 'INFLUENCE', slot }, ctx);
  return r.ok ? 'ok' : r.error;
}

function tryBuyConspiracy(
  s: GameState,
  pay: Delta,
  by: PlayerID = s.activePlayer,
  discounts?: readonly Resource[],
): string {
  const r = reduce(s, by, { type: 'BUY_CONSPIRACY', pay, ...(discounts ? { discounts } : {}) }, ctx);
  return r.ok ? 'ok' : r.error;
}

function endTurn(s: GameState): GameState {
  let cur = s;
  if (cur.phase === 'answer') {
    const a = reduce(cur, cur.activePlayer, { type: 'ANSWER', side: 0 }, ctx);
    if (!a.ok) throw new Error(a.error);
    cur = a.state;
  }
  const r = reduce(cur, cur.activePlayer, { type: 'END_TURN' }, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/**
 * Put a state into the ctions phase for p, answering first if the incoming turn
 * demands it. Every action except PLAY_CONSPIRACY and RESOLVE_CHOICE is refused
 * while a card is pending, so a fixture that walks to another seat's turn has to do
 * what that player does.
 */
function onTurn(s: GameState, p: PlayerID = s.activePlayer): GameState {
  let cur = s;
  if (cur.activePlayer !== p) return cur;
  if (cur.phase === 'answer') {
    const a = reduce(cur, p, { type: 'ANSWER', side: 0 }, ctx);
    if (!a.ok) throw new Error(a.error);
    cur = a.state;
  }
  return cur;
}

const restrictionsOf = (s: GameState, p: PlayerID) => s.players[p]?.restrictions ?? [];
const fundsOf = (s: GameState, p: PlayerID) => s.players[p]?.resources.funds ?? 0;
const poolOf = (s: GameState, p: PlayerID) => s.players[p]?.resources;

// ─────────────────────────── the KHAKI TERROR ruling ───────────────────────────

describe('RULING 1 — a no-purchases lock is satisfied by what was ACTUALLY donated', () => {
  it('a player with nothing of one type is NOT locked for ever — the soft-lock does not happen', () => {
    // The ruling, as a game. p1 has Funds and Clout and NOTHING else, donates both,
    // and is then free to buy: "you cannot make any purchases until you do so" is a
    // condition, and the condition is "you have donated what you can". Decrementing
    // by the card's ASK would leave p1 owing 2 forever, and the only card that can
    // clear it is the lock itself.
    const poor: readonly Delta[] = [
      { funds: 4, clout: 2, media: 0, trust: 0 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
    ];
    const s = play(answered(freshGame(poor)), 'rsv-donate');
    // 2 of the 4 asked-for resources were actually taken, and nothing is locked,
    // because the lock was not imposed in this fixture — the two halves are apart on
    // purpose. Impose it, then donate, and the point is that the donation is what
    // clears it.
    const locked = play(s, 'rsv-lock');
    expect(restrictionsOf(locked, 'p1')).toHaveLength(1);
    expect(tryInfluence(locked)).toContain('cannot make any purchases');

    const donated = play(locked, 'rsv-donate');
    // 2 taken of 2 owed: cleared, and the entry is REMOVED rather than left at zero.
    expect(restrictionsOf(donated, 'p1')).toEqual([]);
    expect(tryInfluence(donated)).toBe('ok');
  });

  it('and a partial donation leaves exactly the remainder, not zero', () => {
    // The arithmetic, read off the state rather than off a pass/fail. Owed 2, donate
    // 1, and the lock survives with 1 left.
    const locked = play(answered(freshGame()), 'rsv-lock');
    expect(restrictionsOf(locked, 'p1')[0]?.remaining).toBe(2);
    const thin: readonly Delta[] = [
      { funds: 1, clout: 0, media: 0, trust: 0 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
    ];
    const after = play(answered(freshGame(thin)), 'rsv-donate');
    const stillLocked = play(play(after, 'rsv-lock'), 'rsv-donate');
    // p1 had 1 Fund and gave it, so 1 of the 2 owed is gone and 1 remains.
    expect(fundsOf(stillLocked, 'p1')).toBe(0);
    expect(restrictionsOf(stillLocked, 'p1')[0]?.remaining).toBe(1);
    expect(tryInfluence(stillLocked)).toContain('cannot make any purchases');
  });

  it('a donation by somebody else does not clear YOUR lock, and vice versa', () => {
    const locked = play(answered(freshGame()), 'rsv-lock');
    expect(restrictionsOf(locked, 'p1')).toHaveLength(1);
    expect(restrictionsOf(locked, 'p2')).toHaveLength(0);
    const donated = play(locked, 'rsv-donate');
    expect(restrictionsOf(donated, 'p1')).toEqual([]);
    expect(restrictionsOf(donated, 'p2')).toHaveLength(0);
  });

  it('KHAKI TERROR as one card donates, locks, and discharges the lock in the same breath', () => {
    // THE ORDER IS THE RULING. `restrict` first and `lose` second, so the lock exists
    // on the board by the time the donation lands — and then the donation discharges it,
    // because the card's own `lose` IS a giving (`p === source`).
    const s = play(answered(freshGame()), 'rsv-khaki');
    expect(restrictionsOf(s, 'p1')).toEqual([]);
    expect(tryInfluence(s)).toBe('ok');
  });

  it('and every holding DISCHARGES it, which is the whole lock never being a soft-lock', () => {
    // THE DISCHARGEABILITY PROOF, EXHAUSTED RATHER THAN ASSERTED. `creditDonation`
    // settles a type when the donation carries it and settles it by waiver when the
    // player holds none, so with `owedRes` at 1 per type those two cases are
    // exhaustive and no type can be left partly paid. All 81 holding patterns over the
    // four resources at 0, 1 and 2 are driven through the real reducer, at 3 seats; the
    // per-seat sweep is below, because the arithmetic does not mention a seat.
    let checked = 0;
    for (let mask = 0; mask < 81; mask += 1) {
      const pool = {
        funds: mask % 3,
        clout: Math.floor(mask / 3) % 3,
        media: Math.floor(mask / 9) % 3,
        trust: Math.floor(mask / 27) % 3,
      };
      const base = freshGame([pool, { funds: 2, clout: 2, media: 2, trust: 2 }, { funds: 2, clout: 2, media: 2, trust: 2 }]);
      // The Ideology answer pays, so the assertion is read off the position the card
      // resolved FROM rather than off the pool this loop set — the claim is about the
      // lock, not about what the opening happened to pay.
      const before = answered(base);
      const s = play(before, 'rsv-khaki');
      const rows = restrictionsOf(s, 'p1');
      expect(rows, `holding ${JSON.stringify(pool)} left a lock`).toEqual([]);
      // The donation itself is unaffected by the lock, and takes what is there.
      const had = poolOf(before, 'p1');
      expect(poolOf(s, 'p1'), JSON.stringify(pool)).toEqual({
        funds: Math.max(0, (had?.funds ?? 0) - 1),
        clout: Math.max(0, (had?.clout ?? 0) - 1),
        media: Math.max(0, (had?.media ?? 0) - 1),
        trust: Math.max(0, (had?.trust ?? 0) - 1),
      });
      checked += 1;
    }
    expect(checked).toBe(81);
  });

  it('and at 2, 3, 4 and 5 seats a lock, if one exists at all, refuses only purchases', () => {
    // "A legal move always exists" for this lock. It is checked by the shape of the
    // refusals rather than by enumerating actions: `no-purchases` is read by exactly
    // two actions, INFLUENCE and BUY_CONSPIRACY, and by nothing else. A table that
    // cannot end a turn, cannot answer an Ideology Card and cannot pass is a dead
    // table, and none of those three consults this kind.
    for (const n of [2, 3, 4, 5] as const) {
      const seats = ['p1', 'p2', 'p3', 'p4', 'p5'].slice(0, n) as PlayerID[];
      const s = setup({
        players: seats,
        cards: CARDS,
        seed: 1,
        startResources: seats.map(() => ({ funds: 2, clout: 2, media: 2, trust: 2 })),
        ideologyDeck: IDEOLOGY_CARDS.map((c) => c.id),
        voterDeck: VOTERS.map((c) => c.id),
        conspiracyDeck: [PYTHONPOST.id],
        headlineDeck: [],
      });
      const answeredFirst = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, ctx);
      expect(answeredFirst.ok).toBe(true);
      const locked = play(answeredFirst.ok ? answeredFirst.state : s, 'rsv-khaki-loose');
      // The loose-order card leaves a real lock, so this is a position that exists.
      expect(restrictionsOf(locked, 'p1').length).toBe(1);
      expect(tryInfluence(locked)).toContain('cannot make any purchases');
      expect(tryBuyConspiracy(locked, { funds: 1 }, 'p1')).toContain('cannot make any purchases');
      // …and every other action still works, so the table moves.
      expect(endTurn(locked), `${n} seats`).toBeTruthy();
    }
  });
});

// ─────────────────────── C1 — THE DIRECTION OF THE LOSS ───────────────────────

describe('C1 — a lock is discharged by a DONATION and by nothing else', () => {
  /**
   * A position holding a live lock, reached the only way a lock is reachable at all:
   * the loose-order card, whose `lose` runs before its `restrict` and so cannot be
   * discharged by its own donation.
   */
  const locked = (): GameState => play(answered(freshGame()), 'rsv-khaki-loose');

  it('an OPPONENT\'S DRAIN does not clear it — the defect the audit reproduced', () => {
    const base = locked();
    expect(restrictionsOf(base, 'p1').length).toBe(1);
    const owedBefore = restrictionsOf(base, 'p1')[0]?.remaining ?? 0;
    expect(owedBefore).toBe(4);

    const drained = playAs(base, 'rsv-drain', 'p2');
    // p2's card took 4 Funds off p1…
    expect(fundsOf(drained, 'p1')).toBeLessThan(fundsOf(base, 'p1'));
    // …and the lock is exactly where it was. Not reduced, not removed.
    expect(restrictionsOf(drained, 'p1')).toHaveLength(1);
    expect(restrictionsOf(drained, 'p1')[0]?.remaining).toBe(owedBefore);
    expect(restrictionsOf(drained, 'p1')[0]?.owedRes).toEqual(restrictionsOf(base, 'p1')[0]?.owedRes);
    expect(tryInfluence(drained)).toContain('cannot make any purchases');
  });

  it('and a card of the locked player\'s own that takes from OTHERS does not either', () => {
    // The gate is `p === source`, not "the card is the same". A player who plays their
    // own draining card has given nothing to the Public Reserve, so it must not count.
    const base = locked();
    const before = restrictionsOf(base, 'p1')[0]?.remaining ?? 0;
    const drained = play(base, 'rsv-drain');
    // `rsv-drain` targets each-opponent, so as played by p1 it hits p2 and p3 and not
    // p1 at all; p1's own pool is untouched and its lock is untouched.
    expect(poolOf(drained, 'p1')).toEqual(poolOf(base, 'p1'));
    expect(restrictionsOf(drained, 'p1')[0]?.remaining).toBe(before);
  });

  it('while a real donation by the locked player DOES clear it', () => {
    const base = locked();
    expect(restrictionsOf(base, 'p1').length).toBe(1);
    const donated = play(base, 'rsv-donate');
    // p1 held 2 of each; the loose-order card took 1 of each and this donation takes
    // the other 1 of each, so every type is either carried or waived.
    expect(restrictionsOf(donated, 'p1')).toEqual([]);
    // The purchase refusal is GONE, which is the claim — named as an absence rather
    // than as `tryInfluence` being 'ok', because a player who has just given away
    // their whole mat cannot afford the slot's Voter Card and that is a different
    // refusal entirely.
    expect(tryBuyConspiracy(donated, { funds: 0 }, 'p1')).not.toContain('cannot make any purchases');
  });

  it('and the per-type shape is per-type: four Funds does NOT satisfy one of each', () => {
    // The second half of C1, and the half `remaining` alone could never express. A
    // legacy lock of `owed: 2` IS satisfied by two of any type — that is the documented
    // limitation of the scalar and it is asserted here so the limitation cannot be
    // forgotten. The vector lock is not: it names its four types.
    const scalar = play(answered(freshGame()), 'rsv-lock');
    expect(restrictionsOf(scalar, 'p1')[0]?.owedRes).toBeUndefined();

    const vector = play(answered(freshGame()), 'rsv-khaki-loose');
    expect(restrictionsOf(vector, 'p1')[0]?.owedRes).toEqual({
      funds: 1,
      clout: 1,
      media: 1,
      trust: 1,
    });
    // p1 held 2 of each and the `lose` took 1, so 1 of each is still owed — a per-type
    // remainder, and its sum is the scalar `remaining` the two representations share.
    expect(restrictionsOf(vector, 'p1')[0]?.remaining).toBe(4);
  });

  it('and a type the player holds NONE of is waived rather than owed', () => {
    // The soft-lock arm of the proof: a player holding no Media can never give Media, so
    // a lock that kept asking for it would be undischargeable. They are owed nothing
    // for it, and the donation clears the rest.
    const thin: readonly Delta[] = [
      { funds: 4, clout: 0, media: 0, trust: 0 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
    ];
    const s = play(answered(freshGame(thin)), 'rsv-khaki-loose');
    // Only Funds is clamped into the ask, because Funds is the only thing held.
    expect(restrictionsOf(s, 'p1')[0]?.owedRes).toEqual({ funds: 1 });
    expect(restrictionsOf(s, 'p1')[0]?.remaining).toBe(1);
    const donated = play(s, 'rsv-donate');
    expect(restrictionsOf(donated, 'p1')).toEqual([]);
  });

  it('and an empty hand is not locked at all', () => {
    // The clamp at imposition is why nothing at all is not "locked with nothing owed":
    // no entry is written, because a zero-`remaining` row on a PUBLIC list would read
    // as a purchase ban to a client while the predicate reads it as clear.
    const bare: readonly Delta[] = [
      { funds: 0, clout: 0, media: 0, trust: 0 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
      { funds: 4, clout: 2, media: 1, trust: 1 },
    ];
    const s = play(answered(freshGame(bare)), 'rsv-khaki-loose');
    expect(restrictionsOf(s, 'p1')).toEqual([]);
    // …and the purchase refusal is absent, as distinct from some other refusal: this
    // player cannot afford anything either, so the assertion names the message.
    expect(tryBuyConspiracy(s, { funds: 0 }, 'p1')).not.toContain('cannot make any purchases');
  });
});

// ─────────────────────────── the surcharge ───────────────────────────

describe('a surcharge is charged ON TOP of a discount, and is summed', () => {
  // SEATS, once, so the assertions below are about the SURCHARGE and not about who
  // happens to be holding the pen. p2 plays the tax out of turn (p19's pre-answer
  // window), so p2 is untaxed and p1 and p3 are each carrying one. p1 is the active
  // player throughout, which is convenient: a taxed player can be charged on their
  // own turn without walking the table round.
  const taxed = (cardId = 'rsv-surcharge'): GameState =>
    playAs(answered(freshGame()), cardId, 'p2');

  it('and it lands on the OPPONENTS of whoever played the card, not on them', () => {
    const s = taxed();
    expect(restrictionsOf(s, 'p2')).toEqual([]);
    expect(restrictionsOf(s, 'p1')).toHaveLength(1);
    expect(restrictionsOf(s, 'p3')).toHaveLength(1);
  });

  it('and it raises the CONSPIRACY price, which is the card the corpus actually has', () => {
    // PYTHONPOST says "for every Conspiracy Card that you buy", so BUY_CONSPIRACY is
    // the action the card is about. p1 is taxed and is the active player, so the
    // state is already in the `actions` phase and nothing else has to be arranged.
    const s = taxed();
    const topId = s._conspiracyDraw[0];
    const cost = topId ? CARDS.conspiracy[topId]?.cost ?? 0 : 0;
    // The printed cost is refused…
    expect(tryBuyConspiracy(s, { funds: cost }, 'p1')).toContain('costs');
    // …and cost + tax is accepted.
    expect(tryBuyConspiracy(s, { funds: cost + 1 }, 'p1')).toBe('ok');
  });

  it('two taxes are SUMMED, because two cards means two taxes', () => {
    // p1 plays two, so p2 and p3 each carry two; the price is printed + 2, not
    // printed + 4, because the two entries are each worth 2.
    const s = play(play(answered(freshGame()), 'rsv-double-tax'), 'rsv-double-tax');
    expect(restrictionsOf(s, 'p2')).toHaveLength(2);
    const next = onTurn(endTurn(s), 'p2');
    const topId = next._conspiracyDraw[0];
    const cost = topId ? CARDS.conspiracy[topId]?.cost ?? 0 : 0;
    expect(tryBuyConspiracy(next, { funds: cost + 2 }, 'p2')).toContain('costs');
    expect(tryBuyConspiracy(next, { funds: cost + 4 }, 'p2')).toBe('ok');
  });

  it('Helping Hands cannot discount somebody else’s tax', () => {
    // p32: Helping Hands reduces "the cost of any purchase". Read literally that would
    // let the Idealist's own power erase a surcharge imposed by another player's card,
    // which is not what a permanent tax means. p1 is the taxed player here and is
    // given a Level 3 Idealist power by hand so `usesLeft` is non-zero.
    const s = taxed();
    const player = s.players.p1;
    if (!player) throw new Error('no p1');
    const withPower: GameState = {
      ...s,
      players: {
        ...s.players,
        p1: { ...player, manifesto: ['idealist', 'idealist', 'idealist'] },
      },
    };
    const topId = withPower._conspiracyDraw[0];
    const cost = topId ? CARDS.conspiracy[topId]?.cost ?? 0 : 0;
    // One discount off the printed cost, plus the tax, is cost — and it is accepted.
    expect(tryBuyConspiracy(withPower, { funds: cost }, 'p1', ['funds'])).toBe('ok');
    // The same payment WITHOUT the discount is one short, which is the whole ruling:
    // the discount reduced the printed price and the tax is still owed on top, so a
    // player cannot use their own power to buy their way out of it.
    expect(tryBuyConspiracy(withPower, { funds: cost }, 'p1')).toContain('costs');
    // And cost + tax + discount is one too many, so the arithmetic really is
    // (printed - discounts) + surcharge rather than max(printed, surcharge).
    expect(tryBuyConspiracy(withPower, { funds: cost + 1 }, 'p1', ['funds'])).toContain('costs');
  });

  it("a 'this-turn' tax is gone at the end of the turn it resolved on", () => {
    const s = taxed('rsv-short-tax');
    expect(restrictionsOf(s, 'p1')).toHaveLength(1);
    const next = endTurn(s);
    expect(restrictionsOf(next, 'p1')).toEqual([]);
  });

  it("a 'rest-of-game' tax outlives the turn and a deck reshuffle alike", () => {
    let s = taxed();
    for (let i = 0; i < 8; i += 1) s = endTurn(s);
    expect(s.turn).toBeGreaterThan(5);
    expect(restrictionsOf(s, 'p1')).toHaveLength(1);
  });
});

// ─────────────────────────── the one structural trap ───────────────────────────

describe('`restrict` is NOT a scoped effect, and the field collision is deliberate', () => {
  it('it is applied immediately rather than installed as a live effect', () => {
    // `restrict` carries `until` as the DEADLINE OF THE RULE, not as a hook lifetime.
    // Read as a hook it would (a) never be applied, because a scoped effect is not
    // applied, and (b) be re-imposed on every event. Both are wrong, and the test
    // that would catch it is this one: no live effect, one restriction on the taxed
    // player.
    const s = playAs(answered(freshGame()), 'rsv-surcharge', 'p2');
    expect(s.liveEffects).toEqual([]);
    expect(restrictionsOf(s, 'p1')).toHaveLength(1);
  });

  it('and it is not re-imposed by anything, so the count never drifts', () => {
    let s = playAs(answered(freshGame()), 'rsv-surcharge', 'p2');
    for (let i = 0; i < 6; i += 1) s = endTurn(s);
    expect(restrictionsOf(s, 'p1')).toHaveLength(1);
  });
});

// ─────────────────────────── RULING 2 — restrictions are public ───────────────────────────

describe('RULING 2 — restrictions are a deliberate NON-SECRET', () => {
  it('every viewer sees every restriction, which is the card’s whole point', () => {
    // KHAKI TERROR's mechanic is that everyone can see you cannot buy. A silent lock
    // would be a different game, and a per-viewer lock would be an information leak
    // shaped exactly like a Conspiracy hand.
    const s = play(answered(freshGame()), 'rsv-khaki-loose');
    for (const viewer of s.turnOrder) {
      const client = playerView(s, viewer);
      expect(client.players.p1?.restrictions ?? []).toHaveLength(1);
      const r = (client.players.p1?.restrictions ?? [])[0];
      expect(r?.kind, viewer).toBe('no-purchases');
      expect(r?.sourceCardId, viewer).toBe('rsv-khaki-loose');
      expect(r?.sourcePlayer, viewer).toBe('p1');
    }
  });

  it('and the payload still carries no `_` key at any depth', () => {
    let s = play(answered(freshGame()), 'rsv-khaki-loose');
    s = endTurn(s);
    for (const viewer of s.turnOrder) {
      const leaks = allKeys(playerView(s, viewer)).filter((k) => k.startsWith('_'));
      expect(leaks, viewer).toEqual([]);
      // …and the Conspiracy hand is still blank, so the new public field did not
      // come at the cost of the old secret one.
      expect(playerView(s, viewer).players.p1?.conspiracies).toEqual([]);
    }
  });

  it('and a satisfied lock is REMOVED, so a client never has to interpret zero', () => {
    const s = play(answered(freshGame()), 'rsv-khaki-loose');
    expect(restrictionsOf(s, 'p1')[0]?.remaining).toBe(4);
    // Donate the remaining 4 and the entry is gone, not left at zero. One predicate
    // for the client: "do they have any restrictions?", rather than a second rule
    // about what zero means.
    const cleared = play(s, 'rsv-donate');
    expect(restrictionsOf(cleared, 'p1')).toEqual([]);
    expect(playerView(cleared, 'p1').players.p1?.restrictions ?? []).toEqual([]);
  });
});

// ─────────────────────────── nothing else changed ───────────────────────────

describe('a game with no restricted player is unaffected', () => {
  it('a full game on the shipped-shaped deck still plays out, and nobody is restricted', () => {
    let s = answered(freshGame());
    for (let i = 0; i < 8; i += 1) s = endTurn(s);
    for (const p of s.turnOrder) expect(restrictionsOf(s, p), p).toEqual([]);
    expect(poolTotal(s.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 }))
      .toBeLessThanOrEqual(RULES.resourceCap + 12);
  });

  it('and the same action log twice yields deep-equal states, restrictions included', () => {
    const run = (): string => {
      let s = answered(freshGame());
      s = play(s, 'rsv-khaki');
      s = endTurn(s);
      s = play(s, 'rsv-surcharge');
      s = endTurn(s);
      return JSON.stringify(s);
    };
    const a = run();
    playAs(answered(freshGame(PLENTY, 999)), 'rsv-surcharge', 'p3');
    expect(run()).toBe(a);
  });
});

describe('G5 — `no-power` is consulted by usesLeft, so it is total over the vocabulary', () => {
  /**
   * Give the active player three CAPITALIST answers on the manifesto, which is exactly
   * `rules.level3` and therefore exactly what unlocks Prospecting. p22 makes powers
   * DERIVED from the manifesto rather than stored, so writing the manifesto IS writing
   * the power: there is no cached unlock for the restriction to disagree with.
   */
  function capitalist(s: GameState): GameState {
    const cards = IDEOLOGY_CARDS.filter((c) => c.sides[0]?.ideologue === 'capitalist').slice(0, 3);
    const owner = s.activePlayer;
    return {
      ...s,
      players: {
        ...s.players,
        [owner]: {
          ...s.players[owner]!,
          manifesto: [...s.players[owner]!.manifesto, 'capitalist', 'capitalist', 'capitalist'],
          manifestoCards: [...s.players[owner]!.manifestoCards, ...cards.map((c) => c.id)],
        },
      },
    };
  }

  const prospecting = (s: GameState) =>
    reduce(s, s.activePlayer, { type: 'POWER_PROSPECT', give: 'trust', take: ['funds'] }, ctx);

  it('the power works before the card and is refused after it', () => {
    const before = answered(capitalist(freshGame()));
    expect(usesLeft(before.players[before.activePlayer]!, RULES, 'prospecting')).toBeGreaterThan(0);
    expect(prospecting(before).ok).toBe(true);

    const after = play(before, NO_POWER.id);
    expect(usesLeft(after.players[after.activePlayer]!, RULES, 'prospecting')).toBe(0);
    expect(prospecting(after).ok).toBe(false);
  });

  it('and the refusal is a `fail`, not a crash, so the action is legal to ATTEMPT', () => {
    // R12's rule, the one POWER_LAND_GRAB's comment records: a power the player does
    // not hold must be a refusal with a message, never a TypeError. A crash inside
    // `reduce` would take the request down rather than the turn.
    const after = play(answered(capitalist(freshGame())), NO_POWER.id);
    const r = prospecting(after);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it('and it is DEADLOCK-FREE: a restricted player is less able, never frozen', () => {
    // The invariant that matters most for a `restrict` op. A restriction REFUSES
    // actions; it never raises a decision, so it cannot leave a player with no legal
    // move — the class of bug this project has shipped three times. Asserted at every
    // seat count, and on END_TURN specifically, because a FROZEN player cannot end
    // their turn and this one can.
    for (const seats of [
      ['p1', 'p2'],
      ['p1', 'p2', 'p3'],
      ['p1', 'p2', 'p3', 'p4'],
      ['p1', 'p2', 'p3', 'p4', 'p5'],
    ] as const) {
      const base = setup({
        players: [...seats],
        cards: CARDS,
        seed: 7,
        startResources: seats.map(() => ({ funds: 2, clout: 2, media: 2, trust: 2 })),
        ideologyDeck: IDEOLOGY_CARDS.map((c) => c.id),
        voterDeck: VOTERS.map((c) => c.id),
        conspiracyDeck: [NO_POWER.id],
        headlineDeck: [],
      });
      const a = reduce(base, base.activePlayer, { type: 'ANSWER', side: 0 }, ctx);
      expect(a.ok, `${seats.length} seats could answer`).toBe(true);
      if (!a.ok) continue;
      const played = play(a.state, NO_POWER.id);
      expect(
        (played.players[played.activePlayer]?.restrictions ?? []).some((r) => r.kind === 'no-power'),
        `${seats.length} seats carry the restriction`,
      ).toBe(true);
      expect(reduce(played, played.activePlayer, { type: 'END_TURN' }, ctx).ok, `${seats.length} seats`).toBe(true);
    }
  });

  it('and it expires on the owner\'s NEXT turn, which is the printed lifetime', () => {
    // `until: 'next-turn'` is `ownerNextTurn + 1` in `durationExpiry`, and
    // `expireRestrictions` in `advanceTurn` removes what has run out on the same clock
    // that resets `powerUses`. `usesLeft` deliberately does NOT re-check the deadline
    // (it has no GameState), so this test is the only thing pinning the two together:
    // if either moved, the restriction would be in force for a different number of
    // turns than its text says.
    const after = play(answered(capitalist(freshGame())), NO_POWER.id);
    expect(prospecting(after).ok).toBe(false);
    const held = (s: GameState): boolean =>
      (s.players[s.activePlayer]?.restrictions ?? []).some((r) => r.kind === 'no-power');

    let s = after;
    for (let i = 0; i < PLAYERS_3.length * 2 && held(s); i += 1) {
      const next =
        s.phase === 'answer'
          ? reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, ctx)
          : s.phase === 'actions'
            ? reduce(s, s.activePlayer, { type: 'END_TURN' }, ctx)
            : reduce(s, s.activePlayer, { type: 'ACK_HEADLINE' }, ctx);
      if (!next.ok) break;
      s = next.state;
    }
    expect(held(s), 'the restriction outlived the owner\'s next turn').toBe(false);
  });
});
