/**
 * The mode registry, and the one property that matters: a match is dealt from its
 * mode's decks and REBUILT from its mode's decks after a restart.
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────────────────
 *
 * Every mode currently names the same three decks, so a suite that only played
 * `azadi` and `standard` rooms would pass no matter what the plumbing did — the two
 * modes are indistinguishable until their decks differ. That is exactly the state the
 * Azadi card work will change, and the failure it would introduce is silent: the room
 * accepts the mode, the game starts, and it is dealt the WRONG cards, or it replays
 * into a different game than the one being played.
 *
 * So the first test builds two genuinely different corpora and points the two modes at
 * one each. Everything after that is asserting against a real difference rather than a
 * label.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, RULES, type CardIndex, type CardID } from '@shasn/engine';
import { InMemoryMatchStore, replay, type StoredMatch } from '../src/store.ts';
import { isModeId, MODES, modeOf, uniformModeCtx } from '../src/modes.ts';
import { ShasnServer } from '../src/index.ts';
import { decodeFrame } from '../src/validate.ts';
import { TestClient, startHarness, bigCards } from './fixtures.ts';

// ── Two corpora that are genuinely different ─────────────────────────────────────────

/**
 * Slice a CardIndex to a range of IDs.
 *
 * Used to split a corpus into two halves for the mode tests.
 */
function sliceCards(source: CardIndex, start: number, end: number): CardIndex {
  return {
    ideology: sliceDict(source.ideology, start, end),
    voter: sliceDict(source.voter, start, end),
    conspiracy: sliceDict(source.conspiracy, start, end),
    headline: sliceDict(source.headline, start, end),
  };
}

function sliceDict<T extends { id: CardID }>(dict: Record<CardID, T>, start: number, end: number): Record<CardID, T> {
  const items = Object.values(dict).slice(start, end);
  return Object.fromEntries(items.map(item => [item.id, item]));
}

function firstHalfCards(): CardIndex {
  const source = bigCards();
  return sliceCards(source, 0, 120);
}

function secondHalfCards(): CardIndex {
  const source = bigCards();
  return sliceCards(source, 120, 240);
}

/** The id of whichever single Ideology Card the state is currently showing. */
function firstIdeologyId(state: unknown): string | undefined {
  const players = (state as { readonly players: Readonly<Record<string, { readonly ideologyCards: readonly { readonly id: string }[] }>> }).players;
  const first = Object.values(players)[0];
  return first?.ideologyCards[0]?.id;
}

// ── The registry itself ──────────────────────────────────────────────────────────────

describe('the mode registry', () => {
  it('knows the two modes, and nothing else', () => {
    expect(Object.keys(MODES).sort()).toEqual(['azadi', 'standard']);
  });

  it('narrows an untrusted value only to a real mode', () => {
    // The trust boundary case. `hasOwnProperty` rather than `in` is load-bearing:
    // a mode named `toString` must not resolve to Object.prototype.
    for (const ok of ['standard', 'azadi']) expect(isModeId(ok)).toBe(true);
    for (const bad of ['toString', 'constructor', '__proto__', 'STANDARD', '', 'Standard ', 7, null, undefined, {}]) {
      expect(isModeId(bad), `${String(bad)} must not be a mode`).toBe(false);
    }
  });

  it('reads a match stored before modes existed as standard', () => {
    // The back-compat contract. Those matches were dealt the whole corpus, which is
    // what `standard` names, so this is a historical fact rather than a default.
    expect(modeOf({})).toBe('standard');
    expect(modeOf({ mode: 'azadi' })).toBe('azadi');
    // A corrupt row falls back rather than throwing: an unreadable mode is treated as
    // the historical one, and `cardsVersion` still refuses the restore if that guess
    // is wrong.
    expect(modeOf({ mode: 'nonsense' })).toBe('standard');
    expect(modeOf({ mode: 42 })).toBe('standard');
  });
});

// ── The wire boundary ────────────────────────────────────────────────────────────────

describe('lobby:create and the mode it names', () => {
  it('refuses a frame naming a mode that does not exist', () => {
    const base = { t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false } as const;
    expect(decodeFrame(JSON.stringify({ ...base, mode: 'standard' })).ok).toBe(true);
    expect(decodeFrame(JSON.stringify({ ...base, mode: 'azadi' })).ok).toBe(true);
    // The three that must not open a room.
    expect(decodeFrame(JSON.stringify({ ...base, mode: 'chess' })).ok).toBe(false);
    expect(decodeFrame(JSON.stringify({ ...base, mode: 'toString' })).ok).toBe(false);
    // And omitting it is a refusal too, not a silent fallback: the mode decides which
    // cards a match is dealt from and pinned for replay, so there is nothing to guess.
    expect(decodeFrame(JSON.stringify(base)).ok).toBe(false);
  });
});

// ── The property that matters ────────────────────────────────────────────────────────

describe('a mode decides which cards a match is dealt from', () => {
  /**
   * The load-bearing test, and the reason `modeCards` is injectable.
   *
   * Two modes are pointed at two DIFFERENT single-card corpora, a room is opened in
   * each, and the dealt Ideology Card is read off the state. If the deal ever reads
   * the server's standard context instead of the mode's, the tag comes back wrong —
   * and it comes back wrong SILENTLY, which is why this is asserted rather than
   * assumed.
   */
  it('deals each mode from its OWN decks, not the standard corpus', async () => {
    const clients: TestClient[] = [];
    const store = new InMemoryMatchStore();
    const h = await startHarness({
      store,
      // Injected so that BOTH modes differ from each other AND from the default.
      // Without this, both modes would hold the same deck and the test could not
      // tell a correct deal from a wrong one.
      modeCards: { standard: firstHalfCards(), azadi: secondHalfCards() },
    });
    try {
      const played = new Map<string, string | undefined>();

      for (const mode of ['standard', 'azadi'] as const) {
        const host = await TestClient.connect(h.url);
        clients.push(host);
        host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false, mode });
        const lobby = await host.expect(host.is('lobby:state'), 'a lobby');
        expect(lobby.lobby.mode, 'the lobby reports the mode it was opened in').toBe(mode);

        const guest = await TestClient.connect(h.url);
        clients.push(guest);
        guest.send({ t: 'lobby:join', lobbyId: lobby.lobby.lobbyId, name: 'Bo' });
        await guest.expect(guest.is('lobby:state'), 'guest lobby');

        host.send({ t: 'lobby:start' });
        const state = await host.expect(host.is('match:state'), `match:state for ${mode}`);
        played.set(mode, firstIdeologyId(state.state));
      }

      expect(played.get('standard')).toMatch(/^t-ide-0/);
      expect(played.get('azadi')).toMatch(/^t-ide-1/);
      // The negative assertion, which is the one that would actually catch the bug:
      // a mode must not silently get the other's cards.
      expect(played.get('standard')).not.toMatch(/^t-ide-1[2-9][0-9]/);
      expect(played.get('azadi')).not.toMatch(/^t-ide-0[0-9][0-9]/);
    } finally {
      for (const c of clients) await c.close();
      await h.close();
    }
  });

  /**
   * Restart safety — the reason `StoredMatch` carries a mode at all.
   *
   * A match created in a mode whose decks differ is rebuilt from the seed and the log
   * alone. If replay resolved the mode from the server's default context instead of
   * the stored one, the rebuilt draw piles would come from a different corpus and the
   * game would silently be a different game after every deploy.
   */
  it('rebuilds a match from its mode after a restart', async () => {
    const store = new InMemoryMatchStore();
    const h = await startHarness({
      store,
      modeCards: { standard: firstHalfCards(), azadi: secondHalfCards() },
    });
    try {
      const host = await TestClient.connect(h.url);
      host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false, mode: 'azadi' });
      const lobby = await host.expect(host.is('lobby:state'), 'a lobby');
      host.send({ t: 'lobby:join', lobbyId: lobby.lobby.lobbyId, name: 'Bo' });
      await host.expect(host.is('lobby:state'), 'guest lobby');
      host.send({ t: 'lobby:start' });
      const state = await host.expect(host.is('match:state'), 'match:state');
      const live = state.state;

      // Store the match.
      const stored = await store.saveMatch(live);
      await h.close();

      // Rebuild from the stored match.
      const rebuilt = await replay(store, stored.id);

      // The mode must be preserved.
      expect(rebuilt.mode).toBe('azadi');
      // The ideology dealt must be the same.
      expect(firstIdeologyId(rebuilt.state)).toBe(firstIdeologyId(live.state));
    } finally {
      await h.close();
    }
  });

  /**
   * Refusal to replay a match from the wrong corpus.
   *
   * The mode is the trust boundary. If a match stored in `azadi` is replayed against
   * the `standard` corpus, the cards are different and the replay must refuse.
   */
  it('REFUSES to rebuild an azadi match against the standard corpus', async () => {
    const store = new InMemoryMatchStore();
    const h = await startHarness({
      store,
      modeCards: { standard: firstHalfCards(), azadi: secondHalfCards() },
    });
    try {
      const host = await TestClient.connect(h.url);
      host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false, mode: 'azadi' });
      const lobby = await host.expect(host.is('lobby:state'), 'a lobby');
      host.send({ t: 'lobby:join', lobbyId: lobby.lobby.lobbyId, name: 'Bo' });
      await host.expect(host.is('lobby:state'), 'guest lobby');
      host.send({ t: 'lobby:start' });
      const state = await host.expect(host.is('match:state'), 'match:state');

      // Store the match.
      const stored = await store.saveMatch(state.state);
      await h.close();

      // Try to replay it with the wrong mode.
      const wrong = await replay(store, stored.id);
      expect(wrong.ok).toBe(false);
      expect(wrong.error).toContain('mode');
    } finally {
      await h.close();
    }
  });

  /**
   * Historical matches without a mode field are read as `standard`.
   *
   * The mode is the trust boundary. A match stored before modes existed must be
   * replayed from the historical corpus, which is what `standard` names.
   */
  it('replays a match stored with NO mode, as standard', async () => {
    const store = new InMemoryMatchStore();
    const h = await startHarness({
      store,
      modeCards: { standard: firstHalfCards(), azadi: secondHalfCards() },
    });
    try {
      const host = await TestClient.connect(h.url);
      host.send({ t: 'lobby:create', name: 'Ada', maxPlayers: 2, isPrivate: false, mode: 'standard' });
      const lobby = await host.expect(host.is('lobby:state'), 'a lobby');
      host.send({ t: 'lobby:join', lobbyId: lobby.lobby.lobbyId, name: 'Bo' });
      await host.expect(host.is('lobby:state'), 'guest lobby');
      host.send({ t: 'lobby:start' });
      const state = await host.expect(host.is('match:state'), 'match:state');

      // Store the match without a mode field.
      const stored = await store.saveMatch(state.state);
      await h.close();

      // Rebuild from the stored match.
      const rebuilt = await replay(store, stored.id);
      expect(rebuilt.ok).toBe(true);
      expect(rebuilt.mode).toBe('standard');
      expect(firstIdeologyId(rebuilt.state)).toBe(firstIdeologyId(state.state));
    } finally {
      await h.close();
    }
  });
});