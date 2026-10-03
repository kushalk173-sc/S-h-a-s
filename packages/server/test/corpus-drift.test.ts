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
 * GENDER TROUBLE, as this suite would see it: the first Headline Card whose effect op
 * is `restrict`. `'no-power'` is the kind the engine's `Restriction` union names for
 * it, and no shipped headline uses the op at all — which is the whole reason the op
 * count moved.
 *
 * This is a TEST-ONLY corpus. It is never written to disk and never booted; it exists
 * so "the corpus grew" is a thing the suite can do rather than a thing that only
 * happens between releases.
 */
function withRestrictHeadline(cards: CardIndex): CardIndex {
  const effect: Effect = { op: 'restrict', kind: 'no-power', value: 0, until: 'next-turn' };
  const card: HeadlineCard = {
    id: 'hl-test-gender-trouble',
    name: 'GENDER TROUBLE (test-only stand-in)',
    text: 'Test-only. Stands in for the first `restrict` headline.',
    effects: [effect],
  };
  return { ...cards, headline: { ...cards.headline, [card.id]: card } };
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
  it('a headline carrying a brand-NEW effect op keeps every corpus invariant', () => {
    // THE REGRESSION TEST FOR GENDER TROUBLE'S BLOCKER, and the reason the old
    // `toBe(12)` had to go rather than be bumped to 13.
    //
    // Bumping it to 13 would have been the same mistake wearing a different number:
    // it fixes the card that happened to be in flight and leaves the next one blocked.
    // Asserting "the corpus exercises strictly more of the effect vocabulary than the
    // synthetic fixture" is true of 12 ops and of 13 and of 20, and stops being true
    // only if the corpus goes flat — which is the failure the count was invented to
    // catch.
    const grown = factsOf(withRestrictHeadline(shipped));
    const base = factsOf(shipped);

    // The card is really in, really new, and really a new op.
    expect(grown.dealt.headline).toBe(base.dealt.headline + 1);
    expect(grown.headlineOps.has('restrict'), 'the fixture failed to add a new op').toBe(true);
    expect(grown.headlineOps.size, `the new op did not register: ${[...grown.headlineOps].join(',')}`).toBe(
      base.headlineOps.size + 1,
    );
    expect(base.headlineOps.has('restrict'), 'a shipped headline already uses `restrict`; the fixture proves nothing').toBe(
      false,
    );

    // And nothing that is a corpus fact went red.
    expect(corpusProblems(grown)).toEqual([]);
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
