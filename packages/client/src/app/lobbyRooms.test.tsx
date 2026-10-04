/**
 * THE FOUR THINGS A PLAYER TRIPS OVER, and the gate that keeps them fixed.
 *
 * A headless run played 270 turns and, besides the two dead dialogs, recorded a
 * list of things that were not bugs so much as a product that makes the player do
 * the work. All four are client-owned and all four are here:
 *
 *   1. **The room list never refreshes itself.** A room created after you loaded
 *      was invisible until you pressed REFRESH — and nothing on the screen said
 *      that was how it worked. `LobbyScreenHarness`'s interval is the fix.
 *   2. **Rooms were keyed only by host name.** Two players who both typed
 *      "Player" got two identical rows, so pressing JOIN was a guess: the harness
 *      joined the wrong room twice before it gave its host a unique name. And a
 *      room's JOIN goes grey when that room is full or running, with no reason on
 *      it, which reads as "I am looking at the wrong room".
 *   3. **The Headline sheet rendered a developer note to the player** — "The
 *      card's printed text is not part of the public state this client is given" —
 *      mid-turn, while they owed a decision. A true sentence about `broadcast.ts`
 *      addressed to nobody.
 *   4. **The lobby said "one hundred and twenty-nine voters".** 129 is the AREA
 *      count; a fresh board has 129 printed wells and no voters in them.
 *
 * 4 is pinned in `staleWording.test.tsx`, which already owned the pitch line.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
// TYPE-ONLY: the secret gate scans this directory whole.
import type { ClientState, PlayerID } from '@shasn/engine';

import { ROOM_LIST_POLL_MS, shouldPollRoomList } from './Lobby.tsx';
import { HeadlineDialog, LobbyScreen } from './Panels.tsx';
// The lobby summary is a WIRE type this package owns (`net/protocol.ts`), not an
// engine one — the engine has no notion of a lobby.
import type { LobbySummary } from '../net/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────── the lobby, rendered ───────────────────────────

/** Realistic ids: the server mints `l_` + 8 random base64url bytes (`room.ts:newId`). */
const ROOM_A: LobbySummary = {
  lobbyId: 'l_aB3xY9zQ1',
  name: 'Player',
  isPrivate: false,
  seated: 1,
  maxPlayers: 3,
  inProgress: false,
};
const ROOM_B: LobbySummary = {
  lobbyId: 'l_Qk7mR2wXc',
  name: 'Player',
  isPrivate: false,
  seated: 3,
  maxPlayers: 3,
  inProgress: false,
};

function lobby(
  lobbies: readonly LobbySummary[],
  name = 'Ria',
): ReturnType<typeof render> {
  return render(
    <LobbyScreen
      lobbies={lobbies}
      lobby={null}
      name={name}
      you={null}
      isHost={false}
      canStart={false}
      onNameChange={() => undefined}
      onList={() => undefined}
      onCreate={() => undefined}
      onJoin={() => undefined}
      onReady={() => undefined}
      onStart={() => undefined}
      onLeave={() => undefined}
      onSpectate={() => undefined}
      onWatchRoom={() => undefined}
      spectator={false}
    />,
  );
}

describe('two rooms with the same host name are two rooms', () => {
  it('each row carries its own key, so the rows are not interchangeable', () => {
    const { container } = lobby([ROOM_A, ROOM_B]);
    const keys = [...container.querySelectorAll('[data-testid=room-key]')].map((k) => k.textContent);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(ROOM_A.lobbyId);
    expect(keys[1]).toBe(ROOM_B.lobbyId);
    // And the row exposes the id the buttons act on, so a driver — or a player
    // reading the DOM — can name the room it is about to press.
    const rows = [...container.querySelectorAll('[data-testid=room-row]')];
    expect(rows.map((r) => r.getAttribute('data-lobby-id'))).toEqual([
      ROOM_A.lobbyId,
      ROOM_B.lobbyId,
    ]);
    const joins = [...container.querySelectorAll('[data-testid=join-room]')];
    expect(joins.map((j) => j.getAttribute('data-lobby-id'))).toEqual([
      ROOM_A.lobbyId,
      ROOM_B.lobbyId,
    ]);
  });

  it('every row’s JOIN and WATCH name the room they act on', () => {
    // "JOIN" repeated down a list of identical rows is an ambiguous label
    // (WCAG 2.1 SC 2.4.6), and it is the label a player reads to decide.
    const { container } = lobby([ROOM_A, ROOM_B]);
    const joins = [...container.querySelectorAll('[data-testid=join-room]')];
    const labels = joins.map((j) => j.getAttribute('aria-label') ?? '');
    expect(labels[0]).toContain(ROOM_A.lobbyId);
    expect(labels[1]).toContain(ROOM_B.lobbyId);
    expect(labels[0]).not.toBe(labels[1]);
    const watches = [...container.querySelectorAll('[data-testid=watch-room]')];
    expect(watches[0]?.getAttribute('aria-label')).toContain(ROOM_A.lobbyId);
    expect(watches[1]?.getAttribute('aria-label')).toContain(ROOM_B.lobbyId);
  });

  it('a greyed JOIN says WHY, so "disabled" is not read as "wrong room"', () => {
    const { container } = lobby([ROOM_A, ROOM_B]);
    const joins = [...container.querySelectorAll('[data-testid=join-room]')];
    // The full room's JOIN is disabled…
    expect((joins[1] as HTMLElement).hasAttribute('disabled')).toBe(true);
    expect(joins[1]?.getAttribute('title')).toBe('That room is full — WATCH it instead.');
    // …and the joinable one names no reason, because it has none.
    expect((joins[0] as HTMLElement).hasAttribute('disabled')).toBe(false);
    expect(joins[0]?.getAttribute('title')).toBeNull();
  });

  it('a running room and an unnamed player each get their own reason', () => {
    const running: LobbySummary = { ...ROOM_A, inProgress: true };
    expect(
      lobby([running]).container.querySelector('[data-testid=join-room]')?.getAttribute('title'),
    ).toBe('That match has already started — WATCH it instead.');
    expect(
      lobby([ROOM_A], '   ').container.querySelector('[data-testid=join-room]')?.getAttribute('title'),
    ).toBe('Type a name before joining a room.');
  });

  it('the room count is not the only thing on the row any more', () => {
    // The row used to read `1/3` and nothing else, so two "Player" rooms were
    // literally the same eleven characters. Both rows now differ.
    const { container } = lobby([ROOM_A, ROOM_B]);
    const metas = [...container.querySelectorAll('[data-testid=room-row] .seat__meta')].map(
      (m) => m.textContent ?? '',
    );
    expect(metas[0]).toContain('1/3');
    expect(metas[1]).toContain('3/3');
    expect(metas[0], 'the two rows are still identical').not.toBe(metas[1]);
  });
});

describe('the open-rooms list keeps itself up to date', () => {
  it('polls only when the list is on screen and the socket is open', () => {
    // The truth table, extracted as a predicate because the interval itself needs
    // a live `WebSocket`, which jsdom cannot provide and the secret gate will not
    // let this package fake. Each guard is a separate claim about not asking for
    // traffic nobody wants:
    expect(shouldPollRoomList(null, 'live'), 'the open-rooms screen, socket up').toBe(true);
    expect(shouldPollRoomList(null, 'connecting'), 'a frame sent while CONNECTING is dropped').toBe(false);
    expect(shouldPollRoomList(null, 'reconnecting')).toBe(false);
    expect(shouldPollRoomList(null, 'lost')).toBe(false);
    // A seated player's screen shows seats, not rooms.
    expect(shouldPollRoomList({ lobbyId: 'x' } as never, 'live')).toBe(false);
  });

  it('and the interval is still wired to it, with a period a person will not notice', () => {
    // Deleting the timer is the regression this pins: without it the list is
    // correct-but-unforgiving again, and nothing else in the package would fail.
    const src = readFileSync(resolve(HERE, 'Lobby.tsx'), 'utf8');
    expect(src, 'the polling effect was removed').toContain('shouldPollRoomList(lobby, link)');
    expect(src).toContain('setInterval(() => send((c) => c.listLobbies()), ROOM_LIST_POLL_MS)');
    expect(src, 'the timer must be cleared on unmount').toContain('clearInterval(timer)');
    // And the period is a real one: a poll slower than a person's patience is the
    // same defect as no poll, and a poll faster than the server answers is a
    // self-inflicted rate limit.
    expect(ROOM_LIST_POLL_MS).toBeGreaterThanOrEqual(2000);
    expect(ROOM_LIST_POLL_MS).toBeLessThanOrEqual(10000);
  });

  it('REFRESH still works, and the screen now says the list is automatic', () => {
    const { container } = lobby([ROOM_A]);
    expect(container.querySelector('[data-testid=refresh-rooms]')).not.toBeNull();
    expect(container.textContent).toContain('The list keeps itself up to date');
  });
});

describe('the Headline sheet speaks to the player', () => {
  const state = (): ClientState =>
    ({
      phase: 'headlines',
      activeHeadline: 'hl-001',
      headlineQueue: [{ areaId: 'north-01' }, { areaId: 'north-02' }],
      activePlayer: 'p1',
      players: { p1: { id: 'p1', name: 'RIA' } },
    }) as unknown as ClientState;

  it('renders no developer note about the wire view', () => {
    const { container } = render(
      <HeadlineDialog state={state()} you={'p1' as PlayerID} onAcknowledge={() => undefined} />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    // The exact sentence the harness photographed mid-turn.
    expect(text).not.toMatch(/public state this client is given/i);
    expect(text).not.toMatch(/wire view/i);
    // …and nothing of that shape either: no sentence about what the client was or
    // was not given reaches the player.
    expect(text).not.toMatch(/this client is given/i);
  });

  it('still says the one thing a player can act on', () => {
    const { container } = render(
      <HeadlineDialog state={state()} you={'p1' as PlayerID} onAcknowledge={() => undefined} />,
    );
    const text = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Volatile Area');
    expect(text).toContain('may ask you for a decision');
    expect(container.querySelector('[data-testid=ack-headline]')).not.toBeNull();
  });
});