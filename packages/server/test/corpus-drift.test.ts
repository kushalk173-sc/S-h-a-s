/**
 * THE GUARD AGAINST THE CLASS OF FAILURE `corpus.test.ts` used to be.
 *
 * THE FAILURE, NAMED — twice, and the second time it cost a real card
 *
 * 1. On 2026-10-01 the engine's game-loop fixtures all dealt 4000 synthetic Ideology
 *    Cards and the server's dealt 240. The number that decides whether a game is
 *    winnable is the shipped Ideology deck, drawn one per turn, and no test was
 *    within 4x of it — so no test could reach the bug where `ANSWER` never discarded
 *    the answered card and every game ended on turn 52 with 0 of 9 zones decided.
 *    The same project, one layer down: `corpus.test.ts` pinned the deck sizes as
 *    literals, so every card the corpus gained turned it red, and the repair each time
 *    was to edit the number until it agreed with whatever the code now did — once from
 *    22 to 24, by arithmetic rather than by measurement.
 *
 * 2. GENDER TROUBLE is the first headline whose effect op is `restrict`. It is fully
 *    implemented, fully expressible, and unshippable, because `expect(ops.size)
 *    .toBe(12)` turned into 13 the moment it landed. A parallel agent's first move was
 *    to try to make the number go back down — including by retiring an unrelated
 *    `inferred` placeholder card — which is the exact shape of the first failure: the
 *    suite pressures the corpus to match the test.
 *
 * So there are two halves here, and both are needed.
 *
 *  A. BEHAVIOURAL. `factsOf` takes a `CardIndex` as an argument, so a corpus with a
 *     card ADDED can be put through the identical invariant check. The first test
 *     below grows the corpus by exactly the card that was blocked — a headline
 *     carrying `restrict` — and asserts that every invariant still holds and that the
 *     headline op count really did go up. That is GENDER TROUBLE's blocker, frozen as
 *     a regression test: if a future corpus fact goes back to being a literal, this
 *     is the assertion that starts failing, and the message says which number.
 *
 *  B. SYNTACTIC. A. only covers the invariants that happen to live in `corpusProblems`
 *     today. A number re-typed into some other file — `SHIPPED_IDEOLOGY = 52` in
 *     `winnable.test.ts`, `toBeGreaterThan(52)` in `interrupt-window.test.ts`, the
 *     129/69 that were each written down twice — is invisible to A, and it is how the
 *     same fact ends up with three copies that disagree. So the last test reads this
 *     suite's own source and fails on a bare numeric literal compared against a corpus
 *     noun, with an explicit allow-list for the ones that are RULES (nine zones, p10's
 *     three voter counts) rather than corpus facts. An allow-list entry has to say why,
 *     which is the point: "this number is a rule" is a claim a reader can check, and
 *     "this number matched on Tuesday" is not.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { CardIndex, Effect, HeadlineCard, IdeologyCard, VoterCard, ConspiracyCard } from '@shasn/engine';

import { loadCards } from '../src/index.ts';
import { corpusProblems, factsOf, syntheticOps } from './corpus-facts.ts';

const shipped = loadCards();

// ───────────────────────────── A. the corpus may grow ─────────────────────────────

/**
 * EVERY op in `Effect['op']`, each with the smallest legal effect that uses it.
 *
 * A transcription, and it says so: `Effect` is a type, so there is no runtime list to
 * read. What keeps it honest is `expectMinimalEffectTableIsCurrent`, which asserts that
 * every op the SHIPPED corpus uses appears here — so an op that lands without a row fails
 * this file with a message naming the op, instead of silently becoming an op this suite
 * has no minimal example of.
 */
const MINIMAL_EFFECT: Readonly<Record<string, Effect>> = {
  gain: { op: 'gain', res: { funds: 1 } },
  lose: { op: 'lose', res: { funds: 1 } },
  'gain-any': { op: 'gain-any', n: 1 },
  'lose-any': { op: 'lose-any', n: 1 },
  'steal-any': { op: 'steal-any', n: 1 },
  voters: { op: 'voters', n: 1 },
  evict: { op: 'evict', n: 1 },
  'discard-voter': { op: 'discard-voter', n: 1 },
  'convert-voter': { op: 'convert-voter', n: 1 },
  gerrymander: { op: 'gerrymander', n: 1 },
  discount: { op: 'discount', n: 1 },
  'draw-conspiracy': { op: 'draw-conspiracy', n: 1 },
  'refresh-market': { op: 'refresh-market' },
  restrict: { op: 'restrict', kind: 'no-power', value: 0, until: 'next-turn' },
  /**
   * G1 — the one op whose pick names a DESTINATION. `n: 1` and no `target`, which is the
   * smallest thing `applyEffect` will act on: the ask is read from `n` and `count` is
   * always 1 because the pick carries a single `(voter, area)` pair. The shipped card
   * (GREAT LEADER, BAD ECONOMY) adds `target: 'player-after'` and a `when`/`until`
   * lifetime, none of which belongs in a MINIMAL example — this table answers "can the
   * invariant checker reason about an op", not "what does the real card say".
   */
  'move-peg': { op: 'move-peg', n: 1 },
};

/**
 * One more headline, carrying an op derived from the corpus.
 *
 * This is a TEST-ONLY corpus. It is never written to disk and never booted; it exists
 * so "the corpus grew" is a thing the suite can do rather than a thing that only
 * happens between releases.
 *
 * The op is the one the deck uses LEAST, ties broken by name — derived because a
 * hardcoded op is a landmine: this fixture stood in for GENDER TROUBLE with a `restrict`
 * headline, which stopped being "an op the corpus lacks" the moment a real `restrict`
 * headline shipped. Ranking by use is stable under growth and needs no maintenance, and
 * it keeps the added card on an axis the corpus exercises least, which is where a new
 * invariant is most likely to bite.
 */
function withOneMoreHeadline(cards: CardIndex): CardIndex {
  const used = new Map<string, number>();
  for (const card of Object.values(cards.headline)) {
    for (const e of card.effects) used.set(e.op, (used.get(e.op) ?? 0) + 1);
  }
  const op = Object.keys(MINIMAL_EFFECT).sort((a, b) => {
    const byUse = (used.get(a) ?? 0) - (used.get(b) ?? 0);
    return byUse !== 0 ? byUse : a.localeCompare(b);
  })[0];
  const effect = MINIMAL_EFFECT[op as string];
  if (effect === undefined) throw new Error(`no minimal effect for ${op as string}`);
  const card: HeadlineCard = {
    id: 'hl-test-one-more',
    name: 'TEST-ONLY HEADLINE',
    text: `Test-only. Carries \`${op as string}\`, which the shipped deck uses least.`,
    effects: [effect],
  };
  return { ...cards, headline: { ...cards.headline, [card.id]: card } };
}

/**
 * `MINIMAL_EFFECT` is a transcription of `Effect['op']`, and a stale one is invisible,
 * so it is checked against the corpus on every run: an op the shipped deck uses with no
 * row here fails this, by name, rather than becoming an op this suite cannot reason
 * about. `Effect` is a type and there is no runtime list to read, which is why this is
 * an assertion and not a derivation.
 */
function expectMinimalEffectTableIsCurrent(): void {
  for (const op of factsOf(shipped).headlineOps) {
    expect(
      MINIMAL_EFFECT[op],
      `a shipped headline uses \`${op}\`, which MINIMAL_EFFECT does not carry; add a minimal effect for it`,
    ).toBeDefined();
  }
}

/** One more card in each of the other three pools, for the same reason. */
function withOneMoreOfEach(cards: CardIndex): CardIndex {
  const voter: VoterCard = { id: 'vt-test-extra', cost: { funds: 2 }, voters: 3 };
  const conspiracy: ConspiracyCard = {
    id: 'ct-test-extra',
    name: 'TEST-ONLY CONSPIRACY',
    text: 'Test-only.',
    cost: 4,
    effects: [{ op: 'gain', res: { funds: 2 } }],
  };
  const ideology: IdeologyCard = {
    id: 'id-test-extra',
    campaign: 'Test-only.',
    question: 'Test-only.',
    sides: [
      { answer: 'a', ideologue: 'capitalist', pays: { funds: 3 } },
      { answer: 'b', ideologue: 'idealist', pays: { funds: 3 } },
    ],
  };
  return {
    ideology: { ...cards.ideology, [ideology.id]: ideology },
    voter: { ...cards.voter, [voter.id]: voter },
    conspiracy: { ...cards.conspiracy, [conspiracy.id]: conspiracy },
    headline: cards.headline,
  };
}

describe('shipping a card is not a test-suite event', () => {
  it('a headline added to the deck keeps every corpus invariant', () => {
    // THE REGRESSION TEST FOR GENDER TROUBLE'S BLOCKER, and the reason the old
    // `toBe(12)` had to go rather than be bumped to 13.
    //
    // Bumping it to 13 would have been the same mistake wearing a different number: it
    // fixes the card that happened to be in flight and leaves the next one blocked.
    // Asserting "the corpus exercises strictly more of the effect vocabulary than the
    // synthetic fixture" is true of 12 ops and of 13 and of 20, and stops being true
    // only if the corpus goes flat — which is the failure the count was invented to
    // catch.
    //
    // ## AND THE OP IS DERIVED FROM THE CORPUS, WHICH IS HOW IT GOT HERE TWICE
    //
    // The fixture used to add a hardcoded `restrict` headline, on the reasoning that no
    // shipped headline used the op. GENDER TROUBLE landed and made that false, and the
    // test went red for a reason that had nothing to do with the bug it guards. So the
    // op became derived, and then the derived version failed too — correctly and with a
    // message worth having: the shipped headlines now use ALL FOURTEEN ops in
    // `Effect['op']`, so "a headline carrying an op the corpus does not have" is no
    // longer a thing this corpus can be.
    //
    // So the axis moved rather than the assertion moving. What this test actually guards
    // is that adding a card cannot turn a corpus fact red, and that claim does not need
    // a novel op: it needs a card in the deck and `corpusProblems` empty. The next test
    // is what keeps that honest — it proves the checker can still fail, which is the
    // property the op count was standing in for.
    const base = factsOf(shipped);
    expectMinimalEffectTableIsCurrent();
    const grown = factsOf(withOneMoreHeadline(shipped));

    expect(grown.dealt.headline).toBe(base.dealt.headline + 1);
    expect(grown.dealt.headline, 'the fixture headline is not in the deck it claims to grow').toBe(
      base.dealt.headline + 1,
    );
    // And nothing that is a corpus fact went red.
    expect(corpusProblems(grown)).toEqual([]);
  });

  it('and the invariant checker can still FAIL, so the test above is not vacuous', () => {
    // The claim `corpusProblems(grown) === []` is only worth anything if `corpusProblems`
    // can return something, and "the corpus grew" is exactly the condition under which a
    // checker rots into a function that always answers "fine". So it is provoked: a
    // Voter Card with FOUR voters breaks p10 outright — a zone with one slot left can
    // only be finished by a 1-voter card, so a 4-voter card makes a zone unfinishable —
    // and the checker has to say so, by name.
    //
    // This is the assertion that replaced "the op count went up". The op count was a
    // proxy for "the guard is still looking at something"; this is the thing itself, and
    // unlike the proxy it cannot be exhausted by a card landing.
    const broken = factsOf({
      ...shipped,
      voter: { ...shipped.voter, 'vt-test-four': { id: 'vt-test-four', cost: { funds: 2 }, voters: 4 } },
    });
    expect(corpusProblems(broken), 'a 4-voter card broke nothing, so corpusProblems is vacuous').not.toEqual([]);
    expect(
      corpusProblems(broken).some((p) => p.includes('4')),
      `corpusProblems did not name the four-voter card: ${corpusProblems(broken).join(' | ')}`,
    ).toBe(true);
  });

  it('one more card in each of the other three pools keeps every corpus invariant', () => {
    // The same guard for the three decks G20 and G13d grew. A corpus fact asserted as a
    // literal is the same bug four times over.
    const grown = factsOf(withOneMoreOfEach(shipped));
    const base = factsOf(shipped);
    expect(grown.dealt.ideology).toBe(base.dealt.ideology + 1);
    expect(grown.dealt.voter).toBe(base.dealt.voter + 1);
    expect(grown.dealt.conspiracy).toBe(base.dealt.conspiracy + 1);
    expect(corpusProblems(grown)).toEqual([]);
  });

  it('the deck a game is dealt IS the corpus, with nothing indexed and left out', () => {
    // The positive form of the same claim, and the assertion that replaces the old
    // `deck.length === 26` pins. Those could not tell "the corpus changed" from "the
    // test was wrong", and they were patched by arithmetic when they went red. This one
    // can only fail if the two genuinely disagree — which is the real defect: a card
    // the server indexes but never deals is a card a player can never draw.
    expect(corpusProblems(factsOf(shipped))).toEqual([]);
    expect(factsOf(shipped).headlineOps.size).toBeGreaterThan(syntheticOps().headline);
  });
});

// ───────────────────────────── B. and none of them is a literal ─────────────────────────────

/** Any of these in a line means the line is talking about the corpus or the board. */
const CORPUS_NOUN = /\b(ideology|voter|conspiracy|headline|deck|corpus|peg|majorit)/i;

/**
 * An EQUALITY against a bare literal, which is where a pinned corpus fact lives: a
 * deck size, a card count, an op count. `expect(x).toBe(26)` says "26 is the truth",
 * and 26 is only the truth until the next card ships.
 *
 * INEQUALITIES ARE NOT SCANNED, and that is a deliberate narrowing rather than an
 * oversight. In this suite an inequality is nearly always one of two things: a driver
 * budget ("implausibly many actions") or a VACUITY FLOOR — `toBeGreaterThan(0)` on a
 * count whose only job is to say "the fixture was not empty", which is a guard against
 * a test that cannot fail rather than a statement about the corpus. Scanning those
 * would produce a hundred offences and train the next reader to ignore the message,
 * which is how a real guard gets deleted.
 */
const EQUALITY = /\.\s*(?:toBe|toEqual|toHaveLength)\(\s*(-?\d+)\s*[,)]/g;

/**
 * …with ONE inequality scanned, because it is the exact shape of the bug that shipped.
 *
 * `expect(turn).toBeGreaterThan(52)` appeared in this suite twice, in two files, as a
 * hand-copy of the Ideology deck size: the turn at which the shipped game used to die
 * and the only number in the project that decides whether it can be won. A turn cliff
 * is the one threshold where "the literal happens to be right" is indistinguishable
 * from "the relation holds", so it gets scanned on its own.
 */
const CLIFF = /\.\s*toBeGreaterThan(?:OrEqual)?\(\s*(-?\d+)\s*[,)]/g;

/** A turn, a deck, or the cliff itself: what makes a threshold a corpus fact. */
const CLIFF_NOUN = /\b(turn|cliff|deck)\w*/i;

/**
 * The literals that are allowed to stay, each with the reason it is a RULE rather than
 * a footprint of today's corpus.
 *
 * `in` is matched against the statement the literal appeared in, so an entry covers a
 * claim ("this is the nine-zone board") rather than a line number, which is the only
 * kind of entry that survives a refactor. The last test below asserts every entry is
 * still USED: a list that rots silently is worse than no list, which is the argument
 * `secret-inventory.ts` makes about `SECRET_FIELDS` and it applies here too.
 */
const ALLOWED: readonly { readonly in: RegExp; readonly literal: string; readonly why: string }[] = [
  {
    in: /majorities|nineMajorities|of 9 zones|nine majorities/i,
    literal: '9',
    why: 'the board has nine zones. A rule, and `BOARD.zones` in corpus-facts is the derived copy.',
  },
  {
    in: /new Set\(|distinct/i,
    literal: '1',
    why: 'ONE DISTINCT VALUE — a uniqueness claim ("every viewer was sent the same thing"), not a count of cards. Zero and one are the two numbers that mean "none" and "no disagreement"; neither is a corpus fact.',
  },
  {
    in: /recycleWrite/,
    literal: '1',
    why: 'G17/U1. ONE WRITE SITE IN THE SOURCE — a claim about the SHAPE of `reduce.ts`, read by slicing it, and not a fact about the corpus at all. It is the uniqueness half of the writer guard in `secret-state.test.ts` ("U1\'s own write, and the only one there"), and the corpus cannot change it: adding a card does not add a branch to a `case`. The number would only move if somebody added a second silent writer, which is precisely the event the assertion exists to fail on.',
  },
  {
    in: /publicWrites/,
    literal: '2',
    why: 'G17/U1. THE TWO PUBLIC WRITER SITES — again a property of `reduce.ts`, one per action handler (`PLAY_CONSPIRACY` and `RESPOND_INTERRUPT`), not of the corpus. Neither site is reached because a card exists: both are unconditional in their handler, so the count is 2 whether the deck holds 27 Conspiracy Cards or 270.',
  },
  {
    in: /insideFieldWrites/,
    literal: '2',
    why: 'G17/U1. THE WRITES TO THE CONSPIRACY DISCARD PILE INSIDE ONE `case` — a shape claim about the reducer, read by slicing its source, and not a fact about the corpus: the two are the `pick` path\'s removal and the `from: \'discard\'` top path\'s removal, and adding a Conspiracy Card adds neither branch. It is pinned EXACTLY rather than floored on purpose, and that is the load-bearing part: with a floor, a silent writer added inside `case \'draw-conspiracy\'` — which is where the next one would be written — passes. **This was 3 until the departures were announced, and the 3 was counting a TERNARY**: the regex could not tell a property colon from a conditional expression\'s `? :`, which is a read. The property-position regex fixed it, and the docstring above the old pin had invented a third write to explain the phantom.',
  },
  {
    in: /announcedPairs/,
    literal: '2',
    why: 'G17/U1. THE DEPARTURES THAT ANNOUNCE THEMSELVES — one announcement per removal inside `case \'draw-conspiracy\'`, so the count above and this one are the same fact read twice. It is pinned because it is the whole of the fix: a card leaving a PUBLIC pile with no log line is a covert channel into a hidden hand, and the spectator who diffs two payloads can read it. Measured by mutation — silencing the announcement turns the log-replay equality in the leak tests red.',
  },
];

function testFiles(): string[] {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${dir}${f}`);
}

/** Comments carry the arguments and the rule citations, so they are not evidence. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no corpus fact in this suite is a number somebody typed', () => {
  it('no numeric expectation about the corpus or the board is a bare literal', () => {
    // THE FAILURE THIS GUARDS, restated for whoever trips it: a corpus fact asserted
    // as a literal cannot fail on the change it exists to catch. It fails on the day
    // somebody remembers to edit it — a different day from the one it is needed on —
    // and the repair teaches the test nothing, because the new number is chosen to
    // agree with whatever the code now does. That is exactly how a real, finished card
    // (GENDER TROUBLE) became unshippable: a corpus that GAINED an op turned a test red,
    // and the only available fix was to make the corpus smaller.
    const offences: string[] = [];
    const used = new Set<number>();
    function record(literal: string, chunk: string): void {
      // ZERO IS NOT A CORPUS FACT. It is "none of them", which is what a leak
      // assertion wants to say (`no viewer sees anything at this path`) and what a
      // vacuity floor wants to say (`this count was not negative`). No shipped corpus
      // fact has ever been zero, and one that became zero would be caught as an EMPTY
      // deck by `corpusProblems`, which is the assertion that means something.
      if (literal === '0') return;
      const at = ALLOWED.findIndex((a) => a.literal === literal && a.in.test(chunk));
      if (at < 0) offences.push(`${literal} — ${oneLine(chunk)}`);
      else used.add(at);
    }
    for (const file of testFiles()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      // Split on `;` so a multi-line `expect(...)` is read as one statement. Crude, and
      // deliberately so: it needs no parser and it does not care how the call is wrapped.
      for (const chunk of src.split(';')) {
        if (!chunk.includes('expect(')) continue;
        if (!CORPUS_NOUN.test(chunk)) continue;
        for (const m of chunk.matchAll(EQUALITY)) record(m[1] ?? '', chunk);
        if (CLIFF_NOUN.test(chunk)) {
          for (const m of chunk.matchAll(CLIFF)) {
            // A cliff of 0 or 1 is a vacuity floor, not a corpus fact.
            if (Number(m[1]) > 1) record(m[1] ?? '', chunk);
          }
        }
      }
    }
    expect(
      offences,
      `these compare a corpus fact to a literal. Derive it from corpus-facts.ts (factsOf / BOARD), or argue that it is a RULE and record it in ALLOWED. The historical failure: a literal deck size that had to be patched 22 -> 24 by arithmetic, and a \`restrict\` headline that could not ship because \`ops.size\` was pinned to 12.\n${offences.join('\n')}`,
    ).toEqual([]);

    // The allow-list is itself checked, so it cannot rot into a permission slip.
    const stale = ALLOWED.flatMap((a, i) => (used.has(i) ? [] : [`${a.literal} / ${a.in} is never matched`]));
    expect(stale, `an ALLOWED entry no longer matches anything: ${stale.join('; ')}`).toEqual([]);
  });

  it('no module-level constant holds a corpus fact as a number', () => {
    // The other half, and the one that actually bit: `SHIPPED_IDEOLOGY = 52` in
    // `winnable.test.ts` was a hand-copy of a fact that also existed, differently, in
    // `corpus.test.ts` and `interrupt-window.test.ts`. Three copies, and the first
    // corpus growth would have left two of them quietly wrong unless somebody noticed.
    const NAME = /^(?:SHIPPED|SHIPPED_[A-Z0-9_]*|[A-Z0-9_]*(?:DECK_SIZE|CARD_COUNT|DECK_COUNT|CARDS_SHIPPED|CORPUS_SIZE|OP_COUNT|MAJORITY_PEGS|FULL_BOARD)[A-Z0-9_]*)\s*(?::[^=]+)?=\s*(?!.*\bfactsOf\b)/;
    const NUMERIC = /^(-?\d+)\s*(?:as const)?\s*;?\s*$/;
    const offences: string[] = [];
    for (const file of testFiles()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(new RegExp(`const\\s+(${NAME.source})`, 'gm'))) {
        const tail = src.slice(m.index + m[0].length).split('\n')[0] ?? '';
        const literal = tail.match(NUMERIC);
        if (literal) offences.push(`${file}: ${m[0].trim()} ${literal[1]}`);
      }
    }
    expect(
      offences,
      `a corpus fact is pinned in a constant. Derive it: \`const CLIFF = factsOf(cards).dealt.ideology\`. ${offences.join('; ')}`,
    ).toEqual([]);
  });
});

function oneLine(chunk: string): string {
  const s = chunk.replace(/\s+/g, ' ').trim();
  return s.length > 110 ? `${s.slice(0, 110)}…` : s;
}
