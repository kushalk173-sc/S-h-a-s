/**
 * Card shapes and the effect language.
 *
 * The engine interprets effects; it never authors them. Actual card content lives
 * in `@shasn/cards` as JSON, so a card is reviewable in a pull request and a
 * balance bug is a data fix, not a code change.
 */

import type { CardID, Delta, Ideologue, Resource } from './state';

// ─────────────────────────── Ideology Cards ───────────────────────────

export type IdeologySide = {
  /** The answer as the right-hand player reads it aloud. */
  readonly answer: string;
  readonly ideologue: Ideologue;
  /** p13: "Every answer will yield a different set of resources." */
  readonly pays: Delta;
};

export type Advisory = 'mature' | 'trigger';

export type IdeologyCard = {
  readonly id: CardID;
  readonly campaign: string;
  readonly question: string;
  /** p14: cards with sensitive themes may be removed before the game begins. */
  readonly advisory?: Advisory;
  readonly sides: readonly [IdeologySide, IdeologySide];
};

// ─────────────────────────── Voter Cards ───────────────────────────

export type VoterCard = {
  readonly id: CardID;
  /** The printed resource combination. p10. */
  readonly cost: Delta;
  /** p10: "Voter Cards can contain 1, 2 or 3 voters." */
  readonly voters: number;
};

// ─────────────────────────── effects ───────────────────────────

/**
 * Who an effect lands on. Defaults to the card's player.
 *
 * `'chosen-player'` is G1 and is the FIRST member here that is not a fixed set of
 * seats: it is a DECISION, and it is resolved one function above `applyEffect`'s
 * switch. `reduce()` reads it by raising a `'choose-player'` `Choice` for the card's
 * own actor, carrying the effect list the engine re-runs once the player is named —
 * so a card naming it gets a real `RESOLVE_CHOICE`, not a silent no-op.
 *
 * **WHY THE CARD'S ACTOR IS THE ONE WHO ANSWERS.** Every real card that uses it
 * names its own player as the chooser in the printed text — *"Pick an opponent"*,
 * *"Choose a player"*, *"Pick up to 2 opponents"*. Nobody else has standing to
 * choose, and letting the effect's `target` set decide it would mean a
 * `target: 'everyone'` card picks the victim.
 *
 * **THE CANDIDATE SET IS EVERY SEAT BUT THE ACTOR'S, and it is fixed, not
 * filtered.** A `steal-any` with no `target` lets the thief pick a victim with
 * nothing to hold against, which is the same rule (`steal-any`'s resolver refuses a
 * self-pick), so a candidate who holds nothing is a legal *answer* — the effect
 * simply resolves to nothing for them, exactly as `min(count, 0)` already makes a
 * theft from an empty pool resolve to nothing. Filtering candidates by whether they
 * hold something would make the option list a function of hidden state, which is the
 * leak this design is refusing (see `PlayerState.ideologyCards`).
 */
export type EffectTarget =
  | 'you'
  | 'each-opponent'
  | 'everyone'
  /** The player currently holding the most majority voters. Ties → nobody. */
  | 'leader'
  /** G1 — the card's actor names one player, from every seat but their own. */
  | 'chosen-player'
  /**
   * G12 — the seat immediately AFTER the card's actor in `GameState.turnOrder`,
   * wrapping. **A fixed seat, not a decision, and never an empty list.**
   *
   * ## WHY ONE INDEX SERVES TWO RECOVERED PHRASINGS
   *
   * A COWARD OR A JOURNALIST? (REF 4.1) reads *"Starting from you, each player can
   * donate 1 of their Ideology Cards to **the opponent on their left**"*; GREAT
   * LEADER, BAD ECONOMY (REF 4.2.1) reads *"**the player after you** may move 1 of
   * your non-majority voters to an adjacent zone."* In a turn order that runs
   * clockwise, those are the same seat, so one union member is honest to both rather
   * than two values that differ only in which card happens to use them.
   *
   * ## IT IS NOT A DECISION, and that is the whole reason it is cheap
   *
   * `'chosen-player'` had to raise a `Choice`, a new wire-format kind, and a
   * satisfiability proof. This needs none of that: the seat is a **pure function of
   * `(turnOrder, source)`**, both public, so a replay from seed + action log derives
   * it without re-running anything — R2, the same property that made
   * `'this-zone'` safe in G16. There is nothing to render, so `derive.ts` needs no
   * arm and no client change is owed for the decision itself.
   *
   * ## IT CANNOT BE UNSATISFIABLE
   *
   * `setup()` supports 2..5 seats (rules-reference.md pp26-40) and a table always has
   * a seat after the actor's — with two seats it is the actor's only opponent, and
   * `(i + 1) % n` is `1` in a two-seat game. A one-seat table does not exist, so
   * `resolveTargets` can return an empty list here only for a hand-built state, and it
   * degrades to "affects nobody" rather than to a decision nobody can answer. Asserted
   * at 2/3/4/5 seats in `test/choices.test.ts`.
   *
   * ## VISIBILITY: PUBLIC, and it discloses nothing at all
   *
   * `turnOrder` is on every payload already, so this names a seat rather than
   * revealing a set. It is the same class of read as `'leader'`, which is also a
   * function of public state. **No `_`-prefixed field is added**, so
   * `packages/server/test/secret-inventory.ts` owes nothing.
   *
   * ## WHAT IT IS NOT, and the two refusals
   *
   *  - **Not `'left-of-me'`.** Same seat, second name, and a second member would be a
   *    second spelling the engine cannot distinguish — which is the exact failure
   *    `packages/cards/src/executable.ts` exists to prevent. It is also not true in
   *    every reading: the recovered corpus has both phrasings for ONE seat, and
   *    naming it after the card that is easier to implement is how a card ends up
   *    reading as though it did something directional that it does not.
   *  - **Not a per-opponent iteration.** *"Starting from you, **each** player"* is a
   *    loop over the table, and one `EffectTarget` is resolved once for the whole
   *    effect list (`applyEffect` computes one `target`). That half of the card is
   *    dropped and named on the card rather than approximated.
   */
  | 'player-after';

/**
 * G16 — WHICH constituency a voter-targeting op may reach.
 *
 * Three values, and each one is a recovered card's own wording:
 *
 *  - `'this-zone'` — the Volatile Area whose placement drew the Headline being
 *    resolved. Read out of `GameState.headlineQueue[0]` rather than threaded down
 *    from `ACK_HEADLINE`, which is what keeps `reduce()` a pure function of
 *    `(state, action, ctx)`: the zone is already in the state that was written
 *    down, so a replay derives it without re-running anything. REF 4.1 says so
 *    outright about NERO'S GUESTS: *"'this zone' = the volatile zone that triggered
 *    it."*
 *  - `'your-strongest'` — the zone the actor holds the most pegs in, ties broken by
 *    `ZONE_IDS` order so it is a pure function of the board. JUST BREATHE's
 *    *"Select the zone where you have the most number of voters"*.
 *  - `'chosen-zone'` — the actor names one of the nine constituencies. That is a
 *    DECISION, so it raises a `'choose-zone'` `Choice` like `'chosen-player'` does,
 *    and it is raised only when a zone is legal — see `resolveChoice`.
 *
 * ## WHY A FIELD AND NOT A NEW OP
 *
 * NERO'S GUESTS moves voters, CUT COPY AND PASTE converts them and JUST BREATHE
 * evicts them: three different verbs, one shared narrowing. A `zone` on the three
 * voter ops expresses all three, and every op that does not read the field simply
 * has none — which is what `packages/cards/src/executable.ts` checks, from the
 * reducer's own source text, per op.
 *
 * ## WHAT IT CANNOT BE, and the two refusals
 *
 *  - **No `'adjacent'` selector.** JUST BREATHE's second clause moves the voters
 *    into an ADJACENT zone, and no recovered card that needs one can be shipped
 *    without a destination decision on top of a source decision. It is dropped and
 *    named rather than approximated.
 *  - **No `'zone-you-lead'`.** It would be satisfiable in ZERO zones for a player
 *    holding no majority, which is the unsatisfiable-choice bug class this codebase
 *    has been bitten by three times. A selector that can resolve to nothing must
 *    either raise nothing at all (which `'chosen-zone'` does, and `'this-zone'` and
 *    `'your-strongest'` do too by falling back to every zone) or clamp. Since no
 *    recovered card in this corpus needs it, it is not in the union.
 */
export type ZoneSelector = 'this-zone' | 'your-strongest' | 'chosen-zone';

/**
 * FIELDS THAT ARE PART OF THE CARD CONTRACT BUT NOT YET INTERPRETED.
 *
 * Exactly one family is still inert: `interrupt` (G13). `reduce()`
 * (`packages/engine/src/reduce.ts`) does not read it, so a card that sets one
 * resolves exactly as if it were absent. That is not a licence to ship such a
 * card — it is the reason the corpus validator rejects them.
 *
 * CLOSED SINCE THIS BLOCK WAS WRITTEN, and kept here so the next reader does not
 * re-derive the same history:
 *  - `duration` / `timing` (G9 / G22) — EXECUTED by `installLiveEffects`, which
 *    writes a `GameState.liveEffects` entry whose `activeFrom` / `expiresAt` are
 *    absolute turn numbers, ticked in `advanceTurn`.
 *  - `when` / `until` / `condition` (G14) — EXECUTED by `fireTriggers`, a bounded
 *    cascade consulted by `INFLUENCE`, `BUY_CONSPIRACY`, `GERRYMANDER`, `setArea`
 *    and the turn boundary.
 *  - `target` on `gerrymander` (G8) — EXECUTED; the case loops `resolveTargets`.
 *
 * WHY THE INERT ONE IS HERE AT ALL, in this file rather than only in
 * `packages/cards/schema/card.schema.json`: a shape nobody has written down is a
 * shape nobody will implement, and this is the one file the engine owner reads.
 * It is grouped here, named RESERVED, and it is listed in
 * `packages/cards/KNOWN-GAPS.md` with the reducer change it waits on.
 *
 * THE RULE, and it is the only rule that matters:
 * **a card must not ship using behaviour the engine does not perform.** The
 * validator in `packages/cards/src/validate.ts` enforces that (finding codes
 * `EFFECT_NOT_EXECUTED`, `EFFECT_FIELD_NOT_EXECUTED`, `CARD_FIELD_NOT_EXECUTED`),
 * and `packages/cards/test/reducer-parity.test.ts` re-asserts it over the whole
 * shipped corpus against BOTH `applyEffect`'s and `installLiveEffects`'s own
 * source text, so an inert field cannot reach a deck.
 */

/** G9/G22 — how long an effect lasts. EXECUTED by `installLiveEffects`. */
export type EffectDuration = 'this-turn' | 'round' | 'next-turn' | 'rest-of-game';

/** G22 — when a persistent effect starts. `'next-turn'` must not apply to the resolving turn. */
export type EffectTiming = 'now' | 'next-turn' | 'after-this-turn';

/**
 * G14 — the events an effect can be installed as a hook on. EXECUTED by
 * `fireTriggers`, which `INFLUENCE`, `BUY_CONSPIRACY`, `GERRYMANDER`, `setArea` and
 * the turn boundary all consult.
 */
export type EffectTrigger =
  /** The top of a turn, after expiry has been ticked. */
  | 'on-turn-start'
  /** INFLUENCE or BUY_CONSPIRACY: a purchase of anything. */
  | 'on-purchase'
  /** INFLUENCE only: a Voter Card was bought. `FireContext.voters` carries its size. */
  | 'on-voter-influenced'
  /** `setArea` put a peg into a Volatile Area. p18. */
  | 'on-volatile-placement'
  /** A GERRYMANDER moved a voter. `FireContext.pegOwner` says whose. */
  | 'on-gerrymander'
  /** `setArea` formed or broke a majority. */
  | 'on-majority-formed';

/**
 * G15 / G4 — a count read out of player state instead of written on the card.
 *
 * `of` names WHAT is read, and the value is always read from the player the effect
 * is resolved FOR (the recipient, or the thief for `steal-any`). A card that says
 * "as many as you hold" therefore means the recipient's own pool.
 */
export type ComputedSource =
  /** Total resources the player holds. */
  | 'your-pool'
  /**
   * The Ideologue LEVEL the player has reached. See the long note on the
   * implementation in `reduce.ts` `computedValue`: the engine's real unlock rule
   * counts Ideology **Cards** answered (`powers.ts` `hasPower`), not resources
   * paid, and this reads the engine's rule rather than the balance checker's
   * resource proxy.
   */
  | 'ideologue-level'
  /** Gerrymander moves the player may still make this turn, across every zone. */
  | 'your-gerrymander-rights'
  /** Pegs the player owns that sit in a Volatile Area. p18 pegs there are permanent. */
  | 'volatile-voters'
  /**
   * For `per` only: what the player holds OF THE RESOURCE BEING GAINED. This is
   * what makes IF YOU LIKE PIÑA COLADA's "double all the resources on your player
   * mat" expressible — `res` of 1 in each resource, multiplied by the holder's own
   * count of that resource, is a doubling. The cap still applies afterwards, which
   * is the card's own second sentence.
   */
  | 'held-of-each-resource'
  /**
   * How many cards the player has REVEALED face up in the current resolution. Reads
   * `GameState.revealedCards` for the player the effect resolves FOR.
   *
   * ## WHY THIS MEMBER IS SAFE AND EVERY OTHER HIDDEN SET IS NOT IN THIS UNION
   *
   * §2bis, quoted on `GameState.revealedCards`: *"you may choose a card the whole table
   * can already see, or the top of a pile nobody can see; you may never be shown what is
   * in a pile."* **Every id this counts has been turned face up**, so the count is a
   * count of public information and the union needs nothing else to say about secrecy.
   * The two piles and two discard lists that would make an equivalent source a leak are
   * absent on purpose: they are `_`-prefixed, and a `ComputedSource` is read by
   * `computedValue` before anything is resolved, so an entry naming one would be a
   * `n` or a `per` multiplier whose value is a function of a hidden set — the
   * enumeration the rule refuses, wearing a number as a disguise.
   *
   * ## WHY IT IS A COUNT AND NOT A `choose-card`, restated because it is the trap
   *
   * A count discloses how many cards are face up, which is a thing every client can see
   * by looking at the table. The set's CONTENTS are disclosed too, and that is sound
   * only because each one is face up — which is why this source can only ever name
   * `revealedCards` and not a pile. **A card that wanted a player to CHOOSE among
   * revealed cards has nothing to write**: it already has `choose-card`, whose candidate
   * set is a set every viewer already holds, and revealed cards are now such a set.
   */
  | 'revealed-card';

export type ComputedCount = { readonly of: ComputedSource };

/**
 * G14 — narrowing on the event that woke a hook. All present keys must hold.
 *
 * Every key is optional and the semantics are AND, because the two real cards that
 * need one need two at once: POWER TRIP is "every time **you** influence a
 * **3**-Voter Card", which is `byOwner` plus `influencedVotersAtLeast`.
 */
export type EffectCondition = {
  /** The event's actor is the effect's own `owner`. */
  readonly byOwner?: boolean;
  /** The purchase that woke the hook was a Voter Card with at least this many voters. */
  readonly influencedVotersAtLeast?: number;
  /** The voter the event moved belongs to the effect's `owner`. GROWING DISSENT. */
  readonly movedMyVoter?: boolean;
};


/**
 * G13 — phase-changing ops.
 *
 * These are deliberately NOT in `Effect`. REF 5.4 is emphatic and the recovered
 * card text bears it out: a BLOCK, a DEFLECT, an AUCTION and a VOTE change *which
 * phase of play is running*, not how many resources anyone holds, so no amount of
 * parameterising the effect list will express them. They are a sibling field on
 * the X-card types for exactly that reason, and `reduce()` reads this object in
 * `RESPOND_INTERRUPT` — one function a long way from `applyEffect`.
 *
 * ## WHAT IS EXECUTED, and the narrowing that bought it
 *
 * `block` and `deflect` are EXECUTED. `auction`, `vote` and `pass-card` are
 * declared and refused, and KNOWN-GAPS G13 records why for each: an auction needs
 * a `PlayerState` debt field and an IOU, a vote needs a ballot with a re-vote rule
 * and a payoff that is itself G20 card movement, and a pass needs something to pass
 * the card ON TO, which is G12's in-flight queue plus G20's `move-card`. Declaring
 * an op and then not honouring it is the card that lies, so the two that are
 * honest are the two that ship and the other three carry a per-op refusal.
 *
 * **`window` and `target` were narrowed from three values each to two and two.**
 * That is not tidying — it is the honesty gate. `reduce()` reads both fields, and a
 * third value it could not distinguish would be a declaration the engine ignores,
 * which is exactly the failure `packages/cards/src/executable.ts` exists to stop.
 * The two dropped values are named in that file and in KNOWN-GAPS G13.
 */
export type Interrupt = {
  readonly op: 'block' | 'deflect' | 'auction' | 'vote' | 'pass-card';
  /**
   * WHEN the holder may answer another card.
   *
   *  - `'always'` — in any phase in which a response window is open. This is the
   *    printed reading of both real cards: BLOCK says "play this IMMEDIATELY out of
   *    turn when an opponent plays a Conspiracy Card", and DEFLECT says "you may
   *    play this IMMEDIATELY". Neither is tied to the answer phase.
   *  - `'pre-answer'` — only while `phase === 'answer'`, the p19 window
   *    ("immediately before an opponent answers"). Kept because it is the narrower
   *    and more defensible reading, and it is what a card wants if its author wants
   *    to forbid an answer-phase block.
   *
   * The dropped third value was `'out-of-turn'`, because `RESPOND_INTERRUPT`
   * already refuses the actor ("you played that card"), which is the whole of what
   * it meant. A value the engine cannot distinguish from another is a value the
   * engine is not reading.
   */
  readonly window: 'pre-answer' | 'always';
  /**
   * WHICH cards the holder may answer.
   *
   *  - `'any-card'` (the default reading) — anything currently in the window.
   *  - `'card-affecting-you'` — only a card whose effect list reaches a player other
   *    than the card's own actor, which is the engine's approximation of DEFLECT's
   *    "a Conspiracy or Headline card that AFFECTS YOU". It is an approximation
   *    and is labelled as one: the engine computes one `target` for the whole
   *    effect list rather than per effect, so this answers "does this card reach
   *    past its player", not "does it reach THIS player".
   *
   * The dropped third value was `'any-player'`, for the same reason: it is
   * indistinguishable from `'any-card'` in every position the window can be in.
   */
  readonly target?: 'any-card' | 'card-affecting-you';
};

/**
 * LIFETIME AND TRIGGER — the two scope fields every `Effect` carries.
 *
 * Both are EXECUTED, by `installLiveEffects` and `fireTriggers` in
 * `packages/engine/src/reduce.ts`, not by `applyEffect`. The distinction is
 * load-bearing for the honesty gate: `packages/cards/test/reducer-parity.test.ts`
 * slices `applyEffect`'s body to learn which fields each op reads, and `when` /
 * `until` / `condition` are read one function above it. The same test therefore
 * also re-derives `SCOPE_FIELDS_READ_BY_INSTALL` from `installLiveEffects`'s own
 * source text, so a scope field cannot be declared and then ignored.
 *
 * THE SEMANTICS, because they are a ruling and not an implementation detail:
 *
 *  - An effect carrying `when` or `until` is INSTALLED, not applied. It does not
 *    resolve once at play time and then sit there; it does nothing until its event
 *    fires or its standing turn arrives.
 *  - An effect carrying NEITHER is applied once, immediately. That is every shipped
 *    card's behaviour today and it is unchanged.
 */
export type EffectScope = {
  /** G14 — install this effect as a hook on an event. EXECUTED. */
  readonly when?: EffectTrigger;
  /** G9/G22 — how long the hook lives. Defaults to the card's `duration`. EXECUTED. */
  readonly until?: EffectDuration;
  /** G14 — narrowing on the firing event. Only meaningful alongside `when`. EXECUTED. */
  readonly condition?: EffectCondition;
};


export type Effect = (
  /**
   * Gain a fixed set of resources from the Public Reserve.
   *
   * `per` multiplies `res` by a quantity read out of the recipient's own state —
   * `{ of: 'held-of-each-resource' }` on a `res` of 1 in each resource is IF YOU
   * LIKE PIÑA COLADA's *"Double all the resources on your player mat"*, and the cap
   * still applies on top, which is the card's own second sentence.
   */
  | { readonly op: 'gain'; readonly res: Delta; readonly per?: ComputedCount; readonly target?: EffectTarget }
  /** Pay a fixed set to the Public Reserve. Capped at what the player holds. `per` as for `gain`. */
  | { readonly op: 'lose'; readonly res: Delta; readonly per?: ComputedCount; readonly target?: EffectTarget }
  /**
   * G4/G15 — gain N resources of the recipient's choice, scaled by a count read off
   * SOMEBODY ELSE's board.
   *
   * ## `per` AND `read` ARE ONE MECHANISM, and the split is the whole of this card
   *
   * THOUGHTS AND PRAYERS (REF 4.3): *"Pick a player and get any 2 resources for each of
   * their voters inside a Volatile Area."* Three clauses, and before this pair of fields
   * none of them composed:
   *
   *  - **"get any 2 resources"** is `gain-any` — the verb is already right.
   *  - **"for each of their voters inside a Volatile Area"** is a MULTIPLIER, and every
   *    multiplier on this op resolves against **the player the effect resolves FOR**. With
   *    `target` alone that is the caster, so the card would have paid the caster for the
   *    caster's own pegs.
   *  - **"Pick a player"** is `'chosen-player'`, which is intercepted above the switch and
   *    *replaces* the recipient rather than adding a second addressee.
   *
   * So `read` says **whose state the multiplier is read from** and `target` keeps saying
   * **who is paid**, and the two are different fields because they are different questions.
   * KNOWN-GAPS.md has called this "the shortest route to the next playable card" since §3
   * was written, and it was right.
   *
   * ## `read` WITHOUT `per` IS INERT, and that is refused rather than documented
   *
   * A `read` on its own names a player and changes nothing, which is a field the engine
   * reads for no reason and `src/executable.ts` exists to prevent. `read` is therefore only
   * honoured alongside a `per`, and `packages/cards`' validator refuses the bare form.
   *
   * ## SATISFIABILITY, and it is `choose-player`'s argument verbatim
   *
   * `read: 'chosen-player'` raises a `'choose-player'` decision whose candidate set is
   * `turnOrder` minus the actor — the SAME expression `resolveChoice` validates against,
   * so no state can raise one with no legal pick. The re-run passes the named player back
   * as `forcedRead`, which short-circuits the interception, so the decision cannot be
   * raised twice and the cascade is bounded by the card's own effect list.
   *
   * `per` widens `lose-any` symmetrically and for the same reason: "2 of MY resources for
   * each of THEIR voters" is the mirror sentence, and a field that exists on one of two
   * mirrored ops is a field the next card will reach for on the other.
   */
  | {
      readonly op: 'gain-any';
      readonly n: Count;
      readonly target?: EffectTarget;
      /** G4/G15 — multiply `n` by a quantity read off this player instead of the recipient. */
      readonly per?: ComputedCount;
      /** G4/G15 — whose state `per` is read from. Meaningful only alongside `per`. */
      readonly read?: EffectTarget;
    }
  /** G4/G15 — as `gain-any`, mirrored: discard N scaled by somebody else's board. */
  | {
      readonly op: 'lose-any';
      readonly n: Count;
      readonly target?: EffectTarget;
      readonly per?: ComputedCount;
      readonly read?: EffectTarget;
    }
  /**
   * p34 Snatch: take N resources from a chosen opponent, nothing in return.
   *
   * `target` is the SET OF VICTIMS, not the thief: with no target the thief picks
   * the victim (`from: null` on the choice) and with a target one theft decision is
   * raised per resolved player, so `'each-opponent'` reads "take N from every
   * opponent" and nothing else. It cannot mean "donate to a chosen player" — that
   * is G1, and it needs a different op.
   *
   * A computed `n` is read from the THIEF, who is the player the effect resolves
   * for.
   */
  | { readonly op: 'steal-any'; readonly n: Count; readonly target?: EffectTarget }
  /** Gain N voters to place. Splittable across zones (they are not from a Voter Card). */
  | { readonly op: 'voters'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * p34 Evict: back to the owner's mat, replaceable next turn.
   *
   * `target` names who is asked to make the eviction. A player named by the card
   * chooses among their OWN voters; the caster chooses from the whole board.
   *
   * `zone` narrows WHICH constituency those pegs may be in — G16, see `ZoneSelector`.
   */
  | { readonly op: 'evict'; readonly n: Count; readonly target?: EffectTarget; readonly zone?: ZoneSelector }
  /**
   * p34 Discard: off the board permanently. `target` as for `evict`.
   *
   * With no target the caster picks from every peg on the board that is not their
   * own — the reading three shipped cards state in their text. See
   * `ChoiceScope` for why "your own voters" needs the target rather than a flag.
   *
   * `zone` is G16's narrowing; see `ZoneSelector`.
   */
  | {
      readonly op: 'discard-voter';
      readonly n: Count;
      readonly target?: EffectTarget;
      readonly zone?: ZoneSelector;
    }
  /**
   * p34 Convert: replace an opponent's voter in the same area with your own. `target`
   * as for `evict`; `zone` is G16's narrowing, see `ZoneSelector`.
   */
  | {
      readonly op: 'convert-voter';
      readonly n: Count;
      readonly target?: EffectTarget;
      readonly zone?: ZoneSelector;
    }
  /**
   * Extra gerrymander moves this turn, above the normal per-zone allowance.
   *
   * G8: `target` is on the op and `reduce()` honours every `EffectTarget` — the
   * case loops `resolveTargets`, which is what makes "starting with you, every
   * player can Gerrymander 1" (SUBMERGED / NEW FACE WHO DIS) writable. The grant
   * lands in `powerUses.gerrymandered`, which `advanceTurn` resets at the start of
   * each player's own turn, so a cross-player grant is spendable only by the player
   * whose turn the card resolved on; a lasting cross-player grant is a `LiveEffect`
   * with `duration`, not a bigger `n`.
   */
  | { readonly op: 'gerrymander'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * Draw the top Conspiracy Card(s). `target` says who receives them, so
   * `'each-opponent'` is GOOD GIG WELL PLAYED's gift. Hands are hidden from every
   * viewer including their owner (`playerView`), so handing a card to an opponent
   * leaks nothing the caster's own play did not.
   *
   * `from: 'discard'` reaches the DISCARD pile instead of the draw pile (G17) — the
   * top of a discard pile being the most recently discarded card, because that is
   * the order `discardTo` pushes them in and the reducer is not allowed to invent
   * another.
   *
   * ## `pick` — G17, and the only set in the game a `'choose-card'` may enumerate
   *
   * Absent (the default) this op takes the top deterministically and publishes
   * nothing, which is the `onlyIfEmpty` precedent exactly. `pick: true` raises one
   * `'choose-card'` decision per card instead, so the player names WHICH member of
   * the pile they take and a pile of *n* takes *n* decisions — which is what makes
   * SELECTIVE ACCESS MEMORY's whole printed clause work: *"Pick any Conspiracy
   * Card from the discard pile. It can be in any order from the discard pile."*
   * One card is "which card"; two is "in any order", and the two halves of that
   * sentence are separate mechanisms that happen to be one flag.
   *
   * **IT IS REFUSED UNLESS `from: 'discard'`, and that is the §2bis line rather
   * than an omission.** A decision's OPTION LIST is the disclosure (§3.1), so the
   * only set it may name is a set every client already holds in full. U1 makes
   * exactly one such set: `ClientState.conspiracyRecycle`, the ordered list of
   * Conspiracy Cards currently on the recycle pile, which `playerView` publishes and
   * which is RECONSTRUCTIBLE FROM THE PUBLIC LOG ALONE — `Played "NAME".` puts a
   * card on it and `Picked "NAME".` takes one off, in order. `_conspiracyDraw` has no
   * such property — a client's knowledge of it is the whole of what p19's "the top
   * card, at a printed price" withholds — so `pick` over it raises nothing.
   *
   * The ORDER is derivable too, which is a change and not a detail: the two take
   * paths used to remove a card SILENTLY, so the pile could lose a card with no log
   * line and a spectator diffing two payloads could deduce which card went into
   * whose hidden hand. Both departures are announced now — see `reduce.ts`'s
   * `announcedPick` — which is also the faithful behaviour, the discard pile being
   * face up at a real table.
   *
   * The other five piles are refused for the same reason and stay refused:
   * `PRIVATE_PLAYER_KEYS` (a hand, to its own holder included), `_ideologyDraw`,
   * `_ideologyDiscard` (an ANSWERED card is face up under its mat, so listing the
   * pile publishes the answer), `_headlineDraw`, and `_voterDraw` (the market is
   * face up; the pile beneath it is not).
   */
  | {
      readonly op: 'draw-conspiracy';
      readonly n: Count;
      readonly target?: EffectTarget;
      readonly from?: 'draw' | 'discard';
      /**
       * G17 — NAME A CARD INSTEAD OF TAKING THE TOP. See above.
       *
       * **AN EMPTY PILE RAISES NOTHING**, the same shape as `'chosen-zone'`'s
       * unresolvable selector: "pick a card from the discard pile" is not a
       * decision a player who is owed nothing can answer, and raising one would
       * freeze the table on a clause with nothing to act on. That is the whole of
       * U1's termination claim and it is a RULES claim, not a safety bound: the
       * ask is bounded by the pile, and the pile is bounded by the deck.
       */
      readonly pick?: boolean;
      /**
       * G20's `to: 'discard'`, arriving inside G17's op rather than as a widening
       * of `move-card`. Default `'hand'`, which is byte-identical to every card
       * that shipped before this field existed.
       *
       * **AND IT IS HONOURED ONLY FROM THE PUBLIC PILE.** `to: 'discard'` paired
       * with `from: 'draw'` (or with no `from`) is REFUSED: it would place a card
       * drawn out of `_conspiracyDraw` onto the recycle list, and U1's entire
       * security argument is that the recycle list is reconstructible from the
       * public log. A card nobody played is not in the log, so
       * publishing the list would publish the draw pile's next card — a
       * `_`-prefixed value by another route, which is the failure the refusal
       * exists to prevent and the reason the derivation test in
       * `packages/server/test/secret-state.test.ts` is written against the LOG
       * rather than against the pile.
       *
       * The refusal is silent by construction — no `LogEntry`, no `GameEvent`, no
       * state change — because "this card did nothing" is not a thing a client
       * needs told, and a message about it would describe the draw pile. Note the
       * asymmetry with `announcedPick`, which is loud: silence is right for a clause
       * that moved NOTHING and wrong for one that moved a named card off a public pile,
       * and that is the whole difference between the two.
       */
      readonly to?: 'hand' | 'discard';
      /**
       * G17 — GIVE ONLY TO A PLAYER WHO IS HOLDING NOTHING.
       *
       * AS CLEAR AS WATER (REF 4.3) is *"Every player reveals 1 of their Conspiracy
       * Cards. If any player does not have a Conspiracy Card, they receive 1 from the
       * draw pile (in order of turn) and then reveal it."* The clause with a state
       * change in it is the second one, and the state it reads is the recipient's HAND
       * — which `applyEffect` can already see, so the condition needs a flag rather
       * than a decision.
       *
       * `true` means a resolved player who already holds at least one Conspiracy Card
       * is SKIPPED and takes nothing. It is deliberately a flag and not a count: no
       * recovered card asks for a card to a player holding exactly some number, and a
       * bound the corpus never uses is licence.
       *
       * **The information question, and why it is safe.** A Conspiracy Card hand is
       * hidden from every viewer INCLUDING its owner (`playerView` blanks it), so this
       * field reads a fact the caster cannot see and the reducer never discloses: the
       * per-player outcome is a bare `continue`, and `applyEffect` logs nothing here.
       * A player who was skipped and a player who was not are indistinguishable from
       * outside except by the size of their own hand, which they already know. It adds
       * no `_` field and owes `packages/server/test/secret-inventory.ts` nothing.
       *
       * **Termination.** It can only ever move a card out of the draw pile into a hand
       * that is empty, so it is bounded by the draw pile's own length, and the pile
       * refills from the discard exactly as an ordinary turn draw does. It cannot
       * append to a queue that grows on its own.
       */
      readonly onlyIfEmpty?: boolean;
    }
/**
   * REVEAL the top of a draw pile, face up, to the players it is aimed at. G-new.
   *
   * ## WHAT IT IS, and why it is not `move-card` with a different verb
   *
   * `move-card` puts a card somewhere it must be found again later — a hidden hand, or
   * gone. This op leaves the card ON THE TABLE with its faces showing, attached to a seat,
   * so that a later clause can count it (`'revealed-card'`) or take it
   * (`move-card { from: 'revealed' }`). **There is no destination, and that is the whole
   * difference**: `revealedCards` is not a fourth place a card can be filed, it is a window
   * onto the card, and the turn boundary is what closes the window and **gives the card
   * back to the pile it was read from**.
   *
   * **THE CARD IS OFF THE PILE WHILE IT IS FACE UP, and the boundary puts it back.** It
   * has to be: a card that were still on its pile could not be published as a thing the
   * resolution can act on, and the set would be a copy rather than a location. So the take
   * is half the mechanic and `settleRevealedCards` is the other half — every card still
   * LISTED when the boundary runs goes back to the FRONT of the pile it came from, in the
   * order `resolveTargets` handed the targets out, which restores that deck exactly.
   *
   * **WITHOUT THE SECOND HALF THE CARD IS DELETED FROM THE GAME, and that is not a
   * hypothetical.** A set that must be empty outside a resolution gets cleared at the
   * boundary, and a cleared list is not a returned card: the first version of this op took
   * the card off the pile, cleared the set, and thereby deleted one card per reveal per
   * resolution. On a deck that can run out this is a table which can never finish, and it
   * shipped — `hl-et2040-027` (BLESSINGS OF PARENTS PAST, `{op:'reveal', kind:'voter',
   * n:2}`) stalled a 60-seed corpus sweep at two seats while the same card rebuilt against
   * another pile did not. This project refuses mechanisms that can make a table never
   * finish, and the boundary return is the price of this one.
   *
   * **MEMBERSHIP IS WHAT DECIDES "WAS IT MOVED".** `move-card { from: 'revealed' }` files
   * a card in a hand or destroys it in the same write that drops it from the set, so a card
   * still listed at the boundary is one nothing ever took. The origin itself is never asked
   * about at take time, because a face-up card is on no pile at that moment; the boundary
   * recovers it from the card index instead, which is the one thing that still says what a
   * card is.
   *
   * ## THE SECURITY ARGUMENT, because this is the op the rule is about
   *
   * §2bis, verbatim: *"you may choose a card the whole table can already see, or the top
   * of a pile nobody can see; you may never be shown what is in a pile."* Stated
   * mechanically, which is the form an implementer can be held to: **a mechanism may READ
   * a hidden set only by committing to one member of it before anything is published, and
   * may never place that set's CONTENTS in any value that reaches a client.**
   *
   * This op is COMMIT-THEN-PUBLISH and is therefore on the right side of the rule:
   *
   *  - **COMMIT FIRST.** The member is `pile[0]`, the same end `draw()` takes from, so
   *    the choice is made by position and not by anything a client can observe. It is
   *    decided before the write and it is ONE card — `n` is a bound, not a search, and
   *    there is no `pick` flag on this op because a search is the other mechanism.
   *  - **THEN PUBLISH, AND PUBLISH ONLY THE CARD.** What reaches a client is one face-up
   *    card that the card's whole printed text is about. The rest of the pile stays in its
   *    `_` field and stays unpublished. Leaving the published card on its pile publishes
   *    nothing further: the pile is not on the wire, and neither its length nor its order
   *    is disclosed by turning one card over.
   *  - **THE PRECEDENTS FOR THE SAFE SHAPE ARE ALREADY IN THIS FILE.** `onlyIfEmpty` reads
   *    the recipient's hidden hand, and `move-card { from: 'draw' }` reads a draw pile —
   *    both take the top deterministically, and BOTH EMIT NO LOG LINE AND NO EVENT. That
   *    silence is the tell: a deterministic read needs no announcement because nothing
   *    about the pile has become knowable. This op is silent for the same reason, and it
   *    is the sharp contrast with `draw-conspiracy`'s `announcedPick`, which is LOUD
   *    because it removes a NAMED card from a pile the table can already see.
   *  - **THE LEAK IS THE ENUMERATION, and it is refused structurally.** Every list a
   *    decision may name is checked against being already-public — that is what
   *    `'choose-card'` and `PRIVATE_PLAYER_KEYS` are for, and the reason `pick` is
   *    REFUSED over `_conspiracyDraw` rather than merely undocumented. **So this op has no
   *    `pick`, and no `target` value on it may ever be answered by choosing a card out of
   *    the pile it reveals.** A reveal publishes the top and nothing else, forever.
   *
   * ## `kind` NAMES THE PILE, and the four are interchangeable HERE in a way they are
   * not elsewhere
   *
   * The draw piles are the four `_`-prefixed fields, and naming one on an op is a request
   * to read it. It is honest for all four because the operation is identical: read one
   * member, publish that member. **It would stop being honest the moment `kind` gained a
   * value that names a set rather than a pile** — `_ideologyDiscard` in particular, whose
   * contents are ANSWERED cards that p13 has already made face up under a mat, so listing
   * it would publish a blind answer (see `Choice`'s `'choose-card'` arm, which refuses it
   * for exactly that reason). Four values, no `'discard'`, and the omission is the ruling.
   *
   * ## `target` SAYS WHOSE REVEALED SET, and it is the same axis as everywhere else
   *
   * The cards land on the resolved recipient's entry in `GameState.revealedCards`, which is
   * what `revealed-card` counts and what `move-card { from: 'revealed' }` takes from — read
   * through `revealedCardsOf`, one accessor, so the write and the read are the same
   * expression. Absent `target` means the card's own player, and `'each-opponent'` means
   * one reveal per opponent, resolved by the same `resolveTargets` loop every other op
   * uses. A reveal is announced to EVERYONE regardless of who it belongs to: the field is
   * public and unprefixed, so there is no viewer-scoped branch and no
   * `(pid === viewer)` case — adding one would be the R1 bug in a plausible-looking form.
   *
   * Because the pile is shared, two targets off one pile are handed DIFFERENT cards: the
   * pile shrinks as it is read, so the second target walks on past what the first was
   * given and no id is published twice.
   *
   * ## SATISFIABILITY AND TERMINATION, and both are the deck's own bounds
   *
   * A short pile reveals what it has: `n` is an upper bound and a partially-applied
   * reveal is correct, not a bug, exactly as a partially-applied `move-card` is — and the
   * pile cannot run dry, because the boundary hands every card back.
   * **The op cannot be unsatisfiable because it raises no decision at all**: there is no
   * dialog, so there is no frozen player and no `blockedBy` deadlock, which is the failure
   * class this codebase has been bitten by three times. And each pass removes one card
   * from a pile that is finite and shrinking, so a resolution that resolves the same card
   * three times takes three cards or stops — it cannot cascade and it cannot append to a
   * structure that grows on its own.
   *
   * ## INERT UNTIL THE REDUCER HAS A CASE FOR IT, and the compiler says so out loud
   *
   * Declaring the op is half of the contract and this file is the half an author reads.
   * `packages/cards/src/validate.ts` will reject any corpus card using it until
   * `applyEffect` grows a `case 'reveal'` and `EXECUTED_OPS` grows the matching entry —
   * finding code `EFFECT_NOT_EXECUTED`. That is the gate working, not a defect: **a card
   * must not ship using behaviour the engine does not perform**, and this op is written
   * down so the execution agent has a contract to satisfy rather than a shape to invent.
   */
   | {
      readonly op: 'reveal';
      /**
       * Which draw pile to read the top of. Four values and no `'discard'` — see the
       * section above; `_ideologyDiscard`'s contents are answered cards and listing them
       * would publish a blind answer. The pile is NOT written: a reveal leaves it whole.
       */
      readonly kind: 'ideology' | 'voter' | 'conspiracy' | 'headline';
      /** How many cards off the top, face up, onto each resolved player's revealed set. */
      readonly n: Count;
      /** Whose revealed set they land on. Defaults to the card's own player. */
      readonly target?: EffectTarget;
    }
  /** Discard all face-up Voter Cards and deal fresh ones. */
  | { readonly op: 'refresh-market' }
  /**
   * G17, WIDENED — take a Voter Card off the HQ Mat, which is the SECOND set a
   * `'choose-card'` may enumerate.
   *
   * ## WHY THIS OP EXISTS AT ALL
   *
   * `draw-conspiracy`'s `pick` is welded to Conspiracy Cards: the card it names is
   * filed in `PlayerState.conspiracies`, and a Voter Card filed there would be a card
   * the engine could never resolve. So the market could not be reached by widening
   * that op's fields without lying about what it moves, and the honest seam is a
   * second op over the second public set. `INFLUENCE` is an ACTION, not an `Effect`,
   * and an effect that wanted to be one would have to grant an action's `pay` — which
   * is G15's missing `price` field and a refusal this op keeps rather than works
   * around.
   *
   * ## THE MARKET IS THE SECOND PUBLIC SET, and it needs no projection
   *
   * p10 keeps three Voter Cards face up on the HQ Mat and the rulebook has no hidden
   * phase, so `GameState.market` is unprefixed, is not in `PRIVATE_PLAYER_KEYS`, and
   * rides every client payload **with its slot order intact**. A decision over it
   * therefore publishes nothing that was not already published: `Choice`'s
   * `'choose-card'` arm says so at length, and this op is the second member of that
   * union. The secrecy rule is unchanged and is not weakened by being widened — see
   * `pool` on that arm for what would disqualify a third set.
   *
   * ## WHAT A TAKEN CARD BECOMES, and the reduction that is named rather than hidden
   *
   * **THERE IS NO VOTER CARD HAND IN THIS ENGINE**, so a card taken off the market
   * cannot be kept: it goes onto the Voter discard pile through `discardTo`, exactly
   * as the card in a slot emptied by `INFLUENCE` does, and `refillMarket` puts a
   * fresh one up. **No voters are granted**, because a free influence is precisely the
   * clause G15 refuses (no `Effect` may grant an action's `pay`), and granting the
   * voters behind its back would be that grant wearing a different hat. Keeping a
   * market card is still blocked on a private Voter Card hand and this op does not
   * pretend otherwise; a card that needs one names the gap on its face.
   *
   * ## `pick` — AND WHY AN EMPTY MARKET RAISES NOTHING
   *
   * `pick: true` raises one `'choose-card'` per card over the market instead of
   * taking the leftmost slot. At most `min(n, market.length)` decisions are raised,
   * which is the satisfiability proof rather than a courtesy: the k-th is answered
   * when at least one offered card is still on the mat, so no position can strand it.
   *
   * **AN EMPTY MARKET RAISES NOTHING** — the same `'chosen-zone'` unresolvable-selector
   * argument G17's empty recycle pile already uses. "Take a Voter Card from the
   * market" is not a decision a player can answer when there is no market, and a
   * dialog with zero options is a frozen table on a clause with nothing to act on.
   * Raising one would be the soft-lock this codebase has been bitten by repeatedly.
   */
  | {
      readonly op: 'take-voter';
      /** How many cards, one per decision when `pick` is set. */
      readonly n: Count;
      /** Who takes them. Defaults to the card's own actor. */
      readonly target?: EffectTarget;
      /**
       * `true` raises a `'choose-card'` over the market rather than taking the
       * leftmost slot. See above for the empty-market rule.
       */
      readonly pick?: boolean;
    }
  /**
   * G5 — attach a RULE to a player that other actions must consult.
   *
   * The one op that is not a change to a pool, a mat or the board. It writes a
   * `PlayerState.restrictions` entry, and `INFLUENCE` and `BUY_CONSPIRACY` are the
   * two actions that consult it today: `'no-purchases'` refuses both outright, and
   * `'surcharge'` adds `value` to the computed cost.
   *
   * `until` (from `EffectScope`) is the lifetime, and it is read here rather than
   * being left to `installLiveEffects`: a restriction is not a live effect — it has
   * no trigger and no effect list, and a hook that fired on an event could not
   * refund a price. Expiry is ticked in `advanceTurn` alongside live effects.
   *
   * `owed` is the KHAKI TERROR condition, and it is the field the soft-lock ruling
   * lives in: see `Restriction` in state.ts. It is the amount the card ASKS for; the
   * engine decrements `remaining` by what was ACTUALLY donated, so a player who
   * cannot afford the whole ask can still clear it. `owedRes` is the per-resource
   * form of the same condition and is what a card saying "of each type" must use.
   */
  | {
      readonly op: 'restrict';
      /**
       * `'no-power'` is GENDER TROUBLE and is consulted by `usesLeft` in
       * `powers.ts`, not by `INFLUENCE` or `BUY_CONSPIRACY` — see `RestrictionKind`
       * in `state.ts` for why that hook is total across the whole power vocabulary,
       * and for the clause it costs (the printed card names ONE Level 3 power, and
       * choosing which is G1).
       */
      readonly kind:
        | 'no-purchases'
        | 'surcharge'
        | 'no-power'
        | 'no-income'
        /**
         * G14b. THE GRETA EFFECT: *"They will get 1 less voter on the next 2 Voter Cards
         * that they influence."* `value` is how many voters each of those cards yields
         * less and `owed` is how many CARDS that is — one field pair for a rule with a
         * counter, and both readings are argued on `'voter-shortfall'` in `state.ts`.
         *
         * Consulted by `INFLUENCE` in exactly one place, after Going Viral, and it
         * suppresses rather than refuses.
         */
        | 'voter-shortfall';
      /** Extra resources per purchase, for `'surcharge'`. Zero for `'no-purchases'`. */
      readonly value: number;
      /**
       * For `'no-purchases'`: how many resources the player must give before buying
       * again, as a TOTAL.
       *
       * **THE LEGACY SHAPE, and it is why `owedRes` exists.** A total cannot say
       * *"1 resource of **each type**"*: `4` is four of anything, so a lock written
       * this way is cleared by four Funds and not by one of each — the exact
       * text-behaviour divergence C1 is. Read `owedRes` for that, and read the
       * `owedRes` note below for why the two coexist.
       */
      readonly owed?: number;
      /**
       * C1 — `'no-purchases'` only: the requirement AS A PER-RESOURCE VECTOR, which is
       * the only shape in which *"1 resource of each type"* is expressible.
       *
       * Copied onto the `Restriction` as its initial remainder and decremented per
       * donation from there, so the vector survives across several partial donations
       * — which a scalar cannot, because a scalar cannot say WHICH resource is still
       * owed. `owed` remains the sum, so anything reading the scalar still works.
       *
       * **PER-TYPE VALUES ARE 0 OR 1, and that is the whole dischargeability proof.**
       * `creditDonation` settles a type outright when the donation carries it, and
       * settles it by waiver when the donation takes none of it (the player holds
       * none). With every ask at most 1 those are the only two cases, so **one donation
       * discharges the whole lock** — no type can be left partly paid. An ask of 2 or
       * more breaks that and is refused by the corpus validator rather than shipped as
       * a lock that might not be answerable.
       */
      readonly owedRes?: Delta;
      readonly target?: EffectTarget;
    }
  /**
   * Additional purchase discounts this turn. `target` grants them to somebody else,
   * which is a write to another player's `powerUses` — the only such write in the
   * effect vocabulary, and the reason it is a card field rather than a resource.
   */
  | { readonly op: 'discount'; readonly n: Count; readonly target?: EffectTarget }
  /**
   * G20 - move an Ideology Card. THE CARD-MOVING HALF OF THE GAME'S MOST FRAGILE
   * MECHANIC, and the type is deliberately much smaller than the concept.
   *
   * **THE RULING IS ON `PlayerState.ideologyCards` in `state.ts`. Read it.** The
   * short form: a moved card is HELD AND HIDDEN from everyone including whoever ends
   * up holding it, and it is put to that player at their next turn boundary in
   * place of that turn's draw.
   *
   * ## WHY THERE IS NO `from: 'hand'`, NO `from: 'pending'`, AND NO `to: 'pending'`
   *
   * Three things a card-transfer op would obviously want, and all three are refused
   * at the type level so a future card cannot reach them by accident. Each refusal
   * is a security or a termination ruling, not a missing feature:
   *
   * 1. **`from: 'pending'` - the card a player is MID-ANSWER.** This is the one the
   *    whole mechanic turns on. A player who could hand on the card they have been
   *    put has been told it exists and is being offered a way to look at it by
   *    proxy; and emptying `_pendingCard` leaves that player with no legal move at
   *    all, because `ANSWER` says "no card has been put to you" and `END_TURN` says
   *    "answer your Ideology Card first". A COWARD OR A JOURNALIST? is exactly this
   *    card, which is why it stays blocked on G12 as well as on G20.
   * 2. **`from: 'hand'` - a SEARCH of a hidden hand.** A hand is a QUEUE the
   *    engine drains, not a thing a player can reach into and read: the ruling is
   *    that the holder does not know what they are holding, and an op that takes
   *    "any card of this player's hand", or one whose member is chosen by anything a
   *    client could observe, is an op that requires somebody to be able to
   *    enumerate it. **`from: 'held-received'` is not that op and is the reason this
   *    refusal survived**: it takes ONE member BY POSITION (the last, i.e. the most
   *    recently arrived), commits to it before anything is published, and emits
   *    nothing - the `onlyIfEmpty` shape exactly, and the same reason a hand of
   *    Conspiracy Cards is readable-but-untouchable by any decision. The
   *    `_`-prefixed name `'hand'` stays refused because there is no such position-
   *    taking spelling: a hand's order is not part of any printed clause, so an op
   *    that used it would be inventing a rule rather than expressing one.
   * 3. **`to: 'pending'` and `to: 'manifesto'`.** See the ruling's "NO THIRD
   *    CATEGORY" section: there are exactly two places an Ideology Card can be -
   *    face down in a hand, or face up under a mat HAVING BEEN ANSWERED. Writing
   *    either public field would be a p13 violation and would move the Ideologue
   *    power ladder (p28-33) for a card nobody answered.
   *
   * ## `from: 'draw'` — AND WHY IT IS NOT `from: 'discard'`, which is the whole point
   *
   * **A card taken off the Ideology DISCARD pile is a card whose answer is already
   * public.** p13 makes an answered card face up under its owner's mat, and the top of
   * the Ideology discard is by construction the most recently ANSWERED card: `ANSWER`
   * is the only thing that puts one there. Handing that card to a player blind does not
   * restore the blind answer, it announces it - the whole table already knows the
   * question and the answer the holder is about to commit to. This is the same
   * argument as the `to: 'manifesto'` refusal, running in the other direction: the
   * rulebook draws its line at ANSWERED, and a discard-pile card is on the public side
   * of it. `card-transfer.test.ts` pins this by asserting that no card ever in a hand
   * is in anybody's `manifestoCards`, and by running a whole played game and failing
   * if any `xfer-` id reaches a log line.
   *
   * The first draft of this op took `from: 'discard'`, and the game-loop test caught it
   * on its first run - the card it had just moved was the one the caster had answered
   * that same turn. The engine was right and the op was wrong, which is the only
   * acceptable way for that to go round.
   *
   * `from: 'draw'` is honest because a card in the draw pile has never been answered,
   * so there is nothing public about it. It is also an ADAPTATION and not in the
   * physical game - reaching into the draw pile is not a Shasn move - and the one card
   * that ships on it (JUMLA) says so in its own text.
   *
   * **AND IT CLOSES THE DECK-COUNT SIGNAL, which the discard version could not.** A
   * hand is drained at the turn boundary INSTEAD OF a draw, so a card that entered a
   * hand must have left the draw pile already for the deck to fall by exactly one per
   * turn. Off the discard, the deck would fall by one on the turn a card moved in and
   * by NONE on the turn it was dealt - a discontinuity an observer could time, which
   * would tell every viewer that a transfer had happened and roughly when. Off the
   * draw, the count is monotonic and drops by exactly one per turn forever, so there is
   * no signal to read. The design choice and the security property are the same
   * decision, and that is rare enough to be worth saying out loud.
   *
   * The asymmetry with `draw-conspiracy`'s `from: 'discard'` is real and deliberate:
   * a Conspiracy Card is bought and held, never answered face up, so recycling one out
   * of ITS discard pile discloses nothing. The same source is honest for one deck and a
   * leak for the other, and the difference is entirely p13.
   *
   * ## `from: 'revealed'` — THE STRONGEST FORM OF §2bis's FIRST CLAUSE
   *
   * A revealed card has been turned face up in front of the whole table, so taking one
   * discloses nothing at all: this is the *"a card the whole table can already see"* half
   * of the rule, where `'draw'` is the *"the top of a pile nobody can see"* half. Neither
   * touches the half the rule refuses, because **there is no `from` here that enumerates
   * a pile** — the union names exactly two sources, one member each, and a fourth
   * spelling (`'pending'`, `'hand'`, `'discard'`) is refused above for reasons that do not
   * change with this addition.
   *
   * **IT MUST TAKE THE CARD OUT OF THE RESOLVED SEAT'S `revealedCards` — AND OUT OF THE
   * PILE IT CAME FROM, and that is not bookkeeping either.** The invariant on
   * `GameState.revealedCards` is that it holds cards the table can currently SEE; a card
   * moved to a hidden hand is a card the table can no longer see, and leaving it listed
   * would publish a card's identity after it has been hidden again — the `choose-card`
   * refusal over `_ideologyDraw`, arriving by a different route. The read side is
   * `revealedCardsOf(state, seat)`, one accessor, so the take and the removal are the same
   * expression and cannot drift.
   *
   * **AND IT IS THE ONLY OP THAT MOVES A REVEALED CARD OUT OF THE SET**, which is what
   * tells the turn boundary which cards were never moved: a card still LISTED at the
   * boundary is one nothing has taken anywhere, and `settleRevealedCards` returns exactly
   * those to the pile they came from. So the boundary's answer to "does this card still
   * exist" is membership of this set, and an implementation that removed a card from the
   * set without filing it somewhere real would have made the boundary put it in two decks
   * at once. The read side is `revealedCardsOf(state, seat)`, one accessor, so the take and
   * the removal are the same expression and cannot drift.
   *
   * **`to: 'hand'` files the card in an Ideology Card hand, which is where a
   * `PlayerState.ideologyCards` id belongs.** That is the whole reason a face-up card is
   * removed from its pile on the reveal: by the time it is taken, it is in exactly one place
   * — on this set — so this half is a single write and needs no pile to keep consistent.
   *
   * ## `from: 'held-received'` - A DONATION, AND THE ORDERING IT READS
   *
   * A COWARD OR A JOURNALIST? is *"you may pass along a card you just received"*, and
   * CARD GAMES moves the same card. The donor is **the card's own actor** (`source`) -
   * the printed subject is YOU - and `target` says who ends up holding it, so a card
   * writes `target: 'chosen-player'` and the donation goes to a named opponent. A
   * donation to the donor's own hand is refused as a no-op rather than performed, so
   * the clause cannot quietly reorder the donor's queue.
   *
   * **THE MEMBER IS THE LAST ELEMENT, and that is `hand[hand.length - 1]` because the
   * engine APPENDS on the way in and DRAINS FROM THE FRONT on the way out.** Both
   * halves are in `reduce.ts` and neither is a convention: `from: 'revealed'` and
   * `from: 'draw'` both file a card with `ideologyCards: [...ideologyHandOf(player),
   * id]` (arriving at the END), and `advanceTurn` drains with `const [heldCard,
   * ...heldRest] = held` (leaving from the FRONT). So the hand is a FIFO queue and its
   * last element is the most recently ARRIVED card, which is what "a card you just
   * received" names. **The two ends are deliberately different and that is the whole
   * mechanic**: a donation passes on the newest card while the oldest is the next one
   * the donor would have been dealt, so passing one on never reorders what anybody is
   * about to be asked. `move-card` is the ONLY writer of arrivals - `setup()` writes
   * `[]` and `advanceTurn` is the only writer of departures - so there is no second
   * way a hand acquires an order this reading could be wrong about.
   *
   * **THE SECRECY ARGUMENT, and it is the `onlyIfEmpty` argument verbatim.** The
   * ruling on `PlayerState.ideologyCards` is that a held Ideology Card is hidden from
   * EVERYONE INCLUDING ITS HOLDER, so the donor does not know what they are holding and
   * neither does anybody else. This branch therefore:
   *
   *  - **COMMITS FIRST, BY POSITION.** One element, chosen by index, decided before
   *    the write. There is no `pick`, no search, no `n` that means "any", and nothing
   *    anywhere that puts the hand's contents into a value on its way to a client.
   *  - **EMITS NOTHING.** No `LogEntry` and no `GameEvent`, for either `to`. "p1 gave
   *    away a card" would tell every viewer that p1's hand was non-empty a moment
   *    before, which is a fact about a hidden hand - and `onlyIfEmpty` is the
   *    precedent that already reads a hidden hand and says nothing, precisely so a
   *    skipped player and an unskipped one are indistinguishable. A donation is the
   *    same shape with a card instead of a skip.
   *  - **IS SILENT ABOUT THE HAND'S SIZE.** An empty donor hand is a bare `break`, the
   *    same no-op an exhausted pile is on the other two branches, so a clause that
   *    found nothing to pass on leaves the world exactly as it was and says so to
   *    nobody. `to: 'hand'` checks `IDEOLOGY_HAND_MAX` on the RECEIVER before the card
   *    leaves the donor, for the reason the draw path checks it before the card leaves
   *    the pile: a refused move must not half-happen.
   *
   * `to: 'destroy'` is honoured here too, because `to` is not widened by this addition
   * and the alternative is a source that reads a hidden hand and does nothing with it.
   *
   * ## AND IT DOES NOT WIDEN `to`
   *
   * `to` is untouched, so `to: 'destroy'` off a revealed card still writes no log line
   * and no event, for the same reason the whole op is silent — and a card that IS face up
   * would in principle be safe to announce. Silence is kept anyway because the log is
   * read the same way for every card and a line that appears for face-up cards and not
   * for draw-pile cards is a line whose ABSENCE reports which source was used. The
   * published `revealedCards` map already says it.
   */
  | {
      readonly op: 'move-card';
      /**
       * The top of the Ideology draw pile - a card that has never been answered. Or, for
       * `'revealed'`, the top of the resolved seat's revealed set - a card the whole table
       * has already seen face up. Or, for `'held-received'`, the card that most recently
       * ARRIVED in the donor's own hidden hand. See the three sections above: one member
       * taken blind, one member already public, one member out of a hand nobody can see.
       * There is no fourth spelling, and no spelling that enumerates anything.
       */
      readonly from: 'draw' | 'revealed' | 'held-received';
      readonly to: 'hand' | 'destroy';
      readonly n: Count;
      /**
       * `to: 'hand'` only: who ends up holding it. Defaults to `'you'`, which is
       * JUMLA's "this is an extra Ideology Card" read as YOURS to answer.
       *
       * `to: 'destroy'` ignores it, and the engine's own no-op is the assertion: a
       * destroyed card has no holder, so naming one would be inventing a fact.
       */
      readonly target?: EffectTarget;
    }
  /**
   * G14a — USE AN OPPONENT'S LEVEL 3 IDEOLOGUE POWERS.
   *
   * DEEP THOUGHTS (REF 4.2.1): *"Select an opponent and use all their Level 3 Ideologue
   * Powers this turn. You cannot use the same Ideologue Power twice."* POLO RETREAT is
   * the same borrow across a turn boundary and between two players.
   *
   * ## WHY IT IS AN OP AND NOT A `restrict` WITH A KIND
   *
   * Because the two directions are opposite. Every `restrict` writes its entry on the
   * player the card NAMES and records the caster as `sourcePlayer`; a borrow has to be
   * written on the CASTER and record the player being borrowed FROM as `sourcePlayer`,
   * because `powers.ts usesLeft` is handed the borrower and has to be told whose
   * manifesto to count. Putting it in `restrict` would have written the entry on the
   * donor, which is a card that grants the donor the caster's powers.
   *
   * `target: 'chosen-player'` is REQUIRED and it is the ONLY legal value, so it is a
   * compile error rather than a runtime no-op: the choice is raised by the same
   * interception above `applyEffect`'s switch that every other decision uses, and
   * `resolveChoice` re-runs the effect with the named player as `forced`. A donor
   * who holds nothing is a legal ANSWER — `borrowedFrom` then contributes a manifest
   * with no Level 3 power and the borrow resolves to nothing, which is the honest
   * reading — so the decision is never unsatisfiable.
   *
   * `until` is the lifetime, on `EffectScope` like every other effect, and it is read
   * HERE rather than by `installLiveEffects` for the reason `restrict` reads it there:
   * a borrow has no trigger and nothing to stand up on, so there is nothing to
   * install. `'this-turn'` is DEEP THOUGHTS and `'next-turn'` is POLO RETREAT.
   *
   * **Level 3 only, and that is a ruling rather than a narrowing.** See
   * `'borrowed-powers'` in `state.ts`: all four Level 3 powers are consulted through
   * one function, and the Level 5 ones are not all there.
   */
  | { readonly op: 'borrow-power'; readonly target: 'chosen-player' }
  /**
   * G15 — LOWER a player's resource cap. THE BIG FREEZE: *"Reduce your resource cap
   * to 10."*
   *
   * ## WHY IT IS AN OP AND NOT A `restrict` WITH A KIND
   *
   * Because a cap is not a gate. Every `RestrictionKind` is consulted at a decision point
   * where an action is either allowed or refused; a cap is a NUMBER that `enforceCap` and
   * `overCap` compare a pool against. Writing it as a restriction would mean `applyEffect`
   * becoming a cap resolver and every pool comparison growing a lookup — the argument is
   * the long way round on `PlayerState.capOverride`.
   *
   * `until` (from `EffectScope`) is the lifetime and is read HERE rather than by
   * `installLiveEffects`, for the reason `restrict` reads it there and the reason
   * `isScoped` carves those ops out: a cap reduction is a rule imposed now with a deadline,
   * not a hook that has nothing to stand up on. See `isScoped`'s carve-out.
   *
   * ## IT CAN NEVER RAISE A CAP, and that is a Ruling rather than an omission
   *
   * `reduce()` keeps `min(existing, to)` and never the printed `rules.resourceCap` as a
   * floor it can climb back to, so a card can only ever make the cap MORE restrictive, and
   * `expireCapOverrides` lifts it back to the printed value at the turn boundary. A
   * `set-cap` above the printed cap is therefore a no-op rather than an error: refusing it
   * would mean a validator rule about the RULES object, which is not a card property.
   *
   * ## DEADLOCK, which is why this is safe and the earlier refusal was wrong
   *
   * The gap was refused as *"lowering a cap under an already-over player is the
   * `convert-voter` soft-lock shape"*. **It is not**, and the reason is arithmetic.
   * `enforceCap` raises `count = overCap(pool, cap) = max(0, total - cap)`, so
   * `excess <= total` always — the ask can never exceed what the player holds — and
   * discarding it leaves `total - excess = min(total, cap) >= 0`, so the target state is
   * REACHABLE. `lose-any` is additionally clamped to the chooser's pool at ANSWER time, so
   * a pool that drains in between lowers the ask rather than stranding it. The `convert-voter`
   * bug was a decision with NO acceptable answer; this is a decision whose answer is always
   * affordable. `reduce()` calls `enforceCap` immediately after writing the field, which is
   * p12's *"if at any time you cross your resource cap"* taken literally.
   */
  | {
      readonly op: 'set-cap';
      /** The reduced cap. Above the printed cap this is a no-op; see the ruling above. */
      readonly to: number;
      readonly target?: EffectTarget;
    }
  /**
   * G1 — MOVE ONE OF THE CARD'S OWN VOTERS to an ADJACENT ZONE. GREAT LEADER, BAD
   * ECONOMY (REF 4.2.1).
   *
   * *"For the rest of the game, every time you influence a 3 Voter Card, the player
   * after you may move 1 of your non-majority voters to an adjacent zone."*
   *
   * ## WHY THIS IS AN OP AND NOT A `target` ON `evict`
   *
   * Two independent reasons, and the second is the one that decides it.
   *
   *  1. **`evict` has no destination.** It resolves to a POOL — the peg goes back to its
   *     owner's mat and re-grants a voter. This card does not return anything to
   *     anybody; it RELOCATES a peg, and a relocation needs a second area id.
   *  2. **`evict` is the wrong VERB, and the direction is what matters.** Eviction is
   *     something done *to* a player. This card hands the beneficiary a free relocation
   *     of a peg that is **not theirs** — the printed effect is a gift, and the only
   *     thing the recipient loses is their freedom of movement elsewhere. Adding a
   *     `target` to `evict` would make a card read as though it helps when it takes.
   *
   * ## WHOSE PEGS, AND WHY IT IS NOT A `target` ON THE OP
   *
   * **The pegs are always the CARD'S ACTOR's**, and `target` is the other axis: it says
   * *who is allowed to move them*. `applyEffect` already resolves one `target` for a
   * whole effect list, so a card cannot also say "move a chosen opponent's voter"; the
   * one axis it can say is the beneficiary, and GREAT LEADER's beneficiary is
   * `'player-after'` — which `EffectTarget` already carries for exactly this card and
   * A COWARD OR A JOURNALIST?.
   *
   * ## WHAT IS LEGAL, and it is checked at BOTH ends of the decision
   *
   * The peg must belong to the card's actor, must **not** already be a majority voter
   * (*"non-majority voters"*, and a majority peg is the score), and must not sit in a
   * Volatile Area — p18 makes a peg there permanent, so it cannot be moved at all. The
   * destination must be an **empty** area in a zone adjacent to the peg's zone
   * (`Zone.neighbours`, already on the board).
   *
   * ## SATISFIABILITY, and why it raises NOTHING rather than raising a dead dialog
   *
   * `applyEffect` raises the `'choose-peg-dest'` decision **only when at least one
   * movable peg AND at least one empty area in an adjacent zone both exist**. A selector
   * that resolves to nothing raises nothing — the same rule `'chosen-zone'` follows and
   * the same reason: an unsatisfiable decision freezes its owner, and `blockedBy` refuses
   * every other action that player could take, so an unsatisfiable choice is a dead
   * TABLE, not a stuck dialog. Proved exhaustively over peg layouts crossed with
   * destination areas at 2/3/4/5 seats in `packages/engine/test/choices.test.ts`.
   *
   * ## VISIBILITY
   *
   * The decision enumerates **the board**, which is nine fixed areas with every peg face
   * up and is on every payload already. It reads no pile and no hand. **No
   * `_`-prefixed field is added** and `packages/server/test/secret-inventory.ts` owes
   * nothing beyond classifying the kind under `'pegs'`.
   *
   * ## THE SCOPE FIELDS ARE ORDINARY
   *
   * `when` / `until` / `condition` are read by `installLiveEffects` and `fireTriggers`
   * one function above `applyEffect`, exactly as they are for `voters` (GROWING
   * DISSENT) and `steal-any` (LAB-GROWN EARWORM). This op has no lifetime or trigger of
   * its own, so `isScoped` does not carve it out.
   */
  | { readonly op: 'move-peg'; readonly n: Count; readonly target?: EffectTarget }
) &
  EffectScope;


/**
 * The `n` of a non-resource Effect: a literal, or a quantity read out of player
 * state.
 *
 * G15 / G4. The widening is safe *because* `reduce()` resolves it before it pushes
 * anything: `Choice.count` is still a `number` at the point it is constructed, so
 * TypeScript still stops a computed count from reaching the engine as one. See
 * `resolveCount` in reduce.ts.
 */
export type Count = number | ComputedCount;


/**
 * The fields the two X-card types share.
 *
 * `duration` and `timing` are EXECUTED — `installLiveEffects` turns a lasting
 * `duration` into a `GameState.liveEffects` entry and `timing` sets when it may
 * first act. `interrupt` is still inert, because it is not an effect at all (see
 * `Interrupt` above).
 */
export type XCardScope = {
  /**
   * G9/G22. `'this-turn'` — the default, and the value every shipped card means —
   * is what the engine always did: resolve the effects once, discard the card. Any
   * other value installs them as a `LiveEffect` that lives until the named expiry.
   *
   * A lasting `duration` with no per-effect `when` installs ONE standing effect
   * holding the whole list, re-applied at the top of every one of the owner's turns
   * until it expires. Per-effect `when` / `until` take precedence and are installed
   * one entry each, so a card may mix a one-shot branch with a lasting hook.
   */
  readonly duration?: EffectDuration;
  /** G22 — `'now'` (default) or `'next-turn'` (dormant until the owner's next turn). */
  readonly timing?: EffectTiming;
  /** G13. EXECUTED for `block` and `deflect`; refused for the other three ops. */
  readonly interrupt?: Interrupt;
};

export type ConspiracyCard = {
  readonly id: CardID;
  readonly name: string;
  /** Player-facing rules text. Must describe exactly what `effects` does. */
  readonly text: string;
  /** p19: "bought for any 4-5 resources, denoted on the back of the card." */
  readonly cost: number;
  readonly effects: readonly Effect[];
  /** p27: cards marked 2✕ are removed in the two-player game. */
  readonly excludeInTwoPlayer?: boolean;
} & XCardScope;

export type HeadlineCard = {
  readonly id: CardID;
  readonly name: string;
  readonly text: string;
  readonly effects: readonly Effect[];
  readonly excludeInTwoPlayer?: boolean;
} & XCardScope;

// ─────────────────────────── the index handed to the reducer ───────────────────────────

export type CardIndex = {
  readonly ideology: Readonly<Record<CardID, IdeologyCard>>;
  readonly voter: Readonly<Record<CardID, VoterCard>>;
  readonly conspiracy: Readonly<Record<CardID, ConspiracyCard>>;
  readonly headline: Readonly<Record<CardID, HeadlineCard>>;
};

export function indexCards(input: {
  readonly ideology: readonly IdeologyCard[];
  readonly voter: readonly VoterCard[];
  readonly conspiracy: readonly ConspiracyCard[];
  readonly headline: readonly HeadlineCard[];
}): CardIndex {
  const by = <T extends { id: CardID }>(xs: readonly T[]): Record<CardID, T> =>
    Object.fromEntries(xs.map((x) => [x.id, x]));
  return {
    ideology: by(input.ideology),
    voter: by(input.voter),
    conspiracy: by(input.conspiracy),
    headline: by(input.headline),
  };
}

/** Total resources an Ideology Card side pays. Used by the balance checker. */
export function sidePayout(side: IdeologySide): number {
  return (side.pays.funds ?? 0) + (side.pays.clout ?? 0) + (side.pays.media ?? 0) + (side.pays.trust ?? 0);
}

export type { Resource };
