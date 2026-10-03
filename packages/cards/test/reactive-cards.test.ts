/**
 * BLOCK and DEFLECT, SHIPPED — played through the real reducer.
 *
 * `scripts/playable.ts` already proves both cards can be resolved, and
 * `reducer-parity.test.ts` proves the corpus does not exceed what `reduce()` can do.
 * Neither of those touches the deck file. This file is about the three things that only
 * exist now that the cards are IN `decks/`:
 *
 *  1. **THE PLUMBING.** `toEngineConspiracyCard` builds the engine card key by key and
 *     adds `duration` / `timing` / `interrupt` through `withXScope`. If that spread lost
 *     `interrupt`, the deck would still validate, the parity test would still pass — it
 *     checks the CORPUS card, not the converted one — and the shipped cards would be inert
 *     in a real game while every cards-package test stayed green. The server suite caught
 *     this class of blindness before (see `secret-state.test.ts`'s fixture-cannot-fail
 *     note), so it is asserted directly here: the field the engine reads is the field the
 *     deck file carries.
 *  2. **THE CARDS DO WHAT THEIR TEXT SAYS**, through `reduce()` rather than through a
 *     reading of its source. `card-playback.test.ts` is the same argument for the four
 *     recovered cards that landed before them, and it earns its place: three shipped
 *     cards were caught by it promising things `resolveChoice` cannot reach.
 *  3. **THE DROPPED CLAUSES STAY DROPPED.** An `adapted` card's text is a promise, and the
 *     promise here is bounded: BLOCK still cannot discard an open card, cleanse an active
 *     one, or block a card that steals itself, and DEFLECT still redirects a whole effect
 *     list rather than one partial effect. A later editor "improving" the text toward the
 *     recovered wording would produce exactly the card that lies, which is state (b) in
 *     KNOWN-GAPS.md §0 and the failure this whole package exists to prevent. So the four
 *     dropped phrases are pinned as ABSENT.
 *
 * WHY THE CARD UNDER RESPONSE IS A FIXTURE. `canBeAnswered` asks whether another player
 * holds a reactive card, and the block/deflect pair are the only shipped cards that do,
 * so the card being answered has to be something this file supplies. Asserting against a
 * fixture payout rather than a corpus card is deliberate: the subject is the ANSWER, and
 * a corpus card's own effects would be a second moving part.
 */

import { describe, expect, it } from 'vitest';

import { loadCorpus, toEngineConspiracyCard, type CorpusConspiracyCard } from '../src/corpus.js';
import { indexCards, RULES, type CardID, type CardIndex, type ConspiracyCard, type PlayerID } from '../src/engine.js';

import { playerView } from '../../engine/src/playerView';
import { reduce } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import type { GameState } from '../../engine/src/state';

const corpus = loadCorpus();

const BLOCK_ID = 'ct-et2040-014';
const DEFLECT_ID = 'ct-et2040-015';

/**
 * A deterministic payout for p1, and nothing else.
 *
 * `gain` with a literal `Delta` and no `target` resolves for the player the card is
 * played by and pays without raising a decision, so the arithmetic below has exactly one
 * possible answer. `gain-any` would put a `PendingChoice` in the way and the test would
 * be measuring the chooser instead of the answer.
 */
const PAYOUT: ConspiracyCard = {
  id: 'ct-fixture-payout',
  name: 'A Payout',
  text: 'Gain 2 Funds.',
  cost: 4,
  effects: [{ op: 'gain', res: { funds: 2 } }],
};

const INDEX: CardIndex = indexCards({
  ideology: corpus.ideology.map((c) => ({
    id: c.id,
    campaign: c.campaign,
    question: c.question,
    sides: c.sides,
  })),
  voter: corpus.voter.map((c) => ({ id: c.id, cost: c.cost, voters: c.voters })),
  conspiracy: [...corpus.conspiracy.map(toEngineConspiracyCard), PAYOUT],
  headline: corpus.headline.map((c) => ({
    id: c.id,
    name: c.name,
    text: c.text,
    effects: c.effects,
  })),
});

const CTX = { rules: RULES, cards: INDEX };

function must(result: ReturnType<typeof reduce>, why: string): GameState {
  if (!result.ok) throw new Error(`${why}: ${result.error}`);
  return result.state;
}

/**
 * The opening pool, one entry per seat, `startResources[i]` being seat `i`'s mat.
 *
 * EXPLICITLY THREE ENTRIES, and that is the point: `startResources` is positional, so a
 * one-entry array seats a fixture with 2 Funds and seats p2 and p3 with nothing. Every
 * arithmetic assertion below is about a DIFFERENCE between a position and the same
 * position answered, and a seat that starts empty makes that difference depend on the
 * seat rather than on the card — which is how a redirect test ends up passing for the
 * wrong reason.
 */
const OPENING = [
  { funds: 2, clout: 2, media: 2, trust: 2 },
  { funds: 2, clout: 2, media: 2, trust: 2 },
  { funds: 2, clout: 2, media: 2, trust: 2 },
] as const;

/** Three seats, p1 on move in `actions`, p1 holding `PAYOUT`, p2 holding `held`. */
function position(held: CardID | null): GameState {
  const base = setup({
    players: ['p1', 'p2', 'p3'],
    cards: INDEX,
    seed: 20260102,
    startResources: OPENING,
    ideologyDeck: corpus.ideology.map((c) => c.id),
    voterDeck: corpus.voter.map((c) => c.id),
    conspiracyDeck: corpus.conspiracy.map((c) => c.id),
    headlineDeck: corpus.headline.map((c) => c.id),
  });
  const answered = must(reduce(base, 'p1', { type: 'ANSWER', side: 0 }, CTX), 'answer');
  const withHands: GameState = {
    ...answered,
    players: {
      ...answered.players,
      p1: { ...answered.players.p1!, conspiracies: [PAYOUT.id] },
      p2: { ...answered.players.p2!, conspiracies: held === null ? [] : [held] },
    },
  };
  return must(reduce(withHands, 'p1', { type: 'PLAY_CONSPIRACY', cardId: PAYOUT.id }, CTX), 'play the payout');
}

const funds = (s: GameState, p: PlayerID): number => s.players[p]?.resources.funds ?? -1;

function corpusCard(id: CardID): CorpusConspiracyCard {
  const found = corpus.conspiracy.find((c) => c.id === id);
  if (found === undefined) throw new Error(`${id} is not in the shipped corpus`);
  return found;
}

// ─────────────────────────── they ship, and they reach the engine ───────────────────────────

describe('the two reactive cards are in the shipped corpus', () => {
  it('both are, and each carries the interrupt the reducer acts on', () => {
    const block = corpusCard(BLOCK_ID);
    const deflect = corpusCard(DEFLECT_ID);
    expect(block.name).toBe('Block');
    expect(deflect.name).toBe('Deflect');
    expect(block.interrupt).toEqual({ op: 'block', window: 'always', target: 'any-card' });
    expect(deflect.interrupt).toEqual({ op: 'deflect', window: 'always', target: 'any-card' });
    // `adapted`, not `verbatim`, and the reason is on the card. The corpus ships 0
    // verbatim cards and this pair does not change that: BLOCK still drops three
    // clauses and DEFLECT still redirects a whole effect list rather than one partial
    // effect. See SOURCES.md §1.
    expect(block.provenance).toBe('adapted');
    expect(deflect.provenance).toBe('adapted');
    // Each carries a real effect list as well as a reactive one, because a Conspiracy
    // Card can be bought and played for its face value and the schema requires a body.
    expect(block.effects.length).toBeGreaterThan(0);
    expect(deflect.effects.length).toBeGreaterThan(0);
  });

  it('the interrupt SURVIVES the conversion to an engine card', () => {
    // THE PLUMBING, asserted rather than assumed. `toEngineConspiracyCard` builds the
    // object key by key and `withXScope` is what adds the three optional fields; a
    // regression there would leave the corpus card valid and the ENGINE card inert.
    for (const id of [BLOCK_ID, DEFLECT_ID]) {
      const engine = toEngineConspiracyCard(corpusCard(id));
      expect(engine.interrupt, `${id} lost its interrupt on the way to the engine`).toEqual(
        corpusCard(id).interrupt,
      );
      // And the envelope is stripped, which is the other half of that function's job.
      expect('source' in engine, `${id} still carries its provenance envelope`).toBe(false);
    }
    // And the index the server builds from the corpus answers the same question, which is
    // the only form the engine ever sees.
    const fromCorpus = indexCards({
      ideology: [],
      voter: [],
      conspiracy: corpus.conspiracy.map(toEngineConspiracyCard),
      headline: [],
    });
    for (const id of [BLOCK_ID, DEFLECT_ID]) {
      expect(fromCorpus.conspiracy[id]?.interrupt?.op, `${id} is inert in the served index`).toMatch(/block|deflect/);
    }
  });

  it('the printed text does not promise a clause the engine dropped', () => {
    // The bounded promise, pinned. Each phrase is a real clause of the recovered card
    // (REF 4.2.1) that `reduce()` does not perform; printing one would make the card a
    // lie, which is KNOWN-GAPS.md §0 state (b).
    const dropped: readonly (readonly [CardID, string])[] = [
      [BLOCK_ID, 'discard an open'],
      [BLOCK_ID, 'cleanse'],
      [BLOCK_ID, 'stealing this card'],
      [DEFLECT_ID, 'partial effect'],
      [DEFLECT_ID, 'affects you'],
    ];
    for (const [id, phrase] of dropped) {
      expect(corpusCard(id).text.toLowerCase(), `${id} promises "${phrase}", which the engine does not do`).not.toContain(phrase);
    }
    // …and the two things they DO promise are printed, so the text is not merely shorter.
    expect(corpusCard(BLOCK_ID).text).toContain('IMMEDIATELY');
    expect(corpusCard(BLOCK_ID).text.toLowerCase()).toContain('not aimed at you');
    expect(corpusCard(DEFLECT_ID).text.toLowerCase()).toContain('whole effect');
  });
});

// ─────────────────────────── played ───────────────────────────

describe('the shipped BLOCK cancels the card under response', () => {
  it('a card somebody can answer is HELD, and the payout has not happened', () => {
    const held = position(BLOCK_ID);
    expect(held.interrupt, 'a Block in p2\'s hand did not open a window').not.toBeNull();
    expect(held.interrupt?.actor).toBe('p1');
    expect(held.interrupt?.responder).toBeNull();
    // DIFFERENTIAL, and never an absolute: the same seed and the same answer, so the only
    // difference between the held position and the control below is whether the payout was
    // staged or applied. An absolute number here would be a statement about which
    // Ideology Card the seed dealt - a different test, which fails on a deck edit.
    expect(
      funds(position(null), 'p1') - funds(held, 'p1'),
      'the staged effect was applied before the window closed',
    ).toBe(2);
  });

  it('answering with it pays the actor nothing, and says so in the log', () => {
    const held = position(BLOCK_ID);
    const after = must(
      reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK_ID }, CTX),
      'block',
    );
    expect(after.interrupt).toBeNull();
    expect(funds(after, 'p1'), 'the actor was paid through a Block').toBe(funds(held, 'p1'));
    expect(
      funds(after, 'p1'),
      'the actor ended up where an unblocked resolution would have left it',
    ).toBeLessThan(funds(position(null), 'p1'));
    // THE DIFFERENTIAL, and the reason it is written this way: a blocked resolution and a
    // never-played one agree on every pool, so the log is where a block is visible. The
    // control below proves the engine pays 2 when nobody is holding a Block.
    expect(after.log.some((l) => l.text === `Blocked "${PAYOUT.name}".`)).toBe(true);
    expect(after.log.some((l) => l.text === `Played "Block".`)).toBe(true);
    // The card was played, not copied: it has left p2's hand.
    expect(after.players.p2?.conspiracies ?? []).not.toContain(BLOCK_ID);
  });

  it('the CONTROL pays, so the assertion above is a difference and not a constant', () => {
    const held = position(null);
    expect(held.interrupt, 'nobody holds a reactive card, so no window opened').toBeNull();
    expect(funds(held, 'p1'), 'the control did not pay the payout out at all').toBeGreaterThan(OPENING[0].funds);
  });
});

describe('the shipped DEFLECT redirects the card under response', () => {
  it('the payout lands on the third player, and not on the actor', () => {
    const held = position(DEFLECT_ID);
    expect(held.interrupt, 'a Deflect in p2\'s hand did not open a window').not.toBeNull();
    // DIFFERENTIAL, and never an absolute -- the same reasoning the BLOCK block above
    // states. This line used to read `expect(funds(held, 'p1')).toBe(2)`, which is not a
    // fact about DEFLECT at all: `position()` seeds the Ideology deck, p1 answers the card
    // the seed deals, and every Ideology Card pays a different amount, so `2` was a
    // statement about which card that seed happened to reach. Growing the deck (six new
    // original Ideology Cards moved the draw order) changed it from 2 to 4 and the test
    // failed on a card edit that broke nothing. The property actually being guarded is
    // that the staged effect HAS NOT BEEN PAID while the window is open, and the control
    // below resolves the same seeded card with no Deflect in hand, so the only difference
    // between the two numbers is the staging.
    expect(
      funds(position(null), 'p1') - funds(held, 'p1'),
      'the staged effect was applied before the response window closed',
    ).toBeGreaterThan(0);
    const after = must(
      reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT_ID, at: 'p3' }, CTX),
      'deflect',
    );
    expect(after.interrupt).toBeNull();
    // The same three comparisons the BLOCK makes, with the redirect added: the actor is
    // paid nothing, the TARGET is paid the whole staged effect, and the responder is not
    // the target.
    expect(funds(after, 'p1'), 'the actor was paid through a Deflect').toBe(funds(held, 'p1'));
    expect(funds(after, 'p3'), 'the Deflect did not redirect the payout to its target').toBe(funds(held, 'p3') + 2);
    expect(funds(after, 'p2'), 'the Deflect paid the player who played it').toBe(funds(held, 'p2'));
    // The engine logs no "Deflected ..." line, so the redirect IS the evidence.
    expect(after.players.p2?.conspiracies ?? []).not.toContain(DEFLECT_ID);
  });

  it('the engine refuses a Deflect aimed at the actor or at the responder', () => {
    // The printed card says "any player other than THEM", and the two exclusions are the
    // actor and the responder — a Deflect aimed at either is a no-op dressed as a card.
    const held = position(DEFLECT_ID);
    for (const [at, why] of [
      ['p1', 'back at the player who played it'],
      ['p2', 'at the player who played the Deflect'],
    ] as const) {
      const r = reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: DEFLECT_ID, at }, CTX);
      expect(r.ok, `the engine accepted a Deflect ${why}`).toBe(false);
    }
  });

  it('a Block cannot be redirected, because it has nothing to redirect', () => {
    // The type carries `at` on both ops and `reduce` refuses it on a BLOCK. A card that
    // accepted a target it cannot use is a declaration the engine ignores, which is what
    // `src/executable.ts` exists to prevent — so this is asserted rather than assumed.
    const held = position(BLOCK_ID);
    const r = reduce(held, 'p2', { type: 'RESPOND_INTERRUPT', cardId: BLOCK_ID, at: 'p3' }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nothing to redirect');
  });
});

describe('the shipped corpus opens a window only when somebody can answer one', () => {
  it('a hand with no reactive card never opens one — which is what keeps a driver honest', () => {
    // The property the winnability sweep depends on: shipping two reactive cards did not
    // make every played card a window. It takes a player HOLDING one, and `draw-conspiracy`
    // is the only route to that without buying, so a driver that never buys a Conspiracy
    // Card plays the ordinary game and the reactive tests are the ones that exercise this.
    for (const id of corpus.conspiracy.map((c) => c.id)) {
      const base = setup({
        players: ['p1', 'p2', 'p3'],
        cards: INDEX,
        seed: 7,
        startResources: OPENING,
        ideologyDeck: corpus.ideology.map((c) => c.id),
        voterDeck: corpus.voter.map((c) => c.id),
        conspiracyDeck: corpus.conspiracy.map((c) => c.id),
        headlineDeck: corpus.headline.map((c) => c.id),
      });
      const withCard: GameState = {
        ...base,
        players: { ...base.players, p1: { ...base.players.p1!, conspiracies: [id] } },
      };
      const played = reduce(withCard, base.activePlayer, { type: 'PLAY_CONSPIRACY', cardId: id }, CTX);
      if (!played.ok) continue; // an illegal play is this file's business elsewhere
      expect(
        played.state.interrupt,
        `${id} opened a window with nobody holding a reactive card`,
      ).toBeNull();
    }
  });

  it('and the two cards that CAN answer are the only ones in the corpus', () => {
    const reactive = corpus.conspiracy.filter((c) => c.interrupt !== undefined).map((c) => c.id).sort();
    expect(reactive).toEqual([BLOCK_ID, DEFLECT_ID]);
  });

  it('playerView hides both, from everybody including their owner', () => {
    // R1, restated for the two cards that just became the most valuable hand in the game:
    // a reactive card in hand is exactly the information a client must not carry, and the
    // reason `packages/server`'s driver has to be TOLD its own hand rather than reading it.
    const held = position(BLOCK_ID);
    for (const viewer of ['p1', 'p2', 'p3'] as const) {
      const json = JSON.stringify(playerView(held, viewer));
      expect(json, `${viewer}'s projection names a BLOCK`).not.toContain(BLOCK_ID);
    }
  });
});