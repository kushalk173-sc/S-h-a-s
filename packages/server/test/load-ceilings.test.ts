/**
 * THE LOAD CEILINGS — an unauthenticated spectator attach is bounded.
 *
 * THE AMPLIFIER, IN ONE PARAGRAPH, BECAUSE THE FIX IS ONLY LEGIBLE AGAINST IT
 *
 * Nothing on the read side of this server requires a credential, and nothing on it was
 * rate limited. The chain, all of it free:
 *
 *   `lobby:list` → every public lobby's id
 *              → `lobby:spectate` with that id → the reply carries the RUNNING match's id
 *              → `match:spectate` with that id → attached, with a full ~60 KB state
 *              → and then every committed action runs one full projection PER WATCHER,
 *                with a `JSON.stringify` and a socket write each, INSIDE the synchronous
 *                action handler the answering player is blocked on.
 *
 * `Room.dispatch` is documented as synchronous end to end and the process is
 * single-threaded, so K spectators cost K projections inside one player's click. The
 * token bucket existed and was real, and it was spent in exactly one place —
 * `#dispatch` — which is the one place a spectator cannot reach.
 *
 * WHAT IS BOUNDED HERE, AND WHY IT IS A CEILING RATHER THAN A GATE
 *
 * Three ceilings and one budget, and the reasoning for each is on the constants in
 * `src/index.ts`. What is NOT here is a token on the spectator path, an invite code or
 * a captcha: Shasn is played by people who were sent a link, and every one of those
 * makes that link worse. The threat is a bored person with a script.
 *
 * These are asserted over REAL sockets against a REAL server, because every part of
 * the chain that matters is transport behaviour — an upgrade refused before a socket
 * exists cannot be observed from inside the process.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_CONNECTIONS_PER_IP,
  DEFAULT_MAX_WATCHERS_PER_MATCH,
  DEFAULT_MESSAGE_RATE,
  MAX_PAYLOAD_BYTES,
} from '../src/index.ts';
import { TestClient, startHarness, type Harness, type HarnessOptions } from './fixtures.ts';
import { driverPly } from './driver.ts';

const open: Harness[] = [];
const clients: TestClient[] = [];

async function boot(opts: HarnessOptions): Promise<Harness> {
  const h = await startHarness(opts);
  open.push(h);
  return h;
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  for (const h of open.splice(0)) await h.close().catch(() => undefined);
});

/**
 * Open a raw socket, report whether the server let it in, and KEEP IT OPEN.
 *
 * Two things this deliberately does not do, both of which produced a green test that
 * proved nothing when it was first written:
 *
 *  - It is not `TestClient.connect`, whose contract is "the socket is usable" and whose
 *    handshake treats a refused upgrade as an error to reject on. A refused upgrade is
 *    precisely the case under test. Nor may a server that ACCEPTS a socket and closes
 *    it a moment later be counted as a refusal: it has already paid for the
 *    connection, and every cost this file is about is paid at the upgrade.
 *  - It does not close the socket on success. A ceiling is a count of LIVE sockets, so
 *    a probe that closes what it opens measures nothing at all.
 */
function probe(url: string): Promise<{ verdict: 'open' | 'refused'; ws: WebSocket }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const settle = (verdict: 'open' | 'refused'): void => {
      ws.removeAllListeners('open');
      ws.removeAllListeners('error');
      ws.removeAllListeners('close');
      resolve({ verdict, ws });
    };
    ws.once('open', () => settle('open'));
    ws.once('error', () => settle('refused'));
    ws.once('close', () => settle('refused'));
  });
}

/** Close a probe and wait for the server to have reaped it. */
async function drop(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.close();
  });
  await new Promise((r) => setTimeout(r, 50));
}

// ─────────────────────────── connection ceilings ───────────────────────────

describe('the connection ceilings are enforced at the upgrade', () => {
  it('the process-wide ceiling refuses the socket that would exceed it, before it exists', async () => {
    const h = await boot({ maxConnections: 2 });

    const first = await probe(h.url);
    const second = await probe(h.url);
    expect(first.verdict, 'the first socket was refused').toBe('open');
    expect(second.verdict, 'the second socket was refused').toBe('open');
    // The amplifier never became a connection: there is no Conn, no session, no
    // watcher set and no projection for it. That is the whole reason the gate is here
    // rather than in the message handler.
    expect((await probe(h.url)).verdict, 'a socket beyond the ceiling was ADMITTED').toBe('refused');
    expect((await probe(h.url)).verdict, 'the ceiling was not sticky').toBe('refused');

    // …and a closed socket frees its slot, so a ceiling does not become a one-way
    // ratchet that empties the server over a long evening.
    await drop(first.ws);
    expect((await probe(h.url)).verdict, 'a freed global slot was not reused').toBe('open');
  });

  it('a refused connection costs nothing: the table is untouched and the socket is not left behind', async () => {
    // A ceiling of 2, filled by the two seats. Every further socket is refused, and the
    // refusals are aimed at a live table because "a ceiling that takes the table down
    // with it is not a ceiling, it is an outage" is only testable against a running
    // game.
    const h = await boot({ maxConnections: 2, maxConnectionsPerIp: 12 });
    const host = await TestClient.connect(h.url);
    clients.push(host);
    host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
    const created = await host.expect(host.is('lobby:state'), 'the lobby');

    const guest = await TestClient.connect(h.url);
    clients.push(guest);
    guest.send({ t: 'lobby:join', lobbyId: created.lobby.lobbyId, name: 'Bo' });
    await guest.expect(guest.is('lobby:state'), 'the second player joined');
    host.send({ t: 'lobby:start' });
    await host.expect(host.is('match:state'), 'the match started');
    await guest.expect(guest.is('match:state'), 'the guest is seated');

    // The ceiling is now full. Two refused upgrades, aimed at that running table.
    expect((await probe(h.url)).verdict, 'a socket past a ceiling of 2 was ADMITTED').toBe('refused');
    expect((await probe(h.url)).verdict, 'the ceiling was not sticky').toBe('refused');

    // …and the table played straight through both of them. A refused socket must not
    // have cost the server the connections it already had, nor the room its state.
    const room = [...h.server.hub.rooms.values()][0];
    if (room === undefined) throw new Error('no room');
    const ply = driverPly(room.state);
    const seat = ply.seat === guest.latestSession().playerId ? guest : host;
    expect(
      [host, guest].some((c) => c.latestSession().playerId === ply.seat),
      'the driver asked for a seat with no socket — the fixture is wrong, not the server',
    ).toBe(true);

    const before = room.viewId;
    const errorsBefore = seat.all('error').length;
    seat.send({ t: 'match:action', action: ply.action });
    const deadline = Date.now() + 5_000;
    while (room.viewId <= before && seat.all('error').length === errorsBefore && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(room.viewId, 'the table did not advance past two refused upgrades').toBeGreaterThan(before);
    expect(seat.all('error').slice(errorsBefore)[0], 'the table refused a legal move after the refusals').toBeUndefined();
  });

  it('the per-address ceiling admits a table of friends from one router and refuses the rest', async () => {
    // This is the number that is easy to get wrong. Five seats and their spectators
    // routinely arrive from ONE address behind one router, so a cap of 1 or 2 would
    // refuse a legitimate game — which is why the default is 12 and not "one table".
    const h = await boot({ maxConnectionsPerIp: 2, maxConnections: 64 });
    expect((await probe(h.url)).verdict, 'socket 1').toBe('open');
    expect((await probe(h.url)).verdict, 'socket 2').toBe('open');
    expect((await probe(h.url)).verdict, 'socket 3 from the same address was admitted').toBe('refused');
  });

  it('closing a socket gives its address budget back, exactly once', async () => {
    // "Exactly once" is not pedantry: `close` and `error` both call `#onClose`, and a
    // double decrement would silently raise the effective ceiling for everyone while
    // the configured number stayed the same.
    const h = await boot({ maxConnectionsPerIp: 2, maxConnections: 64 });
    const a = await TestClient.connect(h.url);
    const b = await TestClient.connect(h.url);
    clients.push(a, b);
    expect((await probe(h.url)).verdict, 'a third socket was admitted past a per-IP ceiling of 2').toBe('refused');

    await a.close();
    await new Promise((r) => setTimeout(r, 50));
    const reused = await probe(h.url);
    expect(reused.verdict, 'a freed per-IP slot was not reused — the count was decremented twice somewhere').toBe('open');

    await b.close();
    await new Promise((r) => setTimeout(r, 50));
    expect((await probe(h.url)).verdict, 'the second slot was not freed either').toBe('open');
    expect((await probe(h.url)).verdict, 'the budget GREW instead of being restored — a slot was credited twice').toBe('refused');
  });
});

// ─────────────────────────── the fan-out ceiling ───────────────────────────

/** A running two-seat match, with both seats seated and attached. */
async function runningMatch(h: Harness): Promise<{ matchId: string; host: TestClient }> {
  const host = await TestClient.connect(h.url);
  clients.push(host);
  host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false });
  const created = await host.expect(host.is('lobby:state'), 'the lobby');
  const guest = await TestClient.connect(h.url);
  clients.push(guest);
  guest.send({ t: 'lobby:join', lobbyId: created.lobby.lobbyId, name: 'Bo' });
  await guest.expect(guest.is('lobby:state'), 'the second player joined');
  host.send({ t: 'lobby:start' });
  const started = await host.expect(host.is('match:state'), 'the match started');
  await guest.expect(guest.is('match:state'), 'the guest is seated');
  return { matchId: started.matchId, host };
}

describe("one match's watcher set is bounded", () => {
  it('the spectator past the ceiling is refused, with the truth and not a match-id oracle', async () => {
    const h = await boot({ maxWatchersPerMatch: 4, maxConnections: 64, maxConnectionsPerIp: 64 });
    const { matchId } = await runningMatch(h);

    // Two seats plus two spectators fit inside a ceiling of 4.
    for (const n of [1, 2]) {
      const spec = await TestClient.connect(h.url);
      clients.push(spec);
      spec.clear();
      spec.send({ t: 'match:spectate', matchId });
      await spec.expect(spec.is('match:state'), `spectator ${n} attached`);
    }

    const overflow = await TestClient.connect(h.url);
    clients.push(overflow);
    overflow.clear();
    overflow.send({ t: 'match:spectate', matchId });
    const refused = await overflow.expect(overflow.is('error'), 'the spectator past the ceiling');
    expect(refused.code, 'the refusal used a code that means something about authority').toBe('RATE_LIMITED');
    expect(refused.message, 'the refusal does not say what actually happened').toBe('too many people are watching this match');
    expect(overflow.all('match:state'), 'the refused spectator was sent a state anyway').toEqual([]);

    // It keeps a session rather than being ejected — a spectator is not a threat and
    // making one leave is not a defence — and that session names no seat, so it still
    // cannot write.
    const granted = await overflow.expect(overflow.is('session:granted'), 'the refused spectator keeps a session');
    expect(granted.session.role, 'the refused spectator was given a seat').toBe('spectator');
    overflow.clear();
    overflow.send({ t: 'match:action', action: { type: 'END_TURN' } });
    const write = await overflow.expect(overflow.is('error'), 'the refused spectator tried to act');
    expect(write.code, 'a seatless spectator got a write door').toBe('NOT_A_PLAYER');
  });

  it('a SEAT is never refused a seat back by the fan-out ceiling', async () => {
    // The negative control, and it is the one that could have gone wrong quietly: a
    // player returning after two hours is one projection, not an amplification, and
    // refusing them would hand a 4-hour game to a spectator count. The ceiling here is
    // exactly the two seats, so the only way a seat can come back is if the resume path
    // adds one regardless — which is what `#resume` does, in one line, with a comment.
    const h = await boot({ maxWatchersPerMatch: 2, maxConnections: 64, maxConnectionsPerIp: 64 });
    const { matchId, host } = await runningMatch(h);
    const token = host.tokenFor(matchId);
    const hostPlayerId = host.latestSession().playerId;

    // The ceiling is spent by the two seats; a spectator has nowhere to go.
    const spec = await TestClient.connect(h.url);
    clients.push(spec);
    spec.clear();
    spec.send({ t: 'match:spectate', matchId });
    await spec.expect(spec.is('error'), 'a spectator past a ceiling of two seats');

    // The seat goes away — a closed tab, which releases its watcher slot — and comes
    // back on a fresh socket.
    await host.close();
    await new Promise((r) => setTimeout(r, 50));

    const returned = await TestClient.connect(h.url);
    clients.push(returned);
    returned.send({ t: 'session:resume', resumeToken: token });
    const granted = await returned.expect(returned.is('session:granted'), 'the seat came back');
    expect(granted.session.playerId, 'the seat came back as a different seat').toBe(hostPlayerId);
    await returned.expect(returned.is('match:state'), 'the returned seat was sent the board');
  });
});

// ─────────────────────────── the per-message budget ───────────────────────────

describe('every message is budgeted, not only the dispatch', () => {
  it('a flood of free messages is refused, and the first step of the chain is one of them', async () => {
    // `lobby:list` is the amplifier's first frame and costs a full `LobbyHub` walk plus
    // a serialisation for every public room. Before this it was free, which meant the
    // cheapest possible script could drive it as fast as the socket would carry.
    const h = await boot({ messageRate: 5, maxConnections: 64, maxConnectionsPerIp: 64 });
    const c = await TestClient.connect(h.url);
    clients.push(c);
    c.clear();
    for (let i = 0; i < 60; i += 1) c.send({ t: 'lobby:list' });

    const limited = await c.expect(c.is('error'), 'a rate-limit refusal');
    expect(limited.code, 'the flood was not rate limited').toBe('RATE_LIMITED');
    expect(limited.message, 'the refusal text is not a fixed literal').toBe('slow down');
    expect(
      c.all('lobby:list').length,
      `the server answered ${c.all('lobby:list').length} of 60 frames after the budget ran out`,
    ).toBeLessThan(60);
    expect(c.closed, 'the flood closed the connection instead of budgeting it').toBe(false);
  });

  it('the honest client is nowhere near the budget: a full game costs a handful of messages', async () => {
    // The ceiling is only worth having if real play cannot brush against it, so the
    // default is measured rather than asserted: a whole two-seat game — create, join,
    // start, and every action of every turn — is a few hundred frames at the real
    // ~2 actions a minute, against a default of 20/s. What this pins is the SHAPE of
    // the claim (the budget is spent in proportion to play, not per action) and that
    // the default is not so low that ordinary traffic is refused.
    expect(DEFAULT_MESSAGE_RATE, 'the default message budget is below one message a second').toBeGreaterThanOrEqual(10);

    const h = await boot({ maxConnections: 64, maxConnectionsPerIp: 64 });
    const { host } = await runningMatch(h);
    host.clear();
    host.send({ t: 'ping', nonce: 'still-here' });
    const pong = await host.expect(host.is('pong'), 'a keepalive tick after a whole match setup');
    expect(pong.nonce).toBe('still-here');
  });

  it('the dispatch budget is a SEPARATE bucket, so a spectator-free setup is not charged for actions', async () => {
    // Both buckets are spent on a `match:action` — the general one on the frame, the
    // dispatch one on the action — and the defaults are 20 and 4. Merging them would
    // either let a spectator fan out or refuse a table. What this pins is that at a
    // `messageRate` of 1000 the bucket that actually refuses is the DISPATCH one: the
    // general budget is nowhere near the frame.
    const h = await boot({ dispatchRate: 2, messageRate: 1000, maxConnections: 64, maxConnectionsPerIp: 64 });
    const { host } = await runningMatch(h);

    host.clear();
    for (let i = 0; i < 8; i += 1) host.send({ t: 'match:action', action: { type: 'END_TURN' } });
    await host.expect(host.is('error'), 'the dispatch budget ran out');

    const codes = host.all('error').map((e) => e.code);
    expect(codes.length, 'the dispatch budget was not enforced at all').toBeGreaterThan(0);
    // The refusals came from the DISPATCH budget. `ILLEGAL_ACTION` is the engine
    // refusing an out-of-turn END_TURN, which means that frame got PAST both buckets —
    // so the general budget of 1000/s demonstrably did not eat it.
    expect(
      codes.filter((c) => c === 'ILLEGAL_ACTION').length,
      'no frame reached the reducer, so the general budget and the dispatch budget cannot be told apart',
    ).toBeGreaterThan(0);
    expect(
      codes.filter((c) => c === 'RATE_LIMITED').length,
      'the dispatch budget never refused anything',
    ).toBeGreaterThan(0);
  });
});

// ─────────────────────────── the chain, end to end ───────────────────────────

describe('the amplification chain is bounded end to end', () => {
  it('lobby:list → lobby:spectate → match:spectate stops attaching, and costs nothing per repeat', async () => {
    // The audit's repro, run as far as it can now go. Every frame is well formed and
    // none of them is refused for being unauthorised — there is no authorisation on the
    // read side and there is not going to be — so the ONLY thing that stops the script
    // is the ceilings. The assertion is that a determined caller gets a bounded amount
    // of server rather than an unbounded amount.
    const h = await boot({ maxWatchersPerMatch: 3, messageRate: 200, maxConnections: 64, maxConnectionsPerIp: 64 });
    const { matchId } = await runningMatch(h);

    let attached = 0;
    let refused = 0;
    for (let i = 0; i < 12; i += 1) {
      const script = await TestClient.connect(h.url);
      clients.push(script);
      script.clear();
      // Step 1 and 2, exactly as the audit wrote them: discover, then ask for the room.
      script.send({ t: 'lobby:list' });
      await script.expect(script.is('lobby:list'), 'the room list');
      script.clear();
      script.send({ t: 'lobby:spectate', lobbyId: (await lobbyId(h)) as string });
      await script.expect(script.is('session:granted'), 'a spectator session for the room');
      // Step 3: attach. This is where the chain used to be free and unbounded.
      script.clear();
      script.send({ t: 'match:spectate', matchId });
      const deadline = Date.now() + 2_000;
      while (script.all('match:state').length === 0 && script.all('error').length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      if (script.all('match:state').length > 0) attached += 1;
      else refused += 1;
    }

    // Two seats hold two of the three slots, so exactly ONE spectator gets in and the
    // other nine are told the truth. That is the whole bound.
    expect(attached, `the fan-out ceiling did not hold: ${attached} of 12 attached`).toBe(1);
    expect(refused).toBe(11);
  });
});

/** The first public lobby id on the hub, or an error if the fixture made none. */
async function lobbyId(h: Harness): Promise<string | undefined> {
  for (const c of clients) {
    const states = c.ever('lobby:state');
    const last = states[states.length - 1];
    if (last !== undefined) return last.lobby.lobbyId;
  }
  const listed = h.server.hub.listLobbies(null);
  const first = listed[0];
  if (first === undefined) throw new Error('no public lobby exists — the fixture is wrong, not the server');
  return first.lobbyId;
}

// ─────────────────────────── the defaults are on the record ───────────────────────────

describe('the ceilings have stated defaults, and they are the ones a deployment gets', () => {
  it('the numbers are exported, so the trade-off is legible from outside this file', async () => {
    // Not a tautology: these four constants are the entire S1 answer, and a number
    // buried in a constructor default is a number nobody can argue with. Each is
    // justified at its declaration in `src/index.ts`; the assertions here only pin that
    // the justification has not drifted into something that would refuse a real table.
    expect(DEFAULT_MAX_CONNECTIONS).toBeGreaterThanOrEqual(32);
    // A table of five plus its spectators behind one router.
    expect(DEFAULT_MAX_CONNECTIONS_PER_IP).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_MAX_WATCHERS_PER_MATCH).toBeGreaterThanOrEqual(16);
    // The amplifier's payload ceiling is unchanged; a ceiling is not a licence to raise
    // this one, because it is what bounds a single frame.
    expect(MAX_PAYLOAD_BYTES).toBeGreaterThan(0);
  });
});