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

export type LobbyScreenHarnessProps = {
  readonly store: ClientStore;
};

export function LobbyScreenHarness({ store }: LobbyScreenHarnessProps) {
  const [name, setName] = useState('Player');
  const { lobby } = store;

  // On a cold load the room list is empty until someone asks for it, and a
  // player who has just refreshed mid-game does not want the create-room form:
  // they want to see their room. The store's phase tells us which.
  useEffect(() => {
    send((c) => c.listLobbies());
  }, []);

  const lobbyId = lobby?.lobbyId ?? null;
  const you = store.you.playerId;
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
