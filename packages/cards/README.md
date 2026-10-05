# `@shasn/cards` — the card corpus

Card **data**, its **JSON Schema**, a **validator** and a **balance checker**.

The engine interprets cards; it never authors them (`packages/engine/src/cards.ts`). Card
content lives here as JSON, so a card is reviewable in a pull request and a balance bug
is a data fix, not a code change.

The deck data itself is **dependency-free**. Ajv, TypeScript, vitest and tsx are all
`devDependencies`; a consumer of `decks/*.json` needs nothing but `JSON.parse`.

```
packages/cards/
├── schema/card.schema.json   draft 2020-12, all four card types, $comment on every constraint
├── decks/<deck>/<kind>.json  one file per card type per deck
│   ├── core/                 voter.json            (shared across campaigns)
│   ├── et2040/               ideology, conspiracy, headline
│   └── in2020/               ideology, conspiracy, headline
├── src/
│   ├── engine.ts             the ONLY place this package reaches into packages/engine
│   ├── corpus.ts             deck file format, loader, envelope stripping
│   ├── schema.ts             Ajv wiring, kind-narrowed and op-narrowed validation
│   ├── effect-ops.ts         compile-time drift guard against cards.ts's Effect union
│   ├── validate.ts           the validator
│   └── balance.ts            the balance checker
├── scripts/validate.ts       CLI: the CI gate
├── scripts/balance.ts        CLI: errors → exit 1, `--strict` also fails on warnings
├── test/                     vitest
├── KNOWN-GAPS.md             what the schema cannot express, with evidence
└── README.md
```

## Commands

| | |
|---|---|
| `npm run validate` | validates every deck file. **Exit 1 on any error.** |
| `npm run balance` | the balance checker. **Exit 1 on any dominance error.** `npm run balance -- --strict` also fails on warnings. |
| `npm test` | vitest |
| `npm run typecheck` | `tsc --noEmit` |

## Loading a deck

Decks are loaded **on the server, once, at boot**. Never shipped to a client in bulk —
see `docs/ARCHITECTURE.md` §6.3.

```ts
import { indexCards } from '@shasn/engine';
import {
  DECK_IDS,
  loadConspiracyDeck,
  loadHeadlineDeck,
  loadIdeologyDeck,
  loadVoterDeck,
  toEngineConspiracyCard,
  toEngineHeadlineCard,
  toEngineIdeologyCard,
  toEngineVoterCard,
} from '@shasn/cards';

const deck = 'in2020';

const cards = indexCards({
  ideology: loadIdeologyDeck(deck).map(toEngineIdeologyCard),
  voter: loadVoterDeck('core').map(toEngineVoterCard),      // voters are shared across campaigns
  conspiracy: loadConspiracyDeck(deck).map(toEngineConspiracyCard),
  headline: loadHeadlineDeck(deck).map(toEngineHeadlineCard),
});
```

`DECK_IDS` is the registry of deck ids. `loadCorpus(deckIds?)` returns all four arrays
across several decks in one call.

**The `toEngine*` functions are not optional.** Every card in `decks/` carries two extra
fields — `source` and `provenance` — that are *not* part of the engine's card shapes
(see [Provenance policy](#provenance-policy) and `KNOWN-GAPS.md` G0). They are stripped
key by key, deliberately rather than with `delete`, because `tsconfig.base.json` sets
`exactOptionalPropertyTypes` and `advisory: undefined` is not the same as no `advisory`.

A deck that does not ship a given card type is not an error: a missing file loads as an
empty deck. `core` has no Ideology Cards, because Voter Cards are shared across
campaigns in the physical product (one HQ Mat, one market).

### Why relative imports into `packages/engine`

`src/engine.ts` is the single place this package touches the engine, and it imports
`../../engine/src/{cards,rules,state}` rather than `@shasn/engine`. Two reasons, both
temporary:

- The engine's public entry point (`packages/engine/src/index.ts`) does not re-export
  `./cards` or `./rules` at all, so `IdeologyCard`, `Effect`, `sidePayout` and `RULES`
  are unreachable through the package name.
- The three leaf modules are the actual contract this package authors against, and they
  import nothing from the rest of the engine.

**Follow-up:** once the engine re-exports them, delete `src/engine.ts` and repoint
every import at `@shasn/engine`. Nothing else in this package reaches outside itself.

## Deck file format

```jsonc
// decks/in2020/ideology.json
{
  "deck": "in2020",        // must equal the directory name — the loader asserts it
  "campaign": "India 2020",// campaign: string on IdeologyCard; cards must agree with it
  "cards": [ /* one file per card type per deck, so decks load separately */ ]
}
```

Ids are namespaced `<type>-<deck>-<index>`, where type is `ig` (ideology), `vo` (voter),
`ct` (conspiracy) or `hl` (headline) — modelled on the printed card-code convention
`IG10.108` recovered at REF §5.7. The validator enforces the prefix and the deck segment,
so a misfiled card is a build failure rather than a confusing lookup miss.

## Adding a card

1. Add the object to the right `decks/<deck>/<kind>.json`.
2. Give it an `id` matching the pattern, a `source`, and a `provenance` tag.
3. Run `npm run validate` and `npm run balance`. Both must be clean.
4. Run `npm test`.

The schema will tell you the constraints and, where a constraint is a judgement rather
than a rule, the `$comment` will tell you why it exists. The two you will hit hardest:

- **An Ideology Card answer must open with `Yes.` or `No.`** (`^(Yes|No)\.`). Not a style
  preference: REF §8.2 rule 1 reports that every one of 20+ recovered answers opens that
  way, so an answer that does not is a card we did not recover correctly.
- **Each side must *state* the resource its own Ideologue maps to, even when the value is
  zero.** REF §5.2 verifies a shipped Capitalist side that pays 2 Trust + 1 Media and
  **zero Funds**, so requiring a *positive* amount would reject a real card. Requiring the
  key makes the zero explicit at authoring time instead. The "at least one disc" half of
  that rule belongs to the balance checker.

## What the validator enforces

`npm run validate` — **exit 1 on any error**, warnings do not fail the build. Every
problem is reported with the file, the card id and a JSON pointer.

Schema, via Ajv in `strict` mode with `allErrors`:

- all four card shapes, with `additionalProperties: false` everywhere. This is the
  highest-value line in the schema: a typo'd `pay` (singular) would otherwise be silently
  ignored and produce a card that pays nothing.
- the 13-op `Effect` union, branch by branch, with the right payload per op.
- `sides` is a fixed-length-2 array, never a keyed object (a keyed object would let
  `card.sides[action.side]` return `undefined` at runtime, in a live game).
- two sides of **two different** Ideologues (RULES p13).
- the Ideologue → Resource cross-check described above.
- `voters ∈ {1, 2, 3}` (RULES p10), Conspiracy `cost ∈ [4, 5]` (RULES p19), Headline has
  no `cost` (REF §5.5), payouts are non-negative integers, effect `n ≥ 1`.
- every card has an `id`, a `source` and a `provenance`.

Structural cross-checks the schema cannot express:

| code | what it stops |
|---|---|
| `DUPLICATE_ID` | `indexCards` builds its index with `Object.fromEntries`, so a duplicate id **silently overwrites** and one card vanishes with no error anywhere. This is a real silent bug and this check is the only thing stopping it. |
| `TYPE_MISSING` | a corpus with no Headlines still has Volatile Areas on the board (RULES p18), so a missing type is a broken game, not a thinner one. |
| `MARKET_FILL` | the market must be fillable to `RULES.marketSize`. RULES p10: three Voter Cards are face up at all times and an influenced card is replaced immediately, so the deck must never run dry. |
| `MARKET_VALUE_COVERAGE` | a Voter Card size the deck does not offer. REF §3: real effects discriminate by **size** (Lab-Grown Earworm, Power Trip, Don't Kiss The Babies, Eradicating Germs, Fatality), so the 1/2/3 split is load-bearing. |
| `ID_KIND_PREFIX` / `ID_DECK_SEGMENT` | a misfiled card, and the thing that makes a `DUPLICATE_ID` message readable. |
| `CAMPAIGN_MISMATCH` | a card whose `campaign` disagrees with its deck file. |
| `QUESTION_DUPLICATE` | duplicate prompts — the classic symptom of a copy-paste corpus, and they feel like a broken game. |
| `SOURCE_NOT_CITED` | provenance laundering: an `adapted`/`verbatim` card with no citation, or an `inferred` card that does not declare itself original. |
| `EFFECT_OP_UNKNOWN` | an `op` the engine's union does not declare. |
| `EFFECT_NOT_EXECUTED` | a shape the schema accepts and `reduce()` does not perform: a lasting `duration`, any `timing`, any `interrupt`, or an op with no `case` in `applyEffect`. |
| `EFFECT_FIELD_NOT_EXECUTED` | a field on an op whose `case` does not read it — `target` on `gerrymander` (other than `'you'`), `target` on `evict` / `discard-voter` / `convert-voter` / `steal-any`, a computed `n`, `when`, `until`. |
| `SCHEMA` | everything above that is shape. |

### The one that is not about shape at all

Everything else in this list asks *"is this card well formed?"*. The last two ask
*"is this card **true**?"*

A schema that parses a card the engine cannot execute is worse than no schema: the
game accepts the card, the player reads the text, and the effect never happens.
Nothing in the type system catches that — `Effect` declares what a card may say, not
what the interpreter will do — so `src/executable.ts` states what `applyEffect`
really does, per op and per field, and the validator refuses anything else with the
reducer change named in the message. `test/reducer-parity.test.ts` re-derives that
registry by reading `reduce.ts` itself and re-asserts it over every shipped card, so
the promise cannot drift from the code.

Two shapes are deliberately schema-valid but validator-refused (`duration`,
`timing`, `interrupt`, `when`, `until`, a computed `n`): an author who reaches for
one gets the engine explanation instead of `unknown property` printed once per card
branch. `KNOWN-GAPS.md` records every gap and which of the three states it is in —
expressible and executed, expressible and refused, or not expressible.

Two narrowings make the report readable rather than merely correct. Because a deck file
fixes its kind by construction, the validator narrows `cards.items` to the matching
`$defs` entry instead of a `oneOf` over all four; and because a card carries the op as
data, it validates each effect against its own branch instead of a `oneOf` over 13. Same
constraints, one branch, a report a human can act on. The schema file itself is left
un-narrowed so it is still correct when loaded standalone.

## What the balance checker enforces

`npm run balance` — **exit 1 on any dominance error.** `--strict` also fails on warnings.

PLAN.md §9 risk #2: *"If one side of a card is strictly better, players optimise instead
of deliberating and the entire premise collapses."* This is the check that protects the
premise, so it gets a real dominance relation rather than a total-sum comparison. A
totals-only checker is wrong in two opposite directions:

- **It flags legitimate trade-offs.** `{funds: 3}` vs `{trust: 3}` is the largest
  componentwise gap a card can hold — 3 Funds against 0 Funds, 3 Trust against 0
  Trust — and its totals are identical, 3 against 3. It is a perfectly good card:
  the choice is which resource you need, which is the deliberation the game is made
  of.
- **It misses 0-sum structural failures.** `{funds: 3}` vs `{funds: 2, media: 1}` pays
  3 on each side, so totals are silent, and so is `PURE_UPGRADE`: `media` is 0 on the
  first side and 1 on the second, so the second side is *not* ≥ the first
  componentwise. It is not an upgrade. What is wrong with it is the power-threshold
  cliff — 3 Funds is `RULES.level3`, so the first side unlocks that Ideologue's Level
  3 power, which pays out every turn for the rest of the game, while the second side
  does not. That is worth far more than the 1 resource the totals differ by, and it
  is invisible to any total-sum or componentwise comparison.

> An earlier draft of this README claimed the second example *was* a pure upgrade. It
> is not, and the claim cannot be rescued: if X ≥ Y componentwise and X ≠ Y then
> ΣX > ΣY strictly, so **a pure upgrade is never 0-sum**. `test/balance.test.ts` pins
> both the identity and the worked example.

| code | condition | severity |
|---|---|---|
| `EMPTY_SIDE` | D5: a side pays nothing. Not a choice. | **error** |
| `PURE_UPGRADE` | D1: X ≥ Y on every resource and strictly more on at least one. Removes the decision. | **error** |
| `POWER_THRESHOLD_CLIFF` | D3: X buys strictly more power unlocks than Y. Removes the decision *and* looks fair to a totals-only reader. | **error** |
| `TOTAL_SKEW` | D2: totals differ by more than the tolerance band, which is now **0**. Under full information a strict total edge removes the decision rather than tilting it, so this is an **error** — the same claim as `PURE_UPGRADE` in a wider reach. | **error** |
| `SAME_IDEOLOGUE_SKEW` | D4: both sides the same Ideologue. Unreachable through the schema; retained because the checker also runs against an unschema-checked corpus. | warn |
| `RESOURCE_BLIND_LEAN` | the deck-level heuristic below. | warn |
| `IDEOLOGUE_SKEW` | an Ideologue on card sides more than 20 points off an even quarter. | warn |
| `VOTER_COST_NON_MONOTONIC` | more voters is not more expensive on average. | warn |
| `VOTER_VALUE_UNDERREPRESENTED` | a size the deck barely offers. | warn |
| `X_EFFECT_MAGNITUDE` | a Conspiracy/Headline Card worth more than `X_EFFECT_MAGNITUDE_BUDGET` (half the resource cap) to the player who resolves it. | warn |

### X-card magnitude

Every rule above compares two sides of an Ideology Card. A Conspiracy or Headline
Card has one effect and no second side, so before this check the whole class the
recovered corpus is made of (REF §4: 50 real X-cards) had **no** balance rule at
all — a card that handed its player a dozen resources passed against a cap of 12.

`xCardMagnitude` sums what a card is worth to the player who resolves it, pricing a
voter at what the voter deck actually charges (`voterValue`, derived from the corpus
rather than assumed) and a drawn Conspiracy Card at its printed minimum (`RULES`
p19: 4). Effects aimed at `each-opponent`, `everyone` or `leader` score 0 for the
caster; that asymmetry is a real limit of the measure and is documented at the
function.

A warning, like every other tilt: the argument about a flagged card is the design
review, and it belongs in a pull request with a human in it.

### The tolerance band

```ts
export const BALANCE_TOLERANCE_TOTAL = 0;   // src/balance.ts
```

**Why 0, and why D2 is an error rather than a warning** (ruling; the full argument is on
the constant itself in `src/balance.ts`):

- **This is FULL INFORMATION.** `playerView` publishes both sides and their payouts, so a
  player is permitted to add them up. A strict total edge therefore does not cost a
  resource — it costs the **decision**. One answer is never the right answer whatever the
  player believes, and the card stops asking its question. A decision removed is not priced
  in resources, so pricing it in resources is the category error.
- **It is `PURE_UPGRADE`'s claim in a wider reach.** D1 says "one side pays strictly more
  of a resource"; D2 says "one side pays strictly more in total". Same kind of claim, and
  D1 is already an **error** at one resource. Three of the four D-codes treat a
  one-resource structural edge as an error; D2 was the only one that called it a tilt, and
  a tilt you may see is not a defect you may ship.
- **The old "±1 is free" argument was about the wrong thing.** It is an economic argument
  (8% of a pool of 12, a rounding error across a four-hour game) and it is sound for a
  blind game. What it misses is that a one-resource tilt is **invisible to a player who
  does not compute and decisive to one who does**, so tolerating it converts the
  difficulty from "decide what you believe" into "do the addition".
- **The band could only ever be 0 or 1.** It is an integer count of resources and 1 is the
  smallest non-zero one, so there is no third option. A band that permits a non-zero total
  difference permits exactly the quantity being measured.
- **CORPUS IMPACT, MEASURED OVER THE 76-CARD IDEOLOGY DECK: ONE CARD.** At the time of
  that measurement `|total skew|` was 75 zeros and one 1. **The 76 is that measurement's
  deck size and is left as history; the Ideology deck is 134 today and this has not been
  re-measured over it.** The one card was `ig-in2020-006` (`{trust 2, funds 2}` vs `{media
  2, funds 1}`), which had been named in `test/ideology-variety.test.ts` as a known unequal
  card rather than fixed. Its side 1 is now `{media 2, funds 2}`: one resource, on one card,
  and the two compositions stay incomparable — so the corpus-level claim that survives is
  **zero** unequal cards, asserted by `test/ideology-variety.test.ts`, not "one".
- **D1 and D3 name the same class of defect from two directions**, and with D2 also an
  error all three agree. A 1-resource `PURE_UPGRADE`, a 1-resource `TOTAL_SKEW` and a
  1-resource `POWER_THRESHOLD_CLIFF` are all worse than a symmetric card, because they
  remove the decision rather than tilting it. (`test/balance.test.ts` pins each one.)

**What a band of 0 costs:** every unequal pair of totals is now argued about. That is the
intended price, and the argument is the design review — it belongs in a pull request with a
human in it, not silently in a playtest. What it no longer does is let a **visible**
one-resource edge through on the grounds that one resource is economically free.

### D3 is a count, not a per-direction test

A side "buys" a power unlock for each `resource@threshold` pair its payout reaches
(`RULES.level3`, `RULES.level5`) — **scoped to that side's own Ideologue resource**,
because `IDEOLOGUE_RESOURCE[i]` is the only resource whose accumulation a side of
Ideologue `i` feeds toward a power unlock. A Capitalist side paying 3 Media has not
gained a Showstopper card and unlocks nothing. A cliff exists only when one side buys
**strictly more** than the other. The naive per-direction test — "X pays 3 of something
Y pays none of" — reports `{trust: 3}` vs `{funds: 3}` as dominated **twice**, when in
fact both sides buy exactly one unlock and the choice of which is real deliberation.
Equal counts, even with entirely different sets, are not dominance.

Scoping each side to its own resource is what stops the count from being gamed by
padding: counting every resource a side touches, a `{funds: 3, media: 3}` Capitalist
side scored 2 against a `{trust: 5}` Idealist side's 2, so the card came out *level*
and clean — when in truth the Idealist side buys the Level 5 unlock and the
Capitalist side buys only Level 3.

**What D3 is and is not.** The engine's actual unlock test is a count of Ideology
*Cards* held (`powers.ts`, `hasPower`), not of resources paid. This checker runs on one
card with no manifestos, so it uses the resource proxy the rules supply for that
ladder. It is a proxy, deliberately scoped and deliberately conservative; refine it
here, not in the engine, if it misreports on real play.

### The resource-blind heuristic

If, across a whole deck, the payout-favoured side is nearly always the **same Ideologue**
(> 80% of decisive cards, with at least 5 decisive cards), the deck is solvable without
reading it: a player who has seen it once knows which answer to give. That is risk #2
arriving through the corpus rather than through a single card. It measures the **deck**,
not any card.

A verdict of `undecidable` is the **desired** outcome for a well-balanced deck: the
payout structure does not tell you which side to take, so the question has to. Both
shipped decks currently report `undecidable`.

### Per-deck bias statistics

Reported for every deck, so systemic drift is visible rather than averaged away:

- **ideologue side rate** — how often each of the four Ideologues appears on a side.
  REF §2.3 `[INFERRED]`: the real 108-card India campaign is *not* flat — 8 of 14
  tournament hands held zero Idealist cards — so drift here is expected, and the point is
  that it is noticed.
- **ideologue pair rate** — the six unordered pairings. REF §2.3 also infers that Idealist
  and Supremo occupy largely **disjoint** question space, i.e. the real corpus is a
  curated pairing table, not six random pairs of four.
- **mean side payout** and **mean |A − B| gap**.
- **resource-blind** result, with the decisive count and the per-Ideologue split.

## Provenance policy

Every card carries two fields the engine types do not have:

```jsonc
{
  "id": "ig-in2020-002",
  "source": "REF 5.2 verifies the Capitalist side of the shipped 'SHOULD WE INVADE NEW SPAIN?' card pays 2 Trust + 1 Media and ZERO Funds … The Supremo side is authored; the ideologue of the recovered answer is inferred from its reasoning.",
  "provenance": "adapted"
}
```

| tag | meaning |
|---|---|
| `verbatim` | name and rules text reproduced word-for-word from a cited official "X Cards Explained" document (REF §4.1/§4.2.1/§4.3). |
| `adapted` | recovered text, but the card as played here is a **reconstruction**: an option was dropped, a branch was flattened, or only one side of an Ideology Card was recovered and the other is authored. The `source` field names exactly what was dropped and why. |
| `inferred` | **authored here.** The register is copied from REF §8.2; the content is not Memesys'. `source` must begin `original;`. |

**The rules, in order of importance:**

1. **Never ship a card whose provenance you cannot justify.** The deck is not padded to a
   number. 55 real cards is a success; 55 real cards plus 10 clearly-labelled originals is
   a better success; 100 fabricated cards presented as real is a total failure.
2. **`source` is mandatory and is checked.** An `adapted` or `verbatim` card with no
   citation fails validation. REF §9.2 is explicit that unattributed recovered text is
   the single highest legal risk in this repository.
3. **An `adapted` card's `text` must describe what its `effects` actually do** — not the
   real card's full text. `cards.ts` says the rules text "must describe exactly what
   `effects` does", and a card whose prose promises something the effect list cannot
   deliver is a bug that only shows up in someone's game.
4. **Nothing is fabricated into the `verbatim` tier.** REF §2.4 records that **zero**
   ordinary question Ideology Cards were recovered in full, so every Ideology Card here is
   at best `adapted`, and the `et2040` Ideology deck is entirely `inferred`.

### Current provenance

**Counted off `decks/**/*.json`, not remembered.** `npm run validate` prints the same
census.

| | count |
|---|---:|
| `verbatim` | **0** |
| `adapted` | **54** — 44 Conspiracy/Headline X-cards + 10 Ideology stems |
| `inferred` | **177** |
| **total** | **231** |

By deck: Ideology **134** (92 `in2020` + 42 `et2040`) · Voter **18** · Conspiracy **34**
(21 `et2040` + 13 `in2020`) · Headline **45** (30 `et2040` + 15 `in2020`).

**The nine recovered cards filed in the most recent pass, and why the corpus moved by
nine.** Until that pass, `npm run playable` reported nine recovered cards as **expressible
and played but absent from every deck file** — the engine could perform them and no player
could ever draw one, so they measured the vocabulary and not the game. All nine are now
filed under their recovered names: `ct-et2040-022` DEEP THOUGHTS, `ct-et2040-023`
LAB-GROWN EARWORM, `ct-et2040-024` THE GRETA EFFECT, `hl-et2040-028` POLO RETREAT,
`hl-et2040-029` SUBMERGED, `hl-et2040-030` A COWARD OR A JOURNALIST?, `hl-et2040-031`
CARD GAMES, `hl-in2020-033` SNOOP B-O-DOUBLE-T, `hl-et2040-033` THE BIG FREEZE. **None of
the nine needed an engine change** — the mechanism each one wanted had already landed in
an earlier iteration (G14a `borrow-power`, G14b `voter-shortfall`, G5a `set-cap`, and
`target: 'everyone'` from G8), so this was the cheapest kind of progress available: data
only. **The phantom count is now zero**, which means the project's headline figure had
been *understating* itself, because nobody had filed the cards.

Three of the nine deliberately re-file an archetype already in the decks — SUBMERGED
beside `hl-et2040-001`, SNOOP B-O-DOUBLE-T beside `hl-in2020-015`, CARD GAMES beside
`hl-et2040-030`. That is a **decision, not an oversight**: REF itself calls each pair the
same card, its own text says *"dedupe by effect"*, and each shipped card's `source` says
outright that a table can draw the same mechanic twice. If that is ever judged a balance
problem the fix is to retire one NAME, never to change either reduction.

**Zero cards are `verbatim`, and that is deliberate, and it stays zero.** A `verbatim` card
would have to reproduce Memesys' published rules text word-for-word in a competing product,
which `docs/AUTHENTIC-SHASN-REFERENCE.md` §9.1–§9.2 identifies as the primary legal exposure
in this repository (DMCA is the realistic risk, not a lawsuit; card names alone are the
most-searchable item). It is also *structurally* unreachable while `reduce()` holds a fixed
op count: the schema says `text` "must describe exactly what `effects` does", and for every
recovered X-card the inexpressible clause sits **inside** the printed text, so reproducing
that text would print a sentence describing something the engine does not do —
`KNOWN-GAPS.md` §0 state (b), *"a card that lies."* BLOCK and DEFLECT were the two
legitimate counter-examples and they ship `adapted` too, with every dropped clause named;
`decks/SOURCES.md` §1 tabulates all eight of BLOCK's recovered clauses against what
`reduce()` performs. **Dropping no clause is not reproducing text** — which is why
`ct-et2040-017`, `-018` and `-021` all drop nothing and all stay `adapted`, and why the
newly filed `hl-in2020-033` SNOOP B-O-DOUBLE-T — the only one of the nine that drops
nothing at all — is `adapted` on the same grounds.

The 54 `adapted` cards are here because the task brief asked for recovered material and
they are useful as *fidelity evidence* — the `source` field on each names the exact clause
that could not be represented, and those clauses are the substance of `KNOWN-GAPS.md`.

**The open decision is recorded, not resolved, here.** `PLAN.md` §8 offers two paths
(licence, or original decks on Shasn-derived mechanics) and says "pick before M2";
`docs/ARCHITECTURE.md` §6.1 recommends path 2 and additionally requires that no card
field reference Shasn, Memesys or Zain Memon. The corpus in this package follows the
brief and ships the recovered material. If the licence path is declined, the decks in
`decks/` become the reference corpus rather than the shipping corpus, and the shipping
corpus is the same effect archetypes with original names and original questions — the
archetypes are mechanics, and mechanics are not copyrightable (REF §9.1).

## Known limitations

- **`KNOWN-GAPS.md` is the important one**, and it has been re-measured against
  `reduce()` rather than against the schema. **44 of the 54 probed recovered X-card rows
  are expressible, and all 44 now ship in a deck file; 10 are not expressible at all.**
  (The probe's denominator is 54 *rows*, not the 51 distinct cards or the "50" REF §4's
  own prose uses: three campaign reskins are probed under both names and BLOCK is printed
  in two places. See `decks/SOURCES.md` §4.) The finding behind the 10 is that for them,
  the binding constraint is `reduce()` and `state.ts`, not the schema:
  the shapes they need (`duration`, `timing`, `interrupt`, `when`/`until`, a computed
  `n`) are now *in* the schema and are refused by the validator with the engine change
  named, so they are specified rather than unauthorable. Five **phase-changing** ops
  (`block`, `deflect`, `auction`, `vote`, `pass-card`) are modelled as a sibling card
  field rather than inside `Effect[]`, because they change which phase of play is
  running and no parameterisation of an effect list expresses them. `KNOWN-GAPS.md` §3
  is the costed engine handoff, ordered by cards unblocked.
- **No card may ship in state (b).** Expressible-but-unexecuted is a real state in this
  schema and it is enforced: `src/executable.ts` + `test/reducer-parity.test.ts` read
  `reduce.ts` and refuse any card the reducer would not act on. Three cards that had
  already shipped in that state — three `discard-voter` cards whose text said *"your own
  voters"*, which the reducer's choice cannot reach — had their text corrected.
- **Voter Card costs are invented.** REF §3 and §10 item 3 record that the real 60-card
  cost distribution was never recovered. The structure is verified (REF §5.5); the numbers
  are ours.
- **The corpus is small.** 92 cards in the `in2020` campaign deck against the real 108.
  `PLAN.md` §9 names the corpus as risk #1 and calls it writing, not engineering.
