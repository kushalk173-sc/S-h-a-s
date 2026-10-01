# KNOWN GAPS — what the current card schema cannot express

**Written while authoring the first corpus, not as speculation.** Every gap below was
found by trying to write a real card and failing, or by writing a weaker card and
having to record in its `source` field what had been dropped. Each entry names the
real card, quotes the clause that does not fit, and states the *minimal* schema change
it implies. The gap ids are referenced from the `source` field of the affected cards in
`decks/`, so a diff of the corpus points back at the line of this file that explains it.

`REF n` = `docs/AUTHENTIC-SHASN-REFERENCE.md` section n. `RULES pn` =
`docs/rules-reference.md`, Collectors Edition rulebook page n.

**Architect decision honoured:** the schema was NOT changed to make these go away. The
corpus is authored against `packages/engine/src/cards.ts` as it stands. This file is the
evidence for the next iteration.

---

## 0. The numbers

| | count |
|---|---:|
| Recovered X-cards with complete official rules text (REF §4) | **50** |
| …shipped here, with the dropped clause named in `source` (`provenance: adapted`) | **7** |
| …**not shipped at all**, because nothing faithful can be written | **43** |
| Shipped as `inferred` (authored here, register per REF §8.2) | 45 |
| Total cards shipped | 60 |

43 of 50 — **86%** — of the real cards recovered cannot be represented without a schema
change. REF §5.4 predicted "roughly 40%"; the true figure is worse than that, because
the *headline* and *conspiracy* decks are where the exotic effects live and those are the
only two decks we have recovered text for. REF §2.4 records that **zero** ordinary
question Ideology Cards were recovered in full, so the Ideology deck is the one place
where the schema is not the blocker.

Which gaps cost the most cards:

| gap | cards lost |
|---|---:|
| G14 trigger / `when` | 6 |
| G9 `duration` | 6 |
| G5 player restriction | 5 |
| G13 phase-changing ops | 5 |
| G17 deck search | 4 |
| G22 "next turn" scope | 5 |
| G15 dynamic value off own state | 5 |
| G16 zone-scoped operation | 3 |

---

## G0 — the provenance envelope has no home in the engine types

**Card:** every one of the 60.
**Clause:** `"source": "REF 5.1 …"`, `"provenance": "adapted"`.
**Why it doesn't fit:** `IdeologyCard`, `VoterCard`, `ConspiracyCard` and `HeadlineCard`
in `cards.ts` have no `source` or `provenance` field, and the schema sets
`additionalProperties: false` everywhere.
**Minimal change:** add `readonly source?: string; readonly provenance?: Provenance` to
each of the four card types — or, better, hoist them into a shared `CardMeta` the four
types extend. Then `toEngine*Card()` in `src/corpus.ts` becomes a no-op and the
provenance lives where the engine can log it.
**Why it matters:** without it, provenance exists only in the JSON and is stripped
before the engine sees the card, so a runtime bug report cannot say whether the card in
front of a player was recovered or authored.

---

## G1 — no DONATE-to-a-named-player, and no conditional

**Cards:** AIN'T NO CURE FOR LOVE (REF §4.3), MARRIED WITH BITS, ON THE "HIGH" SEAS.
**Clause:** *"Donate 1 of your voters to the player on your left. If you are unable to do
either, ignore this card."*
**Why it doesn't fit:** `EffectTarget` is `'you' | 'each-opponent' | 'everyone' |
'leader'`. There is no "a chosen player", and no "the player whose seat is next to
mine" — which is what `to the player on your left` means, and it is a *seat-relative*
target that changes if the table order changes. Separately, `if you are unable to …,
ignore this card` is a conditional over the whole effect, and `Effect` is a flat list
with no `if`.
**Minimal change:** extend `EffectTarget` with `'chosen-player'` and `'left-of-me'`, and
give the card an optional `condition?: 'if-possible' | 'must'` wrapper rather than
expressing it as a data field.
**Shipped as:** `hl-et2040-003`, first branch only, `provenance: adapted`.

---

## G2 — no iteration per opponent, and no conditional-on-payment

**Card:** A GRAVE INHERITANCE (REF §4.2.1).
**Clause:** *"Every opponent must pay you any 2 resources. Evict 2 voters belonging to
every player who fails to pay you."*
**Why it doesn't fit:** two problems. (a) `steal-any` has no `target` in `cards.ts` — it
is the one op with no target field, so it can only ever hit a single chosen opponent,
never "every opponent". (b) The eviction is **conditional on each opponent's failure to
pay**, which is per-opponent state the reducer has to evaluate. `Effect` has no `if`.
**Minimal change:** give `steal-any` the same `target?: EffectTarget` the other ops have,
and add an `on: 'success' | 'failure'` to the effect so a second effect can be gated on
the first one's outcome.
**Shipped as:** `ct-et2040-001`, reduced to one chosen opponent with the eviction
unconditional. `provenance: adapted`.

---

## G3 — no recurring obligation on a named player

**Cards:** ERADICATING GERMS (REF §4.2.1), THE BIG FREEZE, THE PSYCHOHISTORIAN.
**Clause:** *"Discard an open Voter Card every turn (mandatory)."*
**Why it doesn't fit:** this is a **standing obligation that re-arms every turn**, on a
player, forever. `Effect` is a list resolved once, at resolution time. There is no
`duration` (G9), no `repeat` and no `owner`. `PlayerState` has no field for "must do X at
the start of each turn".
**Minimal change:** `PlayerState` needs an `obligations: readonly Obligation[]` field
where `Obligation = { id, cardId, text, perTurn: 'once' | 'mandatory', scope }`, and the
turn state machine has to check it. This is a `PlayerState` change, not a card change.
**Shipped as:** `ct-et2040-002`, single resolution only. `provenance: adapted`.

---

## G4 — no per-unit scaling (`forEach`)

**Cards:** RED BLOODED, THOUGHTS AND PRAYERS, JUST BREATHE (REF §4.2.1, §4.3).
**Clause:** *"Players receive any 2 resources **for each of their** discarded voters."*
and *"get any 2 resources **for each of their voters inside a Volatile Area**."*
**Why it doesn't fit:** the multiplier is a **quantity of board state belonging to a
specific player in a specific place**, read at resolution time. `Effect` carries a
literal `n`; there is no way to write "2 per X" where X is computed.
**Minimal change:** an optional `per?: { count: 'your-voters' | 'opponent-voters' |
'volatile-voters' | 'voters-in-zone', zone?: ZoneID, multiplyBy: number }` on the op, or a
`forEach` combinator wrapper around an existing op. ARCHITECTURE §6.4.2 step 2 already
proposes generalising `Effect` to `{ op, n?, res?, target?, when?, until?, forEach? }`;
this gap is the concrete reason that `forEach` is not optional.
**Shipped as:** `hl-et2040-002`, fixed pair instead of scaling. `provenance: adapted`.

---

## G5 — no player RESTRICTION (this is a `PlayerState` gap, not a card gap)

**Cards:** KHAKI TERROR, THE FOUR HORSEMEN, THE BIG FREEZE, GENDER TROUBLE, DON'T KISS
THE BABIES, NEW FACE WHO DIS (REF §4.1, §4.3).
**Clause:** *"You cannot make any purchases until you do so."* · *"You cannot use one of
your unlocked Level 3 Ideologue Powers in your next turn."* · *"These voters cannot be
placed into Volatile Areas."*
**Why it doesn't fit:** these do not change a player's **resources**; they remove
**actions** from a player. Every op in the union is a resource or peg delta. The
restriction is a property of the *player*, not of the card, and it may be imposed by an
opponent — so it cannot live on the card either.
**Minimal change:** `PlayerState` needs something like
`restrictions: readonly { kind: 'no-purchases' | 'no-power' | 'no-volatile-placement' |
'surcharge', until: 'this-turn' | 'next-turn' | 'resolved', value?: number, sourceCardId: CardID }[]`,
and every action the reducer exposes has to consult it. This is the single largest piece
of engine work the corpus exposes and it is **not** a schema tweak.
**Shipped as:** `hl-et2040-001`, volatile-exclusion clause dropped entirely.

---

## G6 — no set collection

**Card:** SINGULARITY (REF §4.2.1).
**Clause:** *"Collect and use 3 Singularity cards to permanently unlock any Level 5
Ideologue Power. Singularity ×3 cannot be affected by Reverse/Ditto/Deflect/Block.
There are 4 such cards in the deck."*
**Why it doesn't fit:** the card is a **component of a set**, and the set is a stateful
object (3 of 4 copies held, un-immune, self-deleting on completion). A card is
consumed-and-discarded on play; there is no "kept face-up on the mat as a component",
and no permanent unlock that outlives the card.
**Minimal change:** a `PlayerState.trophies` collection plus a `permanents` list of
unlocked powers, and a card kind that is *not* discarded on play. Non-trivial, but the
minimal version is: `Effect[]` gains `{ op: 'collect'; cardId: CardID; n: number;
then: Effect }` and the reducer moves the card rather than discarding it.
**Shipped as:** `ct-et2040-003`, first branch only (`voters: 2`). `provenance: adapted`.

---

## G7 / G19 — no hidden, unrevealed combo detection

**Card:** THE PSYCHOHISTORIAN (REF §4.2.1).
**Clause:** *"Complete all the following actions in the same turn in any order to get 4
voters … You may reveal this card at any time in your turn. You do not need to announce
this card before taking the actions."*
**Why it doesn't fit:** two distinct gaps. (G7) The card is a **detector** watching the
player's own turn for a 3-action pattern in any order; there is no "if you do A and B
and C this turn" construct. (G19) The card must exist on the table while being
**unrevealed to every other player**, including to the UI — and `state.ts`'s `_`
server-only convention (documented in `playerView.ts`) is the right mechanism but there
is no card-level `secret: true` flag, and the card is in the player's hand where hands
are not currently private.
**Minimal change:** `{ op: 'watch'; for: 'your-turn'; pattern: readonly Op[]; reward: Effect }`
plus `secret?: boolean` on `ConspiracyCard`, and a `_` field on the hand.
**Shipped as:** `ct-et2040-004`, first branch only. `provenance: adapted`.

---

## G8 — `gerrymander` is the one op with no `target`

**Cards:** NEW FACE WHO DIS, SUBMERGED (REF §4.3, §4.1).
**Clause:** *"Starting with you, **every player** can Gerrymander 1 majority or
non-majority voter immediately."*
**Why it doesn't fit:** `voters`, `gain`, `lose`, `gain-any`, `lose-any` all carry
`target?: EffectTarget`. `gerrymander` does not — it is structurally forced onto the
active player. This one was **caught by the validator on the real corpus**, not
predicted: `hl-et2040-001` was written with `target: 'everyone'` and the schema rejected
it with `must NOT have additional properties (unknown property "target")`.
**Minimal change:** add `readonly target?: EffectTarget` to the `gerrymander` variant of
`Effect`. One line.
**Shipped as:** `hl-et2040-001`, affecting the active player only — a materially weaker
card than the real one. `provenance: adapted`.

---

## G9 — no `duration`. **The single highest-value fix.**

**Cards:** PYTHONPOST, SNOOP B-O-DOUBLE-T, THE BIG FREEZE, GROWING DISSENT, DON'T KISS
THE BABIES, KHAKI TERROR, ON THE "HIGH" SEAS (REF §4.1, §4.3).
**Clause:** *"**For the rest of the game**, you have to pay an extra resource for every
Conspiracy Card that you buy."*
**Why it doesn't fit:** `ConspiracyCard` and `HeadlineCard` are resolved once and
discarded. A persistent effect has nowhere to live: no expiry, no re-application, no
"rest of game" scope. REF §4.4 item 1 identifies this as the largest single gap and the
analysis agrees — it is also the cheapest.
**Minimal change:** `ConspiracyCard` and `HeadlineCard` both gain
`readonly duration?: 'this-turn' | 'round' | 'rest-of-game'` (default `'this-turn'`), and
`PlayerState` gains a list of active persistent effects that the reducer re-applies on
each relevant event. ARCHITECTURE §6.4.2 step 1 already proposes exactly this.
**Cost: 6 cards.**

---

## G10 — no tokens-on-a-card counter

**Cards:** KHAKI TERROR, THE FOUR HORSEMEN, HIGGS MORON (REF §4.1, §4.3).
**Clause:** *"Donate 1 resource of each type to the Public Reserve. You cannot make any
purchases until you do so."* (resources are physically placed **on the card**) ·
*"As soon as **8 resources have been discarded on this card** … the holder must discard 2
of their own voters."*
**Why it doesn't fit:** the card is a **physical token holder**. Nothing in `Effect` is
"place a token on an object" and nothing in `GameState` is a token pile. The card is
discarded on resolution, so the pile would have to survive the discard.
**Minimal change:** a `counters: Readonly<Record<string, number>>` keyed by
`cardId:ownerId`, mutated by a `{ op: 'add-tokens'; to: 'this-card' | 'opponent-card'; n: number }`
op, plus a `when: 'tokens-reach'` trigger (G14). The counter has to outlive the card's
resolution, so it belongs on `GameState` rather than the card.
**Cost: 3 cards.**

---

## G11 — no `hostage`: voters removed from the board onto a card

**Card:** ON THE "HIGH" SEAS (REF §4.1).
**Clause:** *"Place 4 of your voters from the board **on this card**. They are held
hostage. You may pay a resource to buy a voter back."*
**Why it doesn't fit:** REF §4.4 item 1 calls this out directly. It is not a resolve and
discard — it is a **persistent board-resident object that holds pegs**, ransomable
repeatedly. `PendingVoters` in `state.ts` is a per-turn mat group that is discarded at
the end of that player's turn, so it is the wrong container: a hostage must survive
turns, and it must be visible to everyone.
**Minimal change:** a `Hostage` type on `GameState`
(`{ cardId, owner, pegs: Peg[] }`) with a place/ransom op pair. Needs the same
persistence plumbing as G9.
**Cost: 1 card, but it is the clearest proof that `Effect` is the wrong shape for X-cards.**

---

## G12 — no `timed-pass`: a card handed round the table

**Cards:** HIGHS MORON, CARD GAMES, A COWARD OR A JOURNALIST?, BLESSINGS OF PARENTS PAST
(REF §4.1, §4.3).
**Clause:** *"Discard up to 2 resources on this card to pass it on to the next player. As
soon as 8 resources have been discarded on this card, **or if a player fails to pass it
on in their turn**, the holder must discard 2 of their own voters."*
**Why it doesn't fit:** the card has a **holder**, a **position in the turn order**, and
a **turn-boundary deadline**. The engine's turn loop goes player → phase → player; there
is no concept of an object moving between players mid-round.
**Minimal change:** the card needs an owner and a `GameState`-level queue of in-flight
cards, and the turn state machine needs a "does this player have a card to pass?" gate.
This is a turn-loop change.
**Cost: 3 cards.**

---

## G13 — five PHASE-CHANGING ops that do not belong in `Effect[]` at all

REF §5.4 is emphatic and the authoring bears it out: no amount of parameterisation of
`Effect` will express these, because they change **which phase of play is running**, not
how many resources someone has.

| op | real card | clause |
|---|---|---|
| `block` | BLOCK | *"Play this immediately out of turn when an opponent plays a Conspiracy Card to negate its effect … A block may be used to cleanse an already-active card."* |
| `deflect` | DEFLECT | *"you may play this immediately to redirect its effect on any player other than them. If the action card has a partial effect on you, only that partial effect is deflected."* |
| `auction` | A CALL FROM KARACHI, QUANTUM WRISTBAND | *"You must now auction the card off, starting at 2 resources."* |
| `vote` | NEXT BILLION DATA POINTS | *"All players must vote for who should receive it. They cannot vote for themselves. In case of a tie, vote again."* |
| `pass-card` | HIGHS MORON, CARD GAMES | see G12 |

**Minimal change:** add a second, non-`Effect` field to the two X-card types —
`readonly interrupt?: Interrupt` where
`Interrupt = { op: 'block' | 'deflect' | 'auction' | 'vote' | 'pass-card'; window: 'out-of-turn' | 'pre-answer' | 'always'; target?: 'any-card' | 'card-affecting-you' | 'any-player' }` —
plus the reducer changes to honour it. **Partial-effect granularity** (DEFLECT) additionally
requires every `Effect` to be individually addressable, which is a deeper change and is
the strongest argument for ARCHITECTURE §6.4.2 step 2's parameterised-op refactor.
**Cost: 5 cards, and BLOCK/DEFLECT are the two most-replayed cards in the real product.**

---

## G14 — no `when`: effects that trigger on other events

**Cards:** LAB-GROWN EARWORM, POWER TRIP, GREAT LEADER BAD ECONOMY, QUANTUM WRISTBAND,
WHY THE LONG FACE?, THE GRETA EFFECT (REF §4.1).
**Clause:** *"Every time they influence a Voter Card, they will choose and give you 1 of
their spent resources."* · *"Every time you influence a 3-Voter Card, you can discard 1
non-majority voter belonging to an opponent."* · *"**When a voter is placed in a Volatile
Area**, go through the Headlines draw pile and select a card to be resolved."*
**Why it doesn't fit:** these are **hooks on other players' actions**, installed
persistently. `Effect` is a list of things that happen *now*. There is no `when` and no
way for a card to say "on the next purchase, instead of …".
**Minimal change:** an optional `when?: 'on-voter-influenced' | 'on-volatile-placement' |
'on-purchase' | 'on-gerrymander' | 'on-majority-formed'` on each op, plus a persistent
trigger list on `PlayerState` (same plumbing as G9/G10). The 3-Voter-card variant also
needs a condition on *which* card was influenced, which is a `forEach`-shaped guard.
**Cost: 6 cards. Combined with G9 this unlocks the largest family of real cards.**

---

## G15 — no value computed from your own current state

**Cards:** JUMLA, HOLO SAPIENS, IF YOU LIKE PIÑA COLADA, DOSTI BANI RAHE, THE BIG FREEZE
(REF §4.2.1, §4.2.2, §4.1).
**Clause:** *"Opponents can take this card by paying you **as many resources as the
Ideologue level this card is on**."* · *"**Double all the resources on your player mat.**
Your current resource cap still applies."* · *"Pick an opponent. In their next turn, they
may use **all your Gerrymandering Rights**."*
**Why it doesn't fit:** the `n` of every op is a literal in the JSON. A price that is a
function of the seller's own board state, or an operation on a player's *entire pool*,
cannot be written as a constant. "Double all my resources" is not `gain`; it is
`pool := pool × 2`, subject to the cap.
**Minimal change:** allow `n` to be a small tagged union —
`n?: number | { of: 'ideologue-level' | 'your-pool' | 'opponent-volatile-voters' | 'your-gerrymander-rights' }` —
and add `{ op: 'scale-pool'; by: number }`.
**Cost: 5 cards.** Note this is a *union widening* in the type, which is backwards
compatible: existing cards keep their literal `n`.

---

## G16 — no zone-scoped operation

**Cards:** JUST BREATHE, NERO'S GUESTS, CUT COPY AND PASTE (REF §4.3, §4.1, §4.2.1).
**Clause:** *"Select **the zone where you have the most voters**. Move 2 voters from that
zone into an adjacent zone."* · *"Move any 3 voters **in this zone**. OR Move any 3
voters out of **this zone**."* · *"At the end of your turn, select 1 of your majorities.
Discard all your voters in that zone. **If any empty area is left in this zone at the
start of your next turn**, convert all its voters into yours."*
**Why it doesn't fit:** three separate needs. (a) A **zone selector computed from board
state** ("the zone where you have the most voters"). (b) A **zone passed in by the
trigger** — "this zone" means the Volatile Area that triggered the Headline, so the zone is
context, not data. (c) **Board mutation scoped to one zone**: convert-ALL-in-zone and
fill-to-capacity, which no single op does.
**Minimal change:** a `zone?: ZoneID | 'this-zone' | 'your-strongest'` on the affected
ops, plus a `GameState` context field for the zone that triggered the current resolution,
plus one `{ op: 'fill-zone'; to: 'yours' }` op.
**Cost: 3 cards.**

---

## G17 — no deck search, and no rewind from the discard pile

**Cards:** SELECTIVE ACCESS MEMORY, AS CLEAR AS WATER, GOOD GIG WELL PLAYED, FUELLING
THE NEWS (REF §4.2.1, §4.3).
**Clause:** *"Pick **any** Conspiracy Card **from the discard pile**. It can be in any
order from the discard pile."* · *"Draw 3 … Keep one for yourself and give 1 card each to
2 opponents. **If there are fewer than 3 cards in the draw pile, draw the remaining from
the discard pile at random.**"*
**Why it doesn't fit:** `draw-conspiracy: { n }` draws from the **top** of the draw pile
and nothing else. There is no `from: 'draw' | 'discard'`, no `where: 'top' | 'any' | 'random'`,
and no "keep 1 of N, distribute the rest".
**Minimal change:** `{ op: 'draw-card'; kind: CardKind; n: number; from: 'draw' | 'discard'; pick: 'top' | 'random' | 'choose' }` — and `choose` needs the `Choice` machinery in `state.ts` to grow a `'choose-card'` variant.
**Cost: 4 cards.**

---

## G18 — no control over the draw-and-answer phase

**Cards:** 404, BRAVE NEW WORLDS, CARD GAMES (REF §4.3).
**Clause:** *"Choose 2 players. They will answer **each other's** Ideology Cards in their
next turn."* · *"Every player answers an Ideology Card immediately, in order of turn.
Players will not receive any resources (active & passive) for doing so."*
**Why it doesn't fit:** these change **who gets which card** and **suppress the passive
income**, i.e. they modify the `answer` phase. `Effect` is a list applied inside one
player's turn; there is no way to address the draw pile assignment or the `manifesto`
passive computation.
**Minimal change:** a card-level `answerPhase?: { redirect?: 'cross' | 'immediate'; suppressPassive?: boolean; skipResources?: boolean }`, and the `answer` phase in the reducer has to read it.
**Cost: 3 cards.**

---

## G20 — no card-destroying or card-moving effects between players

**Cards:** A CALL FROM KARACHI, DEFLECT, CARD GAMES, A COWARD OR A JOURNALIST?,
BLESSINGS OF PARENTS PAST, ON THE "HIGH" SEAS (REF §4.1, §4.3).
**Clause:** *"Draw the top 3 Conspiracy Cards. Keep 1 and shuffle the other 2 back into
the deck."* · *"each player can **donate 1 of their Ideology Cards** to the opponent on
their left. They will receive 6 resources of their choice for doing so."*
**Why it doesn't fit:** `PlayerState.conspiracies: readonly CardID[]` exists, but no op
moves a card between players or back into a pile. A Headline that reassigns Ideology
Cards also breaks the blind-answer invariant that `playerView.ts` tests for.
**Minimal change:** `{ op: 'move-card'; kind: CardKind; n: number; to: 'self' | 'chosen-player' | 'draw-pile' | 'discard-pile' }` and a `PlayerState.ideologyCards` list (Ideology Cards are currently only tracked as `manifestoCards` of *answered* cards).
**Cost: 5 cards.**

---

## G22 — no "during your next turn" scope

**Cards:** DON'T KISS THE BABIES, GENDER TROUBLE, SNOOP B-O-DOUBLE-T, DOSTI BANI RAHE,
THE BIG FREEZE, MOVEMENT ANXIETY DISORDER (REF §4.1, §4.3).
**Clause:** *"All Voter Cards cost any 1 extra resource **in your next turn**."* · *"You
cannot use one of your unlocked Level 3 Ideologue Powers **in your next turn**."* ·
*"**Starting this turn, for 1 round**, gain 1 voter every time any opponent Gerrymanders
your voters."*
**Why it doesn't fit:** an effect whose lifetime is measured in **turns of a player who
may not be the one resolving the card**, plus one whose clock starts "this turn" (so it
must not apply to the resolving turn). There is no turn counter attached to a card, and
"1 round" (until everyone has played one turn) is a different clock again.
**Minimal change:** this is the `duration` field of G9 plus a `startAt: 'now' | 'next-turn' | 'after-this-turn'` and a `duration: 'this-turn' | 'next-turn' | 'round' | 'rest-of-game'` on the effect. **G9 and G22 are the same change** and should be specified together.
**Cost: 6 cards.**

---

## G23 — `IdeologyCard` has no notion of the card's second face

**Cards:** every Ideology Card.
**Why it doesn't fit:** REF §5.3 establishes from product photography that the physical
card is **printed on both sides** — question band and ▼ marker on both, a different
answer + payout + nameplate on each. `sides: readonly [IdeologySide, IdeologySide]` is an
unordered pair, which is *sufficient for the game* but has no stable reading order, so a
UI cannot render a single flipping card without inventing one.
**Minimal change:** a stable `faceOrder` is unnecessary if the loader simply fixes
`sides[0]` as the "front"; the real gap is presentational. If the client is to animate
the flip, either add `readonly face: 0 | 1` to `IdeologySide`, or have the server send a
one-sided view with the ▼ on the side being read (REF §5.3's recommendation, which the
`_` convention already supports).
**Priority: low for the engine, high for fidelity.**

---

## G24 — `IdeologyCard` has no card code

**Cards:** every Ideology Card.
**Clause:** `IG10.108` printed bottom-right (REF §5.7).
**Why it doesn't fit:** no field. `CardID` exists but is the internal key, and it does
not follow the printed convention.
**Minimal change:** `readonly code?: string` on `IdeologyCard`, unique per card, matching
`^[A-Z]{2}\d{2}\.\d{3}$`. Only needed for deck diffing and bug reports; not for play.

---

## 1. Recommended order for the next schema iteration

Ordered by cards-unlocked per unit of engine work, using the table in §0.

1. **`target` on `gerrymander`** (G8) — one line in `cards.ts`, one real card back. Do it
   first because it is trivial and because the validator found it, not me.
2. **`duration` + `startAt` on the X-card types** (G9 + G22 together) — 12 cards. The
   single biggest win, and the cheapest per card, because it needs a list of active
   effects on `PlayerState` and nothing else.
3. **`when` on effects + persistent trigger list** (G14) — 6 more cards, and it composes
   with #2 (both need the same "active effects" plumbing).
4. **`PlayerState.restrictions`** (G5) — 5 cards, and it is the only gap that is *not* a
   card-schema change. It gates KHAKI TERROR, THE FOUR HORSEMEN, THE BIG FREEZE, GENDER
   TROUBLE, DON'T KISS THE BABIES — five of the game's best-known cards. It is also the
   largest piece of work.
5. **`Interrupt` outside `Effect[]`** (G13) — 5 cards, and BLOCK/DEFLECT need a
   partial-effect model that probably wants #7 first.
6. **`n` as a tagged union + `scale-pool`** (G15) — 5 cards, backwards compatible.
7. **Parameterise `Effect` per ARCHITECTURE §6.4.2 step 2** — this is the enabling change
   for G4, G7, G16, G17 and partial-effect DEFLECT. Doing it earlier makes the rest
   cheaper; doing it later means doing it twice.
8. **Everything else** — G0, G1, G2, G3, G6, G10, G11, G12, G17, G18, G20, G23, G24.

---

## 2. A defect found in `docs/ARCHITECTURE.md` §6.4.3, not in the code

ARCHITECTURE §6.4.3 presents a worked "bad card" and says of it: *"`funds: 4 ≥ funds: 2`
strictly, `trust: 2 ≥ trust: 0`, so **D1 `PURE_UPGRADE`** — the second side is a free
upgrade for anyone"* on a card whose sides are `{funds: 2, trust: 2}` and `{funds: 4}`.

That comparison mixes sides: `trust: 2` is on the *first* side and `trust: 0` is on the
second, so the second side is **not** ≥ the first — it is short one Trust. As card it is
a clean trade-off, not an upgrade.

More usefully, the arithmetic cannot be rescued: **if X ≥ Y componentwise and X ≠ Y
then ΣX > ΣY strictly, so a pure upgrade can never be 0-sum.** There is no zero-sum
pure upgrade. The argument the section is making survives intact once the gap is stated
honestly as **1 resource** — and 1 resource is *exactly* what `BALANCE_TOLERANCE_TOTAL = 1`
swallows. So the real demonstration is the pair of tests in `test/balance.test.ts`:
a 1-resource pure upgrade is an **error**, and a 1-resource trade-off is **clean**.

The implementation in `src/balance.ts` follows the corrected reading. §6.4.3's example
should be rewritten to match; it is the one place in the design docs that would mislead
the next person who implements from it.

---

## 3. D3 models a resource PROXY, not the engine's power-unlock rule

`POWER_THRESHOLD_CLIFF` in `src/balance.ts` is the check that makes the file worth more
than a totals comparison, so its fidelity is worth stating plainly.

**The engine's real rule.** `packages/engine/src/powers.ts` `hasPower()` is
`cardsOf(player, spec.ideologue) >= rules.level3` — a count of Ideology **Cards**
answered, not of resources paid. `IDEOLOGUE_RESOURCE[i]` tells you which resource an
Ideologue's answers *feed* (the passive bonus, `passiveBonus()`), but it is not what
unlocks a power. Nothing about a card's `pays` block changes which powers a player
holds.

**What D3 actually measures.** The balance checker runs on one card in isolation, with
no manifestos, so it cannot count cards. It uses the resource proxy the rules supply
for that ladder: a side paying `RULES.level3` of its own Ideologue resource is treated
as buying the Level 3 unlock, `RULES.level5` the Level 5.

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

**Status:** none of the 20 shipped Ideology Cards pays 3 or more of any resource, so
the shipped decks produce zero crossings under either the scoped or the unscoped
version, and the checker result is unchanged. The fix is a correctness fix with no
effect on the corpus as shipped.

---

## 4. What is NOT a gap

Recorded so the next iteration does not waste time on them.

- **`pays` need not contain the answerer's own resource.** REF §5.2 verifies from the
  official 432-card render that a real Capitalist side pays 2 Trust + 1 Media and **zero
  Funds**. A validator rule of the form "a Capitalist answer must pay ≥1 Funds" would
  reject a shipped card. The schema requires the key to be *stated* and the value to be
  *non-negative*, and nothing more. `ig-in2020-002` is the corpus's proof.
- **`{}` as a payout is a design failure, not a schema failure.** The schema sets no
  `minProperties` on `pays`; the balance checker's D5 `EMPTY_SIDE` owns it. Shape
  validation and design judgement stay separately reviewable.
- **The Ideology Card schema is essentially correct.** REF §5.1's field-by-field
  comparison finds the engine's `{question, sides[2], campaign, advisory}` an exact match
  for the printed card, and *more* austere than reality. Only G23/G24 are missing, and
  neither affects play. The corpus is blocked on **content**, not on schema: REF §2.4
  recovered zero ordinary question cards in full.
