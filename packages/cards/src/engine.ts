/**
 * The single point where `@shasn/cards` touches `@shasn/engine`.
 *
 * WHY RELATIVE PATHS INSTEAD OF `@shasn/engine`:
 * the engine's public entry point (`packages/engine/src/index.ts`) re-exports
 * `config`, `capital`, `zones`, `manifesto`, `gerrymander`, `apply` — modules
 * that are being repaired in parallel and, at the time of writing, do not all
 * exist. It does **not** re-export `./cards` or `./rules` at all, so `sidePayout`,
 * `RULES`, `IdeologyCard` and `Effect` are unreachable through the package name.
 *
 * The three leaf modules imported below (`cards.ts`, `rules.ts`, `state.ts`) are
 * the actual contract this package authors against and are exactly the files the
 * task brief points at. They are the most stable part of the engine and they
 * import nothing from it.
 *
 * Once the engine repair lands and `index.ts` re-exports `./cards` and `./rules`,
 * delete this file and repoint every import at `@shasn/engine`. Nothing else in
 * this package reaches into `packages/engine`.
 */

export type {
  Advisory,
  CardIndex,
  ConspiracyCard,
  Effect,
  EffectDuration,
  EffectScope,
  EffectTarget,
  EffectTiming,
  EffectTrigger,
  HeadlineCard,
  IdeologyCard,
  IdeologySide,
  Interrupt,
  VoterCard,
  XCardScope,
} from '../../engine/src/cards';

export { indexCards, sidePayout } from '../../engine/src/cards';

export type { CardID, Delta, Ideologue, PlayerID, Pool, Resource } from '../../engine/src/state';
export { IDEOLOGUES, IDEOLOGUE_RESOURCE, RESOURCES, RESOURCE_IDEOLOGUE, deltaTotal } from '../../engine/src/state';

export { RULES } from '../../engine/src/rules';
export type { Rules } from '../../engine/src/rules';
