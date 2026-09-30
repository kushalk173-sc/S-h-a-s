/**
 * The application root.
 *
 * ONE `useSyncExternalStore` over `net/store.ts`, one effect that opens the
 * connection, and a switch on the phase. That is the whole of it, and the
 * shallowness is the point: every screen is a STATE of one shell (§5), so the
 * shell is always mounted and the switch only decides what is IN it.
 *
 * WHAT IS DECIDED HERE, AND WHY IT CANNOT BE DECIDED ANYWHERE ELSE:
 *
 *   `lobby`  — the socket is up and a room exists but no match has started.
 *   `match`  — a `match:state` has arrived. Note the store's own rule: that
 *              message is what sets the phase, so a reconnect that has not yet
 *              been answered by the server is NOT in `match`, and the reconnect
 *              screen shows. That is deliberate: a client that optimistically
 *              assumed it was still seated would render a board it has not been
 *              told about, and every number on it would be a guess.
 *
 * SO THE ORDER IS: reconnect screen while the link is down OR the match is not
 * confirmed; lobby while in a room; scoreboard once the game is finished;
 * the game shell otherwise.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { GameScreen } from './GameScreen.tsx';
import { LobbyScreenHarness } from './Lobby.tsx';
import { ReconnectScreen } from './Panels.tsx';
import { connection, netState, requestSync, subscribeNetStore } from './session.ts';
import { useApp } from './store.ts';

import './app.css';

export function App() {
  const store = useSyncExternalStore(subscribeNetStore, netState, netState);
  const app = useApp();

  useEffect(() => {
    // Idempotent. `Connection.connect` sets a flag and opens; calling it twice
    // cannot open two sockets, and React 18 StrictMode mounts effects twice in
    // development, so this must be safe to run more than once.
    connection().connect();
  }, []);

  // While the link is down and we believe we have a seat, the shell must not
  // render a board the server has not confirmed. `net/store.ts` drops the state
  // on `session:ended`, and a `lost` link is the other half of the same
  // condition, so the reconnect screen covers both.
  const seated = store.matchId !== null;
  const linkDown = app.link === 'lost';

  if ((linkDown || app.link === 'connecting') && seated) {
    return (
      <ReconnectScreen
        link={app.link}
        attempts={app.attempts}
        retryingMs={app.retryingMs}
        onRetry={() => {
          connection().connect();
          window.setTimeout(requestSync, 250);
        }}
        onLeave={() => {
          connection().forget();
          window.location.reload();
        }}
        name={nameOf(store.state, store.you.playerId)}
        phase={store.state?.phase ?? 'unknown'}
      />
    );
  }

  if (store.state === null) {
    return <LobbyScreenHarness store={store} />;
  }

  return <GameScreen store={store} />;
}

function nameOf(
  state: { players: Readonly<Record<string, { name: string }>> } | null,
  you: string | null,
): string {
  if (state === null || you === null) return 'spectator';
  return state.players[you]?.name ?? '—';
}
