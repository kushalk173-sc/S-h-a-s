/**
 * The session: one place that talks to the transport.
 *
 * `net/connection.ts` is the transport and this file does not reimplement any of
 * it — no socket, no backoff, no resume, no message folding. What this adds is
 * the three things the transport deliberately does not do, because each of them
 * is a decision rather than a mechanism:
 *
 *   1. ONE CONNECTION, created on demand and remembered. `getConnection()` is a
 *      singleton already, so this is really about handing it a status callback
 *      exactly once, on first use, from a React effect.
 *
 *   2. THE LINK STATE, pushed into `app/store.ts` so the topbar and the reconnect
 *      screen have something honest to render.
 *
 *   3. GUARDED SENDS. `Connection.send` returns `false` when the socket is down
 *      rather than throwing, which is correct for a transport and useless for a
 *      UI: a button that silently does nothing is the failure mode §9.10 is
 *      about. So `send` here turns a `false` into a visible refusal.
 *
 * NOTHING IS RETRIED AUTOMATICLY. A dropped `dispatch` is not re-sent on
 * reconnect, because a re-sent `ANSWER` is a second answer to a card the player
 * has already answered, and the engine would reject it — or, worse, accept it
 * against a redrawn card. The transport resumes the SEAT; the player re-issues
 * the INTENT. That asymmetry is the whole design.
 */

import {
  getConnection,
  subscribe as subscribeNet,
  getStore,
  type ClientStore,
  type Connection,
} from '../net/index.ts';

import { applyConnectionStatus, setRefusal } from './store.ts';

let wired = false;

/**
 * The live connection, created on first use.
 *
 * The status callback is passed HERE, once, because `getConnection` ignores
 * options after the singleton exists — a second call with a new callback would
 * be silently discarded, which is the kind of thing that makes a reconnect
 * indicator that never updates.
 */
export function connection(): Connection {
  const c = getConnection({ onStatus: applyConnectionStatus });
  if (!wired) {
    wired = true;
    // A late `open` (the socket was already up before React mounted) does not
    // re-fire `onStatus`, so the initial link is derived from the transport's own
    // reported status rather than assumed to be `connecting`.
    applyConnectionStatus(c.status);
  }
  return c;
}

/** Subscribe to the server-synced store. */
export function subscribeNetStore(fn: () => void): () => void {
  return subscribeNet(fn);
}

export function netState(): ClientStore {
  return getStore();
}

/** The connection's own status, read on demand. */
export function isLive(): boolean {
  return connection().connected;
}

/**
 * Send, and say so if it did not land.
 *
 * The message is deliberately terse and names no game concept: a player whose
 * socket dropped mid-turn needs to know the press did not register, not which
 * rule they appear to have violated.
 *
 * THE CALLBACK'S OWN BOOLEAN IS THE SIGNAL, NOT THE TRANSPORT'S STATUS. This used
 * to ask `c.status === 'closed'`, which is the wrong question in both directions:
 * a socket that is CONNECTING or RECONNECTING is just as unable to carry a frame,
 * and a status of `open` proves only that SOME socket was open. `Connection.send`
 * already knows whether the frame actually went out — it returns `false` when the
 * socket is null or not `OPEN` — so that is what is read here. Every existing
 * caller returns `void`, which is why the type is the union and why nothing at
 * any call site had to change.
 */
export function send(fn: (c: Connection) => boolean | void): boolean {
  let landed: boolean | void;
  try {
    landed = fn(connection());
  } catch {
    landed = false;
  }
  if (landed === false) {
    setRefusal('That did not reach the table. The connection is down — reconnecting.');
    return false;
  }
  return true;
}

/**
 * Ask the server what is true. Used on reconnect and on the reconnect screen's
 * REJOIN button. The server replies with a full `match:state`, which is the only
 * way this client learns anything.
 */
export function requestSync(): void {
  send((c) => c.sync());
}

/**
 * REACQUIRE THE SEAT AFTER A PAGE RELOAD.
 *
 * WHY THIS IS NOT ALREADY THE TRANSPORT'S JOB. `Connection#resume` is gated behind
 * its own in-memory `#hadSession` flag, which is set when a `session:granted` arrives
 * during THIS page's lifetime. A refresh destroys the `Connection` and the flag with
 * it, so `onopen` never sends `session:resume` — even though the token is sitting in
 * `sessionStorage` precisely so it survives. The result is that a player who refreshes
 * mid-turn comes back to the LOBBY, looking at their own match listed as "in progress"
 * with a disabled JOIN button. The seat is still held; the client just never asks.
 *
 * `net/connection.ts` is not this file's to change, and the right fix there is a real
 * design question (when is a held token authoritative?). What IS this file's is the
 * decision — *should* we try to resume — and that is answerable here from public state.
 *
 * GUARDED ON `lastMatchId`. A token with no remembered match is either a stale one or a
 * fresh session, and asking anyway would earn an `RESUME_INVALID` toast on every cold
 * load. A refresh mid-game is the only case where the seat is known to be worth
 * reclaiming, and that is exactly what `shasn.matchId` records.
 */
export function resumeIfHeld(): boolean {
  const c = connection();
  const token = c.resumeToken;
  if (token === null || token === '') return false;
  if (c.lastMatchId === null) return false;
  return send(() => c.send({ t: 'session:resume', resumeToken: token }));
}

/** Drop the credential and every cached thing. The "start over" path. */
export function leaveMatch(): void {
  const c = connection();
  c.leaveLobby();
  c.forget();
}
