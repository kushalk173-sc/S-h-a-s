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

import type { ClientStore, Lobby, SeatCount } from '../net/index.ts';

import { AccountControl } from './AccountControl.tsx';
import { ErrorToast, LobbyScreen } from './Panels.tsx';
import { connection, send } from './session.ts';
import { useApp, type Link } from './store.ts';
import { clearError } from '../net/index.ts';

export type LobbyScreenHarnessProps = {
  readonly store: ClientStore;
};

/**
 * How often the open-rooms list re-asks the server. See the effect that uses it.
 * Exported so a test can drive the interval deterministically instead of waiting.
 */
export const ROOM_LIST_POLL_MS = 4000;

/**
 * Whether the open-rooms list should be re-asking the server on a timer.
 *
 * Extracted as a predicate so the two guards are testable without a socket —
 * `LobbyScreenHarness` cannot be rendered in jsdom with a live link, because
 * `session.send` reaches a real `WebSocket` and the secret gate keeps a fake
 * transport out of this package's tests. `lobbyRooms.test.tsx` asserts this table
 * and separately pins that the effect still calls it, so deleting the timer is a
 * red test rather than a silent regression to "press REFRESH".
 */
export function shouldPollRoomList(lobby: Lobby | null, link: Link): boolean {
  return lobby === null && link === 'live';
}

/** Where the last name typed is remembered, so a returning player does not retype it. */
const NAME_KEY = 'shasn:name';

function rememberedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The room id in this page's `?room=` invite link, if there is one. */
function invitedRoomId(): string | null {
  try {
    return new URL(window.location.href).searchParams.get('room');
  } catch {
    return null;
  }
}

export function LobbyScreenHarness({ store }: LobbyScreenHarnessProps) {
  // The name STARTS EMPTY (or remembered). It used to start as the literal
  // "Player", so typing a name appended to it and the first player became
  // "PlayerAlice" — and every unnamed room in the list was called "Player".
  const [name, setNameState] = useState(rememberedName);
  const setName = (next: string) => {
    setNameState(next);
    try {
      window.localStorage.setItem(NAME_KEY, next);
    } catch {
      /* storage blocked: the name simply is not remembered */
    }
  };
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

  /*
    * THE ROOM LIST NOW KEEPS ITSELF CURRENT, and this is the effect that fixes
    * "press REFRESH or the room is invisible".
    *
    * The list was asked for once per link and once per room, so a room created
    * while this player sat on the open-rooms screen simply did not exist for them
    * until they knew to press a button. That is correct-but-unforgiving, and a
    * headless run filed it under the things a human trips over: the second player
    * in any real session has to already know the lobby has a REFRESH control,
    * and no lobby screen since has said so.
    *
    * WHY AN INTERVAL AND NOT AN EVENT. There is no event to hang it on: this
    * client has no notification that a room was created, because it is not in one
    * and the server sends nothing. Polling is the only honest option at this
    * layer, and it is the same choice the transport already makes for `phase`.
    *
    * THE GUARDS ARE THE POINT, and each one earns its line:
    *
    *   - `lobby === null`. The list is only rendered on the open-rooms screen. A
    *     seated player's view shows seats, not rooms, so polling for them is
    *     traffic nobody asked for.
    *   - `link === 'live'`. `send` drops a frame on a socket that is not open
    *     (the race the effect above documents), so a timer that fires during a
    *     reconnect would silently do nothing — and would look like it worked.
    *
    * 4s is chosen against the thing being waited on: a person deciding whether to
    * create a room or join one. Nobody should press REFRESH to find out whether
    * the friend they were invited by has arrived, and 4s is well inside the
    * "did it change?" threshold a person will actually notice. It is a floor on
    * the wait, not a target: the list still updates the instant the server
    * answers, because `store.lobbies` is driven by the reply, not by the timer.
    */
  useEffect(() => {
    if (!shouldPollRoomList(lobby, link)) return undefined;
    const timer = setInterval(() => send((c) => c.listLobbies()), ROOM_LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [lobby, link]);

  // A player who has just refreshed mid-game wants their room, not the create form, and
  // the store's own phase tells us which: a `lobby:state` sets it, so the moment the
  // resume lands this form goes away on its own.
  useEffect(() => {
    if (lobby !== null) send((c) => c.listLobbies());
  }, [lobby?.lobbyId]);

  const lobbyId = lobby?.lobbyId ?? null;

  // A RESUME THE SERVER NO LONGER HONOURS IS NOT AN ERROR THE PLAYER CAN ACT ON.
  // It happens on every server restart (matches are in memory) and whenever a held
  // seat has expired, and it used to surface as `that resume token is not valid ·
  // RESUME_INVALID` on the landing screen. The token is dropped so it is not asked
  // again, and the player is told what actually happened, in their words.
  const [notice, setNotice] = useState<string | null>(null);
  const errorCode = store.error?.code ?? null;
  useEffect(() => {
    if (errorCode !== 'RESUME_INVALID') return;
    setNotice('Your previous game is no longer running, so you are back in the lobby.');
    connection().forget();
  }, [errorCode, store.error?.at]);

  // THE ADDRESS BAR IS THE INVITE. While seated in a room the page's own URL carries
  // `?room=`, so "share the link" means the link in the address bar as well as the
  // one on screen; leaving the room takes it back off.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (lobbyId !== null) url.searchParams.set('room', lobbyId);
      else if (store.lobby === null && url.searchParams.get('room') !== null && invitedGone) {
        url.searchParams.delete('room');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* history API unavailable: the on-screen link still works */
    }
  });

  const inviteId = invitedRoomId();
  const invited =
    lobby === null && inviteId !== null
      ? (store.lobbies.find((l) => l.lobbyId === inviteId) ?? null)
      : null;
  // An invite to a room the server no longer lists is dropped from the URL once the
  // list has actually arrived, so a stale link does not linger in the address bar.
  const invitedGone = inviteId !== null && store.lobbies.length > 0 && invited === null;

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
    <>
    <LobbyScreen
      account={<AccountControl />}
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
      invited={invited}
    />
    {/* THE SERVER'S REFUSALS, SAID. A `lobby:create` the server rejected used to
        leave the screen exactly as it was — the error reached the store and no
        lobby component rendered it, so CREATE ROOM looked like a dead button. */}
    {notice !== null ? (
      <ErrorToast code="" message={notice} onDismiss={() => setNotice(null)} />
    ) : store.error !== null && store.error.code !== 'RESUME_INVALID' ? (
      <ErrorToast code={store.error.code} message={store.error.message} onDismiss={clearError} />
    ) : null}
    </>
  );
}
