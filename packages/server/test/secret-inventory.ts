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
 * identical in the type — and the only fields where that ambiguity is expensive rather
 * than harmless are the ones a client is supposed to ENFORCE or PLAN AROUND:
 * `restrictions` (the reason a purchase is refused), `capOverride` (the ceiling p12 is
 * checked against) and `liveEffects` (what the table has hanging over it). A field that
 * quietly stops being projected is not a cosmetic regression. The game keeps enforcing
 * a rule no client can display, and the failure is a refusal with no visible cause,
 * which reads as a bug in the server and is not one.
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
 * `_pendingCard` IS STILL HERE, AND THAT IS A RULING rather than an omission.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * Full information made the card's CONTENT public: the question, both answers, both
 * Ideologues and both payouts go to every seat and every spectator, on `openQuestion`, in
 * `PublicQuestion`. So what is no longer secret is the PAYOUT — which was never a secret
 * anyway in any strong sense, because the Ideology corpus is public JSON in this
 * repository and every card's payout is one lookup away. What the old withholding actually
 * protected was *which* card was on the table.
 *
 * The id stays behind the underscore for a reason that is about MECHANISM rather than
 * about this card:
 *
 *  1. **`scripts/check-secrets.mjs` is the whole gate.** It fails the build on the mere
 *     MENTION of a `_`-prefixed field's name, in any file, comments included, and it works
 *     by the field being `_`-prefixed and named in `SECRET_NAMES` — the list above. That
 *     is the only mechanism in the repository that stops a server-only field reaching the
 *     wire, and it is worth more than the convenience of a public card id. Moving the
 *     value onto an unprefixed field would remove the mechanism's coverage of this one
 *     value, and PLAN.md §9 risk #2 means the payout is exactly the field somebody might
 *     later want to re-hide.
 *  2. **THE `manifestoCards` PRECEDENT DOES NOT TRANSFER, and it is worth saying why
 *     because it is the argument that would be made.** That precedent is safe because an
 *     ANSWERED card's payout has already been paid and revealed, so publishing its id adds
 *     nothing. Full information deletes exactly that condition — it makes an UNANSWERED
 *     card's payout public too — so the precedent is silent on this case and cannot be
 *     borrowed to justify publishing the id.
 *  3. **A narrower projection whose only job is to be less revealing than the broad one is
 *     the shape `broadcast.ts`'s own header calls the failure mode** ("second projections
 *     leak"). `openQuestion` is not that: it is the card, in content, for everybody, and it
 *     exists because the card belongs to the table. What it does NOT do is hand out the
 *     pointer.
 *
 * So the line is: **the card is public, its id is not.** `secret-state.test.ts` asserts
 * both halves over the production broadcast — that every viewer receives both whole
 * sides, and that no viewer's payload contains the pending card's id.
 *
 * WHAT BECAME PUBLIC, stated plainly because it is the consequence worth writing down:
 * **anyone can now look up every Ideology Card's payout from the public corpus**, at any
 * moment of any match, because every card in the deck is dealt to somebody in the course of
 * a game and its two payouts are printed when it is. That is not a leak — it is the change
 * — and what it costs is the GAME rather than the wire: a player computes the better side
 * instead of deliberating, so dominance in the shipped Ideology deck is now permanently
 * exploitable rather than merely a risk. See the `cardId` assertion in
 * `secret-state.test.ts` and the balance check in `packages/cards`.
 */

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
   * G20 — `PlayerState.ideologyCards`. THE ENTRY THE ENGINE OWED THIS FILE, and it is
   * now here.
   *
   * Same class as the hand above and for a stronger reason: the counterpart of an
   * unanswered card is that its holder does not know what it is, and the answer to a
   * blind card is a coin flip the player makes. So a player shown the card in their own
   * hand has not made one.
   *
   * The rulebook draws the line at *answered*: p13 keeps a card hidden "until the active
   * player confirms their answer", a donated card has not been answered, and the card
   * is put to its holder at their next turn boundary. That is the hidden side of the
   * line, along with `conspiracies`, and NOT the public side along with
   * `manifestoCards` — so `PRIVATE_PLAYER_KEYS` strips it for every viewer with no
   * `pid === viewer` branch.
   *
   * It was owed rather than missing by accident: the ruling is on the field in
   * `packages/engine/src/state.ts` and the strip is in `playerView.ts`, both of which
   * say in as many words that the entry beside `conspiracyHand` over here is required.
   * A list that rots silently is worse than no list, which is why this file's own header
   * makes that argument — and an omission nobody can distinguish from a ruling is
   * exactly the failure mode. `secret-state.test.ts` now walks BOTH entries generically,
   * so this is no longer documentation: the payload is checked against it.
   */
  ideologyHand: 'players[].ideologyCards',

  /**
   * The ONE narrow exception to the rule above, and it is not an exception to the
   * hand: `playableConspiracies` is a per-VIEWER list of that viewer's own cards,
   * narrowed to the ones `reduce` will accept for a `PLAY_CONSPIRACY` right now. It is
   * empty whenever the viewer could not play one, and it never contains a card
   * held by anybody else.
   *
   * It is listed here because it is the field a future refactor is most likely to
   * "simplify" — widen it to the whole hand, hoist it out of the phase/turn guards, or
   * compute it once per match instead of per projection. Each of those is a
   * regression this file's block in `secret-state.test.ts` fails on.
   *
   * The two shapes in this list are asserted DIFFERENTLY, and that difference is the
   * point rather than an inconvenience: a `players[].X` path must be EMPTY for every
   * viewer including the owner, while this one must be a SUBSET OF THE VIEWER'S OWN
   * HAND. A generic walk that demanded "empty" of both would be wrong about this entry,
   * and a generic walk that demanded "subset of your own hand" of both would be wrong
   * about the hands — so `secret-state.test.ts` branches on the path shape.
   */
  playableConspiracies: 'playableConspiracies[]',
} as const;

/**
 * The `Choice` kinds this suite has CLASSIFIED, and what each one is allowed to ask a
 * player about.
 *
 * WHY A LIST OF CHOICE KINDS AT ALL. `Choice` is the one place the engine hands a
 * player a decision, and it is therefore the one place a leak can arrive without any
 * `_`-prefixed field to trip over: a choice that said "pick one of these cards" would
 * enumerate a hidden hand, and nothing in the prefix walk or in `LEAK_PATHS` would see
 * it, because the leak would be in a VALUE the engine chose to publish rather than in a
 * field it forgot to strip.
 *
 * `choose-player` and `choose-zone` (G1 and G16) are here because the parallel engine
 * work added them this round and the guard did its job: they arrived unclassified, which
 * is the moment somebody has to look at them. Both are safe, and for the same reason
 * the two G16 selectors that need no decision are safe — the board is fully public (nine
 * fixed areas, every peg face up) and the seats are public (`turnOrder`), so a PlayerID
 * and a ZoneID are things every viewer already has. Neither can name a card.
 *
 * A `Choice` also carries the card's `source` (the ACTOR, a PlayerID — never a CardID)
 * and the effect list to run. Neither is a card identity: the actor of a card already on
 * the table is on the public log, and an effect list is behaviour, not an id. That is
 * the argument; `secret-state.test.ts` asserts it rather than trusting it, by checking
 * that no CardID from the corpus appears anywhere in a serialised `PendingChoice`.
 */
export const CHOICE_KINDS = {
  /** "gain N resources of your choice" — currencies. */
  'gain-any': 'resources',
  /** "discard N resources of your choice" — currencies, from the chooser's own hand. */
  'lose-any': 'resources',
  /** "take N resources from a chosen opponent" — a player id, then currencies. */
  'steal-any': 'resources',
  /** "evict N voters" — pegs on the board, which are public. */
  'evict-voter': 'pegs',
  /** "discard N voters" — pegs on the board, which are public. */
  'discard-voter': 'pegs',
  /** "convert N voters" — pegs on the board, which are public. */
  'convert-voter': 'pegs',
  /** G1 — "a player of your choosing": names seats, which `turnOrder` already lists. */
  'choose-player': 'players',
  /** G16 — "a constituency of your choosing": names board areas, which are public. */
  'choose-zone': 'zones',
  /**
   * G17 — "a card of your choosing": names CARDS, and is the first entry here that does.
   *
   * `'public-cards'` is a fifth value and this file's own prose said the list was a
   * secrecy grade, so the classification is re-argued rather than the assertion
   * relaxed: **`CHOICE_KINDS` records WHAT A PLAYER IS ASKED ABOUT, not how much they
   * are allowed to know.** Resources, pegs, seats and constituencies are four names
   * for four sets that happen to be public; cards are a fifth name, and the fact that
   * this one needed an argument is an argument about THIS SET, not about cards as a
   * category. A `'choose-card'` over a player's hand would be classified exactly the
   * same way and would be refused by the assertion below just as hard.
   *
   * Why this particular set is public is on the field, in `ClientState.conspiracyRecycle`
   * (`packages/engine/src/playerView.ts`), and it is a DERIVATION rather than an
   * assurance: `_conspiracyDiscard` has four assignment sites in `reduce.ts` and six
   * write paths, and every one is accounted for by the log — `Played "NAME"` puts a card
   * on the pile and `Picked "NAME"` takes one off, so the pile EQUALS what replaying
   * those two lines yields, in order. The reshuffle empties it and is unreachable for
   * this deck. `secret-state.test.ts` asserts the equality and re-derives the writer list
   * by slicing `reduce.ts`, so the argument cannot rot into a bare name.
   *
   * **AND WHAT IT DOES NOT CLAIM:** that cards are generally offerable. A decision
   * naming a card from `_ideologyDraw`, `_ideologyDiscard`, `_headlineDraw`,
   * `_voterDraw` or `PRIVATE_PLAYER_KEYS` is refused by the card assertion below, and
   * this entry is not what stops it.
   */
  'choose-card': 'public-cards',
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
   * G15 — `PlayerState.capOverride`. THE THIRD ENTRY, and the one added because the
   * inventory's own failure mode had come true.
   *
   * **THE PREMISE THAT PROMPTED IT WAS REFUTABLE, AND HALF OF IT WAS FALSE.** A client
   * reported that it is told a player is over cap by a dialog whose ceiling it cannot
   * see, and asked for the ceiling to be published. It is already published: the field
   * is unprefixed and is not in `PRIVATE_PLAYER_KEYS`, so it goes through
   * `playerView`'s `players` clone untouched and reaches every viewer — owner, opponent
   * and spectator alike. Nothing about the wire needed to change. What was missing is
   * the RECORD, and this is the entry.
   *
   * Why it belongs here rather than being left as an unconsidered field:
   *
   *  - **It is the same class as `restrictions`, by the engine's own argument.** p12's
   *    cap is printed on the player's mat, and a ceiling somebody else must predict
   *    before they act is a different game — `state.ts` says so on the field itself
   *    ("PUBLIC, and why it owes the server nothing"). THE BIG FREEZE lowers it and
   *    `expireCapOverrides` lifts it back at the turn boundary; a player who cannot see
   *    the current number is being asked to comply with a rule that is not on their mat.
   *  - **The failure this file exists for is an omission nobody can distinguish from a
   *    ruling.** The field is public, load-bearing the moment a `set-cap` card ships,
   *    and recorded nowhere. The next reader — or the next agent — sees an unprefixed
   *    optional field with no entry and has to re-derive the visibility argument from
   *    `state.ts`, which is exactly the re-derivation this list is supposed to prevent.
   *
   * **AND ITS OPTIONALITY IS PART OF THE CONTRACT, which is the part a client has to
   * survive.** `capOverride` is `undefined` — not `{to: printed, expiresTurn: null}` —
   * when nothing is holding it down, because a required field would break the
   * hand-built `PlayerState` literals in packages the engine may not edit. So "absent"
   * is a real, meaningful wire state that means the printed cap, and
   * `JSON.stringify` turns it into a MISSING KEY rather than an `undefined`. That is
   * asserted in `public-payload.test.ts`, which is the only place a wire claim about an
   * optional key can be made honestly.
   */
  capOverride: 'players[].capOverride',

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

  /**
   * G17 — `ClientState.conspiracyRecycle`. THE FOURTH ENTRY, and the first one whose
   * value is the CONTENTS of a `_`-prefixed pile rather than a per-seat rule or a
   * standing effect. It is listed for the same reason as the other three and with a
   * sharper edge, because this one is a list a client is expected to CHOOSE FROM:
   * SELECTIVE ACCESS MEMORY renders a picker over it, so a field that quietly stopped
   * being projected is a card that resolves into a dialog offering nothing.
   *
   * The argument is `ClientState.conspiracyRecycle`'s own, and it is a derivation from
   * the public log rather than a promise: `_conspiracyDiscard` has four assignment sites
   * in `reduce.ts` and six write paths; `Played "NAME"` puts a card on the pile,
   * `Picked "NAME"` takes one off by the recipient, the `to: 'discard'` exit is a
   * byte-identical round trip that owes no line, and the reshuffle — which is
   * unreachable for this deck — empties the pile. So the published list EQUALS the log
   * replay, and `[]` across a reshuffle is what keeps `_seed` out of it, because after a
   * reshuffle the new draw order IS `shuffle(discard, _seed)`.
   *
   * **THE DEPARTURES ARE WHY THE EQUALITY IS EQUALITY.** Both take paths used to remove a
   * card with no log line, which was sound while the pile was server-only and was a
   * covert channel once it was published: a spectator diffing two payloads could deduce
   * which card went into whose hidden hand. They announce now, which is both the fix and
   * the faithful behaviour — the pile is face up at a real table.
   *
   * **`this file is not a test and this entry is not a rulebook`**: what makes the list
   * *sound* is that no fourth writer exists, and that is asserted by slicing
   * `reduce.ts` in `secret-state.test.ts` rather than by anything written here. A
   * `draw-conspiracy { to: 'discard' }` over `_conspiracyDraw` is refused in the
   * reducer for exactly this reason — a card nobody played is not in the log, so
   * publishing the list would publish the draw pile by another route.
   */
  conspiracyRecycle: 'conspiracyRecycle[]',
} as const;
