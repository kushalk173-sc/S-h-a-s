/**
 * THE HONESTY TEST: no shipped card may describe behaviour `reduce()` does not
 * perform.
 *
 * Three layers, each of which fails loudly rather than silently:
 *
 *  1. `EXECUTED_OPS` in `src/executable.ts` is re-derived here by reading
 *     `packages/engine/src/reduce.ts` and pulling the `case '…':` arms out of
 *     `applyEffect`. If the reducer grows or loses an op, this test fails before
 *     any card can use the difference.
 *  2. The same source is used to check the FIELD list per op — `target` is read in
 *     five cases and ignored in the other eight, which is invisible from the type
 *     and is exactly how a card ends up reading as if it did something to every
 *     player while doing it to one.
 *  3. The shipped corpus is walked. Every effect on every Conspiracy and Headline
 *     Card must be fully executable. This is the layer the brief asks for, and it
 *     runs over the real deck files, not over a fixture.
 *
 * Layer 3 is duplicated, deliberately, by `validateCorpus()` — which runs in
 * `npm run validate`. A card that slips in fails the test suite AND the CI gate,
 * and neither failure can be satisfied by editing the check itself: the registry
 * is compared against the reducer's own source text.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DECK_IDS,
  loadConspiracyDeck,
  loadCorpus,
  loadHeadlineDeck,
  loadIdeologyDeck,
  loadVoterDeck,
  type AnyCorpusCard,
} from '../src/corpus.js';
import {
  EFFECT_OPS,
  EFFECT_OP_SET,
  INTERRUPT_OPS,
  INTERRUPT_TARGETS,
  INTERRUPT_WINDOWS,
} from '../src/effect-ops.js';
import {
  EXECUTED_OPS,
  EXECUTABLE_COMPUTED_SOURCES,
  EXECUTED_INTERRUPT_OPS,
  EXECUTED_INTERRUPT_TARGETS,
  EXECUTED_INTERRUPT_WINDOWS,
  EXECUTABLE_TRIGGERS,
  INTERRUPT_FIX,
  SCOPE_FIELDS_READ_BY_INSTALL,
  unexecutedCardProblems,
  unexecutedEffectProblems,
  unexecutedInterruptProblems,
} from '../src/executable.js';
import { validateEffect, validateDeckFile, corpusSchema, type SchemaProblem } from '../src/schema.js';
import { validateCorpus, validateDecks, shippedDeckInputs, type DeckInput } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REDUCE_SRC = resolve(HERE, '..', '..', 'engine', 'src', 'reduce.ts');
const FILE = 'decks/fixture/fixture.json';

/**
 * The `case` arms of `applyEffect`, keyed by op.
 *
 * Deliberately a text read rather than an import: `reduce()` is not a pure
 * function of a card, and the point of this file is to check the ENGINE SOURCE, so
 * the engine source is what it looks at. A missing arm and an added arm both show
 * up as a diff against `EXECUTED_OPS`.
 */
function reducerCaseBodies(): Record<string, string> {
  const src = readFileSync(REDUCE_SRC, 'utf8');
  const start = src.indexOf('function applyEffect');
  expect(start, 'reduce.ts still has applyEffect').toBeGreaterThan(-1);
  const end = src.indexOf('function applyEffects', start);
  const body = src.slice(start, end === -1 ? undefined : end);

  const out: Record<string, string> = {};
  const re = /^ {4}case '([^']+)':/gm;
  const marks: { op: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) marks.push({ op: m[1], at: m.index });
  }
  marks.forEach((mark, i) => {
    const next = marks[i + 1];
    out[mark.op] = body.slice(mark.at, next ? next.at : body.length);
  });
  return out;
}

const CASES = reducerCaseBodies();

/**
 * The scope fields `installLiveEffects` reads, re-derived from ITS OWN source text.
 *
 * The same reasoning as `reducerCaseBodies`, applied to the second honesty seam.
 * `when`, `until` and `condition` are not read by `applyEffect` — they are read one
 * function above it, by the installer that decides what LINGERS — so slicing
 * `applyEffect` cannot see them at all. Without this slice the registry entry for
 * them would be an unfalsifiable claim, which is the one thing this file exists to
 * prevent.
 */
function installerSource(): string {
  const src = readFileSync(REDUCE_SRC, 'utf8');
  const start = src.indexOf('function installLiveEffects');
  expect(start, 'reduce.ts still has installLiveEffects').toBeGreaterThan(-1);
  const end = src.indexOf('function pushLiveEffect', start);
  return src.slice(start, end === -1 ? undefined : end);
}

const INSTALLER = installerSource();

/**
 * The trigger values the reducer RAISES, re-derived from its own source.
 *
 * The registry `EXECUTED_TRIGGERS` is a list of promises about `reduce()`, and a
 * promise nobody checks is the thing this whole file was written to stop. Each
 * value must appear as a `trigger: '<value>'` in a raise site, and every raise site
 * must be in the registry. A `when` the reducer never raises installs a hook that
 * never fires — the card reads as though something happens on every purchase and
 * nothing ever happens.
 */
function raisedTriggers(): string[] {
  const src = readFileSync(REDUCE_SRC, 'utf8');
  const out = new Set<string>();
  const re = /trigger: '([a-z-]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) out.add(m[1]);
  }
  return [...out].sort();
}


// ─────────────────────────── layer 1: the op set ───────────────────────────

describe('EXECUTED_OPS is exactly what reduce() has a case for', () => {
  it('every declared op has a case, and every case has a declared op', () => {
    expect(Object.keys(EXECUTED_OPS).slice().sort()).toEqual(Object.keys(CASES).sort());
  });

  it('and it is the same op list as Effect and as the schema', () => {
    expect(Object.keys(EXECUTED_OPS).slice().sort()).toEqual([...EFFECT_OPS].slice().sort());
  });

  it('reduces the corpus to the same set (a card cannot use an op outside it)', () => {
    const corpus = loadCorpus(DECK_IDS);
    const used = new Set<string>();
    for (const card of [...corpus.conspiracy, ...corpus.headline]) {
      for (const effect of card.effects) used.add(effect.op);
    }
    for (const op of used) {
      expect(EXECUTED_OPS[op as keyof typeof EXECUTED_OPS], op).toBeDefined();
    }
  });
});

// ─────────────────────────── layer 2: the field set ───────────────────────────

describe('EXECUTED_OPS says which fields each case reads, and that is true', () => {
  it('`target` is read exactly where the registry claims it is', () => {
    const readsTarget = Object.entries(EXECUTED_OPS)
      .filter(([, reads]) => reads.includes('target'))
      .map(([op]) => op)
      .sort();
    const sourceMentionsTarget = Object.entries(CASES)
      .filter(([, body]) => /\btarget\b/.test(body))
      .map(([op]) => op)
      .sort();
    expect(sourceMentionsTarget).toEqual(readsTarget);
  });

  it('`n` is read exactly where the registry claims it is', () => {
    for (const [op, body] of Object.entries(CASES)) {
      const readsN = (EXECUTED_OPS as Record<string, readonly string[]>)[op]?.includes('n') ?? false;
      expect(/\beffect\.n\b/.test(body), `${op} reads effect.n`).toBe(readsN);
    }
  });

  it('`per` is read exactly where the registry claims it is, and that is gain and lose only', () => {
    // G15/G4. `per` multiplies a `res`, so only the two resource-shaped ops can
    // honour it, and registering it anywhere else would be a claim the reducer does
    // not back. Derived from the source, like `n` and `res`.
    for (const [op, body] of Object.entries(CASES)) {
      const readsPer = (EXECUTED_OPS as Record<string, readonly string[]>)[op]?.includes('per') ?? false;
      expect(/\beffect\.per\b/.test(body), `${op} reads effect.per`).toBe(readsPer);
    }
  });

  it('and both of them resolve the value BEFORE constructing anything from it', () => {
    // The invariant that makes widening `n` to `Count` safe. `Choice.count` is still
    // a `number` where it is built, so a computed value cannot reach the engine as
    // one — which is the guarantee KNOWN-GAPS G15 originally wanted from the type
    // system and now gets from the reducer instead.
    for (const op of ['gain-any', 'lose-any', 'steal-any', 'voters', 'discount', 'gerrymander'] as const) {
      const body = CASES[op];
      expect(body, op).toBeDefined();
      expect(
        /\bresolveCount\(/.test(body ?? ''),
        `${op} resolves a computed n before using it`,
      ).toBe(true);
      // And never the raw `effect.n` inside a count or a bound.
      expect(/count: effect\.n/.test(body ?? ''), `${op} does not push effect.n raw`).toBe(false);
    }
  });

  it('`res` is read exactly where the registry claims it is', () => {
    for (const [op, body] of Object.entries(CASES)) {
      const readsRes = (EXECUTED_OPS as Record<string, readonly string[]>)[op]?.includes('res') ?? false;
      expect(/\beffect\.res\b/.test(body), `${op} reads effect.res`).toBe(readsRes);
    }
  });

  it('`from` is read exactly where the registry claims it is', () => {
    // G17. `draw-conspiracy.from` is the discard-pile reach (SELECTIVE ACCESS MEMORY),
    // and it is the only op with one — so the check has to be derived from the source
    // like `n` and `res` are, not asserted once.
    for (const [op, body] of Object.entries(CASES)) {
      const readsFrom = (EXECUTED_OPS as Record<string, readonly string[]>)[op]?.includes('from') ?? false;
      expect(/\beffect\.from\b/.test(body), `${op} reads effect.from`).toBe(readsFrom);
    }
  });

  it('and every field the registry claims for an op is one the case reads', () => {
    // The generic form of the three checks above, so a NEW field on an op cannot be
    // registered without the case reading it. `target` is matched as a bare word
    // because `applyEffect` computes it once, above the switch, and every targetable
    // case consumes that local.
    for (const [op, reads] of Object.entries(EXECUTED_OPS)) {
      const body = CASES[op];
      if (body === undefined) throw new Error(`no case body for ${op}`);
      for (const field of reads) {
        const re = field === 'target' ? /\btarget\b/ : new RegExp(`\\beffect\\.${field}\\b`);
        expect(re.test(body), `${op} reads effect.${field}`).toBe(true);
      }
    }
  });
});

// ─────────────────────── layer 2b: the installer, the second seam ───────────────────────

describe('SCOPE_FIELDS_READ_BY_INSTALL is what installLiveEffects actually reads', () => {
  it('every scope field the registry claims is read by the installer', () => {
    for (const field of SCOPE_FIELDS_READ_BY_INSTALL) {
      expect(
        new RegExp(`\\beffect\\.${field}\\b`).test(INSTALLER),
        `installLiveEffects reads effect.${field}`,
      ).toBe(true);
    }
  });

  it('and the list is not empty, so the seam cannot be satisfied by asserting nothing', () => {
    // The same guard as `PRIVATE_PLAYER_KEYS is not empty`. An empty registry would
    // make every assertion below vacuously true and the seam decorative.
    expect(SCOPE_FIELDS_READ_BY_INSTALL.length).toBeGreaterThan(0);
  });

  it('none of them is claimed by an op registry, so the two lists cannot disagree', () => {
    // `EXECUTED_OPS` is asserted against `applyEffect`'s text; the scope list is
    // asserted against the installer's. A field appearing in both would mean two
    // registries claiming one read, and the validator would then be checking it
    // twice against two different oracles.
    for (const reads of Object.values(EXECUTED_OPS)) {
      for (const field of reads) {
        expect(SCOPE_FIELDS_READ_BY_INSTALL).not.toContain(field);
      }
    }
  });
});

describe('EXECUTED_TRIGGERS is exactly the set of events reduce() raises', () => {
  it('every claimed trigger has a raise site in reduce.ts, and every raise site is claimed', () => {
    expect([...EXECUTABLE_TRIGGERS].sort()).toEqual(raisedTriggers());
  });

  it('so the whole enum is executable and no shipped card can name an unraised event', () => {
    // Which means the refusal branch in `unexecutedEffectProblems` is now reachable
    // only by a hand-built effect — the JSON Schema's `effectTrigger` enum and the
    // reducer's raise sites are asserted to be the same list, from both sides. The
    // day they diverge, the divergence is a card that ships and never fires.
    const schemaTriggers = (corpusSchema().$defs as Record<string, { enum?: readonly string[] }>)
      .effectTrigger?.enum;
    expect([...(schemaTriggers ?? [])].sort()).toEqual(raisedTriggers());
    for (const trigger of raisedTriggers()) {
      expect(codes(findingsForEffect({ op: 'voters', n: 1, when: trigger })), trigger).toEqual([]);
    }
  });

  it('and an unraised trigger is still refused, for anyone who hand-builds an effect', () => {
    // Unreachable through the schema, which is the point of the case above — but
    // `unexecutedEffectProblems` is public and a `CardIndex` is hand-buildable, so
    // the refusal has to exist rather than being assumed away by an enum.
    const problems = unexecutedEffectProblems({ op: 'voters', n: 1, when: 'on-a-deal' }, '');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('never fire');
  });
});

// ─────────────────────────── layer 3: the corpus ───────────────────────────

describe('no shipped card uses an effect the reducer cannot execute', () => {
  const corpus = loadCorpus(DECK_IDS);

  /**
   * Every shipped card, in one list, from the decks rather than from a hand-picked
   * pair of kinds.
   *
   * The walk below used to read `[...corpus.conspiracy, ...corpus.headline]`, which
   * is 48 of the 118 cards and is right for the EFFECT vocabulary -- Ideology and
   * Voter Cards have no `effects` array, so there is no op for the registry to rule
   * on. But "the walk covers the X-cards" is a claim about a list comprehension in a
   * test, and a list comprehension that grew a `.slice()` would still read as
   * exhaustive. So the walk is now over all four kinds and its size is asserted
   * against the decks.
   *
   * What this layer does NOT claim: that an Ideology Card's question and its two
   * payouts are honest. That is a different invariant with a different oracle --
   * `validateIdeologySide` for the Ideologue/Resource pairing and `balance.ts` for
   * the lean -- and it is asserted by `validateCorpus()` in the last case of this
   * block, which walks the same 118 cards. Stating the boundary is the point: a
   * coverage claim that quietly covered less than it said is the failure this file
   * exists to prevent.
   */
  const allCards: readonly AnyCorpusCard[] = [
    ...corpus.ideology,
    ...corpus.voter,
    ...corpus.conspiracy,
    ...corpus.headline,
  ];

  it('the walk is exhaustive, and knows it without a hardcoded count', () => {
    // Derived from the decks by the same path `loadCorpus` takes, so a corpus that
    // grows does not break this and a card that escapes the walk does.
    const shipped =
      DECK_IDS.flatMap((d) => loadIdeologyDeck(d)).length +
      DECK_IDS.flatMap((d) => loadVoterDeck(d)).length +
      DECK_IDS.flatMap((d) => loadConspiracyDeck(d)).length +
      DECK_IDS.flatMap((d) => loadHeadlineDeck(d)).length;
    expect(allCards.length).toBe(shipped);

    // And all four kinds are actually in `allCards`, not three and a zero: a kind
    // dropped from the spread above would show up here as a missing bucket.
    for (const kind of ['ideology', 'voter', 'conspiracy', 'headline'] as const) {
      expect(corpus[kind].length, kind).toBeGreaterThan(0);
    }
    expect(allCards.length).toBe(
      corpus.ideology.length +
        corpus.voter.length +
        corpus.conspiracy.length +
        corpus.headline.length,
    );
  });

  it('every one of them is fully executable', () => {
    // Run over ALL kinds, not just the two that carry `effects`. For the other two
    // the honest answer is `[]` -- they have no effect list and no duration/timing/
    // interrupt, so the registry has nothing to rule on -- and running them anyway
    // means a future Ideology Card that grows a `duration` is caught by this layer
    // rather than only by `validateCorpus`.
    const offenders: string[] = [];
    for (const card of allCards) {
      const problems = unexecutedCardProblems(card, '');
      for (const p of problems) offenders.push(`${card.id} ${p.pointer}: ${p.message}`);
    }
    expect(offenders).toEqual([]);
  });

  it('and no card of any kind carries a reserved duration / timing / UNEXECUTED interrupt', () => {
    // Previously scoped to the X-cards only. Ideology and Voter Cards have no such
    // field in the schema today, so this cannot fail yet -- which is exactly why it
    // belongs here: it is the assertion that stops it starting.
    //
    // `interrupt` is the ONE field on this list that is now legal, and only for the two
    // ops `reduce()` performs: `block` and `deflect` went from inert to executed with
    // G13's phase machine, and BLOCK and DEFLECT ship as `ct-et2040-014` /
    // `ct-et2040-015`. So the ban is narrowed rather than lifted, and the two card ids are
    // PINNED: a third card carrying an interrupt, or one of these two carrying a different
    // op, is a change somebody has to make on purpose and say so here. `duration`,
    // `timing` and `auction` / `vote` / `pass-card` remain refused, and
    // `unexecutedCardProblems` above is what says so over every card rather than over
    // this list.
    const executed: string[] = [];
    for (const card of allCards) {
      expect((card as { duration?: string }).duration ?? 'this-turn', `${card.id} duration`).toBe('this-turn');
      expect('timing' in card, `${card.id} timing`).toBe(false);
      if (!('interrupt' in card)) continue;
      const op = (card as { readonly interrupt?: { readonly op?: string } }).interrupt?.op;
      if (op === 'block' || op === 'deflect') {
        executed.push(card.id);
        continue;
      }
      expect(`interrupt op ${String(op)} on ${card.id}`, 'only block and deflect are executed').toBe(false);
    }
    expect(
      executed.sort(),
      'the set of shipped cards carrying an executed interrupt is not the two that ship',
    ).toEqual(['ct-et2040-014', 'ct-et2040-015']);
  });

  it('the CI gate agrees with the test, over the same 118 cards', () => {
    // Same corpus, different entry point. If these two ever disagree, the one that
    // matters is the stricter — so make both fail rather than choosing. The count is
    // carried alongside so a validator that silently stopped walking a deck is
    // visible here rather than as a mysteriously smaller report.
    const report = validateCorpus();
    expect(report.errors.map((f) => `${f.code} ${f.cardId ?? ''} ${f.message}`)).toEqual([]);
    expect(report.counts.total).toBe(allCards.length);
  });
});

// ─────────────────────────── the new shapes, accepted and rejected ───────────────────────────

/**
 * Validate the shipped decks with one Headline Card replaced.
 *
 * Reuses a real card so that everything except the field under test is already
 * known-good, which keeps each assertion about exactly one thing.
 */
function validateWithHeadline(headline: Record<string, unknown>) {
  const inputs: DeckInput[] = [...shippedDeckInputs()];
  const index = inputs.findIndex((i) => i.kind === 'headline' && i.deck === 'et2040');
  if (index < 0) throw new Error('no et2040 headline deck file');
  const original = inputs[index]!.data as { cards: Record<string, unknown>[] };
  inputs[index]!.data = { ...original, cards: [headline] };
  return validateDecks(inputs);
}

function baseHeadline(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'hl-et2040-001',
    source: 'original; register per REF 8.2',
    provenance: 'inferred',
    name: 'A Fixture Headline',
    text: 'A rules text long enough to clear the schema minimum length.',
    effects: [{ op: 'voters', n: 1 }],
    ...overrides,
  };
}

/** Findings for one effect, with the card otherwise valid. */
function findingsForEffect(effect: Record<string, unknown>) {
  return validateWithHeadline(baseHeadline({ effects: [effect] }));
}

function codes(report: { errors: readonly { code: string }[] }): string[] {
  return report.errors.map((e) => e.code);
}

/** The same, for a bare list of `ExecutionProblem` rather than a validator report. */
function codesOf(problems: readonly { readonly code: string }[]): string[] {
  return problems.map((p) => p.code);
}

describe('G8 — target on gerrymander, closed on the reducer', () => {
  it('the case now honours every EffectTarget, so no value is special-cased', () => {
    for (const target of ['you', 'each-opponent', 'everyone', 'leader'] as const) {
      expect(codes(findingsForEffect({ op: 'gerrymander', n: 1, target })), target).toEqual([]);
    }
    // …and with no `target` at all, which is the same as 'you'.
    expect(codes(findingsForEffect({ op: 'gerrymander', n: 1 }))).toEqual([]);
  });

  it('so the registry keeps no "executable only when" escape for this op', () => {
    // The mechanism survives as an empty table on purpose: an op whose case honours
    // `target` at exactly one value would be listed here, and the validator would
    // refuse the rest. Nothing is listed, because nothing is special-cased.
    expect(unexecutedEffectProblems({ op: 'gerrymander', n: 1, target: 'everyone' }, '')).toEqual([]);
    expect(unexecutedEffectProblems({ op: 'gerrymander', n: 1, target: 'leader' }, '')).toEqual([]);
  });
});

describe('a field the reducer ignores is rejected however it is spelled', () => {
  it('every op that reads `target` accepts every EffectTarget', () => {
    // The six ops below used to be the registry's whole list of "field the type
    // carries and the reducer ignores". Each now loops resolveTargets, so a card
    // naming a target is held to it.
    for (const op of ['steal-any', 'evict', 'discard-voter', 'convert-voter', 'draw-conspiracy', 'discount'] as const) {
      for (const target of ['you', 'each-opponent', 'everyone', 'leader'] as const) {
        expect(
          codes(findingsForEffect({ op, n: 1, target })),
          `${op} target ${target}`,
        ).toEqual([]);
      }
    }
  });

  it('rejects a computed n the reducer cannot read, and accepts one it can', () => {
    expect(validateEffect(FILE, { op: 'gain-any', n: { of: 'your-pool' } }, EFFECT_OP_SET)).toEqual([]);
    expect(codes(findingsForEffect({ op: 'gain-any', n: { of: 'your-pool' } }))).toEqual([]);
    // Every source `computedValue` implements is accepted…
    for (const of of EXECUTABLE_COMPUTED_SOURCES) {
      expect(codes(findingsForEffect({ op: 'gain-any', n: { of } })), of).toEqual([]);
    }
    // …and the schema's `of` enum is that same set, so a deck file cannot name a
    // source the registry has never heard of.
    const schemaSources = (
      (
        corpusSchema().$defs as Record<
          string,
          { readonly properties?: Record<string, { readonly enum?: readonly string[] }> }
        >
      ).computedCount?.properties?.of?.enum
    );
    expect([...(schemaSources ?? [])].sort()).toEqual([...EXECUTABLE_COMPUTED_SOURCES].sort());
  });

  it('rejects an unknown computed source, because an unknown one silently reads as zero', () => {
    // The worst possible outcome for a computed value: not an error, a zero. A card
    // that reads as though it doubles something and doubles nothing. The schema
    // catches the typo as well, so the finding is filtered to the executability one —
    // both are real, and asserting on the union of them would let either pass alone.
    const report = findingsForEffect({ op: 'gain-any', n: { of: 'the-phase-of-the-moon' } });
    const executability = report.errors.filter((e) => e.code === 'EFFECT_FIELD_NOT_EXECUTED');
    expect(executability).toHaveLength(1);
    expect(executability[0]?.message).toContain('no quantity reduce() can read');
  });

  it('accepts `per` only on gain and lose, and only with `held-of-each-resource`', () => {
    expect(codes(findingsForEffect({ op: 'gain', res: { funds: 1 }, per: { of: 'held-of-each-resource' } }))).toEqual([]);
    expect(codes(findingsForEffect({ op: 'lose', res: { funds: 1 }, per: { of: 'held-of-each-resource' } }))).toEqual([]);
    // `per` multiplies EACH component of `res`, so any other source would multiply a
    // single number into four resources — which is not what any recovered card means.
    const wrong = findingsForEffect({ op: 'gain', res: { funds: 1 }, per: { of: 'your-pool' } });
    expect(codes(wrong)).toEqual(['EFFECT_FIELD_NOT_EXECUTED']);
    expect(wrong.errors[0]?.message).toContain("'held-of-each-resource'");
    // And on an op with no `res` it is a field the case does not read. Filtered to the
    // executability finding, because the schema reports the same thing as an
    // additionalProperties error and both are true.
    const onVoters = findingsForEffect({ op: 'voters', n: 1, per: { of: 'held-of-each-resource' } });
    expect(
      onVoters.errors.filter((e) => e.code === 'EFFECT_FIELD_NOT_EXECUTED'),
    ).toHaveLength(1);
  });

  it('rejects a malformed effect twice over: shape AND executability', () => {
    // `res` on `gain-any`, which has no such field. Two passes catch it and they are
    // not duplicates: the schema knows the shape is wrong, and the executability
    // registry knows the reducer's `gain-any` case would not read it. Keeping both is
    // the point of the pair — an author fixing only the finding they saw first would
    // still ship a card that lies.
    const report = findingsForEffect({ op: 'gain-any', n: 1, when: 'on-turn-start', res: {} });
    expect(codes(report).slice().sort()).toEqual(['EFFECT_FIELD_NOT_EXECUTED', 'SCHEMA']);
    const executability = report.errors.find((e) => e.code === 'EFFECT_FIELD_NOT_EXECUTED');
    expect(executability?.message).toContain('is on the gain-any op');
  });

  it('rejects a `condition` with no `when` to narrow, rather than dropping it', () => {
    // The engine discards a condition on a standing effect — there is no event, so
    // there is nothing to narrow — and a silently discarded clause is a card that
    // reads as though it filtered something and did not.
    const report = findingsForEffect({ op: 'voters', n: 1, condition: { byOwner: true } });
    expect(codes(report)).toEqual(['EFFECT_FIELD_NOT_EXECUTED']);
    expect(report.errors[0]?.message).toContain('needs a `when`');
    // …and accepted alongside one.
    expect(
      codes(findingsForEffect({ op: 'voters', n: 1, when: 'on-turn-start', condition: { byOwner: true } })),
    ).toEqual([]);
  });

  it('rejects an op with no case at all, rather than letting it reach reduce()', () => {
    // `applyEffect`'s switch has no `default`, so an unknown op resolves to
    // undefined and the NEXT reduce() call throws. Unreachable through the schema
    // (EFFECT_OP_UNKNOWN catches it first) and through validateDecks; reachable by
    // anyone hand-building a CardIndex, which is what this asserts.
    const problems = unexecutedEffectProblems({ op: 'hostage', n: 4 }, '/effects/0');
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('EFFECT_NOT_EXECUTED');
    expect(problems[0]?.message).toContain('undefined');
  });
});

describe('G9 / G22 — every duration is installed, and expires on a turn boundary', () => {
  it('accepts all four, because installLiveEffects writes all four', () => {
    for (const duration of ['this-turn', 'round', 'next-turn', 'rest-of-game']) {
      expect(codes(validateWithHeadline(baseHeadline({ duration }))), duration).toEqual([]);
    }
  });

  it('accepts a lasting duration on the EFFECT too, which overrides the card default', () => {
    // Per-effect scope wins over card-level scope: a card may mix a one-shot branch
    // with a lasting hook, and the one-shot is still applied immediately.
    const report = validateWithHeadline(
      baseHeadline({ effects: [{ op: 'voters', n: 1, until: 'rest-of-game' }] }),
    );
    expect(codes(report)).toEqual([]);
  });

  it('accepts timing now and next-turn, and refuses after-this-turn with the reason', () => {
    for (const timing of ['now', 'next-turn']) {
      expect(codes(validateWithHeadline(baseHeadline({ timing }))), timing).toEqual([]);
    }
    const refused = validateWithHeadline(baseHeadline({ timing: 'after-this-turn' }));
    expect(codes(refused)).toEqual(['EFFECT_NOT_EXECUTED']);
    expect(refused.errors[0]?.message).toContain('no anchor');
  });
});


describe('G13 — the phase-changing ops: two are executed, three are ruled out', () => {
  it('the op registry is exactly what RESPOND_INTERRUPT acts on', () => {
    expect([...EXECUTED_INTERRUPT_OPS].sort()).toEqual(reactiveInterruptOps());
    // And it is not empty, so the seam cannot be satisfied by asserting nothing.
    expect(EXECUTED_INTERRUPT_OPS.size).toBeGreaterThan(0);
    // Every executed op is one the TYPE and the SCHEMA both declare.
    for (const op of EXECUTED_INTERRUPT_OPS) expect([...INTERRUPT_OPS], op).toContain(op);
  });

  it('every value mayRespond distinguishes is registered, and the registry is the enum', () => {
    for (const [field, registry, declared] of [
      ['window', EXECUTED_INTERRUPT_WINDOWS, INTERRUPT_WINDOWS],
      ['target', EXECUTED_INTERRUPT_TARGETS, INTERRUPT_TARGETS],
    ] as const) {
      // The direction that catches a card that lies: the reducer distinguishes a
      // value the validator would not accept.
      for (const v of mayRespondDistinguishes(field)) {
        expect([...registry], `${field}: reduce() names "${v}"`).toContain(v);
      }
      // And nothing is registered that the type does not declare.
      expect([...registry].sort(), field).toEqual([...declared].sort());
    }
    // And the scan is not vacuous: it has to find something, and what it finds is the
    // narrowing each field exists for.
    expect(mayRespondDistinguishes('window')).toEqual(['pre-answer']);
    expect(mayRespondDistinguishes('target')).toEqual(['card-affecting-you']);
  });

  it('so neither enum can carry a value the engine ignores', () => {
    // The narrowing that bought the assertions above: a value the reducer cannot
    // distinguish from another is a value it is not reading, and a card author who
    // writes one gets a card that reads as though something happens and does not.
    for (const w of INTERRUPT_WINDOWS) expect(EXECUTED_INTERRUPT_WINDOWS, w).toContain(w);
    for (const t of INTERRUPT_TARGETS) expect(EXECUTED_INTERRUPT_TARGETS, t).toContain(t);
  });

  it('the shipped schema carries the same enums, so a card cannot pass the type and fail the file', () => {
    const schema = JSON.parse(
      readFileSync(resolve(HERE, '..', 'schema', 'card.schema.json'), 'utf8'),
    ) as { $defs: { interrupt: { properties: Record<string, { enum: readonly string[] }> } } };
    const props = schema.$defs.interrupt.properties;
    expect([...props['op']!.enum].sort()).toEqual([...INTERRUPT_OPS].sort());
    expect([...props['window']!.enum].sort()).toEqual([...INTERRUPT_WINDOWS].sort());
    expect([...props['target']!.enum].sort()).toEqual([...INTERRUPT_TARGETS].sort());
  });

  it('accepts a BLOCK and a DEFLECT, because reduce() performs them', () => {
    for (const op of ['block', 'deflect'] as const) {
      const report = validateWithHeadline(
        baseHeadline({ interrupt: { op, window: 'always', target: 'any-card' }, effects: [] }),
      );
      expect(codes(report), op).toEqual([]);
    }
  });

  it('and refuses each of the other three, with the reason IT is waiting on', () => {
    for (const op of ['auction', 'vote', 'pass-card'] as const) {
      const report = validateWithHeadline(baseHeadline({ interrupt: { op, window: 'always' }, effects: [] }));
      expect(codes(report), op).toEqual(['EFFECT_NOT_EXECUTED']);
      // `Finding` carries the object path as a prefix on the message, not as a
      // field, so the pointer is asserted where it actually lives.
      const message = report.errors[0]?.message ?? '';
      expect(message, op).toContain('/interrupt ');
      // Not the generic message: each op names the SYSTEM it needs, because "add a
      // case to applyEffect" is not what any of the three is short of.
      expect(message, op).not.toContain(INTERRUPT_FIX);
      expect(message, op).toContain(op === 'auction' ? 'IOU' : op === 'vote' ? 'ballot' : 'referent');
    }
  });

  it('refuses a window or a target the reducer does not honour', () => {
    // Asserted on the pure registry function rather than through the validator,
    // because the SCHEMA now refuses these values first (the enums were narrowed to
    // match), so a card carrying one never reaches the engine check at all. The
    // check is still the one an author hits if they hand-build a card object, and it
    // is what keeps the enums honest if the schema is ever loosened again.
    const badWindow = unexecutedInterruptProblems({ op: 'block', window: 'sometime' }, '/interrupt');
    expect(codesOf(badWindow)).toEqual(['EFFECT_NOT_EXECUTED']);
    expect(badWindow[0]?.pointer).toBe('/interrupt/window');

    const badTarget = unexecutedInterruptProblems(
      { op: 'deflect', window: 'always', target: 'any-player' },
      '/interrupt',
    );
    expect(codesOf(badTarget)).toEqual(['EFFECT_NOT_EXECUTED']);
    expect(badTarget[0]?.pointer).toBe('/interrupt/target');

    // And through the card-level walk, which is the path a shipped card takes.
    const viaCard = unexecutedCardProblems(
      { ...baseHeadline({}), interrupt: { op: 'block', window: 'sometime' } },
      '',
    );
    expect(viaCard.map((p) => p.pointer)).toContain('/interrupt/window');
  });

  it('the shape is schema-valid, so the error the author sees is the engine one', () => {
    // If this ever fails, the author gets "unknown property interrupt" from four
    // card branches at once instead of the explanation above.
    expect(
      schemaProblems({
        ...baseHeadline({}),
        interrupt: { op: 'block', window: 'pre-answer', target: 'card-affecting-you' },
      }),
    ).toEqual([]);
  });

  it('and a narrowed value now fails at the SCHEMA, which is the right error for it', () => {
    expect(
      schemaProblems({ ...baseHeadline({}), interrupt: { op: 'block', window: 'out-of-turn' } }).length,
    ).toBeGreaterThan(0);
  });
});

describe('the reserved shapes are still shapes', () => {
  it('the JSON Schema accepts duration, timing, interrupt, when, condition and a computed n', () => {
    // Asserted as SCHEMA acceptance, not as validator acceptance: the whole point
    // of modelling them is that the author is told what the ENGINE cannot do.
    expect(
      schemaProblems({
        ...baseHeadline({}),
        duration: 'rest-of-game',
        timing: 'now',
        interrupt: { op: 'vote', window: 'always' },
        effects: [
          {
            op: 'voters',
            n: { of: 'your-pool' },
            when: 'on-turn-start',
            until: 'round',
            condition: { byOwner: true },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('and the validator refuses exactly the two the engine still does not perform', () => {
    // `interrupt` (G13 — a change of phase, not of resources) and `timing:
    // 'after-this-turn'`, which has no anchor between `advanceTurn` and the next
    // player's first action. Everything else in that object is now executed, so a
    // card carrying only the executed half validates clean — which is the assertion
    // that the registry is not simply refusing everything.
    expect(
      codes(validateWithHeadline(baseHeadline({ duration: 'rest-of-game', timing: 'next-turn' }))),
    ).toEqual([]);
    const report = validateWithHeadline(
      baseHeadline({
        interrupt: { op: 'vote', window: 'always' },
        timing: 'after-this-turn',
        effects: [{ op: 'voters', n: { of: 'your-pool' }, when: 'on-turn-start', until: 'round' }],
      }),
    );
    expect(codes(report).slice().sort()).toEqual(['EFFECT_NOT_EXECUTED', 'EFFECT_NOT_EXECUTED']);
  });
});


/**
 * The G13 registries, re-derived from `reduce.ts`'s own source text.
 *
 * The THIRD honesty seam, and the one the previous two could not reach.
 * `EXECUTED_INTERRUPT_OPS`, `EXECUTED_INTERRUPT_WINDOWS` and
 * `EXECUTED_INTERRUPT_TARGETS` in `src/executable.ts` are promises about
 * `RESPOND_INTERRUPT` — a `case` of `reduce` itself, several hundred lines above
 * `applyEffect`, and not inside it. Slicing `applyEffect` cannot see an `interrupt`
 * at all, so putting these in `EXECUTED_OPS` would have made the re-derivation a
 * lie and the test would have had to be weakened to fit the registry.
 *
 * So each is derived from the construct it names:
 *  - the ops, from the keys of `REACTIVE_INTERRUPTS`;
 *  - the windows and the targets, from the string literals `mayRespond` compares
 *    against — and only the ones on the RIGHT of a comparison, so a literal in the
 *    refusal MESSAGE cannot be mistaken for a value the engine acts on.
 *
 * A value the reducer cannot act on is a declaration it ignores, which is the exact
 * failure this file exists to prevent: it is why `Interrupt.window` lost
 * 'out-of-turn' and `Interrupt.target` lost 'any-player'.
 */
function reducerSource(): string {
  return readFileSync(REDUCE_SRC, 'utf8');
}

/** The op keys of the `REACTIVE_INTERRUPTS` registry literal. */
function reactiveInterruptOps(): string[] {
  const src = reducerSource();
  const start = src.indexOf('const REACTIVE_INTERRUPTS');
  expect(start, 'reduce.ts still has REACTIVE_INTERRUPTS').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('};', start));
  return [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!).sort();
}

/**
 * The `interrupt.window` / `.target` values `mayRespond` DISTINGUISHES, re-derived
 * from `reduce.ts`.
 *
 * ## Why this is a SUBSET assertion in one direction and EQUALITY in the other
 *
 * A value the guard names appears as a literal; the value that falls through to the
 * `else` — `'always'` for `window`, `'any-card'` for `target`, both the permissive
 * readings — has no literal to find, because it is the absence of a refusal. So:
 *
 *  - everything `mayRespond` names must be REGISTERED, or the reducer distinguishes a
 *    value the validator would not accept and the registry is stale. This is the
 *    direction that catches a card that lies, so it is the one with a test.
 *  - the registry must be exactly the declared enum, or a card could be shipped
 *    against a value nothing reads. That is checked against `effect-ops.ts`, which
 *    is compile-time-bridged to `Interrupt` in the engine, and against the shipped
 *    JSON Schema below.
 *
 * Reading a literal out of a refusal MESSAGE is guarded against by requiring the
 * comparison form `interrupt.<field> === '<value>'`, and the message text is on the
 * far side of it.
 */
function mayRespondDistinguishes(field: string): string[] {
  const src = reducerSource();
  const start = src.indexOf('function mayRespond');
  expect(start, 'reduce.ts still has mayRespond').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n}', start));
  const out = new Set<string>();
  const re = new RegExp(`interrupt\\.${field} === '([a-z-]+)'`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1] !== undefined) out.add(m[1]);
  }
  return [...out].sort();
}


/** The schema alone, with no validator pass on top. */
function schemaProblems(card: Record<string, unknown>): readonly SchemaProblem[] {
  return validateDeckFile(FILE, { deck: 'et2040', campaign: 'Earth 2040', cards: [card] }, 'headline');
}