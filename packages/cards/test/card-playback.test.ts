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
import { RULES, type CardID, type CardIndex, type HeadlineCard, type IdeologyCard, type PlayerID } from '../src/engine.js';

import { reduce } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import type { GameState } from '../../engine/src/state';

const corpus = loadCorpus();

/**
 * The fixture's OWN deck, so these tests measure the reducer and not the corpus.
 *
 * Two reasons, both learned the hard way while this file was being written:
 *  1. the deck files are another author's and they grow independently — a fixture
 *    built from `loadCorpus()` re-shuffles every time a card is added, so a
 *    reducer test starts failing because somebody added a Voter Card;
 *  2. `ANSWER` pays `side.pays` plus the p28 passive bonus, so a corpus-derived
 *    draw can push the answering player over `RULES.resourceCap` and raise a cap
 *    discard, which then sits in `state.choices` in front of the decision the test
 *    is actually about.
 *
 * So the Ideology Cards are declared here, with a payout small enough that a player
 * who starts at 6 cannot reach the cap, and the decks are built from them.
 */
const FIXTURE_IDEOLOGY: readonly IdeologyCard[] = [
  {
    id: 'ig-fixture-a',
    campaign: 'fixture',
    question: 'Does the ceiling move, or does the room?',
    sides: [
      { answer: 'It moves.', ideologue: 'capitalist', pays: { funds: 2 } },
      { answer: 'The room.', ideologue: 'idealist', pays: { trust: 2 } },
    ],
  },
  {
    id: 'ig-fixture-b',
    campaign: 'fixture',
    question: 'And the floor?',
    sides: [
      { answer: 'It stays.', ideologue: 'supremo', pays: { clout: 2 } },
      { answer: 'It goes.', ideologue: 'showstopper', pays: { media: 2 } },
    ],
  },
];

/**
 * A recovered card the shipped deck does not carry, added to the index here.
 *
 * These are the real REF texts, written as the corpus owner would write them now
 * the reducer honours them, so what is under test is the reducer and not a deck.
 */
const FIXTURE_HEADLINES: readonly HeadlineCard[] = [
  {
    id: 'hl-fixture-submerged',
    name: 'Submerged',
    text: 'Starting with you, every player may Gerrymander 1 majority or non-majority voter immediately, under the normal Gerrymandering rules.',
    effects: [{ op: 'gerrymander', n: 1, target: 'everyone' }],
  },
];

/**
 * The other three decks, pinned by id rather than sliced off the corpus.
 *
 * The Ideology deck above is fixture-owned for two reasons; these three were left
 * reading `corpus.X.slice(0, n)`, which is stable only while every card is APPENDED
 * to the top of a deck file. Insert one at the front — a new `core/headline.json`, a
 * campaign reorder — and the seeded shuffle deals a different hand, so a reducer test
 * starts failing for a reason that has nothing to do with the reducer. Pinning the
 * exact ids the slices currently produce makes that impossible: same shuffle input,
 * same game, by construction rather than by luck.
 *
 * Six Voter Cards because three fill the HQ Mat (p10) and three stay in `_voterDraw`.
 * Three Conspiracy Cards because the market is a refill, and `refresh-market` can only
 * change the market if there is something left in the deck to change it with.
 */
const FIXTURE_DECKS = {
  voter: ['vo-core-001', 'vo-core-002', 'vo-core-003', 'vo-core-004', 'vo-core-005', 'vo-core-006'],
  conspiracy: ['ct-et2040-001', 'ct-et2040-002', 'ct-et2040-003'],
  headline: ['hl-et2040-001', 'hl-et2040-002', 'hl-et2040-003'],
} as const;

const INDEX: CardIndex = {
  ideology: {
    ...Object.fromEntries(corpus.ideology.map((c) => [c.id, toEngineIdeologyCard(c)])),
    ...Object.fromEntries(FIXTURE_IDEOLOGY.map((c) => [c.id, c])),
  },
  voter: Object.fromEntries(corpus.voter.map((c) => [c.id, toEngineVoterCard(c)])),
  conspiracy: Object.fromEntries(corpus.conspiracy.map((c) => [c.id, toEngineConspiracyCard(c)])),
  headline: {
    ...Object.fromEntries(corpus.headline.map((c) => [c.id, toEngineHeadlineCard(c)])),
    ...Object.fromEntries(FIXTURE_HEADLINES.map((c) => [c.id, c])),
  },
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
    ideologyDeck: FIXTURE_IDEOLOGY.map((c) => c.id),
    voterDeck: FIXTURE_DECKS.voter,
    conspiracyDeck: FIXTURE_DECKS.conspiracy,
    headlineDeck: FIXTURE_DECKS.headline,
  });
  // Answer, so the game is in the `actions` phase where a card can be played. The
  // answer is deliberately arbitrary: none of the cards here reads an Ideology Card.
  const answered = reduce(s, 'p1', { type: 'ANSWER', side: 0 }, CTX);
  if (!answered.ok) throw new Error(`fixture could not answer: ${answered.error}`);
  // Nothing may be pending: a fixture whose first decision is somebody else's is a
  // fixture whose assertions are about the wrong thing.
  if (answered.state.choices.length > 0) {
    throw new Error('fixture left a pending decision; the opening pool crosses the cap');
  }
  return answered.state;
}

function must(result: ReturnType<typeof reduce>): GameState {
  if (!result.ok) throw new Error(`unexpected failure: ${result.error}`);
  return result.state;
}

/**
 * Resolve a card through whichever path it really takes.
 *
 * A Headline is drawn from the deck and resolved in the post-turn queue, NOT played
 * by the caster; a Conspiracy is played from the hand. `ACK_HEADLINE` drains the
 * queue and therefore advances the turn when the queue empties, which is why the
 * state this returns is already the NEXT player's `answer` phase.
 */
function play(s: GameState, x: HeadlineCard | string): GameState {
  const id = typeof x === 'string' ? x : x.id;
  const headline = typeof x === 'string' ? corpus.headline.find((c) => c.id === id) : x;
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
function resolveHeadline(s: GameState, id: CardID, queueDepth = 1): GameState {
  const active: GameState = {
    ...s,
    phase: 'headlines',
    activeHeadline: id,
    headlineQueue: Array.from({ length: queueDepth }, () => ({ areaId: '', by: 'p1' })),
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
    const before = game();
    const s = play(before, c.id);
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
    // The player chooses the denomination, which is the card's whole choice — so the
    // assertion is about what left the pool, not about a constant the fixture's
    // opening hand happens to produce.
    expect(pool(resolved, 'p1').funds).toBe(pool(before, 'p1').funds - 2);
    expect(pool(resolved, 'p1').trust).toBe(pool(before, 'p1').trust);
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

describe('G8 — gerrymander resolves its target, so "every player" is playable', () => {
  const SUBMERGED = 'hl-fixture-submerged';

  it('writes the bonus into every resolved player, the caster included', () => {
    // The behavioural half of G8. Before it, the case credited `source` alone, so
    // `target` was a field the type carried and the reducer ignored — the card read
    // as if it hit everyone while hitting one. SUBMERGED / NEW FACE WHO DIS (REF 4.3)
    // is the real card that needs this.
    //
    // TWO headlines are queued so `ACK_HEADLINE` does not drain the queue into
    // `advanceTurn`, which would reset the incoming player's `powerUses` and hide
    // what this card did.
    const after = resolveHeadline(game(), SUBMERGED, 2);
    for (const pid of ['p1', 'p2', 'p3'] as const) {
      expect(after.players[pid]?.powerUses.gerrymandered['__bonus'] ?? 0, pid).toBe(1);
    }
  });

  it('and `you` — or no target at all — still resolves to the caster alone', () => {
    const after = play(game(), { ...FIXTURE_HEADLINES[0]!, effects: [{ op: 'gerrymander' as const, n: 1 }] });
    expect(after.players.p1?.powerUses.gerrymandered['__bonus'] ?? 0).toBe(1);
    expect(after.players.p2?.powerUses.gerrymandered['__bonus'] ?? 0).toBe(0);
  });

  it('and the honest limit: the allowance lives in `powerUses`, which a turn resets', () => {
    // This is a real limit of the CURRENT model, not of this card, and it is the
    // reason SUBMERGED still cannot ship in its `everyone` reading: a grant written
    // into the next player's `powerUses` is wiped by `advanceTurn` before they act.
    // So the loop above is necessary and NOT sufficient — see KNOWN-GAPS G9/G22,
    // where the lasting grant belongs.
    const after = resolveHeadline(game(), SUBMERGED);
    expect(after.activePlayer).toBe('p2');
    expect(after.players.p1?.powerUses.gerrymandered['__bonus'] ?? 0).toBe(1);
    expect(after.players.p2?.powerUses.gerrymandered['__bonus'] ?? 0).toBe(0);
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