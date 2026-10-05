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
 *  1. **Play the real numbers.** The harness used to default to a synthetic deck, so
 *     "the server's e2e driver" was quietly a different game from the shipped one.
 *     `startHarness()` with no `cards` argument now deals the real corpus, and the
 *     tests below assert that rather than trusting it.
 *  2. **Hold the corpus to INVARIANTS, not to a footprint.** This half used to be the
 *     opposite: the deck sizes were literals here, so every card the corpus gained
 *     turned this file red and the fix was to edit a number until it agreed with
 *     whatever the code now did. That is a tautology wearing the costume of a test,
 *     and it is the same blindness one layer down — a test that pins a number cannot
 *     fail on the change it exists to catch. The corpus facts now live in
 *     `corpus-facts.ts`, derived from a `CardIndex` that is passed in, so they are
 *     true of the shipped corpus and of every bigger one; and `corpus-drift.test.ts`
 *     proves it by growing the corpus and asserting nothing here goes red.
 *
 * A game driven on the real corpus must also REACH AN ENDING rather than exhaust a
 * pile, which is the second half of the shipped bug and the assertion that would
 * have failed on the pre-fix engine even with a correct deck size.
 */

import { describe, expect, it } from 'vitest';

import { playerView, RULES, setup, type Ctx, type GameState } from '@shasn/engine';

import { loadCards, loadCtx } from '../src/index.ts';
import { cardsVersion, decksOf } from '../src/store.ts';
import { startHarness } from './fixtures.ts';
import { BOARD, DECK_KINDS, POOLS, REQUIRED_HEADLINE_OPS, corpusProblems, deckCliffComplaints, exhaustedIdeologyDeck, factsOf, syntheticOps } from './corpus-facts.ts';
import { freshShippedCorpus, majoritiesOn, pegsOn, playInProcess } from './driver.ts';

// ─────────────────────── the numbers that decide winnability ───────────────────────

/**
 * THE SHIPPED DECK, MEASURED. There is no literal to update, and that is the point.
 *
 * Everything below compares one of these against another one of these, or against a
 * RULE. `corpus-facts.ts` has the long argument; this is the short version of why the
 * old `SHIPPED = { ideology: 52, ... }` had to go:
 *
 *  - "the projected draw pile may never exceed the deck that was dealt" is a relation
 *    between two things the engine produced. Asserting it against 26 instead of
 *    `dealt.headline` says the engine agrees with a number typed by hand.
 *  - "the Ideology deck is one card per turn, so its size is the turn cliff" — the
 *    REASONING is the assertion and it is kept verbatim below; the number is
 *    `dealt.ideology`, so the cliff moves when the deck does and the comparison
 *    "the game outlasts its own deck" never has to be re-argued.
 *  - "the corpus is not inert" was a count of distinct ops, which could only fail in
 *    the direction of a corpus that gained one. See `corpusProblems()` and the ruling
 *    on the headline-op count below.
 *
 * What is deliberately still a literal, because a literal is the right instrument:
 * p10's "1, 2 or 3 voters", the nine zones, and the fact that a nine-majority game is
 * the win. Those are rules, and a rule that changes should turn a test red.
 */
const cards = loadCards();
const ctx: Ctx = { rules: RULES, cards };
const facts = factsOf(cards);
const dealt = facts.dealt;
const dealtTotal = DECK_KINDS.reduce((k, kind) => k + dealt[kind], 0);

function sum(d: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const v of Object.values(d)) total += v;
  return total;
}

describe('the shipped corpus is the corpus', () => {
  it('deals four non-empty decks, and each holds exactly the cards its index holds', () => {
    // The pin, re-derived. The old assertion was `deck.length === 26` per kind, which
    // turned red on every card the corpus gained and had to be edited by arithmetic to
    // go green again — twice, and once from 22 to 24 rather than from the decks.
    //
    // What is actually being protected is the SHAPE: four separate pools, none of them
    // empty, and no card indexed without being dealt. An id that reached two pools at
    // once would make `Object.keys(cards[kind]).length` disagree with what a game is
    // dealt, which is precisely the disagreement the old literal was standing in for.
    expect(corpusProblems(facts), 'the shipped corpus violates a deck invariant').toEqual([]);
    expect(dealtTotal, 'the dealt corpus should be every card in the index').toBe(
      facts.indexed.ideology + facts.indexed.voter + facts.indexed.conspiracy + facts.indexed.headline,
    );
  });

  it('carries Voter Cards that print 1, 2 and 3 voters, so a zone with any slots left can be finished', () => {
    // p10, verbatim: "Voter Cards can contain 1, 2 or 3 voters." A rule, so the
    // expectation is a rule rather than a tally.
    //
    // The old test asserted the exact 6/6/6 mix. The mix was a footprint and the
    // footprint is what breaks; the CLAIM it was standing in for is that all three
    // counts exist, because a zone with one slot left can only be completed by a
    // single-voter card. That is now the assertion, and it is a floor: no card addition
    // can break it, and losing the 1-voter card is exactly what should turn it red.
    const sizes = new Set(facts.voter.sizes);
    for (const size of [1, 2, 3]) {
      expect(sizes.has(size), `no Voter Card carries exactly ${size} voter${size === 1 ? '' : 's'}`).toBe(true);
    }
    // And the total, for the record rather than as an expectation: it does NOT cap a
    // game, because a Voter Card recycles. The assertion that says so is the one in
    // the winnability test below, which measures a real board against it.
    expect(facts.voter.totalVoters).toBeGreaterThan(0);
  });

  it('prices Voter Cards across every pool, and leaves every pool a way to be broke', () => {
    // The economy the driver has to make work, and the shape of the old
    // "10 of 18 are priced with Funds, 8 are not" test.
    //
    // That test's own comment is the interesting part: a cap-discard rule that keeps a
    // Funds-only reserve leaves a player holding `{funds: 12, clout: 0, media: 0,
    // trust: 0}` facing a Mat of `media 3 / funds 2 + trust 2 / clout 2 + trust 1` —
    // nothing it can buy, ever. `discardKeepingReserve` holds a per-pool reserve for
    // exactly that, and the 8 is the number that made the scenario reachable.
    //
    // So the assertion is the scenario, per pool, and not the count: for each of the
    // four currencies there is at least one card that pool can buy AND at least one it
    // cannot. Derived from the corpus, so it survives any number of cards.
    for (const pool of POOLS) {
      expect(facts.voter.pricedIn[pool], `no Voter Card is priced in ${pool}`).toBeGreaterThan(0);
      expect(facts.voter.unpricedIn[pool], `every Voter Card is priced in ${pool}, so a ${pool}-only hand can never be stuck`).toBeGreaterThan(0);
    }
  });

  it('pays an ANSWER in a currency the board uses, and enough to buy a turn', () => {
    // The turn income. A game runs one ANSWER per turn, so this is the whole per-turn
    // budget the driver spends Voter Cards out of.
    for (const c of Object.values(cards.ideology)) {
      for (const side of c.sides) {
        const total = sum(side.pays);
        // A payout the driver cannot spend is a wasted turn. One card in the shipped
        // corpus carries an explicit zero, so the per-resource check is "not negative"
        // and the real claim is the two below.
        for (const [res, n] of Object.entries(side.pays)) {
          expect(POOLS as readonly string[], `${c.id} pays in "${res}"`).toContain(res);
          expect(n, `${c.id} pays ${res}: ${n}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
    // The old assertion was "every side pays 3 or 4" — a footprint of the current
    // corpus, which turned red when a card paid differently and could only be silenced
    // by editing the bound to whatever the cards now did. The claim underneath it is
    // that a turn's income can afford a turn's action, and THAT is checkable against
    // something outside the corpus: the cheapest Voter Card. Currently an answer pays
    // 3 against a 2-resource card, so the driver is never income-starved.
    expect(
      facts.answerPay.min,
      `the cheapest ANSWER pays ${facts.answerPay.min}; the cheapest Voter Card costs ${facts.voter.minCost}`,
    ).toBeGreaterThanOrEqual(facts.voter.minCost);
  });

  it('has Headline Cards that open decisions, not ones that just pay out', () => {
    // THE SECOND HALF OF THE BLINDNESS, and the one nobody had measured.
    //
    // The synthetic fixture gave every headline `gain media 1`, so the synthetic
    // corpus NEVER produced an effect-generated `PendingChoice`. The shipped headlines
    // carry a dozen distinct ops, and three of them open a decision that FREEZES A
    // PLAYER until answered:
    //
    //   `evict`         -> evict-voter   (choose areas)
    //   `discard-voter` -> discard-voter (choose areas)
    //   `steal-any`     -> steal-any     (choose a player AND resources)
    //
    // A driver that cannot answer those does not play badly — it deadlocks the table,
    // because the engine refuses every other action for a frozen player. The old
    // driver's fallback for an unrecognised choice was an EMPTY area list, which is
    // only a legal answer to a zero-voter ask.
    //
    // THE RULING ON THE COUNT OF TWELVE, which used to be `expect(ops.size).toBe(12)`.
    //
    // The count was a proxy, and the honest reading of what it guarded is "the corpus
    // is not inert" — it was standing in for the synthetic fixture's single `gain`.
    // So it is now the comparison that means something: strictly more of the effect
    // vocabulary than `bigCards()` uses, measured rather than remembered. That is
    // derived on both sides, it cannot be satisfied by arithmetic on a tally, and it
    // fails for the right reason — a corpus that went flat, not a corpus that grew.
    //
    // A FLOOR rather than an equality is also the only correct polarity. The equality
    // could fail in exactly one direction, a corpus that GAINED an op, and gaining an
    // op is the outcome this project wants: GENDER TROUBLE is the first `restrict`
    // headline, it is fully implemented and expressible, and it was unshippable purely
    // because that equality turned 12 into 13. A guard that punishes progress is a
    // guard that gets deleted, and then there is no guard.
    //
    // The named ops below keep the part that was never a count: each of those three
    // freezing ops is a BEHAVIOUR the driver has a branch for, so losing one is a real
    // regression and each is asserted by name rather than in aggregate.
    const syn = syntheticOps();
    expect(facts.headlineOps.size, `the headlines use ${facts.headlineOps.size} effect ops`).toBeGreaterThan(syn.headline);
    for (const op of REQUIRED_HEADLINE_OPS) {
      expect(facts.headlineOps.has(op), `no shipped headline uses \`${op}\`; the corpus changed shape`).toBe(true);
    }
  });

  it('has a Conspiracy deck whose effects are not all one op', () => {
    // Not load-bearing for the driver, which never plays a Conspiracy, but a corpus
    // where every conspiracy is `gain funds 2` would make the Conspiracy deck inert
    // and the 4-5 cost prices meaningless. Same derived comparison as the headlines:
    // more of the effect vocabulary than the synthetic fixture's `voters n: 1`.
    const syn = syntheticOps();
    expect(facts.conspiracyOps.size, `the conspiracies use ${facts.conspiracyOps.size} effect ops`).toBeGreaterThan(syn.conspiracy);
  });

  it('boards enough areas for nine majorities, and fewer majors than areas', () => {
    // p20's board-full ending and p10's zone thresholds, both MEASURED off a real
    // `setup` — they used to be `129` and `69` typed into this file and into two
    // others, which is how a board constant ends up with three copies.
    const z = setup({ players: ['p1', 'p2'], names: { p1: 'a', p2: 'b' }, cards, seed: 1, ...decksOf(cards) });
    expect(z.zones.reduce((k, zone) => k + zone.areas.length, 0)).toBe(BOARD.areas);
    expect(z.zones.reduce((k, zone) => k + zone.majority, 0)).toBe(BOARD.majorityPegs);
    // The one number the winnability claim is measured against, as a relation: nine
    // majorities must be reachable, or the game cannot be won by majority at all.
    expect(BOARD.majorityPegs, 'nine majorities need more pegs than the board has areas').toBeLessThan(BOARD.areas);
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
    const h = await startHarness({ dispatchRate: 4000, messageRate: 4000 });
    try {
      expect(Object.keys(h.ctx.cards.ideology)).toHaveLength(dealt.ideology);
      expect(Object.keys(h.ctx.cards.voter)).toHaveLength(dealt.voter);
      expect(Object.keys(h.ctx.cards.conspiracy)).toHaveLength(dealt.conspiracy);
      expect(Object.keys(h.ctx.cards.headline)).toHaveLength(dealt.headline);
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

  it('a game driven on the shipped corpus REACHES AN ENDING, and does not run out of Ideology Cards', () => {
    // The assertion the pre-fix engine could not have passed, whatever the deck
    // size. The bug ended every game on turn 52 with `finished: true` and no legal
    // move of any kind; the fix recycles the Ideology deck, so a shipped-corpus
    // game ends on a decided board.
    //
    // "PAST THE DECK" WAS A PROXY, AND IT IS GONE. This test used to assert
    // `turn > dealt.ideology` — the deck is drawn one per turn, so a deck of N cannot
    // reach turn N+1, therefore passing the cliff proves the recycle. That inference is
    // sound but it is only TESTABLE while the deck is shorter than a game, and the corpus
    // grew: the Ideology deck is now 76 cards and a driven game ends between turn 32 and
    // turn 84, so at 2, 3 and 4 seats no game reaches turn 77 at all. The proxy had
    // stopped asserting anything and had started demanding a longer game. What replaced
    // it is the property itself, exactly and corpus-size independently — see
    // `deckCliffComplaints` in `./corpus-facts.ts` for the whole argument.
    //
    // Five seats, because that is the configuration the playtest hit and the one
    // where the staggered start (p7) was thought to be the problem.
    const start = freshShippedCorpus(19, 5, ctx);
    const run = playInProcess(start, ctx, { maxActions: 1200 });
    expect(run.stalled, `the driver stalled: ${run.reason}`).toBe(false);
    expect(run.state.finished, 'a shipped-corpus 5-seat game did not reach an ending').toBe(true);
    expect(majoritiesOn(run.state), 'the shipped corpus did not produce a decided board').toBe(BOARD.zones);
    expect(pegsOn(run.state)).toBeGreaterThanOrEqual(BOARD.majorityPegs);
    expect(deckCliffComplaints(run.state)).toEqual([]);

    // THE VOTER DECK IS SMALLER THAN THE BOARD, so the corpus RECYCLES. This is what
    // the old "carries 36 voters" assertion was really saying, and it is checkable
    // against the game rather than against a tally: one game places more pegs than the
    // entire corpus holds voters, which is only possible because `INFLUENCE` discards
    // the card and `refillMarket` reshuffles. A fixture that deals a non-recycling deck
    // reaches a board the real game cannot, so this also keeps that possibility loud.
    expect(
      facts.voter.totalVoters,
      `the whole corpus holds ${facts.voter.totalVoters} voters and one game placed ${pegsOn(run.state)} pegs, so this game did not recycle`,
    ).toBeLessThan(pegsOn(run.state));

    // …and the mechanism, named: the recycle fired, so the deck never emptied.
    expect(
      exhaustedIdeologyDeck(run.state),
      'the game ended because the Ideology deck ran out',
    ).toBe(false);

    // The recycle itself, from PUBLIC data only.
    //
    // The first version of this assertion read the two internal Ideology piles
    // directly and summed them to the deck size. That is a stronger statement and it
    // is not available here: the server's secrets gate forbids any test but the leak
    // suite from reading a server-only field, and the gate is right — a test that
    // reads the draw pile is a test that would keep working if the pile stopped being
    // secret. So the recycle is asserted from what a client can see: the projected
    // deck sizes, and the absence of the exhaustion line in the public log.
    //
    // `deckSizes` is the DRAW PILE, not the dealt deck — a fresh `setup` deals one
    // Ideology Card into hand and puts `RULES.marketSize` Voter Cards on the Mat, so
    // it reports one fewer in each of those two. Asserted as "no larger than the dealt
    // deck", which is what a draw pile can be. This relation is corpus-size
    // independent, which is exactly what the turn-number proxy above was not — and it
    // is the reason this block survived the proxy's removal: a draw pile bigger than
    // the deck it came from is what "it recycled" looks like from outside.
    //
    // The ceiling is `dealt`, measured off `decksOf`, and there is deliberately no
    // second copy of it in this file. What is being asserted is that the draw pile
    // never exceeds the deck that was dealt — a relation between two things the engine
    // produced — so a literal here would be asserting that the engine agrees with a
    // number typed by hand, which is what turned four assertions red when G20 shipped
    // two cards and proved nothing about the game.
    const view = playerView(run.state, run.state.turnOrder[0] ?? 'p_1');
    for (const [deck, reported] of Object.entries(view.deckSizes)) {
      expect(reported, `the projected ${deck} draw pile is larger than the deck that was dealt`).toBeLessThanOrEqual(
        dealt[deck as keyof typeof dealt],
      );
      expect(reported, `the projected ${deck} draw pile is negative`).toBeGreaterThanOrEqual(0);
    }
  });

  it('the driver actually answers the effect-generated choices the synthetic corpus hid', () => {
    // The driver is exercised by the game above, and this asserts it met the
    // decisions the synthetic corpus could never produce. Without this, a driver
    // that quietly degraded to "answer side 0 and hope" would still pass the
    // winnability tests at a seat count where the headlines happened to be benign.
    //
    // WHY A SEED RANGE AND NOT ONE SEED — G20
    //
    // This used to play seed 3 at all four seat counts and assert the union covered
    // all five kinds. It passed, and then G20 added two Conspiracy Cards and it
    // failed, because the decks share one shuffle stream: adding two cards to the
    // Conspiracy pile moves every subsequent draw, so the whole game plays
    // differently and seed 3 stopped producing `discard-voter` and `steal-any` at
    // EVERY seat count. Nothing was wrong with the driver and nothing was wrong with
    // the corpus — the fixture was one shuffle's luck, sampled once.
    //
    // That is the failure mode this file exists to prevent, wearing the costume of a
    // passing test: an assertion whose subject is "the driver handles every kind"
    // quietly narrowed to "one seed's headlines happened to raise three of them".
    // So the sweep is a RANGE, and the claim is per seat count rather than over the
    // union — a corpus change that stops raising a kind at 2 seats now says so,
    // instead of being masked by 4 seats raising it.
    //
    // **THE LIST IS NOW THE COMPLETE SET, which it was not until 2026-10-04.** It named
    // five kinds and three had shipped since it was written — G16's `choose-zone` is not
    // raised by the shipped corpus at all (no shipped card names a constituency, so it
    // stays out), but G1's `choose-player`, the `convert-voter` decision and G1's
    // `choose-peg-dest` all are. A guard that lists five of eight is not a weaker version
    // of this claim, it is a different claim: it says "the driver handles the kinds I
    // remembered", which is the exact failure the paragraph above describes. Measured
    // over seeds 1..5 at each seat count, all three are raised at ALL FOUR seat counts, so
    // adding them costs nothing and the list now says what it means.
    // **THE RANGE IS NOW SEEDS 1..12, which `hl-et2040-027` is why.** Adding that
    // headline (BLESSINGS OF PARENTS PAST, REF 4.1) moved the shared shuffle stream
    // again — the same paragraph above, one corpus addition later — and `convert-voter`
    // fell out of reach at TWO seats within seeds 1..5, even though it is still raised
    // at 3, 4 and 5. Measured rather than guessed: over seeds 1..12 `convert-voter` is
    // raised at seeds 6, 8, 10, 11 and 12 at EVERY seat count. So the width moved
    // instead of the list, which is the remedy this file already documents for exactly
    // this event.
    //
    // **WIDENING IS NOT WEAKENING, and the per-seat-count claim is why.** The loop
    // asserts each kind at each seat count over the union of the range, so it still
    // fails the moment a kind stops being raisable AT THAT SEAT COUNT — 12 seeds cannot
    // mask a 2-seat regression the way an over-the-union claim would. It demands more
    // of the driver than five seeds did, not less. The alternative, dropping
    // `convert-voter` from KINDS, would have been the real weakening: it would have
    // turned "the driver handles every kind the corpus can raise" into "the driver
    // handles the kinds seeds 1-5 happened to raise".
    const KINDS = [
      'evict-voter',
      'discard-voter',
      'convert-voter',
      'steal-any',
      'lose-any',
      'gain-any',
      'choose-player',
      'choose-peg-dest',
    ];
    //
    // **THE RANGE IS NOW SEEDS 1..15, and nine filed X-cards are why.** Filing DEEP
    // THOUGHTS, LAB-GROWN EARWORM, THE GRETA EFFECT (Conspiracy) and POLO RETREAT,
    // SUBMERGED, A COWARD OR A JOURNALIST?, CARD GAMES, SNOOP B-O-DOUBLE-T, THE BIG
    // FREEZE (Headline) moved the shared shuffle stream again — the same paragraph
    // above, one corpus addition later — and `choose-peg-dest` fell out of reach
    // at FIVE seats inside seeds 1..12, even though it is still raised at 2, 3 and 4.
    // Measured rather than guessed, at every seat count over seeds 1..40: `choose-peg-dest`
    // is raised at seeds 5/15/18/20/22/34/38 (2 seats), 5/15/18/20/22/28/34/38 (3),
    // 5/15/20/22/34/38 (4) and 15/18/34/38 (5), so 15 is the first width at which every
    // one of the eight kinds is reached at ALL FOUR seat counts. The width moved instead
    // of the list, which is the remedy this file already documents for exactly this event.
    const SEEDS = Array.from({ length: 15 }, (_, i) => i + 1);
    for (const n of [2, 3, 4, 5]) {
      const kinds = new Set<string>();
      for (const seed of SEEDS) {
        const run = playInProcess(freshShippedCorpus(seed, n, ctx), ctx, { maxActions: 1200 });
        expect(run.state.finished, `${n} seats, seed ${seed} did not finish: ${run.reason}`).toBe(true);
        for (const k of run.choiceKinds) kinds.add(k);
      }
      // `evict-voter`, `discard-voter` and `steal-any` are the three that freeze a
      // player. The synthetic corpus produced NONE of them.
      for (const k of KINDS) {
        expect(kinds.has(k), `the driver never met a \`${k}\` decision at ${n} seats across seeds ${SEEDS.join('/')}`).toBe(true);
      }
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
    // The deck arrays are stable, ordered and disjoint — `decksOf` reads
    // `Object.keys`, so this is file order, and the seed does the shuffling. An
    // unstable order would silently break replay after a restart.
    expect(new Set([...d.ideologyDeck, ...d.voterDeck, ...d.conspiracyDeck, ...d.headlineDeck]).size).toBe(
      dealtTotal,
    );
    // …and every id in them resolves to a real card, so a deck array can never name
    // something the reducer would refuse. Read through the PROJECTION, because the
    // internal piles are server-only and the secrets gate is right about that.
    //
    // `deckSizes` is the DRAW PILE, so it is the dealt deck less what `setup` put into
    // hand and onto the Mat: one Ideology Card and `RULES.marketSize` Voter Cards.
    const view = playerView(fresh, 'p1');
    expect(view.deckSizes, 'the projection does not report the deck sizes').toEqual({
      ideology: dealt.ideology - 1,
      voter: dealt.voter - RULES.marketSize,
      conspiracy: dealt.conspiracy,
      headline: dealt.headline,
    });
    expect(view.awaitingAnswer, 'a fresh setup should be awaiting an answer').toBe(true);
  });
});
