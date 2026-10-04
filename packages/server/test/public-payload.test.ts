/**
 * THE OTHER HALF OF THE SECRET GATE: PUBLIC FIELDS MUST ACTUALLY ARRIVE.
 *
 * `secret-state.test.ts` proves the server does not leak. This file proves it does
 * not over-correct, and the two are the same gate from opposite ends.
 *
 * THE BUG CLASS IS NAMED IN THE FIRST PARAGRAPH BECAUSE IT IS QUIET. A field that is
 * public by convention — no `_` prefix — reaches the client because nothing strips it,
 * and nothing strips it because the strip is a *loop over `_`-prefixed keys*. There is
 * no positive list of what gets through. So a field can be dropped by: a future
 * `playerView` that starts projecting players from a hand-written allow-list; a
 * `PRIVATE_PLAYER_KEYS` addition that is one entry too many; a wrapper that rebuilds
 * the payload from named fields. Every one of those is a small, plausible-looking
 * edit, and every one of them is invisible to the leak suite, which only checks that
 * secrets are ABSENT.
 *
 * For most public fields the consequence is cosmetic. For the two in this file it is
 * not, which is why they are the two that are listed:
 *
 *  - `PlayerState.restrictions` (G5). The server refuses a purchase the restriction
 *    forbids. A client that cannot see the restriction renders a button that is
 *    refused, or nothing at all, and the player has no way to find out why. The game
 *    is enforcing a rule it will not tell anybody about.
 *  - `GameState.liveEffects` (G9 / G22). A lasting effect is public information a
 *    player plans around — "PYTHONPOST taxes me for the rest of the game" is only
 *    interesting if the table can see it.
 *
 * BOTH FIXTURES ARE PURPOSE-BUILT, and the reason is the same one
 * `live-effect-replay.test.ts` gives and it is not a convenience: **the shipped
 * corpus contains no card with a lasting clause and no card with a `restrict` op.**
 * Every real game therefore projects `restrictions: []` and `liveEffects: []`, so a
 * test written against the real corpus would compare two empty arrays and pass
 * against a projection that returned nothing at all. This is the fixture-cannot-fail
 * failure, and it is the one that shipped an unwinnable game a level down. So the
 * corpus is asserted separately and honestly (the last two tests, on the real cards)
 * and the non-empty claims are asserted here, on cards that carry the mechanisms.
 *
 * THE WIRE, NOT THE OBJECT. Every non-empty assertion is made against a JSON round
 * trip of what the server actually sent over a real WebSocket, not against the
 * in-memory projection. That is not pedantry: `JSON.stringify` DROPS a key whose
 * value is `undefined`, so a field that is somehow absent in the authoritative state
 * arrives at the client as a MISSING KEY, not as `undefined` — and `x.length` on a
 * missing key is a `TypeError` rather than a falsy check. The engine's
 * `PlayerState.restrictions` is optional (`state.ts` says why, and calls it
 * coordination debt), so that is the exact shape this has to rule out, and only a
 * serialised payload can.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  indexCards,
  reduce,
  setup,
  type Action,
  type CardIndex,
  type ClientState,
  type ConspiracyCard,
  type GameState,
  type HeadlineCard,
  type IdeologyCard,
  type PlayerID,
  type VoterCard,
} from '@shasn/engine';

import { viewFor } from '../src/broadcast.ts';
import { decksOf } from '../src/store.ts';
import { TestClient, makeCtx, realCards, startHarness, type Harness } from './fixtures.ts';
import { renderAll } from './render-all.ts';
import { PUBLIC_BY_DESIGN } from './secret-inventory.ts';

// ─────────────────────────── a corpus that HAS both fields ───────────────────────────

/**
 * Conspiracies that each impose a surcharge AND install a lasting hook.
 *
 * EVERY Conspiracy in the fixture carries both, which is the same deliberate choice
 * `live-effect-replay.test.ts` makes and for the same reason: `setup` SHUFFLES the
 * conspiracy deck, so which card a player buys is not predictable, and a fixture where
 * only some cards carry the mechanism is a coin flip on whether the test is testing
 * anything.
 *
 * The two clauses are shaped to install at the right MOMENT, which is the one detail
 * that would otherwise make this fixture silently useless:
 *
 *  - the `restrict` op carries NO `when`, so `isScoped` is false and `applyEffect`
 *    writes the rule immediately. (A `restrict` carrying `until` is still unscoped by
 *    an explicit named exception in `reduce.ts` — `until` is the DEADLINE OF THE RULE,
 *    not a hook lifetime.)
 *  - the second effect carries `when: 'on-purchase'`, so it is scoped and
 *    `installLiveEffects` turns it into a `LiveEffect` rather than paying it out once.
 *
 * A card with a bare `duration` and a `restrict` inside it would install ONE standing
 * effect holding the whole list and re-apply the restriction on each of the owner's
 * turns, so the split is not stylistic — it is what makes "imposed now, lasting later"
 * expressible at all.
 */
const CONSPIRACIES: readonly ConspiracyCard[] = Array.from({ length: 6 }, (_, i): ConspiracyCard => ({
  id: `pb-con-${i + 1}`,
  name: `Public Levy ${i + 1}`,
  text: 'From now on every Voter Card you buy costs 1 extra Fund. Every purchase also pays you 1 Clout.',
  cost: 1,
  effects: [
    { op: 'restrict', kind: 'surcharge', value: 1, until: 'rest-of-game' },
    { op: 'gain', res: { clout: 1 }, when: 'on-purchase', until: 'rest-of-game' },
  ],
}));

const VOTERS: readonly VoterCard[] = Array.from({ length: 12 }, (_, i) => ({
  id: `pb-vot-${i + 1}`,
  cost: { funds: 1 },
  voters: 1,
}));

const IDEOLOGIES: readonly IdeologyCard[] = Array.from({ length: 8 }, (_, i) => ({
  id: `pb-ide-${i + 1}`,
  campaign: 'pb',
  question: `question ${i + 1}`,
  sides: [
    { answer: 'side zero', ideologue: 'capitalist' as const, pays: { funds: 2 } },
    { answer: 'side one', ideologue: 'idealist' as const, pays: { funds: 2 } },
  ],
}));

const HEADLINES: readonly HeadlineCard[] = Array.from({ length: 6 }, (_, i) => ({
  id: `pb-hed-${i + 1}`,
  name: `Nothing Much ${i + 1}`,
  text: 'Nothing happens.',
  effects: [{ op: 'gain', res: { media: 1 } }],
}));

const CARDS: CardIndex = indexCards({
  ideology: [...IDEOLOGIES],
  voter: [...VOTERS],
  conspiracy: [...CONSPIRACIES],
  headline: [...HEADLINES],
});

/**
 * Drive the fixture to the point the file is about: a Conspiracy bought and played, so
 * the table carries a restriction and a live effect.
 *
 * Reads the room's authoritative state to choose the action, and only ever puts the
 * seat's OWN projection in front of a client — the same discipline as `e2e.test.ts`.
 * There is no card-id peeking here to be careful about, because every id involved is
 * public by the argument this file is testing: a Conspiracy's id is named by
 * `Restriction.sourceCardId` and by `LiveEffect.sourceCardId` precisely because the
 * card is face up on the discard pile the moment the effect exists.
 */
function pbNextAction(s: GameState, me: PlayerID): Action | null {
  if (s.finished) return null;
  if (s.activePlayer !== me) return null;
  if (s.phase === 'answer') return { type: 'ANSWER', side: 0 };
  if (s.phase === 'headlines') return { type: 'ACK_HEADLINE' };
  if (s.phase !== 'actions') return null;

  const open = s.choices.find((c) => c.player === me);
  if (open !== undefined) {
    const c = open.choice;
    if (c.kind === 'gain-any' || c.kind === 'lose-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: open.id, pick: { kind: 'resources', res: { funds: c.count } } };
    }
    if (c.kind === 'steal-any') {
      return { type: 'RESOLVE_CHOICE', choiceId: open.id, pick: { kind: 'steal', from: c.from ?? me, res: { funds: c.count } } };
    }
    return { type: 'RESOLVE_CHOICE', choiceId: open.id, pick: { kind: 'areas', areaIds: [] } };
  }

  const group = s.players[me]?.pending[0];
  if (group !== undefined) {
    const free = s.zones.flatMap((z) => z.areas.filter((a) => a.peg === null).map((a) => a.id));
    if (free.length >= group.count) return { type: 'PLACE_VOTERS', groupId: group.id, areaIds: free.slice(0, group.count) };
  }

  // The route to both fields: buy the top Conspiracy, then play it. Playing it is what
  // runs the `restrict` op and installs the `on-purchase` hook.
  //
  // It plays only from a hand of TWO, and that is not a stylistic choice: a player
  // who empties their hand the moment they play has nothing in it on the following
  // turn, so the state "taxed player, on move, holding a Conspiracy, with this turn's
  // income in the pool" never occurs — and that is the state the price oracle below
  // needs. Holding one across a turn boundary is also what a real player does with a
  // Conspiracy they are saving.
  const hand = s.players[me]?.conspiracies ?? [];
  if (hand.length > 1) return { type: 'PLAY_CONSPIRACY', cardId: hand[0] as string };

  const top = s.conspiracyTopCost;
  if (top !== null) {
    // THE SURCHARGE IS IN THE DRIVER, and that is the point rather than an annoyance.
    // `BUY_CONSPIRACY`'s `pay` has to cover the printed cost PLUS whatever the buyer's
    // own restrictions add, so a driver that reads only `conspiracyTopCost` is refused
    // the moment it has taxed itself — which is what happened on the first run. And
    // this line is the argument of the whole file in miniature: a CLIENT can compute
    // this, because `restrictions` is public. A rule the table cannot price in
    // advance is not a price.
    const surcharge = (s.players[me]?.restrictions ?? [])
      .filter((r) => r.kind === 'surcharge')
      .reduce((n, r) => n + Math.max(0, r.value), 0);
    const due = top + surcharge;
    if ((s.players[me]?.resources.funds ?? 0) >= due) return { type: 'BUY_CONSPIRACY', pay: { funds: due } };
  }
  return { type: 'END_TURN' };
}

let h: Harness;
let ada: TestClient;
let bo: TestClient;
let spec: TestClient;
let matchId: string;
let seats: { client: TestClient; playerId: PlayerID }[] = [];
/** The room state at the moment the loop stopped, for the in-memory assertions. */
let reached: GameState | null = null;
let plies = 0;
/**
 * Every (live effect, hand) collision seen at ANY state of the played trajectory.
 *
 * Collected during the drive rather than asserted afterwards, because the claim is a
 * claim about SIMULTANEITY: a live effect's `sourceCardId` is public because the card
 * is face up on the discard pile in the same breath, so an id that is also in a hand
 * *at that moment* would break the argument. Reading one final state cannot show it —
 * the conspiracy that produced the effect is, by construction, no longer in hand by
 * then. So the check rides along with the drive, where the hand and the effect are
 * both on screen.
 */
let handCollisions: string[] = [];
/** How many states had BOTH a live effect and a non-empty hand, so the check is real. */
let overlapStates = 0;
/**
 * What the ENGINE says about a purchase priced from the payload alone.
 *
 * The teeth for the whole file, collected during the drive because the interesting
 * moment is when a player who has taxed themselves is on move with a Conspiracy in
 * hand. Two `reduce` calls are made against the same state: one paying the PRINTED
 * cost, one paying printed + surcharge read off `restrictions`. The engine must refuse
 * the first and accept the second.
 *
 * That is a real oracle rather than a restatement: it can only pass if the number the
 * client would quote is the number the engine charges, so a `restrictions` field that
 * stopped being public — or arrived without its `value` — breaks it.
 */
let pricedFromPayload: { player: PlayerID; printedRefused: boolean; surchargedOk: boolean }[] = [];

/** The engine as its own oracle. `makeCtx` is the server's own `rules` + cards pair. */
const engineCtx = makeCtx(CARDS);

beforeAll(async () => {
  h = await startHarness({ cards: CARDS, dispatchRate: 4000, messageRate: 4000 });

  ada = await TestClient.connect(h.url);
  ada.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
  const lobby = await ada.expect(ada.is('lobby:state'), 'lobby');
  const lobbyId = lobby.lobby.lobbyId;

  bo = await TestClient.connect(h.url);
  bo.send({ t: 'lobby:join', lobbyId, name: 'Bo' });
  await bo.expect(bo.is('lobby:state'), 'bo joined');

  ada.send({ t: 'lobby:start' });
  const first = await ada.expect(ada.is('match:state'), 'match started');
  await bo.expect(bo.is('match:state'), 'bo in match');
  matchId = first.matchId;
  seats = [
    { client: ada, playerId: ada.latestSession().playerId as PlayerID },
    { client: bo, playerId: bo.latestSession().playerId as PlayerID },
  ];

  // A spectator, because "everyone can see you cannot buy" includes the table.
  spec = await TestClient.connect(h.url);
  spec.send({ t: 'match:spectate', matchId });
  await spec.expect(spec.is('match:state'), 'spectator attached');

  const room = h.server.hub.rooms.get(matchId);
  if (room === undefined) throw new Error('no room');

  for (let step = 0; step < 200; step += 1) {
    const s = room.state;

    // The simultaneity check, every state of the trajectory. Cheap, and it is the only
    // place it can be made: see `handCollisions` above.
    if (s.liveEffects.length > 0) {
      const held = new Set(s.turnOrder.flatMap((p) => s.players[p]?.conspiracies ?? []));
      if (held.size > 0) overlapStates += 1;
      for (const le of s.liveEffects) {
        if (held.has(le.sourceCardId)) handCollisions.push(`${le.sourceCardId} (turn ${s.turn})`);
      }
    }

    // Drive until the state carries a restriction AND a live effect AND somebody is
    // holding a Conspiracy AND the price oracle has fired with a real acceptance. The
    // last conjunct is not decoration: the first moment a player holds a Conspiracy is
    // the moment they have just SPENT, so breaking there would leave every price probe
    // refused for poverty and the oracle proving nothing. The table is driven on a
    // little longer so the probe can be made with money in the pool.
    const hasRestriction = s.turnOrder.some((p) => (s.players[p]?.restrictions ?? []).length > 0);
    const held = s.turnOrder.some((p) => (s.players[p]?.conspiracies ?? []).length > 0);

    // The oracle probe, whenever a taxed player is on move with something to buy.
    const taxed = s.turnOrder.find(
      (p) =>
        s.activePlayer === p &&
        (s.players[p]?.conspiracies ?? []).length > 0 &&
        (s.players[p]?.restrictions ?? []).some((r) => r.kind === 'surcharge' && r.value > 0),
    );
    const top = s.conspiracyTopCost;
    if (taxed !== undefined && top !== null) {
      const surcharge = (s.players[taxed]?.restrictions ?? [])
        .filter((r) => r.kind === 'surcharge')
        .reduce((n, r) => n + Math.max(0, r.value), 0);
      pricedFromPayload.push({
        player: taxed,
        printedRefused: !reduce(s, taxed, { type: 'BUY_CONSPIRACY', pay: { funds: top } }, engineCtx).ok,
        surchargedOk: reduce(s, taxed, { type: 'BUY_CONSPIRACY', pay: { funds: top + surcharge } }, engineCtx).ok,
      });
    }

    if (hasRestriction && s.liveEffects.length > 0 && held && pricedFromPayload.some((p) => p.surchargedOk)) {
      reached = s;
      break;
    }
    const seat = seats.find((x) => x.playerId === s.activePlayer);
    const action = pbNextAction(s, s.activePlayer);
    if (seat === undefined || action === null) throw new Error(`no action for ${s.activePlayer} in ${s.phase}`);
    const before = room.viewId;
    // `all('error')` is cumulative, so the count is taken BEFORE the send: only a
    // refusal this action provoked is a failure, and a harness that reports an old one
    // would make the loop untunable.
    //
    // The wait watches BOTH outcomes in one poll. A refused action does not advance
    // `viewId` at all, so waiting on the view alone turns "the server said no" into a
    // ten-second timeout naming the wrong cause — and waiting on the error alone turns
    // a legal action into a hang, because no error is coming.
    const errorsBefore = seat.client.all('error').length;
    seat.client.send({ t: 'match:action', action });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const refused = seat.client.all('error').slice(errorsBefore)[0];
      if (refused !== undefined) {
        throw new Error(
          `server refused ${action.type} for ${s.activePlayer} in ${s.phase}: ${refused.message}\n` +
            `  funds=${s.players[s.activePlayer]?.resources.funds} top=${String(s.conspiracyTopCost)} ` +
            `choices=${s.choices.length} pending=${s.players[s.activePlayer]?.pending.length ?? 0}`,
        );
      }
      if (room.viewId > before) break;
      if (Date.now() > deadline) throw new Error(`the room did not advance past viewId ${before} after ${action.type}`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1));
    }
    plies += 1;
  }
  reached ??= h.server.hub.rooms.get(matchId)?.state ?? null;

  // Settle every socket onto the room's current view. A WebSocket `message` event
  // lands on a later macrotask than the room's own write, so a client read immediately
  // after the loop can be one view behind — which would make "the client was sent X"
  // a statement about a stale frame. `match:sync` is the server's own catch-up path,
  // the same one `e2e.test.ts` uses, and the assertions below read whatever it returns.
  const settled = h.server.hub.rooms.get(matchId);
  if (settled === undefined) throw new Error('no room after the loop');
  const target = settled.viewId;
  for (const c of [ada, bo, spec]) {
    for (let guard = 0; guard < 20 && c.latestState().viewId < target; guard += 1) {
      c.clear();
      c.send({ t: 'match:sync' });
      // eslint-disable-next-line no-await-in-loop
      await c.expect(c.is('match:state'), 'settle');
    }
    if (c.latestState().viewId < target) throw new Error('a client never caught up to the room view');
  }
}, 60_000);

afterAll(async () => {
  await spec?.close();
  await ada?.close();
  await bo?.close();
  await h?.close();
});

/** The wire shape this file asserts on, after a JSON round trip. */
type WireState = {
  players: Record<string, { restrictions?: unknown } | undefined>;
  liveEffects?: unknown;
};

/**
 * A client's LAST `match:state`, parsed the way a browser would parse it.
 *
 * The round trip is the point and not an incidental detail: `JSON.stringify` DROPS a
 * key whose value is `undefined`, so a field that is absent in the authoritative state
 * arrives here as a missing key. Asserting on the in-memory object would hide exactly
 * the shape the client has to survive.
 */
function wireState(client: TestClient): WireState {
  const msg = client.latestState();
  return JSON.parse(JSON.stringify(msg.state)) as WireState;
}

/** Every viewer, including a spectator, a non-seat and the empty-string placeholder. */
function allViewers(s: GameState): (PlayerID | null)[] {
  return [null, ...s.turnOrder, 'p_not_a_seat', ''];
}

/** The engine's own claim, checked where it can be falsified. */
function stateOrThrow(): GameState {
  if (reached === null) throw new Error('the fixture never reached a state with both fields');
  return reached;
}

// ─────────────────────────── the corpus cannot be vacuous ───────────────────────────

describe('the fixture actually produces both fields, over a real socket', () => {
  it('reached a table that has a restriction AND a live effect, and every client saw it', () => {
    const s = stateOrThrow();
    expect(plies, 'the fixture reached the state without playing anything').toBeGreaterThan(0);

    const restricted = s.turnOrder.filter((p) => (s.players[p]?.restrictions ?? []).length > 0);
    expect(restricted.length, 'no seat carries a restriction — the payload assertions are vacuous').toBeGreaterThan(0);
    expect(s.liveEffects.length, 'no live effect is installed — the payload assertions are vacuous').toBeGreaterThan(0);
    expect(
      s.turnOrder.some((p) => (s.players[p]?.conspiracies ?? []).length > 0),
      'the fixture ends with nobody holding a Conspiracy, so the simultaneity check is vacuous',
    ).toBe(true);

    // And the CLIENT, over the wire, agrees. If this fails then the fixture built a
    // state the projection dropped, which is the bug this whole file is about.
    const readers = [...seats.map((x) => ({ client: x.client, who: x.playerId })), { client: spec, who: 'spectator' }];
    for (const { client, who } of readers) {
      const wire = wireState(client);
      const seen = restricted.filter((p) => Array.isArray(wire.players[p]?.restrictions));
      expect(seen.length, `viewer ${who} was sent no restriction list for any seat`).toBe(restricted.length);
      expect(Array.isArray(wire.liveEffects), `viewer ${who} was sent no liveEffects array`).toBe(true);
      expect((wire.liveEffects as unknown[]).length, `viewer ${who} was sent an EMPTY liveEffects list`).toBe(
        s.liveEffects.length,
      );
    }
  });

  it('the inventory entry names the fields this file is about, and only those', () => {
    // The inventory is a CLAIM, and a claim nothing reads rots. This is the tie
    // between the two files: if a public-but-load-bearing field is added to the engine
    // and not recorded, adding it here brings this file's sweep along with it rather
    // than leaving the assertion behind — and, more importantly, the ENTRY is the
    // record, so an omission is visible in the diff rather than discovered later.
    expect(Object.keys(PUBLIC_BY_DESIGN).sort()).toEqual(['capOverride', 'liveEffects', 'restrictions']);
    // A path and a reason, not a bare name: a bare list cannot be read by the next
    // person as a decision.
    for (const [field, path] of Object.entries(PUBLIC_BY_DESIGN)) {
      expect(path, `${field} has no path recorded`).toMatch(/^(players\[\]\.|liveEffects)/);
    }
  });
});

// ─────────────────────────── they reach the client ───────────────────────────

describe('a public field is not "public" until it is proven to be on the wire', () => {
  it("restrictions is on every seat's payload, for every viewer, and is the whole list", () => {
    const s = stateOrThrow();
    const readers = [...seats.map((x) => ({ client: x.client, who: x.playerId })), { client: spec, who: 'spectator' }];

    for (const { client, who } of readers) {
      const wire = wireState(client);
      for (const pid of s.turnOrder) {
        const got = wire.players[pid]?.restrictions;
        // The KEY, not the value. `undefined` would be indistinguishable from "there
        // are none" to a reader, and is a `TypeError` to `got.length`.
        expect(got, `viewer ${who} seat ${pid}: no restrictions key in the payload`).toBeDefined();
        expect(Array.isArray(got), `viewer ${who} seat ${pid}: restrictions is not an array`).toBe(true);
        // Deep-equal to the AUTHORITATIVE list, so a filter that dropped the affected
        // player's own entry — the shape this is most likely to take — fails.
        expect(got, `viewer ${who} seat ${pid}: the projected list differs from the state's`).toEqual(
          s.players[pid]?.restrictions ?? [],
        );
      }
    }
  });

  it('the restriction is IDENTICAL for every viewer — it is public, not viewer-scoped', () => {
    // The ruling itself. A lock only the affected player can see is not KHAKI TERROR,
    // it is a soft-lock with extra steps; and a surcharge other players learn about
    // only after they have bought is not a price. So the payload must be the same
    // bytes for the victim, the other seat and a spectator — asserted over the whole
    // serialised list, not field by field.
    const s = stateOrThrow();
    const renderings = [...seats.map((x) => x.client), spec].map((c) => {
      const wire = wireState(c);
      return JSON.stringify(s.turnOrder.map((p) => wire.players[p]?.restrictions));
    });
    expect(new Set(renderings).size, 'the restriction list differs between viewers').toBe(1);
  });

  it('names the card that imposed it, because "you cannot buy" is not a usable message', () => {
    // A client that has to render a lock has to be able to say WHY. `sourceCardId` is
    // public for the same reason the restriction is: the card is face up on the
    // discard pile in the same breath, and a client cannot display a card it has no
    // id for. Asserted as an id in the serialised payload, which is the form it takes
    // on the wire.
    const s = stateOrThrow();
    const first = seats[0];
    if (first === undefined) throw new Error('no client');
    const json = JSON.stringify(wireState(first.client));
    let named = 0;
    for (const pid of s.turnOrder) {
      for (const r of s.players[pid]?.restrictions ?? []) {
        expect(json.includes(r.sourceCardId), `${r.sourceCardId} did not reach the client`).toBe(true);
        expect(json.includes(r.sourcePlayer), `the imposing player ${r.sourcePlayer} did not reach the client`).toBe(true);
        named += 1;
      }
    }
    expect(named, 'no restriction was named — the assertion above was vacuous').toBeGreaterThan(0);
  });

  it('capOverride is on every seat`s payload for every viewer, and is ABSENT when nothing holds it down', () => {
    // G15, and the third entry in the inventory. Two claims, and the second is the one
    // a client actually has to survive.
    //
    // A client reported it was told a player was over cap by a dialog whose ceiling it
    // could not see, and asked for the ceiling to be published. **It is already
    // published** — `capOverride` is unprefixed and not in `PRIVATE_PLAYER_KEYS`, so it
    // rides `playerView`'s `players` clone untouched — and this is the assertion that
    // says so over the wire rather than in a comment.
    //
    // `capOverride` is OPTIONAL, and that is the whole contract: absent means "the
    // printed cap", not "no opinion". So the interesting failure is a projection that
    // either drops the key when the engine wrote one, or INVENTS one when the engine did
    // not — and `JSON.stringify` turns `undefined` into a missing key rather than a
    // null, which is the shape the browser actually receives.
    const cards = realCards();
    const states: GameState[] = [
      setup({ players: ['p_1', 'p_2'], names: { p_1: 'Ada', p_2: 'Bo' }, cards, seed: 909, ...decksOf(cards) }),
    ];
    const reachedState = reached;
    if (reachedState !== null) states.push(reachedState);

    let present = 0;
    let absent = 0;
    for (const s of states) {
      for (const viewer of allViewers(s)) {
        const wire = JSON.parse(JSON.stringify(viewFor(s, cards, viewer))) as {
          players: Record<string, { capOverride?: unknown } | undefined>;
        };
        for (const pid of s.turnOrder) {
          const authoritative = s.players[pid]?.capOverride;
          const got = wire.players[pid]?.capOverride;
          if (authoritative === undefined) {
            expect(
              Object.prototype.hasOwnProperty.call(wire.players[pid] ?? {}, 'capOverride'),
              `viewer ${String(viewer)} seat ${pid}: an override was INVENTED where the engine wrote none`,
            ).toBe(false);
            absent += 1;
          } else {
            expect(got, `viewer ${String(viewer)} seat ${pid}: the cap override did not reach the client`).toEqual(
              authoritative,
            );
            expect(Object.keys(got as Record<string, unknown>).sort(), 'a capOverride arrived narrowed').toEqual([
              'expiresTurn',
              'to',
            ]);
            present += 1;
          }
        }
      }
    }
    expect(present + absent, 'nothing was inspected — the shape assertion was vacuous').toBeGreaterThan(0);

    // AND, so the client-side report is answered with a fact rather than a reassurance:
    // no card in the SHIPPED corpus installs one. The ceiling it cannot see is a
    // ceiling no card can currently lower, so the dialog it is drawing is the printed
    // p12 cap and the engine's `rules.resourceCap` is the number it should be showing.
    // Derived rather than counted, because a bare count of shipped cards is exactly the
    // literal `corpus-drift.test.ts` exists to refuse.
    const installers: string[] = [];
    for (const card of [
      ...Object.values(cards.ideology),
      ...Object.values(cards.voter),
      ...Object.values(cards.conspiracy),
      ...Object.values(cards.headline),
    ]) {
      if ('effects' in card && card.effects.some((e) => e.op === 'set-cap')) installers.push(card.id);
    }
    expect(
      installers,
      `a shipped card now installs a cap override (${installers.join(', ')}) — the claim above is stale and the wire assertion above is the one that matters`,
    ).toEqual([]);
  });

  it('liveEffects is on the payload for every viewer, and is the whole list', () => {
    const s = stateOrThrow();
    const readers = [...seats.map((x) => ({ client: x.client, who: x.playerId })), { client: spec, who: 'spectator' }];

    for (const { client, who } of readers) {
      const wire = wireState(client);
      expect(wire.liveEffects, `viewer ${who}: no liveEffects key`).toBeDefined();
      expect(Array.isArray(wire.liveEffects), `viewer ${who}: liveEffects is not an array`).toBe(true);
      expect(wire.liveEffects, `viewer ${who}: the projected list differs from the state's`).toEqual(s.liveEffects);
    }
  });

  it('a live effect never names a Conspiracy Card a player is still holding', () => {
    // The engine asserts this property in its own package, and it is repeated here
    // because THIS is where it becomes a wire claim. `sourceCardId` is public BECAUSE
    // a live effect can only come from a card being resolved, and both
    // `PLAY_CONSPIRACY` and `ACK_HEADLINE` put that card face up on the discard pile
    // in the same breath — so an id in `liveEffects` that is also in a hand would mean
    // the visibility argument is wrong and the engine's non-secret ruling collapses.
    // A Conspiracy hand is the one hidden thing `liveEffects` could smuggle.
    //
    // Checked over the whole trajectory rather than at the final state, because at the
    // final state the check is vacuous BY CONSTRUCTION: the conspiracy that produced
    // the effect has already been played and is on the discard pile. The interesting
    // states are the ones where somebody is holding a conspiracy AND a live effect
    // exists, and the drive counted them.
    expect(overlapStates, 'the drive never had a live effect and a held Conspiracy at once').toBeGreaterThan(0);
    expect(handCollisions, 'a live effect named a card that was still in a hand').toEqual([]);
  });

  it('the number a client would quote is the number the engine charges (the teeth)', () => {
    // Everything above in this file could in principle be satisfied by a payload that
    // carries a plausible-looking but WRONG restriction list — the same-shaped array,
    // with a `value` of 0, say. So this asks the engine instead of asking the shape.
    //
    // At every state of the drive where a taxed player was on move holding a Conspiracy,
    // two `BUY_CONSPIRACY` actions were priced from `restrictions` alone: one at the
    // printed `conspiracyTopCost` and one at printed + surcharge.
    //
    // TWO CLAIMS, because a poor seat produces a third outcome and averaging it away
    // would hide both. First, the printed price was REFUSED every single time — that
    // is the surcharge being enforced, and it is a statement about every probe. Second,
    // on at least one probe the surcharged price was ACCEPTED, which is what stops the
    // first from being a claim that nothing is ever buyable. A seat that cannot afford
    // the surcharged price is refused for being poor, and that is not a finding.
    expect(pricedFromPayload.length, 'the drive never had a taxed player on move with a Conspiracy').toBeGreaterThan(0);
    for (const probe of pricedFromPayload) {
      expect(probe.printedRefused, `${probe.player} could buy at the PRINTED cost — the surcharge is not enforced`).toBe(
        true,
      );
    }
    const affordable = pricedFromPayload.filter((p) => p.surchargedOk);
    expect(
      affordable.length,
      'the surcharged price was never accepted, so the refusal above proves nothing',
    ).toBeGreaterThan(0);
  });

  it('the same holds through the in-memory projection and through every ServerMessage', () => {
    // The socket test covers the production fan-out for one state. This walks the
    // SAME claims over the projection function and over `renderAll`, so a message type
    // added later that inlines a state is covered by the same sweep rather than
    // needing a second file. Both are the paths the leak suite walks, deliberately.
    const s = stateOrThrow();
    const ctx = makeCtx(CARDS);

    for (const viewer of allViewers(s)) {
      const view = viewFor(s, CARDS, viewer);
      expect(Array.isArray(view.liveEffects), `viewer ${String(viewer)}: liveEffects missing`).toBe(true);
      expect(view.liveEffects).toEqual(s.liveEffects);
      for (const pid of s.turnOrder) {
        expect(view.players[pid]?.restrictions, `viewer ${String(viewer)} seat ${pid}: restrictions missing`).toEqual(
          s.players[pid]?.restrictions ?? [],
        );
      }
    }

    for (const viewer of [null, ...s.turnOrder] as (PlayerID | null)[]) {
      for (const msg of renderAll(s, ctx, viewer)) {
        if (msg.t !== 'match:state') continue;
        const view: ClientState = msg.state;
        expect(view.liveEffects, `${String(viewer)}: match:state carries no liveEffects`).toEqual(s.liveEffects);
        for (const pid of s.turnOrder) {
          expect(
            view.players[pid]?.restrictions,
            `${String(viewer)}: match:state carries no restrictions for ${pid}`,
          ).toEqual(s.players[pid]?.restrictions ?? []);
        }
      }
    }
  });
});

// ─────────────────────── the optional-restrictions deviation ───────────────────────

describe('the optional-restrictions deviation is safe on the wire, and only just', () => {
  /**
   * `PlayerState.restrictions` is OPTIONAL in the engine, because a required new field
   * breaks every hand-built `PlayerState` literal in `packages/client` and
   * `packages/server`, and the engine's owner could not edit the client's fixture. See
   * the note on `PlayerState.restrictions` in `packages/engine/src/state.ts`.
   *
   * That means `undefined` and `[]` are both legal states of a `ClientState` as far as
   * the type is concerned, and it is the SERVER's job to establish which one a client
   * can actually observe. The answer, and the only thing that makes the deviation safe
   * rather than merely compiling:
   *
   *   **`undefined` is not reachable from the wire.** `setup()` writes `restrictions:
   *   []`, `reduce()` only ever writes it by spreading an existing player, and
   *   `playerView` copies the player wholesale. So a client sees either `[]` or a
   *   non-empty list, never a missing key. These tests are what turn that from a claim
   *   about three engine files into an assertion about the payload.
   *
   * AND THE CLIENT STILL OWES ONE LINE, which is stated rather than left for someone
   * to rediscover: `restrictions: []` in the hand-built `PlayerState` literal in
   * `packages/client/src/app/choiceResolver.test.tsx`. It is not a bug today — the
   * field is optional, the type permits it, and the client does not read the field at
   * all (`rg restrictions packages/client/src` is empty). It is a coordination debt
   * the engine flagged in three places and could not discharge, and this file is the
   * server's half of the note.
   */

  /** The shipped corpus, freshly dealt, where every list is `[]`. */
  function shippedState(): GameState {
    const cards = realCards();
    return setup({
      players: ['p_1', 'p_2'],
      names: { p_1: 'Ada', p_2: 'Bo' },
      cards,
      seed: 909,
      ...decksOf(cards),
    });
  }

  it('a client can never observe a missing restrictions key, on either corpus', () => {
    // The SHIPPED corpus first, because that is the case that would be silently wrong
    // if the server ever omitted the field: `[]` and `undefined` both read as "nothing"
    // to a careless renderer, and `view.players[me].restrictions.length` throws on one
    // and not the other. The real corpus is also the corpus that ships.
    const cases: { s: GameState; cards: CardIndex }[] = [{ s: shippedState(), cards: realCards() }];
    const reachedState = reached;
    if (reachedState !== null) cases.push({ s: reachedState, cards: CARDS });

    for (const { s, cards } of cases) {
      for (const viewer of allViewers(s)) {
        const parsed = JSON.parse(JSON.stringify(viewFor(s, cards, viewer))) as WireState;
        for (const pid of s.turnOrder) {
          const seat = parsed.players[pid];
          if (seat === undefined) throw new Error(`viewer ${String(viewer)}: seat ${pid} is missing from the payload`);
          // `hasOwnProperty`, not `toBeDefined()`: the claim is that the KEY is on the
          // wire, and `undefined` would be a value, not an absence — except that
          // `JSON.stringify` drops it, so on the wire the two are the same thing. That
          // is the whole reason this is checked after a serialisation.
          expect(
            Object.prototype.hasOwnProperty.call(seat, 'restrictions'),
            `viewer ${String(viewer)} seat ${pid}: restrictions key is ABSENT, not empty`,
          ).toBe(true);
          expect(Array.isArray(seat.restrictions)).toBe(true);
        }
        expect(Object.prototype.hasOwnProperty.call(parsed, 'liveEffects')).toBe(true);
        expect(Array.isArray(parsed.liveEffects)).toBe(true);
      }
    }
  });

  it('the engine never produces an absent list either — so `undefined` means hand-built', () => {
    // The other half, and the half that is the engine's claim rather than the
    // projection's. If `setup()` ever stopped writing `restrictions: []` the wire
    // assertion above would start failing, and it should — but the diagnosis belongs
    // here, where it is one line: `undefined` is legal in the TYPE and illegal in
    // anything the engine builds.
    const cases: GameState[] = [shippedState()];
    const reachedState = reached;
    if (reachedState !== null) cases.push(reachedState);
    for (const s of cases) {
      for (const pid of s.turnOrder) {
        expect(
          Array.isArray(s.players[pid]?.restrictions),
          `${pid} has no restrictions array in the engine state`,
        ).toBe(true);
      }
    }
  });

  it('and the rules the payload would have to show are legible from it', () => {
    // Not a leak assertion — the opposite one. A `Restriction` that arrived without
    // its `kind`, its `remaining` or its deadline would be a field the client cannot
    // render: "you cannot buy" needs to know WHAT is owed, and "the tax lasts until
    // turn 9" needs the turn. So the shape the client depends on is pinned here, and
    // it is pinned on the wire rather than on the state, because a projection that
    // narrowed the object would compile and ship.
    const s = stateOrThrow();
    const first = seats[0];
    if (first === undefined) throw new Error('no client');
    const wire = wireState(first.client);
    let checked = 0;
    for (const pid of s.turnOrder) {
      const got = wire.players[pid]?.restrictions;
      if (!Array.isArray(got)) continue;
      for (const entry of got as Record<string, unknown>[]) {
        expect(Object.keys(entry).sort(), 'a Restriction arrived narrowed').toEqual([
          'expiresTurn',
          'id',
          'kind',
          'remaining',
          'sourceCardId',
          'sourcePlayer',
          'value',
        ]);
        expect(['no-purchases', 'surcharge']).toContain(entry['kind']);
        expect(typeof entry['value']).toBe('number');
        expect(typeof entry['remaining']).toBe('number');
        expect(entry['expiresTurn'] === null || typeof entry['expiresTurn'] === 'number').toBe(true);
        checked += 1;
      }
    }
    expect(checked, 'no restriction was inspected — the shape assertion was vacuous').toBeGreaterThan(0);
  });
});

// ───────────────── the payload identifies the card, and that is WHY `order` needs the seed ─────────────────

/**
 * THE PENDING CARD'S ID IS NOT SECRET. IT IS WITHHELD AS A FIELD AND RECOVERABLE BY
 * CONTENT, AND THE DIFFERENCE IS THE WHO OF S2.
 *
 * ## WHAT IS ESTABLISHED HERE, AND IT IS A FACT ABOUT THE WIRE
 *
 * `secret-state.test.ts` proves the pending card's id never APPEARS in a viewer's
 * payload, and that is true. It is also, on this corpus, not the same as "the card is
 * not identifiable", because `PublicQuestion` publishes the question, both printed
 * answers and both Ideologues — and the Ideology corpus is public JSON in this
 * repository. So the key a client would look up is
 *
 *     (question, the SET of printed sides)
 *
 * and the set rather than the tuple is forced on it: the client does not know `order`,
 * so a lookup that compared side POSITION would be wrong on every `ba` card.
 *
 * Measured over the shipped 76 Ideology Cards: **76 distinct keys for 76 cards, zero
 * collisions.** There is no ambiguity to exploit and none to rely on.
 *
 * ## WHY THAT MATTERS, AND IT IS A RULING NOT A FINDING ABOUT A LEAK
 *
 * `orderFor` folds `state._seed` into the presentation-order draw, and the audit read
 * that fold as a removable convenience: its first listed mitigation was "derive the
 * order from a value that is already public (`turn`, the seat index, the card id
 * alone) rather than from the cursor". **That mitigation is a regression, and this test
 * is why.**
 *
 * If `order` were a function of public state and the card id, then a client that can
 * identify the card — which is every client, as above — could compute `order` itself,
 * and with `ideologue` printed beside each answer the position-to-Ideologue lookup
 * that PLAN.md §2 amendment A' exists to withhold would be rebuilt in one line. The
 * seed fold is the ONLY thing standing between the table and that channel.
 *
 * `secret-state.test.ts` already pins the consequence ("a different match seed gives a
 * different order for the same card"), and that assertion is load-bearing rather than
 * decorative. This file pins the PREMISE it rests on, because the premise is a property
 * of the corpus and of `PublicQuestion` and neither of those files says so.
 *
 * ## WHAT IS STILL TRUE, AND IT IS THE PART THAT IS NOT FIXED HERE
 *
 * The seed is 31 bits (`newSeed` masks to `0x7fffffff`), the `order` draw publishes one
 * bit of it per card the seat answers, and a 4-hour game has a seat answering roughly
 * eight to fifteen cards — so a table that pools its answers has more than 31 bits
 * about a 31-bit value. Recovering it is an exhaustive search, not an inversion, so it
 * needs `orderFor`'s constants; those are in this package's source and not on the wire,
 * so it is not exploitable by a network attacker today. It becomes exploitable the
 * moment the construction is disclosed — a fork, a client that reimplements the order,
 * a source leak, a write-up.
 *
 * **This cannot be fixed inside `packages/server`.** Every mitigation that removes the
 * fold publishes A'; every mitigation that keeps it keeps the oracle. The fix is a
 * second, independent secret with more entropy than the table can publish — a
 * `_`-prefixed salt in `GameState`, minted by `setup` beside the seed and persisted
 * with it. That is an engine change (`GameState`, `setup`, `ServerOnlyKeys`, and an
 * entry in `secret-state.test.ts`'s inventory), and it is recorded on `orderFor` rather
 * than half-implemented here.
 */
describe('the open question identifies exactly one card, which is what makes the seed fold load-bearing', () => {
  /**
   * The lookup key a client can build from `openQuestion` alone.
   *
   * The `.sort()` is the load-bearing detail and it is not decoration: `openQuestion`
   * publishes the two sides in DISPLAY order, and a client that has not been told
   * `order` cannot tell which display position is side 0. So the only comparison
   * available to it is order-insensitive, and a key built on tuple order would match
   * only the `ab` cards — 26 of 76 on this corpus, which is exactly what a first
   * version of this probe measured before the sort was added.
   */
  function publishedKey(
    question: string,
    sides: readonly { readonly label: string; readonly ideologue: string }[],
  ): string {
    return JSON.stringify([question, sides.map((s) => [s.label, s.ideologue]).sort()]);
  }

  it('the lookup is unique over the shipped Ideology deck, and the corpus cannot be vacuous', () => {
    const cards = realCards();
    const ids = Object.keys(cards.ideology);
    // A VACUITY FLOOR, not a corpus fact: the shipped Ideology corpus has dozens of cards
    // and this only has to say "enough for a uniqueness claim to mean something".
    expect(ids.length, 'the Ideology corpus is empty — this block proves nothing').toBeGreaterThan(8);

    const byKey = new Map<string, string[]>();
    for (const id of ids) {
      const card = cards.ideology[id];
      if (card === undefined) throw new Error(`the index cannot read ${id}`);
      const k = publishedKey(
        card.question,
        card.sides.map((s) => ({ label: s.answer, ideologue: s.ideologue })),
      );
      byKey.set(k, [...(byKey.get(k) ?? []), id]);
    }

    expect(byKey.size, 'two Ideology Cards publish the same question and the same two sides').toBe(ids.length);
    // Named, because it is the specific thing the ruling rests on: a collision is what
    // would make the id genuinely unidentifiable, and there are none.
    const collisions = [...byKey.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${v.join('/')} share ${k}`);
    expect(collisions, 'the published key is ambiguous, so the id IS protected').toEqual([]);
  });

  it('and the lookup resolves against what the server withheld, on real states', () => {
    // The end-to-end half: real `setup` output, the server's own `openQuestionFor`, and
    // a match against the withheld id. This is the measurement that turned "the id is
    // withheld" into "the id is recoverable", and it is why the seed fold cannot be
    // simplified away.
    const cards = realCards();
    const byKey = new Map<string, string[]>();
    for (const id of Object.keys(cards.ideology)) {
      const card = cards.ideology[id];
      if (card === undefined) continue;
      const k = publishedKey(
        card.question,
        card.sides.map((s) => ({ label: s.answer, ideologue: s.ideologue })),
      );
      byKey.set(k, [...(byKey.get(k) ?? []), id]);
    }

    let probed = 0;
    let recovered = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const base = setup({
        players: ['p1', 'p2'],
        names: { p1: 'Ada', p2: 'Bo' },
        cards,
        seed,
        ...decksOf(cards),
      });
      const withheld = base._ideologyDraw[0];
      if (withheld === undefined) continue;
      // Exactly the state shape `openQuestionFor` projects from: the answer phase with
      // a pending card. Built by spreading rather than by reaching into the engine.
      const s: GameState = { ...base, phase: 'answer', _pendingCard: withheld };
      const open = viewFor(s, cards, null).openQuestion;
      if (open === null) continue;
      probed += 1;

      const hit = byKey.get(publishedKey(open.question, open.sides)) ?? [];
      // Uniqueness rather than a count, which is the same claim and is also the shape
      // `corpus-drift.test.ts` recognises as a rule rather than a corpus fact: one
      // distinct answer is not "the deck happened to have this many cards".
      expect(new Set(hit).size, `the published question matched ${hit.length} cards, so the id is ambiguous`).toBe(1);
      if (hit[0] === withheld) recovered += 1;
    }
    expect(probed, 'no seed produced an answer-phase state — the probe was empty').toBeGreaterThan(0);
    expect(
      recovered,
      'a client could NOT identify the card from the payload, so the seed fold is redundant and the audit mitigation applies',
    ).toBe(probed);
  });
});
