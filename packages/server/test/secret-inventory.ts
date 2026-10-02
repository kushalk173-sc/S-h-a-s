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
 * engine keeps server-only` fails loudly if the engine grows a twelfth. A list that
 * rots silently is worse than no list, and the ten-vs-three `Omit` mismatch in the
 * original `playerView` is the proof of that.
 *
 * THE OTHER HALF OF THIS FILE IS `PUBLIC_BY_DESIGN` below, and it exists because the
 * `_` prefix cannot record a decision. A field that is unprefixed is public BY
 * DEFAULT, which means "nobody thought about it" and "somebody decided it" look
 * identical in the type — and the only field where that ambiguity is expensive rather
 * than harmless is one a client is supposed to ENFORCE. `restrictions` is that field:
 * if it stops reaching the client, the server keeps refusing illegal purchases and no
 * player can see why. An omission nobody can distinguish from a ruling is the failure
 * mode; see the comment on the entry.
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

/**
 * Fields that are PUBLIC BY A DECISION, recorded here so the decision is legible.
 *
 * Neither of these is `_`-prefixed, so the structural walk above cannot tell them
 * apart from a field nobody has classified. That is fine for a field nobody reads —
 * and it is not fine for these two, because a client is expected to act on both:
 * `restrictions` is the reason a purchase is refused and `liveEffects` is what the
 * table has hanging over it. A field that quietly stops being projected is not a
 * cosmetic regression. The game keeps enforcing a rule no client can display, and
 * the failure is a refusal with no visible cause, which reads as a bug in the server
 * and is not one.
 *
 * The shape here is a PATH plus a reason, deliberately. A bare list of names would
 * say "these are fine"; a list with the argument attached is what stops the next
 * reader — or the next agent — from "fixing" a public field into a `_`-prefixed one
 * on the theory that unprefixed means unconsidered. `public-payload.test.ts` asserts
 * each entry is actually PRESENT in the payload for every viewer, so this file's
 * claim and the wire agree.
 */
export const PUBLIC_BY_DESIGN = {
  /**
   * G5 — `PlayerState.restrictions`. A DELIBERATE NON-SECRET, on the ruling recorded
   * on `Restriction` in `packages/engine/src/state.ts`.
   *
   * The argument, in short: every real card that imposes a restriction announces it,
   * so there is nothing to conceal even in principle. KHAKI TERROR's entire punchline
   * is that **everyone can see you cannot buy** — a lock only the affected player can
   * see is not that card, it is a soft-lock with extra steps. And a surcharge (PYTHONPOST,
   * SNOOP B-O-DOUBLE-T, DON'T KISS THE BABIES) is a PRICE, which every other player
   * has to be able to predict before they act; a tax they learn about after they buy
   * is a different game.
   *
   * So: do NOT add `restrictions` to `PRIVATE_PLAYER_KEYS`, and do not `_`-prefix it.
   * Either would make a correctly-public field secret, and the test in
   * `public-payload.test.ts` is the thing that would fail.
   */
  restrictions: 'players[].restrictions',

  /**
   * G9 / G22 — `GameState.liveEffects`. Public for the same structural reason, and
   * argued on `LiveEffect` in `state.ts`: a live effect can only be created by a card
   * being *resolved*, and both `PLAY_CONSPIRACY` and `ACK_HEADLINE` put that card face
   * up on the discard pile in the same breath — so `sourceCardId` can never name a
   * card in a hidden hand, and the engine's own `live-effects.test.ts` asserts that
   * rather than trusting the argument. Every real card that installs one announces it.
   *
   * Included here for the same reason as `restrictions`: a lasting effect is a thing
   * a player has to be able to see and plan around, and "public" that quietly becomes
   * "invisible" is the exact bug class this file is here to catch.
   */
  liveEffects: 'liveEffects[]',
} as const;
