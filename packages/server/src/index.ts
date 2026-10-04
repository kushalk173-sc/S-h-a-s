/**
 * The HTTP + WebSocket server.
 *
 * Three HTTP routes and nothing else: `GET /healthz`, the `/ws` upgrade, and static
 * client assets in dev. No admin route, no debug route, no `/state`. The trade is
 * no production introspection; the action log is strictly better than a log line
 * for debugging, because it is authoritative and replayable â€” a bug report is a
 * `matchId`, and an operator replays it offline with the same seed.
 *
 * Every frame is handled inside a try/catch. An exception escaping a message
 * handler on a single-threaded shared server takes down every live match on the
 * process, which for a 4-hour game is the same as losing it. So: reject, never
 * crash, and never let an unexpected error become a client-visible string built
 * from anything but a fixed literal.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  loadCorpus,
  toEngineConspiracyCard,
  toEngineHeadlineCard,
  toEngineIdeologyCard,
  toEngineVoterCard,
} from '@shasn/cards';
import {
  indexCards,
  RULES,
  type Action,
  type CardIndex,
  type Ctx,
  type PlayerID,
} from '@shasn/engine';

import { LobbyError, LobbyHub, MIN_PLAYERS } from './lobby.ts';
import { newPlayerId, Room, RoomError } from './room.ts';
import { SessionStore, type SessionRecord } from './session.ts';
import { InMemoryMatchStore, sha, type MatchStore } from './store.ts';
import { decodeFrame, isSeatCount, MAX_PAYLOAD_BYTES } from './validate.ts';
import type { ClientMessage, ErrorCode, Lobby, ServerMessage, SeatCount } from './protocol.ts';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Build the `CardIndex` from the in-repo JSON corpus. Called once, at boot. */
export function loadCards(): CardIndex {
  const corpus = loadCorpus();
  return indexCards({
    ideology: corpus.ideology.map(toEngineIdeologyCard),
    voter: corpus.voter.map(toEngineVoterCard),
    conspiracy: corpus.conspiracy.map(toEngineConspiracyCard),
    headline: corpus.headline.map(toEngineHeadlineCard),
  });
}

export function loadCtx(): Ctx {
  return { rules: RULES, cards: loadCards() };
}

export type ServerConfig = {
  readonly port: number;
  readonly host: string;
  /** Directory of built client assets. Unset means no static serving. */
  readonly clientDir?: string | null;
  readonly now?: () => number;
  /** Dispatch budget per connection, in dispatches per second. */
  readonly dispatchRate?: number;
  readonly snapshotEvery?: number;
  /** How long a disconnected seat is held. */
  readonly graceMs?: number;
  readonly ctx?: Ctx;
  readonly store?: MatchStore;
  /** Skip replaying stored matches at boot. Tests that seed the store want this. */
  readonly skipRestore?: boolean;
};

export const DEFAULT_DISPATCH_RATE = 4;
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * THE MESSAGES THAT EXCHANGE A CREDENTIAL â€” the complete list of the ways a
 * connection's `conn.session` can be replaced by something the client asked for.
 *
 * It is a `Set` of four `ClientMessage['t']`s rather than a flag on `Conn`, because
 * the property that matters is not "is this connection a session holder" but "does
 * handling this message overwrite the credential this connection is holding". Those
 * are different questions and only the second one is the bug. `session:resume` is
 * deliberately NOT in this set: it is the one message that is *supposed* to move a
 * seat, because it is the only one that proves it may â€” see `#adoptSession`.
 */
const MINTING: ReadonlySet<ClientMessage['t']> = new Set<ClientMessage['t']>([
  'lobby:create',
  'lobby:join',
  'lobby:spectate',
  'match:spectate',
]);

type Conn = {
  readonly socket: WebSocket;
  session: SessionRecord | null;
  /** Token bucket. Dispatches are the only state-mutating message. */
  tokens: number;
  lastRefill: number;
};

export class ShasnServer {
  readonly hub: LobbyHub;
  readonly sessions: SessionStore;
  readonly store: MatchStore;
  readonly ctx: Ctx;
  readonly #cfg: {
    port: number;
    host: string;
    now: () => number;
    dispatchRate: number;
    snapshotEvery: number;
    graceMs: number;
    clientDir: string | null;
    skipRestore: boolean;
  };
  readonly #http: Server;
  readonly #wss: WebSocketServer;
  readonly #conns = new Map<WebSocket, Conn>();
  /** matchId â†’ the sockets currently watching it. */
  readonly #watchers = new Map<string, Set<Conn>>();
  /** matchId â†’ unsubscribe, so a finished room stops broadcasting. */
  readonly #roomUnsubs = new Map<string, () => void>();
  #closed = false;

  constructor(cfg: ServerConfig) {
    const now = cfg.now ?? ((): number => Date.now());
    this.ctx = cfg.ctx ?? loadCtx();
    this.store = cfg.store ?? new InMemoryMatchStore();
    this.hub = new LobbyHub(this.ctx, this.store, now);
    this.sessions = new SessionStore(now);
    this.#cfg = {
      port: cfg.port,
      host: cfg.host,
      now,
      dispatchRate: cfg.dispatchRate ?? DEFAULT_DISPATCH_RATE,
      snapshotEvery: cfg.snapshotEvery ?? 10,
      graceMs: cfg.graceMs ?? DEFAULT_GRACE_MS,
      clientDir: cfg.clientDir ?? null,
      skipRestore: cfg.skipRestore ?? false,
    };
    this.#http = createServer((req, res) => {
      void this.#onHttp(req, res);
    });
    this.#wss = new WebSocketServer({
      noServer: true,
      // Refuse an oversized frame before it is fully buffered. `validate` then
      // refuses anything that still slips through, on byte length rather than
      // character count, because a multi-byte name is the cheap way around a
      // `.length` check.
      maxPayload: MAX_PAYLOAD_BYTES,
    });
    this.#http.on('upgrade', (req, socket, head) => {
      this.#onUpgrade(req, socket as Duplex, head);
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async listen(): Promise<{ port: number; host: string }> {
    // The configured port, not a hardcoded 0. Port 0 means "any free port", which
    // is exactly what a test wants and exactly what a deployment does not â€” it
    // silently binds somewhere nobody is proxying to, and the symptom is a server
    // that starts cleanly and is unreachable.
    const port = this.#cfg.port;
    await new Promise<void>((resolve, reject) => {
      const onError = (e: Error): void => reject(e);
      this.#http.once('error', onError);
      this.#http.listen(port, this.#cfg.host, () => {
        this.#http.removeListener('error', onError);
        resolve();
      });
    });

    if (!this.#cfg.skipRestore) {
      // A restart is the interesting case. Every match comes back from its action
      // log; a match whose rules or cards changed underneath it is SKIPPED with a
      // reason rather than "restored" into a subtly different game.
      const { restored, skipped } = await this.hub.restoreAll();
      for (const s of skipped) {
        // A match id and two content hashes. No card ids, no seed, no state.
        console.warn(`[shasn] could not restore ${s}`);
      }
      console.log(`[shasn] restored ${restored} match(es)`);
    }
    console.log(`[shasn] listening on ${this.#cfg.host}:${this.port}`);
    return { port: this.port, host: this.#cfg.host };
  }

  get port(): number {
    const addr = this.#http.address();
    return typeof addr === 'object' && addr !== null ? addr.port : 0;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const unsub of this.#roomUnsubs.values()) unsub();
    this.#roomUnsubs.clear();
    for (const conn of this.#conns.values()) {
      try {
        conn.socket.terminate();
      } catch {
        /* already gone */
      }
    }
    this.#conns.clear();
    await new Promise<void>((resolve) => {
      this.#wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.#http.close(() => resolve());
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ HTTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async #onHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain' }).end('method not allowed');
        return;
      }
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      if (url.pathname === '/lobbies') {
        // Public room metadata for a cold load, before the socket opens. The
        // `lobby:list` message is the real path.
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ lobbies: this.hub.listLobbies(null) }));
        return;
      }
      await this.#serveStatic(url.pathname, res);
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('error');
    }
  }

  async #serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const dir = this.#cfg.clientDir;
    if (dir === null) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const root = resolve(dir);
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^[/\\]+/, '');
    const target = resolve(join(root, rel));
    // Path traversal. `resolve` collapses `..`; the prefix check catches the rest,
    // and it is written with `sep` so it is not a Windows-only-vs-POSIX asymmetry.
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
      return;
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, { 'content-type': contentType(target) }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  #onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws);
    });
  }

  /**
   * Public so a test can drive a real socket without a real port.
   *
   * A socket is anonymous until it resumes or is seated. Granting a real session
   * on connect would mean every TCP probe that completed a handshake got a
   * credential, and the resume token is the only thing in the system that can
   * write to a match.
   */
  onConnection(socket: WebSocket): void {
    const now = this.#cfg.now();
    const conn: Conn = { socket, session: null, tokens: this.#cfg.dispatchRate, lastRefill: now };
    this.#conns.set(socket, conn);
    socket.on('message', (data: unknown) => {
      void this.#onFrame(conn, data);
    });
    socket.on('close', () => {
      this.#onClose(conn);
    });
    socket.on('error', () => {
      this.#onClose(conn);
    });
  }

  #onClose(conn: Conn): void {
    this.#conns.delete(conn.socket);
    for (const set of this.#watchers.values()) set.delete(conn);
    const s = conn.session;
    if (s === null) return;
    const now = this.#cfg.now();
    // The seat is HELD, not released. This is the whole of "survive a refresh":
    // nothing is skipped, nobody is knocked out, the turn simply waits. Shasn is
    // turn-based, not clock-based, so there is nothing to pause.
    if (s.matchId !== null) this.hub.rooms.get(s.matchId)?.setConnected(s.playerId, false, now);
    if (s.lobbyId !== null) this.hub.setConnected(s.lobbyId, s.playerId, false);
  }

  async #onFrame(conn: Conn, data: unknown): Promise<void> {
    const raw = toRaw(data);
    if (raw === null) {
      this.#fail(conn, 'BAD_MESSAGE', 'unsupported frame');
      return;
    }
    const decoded = decodeFrame(raw);
    if (!decoded.ok) {
      this.#fail(conn, decoded.reason === 'payload too large' ? 'TOO_LARGE' : 'BAD_MESSAGE', decoded.reason);
      return;
    }
    try {
      this.#handle(conn, decoded.message);
    } catch (err) {
      // The only place an unexpected error becomes a client-visible string, and
      // the string is a fixed literal. The error's NAME goes to the process log,
      // which is operator-only. A stack trace here would be a leak channel, and
      // the one real interpolation bug in this codebase was exactly that shape, in
      // the engine's ANSWER path.
      const name = err instanceof Error ? err.name : 'Error';
      console.error(`[shasn] handler threw (${name})`);
      this.#fail(conn, 'INTERNAL', 'the server could not handle that message');
    }
  }

  /**
   * The message switch.
   *
   * No `default` that silently returns: the `never` check means adding a message
   * type to the protocol without handling it here is a COMPILE ERROR. That is the
   * same intended friction the structural leak test creates on the send side, and
   * it is why a new message cannot be added without someone deciding where it
   * sits in the auth story.
   */
  #handle(conn: Conn, msg: ClientMessage): void {
    // THE SEAT SEAL, checked before the switch rather than inside the four cases,
    // because it is one rule about four messages and a rule written four times is a
    // rule that is three times missing. `MINTING` is the set of messages whose
    // effect is to REPLACE `conn.session`; every one of them is refused for a
    // connection that is seated at a live match. See `#refuseSeatHandover`.
    if (MINTING.has(msg.t) && this.#refuseSeatHandover(conn)) return;
    switch (msg.t) {
      case 'ping':
        this.#send(conn.socket, { t: 'pong', nonce: msg.nonce ?? '' });
        return;
      case 'session:resume':
        void this.#resume(conn, msg.resumeToken);
        return;
      case 'lobby:list':
        this.#send(conn.socket, {
          t: 'lobby:list',
          lobbies: this.hub.listLobbies(conn.session?.playerId ?? null),
        });
        return;
      case 'lobby:create':
        this.#createLobby(conn, msg.name, msg.maxPlayers, msg.isPrivate);
        return;
      case 'lobby:join':
        this.#joinLobby(conn, msg.lobbyId, msg.name, false);
        return;
      case 'lobby:spectate':
        this.#joinLobby(conn, msg.lobbyId, 'Spectator', true);
        return;
      case 'lobby:leave':
        this.#leaveLobby(conn);
        return;
      case 'lobby:ready':
        this.#requireLobby(conn, (lobby, rec) => {
          this.hub.setReady(lobby.lobbyId, rec.playerId, msg.ready);
          this.#broadcastLobby(lobby.lobbyId);
        });
        return;
      case 'lobby:start':
        this.#startMatch(conn);
        return;
      case 'match:spectate':
        this.#spectate(conn, msg.matchId);
        return;
      case 'match:sync':
        this.#sync(conn);
        return;
      case 'match:action':
        this.#dispatch(conn, msg.action);
        return;
      default: {
        const unreachable: never = msg;
        void unreachable;
        this.#fail(conn, 'BAD_MESSAGE', 'unknown message type');
        return;
      }
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ lobby â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  #createLobby(conn: Conn, name: string, maxPlayers: SeatCount, isPrivate: boolean): void {
    const { lobby, playerId } = this.hub.createLobby({ name, maxPlayers, isPrivate, now: this.#cfg.now() });
    const rec = this.sessions.create(name);
    rec.playerId = playerId;
    rec.lobbyId = lobby.lobbyId;
    this.#adoptSession(conn, rec);
    this.#send(conn.socket, { t: 'session:granted', session: this.sessions.toWire(rec) });
    this.#broadcastLobby(lobby.lobbyId);
  }

  #joinLobby(conn: Conn, lobbyId: string, name: string, asSpectator: boolean): void {
    if (asSpectator) {
      const lobby = this.hub.getLobby(lobbyId);
      if (lobby === undefined) {
        this.#fail(conn, 'NOT_IN_LOBBY', 'that room no longer exists');
        return;
      }
      const rec = this.sessions.create(name, 'spectator');
      rec.lobbyId = lobbyId;
      this.#adoptSession(conn, rec);
      this.#send(conn.socket, { t: 'session:granted', session: this.sessions.toWire(rec) });
      this.#send(conn.socket, { t: 'lobby:state', lobby: this.hub.lobbyView(lobby, null) });
      return;
    }
    try {
      const { lobby, playerId } = this.hub.joinLobby({ lobbyId, name, now: this.#cfg.now() });
      const rec = this.sessions.create(name);
      rec.playerId = playerId;
      rec.lobbyId = lobby.lobbyId;
      this.#adoptSession(conn, rec);
      this.#send(conn.socket, { t: 'session:granted', session: this.sessions.toWire(rec) });
      this.#broadcastLobby(lobby.lobbyId);
    } catch (err) {
      if (err instanceof LobbyError) {
        this.#fail(conn, err.code, err.message);
        return;
      }
      throw err;
    }
  }

  #leaveLobby(conn: Conn): void {
    const rec = this.#requireSession(conn);
    if (rec === null || rec.lobbyId === null) return;
    const lobbyId = rec.lobbyId;
    this.hub.leaveLobby(lobbyId, rec.playerId);
    rec.lobbyId = null;
    this.#broadcastLobby(lobbyId);
  }

  #startMatch(conn: Conn): void {
    const rec = this.#requireSession(conn);
    if (rec === null || rec.lobbyId === null) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'you are not in a room');
      return;
    }
    const lobby = this.hub.getLobby(rec.lobbyId);
    if (lobby === undefined) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'that room no longer exists');
      return;
    }
    if (lobby.hostId !== rec.playerId) {
      this.#fail(conn, 'NOT_HOST', 'only the host can start the match');
      return;
    }
    if (lobby.members.size < MIN_PLAYERS) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'at least two players are needed');
      return;
    }

    void this.hub
      .startMatch(lobby.lobbyId, this.#cfg.now())
      .then((room) => {
        this.#watchRoom(room);
        for (const member of lobby.members.values()) {
          const target = this.#connFor(member.playerId);
          if (target === undefined) continue;
          const sess = target.session;
          if (sess === null || sess.role === 'spectator') continue;
          // Mint the seat's durable credential and hand it to that seat's own
          // socket. A session is never given a token for a seat it is not in.
          const token = this.sessions.rotate(sess);
          sess.matchId = room.matchId;
          room.setTokenHash(sess.playerId, sha(token));
          room.setConnected(sess.playerId, true, this.#cfg.now());
          this.#attach(target, room.matchId);
          this.#send(target.socket, { t: 'session:granted', session: this.sessions.toWire(sess) });
          this.#sendMatchState(target, room, sess);
        }
        // THE ROOM'S OWN VIEW IS BROADCAST, OR A SPECTATOR WHO JOINED EARLY IS ORPHANED.
        //
        // The loop above reaches SEATS, and only seats: a connection whose session role
        // is `spectator` is `continue`d past, because a spectator gets no credential and
        // no seat. So the one thing that tells a spectator the game has begun â€” the
        // `matchId` this broadcast carries on `LobbyHub#startMatch`'s member loop â€” was
        // never sent to anybody who was watching rather than playing.
        //
        // The client's half is already correct and was already covered: `Lobby.tsx` keys
        // an effect on `lobby.matchId` and sends `match:spectate`, which is the frame that
        // actually attaches (`#spectate` â†’ `#attach` â†’ `match:state`). For a room that
        // was ALREADY running that fires on arrival, because the arrival snapshot already
        // carries a match id. For a room that had not started, nothing ever produced the
        // match id, so the effect never fired and the spectator sat in a waiting room for
        // a game already in progress â€” the table looked hung, and no client could have
        // found the cause because the frame was never sent.
        //
        // So it is broadcast to the whole room rather than to the seats: `#broadcastLobby`
        // reaches every connection whose session still names this lobby, which is a
        // superset of the seats, and the seats are about to receive a far richer frame.
        this.#broadcastLobby(lobby.lobbyId);
        return room.persistSeats();
      })
      .catch((err: unknown) => {
        if (err instanceof LobbyError) {
          this.#fail(conn, err.code, err.message);
          return;
        }
        console.error(`[shasn] could not start match (${err instanceof Error ? err.name : 'Error'})`);
        this.#fail(conn, 'INTERNAL', 'the match could not be started');
      });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ match â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Reclaim a session from a resume token.
   *
   * TWO LOOKUPS, AND THE SECOND ONE IS THE IMPORTANT ONE.
   *
   * The in-memory index is a cache of which token belongs to which live session.
   * It is empty on a freshly booted process, so on its own it would make resume
   * impossible after a deploy â€” which is the exact scenario the whole action-log
   * design exists to survive. A player who was mid-answer when the deploy happened
   * would be locked out of a 4-hour game whose state came back perfectly.
   *
   * So the fallback is the DURABLE one: every seat's token hash is written to the
   * store, and `findByResumeHash` scans for it. That lookup also binds the token to
   * ONE match, which is why a token cannot be pointed at a different room â€” the
   * client never names a room in a resume at all.
   *
   * The order that matters afterwards: what happens to a player who reconnects
   * mid-answer. They re-receive the SAME answer prompt, in the SAME order, with no
   * payout, because the prompt is rebuilt from the rehydrated state and the order
   * is a pure function of that state. The state is a full state at the current
   * `viewId`, computed here rather than read out of the store, so a player
   * returning after two hours is exactly as caught up as one who never left.
   */
  async #resume(conn: Conn, token: string): Promise<void> {
    const rec = await this.#resolveSession(token);
    if (rec === null) {
      this.#fail(conn, 'RESUME_INVALID', 'that resume token is not valid');
      return;
    }
    const now = this.#cfg.now();
    const matchId = rec.matchId;
    const lobbyId = rec.lobbyId;

    if (matchId !== null) {
      const room = this.hub.rooms.get(matchId);
      if (room === undefined) {
        this.#fail(conn, 'MATCH_NOT_FOUND', 'that match is no longer available');
        return;
      }
      // Constant-time against the SEAT's stored hash, not merely the in-memory
      // index: a match id and a seat id are both public, so the token is the only
      // unknown, and the token is what the timing could leak.
      if (!room.verifyToken(rec.playerId, token)) {
        this.#fail(conn, 'RESUME_INVALID', 'that resume token is not valid');
        return;
      }
      if (room.allSeatsExpired(now)) {
        this.#fail(conn, 'RESUME_INVALID', 'the seat was released after the grace window');
        return;
      }
      // Rotate BEFORE replying. A leaked token is then single-use: whoever
      // presents it first consumes it and the other is locked out. Deliberate â€”
      // the alternative is a token that lives forever in a shared browser.
      const fresh = this.sessions.rotate(rec);
      room.setTokenHash(rec.playerId, sha(fresh));
      room.setConnected(rec.playerId, true, now);
      void room.persistSeats().catch(() => undefined);
      this.#adoptSession(conn, rec);
      this.#attach(conn, matchId);
      this.#send(conn.socket, { t: 'session:granted', session: this.sessions.toWire(rec) });
      this.#sendMatchState(conn, room, rec);
      return;
    }

    if (lobbyId !== null) {
      const lobby = this.hub.getLobby(lobbyId);
      if (lobby === undefined) {
        this.#fail(conn, 'RESUME_INVALID', 'that session is no longer available');
        return;
      }
      if (!lobby.members.has(rec.playerId)) {
        this.#fail(conn, 'RESUME_INVALID', 'that session is no longer available');
        return;
      }
      this.sessions.rotate(rec);
      this.hub.setConnected(lobbyId, rec.playerId, true);
      this.#adoptSession(conn, rec);
      this.#send(conn.socket, { t: 'session:granted', session: this.sessions.toWire(rec) });
      this.#send(conn.socket, { t: 'lobby:state', lobby: this.hub.lobbyView(lobby, rec.playerId) });
      return;
    }

    this.#fail(conn, 'RESUME_INVALID', 'that session is no longer available');
  }

  /**
   * Attach as a spectator.
   *
   * `viewer` is `null`, which routes through the SAME `playerView` projection a
   * player gets. That is what makes the structural leak test cover spectators: a
   * separate spectator projection would be a second projection, and second
   * projections leak.
   *
   * A spectator gets a `playerId` that is in no room's seat table, so every write
   * door rejects it. Spectators cannot dispatch, full stop â€” there is no flag to
   * forget to check.
   */
  /**
   * Find the session a resume token belongs to â€” in memory, or on disk.
   *
   * TWO LOOKUPS, AND THE SECOND ONE IS THE IMPORTANT ONE.
   *
   * The in-memory index says which token belongs to which live session. It is
   * empty on a freshly booted process, so on its own it would make resume
   * impossible after a deploy â€” which is the exact scenario the action-log design
   * exists to survive. A player mid-answer when the deploy happened would be locked
   * out of a 4-hour game whose state came back perfectly.
   *
   * So the fallback is the DURABLE one: each seat's token hash is written to the
   * store, and `findByResumeHash` finds it. That lookup also binds the token to ONE
   * match, which is why a token cannot be pointed at a different room â€” a resume
   * message never names a room at all, so there is nothing to point it at.
   *
   * A `null` return is deliberately undifferentiated: "no such token" and "that
   * match is gone" give the same answer, because distinguishing them would make the
   * error channel a seat-existence oracle.
   */
  async #resolveSession(token: string): Promise<SessionRecord | null> {
    const live = this.sessions.find(token);
    if (live !== undefined) return live;

    const found = await this.store.findByResumeHash(sha(token));
    if (found === null) return null;
    const room = this.hub.rooms.get(found.matchId);
    if (room === undefined) return null;
    const seat = room.seat(found.playerId);
    if (seat === undefined) return null;
    // The index lookup found the row; this makes the row's CONTENT authoritative,
    // so a stale or tampered index cannot grant a seat.
    if (!room.verifyToken(found.playerId, token)) return null;
    // Adopt it: re-index the token in memory and bind the session to the match the
    // store says it belongs to, so every later step â€” the constant-time check, the
    // grace window, the rotation â€” behaves identically whether the process
    // restarted a second ago or has been up for a week.
    return this.sessions.adopt(token, seat.name, found.playerId, found.matchId, null);
  }

  #spectate(conn: Conn, matchId: string): void {
    const room = this.hub.rooms.get(matchId);
    if (room === undefined) {
      this.#fail(conn, 'MATCH_NOT_FOUND', 'that match does not exist');
      return;
    }
    const rec = this.sessions.create('Spectator', 'spectator');
    rec.matchId = matchId;
    rec.playerId = newPlayerId();
    this.#adoptSession(conn, rec);
    this.#attach(conn, matchId);
    this.#send(conn.socket, { t: 'session:granted', session: this.sessions.toWire(rec) });
    this.#sendMatchState(conn, room, rec);
  }

  #sync(conn: Conn): void {
    const rec = this.#requireSession(conn);
    if (rec === null || rec.matchId === null) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'you are not in a match');
      return;
    }
    const room = this.hub.rooms.get(rec.matchId);
    if (room === undefined) {
      this.#fail(conn, 'MATCH_NOT_FOUND', 'that match is no longer available');
      return;
    }
    // Always a full state. Never a delta, never a patch: a diff of a state
    // containing eleven secret deck arrays is itself a leak vector, and a patch
    // format would be a second thing to get right. 60 KB once per reconnect is
    // irrelevant.
    this.#sendMatchState(conn, room, rec);
  }

  /**
   * The write door, from the wire.
   *
   * Three server-side refusals, then the engine: not seated in a match, rate
   * limited, and "that is not a seat at this table" (which is how spectators and
   * cross-room tokens are stopped, in one check). Everything after that is the
   * reducer's answer, forwarded verbatim.
   */
  #dispatch(conn: Conn, action: Action): void {
    const rec = this.#requireSession(conn);
    if (rec === null) return;
    if (rec.matchId === null) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'you are not in a match');
      return;
    }
    if (!this.#spend(conn)) {
      this.#fail(conn, 'RATE_LIMITED', 'slow down');
      return;
    }
    const room = this.hub.rooms.get(rec.matchId);
    if (room === undefined) {
      this.#fail(conn, 'MATCH_NOT_FOUND', 'that match is no longer available');
      return;
    }
    try {
      const result = room.dispatch(rec.playerId, action, this.#cfg.now());
      if (!result.ok) {
        // The engine's own words. It writes them for humans, and no engine error
        // interpolates card data, a deck position or a seed â€” audited, because
        // this line is the one place a leak would reach every client.
        this.#fail(conn, 'ILLEGAL_ACTION', result.error);
      }
    } catch (err) {
      if (err instanceof RoomError) {
        this.#fail(conn, err.code, err.message);
        return;
      }
      throw err;
    }
  }

  /** Token bucket. Dispatches are the only rate-limited message. */
  #spend(conn: Conn): boolean {
    const now = this.#cfg.now();
    const elapsed = now - conn.lastRefill;
    if (elapsed > 0) {
      conn.tokens = Math.min(this.#cfg.dispatchRate, conn.tokens + (elapsed / 1000) * this.#cfg.dispatchRate);
      conn.lastRefill = now;
    }
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ the fan-out â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  #watchRoom(room: Room): void {
    const existing = this.#roomUnsubs.get(room.matchId);
    if (existing !== undefined) return;
    this.#roomUnsubs.set(
      room.matchId,
      room.onBroadcast((_view, events) => {
        // One broadcast reaches every watcher, but each gets ITS OWN projection:
        // the answering player gets the answer prompt, everyone else does not. The
        // fan-out is the only place that knows who is watching.
        for (const conn of this.#watchers.get(room.matchId) ?? []) {
          if (conn.session === null) continue;
          this.#sendMatchState(conn, room, conn.session);
          if (events.length > 0) {
            this.#send(conn.socket, {
              t: 'match:events',
              matchId: room.matchId,
              viewId: room.viewId,
              events,
            });
          }
        }
      }),
    );
  }

  #attach(conn: Conn, matchId: string | null): void {
    // Detach from the previous room first, or a client that resumes into a
    // different match keeps receiving two boards.
    for (const [id, set] of this.#watchers) {
      if (set.delete(conn) && set.size === 0) this.#watchers.delete(id);
    }
    if (matchId === null) return;
    const room = this.hub.rooms.get(matchId);
    if (room === undefined) return;
    this.#watchRoom(room);
    const set = this.#watchers.get(matchId) ?? new Set<Conn>();
    set.add(conn);
    this.#watchers.set(matchId, set);
  }

  #connFor(playerId: PlayerID): Conn | undefined {
    for (const conn of this.#conns.values()) {
      if (conn.session?.playerId === playerId) return conn;
    }
    return undefined;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ the seat seal (C-SESSION) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * REFUSE TO LET A SEATED CONNECTION EXCHANGE ITS CREDENTIAL. Returns true when it
   * refused, and the caller stops.
   *
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * WHY THIS EXISTS: THE SEAT-ORPHAN BUG, AND WHY IT WAS A HANG RATHER THAN A GLITCH
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * Four messages mint a fresh `SessionRecord` and write it over `conn.session`.
   * Before this check, a connection SEATED at a live match could send any of them and
   * be ACCEPTED WITH NO ERROR OF ANY KIND. The record it displaced was left in
   * `SessionStore` â€” no `end`, so its resume token still resolved â€” and the room's
   * seat table was never told anything, so the seat stayed `connected`.
   *
   * The result, reproduced over a real socket and pinned by
   * `test/session-overwrite.test.ts`:
   *
   *   - the new session names a LOBBY (or a different match), not the one the seat is
   *     in, so `#dispatch` answers every `match:action` with `NOT_IN_LOBBY` before the
   *     room is even consulted;
   *   - the seat is still in `room.seats`, still marked `connected`, still holding its
   *     token hash â€” so `allSeatsExpired` is false and NOTHING TIMES OUT;
   *   - the turn simply stops arriving for that seat, and the only escape is
   *     `session:resume` from a DIFFERENT socket.
   *
   * That last pair is what makes it a hang rather than a lost game: a disconnect is
   * the only thing that marks a seat absent, and this socket never disconnected. It
   * works precisely BECAUSE the displaced record was never ended.
   *
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * WHY THE RULE IS ABOUT THE SEAT AND NOT ABOUT SPECTATING
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * Spectating is not the problem and the check is not "you may not spectate". A
   * client with NO seat may spectate any match it can name, unauthenticated, as often
   * as it likes â€” that is the design, and S1 bounds the cost rather than closing the
   * door. The problem is narrower and sharper: **a connection holding a live seat may
   * not stop holding it by asking for something else.** Losing a seat is what
   * `session:resume` is for, and it is the only path that proves the asker may: it
   * carries the seat's own token.
   *
   * So the rule reads: a connection's credential changes only by PROOF, never by
   * REQUEST. That is one sentence, it covers all four messages, and it has no
   * exception to forget â€” which is the property `room.ts`'s own header asks for when
   * it says spectators are stopped by "no flag to forget to check".
   *
   * WHY `ILLEGAL_ACTION`. `ErrorCode` is a closed union mirrored in the client's own
   * copy of the protocol and checked for mutual assignability by
   * `test/protocol-parity.test.ts`, so the honest code for a refusal cannot be added
   * here without a client-side change this change does not own. Of the existing
   * codes this is the one that already means "the server refuses this", and the
   * message is a fixed literal â€” no interpolation, so this adds no reflected-input
   * surface (see the note on `#dispatch`).
   */
  #refuseSeatHandover(conn: Conn): boolean {
    const rec = conn.session;
    if (rec === null || rec.matchId === null) return false;
    this.#fail(conn, 'ILLEGAL_ACTION', 'you are seated in a match; resume your session to change seats');
    return true;
  }

  /**
   * GIVE THIS CONNECTION A NEW SESSION, AND RELEASE THE ONE IT WAS HOLDING.
   *
   * `#refuseSeatHandover` is the fix; this is the backstop that makes the fix
   * structural rather than a rule four call sites have to remember. Two things happen
   * here that no assignment ever did:
   *
   *  1. **The displaced record is ENDED.** `SessionStore#end` drops it from
   *     `#bySession` and from the token index, so the old resume token stops
   *     resolving the instant it is displaced. One socket, one live credential â€” which
   *     is what the store's own `#byHash` index is a single-entry-per-session
   *     structure for.
   *  2. **A displaced LIVE SEAT is marked disconnected.** If the record being replaced
   *     named a match this connection is not staying in, the room is told the seat is
   *     no longer being driven. The seat is NOT released and nothing is skipped â€”
   *     that is `#onClose`'s long-standing rule and it is unchanged â€” but the room
   *     stops reporting a player as present on a socket that has left, so the grace
   *     window can do its job instead of the seat sitting `connected` forever.
   *
   * The same `sessionId` is not ended, because that is `#resume` finding the record
   * it was already holding: a reconnect on the same socket rotates the token IN PLACE
   * and must not destroy itself.
   *
   * `session:ended` is sent, before the caller's `session:granted`, and that ordering
   * is the point rather than an accident: the client's store treats `session:ended`
   * as "the credential is gone and everything derived from it is meaningless", so
   * sending it second would wipe the session the same frame is about to grant. It also
   * gives `session:ended` â€” declared in `protocol.ts` and previously produced by
   * nothing â€” its first producer, which is why the message exists at all.
   */
  #adoptSession(conn: Conn, rec: SessionRecord): void {
    const prev = conn.session;
    conn.session = rec;
    if (prev === null || prev.sessionId === rec.sessionId) return;

    if (prev.matchId !== null && prev.matchId !== rec.matchId) {
      this.hub.rooms.get(prev.matchId)?.setConnected(prev.playerId, false, this.#cfg.now());
    }
    const ended = this.sessions.end(prev.sessionId, 'replaced by a new session on this connection');
    if (ended !== null) this.#send(conn.socket, ended);
  }

  #requireSession(conn: Conn): SessionRecord | null {
    if (conn.session === null) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'resume your session first');
      return null;
    }
    return conn.session;
  }

  #requireLobby(conn: Conn, fn: (lobby: LobbyRecordView, rec: SessionRecord) => void): void {
    const rec = this.#requireSession(conn);
    if (rec === null || rec.lobbyId === null) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'you are not in a room');
      return;
    }
    const lobby = this.hub.getLobby(rec.lobbyId);
    if (lobby === undefined) {
      this.#fail(conn, 'NOT_IN_LOBBY', 'that room no longer exists');
      return;
    }
    fn(lobby, rec);
  }

  /**
   * The one message that carries game state.
   *
   * `state` came out of `viewFor` and `answer` out of `answerPromptFor`. Both are
   * built per recipient here; neither is cached, shared, or filtered afterwards.
   * There is no post-hoc redaction pass, because a redaction pass is where leaks
   * get introduced.
   *
   * Under full information both carry the whole card, which is the point of this file's
   * shape rather than an accident of it: there is one place a card's content is written
   * to a socket, it is written by `pendingCardFor`, and the two payloads differ by
   * exactly the `order` draw.
   */
  #sendMatchState(conn: Conn, room: Room, rec: SessionRecord): void {
    const view = room.viewFor(rec.role === 'spectator' ? null : rec.playerId);
    this.#send(conn.socket, {
      t: 'match:state',
      matchId: room.matchId,
      viewId: view.viewId,
      state: view.state,
      answer: view.answer,
      you: { role: rec.role, playerId: rec.role === 'spectator' ? null : rec.playerId },
    });
  }

  #broadcastLobby(lobbyId: string): void {
    const lobby = this.hub.getLobby(lobbyId);
    if (lobby === undefined) return;
    const view: Lobby = this.hub.lobbyView(lobby, null);
    for (const conn of this.#conns.values()) {
      const rec = conn.session;
      if (rec === null || rec.lobbyId !== lobbyId) continue;
      // Each viewer gets their own `you` flag; the seat list itself is public.
      this.#send(conn.socket, { t: 'lobby:state', lobby: { ...view, seats: view.seats } });
    }
  }

  #send(socket: WebSocket, msg: ServerMessage): void {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* the socket is closing */
    }
  }

  #fail(conn: Conn, code: ErrorCode, message: string): void {
    this.#send(conn.socket, { t: 'error', code, message });
  }
}

type LobbyRecordView = NonNullable<ReturnType<LobbyHub['getLobby']>>;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function toRaw(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) {
    const parts: Buffer[] = [];
    for (const chunk of data) {
      if (typeof chunk === 'string') parts.push(Buffer.from(chunk, 'utf8'));
      else if (Buffer.isBuffer(chunk)) parts.push(chunk);
      else return null;
    }
    return Buffer.concat(parts).toString('utf8');
  }
  return null;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ re-exports â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export { Room, RoomError, LobbyHub, LobbyError, isSeatCount, InMemoryMatchStore };
export type { ClientMessage, ServerMessage, Session, Lobby, LobbySummary, SeatCount } from './protocol.ts';
export { MAX_PAYLOAD_BYTES } from './validate.ts';
