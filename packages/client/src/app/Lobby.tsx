/**
 * The lobby harness: form state and the real lobby calls.
 *
 * The one place a NAME is typed, and the one place a seat is taken. Everything
 * after this is the match, and the match has no notion of a name — the server
 * assigned it when the room was created or joined, and it comes back in
 * `PlayerState.name`.
 *
 * THE NAME IS LOCAL UNTIL A ROOM EXISTS, AND THAT IS THE ONLY REASON IT IS
 * LOCAL. Before `lobby:create` or `lobby:join` there is no server-side object
 * that could hold it, so keeping it in React state is not optimistic state — it
 * is unsent input. Once a room exists the server's `lobby:state` is the only
 * thing rendered, and this form is gone.
 */

import { useEffect, useState } from 'react';

import type { ClientStore, SeatCount } from '../net/index.ts';

import { LobbyScreen } from './Panels.tsx';
import { send } from './session.ts';
import { useApp } from './store.ts';

export type LobbyScreenHarnessProps = {
  readonly store: ClientStore;
};

export function LobbyScreenHarness({ store }: LobbyScreenHarnessProps) {
  const [name, setName] = useState('Player');
  const { lobby } = store;
  const link = useApp().link;

  // THE ROOM LIST IS ASKED FOR WHEN THE LINK IS LIVE, NOT ON MOUNT.
  //
  // This used to be a mount effect, which is a race: `App` calls `connect()` in
  // its own mount effect, so both fire in the same commit, and `WebSocket.send` on a
  // socket whose `readyState` is still CONNECTING throws the frame away. `Connection.send`
  // returns `false` rather than throwing, so nothing failed loudly — the second player
  // simply saw "No rooms are open" for a room that existed, until they pressed REFRESH.
  //
  // Keying on `link` fixes the race and gets the reconnect case for free: the list is
  // re-asked every time the socket comes back, so a lobby created while this player was
  // disconnected is there when they return.
  useEffect(() => {
    if (link === 'live') send((c) => c.listLobbies());
  }, [link]);

  // A player who has just refreshed mid-game wants their room, not the create form, and
  // the store's own phase tells us which: a `lobby:state` sets it, so the moment the
  // resume lands this form goes away on its own.
  useEffect(() => {
    if (lobby !== null) send((c) => c.listLobbies());
  }, [lobby?.lobbyId]);

  const lobbyId = lobby?.lobbyId ?? null;

  /**
   * THE HANDOFF FROM "WATCHING A ROOM" TO "WATCHING THE MATCH".
   *
   * `lobby:spectate` puts this connection in the room as a spectator, and the room's
   * own `lobby:state` carries the `matchId` once the table has started — for a room
   * that is ALREADY running, that is true on arrival, which is what makes the
   * room-list `WATCH` control a working spectator entry point today.
   *
   * `match:spectate` is the frame that actually attaches a connection to a live room
   * and starts delivering `match:state` to it (`#spectate` → `#attach`). Until this
   * ran, nothing in `packages/client/src` sent it: the feature was fully implemented
   * server-side and had no sender at all, so the spectator view could not be
   * constructed from the real client. One effect, keyed on the match id, is the whole
   * of it — and it cannot loop, because the frame's reply is a `match:state`, which
   * unmounts this harness.
   *
   * A PLAYER NEVER TAKES THIS BRANCH: the guard is the session role, so a seated
   * player whose room has started is left alone and resumes through
   * `session:resume` as before.
   */
  const spectateMatchId =
    store.session?.role === 'spectator' ? (lobby?.matchId ?? null) : null;
  useEffect(() => {
    if (spectateMatchId === null) return;
    send((c) => c.spectate(spectateMatchId));
  }, [spectateMatchId]);

  /**
   * Who "you" are, in a room.
   *
   * `store.you` is only populated by `match:state`, and a match has not started yet
   * — so in the lobby it is still the initial `{ role: 'spectator', playerId: null }`.
   * Using it here meant `isHost` was false for EVERYONE: no seat showed "(you)" and
   * the START button, which renders only for the host, never appeared for anyone. The
   * game could be created, joined and never started.
   *
   * `session.playerId` is granted on connect and is the same id, so the fallback is
   * the same fact from the message that actually carries it at this point in the
   * protocol. Once a match starts the first term wins and the behaviour is unchanged.
   */
  const you = store.you.playerId ?? store.session?.playerId ?? null;
  const isHost = lobby !== null && you !== null && lobby.hostId === you;
  const canStart = lobby !== null && lobby.seats.length >= 2;

  return (
    <LobbyScreen
      lobbies={store.lobbies}
      lobby={lobby}
      name={name}
      you={you}
      isHost={isHost}
      canStart={canStart}
      onNameChange={setName}
      onList={() => send((c) => c.listLobbies())}
      onCreate={(maxPlayers: SeatCount) =>
        send((c) => c.createLobby(name.trim() === '' ? 'Player' : name.trim(), maxPlayers, false))
      }
      onJoin={(id) => send((c) => c.joinLobby(id, name.trim() === '' ? 'Player' : name.trim()))}
      onReady={(ready) => send((c) => c.setReady(ready))}
      onStart={() => send((c) => c.startMatch())}
      onLeave={() => send((c) => c.leaveLobby())}
      onSpectate={() => {
        if (lobbyId === null) return;
        // RELEASES THE SEAT FIRST, then asks to watch. See
        // `Connection#giveUpSeatAndWatch`: `lobby:spectate` on its own replaces this
        // connection's session with a spectator one and never returns the seat, which
        // orphaned it in the lobby and hung the table the moment the host started.
        send((c) => c.giveUpSeatAndWatch(lobbyId));
      }}
      onWatchRoom={(id) => send((c) => c.watchRoom(id))}
      spectator={store.session?.role === 'spectator'}
    />
  );
}
