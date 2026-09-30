/**
 * `@shasn/cards` — the Shasn card corpus, its schema, its validator and its
 * balance checker.
 *
 * ```ts
 * import { loadCorpus, toEngineIdeologyCard, indexCards } from '@shasn/cards';
 * import '@shasn/engine'; // for indexCards
 *
 * const corpus = loadCorpus();
 * const index = indexCards({
 *   ideology: corpus.ideology.map(toEngineIdeologyCard),
 *   voter: corpus.voter.map(toEngineVoterCard),
 *   conspiracy: corpus.conspiracy.map(toEngineConspiracyCard),
 *   headline: corpus.headline.map(toEngineHeadlineCard),
 * });
 * ```
 */

export * from './corpus.js';
export * from './schema.js';
export * from './balance.js';
export * from './validate.js';
