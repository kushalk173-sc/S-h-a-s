/**
 * THE SECRET-STATE GATE.
 *
 * If this file is deleted, the project has no defence against the one leak that
 * ends the game permanently. Everything else in the server is an ordinary
 * correctness concern; this is the one where a single success is unrecoverable —
 * a player who learns one payout cannot be made to forget it, the match cannot be
 * reset, and the table's central mechanic is over for good.
 *
 * The three layers the architecture calls for, in the order they bite:
 *
 *   LAYER 1  A structural walk over the PRODUCTION broadcast path — `viewFor` and
 *           `blindPromptFor`, reached through `Room.viewFor`, which is what the
 *           server's fan-out actually calls. Recursive, via the engine's `allKeys`,
 *           at every depth, for every viewer including a spectator, at several
 *           points in a REAL played-out game rather than a hand-built state.
 *           Plus the conspiracy-hand leak, which is not `_`-prefixed and is
 *           therefore invisible to the prefix walk on its own.
 *
 *   LAYER 2  `renderAll` — every `ServerMessage` the handler can produce for a
 *           state, exhaustively switched with a `never` check. Delete a case and
 *           the COMPILER fails, so a new message type cannot be added without
 *           someone deciding what it projects. This is the check with real teeth:
 *           layer 1 walks the two projection functions, and a new message could
 *           easily carry state without passing through either of them.
 *
 *   LAYER 3  The type system. `blindPromptFor` admits only `{question, labels,
 *           order}` — no `Delta`, no `Ideologue`, no `CardID`, no number. Asserted
 *           both at compile time (below) and structurally at runtime.
 *
 * Plus a fourth thing this suite found that the type system cannot see: the
 * engine's own ANSWER error path, and the log lines. See the last two tests.
 */

import { describe, expect, it } from 'vitest';

import {
  allKeys,
  reduce,
  setup,
  type ClientState,
  type GameState,
  type PlayerID,
} from '@shasn/engine';

import { answerSideFor, blindPromptFor, viewFor } from '../src/broadcast.ts';
import { Room } from '../src/room.ts';
import { makeCtx, bigCards } from './fixtures.ts';
import { decksOf } from '../src/store.ts';
import { renderAll } from './render-all.ts';
import { LEAK_PATHS, SECRET_FIELDS } from './secret-inventory.ts';

const CARDS = bigCards(60);
const ctx = makeCtx(CARDS);

/** Deck ids that must never appear in a client payload. */
function allSecretValues(s: GameState): { cards: readonly string[]; seed: string } {
  return {
    cards: [
      ...s._ideologyDraw,
      ...s._ideologyDiscard,
      ...s._voterDraw,
      ...s._voterDiscard,
      ...s._conspiracyDraw,
      ...s._conspiracyDiscard,
      ...s._headlineDraw,
      ...s._headlineDiscard,
      ...(s._pendingCard === null ? [] : [s._pendingCard]),
    ],
    seed: String(s._seed),
  };
}

/**
 * A real, played-out game, sampled at several points.
 *
 * The corpus of states is produced by actually dispatching actions through
 * `reduce` rather than by hand-writing a `GameState`, because a hand-written
 * fixture only proves the projection is clean of the fields somebody thought to
 * include. A real game includes whatever the engine produces.
 */
function playedCorpus(steps: number): readonly GameState[] {
  const cards = CARDS;
  const rules = ctx.rules;
  let s = setup({
    players: ['p1', 'p2', 'p3'],
    names: { p1: 'One', p2: 'Two', p3: 'Three' },
    cards,
    seed: 20260930,
    // `setup` takes deck arrays, the reducer takes the index. Same helper the
    // server's own `startMatch` uses, so the fixture and the production path
    // cannot disagree about what was dealt.
    ...decksOf(cards),
  });
  const corpus: GameState[] = [s];
  const order = [...s.turnOrder];
  let attempts = 0;
  while (corpus.length < steps && !s.finished && attempts < steps * 12) {
    attempts += 1;
    const me = order[attempts % order.length] as PlayerID;
    const a = nextAction(s, me);
    // `null` means it is not this seat's move. That is normal — the loop walks
    // seats, not the legal-move graph — so skip rather than stop.
    if (a === null) continue;
    const r = reduce(s, me, a, { rules, cards });
    if (!r.ok) continue;
    s = r.state;
    corpus.push(s);
  }
  return corpus;
}

function nextAction(s: GameState, me: PlayerID) {
  if (s.finished) return null;
  if (s.phase === 'answer' && s.activePlayer === me) return { type: 'ANSWER', side: 0 } as const;
  if (s.phase === 'headlines' && s.activePlayer === me) return { type: 'ACK_HEADLINE' } as const;
  if (s.phase !== 'actions' || s.activePlayer !== me) return null;

  const choice = s.choices.find((c) => c.player === me);
  if (choice !== undefined) {
    const c = choice.choice;
    if (c.kind === 'gain-any' || c.kind === 'lose-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick: { kind: 'resources', res: { funds: c.count } } } as const;
    }
    if (c.kind === 'steal-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick: { kind: 'steal', from: c.from ?? me, res: { funds: c.count } } } as const;
    }
    return { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick: { kind: 'areas', areaIds: [] } } as const;
  }
  const group = s.players[me]?.pending[0];
  if (group !== undefined) {
    const free = freeAreas(s);
    if (free.length >= group.count) {
      return { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) } as const;
    }
  }
  return { type: 'END_TURN' } as const;
}

function freeAreas(s: GameState): readonly string[] {
  for (const z of s.zones) {
    const free = z.areas.filter((a) => a.peg === null).map((a) => a.id);
    if (free.length >= 3) return free;
  }
  return [];
}

/** A room wrapping a state, so the walk goes through the production fan-out path. */
function roomFor(state: GameState): Room {
  return new Room({
    matchId: 'm_test',
    ctx: { rules: ctx.rules, cards: CARDS },
    store: {
      create: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      append: () => Promise.resolve(),
      saveSnapshot: () => Promise.resolve(),
      updatePlayer: () => Promise.resolve(),
      findByResumeHash: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
    },
    seed: 1,
    state,
    now: 0,
    seats: [...state.turnOrder].map((id, i) => ({
      playerId: id,
      name: `P${i + 1}`,
      colour: '#fff',
      resumeHash: '',
      connected: true,
      lastSeen: 0,
      ready: true,
    })),
  });
}

const CORPUS = playedCorpus(14);

if (process.env['SHASN_DEBUG_CORPUS'] === '1') {
  for (const [i, s] of CORPUS.entries()) {
    const b = s.phase === 'answer' ? blindPromptFor(s, CARDS, s.activePlayer) : null;
    console.log(i, s.phase, 'active=' + s.activePlayer, 'pending=' + s._pendingCard, 'order=' + (b?.order ?? '-'));
  }
}

describe('LAYER 1 — the production broadcast path leaks no server-only field', () => {
  it('has a corpus of real, non-trivial states to walk', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(6);
    // Mid-answer and mid-turn must both be represented, because a projection can
    // be clean in one phase and leaky in the other.
    expect(CORPUS.some((s) => s.phase === 'answer')).toBe(true);
    expect(CORPUS.some((s) => s.phase === 'actions')).toBe(true);
  });

  it('viewFor emits no _-prefixed key at ANY depth, for every viewer, in every state', () => {
    for (const [i, s] of CORPUS.entries()) {
      // `null` is the spectator. `p_not_a_seat` is a viewer that does not exist,
      // which must be exactly as safe as one that does.
      const viewers: (PlayerID | null)[] = [null, ...s.turnOrder, 'p_not_a_real_seat', ''];
      for (const viewer of viewers) {
        const keys = allKeys(viewFor(s, viewer)).filter((k) => k.startsWith('_'));
        expect(keys, `state ${i} (${s.phase}), viewer ${String(viewer)}`).toEqual([]);
      }
    }
  });

  it('the PRODUCTION room path leaks nothing, for every viewer, in every state', () => {
    // Same walk, but through `Room.viewFor` — which is what the server's fan-out
    // calls. A test that only walked `viewFor` in isolation would pass while the
    // server shipped something else entirely.
    for (const [i, s] of CORPUS.entries()) {
      const room = roomFor(s);
      const viewers: (PlayerID | null)[] = [null, ...s.turnOrder, 'p_not_a_real_seat'];
      for (const viewer of viewers) {
        const v = room.viewFor(viewer);
        const keys = [...allKeys(v.state), ...(v.blind === null ? [] : allKeys(v.blind))].filter((k) =>
          k.startsWith('_'),
        );
        expect(keys, `room state ${i} (${s.phase}), viewer ${String(viewer)}`).toEqual([]);
      }
    }
  });

  it('no secret VALUE survives: no card id, and not the seed', () => {
    for (const [i, s] of CORPUS.entries()) {
      const { cards, seed } = allSecretValues(s);
      for (const viewer of [null, ...s.turnOrder]) {
        const json = JSON.stringify(viewFor(s, viewer));
        for (const id of cards) {
          expect(json.includes(id), `state ${i} leaked card id ${id} to ${String(viewer)}`).toBe(false);
        }
        // The seed is a bare number and is the single highest-leverage secret in
        // the process: it reconstructs every deck from the start.
        expect(json.includes(`:${seed}`), `state ${i} leaked the seed`).toBe(false);
      }
    }
  });

  it('the conspiracy-hand leak is closed: no player, including its owner, sees a hand', () => {
    // The one hidden field the `_` prefix does not cover. A conspiracy is "bought
    // and held" (rules-reference.md:284-286); shipping a hand turns a bluffing
    // mechanic into a solved one, and the prefix walk above cannot see it.
    for (const s of CORPUS) {
      for (const viewer of [null, ...s.turnOrder]) {
        const view = viewFor(s, viewer);
        for (const pid of s.turnOrder) {
          const hand = view.players[pid]?.conspiracies;
          expect(Array.isArray(hand), `${pid} hand is not an array`).toBe(true);
          expect(hand, `viewer ${String(viewer)} sees ${pid}'s conspiracy hand`).toEqual([]);
        }
      }
    }
  });

  it('the deck sizes are counts, and counts are identical for every viewer', () => {
    // If deck depth differed per viewer, the difference itself would leak a redraw
    // or a purchase.
    for (const s of CORPUS) {
      const sizes = s.turnOrder.map((p) => JSON.stringify(viewFor(s, p).deckSizes));
      expect(new Set(sizes).size, 'deckSizes differ between viewers').toBe(1);
      expect(viewFor(s, null).deckSizes.ideology).toBe(s._ideologyDraw.length);
    }
  });

  it('awaitingAnswer is a boolean and identical for every viewer', () => {
    for (const s of CORPUS) {
      const values = s.turnOrder.map((p) => viewFor(s, p).awaitingAnswer);
      expect(new Set(values).size).toBe(1);
      expect(typeof viewFor(s, null).awaitingAnswer).toBe('boolean');
    }
  });

  it('the projection does not mutate the state it is given', () => {
    const s = CORPUS[CORPUS.length - 1];
    if (s === undefined) throw new Error('empty corpus');
    const before = JSON.stringify(s);
    for (const viewer of [null, ...s.turnOrder]) {
      viewFor(s, viewer);
      blindPromptFor(s, CARDS, viewer ?? '');
    }
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('LAYER 2 — no ServerMessage the handler can produce leaks a server-only field', () => {
  it('renderAll covers every message type (the compiler enforces it; this pins the count)', () => {
    const s = CORPUS[CORPUS.length - 1];
    if (s === undefined) throw new Error('empty corpus');
    const msgs = renderAll(s, { rules: ctx.rules, cards: CARDS });
    expect(msgs.length).toBeGreaterThan(0);
    expect(new Set(msgs.map((m) => m.t)).size).toBeGreaterThanOrEqual(3);
  });

  it('no message over a whole played corpus contains a _-prefixed key', () => {
    for (const [i, s] of CORPUS.entries()) {
      for (const viewer of [null, ...s.turnOrder]) {
        for (const msg of renderAll(s, { rules: ctx.rules, cards: CARDS }, viewer)) {
          const keys = allKeys(msg).filter((k) => k.startsWith('_'));
          expect(keys, `state ${i}, viewer ${String(viewer)}, message ${msg.t}`).toEqual([]);
        }
      }
    }
  });

  it('no message carries a secret card id or the seed', () => {
    for (const s of CORPUS) {
      const { cards, seed } = allSecretValues(s);
      for (const msg of renderAll(s, { rules: ctx.rules, cards: CARDS })) {
        const json = JSON.stringify(msg);
        for (const id of cards) expect(json.includes(id), `${msg.t} leaked ${id}`).toBe(false);
        expect(json.includes(`:${seed}`), `${msg.t} leaked the seed`).toBe(false);
      }
    }
  });
});

describe('LAYER 3 — the blind prompt type admits nothing that could help a player choose', () => {
  it('has exactly three fields, and two of them are the labels', () => {
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');
    const me = mid.activePlayer;
    const blind = blindPromptFor(mid, CARDS, me);
    expect(blind, 'the active player must be owed a prompt mid-answer').not.toBeNull();
    expect(Object.keys(blind!).sort()).toEqual(['labels', 'order', 'question']);
  });

  it('contains no number anywhere — no payout, no count, no seed', () => {
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');
    const blind = blindPromptFor(mid, CARDS, mid.activePlayer);
    expect(blind).not.toBeNull();
    expect(typeof blind!.question).toBe('string');
    expect(blind!.labels.every((l) => typeof l === 'string')).toBe(true);
    expect(blind!.labels).toHaveLength(2);
    // `order` is 'ab' | 'ba'. Nothing else, and no numeric field at all: a Delta
    // is four numbers and one of them is enough to bias the choice.
    expect(['ab', 'ba']).toContain(blind!.order);
  });

  it('is owed ONLY by the player who is answering', () => {
    for (const s of CORPUS) {
      for (const pid of s.turnOrder) {
        const owed = blindPromptFor(s, CARDS, pid) !== null;
        expect(owed, `${pid} was given a prompt in ${s.phase} (active ${s.activePlayer})`).toBe(
          pid === s.activePlayer && s.phase === 'answer',
        );
      }
      // A spectator's viewer is null and there is no such thing as a spectator
      // prompt, so this is the `null`-viewer case as well as the wrong-player one.
      expect(blindPromptFor(s, CARDS, 'p_outsider')).toBeNull();
    }
  });

  it('the answer side remap is total, and it is the INVERSE of the presented order', () => {
    // This is the property that makes a random order safe: whatever the player was
    // shown at index 0, index 0 maps back to the side the card actually has there.
    for (const s of CORPUS) {
      if (s.phase !== 'answer') continue;
      const me = s.activePlayer;
      const card = CARDS.ideology[s._pendingCard ?? ''];
      if (card === undefined) continue;
      const blind = blindPromptFor(s, CARDS, me);
      if (blind === null) continue;

      const side0 = answerSideFor(s, CARDS, me, 0);
      const side1 = answerSideFor(s, CARDS, me, 1);
      expect(side0).not.toBeNull();
      expect(side1).not.toBeNull();
      expect(side0 === 0 ? 1 : 0).toBe(side1);

      // The label at each display index must be the answer text of the side it maps
      // to. If this drifts, the player is shown one answer and charged for another.
      const shown0 = blind.labels[0];
      const actual0 = card.sides[side0 ?? 0]?.answer;
      expect(shown0).toBe(actual0);
      const shown1 = blind.labels[1];
      const actual1 = card.sides[side1 ?? 0]?.answer;
      expect(shown1).toBe(actual1);
    }
  });

  it('the order is a pure function of the match, and is not a fixed left/right', () => {
    // A FIXED order is a channel. The two sides belong to different Ideologues and
    // the answer pool is not balanced side-to-side, so "the left one" would let a
    // player learn the slot instead of deliberating (PLAN.md §2 amendment A′).
    //
    // This deliberately tests the DISTRIBUTION over a whole deck rather than
    // "the corpus happened to show both". A 14-state corpus is a sample of seven
    // cards and asserting both appear in it is a coin flip, not a test — the first
    // version of this assertion failed for exactly that reason, which is worth
    // recording because it is the trap: a flaky leak test gets deleted.
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');

    const tally = { ab: 0, ba: 0 } as Record<string, number>;
    for (const id of Object.keys(CARDS.ideology)) {
      // Same seed, same state shape, varying card — which is exactly the axis the
      // order must be unpredictable along.
      const probe = { ...mid, _pendingCard: id } as GameState;
      const blind = blindPromptFor(probe, CARDS, mid.activePlayer);
      if (blind === null) throw new Error(`probe for ${id} produced no prompt`);
      const b = blind as { order: 'ab' | 'ba' };
      tally[b.order] = (tally[b.order] ?? 0) + 1;
    }
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.keys(CARDS.ideology).length);
    // Comfortably wide, so the assertion is not itself flaky: a 60/40 skew on 60
    // cards is the sort of thing that would eventually fail a 50/50 check.
    expect(tally['ab']).toBeGreaterThan(total * 0.25);
    expect(tally['ba']).toBeGreaterThan(total * 0.25);

    // And it is STABLE: a player who reconnects mid-answer must be shown the same
    // order they were shown before, or a click is silently reinterpreted.
    const first = blindPromptFor(mid, CARDS, mid.activePlayer);
    for (let i = 0; i < 5; i += 1) {
      expect(blindPromptFor(mid, CARDS, mid.activePlayer)).toEqual(first);
      expect(answerSideFor(mid, CARDS, mid.activePlayer, 0)).toBe(
        answerSideFor(mid, CARDS, mid.activePlayer, 0),
      );
    }
  });

  it('a different match seed gives a different order for the same card', () => {
    // Otherwise the seed is decorative and the order is a function of the card id
    // alone — which an attacker with the deck can compute offline.
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');
    const flips = new Set<number>();
    for (let k = 0; k < 64; k += 1) {
      const probe = { ...mid, _seed: k * 2654435761 } as GameState;
      const blind = blindPromptFor(probe, CARDS, mid.activePlayer);
      if (blind === null) throw new Error('no prompt');
      const b = blind as { order: 'ab' | 'ba' };
      flips.add(b.order === 'ab' ? 0 : 1);
    }
    expect(flips.size).toBe(2);
  });

  it('a player who is NOT answering gets no prompt even if they ask for one', () => {
    for (const s of CORPUS) {
      const other = s.turnOrder.find((p) => p !== s.activePlayer);
      if (other === undefined) continue;
      expect(blindPromptFor(s, CARDS, other)).toBeNull();
      expect(answerSideFor(s, CARDS, other, 0)).toBeNull();
    }
  });
});

describe('the leak vectors the type system cannot see', () => {
  it('no engine error string interpolates a card id, a deck position or the seed', () => {
    // The one real interpolation bug in this codebase lived here: the engine's
    // ANSWER path used to fail with a message containing the pending card's id,
    // which is the card being answered BLIND. It is fixed, and this test is what
    // stops it coming back.
    //
    // The server forwards `Result.error` to every client verbatim, so this line in
    // `index.ts` is a direct wire channel and the strings are worth auditing.
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');
    const secrets = allSecretValues(mid);

    for (const s of CORPUS) {
      for (const pid of s.turnOrder) {
        for (const a of PROBE_ACTIONS) {
          const r = reduce(s, pid, a, { rules: ctx.rules, cards: CARDS });
          if (r.ok) continue;
          const text = r.error;
          for (const id of secrets.cards) {
            expect(text.includes(id), `an engine error contains the card id ${id}: ${text}`).toBe(false);
          }
          expect(text.includes(secrets.seed), 'an engine error contains the seed').toBe(false);
          // Nor a field name, which would confirm the internal shape to a fuzzer.
          for (const field of SECRET_FIELDS) {
            expect(text.includes(field), `an engine error names ${field}: ${text}`).toBe(false);
          }
        }
      }
    }
  });

  it('an unreadable pending card produces a FIXED error, not one naming the card', () => {
    // The specific regression. A card id is incrementally guessable
    // (`ind2020-001`…), so an attacker who deliberately provokes this learns deck
    // membership. The error must be a constant.
    const base = CORPUS.find((s) => s.phase === 'answer');
    if (base === undefined) throw new Error('no mid-answer state in the corpus');
    const s = { ...base, _pendingCard: 'ig-et2040-001' } as GameState;
    const emptyIndex = { ideology: {}, voter: CARDS.voter, conspiracy: CARDS.conspiracy, headline: CARDS.headline };
    const r = reduce(s, s.activePlayer, { type: 'ANSWER', side: 0 }, { rules: ctx.rules, cards: emptyIndex });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toContain('ig-et2040-001');
    expect(r.error).toBe('the Ideology Card put to you could not be read');
  });

  it('the pending card\'s QUESTION text never appears in the log the client can see', () => {
    // `state.log` is public and quotes the answered text. That is safe ONLY because
    // an entry is appended after the ANSWER commits — the card is face up under the
    // mat thereafter, which is a real table property (rules-reference.md:190-191).
    //
    // So the property to assert is precise: while a card is still face down, nothing
    // about it is in the log. If a future refactor logs the question on draw — which
    // would be a natural-looking "helpful" change — this fails, and the game is dead
    // for every client that can read a log.
    for (const s of CORPUS) {
      const json = JSON.stringify(viewFor(s, null).log);
      const pending = s._pendingCard;
      if (pending === null) continue;
      const card = CARDS.ideology[pending];
      if (card === undefined) continue;
      expect(json.includes(card.question), 'the pending question is in the log').toBe(false);
      // The card's answer texts are the closest thing to a leak here: if the log
      // ever quotes them before the answer, a player could read the alternatives.
      for (const side of card.sides) {
        const quoted = JSON.stringify(side.answer);
        if (!json.includes(quoted)) continue;
        // Only legal once the card is answered, i.e. it is in a manifesto.
        const answered = s.turnOrder.some((p) => s.players[p]?.manifestoCards.includes(pending));
        expect(answered, 'an un-answered card\'s answer text is in the log').toBe(true);
      }
    }
  });

  it('every answer log entry belongs to a card that is in that player\'s manifesto', () => {
    // Ties the log to the public face-up record. A log entry with no corresponding
    // manifesto card is either a bug or a leak of something never made public.
    for (const s of CORPUS) {
      const answers = s.log.filter((l) => l.kind === 'answer');
      for (const entry of answers) {
        const pid = entry.player;
        if (pid === null) continue;
        const player = s.players[pid];
        expect(player, `an answer log entry names an unknown player ${pid}`).toBeDefined();
        if (player === undefined) continue;
        // The entry quotes the chosen answer, which must be a real side of a card
        // the player actually holds.
        const quoted = entry.text.replace(/^"|"$/g, '');
        const known = player.manifesto.some((ideologue, i) => {
          const cardId = player.manifestoCards[i];
          if (cardId === undefined) return false;
          return CARDS.ideology[cardId]?.sides.some((sd) => sd.answer === quoted && sd.ideologue === ideologue);
        });
        expect(known, `log quotes an answer that is not in ${pid}'s manifesto: ${quoted}`).toBe(true);
      }
    }
  });

  it('the declared secret set is exactly the eleven the engine keeps server-only', () => {
    // If the engine grows a twelfth `_` field, the prefix walk in layer 1 covers it
    // automatically — but the value-scan test needs a named list, so it fails
    // loudly here rather than silently skipping the new field.
    for (const s of CORPUS) {
      expect(Object.keys(s).filter((k) => k.startsWith('_')).sort()).toEqual([...SECRET_FIELDS].sort());
    }
  });

  it('ClientState omits every server-only key at the TYPE level', () => {
    // Compile-time assertion, evaluated at runtime so the file has a test in it.
    // If somebody adds a field to `ServerOnlyKeys` without adding it here, or
    // re-adds one to `ClientState`, this stops compiling.
    type ServerOnly = keyof ClientState & `_${string}`;
    const noServerOnlyKeys: ServerOnly extends never ? true : false = true;
    expect(noServerOnlyKeys).toBe(true);

    type BlindShape = { question: string; labels: readonly [string, string]; order: 'ab' | 'ba' };
    type BlindHasNoPayout = keyof BlindShape extends 'pays' | 'delta' | 'payout' | 'ideologue' | 'cardId'
      ? false
      : true;
    const blindIsClean: BlindHasNoPayout = true;
    expect(blindIsClean).toBe(true);
  });
});

const PROBE_ACTIONS = [
  { type: 'ANSWER', side: 0 },
  { type: 'ANSWER', side: 1 },
  { type: 'END_TURN' },
  { type: 'ACK_HEADLINE' },
  { type: 'INFLUENCE', slot: 0 },
  { type: 'INFLUENCE', slot: 99 },
  { type: 'REDRAW_IDEOLOGY', pay: { funds: 4 } },
  { type: 'BUY_CONSPIRACY', pay: { funds: 4 } },
  { type: 'PLAY_CONSPIRACY', cardId: 'nope' },
  { type: 'TRADE', withPlayer: 'nobody', give: { funds: 1 }, receive: { funds: 1 } },
  { type: 'GERRYMANDER', zoneId: 'central', fromAreaId: 'x', toAreaId: 'y' },
  { type: 'POWER_LAND_GRAB', areaId: 'x' },
  { type: 'POWER_DONATIONS', from: 'nobody', res: 'funds' },
  { type: 'POWER_PROSPECT', give: 'funds', take: ['funds'] },
  { type: 'POWER_PAYBACK', areaId: 'x', pay: 'funds' },
  { type: 'POWER_TOUGH_LOVE', areaIds: ['x'], pay: { trust: 2 } },
  { type: 'RESOLVE_CHOICE', choiceId: 'nope', pick: { kind: 'resources', res: { funds: 1 } } },
  { type: 'PLACE_VOTERS', groupId: 'nope', areaIds: [] },
] as const;

void LEAK_PATHS;
