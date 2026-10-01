# KNOWN GAPS — what the card schema still cannot do, and what the engine owes it

**Two revisions in one file.** Everything above §3 is the *state after this
iteration*: each gap says which of the three states it landed in, what changed, and
what `reduce()` / `state.ts` would have to do to move it. §5 and §6 are older notes,
kept because they are still true. §3 is the handoff.

`REF n` = `docs/AUTHENTIC-SHASN-REFERENCE.md` section n. `RULES pn` =
`docs/rules-reference.md`, Collectors Edition rulebook page n.

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

### 0.2 The finding, stated plainly

**No new expressiveness produced a new playable card, and that is not a failure of
the schema work — it is the shape of the problem.**

Everything landed in this iteration is state (b): `target` on `gerrymander` (G8),
`duration` / `timing` (G9 / G22), `interrupt` (G13), `when` / `until` (G14) and a
computed `n` (G15) are all now writable in the schema and all refused by the
validator, because `reduce()` performs none of them. A card that used any of them
would be a card that lies.

The four real cards that *did* become playable were unlocked by something else
entirely: by re-reading `applyEffect` closely enough to see which recovered cards
were already expressible in the shipped op vocabulary, and accepting a smaller card
rather than a bigger lie. Their dropped clauses are named in their `source` fields
and counted per gap in §2.

So the honest reading of the old "86% cannot be expressed" figure is: **it is not
86% of a schema problem.** For the 39 cards still unshipped, the binding constraint
is `reduce()` and `state.ts`, not the schema. Their specifications are now written
down, quarantined, and each one names the engine change it waits on — which is
what makes the next iteration a matter of implementing rather than inventing.

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

**State: (c).** Cards: RED BLOODED (shipped as a fixed pair), THOUGHTS AND PRAYERS,
JUST BREATHE. *"2 resources for each of their discarded voters"* reads board state at
resolution time.

**Reducer ask:** resolve the multiplier in `applyEffect` before pushing anything, and
push N choices rather than one — the same read-the-player-state plumbing G14 needs.

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

**State: (b).** Cards: PYTHONPOST, SNOOP B-O-DOUBLE-T, THE BIG FREEZE, GROWING
DISSENT, DON'T KISS THE BABIES, KHAKI TERROR, ON THE "HIGH" SEAS — 6 cards, and the
single largest engine change the corpus exposes. `'this-turn'` is accepted by the
validator, because that is what the engine already does (resolve once, discard); the
other three values are refused.

**Ask:** a live-effects list on `GameState`, re-applied on each event, with expiry
ticked in `advanceTurn()`. §3.

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

### G13 — five PHASE-CHANGING ops that do not belong in `Effect[]`

**State: (b), and the design call is made: they are not effects.**
`block` / `deflect` / `auction` / `vote` / `pass-card` are modelled as a **sibling
card-level field**, `Interrupt`, deliberately outside `Effect[]` — REF §5.4 is
emphatic that they change *which phase of play is running*, not how many resources
anyone holds, so no parameterisation of the effect list will express them. They are
schema-valid and refused by the validator with the reason.

**Cards gained: 0, and BLOCK and DEFLECT remain the two most-replayed cards in the
real product.** This is the largest remaining gap by reach.

**Ask:** the phase machine, not `applyEffect`. §3.

### G14 — no `when`: effects that trigger on other events

**State: (b).** Cards: LAB-GROWN EARWORM, POWER TRIP, GREAT LEADER BAD ECONOMY,
QUANTUM WRISTBAND, WHY THE LONG FACE?, THE GRETA EFFECT — 6 cards, and it composes
with G9 because both need the same live-effects list.

**Ask:** a trigger registry on `GameState` that `INFLUENCE`, `BUY_CONSPIRACY`,
`GERRYMANDER`, `PLACE_VOTERS` and `setArea` consult. §3.

### G15 — no value computed from your own current state

**State: (b).** Cards: JUMLA, HOLO SAPIENS, IF YOU LIKE PIÑA COLADA, DOSTI BANI RAHE,
THE BIG FREEZE. The `n` of every op is a literal; a price that is a function of the
seller's own board cannot be one.

**Ask:** resolve `n` before `applyEffect` pushes anything — which is why it shares
G14's plumbing. Note the type deliberately does **not** widen `n` to a union:
`reduce.ts` pushes `effect.n` straight into a `Choice.count` typed `number`, and
widening the type would let a computed count into the engine where TypeScript would
otherwise have stopped it. The schema accepts the computed form; the validator
refuses the card.

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

### G18 — no control over the draw-and-answer phase

**State: (c).** Cards: 404, BRAVE NEW WORLDS, CARD GAMES. These change who gets which
card and suppress passive income; `Effect` is a list applied inside one turn.

**Ask:** a card-level `answerPhase` the `answer` branch of `reduce()` reads.

### G20 — no card-destroying or card-moving effects between players

**State: (c).** Cards: A CALL FROM KARACHI, DEFLECT, CARD GAMES, A COWARD OR A
JOURNALIST?, BLESSINGS OF PARENTS PAST, ON THE "HIGH" SEAS.
`PlayerState.conspiracies` exists, but no op moves a card between players or back into
a pile, and reassigning Ideology Cards breaks the blind-answer invariant
`playerView.ts` tests for.

**Ask:** a `move-card` op and a `PlayerState.ideologyCards` list — and a decision about
the blind-answer invariant before it.

### G22 — no "during your next turn" scope

**State: (b).** Cards: DON'T KISS THE BABIES, GENDER TROUBLE, SNOOP B-O-DOUBLE-T,
DOSTI BANI RAHE, THE BIG FREEZE, MOVEMENT ANXIETY DISORDER. **G9 and G22 are one
change** and are specified together.

**Ask:** the same live-effects list as G9, each entry carrying the owning player, a
start turn and an expiry turn, evaluated at the top of that player's turn.

### G23 — `IdeologyCard` has no notion of the card's second face

**State: (c), and deliberately not a schema change.** `sides` is an unordered pair,
which is sufficient for play; a stable reading order is a client concern and the `_`
convention already supports a one-sided view. The client is another agent's.

### G24 — `IdeologyCard` has no card code

**State: (c).** No field for the printed code. Only needed for deck diffing and bug
reports, not for play. `readonly code?: string` matching `^[A-Z]{2}\d{2}\.\d{3}$`
would close it.

### G-new — `discard-voter` / `convert-voter` cannot reach your own voters

**State: (c), found while writing the honesty test, not predicted by the gap
analysis.** `targetableCount` skips the chooser's own pegs for both ops and
`resolveChoice` rejects them, so *"discard 2 of your own voters"* — which RED BLOODED
and AIN'T NO CURE FOR LOVE both say — is not expressible, and neither is any
self-targeted discard or conversion. Three shipped cards were affected and their text
is corrected.

**Ask:** let the choice take the chooser's own pegs when the card targets `you`, which
is a `target` on the two ops plus one condition in `resolveChoice`.

---

## 3. The engine work this needs, in the order that buys the most cards

This is the handoff. `state.ts` and `reduce.ts` are not this package's to change.

| # | change | where | unblocks | cost |
|---|---|---|---|---|
| 1 | loop `resolveTargets` in the `gerrymander` case | `reduce.ts` `applyEffect` | G8 — NEW FACE WHO DIS / SUBMERGED | one line |
| 2 | live-effects list on `GameState` + expiry ticked in `advanceTurn` | `state.ts`, `reduce.ts` | **G9 + G22 (12 cards)**, and the substrate for 3 and 4 | large |
| 3 | trigger registry consulted by `INFLUENCE` / `BUY_CONSPIRACY` / `GERRYMANDER` / `PLACE_VOTERS` / `setArea` | `reduce.ts` | **G14 (6 cards)** on top of 2 | medium |
| 4 | resolve `n` (and `per` multipliers) against player state before pushing | `reduce.ts` | **G15 (5 cards)** and **G4 (3)** | medium |
| 5 | `PlayerState.restrictions` + every action consults it | `state.ts`, `reduce.ts` | **G5 (5 cards)** — §4 | large |
| 6 | phase machine: `block` / `deflect` / `auction` / `vote` / `pass-card` | `reduce.ts`, `actions.ts` | **G13 (5 cards)**, incl. BLOCK and DEFLECT | largest |
| 7 | `target` on `steal-any`, `evict`, `discard-voter`, `convert-voter`, `draw-conspiracy`, `discount`; let a choice reach the chooser's own pegs | `cards.ts`, `reduce.ts` | G1, G2, **G-new (3 cards)** | small |
| 8 | `move-card` op + `PlayerState.ideologyCards`, and a ruling on blind answers | `state.ts`, `reduce.ts` | **G20 (5 cards)** | medium |
| 9 | `draw-card` with `from: 'draw' \| 'discard'` and a `'choose-card'` Choice | `state.ts`, `reduce.ts` | **G17 (4 cards)** | small |

Order 1, 7 and 9 are each under a day and together are worth about 8 cards. Order 2
is the one that unblocks the most (12 cards, and it is the substrate for two more
gaps). Order 6 is the most valuable per card and the most expensive.

---

## 4. G5 in full: `PlayerState.restrictions`

The five cards lost to G5 are five of the best-known cards in the product, and this
is the only gap on the list that is not a card-schema change at all. The specification,
in the shape the corpus would need:

```ts
export type RestrictionKind =
  | 'no-purchases'        // "You cannot make any purchases until you do so."
  | 'no-power'            // "You cannot use one of your unlocked Level 3 Powers…"
  | 'no-volatile-placement' // "These voters cannot be placed into Volatile Areas."
  | 'surcharge';          // "All Voter Cards cost any 1 extra resource in your turn."

export type Restriction = {
  readonly id: string;
  readonly kind: RestrictionKind;
  /** 0 while the resource in `value` is still owed. */
  readonly remaining: number;
  /** `value` is the amount still owed, or the power tier for 'no-power'. */
  readonly value: number;
  readonly expires: 'resolved' | 'this-turn' | 'next-turn' | 'round' | 'rest-of-game';
  readonly sourceCardId: CardID;
  readonly sourcePlayer: PlayerID;
};

export type PlayerState = {
  // …
  readonly restrictions: readonly Restriction[];
};
```

Then the consult points, all in `reduce()`:

| action | consult |
|---|---|
| `INFLUENCE` | `no-purchases`; `surcharge` adds to the computed cost (and Helping Hands may discount it, which is a ruling worth making explicitly) |
| `BUY_CONSPIRACY` | `no-purchases`; `surcharge` |
| `PLACE_VOTERS`, `GERRYMANDER` | `no-volatile-placement` on any destination area that is volatile |
| `POWER_*` | `no-power` against `usesLeft(self, rules, …)` |

And the two design decisions this forces, which are rulings rather than
implementations:

1. **KHAKI TERROR's condition.** *"You cannot make any purchases until you do so"* is
   satisfied by donating one resource of each type. `lose` caps at what the player
   holds, so the restriction must decrement by what was actually donated, not by 4 —
   and a player holding no Media must be able to satisfy it. `remaining` above is the
   mechanism; without it the card is a soft-lock, which is the real card's punchline
   and also its worst failure mode.
2. **Who clears a restriction.** On donation (the condition is met), on expiry, or
   manually? All three occur in the corpus, so the type needs all three and the rules
   text has to say which.

`restrictions` is public information in every real card that imposes it — the whole
point of KHAKI TERROR is that everyone can see you cannot buy — so it needs no `_`
prefix, and it must appear in the `playerView` secret-key inventory
(`packages/server/test/secret-inventory.ts`) as a deliberate non-secret.

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