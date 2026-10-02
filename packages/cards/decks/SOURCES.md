# SOURCES.md — per-card provenance for the shipped corpus

**One row per shipped card, and one row per card recovered in
`docs/AUTHENTIC-SHASN-REFERENCE.md` that is NOT shipped.** The `provenance` field on a
card and the `source` field beside it are the machine-readable half of this file; this is
the auditable half. If the two ever disagree, the card is wrong.

`REF n` = `docs/AUTHENTIC-SHASN-REFERENCE.md` §n. `Gnn` = `packages/cards/KNOWN-GAPS.md`.

**Tag meanings, as enforced by `src/validate.ts`:**

| tag | meaning |
|---|---|
| `verbatim` | card name **and** rules text reproduced word-for-word from a cited official source |
| `adapted` | recovered material, but the card as played here is a reconstruction — an option dropped, a branch flattened, or only one side recovered. The `source` field names what was dropped. |
| `inferred` | authored here. Register copied from REF §8.2; the content is not Memesys'. `source` must begin `original`. |

---

## 1. The headline finding: zero cards can be tagged `verbatim` — and the two reactive cards are why

**No card in this corpus is tagged `verbatim`, and that is not an oversight. It is
structurally unreachable while `reduce()` holds at 13 ops.**

The schema defines `text` as *"Player-facing rules text. Must describe exactly what
`effects` does."* For **every one** of the ~50 recovered X-cards, the clause that cannot be
expressed sits *inside* the printed rules text — a duration, a trigger, an auction, a
restriction, a token pile. Reproducing such a card's text word-for-word would therefore
print a sentence describing something the engine does not do. That is precisely the state
`KNOWN-GAPS.md` §0 calls **state (b): "a card that lies,"** and precisely what
`src/executable.ts` exists to prevent.

### The two cards that were supposed to be the counter-example, and were not

BLOCK and DEFLECT were the obvious candidates to move this number: they were the two
recovered cards whose *entire* effect is the reactive half, G13's phase machine now
executes that half, and REF §4.2.1 recovers **both of them in full, verbatim, from the
official Earth 2040 player aid**. Where every other recovered card has an inexpressible
clause buried in the middle of its text, these two have nothing else in them. They were
the first cards legitimately *eligible* for `verbatim`, and §1 of this file used to say so.

They ship as `adapted`, and the count is still 0. Reading the recovered text clause by
clause against what `reduce()` actually performs:

| recovered clause (REF §4.2.1) | performed? |
|---|---|
| Block: *"Play this immediately out of turn … to negate its effect"* | **yes** — `RESPOND_INTERRUPT`, `blocked` cancels the staged list |
| Block: *"Cannot be reversed or deflected"* | **yes** — a window takes exactly one answer |
| Block: *"Actions not directed at you may also be blocked"* | **yes** — this is why it declares `target: 'any-card'` |
| Block: *"For multi-turn cards the block must be done immediately, not midway"* | **yes, for free** — the window exists only while a card is resolving |
| Block: *"[OR] Discard an open Conspiracy Card or Headline Card"* | **no** — no op discards another player's open card |
| Block: *"May be used to block a card stealing this card"* | **no** — G20 `move-card` moves Ideology Cards only, so no Conspiracy can be stolen |
| Block: *"A block may be used to cleanse an already-active card"* | **no** — no op removes an installed `LiveEffect` (G9/G22) |
| Deflect: *"you may play this immediately to redirect its effect on any player other than them"* | **yes** |
| Deflect: *"that affects you"* | **widened** — `card-affecting-you` resolves through `reachesPastActor`, an approximation (G1) |
| Deflect: *"If the action card has a partial effect on you, only that partial effect is deflected"* | **no** — `applyEffect` computes one target per effect list, so the WHOLE resolution is redirected (G20) |

Three clauses in one card and two in the other, and the two that make each card's identity
— BLOCK's discard-an-open-card, DEFLECT's partial-effect granularity — are both missing
mechanisms rather than missing wording. So the eligibility was real and the execution is
still not complete, and the honest disposition of the whole recovered X-card corpus is
unchanged:

- **16** ship as `adapted`, each with the dropped clause named in its `source`.
- **36** do not ship at all, each listed in §4 below with the gap that blocks it.
- **0** ship as `verbatim`.

**What genuinely improved in this pass** is the Ideology deck, which is the deck players
actually see: 20 → 52 Ideology Cards, and the number carrying recovered question text went
8 → 10.

---

## 2. Source key

| key | source |
|---|---|
| **S1** | `https://www.scribd.com/document/515528021/` — "Headlines and Conspiracies Explained", 35 pp, all 5 launch campaigns. Body image-only on p1; names only from the AI blurb. |
| **S2** | `https://www.scribd.com/document/814006944/2024-Headline-And-Conspiracy-Cards-Explained` — 10 pp. India / USA / 2040 / Rome headlines. |
| **S3** | `https://r.jina.ai/https://www.scribd.com/document/915391788/2040-Deck-CC` — "2040 Deck – Conspiracy Cards", 3 pp. |
| **S4** | `https://r.jina.ai/https://www.scribd.com/document/915391789/2040-Deck-HC` — "2040 Deck – Headline Cards", 3 pp. |
| **S5** | `https://en.wikipedia.org/wiki/Shasn` |
| **S6** | Official product photography: `india_ideology.jpg`, `ideology_cards.png` (the 432-card marketing render), `crop_market.png`. |
| **REF** | `docs/AUTHENTIC-SHASN-REFERENCE.md` §8.2 (register) and §8.1 (ten recovered questions). |

---

## 3. Per-card index, all 118 shipped cards

### `in2020` / ideology — 32 cards

| # | card id | question | provenance | source |
|---|---|---|---|---|
| 1 | `ig-in2020-001` | Do you condemn the use of surgical strikes as a reactionary tool? | `adapted` | REF §5.1/§8.1 q1 — stem recovered; the Supremo answer *"No. Hit us first and you'll breathe your last."* recovered verbatim; other side authored |
| 2 | `ig-in2020-002` | Should we invade New Spain? | `adapted` | REF §5.2 + §8.1 q2 — stem and Capitalist answer recovered; Capitalist payout verified as 2 Trust + 1 Media + **0 Funds**; Supremo side authored |
| 3 | `ig-in2020-003` | Should mistakes be forgiven? | `adapted` | REF §8.1 q3 — stem recovered from the 432-card render; both answers authored |
| 4 | `ig-in2020-004` | Should women be free to have children single or in a relationship? | `adapted` | REF §8.1 q4 — stem recovered; both answers authored |
| 5 | `ig-in2020-005` | Should the government spend money on space exploration? | `adapted` | REF §8.1 q5 — stem recovered; both answers authored |
| 6 | `ig-in2020-006` | Is providing free food, housing and healthcare to all citizens a good idea? | `adapted` | REF §8.1 q6 — stem recovered; both answers authored |
| 7 | `ig-in2020-007` | Do the poor have the right to take wealth from the rich? | `adapted` | REF §8.1 q7 — stem recovered; both answers authored |
| 8 | `ig-in2020-008` | Should the rich be taxed to fund free higher education? | `adapted` | REF §8.1 q8 — stem recovered; both answers authored |
| 9 | `ig-in2020-009` | Should the corporation fund the festival or should the festival fund the corporation? | `inferred` | original; REF §8.2 |
| 10 | `ig-in2020-010` | Should the spokesperson resign before the committee finishes reading? | `inferred` | original; REF §8.2 |
| 11 | `ig-in2020-011` | Should the broadcast continue while the repair crew is still in the room? | `inferred` | original; REF §8.2 |
| 12 | `ig-in2020-012` | Should the old market stay open until the new one is finished? | `inferred` | original; REF §8.2 |
| 13 | `ig-in2020-013` | Should the tender be reopened every year or awarded once? | `inferred` | original; REF §8.2 |
| 14 | `ig-in2020-014` | Should a defaulting contractor be allowed to bid again? | `inferred` | original; REF §8.2 — no procurement question exists in the recovered pool |
| 15 | `ig-in2020-015` | Should the toll be raised to fund the bridge that replaced it? | `inferred` | original; REF §8.2 |
| 16 | `ig-in2020-016` | Should land records be digitised before the next election? | `inferred` | original; REF §8.2 |
| 17 | `ig-in2020-017` | Should free bus travel be extended to the district? | `inferred` | original; REF §8.2 |
| 18 | `ig-in2020-018` | Should the pension age rise with life expectancy? | `inferred` | original; REF §8.2 |
| 19 | `ig-in2020-019` | Should the minister appear on the news every week? | `inferred` | original; REF §8.2 |
| 20 | `ig-in2020-020` | Should the press conference be streamed before it is edited? | `inferred` | original; REF §8.2 — REF §8.2 rule 4: the joke is in the situation, never the wording |
| 21 | `ig-in2020-021` | Should the campaign advertise the number of schools opened? | `inferred` | original; REF §8.2 |
| 22 | `ig-in2020-022` | Should the protest permit be decided by the court or the police? | `inferred` | original; REF §8.2 |
| 23 | `ig-in2020-023` | Should a deserter's name be published after the war ends? | `inferred` | original; REF §8.2 |
| 24 | `ig-in2020-024` | Should the minister's statements be archived with their dates? | `inferred` | original; REF §8.2 |
| 25 | `ig-in2020-025` | Should the opposition be given more time on the news? | `inferred` | original; REF §8.2 |
| 26 | `ig-in2020-026` | Should the rally be allowed on the main road? | `inferred` | original; REF §8.2 |
| 27 | `ig-in2020-027` | Should the census count the people who sleep in the district? | `inferred` | original; REF §8.2 |
| 28 | `ig-in2020-028` | Should the free lunch continue through the summer holidays? | `inferred` | original; REF §8.2 |
| 29 | `ig-in2020-029` | Should the examination results be published with the schools named? | `inferred` | original; REF §8.2 |
| 30 | `ig-in2020-030` | Should the memorial be built where the crowd was standing? | `inferred` | original; REF §8.2 |
| 31 | `ig-in2020-031` | Should we stop aerial bombing developed countries? | `adapted` | REF §8.1 item 9 — stem legible but the verb is **occluded**; REF §8.1 says do not treat as verbatim. Verb supplied. Both answers authored |
| 32 | `ig-in2020-032` | Should Kashmiri farmers be given the right to fly drones? | `adapted` | REF §8.1 item 10 — stem legible only to *"FLY"*; REF §8.1 says do not treat as verbatim. Object of "fly" (drones) supplied. Both answers authored |

### `et2040` / ideology — 20 cards

Entirely authored. REF §2.4 recovered **zero** ordinary question Ideology Cards from any
campaign, so the Earth 2040 deck has no recovered material of any kind.

| # | card id | question | provenance |
|---|---|---|---|
| 1 | `ig-et2040-001` | Should the cure be free and the patent surrendered? | `inferred` |
| 2 | `ig-et2040-002` | Should the archive be opened to anyone who asks? | `inferred` |
| 3 | `ig-et2040-003` | Should the ration be shared by need or by household? | `inferred` |
| 4 | `ig-et2040-004` | Should the border be drawn on the water or on the families? | `inferred` |
| 5 | `ig-et2040-005` | Should the school teach the old census or the new one? | `inferred` |
| 6 | `ig-et2040-006` | Should the seed bank be sold to the highest bidder? | `inferred` |
| 7 | `ig-et2040-007` | Should the last coal plant close on a published date? | `inferred` |
| 8 | `ig-et2040-008` | Should every district below the seawall help pay for it? | `inferred` |
| 9 | `ig-et2040-009` | Should the orbital platform be sold to the highest bidder? | `inferred` |
| 10 | `ig-et2040-010` | Should the settlement on the coast be legalised or demolished? | `inferred` |
| 11 | `ig-et2040-011` | Should the desalination plant run on the municipal budget? | `inferred` |
| 12 | `ig-et2040-012` | Should the drought be announced before the reservoirs are dry? | `inferred` |
| 13 | `ig-et2040-013` | Should the broadcast carry the migration numbers every night? | `inferred` |
| 14 | `ig-et2040-014` | Should the space launch be televised live? | `inferred` |
| 15 | `ig-et2040-015` | Should the voting roll include the people who moved offshore? | `inferred` |
| 16 | `ig-et2040-016` | Should the cure be compulsory for anyone entering the district? | `inferred` |
| 17 | `ig-et2040-017` | Should the council publish the minutes before or after the vote? | `inferred` |
| 18 | `ig-et2040-018` | Should the state of emergency be renewed by default? | `inferred` |
| 19 | `ig-et2040-019` | Should the seawall be named after the engineer or the town? | `inferred` |
| 20 | `ig-et2040-020` | Should the climate curriculum be taught in every school? | `inferred` |

### `et2040` / conspiracy — 12 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `ct-et2040-001` | A Grave Inheritance | `adapted` | S3 / REF §4.2.1. Drops the per-opponent iteration and the conditional *"evict 2 voters belonging to every player who fails to pay"* (G2) |
| 2 | `ct-et2040-002` | Eradicating Germs | `adapted` | S3 / REF §4.2.1. Drops the mandatory *recurring* obligation and the *"any 1 resource denoted on it"* denomination (G3, G17) |
| 3 | `ct-et2040-003` | Singularity | `adapted` | S3 / REF §4.2.1. First branch only; drops the 3-of-4 set → permanent L5 unlock (G6) |
| 4 | `ct-et2040-004` | The Psychohistorian | `adapted` | S3 / REF §4.2.1. First branch only; drops the hidden three-action combo (G7/G19) |
| 5 | `ct-et2040-005` | Confidential Annex | `inferred` | original; REF §8.1 |
| 6 | `ct-et2040-006` | Quiet Redrafting | `inferred` | original; REF §8.2 |
| 7 | `ct-et2040-007` | The Wet Season Argument | `inferred` | original; REF §8.2 |
| 8 | `ct-et2040-008` | Filed Under Normal | `inferred` | original; REF §8.2 |
| 9 | `ct-et2040-009` | Dry Dock | `inferred` | original; REF §8.2. Deliberately does **not** restate PYTHONPOST (G9) |
| 10 | `ct-et2040-010` | The Long Commute | `inferred` | original; REF §8.2 |
| 11 | `ct-et2040-011` | Load Shedding, Properly Explained | `inferred` | original; REF §8.2 |
| 12 | `ct-et2040-012` | Server Space | `inferred` | original; REF §8.2. Deliberately does **not** restate SELECTIVE ACCESS MEMORY (G17) |
| 13 | `ct-et2040-013` | Holo Sapiens | `adapted` | REF §4.2.1 verbatim, on its first sentence alone. G20 `move-card`. Same archetype as `ct-in2020-011`; see KNOWN-GAPS.md G20 |
| 14 | `ct-et2040-014` | Block | `adapted` | REF §4.2.1 verbatim, clause by clause against the reducer. **Ships the whole reactive half** — G13's phase machine executes it and §1 tabulates all eight clauses. Drops three: discard an open card, block a card stealing itself, cleanse an already-active card. The `Otherwise: gain 1 Clout` clause is **authored**; the schema requires an effect list |
| 15 | `ct-et2040-015` | Deflect | `adapted` | REF §4.2.1 verbatim, clause by clause. Ships the reactive half with two named deviations: the **whole** effect list is redirected, not one partial effect (G20), and `target` is `any-card` rather than `card-affecting-you` (G1). The `Otherwise: gain 1 Trust` clause is **authored** |

### `et2040` / headline — 15 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `hl-et2040-001` | New Face Who Dis | `adapted` | S4 / REF §4.3. Drops the Volatile-Area prohibition (G5) and the every-player targeting (G8) |
| 2 | `hl-et2040-002` | Red Blooded | `adapted` | S4 / REF §4.3. Drops the per-voter scaling (G4) and the self-discard (G-new) |
| 3 | `hl-et2040-003` | Ain't No Cure For Love | `adapted` | S4 / REF §4.3. The self-discard branch is now the PRINTED clause (`target: 'you'`; G-new is closed). Drops only the OR-branch donate (G1) |
| 4 | `hl-et2040-004` | Quietly, The Ceiling Moved | `inferred` | original; REF §8.2 |
| 5 | `hl-et2040-005` | The Second Reading | `inferred` | original; REF §8.2 |
| 6 | `hl-et2040-006` | Long Winter, Short Ledger | `inferred` | original; REF §8.2 |
| 7 | `hl-et2040-007` | An Honest Institution | `inferred` | original; REF §8.2 |
| 8 | `hl-et2040-008` | Filed Under: Weather | `inferred` | original; REF §8.2 |
| 9 | `hl-et2040-009` | The Four Horsemen | `adapted` | S4 / REF §4.3. The denomination choice is expressed exactly; drops the purchase lock (G5) |
| 10 | `hl-et2040-010` | Married With Bits | `adapted` | S4 / REF §4.3. Drops the 2-opponent target set and the opt-out (G1) |
| 11 | `hl-et2040-011` | Good Gig Well Played | `adapted` | S4 / REF §4.3. Keep-one branch only; drops the two gifts and the discard fallback (G17, G20) |
| 12 | `hl-et2040-012` | Tide Warnings | `inferred` | original; REF §8.2. Deliberately does **not** restate JUST BREATHE (G16) |
| 13 | `hl-et2040-013` | Three Day Weekend | `inferred` | original; REF §8.2 |
| 14 | `hl-et2040-014` | The Policy Review | `inferred` | original; REF §8.2 |
| 15 | `hl-et2040-015` | Movement Anxiety Disorder | `adapted` | S4 / REF §4.3. Ships the trigger (`when: on-gerrymander` + `movedMyVoter` + `until: next-turn`) and needs G-new to reach your own pegs. Drops the counter (G10) and the multi-turn block (G13). **Replaced** the `inferred` SILICON RAIN, whose own `source` said it refused to restate any recovered card |

### `in2020` / conspiracy — 10 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `ct-in2020-001` | Jumlai Dafaar | `inferred` | original; REF §8.2 rule 5. A Grave Inheritance archetype |
| 2 | `ct-in2020-002` | Chai Aur Files | `inferred` | original; REF §8.2 rule 5 |
| 3 | `ct-in2020-003` | Budget Hai, Patra Nahi | `inferred` | original; REF §8.2 rule 5 |
| 4 | `ct-in2020-004` | Gumasta Nahi, Salaam Nahi | `inferred` | original; REF §8.2 rule 5 |
| 5 | `ct-in2020-005` | Khel Adhoora Chhodo | `inferred` | original; REF §8.2 rule 5 |
| 6 | `ct-in2020-006` | Baap Rekho | `inferred` | original; REF §8.2 rule 5. Singularity archetype |
| 7 | `ct-in2020-007` | Sadak Ka Hisab | `inferred` | original; REF §8.2 rule 5 |
| 8 | `ct-in2020-008` | Kharcha Uthao | `inferred` | original; REF §8.2 rule 5. Does **not** restate COUGH IT UP (G2) |
| 9 | `ct-in2020-009` | Chhoti Si Chori | `inferred` | original; REF §8.2 rule 5 |
| 10 | `ct-in2020-010` | Pet Ka Register | `inferred` | original; REF §8.2 rule 5 |
| 11 | `ct-in2020-011` | Jumla | `adapted` | REF §4.2.2 verbatim, on its first sentence alone. G20 `move-card`. The India skin of the Holo Sapiens archetype; see KNOWN-GAPS.md G20 |

> Naming note: `ct-in2020-001` ("Jumlai Dafaar") and `ct-in2020-010` ("Pet Ka Register") are
> **not** the recovered cards JUMLA and CHAI-PAANI. Those names are Memesys' and are
> reserved for the real cards; see §4 rows 17–18.

### `in2020` / headline — 11 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `hl-in2020-001` | Bhaag, Koi Nahi Rukega | `inferred` | original; REF §8.2 rule 5 |
| 2 | `hl-in2020-002` | Chai-Paani, Dobara | `inferred` | original; REF §8.2 rule 5 |
| 3 | `hl-in2020-003` | Aakhri Pehchaan | `inferred` | original; REF §8.2 rule 5 |
| 4 | `hl-in2020-004` | Ghadi Ka Aakhri Ghanta | `inferred` | original; REF §8.2 rule 5 |
| 5 | `hl-in2020-005` | Aadha Kisan, Poora Bazaar | `inferred` | original; REF §8.2 rule 5 |
| 6 | `hl-in2020-006` | Chuppi Ke Baad | `inferred` | original; REF §8.2 rule 5 |
| 7 | `hl-in2020-007` | Khaki Terror | `adapted` | S2 / REF §4.1. The donation is expressed exactly; drops *"you cannot make any purchases until you do so"* (G5, G10) |
| 8 | `hl-in2020-008` | Bijli Ka Hisaab | `inferred` | original; REF §8.2 rule 5 |
| 9 | `hl-in2020-009` | Pani Ki Kammi | `inferred` | original; REF §8.2 rule 5 |
| 10 | `hl-in2020-010` | Sarkar Ki Charcha | `inferred` | original; REF §8.2 rule 5 |
| 11 | `hl-in2020-011` | Chhoti Si Kasam | `inferred` | original; REF §8.2 rule 5 |

> Naming note: `hl-in2020-002` ("Chai-Paani, Dobara") is **not** the recovered card
> CHAI-PAANI. See §4 row 17.

### `core` / voter — 18 cards

Every one is `inferred`. **There is no verbatim Voter Card to import** — see §5.

| # | card id | cost | voters | provenance |
|---|---|---|---|---|
| 1 | `vo-core-001` | {funds 2} | 1 | `inferred` |
| 2 | `vo-core-002` | {clout 1, media 1} | 1 | `inferred` |
| 3 | `vo-core-003` | {media 2} | 1 | `inferred` |
| 4 | `vo-core-004` | {funds 3} | 1 | `inferred` |
| 5 | `vo-core-005` | {funds 2, clout 1} | 2 | `inferred` |
| 6 | `vo-core-006` | {media 2, trust 1} | 2 | `inferred` |
| 7 | `vo-core-007` | {funds 1, media 2} | 2 | `inferred` |
| 8 | `vo-core-008` | {clout 2, trust 1} | 2 | `inferred` |
| 9 | `vo-core-009` | {funds 3, media 1} | 3 | `inferred` |
| 10 | `vo-core-010` | {clout 2, media 1, trust 1} | 3 | `inferred` |
| 11 | `vo-core-011` | {funds 2, trust 2} | 3 | `inferred` |
| 12 | `vo-core-012` | {funds 3, clout 2} | 3 | `inferred` |
| 13 | `vo-core-013` | {trust 2} | 1 | `inferred` |
| 14 | `vo-core-014` | {clout 2} | 1 | `inferred` |
| 15 | `vo-core-015` | {media 3} | 2 | `inferred` |
| 16 | `vo-core-016` | {trust 2, funds 1} | 2 | `inferred` |
| 17 | `vo-core-017` | {funds 2, media 2} | 3 | `inferred` |
| 18 | `vo-core-018` | {clout 3, funds 1} | 3 | `inferred` |

---

## 4. Disposition of every recovered card — the audit trail

Nothing recovered is dropped silently. **52 distinct recovered cards** are accounted for
below. 16 ship `adapted`; 36 do not ship, each with the reason. (Net: one `inferred` placeholder RETIRED and one recovered card SHIPPED, so every deck SIZE is unchanged and `packages/server/test/corpus.test.ts` `SHIPPED.headline` still reads 26.)

Counting note: REF §4 lists 56 card rows across its four tables. Four are duplicates by
effect (REF §4.3: *"Deduplicate by effect, not by name"*) — SUBMERGED ≡ NEW FACE WHO DIS,
SNOOP B-O-DOUBLE-T ≡ PYTHONPOST, CARD GAMES ≡ A COWARD OR A JOURNALIST?, and BLOCK listed
twice. Two more (CRUSHED UNDER BELLY, IFTAR PARTY) carry a name but **no verified effect**.
56 − 4 duplicates = 52 distinct, which reconciles exactly with `KNOWN-GAPS.md` §0.1's
"50 recovered X-cards with complete official rules text" once the 2 unverified ones are
excluded.

### 4.1 Earth 2040 Conspiracy Cards — S3, REF §4.2.1

| card | disposition | blocking gap |
|---|---|---|
| A Grave Inheritance | **ships** `adapted` as `ct-et2040-001` | G2 |
| Block | **ships** `adapted` as `ct-et2040-014` | the reactive half only. G13 landed. Still dropped: the *"[OR] Discard an open Conspiracy Card or Headline Card"* branch (no op discards an open card), *"block a card stealing this card"* (G20 moves Ideology Cards only) and *"cleanse an already-active card"* (no op removes a `LiveEffect`, G9/G22). §1 tabulates all eight recovered clauses |
| Cut, Copy, and Paste | not representable | G16 zone-scoped, G22 spans two turns. (The convert-own clause is no longer blocked on G-new.) |
| Deep Thoughts | not representable | no op borrows an opponent's Ideologue powers. **Not a G20 card** despite the row-9 table: move-card moves cards, not powers |
| Deflect | **ships** `adapted` as `ct-et2040-015` | the reactive half only. G13 landed. Still dropped: *"only that partial effect is deflected"* — `applyEffect` computes one target per effect list, so the whole resolution is redirected (G20). And widened: `target: 'any-card'` rather than `card-affecting-you`, which resolves through an approximation (G1) |
| Eradicating Germs | **ships** `adapted` as `ct-et2040-002` | G3, G17 |
| Holo Sapiens | **ships** `adapted` as `ct-et2040-013` | G20 landed — only *"This is an extra Ideology Card"*. G15 dynamic price, G17 the "of your choice", G23 re-filing, G12 expiry-on-purchase |
| If You Like Piña Colada | not representable | mat-wide doubling with a cap check; no `gain`/`lose` op scales a whole pool |
| Lab-Grown Earworm | not representable | G14 trigger on *another* player's purchase; plus self-limiting copies |
| Power Trip | not representable | G14 trigger |
| Quantum Wristband | not representable | G14 + G13 (auction of 3 headlines, self-immunity, IOU bids) |
| Selective Access Memory | **now partially playable** — see §4.7 | the remaining clause, *"in any order"*, needs a decision over the pile's contents, which is a new `Choice` kind and therefore a wire-format change the client owns (G17 half-closed by `draw-conspiracy.from: 'discard'`) |
| Singularity | **ships** `adapted` as `ct-et2040-003` (branch 1 of 2) | G6 |
| The Greta Effect | not representable | G14 persistent debuff, N-target |
| The Psychohistorian | **ships** `adapted` as `ct-et2040-004` (branch 1 of 2) | G7/G19 |
| Thoughts and Prayers | not representable | G4 — scales off an opponent's pegs on the board |

> REF §4.2.1's heading says *"15 cards"* but the table has **16** rows. The 16 are listed.

### 4.2 India Conspiracy Cards — REF §4.2.2

| card | disposition | blocking gap |
|---|---|---|
| Chai-Paani | not representable | **the base effect was never recovered.** Only a re-application clause exists (*"a second card can be applied on the same player; the first gets deactivated"*), from a search snippet of S2. Shipping it would mean authoring the whole card under a recovered name |
| Jumla | **ships** `adapted` as `ct-in2020-011` | G20 landed, so the card is a movable object and the first sentence executes. Still dropped: G15 (*"as many resources as the Ideologue level this card is on"* — a computed price the seller reads), G17 (*"of your choice"* — a choice over the pile's contents, which is a new `Choice` kind the client owns), G23 (re-filing under another Ideologue). See KNOWN-GAPS.md G20 |
| Cult-ivating Obedience | not representable | protection of a specific majority (a `PlayerState` field, not an effect). Recovered from S5, not from a player-aid. **Still not G20-only** now that G20 has landed: a protection is a PlayerState field, not an effect |

### 4.3 Names recovered without an effect — REF §4.2.2, from the S1 blurb

| card | disposition | reason |
|---|---|---|
| Crushed Under Belly (headline) | not representable | name only. The "effect" is a six-word AI-blurb paraphrase (*"discard voters and receive resources"*), not official rules text. Authoring rules for it under a recovered name would be a fabrication |
| Iftar Party (headline) | not representable | same |
| Block | duplicate of §4.1, where it **ships** as `ct-et2040-014` | the S1 blurb names it and nothing more; §4.1 recovers the full text, so there is nothing here to disposition separately |

### 4.4 Headline Cards, all campaigns — S2, REF §4.1

| card | disposition | blocking gap |
|---|---|---|
| GREAT LEADER, BAD ECONOMY | not representable | G9 + G14 — rest-of-game trigger on another player's influence |
| DOSTI BANI RAHE | not representable | G15 + G22 — *your* Gerrymandering Rights, read on *their* turn |
| KHAKI TERROR | **ships** `adapted` as `hl-in2020-007` | G5, G10 |
| GROWING DISSENT | not representable | G9 + G14 |
| A CALL FROM KARACHI | not representable | G13 auction (ruled out with a cost) + G17 deck search + G18; also explicitly *"you don't need to reveal this card"* |
| STAY IN YOUR LIMITS | not representable | G2 — per-player iteration plus a conditional bonus |
| POLO RETREAT | not representable | no op borrows another player's Level 3 powers. **Not G20**: nothing here moves a card |
| NEXT BILLION DATA POINTS | not representable | G13 vote (no self-votes, re-vote on tie) |
| PYTHONPOST | not representable | G9 rest-of-game purchase surcharge + G5 |
| SUBMERGED | ships as `hl-et2040-001` | same card as NEW FACE WHO DIS (REF §4.3); **not double-counted** |
| COUGH IT UP | **now partially playable** — see §4.7 | `evict` carries `target` since commit `9d1326c`, so *"All your opponents evict 1 voter"* plays. The conditional bonus — *"if a player breaks a majority using this action, all other players gain 1 resource of their choice"* — is still G2: no op reads board state to decide a payout |
| NERO'S GUESTS | not representable | G16 — zone-scoped, all-or-nothing, *"this zone"* context |
| ON THE "HIGH" SEAS | not representable | G11 hostage — a persistent board-resident object holding 4 pegs |
| A COWARD OR A JOURNALIST? | not representable | **G20 has landed and this is STILL blocked**, which is the interesting entry here. It needs `from: 'pending'` — donating the card you have been PUT — and that is refused AT THE TYPE LEVEL, because it would tell a mid-answer player the card exists, offer a look at it by proxy, and empty `_pendingCard` into a soft-lock where `ANSWER` and `END_TURN` are both illegal. It needs G12's in-flight queue (an owner, a seat, a deadline) besides. See KNOWN-GAPS.md G20 |
| BLESSINGS OF PARENTS PAST | not representable | G17 (choose 2 of 2 Voter Cards) + a Voter Card donation, which is not an Ideology Card hand at all + a defined two-player resolution order. **Not G20-blocked** now |

### 4.5 Headline Cards, Earth 2040 — S4, REF §4.3

| card | disposition | blocking gap |
|---|---|---|
| 404 | not representable | G18 — swaps who answers which card |
| Ain't No Cure For Love | **ships** `adapted` as `hl-et2040-003` | G1 only (G-new closed) |
| As Clear As Water | not representable | G17 + G18 (a REVEAL of a Conspiracy Card, and who reveals first). **Not G20-blocked** now |
| Brave New Worlds | not representable | G18 — and it suppresses passive income |
| Card Games | not representable | identical to A COWARD OR A JOURNALIST?, so identically blocked: G12 plus the `from: 'pending'` refusal. See that row |
| Don't Kiss The Babies | not representable | G5 — a purchase surcharge, i.e. a cost modifier |
| Fatality | not representable | G1 — donate voters to any opponent, placed immediately |
| Fuelling The News | not representable | G17 (draw 3 Headlines) + G18 (choose the resolution order). The *giving* half moves Headline Cards, and move-card is Ideology-only. **Not G20-blocked** now |
| Gender Trouble | not representable | G5 + G22 |
| Good Gig Well Played | **ships** `adapted` as `hl-et2040-011` (keep-one branch) | G17, G20 |
| Higgs Moron | not representable | G10 (tokens on a card) + G12 (timed pass) |
| Just Breathe | not representable | G16 — the zone is computed from board state |
| Married With Bits | **ships** `adapted` as `hl-et2040-010` | G1 |
| Movement Anxiety Disorder | **ships** `adapted` as `hl-et2040-015` (replacing the `inferred` SILICON RAIN) | G10 (the counter), G13 (multi-turn block). Both of its recorded gaps, G9 and G22, were already CLOSED when the playability probe wrote the row down |
| New Face Who Dis | **ships** `adapted` as `hl-et2040-001` | G5, G8 |
| Red Blooded | **ships** `adapted` as `hl-et2040-002` | G4, G-new |
| Snoop B-O-Double-T | not representable | G9. Same card as PYTHONPOST |
| The Big Freeze | not representable | G5 + G9 + G15 + G22 |
| The Four Horsemen | **ships** `adapted` as `hl-et2040-009` | G5 |
| Why The Long Face? | not representable | G14 + G22 |

> REF §4.3's heading says *"18 cards"* but the table has **20** rows. All 20 are listed.

### 4.6 Ideology material — REF §2.1, §5.1, §5.2, §8.1

| item | disposition |
|---|---|
| Supremo-Capitalist character card (*"Is it still xenophobia if I make a lot of money?"*) | **not representable.** It is a character card, not a question card. `IdeologyCard` requires exactly two sides with two different Ideologues, and a character card has neither. REF §2.1 says so itself |
| §8.1 questions 1–8 | ship as `ig-in2020-001` … `ig-in2020-008`, all `adapted`. Stems recovered; **no complete card was ever recovered** — REF §2.4 and REF §10 item 1 both record zero ordinary question cards in full |
| §8.1 item 9, aerial bombing | ships as `ig-in2020-031`, `adapted`. Stem legible, **verb occluded**; REF §8.1 says do not treat as verbatim |
| §8.1 item 10, Kashmiri farmers | ships as `ig-in2020-032`, `adapted`. Stem legible only to "FLY"; **object occluded**; REF §8.1 says do not treat as verbatim |
| Any printed Ideology payout | not recovered. REF §10 item 2: payouts are icon discs, not numerals, and were never published in a crawlable text source |

---

## 4.7. Playability, measured by playing — `npm run playable`

The disposition above answers *"is there an effect list for this card?"*. It does not
answer *"can a player reach a position from which that list resolves?"*, and those are
different questions — `npm run validate` only ever asks the first.

`scripts/playable.ts` takes every recovered card in §4, writes the largest honest
effect list today's vocabulary can carry, and **drives it through the real `reduce()`**
— Headlines through `ACK_HEADLINE` in the post-turn queue, Conspiracies through
`PLAY_CONSPIRACY` from a hand — then answers every decision the card raises. A card
counts as playable only if the reducer accepts it *and* the state it leaves differs
from a control card's.

**14 of 54 probed cards are playable.** 40 are not expressible at all. **0 are refused
at play time** and **0 are expressible-but-unexecutable** — which is the finding worth
stating: `src/executable.ts` has no remaining hole between "the validator will accept
this card" and "the reducer will perform it". Every unshipped recovered card is
unshipped because there is no op for it, not because a card slipped past a check.

### What the measurement changed in this ledger

Two rows above were written before three engine commits landed, and playing them found
the difference:

| card | ledger said | measured |
|---|---|---|
| SELECTIVE ACCESS MEMORY | not representable, G17 | **plays.** `draw-conspiracy.from: 'discard'` takes the top of the discard pile. *"in any order"* still needs a new `Choice` kind — G17 half-closed, not closed |
| COUGH IT UP | not representable, G2 (`evict` had no `target`) | **plays its first branch.** `evict` carries `target` since `9d1326c`, so *"all your opponents evict 1 voter"* resolves. The majority-conditional bonus is still G2 |

Two harness artifacts were also found and fixed while building the measurement, and
they are recorded because either would have inflated the count: resolving a Headline
draws the next one off the headline pile, and that pile was inside the state
fingerprint. No op draws a Headline — which is exactly why FUELLING THE NEWS is G17 —
so it is now excluded, and *"did the card do anything"* is decided differentially
against a control card that must come back NO-OP or the script exits 1.

### Two findings that are the engine's, not the corpus's

1. **`convert-voter` cannot resolve for any target other than `you`.**
   `raiseVoterDecision` gives a non-source target scope `'own'`, so the *opponent* is
   asked to convert; `resolveChoice` then refuses with *"that voter is already yours"*.
   The decision is raised to a player who cannot answer it, every time. No shipped card
   uses it — `hl-et2040-003` was written as a `discard-voter` — which is why this has
   never surfaced. It is in `reduce.ts`, not here.
2. **REF §4.3 reads AIN'T NO CURE FOR LOVE as *"Discard 2 of your own voters"*, which
   did not play** (G-new). What shipped as `hl-et2040-003` for three iterations was the
   **opponents'** reading, with the `text` weakened to match — the card and its printed
   text were two different cards. **G-new is now closed**: `voterScope` in `reduce.ts`
   passes the RAW `target` field through instead of the value `applyEffect` defaulted it
   to, so `discard-voter` with `target: 'you'` reaches the chooser's own pegs while a
   card that says nothing still gets `'others'`. The card now ships the printed clause,
   and the only dropped clause is the OR-branch donate (G1) — with that branch gone,
   the printed *"if you are unable to do either, ignore this card"* fallback has nothing
   to name and is not stated.

---

## 5. The "3 Voter Cards" claim in REF §0 is unsupported

REF §0 states the corpus recovered *"plus the full print-and-effect text of 3 Voter
Cards."* **No such data exists anywhere in the reference document.** The section that owns
Voter Cards, **REF §3, is `[UNKNOWN]` in every bullet**, and REF §10 item 3 records the
60-card cost distribution as **NOT FOUND**.

What REF §3 actually contains about Voter Cards is *structural*, not card-level: 60 per
box, a combination of resources, 1/2/3 voters, and the note that *"Voter Cards are a named,
countable category."* There is not one printed cost for one Voter Card in the document.

**Consequence:** 0 verbatim Voter Cards ship, and all 18 are `inferred`. Rather than
fabricate three costs and tag them verbatim, `vo-core-013`'s `source` field records the
contradiction so the next editor sees it on the card. Closing this needs one of the three
routes in REF §2.4: the Tabletop Simulator Workshop mod, BGG image CDN galleries, or the
physical deck.

---

## 6. Discrepancies found in the reference doc while transcribing

Recorded so nobody re-derives them from scratch. None of these changes a shipped card.

1. **§4.2.1 heading says 15 cards; the table has 16.**
2. **§4.3 heading says 18 cards; the table has 20.**
3. **§4.1 heading attributes 19 Headline Cards to S2; only 15 are listed** (6 India, 2 USA,
   3 Earth 2040, 4 Rome). The other 4 are presumably in the parts of S2 that REF §10 item 5
   says need per-page extraction.
4. **§0's "3 Voter Cards"** — see §5 above.
5. **§0's "~12 partial Ideology questions/answers"** resolves to 10 stems (§8.1 items 1–10),
   of which 2 have no answer side and 2 have an occluded word.
6. **§4.2.1 preamble** notes *"if there are no voters to discard then effect is over"* —
   a conditional the Effect union has no way to state (G2/G5 family). Any card relying on
   it needs the same treatment.

---

## 7. Provenance summary

The `after` column is **measured, not remembered** — `npm run validate` prints the
provenance split and the deck census, and `npm run playable` prints the playability count.
A ledger that drifts from the decks is worse than no ledger, so where this table used to
quote numbers from an earlier pass, it quotes today's.

| | before | after (measured) |
|---|---:|---:|
| Total cards shipped | 64 | **122** |
| Ideology Cards | 20 | **52** |
| Voter Cards | 12 | 18 |
| Conspiracy Cards | 14 | **26** |
| Headline Cards | 18 | 26 |
| `verbatim` | 0 | **0** — see §1, and BLOCK/DEFLECT are why |
| `adapted` (carries recovered material) | 19 | **25** |
| `inferred` | 45 | **97** |
| Cards carrying recovered text | 19 | **25** |
| Recovered cards not representable | 41 | **37** — each in §4 |
| Recovered cards playable, by playing | — | **25 of 54** (`npm run playable`) |

**The one number that matters for playability:** REF §2.3 records 8–12 Ideology Cards in a
player's hand after a 5-player game. The India deck went from 12 cards — so players saw the
entire deck and then some — to **32**, and the Earth 2040 deck from 8 — meaning the deck was
exhausted before the third player finished their turn — to **20**. Both decks now exercise
all six Ideologue pairings at exactly 25% each, which the balance checker confirms.
