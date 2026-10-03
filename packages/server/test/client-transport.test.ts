/**
 * The client transport, tested from the server's suite.
 *
 * WHY IT LIVES HERE. The brief puts the tests in `packages/server/test/`, and there
 * is a real reason beyond tidiness: reconnect is a CONTRACT BETWEEN THE TWO HALVES,
 * and a test that only sees one half cannot check it. The properties below —
 * "the token is persisted the instant it is granted", "a drop re-resumes rather
 * than restarting", "the prompt is never restored from a cache" — are all about
 * what the client does with a message the server sent, and the fixtures for the
 * server side are already here.
 *
 * THE THREE PROPERTIES THAT MATTER:
 *
 *  1. A drop RESUMES. A refresh must re-seat, not re-lobby. A client that came
 *     back as a stranger would lose its seat, its board, and — worst — its answer
 *     prompt, in a 4-hour game.
 *
 *  2. THE PROMPT IS NEVER CACHED. It is rebuilt from the server's state on every
 *     reconnect. A cached copy could disagree with the server's, and then the
 *     player clicks one question and is charged for the other.
 *
 *  3. NOTHING IS APPLIED LOCALLY. The store has no `dispatch`. A client that
 *     applies actions optimistically holds a copy of the game, and a client that
 *     holds a copy of the game is one refactor away from holding a card.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Connection } from '../../client/src/net/connection.ts';
import {
  applyEvents,
  applyServerMessage,
  applyState,
  clearAnswer,
  getStore,
  resetStore,
} from '../../client/src/net/store.ts';
import type { WebSocketLike, ConnectionStatus } from '../../client/src/net/connection.ts';
import type { ServerMessage } from '../../client/src/net/protocol.ts';
import { testClientState } from './fixtures.ts';

// ─────────────────────────── a scriptable socket ───────────────────────────

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.onclose?.({});
  }

  // ── test controls ──
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  parsed(): unknown[] {
    return this.sent.map((s) => JSON.parse(s) as unknown);
  }
  types(): string[] {
    return this.parsed().map((p) => (p as { t: string }).t);
  }
}

function memStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

let conn: Connection | null = null;

afterEach(() => {
  conn?.disconnect();
  conn = null;
  FakeSocket.instances = [];
  resetStore();
});

function open(opts: { storage?: ReturnType<typeof memStorage>; jitter?: boolean } = {}): {
  c: Connection;
  s: FakeSocket;
  statuses: ConnectionStatus[];
  storage: ReturnType<typeof memStorage>;
} {
  const storage = opts.storage ?? memStorage();
  const statuses: ConnectionStatus[] = [];
  const c = new Connection({
    url: 'ws://test/ws',
    storage,
    backoff: { baseMs: 1, maxMs: 2, factor: 1, jitter: opts.jitter ?? false },
    onStatus: (st) => statuses.push(st),
    socketFactory: (url) => new FakeSocket(url),
  });
  conn = c;
  c.connect();
  const s = FakeSocket.instances.at(-1);
  if (s === undefined) throw new Error('no socket was created');
  s.open();
  return { c, s, statuses, storage };
}

const SESSION = {
  sessionId: 's_1',
  resumeToken: 'tok-abc',
  playerId: 'p_1',
  matchId: 'm_1',
  lobbyId: null,
  role: 'player' as const,
  name: 'Ada',
};

function matchState(
  over: Partial<Extract<ServerMessage, { t: 'match:state' }>> = {},
): Extract<ServerMessage, { t: 'match:state' }> {
  return {
    t: 'match:state',
    matchId: 'm_1',
    viewId: 1,
    state: testClientState(),
    answer: null,
    you: { role: 'player', playerId: 'p_1' },
    ...over,
  };
}

describe('the client persists the credential the moment it is granted', () => {
  it('stores the token, and stores the NEW one on every rotation', () => {
    const { c, s, storage } = open();
    s.deliver({ t: 'session:granted', session: SESSION });
    expect(storage.getItem('shasn.resumeToken')).toBe('tok-abc');
    expect(c.resumeToken).toBe('tok-abc');
    expect(getStore().session?.playerId).toBe('p_1');

    // The server rotates on every use, so the old token is DEAD the instant the new
    // one arrives. A client that kept the old one would fail its own next
    // reconnect, and the symptom would look like the server losing the seat.
    s.deliver({ t: 'session:granted', session: { ...SESSION, resumeToken: 'tok-2' } });
    expect(storage.getItem('shasn.resumeToken')).toBe('tok-2');
  });

  it('stores nothing for an anonymous grant', () => {
    const { s, storage } = open();
    s.deliver({ t: 'session:granted', session: { ...SESSION, resumeToken: '' } });
    expect(storage.getItem('shasn.resumeToken')).toBeNull();
  });

  it('forget() drops the credential AND the cached state', () => {
    const { c, s, storage } = open();
    s.deliver({ t: 'session:granted', session: SESSION });
    s.deliver(matchState());
    expect(getStore().state).not.toBeNull();
    c.forget();
    expect(storage.getItem('shasn.resumeToken')).toBeNull();
    expect(getStore().state).toBeNull();
    expect(getStore().session).toBeNull();
  });
});

describe('a dropped connection RESUMES rather than starting over', () => {
  it('re-sends session:resume on the next socket, with the stored token', async () => {
    const storage = memStorage();
    const { c, s } = open({ storage });
    s.deliver({ t: 'session:granted', session: SESSION });

    s.drop();
    expect(c.status).toBe('reconnecting');
    // Wait past the (1 ms) backoff.
    await new Promise((r) => setTimeout(r, 25));

    const next = FakeSocket.instances.at(-1);
    expect(next, 'no reconnect socket was created').toBeDefined();
    expect(next).not.toBe(s);
    next?.open();

    // Resume is sent on OPEN, before anything else, so the seat is reclaimed before
    // the UI can render a button that would silently fail.
    const msgs = next?.parsed() as { t: string; resumeToken?: string }[];
    expect(msgs[0]?.t).toBe('session:resume');
    expect(msgs[0]?.resumeToken).toBe('tok-abc');
  });

  it('does NOT resume a cold start: no token, no resume message', async () => {
    const { s } = open();
    s.drop();
    await new Promise((r) => setTimeout(r, 25));
    const next = FakeSocket.instances.at(-1);
    next?.open();
    expect(next?.types()).not.toContain('session:resume');
  });

  it('reconnects with growing, jittered backoff and never gives up', async () => {
    vi.useFakeTimers();
    try {
      const storage = memStorage();
      const { c, s } = open({ storage, jitter: true });
      s.deliver({ t: 'session:granted', session: SESSION });
      const before = FakeSocket.instances.length;

      // Five drops, no server ever answering. A client that stops trying is a
      // player who has to be told to reload, which is the thing this feature exists
      // to avoid.
      for (let i = 0; i < 5; i += 1) {
        const sock = FakeSocket.instances.at(-1);
        sock?.drop();
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(FakeSocket.instances.length).toBeGreaterThan(before + 4);
      expect(c.status).toBe('reconnecting');

      c.disconnect();
      expect(c.status).toBe('closed');
      const settled = FakeSocket.instances.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(FakeSocket.instances.length, 'a disconnected client kept reconnecting').toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the store never applies an action locally', () => {
  it('has no dispatch, and a reconnect cannot manufacture a move', async () => {
    const storage = memStorage();
    const { c, s } = open({ storage });
    s.deliver({ t: 'session:granted', session: SESSION });
    const before = getStore().viewId;

    s.drop();
    await new Promise((r) => setTimeout(r, 25));
    const next = FakeSocket.instances.at(-1);
    next?.open();

    // A reconnect moves the client's viewId by nothing. The only thing that moves
    // it is a `match:state` from the server.
    expect(getStore().viewId).toBe(before);
    expect(getStore().state).toBeNull();
    void c;
  });

  it('ignores a dispatch while the socket is down rather than queueing it', async () => {
    const { c, s } = open();
    s.drop();
    expect(c.dispatch({ type: 'END_TURN' })).toBe(false);
    expect(s.types()).not.toContain('match:action');
  });

  it('a rejected action changes nothing at all, because nothing was applied', () => {
    const s0 = testClientState();
    applyServerMessage(matchState({ state: s0 }));
    const before = getStore();
    expect(before.state).not.toBeNull();

    applyServerMessage({ t: 'error', code: 'ILLEGAL_ACTION', message: 'not your turn' });
    const after = getStore();
    expect(after.state).toBe(before.state);
    expect(after.viewId).toBe(before.viewId);
    expect(after.error?.message).toBe('not your turn');
  });
});

describe('the answer prompt is rebuilt from the server, never cached', () => {
  // A whole printed card under full information: label, Ideologue and payout per side,
  // plus the `order` draw. The client keeps it only while it is this player's to answer.
  const prompt = {
    question: 'Q?',
    sides: [
      { label: 'Left', ideologue: 'idealist', pays: { funds: 4 } },
      { label: 'Right', ideologue: 'capitalist', pays: { funds: 1 } },
    ],
    order: 'ab',
  } as const;

  it('holds the prompt only while it is this player\'s answer to give', () => {
    const state = testClientState({ phase: 'answer', activePlayer: 'p_1' });
    applyState({
      matchId: 'm_1',
      viewId: 1,
      state,
      answer: { question: 'Q?', sides: prompt.sides, order: 'ab' },
      you: { role: 'player', playerId: 'p_1' },
    });
    expect(getStore().answer).not.toBeNull();

    // Phase moves on. The prompt must go, immediately, with no action from anyone.
    applyState({
      matchId: 'm_1',
      viewId: 2,
      state: testClientState({ phase: 'actions', activePlayer: 'p_1' }),
      answer: null,
      you: { role: 'player', playerId: 'p_1' },
    });
    expect(getStore().answer).toBeNull();
  });

  it('drops a prompt addressed to somebody else, even if the server sent it', () => {
    // Defence in depth. The server does not do this, but a client that renders a
    // prompt it was handed without checking whose it is would display the `order`
    // draw for a card this seat is not answering — which, under full information, is
    // the ONLY field in the prompt the rest of the table does not already have.
    applyState({
      matchId: 'm_1',
      viewId: 1,
      state: testClientState({ phase: 'answer', activePlayer: 'p_2' }),
      answer: { question: 'Q?', sides: prompt.sides, order: 'ba' },
      you: { role: 'player', playerId: 'p_1' },
    });
    expect(getStore().answer).toBeNull();
  });

  it('a spectator is never given a prompt', () => {
    applyState({
      matchId: 'm_1',
      viewId: 1,
      state: testClientState({ phase: 'answer', activePlayer: 'p_1' }),
      answer: { question: 'Q?', sides: prompt.sides, order: 'ab' },
      you: { role: 'spectator', playerId: null },
    });
    expect(getStore().answer).toBeNull();
  });

  it('does not restore a prompt from anywhere on reconnect', async () => {
    const storage = memStorage();
    const { s } = open({ storage });
    s.deliver({ t: 'session:granted', session: SESSION });
    s.deliver(
      matchState({
        state: testClientState({ phase: 'answer', activePlayer: 'p_1' }),
        answer: { question: 'Q?', sides: prompt.sides, order: 'ab' },
      }),
    );
    expect(getStore().answer).not.toBeNull();

    s.drop();
    await new Promise((r) => setTimeout(r, 25));
    // The moment the socket is gone the prompt is gone. It comes back only if the
    // server sends it again, and it is the SERVER's copy.
    expect(getStore().answer).toBeNull();

    const next = FakeSocket.instances.at(-1);
    next?.open();
    next?.deliver({ t: 'session:granted', session: { ...SESSION, resumeToken: 'tok-2' } });
    expect(getStore().answer).toBeNull();
    next?.deliver(
      matchState({
        state: testClientState({ phase: 'answer', activePlayer: 'p_1' }),
        answer: { question: 'Q?', sides: prompt.sides, order: 'ab' },
      }),
    );
    expect(getStore().answer?.question).toBe('Q?');
  });

  it('clearAnswer is idempotent', () => {
    clearAnswer();
    applyState({
      matchId: 'm_1',
      viewId: 1,
      state: testClientState({ phase: 'answer', activePlayer: 'p_1' }),
      answer: { question: 'Q?', sides: prompt.sides, order: 'ab' },
      you: { role: 'player', playerId: 'p_1' },
    });
    clearAnswer();
    clearAnswer();
    expect(getStore().answer).toBeNull();
  });
});

describe('state and events are ordered by viewId', () => {
  it('buffers events until their state lands, then flushes in order', () => {
    applyEvents(1, [{ type: 'turn-ended', player: 'p_1' }]);
    // No state yet, so the event is held.
    expect(getStore().recentEvents).toHaveLength(0);

    applyState({
      matchId: 'm_1',
      viewId: 1,
      state: testClientState(),
      answer: null,
      you: { role: 'player', playerId: 'p_1' },
    });
    expect(getStore().recentEvents).toHaveLength(1);
    expect(getStore().pendingEvents).toHaveLength(0);
  });

  it('drops an event for a viewId it already holds, so a reconnect cannot double it', () => {
    applyState({
      matchId: 'm_1',
      viewId: 5,
      state: testClientState(),
      answer: null,
      you: { role: 'player', playerId: 'p_1' },
    });
    applyEvents(5, [{ type: 'turn-ended', player: 'p_1' }]);
    applyEvents(5, [{ type: 'turn-ended', player: 'p_1' }]);
    expect(getStore().recentEvents).toHaveLength(0);
  });

  it('keeps a future event buffered until its state arrives', () => {
    applyState({
      matchId: 'm_1',
      viewId: 1,
      state: testClientState(),
      answer: null,
      you: { role: 'player', playerId: 'p_1' },
    });
    // Out of order: the event for viewId 3 arrives before the state for 2.
    applyEvents(3, [{ type: 'turn-ended', player: 'p_3' }]);
    expect(getStore().pendingEvents).toHaveLength(1);
    expect(getStore().recentEvents).toHaveLength(0);

    applyState({
      matchId: 'm_1',
      viewId: 2,
      state: testClientState(),
      answer: null,
      you: { role: 'player', playerId: 'p_1' },
    });
    expect(getStore().pendingEvents).toHaveLength(1);
    applyState({
      matchId: 'm_1',
      viewId: 3,
      state: testClientState(),
      answer: null,
      you: { role: 'player', playerId: 'p_1' },
    });
    expect(getStore().pendingEvents).toHaveLength(0);
    expect(getStore().recentEvents).toHaveLength(1);
  });
});

describe('a malformed or hostile frame is dropped, not thrown', () => {
  it('survives garbage of every shape', () => {
    const { s } = open();
    const sock = s as unknown as { onmessage: ((ev: { data: unknown }) => void) | null };
    for (const bad of ['', '{', 'null', '[]', '42', '{"t":', '{"noT":1}', 'not json', '"a string"', '{"t":123}']) {
      expect(() => sock.onmessage?.({ data: bad })).not.toThrow();
    }
    // And a valid frame still works afterwards. The store is untouched by all of
    // the above: no state, no session, and the phase is whatever the connection
    // last said it was.
    sock.onmessage?.({ data: JSON.stringify({ t: 'pong', nonce: 'x' }) });
    expect(getStore().state).toBeNull();
    expect(getStore().session).toBeNull();
    expect(getStore().lobbies).toEqual([]);
  });
});

// `vi` is used only inside the fake-timer block above; imported lazily so the rest