/**
 * The provenance envelope, the deck file format, and the loader.
 *
 * `packages/cards` is the only package allowed to read card JSON. Everything else
 * consumes the typed arrays it exports, so a deck is a reviewable pull request
 * rather than a build artefact.
 *
 * LOADED ON THE SERVER, ONCE, AT BOOT. Never shipped to a client in bulk — see
 * docs/ARCHITECTURE.md 6.3.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConspiracyCard, HeadlineCard, IdeologyCard, IdeologySide, VoterCard } from './engine.js';

import type { CardID } from './engine.js';
import { IDEOLOGUE_RESOURCE, type Delta, type Ideologue, type Resource } from './engine.js';

export { IDEOLOGUE_RESOURCE };
export type { Delta, Ideologue, Resource };

/** How a card's content relates to the recovered source material. See schema/card.schema.json. */
export type Provenance = 'verbatim' | 'adapted' | 'inferred';

/**
 * The two fields the corpus adds on top of the engine card shapes. They are NOT
 * part of `IdeologyCard` et al; `toEngineCard` strips them. See KNOWN-GAPS.md G0.
 */
export type CardEnvelope = {
  readonly id: CardID;
  readonly source: string;
  readonly provenance: Provenance;
};

export type CorpusIdeologyCard = IdeologyCard & CardEnvelope;
export type CorpusVoterCard = VoterCard & CardEnvelope;
export type CorpusConspiracyCard = ConspiracyCard & CardEnvelope;
export type CorpusHeadlineCard = HeadlineCard & CardEnvelope;

export type AnyCorpusCard =
  | CorpusIdeologyCard
  | CorpusVoterCard
  | CorpusConspiracyCard
  | CorpusHeadlineCard;

export type CardKind = 'ideology' | 'voter' | 'conspiracy' | 'headline';

export const CARD_KINDS: readonly CardKind[] = ['ideology', 'voter', 'conspiracy', 'headline'];

/** One file on disk: `decks/<deck>/<kind>.json`. */
export type DeckFile<T> = {
  readonly deck: string;
  readonly campaign: string;
  readonly cards: readonly T[];
};

/** Every deck id, in load order. Adding a deck means adding a directory and an entry here. */
export const DECK_IDS = ['core', 'et2040', 'in2020'] as const;
export type DeckId = (typeof DECK_IDS)[number];

export const DECK_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'decks');

export function deckDir(deck: DeckId | string): string {
  return join(DECK_ROOT, deck);
}

export function deckFilePath(deck: DeckId | string, kind: CardKind): string {
  return join(DECK_ROOT, deck, `${kind}.json`);
}

function readDeckFile<T>(deck: DeckId | string, kind: CardKind): DeckFile<T> {
  const path = deckFilePath(deck, kind);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    // A deck simply does not ship every card type — `core` has no Ideology Cards
    // and the India deck has no Voter Cards, because Voter Cards are shared across
    // campaigns in the physical product (REF 5.6: one HQ Mat, one market). So a
    // missing file is an empty deck, not a crash. Any OTHER read failure still throws.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { deck: String(deck), campaign: '', cards: [] };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`${path}: not valid JSON — ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${path}: expected a JSON object with { deck, campaign, cards }`);
  }
  const file = parsed as Partial<DeckFile<T>>;
  if (file.deck !== deck) {
    throw new Error(`${path}: "deck" is ${JSON.stringify(file.deck)} but the directory is "${deck}"`);
  }
  if (!Array.isArray(file.cards)) {
    throw new Error(`${path}: "cards" must be an array`);
  }
  return { deck: file.deck, campaign: String(file.campaign), cards: file.cards };
}

/** All deck file paths that currently exist on disk, for the validator to iterate. */
export function discoverDeckFiles(): { deck: string; kind: CardKind; path: string }[] {
  const out: { deck: string; kind: CardKind; path: string }[] = [];
  for (const deck of DECK_IDS) {
    let kinds: string[];
    try {
      kinds = readdirSync(deckDir(deck));
    } catch {
      continue;
    }
    for (const kind of CARD_KINDS) {
      if (kinds.includes(`${kind}.json`)) {
        out.push({ deck, kind, path: deckFilePath(deck, kind) });
      }
    }
  }
  return out;
}

export function loadIdeologyDeck(deck: DeckId | string): readonly CorpusIdeologyCard[] {
  return readDeckFile<CorpusIdeologyCard>(deck, 'ideology').cards;
}
export function loadVoterDeck(deck: DeckId | string): readonly CorpusVoterCard[] {
  return readDeckFile<CorpusVoterCard>(deck, 'voter').cards;
}
export function loadConspiracyDeck(deck: DeckId | string): readonly CorpusConspiracyCard[] {
  return readDeckFile<CorpusConspiracyCard>(deck, 'conspiracy').cards;
}
export function loadHeadlineDeck(deck: DeckId | string): readonly CorpusHeadlineCard[] {
  return readDeckFile<CorpusHeadlineCard>(deck, 'headline').cards;
}

// ─────────────────────────── envelope stripping ───────────────────────────

/**
 * Remove `source` / `provenance` so the object is assignable to the engine's
 * `readonly` card types. Built key by key rather than with `delete` so that an
 * absent optional field stays ABSENT — `exactOptionalPropertyTypes` is on in
 * tsconfig.base.json and `advisory: undefined` is not the same as no `advisory`.
 */
export function toEngineIdeologyCard(c: CorpusIdeologyCard): IdeologyCard {
  const a = c.sides[0];
  const b = c.sides[1];
  if (a === undefined || b === undefined) {
    throw new Error(`${c.id}: sides must contain exactly 2 entries`);
  }
  return c.advisory === undefined
    ? { id: c.id, campaign: c.campaign, question: c.question, sides: [a, b] }
    : { id: c.id, campaign: c.campaign, question: c.question, advisory: c.advisory, sides: [a, b] };
}

export function toEngineVoterCard(c: CorpusVoterCard): VoterCard {
  return { id: c.id, cost: c.cost, voters: c.voters };
}

export function toEngineConspiracyCard(c: CorpusConspiracyCard): ConspiracyCard {
  return withXScope(
    c.excludeInTwoPlayer === undefined
      ? { id: c.id, name: c.name, text: c.text, cost: c.cost, effects: c.effects }
      : {
          id: c.id,
          name: c.name,
          text: c.text,
          cost: c.cost,
          effects: c.effects,
          excludeInTwoPlayer: c.excludeInTwoPlayer,
        },
    c,
  );
}

export function toEngineHeadlineCard(c: CorpusHeadlineCard): HeadlineCard {
  return withXScope(
    c.excludeInTwoPlayer === undefined
      ? { id: c.id, name: c.name, text: c.text, effects: c.effects }
      : {
          id: c.id,
          name: c.name,
          text: c.text,
          effects: c.effects,
          excludeInTwoPlayer: c.excludeInTwoPlayer,
        },
    c,
  );
}

/**
 * Carry `duration` / `timing` / `interrupt` through to the engine when present.
 *
 * Every value of all three is refused by the validator today (see
 * `src/executable.ts`), so this is not a path a card can take today. It exists so
 * that the day `reduce()` grows a case for one, the field is already on the card
 * object the reducer sees, instead of being quietly stripped here.
 *
 * Built by spread rather than `delete`, for the reason `toEngineIdeologyCard`
 * documents: `exactOptionalPropertyTypes` is on, and `advisory: undefined` is not
 * the same as no `advisory` at all.
 */
function withXScope<T extends object>(card: T, c: CorpusConspiracyCard | CorpusHeadlineCard): T {
  return {
    ...card,
    ...(c.duration !== undefined ? { duration: c.duration } : {}),
    ...(c.timing !== undefined ? { timing: c.timing } : {}),
    ...(c.interrupt !== undefined ? { interrupt: c.interrupt } : {}),
  };
}

// ─────────────────────────── whole-corpus view ───────────────────────────

export type Corpus = {
  readonly ideology: readonly CorpusIdeologyCard[];
  readonly voter: readonly CorpusVoterCard[];
  readonly conspiracy: readonly CorpusConspiracyCard[];
  readonly headline: readonly CorpusHeadlineCard[];
};

export function loadCorpus(decks: readonly (DeckId | string)[] = DECK_IDS): Corpus {
  const pick = <T>(load: (d: DeckId | string) => readonly T[]): readonly T[] =>
    decks.flatMap((d) => load(d));
  return {
    ideology: pick(loadIdeologyDeck),
    voter: pick(loadVoterDeck),
    conspiracy: pick(loadConspiracyDeck),
    headline: pick(loadHeadlineDeck),
  };
}

export function corpusCards(corpus: Corpus): readonly AnyCorpusCard[] {
  return [...corpus.ideology, ...corpus.voter, ...corpus.conspiracy, ...corpus.headline];
}

/**
 * `sides[action.side]` with a loud failure instead of `undefined`.
 *
 * ARCHITECTURE 6.2 explains why this exists: the tuple is a fixed-length array in
 * the engine, so a malformed card reaches `reduce` as `undefined` and fails at
 * runtime, in a live game, on a card nobody tested. Turning it into a throw here
 * makes it a build-time problem.
 */
export function sideOf(card: IdeologyCard, index: 0 | 1): IdeologySide {
  const side = card.sides[index];
  if (side === undefined) {
    throw new Error(`${card.id}: side ${index} is missing — an Ideology Card must have exactly two sides`);
  }
  return side;
}
