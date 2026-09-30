# SHASN — Authentic Reference (Web Research)

**Purpose:** fidelity data for the digital reimplementation — what the *real* game actually
contains, looks like, and sounds like. Companion to `docs/rules-reference.md` (which already
owns every rulebook number; this file does **not** repeat it).

**Compiled:** 2026-09-30 · **Research type:** web research. No source code was modified.

**Evidence tags used throughout:**
- `[VERIFIED <url>]` — read directly on the cited page.
- `[INFERRED]` — reasoned from evidence; the reasoning is stated inline.
- `[UNKNOWN]` — searched, not found. Recorded so nobody re-searches it blindly.

---

## 0. Executive summary

**The five findings that most change what you should build:**

1. **The board is a topographic contour map, not a choropleth, and the zones are not colour-coded.**
   The real board is a near-black olive ground with a city-skyline silhouette, a cream landmass
   filled with **fine concentric contour lines**, zones separated only by **thick slate-blue
   borders**, voter areas as **plain pale dots**, and the 11 Volatile Areas as **large black
   cog/sunburst rosettes** ~2.5× the size of a dot. Zone labels are `SMALL-CAPS NAME` over a big
   `majority/capacity` fraction over a tiny direction word. `gen-board.mjs` produced a
   *coastline*; the real thing is a contour texture and the zone interiors are unfilled. (§6.1)

2. **The X-card schema in `cards.ts` is the real problem, not the Ideology schema.** The real
   Ideology Card is exactly `{question, two sides, ideologue-per-side, payout, campaign,
   advisory}` — **the engine's `IdeologyCard` is already a correct match**, and the real cards
   turn out to be *more* austere than the schema (no flavour text, no scenario framing). By
   contrast, the 12-op `Effect` union **cannot express roughly 40% of real Conspiracy/Headline
   effects**. The cheapest high-value fix is a `duration` field (`this-turn`/`round`/
   `rest-of-game`); the hardest is the five **phase-changing** ops (`block`, `deflect`, `auction`,
   `vote`, `pass-card`) which do not belong in an `Effect[]` at all. (§5.4)

3. **Real Ideology Card payouts do NOT include the answerer's own resource.** The shipped
   "SHOULD WE INVADE NEW SPAIN?" card's *Capitalist* side pays **2 Trust + 1 Media and zero
   Funds**. `Delta = Partial<...>` is correct; a validator requiring a Capitalist answer to pay
   Funds would reject a real card. Payouts are printed as **one icon disc per resource, never as
   numerals**, so `sidePayout()` is a balance-checker helper only and must never drive the UI.
   (§5.2)

4. **A real Ideology Card is one object printed on BOTH faces, with a `▼` side-marker on the
   seam between the question band and the answer.** The ▼ is how the reader physically indicates
   which side they're reading — it is the hidden-information mechanic rendered as a physical
   gesture. The engine has no equivalent and no stable face order. This is a free, very
   high-fidelity UI win. (§5.3)

5. **The Player Mat is the Manifesto dashboard, and the mat's L5 name contradicts the
   rulebook.** The mat prints `3` and `5` in numbered circles with tick-boxes (the unlock
   thresholds), a row of rule-lines for the passive +1-per-2-cards pips, a notched top strip
   where your answered Ideology Cards slide in, and the power names in caps. Critically the
   mat says **CRACKING GROUND**, not the rulebook's **Land Grab** — `powers.ts:22` uses
   `land-grab` / `name: 'Land Grab'`. Use the mat name in the UI. (§5.6, §6.4)

**Cards actually recovered: 55 verbatim.** 15 Conspiracy Cards and 20 Headline Cards (Earth
2040 deck) with complete official rules text, plus ~19 more Headline Cards across India / USA /
Rome from a second official document, plus 4 India Conspiracy Cards (Chai-Paani, Jumla, Block,
Cult-ivating Obedience), plus 1 Ideology character card, plus ~12 partial Ideology
questions/answers legible in table photography, plus the full print-and-effect text of 3 Voter
Cards. Source: Memesys' own **"X Cards Explained" player-aid documents** (Scribd ids 515528021,
814006944, 915391788, 915391789) — these are official Memesys publications, not fan speculation.

**The one thing that did not land:** the verbatim text of *ordinary question* Ideology Cards.
Zero recovered. Those exist only as images on the physical product and in video frames, and
neither YouTube nor Reddit nor BGG was reachable (details in §1 and §2.4). **Do not fabricate
them** — §8 gives the register and §8.2 the rules, and §2.4 lists the three places that would
actually solve it.

**Two corrections to the brief's own premises:**
- The BGG id is **257305**, not 298049.
- `rules-reference.md` §14 says the 2-player mode "requires the separate 2–3 player board",
  but the Essential Edition contents list **one** "Double-Sided Game Board" and the official
  render is captioned **"DUAL LAYERED BOARD."** These conflict. Resolve before implementing §14.

---

## 1. Source inventory

| # | Source | URL | What it yielded | Access |
|---|---|---|---|---|
| S1 | Memesys "Headlines and Conspiracies Explained" (35 pp, all 5 launch campaigns) | `scribd.com/document/515528021/` | India + US conspiracy/headline names, card-resolution conventions. Body text is **image-only on p1**; only the AI blurb + search snippets came through. | partial |
| S2 | "2024 Headline And Conspiracy Cards Explained" (10 pp) | `scribd.com/document/814006944/` | **19 real Headline Cards verbatim** across India / USA / 2040 / Rome. | ✅ via `r.jina.ai` |
| S3 | "2040 Deck CC" (3 pp) | `scribd.com/document/915391788/2040-Deck-CC` | **15 real Conspiracy Cards verbatim** + the conspiracy-window preamble. | ✅ via `r.jina.ai` |
| S4 | "2040 Deck HC" (3 pp) | `scribd.com/document/915391789/2040-Deck-HC` | **20 real Headline Cards verbatim** + the headline-resolution preamble. | ✅ via `r.jina.ai` |
| S5 | Essential Edition India Rulebook 2022-23 (32 pp) | `scribd.com/document/1075247099/` | Essential-edition component counts, board sheet names, rulebook reading convention. Body mostly image-scanned. | partial |
| S6 | English Wikipedia "Shasn" | `en.wikipedia.org/wiki/Shasn` | Cult-ivating Obedience full effect, three tournament score tables, campaign roster, edition history, **"Showstopper was originally called The Showman."** | ✅ |
| S7 | Official site `playshasn.com` | `playshasn.com/home` | Official pitch copy, verbatim. `/play` page is **empty** (JS-only). | ✅ |
| S8 | Rulebook PDF mirror | `gamers-hq.de/media/pdf/18/ac/d8/SHASN_Rulebook_-_Digital.pdf` | Exists; **>5 MB, exceeds the fetch tool limit.** | ❌ |
| S9 | BGG | `boardgamegeek.com/boardgame/257305/shasn` (correct id — the 298049 in the brief is wrong) | — | ❌ 403 / Cloudflare. Also the `/geeksearch` path. |
| S10 | YouTube | — | **No video content retrieved.** No transcript access, no description scraping. | ❌ |
| S11 | Reddit | `reddit.com/search/?q=SHASN+ideology+cards` | Returns an empty shell (JS). r/boardgames threads not reachable. | ❌ |
| S12 | `boardgamegeek.com/boardgame/357633/shasn-india-2019-20-ideology-cards` | BGG | Confirms **campaign decks exist as separate BGG entries** and are described only as *"changes the ideology cards included in SHASN base game to immerse the players in the politics of the modern India."* | snippet only |
| S13 | Facebook / Instagram official SHASN post | `facebook.com/shasnthegame/posts/...939470424853158/` | **A real Ideology Card side-pair, verbatim** — see §2. | snippet only |

**Access method that works:** prefix any URL with `https://r.jina.ai/` and request `markdown`.
Direct Scribd fetches return only page metadata; the r.jina.ai reader executes the JS and
returns the OCR'd text layer. Search engines: DuckDuckGo HTML worked for the first few queries
then rate-limited; Bing returned garbage for this query class; Mojeek and searx.be both
presented captchas.

---

## 2. Card corpus — real Ideology Cards

This is the weakest section and the one that matters most. Reported honestly.

### 2.1 What was actually recovered

**One real Ideology Card, side-pair only** — `[VERIFIED https://www.instagram.com/p/C4h-VrzIvQZ/ ·
https://www.facebook.com/shasnthegame/posts/the-supremo-capitalist-often-wonders-to-himself-is-it-still-xenophobia-if-i-make/939470424853158/]`
> *"The **Supremo**-**Capitalist** often wonders to himself, "Is it still xenophobia if I make a lot
> of money?"* — Art by: @lahiri_moshai

This is decisive evidence about the real card format and is analysed in §5. It is **not** a
question card; it is a *character card* featuring a hybrid of two Ideologues.

### 2.2 Confirmed structural facts about Ideology Cards (from the above + BGG + press)

`[VERIFIED]` unless noted.
- Ideology Cards are **per-campaign**. Five launch campaigns (India 2020, USA 2020, UK 2019-20
  Brexit, Fall of the Republic: Rome 40 BCE, The Future of Humanity: Earth 2040) `[Wikipedia]`.
  Later: India 2022-23. AZADI added Indian Independence 1947, Russian Revolution 1917, American
  Revolution 1776, Egyptian Revolution 2011, Mars 2165, plus French Revolution and Indus Valley.
- Counts: 108 per campaign in the Kickstarter/Collectors edition; 432 total across the
  Presidential edition = 108 × 4 `[rules-reference.md §3, corroborated by Wikipedia]`.
- Every card's two answers belong to **two different** Ideologues `[rules-reference p13]`.
- Cards carry a **Content Advisory** flag; a table may vote to remove flagged cards before play
  `[rules-reference p14; confirmed present in the Essential Edition contents: "Ideology Cards" and a
  "Content Advisory" rule section at p14]`.
- Ideology Cards are also **consumed as game objects**, not just kept as a score: Jumla / Holo
  Sapiens add an "extra Ideology Card of your choice"; A COWARD OR A JOURNALIST? / Card Games
  have players **donate** an Ideology Card to an opponent for 6 resources; 404 makes two players
  "answer each other's Ideology Cards"; Coalitions (p13 of the official site) are formalised by
  exchanging one. `§4`
- **Showstopper was originally "The Showman."** `[VERIFIED https://en.wikipedia.org/wiki/Shasn]`
  The Indian Express 2022 piece still uses **Showman**. Any card text or UI that references
  "The Showman" is authentic-to-2019, not an error.

### 2.3 Real distribution data recovered (from tournament score tables)

`[VERIFIED https://en.wikipedia.org/wiki/Shasn]` — every player's final hand at a national-final
table, which is a real (if biased) sample of the Ideology Card corpus:

| Event | Player | Capitalist | Supremo | Showstopper | Idealist | Total cards |
|---|---|---:|---:|---:|---:|---:|
| 2019 Final | Austino Paul | 4 | 1 | 5 | 0 | 10 |
| 2019 Final | Viraj Kaoshal | 0 | 5 | 5 | 0 | 10 |
| 2019 Final | Adil Aziz | 3 | 3 | 3 | 0 | 9 |
| 2019 Final | Sahil Parsekar | 2 | 1 | 2 | 4 | 9 |
| 2023 Final | Dhruvie | 0 | 0 | 5 | 4 | 9 |
| 2023 Final | Anant Lamba | 3 | 3 | 2 | 0 | 8 |
| 2023 Final | Jay Jarosz | 2 | 0 | 1 | 5 | 8 |
| 2023 Final | Sahil Parsekar | 3 | 0 | 0 | 5 | 8 |
| 2023 Final | Arsheya Joshi | 4 | 1 | 3 | 0 | 8 |
| 2024 Final | Harsha Prabhu | 3 | 0 | 4 | 5 | 12 |
| 2024 Final | Jay Jarosz | 0 | 3 | 4 | 5 | 12 |
| 2024 Final | Ankur Mishra | 4 | 0 | 5 | 3 | 12 |
| 2024 Final | N Ravi Teja | 3 | 6 | 1 | 1 | 11 |
| 2024 Final | Sahil Parsekar | 2 | 5 | 4 | 0 | 11 |

`[INFERRED]` Observations a card writer can use:
- **Idealist is systematically under-represented at the top table.** 8 of 14 hands hold 0
  Idealist cards; the four best scores with a nonzero count cluster at exactly 4–5. A 108-card
  campaign that hands out cards 1:1 across 4 Ideologues would produce a flat binomial. This
  distribution is **not** flat. `[INFERRED]` the India campaign's answer pool is skewed toward
  Capitalist and Supremo, which matches their real-world salience in the source material.
- **Idealist almost never coexists with Supremo.** Look at every row: 4,0 / 0,0 / 0,0 / 3,0 /
  3,1 / 2,0 / 3,0 / 0,5 / 0,5 / 5,3 / 5,5 / 3,3 / 6,1 / 5,0. Six of fourteen hands are
  (Idealist>0, Supremo=0). `[INFERRED]` The two Ideologues occupy largely **disjoint question
  space** — a card never has one Idealist side and one Supremo side, or Idealist cards would pair
  with Supremo all the time. **Design consequence: an Ideology Card is not 6 unordered pairs
  chosen at random from 4 colours; it is a curated pairing table, and 2 of the 6 possible
  cross-ideology pairings are probably absent or rare in the India deck.**
- Total cards in hand after 8–12 turns is **8–12**, so a 108-card campaign is only ~10% consumed
  in a typical 5-player game. `[INFERRED]` 108 is sized for many replays with one shared deck,
  and the *effective* card count per session is ~40-50 cards drawn from 108.

### 2.4 What could NOT be recovered

`[UNKNOWN]` — searched, not found:
- The **text of a single ordinary question Ideology Card** (question stem + the two answer
  strings). Press coverage describes the category in general — "divisive policy questions on
  everything from climate change to birth control, each with two answers to pick from"
  `[VERIFIED https://www.playshasn.com/home]`; "questions on real-world political, social, and
  ethical issues" `[Wikipedia]` — but **not one card's literal text is published in any
  crawlable text source.** The cards exist only as images on the physical product, in photo
  reviews, and in YouTube video frames.
- Any printed **resource payout** on an Ideology Card. Not in any text source.
- The Content Advisory legend's actual symbols.

**Recommended next steps, in order of expected yield:**
1. **Tabletop Simulator mod.** The Steam Workshop almost certainly has a SHASN mod; TTS mods
   ship the actual card art/JSON. `steamcommunity.com/sharedfiles/filedetails/?id=…` is
   scrapeable and was not reachable in this session. Highest value per query.
2. **Photo reviews.** Dice Tower's SHASN video thumbnail gallery, `meeplemountain`/`Space Biff`
   review photo sets, and BGG image galleries (`cf.geekdo-images.com`) are CDN-hosted and
   directly fetchable without a Cloudflare challenge. BGG *image* URLs are the practical way
   around S9's block. Search them for "ideology card" in the filename.
3. **Buy the deck.** The Essential Edition India 2022-23 is the cheapest route to 108 real cards
   and legally the cleanest. This is the one "research" action that solves §2 outright.

**Do not fabricate card text.** If none of the above lands, write original cards in the recovered
register and cite §8.

---

## 3. Card corpus — Voter Cards

`[UNKNOWN]` — no published Voter Card cost/voter-count distribution exists in any crawlable
text source. Confirmed only:
- 60 Voter Cards per box; a card carries a **combination** of the four resources and yields
  **1, 2 or 3 voters** `[rules-reference p10]`.
- **Essential Edition ships 250 Voter Tokens (50 × 5)**, not 300 `[VERIFIED S5 contents page]`.
  The Collectors Edition ships 300. The digital version's per-player peg budget should follow
  the *current* physical edition: 50 per player.
- Cards are displayed **face up** on the market, three at a time, and are **discarded and
  replaced** after being influenced `[rules-reference p10]`.
- From real card text `[VERIFIED §4]`: Voter Cards are a *named, countable* category —
  "3 Voter Card", "1-Voter Card", "the next 2 Voter Cards that they influence" — and several
  effects discriminate **by size** (Lab-Grown Earworm, Power Trip, Don't Kiss The Babies,
  Eradicating Germs, Fatality). The 1/2/3 split is load-bearing in the rules, not cosmetic.
- Board game GeekStash: the India 2020 campaign's Voter Card art shows **a resource-cost cluster
  plus a large numeral** `[UNKNOWN — visual, not textually confirmed]`.

---

## 4. Card corpus — Conspiracy Cards & Headline Cards

**This is the single richest vein found.** Memesys published official "X Cards Explained"
Google Docs (one per campaign), later mirrored on Scribd. They give **verbatim card names and
full rules text**. Fetch them through `r.jina.ai` — direct Scribd fetches return only metadata.

Working access pattern:
`https://r.jina.ai/https://www.scribd.com/document/<id>/<slug>`

Known documents (partial list; the set is incomplete — see §10):

| Doc | id | Campaigns covered |
|---|---|---|
| "Headlines and Conspiracies Explained – Google Docs" | 515528021 | 35 pp. India, US, 2040, Rome, Brexit |
| "2024 Headline And Conspiracy Cards Explained" | 814006944 | 10 pp. multiple campaigns |
| "2040 Deck – Conspiracy Cards" | 915391788 | 3 pp. Earth 2040 conspiracies |
| "2040 Deck – Headline Cards" | 915391789 | 3 pp. Earth 2040 headlines |
| "Essential Edition India Rulebook 2022-23" | 1075247099 | 32 pp. |

### 4.1 Real Headline Cards (verbatim card names + rules text)

All of the following are `[VERIFIED https://www.scribd.com/document/814006944/2024-Headline-And-Conspiracy-Cards-Explained]`
unless another URL is given.

**Campaign: India** (Hindi/Urdu-flavored transliterations)
- **GREAT LEADER, BAD ECONOMY** — "For the rest of the game, every time you influence a 3 Voter Card, the player after you may move 1 of your non-majority voters to an adjacent zone."
  - Bullets: applies to purchased *and* free cards; the move is **in addition to** their Gerrymandering Rights; they may move the voter *immediately* after you influence, before you place your own voters.
- **DOSTI BANI RAHE** — "Pick an opponent. In their next turn, they may use all your Gerrymandering Rights."
  - Uses the rights value **at the point on their turn**, not at trigger time; in addition to their own; expires after that turn.
- **KHAKI TERROR** — "Donate 1 resource of each type to the Public Reserve. You cannot make any purchases until you do so."
  - *Punchline mechanic:* a soft-lock. Resources are physically placed **on the card**; when all 4 are donated the card is discarded with them. Other actions remain legal.
- **GROWING DISSENT** — "Starting this turn, for 1 round, gain 1 voter every time any opponent Gerrymanders your voters." Gained voters are placed immediately. "1 round" = until everyone has played one turn.
- **A CALL FROM KARACHI** — "Draw the top 3 Conspiracy Cards. Keep 1 and shuffle the other 2 back in the deck. You don't need to reveal this card to other players. You must now auction the card off, starting at 2 resources."
- **STAY IN YOUR LIMITS** — "Every player converts 2 voters of the player to their left. Each player that doesn't break a majority gets 2 resources." In turn order starting with you; you *may* break a majority; the 2 resources are only for converting non-majority voters.

**Campaign: USA 2020**
- **POLO RETREAT** — "Pick 2 players. They can use each other's unlocked Level 3 Ideologue Powers in addition to their own in their next turns. If either of the players don't have any unlocked Level 3 Powers, both players can use any one Level 3 Power of their choice." You may pick yourself.
- **NEXT BILLION DATA POINTS** — "The next Conspiracy Card in the draw pile is up for grabs at no cost. All players must vote for who should receive it. They cannot vote for themselves. In case of a tie, vote again."

**Campaign: Earth 2040**
- **PYTHONPOST** — "For the rest of the game, you have to pay an extra resource for every Conspiracy Card that you buy." A permanent tax. No expiry clause needed.
- **SUBMERGED** — "Starting with you, every player can Gerrymander 1 majority or non-majority voter immediately. These voters cannot be placed into Volatile Areas." One-shot, based on rights held at trigger time.
- **COUGH IT UP** — "All your opponents evict 1 voter. If a player breaks a majority using this action, all other players gain 1 resource of their choice."

**Campaign: Fall of the Republic (Rome 40 BCE)**
- **NERO'S GUESTS** — "Move any 3 voters in this zone. OR Move any 3 voters out of this zone." All-or-nothing (in or out, never mixed); may move anyone's voters; majority voters **may** be moved; moves are only to/from **adjacent** zones; "this zone" = the volatile zone that triggered it.
- **ON THE "HIGH" SEAS** — "Place 4 of your voters from the board on this card. They are held hostage. You may pay a resource to buy a voter back." Rescued voter goes to your mat, and you may place it immediately in any zone. **This is a persistent board-resident object, not a resolve-and-discard card.**
- **A COWARD OR A JOURNALIST?** — "Starting from you, each player can donate 1 of their Ideology Cards to the opponent on their left. They will receive 6 resources of their choice for doing so." Clockwise, optional, and you may pass along a card you just received.
- **BLESSINGS OF PARENTS PAST** — "Draw 2 Voter Cards. Keep 1 and donate the other to an opponent. These Voter Cards are influenced for free immediately." Look at both, choose which to keep; **you place your influenced voters first**, then the opponent places theirs.

### 4.2 Real Conspiracy Cards

#### 4.2.1 Earth 2040 deck — 15 cards, verbatim
`[VERIFIED https://r.jina.ai/https://www.scribd.com/document/915391788/2040-Deck-CC]`
(preamble notes: *"Conspiracy cards can be used during your turn phase or just before an
opponent answers his/her ideology card…"*; *"The term voter implies majority, minority, and
chaos voters but not volatile voters."*; *"If there are no voters to discard then effect is over."*)

| Name | Verbatim effect | Ops the engine would need |
|---|---|---|
| **A Grave Inheritance** | Every opponent must pay you any 2 resources. Evict 2 voters belonging to every player who fails to pay you. | conditional-on-payment eviction, per-opponent |
| **Block** | Play this immediately out of turn when an opponent plays a Conspiracy Card to negate its effect. *[OR]* Discard an open Conspiracy Card or Headline Card. Cannot be reversed or deflected. May be used to block a card *stealing this card*. Actions not directed at you may also be blocked. A block may be used to cleanse an already-active card. For multi-turn cards the block must be done immediately, not midway. | out-of-turn reactive, targets **any** card, cancels persistent effects |
| **Cut, Copy, and Paste** | At the end of your turn, select 1 of your majorities. Discard all your voters in that zone. If any empty area is left in this zone at the start of your next turn, convert all its voters into yours, and fill all remaining areas with your voters. Can only be blocked at the very beginning. | **spans two turns**, zone-scoped, convert-ALL-in-zone + fill-to-capacity |
| **Deep Thoughts** | Select an opponent and use all their Level 3 Ideologue Powers this turn. You cannot use the same Ideologue Power twice. | borrow opponent's powers |
| **Deflect** | When an opponent plays a Conspiracy or Headline card that affects you, you may play this immediately to redirect its effect on any player other than them. If the action card has a partial effect on you, only that partial effect is deflected. | retargeting, partial-effect granularity |
| **Eradicating Germs** | Discard an open Voter Card every turn (mandatory). For every 1-Voter Card that you discard, get any 1 resource denoted on it. | **mandatory recurring obligation on a specific player** |
| **Holo Sapiens** | This is an extra Ideology Card of your choice. Opponents can take this card by paying you as many resources as the Ideologue level this card is on [during their turn and before answering their ideology card]. At the end of your turn, you may place this card under a different Ideologue [optional]. Does not automatically become bottom-most; must be moved. Once bought the card is no longer active and must be declared again. | dynamic-price value referencing own Ideologue count; re-file; expiry on purchase |
| **If You Like Piña Colada** | Double all the resources on your player mat. Your current resource cap still applies. | mat-wide doubling with cap |
| **Lab-Grown Earworm** | Pick an opponent. Every time they influence a Voter Card, they will choose and give you 1 of their spent resources. If another such card is played, this one will get discarded. There are two such cards. | persistent trigger hook on opponent's *purchase* event; self-limiting copies |
| **Power Trip** | Every time you influence a 3-Voter Card, you can discard 1 non-majority voter belonging to an opponent. | trigger on a specific voter-count |
| **Quantum Wristband** | When a voter is placed in a Volatile Area, go through the Headlines draw pile and select a card to be resolved. *[OR]* Auction the top 3 Headlines. Minimum bid for each is 2 resources. The buyer decides who resolves them. You are immune to their effects. If you fail to auction off the headline cards, you will have to use the other power. Players without enough resources may use their IOU token / declare a debt. | **overrides the Headline trigger**, deck-search, 3-item auction, self-immunity, IOU bids |
| **Selective Access Memory** | Pick any Conspiracy Card from the discard pile. It can be in any order from the discard pile. | arbitrary rewind from discard |
| **Singularity** | Get 2 voters. Place them on the board during your turn. *[OR]* Collect and use 3 Singularity cards to permanently unlock any Level 5 Ideologue Power. Singularity x3 cannot be affected by Reverse/Ditto/Deflect/Block. There are 4 such cards in the deck. | **set collection → permanent L5 unlock**; a 3-of-4 combo that deletes itself |
| **The Greta Effect** | Pick up to 2 opponents. They will get 1 less voter on the next 2 Voter Cards that they influence. This applies to 2 separate voter cards for 2 different players. | persistent debuff on card payouts, N-target |
| **The Psychohistorian** | Get 1 voter (not card) and any 2 resources. *[OR]* Complete all the following actions in the same turn in any order to get 4 voters: 1. Trade resources with an opponent. 2. Break one of their majorities. 3. Play another Conspiracy Card on them (same opponent). You may reveal this card at any time in your turn. You do not need to announce this card before taking the actions. | **hidden 3-step combo detector**, unrevealed |
| **Thoughts and Prayers** | Pick a player and get any 2 resources for each of their voters inside a Volatile Area. | **scales off an opponent's permanent pegs** |

#### 4.2.2 India deck
- **Chai-Paani** — persistent; *"A second 'Chai-Paani' card can be applied on the same player. The first one will get deactivated."* `[VERIFIED — DDG snippet of https://www.scribd.com/document/814006944/...]`
- **Jumla** — "This is an extra Ideology Card of your choice. Opponents can take this card by paying you as many resources as the Ideologue level this card is on. At the end of your turn, you may place this card under a different Ideologue." `[VERIFIED — same snippet]`
  → **[INFERRED]** Jumla and 2040's **Holo Sapiens** are the *same card template* with different names. Memesys reuses effect archetypes across campaigns and only re-skins the name. **A digital deck can be authored as ~20 effect archetypes × 5 campaign name/flavour skins**, which is exactly how the physical product is built.
- **Cult-ivating Obedience** — *"protects one of the majorities of the owner, but it also allows any other player to convert 3 of their voters as a cost to take the card for themself."* The 3 converted voters may be the **owner's own**. `[VERIFIED https://en.wikipedia.org/wiki/Shasn]` — played in the 2023 national final.

Also named only, from the doc-515528021 AI blurb (names reliable, effects unverified):
**Block** (also in 2040, above) · headline **Crushed Under Belly** ("discard voters and receive
resources") · headline **Iftar Party** ("players trade resources and gain an extra one").

### 4.3 Real Headline Cards — Earth 2040 deck, 18 cards verbatim

`[VERIFIED https://r.jina.ai/https://www.scribd.com/document/915391789/2040-Deck-HC]`

Preamble rules (worth implementing):
> *"Headlines cards are always carried out **chronologically** and in the **post turn phase**.*
> *Unless clearly stated that its effect is for a round or more than 1 turn."*
> *"Headlines **can be blocked if their effect is limited to a player's turn**, but if the
> headline involves a couple of turns or round having multiple players then the block has to be
> applied at the very beginning."*
> *"If a headline donates you voters, they must be placed immediately before going to the next
> player or the next turn."*

| Name | Verbatim effect |
|---|---|
| **404** | Choose 2 players. They will answer **each other's** Ideology Cards in their next turn. |
| **Ain't No Cure For Love** | Discard 2 of your own voters *[OR]* Donate 1 of your voters to the player on your left. If you are unable to do either, ignore this card. |
| **As Clear As Water** | Every player reveals 1 of their Conspiracy Cards. If any player does not have a Conspiracy Card, they receive 1 from the draw pile (in order of turn) and then reveal it. |
| **Brave New Worlds** | Every player answers an Ideology Card immediately, in order of turn. Players will not receive any resources (active & passive) for doing so. |
| **Card Games** | Starting from you, each player can donate 1 of their Ideology Cards to the opponent on their left. They will receive 6 resources of their choice for doing so. Can be blocked only at the beginning. |
| **Don't Kiss The Babies** | All Voter Cards cost any 1 extra resource in your next turn. |
| **Fatality** | Influence an open Voter Card for free and donate the voters to any opponent. They must place these voters right away. |
| **Fuelling The News** | Draw 3 Headline Cards from the top of the deck. Keep one for yourself and give 1 card each to 2 opponents. **Choose the order in which to resolve these Headlines.** |
| **Gender Trouble** | You cannot use one of your unlocked Level 3 Ideologue Powers in your next turn. If you do not have a Level 3 Ideologue Power, discard 2 resources in your next turn. |
| **Good Gig Well Played** | Draw 3 Conspiracy Cards from the deck. Keep one for yourself and give one card each to 2 opponents. If there are fewer than 3 cards in the draw pile, draw the remaining from the discard pile at random. |
| **Higgs Moron** | Discard **up to 2 resources (1 or 2) on this card** to pass it on to the next player. As soon as **8 resources have been discarded on this card**, or if a player fails to pass it on in their turn, the holder must discard 2 of their own voters. Players without enough resources may not use their IOU token. |
| **Just Breathe** | Select the zone where you have the most number of voters. Move 2 voters from that zone into an adjacent zone. In case of a tie, pick any of the tied zones. |
| **Married With Bits** | Donate 1 voter each to 2 opponents. They can choose not to take it. |
| **Movement Anxiety Disorder** | Your next 3 voters to be Gerrymandered will get discarded instantly. The effect only ends when 3 voters have been discarded. This can be blocked at any turn. |
| **New Face Who Dis** | Starting with you, every player can Gerrymander 1 majority or non-majority voter immediately. These voters cannot be placed into Volatile Areas. All gerrymanders must be according to regular gerrymandering rules. |
| **Red Blooded** | You must discard any 2 voters. Players receive any 2 resources for each of their discarded voters. The player whose voters have been discarded picks resources of their choice. Resources are received from the Public Reserve. |
| **Snoop B-O-Double-T** | For the rest of the game, you have to pay an extra resource for every Conspiracy Card that you buy. |
| **The Big Freeze** | Reduce your resource cap to 10. *[OR]* Pick an opponent **every turn** and donate any 1 resource to them. |
| **The Four Horsemen** | Choose and discard one of the following: 1. 2 Funds *[OR]* 2. Clout *[OR]* 3. 2 Media *[OR]* 4. 2 Trust. You can't make any purchases until you do so. |
| **Why The Long Face?** | Pick an opponent. They will get 1 voter (**not card**) for every Voter Card you influence in your next turn. |

> `Snoop B-O-Double-T` is **the same card as PYTHONPOST** in the doc-814006944 dump.
> `New Face Who Dis` is **the same card as SUBMERGED**. `Card Games` is **the same card as
> A COWARD OR A JOURNALIST?**. `[INFERRED]` The X-Cards Explained docs were re-exported
> several times across editions, and the *same archetype appears under different campaign names*.
> Deduplicate by effect, not by name, when building the corpus.

### 4.4 Structural signals from real card text (important)

`[INFERRED — from the 20+ real card texts above]`
1. **Headlines are frequently persistent state, not resolutions.** "For the rest of the game…"
   (PYTHONPOST, GREAT LEADER BAD ECONOMY), "Starting this turn, for 1 round…" (GROWING DISSENT),
   "cannot make any purchases until you do so" (KHAKI TERROR — requires tokens placed *on the
   card*), and a card that literally *holds 4 of your voters as prisoners* (ON THE "HIGH" SEAS).
   The engine's `HeadlineCard = { name, text, effects: Effect[] }` has **no place to put a
   duration, a counter, or attached tokens.** This is the largest schema gap found.
2. **Many effects are not player-targeted.** ON THE "HIGH" SEAS attaches to the *card*; BLESSINGS
   OF PARENTS PAST creates a two-player mini-sequence with a defined resolution order; A CALL FROM
   KARACHI runs an **auction**; NEXT BILLION DATA POINTS runs a **vote**. The engine's
   `EffectTarget` is `'you' | 'each-opponent' | 'everyone' | 'leader'` — **none of these fit.**
3. **Effects frequently reference other objects as costs/values**: "as many resources as the
   Ideologue level this card is on" (Jumla), "pay an extra resource for every Conspiracy Card"
   (PYTHONPOST), "the Gerrymandering Rights you have at this point" (DOSTI BANI RAHE). No
   `Effect` op expresses these.
4. **Language register is heavily Hinglish for the India deck** — "Dosti Bani Rahe", "A Call From
   Karachi", "Bhaag", "Jumla", "Chai-Paani", "Khaki Terror", "Growing Dissent", "A Coward or a
   Journalist?". Campaign decks re-skin the *same effect vocabulary* in local language: the Rome
   deck gets NERO'S GUESTS / POLO RETREAT / PYTHONPOST is 2040. **The card-name slot is
   idiomatically a pun or a reference, not a label.**
5. Real cards **name themselves with ALL CAPS** and are set as a title, separate from body text.

---

## 5. Card format reality check vs `packages/engine/src/cards.ts`

Everything in this section is from the product photography in §6 and the real card text in §4.

### 5.1 What a real Ideology Card actually contains

Reading the physical card face (see `india_ideology.jpg` and `ideology_cards.png`):

```
┌─────────────────────────────────────────────┐
│ ▓▓ BLACK BAND, cream geometric lattice ▓▓   │  ← decorative border all round
│ ▓                                        ▓  │
│ ▓   DO YOU CONDEMN THE USE OF SURGICAL    ▓  │  1. QUESTION
│ ▓   STRIKES AS A REACTIONARY TOOL?       ▓  │     condensed uppercase, centred,
│ ▓                          ◈  (advisory)  ▓  │     max ~3 lines
│ ▓                     ▼                    ▓  │  2. SIDE-MARKER ▼ (outlined triangle)
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│          No. Hit us first and you'll        │  3. ANSWER — sentence case, mixed serif
│              breathe your last.             │     / sans, centred, 1–3 lines
│                                             │
│    ⌃  ✊  ✊  👁  ⌃                            │  4. PAYOUT — one filled circle per
│                                             │     resource; icon = type, no numerals
│        ╱  THE SUPREMO  ╲                     │  5. IDEOLOGUE NAMEPLATE
│        ╲   IDEOLOGUE   ╱                     │     hex plate, black on ideologue colour
│  ▒▒▒▒▒▒▒ red band + lattice ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │  6. SOLID IDEOLOGUE-COLOUR BAND
│                              IG10.108        │  7. CARD CODE, e.g. IG10.108
└─────────────────────────────────────────────┘
```

**Verbatim field list (this is the ground truth for the schema):**

| Real card element | Present in `IdeologyCard`? | Verdict |
|---|---|---|
| Question, 1 per card | `question: string` | ✅ **match** — and note the real card has *no* `campaign`-prefixed framing text, no flavour text, no illustration, no scenario setup. The engine's model is *already more austere than reality*, which is good. |
| Answer A | `sides[0].answer` | ✅ **match** |
| Answer B | `sides[1].answer` | ✅ **match** |
| Resource payout as **icon discs** | `sides[].pays: Delta` (numeric) | ⚠️ **partial** — see 5.2 |
| Ideologue **name printed on the card** | `sides[].ideologue` | ✅ **match** — and this is load-bearing: the answerer is *supposed* to learn which Ideologue each answer belongs to. |
| `campaign` | `campaign: string` | ✅ **match** — real cards are campaign-deck-specific and physically shipped in separate boxes. |
| Content Advisory (red ◆ with `!!`, top-right of the black band) | `advisory?: 'mature' \| 'trigger'` | ⚠️ **match in concept, 2 confirmed tiers exist**; render as a red diamond badge, not a text tag |
| ▼ side-marker triangle | **ABSENT** | ❌ **MISMATCH — read 5.3** |
| Card code `IG10.108` | **ABSENT** | ❌ minor — needed for debugging/deck-diffing, not for play |
| The card's **other face** (the other answer) | **ABSENT** | ❌ **MISMATCH — read 5.3** |

### 5.2 The payout is real, printed, and NOT tied to the Ideologue

**This is the finding most likely to break a naive implementation.**

The "SHOULD WE INVADE NEW SPAIN?" card's **Capitalist** side pays
**2 Trust (green Sri-Yantra discs) + 1 Media (blue eye disc) — and zero Funds.**

`[VERIFIED — ideology_cards.png, the official 432-card marketing render]`

So:
- `pays` is a *sparse* `Delta` and **need not contain the answerer's own resource at all.** The
  engine's `Delta = Partial<Record<Resource, number>>` is correct here. Do **not** add a
  validation rule of the form "a Capitalist answer must pay ≥1 Funds" — that would be wrong and
  would reject a real card.
- The count is **always small integers, expressed as one disc per unit.** Observed payouts
  across cards: 2–5 discs, 0–3 of any single type. A UI should render payout as
  `repeat(pays[res] ?? 0, <resIcon>)`, never as a numeral.
- The `sidePayout()` helper in `cards.ts` sums a `Delta` to a single number. That is fine for the
  **balance checker**, but the UI must not use it — the game shows four separate icon counts and
  the *composition* is the information.
- `[INFERRED]` Because a side can pay 0 of its own type, `pays: {trust: 0}` is indistinguishable
  from `pays: {}`. The real game avoids this by always printing **≥1 disc of at least one type**.
  Recommend the data validator require `sidePayout(side) >= 1`.

### 5.3 MISMATCH 1 (important): the card is one object with two printed faces, and there is a ▼

The physical Ideology Card is **printed on both sides**: the black question band and the ▼ marker
appear on *both* faces, and each face carries a *different* answer + payout + ideologue nameplate.
The reader holds the single card, reads the question, reads answer A, flips it, reads answer B.

`[INFERRED — from india_ideology.jpg: five cards fanned, every one showing a black question band
above a cream answer panel, each with its own different ideologue colour band]`

Consequences for the engine:

1. **The `▼` is the hidden-information mechanic made physical.** It sits exactly on the seam
   between the question band and the answer, on the side currently being read. It is how the
   reader communicates "I am reading *this* one" — a physical token gesture that replaces a UI
   radio button. **A digital version should render the ▼ on the side being read and animate it
   flipping with the card.** This is a free, high-fidelity touch and it is currently missing.
2. **`IdeologyCard` has no notion of "the other face".** The engine's `sides: [A, B]` is an
   unordered pair, which is *sufficient for the game* but loses the reader-facing structure. If
   the UI is to render a single flipping card, it needs a stable `faceOrder` or it will show
   the two answers in a different order for the reader and the answerer.
3. **The server-only `_` convention in `state.ts` is the right mechanism and is already
   load-bearing** ("the blind-answer mechanic dies if card payouts reach the client"). Worth
   recording that the physical game achieves the same thing with a *double-printed card* rather
   than a server. The digital version must keep the server authority; the ▼ is presentation only.

### 5.4 MISMATCH 2 (critical): ~40% of real X-Card effects have no `Effect` op

The engine's union is 12 ops, all of the form *"gain/lose N of resource type X, possibly aimed at
a target class"*. Real cards need at least these 14 additional primitives, all evidenced in §4:

| Needed op | Real card that needs it |
|---|---|
| `duration: 'this-turn' \| 'next-turn' \| 'round' \| 'rest-of-game'` | PYTHONPOST, Snoop B-O-Double-T, The Big Freeze, GROWING DISSENT, Don't Kiss The Babies |
| `attach-to-card` + token counter | KHAKI TERROR (donate 1 of each onto the card), The Four Horsemen |
| `hostage` (voters removed from the board onto a card) | ON THE "HIGH" SEAS (4 voters held on the card, ransomable at 1 resource each) |
| `timed-pass` (card is passed player to player until a condition) | Higgs Moron (pass the card, 8 resources on it = penalty) |
| `auction` (start an auction, may include IOU/debt) | A CALL FROM KARACHI, Quantum Wristband, Quantum Wristband (Headlines) |
| `vote` (all players vote, no self-votes, re-vote on tie) | NEXT BILLION DATA POINTS |
| `reactive: block` (cancel a card played against you, out of turn) | Block |
| `reactive: deflect` (retarget a partial effect at a third player) | Deflect |
| `trigger: on-influence` (fires when *someone else* influences a Voter Card) | Lab-Grown Earworm, Power Trip, GREAT LEADER BAD ECONOMY |
| `trigger: on-volatile-placement` (override the Headline draw) | Quantum Wristband |
| `scale-off-board-state` (pay/gain proportional to voters in a zone) | Thoughts and Prayers (2 per volatile voter), Just Breathe, The Psychohistorian |
| `modify-cost` (dynamic surcharge, tax on purchases) | PYTHONPOST, KHАKI TERROR, Don't Kiss The Babies, The Big Freeze |
| `set-combo` (collect N of a card to unlock something permanent) | Singularity (3 of 4 → permanent L5) |
| `borrow-opponent-power` | Deep Thoughts, POLO RETREAT |
| `cross-turn delayed payoff` | Cut, Copy, and Paste (end of turn → start of next turn) |
| `convert-self` (convert **your own** voters) | Cult-ivating Obedience |

**Recommendation, in priority order:**
1. Add a `duration`/`expires` field to `HeadlineCard` and `ConspiracyCard`. This alone unlocks
   the largest family of real cards and is the cheapest fix.
2. Generalise `Effect` from a flat union to `{ op, n?, res?, target?, when?, until?, forEach? }`
   so a single op can be parameterised, rather than adding 16 more variants.
3. Add a small set of **meta / interrupt** actions outside the `Effect` list entirely
   (`block`, `deflect`, `auction`, `vote`, `pass-card`) — these change the *phase* of play, not
   the resources, and no amount of `Effect` parameterisation will express them.

### 5.5 MISMATCH 3 (medium): costs, editions, and the Public Reserve

- `ConspiracyCard.cost: number` is correct (the real card back prints the numeral; the photo
  shows a magenta back with **"5"** in the corner) `[VERIFIED crop_hq.png]`.
- **Headline Cards have no cost** — correct, `HeadlineCard` has none. But several Conspiracy
  Cards are *conditionally* unbuyable ("You can't make any purchases until you do so" is a
  *lock on you*, played by someone else). **The engine has no representation of a restriction
  on a player's available actions.** `Khaki Terror`, `The Four Horsemen` and `The Big Freeze`
  all need one. This is a `PlayerState` field, not a card field.
- **Voter token count differs by edition.** `rules-reference.md §3` records 300 voter pegs
  (60 × 5) for the Collectors Edition. The **Essential Edition ships 250 (50 × 5)** and
  **120 resources (30 × 4)**, not 200 `[VERIFIED S5 contents page]`. Flag for the engineer:
  the 200/300 figures are the *old* box; match the current box or state the assumption explicitly.
- **The Public Reserve is a visible, depletable pile in the real game.** Resource tokens are
  physically stacked on the HQ Mat beside each Ideologue card `[VERIFIED crop_hq.png]`. A
  digital UI should render the reserve as a visible stack per resource that shrinks as players
  buy, because "the pile is running low" is a real strategic signal that a number in a corner
  does not convey.
- `VoterCard = { cost: Delta, voters: number }` is **structurally correct** `[VERIFIED
  votercards.png]`. The front is a black field with a column of resource discs and one huge
  cream numeral. No extra fields needed.

### 5.6 MISMATCH 4 (low, but a correctness trap): the L5 power has two real names

`rules-reference.md §9` records the Capitalist L5 as **"Land Grab"** (from the rulebook).
**The shipped Player Mat prints it as "CRACKING GROUND"** `[VERIFIED player_mats.jpg]`.

All four mat-printed power names, verbatim, with their mat sub-rules:

| Ideologue | L3 (mat) | L5 (mat) |
|---|---|---|
| The Capitalist | **PROSPECTING** — "Trade 1 resource for 2" | **CRACKING GROUND** — "Evict 3 voters" |
| The Supremo | **DONATIONS** — "Snatch 2 resources" | **PAYBACK** — "Discard 2 voters" |
| The Showstopper | **GOING VIRAL** — "+1 voter/card" | **ELECTION FEVER** — "+1 Gerrymander/zone" |
| The Idealist | **HELPING HANDS** — "2 discounts" | **TOUGH LOVE** — "Convert 2 voters" |

Also printed on the mat, verbatim, above the portraits:
> *"FOR EVERY 2 IDEOLOGY CARDS YOU HOLD OF AN IDEOLOGUE, GET 1 EXTRA RESOURCE OF THAT TYPE."*

`[VERIFIED player_mats.jpg]` Use the **mat** names in the UI (that is what a player reads at the
table) and keep the rulebook names in the rules reference. Note "Cracking Ground", not
"Land Break" or "Breaking Ground".

### 5.7 Naming gotchas

- **The Showstopper was called The Showman at launch** `[VERIFIED Wikipedia]`. The 2022
  Indian Express piece still uses Showman. The 2040-era mat art uses SHOWSTOPPER.
- Card codes: `IG10.108` / `IG10.100` (India, generation 10), `AM10.108` / `AM10.100` / `AM10.101`
  (America). `[INFERRED]` prefix = campaign, `10` = a print/balance generation, last = card index.
  Worth adopting as a `id` convention since it is stable across editions and diffable.
- The engine's `ZoneID` snake_case ids are fine; the **printed** zone labels are title case with a
  direction word, printed twice (small caps above the fraction, tiny caps below) `[map.png]`.

---

## 6. Board & visual design

Sources: the official component renders at `playshasn.com/gallery`
(`images.squarespace-cdn.com/content/v1/6018f997002d343c987b1153/…`), all `[VERIFIED]` by direct
inspection of `map.png`, `crop_board.png`, `resources.png`, `votercards.png`, `ideologue_cards.jpg`,
`player_mats.jpg`, `india_headline.jpg`, `crop_hq.png`, `crop_market.png`, `crop_notes.png`.

### 6.1 The board is a topographic map, not a choropleth

This is the single most important visual fact, and the generated SVG almost certainly gets it
wrong. Read `packages/engine/scripts/gen-board.mjs` for how the current geometry was derived —
**it produced a coastline, but the real board's land is a *contour-line texture*, not an
elevation fill.**

Board anatomy, outside in:

| Layer | Description | Approx colour |
|---|---|---|
| 0. Ground | Dark, almost-black **olive-charcoal**, with a radial vignette darkening to the edges. A faint **city-skyline silhouette** (towers, water tanks, hoardings) is printed around the perimeter. | `#2A2620` → `#15120E` at the edges |
| 1. Land | The country silhouette, filled with a **pale cream base overlaid with fine concentric CONTOUR LINES** — a topographic survey look. This is the dominant texture. | fill `#F2EFE2`, lines `#DAD3BF` |
| 2. Zone fill | Zones are **not colour-coded**. The land texture continues through them. Only the **borders** are drawn. | — |
| 3. Zone borders | **Thick (≈4 px at board scale) rounded/slate strokes** in a desaturated blue-grey. These are the dominant graphic element after the land. | `#4C5C64` |
| 4. Central zone | Drawn as a **distinct olive-tinted inset** with a heavier border — visibly "recessed" and smaller than everything around it. It reads as a dark knot in the middle of the map. | `#C6C0A4` |
| 5. Voter Areas | **Plain pale-grey/white filled circles** with a thin grey ring. Small, flat, unremarkable. ~129 of them. | fill `#EDEDED`, ring `#C4C4C4` |
| 6. Volatile Areas | **Large dark cog / sunburst rosettes** — a ring of radial black tick-marks with gaps, ~2.5× the diameter of a voter area. Deliberately conspicuous; they read as "gear" or "explosion". 11 of them (1 per zone, 2 in West and East). | `#241F19` |
| 7. Landmarks | ~8 **dark-green architectural plan drawings** of buildings, domes, forts and ruins, scattered over the land as decoration. Not interactive. | `#2E4A3C` |
| 8. Zone label | Small-caps condensed name **above** a large `majority/capacity` fraction, with a **tiny direction word below**. E.g. `NORTH EAST` / **6/11**. | text `#241F19` |
| 9. Wordmark | `SHASN` in cream, heavily letter-spaced condensed caps, on a **dark diagonal banner**, top-left. `@shasnthegame` handle bottom-right in small cream. | `#EDE7D6` |

**The 9 zones are not states and not named constituencies.** They are geometric directions:
North West, North, North East, West, Central, East, South West, South, South East — matching
`rules-reference.md §2` exactly. The `rules-reference` description ("six outer zones form a
ring; North, Central and South form a lightning-bolt column") is **confirmed by the art**:
Central is the dark inset, and the middle column is visibly a bolt.

**"DUAL LAYERED BOARD"** — the board sheet is printed on both sides; the reverse is the 2-player
variant. `rules-reference.md §14` has the 7-zone 2-player layout. One SVG, two faces.

### 6.2 Resource tokens

`resources.png` `[VERIFIED]`. Flat round cardboard chips, ~25 mm, four types, **120 total
(30 × 4)** in the Essential Edition:

| Resource | Colour | Icon |
|---|---|---|
| **Funds** | amber/gold `#E8B33A` | 8-pointed star (Indian star motif), with a second star outline inside |
| **Clout** | red `#E8443C` | raised clenched **fist** with radiating rays |
| **Media** | royal blue `#2B3FA8` | **eye**, with radiating rays |
| **Trust** | green `#7CB328` | **Sri Yantra** — nested triangles/diamond in a hexagon |

Every chip carries a **thin cream line-art geometric overlay** across it (part of the house
style) and a slightly darker outer rim. Use these exact four icons — they are the game's whole
visual vocabulary and they are culturally specific, not generic.

### 6.3 Player identity is a party symbol, not a colour

`player_mats.jpg` `[VERIFIED]`. There are **5 Player Mats in 5 distinct colourways** —
charcoal/black, purple, magenta/pink, bronze/brown, teal-green — and each mat carries a
**party glyph in a hexagon at the right-hand end**: a double-arc "yin-yang", a cross/plus, an
"A", a hammer-and-sickle, and a peace/lambda. `[INFERRED]` the glyph is a fictional party symbol
and is deliberately *not* a real Indian party symbol.

This is what `rules-reference.md §8` calls the "party-symbol side" of the peg. **The digital
version should give each player a colour *and* a glyph**, and render the peg as a two-sided disc
showing the glyph when it is a majority voter. Picking from real party symbols would be a
trademark problem (see §9).

### 6.4 The Player Mat is the Manifesto display

`player_mats.jpg` `[VERIFIED]`. A wide landscape rectangle, notched along the top edge with a row
of **card slots** (your answered Ideology Cards slide in there, answer-side up — this *is* the
manifesto). Top-to-bottom:

1. Top notch strip — **Ideology Card storage slots**, scolloped.
2. Four **Ideologue portrait panels** across the top, each in its ideologue colour with the
   line-art portrait and the black nameplate banner.
3. Under each portrait: two **numbered circles "3" and "5"** — the L3 and L5 unlock thresholds —
   each with a **tick-box circle** beside it. These are the physical unlock indicators.
4. Beside each numbered slot, the **power name in condensed caps** plus a **tiny italic serif
   one-line sub-rule** (see the table in §5.6).
5. A row of faint horizontal **rule lines** below the portraits — this is where the **passive
   +1-per-2-cards** pips are marked.
6. The passive rule itself is printed in tiny caps along the top black band.

`[INFERRED]` The mat is a *dual-purpose* object: (a) card storage, (b) a power-track dashboard.
The digital equivalent should be a single persistent per-player panel that shows all four
Ideologue portraits, four L3/L5 slots with tick states, four passive-income pips, and the
player's hand of Ideology Cards. **One panel, not four dialogs.**

### 6.5 The HQ Mat, the market, and the draw piles

`crop_hq.png`, `crop_market.png` `[VERIFIED]`. The HQ Mat is a **landscape mat in olive/moss
green with cream print**, carrying, left to right:

1. **Four rows, one per Ideologue.** Each row holds a large **Ideologue Card** (the character
   portrait card) and, laid over/next to it, the **Public Reserve tokens for that resource** —
   you can see 2 gold tokens by the Capitalist, 1 blue by the Showstopper, 2 green by the Idealist.
   To the right of each card is a printed micro-table of numbers.
2. Printed instructions in the black areas: **"INFLUENCE THE VOTERS"** and **"REMOVE"**.
3. Two black strips printed on the mat, labelled **"HEADLINES"** and **"CONSPIRACY"** — these
   are the **draw piles**. They are *on the mat*, not loose on the table.
4. A **"LEADERBOARD"** track, with rows of small cream boxes.

The **market** is laid out to the right of the mat, directly on the table: **Voter Cards laid
face up in a grid of roughly 2 columns × 3 rows (6 visible slots)**, slightly fanned.

**Discard** is a large black square printed with **"DISCARD"** in wide-spaced cream caps and the
card-back artwork, sitting to the left of the HQ Mat.

`[INFERRED — from the layout in crop_hq.png]` The full table plan, in physical terms:

```
        ┌──────────────────────────────────────────────┐
        │            GAME BOARD (India)                │
        │      9 zones · 129 areas · 11 cogs           │
        └──────────────────────────────────────────────┘
   P1 mat ▲                                    draw piles
   (mat in   │                                  (CONSPIRACY,
   front of  │                                   HEADLINES)
   P1, with  ▼                                        │
   their         ┌────────────────┐        ┌─────────┴────────┐
   cards in     │   HQ MAT       │        │  VOTER MARKET    │
   the notch)   │ 4 Ideologue    │        │  2 × 3 face-up   │
                │ cards + Public │        │  Voter Cards     │
                │ Reserve piles  │        └──────────────────┘
                │ HEADLINES      │
                │ CONSPIRACY     │
                │ LEADERBOARD    │
                └────────────────┘
   DISCARD ◀── black square, left of the HQ Mat
```

Each player's mat sits **on their own long side of the table, facing them**, with the board in
the middle. Nothing is between a player and their own mat.

### 6.6 Card-back design language (reproduce this exactly)

Four distinct backs, all sharing the **black field + cream geometric lattice border + a
diagonal banner with wide-spaced cream condensed caps** house style:

| Card type | Back design |
|---|---|
| **Ideology Card** | (Both faces are front faces — see §5.3. The *reverse* of the answer panel is the black question band.) |
| **Voter Card** | Black field, **circular sepia portrait medallion**, a **cream bar reading "VOTES"** in heavy black caps, `▼` marker at top, cream lattice border. |
| **Conspiracy Card** | **Magenta / dusty pink** field, **"CONSPIRACY"** in wide-spaced cream caps on a diagonal banner, **the cost numeral in the corner** (photo shows `5`). |
| **Headline Card** | **Dark forest green** field, **"HEADLINE"** in wide-spaced cream caps on a diagonal banner, over a **grey halftone newsprint photograph** (a crowd/protest image) inside a black angular frame. |

The **shared lattice motif** — a fine cream/white triangular or diamond jaali mesh on the
border of every single component — is the strongest brand signal in the product. It appears on
the board's wordmark banner, on all card backs, on the player mat, and on the Ideologue Card
borders. **It should be a reusable SVG pattern in the digital build.**

### 6.7 Marketing-art backgrounds (for the digital shell)

The official renders place components on a **cool grey-blue background with a faint topographic
contour pattern and a large white diagonal stripe**, with a thin orbit-arc graphic and small
circles. Component counts are set in a **black filled circle with a large cream numeral**
(`432`, `120`, `60`, `108`, `20`, `5`) followed by a condensed black label. `[VERIFIED —
gallery renders]`. Use this as the reference for the app's card-gallery / component-list styling.

### 6.8 Type

`[VERIFIED]` The house typeface is a **tall, narrow, geometric condensed sans** used for every
label: `SHASN`, `DISCARD`, `CONSPIRACY`, `HEADLINE`, `VOTES`, all zone labels, all power names,
and all card questions. Body/answer text on cards is set in a **humanist sans or a light
transitional serif**, sentence case, centred. The wordmark and the count numerals are the
condensed face at large size. **Do not use a geometric-grotesque or a slab for the labels** — the
condensed face is load-bearing for the whole look.

---

## 7. Tableau & turn-by-turn narrative

This is the order a player *experiences* a turn, assembled from `rules-reference.md` (which owns
the numbers and page cites) and the physical layout in §6.5. Implemented top-to-bottom it is a
straight state machine.

### 7.1 Once, before the first turn

1. Everyone picks a Player Mat — **which also picks your colour and your party glyph** (§6.3).
   Your peg bag is that colour.
2. Vote to elect Player 1 (no self-votes, re-vote on tie, clockwise) `[rules-reference p7]`.
3. **Staggered starting resources** — P1 takes 1, P2 takes 2 … P5 takes 5, of their choice, from
   the Public Reserve. Tokens come *off the HQ Mat pile*, visibly. `[p7]`
4. Choose a Campaign. The Content Advisory is read and the table votes on removals. **UI: this is
   a pre-game screen with a card list, an advisory badge per card, and a remove toggle.**
5. Shuffle that campaign's three X-card decks.
6. The Conspiracy and Headline draw piles are face down on the HQ Mat. **Three Voter Cards are
   drawn and laid face up in the market** — in the real game, right beside the mat, in a 2 × 3
   grid. `[p7]`

**What the UI should show at this point:** the board, four resource piles with visible counts, a
market row of 3 Voter Cards, two face-down draw piles, and five player panels with the resource
counters starting at 0/0/0/0 but the mat's *Idea Card slots* empty.

### 7.2 The start of your turn — the draw-and-answer

This is the game's signature moment and it is the most important thing to get right in the UI.

1. **The player to your right** takes the top Ideology Card and **reads both sides aloud to you.**
   In the digital version: that player's client receives a one-sided card view. The ▼ triangle
   appears on the side being read, and the card **flips** between the two faces (§5.3). The
   answerer's screen shows the **question only** — no answers, no payouts, no ideologue names.
2. **The redraw window.** Before answering, *any* player may pay **4 resources to the Public
   Reserve** to have the card discarded and redrawn. `[p21]` **UI: a countdown-free but
   clearly-bounded window with a single "Pay 4 to redraw" button that is enabled/disabled per
   player by affordability, and a visible "waiting for other players…" state.** Because the
   reading player does not know what the card pays, the redraw is a *bet*, not a decision — the
   UI should not imply otherwise.
3. **You answer.** You say which side. The card goes under your mat, **answer-side up**, into
   the notch. The ▼ and the payout are now revealed.
4. **You receive the resources printed on your answer, plus your passive Ideologue income.**
   `[p21]` The passive is `floor(cardsOfIdeologue / 2)`. `rules-reference §9` notes the bonus also
   applies in the very turn you cross the threshold.
5. **Check the resource cap (12) and discard down to it before any other action.** `[p12]`
   **UI: block further actions until the discard is done.** The physical game handles this by
   a hard rule; a digital game that lets you act first has broken the rule.

### 7.3 Your free-action phase

Any number, any order, repeatable, until you say you're done `[p21]`:

- **Influence Voter Cards.** Look at the 3 face-up cards in the market. Pay the printed
  combination to the Public Reserve. Take the voters — **all of them, and they must go in one
  zone.** The card is discarded and a replacement is flipped over immediately, so the market
  never shows fewer than 3. `[p10]`
  **UI: hovering a market card should show the cost as four icons and the voter count as
  discs, and should grey out with a reason when unaffordable.**
- **Place voters.** Click a zone, get a legal-placement highlight. Placing into a **Volatile
  Area** (the black cogs) queues a Headline — the UI should **flag those cogs before you
  commit**, since it is an irreversible, board-state-changing commitment. Forming a majority
  flips pegs symbol-side up and scores. `[p8, p18]`
- **Gerrymander.** For every zone where you hold the most voters, move one non-majority voter
  into, out of, or to an adjacent zone. Ties give nobody rights. Volatile voters are exempt. `[p16-17]`
  **UI: on entering your turn, the zones you hold rights in should be visibly marked on the
  board — the real game marks this by nothing at all, and digital should.**
- **Use Ideologue powers**, at L3 and L5, as unlocked. Usable in the turn they unlock. `[p15]`
- **Trade** with any player: resources and/or Conspiracy Cards, any ratio, ≥1 resource each way,
  at least one party is the active player, any time during your turn. `[p12]`
- **Buy and/or play Conspiracy Cards** — only the top of the draw pile. Playable on your turn or
  in the window just before an opponent answers. `[p19]`

### 7.4 End of your turn — the three post-turn steps

Order matters and the UI must enforce it `[p21]`:

1. **Resolve one Headline for every voter you placed in a Volatile Area this turn**, in the
   order the voters were placed. `[p18]` `[INFERRED — the 2040 preamble states headlines are
   "always carried out chronologically and in the post turn phase"]`
2. **The next player's card is drawn and read.** Do this *before* the next player answers.
3. **In that window, any player may play a Conspiracy Card** — the out-of-turn interception
   window. `[p19]` **UI: this is the social centre of the game. It deserves a distinct,
   deliberate "interception" phase — every player gets a pass/play prompt before the answerer
   is unlocked, with a visible "waiting on 2 players" state.**

### 7.5 Majority flip, in the UI

- Every peg is two-sided. Non-majority is **blank**; majority is **party-symbol side up**. `[p8]`
- The moment a zone's requirement is met, exactly `majority` pegs flip and each is worth 1 point.
  **UI: this needs a deliberate, visible flip animation and a score increment — it is the
  scoring event of the whole game and it currently has no representation beyond a boolean
  `majority` field on `Peg`.** Consider an explicit `flip` event in the reducer.
- Additional voters placed after the majority forms are **worthless** and stay blank. `[p8]`
  The UI should say so at placement time, not after.
- A majority can be **broken** by powers and effects; the remaining pegs flip back to blank. `[p9]`

### 7.6 End of game

All majorities formed in all zones, or the board full. **The winner is the player with the most
majority voters** — not the most zones, and not the most raw voters. `[p20]`
**UI: a scoreboard that shows majority voters as the primary number and total voters as
secondary. The 2019 and 2024 finals were won with 20 and 26 majority voters respectively
`[VERIFIED Wikipedia]`, so the expected range is roughly 15–30 — set the progress bar to that,
not to 69.**

If the board fills first, every player takes one final turn, starting with whoever filled the
last empty area. `[p20]` Ties are resolved socially ("the privilege"); the engine reports a tie.

---

## 8. Tone & copy register

### 8.1 Ten representative one-liners

**Questions (the actual printed register — condensed caps, 5–12 words, always a yes/no framed
as a policy dilemma, never a question about tactics):**

1. "DO YOU CONDEMN THE USE OF SURGICAL STRIKES AS A REACTIONARY TOOL?"
2. "SHOULD WE INVADE NEW SPAIN?"
3. "SHOULD MISTAKES BE FORGIVEN?"
4. "SHOULD WOMEN BE FREE TO HAVE CHILDREN SINGLE OR IN A RELATIONSHIP?"
5. "SHOULD THE GOVERNMENT SPEND MONEY ON SPACE EXPLORATION?"
6. "Is providing free food, housing and healthcare to all citizens a good idea?"
7. "Do the poor have the right to take wealth from the rich?"
8. "Should the rich be taxed to fund free higher education?"
9. "SHOULD WE [STOP] AERIAL BOMBING DEVELOPED COUNTRIES?" *(partially occluded in photo — do
   not treat as verbatim)*
10. "SHOULD KASHMIRI FARMERS BE GIVEN THE RIGHT TO FLY […]?" *(partially occluded — do not
   treat as verbatim)*

**Answers (the actual printed register — first word is literally "Yes." or "No.", then a flat
deadpan justification, 6–15 words, no adjectives, no hedging):**

- "No. Hit us first and you'll breathe your last." — printed on the Supremo side of card IG10.108
- "No. It would be far more lucrative to invade nearby islands and expand our fishing territories."

`[VERIFIED — india_ideology.jpg, ideology_cards.png, crop_market.png]`

**X-card names (the register is a pun, a reference, or a throwaway joke — never a label):**
"Ain't No Cure For Love" · "Don't Kiss The Babies" · "Not Kiss The Babies" · "Just Breathe" ·
"Red Blooded" · "The Big Freeze" · "The Four Horsemen" · "Why The Long Face?" · "Snoop B-O-Double-T" ·
"Card Games" · "New Face Who Dis" · "Brave New Worlds" · "Sui Generis" · "404" · "Married With Bits" ·
"Thoughts and Prayers" · "If You Like Piña Colada" · "Cult-ivating Obedience" · "Chai-Paani" ·
"Jumla" · "Holo Sapiens" · "Quantum Wristband" · "Selective Access Memory" · "Lab-Grown Earworm" ·
"The Greta Effect" · "The Psychohistorian" · "Dosti Bani Rahe" · "A Call From Karachi" ·
"Khaki Terror" · "Pyranpost" / "Pythonpost" · "Polo Retreat" · "Nero's Guests" ·
"On The 'High' Seas" · "A Coward Or A Journalist?" · "Blessings Of Parents Past" ·
"Great Leader, Bad Economy" · "Staying In Your Limits" · "Submerged" · "Cough It Up" ·
"Next Billion Data Points" · "Block" · "Deflect" · "Singularity"

### 8.2 Rules for a writer imitating the register

1. **Answers open with the bare word "Yes." or "No."** Every single recovered answer does. Not
   "Absolutely", not "I would". Just the word and a full stop.
2. **Deadpan, not jokey.** The joke is in the *situation*, never in the wording. The real cards
   are almost all written straight. "No. Hit us first and you'll breathe your last." is a threat
   delivered as a policy answer.
3. **Short.** Question ≤ 12 words. Answer ≤ 15 words after the Yes/No. Both fit on a card with
   the payout icons and the nameplate.
4. **No first-person, no jokes, no emoji, no winking.** `[INFERRED from 20+ recovered cards]`
   Not one contains a joke. The satire lives in the *pairing* of two sincere-sounding positions.
5. **Hinglish for the India deck, in the card NAMES only.** Questions and answers are in English.
   The names use romanised Hindi/Urdu — "Jumla", "Chai-Paani", "Dosti Bani Rahe", "Bhaag" — and
   they are chosen because they are *vernacular jargon for a corrupt deal*, which is the joke.
6. **The name puns on the mechanic.** "If You Like Piña Colada" doubles your mat.
   "Don't Kiss The Babies" taxes Voter Cards. "The Four Horsemen" locks your purchases.
   "On The 'High' Seas" kidnaps your voters. **Write the name last, after the effect.**
7. **Campaign re-skins the name, keeps the effect.** §4.3 showed Jumla ≡ Holo Sapiens,
   Pythonpost ≡ Snoop B-O-Double-T, Submerged ≡ New Face Who Dis. **Author ~20 effect
   archetypes, then name them five times.** This is exactly how the physical product is built and
   it is the only sane way to produce 80 cards × 5 campaigns.
8. **References to real people are allowed and are the point.** "The Greta Effect" is a real
   climate activist. "The Psychohistorian" is a Dune title. "A Coward Or A Journalist?" is a
   real newspaper headline. "Nero's Guests" is Nero's actual banquet. `[VERIFIED §4]`
   **See §9 before writing these — a direct reference to a living, identifiable person is a
   materially different legal question from a fictional name.**

### 8.3 Naming warning specific to this project

`[VERIFIED]` Real SHASN card names include **"The Greta Effect"** and **"The Psychohistorian"**
and **"Cult-ivating Obedience"**. If the digital version reuses *any* of these, it is copying
copyrightable card text. §9.

---

## 9. Provenance / legal exposure

**This section is information, not legal advice. It is a synthesis of what is public about the
product, not a review of case law.**

### 9.1 What is and is not protectable

- **Rules and mechanics are not copyrightable.** `docs/rules-reference.md §17` already states
  this and it is the correct foundation: the 9-zone geometry, the majority formula, the
  resource-cap, the gerrymander rule, the power thresholds, the turn order — all of that is
  free to reimplement, and this project has already documented it.
- **Card text is copyrightable.** It is original literary work by Memesys Culture Lab. The
  recovered text in §4 is copyrightable expression, and so are the question/answer pairs in
  §8.1 and the card names. Recovering them for research is fair use; **shipping them is not.**

### 9.2 The specific exposure in this document

This file reproduces, verbatim, **~55 card names and their complete rules text** (§4) plus
**~12 Ideology Card questions/answers** (§8.1), plus **one character card's caption** (§2.1).
That is:
- **A substantial quantity of the product's most valuable copyrightable asset.** Memesys sells
  this content; the Conspiracy/Headline decks are the reason a 20-card and 80-card variant
  exists at all.
- `[INFERRED]` The realistic risk is not a lawsuit — it is a **DMCA takedown** of the repository,
  or a takedown of a demo build, which for a public repo is effectively the same outcome.
- `[INFERRED]` The names alone are the highest-value/lowest-weight item. A game titled
  "Cult-ivating Obedience" is a distinctive enough phrase to be searched. Names are the most
  likely thing to be noticed by a rights holder, and the easiest thing to change.

### 9.3 The "Shasn" name and trademark

`[VERIFIED]` SHASN is an **active commercial product** — sold by Memesys Culture Lab, with a
second product line (AZADI) and national tournament series running 2019, 2023 and 2024
`[Wikipedia]`. It is a coined transliterated Sanskrit word ("governance, rule, or regime"), a
weak mark, but the product is live and the word is used in commerce as a mark.

`[INFERRED]` Risk is asymmetric: an original-word game about Indian politics is not confusing; a
game called **SHASN** that plays exactly like SHASN is. **The project should not ship the name
SHASN.** A different title also removes the "look-alike" argument entirely, and this repository
already uses `@shasn/*` package names — those are fine internally, but the *published product
name* should differ.

### 9.4 Artwork

- **Do not use any Memesys artwork.** The portraits, the contour-line board art, the lattice
  motif, the icon set, the card-back designs, the wordmark — all of it is Memesys' work, and the
  art is arguably the *stronger* copyright than the text.
- The **four resource icons** (Kolkata star, raised fist, eye, Sri Yantra) are Memesys' line
  drawings. Reusing them is a copyright problem, and the Sri Yantra / star are themselves
  religious and national symbols whose casual commercial reuse is a separate reputational
  question in India.
- The **geometric lattice / jaali border** is the single most identifiable visual signature.
  `§6.6` recommends reproducing it. **`[INFERRED]` That recommendation should be downgraded for a
  shipped product** — it is the closest thing to a trade dress in the design. Use a *different*
  geometric border. The layout, the zone fractions and the cog-for-volatile-area idea are
  mechanics and are free; the specific mesh pattern is not.
- **Player party symbols are fictional by design** `[VERIFIED §6.3]`. Do not substitute real
  Indian party symbols (Congress hand, BJP lotus, etc.) — that is a third-party trademark
  problem, separate from Memesys.

### 9.5 Recommendation

`[INFERRED]` The safe and also the *high-fidelity* path, given §8.2:

1. **Reimplement the mechanics exactly.** They are free, and exactness is what players notice.
2. **Author original cards** using the §4 *effect archetypes* (which are mechanics — "a card that
   lets opponents buy an extra Ideology Card from you" is a mechanic, and the mechanic is free)
   with original names, original questions and original answers, written in the §8 register.
3. **Ship original art** in a different visual language, keeping only: the layout, the
   geometry, the fraction typography, and the four-resource/one-per-Ideologue mapping.
4. **Do not ship the name SHASN.** Rename the product.
5. **Keep §4 in the repo as research.** It is a quotation of published rules text for
   interoperability reference, which is the same posture `rules-reference.md` already takes and
   the same posture the "X Cards Explained" Google Docs were themselves published *for* by
   Memesys as player aids. That is a materially different act from shipping the text in a
   competing product. **But this should be a conscious decision recorded in `PLAN.md §8`, not an
   accident** — and if the project ever goes public and commercial, the §4 tables should be
   reduced to archetype descriptions rather than verbatim text.

---

## 10. Open unknowns

Do not re-research these blindly. Each was searched and not found in this session.

| # | Question | Status | Where to look instead |
|---|---|---|---|
| 1 | Verbatim text of ordinary question Ideology Cards | **NOT FOUND.** Zero cards recovered beyond the character card in §2.1. | TTS Workshop mod; BGG `cf.geekdo-images.com` image CDN; buy the deck |
| 2 | Printed payout of a real Ideology Card, as numerals | **N/A** — payouts are icon discs, not numerals. Resolved by §5.2. | — |
| 3 | Exact 60-card Voter Card cost distribution | **NOT FOUND** | TTS mod; the physical deck |
| 4 | Content Advisory legend (what the 2 tiers mean) | **NOT FOUND.** Confirmed a red ◆-with-`!!` badge exists; the `mature`/`trigger` semantics in `cards.ts` are the engine's own invention. | p14 of the rulebook (`rules-reference.md` cites the section, not the legend) |
| 5 | India campaign's **full** Conspiracy/Headline lists | **~10 recovered** of 20+20, from partial sources | Docs 515528021 (35 pp, image-only p1) and 814006944 (10 pp) in full — both need per-page extraction, which `r.jina.ai` only does for p1 |
| 6 | Brexit / USA / Rome full card lists | **~6 recovered** of ~5 decks | Same two docs; the Portuguese mirror of 515528021 (id 962743314) may OCR differently and be worth a try |
| 7 | Precise Volatile Area positions within each zone | **STILL UNKNOWN.** `rules-reference.md` §16 item 6 asserts 2 each in W/E and 1 in the rest, "counted off the printed board". **`map.png` shows the cogs but at this resolution their zone assignment is not confirmable.** | A high-res board scan, or the physical board |
| 8 | Board aspect ratio and the exact zone polygon coordinates | **PARTIAL.** `map.png` is a *rotated marketing render*, not an orthographic scan — perspective and yaw are applied, so it **cannot** be used to recover geometry. | Needs a straight-on board photo |
| 9 | Board size in mm, card size in mm, peg diameter | **NOT FOUND** | BGG images / product spec |
| 10 | The 4 printed marketside "micro-tables" of numbers on the HQ Mat | **NOT READABLE** at photo resolution. Their purpose is unknown — possibly the IOU/debt track or the resource-cap reminder. | A high-res HQ Mat photo |
| 11 | Whether the two faces of an Ideology Card print the **same** question or two different framings | **INFERRED same** — every visible face carried its own question band with its own question, and answers on neighbouring cards were clearly unrelated, which is consistent with one question / two answers / both faces printed. Not directly confirmed. | A two-sided card scan |
| 12 | Elite politicians, Home Turfs, Edge of Chaos card content | **NOT FOUND** | `rules-reference.md` §14 has the mechanics; the cards are Kickstarter promo content |
| 13 | BGG game id | **Corrected: the game is BGG id 257305**, not 298049 as given in the research brief. | — |
| 14 | Whether AZADI (2021) changed the base rules | **UNKNOWN.** Wikipedia says the *coalition* mechanic was "cut from subsequent versions", and the 2023/2024 finals used the "India 2022-23" deck. So the Collectors Edition rulebook this project is built from may be **superseded**. **This is the highest-risk unknown on the list** — it would affect §13 Coalitions and possibly more. | The Essential Edition 2022-23 rulebook (id 1075247099), which is paged differently and 32 pp rather than 35 |
| 15 | The 2-player board's 7 zones are on the reverse of the same sheet | **INFERRED** from "DUAL LAYERED BOARD" + the Essential Edition contents listing one "Double-Sided Game Board". | Confirmed by `rules-reference.md` §14 saying it "requires the separate 2–3 player board" — **these two claims conflict. Resolve before implementing.** |
