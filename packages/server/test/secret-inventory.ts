/**
 * The declared secret inventory.
 *
 * The engine strips by `_` PREFIX, which is why the structural walk in
 * `secret-state.test.ts` needs no list: a new `_` field is covered automatically
 * the moment it follows the convention. That is the property, and it is why the
 * prefix is load-bearing rather than stylistic.
 *
 * But two checks DO need names, and this file is them:
 *
 *  - the value scan (does any card id or the seed appear in the payload?) needs the
 *    field names to know which piles to read;
 *  - the error-string audit needs to assert that no engine failure message names a
 *    field, which would confirm the internal shape to somebody fuzzing.
 *
 * So the list is pinned against the live state: `declares exactly the eleven the
 * engine keeps server-only` fails loudly if the engine grows a twelfth. A list
 * that rots silently is worse than no list, and the ten-vs-three `Omit` mismatch
 * in the original `playerView` is the proof of that.
 */

export const SECRET_FIELDS = [
  '_pendingCard',
  '_ideologyDraw',
  '_ideologyDiscard',
  '_voterDraw',
  '_voterDiscard',
  '_conspiracyDraw',
  '_conspiracyDiscard',
  '_headlineDraw',
  '_headlineDiscard',
  '_seed',
  '_idSeq',
] as const;

/**
 * The hidden fields that are NOT `_`-prefixed, and so are invisible to the prefix
 * walk. Each one is a separate leak class, and each needs its own assertion.
 */
export const LEAK_PATHS = {
  /**
   * A Conspiracy Card is bought and held (rules-reference.md:284-286). It is not
   * `_`-prefixed, so the strip does not touch it and `players` is copied wholesale.
   * The engine's own fix strips it for EVERYONE, owner included — shipping a hand
   * to its owner turns a bluffing mechanic into a solved one.
   */
  conspiracyHand: 'players[].conspiracies',

  /**
   * The ONE narrow exception to the rule above, and it is not an exception to the
   * hand: `playableConspiracies` is a per-VIEWER list of that viewer's own cards,
   * narrowed to the ones `reduce` will accept for a `PLAY_CONSPIRACY` right now. It
   * is empty whenever the viewer could not play one, and it never contains a card
   * held by anybody else.
   *
   * It is listed here because it is the field a future refactor is most likely to
   * "simplify" — widen it to the whole hand, hoist it out of the phase/turn guards,
   * or compute it once per match instead of per projection. Each of those is a
   * regression this file's block in `secret-state.test.ts` fails on.
   */
  playableConspiracies: 'playableConspiracies[]',
} as const;
