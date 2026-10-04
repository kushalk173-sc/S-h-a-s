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

/**
 * The engine's OWN source text, read as text.
 *
 * `?raw` rather than `node:fs` + `import.meta.url`, because `import.meta.url` is
 * not a `file:` URL under Vitest's jsdom environment, and because `?raw` is the
 * route `redrawControl.test.tsx` already uses to audit a file that ships: it reads
 * the bytes on disk, untransformed, so this pins the ENGINE's declaration rather
 * than some build of it. It is a text read — no engine value crosses into this
 * package, which is what the secret gate requires.
 */
import engineCardsSource from '../../../engine/src/cards.ts?raw';
import engineStateSource from '../../../engine/src/state.ts?raw';

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
    //
    // The `default` is for THAT op only. It is not a place for a KNOWN op to land,
    // and the block below proves no op of the union ever gets there.
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

// ───────────── every op in the union, and every `restrict` kind in it ─────────────

/**
 * THE OP LIST IS READ OUT OF THE ENGINE'S SOURCE, NOT WRITTEN DOWN HERE.
 * This is the finding that made this block: `describeEffect`'s contract is "never
 * paraphrase a card into a lie", its `restrict` arm lied about four of five kinds,
 * and the suite above — green the whole time — covered five ops and skipped
 * `restrict` altogether. A `default`-fallback test cannot catch that: it proves the
 * function is honest about an op it has never heard of, which is the easy half, and
 * says nothing about the ops it has heard of and handled partly.
 *
 * So the guard is a DIFF in both directions against `packages/engine/src/cards.ts`,
 * the technique `reducer-parity.test.ts` uses and for the same reason: a list kept
 * by hand is a list a new engine op silently escapes. `Effect` is not
 * value-imported — the secret gate forbids it in this package, tests included — and
 * it does not need to be: the union is a slice of readable text.
 */
const CARDS_SOURCE: string = engineCardsSource;

/** The `Effect` union only: from its declaration to the next top-level type. */
const EFFECT_UNION: string = CARDS_SOURCE.slice(
  CARDS_SOURCE.indexOf('export type Effect = ('),
  CARDS_SOURCE.indexOf('\nexport type Count'),
);

/** Every `op` member of the engine's `Effect` union, read off its own source. */
const ENGINE_OPS: ReadonlySet<string> = new Set(
  [...EFFECT_UNION.matchAll(/readonly op: '([a-z-]+)'/g)].map((m) => m[1] ?? ''),
);

/** One representative effect per op. Every member is covered; none is invented. */
const ONE_PER_OP: Readonly<Record<string, Effect>> = {
  gain: { op: 'gain', res: { funds: 2 } },
  lose: { op: 'lose', res: { funds: 2 } },
  'gain-any': { op: 'gain-any', n: 3 },
  'lose-any': { op: 'lose-any', n: 3 },
  'steal-any': { op: 'steal-any', n: 1 },
  voters: { op: 'voters', n: 4 },
  evict: { op: 'evict', n: 1 },
  'discard-voter': { op: 'discard-voter', n: 2 },
  'convert-voter': { op: 'convert-voter', n: 2 },
  gerrymander: { op: 'gerrymander', n: 1 },
  'draw-conspiracy': { op: 'draw-conspiracy', n: 1 },
  // A reveal takes the top of a draw pile FACE UP, which is what makes it
  // publishable at all (§2bis, argued on `GameState.revealedCards`). The
  // representative is the one with an explicit `target`, so the sentence's
  // `TARGET_TEXT` tail is covered by this row rather than only by the branch
  // that has no target.
  reveal: { op: 'reveal', kind: 'conspiracy', n: 1, target: 'each-opponent' },
  'refresh-market': { op: 'refresh-market' },
  restrict: { op: 'restrict', kind: 'surcharge', value: 2 },
  discount: { op: 'discount', n: 1 },
  'set-cap': { op: 'set-cap', to: 10 },
  'move-card': { op: 'move-card', from: 'draw', to: 'hand', n: 1 },
  'borrow-power': { op: 'borrow-power', target: 'chosen-player' },
  // G1. `n` is a `Count` and the corpus validator refuses a `move-peg` whose `n` is
  // not 1, so the representative is the one that ships — which is what makes the
  // singular/plural branch in `describeEffect` covered by this table.
  'move-peg': { op: 'move-peg', n: 1 },
};

describe('every op in the engine Effect union has its own sentence', () => {
  it('the op list was actually derived — non-vacuity', () => {
    // Nineteen, asserted rather than assumed: a slice that silently matched nothing
    // would make every other assertion in this block pass for the wrong reason,
    // which is the exact failure mode this file exists to prevent.
    expect(ENGINE_OPS.size).toBe(19);
    // And the slice really is the `Effect` union rather than the whole file:
    // `block` is an `Interrupt` op outside it, and `reveal` is the nineteenth.
    expect(ENGINE_OPS.has('set-cap')).toBe(true);
    expect(ENGINE_OPS.has('move-peg')).toBe(true);
    expect(ENGINE_OPS.has('reveal')).toBe(true);
    expect(ENGINE_OPS.has('block')).toBe(false);
  });

  it('no op of the union falls through to the honest-but-silent fallback', () => {
    // THE ASSERTION THAT WAS MISSING. Every op gets words of its own, so the window
    // never tells a player "this client has no words for" about an effect the engine
    // is definitely about to apply.
    const silent = [...ENGINE_OPS].filter(
      (op) => describeEffect(ONE_PER_OP[op] as Effect) === 'an effect this client has no words for',
    );
    expect(silent, 'these engine ops have no sentence of their own').toEqual([]);
  });

  it('the representative table covers the union in both directions', () => {
    // Nothing in the table the engine does not have — an invented op would let the
    // block above pass without describing anything.
    expect(Object.keys(ONE_PER_OP).sort()).toEqual([...ENGINE_OPS].sort());
    // …and nothing in the union missing from it, which would make `ONE_PER_OP[op]`
    // undefined and describe an undefined effect.
    for (const op of ENGINE_OPS) expect(ONE_PER_OP[op], `no representative for ${op}`).toBeDefined();
  });

  it('the three previously-silent ops now say what they do', () => {
    // `set-cap`, `move-card` and `borrow-power` had no `case` and fell to the honest
    // default. That was documented behaviour rather than a lie, but it meant the two
    // newest mechanics were invisible in the one panel that announces them.
    expect(describeEffect({ op: 'set-cap', to: 10, target: 'each-opponent' })).toBe(
      'Their resource cap becomes 10 · each opponent',
    );
    expect(describeEffect({ op: 'move-card', from: 'draw', to: 'hand', n: 1 })).toBe(
      '1 extra Ideology Card — answered in place of that player\'s next draw',
    );
    expect(describeEffect({ op: 'move-card', from: 'draw', to: 'destroy', n: 1 })).toContain(
      'removed from the game',
    );
    expect(describeEffect({ op: 'borrow-power', target: 'chosen-player' })).toContain(
      'Level 3 Ideologue Power',
    );
  });

  it('the move names BOTH halves, because the window is read before it happens', () => {
    // G1. `'move-peg'` reached the `default` and printed "an effect this client has no
    // words for" — honest, and useless: the panel's whole job is to let a table read
    // what is about to happen to it, and a relocation between two areas of the board
    // is not the same fact as a resource moving. Both halves are named, and a target
    // clause still rides along because `move-peg` carries one.
    expect(describeEffect({ op: 'move-peg', n: 1 })).toBe(
      'Move 1 voter to an empty area in an adjacent constituency',
    );
    // The plural is real rather than decorative: `n` is a `Count` here, not a literal.
    expect(describeEffect({ op: 'move-peg', n: 2 })).toContain('voters');
    expect(describeEffect({ op: 'move-peg', n: 1, target: 'each-opponent' })).toBe(
      'Move 1 voter to an empty area in an adjacent constituency · each opponent',
    );
  });

  it('no EffectTarget grew with the op — and that is recorded, not assumed', () => {
    // `TARGET_TEXT` is a `Record<EffectTarget, string>`, so this suite cannot see a
    // new target the way it can see a new op: the language fails the build. What it
    // CAN do is say out loud that the union is six members long, so a seventh is a
    // diff in this file rather than a silence.
    const start = CARDS_SOURCE.indexOf('export type EffectTarget =');
    expect(start, 'EffectTarget is gone from cards.ts').toBeGreaterThan(-1);
    /* Member LINES, not a text window: the union has a five-line doc comment between
       two of its members, and slicing to the first `;` or to the next `export type`
       both cut it short — the first at a semicolon inside a comment, the second at
       the wrong declaration. A member line is `| 'x'`, the last one ends in `;`, and
       that semicolon is where the walk stops. */
    const MEMBERS: string[] = [];
    for (const line of CARDS_SOURCE.slice(start).split('\n')) {
      const member = /^\s*\|\s*'([a-z-]+)'\s*;?\s*$/.exec(line);
      if (member === null) continue;
      MEMBERS.push(member[1] as string);
      if (line.trimEnd().endsWith(';')) break;
    }
    expect(
      MEMBERS,
      'EffectTarget grew: TARGET_TEXT needs the new member or the build fails',
    ).toEqual(['you', 'each-opponent', 'everyone', 'leader', 'chosen-player', 'player-after']);
  });
});

/**
 * The kinds the `restrict` OP can name — narrower than `RestrictionKind`, and the
 * distinction is pinned below rather than papered over.
 *
 * Read off the engine's own type instead of written as a literal, so it cannot
 * drift: `RestrictionKind` is the kind of a `Restriction` RECORD (six members,
 * because `borrow-power` writes one directly) while this is the kind a `restrict`
 * EFFECT can carry (five). Handing the six-member type to a `restrict` literal is
 * a compile error, which is the correct outcome and is why this is derived rather
 * than imported.
 */
type RestrictKind = Extract<Effect, { readonly op: 'restrict' }>['kind'];

describe('every restrict kind describes ITSELF, and no two kinds share a sentence', () => {
  // The defect, verbatim. `no-power`, `no-income` and `voter-shortfall` all printed
  // "Every purchase costs N more": a power lock-out reported as a purchase tax, in
  // the one panel whose job is to warn the table BEFORE it happens. Each row is a
  // different subsystem, so each row must read differently.
  const KINDS: readonly {
    readonly kind: RestrictKind;
    readonly owed?: number;
    readonly must: RegExp;
    readonly mustNot: RegExp;
  }[] = [
    {
      kind: 'no-purchases',
      owed: 4,
      must: /may not purchase until they donate/,
      mustNot: /costs \d+ more/,
    },
    { kind: 'surcharge', must: /Every purchase costs 3 more/, mustNot: /may not purchase/ },
    { kind: 'no-power', must: /cannot use an Ideologue Power/, mustNot: /purchase/i },
    { kind: 'no-income', must: /no answer payout and no passive bonus/, mustNot: /purchase/i },
    {
      kind: 'voter-shortfall',
      owed: 2,
      must: /next 2 Voter Cards they influence give 1 fewer/,
      mustNot: /purchase/i,
    },
  ];

  it('names every kind the RESTRICT OP can name, and knows the sixth is not one', () => {
    // Derived from the engine's own source, for the reason the op list is derived:
    // a hand-kept list is a list a new kind escapes, and a new kind would arrive
    // here as the surcharge sentence all over again.
    const at = CARDS_SOURCE.indexOf("readonly op: 'restrict';");
    const declared = new Set(
      [
        ...CARDS_SOURCE.slice(at, CARDS_SOURCE.indexOf('readonly value: number;', at)).matchAll(
          // Line-anchored, because the declaration's own doc comments QUOTE its
          // members and name their neighbours; an unanchored match reads prose as
          // members and passes for the wrong reason.
          /^[ \t]*\|?[ \t]*'([a-z-]+)'/gm,
        ),
      ].map((m) => m[1] ?? ''),
    );
    expect(declared.size, 'the restrict op declares five kinds').toBe(5);
    expect(KINDS.map((k) => k.kind).sort()).toEqual([...declared].sort());

    // AND THE SIXTH, which is the distinction worth pinning down.
    //
    // `RestrictionKind` in `state.ts` has SIX members, not five. The two types are
    // not the same type and the difference is load-bearing here: the sixth,
    // `'borrowed-powers'`, is written onto a player's `restrictions` by the
    // `borrow-power` op (`reduce.ts`) and CANNOT be named by a `restrict` effect at
    // all. So it can never reach this function as an `Effect`, and there is
    // correctly no branch that would try to describe it — `borrow-power` has its
    // own sentence, asserted above.
    //
    // An audit read "three of five kinds" and was right about the op; it read
    // `RestrictionKind` and would have got six. Both numbers are asserted here so
    // the next reader does not have to choose between them.
    const allKinds = new Set(
      [
        ...engineStateSource
          .slice(
            engineStateSource.indexOf('export type RestrictionKind'),
            engineStateSource.indexOf('export type Restriction ='),
          )
          .matchAll(/^[ \t]*\|?[ \t]*'([a-z-]+)'/gm),
      ].map((m) => m[1] ?? ''),
    );
    expect(allKinds.size, 'RestrictionKind is the wider type').toBe(6);
    expect([...allKinds].filter((k) => !declared.has(k))).toEqual(['borrowed-powers']);
  });

  for (const row of KINDS) {
    it(`'${row.kind}' is described as itself`, () => {
      const e: Effect = {
        op: 'restrict',
        kind: row.kind,
        value: row.kind === 'surcharge' ? 3 : 1,
        ...(row.owed === undefined ? {} : { owed: row.owed }),
        target: 'each-opponent',
      };
      const text = describeEffect(e);
      expect(text).toMatch(row.must);
      expect(text).not.toMatch(row.mustNot);
      // And the target clause still rides along — the sentence describes the effect,
      // it does not replace the target.
      expect(text).toContain('each opponent');
    });
  }

  it('no two kinds produce the same sentence', () => {
    const texts = KINDS.map((row) =>
      describeEffect({ op: 'restrict', kind: row.kind, value: 1, owed: 1 }),
    );
    expect(new Set(texts).size, 'two kinds share a sentence').toBe(KINDS.length);
  });

  it("voter-shortfall's two numbers are not interchangeable", () => {
    // `value` is how many FEWER each of the next `owed` cards yields; `owed` is how
    // many CARDS. Swapping them prints a true-looking sentence about the wrong rule.
    const e: Effect = { op: 'restrict', kind: 'voter-shortfall', value: 1, owed: 3 };
    expect(describeEffect(e)).toBe('The next 3 Voter Cards they influence give 1 fewer');
    const swapped: Effect = { op: 'restrict', kind: 'voter-shortfall', value: 3, owed: 1 };
    expect(describeEffect(swapped)).toBe('The next Voter Card they influence gives 3 fewer');
    expect(describeEffect(e)).not.toBe(describeEffect(swapped));
  });

  it('a restriction kind this client has never heard of is reported, not guessed', () => {
    // The inner `default` earns its place the same way the outer one does: the engine
    // is closed today, and a payload is attacker-adjacent input tomorrow.
    const future = {
      op: 'restrict',
      kind: 'no-telepathy',
      value: 1,
    } as unknown as Effect;
    expect(describeEffect(future)).toBe('a restriction this client has no words for');
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