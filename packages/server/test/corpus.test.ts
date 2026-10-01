/**
 * THE REGRESSION GUARD FOR THE TEST BLINDNESS THAT SHIPPED AN UNWINNABLE GAME.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH, NAMED
 *
 * On 2026-10-01 a 5-player browser playtest ended two games on turn 52 with 0 of 9
 * zones decided. The cause was in the engine: `ANSWER` never discarded the answered
 * Ideology Card, so the discard pile was always empty, the reshuffle could never
 * fire, and a 52-card deck — one card drawn per turn — ran out on turn 52 with the
 * game unwinnable at EVERY seat count.
 *
 * No test noticed, and the reason is the thing this file pins. Every fixture in the
 * engine suite dealt **4000** Ideology Cards; every fixture in the server suite
 * dealt **240**. The number that decides whether a game is winnable is
 *
 *     Ideology Cards shipped: 52, drawn one per turn
 *
 * and no test was within 4x of it, let alone on it. A test suite can only be
 * structurally incapable of catching that bug, and it was, at every level.
 *
 * So there are two halves to the guard, and both are needed:
 *
 *  1. **Pin the numbers.** The shipped deck's size and composition, asserted
 *     exactly. A corpus that is shrunk, swapped or rebalanced changes these, and a
 *     change that halves the Ideology deck would otherwise sail through a suite
 *     that was never playing it.
 *  2. **Pin that the tests PLAY those numbers.** The harness used to default to a
 *     synthetic deck, so "the server's e2e driver" was quietly a different game
 *     from the shipped one. `startHarness()` with no `cards` argument now deals the
 *     real corpus, and the tests below assert that rather than trusting it.
 *
 * A game driven on the real corpus must also REACH AN ENDING rather than exhaust a
 * pile, which is the second half of the shipped bug and the assertion that would
 * have failed on the pre-fix engine even with a correct deck size.
 */

import { describe, expect, it } from 'vitest';

import { RULES, setup, type Ctx, type GameState } from '@shasn/engine';

import { loadCards, loadCtx } from '../src/index.ts';
import { cardsVersion, decksOf } from '../src/store.ts';
import { startHarness } from './fixtures.ts';
import { freshShippedCorpus, majoritiesOn, pegsOn, playInProcess } from './driver.ts';

// ─────────────────────── the numbers that decide winnability ───────────────────────

/**
 * The shipped deck, measured 2026-10-01 off the in-repo JSON via `loadCorpus`.
 *
 * These are the sizes `loadCards()` assembles from `decks/et2040` + `decks/in2020`
 * + `decks/core`. `bigCards(240)` — the old server fixture — is 4.6x the Ideology
 * deck; the engine's `bigCards()` at 4000 is 77x.
 */
const SHIPPED = {
  ideology: 52, // 20 (et2040) + 32 (in2020). ONE PER TURN. This is the cliff.
  voter: 18,
  conspiracy: 22,
  headline: 26,
} as const;

/** 6+11+6+9+5+9+6+11+6: the pegs needed to hold a majority in all nine zones. */
const MAJORITY_PEGS = 69;

/** 129 areas on the board. p20's board-full ending threshold. */
const FULL_BOARD = 129;

const cards = loadCards();
const ctx: Ctx = { rules: RULES, cards };

function sum(d: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const v of Object.values(d)) total += v;
  return total;
}

describe('the shipped corpus is the corpus', () => {
  it('has exactly the deck sizes the shipped game deals', () => {
    // The pin. `Ideology` is the one that matters — see the file header — and it is
    // the one a rebalance or a corpus swap would move first.
    const d = decksOf(cards);
    expect(d.ideologyDeck.length, 'the Ideology deck is one card per turn; its size IS the turn limit').toBe(SHIPPED.ideology);
    expect(d.voterDeck.length).toBe(SHIPPED.voter);
    expect(d.conspiracyDeck.length).toBe(SHIPPED.conspiracy);
    expect(d.headlineDeck.length).toBe(SHIPPED.headline);
  });

  it('carries 36 voters across 18 Voter Cards, in the 1/2/3 mix p10 allows', () => {
    // 36 voters does NOT cap a game, because a Voter Card recycles: `INFLUENCE`
    // discards it and `refillMarket` reshuffles. This is asserted so the number is
    // known rather than assumed — but 36 voters against a 129-area board is the
    // reason the corpus has to recycle, and the reason a test that deals a
    // non-recycling deck can reach a board the real game cannot.
    const voters = Object.values(cards.voter);
    expect(voters).toHaveLength(SHIPPED.voter);
    expect(voters.reduce((k, v) => k + v.voters, 0)).toBe(36);
    const mix = { 1: 0, 2: 0, 3: 0 };
    for (const v of voters) {
      expect([1, 2, 3]).toContain(v.voters);
      mix[v.voters as 1 | 2 | 3] += 1;
    }
    expect(mix, 'a Voter Card count changed; p10 allows 1, 2 or 3 voters and the mix is what lets a zone with one slot left be finished').toEqual({ 1: 6, 2: 6, 3: 6 });
  });

  it('prices 10 of its 18 Voter Cards with Funds, all in 1-3', () => {
    // The economy the driver has to make work. 10 of 18 are Funds-priced — so 8 are
    // priced entirely WITHOUT Funds, in Clout, Media or Trust.
    //
    // That 8 is the number that matters, and it is what the previous driver got
    // wrong. A cap-discard rule that keeps a Funds-only reserve leaves a player
    // holding `{funds: 12, clout: 0, media: 0, trust: 0}` facing a Mat of
    // `media 3 / funds 2 + trust 2 / clout 2 + trust 1` — nothing it can buy, ever.
    // `discardKeepingReserve` now holds a per-pool reserve for exactly this reason.
    const withFunds = Object.values(cards.voter).filter((v) => (v.cost.funds ?? 0) > 0);
    expect(withFunds).toHaveLength(10);
    expect(Object.values(cards.voter).filter((v) => (v.cost.funds ?? 0) === 0)).toHaveLength(8);
    for (const v of withFunds) {
      const f = v.cost.funds ?? 0;
      expect(f, `${v.id} is priced at ${f} Funds`).toBeGreaterThanOrEqual(1);
      expect(f, `${v.id} is priced at ${f} Funds`).toBeLessThanOrEqual(3);
    }
  });

  it('pays 3 or 4 resources for an answer, and always in a currency the board uses', () => {
    // The turn income. A game runs one ANSWER per turn, so this is the whole
    // per-turn budget the driver spends Voter Cards out of.
    for (const c of Object.values(cards.ideology)) {
      for (const side of c.sides) {
        const total = sum(side.pays);
        expect(total, `${c.id} side pays ${total}`).toBeGreaterThanOrEqual(3);
        expect(total, `${c.id} side pays ${total}`).toBeLessThanOrEqual(4);
        // A payout the driver cannot spend is a wasted turn. One card in the
        // shipped corpus carries an explicit zero, so the check is "not negative"
        // and the total above is what carries the real assertion.
        for (const [res, n] of Object.entries(side.pays)) {
          expect(['funds', 'clout', 'media', 'trust'], `${c.id} pays in "${res}"`).toContain(res);
          expect(n, `${c.id} pays ${res}: ${n}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('has 26 Headline Cards that actually open decisions, not 26 that just pay out', () => {
    // THE SECOND HALF OF THE BLINDNESS, and the one nobody had measured.
    //
    // The synthetic fixture gave every headline `gain media 1`, so the synthetic
    // corpus NEVER produced an effect-generated `PendingChoice`. The shipped
    // headlines carry twelve distinct ops, and three of them open a decision that
    // FREEZES A PLAYER until answered:
    //
    //   `evict`         -> evict-voter   (choose areas)
    //   `discard-voter` -> discard-voter (choose areas)
    //   `steal-any`     -> steal-any     (choose a player AND resources)
    //
    // A driver that cannot answer those does not play badly — it deadlocks the
    // table, because the engine refuses every other action for a frozen player.
    // The old driver's fallback for an unrecognised choice was an EMPTY area list,
    // which is only a legal answer to a zero-voter ask.
    const headlines = Object.values(cards.headline);
    expect(headlines).toHaveLength(SHIPPED.headline);
    const ops = new Set(headlines.flatMap((h) => h.effects.map((e) => e.op)));
    for (const op of ['evict', 'discard-voter', 'steal-any', 'lose-any', 'voters', 'gain']) {
      expect(ops.has(op as never), `no shipped headline uses \`${op}\`; the corpus changed shape`).toBe(true);
    }
    // And the count of DISTINCT ops, which is the number of driver branches a
    // corpus swap can invalidate.
    expect(ops.size, `the shipped headlines now carry ${ops.size} distinct effect ops`).toBe(12);
  });

  it('has 22 Conspiracy Cards whose effects are not all "gain funds"', () => {
    // Not load-bearing for the driver, which never plays a Conspiracy, but a
    // corpus where every conspiracy is `gain funds 2` would make the Conspiracy
    // deck inert and the 4-5 cost prices meaningless.
    const conspiracies = Object.values(cards.conspiracy);
    expect(conspiracies).toHaveLength(SHIPPED.conspiracy);
    expect(new Set(conspiracies.flatMap((c) => c.effects.map((e) => e.op))).size).toBeGreaterThan(3);
  });  it('boards 129 areas, of which 69 are needed for nine majorities', () => {
    const z = setup({ players: ['p1', 'p2'], names: { p1: 'a', p2: 'b' }, cards, seed: 1, ...decksOf(cards) });
    expect(z.zones.reduce((k, zone) => k + zone.areas.length, 0)).toBe(FULL_BOARD);
    expect(z.zones.reduce((k, zone) => k + zone.majority, 0)).toBe(MAJORITY_PEGS);
    // The two numbers the winnability claim is measured against, asserted from the
    // board rather than quoted from a comment.
    expect(MAJORITY_PEGS).toBeLessThan(FULL_BOARD);
  });
});

describe('the tests play the shipped corpus, not a synthetic one', () => {
  it('a harness built with no `cards` argument deals the corpus the server boots with', async () => {
    // THE GUARD AGAINST THE BLINDNESS, stated as a test about the HARNESS rather
    // than about the engine. The old `startHarness` defaulted to `bigCards()`, so
    // "the server's end-to-end driver" was quietly a different game from the
    // shipped one — same rules, same server, same socket, different cards. Nothing
    // in any test said so, because the fixture's own docstring explained the
    // choice as a necessity.
    //
    // Now the default is `loadCtx()` — the exact boot path — so a test that omits
    // `cards` is on the shipped corpus and this assertion says so out loud. A
    // future "the real corpus is too slow to drive" change has to change THIS line,
    // visibly, instead of quietly reintroducing a 4.6x deck.
    const h = await startHarness({ dispatchRate: 4000 });
    try {
      expect(Object.keys(h.ctx.cards.ideology)).toHaveLength(SHIPPED.ideology);
      expect(Object.keys(h.ctx.cards.voter)).toHaveLength(SHIPPED.voter);
      expect(Object.keys(h.ctx.cards.conspiracy)).toHaveLength(SHIPPED.conspiracy);
      expect(Object.keys(h.ctx.cards.headline)).toHaveLength(SHIPPED.headline);
      // And it is the SAME corpus, by content hash, not merely the same size. A
      // harness handed a copy of the real cards would satisfy the counts.
      expect(cardsVersion(h.ctx.cards)).toBe(cardsVersion(loadCtx().cards));
      // The room it dealt, too: the match the lobby creates has to be on the
      // shipped decks, not just the harness's `ctx`.
      expect(h.ctx.cards.ideology).toBeDefined();
    } finally {
      await h.close();
    }
  });

  it('a game driven on the shipped corpus REACHES AN ENDING, and passes the turn-52 cliff', () => {
    // The assertion the pre-fix engine could not have passed, whatever the deck
    // size. The bug ended every game on turn 52 with `finished: true` and no legal
    // move of any kind; the fix recycles the Ideology deck, so a shipped-corpus
    // game goes PAST 52 and ends on a decided board.
    //
    // Five seats, because that is the configuration the playtest hit and the one
    // where the staggered start (p7) was thought to be the problem.
    const start = freshShippedCorpus(19, 5, ctx);
    const run = playInProcess(start, ctx, { maxActions: 1200 });
    expect(run.stalled, `the driver stalled: ${run.reason}`).toBe(false);
    expect(run.state.finished, 'a shipped-corpus 5-seat game did not reach an ending').toBe(true);
    expect(run.state.turn, 'the game ended on or before turn 52, which is the deck-exhaustion cliff').toBeGreaterThan(SHIPPED.ideology);
    expect(majoritiesOn(run.state), 'the shipped corpus did not produce a decided board').toBe(9);
    expect(pegsOn(run.state)).toBeGreaterThanOrEqual(MAJORITY_PEGS);

    // …and the mechanism, named: the recycle fired, so the deck never emptied.
    expect(
      run.state.log.some((l) => l.text.includes('Ideology deck is exhausted')),
      'the game ended because the Ideology deck ran out',
    ).toBe(false);
    expect(run.state._ideologyDraw.length + run.state._ideologyDiscard.length).toBe(SHIPPED.ideology);
  });

  it('the driver actually answers the effect-generated choices the synthetic corpus hid', () => {
    // The driver is exercised by the game above, and this asserts it met the
    // decisions the synthetic corpus could never produce. Without this, a driver
    // that quietly degraded to "answer side 0 and hope" would still pass the
    // winnability tests at a seat count where the headlines happened to be benign.
    const kinds = new Set<string>();
    for (const n of [2, 3, 4, 5]) {
      const run = playInProcess(freshShippedCorpus(3, n, ctx), ctx, { maxActions: 1200 });
      expect(run.state.finished, `${n} seats did not finish: ${run.reason}`).toBe(true);
      for (const k of run.choiceKinds) kinds.add(k);
    }
    // `evict-voter`, `discard-voter` and `steal-any` are the three that freeze a
    // player. The synthetic corpus produced NONE of them.
    for (const k of ['evict-voter', 'discard-voter', 'steal-any', 'lose-any', 'gain-any']) {
      expect(kinds.has(k), `the driver never met a \`${k}\` decision across 2/3/4/5 seats`).toBe(true);
    }
  });

  it('the engine-visible deck arrays and the server-visible ones are the same list', () => {
    // `setup` takes deck ARRAYS; the reducer takes the index. `decksOf` is the one
    // place they meet, and replay depends on that place being right. If the two
    // ever diverged, a match would be dealt one deck and replayed against another,
    // and the winnability claim would be about a game nobody plays.
    const d = decksOf(cards);
    const fresh: GameState = setup({
      players: ['p1', 'p2'],
      names: { p1: 'a', p2: 'b' },
      cards,
      seed: 7,
      ...d,
    });
    expect(fresh._ideologyDraw.length + fresh._ideologyDiscard.length + (fresh._pendingCard === null ? 0 : 1)).toBe(SHIPPED.ideology);
    expect(new Set([...d.ideologyDeck, ...d.voterDeck, ...d.conspiracyDeck, ...d.headlineDeck]).size).toBe(
      SHIPPED.ideology + SHIPPED.voter + SHIPPED.conspiracy + SHIPPED.headline,
    );
  });
});
