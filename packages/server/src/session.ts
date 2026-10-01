/**
 * Sessions, seats, and the resume path.
 *
 * THE REQUIREMENT: a player closes the tab for two hours, comes back, and the
 * board is exactly as they left it, in the correct phase, with their own view. Not
 * a fresh page, not a reset seat, and — critically — if they return *mid-answer*,
 * the same blind prompt with the same two labels in the same order, and still no
 * payout.
 *
 * HOW IT WORKS:
 *
 *  1. On first connect the server mints a 256-bit token with `crypto.randomBytes`
 *     and sends it in `session:granted`. Only its SHA-256 is ever written down, so
 *     a leaked store is not a leaked credential.
 *  2. On disconnect the seat is marked disconnected and **held**. It is not
 *     released and the turn is not skipped. Shasn is turn-based, not clock-based,
 *     so there is nothing to pause: the absent player is simply the one who is not
 *     answering.
 *  3. On return the client sends `session:resume` with the token. The server
 *     verifies it in constant time, **rotates** it so a captured token is
 *     single-use, rehydrates the room from the action log if the process restarted
 *     while the player was away, and replies with a full state at the current
 *     `viewId`.
 *
 * RECONCILIATION IS ZERO LINES, and that is the payoff of never doing optimistic
 * state: the client holds no authoritative state of its own, so it discards its
 * local store and adopts the server's. A full state once per reconnect is
 * irrelevant. Deltas are where rehydration bugs live, so `match:sync` always
 * returns a full state and never a patch.
 */

import { sha } from './store.ts';
import { newId, newToken, type Room } from './room.ts';
import type { LobbyRecord } from './lobby.ts';
import type { ServerMessage, Session } from './protocol.ts';

export type ConnectionRole = 'player' | 'spectator';

export type SessionRecord = {
  readonly sessionId: string;
  /**
   * Server-assigned and opaque. Mutable only because the session is created before
   * it is attached to a seat, and the seat's id is the one the credential addresses.
   */
  playerId: string;
  /** Presentation only. The opaque id is what the credential addresses. */
  readonly name: string;
  role: ConnectionRole;
  lobbyId: string | null;
  matchId: string | null;
  /**
   * The live token, held in memory so a reconnect inside the grace window can be
   * re-granted, and mirrored onto the room's seat as a hash so the credential
   * outlives the process. Never written to the store in the clear.
   */
  token: string;
  tokenHash: string;
  tokenIssuedAt: number;
};

export type ResumeOk = {
  readonly ok: true;
  readonly session: SessionRecord;
  readonly room: Room | null;
  readonly lobby: LobbyRecord | null;
  /** True when the player is owed a blind prompt the moment they reconnect. */
  readonly owesPrompt: boolean;
};

export type ResumeFail = { readonly ok: false; readonly reason: string };

export class SessionStore {
  readonly #bySession = new Map<string, SessionRecord>();
  /** token hash → session id. The only index a raw token ever reaches. */
  readonly #byHash = new Map<string, string>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  create(name: string, role: ConnectionRole = 'player'): SessionRecord {
    const rec: SessionRecord = {
      sessionId: newId('s', 12),
      playerId: newId('p', 12),
      name,
      role,
      lobbyId: null,
      matchId: null,
      token: '',
      tokenHash: '',
      tokenIssuedAt: 0,
    };
    this.#bySession.set(rec.sessionId, rec);
    this.rotate(rec);
    return rec;
  }

  byId(sessionId: string): SessionRecord | undefined {
    return this.#bySession.get(sessionId);
  }

  /**
   * Re-attach a token that was issued by a PREVIOUS process.
   *
   * This is the resume-after-deploy path. The durable seat hash says the token is
   * good; the in-memory index does not know about it, because the process that
   * issued it is gone. Adopting rebuilds the live half of the record without
   * minting anything new, so the client's existing token keeps working and the
   * rotation in the caller immediately retires it.
   *
   * The name is bound to the seat's stored name and the match the store says the
   * seat belongs to — never to anything the client supplied. A resume message
   * carries no room id, so there is nothing in it that could be pointed somewhere
   * else.
   */
  adopt(
    token: string,
    name: string,
    playerId: string,
    matchId: string | null,
    lobbyId: string | null,
  ): SessionRecord {
    const existing = this.find(token);
    if (existing !== undefined) return existing;
    const rec: SessionRecord = {
      sessionId: newId('s', 12),
      playerId,
      name,
      role: 'player',
      lobbyId,
      matchId,
      token,
      tokenHash: sha(token),
      tokenIssuedAt: this.#now(),
    };
    this.#bySession.set(rec.sessionId, rec);
    this.#byHash.set(rec.tokenHash, rec.sessionId);
    return rec;
  }

  /** Mint a new token, drop the old one. Every grant and every resume calls this. */
  rotate(rec: SessionRecord): string {
    if (rec.tokenHash !== '') this.#byHash.delete(rec.tokenHash);
    const token = newToken();
    rec.token = token;
    rec.tokenHash = sha(token);
    rec.tokenIssuedAt = this.#now();
    this.#byHash.set(rec.tokenHash, rec.sessionId);
    return token;
  }

  /**
   * Reclaim a session from a resume token.
   *
   * The token is verified against the room's *stored* hash when the session is
   * seated at a table, in constant time — a match id and a seat id are both in the
   * public lobby snapshot, so an attacker already knows the candidate set and only
   * needs the timing to break one hash. When the session is a pre-game lobby seat
   * there is no durable record, and the in-memory index is the authority.
   *
   * Rotation happens on success only. A failed attempt must not invalidate a
   * legitimate player's token, or anyone could lock a table out by guessing.
   */
  find(token: string): SessionRecord | undefined {
    const id = this.#byHash.get(sha(token));
    return id === undefined ? undefined : this.#bySession.get(id);
  }

  toWire(rec: SessionRecord): Session {
    return {
      sessionId: rec.sessionId,
      resumeToken: rec.token,
      playerId: rec.playerId,
      matchId: rec.matchId,
      lobbyId: rec.lobbyId,
      role: rec.role,
      name: rec.name,
    };
  }

  end(sessionId: string, reason: string): ServerMessage | null {
    const rec = this.#bySession.get(sessionId);
    if (rec === undefined) return null;
    if (rec.tokenHash !== '') this.#byHash.delete(rec.tokenHash);
    this.#bySession.delete(sessionId);
    return { t: 'session:ended', reason };
  }

  all(): readonly SessionRecord[] {
    return [...this.#bySession.values()];
  }
}
