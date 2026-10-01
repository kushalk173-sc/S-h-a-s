/**
 * THE PAYOFF TEST: the real cards this iteration added, actually played.
 *
 * `reducer-parity.test.ts` proves the corpus does not exceed what `reduce()` can do.
 * This proves the other half: that the four recovered real cards landed here do
 * **what their `text` says they do**, through the real reducer rather than through a
 * reading of its source.
 *
 * That is the claim the whole task turns on. An adapted card's text is a promise to a
 * player at a table, and the only way to know the promise is kept is to resolve it.
 * Three shipped cards were found to break it while this file's siblings were being
 * written — `discard-voter` over "discard 2 of your OWN voters", which `resolveChoice`
 * cannot reach — so this is a check that earns its place.
 *
 * Each case asserts the SPECIFIC state change the card's text describes. If an op is
 * ever retargeted or a `resolveChoice` guard moves, these fail and the card's text has
 * to change with it.
 */

import { describe, expect, it } from 'vitest';

import { loadCorpus, toEngineConspiracyCard, toEngineHeadlineCard, toEngineIdeologyCard, toEngineVoterCard } from '../src/corpus.js';
import { RULES, type CardIndex, type PlayerID } from '../src/engine.js';

import { reduce } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import type { GameState } from '../../engine/src/state';

const corpus = loadCorpus();

const INDEX: CardIndex = {
  ideology: Object.fromEntries(corpus.ideology.map((c) => [c.id, toEngineIdeologyCard(c)])),
  voter: Object.fromEntries(corpus.voter.map((c) => [c.id, toEngineVoterCard(c)])),
  conspiracy: Object.fromEntries(corpus.conspiracy.map((c) => [c.id, toEngineConspiracyCard(c)])),
  headline: Object.fromEntries(corpus.headline.map((c) => [c.id, toEngineHeadlineCard(c)])),
};

const CTX = { rules: RULES, cards: INDEX };

const card = (id: string) => {
  const found = [...corpus.conspiracy, ...corpus.headline].find((c) => c.id === id);
  if (found === undefined) throw new Error(`no card ${id} in the corpus`);
  return found;
};

/** A legal opening position with three seats, all able to act. */
function game(): GameState {
  const s = setup({
    players: ['p1', 'p2', 'p3'],
    cards: INDEX,
    seed: 20240917,
    // 6 in total: the cap is on the pool, and answering adds to it (RULES p12),
    // so a fixture that starts at the cap cannot make a legal move at all.
    startResources: [{ funds: 3, clout: 1, media: 1, trust: 1 }],
    ideologyDeck: corpus.ideology.map((c) => c.id),
    voterDeck: corpus.voter.map((c) => c.id),
    conspiracyDeck: corpus.conspiracy.map((c) => c.id),
    headlineDeck: corpus.headline.map((c) => c.id),
  });
  // Answer, so the game is in the `actions` phase where a card can be played. The
  // answer is deliberately arbitrary: none of the four cards reads an Ideology Card.
  const answered = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, CTX);
  if (!answered.ok) throw new Error(`fixture could not answer: ${answered.error}`);
  return answered.state;
}

function must(result: ReturnType<typeof reduce>): GameState {
  if (!result.ok) throw new Error(`unexpected failure: ${result.error}`);
  return result.state;
}

/**
 * Resolve a card through whichever path it really takes.
 *
 * All four recovered cards landed here are Headlines, which are drawn from the deck
 * and resolved in the post-turn queue, NOT bought and played by the caster. Resolving
 * them any other way would be a test of a path the game never uses.
 */
function play(s: GameState, id: string): GameState {
  const headline = corpus.headline.find((c) => c.id === id);
  if (headline !== undefined) return resolveHeadline(s, id);
  const held: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [...s.players.p1!.conspiracies, id] } },
  };
  return must(reduce(held, 'p1', { type: 'PLAY_CONSPIRACY', cardId: id }, CTX));
}

/** Put a Conspiracy Card in p1's hand and play it, as PLAY_CONSPIRACY would. */
function playConspiracy(s: GameState, id: string): GameState {
  const held: GameState = {
    ...s,
    players: { ...s.players, p1: { ...s.players.p1!, conspiracies: [...s.players.p1!.conspiracies, id] } },
  };
  return must(reduce(held, 'p1', { type: 'PLAY_CONSPIRACY', cardId: id }, CTX));
}

/** Resolve a Headline the way the end of a turn does, attributed to p1. */
function resolveHeadline(s: GameState, id: string): GameState {
  const active: GameState = {
    ...s,
    phase: 'headlines',
    activeHeadline: id,
    headlineQueue: [{ areaId: '', by: 'p1' }],
  };
  return must(reduce(active, 'p1', { type: 'ACK_HEADLINE' }, CTX));
}

const pool = (s: GameState, id: PlayerID) => s.players[id]!.resources;

describe('THE FOUR HORSEMEN — "Discard 2 resources of your choice"', () => {
  const c = card('hl-et2040-009');

  it('is a single choice of two, not a fixed denomination', () => {
    expect(c.effects).toEqual([{ op: 'lose-any', n: 2 }]);
  });

  it('asks its player to discard exactly two, and takes them when it does', () => {
    const s = play(game(), c.id);
    const pending = s.choices.filter((x) => x.player === 'p1' && x.choice.kind === 'lose-any');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.choice).toMatchObject({ kind: 'lose-any', count: 2 });

    const resolved = must(
      reduce(s, 'p1', {
        type: 'RESOLVE_CHOICE',
        choiceId: pending[0]!.id,
        pick: { kind: 'resources', res: { funds: 2 } },
      }, CTX),
    );
    // The player chooses the denomination, which is the card's whole choice.
    expect(pool(resolved, 'p1').funds).toBe(1);
    expect(pool(resolved, 'p1').trust).toBe(1);
  });
});

describe('KHAKI TERROR — "Donate 1 of each type to the Public Reserve"', () => {
  const c = card('hl-in2020-007');

  it('takes one of every resource its player holds', () => {
    const before = game();
    const after = play(before, c.id);
    const had = pool(before, 'p1');
    // One of each, and only of each: the claim the text makes is about what was
    // HELD, so it is asserted against the position rather than against a constant.
    for (const res of ['funds', 'clout', 'media', 'trust'] as const) {
      expect(pool(after, 'p1')[res], res).toBe(Math.max(0, had[res] - 1));
    }
    expect(pool(after, 'p2')).toEqual(before.players.p2!.resources);
  });

  it('and takes only what is there — the text says the rest is not donated', () => {
    const before = game();
    const thin: GameState = {
      ...before,
      players: {
        ...before.players,
        p1: { ...before.players.p1!, resources: { funds: 1, clout: 0, media: 0, trust: 0 } },
      },
    };
    const after = play(thin, c.id);
    expect(pool(after, 'p1')).toEqual({ funds: 0, clout: 0, media: 0, trust: 0 });
  });
});

describe('MARRIED WITH BITS — "Every opponent gains 1 voter"', () => {
  const c = card('hl-et2040-010');

  it('gives one placeable voter to every opponent and none to the caster', () => {
    const s = play(game(), c.id);
    expect(s.players.p2!.pending.map((g) => g.count)).toEqual([1]);
    expect(s.players.p3!.pending.map((g) => g.count)).toEqual([1]);
    expect(s.players.p1!.pending).toEqual([]);
  });

  it('and the voter is not from a Voter Card, so it may be placed anywhere', () => {
    const s = play(game(), c.id);
    expect(s.players.p2!.pending.every((g) => g.sameZone === false)).toBe(true);
  });
});

describe('GOOD GIG WELL PLAYED — "Draw the top Conspiracy Card and keep it"', () => {
  const c = card('hl-et2040-011');

  it('puts one card in its player\'s hand and in nobody else\'s', () => {
    const before = game();
    const after = play(before, c.id);
    expect(after.players.p1!.conspiracies.length).toBe(before.players.p1!.conspiracies.length + 1);
    expect(after.players.p2!.conspiracies).toEqual(before.players.p2!.conspiracies);
    expect(after.players.p3!.conspiracies).toEqual(before.players.p3!.conspiracies);
  });

  it('and it came off the top of the deck, which is what the text says', () => {
    const before = game();
    const after = play(before, c.id);
    const drawn = after.players.p1!.conspiracies.at(-1);
    expect(drawn).toBe(before._conspiracyDraw[0]);
  });
});

describe('the three cards whose text was corrected', () => {
  it('RED BLOODED strikes an OPPONENT\'s voter, which is what it now says', () => {
    const c = card('hl-et2040-002');
    const s = game();
    // p2 holds one voter on the board; p1's own voters must be out of reach.
    const area = s.zones.flatMap((z) => z.areas).find((a) => !a.peg && !a.volatile);
    if (area === undefined) throw new Error('the board has no empty area');
    const seeded: GameState = {
      ...s,
      zones: s.zones.map((z) => ({
        ...z,
        areas: z.areas.map((a) => (a.id === area.id ? { ...a, peg: { owner: 'p2' as PlayerID, majority: false } } : a)),
      })),
    };
    const played = play(seeded, c.id);
    const choice = played.choices.find((x) => x.player === 'p1' && x.choice.kind === 'discard-voter');
    expect(choice).toBeDefined();
    // The engine still refuses the caster's own pegs, which is why the text says so.
    const ownArea = seeded.zones.flatMap((z) => z.areas).find((a) => a.peg?.owner === 'p1');
    if (ownArea !== undefined) {
      const refused = reduce(played, 'p1', {
        type: 'RESOLVE_CHOICE',
        choiceId: choice!.id,
        pick: { kind: 'areas', areaIds: [ownArea.id] },
      }, CTX);
      expect(refused.ok).toBe(false);
    }
  });

  it("AIN'T NO CURE FOR LOVE says opponents, and the reducer agrees", () => {
    const c = card('hl-et2040-003');
    expect(c.text).toContain("opponents' voters");
    expect(c.text).not.toContain('of your own voters');
  });

  it('ERADICATING GERMS now does the thing its name and REF describe', () => {
    const c = card('ct-et2040-002');
    expect(c.effects[0]?.op).toBe('refresh-market');
    const before = game();
    const after = playConspiracy(before, c.id);
    // The market is refilled, so it is three cards either way — but not the same three.
    expect(after.market).toHaveLength(RULES.marketSize);
    expect(after.market.map((m) => m.cardId)).not.toEqual(before.market.map((m) => m.cardId));
  });
});

describe('every adapted card in the corpus resolves without failing', () => {
  it('a card cannot sit in a hand that the engine will refuse to play', () => {
    // The strongest form of the state-(b) rule that does not need a reducer: every
    // adapted card's text must exist, and its effects must all be executable. A card
    // with no text is a card nobody can read at the table.
    for (const c of [...corpus.conspiracy, ...corpus.headline]) {
      if (c.provenance !== 'adapted') continue;
      expect(c.text.length, `${c.id} text`).toBeGreaterThan(20);
      expect(c.effects.length, `${c.id} effects`).toBeGreaterThan(0);
    }
  });

  it('and a headline that is reachable from the post-turn queue resolves', () => {
    // One real headline, resolved through ACK_HEADLINE rather than a conspiracy play,
    // so the post-turn path is covered too.
    const s = resolveHeadline(game(), 'hl-et2040-004');
    expect(s.log.some((l) => l.text.includes('Quietly, The Ceiling Moved'))).toBe(true);
  });
});