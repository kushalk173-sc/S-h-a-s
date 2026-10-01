/**
 * Reconnect, rehydration, and the resume credential.
 *
 * This is PLAN.md risk #5 turned into a test rather than a hope: a 4–6 hour match
 * must survive a refresh, a deploy, and a two-hour absence, and the player who
 * comes back must find the board exactly as they left it, in the correct phase,
 * with their own view.
 *
 * Three separate claims, tested separately because they fail differently:
 *
 *   A. REHYDRATION IS IDENTICAL. A room rebuilt from `(seed, actionLog)` after the
 *      process went away is byte-identical to the room that was there before,
 *      including the card that is face down and the PRNG cursor. If it is not, the
 *      deterministic reducer has been broken and the action log is not the source
 *      of truth it claims to be.
 *
 *   B. RESUME IS SAFE. A token cannot be guessed, cannot be reused, cannot be used
 *      in another room, and is rotated on every use. A leaked token is single-use
 *      damage, not a permanent seat takeover.
 *
 *   C. RESUMING MID-ANSWER RE-DELIVERS THE PROMPT, AND STILL WITHOUT THE PAYOUT.
 *      The blind prompt is rebuilt from the rehydrated state and the order is a
 *      pure function of that state, so the player sees the same two labels in the
 *      same order — otherwise a click they already made gets reinterpreted.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { CardIndex, GameState } from '@shasn/engine';

import { replay, InMemoryMatchStore, cardsVersion, rulesVersion } from '../src/store.ts';
import { advance, digest, TestClient, bigCards, startHarness, type Harness } from './fixtures.ts';
import type { ServerMessage, Session } from '../src/protocol.ts';

let harness: Harness | null = null;
const clients: TestClient[] = [];

async function boot(): Promise<Harness> {
  const h = await startHarness({ dispatchRate: 500 });
  harness = h;
  return h;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  if (harness !== null) {
    await harness.close();
    harness = null;
  }
});

/** Seat two players, start a match, return their sockets and their sessions. */
async function seatedGame(h: Harness): Promise<{
  a: TestClient;
  b: TestClient;
  sessionA: Session;
  sessionB: Session;
  matchId: string;
}> {
  const a = await TestClient.connect(h.url);
  clients.push(a);
  a.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
  const aLobby = await a.expect(a.is('lobby:state'), 'a lobby');
  const lobbyId = aLobby.lobby.lobbyId;

  const b = await TestClient.connect(h.url);
  clients.push(b);
  b.send({ t: 'lobby:join', lobbyId, name: 'Bo' });
  await b.expect(b.is('lobby:state'), 'b lobby');

  a.send({ t: 'lobby:start' });
  const first = await a.expect(a.is('match:state'), 'match:state for a');
  await b.expect(b.is('match:state'), 'match:state for b');

  const sessionA = a.ever('session:granted').at(-1)?.session;
  const sessionB = b.ever('session:granted').at(-1)?.session;
  if (sessionA === undefined || sessionB === undefined) throw new Error('no sessions issued');

  return { a, b, sessionA, sessionB, matchId: first.matchId };
}

const lastState = (c: TestClient): Extract<ServerMessage, { t: 'match:state' }> => {
  const all = c.ever('match:state');
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('no match:state');
  return last;
};

// ─────────────────────────── A. rehydration ───────────────────────────

describe('A — a room rebuilt from the action log is identical', () => {
  it('replays (seed, rules, cards, log) to a byte-identical state', async () => {
    const h = await boot();
    const { a, b, matchId } = await seatedGame(h);

    const seats = [
      { client: a, playerId: a.latestSession().playerId },
      { client: b, playerId: b.latestSession().playerId },
    ];
    const moved = await advance(seats, 8);
    expect(moved, 'the table did not accept any actions').toBeGreaterThan(3);

    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const live: GameState = room.state;
    const liveViewId = room.viewId;

    // Rehydrate from the store alone — a fresh Room, no reference to the live one.
    const stored = await h.store.get(matchId);
    if (stored === null) throw new Error('nothing stored');
    const rebuilt = replay({ stored, ctx: h.ctx });

    expect(rebuilt.viewId).toBe(liveViewId);
    // `JSON.stringify` rather than `toEqual`, because a snapshot-cache refactor
    // that changed key ORDER would be invisible to a structural comparison and
    // would still be fine — but key order here is a cheap canary for the store
    // having rebuilt the object by a different route than the reducer did.
    expect(JSON.stringify(rebuilt.state)).toBe(JSON.stringify(live));
  });

  it('a restarted server brings every match back, and the table keeps playing', async () => {
    const h = await boot();
    const store = h.store;
    const { a, b, matchId } = await seatedGame(h);

    const seats = [
      { client: a, playerId: a.latestSession().playerId },
      { client: b, playerId: b.latestSession().playerId },
    ];
    expect(await advance(seats, 8)).toBeGreaterThan(3);
    const beforeViewId = a.latestState().viewId;
    const before = a.latestState().state;

    // Simulate the deploy: a brand-new process, the SAME store, the same cards.
    const h2 = await startHarness({ store, cards: h.ctx.cards });
    const restored = await h2.server.hub.restoreAll();
    expect(restored.restored).toBe(1);
    expect(restored.skipped).toEqual([]);

    const room = h2.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('the match did not come back');
    // Compare PROJECTIONS, not raw states: what the client saw before the restart
    // is a ClientState, and the room holds a GameState. Comparing them directly
    // would always differ. Digests, for the reason above.
    const playerId = a.latestSession().playerId;
    expect(digest(room.viewFor(playerId).state)).toBe(digest(before));
    expect(room.viewId).toBe(beforeViewId);
    // And it is live: a client can resume and move. The move has to be the one the
    // CURRENT phase allows — after eight plies it is not necessarily an answer,
    // and dispatching a hardcoded ANSWER would be refused by the engine for a
    // reason that has nothing to do with the restart.
    const c = await TestClient.connect(h2.url);
    clients.push(c);
    c.send({ t: 'session:resume', resumeToken: a.tokenFor(matchId) });
    const granted = await c.expect(c.is('session:granted'), 'resume after restart');
    expect(granted.session.matchId).toBe(matchId);
    const st = await c.expect(c.is('match:state'), 'state after restart');
    expect(st.viewId).toBe(beforeViewId);
    expect(digest(st.state)).toBe(digest(before));

    const move = st.state.phase === 'answer' ? { type: 'ANSWER', side: 0 } : { type: 'END_TURN' };
    c.clear();
    c.send({ t: 'match:action', action: move });
    const after = await c.expect(c.is('match:state'), 'a move after restart');
    expect(after.viewId, 'the restored room did not accept a move').toBe(beforeViewId + 1);

    await h2.close();
  });

  it('refuses to replay a match whose card corpus changed underneath it', async () => {
    // The trade-off of replay-based recovery, stated as a test. A `cardsVersion`
    // mismatch is a correctness bug, not a warning: silently replaying a match
    // under different cards produces a game that diverges from the one the players
    // are in the middle of, which is worse than refusing to start.
    const h = await boot();
    const { matchId } = await seatedGame(h);
    const stored = await h.store.get(matchId);
    if (stored === null) throw new Error('nothing stored');

    // Same ids, different payouts: a balance tweak is exactly this.
    const tweaked = bigCards();
    const firstId = Object.keys(tweaked.ideology)[0];
    if (firstId === undefined) throw new Error('empty deck');
    const original = tweaked.ideology[firstId];
    if (original === undefined) throw new Error('missing card');
    const revised: CardIndex = {
      ...tweaked,
      ideology: { ...tweaked.ideology, [firstId]: { ...original, question: `${original.question} (revised)` } },
    };

    expect(cardsVersion(h.ctx.cards)).not.toBe(cardsVersion(revised));
    expect(() => replay({ stored, ctx: { rules: h.ctx.rules, cards: revised } })).toThrow(
      /different card corpus/,
    );
  });

  it('refuses to replay a match whose rules changed underneath it', async () => {
    // The other half of the version pin. A rules drift between match creation and
    // a restart is a correctness bug, not a warning: `resourceCap` feeds the
    // over-cap choice, `redrawCost` feeds a payment, `marketSize` decides how many
    // Voter Cards exist. Replaying under different numbers produces a game that
    // diverges from the one the players are in the middle of, which is strictly
    // worse than refusing to start.
    const h = await boot();
    const { matchId } = await seatedGame(h);
    const stored = await h.store.get(matchId);
    if (stored === null) throw new Error('nothing stored');

    const tweaked = { ...h.ctx.rules, resourceCap: 99 };
    expect(rulesVersion(tweaked)).not.toBe(rulesVersion(h.ctx.rules));
    expect(() => replay({ stored, ctx: { rules: tweaked, cards: h.ctx.cards } })).toThrow(
      /different rule set/,
    );
  });
});

// ─────────────────────────── B. the credential ───────────────────────────

describe('B — a resume token cannot be guessed, reused, or moved between rooms', () => {
  it('is 256 bits and not derivable from anything the client was told', async () => {
    const h = await boot();
    const { sessionA } = await seatedGame(h);
    expect(sessionA.resumeToken.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
    // Nothing a client received is the token, so nothing a client received can
    // reproduce it.
    const room = h.server.hub.rooms.get(sessionA.matchId ?? '');
    expect(sessionA.resumeToken).not.toBe(sessionA.playerId);
    expect(sessionA.resumeToken).not.toBe(sessionA.sessionId);
    if (room !== undefined) {
      for (const seat of room.seats) {
        expect(seat.resumeHash).not.toBe(sessionA.resumeToken);
        expect(seat.resumeHash).toHaveLength(64); // sha256 hex — the token is never stored
      }
    }
  });

  it('rejects a guessed token without saying whether the seat exists', async () => {
    const h = await boot();
    const { sessionA } = await seatedGame(h);
    const c = await TestClient.connect(h.url);
    clients.push(c);
    // Note: the empty string never reaches the resume path at all — the decoder
    // refuses it as `BAD_MESSAGE` before any lookup happens, which is the right
    // layer. Every other near-miss is a well-formed token that is simply wrong.
    const guesses = ['x', 'AAAA', sessionA.playerId, sessionA.sessionId, `${sessionA.resumeToken}x`, sessionA.resumeToken.slice(0, -1)];
    for (const guess of guesses) {
      c.clear();
      c.send({ t: 'session:resume', resumeToken: guess });
      const err = await c.expect(c.is('error'), `guess "${guess.slice(0, 12)}"`);
      expect(err.code, `guess "${guess.slice(0, 12)}"`).toBe('RESUME_INVALID');
      // A generic message: telling a caller "that seat exists but the token is
      // wrong" turns the error channel into a seat-existence oracle.
      expect(err.message).not.toContain(sessionA.playerId);
      expect(err.message).not.toContain(sessionA.sessionId);
    }

    c.clear();
    c.sendRaw(JSON.stringify({ t: 'session:resume', resumeToken: '' }));
    const empty = await c.expect(c.is('error'), 'empty token');
    expect(empty.code).toBe('BAD_MESSAGE');
  });

  it('ROTATES on every use, so a captured token is single-use', async () => {
    const h = await boot();
    const { a, sessionA } = await seatedGame(h);
    const original = sessionA.resumeToken;

    const c1 = await TestClient.connect(h.url);
    clients.push(c1);
    c1.send({ t: 'session:resume', resumeToken: original });
    const g1 = await c1.expect(c1.is('session:granted'), 'first resume');
    expect(g1.session.resumeToken).not.toBe(original);

    // Replaying the OLD token must now fail: whoever presents it first consumes it.
    const c2 = await TestClient.connect(h.url);
    clients.push(c2);
    c2.send({ t: 'session:resume', resumeToken: original });
    const err = await c2.expect(c2.is('error'), 'replay of a rotated token');
    expect(err.code).toBe('RESUME_INVALID');

    // The NEW token works, and the socket that used the old one is now stale.
    const c3 = await TestClient.connect(h.url);
    clients.push(c3);
    c3.send({ t: 'session:resume', resumeToken: g1.session.resumeToken });
    const g2 = await c3.expect(c3.is('session:granted'), 'second resume');
    expect(g2.session.resumeToken).not.toBe(g1.session.resumeToken);
    expect(g2.session.playerId).toBe(a.ever('session:granted').at(-1)?.session.playerId);
  });

  it('a token is bound to ONE room, and presenting it cannot reach another', async () => {
    const h = await boot();
    const first = await seatedGame(h);

    // A second, independent game in the same process.
    const a2 = await TestClient.connect(h.url);
    clients.push(a2);
    a2.send({ t: 'lobby:create', name: 'Cy', maxPlayers: 2, isPrivate: false });
    const l2 = await a2.expect(a2.is('lobby:state'), 'second lobby');
    const b2 = await TestClient.connect(h.url);
    clients.push(b2);
    b2.send({ t: 'lobby:join', lobbyId: l2.lobby.lobbyId, name: 'Dee' });
    await b2.expect(b2.is('lobby:state'), 'second join');
    a2.send({ t: 'lobby:start' });
    const s2 = await a2.expect(a2.is('match:state'), 'second match');
    expect(s2.matchId).not.toBe(first.matchId);

    const room2 = h.server.hub.rooms.get(s2.matchId);
    if (room2 === undefined) throw new Error('no second room');
    const seatsBefore = room2.seats.map((s) => ({ id: s.playerId, hash: s.resumeHash }));

    // Present room 1's token. There is no room id in the message, so the ONLY
    // thing the server can do is route by the token — and the token routes to room
    // 1. That is the property: a token cannot be aimed at a different table.
    const attacker = await TestClient.connect(h.url);
    clients.push(attacker);
    attacker.send({ t: 'session:resume', resumeToken: first.sessionA.resumeToken });
    const granted = await attacker.expect(attacker.is('session:granted'), 'cross-room resume');
    expect(granted.session.matchId, 'a token reached the wrong room').toBe(first.matchId);
    expect(granted.session.matchId).not.toBe(s2.matchId);

    // Room 2 is completely untouched: same seats, same token hashes.
    const room2After = h.server.hub.rooms.get(s2.matchId);
    if (room2After === undefined) throw new Error('room 2 vanished');
    expect(room2After.seats.map((s) => ({ id: s.playerId, hash: s.resumeHash }))).toEqual(seatsBefore);

    // And room 2's own credential still works, for its own seat.
    const good = await TestClient.connect(h.url);
    clients.push(good);
    good.send({ t: 'session:resume', resumeToken: a2.tokenFor(s2.matchId) });
    const ok = await good.expect(good.is('session:granted'), 'legitimate resume');
    expect(ok.session.matchId).toBe(s2.matchId);
  });

  it('a token does not survive a change to the seat\'s stored hash', async () => {
    // The durable lookup finds the ROW; the seat's own hash is what makes the
    // row's content authoritative. A store whose index row outlived the seat's
    // credential must not grant a seat.
    const h = await boot();
    const { a, matchId } = await seatedGame(h);
    const token = a.tokenFor(matchId);
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const playerId = a.latestSession().playerId;
    // Rotate the stored hash without rotating the token: the row and the seat now
    // disagree, and the seat wins.
    room.setTokenHash(playerId, 'f'.repeat(64));

    const c = await TestClient.connect(h.url);
    clients.push(c);
    c.send({ t: 'session:resume', resumeToken: token });
    const err = await c.expect(c.is('error'), 'stale index row');
    expect(err.code).toBe('RESUME_INVALID');
  });

  it('a disconnect HOLDS the seat rather than releasing it', async () => {
    const h = await boot();
    const { a, b, sessionA, matchId } = await seatedGame(h);
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const seat = room.seat(sessionA.playerId);
    if (seat === undefined) throw new Error('no seat');

    expect(seat.connected).toBe(true);
    await a.close();
    // Give the close event a turn of the loop to land.
    await new Promise((r) => setTimeout(r, 60));

    const after = h.server.hub.rooms.get(matchId)?.seat(sessionA.playerId);
    expect(after, 'the seat was RELEASED on disconnect — it must be held').toBeDefined();
    expect(after?.connected).toBe(false);
    // And the turn did not skip past them: the absent player is simply the one
    // who is not answering. Shasn is turn-based, so there is nothing to pause.
    expect(h.server.hub.rooms.get(matchId)?.state.turnOrder).toContain(sessionA.playerId);
    void b;
  });
});

// ─────────────────────────── C. mid-answer resume ───────────────────────────

describe('C — resuming mid-answer re-delivers the same blind prompt, with no payout', () => {
  it('re-sends the identical prompt on a different socket', async () => {
    const h = await boot();
    const { a, sessionA, matchId } = await seatedGame(h);

    // The active player is mid-answer with a card in front of them.
    const first = a.latestState();
    expect(first.state.phase).toBe('answer');
    expect(first.blind, 'the active player must be owed a prompt').not.toBeNull();
    const beforePrompt = first.blind;

    // Drop the connection entirely — the tab was closed, not the process.
    await a.close();
    await new Promise((r) => setTimeout(r, 60));

    const back = await TestClient.connect(h.url);
    clients.push(back);
    back.send({ t: 'session:resume', resumeToken: sessionA.resumeToken });
    await back.expect(back.is('session:granted'), 'resume');
    const state = await back.expect(back.is('match:state'), 'state on resume');

    expect(state.matchId).toBe(matchId);
    expect(state.state.phase).toBe('answer');
    // IDENTICAL, not merely equivalent: the order is a pure function of the match,
    // so a player who reconnects mid-answer is not shown a different left/right
    // than the one they were about to click.
    expect(state.blind).toEqual(beforePrompt);
    expect(state.blind?.order).toBe(beforePrompt?.order);
  });

  it('the re-delivered prompt still carries no payout, no card id and no ideologue', async () => {
    const h = await boot();
    const { a, sessionA, matchId } = await seatedGame(h);
    const beforePrompt = a.latestState().blind;
    await a.close();
    await new Promise((r) => setTimeout(r, 60));

    const back = await TestClient.connect(h.url);
    clients.push(back);
    back.send({ t: 'session:resume', resumeToken: sessionA.resumeToken });
    await back.expect(back.is('session:granted'), 'resume');
    const state = await back.expect(back.is('match:state'), 'state');

    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    const pending = room.state._pendingCard;
    const card = pending === null ? undefined : h.ctx.cards.ideology[pending];
    expect(card, 'expected a real pending card to audit against').toBeDefined();
    if (card === undefined) return;

    // The whole frame, not just the prompt: the resume path is a fresh projection
    // and a fresh projection is exactly where a leak would be introduced.
    const frame = JSON.stringify(state);
    expect(frame.includes(pending!)).toBe(false);
    expect(frame.includes(String(room.state._seed))).toBe(false);
    // The payout, structurally. `pays` is the field name on a card, so its
    // absence is the assertion — a `"funds":2` substring is meaningless because
    // a player's own pool legitimately contains those numbers.
    expect(frame.includes('"pays"')).toBe(false);
    for (const side of card.sides) {
      for (const [res, n] of Object.entries(side.pays)) {
        expect(
          frame.includes(`"${res}":${n}`) === false,
          `the frame carries a payout-shaped pair ${res}:${n}`,
        ).toBe(true);
      }
    }
    // And the prompt itself is the three-field shape and nothing else.
    expect(Object.keys(state.blind ?? {}).sort()).toEqual(['labels', 'order', 'question']);
    expect(beforePrompt).not.toBeNull();

    // NOT asserted, deliberately: that the Ideologue name is absent from the
    // frame. It cannot be. `players[].manifesto` is a public array of Ideologues —
    // a player's answered cards sit face up under their mat at a real table, and
    // the manifesto IS their public identity (rules-reference.md:190-191). So the
    // string "capitalist" is in every payload by design. What must not be present
    // is the *association* between this card and its sides, which is what the
    // three-field prompt type and the missing `pays` above actually establish.
  });

  it('a player who resumes mid-answer can then answer it, and only once', async () => {
    const h = await boot();
    const { a, sessionA } = await seatedGame(h);
    const order = a.latestState().blind?.order;
    await a.close();
    await new Promise((r) => setTimeout(r, 60));

    const back = await TestClient.connect(h.url);
    clients.push(back);
    back.send({ t: 'session:resume', resumeToken: sessionA.resumeToken });
    await back.expect(back.is('session:granted'), 'resume');
    await back.expect(back.is('match:state'), 'state');

    // Answer display index 0. The server maps it through the order to a real side,
    // and the client's index is never the card's own index.
    back.clear();
    back.send({ t: 'match:action', action: { type: 'ANSWER', side: 0 } });
    const after = await back.expect(back.is('match:state'), 'answered');
    expect(after.state.phase).toBe('actions');
    expect(after.blind).toBeNull();

    // A second answer for the same card is refused by the engine.
    back.clear();
    back.send({ t: 'match:action', action: { type: 'ANSWER', side: 0 } });
    const err = await back.expect(back.is('error'), 'double answer');
    expect(err.code).toBe('ILLEGAL_ACTION');
    void order;
  });

  it('match:sync always returns a FULL state, never a patch', async () => {
    // Deltas are where rehydration bugs live, and a diff of a state containing
    // eleven secret deck arrays is itself a leak vector. 60 KB once per reconnect
    // is irrelevant; a second thing to get right is not.
    const h = await boot();
    const { a } = await seatedGame(h);
    a.clear();
    a.send({ t: 'match:sync' });
    const one = await a.expect(a.is('match:state'), 'sync 1');
    a.clear();
    a.send({ t: 'match:sync' });
    const two = await a.expect(a.is('match:state'), 'sync 2');
    expect(digest(two.state)).toBe(digest(one.state));
    expect(Object.keys(two).sort()).toEqual(['blind', 'matchId', 'state', 't', 'viewId', 'you']);
  });
});
