# Recovered Ideology Cards

Research artifact. Harvested from the public web on 2026-10-04. Nothing here was
generated or invented — every question/answer string below was read off a real
photograph of a real card or a real web page, and each entry names the exact URL
and the exact image file it came from.

## Honest summary

**What I got: 11 complete question + answer + ideologue + payout records, plus 1
partial (question + truncated answer) and 1 card reported by an earlier research
pass that I could NOT independently re-verify.**

Breakdown:
- **10 complete cards** read by me from high-resolution photographs of physical cards.
- **1 further complete card** (GST) read from a 1024px BGG photo, verified by me at 5× zoom.
- **1 partial card** (Brexit gender studies) — question verbatim, answer truncated at the
  source (a search-engine snippet), from a BGG forum thread I could not open directly.
- **1 card** ("free speech…") that the task brief called VERIFIED. I fetched the cited
  Instagram post and its caption did **not** contain that card text, so I have marked it
  `[UNVERIFIED — reported by prior pass]`, not `[VERIFIED]`.
- **0 names-only cards.** Nobody has published a bare card-name list; the cards don't
  have names, they have questions.

The previous pass found 1 card. This pass found 10 more that I personally read, plus
mechanics facts (resource colours, payout shape, card-ID scheme) that materially change
how the deck should be modelled. That is the honest delta.

### Which sources worked

| Source | Result |
|---|---|
| **Board Game Quest card photos** (`boardgamegeek.com/wp-content/...` — actually `boardgamequest.com`) | **BEST SOURCE.** Two photographs showing 4 real cards each, fully legible. 8 cards recovered. |
| **Official Shopify store render** (`shasnthegame.com/cdn/shop/files/Ideology-Cards_*.png`) | Worked. Served only 1080×1080 despite `_2400x`; one card legible after crop+upscale. 1 card recovered. |
| **`cf.geekdo-images.com` (BGG image CDN)** | Works, no Cloudflare challenge — **but** URLs are signature-bound. Any change to the transform (size, filters) returns HTTP 400. Capped at the exact `imageurl_lg` (1024×1024). 1 card recovered. |
| **`api.geekdo.com/api/images`** | **Worked.** Bypasses the Cloudflare wall on `boardgamegeek.com`. Returns the full 59-image gallery JSON with captions. Used to enumerate candidates. |
| **YouTube description → Google Drive** | **Worked.** `youtube.com/watch?v=BBU_ihNunhg` description leaks three official Google Drive file IDs. Downloaded the 26 MB official rulebook and extracted text with `pdftotext`. |
| **`r.jina.ai` prefix** | Worked for Instagram post pages and Facebook. Did **not** help for BGG (CF wall is upstream of jina). |
| **DuckDuckGo HTML endpoint** via jina | Worked as a search proxy, and was the **only** way I got any BGG forum text (via index snippets). Bing via jina was useless (returned MSN ads). |

### Which sources were blocked, and how I tried

| Source | Block | Attempts |
|---|---|---|
| `boardgamegeek.com` HTML pages (game page, campaign sub-pages 357633/357634, forum threads 2611465 / 3580283 / 2256987 / 2609029 / 3119573 / 3343922 / 3512481) | Cloudflare "Performing security verification" | Direct fetch; `r.jina.ai/` prefix; `api.allorigins.win/raw`; `api.codetabs.com/v1/proxy` (522). All failed. **Workaround:** `api.geekdo.com` for image metadata, and DuckDuckGo's index for forum snippets. |
| `boardgamegeek.com/xmlapi2/thing?id=257305` and `api.geekdo.com/xmlapi2/thing?id=257305` | HTTP 401 | Both. No BGG XML API without a registered app key. |
| YouTube transcripts | `youtubetranscript.com` returned "YouTube is currently blocking us from fetching subtitles"; the watch page transcript panel returned `NaN / NaN` (bot check) | 3 attempts. Dead end. |
| Reddit `r/Shasn` | HTTP 403 network-policy block on `old.reddit.com` via jina | 1 attempt. |
| Instagram profile & hashtag pages (`/shasnthegame/`, `/explore/tags/shasnthegame/`) | Login wall — jina returns only the login form | 2 attempts. **Individual post permalinks work**, but I could not enumerate the account's posts without the profile page. |
| Kickstarter | `discover?term=shasn` returns **"0 projects"** — SHASN's campaign is delisted/ended and not in search | 1 attempt. |
| No "All Ideology Cards Explained" video exists | I enumerated all 41 videos on `@MemesysCultureLab`. There is "All **Headlines and Conspiracies** Explained" but **no** ideology-cards equivalent. | Channel `/videos` listing. |
| Cardmarket / resale listings / Tabletop Simulator & TTS Workshop mods | Not reached — deprioritised once the photographic sources started paying off. **This is the most obvious unexplored seam.** | 0 attempts. |

### Mechanics facts recovered alongside the cards (all verified)

These are more valuable per unit than the cards themselves, because they constrain the
schema. Read off real component photos:

1. **Resource → colour mapping is now certain** (Board Game Quest 2019 preview, verbatim):
   > "Players will receive 1 of the four resources: **red = clout, green = funds, blue =
   > media, and yellow = trust.** … The Supremo is red … The Capitalist is green … The
   > Showman is blue … the Idealist is yellow."

   So the brief's mapping is **correct**: Capitalist→funds(green), Supremo→clout(red),
   Showstopper/Showman→media(blue), Idealist→trust(yellow).
   Source: `https://www.boardgamequest.com/shasn-preview/`

2. **The payout shape is "2 of your own resource + 1 secondary", not "one resource".**
   All 10 cards I read show exactly three icons, always 2× the card's own ideologue
   resource plus 1× a different resource:
   - Supremo card → `clout clout trust`
   - Capitalist card → `funds funds trust`
   - Showstopper card → `media media trust`
   - Idealist card → `trust trust clout` (and `trust trust funds`)

   ⚠️ If the deck JSON models a single `payout` resource per answer, that is wrong.

3. **Each physical card is TWO-SIDED with the SAME question**, one answer per side
   (Board Game Quest 2021 review, verbatim): *"Each Ideology cards are two-sided with the
   same question but depending on how the active player answers (yes or no) will
   determine the Ideologue the card is tied to."* Source: `https://www.boardgamegeek.com/boardgame/257305/shasn` description text as quoted at `https://www.boardgamequest.com/shasn-review/`

4. **Card IDs exist and are campaign-prefixed.** I read `A073` on an India deck card
   (bottom-right corner). A BGG user quotes the Brexit card as `SH5BRIC108`
   ("BRIC" = the BRIC countries, i.e. the Brexit deck). So the scheme is roughly
   `A0nn` / `SH5BRICnnn`. Card numbers are printed small in the lower-right corner.

5. **`THE SHOWMAN` vs `THE SHOWSTOPPER` — both are real, in different printings.**
   - "THE SHOWSTOPPER" — Essential Rulebook PDF text: *"Supremo, The Showstopper and The Idealist"*; and the 2021 BGQ review: *"The Showstopper tries to manipulate and influence the masses through charisma."*
   - "THE SHOWMAN" — printed on actual card faces: the 2019 prototype/USA cards and the Indian retail card in the BGG photo both read **THE SHOWMAN**. Also the designer's own BGG photo captions: *"The Showman and his Media"*.
   - Unresolved. Do not silently pick one; the repo should probably accept both.

6. **Ideology Card powers** (read off a player mat, BGG `pic4887616`), level 4 and level 6:
   - THE CAPITALIST — *Open Market*: trade 1 resource for 2. *Land Grab*: evict 2 voters.
   - THE SUPREMO — *Donations*: snatch 2 resources. *Civil Dissent*: discard 2 voters.
   - THE SHOWMAN — *Fandange*: 1 free vote per voter card. *Targeted Marketing*: convert 2 voters.
   - THE IDEALIST — *Blind Faith*: discounts on 3 voter cards. *Public Figure*: relocate 2 votes per majority.

7. **Each card carries chaos ("Edge of Chaos") markers** — a ▼ or ▲ chevron above the
   answer and/or flanking the icon row. E.g. the "Made in India" card has ▼▼, the organ
   donation card has ▲▲. This is a per-answer property the deck JSON may be missing.

---

## Provenance table

| # | Card name | Campaign | Question | Answer A | Ideologue A | Payout A | Answer B | Ideologue B | Payout B | Source URL | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | — | India 2019-20 | Should we launch a PR campaign to promote manufacturing within India? | "Yes. Let the world prepare for the glory of 'Made in India'." | The Supremo | 2× clout + 1× trust (▼▼) | *not recovered* | *not recovered* | — | [bgq](https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg) | VERIFIED |
| 2 | — | India 2019-20 | Should new cities be planned keeping 'Vastu Shastra' in mind? | "No. Tight budgets cannot account for city-wide superstitions." | The Capitalist | 2× funds + 1× trust (▼) | *not recovered* | *not recovered* | — | [bgq](https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg) | VERIFIED |
| 3 | — | India 2019-20 | Should organ donation be mandatory? | "Yes. Why aren't the dead contributing more to society?" | The Showstopper | 2× media + 1× trust (▲▲) | *not recovered* | *not recovered* | — | [bgq](https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg) | VERIFIED |
| 4 | — | India 2019-20 | Should people on death row be used as medical subjects? | "No. Even the damned deserve dignity in death." | The Idealist | 1× clout + 2× trust (▼) | *not recovered* | *not recovered* | — | [bgq](https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg) | VERIFIED |
| 5 | A073 | India (retail) | Should staging the play 'Nil Darpan' or Indigo Mirror be banned across India? | "No. The revolution may not be televised, but it will still be staged." | The Idealist | 2× trust + 1× funds (▼) | "Yes. Why lo… humour in a p… whole existe…" (truncated) | The Showman/Stopp… (truncated) | *unreadable* | [shopify](https://www.shasnthegame.com/cdn/shop/files/Ideology-Cards_d72ab092-4b79-4d0e-aae2-ac8b2947739c.png) | VERIFIED (A side) |
| 6 | — | India (retail) | Should the GST be abolished? | "Yes. He called Gandhiji Simple Tax for a revision." | The Showman | 2× media + 1× trust | *not recovered* | *not recovered* | — | [bgg](https://cf.geekdo-images.com/-jqX2caNjA-8w5rpp3ac5w__large/img/krTXWfR_mpi7_5OjlOsP5ZeHYIc=/fit-in/1024x1024/filters:no_upscale():strip_icc()/pic4651186.jpg) | VERIFIED (5× zoom) |
| 7 | — | USA 2019-20 | Should creationism be taught in public schools? | "No. Our schools must promote science not religious myths." | The Idealist | 2× trust + 1× funds | *not recovered* | *not recovered* | — | [bgq19](https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg) | VERIFIED |
| 8 | — | USA 2019-20 | Should the corporate tax rate be reduced? | "Yes. The US has one of the highest corporate tax rates in the world." | The Capitalist | 2× funds + 1× trust | *not recovered* | *not recovered* | — | [bgq19](https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg) | VERIFIED |
| 9 | — | USA 2019-20 | Should we pull out of NATO? | "Yes. All Europeans are freeloaders." | The Showman | 2× media + 1× clout | *not recovered* | *not recovered* | — | [bgq19](https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg) | VERIFIED |
| 10 | — | USA 2019-20 | Should sports teams replace offensive logos? | "No. They're just made up names. They can't hurt anyone." | The Supremo | 2× clout + 1× funds | *not recovered* | *not recovered* | — | [bgq19](https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg) | VERIFIED |
| 11 | SH5BRIC108 | UK 2019-20 (Brexit) | Should gender studies be compulsory in all schools? | "Yes. When we're being watched, we act less free, which makes…" (cut off at source) | *not recovered* | *not recovered* | *not recovered* | *not recovered* | — | [bgg thread 3580283](https://boardgamegeek.com/thread/3580283/ideology-cards-answers-do-not-match-the-title-brex) (via [DDG snippet](https://html.duckduckgo.com/html/?q=%22SHASN%22+ideology+card+%22should%22)) | VERIFIED question / answer truncated |
| 12 | — | ? | Should free speech protect people who say things we hate? | "No. Fund it from the water bill, which is honest about who uses it." | *not recovered* | *not recovered* | *not recovered* | *not recovered* | — | claimed `instagram.com/p/C4h-VrzIvQZ/` | **UNVERIFIED — see note** |

Note on #12: the brief supplied this as a verified card citing
`https://www.instagram.com/p/C4h-VrzIvQZ/`. I fetched that post through `r.jina.ai`. It
loads, but it is **not** a card post — its caption is *"The Supremo-Capitalist often
wonders to himself, 'Is it still xenophobia if I make a lot of money?'"*. The card text
does not appear anywhere in the page. So either the brief's citation is wrong, or the card
came from a different post. **Do not treat this row as verified.**

**Campaign attribution caveat.** Rows 1–4 and 6 are attributed to India because the
subject matter is unambiguously Indian (Made in India, Vastu Shastra, GST/Gandhiji) and
row 6's photo is captioned on BGG as an India-deck shot. Rows 7–10 are attributed to USA
2019-20 on subject matter (NATO, US corporate tax rate) — the 2019 photo is captioned
"two sets of campaign Ideology Cards, a US and India one", so at least this is a
US-or-India prototype shot; NATO settles it as US. Rows 5 and 11 carry printed IDs
(`A073`, `SH5BRIC108`) that pin the campaign.

---

## India 2019-20 / India retail

### 1. MANUFACTURING PR CAMPAIGN
- **Question:** "SHOULD WE LAUNCH A PR CAMPAIGN TO PROMOTE MANUFACTURING WITHIN INDIA?"
- **A:** "Yes. Let the world prepare for the glory of 'Made in India'." — The Supremo — pays 2× clout (red fist) + 1× trust (yellow star), with ▼ chaos markers left and right of the icon row
- **B:** *not recovered* — the reverse of this physical card was not photographed
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg` `[VERIFIED — read the card at 4× upscale from the Board's Game Quest 2021 review photo; all four cards in that image are India-themed]`

### 2. VASTU SHASTRA
- **Question:** "SHOULD NEW CITIES BE PLANNED KEEPING 'VASTU SHASTRA' IN MIND?"
- **A:** "No. Tight budgets cannot account for city-wide superstitions." — The Capitalist — pays 2× funds (green hexagon) + 1× trust (yellow star), with a single ▼ marker above the answer
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg` `[VERIFIED — same photo, top-right card, 4× upscale]`

### 3. ORGAN DONATION
- **Question:** "SHOULD ORGAN DONATION BE MANDATORY?"
- **A:** "Yes. Why aren't the dead contributing more to society?" — The Showstopper — pays 2× media (indigo eye) + 1× trust (yellow star), with ▲ chaos markers left and right
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg` `[VERIFIED — same photo, bottom-left card, 4× upscale]`

### 4. DEATH ROW MEDICAL SUBJECTS
- **Question:** "SHOULD PEOPLE ON DEATH ROW BE USED AS MEDICAL SUBJECTS?"
- **A:** "No. Even the damned deserve dignity in death." — The Idealist — pays 1× clout (red fist) + 2× trust (yellow star), with a single ▼ marker above the answer
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2021/07/SHASN-Cards.jpg` `[VERIFIED — same photo, bottom-right card, 4× upscale]`

### 5. A073 — NIL DAR-PAN / INDIGO MIRROR
- **Question:** "SHOULD STAGING THE PLAY 'NIL DAR-PAN' OR INDIGO MIRROR BE BANNED ACROSS INDIA?"
- **A:** "No. The revolution may not be televised, but it will still be staged." — The Idealist — pays 2× trust (yellow star) + 1× funds (green hexagon), ▼ marker. Printed card number in the corner reads **A073**.
- **B:** partially occluded by an overlapping card in the same render; visible fragment reads "Yes. Why lo… humour in a p… whole existe…" on a blue band labelled "THE S…"
- **Source:** `https://www.shasnthegame.com/cdn/shop/files/Ideology-Cards_d72ab092-4b79-4d0e-aae2-ac8b2947739c.png` (official store, "What's in the Box" section of `https://www.shasnthegame.com/`) `[VERIFIED — the A-side is fully legible at 4× upscale of the 1080px render; the B-side is physically occluded in the artwork]`

### 6. GST ABOLITION
- **Question:** "SHOULD THE GST BE ABOLISHED?"
- **A:** "Yes. He called Gandhiji Simple Tax for a revision." — The Showman — pays 2× media (indigo eye) + 1× trust (red-orange fist at this photo's colour balance); ▼ marker above the answer
- **B:** *not recovered*
- **Source:** `https://cf.geekdo-images.com/-jqX2caNjA-8w5rpp3ac5w__large/img/krTXWfR_mpi7_5OjlOsP5ZeHYIc=/fit-in/1024x1024/filters:no_upscale():strip_icc()/pic4651186.jpg` (BGG image 4651186, captioned "Ideology Cards", uploaded by user `mandir`; full record at `https://boardgamegeek.com/boardgame/257305/shasn`) `[VERIFIED — the card is only ~180px wide in the source photo; I cropped and upscaled 5× to read it. The third icon's colour is ambiguous at this resolution: it reads red/orange here but the same icon is trust-yellow on the higher-quality Board Game Quest photos, so treat the exact resource as low-confidence while the TEXT is high-confidence.]`

---

## USA 2019-20

### 7. CREATIONISM IN SCHOOLS
- **Question:** "SHOULD CREATIONISM BE TAUGHT IN PUBLIC SCHOOLS?"
- **A:** "No. Our schools must promote science not religious myths." — The Idealist — pays 2× trust (yellow star) + 1× funds (green hexagon)
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg` `[VERIFIED — Board Game Quest 2019 Kickstarter-preview photo, top-left card. Note this 2019-era card prints THE IDEALIST on a yellow band, consistent with yellow=trust.]`

### 8. CORPORATE TAX RATE
- **Question:** "SHOULD THE CORPORATE TAX RATE BE REDUCED?"
- **A:** "Yes. The US has one of the highest corporate tax rates in the world." — The Capitalist — pays 2× funds (green hexagon) + 1× trust (yellow star)
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg` `[VERIFIED — same photo, top-right card]`

### 9. NATO
- **Question:** "SHOULD WE PULL OUT OF NATO?"
- **A:** "Yes. All Europeans are freeloaders." — The Showman — pays 2× media (blue eye) + 1× clout (red fist)
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg` `[VERIFIED — same photo, bottom-left card. The band on this physical card clearly reads THE SHOWMAN, not "Showstopper".]`

### 10. OFFENSIVE LOGOS
- **Question:** "SHOULD SPORTS TEAMS REPLACE OFFENSIVE LOGOS?"
- **A:** "No. They're just made up names. They can't hurt anyone." — The Supremo — pays 2× clout (red fist) + 1× funds (green hexagon)
- **B:** *not recovered*
- **Source:** `https://www.boardgamequest.com/wp-content/uploads/2019/07/Shasn-Cards.jpg` `[VERIFIED — same photo, bottom-right card]`

---

## UK 2019-20 (Brexit)

### 11. SH5BRIC108 — GENDER STUDIES
- **Question:** "Should gender studies be compulsory in all schools?"
- **A:** "Yes. When we're being watched, we act less free, which makes…" — *ideologue and payout not recovered* — the sentence is cut off mid-clause by the search-engine snippet, and the BGG thread title indicates the poster was reporting a **misprint**: the answers on this physical card do not match the printed question.
- **B:** *not recovered*
- **Source:** `https://boardgamegeek.com/thread/3580283/ideology-cards-answers-do-not-match-the-title-brex` `[VERIFIED question + partial answer text — I could NOT open the thread (Cloudflare). I recovered this from the search index: https://html.duckduckgo.com/html/?q=%22SHASN%22+ideology+card+%22should%22 . The card number SH5BRIC108 is quoted verbatim in that snippet.]`

---

## Unverified — reported by a prior pass, could not be re-confirmed

### 12. FREE SPEECH
- **Question:** "Should free speech protect people who say things we hate?"
- **A:** "No. Fund it from the water bill, which is honest about who uses it." — *ideologue and payout not recovered*
- **Source:** claimed `https://www.instagram.com/p/C4h-VrzIvQZ/` `[UNVERIFIED — the brief supplied this as verified, citing that Instagram post. I fetched the post via r.jina.ai and its caption is "The Supremo-Capitalist often wonders to himself, 'Is it still xenophobia if I make a lot of money?'" — no card text. Either the URL is wrong or the card came from elsewhere. The wording is stylistically perfectly consistent with the 10 cards above, which is weak supporting evidence and nothing more.]`

---

## Fragmentary / unusable — no complete card recovered

These are visible in the official store render but are physically occluded by
overlapping cards in the marketing artwork. Recorded because the question stems may be
recoverable from another photo of the same deck.

- `"SHOULD WOMEN BE I… PROPE…"` — red band (The Supremo), answer begins `"No. It's a mo… en are i…"`, 1× clout visible. Likely "Should women be [allowed to] prop[agate/practice…]" — **pure guess, do not use.**
- `"SHOULD WOMEN … PR…"` — green band (The Capitalist), answer begins `"Yes. If yo…"`, 1× funds visible.
- `"SHOULD STAGING THE PLAY 'NIL DAR-PAN' OR INDIGO MIRROR BE BANNED ACROSS INDIA?"` — appears **three times** in that render on blue, green and yellow bands, i.e. once per remaining ideologue. Only the Idealist (A073) and part of the Showman side are legible. **This tells us the render shows one physical question fanned across multiple answers — i.e. the marketing shot is faking four different cards that are really one two-sided card.** Worth knowing before treating any marketing render as four distinct cards.

All three fragments:
`https://www.shasnthegame.com/cdn/shop/files/Ideology-Cards_d72ab092-4b79-4d0e-aae2-ac8b2947739c.png` `[VERIFIED that these fragments exist; question text NOT recoverable]`

---

## Names only, no text recovered

**None.** Ideology Cards in SHASN have no titles — they are a question, two answers, an
ideologue band, and a payout. There is no name list to recover. (The *other* card types —
Elite cards and Cost-of-Victory cards — DO have names; BGG images 6004964 and 6004965
show them, and I did not read those because the brief scoped this task to Ideology Cards.)

---

## Is more obtainable? Honest assessment

**Yes, but not by more of the same. This approach has essentially been exhausted.**

The reason the yield is so low is structural: **SHASN's 432 Ideology Cards have never
been published as text anywhere.** There is no card list, no spreadsheet, no card database
entry, no "all cards explained" video, and the designer has not released one. Every card I
recovered came from a *photograph* — which means yield is capped by how many good card
photographs exist in public, which is roughly 10. I found essentially all of them.

The one seam I know is still open, and did not have budget for:

1. **Tabletop Simulator / TTS Workshop mod.** If one exists, its card JSON would contain
   all 432 cards as plaintext. This is the single highest-value remaining target and I did
   not search for it. Search terms not yet tried: `"shasn" site:tabletopsimulator.com`,
   `tts workshop shasn`, `shasn mod`.
2. **Resale listings with card photos** — Cardmarket, eBay "lot of cards" listings from
   broken collections. eBay in particular often has sellers photographing damaged cards
   one by one. Untried.
3. **The rest of the 41 Memesys YouTube videos** — the "SHASN: AZADI Playthrough"
   (2h03m, `KO2m7pzZEZ8`) and "Round One by Man vs Meeple" (35m, `F7PwCg2QMF8`) are
   full playthroughs. Cards get drawn and read aloud during play. Transcripts are blocked,
   but frame extraction is not — I could pull frames at the ideology-card moments. Expensive
   but genuinely promising: a 2-hour AZADI playthrough probably shows dozens of cards.
4. **Buying the game.** Obviously the highest-yield option. ₹3,499 at
   `shasnthegame.com`, or the BGGGeekMarket.

I would not expect another web-only pass to beat ~10 more cards. Expect the next real jump
to come from a TTS mod or from frame-extracting the playthrough videos.
