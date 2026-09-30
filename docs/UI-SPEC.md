# Shasn — Visual & UX Design Specification

**Status:** draft v0.1 · **Scope:** browser client UI/UX (M4 Board UI + M3 lobby/reconnect)
**Companion docs:** `PLAN.md` (§2 blind answer, §3 stack, §7 M4), `docs/rules-reference.md`, `docs/ARCHITECTURE.md`
**This document contains no application code.** It is a spec an engineer implements against.

Conventions used throughout:

- **ASSUMED** — a value I could not measure or verify from ground truth. Verify before shipping.
- **MEASURED** — computed from the source files in `packages/engine/`.
- Any token named in `SCREAMING_SNAKE` is a CSS custom property (or an SVG presentation attribute) and must exist under that exact name in the client theme.

> **Status: COMPLETE v1.0.** Every section is filled. Colour ratios are measured, board
> geometry constants are measured from `board.generated.ts`, and the peg state matrix in §4.6
> is normative. Items that could not be measured from the repo are marked **ASSUMED** and
> collected in Appendix B.9.
>
> **Read in this order:** §2 (colour) → §1 (principles + the blind-answer symmetry contract)
> → §4.6 (peg matrix) → §5 (screens) → §6 (the two hard interactions). Everything else
> supports those.

---

## 1. Design Principles

**1. The blind answer is the product; everything else is table furniture.**
`PLAN.md:25-58` — the client must never receive a full card object. Every other principle
below yields to this. Concretely: no design decision, hover state, tooltip, colour, icon,
spacing, or animation may derive from, correlate with, or hint at which Ideologue a side
belongs to. The payout arrives as one number after commitment and nowhere else. A design
that is 5% better at everything else and leaks one bit is a failed design.

**2. The table is the interface — there is no "your screen".**
A physical Shasn table has one shared surface, and every player looks at the same 129
slots, the same market, the same log. The browser version must not fragment into per-player
dossiers. **One board, always visible, always the largest single region.** The player's mat
is a *panel beside the board*, never a modal that replaces it, because a mat-only view is a
view from which you cannot deliberate.

**3. One region of the layout is always yours; the rest is everyone's.**
Exactly one thing is highlighted at a time — the actionable region for the active player —
and it is highlighted by **chrome** (red `SEAL` frame + white mat), never by recolouring
shared state. Players who are not the active player see the same board with a "watching"
dimming on non-relevant regions. This is what makes 2–5 players legible in the same layout.

**4. Density where you deliberate, calm where you read.**
Two different visual registers, never mixed:

- **Dense** — the board, the market, the power tray, the log. Tabular numerals, tight
  leading, 4px rhythm, no decoration. This is where you compare numbers.
- **Calm** — the answer prompt, the card faces, the headline resolution. Generous margins,
  one idea per screen, no competing chrome. This is where you read prose and deliberate.

The failure mode is a uniformly dense UI in which the answer card is as loud as the log.
The answer card gets the calm register *and* the whole viewport.

**5. Playful in voice, not in chrome.**
The satire lives in the card text, the scenario copy, the Headline names, and small
diegetic touches (a stamp that tilts, a coastline drawn as a single confident line). It
does **not** live in bouncy easing, confetti, coins, gems, gradients, drop shadows on every
element, or arcade numerals. Shasn's comedy is the writing's; the UI is a well-printed
political broadsheet. If the board looked like a mobile gacha screen the satire would read
as a joke about the game instead of a joke about politics.

**6. Print, don't glow.**
The whole surface vocabulary is paper and ink on a dark table. Depth is expressed by paper
edge and a single soft shadow (0 1px 2px `rgba(20,17,16,.28)`), never by inner glow,
neon, or gradient fill. This keeps a 129-element board calm, keeps colour reserved for
ownership and legality, and is the reason the parchment surface can carry so much state.

**7. Every state change must be legible in the log, not just on the board.**
The board is a spatial encoding; the log is a linear one. Anyone who misses a flip can
read it back. Log entries are full sentences in `INK_700`, not icon-deltas — the same
information density as a rules-reference citation, because players will learn the game by
reading the log.

**8. Legibility beats density at the smallest elements; density beats decoration everywhere else.**
The 129 pegs, the four resource numerals, and the two answer labels are the three places
the game is won or lost. All three are sized and spaced for a player leaning over a shared
laptop at arm's length, not for a designer looking at a 27" monitor. Everything else may be
compact.

### 1.1 Design principles specific to this game

| Constraint from ground truth | Design consequence |
|---|---|
| Majories differ per zone: 5/9, 6/11, 9/17, 11/21 (sums to 69 of 129) | The fraction `6/11` is **printed on the board** as an object, not computed and shown. It is a rulebook element. §4.4 |
| Every zone has ≥1 Volatile Area (11 total) | Shape-only marking at rest; colour reserved for the decision moment. §2.8 |
| `RULES.resourceCap = 12` across all four pools combined | One cap numeral, one combined meter — never four separate caps. §5.4 |
| `RULES.marketSize = 3`, always refilled | The market is a fixed 3-up strip. Refills animate in place, never reflow. §7 |
| `RULES.staggeredStart` — P*n* gets *n* resources | Setup screen must show an asymmetric starting grant per seat, or it looks like a bug. §5.1 |
| `pending.sameZone` — one Voter Card's group cannot split across zones | This is a *placement-time* constraint, so the board must be able to say "these 3 go together or nowhere" without a tutorial. §6.1 |
| `gerrymanderingRights()` — most voters wins, **ties give nobody rights** | Rights must be shown as a badge on the zone, with ties rendered explicitly as "no rights" rather than omitted. §4.6 |
| Only **non-majority** voters gerrymander; Volatile never | Source and destination legality are two different rules; both must be visible before drag starts. §6.2 |
| `LogEntry.kind` has 7 values | The log is filterable by kind, and each kind has one fixed sentence template. §5.10 |
| 4–6 hour sessions, async is "survival" (`PLAN.md:266`) | Every screen is resumable from a cold load with no client-side memory of the session. §5.2 |

### 1.2 The blind answer — the rule, stated once, enforced everywhere

The answer prompt is the one screen in the product with **two surfaces that must be
provably indistinguishable in styling**. It is designed so a player cannot infer the payout
from styling, and so neither side feels like the "real" one.

**Symmetry contract.** Both answer sides use the *same token* for every visual property.
Not "similar" — the same variable, resolved to the same value.

| Property | Both sides use | Value |
|---|---|---|
| Background | `--paper-100` | `#EFE8D6` |
| Border | `--ink-300` | `#A3927A`, **2px**, all four sides, equal radius (6px) |
| Border on hover | `--seal` | `#A8341F`, 2px — and **the two sides hover independently**, so no persistent bias |
| Border on focus | `--focus-inner` + `--focus-outer` | dual-tone, identical geometry |
| Label type | `TYPE_CARD_SIDE_LABEL` | 17px / 700 / 1.35, `INK_900`, centred |
| Label max-width | 22ch | same, both sides |
| Padding | 20px 22px | same |
| Min-height | 88px | same — **content-length differences must not change box size**, so a long A and a short B are visually equal |
| Grid cell | 1fr 1fr, 16px gap, vertically centred | identical |
| Position on screen | A left, B right | ⚠️ **A is always shown second on the wire but first on screen**; see below |
| Icon | **none** | no glyph, no bullet, no radio, no chevron |
| Background tint | **none** | no `--positive`, no `--negative`, no Ideologue ink |
| Payout | **not sent** | `playerView` strips it; the client has never held the value |

**The left/right positional bias and how it is neutralised.** A card's two answers belong to
two *different* Ideologues, and card authors will not be balanced left-vs-right
mechanically. So a fixed "A is on the left" would leak. Two mitigations:

1. **Randomise the presentation order per card.** The server picks which side renders first
   (a deterministic draw from `_seed`, not `Math.random`, to keep replays stable) and sends
   `order: 'ab' | 'ba'`. The client renders `order[0]` in the left cell and `order[1]` in the
   right. **A player therefore cannot build a position-independent left/right heuristic.**
   This is the single most important line in this section.
2. The label text is sent pre-mapped, so side identity ("the Trusts' answer") is never a
   client-side lookup keyed on `A`/`B`.

**What makes both sides feel inviting and equal.** Left-defaulting a *focus* ring or a
*filled* background is the leak. Instead:

- The two cards are **one contiguous panel** (`TYPE_CARD_SCENARIO` sits above, both options
  in a single 2-col grid, one outer border, one background). They read as one question with
  two doors, not as option-one-primary and option-two-secondary.
- Neither side has a checkbox, a filled state, or a heavier border before it is chosen. The
  chosen state is *identical* on both: `SEAL` 2px border + `PAPER_050` fill + a small
  `SEAL` check glyph at 14px in the same corner on both.
- Both sides get the same **affordance** treatment on hover: border colour changes, the
  label's `text-decoration` goes to `underline` at 1px offset 2px, cursor `pointer`. The
  change is to ink and decoration, never to fill.
- The prompt's own language is symmetric: "Choose the answer you can defend" — never
  "Which do you back?" which grammar privileges a side. Copy is in `TYPE_CARD_SIDE_LABEL`,
  and neither label is a question while the other is a statement.

**What must not exist on this screen, at all:** resource icons; payout numerals; the word
*Funds/Clout/Media/Trust*; the player's manifesto colour row; any tween, count-up, shimmer,
shake, or card-flip that could resolve differently per side; any `title=` or `aria-label=`
containing a resource name; any chart, meter, or icon that correlates with value; and no
"reveal" affordance other than the Confirm button itself.

**Reveal.** Committing sends `"A"` or `"B"`. The response is the *payout only* — no
comparison, no "you could have had", no bar chart, no delta for the other side. §7.3.

## 2. Colour System

### 2.1 The surface model

Three physical surfaces, in the order they stack toward the player:

| Layer | What it is | Tokens |
|---|---|---|
| **Table** | The room. Everything outside the board — header, side panels, log rail. Dark oiled wood. | `TABLE_900` … `TABLE_600`, `TABLE_TEXT` |
| **Board** | The parchment sheet. 1000×1500 viewBox. | `PAPER_000`, `PAPER_050`, `PAPER_200` |
| **Mat / card** | Paper stock laid *on* the board: player mats, the HQ mat, all cards. | `PAPER_100` (face), `PAPER_300` (edge/shadow) |

The dark surround exists so the parchment board reads as a lit object on a table, and so
the player's own mat is never competing with the board for the eye. It also means the
board never has to carry UI chrome.

Rationale from ground truth: `rules.ts:75` — *"Chosen for contrast against the parchment
board."* The parchment surface is therefore the fixed point; every other surface is
built to sit either behind it or on it.

### 2.2 Paper / parchment ramp

| Token | Hex | Role |
|---|---|---|
| `PAPER_000` | `#FAF6EC` | Board face. The single largest surface. |
| `PAPER_050` | `#F4EFE2` | Zone polygon fill (alternating zones use `PAPER_200`). |
| `PAPER_100` | `#EFE8D6` | Card face, player mat face, HQ mat face. |
| `PAPER_200` | `#E4D9C1` | Zone polygon fill B, panel backgrounds on table. |
| `PAPER_300` | `#D6C8AB` | Card/mat edge, drop shadow source, empty-slot well fill. |
| `PAPER_400` | `#C2B190` | Printed rules on the board (coastline hatch, zone borders). |
| `PAPER_500` | `#A99775` | Faintest printed rule; decorative only, never a boundary. |

**Zone separation is not done with alternating fills.** Zone borders are drawn with
`PAPER_400` at 2px (outer zones) and the shared-edge rule is 2.5px; Central is
deliberately filled `PAPER_200` because it is an *inset*, not a peer region, and the
rules reference calls it "a small dark inset at the centre" (`rules-reference.md:51`).
Colour here is not carrying the grouping — the 1.5px `TABLE_900` gap between polygons
is. See §4.2.

### 2.3 Ink ramp

| Token | Hex | Role | On `PAPER_000` |
|---|---|---|---|
| `INK_900` | `#241C14` | Primary text, focus ring inner, glyph strokes on pegs. | **15.55** ✅ AAA |
| `INK_700` | `#4A3D2C` | Secondary text, card body, rules text. | **9.75** ✅ AAA |
| `INK_500` | `#7A6A52` | Meta / tertiary: turn counters, "Phase 2 of 3", timestamps. | **4.85** ✅ AA |
| `INK_300` | `#A3927A` | Non-text only: dividers, disabled glyph outlines, 3px rules. | 2.80 — non-text decoration only |
| `INK_150` | `#CFC2A8` | Faintest rule; drop shadows, pressed states. | 1.63 — decorative only |

**Rule:** anything a player must *read* is `INK_900` or `INK_700`. `INK_500` is the floor
for text and never goes lower. `INK_300` / `INK_150` are for surfaces and rules, not glyphs.

### 2.4 Accent / seal

| Token | Hex | Role | On `PAPER_000` |
|---|---|---|---|
| `SEAL` | `#A8341F` | The stamp red. Active-player marker, primary CTA, the "you are up" chevron. | **6.13** ✅ AA |
| `SEAL_DEEP` | `#7A2416` | Hover/pressed state of a primary CTA. | ASSUMED (≈8.5) |

`SEAL` is the *only* chroma used for chrome. Chrome is red; ownership is a seat colour;
resources are an Ideologue ink. These three never trade jobs.

### 2.5 Player seat colours

`PLAYER_COLOURS` in `rules.ts` is server-assigned and stable — it is the seat identity and
must not be re-ordered. But the printed amber does not reach 3:1 against parchment
(**2.11**, measured), which fails WCAG 1.4.11 for the peg boundary. So the client keeps the
five **identity** colours and adds a parallel set of **render** fills.

| Seat | Identity (`PLAYER_COLOURS`) | `SEAT_FILL_*` (render) | Fill vs `PAPER_000` | Nameplate text on fill |
|---|---|---|---|---|
| P1 | `#C9345A` crimson | `SEAT_FILL_1 = #C9345A` | **4.72** ✅ | `PAPER_000` (**4.72**) |
| P2 | `#2F7EC2` cobalt | `SEAT_FILL_2 = #2F7EC2` | **3.98** ✅ | `INK_900` (**3.90**) — *both below 4.5; see below* |
| P3 | `#E0A020` amber | `SEAT_FILL_3 = #B87A0C` | **3.34** ✅ | `INK_900` (**4.66**) ✅ |
| P4 | `#5F4B9B` violet | `SEAT_FILL_4 = #5F4B9B` | **6.56** ✅ | `PAPER_000` (**6.56**) ✅ |
| P5 | `#2B9D78` jade | `SEAT_FILL_5 = #2B9D78` | **3.14** ✅ | `INK_900` (**4.95**) ✅ |

Two consequences, both load-bearing:

1. **`SEAT_FILL_3` (#B87A0C) is a deliberately darkened amber.** The printed amber stays
   canonical in `rules.ts` and is used for the seat nameplate on the dark table
   (**6.73** vs `TABLE_700` ✅). Only the light-surface render is darkened. A player who
   knows the box will recognise their colour; a player with low vision will be able to see
   their pegs.
2. **Pegs never carry text.** No seat fill reaches 4.5:1 against either `PAPER_000` or
   `INK_900` uniformly, so no numeral, initial, or score may be set *on* a peg. Peg
   identity is carried by **shape + ring** (§4.5), and the only place seat text sits on a
   seat fill is the scoreboard panel, where §2.9 gives a per-seat verified pair.

### 2.6 Semantic colours

| Token | Hex | Meaning | On `PAPER_000` |
|---|---|---|---|
| `POSITIVE` | `#1F7A4D` | Resource gained, majority formed, action legal. | **4.93** ✅ AA |
| `NEGATIVE` | `#B3261E` | Resource lost, majority broken, action illegal. | **6.06** ✅ AA |
| `WARN_VOLATILE` | `#8A3B00` | Volatile-Area affordance shown *during placement only*. | **7.19** ✅ AA |
| `UNAVAIL_FILL` | `#C8BFAE` | Fill of an action you cannot currently take. | 1.69 — never a text colour |
| `UNAVAIL_INK` | `#7C7365` | Text of an unavailable action. | **4.33** ✅ AA (4.28 on `PAPER_100`) |

**`POSITIVE`/`NEGATIVE` are never the only channel.** Every resource delta renders as
`+2` / `−2` with an explicit sign glyph and a weight change (`TYPE_NUM_DELTA_GAIN`,
§3.3); every legality signal also carries a hatch or a lock glyph (§9.2). See §8.3.

**`UNAVAIL_INK` at 4.33 vs `PAPER_000` is a deliberate near-miss.** Unavailable content must
still be *readable* (the player needs to know the cost and the shortfall), so it is not
pushed below contrast; instead it is made unambiguously **unavailable by form** — hatch
fill, `cursor: not-allowed`, `aria-disabled="true"`, and a shortfall tooltip. This is the
direct inverse of the anti-pattern in §9.2.

### 2.7 The four Ideologues (identity inks)

Deliberately **not** in the player hue band. Players are chromatic identities; Ideologues
are *ink-density* identities, drawn from a desaturated near-monochrome set, so a resource
token can never be mistaken for a peg at a glance across a busy board.

| Ideologue | Resource | `IDEO_INK_*` | Flavour (rules-reference §6) |
|---|---|---|---|
| The Capitalist | Funds | `#6F5A1E` dark brass | business-friendly policy, market demand |
| The Supremo | Clout | `#5B3550` dark plum | populism, identity politics |
| The Showstopper | Media | `#2F5560` dark slate-teal | visibility, shock, outrage |
| The Idealist | Trust | `#7A3320` dark rust | intention, equity, pragmatism |

Measured on `PAPER_100` (the mat, where tokens actually live): **5.44 / 8.30 / 7.40 / 6.64** —
all ✅ AA. Measured on `PAPER_000`: 6.16 / 9.40 / 7.52 / 8.38 — all ✅.

> ⚠️ **Correction to an intuitive mapping.** Showstopper is Media/shock/outrage, which
> tempts a hot magenta or orange. Mapping it to teal looks arbitrary until you remember
> what the set is for: the four inks must sit as one family, and `SUPREMO` already owns
> the warm-plum register. Teal is the only hue left in the 200–240° band that no player
> colour occupies. Flavour is carried by the **token glyph** (§3.4), never by hue.

**Residual risk, explicitly mitigated.** `IDEO_INK_SHOWSTOPPER` (#7A3320) is a dark rust in
the same family as `SEAT_FILL_1` (crimson #C9345A), and `IDEO_INK_IDEALIST` (#2F5560) sits
near `SEAT_FILL_2` (cobalt). Mitigations, all mandatory:

1. **Resource identity is an icon, not a colour.** Every resource token, mat slot, market
   cost and log delta renders its glyph (`₹` / raised-fist / megaphone / clasped-hands)
   *before* any colour is applied. See §3.4 for the glyph set.
2. **Resource tokens never appear as flat fills.** They are 22px discs with a 2px
   `PAPER_300` ring, sitting in a fixed 4-column row on the mat. Pegs are 20px discs
   inside a 40px slot on the board. Nothing that is *not* a peg is ever 20px and flat.
3. **No resource token ever renders on the board.** Resources live on the mat, in the
   market, and in the log — never inside a zone polygon. This removes the collision surface
   entirely rather than managing it.

### 2.8 Volatile Areas — colour is deliberately *not* the channel

There are 11 Volatile Areas and every zone has at least one (`rules-reference.md:267`).
`WARN_VOLATILE` (#8A3B00) is deliberately dark enough not to be confusable with
`SEAT_FILL_3` (#B87A0C) — but on the resting board, **no volatile colour is used at all**.

| Resting-board representation | Value |
|---|---|
| Volatile slot fill | `PAPER_300` (**1.53** vs `PAPER_000`) — a visible "well", not a marker |
| Volatile indicator | A 2px `INK_900` **double ring** + a 5-point ink **asterisk** glyph, 11px, centred |
| Volatile indicator contrast | `INK_900` on `PAPER_300` = ASSUMED ≈11.5 ✅ |

Rationale: the printed board marks Volatile Areas with a symbol, and 11 of 129 slots is
~8.5% of the board. A colour wash across 11 slots would read as a mistake or as an
ownership state. Shape-only marking keeps the board calm and survives greyscale.

`WARN_VOLATILE` appears **only** in the two action-time moments where the player must be
told "this will cost you a Headline": the hover tooltip, and the placement-confirm chip.
It is never on the resting board.

### 2.9 Majority signalling (the colour channel, plus the required non-colour channel)

`rules-reference.md:173-183` — a majority forms the instant the requirement is met, and
exactly as many voters as the requirement flip symbol-side up.

| State | Zone fill tint | Zone border | Non-colour channel |
|---|---|---|---|
| No majority | `PAPER_050` / `PAPER_200` | 2px `PAPER_400` | label reads `6/11` |
| Majority held | holder's seat at **8%** alpha | **3px** `SEAT_FILL_n` + a 6px outer gap | label gets a filled **seal disc** (§4.4) and reads `● CRIMSON 6/11` |
| Majority just broken | holder's 8% tint, **cross-fading to neutral over 200ms** | 3px → 2px, `SEAT_FILL_n` → `PAPER_400` | filled seal disc → hollow ring |

The tint itself is only **1.17:1** against `PAPER_000` — i.e. **the tint carries no
information**. This is intentional and is the enforcement of the non-colour rule: the
8% wash is texture, and the actual majority signal is (a) border weight, (b) the seal disc,
(c) the flipped pegs. Remove colour entirely and a majority zone is still unmistakable.

### 2.10 Token table (single sheet)

```
/* ── Table (dark surround) ─────────────────────────────────── */
--table-900: #141110;  --table-800: #1E1A16;  --table-700: #2A241E;  --table-600: #3A322A;
--table-text: #EDE6D8;      /* 12.35 on table-700, 15.13 on table-900  ✅ */

/* ── Paper ─────────────────────────────────────────────────── */
--paper-000: #FAF6EC;  --paper-050: #F4EFE2;  --paper-100: #EFE8D6;
--paper-200: #E4D9C1;  --paper-300: #D6C8AB;  --paper-400: #C2B190;  --paper-500: #A99775;

/* ── Ink ───────────────────────────────────────────────────── */
--ink-900: #241C14;  --ink-700: #4A3D2C;  --ink-500: #7A6A52;
--ink-300: #A3927A;  --ink-150: #CFC2A8;

/* ── Chrome accent ─────────────────────────────────────────── */
--seal: #A8341F;  --seal-deep: #7A2416;

/* ── Seats (render fills; identity colours in rules.ts) ────── */
--seat-1: #C9345A;  --seat-2: #2F7EC2;  --seat-3: #B87A0C;  --seat-4: #5F4B9B;  --seat-5: #2B9D78;

/* ── Semantics ─────────────────────────────────────────────── */
--positive: #1F7A4D;  --negative: #B3261E;  --warn-volatile: #8A3B00;
--unavail-fill: #C8BFAE;  --unavail-ink: #7C7365;

/* ── Ideologues (ink family; never on the board) ───────────── */
--ideo-capitalist: #6F5A1E;   /* Funds   */
--ideo-supremo:    #5B3550;   /* Clout   */
--ideo-showstopper:#2F5560;   /* Media   */
--ideo-idealist:   #7A3320;   /* Trust   */

/* ── Focus ─────────────────────────────────────────────────── */
--focus-inner: #141110;  /* 17.41 on paper-000 ✅ */
--focus-outer: #FFFFFF;  /* ≥3.39 against every seat fill ✅ */
```

**Scoreboard seat panel** (the one place text sits on a seat fill) — pick the measured
winner per seat, verified ≥4.5:1: P1 `PAPER_000` 4.72 ✅ · P2 `SEAT_FILL_2` is 3.98/3.90 and
therefore uses a **`PAPER_000` panel with a 6px `SEAT_FILL_2` spine** instead ✅ · P3
`INK_900` 4.66 ✅ · P4 `PAPER_000` 6.56 ✅ · P5 `INK_900` 4.95 ✅.

## 3. Typography

### 3.1 Families — two, plus a system fallback

| Role token | Family | Fallback stack | Why this one |
|---|---|---|---|
| `--font-display` | **Bitter** (SIL OFL) | `Georgia, 'Iowan Old Style', 'Times New Roman', serif` | A slab-ish serif with real weight at small sizes. Carries the satirical broadsheet voice: card scenarios, Ideologue names, Headline banners. Its slightly condensed, newspaper-ish forms read as *printed matter*, not as a game. |
| `--font-numeric` | **Roboto Mono** (SIL OFL) | `ui-monospace, 'Cascadia Mono', Consolas, monospace` | Every number that changes during a turn is a tabular numeral. Turn counters, resource counts, peg tallies, zone fractions, log numerals, the scoreboard. Zero-lining across mono means a `7 → 8` does not shift the layout. |
| `--font-ui` | **Inter** (SIL OFL) | `system-ui, -apple-system, 'Segoe UI', sans-serif` | Controls, buttons, labels, tooltips, toolbars. Deliberately neutral so it never competes with the display serif. |

All three are open-licensed and self-hostable as WOFF2. **ASSUMED** — font files not yet
added to the repo; if they are not self-hosted, fall back to the stacks above and re-measure
nothing (all sizes and colours are already contrast-verified; line-heights are the thing to
re-check after a font swap, §3.6).

**Why display + numeric and not display + sans:** this game is 60 Voter Cards, 20 Conspiracy
Cards, 20 Headline Cards and 129 pegs, and the player's real task is comparing counts
("*I have 8 there, she has 6, so the gerrymander target is…*"). A proportional sans makes
those comparisons slower. Mono everywhere numbers appear costs nothing visually — it reads
as a printed tally column.

### 3.2 Scale

Base 16px. All px values are the **rendered** size at the default browser zoom on the
reference display (1440×900 desktop, board column ~62% width). The board is an SVG that
scales; the UI chrome does not.

| Token | Size / line-height | Weight | Family | Colour | Role |
|---|---|---|---|---|---|
| `TYPE_DISPLAY_XL` | 34px / 40px | 800 | display | `INK_900` | Headline card banner, game-over title |
| `TYPE_DISPLAY_L` | 26px / 32px | 800 | display | `INK_900` | Answer prompt scenario headline |
| `TYPE_DISPLAY_M` | 20px / 26px | 700 | display | `INK_900` | Voter Card / Conspiracy card title, Ideologue name on mat |
| `TYPE_CARD_SCENARIO` | 17px / 27px | 400 | display | `INK_700` | **The answer prompt body.** 27px leading = 1.59, for 4–8 lines of prose. |
| `TYPE_CARD_SIDE_LABEL` | 17px / 23px | 700 | display | `INK_900` | **The two answer labels.** 700 weight on both, `text-align: center`, 22ch max-width. |
| `TYPE_ZONE_NAME` | 15px / 18px | 700 | display | `INK_900` | Board zone name (`NORTH WEST`) — SVG `text` inside the polygon |
| `TYPE_ZONE_FRACTION` | 17px / 20px | 700 | numeric | `INK_700` | The printed `6/11` on the board |
| `TYPE_ZONE_HOLDER` | 12px / 15px | 700 | ui | holder's `SEAT_FILL_n` | `● CRIMSON` under the fraction, only when held |
| `TYPE_PEG_COUNT` | 13px / 16px | 700 | numeric | `INK_700` | Per-zone tally chip beside the fraction (`8/17`) |
| `TYPE_RESOURCE_NUM` | 24px / 26px | 700 | numeric | `INK_900` | **The four mat resource numerals.** 24px because these are the numbers you read fastest. |
| `TYPE_RESOURCE_CAP` | 12px / 14px | 700 | numeric | `INK_500` | The `/12` cap remainder |
| `TYPE_NUM_DELTA_GAIN` | 22px / 24px | 800 | numeric | `POSITIVE` | `+2` on a payout — **800 weight, plus a `+` glyph** |
| `TYPE_NUM_DELTA_LOSS` | 22px / 24px | 800 | numeric | `NEGATIVE` | `−2` — 800 weight, plus a `−` (U+2212) glyph |
| `TYPE_MKT_COST` | 14px / 18px | 700 | numeric | `INK_900` | Resource cost numerals on a market card |
| `TYPE_PEER_NUM` | 15px / 18px | 700 | numeric | `INK_700` | Another player's resource count in the trade panel |
| `TYPE_BUTTON` | 15px / 20px | 700 | ui | per state | All buttons |
| `TYPE_BUTTON_SM` | 13px / 16px | 700 | ui | per state | Secondary/inline actions |
| `TYPE_FIELD_LABEL` | 13px / 16px | 600 | ui | `INK_700` | Form labels, always `text-transform: none` — see below |
| `TYPE_LOG` | 14px / 21px | 400 | ui | `INK_700` | Log entries. 21px leading = 1.5. |
| `TYPE_LOG_META` | 11px / 14px | 700 | numeric | `INK_500` | `T7 · P2` prefix |
| `TYPE_TOOLTIP` | 13px / 18px | 500 | ui | `PAPER_000` on `TABLE_900` | Tooltips — **16.5** contrast on `TABLE_900` ✅ |
| `TYPE_A11Y_LABEL` | *visually hidden* | — | ui | — | The only text a screen reader reads from a peg. Never `display:none`. |

**`text-transform` policy.** `uppercase` is used for exactly three things: zone names on the
board (`TYPE_ZONE_NAME`, tracking `0.06em`), the eyebrow above the answer prompt
(`TYPE_DISPLAY_M` size, `INK_500`), and the seat nameplate on the scoreboard. **All
body-level UI — buttons, labels, tooltips, log — is sentence case.** A political satire
rendered in all-caps shouts, and shouting reads as a toy.

### 3.3 Numeric rules

- `font-variant-numeric: tabular-nums` on **every** `TYPE_*_NUM*` token, plus
  `font-feature-settings: "tnum" 1, "zero" 1`.
- The `+` / `−` glyph is **mandatory** on every delta and must use U+2212 MINUS SIGN, not
  a hyphen. This is the non-colour channel for `POSITIVE`/`NEGATIVE` (§2.6, §8.3).
- Zero is `0`, never `–`. A zero delta is rendered as `·` (U+00B7) in `INK_300` with
  `aria-label="no change"`, so a player can scan a market row for "which card actually
  helps me".
- Resource numerals use **leading-zero-free integers up to 99**, then thousands separators.
  The cap is 12 (`RULES.resourceCap`), so nothing on the mat exceeds two digits.
- **Every changing numeral animates its digit, not its box.** A `7 → 8` crossfades the
  glyph in place over 160ms with the container width held by tabular figures. The layout
  must never reflow because a number changed. §7.

### 3.4 Resource glyphs

Colour is never the identity channel (§2.7), so each resource has a fixed glyph. All four
are drawn as 2px-stroke SVG paths at a 20×20 viewBox, `currentColor` stroke, no fill —
same construction rules as the board glyphs (§4.5), so a token and a peg look like they
came off the same press.

| Resource | Ideologue | Glyph | Construction |
|---|---|---|---|
| Funds | Capitalist | `₹` drawn as paths | rupee: two horizontals, one diagonal, one vertical stem |
| Clout | Supremo | raised fist | rounded rect palm + four 3px knuckle arcs + thumb wedge |
| Media | Showstopper | megaphone | cone + 2px sound arcs, no sparkles (sparkles = "game-y", §9.9) |
| Trust | Idealist | clasped hands | two mirrored 4px mitten arcs overlapping |

Rendered at 18px inside the 22px token disc, 2px stroke, `stroke-linecap: round`.

### 3.5 Board SVG text

Board text is SVG `<text>` inside the 1000×1500 viewBox, so it scales with the board.
That means the *on-screen* size is `size × (renderedBoardWidth / 1000)`. At the reference
layout the board renders at **620px wide** → scale **0.62**:

| SVG role | SVG size | Rendered @620px | Rendered @1100px (desktop XL) | Floor |
|---|---|---|---|---|
| `TYPE_ZONE_NAME` | 24px | 14.9px | 26.4px | 14px |
| `TYPE_ZONE_FRACTION` | 28px | 17.4px | 30.8px | 17px |
| `TYPE_ZONE_HOLDER` | 19px | 11.8px | 20.9px | 12px |
| Peg accessibility numeral (invisible) | 11px | 6.8px | 12.1px | — (never seen; `aria-label` carries it) |

**Constraint:** the board column must never render below **500px wide** (scale 0.5). Below
that, `TYPE_ZONE_HOLDER` falls under 10px and is dropped in favour of the §4.4 seal disc
alone. Enforce with a `ResizeObserver`, not a media query — the board column width depends
on player count (§5.13), not on viewport width.

### 3.6 Legibility checks an engineer must run

1. Board column < 500px → hide `TYPE_ZONE_HOLDER`, rely on the seal disc + border weight.
2. Any font swap → re-check line-heights on `TYPE_CARD_SCENARIO` (1.59) and `TYPE_LOG`
   (1.5). Both are tuned for the display serif's x-height.
3. `TYPE_TOOLTIP` on `TABLE_900` = 16.5:1 ✅; do not move tooltips onto `PAPER_300` without
   re-measuring (`TYPE_TOOLTIP` on `PAPER_300` = ASSUMED ≈2.4 ❌ — a light tooltip on a
   light slot would fail, so tooltips are **always** dark-on-dark, never anchored-styled to
   the board).
4. Browser minimum font size: the browser may force a floor on the SVG board text. Because
   board text is decorative-adjacent (the fraction is *also* in the zone's `aria-label` and
   in the zone chip list in the side panel, §5.4), a forced minimum is acceptable.

## 4. The Board — 129 Pegs in a 1000×1500 viewBox

### 4.1 Coordinate system and layer order

`board.generated.ts` gives `BOARD_WIDTH=1000`, `BOARD_HEIGHT=1500`, a 17-point
`COASTLINE`, and per zone a `poly`, a `label` anchor, and `areas[]` of
`{ id, x, y, volatile }`. **MEASURED** facts the layout depends on:

| Fact | Value | Source |
|---|---|---|
| Total slots | **129** | counted from `board.generated.ts` |
| Volatile slots | **11** | `north_west-07 (182,312)`, `north-11 (568,450)`, `north_east-02 (651,156)`, `west-09 (222,676)`, `west-16 (149,929)`, `central-05 (459,725)`, `east-04 (822,650)`, `east-11 (730,809)`, `south_west-09 (371,1355)`, `south-11 (373,1069)`, `south_east-05 (746,1194)` |
| Slot x range | 87 → 915 | leaves ≥85 units of coast margin at the west, 85 at the east |
| Slot y range | 148 → 1408 | leaves 148 north, 92 south |
| **Minimum centre-to-centre distance** | **52.84** (`central-01` ↔ `central-05`) | **MEASURED** — the hard constraint on peg size |

The coastline polyline is a 17-point closed shape inscribed in the board edge. Draw it as a
**single 2.5px `PAPER_400` stroke** on the layer *beneath* the zone polygons, with
`stroke-linejoin: round`. Not a sea, not a gradient — a printed outline. Its job is to stop
the parchment reading as a rounded rectangle.

**Layer order (back to front), all inside one `<svg viewBox="0 0 1000 1500">`:**

| z | Layer | Notes |
|---|---|---|
| 0 | Board sheet | `<rect>` `PAPER_000`, 2px `TABLE_800` outer edge, 18px radius |
| 1 | Coastline | 2.5px `PAPER_400` |
| 2 | Zone polygons | fill `PAPER_050`, 1px `TABLE_900` **1.5-unit gap between neighbours** (see §4.2) |
| 3 | Zone majority tint | holder's seat @ 8% alpha, `mix-blend-mode: multiply` |
| 4 | Zone borders | 2px `PAPER_400` unheld; 3px `SEAT_FILL_n` held |
| 5 | Zone label block | at `ZoneSpec.label` (§4.4) |
| 6 | Slot wells | all 129 (§4.3) |
| 7 | Pegs | placed pegs only (§4.5) |
| 8 | Interaction overlays | hover, legal/illegal, selection rings (§4.7) |
| 9 | Floating chrome | volatile tooltip, gerrymander drag ghost, same-zone tether |

### 4.2 Zone grouping and separators

The physical board's grouping is carried by **geometry and gap, not fill**:

- Each `ZoneSpec.poly` is rendered inset by **1.5 units** on every edge (`stroke-linejoin:
  round`, `stroke: TABLE_900`, `stroke-width: 3`, `paint-order: stroke`). Because the
  polygons share vertices by construction (`gen-board.mjs` names shared vertices
  `N_TOP`, `N_BL`, `C_BL`, `S_BOT`, `T`, `B` …), a shared edge becomes a **3-unit dark seam
  exactly where two constituencies meet** — and nowhere else. This is why the generator
  names them, and it is the correct use of that guarantee.
- Fill alternates only to break the 6-zone ring into readable thirds:
  `north_west`, `north_east`, `south_west`, `south_east` → `PAPER_050`;
  `north`, `south` → `PAPER_100`; `west`, `east` → `PAPER_050`;
  `central` → `PAPER_200`.
  The alternation is a *texture* at 1.10:1 between `PAPER_050` and `PAPER_100` and carries no
  meaning. Grouping is the seam.
- `central` is the only zone with a **dashed 2px `PAPER_400` inner border** at 6 units
  inside its polygon, because it is the printed "inset", not a peer region.
- On hover/focus of any slot, its zone polygon fill lifts to `PAPER_100` and its border to
  2.5px `INK_500`. Only one zone lifts at a time — that is how the player learns the zone
  grouping without a tutorial.

**Adjacency affordance (used only by gerrymander).** Neighbour pairs from
`ZoneSpec.neighbours` are provably adjacent, so §6.2 draws a 4px `POSITIVE` seam between
exactly the legal pairs during a gerrymander. Illegal seams are never drawn; the remaining
slots dim instead (§4.7).

### 4.3 Slot wells — keeping 129 empty circles from becoming noise

Each of the 129 slots gets a **printed well**, because the physical board has printed slots.
The design problem is that 129 marks is a lot of ink; the solution is that the well is drawn
in the *paper* ramp, never in ink or seat colour, and it is **empty of content**.

| Element | Value |
|---|---|
| Normal well | `<circle r=17>`, `fill: none`, `stroke: PAPER_400`, **`stroke-width: 1.5`**, `stroke-dasharray: none` |
| Volatile well | `<rect x=-17 y=-17 width=34 height=34 rx=6>`, `fill: none`, `stroke: PAPER_400`, `stroke-width: 1.5`, **plus** a centred 11px `INK_900` asterisk |
| Well contrast | `PAPER_400` on `PAPER_000` = **1.95** — above the ~1.3 "barely-there" floor for a printed rule, well below the 3:1 reserved for interactive boundaries. This is the number that makes them discoverable without competing with pegs. |

Why 1.5px and not 2px: at the 500px minimum board width (scale 0.5) a 1.5-unit stroke
renders at 0.75 device px, which browsers antialias to a visible grey. A 2-unit stroke
renders at 1px and starts to read as a grid. 1.5 is the value that survives the whole scale
range.

**Discoverability without noise — three rules:**

1. **The well never changes colour while the board is idle.** All 129 wells are
   `PAPER_400` regardless of whether a slot is a legal target. Colour is spent only once a
   decision is in progress.
2. **The wells are the hit targets.** Each slot carries an invisible
   `<rect x=-24 y=-24 width=48 height=48 fill="transparent" pointer-events="all">`. Hit
   geometry (48 units) is **2.4× the visible well** (34 units), so a player's finger or
   cursor lands on the slot even when they are imprecise. **MEASURED:** 48 units × 0.62
   (reference render) = **29.8 CSS px**, and at the 500px floor = **24.0 CSS px** — exactly
   WCAG 2.1 SC **2.5.8 Target Size (Minimum)**. Adjacent hit rects cannot overlap, because
   48 < 52.84 (measured min centre distance).
3. **Only the hovered/focused zone lifts** (§4.2). 129 simultaneous highlights would be
   noise; one is a pointer.

### 4.4 The zone label block

Anchored at `ZoneSpec.label` (the `label: [x, y]` field exists for exactly this). Three
stacked elements, centred on the anchor:

```
        NORTH WEST                    ← TYPE_ZONE_NAME, 24px SVG, tracking .06em, INK_900
          6/11                        ← TYPE_ZONE_FRACTION, 28px SVG, numeric
      ● CRIMSON  ·  8/17              ← TYPE_ZONE_HOLDER 19px + tally chip
    ▔▔▔▔▔▔▔▔▔▔·▔▔▔▔▔▔▔                ← 4px progress rule, tick at the majority threshold
```

**The printed fraction.** `majority / capacity` — `6/11`, `11/21`, `5/9`, `9/17`. This is
the numerator of `rules-reference.md:33` ("Each label is `majority / capacity`") and it is
printed on the physical board, so it is a **static board element**, not a computed HUD. It
never changes colour when a majority forms. Set as `6` in `INK_900` 800 weight, `/11` in
`INK_500` 700 — so the number you must count to is the number the eye lands on.

**Progress rule.** A 4px tall, 96-unit wide rule beneath the fraction, `PAPER_300` track,
`SEAT_FILL_n` fill for `pegsOf(zone, holder)` up to `majority`, with a 2px `INK_900` **tick
mark at the majority threshold position**. Once the fill reaches the tick, the fill also
gains a 2px `INK_900` cap. This is a *non-colour* progress channel: the tick position is
readable in greyscale, and "filled to the tick" is the majority.

**Tally chip.** `8/17` = pegs filled / capacity, `TYPE_PEG_COUNT`, `INK_700`, to the right of
the fraction. Separate from the majority fraction on purpose — "how full is the zone" and
"how many do I need to take it" are different questions and merging them produces the
misread where a player thinks 8/17 means they are 8 from winning.

**Majority-held treatment** (three simultaneous channels, §2.9):

| Channel | Unheld | Held by player *n* |
|---|---|---|
| Zone fill | neutral | `SEAT_FILL_n` @ 8% multiply |
| Zone border | 2px `PAPER_400` | **3px** `SEAT_FILL_n` |
| Holder line | absent | `● CRIMSON` in `SEAT_FILL_n` |
| Label | — | filled **seal disc** (18px `SEAT_FILL_n` disc, `PAPER_000` 2px ring) **before** the name |

The seal disc is required, not decorative: it is the only element that survives greyscale
*and* is unambiguous at 12px rendered. On narrow boards where `TYPE_ZONE_HOLDER` is dropped
(§3.6), the disc is the whole signal — so the disc alone must be sufficient, and it is.

**No rights badge when tied.** `gerrymanderingRights()` returns `null` on a tie
(`state.ts:315-324`). During your own turn the zone label then adds a `⊘` glyph (12px
`INK_500`) after the tally chip with `aria-label="tied, nobody has gerrymanding rights
here"`. Explicit "nobody" beats an absent badge, which reads as "not loaded".

### 4.5 Peg visual states — construction rules

A peg is drawn from exactly three primitives so that all 129 always look like one press:

| Primitive | Spec |
|---|---|
| **Disc** | `r = 17` board units |
| **Symbol** | A `▲`-equivalent **upward chevron**, 11 units wide × 7 tall, drawn as a 2.6-unit `stroke-linecap: round` polyline (not a filled triangle — it survives at 21px rendered diameter where a filled 7px triangle mushes) |
| **Asterisk** | 6 arms × 5 units, 1.8-unit stroke, `round` caps — the Volatile marker, 11px across |

**The blank side / symbol side distinction is fill, and it is the primary channel.**
`rules-reference.md:175-176`: *"Every voter peg has a blank side and a party-symbol side.
Non-majority voters sit blank side up."*

- **Blank side up (minority)** → the peg is an **outline**. `fill: PAPER_000`
  (paper shows through, matching the printed board), `stroke: SEAT_FILL_n`, **`stroke-width: 3`**.
- **Symbol side up (majority)** → the peg is **solid**. `fill: SEAT_FILL_n`,
  `stroke: INK_900`, `stroke-width: 1.5`, plus the `PAPER_000` chevron.

Solid vs hollow is a silhouette difference, readable at 21px, in greyscale, by every kind of
colour vision. It is the single most important decision in the board spec.

**Volatile is a shape, not a colour.** Normal slots are circular wells; **Volatile slots are
rounded squares** (`34×34`, `rx=6`). This holds in every occupancy state, at every scale,
in greyscale, and never collides with a seat colour. The asterisk is additive:

| Asterisk colour | When | Measured |
|---|---|---|
| `INK_900` | well is empty, or peg is hollow (paper interior) | `INK_900` on `PAPER_000` = **15.55** ✅ |
| `PAPER_000` | peg is solid (seat fill) — min case jade | `PAPER_000` on `SEAT_FILL_5` = **3.14** ✅ non-text |

There are exactly **11** of these on the board and the shape difference means a player
learns "square = permanent" in one exposure.

### 4.6 The exhaustive peg state matrix

**Read this table as the implementation spec.** Rows are every combination of
{empty, own, other} × {minority, majority} × {normal, volatile} — all 10. Columns are every
interaction mode. Cells use the code key below; `—` means "not reachable in this mode, or
identical to the cell to its left".

**Cell code key**

| Code | Meaning |
|---|---|
| `○` | hollow: `fill PAPER_000`, `stroke SEAT_FILL_n`, **3px** |
| `●` | solid: `fill SEAT_FILL_n`, `stroke INK_900`, **1.5px**, `▲` chevron in `PAPER_000` |
| `◇` | as `○`/`●` but the *hole* is the rounded square (Volatile) + asterisk |
| `w` | well only: `stroke PAPER_400` **1.5px**, `fill none` |
| `w▪` | volatile well: rounded square `stroke PAPER_400` 1.5px + `INK_900` asterisk |
| `h` | 45° hatch overlay, `TABLE_900` @ 22%, 3-unit pitch — **the unavailable/illegal channel** |
| `d` | opacity 0.42 — the "context, not option" dim |
| `⌾` | 3px `POSITIVE` outer ring at `r=21` + `w`-equivalent lifted — **legal target** |
| `✕` | 3px `NEGATIVE` outer ring at `r=21`, `h` applied, `d` applied — **illegal target** |
| `⌾*` | `⌾` + a 4px `POSITIVE` tick in the slot's upper-right — **already-chosen this group** |
| `⟲` | 3px `SEAL` dashed ring at `r=21`, `stroke-dasharray: 4 3` — **gerrymander source selected** |
| `◈` | `⌾` + a 2px `INK_900` diagonal chevron at the disc's lower-left — **legal destination** |

| # | Occupancy | Face | Slot | **IDLE** | **PLACE legal** | **PLACE illegal** | **PLACE selected** | **GERRY src** | **GERRY dest legal** | **GERRY dest illegal** |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | empty | — | normal | `w` | `⌾` | `w` + `h` | `w` + `⌾*` | `d` + `w` | `◈` | `w` + `h` |
| 2 | empty | — | volatile | `w▪` | `⌾▪` | `w▪` + `h` | `w▪` + `⌾*` | `d` + `w▪` | `◈▪` | `w▪` + `h` |
| 3 | own | minority | normal | `○` | `○` + `⌾` | `○` + `✕` | `○` + `⌾*` | `⟲` | `○` + `◈` | `○` + `✕` |
| 4 | own | minority | volatile | `◇` | `◇` + `⌾` | `◇` + `✕` | `◇` + `⌾*` | **`◇` + `✕`** | `◇` + `✕` | `◇` + `✕` |
| 5 | own | majority | normal | `●` | `●` + `✕` | `●` + `✕` | `●` + `✕` | **`●` + `✕`** | `●` + `✕` | `●` + `✕` |
| 6 | own | majority | volatile | `●◇` | `●◇` + `✕` | `●◇` + `✕` | `●◇` + `✕` | `●◇` + `✕` | `●◇` + `✕` | `●◇` + `✕` |
| 7 | other | minority | normal | `○` | `○` + `✕` | `○` + `✕` | `○` + `✕` | `d` + `○` | `○` + `◈` | `○` + `✕` |
| 8 | other | minority | volatile | `◇` | `◇` + `✕` | `◇` + `✕` | `◇` + `✕` | `d` + `◇` | `◇` + `◈` | `◇` + `✕` |
| 9 | other | majority | normal | `●` | `●` + `✕` | `●` + `✕` | `●` + `✕` | `d` + `●` | `●` + `◈` | `●` + `✕` |
| 10 | other | majority | volatile | `●◇` | `●◇` + `✕` | `●◇` + `✕` | `●◇` + `✕` | `d` + `●◇` | `●◇` + `◈` | `●◇` + `✕` |

**Why each `✕` is there — the four legality rules, cell by cell:**

- **Rows 5–6 and 9–10 (majority pegs are never a placement target and never a gerrymander
  destination unless a power says otherwise.** `rules-reference.md:155`: *"Only
  non-majority voters may be gerrymandered (unless a card says otherwise)."* A placement
  target must also be empty. Both rules are in the engine, so the matrix mirrors them
  exactly; the UI never invents or suppresses legality.
- **Rows 4 and 6 (`own` + volatile) are `✕` in every `GERRY src` mode.** Volatile Area
  voters are permanent — *"cannot be gerrymandered, converted, moved, evicted, discarded,
  or affected in any way"* (`rules-reference.md:269-270`). This is the one place a player
  *owns* something and still cannot use it, so it gets the hatch, not just a dim.
- **Row 8 (`other` + volatile) is `◈` in `GERRY dest legal`.** `rules-reference.md:271`: you
  may place your own **or an opponent's** voter into a Volatile Area. The catch is the
  Headline it triggers (§5.9) — that is surfaced in the tooltip and the confirm chip, not
  by making the slot illegal.
- **Row 3 vs row 4 in `GERRY dest legal`.** Moving your own non-volatile voter within/into a
  slot you already occupy is legal; into a slot you occupy in a **volatile** area it is
  legal too — you simply cannot *move the existing one*, so a group of N is only placeable
  where N free non-volatile-compatible slots exist. The engine's `pending.sameZone` check
  owns that count; the UI only needs to not contradict it.

**Non-slot states that share the mode vocabulary:**

| State | Where it lives | Spec |
|---|---|---|
| `DISABLED` — the board is not your turn | Whole board | `opacity: 0.92`, all slots `tabindex="-1"`, `aria-disabled="true"` on the board group, **no** hover lift. The board must never look broken when you are waiting. |
| `UNAVAILABLE` — an action you cannot afford | The **action**, not the board | §2.6 `UNAVAIL_FILL` + 45° hatch + `UNAVAIL_INK` label + `aria-disabled="true"` + shortfall tooltip. **Never** expressed as low contrast alone. §9.2 |
| `LEGAL-NOW` — hover before a mode is chosen | Whole board | No preview. Hovering a slot with no mode active shows a read-only tooltip only (§4.7.1). |
| `SPOTLIGHT` — during a power that targets voters (Land Grab, Payback, Tough Love) | Whole board | Same matrix, but the `PLACE legal` column is used for opponent pegs instead of empty slots, and a `NEGATIVE` 3px ring replaces `POSITIVE` because these are *removals*. A power never reuses the placement ring colour. |

### 4.7 Interaction overlays

**4.7.1 Hover, board idle.** No colour change on the peg. Instead:

- The **zone** lifts (§4.2) — this is the only hover response.
- A tooltip appears after **250ms** dwell (prevents flicker on a 129-target surface),
  `TYPE_TOOLTIP`, on `TABLE_900`, `border-radius 6`, `max-width 280px`, positioned to the
  right of the slot and **flipped to the left near `x > 820`** so it never leaves the board.
- Hover highlight for the *pointer* only. `:hover` must not be the only channel.

**Tooltip content by slot state** (identical structure in every case, so it is learnable):

```
NORTH WEST · slot north-07
Empty.  North is 11/21 — you need 11 to hold it.
```
```
NORTH WEST · slot north-11
Volatile Area (rounded square). A peg here is permanent
and triggers a Headline at the end of the turn.
```
```
NORTH WEST · slot north-03
You · minority voter (blank side up). Worth 0 points.
Gerrymanderable.
```

The last line is **always present**, and reads one of: `Gerrymanderable.` /
`Permanent — Volatile Area.` / `Worth 1 point; not gerrymanderable.` This is how the
§6.2 constraints become visible without a tutorial: the rule is printed on every peg,
permanently, in the place the player is already looking.

**4.7.2 Drag ghost.** During gerrymander, the source peg lifts to `opacity 0.9`,
`scale 1.12`, and follows the cursor with a 5-unit lag (§7.2). A 2px `SEAL` tether line is
drawn from the source to the cursor. Legal destinations pulse a `POSITIVE` ring once on
mode entry — **once**, not continuously (§9.4).

**4.7.3 Same-zone tether (placement).** When a `sameZone: true` group is in progress (§6.1),
all legal slots are additionally joined to the first chosen slot by a 1.5px
`POSITIVE` @ 40% polyline, so "these go together" is a visible shape before you place the
second one. It is `pointer-events: none`.

## 5. Screen Inventory

**14 screens/states.** Every one is resumable from a cold load with no client memory, because
`PLAN.md:266` treats a 4–6 hour session as the primary survival risk.

Every screen is a *state*, not a route: it is the same shell with different regions populated,
so the board never unmounts. Only **Lobby** and **Scoreboard** replace the shell entirely.

### 5.0 The shell (all in-game screens)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR 56px  [SHASN] · Round 3 · TURN 11 · TURN ORDER ●●●●●  · [You: RIA] [⏸] │  TABLE_900
├───────────────────────────────────────┬──────────────────────────────────────┤
│                                       │  YOUR MAT          (the only red    │
│                                       │  framed region)     framed region)  │  TABLE_800
│         THE BOARD                     │  ┌──────────────────────────────┐    │
│         1000×1500 SVG                 │  │ RES 7/12  ↑2 ↓0              │    │
│         min 500px, flex-grows         │  │ ⌾ ◈ ● ◈   manifesto strip   │    │
│         max 780px                     │  │ pending voter groups         │    │
│                                       │  │ powers (L3/L5)               │    │
│                                       │  └──────────────────────────────┘    │
│                                       ├──────────────────────────────────────┤
│                                       │  HQ MAT · MARKET  ▢ ▢ ▢   CONSPIRACY │  TABLE_800
├───────────────────────────────────────┴──────────────────────────────────────┤
│ LOG RAIL 132px   T11 · RIA placed 3 voters in North → majority 11/21 ▸  (18)  │  TABLE_900
└──────────────────────────────────────────────────────────────────────────────┘
```

**Grid:** `grid-template-columns: minmax(500px, 780px) minmax(360px, 1fr)` at ≥1200px;
`grid-template-rows: 56px 1fr 132px`. Board column is `1fr` within its track and centres
itself, so at 1200px the board is 680px (scale 0.68) and at 1600px it is 780px (scale 0.78).

**The 3-region rule.** Exactly one region is `SEAL`-framed at a time:

| Screen | Framed region | Everything else |
|---|---|---|
| Answer | the answer panel (full-viewport overlay) | board + log at 0.92 |
| Actions | your mat | board + market normal |
| Placement | your mat (with the pending-group tray open) | board shows legal targets |
| Gerrymander | your mat | board enters gerry mode |
| Conspiracy / Headline | the card being resolved | board normal |
| Others (not your turn) | **nothing** — a `TABLE_600` banner instead | all normal |

### 5.1 Lobby / join — `lobby`

| | |
|---|---|
| **Purpose** | Seat selection, connection, rules orientation before commitment. |
| **Primary action** | `JOIN AS PLAYER` (per row) or `WATCH`. |
| **Without scrolling** | (1) player list 2–5 with seat colour, name, ready state; (2) `JOIN` button per row; (3) the seat you will take, or the next free seat. |

- Background: `TABLE_900`. Centre column `max-width 720px` on `PAPER_100` with a 1.5px
  `PAPER_300` edge and the 18px soft shadow — a sheet of paper on the table.
- Seat chips show the seat colour as a **6px left spine on a `PAPER_100` row**, never as a
  background fill, so the name is always `INK_900` on paper (§2.5 rule 2).
- Each seat row also shows its **starting grant**: `P3 · 3 resources to spend` —
  `RULES.staggeredStart` gives P*n* exactly *n* resources. Without this line, players read
  the asymmetry as a bug.
- A `RULES & BOARD` disclosure expands the 9 zones with their `6/11` fractions inline.
- Bottom: `COPY INVITE LINK`, `TOGGLE SPECTATOR`.
- Empty state: one seat, one human. `Waiting for players — share the link.`

### 5.2 Reconnect / resume — `reconnecting`

| | |
|---|---|
| **Purpose** | Rejoin an in-progress match after a refresh, a dropped socket, or a closed tab. |
| **Primary action** | `REJOIN MATCH` (auto-focused). |
| **Without scrolling** | (1) match identity + seat; (2) what phase you were in; (3) `REJOIN` + `LEAVE`. |

- `playerView` resends the **stripped** view. The client must not attempt to restore a
  blind-answer in progress from local storage — if the client reloads during `phase: 'answer'`,
  it re-renders the prompt with the same `labelA`/`labelB` it was given (which the server
  may have re-drawn, since `RULES.redrawCost` exists) and re-asks. **Never** cache a card.
- Connection state lives in the topbar as a 8px dot: `POSITIVE` = live, `#C4840C` = retrying
  (never `NEGATIVE` — a red dot reads as "you are in trouble", not "the network is"), with
  the attempt count in `TYPE_LOG_META`. Non-colour: the dot is a **filled circle vs a ring**.

### 5.3 Your turn — the blind answer — `answer`

**The most important screen in the product.** `PLAN.md:41` — the client receives
`{ cardId, question, labelA, labelB }` and nothing else.

| | |
|---|---|
| **Purpose** | Commit to one of two answers without knowing the payout. |
| **Primary action** | Choose a side, then `COMMIT`. |
| **Without scrolling** | (1) the full scenario text; (2) both answer labels at equal size; (3) the `COMMIT` button and the redraw offer. |

**Composition** — a **full-viewport overlay**, not a panel. The board is not dimmed into
irrelevance; it is *replaced*, because reading a political scenario while glancing at
opponents' pegs is a distraction from the deliberation this game is about.

```
                  QUESTION 04          ← eyebrow, TYPE_DISPLAY_M, INK_500, tracking .12em
        ─────────────────────────────────────────────
   A drought-hit district demands emergency water tankers
   before the harvest window closes. The supply valve is       ← TYPE_CARD_SCENARIO, 17/27
   already open, and the industrial quota is written into
   the same order.

   ┌───────────────────────┐   ┌───────────────────────┐
   │  Divert the industrial │   │ Protect the factories │
   │  supply                │   │ and absorb the cost    │
   │                        │   │                       │
   │        ANSWER A        │   │        ANSWER B        │   ← TYPE_CARD_SIDE_LABEL 17/700
   └───────────────────────┘   └───────────────────────┘
        ↑ 88px min-height, 22ch max-width, identical tokens both sides

   ┌──────────────────────────────────────────────────────┐
   │  [ REDRAW — 4 RESOURCES ]      [ COMMIT ANSWER ]      │
   └──────────────────────────────────────────────────────┘
   You must choose before the turn can continue. The payout
   is not shown until you commit.                        ← TYPE_CARD_SCENARIO, INK_500
```

**Hard constraints on this screen, restated from §1.2 as implementable assertions:**

1. Side order is **`order[0]` left, `order[1]` right** from the server; the labels are
   pre-mapped, so "A"/"B" on the wire never correspond to a fixed Ideologue.
2. Every visual property in the symmetry contract table (§1.2) is the **same CSS variable**.
   Do not "improve" one side. Any diff in computed style between the two option elements is
   a bug — **assert it in a test**: `getComputedStyle(a)` and `getComputedStyle(b)` must be
   equal on `backgroundColor`, `border`, `borderRadius`, `padding`, `minHeight`, `font`,
   `color`, `textAlign`, `maxWidth`.
3. `min-height: 88px` on both, so a 3-word side and a 12-word side are the same box.
4. Hover and selected states are **symmetric implementations** of the same class on both
   elements. No `:first-child` / `:nth-child` styling anywhere in this subtree.
5. `Redraw` costs `RULES.redrawCost = 4` resources, "any combination"
   (`rules-reference.md:106`). It opens a **resource picker modal** — four denominations,
   all-or-nothing, `CHOOSE 4`, disabled with a shortfall readout until exactly 4 are held.
   The picker shows *resource icons* because this is the player's **own** pool, not the
   card. That distinction is the whole reason §1.2's ban does not apply here.
6. Copy symmetry: the prompt line is "Choose the answer you can defend", never "Which do
   you back?" — the second is a question addressed to one option.
7. `aria-live="assertive"` on the commit result; the scenario panel is `aria-labelledby` the
   eyebrow so a screen reader reads "QUESTION 04" before the prose.
8. **The log records the answer by position, never by Ideologue**, until the turn resolves:
   `T11 · RIA answered Question 04 (B)`. After resolution the log gains the Ideologue name
   and payout — that is public per `rules-reference.md:190-191` (the card goes under the mat
   face-up once the answer is confirmed).

### 5.4 Action phase — `actions`

`rules-reference.md:112-120` — turn actions are *any number, any order, repeatable*. So this
screen is a persistent workbench, not a wizard, and it must never disable a section because
a "step" is incomplete.

| | |
|---|---|
| **Purpose** | Spend resources, place voters, trade, buy Conspiracies, gerrymander, use powers. |
| **Primary action** | *Whichever the player picks.* There is no default. |
| **Without scrolling** | (1) your four resource numerals + the combined `n/12` cap meter; (2) the three market cards with their costs and voter counts; (3) your pending voter groups and the `END TURN` button. |

**Your mat, top to bottom:**

1. **Resource strip.** Four slots: glyph + `TYPE_RESOURCE_NUM` numeral (24px) +
   `TYPE_RESOURCE_CAP` `/12`. Underneath, a **single combined cap meter** — one 8px rule,
   `PAPER_300` track, `SEAL` fill for `poolTotal/12`, with a tick at 12 and the numeral
   `7/12` at the right. One meter, because `RULES.resourceCap` is a *combined* cap
   (`rules.ts:11-15`: *"the rulebook says you must choose what to discard, which only makes
   sense for a combined cap"*).
   **At 10/12 the meter fill turns `WARN_VOLATILE`** and the label reads
   `Over cap after your next gain — you must discard` — a warning, not a block, because the
   discard is only forced on crossing 12.
2. **Manifesto strip.** One row of 4 Ideologue cells: the Ideologue ink colour as a 4px
   underline, `TYPE_RESOURCE_NUM` count, and a lock state —
   `< 3` plain; `= 3` a **filled** chip reading `L3`; `= 5` a **filled** chip reading `L5`.
   Below 3 the cell also shows `+1 / turn in 1 more`. This is the passive-bonus forecast
   (`RULES.passiveBonusPer = 2`, `rules-reference.md:194`) and it is the main strategic
   read on the mat.
3. **Pending voter groups.** See §6.1.
4. **Powers tray.** The 4 Ideologue powers at their unlocked level, each a 1-line button
   with a `n/m` use counter (`RULES.prospectingPerTurn` etc.). Locked powers render as a
   hatch-filled `UNAVAIL_FILL` chip with `Unlocks at 3 Capitalist cards` — **hatched and
   labelled, not merely faded** (§9.2).
5. **Conspiracies held.** Your hand, face-down count + face-up if already used.

**HQ mat strip.** Three `MarketSlot`s (`{cardId, cost, voters}`), always exactly three
(`RULES.marketSize`). Each card: 78×104px on `PAPER_100`, the resource cost as four
glyph+numeral pairs in `TYPE_MKT_COST`, and a big voter count in `TYPE_RESOURCE_NUM`. Click
opens the **cost picker** — the same four-denomination all-or-nothing widget as the redraw
picker, so the player learns it once. Unaffordable cards are `UNAVAIL_FILL` + hatch + the
cost numerals in `UNAVAIL_INK` with a `−2 Clout short` line.

**`END TURN` is always visible, bottom-right, `SEAL`, 120×44px.** It is never the only
enabled button and never auto-highlighted — ending a turn is a decision, not a default.

### 5.5 Placing voters — `actions` + placement mode

| | |
|---|---|
| **Purpose** | Choose which slots receive a pending group. |
| **Primary action** | Select N legal slots, then `CONFIRM PLACEMENT`. |
| **Without scrolling** | (1) the pending group card showing `3 voters · must stay in one zone`; (2) the counter `1 of 3 placed`; (3) `CONFIRM` / `UNDO`. |

Full interaction in §6.1. The visible parts: a **placement bar** docked at the bottom of the
board column, `PAPER_100` with a 2px `SEAL` top edge, containing the group card, the
counter, the constraint line, and `CONFIRM` / `UNDO`.

**Same-zone constraint feedback** (the specific ask):

- **First pick** → the engine marks the zone. Its polygon border goes 3px `POSITIVE` and its
  label gets a `ONE ZONE` badge (11px, `POSITIVE`, `TYPE_ZONE_HOLDER` size). All slots
  outside that zone go to cell `PLACE illegal` (`w` + hatch).
- **A hovered legal slot inside the zone** shows a counter near the cursor: `North has 8
  free slots · 2 more needed`. Free-slot counts are shown per zone in the placement bar as
  a 9-cell strip (one per zone, `PAPER_300`, `SEAL` fill = your picks so far), so the
  same-zone rule is legible as *arithmetic* before it is legible as a rule.
- **The one irreversible thing gets a confirmation.** `CONFIRM PLACEMENT` is required
  because placement is the only turn action with no undo in the engine. §6.1.4.

### 5.6 Gerrymander drag — `actions` + gerry mode

| | |
|---|---|
| **Purpose** | Move one of your non-majority voters to/from/within an adjacent zone. |
| **Primary action** | Drag an eligible peg to a legal slot. |
| **Without scrolling** | (1) which zones you hold rights in (badge per zone); (2) the move budget `1 of 1 this zone`; (3) the source/destination legality line. |

`rules-reference.md:253-261` — rights go to whoever has **strictly more** voters in a zone
(ties → nobody); the move is **into, out of, or between-adjacent**; only **non-majority**
voters move; and *you may gerrymander **any player's** voters, including your own*.

Entering gerry mode from the mat's `GERRYMANDER` button:

1. All 129 slots resolve against the matrix's `GERRY src` / `GERRY dest legal` columns.
2. Zones where you hold rights get a **`⚑ RIGHTS` badge** in `SEAL` on the zone label. Zones
   where you don't get `⊘ NO RIGHTS` in `INK_500`. **Both are shown** — an absent badge is
   ambiguous (§4.4).
3. Your non-majority, non-volatile pegs get the dashed `⟲` ring on hover and gain
   `cursor: grab`. Everything else hatches.
4. The move counter reads `1 of 1 · North` (`RULES.gerrymandersPerZone = 1`), or
   `1 of 2` everywhere under Showstopper L5 Election Fever
   (`RULES.gerrymandersPerZoneWithFever = 2`).
5. **The whole legality rule is in one always-visible strip** under the board:

   > Move one voter. From: any voter you own that is **not** a majority voter and **not** in
   > a square slot. To: an empty slot in your zone, an adjacent zone, or elsewhere — but you
   > cannot move your only voter out of the zone whose rights you are using.

That last sentence is `rules-reference.md:260-261` verbatim in player language. It is
printed, not linked to a tutorial, because the "only voter" rule is the one players
discover by breaking it.

### 5.7 Trading offer — `actions` + trade modal

| | |
|---|---|
| **Purpose** | Exchange resources and Conspiracy Cards with another player. |
| **Primary action** | `PROPOSE TRADE`. |
| **Without scrolling** | (1) both sides' resource tallies; (2) your `n/12` cap headroom; (3) `SEND OFFER`. |

`rules-reference.md:141-143`: any ratio, **at least 1 resource exchanged by both parties**,
at least one party must be the active player. Ideology Cards cannot be traded.

A **split-screen offer**: `YOU GIVE` / `YOU GET`, each a four-slot row plus a Conspiracy
slot. Live validity line under the two rows:

> Both sides must give at least 1 resource — *add 1 to your side* · You have 2 headroom under
> the cap — *remove 1*

The `SEND OFFER` button is `UNAVAIL_FILL` + hatch + `aria-disabled` until valid, with the
shortfall in the line above it — the reason is always adjacent to the disabled control.

The responder's view is the same component with `ACCEPT` / `DECLINE`. An offer has a **90s
timer** (ASSUMED) rendered as a 3px depleting rule plus `mm:ss` in `TYPE_LOG_META`; on
expiry it resolves as decline and the log says so. Async support requires it
(`PLAN.md:266`).

### 5.8 Power use — `actions` + power

| | |
|---|---|
| **Purpose** | Use one of the 8 Ideologue powers. |
| **Primary action** | The power's own flow. |
| **Without scrolling** | (1) the power's cost; (2) the use counter `1 of 2 used`; (3) `CONFIRM`. |

Three shapes, one shell:

| Power | Target | Cost | Board mode |
|---|---|---|---|
| Prospecting (Cap L3) | none — pure gain | 1 resource → up to 2 | none; resource picker |
| Land Grab (Cap L5) | **any** peg incl. majority | free, ×3 | `SPOTLIGHT` (§4.7.3) — **removal**, so `NEGATIVE` rings |
| Donations (Sup L3) | a player | free, ×2 | player picker, not the board |
| Payback (Sup L5) | an opponent's peg | 1 resource, ×2 | `SPOTLIGHT`, excludes own pegs |
| Going Viral (Show L3) | a Voter Card | free, ×2 | market card picker |
| Election Fever (Show L5) | a mode, not a target | free | sets the gerry budget, no board |
| Helping Hands (Ide L3) | a purchase | 2 discounts | consumed at the next purchase |
| Tough Love (Ide L5) | 2 opponent pegs, **same player, same zone** | 2 Trust + any 2, ×1 | two-stage `SPOTLIGHT`; illegal after the first pick greys out and hatches |

The cost row is always `TYPE_NUM_DELTA_LOSS` glyph+numeral, never a colour change. Powers at
`0/m` uses are `UNAVAIL_FILL` + hatch with `USED — resets next turn`.

### 5.9 Conspiracy purchase & Headline resolution

Two screens because the rules give Conspiracies two windows
(`rules-reference.md:283`: during your turn **and** out-of-turn immediately before an
opponent answers).

**9a — Conspiracy purchase** (`actions` or the out-of-turn banner)

| | |
|---|---|
| **Primary action** | `BUY — ANY 4 RESOURCES` / `BUY — ANY 5`. |
| **Without scrolling** | (1) the printed back-cost; (2) remaining deck count; (3) the buy button + the picker. |

Only `state.conspiracyTopCost` is purchasable (`state.ts:228`, `rules-reference.md:281`), and
the cost is printed on the card back so it is public. The cost is a **count**, not a
combination — "any 4 resources". After purchase the card flips face-up in your hand and
reads. Out-of-turn purchases raise a `SEAL` banner at the top of the board during another
player's answer: *"Before RIA answers — you may play a Conspiracy Card."*

**9b — Headline resolution** (`headlines` phase, modal, full-viewport)

| | |
|---|---|
| **Purpose** | Resolve one Headline per Volatile-Area placement, in placement order (`rules-reference.md:272-273`). |
| **Primary action** | The Headline's own resolution. |
| **Without scrolling** | (1) the Headline name in `TYPE_DISPLAY_L`; (2) its body in `TYPE_CARD_SCENARIO`; (3) the `RESOLVE` button and the queue position `Headline 2 of 3`. |

The queue is a `PAPER_300` strip of `N` pips at the top, filled for resolved. Each Headline
opens with a 300ms `scale 0.96 → 1` + fade (§7.2) — a newspaper hitting the table, not a
card flip. Choices (`Choice.kind`: `gain-any`, `lose-any`, `steal-any`, `evict-voter`,
`discard-voter`, `convert-voter`) render as a picker over the **same** four-resource widget.
`state.headlineQueue` and `state.activeHeadline` already model the queue
(`state.ts:231-234`); the UI just renders it in array order.

### 5.10 End of game — scoreboard — `finished`

| | |
|---|---|
| **Purpose** | Show the result and make the game arguable. |
| **Primary action** | `NEW MATCH` / `VIEW BOARD` / `EXPORT LOG`. |
| **Without scrolling** | (1) every seat's majority-voter score, ranked; (2) the winner's zone map; (3) the tie rule. |

`board.ts:123-133` — the score **is** the count of majority voters; `winners()` returns all
seats tied at the top. Game end is `allMajoritiesFormed()` (a majority in all 9 zones) or
`boardFull()`, which sets `finalRoundFrom` (`state.ts:240-242`) — everyone gets one more
turn, starting with whoever filled the last slot. **That rule is stated on this screen**,
because a player who filled the board and then lost will otherwise think it was rigged.

Layout: a `PAPER_100` sheet, `max-width 860px`. One row per seat:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▌ 1   RIA                                    41 majority voters         │  ← TYPE_DISPLAY_L
│         ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▔▔▔  / 69 possible       │
│         won 5 of 9 constituencies · held North, Central, South East     │
└────────────────────────────────────────────────────────────────────────┘
```

The bar is a **single 12px rule** with a 2px `INK_900` tick at the winning score, so ties
are visible as equal-length bars rather than as a number with no context. A **miniature
board** (the same 1000×1500 SVG at 200px wide, `aria-hidden`, decorative) sits beside it
showing which of the 9 zones each top-2 seat held — the whole 4-hour game in one glance.
Ties: `BOTHBROWN & RIA TIE AT 38` with both seats in a shared winner row and the tie rule
(`board.ts:129`) printed beneath. No crown, no confetti (§9.9).

### 5.11 Spectator mode — `spectate`

| | |
|---|---|
| **Purpose** | Watch without a seat. |
| **Primary action** | none — no `SEAL` frame anywhere. |
| **Without scrolling** | (1) the board; (2) the full log; (3) the active player's mat, read-only. |

Spectators see the board, the HQ market, every player's mat in read-only form, and the full
log. What they do **not** see:

- Any in-flight answer prompt — a spectator sees `RIA is answering Question 04…`, never
  the scenario or the labels. Not because it is stylistically nicer, but because the
  scenario is public-after-commit anyway and leaking it early lets a spectator coach.
- Other players' pending decisions (`state.choices` filtered to `activePlayer`).

The distinguishing treatment is absence, not chrome: no seat chip, no `YOUR MAT` heading,
the mat panel labelled `RIA'S MAT — READ ONLY`. The absence of a red frame is the signal.

### 5.12 Log rail — every screen

Not a screen; a region present in 12 of 14. `LogEntry`
(`{ turn, player, text, kind }`, kinds: `answer | voters | majority | gerrymander | power |
card | system`).

- Fixed `132px`, newest at the **top**, auto-scrolled, `overflow-y: auto`.
- Each entry: `TYPE_LOG_META` prefix (`T11 · RIA`), `TYPE_LOG` body in `INK_700`.
- A 4px `SEAT_FILL_n` left spine for player entries; `INK_300` for `system`.
- Filter chips by `kind`, 7 of them, `TYPE_BUTTON_SM`, single-select + `ALL`. Persisted in
  `localStorage` per player (this is UI preference, not game state — nothing secret is
  cached, §5.2).
- Entry templates are **full sentences**, e.g.
  `placed 3 voters in North — North is now held by RIA (11/21)`,
  `answered Question 04 (B) — Manifesto: Idealist, +2 Trust`.
- Clicking an entry that names a zone **focuses and briefly highlights that zone** (300ms
  `PAPER_100` fill, §7.2). The log is the only linear record of the game; making it a
  navigation surface is how a player catches up after an async gap.

### 5.13 Responsive — phone and tablet

A physical game is passed around a table, so the phone case is not an afterthought.

| Viewport | Layout |
|---|---|
| **≥1200px** | The shell above. Board 500–780px. Mat + HQ mat in the right column. |
| **900–1199px** | Right column narrows to 340px; log rail collapses to a 44px tab that opens an overlay. Board gets the extra width. |
| **600–899px (tablet portrait)** | Single column, **stacked**: board on top at `min(100vw − 32px, 560px)`, mat below. Board column 500px floor is **waived** to 480px here (§3.6). Log becomes a bottom sheet, 40vh, drag-to-expand. |
| **<600px (phone)** | Single column: board `100vw` wide (scale ≈0.37), mat below, bottom tab bar with 4 tabs: **Board · Mat · Market · Log**. The answer prompt becomes a **full-screen takeover with no dismiss** — there is nothing else to see and the swap is the mechanic. |

**Tablet-specific rules:**

- **Rotate-to-landscape is not required**, but the answer prompt *is* offered a
  "keep the board visible" split at ≥700px wide: prompt in the lower 45%, board at 55%
  opacity above. It is opt-in and defaults off, because §1 principle 4 says the answer gets
  the calm register — a player who can see the board during the answer is a player
  deliberating with the peg counts.
- **Touch targets on the board**: 48 board units at 480px render = **23px** — just under
  SC 2.5.8. On coarse pointers (`@media (pointer: coarse)`) the hit rect grows to **56
  units** with the priority rules below. 56 > 52.84 min centre distance, so adjacent hit
  rects *can* overlap by 3 units; resolve with this precedence:
  1. the slot **under the finger's exact point**,
  2. otherwise the nearest centre within 28 units,
  3. otherwise no target.
- **The mat is never below the fold on tablet in landscape** (`≥900×600`): it is the right
  column, not the bottom stack.

**Phone-specific rules:**

- The bottom tab bar is `56px`, `TABLE_900`, `PAPER_300` top edge, 4 items at 44×44 each.
- The mat is a **scrollable stack of its 5 regions** (§5.4), each with a sticky header, so a
  thumb can reach the resource strip and the pending groups without a pinch.
- `END TURN` is a **persistent 48px bar pinned above the tab bar**, always visible from any
  tab during your turn. It is the one control that must never require a scroll on a phone.
- No drag-only interaction anywhere. **Gerrymandering is tap-source → tap-destination**,
  with the drag ghost used only as a *preview* on devices that support `pointerType === 'mouse'`.
  Tap-source sets `⟲` on the peg and reveals the legal destinations; tap-destination commits.
  Same matrix, same confirm-before-commit (the drop *is* the confirm for a 1-voter move,
  but a `CONFIRM MOVE` bar still appears with a 4s auto-dismiss so an accidental tap is
  recoverable).

## 6. Interaction Spec — Placing Voters & Gerrymandering

### 6.1 Placing a pending voter group

**The state.** `PlayerState.pending` is `PendingVoters[]` = `{ id, count, sameZone, source }`
(`state.ts:119-125`). Two facts drive the whole interaction:

- `sameZone: true` for voters from a **single Voter Card** — *"voters from a single Voter Card
  cannot be split across zones"* (`rules-reference.md:164`).
- A group is **discarded at the end of the turn it was created in** (`state.ts:113-117`).
  So placement is not optional and not deferrable.

**6.1.1 Entry.** The mat's pending-groups tray lists each group as a 96×64 chip on
`PAPER_100`: a `◈` voter glyph, the count in `TYPE_RESOURCE_NUM`, the `source` string in
`TYPE_LOG_META` (`Voter Card`, `Eviction`, `Headline 2`, `Conspiracy`), and — only when
`sameZone` — a `ONE ZONE` badge in `POSITIVE` at 11px.

Clicking a chip enters placement mode with that group. Multiple groups may be in flight;
they are placed **one at a time**, and the tray shows `2 groups left to place` so the
end-of-turn discard is never a surprise.

**6.1.2 Selection loop.**

1. Mode entry resolves all 129 slots against the matrix's `PLACE legal` /
   `PLACE illegal` columns. Legal = **empty** (rows 1–2) and, if `sameZone`, inside the
   not-yet-chosen zone.
2. **First click.** The slot gets `⌾*`. The engine returns the zone's free-slot count; the
   placement bar prints:
   > `3 voters · must stay in one zone` · `1 of 3 placed` ·
   > **North** — 8 free slots, 2 more needed here
   The zone border goes 3px `POSITIVE` and its label gains a `ONE ZONE` badge. Every slot
   outside North drops to `w` + hatch. **The constraint is now visible as board state, not
   as text in a help panel.**
3. **Second and third clicks.** Legal slots are restricted to the locked zone. Each pick
   draws a 1.5px `POSITIVE` @ 40% polyline from the first pick (§4.7.3) so the group is a
   visible shape. The counter increments. Hovering a legal slot previews the post-pick
   zone label (does the majority form? see §6.1.5).
4. **Illegal click.** No state change. The clicked slot flashes its `✕` ring twice
   (2 × 90ms, §7.2) and the placement bar's constraint line turns `NEGATIVE` for 1.2s with
   the specific reason — `Already occupied` / `Different zone — these voters must share
   one` / `North has only 1 free slot and you need 2 more`. **A refusal always names its
   reason.** This is the difference between a constraint and a puzzle.
5. **`CONFIRM PLACEMENT`** enables when `picks.length === group.count` **and** every pick is
   legal. `UNDO` (or `Backspace`) removes the most recent pick and re-enables the full legal
   set *inside the locked zone* if the zone lock should be released — **`Undo` with 0 picks
   left releases the zone lock**, because that is the only way to change your mind about
   which zone.

**6.1.3 What the UI must not do.** It must not auto-place, must not suggest a zone (that
would remove the decision), must not allow a partial placement to be confirmed, and must not
optimise majority formation behind the player's back.

**6.1.4 Why confirm-before-commit matters here specifically.** Four reasons, in order of
weight:

1. **There is no engine-level undo.** Placement writes `Area.peg` and triggers `recount()`.
   A majority formed by the placement is *formed* — breaking it requires a power that costs
   a turn (`Land Grab` to evict your own voter, `Payback` to discard it). An accidental click
   is therefore not a 5-second mistake; it is a resource cost.
2. **The same-zone lock makes the first pick the whole decision.** After pick 1, the legal
   set collapses to one zone. The player has 21 candidate zones and one irreversible fork; a
   single click determines it. Confirmation is where they look.
3. **Volatile Areas carry a Headline.** Landing a voter in one of the 11 square slots queues
   a Headline resolved at end of turn (`state.headlineQueue`, `state.ts:231-233`) that may
   cost resources or voters. Picking a square slot by accident is a real loss.
4. **A majority may form.** `recount()` flips pegs the instant the requirement is met
   (`board.ts:56-87`). That is the single most consequential state transition in the game
   and it happens *inside* the click that caused it. The confirm step lets the player see
   "this will give you North" before it is true.

**Confirmation affordance, concrete:** the `CONFIRM PLACEMENT` button's label is not
generic. It is **`PLACE 3 IN NORTH`** — the count and the zone, so the confirm is a
statement of what will happen. Hovering it shows a `PAPER_100` popover, 240px, listing the
three target `areaId`s and, in `POSITIVE`/`NEGATIVE`, the resulting consequence:
`North: 8 → 11. MAJORITY FORMS (+11 points)` or `North: 8 → 11. No majority.`
If any pick lands in a Volatile Area, the popover gains a `WARN_VOLATILE` line:
`⚑ 1 Volatile Area — triggers a Headline at end of turn`. **The consequence is spelled out
before the click, because after the click it is history.**

**6.1.5 Majority preview is allowed and encouraged** — but only *before* commit, computed
client-side from `pegsOf` + `zone.majority`, never from a payout, and rendered as text.
This is not the blind answer mechanic and must never be confused with it.

### 6.2 Gerrymandering

**The five rules, from `rules-reference.md:249-261` and `gerrymanderingRights()`
(`state.ts:306-325`).** Every one of these must be visible without a tutorial:

| # | Rule | Where the player sees it |
|---|---|---|
| G1 | Rights in a zone go to whoever has **strictly more** voters there; **ties give nobody rights**. | `⚑ RIGHTS` / `⊘ NO RIGHTS` badge on **every** zone label during the mode (§5.6). Both states shown; absence is never the signal. |
| G2 | Rights give **1 voter per turn per zone** (`RULES.gerrymandersPerZone`), or **2** under Election Fever. | The move counter `1 of 1 · North` in the mode strip; the number is per-zone and live. |
| G3 | Only **non-majority** voters move (unless a card says otherwise). | Every majority peg is hatched in `GERRY src` (matrix rows 5, 6, 9, 10). Solid pegs cannot be picked; hollow ones can. **The silhouette teaches it.** |
| G4 | **Volatile Area voters cannot be moved.** Ever. | Every rounded-square slot is hatched in `GERRY src` (matrix rows 4, 6). The square shape is the reminder. |
| G5 | The move is **into your zone, out of it, or between it and an adjacent zone** — and you may not move **your only voter out of the zone whose rights you are using**. | Legal destinations are ringed `POSITIVE` with `◈`; illegal ones hatch. Rule 5's last clause gets its own line in the always-visible strip (§5.6), because it is the one that surprises. |

Plus one that surprises people and must be stated: **you may gerrymander any player's
voters, including your own** (`rules-reference.md:256`) — so "Gerrymandering" is a tool for
*fixing* your own board as much as attacking. The mode strip says so:
`Your voters and theirs both move.`

**Interaction rules, concretely.**

| Step | Rule |
|---|---|
| **Enter** | Click `GERRYMANDER` on the mat. Board enters gerry mode. Source-legality rings are **not** yet applied — no peg changes appearance on entry, which would make the board flash on a mode toggle. Only the mode strip and zone badges appear. |
| **Arm (hover)** | Hovering any peg resolves `GERRY src` for that peg only. If eligible: 3px `SEAL` dashed ring `⟲`, `cursor: grab`, tooltip's last line reads `Gerrymanderable — drag to an empty slot.` If not: 3px `NEGATIVE` ring `✕` + hatch, `cursor: not-allowed`, tooltip reads one of `Majority voters do not move.` / `Permanent — Volatile Area.` / `You have no Gerrymanding Rights in North.` |
| **Pick up** | `pointerdown` on an eligible peg. Ghost lifts (`scale 1.12`, 5-unit lag). **Legal destinations resolve now** (rows → `◈` / `✕`). The 4px `POSITIVE` seams appear on exactly the legal zone pairs from `ZoneSpec.neighbours`. Each legal zone's ring pulses `POSITIVE` **once** over 180ms. |
| **Drag** | No commit on drag-over. The ghost follows; the hovered destination shows its `◈` ring at full strength. A `POSITIVE` tether line runs source → cursor. |
| **Drop on legal** | A `CONFIRM MOVE` bar slides up from the board's bottom edge: `Move 1 voter · RIA · North → West · 1 of 1 used`, with `CONFIRM` / `CANCEL`. **4s auto-dismiss** to `CANCEL` on touch (§5.13); no auto-dismiss on pointer devices, where `Esc` cancels. |
| **Drop on illegal / outside** | Nothing happens. The ghost returns to the source in 160ms. No error toast — the hatch already said no, and the matrix already made it impossible. |
| **Drop on a slot you occupy with your own voter** | Not a "swap". The engine's rule is a *move*, so an occupied destination is illegal; hatch it. |
| **Confirm** | Ghost cross-fades into the destination disc over 200ms. Both source and destination zones re-count; if a majority changes, §7.1 fires. The move counter decrements and the mode **exits automatically at 0 uses** — an empty gerrymander affordance is a trap. |
| **Cancel** | `Esc`, the `CANCEL` button, or the auto-dismiss. Everything restores in 160ms. |

**Which pegs are sources.** The mode's *source* eligibility is `owner === you AND
majority === false AND volatile === false`. Not "the most voters", not "one per zone" — one
move, from any of your eligible pegs. The player chooses freely which; there is no
disambiguation prompt.

**On touch devices** (§5.13) the same flow is tap → tap: `pointerdown` on an eligible peg
sets `⟲` and reveals destinations without a ghost; the second tap on a `◈` destination
raises the same `CONFIRM MOVE` bar. The ghost is a mouse affordance only.

**No tutorial, by construction.** Each of G1–G5 is bound to a *visual property of the board*
(badge, counter, silhouette, square, ring) plus one line in a permanent strip. A player who
reads only the board has all five. A player who reads only the strip has all five. Neither
requires opening a help panel, and none of the five are discoverable only by trial and error.

## 7. Feedback & Motion

### 7.1 Motion principles

- **Duration is a function of distance from the eye, not importance.** The board is large and
  peripheral; a majority forming is 8 board units away and must be felt, not watched. The
  answer payout is 400px away and centred — it must be *read*. That is why they get opposite
  treatments (§7.3).
- **Nothing animates twice.** Every transition fires once per state change. There are no
  loops, no pulses, no shimmer, no attention-seeking repeats anywhere in the product (§9.4).
- **Easing: `cubic-bezier(.2, 0, 0, 1)`** for anything entering or moving on the board
  (fast-out, decisive settle). **`cubic-bezier(.4, 0, .2, 1)`** for anything entering or
  leaving a panel. **Linear** for progress and depletion rules only. **No** bounce, no
  overshoot, no spring — printed matter does not bounce (§9.9).
- **Every duration below has a reduced-motion counterpart** that changes the *transform*,
  never the *information*. See §7.5 and §8.5.

### 7.2 Duration table

| Event | Property | Duration | Easing | Notes |
|---|---|---|---|---|
| Zone hover lift | `fill`, `stroke-width` | **90ms** | `.2,0,0,1` | Fast enough to feel like a cursor, not a transition |
| Slot hover well | none | — | — | Wells do not change on hover (§4.7.1) |
| Tooltip appear | `opacity`, `translateY 4→0` | **120ms** after **250ms** dwell | `.4,0,.2,1` | Dwell prevents flicker on 129 targets |
| Tooltip dismiss | `opacity` | **80ms** | linear | |
| Peg placed | `opacity 0→1`, `scale .7→1` | **180ms** | `.2,0,0,1` | **Plus a 1px `INK_900` outline flash at 0.7 alpha → 0 over 260ms** — a press landing |
| Peg removed / evicted | `opacity 1→0`, `scale 1→.7` | **140ms** | `.2,0,0,1` | Fast. Removal should feel cheap, because it usually was. |
| **Majority FORMED** | see §7.2.1 | **520ms** total | | The signature event |
| Majority broken | see §7.2.2 | **300ms** | | |
| Numeral change (any) | digit crossfade | **160ms** | linear | Container width held by `tabular-nums` (§3.3) |
| Resource token gained | `scale 1→1.18→1`, token `PAPER_300` flash | **260ms** | `.2,0,0,1` | Two-stage, no glow |
| Resource token lost | `translateY 0→6` + fade, `NEGATIVE` numeral | **220ms** | `.2,0,0,1` | Token falls *off* the mat |
| Cap meter fill | `width` | **200ms** | linear | Linear because it is a measurement |
| Market card replaced | outgoing `translateY 0→−16` + fade 120ms; incoming `translateY 16→0` + fade 160ms, **120ms overlap** | **280ms** | `.4,0,.2,1` | Cards **refill in place**; the strip never reflows (§5.4) |
| Pending-group chip added | `scale .8→1` + fade | **160ms** | `.2,0,0,1` | |
| Placement legal-ring pulse | `r` 19→22→19, `opacity` | **180ms, ONCE** on mode entry | `.2,0,0,1` | Once. Never a loop. |
| Illegal click refusal | `✕` ring flashes ×2 | **2 × 90ms** | linear | Then the reason line goes `NEGATIVE` for 1200ms |
| Gerry ghost lift | `scale 1→1.12` | **120ms** | `.2,0,0,1` | |
| Gerry ghost follow | `translate` | **5-unit exponential lag, ~90ms settle** | — | Lag, not lerp-to-cursor, so the drag has weight |
| Gerry ghost return / cancel | `translate` + `opacity` | **160ms** | `.2,0,0,1` | |
| Gerry move commit | ghost crossfade into disc | **200ms** | `.2,0,0,1` | |
| Zone "flash from log" | `fill` neutral→`PAPER_100`→neutral | **300ms** | `.4,0,.2,1` | |
| Headline card open | `scale .96→1`, `opacity 0→1` | **300ms** | `.2,0,0,1` | A newspaper hitting the table |
| Headline resolve | `opacity 1→0`, `scale 1→1.04` | **180ms** | `.4,0,.2,1` | It moves *toward* you as it leaves — the opposite of the usual |
| Scoreboard reveal | rows `translateY 12→0` staggered **60ms** apart | **240ms** each | `.4,0,.2,1` | Stagger is capped at 5 rows |
| Log entry insert | `opacity`, `translateY −6→0` | **140ms** | `.4,0,.2,1` | |
| Trade timer | `width` linear, **1s** ticks | **90000ms** | linear | |
| **`Ideology answer payout`** | **see §7.3** | **300ms** | `.4,0,.2,1` | |

### 7.2.1 Majority formed — 520ms, three simultaneous channels

`rules-reference.md:177-179` — on forming, exactly `majority` of your voters flip
symbol-side up, and each flipped voter is worth 1 point. So the animation must be a
**flip of exactly N pegs**, and it must be countable.

1. **t = 0ms.** All pegs in the zone freeze (no transition on any of them) so the eye knows
   what is about to happen.
2. **t = 0–180ms.** Zone border steps 2px `PAPER_400` → 3px `SEAT_FILL_n`; the 8% tint
   fades in over the same 180ms; the zone label's holder line `● CRIMSON` fades in.
3. **t = 120–420ms (staggered 40ms apart).** Each of the N majority pegs flips. The flip is
   a **`rotateY`-style SVG scale on X** — `scale(1,1) → scale(0.15,1) → scale(1,1)` over
   **240ms** with the glyph swap at the 40% midpoint. That is a physical peg turning over,
   which is exactly what it is. 40ms stagger means a zone of 11 flips reads as a cascade, not
   a flash.
4. **t = 300–520ms.** The tally chip increments to `11/21`, `TYPE_PEG_COUNT`, in
   `SEAT_FILL_n` for 400ms then back to `INK_700`. The progress rule fills to its tick
   (200ms). A log entry is inserted (§7.4).
5. **No sound-equivalent.** No screen-wide flash, no screen shake, no colour wash over the
   whole board. **A majority is 1 zone of 9; it does not deserve a global event.** When the
   *last* majority forms and the game ends, the scoreboard takes over — that *is* the
   global moment.

### 7.2.2 Majority broken — 300ms, deliberately quieter

Breaking a majority is almost always something you did to yourself (a power spent) or
something an opponent did to you. It should feel like a loss of ground, not an event.

1. Border 3px `SEAT_FILL_n` → 2px `PAPER_400` over **300ms**; the tint crossfades out over
   the same 300ms.
2. The majority pegs flip back (`scale` X-flip, **180ms**, staggered 25ms) from solid to
   hollow.
3. The holder line `● CRIMSON` fades out; the seal disc hollows to a ring.
4. The tally chip decrements, in `NEGATIVE` for 400ms.
5. **No** stagger cascade, **no** flip cascade — a uniform 180ms on all of them, because the
   emotional weight is the loss of a whole zone, not the individual pegs.

### 7.3 The answer reveal — 300ms, one readable moment

**This is the most important entry in §7 and the reason the answer mechanic survives
digital translation.** `PLAN.md:36-37` and `rules-reference.md:191`: the card stays hidden
until the active player confirms, and the payout is only then revealed.

**The reveal, exactly:**

1. **t = 0.** Both option panels' selected state clears. `COMMIT ANSWER` becomes a
   `disable` (no spinner, no progress bar — the engine resolves in well under a frame; a
   spinner here implies the payout is being computed client-side, which would be a lie).
2. **t = 0–140ms.** The scenario panel and both options fade to `opacity 0` **together, at
   the same rate, in the same frame**. Both sides leave identically. This is the symmetry
   contract applied to motion: if the chosen side left faster, longer, or in a different
   direction, the animation itself would leak.
3. **t = 140ms.** The **entire viewport** is replaced by the result panel. One swap, one
   frame — no crossfade between question and answer, because a crossfade shows both at once
   and a half-visible question next to a revealed payout is exactly the leak we are
   preventing.
4. **t = 140–440ms.** The result panel fades in (200ms) containing **only**:
   - the answer label as it was chosen, `TYPE_DISPLAY_M`, `INK_900`, centred;
   - the Ideologue name and its ink colour (`IDEO_INK_*`) as a 4px underline — *this is the
     first moment the Ideologue is revealable*;
   - the payout as glyphs and numerals: `+2 ◈` + `+1 ●`, `TYPE_NUM_DELTA_GAIN`, 22px,
     centred, `POSITIVE`;
   - the passive bonus on its own line if any: `+1 Media — 2 Showstopper cards` in
     `INK_700`;
   - `CONTINUE`.
   The counterfactual is **absent**. No "the other side gave −1". No comparison bar. No
   `you could have had`. One number, once.
5. If the gain crosses `RULES.resourceCap = 12`, the over-cap state renders immediately
   with `SEAL` framing and the discard picker opens on `CONTINUE` — the cap discard is
   *mandatory before any other action* (`rules-reference.md:140-141`), so it cannot be
   deferred behind a "got it" acknowledgement.

**What must not animate, here specifically (§9.3):**

| Forbidden | Why |
|---|---|
| A card flip / 3D rotation on reveal | A flip has a duration proportional to nothing and a "reveal" quality that games use to build anticipation. It also implies there was something to un-hide *on the card* — inviting the player to look for it. |
| Counting up a number (`0 → 2`) | A count-up's *length* is proportional to the value. A `+2` that takes twice as long as a `+1` leaks the magnitude. **Fixed 300ms on the panel, numerals appear fully formed.** |
| Slot-machine / reel reveal of resources | Same leak, louder. |
| The chosen side "winning" a comparison | Never render both payouts to compare. |
| Any delay before the payout appears | Delay lengthens the moment of uncertainty and encourages re-reading the question hoping for a different answer. 300ms is the whole budget. |
| Music, particles, chromatic flash, screen shake | §9.9 |

### 7.4 Log as the feedback ledger

Every event in §7 writes exactly one `LogEntry`. The board animation is for the players
watching; the log is for the player who was looking away. Concretely:

| Event | `kind` | Entry template |
|---|---|---|
| Answer committed | `answer` | `T{n} · {p} answered Q{k} ({A\|B}) — Manifesto: {Ideologue}, {delta}` |
| Answer resolved | `answer` | `T{n} · {p} gained {delta} — passive {+n} {Resource}` |
| Voters placed | `voters` | `T{n} · {p} placed {k} voters in {Zone}` |
| Majority formed | `majority` | `**{Zone} is now held by {p} ({m}/{cap})**` |
| Majority broken | `majority` | `{Zone}'s majority broke — {p} drops to {k}/{m}` |
| Gerrymander | `gerrymander` | `{p} moved 1 voter · {ZoneA} → {ZoneB} (1 of 1)` |
| Power used | `power` | `{p} used {Power} ({n} of {m} this turn)` |
| Card bought | `card` | `{p} bought a Conspiracy Card ({cost} resources)` |
| Headline resolved | `card` | `Headline: {Name} — {resolution}` |
| System | `system` | `Game over — a majority formed in all 9 constituencies` |

Majority entries are the only ones with a `SEAL` 3px left spine; they are the score, and they
should look different in the rail.

### 7.5 Reduced motion

`@media (prefers-reduced-motion: reduce)` — see §8.5 for the full list. The rule:

> **Replace the movement, keep the state change.** No duration goes to zero; the *transform*
> is removed and the duration shortened to **80ms** on opacity/colour only.

So the majority flip (§7.2.1) becomes: border + tint change at 180ms, and the N pegs swap
glyph with **no stagger and no scale-X** — a single frame change, which is a perfectly
readable way to say "these N changed". The payout reveal (§7.3) becomes the same 140ms
simultaneous fade and the same single-frame swap, with the panel fading in over 120ms. **The
blind-answer guarantee does not depend on any animation, so reduced-motion users lose
nothing.**

## 8. Accessibility Checklist (WCAG 2.1 AA)

Target: **WCAG 2.1 Level AA**, verified per criterion. Anything not verified in this repo is
marked **ASSUMED — verify** and belongs on the pre-ship audit list.

### 8.1 The 129 hit targets

| Check | Requirement | Spec | Status |
|---|---|---|---|
| SC **2.5.8** Target Size (Minimum), AA — ≥24×24 CSS px | 48 board units | 48 × 0.62 (620px board) = **29.8px**; at the 500px floor = **24.0px** | ✅ **MEASURED**, at the floor |
| Adjacent targets must not overlap | — | 48 < **52.84** (measured min centre distance) — no overlap at any scale ≥500px | ✅ |
| Coarse pointers (SC 2.5.5 AAA, and 2.5.8 in practice) | ≥44×44 | `@media (pointer: coarse)` grows the hit rect to **56 units** (= 34.7px @560px board). 56 > 52.84 so rects *may* overlap by 3 units → resolve by: exact point → nearest centre within 28 units → no target (§5.13) | ✅ |
| SC **2.5.3** Label in Name | AA | Each slot's accessible name begins with the visible text a pointer user reads: the zone name for a zone-linked control; the card title for a card action | ✅ |
| Spacing / no accidental activation | — | Placement requires pick-then-`CONFIRM` (§6.1.4); gerrymander requires drop-then-`CONFIRM MOVE` (§6.2). **No board action commits on a single click.** | ✅ |

### 8.2 Colour independence

The board and every status signal have a **non-colour channel**. Audited:

| Signal | Colour channel | Non-colour channel |
|---|---|---|
| Majority voter vs minority voter | solid vs hollow fill | **fill vs outline silhouette** + the `▲` chevron |
| Majority held (zone) | 8% tint + border colour | **3px vs 2px border** + the filled seal disc + the literal text `● CRIMSON` |
| Volatile Area | none at rest | **rounded square vs circle** (shape) + the asterisk |
| Legal target / illegal target | green / red ring | **`⌾` vs `✕` ring shape** + the 45° hatch on illegal |
| Affordable / unaffordable action | `UNAVAIL_FILL` vs normal | **45° hatch** + `UNAVAIL_INK` + a shortfall line + `aria-disabled` |
| Resource gained / lost | green / red | **`+` / `−` (U+2212) glyph** + `TYPE_NUM_*_DELTA` at 800 weight |
| Seat identity | seat colour | The peg is *always* in a known zone; the **seat name is in the tooltip and in the log**; the scoreboard has names |
| Connection state | dot colour | filled circle vs ring + the attempt count numeral |
| Gerrymander rights | badge colour | `⚑ RIGHTS` vs `⊘ NO RIGHTS` — **different glyphs, and the negative state is always rendered** |

Greyscale check: **every one of these reads correctly with all colour removed.** The tint
measures 1.17:1 (§2.9) and carries nothing. **ASSUMED — verify** with a greyscale render
pass at 3 board sizes.

### 8.3 Contrast

All ratios measured in §2 via the WCAG 2.1 relative-luminance formula. Summary:

- Body text: `INK_700` on `PAPER_100` = **9.75** ✅ AAA; `TYPE_LOG` `INK_700` on `TABLE_900`
  = ASSUMED ≈15 ✅
- Meta text: `INK_500` on `PAPER_000` = **4.85** ✅ AA — and it is the floor; nothing smaller
  carries text.
- Semantic: `POSITIVE` 4.93 ✅, `NEGATIVE` 6.06 ✅, `SEAL` 6.13 ✅, `WARN_VOLATILE` 7.19 ✅
- Non-text (SC **1.4.11**, ≥3:1): every `SEAT_FILL_n` on `PAPER_000` = 4.72 / 3.98 / 3.34 /
  6.56 / 3.14 ✅. Amber required a darkened render fill (#B87A0C) because the printed
  #E0A020 measures only 2.11 ❌ — **this is the one place the client deliberately diverges
  from `PLAYER_COLOURS`**, and §2.5 records why.
- Focus indicator (SC **2.4.7**): dual-tone ring — 2px `#141110` inner (**17.41** on
  `PAPER_000` ✅) + 2px `#FFFFFF` outer (**3.39–7.08** against every seat fill ✅). The two
  tones guarantee the ring is visible against both parchment and any peg fill.
  `outline: none` is **permitted only** where this ring is present.
- SC **1.4.3** is met by construction: the two answer sides use identical tokens (§1.2).

### 8.4 Keyboard traversal of a spatial board

The board has no natural DOM order, so the order is **defined explicitly** rather than left
to the DOM. Three rules:

1. **Traversal order is `ZONE_IDS` order, then `areaId` ascending within the zone** —
   `north_west`, `north`, `north_east`, `west`, `central`, `east`, `south_west`, `south`,
   `south_east` (`state.ts:29-38`). This is a **reading order** (the order a newspaper
   article is read, roughly north-west to south-east), not the visual order, and it is
   stable, predictable, and matches the Tab key that opens the board.
2. **Roving tabindex.** Exactly one slot has `tabindex="0"` at a time; the other 128 have
   `tabindex="-1"`. Arrow keys move within the roving group. This means the whole board is
   **one Tab stop**, not 129 — 129 stops would make the rest of the UI unreachable in
   practice. `Escape` from the board returns focus to where it came from.
   - `←/→` previous / next slot **in traversal order**
   - `↑/↓` previous / next slot **in the same zone** (a fast way to work a zone)
   - `Home` / `End` → first / last slot in the current zone
   - `PageUp` / `PageDown` → previous / next zone
   - `Enter` / `Space` → activate per current mode (§6.1, §6.2)
   - `Backspace` / `U` → undo the last placement pick
   - `Escape` → leave placement / gerry mode, or dismiss a tooltip
3. **Focus must be visible on a 40-unit-dim board.** The focus ring is drawn in SVG user
   space so it scales with the board (2 SVG units inner + 2 outer ⇒ 1.24px + 1.24px at the
   620px reference, 2.48px at 1240px). Below the 500px floor it is **boosted to 3+3 SVG
   units** so it never falls under ~1.5 CSS px — a focus indicator below 2px effectively
   does not exist for low-vision users.

**A keyboard user must be able to complete a full turn.** Verification path: `Tab` to the
board → arrows to a slot → `Enter` in placement mode → arrows to the rest → `Enter` →
`Tab` to `CONFIRM PLACEMENT` → `Enter`. No drag, no hover-only affordance, no timing
dependency beyond the 250ms tooltip dwell (which is *supplementary* — the same information
is in the `aria-label`).

### 8.5 Screen-reader labels

**Peg labels** (`aria-label` on each slot `<g role="button">`), built from the engine state,
never from a template string that could drift:

```
"North West, slot 7, empty. Need 6 to hold this constituency."
"North, slot 11, Volatile Area, empty. A voter here is permanent and triggers a Headline."
"North, slot 3, Ria's voter, minority, worth 0 points. Gerrymanderable."
"Central, slot 5, Ria's voter, majority, worth 1 point. Not gerrymanderable."
"South, slot 9, Dev's voter, majority, worth 1 point. Not gerrymanderable."
```

The same `aria-label` mutates with the mode, appending one clause:
` · legal target` / ` · illegal: different zone, these voters must share one` /
` · gerrymander source` / ` · not a legal destination`. A screen-reader user therefore gets
the **same legality information** a sighted user gets from hatching, at the same moment.

Also required:

- The **zone** is `role="group"` with `aria-label="North West, majority 6 of 11, held by RIA"`
  and contains its slots. Screen readers can navigate zone-by-zone.
- A **live region** (`aria-live="polite"`, `aria-atomic="true"`) announces state changes that
  have no focus target: `North is now held by Ria, 11 of 21`, `3 voters placed`,
  `Connection lost, retrying`. Coalesced to at most **one announcement per 1000ms** so the
  majority cascade (§7.2.1) announces once, not eleven times.
- The **log rail** is `role="log"` with `aria-live="off"` — the player can read it on demand
  without being interrupted, and the polite region above covers the interruption case.
- `aria-live="assertive"` is used **only** for the answer commit result (§5.3) and the
  game-over state.
- Every icon-only control (log filters, tab bar, connection dot, `CONFIRM`) has a text
  accessible name. Decorative SVGs — the scoreboard mini-board, the coastline, the tether
  lines, the asterisk glyphs — are `aria-hidden="true"`; the asterisk is *also* carried by
  the slot's rounded-square label text (`Volatile Area`), so hiding the glyph hides nothing.

### 8.6 Reduced motion — `prefers-reduced-motion: reduce`

| Normally | Reduced |
|---|---|
| Peg flip `scaleX` 240ms + 40ms stagger | glyph swap, **no transform, no stagger**, 80ms opacity |
| Zone lift 90ms | 80ms, colour only |
| Gerry ghost 5-unit lag, 120ms lift | ghost follows the cursor with **0 lag**, 80ms opacity |
| Market card refill 280ms slide | **80ms opacity crossfade in place** — cards never change position |
| Answer reveal 300ms with a 140ms hold | **80ms opacity**, panel swap still a single frame (§7.5) |
| Scoreboard staggered rows | **all rows visible immediately**, no stagger |
| Placement legal-ring pulse 180ms | pulse removed; the `⌾` ring is static and already carries the meaning |
| Log entry slide-in 140ms | 80ms opacity |

**Nothing becomes invisible, nothing becomes ambiguous, and the blind-answer symmetry is
unaffected.** The duration floor is 80ms, never 0ms, so state changes remain perceptible as
*changes* rather than appearing as unexplained discontinuities.

### 8.7 Other AA checks this UI must pass

| SC | Requirement | How |
|---|---|---|
| **1.4.4** Resize text | 200% | All UI chrome is px-based but sized from a 16px root; no `px` on container widths that would clip. The board is SVG and scales freely. **ASSUMED — verify.** |
| **1.4.10** Reflow (320px) | No 2-D scroll | Phone layout (§5.13) is single-column with a tab bar. **ASSUMED — verify.** |
| **1.4.12** Text spacing | No clipping | `TYPE_CARD_SCENARIO` at 17/27 has 10px of leading slack per line. **ASSUMED — verify.** |
| **2.4.3** Focus order | Logical | Board is one Tab stop (§8.4); mat regions in visual order; `CONFIRM` and `END TURN` last in their region. |
| **2.4.6** Headings & Labels | Descriptive | 14 screens have `h1`/`h2`; region labels are the zone/player names. |
| **2.5.7** Dragging Movements | Cancellable | Every drag has a pointer equivalent: gerrymandering is tap-tap on coarse pointers (§5.13), and all drags have `Escape` + an explicit `CANCEL`. **SC 2.5.7 is satisfied by the phone path.** |
| **3.2.3** Consistent Navigation | — | The 4-item phone tab bar is in the same order everywhere; the shell is identical across 12 of 14 screens. |
| **3.3.2** Labels or Instructions | — | The one genuinely novel rule — gerrymander's "you may not move your only voter out of the zone whose rights you are using" — is printed in the mode strip (§6.2 G5), not hidden behind a `?`. |
| **3.3.4** Error Prevention | — | All destructive/irreversible turn actions (placement, gerrymander, trade offer, cap discard) are confirmed (§6.1.4, §6.2, §5.7). |
| **4.1.2** Name, Role, Value | — | Slots are `role="button"` with `aria-disabled` and a live `aria-label`; the roving tabindex exposes position. |
| **4.1.3** Status Messages | — | The polite live region (§8.5). |

### 8.8 The blind answer, as an accessibility property

Not a separate concern — the *same* design satisfies both, and that is worth stating
explicitly:

- The two answer sides are **identical in every computed style**, so a screen-reader user,
  a low-vision user, and a greyscale user all receive the **same information** as a sighted
  colour user. The blind answer is not "hidden from sighted players"; it is *symmetric*, so
  no one gets a shortcut through the styling.
- Because the payout is never in the payload (`PLAN.md:36-37`), there is nothing for an
  accessibility technology to leak. The `aria-label` on the answer panel reads the scenario
  and both labels — **never** a resource name.
- Test the symmetry, don't assume it: **a unit test asserting `getComputedStyle` equality on
  every property in the §1.2 contract table, for both sides, in both orderings, is a release
  gate.** It is the cheapest possible guard on the game's central mechanic.

## 9. Anti-Patterns

Twelve things this UI must not do, each with the Shasn-specific reason it would damage *this
game* specifically rather than UI quality in general.

**9.1 — Never tint, outline, badge, reorder-by-strength, or otherwise style the two answer
sides differently.**
The instant side A is green, side B is grey, side A is on the left always, side A has a
"recommended" star, or side A is 4px taller, the blind answer is dead and the game becomes
"pick the one the UI likes". This is why presentation order is randomised per card from
`_seed` (§1.2) and why the symmetry contract names a *token* per property rather than two
similar values. The assertion test in §8.8 is the enforcement.

**9.2 — Never make an unaffordable or illegal action "merely low-contrast".**
Fading something to 40% is a refusal a player reads as *style*. A player must be able to
tell "I can't afford this" from "this card is quiet" in one glance, and the reason must be
adjacent to the control. So: `UNAVAIL_FILL` + a 45° hatch + `UNAVAIL_INK` text that is
**still 4.33:1 readable** + `aria-disabled="true"` + a stated shortfall. Hatch is the
channel; the text stays legible because the player needs the number to plan.

**9.3 — Never animate the answer payout.**
Count-ups, card flips, reels, delays, and any "which side won" comparison all leak value
through duration and length, and the flip implies something was hidden *on the card* that
the player might go looking for. The reveal is a **single 300ms frame**: both sides fade out
together at the same rate, the viewport swaps in one frame, one payout appears fully formed.
§7.3.

**9.4 — Never loop, pulse, shimmer, or nag.**
A 129-target board with pulsing legal targets is a board nobody can read. State is
communicated by *being*, not by moving: the legal ring pulses **once** on mode entry and
then holds; the majority is held by a 3px border, not by a glow. No attention-seeking
animation anywhere in the product.

**9.5 — Never let the board consume the viewport such that the player's own mat is
off-screen.**
The player cannot deliberate without their own resources, cap, manifesto, and pending
groups. The shell pins the mat column at `minmax(360px, 1fr)` and never lets the board
exceed **780px**, and on phone the mat is a tab plus a pinned `END TURN` bar (§5.13). A
"beautiful full-bleed board view" is a design that makes the game unplayable.

**9.6 — Never put resource tokens, Ideologue colours, or manifesto rows anywhere on the
answer prompt.**
Not in a header, not in a footer, not in a disabled background graphic, not in a
`title=`. The player's own Ideologue pattern is itself information — if a player's manifesto
is Capitalist-heavy, the prompt must not be styled in a way that correlates. The prompt is
one column of prose and two identical panels in an otherwise empty viewport.

**9.7 — Never use colour as the majority channel.**
Solid vs hollow and a 3px vs 2px border are free. The 8% zone tint measures **1.17:1** and is
therefore *guaranteed* to carry nothing — it is there for atmosphere, and the moment it
becomes load-bearing is the moment a colour-blind player or a greyscale screenshot loses
the score. §8.2.

**9.8 — Never make the Volatile Areas a colour wash.**
11 slots in a colour would read as ownership or as an error. Shape — rounded square vs
circle — survives greyscale, survives a 23px phone peg, and never collides with a seat
colour. `WARN_VOLATILE` appears only during the decision (§2.8).

**9.9 — Never add game-y chrome: coins, gems, sparkles, confetti, trophies, crowns, crowns
on the winner, bounce easing, "LEVEL UP!", streaks, XP bars, cartoon bursts, or a screen
shake.**
This game's satire is that Indian politics is run like a *business*. The moment the UI
adopts the visual language of a mobile free-to-play game, the joke becomes "a game about a
game about politics" and the satire lands on the interface instead of the writing. Shasn's
comedy is in the card text and the Headline names; the UI's job is to look like a
**well-printed political broadsheet** — paper, ink, one stamp red, one confident coastline.
Easing is `cubic-bezier(.2,0,0,1)`. Nothing bounces.

**9.10 — Never let an illegal click be a silent no-op, and never make a legal click silent
either.**
The 129-target board makes mis-clicks inevitable. An illegal click flashes the `✕` and names
its reason (`rules-reference.md` constraints surfaced as player language, §6.1.2). A legal
click places a peg with an audible-feeling press flash and a log entry. Silence is for
network latency, not for rules.

**9.11 — Never let the log be an icon-delta feed.**
`T11 · RIA placed 3 voters in North → majority 11/21` is a sentence. `▲3 ⬤` is not. Players
learn this game by reading the log — a rules-reference is how you learn Shasn — and a
player who was away for 20 minutes catches up by reading it top-down. Every entry is
`INK_700` prose at 14/21; icons are decoration inside it, never the entry.

**9.12 — Never auto-place, auto-suggest, or auto-optimise a legal action.**
No "recommended zone", no "this completes your majority" arrow, no auto-fill when a group
fits exactly one zone, no gerrymander suggestion, no trading suggestion. This is a
deliberation game; a hint that is *sometimes* right teaches players to stop thinking and wait
for the suggestion. The `CONFIRM PLACEMENT` popover (§6.1.4) states the **consequence** the
player chose to create — that is not a suggestion, it is a receipt.

## Appendix A — Token Reference (single sheet)

### A.1 Spacing

4px base. `--sp-1: 4` · `--sp-2: 8` · `--sp-3: 12` · `--sp-4: 16` · `--sp-5: 20` ·
`--sp-6: 24` · `--sp-8: 32` · `--sp-10: 40` · `--sp-12: 48`.

Dense register (board, market, log): `--sp-2` / `--sp-3`. Calm register (answer prompt,
cards): `--sp-6` / `--sp-8` / `--sp-10`.

### A.2 Radii, borders, shadows

| Token | Value |
|---|---|
| `--r-sm` | 4px (chips, pips) |
| `--r-md` | 6px (cards, option panels, tooltips) |
| `--r-lg` | 10px (panels) |
| `--r-sheet` | 18px (the board's own edge) |
| `--shadow-card` | `0 1px 2px rgba(20,17,16,.28)` |
| `--shadow-panel` | `0 2px 8px rgba(20,17,16,.32)` |
| `--shadow-none` | the only permitted value on the board |

**No gradients anywhere.** Depth is paper edge + `--shadow-card`. §9.9.

### A.3 Board geometry constants

| Constant | Value |
|---|---|
| `BOARD_W` × `BOARD_H` | 1000 × 1500 |
| `PEG_R` | 17 |
| `WELL_STROKE` | 1.5 |
| `HIT_RECT` | 48 × 48 (`pointer: coarse` → 56) |
| `PEG_MINORITY_STROKE` | 3 |
| `PEG_MAJORITY_STROKE` | 1.5 |
| `VOLATILE_WELL` | 34 × 34, `rx 6` |
| `OVERLAY_RING_R` | 21 |
| `ZONE_GAP` | 1.5 |
| `BOARD_MIN_RENDER_W` | 500 (480 on tablet portrait) |
| `BOARD_MAX_RENDER_W` | 780 |
| Measured min centre distance | 52.84 |

### A.4 Peg state matrix — one line

`{empty ○ / own-minority ○ / own-majority ● / other-minority ○ / other-majority ●}` ×
`{normal circle / volatile rounded-square}` × `{idle · place-legal ⌾ · place-illegal ✕hatch ·
place-selected ⌾* · gerry-source ⟲ (✕ if majority or volatile) · gerry-dest-legal ◈ ·
gerry-dest-illegal ✕hatch}` → **the 10×7 table in §4.6 is normative**; §9.4 of the key
(`h` = 45° hatch = unavailable, `d` = dim = context) is the summary form.

### A.5 Every custom property

Colours: §2.10 · spacing `--sp-*`: A.1 · radii `--r-*`, shadows `--shadow-*`: A.2 ·
fonts `--font-display` / `--font-numeric` / `--font-ui`: §3.1 · type `--type-*`: §3.2 ·
easing `--ease-board: cubic-bezier(.2,0,0,1)` · `--ease-panel: cubic-bezier(.4,0,.2,1)` ·
`--dur-*`: 90 / 120 / 140 / 160 / 180 / 200 / 220 / 260 / 280 / 300 / 320 / 520 ms.

### A.6 Measured contrast index

| Pair | Ratio |
|---|---|
| `INK_900` on `PAPER_000` | 15.55 |
| `INK_700` on `PAPER_000` | 9.75 |
| `INK_500` on `PAPER_000` | 4.85 |
| `SEAL` on `PAPER_000` | 6.13 |
| `POSITIVE` / `NEGATIVE` / `WARN_VOLATILE` on `PAPER_000` | 4.93 / 6.06 / 7.19 |
| `UNAVAIL_INK` on `PAPER_000` | 4.33 |
| `SEAT_FILL_1..5` on `PAPER_000` | 4.72 / 3.98 / 3.34 / 6.56 / 3.14 |
| `PAPER_000` on `SEAT_FILL_1 / _4` | 4.72 / 6.56 |
| `INK_900` on `SEAT_FILL_3 / _5` | 4.66 / 4.95 |
| `IDEO_INK_*` on `PAPER_100` | 5.44 / 8.30 / 7.40 / 6.64 |
| `TABLE_TEXT` on `TABLE_700 / TABLE_900` | 12.35 / 15.13 |
| `#141110` on `PAPER_000` (focus) | 17.41 |
| `#FFFFFF` on each `SEAT_FILL_n` (focus outer) | 5.09 / 4.30 / 3.60 / 7.08 / 3.39 |
| `PAPER_400` on `PAPER_000` (slot well) | 1.95 (decoration, non-text) |
| Seat tint on `PAPER_000` | 1.17 (guaranteed non-load-bearing) |
| `PLAYER_COLOURS[2]` amber on `PAPER_000` | **2.11 ❌ — the reason for `SEAT_FILL_3`** |

---

## Appendix B — Open Questions

Each item is a real decision this spec could not make from the ground truth. None blocks
M4; all should be closed before M3 ships.

| # | Question | Why it is open | Proposed default |
|---|---|---|---|
| B1 | Does the server already send an `order` field, or must it be added? | `PLAN.md:42` specifies `{ cardId, question, labelA, labelB }` with no ordering field. §1.2's positional-bias fix needs one. | Add `order: 'ab' \| 'ba'` to the payload, derived from `_seed`. **This is a `PLAN.md` §2 amendment and should be raised before M3.** |
| B2 | Reader-relay (PLAN option B) — does it change the prompt layout? | PLAN defers it to v2. | Layout is already reader-neutral: the prompt shows the same two labels to the answering player regardless. No v2 change needed if B1 lands. |
| B3 | Are `EVICTION` pending groups placeable by the player they return to, or auto-placed? | `state.ts:113-117` says they live on the *owner's* mat. `rules-reference.md:213-214` gives the owner the choice next turn. | Player places them, `sameZone: false` (no constraint) → the placement bar omits the `ONE ZONE` badge entirely. |
| B4 | Should a **coalition** majority (`rules-reference.md:290-300`, `HEAD_CANONICAL` add-on) get its own zone treatment? | Coalitions change `majorityHolder` semantics, and the current `Zone` type stores a single `PlayerID`. | Out of scope for M4. If it lands, add a **split seal disc** (two half-discs) — a shape change, not a colour change. §8.2 holds. |
| B5 | 2-player mode uses a *separate* board (`rules-reference.md:338`) | The 2–3 player board is a different physical product; geometry would differ. | M4 ships the 9-zone 129-slot board. The 2-player board is a data swap of `BOARD` + `COASTLINE` — the spec is unaffected **provided** the minimum centre distance stays ≥48 units. Re-run that measurement on the new geometry. |
| B6 | What is the trade-offer timeout? | Not in the rulebook; needed for async. | 90s (ASSUMED), §5.7. |
| B7 | Does the answer prompt show on spectator screens? | `PLAN.md:14` says spectators are supported; the prompt's secrecy is about *other players*, not spectators. | No. §5.11. Consistent with `state.choices` filtering. |
| B8 | Sound design | Deliberately out of scope for this spec. | **None.** Every event in §7 has a visual-only channel by design, and adding audio later must not become the only channel for any state. |

### B.9 Assumptions register

Marked **ASSUMED** in the body, collected here:

`SEAL_DEEP` ratio · `INK_900` on `PAPER_300` for the volatile asterisk · `INK_300` as a
decoration-only ink · font files not yet vendored (Bitter / Roboto Mono / Inter) ·
line-height re-check after a font swap · `TYPE_TOOLTIP` on `PAPER_300` failing and
therefore tooltips being dark-only · 90s trade timeout · all §8.7 AA checks not yet
executed in a browser · greyscale render pass not yet executed · `ResizeObserver` board
floor enforcement not yet implemented · the 620px reference board width (derived from the
shell grid, not from a measured browser).
