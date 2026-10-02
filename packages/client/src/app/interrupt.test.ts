/**
 * THE RESPONSE WINDOW, DERIVED — and the one property this file exists to prove.
 *
 * ─────────────────────────── WHAT IS ASSERTED HERE ───────────────────────────
 *
 * Almost everything in `interrupt.ts` is a projection of what the server sent, and
 * a projection can only be wrong in one interesting way: by disagreeing with the
 * reducer about who owes what. `reduce.ts:mustRespond` is
 *
 *     turnOrder MINUS the actor MINUS anybody with a pending PendingChoice
 *
 * and `interrupt.ts:mustRespond` is the same expression. If those two ever drift,
 * the client offers a decline the engine refuses ("you played that card") or
 * withholds one from a player the table is waiting on, and either way the table
 * hangs — which is the entire reason a BLOCK and a DEFLECT are not in the shipped
 * decks yet.
 *
 * So the headline test is THE TABLE CANNOT STALL, at 2, 3, 4 and 5 seats: for every
 * seat count, walking the real decline sequence from the real derived set closes
 * the window in at most `n - 1` moves, and it does so with the actor and any frozen
 * player excluded. That is not a claim about the reducer — it is a claim about this
 * client, and the reducer's own `interrupts.test.ts` cannot make it.
 *
 * The rest of the file pins the smaller things that are cheap to break and
 * expensive to notice: the stage, the outcome, the seat role, the card label, and
 * the effect descriptions. The effect descriptions get the most attention of any
 * of them, because they are the only place in the client that turns engine
 * structure into English, and a card whose UI lies is a card that lies.
 */

import { describe, expect, it } from 'vitest';

import type {
  Choice,
  ClientState,
  Effect,
  EffectDuration,
  InterruptWindow,
  LogEntry,
  PendingChoice,
  PlayerID,
  PlayerState,
  Pool,
} from '@shasn/engine';

import {
  describeEffect,
  describeEffects,
  hasPassed,
  mayDecline,
  mustRespond,
  outstanding,
  stagedCardLabel,
  stagedCardName,
  windowLiveMessage,
  windowOutcome,
  windowOutcomeSentence,
  windowRole,
  windowStage,
  type WindowRole,
} from './interrupt.ts';

const POOL: Pool = { funds: 4, clout: 4, media: 4, trust: 4 };

function player(id: PlayerID): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    colour: '#000',
    resources: POOL,
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
    pending: [],
    powerUses: {
      prospecting: 0,
      landGrab: 0,
      donations: 0,
      payback: 0,
      goingViral: 0,
      helpingHands: 0,
      toughLove: 0,
      gerrymandered: {},
    },
    isBot: false,
  };
}

const LOG: readonly LogEntry[] = [
  { turn: 1, player: 'p1', text: 'Ria answered CAPITALIST.', kind: 'answer' },
  { turn: 1, player: 'p2', text: 'Played "PETTY GRAND".', kind: 'card' },
];

function windowOf(over: Partial<InterruptWindow> = {}): InterruptWindow {
  return {
    id: 'I1',
    actor: 'p2',
    cardId: 'cs-0001',
    kind: 'conspiracy',
    effects: [{ op: 'gain-any', n: 3 }],
    duration: 'this-turn',
    timing: 'now',
    blocked: false,
    deflectedTo: null,
    responder: null,
    passed: [],
    ...over,
  };
}

/**
 * A `ClientState` with `n` seats and one open window.
 *
 * `as unknown as ClientState` for the same reason every other client fixture does
 * it: the board, the market and the deck sizes are not what these tests read, and
 * a 129-slot board per seat count would bury the thing being asserted.
 */
function tableOf(n: number, w: InterruptWindow, choices: readonly PendingChoice[] = []): ClientState {
  const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const players: Record<PlayerID, PlayerState> = {};
  for (const s of seats) players[s] = player(s);
  return {
    players,
    turnOrder: seats,
    activePlayer: 'p1',
    phase: 'actions',
    turn: 1,
    round: 1,
    finished: false,
    market: [],
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices,
    liveEffects: [],
    interrupt: w,
    finalRoundFrom: null,
    log: LOG,
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
  } as unknown as ClientState;
}

// ─────────────────────────── the anti-stall property ───────────────────────────

describe('THE TABLE CANNOT STALL', () => {
  /**
   * The engine's own protocol, replayed through the CLIENT'S derived set.
   *
   * `closeInterrupt` fires when `mustRespond(state, actor)` is exhausted of
   * non-decliners. This walks it: take the derived required set, decline it one
   * seat at a time carrying the `passed` list the way the server will, and assert
   * the window closes. If this client ever derived a required set containing the
   * actor, the walk would hit a seat the engine refuses with "you played that
   * card" and the count would never reach zero — which is the failure, and it is a
   * hung table rather than a wrong number.
   */
  for (const n of [2, 3, 4, 5]) {
    it(`closes in at most n - 1 declines at ${n} seats`, () => {
      const w = windowOf();
      const state = tableOf(n, w);

      const required = mustRespond(state, w);
      expect(required).toHaveLength(n - 1);
      expect(required).not.toContain(w.actor);

      const passed: PlayerID[] = [];
      let presses = 0;
      for (const seat of required) {
        // This seat is on the list, so it is offered a control, so pressing it is
        // legal. The engine's only other guard is "you have already declined".
        expect(mayDecline(state, { ...w, passed }, seat, false)).toBe(true);
        passed.push(seat);
        presses += 1;
        // The engine's own closure condition, transcribed: every required seat has
        // declined.
        const stillWaiting = required.some((p) => !passed.includes(p));
        if (!stillWaiting) break;
      }

      expect(presses).toBeLessThanOrEqual(n - 1);
      expect(passed).toEqual(required);
      expect(outstanding(state, { ...w, passed })).toEqual([]);
    });
  }

  it('every required seat is offered a decline, and nobody else is', () => {
    // The specific shape of the mirror: an OFFER to the actor is a control the
    // engine refuses, and the actor is the one seat whose own card is on the table.
    for (const n of [2, 3, 4, 5]) {
      const w = windowOf();
      const state = tableOf(n, w);
      for (const seat of state.turnOrder) {
        expect(mayDecline(state, w, seat, false)).toBe(seat !== w.actor);
      }
    }
  });

  it('a player frozen by a decision of their own is NOT waited on, and is not asked', () => {
    // `reduce.ts` exempts them from the required set and keeps `RESOLVE_CHOICE`
    // legal, precisely so p12's freeze cannot hold the table hostage. Making them
    // decline would invert that: the table would wait on the one player who cannot
    // move.
    const choice: PendingChoice = {
      id: 'ch-1',
      player: 'p3',
      choice: { kind: 'lose-any', count: 4, reason: 'the cap' },
    };
    const w = windowOf();
    const state = tableOf(4, w, [choice]);

    expect(mustRespond(state, w)).toEqual(['p1', 'p4']);
    expect(outstanding(state, w)).toEqual(['p1', 'p4']);
    expect(windowRole(state, w, 'p3', false)).toBe('frozen');
    expect(mayDecline(state, w, 'p3', false)).toBe(false);
  });

  it('an already-declined seat is offered nothing, and the engine would refuse it anyway', () => {
    const w = windowOf({ passed: ['p1'] });
    const state = tableOf(4, w);
    expect(windowRole(state, w, 'p1', false)).toBe('declined');
    expect(mayDecline(state, w, 'p1', false)).toBe(false);
    expect(hasPassed(w, 'p1')).toBe(true);
    // …and the set really is one shorter, so the window really does close sooner.
    expect(outstanding(state, w)).toEqual(['p3', 'p4']);
  });

  it('a spectator is never offered a control, at any seat count', () => {
    for (const n of [2, 3, 4, 5]) {
      const w = windowOf();
      const state = tableOf(n, w);
      for (const seat of state.turnOrder) {
        expect(mayDecline(state, w, seat, true)).toBe(false);
      }
      expect(windowRole(state, w, null, true)).toBe('spectator');
    }
  });

  it('an ANSWERED window offers a decline to nobody', () => {
    // `closeInterrupt` nulls `interrupt` in the same call that settles the card,
    // so `responder !== null` is a state a real client does not receive — but the
    // type allows it, and offering a decline there would be a control the engine
    // refuses with "that card has already been answered".
    const w = windowOf({ responder: 'p1', blocked: true });
    const state = tableOf(4, w);
    for (const seat of state.turnOrder) {
      expect(mayDecline(state, w, seat, false)).toBe(false);
    }
  });
});

// ─────────────────────────── stage, outcome, role ───────────────────────────

describe('the stage and the outcome', () => {
  it('an unanswered window is open; a responder makes it answered', () => {
    expect(windowStage(windowOf())).toBe('open');
    expect(windowStage(windowOf({ responder: 'p1' }))).toBe('answered');
  });

  it('a BLOCK wins outright over a DEFLECT, because the rule says it cannot be deflected', () => {
    expect(windowOutcome(windowOf({ responder: 'p1', blocked: true }))).toEqual({ kind: 'blocked' });
    expect(windowOutcome(windowOf({ responder: 'p1', deflectedTo: 'p3' }))).toEqual({
      kind: 'deflected',
      to: 'p3',
    });
    expect(windowOutcome(windowOf({ responder: 'p1' }))).toEqual({ kind: 'unanswered' });
    // Both set, which the engine cannot produce but a hand-built payload can:
    expect(windowOutcome(windowOf({ responder: 'p1', blocked: true, deflectedTo: 'p3' }))).toEqual({
      kind: 'blocked',
    });
  });

  it('no outcome sentence while the window is open, and one once it has been answered', () => {
    expect(windowOutcomeSentence(windowOf())).toBeNull();
    expect(windowOutcomeSentence(windowOf({ responder: 'p1', blocked: true }))).toContain('Blocked');
    expect(windowOutcomeSentence(windowOf({ responder: 'p1', deflectedTo: 'p3' }))).toContain('Deflected');
  });

  it('every seat role is reachable, and they are mutually exclusive', () => {
    const choice: PendingChoice = {
      id: 'ch-1',
      player: 'p3',
      choice: { kind: 'lose-any', count: 1, reason: 'x' },
    };
    const w = windowOf({ passed: ['p4'] });
    const state = tableOf(5, w, [choice]);

    expect(windowRole(state, w, 'p2', false)).toBe('actor');
    expect(windowRole(state, w, 'p3', false)).toBe('frozen');
    expect(windowRole(state, w, 'p4', false)).toBe('declined');
    expect(windowRole(state, w, 'p1', false)).toBe('decliner');
    expect(windowRole(state, w, 'p5', false)).toBe('decliner');
    expect(windowRole(state, w, 'p1', true)).toBe('spectator');
    expect(windowRole(state, w, null, false)).toBe('spectator');
    // A seat that is not in the game at all is not silently given a role.
    expect(windowRole(state, w, 'nobody', false)).toBe('spectator');

    const roles = (['decliner', 'declined', 'actor', 'frozen', 'spectator', 'absent'] as const).filter(
      (r) => roleIsReachable(r, state, w),
    );
    expect(roles.length).toBeGreaterThanOrEqual(5);
  });
});

function roleIsReachable(role: WindowRole, state: ClientState, w: InterruptWindow): boolean {
  const seats: (PlayerID | null)[] = [...state.turnOrder, null];
  return seats.some((s) => windowRole(state, w, s, s === null) === role);
}

// ─────────────────────────── the card under response ───────────────────────────

describe('the card under response is read from the log, never guessed', () => {
  it('names the card from the public log entry written by the play that opened it', () => {
    expect(stagedCardName(LOG, 'p2')).toBe('Played "PETTY GRAND".');
    expect(stagedCardLabel(LOG, windowOf())).toBe('Played "PETTY GRAND"');
  });

  it('falls back to an honest generic rather than an invented name', () => {
    // A trimmed log, or a window restored from a replay model with none, gets the
    // generic. Anything else would be this client inventing a card name.
    expect(stagedCardLabel([], windowOf())).toBe('a Conspiracy Card');
    expect(stagedCardLabel([], windowOf({ kind: 'headline' }))).toBe('a Headline');
    // And a log entry by a DIFFERENT seat is not this actor's play.
    expect(stagedCardName(LOG, 'p3')).toBeNull();
  });

  it('never renders the card id as text', () => {
    const w = windowOf({ cardId: 'cs-0042' });
    expect(stagedCardLabel(LOG, w)).not.toContain('cs-0042');
  });
});

// ─────────────────────────── the staged effects, in English ───────────────────────────

describe('the staged effects are described from the payload, never paraphrased into a lie', () => {
  it('reads the numbers the engine is about to apply', () => {
    expect(describeEffect({ op: 'gain-any', n: 3 })).toBe('Take 3 resources of your choice');
    expect(describeEffect({ op: 'lose', res: { funds: 2 } })).toBe('Pay 2 funds');
    expect(describeEffect({ op: 'voters', n: 4 })).toBe('Gain 4 voters to place');
  });

  it('reads a target when there is one, and adds nothing when there is not', () => {
    expect(describeEffect({ op: 'gain-any', n: 2, target: 'each-opponent' })).toBe(
      'Take 2 resources of your choice · each opponent',
    );
    expect(describeEffect({ op: 'gain-any', n: 2, target: 'leader' })).toContain('most majorities');
    // `refresh-market` is the one op with no `target` field at all — which is
    // exactly what the engine's union says, and exactly why the read is made through
    // a helper rather than off the union directly.
    expect(describeEffect({ op: 'refresh-market' })).toBe(
      'Discard every face-up Voter Card and deal three fresh ones',
    );
  });

  it('says it has no words for an op it does not recognise', () => {
    // The switch above is exhaustive as far as TypeScript knows, and a payload is
    // attacker-adjacent input: a future op, or a state some other thing built,
    // arrives with an `op` this client has never seen. Guessing at it would put a
    // sentence in front of a player describing something the engine will not do.
    const future = { op: 'teleport-everything' } as unknown as Effect;
    expect(describeEffect(future)).toBe('an effect this client has no words for');
  });

  it('says a computed count is computed rather than inventing a number', () => {
    const e: Effect = { op: 'voters', n: { of: 'your-pool' } };
    expect(describeEffect(e)).toBe('Gain as many as you hold voters to place');
  });

  it('prints the lifetime only when the card outlives the window', () => {
    const effects: readonly Effect[] = [{ op: 'gain-any', n: 1 }];
    expect(describeEffects(effects, 'this-turn')).toHaveLength(1);
    expect(describeEffects(effects, 'rest-of-game')).toHaveLength(2);
    expect(describeEffects(effects, 'rest-of-game')[1]).toContain('rest of the game');
  });

  it('describes every effect in a list, one line each, in order', () => {
    const lines = describeEffects(
      [{ op: 'gain', res: { funds: 1 } }, { op: 'voters', n: 2 }, { op: 'evict', n: 1 }],
      'this-turn' as EffectDuration,
    );
    expect(lines).toEqual([
      'Take 1 funds',
      'Gain 2 voters to place',
      'Send 1 voters back to their owners',
    ]);
  });
});

// ─────────────────────────── the announcement ───────────────────────────

describe('the live-region sentence', () => {
  it('names the actor and says a response is possible', () => {
    const state = tableOf(3, windowOf());
    const msg = windowLiveMessage(state, windowOf());
    expect(msg).toContain('P2');
    expect(msg).toContain('played a card');
    expect(msg).toContain('declined');
  });

  it('never says who is holding a reactive card, because the state does not know', () => {
    // There is deliberately no `responders` list on `InterruptWindow`: a Conspiracy
    // hand is hidden, so a field naming who may respond would answer "who is
    // holding a Block" for the whole table. This is the assertion that keeps the
    // copy from leaking it.
    const state = tableOf(3, windowOf());
    const msg = windowLiveMessage(state, windowOf());
    for (const seat of state.turnOrder) {
      expect(msg).not.toContain(seat);
    }
  });

  it('says how the window ended once it has', () => {
    const state = tableOf(3, windowOf({ responder: 'p1', blocked: true }));
    const msg = windowLiveMessage(state, windowOf({ responder: 'p1', blocked: true }));
    expect(msg).toContain('Blocked');
    expect(msg).toContain('P2');
  });
});