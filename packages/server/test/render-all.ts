/**
 * The exhaustive render.
 *
 * This is the layer that has real teeth, and the reason is worth stating plainly:
 * the layer-1 walk exercises `viewFor` and `blindPromptFor` — two functions. A new
 * `ServerMessage` could easily carry state without passing through either of them
 * (a `match:debug` that inlines a state, a `match:log` that forwards a log entry,
 * an error that embeds something), and the layer-1 test would stay green.
 *
 * So this file produces EVERY message the handler can produce for a state, and it
 * is written as an exhaustive `switch` on `ServerMessage['t']` with a `never`
 * check. Delete a case and the COMPILER fails. That is the intended friction, and
 * it is why adding a message type that carries state should require someone to
 * think about its projection rather than discover the problem in production.
 *
 * Test-only, and it never reads a server-only field: it composes the two sanctioned
 * projections and nothing else. If it ever needed a raw field, that would be a
 * finding.
 */

import { winners, type Ctx, type GameState, type PlayerID } from '@shasn/engine';

import { blindPromptFor, viewFor } from '../src/broadcast.ts';
import type { ServerMessage } from '../src/protocol.ts';

/** `Room.viewFor` returns this; the render mirrors the server's own send paths. */
function project(state: GameState, ctx: Ctx, viewer: PlayerID | null) {
  return {
    state: viewFor(state, viewer),
    blind: viewer === null ? null : blindPromptFor(state, ctx.cards, viewer),
  };
}

/**
 * Every message the server can emit for a state, for one viewer.
 *
 * `viewer` is `null` for a spectator. Note that `blind` is `null` in that case by
 * construction: `blindPromptFor` is only ever handed a real player id, and it
 * returns `null` for anyone who is not the player currently holding the card.
 */
export function renderAll(state: GameState, ctx: Ctx, viewer: PlayerID | null = null): readonly ServerMessage[] {
  const { state: view, blind } = project(state, ctx, viewer);
  const matchId = 'm_render';
  const viewId = 0;
  const out: ServerMessage[] = [];

  out.push({ t: 'pong', nonce: '' });
  out.push({
    t: 'session:granted',
    session: {
      sessionId: 's_render',
      // A placeholder, never a real token. The shape is what is under test.
      resumeToken: '',
      playerId: viewer ?? '',
      matchId,
      lobbyId: null,
      role: viewer === null ? 'spectator' : 'player',
      name: 'Render',
    },
  });
  out.push({ t: 'session:ended', reason: 'render' });
  out.push({ t: 'lobby:list', lobbies: [] });
  out.push({
    t: 'lobby:state',
    lobby: {
      lobbyId: 'l_render',
      name: 'Render',
      isPrivate: false,
      hostId: state.turnOrder[0] ?? '',
      maxPlayers: 5,
      seats: state.turnOrder.map((id) => ({
        seatId: id,
        playerId: id,
        name: id,
        ready: true,
        connected: true,
        you: id === viewer,
      })),
      matchId,
    },
  });
  out.push({
    t: 'match:state',
    matchId,
    viewId,
    state: view,
    blind,
    you: { role: viewer === null ? 'spectator' : 'player', playerId: viewer },
  });
  out.push({ t: 'match:events', matchId, viewId, events: [] });
  out.push({ t: 'match:log', matchId, entries: view.log });
  out.push({ t: 'match:over', matchId, winners: state.finished ? winners(state) : [] });
  out.push({ t: 'error', code: 'ILLEGAL_ACTION', message: 'render' });

  return out;
}

/**
 * EXHAUSTIVENESS. If a message type is added to `ServerMessage` and not handled
 * here, this function stops compiling.
 *
 * `renderAll` above is the production-shaped output; this is the tripwire that
 * keeps it exhaustive. It is never called at runtime — it exists to be checked.
 */
export function assertRenderAllExhaustive(_msg: ServerMessage): never {
  switch (_msg.t) {
    case 'pong':
    case 'session:granted':
    case 'session:ended':
    case 'lobby:list':
    case 'lobby:state':
    case 'match:state':
    case 'match:events':
    case 'match:log':
    case 'match:over':
    case 'error':
      throw new Error('add this message type to renderAll — it must be walked by the leak test');
    default: {
      const never: never = _msg;
      return never;
    }
  }
}
