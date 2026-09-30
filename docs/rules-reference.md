# SHASN — Rules Reference

**Source:** *SHASN — Collectors Edition Rulebook*, Memesys Culture Lab (creator: Zain Memon).
Retrieved 2026-08-15. 19 spreads / 35 numbered pages.

This file is the single source of truth for every number in
`packages/engine/src/rules.ts` (the `Rules` object, exported as `RULES`). Page numbers
refer to the printed page numbers in the rulebook, not PDF sheet indices.

Nothing in this file is guesswork. Where the rulebook is genuinely silent, the entry
is marked **[NOT IN RULEBOOK]** and the engine's chosen behaviour is stated.

**Reconciled 2026-09-30 against the code**, after `docs/ENGINE-AUDIT.md` §6b found nine
places where this file and `packages/engine` disagree (D1–D9). Each correction below is
tagged **[CORRECTED 2026-09-30]** with its D-number and the adjudication. Where the audit's
own adjudication is uncertain, the entry says so rather than picking a side. Two findings
about *coverage* rather than numbers — D3 (add-on modes) and D4 (auctions) — were claims
or silences in this file that the code cannot support, and both are corrected here rather
than left as a description of a system that does not exist.

---

## 1. Objective (p7, p20)

> The game ends when all possible majorities in all zones have been formed. The
> player with the highest number of majority voters wins the game.

- Only **majority voters** score. 1 point each.
- Non-majority voters score nothing.
- Number of *zones* captured is irrelevant — only the total count of majority voters.
- **Timer ending:** if every Voter Area on the board is filled without all majorities
  having formed, every player plays one final turn, **starting with whoever filled
  the final empty area**.
- Tie-breaker (p20): the "privilege" rule. Explicitly non-binding, social, and
  out of scope for a digital implementation. The engine reports a tie.

---

## 2. The board (p2, p8)

Nine zones. Each label is `majority / capacity`.

| Zone | Majority | Capacity | Volatile areas |
|---|---:|---:|---:|
| North West | 6 | 11 | 1 |
| North East | 6 | 11 | 1 |
| West | 9 | 17 | 2 |
| East | 9 | 17 | 2 |
| North | 11 | 21 | 1 |
| Central | 5 | 9 | 1 |
| South | 11 | 21 | 1 |
| South West | 6 | 11 | 1 |
| South East | 6 | 11 | 1 |
| **Total** | **69** | **129** | **11** |

Majority is always `floor(capacity / 2) + 1`, i.e. "more than half the voters in a zone".

**Geometry.** Six outer zones form a ring (NW, NE, W, E, SW, SE); North, Central and
South form a lightning-bolt column down the middle, with Central as a small dark
inset at the centre of the board.

**Adjacency** (verified against the printed borders, including the top-centre border
between NW/NE and the bottom-centre border between SW/SE):

```
north_west  → west, north, north_east
north_east  → east, north, north_west
west        → north_west, north, central, south, south_west
east        → north_east, north, central, south, south_east
north       → north_west, north_east, west, east, central
central     → north, south, west, east
south       → central, west, east, south_west, south_east
south_west  → west, south, south_east
south_east  → east, south, south_west
```

---

## 3. Components (p2–3)

| Item | Count |
|---|---:|
| Game board | 1 |
| Voter Cards | 60 |
| Voter Pegs | 300 (60 × 5) |
| Resource Tokens | 200 (50 × 4) |
| HQ Mat | 1 |
| Player Mats | 5 |
| Ideologue Cards | 4 |
| Ideology Cards | 108 (Kickstarter ed.) / 432 (Presidential ed.) |
| Conspiracy Cards | 20 / 80 |
| Headline Cards | 20 / 80 |

---

## 4. Setup (p7)

1. Each player picks a player mat and matching bag of voter pegs.
2. All players vote to elect Player 1. No self-votes. Re-vote on a tie. Turns go clockwise.
3. **Staggered starting resources** — Player *n* receives *n* resources of their choice
   from the Public Reserve. P1 gets 1, P2 gets 2, P3 gets 3, P4 gets 4, P5 gets 5.
   *(Designer's note: offsets first-player advantage.)*
4. Select a Campaign. Remove Ideology Cards per the Content Advisory if the table agrees.
5. Shuffle the campaign's Ideology, Conspiracy and Headline decks.
6. Place Conspiracy, Headline and Voter decks face down on the HQ Mat. Draw and place
   the **top 3 Voter Cards face up**.

---

## 5. Order of turn (p21)

### Start of turn
1. The player **to your right** draws the top Ideology Card and reads **both sides aloud** to you.
   **[NOTE 2026-09-30 — D7. Deliberate non-decision, recorded so it is not mistaken for an
   oversight.]** The engine draws server-side inside `advanceTurn` and has no notion of who
   physically drew the card. That is correct for a digital table — "who reached into the
   deck" is not observable and not meaningful — but it means the *reader* is a UI
   responsibility, not a rules one. The digital analogue of the right-hand player is
   whoever is speaking, and the ▼ side-marker on the physical card is the printed gesture
   that says which side is being read; the client needs an equivalent.
2. Optionally, before answering, pay **any 4 resources** to the Public Reserve to have the card
   redrawn — the right-hand player discards it and draws a new one.
3. Confirm an answer. Keep the card under your player mat, answer side face up.
4. Receive the resources printed on your answer, **plus** any passive Ideologue Power resources.
5. Check resource cap; discard excess **before taking any other action**.

### Turn actions — any number, any order, repeatable
- **Influence Voter Cards** — spend resources on open Voter Cards on the HQ Mat.
- **Place Voters** — place influenced and evicted voters on the board.
- **Form Majorities**.
- **Trade** — resources and Conspiracy Cards with other players.
- **Buy / Use Conspiracy Cards**.
- **Gerrymander**.
- **Use Ideologue Powers**.

### Post-turn actions
1. Resolve one Headline Card **for each** voter you placed in a Volatile Area this turn.
2. Draw and read an Ideology Card for the next player.
3. Before the next player answers, **any** player may play a Conspiracy Card.

---

## 6. Resources (p11–12)

Four resources, one per Ideologue:

| Resource | Ideologue | Flavour |
|---|---|---|
| Campaign **Funds** | The Capitalist | business-friendly policy, market demand |
| Street **Clout** | The Supremo | populism, identity politics |
| Media **Attention** | The Showstopper | visibility, shock, outrage |
| Public **Trust** | The Idealist | intention, equity, pragmatism |

- **Resource cap: 12** **[CORRECTED 2026-09-30 — D1]**. This line previously read
  "(default; per resource pool as shown on the player mat)", which contradicted §16 #3
  of this same file and the code (`overCap` sums `poolTotal` across all four). The cap is
  **12 total, not per resource.** See §16 #3 for the ruling and the argument from p12.
- Crossing the cap forces an immediate discard down to cap **before any other action**.
- Resources and Conspiracy Cards may be **traded** with opponents in any ratio.
  At least 1 resource must be exchanged **by both parties**. At least one party must be
  the active player. Trades may be initiated at any point during your turn.
- **Ideology Cards cannot be traded** unless a card says otherwise.

### Auction (p12, p34)

> **[CORRECTED 2026-09-30 — D4. Not implemented, and the state model cannot express it.]**
> The rules below are transcribed correctly from the rulebook; **nothing in
> `packages/engine` implements them**, and this section previously sat here with no marker,
> which read as "specified and pending" rather than "a whole rules system the reducer
> cannot represent". There is no auction `Phase`, no IOU or debt field on `PlayerState`,
> and — the actual blocker — **no way for the action vocabulary to say "you owe 3".** The
> 16 `Action` variants have no representation for an outstanding obligation, so auctions
> are not a missing feature but a missing concept. **Scope decision required before M6:**
> defer them out of v1, or add `PlayerState.debts` and a `Phase` variant. Tracked as
> `PLAN.md` §6 row 10.

- Certain events start an auction.
- You may bid up to your resource cap and **need not hold** the resources you bid.
- Winning bidder may pay off the bid over successive turns, tracked by an **IOU token**
  held by the seller, and **cannot make any purchases until the bid is fully paid**.
- If nobody bids, the item is discarded and the seller receives the minimum bid value
  from the Public Reserve.

---

## 7. Influencing voters (p10)

- Voter Cards each show a combination of resources. Pay that combination to the
  Public Reserve to influence that card's voters.
- A Voter Card grants **1, 2 or 3 voters**.
- **Three open Voter Cards must always be available** on the HQ Mat. After a card is
  influenced, discard it and immediately flip a replacement from the draw pile.
- Voters from a **single Voter Card cannot be split across zones**. Voters obtained by
  any other means can be split.
- All influenced voters must be placed **by the end of the same turn** or they are discarded.
- **No limit** on how many voters you may influence in a turn.
- If the draw pile empties, shuffle the discards and reuse.
- If no single zone has enough empty areas for a card's voters, **all voters from that
  card are discarded**.
  **[NOTE 2026-09-30 — D8. The outcome is implemented; the path is not, and the player is
  told the wrong reason.]** Nothing auto-discards. `placeableAreas` filters the list the
  player chooses from, `PLACE_VOTERS` refuses the cross-zone split above, and leftovers are
  discarded at end of turn — so the cards do get discarded, but the player is told "voters
  from one Voter Card must all be placed together" when the real situation is "there is
  nowhere legal to put these". Cosmetic, and worth fixing in the UI: auto-discard when
  `placeableAreas` is empty, so nobody is asked to do the impossible.

---

## 8. Forming and breaking majorities (p8–9)

- Every voter peg has a **blank side** and a **party-symbol side**. Non-majority voters
  sit blank side up.
- A majority forms **immediately** when the zone's majority requirement is met.
- On forming, flip exactly as many of your voters as the requirement, symbol side up.
  Each flipped voter is a **majority voter** worth 1 point.
- Voters placed **after** the majority is reached earn nothing and stay blank side up.
- A majority can be **broken** by powers and effects. If you drop below the requirement,
  flip your remaining voters blank side up.

---

## 9. Ideology Cards & Ideologues (p13, p15, p28–33)

- Every answer belongs to one of four Ideologues. Both answers on a card belong to
  **different** Ideologues.
- Keep the Ideology Card under your mat, answer face up. **Keep the card hidden until the
  active player confirms their answer** — this is the game's central hidden-information rule.

### Passive power — all four Ideologues
> For every **2** Ideology Cards you hold of an Ideologue, get **1 extra resource** of that type.

- 2 cards → +1/turn. 4 cards → +2/turn. And so on.
- Granted when you answer the Ideology Card at the start of your turn.
- The bonus also applies **immediately** in the turn you reach the threshold.

### Unlock thresholds
- **3** cards of one Ideologue → that Ideologue's **Level 3** power.
- **5** cards of one Ideologue → that Ideologue's **Level 5** power.
- Powers are usable in the same turn they unlock.
- Multiple Ideologue Powers can be active simultaneously.
- Powers work every turn as long as you still hold the required cards.

### The Capitalist (p29)
- **L3 — Prospecting:** Once per turn, give 1 resource to the Public Reserve to get **up to 2**
  resources of your choice. Both taken at the same time; the two may be different types.
- **L5 — Land Grab:** **Three times per turn**, evict any 1 voter from the board and send it
  back to its player (**including majority voters**).
  - The evicted opponent may replace it anywhere on the board on their next turn; if they
    fail to, it is discarded.
  - Evicting your own voter lets you replace it immediately, anywhere.
  - Voters in Volatile Areas **cannot** be evicted.

### The Supremo (p30)
- **L3 — Donations:** **Twice per turn**, snatch 1 resource from another player.
  Both from one player or one each from two players. May be used one at a time across the turn.
- **L5 — Payback:** **Twice per turn**, spend 1 resource to discard an opponent's voter
  (**including majority voters**). Voters in Volatile Areas cannot be discarded.

### The Showstopper (p31)
- **L3 — Going Viral:** **Twice per turn**, get **+1 voter** for any Voter Card you influence.
  Maximum 2 unique Voter Cards per turn.
- **L5 — Election Fever:** Gerrymander **2** voters instead of 1 in every zone where you hold
  Gerrymandering Rights (**including majority voters**). The 2 may belong to different players.
  Unusable if you hold Gerrymandering Rights nowhere. Volatile Area voters exempt.

### The Idealist (p32)
- **L3 — Helping Hands:** **Twice per turn**, get a 1-resource discount on any purchase.
  Purchases = Voter Cards and Conspiracy Cards only. You choose which resource to discount.
  The two discounts may be split across 2 purchases or combined on one.
- **L5 — Tough Love:** **Once per turn**, spend **2 Trust + any 2 resources** to convert 2 of an
  opponent's voters into yours (**including majority voters**). Both converted voters must
  belong to the same player **in the same zone**. Cannot be used without paying. The cost
  *can* be discounted by Helping Hands. Volatile Area voters cannot be converted.

### Reference table (p33)

> **Caption — read this before using the table. [CORRECTED 2026-09-30 — D2]**
> Every Level 3 / Level 5 cell is the **total effect available in one turn**, not a single
> use of the power. This was not stated, and the p33 sheet compresses "twice per turn"
> into a bare "2", which reads as "take 2 at once". A reader building a bot from this
> table alone would implement three powers wrongly. **Where this table and the prose above
> disagree, the prose is authoritative** — p29–p32 are the rule text; p33 is a summary
> card.

| | Capitalist | Supremo | Showstopper | Idealist |
|---|---|---|---|---|
| **Passive** | +1 Funds per 2 cards | +1 Clout per 2 cards | +1 Media per 2 cards | +1 Trust per 2 cards |
| **Level 3** | Trade 1 resource for 2 (once/turn) | Snatch **1** resource, **twice per turn** | +1 voter / card (twice per turn) | 2 discounts (twice per turn) |
| **Level 5** | Evict **1** voter, **three times per turn** | Discard **1** voter, **twice per turn** | +1 gerrymander / zone (2 instead of 1) | Convert 2 voters (once per turn) |

**[CORRECTED — D2] Three cells changed:** Supremo L3 was "Snatch 2 resources" (p30 says
*snatch **1** resource, twice per turn, and the code's `POWER_DONATIONS` takes
`{from, res}` — one player, one resource, per use); Capitalist L5 was "Evict 3 voters"
(p29 says *three times per turn, evict **any 1** voter*); Supremo L5 was "Discard 2
voters" (p30 says *twice per turn, discard* **one** voter). The Idealist L3 cell was left
alone — "2 discounts" happens to be a correct count of two uses — but it is now marked
like its neighbours.

---

## 10. Gerrymandering (p16–17, p34)

> Gain Gerrymandering Rights in a zone by having the most voters there.

- Rights let you move **one voter per turn** per zone you have rights in: into that zone,
  out of it, or between it and an **adjacent** zone.
- Only **non-majority** voters may be gerrymandered (unless a card says otherwise).
- You may gerrymander **any player's** voters, including your own.
- Rights gained during your turn are usable **the same turn**.
- **Ties give nobody rights.** Two or more players tied for most voters in a zone → no rights.
- **Volatile Area voters cannot be gerrymandered.**
- Even **1 voter** in an otherwise-empty zone grants rights there — but you may not move your
  only voter out of that zone using that zone's rights.

---

## 11. Volatile Areas & Headline Cards (p18)

- **11 Volatile Areas** on the board. Every zone contains at least one.
- Placing a voter in a Volatile Area **triggers a Headline**, resolved at the **end of that turn**.
- A peg in a Volatile Area is **permanent**: it cannot be gerrymandered, converted, moved,
  evicted, discarded, or affected in any way.
- You may place **your own or an opponent's** voter into a Volatile Area.
- Multiple voters into Volatile Areas in one turn → that many Headlines, resolved
  **in the order the voters were placed**.
- Headlines contain both lucrative opportunities and devastating penalties.

> **[UNRESOLVED 2026-09-30 — D6. Read p18 before implementing M6.]** The rulebook settles
> *placement* into a Volatile Area and settles that a peg *there* is permanent, but
> **nowhere does it say whether a voter gerrymandered _into_ a Volatile Area triggers a
> Headline.** §10 forbids moving a voter *out of* a volatile and explicitly permits
> placing one in, so the move itself is legal; what is unstated is its consequence. Two
> readings, both defensible:
>
> 1. A gerrymander is a placement, so it triggers a Headline. **(This is what the code
>    does** — `reduce.ts` queues a Headline for a gerrymanded-into volatile exactly as it
>    does for `PLACE_VOTERS`.)
> 2. The Headline is the price of bringing a voter in *from your own supply*; a
>    gerrymanded voter arrives under an existing Headline obligation and should not pay
>    it twice.
>
> **Not guessed here.** This needs a direct re-read of p18 and then a pinned test — the
> engine audit names it test 48. Tracked as `PLAN.md` §6 row 8. Note that the two readings
> differ in player value, not in code difficulty: reading 2 is strictly better for the
> gerrymandering player, so if the project ships without ruling on it, one player-facing
> rule will have been invented.

---

## 12. Conspiracy Cards (p19)

- Cost **any 4–5 resources**, the number printed on the card back. "Any combination".
- Only the **top card** of the Conspiracy draw pile may be purchased.
- Playable **at any point during your turn**, and also **immediately before an opponent
  answers their Ideology Card** (i.e. out of turn, in the post-turn window).
- **No hand limit.** Multiple Conspiracy Cards may be played in sequence.
- Two players playing simultaneously → resolve in turn order.
- May be bought and held, or used immediately. Multiple purchases per turn allowed.

---

## 13. Coalitions (official site, `shasnthegame.com/pages/coalitions`)

*Not present in the Collectors Edition rulebook body; published as an official add-on rule.*

> **[CORRECTED 2026-09-30 — D5. Not implemented, and the type must change before it can
> be.]** The rules below are transcribed correctly. What the code cannot currently
> represent is the point: **`Zone.majorityHolder` is a single `PlayerID | null`** — one
> player per zone, structurally. There is no `coalitions` field on `GameState` or
> `PlayerState` and no withdrawal action in the 16 `Action` variants. So coalitions are not
> a feature waiting on a milestone; they are a **breaking type change**, and the audit's
> advice is to make that change while the engine is already being repaired rather than
> after M1. The engine's `powers.ts` is already written to survive it ("the same logic
> applies if cards ever leave a manifesto"), which is the right posture.
>
> One coupling worth flagging: `recount`'s handling of two players meeting a majority
> requirement simultaneously (audit R4, currently decided by board-scan order) is the
> **degenerate coalition case**. If the type changes for coalitions, it should change
> knowing what a two-way tie is *supposed* to mean, because the two decisions have to
> agree. Tracked as `PLAN.md` §6 row 11.

- Two players may combine voters in a zone to reach the majority requirement together.
- The majority voters are split in any negotiated ratio.
- Formalised by **exchanging an Ideology Card** — each gives one from their most-held Ideologue.
- **Only the coalition member with more voters in that zone** gets Gerrymandering Rights.
- Different coalitions may be formed in different zones; each costs another card exchange.
- A coalition breaks when either player **declares withdrawal, during their own turn only**.
- Exchanged Ideology Cards are **never returned**.
- Scoring: each player scores their own share. e.g. a 4:2 split of a 6/11 zone scores 4 and 2.

---

## 14. Add-on modes (Kickstarter promos, p22–27)

> **[CORRECTED 2026-09-30 — D3. This line previously read "Implemented behind flags; off by
> default." That was false and is withdrawn. There are no flags and no code.]** The engine
> has no `elites`, `homeTurfsUsed` or `chaos` field on `PlayerState`; no chaos or auction
> variant of `Phase`; no Chaos Tracker; no Home Turf resolution; no Elites evaluation. The
> only trace of any of it is an `excludeInTwoPlayer?: boolean` on `ConspiracyCard` and
> `HeadlineCard` that **nothing reads**. **Correct status: not implemented; the design is
> recorded here for a future milestone.** A document that claims a flag exists is worse
> than one that admits a mode is missing, because the claim reads as verification.
>
> These are four separate modes, not one feature, and they are not equally expensive:
> **2-Player Mode** is mostly a different `BOARD` + `COASTLINE` data swap;
> **Home Turfs** is a per-zone once-per-turn hook that the gerrymander path already has a
> natural place for; **Elites** is a requirement evaluator over an existing manifesto;
> **Edge of Chaos** is a tracker, a new voter class with its own placement and burn rules,
> and a game-end condition — by far the largest of the four. Nothing below blocks v1.

### Elites (p22)
13 Elite politicians. Each is a **hybrid of two Ideologues with a negation of a third**.
Example: **The Technocrat** = ≥3 Capitalist **and** ≥3 Showstopper **and** 0 Supremo.
- Power usable immediately on unlock; **lost** the moment the requirement lapses
  (e.g. a Technocrat receiving one Supremo card ceases to be a Technocrat).
- A player may be multiple Elites at once and use all their powers.

### Home Turfs (p23)
A two-sided Home Turf on each zone. Holding **Gerrymandering Rights** in a zone lets you use
its Home Turf power **once per turn**. Flip all used Home Turfs at end of turn. Some are
compulsory, some optional, as printed. Examples: *Airport* — +1 resource for every voter you
gerrymander. *Harbor* — +1 resource for every voter you gerrymander **out of** this zone.

### Edge of Chaos (p24–25) — 4-player mode
- **13-point Chaos Tracker**, starting at STABILITY (level 0). Reaching **13** ends the game
  and **everybody loses**.
- The unused 5th bag of voters becomes the **Chaos Voters**.
- Ideology Cards, Conspiracy Cards, and L3/L5 Ideologue Powers can raise or lower Chaos.
- Each tracker point carries a reward or penalty, applied on movement.
- Chaos may also be lowered by paying resources as printed — **but you forfeit the track's
  benefit** when reducing it this way.
- Chaos Voters earned from the track are placed by the earner before end of turn; if forgotten,
  the next player places them. If evicted, the next player replaces them.
- Chaos Voters behave like normal voters (gerrymanderable, discardable, convertible)
  **except** they cannot be placed in Volatile Areas.
- If Chaos Voters meet a zone's majority requirement, **that zone burns**: discard every
  player's voters there and exclude the zone from end-game scoring. The Chaos majority voters
  lock permanently.

### 2-Player Mode (p26–27) — board layout disputed
> **[UNRESOLVED 2026-09-30 — how many boards are there, actually?]** This subsection said
> 2-Player Mode "requires the separate 2–3 player board". That now conflicts with the
> physical product: the Essential Edition contents list **one** "Double-Sided Game Board",
> and the official render is captioned **"DUAL LAYERED BOARD"**
> (`docs/AUTHENTIC-SHASN-REFERENCE.md` §0, §6.1). One reading is that the reference above
> means a *separate face* — one sheet printed on both sides, the 2-player variant on the
> reverse — which would reconcile the two statements and reduce this mode to a data swap.
> Nothing confirms the reverse actually carries the 7-zone layout, and nothing says whether
> it supports **3** players as the reference's "2–3 player board" phrasing implies, or only
> 2. **Do not implement until settled**; the 9-zone board is unaffected either way.
> Tracked as `PLAN.md` §6 row 7.

- Different board: **7 zones** — 9/17 centre, 8/15 ×2, 7/13 ×2, 6/11 ×2.
- 14 unique **Zone Requirements**, shuffled and split between the players; players alternate
  placing them (P2 places 1st, 3rd, 5th, 7th = 4 total; P1 places 3), one per zone.
- Requirement types: **One-Time**, **While Forming Majority** (re-checked on every majority
  change), and **Zonal Rule** (a local rule modification).
- Remove Conspiracy/Headline cards marked `2✕`.
- Player 1 determined by a **blind bid**: each player takes 8 resources (2 of each), secretly
  bids, higher bid is P1, all bid resources return to the Reserve.
- Players draw Ideology Cards from the **middle** of the deck for each other so neither knows
  what is coming.

---

## 15. Glossary (p34) — exact definitions used by the engine

| Term | Definition |
|---|---|
| **Active Player** | The player whose turn is ongoing. |
| **Area** | A single voter slot on the board. |
| **Convert** | Replace an opponent's voter **in the same area** with your own. |
| **Discard** | Remove a voter from the board **permanently**. |
| **Discount** | Pay 1 less resource on a purchase. |
| **Donate** | Give a resource or voter free of cost. Donating a voter = converting it to their colour. |
| **Evict** | Remove a voter from the board and return it to its owner's mat. That owner may replace it anywhere on their next turn; failing to do so discards it. |
| **Gerrymander** | Move one non-majority voter between adjacent zones, within the zone's area of influence. |
| **Gerrymandering Rights** | Held by whoever has strictly more voters in a zone than any other player. |
| **Snatch** | Take resources and/or Conspiracy Cards from an opponent with nothing in return. |
| **Volatile Area** | Placing a voter here triggers a Headline at end of turn. Voters inside cannot be discarded, evicted, converted, gerrymandered, or otherwise affected. |
| **Zone** | One of the 9 board regions, each with its own majority requirement. |

---

## 16. Points the rulebook does not settle

| # | Question | Engine's decision |
|---|---|---|
| 1 | Exact resource combinations printed on each of the 60 Voter Cards | Original distribution, generated and balance-checked. Documented in `packages/cards`. |
| 2 | Text of the 108 Ideology / 20 Conspiracy / 20 Headline cards | **Original writing.** Card text is copyrightable; the rules are not. See `PLAN.md` §8, §10. |
| 3 | Whether the resource cap is per-resource or total | **Total, across all four resources.** p12 says "you must **choose** and discard any excess resources" — there is nothing to choose if the cap is per-type. p12 also speaks of bidding "up to … your resource cap", a single number. **[D1 — this row is the ruling; §6 previously contradicted it and has been corrected.]** |
| 4 | Whether voters may still be placed into a zone after its majority forms | **Yes.** p8: "placing any more voters in this zone after the first 6 will not earn any additional points and will be kept with the blank side up." |
| 5 | Whether a broken majority can be re-formed by another player | **Yes.** p9 explicitly contemplates majorities changing hands; the 2-player Zone Requirement rules say "if a majority exchanges hands". |
| 6 | Volatile Area positions per zone | W and E hold 2 each; the other seven hold 1 each — counted off the printed board (11 total, "every zone has at least one"). **[D9 — the COUNTS agree with the code**: `gen-board.mjs` sets 2 for west and east, 1 for the rest, and the generated board has exactly 11. Note the limits of that agreement: the *counts* are confirmed, but `AUTHENTIC-SHASN-REFERENCE.md` §13 item 7 records that the **precise position of each cog within its zone is still unconfirmed** at available image resolution. So the totals are settled and the geometry is not.] |
| 7 | **What happens when two players meet a zone's majority requirement in the same zone** | **NOT SETTLED — needs a ruling.** The rulebook is silent: it settles ties for *gerrymandering rights* ("ties give nobody rights", §10) and says nothing about majority ties. **A genuine gap, not an oversight.** The code currently lets board-scan order decide, silently, with no tie handling — while `gerrymanderRights` in the same package correctly returns `null` on a tie. Two functions, one package, two answers to the same question. Both majorities are reachable (north_west is 6/11, so 6+6 is legal). Decided wrongly this silently is the worst case: an intermittent, geometry-dependent outcome in a 4-hour game. Needs a ruling **and** a pinned test (audit test 29); see `PLAN.md` §6 row 12. |
| 8 | **How are ties in the final score broken?** | **NOT SETTLED.** §1 says the engine "reports a tie" and that p20's privilege rule is social and out of scope for a digital implementation — that is a defensible reading of the *tie-break* rule, but not a ruling on *reporting*. The code's `winners()` currently returns **every** player when all scores are 0, because it floors the best score at 0 (audit R5). If that is not the intent, an empty board declares every seat a winner. Cheap to fix, but it should be a decision (audit test 31; `PLAN.md` §6 row 12). |
| 9 | Whether a player may **decline** the staggered starting resources (§4 step 3) | **UNVERIFIED.** p7 says player *n* receives *n* resources of their choice. Whether "of their choice" includes *none* is not addressed. It decides whether `setup()` requires a `startResources` argument from every seat or can run a per-seat choice loop (audit §4.5). Re-read p7. |

---

## 17. Legal note

Game *rules* and *mechanics* are not copyrightable; this document records them for
interoperability. All card text, artwork, and the SHASN name and board art are the
property of Memesys Culture Lab. This project ships **original card text and original
board art** in the same geometry. See `PLAN.md` §8.

`docs/AUTHENTIC-SHASN-REFERENCE.md` §9 sharpens this and is the operative legal-adjacent
note: **do not ship the name SHASN** (it is a live mark in commerce), **do not use any
Memesys artwork including the four resource icons**, and treat the ~55 verbatim card
names and rules texts recovered there as **research quotation kept in the repo**, not
product content — the realistic exposure is a DMCA takedown of the repository rather than
a lawsuit, and the recovered tables should be reduced to effect *archetypes* if the
project ever goes public and commercial. See `PLAN.md` §8.

---

## 18. Reconciliation ledger (added 2026-09-30)

What `docs/ENGINE-AUDIT.md` §6b found here, and what was done about each. Kept so the
next reader does not have to diff two documents by hand.

| id | Where | Correction applied |
|---|---|---|
| D1 | §6 resource-cap line | Doc corrected to **12 total**; the code was right. Cross-referenced to §16 #3. |
| D2 | §9 p33 reference table | Three cells corrected to per-use wording; table captioned as a **per-turn summary** with the prose declared authoritative. |
| D3 | §14 "Implemented behind flags" | **False claim withdrawn.** Not implemented; design recorded for a future milestone. |
| D4 | §6 Auction | Correctly transcribed but marked **not implemented**, with the reason (no representation for debt) and a scope decision required. |
| D5 | §13 Coalitions | Marked **not implemented**; recorded that `Zone.majorityHolder` must change shape first, and coupled to the §16 #7 tie decision. |
| D6 | §11 Volatile/Headline | **Left UNRESOLVED on purpose**, with both readings, what the code currently does, and what would settle it. Not guessed. |
| D7 | §5 "player to your right draws" | Recorded as a **deliberate non-decision**: the draw is server-side in a digital game; the reader gesture is a UI concern. |
| D8 | §7 auto-discard | Outcome is implemented, path is not; player is told the wrong reason. Noted as a UI fix. |
| D9 | §16 #6 volatile counts | **Counts agree.** 11 volatile areas, 2 each in west and east — confirmed against the generated board. The *positions within each zone* are still unconfirmed; see §16 #6. |

Two further corrections were made that the audit did not raise, because they are the
same class of defect and would otherwise have left this file lying:

- **Header:** the file claimed to be the source of truth for `packages/engine/src/config.ts`,
  a file that **does not exist** — it was folded into `rules.ts` during the refactor, which
  is one of the reasons the engine does not compile (audit §2 B2).
- **§14 board count:** the "separate 2–3 player board" claim now conflicts with the
  physical product's single double-sided board. Flagged unresolved rather than resolved in
  either direction.

And three that are not D-series but were the same failure mode — this file asserting
something the code does not do:

- **§16 #3** (resource cap) now carries the D1 tag inline, so the ruling and the summary
  line in §6 cannot drift apart again.
- **§16 #7 and #8 added:** zone-majority ties and end-game score ties were **genuine gaps**
  that §16 did not list, despite the audit listing them as unsettled in §6d.
- **§16 #9 added:** whether a player may decline the staggered starting resources is
  unverified, and it decides the shape of `setup()`'s signature.

