/**
 * JSON Schema validation for the card corpus.
 *
 * Ajv is a DEV dependency on purpose: it lives in the tooling, not in the data.
 * `decks/*.json` is plain JSON that any client or server can read with
 * `JSON.parse` and zero dependencies.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import type { CardKind } from './corpus.js';

export const SCHEMA_PATH: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'schema',
  'card.schema.json',
);

export type SchemaProblem = {
  /** Absolute path of the deck file the problem was found in. */
  readonly file: string;
  /** The card's `id`, or `null` when the problem is at file level. */
  readonly cardId: string | null;
  /** RFC 6901 JSON pointer into the parsed file, e.g. `/cards/3/sides/0/pays/funds`. */
  readonly pointer: string;
  /** Human-readable reason. */
  readonly message: string;
  /** The Ajv keyword that failed, e.g. `oneOf`, `additionalProperties`, `pattern`. */
  readonly keyword: string;
  /** The card object at the point of failure, for context in the report. */
  readonly where: string;
};

export type CardSchema = Record<string, unknown>;

/** Which `$defs` entry each deck-file kind's cards must satisfy. */
const KIND_DEF: Readonly<Record<CardKind, string>> = {
  ideology: 'ideologyCard',
  voter: 'voterCard',
  conspiracy: 'conspiracyCard',
  headline: 'headlineCard',
};

let cachedSchema: CardSchema | null = null;
const cachedValidators = new Map<CardKind, ValidateFunction>();
const cachedEffectValidators = new Map<string, ValidateFunction>();
const cachedSideValidators = new Map<string, ValidateFunction>();

export function corpusSchema(): CardSchema {
  if (cachedSchema === null) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    corpusValidator('ideology');
  }
  if (cachedSchema === null) throw new Error('schema failed to load');
  return cachedSchema;
}

function makeAjv(): Ajv2020 {
  return new Ajv2020({
    strict: true,
    allErrors: true,
    allowUnionTypes: true,
  });
}

/**
 * Compile a validator for one deck-file KIND.
 *
 * WHY NOT JUST VALIDATE THE WHOLE FILE: the root schema's `cards.items` is
 * `#/$defs/card`, a `oneOf` over all four card shapes. A malformed Headline
 * therefore fails all four branches and Ajv reports the union of all four sets of
 * errors — about twenty lines saying "must have required property 'question'",
 * "must have required property 'sides'", "must NOT have additional property
 * 'effects'", which reads like four separate bugs and is really one.
 *
 * The deck file format already fixes the kind by construction — one file per card
 * type per deck — so the validator narrows `cards.items` to the matching `$defs`
 * entry. Same schema, same constraints, one branch, a readable report. The root
 * schema is left un-narrowed so it is still correct when loaded standalone.
 */
export function corpusValidator(kind: CardKind): ValidateFunction {
  const cached = cachedValidators.get(kind);
  if (cached !== undefined) return cached;

  const raw = readFileSync(SCHEMA_PATH, 'utf8');
  const root = JSON.parse(raw) as CardSchema;
  cachedSchema = root;

  // A distinct $id per kind so Ajv keeps the four compiled schemas separate.
  // No URI fragment: the 2020-12 meta-schema's `$id` pattern allows `#` only as
  // the final character.
  const narrowed: CardSchema = {
    ...root,
    $id: `https://shasn.invalid/schema/card.deckfile-${kind}.json`,
    properties: {
      ...(root.properties as Record<string, unknown>),
      cards: { type: 'array', minItems: 1, items: { $ref: `#/$defs/${KIND_DEF[kind]}` } },
    },
  };
  const validate = makeAjv().compile(narrowed);
  cachedValidators.set(kind, validate);
  return validate;
}

function escapePointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** `instancePath` is already a JSON pointer; empty string means the document root. */
function pointerOf(error: ErrorObject): string {
  return error.instancePath === '' ? '/' : error.instancePath;
}

/**
 * Walk up an Ajv error to the nearest enclosing card object, so the report can
 * name a card id rather than a bare offset. Ajv's `oneOf` errors do not carry the
 * value, so we resolve the id from the parsed document instead.
 */
function cardIdAt(root: unknown, pointer: string): string | null {
  const segments = pointer.split('/').filter((s) => s !== '');
  // Walk back to the nearest `cards/<n>` ancestor.
  for (let i = segments.length; i > 0; i--) {
    const head = segments.slice(0, i);
    if (head[head.length - 2] === 'cards') {
      const list = (root as { cards?: unknown[] } | null)?.cards;
      const index = Number(head[head.length - 1]);
      const card = Array.isArray(list) ? list[index] : undefined;
      if (card !== undefined && typeof card === 'object' && card !== null) {
        const id = (card as { id?: unknown }).id;
        if (typeof id === 'string') return id;
      }
    }
  }
  return null;
}

/** A short, human-readable label for what the pointer points at. */
function describe(root: unknown, pointer: string): string {
  if (pointer === '/') return 'deck file root';
  const cardId = cardIdAt(root, pointer);
  return cardId === null ? pointer : `card ${cardId} at ${pointer}`;
}

export function validateDeckFile(
  file: string,
  data: unknown,
  kind: CardKind,
): readonly SchemaProblem[] {
  const validate = corpusValidator(kind);
  if (validate(data)) return [];
  const errors = validate.errors ?? [];
  return dedupe(errors.map((error) => toProblem(file, data, error)));
}

/**
 * Validate ONE effect against its own op branch.
 *
 * `#/$defs/effect` is a `oneOf` over 13 variants, so a bad effect inside a card
 * makes the card-level validator emit the union of all 13 branches' errors —
 * the same "must be equal to constant" line thirteen times, interleaved with
 * "unknown property n" from every op that has no `n`. The deck file already
 * carries the op as data, so this compiles each branch separately and reports
 * the one real problem. Same constraints; a report a human can act on.
 */
export function validateEffect(file: string, effect: unknown, knownOps: ReadonlySet<string>): readonly SchemaProblem[] {
  if (typeof effect !== 'object' || effect === null) {
    return [
      {
        file,
        cardId: null,
        pointer: '/effects',
        keyword: 'type',
        message: 'must be an object',
        where: '/effects',
      },
    ];
  }
  const op = (effect as { op?: unknown }).op;
  if (typeof op !== 'string' || !knownOps.has(op)) {
    return [
      {
        file,
        cardId: null,
        pointer: '/effects',
        keyword: 'const',
        message: `op ${JSON.stringify(op)} is not one of: ${[...knownOps].join(', ')}`,
        where: '/effects',
      },
    ];
  }
  let validate = cachedEffectValidators.get(op);
  if (validate === undefined) {
    const root = corpusSchema();
    const branches = ((root.$defs as Record<string, { oneOf?: unknown[] }>).effect?.oneOf ??
      []) as unknown[];
    const index = EFFECT_OP_ORDER[op];
    if (index === undefined || branches[index] === undefined) {
      throw new Error(
        `schema drift: EFFECT_OPS lists "${op}" at index ${String(index)} but $defs.effect.oneOf has no such branch. ` +
          'The op enum in card.schema.json and src/effect-ops.ts have diverged — add the branch to the schema.',
      );
    }
    const single: CardSchema = {
      $schema: root.$schema,
      $id: `https://shasn.invalid/schema/effect.${op}.json`,
      $ref: `#/$defs/effect/oneOf/${index}`,
      $defs: root.$defs,
    };
    validate = makeAjv().compile(single);
    cachedEffectValidators.set(op, validate);
  }
  if (validate(effect)) return [];
  return dedupe((validate.errors ?? []).map((error) => toProblem(file, effect, error)));
}

/** The op order, which must match the `oneOf` branch order in card.schema.json. */
const EFFECT_OP_ORDER: Readonly<Record<string, number>> = {
  gain: 0,
  lose: 1,
  'gain-any': 2,
  'lose-any': 3,
  'steal-any': 4,
  voters: 5,
  evict: 6,
  'discard-voter': 7,
  'convert-voter': 8,
  gerrymander: 9,
  'draw-conspiracy': 10,
  'refresh-market': 11,
  discount: 12,
};

/**
 * Validate ONE Ideology Card side against its own Ideologue branch.
 *
 * `#/$defs/ideologySide` ends in a `oneOf` over the four Ideologues, each branch
 * pinning `ideologue` to a constant and requiring that Ideologue's resource to be
 * named in `pays`. So a side whose payout simply omits its own resource produces
 * four `ideologue must be equal to constant` errors — one per branch — none of
 * which is the actual problem, plus the two real ones. The side carries its
 * ideologue as data, so the branch is knowable up front and the report can name
 * the one thing that is wrong.
 */
export function validateIdeologySide(
  file: string,
  side: unknown,
  knownIdeologues: ReadonlySet<string>,
): readonly SchemaProblem[] {
  if (typeof side !== 'object' || side === null) {
    return [{ file, cardId: null, pointer: '/sides', keyword: 'type', message: 'must be an object', where: '/sides' }];
  }
  const ideologue = (side as { ideologue?: unknown }).ideologue;
  if (typeof ideologue !== 'string' || !knownIdeologues.has(ideologue)) {
    return [
      {
        file,
        cardId: null,
        pointer: '/ideologue',
        keyword: 'const',
        message: `ideologue ${JSON.stringify(ideologue)} is not one of: ${[...knownIdeologues].join(', ')}`,
        where: '/ideologue',
      },
    ];
  }
  const index = IDEOLOGUE_ORDER.indexOf(ideologue);
  const cacheKey = `ideologue:${ideologue}`;
  let validate = cachedSideValidators.get(cacheKey);
  if (validate === undefined) {
    const root = corpusSchema();
    const branches = ((root.$defs as Record<string, { oneOf?: unknown[] }>).ideologySide?.oneOf ??
      []) as unknown[];
    if (index < 0 || branches[index] === undefined) {
      throw new Error(
        `schema drift: $defs.ideologySide.oneOf has no branch at index ${index} for "${ideologue}". ` +
          'The Ideologue enum in card.schema.json and IDEOLOGUES in state.ts have diverged.',
      );
    }
    // Base (the side shape, WITHOUT its four-way `oneOf`) plus this Ideologue's
    // branch, so the side is checked in full with exactly ONE branch rather than a
    // fan-out that reports the same failure four times over.
    const base = { ...(root.$defs as Record<string, Record<string, unknown>>).ideologySide };
    delete base.oneOf;
    validate = makeAjv().compile({
      $schema: root.$schema,
      $id: `https://shasn.invalid/schema/ideology-side.${ideologue}.json`,
      allOf: [{ $ref: '#/$defs/__ideologySideBase' }, { $ref: `#/$defs/ideologySide/oneOf/${index}` }],
      $defs: { ...(root.$defs as Record<string, unknown>), __ideologySideBase: base },
    } as CardSchema);
    cachedSideValidators.set(cacheKey, validate);
  }
  if (validate(side)) return [];
  return dedupe((validate.errors ?? []).map((error) => toProblem(file, side, error)));
}

/** Branch order in `$defs.ideologySide.oneOf`. */
const IDEOLOGUE_ORDER: readonly string[] = ['capitalist', 'supremo', 'showstopper', 'idealist'];

function dedupe(problems: readonly SchemaProblem[]): readonly SchemaProblem[] {
  const seen = new Set<string>();
  const out: SchemaProblem[] = [];
  for (const p of problems) {
    const key = `${p.pointer}|${p.keyword}|${p.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function toProblem(file: string, root: unknown, error: ErrorObject): SchemaProblem {
  const pointer = pointerOf(error);
  const extra =
    error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string'
      ? ` (unknown property "${error.params.additionalProperty}")`
      : error.keyword === 'enum'
        ? ` (allowed: ${JSON.stringify(error.params.allowedValues)})`
        : error.keyword === 'oneOf'
          ? ' (card matched none of the four card shapes)'
          : '';
  return {
    file,
    cardId: cardIdAt(root, pointer),
    pointer,
    keyword: error.keyword,
    message: `${error.message ?? 'failed'}${extra}`,
    where: describe(root, pointer),
  };
}

export function parseDeckFile(file: string): { data: unknown } | { error: string } {
  const raw = readFileSync(file, 'utf8');
  try {
    return { data: JSON.parse(raw) as unknown };
  } catch (err) {
    return { error: `${file}: not valid JSON — ${(err as Error).message}` };
  }
}
