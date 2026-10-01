/**
 * The corpus validator.
 *
 * Schema validation catches shape. The checks below catch the failures a JSON
 * Schema cannot express, and each one names the silent bug it exists to stop.
 */

import {
  DECK_IDS,
  deckFilePath,
  discoverDeckFiles,
  loadCorpus,
  type AnyCorpusCard,
  type CardKind,
  type Corpus,
} from './corpus.js';
import { EFFECT_OP_SET } from './effect-ops.js';
import { unexecutedCardProblems } from './executable.js';
import { IDEOLOGUES, RULES } from './engine.js';
import {
  parseDeckFile,
  validateDeckFile,
  validateEffect,
  validateIdeologySide,
  type SchemaProblem,
} from './schema.js';

const IDEOLOGUE_SET: ReadonlySet<string> = new Set<string>(IDEOLOGUES);

export type FindingSeverity = 'error' | 'warn';

export type Finding = {
  readonly severity: FindingSeverity;
  readonly code:
    | 'SCHEMA'
    | 'READ'
    | 'DUPLICATE_ID'
    | 'ID_KIND_PREFIX'
    | 'ID_DECK_SEGMENT'
    | 'TYPE_MISSING'
    | 'MARKET_FILL'
    | 'MARKET_VALUE_COVERAGE'
    | 'CAMPAIGN_MISMATCH'
    | 'QUESTION_DUPLICATE'
    | 'SOURCE_NOT_CITED'
    | 'EFFECT_OP_UNKNOWN'
    | 'EFFECT_NOT_EXECUTED'
    | 'EFFECT_FIELD_NOT_EXECUTED';
  readonly file: string | null;
  readonly cardId: string | null;
  readonly message: string;
};

export type ValidationReport = {
  readonly findings: readonly Finding[];
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly counts: Readonly<Record<CardKind | 'total', number>>;
  readonly provenance: Readonly<Record<'verbatim' | 'adapted' | 'inferred', number>>;
  /** Number of deck files inspected. */
  readonly files: number;
};

const KIND_PREFIX: Readonly<Record<CardKind, string>> = {
  ideology: 'ig',
  voter: 'vo',
  conspiracy: 'ct',
  headline: 'hl',
};

/**
 * The card-level shapes that are in `cards.ts` but inert in `reduce()`. See
 * `src/executable.ts` and KNOWN-GAPS.md G9/G13/G22. Listed here only so the
 * card-level schema fan-out does not bury the precise finding.
 */
const RESERVED_CARD_FIELDS: readonly string[] = ['duration', 'timing', 'interrupt'];

/** The reference citation an adapted or verbatim card must actually carry. */
const CITATION_RE = /(https?:\/\/|scribd\/\d|\bREF\b\s*§?\s*\d|§\s*\d)/;

/**
 * An inferred card is one we wrote. Saying so in the `source` field, in the form
 * the schema's `$comment` documents, is what stops a future editor quietly
 * promoting an original to "recovered" by editing a string.
 */
const ORIGINAL_SOURCE_RE = /^original\b/i;

function err(
  code: Finding['code'],
  file: string | null,
  cardId: string | null,
  message: string,
): Finding {
  return { severity: 'error', code, file, cardId, message };
}

function warn(
  code: Finding['code'],
  file: string | null,
  cardId: string | null,
  message: string,
): Finding {
  return { severity: 'warn', code, file, cardId, message };
}

function cardFile(deck: string, kind: CardKind): string {
  return deckFilePath(deck, kind);
}

function readAll(
  findings: Finding[],
  inputs: readonly DeckInput[],
): {
  corpus: Corpus;
  perFile: { deck: string; kind: CardKind; file: string; campaign: string; cards: AnyCorpusCard[] }[];
} {
  const perFile: {
    deck: string;
    kind: CardKind;
    file: string;
    campaign: string;
    cards: AnyCorpusCard[];
  }[] = [];
  const buckets: Record<CardKind, AnyCorpusCard[]> = {
    ideology: [],
    voter: [],
    conspiracy: [],
    headline: [],
  };

  for (const { deck, kind, file: path, data } of inputs) {
    if (typeof data === 'string') {
      findings.push(err('READ', path, null, data));
      continue;
    }
    for (const problem of validateDeckFile(path, data, kind)) {
      // Effect-shape and Ideologue-branch problems are re-reported precisely by
      // the per-effect / per-side passes below. Keeping the card-level `oneOf`
      // fan-out as well would print the same failure once per branch — for
      // effects, 13 times; for a side, 4 times — none of which is the real error.
      if (/(^|\/)effects(\/|$)/.test(problem.pointer)) continue;
      if (/\/sides\/[0-9]+/.test(problem.pointer)) continue;
      // Same reason for the reserved card-level shapes (duration / timing /
      // interrupt): the schema accepts them so an author who writes one gets the
      // engine explanation from EXECUTED_NOT_EXECUTED below, not "unknown
      // property" from four card branches at once.
      if (RESERVED_CARD_FIELDS.some((f) => problem.pointer.endsWith(`/${f}`))) continue;
      findings.push({
        severity: 'error',
        code: 'SCHEMA',
        file: problem.file,
        cardId: problem.cardId,
        message: `${problem.pointer} ${problem.message} [${problem.keyword}] (${problem.where})`,
      });
    }
    const file = data as { campaign?: unknown; cards?: AnyCorpusCard[] };
    const cards = Array.isArray(file.cards) ? file.cards : [];
    buckets[kind].push(...cards);
    perFile.push({ deck, kind, file: path, campaign: String(file.campaign), cards });
  }

  return { corpus: buckets as unknown as Corpus, perFile };
}

/**
 * One deck file, as handed to the validator. Tests supply synthetic ones.
 *
 * `data` is deliberately mutable: a test mutating one input in place to describe
 * "the corpus, but with a duplicate id" is clearer than rebuilding the array.
 * The validator does not write to it.
 */
export type DeckInput = {
  readonly deck: string;
  readonly kind: CardKind;
  readonly file: string;
  data: unknown;
};

export function shippedDeckInputs(): readonly DeckInput[] {
  return discoverDeckFiles().map(({ deck, kind, path }) => {
    const parsed = parseDeckFile(path);
    return { deck, kind, file: path, data: 'error' in parsed ? parsed.error : parsed.data };
  });
}

/**
 * Validate a set of deck files. Pure with respect to its input, deterministic, and
 * the single entry point both the CLI and the tests go through.
 */
export function validateDecks(inputs: readonly DeckInput[]): ValidationReport {
  const findings: Finding[] = [];
  const { perFile } = readAll(findings, inputs);

  // ── 2. ID uniqueness across every deck and every type ─────────────────────
  // `indexCards` builds its index with `Object.fromEntries`, so a duplicate id
  // silently overwrites and one card vanishes with no error anywhere. This is the
  // only check standing between the corpus and that bug.
  const seen = new Map<string, string>();
  for (const { deck, kind, file, cards } of perFile) {
    for (const card of cards) {
      const id = card.id;
      if (typeof id !== 'string') continue;
      const prior = seen.get(id);
      if (prior !== undefined) {
        findings.push(
          err('DUPLICATE_ID', file, id, `id already used by ${prior}; indexCards would silently drop one of them`),
        );
      } else {
        seen.set(id, `${kind} card in deck "${deck}" (${file})`);
      }
    }
  }

  // ── 6. id prefix and deck segment ────────────────────────────────────────
  for (const { deck, kind, file, cards } of perFile) {
    const prefix = KIND_PREFIX[kind];
    for (const card of cards) {
      if (typeof card.id !== 'string') continue;
      if (!card.id.startsWith(`${prefix}-`)) {
        findings.push(
          err('ID_KIND_PREFIX', file, card.id, `a ${kind} card id must start with "${prefix}-"`),
        );
      }
      const segments = card.id.split('-');
      if (segments[1] !== deck) {
        findings.push(
          err(
            'ID_DECK_SEGMENT',
            file,
            card.id,
            `id deck segment "${segments[1] ?? ''}" does not match the directory "${deck}"`,
          ),
        );
      }
    }
  }

  // ── 3. at least one card of each type ────────────────────────────────────
  // A deck with no Headlines still has a Volatile Area on the board (RULES p18),
  // so a missing type is a broken game, not a thinner one.
  for (const kind of ['ideology', 'voter', 'conspiracy', 'headline'] as const) {
    const n = perFile.filter((f) => f.kind === kind).reduce((sum, f) => sum + f.cards.length, 0);
    if (n === 0) {
      findings.push(err('TYPE_MISSING', null, null, `the corpus contains no ${kind} cards`));
    }
  }

  const voterCards = perFile.filter((f) => f.kind === 'voter').flatMap((f) => f.cards);
  const voterByDeck = new Map<string, number>();
  for (const { deck, cards } of perFile.filter((f) => f.kind === 'voter')) {
    voterByDeck.set(deck, (voterByDeck.get(deck) ?? 0) + cards.length);
  }

  // ── 4. the market can be filled to RULES.marketSize ───────────────────────
  // RULES p10: three Voter Cards are face up at all times, and an influenced card
  // is discarded and replaced immediately, so the deck must never run dry.
  for (const [deck, n] of voterByDeck) {
    if (n < RULES.marketSize) {
      findings.push(
        err(
          'MARKET_FILL',
          null,
          null,
          `deck "${deck}" has ${n} Voter Cards; RULES.marketSize is ${RULES.marketSize} and the market must never be short`,
        ),
      );
    }
  }

  // REF 3 / REF 10 item 3: real effects discriminate Voter Cards by size, so a
  // size the deck does not offer is a mechanic with nothing to bite on.
  for (const v of [1, 2, 3]) {
    const n = voterCards.filter((c) => (c as { voters?: number }).voters === v).length;
    if (n === 0) {
      findings.push(
        err('MARKET_VALUE_COVERAGE', null, null, `no ${v}-Voter cards in the corpus; size-discriminating effects need all three sizes`),
      );
    }
  }

  // ── 7. campaign coherence + question uniqueness ──────────────────────────
  const questions = new Map<string, string>();
  for (const { kind, file, campaign: fileCampaign, cards } of perFile) {
    for (const [index, card] of cards.entries()) {
      if (kind === 'ideology') {
        const c = card as { campaign?: string; question?: string };
        if (typeof c.campaign === 'string' && c.campaign !== fileCampaign) {
          findings.push(
            err('CAMPAIGN_MISMATCH', file, card.id, `card campaign "${c.campaign}" != file campaign "${fileCampaign}"`),
          );
        }
        if (typeof c.question === 'string') {
          const key = c.question.trim().toLowerCase();
          const prior = questions.get(key);
          if (prior !== undefined) {
            findings.push(
              err('QUESTION_DUPLICATE', file, card.id, `question already used by ${prior}; duplicate prompts feel like a broken game`),
            );
          } else {
            questions.set(key, card.id);
          }
        }
      }
      // ── 8. Ideologue <-> Resource cross-check, per side ──────────────────
      if (kind === 'ideology') {
        const sides = (card as { sides?: unknown }).sides;
        if (Array.isArray(sides)) {
          for (const [si, side] of sides.entries()) {
            for (const problem of validateIdeologySide(file, side, IDEOLOGUE_SET)) {
              const suffix = problem.pointer === '/' ? '' : problem.pointer;
              findings.push({
                severity: 'error',
                code: 'SCHEMA',
                file,
                cardId: card.id,
                message: `/cards/${index}/sides/${si}${suffix} ${problem.message} [${problem.keyword}]`,
              });
            }
          }
        }
      }

      // ── 9. effect ops the interpreter cannot handle, and effect shape ────
      const effects = (card as { effects?: unknown }).effects;
      if (Array.isArray(effects)) {
        for (const [i, effect] of effects.entries()) {
          for (const problem of validateEffect(file, effect, EFFECT_OP_SET)) {
            const suffix = problem.pointer === '/' ? '' : problem.pointer;
            findings.push({
              severity: 'error',
              code: problem.keyword === 'const' ? 'EFFECT_OP_UNKNOWN' : 'SCHEMA',
              file,
              cardId: card.id,
              message: `/cards/${index}/effects/${i}${suffix} ${problem.message} [${problem.keyword}]`,
            });
          }
        }
      }

      // ── 10. what the ENGINE would not do, as opposed to what is malformed ──
      // The passes above are shape. This one is the promise: a card is only
      // allowed to describe behaviour `reduce()` actually performs. See the
      // header of src/executable.ts for why nothing else in the toolchain can
      // catch it.
      for (const problem of unexecutedCardProblems(card, '')) {
        findings.push({
          severity: 'error',
          code: problem.code,
          file,
          cardId: card.id,
          message: `/cards/${index}${problem.pointer} ${problem.message}`,
        });
      }
    }
  }

  // ── 9. provenance honesty ────────────────────────────────────────────────
  for (const { file, cards } of perFile) {
    for (const card of cards) {
      const { provenance, source } = card as { provenance?: string; source?: string };
      if (typeof source !== 'string') continue;
      if (provenance === 'inferred') {
        if (!ORIGINAL_SOURCE_RE.test(source)) {
          findings.push(
            err('SOURCE_NOT_CITED', file, card.id, `provenance "inferred" requires a source of the form "original; …" — got ${JSON.stringify(source)}`),
          );
        }
      } else if (!CITATION_RE.test(source)) {
        findings.push(
          err(
            'SOURCE_NOT_CITED',
            file,
            card.id,
            `provenance "${String(provenance)}" requires a citation (a URL, a doc id, or "REF §n") — got ${JSON.stringify(source)}`,
          ),
        );
      }
    }
  }

  const counts: Record<CardKind | 'total', number> = {
    ideology: 0,
    voter: 0,
    conspiracy: 0,
    headline: 0,
    total: 0,
  };
  const provenance: Record<'verbatim' | 'adapted' | 'inferred', number> = {
    verbatim: 0,
    adapted: 0,
    inferred: 0,
  };
  for (const { cards } of perFile) {
    for (const card of cards) {
      counts.total += 1;
      const p = (card as { provenance?: string }).provenance;
      if (p === 'verbatim' || p === 'adapted' || p === 'inferred') provenance[p] += 1;
    }
  }
  for (const kind of ['ideology', 'voter', 'conspiracy', 'headline'] as const) {
    counts[kind] = perFile.filter((f) => f.kind === kind).reduce((s, f) => s + f.cards.length, 0);
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  return {
    findings,
    errors,
    warnings,
    counts,
    provenance,
    files: perFile.length,
  };
}

/** Convenience for tests: the corpus as the loader sees it, independent of the validator. */
export function shippedCorpus(): Corpus {
  return loadCorpus(DECK_IDS);
}

/** Validate the decks that actually ship. */
export function validateCorpus(): ValidationReport {
  return validateDecks(shippedDeckInputs());
}
