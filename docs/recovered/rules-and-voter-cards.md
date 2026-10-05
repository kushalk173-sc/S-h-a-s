# Recovered Rules, Voter Cards, Board Structure

Research artifact. Sources are the official Memesys rulebooks plus primary-source imagery.
Every claim is tagged `[VERIFIED ...]` (I actually read the cited text/imagery) or `[INFERRED]`.

**Primary documents obtained in full:**

| Doc | Source | How obtained |
| --- | --- | --- |
| Essential Edition India Rulebook 2022-23, 32pp | `https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view` (official link from Memesys' own YouTube description) | Downloaded via `https://drive.usercontent.google.com/download?id=1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0&export=download` → 26 MB PDF → text via `pdftotext -layout`, page art via PyMuPDF |
| Coalitions rules (1pp) | `https://drive.google.com/file/d/17HEr06_mD5Vf-ovEF4sAqSqm0r2AkD3R/view` | Same → 24 KB PDF → full text extracted |
| SHASN Standard rulebook, 17pp | `https://www.scribd.com/document/748104565/SHASN-Rulebook` | Read via `https://r.jina.ai/` (pages 1-8 only; pages 9-17 paywalled) |
| Essential Edition India Rulebook (same 32pp doc) | `https://www.scribd.com/document/1075247099/` | Read via `https://r.jina.ai/` (index page only — superseded by the Drive PDF, which I have in full) |

---

## Voter Cards

**Deck size: 60.** `[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view — "60 x Voter Cards", "60 VOTER CARDS"]`
`[VERIFIED https://www.shasnthegame.com/cdn/shop/files/Voter-Cards_e5aeb312-bb8e-4ae9-89a6-e28e734d3ba5.png — "60 VOTER CARDS"]`

**Card structure.** Each Voter Card shows a column of resource icons plus one large cream numeral.
`[VERIFIED https://www.shasnthegame.com/cdn/shop/files/Voter-Cards_e5aeb312-bb8e-4ae9-89a6-e28e734d3ba5.png]`

- Column of resource discs, one per resource owed, and
- one large cream numeral = the number of voters gained.

**Voter count per card: 1, 2, or 3.**
`[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.9 — "Voter Cards can contain 1, 2 or 3 voters. Three open Voter Cards must always be available on the board."]`

**Cost formula. Cost = (voters) + 2 resources.** Six independently photographed cards all fit:

| Voters | Resources shown | Source |
| --- | --- | --- |
| 1 | 1 Trust + 1 Clout + 1 `?` wildcard = **3** | `[VERIFIED https://cf.geekdo-images.com/65-dUTMFKTXKQqJ3tscr0Q__original/img/pic4757447.jpg — BGG image 4757447 "HQ Mat"]` |
| 2 | 1 Funds + 1 Clout + 1 Media + 1 Trust = **4** | `[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.9 illustration]` |
| 2 | 1 Funds + 1 Clout + 1 Media + 1 Trust = **4** | same |
| 2 | 1 Trust + 1 Clout + 1 Funds + 1 Clout = **4** | `[VERIFIED https://cf.geekdo-images.com/65-dUTMFKTXKQqJ3tscr0Q__original/img/pic4757447.jpg]` |
| 3 | 1 Funds + 2 Clout + 1 Media + 1 Trust = **5** | `[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.9 illustration]` |
| 3 | 1 Clout + 2 Funds + 2 Media = **5** | `[VERIFIED https://cf.geekdo-images.com/65-dUTMFKTXKQqJ3tscr0Q__original/img/pic4757447.jpg]` |

`[INFERRED]` from the six rows above: cost = voters + 2. Note this is **not** 2 resources per voter
(3 voters for 5, not 6), and cost is not proportional in the naive way.

**Wildcard cost icon.** Some cost icons are a black circle containing `?`, meaning *any one resource
of the player's choice*. `[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.10 — "A [?] indicates that a player can spend any resource of their choice."]`
`[VERIFIED https://cf.geekdo-images.com/65-dUTMFKTXKQqJ3tscr0Q__original/img/pic4757447.jpg — the 1-voter card carries a "?" icon]`

**Card backs** read `VOTERS`, with a `DISCARD VOTERS` discard pile and a `DRAW` area on the HQ Mat.
`[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.9 illustration]`

**Handling rules (verbatim):**
`[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.9]`

> - After influencing a Voter Card, a player must place its voters on the board in a single zone.
> - Any influenced voters must be placed on the board by the end of the same turn. Failure to do so will lead to these voters being discarded.
> - **Voters from a single Voter Card cannot be split across zones.** Voters obtained from any other means can be split.
> - After a Voter Card is influenced, discard it and immediately flip open a new one in its place from the draw pile.
> - There is no limit to how many voters you can influence in your turn.
> - If the draw pile gets emptied, shuffle and reuse all the discarded Voter Cards.
> - If there aren't enough empty areas left in any one zone to place the influenced voters from a single Voter Card, all voters from that card get discarded.

**Conspiracy Cards** are 20 per deck and cost **4-5 resources printed on the back of the card**.
`[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.18 — "They can be bought for any 4-5 resources, as denoted by the cost on the back of the card."]`
`[VERIFIED https://cf.geekdo-images.com/65-dUTMFKTXKQqJ3tscr0Q__original/img/pic4757447.jpg — HQ Mat conspiracy pile shows "COST 5" and "PAY THIS CONSPIRACY BY SPENDING"]`

> **Correction to the brief:** the 4-5 resource cost is printed on the **back** for *Conspiracy* Cards,
> but **face-up on the front** for *Voter* Cards (you can see what you are buying before you buy it).

**Full 60-card distribution: NOT PUBLISHED anywhere I could reach.** `[see Blocked]`

---

## Rulebook — verbatim extracts

All from `https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view` (Essential Edition India Rulebook 2022-23) unless noted.

### Components (p.1-2)

> 1 x Ideology Cards Box / 1 x Double-Sided Game Board / 5 x Player Mats / 250 (50x5) x Voter Tokens /
> 120 x Resources / 108 x Ideology Cards / 20 x Conspiracy Cards / 20 x Headline Cards /
> 60 x Voter Cards / 14 x Zone Requirement Cards / 5 x Player Reference Cards

Resources: 30 Funds + 30 Clout + 30 Media + 30 Trust. Note the **5 player mats and 250 voter tokens** —
this is the 3-5 player box; the 2-player mode is sold separately.

### Objective & Setup (p.6)

> The game ends when all possible majorities in all zones have been formed. The player with the highest number of majority voters wins the game.

> - Each player selects a Player Mat, along with its corresponding bag of voter tokens.
> - All players vote to determine Player 1. In the case of a tie, vote again. Players cannot vote for themselves. Players take turns clockwise.
> - Player 1 receives any 1 resource of their choice from the Public Reserve (i.e., the resource bank). Player 2 receives any 2 resources. Player 3 receives any 3 resources. Player 4 receives any 4 resources. Player 5 receives any 5 resources. Players keep their resources on their Player Mats.
>
> *Designer's Note: This is to offset first player advantage.*

> - Select a campaign. Remove any Ideology Cards if desired, based on Content Advisory.
> - Shuffle that campaign's corresponding decks of Ideology Cards, Conspiracy Cards, and Headline Cards.
> - Place the following on the board: Conspiracy Cards. Headline Cards. **Voter Cards. Draw and place the top 3 cards face up.**

### Forming / Breaking Majorities (p.7-8)

> There are 9 zones on the board. Elections will be contested in each of these zones. **Form a majority in a zone by influencing more than half the voters in that zone.**

> - Each of the 9 zones can hold a maximum number of voters. **The fraction on each zone denotes its majority requirement.**

> *This zone has space for 11 voters. You must place 6 of your own voters out of the 11 total possible voters in this zone to form a majority here.*

> - Every voter token has a blank side and a side marked with its party symbol. Non-majority voters are placed on the board with the blank side up.
> - **A majority is formed in a zone immediately after its majority requirement is met.**
> - To denote a formed majority in a zone, flip over as many voters as were required to form the majority, with the party symbol side up. Each voter used to form a majority (called a "majority voter") earns you 1 point during end-game scoring.

> - **Only the number of majority voters count towards a player's final total in the game.** In the above illustration, placing any more voters in this zone after the first 6 will not earn any additional points and will be kept with the blank side up.

> - A majority can be broken through certain powers and effects. If you no longer have enough voters to meet the majority requirement of a zone, your majority breaks. Flip over your remaining voters blank side up.

### Resources, Cap and Trading (p.10-11)

> - You will earn resources from Ideology Cards and passive Ideologue Powers.
> - **Players have a default resource cap of 12.**
> - **If at any time you cross your resource cap, you must choose and discard any excess resources down to your current resource cap. You cannot take any other actions until you do so.**
> - You can trade resources and Conspiracy Cards with opponents.
> - You can trade resources with other players in any ratio. At least 1 resource must be exchanged by both parties. At least 1 player must be the active player for a trade to occur.
> - You can initiate a trade at any point during your turn.
> - Ideology Cards cannot be traded (unless specified otherwise).

Auction: bid up to your cap; you need not hold the bid; you pay over successive turns but **cannot make any purchases until the bid is fully paid**.

### Ideology Cards (p.12)

> Resources are earned from answering Ideology Cards. At the start of each turn, the player on your right will read aloud both sides of the top Ideology Card for you.

> - You must choose between the 2 available answers, each of which corresponds to an Ideologue and yields a different set of resources. After confirming your answer, keep the card under your Player Mat with your answer face up and receive the resources denoted on it.
> - **Before answering an Ideology Card, you can also choose to have it redrawn by paying any 4 resources to the Public Reserve.** If you do so, the player to your right should discard this Ideology Card and draw a new one.
> - **Keep the Ideology Card hidden until the active player has confirmed their answer.** Every Campaign Box is especially designed for this purpose.

### Ideologues (p.14)

> - **Every Ideologue has a passive power: For every 2 Ideology Cards you hold of an Ideologue, get 1 extra resource of that type.**
> - Collecting 3 Ideology Cards of a single Ideologue unlocks their Level 3 Power.
> - Collecting 5 Ideology Cards of a single Ideologue unlocks their Level 5 Power.
> - Ideologue Powers can be used in the same turn in which they are unlocked.
> - You can have multiple Ideologue Powers active at the same time.

| | Passive | Level 3 | Level 5 |
| --- | --- | --- | --- |
| The Capitalist | 1 Funds / 2 cards | **Prospecting** — once per turn give 1 resource to get up to 2 resources of your choice | **Breaking Ground** — 3x per turn evict any 1 voter (incl. majority voters) |
| The Supremo | 1 Clout / 2 cards | **Donations** — twice per turn snatch 1 resource from another player | **Payback** — twice per turn spend 1 resource to discard 1 opponent voter |
| The Showstopper | 1 Media / 2 cards | **Going Viral** — twice per turn, +1 voter on a Voter Card you influence (max 2 unique cards) | **Election Fever** — Gerrymander 2 voters instead of 1 per zone where you have Gerrymandering Rights (incl. majority voters) |
| The Idealist | 1 Trust / 2 cards | **Helping Hands** — twice per turn, 1 resource discount on a purchase | **Tough Love** — once per turn, spend 2 Trust + any 2 resources to convert 2 of an opponent's voters |

### Gerrymandering (p.15-16)

> Gain Gerrymandering Rights in a zone by having the most voters there. This allows you to Gerrymander (move) one non-majority voter in or out that zone, or in between two adjacent zones every turn.

> - You can only Gerrymander non-majority voters, i.e. voters that are not used to form majorities (unless specified otherwise).
> - You can Gerrymander voters belonging to all players, including your own.
> - If you gain Gerrymandering Rights in a zone during your turn, you may use it in the same turn.
> - **If two or more players are tied for most voters in a zone, no player has Gerrymandering Rights in that zone.**
> - **Voters in Volatile Areas cannot be Gerrymandered.**
> - **Having even 1 voter in a zone with no other voters gives you Gerrymandering Rights in that zone. However, you may not move your only voter out of a zone by using that zone's Gerrymandering Rights.**

### Volatile Areas and Headline Cards (p.17)

> **There are 11 Volatile Areas across the board.** If your voter is placed in a Volatile Area, a Headline is triggered. At the end of the ongoing turn, draw the top Headline Card and resolve it.

> - **A voter token in a Volatile Area stays there permanently. It cannot be Gerrymandered, converted, moved, or affected in any way.**
> - You can either place your own or an opponent's voter into a Volatile Area.
> - If multiple voters are placed in Volatile Areas during a turn, that many Headline Cards will be triggered. **Headline Cards will be resolved in order of the voters that were placed in Volatile Areas.**

### Conspiracy Cards (p.18)

> - Players can only buy the top Conspiracy Card in the draw pile.
> - You can use a Conspiracy Card at any point in your turn. **You can also use one right before an opponent answers their Ideology Card and begins their turn.**
> - There is no limit to the number of Conspiracy Cards you can hold. You can also use multiple Conspiracy Cards at a time, one after the other.
> - If two players use Conspiracy Cards at the same time, they will be resolved in turn order.

### End-Game Scoring (p.19)

> The game ends when all possible majorities in all zones have been formed. **Every voter used to form a majority is worth 1 point.** The player with the highest number of majority voters wins the game.

> - **Only your total number of majority voters will be taken into consideration during scoring, not the number of zones you capture.**
> - Non-majority voters do not add to a player's final score.
> - If every single Voter Area on the board gets filled, without all majorities having been formed, every player will play their final turn, starting with whoever filled the final empty area.

Tiebreaker (optional, non-binding, excluded from Earth 2040): "the player with the greater real-life privilege wins", calculated at `www.playSHASN.com/privilege` **before the game begins**.

### 2 Player Mode (p.20-21)

> Face off with a singular enemy in a relentless battle for every square inch of this unique board. **Shuffle and assign a Zone Requirement to each zone.** To form a majority, you will need to meet an additional condition in every zone.

> - How To Determine Player 1: Each player will receive 8 resources (2 of each type). The players must now secretly bid resources, and reveal their bids at the same time. The player with the higher bid will begin the game as Player 1. All bid resources will go back to the Public Reserve. Players will keep their remaining resources. In case of a tie, bid again.
> - **There are 14 unique Zone Requirements Cards. Shuffle and divide them between the 2 players. Players have to take turns placing these Zone Requirements on the board, until each of the 7 zones has a requirement.**
> - Player 2 will place the first requirement on the board, Player 1 will place the second. Both players will alternate until every zone has a requirement. Therefore, Player 2 will get to determine 4 Zone Requirements and Player 1 will determine 3.
> - Remove all Conspiracy Cards and Headline Cards not applicable to this game mode.
> - **Types of Zone Requirements:**
>   - *One-Time Requirement:* These requirements have to be met only once during the course of the game. Once a player meets the requirements, they must place one voter peg on the Zone Requirement Card to denote their eligibility in that zone.
>   - *While Forming Majority:* These requirements have to be met every time a majority is being formed. If a majority exchanges hands, this requirement must be met again.
>   - *Zonal Rule:* This introduces a rule modification only applicable to the zone this card is played on.
> - To ensure that each Ideology Card is unknown to the opponent, players have to randomly draw Ideology Cards from the middle of the deck whilst picking out cards for each other.

**Note the "7 zones", not 9.** The 2-player board is the reverse side of the double-sided board
`[VERIFIED rulebook p.20-21 — "each of the 7 zones has a requirement"]`;
"Reversible Game Board. Side 1 - 3-5 players. Side 2 - 2 players"
`[VERIFIED https://www.hamleys.in/product/Shasn-The-Political-Strategy-Board-Game-2-5-Players-10Y-Multicolor-494377535]`.

### Order of Turn (p.22) — the canonical sequence

> **START OF TURN**
> - At the start of your turn, the player to your right will draw the top Ideology Card and read both sides aloud to you. You must choose between the 2 available answers.
> - However, before answering, you can choose to have the Ideology Card redrawn by paying any 4 resources to the Public Reserve.
> - After confirming your answer, keep the Ideology Card under your Player Mat with your answer face up. Receive the resources corresponding to your answer, and any other resources earned from passive Ideologue Powers.
> - Check your resource cap. If you cross it, choose and discard any excess resources down to your current cap before taking any other actions.
>
> **TURN ACTIONS** — After taking the above actions, you may take as many of the following actions as you are able to, **in any order**.
> - Influence Voter Cards - Spend resources to influence open Voter Cards on the board.
> - Place Voters - Place influenced and evicted voters on the board.
> - Form Majorities - Form majorities by influencing more than half the voters in a zone.
> - Trade - Trade resources and Conspiracy Cards with players. Players can also trade before answering their Ideology Card.
> - Buy / Use Conspiracy Cards - Spend any combination of resources to buy the top Conspiracy Card(s). You may use them immediately or save them for later. You may buy multiple Conspiracy Cards in a turn.
> - Gerrymander - Gerrymander voters.
> - Ideologue Powers - Use unlocked Ideologue Powers.
>
> You can take the same action multiple times over the course of your turn, if allowed.
>
> **POST TURN ACTIONS**
> - **Players must resolve a Headline Card for each of their voters placed in Volatile Areas during a turn.**
> - Draw and read an Ideology Card for the next player.
> - **Before the next player answers their Ideology Card, any player may choose to play a Conspiracy Card.**

### Coalitions (separate official 1-page document)

`[VERIFIED https://drive.google.com/file/d/17HEr06_mD5Vf-ovEF4sAqSqm0r2AkD3R/view]`

> - Two players can jointly form the majority in a zone and control it together by forming a coalition. **The total of their combined voters must meet the majority requirement of that zone. They can split the majority voters in any ratio, open to negotiation.**
> - **When a coalition is formed, the two players must exchange an Ideology Card with each other. This card must belong to the ideology that they hold the most cards of.** This represents the ideological cost of compromise.
> - Players can form coalitions with different players in different zones. Ideology Cards must be exchanged for every new coalition that is formed.
> - **The gerrymandering rights of a zone belong only to the player with the most voters in that zone. Both coalition members do not get one gerrymander each.**
> - A coalition can break if one of the two players declares withdrawal. **You can declare withdrawal from a coalition at any point during your turn only.**
> - **If a coalition breaks, the Ideology Cards that were exchanged will not be returned to the players.** New coalitions can be formed in a zone after an old one breaks.
> - **During scoring, players get points for each majority voter that they have in a coalition. For example, if two players have a 4:2 coalition in a 6/11 zone, they get 4 and 2 points respectively.**

**Coalitions are edition-dependent — this is the single most likely thing to get wrong.**
The **Essential Edition (2022-23) rulebook index has NO coalitions section at all**
`[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.4 index: Objective & Setup / Forming Majorities / Breaking Majorities / Influencing Voters / Resources / Resource Cap And Trading / Auction / Ideology Cards / Content Advisory / Ideologues / Gerrymandering / Volatile Areas And Headline Cards / Conspiracy Cards / End-Game Scoring / 2 player mode / Order Of Turn / Ideologue Powers Explained]`,
while the **Standard Edition rulebook does** — index lists "Coalitions 10", "Gerrymandering 11",
and the turn actions include "Form or collapse coalitions in their turn".
`[VERIFIED https://www.scribd.com/document/748104565/SHASN-Rulebook]`
And Wikipedia: "the ability to create majorities using a coalition has been cut from subsequent versions of the game."
`[VERIFIED https://en.wikipedia.org/wiki/Shasn]`

### Glossary (p.28) — precise verb definitions

> **Convert:** When you convert an opponent's voter, replace it in the same area with your voter.
> **Discard:** When you discard a voter, remove it from the board permanently.
> **Evict:** When you evict a voter, it is removed from the board and placed back on the mat of its corresponding player. In their turn, that player can place the evicted voter back anywhere on the board. If they fail to do so, the evicted voter gets discarded.
> **Gerrymander:** ... allows you to move one non-majority voter in between adjacent zones every turn, within that zone's area of influence.
> **Donate:** ... When you donate a voter to an opponent, it is converted to their voter.
> **Volatile Area:** Every zone on the board has at least one Volatile Area in it. Placing a voter in a Volatile Area triggers a Headline Card, resolved at the end of the turn. Voters inside Volatile Areas cannot be discarded, evicted, converted, Gerrymandered, or otherwise affected.
> **Area:** Each slot on the board where a voter can be placed is called an Area.

---

## Board structure — the nine zones

**Verified directly from a board photograph** (2019 SHASN Finals winning board, Wikimedia Commons,
rotated upright and read at 3x):
`[VERIFIED https://upload.wikimedia.org/wikipedia/commons/5/5d/Board_from_Shasn_Finals_2019.jpg]`

**Zone multiset: 1x (5/9), 4x (6/11), 2x (9/17), 2x (11/21).**

**Independent arithmetic proof.** Total majority points available on the board =
`5 + 6*4 + 9*2 + 11*2 = 69`. Every official tournament's published scores sum to **exactly 69**:

| Tournament | Published scores | Sum |
| --- | --- | --- |
| 2019 Finals | Austino 23 (20 + 3 coalition), Viraj 20, Adil 14 (6 + 8 coalition), Sahil 12 | **69** |
| 2023 Finals | Dhruvie 24, Anant 17, Jay 16, Sahil 12, Arsheya 0 | **69** |
| 2024 Finals | Harsha 26, Jay 22, Ankur 15, Ravi Teja 6, Sahil 0 | **69** |

`[VERIFIED https://en.wikipedia.org/wiki/Shasn — all three result tables]`

Individual decompositions that fit only this multiset:
Harsha 26 = 11+9+6; Jay 22 = 11+6+5; Ankur 15 = 9+6; Ravi 6 = 6;
Austino 20 = 5+6+9; Viraj 20 = 11+9; Dhruvie 24 = 6+9+9 (he "took over the **second** 9/17 zone" —
confirming exactly two 9/17 zones); Adil's coalition 8 + Austino's 3 = 11 in the 11/21 zone.

**Geometry.** `[INFERRED from the photo — structure is 6 outer / 2 inner / 1 central]`
Zones are named by compass direction. Verified names: **NORTH WEST 6/11** and **NORTH EAST 6/11**
`[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view p.9 illustration labels]`;
**central zone is 5/9** `[VERIFIED https://en.wikipedia.org/wiki/Shasn — "taking control of the central zone (5/9)"]`;
the rulebook's gerrymandering example names **North-West**.

| Zone | Voters (denominator) | Majority needs | Notes | Source | Confidence |
| --- | --- | --- | --- | --- | --- |
| Central | 9 | 5 | Only 5/9. Visually distinct (olive/darker fill). Named "central zone". | board photo + Wikipedia | **High** — fraction VERIFIED, name VERIFIED, adjacency INFERRED |
| North West | 11 | 6 | Zone name printed on board | rulebook p.9 label + board photo | **High** |
| North East | 11 | 6 | Zone name printed on board | rulebook p.9 label + board photo | **High** |
| South West | 11 | 6 | 4 identical 6/11 zones exist; only NW/NE names are confirmed | board photo (position) | **Medium** — fraction High, name INFERRED from compass symmetry |
| South East | 11 | 6 | as above | board photo (position) | **Medium** |
| East | 17 | 2 of 9 total, so one 9/17 zone here and one opposite | "the second 9/17 zone" implies exactly two | board photo + Wikipedia 2023 | **Medium** |
| West | 17 | 9 | as above | board photo + Wikipedia 2023 | **Medium** |
| North Central (inner) | 21 | 11 | Inner band above the centre | board photo | **Medium** |
| South Central (inner) | 21 | 11 | Inner band below the centre | board photo | **Medium** |

**Totals:** 9 zones, **129 voter Areas** (9 + 44 + 34 + 42), **69 majority points** in total.

**Majority threshold formula:** `floor(voters / 2) + 1` — i.e. **strictly more than half**, and the
printed numerator is exactly that number. Verified against all four zone sizes (9→5, 11→6, 17→9, 21→11).
`[VERIFIED rulebook p.7 — "influencing more than half the voters in that zone"; "The fraction on each zone denotes its majority requirement"]`

**2-player mode uses 7 zones, not 9** `[VERIFIED rulebook p.21]`. Which 7, and whether the 2-player
side reuses the same fractions, is **not established** — see Blocked.

---

## Mechanics that contradict a naive assumption

1. **A majority is STRICTLY more than half, and the printed numerator is the threshold — but only the
   exact threshold number of voters scores.** Real rule: "Form a majority in a zone by influencing
   more than half the voters in that zone"; "flip over as many voters as were required to form the
   majority"; "placing any more voters in this zone after the first 6 will not earn any additional
   points and will be kept with the blank side up." Naive assumption: `>= n/2` (would give 4/9, 5/11,
   8/17, 10/21) and/or "extra voters in a majority zone are worth extra points". Both wrong.
   `[VERIFIED https://drive.google.com/file/d/1kijP6Qdi_HoDDTaGsVtU_FT1RU2Drse0/view pp.7-8]`

2. **Score is total majority VOTERS, not number of zones, and zones are not worth a flat amount.**
   Real rule: "Only your total number of majority voters will be taken into consideration during
   scoring, not the number of zones you capture." A 5/9 zone is worth 5 points and an 11/21 zone is
   worth 11. Naive assumption: 1 point (or a fixed value) per zone won. This is why tournament tables
   read "24 points (3 zones)" = 6+9+9. `[VERIFIED rulebook p.19 + https://en.wikipedia.org/wiki/Shasn]`

3. **Game end is a board-state condition, not a player objective.** Real rule: "The game ends when all
   possible majorities in **all zones** have been formed." Naive assumption: game ends when one player
   controls a majority in enough zones, or on a round limit. There is also a board-full fallback:
   if all Areas fill first, everyone plays one final turn starting with whoever filled the last Area.
   `[VERIFIED rulebook p.19]`

4. **Coalitions: present in the Standard rules, ABSENT from the Essential Edition (2022-23) rulebook.**
   The Essential Edition index contains no coalitions section at all. If the project implements
   coalition majorities as current rules, it is implementing a cut rule. Where coalitions do apply:
   formation requires the **combined** voters to meet the zone threshold, the split is negotiable to
   any ratio, **each player scores only their own share of the majority voters** (4:2 in a 6/11 zone =
   4 and 2 points, *not* 6 each), formation **costs each player one Ideology Card of their plurality
   ideology** (not returned if the coalition breaks), and **gerrymandering rights in the zone go to
   only the larger member** — not one each. Withdrawal is legal only on your own turn.
   `[VERIFIED https://drive.google.com/file/d/17HEr06_mD5Vf-ovEF4sAqSqm0r2AkD3R/view]`
   `[VERIFIED https://en.wikipedia.org/wiki/Shasn — "the ability to create majorities using a coalition has been cut from subsequent versions of the game."]`
   `[VERIFIED https://www.scribd.com/document/748104565/SHASN-Rulebook — Standard edition index lists "Coalitions 10" and turn action "Form or collapse coalitions in their turn"]`

5. **Headline Cards: trigger is placing a voter into one of 11 Volatile Areas, and resolve at END of
   turn — after everything else.** Real rule: "There are 11 Volatile Areas across the board. If your
   voter is placed in a Volatile Area, a Headline is triggered. At the end of the ongoing turn, draw the
   top Headline Card and resolve it." Multiple placements in one turn queue multiple Headlines,
   **resolved in the order the voters were placed**. Headlines are a **post-turn** step, so they can
   break a majority you just formed. Naive assumption: an immediate interrupt on placement, or a
   per-round deck of news events. Also note: a Volatile Area voter is **permanently immune** — it cannot
   be gerrymandered, converted, evicted, discarded or otherwise affected — and either player's voter
   may be the one that triggers it. `[VERIFIED rulebook p.17 + HQ Mat art "TRIGGERED AT END OF TURN",
   https://cf.geekdo-images.com/65-dUTMFKTXKQqJ3tscr0Q__original/img/pic4757447.jpg]`

6. **Resource cap is 12, and it is checked at ANY time, not end of turn.** Real rule: "If at any time
   you cross your resource cap, you must choose and discard any excess resources down to your current
   resource cap. **You cannot take any other actions until you do so.**" Naive assumption: cap of 10, or
   a cap applied only when the turn ends (which would let a player spend down freely). The cap is
   "default" 12, implying cards/effects can raise it. `[VERIFIED rulebook p.11]`

7. **Ideology Cards: the answer TEXT is public, the RESOURCES behind each answer are secret.** Real
   rule: the player on your right "will read aloud **both sides**" — so both answers and their
   ideological framing are public information — but "The resources of each answer should not be
   revealed to the player until they have locked their answer", the card is kept "hidden until the
   active player has confirmed their answer", and a Campaign Box exists specifically to hide it. Naive
   assumption: the full card including resource payouts is face-up like a Voter Card, so players
   optimise against known payouts. Additionally: **before answering you may pay any 4 resources to
   have the card redrawn** — a mechanic that is easy to miss entirely.
   `[VERIFIED rulebook pp.12, 22 + HQ Mat art "KEEP THIS IDEOLOGY CARD HIDDEN"]`

8. **Gerrymandering rights come from having the MOST voters, and a single voter is enough.** Real rule:
   "Having even 1 voter in a zone with no other voters gives you Gerrymandering Rights in that zone.
   However, you may not move your only voter out of a zone by using that zone's Gerrymandering Rights."
   **A tie for most means NOBODY has rights in that zone.** Default is one non-majority voter per turn,
   in or out of that zone, or between two adjacent zones, and it applies to *anyone's* voters
   including your own. Naive assumption: rights require a majority, or a fixed number like 3 voters.
   `[VERIFIED rulebook pp.15-16]`

9. **Voters from one Voter Card are atomic.** Real rule: "Voters from a single Voter Card cannot be
   split across zones... Any influenced voters must be placed on the board by the end of the same turn...
   If there aren't enough empty areas left in any one zone to place the influenced voters from a single
   Voter Card, **all voters from that card get discarded**." Naive assumption: split freely, or park
   them. Also: exactly **3 Voter Cards are open at all times** and the discard pile is reshuffled into
   the draw pile when exhausted, so the deck is effectively infinite. And there is **no limit** to how
   many Voter Cards you can influence in one turn — the binding constraint is the resource cap, not a
   per-turn action count. `[VERIFIED rulebook p.9]`

10. **Ideology Cards are kept, under your mat, answer face-up — they are your power resource.** Passive
    power is "For every 2 Ideology Cards you hold of an Ideologue, get 1 extra resource of that type"
    *every turn*, and the card is only removed by trading it away for a coalition. Naive assumption:
    answering a card is a one-shot resource burst with no persistent state. Naive assumption 2: the
    card is drawn from the top of the deck — in 2-player mode players must "randomly draw Ideology
    Cards from the middle of the deck whilst picking out cards for each other" so the card is unknown.
    `[VERIFIED rulebook p.14 + p.21]`

11. **The Ideology Card is read by the player on your RIGHT, and that player may pre-empt you.** Real
    rule: "At the start of your turn, the player to your right will draw the top Ideology Card and read
    both sides aloud to you"; and in post-turn actions, "Before the next player answers their Ideology
    Card, **any player** may choose to play a Conspiracy Card" — and Conspiracy Cards "can be used
    immediately or saved for later", can be bought "only [from] the top Conspiracy Card in the draw
    pile", and simultaneous plays "will be resolved in turn order". Naive assumption: cards resolve
    only on your own turn. `[VERIFIED rulebook pp.18, 22]`

12. **Setup resource grant is by player NUMBER, not seat, and it is 1/2/3/4/5.** "Player 1 receives
    any 1 resource of their choice... Player 5 receives any 5 resources." The player order is decided
    by a group vote (players cannot vote for themselves; tie → revote). In 2-player mode this is
    replaced entirely by a **secret simultaneous resource bid**, higher bid wins Player 1.
    `[VERIFIED rulebook pp.6, 20]`

13. **A majority can be BROKEN and zones can change hands.** "If you no longer have enough voters to
    meet the majority requirement of a zone, your majority breaks. Flip over your remaining voters
    blank side up." Several Ideologue powers explicitly operate on majority voters (Capitalist L5
    evicts them, Supremo L5 discards them, Showstopper L5 gerrymander them, Idealist L5 converts them).
    Naive assumption: a formed majority is locked until end of game. `[VERIFIED rulebook pp.8, 23-26]`

---

## Blocked / not found

- **Full 60-card Voter Card distribution (how many 1-voter / 2-voter / 3-voter).** Not published in
  any rulebook, retailer listing, or review I found. Tried: the Essential Edition PDF in full (only
  states "can contain 1, 2 or 3"); the Standard rulebook via `r.jina.ai`; the two official Shopify
  product pages; BGG's full 66-image gallery. Recovered instead: the **cost formula** (voters + 2) from
  six photographed cards, and the wildcard `?` icon. Any project-side distribution for the 60 cards is
  an assumption, not a recovered fact.

- **Scribd `748104565` (SHASN Standard rulebook, 17pp) — pages 9-17.** Pages 1-8 came through
  `r.jina.ai` (index, contents, overview, setup, order of turn, resource cap 12). Pages 9-17
  (Influencing Voters, Forming a Majority, Coalitions, Gerrymandering, Resource Trading and Cap,
  Ideologues, Volatile Zones, Headline Cards, Conspiracy Cards, Scoring, Ideologue Powers) are behind
  the signup wall; the `/embeds/` route returns one page at a time and needs an `access_key` I could
  not obtain. **Mitigated**: the Essential Edition PDF covers all of these mechanics and I have it in
  full, so nothing was actually lost except the Standard edition's exact coalition/ideologue wording.

- **Scribd `1075247099`** — redundant. Same 32pp document as the Drive PDF; only the index page was
  readable. No loss.

- **`https://boardgamegeek.com/boardgame/257305/shasn/images`** — Cloudflare interstitial ("Performing
  security verification"). Also `boardgamegeek.com/xmlapi2/thing?id=257305` returns **401**. Worked
  around via `https://api.geekdo.com/api/images?objectid=257305&objecttype=thing` (unprotected) and
  `cf.geekdo-images.com` for the pixels.

- **Zone Requirement Card (14 unique) faces.** The rulebook gives the three *types* and the
  distribution/placement procedure, but no card text. Extracted the page-30/31 art from the PDF and it
  turned out to be a campaign advertisement, not the cards. A 2-player final board photo shows the
  cards face-down/as blanks. **Not recovered.**

- **Exact adjacency graph of the nine zones.** The board photo gives a clear 6-outer / 2-inner /
  1-central reading, and inner-to-centre contact is visually obvious, but I did not resolve every
  outer-to-outer pair. Gerrymandering depends on adjacency, so **this needs the physical board** or a
  clean top-down scan. Confidence on the 6/2/1 structure is Medium, not High.

- **Which 7 zones are used in 2-player mode, and whether their fractions change.** The rulebook says
  only "each of the 7 zones". The double-sided board claim comes from a retailer listing, not Memesys.
  Also unresolved: whether the 2-player side redistributes the 129 Areas.

- **4 of the 6 remaining zone names.** Only NORTH WEST, NORTH EAST and "central" are printed/attested.
  SOUTH WEST / SOUTH EAST / EAST / WEST / NORTH CENTRAL / SOUTH CENTRAL are my positional inferences.

- **Per-zone Area counts read off the physical board.** Denominators (9/11/17/21) are confirmed by the
  printed fractions and the 69-point arithmetic, so Areas per zone follow — but I did not count the
  physical circles, so I cannot rule out a printed fraction that disagrees with the Area count.

- **Source error to be aware of:** Wikipedia's 2023 write-up says Dhruvie won "holding the 6/11 and
  **9/11** zones". There is no 9/11 zone; this is a typo for 9/17 (the same sentence later says he took
  "the second 9/17 zone", and 6+9+9 = 24 confirms it). Do not propagate 9/11.