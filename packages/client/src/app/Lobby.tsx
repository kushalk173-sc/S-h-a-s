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
import { connection, send } from './session.ts';
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
        // `lobby:spectate` is a distinct wire message from `lobby:join`: it
        // creates a spectator session, which no write door will ever accept. The
        // alternative — joining as a player and not playing — would take a seat
        // away from a real player.
        connection().send({ t: 'lobby:spectate', lobbyId });
      }}
    />
  );
}
