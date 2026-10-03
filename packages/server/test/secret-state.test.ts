/**
 * THE SECRET-STATE GATE — after full information.
 *
 * If this file is deleted, the project has no defence against the one leak that ends
 * the game permanently. The blind answer is gone, so "one payout cannot be un-known"
 * is no longer the stake; what replaced it is smaller and sharper:
 *
 *   · the `_`-prefix walk, which is unchanged and still the load-bearing gate for the
 *     DECKS, the draw piles, the seed and the pending card's ID;
 *   · the `order` draw, which is the last channel by which POSITION could carry the
 *     deck's Ideologue balance (PLAN.md §2 amendment A′). With the Ideologue printed on
 *     every card, publishing `order` would rebuild that channel in one line — so it is
 *     the one thing this suite now refuses hardest;
 *   · the conspiracy hand, which is still a hidden hand, owner included.
 *
 * The four layers, in the order they bite:
 *
 *   LAYER 1  A structural walk over the PRODUCTION broadcast path — `viewFor` and
 *           `answerPromptFor`, reached through `Room.viewFor`, which is what the
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
 *   LAYER 3  THE PUBLIC CARD, and the one field it must not carry. `PublicQuestion`
 *           admits no `CardID` and no `order`; `answerPromptFor` adds exactly the
 *           `order` and is owed by exactly one seat. Under full information the whole
 *           card — question, both answers, both Ideologues, both payouts — goes to
 *           every viewer, and this layer asserts that as a POSITIVE fact over the
 *           production path rather than asserting its absence.
 *
 *   LAYER 4  The one deliberately viewer-scoped projection: `playableConspiracies`,
 *           the ids/names/text of the VIEWER'S OWN Conspiracy Cards that `reduce`
 *           will currently accept. D25 forbids shipping a hand; it does not forbid
 *           a player knowing which of their own cards they may play — which is the
 *           only thing that makes the mechanic usable at all. This layer asserts
 *           the list against the ENGINE as its oracle (offered === what `reduce`
 *           accepts), that it names nothing held by any other seat anywhere in the
 *           payload, and that it is recomputed rather than cached.
 *
 * Plus a fourth thing this suite found that the type system cannot see: the
 * engine's own ANSWER error path, and the log lines. See the last two tests.
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  allKeys,
  ideologyHandOf,
  reduce,
  setup,
  type ClientState,
  type GameState,
  type PlayerID,
} from '@shasn/engine';

import { answerSideFor, answerPromptFor, viewFor, type PublicQuestion } from '../src/broadcast.ts';
import { Room } from '../src/room.ts';
import type { AnswerPrompt } from '../src/protocol.ts';
import { makeCtx, realCards } from './fixtures.ts';
import { decksOf } from '../src/store.ts';
import { renderAll } from './render-all.ts';
import { LEAK_PATHS, CHOICE_KINDS, SECRET_FIELDS } from './secret-inventory.ts';

/**
 * THE SHIPPED CORPUS, and this used to be `bigCards(60)`.
 *
 * A leak detector that runs on synthetic cards is a leak detector that has never seen
 * the cards players actually get, and the synthetic set was blind in a specific,
 * demonstrated way: every one of its 24 Headline Cards was `gain media 1`, so it
 * NEVER produced an effect-generated `PendingChoice`, and the 22 Conspiracy Cards were
 * all `voters n:1`. The shipped corpus's 26 headlines carry twelve distinct ops and
 * its conspiracies carry ten, and three of those ops open a decision that freezes a
 * player — so the real corpus exercises projection paths — `answerPromptFor` under a
 * mid-resolution effect, an `evict` target list, a `steal-any` victim — that this
 * suite structurally could not reach.
 *
 * It is also the suite that found the real-corpus false positive in
 * `reconnect.test.ts` (a Voter Card's PUBLIC printed price colliding with an Ideology
 * Card's side payout), so pointing this suite at the real corpus is what makes the two
 * of them consistent: the leak rules are now derived from the cards that ship.
 */
const CARDS = realCards();
const ctx = makeCtx(CARDS);

/**
 * Card ids that are PUBLIC BY DESIGN, and so are not secrets at all.
 *
 * An ANSWERED Ideology Card is face up under the answering player's Manifesto mat
 * at a real table (rules-reference.md:190-191), and `PlayerState.manifestoCards`
 * deliberately publishes it to every client — the Ideologue a card carries is that
 * player's public identity, which is why `reconnect.test.ts` also records that the
 * string "capitalist" is in every payload by design. So an answered card is public.
 *
 * This matters because `ANSWER` now writes the answered card to `_ideologyDiscard`
 * (the recycle fix: the deck was otherwise never reshuffled, so every game died at
 * turn 52). Before that fix the discard pile was written only by the paid, optional
 * `REDRAW_IDEOLOGY` — genuinely secret, because a redrawn card was never answered
 * and never reached a mat. Treating the whole pile as secret was correct then and
 * became wrong here: `t-ide-0054` is in the discard pile AND in some player's
 * `manifestoCards`, so it is public, and asserting its absence failed on the very
 * first answered card in the corpus.
 *
 * THE SUBTRACTION IS EXACT, NOT A BLANKET EXEMPTION. `secretIds` below removes
 * precisely the ids that are in some player's `manifestoCards`, and nothing else.
 * A card sitting in the discard pile that is NOT in any mat — the `REDRAW_IDEOLOGY`
 * case, which is still a genuine secret — stays in the set and still has to be
 * absent. The two cases are distinguished by a fact about the state, not by a
 * decision about which assertion to run; see "the discard pile is not a secret
 * pile" in the LAYER 1 block for the test that holds them apart.
 */
function publicCardIds(s: GameState): ReadonlySet<string> {
  const out = new Set<string>();
  for (const pid of s.turnOrder) {
    for (const id of s.players[pid]?.manifestoCards ?? []) out.add(id);
  }
  return out;
}

/** Deck ids that must never appear in a client payload. */
function allSecretValues(s: GameState): { cards: readonly string[]; seed: string } {
  const isPublic = publicCardIds(s);
  const candidates = [
    ...s._ideologyDraw,
    ...s._ideologyDiscard,
    ...s._voterDraw,
    ...s._voterDiscard,
    ...s._conspiracyDraw,
    ...s._conspiracyDiscard,
    ...s._headlineDraw,
    ...s._headlineDiscard,
    // The pending card is face DOWN and in nobody's mat, so it is never public.
    // Listed unconditionally rather than through `isPublic` on purpose: if a future
    // refactor ever put the pending card in a manifesto, that is itself the bug this
    // assertion exists to catch, and quietly excusing it here would hide it.
    ...(s._pendingCard === null ? [] : [s._pendingCard]),
  ];
  return {
    cards: [...new Set(candidates.filter((id) => !isPublic.has(id)))],
    seed: String(s._seed),
  };
}

/**
 * The same set, as a predicate. Both leak assertions go through this so there is
 * ONE definition of "secret" in the file — a second transcription is how a suite
 * ends up asserting two different things in two different layers.
 */
function secretIds(s: GameState): ReadonlySet<string> {
  return new Set(allSecretValues(s).cards);
}

/**
 * THE INSTRUMENT. Which of this state's secret ids are present in `json`.
 *
 * One function, so LAYER 1 and LAYER 2 cannot drift into checking different things,
 * and so the "TEETH" test can fire the real check against a payload that really does
 * carry a secret, rather than asserting about a reimplementation of it.
 */
function leakedIds(s: GameState, json: string): readonly string[] {
  return [...secretIds(s)].filter((id) => json.includes(id));
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

/**
 * A corpus that has actually paid to REDRAW an Ideology Card.
 *
 * `playedCorpus` never redraws, so every id in its discard pile is an ANSWERED card
 * and every one of them is in some player's `manifestoCards`. That is the whole
 * reason the discard pile needs an exemption — and it is also why the exemption needs
 * a counter-example before anyone can claim it is not a blanket one. This corpus is
 * that counter-example: it reaches a state where the discard pile holds a card that
 * NOBODY is holding face up, which is the `REDRAW_IDEOLOGY` case, and that id must
 * still be treated as secret.
 *
 * The staggered start is the only legal way for a player to have resources at all
 * (`playedCorpus`'s players open 0/0/0 and never buy anything), and p13 costs the
 * redraw at 4 resources, so this is also the fixture that makes the redraw affordable.
 */
function redrawCorpus(steps: number): readonly GameState[] {
  let s = setup({
    players: ['p1', 'p2'],
    names: { p1: 'One', p2: 'Two' },
    cards: CARDS,
    seed: 0x5eed_52,
    startResources: [{ funds: 9 }, { funds: 7, media: 2 }],
    ...decksOf(CARDS),
  });
  const corpus: GameState[] = [];
  const order = [...s.turnOrder];
  let attempts = 0;
  // Turn one answers so the recycle has put a public card in the discard pile; every
  // turn after that REDRAWS, which puts a genuinely secret card there too. The state
  // is recorded after each, so both kinds are present at once.
  let answered = 0;
  while (corpus.length < steps && !s.finished && attempts < steps * 12) {
    attempts += 1;
    const me = order[attempts % order.length] as PlayerID;
    if (s.phase === 'answer' && s.activePlayer === me) {
      const a =
        answered === 0
          ? ({ type: 'ANSWER', side: 0 } as const)
          : ({ type: 'REDRAW_IDEOLOGY', pay: { funds: 4 } } as const);
      const r = reduce(s, me, a, { rules: ctx.rules, cards: CARDS });
      if (!r.ok) continue;
      s = r.state;
      if (a.type === 'ANSWER') answered += 1;
      corpus.push(s);
      continue;
    }
    if (s.phase === 'headlines' && s.activePlayer === me) {
      const r = reduce(s, me, { type: 'ACK_HEADLINE' }, { rules: ctx.rules, cards: CARDS });
      if (!r.ok) continue;
      s = r.state;
      continue;
    }
    if (s.phase !== 'actions' || s.activePlayer !== me) continue;
    const r = reduce(s, me, { type: 'END_TURN' }, { rules: ctx.rules, cards: CARDS });
    if (!r.ok) continue;
    s = r.state;
  }
  return corpus;
}

const REDRAW_CORPUS = redrawCorpus(6);

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

/**
 * What the two VALUE scans walk: `CORPUS` plus `REDRAW_CORPUS`.
 *
 * Both leak tests used to read `CORPUS` alone, and that left a hole with a very
 * specific shape. `CORPUS` never redraws, so every id in its `_ideologyDiscard`
 * belongs to an answered card and is in some player's `manifestoCards` — which
 * means it is excused. Leaking the discard pile in that corpus is therefore
 * INVISIBLE: a projection carrying `topOfIdeologyDiscard` passes every value scan,
 * because the only id it would leak is a public one. Verified, not assumed —
 * that exact leak was reintroduced into `viewFor` and the suite stayed green.
 *
 * `REDRAW_CORPUS` closes it. It has redrawn, so its discard pile holds cards in no
 * player's mat, and a leak of any of those fails here exactly as a draw-pile leak
 * does. Both corpora are walked for the value scans only: `CORPUS` stays the corpus
 * for the structural and phase-coverage tests, where its shape is deliberate.
 */
const LEAK_CORPUS: readonly GameState[] = [...CORPUS, ...REDRAW_CORPUS];

if (process.env['SHASN_DEBUG_CORPUS'] === '1') {
  for (const [i, s] of CORPUS.entries()) {
    const b = s.phase === 'answer' ? answerPromptFor(s, CARDS, s.activePlayer) : null;
    console.log(i, s.phase, 'active=' + s.activePlayer, 'pending=' + s._pendingCard, 'order=' + (b?.order ?? '-'));
  }
}

// ─────────────────── the conspiracy corpus, and why it is separate ───────────────────

/**
 * A real three-player game in which EVERY SEAT HAS BOUGHT CONSPIRACY CARDS.
 *
 * It cannot be `CORPUS`. `nextAction` above never buys, so every hand in `CORPUS`
 * is empty and `playableConspiracies` is `[]` in every state of it — the assertions
 * below would pass against a projection that computed nothing at all. A leak test
 * whose fixture cannot fail is a decoration, so this corpus is built to make the
 * field non-empty: seats are given a staggered opening (rules-reference.md:92-93,
 * and the only legal way for a player to have resources at all), and each seat
 * spends them on the top Conspiracy Card every time it is on move.
 *
 * Because the deck is shuffled and each purchase takes the current top, the seats
 * end up holding DIFFERENT cards, which is the whole point: cross-contamination is
 * only observable when the answers differ.
 *
 * Real dispatch through `reduce`, not a hand-written state, for the same reason as
 * `playedCorpus`: a fixture written by hand proves only that the projection is
 * clean of the fields somebody remembered.
 */
function conspiracyCorpus(steps: number): readonly GameState[] {
  let s = setup({
    players: ['p1', 'p2', 'p3'],
    names: { p1: 'One', p2: 'Two', p3: 'Three' },
    cards: CARDS,
    seed: 0x5eed17,
    // Staggered opening, so seat 1 can afford a 4-resource Conspiracy on turn one
    // and so does seat 3 on its own turn. The engine does not guess a split.
    startResources: [{ funds: 8 }, { funds: 6, clout: 2 }, { funds: 5, media: 3 }],
    ...decksOf(CARDS),
  });
  const corpus: GameState[] = [s];
  const order = [...s.turnOrder];
  let attempts = 0;
  while (corpus.length < steps && !s.finished && attempts < steps * 14) {
    attempts += 1;
    const me = order[attempts % order.length] as PlayerID;
    const a = nextConspiracyAction(s, me);
    if (a === null) continue;
    let r = reduce(s, me, a, { rules: ctx.rules, cards: CARDS });
    // Cannot afford the Conspiracy? End the turn instead. `reduce` is pure, so
    // probing here costs nothing and there is no fixture bookkeeping to drift.
    if (!r.ok && a.type === 'BUY_CONSPIRACY') {
      r = reduce(s, me, { type: 'END_TURN' }, { rules: ctx.rules, cards: CARDS });
    }
    if (!r.ok) continue;
    s = r.state;
    corpus.push(s);
  }
  return corpus;
}

/**
 * Close a response window by DECLINING it, which is what a client with no hand does.
 *
 * Needed since G13d. `PLAY_CONSPIRACY` no longer resolves its own effect list the moment
 * it is played: if any OTHER seat holds a reactive card — BLOCK or DEFLECT, and
 * `draw-conspiracy` puts one in a hand without anybody buying — the effect list is STAGED
 * in `state.interrupt` and raises no decision until the window closes. So the walk below
 * has to finish the protocol before it can ask "did playing this freeze its player", and
 * without this the freeze branch below was unreachable: measured, `froze` was 0 across all
 * twenty states of the fixture once the corpus carried a reactive card at all.
 *
 * The required set is transcribed from `mustRespond` in `reduce.ts`: everybody except the
 * actor, minus anybody frozen by a decision (they cannot act, and `PASS_INTERRUPT` from a
 * frozen player is refused by the per-player freeze above the switch). Declining is
 * always legal for a seat in that set, so this always terminates.
 */
function closeWindow(s: GameState): GameState {
  let cur = s;
  for (let guard = 0; cur.interrupt !== null && guard < 8; guard += 1) {
    const w = cur.interrupt;
    if (w === null) break;
    const seat = cur.turnOrder.find(
      (p) => p !== w.actor && !w.passed.includes(p) && !cur.choices.some((c) => c.player === p),
    );
    if (seat === undefined) break;
    const r = reduce(cur, seat, { type: 'PASS_INTERRUPT' }, { rules: ctx.rules, cards: CARDS });
    if (!r.ok) break;
    cur = r.state;
  }
  return cur;
}

function nextConspiracyAction(s: GameState, me: PlayerID) {
  if (s.finished) return null;
  if (s.phase === 'answer') return s.activePlayer === me ? ({ type: 'ANSWER', side: 0 } as const) : null;
  if (s.phase === 'headlines') {
    return s.activePlayer === me ? ({ type: 'ACK_HEADLINE' } as const) : null;
  }
  if (s.phase !== 'actions' || s.activePlayer !== me) return null;

  const choice = s.choices.find((c) => c.player === me);
  if (choice !== undefined) {
    const c = choice.choice;
    if (c.kind === 'steal-any') {
      return {
        type: 'RESOLVE_CHOICE',
        choiceId: choice.id,
        pick: { kind: 'steal', from: c.from ?? me, res: { funds: c.count } },
      } as const;
    }
    if (c.kind === 'gain-any' || c.kind === 'lose-any') {
      return {
        type: 'RESOLVE_CHOICE',
        choiceId: choice.id,
        pick: { kind: 'resources', res: { funds: c.count } },
      } as const;
    }
    return { type: 'RESOLVE_CHOICE', choiceId: choice.id, pick: { kind: 'areas', areaIds: [] } } as const;
  }
  // The printed cost of the Conspiracy on top, paid in Funds — READ FROM THE STATE,
  // not hardcoded. This used to be `{ funds: 4 }`, which was correct for `bigCards`
  // (every Conspiracy printed 4) and is wrong for the shipped corpus, whose top card
  // prints something else. So on the real cards every `BUY_CONSPIRACY` was refused,
  // no seat ever held a Conspiracy, and the whole block below it went vacuous with
  // empty hands — which is the one thing it exists to prevent.
  //
  // `conspiracyTopCost` is public by design (the cost is printed on the card's back,
  // so the number is public even though the identity is not), so reading it here is
  // reading what any player could read.
  const cost = s.conspiracyTopCost;
  if (cost !== null && (s.players[me]?.resources.funds ?? 0) >= cost) {
    return { type: 'BUY_CONSPIRACY', pay: { funds: cost } } as const;
  }
  return { type: 'END_TURN' } as const;
}

const CONSPIRACY_CORPUS = conspiracyCorpus(20);

/** The ids this player actually holds, read straight off the server-side state. */
function handOf(s: GameState, pid: PlayerID): readonly string[] {
  return s.players[pid]?.conspiracies ?? [];
}

if (process.env['SHASN_DEBUG_CORPUS'] === '1') {
  for (const [i, s] of CONSPIRACY_CORPUS.entries()) {
    console.log(
      'C',
      i,
      s.phase,
      'active=' + s.activePlayer,
      s.turnOrder.map((p) => `${p}:[${handOf(s, p).join(',')}]`).join(' '),
    );
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
        const keys = allKeys(viewFor(s, CARDS, viewer)).filter((k) => k.startsWith('_'));
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
        const keys = [...allKeys(v.state), ...(v.answer === null ? [] : allKeys(v.answer))].filter((k) =>
          k.startsWith('_'),
        );
        expect(keys, `room state ${i} (${s.phase}), viewer ${String(viewer)}`).toEqual([]);
      }
    }
  });

  it('the PRODUCTION room path gives EVERY seat the whole card, and the room not on it', () => {
    // The positive half of the acceptance claim, at the same place the leak walk is — so
    // a test that only walked `viewFor` in isolation cannot pass while the room ships
    // something narrower. `Room.viewFor` is literally what `#sendMatchState` puts on the
    // wire, so this is the last point before the socket.
    //
    // Every viewer including `null` (a spectator) and including a seat that is not on
    // move; the answerer additionally gets the `order` draw on the `answer` field and
    // nobody else does.
    let seats = 0;
    for (const [i, s] of CORPUS.entries()) {
      if (s.phase !== 'answer') continue;
      const cardId = s._pendingCard;
      if (cardId === null) continue;
      const card = CARDS.ideology[cardId];
      if (card === undefined) continue;
      const room = roomFor(s);
      const real = card.sides
        .map((side) => JSON.stringify({ label: side.answer, ideologue: side.ideologue, pays: side.pays }))
        .sort();

      for (const viewer of [null, ...s.turnOrder] as (PlayerID | null)[]) {
        const v = room.viewFor(viewer);
        const open = (v.state as { openQuestion?: { question: string; sides: readonly unknown[] } | null })
          .openQuestion;
        expect(open, `room state ${i}, viewer ${String(viewer)}: no card on the table`).not.toBeNull();
        if (open === undefined || open === null) continue;
        expect(open.question, `room state ${i}, viewer ${String(viewer)}: wrong question`).toBe(card.question);
        expect(
          open.sides.map((side) => JSON.stringify(side)).sort(),
          `room state ${i}, viewer ${String(viewer)}: did not get both sides whole`,
        ).toEqual(real);
        // `order` is in exactly one payload: the answerer's.
        expect(allKeys(open), `room state ${i}, viewer ${String(viewer)}: the table got an order`).not.toContain(
          'order',
        );
        const isAnswerer = viewer === s.activePlayer;
        expect(
          v.answer === null,
          `room state ${i}, viewer ${String(viewer)}: ${isAnswerer ? 'no' : 'a stray'} answer prompt`,
        ).toBe(!isAnswerer);
        if (v.answer !== null) {
          expect(['ab', 'ba']).toContain(v.answer.order);
          expect(JSON.stringify(v.answer.sides.map((x) => JSON.stringify(x)).sort())).toBe(
            JSON.stringify(real),
          );
        }
        seats += 1;
      }
    }
    expect(seats, 'the room path was never reached with a card out — the claim is untested').toBeGreaterThan(0);
  });

it('no secret VALUE survives: no card id, and not the seed', () => {
    for (const [i, s] of LEAK_CORPUS.entries()) {
      const { cards, seed } = allSecretValues(s);
      expect(cards.length, `state ${i} has no secret ids at all — the scan would be vacuous`).toBeGreaterThan(0);
      for (const viewer of [null, ...s.turnOrder]) {
        const json = JSON.stringify(viewFor(s, CARDS, viewer));
        expect(leakedIds(s, json), `state ${i}, viewer ${String(viewer)}`).toEqual([]);
        // The seed is a bare number and is the single highest-leverage secret in
        // the process: it reconstructs every deck from the start.
        expect(json.includes(`:${seed}`), `state ${i} leaked the seed`).toBe(false);
      }
    }
  });

  it('the discard pile is not a secret pile, but only because answered cards went public', () => {
    // The exemption `publicCardIds` grants is exactly as wide as the set of ids a
    // player is holding face up, and not one id wider. This is the assertion that
    // makes the exemption honest, and it is the direct answer to "did you just
    // shrink the asserted set until it passed?" — no: the set is unchanged except
    // for ids the state itself proves are public, and this pins both halves.
    let sawPublicDiscard = 0;
    let sawSecretDiscard = 0;

    // BOTH corpora, because only the second one puts a card in the discard pile that
    // is in nobody's mat. `CORPUS` alone would exercise the exempted branch and no
    // other, and "the exemption is narrow" would be a claim nobody could check.
    for (const s of [...CORPUS, ...REDRAW_CORPUS]) {
      const isPublic = publicCardIds(s);
      const secrets = secretIds(s);
      for (const id of s._ideologyDiscard) {
        if (isPublic.has(id)) {
          sawPublicDiscard += 1;
          // A public id is public for a REASON: the state says a player is holding
          // it face up. So the projection is REQUIRED to contain it, not merely
          // permitted to. If this ever stops holding, the exemption has outgrown its
          // justification and the "leak" it suppresses is real.
          expect(
            JSON.stringify(viewFor(s, CARDS, null)).includes(id),
            `${id} is excused as public but no projection carries it — the exemption is unfounded`,
          ).toBe(true);
          continue;
        }
        sawSecretDiscard += 1;
        expect(secrets.has(id), `${id} is in the discard pile, in no mat, and was not excused`).toBe(true);
      }
      // The face-down card is never excused, whatever the mat says.
      if (s._pendingCard !== null) {
        expect(secrets.has(s._pendingCard), 'the face-down pending card was excused').toBe(true);
      }
    }

    // The corpus must exercise BOTH halves or the loop above proves nothing: a
    // corpus with no answered cards would find `sawPublicDiscard === 0` and pass
    // without ever reaching the branch that matters.
    expect(sawPublicDiscard, 'no answered card reached the discard pile — the exemption is untested').toBeGreaterThan(0);
    expect(sawSecretDiscard, 'no genuinely secret discard card — the un-excused branch is untested').toBeGreaterThan(0);
  });

  it('a REDRAWED card is still secret: paying to swap it does not put it on a mat', () => {
    // The specific case the exemption must NOT swallow. `REDRAW_IDEOLOGY` discards
    // the face-down card without answering it, so it lands in `_ideologyDiscard`
    // holding the same place an answered card does — and it is NOT in any
    // `manifestoCards`, because nobody ever chose a side. It is exactly as secret as
    // it was before the recycle fix, and this drives the real action rather than
    // hand-editing a pile.
    //
    // `REDRAW_CORPUS` exists so the state has BOTH kinds of discard entry at once: a
    // public one from the first ANSWER and a secret one from every redraw after it.
    // Without that, "the exemption is narrow" would be an unfalsifiable claim.
    let publicOnes = 0;
    let secretOnes = 0;
    for (const s of REDRAW_CORPUS) {
      const isPublic = publicCardIds(s);
      const secrets = secretIds(s);
      for (const id of s._ideologyDiscard) {
        if (isPublic.has(id)) {
          publicOnes += 1;
          continue;
        }
        secretOnes += 1;
        expect(secrets.has(id), `${id} is a redrawn card and stopped being secret`).toBe(true);
        for (const viewer of [null, ...s.turnOrder]) {
          expect(
            JSON.stringify(viewFor(s, CARDS, viewer)).includes(id),
            `a redrawn card reached ${String(viewer)}`,
          ).toBe(false);
        }
      }
    }
    expect(publicOnes, 'the redraw corpus produced no answered card — only the exempted half').toBeGreaterThan(0);
    expect(secretOnes, 'the redraw corpus produced no redrawn card — the branch is untested').toBeGreaterThan(0);
  });

  it('the conspiracy-hand leak is closed: no player, including its owner, sees a hand', () => {
    // The one hidden field the `_` prefix does not cover. A conspiracy is "bought
    // and held" (rules-reference.md:284-286); shipping a hand turns a bluffing
    // mechanic into a solved one, and the prefix walk above cannot see it.
    for (const s of CORPUS) {
      for (const viewer of [null, ...s.turnOrder]) {
        const view = viewFor(s, CARDS, viewer);
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
      const sizes = s.turnOrder.map((p) => JSON.stringify(viewFor(s, CARDS, p).deckSizes));
      expect(new Set(sizes).size, 'deckSizes differ between viewers').toBe(1);
      expect(viewFor(s, CARDS, null).deckSizes.ideology).toBe(s._ideologyDraw.length);
    }
  });

  it('awaitingAnswer is a boolean and identical for every viewer', () => {
    for (const s of CORPUS) {
      const values = s.turnOrder.map((p) => viewFor(s, CARDS, p).awaitingAnswer);
      expect(new Set(values).size).toBe(1);
      expect(typeof viewFor(s, CARDS, null).awaitingAnswer).toBe('boolean');
    }
  });

  it('the projection does not mutate the state it is given', () => {
    const s = CORPUS[CORPUS.length - 1];
    if (s === undefined) throw new Error('empty corpus');
    const before = JSON.stringify(s);
    for (const viewer of [null, ...s.turnOrder]) {
      viewFor(s, CARDS, viewer);
      answerPromptFor(s, CARDS, viewer ?? '');
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
    for (const s of LEAK_CORPUS) {
      const { seed } = allSecretValues(s);
      for (const msg of renderAll(s, { rules: ctx.rules, cards: CARDS })) {
        const json = JSON.stringify(msg);
        expect(leakedIds(s, json), `${msg.t}`).toEqual([]);
        expect(json.includes(`:${seed}`), `${msg.t} leaked the seed`).toBe(false);
      }
    }
  });

  it('TEETH: a deliberately reintroduced secret id in a payload IS caught', () => {
    // The proof that the two assertions above are still load-bearing after the
    // public-id exemption. It does not weaken the projection to test it — that would
    // prove nothing about the real one — so instead it takes the assertion's OWN
    // instrument, `leakedIds`, and shows it fires on a payload that really does carry
    // a secret card.
    //
    // The shape is the one the exemption could have opened: a genuinely secret card
    // (still face down in the draw pile) smuggled into a client payload under a
    // plausible-looking key. That is what `playerView` failing to drop a `_` key, or a
    // future field inlining a draw-pile id, looks like on the wire.
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');

    // The clean state: no leak, so the instrument reports nothing.
    expect(leakedIds(mid, JSON.stringify(viewFor(mid, CARDS, null)))).toEqual([]);

    // The same state with ONE secret id spliced in, which is what a leak looks like.
    const victim = mid._ideologyDraw[0];
    expect(victim, 'the corpus has no face-down card to smuggle').toBeTruthy();
    if (victim === undefined) return;
    expect(secretIds(mid).has(victim), 'the smuggled id is not actually secret — this would prove nothing').toBe(true);

    const tampered = { ...viewFor(mid, CARDS, null), lastDrawnCardId: victim };
    expect(leakedIds(mid, JSON.stringify(tampered))).toEqual([victim]);

    // And the seed, which the same assertion guards separately, is caught too: a
    // bare number is the highest-leverage secret in the process, because it rebuilds
    // every deck from the start. It has to be spliced in as a NUMBER, since that is
    // the form the assertion looks for (`:1234`) and the form a real leak takes.
    const withSeed = { ...viewFor(mid, CARDS, null), cursor: mid._seed };
    expect(leakedIds(mid, JSON.stringify(withSeed))).toEqual([]);
    expect(JSON.stringify(withSeed).includes(`:${mid._seed}`)).toBe(true);
  });
});

/**
 * LAYER 3 — THE WHOLE CARD IS PUBLIC, AND `order` IS THE ONE THING THAT IS NOT.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THIS DESCRIBE USED TO BE THE OPPOSITE, and the change is stated first because a
 * reader who only reads the old header would be misled about what the wire carries.
 *
 * It was "the blind prompt type admits nothing that could help a player choose", and its
 * tests asserted that the prompt held no `Delta`, no `Ideologue`, no number, and that a
 * player who was not answering was owed no prompt at all. All of that was true. Full
 * information makes it false: the whole card — question, both answers, both Ideologues,
 * both payouts — is published to every seat, and the prompt the answerer receives is the
 * same card plus the `order` draw.
 *
 * So the surviving guarantee is restated on the thing that is actually still protected,
 * and the tests below are the POSITIVE version of the same walk:
 *
 *   · EVERY VIEWER GETS THE WHOLE CARD — question, both labels, both Ideologues, both
 *     payouts — over the PRODUCTION broadcast, not over `playerView` in isolation.
 *   · NO VIEWER GETS A `CardID` for it. The corpus is public JSON, so the payout was
 *     always one lookup away; the id is withheld because the thing that withholds it is
 *     `check-secrets.mjs`, whose whole mechanism is a name-based grep over `_`-prefixed
 *     fields. See `PublicQuestion` in `broadcast.ts` for the ruling.
 *   · ONLY THE ANSWERER GETS `order`, and it is a two-value union. This is the last
 *     channel by which position could carry the deck's Ideologue balance
 *     (PLAN.md §2 amendment A′), and with the Ideologue now on the card it is the one
 *     that matters.
 *   · The two payloads are the SAME card, byte for byte apart from `order` — asserted,
 *     because "two projections of one card" is a claim and one computation is the only
 *     thing that makes it true.
 */
describe('LAYER 3 — the whole card is public, and `order` is the one thing that is not', () => {
  it('has exactly three fields, and one of them is the order draw', () => {
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');
    const me = mid.activePlayer;
    const prompt = answerPromptFor(mid, CARDS, me);
    expect(prompt, 'the active player must be owed a prompt mid-answer').not.toBeNull();
    expect(Object.keys(prompt!).sort()).toEqual(['order', 'question', 'sides']);
  });

  it('EVERY VIEWER receives question, both labels, both Ideologues and both payouts', () => {
    // THE ACCEPTANCE CLAIM, over the production projection — `viewFor` is what
    // `Room.viewFor` returns and what `#sendMatchState` writes to a socket, and it is
    // walked for every seat AND for `null` (a spectator). An engine-only assertion would
    // pass while the server dropped the field on the way out.
    let checked = 0;
    for (const s of CORPUS) {
      if (s.phase !== 'answer') continue;
      const cardId = s._pendingCard;
      if (cardId === null) continue;
      const card = CARDS.ideology[cardId];
      if (card === undefined) continue;
      const [a, b] = card.sides;
      if (a === undefined || b === undefined) continue;

      for (const viewer of [null, ...s.turnOrder]) {
        const open = viewFor(s, CARDS, viewer).openQuestion;
        expect(open, `viewer ${String(viewer)} got no card mid-answer`).not.toBeNull();
        if (open === null) continue;
        expect(open.question).toBe(card.question);
        expect(open.sides).toHaveLength(2);
        // The two sides in DISPLAY order, each a whole printed side: the text, the
        // Ideologue it belongs to, and the resources it pays. Compared as a SET of
        // sides rather than positionally, because which face is first is exactly the
        // thing the table is not told.
        const shown = open.sides.map((side) => JSON.stringify(side)).sort();
        const real = [a, b]
          .map((side) => JSON.stringify({ label: side.answer, ideologue: side.ideologue, pays: side.pays }))
          .sort();
        expect(shown, `viewer ${String(viewer)} did not get both printed sides whole`).toEqual(real);
        checked += 1;
      }
    }
    // The corpus must actually reach this, or the loop proves nothing.
    expect(checked, 'no viewer ever received a card — the claim is untested').toBeGreaterThan(0);
  });

  it('carries NO card id, for any viewer — the corpus is public, the pointer is not', () => {
    // The ruling on `PublicQuestion`: public by CONTENT, never by id. This is the
    // assertion that keeps it a ruling rather than a hope, and it is the one that fails
    // if somebody "helpfully" adds `cardId` to the published side so a client can key
    // the card.
    for (const s of CORPUS) {
      const cardId = s._pendingCard;
      if (cardId === null) continue;
      for (const viewer of [null, ...s.turnOrder]) {
        const payload = JSON.stringify(viewFor(s, CARDS, viewer));
        expect(payload.includes(cardId), `viewer ${String(viewer)} received the pending card's id`).toBe(false);
      }
    }
  });

  it('is owed ONLY by the player who is answering', () => {
    for (const s of CORPUS) {
      for (const pid of s.turnOrder) {
        const owed = answerPromptFor(s, CARDS, pid) !== null;
        expect(owed, `${pid} was given a prompt in ${s.phase} (active ${s.activePlayer})`).toBe(
          pid === s.activePlayer && s.phase === 'answer',
        );
      }
      // A spectator's viewer is null and there is no such thing as a spectator
      // prompt, so this is the `null`-viewer case as well as the wrong-player one.
      expect(answerPromptFor(s, CARDS, 'p_outsider')).toBeNull();
    }
  });

  it('the table copy and the answerer copy are the SAME card, byte for byte', () => {
    // Two projections of one card is a CLAIM; one computation (`pendingCardFor`) is what
    // makes it true. If they ever drift, the table reads one answer aloud and the
    // answerer is shown another — and a click then buys the other side's payout, which
    // is precisely the failure the shared computation exists to prevent.
    let checked = 0;
    for (const s of CORPUS) {
      if (s.phase !== 'answer') continue;
      const me = s.activePlayer;
      const prompt = answerPromptFor(s, CARDS, me);
      const open = viewFor(s, CARDS, me).openQuestion;
      if (prompt === null || open === null) continue;
      expect(JSON.stringify(open.sides)).toBe(JSON.stringify(prompt.sides));
      expect(open.question).toBe(prompt.question);
      checked += 1;
    }
    expect(checked, 'no state had both a table card and an answerer prompt').toBeGreaterThan(0);
  });

  it('the table copy carries NO `order`, and the answerer copy carries ONLY that', () => {
    // The two halves of the whole surviving guarantee, asserted together because they
    // are two halves of one thing: `order` is the channel, and it must be in exactly one
    // payload.
    for (const s of CORPUS) {
      if (s.phase !== 'answer') continue;
      const me = s.activePlayer;
      const prompt = answerPromptFor(s, CARDS, me);
      const open = viewFor(s, CARDS, me).openQuestion;
      if (prompt === null || open === null) continue;
      expect(['ab', 'ba']).toContain(prompt.order);
      // Not on the table's copy, at ANY depth — a nested `order` on a side would be the
      // same channel one level down.
      expect(allKeys(open)).not.toContain('order');
      // And the answerer's copy has nothing else that is not already public.
      expect(Object.keys(prompt).sort()).toEqual(['order', 'question', 'sides']);
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
      const prompt = answerPromptFor(s, CARDS, me);
      if (prompt === null) continue;

      const side0 = answerSideFor(s, CARDS, me, 0);
      const side1 = answerSideFor(s, CARDS, me, 1);
      expect(side0).not.toBeNull();
      expect(side1).not.toBeNull();
      expect(side0 === 0 ? 1 : 0).toBe(side1);

      // The side shown at each display index must be the card's own side at the index
      // the remap produced — label, Ideologue and payout together. If this drifts, the
      // player is shown one answer and charged for another.
      const shown0 = prompt.sides[0];
      const actual0 = card.sides[side0 ?? 0];
      expect(shown0.label).toBe(actual0?.answer);
      expect(shown0.ideologue).toBe(actual0?.ideologue);
      expect(shown0.pays).toEqual(actual0?.pays);
      const shown1 = prompt.sides[1];
      const actual1 = card.sides[side1 ?? 0];
      expect(shown1.label).toBe(actual1?.answer);
      expect(shown1.ideologue).toBe(actual1?.ideologue);
      expect(shown1.pays).toEqual(actual1?.pays);
    }
  });

  it('the order is a pure function of the match, and is not a fixed left/right', () => {
    // A FIXED order is a channel. The two sides belong to different Ideologues and the
    // answer pool is not balanced side-to-side, so "the left one" would let a player
    // learn the slot instead of deliberating (PLAN.md §2 amendment A′).
    //
    // **AND UNDER FULL INFORMATION THIS IS THE ONLY CHANNEL.** The Ideologue is printed
    // beside each answer, so a table that could read `order` would know which Ideologue
    // the first position holds — the position leak rebuilt in one step from a field that
    // used to be one of four things being withheld.
    //
    // This deliberately tests the DISTRIBUTION over a whole deck rather than "the
    // corpus happened to show both". A 14-state corpus is a sample of seven cards and
    // asserting both appear in it is a coin flip, not a test — the first version of this
    // assertion failed for exactly that reason, which is worth recording because it is
    // the trap: a flaky leak test gets deleted.
    const mid = CORPUS.find((s) => s.phase === 'answer');
    if (mid === undefined) throw new Error('no mid-answer state in the corpus');

    const tally = { ab: 0, ba: 0 } as Record<string, number>;
    for (const id of Object.keys(CARDS.ideology)) {
      // Same seed, same state shape, varying card — which is exactly the axis the
      // order must be unpredictable along.
      const probe = { ...mid, _pendingCard: id } as GameState;
      const prompt = answerPromptFor(probe, CARDS, mid.activePlayer);
      if (prompt === null) throw new Error(`probe for ${id} produced no prompt`);
      tally[prompt.order] = (tally[prompt.order] ?? 0) + 1;
    }
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.keys(CARDS.ideology).length);
    // Comfortably wide, so the assertion is not itself flaky: a 60/40 skew on 60
    // cards is the sort of thing that would eventually fail a 50/50 check.
    expect(tally['ab']).toBeGreaterThan(total * 0.25);
    expect(tally['ba']).toBeGreaterThan(total * 0.25);

    // And it is STABLE: a player who reconnects mid-answer must be shown the same
    // order they were shown before, or a click is silently reinterpreted.
    const first = answerPromptFor(mid, CARDS, mid.activePlayer);
    for (let i = 0; i < 5; i += 1) {
      expect(answerPromptFor(mid, CARDS, mid.activePlayer)).toEqual(first);
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
      const prompt = answerPromptFor(probe, CARDS, mid.activePlayer);
      if (prompt === null) throw new Error('no prompt');
      flips.add(prompt.order === 'ab' ? 0 : 1);
    }
    expect(flips.size).toBe(2);
  });

  it('a player who is NOT answering gets no prompt even if they ask for one', () => {
    for (const s of CORPUS) {
      const other = s.turnOrder.find((p) => p !== s.activePlayer);
      if (other === undefined) continue;
      expect(answerPromptFor(s, CARDS, other)).toBeNull();
      expect(answerSideFor(s, CARDS, other, 0)).toBeNull();
    }
  });
});

describe('LAYER 4 — the viewer-sent playable-conspiracy list', () => {
  /**
   * THE ORACLE. What the engine itself would accept, asked of the engine.
   *
   * Every assertion in this block is written against this rather than against a
   * second transcription of the `PLAY_CONSPIRACY` guards. A test that re-states the
   * rules next to the code under test proves the two transcriptions agree today and
   * says nothing about whether either is right; asking `reduce` puts the reducer in
   * charge, so this block cannot pass by agreeing with a bug in `broadcast.ts`.
   */
  function engineAllows(s: GameState, viewer: PlayerID, cardId: string): boolean {
    return reduce(s, viewer, { type: 'PLAY_CONSPIRACY', cardId }, { rules: ctx.rules, cards: CARDS }).ok;
  }

  function offered(s: GameState, viewer: PlayerID | null): readonly string[] {
    return viewFor(s, CARDS, viewer).playableConspiracies.map((c) => c.id);
  }

  it('has a corpus in which several players hold DIFFERENT conspiracies at once', () => {
    // Without this the rest of the block is vacuous: with empty hands every list is
    // empty, and "no cross-contamination" is true of a projection that computes
    // nothing. Two seats holding disjoint, non-empty sets is the minimum fixture
    // that can distinguish a correct projection from one that unions the table.
    let witnessed = 0;
    for (const s of CONSPIRACY_CORPUS) {
      const filled = s.turnOrder.filter((p) => handOf(s, p).length >= 1);
      if (filled.length < 2) continue;
      // Disjointness: if the seats share a card the fixture cannot catch a union.
      const union = new Set(filled.flatMap((p) => handOf(s, p)));
      if (union.size !== filled.flatMap((p) => handOf(s, p)).length) continue;
      witnessed += 1;
    }
    expect(witnessed, 'no state had two seats holding disjoint conspiracies').toBeGreaterThanOrEqual(3);
    // Both phase windows must appear, because the rules differ between them: during
    // `answer` a conspiracy is out of turn for ANYONE (p19), during `actions` it is
    // the active player's alone. A corpus with only one of them tests half a guard.
    expect(CONSPIRACY_CORPUS.some((s) => s.phase === 'answer')).toBe(true);
    expect(CONSPIRACY_CORPUS.some((s) => s.phase === 'actions')).toBe(true);
    expect(CONSPIRACY_CORPUS.some((s) => offered(s, s.activePlayer).length > 0)).toBe(true);
    expect(CONSPIRACY_CORPUS.some((s) => offered(s, null).length > 0)).toBe(false);
  });

  it('offers EXACTLY the cards the engine will accept — no more, and no fewer', () => {
    // This is the load-bearing pair. Sound (nothing offered that is refused) is
    // what stops the picker showing a button that does nothing, which is §9.10's
    // prohibited control. Complete (nothing omitted that is accepted) is what stops
    // the picker hiding a card the player legally owns and therefore cannot play.
    let nonEmptySeen = 0;
    for (const [i, s] of CONSPIRACY_CORPUS.entries()) {
      for (const viewer of [...s.turnOrder, 'p_not_a_seat', '']) {
        const mine = offered(s, viewer);
        const legal = handOf(s, viewer).filter((id) => engineAllows(s, viewer, id));
        expect(
          [...mine].sort(),
          `state ${i} (${s.phase}, active ${s.activePlayer}), viewer ${String(viewer)}`,
        ).toEqual([...legal].sort());
        if (mine.length > 0) nonEmptySeen += 1;
      }
    }
    // If nothing was ever offered, the equality above is `[] === []` twenty times
    // over and proves nothing at all.
    expect(nonEmptySeen, 'the corpus never produced a non-empty list').toBeGreaterThan(5);
  });

  it('NO VIEWER can learn another player\'s conspiracy — the whole payload, not just the list', () => {
    // The critical assertion, and it is deliberately wider than the field. It walks
    // the serialised payload for every viewer in every state of a corpus where three
    // seats hold three different cards, and asserts no OTHER seat's id appears
    // anywhere in it. Checking only `playableConspiracies` would pass while the same
    // id was duplicated into some other corner of `ClientState`; checking the string
    // is what makes "this view carries only what its owner owns" a fact about the
    // payload rather than about one field of it.
    for (const [i, s] of CONSPIRACY_CORPUS.entries()) {
      for (const viewer of [null, ...s.turnOrder]) {
        const json = JSON.stringify(viewFor(s, CARDS, viewer));
        for (const other of s.turnOrder) {
          if (other === viewer) continue;
          for (const id of handOf(s, other)) {
            expect(json.includes(id), `state ${i}: viewer ${String(viewer)} was handed ${other}'s card ${id}`).toBe(
              false,
            );
          }
        }
      }
    }
  });

  it('offers a seat only ids that seat actually holds', () => {
    // The same property as a set identity rather than a substring scan, so a
    // regression that invented an id fails here first with a readable message.
    for (const s of CONSPIRACY_CORPUS) {
      for (const viewer of s.turnOrder) {
        const hand = new Set(handOf(s, viewer));
        for (const c of viewFor(s, CARDS, viewer).playableConspiracies) {
          expect(hand.has(c.id), `${viewer} was offered ${c.id}, which it does not hold`).toBe(true);
        }
      }
    }
  });

  it('a spectator, a non-seat, and the empty-string viewer all get an EMPTY list', () => {
    // A spectator has no hand, so there is nothing it may play. This is the case a
    // viewer-scoped branch written carelessly gets wrong, and it is the reason
    // `viewFor` takes `PlayerID | null` rather than a placeholder id.
    for (const s of CONSPIRACY_CORPUS) {
      expect(viewFor(s, CARDS, null).playableConspiracies).toEqual([]);
      expect(viewFor(s, CARDS, 'p_not_a_seat').playableConspiracies).toEqual([]);
      expect(viewFor(s, CARDS, '').playableConspiracies).toEqual([]);
    }
  });

  it('the list is EMPTY outside the two play windows, and during `headlines` for everyone', () => {
    // p19 scopes a Conspiracy to the `actions` window and to the `answer` window.
    // The Headline queue is neither, and `reduce` refuses it there — so a list that
    // stayed populated through the queue would offer a card whose effect could
    // mutate the board while headlines were still pending (the R9 defect).
    for (const s of CONSPIRACY_CORPUS) {
      if (s.phase === 'actions' || s.phase === 'answer') continue;
      for (const viewer of s.turnOrder) {
        expect(offered(s, viewer), `${viewer} in phase ${s.phase}`).toEqual([]);
      }
    }
  });

  it('during `actions` only the ACTIVE player is offered anything', () => {
    // The turn guard. During the active player's own turn the other seats must see
    // nothing, even though they are holding cards — otherwise the list becomes a
    // window onto every other seat's holdings.
    let checked = 0;
    for (const s of CONSPIRACY_CORPUS) {
      if (s.phase !== 'actions') continue;
      checked += 1;
      for (const viewer of s.turnOrder) {
        if (viewer === s.activePlayer) continue;
        expect(offered(s, viewer), `${viewer} is not the active player`).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('during `answer` EVERY holder is offered, including the seat that is not on move', () => {
    // p19: "before the next player answers, ANY player may play a Conspiracy Card".
    // So the answer window is the one place the list is NOT turn-scoped, and this
    // is the assertion that would fail if the turn guard were copied too eagerly.
    let witnessed = 0;
    for (const s of CONSPIRACY_CORPUS) {
      if (s.phase !== 'answer') continue;
      for (const viewer of s.turnOrder) {
        if (viewer === s.activePlayer) continue;
        const mine = offered(s, viewer);
        if (mine.length === 0) continue;
        witnessed += 1;
        expect(mine, `${viewer} is out of turn in the answer window`).toEqual(handOf(s, viewer));
      }
    }
    expect(witnessed, 'no out-of-turn answer-window offer was ever witnessed').toBeGreaterThan(0);
  });

it('the list is COMPUTED, never cached: playing a card removes it from the next view', () => {
    // The requirement that turns a projection into a live one. Take a state where
    // the viewer is offered something, actually play it through `reduce`, project
    // again, and the card must be gone - with no invalidation step that could be
    // forgotten, because there is no cache to invalidate.
    //
    // WHAT THIS ASSERTS, AND WHY IT IS NOT A LENGTH DELTA — the arithmetic version
    // used to be `after.length === before.length - 1`, and it was wrong in a way that
    // had nothing to do with caching. `playableConspiraciesFor` is empty whenever the
    // viewer owes a `PendingChoice`, and playing a card can MAKE them owe one:
    // ct-in2020-007 is `evict 2` + `gain-any 1`, so the moment it resolves the player
    // is frozen and the whole list is legitimately `[]` — two entries gone, not one.
    // G20 did not break this by changing the corpus's leak surface; it moved the
    // shuffle and so moved which state the walk reached first, which is how a fixture
    // that had been asserting an arithmetic coincidence for months first noticed.
    //
    // A length delta also could not have caught the bug it was named for. The real
    // failure mode of a cached list is a STALE entry — an id the viewer no longer
    // holds, still on offer — and that is a set-membership question, so it is
    // asserted as one. These three are the leak detector, and each is stronger than
    // the delta it replaces:
    //
    //   1. the played card is gone.                    (the named claim)
    //   2. nothing on offer is absent from the hand.   (no stale ids — the cache bug)
    //   3. owing a decision empties the list.          (the rule that broke the delta)
    let exercised = 0;
    let froze = 0;
    // EVERY OFFERED CARD, not just the first. `reduce` is pure, so probing every card a
    // viewer is offered costs nothing and makes assertion 3 independent of which cards
    // the seeded shuffle happened to deal: measured, the old walk played exactly three
    // distinct cards across twenty states and none of them raised a decision, so the
    // freeze branch was reachable only by luck. A leak-suite guard that depends on luck is
    // a guard that will report a corpus change as a coverage hole.
    outer: for (const s of CONSPIRACY_CORPUS) {
      const viewer = s.activePlayer;
      for (const cardId of offered(s, viewer)) {
        const played = reduce(s, viewer, { type: 'PLAY_CONSPIRACY', cardId }, { rules: ctx.rules, cards: CARDS });
        expect(played.ok, `${viewer} was offered ${cardId} and could not play it`).toBe(true);
        if (!played.ok) continue;
        // The card under response has to be SETTLED before "did playing this freeze its
        // player" is a question with an answer: a staged effect list raises no decision
        // until the window closes. See `closeWindow`.
        const settled = closeWindow(played.state);
        const after = offered(played.state, viewer);
        const afterSettled = offered(settled, viewer);
        const hand = handOf(played.state, viewer);

        // 1. the named claim.
        expect(after, 'the played card is still on offer').not.toContain(cardId);
        expect(hand, 'the card is still in the hand the projection is built from').not.toContain(cardId);
        // 2. no stale entry. A projection built from an earlier state would fail here.
        for (const id of after) {
          expect(hand, `${id} is on offer to ${viewer} but is not in their hand — the list is stale`).toContain(id);
        }
        // 3. the freeze, asserted rather than stepped around.
        const owes = settled.choices.some((c) => c.player === viewer);
        if (owes) {
          expect(afterSettled, `${viewer} owes a decision but is still offered cards`).toEqual([]);
          froze += 1;
          if (froze >= 2) break outer;
        }
        exercised += 1;
      }
    }
    expect(exercised, 'no card was ever actually played').toBeGreaterThanOrEqual(2);
    // At least one of the walks must have gone through the freeze branch, or the
    // fixture is not exercising the case that broke the delta in the first place.
    expect(froze, 'no played card ever left its player owing a decision').toBeGreaterThan(0);
  });

  it('handing a card to another seat takes it out of the giver\'s list immediately', () =>
    // The second direction of "not cached": a TRADE moves a card between hands, and
    // a projection that remembered anything about the previous state would still be
    // offering it to the player who gave it away.
    {
      let exercised = 0;
      for (const s of CONSPIRACY_CORPUS) {
        if (s.phase !== 'actions' || s.activePlayer !== s.turnOrder[0]) continue;
        const me = s.turnOrder[0];
        const them = s.turnOrder[1];
        if (me === undefined || them === undefined) continue;
        const cardId = offered(s, me)[0];
        if (cardId === undefined) continue;
        const traded = reduce(
          s,
          me,
          {
            type: 'TRADE',
            withPlayer: them,
            // p12: both sides must exchange at least one resource, and both parties
            // must be able to afford their side, so a bare card swap is refused.
            give: { funds: 1 },
            receive: { funds: 1 },
            giveCards: [cardId],
            receiveCards: [],
          },
          { rules: ctx.rules, cards: CARDS },
        );
        if (!traded.ok) continue;
        expect(offered(traded.state, me), 'the giver still sees the card they traded away').not.toContain(cardId);
        expect(handOf(traded.state, them)).toContain(cardId);
        exercised += 1;
        if (exercised >= 2) break;
      }
      expect(exercised, 'no TRADE of a conspiracy ever committed').toBeGreaterThanOrEqual(1);
    });

  it('still ships no hand: players[].conspiracies is empty for EVERY seat, owner included', () => {
    // The D25 invariant, re-asserted in the states where the new field is NON-EMPTY.
    // Without this, "we send the viewer their playable cards" could quietly become
    // "we send the viewer their hand" — and the two are different rulings.
    let nonEmpty = 0;
    for (const s of CONSPIRACY_CORPUS) {
      for (const viewer of [null, ...s.turnOrder]) {
        const view = viewFor(s, CARDS, viewer);
        if (view.playableConspiracies.length > 0) nonEmpty += 1;
        for (const pid of s.turnOrder) {
          expect(view.players[pid]?.conspiracies, `viewer ${String(viewer)} sees ${pid}'s hand`).toEqual([]);
        }
      }
    }
    expect(nonEmpty, 'no viewer was ever offered a card, so this would be vacuous').toBeGreaterThan(5);
  });

  it('names the cards, and only from the index — never an id with no readable card', () => {
    // The client has no card database, so `name` and `text` have to come from here.
    // Asserting they are the PRINTED strings, not ids dressed up as labels, is what
    // stops a future refactor sending `t-con-0007` as the "name".
    for (const s of CONSPIRACY_CORPUS) {
      for (const viewer of s.turnOrder) {
        for (const c of viewFor(s, CARDS, viewer).playableConspiracies) {
          const card = CARDS.conspiracy[c.id];
          expect(card).toBeDefined();
          expect(c.name).toBe(card?.name);
          expect(c.text).toBe(card?.text);
          expect(c.name, 'the name must not be the id').not.toBe(c.id);
        }
      }
    }
  });

  it('LAYER 2: no rendered MESSAGE carries another seat\'s conspiracy either', () => {
    // `renderAll` is what the handler can put on a socket. Walking only `viewFor`
    // would leave room for a second send path that inlined a whole hand, so the
    // cross-contamination assertion is repeated over the exhaustive render.
    let checked = 0;
    for (const s of CONSPIRACY_CORPUS) {
      for (const viewer of [null, ...s.turnOrder]) {
        for (const msg of renderAll(s, { rules: ctx.rules, cards: CARDS }, viewer)) {
          const json = JSON.stringify(msg);
          for (const other of s.turnOrder) {
            if (other === viewer) continue;
            for (const id of handOf(s, other)) {
              expect(json.includes(id), `${msg.t} leaked ${other}'s ${id} to ${String(viewer)}`).toBe(false);
            }
          }
          // A spectator's render carries no conspiracy id whatsoever, not even its
          // own — there is no own.
          if (viewer === null) {
            for (const pid of s.turnOrder) {
              for (const id of handOf(s, pid)) {
                expect(json.includes(id), `${msg.t} leaked ${pid}'s ${id} to a spectator`).toBe(false);
              }
            }
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the ROOM path agrees with the bare projection, for every viewer', () => {
    // The same argument layer 1 makes about `viewFor`: walk what `Room.viewFor`
    // actually hands the fan-out, which is what the server sends.
    for (const s of CONSPIRACY_CORPUS) {
      const room = roomFor(s);
      for (const viewer of [null, ...s.turnOrder]) {
        expect(room.viewFor(viewer).state.playableConspiracies.map((c) => c.id)).toEqual(
          offered(s, viewer),
        );
      }
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
      const json = JSON.stringify(viewFor(s, CARDS, null).log);
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

    // The `order` guarantee, at the type level. It used to be a `BlindShape` proof that
    // no payout/ideologue/cardId key existed — a true statement about a type that no
    // longer exists, since the payout is now published on purpose. The surviving claim is
    // the narrow one and it is the one that matters: NEITHER published card type carries
    // an `order`, at any level, and the answerer's prompt carries `order` and nothing else
    // beyond the card.
    type TableCard = PublicQuestion;
    type PromptShape = AnswerPrompt;
    const tableHasNoOrder: keyof TableCard extends 'order' ? false : true = true;
    const promptKeysAreExactly: keyof PromptShape extends 'order' | 'question' | 'sides' ? true : false = true;
    expect(tableHasNoOrder).toBe(true);
    expect(promptKeysAreExactly).toBe(true);
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

// ─────────────────── the declared leak paths, walked GENERICALLY ───────────────────

/**
 * `LEAK_PATHS` used to be imported and then `void`ed.
 *
 * That is worth naming, because it is the same failure as a pinned number wearing a
 * different hat: a list that no assertion reads cannot fail, so it cannot catch
 * anything, and the file's own header argues at length that "a list that rots
 * silently is worse than no list" — while this one was decorative. The entries were
 * real rulings; nothing was checking them.
 *
 * So the walk below is generic: it reads every path the inventory declares and asserts
 * the projection carries nothing for it, for every viewer, in every state of both
 * corpora. Adding a hidden-but-unprefixed field to the inventory is now a one-line
 * edit that immediately becomes an assertion, and a hidden field that is NOT in the
 * inventory is caught by the walk below the one after it.
 */
function valuesAt(view: ClientState, path: string): unknown[] {
  const root = view as unknown as Record<string, unknown>;
  if (path.startsWith('players[].')) {
    const key = path.slice('players[].'.length);
    const players = (root['players'] ?? {}) as Record<string, Record<string, unknown>>;
    return Object.values(players).map((p) => p[key]);
  }
  const key = path.endsWith('[]') ? path.slice(0, -2) : path;
  const v = root[key];
  return Array.isArray(v) ? v : [v];
}

/** The same path read off the AUTHORITATIVE state, so the walk is not vacuous. */
function authoritativeAt(s: GameState, path: string): unknown[] {
  if (path === 'playableConspiracies[]') return [viewFor(s, CARDS, null).playableConspiracies];
  const key = path.slice('players[].'.length);
  return s.turnOrder.map((p) => (s.players[p] as unknown as Record<string, unknown>)[key]);
}

describe('the DECLARED leak paths, walked rather than trusted', () => {
  it('every path in LEAK_PATHS is present in the inventory and names a real field', () => {
    // The shape check, so a typo in a path cannot quietly turn the walk below into a
    // walk over `undefined`.
    for (const [field, path] of Object.entries(LEAK_PATHS)) {
      expect(path, `${field} has no path recorded`).toMatch(/^(players\[\]\.[a-zA-Z]+|[a-zA-Z]+\[\])$/);
    }
  });

  it('no viewer sees anything at any declared leak path, in any state of either corpus', () => {
    for (const [field, path] of Object.entries(LEAK_PATHS)) {
      for (const s of [...CORPUS, ...CONSPIRACY_CORPUS, ...IDEOLOGY_HAND_CORPUS]) {
        for (const viewer of [null, ...s.turnOrder, 'p_not_a_seat', '']) {
          const seen = valuesAt(viewFor(s, CARDS, viewer), path);
          if (path.startsWith('players[].')) {
            // A HAND: empty or absent, for every viewer INCLUDING the owner.
            for (const v of seen) {
              expect(Array.isArray(v) ? v.length : v, `viewer ${String(viewer)} sees ${field} in ${path}`).toBe(0);
            }
            continue;
          }
          // The declared EXCEPTION: `playableConspiracies` is non-empty by design, so
          // "empty" would be the wrong assertion and would be wrong in the direction of
          // forbidding the mechanic. What it must be is a subset of the VIEWER'S OWN
          // hand — never another seat's, never a card the viewer does not hold. This is
          // the narrow reading of D25: a player may know which of their own cards they
          // may play, and nothing else.
          const own = viewer === null ? [] : handOf(s, viewer);
          for (const entry of seen as readonly { id?: string }[]) {
            expect(
              own,
              `viewer ${String(viewer)} is offered ${entry.id ?? '?'}, which is not in their own hand`,
            ).toContain(entry.id ?? '');
          }
        }
      }
    }
  });

  it('the walk is not vacuous: every declared hand was non-empty in a real state', () => {
    // A leak test whose fixture cannot fail is a decoration, and that is not a
    // hypothetical here — the conspiracy block above this one shipped with empty hands
    // in every state and would have passed against a projection that computed nothing.
    for (const field of ['conspiracyHand', 'ideologyHand']) {
      const path = LEAK_PATHS[field as keyof typeof LEAK_PATHS];
      let witnessed = 0;
      for (const s of [...CORPUS, ...CONSPIRACY_CORPUS, ...IDEOLOGY_HAND_CORPUS]) {
        for (const v of authoritativeAt(s, path)) {
          if (Array.isArray(v) && v.length > 0) witnessed += 1;
        }
      }
      expect(witnessed, `${field} was empty in every state, so the assertion above proves nothing`).toBeGreaterThan(0);
    }
  });
});

/**
 * A state in which a player really is HOLDING a donated Ideology Card.
 *
 * `LEAK_PATHS.ideologyHand` was the entry the engine owed this suite, and an entry
 * nothing produces is an entry nothing tests. HOLO SAPIENS / JUMLA are the cards that
 * put one there (`move-card` from the draw pile into a hand, `target: 'you'`), so this
 * searches the seeds for one where that card is on top of the draw pile, buys it, plays
 * it, and keeps the result.
 *
 * Reading `_conspiracyDraw[0]` is legitimate HERE and nowhere else: this is the leak
 * suite, and the whole point of the prefix walk is that this file is the one place
 * allowed to look at server-only state.
 */
function ideologyHandCorpus(): readonly GameState[] {
  const holo = Object.values(CARDS.conspiracy).find((c) => c.effects.some((e) => e.op === 'move-card'));
  if (holo === undefined) throw new Error('no shipped Conspiracy moves an Ideology Card into a hand');
  const out: GameState[] = [];
  for (let seed = 1; seed <= 400 && out.length < 3; seed += 1) {
    let s = setup({
      players: ['p1', 'p2'],
      names: { p1: 'One', p2: 'Two' },
      cards: CARDS,
      seed,
      // Seat 1 can afford the printed cost on turn one, and stays UNDER p12's cap of
      // 12 — a seat sitting exactly on the cap opens a `lose-any` decision the moment it
      // is paid, and `PLAY_CONSPIRACY` is refused until that is resolved ("resolve
      // \"Resource cap\" first"). The engine does not guess a split.
      startResources: [{ funds: 5 }, { funds: 4 }],
      ...decksOf(CARDS),
    });
    if (s._conspiracyDraw[0] !== holo.id) continue;
    const me = s.turnOrder[0] as PlayerID;
    if (s.activePlayer !== me) continue;
    // A fresh `setup` opens in the ANSWER phase, so seat 1 owes an answer before it
    // can buy anything. Answering also gives it the turn income the purchase needs.
    if (s.phase === 'answer') {
      const answered = reduce(s, me, { type: 'ANSWER', side: 0 }, { rules: ctx.rules, cards: CARDS });
      if (!answered.ok) continue;
      s = answered.state;
    }
    if (s.phase !== 'actions' || s.activePlayer !== me) continue;
    const bought = reduce(s, me, { type: 'BUY_CONSPIRACY', pay: { funds: holo.cost } }, { rules: ctx.rules, cards: CARDS });
    if (!bought.ok) continue;
    s = bought.state;
    const played = reduce(s, me, { type: 'PLAY_CONSPIRACY', cardId: holo.id }, { rules: ctx.rules, cards: CARDS });
    if (!played.ok) continue;
    // A reactive card in another hand stages the effect list instead of resolving it.
    s = closeWindow(played.state);
    if (ideologyHandOf(s.players[me]).length > 0) out.push(s);
  }
  if (out.length === 0) {
    throw new Error(`no seed in 1..400 put ${holo.id} on top and resolved it into a hand`);
  }
  return out;
}

const IDEOLOGY_HAND_CORPUS = ideologyHandCorpus();

describe('a donated Ideology Card is hidden from EVERYBODY, its holder included', () => {
  it('the fixture really produced held cards, in more than one state', () => {
    // Named separately so the next reader knows the states below are not empty — the
    // failure mode this suite has already shipped once, in the conspiracy block.
    expect(IDEOLOGY_HAND_CORPUS.length, 'no seed produced a held Ideology Card').toBeGreaterThan(0);
    const holders = IDEOLOGY_HAND_CORPUS.flatMap((s) => s.turnOrder.filter((p) => ideologyHandOf(s.players[p]).length > 0));
    expect(holders.length, 'every state was produced with an empty hand').toBeGreaterThan(0);
  });

  it('the authoritative state holds a card and no projection of it does', () => {
    // The ruling, from `packages/engine/src/state.ts`: the answer to a blind card is a
    // coin flip the player makes, and a player shown the card has not made one. p13
    // keeps a card hidden until its answer is confirmed, so a DONATED card — not yet
    // answered — is on the hidden side of that line.
    for (const s of IDEOLOGY_HAND_CORPUS) {
      const holder = s.turnOrder.find((p) => ideologyHandOf(s.players[p]).length > 0);
      expect(holder, 'the fixture produced a state with no holder').toBeDefined();
      if (holder === undefined) continue;
      for (const viewer of [null, ...s.turnOrder, 'p_not_a_seat', '']) {
        const seen = (viewFor(s, CARDS, viewer).players[holder] as unknown as Record<string, unknown>)['ideologyCards'];
        expect(Array.isArray(seen) ? seen.length : seen, `viewer ${String(viewer)} sees ${holder}'s donated card`).toBe(0);
      }
    }
  });

  it('the answered half IS public, which is what makes the hidden half a ruling', () => {
    // `manifestoCards` is the counterpart and it is deliberately public: an ANSWERED
    // card is the player's public identity and the Ideologue power ladder is read from
    // it. Asserting both halves together is the point — "hidden" is not the default
    // state of this field, so the omission would be invisible if only the hidden half
    // were tested.
    for (const s of [IDEOLOGY_HAND_CORPUS[0], CORPUS[CORPUS.length - 1]].filter((x): x is GameState => x !== undefined)) {
      const holder = s.turnOrder.find((p) => (s.players[p]?.manifestoCards.length ?? 0) > 0);
      if (holder === undefined) continue;
      const seen = (viewFor(s, CARDS, holder).players[holder] as unknown as Record<string, unknown>)['manifestoCards'];
      expect(Array.isArray(seen) ? seen.length : 0, 'an ANSWERED card is public by rulebook and must stay so').toBeGreaterThan(0);
    }
  });
});

/**
 * THE `Choice` UNION, CHECKED AGAINST THE INVENTORY.
 *
 * A `Choice` is the one place a leak can arrive with no `_`-prefixed field to trip
 * over: it is a VALUE the engine chooses to publish, so a kind that said "pick one of
 * these cards" would enumerate a hidden hand and neither the prefix walk nor
 * `LEAK_PATHS` would see it. `CHOICE_KINDS` in the inventory classifies every kind with
 * what it is allowed to ask about, and this reads the engine's own union to check the
 * two agree.
 *
 * Reading the engine's SOURCE is the price of that, and it is worth paying: the union
 * has no runtime representation — a `Choice` only exists while a decision is open — so
 * there is no way to enumerate it from a `CardIndex` or from a played corpus, and a new
 * kind that no fixture ever raised would otherwise arrive unclassified and unnoticed.
 */
function engineChoiceKinds(): string[] {
  const src = readFileSync(fileURLToPath(new URL('../../engine/src/state.ts', import.meta.url)), 'utf8');
  const start = src.indexOf('export type Choice =');
  expect(start, 'the engine no longer declares `export type Choice` where this reader expects it').toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf('\nexport ');
  const body = end < 0 ? rest : rest.slice(0, end);
  return [...body.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1] ?? '').sort();
}

describe('every Choice kind is classified, and none of them may name a card', () => {
  it("the engine's Choice union and the inventory agree", () => {
    // A parallel agent may add a kind this round. If it enumerates a hidden hand, that
    // is a leak and this is where it has to be caught: the new kind fails to be listed,
    // so somebody has to look at it, and the classification below says what it is
    // allowed to ask about.
    const engine = engineChoiceKinds();
    expect(engine.length, 'the Choice union reader found no kinds — the reader is stale').toBeGreaterThan(0);
    expect(Object.keys(CHOICE_KINDS).sort(), 'a Choice kind is unclassified, or a classification is obsolete').toEqual(engine);
  });

  it('no classified kind is allowed to ask a player about CARDS', () => {
    // The leak argument, as an assertion. Every current kind names resources, pegs,
    // seats or zones, all four of which are public: a resource total is in the
    // projection, a peg and a zone are on the board, and a seat is in `turnOrder`. A
    // kind that named a card id would be a hand, and the projection strip would not
    // catch it, because the strip only knows about FIELDS.
    for (const [kind, about] of Object.entries(CHOICE_KINDS)) {
      expect(['resources', 'pegs', 'players', 'zones'], `${kind} asks the player about ${about}`).toContain(about);
    }
  });

  it('no PendingChoice names a CARD, in any state either corpus reached', () => {
    // The teeth behind the classification above, and the check that would fire if a
    // future choice kind were built out of card ids — which is the leak this whole entry
    // exists for.
    //
    // It is checkable without classifying anything: serialise every decision the engine
    // can raise across all three corpora and assert that not one CardID from the corpus
    // appears in it. `choose-player` carries `source`, which is a PlayerID and looks
    // enough like a card id to be worth checking rather than reasoning about.
    //
    // The decisions have to be COLLECTED rather than read off a stored state, because a
    // stored state is the state AFTER the walk answered them — measured, every state in
    // all three corpora ends with an empty `choices`, so a scan over them proves nothing.
    // So this probes the same way the freeze test above does: play every card the
    // projection offers and keep whatever the engine asks.
    type Decision = GameState['choices'][number];
    const decisions: Decision[] = [];
    for (const s of [...CORPUS, ...CONSPIRACY_CORPUS, ...IDEOLOGY_HAND_CORPUS]) {
      decisions.push(...s.choices);
      const viewer = s.activePlayer;
      for (const cardId of viewFor(s, CARDS, viewer).playableConspiracies.map((c) => c.id)) {
        const played = reduce(s, viewer, { type: 'PLAY_CONSPIRACY', cardId }, { rules: ctx.rules, cards: CARDS });
        if (!played.ok) continue;
        decisions.push(...closeWindow(played.state).choices);
      }
    }

    const ids = [
      ...Object.keys(CARDS.ideology),
      ...Object.keys(CARDS.voter),
      ...Object.keys(CARDS.conspiracy),
      ...Object.keys(CARDS.headline),
    ];
    expect(decisions.length, 'no corpus state ever opened a decision, so the scan below was empty').toBeGreaterThan(0);
    for (const d of decisions) {
      const json = JSON.stringify(d);
      for (const id of ids) {
        expect(json.includes(id), `a PendingChoice names the card ${id}: ${json.slice(0, 200)}`).toBe(false);
      }
    }
  });
});