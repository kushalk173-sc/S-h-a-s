/**
 * THE SEAT SEAL — a connection's credential changes by PROOF, never by REQUEST.
 *
 * WHAT USED TO BE HERE, AND WHY THIS FILE IS THE REPLACEMENT RATHER THAN A NEW ONE
 *
 * The previous version of this file was four CHARACTERISATION tests asserting that the
 * hole was OPEN, and its header said so: "They assert what the server DOES today, not
 * what it should do; `src/` is not this file's to change." The last engineer left it
 * that way on purpose, because the client half of the fix had landed and the server
 * half had not, and a suite that goes red when half a fix lands is a suite nobody can
 * merge around.
 *
 * The server half has now landed, so the characterisation is over and these are
 * ordinary assertions of ordinary behaviour. The bug, in one paragraph, because the
 * shape is worth remembering:
 *
 *   Four messages in `packages/server/src/index.ts` minted a fresh `SessionRecord`
 *   and wrote it over `conn.session`: `#createLobby`, `#joinLobby` (both branches)
 *   and `#spectate`. Not one of them ended the record it displaced, and not one of
 *   them asked what the connection was holding. So a SEATED client could send
 *   `lobby:spectate` and be ACCEPTED WITH NO ERROR, and would then be holding a
 *   credential naming a lobby rather than the match its seat was in — every
 *   `match:action` refused `NOT_IN_LOBBY`, while `room.seats` still listed the seat
 *   as `connected`, so `allSeatsExpired` was false and nothing timed out. The turn
 *   simply stopped arriving. The only escape was `session:resume` from a different
 *   socket, and it worked *because* the displaced record had never been ended.
 *
 * THE FIX, IN TWO PARTS, AND BOTH ARE HERE
 *
 *  1. **`#refuseSeatHandover`, in `#handle`.** Every message in `MINTING` — the four
 *     that exchange a credential — is refused outright for a connection whose session
 *     names a live match. Not "you may not spectate": a connection holding a seat may
 *     not stop holding it by ASKING. Losing a seat is what `session:resume` is for,
 *     because it is the only path that carries the seat's own token.
 *  2. **`#adoptSession`, at every one of the four assignment sites.** The displaced
 *     record is `end`ed (so its token stops resolving the instant it is displaced),
 *     and a displaced LIVE SEAT is marked disconnected, so the room stops reporting a
 *     player as present on a socket that has left. Part 1 is the fix; part 2 is what
 *     makes it structural rather than a rule four call sites have to remember.
 *
 * Every test below drives real sockets against the real server. Section A is the
 * regression the bug report was about, section B is the backstop, and section C pins
 * the two things the fix must NOT do — a legitimate handover has to keep working, and
 * an ended record has to actually stop resolving.
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

/** A running two-seat match over real sockets, with every credential in hand. */
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
 * `END_TURN` is used because it is a no-op-ish action the reducer refuses from a seat
 * that is not on move, so "refused with ILLEGAL_ACTION" is the healthy reading.
 * `NOT_IN_LOBBY` is produced by `#dispatch` BEFORE the room is consulted, so it means
 * the connection's own credential no longer names the room — which was the signature
 * of the orphan.
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
 * `LobbyHub#startMatch` deletes the lobby once the match exists, so the id cannot be
 * read off the hub afterwards — which is exactly why a stale client still has it. This
 * is the frame the orphaned client sent.
 */
function lobbyIdOn(seat: Seat): string {
  const all = seat.client.ever('session:granted');
  const id = all[all.length - 1]?.session.lobbyId ?? '';
  if (id === '') throw new Error(`${seat.playerId}'s session names no lobby — the fixture is wrong, not the server`);
  return id;
}

// ─────────────── A. the regression: a seated client cannot give its seat away ───────────────

describe('a SEATED client cannot spectate its own seat away', () => {
  /**
   * `lobby:spectate` from a seated connection — the exact frame that hung the table.
   *
   * The whole test is the negative, because the bug had no error to assert on: the
   * server ACCEPTED it. So the assertions are (a) it is refused, (b) the connection's
   * credential is byte-for-byte the one it already had, and (c) the seat is still
   * drivable by the socket that holds it.
   */
  it('lobby:spectate from a seated connection is REFUSED and the seat keeps working', async () => {
    const { h, matchId, seats } = await liveMatch();
    const host = seats[0];
    if (host === undefined) throw new Error('no host');
    const room = h.server.hub.rooms.get(matchId);
    if (room === undefined) throw new Error('no room');

    // 0. IT COULD ACT A MOMENT AGO. Stated so "it can still act afterwards" is a
    //    property of the fix rather than of the fixture.
    expect(await refusalCode(host.client), 'the host was already locked out of its own table').not.toBe('NOT_IN_LOBBY');
    const seatSessionId = host.client.latestSession().sessionId;
    const seatToken = host.client.tokenFor(matchId);
    const viewIdBefore = room.viewId;
    const recordsBefore = h.server.sessions.all().length;

    // 1. REFUSED. An `error`, no new credential, no room view.
    host.client.clear();
    host.client.send({ t: 'lobby:spectate', lobbyId: lobbyIdOn(host) });
    const refused = await host.client.expect(host.client.is('error'), 'the seat handover to be refused');
    expect(refused.code, 'the refusal used a code that does not mean "the server refuses this"').toBe('ILLEGAL_ACTION');
    expect(refused.message, 'the refusal text is not a fixed literal').toBe(
      'you are seated in a match; resume your session to change seats',
    );
    expect(host.client.all('session:granted'), 'the connection was handed a NEW credential anyway').toEqual([]);
    expect(host.client.all('lobby:state'), 'the connection was moved into a room view anyway').toEqual([]);

    // 2. THE CREDENTIAL IS UNCHANGED. Same record, and the token it carries is still
    //    the seat's — which is the thing the old code silently broke.
    expect(host.client.latestSession().sessionId, 'the session record was replaced').toBe(seatSessionId);
    expect(host.client.tokenFor(matchId), 'the seat token rotated under a refused frame').toBe(seatToken);
    expect(h.server.sessions.all().length, 'the refused frame minted a session record').toBe(recordsBefore);

    // 3. THE SEAT IS STILL THE SEAT'S, AND STILL DRIVABLE. This is the whole point:
    //    no credential for a room the connection can no longer address, and no room
    //    that thinks a player is present on a socket that has left.
    const seatAfter = room.seat(host.playerId);
    expect(seatAfter, 'the seat was released').toBeDefined();
    expect(seatAfter?.connected, 'the room thinks the seat went away — it did not').toBe(true);
    expect(seatAfter?.resumeHash, 'the seat lost its token hash').not.toBe('');
    expect(room.viewId, 'the refused frame advanced the room').toBe(viewIdBefore);
    expect(await refusalCode(host.client), 'the seat can no longer act at its own table').not.toBe('NOT_IN_LOBBY');
  });

  /**
   * The other three messages in `MINTING`, in one table.
   *
   * `lobby:spectate` was the reported frame and the other three are the same defect
   * with a different disguise, so they are asserted together rather than one at a time:
   * a table is the honest shape of "these four are one rule", and a future fifth
   * message that replaces a credential has to be added here as well as to `MINTING`.
   */
  it('every message that replaces a credential is refused for a seated connection', async () => {
    for (const frame of [
      { t: 'lobby:spectate', lobbyId: '' },
      { t: 'match:spectate', matchId: '' },
      { t: 'lobby:create', name: 'Ada', maxPlayers: 2 as const, isPrivate: false },
      { t: 'lobby:join', lobbyId: 'l_nope', name: 'Ada' },
    ]) {
      const { h, matchId, seats } = await liveMatch();
      const host = seats[0];
      if (host === undefined) throw new Error('no host');
      const lobbyId = lobbyIdOn(host);
      const before = host.client.latestSession().sessionId;

      host.client.clear();
      // The ids are filled in per-iteration so each frame is otherwise well formed and
      // the refusal can only be the seat seal and not a decoder's complaint about a
      // missing field.
      const payload =
        frame.t === 'lobby:spectate' ? { ...frame, lobbyId } : frame.t === 'match:spectate' ? { ...frame, matchId } : frame;
      host.client.send(payload);

      const err = await host.client.expect(host.client.is('error'), `${frame.t} to be refused`);
      expect(err.message, `${frame.t} was refused for the wrong reason: ${err.message}`).toBe(
        'you are seated in a match; resume your session to change seats',
      );
      expect(host.client.latestSession().sessionId, `${frame.t} replaced the credential`).toBe(before);
      expect(h.server.hub.rooms.get(matchId)?.seat(host.playerId)?.connected, `${frame.t} disconnected the seat`).toBe(
        true,
      );

      await h.close();
      harness = null;
    }
  });

  it('session:resume still moves a seat — the refusal is not "no seat may ever change"', async () => {
    // The negative control, and it matters because the fix could have been written as
    // "refuse every session replacement", which would have closed the seat-orphan hole
    // by making reconnects impossible. `session:resume` is the ONE path that carries
    // proof, so it is the one path that still works.
    const { h, matchId, seats } = await liveMatch();
    const host = seats[0];
    if (host === undefined) throw new Error('no host');
    const token = host.client.tokenFor(matchId);

    // A DIFFERENT socket, which is what a refresh actually is.
    const reopened = await TestClient.connect(h.url);
    clients.push(reopened);
    reopened.send({ t: 'session:resume', resumeToken: token });
    const granted = await reopened.expect(reopened.is('session:granted'), 'the seat came back');
    expect(granted.session.role, 'the resume did not come back as a player').toBe('player');
    expect(granted.session.playerId, 'the resume came back as a different seat').toBe(host.playerId);
    expect(granted.session.matchId, 'the resume is not in the match').toBe(matchId);
    expect(h.server.hub.rooms.get(matchId)?.seat(host.playerId)?.connected, 'the seat is not connected after the resume').toBe(
      true,
    );
    expect(await refusalCode(reopened), 'the resumed seat cannot act').not.toBe('NOT_IN_LOBBY');

    // …and on the SAME socket, which is the re-rotate path: the record is found in
    // memory, so `#adoptSession` must NOT end it. If it did, the resume would destroy
    // the very credential it just verified.
    reopened.clear();
    reopened.send({ t: 'session:resume', resumeToken: reopened.latestSession().resumeToken });
    const again = await reopened.expect(reopened.is('session:granted'), 'the same-socket resume');
    expect(again.session.sessionId, 'a same-socket resume replaced its own record').toBe(granted.session.sessionId);
    expect(await refusalCode(reopened), 'the seat lost itself by resuming twice').not.toBe('NOT_IN_LOBBY');
  });
});

// ─────────────── B. the backstop: no replacement leaks a record ───────────────

describe('no session replacement leaks the record it displaced', () => {
  it('an UNSEATED connection replacing its credential ends the old record and its token', async () => {
    // Part 1 of the fix is a rule; part 2 is the structure. This is part 2, on the one
    // path a legitimate user takes: give up a waiting-room seat, join another room.
    //
    // `lobby:join` over a LOBBY membership is the contrast the old file ended on. It
    // displaced a record without ending it too — that was never the harmful case,
    // because the record named a room that still existed and held no match — but it
    // was still two live credentials for one socket, and now it is one.
    const h = await boot();
    const a = await TestClient.connect(h.url);
    clients.push(a);
    a.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 5, isPrivate: false });
    const created = await a.expect(a.is('lobby:state'), 'the lobby');
    const firstSessionId = a.latestSession().sessionId;
    const firstToken = a.latestSession().resumeToken;
    expect(a.latestSession().lobbyId, 'the created lobby named no lobby on the session').toBe(created.lobby.lobbyId);

    const b = await TestClient.connect(h.url);
    clients.push(b);
    b.send({ t: 'lobby:create', name: 'Cy', maxPlayers: 5, isPrivate: false });
    await b.expect(b.is('lobby:state'), 'the other lobby');
    const otherLobby = b.latestSession().lobbyId;
    if (otherLobby === null) throw new Error('the second lobby named no lobby — fixture is wrong');

    const recordsBefore = h.server.sessions.all().length;
    a.clear();
    a.send({ t: 'lobby:join', lobbyId: otherLobby, name: 'Ada' });
    await a.expect(a.is('lobby:state'), 'a joined the other room');

    // THE RECORD IS GONE. One socket, one live credential — the property the whole
    // file is about, asserted on the store rather than on the socket.
    const after = h.server.sessions.all();
    expect(
      after.filter((r) => r.sessionId === firstSessionId),
      'the displaced lobby record survived: a second live credential for one socket',
    ).toEqual([]);
    expect(after.length, 'the join created an extra record instead of replacing one').toBe(recordsBefore);
    expect(
      h.server.sessions.find(firstToken),
      'the displaced record\'s resume token still resolves — one socket, two credentials',
    ).toBeUndefined();

    // AND THE CLIENT IS TOLD, in the order that makes the sequence mean something:
    // `session:ended` (the old credential is gone, everything derived from it is
    // meaningless) BEFORE `session:granted` (here is the new one). The reverse order
    // would wipe the session the same exchange is granting.
    expect(a.ever('session:ended'), 'the client was never told its credential was replaced').toHaveLength(1);
    expect(
      a.ever('session:ended')[0]?.reason,
      'the ended message carries no reason, so the client cannot tell it from a kick',
    ).toBe('replaced by a new session on this connection');
    expect(
      a.received.map((m) => m.t),
      'the sequence did not run ended-then-granted',
    ).toEqual(['session:ended', 'session:granted', 'lobby:state']);
    expect(a.latestSession().lobbyId, 'the join did not take effect').toBe(otherLobby);
  });

  it('a displaced LIVE seat is marked disconnected, so the room stops reporting a ghost', async () => {
    // The structural half of the backstop, and the one that only matters if a future
    // path gets past `#refuseSeatHandover`. A seat left `connected` by a socket that
    // has left is the hang itself: `allSeatsExpired` cannot fire, so nothing is ever
    // released.
    //
    // `session:resume` onto a DIFFERENT match is the one handover the seal still
    // permits, because it carries a token — and it is therefore the only way a live
    // seat can be displaced at all, which is worth pinning: the seal means this branch
    // is now a BACKSTOP rather than the primary defence.
    const h = await boot();
    const seatIn = async (): Promise<{ token: string; playerId: string; matchId: string }> => {
      const host = await TestClient.connect(h.url);
      clients.push(host);
      host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
      const created = await host.expect(host.is('lobby:state'), 'a lobby');
      const guest = await TestClient.connect(h.url);
      clients.push(guest);
      guest.send({ t: 'lobby:join', lobbyId: created.lobby.lobbyId, name: 'Bo' });
      await guest.expect(guest.is('lobby:state'), 'the second player joined');
      host.send({ t: 'lobby:start' });
      const started = await host.expect(host.is('match:state'), 'the match started');
      await guest.expect(guest.is('match:state'), 'the guest is seated');
      return { token: host.tokenFor(started.matchId), playerId: host.latestSession().playerId, matchId: started.matchId };
    };

    const first = await seatIn();
    const second = await seatIn();
    expect(h.server.hub.rooms.get(first.matchId)?.seat(first.playerId)?.connected, 'the first seat was never connected').toBe(
      true,
    );

    // One socket holding the first seat's credential, then that same socket reclaiming
    // the SECOND seat. The first room is left behind.
    const wanderer = await TestClient.connect(h.url);
    clients.push(wanderer);
    wanderer.send({ t: 'session:resume', resumeToken: first.token });
    const arrived = await wanderer.expect(wanderer.is('session:granted'), 'the first seat was reclaimed');
    expect(arrived.session.matchId, 'the first token did not address the first match').toBe(first.matchId);

    wanderer.clear();
    wanderer.send({ t: 'session:resume', resumeToken: second.token });
    const moved = await wanderer.expect(wanderer.is('session:granted'), 'the second seat was reclaimed');
    expect(moved.session.matchId, 'the second token did not address the second match').toBe(second.matchId);

    // THE GHOST IS GONE FROM THE ROOM'S ACCOUNTING, but the seat is NOT released and
    // its credential is not thrown away: a game that is still being played keeps its
    // turn waiting for a player who closed a tab, which is the rule `#onClose` has
    // always followed.
    const seat = h.server.hub.rooms.get(first.matchId)?.seat(first.playerId);
    expect(seat, 'the seat was RELEASED, which is a different fix and the wrong one').toBeDefined();
    expect(seat?.connected, 'the room still reports a player on a socket that has left it').toBe(false);
    expect(seat?.resumeHash, 'the seat lost its token hash, so the game could not be resumed at all').not.toBe('');

    // …and the credential the socket walked away from is dead, which is what makes
    // "one socket, one live credential" true rather than aspirational.
    expect(h.server.sessions.find(first.token), 'the displaced seat\'s token still resolves').toBeUndefined();
    expect(h.server.sessions.all().filter((r) => r.playerId === first.playerId), 'the displaced record is still in the store').toEqual(
      [],
    );
  });
});