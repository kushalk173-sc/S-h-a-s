/**
 * The WebSocket transport: connect, reconnect with backoff, resume, dispatch.
 *
 * FOUR THINGS THIS DOES NOT DO, each of which is a rule rather than an omission.
 *
 *  1. IT NEVER APPLIES AN ACTION LOCALLY. There is no optimistic path, no
 *     prediction, no rollback. The server's word is the only word. For a game whose
 *     mechanic is "you answered a card you could not see", a client that applies
 *     actions locally is a client that holds a copy of the game, and a client that
 *     holds a copy of the game is one refactor away from holding a card. The line
 *     is drawn at the socket: everything before it is a render, everything after it
 *     is the server's.
 *
 *  2. IT NEVER KEEPS THE PROMPT. On reconnect it does not restore a cached blind
 *     prompt, because the correct one is rebuilt from the server's state and a
 *     cached copy could disagree with it. `session:resume` returns a full
 *     `match:state` with the prompt attached, or with `blind: null`.
 *
 *  3. IT NEVER LOGS THE PAYLOAD. Not in a debug mode, not behind a flag, not
 *     commented out. A console.log of a `match:state` would be the answer key in
 *     the browser's console history, and the browser console is exactly where an
 *     attacker looks. There is a `#wire` hook for tests that receives the message
 *     TYPE, never its body.
 *
 *  4. IT DOES NOT IMPORT THE ENGINE AS A VALUE. `import type` only, everywhere.
 *     A value import drags `reduce.ts` — every card, every payout, the whole rule
 *     engine — into the browser bundle, and a bundler is a leak channel nobody
 *     reviews. `packages/server/scripts/check-secrets.mjs` fails the build on one.
 */

import type { Action } from '@shasn/engine';

import type { ClientMessage, ServerMessage, Session } from './protocol.ts';
import { applyServerMessage, clearBlind, getStore, resetStore, setPhase } from './store.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type ConnectionOptions = {
  /** Defaults to the page's own origin, so dev and prod need no configuration. */
  readonly url?: string;
  /** Where the resume token is kept. `sessionStorage`, never `localStorage`. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Injected for tests; defaults to the platform `WebSocket`. */
  readonly socketFactory?: (url: string) => WebSocketLike;
  readonly onStatus?: (status: ConnectionStatus) => void;
  /** Test hook. Receives the message TYPE only — never the body. */
  readonly onMessageType?: (type: ServerMessage['t']) => void;
  /** Test hook. */
  readonly onRawMessage?: (msg: ServerMessage) => void;
  readonly backoff?: BackoffOptions;
};

export type BackoffOptions = {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly factor: number;
  /** Full jitter. Without it, every client dropped by a deploy reconnects in the
   *  same millisecond, and the server that just came back is knocked over again. */
  readonly jitter: boolean;
};

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 250, maxMs: 15_000, factor: 2, jitter: true };

export type WebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  readonly readyState: number;
};

const OPEN = 1;

const TOKEN_KEY = 'shasn.resumeToken';
const MATCH_KEY = 'shasn.matchId';

/**
 * The default socket URL, derived from the page's own origin so dev and prod need
 * no configuration.
 *
 * `globalThis` is narrowed by hand rather than using the bare `location` global,
 * and that is not fastidiousness. This file is imported by the server's test suite
 * (see `packages/server/test/client-transport.test.ts`), whose `tsconfig` has no
 * DOM lib — so a bare `location` is a compile error there. The architect's §1.2
 * warns about exactly this class of accident: a `node:` global in a shared file
 * breaks the browser build, and a DOM global in a file the server's typecheck
 * reaches breaks the server build. Both are the same mistake.
 */
function defaultUrl(): string {
  const g = globalThis as {
    readonly location?: { readonly protocol?: string; readonly host?: string };
  };
  const loc = g.location;
  if (loc === undefined || typeof loc.host !== 'string' || loc.host === '') {
    return 'ws://127.0.0.1:8787/ws';
  }
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    // `sessionStorage`, not `localStorage`: a shared machine must not leak the
    // token to the next person who opens the tab, and it must not ride along on
    // every request the way a cookie would.
    const g = globalThis as { readonly sessionStorage?: Storage };
    if (g.sessionStorage !== undefined) return g.sessionStorage;
  } catch {
    /* blocked by privacy settings; fall through */
  }
  // An in-memory stand-in. Better than `localStorage`: the token dies with the
  // tab, which is the safer failure mode, just less convenient.
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
}

export class Connection {
  #socket: WebSocketLike | null = null;
  #url: string;
  #storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  #factory: (url: string) => WebSocketLike;
  #onStatus: (s: ConnectionStatus) => void;
  #onMessageType: ((t: ServerMessage['t']) => void) | undefined;
  #onRawMessage: ((m: ServerMessage) => void) | undefined;
  #backoff: BackoffOptions;

  #status: ConnectionStatus = 'idle';
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  /** Set when we are reconnecting, so `connect` is idempotent. */
  #wanted = false;
  /** True once we had a session, so a drop resumes rather than starts over. */
  #hadSession = false;

  constructor(opts: ConnectionOptions = {}) {
    this.#url = opts.url ?? defaultUrl();
    this.#storage = opts.storage ?? defaultStorage();
    const factory = opts.socketFactory;
    this.#factory =
      factory ??
      ((u: string): WebSocketLike => new WebSocket(u) as unknown as WebSocketLike);
    this.#onStatus = opts.onStatus ?? ((): void => undefined);
    this.#onMessageType = opts.onMessageType;
    this.#onRawMessage = opts.onRawMessage;
    this.#backoff = opts.backoff ?? DEFAULT_BACKOFF;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get connected(): boolean {
    return this.#status === 'open' && this.#socket !== null;
  }

  /** The resume token currently held, if any. Exposed for tests. */
  get resumeToken(): string | null {
    return this.#storage.getItem(TOKEN_KEY);
  }

  connect(): void {
    this.#wanted = true;
    // IDEMPOTENT — AND THIS IS THE LINE THAT MAKES IT TRUE.
    //
    // The file header claims `connect` is idempotent, and it is not. React 18
    // StrictMode double-mounts effects in development, `App` calls
    // `connection().connect()` from a mount effect, so on a cold load this ran
    // TWICE. The second call did not notice the first and opened a SECOND
    // WebSocket, then overwrote `#socket` with it — orphaning the first, still
    // CONNECTING socket while holding a reference to the second.
    //
    // The failure that produced is silent and total, which is why it survived a
    // passing test suite and two code audits:
    //
    //   - socket #1 opens first  -> `#setStatus('open')` -> the link goes `live`
    //   - the lobby's `[link]` effect fires and calls `listLobbies()`
    //   - `Connection.send` reads `this.#socket`, which is socket #2, whose
    //     `readyState` is still CONNECTING, so it returns `false` and drops the frame
    //   - socket #2 opens -> `#setStatus('open')` -> THE STATUS IS UNCHANGED, so the
    //     early return at the top of `#setStatus` swallows the callback
    //   - the link never changes again, so the effect never re-fires
    //
    // Net effect: the lobby renders, the OPEN ROOMS list is permanently empty, and
    // nothing is logged — because in production the same page never sees a second
    // `connect()`, and the audit that never opened a browser saw a green suite.
    //
    // One socket at a time. A reconnect is already scheduled by `#onclose`, which
    // nulls `#socket` first, so this guard does not block recovery.
    if (this.#socket !== null) return;
    this.#open();
  }

  disconnect(): void {
    this.#wanted = false;
    this.#clearTimer();
    this.#socket?.close(1000, 'client disconnect');
    this.#socket = null;
    this.#setStatus('closed');
  }

  /** Drop the credential. Everything cached goes with it. */
  forget(): void {
    this.#storage.removeItem(TOKEN_KEY);
    this.#storage.removeItem(MATCH_KEY);
    this.#hadSession = false;
    resetStore();
  }

  // ─────────────────────────── sending ───────────────────────────

  send(msg: ClientMessage): boolean {
    const sock = this.#socket;
    if (sock === null || sock.readyState !== OPEN) return false;
    sock.send(JSON.stringify(msg));
    return true;
  }

  // lobby
  listLobbies(): void {
    this.send({ t: 'lobby:list' });
  }
  createLobby(name: string, maxPlayers: 2 | 3 | 4 | 5, isPrivate: boolean): void {
    this.send({ t: 'lobby:create', name, maxPlayers, isPrivate });
  }
  joinLobby(lobbyId: string, name: string): void {
    this.send({ t: 'lobby:join', lobbyId, name });
  }
  leaveLobby(): void {
    this.send({ t: 'lobby:leave' });
  }
  setReady(ready: boolean): void {
    this.send({ t: 'lobby:ready', ready });
  }
  startMatch(): void {
    this.send({ t: 'lobby:start' });
  }

  // match
  /**
   * The write door. There is no local application and no optimistic branch — the
   * reason is in the file header and it is the whole point of the client.
   *
   * Returns false when the socket is down, so a caller can queue or tell the user
   * rather than believing a dispatch landed.
   */
  dispatch(action: Action): boolean {
    return this.send({ t: 'match:action', action });
  }

  /** Ask for a full state. Always a full state; there is no delta in this protocol. */
  sync(): void {
    this.send({ t: 'match:sync' });
  }

  spectate(matchId: string): void {
    this.send({ t: 'match:spectate', matchId });
  }

  ping(nonce = ''): void {
    this.send({ t: 'ping', nonce });
  }

  // ─────────────────────────── socket lifecycle ───────────────────────────

  #open(): void {
    this.#clearTimer();
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    let sock: WebSocketLike;
    try {
      sock = this.#factory(this.#url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = sock;

    sock.onopen = (): void => {
      this.#attempt = 0;
      this.#setStatus('open');
      setPhase('connecting');
      // Reclaim the seat BEFORE anything else. A player who refreshes mid-answer
      // must be re-seated before the UI can render anything, or they briefly see
      // an empty board and a button that silently fails.
      if (this.#hadSession) this.#resume();
    };

    sock.onmessage = (ev: { data: unknown }): void => {
      this.#receive(ev.data);
    };

    sock.onerror = (): void => {
      // `onclose` always follows; reconnect is scheduled there so it happens once.
    };

    sock.onclose = (): void => {
      this.#socket = null;
      // The prompt dies with the socket, immediately and unconditionally.
      //
      // The server's rule is that the prompt exists only while it is this player's
      // answer to give. A dropped socket means the client no longer KNOWS that, so
      // continuing to render the question and the two labels is displaying a
      // deliberation the player is no longer being asked — and a reconnect might
      // hand them a different card, in which case the question on screen is a
      // question they were never asked. The correct copy always arrives with the
      // `match:state` that follows a resume.
      clearBlind();
      if (!this.#wanted) {
        this.#setStatus('closed');
        return;
      }
      this.#scheduleReconnect();
    };
  }

  #resume(): void {
    const token = this.#storage.getItem(TOKEN_KEY);
    if (token === null || token === '') {
      // No credential: a cold start, not a resume. Nothing to do but wait for a
      // lobby:create or lobby:join to hand us one.
      this.#hadSession = false;
      return;
    }
    this.send({ t: 'session:resume', resumeToken: token });
  }

  #scheduleReconnect(): void {
    if (!this.#wanted) return;
    this.#setStatus('reconnecting');
    this.#attempt += 1;
    const b = this.#backoff;
    const raw = Math.min(b.maxMs, b.baseMs * b.factor ** (this.#attempt - 1));
    // Full jitter. Every client dropped by the same deploy would otherwise
    // reconnect in the same millisecond, and the server that just came back would
    // be knocked over by its own recovering table.
    const wait = b.jitter ? Math.random() * raw : raw;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (this.#wanted) this.#open();
    }, wait);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #setStatus(s: ConnectionStatus): void {
    if (this.#status === s) return;
    this.#status = s;
    this.#onStatus(s);
    if (s === 'closed') setPhase('offline');
  }

  #receive(data: unknown): void {
    let msg: ServerMessage;
    try {
      if (typeof data !== 'string') return;
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      // A frame we cannot parse is not a frame. Dropping it is the whole response:
      // there is nothing to retry and no partial state to salvage.
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;

    this.#onMessageType?.(msg.t);

    if (msg.t === 'session:granted') this.#onGranted(msg.session);
    this.#onRawMessage?.(msg);
    applyServerMessage(msg);
  }

  /**
   * Persist the credential the moment it arrives.
   *
   * Written on EVERY grant, including a rotation, because the old token is dead
   * the instant the new one is issued. A client that kept the old one would fail
   * its own next reconnect — and the failure would look like the server losing the
   * seat, which sends an operator looking in entirely the wrong place.
   */
  #onGranted(session: Session): void {
    if (session.resumeToken === '') return;
    this.#storage.setItem(TOKEN_KEY, session.resumeToken);
    this.#hadSession = true;
    if (session.matchId !== null) this.#storage.setItem(MATCH_KEY, session.matchId);
  }

  /** The match this client was last seated at, for a cold deep link. */
  get lastMatchId(): string | null {
    return this.#storage.getItem(MATCH_KEY);
  }
}

/** A module-level connection, because the app has exactly one table per tab. */
let singleton: Connection | null = null;

export function getConnection(opts?: ConnectionOptions): Connection {
  if (singleton === null) singleton = new Connection(opts ?? {});
  return singleton;
}

export function disposeConnection(): void {
  singleton?.disconnect();
  singleton = null;
}

export { getStore };
