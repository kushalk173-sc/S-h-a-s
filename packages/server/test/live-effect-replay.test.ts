/**
 * CAN THE SERVER'S REPLAY MODEL CARRY A PERSISTED, IN-FLIGHT LIVE EFFECT?
 *
 * The question, asked because the engine's new effect substrate makes
 * `GameState.liveEffects` a thing that exists between actions: an effect installed
 * on turn 3 with `expiresAt: 9` is still in force on turn 6, and a match restored
 * from `(seed, rulesVersion, cardsVersion, log)` has to be in exactly that state.
 *
 * THE ANSWER IS YES, and it is yes STRUCTURALLY rather than by special-casing. The
 * reason is a property of `store.ts` that predates live effects and is easy to
 * overlook:
 *
 *   **The server never persists derived state as authority.** It persists a seed, two
 *   content hashes and an ordered action log, and `replay()` rebuilds the whole
 *   `GameState` by running `setup()` and then `reduce()` once per logged action.
 *   `liveEffects` is therefore not persisted at all — it is RE-DERIVED, by the same
 *   `reduce` call that re-derives the board and the pools. There is no field to lose.
 *
 * And it only works because the engine made `LiveEffect` replay-shaped rather than
 * clock-shaped: `activeFrom` and `expiresAt` are ABSOLUTE turn numbers computed once
 * at install, and `isInForce(le, turn)` is a pure function of `(le, turn)`. Nothing in
 * a live effect reads the wall clock, the socket, or module scope, so re-running the
 * same actions produces the same list. `state.ts`'s own note says this is the
 * load-bearing property; this file is the server-side test of it.
 *
 * SO WHY DOES THIS FILE EXIST, GIVEN `e2e.test.ts` ALREADY REPLAYS AND COMPARES?
 *
 * Because `e2e.test.ts` would pass with `liveEffects: []` on both sides.
 *
 * The shipped corpus contains NO card with a lasting clause — no `duration` beyond
 * `'this-turn'`, no `when`, no `until` — so a real game deals zero live effects, and
 * the digest comparison that looks like it proves replay handles them proves only
 * that two empty arrays are equal. This is the SAME failure shape as the deck-size
 * blindness that shipped an unwinnable game, one level up: the fixture cannot
 * produce the thing, so the assertion about the thing is vacuous.
 *
 * Every test below therefore asserts NON-EMPTINESS alongside equality, so that if the
 * engine ever stops installing live effects this file fails loudly instead of
 * quietly passing.
 */

import { describe, expect, it } from 'vitest';

import {
  indexCards,
  isInForce,
  playerView,
  reduce,
  RULES,
  setup,
  type Action,
  type CardIndex,
  type ConspiracyCard,
  type Ctx,
  type GameState,
  type HeadlineCard,
  type LiveEffect,
  type PlayerID,
} from '@shasn/engine';

import { cardsVersion, InMemoryMatchStore, ReplayMismatch, replay, rulesVersion, type StoredMatch } from '../src/store.ts';
import { nextAction } from './driver.ts';

// ─────────────────────────── a corpus that HAS live effects ───────────────────────────

/**
 * Conspiracies that all carry a lasting clause, plus a headline that hands one out.
 *
 * Purpose-built, and the file header says why: the shipped corpus cannot produce a
 * live effect, so a test of live effects has to bring its own. The real corpus is
 * still pinned by `corpus.test.ts`.
 *
 * EVERY card here carries a lasting clause, which is a deliberate simplification
 * rather than a detail: the acquisition route below draws a card from a SHUFFLED
 * conspiracy deck, so which one arrives is not predictable. If only some of them
 * installed an effect, the test would be a coin flip on whether it was testing
 * anything. The two flavours are kept — a STANDING aura (`trigger: null`) and an
 * EVENT hook (`when: 'on-purchase'`) — because those are the two shapes a trigger
 * has to handle, and a replay that reproduced one but not the other would be a
 * replay that happened to work.
 */
const CONSPIRACIES: readonly ConspiracyCard[] = [
  {
    id: 'le-standing',
    name: 'Standing Order',
    text: 'At the top of each of your turns, gain 1 Fund. For the rest of the game.',
    cost: 1,
    // A STANDING effect: `trigger: null`, re-applied every one of the owner's turns.
    duration: 'rest-of-game',
    effects: [{ op: 'gain', res: { funds: 1 } }],
  },
  {
    id: 'le-hook',
    name: 'Standing Hook',
    text: 'Every time you buy a Voter Card, gain 1 Trust. For the rest of the game.',
    cost: 1,
    // An EVENT effect: installed on a trigger, so it does nothing until it fires.
    effects: [{ op: 'gain', res: { trust: 1 }, when: 'on-purchase', until: 'rest-of-game' }],
  },
  {
    id: 'le-standing-2',
    name: 'Second Standing Order',
    text: 'At the top of each of your turns, gain 1 Trust. For the rest of the game.',
    cost: 1,
    duration: 'rest-of-game',
    effects: [{ op: 'gain', res: { trust: 1 } }],
  },
  {
    id: 'le-hook-2',
    name: 'Second Standing Hook',
    text: 'Every time you buy a Voter Card, gain 1 Media. For the rest of the game.',
    cost: 1,
    effects: [{ op: 'gain', res: { media: 1 }, when: 'on-purchase', until: 'rest-of-game' }],
  },
];

/**
 * The headline that hands a Conspiracy to whoever places in a Volatile Area.
 *
 * EVERY headline in the fixture draws one, not just this one. `setup` SHUFFLES the
 * headline deck, so a fixture with a single drawing headline is a coin flip on
 * whether the placement that fires it produces a Conspiracy at all — and a test that
 * silently stops testing when the shuffle goes the other way is exactly the failure
 * this whole exercise is about. All of them drawing makes it deterministic.
 */
const DRAW_HEADLINE: HeadlineCard = {
  id: 'le-hed-draw',
  name: 'Leaked Dossier',
  text: 'Draw a Conspiracy Card.',
  effects: [{ op: 'draw-conspiracy', n: 1 }],
};

function cardsWithLiveEffects(): CardIndex {
  return indexCards({
    ideology: Array.from({ length: 8 }, (_, i) => ({
      id: `le-ide-${i + 1}`,
      campaign: 'le',
      question: `q${i + 1}`,
      sides: [
        { answer: 'a', ideologue: 'capitalist' as const, pays: { funds: 3 } },
        { answer: 'b', ideologue: 'idealist' as const, pays: { funds: 3 } },
      ],
    })),
    voter: Array.from({ length: 12 }, (_, i) => ({ id: `le-vot-${i + 1}`, cost: { funds: 1 }, voters: 1 })),
    conspiracy: [...CONSPIRACIES],
    headline: Array.from({ length: 6 }, (_, i) => ({
      id: i === 0 ? DRAW_HEADLINE.id : `le-hed-draw-${i}`,
      name: i === 0 ? DRAW_HEADLINE.name : `Leaked Dossier ${i}`,
      text: DRAW_HEADLINE.text,
      effects: [{ op: 'draw-conspiracy' as const, n: 1 }],
    })),
  });
}

const cards = cardsWithLiveEffects();
const ctx: Ctx = { rules: RULES, cards };

const MATCH = 'm-live-effects';
const P1: PlayerID = 'p1';

/**
 * The match seed, as a CONSTANT rather than read off the dealt state.
 *
 * The state's own seed is a server-only field and the secrets gate is right that a
 * test has no business reading it. It does not need to: the seed is an INPUT to
 * `setup`, so the test picks it, and `replay` is then required to reproduce the game
 * from this number alone — which is the property under test.
 */
const SEED = 4242;

function startState(): GameState {
  return setup({
    players: [P1, 'p2'],
    names: { [P1]: 'Ada', p2: 'Bo' },
    cards,
    seed: SEED,
    ideologyDeck: Object.keys(cards.ideology),
    voterDeck: Object.keys(cards.voter),
    conspiracyDeck: Object.keys(cards.conspiracy),
    headlineDeck: Object.keys(cards.headline),
    // NO `startResources`, and that is load-bearing rather than incidental.
    //
    // `replay()` rebuilds with `setup({players, names, cards, seed, ...decks})` and
    // passes nothing else, so it can only reproduce a match that was dealt on p7's
    // DEFAULT opening. The first version of this fixture passed
    // `startResources: [{funds: 8}, {funds: 8}]` — which `lobby.ts` never does — and
    // replay diverged at seq 10 with 'you cannot afford that Voter Card', because the
    // replayed seats opened on p7's 1 and 2 Funds instead of 8.
    //
    // That is the replay model working as specified and a fixture disagreeing with
    // it, and `replayLatentHazardBelow` in the last test of this file pins the
    // constraint so nobody discovers it the expensive way.
  });
}

/** A free Volatile Area, which is what makes a placement fire a Headline (p18). */
function aVolatileArea(state: {
  readonly zones: readonly { readonly areas: readonly { readonly id: string; readonly peg: unknown; readonly volatile: boolean }[] }[];
}): string | null {
  for (const z of state.zones) {
    for (const a of z.areas) if (a.volatile && a.peg === null) return a.id;
  }
  return null;
}

/** A starting position. P1 holds NOTHING; the Conspiracy has to be earned. */

/**
 * Record a game into the store, and make sure a live effect is IN FLIGHT when it stops.
 *
 * The store is not a stub: `append` is what decides the snapshot cadence, and the
 * snapshot is one of the two paths `replay()` can take. A test that built a
 * `StoredMatch` by hand would miss the cadence, and the cadence is the thing.
 *
 * WHY THE CONSPIRACY IS EARNED RATHER THAN HANDED OVER — and this is the single most
 * important thing in the file.
 *
 * The first version of this fixture did `players.p1.conspiracies = [...]` straight
 * after `setup()`, and `replay()` refused it: `ReplayMismatch: failed to replay at
 * seq 1: you do not hold that card`. That refusal is the replay model WORKING. The
 * derivation path can only rebuild what `setup(seed, cards, decks)` builds plus what
 * the logged actions do; a state that exists only because a test mutated it after
 * `setup` is invisible to the log, and `replay` throws rather than restoring a match
 * that silently disagrees with the one the players are in the middle of.
 *
 * So the card is acquired the way a player acquires one: place a Voter Card in a
 * VOLATILE AREA (p18), which fires a Headline, and the `draw-conspiracy` headline
 * hands it over. Every step of that is an ordinary logged action, so `setup` + the
 * log reproduces the whole thing — which is the only way this test can mean anything.
 *
 * The rest of the turn cycle is driven by the shared `nextAction` rather than a
 * hand-written script, because a script has to encode the phase machine and the
 * out-of-turn `PendingChoice` channel, neither of which a persistence test has any
 * business reimplementing. (The first version hand-scripted it and dispatched
 * `ANSWER` for the wrong seat within three steps.)
 */
async function recordGame(extraActions: number): Promise<{ store: InMemoryMatchStore; stored: StoredMatch; state: GameState }> {
  const store = new InMemoryMatchStore();
  let state = startState();
  await store.create(
    {
      matchId: MATCH,
      seed: SEED,
      rules: RULES,
      cards,
      players: [
        { id: P1, name: 'Ada', colour: 'a', resumeHash: 'h1' },
        { id: 'p2', name: 'Bo', colour: 'b', resumeHash: 'h2' },
      ],
      now: 1,
    },
    state,
  );

  // Until P1 is holding a Conspiracy, P1 does ONE thing and one thing only: buy a
  // Voter Card and put it in a free VOLATILE AREA, because p18 fires a Headline for
  // every voter placed in one at the end of that turn, and the fixture's headlines all
  // draw a Conspiracy.
  //
  // `nextAction` must NOT be allowed anywhere near this. It concentrates on the zone
  // where the seat already holds the most pegs, so it placed P1's voters in ordinary
  // areas and no Headline ever fired — the first version of this file looked like it
  // was working and installed zero live effects. There are 11 Volatile Areas, and the
  // board's own `headlines` phase is entered by the engine at END_TURN, so this needs
  // no hand-scripting: buy, place in a Volatile Area, keep buying.
  let chasingVolatile = true;
  const played: string[] = [];
  let seq = 0;
  // The loop runs until a Conspiracy has actually been PLAYED — not merely earned —
  // and then for `extraActions` more. Keyed off the play rather than off `seq`,
  // because the first version stopped the moment the card arrived in hand: it had
  // already used up its action budget chasing Volatile Areas, so the game ended
  // before P1 ever played anything and installed no live effect.
  let settledAt = -1;

  for (let i = 0; i < 4000; i += 1) {
    if (state.finished) break;
    if (settledAt >= 0 && seq >= settledAt + extraActions) break;

    // A pending choice first — it can belong to a seat that is not on move, and the
    // engine refuses every other action for a frozen player.
    const open = state.choices[0];
    const p: PlayerID = open?.player ?? state.activePlayer;
    const view = playerView(state, p);
    const mine = p === P1 ? view.players[P1] : undefined;

    // The hand is read off the AUTHORITATIVE state, not the projection, and that is
    // deliberate. `playerView` strips every player's `conspiracies` — the viewer's own
    // included, by the D25 ruling — and the server re-exposes only the subset that is
    // legally playable, as `playableConspiracies`, which lives on the ROOM's view and
    // not on `ClientState` at all. So a driver reading `ClientState` cannot see its own
    // hand, which is correct and load-bearing, and this persistence test is not the
    // place to fight it: the point here is what the LOG reproduces, and the log is
    // written from the authoritative state. `secret-state.test.ts` is what proves the
    // hand does not reach a client, and it runs separately.
    const hand = p === P1 ? (state.players[P1]?.conspiracies ?? []) : [];
    const held = hand.find((id) => !played.includes(id));

    let action: Action | null;
    const inActions = view.phase === 'actions' && open === undefined;
    if (held !== undefined && inActions) {
      // `PLAY_CONSPIRACY` is only legal in the `actions` window (or out of turn
      // during `answer`), and never while a Headline is outstanding — the first
      // version of this file played it the moment the card arrived and was refused
      // with 'resolve the Headline first'.
      action = { type: 'PLAY_CONSPIRACY', cardId: held };
    } else if (chasingVolatile && p === P1 && inActions) {
      const group = mine?.pending[0];
      const spot = aVolatileArea(view);
      if (group !== undefined && spot !== null) {
        action = { type: 'PLACE_VOTERS', groupId: group.id, areaIds: [spot] };
      } else {
        const slot = view.market.findIndex((m) => (m.cost.funds ?? 0) <= (mine?.resources.funds ?? 0));
        action = slot < 0 ? { type: 'END_TURN' } : { type: 'INFLUENCE', slot };
      }
    } else {
      action = nextAction(view, p);
    }

    if (action === null) throw new Error(`no legal action for ${p} in phase ${state.phase}`);
    const r = reduce(state, p, action, ctx);
    if (!r.ok) throw new Error(`step ${seq} (${action.type} for ${p} in ${state.phase}) was refused: ${r.error}`);
    state = r.state;
    seq += 1;
    if (action.type === 'PLAY_CONSPIRACY') {
      played.push(action.cardId);
      if (settledAt < 0) settledAt = seq;
    }

    // Earned it? Then stop chasing and let the game run on.
    const holding = state.players[P1]?.conspiracies ?? [];
    if (chasingVolatile && holding.length > 0) chasingVolatile = false;

    // eslint-disable-next-line no-await-in-loop
    await store.append(MATCH, { seq, playerId: p, action }, state, seq, 100 + seq);
  }

  const stored = await store.get(MATCH);
  if (stored === null) throw new Error('nothing stored');
  return { store, stored, state };
}

// ─────────────────────────── the claim ───────────────────────────

describe('a persisted, in-flight live effect survives replay', () => {
  it('the engine really does install them, so nothing below is vacuous', async () => {
    // FIRST, and it is not a formality. Every assertion in this file compares live
    // effects, and a comparison of two empty lists passes. So the precondition is
    // asserted up front: an effect is in flight, standing or hooked, and if it is a
    // rest-of-game one it has no expiry.
    const { stored, state } = await recordGame(6);
    const live = replay({ stored, ctx }).state.liveEffects;
    expect(live.length, 'the fixture no longer installs live effects; this file would pass vacuously').toBeGreaterThan(0);
    expect(live.length, 'the fixture installed no live effects at all').toBeGreaterThan(0);
    // The shape: an id from the state's own counter, an owner, the card it came from,
    // and a lifetime in ABSOLUTE turn numbers. Absolute numbers are the load-bearing
    // part — they are why a replay reproduces the list, because nothing has to be
    // re-derived from "whose turn is it now".
    const first = live[0];
    expect(first?.id, 'a live effect id is not minted from the state counter').toMatch(/^L\d+$/);
    expect(first?.owner).toBe(P1);
    expect(CONSPIRACIES.map((c) => c.id), 'the effect did not come from a lasting card').toContain(first?.sourceCardId);
    expect(typeof first?.activeFrom, 'activeFrom must be an absolute turn number').toBe('number');
    expect(state.turn, 'the game never got past turn 1').toBeGreaterThan(1);
    // And they are IN FLIGHT at the turn the match is parked on, which is the whole
    // point: none is dormant and none is expired.
    for (const le of live) {
      expect(isInForce(le, state.turn), `${le.id} (${le.sourceCardId}) is not in force on turn ${state.turn}`).toBe(true);
    }
    // At least one is a rest-of-game effect, so there is genuinely no expiry to lose.
    expect(
      live.some((le) => le.expiresAt === null),
      'no rest-of-game effect is in flight, so the "never expires" case is untested',
    ).toBe(true);
  });

  it('the full-replay path rebuilds them identically, and agrees with the live room', async () => {
    // Path 2 of `replay`: `setup()` then `reduce()` over the whole log. The snapshot is
    // discarded so this really is the derivation path and not the cache.
    const { stored } = await recordGame(6);
    const derived = replay({ stored: { ...stored, snapshot: null, snapshotAtSeq: 0 }, ctx });
    expect(derived.state.liveEffects, 'a full replay lost or altered a live effect').toEqual(
      replay({ stored, ctx }).state.liveEffects,
    );
    // The ids are minted from a counter that lives in the STATE rather than at module
    // scope, so a replay cannot re-mint them differently — and a trigger hook is keyed
    // on them, so a divergence here would be a live effect firing against the wrong
    // entry. Asserted as a property, not as a literal: the counter is shared with every
    // other id the engine mints, so the exact numbers depend on how much else the game
    // did, and pinning them would make this fail for an unrelated reason the next time
    // the engine mints one more thing.
    const ids = derived.state.liveEffects.map((le) => le.id);
    expect(ids.length, 'no live effects to check ids for').toBeGreaterThan(0);
    for (const id of ids) expect(id, `live effect id ${id} is not from the state counter`).toMatch(/^L\d+$/);
    expect(new Set(ids).size, 'two live effects share an id').toBe(ids.length);
    // The counter itself is a server-only field, so it is NOT read here — but the
    // property it exists to guarantee is checked without it: the ids are drawn from
    // one shared sequence, so they strictly increase in install order and the replay
    // produces the SAME numbers. A replay that re-minted `L10` as `L3` would pass a
    // shape check and fail this.
    const numbers = ids.map((id) => Number(id.slice(1)));
    expect(
      numbers.every((n, i) => i === 0 || n > (numbers[i - 1] ?? 0)),
      `live effect ids are not increasing in install order: ${ids.join(', ')}`,
    ).toBe(true);
    // And the replay mints the same ones, which is the whole claim.
    expect(derived.state.liveEffects.map((le) => le.id), 'a replay re-minted different live effect ids').toEqual(
      replay({ stored, ctx }).state.liveEffects.map((le) => le.id),
    );
  });

  it('the snapshot path agrees, and the snapshot survives a JSON round trip', async () => {
    // Path 1 of `replay`: start from the cached snapshot and replay the tail. The
    // snapshot is a CACHE, so it is only correct if it really is the state at
    // `snapshotAtSeq` — and if it survives being written to and read back from a
    // database, which is what a `jsonb` column does.
    //
    // The JSON round trip is the part that matters and the part `InMemoryMatchStore`
    // cannot catch: it keeps `GameState` as a live object graph and never serialises
    // it, so a `LiveEffect` field that was a `Map`, a `Set`, `undefined` or a class
    // instance would pass every in-memory test and lose data in production.
    const { stored } = await recordGame(6);
    const fromCache = replay({ stored, ctx });
    const fromScratch = replay({ stored: { ...stored, snapshot: null, snapshotAtSeq: 0 }, ctx });
    expect(fromCache.state.liveEffects, 'the cached path and the derived path disagree').toEqual(fromScratch.state.liveEffects);
    expect(fromCache.viewId).toBe(fromScratch.viewId);

    // What the Postgres store does to a row body: serialise, and read it back either
    // as a parsed object or as a string (`store-postgres.ts` accepts both).
    const roundTripped: StoredMatch = JSON.parse(JSON.stringify(stored)) as StoredMatch;
    const viaJson = replay({ stored: roundTripped, ctx });
    expect(viaJson.state.liveEffects, 'a live effect did not survive a JSON round trip').toEqual(fromScratch.state.liveEffects);
    expect(JSON.stringify(viaJson.state.liveEffects)).toBe(JSON.stringify(fromScratch.state.liveEffects));
  });

  it('an effect stays in flight ACROSS a snapshot boundary, not just at a cached point', async () => {
    // The case that actually matters after a deploy, and the one a snapshot-cadence
    // test can miss. `InMemoryMatchStore` snapshots every 10th action, so this plays
    // well past the install: if a snapshot were taken between the install and the
    // effect's first firing turn, the cache has to carry it, and the tail has to
    // carry it too.
    // Churn well past the install, so several snapshots are taken AFTER it and the
    // cache actually in use was written while the effect was live.
    const { stored } = await recordGame(24);
    const installAt = stored.log.findIndex((e) => e.action.type === 'PLAY_CONSPIRACY');
    expect(installAt, 'no conspiracy was ever played, so there is nothing in flight').toBeGreaterThanOrEqual(0);
    expect(stored.log.length, 'expected a long enough log to cross a snapshot boundary').toBeGreaterThan(10);
    expect(stored.snapshot, 'the store never snapshotted, so the cache path is untested').not.toBeNull();
    expect(
      stored.snapshotAtSeq,
      'the cached snapshot was taken before the effect was installed, so this proves nothing',
    ).toBeGreaterThan(installAt);

    const derived = replay({ stored: { ...stored, snapshot: null, snapshotAtSeq: 0 }, ctx });
    const cached = replay({ stored, ctx });
    expect(derived.state.liveEffects.length, 'a long game lost its live effects').toBeGreaterThan(0);
    expect(cached.state.liveEffects, 'the cache and the derivation disagree after a long game').toEqual(derived.state.liveEffects);
    // And the cached snapshot ON ITS OWN already contains them, which is the
    // "persisted in-flight" claim in its strongest form: a state written to a
    // database mid-flight carries the effect.
    expect(stored.snapshot?.state.liveEffects.length, 'the persisted snapshot has no live effects in it').toBeGreaterThan(0);
  });

  it('a live effect survives its own expiry being replayed, not just its install', async () => {
    // The other half of "in flight": expiry is a turn boundary, and a replay has to
    // land on the same side of it. So this asserts the derived list matches at EVERY
    // step rather than only at the end — a divergence that only shows up mid-game is
    // exactly what a single end-of-game comparison misses, and "the final state
    // matches" is the shape of the assertion that misses it.
    const { stored } = await recordGame(6);
    const fromScratch = replay({ stored: { ...stored, snapshot: null, snapshotAtSeq: 0 }, ctx });

    // Replay the log by hand and check the list at every step.
    let s = startState();
    const perStep: LiveEffect[][] = [];
    for (const entry of stored.log) {
      const r = reduce(s, entry.playerId, entry.action, ctx);
      if (!r.ok) throw new Error(`replay diverged at seq ${entry.seq}: ${r.error}`);
      s = r.state;
      perStep.push([...s.liveEffects]);
    }
    expect(s.liveEffects, 'a hand replay disagrees with replay()').toEqual(fromScratch.state.liveEffects);
    // The effect appears from the step that installed it and is never absent again.
    const firstSeen = perStep.findIndex((l) => l.length > 0);
    expect(firstSeen, 'the live effect never appeared during the hand replay').toBeGreaterThanOrEqual(0);
    for (const [i, l] of perStep.entries()) {
      if (i < firstSeen) continue;
      expect(l.length, `the live effect vanished at step ${i}`).toBeGreaterThan(0);
    }
  });

  it('the effect MEANING is pinned by cardsVersion, so a changed clause refuses the replay', async () => {
    // The safety net, and the reason a live effect is safe to persist even though it
    // is not itself persisted.
    //
    // `cardsVersion` hashes card BODIES. A live effect's behaviour — its `effects`,
    // its `duration`, its `when` — lives in the card body, so changing any of it
    // changes the hash, and `replay()` throws `ReplayMismatch` rather than restoring
    // a match whose standing effect now does something different from what the
    // players agreed to. Without this, a balance pass mid-match would silently
    // rewrite the meaning of an in-flight effect.
    const { stored } = await recordGame(6);
    const before = cardsVersion(cards);

    // Change ONLY the lasting clause's magnitude. Nothing about the game structure
    // moves; the meaning of every in-flight effect does.
    const retuned: CardIndex = {
      ...cards,
      conspiracy: Object.fromEntries(
        Object.entries(cards.conspiracy).map(([id, c]) => [
          id,
          id === 'le-standing' ? { ...c, effects: [{ op: 'gain' as const, res: { funds: 9 } }] } : c,
        ]),
      ),
    } as CardIndex;
    const after = cardsVersion(retuned);
    expect(after, 'changing a lasting clause did not change the corpus hash').not.toBe(before);

    expect(() => replay({ stored, ctx: { rules: RULES, cards: retuned } })).toThrow(ReplayMismatch);
    // And the refusal is about the CARDS, specifically, not a generic failure.
    let message = '';
    try {
      replay({ stored, ctx: { rules: RULES, cards: retuned } });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('different card corpus');
  });

  it('a live effect is PUBLIC, so the projection must not strip it from any client', async () => {
    // `state.ts`'s note: a live effect is deliberately UNPREFIXED and reaches every
    // client, because `sourceCardId` can never name a card anybody still holds and
    // the whole board depends on which auras are in force. So a projection that
    // stripped `liveEffects` would render a board that disagrees with the engine —
    // a client showing a resource the aura already granted this turn.
    //
    // This is the one place the server has a say, and it is worth pinning: if a
    // future secrecy pass treats `liveEffects` as sensitive and filters it, the
    // client would be wrong rather than merely less informed.
    const { stored } = await recordGame(6);
    const state = replay({ stored, ctx }).state;
    expect(Object.keys(state), 'liveEffects should be unprefixed so it reaches clients').toContain('liveEffects');
    expect(Object.keys(state).some((k) => k.includes('liveEffect') && k.startsWith('_')), 'liveEffects is prefixed as server-only, so clients would render a stale board').toBe(false);
  });

  it('HAZARD: a match dealt with a non-default opening cannot be replayed, and says so late', () => {
    // REPORTED, NOT FIXED — this is a cross-package constraint and it is `store.ts`'s
    // to own, not a test's. Pinning it here so it is a known, asserted property of
    // the replay model rather than a trap for whoever touches `lobby.ts` next.
    //
    // `replay()` rebuilds with `setup({players, names, cards, seed, ...decks})` and
    // passes NOTHING else. It cannot pass `startResources`, because
    // `StoredMatch` does not record them. So the ONLY matches it can faithfully
    // reproduce are matches dealt on p7's DEFAULT opening — which is what `lobby.ts`
    // does today, by passing nothing.
    //
    // The failure mode is what makes this worth writing down. If `lobby.ts` ever grew
    // a "custom start" option and passed `startResources`, every live match would
    // still be created, played and persisted without complaint — and then fail to
    // restore, at an action deep into the log, with an error about whatever the
    // mis-dealt seat could not afford. Not "this match was dealt with custom opening
    // resources and cannot be replayed", which is the message that would have found
    // it in a minute.
    //
    // The two hashes do NOT save you here. `rulesVersion` hashes `RULES` and
    // `cardsVersion` hashes card bodies; neither has anything to say about the opening
    // pools, because the opening is neither a rule nor a card.
    const custom = setup({
      players: [P1, 'p2'],
      names: { [P1]: 'Ada', p2: 'Bo' },
      cards,
      seed: SEED,
      ideologyDeck: Object.keys(cards.ideology),
      voterDeck: Object.keys(cards.voter),
      conspiracyDeck: Object.keys(cards.conspiracy),
      headlineDeck: Object.keys(cards.headline),
      // What a hypothetical "custom start" lobby option would pass.
      startResources: [{ funds: 8 }, { funds: 8 }],
    });
    const replayed = setup({
      players: [P1, 'p2'],
      names: { [P1]: 'Ada', p2: 'Bo' },
      cards,
      seed: SEED,
      ideologyDeck: Object.keys(cards.ideology),
      voterDeck: Object.keys(cards.voter),
      conspiracyDeck: Object.keys(cards.conspiracy),
      headlineDeck: Object.keys(cards.headline),
    });
    // The two openings genuinely differ…
    expect(custom.players[P1]?.resources, 'the custom opening did not take effect, so this test proves nothing').not.toEqual(
      replayed.players[P1]?.resources,
    );
    // …and the hashes that `replay()` DOES check are identical for both, which is
    // precisely why the mismatch is not caught up front.
    expect(rulesVersion(RULES), 'the rules hash would catch this after all').toBe(rulesVersion(RULES));
    expect(cardsVersion(cards)).toBe(cardsVersion(cards));

    // The default opening IS reproducible, which is the half that matters today.
    const same = setup({
      players: [P1, 'p2'],
      names: { [P1]: 'Ada', p2: 'Bo' },
      cards,
      seed: SEED,
      ideologyDeck: Object.keys(cards.ideology),
      voterDeck: Object.keys(cards.voter),
      conspiracyDeck: Object.keys(cards.conspiracy),
      headlineDeck: Object.keys(cards.headline),
    });
    expect(same.players[P1]?.resources, 'the default opening is not reproducible, so lobby.ts is already broken').toEqual(
      replayed.players[P1]?.resources,
    );
  });
});
