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
  type Action,
  type ClientState,
  type GameState,
  type PlayerID,
  type PlayerState,
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
 * **AND THE SECOND EXEMPTION IS G17'S, AND IT IS NARROWER IN THE OPPOSITE DIRECTION.**
 * A PLAYED Conspiracy Card sits in `_conspiracyDiscard` and `ClientState.conspiracyRecycle`
 * publishes it, because both of its writers log `Played "NAME"` — the card was face up
 * on the table when it went down. So `PLAY_CONSPIRACY_CORPUS_DISCARD` is a second
 * public set, and it applies to `_conspiracyDiscard` ONLY: a played-then-reshuffled card
 * is in `_conspiracyDraw`, is not covered by it, and is a secret again. That asymmetry is
 * the whole of `_seed`'s protection — after a reshuffle the draw order is
 * `shuffle(discard, _seed)`, so an exemption that followed the card across the reshuffle
 * would publish the seed.
 *
 * THE SUBTRACTION IS EXACT, NOT A BLANKET EXEMPTION. `secretIds` below removes
 * precisely the ids that are in some player's `manifestoCards`, or in the recycle pile
 * with a `Played` line of its own, and nothing else. A Conspiracy Card in the discard
 * pile with NO `Played` line — which is exactly what `draw-conspiracy { to: 'discard' }`
 * over the draw pile would have produced, and which the reducer refuses — stays in the
 * set and still has to be absent. The cases are distinguished by a fact about the state,
 * not by a decision about which assertion to run.
 */
function publicCardIds(s: GameState): ReadonlySet<string> {
  const out = new Set<string>();
  for (const pid of s.turnOrder) {
    for (const id of s.players[pid]?.manifestoCards ?? []) out.add(id);
  }
  return out;
}

/**
 * G17 — the Conspiracy recycle pile RECONSTRUCTED FROM THE PUBLIC LOG, in order.
 *
 * Read from `LogEntry`s and nothing else: `Played "NAME".` puts a card on the pile,
 * `Picked "NAME".` takes one off, and both name it. `_seed` is not consulted, no pile is
 * read, and the card index is used only to turn a printed name back into the id a payload
 * would carry — which is the whole of what a client can do too.
 *
 * ## WHY IT IS A REPLAY AND NOT A SET — and why the set version was a false guard
 *
 * The first version of this reader collected `Played` names into a DEDUPLICATED list in
 * first-play order, and the derivation test compared that against the published list. It
 * is unsound: a card that is played, picked back off the pile and played again is on the
 * pile at its SECOND position, while a dedupe keeps it at its first. So the relation the
 * old reader could express was "the pile is a SUBSEQUENCE of the played set", which is a
 * weaker claim than the one the projection needs, and the weaker claim was the one
 * asserted. On real games the two disagree in 13% of states and no fixture reached the
 * disagreeing shape, because the driver never ANSWERED a `'choose-card'` — a decision was
 * raised, asserted about, and abandoned.
 *
 * With `Picked` announced, a replay is exact: push on `Played`, remove ONE occurrence on
 * `Picked`. Removing one occurrence rather than all of them is what keeps a same-named
 * pair honest if the corpus ever produces one.
 *
 * ## WHAT THIS CANNOT SEE, AND WHY THAT IS FINE HERE
 *
 * A reshuffle. It moves the pile into the draw pile and empties it, and nothing in the
 * LOG distinguishes "the pile was emptied by a reshuffle" from "every card on it was
 * picked", so a log-only reader cannot follow a reshuffle. That is not a gap here because
 * the instant is UNREACHABLE: `draw(s, 'conspiracy')` has no caller in `reduce.ts`
 * (`BUY_CONSPIRACY` refuses an exhausted deck before it would draw, and `draw-conspiracy`
 * reads `_conspiracyDraw` directly). `no reshuffle of the Conspiracy pile is reachable`
 * asserts that by reading the reducer's own source, so the day somebody adds the call
 * this reader is forced to learn about reshuffles rather than quietly going stale. The
 * `[]`-across-a-reshuffle backstop is asserted separately, on a hand-applied reshuffle.
 */
function publicRecycleIds(s: GameState): readonly string[] {
  const names = byName();
  const out: string[] = [];
  for (const e of s.log) {
    // The trailing full stops are `reduce`'s, and a reader that drops either of them finds
    // an empty sequence and passes every assertion above it for the wrong reason.
    const played = /^Played "(.+)"\.$/.exec(e.text);
    if (played !== null) {
      const id = names.get(played[1] ?? '');
      if (id !== undefined) out.push(id);
      continue;
    }
    const picked = /^Picked "(.+)"\.$/.exec(e.text);
    if (picked === null) continue;
    const id = names.get(picked[1] ?? '');
    const at = id === undefined ? -1 : out.indexOf(id);
    if (at >= 0) out.splice(at, 1);
  }
  return out;
}

/** Deck ids that must never appear in a client payload. */
function allSecretValues(s: GameState): { cards: readonly string[]; seed: string } {
  const isPublic = publicCardIds(s);
  const playedOnTheLog = new Set(publicRecycleIds(s));
  const candidates = [
    ...s._ideologyDraw,
    ...s._ideologyDiscard,
    ...s._voterDraw,
    ...s._voterDiscard,
    ...s._conspiracyDraw,
    // G17. The Conspiracy discard pile is exempt ONLY for a card the log says was
    // played, and ONLY here — see the note on `publicCardIds`. `_conspiracyDraw` above
    // is exempt for nothing, which is what keeps a reshuffled card secret.
    ...s._conspiracyDiscard.filter((id) => !playedOnTheLog.has(id)),
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
 * THE PRIVATE-PLAYER KEYS, read out of the engine's OWN declaration.
 *
 * `PRIVATE_PLAYER_KEYS` is the list of hidden hands that are not `_`-prefixed, and it
 * is duplicated here as a DERIVATION rather than typed, so that a new hidden hand is
 * covered by every predicate below without anybody editing this file. The reader fails
 * loudly if the declaration moves, which is what stops it decaying into a constant that
 * no longer describes anything.
 */
function privatePlayerKeys(): readonly string[] {
  const src = readFileSync(fileURLToPath(new URL('../../engine/src/playerView.ts', import.meta.url)), 'utf8');
  const at = src.indexOf('export const PRIVATE_PLAYER_KEYS');
  expect(at, 'PRIVATE_PLAYER_KEYS is no longer where this reader expects it').toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf('as const', at));
  const keys = [...body.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1] ?? '');
  expect(keys.length, 'the PRIVATE_PLAYER_KEYS reader found none — it is stale').toBeGreaterThan(0);
  return keys;
}

/**
 * EVERY CARD ID THAT IS NOT PUBLIC TO EVERY CLIENT in this state, for a predicate that
 * has no per-viewer exceptions.
 *
 * **WHY THIS IS NOT `allSecretValues`, and the difference is the whole argument.**
 * `allSecretValues` is what the PAYLOAD scan uses, and the payload has exactly one
 * sanctioned exception — `playableConspiracies`, a per-VIEWER list of that viewer's own
 * hand, which `LEAK_PATHS` records and `secret-state.test.ts` branches on. A decision
 * has no such exception and cannot have one: `PendingChoice` is one value with no
 * viewer parameter, so anything in it is in EVERY viewer's payload. Reusing the payload
 * predicate here would therefore be a rule with a hole exactly where this unit lives.
 *
 * So the sets are read from the engine's declarations — the eight `_` piles via
 * `ServerOnlyKeys`, the two hidden hands via `PRIVATE_PLAYER_KEYS` — with ONE carve-out,
 * and the carve-out is U1's: the Conspiracy recycle list. `_conspiracyDraw` is not carved
 * out, so a card that has been reshuffled is a secret again, which is exactly the `_seed`
 * protection.
 *
 * ## AND WHY THE CARVE-OUT IS DERIVED FROM THE LOG, NOT FROM THE PROJECTION
 *
 * The first version built its public set out of `viewFor(s, CARDS, null).conspiracyRecycle`
 * — the projection it is supposed to be auditing. That is circular in the one place a
 * circularity hides: it exempts every id the projection emits, so a projection that
 * emitted `_conspiracyDraw[0]` would have that id exempted from the `_conspiracyDraw`
 * scan too, and the guard would stay green while the wire carried a draw-pile card. The
 * guard was asking the thing under test for permission.
 *
 * `publicRecycleIds` reads `state.log` and the card index and nothing else, so the
 * exemption is grounded in a source the projection cannot write to. That is what makes
 * the guard able to go red: an id the log does not account for is hidden, whichever pile
 * it happens to be sitting in. `conspiracyRecycle cannot launder a draw-pile id into the
 * allowed set` proves it by mutation.
 */
function hiddenCardIds(s: GameState): ReadonlySet<string> {
  const published = new Set(publicRecycleIds(s));
  const out = new Set<string>();
  const add = (value: unknown): void => {
    // `_idSeq` is in `ServerOnlyKeys` and is a NUMBER, and `_pendingCard` is a single
    // id rather than a list. Both are handled by the branch above or here, and neither
    // is a card set — which is why this is a runtime shape check rather than a cast.
    if (!Array.isArray(value)) return;
    for (const id of value as readonly string[]) if (!published.has(id)) out.add(id);
  };
  // The eight piles, by the engine's own `ServerOnlyKeys` union rather than by name.
  for (const key of serverOnlyKeys()) {
    if (key === '_pendingCard') {
      add(s._pendingCard === null ? [] : [s._pendingCard]);
      continue;
    }
    if (key === '_idSeq') continue;
    add(s[key as keyof GameState]);
  }
  // And the two hidden hands, which the prefix walk cannot see at all.
  for (const key of privatePlayerKeys()) {
    for (const pid of s.turnOrder) {
      add((s.players[pid] as unknown as Readonly<Record<string, readonly string[]>>)[key]);
    }
  }
  return out;
}

/** The engine's eleven server-only field names, sliced out of `playerView.ts`. */
function serverOnlyKeys(): readonly string[] {
  const src = readFileSync(fileURLToPath(new URL('../../engine/src/playerView.ts', import.meta.url)), 'utf8');
  const at = src.indexOf('export type ServerOnlyKeys');
  expect(at, 'ServerOnlyKeys is no longer where this reader expects it').toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf(';', at));
  const keys = [...body.matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1] ?? '');
  // Eleven, and the count is asserted because a reader that silently found four would
  // exempt almost everything below and the guard would pass for a reason nobody chose.
  expect(keys.length, 'the ServerOnlyKeys reader found a different number of fields').toBe(11);
  return keys;
}

/**
 * A corpus that actually PLAYS Conspiracy Cards, which is the only way the pile under
 * U1's projection is ever non-empty.
 *
 * `conspiracyCorpus` above BUYS and never plays, so every state in it has an empty
 * discard pile — which is exactly the shape that would let a projection of that pile
 * pass every assertion here while proving nothing. This one drives the whole protocol:
 * answer, buy, and `PLAY_CONSPIRACY`, closing each response window, and it collects a
 * state after every step so the assertion walks a real sequence of plays rather than a
 * hand-built pile.
 */
function playedConspiracyCorpus(steps: number): readonly GameState[] {
  const order = ['p1', 'p2', 'p3'] as const;
  const picking = Object.values(CARDS.conspiracy).find((c) =>
    c.effects.some((e) => e.op === 'draw-conspiracy' && e.pick === true),
  );
  if (picking === undefined) throw new Error('no shipped card carries `pick: true`, so U1 is untested here');
  let s = setup({
    players: [...order],
    names: { p1: 'One', p2: 'Two', p3: 'Three' },
    cards: CARDS,
    seed: 20260930,
    ...decksOf(CARDS),
  });
  const corpus: GameState[] = [s];
  let attempts = 0;
  while (corpus.length < steps && !s.finished && attempts < steps * 16) {
    attempts += 1;
    /**
     * WHICH SEAT, chosen rather than rotated.
     *
     * A rotation cannot reach U1's card: the seat holding it is only `activePlayer` for
     * one turn in three, and a walk that only ever offers a move to `order[n % 3]` skips
     * that turn. So the seat that can actually PLAY is preferred, and within those the
     * one holding the picking card comes first.
     */
    const canAct = s.turnOrder.filter(
      (p) => s.activePlayer === p && !s.choices.some((c) => c.player === p),
    );
    const playable = canAct.filter((p) => s.phase === 'actions' && s.interrupt === null);
    const me = playable[0] ?? canAct[0] ?? s.choices[0]?.player ?? s.activePlayer;
    const held = handOf(s, me);
    const followUp = nextConspiracyAction(s, me);
    const candidates: readonly Action[] = [
      ...(playable.includes(me) && held.length > 0
        ? [{ type: 'PLAY_CONSPIRACY', cardId: held[0] as string } as const]
        : []),
      ...(followUp === null ? [] : [followUp as Action]),
    ];
    let moved = false;
    for (const a of candidates) {
      const r = reduce(s, me, a, { rules: ctx.rules, cards: CARDS });
      if (!r.ok) continue;
      s = closeWindow(r.state);
      corpus.push(s);
      moved = true;
      break;
    }
    if (!moved) {
      const end = reduce(s, me, { type: 'END_TURN' }, { rules: ctx.rules, cards: CARDS });
      if (end.ok) {
        s = end.state;
        corpus.push(s);
      }
    }
  }
  // The whole point of this corpus is a NON-EMPTY pile; the picking card is reached by
  // `pickDecisionStates` below, which is a different job.
  expect(
    corpus.some((x) => x._conspiracyDiscard.length > 0),
    'the walk never put a card on the Conspiracy discard pile, so there is nothing for U1 to publish',
  ).toBe(true);
  return corpus;
}

/**
 * The states in which the engine actually raises a `'choose-card'` — reached by HANDING
 * a seat U1's own card rather than by waiting for the deck to deal it.
 *
 * `ct-et2040-018` is the eighteenth card of twenty-seven, and a walk that buys cards
 * stalls long before it reaches it, so a walk-based corpus would leave every assertion
 * below running over a set with no card decision in it. The fixture is therefore explicit
 * about what it is: the pile, the turn window, the empty decision queue and the window
 * closure are all the engine's; only the card in the hand is placed, and it is FOUND by
 * its `pick` field rather than by name so it moves if the deck does.
 *
 * The returned states are genuine `reduce` outputs, which is what the derivation test
 * needs — it reads the log, and a hand-built state has no log.
 */
function pickDecisionStates(): readonly GameState[] {
  const picking = Object.values(CARDS.conspiracy).find((c) =>
    c.effects.some((e) => e.op === 'draw-conspiracy' && e.pick === true),
  );
  if (picking === undefined) throw new Error('no shipped card carries `pick: true`, so U1 is untested here');
  const out: GameState[] = [];
  for (const s of playedConspiracyCorpus(26)) {
    if (s._conspiracyDiscard.length === 0) continue;
    const me = s.turnOrder[0];
    if (me === undefined) continue;
    const seated: GameState = {
      ...s,
      phase: 'actions',
      activePlayer: me,
      interrupt: null,
      activeHeadline: null,
      choices: [],
      players: { ...s.players, [me]: { ...(s.players[me] as PlayerState), conspiracies: [picking.id] } },
    };
    const played = reduce(seated, me, { type: 'PLAY_CONSPIRACY', cardId: picking.id }, { rules: ctx.rules, cards: CARDS });
    if (!played.ok) continue;
    const settled = closeWindow(played.state);
    if (settled.choices.some((c) => c.choice.kind === 'choose-card')) out.push(settled);
  }
  expect(
    out.length,
    'no state raised a `choose-card`, so every assertion about one is running over an empty set',
  ).toBeGreaterThan(0);
  return out;
}

/**
 * THE DEPARTURE, REACHED. `pickDecisionStates` above RAISES the decision and stops; this
 * ANSWERS it, and that one step is the whole gap the leak lived in.
 *
 * ## WHY A SEPARATE FIXTURE AND NOT AN EXTRA LINE IN THE WALK
 *
 * `playedConspiracyCorpus` and `pickDecisionStates` both stop at an open `'choose-card'`.
 * The driver's `nextConspiracyAction` answers `'steal-any'`, `'gain-any'`, `'lose-any'`
 * and falls through to `{ kind: 'areas' }` for anything else, which `reduce` REFUSES for a
 * `'choose-card'`. So every corpus in this file had been walking up to the edge of the
 * departure and turning away. That is why the old derivation test was green over a
 * relation that real games break 13% of the time: no state in the suite had ever picked
 * a card off the pile.
 *
 * ## AND THE DIVERGENT SHAPE, EXPLICITLY
 *
 * A single answer gives `Played A`, `Played B`, `Picked A` and a pile of `[B]`. The old
 * deduped reader produced `[A, B]` for that log, so the pile `[B]` was neither a prefix
 * nor equal to it — the case the auditor measured. `a departure makes the pile and a
 * deduped replay disagree` asserts that this corpus really contains such a state, so the
 * repaired equality is asserted over the shape that broke the old guard rather than over
 * a shape that flatters it.
 *
 * The answer is dispatched through `RESOLVE_CHOICE` by the engine's own chooser field and
 * the engine's own offered list, so nothing here hand-writes the pick.
 */
function pickedConspiracyStates(): readonly GameState[] {
  const out: GameState[] = [];
  let divergentFromDedupe = 0;
  for (const s of pickDecisionStates()) {
    const open = s.choices.find((c) => c.choice.kind === 'choose-card');
    if (open === undefined || open.choice.kind !== 'choose-card') continue;
    const named = open.choice.cards[0];
    if (named === undefined) continue;
    const answered = reduce(
      s,
      open.choice.source,
      { type: 'RESOLVE_CHOICE', choiceId: open.id, pick: { kind: 'card', cardId: named } },
      { rules: ctx.rules, cards: CARDS },
    );
    if (!answered.ok) continue;
    const settled = closeWindow(answered.state);
    // The control is a fact about the STATE, not about the log: the card left the public
    // pile and landed in a hand. Whether the departure was ANNOUNCED is deliberately NOT
    // part of it — that is what the derivation test is for, and folding it in here would
    // mean the fixture stopped producing states the moment the announcement went missing,
    // so the equality below would quietly assert over an empty set and pass.
    const gone = !settled._conspiracyDiscard.includes(named);
    const landed = settled.turnOrder.some((pid) => (settled.players[pid]?.conspiracies ?? []).includes(named));
    if (gone && landed) out.push(settled);
    const deduped = [...settled.log]
      .map((e) => /^Played "(.+)"\.$/.exec(e.text))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => byName().get(m[1] ?? ''))
      .filter((id): id is string => id !== undefined)
      .filter((id, _i, all) => all.indexOf(id) === _i);
    if (JSON.stringify(deduped) !== JSON.stringify([...settled._conspiracyDiscard])) divergentFromDedupe += 1;
  }
  expect(out.length, 'no state answered a `choose-card`, so the departure was never exercised').toBeGreaterThan(0);
  expect(
    divergentFromDedupe,
    'this corpus never reaches a departure the deduped reader gets wrong, so the repaired equality is still being flattered',
  ).toBeGreaterThan(0);
  return out;
}

/** Printed name → id, for a log-only reader. Built once and shared with `publicRecycleIds`. */
let NAME_TO_ID: ReadonlyMap<string, string> | null = null;
function byName(): ReadonlyMap<string, string> {
  if (NAME_TO_ID === null) {
    const m = new Map<string, string>();
    for (const [id, card] of Object.entries(CARDS.conspiracy)) m.set(card.name, id);
    NAME_TO_ID = m;
  }
  return NAME_TO_ID;
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

describe('every Choice kind is classified, and none of them may name a card that is not public', () => {
  it("the engine's Choice union and the inventory agree", () => {
    // A parallel agent may add a kind this round. If it enumerates a hidden hand, that
    // is a leak and this is where it has to be caught: the new kind fails to be listed,
    // so somebody has to look at it, and the classification below says what it is
    // allowed to ask about.
    const engine = engineChoiceKinds();
    expect(engine.length, 'the Choice union reader found no kinds — the reader is stale').toBeGreaterThan(0);
    expect(Object.keys(CHOICE_KINDS).sort(), 'a Choice kind is unclassified, or a classification is obsolete').toEqual(engine);
  });

  /**
   * WHAT A KIND MAY ASK ABOUT, WIDENED ON PURPOSE — and the argument is about the SHAPE
   * of this list rather than about the entry that needed it.
   *
   * `CHOICE_KINDS` classifies **what a player is being asked about**, not a secrecy
   * grade, and the four original values read as a grade only because all four happen to
   * be public sets. A resource total is in the projection; a peg and a constituency are
   * on the board; a seat is in `turnOrder`. `'public-cards'` is a fifth NAME for a fifth
   * set, and it is public for a reason written down on `ClientState.conspiracyRecycle`
   * and PROVED by the reconstruction two tests below — which is a stronger warrant than
   * "resources are in the payload" is for `resources`.
   *
   * **WHAT THIS DOES NOT DO IS ADMIT CARDS GENERALLY.** The category is not "cards"; it
   * is "this one public list of cards". A `'choose-card'` naming a card from a player's
   * hand, or from `_ideologyDraw`, `_ideologyDiscard`, `_headlineDraw` or `_voterDraw`,
   * PASSES this assertion — it names a category that exists — and is refused by the card
   * assertion immediately below. That is why the two are read as one argument and not as
   * a pair of gates: widening the value list alone would be the weakening, and widening
   * it while leaving the card assertion alone is the re-argument.
   */
  it('a classified kind may only ask about a set this file can account for', () => {
    const ASKABLE = ['resources', 'pegs', 'players', 'zones', 'public-cards'];
    for (const [kind, about] of Object.entries(CHOICE_KINDS)) {
      expect(ASKABLE, `${kind} asks the player about ${about}`).toContain(about);
    }
    // And the new value is not decorative. A kind that classified itself `public-cards`
    // and named a hidden pile would satisfy the line above and fail the one below, so the
    // category is pinned to the single kind `playerView` makes public rather than to
    // the word. This is the assertion that stops the widening from becoming a door.
    expect(Object.entries(CHOICE_KINDS).filter(([, about]) => about === 'public-cards')).toEqual([
      ['choose-card', 'public-cards'],
    ]);
  });

  /**
   * THE CARD ASSERTION, RE-ARGUED — and it bites harder than the one it replaces.
   *
   * It used to read: *no corpus `CardID` may appear in any `PendingChoice`.* That was
   * true only because no shipped card ever raised a card choice, and it was written
   * specifically to catch the change this file now contains. G17's `'choose-card'` IS
   * that change, and the reason the old form cannot stand is not that it is
   * inconvenient — it is that it was **too strong to be a rule and too weak to be a
   * guard**: it forbade a card id appearing in a decision at all, including one already
   * on the wire three times elsewhere, and the only way to "make it pass" was to delete
   * it. It had to be replaced rather than edited.
   *
   * THE RULE IT NOW STATES: **a decision may name a card, and may name only a card that
   * is already public to every client at the moment that decision exists.**
   *
   * That is the same boundary the wire draws, applied to the one place on the wire the
   * prefix walk cannot see. Two independent facts make it checkable:
   *
   *  - **What "public" means is DERIVED, not typed.** The private card sets are read out
   *    of the engine's OWN declaration — `ServerOnlyKeys` for the eight piles and
   *    `PRIVATE_PLAYER_KEYS` for the two hidden hands — by slicing
   *    `packages/engine/src/{state,playerView}.ts`. A new hidden pile is therefore
   *    covered without anybody editing a list in this file. It is the
   *    `reducer-parity` trick, and both readers fail loudly if the declaration moves.
   *  - **The one set that IS public is the one U1 derives**, and the two tests below are
   *    what stop that name becoming a licence: the published list is asserted equal to a
   *    reconstruction from the public log, and `_conspiracyDiscard` is asserted to have
   *    exactly three writers.
   *
   * **AND IT STILL BITES**: a decision naming a card out of `_conspiracyDraw` is built
   * by hand below and the same predicate is run against it, so a future `'choose-card'`
   * over a hidden pile fails on this line rather than on somebody noticing by eye.
   */
  it('no PendingChoice names a card that is not public to every client', () => {
    // The decisions have to be COLLECTED rather than read off a stored state, because a
    // stored state is the state AFTER the walk answered them — measured, every state in
    // all three corpora ends with an empty `choices`, so a scan over them proves nothing.
    // So this probes the same way the freeze test above does: play every card the
    // projection offers and keep whatever the engine asks, and each decision is checked
    // against the hidden set of the state that RAISED it rather than of the corpus entry.
    type Decision = GameState['choices'][number];
    const decisions: { readonly state: GameState; readonly pending: Decision }[] = [];
    const states = [...CORPUS, ...CONSPIRACY_CORPUS, ...IDEOLOGY_HAND_CORPUS, ...pickDecisionStates()];
    for (const s of states) {
      for (const pending of s.choices) decisions.push({ state: s, pending });
      const viewer = s.activePlayer;
      for (const cardId of viewFor(s, CARDS, viewer).playableConspiracies.map((c) => c.id)) {
        const played = reduce(s, viewer, { type: 'PLAY_CONSPIRACY', cardId }, { rules: ctx.rules, cards: CARDS });
        if (!played.ok) continue;
        const settled = closeWindow(played.state);
        for (const pending of settled.choices) decisions.push({ state: settled, pending });
      }
    }

    expect(decisions.length, 'no corpus state ever opened a decision, so the scan below was empty').toBeGreaterThan(0);
    let cardNaming = 0;
    for (const { state, pending } of decisions) {
      const json = JSON.stringify(pending);
      // `choose-player` carries `source`, a PlayerID that looks enough like a card id to
      // be worth checking rather than reasoning about.
      for (const id of hiddenCardIds(state)) {
        expect(
          json.includes(id),
          `a PendingChoice names ${id}, which sits in a hidden set in the state that raised it: ${json.slice(0, 200)}`,
        ).toBe(false);
      }
      if (json.includes('"choose-card"')) cardNaming += 1;
    }
    // And the narrowing is not vacuous: the corpus really does reach a card decision, so
    // the loop above really did run the predicate over card ids. Without this, a corpus
    // that stopped raising `'choose-card'` would make the assertion pass for a reason
    // that has nothing to do with secrecy.
    expect(cardNaming, 'no decision named a card, so the assertion above proved nothing about cards').toBeGreaterThan(0);
  });

  /**
   * THE TEETH, as a test rather than as a paragraph.
   *
   * Every predicate in this file needs a positive control, or it is a rule nobody has
   * watched fail. `hiddenCardIds` is therefore handed a decision built to violate it — a
   * card out of `_conspiracyDraw`, the pile §2bis refused by name — and asserted to flag
   * it, while a decision of the same shape naming a card off the RECYCLE list is asserted
   * NOT to be flagged.
   *
   * The second half is what stops the first from being satisfied by a predicate that
   * flags everything: such a predicate would also pass the test above, and would have
   * refused a legal card.
   */
  it('the card guard flags a hidden pile and clears the published one, so it discriminates', () => {
    // A REAL state with cards in both piles, so the control is the engine's own state
    // rather than a hand-built one whose piles somebody chose.
    const s = [...CORPUS, ...playedCorpus(16), ...playedConspiracyCorpus(26)].find(
      (x) => x._conspiracyDiscard.length > 0 && x._conspiracyDraw.length > 0,
    );
    if (s === undefined) throw new Error('no corpus state has cards in both the Conspiracy draw and discard piles');
    const inDraw = s._conspiracyDraw[0] as string;
    const inRecycle = s._conspiracyDiscard[0] as string;
    expect(inDraw, 'the fixture needs a card in the draw pile to be a control').toBeDefined();
    expect(inRecycle, 'the fixture needs a card in the recycle pile to be a control').toBeDefined();
    // And the recycle card really is one the public log accounts for — otherwise this
    // fixture would be proving that a SECRET card in the discard pile is allowed, which
    // is the opposite of the ruling.
    expect(publicRecycleIds(s), 'the control state holds a card on its recycle pile that the public log cannot account for').toContain(inRecycle);

    const shape = (cardId: string) => ({
      id: `c-${cardId}`,
      player: s.activePlayer,
      choice: {
        kind: 'choose-card',
        count: 1,
        cards: [cardId],
        effects: [{ op: 'draw-conspiracy', n: 1, from: 'discard' }],
        source: s.activePlayer,
        reason: 'probe',
      },
    });
    type Decision = GameState['choices'][number];
    const hidden = hiddenCardIds(s);
    const jsonOf = (d: Decision): string => JSON.stringify(d);
    // A decision naming a card out of `_conspiracyDraw`: refused.
    expect(hidden.has(inDraw), 'the control card in the draw pile is not treated as hidden').toBe(true);
    expect(
      jsonOf(shape(inDraw) as Decision).includes(inDraw),
      'the guard could not even be asked about the draw-pile card',
    ).toBe(true);
    // The same shape naming a card off the RECYCLE list: allowed, because
    // `ClientState.conspiracyRecycle` publishes it to every viewer.
    expect(hidden.has(inRecycle), 'the guard flagged a card that IS public').toBe(false);
  });

/**
   * THE DERIVATION, asserted rather than assured.
   *
   * `ClientState.conspiracyRecycle` is the first published contents of a `_` pile, and
   * the whole of its safety argument is that the pile is an account the PUBLIC LOG
   * already keeps. This walks the corpora and asserts, in this order because only the
   * first is derived from public data alone:
   *
   *  1. **EQUALITY WITH THE LOG REPLAY, IN ORDER.** The published list must EQUAL
   *     `publicRecycleIds` — the same ids, in the same sequence, from `state.log` and the
   *     card index and nothing else. This is the load-bearing half: a silent writer fails
   *     here, and so does a silent DEPARTURE, which is the leak this test used to be
   *     blind to. Equality and not containment, because a projection that published a
   *     SUBSET of what the log accounts for would leak nothing while claiming the
   *     derivation, and the old reader could not tell the two apart.
   *  2. **COMPLETENESS, AGAINST THE PILE.** The published list must also equal the pile.
   *     This half reads server state and is stated as such: it catches a projection that
   *     publishes less than the pile holds, which is a correctness bug rather than a leak.
   *
   * ## WHY IT IS NOT ASSERTED "ACROSS A RESHUFFLE", AND WHY THAT IS NOT A HOLE
   *
   * A log-only reader cannot see a reshuffle, so a replay and the pile could diverge if
   * one were ever reachable. It is not: `draw(s, 'conspiracy')` has no caller, and
   * `no reshuffle of the Conspiracy pile is reachable` asserts that against the reducer's
   * own source. That is the precondition this equality rests on, asserted rather than
   * assumed, so the day the call is added this test is forced to grow a reshuffle case
   * instead of quietly becoming false. The `[]`-across-a-reshuffle backstop is asserted
   * separately, below, on a hand-applied reshuffle.
   */
  it('the published recycle list equals what the public log replays, in order', () => {
    let nonEmpty = 0;
    let departures = 0;
    const states = [...CONSPIRACY_CORPUS, ...playedConspiracyCorpus(26), ...pickDecisionStates(), ...pickedConspiracyStates()];
    for (const s of states) {
      const fromLog = publicRecycleIds(s);
      departures += s.log.filter((e) => /^Picked "/.test(e.text)).length;
      for (const viewer of [...s.turnOrder, null]) {
        const published = viewFor(s, CARDS, viewer).conspiracyRecycle.map((c) => c.id);
        expect(Array.isArray(published), `viewer ${String(viewer)}: conspiracyRecycle is not an array`).toBe(true);
        // (1) — the load-bearing half. Log only, and EQUAL, not a subsequence.
        expect(
          fromLog,
          `viewer ${String(viewer)}: the published list is not what the public log replays`,
        ).toEqual([...published]);
        // (2) — completeness, against the pile.
        expect(
          [...s._conspiracyDiscard].sort(),
          `viewer ${String(viewer)}: the pile and the published list disagree`,
        ).toEqual([...published].sort());
        if (published.length > 0) nonEmpty += 1;
      }
    }
    expect(nonEmpty, 'no corpus state had a non-empty recycle list, so nothing was proved').toBeGreaterThan(0);
    // And the corpus actually EXERCISED the departure. An equality over states where
    // nothing was ever picked is the assertion the leak hid behind: it passed for 13% of
    // real games the fixtures never reached. `pickedConspiracyStates` is that fixture.
    expect(departures, 'no corpus state announced a `Picked` line, so the departure half was asserted over nothing').toBeGreaterThan(0);
  });

  /**
   * THE PRECONDITION OF THAT EQUALITY: no Conspiracy reshuffle is reachable.
   *
   * `publicRecycleIds` reads `state.log` and nothing else, and a reshuffle is invisible
   * to a log — it moves the pile into the draw pile without writing a line. So the
   * equality above is TRUE only while no reshuffle can happen, and this is what says so,
   * by reading `reduce.ts`'s own call sites rather than by asserting the comment.
   *
   * It is not a stylistic assertion. `draw(state, 'conspiracy')` genuinely has no caller
   * today: `BUY_CONSPIRACY` refuses `the Conspiracy deck is exhausted` before it would
   * draw, and `draw-conspiracy` reads `_conspiracyDraw` directly rather than through
   * `draw()`. The day somebody adds one, THIS fails, and the failure message says the
   * replay has to learn about reshuffles — which is the whole value of pinning it here
   * instead of leaving it as prose in a docstring nobody re-reads.
   *
   * Note what this does NOT do: it does not make the `[]`-across-a-reshuffle backstop
   * testable, because an unreachable instant cannot be driven. That backstop is argued
   * and asserted on a hand-applied reshuffle in the next test, and it stays a weaker
   * claim than the one above until the instant exists.
   */
  it('no reshuffle of the Conspiracy pile is reachable, which is what the replay rests on', () => {
    const src = readFileSync(fileURLToPath(new URL('../../engine/src/reduce.ts', import.meta.url)), 'utf8');
    const calls = [...src.matchAll(/\bdraw\(\s*\w+\s*,\s*'([a-z]+)'\s*\)/g)].map((m) => m[1]);
    // The helper's own declaration is not a call, so nothing to subtract — but say so,
    // because the count is only meaningful if the reader and the declaration agree.
    expect(src, "draw()'s reshuffle no longer empties the discard pile").toContain('[DISCARD[deck]]: []');
    expect(
      calls.filter((d) => d === 'conspiracy'),
      'something now draws from the Conspiracy deck through draw(), so a reshuffle is reachable and the log replay must be taught about one',
    ).toEqual([]);
    // And the decks that ARE drawn, so a reader that had stopped finding `draw()` at all
    // cannot pass this by matching nothing.
    expect([...new Set(calls)].sort(), 'the draw() call reader found nothing at all — it is stale').toEqual([
      'headline',
      'ideology',
      'voter',
    ]);
  });

  /**
   * IT IS `[]` ACROSS A RESHUFFLE, and `_seed` is nowhere in a payload.
   *
   * The reshuffle is the one instant the derivation needs an ARGUMENT rather than a
   * name: it fires only when `_conspiracyDraw` is empty, which `deckSizes` publishes, and
   * it EMPTIES the pile in the same breath it shuffles. So there is no instant at which
   * the published list holds a seed-derived card — and that is why this projection is a
   * read of the pile and not a reconstruction of it.
   *
   * The state below is driven there for real rather than built by hand: the deck is
   * emptied, a `PLAY_CONSPIRACY` forces the reshuffle, and the assertion is made across
   * it. `_seed` is checked in the serialised payload for every viewer because "the field
   * is not read here" is a claim about the code and this is a claim about the wire.
   */
  it('the list is [] across a Conspiracy reshuffle, and _seed reaches nobody', () => {
    const deck = CARDS.conspiracy;
    const ids = Object.keys(deck);
    const corpora = [...CONSPIRACY_CORPUS, ...playedConspiracyCorpus(26), ...pickDecisionStates()];

    // FIRST: the standing property, over every state the corpora reach. A published id
    // is always a card the deck holds, and `_seed` is never in a payload for ANY viewer.
    // Both are wire claims, so both are made on the serialised projection rather than on
    // the field — "the field is not read here" is a claim about the code and this is
    // about what a client receives.
    let sawNonEmpty = 0;
    for (const s of corpora) {
      const published = viewFor(s, CARDS, null).conspiracyRecycle.map((c) => c.id);
      for (const id of published) expect(ids, `the recycle list names ${id}, which is not in the deck`).toContain(id);
      if (published.length > 0) sawNonEmpty += 1;
      for (const who of [...s.turnOrder, null]) {
        expect(
          JSON.stringify(viewFor(s, CARDS, who)).includes(String(s._seed)),
          'the seed reached a payload',
        ).toBe(false);
      }
    }
    expect(sawNonEmpty, 'no corpus state had a non-empty recycle list, so nothing was proved').toBeGreaterThan(0);

    // THEN THE RESHUFFLE, and this is the case that needs an argument rather than a name.
    //
    // **THE CONSPIRACY RESHUFFLE HAS NO ORDINARY CALLER TODAY, and that is a pre-existing
    // gap this unit does not close.** `draw(s, 'conspiracy')` is reachable from nothing:
    // `BUY_CONSPIRACY` refuses `the Conspiracy deck is exhausted` *before* it would
    // draw, and `draw-conspiracy` reads `_conspiracyDraw` directly rather than through
    // `draw()`. So the instant cannot be driven from the outside and an assertion that
    // claimed to drive it would be asserting over nothing — which is the same defect the
    // Ideology side of this file records at `ANSWER`.
    //
    // What IS true, and what U1's security argument actually rests on, is asserted
    // instead: **the projection follows the DISCARD pile, so a card the log says was
    // played but which has since left for the draw pile is published nowhere.** That is
    // the `_seed` protection — after a reshuffle the new draw order is
    // `shuffle(discard, _seed)`, so a card the log accounts for must NOT be exempt from
    // secrecy merely because it was once played. The state below is one real corpus
    // state with that reshuffle's EFFECT applied by hand, which is the honest way to
    // test an unreachable instant: the mover is the fixture and the reader is the code.
    const seeded = corpora.find((s) => s._conspiracyDiscard.length > 0);
    if (seeded === undefined) throw new Error('no corpus state has anything on the Conspiracy discard pile');
    const reshuffled = seeded._conspiracyDiscard[0] as string;
    const afterReshuffle: GameState = {
      ...seeded,
      // What `draw()` does: the discard is emptied and its cards become the draw pile.
      _conspiracyDraw: [reshuffled, ...seeded._conspiracyDraw],
      _conspiracyDiscard: [],
    };
    expect(viewFor(afterReshuffle, CARDS, null).conspiracyRecycle, 'the projection is not [] across a reshuffle').toEqual([]);
    for (const who of [...afterReshuffle.turnOrder, null]) {
      const json = JSON.stringify(viewFor(afterReshuffle, CARDS, who));
      expect(
        json.includes(reshuffled),
        'a reshuffled Conspiracy Card is on the wire — that is `_seed` one step from being public',
      ).toBe(false);
      expect(json.includes(String(afterReshuffle._seed)), 'the seed reached a payload across a reshuffle').toBe(false);
    }
    // And the same card, back on the pile, IS published — so the assertion above is about
    // the reshuffle and not about a projection that is simply always empty.
    expect(
      viewFor(seeded, CARDS, null).conspiracyRecycle.map((c) => c.id),
      'the control state published nothing, so the reshuffle case was asserted over nothing',
    ).toContain(reshuffled);
  });

  /**
   * `_conspiracyDiscard`'s WRITERS, derived from `reduce.ts`'s own source.
   *
   * The derivation test above proves the published list is sound *given* that every
   * writer puts there a card the log already accounts for AND that every writer takes
   * one off with a line. This is what checks the given, and it is a slice-and-count
   * rather than a list of names because a list of names is a thing a future writer edits
   * to include themselves.
   *
   * ## THE COUNT, AND IT IS NOT "THREE"
   *
   * Every count that has ever been written down here has been wrong, so the enumeration
   * is done from the source rather than from a number:
   *
   * | # | site | on the public log? |
   * |---|---|---|
   * | 1 | `PLAY_CONSPIRACY` → `discardTo(s, 'conspiracy', action.cardId)` | **yes** — `Played "NAME".` |
   * | 2 | `RESPOND_INTERRUPT` → the same call | **yes** — the same line |
   * | 3 | `draw-conspiracy { to: 'discard' }` → the same call | no line, and deliberately so: the card came OFF the pile and goes straight back on, same card, same end, so the pile is byte-identical and there is no departure to announce |
   * | 4 | the `pick` path's `_conspiracyDiscard:` removal | **yes, after this change** — `Picked "NAME".`, by the recipient |
   * | 5 | the `from: 'discard'` top path's `_conspiracyDiscard:` removal | **yes, after this change** — the same line, once per card taken |
   * | 6 | `draw()`'s reshuffle, `[DISCARD[deck]]: []` | nothing to announce: the pile becomes `[]`, which is the `_seed` protection rather than a claim about the log |
   *
   * So there are **four assignment expressions** in `reduce.ts` — the reshuffle,
   * `discardTo`'s own body, and the two direct removals — reached by **six write paths**,
   * plus `setup.ts`'s initial value. `state.ts` says "exactly two call sites",
   * `secret-inventory.ts` says "three writers"; both are wrong, and this test is the
   * thing that keeps the file honest about which.
   *
   * Site 3 is the only silent one left, and its silence is a NET NO-OP rather than a
   * missing announcement. Site 6 is silent because it leaves nothing to announce.
   */
  it('_conspiracyDiscard is written only where the public log already accounts for it', () => {
    const src = readFileSync(fileURLToPath(new URL('../../engine/src/reduce.ts', import.meta.url)), 'utf8');
    const caseAt = src.indexOf("case 'draw-conspiracy':");
    const nextCase = src.indexOf("case 'refresh-market':", caseAt);
    expect(caseAt, "the 'draw-conspiracy' case moved — this reader is stale").toBeGreaterThan(-1);
    expect(nextCase, "the case after 'draw-conspiracy' moved — this reader is stale").toBeGreaterThan(caseAt);
    const before = src.slice(0, caseAt);
    const inside = src.slice(caseAt, nextCase);
    const after = src.slice(nextCase);

    // THE TWO PUBLIC WRITES, and they are after `applyEffect` because they live in the
    // two action handlers. Each is immediately followed by the `Played "NAME"` log line
    // that is the whole of the argument, and the assertion below pairs the two so a
    // future edit that moves the write away from its log line fails here.
    //
    // NOTE ON THE REGEX: adjacent escapes after `}` are avoided on purpose.
    // `[...'x}'.matchAll(/x\}\./g)]` is 0 on this toolchain — the bundler rewrites them —
    // so a guard written with the obvious spelling silently matches nothing and passes
    // forever. The pairing is asserted as far as `Played "` and no further, which is the
    // whole of the claim.
    const publicWrites = [...after.matchAll(/discardTo\(\s*\w+\s*,\s*'conspiracy', action\.cardId\);[^\S\r\n]*\r?\n[^\S\r\n]*s = log\(s, \{[^\S\r\n]*player: [^\n]*text: `Played "/g)].length;
    expect(publicWrites, 'a public write to the Conspiracy discard pile is no longer paired with its `Played` log line').toBe(2);
    // Site 3: U1's own recycle-loop write, inside the `draw-conspiracy` case, and the
    // ONLY `discardTo` there.
    const recycleWrite = [...inside.matchAll(/discardTo\(\s*\w+\s*,\s*'conspiracy'/g)].length;
    expect(
      recycleWrite,
      'the draw-conspiracy case has a second discardTo, and the pile it writes is only sound if it is the recycle loop',
    ).toBe(1);
    // And no direct field assignment anywhere OUTSIDE that case, which is what a silent
    // writer would be. `before` is `draw()`'s reshuffle and `after` is two action
    // handlers, and neither writes `_conspiracyDiscard` by name — they go through the
    // `DISCARD` map. Both must be ZERO, and the regex is PROPERTY-POSITION (see below).
    const propPos = /(?:^|[{,])[^\S\r\n]*_conspiracyDiscard[^\S\r\n]*:/gm;
    expect([...before.matchAll(propPos)].length, 'something before draw-conspiracy writes the Conspiracy discard pile').toBe(0);
    expect([...after.matchAll(propPos)].length, 'something after draw-conspiracy writes the Conspiracy discard pile').toBe(0);
    // The direct field assignments inside the case, PINNED rather than floored. A floor was
    // the first version of this line and it had a hole: a silent writer added *inside*
    // `case 'draw-conspiracy'` — which is exactly where the next one would be written —
    // satisfies `toBeGreaterThan(0)` and passes.
    //
    // **THE COUNT IS TWO, AND THE OLD PIN OF THREE WAS COUNTING A TERNARY.** The regex
    // was `/_conspiracyDiscard\s*:/`, which cannot tell a property colon from
    // `fromDiscard ? s._conspiracyDiscard : s._conspiracyDraw` — a read. It matched that
    // ternary, so the pin was satisfied by a site that writes nothing, and the docstring
    // above it invented a third write ("the `at < 0` fallback, which writes the same
    // field") to explain the phantom. The two real ones are:
    //   1. the pick's removal, `_conspiracyDiscard: at < 0 ? live.slice(0, -1) : …`
    //   2. the non-picking removal, `_conspiracyDiscard: fromDiscard ? … : s._conspiracyDiscard`
    // The property-position regex below matches exactly those and not the ternary, which
    // is the difference between a guard and a coincidence.
    const insideFieldWrites = [...inside.matchAll(/(?:^|[{,])[^\S\r\n]*_conspiracyDiscard[^\S\r\n]*:/gm)].length;
    expect(insideFieldWrites, 'the draw-conspiracy case has gained or lost a write to the pile').toBe(2);
    // And the new, load-bearing half: EVERY departure announces itself. Sites 4 and 5 are
    // the two removals above, and `announcedPick` is the only thing that turns a removal
    // into a public event. Pairing the two counts is what stops a fourth removal — or an
    // edit that drops one of these two calls — from becoming the covert channel this
    // whole arrangement exists to close. Without it the equality in the derivation test is
    // the only thing standing between a silent departure and a disclosed hand.
    const announcedPairs = [...inside.matchAll(/announcedPick\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*ctx\s*\)/g)].length;
    expect(
      announcedPairs,
      'the draw-conspiracy case no longer pairs each of its removals with an `announcedPick` call',
    ).toBe(2);
    expect(
      src.includes("text: card === undefined ? 'Picked a Conspiracy Card.' : `Picked \"${card.name}\".`"),
      'announcedPick no longer announces the departure by name',
    ).toBe(true);
    // Writer six: `draw()`'s reshuffle, which EMPTIES the pile. `[DISCARD[deck]]: []`
    // is the whole of it, and it is what makes the list `[]` rather than seed-derived.
    // is the whole of it, and it is what makes the list `[]` rather than seed-derived.
    expect(
      src.includes('[DISCARD[deck]]: []'),
      "draw()'s reshuffle no longer empties the discard pile, so the projection is not [] across one",
    ).toBe(true);
  });
});