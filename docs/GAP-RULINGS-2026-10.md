# GAP RULINGS — 2026-10

**An adjudication of G12, G13, G17 and G20, and one sequenced plan.**

`packages/cards/KNOWN-GAPS.md` records three of these four as blocked and one as
partly built. Two prior engineers ruled G13 out of scope on cost grounds. This
document says which of those rulings hold, which do not, and what to build first.

Read alongside `KNOWN-GAPS.md` (§0, §2 G12/G13/G17/G20 and G13b/G13c/G13d, §2bis,
§3.1–§3.4, §4) and `docs/rules-reference.md` (Collectors Edition rulebook pages).

---

## 0bis. STATUS — 2026-10-04. What shipped, and what this document got wrong.

**This document is a record of a ruling, not a status page.** Its argument is left as it was
written, including the parts that were disproven, because the errors are part of the
history. What follows is the correction, and it is the part to read.

### What shipped

**Step 1 (U1) shipped.** `ClientState.conspiracyRecycle`, `draw-conspiracy { pick?, to? }`,
the `'choose-card'` kind, and SELECTIVE ACCESS MEMORY as `ct-et2040-018`. The five §2bis
refusals are intact: a player hand, `_ideologyDraw`, `_ideologyDiscard`, `_headlineDraw` and
`_voterDraw` are all still **NEVER**.

### What this document got wrong, and the corrected figure

| this document says | the truth |
|---|---|
| §1.3, §2.2, §5 Step 1, §7: SELECTIVE ACCESS MEMORY is *"the first verbatim card in the corpus"* and the **0 verbatim** count becomes **1** | **It is `adapted`, and the corpus count is unchanged at 0 `verbatim`.** Dropping no clause is not reproducing text — the same reasoning this document applies to `IF YOU LIKE PIÑA COLADA`, which also drops nothing and stays `adapted`. A Conspiracy Card also needs a `cost` the recovered text does not print. The card's clauses now all *execute*; the card's *text* is still paraphrased into schema ops. The corpus was **151 cards, 0 `verbatim`, 41 `adapted`, 110 `inferred`** when this row was written; it is **222 cards, 0 `verbatim`, 45 `adapted`, 177 `inferred`** now (`packages/cards/KNOWN-GAPS.md` §0.1). |
| §5 Step 1 acceptance: **`npm run playable` 40 → 41** | **40 → 40.** SELECTIVE ACCESS MEMORY already reported PLAYED at HEAD via deterministic top-of-pile, so the probe's verdict was already positive and the change moved nothing. The `G17 → none` tag is the probe no longer finding an inexpressible clause, and is **not** a claim that G17 is closed. |
| §5 Step 1 and §7: the plan's ceiling is *"one card's first-`verbatim` status"* | There is no first-`verbatim` status to deliver. The ceiling is 40 → 40 on the probe, plus one card's dropped clause becoming expressible. |
| §1.3: `_conspiracyDiscard` has **exactly three writers** | **Four assignment sites in `reduce.ts`, reached by six write paths**: `PLAY_CONSPIRACY` and `RESPOND_INTERRUPT` (both log `Played "NAME"`), `draw-conspiracy { to: 'discard' }` (no log line, and none needed — a byte-identical round trip), the two `draw-conspiracy` take paths (which now log `Picked "NAME"` by the recipient), and `draw()`'s reshuffle, which empties the pile and has no caller for `'conspiracy'` today. The old "3" was counting a ternary in a conditional expression. |
| §1.1: G12's *"first two-thirds is not a gap; it is a duplicate reading of a field that shipped"* | **One third, not two.** `PlayerState.ideologyCards` is per-player, hidden from every viewer including its holder, and drained at **its owner's own turn boundary** in place of that owner's draw. That is a **hand with a deadline**, not a shared in-flight queue addressed by seat: there is no shared `GameState` queue, no seat position in a turn order, and no cross-player visibility. What shipped is the holder and the drain. The gate and the `from:` designation did not. |
| §0: `npm test` **1251 passed** | **1270 passing, 0 failing.** |
| §3.4: `PUBLIC_BY_DESIGN` is pinned to exactly `['liveEffects', 'restrictions']`, with the standing advice that the cap *"belongs in `PUBLIC_BY_DESIGN`"* | **§0 already caught this one** and the advice has been taken: the pin is the three-entry `['capOverride','liveEffects','restrictions']`. §3.4 is the stale half of the document and its two-entry pin should not be restored. |
| §0: the three `secret-state.test.ts` pins are `:1780`, `:1790`, `:1794`, and `CHOICE_KINDS` may classify only `['resources','pegs','players','zones']` | **Accurate as written, and U1 moved all three together** — `:1790` gained `'public-cards'` and `:1794` was narrowed and derived. Recorded here because the pins are load-bearing and a future unit that moves one without the others fails the step. |

### The §1.3 security derivation was FALSE, and is now TRUE. Both facts belong here.

**The derivation as written was false in 13% of real states.** §1.3 argued the published
recycle list equals *"the concatenation of the logged plays since the last publicly
observable reshuffle"*, and its correctness rested on the pile being append-only between a
reshuffle and the next one. It is not: **both `draw-conspiracy` take paths remove a card
from the pile by index rather than from an end.** A card therefore left the recycle pile
**silently**, and a spectator holding two payloads could diff them, see a named card
disappear with no log line, and combine that silence with the public `Played "NAME"` to
learn the card had moved into a hidden hand. One card of a hidden hand, disclosed to the
whole table, by nothing but a missing line. Two comments still assert the false invariant —
`packages/engine/src/reduce.ts:3386` and `packages/engine/src/state.ts:578`, both of which
say *"the pile can only GROW"*. Both are listed for dispatch in `KNOWN-GAPS.md` §0.4 rather
than fixed here, because `packages/engine/**` is not this package's.

**The mechanism was fixed, and the fix made the derivation true.** `announcedPick` in
`reduce.ts` now logs `Picked "<NAME>"` **by the recipient** on both take paths. Every
departure is therefore announced, so the reconstruction is **equality** rather than
containment, and the pile is always `[]` or exactly what replaying `Played` and `Picked`
over the public log yields, in order. Announcing is also the faithful behaviour: a Conspiracy
discard pile is face up at a real table, and everyone watching sees which card a player lifts
off it and into whose hand it goes. `packages/server/test/secret-state.test.ts` asserts the
equality and re-derives the writer list by slicing `reduce.ts`'s own source, so a seventh
silent writer fails a test rather than becoming a leak nobody looked for.

### Measured, for the record

`npm run playable`: **54 probed, 40 PLAYED, 0 refused, 0 no-op, 14 INEXPRESSIBLE** —
unchanged from §0's baseline, which is the arithmetic Step 1's own acceptance criterion
predicted wrongly. Full suite: **1270 passing, 0 failing.**

> **⚠ Superseded 2026-10-04. Both numbers above are that pass's measurement and both have
> moved.** `npm run playable` now reads **54 probed, 43 PLAYED, 0 refused, 0 no-op, 11
> INEXPRESSIBLE**, and `npm test` is **1452 passing** (engine 461 / server 336 / client 418 /
> cards 237). **The fourteen cards this document left undecided now all carry a ruling** —
> `packages/cards/KNOWN-GAPS.md` §8 is the decision, one row per card: 3 built, 8 ruled out
> with an original substitute filed in the corpus, 2 blocked on a named decision (§8.2), and
> 1 (CHAI-PAANI) ruled never to have been a gap at all (§7). **§0's table below is kept as
> the baseline this document's argument was built against and must not be read as current.**
>
> **What did not change, and is the point of keeping the baseline:** §0bis's correction that
> Step 1's ceiling was **40 → 40** and not 40 → 41 still holds *as a statement about Step 1*.
> The probe has since moved 40 → 43 for an unrelated reason — three cards were built under the
> §8 rulings — and that is not a vindication of Step 1's acceptance criterion, which was
> wrong when it was written.
>
> **Not verified by this pass: no shell.** The 43/11 and 1452 figures are read off
> `KNOWN-GAPS.md` §8 and carried on report respectively. Re-run `npm run playable` before
> treating them as current.

---

## 0. The measured baseline this document reasons against

Re-measured, not remembered. `KNOWN-GAPS.md` §0 is a table of figures that has
drifted twice; the numbers below were run.

| command | from | result |
|---|---|---|
| `npm run playable` | `packages/cards` | **54 probed, 40 PLAYED, 0 no-op, 0 refused, 14 INEXPRESSIBLE** |
| `npm test` | repo root | **1251 passed**, 4 packages: cards 200, client 301, engine 436, server 314 |
| `npm run typecheck` | repo root | clean |

Two pins quoted in the brief and in `KNOWN-GAPS.md` §3.4 are **stale**. The live
values, which this document rules on:

- `packages/server/test/public-payload.test.ts:444` pins `PUBLIC_BY_DESIGN` to
  exactly **`['capOverride', 'liveEffects', 'restrictions']`** — three entries, not
  the two `KNOWN-GAPS.md` §3.4 states. `capOverride` was added, which means §3.4's
  standing advice to the server owner ("if they would rather the cap be shown, it
  belongs in `PUBLIC_BY_DESIGN` and the client gains a render") has **already been
  taken**. Do not "restore" the two-entry pin.
- `packages/server/test/secret-state.test.ts` pins the engine's `Choice` union at
  **three** places, not one: `:1780` (the union and `CHOICE_KINDS` are equal),
  `:1790` (`CHOICE_KINDS` may only classify `['resources','pegs','players','zones']`),
  and `:1794` (no corpus `CardID` may appear in any `PendingChoice` either corpus
  reaches). `KNOWN-GAPS.md` §3.4 names only `:1780`. **A new `Choice` kind has to
  move all three at once**, which changes the price of every unit below that needs
  one.
- `docs/rules-reference.md` §"Auction (p12, p34)" says *"the 16 `Action` variants
  have no representation for an outstanding obligation"*. `packages/engine/src/actions.ts`
  declares **18**, because `RESPOND_INTERRUPT` and `PASS_INTERRUPT` landed after
  that text was written. The *argument* the paragraph makes is unaffected; the
  count a reader checks is wrong.

---

## 1. The verdicts

| gap | prior ruling | this ruling | cards moved by the sub-mechanism that ships |
|---|---|---|---|
| **G12** timed-pass | (c), blocked | **PARTIAL** | **0** — buys back one named clause of 2 cards |
| **G13** five phase ops | 3 of 5 ruled out of scope | **UPHOLD THE REFUSAL**, with the reason restated and one correction | **0** |
| **G17** deck search / `choose-card` | refused at the type level | **PARTIAL** | **1** (SELECTIVE ACCESS MEMORY) |
| **G20** card movement | partly landed | **PARTIAL** | **0** on its own; the substrate is what pays |

**The card counts the brief states are right, and they are not counts of
inexpressible cards.** G20 "blocks 8" is 8 cards blocked *in whole or in part* —
five of which currently report PLAYED with named drops. Measured, G20 is the
**first gap named on 0 inexpressible cards**, because the probe writes its own
reduction and `A COWARD OR A JOURNALIST?` / `CARD GAMES` already play their
adapted reduction. The reconciliation is in §6.

Of the 14 currently inexpressible cards, **six** are in these four gaps' scope:
`A CALL FROM KARACHI`, `NEXT BILLION DATA POINTS`, `QUANTUM WRISTBAND` (G13);
`BLESSINGS OF PARENTS PAST`, `FUELLING THE NEWS` (G17); `HIGGS MORON` (G12). The
other eight are G18 (3), G11 (2), G4 (1), G1/G14 (1), G15/G22 (1), and one card
with no recoverable effect.

### 1.1 G12 — PARTIAL

**The prior framing treated G12 as one gap. It is two, and they have opposite
answers.**

The ask, verbatim (`KNOWN-GAPS.md` §2 G12): *"an owner on the card, a `GameState`
queue of in-flight cards, and a 'does this player have a card to pass?' gate in the
turn state machine."*

**The owner and the queue already exist.** `PlayerState.ideologyCards` is a
per-player, ordered, hidden queue of Ideology Cards with a named holder, drained
one per turn *in place of that turn's draw* at the single seam in `advanceTurn`
that writes `_pendingCard`. Its visibility, its deadline (the next turn boundary)
and its anti-collision argument are all argued at length on the field in
`state.ts` and tested in `packages/engine/test/card-transfer.test.ts`. **CORRECTION
(2026-10-04): this is one third shipped, not two.** `ideologyCards` is per-player and
hidden from every viewer including its holder, and it drains at **its owner's own turn
boundary** in place of that owner's draw. That is a **hand with a deadline**, not a shared
in-flight queue addressed by seat: there is no shared `GameState` queue, no position in a
turn order, and no cross-player visibility, so the second third (the queue) and the third
(the gate) are both still missing. What shipped is the holder and the drain.

**What is missing is a `from:` designation, and it is six lines.** `move-card` gains
`from: 'held-received'`, meaning the most recently arrived entry of the resolved
player's `ideologyCards`. No new field is required: `ideologyCards` is append-ordered
and `move-card` is its only writer, so "the card you just received" is
`arr[arr.length - 1]` and the designation is already written down.

**Clause it buys back:** `A COWARD OR A JOURNALIST?` / `CARD GAMES`'s fifth named
drop — *"you may pass along a card you just received"*. On both cards' `text` and
`source` today, on the probe row, and in `decks/SOURCES.md`.

**Cards moved: 0, and that is not an estimate.** That clause lives inside *"starting
from you, **each** player can donate 1 of their Ideology Cards"*, and `applyEffect`
computes ONE `EffectTarget` for a whole effect list, so the N-iteration is blocked on
the single-target rule — G4/G-new territory, not on G12. `held-received` converts a
refusal into a named dependency. That is what six lines buys.

**What does NOT ship, and why:**

1. **The "does this player have a card to pass?" gate.** It is a pass protocol, and
   its only consumer in 54 recovered cards is `HIGGS MORON` — which needs G10 (tokens
   discarded on a card, a counter that outlives its resolution) and a failure
   obligation on a *named seat* before a pass gate has anything to pass. A gate with
   zero consumers is a new `Action`, a new phase condition and a new class of stall
   in exchange for nothing.
2. **`from: 'hand'` as a choice.** Refused permanently. A held Ideology Card is hidden
   from its own holder by ruling, so enumerating the holder's hand is a §2bis
   violation *against the holder*. See §3.4 for the one form of this the brief should
   expect a proposal for and the reason to refuse it.
3. **A deadline field on a held card.** The deadline is the turn boundary and the turn
   boundary is where the hand drains. A second definition of the same deadline is the
   `capOverride.expiresTurn` / `usesLeft` bug this codebase has already written twice.

### 1.2 G13 — UPHOLD THE REFUSAL

All three of `auction`, `vote` and `pass-card`. The prior ruling's reasoning was that
none of the three buys a card on its own. That arithmetic is **still correct**, and
each op is cheaper to state than to re-derive.

**`auction`.** `docs/rules-reference.md` p12/p34 is a rules *system*: a bidder commits
up to their resource cap **without holding the resources**, settles on an IOU token
held by the seller, and cannot make purchases until it is paid. That needs
`PlayerState.debts` — a field that persists, expires, reaches the client payload and
is consulted by `INFLUENCE` and `BUY_CONSPIRACY` — plus a **cap ruling** (p12 checks
the cap before any other action, and a bidder at their cap bidding resources they do
not hold is in direct tension with that; that is a rules decision, not an
implementation), plus negative-resource support in `canAfford` / `enforceCap` /
`overCap` / `poolTotal` and in the balance checker's proxy, plus four new actions and
a second window protocol. Its two real cards are `A CALL FROM KARACHI` (also G17 and
G20) and `QUANTUM WRISTBAND` (also a **Headline draw pile that does not exist** —
headlines are a `headlineQueue`, not a hand — plus a deck-search override, plus G20).
**To overturn: a `PlayerState.debts` field, a cap ruling, a resource layer that
tolerates negatives, four actions and a second window protocol, for zero playable
cards at the end of it.**

**`vote`.** `NEXT BILLION DATA POINTS` needs a ballot, a no-self-vote rule, and a
re-vote-on-tie loop. The re-vote is a genuine termination hazard and §4's refusal
stands verbatim: two opponents who always tie is a table that never finishes. The
payoff — *"the next Conspiracy Card in the draw pile is up for grabs"*, handed to a
chosen player — is G20 card movement plus a G17 deal. **A ballot without the payoff is
half a system.** To overturn: a ballot `PlayerState`, a tie-break that is not a loop,
and the G20/G17 payoff underneath it.

**`pass-card` has no referent.** It needs something to pass the card *on to*: G12's
queue plus G20's `move-card` plus a destination, and reassigning Ideology Cards breaks
the blind-answer invariant `playerView.ts` tests for — a decision this package may not
take unilaterally. Its three cards are blocked on those anyway.

**THE CORRECTION, and it is the useful part of this section.** The prior ruling's
frame — *"each needs G12/G17/G20 first, so building one means building two mechanisms
to get zero"* — is right about the arithmetic and wrong about the cause. All three are
missing the **same** thing, and it is not a dependency, it is a missing substrate:

> **An auction is a set of lots. A vote is a set of prizes. A pass is a set of objects.
> Every one of them needs a FACE-UP, PUBLIC set to enumerate — and §2bis refuses all
> three for the same reason, which is that the set they would enumerate is hidden.**

That is why building any one of them alone buys nothing: you would be hand-rolling a
private enumeration of a hidden pile, which is the leak. Build the set, and each of the
three becomes a dialog over public data. **Do not build the set for an auction.** Build
it for the three cards that need a choice and no auction — §2 of this document.

### 1.3 G17 — PARTIAL

`KNOWN-GAPS.md` §2bis's ruling is correct and is not re-litigated: `'choose-card'` is
absent from the `Choice` union, the Ideology draw pile and the Ideology discard pile
are **NEVER**, both player hands are **NEVER**, the Headline draw pile is **NEVER**,
and the Voter Card market is the one pile a choice may legitimately enumerate. All
five refusals are **upheld permanently**.

**What ships: the `choose-card` kind, plus one server-side projection that makes
exactly one of the refused piles enumerable.**

- `packages/server/src/broadcast.ts` gains a projection derived from
  `_conspiracyDiscard`: the **ordered** list of Conspiracy Cards played so far.
  Name it `conspiracyRecycle`, do not name it after the field it reads, and build it
  in `broadcast.ts` — `scripts/check-secrets.mjs` scans `packages/server/**` only, so
  the engine's `playerView.ts` may read the pile freely, but the *name* may appear
  nowhere in the server except `broadcast.ts`, `secret-inventory.ts`,
  `secret-state.test.ts`, `hostile-input.test.ts`, `reconnect.test.ts` and the script.
- `CHOICE_KINDS` gains `'choose-card': 'public-cards'`.
- **The third assertion is the one that decides whether this is honest.**
  `secret-state.test.ts:1794` walks every decision either corpus can raise and asserts
  that **no corpus `CardID` appears in any `PendingChoice`**. That test passes today
  only because no shipped card ever raises a card choice. It is written *specifically*
  to catch this change. Narrow it from "no `CardID`" to "no `CardID` from a pile that
  is not public at the moment the decision is raised", and **derive the pile list from
  the engine's own `GameState` declaration rather than typing four names into a test** —
  the same source-slicing trick `reducer-parity.test.ts` already runs on `applyEffect`
  and `fireTriggers`.
- `public-payload.test.ts:447` validates each `PUBLIC_BY_DESIGN` path against
  `/^(players\[\]\.|liveEffects)/`. A top-level `conspiracyRecycle` **fails that
  regex**. Either the server owner extends the regex or the projection is not listed.
  Do not bend the regex to fit the field; that regex is a guard, and a guard bent once
  is a guard deleted.

**Why the projection is safe, stated as a testable derivation and not as an assurance.**
`setup.ts` writes every discard pile empty, and `_conspiracyDiscard` has exactly three
writers in the whole engine: **[SUPERSEDED 2026-10-04 — the "3" was counting a ternary in a
conditional expression. The true figure is four assignment sites reached by six write paths,
and the departures were SILENT, which made the derivation below false in 13% of real states.
The mechanism was then fixed by announcing them (`Picked "NAME"`), which made the derivation
EQUALITY rather than containment and therefore true. Read §0bis; the table below is the
argument as it was written.]**

| writer | silent? | on the public log? |
|---|---|---|
| `PLAY_CONSPIRACY` → `discardTo(s, 'conspiracy', …)` (`reduce.ts:2721`) | no — `log(s, { text: `Played "${card.name}"` })` | **yes**, by name, with the player |
| `RESPOND_INTERRUPT` → `discardTo(s, 'conspiracy', …)` (`reduce.ts:2926`) | no — same log line | **yes** |
| `draw()`'s reshuffle (`reduce.ts:201`, sets the discard to `[]`) | yes | **partly — and this is the case to test** |

The reshuffle is the one that needs an argument rather than a name. It fires only when
`_conspiracyDraw` is empty, and **`deckSizes.conspiracy` is already published**, so the
reshuffle instant is a public event; and because it *empties* the discard, the
projection is `[]` across it and nothing about the post-reshuffle order — which is
seed-derived — is ever published. **So: the published list is empty, or it is the
concatenation of the logged plays since the last publicly observable reshuffle.** That
is a complete derivation from the public log plus `deckSizes`, and it is the test:
replay the corpus, split the action log on reshuffle boundaries, and assert equality
with the payload.

**Card: SELECTIVE ACCESS MEMORY — 1, and it is `adapted`, NOT `verbatim`.**
REF §4.2.1 is *"Pick any Conspiracy Card from the discard pile. It can be in any order
from the discard pile."* The whole card is the choice. Today's probe row
(`draw-conspiracy n:1 from:'discard'`) is *"any card, top only"* — the honest subset,
`adapted`. With `pick` it is the printed text with **no clause dropped**.

**The clause this paragraph originally drew is a false one, and it is corrected here rather
than left to be re-derived:** it said *"the corpus's standing 0 verbatim count becomes 1.
Say that out loud in the commit rather than letting it read as a rule that moved."* **It did
not, and the count is still 0.** Executing every clause is a different property from
reproducing the text, which is the same argument §1 of `decks/SOURCES.md` makes about
BLOCK and DEFLECT and about `IF YOU LIKE PIÑA COLADA` — a card that drops nothing and stays
`adapted`, because a Conspiracy Card also needs a `cost` the recovered text does not print.
**Say that out loud instead: the corpus was 151 cards, 0 `verbatim`, 41 `adapted`, 110
`inferred`, and this card moved one clause from dropped to executed.**
*(⚠ 151 was the count when this was written. The corpus is **222 cards** today — 0
`verbatim`, 45 `adapted`, 177 `inferred`, of which 134 are Ideology Cards — counted off
`decks/**/*.json`; see `decks/SOURCES.md` §3 and §7. **The `0 verbatim` count is the
load-bearing half of this sentence and it has never moved**.)*

**Two design calls this ruling makes, because they are cheaper than the alternatives:**

1. **`draw-conspiracy` gains `pick?: boolean` and `to?: 'hand' | 'discard'`.** Not a new
   `draw-card` op. `draw-conspiracy from:'discard'` already ships
   (`selective-access-memory`'s probe row, `AS CLEAR AS WATER`'s sibling), so `pick`
   absent is byte-identical to today and the non-picking branch is already consumed by
   a real card. **This is what `to:'discard'` is** — G20's `to:'discard'` arrives
   inside G17's op rather than as a widening of `move-card`, which removes the
   `move-card` hunk from this unit entirely. That is the collision-avoidance decision
   in §2.4.
2. **A new `ComputedSource` member, `{ of: 'revealed-card' }`**, so `n` can be read off
   a revealed card's own printed value. `ComputedSource` today is a union of
   *player-state* reads (`'your-pool'`, `'held-of-each-resource'`, `'volatile-voters'`,
   `'your-gerrymander-rights'`, `'ideologue-level'`) and this is the first read off a
   *card*. It is public by construction, so it costs nothing on the secrecy side, and
   `executable.ts`'s `EXECUTABLE_COMPUTED_SOURCES` re-derives the set from `reduce.ts`'s
   own text, so the union cannot grow without a matching case.

### 1.4 G20 — PARTIAL

**The op landed. Four of its six destination shapes are still refused at the type level
and every one of the refusals is upheld.** The sub-mechanism that ships is one
designation, and the finding underneath it is that G20 is blocked on *naming a card*,
not on moving one.

**Ships: `from: 'held-received'`.** As in §1.1. It is a deterministic designation — the
top of a hidden queue, read the way `onlyIfEmpty` reads a hand and `move-card
from:'draw'` reads a pile — and §2bis's line, stated in the ledger's own words, admits
it: *"you may choose a card the whole table can already see, or the top of a pile
nobody can see; you may never be shown what is in a pile."* Silent: no `LogEntry`, no
`GameEvent`, on either path, and the payload is **byte-identical** before and after,
which is the assertion `packages/cards/test/card-playback.test.ts` already makes for
the shipped transfers.

**Ships: `to: 'discard'`** — on `draw-conspiracy`, per §1.3's design call, not on
`move-card`. Zero cards today; it is the destination `A CALL FROM KARACHI`'s *"shuffle
the other 2 back in the deck"* needs, and it is the only way a recycled card can leave
the recycle loop.

**UPHELD, permanently, and each for its own reason:**

| refused shape | why | cost to overturn |
|---|---|---|
| `from: 'hand'` (as a choice) | the holder cannot enumerate their own hidden hand — that is `PRIVATE_PLAYER_KEYS` with no `pid === viewer` branch, on purpose | publish a held hand. Destroys the blind answer. Not a price, a different game |
| `from: 'discard'` (Ideology) | the top is the most recently **ANSWERED** card and p13 makes an answered card face up under its mat, so handing one over blind *publishes the answer* | the engine's own game-loop test caught this on its first run |
| `from: 'pending'` | would tell a mid-answer player the card exists, offer a look at it by proxy, and empty `_pendingCard` into a soft-lock where `ANSWER` and `END_TURN` are both illegal | rewrite the answer window. Not worth one card |
| `to: 'pending'` | `_pendingCard` is written exactly once per turn by the boundary; a card effect writing it can change what a player is being asked, and every client can observe the change | a second writer for the answer window |
| `to: 'manifesto'` | there is no third category. A card is either face down in a hand or face up under a mat having been answered | a third category, i.e. a new rule, not a new field |
| a Conspiracy destination on `move-card` | **not refused on security** — a Conspiracy Card is bought and held and never answered face up, so the `move-card` reasoning runs the other way. Refused because **no card asks for it**: `GOOD GIG WELL PLAYED`'s two gifts need a *designation* among three drawn cards, which is a §2bis question, not a movement | build U2 (§4 step 2), which supplies exactly that |

**`to: 'destroy'` ships with no card, and that is upheld.** It is exercised by the
destruction-leak tests and pinned by them, which is a real function. Inventing a card to
consume an op is the one move this document rules out by name in §5.

---

## 2. The dependency graph

### 2.1 The units

| unit | mechanism | new `GameState`/`PlayerState` field | new `Choice` kind | new `Action` |
|---|---|---|---|---|
| **U1** | `ClientState.conspiracyRecycle` + `draw-conspiracy { pick?, to? }` + `choose-card` | no | **yes** | no |
| **U2** | `GameState.revealedCards` + `{ op: 'reveal' }` + `move-card { from: 'revealed' }` | **yes, one** | no (rides U1's kind) | no |
| **U3** | `voters { sameZone?: true }` + `ComputedSource 'revealed-card'` | no | no | no |
| **U4** | `move-card { from: 'held-received' }` | no | no | no |
| **U5** | `Interrupt.op: 'auction' \| 'vote' \| 'pass-card'` | `PlayerState.debts` + a phase | (several) | 4–6 |
| **U6** | the G12 pass gate | a queue + a phase | no | 1 |

### 2.2 The true partial order

```
        U1 ─────────────► SELECTIVE ACCESS MEMORY            (1 card, adapted, 0 clauses dropped)
         │
         ├──────────────► U2 ──► U3 ──► BLESSINGS OF PARENTS PAST  (1 card, 3 of 4 clauses)
         │                   └────►   GOOD GIG WELL PLAYED        (5 of 6 clauses)
         │
         └──────────────► (A CALL FROM KARACHI: first sentence only; the auction stays refused)

        U4 ─────────────► nothing yet; 1 named clause of 2 cards becomes reachable
                          (A COWARD OR A JOURNALIST?, CARD GAMES) once the N-iteration lands

        U5 ── not built. Nothing depends on it.
        U6 ── not built. Its only consumer is HIGGS MORON, which needs G10 first.
```

Read as relations:

- **U1 ⟂ U2.** They are independent. U2's `reveal` takes the **top** of a draw pile and
  so needs no `Choice` kind of its own; U1's `choose-card` resolves against the
  published recycle list and needs no revealed set. **BLESSINGS OF PARENTS PAST needs
  both, plus U3** — it is the only card on the critical path that needs two units, and
  it is therefore the only one that cannot be landed by either engineer alone.
- **U3 depends on U2**, because `'revealed-card'` reads a revealed set.
- **U4 is a leaf.** It depends on nothing and nothing depends on it.
- **U5 would depend on U1 or U2** — an auction enumerates lots, a vote enumerates a
  prize — which is the correction in §1.2 stated as a graph edge. It is not built, so
  the edge is drawn dashed and nothing waits on it.
- **U6 does not depend on U4**, which is the finding: the queue already exists, so the
  gate was never gated on anything. It depends on **G10**, which is out of scope here.
- The brief's stated edges **do not hold as stated, and the corrections matter**:
  *"G20's `from:'pending'` needs G12's queue"* is **false** — `from:'pending'` is refused
  on three independent reasons (mid-answer disclosure, look-by-proxy, `_pendingCard`
  soft-lock) and G12's queue removes none of them; G12 would not unblock it.
  *"G12's remaining half needs G20"* is **true but not load-bearing** — U4 needs
  `move-card`, which already exists; it does not need G20's refused shapes.

### 2.3 What is genuinely independent

**U1 ∥ U2 ∥ U4.** Three mechanisms, no shared file. Any two can be built concurrently
by different engineers; §2.4 says at most two, and why.

### 2.4 The collision map on `packages/engine/src/{cards,state,reduce}.ts`

The brief asks specifically what collides. It is not the files; it is the hunks.

| file | U1 | U2 | U4 | collides? |
|---|---|---|---|---|
| `cards.ts` | `draw-conspiracy` union arm | `move-card.from` union, **new** `{ op: 'reveal' }` arm | `move-card.from` union | **U2 ∧ U4**, one line, same union |
| `state.ts` | one `Choice` arm | `RevealedCard` type + one `GameState` field + `ideologyCards` docstring | comment on `move-card` | **U2 ∧ U4**, adjacent blocks |
| `reduce.ts` | `applyEffect` case edit on `draw-conspiracy`; `resolveChoice` case; `resolveCount` case | **new `applyEffect` case**; `advanceTurn` backstop; `syncConspiracyTop` | **`applyEffect` `move-card` case**, the hottest hunk in the repo | **U2 ∧ U4**; U1 is clear of it |

**The decisive constraint is not the union. It is `reducer-parity.test.ts`.**
`packages/cards/src/executable.ts` re-derives `EXECUTED_OPS` by **slicing `applyEffect`'s
body between `case '` marks** and reading each slice for the fields that case touches.
Any new `case` moves the slice boundaries for the case after it. So two engineers adding
`applyEffect` cases concurrently will produce a `reducer-parity` failure that is **not a
bug and not a merge conflict** — it is a registry that was derived from a moved
boundary. Both of them will chase it.

**Ruling on sequencing, and it is a ruling about people rather than about code:**

> **U1 and U2 may run concurrently. U4 runs after both, or goes to whoever is not
> holding `move-card`.** Two engineers maximum. U3 is a two-line follow-on to U2 and
> belongs to whoever shipped U2.

---

## 3. The security contract every unit must honour

### 3.1 The rule, one sentence

> **A mechanism may READ a hidden set only by committing to one member of it before
> anything is published, and may never place that set's CONTENTS in any value that
> reaches a client.**

The commitment is what makes a hidden read safe: `take(pile, 0)`, `take(pile, len-1)`,
`pile.length > 0`, `pile.filter(p).length` — a value that is already determined by the
world, published as nothing. The enumeration is unsafe because the option list **is**
the disclosure.

**The line, in the ledger's own words, because it is already correct:** *"you may choose
a card the whole table can already see, or the top of a pile nobody can see; you may
never be shown what is in a pile."*

| | permitted | forbidden |
|---|---|---|
| a hidden pile | the top, the bottom, the length, a boolean | the list, in a `Choice`, in a `LogEntry`, in a `GameEvent` |
| a hidden hand | `onlyIfEmpty`, `to: 'destroy'` (which reads nothing) | the list, **including to its own owner** |
| a *derived* order | a list derivable from the public log and `deckSizes` (U1) | a list derivable from `_seed` |

### 3.2 Where the precedents sit, and which one each unit is

| unit | precedent it is the same shape as | what it must assert |
|---|---|---|
| **U1** | **none — this is a new class.** Every existing precedent takes the top of a hidden set. U1 publishes an *ordering* of a `_` pile | the published list equals the log replay (§1.3); `_conspiracyDiscard` has exactly three writers *(2026-10-04: **four assignment sites, six write paths** — see §0bis)* and the test finds them by slicing `reduce.ts`, the way `reducer-parity.test.ts` does; the list is `[]` across a reshuffle; `_seed` is untouched and stays in `SECRET_NAMES` — because after a reshuffle the *new* draw order is `shuffle(discard, _seed)`, and publishing it would publish the seed |
| **U2** | `LiveEffect.sourceCardId`: public because the card that created it is already face up on the discard | `revealedCards` is `[]` in every state outside a resolution; every entry is a card this game drew; the payload is byte-identical before and after the resolution clears it |
| **U3** | none — no new field, no new kind | `sameZone: true` groups place into one zone, which p10 already clamps in `placeableAreas` |
| **U4** | `onlyIfEmpty` exactly: reads a hand nobody at the table can see and emits nothing | payload byte-identical before and after; no `LogEntry`, no `GameEvent`; `ideologyCards` was already stripped for every viewer so nothing new is on the wire |

### 3.3 The two pins, and what each unit owes them

**`ServerOnlyKeys` — eleven `_` keys, pinned in
`packages/engine/src/playerView.ts`, and no unit may add a twelfth.**

- U1, U3, U4 add **no** `_` field. `conspiracyRecycle` is a derived member of the
  `ClientState` intersection beside `deckSizes` and `awaitingAnswer`. **`deckSizes`'
  own docstring says "Never contents" and that becomes false for its block** — edit the
  docstring in the same commit, because a docstring that lies is the exact failure
  `playerView.test.ts` was written to make impossible.
- U2 adds `revealedCards`, **unprefixed and public**, on the `LiveEffect` argument: it
  is a set of cards the printed rules put face up. No `PRIVATE_PLAYER_KEYS` entry, no
  `_` key, and `secret-inventory.ts` owes nothing — which is the condition for U2 being
  cheap, and the reason it must not grow into a queue (see §4.1 of the termination
  contract).

**`CHOICE_KINDS` — pinned exactly-equal to the engine's `Choice` union, at three places
in `packages/server/test/secret-state.test.ts`.** U1 moves all three or none:

| line | assertion | what U1 does |
|---|---|---|
| `:1780` | the engine's union and `CHOICE_KINDS` are equal | adds `'choose-card'` |
| `:1790` | a kind may only classify `['resources','pegs','players','zones']` | adds `'public-cards'` and the derivation beside it |
| `:1794` | no corpus `CardID` may appear in any `PendingChoice` either corpus reaches | **narrows** to "no `CardID` from a pile that is not public when the decision is raised", with the pile list derived from `GameState` and not typed |

**`PUBLIC_BY_DESIGN` — pinned to exactly `['capOverride','liveEffects','restrictions']`,
with a path regex `/^(players\[\]\.|liveEffects)/`.** U1's projection is a top-level
field and **fails that regex**. This is the server owner's decision and it is named
here rather than absorbed: either the regex gains a top-level alternative, or
`conspiracyRecycle` is not listed. A client must be able to *act* on the recycle list —
SELECTIVE ACCESS MEMORY renders a picker over it — so the honest answer is to extend
the regex, and the dishonest one is to bend the regex until a new field fits.

### 3.4 The refusal that will be proposed, and the reason to refuse it

Someone will propose letting `from: 'hand'` enumerate **the chooser's own**
`ideologyCards`. `PRIVATE_PLAYER_KEYS` strips that list for every viewer with no
`pid === viewer` branch, and the comment on that branch says why in as many words:
*"adding one is the R1 bug in a plausible-looking form."* A viewer-scoped exception for
the holder would hand the holder the identity of a card whose blind answer they are
about to give. **Permanent refusal, and it is not a secrecy precaution that can be
traded for convenience: it is the mechanic.** The one form that is legal is
`from: 'held-received'` — a *designation*, not a selection — because a commitment to one
member discloses nothing about the other members.

---

## 4. The termination contract

`KNOWN-GAPS.md` §4 refuses cascades on principle: *"two opponents who always tie is a
table that never finishes."* Existing bounds are `TRIGGER_MAX_WAVES = 16` and
`IDEOLOGY_HAND_MAX = 2`. Neither covers any of the four units, and for two of them that
is the whole design.

| unit | the bound | rules claim or safety bound | why |
|---|---|---|---|
| **U1** | the published list's length, which is the shipped Conspiracy deck's discarding, and **raising nothing when the list is empty** | **rules claim.** A player may only pick from the discard pile; an empty discard is not a decision | same shape as `'chosen-zone'`, which raises nothing rather than raising an unanswerable decision. Asserted: the empty pile raises no `PendingChoice` |
| **U1** (cascade) | `TRIGGER_MAX_WAVES` | **safety bound**, unused | a `choose-card` is not a trigger, and a pick cannot re-raise one. Assert it stays unused rather than assuming it |
| **U2** | **resolution scope.** `revealedCards` is cleared by the end of the action that created it, and `advanceTurn` empties it as a backstop | **safety bound**, not a rules claim — p10 has no such field | `IDEOLOGY_HAND_MAX` does **not** cover it: a revealed set is a new container, not a hand, and `TRIGGER_MAX_WAVES` is per firing event, so one reveal per turn is a slow leak rather than a hang. That is exactly the argument §2 G20 made for `IDEOLOGY_HAND_MAX` and it applies verbatim here. Asserted: a driven 60-turn game at 2/3/4/5 seats leaves the set empty at every step, and an interrupted resolution cannot leave one behind |
| **U3** | none needed | — | `sameZone` is a flag. Its constraint runs the other way: p10 makes a Voter Card group unsplittable, so `placeableAreas` already clamps it |
| **U4** | `IDEOLOGY_HAND_MAX = 2`, checked **before** the card leaves the pile | **safety bound**, already tested | a move out of one hand into another cannot exceed 2 on the receiving hand, because the check at `reduce.ts:1546` runs before the write. Reused unchanged, and this is the one unit that inherits a bound rather than needing one |
| **U5** (not built) | the re-vote loop has none | — | §4's refusal stands. A tie-break that is not a loop is a different card |
| **U6** (not built) | none | — | the gate's deadline is the turn boundary and the boundary is where the queue drains; that is the argument, and there is no corpus card to test it against |

---

## 5. Sequenced plan

### Step 1 — U1: a choice over a public set. **SELECTIVE ACCESS MEMORY, `adapted`, no clause dropped — NOT `verbatim`.**

*Does not touch `move-card`.* The `draw-conspiracy { pick?, to? }` widening keeps this
unit clear of the hunk U2 and U4 both want.

**Files**
- `packages/engine/src/cards.ts` — `draw-conspiracy` gains `pick?: boolean` and `to?: 'hand' | 'discard'`; `ComputedSource` gains `{ of: 'revealed-card' }`.
- `packages/engine/src/playerView.ts` — `ClientState` gains `conspiracyRecycle`; **`deckSizes`' docstring corrected in the same commit.**
- `packages/engine/src/state.ts` — the `choose-card` arm, with the §2bis test quoted on it and the refusals named.
- `packages/engine/src/actions.ts` — `ChoicePick` gains `{ kind: 'card'; cardId: CardID }`.
- `packages/engine/src/reduce.ts` — `applyEffect`'s `draw-conspiracy` case; `resolveChoice`'s `choose-card` case; `resolveCount`'s `'revealed-card'` case; `resolveCard`'s closing so a window staged behind a pick resumes correctly.
- `packages/server/src/broadcast.ts` — the `conspiracyRecycle` projection.
- `packages/server/test/secret-inventory.ts` — `CHOICE_KINDS` `'public-cards'`; the `PUBLIC_BY_DESIGN` entry.
- `packages/server/test/secret-state.test.ts` — **`:1790` widened, `:1794` narrowed and derived.**
- `packages/server/test/public-payload.test.ts` — the path regex.
- `packages/client/src/app/derive.ts` — two `switch` arms plus the picker dialog (`assertNever` turns the rest into a compile error, which is the point).
- `packages/cards/schema/card.schema.json`, `src/executable.ts`, `src/balance.ts`, `scripts/playable.ts`, `decks/et2040/conspiracy.json`, `decks/SOURCES.md`.

**Tests that must be added**
- `packages/engine/test/card-transfer.test.ts` (extend) — a pick over the recycle list; an empty list raises **no** decision; a pick cannot re-raise a decision; a `to:'discard'` reinsert leaves the list one shorter and the deck one longer.
- `packages/engine/test/playerView.test.ts` (extend) — `conspiracyRecycle` is present for every viewer including a spectator; it is `[]` when the discard is; `_seed` is absent.
- `packages/server/test/secret-state.test.ts` (extend) — **the derivation test**: replay the corpus, split the action log on `_conspiracyDraw`-empty boundaries, assert the payload equals the reconstruction. Plus a source-slice assertion that `_conspiracyDiscard` has exactly three writers *(2026-10-04: **four assignment sites, six write paths** — see §0bis)* and that no seventh can appear without failing.
- `packages/cards/test/reducer-parity.test.ts` — no edit needed; it re-derives the registry and must stay green, which is the acceptance test for the new fields.
- `packages/cards/test/card-playback.test.ts` — the shipped card, end to end.

**Acceptance**
- `npm run playable` **40 → 41**, measured by playing. **DISPROVEN 2026-10-04: the true
  outcome is 40 → 40.** SELECTIVE ACCESS MEMORY already reported PLAYED at HEAD via
  deterministic top-of-pile, so the probe's verdict was already positive.
- `SELECTIVE ACCESS MEMORY` ships, and the commit says out loud that the card moved **one
  clause from dropped to executed** and that the corpus's **0 `verbatim`** count is
  **unchanged** — because the clause is paraphrased into schema ops and a Conspiracy Card
  also needs a `cost` the recovered text does not print. **The original wording of this
  criterion ("the 0 verbatim count is now 1, because the card has nothing dropped") was
  wrong; "nothing dropped" is not "text reproduced".**
- `npm test` 1251 → green at ≥1258; `npm run typecheck` clean in all four packages including the client (the client's two `derive.ts` switches and `interrupt.ts:251` are compile errors until they land — that is the gate working).
- The three `secret-state.test.ts` assertions move **together**; any one of them left red fails the step.

### Step 2 — U2 + U3: a face-up set a resolution may choose from. **BLESSINGS OF PARENTS PAST, GOOD GIG WELL PLAYED.**

Independent of step 1 and may run beside it.

**Files**
- `packages/engine/src/state.ts` — `RevealedCard`; `GameState.revealedCards`.
- `packages/engine/src/cards.ts` — `{ op: 'reveal'; kind: 'conspiracy' | 'voter' | 'headline'; n: Count }`; `move-card` gains `from: 'revealed'`; `voters` gains `sameZone?: boolean`.
- `packages/engine/src/reduce.ts` — the `reveal` case; the `move-card` `from:'revealed'` branch; `advanceTurn`'s backstop clear; the `resolveCount` case for `'revealed-card'` if step 1 has not landed it (coordinate: **one** owner).
- `packages/server/test/secret-inventory.ts` — nothing. This is the condition that makes U2 cheap and it must stay true: `revealedCards` is unprefixed and public.

**Tests**
- `packages/engine/test/live-effects.test.ts`-style structural test: `revealedCards` is `[]` in every state outside a resolution, and a live effect never names a card from a revealed set that has been cleared.
- A driven 60-turn game at 2/3/4/5 seats asserting at every step that some action succeeds **and** `revealedCards` is empty or the current action created it.
- An interrupted-resolution case: a window opens behind a `reveal`, the reveal is cleared, and the resumed resolution finds no stale set.
- `packages/cards/test/recovered-cards.test.ts` — BLESSINGS end to end, including that the opponent's placement order is the named drop.

**Acceptance**
- `npm run playable` **41 → 42** (BLESSINGS), with its third and fourth clauses named as drops on the card's `text` and `source`.
- GOOD GIG WELL PLAYED's probe row goes from 1 of 3 clauses to 5 of 6, and the probe row says which clause is still dropped and why.
- `revealedCards` empty after every resolution, asserted on every state three corpora reach.

### Step 3 — U4: `from: 'held-received'`. **0 cards, 1 clause.**

Runs after step 2, or goes to whoever is not holding `move-card`.

**Files** — `cards.ts` (`move-card.from` union + its contract comment), `reduce.ts`
(the `move-card` branch), `KNOWN-GAPS.md` §2 G12 and §3.3 (the row is now wrong and
says the gate is upheld).

**Tests** — `card-transfer.test.ts`: payload byte-identical before and after; no
`LogEntry`, no `GameEvent`, no id anywhere in the serialised payload; `IDEOLOGY_HAND_MAX`
still refuses the third arrival; a 2-seat table where the caster holds nothing
resolves to nothing rather than raising anything.

**Acceptance** — `npm run playable` **unchanged at 42**, and the two cards' `source`
fields change from *"refused at the type level"* to *"expressible; waiting on the
N-iteration"*. That text change is the deliverable.

### Not in this plan

- **U5** (§1.2), **U6** (§1.1), `PlayerState.debts`, and every `move-card` refusal in
  §1.4's table. Upheld, with the cost stated.

---

## 6. What this document explicitly recommends NOT building

Named, with the reason, because "we did not build it" is indistinguishable from
"nobody thought of it" — which is how this ledger already carries two wrong gap labels
(G14a for POLO RETREAT and DEEP THOUGHTS, and G20 for CULT-IVATING OBEDIENCE).

1. **`Interrupt.op: 'auction'`.** §1.2. A `PlayerState.debts` field, a cap ruling, a
   resource layer that tolerates negative pools, four actions, a second window
   protocol, **zero cards**. The resource layer is the part I would refuse
   speculatively: `canAfford`, `enforceCap`, `overCap` and `poolTotal` are read by every
   rule in the game, and making them tolerate negatives to serve an op no card uses is
   the most expensive single change available in this repository.
2. **`Interrupt.op: 'vote'`.** §1.2. Its re-vote-on-tie is the unbounded-cascade class
   §4 refuses, and its payoff is G20 plus G17. A ballot that pays nothing is half a
   system, and half a system in the `Choice` union is a leak waiting to be exploited.
3. **`Interrupt.op: 'pass-card'`.** §1.2. **No referent.** Not "expensive" — incoherent
   as written, because there is nothing on the other end to pass a card to.
4. **The G12 turn-state-machine pass gate.** §1.1. Zero consumers; its only candidate
   needs G10 and a seat obligation first. Do not add an `Action` with no card behind it.
5. **`from: 'hand'` in any form**, including the owner-scoped variant. §3.4. Permanent,
   and it is the mechanic rather than a precaution.
6. **`from: 'discard'` on Ideology `move-card`.** §1.4. Permanent. It publishes the
   answer to a blind card, and the engine's own game-loop test caught the first draft of
   it on its first run.
7. **`from: 'pending'`, `to: 'pending'`, `to: 'manifesto'`.** §1.4. Permanent. Each
   destroys or rewrites the answer window.
8. **A `'choose-card'` over any of: a player hand, `_ideologyDraw`, `_ideologyDiscard`,
   `_headlineDraw`.** §2bis, upheld. These are the D25 failure by name and this
   document does not reopen them.
9. **A Conspiracy destination on `move-card`.** §1.4. Not refused on security — refused
   on demand. Step 2's `reveal` is what the three cards actually want, and adding the
   movement first would be exactly the half-build §1.2 refuses.
10. **A card for `to: 'destroy'`.** The op is exercised and pinned by
    `card-transfer.test.ts`; inventing a consumer for an op is inventing a card, and §7
    of `KNOWN-GAPS.md` forbids it.
11. **Bending `public-payload.test.ts`'s path regex** to make a top-level public field
    listable without an explicit server-owner decision. §3.3.
12. **Touching `_seed`, `_pendingCard`'s underscore, or `PRIVATE_PLAYER_KEYS`.** No unit
    in this plan needs it, and U1 is safe *only while* `_seed` stays secret — after a
    Conspiracy reshuffle the new draw order is `shuffle(discard, _seed)`.

---

## 7. The counts, reconciled

The brief's counts and the measured counts are both true and they measure different
things. `KNOWN-GAPS.md` §0's three states are the distinction: a card can be
**expressible** and still blocked.

| gap | brief's count | measured: inexpressible | measured: playing with named drops | the difference |
|---|---:|---:|---:|---|
| G12 | 3 | 1 (`HIGGS MORON`) | 2 (`A COWARD`, `CARD GAMES`, 5 and 5 drops) | 2 of the 3 are blocked on the single-target N-iteration, not on G12 |
| G13 | 3 | 3 (`KARACHI`, `BILLION`, `WRISTBAND`) | 0 | none — the three are wholly inexpressible, and two need a third gap besides G13 |
| G17 | 3 | 2 (`BLESSINGS`, `FUELLING THE NEWS`) | 2 (`SELECTIVE ACCESS MEMORY`, `GOOD GIG WELL PLAYED`) | `FUELLING THE NEWS` is also G18: it needs a **Headline draw pile**, and headlines are a `headlineQueue` |
| G20 | 8 | 0 | 5 | `CULT-IVATING OBEDIENCE` is G11 and **no `move-card` reaches it** — the same wrong label §2 G14a already corrected twice |

**The plan's ceiling is `playable` 40 → 42**, plus one card's dropped clauses becoming
expressible, plus one card's clause becoming **executed rather than dropped**. That is two
cards. It is also, on the arithmetic above, **the maximum available without an auction, a
vote, a pass gate, or a pile search** — which is the honest answer to "solve each": two of
these four can be solved, one can be partly solved for one card, and one should not be built.

**Two figures in this section were wrong and are corrected in §0bis.** Step 1 shipped
`playable` **40 → 40**, not 40 → 41, because SELECTIVE ACCESS MEMORY was already PLAYED.
And the ceiling's last term was never a `verbatim` status: the corpus count is **0
`verbatim`** and stays there.