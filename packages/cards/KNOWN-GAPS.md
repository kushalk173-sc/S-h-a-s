# KNOWN GAPS — what the card schema still cannot do, and what the engine owes it

**Two revisions in one file.** Everything above §3 is the *state after this
iteration*: each gap says which of the three states it landed in, what changed, and
what `reduce()` / `state.ts` would have to do to move it. §5 and §6 are older notes,
kept because they are still true. §3 is the handoff.

`REF n` = `docs/AUTHENTIC-SHASN-REFERENCE.md` section n. `RULES pn` =
`docs/rules-reference.md`, Collectors Edition rulebook page n.

---

## 0bis. What the effect-execution substrate iteration landed

Two engine changes, in this order, each a green commit. `npm run playable` — which
**plays** each reduction through the real reducer rather than asking whether the
schema accepts it — went from **14 of 54** to **18 of 54**, and then from **21 of 54**
to **23 of 54** in the phase-machine iteration recorded in 2 G13. Shipping BLOCK and DEFLECT did not
move that number - the probe writes its own reduction rather than reading the deck - but it turned
**23 into a shipped fact**; the count is **25 of 54** today, and `packages/server/test/
interrupt-window.test.ts` is what proves the window itself is safe to ship.

| gap | what landed | cards moved |
|---|---|---|
| **G9 + G22** | `GameState.liveEffects`, expired in `advanceTurn` | GROWING DISSENT (with G14); ERADICATING GERMS from a one-shot to its real recurring obligation |
| **G14** | `fireTriggers`, consulted at five places, bounded cascade | POWER TRIP; LAB-GROWN EARWORM (with a caveat, below) |
| **G15 + G4** | `n: number \| ComputedCount` and `per` on `gain`/`lose` | IF YOU LIKE PIÑA COLADA |
| G8 | `target` on `gerrymander` (previous iteration) | — (already closed) |

**The visibility decision, which is the one to check first in review.**
`GameState.liveEffects` is **public and unprefixed**, so
`packages/server/test/secret-inventory.ts` owes nothing and no client change is
needed. The argument, in full, is in `state.ts` on `LiveEffect`: a live effect can
only be created by a card being *resolved*, and both `PLAY_CONSPIRACY` and
`ACK_HEADLINE` put that card face up on the discard pile in the same breath, so
`sourceCardId` can never name a card in a hidden hand; and every real card that
creates one announces it (KHAKI TERROR's whole point is that everyone can see you
cannot buy). **No `_`-prefixed field was added.** `live-effects.test.ts` asserts the
property rather than trusting the argument — including that a live effect never
names a Conspiracy Card a player is still holding.

**The honesty gate grew a THIRD seam.** `applyEffect` decides what ONE resolution
does; `installLiveEffects` decides what LINGERS, one function above it; and
`RESPOND_INTERRUPT` decides what happens when a card's resolution is INTERRUPTED,
hundreds of lines away in a `case` of `reduce` itself. Slicing `applyEffect` cannot
see the third one at all, so declaring `interrupt` in `EXECUTED_OPS` would have made
the re-derivation a lie and forced the test to be weakened to fit the registry.
`reducer-parity.test.ts` now re-derives `SCOPE_FIELDS_READ_BY_INSTALL` from
`installLiveEffects`'s own source text, `EXECUTABLE_TRIGGERS` from every
`trigger: '…'` raise site in `reduce.ts`, and `EXECUTED_INTERRUPT_OPS` /
`_WINDOWS` / `_TARGETS` from `REACTIVE_INTERRUPTS` and `mayRespond`. A `when` naming
an event the reducer never raises installs a hook that never wakes — a card that
reads as though something happens on every purchase, and nothing ever happens — so
the registry is checked against the reducer in both directions, and against the JSON
Schema's enum.

### 0b.1 The rulings this iteration made, so the next person does not re-derive them

1. **An effect carrying `when` / `until` / `condition` is INSTALLED, not applied.**
   It does not fire once at play time and then linger. Otherwise POWER TRIP hands out
   a free discard on the turn you played it and keeps the hook for the rest of the
   game.
2. **Expiry runs BEFORE re-application** at a turn boundary. Reversed, a
   `'this-turn'` effect is re-applied at the very boundary meant to remove it and
   lives for ever.
3. **A lasting `duration` with no per-effect `when` installs ONE standing effect**
   holding the whole list, re-applied at the top of every one of the owner's turns.
   One entry rather than one per effect, so a two-effect list does not become two
   auras that can drift apart.
4. **`'round'` is read as the end of the current round**, and `'next-turn'` as "live
   through the owner's next turn". In a three-player game a `'round'` effect
   installed on turn 1 expires on turn 4, which IS the owner's next turn, so it never
   acts — which is the correct reading of GROWING DISSENT's "for 1 round" and is
   pinned by a test.
5. **`on-turn-start` means the OWNER's turn.** A hook firing at the top of every
   seat's turn is the difference between one payout a turn and one per player per
   turn.
6. **A computed value reads the state of the player the effect resolves FOR**, and
   `ideologue-level` counts Ideology **Cards** answered, not resources paid. See §6
   for why that is the opposite of the balance checker's proxy and therefore the
   right way round.
7. **The balance checker now reports a computed-value card as NOT MEASURED** rather
   than scoring it zero. `xCardMagnitude` runs on one card in isolation with no
   player state, so a computed value has no value yet; scoring it 0 would have made
   the check pass for a reason that has nothing to do with the card.

### 0b.2 The card the substrate did NOT make honest

**LAB-GROWN EARWORM's reduction is strictly STRONGER than the printed card** and is
flagged as such in `scripts/playable.ts`. The real card binds one chosen opponent —
which is G1, `'chosen-player'`, a decision over players that needs a new `Choice`
kind and therefore a client wire-format change. The reduction fires on ANY influence
including your own, and the thief picks the victim. It proves the mechanism
(`steal-any` is the one op that reads `FireContext.actor`) and it is **not** a
candidate for shipping without a ruling.

---

## 0. The three states, and the number that matters

A card can be **expressible** without being **playable**, and those are not the same
thing. A schema that parses a card the reducer cannot execute is worse than no
schema: the game accepts the card, the player reads the text, and the effect never
happens. Every capability in this schema is therefore in exactly one of three states,
and the state is enforced, not asserted:

| state | meaning | who enforces it |
|---|---|---|
| **(a)** | expressible AND executed by `reduce()` | `src/executable.ts` + `test/reducer-parity.test.ts` |
| **(b)** | expressible and validated, but NOT executed — **the card is refused** | `src/validate.ts`, codes `EFFECT_NOT_EXECUTED` / `EFFECT_FIELD_NOT_EXECUTED` |
| **(c)** | not expressible at all | nothing; it is not in the schema |

**No card ships in state (b).** `src/executable.ts` states what `applyEffect` really
does — which ops have a `case`, and which fields each case reads — and
`validate.ts` rejects any card that strays, naming the reducer line to change.
`test/reducer-parity.test.ts` re-derives that registry from `reduce.ts`'s own source
text and re-asserts it over every shipped card, so the promise cannot drift.

### 0.1 The counts

| | before | after |
|---|---:|---:|
| Recovered X-cards with complete official rules text (REF §4) | 50 | 50 |
| …shipped, with the dropped clause named in `source` (`adapted`) | **7** | **11** |
| …**not shipped at all** | **43** | **39** |
| Shipped as `inferred` | 45 | 45 |
| Total cards shipped | 60 | 64 |

### 0.2 The finding, and what changed about it

**The first pass at expressiveness produced no new playable card, and that was not a
failure of the schema work — it was the shape of the problem.**

Everything landed in that iteration was state (b): `target` on `gerrymander` (G8),
`duration` / `timing` (G9 / G22), `interrupt` (G13), `when` / `until` (G14) and a
computed `n` (G15) are all now writable in the schema and all refused by the
validator, because `reduce()` performed none of them. A card that used any of them
would have been a card that lies.

The four real cards that *did* become playable then were unlocked by something else
entirely: by re-reading `applyEffect` closely enough to see which recovered cards
were already expressible in the shipped op vocabulary, and accepting a smaller card
rather than a bigger lie. Their dropped clauses are named in their `source` fields
and counted per gap in §2.

**The lesson, and the reason the next iteration looked different: the schema was
never the binding constraint.** So the next iteration went into the reducer — items
2, 3 and 4 of §3 — and produced **+4 playable cards measured by playing them**,
because the shapes it needed were already declared and inert. The remaining 36 are
not expressible because of what `reduce()` still cannot *do*, and each one now says
which mechanism it waits on rather than "the engine does not do this".

The honest reading of the old "86% cannot be expressed" figure is therefore still
**not an 86% schema problem**. For the 36 cards still unreducible, the binding
constraint is `reduce()` and `state.ts`: a cost modifier (G5), a phase machine
(G13), a decision over players (G1, and a client wire-format change), a price field
(G15), zone scoping (G16), or card movement (G20). Each is specified, quarantined,
and names the engine change it waits on.


### 0.3 What the previous revision got wrong, in the corpus itself

Three shipped cards said *"Discard 2 of your own voters"* over `discard-voter`.
`reduce.ts` `resolveChoice` rejects any area the chooser owns, and `targetableCount`
does not count them either, so the op reaches **opponents'** voters only. Three
cards were telling the player one thing and doing another — state (b), shipped.
Their `text` now states what the engine does (`hl-et2040-002`, `hl-et2040-003`,
`hl-in2020-003`), and the fix is named in their `source`: one condition in
`resolveChoice`, plus a `target` on the op.

`ct-et2040-002` was worse: ERADICATING GERMS read *"Gain 1 resource, discard 1
resource"*, which is not that card at all. It is now the market refresh plus the
resource, which is the real card's single resolution.

---

## 1. What landed, and how it is kept honest

**`packages/engine/src/cards.ts`** — one new capability, plus a fenced block of
shapes that are declared and inert:

- `gerrymander` gains `target?: EffectTarget` (G8). It was the only resource-shaped
  op without one, which is why *"every player can Gerrymander 1"* could not be
  written at all. `reduce()` credits the bonus to `source` only, so any value other
  than `'you'` is refused by the validator. **G8 is (b).**
- `EffectDuration`, `EffectTiming`, `EffectTrigger`, `Interrupt`, `EffectScope`,
  `XCardScope` — declared so the engine owner can see the work, and marked RESERVED
  in the file itself. **G9 / G13 / G14 / G22 are (b).**

**`packages/cards/schema/card.schema.json`** — `duration`, `timing`, `interrupt`,
`when`, `until` and a computed `n` are **schema-valid**. That is deliberate: an
author who reaches for one gets *"reduce() does not do this, here is the change it
needs"* instead of `unknown property` reported once per card branch. The validator
is what refuses the card.

**`packages/cards/src/executable.ts`** — the registry. Per op, the fields the `case`
reads: `target` is read in five cases and ignored in eight, which is invisible from
the type and is exactly how a card ends up reading as though it hit every player
while hitting one.

**`packages/cards/src/balance.ts`** — `X_EFFECT_MAGNITUDE`. Every dominance rule
here is about two sides of an Ideology Card; a Conspiracy or Headline Card has one
effect and had no check at all, so a card worth a dozen resources passed against a
cap of 12. A voter is priced at what the voter deck actually charges (derived from
the corpus, not assumed) and a drawn Conspiracy Card at its printed minimum.

---

## 2. Every gap, with its state

### G0 — the provenance envelope has no home in the engine types

**State: (c).** Not done, and it is the one gap on this list that is purely a
`PlayerState`-free type change — `source` / `provenance` are stripped by
`toEngine*Card()` before the engine sees a card, so a runtime bug report cannot say
whether the card in front of a player was recovered or authored. One `CardMeta` the
four types extend would close it. Left alone because it touches every consumer of
the card types, including the server and client another agent owns.

### G1 — no DONATE-to-a-named-player, and no conditional

**State: (c).** Cards: AIN'T NO CURE FOR LOVE, MARRIED WITH BITS, ON THE "HIGH" SEAS.
`EffectTarget` has no *"a chosen player"* and no seat-relative neighbour, and there
is no `if` over a whole effect.

**What this iteration bought:** MARRIED WITH BITS (`hl-et2040-010`) now ships, with
*"to 2 opponents"* dropped for `each-opponent` and the opt-out dropped entirely. The
opt-out is the part that matters — a granted voter is a pending group the opponent
places, and there is no way to decline it. **+1 real card, adapted.**

**Reducer/state ask:** `EffectTarget` gains `'chosen-player'` (resolve through the
existing `Choice` machinery with `from: null`, which `steal-any` already does) and
`'left-of-me'` (one index into `turnOrder`).

### G2 — no iteration per opponent, and no conditional-on-payment

**State: (c).** Card: A GRAVE INHERITANCE, already shipped reduced to one chosen
opponent. `steal-any` has no `target`, so it can never mean "every opponent", and
the eviction is conditional on each opponent's failure to pay.

**Reducer ask:** give `steal-any` a `target`, and add an
`on: 'success' | 'failure'` gate — which needs a per-opponent outcome record, not
just a state.

### G3 — no recurring obligation on a named player

**State: (c).** Cards: ERADICATING GERMS (shipped, single resolution only), THE BIG
FREEZE, THE PSYCHOHISTORIAN. A duty that re-arms every turn, forever, on a player.

**What this iteration bought:** ERADICATING GERMS' single resolution is now the real
one — the market refresh (which *is* discarding open Voter Cards) plus the resource.
Previously the card said something that was not it.

**State ask:** `PlayerState.obligations: readonly Obligation[]`, and a check in the
turn state machine.

### G4 — no per-unit scaling (`forEach`)

**State: (a) for a count read at resolution time, still (c) for a count read off an
EVENT.** `n` may be `{ of: 'volatile-voters' }` and `gain` / `lose` may carry `per`,
so *"as many as there are"* is expressible against a player's own board.

**Card gained: IF YOU LIKE PIÑA COLADA** (with G15). ERADICATING GERMS is a standing
obligation rather than a per-card read.

**Still (c), and the reason is a missing FIELD rather than a missing computation.**
RED BLOODED's *"any 2 resources for EACH of their discarded voters"* and THOUGHTS AND
PRAYERS' *"any 2 resources for each of THEIR voters inside a Volatile Area"* both need
**the read aimed at one player and the payout at another** — and the real card also
wants 2 per unit, where `n` is a count and `per` is a multiplier on a `res`. There is
no field that separates "whose state do I read" from "who does this land on"; adding
one is the ask. JUST BREATHE computes its *zone* from the board, which is G16.


### G5 — no player RESTRICTION

**State: (c), and it is a `state.ts` change, not a card change.** Full specification
in §4. Cards: KHAKI TERROR, THE FOUR HORSEMEN, THE BIG FREEZE, GENDER TROUBLE, DON'T
KISS THE BABIES, NEW FACE WHO DIS.

**What this iteration bought:** the *other* clause of two of these cards now ships —
KHAKI TERROR's donation of one resource of each type (`hl-in2020-007`, **+1 real
card, adapted**) and THE FOUR HORSEMEN's choice of denomination, which is exactly one
`lose-any` of 2 because any two of a kind and one of each are both in the real card's
set (`hl-et2040-009`, **+1 real card, adapted**). In both cases the lock clause is
dropped, so what ships is a plain tax rather than a soft-lock. That is stated in each
`source`.

### G6 — no set collection

**State: (c).** Card: SINGULARITY, shipped on its first branch (*get 2 voters*),
which is faithful. The 3-of-4 collection, the permanent Level 5 unlock and the
self-deleting set are not expressible.

**State ask:** `PlayerState.trophies`, a `permanents` list, and a card kind that is
not discarded on play.

### G7 / G19 — no hidden, unrevealed combo detection, and no secret card

**State: (c).** Card: THE PSYCHOHISTORIAN, shipped on its first branch (*1 voter and
any 2 resources*), which is faithful. The three-action-in-one-turn detector, and
existing on the table unrevealed to the UI, are not expressible.

**Ask:** `{ op: 'watch'; for: 'your-turn'; pattern; reward }` plus `secret?: boolean`
and a `_`-prefixed hand, using the convention `playerView.ts` already documents.

### G8 — `gerrymander` is the one op with no `target`

**State: (b). CLOSED ON THE TYPE, NOT ON THE REDUCER — the cheapest win, taken.**

`target?: EffectTarget` is now on the op, in `cards.ts` and in the schema. A card may
therefore *say* *"every player can Gerrymander 1"* (NEW FACE WHO DIS / SUBMERGED).
`applyEffect` credits the bonus to `source` alone, so the validator refuses any target
but `'you'`, with the one-line fix in the message:

> `applyEffect` case `"gerrymander"` credits the bonus to `source` only. It needs
> `for (const p of resolveTargets(s, source, target))` in place of the single
> `s.players[source]` write (KNOWN-GAPS G8) — `target` is already computed above the
> switch.

**Cards gained: 0.** The existing `hl-et2040-001` already shipped the `you` reading;
this gap was never a card-count gap, it was a schema gap, and it is now closed on the
type and specified on the reducer. `NEW FACE WHO DIS` additionally needs G5 for its
Volatile-Area prohibition.

### G9 — no `duration`

**State: (a). CLOSED.** `GameState.liveEffects` carries each effect's owner, its
trigger, its condition, its effect list, and its lifetime as two ABSOLUTE turn
numbers computed at install. `advanceTurn` drops what has run out and then re-applies
what is still in force. See §0bis for the rulings and for the visibility decision.

**Cards gained: GROWING DISSENT** (with G14). ERADICATING GERMS moves from a one-shot
to its real recurring obligation, *"discard an open Voter Card every turn
(mandatory)"*.

**Still (b), and the reason is now G5 rather than G9:** PYTHONPOST and
SNOOP B-O-DOUBLE-T are *surcharges* — *"you have to pay an extra resource for every
Conspiracy Card that you buy"* — and a cost modifier is **not an effect**. A lasting
effect can now carry a clause, but a clause that changes what a purchase *costs* is a
different mechanism, and putting it in `Effect[]` would make `applyEffect` a
cost-modifier resolver. That is G5's `Restriction`, not this gap.


### G10 — no tokens-on-a-card counter

**State: (c).** Cards: KHAKI TERROR, THE FOUR HORSEMEN, HIGGS MORON. The card is a
physical token holder, and the pile has to outlive its resolution.

**Ask:** `GameState.counters` keyed by `cardId:ownerId`, an `add-tokens` op, and a
`when: 'tokens-reach'` trigger (G14). Same persistence plumbing as G9.

### G11 — no `hostage`

**State: (c).** Card: ON THE "HIGH" SEAS. A board-resident object that holds pegs and
is ransomable repeatedly. `PendingVoters` is the wrong container: it is discarded at
the end of that player's turn.

**Ask:** a `Hostage` type on `GameState` with a place/ransom op pair.

### G12 — no `timed-pass`

**State: (c).** Cards: HIGGS MORON, CARD GAMES, A COWARD OR A JOURNALIST?, BLESSINGS
OF PARENTS PAST. The card has a holder, a position in the turn order and a
turn-boundary deadline. The turn loop goes player → phase → player; there is no
concept of an object moving between players mid-round.

**Ask:** an owner on the card, a `GameState` queue of in-flight cards, and a
"does this player have a card to pass?" gate in the turn state machine.

### G13 — five PHASE-CHANGING ops — **THE MACHINE LANDED, AND TWO OF THE FIVE WITH IT**

**State: (a) for `block` and `deflect`. Still (c) for `auction`, `vote` and
`pass-card`, ruled out below with a cost.**

The design call made earlier still stands and was not re-litigated: these five are a
**sibling card field**, `Interrupt`, deliberately outside `Effect[]` — REF §5.4 is
emphatic that they change *which phase of play is running*, not how many resources
anyone holds.

**What landed is one nullable `GameState.interrupt`, not a new `Phase`.** The
reason is another package: `packages/server/src/broadcast.ts` decides whether to
show a player their Conspiracy hand by testing `phase === 'actions' || 'answer'`, so
a new `Phase` member would black out every hand for exactly as long as the window is
open — including the hand of the player holding the BLOCK. That file is not this
project's to change, so `phase` keeps saying which phase of *play* it is and the
window is a suspension inside one. A card with a non-empty effect list that somebody
could answer is **staged**; `RESPOND_INTERRUPT` plays a held BLOCK or DEFLECT into the
window, and `PASS_INTERRUPT` declines it. The window closes on the first answer, or
when every player it is waiting on has declined.

**Cards gained: 2, and they are the two the product replays most.**
`npm run playable`, measured by playing each reduction through the real reducer, went
**from 21 of 54 to 23 of 54**. BLOCK and DEFLECT both report PLAYED. Two named
deviations, both on the type and both in the probe's `note`: DEFLECT redirects the
**whole** resolution rather than "only that partial effect" on the defender
(`applyEffect` computes one `target` for an effect list, so per-effect granularity is
G20), and it ships `target: 'any-card'` rather than `card-affecting-you`, because "a
card that affects **you**" needs a decision over players and that is G1.

**The visibility decision, and the field that must never be added.**
`GameState.interrupt` is **public and unprefixed**, so `secret-inventory.ts` owes
nothing. The full argument is on `InterruptWindow` in `state.ts`; the load-bearing
part is that **there is no `responders` list and no list of who holds a reactive
card.** A Conspiracy Card hand is a hidden hand, and such an array would tell every
client who is holding a BLOCK. Eligibility is computed from the hidden hands at the
moment a card is played and only the window reaches the state. `actor` / `cardId` /
`effects` name a card the same action already logged by name and discarded, so the
payload says nothing the log did not; `responder` and `deflectedTo` are null while
the window is open; `passed` records people who **declined**, which reveals nothing
about a hand. **The one residual, stated rather than hidden:** an open window tells
every client that *somebody* holds a reactive card. It names no player. The
alternative is a window that opens silently, which leaves a real client no way to
know it is anybody's turn to act — a product deadlock traded for one bit about one
unknown player. The engine takes the bit, and it is the same class of disclosure as
`ClientState.awaitingAnswer`. **No `_` field was added.** It could not be: that file
pins the `_` set to exactly eleven and this package may not edit it, which is a
second and independent reason the field is unprefixed.

**The termination argument is bounded three ways, all tested.** One answer per
window, because BLOCK "cannot be reversed or deflected" — four reactive cards across
two opponents still close the window on the first one played. Every player the window
waits on always has `PASS_INTERRUPT`, so it is always closable in at most `n - 1`
declines, asserted at 2, 3, 4 and 5 seats. And `RESOLVE_CHOICE` stays legal
throughout, so a player frozen by p12's cap discard is neither required to decline
nor a hostage. There is no counter and no clock, and the two closing conditions are
monotone, so no cascade is reachable. The hostile cases have their own tests: a
BLOCK on the player about to answer, and a BLOCK on the conspiracy whose own player
is mid-window.

**`window` and `target` were NARROWED from three values each to two**, and that was
the price of the honesty gate. `Interrupt.window` lost `'out-of-turn'` because
`RESPOND_INTERRUPT` already refuses the actor of a card, which was the whole of its
meaning; `Interrupt.target` lost `'any-player'` because it is indistinguishable from
`'any-card'` in every position the window can be in. A value the reducer cannot act
on is a declaration it ignores, which is the exact failure `src/executable.ts` exists
to prevent.

### G13b — AUCTION: **RULED OUT OF SCOPE, with the cost written down**

**Ruling: not built now.** The reasoning is the same in all three cases, and it is not
"too big" — it is that **none of the three buys a card on its own**, so building one
means building two mechanisms to get zero.

**`auction` is a rules SYSTEM, not an op, and the audit that said so was right.**
`docs/rules-reference.md` §6 (p25) has a bidder commit **up to their resource cap
without holding the resources**, settle on an **IOU token** held by the seller, and
**cannot make any purchases until the bid is fully paid**. That needs, at minimum:

- `PlayerState.debts` — a field that **persists**, **expires**, appears in the client
  payload, and is consulted by `INFLUENCE` and `BUY_CONSPIRACY`. This is the same
  shape of problem as G5's `Restriction`, and G5's note says why it is not free.
- A **cap ruling**: p12 says "if at any time you cross your resource cap … you cannot
  take any other actions until you do so", checked *before any other action*. A
  bidder at their cap bidding resources they do not hold is in direct tension with
  that, and the answer is a rules decision, not an implementation.
- Debt is **negative resources**, and every pool read in the engine (`canAfford`,
  `enforceCap`, `poolTotal`) and in the balance checker currently assumes
  non-negative. Retrofitting that touches the resource layer, not the card layer.
- Four new actions (open, bid, pass-on-bid, settle) plus a second window protocol.

**And it buys nothing.** The two real auction cards are A CALL FROM KARACHI (also G17
deck search *and* G20 card moving) and QUANTUM WRISTBAND (also G14 deck-search
override *and* G20). **Cost: roughly a second iteration of this one**, for zero
playable cards at the end of it. That is the definition of half-building, and the
brief's instruction not to half-build it is the reason this is written down instead.

### G13c — VOTE and PASS-CARD: **RULED OUT, for the same reason and a cheaper one**

- **`vote`** (NEXT BILLION DATA POINTS) needs a ballot, a no-self-vote rule, and a
  **re-vote-on-tie loop that is a genuine termination hazard** — two opponents who
  always tie is a table that never finishes, which is precisely the class of failure
  §4 above refuses to accept. It also buys nothing: the payoff is *"the next
  Conspiracy Card in the draw pile … up for grabs"*, handed to a chosen player, which
  is **G20 card movement** and a G17 deal. The ballot without the payoff is half a
  system.
- **`pass-card`** has **no referent**. It needs something to pass the card *on to*:
  G12's in-flight `GameState` queue with an owner, a position in the turn order and a
  turn-boundary deadline, plus G20's `move-card` op and a `PlayerState.ideologyCards`
  list — and reassigning Ideology Cards breaks the blind-answer invariant
  `playerView.ts` tests for, which is a decision this package may not take unilaterally
  either. Its three real cards are blocked on those anyway: HIGGS MORON on G10's token
  counter as well, A COWARD OR A JOURNALIST? and CARD GAMES on the movement itself.

**What a card author gets instead of a silent gap:** each of the three has its own
refusal message naming the system it needs — `auction` names the IOU and the debt
field, `vote` names the ballot, `pass-card` names the fact that it has no referent —
rather than "add a case to `applyEffect`", which is not what any of them is short of.

### G13d — **CLOSED. WHAT IT COST, AND WHAT SHIPPED**

**Both blockers are gone and BLOCK and DEFLECT are in `decks/et2040/conspiracy.json` as
`ct-et2040-014` and `ct-et2040-015`.** Neither was engine work, which is what this gap said
they would not be, and both cost less than the gap predicted — but only because two other
pieces of work had already landed and were not visible from here.

**The two named blockers, and what actually had to be true.**

1. **`packages/client`** — landed before this iteration: `interrupt.ts` projects the window,
   `GameScreen.tsx` renders it with an `interrupt-decline` control and
   `responseWindow.test.tsx` pins that pressing it dispatches exactly one
   `PASS_INTERRUPT`. A player can decline from every seat's view.
2. **`packages/server/test/driver.ts`** — landed in this iteration, and it was bigger than
   "pick a legal action". `driverPly(state)` now answers *which seat acts next* as well as
   what, in the same order `playInProcess` already used: an open decision for whoever owns
   it, then an open window for the one seat the table is waiting on, then the active
   player's own move with the endgame squeeze considered first. The last two socket
   drivers (`e2e.test.ts`, `winnable.test.ts`) drove `state.activePlayer` unconditionally
   and had no squeeze at all, and shipping measured what that cost:
   - **4 of 120 runs** (60 seeds × 2 and 3 seats) opened a window the driver could not act
     in, and a seat reaches a reactive card **without buying** — `draw-conspiracy` puts
     Server Space's draw straight into a hand — so this is roughly 3% of games, not a
     corner case. A socket run mints a random seed, so the suite would have been failing
     at random.
   - **6 of 120 runs** ground to the action budget at 8 of 9 majorities with every seat on
     `{funds 0, clout 0, media 12, trust 0}`. That one **predates this work** — the same
     sweep on the deck *without* the two cards stalls 6 times in the same shape — and it
     is the squeeze arm of `driverPly` closing it. Applied carelessly, the squeeze stalls
     35 of 120 runs on `'resolve "Resource cap" first'`, because a seat that owes a
     decision or a decline cannot buy; hence it is the TURN arm only.
   - Measured after: **0 stalls over 150 seeds × 4 seat counts = 600 games.**

**What shipped, and what it cost the cards.** Both are `adapted`, not `verbatim`, and
`decks/SOURCES.md` §1 tabulates every recovered clause against what `reduce()` performs.
The short form: the phase machine was never the blocker for the verbatim tag. BLOCK still
cannot discard an open card, block a card that steals itself, or cleanse an
already-active card; DEFLECT still redirects a whole effect list rather than one partial
effect, and ships `target: 'any-card'` rather than `card-affecting-you`. **3 clauses and 2
clauses**, each named on the card and each a named mechanism rather than missing wording.
So the corpus count is unchanged at **0 verbatim**, and the two cards that were the
obvious counter-example to that rule are the proof that the rule is about mechanisms.

**The three things that had to be true about the corpus, and were not.**

- `toEngineConspiracyCard` builds the engine card key by key and adds `duration` /
  `timing` / `interrupt` through `withXScope`. Losing `interrupt` there would leave every
  deck file valid, the parity test green (it checks the *corpus* card) and both shipped
  cards inert in a real game. Now asserted in `packages/cards/test/reactive-cards.test.ts`.
- A reactive card in hand changes what a played card does: its effect list is **staged**,
  so it raises no decision until the window closes. `secret-state.test.ts`'s
  "owing a decision empties the playable list" guard was reachable only by luck — it
  stopped after six plays and depended on the seeded shuffle dealing a card that raises a
  decision. It now walks every offered card and settles any window it opens.
- `canBeAnswered` needs a player to **hold** a reactive card, so an ordinary driver that
  never buys a Conspiracy Card still plays the ordinary game. That is the property that
  keeps `winnable.test.ts`'s numbers comparable, and it is asserted directly.

**One blocker remains, and it is a stale assertion rather than a gap.**
`packages/engine/test/interrupts.test.ts:738` asserts that no deck file contains the string
`"interrupt"` — *"the shipped corpus is untouched by the staging branch"*. That assertion
**is** the recorded reason these two cards were held back, so shipping them makes it false
by construction. It needs the engine owner to invert it to "the corpus carries exactly two
executed interrupts, and no unexecuted one". `packages/engine/**` is not this package's to
edit and nothing was weakened to make it pass.

**Winnability with both cards in the deck**, 20 seeds per seat count, real corpus, driven
through the real reducer: 2 — turn 40/53/69; 3 — 46/57/96; 4 — 55/66/114; 5 — 56/65/96.
**80/80 finished, 80/80 with nine majorities, 0 windows left open, and both closure routes
exercised** (20 answers and 80 all-declines at two seats; at 3, 4 and 5 the driver is
greedy and answers every window it is asked first on, so the all-declines route is measured
on the uninformed table instead — 101/137/206/204 windows, every one closed by declines).
`npm run playable` is unchanged at **25 of 54**, because the probe writes its own reduction
rather than reading the deck.

### G14 — no `when`: effects that trigger on other events

**State: (a). CLOSED.** `fireTriggers` is the registry, and it is consulted at the
places that raise events rather than at every caller: `INFLUENCE` (`on-voter-influenced`
then `on-purchase`), `BUY_CONSPIRACY` (`on-purchase`), `GERRYMANDER` (`on-gerrymander`),
and `setArea` (`on-volatile-placement`, `on-majority-formed`) — and `setArea` is the
only thing in the engine that changes a peg, so the three powers and `resolveChoice`'s
voter branch get the two board events for free rather than by remembering to.

**Cards gained: POWER TRIP** (faithful but for the dropped *"non-majority"*, and
slightly weaker because each opponent picks which of their own) and
**LAB-GROWN EARWORM** — whose reduction is *strictly stronger* than the printed card
and is flagged as needing a ruling; see §0b.2. GROWING DISSENT is G9 + G14 together.

**Re-entrancy is bounded three ways**, all tested rather than asserted: one effect
per wave and never the same `LiveEffect.id` twice in one cascade (`consumed` is an
*argument* threaded through the loop, never state — R2); `TRIGGER_MAX_WAVES` on top,
which is what a cycle among live effects would beat; and no effect op can reach
`setArea`, so a hook cannot wake a hook through the board. That last one is derived
from `applyEffect`'s own source text, for the same reason the op registry is.

**Still (b) or (c), and the reason is not the trigger registry any more:**
GREAT LEADER BAD ECONOMY and WHY THE LONG FACE? both need *"pick an opponent"* or
*"the player after you"* — G1, which is a decision over players and therefore a new
`Choice` kind and a client wire-format change. THE GRETA EFFECT is a *payout*
modifier, the same shape as G9's surcharges. QUANTUM WRISTBAND is an auction, G13.


### G15 — no value computed from your own current state

**State: (a) for `n` and `per`, still (b) for PRICES.** `n` is now
`number | ComputedCount` and `gain` / `lose` carry `per`, both resolved by
`resolveCount` / `resolveDelta` **before** anything is pushed — which is what makes
the widening safe. `Choice.count` is still a `number` at the point it is constructed
and every loop bound is a resolved number, so a computed value can never reach the
engine as one. The guarantee this gap originally wanted from the type system now
comes from the reducer, and `reducer-parity.test.ts` asserts it from the source.

**Card gained: IF YOU LIKE PIÑA COLADA** — `"per": {"of": "held-of-each-resource"}` on
a `res` of 1 in each resource *is* *"double all the resources on your player mat"*,
and the cap still applies on top, which is the card's own second sentence.

**`ideologue-level` reads CARDS, NOT RESOURCES**, and that is the load-bearing
detail. §6 is explicit that the balance checker's D3 models the Ideologue ladder as a
RESOURCE PROXY and over-reports on cards paying 3 or more. `powers.ts` `hasPower` is
`cardsOf(player, ideologue) >= rules.level3` — a count of Ideology **Cards** answered.
A computed value that agreed with the checker and disagreed with the engine would be
the wrong way round, so `computedValue` counts cards and
`computed-values.test.ts` pins the difference with a player holding 4 Funds and one
answered card, which the proxy scores as Level 3 and the engine as Level 1.

**Still (b), and the blocker is a FIELD, not arithmetic:** JUMLA and HOLO SAPIENS are
dynamic *prices* (*"as many resources as the Ideologue level this card is on"*), and
`Effect` has nowhere to put a price — `discount` grants a Helping Hands use rather
than setting a cost. DOSTI BANI RAHE needs a turn trigger on a seat other than the
owner. THE BIG FREEZE is a cap change or a per-turn donation, and a cap change is a
`PlayerState` field, not an effect.


### G16 — no zone-scoped operation

**State: (c).** Cards: JUST BREATHE, NERO'S GUESTS, CUT COPY AND PASTE. Three
needs: a zone selector computed from board state, a zone passed in by the trigger as
context, and board mutation scoped to one zone.

**Ask:** a `zone?: ZoneID | 'this-zone' | 'your-strongest'` on the affected ops, a
`GameState` field carrying the zone that triggered the current resolution, and a
`fill-zone` op.

### G17 — no deck search, and no rewind from the discard pile

**State: (c).** Cards: SELECTIVE ACCESS MEMORY, AS CLEAR AS WATER, GOOD GIG WELL
PLAYED, FUELLING THE NEWS.

**What this iteration bought:** GOOD GIG WELL PLAYED (`hl-et2040-011`) ships on its
*keep one for yourself* branch — `draw-conspiracy` of 1, which is exactly that branch.
The two gifts to opponents (G20) and the discard-pile fallback are dropped, so it is
roughly a third of the real card's swing: a Conspiracy Card is worth its printed 4-5
resources and the opponents get none of it. **+1 real card, adapted.**

**Ask:** `{ op: 'draw-card'; kind; n; from; pick }` plus a `'choose-card'` Choice.

**THIS ITERATION CLOSED THE OTHER HALF, and it bought a card: `onlyIfEmpty`.**

`draw-conspiracy` gains `onlyIfEmpty?: boolean`, and a resolved player who already
holds a Conspiracy Card is skipped. That is AS CLEAR AS WATER's whole
state-changing clause — *"If any player does not have a Conspiracy Card, they receive
1 from the draw pile (in order of turn)"* (REF 4.3) — and it is a FLAG rather than a
decision because the state it reads is the **recipient's hand**, which `applyEffect`
can already see. `target: 'everyone'` is the faithful reading of "every player": the
caster is in the set and the condition excludes them, because a Conspiracy Card has
just left their hand.

**Card gained: AS CLEAR AS WATER** (`hl-et2040-013`, `adapted`), replacing the
`inferred` THREE DAY WEEKEND placeholder. **27 of 54, measured by playing.** Both
REVEAL clauses are dropped and the reason is the same for both: **a reveal has no
state consequence in this engine**, so there is nothing for `reduce()` to perform.
That is a missing MECHANISM, not missing wording, and it is named as such.

**No `GameState`/`PlayerState` field, so no visibility decision.** The information
question is the interesting one and it is worth the space: a Conspiracy Card hand is
hidden from every viewer **including its owner** (`playerView` blanks it), so
`onlyIfEmpty` reads a fact the caster cannot see and the table cannot see. The
per-player outcome is a bare `continue`: **no `LogEntry`, no `GameEvent`.** A line
reading "p2 was handed a card" would be a disclosure about a hidden hand, and so would
"p2 is holding nothing" — the same bit with the sign flipped. `card-playback.test.ts`
asserts this on the whole `playerView` payload rather than on one field.

**Termination: the draw pile is the bound.** `onlyIfEmpty` can only move a card out of
the draw pile into a hand that is *empty*, so no queue grows on its own and
`TRIGGER_MAX_WAVES` is not what stops it. Asserted by resolving the card twice against
a three-card pile.

**What is STILL (c), and it is the reason this is not a full G17:** a decision over a
pile's CONTENTS. SELECTIVE ACCESS MEMORY's *"pick ANY Conspiracy Card from the discard
pile, in any order"* needs a `'choose-card'` `Choice` kind, and a new `Choice` kind
breaks `packages/client/src/app/derive.ts` at two `switch`es — verified, `tsc` reports
`TS2366` at `derive.ts:372` and `derive.ts:435`. `packages/client` is not this
package's to edit, so `pick` remains unbuilt and the top of the pile is still the
honest subset. A CALL FROM KARACHI, FUELLING THE NEWS and BLESSINGS OF PARENTS PAST
each need the choice on top of G20 card movement, and none of them moves.

### G18 — no control over the draw-and-answer phase

**State: (c).** Cards: 404, BRAVE NEW WORLDS, CARD GAMES. These change who gets which
card and suppress passive income; `Effect` is a list applied inside one turn.

**Ask:** a card-level `answerPhase` the `answer` branch of `reduce()` reads.

### G20 — card-destroying and card-moving effects between players

**State: (c) → the MECHANISM LANDED, and two real cards with it.** `move-card` executes,
`PlayerState.ideologyCards` exists, and the ruling on blind answers is made, argued and
tested. **23 → 25 of 54.**

**The ruling, in one line: a moved Ideology Card is HELD AND HIDDEN — from everyone,
including the player it was given to — and is put to that player at their next turn
boundary, in place of that turn's draw.** The long form is on `PlayerState.ideologyCards`
in `packages/engine/src/state.ts`; the mechanism's own contract is on the `move-card` arm
in `packages/engine/src/cards.ts`. Three findings from building it that the next reader
must not re-derive:

1. **The source is the DRAW pile, not the discard pile, and that is the security
   decision rather than a convenience.** The top of the Ideology discard is the most
   recently *answered* card (`ANSWER` is the only thing that puts one there), and p13
   makes an answered card face up under its owner's mat. Moving a discard-pile card into
   a hand would not restore the blind answer, it would **announce** it — the whole table
   already knows the question and the answer the holder is about to commit to. The first
   draft took `from: 'discard'` and the engine's own game-loop test caught it on its
   first run: the card it had just moved was the one the caster had answered that same
   turn. Same argument as the `to: 'manifesto'` refusal, running the other way.
   A card in the draw pile has never been answered, so nothing about it is public.
2. **That choice closes a leak for free.** A hand drains at the boundary *instead of* a
   draw, so a card entering a hand must have left the draw pile already for the deck to
   fall by exactly one per turn. Off the discard it fell by one on the play turn and by
   **none** on the deal turn — a discontinuity an observer could time, which would tell
   every viewer that a transfer had happened. Off the draw, the count is monotonic and
   there is nothing to read. The design choice and the security property are one
   decision.
3. **The op is deliberately tiny, and three of its obvious shapes are refused AT THE
   TYPE LEVEL**: `from: 'pending'` (it would tell a mid-answer player the card exists,
   offer a look at it by proxy, and empty `_pendingCard` into a soft-lock where `ANSWER`
   and `END_TURN` are both illegal), `from: 'hand'` (a hand is a queue the *engine*
   drains; its holder cannot enumerate it, so neither can an op), and `to: 'pending'` /
   `to: 'manifesto'` (there is no third category — see ruling §4).

`IDEOLOGY_HAND_MAX = 2` is a **termination** bound and not a rules claim, because
`move-card` is the first op that can append to a queue: `TRIGGER_MAX_WAVES` does not
cover a `when: 'on-turn-start'` move into a hand, because that bound is per *firing
event* and one event per turn is a slow leak rather than a hang.

**What this bought, and what it did not.** JUMLA (`ct-in2020-011`) and HOLO SAPIENS
(`ct-et2040-013`) ship `adapted`, both on *"This is an extra Ideology Card"* alone — which
is the card's whole identity. **+2 real cards.** The same source is *honest* for a
Conspiracy Card and a *leak* for an Ideology Card: `draw-conspiracy`'s `from: 'discard'`
discloses nothing, because a Conspiracy Card is bought and held and never answered face
up. The difference is entirely p13.

**Still blocked, and the three reasons are rulings rather than missing features.**
A COWARD OR A JOURNALIST? / CARD GAMES needs `from: 'pending'` *and* G12's in-flight
queue (an owner, a seat, a deadline) — so the type refusal and the missing queue are the
same blocker seen twice. BLESSINGS OF PARENTS PAST is G17 (choose 2) plus a Voter Card
donation plus a defined two-player order. A CALL FROM KARACHI, AS CLEAR AS WATER and
FUELLING THE NEWS are all G17 deck search or G18 on top of a card move. CULT-IVATING
OBEDIENCE, POLO RETREAT and DEEP THOUGHTS name G20 in the table but are G-new, G11 and
borrow-a-power respectively, and no `move-card` reaches any of them. **Re-entrancy is
bounded**, and the `to: 'destroy'` branch ships with no card yet: it is the operation the
destruction-leak tests pin, and inventing a card for it would be a card the corpus does
not contain.

**Tested, adversarially**, in `packages/engine/test/card-transfer.test.ts` (17 tests) and
`packages/cards/test/card-playback.test.ts` (4 more, on the shipped cards): mid-answer
transfer leaks nothing and the payload is **byte-identical** before and after; a destroyed
card emits no `LogEntry`, no `GameEvent`, no id and neither side's payout, and shrinks the
world; the deck count falls by exactly one per turn forever; a 60-position played game
asserts at every step that some action succeeds *and* changes something; and the
empty-deck-with-a-held-card case that the hand-before-deck ordering in `advanceTurn`
exists for.

### G22 — no "during your next turn" scope

**State: (a). CLOSED — the same change as G9.** Each `LiveEffect` carries `activeFrom`
and `expiresAt` as absolute turn numbers, computed at install from the seat order
(`state.ts` `ownerNextTurn` and `roundEndTurn`) and checked by `isInForce`. Nothing
at expiry time needs to know whose turn it is, and nothing at install time reads a
clock, so a replay from seed + action log reproduces the list exactly.

`'next-turn'` means *live through the owner's next turn, gone at the boundary after
it*, and `timing: 'next-turn'` means *dormant until then*. `timing: 'after-this-turn'`
is the one value still refused, and the reason is recorded rather than guessed at: it
would need a queue of effects to run between `advanceTurn` and the next player's
first action, and nothing in the corpus needs one.

**Cards still waiting on this gap** are not waiting on the *scope* any more. DON'T
KISS THE BABIES and SNOOP B-O-DOUBLE-T are surcharges (G5), GENDER TROUBLE is a
`no-power` restriction (G5), MOVEMENT ANXIETY DISORDER needs a token counter on a
card (G10) so it can expire after three discards rather than on a turn, and DOSTI
BANI RAHE needs a trigger on somebody else's turn.


### G23 — `IdeologyCard` has no notion of the card's second face

**State: (c), and deliberately not a schema change.** `sides` is an unordered pair,
which is sufficient for play; a stable reading order is a client concern and the `_`
convention already supports a one-sided view. The client is another agent's.

### G24 — `IdeologyCard` has no card code

**State: (c).** No field for the printed code. Only needed for deck diffing and bug
reports, not for play. `readonly code?: string` matching `^[A-Z]{2}\d{2}\.\d{3}$`
would close it.

### G-new — `discard-voter` / `convert-voter` cannot reach your own voters

**State: (a). CLOSED — and the whole fix is passing the RAW `target` field down.**

`targetableCount` skipped the chooser's own pegs for both ops and `resolveChoice`
rejected them, so *"Discard 2 of your own voters"* — which REF 4.3 records as AIN'T NO
CURE FOR LOVE's first branch — was not expressible, and neither was any self-targeted
discard. Three shipped cards were telling the player one thing and doing another and
their `text` had been weakened to match.

**The fix, and why it is one line.** `applyEffect` computes ONE `target` for the whole
effect list and defaults it to `'you'`, so by the time the three voter cases called
`raiseVoterDecision` an absent `target` field and an explicit `target: 'you'` were the
same value. They are **not** the same card: RED BLOODED says *"You must discard any 2
voters"* and AIN'T NO CURE FOR LOVE says *"Discard 2 of your own voters"*, both land on
`discard-voter`. The three cases now pass `effect.target` — undefined when the card
wrote none — and `voterScope` in `reduce.ts` is the table:

| chooser | op | scope |
|---|---|---|
| a player the card NAMED | any of the three | `'own'` |
| the caster | `evict` | `'any'` |
| the caster | `convert-voter` | `'others'` — even with `target: 'you'`, because `resolveChoice` refuses a pick on the chooser's own peg, and converting your own voter into your own voter is not a conversion |
| the caster | `discard-voter`, `target: 'you'` | **`'own'` — the new row** |
| the caster | `discard-voter`, no `target` | `'others'` — **unchanged**, and it has to be |

**No `GameState` or `PlayerState` field was added, so there is no visibility decision to
make.** `ChoiceScope` already existed and already had a `'own'` member, so
`packages/server/test/secret-inventory.ts` owes nothing and the client's own copy of the
rule (`packages/client/src/app/derive.ts`) already handles `'own'` — this is why the
answer was a scope VALUE and not a new field. `targetableCount` was already parameterised
by `scope`, so the client's `targetableCount` and the engine's agree without either being
edited.

**Deadlock: the ask is clamped at resolution by `targetableCount`, so a player who has
since lost their last own peg is asked for zero rather than for one.** Asserted at 2, 3,
4 and 5 seats in `choices.test.ts`.

**Card gained: MOVEMENT ANXIETY DISORDER** (`hl-et2040-016`, `adapted`) — the next
voter you Gerrymander is discarded, hooked on `on-gerrymander` with `movedMyVoter`.
**`npm run playable` 25 → 26 of 54, measured by playing.** Both of that card's recorded
gaps (G9, G22) had already been CLOSED by the live-effects substrate, so the probe row
was a measurement of the probe rather than of the engine; only the COUNTER (*"the next
3"*) is dropped, and a counter that outlives its resolution is **G10**, not G9.

**One card's text got MORE faithful, which is the part worth reading.** `hl-et2040-003`
(AIN'T NO CURE FOR LOVE) now ships `target: 'you'` and its `text` says *"2 of your OWN
voters"* — the printed clause — instead of the weakened opponents' reading. It is still
`adapted`: the OR-branch (*"Donate 1 of your voters to the player on your left"*) is
still G1, and with that branch gone the printed *"if you are unable to do either, ignore
this card"* fallback has nothing to name.

**Still blocked on this gap's larger sibling: CULT-IVATING OBEDIENCE** needs a *player's*
card to become a ransomable object (G11/G20), not just a peg.

---

## 3. The engine work this needs, in the order that buys the most cards

This is the handoff. `state.ts` and `reduce.ts` are not this package's to change.

| # | change | where | unblocks | cost |
|---|---|---|---|---|
| ~~1~~ | ~~loop `resolveTargets` in the `gerrymander` case~~ | — | **DONE** | — |
| ~~2~~ | ~~live-effects list on `GameState` + expiry ticked in `advanceTurn`~~ | — | **DONE** — G9 + G22, the substrate for 3 and 4 | — |
| ~~3~~ | ~~trigger registry consulted by `INFLUENCE` / `BUY_CONSPIRACY` / `GERRYMANDER` / `PLACE_VOTERS` / `setArea`~~ | — | **DONE** — G14 | — |
| **G4 + G5** | `n: number \| ComputedCount` and `per` on `gain`/`lose`; `PlayerState.restrictions` | **DONE** — G15, G4, and 3 of G5's 5 | — |
| 5 | ~~`PlayerState.restrictions` + every action consults it~~ | — | **DONE for the purchase locks** (G5, 3 cards). `no-power` and `no-volatile-placement` still need their own consult points | — |
| 5 | `PlayerState.restrictions` + every action consults it | `state.ts`, `reduce.ts` | **G5 (5 cards)** — §4. **The largest remaining lever: 3 of the 5 (PYTHONPOST, SNOOP B-O-DOUBLE-T, DON'T KISS THE BABIES) are surcharges, and a surcharge is a *cost* modifier, which no amount of `Effect` work can express.** | large |
| **G5** | `PlayerState.restrictions` + a `restrict` op, consulted by `INFLUENCE` and `BUY_CONSPIRACY` | **DONE for the purchase locks.** 3 more cards | — |
| 6 | phase machine: `block` / `deflect` / `auction` / `vote` / `pass-card` | `reduce.ts`, `actions.ts` | **DONE — G13, and SHIPPED — G13d.** `GameState.interrupt`, `RESPOND_INTERRUPT` + `PASS_INTERRUPT`, no new `Phase`. **BLOCK and DEFLECT are playable (21 → 23 of 54) and are now in `decks/` as `ct-et2040-014` / `ct-et2040-015`.** `auction` / `vote` / `pass-card` ruled out with a cost — §2 G13b/c, because each buys **no card** without G12/G17/G20 first. One stale assertion left, in a package this one may not edit: `packages/engine/test/interrupts.test.ts:738` | — |
| 7 | `'chosen-player'` on `EffectTarget`, via a new `Choice` kind | `cards.ts`, `state.ts`, `reduce.ts`, **client** | G1 (2), G-new (1), and it is the last thing standing between 3 more trigger cards (GREAT LEADER, WHY THE LONG FACE, a faithful LAB-GROWN EARWORM) | small, but a **wire-format change the client owns** |
| 8 | `target` on `evict`, `discard-voter`, `convert-voter`, `discount`; let a choice reach the chooser's own pegs | `cards.ts`, `reduce.ts` | G-new (3 cards) | small |
| 9 | `move-card` op + `PlayerState.ideologyCards`, and a ruling on blind answers | `state.ts`, `reduce.ts` | **DONE — G20. `move-card` executes, the ruling is made, and the hand drains at the turn boundary. JUMLA + HOLO SAPIENS ship adapted: 23 → 25 of 54.** `from: 'draw'` only — a discard-pile Ideology Card has been answered and p13 makes that public, so handing one over blind would publish the answer. A COWARD OR A JOURNALIST? stays blocked on G12 as well, and three other shapes are refused at the type level | — |
| 10 | `draw-card` with `from: 'draw' \| 'discard'` and a `'choose-card'` Choice | `state.ts`, `reduce.ts` | **G17 (4 cards)** | small |
| 11 | a `price` field: a computed cost the *seller* reads, distinct from `discount` | `cards.ts`, `reduce.ts` | G15's JUMLA / HOLO SAPIENS, and the honest half of G3 | medium |

**Where the leverage is now.** Items 1–6 are done and bought 6 cards. Of what is
left, **item 7 is the cheapest**: `'chosen-player'` on `EffectTarget` is one union
member and one `Choice` kind, and it is the last thing standing between three more
trigger cards (GREAT LEADER, WHY THE LONG FACE, a faithful LAB-GROWN EARWORM). It
needs a new `Choice` kind, and **a `Choice` kind is a wire-format change the client
owns**, so it is not one decision.

**The shortest route to the next playable card** is not on this table: it is a
`read`-vs-`target` split on a computed value, which is half of G4 and would make
THOUGHTS AND PRAYERS faithful rather than approximate.


---

## 4. G5 in full: `PlayerState.restrictions` — **PARTLY LANDED, and the two rulings are made**

`Restriction` and the `restrict` op are in the engine. `INFLUENCE` and
`BUY_CONSPIRACY` consult them. The two rulings §4 asked for are decided, and both are
argued on the type in `state.ts` rather than only here:

1. **KHAKI TERROR's condition decrements by what was ACTUALLY donated.** `lose` caps
   at what the player holds, so a player with no Media can still satisfy *"you
   cannot make any purchases until you do so"*. `remaining` is decremented by the
   `Delta` that was actually removed. **The safe direction is deliberate:**
   under-decrementing leaves the player locked and able to donate again;
   over-decrementing hands out a free Voter Card. A satisfied lock is REMOVED rather
   than left at zero, so "do they have any restrictions?" stays one predicate.
2. **`restrictions` is PUBLIC and must appear in
   `packages/server/test/secret-inventory.ts` as a deliberate non-secret.** That file
   is not this repository's engine owner's and **has not been changed** — it is
   flagged in three places so the omission cannot read as an oversight. The argument
   is that every real card imposing a restriction announces it, and KHAKI TERROR's
   punchline is that everyone can see you cannot buy.

**A third ruling the spec did not force:** a surcharge stacks **on top of** a Helping
Hands discount. p32 lets Helping Hands reduce "the cost of any purchase"; read
literally that lets the Idealist's own power erase another player's tax. PYTHONPOST
says "an EXTRA resource", not "one resource less than usual".

### Two deviations from the spec above, both argued in `state.ts`

- `expires` is an absolute `expiresTurn: number | null`, not the
  `'resolved' | 'this-turn' | 'next-turn' | 'round' | 'rest-of-game'` enum proposed
  here. That enum mixes a condition with a deadline in one field; an absolute turn
  number reuses `ownerNextTurn` / `roundEndTurn`, so all four durations work with no
  special case and a replay reproduces it from the state.
- `PlayerState.restrictions` is **optional**, because a required new field breaks
  every hand-built `PlayerState` literal in `packages/client` and `packages/server`.
  It is never absent in a state the engine produced. This is coordination debt with a
  named one-line fix, not a design choice.

### What G5 still owes

**`no-power` LANDED, and it is the last of the two consult points G5 named.** A third
`RestrictionKind`, `'no-power'`, read in exactly one place: `usesLeft` in
`packages/engine/src/powers.ts`, which returns 0 for every power the restricted player
holds. That is a deliberately good hook rather than a lucky one -- **every `POWER_*`
case in `reduce()` already asks `usesLeft` whether the power is available**, so this is
one edit rather than seven, and it cannot drift: a power added to the vocabulary later
consults the restriction the moment its action checks, which every one of them must do
already or the power would be free.

**`expiresTurn` is NOT re-checked in `usesLeft`, and that is deliberate.** It takes a
`PlayerState`, not a `GameState`, so it cannot see the turn; re-deriving the deadline
from the player alone would be a SECOND definition of the same expiry, which is how a
restriction lives one turn too long in one place and not another.
`expireRestrictions` in `advanceTurn` removes it, on the same clock that resets
`powerUses`. `restrictions.test.ts` walks the table round to pin that a
`until: 'next-turn'` restriction is in force for exactly the owner's next turn and no
longer -- that test is the only thing holding the two clocks together.

**Card gained: NONE, and the reason is a corpus gate rather than an engine one.**
GENDER TROUBLE (`REF 4.3`: *"You cannot use one of your unlocked Level 3 Ideologue
Powers in your next turn"*) is now **expressible and executable** — `restrict` with kind
`no-power` — and the playability probe reports it PLAYED, which is the honest reading.
It is **not shipped**, for two measured reasons:

1. **`packages/server/test/corpus.test.ts:197` pins the number of DISTINCT effect ops
   across all shipped Headline Cards at 12**, because that number is how many driver
   branches a corpus swap invalidates. `restrict` appears in no shipped Headline today,
   so the first one makes it 13. The only way back to 12 is for a *unique* op to leave
   with it, and the three unique headline ops are `gerrymander` (NEW FACE WHO DIS, a
   recovered card), `restrict` (this one) and `refresh-market` (PANI KI KAMMI, an
   `inferred` placeholder). Retiring the placeholder was tried and it **regresses the
   server suite**: `interrupt-window.test.ts`'s decline-only sweep, 5 seats, seed 14,
   finishes **19/20** with "reasons budget: 1200 actions" where it finished 20/20 before
   (verified by stashing the deck change and re-running). That is an uninformed socket
   driver running out of budget, not a soft-lock — the greedy sweep is 20/20 at all four
   seat counts either way — but it is a real regression in a suite this package may not
   edit, and shipping a card whose cost is "one server assertion went red" is not a
   trade worth making unilaterally.
2. Even once it ships, it is **weaker than printed, and the direction matters**: the
   printed card takes ONE chosen Level 3 power away and this takes ALL of them, because
   naming one is a decision over powers and that is G1. That is strictly *less* for the
   caster — a Headline that only hurts the player who resolved it. The *"if you do not
   have a Level 3 power, discard 2 resources instead"* fallback is also dropped; it needs
   a conditional over the whole effect list. Whoever ships it should say that in the
   card's `text` rather than reproducing the printed wording.

**The one-line unblock for the server owner:** bump `corpus.test.ts:197` from 12 to 13
**and** re-run the decline-only sweep; if the sweep is still red, the card is blocked on
the corpus's interaction with that driver and the mechanism above is still worth having
— it is the last of G5's two named consult points and it cost one line in `powers.ts`.

**`no-volatile-placement` is still (c).** NEW FACE WHO DIS's *"these voters cannot be
placed into Volatile Areas"* needs a consult point in `PLACE_VOTERS` and `GERRYMANDER`,
and `placeableAreas` in `reduce.ts` is where the client already asks the same question.
Small now that the mechanism is there, and it buys **zero new cards** -- NEW FACE WHO
DIS already ships.

**THE BIG FREEZE's *"reduce your resource cap to 10"* is not a restriction at all:**
it is a `PlayerState` cap field, and a card that changes a number every other rule
reads from is a different mechanism again. `canAfford`, `enforceCap`, `overCap`,
`poolTotal` and the balance checker all read `rules.resourceCap` directly today.

---


## 5. A defect found in `docs/ARCHITECTURE.md` §6.4.3, not in the code

ARCHITECTURE §6.4.3 presents a worked "bad card" and says of it: *"`funds: 4 ≥ funds:
2` strictly, `trust: 2 ≥ trust: 0`, so **D1 `PURE_UPGRADE`** — the second side is a
free upgrade for anyone"* on a card whose sides are `{funds: 2, trust: 2}` and
`{funds: 4}`.

That comparison mixes sides: `trust: 2` is on the *first* side and `trust: 0` is the
second, so the second side is **not** ≥ the first — it is short one Trust. As card it
is a clean trade-off, not an upgrade.

More usefully, the arithmetic cannot be rescued: **if X ≥ Y componentwise and X ≠ Y
then ΣX > ΣY strictly, so a pure upgrade can never be 0-sum.** There is no zero-sum
pure upgrade. The argument the section makes survives intact once the gap is stated
honestly as **1 resource** — and 1 resource is *exactly* what
`BALANCE_TOLERANCE_TOTAL = 1` swallows. So the real demonstration is the pair of
tests in `test/balance.test.ts`: a 1-resource pure upgrade is an **error**, and a
1-resource trade-off is **clean**.

The implementation in `src/balance.ts` follows the corrected reading. §6.4.3's example
should be rewritten to match; it is the one place in the design docs that would mislead
the next person who implements from it.

---

## 6. D3 models a resource PROXY, not the engine's power-unlock rule

`POWER_THRESHOLD_CLIFF` in `src/balance.ts` is the check that makes the file worth more
than a totals comparison, so its fidelity is worth stating plainly.

**The engine's real rule.** `packages/engine/src/powers.ts` `hasPower()` is
`cardsOf(player, spec.ideologue) >= rules.level3` — a count of Ideology **Cards**
answered, not of resources paid. `IDEOLOGUE_RESOURCE[i]` tells you which resource an
Ideologue's answers *feed* (the passive bonus, `passiveBonus()`), but it is not what
unlocks a power. Nothing about a card's `pays` block changes which powers a player
holds.

**What D3 actually measures.** The balance checker runs on one card in isolation,
with no manifestos, so it cannot count cards. It uses the resource proxy the rules
supply for that ladder: a side paying `RULES.level3` of its own Ideologue resource is
treated as buying the Level 3 unlock, `RULES.level5` the Level 5.

**Consequences, both deliberate.**

- The crossing is scoped to `IDEOLOGUE_RESOURCE[side.ideologue]`. An earlier version
  counted *every* resource a side touched, so a Capitalist side paying `{funds:3,
  media:3}` scored two unlocks it does not own. A count is gameable by padding, and
  this made it gameable: `{funds:3, media:3}` (2) against `{trust:5}` (2) compared
  level and called the card clean while the Idealist side held the Level 5 power and
  the Capitalist side held only Level 3.
- It remains a proxy. A player who answers three Capitalist cards unlocks Prospecting
  whatever those cards paid; a player who answers one Capitalist card paying 3 Funds
  unlocks nothing. The proxy therefore **over-reports** cliffs on cards whose sides
  pay 3 or more.

**Minimal change, if the proxy misreports on real play:** replace `thresholdCrossings`
with a function that takes the answering player's manifesto counts and flags a card
only when it would be the 3rd or 5th card of its Ideologue *for a player who is
actually on that threshold*. That is a manifest-relative check, so it cannot run on a
card in isolation and it moves this check out of `src/balance.ts` into wherever a
player state is in scope.

**Status:** none of the shipped Ideology Cards pays 3 or more of any resource, so the
shipped decks produce zero crossings under either version, and the checker result is
unchanged.

---

## 7. What is NOT a gap

Recorded so the next iteration does not waste time on them.

- **`pays` need not contain the answerer's own resource.** REF §5.2 verifies from the
  official 432-card render that a real Capitalist side pays 2 Trust + 1 Media and
  **zero** Funds. A validator rule of the form "a Capitalist answer must pay ≥1 Funds"
  would reject a shipped card. The schema requires the key to be *stated* and the
  value to be *non-negative*, and nothing more. `ig-in2020-002` is the corpus's proof.
- **`{}` as a payout is a design failure, not a schema failure.** The schema sets no
  `minProperties` on `pays`; the balance checker's D5 `EMPTY_SIDE` owns it. Shape
  validation and design judgement stay separately reviewable.
- **The Ideology Card schema is essentially correct.** REF §5.1's field-by-field
  comparison finds the engine's `{question, sides[2], campaign, advisory}` an exact
  match for the printed card, and *more* austere than reality. Only G23/G24 are
  missing, and neither affects play. The corpus is blocked on **content**, not on
  schema: REF §2.4 recovered zero ordinary question cards in full.
- **`target` on `gain`, `lose`, `gain-any`, `lose-any` and `voters` is done.** It is
  the only target the engine reads, and `EXECUTED_OPS` now proves it per op rather
  than assuming it.
