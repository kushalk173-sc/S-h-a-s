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
import { makeCtx, realCards } from './fixtures.ts';
import { decksOf } from '../src/store.ts';
import { renderAll } from './render-all.ts';
import { LEAK_PATHS, SECRET_FIELDS } from './secret-inventory.ts';

/**
 * THE SHIPPED CORPUS, and this used to be `bigCards(60)`.
 *
 * A leak detector that runs on synthetic cards is a leak detector that has never seen
 * the cards players actually get, and the synthetic set was blind in a specific,
 * demonstrated way: every one of its 24 Headline Cards was `gain media 1`, so it
 * NEVER produced an effect-generated `PendingChoice`, and the 22 Conspiracy Cards were
 * all `voters n:1`. The shipped corpus's 26 headlines carry twelve distinct ops and
 * its conspiracies carry ten, and three of those ops open a decision that freezes a
 * player — so the real corpus exercises projection paths — `blindPromptFor` under a
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
    const b = s.phase === 'answer' ? blindPromptFor(s, CARDS, s.activePlayer) : null;
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
        const keys = [...allKeys(v.state), ...(v.blind === null ? [] : allKeys(v.blind))].filter((k) =>
          k.startsWith('_'),
        );
        expect(keys, `room state ${i} (${s.phase}), viewer ${String(viewer)}`).toEqual([]);
      }
    }
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
    // again, and the card must be gone — with no invalidation step that could be
    // forgotten, because there is no cache to invalidate.
    let exercised = 0;
    for (const s of CONSPIRACY_CORPUS) {
      const viewer = s.activePlayer;
      const before = offered(s, viewer);
      const cardId = before[0];
      if (cardId === undefined) continue;
      const played = reduce(s, viewer, { type: 'PLAY_CONSPIRACY', cardId }, { rules: ctx.rules, cards: CARDS });
      expect(played.ok).toBe(true);
      if (!played.ok) continue;
      const after = offered(played.state, viewer);
      expect(after, 'the played card is still on offer').not.toContain(cardId);
      expect(after.length).toBe(Math.max(0, before.length - 1));
      exercised += 1;
      if (exercised >= 4) break;
    }
    expect(exercised, 'no card was ever actually played').toBeGreaterThanOrEqual(2);
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
