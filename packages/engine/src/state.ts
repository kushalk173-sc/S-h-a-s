/**
 * Core state types for SHASN.
 *
 * Every rule referenced here is recorded in `docs/rules-reference.md` with a page
 * number from the Collectors Edition rulebook.
 *
 * CONVENTION: any field prefixed with `_` is SERVER-ONLY and must be stripped
 * before the state is sent to a client. See `playerView.ts`. This is not a style
 * choice and the underscore is load-bearing and enforced by test — but the
 * reason CHANGED with full information, and the old reason would be a lie here.
 *
 * It used to read "the blind-answer mechanic dies if card payouts reach the client". It does
 * not: the payout is published to every seat now, by decision, in the server's
 * `PublicQuestion`. What the convention now protects is the four draw piles and the four
 * discard piles, `_seed` — which is the input to the seed-derived answer ORDER, the last
 * channel by which a display position could carry the deck's Ideologue balance — `_idSeq`,
 * and the pending card's ID. The full record of the change, with the measurements behind it,
 * is `packages/server/src/FULL-INFORMATION.md`, and the rulings are on `GameState._pendingCard`
 * and on `playerView`'s own header.
 */

import type { Effect, EffectCondition, EffectDuration, EffectTiming, EffectTrigger } from './cards';

export type PlayerID = string;
export type CardID = string;
export type AreaID = string;

/** The nine constituencies. Fixed set — the board is not procedurally generated. */
export type ZoneID =
  | 'north_west'
  | 'north'
  | 'north_east'
  | 'west'
  | 'central'
  | 'east'
  | 'south_west'
  | 'south'
  | 'south_east';

export const ZONE_IDS: readonly ZoneID[] = [
  'north_west',
  'north',
  'north_east',
  'west',
  'central',
  'east',
  'south_west',
  'south',
  'south_east',
] as const;

/** The four Ideologues. Every Ideology Card answer belongs to exactly one. */
export type Ideologue = 'capitalist' | 'supremo' | 'showstopper' | 'idealist';

/** The four resources. Each maps one-to-one onto an Ideologue. */
export type Resource = 'funds' | 'clout' | 'media' | 'trust';

export const IDEOLOGUES: readonly Ideologue[] = [
  'capitalist',
  'supremo',
  'showstopper',
  'idealist',
] as const;

export const RESOURCES: readonly Resource[] = ['funds', 'clout', 'media', 'trust'] as const;

/** Rulebook p11 & p33. Capitalist→Funds, Supremo→Clout, Showstopper→Media, Idealist→Trust. */
export const IDEOLOGUE_RESOURCE: Readonly<Record<Ideologue, Resource>> = {
  capitalist: 'funds',
  supremo: 'clout',
  showstopper: 'media',
  idealist: 'trust',
};

export const RESOURCE_IDEOLOGUE: Readonly<Record<Resource, Ideologue>> = {
  funds: 'capitalist',
  clout: 'supremo',
  media: 'showstopper',
  trust: 'idealist',
};

/** A fully-populated resource pool. Never partial. */
export type Pool = { readonly [R in Resource]: number };

/** A cost or payout. Partial — omitted resources mean zero. */
export type Delta = Partial<Record<Resource, number>>;

/**
 * One voter peg sitting in one Area.
 * `majority` is the physical act of flipping the peg symbol-side up (p8).
 */
export type Peg = {
  readonly owner: PlayerID;
  readonly majority: boolean;
};

/** One slot on the board. p34: "Each slot on the board where a voter can be placed." */
export type Area = {
  readonly id: AreaID;
  readonly zone: ZoneID;
  /** p18. A peg here is permanent and triggers a Headline when placed. */
  readonly volatile: boolean;
  readonly peg: Peg | null;
};

export type Zone = {
  readonly id: ZoneID;
  readonly name: string;
  /** Voters one player needs to take the zone. The numerator of the printed fraction. */
  readonly majority: number;
  /** Total areas. The denominator of the printed fraction. */
  readonly capacity: number;
  readonly neighbours: readonly ZoneID[];
  readonly areas: readonly Area[];
  /** Who currently holds the majority here, or null. Derived; cached for the UI. */
  readonly majorityHolder: PlayerID | null;
};

/**
 * Voters a player has influenced but not yet placed.
 *
 * p10: voters from a single Voter Card cannot be split across zones; voters from
 * any other source can be.
 *
 * A group lives on the mat of the player who must place it, and is discarded at the
 * end of *that player's* turn. That single rule covers both published cases: voters
 * you influence must be placed the same turn (p10), and an evicted voter is placed
 * on its owner's next turn or discarded (p34).
 */
export type PendingVoters = {
  readonly id: string;
  readonly count: number;
  /** true for Voter Card groups, false for evictions, headlines, conspiracies. */
  readonly sameZone: boolean;
  readonly source: string;
};

/** Per-turn use counters for Ideologue Powers. Reset at the start of every turn. */
export type PowerUses = {
  readonly prospecting: number;
  readonly landGrab: number;
  readonly donations: number;
  readonly payback: number;
  readonly goingViral: number;
  readonly helpingHands: number;
  readonly toughLove: number;
  /** Zone IDs already gerrymandered from this turn, and how many moves used there. */
  readonly gerrymandered: Readonly<Record<string, number>>;
};

export const NO_POWER_USES: PowerUses = {
  prospecting: 0,
  landGrab: 0,
  donations: 0,
  payback: 0,
  goingViral: 0,
  helpingHands: 0,
  toughLove: 0,
  gerrymandered: {},
};

export type PlayerState = {
  readonly id: PlayerID;
  readonly name: string;
  /** Peg colour. Purely presentational, but stable and server-assigned. */
  readonly colour: string;
  readonly resources: Pool;
  /** One entry per answered Ideology Card, in answer order. p13. */
  readonly manifesto: readonly Ideologue[];
  /**
   * Card IDs of ANSWERED Ideology Cards, parallel to `manifesto`. **PUBLIC, and the
   * visibility decision is reused by `ideologyCards` below — so read both.**
   *
   * Public because p13 (`rules-reference.md:238`) says *"Keep the Ideology Card
   * under your mat, answer face up"*: an ANSWERED card is face up under the mat, and
   * the Ideologue it carried is that player's public identity, which is what the
   * Ideologue power ladder (p28-33) is read from. The rulebook draws the line at
   * *answered* — see the long note on `ideologyCards`, which is the other half.
   */
  readonly manifestoCards: readonly CardID[];
  readonly conspiracies: readonly CardID[];
  /**
   * G20 — Ideology Cards this player is HOLDING, face down, waiting to be put to
   * them. A HIDDEN HAND, and this is the ruling, argued at length because it is the
   * security decision G20 exists to make and every shortcut through it destroys the
   * game's central mechanic.
   *
   * ## THE RULING, in one line
   *
   * **A transferred Ideology Card is HELD AND HIDDEN — from everyone, including the
   * player it was given to. It is never face up, and it is never put straight to the
   * receiver.**
   *
   * ## 1. Why HIDDEN and not face-up: the rulebook's own line, read closely
   *
   * p13 (`rules-reference.md:238-239`) is two sentences doing two separate jobs, and
   * the whole ruling falls out of taking them apart:
   *
   * > *"Keep the Ideology Card under your mat, answer face up. **Keep the card
   * > hidden until the active player confirms their answer.**"*
   *
   * The first sentence is what makes a card PUBLIC, and the thing that earns it is
   * not "the card is on the table" — it is **"answer face up"**, i.e. that an answer
   * has happened. That is exactly `manifestoCards`, and that is why
   * `manifestoCards` is public. The second sentence is what makes a card HIDDEN, and
   * what it conditions on is **"until the active player confirms their answer"** —
   * that is, on the absence of an answer, not on which pile the card came from.
   *
   * A card donated by A COWARD OR A JOURNALIST? has not been answered. So the second
   * sentence is the one that applies to it, and the first is not. **The rulebook
   * draws the line at *answered*, and both existing fields sit on the correct side of
   * it.** This is why the `manifestoCards` precedent could not simply be reused: that
   * precedent is the face-up-answered pile, and a donation is not an answer. Putting
   * a donated card there would have had it both faces up (a p13 violation) and
   * counted as an answered card, which changes the Ideologue power ladder — p28-33
   * count CARDS, so a card a player never answered would unlock their power.
   *
   * ## 2. Why hidden from the RECIPIENT too, and not just from the table
   *
   * Because the client state is a **machine-readable payload**, and
   * `docs/ARCHITECTURE.md` §8.1.1 (D25, the labelled note) is entirely about that
   * difference: *"The opponent can see it"* and *"the opponent's client process
   * holds it, along with the whole ordered deck"* are different claims with different
   * consequences, and only the first is what a physical table does. Physical Shasn
   * hands a card face down and never turns it over — so the digital game giving the
   * receiver MORE information than the physical one is the D25 failure in a new
   * costume. Hence the precedent is `conspiracies` and not `manifestoCards`:
   * `PRIVATE_PLAYER_KEYS` strips it for **every** viewer with no `pid === viewer`
   * branch, and `ideologyCards` is in that list for the same reason. The answer to a
   * card a player is holding is a coin flip they make; a player shown the card in
   * their own hand has not made one.
   *
   * ## 3. Why it is never put STRAIGHT to the receiver: the anti-collision rule
   *
   * The answer window is a single nullable field, `GameState._pendingCard`. A hand is
   * a queue. **The queue is drained at the turn boundary, one card per turn, IN PLACE
   * OF that turn's draw** — see `advanceTurn` in `reduce.ts`. The two therefore
   * cannot collide: `_pendingCard` is written exactly once per turn, by the boundary,
   * and a hand is read only there. A card that arrives while somebody is mid-answer
   * sits in the queue and is dealt with at the next boundary, so:
   *
   *  - the receiver's answer is the card they already had, unchanged;
   *  - `_pendingCard` is never rewritten by a card effect, so a resolution can never
   *    change what a player is being asked and no client can observe a change;
   *  - the receiver cannot see it, cannot answer it, and cannot learn that it exists.
   *
   * The "one per turn, in place of the draw" is also the p21 invariant (one Ideology
   * Card and one answer per turn) preserved under an extra card in the world, which
   * is what makes the queue incapable of starving the deck loop or of piling up
   * unbounded. A player whose hand is empty is back on the deck exactly as before,
   * and a player whose hand is not empty has a card — so there is no position this
   * field can create in which a turn has no legal first move. That is the hard-lock
   * argument, and it is tested rather than asserted (`card-transfer.test.ts`).
   *
   * ## 4. NO THIRD CATEGORY, deliberately
   *
   * There are exactly two places an Ideology Card can be, and this type is one of
   * them. A "face up, unheld, sitting in front of the player" zone is NOT added,
   * because nothing in the rulebook or the corpus creates one: a card is either
   * face down in a hand, or face up under a mat having been answered. `move-card`
   * can therefore only move a card between the hidden side and a pile — it can never
   * write `manifestoCards`, and it can never write `_pendingCard`. Both prohibitions
   * are assertions in `card-transfer.test.ts`, because both are the exact two ways
   * this mechanic could destroy the answer window.
   *
   * ## WHY IT IS OPTIONAL — the same wart, and the same reason as `restrictions`
   *
   * A REQUIRED field breaks every hand-built `PlayerState` literal in
   * `packages/client` and `packages/server` — `choiceResolver.test.tsx` is one, and
   * it does not even carry `restrictions`. `setup()` writes `[]` and only `setup()`
   * and `reduce()` build a `PlayerState` in this package, so `undefined` means
   * exactly one thing: a fixture that has not been updated. Every read goes through
   * `ideologyHandOf`, which treats absent as empty.
   *
   * ## OWES THE SERVER AN ENTRY
   *
   * `packages/server/test/secret-inventory.ts` `LEAK_PATHS` lists the private but
   * unprefixed fields it asserts the wire does not carry, and `conspiracyHand` is
   * the only one. **`players[].ideologyCards` needs an entry there beside it** — the
   * same class of leak, the same shape of assertion, and the engine's own strip does
   * not make the server's list unnecessary: a list that rots silently is worse than
   * one that is stale loudly. That file is not this package's to change and the
   * omission is flagged in three places so it cannot read as an oversight.
   */
  readonly ideologyCards?: readonly CardID[];
  readonly pending: readonly PendingVoters[];
  readonly powerUses: PowerUses;
  /**
   * G5 — rules attached to this player that other actions must consult. PUBLIC, and
   * it must be listed as a deliberate non-secret in
   * `packages/server/test/secret-inventory.ts`; see `Restriction` for why and for the
   * two rulings the type forces.
   *
   * ## WHY THIS IS OPTIONAL, which is a wart and a coordination debt
   *
   * `PlayerState` is constructed by hand in `packages/client` and
   * `packages/server` tests, and a REQUIRED new field breaks every one of those
   * literals — including `packages/client/src/app/choiceResolver.test.tsx`, which
   * this package does not own. Rather than break a package I cannot edit, the field
   * is optional and every read goes through a helper that treats absent as empty.
   *
   * **It is never absent in a state this engine produced.** `setup()` writes `[]`
   * and only `setup()` and `reduce()` build a `PlayerState` in this package, so
   * `undefined` means exactly one thing: a hand-built literal that has not been
   * updated. The one-line fix for the client, when its owner gets to it, is
   * `restrictions: []` in that fixture — and it is worth doing rather than leaving,
   * because an optional field on a state type is exactly the kind of thing that
   * quietly becomes load-bearing.
   */
  readonly restrictions?: readonly Restriction[];
  /**
   * G15 — a cap LOWERED for this player, which every resource rule must read instead of
   * `rules.resourceCap`. THE BIG FREEZE: *"Reduce your resource cap to 10."*
   *
   * ## WHY IT IS A `PlayerState` FIELD AND NOT A `Restriction`
   *
   * `Restriction` is a rule other ACTIONS consult at a gate — a purchase is refused, a
   * power is unavailable. A cap is not a gate, it is a NUMBER that half a dozen rules
   * read arithmetically, and `enforceCap` / `overCap` / the balance checker all compare a
   * pool against it. Putting a cap in `restrictions` would mean `applyEffect` becoming a
   * cap resolver and every pool comparison growing a lookup.
   *
   * ## THE DEADLOCK RULING, and it is the whole reason this is safe
   *
   * THE REFUSAL ON THIS GAP — *"lowering a cap under an already-over player is the
   * `convert-voter` soft-lock shape"* — **does not hold, and the reason is arithmetic
   * rather than a mitigation.** `enforceCap` raises `count = overCap(pool, cap) =
   * max(0, total - cap)`, and since `total >= 0` and `cap >= 0` that ask satisfies
   * `excess <= total`, i.e. **the ask can never exceed what the player holds.** Discarding
   * it leaves `total - excess = min(total, cap) >= 0`, so the target state is REACHABLE,
   * not merely approached. And `lose-any` is additionally clamped to the chooser's pool as
   * it stands when the decision is ANSWERED (`packages/engine/test/choices.test.ts` pins
   * this for the ordinary p12 crossing), so a pool that drains in between lowers the ask
   * rather than stranding it.
   *
   * So the defect the refusal feared — a decision whose ACCEPTABLE ANSWERS are empty, which
   * is the `convert-voter` bug and is a permanent freeze — cannot arise: every pick that
   * removes `excess` is legal, and there are always enough resources to make one. What the
   * cap drop changes is the TIMING of a discard p12 already demands, not whether it can be
   * made. `tests` assert the arithmetic directly at 2/3/4/5 seats.
   *
   * ## STACKING TAKES THE MINIMUM, and that is the safe direction
   *
   * Two overlapping `set-cap` effects write one field, so the second overwrites the first
   * and expiry cannot restore independently. Rather than a list, `reduce()` keeps the MORE
   * restrictive of the two — `min(existing, to)` — and `expireCapOverrides` at the turn
   * boundary lifts it back to `rules.resourceCap` when nothing is holding it. A cap can
   * therefore only ever go DOWN from the printed value and back, never above it, which is
   * also the only behaviour the balance checker could reason about.
   *
   * ## `expiresTurn` IS NOT RE-CHECKED ON READ, deliberately
   *
   * `capOverrideOf` takes a `PlayerState`, not a `GameState`, so it cannot see the turn;
   * re-deriving the deadline here would be a SECOND definition of the same expiry, which is
   * how a rule lives one turn too long in one place and not another — the same ruling
   * `usesLeft` follows for `Restriction.expiresTurn`. `expireCapOverrides` in
   * `advanceTurn` is the only thing that retires it, on the same clock that resets
   * `powerUses`.
   *
   * ## PUBLIC, and why it owes the server nothing
   *
   * Unprefixed, and the argument is p12's own: the cap is printed on the player's mat and a
   * tax somebody else must predict before they act is a different game — the same argument
   * as `restrictions`. It is also **optional** for the same reason `restrictions` is (a
   * required field breaks hand-built `PlayerState` literals in packages this one may not
   * edit); `undefined` therefore means "no reduction in force", which is exactly the
   * printed state.
   */
  readonly capOverride?: { readonly to: number; readonly expiresTurn: number | null };
  readonly isBot: boolean;
};

/**
 * Which pegs a voter-targeting decision may name.
 *
 * THE RULING, and it is a ruling because the corpus needs two different answers.
 * RED BLOODED (REF 4.3) says *"You must discard any 2 voters"* — any peg on the
 * board. AIN'T NO CURE FOR LOVE (REF 4.3) says *"Discard 2 of your own voters"* —
 * only the chooser's own. Both are real cards, both land on `discard-voter`, and
 * the engine cannot tell them apart without a second field on the op.
 *
 * So the scope is derived from WHO is being asked, which is the one thing the card
 * always states and the one thing that reads correctly either way:
 *
 * | who resolves it | scope | why |
 * |---|---|---|
 * | the caster, no `target` | `'others'` | the card did not say "your own"; the three shipped cards say "your opponents'" |
 * | the caster, `target: 'you'`, `discard-voter` | `'own'` | *"Discard 2 of your OWN voters"* — AIN'T NO CURE FOR LOVE, REF 4.3. **G-new, and it is the raw field that makes it say so**: `applyEffect` defaults an absent `target` to `'you'`, so an absent field and an explicit one used to arrive here indistinguishable, and the card text had to be weakened to match |
 * | a player the card named | `'own'` | *"All your opponents evict 1 voter"* — they choose which of theirs, exactly as a victim of a theft picks the denomination |
 * | the caster, evicting | `'any'` | eviction already allowed any peg before this field existed, and `evict` is the one op whose real text says "any voter" |
 *
 * `'others'` is the default and it is deliberately unchanged from what `resolveChoice`
 * did before this type existed, so no shipped card's behaviour moves and the client's
 * own copy of this rule (`packages/client/src/app/derive.ts`) keeps agreeing with it.
 * `'own'` is reachable by naming the victim with `target`, which is what makes
 * "discard 2 of your own voters" expressible at all. `'own'` is NOT reachable for
 * `convert-voter`, because `resolveChoice` refuses a pick on the chooser's own peg —
 * converting your own voter into your own voter is not a conversion — and a `target`
 * that says `'you'` does not make it one. See `voterScope` in `reduce.ts`.
 */
export type ChoiceScope = 'any' | 'others' | 'own';

/**
 * G16 — the constituency a voter decision is confined to, once it has been RESOLVED.
 *
 * `'any'` is an ABSENT `zone` on the op, spelled out here so `PendingChoice.choice`
 * is a value the client's switch can be total over. The other three are the
 * `ZoneSelector` values, already resolved: `'chosen-zone'` has become one concrete
 * `ZoneID` by the time a decision exists, which is the whole point of resolving it
 * in `resolveChoice` rather than carrying the selector to the UI.
 *
 * `ZoneID` itself is a fourth possible value and is deliberately NOT in this union:
 * a `zone` on a decision is always a selector, and a `ZoneID` reaching the UI is
 * `resolveChoice` refusing the pick — a client cannot act on one.
 */
export type ZoneScope = 'any' | 'this-zone' | 'your-strongest' | 'chosen-zone';

/**
 * A decision the engine is waiting on. Conspiracies and Headlines are data, and
 * some of their effects need a target the engine cannot pick for the player.
 */
export type Choice =
  | { readonly kind: 'gain-any'; readonly count: number; readonly reason: string }
  | { readonly kind: 'lose-any'; readonly count: number; readonly reason: string }
  | {
      readonly kind: 'steal-any';
      readonly count: number;
      /**
       * The fixed victim, or null when the thief picks one.
       *
       * Set when the card named its victims (`target`), and also when a live effect
       * fires on somebody's purchase — LAB-GROWN EARWORM's victim is whoever just
       * bought, which is event context rather than a card field. `resolveChoice`
       * REQUIRES a pick to name this player, so a client cannot redirect the theft.
       */
      readonly from: PlayerID | null;
      readonly reason: string;
    }
  | { readonly kind: 'evict-voter'; readonly count: number; readonly scope: ChoiceScope; readonly zone?: ZoneScope; readonly zoneId?: ZoneID; readonly reason: string }
  | { readonly kind: 'discard-voter'; readonly count: number; readonly scope: ChoiceScope; readonly zone?: ZoneScope; readonly zoneId?: ZoneID; readonly reason: string }
  | { readonly kind: 'convert-voter'; readonly count: number; readonly scope: ChoiceScope; readonly zone?: ZoneScope; readonly zoneId?: ZoneID; readonly reason: string }
  /**
   * G1 — THE CARD'S ACTOR NAMES A PLAYER. `EffectTarget = 'chosen-player'`.
   *
   * ## WHY IT IS ONE `Choice` KIND AND NOT A FIELD ON THE OTHER SIX
   *
   * Every existing kind answers *"which of these things?"* — which resources, whose
   * pool, which slots. This one answers *"which player?"*, and a player is not a
   * resource and not a slot: `steal-any`'s pick already carries a player because a
   * THEFT is self-contained (the pick names the victim and the denomination, and the
   * resolver can finish the job), but no other op carries enough on its pick to apply
   * itself. So this kind carries the effect list it is gating, and `resolveChoice`
   * re-runs `applyEffect` once per named player with that player forced.
   *
   * ## SATISFIABILITY, which is the property that matters
   *
   * `applyEffect` raises this ONLY when `turnOrder` has at least one seat other
   * than the actor's — the candidate set is literally `turnOrder.filter(p => p !==
   * source)`, and the resolver accepts any member of exactly that set. The offered
   * options and the acceptable answers are therefore the same list, computed by the
   * same expression, so **no state can raise this with no legal pick.** A two-seat
   * game has exactly one candidate and it is always legal. Asserted exhaustively at
   * 2/3/4/5 seats in `test/choices.test.ts`.
   *
   * ## VISIBILITY: PUBLIC, and the argument is the leak argument
   *
   * **The choice itself is public: it names no hidden thing.** Its candidate set is
   * `turnOrder`, which every client already has in full, and a player who holds no
   * resources and no cards is *still* a candidate — deliberately, because filtering
   * the list by what somebody holds would make the option list a readout of their mat
   * and their hand. An option list is as revealing as a value; see
   * `PlayerState.ideologyCards` for the same principle applied to a hand.
   *
   * `effects` is on the wire and that is sound for the reason `LiveEffect.sourceCardId`
   * is: a `Choice` is only ever raised by a card that is being resolved right now
   * (`PLAY_CONSPIRACY` / `ACK_HEADLINE`), both of which put the card face up on the
   * discard pile in the same breath, so the effects cannot name a card anybody is
   * still holding secretly. **No `_`-prefixed field is added**, so
   * `packages/server/test/secret-inventory.ts` owes nothing.
   *
   * ## `source` is ON THE CHOICE, and it has to be
   *
   * The resolver re-runs the effect with the ORIGINAL actor as `source`, because
   * `source` is what every relative read is measured from — `steal-any` takes its
   * victim from `fire.actor`, and `'you'` means "the card's player". Dropping it
   * would silently re-attribute the card to whoever it landed on, which is the
   * DEFLECT bug in a different place. It is public for the same reason `LiveEffect.owner`
   * is: the actor of a card already on the table is on the log.
   */
  | {
      readonly kind: 'choose-player';
      /** How many players to name. `1` for every recovered card; 2 is POLO RETREAT. */
      readonly count: number;
      /** The effect list to run once per named player. Never empty. */
      readonly effects: readonly Effect[];
      /** The card's actor. See the note above. */
      readonly source: PlayerID;
      readonly reason: string;
    }
  /**
   * G16 — THE CARD'S ACTOR NAMES A CONSTITUENCY. `ZoneSelector = 'chosen-zone'`.
   *
   * ## SATISFIABILITY
   *
   * The candidate set is the nine `ZONE_IDS`, or the subset of them that contain at
   * least one peg the decision could name when the same effect also carries a
   * `target`. **`applyEffect` raises this only when that set is non-empty**, for the
   * same reason `choose-player` does: the offered list and the acceptable list are
   * one expression, so the choice cannot be unsatisfiable. A selector resolving to
   * zero zones raises NOTHING rather than raising a decision nobody can answer — and
   * raising nothing is honest here, because "select one of your majorities" cannot
   * be performed by a player who holds none.
   *
   * ## VISIBILITY: PUBLIC, and it leaks nothing at all
   *
   * The board is fully public — nine fixed areas, every peg face up. There is no
   * version of this choice that could enumerate a hidden hand, because a zone is not
   * a card. This is the reason the two G16 selectors that need no decision
   * (`'this-zone'`, `'your-strongest'`) are plain functions of public state too.
   */
  | {
      readonly kind: 'choose-zone';
      readonly count: number;
      /** The effect list to run once per chosen zone. Never empty. */
      readonly effects: readonly Effect[];
      readonly source: PlayerID;
      readonly reason: string;
    };

/** Whose decision it is. Headlines can penalise a player who is not the active one. */
export type PendingChoice = {
  readonly id: string;
  readonly player: PlayerID;
  readonly choice: Choice;
};

export type Phase =
  /** The active player has an Ideology Card put to them and has not answered. */
  | 'answer'
  /** Free-form turn actions, any order, repeatable. p21. */
  | 'actions'
  /** Post-turn: one Headline per voter placed in a Volatile Area this turn. p18. */
  | 'headlines'
  | 'finished';

export type LogEntry = {
  readonly turn: number;
  readonly player: PlayerID | null;
  readonly text: string;
  readonly kind: 'answer' | 'voters' | 'majority' | 'gerrymander' | 'power' | 'card' | 'system';
};

/** A face-up Voter Card on the HQ Mat. Public information. */
export type MarketSlot = {
  readonly cardId: CardID;
  readonly cost: Delta;
  readonly voters: number;
};

/**
 * G9 / G22 — AN EFFECT THAT OUTLIVES THE CARD THAT INSTALLED IT.
 *
 * Before this type, `reduce()` resolved a Conspiracy or Headline Card's `effects`
 * once, discarded the card, and had no way to remember that the card had said
 * anything lasting. Every real card in that position — PYTHONPOST, GROWING
 * DISSENT, SNOOP B-O-DOUBLE-T, THE BIG FREEZE — therefore had to ship as a lie or
 * not at all (KNOWN-GAPS §2 G9, §3 item 2).
 *
 * ## Visibility: PUBLIC, and that is a ruling with an argument, not an omission
 *
 * `playerView.ts` strips `_`-prefixed keys and separately blanks
 * `PlayerState.conspiracies`, because a Conspiracy Card is a hidden hand
 * (rules-reference.md:284-286). A live effect is neither:
 *
 *  - It can only be created by a card that is being RESOLVED — `PLAY_CONSPIRACY`
 *    or `ACK_HEADLINE` — and both of those put the card face up on the discard pile
 *    in the same breath. There is no path from a card in a hidden hand to a
 *    `LiveEffect`, so `sourceCardId` can never name a card anybody is still holding
 *    secretly.
 *  - Every real card that creates one announces it. KHAKI TERROR's whole point is
 *    that everyone can see you cannot buy; a surcharge on somebody's purchases is
 *    a cost every other player must be able to predict. "A Headline is in force
 *    until my next turn" is a public condition with public parameters.
 *
 * So `liveEffects` is unprefixed and reaches every client. That is also why no
 * change is owed to `packages/server/test/secret-inventory.ts`: a new `_` field
 * would have needed a deliberate entry there, and this avoided the need entirely.
 * If a future card ever needs a *hidden* live effect — THE PSYCHOHISTORIAN's
 * unrevealed three-action detector is G7, and it is exactly that case — the
 * mechanism is a `_`-prefixed twin list, not a re-interpretation of this one.
 *
 * ## Why the lifetime is two integers and not a rule
 *
 * `activeFrom` / `expiresAt` are ABSOLUTE turn numbers, computed once at install
 * from the installing turn and the seat order. A live effect therefore needs no
 * "whose turn is it" logic at expiry time, and — the load-bearing part — a replay
 * from seed + action log reproduces it exactly, because the numbers are already in
 * the state that was written down. `null` on `expiresAt` is "rest of game".
 */
export type LiveEffect = {
  /** `L<n>` from `GameState._idSeq`. R2: no module-scope counter. */
  readonly id: string;
  /**
   * The player the effect belongs to. Its `target` resolves against them, and it
   * is the seat whose turn boundary a standing effect acts on.
   */
  readonly owner: PlayerID;
  /** The card that installed it. Public for the reason in the note above. */
  readonly sourceCardId: CardID;
  /**
   * The event that fires this effect, or `null` for a STANDING effect — one with a
   * lifetime but no event, re-applied at the top of every one of the owner's turns
   * until it expires. That is ERADICATING GERMS' "discard an open Voter Card every
   * turn (mandatory)".
   */
  readonly trigger: EffectTrigger | null;
  /** Narrowing on the firing event. Absent means "always". */
  readonly condition?: EffectCondition;
  readonly effects: readonly Effect[];
  /** The first turn number on which this effect may act. */
  readonly activeFrom: number;
  /** The turn number on which it is removed. `null` = rest of game. */
  readonly expiresAt: number | null;
};

/** Is this live effect in force on `turn`? Dormant-before and expired-both read false. */
export function isInForce(le: LiveEffect, turn: number): boolean {
  if (le.activeFrom > turn) return false;
  return le.expiresAt === null || le.expiresAt > turn;
}

/**
 * The turn number on which `owner` next takes their turn.
 *
 * `turnOrder` is the seat order, and turn N belongs to `turnOrder[(N-1) % n]` —
 * `setup()` deals the first card to `turnOrder[0]` and `advanceTurn` walks the list
 * from the outgoing player's own index, so the offset arithmetic below is exact
 * rather than approximate. An unknown seat falls back to "the very next turn",
 * which is the conservative answer: expire sooner, never later.
 */
export function ownerNextTurn(state: GameState, owner: PlayerID): number {
  const n = state.turnOrder.length;
  const a = state.turnOrder.indexOf(state.activePlayer);
  const o = state.turnOrder.indexOf(owner);
  if (n === 0 || a < 0 || o < 0) return state.turn + 1;
  const step = (o - a + n) % n;
  return state.turn + (step === 0 ? n : step);
}

/**
 * The first turn number of the round AFTER the one in progress — i.e. the
 * `'round'` expiry, for GROWING DISSENT's "starting this turn, for 1 round".
 *
 * Turn 1 is `turnOrder[0]`'s, so the round in progress ends after the last seat's
 * turn and the next round begins on `turn + (n - (turn - 1) mod n)`. With three
 * players: turn 1 -> 4, turn 2 -> 4, turn 3 -> 4, turn 4 -> 7.
 */
export function roundEndTurn(state: GameState): number {
  const n = Math.max(1, state.turnOrder.length);
  return state.turn + (n - ((state.turn - 1 + n) % n));
}

/**
 * G5 — a RULE ATTACHED TO A PLAYER THAT OTHER THINGS MUST CONSULT.
 *
 * A restriction is not an effect. `Effect` describes what a resolution *does* to a
 * pool, a mat or the board; a restriction describes what a player may no longer
 * *do*, and every action that could breach it has to ask. Putting it in `Effect[]`
 * would have meant teaching `applyEffect` to be a cost-modifier resolver and a
 * permission check at the same time, which is a different mechanism with a
 * different failure mode: an effect that silently does nothing is a card that lies,
 * and a restriction that is never consulted is a card that lies the other way round —
 * it promises a lock and grants none.
 *
 * ## Visibility: PUBLIC, deliberately, and non-obviously
 *
 * A Conspiracy Card hand is secret (rules-reference.md:284-286) and is blanked in
 * `playerView`. A restriction is the opposite: **every real card that imposes one
 * announces it**, and KHAKI TERROR's entire punchline is that everyone can see you
 * cannot buy. A surcharge is a price every other player must be able to predict
 * before they act. So `restrictions` is unprefixed and reaches every client.
 *
 * **THIS OWES THE SERVER AN ENTRY.** `packages/server/test/secret-inventory.ts`
 * lists what the server treats as secret, and `restrictions` must appear in it as a
 * deliberate NON-SECRET. That file is not this package's to change, and the omission
 * is the one thing in this iteration that another owner has to make: without the
 * entry, a later reader cannot tell whether the absence was a decision or an
 * oversight, and a future `PRIVATE_PLAYER_KEYS` addition could swallow the list.
 */
export type RestrictionKind =
  /** *"You cannot make any purchases until you do so."* KHAKI TERROR. */
  | 'no-purchases'
  /** *"All Voter Cards cost any 1 extra resource in your turn."* PYTHONPOST. */
  | 'surcharge'
  /**
   * G5 — *"You cannot use one of your unlocked Level 3 Ideologue Powers in your next
   * turn."* GENDER TROUBLE.
   *
   * **THIS IS NOT "THE POWER IS SPENT" AND IT IS NOT A LEVEL RULE.** The engine
   * implements it in exactly one place, `usesLeft` in `powers.ts`, which returns 0 for
   * every power the restricted player holds — so the restriction is total, and a card
   * that wants to name ONE power has nothing to name it with. That is a dropped
   * clause, not a different reading: the printed card says *one of your unlocked Level
   * 3 powers*, and choosing which is a decision over powers, which is G1 and a
   * `Choice` kind this package cannot add. KNOWN-GAPS §4 records GENDER TROUBLE as
   * *"one of your unlocked Level 3 powers"*; what ships is *"none of your powers"*.
   *
   * **WHY `usesLeft` IS THE RIGHT HOOK, and it is worth saying.** A power's
   * availability is `usesLeft(...) <= 0` in EVERY `POWER_*` case, so this is one edit
   * rather than seven, and it cannot drift: a power added to the vocabulary later
   * consults the restriction the moment its action checks `usesLeft`, which every one
   * of them must do already or the power would be free.
   *
   * **EXPIRY IS NOT CHECKED HERE, and that is deliberate rather than forgotten.**
   * `expiresTurn` is an absolute turn number and `expireRestrictions` in
   * `advanceTurn` removes what has run out, on the same clock that resets
   * `powerUses`. `usesLeft` takes a `PlayerState`, not a `GameState`, so it cannot see
   * the turn — and re-deriving expiry from the player alone would be a SECOND
   * definition of the same deadline, which is how a card ends up living one turn too
   * long in one place and not another. `restrictions.test.ts` pins that a `no-power`
   * imposed with `until: 'next-turn'` is in force for exactly the owner's next turn.
   *
   * **Visibility: PUBLIC, unchanged, and for the same reason as its two siblings.** A
   * restriction is a rule every other player must be able to predict, and every real
   * card imposing one announces it; GENDER TROUBLE's whole effect is the victim
   * knowing they cannot use their powers next turn. No new field, so
   * `packages/server/test/secret-inventory.ts` owes nothing.
   */
  | 'no-power'
  /**
   * G18 — *"Players will not receive any resources (active & passive) for doing so."*
   * BRAVE NEW WORLDS, REF 4.3.
   *
   * ## WHY THIS IS THE G18 CLAUSE THAT MOVES STATE, and why the rest is not
   *
   * BRAVE NEW WORLDS reads *"Every player answers an Ideology Card immediately, in
   * order of turn. Players will not receive any resources (active & passive) for
   * doing so."* The first sentence is the G18 MECHANIC — control over WHEN the draw
   * and answer phase runs — and it has no effect on any pool, mat or board. The
   * second is the only clause with a state consequence in it, and it is this kind.
   *
   * `ANSWER` consults it in exactly one place, where p13's "receive the answer's
   * resources" and p28's passive bonus are credited together, so **one edit covers
   * both halves of the printed "active & passive"** rather than two that could
   * drift. A power added later cannot bypass it: every resource credit in the engine
   * that is tied to answering goes through these two lines.
   *
   * ## IT SUPPRESSES, IT NEVER REFUSES
   *
   * `ANSWER` still succeeds and the card still joins `manifesto` / `manifestoCards`
   * and still joins the Ideology discard pile. A restriction that made the answer
   * *illegal* would be a table-stalling lock with no escape — the card cannot be
   * un-drawn — and this codebase has been bitten three times by a decision that
   * froze a player who could not satisfy it. Zero is the safe direction: the player
   * answers, the card recycles, the deck keeps falling by one per turn.
   *
   * **Visibility: PUBLIC, for the same reason as its three siblings.** Every real
   * card imposing it announces it, and a player who has been told they earn nothing
   * for answering must be able to see that they have been told. No new field, so
   * `packages/server/test/secret-inventory.ts` owes nothing.
   */
  | 'no-income'
  /**
   * G14a — *"Select an opponent and use all their Level 3 Ideologue Powers this
   * turn."* DEEP THOUGHTS (REF 4.2.1); *"they can use each other's unlocked Level 3
   * Ideologue Powers in addition to their own in their next turns"* is POLO RETREAT.
   *
   * ## THE ONE KIND HERE THAT IS A GRANT AND NOT A PROHIBITION, and why it is here
   *
   * The four kinds above all say what a player may no longer *do*. This one says what
   * a player may *additionally* do, and it is on the same list deliberately rather
   * than in a new `PlayerState` field, for three reasons in order of weight:
   *
   *  1. **Visibility.** It is public, and for exactly the reason the other four are:
   *    the card imposing it is played face up and its whole content is public under
   *    FULL INFORMATION. A player who can borrow Land Grab tomorrow and cannot
   *    tomorrow+1 has to be able to plan against that, and so does everyone else at
   *    the table — it is a threat, and a hidden threat is a card that lies.
   *  2. **No `_` field, no server change.** `restrictions` is already on
   *    `packages/server/test/secret-inventory.ts` as a deliberate NON-SECRET and
   *    `packages/server/test/public-payload.test.ts` pins the public field set to
   *    exactly `{ liveEffects, restrictions }`. A new public field would have gone
   *    red in a package this one may not edit; a new KIND on a list that is already
   *    declared public does not.
   *  3. **It is not a counter.** `powerUses` is where *uses spent* live; a borrow is a
   *    permission and has no counter of its own, so it is not that list's business
   *    either.
   *
   * ## `sourcePlayer` IS THE DONOR, which is the one inverting field on this list
   *
   * On the other four kinds `sourcePlayer` is "who imposed this", which is the caster.
   * Here the entry is written on the **caster** and `sourcePlayer` is the player they
   * are borrowing FROM, because `usesLeft` has to read somebody *else's* manifesto and
   * the only player id it is handed is the donor's. Getting this backwards would make
   * DEEP THOUGHTS let you use your own powers, which is a card that does nothing.
   *
   * ## WHY IT GRANTS LEVEL 3 AND ONLY LEVEL 3
   *
   * Both real cards say **Level 3**, and the restriction is total over Level 3 for a
   * reason that is mechanical rather than a convenience: **every Level 3 power is
   * consulted through `usesLeft` in `powers.ts`** — Prospecting, Donations, Going
   * Viral and Helping Hands, all four — and that is the single function this kind is
   * read in. The Level 5 powers are not all read there (Election Fever is passive and
   * is read by `gerrymanderAllowance` in `reduce.ts`), so a Level 5 borrow would be a
   * power that is sometimes available and sometimes not, decided by which function
   * happened to ask. Restricting the borrow to Level 3 makes the guarantee checkable
   * by one `describe.each` over `POWERS`, and it is not a narrowing of either card.
   *
   * ## EXPIRY, on the same clock as everything else
   *
   * `until` is the lifetime, read by the `borrow-power` case exactly as `restrict`
   * reads it, and `expiresTurn` is absolute so a replay from seed + action log
   * reproduces it without re-deriving anything. `expireRestrictions` in `advanceTurn`
   * removes it on the same clock that resets `powerUses`, and `usesLeft` deliberately
   * does NOT re-check it for the reason `no-power` documents: a second definition of
   * the same deadline is how a rule lives one turn too long in one place and not
   * another.
   */
  | 'borrowed-powers'
  /**
   * G14b — *"They will get 1 less voter on the next 2 Voter Cards that they influence."*
   * THE GRETA EFFECT (REF 4.2.1).
   *
   * ## IT IS A PAYOUT MODIFIER, and that is the whole reason it is not a `per`
   *
   * `per: { of: 'held-of-each-resource' }` multiplies a `gain`'s `res` by something read
   * out of the player's own state at resolution. A shortfall is the same arithmetic with
   * the sign reversed AND with a COUNTER — it applies to the next N purchases and not to
   * the rest of the game — and `powerUses.influenceVoters` is a count of influence
   * already spent, not a place to keep a debuff. So it is a rule, and `INFLUENCE` asks it.
   *
   * ## ONE CONSULT POINT, and it is the one the printed sentence is about
   *
   * `INFLUENCE` subtracts it from the voters the card yields, **after** Going Viral has
   * added its own. That ordering is the ruling: the printed clause is about what a Voter
   * Card yields, and both effects act on the card as it resolves, so the debuff sees the
   * card's final size. Subtracting first would let a Showstopper launder the debuff away
   * for free by pairing it with Going Viral.
   *
   * ## `remaining` MEANS "HOW MANY MORE VOTER CARDS", not "how much is still owed"
   *
   * This is the third distinct reading of one field across six kinds, and it is worth
   * naming because a reader who assumes KHAKI TERROR's meaning will compute the wrong
   * deadline. `no-purchases` decrements by what was actually donated; `voter-shortfall`
   * decrements by exactly one per Voter Card influenced, whether or not the card had any
   * voters to shorten, because the printed clause counts CARDS. An entry that reaches 0
   * is removed rather than left at zero, which is the same rule `creditDonation` follows
   * so that "is this rule in force" stays one predicate.
   *
   * ## IT SUPPRESSES, IT NEVER REFUSES
   *
   * A 1-Voter Card under a 2-voter shortfall yields **zero** voters. The purchase still
   * succeeds, the card is still paid for, the slot is still refilled and the log still
   * says what happened. A restriction that made the purchase *illegal* would be a
   * table-stalling lock: the card cannot be un-bought, and this codebase has been bitten
   * three times by a decision that froze a player who could not satisfy it. Zero is the
   * safe direction.
   *
   * ## Visibility: PUBLIC, on the same argument as its five siblings
   *
   * A player told they will get less out of the next two purchases has to be able to plan
   * around it, and so does everyone else at the table — it is a threat. No new field, so
   * `packages/server/test/secret-inventory.ts` owes nothing.
   */
  | 'voter-shortfall';

/**
 * ONE RESTRICTION. The two rulings this type forces are argued on the fields that
 * carry them, because both were left open in KNOWN-GAPS §4 and both are soft-locks
 * if decided carelessly.
 *
 * `remaining` is the first. The obvious implementation of KHAKI TERROR is a flag:
 * "this player may not purchase until they donate". The obvious implementation is a
 * **soft-lock**, and the real card's punchline is also its worst failure mode — the
 * only card in the corpus that can clear the lock is unplayable, so a player who
 * cannot satisfy it is stuck at the table for ever. It is avoidable, because the
 * engine's `lose` never takes more than the player holds: a player with 3 Funds and
 * no Media has still *donated*, just not 4 resources' worth. So `remaining` counts
 * down by **what was actually taken**, never by what the card asked for, and reaches
 * 0 exactly when the player has given everything of the types named. The safe
 * direction is deliberate: erring towards "still locked" lets a player donate again
 * and again, while erring towards "unlocked" would hand out a free purchase.
 *
 * `expiresTurn` is the second decision, and it is a departure from the
 * `'resolved' | 'this-turn' | 'next-turn' | 'round' | 'rest-of-game'` enum KNOWN-GAPS
 * §4 proposed. That enum mixes two different clocks — a *condition* and a *deadline*
 * — in one field, and every consumer then has to ask which one it is looking at. An
 * absolute turn number says exactly one thing, it reuses `ownerNextTurn` /
 * `roundEndTurn` so all four durations work with no special cases, and it inherits
 * `LiveEffect`'s reproducibility for free: the number is in the state that was
 * written down, so a replay reproduces it without re-deriving anything. A
 * `'no-purchases'` restriction additionally clears on the condition, which is what
 * `remaining` is for; a `'surcharge'` has no condition and expires only on its
 * deadline, which is PYTHONPOST's *"for the rest of the game"*.
 */
export type Restriction = {
  /** `R<n>` from `GameState._idSeq`. R2: no module-scope counter. */
  readonly id: string;
  readonly kind: RestrictionKind;
  /**
   * `'surcharge'`: extra resources per purchase. `'no-purchases'`: unused, 0.
   */
  readonly value: number;
  /**
   * `'no-purchases'` only: how much is still owed. Starts at the amount the card
   * named and is decremented by what was ACTUALLY donated — see the note above.
   */
  readonly remaining: number;
  /**
   * The absolute turn number this is removed at, or `null` for rest of game.
   *
   * A `'no-purchases'` restriction is ALSO removed the moment `remaining` reaches
   * zero, which is the condition being met rather than the clock running out.
   */
  readonly expiresTurn: number | null;
  /** The card that imposed it. Public for the same reason the restriction is. */
  readonly sourceCardId: CardID;
  /** The player who imposed it — the beneficiary of a KHAKI TERROR, the tax-payer's
   *  opponent for a surcharge. */
  readonly sourcePlayer: PlayerID;
};

/**
 * G13 — A CARD'S EFFECTS, HELD FOR ONE BEAT SO THAT A BLOCK OR A DEFLECT CAN LAND.
 *
 * This is the whole phase machine, and it is one nullable field rather than a
 * `Phase` variant, for a reason that is about OTHER PACKAGES rather than elegance:
 *
 *  - `packages/server/src/broadcast.ts` decides whether to show a player their
 *    Conspiracy hand by testing `state.phase === 'actions' || 'answer'`. A new
 *    `Phase` member would make the window a phase the server does not recognise, and
 *    every hand would go dark for exactly as long as the window is open — so the
 *    player who is supposed to be holding the BLOCK could not be shown it. Neither
 *    that file nor the client's `Phase` handling is this package's to change.
 *  - `phase` therefore keeps saying which phase of PLAY it is, and the window is a
 *    suspension inside one, which is what a BLOCK actually is: the game has not
 *    stopped, one card's resolution is being argued about.
 *
 * ## THE PROTOCOL, and why it cannot deadlock
 *
 * The window opens when a card with a non-empty effect list is played AND some
 * OTHER player holds a Conspiracy Card whose `interrupt.op` is `block` or `deflect`.
 * It closes on the first of two conditions:
 *
 *  1. somebody answered it (`RESPOND_INTERRUPT`) — one answer only, so a Block can
 *     never itself be blocked or deflected, which is the printed rule ("cannot be
 *     reversed or deflected") and also the termination argument;
 *  2. every player who is required to decline has declined (`PASS_INTERRUPT`).
 *
 * The required set is `turnOrder` minus the actor minus anybody with a pending
 * `Choice` — derived from the state, never stored as its own list, so a player
 * frozen by p12's cap discard is not required to decline (they cannot act at all)
 * and is not a hostage either. **Every player in the required set always has
 * `PASS_INTERRUPT` available**, so the window is always closable, and condition 2
 * is reached in at most `n - 1` passes. `RESOLVE_CHOICE` stays legal throughout, so
 * a frozen player can always thaw. There is no counter to overflow, no clock, and
 * no way for one response to raise another window: the window is a single linear
 * protocol and both closing conditions are monotone. `interrupts.test.ts` asserts
 * that rather than trusting it.
 *
 * ## VISIBILITY: PUBLIC, and every field in it argued, because one of them is
 * exactly the kind of thing that ends the game if it leaks
 *
 * A Conspiracy Card hand is a hidden hand (`PRIVATE_PLAYER_KEYS`), so the obvious
 * worry is that this window says WHO is holding a BLOCK. **It does not, and the
 * design is arranged so it cannot:**
 *
 *  - there is NO list of who may respond, and no list of who holds a reactive card.
 *    `reduce()` computes eligibility from the hidden hands at the moment a card is
 *    played and the only thing that reaches the state is the window itself. Adding a
 *    `responders: PlayerID[]` would hand every client the answer to "who is holding
 *    a Block", and it is the one field that must never be added.
 *  - `actor`, `cardId` and `effects` name a card that has ALREADY been played. The
 *    play is logged and the card is on the discard pile in the same action, so a
 *    client reading this has learned nothing the log did not already say. It cannot
 *    name a card in a hidden hand, for the same reason `LiveEffect.sourceCardId`
 *    cannot (see the note on that type).
 *  - `responder` and `deflectedTo` are null while the window is open, and by the
 *    time they are set the responder has already played a card face up, so their
 *    identity and their target are both on the public record.
 *  - `passed` says a player DECLINED. A player who declines has revealed nothing
 *    about their hand: they may hold a Block and choose not to play it, which is
 *    the ordinary case.
 *  - **The one residual, stated rather than hidden: the mere existence of an open
 *    window tells every client that *somebody* holds a reactive card.** It names no
 *    player and says nothing about which one. The alternative — a window that opens
 *    silently — leaves a real client with no way to know it is anybody's turn to
 *    act, which is a product deadlock traded for an information leak of one bit about
 *    one unknown player. The engine takes the one bit, and it is the same class of
 *    disclosure as `ClientState.awaitingAnswer`, which already tells every client
 *    that a card is in flight without saying which.
 *
 * This is the same reasoning that made `liveEffects` and `restrictions` public, and
 * the same constraint: no `_`-prefixed field is added, so
 * `packages/server/test/secret-inventory.ts` owes nothing. It also could not owe
 * anything — that file pins the `_` set to exactly eleven and this package may not
 * edit it, which is a second, independent reason the field is unprefixed.
 */
export type InterruptWindow = {
  /** `I<n>` from `GameState._idSeq`. R2: no module-scope counter. */
  readonly id: string;
  /** Who played the card under response. They may not answer it themselves. */
  readonly actor: PlayerID;
  /** The card being answered. Already face up: played, logged and discarded. */
  readonly cardId: CardID;
  readonly kind: 'conspiracy' | 'headline';
  /** The staged effects. Held, NOT applied, for exactly as long as the window is open. */
  readonly effects: readonly Effect[];
  readonly duration: EffectDuration;
  readonly timing: EffectTiming;
  /** A BLOCK landed, so the resolution is cancelled outright. */
  readonly blocked: boolean;
  /** A DEFLECT landed. The resolution resolves FOR this player instead of the actor. */
  readonly deflectedTo: PlayerID | null;
  /** The player who answered the window, or null. At most one, by the printed rule. */
  readonly responder: PlayerID | null;
  /** Everybody who has declined. See the protocol note for who is required to. */
  readonly passed: readonly PlayerID[];
};

export type GameState = {
  readonly zones: readonly Zone[];
  readonly players: Readonly<Record<PlayerID, PlayerState>>;
  readonly turnOrder: readonly PlayerID[];
  readonly activePlayer: PlayerID;
  readonly phase: Phase;
  readonly turn: number;
  readonly round: number;
  readonly finished: boolean;

  /** Three face-up Voter Cards. p10: three must always be available. */
  readonly market: readonly MarketSlot[];
  /** Cost of the top Conspiracy Card. The cost is printed on the back, so it is public. */
  readonly conspiracyTopCost: number | null;
  readonly conspiracyRemaining: number;

  /** Volatile-Area placements made this turn, in order. Each resolves one Headline. p18. */
  readonly headlineQueue: readonly { readonly areaId: AreaID; readonly by: PlayerID }[];
  /** The Headline currently face up and being resolved, if any. */
  readonly activeHeadline: CardID | null;

  readonly choices: readonly PendingChoice[];

  /**
   * G9 / G22 — effects still in force. See `LiveEffect` for the full visibility
   * argument; the short form is that a live effect is always a PUBLIC condition
   * installed by a card that is already face up, so it is unprefixed and reaches
   * every client deliberately.
   */
  readonly liveEffects: readonly LiveEffect[];

  /**
   * G13 — a played card whose effects are being held for a BLOCK or a DEFLECT, or
   * `null` when no card is in that state. See `InterruptWindow` for the protocol,
   * the deadlock argument and the per-field visibility ruling. Unprefixed and
   * public on purpose; there is deliberately no `responders` list on it.
   */
  readonly interrupt: InterruptWindow | null;

  /**
   * Set when the board fills before every majority forms (p20). Everyone gets one
   * more turn, starting with whoever filled the last area.
   */
  readonly finalRoundFrom: PlayerID | null;

  readonly log: readonly LogEntry[];

  // ─────────── SERVER ONLY — stripped by playerView ───────────
  /**
   * The card put to the active player. SERVER ONLY, and it stays that way after full
   * information.
   *
   * The card's CONTENT — question, both answers, both Ideologues, both payouts — is
   * published to every seat by the server's `PublicQuestion`. This field, the id, is
   * not, and the two rulings are different on purpose:
   *
   *  - The content was always reachable. The Ideology corpus is public JSON; a card's
   *    payout is one lookup away whatever this field says. What the old withholding
   *    protected was *which* card was on the table, and under full information the card
   *    is read aloud at a physical table anyway (`AUTHENTIC-SHASN-REFERENCE` §7.2 step 1).
   *  - The id is what `packages/server/scripts/check-secrets.mjs` watches. That name-based
   *    grep is the only mechanism in the repository keeping a server-only field off the
   *    wire, and it works by this field being `_`-prefixed. Moving the value onto an
   *    unprefixed field would remove its coverage of the one value a future change might
   *    most want to re-hide.
   *
   * The full argument, and the measurements behind it, are in
   * `packages/server/src/FULL-INFORMATION.md` §2. The engine itself is unchanged by full
   * information: it has no projection of its own beyond `playerView`, and it does not know
   * what the server chooses to publish.
   */
  readonly _pendingCard: CardID | null;
  readonly _ideologyDraw: readonly CardID[];
  readonly _ideologyDiscard: readonly CardID[];
  readonly _voterDraw: readonly CardID[];
  readonly _voterDiscard: readonly CardID[];
  readonly _conspiracyDraw: readonly CardID[];
  readonly _conspiracyDiscard: readonly CardID[];
  readonly _headlineDraw: readonly CardID[];
  readonly _headlineDiscard: readonly CardID[];
  /** Deterministic PRNG cursor. The engine never calls Math.random. */
  readonly _seed: number;

  /**
   * Monotonic counter for generated ids (choices, voter groups).
   *
   * It lives in state, not at module scope, because `reduce` must be pure: the
   * same state plus the same action must always produce the same ids, or a
   * replay from seed + action log is worthless and a client holding a `choiceId`
   * across a server restart is holding a dead reference. R2.
   */
  readonly _idSeq: number;
};

// ─────────────────────────── derived helpers ───────────────────────────

export const EMPTY_POOL: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

/**
 * The Ideology Cards a player is HOLDING, face down. Empty when the field is absent.
 *
 * One accessor rather than `?? []` at every call site, for the same reason
 * `restrictions` has one: the field is OPTIONAL (see `PlayerState.ideologyCards` for
 * why, and for the note it owes `packages/server/test/secret-inventory.ts`), and a
 * private hand must never be read as `undefined` by accident. An empty hand and an
 * un-updated fixture are the same thing to the reducer, and that is the only
 * coincidence this design allows.
 */
export function ideologyHandOf(player: PlayerState | undefined): readonly CardID[] {
  return player?.ideologyCards ?? [];
}

export function poolTotal(p: Pool): number {
  return p.funds + p.clout + p.media + p.trust;
}

export function deltaTotal(d: Delta): number {
  return (d.funds ?? 0) + (d.clout ?? 0) + (d.media ?? 0) + (d.trust ?? 0);
}

export function findZone(state: GameState, id: ZoneID): Zone | undefined {
  return state.zones.find((z) => z.id === id);
}

export function findArea(state: GameState, id: AreaID): Area | undefined {
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === id);
    if (a) return a;
  }
  return undefined;
}

/** Pegs a player holds in a zone, majority or not. */
export function pegsOf(zone: Zone, player: PlayerID): number {
  return zone.areas.reduce((n, a) => n + (a.peg?.owner === player ? 1 : 0), 0);
}

export function pegsFilled(zone: Zone): number {
  return zone.areas.reduce((n, a) => n + (a.peg ? 1 : 0), 0);
}

export function slotsFree(zone: Zone): number {
  return zone.capacity - pegsFilled(zone);
}

export function emptyAreas(zone: Zone): readonly Area[] {
  return zone.areas.filter((a) => a.peg === null);
}

/**
 * p16 / p34. Gerrymandering Rights belong to whoever has strictly more voters in a
 * zone than any other player. A tie gives nobody rights.
 */
export function gerrymanderRights(zone: Zone): PlayerID | null {
  const counts = new Map<PlayerID, number>();
  for (const a of zone.areas) {
    if (!a.peg) continue;
    counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
  }
  let best: PlayerID | null = null;
  let bestN = 0;
  let tied = false;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied || bestN === 0 ? null : best;
}

/** How many cards of each Ideologue sit in a player's manifesto. p15. */
export function tally(manifesto: readonly Ideologue[]): Record<Ideologue, number> {
  const out: Record<Ideologue, number> = {
    capitalist: 0,
    supremo: 0,
    showstopper: 0,
    idealist: 0,
  };
  for (const i of manifesto) out[i] += 1;
  return out;
}
