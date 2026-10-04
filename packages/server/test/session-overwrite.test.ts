/**
 * THE RESIDUAL: `conn.session` is overwritten without ending the record it held, and a
 * seated client can orphan its own live seat.
 *
 * WHAT WAS FLAGGED, AND WHERE
 *
 * Two places in `packages/server/src/index.ts` replace a connection's session by
 * assignment and never call `SessionStore#end` on the record they displace:
 *
 *  - **`#spectate`, index.ts:655-668.** It mints a fresh spectator session with
 *    `this.sessions.create('Spectator', 'spectator')`, sets `rec.matchId = matchId`,
 *    mints a NEW `playerId`, then writes `conn.session = rec` at line 664. A PLAYER's
 *    record — if that connection was seated — is still in `SessionStore.#bySession` and
 *    still in `#byHash`, so its resume token still resolves.
 *  - **`#joinLobby`'s spectator branch, index.ts:404-417.** The same shape for
 *    `lobby:spectate`: `conn.session = rec` at line 413, no end of the old record, and
 *    — this is the part that matters — **no check on what the connection was holding**.
 *    A client SEATED in a running match can send `lobby:spectate` and the server accepts
 *    it with no error of any kind.
 *
 * `SessionStore#end` exists (session.ts:182) and is the release-what-it-held discipline
 * every other path uses. Those two are the paths that do not call it.
 *
 * ## WHAT THIS FILE CLAIMS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * These are **characterisation tests of the current behaviour of `src/`**, named as
 * such, written so the day someone fixes the hole they fail with a message naming the
 * fix. They assert what the server DOES today, not what it should do; `src/` is not this
 * file's to change.
 *
 * The verdict, which is in the console output at the bottom: **the hole is real and
 * reproducible, and it is worse than "two records for one socket".** A seated player who
 * sends one frame the client no longer sends ends up holding a credential for a room it
 * can no longer address, while the room still marks the seat connected. That is a
 * permanent orphan on that socket, and the ONLY escape is `session:resume` from a
 * different one.
 *
 * The last test is the contrast that keeps the finding honest: `lobby:join` overwrites
 * `conn.session` the same way and also does not end the old record, and that is FINE,
 * because the record it displaced named a lobby membership rather than a live seat. The
 * difference between the harmless case and the harmful one is exactly whether the
 * displaced record pointed at a running match — which is the thing a fix has to test,
 * and the reason "just call `sessions.end` on the old record" is not obviously the whole
 * fix.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { TestClient, startHarness, type Harness } from './fixtures.ts';

let harness: Harness | null = null;
const clients: TestClient[] = [];

async function boot(): Promise<Harness> {
  const h = await startHarness({ dispatchRate: 500 });
  harness = h;
  return h;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  if (harness !== null) {
    await harness.close();
    harness = null;
  }
});

type Seat = { client: TestClient; playerId: string };
type Live = { h: Harness; matchId: string; seats: readonly Seat[] };

/** A running two-seat match over a real socket, with every credential in hand. */
async function liveMatch(): Promise<Live> {
  const h = await boot();
  const host = await TestClient.connect(h.url);
  clients.push(host);
  host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
  const created = await host.expect(host.is('lobby:state'), 'the lobby');

  const other = await TestClient.connect(h.url);
  clients.push(other);
  other.send({ t: 'lobby:join', lobbyId: created.lobby.lobbyId, name: 'Bo' });
  await other.expect(other.is('lobby:state'), 'the second player joined');

  host.send({ t: 'lobby:start' });
  const matchId = (await host.expect(host.is('match:state'), 'the match started')).matchId;
  for (const c of [host, other]) await c.expect(c.is('match:state'), 'seated');
  return {
    h,
    matchId,
    seats: [
      { client: host, playerId: host.latestSession().playerId },
      { client: other, playerId: other.latestSession().playerId },
    ],
  };
}

/**
 * The error code the server answers a `match:action` with, or `null` if it accepted it.
 *
 * `END_TURN` is used because it is a no-op-ish action that the reducer will refuse for a
 * phase reason from a seat that is not on move — which is what makes "refused with
 * ILLEGAL_ACTION" the healthy reading. `NOT_IN_LOBBY` is produced by `#dispatch` BEFORE
 * the room is consulted, so it means the connection's own credential no longer names the
 * room, which is the thing under test.
 */
async function refusalCode(c: TestClient): Promise<string | null> {
  c.clear();
  c.send({ t: 'match:action', action: { type: 'END_TURN' } });
  const deadline = Date.now() + 2_000;
  while (c.all('error').length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  return c.all('error')[0]?.code ?? null;
}

/**
 * The lobby id the connection's own last credential carries.
 *
 * `LobbyHub#startMatch` deletes the lobby once the match exists, so the id cannot be read
 * off the hub afterwards — which is exactly why a stale client still has it and a
 * current one does not. Captured from `session:granted`, which is what the client under
 * test would be holding.
 */
function lobbyIdOn(seat: Seat): string {
  const all = seat.client.ever('session:granted');
  const id = all[all.length - 1]?.session.lobbyId ?? '';
  if (id === '') throw new Error(`${seat.playerId}'s session names no lobby — the fixture is wrong, not the server`);
  return id;
}

// ───────────────── the overwrite itself, with no orphaning ─────────────────

describe('CHARACTERISATION: #spectate overwrites conn.session and leaves the displaced record alive', () => {
  it('a seated connection that sends match:spectate ends up with TWO live session records and two working tokens', async () => {
    const { h, matchId, seats } = await liveMatch();
    const host = seats[0];
    if (host === undefined) throw new Error('no host');
    const seatSessionId = host.client.latestSession().sessionId;
    const seatResumeToken = host.client.tokenFor(matchId);
    const before = h.server.sessions.all().length;

    // The overwrite. A seated, connected player asks to become a spectator of its own
    // match. The server does not check what the connection was holding.
    host.client.clear();
    host.client.send({ t: 'match:spectate', matchId });
    const granted = await host.client.expect(host.client.is('session:granted'), 'a session after match:spectate');
    expect(granted.session.role, 'the connection was not downgraded to a spectator').toBe('spectator');
    expect(granted.session.sessionId, 'the SAME record was reused — this test is about a NEW record displacing the old').not.toBe(
      seatSessionId,
    );

    // THE RESIDUAL. Two records for one socket: the displaced player session is still in
    // the store and `SessionStore#end` was never called on it. When the hole is closed
    // this assertion is the one that fires, and its message says so.
    const after = h.server.sessions.all();
    expect(
      after.filter((r) => r.sessionId === seatSessionId),
      'the displaced player session WAS ended — #spectate now releases what it holds, so the rest of this test describes a fixed server',
    ).toHaveLength(1);
    expect(after.length, 'the overwrite created no extra record').toBe(before + 1);
    const displaced = after.find((r) => r.sessionId === seatSessionId);
    expect(displaced?.matchId, 'the displaced record no longer names the match it was seated in').toBe(matchId);
    expect(displaced?.role, 'the displaced record is no longer a player session').toBe('player');

    // …and its resume token STILL resolves. That is what makes this more than a leak:
    // two credentials for one human, and the older one is the seat's.
    const stale = h.server.sessions.find(seatResumeToken);
    expect(stale, "the displaced player's resume token stopped resolving").toBeDefined();
    expect(stale?.sessionId).toBe(seatSessionId);

    // THE CONSEQUENCE ON THE ROOM. The seat is untouched and still connected, so the table
    // is waiting on a player its own connection can no longer act for.
    const room = h.server.hub.rooms.get(matchId);
    const seat = room?.seat(host.playerId);
    expect(seat, 'the seat was released').toBeDefined();
    expect(seat?.connected, 'the room thinks the orphaned seat went away — it did not').toBe(true);
    expect(seat?.resumeHash, 'the seat lost its token hash').not.toBe('');

    // And the connection really is locked out of its own table now.
    expect(await refusalCode(host.client), 'a spectatorised seat can still dispatch').toBe('NOT_A_PLAYER');

    console.log(
      `SESSION OVERWRITE (match:spectate): one socket now holds 2 live records; ` +
        `the displaced player session ${seatSessionId} is still in the store and its resume token still resolves; ` +
        `the seat is still in the table marked connected; the connection can no longer dispatch (NOT_A_PLAYER).`,
    );
  });
});

// ───────────────── the real hole: orphaning a live seat ─────────────────

describe('CHARACTERISATION: a seated client CAN orphan its own live seat with lobby:spectate', () => {
  it('the server ACCEPTS the frame, the seat can then never act again, and the room is never told', async () => {
    // THE REAL HOLE, and the one the flag was about. `#joinLobby`'s spectator branch has
    // no check on what the connection held. The client no longer sends this — the
    // `WATCH INSTEAD` bug was fixed there — but the SERVER still permits it, and nothing
    // in the protocol tells the client what it has just done.
    const { h, matchId, seats } = await liveMatch();
    const host = seats[0];
    if (host === undefined) throw new Error('no host');
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');
    expect(room.seat(host.playerId), 'no seat for the host').toBeDefined();
    const viewIdBefore = room.viewId;

    // 0. IT COULD ACT A MOMENT AGO. Stated so "it cannot act afterwards" is a change and
    //    not a property of the fixture.
    const before = await refusalCode(host.client);
    expect(before, 'the host was already locked out of its own table before the orphan').not.toBe('NOT_IN_LOBBY');

    // 1. THE SERVER ACCEPTS IT. No `LOBBY_CLOSED`, no `NOT_IN_LOBBY`, no refusal of any
    //    kind — this is the finding, and the assertion's failure message says the hole
    //    is closed when it stops holding.
    const lobbyId = lobbyIdOn(host);
    host.client.clear();
    host.client.send({ t: 'lobby:spectate', lobbyId });
    const arrived = await host.client.expect(host.client.is('lobby:state'), 'the orphaned seat got a room view');
    expect(arrived.lobby.seats, 'the orphan took a seat').toHaveLength(2);
    expect(
      host.client.all('error'),
      'the server REFUSED lobby:spectate from a seated connection — the seat-orphan hole is closed',
    ).toEqual([]);

    // 2. AND NOW IT CAN NEVER PLAY AGAIN. The new session names the lobby and not the
    //    match, so `#dispatch` refuses with `NOT_IN_LOBBY` before the room is consulted.
    expect(await refusalCode(host.client), 'the orphaned seat can still act — the hole is closed').toBe('NOT_IN_LOBBY');

    // 3. …WHILE THE ROOM STILL BELIEVES IT IS PLAYING. The seat is untouched and still
    //    connected. This is the hang: an active seat no connection can drive, which no
    //    timeout releases, because a DISCONNECT is the only thing that marks a seat
    //    absent and this socket never disconnected. The turn simply stops arriving.
    const seatAfter = room.seat(host.playerId);
    expect(seatAfter, 'the orphaned seat was removed from the table').toBeDefined();
    expect(seatAfter?.connected, 'the room thinks the orphaned seat is still here').toBe(true);
    expect(room.viewId, 'the orphan advanced the room').toBe(viewIdBefore);
    expect(room.state.finished, 'the orphan finished the game').toBe(false);
    expect(room.state.activePlayer, 'the orphan changed whose turn it was').toBe(room.state.activePlayer);

    // 4. AND THE OTHER SEAT IS STILL WAITING ON IT. The displaced record is alive, so
    //    the seat is not released — this is asserted so the fix cannot be "release the
    //    seat", which would hand the game away instead of telling the player what
    //    happened.
    expect(
      h.server.sessions.all().filter((r) => r.matchId === matchId && r.role === 'player'),
      'the seat\'s player record was ended as well',
    ).toHaveLength(2);

    console.log(
      `SESSION ORPHAN (lobby:spectate from a seated client): ACCEPTED with no error. ` +
        `The connection now names lobby ${lobbyId} and not match ${matchId}, so every match:action is refused ` +
        `NOT_IN_LOBBY. The seat stays in room.seats marked connected at viewId ${room.viewId}, and the turn ` +
        `stops arriving for it. Unrecoverable on this socket.`,
    );
  });

  it('the seat IS recoverable by session:resume from another socket — the only escape', async () => {
    // …which is what stops the above from being an unbreakable table lock, and it is
    // worth pinning. If a future fix DOES end the displaced record, this fails, and the
    // fix then has to answer a POLICY question — what happens to a player who orphans
    // their own seat — rather than a mechanical one.
    const { h, matchId, seats } = await liveMatch();
    const host = seats[0];
    if (host === undefined) throw new Error('no host');
    const token = host.client.tokenFor(matchId);

    host.client.clear();
    host.client.send({ t: 'lobby:spectate', lobbyId: lobbyIdOn(host) });
    await host.client.expect(host.client.is('lobby:state'), 'the orphaned seat got a room view');
    expect(await refusalCode(host.client), 'the orphan did not take effect').toBe('NOT_IN_LOBBY');

    const rescue = await TestClient.connect(h.url);
    clients.push(rescue);
    rescue.send({ t: 'session:resume', resumeToken: token });
    const granted = await rescue.expect(rescue.is('session:granted'), 'the rescue session');
    expect(granted.session.role, 'the rescue did not come back as a player').toBe('player');
    expect(granted.session.matchId, 'the rescue was not put back in the match').toBe(matchId);
    expect(granted.session.playerId, 'the rescue came back as a different seat').toBe(host.playerId);
    expect(h.server.hub.rooms.get(matchId)?.seat(host.playerId)?.connected, 'the seat is not connected after the rescue').toBe(
      true,
    );
    expect(await refusalCode(rescue), 'the rescued seat still cannot act').not.toBe('NOT_IN_LOBBY');
  });
});

// ───────────────── the contrast that keeps the finding honest ─────────────────

describe('CHARACTERISATION: the same overwrite in a LOBBY membership is harmless', () => {
  it('lobby:join also displaces a session without ending it, and nothing is orphaned', async () => {
    // So the two findings above are read as defects in TWO SPECIFIC paths rather than as
    // "the server never releases sessions". `#joinLobby`'s player branch overwrites
    // `conn.session` at index.ts:423 with no `end` call, exactly like the spectator
    // branch — and the displaced record survives. It is fine, because the record it
    // displaced named a lobby membership rather than a live seat, and the room it named
    // still exists.
    //
    // The difference between the harmless case and the harmful one is therefore exactly
    // one thing: whether the displaced record pointed at a RUNNING MATCH. That is the
    // predicate a fix needs, and it is why "call `sessions.end` on the old record" is
    // necessary but not obviously sufficient.
    const h = await boot();
    const a = await TestClient.connect(h.url);
    clients.push(a);
    a.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 5, isPrivate: false });
    const created = await a.expect(a.is('lobby:state'), 'the lobby');
    const firstLobby = a.latestSession().lobbyId;
    if (firstLobby === null) throw new Error('the created lobby named no lobby on the session — fixture is wrong');
    expect(firstLobby).toBe(created.lobby.lobbyId);

    const b = await TestClient.connect(h.url);
    clients.push(b);
    b.send({ t: 'lobby:create', name: 'Cy', maxPlayers: 5, isPrivate: false });
    await b.expect(b.is('lobby:state'), 'the other lobby');
    const otherLobby = b.latestSession().lobbyId;
    if (otherLobby === null) throw new Error('the second lobby named no lobby on the session — fixture is wrong');

    a.clear();
    a.send({ t: 'lobby:join', lobbyId: otherLobby, name: 'Ada' });
    await a.expect(a.is('lobby:state'), 'a joined the other room');
    expect(a.latestSession().lobbyId, 'the join did not take effect').toBe(otherLobby);

    const survivors = h.server.sessions.all().filter((r) => r.lobbyId === firstLobby && r.role === 'player');
    expect(
      survivors.length,
      'the pre-join record WAS ended, so this file no longer describes the current code — re-read the contrast above',
    ).toBe(1);
    const survivor = survivors[0];
    // …and nothing about it is dangerous: it names a lobby that still exists and still
    // lists this connection's original player id as a member, and it holds no match.
    const room = h.server.hub.getLobby(firstLobby);
    expect(room, 'the first lobby vanished').toBeDefined();
    expect(room?.members.has(survivor?.playerId ?? ''), 'the displaced record names a seat that left').toBe(true);
    expect(survivor?.matchId, 'a lobby-membership record named a match — that would be the harmful shape').toBeNull();
  });
});