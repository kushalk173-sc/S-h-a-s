/**
 * The game-mode registry.
 *
 * WHAT THIS IS. A match is created in one of a small, closed set of MODES, and a
 * mode is nothing more than a named bundle of decks plus a label to print. It is
 * deliberately the smallest thing that makes "which cards is this table playing
 * with?" answerable from one place.
 *
 * WHY A CLOSED SET AND NOT A STRING. `lobby:create` carries the mode on the wire,
 * so it is attacker-controlled. A free-form string would have to be resolved
 * against *something* downstream, and the resolution would live at the point where
 * a card is looked up — i.e. inside a live match. `isModeId` refuses the frame at
 * the trust boundary instead, which is the same reason `isSeatCount` exists beside
 * it in `validate.ts`.
 *
 * WHERE THE DECK LIST IS USED, AND THE ONE THING THAT HAS TO STAY TRUE. `MODES[m].decks`
 * is read once, at boot, by `loadModeCards` in `index.ts`, to build that mode's
 * `CardIndex`. Everything after that — the deal in `LobbyHub#startMatch`, the
 * rebuild in `replay` — reads the deck arrays off the resulting `CardIndex` via
 * `decksOf`, so the deck list is the single input and there is no second place
 * that decides which cards a match is played with. If a mode ever resolves its
 * decks anywhere else, that is the bug the replay tests in
 * `test/live-effect-replay.test.ts` exist to catch.
 */

import type { CardIndex, Ctx, Rules } from '@shasn/engine';

/**
 * The registry.
 *
 * ── WHY `azadi` HAS THE SAME DECKS AS `standard` ────────────────────────────────────
 *
 * **THIS IS DELIBERATE. DO NOT "FIX" IT.**
 *
 * `azadi` exists in this file because the plumbing for per-mode card sets is what
 * is being built here, and the Azadi card CONTENT is a separate, later piece of
 * work. Until that work lands, the honest thing for `azadi` to do is play exactly
 * the shipped corpus — so `azadi` today is a label, not a different game. Giving it
 * the same `decks` array as `standard` is therefore the correct value, and inventing
 * a deck that does not exist here would make the mode unstartable rather than
 * complete.
 *
 * When the Azadi cards land, the change is ONE entry in this object: add the deck
 * directory under `packages/cards/decks/`, add its id to `DECK_IDS` in
 * `packages/cards/src/corpus.ts`, and list it in `azadi.decks`. Nothing else in the
 * server needs to move — the per-mode `CardIndex`, the persisted mode and the
 * replay path all read from here.
 */
export const MODES = {
  standard: { decks: ['core', 'et2040', 'in2020'] as const, label: 'Shasn' },
  azadi: { decks: ['core', 'et2040', 'in2020'] as const, label: 'Shasn: Azadi' },
} as const;

export type ModeId = keyof typeof MODES;

/** Every mode id, in declaration order. */
export const MODE_IDS: readonly ModeId[] = Object.keys(MODES) as readonly ModeId[];

/**
 * The mode a match is played under when nothing says otherwise.
 *
 * This is what makes every match stored BEFORE modes existed replay correctly: they
 * were dealt from the whole shipped corpus, which is what `standard` is. The default
 * is therefore a historical fact, not a preference.
 */
export const DEFAULT_MODE: ModeId = 'standard';

/**
 * Narrow an untrusted value to a `ModeId`.
 *
 * The same shape and the same reason as `isSeatCount` in `validate.ts`: a closed set
 * of names, checked against the registry rather than parsed, so a frame naming a
 * mode that does not exist is refused at the wire instead of becoming a lookup that
 * returns `undefined` somewhere inside a live match.
 */
export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MODES, v);
}

/**
 * The mode a stored match was played under.
 *
 * A match stored before this field existed has none, and `DEFAULT_MODE` is the
 * correct reading of it for the reason above. A stored value that is not a `ModeId`
 * at all — a corrupt or hand-edited row — also falls back rather than throwing,
 * because the honest outcome for an unreadable mode is the historical one, and
 * `replay`'s `cardsVersion` check still refuses to restore it if the corpus that
 * falls back to is not the corpus it was dealt from.
 */
export function modeOf(match: { readonly mode?: unknown }): ModeId {
  return isModeId(match.mode) ? match.mode : DEFAULT_MODE;
}

/**
 * Every mode's `CardIndex`, built once at boot.
 *
 * ── WHY THIS IS A RECORD AND NOT A FUNCTION ───────────────────────────────────────────
 *
 * The obvious design is a function that loads a corpus per mode on demand. It is the
 * worse one: `loadCorpus` reads and parses the whole JSON corpus, so a per-match call
 * would re-parse every deck file on the hot path of opening a room, and — worse —
 * make the cost of a match depend on WHEN it was opened. The modes are a closed,
 * tiny set known at boot, so paying for all of them once at startup is strictly
 * cheaper and strictly more predictable.
 */
export type ModeCards = Readonly<Record<ModeId, CardIndex>>;

/**
 * The context a match in `mode` is played under.
 *
 * ── WHY THE RULES ARE SHARED AND ONLY `cards` VARIES ──────────────────────────────────
 *
 * `Ctx` is `{ rules, cards }`, and a mode is a bundle of DECKS. Both modes currently
 * run the same `RULES` object, so the only thing that differs is which cards the match
 * was dealt from. Splitting `rules` per mode as well would be the generalisation, and
 * it is deliberately NOT done here: `rulesVersion` hashes `Object.keys(rules)` and is
 * pinned into every stored match, so a mode with its own rule set needs a per-mode
 * version stamp before it can be persisted safely. That is a larger change than this
 * one, and doing it speculatively would buy nothing until a mode actually needs it.
 *
 * The rules are passed in rather than imported so that this function stays the ONLY
 * place a mode turns into a playable context. The deal in `LobbyHub#startMatch` and the
 * rebuild in `replay` both go through here, which is what makes them agree by
 * construction rather than by two authors remembering to keep them in step.
 */
export function ctxForMode(rules: Rules, cards: ModeCards, mode: ModeId): Ctx {
  return { rules, cards: cards[mode] };
}

/**
 * Every mode's context, in one object.
 *
 * The plural of `ctxForMode`, and it exists so that the two consumers that must agree
 * — the live deal in `LobbyHub#startMatch` and the rebuild in `store.replay` — hold
 * the SAME map rather than each rebuilding one. `LobbyHub` resolves this once in its
 * constructor and reads a mode out of it; `replay` receives it and reads the mode the
 * stored match was created under. Neither can drift, because neither decides anything.
 */
export function ctxsForModes(rules: Rules, cards: ModeCards): Readonly<Record<ModeId, Ctx>> {
  const out = {} as Record<ModeId, Ctx>;
  for (const id of MODE_IDS) out[id] = ctxForMode(rules, cards, id);
  return out;
}
