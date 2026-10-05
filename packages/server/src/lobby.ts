/**
 * Lobbies and the room registry.
 *
 * A lobby is a pre-game waiting room with 2–5 seats. It becomes a match when the
 * host starts it, and the room that comes out is seeded once and never reseeded.
 *
 * Two things are deliberately cheap here and the cost is recorded rather than paid
 * later:
 *
 *  - Seat reclaim is a 24-hour grace window. That means an abandoned seat can block
 *    a table for a day. The alternative — a short window — punishes exactly the
 *    four-hour session this feature exists for. A lobby vote-to-kick is the fix
 *    and is about an hour of work.
 *
 *  - Nothing here is persisted. A lobby is minutes long; a *match* is hours, and
 *    the match is what goes to the store. Persisting lobbies would be storing
 *    something whose loss costs nothing.
 */

import { randomBytes } from 'node:crypto';

import { PLAYER_COLOURS, setup, type Ctx, type PlayerID } from '@shasn/engine';

import { newId, newPlayerId, Room, type Seat } from './room.ts';
import type { Lobby, LobbySeat, LobbySummary, SeatCount } from './protocol.ts';
import { decksOf, type MatchStore } from './store.ts';
import { ctxsForModes, MODES, type ModeCards, type ModeId } from './modes.ts';

export type LobbyErrorCode = 'LOBBY_FULL' | 'LOBBY_CLOSED' | 'NOT_IN_LOBBY' | 'NOT_HOST' | 'SEAT_TAKEN';

export class LobbyError extends Error {
  constructor(
    readonly code: LobbyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LobbyError';
  }
}

export type LobbyMember = {
  readonly playerId: PlayerID;
  readonly name: string;
  connected: boolean;
  ready: boolean;
  /** Present once the lobby has been dealt into a match. */
  matchId: string | null;
};

export type LobbyRecord = {
  readonly lobbyId: string;
  name: string;
  readonly isPrivate: boolean;
  /**
   * Mutable, and deliberately NOT `readonly`: `leaveLobby` hands the room to the
   * next-longest-present member when the host leaves. The `readonly` here was a
   * latent bug — an assignment to a readonly field that tsc had not been reached to
   * report while other errors were outstanding.
   */
  hostId: PlayerID;
  readonly maxPlayers: SeatCount;
  /**
   * The mode this room was opened in, decided once by the host at creation.
   *
   * It lives on the record rather than being carried into `startMatch` as a
   * parameter because it is part of what the room IS: anyone joining an existing
   * room has to be able to see which mode they are joining, and the answer has to
   * still be there when the host starts the game. Read it at deal time and the
   * deck list is derived from exactly one place — `ctxForMode` in `modes.ts`.
   */
  readonly mode: ModeId;
  readonly members: Map<PlayerID, LobbyMember>;
  readonly createdAt: number;
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

/**
 * The one place a match seed is minted.
 *
 * `crypto.randomBytes`, not `Math.random`, and a positive 31-bit int so the value
 * survives a JSON round trip into a Postgres column without a sign surprise. The
 * seed is the single number the whole game's randomness derives from, so its
 * quality is load-bearing; it just must not be guessable, which is why it is not
 * a timestamp either.
 */
export function newSeed(): number {
  return randomBytes(4).readUInt32BE(0) & 0x7fffffff;
}

export class LobbyHub {
  readonly #lobbies = new Map<string, LobbyRecord>();
  readonly #rooms = new Map<string, Room>();
  readonly #store: MatchStore;
  readonly #ctx: Ctx;
  /**
   * One context per mode, resolved once at construction.
   *
   * `#ctx` remains the standard context and is still used for everything that is not
   * mode-specific; `#modeCtx` is what the DEAL reads, so that a room opened in a mode
   * whose decks differ is actually dealt that mode's cards. Both are derived from the
   * same `rules` object, so there is no second source of rule truth.
   */
  readonly #modeCtx: Readonly<Record<ModeId, Ctx>>;
  readonly #now: () => number;

  constructor(
    ctx: Ctx,
    store: MatchStore,
    now: () => number = () => Date.now(),
    modeCards: ModeCards = { standard: ctx.cards, azadi: ctx.cards },
  ) {
    this.#ctx = ctx;
    this.#modeCtx = ctxsForModes(ctx.rules, modeCards);
    this.#store = store;
    this.#now = now;
  }

  get rooms(): ReadonlyMap<string, Room> {
    return this.#rooms;
  }

  get store(): MatchStore {
    return this.#store;
  }

  getLobby(lobbyId: string): LobbyRecord | undefined {
    return this.#lobbies.get(lobbyId);
  }

  allLobbies(): readonly LobbyRecord[] {
    return [...this.#lobbies.values()];
  }

  // ─────────────────────────── lobbies ───────────────────────────

  createLobby(opts: {
    name: string;
    maxPlayers: SeatCount;
    isPrivate: boolean;
    mode: ModeId;
    now: number;
  }): { lobby: LobbyRecord; playerId: PlayerID } {
    const lobbyId = newId('l', 8);
    const playerId = newPlayerId();
    const lobby: LobbyRecord = {
      lobbyId,
      name: opts.name,
      isPrivate: opts.isPrivate,
      hostId: playerId,
      maxPlayers: opts.maxPlayers,
      mode: opts.mode,
      members: new Map([
        [
          playerId,
          { playerId, name: opts.name, connected: true, ready: false, matchId: null } satisfies LobbyMember,
        ],
      ]),
      createdAt: opts.now,
    };
    this.#lobbies.set(lobbyId, lobby);
    return { lobby, playerId };
  }

  /**
   * Join a lobby as a *new* player, or reclaim an existing seat.
   *
   * Reclaiming is what makes a refresh survivable in the pre-game phase too: the
   * caller presents a resume token, and if it verifies against the lobby's record
   * the original `playerId` comes back rather than a new seat being minted.
   */
  joinLobby(opts: {
    lobbyId: string;
    name: string;
    now: number;
  }): { lobby: LobbyRecord; playerId: PlayerID } {
    const lobby = this.#lobbies.get(opts.lobbyId);
    if (lobby === undefined) throw new LobbyError('LOBBY_CLOSED', 'that room no longer exists');
    if (lobby.members.size >= lobby.maxPlayers) {
      throw new LobbyError('LOBBY_FULL', 'that room is full');
    }
    const playerId = newPlayerId();
    lobby.members.set(playerId, {
      playerId,
      name: opts.name,
      connected: true,
      ready: false,
      matchId: null,
    });
    return { lobby, playerId };
  }

  leaveLobby(lobbyId: string, playerId: PlayerID): void {
    const lobby = this.#lobbies.get(lobbyId);
    if (lobby === undefined) return;
    lobby.members.delete(playerId);
    if (lobby.hostId === playerId) {
      // Host leaves: the longest-present remaining member inherits, or the room
      // closes if nobody is left. Handing the room to nobody would strand it.
      const next = [...lobby.members.keys()].sort(
        (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      )[0];
      if (next === undefined) this.#lobbies.delete(lobbyId);
      else lobby.hostId = next;
    }
  }

  setReady(lobbyId: string, playerId: PlayerID, ready: boolean): void {
    const lobby = this.#lobbies.get(lobbyId);
    const member = lobby?.members.get(playerId);
    if (lobby === undefined || member === undefined) {
      throw new LobbyError('NOT_IN_LOBBY', 'you are not in that room');
    }
    member.ready = ready;
  }

  setConnected(lobbyId: string, playerId: PlayerID, connected: boolean): void {
    const member = this.#lobbies.get(lobbyId)?.members.get(playerId);
    if (member !== undefined) member.connected = connected;
  }

  listLobbies(viewerId: PlayerID | null): readonly LobbySummary[] {
    const out: LobbySummary[] = [];
    for (const l of this.#lobbies.values()) {
      if (l.isPrivate && !l.members.has(viewerId ?? '')) continue;
      out.push({
        lobbyId: l.lobbyId,
        name: l.name,
        isPrivate: l.isPrivate,
        seated: l.members.size,
        maxPlayers: l.maxPlayers,
        inProgress: l.members.size > 0 && [...l.members.values()].some((m) => m.matchId !== null),
        mode: l.mode,
        modeLabel: MODES[l.mode].label,
      });
    }
    return out;
  }

  lobbyView(lobby: LobbyRecord, viewerId: PlayerID | null): Lobby {
    const seats: LobbySeat[] = [...lobby.members.values()].map((m) => ({
      seatId: m.playerId,
      playerId: m.playerId,
      name: m.name,
      ready: m.ready,
      connected: m.connected,
      you: m.playerId === viewerId,
    }));
    return {
      lobbyId: lobby.lobbyId,
      name: lobby.name,
      isPrivate: lobby.isPrivate,
      hostId: lobby.hostId,
      maxPlayers: lobby.maxPlayers,
      mode: lobby.mode,
      modeLabel: MODES[lobby.mode].label,
      seats,
      matchId: [...lobby.members.values()].find((m) => m.matchId !== null)?.matchId ?? null,
    };
  }

  // ─────────────────────────── rooms ───────────────────────────

  /**
   * Deal a lobby into a live match.
   *
   * The seed is minted exactly once, here, and handed to `setup`. Everything after
   * this is a replay of `(seed, rules, cards, actionLog)`, which is why a restart
   * mid-game is a non-event rather than a lost table.
   */
  async startMatch(lobbyId: string, now: number): Promise<Room> {
    const lobby = this.#lobbies.get(lobbyId);
    if (lobby === undefined) throw new LobbyError('LOBBY_CLOSED', 'that room no longer exists');
    if (lobby.members.size < MIN_PLAYERS) {
      throw new LobbyError('LOBBY_CLOSED', 'at least two players are needed');
    }

    const seatIds = [...lobby.members.keys()];
    const names: Record<PlayerID, string> = {};
    const seats: Seat[] = seatIds.map((id, i) => {
      const member = lobby.members.get(id);
      if (member === undefined) throw new LobbyError('LOBBY_CLOSED', 'that seat no longer exists');
      names[id] = member.name;
      return {
        playerId: id,
        name: member.name,
        colour: PLAYER_COLOURS[i] ?? '#888888',
        // A placeholder until the server hands the socket its real token in the
        // same turn that seats it. There is a brief window in which a seat holds a
        // hash of a token nobody was ever told, and it verifies nothing.
        resumeHash: '',
        connected: member.connected,
        lastSeen: now,
        ready: true,
      };
    });

    const seed = newSeed();
    // The mode's OWN context, not `#ctx`. This is the only place the deal reads a
    // card index, which is what makes "which cards is this table playing with?" have
    // exactly one answer — and what lets `store.replay` reproduce the same draw by
    // resolving the same mode out of the same map.
    const ctx = this.#modeCtx[lobby.mode];
    const state = setup({
      players: seatIds,
      names,
      cards: ctx.cards,
      seed,
      ...decksOf(ctx.cards),
      // p7: player n receives n resources of their choice. The choice is the
      // player's, so it is not invented here — seats start on zero and earn.
    });

    const matchId = newId('m', 9);
    const room = new Room({
      matchId,
      ctx,
      store: this.#store,
      seed,
      state,
      seats,
      now,
    });

    // The store is written BEFORE the room is announced. Order matters: a room
    // that exists in memory but not on disk is a match that a deploy silently
    // deletes, which is the entire failure this design exists to prevent. Every
    // subsequent action appends to the log this call creates.
    await this.#store.create(
      {
        matchId,
        seed,
        // The mode's cards, for the same reason the deal and the Room use them: this
        // is what `cardsVersion` hashes. Recording the standard corpus here while
        // dealing a mode's cards would stamp the match with a hash of cards nobody
        // is playing, and replay would then refuse — or worse, accept, under the wrong
        // corpus.
        cards: ctx.cards,
        mode: lobby.mode,
        rules: this.#ctx.rules,
        players: seats.map((s) => ({
          id: s.playerId,
          name: s.name,
          colour: s.colour,
          resumeHash: s.resumeHash,
        })),
        now,
      },
      state,
    );

    this.#rooms.set(matchId, room);
    for (const id of seatIds) {
      const m = lobby.members.get(id);
      if (m !== undefined) m.matchId = matchId;
    }
    return room;
  }

  /**
   * Rehydrate every stored match at boot.
   *
   * A `rulesVersion` or `cardsVersion` mismatch throws out of `replay` and is
   * caught here: the match is left unstarted and logged, rather than being
   * "restored" under rules that differ from the ones the players are mid-way
   * through. Diverging silently is strictly worse than not starting.
   */
  async restoreAll(): Promise<{ restored: number; skipped: string[] }> {
    const ids = await this.#store.list();
    let restored = 0;
    const skipped: string[] = [];
    for (const id of ids) {
      const stored = await this.#store.get(id);
      if (stored === null) continue;
      try {
        const room = await Room.restore({ matchId: id, ctx: this.#ctx, modeCtx: this.#modeCtx, store: this.#store, stored });
        this.#rooms.set(id, room);
        restored += 1;
      } catch (err) {
        // The message names the match and the two hashes. It never names a card.
        skipped.push(`${id}: ${(err as Error).message}`);
      }
    }
    return { restored, skipped };
  }

  removeRoom(matchId: string): void {
    this.#rooms.delete(matchId);
  }
}

export { isSeatCount } from './validate.ts';
