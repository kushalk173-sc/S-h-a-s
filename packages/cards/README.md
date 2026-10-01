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
| `SCHEMA` | everything above that is shape. |

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
| `TOTAL_SKEW` | D2: totals differ by more than the tolerance band. A tilt, not a removal. | warn |
| `SAME_IDEOLOGUE_SKEW` | D4: both sides the same Ideologue. Unreachable through the schema; retained because the checker also runs against an unschema-checked corpus. | warn |
| `RESOURCE_BLIND_LEAN` | the deck-level heuristic below. | warn |
| `IDEOLOGUE_SKEW` | an Ideologue on card sides more than 20 points off an even quarter. | warn |
| `VOTER_COST_NON_MONOTONIC` | more voters is not more expensive on average. | warn |
| `VOTER_VALUE_UNDERREPRESENTED` | a size the deck barely offers. | warn |

### The tolerance band

```ts
export const BALANCE_TOLERANCE_TOTAL = 1;   // src/balance.ts
```

**Why 1, and why D1/D3 override it:**

- **±1 is free.** The resource cap is 12 (RULES p12). One resource is 8% of your pool,
  and across a four-hour game with 30+ resources passing through it is a rounding error.
  It cannot be strategically decisive, so it cannot cause the optimisation failure we are
  guarding against.
- **±2 is not free.** 17% of your pool, and precisely the difference between being able
  to afford the 4-resource redraw (RULES p21) and not. At the margin — which is where
  Shasn is played — two resources is a turn.
- **D1 and D3 override the band entirely.** A 1-resource `PURE_UPGRADE` and a
  1-resource `POWER_THRESHOLD_CLIFF` are both worse than a 3-resource symmetric card,
  because they remove the decision rather than tilting it. A tolerance band on totals
  must never mask a structural defect. (`test/balance.test.ts` pins exactly this pair: a
  1-resource upgrade is an error, a 1-resource trade-off is clean.)

**What the band costs:** some genuinely fine cards get flagged and argued about. That is
the intended price. The argument is the design review, and it belongs in a pull request
with a human in it, not silently in a playtest.

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

| | count |
|---|---:|
| `verbatim` | 0 |
| `adapted` | 15 |
| `inferred` | 45 |
| **total** | **60** |

**Zero cards are `verbatim`, and that is deliberate.** A `verbatim` card would have to
reproduce Memesys' published rules text word-for-word in a competing product, which
`docs/AUTHENTIC-SHASN-REFERENCE.md` §9.1–§9.2 identifies as the primary legal exposure in
this repository (DMCA is the realistic risk, not a lawsuit; card names alone are the
most-searchable item). The 15 `adapted` cards are here because the task brief asked for
recovered material and they are useful as *fidelity evidence* — the `source` field on each
names the exact clause that could not be represented, and those clauses are the substance
of `KNOWN-GAPS.md`.

**The open decision is recorded, not resolved, here.** `PLAN.md` §8 offers two paths
(licence, or original decks on Shasn-derived mechanics) and says "pick before M2";
`docs/ARCHITECTURE.md` §6.1 recommends path 2 and additionally requires that no card
field reference Shasn, Memesys or Zain Memon. The corpus in this package follows the
brief and ships the recovered material. If the licence path is declined, the decks in
`decks/` become the reference corpus rather than the shipping corpus, and the shipping
corpus is the same effect archetypes with original names and original questions — the
archetypes are mechanics, and mechanics are not copyrightable (REF §9.1).

## Known limitations

- **`KNOWN-GAPS.md` is the important one.** 43 of the 50 real X-cards recovered in REF §4
  cannot be represented without a schema change, because the 13-op `Effect` union has no
  duration, no trigger, no restriction, no per-unit scaling, no zone scope, no dynamic
  value, no card movement — and because five **phase-changing** ops (`block`, `deflect`,
  `auction`, `vote`, `pass-card`) do not belong in an `Effect[]` at all. Each gap there
  names the card, the clause, and the minimal schema change, and the affected cards
  reference their gap by id in `source`.
- **Voter Card costs are invented.** REF §3 and §10 item 3 record that the real 60-card
  cost distribution was never recovered. The structure is verified (REF §5.5); the numbers
  are ours.
- **The corpus is small.** 60 cards against the real 108 per campaign. `PLAN.md` §9
  names the corpus as risk #1 and calls it writing, not engineering.
