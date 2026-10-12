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
structurally unreachable while `reduce()` holds at 20 ops.**

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

- **44** ship as `adapted`, each with the dropped clause named in its `source`. That is
  exactly the 44 Conspiracy and Headline Cards the deck files tag `adapted`, which is the
  whole of the corpus's recovered material — **44 of 231 shipped cards, 19%**. (The other
  10 `adapted` cards are Ideology Cards carrying a recovered question **stem** and nothing
  else; 44 + 10 = the corpus's 54.)
- **10** do not ship at all, and the figure is the probe's own verdict rather than an
  estimate: they are `npm run playable`'s *inexpressible* count — Quantum Wristband,
  Chai-Paani, Cult-ivating Obedience, DOSTI BANI RAHE, A CALL FROM KARACHI, NEXT BILLION
  DATA POINTS, ON THE "HIGH" SEAS, 404, Fuelling The News, Higgs Moron.
- **0 are expressible-but-unfiled.** This used to be **9**, and it was the most expensive
  number in this file: DEEP THOUGHTS, THE GRETA EFFECT, POLO RETREAT (§4.4), A COWARD OR A
  JOURNALIST? and CARD GAMES, SUBMERGED, SNOOP B-O-DOUBLE-T, THE BIG FREEZE, and LAB-GROWN
  EARWORM all sat in a probe row and in **no deck file at all** — the engine could perform
  every one of them and no player could ever draw one, so those nine measured the
  vocabulary and called it the game. **All nine are now filed under their recovered names**
  (§3 has the row for each), the corpus is 231 cards rather than 222, and the headline
  number below moved with them. **The understating was the defect**: the project was
  reporting a smaller recovered corpus than it had actually built.
- **0** ship as `verbatim`.

**So 10 of the 54 named recovered cards are absent from the corpus entirely** — all ten
not representable — and 44 ship, which is 54. The two names recovered **with no effect at
all** (CRUSHED UNDER BELLY, IFTAR PARTY) are counted inside the 54 rather than beside it,
which is why the arithmetic closes at 54 rather than 56. Those per-section denominators are
REF §4's own rows and do not move with the corpus; see the note under §4.7 for why this
pass did not re-derive the per-section numerators.

**What genuinely improved in this pass** is the Ideology deck, which is the deck players
actually see: 20 → 52 → **76** Ideology Cards, and the number carrying recovered question
text went 8 → 10 and has not moved since, because REF §2.4 is right that the recovered pool
is exhausted: everything past `ig-in2020-032` is authored. **The `76` in that chain is the
size of the deck at the end of THAT pass and is left as history; the deck is 134 today**
(92 `in2020` + 42 `et2040`, §3), and the recovered-stem count is still 10.

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

## 3. Per-card index, all 303 shipped cards

**The seven deck files, counted off `"id"` rather than remembered: 138 + 62 + 17 + 18 + 17 + 30 + 21 = 303.** `npm run validate` prints the same census.

### `in2020` / ideology — 138 cards

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
| 9 | `ig-in2020-009` | Can parties hand out free laptops and televisions before an election? | `inferred` | original; REF §8.2 |
| 10 | `ig-in2020-010` | Do police need a judge's warrant to tap a citizen's phone? | `inferred` | original; REF §8.2 |
| 11 | `ig-in2020-011` | Can authorities shut down mobile internet during riots? | `inferred` | original; REF §8.2 |
| 12 | `ig-in2020-012` | Must the army buy its weapons only from Indian factories? | `inferred` | original; REF §8.2 |
| 13 | `ig-in2020-013` | Do elected ministers deserve the final say on appointing high court judges? | `inferred` | original; REF §8.2 |
| 14 | `ig-in2020-014` | Can farmers sell crops to private traders outside government mandis? | `inferred` | original; REF §8.2 — no procurement question exists in the recovered pool |
| 15 | `ig-in2020-015` | Is fencing every kilometre of the eastern border worth the cost? | `inferred` | original; REF §8.2 |
| 16 | `ig-in2020-016` | Does the Centre need its power to dismiss elected state governments? | `inferred` | original; REF §8.2 |
| 17 | `ig-in2020-017` | Must households pay for every litre of piped water they use? | `inferred` | original; REF §8.2 |
| 18 | `ig-in2020-018` | Should the pension age rise with life expectancy? | `inferred` | original; REF §8.2 |
| 19 | `ig-in2020-019` | Do World Cup cricket matches belong on free public television? | `inferred` | original; REF §8.2 |
| 20 | `ig-in2020-020` | Do campaigns need to go silent on social media before polling day? | `inferred` | original; REF §8.2 — REF §8.2 rule 4: the joke is in the situation, never the wording |
| 21 | `ig-in2020-021` | Is it proper for public money to buy ads praising government schemes? | `inferred` | original; REF §8.2 |
| 22 | `ig-in2020-022` | Can police ban a protest without first going to court? | `inferred` | original; REF §8.2 |
| 23 | `ig-in2020-023` | Must every young citizen do a year of military service? | `inferred` | original; REF §8.2 |
| 24 | `ig-in2020-024` | Do news channels deserve fines for airing fake news? | `inferred` | original; REF §8.2 |
| 25 | `ig-in2020-025` | Must police officers wear body cameras on every shift? | `inferred` | original; REF §8.2 |
| 26 | `ig-in2020-026` | Do political rallies have the right to block main city roads? | `inferred` | original; REF §8.2 |
| 27 | `ig-in2020-027` | Is compulsory voting a good idea for national elections? | `inferred` | original; REF §8.2 |
| 28 | `ig-in2020-028` | Can criminal trials be broadcast live on national television? | `inferred` | original; REF §8.2 |
| 29 | `ig-in2020-029` | Must riverfront beautification wait until the river itself is clean? | `inferred` | original; REF §8.2 |
| 30 | `ig-in2020-030` | Is it right for police to parade arrested suspects before the press? | `inferred` | original; REF §8.2 |
| 31 | `ig-in2020-031` | Should we stop aerial bombing developed countries? | `adapted` | REF §8.1 item 9 — stem legible but the verb is **occluded**; REF §8.1 says do not treat as verbatim. Verb supplied. Both answers authored |
| 32 | `ig-in2020-032` | Should Kashmiri farmers be given the right to fly drones? | `adapted` | REF §8.1 item 10 — stem legible only to *"FLY"*; REF §8.1 says do not treat as verbatim. Object of "fly" (drones) supplied. Both answers authored |
| 33 | `ig-in2020-033` | Are big dams worth building if they flood tribal villages? | `inferred` | original; REF §8.2 — the recovered pool has no small-scale question |
| 34 | `ig-in2020-034` | Is a farm loan waiver justified after a failed monsoon? | `inferred` | original; REF §8.2 — creditor vs debtor, a trade the recovered pool has no instance of |
| 35 | `ig-in2020-035` | Should India pay more than its agreed share of the climate fund? | `inferred` | original; REF §8.2 |
| 36 | `ig-in2020-036` | Can private companies run prisons for profit? | `inferred` | original; REF §8.2 — measured inside the household |
| 37 | `ig-in2020-037` | Can companies fund political parties anonymously through electoral bonds? | `inferred` | original; REF §8.2 |
| 38 | `ig-in2020-038` | Is selling naming rights to metro stations a good idea? | `inferred` | original; REF §8.2 |
| 39 | `ig-in2020-039` | Can farmland be taken for factories without the farmers' consent? | `inferred` | original; REF §8.2 |
| 40 | `ig-in2020-040` | Is opening coal mines in protected forests worth the extra power? | `inferred` | original; REF §8.2 — the inter-generational question, absent from the recovered pool |
| 41 | `ig-in2020-041` | Must TV channels limit advertising to ten minutes an hour? | `inferred` | original; REF §8.2 — the Capitalist side votes to keep a file closed |
| 42 | `ig-in2020-042` | Must exit polls stay secret until the last vote is cast? | `inferred` | original; REF §8.2 |
| 43 | `ig-in2020-043` | Can troops be sent into a riot-hit state without its consent? | `inferred` | original; REF §8.2 |
| 44 | `ig-in2020-044` | Can a foreign company bid to run a major Indian port? | `inferred` | original; REF §8.2 |
| 45 | `ig-in2020-045` | Should the district hospital publish its death rate every quarter? | `inferred` | original; REF §8.2 |
| 46 | `ig-in2020-046` | Must police register every complaint they receive as an FIR? | `inferred` | original; REF §8.2 — eligibility, not existence |
| 47 | `ig-in2020-047` | Must Hindi be taught in schools in every state? | `inferred` | original; REF §8.2 |
| 48 | `ig-in2020-048` | Must every rupee sent to village panchayats be published online? | `inferred` | original; REF §8.2 |
| 49 | `ig-in2020-049` | Should the Centre impose final settlements on interstate river disputes? | `inferred` | original; REF §8.2 |
| 50 | `ig-in2020-050` | Should slum families be rehoused on the same land before demolition? | `inferred` | original; REF §8.2 — Idealist x Supremo seam, per REF §2.3 |
| 51 | `ig-in2020-051` | Should loss-making rural bus routes keep running at public expense? | `inferred` | original; REF §8.2 |
| 52 | `ig-in2020-052` | Should each new government be free to rewrite school history textbooks? | `inferred` | original; REF §8.2 — the recovered pool has no institutional question |
| 53 | `ig-in2020-053` | Should the national cricket team refuse matches against hostile neighbours? | `inferred` | original; REF §8.2 |
| 54 | `ig-in2020-054` | Should the film censor board be allowed to order scene cuts? | `inferred` | original; REF §8.2 |
| 55 | `ig-in2020-055` | Should new government doctors be required to serve two years in villages? | `inferred` | original; REF §8.2 — the Showstopper side argues for the minister's own district |
| 56 | `ig-in2020-056` | Should loudspeaker noise limits apply during religious festivals too? | `inferred` | original; REF §8.2 |

#### `ig-in2020-057` … `ig-in2020-092` — 36 cards authored 2026-10-04, closing the deck-size gap

REF §2.2 ships **108** Ideology Cards per campaign and a session consumes **52–68** of
them, so a campaign deck below 68 *guarantees* a table seeing the same dilemma twice
inside one game. This deck held 56. REF §2.2's own number is the target and
`src/balance.ts`'s `IDEOLOGY_CAMPAIGN_SIZE` is 108.

**Every one of these 36 is `inferred` and every one names what it drops.** The standing
dropped-clause note on each card is: *the physical card's second printed face (REF §5.3)
and its ideologue nameplate* — neither is representable in `{question, sides}`, and REF
§5.1 records that the real card prints no campaign framing, no flavour text and no effect
clause, so **no condition, no seat-relative direction and no effect clause is dropped,
because the printed card has none**. The remaining per-card clause — which Ideologue
argues what — is on the card itself and is not repeated here.

**Every side pays exactly 3 as a 2+1 split**, matching 150 of the 152 pre-existing sides.
The two exceptions in the shipped deck (a `funds2+trust2` and a `funds2+media2`, both
totalling 4) were not copied.

**No new card is `COMPOSITION_DOMINANT`, and none is close.** The payouts were not chosen
by eye. All **216** legal 2+1 payout pairs were scored by exact knapsack over the shipped
market at all **1820** reachable holdings (`src/holdings.ts`), and only pairs where BOTH
sides win a substantial share of holdings were used. Every new card is won by one side at
roughly 330–500 holdings and by the other at roughly 320–500 — so each one is decisive
for a player sitting on a narrow pool and a coin-flip for a player holding a spread, which
is the axis the brief asked for.

| # | card id | question | provenance | source |
|---|---|---|---|---|
| 57 | `ig-in2020-057` | Should foreign tech companies be forced to store Indian users' data locally? | `inferred` | original; REF §8.2 register, REF §5 tone — Capitalist on the cold chain, Supremo on the ration |
| 58 | `ig-in2020-058` | Should investors from bordering countries need government approval to buy Indian firms? | `inferred` | original; REF §8.2/§5 — Capitalist on grain that cannot move, Supremo on sovereignty |
| 59 | `ig-in2020-059` | Should cash payments above two lakh rupees be banned outright? | `inferred` | original; REF §8.2/§5 — Capitalist on the bed already paid for, Supremo on the unfilled ward |
| 60 | `ig-in2020-060` | Should diesel cars over ten years old be banned from Delhi? | `inferred` | original; REF §8.2/§5 — Capitalist on arrears becoming custom, Supremo on the named month |
| 61 | `ig-in2020-061` | Should private companies reserve most jobs for residents of their state? | `inferred` | original; REF §8.2/§5 — Capitalist on raising its own money, Supremo on being owned |
| 62 | `ig-in2020-062` | Should private hospital fees be capped during a pandemic? | `inferred` | original; REF §8.2/§5 — Capitalist on scarcity clearing, Showstopper on the hour it is said |
| 63 | `ig-in2020-063` | Should cinemas have to play the national anthem before every film? | `inferred` | original; REF §8.2/§5 — Capitalist on the settled fee, Showstopper on who must watch |
| 64 | `ig-in2020-064` | Should social media influencers pay income tax on free gifted products? | `inferred` | original; REF §8.2/§5 — Capitalist on the cover price, Showstopper on a noticeboard |
| 65 | `ig-in2020-065` | Should India spend billions bidding to host the Olympic Games? | `inferred` | original; REF §8.2/§5 — Capitalist on lighting, Showstopper on where the camera points |
| 66 | `ig-in2020-066` | Should ride-hailing apps be banned from surge pricing at peak hours? | `inferred` | original; REF §8.2/§5 — Capitalist on the precedent, Showstopper on the notice |
| 67 | `ig-in2020-067` | Should midday school meals be delivered home when schools are shut? | `inferred` | original; REF §8.2/§5 — Capitalist on the closed register, Idealist on feeding where they are |
| 68 | `ig-in2020-068` | Should fuel taxes be cut when petrol prices hit record highs? | `inferred` | original; REF §8.2/§5 — Capitalist on passing it to the burner, Idealist on the old price |
| 69 | `ig-in2020-069` | Should free rations stop for families whose incomes have risen? | `inferred` | original; REF §8.2/§5 — Capitalist on a withdrawable subsidy, Idealist on restarting a list |
| 70 | `ig-in2020-070` | Should private schools reserve a quarter of seats for poor children? | `inferred` | original; REF §8.2/§5 — Capitalist on what is measurable, Idealist on the seat |
| 71 | `ig-in2020-071` | Should forests be cleared for mining if companies plant trees elsewhere? | `inferred` | original; REF §8.2/§5 — Capitalist on the timber value, Idealist on knowledge older than paper |
| 72 | `ig-in2020-072` | Should Delhi's colonial-era government buildings be torn down for new ones? | `inferred` | original; REF §8.2/§5 — Supremo on the fort, Showstopper on a televised parade |
| 73 | `ig-in2020-073` | Should ministers give up VIP convoys and sit in ordinary traffic? | `inferred` | original; REF §8.2/§5 — Supremo on the presence being the policy, Showstopper on the bulletins |
| 74 | `ig-in2020-074` | Should new sports stadiums be named after political leaders? | `inferred` | original; REF §8.2/§5 — Supremo on the sovereign act, Showstopper on the queue policing it |
| 75 | `ig-in2020-075` | Should bars and restaurants in big cities stay open all night? | `inferred` | original; REF §8.2/§5 — Supremo on the margin, Showstopper on the street filling |
| 76 | `ig-in2020-076` | Should mobile internet be switched off to stop cheating in exams? | `inferred` | original; REF §8.2/§5 — Supremo on order preceding papers, Showstopper on the overnight story |
| 77 | `ig-in2020-077` | Should the state track citizens' phones to enforce pandemic quarantine? | `inferred` | original; REF §8.2/§5 — Supremo on the account to correct, Idealist on the one morning it is read |
| 78 | `ig-in2020-078` | Should families with more than two children lose government benefits? | `inferred` | original; REF §8.2/§5 — Supremo on distance as the sentence, Idealist on the visiting family |
| 79 | `ig-in2020-079` | Should welfare payments go only to people with an Aadhaar number? | `inferred` | original; REF §8.2/§5 — Supremo on a budget defeated early, Idealist on daylight arithmetic |
| 80 | `ig-in2020-080` | Should strikes be banned in essential services like railways and power? | `inferred` | original; REF §8.2/§5 — Supremo on slowness as the arrangement, Idealist on idle hands |
| 81 | `ig-in2020-081` | Should same-sex marriages be legally recognised? | `inferred` | original; REF §8.2/§5 — Supremo on a law kept to be cited, Idealist on a law only quoted |
| 82 | `ig-in2020-082` | Should firecrackers be banned during Diwali to cut air pollution? | `inferred` | original; REF §8.2/§5 — Showstopper on the argument starting first, Idealist on the room's answer |
| 83 | `ig-in2020-083` | Should people have the right to get old news about them deleted online? | `inferred` | original; REF §8.2/§5 — Showstopper on ammunition that keeps, Idealist on dating what was true |
| 84 | `ig-in2020-084` | Should junk food adverts be banned during children's television shows? | `inferred` | original; REF §8.2/§5 — Showstopper on the donor as participant, Idealist on teaching the country to wait |
| 85 | `ig-in2020-085` | Should women cricketers get the same match fees as men? | `inferred` | original; REF §8.2/§5 — Showstopper on curiosity, Idealist on nobody being obliged to watch |
| 86 | `ig-in2020-086` | Should children under twelve be allowed on television reality shows? | `inferred` | original; REF §8.2/§5 — Showstopper on the translator as story, Idealist on better-made objections |
| 87 | `ig-in2020-087` | Should private companies build and run highways in return for tolls? | `inferred` | original; REF §8.2/§5 — Capitalist on the invoiced tanker, Supremo on rented sovereignty |
| 88 | `ig-in2020-088` | Should online retailers be barred from deep-discount festival sales? | `inferred` | original; REF §8.2/§5 — Capitalist on the night shift, Showstopper on the road noticing its own light |
| 89 | `ig-in2020-089` | Should public toilets in cities be free to use? | `inferred` | original; REF §8.2/§5 — Capitalist on an unmeasurable return, Idealist on fencing away the unpaid |
| 90 | `ig-in2020-090` | Should delivery drones be allowed to fly over Indian cities? | `inferred` | original; REF §8.2/§5 — Supremo on somebody answering for the dark, Showstopper on a lit room |
| 91 | `ig-in2020-091` | Should factory shifts be extended to twelve hours to boost output? | `inferred` | original; REF §8.2/§5 — Supremo on the rule the post holds, Idealist on the queue as real hours |
| 92 | `ig-in2020-092` | Should schools publicly rank every student in each class? | `inferred` | original; REF §8.2/§5 — Showstopper on forty children taught lateness, Idealist on the timetable |

#### `ig-in2020-099` … `ig-in2020-138` — 40 controversial cards added 2026-10-06

Original. Written on request as hot-button dilemmas (the published game's register is deliberately
provocative). Each side argues sincerely in its faction's voice; no card attacks a religion, caste or
community as such, and none names a living person or a party. Payouts follow the deck pattern: 2 of
the faction's own resource and 1 secondary, equal totals on both sides.

| # | card id | question | provenance |
|---|---|---|---|
| 99 | `ig-in2020-099` | Should beef be outlawed across the whole country? | `inferred` |
| 100 | `ig-in2020-100` | Should idle temple gold be melted down to fund the economy? | `inferred` |
| 101 | `ig-in2020-101` | Should police be praised for shooting suspected gangsters in encounters? | `inferred` |
| 102 | `ig-in2020-102` | Should billionaires pay a two percent tax on their wealth every year? | `inferred` |
| 103 | `ig-in2020-103` | Should sedition remain a crime under Indian law? | `inferred` |
| 104 | `ig-in2020-104` | Should cannabis be legalised and sold in licensed shops? | `inferred` |
| 105 | `ig-in2020-105` | Should sex work be fully legalised and taxed like any trade? | `inferred` |
| 106 | `ig-in2020-106` | Should every state impose total prohibition on alcohol? | `inferred` |
| 107 | `ig-in2020-107` | Should betting on cricket matches be made legal? | `inferred` |
| 108 | `ig-in2020-108` | Should paid commercial surrogacy be legal again? | `inferred` |
| 109 | `ig-in2020-109` | Should advertising for skin-whitening creams be prohibited? | `inferred` |
| 110 | `ig-in2020-110` | Should caste quotas be extended to private sector jobs? | `inferred` |
| 111 | `ig-in2020-111` | Should every rape conviction carry the death penalty? | `inferred` |
| 112 | `ig-in2020-112` | Should marital rape be made a criminal offence? | `inferred` |
| 113 | `ig-in2020-113` | Should terminally ill patients be allowed doctor-assisted death? | `inferred` |
| 114 | `ig-in2020-114` | Should one uniform civil code replace every religious personal law? | `inferred` |
| 115 | `ig-in2020-115` | Should same-sex couples be allowed to adopt children? | `inferred` |
| 116 | `ig-in2020-116` | Was scrapping Kashmir's special status under Article 370 the right call? | `inferred` |
| 117 | `ig-in2020-117` | Should refugees fleeing persecution get fast-track citizenship based on their religion? | `inferred` |
| 118 | `ig-in2020-118` | Should anyone changing religion need prior permission from the district magistrate? | `inferred` |
| 119 | `ig-in2020-119` | Can police question unmarried couples sitting together in public parks? | `inferred` |
| 120 | `ig-in2020-120` | Must couples living together without marriage register with the police? | `inferred` |
| 121 | `ig-in2020-121` | Should the ban on prenatal sex-determination tests be lifted? | `inferred` |
| 122 | `ig-in2020-122` | Should soldiers in disturbed areas stay immune from civilian prosecution? | `inferred` |
| 123 | `ig-in2020-123` | Should ordinary citizens be allowed to carry guns for self-defence? | `inferred` |
| 124 | `ig-in2020-124` | Should bull-taming sports like Jallikattu stay legal? | `inferred` |
| 125 | `ig-in2020-125` | Should state governments hand control of Hindu temples back to private trusts? | `inferred` |
| 126 | `ig-in2020-126` | Should foreign-funded charities be barred from Indian protest movements? | `inferred` |
| 127 | `ig-in2020-127` | Should 'hurting religious sentiments' remain a criminal offence? | `inferred` |
| 128 | `ig-in2020-128` | Should India abolish capital punishment altogether? | `inferred` |
| 129 | `ig-in2020-129` | Should repeat child sex offenders face chemical castration? | `inferred` |
| 130 | `ig-in2020-130` | Should wealthy families lose caste reservation benefits? | `inferred` |
| 131 | `ig-in2020-131` | Should a third of parliamentary seats be reserved for women? | `inferred` |
| 132 | `ig-in2020-132` | Should strategic industries like steel and telecom be nationalised? | `inferred` |
| 133 | `ig-in2020-133` | Should teenagers accused of rape be tried as adults? | `inferred` |
| 134 | `ig-in2020-134` | Should beauty pageants be outlawed as degrading to women? | `inferred` |
| 135 | `ig-in2020-135` | Should animal sacrifice at religious festivals be prohibited? | `inferred` |
| 136 | `ig-in2020-136` | Must every school student sing Vande Mataram at assembly? | `inferred` |
| 137 | `ig-in2020-137` | Should all online pornography be blocked in India? | `inferred` |
| 138 | `ig-in2020-138` | Should the census record every citizen's caste? | `inferred` |

### `et2040` / ideology — 62 cards

Entirely authored. REF §2.4 recovered **zero** ordinary question Ideology Cards from any
campaign, so the Earth 2040 deck has no recovered material of any kind.

| # | card id | question | provenance |
|---|---|---|---|
| 1 | `ig-et2040-001` | Should pandemic vaccine patents be waived so poorer nations can produce doses? | `inferred` |
| 2 | `ig-et2040-002` | Should citizens be paid when companies sell their personal data? | `inferred` |
| 3 | `ig-et2040-003` | Should food rations be issued through a national biometric ID card? | `inferred` |
| 4 | `ig-et2040-004` | Should nations grant climate refugees the same protection as war refugees? | `inferred` |
| 5 | `ig-et2040-005` | Should children under sixteen be banned from immersive virtual worlds? | `inferred` |
| 6 | `ig-et2040-006` | Should parents be allowed to edit their embryos' genes for intelligence? | `inferred` |
| 7 | `ig-et2040-007` | Should the last coal plants close by 2042 even if bills rise? | `inferred` |
| 8 | `ig-et2040-008` | Should inland cities pay taxes to build seawalls for coastal cities? | `inferred` |
| 9 | `ig-et2040-009` | Should the national space station be sold to a private company? | `inferred` |
| 10 | `ig-et2040-010` | Should robots pay income tax on the jobs they replace? | `inferred` |
| 11 | `ig-et2040-011` | Should drinking water be free up to a basic daily amount? | `inferred` |
| 12 | `ig-et2040-012` | Should we spray aerosols into the sky to cool the planet? | `inferred` |
| 13 | `ig-et2040-013` | Should every adult receive a universal basic income funded by AI profits? | `inferred` |
| 14 | `ig-et2040-014` | Should taxpayers fund a crewed mission to Mars? | `inferred` |
| 15 | `ig-et2040-015` | Should citizens be allowed to vote online from their phones? | `inferred` |
| 16 | `ig-et2040-016` | Should police use live facial recognition on every city street camera? | `inferred` |
| 17 | `ig-et2040-017` | Should governments be allowed to shut down the internet during riots? | `inferred` |
| 18 | `ig-et2040-018` | Should a climate emergency let governments suspend elections? | `inferred` |
| 19 | `ig-et2040-019` | Should a national space force be allowed to put weapons in orbit? | `inferred` |
| 20 | `ig-et2040-020` | Should climate science be a compulsory subject in every school? | `inferred` |

#### `ig-et2040-021` … `ig-et2040-042` — 22 cards authored 2026-10-04

Same construction and the same dropped-clause note as the India batch above: **the second
printed face (REF §5.3) and the ideologue nameplate**, and no condition or effect clause
because REF §5.1 prints none. All 22 are `inferred`; none is close to
`COMPOSITION_DOMINANT`; every side pays exactly 3 as 2+1. The register is deliberately
kept distinct from the India deck — the subject is planetary and the sentences are
flatter, with no administrative noun doing the work that a ward tanker or a ration shop
does in `in2020`.

| # | card id | question | provenance |
|---|---|---|---|
| 21 | `ig-et2040-021` | Should companies be allowed to mine the deep seabed for battery metals? | `inferred` |
| 22 | `ig-et2040-022` | Should private firms be allowed to own the asteroids they mine? | `inferred` |
| 23 | `ig-et2040-023` | Should imports be taxed on the carbon used to make them? | `inferred` |
| 24 | `ig-et2040-024` | Should self-driving trucks be allowed on every highway? | `inferred` |
| 25 | `ig-et2040-025` | Should outdoor work be banned when temperatures pass forty-five degrees? | `inferred` |
| 26 | `ig-et2040-026` | Should cattle farm subsidies be moved to lab-grown meat producers? | `inferred` |
| 27 | `ig-et2040-027` | Should AI-generated actors be allowed to replace human performers in films? | `inferred` |
| 28 | `ig-et2040-028` | Should the retirement age rise as longevity treatments extend lifespans? | `inferred` |
| 29 | `ig-et2040-029` | Should AI judges decide small claims cases to clear court backlogs? | `inferred` |
| 30 | `ig-et2040-030` | Should AI models trained with public money be released free to everyone? | `inferred` |
| 31 | `ig-et2040-031` | Should drought-proof gene-edited crops be patented by the companies that made them? | `inferred` |
| 32 | `ig-et2040-032` | Should life-extending treatments be covered by public health insurance? | `inferred` |
| 33 | `ig-et2040-033` | Should pandemic contact tracing apps be mandatory for everyone? | `inferred` |
| 34 | `ig-et2040-034` | Should the military control the national AI research labs? | `inferred` |
| 35 | `ig-et2040-035` | Should scientists bring extinct species like the mammoth back to life? | `inferred` |
| 36 | `ig-et2040-036` | Should all national data be stored on servers inside our borders? | `inferred` |
| 37 | `ig-et2040-037` | Should couples need a permit to have more than two children? | `inferred` |
| 38 | `ig-et2040-038` | Should coastal towns be forcibly relocated before the sea reaches them? | `inferred` |
| 39 | `ig-et2040-039` | Should the army guard rivers and reservoirs during severe droughts? | `inferred` |
| 40 | `ig-et2040-040` | Should AI-generated news stories be clearly labelled as machine-written? | `inferred` |
| 41 | `ig-et2040-041` | Should social media feeds be ranked by algorithms that maximise engagement? | `inferred` |
| 42 | `ig-et2040-042` | Should celebrities be paid with public money to promote climate-friendly lifestyles? | `inferred` |

#### `ig-et2040-043` … `ig-et2040-062` — 20 controversial cards added 2026-10-06

Original. Written on request as hot-button dilemmas (the published game's register is deliberately
provocative). Each side argues sincerely in its faction's voice; no card attacks a religion, caste or
community as such, and none names a living person or a party. Payouts follow the deck pattern: 2 of
the faction's own resource and 1 secondary, equal totals on both sides.

| # | card id | question | provenance |
|---|---|---|---|
| 43 | `ig-et2040-043` | Should corporations be allowed to buy and govern entire cities? | `inferred` |
| 44 | `ig-et2040-044` | Should citizens be free to sell their votes for cash? | `inferred` |
| 45 | `ig-et2040-045` | Should lifelike sex robots be legal to sell to adults? | `inferred` |
| 46 | `ig-et2040-046` | Should families be able to resurrect dead relatives as AI chatbots? | `inferred` |
| 47 | `ig-et2040-047` | Should people be legally allowed to sell their own kidneys? | `inferred` |
| 48 | `ig-et2040-048` | Should insurers be allowed to set premiums using your genome? | `inferred` |
| 49 | `ig-et2040-049` | Should police arrest people whom an AI predicts will commit crimes? | `inferred` |
| 50 | `ig-et2040-050` | Should governments pay citizens to be sterilised to curb overpopulation? | `inferred` |
| 51 | `ig-et2040-051` | Should there be a legal maximum wage for any job? | `inferred` |
| 52 | `ig-et2040-052` | Should armed autonomous drones patrol city streets to stop crime? | `inferred` |
| 53 | `ig-et2040-053` | Should every citizen carry a public social credit score? | `inferred` |
| 54 | `ig-et2040-054` | Should people have to pass a civics test before voting? | `inferred` |
| 55 | `ig-et2040-055` | Should soldiers be fitted with brain implants that switch off fear? | `inferred` |
| 56 | `ig-et2040-056` | Should uploaded minds of dead founders keep running their companies? | `inferred` |
| 57 | `ig-et2040-057` | Should disaster evacuation seats go to the most useful citizens first? | `inferred` |
| 58 | `ig-et2040-058` | Should pensioners be paid to choose assisted death early? | `inferred` |
| 59 | `ig-et2040-059` | Should the state own all land and only lease it to citizens? | `inferred` |
| 60 | `ig-et2040-060` | Should unvaccinated people be barred from offices and public transport? | `inferred` |
| 61 | `ig-et2040-061` | Should every flight after your first each year be heavily taxed? | `inferred` |
| 62 | `ig-et2040-062` | Should advanced AI systems be granted the legal rights of persons? | `inferred` |

### `et2040` / conspiracy — 21 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `ct-et2040-001` | Hostile Takeover | `adapted` | S3 / REF §4.2.1. Drops the per-opponent iteration and the conditional *"evict 2 voters belonging to every player who fails to pay"* (G2) |
| 2 | `ct-et2040-002` | Market Correction | `adapted` | S3 / REF §4.2.1. Drops the mandatory *recurring* obligation and the *"any 1 resource denoted on it"* denomination (G3, G17) |
| 3 | `ct-et2040-003` | Deepfake Rally | `adapted` | S3 / REF §4.2.1. First branch only; drops the 3-of-4 set → permanent L5 unlock (G6) |
| 4 | `ct-et2040-004` | Predictive Polling | `adapted` | S3 / REF §4.2.1. First branch only; drops the hidden three-action combo (G7/G19) |
| 5 | `ct-et2040-005` | Tax Haven | `inferred` | original; REF §8.1 |
| 6 | `ct-et2040-006` | Data Harvest | `inferred` | original; REF §8.2 |
| 7 | `ct-et2040-007` | Rising Tides | `inferred` | original; REF §8.2 |
| 8 | `ct-et2040-008` | Clearance Sale | `inferred` | original; REF §8.2 |
| 9 | `ct-et2040-011` | Crypto Swap | `inferred` | original; REF §8.2 |
| 10 | `ct-et2040-013` | Blind Box | `adapted` | REF §4.2.1 verbatim, on its first sentence alone. G20 `move-card`. Same archetype as `ct-in2020-011`; see KNOWN-GAPS.md G20 |
| 11 | `ct-et2040-014` | Block | `adapted` | REF §4.2.1 verbatim, clause by clause against the reducer. **Ships the whole reactive half** — G13's phase machine executes it and §1 tabulates all eight clauses. Drops three: discard an open card, block a card stealing itself, cleanse an already-active card. **The `Otherwise: gain 1 Clout` clause is AUTHORED, and its `text` was CORRECTED 2026-10-04** — it used to sit inside the reactive sentence, promising a payout on the one path that cannot pay it. See §4.8: `closeInterrupt` applies the STAGED card's `effects` and never the responder's own, so a BLOCK paid nothing on the path the card describes. `text` now says the reactive half pays nothing and names the only path that resolves the effect list. The effect list stays because the schema requires one (`minItems: 1`) |
| 12 | `ct-et2040-015` | Deflect | `adapted` | REF §4.2.1 verbatim, clause by clause. Ships the reactive half with two named deviations: the **whole** effect list is redirected, not one partial effect (G20), and `target` is `any-card` rather than `card-affecting-you` (G1). The `Otherwise: gain 1 Trust` clause is **authored**, and its `text` was **corrected 2026-10-04** on the same finding as `ct-et2040-014` — see §4.8 |
| 13 | `ct-et2040-016` | Hard Delete | `adapted` | REF §4.2.1, first turn only. G16 landed for the selector. Named drops: the second turn (G22), **"1 of your MAJORITIES"** — the one clause this card is *wider* on — and *"all"* as a count |
| 14 | `ct-et2040-017` | Compound Interest | `adapted` | REF §4.2.1. **No clause dropped.** G4 + G15: a `res` of 1 in each resource times `held-of-each-resource` *is* the doubling, and the cap is the card's own second sentence. Still `adapted` because a Conspiracy Card also needs a `cost` the recovered text does not print. `npm run balance` reports it **NOT MEASURED**, by design — see `test/balance.test.ts` |
| 15 | `ct-et2040-018` | Dumpster Dive | `adapted` | REF §4.2.1. Ships the top of the discard pile, and U1 ships *"pick any card, in any order"* on top of that: `pick: true` raises one `'choose-card'` per card over the recycle list, and raising it m times for m cards is what makes *"in any order"* expressible. **Stays `adapted`**, because the clause is paraphrased into schema ops — every clause now *executing* is a different property from the text being *reproduced*, and a Conspiracy Card also needs a `cost` the recovered text does not print (the same reason `ct-et2040-017` above stays `adapted`). The set that choice enumerates is public by DERIVATION in MEMBERSHIP only: every card on `_conspiracyDiscard` was already logged publicly as `Played "<NAME>"`, since `PLAY_CONSPIRACY` and `RESPOND_INTERRUPT` both `discardTo` then log, and `to: 'discard'` only re-appends a card taken back OFF the pile. Its ORDER is **not** derivable — a card leaves silently on both `draw-conspiracy` take paths, which remove by index rather than from an end and so reorder what remains, and `draw()`'s reshuffle empties it wholesale |
| 16 | `ct-et2040-019` | Power Trip | `adapted` | REF §4.2.1. The trigger is performed (G14). **Wider than printed**: drops *"non-majority"*, so a majority can be struck; and the printed *"you can"* becomes mandatory. **Replaced** `inferred` DRY DOCK, whose own source said PYTHONPOST was unrepresentable |
| 17 | `ct-et2040-020` | Feed the Ticker | `inferred` | original; REF §8.2 rule 5. **Substitute for QUANTUM WRISTBAND** (REF §4.2.1), ruled out in KNOWN-GAPS.md §8.3 — the auction, and headlines being a QUEUE rather than a pile, so there is no `_headlineDraw` to search |
| 18 | `ct-et2040-021` | Disaster Tourism | `adapted` | REF §4.3. G4's read-vs-target split landed and the card is **WHOLE**: *"any 2 resources"* is `gain-any`, *"for each"* is `per`, and *"Pick a player"* is `read`. **No clause dropped** — and still `adapted`, because a Conspiracy Card also needs a `cost` the recovered text does not print (the same reason `ct-et2040-017` stays `adapted`). Built this iteration; see KNOWN-GAPS.md §8.1 |
| 19 | `ct-et2040-022` | Borrowed Brilliance | `adapted` | REF §4.2.1, verbatim on its first sentence. G14a `borrow-power` with `target: 'chosen-player'`; the decision is the EXISTING `'choose-player'`, so the donor is named and no new `Choice` kind is raised. **DROPPED, one:** *"You cannot use the same Ideologue Power twice"* — a per-power use COUNTER, and a borrowed `Restriction` carries none. `until` is absent on purpose (the op defaults to `this-turn`). NARROWED, and named: Level 5 is never borrowed. **FILED WITH NO ENGINE CHANGE** — see the note under §3's 2040 headline table |
| 20 | `ct-et2040-023` | Subscription Model | `adapted` | REF §4.2.1, verbatim on its first sentence. G14 fires the hook. **WIDER THAN PRINTED and stated on the card's face:** the fixed-victim binding is G1, so the hook fires on ANY influence and YOU name the victim — this is the reduction `KNOWN-GAPS.md` §0b.2 held back for a ruling, and it now ships WITH the deviation named rather than being withheld. **DROPPED, three:** the fixed victim (that same G1 binding); *"their SPENT resources"*, a per-turn spend LEDGER on `PlayerState`; and the self-discard, a copy COUNTER (G10). **FILED WITH NO ENGINE CHANGE** |
| 21 | `ct-et2040-024` | Shrinkflation | `adapted` | REF §4.2.1. G14b `restrict` kind `voter-shortfall`: `value: 1` is voters lost per card and `owed: 2` is the number of CARDS. INFLUENCE subtracts it after Going Viral and **floors at zero** — the purchase still succeeds, because an illegal influence would freeze the table on a card that cannot be unbought. **DROPPED, two:** *"up to 2 opponents"* and *"2 separate voter cards for 2 different players"*, which are N TARGETS, and `applyEffect` computes ONE target per effect list. **FILED WITH NO ENGINE CHANGE** |

### `et2040` / headline — 30 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `hl-et2040-001` | Change Of Address | `adapted` | S4 / REF §4.3. Drops the Volatile-Area prohibition (G5) and the lifetime of the grant (G9/G22). **G8 landed, so `target: 'everyone'` IS honoured by `reduce()` — and the card still ships in the `you` reading**, because the bonus lands in `PlayerState.powerUses.gerrymandered`, which `advanceTurn` resets for the incoming player, so an every-player grant is wiped before the next player acts. `packages/cards/test/card-playback.test.ts` asserts both halves. Same archetype as SUBMERGED, which now **also** ships in its own right as `hl-et2040-029` |
| 2 | `hl-et2040-002` | Blood Money | `adapted` | S4 / REF §4.3. Drops the per-voter scaling (G4) and the self-discard (G-new) |
| 3 | `hl-et2040-003` | Own Goal | `adapted` | S4 / REF §4.3. The self-discard branch is now the PRINTED clause (`target: 'you'`; G-new is closed). Drops only the OR-branch donate (G1) |
| 4 | `hl-et2040-004` | Austerity Drive | `inferred` | original; REF §8.2 |
| 5 | `hl-et2040-005` | Stimulus Package | `inferred` | original; REF §8.2 |
| 6 | `hl-et2040-006` | Evacuation Order | `inferred` | original; REF §8.2 |
| 7 | `hl-et2040-007` | News Cycle | `inferred` | original; REF §8.2 |
| 8 | `hl-et2040-008` | Doomscrolling | `inferred` | original; REF §8.2 |
| 9 | `hl-et2040-009` | Cost of Living | `adapted` | S4 / REF §4.3. The denomination choice is expressed exactly; drops the purchase lock (G5) |
| 10 | `hl-et2040-010` | Free Publicity | `adapted` | S4 / REF §4.3. Drops the 2-opponent target set and the opt-out (G1) |
| 11 | `hl-et2040-011` | Leaked Memo | `adapted` | S4 / REF §4.3. Keep-one branch only; drops the two gifts and the discard fallback (G17, G20) |
| 12 | `hl-et2040-013` | Universal Basic Intrigue | `adapted` | S4 / REF §4.3. Ships the top-up clause (`onlyIfEmpty`) and `target: everyone`. Drops both REVEAL clauses: a reveal has no state consequence in this engine. **Replaced** the `inferred` THREE DAY WEEKEND reskin |
| 13 | `hl-et2040-015` | Relocation Fatigue | `adapted` | S4 / REF §4.3. Ships the trigger (`when: on-gerrymander` + `movedMyVoter` + `until: next-turn`). Drops the counter (G10) and the multi-turn block (G13). **Replaced** the `inferred` SILICON RAIN |
| 14 | `hl-et2040-016` | Overcrowding | `adapted` | S4 / REF §4.3. G16 landed: `zone: your-strongest` is performed. Drops *"into an adjacent zone"*, the tie-break as a decision, and *"move"* as EVICT (strictly weaker) |
| 15 | `hl-et2040-017` | Fire Drill | `adapted` | REF §4.1. G16 landed: `zone: this-zone` reads `headlineQueue[0].areaId`. Drops *"move"* as EVICT (strictly weaker), the adjacent-zone destination, and the pairing of the two clauses |
| 16 | `hl-et2040-018` | Pity Vote | `adapted` | REF §4.3. G1 landed for the named opponent. Drops *"for free"* (G15 `price`), *"the voters"* as 1 (no number was recovered), and *"right away"* — **`text` was amended 2026-10-04 to disclose that last one in the player-facing sentence**, because it read as the OPPOSITE of the recovered timing ("They must place these voters right away") |
| 17 | `hl-et2040-019` | Bandwagon | `adapted` | REF §4.3. **Whole bar one clause, and that clause makes it stronger**: `condition: { byOwner: true }` is left off, so the hook fires on any influence |
| 18 | `hl-et2040-020` | Blue Screen | `adapted` | REF §4.3. G5's `no-power` restriction is executed. **Weaker than printed**: takes ALL Level 3 powers rather than one chosen (G1, a decision over POWERS), and drops the *"discard 2 resources instead"* conditional. **Replaced** `inferred` THE POLICY REVIEW (`hl-et2040-014`) |
| 19 | `hl-et2040-021` | Convenience Fee | `adapted` | REF §4.3. G5's `surcharge` is executed. **Wider than printed**: `surchargeFor` is one function read by INFLUENCE and BUY_CONSPIRACY, so the tax reaches Conspiracy Cards too. **Replaced** `inferred` TIDE WARNINGS (`hl-et2040-012`) |
| 20 | `hl-et2040-022` | Trickle Down | `adapted` | REF §4.2.1. **Built this iteration** on G14's trigger plus `'player-after'`; the new work is `move-peg` + `choose-peg-dest`, because every voter op resolves to a pool or a mat and none has a DESTINATION, and `evict` is the wrong verb for a card that *helps* the beneficiary. DROPPED, named: a Volatile-Area peg is immovable (p18); *"MAY"* is not a decline flag. KNOWN-GAPS.md §8.1 |
| 21 | `hl-et2040-023` | Bank Holiday | `adapted` | REF §4.3. **PART-BUILD with NO engine change**: the shipping clause is `no-income` read literally, and `ANSWER` already consults `incomeBlocked` for it. DROPPED, named: *"every player answers immediately, in order of turn"* would be a SECOND WRITER for `_pendingCard`, which the turn boundary owns — a rules question, not a cost (KNOWN-GAPS.md §8.2); and the lifetime is `round`, not the answering turn. KNOWN-GAPS.md §8.1 |
| 22 | `hl-et2040-024` | Tariff War | `inferred` | original; REF §8.2 rule 5. **Substitute for HIGGS MORON** (REF §4.3), ruled out in KNOWN-GAPS.md §8.3 — a counter that outlives its resolution is G10, and `pass-card` has no referent (G12's queue, G20's `move-card`) |
| 23 | `hl-et2040-025` | Dead Weight | `inferred` | original; REF §8.2 rule 5. **Substitute for ON THE "HIGH" SEAS** (REF §4.1), ruled out in KNOWN-GAPS.md §8.3 — a hostage is a board-resident object holding pegs and ransomable repeatedly, and `PendingVoters` is the wrong container because it is discarded at the end of that player's turn |
| 24 | `hl-et2040-027` | Exit Poll Leak | `adapted` | REF §4.1, **first sentence alone — one clause of four, and the clause is the setup, not the payoff.** `reveal {kind:'voter', n:2}` publishes both cards face up on `GameState.revealedCards`. DROPPED, each with its mechanism: *"Keep 1"* needs a Voter Card hand plus a `choose-card` over it (`to:'hand'` writes the IDEOLOGY hand, where `ANSWER` fails permanently); *"donate the other"* needs `move-card` onto a named hand (G20); *"influenced for free immediately"* needs a free `INFLUENCE` (G15); and REF §4.1's own ordering gloss is KNOWN-GAPS.md §8.2(b). **THE `text` DISCLOSES WHAT THE CARD DOES NOT DO** — it keeps none, donates none and influences none — because `text` must describe exactly what `effects` does |
| 25 | `hl-et2040-026` | Paywall | `inferred` | original; REF §8.2 rule 5. **Substitute for FUELLING THE NEWS** (REF §4.3), ruled out in KNOWN-GAPS.md §8.3 — headlines are dealt from a QUEUE, so "draw 3" has no referent and choosing their resolution order needs a queue too |
| 26 | `hl-et2040-028` | Think Tank | `adapted` | REF §4.1 (Campaign: USA 2020) — no USA deck exists, so it is filed beside its campaign-less §4.1 siblings. G14a's `borrow-power` with `until: 'next-turn'`, i.e. DEEP THOUGHTS' borrow across a turn boundary. **NOT A G20 CARD:** nothing here moves a card. **DROPPED, four, and the first moves WHO benefits:** *"each other's"* (one decision names one DONOR, so this is *"you may use a named opponent's powers"*, not a mutual exchange); *"Pick 2 players"* (one target per effect list); the *"any one Level 3 Power of their choice"* fallback, which need not be UNLOCKED; and *"You may pick yourself"*, which `resolveChoice` refuses. **FILED WITH NO ENGINE CHANGE** |
| 27 | `hl-et2040-029` | Musical Chairs | `adapted` | REF §4.1 (Earth 2040), which REF §4.3 records as the **same card** as NEW FACE WHO DIS (`hl-et2040-001`) — one archetype under two recovered names, deliberately filed rather than tidied away, because REF's own text says to dedupe by effect and a table can legitimately draw the same mechanic twice. G8 closed, so `target: 'everyone'` **is** honoured. **DROPPED, two:** the Volatile-Area placement ban (a `Restriction` the `Effect` union cannot state, G5) and the grant's lifetime (G9/G22 — it lands in `powerUses.gerrymandered`, which `advanceTurn` resets). **This is why `hl-et2040-001` ships the `you` reading; this card's `text` says so.** **FILED WITH NO ENGINE CHANGE** |
| 28 | `hl-et2040-030` | Pay It Forward | `adapted` | REF §4.1 (Rome), filed beside its campaign sibling `hl-et2040-017` NERO'S GUESTS (also Rome). `target: 'player-after'` is ONE index into public `turnOrder` from the actor, wrapping — which in a clockwise turn order **is** *"the opponent on their left"* — so it raises NO decision, needs no new `Choice` kind and costs the client nothing. ONE `target` for the whole list happens to be exactly right, because the card goes to that seat and the 6 resources go to whoever receives it. **DROPPED, four, each named:** *"starting from you, EACH player"* is N donations and this is one; *"optional"*; *"pass along a card you just received"* (G20/G12); and the card comes off the Ideology **DRAW** pile rather than a HAND, because `from: 'hand'` is refused at the type level. **FILED WITH NO ENGINE CHANGE** |
| 29 | `hl-et2040-031` | Left-Wing Handout | `adapted` | REF §4.3, which REF §4.3 itself records as a **re-skin of `hl-et2040-030`** — the same archetype under its own recovered name, not a second mechanism, and deliberately filed for the same reason. The reduction is **field-for-field** that card's two clauses and every clause dropped or performed is identical, **with one addition:** *"Can be blocked only at the beginning."* That is a rule about **WHEN** the response window opens rather than what happens, and the existing window (`GameState.interrupt`, G13) is open for the whole resolution — so the narrowed timing is **dropped and named rather than approximated**. **FILED WITH NO ENGINE CHANGE** |
| 30 | `hl-et2040-033` | Spending Freeze | `adapted` | REF §4.3, verbatim on *"Reduce your resource cap to 10"*, performed whole by `set-cap` reading `PlayerState.capOverride` — a `PlayerState` **FIELD** rather than a `restrict` kind, because a cap is a NUMBER every pool comparison reads and not a gate an action is refused at. **NO DEADLOCK, which is why the earlier refusal was wrong:** `enforceCap` raises `overCap = max(0, total − cap)`, so excess ≤ total always and the target state is REACHABLE rather than merely approached (proof: `packages/engine/test/cap-override.test.ts` at 2/3/4/5 seats). `convert-voter`'s defect was a decision with no acceptable answer; this is one whose answer is always affordable. **DROPPED, two:** the *"[OR] Pick an opponent EVERY TURN and donate any 1 resource to them"* branch, a recurring donation to a chosen opponent (G5 + G9) and therefore a **different card**, not a smaller one; and the reduced cap being **visible as a number on the mat**, which the engine enforces but the client does not yet render. **FILED WITH NO ENGINE CHANGE** |

> Four placeholders were retired to make room, and every one of them had already
> named the recovered card it was standing in for: THREE DAY WEEKEND → AS CLEAR AS
> WATER, SILICON RAIN → MOVEMENT ANXIETY DISORDER (both earlier passes), THE POLICY
> REVIEW → GENDER TROUBLE, TIDE WARNINGS → DON'T KISS THE BABIES (this pass). Each
> retirement kept the deck's SIZE unchanged, so nothing the server measures moves.
>
> **A later pass grew this deck from 19 to 25 rather than retiring into it**, and that is
> the first time the corpus added X-card material without displacing an `inferred`
> placeholder. Four recovered cards were **built** — `hl-et2040-022`, `-023`, `-027` here
> and `ct-et2040-021` in the Conspiracy deck — and six **original substitutes** were filed
> for recovered names ruled out in KNOWN-GAPS.md §8.3: `hl-et2040-024`, `-025`, `-026`,
> `ct-et2040-020`, and `hl-in2020-030`/`-031`/`-032` in the India deck.
>
> **THE MOST RECENT PASS GREW IT FROM 25 TO 30, AND IT COST NO ENGINE CHANGE AT ALL.**
> Rows 26–30 above — POLO RETREAT, SUBMERGED, A COWARD OR A JOURNALIST?, CARD GAMES and THE
> BIG FREEZE — were recovered cards the probe could already *play* and that sat in **no deck
> file**. Every mechanism each one wanted had landed in an earlier iteration: G14a
> `borrow-power`, G8's `target: 'everyone'`, G20's `move-card`, G12's `'player-after'` seat
> arithmetic, and G5a's `set-cap`. **This is the cheapest kind of progress the ledger can
> record** and it is worth saying so plainly, because the pattern it belongs to is the one
> worth repeating: when a capability lands, the corpus work it unblocks is *filing*, not
> more engine work. Five of the nine cards filed in this pass went to the Conspiracy deck
> (`ct-et2040-022`, `-023`, `-024`) and the India headline deck (`hl-in2020-033`), and
> **three of the nine deliberately re-file an archetype already shipped** — rows 27, 29 and
> `hl-in2020-033` above. That is a decision, not drift: REF says in so many words to dedupe
> by effect, each card's `source` says outright that a table can draw the same mechanic
> twice, and if it is ever judged a balance problem the fix is to retire one NAME.

### `in2020` / conspiracy — 13 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `ct-in2020-001` | Jugaad | `inferred` | original; REF §8.2 rule 5. A Grave Inheritance archetype |
| 2 | `ct-in2020-002` | Aashirwad | `inferred` | original; REF §8.2 rule 5 |
| 3 | `ct-in2020-003` | Hawala | `inferred` | original; REF §8.2 rule 5 |
| 4 | `ct-in2020-004` | Hafta Vasooli | `inferred` | original; REF §8.2 rule 5 |
| 5 | `ct-in2020-005` | Parivartan | `inferred` | original; REF §8.2 rule 5 |
| 6 | `ct-in2020-006` | Vote Bank | `inferred` | original; REF §8.2 rule 5. Singularity archetype |
| 7 | `ct-in2020-007` | Tabadla | `inferred` | original; REF §8.2 rule 5 |
| 8 | `ct-in2020-008` | Lifafa | `inferred` | original; REF §8.2 rule 5. Does **not** restate COUGH IT UP — that ships recovered as `hl-in2020-013` |
| 9 | `ct-in2020-009` | Cut Money | `inferred` | original; REF §8.2 rule 5 |
| 10 | `ct-in2020-010` | Note Ke Badle Vote | `inferred` | original; REF §8.2 rule 5 |
| 11 | `ct-in2020-011` | Chhupa Rustam | `adapted` | REF §4.2.2 verbatim, on its first sentence alone. G20 `move-card`. The India skin of the Holo Sapiens archetype; see KNOWN-GAPS.md G20 |
| 12 | `ct-in2020-012` | Nazarbandi | `inferred` | original; REF §8.2 rule 5. **Substitute for CULT-IVATING OBEDIENCE** (REF §4.2.2), ruled out in KNOWN-GAPS.md §8.3 — and its gap label was wrong twice over: the card itself is the object captured, so it is G11 and not G20, because no `move-card` reaches it. A capture also needs the protected majority to SURVIVE it, so it is a persisted per-zone protection plus a transfer, and the engine has no per-zone flag. The *"somebody may buy it"* half is DROPPED and named |
| 13 | `ct-in2020-013` | Hukka Paani Band | `inferred` | original; REF §8.2 rule 5. **Substitute for CHAI-PAANI**, which KNOWN-GAPS.md §7 rules is **not a gap at all** — only a re-application clause was recovered (*"A second Chai-Paani card can be applied on the same player. The first one will get deactivated"*) and the base effect was never recovered, so inventing one is forbidden. Same JOB — one protection at a time, the newest replacing the oldest — expressed as a rule with a deadline rather than as persistent state |

> Naming note: `ct-in2020-001` ("Jumlai Dafaar") and `ct-in2020-010` ("Pet Ka Register") are
> **not** the recovered cards JUMLA and CHAI-PAANI. Those names are Memesys' and are
> reserved for the real cards; see §4 rows 17–18.

### `in2020` / headline — 15 cards

| # | card id | name | provenance | source |
|---|---|---|---|---|
| 1 | `hl-in2020-001` | Chanda | `inferred` | original; REF §8.2 rule 5 |
| 2 | `hl-in2020-002` | Jan Sampark | `inferred` | original; REF §8.2 rule 5 |
| 3 | `hl-in2020-003` | Naam Kat Gaya | `inferred` | original; REF §8.2 rule 5 |
| 4 | `hl-in2020-005` | Muft Ki Revdi | `inferred` | original; REF §8.2 rule 5 |
| 5 | `hl-in2020-006` | Haath Ki Safai | `inferred` | original; REF §8.2 rule 5 |
| 6 | `hl-in2020-007` | Notebandi | `adapted` | S2 / REF §4.1. The donation is expressed exactly; drops *"you cannot make any purchases until you do so"* (G5, G10). **The drop is now PROVEN rather than deferred — see G5a.** The engine discharges a `no-purchases` lock with `owedRes` at most 1 per type in ONE donation (a type is either carried or waived), and the card's own donation is a donation (`p === source`), so `restrict` + `lose` in a single effect list cancel: the lock never outlives the resolution that writes it. The real card's lock lasts until a LATER donation because its four tokens sit ON the card until they are handed over — a token pile, i.e. G10. So `lose` alone is not a narrowing of this card under today's vocabulary; it is the whole of it. |
| 7 | `hl-in2020-008` | Rangdaari | `inferred` | original; REF §8.2 rule 5 |
| 8 | `hl-in2020-012` | Aaya Ram Gaya Ram | `adapted` | REF §4.1. **G-new, not G18** — `convert-voter` with no target reaches the caster. Drops *"every player"* and *"to their left"* (the second is **wider**), plus the majority-conditional 2 resources (G2). **Replaced** `inferred` GHADI KA AAKHRI GHANTA |
| 9 | `hl-in2020-013` | Gherao | `adapted` | REF §4.1. The eviction is performed exactly and `evict` is the printed verb. Drops the majority-conditional payout (G2). **Replaced** `inferred` CHHOTI SI KASAM |
| 10 | `hl-in2020-014` | Sahanubhuti Lehar | `adapted` | REF §4.1. The G9 + G14 card with nothing approximated. Drops *"gained voters are placed immediately"*. **Replaced** `inferred` PANI KI KAMMI |
| 11 | `hl-in2020-015` | Lagaan | `adapted` | REF §4.1, and REF §4.3 records SNOOP B-O-DOUBLE-T as the **same card**, so the archetype now covers both names: this one and `hl-in2020-033`. **Wider than printed**: taxes every purchase, not only Conspiracy Cards. **Replaced** `inferred` SARKAR KI CHARCHA |
| 12 | `hl-in2020-030` | Mili Bhagat | `inferred` | original; REF §8.2 rule 5. **Substitute for A CALL FROM KARACHI** (REF §4.1), ruled out in KNOWN-GAPS.md §8.3 — the auction needs `PlayerState.debts`, a cap ruling on bidding resources you do not hold, negative-resource support in the pool reads, four new Actions and a second window protocol |
| 13 | `hl-in2020-031` | Kursi Ka Khel | `inferred` | original; REF §8.2 rule 5. **Substitute for NEXT BILLION DATA POINTS** (REF §4.1), ruled out in KNOWN-GAPS.md §8.3 — a ballot needs a no-self-vote rule and a re-vote-on-tie loop, which is the unbounded-cascade class §4 refuses (*"two opponents who always tie is a table that never finishes"*) |
| 14 | `hl-in2020-032` | Mehman Nawazi | `inferred` | original; REF §8.2 rule 5. **Substitute for DOSTI BANI RAHE** (REF §4.1), ruled out in KNOWN-GAPS.md §8.3 — its grant must land on SOMEBODY ELSE'S turn, and both `installLiveEffects` and `fireTriggers` require `fire.actor === le.owner` for `on-turn-start`, so there is no event to hook |
| 15 | `hl-in2020-033` | Chungi | `adapted` | REF §4.3, which REF §4.3 itself records as the **same card** as PYTHONPOST (`hl-in2020-015`) — the same tax under its own recovered name, deliberately filed rather than tidied away, because REF's text says to dedupe by effect and a table can legitimately draw the same mechanic twice. **WIDER THAN PRINTED:** the tax falls on EVERY purchase, Conspiracy Cards and Voter Cards alike, because `surchargeFor` is one function read by both `INFLUENCE` and `BUY_CONSPIRACY`. **`text` discloses both the widening and the stacking with Pythonpost**, because a card whose prose promises something the effect list cannot deliver is a bug that only shows up in someone's game. **DROPPED, none** — and it still ships `adapted`, because dropping no clause is not reproducing text (§1). **FILED WITH NO ENGINE CHANGE.** Filed between `-031` and `-032` in the file, which is why this row is numbered last |

> Naming note: `hl-in2020-002` ("Chai-Paani, Dobara") is **not** the recovered card
> CHAI-PAANI, whose base effect was never recovered. See §4 row 17.

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

Nothing recovered is dropped silently. **54 distinct recovered card rows** are
accounted for below, of which **3 pairs are the same archetype under two campaign
names** (SUBMERGED ≡ NEW FACE WHO DIS, SNOOP B-O-DOUBLE-T ≡ PYTHONPOST, CARD GAMES ≡
A COWARD OR A JOURNALIST?) and BLOCK is listed once although REF names it twice. So
the corpus is **51 distinct recovered cards with a recovered effect**, plus 2 names with
no recovered effect (CRUSHED UNDER BELLY, IFTAR PARTY). Of the 54 probed rows, which is the
figure `npm run playable` counts: **44 ship `adapted` and all 44 are now in a deck file**,
and the remaining **10 rows are not representable at all**, each with the reason.
44 + 10 = 54.

**The `expressible but unfiled` class is now EMPTY, and that is the whole point of the
most recent pass.** It stood at **9** until DEEP THOUGHTS, LAB-GROWN EARWORM, THE GRETA
EFFECT, POLO RETREAT, A COWARD OR A JOURNALIST?, CARD GAMES, SUBMERGED, SNOOP
B-O-DOUBLE-T and THE BIG FREEZE were filed under their recovered names. Every row below
that used to read *"now expressible and PLAYED — not yet in the corpus"* now names the
shipped id instead, and none of the nine needed an engine change. **LAB-GROWN EARWORM is
the one whose filing changes a recorded position rather than only a location:** it was held
back on a ruling precisely *because* its reduction is strictly stronger than the printed
card, and it now ships with that deviation named on the card's own face and in its `source`
rather than being withheld — see §4.1.

**THE FIGURES ABOVE ARE CORRECTED FROM THE PREVIOUS REVISION OF THIS FILE**, which
said 56 rows and 52 distinct. The count of 52 came from subtracting 4 "duplicates"
from 56, and 56 was itself a total that does not reconcile with the tables below: they
list 16 + 3 + 15 + 20 = **54** rows, and the duplicate pairs among those 54 are **3**,
not 4 — BLOCK is the fourth only because REF prints it in two places and §4.3's
name-only block is counted separately as CRUSHED UNDER BELLY / IFTAR PARTY. The
reconciled figures are the ones above, and `npm run playable` counts **54 probed
rows** for the same reason: the probe keeps the campaign reskins separate because
`recoveries` are cheaper to keep visible than to deduplicate by hand.

Counting note: REF §4's own headings disagree with its tables (16 rows under a
"15 cards" heading; 20 rows under an "18 cards" heading). The tables are what is
listed; see §6.

### 4.1 Earth 2040 Conspiracy Cards — S3, REF §4.2.1

| card | disposition | blocking gap |
|---|---|---|
| Hostile Takeover | **ships** `adapted` as `ct-et2040-001` | G2 |
| Block | **ships** `adapted` as `ct-et2040-014` | the reactive half only. G13 landed. Still dropped: the *"[OR] Discard an open Conspiracy Card or Headline Card"* branch (no op discards an open card), *"block a card stealing this card"* (G20 moves Ideology Cards only) and *"cleanse an already-active card"* (no op removes a `LiveEffect`, G9/G22). §1 tabulates all eight recovered clauses |
| Hard Delete | **ships** `adapted` as `ct-et2040-016` | G16 landed. Ships the FIRST TURN only: *"select 1 of your majorities. Discard all your voters in that zone"* becomes *"select one constituency, discard 2 of your voters from it"*. The `choose-zone` decision is raised **only** when a constituency holds a voter the effect could name, so nobody is frozen by one. Still dropped, each named: the second turn entirely (*"if any empty area is left at the start of your next turn"* is a standing effect conditioned on board state — G22); **"1 of your MAJORITIES"**, which is the one clause this card is *wider* on; and *"all"* as a count. KNOWN-GAPS G16 |
| Borrowed Brilliance | **ships** `adapted` as `ct-et2040-022` — filed 2026-10-04, **with no engine change** | G14a `borrow-power` with `target: 'chosen-player'` performs the printed clause: REF 4.2.1 reads *"Select an opponent and use all their Level 3 Ideologue Powers this turn"*. The decision is the **existing** `'choose-player'` raised for the card's own actor, so the opponent is NAMED rather than guessed, and it raises no new `Choice` kind and costs the client nothing; the rule is written on the CASTER naming the DONOR, and `powers.ts` `usesLeft` — the single function every `POWER_*` case in `reduce()` already asks — counts the donor's Level 3 manifesto. **Not a G20 card**, and the row-9 table was wrong to imply it: `move-card` moves cards, not powers. **DROPPED, one clause:** *"You cannot use the same Ideologue Power twice"*, which needs a per-power use counter and there is no counter on a borrowed power. **Level 5 is refused on purpose, not by omission:** all four Level 3 powers are read in `usesLeft` and Election Fever is not, so a Level 5 borrow would be a power available in one code path and not another. KNOWN-GAPS §2 G14a |
| Deflect | **ships** `adapted` as `ct-et2040-015` | the reactive half only. G13 landed. Still dropped: *"only that partial effect is deflected"* — `applyEffect` computes one target per effect list, so the whole resolution is redirected (G20). And widened: `target: 'any-card'` rather than `card-affecting-you`, which resolves through an approximation (G1) |
| Market Correction | **ships** `adapted` as `ct-et2040-002` | G3, G17 |
| Blind Box | **ships** `adapted` as `ct-et2040-013` | G20 landed — only *"This is an extra Ideology Card"*. G15 dynamic price, G17 the "of your choice", G23 re-filing, G12 expiry-on-purchase |
| If You Like Piña Colada | **ships** `adapted` as `ct-et2040-017` | G4 + G15. **No clause dropped**: a `res` of 1 in *each* resource times `per: { of: 'held-of-each-resource' }` *is* a doubling of the mat, and p12's cap is the card's own second sentence, enforced by the same `gain` path. `npm run balance` reports it **NOT MEASURED** rather than scoring it zero, which is the checker's designed verdict for a card whose value it cannot compute with no player state in scope. Still `adapted`, not `verbatim`: a Conspiracy Card also needs a `cost` the recovered rules text does not print |
| Subscription Model | **ships** `adapted` as `ct-et2040-023` — **filed 2026-10-04, WITH the deviation, not behind a gate** | This was the one recovered card in this file that was playable and **held back**: its reduction is **strictly stronger** than the printed card, and `KNOWN-GAPS.md` §0b.2 recorded that shipping it needed an engine owner's ruling. **It now ships, and the reason the ledger should accept that is that the deviation is no longer hidden.** The real card binds ONE chosen opponent; the reduction fires on ANY influence including your own and the thief picks the victim. Both the card's `text` and its `source` say so on their face — *"The printed card fixes one opponent up front instead, takes only from what they have just spent, and is discarded when a second copy is played."* **DROPPED, three:** the fixed victim (that is G1, `'chosen-player'`), *"their SPENT resources"* (a per-turn spend LEDGER on `PlayerState`, so `steal-any` reads the current pool), and the self-discard *"There are two such cards"* (a copy COUNTER — G10's `GameState.counters` / `add-tokens` / `when: 'tokens-reach'` — so the limit is a deck fact the engine cannot enforce). A card that is stronger than the printed card and says which half is stronger is a decision a reviewer can overrule; a card that is quietly stronger is the defect this whole file exists to catch |
| Power Trip | **ships** `adapted` as `ct-et2040-019` | G14 landed, so the trigger is performed: `on-voter-influenced` with `influencedVotersAtLeast: 3` and `byOwner` **is** "every time you influence a 3-Voter Card". **Wider than printed**: `"non-majority"` is dropped, so a majority peg can be struck, and the printed `"you can"` becomes mandatory because the hook fires |
| Quantum Wristband | not representable | G14 + G13 (auction of 3 headlines, self-immunity, IOU bids) |
| Dumpster Dive | **ships `adapted`** as `ct-et2040-018`, both halves of its clause executing | `draw-conspiracy` carries `from: 'discard'` **and** `pick: true`, so the player NAMES a member of the recycle list, and a two-card take is TWO decisions, each offering what is left — which is how *"it can be in any order"* is expressible rather than dropped. `adapted`, not `verbatim`: the clause is paraphrased into schema ops, and executing every clause is a different property from reproducing the text (cf. §1 on the tier, and `ct-et2040-017`). What is public by DERIVATION is the pile's **MEMBERSHIP, not its ORDER** — every card on `_conspiracyDiscard` was logged publicly as `Played "<NAME>"`, and a card can leave silently (both `draw-conspiracy` take paths remove by index, not from an end) so what remains is reordered without anything being said. The five other refusals (a player hand, `_ideologyDraw`, `_ideologyDiscard`, `_headlineDraw`, `_voterDraw`) are UPHELD, not relaxed |
| Dumpster Dive | **now `adapted` with no clause dropped** — see §4.7 | No clause is dropped, which is NOT the same as `verbatim` — see §1 on the tier and `ct-et2040-017`, which also drops nothing and stays `adapted`. The `'choose-card'` kind exists, it enumerates ONE public set, and the one thing it will not do is enumerate a hidden pile - which is why the set had to be made public rather than the pile made readable. `to: 'discard'` also ships on this op, honoured only from that public pile |
| Deepfake Rally | **ships** `adapted` as `ct-et2040-003` (branch 1 of 2) | G6 |
| Shrinkflation | **ships** `adapted` as `ct-et2040-024` — filed 2026-10-04, **no engine change** (G14b) | REF 4.2.1 reads *"Pick up to 2 opponents. They will get 1 less voter on the next 2 Voter Cards that they influence. This applies to 2 separate voter cards for 2 different players."* The state-changing half ships as `restrict` kind `voter-shortfall`, read by `INFLUENCE` in exactly one place: `value` is the voters lost per card and `owed` is the number of CARDS. Two rulings, both on `'voter-shortfall'` in `packages/engine/src/state.ts` — it **SUPPRESSES rather than refuses** (a 1-Voter Card under a 2-voter shortfall yields *zero* and the purchase still succeeds, because a restriction that made the influence illegal would freeze the table on a card that cannot be unbought), and it is subtracted **after** Going Viral (subtracting first would let a Showstopper launder the debuff away by pairing it with their own power). `owed` means something different here than for KHAKI TERROR's lock and that is named rather than left to be inferred. **DROPPED, both named:** *"Pick up to 2 opponents"* ships as **one**, because `applyEffect` computes ONE `target` for a whole effect list and so a card cannot raise two `choose-player` decisions in one resolution; and the printed rider *"This applies to 2 separate voter cards for 2 different players"* goes with it, since one card and one player is what ships. KNOWN-GAPS §2 G14b |
| Predictive Polling | **ships** `adapted` as `ct-et2040-004` (branch 1 of 2) | G7/G19 |
| Disaster Tourism | **ships** `adapted` as `ct-et2040-021`, **nothing dropped** | Built this iteration and the `read`-vs-`target` split closed it: *"any 2 resources"* is `gain-any`, *"for each"* is `per`, and *"Pick a player"* is `read`, so `target` keeps naming the **recipient** while `read` names whose board the multiplier comes off. The earlier refusal below was right about the problem and wrong about the impossibility — `chosen-player` really does aim `n` at the player the effect resolves FOR, but `read` is the field that separates the two. **Still `adapted`, not `verbatim`:** a Conspiracy Card also needs a `cost` the recovered text does not print |

> REF §4.2.1's heading says *"15 cards"* but the table has **16** rows. The 16 are listed.

### 4.2 India Conspiracy Cards — REF §4.2.2

| card | disposition | blocking gap |
|---|---|---|
| Chai-Paani | not representable | **the base effect was never recovered.** Only a re-application clause exists (*"a second card can be applied on the same player; the first gets deactivated"*), from a search snippet of S2. Shipping it would mean authoring the whole card under a recovered name |
| Chhupa Rustam | **ships** `adapted` as `ct-in2020-011` | G20 landed, so the card is a movable object and the first sentence executes. Still dropped: G15 (*"as many resources as the Ideologue level this card is on"* — a computed price the seller reads), G17 (*"of your choice"* — a choice over the pile's contents, which is a new `Choice` kind the client owns), G23 (re-filing under another Ideologue). See KNOWN-GAPS.md G20 |
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
| GREAT LEADER, BAD ECONOMY | **ships** `adapted` as `hl-et2040-022` | Built this iteration. The earlier refusal below correctly identified the gap — the voter ops all resolve to a pool or a mat and none has a **destination**, and `evict` is the wrong verb because this card *helps* the beneficiary — and the fix is `move-peg` plus one new `Choice` kind carrying a destination with the peg. Two thirds already existed: the trigger is POWER TRIP's own (G14), the lifetime is `'rest-of-game'` (G9), and *"the player after you"* is `'player-after'`, which raises **no** decision because it is one index into public `turnOrder`. DROPPED, named: a Volatile-Area peg is immovable (p18) and *"MAY"* is not a decline flag |
| DOSTI BANI RAHE | not representable | G15 + G22 — *your* Gerrymandering Rights, read on *their* turn |
| KHAKI TERROR | **ships** `adapted` as `hl-in2020-007` | G5, G10 |
| GROWING DISSENT | **ships** `adapted` as `hl-in2020-014` | G9 + G14, with nothing approximated: the hook fires on `on-gerrymander`, `movedMyVoter` **is** "any opponent Gerrymanders your voters", and "for 1 round" is the `round` lifetime. Dropped, named: `"gained voters are placed immediately"` — the engine grants the voter to your Mat and you place it |
| A CALL FROM KARACHI | not representable | G13 auction (ruled out with a cost) + G17 deck search + G18; also explicitly *"you don't need to reveal this card"* |
| STAY IN YOUR LIMITS | **ships** `adapted` as `hl-in2020-012` | **the ledger had this filed under the wrong gap.** The blocker is G-new, not G18: a `convert-voter` with NO `target` reaches the CASTER, because `voterScope` returns `'others'` when `chooser === source`. So "every player converts 2 voters of the player to their left" is expressible. Dropped, named: "every player" (only the resolving player acts) and "to their left" (any opponent may donate, which is **wider**). The 2-resource payout for breaking no majority is still G2 |
| POLO RETREAT | **ships** `adapted` as `hl-et2040-028` — filed 2026-10-04, **no engine change** (G14a) | the same `borrow-power` as DEEP THOUGHTS across a turn boundary, with `until: 'next-turn'` as the lifetime. REF §4.1 attributes it to the USA 2020 campaign and no USA deck exists, so it is filed beside its campaign-less §4.1 siblings. **Not G20**: nothing here moves a card. **DROPPED, four clauses, and the first moves WHO benefits rather than shrinking the effect:** *"each other's"* — REF 4.1 reads *"They can use each other's unlocked Level 3 Ideologue Powers"*, and one decision names one DONOR, so what plays is *"you may use a named opponent's powers"*, not a mutual exchange; *"Pick 2 players"*, for the same reason (`applyEffect` computes ONE `target` for a whole effect list, so a card cannot raise two `choose-player` decisions in one resolution); the fallback *"both players can use any one Level 3 Power of their choice"*, which is a power that need not be unlocked at all and is a different mechanism; and *"You may pick yourself"*, which `resolveChoice` refuses rather than the card naming it. KNOWN-GAPS §2 G14a |
| NEXT BILLION DATA POINTS | not representable | G13 vote (no self-votes, re-vote on tie) |
| PYTHONPOST | **ships** `adapted` as `hl-in2020-015` | G9 + G5 landed, so the permanent tax is executed. REF §4.3 records SNOOP B-O-DOUBLE-T as the **same card**, so one shipped name covers both archetypes and neither is counted twice. **Wider than printed**: `"every Conspiracy Card that you buy"` becomes every purchase, because `surchargeFor` is one function read by INFLUENCE and BUY_CONSPIRACY and no field says which kind of purchase a restriction prices |
| SUBMERGED | **ships** `adapted` as `hl-et2040-029`, **and** the archetype also ships as `hl-et2040-001` | REF §4.3 calls this the same card as NEW FACE WHO DIS, so they are one archetype under two recovered names and **both are now filed**. The second copy is deliberate: REF's own text says to dedupe by effect, a table can legitimately draw the same mechanic twice, and the two cards' `text` fields disclose the difference in full — `hl-et2040-001` ships the `you` reading and `hl-et2040-029` the `everyone` one, because `advanceTurn` wipes an every-player grant before the next player acts. **The probe still keeps both rows, because a duplicate is cheaper to keep visible than to deduplicate by hand** — which is why 54 probed rows map to 44 cards |
| COUGH IT UP | **ships** `adapted` as `hl-in2020-013` | `evict` carries `target` since commit `9d1326c`, so *"All your opponents evict 1 voter"* plays. The conditional bonus — *"if a player breaks a majority using this action, all other players gain 1 resource of their choice"* — is still G2: no op reads board state to decide a payout |
| NERO'S GUESTS | **ships** `adapted` as `hl-et2040-017` | G16 landed. `zone: this-zone` is read off `GameState.headlineQueue[0].areaId` - the Volatile Area whose placement drew the Headline - which is exactly REF 4.1's own gloss (*"this zone" = the volatile zone that triggered it*) and needs **no new state field**, so `reduce()` stays pure and a replay derives it. Still dropped, named: *"move"* ships as EVICT (strictly weaker for everyone affected), the adjacent-zone destination, and the all-or-nothing pairing of the two clauses |
| ON THE "HIGH" SEAS | not representable | G11 hostage — a persistent board-resident object holding 4 pegs |
| A COWARD OR A JOURNALIST? | **ships** `adapted` as `hl-et2040-030` — filed 2026-10-04, **no engine change** | **THE `not representable` LABEL ON THIS ROW WAS STALE, and it was stale because the row was arguing against a clause the reduction does not use.** The earlier refusal held that the card needs `move-card { from: 'pending' }` — donating the card you have been PUT — and that this is refused AT THE TYPE LEVEL because it would tell a mid-answer player the card exists, offer a look at it by proxy, and empty `_pendingCard` into a soft-lock where `ANSWER` and `END_TURN` are both illegal. **That refusal is still correct about `from: 'pending'` and it no longer applies to this card**, because the reduction draws from the Ideology **DRAW** pile instead, so nothing on this path reads the answer window at all. `target: 'player-after'` is one index into public `turnOrder` from the actor, wrapping — and in a clockwise turn order that **is** *"the opponent on their left"* — so it raises **no** decision, needs no new `Choice` kind, and costs the client nothing. ONE `target` for the whole effect list happens to be exactly right here, because the card goes to the seat on your left AND the 6 resources go to whoever ends up receiving it. **NOW IN THE CORPUS**, so this row measures the game and not only the vocabulary. DROPPED, four, each named: *"starting from you, EACH player"* is N donations and this is one, because `applyEffect` computes ONE `target` for a whole effect list; *"optional"* is dropped, the donation is not a decision; *"you may pass along a card you just received"* is dropped, which is the hand-before-draw path and a hand is a queue its holder cannot enumerate; and the card comes off the Ideology draw pile rather than out of the caster's HAND, because `from: 'hand'` is refused at the type level for the same structural reason `from: 'pending'` is. **G12's in-flight queue (an owner, a seat, a deadline) is not settled by any of this** and is not claimed to be |
| BLESSINGS OF PARENTS PAST | **ships** `adapted` as `hl-et2040-027`, ONE clause of four | **the ledger's three blockers moved, and the card is still three-quarters short.** `reveal` (U2) landed and PERFORMS the whole first sentence: `kind: 'voter'` names `_voterDraw`, `n: 2` is the printed 2, both cards land face up on `GameState.revealedCards`, which is unprefixed and on every payload — so this cost no secrecy decision, which §2bis had said it would not. `sameZone` (U3) landed but is **unreachable from any card**: `INFLUENCE` is the only writer of `PendingVoterGroup.sameZone` and no op exposes the field. And `choose-card` (U1) **did not reach this card**: `Choice`'s `choose-card` arm is hard-limited to `_conspiracyDiscard`, so G17's market enumeration — the ONE set §2bis called legitimate, because p10 keeps three Voter Cards face up on the HQ Mat — is still unbuilt. Dropped, four, each with its mechanism: *"Keep 1"* needs a private **Voter Card hand** plus a `choose-card` over it, and `move-card { from: 'revealed', to: 'hand' }` is unusable here because it writes the **Ideology** hand, where `advanceTurn` would hand that Voter Card id to the next player as their Ideology Card and `ANSWER` reads `cards.ideology[id]` and fails permanently; *"donate the other to an opponent"* needs `move-card` to carry a Voter Card into a named opponent's container and `to` is `'hand' \| 'destroy'`, where `'destroy'` is the wrong verb anyway because the card must still be influenced — **G20** plus the same missing hand, though G1's `chosen-player` would have supplied the seat; *"influenced for free immediately"* needs a free `INFLUENCE` and no `Effect` can grant an action's `pay` — **G15**'s `price`, the identical drop `hl-et2040-018` already names; and REF §4.1's own gloss *"you place your influenced voters first, then the opponent places theirs"* is KNOWN-GAPS.md §8.2(b), a pending group whose deadline is the **donor's** resolution rather than the recipient's turn. **AND THE SHIPPED CLAUSE IS LOSSY, which is why it is on the card's face and not only here:** `reveal` moves the card out of `_voterDraw`, and only `move-card { from: 'revealed' }` and the turn boundary clear `revealedCards`, neither returning it to a pile or the market — so both Voter Cards **leave the game**. Measured, not assumed. A reader deciding whether to keep this card should know it costs the table two of its sixty Voter Cards and returns nothing. **AND IT IS NOT COSMETIC — one seeded game now fails to terminate.** Adding `hl-et2040-027` turns `packages/server`'s 60-seed, 2-seat sweep red at **seed 35**: without the card that seed finishes inside the 1200-action budget, with it the game is still unfinished at **12000 actions and turn 3975** (`market` 3, `_voterDraw` 1, both pools empty). The control that makes this the card's fault and not test over-fitting: rebuilt as `kind: 'conspiracy'` — the same card in the same deck position, so the identical shuffle stream — the stall disappears, so it is the VOTER-CARD clause specifically. The engine-level fix this needs, and does not get here: **`revealedCards` is a window with no return path**, so any `reveal` of a pile the table will never again see is a permanent deletion. The shape is G20's (cards moving out of the world) arriving through `reveal` rather than `move-card`; the cheap repair is a return leg — `reveal { kind, n, return?: 'pile' }`, or letting the turn boundary put an unresolved revealed card back on the pile it came off |

### 4.5 Headline Cards, Earth 2040 — S4, REF §4.3

| card | disposition | blocking gap |
|---|---|---|
| 404 | not representable | G18 — swaps who answers which card |
| Own Goal | **ships** `adapted` as `hl-et2040-003` | G1 only (G-new closed) |
| Universal Basic Intrigue | **ships** `adapted` as `hl-et2040-013` (replacing the `inferred` THREE DAY WEEKEND) | Both REVEAL clauses, and a reveal has **no state consequence in this engine** — a missing mechanism, not missing wording. The top-up is shipped in full |
| Bank Holiday | **ships** `adapted` as `hl-et2040-023`, **on the second clause only** | A **PART-BUILD, and it needed no engine change at all** — which is the honest answer to the question of whether G18 was really large. The second sentence, *"Players will not receive any resources (active & passive) for doing so"*, is `restrict` with kind `no-income` read literally, and `ANSWER` already consults `incomeBlocked` for exactly this card: it logs *"No resources for this answer."* and suppresses **both** the answer's resources and the passive bonus, which is what "active & passive" means. The earlier refusal below was right that without G18's answer-phase control the clause has a different referent; what it missed is that `until: 'round'` gives the clause a **finite, honest** bound, so the card can ship the state-changing half and drop the phase change rather than inventing a referent. DROPPED, named: *"every player answers an Ideology Card immediately, in order of turn"* is a card-level sweep that runs answers out of band, and `_pendingCard` is written exactly once per turn by `advanceTurn` — so a sweep is a **second writer** for the answer window, which is the refusal already on `move-card`'s `to: 'pending'`. That is a RULES QUESTION, not a cost, and `KNOWN-GAPS.md` §8.2 states it |
| Left-Wing Handout | **ships** `adapted` as `hl-et2040-031` — filed 2026-10-04, **no engine change** | **THE `not representable` LABEL ON THIS ROW WAS STALE**, for the same reason as A COWARD OR A JOURNALIST? above, which it shares clause for clause. REF §4.3 lists this card as a **re-skin** of that one, and the probe keeps the two rows under both names deliberately, because a duplicate is cheaper to keep visible than to deduplicate by hand; the reduction is field-for-field the same two clauses, and every clause dropped or performed is identical to that row. **WITH ONE ADDITION:** REF §4.3 adds *"Can be blocked only at the beginning."* That is a rule about **WHEN** the response window opens rather than about what happens, and the window that already exists (`GameState.interrupt`, G13) opens for the whole resolution — so the narrowed timing is **dropped and named rather than approximated**. **NOW IN THE CORPUS, as a deliberate second copy of `hl-et2040-030`'s archetype** |
| Convenience Fee | **ships** `adapted` as `hl-et2040-021` | G5's `surcharge` restriction is executed and read by INFLUENCE and BUY_CONSPIRACY. **Wider than printed**, and the card says so on its face: the printed tax is on **Voter Cards** and this taxes **every purchase**, Conspiracy Cards included, because `surchargeFor` is one function with no field saying which kind of purchase a restriction prices |
| Pity Vote | **ships** `adapted` as `hl-et2040-018` | G1 landed for the named opponent. Dropped, named: "for free" is a PURCHASE the engine cannot grant (G15's `price` field); "the voters" ships as 1 because the recovered text names no number and inventing one would be a claim the corpus does not support; "right away" needs an *immediately* placement — **and that last drop was the one place in this table where the shipped `text` read as the OPPOSITE of the recovered timing, so `text` was amended 2026-10-04 to say so to the player. See §4.8** |
| Fuelling The News | not representable | G17 (draw 3 Headlines) + G18 (choose the resolution order). The *giving* half moves Headline Cards, and move-card is Ideology-only. **Not G20-blocked** now |
| Blue Screen | **ships** `adapted` as `hl-et2040-020` | G5's `no-power` restriction is executed and read by `powers.ts usesLeft`, the one consult point every `POWER_*` case already asks. **Weaker than printed, and named on the card rather than hidden**: the printed card takes ONE CHOSEN Level 3 power and this takes **all** of them, because naming one power is a decision over POWERS rather than over players (G1). The printed `"if you do not have a Level 3 Ideologue Power, discard 2 resources in your next turn"` is dropped: a conditional over a whole effect list. It was held back for three iterations by a **corpus gate** rather than by the engine, and that gate is gone |
| Leaked Memo | **ships** `adapted` as `hl-et2040-011` (keep-one branch) | G17, G20 |
| Higgs Moron | not representable | G10 (tokens on a card) + G12 (timed pass) |
| Overcrowding | **ships** `adapted` as `hl-et2040-016` | G16 landed. `zone: your-strongest` is a pure function of the board, so *"the zone where you have the most voters"* is now **performed** rather than approximated. Still dropped, named: *"into an adjacent zone"* (a destination is a second decision on top of a source one), the tie-break (broken deterministically by `ZONE_IDS` order instead of offered as a decision), and *"move"* as EVICT (strictly weaker) |
| Free Publicity | **ships** `adapted` as `hl-et2040-010` | G1 |
| Relocation Fatigue | **ships** `adapted` as `hl-et2040-015` (replacing the `inferred` SILICON RAIN) | G10 (the counter), G13 (multi-turn block). Both of its recorded gaps, G9 and G22, were already CLOSED when the playability probe wrote the row down |
| Change Of Address | **ships** `adapted` as `hl-et2040-001` | the Volatile-Area placement ban is G5 and still (c). **The every-player targeting is dropped for a different reason than this row used to give**, and the old reason was wrong: G8 closed on the reducer, so `target: 'everyone'` IS honoured and the card would be free to say it — but the bonus lands in `PlayerState.powerUses.gerrymandered`, which `advanceTurn` resets for the incoming player, so in a real game the grant is wiped before the next player acts. It ships in the `you` reading for that reason (G9/G22), not pending an engine change. SUBMERGED is the same archetype and now ships separately as `hl-et2040-029` |
| Blood Money | **ships** `adapted` as `hl-et2040-002` | G4, G-new |
| Chungi | **ships** `adapted` as `hl-in2020-033`, **and** the archetype also ships as `hl-in2020-015` | REF §4.3 says outright that this is the **same card** as PYTHONPOST — one archetype, two recovered names, and **both are now filed**. The second copy is deliberate, and each card's `source` says so in as many words: *"Beside `hl-in2020-015` a table can draw the same tax twice; if that is a balance problem the fix is to retire one NAME, not to change either reduction."* `hl-in2020-033`'s `text` discloses the stacking to the player. It is the only one of the nine that drops **no** clause, and it still ships `adapted` — see §1 on the tier |
| Spending Freeze | **ships** `adapted` as `hl-et2040-033` — filed 2026-10-04, **no engine change** | **THE `not representable` LABEL ON THIS ROW WAS STALE, and so was the reasoning behind it** — it refused on G5 + G9 + G15 + G22 and called the lowering of a cap under an already-over player *"the convert-voter soft-lock shape"*. **It is not the same shape.** `enforceCap` raises count = `overCap(pool, cap)` = max(0, total − cap), so excess ≤ total **ALWAYS** — the ask can never exceed what the player holds — and discarding it lands at min(total, cap) ≥ 0, so the target state is **REACHABLE rather than merely approached**. `lose-any` is additionally clamped to the chooser's pool at ANSWER time, so a pool that drains in between lowers the ask instead of stranding it. `convert-voter`'s defect was a decision with **no acceptable answer**; this is a decision whose answer is **always affordable**, and no gate is needed. The exhaustive proof is `packages/engine/test/cap-override.test.ts` at 2/3/4/5 seats. ON THE VOCABULARY the whole of REF §4.3's *"Reduce your resource cap to 10"* is expressible, via `set-cap` reading `PlayerState.capOverride` — a `PlayerState` **FIELD** rather than a `restrict` kind, because a cap is a NUMBER every pool comparison reads and not a gate an action is refused at — and `enforceCap` runs in the same breath as the write, which is p12's *"if at any time you cross your resource cap"* read literally. **NOW IN THE CORPUS**, so this measures the game and not only the vocabulary. DROPPED, both named: the *"[OR] Pick an opponent EVERY TURN and donate any 1 resource to them"* branch, which is a recurring donation to a chosen opponent (G5 + G9) and is therefore a **different card**, not a smaller one; and the resource cap being **player-visible as a number on the mat**, which the engine enforces but the client does not yet render |
| Cost of Living | **ships** `adapted` as `hl-et2040-009` | G5 |
| Bandwagon | **ships** `adapted` as `hl-et2040-019` | G1 names the opponent, G14 fires the hook, G22 is the lifetime, and the printed "1 voter **not card**" parenthetical holds because `voters` grants a group rather than drawing. **One clause dropped and it makes the card STRONGER**: `condition: { byOwner: true }` is left off, so the hook fires on ANY influence rather than only yours |

> REF §4.3's heading says *"18 cards"* but the table has **20** rows. All 20 are listed.

### 4.6 Ideology material — REF §2.1, §5.1, §5.2, §8.1

| item | disposition |
|---|---|
| Supremo-Capitalist character card (*"Is it still xenophobia if I make a lot of money?"*) | **not representable.** It is a character card, not a question card. `IdeologyCard` requires exactly two sides with two different Ideologues, and a character card has neither. REF §2.1 says so itself |
| §8.1 questions 1–8 | ship as `ig-in2020-001` … `ig-in2020-008`, all `adapted`. Stems recovered; **no complete card was ever recovered** — REF §2.4 and REF §10 item 1 both record zero ordinary question cards in full |
| §8.1 item 9, aerial bombing | ships as `ig-in2020-031`, `adapted`. Stem legible, **verb occluded**; REF §8.1 says do not treat as verbatim |
| §8.1 item 10, Kashmiri farmers | ships as `ig-in2020-032`, `adapted`. Stem legible only to "FLY"; **object occluded**; REF §8.1 says do not treat as verbatim |
| **Everything past `ig-in2020-032`** | **60 authored cards, `inferred`, and this is the honest shape of the whole file.** REF §2.4 names the three sources that would have closed this gap (a Tabletop Simulator mod, photo reviews, or buying the deck) and records that YouTube, Reddit and BoardGameGeek were all unreachable in that session. None of them was reachable from here either, so §2.4's own instruction governs: *"Do not fabricate card text. If none of the above lands, write original cards in the recovered register and cite §8."* Every one of them cites §8.2 on its `source` field, and none is tagged anything but `inferred` |
| Any printed Ideology payout | not recovered. REF §10 item 2: payouts are icon discs, not numerals, and were never published in a crawlable text source |

### 4.6.1 Three answers rewritten 2026-10-04 — the dilemma defect no balance check could see

`npm run balance` measured, **over the 76-card Ideology deck as it stood on 2026-10-03**,
that **0 of the shipped Ideology Cards are decided by their
payout** — every one of them is better on side A for some reachable holdings vector and
better on side B for another (all 1820 reachable pools, exact knapsack over the shipped
Voter market). The payout therefore never decides an answer, and **the two answer strings
are the only thing that does**. **⚠ The 76 is that run's deck size and is kept as history;
the deck is 134 today and this has not been re-run over it.**

Reading them under that condition found three cards that were not carrying it. Each opened
**both** sides with the same three-word action frame, so the polarity token was the entire
difference between the two answers and the card asked nothing:

| card | question | the defect |
|---|---|---|
| `ig-in2020-016` | Does the Centre need its power to dismiss elected state governments? | side 1 read *"No. **Digitise it now** and the next sale is fast enough to be invisible."* — it told the reader to do the thing its own `No` refused |
| `ig-in2020-023` | Must every young citizen do a year of military service? | side 0 read *"No. **Publish it** and the next recruitment is only a rumour."* — same defect |
| `ig-in2020-029` | Must riverfront beautification wait until the river itself is clean? | side 1 read *"No. **Name the schools** and the parents read nothing else."* — same defect |

**Clause-by-clause disposition. Nothing was dropped.** In each case the clause after the
shared frame is *retained* and re-argued as the cost of the action rather than as a reason
to take it:

- `ig-in2020-016` side 1 — the clause *"the next sale is fast enough to be invisible"* is
  kept, now attached to the other side's action as the cost of digitising (a searchable
  copy is a copy somebody else is holding) rather than as an instruction to digitise. The
  new text argues the Supremo position: the register is the last thing the state owns
  outright.
- `ig-in2020-023` side 0 — the clause *"the next recruitment is only a rumour"* is kept
  as the tail of a sentence that now argues *against* publishing ("the next government is
  not us"). Side 1 is untouched.
- `ig-in2020-029` side 1 — the clause *"the parents read nothing else"* is kept, now
  following an instruction **not** to name the schools. Side 0 is untouched.

Provenance is unchanged on all three: they were `inferred` before this edit and remain
`inferred`, and REF §8.2 is still cited on every `source` field. **No `verbatim` card
exists in this corpus (there are none) and no `adapted` card was touched**, so the
paraphrase prohibition does not arise here — but it is worth recording that the three
objects nearest a verbatim Ideology Card are `ig-in2020-001` … `ig-in2020-008`
(`adapted`, from REF §8.1's recovered *stems*), and this edit touched none of them.

The screen that found these is now permanent and mechanical:
`test/ideology-variety.test.ts`, *"gives every card two sides that ARGUE WITH EACH OTHER,
not one argument twice"*. It is deliberately a **deck** check and not a balance check,
because the payout is identical on both sides of all three cards and always was — the
instrument that governs this deck had nothing to say about them and said nothing.

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

**44 of 54 probed cards are expressible** — a reduction exists and `reduce()` plays it,
moving the state. 10 are not expressible at all. **0 are refused at play time** and **0
are expressible-but-unexecutable** — which is the finding worth stating: `src/executable.ts`
has no remaining hole between "the validator will accept this card" and "the reducer will
perform it". Every unshipped recovered card is unshipped because there is no op for it,
not because a card slipped past a check.

**But "expressible" is not "in the game", and the ledger now says so.** Of those 44, **35
are in a deck file** and **9 are in no deck file at all** — a card nobody has filed cannot
be drawn by anybody, so counting it measures the vocabulary and calls it the game. The
headline is the conjunction: **35 of 54**. Of those 35, **33 are SHIPPED AS AUTHORED** —
the deck file's own `effects` are what the probe played, field for field — and the
remaining **2 are named supersets**, with the superset direction stated on the row. See
§4.8.

### What the measurement changed in this ledger

Two rows above were written before three engine commits landed, and playing them found
the difference:

| card | ledger said | measured |
|---|---|---|
| SELECTIVE ACCESS MEMORY | not representable, G17 | **plays, and now SHIPS `adapted`** as `ct-et2040-018`, with no clause dropped. `draw-conspiracy` carries `from: 'discard'` **and** `pick: true`, so the player names a member of the recycle list and a multi-card take is one decision per card - which is how *"it can be in any order"* is expressible rather than dropped. Provenance stays `adapted`: a paraphrase into schema ops, and *dropping nothing* is not *reproducing the text*. The corpus's standing 0-verbatim count is unchanged at **0**. This row is the probe's VERDICT for the card, not a gap ruling: `npm run playable` reads `40 -> 40`, because the card already reported PLAYED at HEAD via deterministic top-of-pile. The `G17 -> none` tag is the probe no longer finding an inexpressible clause, and is **not** a claim that G17 is closed |
| COUGH IT UP | not representable, G2 (`evict` had no `target`) | **plays its first branch, and now SHIPS** as `hl-in2020-013`. `evict` carries `target` since `9d1326c`, so *"all your opponents evict 1 voter"* resolves. The majority-conditional bonus is still G2 |

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
   The decision is raised to a player who cannot answer it, every time. It is in
   `reduce.ts`, not here.

   **STILL TRUE, AND IT IS NOW WHY A CARD DEPENDS ON IT.** `hl-in2020-012` STAY IN YOUR
   LIMITS ships `convert-voter` with **no `target` at all**, which is the only shape that
   works: `voterScope` returns `'others'` when `chooser === source`, so the CASTER is the
   chooser and the pick is an opponent's peg. Adding `target: 'chosen-player'` to that card
   would ship the defect above rather than fix it, and `test/recovered-cards.test.ts`
   asserts the peg changes hands to p1 so the shape cannot drift back.
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

## 4.8. "In the corpus, probed something else" — eight divergences, reconciled 2026-10-04

`scripts/playable.ts` derives a field-by-field divergence between each row's `reduction`
and the shipped card's own `effects`, and reports the count as **in the corpus, probed
something else**. It was **8**. Every one of the eight is dispositioned below, and the two
that remain are named supersets rather than loose ends.

**The resolution rule, and it has exactly three answers.** (a) the probe is wrong — fix the
row to match the deck file. (b) the card is wrong — its shipped effects do not do what its
`text` says, so fix the card. (c) both are right and differ on purpose — the probe explores
what the SCHEMA can express while the card ships a subset, which is legitimate **provided
the note names which side is the superset and why the card ships the subset.**

| card | probe played | card ships | answer | one line |
|---|---|---|---|---|
| Hostile Takeover | `steal-any n2 target each-opponent`, and nothing else | `steal-any n2`, `evict n2` | **(a)** | the probe was wider on clause one and silent on clause two, which is a different card, not a superset |
| Block | `[]` | `gain clout 1` + the interrupt | **(b) and (a)** | the card's `text` promised a payout on the one path that cannot pay it |
| Deflect | `[]` | `gain trust 1` + the interrupt | **(b) and (a)** | the same defect on the same two lines of `reduce.ts` |
| Market Correction | `refresh-market until: rest-of-game` | `refresh-market`, `gain-any n1` | **(a)** | the probe's clause installed a live effect with a NULL trigger, which never fires |
| Predictive Polling | `draw-conspiracy n2` | `voters n1`, `gain-any n2` | **(a)** | `draw-conspiracy` is not a branch of this card at all; the old note called it "the other branch" |
| Blood Money | `discard-voter n1 target each-opponent` | `discard-voter n2`, `gain-any n2 each-opponent` | **(a)** | halved the count and dropped the payout |
| KHAKI TERROR | `restrict no-purchases`, then `lose` | `lose` alone | **(c)** — **probe is the SUPERSET** | the lock is dropped because one donation discharges it, so a shipped lock would print a freeze that evaporates |
| Change Of Address | `gerrymander n1 target everyone` | `gerrymander n1`, no target | **(c)** — **probe is the SUPERSET** | G8 landed and `everyone` is honoured, but the grant is wiped by `advanceTurn` before the next player acts |

**New value: 2.** Six were the probe measuring something other than the card and are now
field-for-field identical to what ships; two are legitimate supersets and stay, named.

### The finding that mattered most: BLOCK and DEFLECT promised a payout nothing pays

This is the calibration example from the audit, in a second costume, and it is worth
stating plainly because it is **not** a gap and **not** a probe artifact.

`ct-et2040-014` shipped `effects: [{ op: 'gain', res: { clout: 1 } }]` beside the printed
sentence *"Otherwise: gain 1 Clout."*, immediately after the sentence telling a player to
play the card **IMMEDIATELY out of turn**. `ct-et2040-015` shipped the identical shape with
Trust. Both passed `validate`, `balance`, `playable` and every suite in this package,
because the clause is perfectly executable — **it is simply never reached from the path
that plays the card.**

`RESPOND_INTERRUPT` reads `card.interrupt` for validation, then hands the window to
`closeInterrupt`, and `closeInterrupt` applies `w.effects` — **the staged card's** effect
list, captured on the `InterruptWindow` when the window opened — and never the responder's
own `card.effects`. So a BLOCK paid 1 Clout on no path a player could read off the card,
and the probe row that flagged the divergence justified itself with a statement that was
backwards: *"its empty effect list is what `RESPOND_INTERRUPT` reads."* It reads the
staged card's.

Both `text` fields are corrected. They now say the reactive half pays nothing, and name the
only path that resolves the effect list — playing the card as an ordinary Conspiracy Card
in the p19 window, which is a different action from the one the card describes. The
`effects` list stays, because the schema requires one (`minItems: 1`) and
`card-playback.test.ts` asserts both cards carry a non-empty list.

**The lesson for the probe, and it is the one this file is for:** a fully-executable clause
that no action reaches passes every registry here. `src/executable.ts` can answer *"would
`reduce()` perform this?"*; nothing before this could answer *"does anything ever ask?"*.

### The second finding: a probe row that lied, and a note that lied with it

The ERADICATING GERMS row played `refresh-market` with an effect-level
`until: 'rest-of-game'`, and its note claimed the recovered recurring obligation was
*"installed as a standing live effect and re-applied at the top of every one of your
turns"*. **That is false in the reducer.** `refresh-market` carries no fields at all, but
`isScoped` reads any of `when`/`until`/`condition`, so the `until` made the clause **scoped**
— installed rather than applied, with the market **not** refreshed — and
`installLiveEffects` pushes a `LiveEffect` whose trigger is `effect.when ?? null`, which is
**null**. `fireTriggers` matches `le.trigger === fire.trigger` against non-null triggers, so
a null-triggered live effect is **dead**: it never fires, on any turn, ever. The row scored
PLAYED anyway because `liveEffects` is in the fingerprint.

So the recurring obligation — *"Discard an open Voter Card every turn (mandatory)"* — is
**not expressible at all**. It needs a trigger as well as G3's `PlayerState.obligations`.
The gap tag stays `G3` and nothing here claims otherwise. This is the probe failing in the
direction the whole file was written to prevent: reporting a capability that does not exist.

### A third, quieter one: FATALITY's text asserted the opposite of the recovered timing

`hl-et2040-018` shipped the text *"They receive 1 voter, which they place on the board on
their own turn."* REF §4.3 reads *"They must place these voters **right away**."* The drop
was named in `source`, and the text described what the engine does — but a player holding
the card was told the opposite of what the real card says, which is the calibration class
this ledger exists to catch. `text` now discloses it to the player rather than leaving it
to `source`.

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
| Total cards shipped | 64 | **222** |
| Ideology Cards | 20 | **134** — India 92, Earth 2040 42 |
| Voter Cards | 12 | 18 |
| Conspiracy Cards | 14 | **31** — Earth 2040 18, India 13 |
| Headline Cards | 18 | **39** — Earth 2040 25, India 14 |
| `verbatim` | 0 | **0** — see §1, and BLOCK/DEFLECT are why |
| `adapted` (carries recovered material) | 19 | **45** — 35 X-cards and 10 Ideology stems |
| `inferred` | 45 | **177** — 124 of them Ideology Cards, and **all 124 authored since `ig-in2020-032`** |
| Cards carrying recovered text | 19 | **45** |
| …shipping `adapted` | — | **35** |
| …playable but held back on a ruling | — | **1** — LAB-GROWN EARWORM, strictly stronger than printed |
| Recovered cards this file records as not representable | 41 | **RECONCILED 2026-10-04, and the two figures ARE the same measurement — they now agree card for card.** §4 carries **12** rows labelled `not representable`, of which **10 are probe rows** and those 10 are *exactly* the probe's inexpressible set, name for name: Quantum Wristband, Chai-Paani, Cult-ivating Obedience, DOSTI BANI RAHE, A CALL FROM KARACHI, NEXT BILLION DATA POINTS, ON THE "HIGH" SEAS, 404, Fuelling The News, Higgs Moron. **The permanent difference of 2 is CRUSHED UNDER BELLY and IFTAR PARTY**, and it is not a disagreement at all: §4 dispositions them, the probe *cannot*, because no effect text was ever recovered for either (name only, plus a six-word AI-blurb paraphrase), so there is nothing to hand the reducer. Their reason is **evidentiary**, where the other ten are **vocabulary** — two different questions, and the probe's denominator of 54 recovered rows already excludes them. **THE EARLIER "20" IN THIS CELL WAS WRONG** and the sentence that accompanied it was self-contradictory: it counted rows *still carrying* the label while also counting three that had been corrected in place and therefore no longer carried it, and it swept in §4.7's two **history** rows (SELECTIVE ACCESS MEMORY, COUGH IT UP — figures bound to a past iteration, kept) and §4.6's character card, which is not a probed row either. Six §4 rows were stale on the label and are corrected in place: GREAT LEADER BAD ECONOMY, BRAVE NEW WORLDS and THOUGHTS AND PRAYERS (built or part-built), plus A COWARD OR A JOURNALIST?, CARD GAMES and THE BIG FREEZE (expressible and unfiled — see their rows, which now name the dropped clauses rather than flipping to a bare verdict). `npm run playable` independently reads **10 inexpressible** out of 54 probed rows, and that is the same 10 |
| Recovered cards playable, by playing | 14 of 54 | **44 of 54 expressible** (`npm run playable`), of which **35 are in a deck file** — that conjunction is the headline, and **33 of those 35 are shipped field-for-field as the probe played them**; the 2 that are not are named supersets (§4.8) |
| `inferred` placeholders retired for a recovered card | 0 | **9** — see the note under §3's 2040 headline table |

**The one number that matters for playability:** REF §2.3 records 8–12 Ideology Cards in a
player's hand after a 5-player game. The India deck went from 12 cards — so players saw the
entire deck and then some — to 32 and then to **56**, and the Earth 2040 deck from 8 — meaning the deck was
**The second number, and it is the one the balance checker exists for.** Both decks now
exercise all six Ideologue pairings, and the India deck sits within 2 points of an even
25% per Ideologue. More load-bearing than either: **all 24 cards authored since
`ig-in2020-032` pay both sides the same total**, so `resourcePreferredSide` in
`src/balance.ts` returns `null` for every one of them — which is that function's own word
for *"the question has to decide this"*. The deck's `resource-blind` verdict stays
`undecidable`, i.e. the payout structure does not tell you which side to take. That matters
more now than it did: another agent is making the payout visible to the whole table, so a
dominated card stops being a design smell and becomes a broken card. The single pre-existing
unequal card, `ig-in2020-006`, was named rather than fixed — see `test/ideology-variety.test.ts`
for why swapping a shipped card for a tidier one is not this package's trade to make alone.

**AND IT IS NOW FIXED, deliberately, one resource on one card.** D2's tolerance band is 0
and `TOTAL_SKEW` is an `error`, so a visible one-resource edge is refused rather than warned
about (see `BALANCE_TOLERANCE_TOTAL` in `src/balance.ts` for the ruling and the measurement
behind it). `ig-in2020-006`'s side 1 was `{media 2, funds 1}` against side 0's
`{trust 2, funds 2}`; it is now `{media 2, funds 2}`. The compositions stay incomparable,
which is the whole point of the checker: the player picks on which Ideologue they are
playing rather than on arithmetic. The earlier refusal is kept because it was right at the
time — swapping a shipped card for a tidier one is not this package's trade to make alone —
and because the trade that settled it was a RULE change with a corpus measurement behind it,
not a preference. `test/ideology-variety.test.ts` now asserts that no unequal card exists.
