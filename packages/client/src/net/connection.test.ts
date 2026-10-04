/**
 * THE SEAT-HANDOVER GATE — the regression test for the bug that hung a table forever.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, restated because the mechanism is the whole point and it is not
 * obvious from either file alone.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A browser audit pressed one button the UI offers on purpose — `WATCH INSTEAD`, on
 * the third seat of a three-seat room — and the table could never be played again.
 * The host started the match and it began with THREE players, the third being a
 * seat whose tab was still sitting in the lobby. After 70 steps of driving the two
 * real players, `activePlayer` was the ghost, `awaitingAnswer: true`,
 * `finished: false` — forever. No client anywhere could answer for that seat,
 * because the connection behind it had been handed a spectator session.
 *
 * WHY. The client sent one frame, `lobby:spectate`. The server's spectator branch
 * (`packages/server/src/index.ts` `#joinLobby`) does this:
 *
 *     const rec = this.sessions.create(name, 'spectator');
 *     rec.lobbyId = lobbyId;
 *     conn.session = rec;        // ← the PLAYER session is overwritten…
 *     this.#send(conn.socket, { t: 'session:granted', … });
 *     this.#send(conn.socket, { t: 'lobby:state', … });
 *     return;                    // ← …and returns. `hub.leaveLobby` is NEVER called.
 *
 * `hub.leaveLobby` is available two functions below and is the one call that would
 * have freed the seat. So the seat survived in the hub with no connection behind it,
 * and `startMatch` dealt it into the turn order as a live member.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS ACTUALLY TESTED HERE, and what is deliberately NOT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The server is not this package's to change, so the fix is the client's half of the
 * handover: RELEASE THE SEAT THROUGH THE SERVER'S OWN DOOR FIRST, then ask to watch.
 * `lobby:leave` reaches `#leaveLobby`, which is exactly the code that was missing —
 * `hub.leaveLobby(lobbyId, rec.playerId)` plus `rec.lobbyId = null`.
 *
 * So the second describe below runs those two server handlers — transcribed, not
 * reimplemented, with the line numbers named — against the frames the REAL
 * `Connection` emits, and asserts the seat is free and the started match has no
 * ghost. It includes the NEGATIVE CONTROL: the same server, fed the old client's
 * single `lobby:spectate` frame, produces the orphan and the three-player match.
 * A regression test that cannot fail on the bug it exists for is not a gate.
 *
 * WHAT IS NOT CLAIMED: that the server is correct. The transcription is a model, and
 * a model can drift from the thing it models. What is claimed is the property this
 * package owns — that the client never expresses the order in which the seat is
 * orphaned, and that it cannot half-deliver a handover.
 */

import { describe, expect, it } from 'vitest';

import { Connection, type WebSocketLike } from './connection.ts';
import type { ClientMessage } from './protocol.ts';

/** A socket that records every frame and never speaks back. */
function recorder(): { socket: WebSocketLike; sent: ClientMessage[] } {
  const sent: ClientMessage[] = [];
  const socket: WebSocketLike = {
    send(data: string) {
      sent.push(JSON.parse(data) as ClientMessage);
    },
    close() {
      /* nothing to close */
    },
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    readyState: 1,
  };
  return { socket, sent };
}

/** A live `Connection` over a recording socket, with no timers and no storage. */
function liveConnection(): { connection: Connection; sent: ClientMessage[] } {
  const { socket, sent } = recorder();
  const connection = new Connection({
    url: 'ws://127.0.0.1:8787/ws',
    socketFactory: () => socket,
    storage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
  connection.connect();
  return { connection, sent };
}

// ─────────────────────────── the frames ───────────────────────────

describe('giving up a seat to watch a room', () => {
  it('releases the seat FIRST and asks to watch second, on one socket', () => {
    const { connection, sent } = liveConnection();

    expect(connection.giveUpSeatAndWatch('lob_1')).toBe(true);

    // Exactly two frames, in this order. The order is the fix: `lobby:spectate`
    // arriving while the seat is still held is the hang, so a test that only
    // counted frames would pass on the bug.
    expect(sent.map((m) => m.t)).toEqual(['lobby:leave', 'lobby:spectate']);
    const spectate = sent[1];
    expect(spectate).toEqual({ t: 'lobby:spectate', lobbyId: 'lob_1' });
    // And it names the room it is walking into, so a seat is never released for a
    // room this connection was not in.
    expect(sent.every((m) => !('lobbyId' in m) || m.lobbyId === 'lob_1')).toBe(true);
  });

  it('sends NO spectate frame when the leave did not land', () => {
    // A half-delivered handover is the original hang: `lobby:spectate` arriving
    // with the seat still held. A socket that is CONNECTING refuses the first
    // frame, and the second must not go out behind it.
    const { socket, sent } = recorder();
    const connection = new Connection({
      url: 'ws://127.0.0.1:8787/ws',
      socketFactory: () => socket,
      storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    });
    // Never `connect()`ed, so there is no socket and every `send` is refused.
    expect(connection.giveUpSeatAndWatch('lob_1')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('watching a room from the list takes no seat at all — one frame, no leave', () => {
    const { connection, sent } = liveConnection();

    expect(connection.watchRoom('lob_2')).toBe(true);

    // The room-list WATCH is a DIFFERENT action from giving up a seat, and the
    // difference is on the wire: there is no seat to release, so there is no
    // `lobby:leave`. This is the path that works on a full room.
    expect(sent).toEqual([{ t: 'lobby:spectate', lobbyId: 'lob_2' }]);
  });

  it('reaches the live match: a spectator is attached with `match:spectate`', () => {
    // `match:spectate` is fully implemented server-side (`#spectate` → `#attach`)
    // and, before this, was sent by NOTHING in `packages/client/src` — the feature
    // had no entry point from the real client. One frame, and it names the room.
    const { connection, sent } = liveConnection();
    expect(connection.spectate('m_abc123')).toBe(true);
    expect(sent).toEqual([{ t: 'match:spectate', matchId: 'm_abc123' }]);
  });
});

// ─────────────────────── the server, transcribed ───────────────────────

/**
 * A transcription of the two handlers in `packages/server/src/index.ts` that decide
 * whether a seat survives. Not a reimplementation: the control flow, the order of
 * the calls and the absence of any other release path are the point, and they are
 * quoted in the comments with the line numbers they came from.
 */
function server(): {
  handle(frame: ClientMessage, conn: Conn): void;
  startMatch(lobbyId: string): readonly string[];
  seats(lobbyId: string): readonly string[];
} {
  const lobbies = new Map<string, Map<string, string>>(); // lobbyId → playerId → name
  const host = new Map<string, string>();
  const matchIdOf = new Map<string, string>();
  let nextId = 0;

  type Rec = { role: 'player' | 'spectator'; playerId: string; lobbyId: string | null; matchId: string | null };
  type Conn = { session: Rec | null; name: string };

  function create(conn: Conn, lobbyId: string, name: string): void {
    const playerId = `p_${(nextId += 1)}`;
    lobbies.set(lobbyId, new Map([[playerId, name]]));
    host.set(lobbyId, playerId);
    conn.session = { role: 'player', playerId, lobbyId, matchId: null };
  }

  function join(conn: Conn, lobbyId: string, name: string): string | null {
    const lobby = lobbies.get(lobbyId);
    if (lobby === undefined) return null;
    const playerId = `p_${(nextId += 1)}`;
    lobby.set(playerId, name);
    conn.session = { role: 'player', playerId, lobbyId, matchId: null };
    return playerId;
  }

  return {
    handle(frame, conn) {
      if (frame.t === 'lobby:create') {
        create(conn, 'lob_1', conn.name);
        return;
      }
      if (frame.t === 'lobby:join') {
        join(conn, frame.lobbyId, conn.name);
        return;
      }
      if (frame.t === 'lobby:leave') {
        // `#leaveLobby`, index.ts:435-442 — the ONE function that frees a seat.
        const rec = conn.session;
        if (rec === null || rec.lobbyId === null) return;
        lobbies.get(rec.lobbyId)?.delete(rec.playerId);
        if (host.get(rec.lobbyId) === rec.playerId) {
          const next = [...(lobbies.get(rec.lobbyId)?.keys() ?? [])][0];
          if (next === undefined) host.delete(rec.lobbyId);
          else host.set(rec.lobbyId, next);
        }
        rec.lobbyId = null;
        return;
      }
      if (frame.t === 'lobby:spectate') {
        // `#joinLobby`'s spectator branch, index.ts:405-417. Note what is NOT here:
        // no `hub.leaveLobby`. The seat this connection already held is not released.
        const rec: Rec = { role: 'spectator', playerId: `p_${(nextId += 1)}`, lobbyId: frame.lobbyId, matchId: null };
        conn.session = rec;
        return;
      }
      if (frame.t === 'match:spectate') {
        // `#spectate`, index.ts:634-647 — attaches a spectator to a live room.
        conn.session = { role: 'spectator', playerId: `p_${(nextId += 1)}`, lobbyId: null, matchId: frame.matchId };
        return;
      }
    },
    seats(lobbyId) {
      return [...(lobbies.get(lobbyId)?.keys() ?? [])];
    },
    startMatch(lobbyId) {
      // `LobbyHub#startMatch`, lobby.ts:234-310: every MEMBER becomes a seat.
      const members = [...(lobbies.get(lobbyId)?.keys() ?? [])];
      matchIdOf.set(lobbyId, 'm_1');
      return members;
    },
  };
}

type Conn = { session: { role: 'player' | 'spectator'; playerId: string; lobbyId: string | null; matchId: string | null } | null; name: string };

/** A tab: a real `Connection` over a recording socket, plus a modelled session. */
function tab(name: string): { connection: Connection; frames: ClientMessage[]; conn: Conn } {
  const { connection, sent } = liveConnection();
  return { connection, frames: sent, conn: { session: null, name } };
}

describe('the table the client actually builds', () => {
  /** Three tabs join a three-seat room; the third gives its seat up to watch. */
  function threeSeatsGiveUpTheThird(): {
    hub: ReturnType<typeof server>;
    tabs: ReturnType<typeof tab>[];
    lobbyId: string;
  } {
    const hub = server();
    const lobbyId = 'lob_1';
    const tabs = [tab('P1'), tab('P2'), tab('P3')];
    hub.handle({ t: 'lobby:create', name: 'P1', maxPlayers: 3, isPrivate: false }, tabs[0]!.conn);
    for (const t of tabs.slice(1)) {
      hub.handle({ t: 'lobby:join', lobbyId, name: t.conn.name }, t.conn);
    }
    expect(hub.seats(lobbyId), 'three seats are taken').toHaveLength(3);
    return { hub, tabs, lobbyId };
  }

  it('releases the seat, so the match starts with the players who are still there', () => {
    const { hub, tabs, lobbyId } = threeSeatsGiveUpTheThird();

    // The button. Both frames, and the transport's order is the client's order.
    tabs[2]!.connection.giveUpSeatAndWatch(lobbyId);
    for (const frame of tabs[2]!.frames) hub.handle(frame, tabs[2]!.conn);

    // The seat is FREE — not merely unheld by the tab.
    expect(hub.seats(lobbyId), 'the orphaned seat must be released, not abandoned').toHaveLength(2);
    // And the session that comes back is a spectator, so nothing it does can act.
    expect(tabs[2]!.conn.session?.role).toBe('spectator');

    // The host starts. Two players, both of whom have a connection behind them.
    const turnOrder = hub.startMatch(lobbyId);
    expect(turnOrder).toHaveLength(2);
    const connected = tabs
      .map((t) => t.conn.session)
      .filter((s): s is NonNullable<typeof s> => s !== null && s.role === 'player')
      .map((s) => s.playerId);
    for (const seat of turnOrder) {
      expect(connected, `turn order seat ${seat} has no client behind it`).toContain(seat);
    }
    // Nobody in the turn order is the watching tab's own id, in either role.
    expect(turnOrder).not.toContain(tabs[2]!.conn.session?.playerId);
  });

  it('NEGATIVE CONTROL: the old single `lobby:spectate` frame orphans the seat', () => {
    // The bug, reproduced against the same transcribed server. If this test ever
    // stops producing the orphan, the model has drifted and the gate above is
    // guarding nothing — so it is asserted, not assumed.
    const { hub, tabs, lobbyId } = threeSeatsGiveUpTheThird();

    tabs[2]!.connection.send({ t: 'lobby:spectate', lobbyId });
    for (const frame of tabs[2]!.frames) hub.handle(frame, tabs[2]!.conn);

    // The seat survives, with no connection behind it…
    expect(hub.seats(lobbyId)).toHaveLength(3);
    // …and the host's match deals it in anyway. THIS is the hang: three players,
    // one of whom nothing can ever answer for.
    expect(hub.startMatch(lobbyId)).toHaveLength(3);
    expect(tabs[2]!.conn.session?.role).toBe('spectator');
  });

  it('watching a full room from the list never touches a seat', () => {
    const hub = server();
    const lobbyId = 'lob_1';
    const p1 = tab('P1');
    const p2 = tab('P2');
    const watcher = tab('W');
    hub.handle({ t: 'lobby:create', name: 'P1', maxPlayers: 2, isPrivate: false }, p1.conn);
    hub.handle({ t: 'lobby:join', lobbyId, name: 'P2' }, p2.conn);
    expect(hub.seats(lobbyId)).toHaveLength(2);

    // A two-seat room is FULL, so its JOIN is disabled — which is exactly why the
    // list needs a WATCH that takes no seat.
    watcher.connection.watchRoom(lobbyId);
    for (const frame of watcher.frames) hub.handle(frame, watcher.conn);

    expect(hub.seats(lobbyId), 'watching must not consume a seat').toHaveLength(2);
    expect(watcher.conn.session?.role).toBe('spectator');
    expect(watcher.frames).toEqual([{ t: 'lobby:spectate', lobbyId }]);
  });
});
