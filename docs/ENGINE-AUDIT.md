# Engine Audit - packages/engine

Read-only audit. No source file was modified. Generated against commit-time state of packages/engine.

Ground truth: `npm run typecheck` from repo root = **16 errors** (verbatim in section 2).
`packages/engine/test/` exists but contains **0 files**; `npx vitest run` exits 1 with
`No test files found`. PLAN.md:192 and PLAN.md:208 both claim M1 is complete with
`50 tests passing` and `tsc --noEmit clean`. Both claims are false.
## 1. Inventory

Package `packages/engine`. Zero runtime deps (`package.json:5`). `tsconfig.json:6` includes
`src/**/*.ts` + `test/**/*.ts`. **No other workspace exists** — repo root has only
`packages/engine`, and nothing imports `@shasn/engine`. So every module below is currently
unreachable from any consumer, and `reduce.ts` (the only function a server would call) is not
part of the package's public surface.

| file | lines | exports | imported by | dead? |
|---|---:|---|---|---|
| `state.ts` | 337 | `PlayerID CardID AreaID ZoneID ZONE_IDS Ideologue Resource IDEOLOGUES RESOURCES IDEOLOGUE_RESOURCE RESOURCE_IDEOLOGY Pool Delta Peg Area Zone PendingVoters PowerUses NO_POWER_USES PlayerState Choice PendingChoice Phase LogEntry MarketSlot GameState EMPTY_POOL poolTotal deltaTotal findZone findArea pegsOf pegsFilled slotsFree emptyAreas gerrymanderRights tally` | board, actions, cards, powers, resources, reduce, playerView, setup(barrel) | NO - the hub |
| `rules.ts` | 82 | `Rules RULES PLAYER_COLOURS` | powers, reduce, setup(broken) | NO |
| `board.generated.ts` | 286 | `AreaSpec ZoneSpec BOARD_WIDTH BOARD_HEIGHT COASTLINE BOARD TOTAL_AREAS` | board | NO (generated; 129 areas, 11 volatile) |
| `board.ts` | 144 | re-exports generated + `freshZones zoneOfArea areNeighbours recount withZone withArea boardFull allMajoritiesFormed majorityVoters scores winners totalVoters` | reduce | NO |
| `cards.ts` | 130 | `IdeologySide Advisory IdeologyCard VoterCard EffectTarget Effect ConspiracyCard HeadlineCard CardIndex indexCards sidePayout Resource` | reduce (types only) | NO |
| `actions.ts` | 87 | `Action ChoicePick GameEvent Result` | reduce (types only) | NO |
| `powers.ts` | 179 | `PowerID PowerSpec POWERS powerSpec cardsOf hasPower unlockedPowers passiveBonus archetype usesLeft` | reduce | NO |
| `resources.ts` | 81 | `pool add subtract canAfford shortfall isEmpty overCap trimToCap discount applyDiscounts EMPTY_POOL poolTotal` | reduce | PARTIAL - `pool add shortfall isEmpty trimToCap discount` unreferenced |
| `rng.ts` | 33 | `nextSeed random shuffle` | reduce (`shuffle` only) | PARTIAL - `nextSeed`/`random` unreferenced; §4 spec uses both |
| `reduce.ts` | 1054 | `Ctx reduce rightsZones placeableAreas subtract` | **nothing** | NO, but UNREACHABLE |
| `playerView.ts` | 41 | `ClientState playerView allKeys` | **nothing** (`allKeys` referenced only by its own docstring, `playerView.ts:11`) | NO, but UNREACHABLE |
| `setup.ts` | 47 | `SetupOptions setup` | `index.ts:7` only | NO, but BROKEN |
| `index.ts` | 9 | barrel | package `main`/`types` (`package.json:6-8`) | NO - and the worst broken file (§2 B1) |

### 1a. `index.ts` omits 9 of the 13 real modules
`index.ts:1-9` exports only `state`, `setup`, `playerView` (valid) plus 6 dead paths. It does
**not** export `rules`, `board`, `board.generated`, `cards`, `actions`, `powers`, `reduce`,
`resources`, `rng`. Deleting the 6 bad lines is therefore not sufficient - see §2 B1.

---

## 2. Brokenness Ledger

### Ground truth: `npm run typecheck`, 16 errors, verbatim

```
src/index.ts(2,15): error TS2307: Cannot find module './config' or its corresponding type declarations.
src/index.ts(3,15): error TS2307: Cannot find module './capital' or its corresponding type declarations.
src/index.ts(4,15): error TS2307: Cannot find module './zones' or its corresponding type declarations.
src/index.ts(5,15): error TS2307: Cannot find module './manifesto' or its corresponding type declarations.
src/index.ts(6,15): error TS2307: Cannot find module './gerrymander' or its corresponding type declarations.
src/index.ts(8,15): error TS2307: Cannot find module './apply' or its corresponding type declarations.
src/playerView.ts(29,30): error TS2339: Property '_deck' does not exist on type 'GameState'.
src/playerView.ts(30,36): error TS2339: Property '_pending' does not exist on type 'GameState'.
src/reduce.ts(902,7): error TS2322: Type 'GameState' is not assignable to type '{ headlineQueue: { readonly areaId: AreaID; readonly by: PlayerID; }[]; zones: readonly Zone[]; players: Readonly<Record<PlayerID, PlayerState>>; turnOrder: readonly PlayerID[]; ... 21 more ...; _seed: number; }'.
  Types of property 'headlineQueue' are incompatible.
    The type 'readonly { readonly areaId: string; readonly by: string; }[]' is 'readonly' and cannot be assigned to the mutable type '{ readonly areaId: string; readonly by: string; }[]'.
src/reduce.ts(903,7): error TS2322: (identical headlineQueue cause)
src/reduce.ts(904,7): error TS2322: (identical headlineQueue cause)
src/setup.ts(1,28): error TS2307: Cannot find module './capital' or its corresponding type declarations.
src/setup.ts(2,49): error TS2307: Cannot find module './config' or its corresponding type declarations.
src/setup.ts(18,42): error TS7006: Parameter 'z' implicitly has an 'any' type.
src/setup.ts(29,25): error TS2353: Object literal may only specify known properties, and 'capital' does not exist in type 'PlayerState'.
src/setup.ts(43,5): error TS2353: Object literal may only specify known properties, and '_deck' does not exist in type 'GameState'.
npm error code 2
```

### B1 - `index.ts` 6 dead export paths - TYPE-LEVEL / IMPORT-PATH ONLY
- **file:line**: `index.ts:2,3,4,5,6,8`
- **exact error**: `TS2307 Cannot find module './config' | './capital' | './zones' | './manifesto' | './gerrymander' | './apply'`
- **root cause**: the barrel was written against a pre-refactor layout. The refactor folded
  `config.ts`+`zones.ts` into `rules.ts`/`board.generated.ts`, `capital.ts` into `state.ts`
  (`Pool`/`resources`), `manifesto.ts` into `powers.ts`+`state.ts`, `gerrymander.ts` into
  `state.ts:306`, and `apply.ts` into `reduce.ts`. Six files were deleted; the barrel was
  never updated.
- **MINIMAL FIX** - replace the whole file:
  ```ts
  export * from './state';
  export * from './rules';
  export * from './board';
  export * from './cards';
  export * from './actions';
  export * from './powers';
  export * from './resources';
  export * from './rng';
  export * from './reduce';
  export * from './setup';
  export * from './playerView';
  ```
  Note the 9 **additions** in that list are required, not optional (§1a).

### B2 - `setup.ts` - REWRITE THE FUNCTION (structurally wrong, not a path fix)
- **file:line**: `setup.ts:1,2,18,20-22,29,40,43,44,45` (+ 4 silent defects)
- **exact errors**: `TS2307 './capital'` (`:1`), `TS2307 './config'` (`:2`),
  `TS7006 Parameter 'z' implicitly has an 'any' type` (`:18`),
  `TS2353 'capital' does not exist in type 'PlayerState'` (`:29`),
  `TS2353 '_deck' does not exist in type 'GameState'` (`:43`).
- **root cause**: written against an older `GameState`/`PlayerState` shape that predates the
  three-deck -> four-deck refactor. It is wrong in **nine** ways; the compiler only reports
  the five that happen to be type-visible.

  | setup.ts | reported? | defect |
  |---|---|---|
  | `:1` `import { EMPTY_POOL } from './capital'` | TS2307 | `EMPTY_POOL` lives in `state.ts:263` |
  | `:2` `import { DEFAULT_RULES, type RulesConfig } from './config'` | TS2307 | neither name exists. Real names: `RULES` / `Rules` (`rules.ts:52`, `rules.ts:8`) |
  | `:18` `rules.zones.map(...)` | TS7006 | `Rules` has **no `zones` member** (`rules.ts:8-50`). Zone data is `BOARD` in `board.generated.ts` via `freshZones()` (`board.ts:16`) |
  | `:20-22` `slots`/`majorityThreshold`/`pegs:{}`/`lockedBy` | **no** | **`Zone` has none of these.** Real `Zone` (`state.ts:95-106`) = `id name majority capacity neighbours areas majorityHolder`. A `Zone` is **not** a mutable record of pegs; pegs live at `areas[i].peg` (`state.ts:87-93`). Silently compiles because `z` is `any` |
  | `:24` `lockedBy: null` | **no** | field does not exist |
  | `:29` `{ id, capital, manifesto, conspiracies }` | TS2353 | missing `name colour resources manifestoCards pending powerUses isBot`; the field is `resources` (`state.ts:156`), not `capital` |
  | `:43-45` `_deck:{draw,discard}` / `_pending` / `_conspiracyDeck` | TS2353 on `_deck` only | the 3-deck model is gone. Now **4 draw + 4 discard piles + `_pendingCard` + `_seed`** (`state.ts:248-258`) |
  | `:40` `phase:'answer'` with **no `_pendingCard`** | **no** | **soft-lock on turn 1**: `ANSWER` fails `'no card has been put to you'` (`reduce.ts:463`), `END_TURN` fails `'answer your Ideology Card first'` (`:910`). No legal move exists |
  | `market` never populated | **no** | `rules-reference.md:161-162` "Three open Voter Cards must always be available." `refillMarket` (`reduce.ts:158`) is called only from `INFLUENCE` (`:523`) and `refresh-market` (`:309`). Nothing calls it at setup, so the market stays empty all game. §4 step 8 |
  | `round` never set | **no** | `GameState.round` (`state.ts:222`) missing from the literal -> `undefined` propagates into `advanceTurn:409` |
  | no head start, no `_seed`, no first draw | **no** | `RULES.staggeredStart` (`rules.ts:49`) is unimplemented; spec is `rules-reference.md:92-93` |

- **MINIMAL FIX**: not a patch. Rewrite the body. Full transcribable spec in **§4**.
- **Effort class**: **REWRITE THE FUNCTION** (~40 lines).

### B3 - `playerView.ts` - REWRITE THE TYPE + 2 LINES (security-critical, do last)
- **file:line**: `playerView.ts:16` (`Omit`), `:29`, `:30`
- **exact errors**: `TS2339 Property '_deck' does not exist on type 'GameState'` (`:29`),
  `TS2339 Property '_pending' does not exist on type 'GameState'` (`:30`).
  (`:16` does not error on its own - `Omit` with non-existent keys is legal - it is
  simply wrong, which is why it is silent and therefore more dangerous.)
- **root cause**: `ClientState = Omit<GameState, '_deck' | '_pending' | '_conspiracyDeck'>`
  (`playerView.ts:16`). `GameState` (`state.ts:215-259`) contains **none** of those three. It
  contains **eleven** `_` fields: `_pendingCard _ideologyDraw _ideologyDiscard _voterDraw
  _voterDiscard _conspiracyDraw _conspiracyDiscard _headlineDraw _headlineDiscard _seed`
  (`state.ts:248-258`). The `Omit` is a no-op that names fields from the pre-refactor model.
- The **runtime** strip (`playerView.ts:25-28`, `if (key.startsWith('_')) continue`) is
  correct in principle and would already drop all eleven. The defect is that the *type*
  misdeclares the client payload, and the two derived fields are computed from
  non-existent state.
- **Effort class**: **TYPE-LEVEL ONLY** for the 3 compile errors (3 lines). **But** §5 also
  mandates a real behavioural fix (strip opponents' `conspiracies`) which is a genuine bug -
  see R1 in §6. Do not close this as "type-only".

### B4 - `reduce.ts:901` - TYPE-LEVEL ONLY (one annotation)
- **file:line**: `reduce.ts:901` (errors surface at `:902`, `:903`, `:904`)
  ```ts
  901:  let s = { ...state, headlineQueue: state.headlineQueue.slice(1) };
  902:  s = applyEffects(s, source, card.effects, ctx);
  903:  s = discardTo(s, 'headline', cardId);
  904:  s = log(s, { player: source, text: `HEADLINE — ${card.name}`, kind: 'card' });
  ```
- **exact error**: `TS2322` x3 - `The type 'readonly {...}[]' is 'readonly' and cannot be
  assigned to the mutable type '{...}[]'`, on property `headlineQueue`.
- **root cause**: `GameState.headlineQueue` is `readonly {…}[]` (`state.ts:232`).
  `.slice(1)` on a `readonly T[]` returns a **mutable** `T[]`, so TS infers `s`'s type from
  the object literal on line 901, where `headlineQueue` is the *mutable*
  `{ readonly areaId: string; readonly by: string }[]`. Each later assignment must be
  assignable to that inferred type, but `applyEffects`/`discardTo`/`log` each return a full
  `GameState` whose `headlineQueue` is `readonly` - not assignable to mutable. The
  `{areaId: string}` vs `{areaId: AreaID}` discrepancy is cosmetic (both alias `string`,
  `state.ts:14-15`); **array mutability is the entire error**.
- **MINIMAL FIX** - add the annotation, one line:
  ```ts
  let s: GameState = { ...state, headlineQueue: state.headlineQueue.slice(1) };
  ```
  Behaviour is unchanged. **This is not a latent logic bug** - the queue is genuinely narrowed
  correctly, because `readonly T[]` is covariant and `T[]` is assignable to `readonly T[]`.
  Do **not** "fix" it by mutating `headlineQueue` in place; that would break the immutability
  contract the whole reducer relies on.
- **Effort class**: **TYPE-LEVEL ONLY**, 1 line, 0 behaviour change.

### B5 - `rules.ts` mojibake - **NOT REPRODUCIBLE. The claim is false.**
- **Reported**: "em-dash sequences render as the replacement char (e.g. `resources \uFFFD?the rulebook`)".
- **Verified**: byte-level scan of all 13 `src/*.ts` for `U+FFFD` -> **0 matches**.
  Repo-wide scan of `packages\engine\src\*.ts` + `docs\*.md` + root `*.md` -> **0 matches**.
  `rules.ts` non-ASCII inventory is exactly two legitimate code points: `U+2014` (em dash,
  1x) and `U+2013` (en dash, 1x).
- The line the report points at, `rules.ts:10`, is byte-clean:
  `   * p12: "Players have a default resource cap of 12." Total across all four`
  (the `─` run that visually corrupts in the console is the box-drawing separator, not this line.)
- The full non-ASCII inventory across the package is all legitimate typography:
  `U+2014` em dash, `U+2013` en dash, `U+2500` box-drawing `─` (used for the `─────` section
  rules, e.g. `state.ts:76`, `state.ts:246`, `reduce.ts:47`, `cards.ts:11`),
  `U+2192` arrow (`state.ts:333`, `cards.ts:1`), `U+00D7` times (`cards.ts:88`),
  `U+2026` ellipsis (`reduce.ts`), `U+2715` ballot-X (`cards.ts:88`, `rules-reference.md:344`).
- **Conclusion**: nothing to fix. The `U+FFFD` appearance is a **terminal rendering
  artifact** of the box-drawing runs, not file content. No other file is affected either.
- **UNVERIFIED**: whether git history ever contained mojibake that was since repaired.
  Settle with `git log -p --follow -- packages/engine/src/rules.ts`. No action either way.

### Ledger summary

| # | file:line | errors | class | minimal fix |
|---|---|---:|---|---|
| B1 | `index.ts:2-6,8` | 6 | import path + 9 missing exports | replace file, 11 lines |
| B2 | `setup.ts:1,2,18,29,43` (+4 silent) | 5 | **REWRITE THE FUNCTION** | §4 spec, ~40 lines |
| B3 | `playerView.ts:16,29,30` | 2 | type-level (+1 real fix) | §5 spec, ~20 lines |
| B4 | `reduce.ts:901` | 3 | **type-level only** | add `: GameState` |
| B5 | `rules.ts` + all files | 0 | **not reproducible** | none |
| | | **16** | | |

### Repair order (dependency-driven, not severity-driven)
1. B1 (`index.ts`) - unblocks the build so B2/B3/B4 are visible in isolation.
2. B4 (`reduce.ts:901`) - 1 line, zero risk.
3. B3 (§5) - type + the `conspiracies` fix. Do it before B2: the leak test depends on a
   working `playerView`, and `setup` output is what you feed it.
4. B2 (§4) - last, because the rewritten `setup` is the fixture every integration test needs.

---

## 3. The Missing Tests Section

`test/` is empty; `npx vitest run` exits 1. PLAN.md:208 claims "50 tests passing".
**This section enumerates 135 tests.** Every name is an `it(...)` title; every "Assert:"
line is the specific assertion that makes the test non-vacuous - a test that cannot fail is
not worth writing.

Suggested files: `test/setup.test.ts`, `test/board.test.ts`, `test/state.test.ts`,
`test/resources.test.ts`, `test/rng.test.ts`, `test/powers.test.ts`, `test/reduce.test.ts`,
`test/headlines.test.ts`, `test/playerView.test.ts`, `test/integration.test.ts`.
`tsconfig.json:6` already includes `test/**/*.ts`; vitest 2.1.8 is a devDependency
(`package.json:20`). No config file needed - vitest defaults pick up `test/*.test.ts`.

### 3.0 Shared fixtures the whole suite needs (build these first)

```ts
// test/helpers.ts
import { RULES } from '../src/rules';
import { indexCards, type IdeologyCard } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import type { Action, GameState, PlayerID } from '../src/state';

/** Deterministic tiny card set. 12 ideology cards so every player can hold 5 of one
 *  Ideologue without reshuffling. 2 sides each, ALWAYS different ideologues
 *  (rules-reference.md:188-189 "Both answers on a card belong to different Ideologues"). */
export function makeCtx(n = 12): Ctx {
  // assert: cards.ideology[c].sides[0].ideologue !== cards.ideology[c].sides[1].ideologue
}

export function fresh(seed = 1, players: PlayerID[] = ['p1','p2','p3']): GameState { /* setup() */ }

/** Apply a script, asserting every action succeeds. Makes the integration test readable. */
export function play(s: GameState, script: {p: PlayerID, a: Action}[]): GameState {
  for (const {p, a} of script) {
    const r = reduce(s, p, a, ctx);
    if (!r.ok) throw new Error(`script broke: ${p} ${JSON.stringify(a)} -> ${r.error}`);
    s = r.state;
  }
  return s;
}
```

### 3.1 INTEGRATION - the headline test (M1's own exit criterion, PLAN.md:206)

| # | test name | Assert: |
|---|---|---|
| 1 | `plays a full 3-player game to completion without a single failed action` | Loop while `!state.finished`: if `phase==='answer'` send `ANSWER`; else if `state.choices.length` send a legal `RESOLVE_CHOICE`; else if `phase==='headlines'` send `ACK_HEADLINE`; else `INFLUENCE`+`PLACE_VOTERS` while possible, then `END_TURN`. Assert loop terminates, `finished === true`, `phase === 'finished'`, and the action counter `< 2000` (proves it ended on a rule, not a guard). |
| 2 | `full game ends with a majority in every one of the 9 zones` | Assert `allMajoritiesFormed(state) === true`; every `z.majorityHolder !== null`. |
| 3 | `winning scores equal the sum of flipped pegs and nothing else` | Assert `sum(scores(state).values())` === `state.zones.reduce((n,z)=>n+z.areas.filter(a=>a.peg?.majority).length,0)`, and total `<= 69` (sum of the 9 zone majorities 6+11+6+9+5+9+6+11+6). |
| 4 | `a full game is reproducible: same seed + same action log = identical state` | Run the §3.1.1 script twice from the same `setup()`. Assert `JSON.stringify(a) === JSON.stringify(b)`. **Fails today** - see R2. |
| 5 | `reproducibility survives an interleaved different game` | Run script A to completion, then script B, then re-run A from a fresh `setup()` with the same seed. Assert A#2 `===` A#1. Catches module state that test-ordering hides. **Fails today** - R2. |
| 6 | `every full game emits a game-over event listing the true winner(s)` | Assert final `Result.events` contains `{type:'game-over', winners}` and `winners` deep-equals `Object.entries(scores).filter(([,v])=>v===max).map(([k])=>k)`. |
| 7 | `no player is ever over the resource cap outside a pending choice` | Sample after every action. Assert `poolTotal(p.resources) <= RULES.resourceCap` UNLESS there is an open `choices` entry with `.player === p.id` and `.choice.kind === 'lose-any'`. |
| 8 | `no action ever produces a negative resource count` | After every action assert every `p.resources[r] >= 0`. **Fails today if a negative Delta is submitted** - R3. |
| 9 | `2-, 3-, 4- and 5-player games all reach finished` | For n in 2..5 run §3.1.1. Assert `finished === true`. Guards turn-order and final-round arithmetic at every supported size. |
| 10 | `the log contains one answer entry per ANSWER action, in non-decreasing turn order` | Assert `log.filter(l=>l.kind==='answer').length` === number of `ANSWER` actions, and `turn` values non-decreasing. |

### 3.2 SECRET LEAK - the project's most important property (PLAN.md:145-146, state.ts:7-10)

| # | test name | Assert: |
|---|---|---|
| 11 | `playerView exposes NO key starting with "_" anywhere in the graph, recursively` | `const keys = allKeys(playerView(state, viewer))`. Assert `keys.filter(k => k.startsWith('_'))` deep-equals `[]`. Use `allKeys` (`playerView.ts:35`) - it recurses arrays and nested objects, so a secret hidden one level down is still caught. Run for every viewer, at >= 3 game positions (turn 1, mid-turn with a pending card, end of game). |
| 12 | `playerView never ships the pending Ideology Card, by id or by payout` | State with `_pendingCard='ide-07'` and distinct payouts per side. Assert `JSON.stringify(client)` contains neither `'ide-07'` nor the string form of either payout. |
| 13 | `awaitingAnswer is a boolean and reveals nothing about which card` | Assert `typeof === 'boolean'`; `true` iff `_pendingCard !== null`; and identical for all viewers including the one who has not answered. |
| 14 | `deckSizes are counts only - draw-pile contents never appear` | Assert each of the 4 sizes is a `number` equal to the real pile length, and that no `_ideologyDraw` / `_voterDraw` / `_conspiracyDraw` / `_headlineDraw` id appears in `JSON.stringify(client)`. |
| 15 | `_seed never reaches the client` | Assert `JSON.stringify(client)` does not contain the string form of `s._seed`. A leaked seed reconstructs the whole deck. |
| 16 | `playerView does not ship other players' Conspiracy Card hands` | Give p2 two conspiracy cards, view as p1. Assert `client.players.p2.conspiracies` is `[]` with none of p2's card ids. **FAILS today** - R1. |
| 17 | `playerView does not ship the viewer's own Conspiracy hand either` | Assert the viewer's own `conspiracies` is `[]`. The client learns a card is playable via a public flag, not by reading the hand. |
| 18 | `playerView returns only fields that exist on GameState, plus the documented derived ones` | Assert every key of `playerView(s,v)` is a `GameState` key or one of the documented derived fields. Catches renames in `state.ts` that would silently vanish. |
| 19 | `playerView does not mutate the state it is given` | `const before = structuredClone(s); playerView(s,'p1'); expect(s).toEqual(before)`. |
| 20 | `a 200-action game leaks no secret at ANY single point` | Re-run §3.1.1, applying the test-11 assertion after EVERY action. A leak that opens and closes mid-turn is invisible to a single-sample test. |
### 3.3 MAJORITY FORMATION AND BREAKING (board.ts:56-87, rules-reference.md:173-183)

| # | test name | Assert: |
|---|---|---|
| 21 | `a majority forms the instant the requirement is met, and not before` | In `north_west` (majority 6, `board.generated.ts:58`): place 5 -> `majorityHolder === null`, all pegs `majority === false`; place the 6th -> `majorityHolder === 'p1'` and exactly 6 pegs `majority === true`. |
| 22 | `exactly the requirement is flipped, never more` | After 21, assert `z.areas.filter(a=>a.peg?.majority).length === z.majority` (6), not 7. `board.ts:76` `.slice(0, zone.majority)`. |
| 23 | `extra voters placed after the majority forms stay blank side up and score 0` | With 6 majority, place a 7th. Assert majority count still 6 and the new peg has `majority === false`. Direct test of `rules-reference.md:180`. |
| 24 | `a majority breaks when the holder drops below the requirement and the rest flip back` | Assert `majorityHolder === null` and EVERY peg of the former holder has `majority === false`. `board.ts:65-70`, `rules-reference.md:181-182`. |
| 25 | `breaking and re-forming emits majority events in the right order` | Assert the event stream is exactly `['majority-formed','majority-broken','majority-formed']` with correct `player`/`zoneId`. `reduce.ts:196-201`. |
| 26 | `recount flips Volatile pegs first so mobile pegs stay gerrymanderable` | Holder has 6 in `north_west`, one in volatile `north_west-07` (`board.generated.ts:70`). Assert that peg has `majority === true` and exactly 5 non-volatile majority pegs. Pins the determinism choice at `board.ts:51-55`. |
| 27 | `recount is idempotent` | `recount(recount(z))` deep-equals `recount(z)`. |
| 28 | `a broken majority can be re-formed by a different player` | p1 forms, p1 drops below, p2 reaches the requirement -> `majorityHolder === 'p2'`. `rules-reference.md:379`. |
| 29 | `two players meeting the requirement in one zone must NOT silently award it by board-scan order` | `north_west`: p1 has 6, p2 has 6 (capacity 11, legal). Assert the tie outcome is explicit and documented. **FAILS today** - `board.ts:63` silently last-wins. R4. Pin whatever the decision ends up being; the point is it must be *pinned*. |
| 30 | `majorityVoters and scores agree with the peg flags` | Assert `scores(state)[p]` === count of `(peg.owner===p && peg.majority)` for every p, and `totalVoters(p) >= majorityVoters(p)`. `board.ts:115,123,138`. |
| 31 | `winners does not declare every player the winner when all scores are zero` | Empty board with `finished` forced. Assert `winners(state).length === 0`, not `turnOrder.length`. **FAILS today** - `board.ts:131` floors `best` at 0. R5. |
| 32 | `boardFull is true only when all 129 areas are filled` | Assert false at 128 filled, true at 129. Cross-check `board.generated.ts` totals against `scripts/gen-board.mjs:229-230`. |

### 3.4 GERRYMANDER RIGHTS AND TIES (state.ts:306-325, reduce.ts:597-668, rules-reference.md:249-261)

| # | test name | Assert: |
|---|---|---|
| 33 | `gerrymanderRights goes to the player with strictly the most voters in the zone` | p1:3, p2:2 in `central` -> `gerrymanderRights(z) === 'p1'`. |
| 34 | `a TIE gives NOBODY gerrymander rights` | p1:3, p2:3 -> `gerrymanderRights(z) === null` AND a `GERRYMANDER` action fails with `'you do not hold Gerrymandering Rights'`. Direct test of `rules-reference.md:258`. |
| 35 | `a three-way tie also gives nobody rights` | p1/p2/p3 each 2 -> `null`. The `tied` flag at `state.ts:320` is order-sensitive; a 3-way tie must be pinned. |
| 36 | `an empty zone gives nobody rights` | `gerrymanderRights(emptyZone) === null` via the `bestN === 0` branch (`state.ts:324`). |
| 37 | `ONE voter in an otherwise-empty zone DOES grant rights` | `gerrymanderRights(z) === 'p1'` with a single peg. `rules-reference.md:260`. |
| 38 | `you may not move your only voter out of the zone whose rights you are using` | p1 has 1 peg in `central` and rights there; moving it out -> `ok:false` `'that is your only voter here'`. `reduce.ts:632`, `rules-reference.md:260-261`. |
| 39 | `with 2 voters in the rights zone you may move one out` | `ok:true`; `central` retains 1 p1 peg and the destination gains it. |
| 40 | `the allowance is one gerrymander per zone per turn, tracked per zone` | Two rights zones; one gerrymander in each -> both `ok:true`; a second in either -> `ok:false` `'you have already gerrymandered'`. `rules.ts:59`, `reduce.ts:604`. |
| 41 | `the allowance resets for the next player` | After another player's turn, assert the original player can gerrymander again. `reduce.ts:398`. |
| 42 | `Election Fever (Showstopper L5) raises the allowance to 2 per zone` | 5 Showstopper cards -> `hasPower('election-fever')` true; two gerrymanders in one zone both `ok:true`, a third fails. `rules.ts:60`, `reduce.ts:338-340`. |
| 43 | `a gerrymandered majority voter is refused without a power and allowed with Election Fever` | Without: `ok:false` `'majority voters cannot be gerrymandered'` (`reduce.ts:621`). With 5 Showstopper: `ok:true`. `rules-reference.md:255, 226-227`. |
| 44 | `a Volatile Area voter can never be gerrymandered, even with Election Fever` | `ok:false` `'voters in a Volatile Area cannot be moved'`. `reduce.ts:616`, `rules-reference.md:259`. Keep adjacent to 43 so the two are visibly distinct. |
| 45 | `a move between two zones where you hold NO rights is refused` | p1 holds rights in `north` only; try `central` -> `east` (both adjacent to `north`, neither is `north`). Expect `ok:false`. **FAILS today** - `reduce.ts:624-629` lets it through and charges the allowance to `north`. R6. |
| 46 | `a move into, out of, or within the rights zone is allowed` | Three sub-cases, each `ok:true`. Pins the reading of `rules-reference.md:253-254`. |
| 47 | `a move to a non-adjacent zone is refused` | `north` -> `south` -> `ok:false` `'zones are not adjacent'`. `reduce.ts:627-629`. |
| 48 | `a gerrymander into a Volatile Area queues exactly one Headline` | Assert `headlineQueue.length` +1 with `{areaId, by}`. **UNVERIFIED against the rulebook** - `rules-reference.md:259` forbids moving *out of* a volatile and `:271` permits placing into one, but never says a gerrymanded-into volatile triggers a Headline. Decide, then pin. R8. |
| 49 | `you may gerrymander an OPPONENT's voter` | p1 holds rights, moves a p2 peg. `ok:true` and the peg keeps `owner === 'p2'`. `reduce.ts:643`, `rules-reference.md:256`. |
| 50 | `rights gained mid-turn are usable the same turn` | Form a majority during your own turn, then gerrymander in that zone before `END_TURN` -> `ok:true`. `rules-reference.md:257`. |

### 3.5 RESOURCE CAP, overCap AND trimToCap (resources.ts:49-68, rules.ts:14, reduce.ts:100-110)

| # | test name | Assert: |
|---|---|---|
| 51 | `overCap is the TOTAL across all four resources, not per-resource` | `overCap({funds:6,clout:6,media:0,trust:0},12) === 0`; `overCap({funds:7,clout:6,media:0,trust:0},12) === 1`. Pins the §16 #3 decision (`rules-reference.md:377`) against the §6 wording at `:139` that contradicts it. D1 in §6. |
| 52 | `crossing the cap raises a lose-any choice naming exactly the excess` | 10 resources, gain 5. Assert exactly one `choices` entry `{player, choice:{kind:'lose-any', count:3, reason:'Resource cap'}}`. `reduce.ts:100-110`. |
| 53 | `a player with a pending cap choice cannot take any other action` | `INFLUENCE` -> `ok:false` `'resolve "Resource cap" first'`. `reduce.ts:428-431`, `rules-reference.md:110, 140`. |
| 54 | `the cap choice is not raised twice for the same player` | Gain 5, resolve to 12, gain 5 again -> exactly one open choice, not two. `reduce.ts:105-108` `already` guard. |
| 55 | `RESOLVE_CHOICE lose-any discards exactly the excess and unblocks the player` | Assert `poolTotal === 12`, `choices.length === 0`, and the next `INFLUENCE` is accepted. `reduce.ts:962-971`. |
| 56 | `trimToCap sheds from the largest pool first, deterministically` | `{funds:8,clout:2,media:2,trust:2}`, cap 12 (excess 2) -> `{funds:6,clout:2,media:2,trust:2}`. `resources.ts:57-68`. |
| 57 | `trimToCap is a no-op at or under the cap` | `trimToCap(p,12)` deep-equals `p` for totals 0 and 12. |
| 58 | `trimToCap terminates and never goes negative` | All-zero pool, cap 12 -> all zeros, function returns. The `break` at `resources.ts:63`. |
| 59 | `a TRADE that pushes the RECEIVER over the cap raises a choice for the receiver` | Assert `choices[i].player` is the receiver, not the trader. `reduce.ts:698-699`. |
| 60 | `takeResources floors at zero: a lose effect takes only what is held` | `lose:{funds:5}` against 2 funds -> funds reach 0, not -3. `reduce.ts:79`. |

### 3.6 POWER UNLOCK THRESHOLDS AT LEVEL 3 AND LEVEL 5 (powers.ts:110-118, rules.ts:23-24, rules-reference.md:200-205)

| # | test name | Assert: |
|---|---|---|
| 61 | `at 2 cards no power is unlocked; at exactly 3 the L3 power unlocks` | `unlockedPowers` for 0/1/2 cards is `[]`; at 3 Capitalist it contains `'prospecting'`. `rules.level3 === 3`. |
| 62 | `L5 unlocks at exactly 5, not 4` | 4 Capitalist -> `['prospecting']`; 5 -> `['prospecting','land-grab']`. Assert `'land-grab'` absent at 4. |
| 63 | `a power is usable in the SAME turn it unlocks` | Answer the 3rd Capitalist card then `POWER_PROSPECT` in the same turn -> `ok:true`. `rules-reference.md:203`. |
| 64 | `unlockedPowers is derived, never cached: losing a card loses the power` | 5 Capitalist, remove one from the manifesto -> `'land-grab'` gone. Locks in `powers.ts:4-7`. Coalitions (`rules-reference.md:296-300`) will exercise this. |
| 65 | `usesLeft returns 0 for a locked power even with counters at 0` | `usesLeft(lockedPlayer, RULES, 'prospecting') === 0`. `powers.ts:158`. |
| 66 | `each power's per-turn allowance matches the rulebook and the Nth use fails` | Table over all 8 `PowerID`s: Prospecting 1, Land Grab 3, Donations 2, Payback 2, Going Viral 2, Helping Hands 2, Tough Love 1, Election Fever passive. Assert the `(usesLeft+1)`-th attempt is `ok:false`. `rules.ts:61-71`. |
| 67 | `passiveBonus is floor(cards/2) per Ideologue, paid on the turn you answer` | 4 Capitalist + 1 Supremo -> `passiveBonus` is `{funds:2}`. 5 Capitalist -> `{funds:2}` (floor, not round). `rules.ts:20`, `rules-reference.md:194-196`. |
| 68 | `the threshold bonus applies in the very turn it is reached` | Answer the card taking Capitalist from 1 to 2; the 2nd Funds lands this turn. `reduce.ts:476-478`, `rules-reference.md:198`. |
| 69 | `Donations cannot be aimed at yourself` | `ok:false` `'snatch from someone else'`. `reduce.ts:798`. |
| 70 | `Tough Love rejects a mixed-owner or mixed-zone pair` | Both `ok:false`: `'both voters must belong to the same player'` and `'both voters must be in the same zone'`. `reduce.ts:844, 846`, `rules-reference.md:235-236`. |
| 71 | `Tough Love costs 2 Trust PLUS 2 of anything and rejects underpayment` | Assert `{trust:2,funds:1}` fails `'Tough Love costs 2 Trust plus 2 of anything'` and `{trust:2,funds:2}` succeeds. `reduce.ts:858-861`. |
| 72 | `a Volatile Area voter resists Land Grab, Payback and Tough Love alike` | Three sub-cases, all `ok:false`. `rules-reference.md:215, 221, 237`. |
| 73 | `a locked power is refused with its own specific message, not a generic one` | Assert the exact strings `'Prospecting is not available'`, `'Land Grab is spent for this turn'`, etc. Guards against a future generic-guard refactor masking which power failed. |
### 3.7 DETERMINISTIC RNG AND REPLAY (rng.ts, reduce.ts:138-151)

| # | test name | Assert: |
|---|---|---|
| 74 | `nextSeed is a pure 32-bit LCG step that never leaves int32 range` | 10k iterations; assert `Number.isInteger(s)` and `-2**31 <= s <= 2**31-1`. `rng.ts:9-11`. |
| 75 | `random is deterministic for a given seed and lies in [0,1)` | `random(42) === random(42)`; 10k samples all in `[0,1)`. |
| 76 | `random never returns exactly 1` | 100k samples, assert `max < 1`. `rng.ts:17` divides by `2**32` after `>>> 0`, so 1.0 is unreachable - this pins it. |
| 77 | `shuffle is a permutation: no element lost or duplicated` | Shuffle 129 items. Assert sorted-in equals sorted-out and `new Set(out).size === 129`. |
| 78 | `shuffle with the same seed yields the same order, and different seeds differ` | Deep-equal across two calls at the same seed; NOT deep-equal at a different seed (guards a seed-ignoring refactor). |
| 79 | `shuffle does not mutate its input` | Input array unchanged after the call. `rng.ts:22` copies. |
| 80 | `the engine never calls Math.random and never reads a clock` | Static assertion: read every `src/*.ts`, assert zero `Math.random` / `Date.now` / `new Date(` outside comments. **Verified clean today** - the only 3 `Math.random` hits are prose at `reduce.ts:5`, `rng.ts:2`, `state.ts:257`. This test makes the property permanent. |
| 81 | `drawing past the end of a pile reshuffles the discard and advances the seed` | Empty `_voterDraw`, 3 in `_voterDiscard`. Assert the returned card came from the discard and `state._seed` changed. `reduce.ts:141-147`. |
| 82 | `an empty draw pile AND empty discard returns null rather than throwing or looping` | Assert `draw(...)` yields `null` and the state is unchanged. `reduce.ts:143`. |
| 83 | `a full replay from seed + action log reproduces every intermediate state` | Record `(state, events)` after each of 200 actions in §3.1.1; replay and assert every recorded state deep-equals. **The test that catches R2** (module-level counters at `reduce.ts:88, 227`). |
| 84 | `choice ids and voter-group ids are stable across two identical replays` | Assert `choices[].id` sequences byte-identical between two runs from the same seed. Targets R2 directly. |

### 3.8 HEADLINE QUEUE RESOLUTION ORDER (reduce.ts:574-580, 891-932, rules-reference.md:265-273)

| # | test name | Assert: |
|---|---|---|
| 85 | `each voter placed in a Volatile Area queues exactly one Headline` | Place 3 voters, all volatile. Assert `headlineQueue.length === 3` as `[{areaId,by}]` in placement order. `rules-reference.md:272-273`. |
| 86 | `the queue drains in the order the voters were placed` | 3 queued with distinct ids a,b,c. Assert the `activeHeadline` sequence and the `log` entries appear a,b,c. `reduce.ts:901` slices index 0. |
| 87 | `placing a NON-volatile voter queues nothing` | `headlineQueue.length === 0` and no `volatile` event. |
| 88 | `Headlines resolve only AFTER the turn ends` | With 2 queued and `phase === 'actions'`, `ACK_HEADLINE` -> `ok:false` `'there are no Headline to resolve'`. `reduce.ts:892`. |
| 89 | `END_TURN with an empty queue goes straight to the next player` | `turn` incremented, `activePlayer` is the next seat, no `headline` event. `reduce.ts:920-922`. |
| 90 | `END_TURN is refused while headlines are pending` | `ok:false` `'resolve the Headline first'`. `reduce.ts:911`. |
| 91 | `a resolved Headline card is discarded and can return after a reshuffle` | Assert `cardId` lands in `_headlineDiscard`. `reduce.ts:903`. |
| 92 | `if the Headline deck is empty the queue is dropped and the turn advances` | Assert `headlineQueue === []`, `phase !== 'headlines'`, next player's turn. `reduce.ts:924-926` - the branch that prevents a permanent soft-lock. |
| 93 | `a Headline targeting opponents raises choices for THEM, resolvable mid-queue` | A headline with `target:'each-opponent'`. Assert `choices[].player` is each opponent and `RESOLVE_CHOICE` from a non-active player is accepted. `reduce.ts:250-266, 436`. |
| 94 | `an unplaced Voter Card group is discarded at end of turn; a partial placement leaves the remainder` | Place 2 of 3 then `END_TURN`. Assert the log reads `'1 unplaced voter discarded.'` and `pending === []`. `reduce.ts:366-376`, `rules-reference.md:165`. |
| 95 | `END_TURN is refused while ANY decision is unresolved` | `ok:false` `'there are unresolved decisions'`. `reduce.ts:912`. **Also pin the intended scope** - this check is global, so a player with no choices of their own is blocked by an opponent's. R7. |

### 3.9 setup() WITH 2..5 PLAYERS (§4 is the thing under test)

| # | test name | Assert: |
|---|---|---|
| 96 | `setup() rejects fewer than 2 players` | Throws `'Shasn needs at least 2 players'`. `setup.ts:15`. |
| 97 | `setup() rejects more than 5 players` | 6 players -> throws `'Shasn supports at most 5 players'`. `setup.ts:16`. |
| 98 | `setup() builds 9 zones totalling 129 areas and 11 volatile` | `zones.length === 9`, `sum(capacity) === TOTAL_AREAS === 129`, volatile count `=== 11`; cross-check against `scripts/gen-board.mjs:229-230`. |
| 99 | `every zone carries its own majority/capacity from the generated board` | Assert the map is exactly `{north_west:'6/11', north:'11/21', north_east:'6/11', west:'9/17', central:'5/9', east:'9/17', south_west:'6/11', south:'11/21', south_east:'6/11'}`. `scripts/gen-board.mjs:60-76`. |
| 100 | `the board starts with every area empty and every majorityHolder null` | `pegsFilled(z) === 0` and `majorityHolder === null` for all 9. `freshZones()` must not share area objects between calls. |
| 101 | `for n in 2..5: n players, turnOrder is the input order, activePlayer is the first` | `Object.keys(players).length === n`, `turnOrder` deep-equals input, `activePlayer === players[0]`, `round === 1`, `turn === 1`, `finished === false`. |
| 102 | `for n in 2..5: players get distinct colours from PLAYER_COLOURS` | `new Set(colours).size === n`, each a member of `PLAYER_COLOURS`, and `PLAYER_COLOURS.length >= 5`. `rules.ts:76-82`. |
| 103 | `for n in 2..5: every player starts with a FULL zero Pool, not a partial one` | `resources` deep-equals `{funds:0,clout:0,media:0,trust:0}`. A partial `{}` breaks `poolTotal` and `canAfford`. `state.ts:72` "Never partial". |
| 104 | `for n in 2..5: empty manifesto, manifestoCards, conspiracies, pending, and NO_POWER_USES` | Each `[]`; `powerUses` deep-equals `NO_POWER_USES`. `state.ts:140-149`. |
| 105 | `staggeredStart gives player n exactly n resources` | With `RULES.staggeredStart === true`, player i's total is `i+1`; sum over all players `=== n(n+1)/2`. `rules.ts:48-49`, `rules-reference.md:92-93`. |
| 106 | `the setup shuffle is seeded, not random` | Two `setup()` calls with the same seed and deck inputs give byte-identical `_ideologyDraw` order. Fails if `setup` reached for `Math.random` (§3.7 test 80). |
| 107 | `the first player's Ideology Card is already drawn and hidden` | `phase === 'answer'` AND `_pendingCard !== null` AND that id is in `_ideologyDraw ∪ _ideologyDiscard`. **The test that catches the current turn-1 soft-lock** (§2 B2). |
| 108 | `the market starts with exactly 3 face-up Voter Cards` | `market.length === RULES.marketSize === 3`, distinct ids, each resolving in `cards.voter`. `rules-reference.md:161-162`. |
| 109 | `all four draw piles and all four discard piles are initialised as arrays` | All 8 exist and are `Array.isArray`. |
| 110 | `_seed is an integer` | `Number.isInteger(state._seed)`. |
| 111 | `setup() output round-trips through playerView without crashing, for n in 2..5` | For every viewer, no `_` key at any depth. The end-to-end version of test 11. |
| 112 | `two setup() calls with different seeds produce different deck orders` | NOT deep-equal. Guards against the seed being threaded but unused. |
| 113 | `setup() does not share mutable state between boards` | Mutate one returned zone's area; assert a second `setup()` is unaffected. `freshZones()` (`board.ts:17-30`) rebuilds from `spec` each call - guards against someone caching `BOARD`. |

### 3.10 PHASE AND TURN-ORDERING INVARIANTS

| # | test name | Assert: |
|---|---|---|
| 114 | `a non-active player is refused every action except RESOLVE_CHOICE and the pre-answer conspiracy window` | Table over all 16 `Action` types: `reduce(state, other, a, ctx)` fails `'not your turn'` unless `RESOLVE_CHOICE` or (`PLAY_CONSPIRACY` while `phase === 'answer'`). `reduce.ts:435-438`. |
| 115 | `the active player CANNOT play a Conspiracy Card during the headlines phase` | Expect `ok:false`. `rules-reference.md:282-283` scopes conspiracy play to "during your turn" and "immediately before an opponent answers". **FAILS today** - `reduce.ts:436` exempts only non-active players. R9. |
| 116 | `any player may play a Conspiracy Card in the pre-answer window` | p2 plays while p1 is in `answer` -> `ok:true`. `rules-reference.md:283`. |
| 117 | `advanceTurn increments round only when the outgoing player was last in turn order` | `round` +1 exactly at the wrap. `reduce.ts:409`. |
| 118 | `powerUses reset for exactly one player - the incoming one` | New active player has `NO_POWER_USES`; the outgoing player retains theirs. `reduce.ts:398`. |
| 119 | `every action is refused once the game is finished` | `reduce(endedState, anyone, a, ctx)` fails `'the game is over'`. `reduce.ts:421`. |
| 120 | `a player with a pending decision can resolve only their own` | Another player gets `'that decision is not yours'`. `reduce.ts:945`. |
| 121 | `PLACE_VOTERS refuses a same-zone group split across two zones` | `'voters from one Voter Card cannot be split across zones'`. `reduce.ts:547-549`, `rules-reference.md:163-164`. |
| 122 | `PLACE_VOTERS allows a non-Voter-Card group to be split across zones` | An evicted or card-granted group (`sameZone:false`) split 1+1 -> `ok:true`. `state.ts:122`. |
| 123 | `PLACE_VOTERS refuses a duplicate area, an occupied area, and a count over the group` | Three sub-cases, three distinct error strings. `reduce.ts:536-546`. |
| 124 | `the market is refilled to 3 immediately after an INFLUENCE` | `market.length === 3` and the influenced `cardId` is in `_voterDiscard`. `reduce.ts:522-523`, `rules-reference.md:162`. |
| 125 | `a resource Delta with a NEGATIVE value is rejected or clamped everywhere` | Submit `{funds:-3, trust:3}` to `gain-any` and to `steal-any`; submit a negative `TRADE.give`. Assert no player gains resources. **FAILS today** - `deltaTotal` sums signed values and `addResources` never clamps. R3. **The single most important security test in the suite.** |
| 126 | `Ideology Cards cannot be traded` | Assert `TRADE` with `giveCards`/`receiveCards` moves only `conspiracies`. `rules-reference.md:144`. |
| 127 | `TRADE requires at least 1 resource from BOTH sides and forbids self-trade` | Four sub-cases. `reduce.ts:674, 679-681`, `rules-reference.md:142-143`. |
| 128 | `a redraw costs exactly 4 total and is refused on under- or overpayment` | `{funds:3}` and `{funds:5}` both `ok:false`; `{funds:2,trust:2}` `ok:true` and the pending card changes. `reduce.ts:446-449`, `rules-reference.md:106-107`. |
| 129 | `a conspiracy may only be bought if it is on top of the draw pile` | Assert `conspiracyTopCost` matches `cards.conspiracy[_conspiracyDraw[0]].cost` after every buy. `syncConspiracyTop` (`reduce.ts:172-180`), `rules-reference.md:281`. |
| 130 | `buying a conspiracy costs the printed total in ANY combination, less discounts` | `{funds:2,clout:2}` for cost 4 -> `ok:true`; `{funds:3,clout:2}` -> `ok:false`. `reduce.ts:716-717`, `rules-reference.md:280`. |
| 131 | `Helping Hands discounts apply to voter and conspiracy purchases and cap at 2 per turn` | 3 discounts -> `ok:false` `'not enough Helping Hands discounts left'`. `reduce.ts:499-501`, `rules-reference.md:231-233`. |
| 132 | `effects: refresh-market discards every open card and deals 3 fresh ones` | `_voterDiscard` grew by 3 and `market.length === 3`. `reduce.ts:307-310`. |
| 133 | `effects: draw-conspiracy puts the card in the player's hand, not on the board` | `conspiracies.length` +1. `reduce.ts:297-305`. |
| 134 | `the leader effect target resolves to nobody on a scoring tie` | `resolveTargets` returns `[]` when two players tie for most majority voters. `reduce.ts:218-223`. |
| 135 | `the leader effect target skips a zero-scoring player when someone else leads` | The zero player is not the target. `reduce.ts:221` (`v > 0`). |

### 3.11 COVERAGE MAP

| source file | tests |
|---|---|
| `reduce.ts` - all 16 `Action` cases, all 13 `Effect` ops, turn advance, choice resolution | 1-10, 20, 33-50, 59, 74, 81-84, 85-95, 114-135 |
| `board.ts` - `recount`, `boardFull`, `allMajoritiesFormed`, `scores`, `winners`, `totalVoters` | 2, 3, 21-32 |
| `state.ts` - `gerrymanderRights`, `tally`, `findZone/findArea`, `pegsOf/emptyAreas` | 30, 33-37, 50 |
| `resources.ts` - all 11 exports | 51-60, 125, 131 |
| `powers.ts` - all 9 exports | 61-73 |
| `rng.ts` - all 3 exports | 74-84 |
| `setup.ts` | 96-113 |
| `playerView.ts` - `playerView`, `allKeys` | 11-20, 111 |
| `cards.ts` - `indexCards`, `sidePayout` | 129, 130, + the different-sides assertion in the §3.0 fixture |
| `rules.ts` - every `Rules` field | 51, 59, 61-66, 101-105, 108, 129-131 |

**13 tests are expected to FAIL on first run** against the current source: 4, 5, 16, 29, 31, 45, 83, 84, 115, 125, plus 107 (soft-lock) and 108 (empty market).
That is the correct starting state - they are the regression tests for the fixes in §2 and §6.

## 4. `setup.ts` Rewrite Spec

### 4.1 Does the engine ever call `Math.random`? **No. Verified.**
- `Math.random` appears in exactly **3** places in `packages/engine/src/`, and all three are
  prose in comments: `reduce.ts:5` ("No clock, no I/O, no `Math.random`"),
  `rng.ts:2` ("The engine never calls `Math.random`"), `state.ts:257`
  ("Deterministic PRNG cursor. The engine never calls Math.random."). **Zero call sites.**
- `Date.now` / `new Date(` : **0 matches** anywhere in `src/`. No clock, no I/O.
- The only entropy is `rng.ts`: `shuffle(items, seed) -> [T[], newSeed]` (`rng.ts:21-33`),
  built on `nextSeed` (`rng.ts:9-11`) and `random` (`rng.ts:13-18`). Seed lives in
  `GameState._seed` (`state.ts:258`) and is advanced by `shuffle` on every reshuffle
  (`reduce.ts:144-145`).
- **Consequence for `setup()`**: it MUST NOT shuffle unseeded. Every shuffle in setup must go
  through `shuffle(x, seed)` with a seed the caller supplies, exactly as `reduce.ts:144` does.
  This is what test 106 (§3.9) locks in.
- **Caveat, verified**: the current `setup.ts:9` takes a pre-shuffled `ideologyDeck` from the
  caller, so it sidesteps the issue by not shuffling at all. The spec below takes a seed
  instead, which is stronger (the engine owns its own entropy) - but see §4.5.

### 4.2 Signature

```ts
import { EMPTY_POOL, NO_POWER_USES, type CardID, type GameState,
         type PlayerID, type PlayerState } from './state';
import { freshZones } from './board';
import { RULES, PLAYER_COLOURS, type Rules } from './rules';
import { shuffle } from './rng';

export type SetupOptions = {
  /** Seat order. Also the clockwise turn order and the colour order. */
  readonly players: readonly PlayerID[];
  readonly names?: Readonly<Record<PlayerID, string>>;
  readonly rules?: Rules;                       // default RULES
  /** Deck inputs. Omit to start every deck empty (headless / unit-test use). */
  readonly ideologyDeck?: readonly CardID[];
  readonly voterDeck?: readonly CardID[];
  readonly conspiracyDeck?: readonly CardID[];
  readonly headlineDeck?: readonly CardID[];
  /** Mandatory entropy. 32-bit int. Same seed + same inputs = same game. */
  readonly seed: number;
  /** Player n starts with n resources of their choice. Default: RULES.staggeredStart. */
  readonly startResources?: readonly Readonly<Record<PlayerID, Delta>>[];
  /** Populate the HQ Mat with 3 face-up Voter Cards. Default true. */
  readonly dealMarket?: boolean;
};
```

### 4.3 Body outline (transcribe this)

```ts
export function setup(opts: SetupOptions): GameState {
  const rules = opts.rules ?? RULES;

  // 1. Seat-count guards. rules-reference.md:26-40 supports 2..5; the 9-zone board
  //    is the 3-5 player board. 2-player needs the separate 2-3 player board
  //    (rules-reference.md:338-348) - NOT implemented, so 2 players on this board
  //    is a supported-but-approximate configuration. Flag it in PLAN.md.
  if (opts.players.length < 2) throw new Error('Shasn needs at least 2 players');
  if (opts.players.length > 5) throw new Error('Shasn supports at most 5 players');
  const ids = [...opts.players];
  if (new Set(ids).size !== ids.length) throw new Error('duplicate player id');
  const first = ids[0] as PlayerID;

  // 2. Board. freshZones() rebuilds Zone/Area objects from BOARD every call, so
  //    no two games can share mutable peg data. board.ts:16-31.
  const zones = freshZones();

  // 3. Seeded shuffle of every deck. NEVER Math.random. rng.ts:21.
  let seed = opts.seed | 0;
  const ide = shuffle(opts.ideologyDeck ?? [], seed);   seed = ide[1];
  const vot = shuffle(opts.voterDeck ?? [], seed);      seed = vot[1];
  const con = shuffle(opts.conspiracyDeck ?? [], seed); seed = con[1];
  const hed = shuffle(opts.headlineDeck ?? [], seed);

  // 4. Seat p1's starting resources. rules-reference.md:92-93:
  //    "Player n receives n resources of their choice." The CHOICE is the player's,
  //    so default to zero and let the client send it - do not invent a split here.
  const stagger = opts.startResources ?? (rules.staggeredStart ? [] : []);

  // 5. Players. Every PlayerState field is mandatory (state.ts:151-166) -
  //    there are no optional fields, so a partial literal is a compile error.
  //    That is exactly why the current setup.ts:29 fails.
  const players: Record<PlayerID, PlayerState> = {};
  ids.forEach((id, i) => {
    const start = stagger[i] ?? {};
    players[id] = {
      id,
      name: opts.names?.[id] ?? `Player ${i + 1}`,
      colour: PLAYER_COLOURS[i] as string,      // 5 colours, rules.ts:76-82
      resources: { ...EMPTY_POOL, ...start },  // start is a Delta; EMPTY_POOL fills the rest
      manifesto: [],
      manifestoCards: [],
      conspiracies: [],
      pending: [],
      powerUses: NO_POWER_USES,
      isBot: false,
    };
  });

  // 6. p1's Ideology Card is ALREADY drawn. reduce.ts:401-412 draws at turn
  //    advance, so setup must match or turn 1 is a soft-lock (see §2 B2).
  const [ideologyDraw, ideologyDiscard] = ide;
  const [voterDraw, voterDiscard] = vot;
  const [conspiracyDraw, conspiracyDiscard] = con;
  const [headlineDraw, headlineDiscard] = hed;
  const pendingCard = ideologyDraw[0] ?? null;
  const draw = pendingCard === null ? ideologyDraw : ideologyDraw.slice(1);

  let state: GameState = {
    zones,
    players,
    turnOrder: ids,
    activePlayer: first,
    phase: 'answer',
    turn: 1,
    round: 1,
    finished: false,

    // 7. HQ Mat. rules-reference.md:161-162: "Three open Voter Cards must
    //    always be available." NOTE: refillMarket (reduce.ts:158) is NOT
    //    exported, so inline the loop here, or export it and call it.
    //    With no voterDeck the market is legitimately empty - test 108 asserts 3.
    market: (opts.dealMarket ?? true)
      ? voterDraw.slice(0, rules.marketSize).map((cardId) => {
          const c = cardPool.voter[cardId];
          return { cardId, cost: c?.cost ?? {}, voters: c?.voters ?? 0 };
        })
      : [],

    // 8. Conspiracy cost is printed on the card BACK, so it is public
    //    (state.ts:227-228). No card data, just a number.
    conspiracyTopCost: null,     // syncConspiracyTop() fills this
    conspiracyRemaining: conspiracyDraw.length,

    headlineQueue: [],
    activeHeadline: null,
    choices: [],
    finalRoundFrom: null,
    log: [],

    // 9. All ten _ fields. The '_' prefix is load-bearing (state.ts:7-10):
    //    playerView strips by prefix, and the leak test (test 11) walks the graph.
    _pendingCard: pendingCard,
    _ideologyDraw: draw,
    _ideologyDiscard: ideologyDiscard,
    _voterDraw: voterDraw.slice(rules.marketSize),
    _voterDiscard: voterDiscard,
    _conspiracyDraw: conspiracyDraw,
    _conspiracyDiscard: conspiracyDiscard,
    _headlineDraw: headlineDraw,
    _headlineDiscard: headlineDiscard,
    _seed: seed,
  };

  return state;
}
```

### 4.4 Two things the above glosses over - decide before transcribing

**(a) `market` needs card data, and `setup()` has no `Ctx`.**
`MarketSlot.cost`/`voters` (`state.ts:209-213`) are copies of the Voter Card's numbers, and
`refillMarket` reads them from `ctx.cards.voter` (`reduce.ts:165-167`). `setup()` as specified
has no `cards` index. Two clean options:
- **Option A (recommended):** add a `cards: CardIndex` parameter to `SetupOptions` and use it
  for `market` and `conspiracyTopCost`. Keeps setup pure and total. The `cardPool` reference
  in step 7 above becomes `opts.cards.voter`.
- **Option B:** leave `market: []` in `setup()` and export `refillMarket` from `reduce.ts` so
  the caller can deal the market after constructing the state. Least churn, but the
  `phase: 'answer'` state exists briefly with an empty Mat.

Do not reach into a module-level singleton for card data.

**(b) `conspiracyTopCost` must be set, not left `null`.**
`BUY_CONSPIRACY` reads `state._conspiracyDraw[0]` directly (`reduce.ts:706`) so it is
unaffected, but `conspiracyTopCost` is the public field the client renders, and
`syncConspiracyTop` (`reduce.ts:172-180`) is not exported. If you take Option A, set
`conspiracyTopCost = opts.cards.conspiracy[conspiracyDraw[0] ?? '']?.cost ?? null` and
`conspiracyRemaining = conspiracyDraw.length` directly in the literal. Test 129 pins this.

### 4.5 The `startResources` design tension - UNVERIFIED, needs a decision
`rules-reference.md:92-93` says player *n* receives *n* resources **of their choice**. The
choice is a UI/negotiation step: the client must ask, the server must validate. Three
options, in order of preference:
1. **`startResources` is required when `RULES.staggeredStart` is true.** `setup()` throws
   `'staggered start requires startResources'`. Client flow: deal, ask each seat, then setup.
   This is what the spec above does and it is the most honest.
2. **`setup()` takes a `Delta` and validates `deltaTotal === n`.** Same thing with the check
   pushed into `setup()`.
3. **Defer: create a `'stagger'` `Phase`** and run a per-seat `RESOLVE_CHOICE` loop. Cleanest
   rules-wise (a seat could decline resources?) but it adds a 5th `Phase` variant and touches
   every `switch (state.phase)` site in `reduce.ts` - 9 of them. **Not worth it for M1.**

`rules-reference.md:92-93` is the only authority here. **UNVERIFIED**: whether a player may
*decline* the staggered resources (which would force option 3). Settle by re-reading p7.

### 4.6 Acceptance criteria for the rewrite
- [ ] `npm run typecheck` shows 0 errors in `setup.ts` (from 5).
- [ ] The returned object literal satisfies `GameState` with **no** `as` cast and **no**
      `as unknown as`. If you need a cast, a required field is missing.
- [ ] Test 97: 6 players throws. Test 96: 1 player throws.
- [ ] Test 107 passes - **no turn-1 soft-lock**. This is the single behavioural bug the
      rewrite exists to fix.
- [ ] Test 106 passes - two `setup()` calls at the same seed are byte-identical.
- [ ] `Math.random` count in `src/` is still 0 (test 80).
- [ ] Test 11 (secret leak) passes on `setup()` output for n in 2..5, all viewers.

---

## 5. `playerView.ts` Corrected Type

### 5.1 The full `_` inventory - strip ALL TEN, and only those

`GameState` (`state.ts:215-259`) has exactly **10** server-only fields. Every one is
`readonly`, typed, and listed in the `// SERVER ONLY` block at `state.ts:246`:

| # | field | type | source | what it leaks |
|---|---|---|---|---|
| 1 | `_pendingCard` | `CardID \| null` | `state.ts:248` | **THE GAME.** The card being answered blind. Leaking it ends the game permanently. |
| 2 | `_ideologyDraw` | `readonly CardID[]` | `state.ts:249` | the whole Ideology deck - every future answer |
| 3 | `_ideologyDiscard` | `readonly CardID[]` | `state.ts:250` | which answers have already been seen |
| 4 | `_voterDraw` | `readonly CardID[]` | `state.ts:251` | upcoming Voter Card costs |
| 5 | `_voterDiscard` | `readonly CardID[]` | `state.ts:252` | same |
| 6 | `_conspiracyDraw` | `readonly CardID[]` | `state.ts:253` | the top Conspiracy Card **identity** (its *cost* is public by design) |
| 7 | `_conspiracyDiscard` | `readonly CardID[]` | `state.ts:254` | which conspiracies are in circulation |
| 8 | `_headlineDraw` | `readonly CardID[]` | `state.ts:255` | upcoming Headlines |
| 9 | `_headlineDiscard` | `readonly CardID[]` | `state.ts:256` | same |
| 10 | `_seed` | `number` | `state.ts:258` | **the PRNG cursor** - reconstructs all four decks going forward |

Field 10 is the one people forget. A leaked `_seed` plus the already-revealed
`manifestoCards` and `activeHeadline` values is enough to replay every remaining draw.

**The current `Omit` lists 3 fields that do not exist** (`_deck`, `_pending`,
`_conspiracyDeck`) and omits all 10 that do.

### 5.2 What STAYS public, and why (exhaustive)

Everything else on `GameState` is public by design. Do not strip these:

| field | source | why it is public |
|---|---|---|
| `zones` | `state.ts:216` | the physical board; peg positions and `majority` flags are face-up |
| `players` | `state.ts:217` | names, colours, `resources`, `manifesto`, `manifestoCards` are all face-up or countable. **`conspiracies` and `powerUses` are the exceptions - see 5.4** |
| `turnOrder` / `activePlayer` | `:218-219` | public |
| `phase` / `turn` / `round` / `finished` | `:220-223` | public |
| `market` | `state.ts:226` | "three face-up Voter Cards" on the HQ Mat (`rules-reference.md:161-162`); cost and voter count are printed |
| `conspiracyTopCost` | `state.ts:227-228` | "the cost is printed on the back, so it is public" (code comment) |
| `conspiracyRemaining` | `state.ts:228` | a count. See the 5.4 note on deck-depth disclosure. |
| `headlineQueue` | `state.ts:232` | length and order are observable; `by` is the placer, already public |
| `activeHeadline` | `state.ts:234` | "the Headline currently face up and being resolved" - face-up by definition |
| `choices` | `state.ts:236` | the client must render "discard 3 resources". `Choice` carries only `kind`, `count`, `reason`, `from` - **no card id, no payout** (`state.ts:172-183`). Safe as-is. |
| `finalRoundFrom` | `state.ts:242` | announced publicly (`rules-reference.md` p20) |
| `log` | `state.ts:244` | see the 5.4 caveat - it quotes the answered text |

### 5.3 The corrected `ClientState`

```ts
import type { GameState, PlayerID } from './state';

/**
 * What a client is allowed to see. Ten `_` fields removed; two derived, non-revealing
 * fields added.
 */
export type ClientState = Omit<
  GameState,
  | '_pendingCard'
  | '_ideologyDraw'
  | '_ideologyDiscard'
  | '_voterDraw'
  | '_voterDiscard'
  | '_conspiracyDraw'
  | '_conspiracyDiscard'
  | '_headlineDraw'
  | '_headlineDiscard'
  | '_seed'
> & {
  /** Counts only. Never contents. Never which deck is about to be reshuffled. */
  readonly deckSizes: {
    readonly ideology: number;
    readonly voter: number;
    readonly conspiracy: number;
    readonly headline: number;
  };
  /** True while the active player has a card put to them. No card data. */
  readonly awaitingAnswer: boolean;
};
```

### 5.4 The corrected `playerView` - and the two fixes beyond the type

```ts
/** Per-player fields that are private but are NOT `_`-prefixed. R1. */
const PRIVATE_PLAYER_KEYS = ['conspiracies'] as const;

export function playerView(state: GameState, viewer: PlayerID): ClientState {
  const client: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith('_')) continue;          // the 10 fields, by convention
    if (key === 'players') {
      // Conspiracy hands are hidden from EVERYONE, including their owner.
      // p19: cards are "bought and held" (rules-reference.md:284-286). Shipping
      // them turns a bluffing mechanic into a solved one.
      const safe: Record<string, unknown> = {};
      for (const [pid, p] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        const clone = { ...p };
        for (const k of PRIVATE_PLAYER_KEYS) {
          clone[k] = (pid === viewer && false) ? clone[k] : [];   // always []
        }
        safe[pid] = clone;
      }
      client['players'] = safe;
      continue;
    }
    client[key] = value;
  }

  // Derived, non-revealing.
  client['deckSizes'] = {
    ideology:   state._ideologyDraw.length,
    voter:      state._voterDraw.length,
    conspiracy: state._conspiracyDraw.length,
    headline:   state._headlineDraw.length,
  };
  client['awaitingAnswer'] = state._pendingCard !== null;

  return client as unknown as ClientState;
}
```

Notes, each of which is a decision you should make consciously:

- **`(pid === viewer && false)` is deliberate and ugly.** It documents that there is no
  viewer-scoped exception, and makes a future "let the owner see their own hand" change
  explicit. If you would rather not carry it, write `clone[k] = []` with a comment. Do not
  leave the ternary as `pid === viewer ? ... : []` - that is the bug R1 in a plausible-looking
  form.
- **`conspiracyRemaining` (`state.ts:228`) duplicates `deckSizes.conspiracy`.** Pick one.
  Keeping both is harmless; deleting one is cleaner. Note that it is a *deck-depth*
  disclosure: a client that knows the depth and the discard count can infer a reshuffle is
  imminent. That is weak information, not a blind-answer leak, but decide it deliberately
  rather than by accident.
- **`log` is public and quotes the answer text** (`reduce.ts:482`,
  `` `"${side.answer}"` ``). That is safe *because* it is written after `ANSWER` commits, and
  the card is face-up under the mat thereafter (`rules-reference.md:190-191`). But add a test
  that asserts no log entry is written *before* the answer resolves - test 12 in §3.2 is the
  place.
- **`choices` is public.** A `gain-any`/`steal-any` `count` does leak the *size* of a
  conspiracy's payout to all players. That is inherent to rendering "take 3 resources from
  someone" and is a deliberate, small leak. Do not add card ids to `Choice` (`state.ts:172-183`)
  or it becomes fatal.
- **The `as unknown as ClientState` cast at `playerView.ts:31` is unavoidable** given the
  hand-rolled copy, but the leak test (test 11) is what makes it honest. That is the
  arrangement `state.ts:7-10` and `playerView.ts:11-13` describe, and it is the right one.

### 5.5 `allKeys` is already correct - keep it
`playerView.ts:35-41` recurses through arrays and nested objects and cycle-guards with `seen`.
That is exactly what the test needs, and it is why the test must be **structural** rather than
a field-by-field list: a `_` field added to `PlayerState` in a year is caught automatically
only if the strip is by prefix (which it is) AND the assertion is recursive (which it is).
Do not replace it with a hand-maintained key list - that is the failure mode
`playerView.ts:11-13` warns about, and the 10-vs-3 mismatch in the current `Omit` is proof
that hand-maintained lists rot.

---

## 6. Risks

### 6a. Logic bugs the compiler will never catch (all verified by reading, all still present)

| id | severity | location | bug | why the compiler misses it | test |
|---|---|---|---|---|---|
| **R2** | **CRITICAL** | `reduce.ts:88` `let choiceCounter = 0;` and `reduce.ts:227` `let groupCounter = 0;` | **Module-level mutable state makes `reduce` impure.** The header at `reduce.ts:3-6` claims "`reduce(state, player, action, ctx)` always yields the same result for the same inputs" and `rng.ts:2-5` claims a game is "reproducible from its seed and its action log". Both are false. Ids are `c${state.turn}-${choiceCounter}` (`:91`) and `g${groupCounter}` (`:240`), drawn from a counter that persists across games, across test files, and across any replay. Consequences: (a) a replay from seed + action log does **not** reproduce the state; (b) tests are order-dependent - a test that runs after another sees different ids; (c) two concurrent games on one process interleave their ids; (d) a server restart changes ids, so any client holding a `choiceId` across a deploy breaks. | Module-scope `let` is legal TypeScript. Nothing in the signature mutates it visibly. | 4, 5, 83, 84 |
| **R3** | **CRITICAL** | `deltaTotal` `state.ts:269-271`; `addResources` `reduce.ts:59-69`; `canAfford` `resources.ts:30-32`; `subtract` `resources.ts:21-28`; `takeResources` `reduce.ts:72-86` | **No `Delta` value is ever validated non-negative.** `deltaTotal` sums *signed* values, so `{funds: 3, trust: -2}` totals `1` and satisfies `deltaTotal(pick.res) !== c.count` in `gain-any` (`:956`), `lose-any` (`:964`) and `steal-any` (`:979`). `canAfford` compares `p.funds >= -3` which is trivially true. `takeResources` skips negatives via `if (got > 0)` (`:80`) so **nothing is deducted**, while `addResources` adds the positive entries uncritically. **Net: a client can mint resources.** Concretely: a `steal-any` choice of 2 from a victim holding 2 is satisfied by `{funds: 5, trust: -3}` - the victim loses nothing, the thief gains 5 Funds. Same class in `TRADE` (`:679-683`), `REDRAW_IDEOLOGY` (`:446-449`), `BUY_CONSPIRACY` (`:717-718`) and `POWER_TOUGH_LOVE` (`:858-862`, where `{trust:5, funds:-1}` pays 2 Trust instead of 4). | `Delta` is `Partial<Record<Resource, number>>` (`state.ts:75`) - `number` includes negatives. All four call sites typecheck. | 8, 125 |
| **R1** | **HIGH** | `playerView.ts:23-31`; `PlayerState.conspiracies` `state.ts:162` | **Every opponent's Conspiracy Card hand is shipped to every client.** `conspiracies` is a hidden hand (`rules-reference.md:284-286`: cards are "bought and held"), but it is **not** `_`-prefixed, so the prefix strip at `playerView.ts:26` does not touch it and `players` is copied wholesale. Same class of defect as the blind-answer leak the module's own docstring (`playerView.ts:4-9`) calls "the single most important function in this package" - but the docstring only reasons about `_` fields, so the test it specifies (`playerView.ts:11-13`) also only checks `_` fields and **passes**. | The state is structurally valid; nothing is mistyped. The leak is a *policy* error, not a type error. | 16, 17 |
| **R6** | **HIGH** | `reduce.ts:624-629` | **Gerrymander rights are checked in one zone and spent in another.** The guard computes `touchesRightsZone = from.zone === action.zoneId \|\| to.zone === action.zoneId`; if false it falls through to `const other = from.zone === action.zoneId ? to.zone : from.zone` (which is `from.zone`) and then only checks `rightsZone.neighbours.includes(other)`. So a move between two zones in which the player holds **no** rights is permitted as long as `from.zone` happens to neighbour the rights zone, and the allowance is charged to `action.zoneId` (`:660`). `rules-reference.md:253-254` scopes the right to "into that zone, out of it, or between it and an adjacent zone" - a move wholly outside the rights zone is not one of the three. | All the operands are `string`/`ZoneID`; the logic is wrong, not the types. | 45 |
| **R4** | **MEDIUM** | `board.ts:63` | **Two players can meet a zone's majority requirement simultaneously and the later board-scan order silently wins.** `for (const [p, n] of counts) if (n >= zone.majority) holder = p;` - no break, no tie handling. `Map` iteration order is first-appearance in `zone.areas`, so the winner is a function of zone geometry. `north_west` is 6/11, so 6+6 is reachable. This directly contradicts `gerrymanderRights` (`state.ts:314-324`), which *does* handle ties and returns `null` - so the two functions disagree about what a tie means, in the same file family, on the same board. `rules-reference.md:258` states "Ties give nobody rights" for gerrymandering and says nothing about majority ties. | `holder` is `PlayerID \| null`; the last-write-wins is perfectly type-safe. | 29 |
| **R9** | **MEDIUM** | `reduce.ts:435-438` + `:732-744` | **The active player may play a Conspiracy Card during the `headlines` phase.** The turn guard is `playerId !== state.activePlayer && !outOfTurnOk && action.type !== 'RESOLVE_CHOICE'`; for the active player the first clause is false, so the guard never fires. Unlike every other action, `PLAY_CONSPIRACY` (`:732`) has **no `state.phase !== 'actions'` check** - contrast `INFLUENCE` (`:494`), `GERRYMANDER` (`:598`), `TRADE` (`:671`), `BUY_CONSPIRACY` (`:705`), all six `POWER_*` cases. So a conspiracy can be resolved *in the middle of a partially-drained headline queue*, mutating the board and pushing new choices while headlines are pending. `rules-reference.md:282-283` scopes conspiracy play to "at any point during your turn" and "immediately before an opponent answers" - not during post-turn headline resolution. | Absence of a check is not a type error. | 114, 115, 116 |
| **R5** | **LOW** | `board.ts:129-135` | **`winners()` returns every player when all scores are 0.** `const best = Math.max(0, ...Object.values(s))` floors `best` at 0, so with an empty board `best === 0`, the `.filter(([,v]) => v === best)` matches everyone, and the `game-over` event (`reduce.ts:358`) reports all seats as winners. The `0` floor exists only to guard `Math.max(...[]) === -Infinity` for an empty `turnOrder`, which is impossible after `setup()` validates 2..5 players. | `Math.max` is variadic and total. | 31 |
| **R7** | **LOW** | `reduce.ts:912` | **`END_TURN` is blocked by *other players'* pending decisions.** `if (state.choices.length > 0) return fail('there are unresolved decisions')` is global, while the per-player freeze at `reduce.ts:428-431` is correctly scoped. So a player with no choices of their own cannot end their turn until every opponent has resolved. `rules-reference.md:140` freezes only "you". A conspiracy played out of turn (`rules-reference.md:283`) can therefore stall the table. | Both are array-length checks. | 95 |
| **R10** | **MEDIUM** | `reduce.ts:401-412` | **Ideology-deck exhaustion is a soft-lock.** `advanceTurn` draws a card and assigns `_pendingCard: cardId` (`:410`) without checking `cardId === null`. If `_ideologyDraw` is empty *and* `_ideologyDiscard` is empty, `draw` returns `null` (`reduce.ts:143, 149`) and the game enters `phase: 'answer'` with no card. `ANSWER` fails `'no card has been put to you'` (`:463`); `REDRAW_IDEOLOGY` fails `'no card to redraw'` (`:445`); `END_TURN` fails `'answer your Ideology Card first'` (`:910`). **No legal move exists.** Unreachable with a full 108-card deck, reachable in unit tests and in any partial-deck fixture. The headline path has the guard (`:924-926`); the ideology path does not. | `cardId` is `CardID \| null`, which `GameState._pendingCard` accepts. | 82, 107 |
| **R11** | **LOW** | `resources.ts:57-68` | `trimToCap` breaks ties by `RESOURCES` declaration order (`funds`, `clout`, `media`, `trust`) rather than by any rule, and sheds from `funds` first when pools are equal. Deterministic, so reproducible - but the result is a *rule decision* presented as a convenience. It is only reachable from bots and the "auto-discard" convenience (per its own docstring, `resources.ts:53-55`); the real path is the `lose-any` choice, which is player-chosen. Low impact, but the docstring implies it models good play. | - | 56, 57, 58 |
| **R12** | **LOW** | `reduce.ts:783`, `:826`, `:877` | `s.players[playerId]!` - non-null assertions after a mutation. Safe today because `grantVoters`/`setArea` cannot remove a player, but a future `evict`-the-player effect would make these throw at runtime with an opaque `TypeError` instead of a `fail(...)`. | `!` defeats the checker by design. | - |

### 6b. Where `docs/rules-reference.md` and the code disagree

| id | severity | doc says | code does | resolution |
|---|---|---|---|---|
| **D1** | **HIGH - the doc contradicts itself** | `rules-reference.md:139`: "**Resource cap: 12** (default; **per resource pool as shown on the player mat**)." But `rules-reference.md:377` (§16 #3) says the decision is "**Total, across all four resources.**" with a full argument for why. | `overCap` uses `poolTotal` (`resources.ts:49-51`) = **total**. `RULES.resourceCap: 12` (`rules.ts:14`) with the comment at `rules.ts:10-12` correctly arguing the total reading. | The **code is right and §6's wording at `:139` is stale.** Fix the doc: replace the parenthetical at `:139` with a cross-reference to §16 #3. This is not a code change. If the per-resource reading were ever correct, `overCap` and the whole cap-choice flow would need rewriting, and every cap test with it. |
| **D2** | **MEDIUM - doc is internally inconsistent, code picks a side** | p33 reference table (`rules-reference.md:244`): Supremo L3 = "**Snatch 2 resources**". But p30 (`rules-reference.md:218`): "Twice per turn, snatch **1** resource from another player. Both from one player or one each from two players." | `POWER_DONATIONS` (`actions.ts:51`) is `{from: PlayerID, res: Resource}` - **one player, one resource, per use**. `RULES.donationsPerTurn: 2` (`rules.ts:65`). This follows **p30**, which is the prose and therefore authoritative; the p33 table is compressing "twice per turn" into "snatch 2". | Code is right. Fix the **table cell** at `:244` to read "Snatch 1 resource, twice per turn". Low risk, but a reader building a bot from the table would implement it wrong. The same compression appears at `:245` ("Evict 3 voters" = 3 uses of 1, not 3 at once) and `:246` ("Discard 2 voters"). **Decide whether the p33 table is a per-turn-count summary and caption it as such.** |
| **D3** | **HIGH - doc claims a feature that does not exist** | `rules-reference.md:307`: "Implemented behind flags; **off by default**" - covering Elites (p22), Home Turfs (p23), Edge of Chaos (p24-25), and 2-Player Mode (p26-27). | **No flags, no code.** `PlayerState` (`state.ts:151-166`) has no `elites`, `homeTurfsUsed`, or `chaos` field. `Phase` (`state.ts:192-199`) has no chaos/auction variant. `reduce.ts` has no chaos tracker and no Home Turf resolution. The only trace is `excludeInTwoPlayer?: boolean` on `ConspiracyCard`/`HeadlineCard` (`cards.ts:89, 98`) which **nothing reads**, and `Effect` (`cards.ts:52-78`) has no chaos op. | **The doc is wrong.** Either implement the flags (large) or correct `:307` to "Not implemented; design recorded here for a future milestone." Do not ship a doc that claims a flag exists. |
| **D4** | **MEDIUM - doc describes rules the reducer cannot express** | `rules-reference.md:146-152` (Auction, p12/p34): bid up to your cap **without holding the resources**, IOU token, "cannot make any purchases until the bid is fully paid", minimum bid from the Reserve. | No auction exists. `Phase` has no auction variant; `PlayerState` has no IOU/debt field; `reduce.ts` has no auction path. Also `rules-reference.md:167` "If the draw pile empties, shuffle the discards" is implemented (`reduce.ts:141-147`) but the **auction winner's payment obligation is not**. | The doc does not claim auctions are implemented, but the reducer's action vocabulary (`actions.ts:8-64`) has no representation for "you owe 3". Either scope it out explicitly in PLAN.md or add a `PlayerState.debts` field. Flagging because it is a whole rules *system* silently absent from M1. |
| **D5** | **MEDIUM - doc describes a feature the data model cannot represent** | `rules-reference.md:294-301` (Coalitions): two players combine voters in a zone, majority split in a negotiated ratio, formalised by exchanging an Ideology Card, "only the coalition member with more voters gets Gerrymandering Rights", and a coalition breaks on withdrawal. | `Zone.majorityHolder` is `PlayerID \| null` (`state.ts:105`) - **a single player per zone, structurally**. There is no `coalitions` field on `GameState` or `PlayerState`, and no `WITHDRAW` action in `actions.ts`. `reduce.ts:596-597` (sic: the `GERRYMANDER` case) is entirely unaware of coalitions. | Doc does not claim coalitions are implemented, and `powers.ts:4-7` explicitly designs for them ("the same logic applies if cards ever leave a manifesto (coalitions do exactly that)"). **But `Zone.majorityHolder` must change shape before coalitions can land** - that is a breaking type change, best done now rather than after M1. Note R4: `recount`'s tie handling is the degenerate coalition case, so the R4 decision should be made coalition-aware. |
| **D6** | **LOW - unverified, needs a ruling** | `rules-reference.md:259` "Volatile Area voters cannot be gerrymandered" (about the **source**). `:269-271` "A peg in a Volatile Area is permanent" and "You may place **your own or an opponent's** voter into a Volatile Area". Nowhere does the doc say a voter *gerrymanded into* a Volatile Area triggers a Headline. | `reduce.ts:647-653` allows gerrymandering into a volatile area and queues a Headline for it, exactly as `PLACE_VOTERS` does. | **UNVERIFIED.** Two readings: (a) gerrymandering into a volatile area is a "placement" and triggers a Headline (current code); (b) the Headline is a property of *placing* a voter with your own supply, and a gerrymanded voter arrives under an existing Headline obligation. Settle from p18 directly, then pin with test 48. |
| **D7** | **LOW - unverified, needs a ruling** | `rules-reference.md:105` "The player **to your right** draws the top Ideology Card and reads both sides aloud to you." | `reduce.ts:401` draws inside `advanceTurn`, server-side, with no notion of who drew it. | Almost certainly fine - in a digital table the draw is the server's job and "who physically drew" is not observable. Listed only so it is a conscious non-decision, not an oversight. |
| **D8** | **LOW - likely fine, but note** | `rules-reference.md:168-169` "If no single zone has enough empty areas for a card's voters, **all voters from that card are discarded**." | Nothing auto-discards. `placeableAreas` (`reduce.ts:1041-1052`) filters the UI list, `PLACE_VOTERS` refuses a cross-zone split (`:547-549`), and `advanceTurn` (`:366-376`) discards leftovers. The *outcome* is right; the *path* is that the player is told `'voters from one Voter Card must all be placed together'` when the real situation is "there is nowhere legal to put these". | Cosmetic. If the UI is thin, consider auto-discarding when `placeableAreas` is empty so the player is not asked to do the impossible. |
| **D9** | **INFO** | `rules-reference.md:380` (§16 #6): "W and E hold 2 each; the other seven hold 1 each." | Confirmed correct: `scripts/gen-board.mjs:64-78` sets `volatile: 2` for west and east, `1` for the rest; `board.generated.ts` has exactly 11 volatile areas. | Agrees. Recorded because it is a countable claim about a generated file, so it is worth a test (98). |

### 6c. Findings that contradict the brief

| claim | verdict |
|---|---|
| "16 typecheck errors" | **TRUE.** Exactly 16, listed verbatim in §2. |
| "`packages/engine/test/` is EMPTY" | **TRUE.** The directory exists; `Get-ChildItem -Recurse -File` returns 0. `npx vitest run` -> `No test files found, exiting with code 1`. |
| "`docs/rules-reference.md` (19KB) exists and holds real rulebook extractions" | **TRUE.** 389 lines, 17 sections, page citations on every rule, plus a §16 "points the rulebook does not settle" and a §17 legal note. High quality. Its self-contradictions are D1 and D2. |
| "`rules.ts` contains mojibake ... Check whether other files are affected too" | **FALSE.** Zero `U+FFFD` bytes in any of the 13 `src/*.ts`, zero in `docs/*.md`, zero in root `*.md`. The `U+FFFD` appearance is a terminal rendering artifact of the box-drawing `U+2500` runs (`state.ts:76, 246`; `reduce.ts:47`; `cards.ts:11`). See §2 B5. No other file is affected because no file is affected. |
| "`reduce.ts` lines ~900-905: readonly-vs-mutable headlineQueue type errors" | **TRUE**, and the report is accurate about the line range. The cause is at `:901` and the fix is one annotation. |
| "`playerView.ts` does `Omit<GameState, '_deck'\|'_pending'\|'_conspiracyDeck'>`" | **TRUE**, verbatim at `playerView.ts:16`. But note the `Omit` itself does **not** raise a compile error - only the two field reads at `:29-30` do. The silent part is the dangerous part. |
| "`setup.ts` ... writes 'capital' and '_deck' onto state" | **TRUE**, and incomplete: `setup.ts` is wrong in **nine** ways, only two of which are the two the report names. The four silent ones - `zones[].pegs`/`lockedBy`, missing `_pendingCard`, empty `market`, missing `round` - are worse than the compile errors, because the compiler never sees them. |
| "M1 was believed complete" | **TRUE and worse than believed.** PLAN.md:192 ticks "`engine` package with a passing test suite"; PLAN.md:206 ticks "Exit criteria met: a full game plays to completion inside a test file"; PLAN.md:208 states "50 tests passing, `tsc --noEmit` clean." Actual: 0 tests, 16 errors, and the game cannot be constructed at all. A full game is not merely untested - it is **unreachable**, because `setup()` cannot produce a legal `GameState` and the active player would be soft-locked on turn 1 even if it could. |

### 6d. UNVERIFIED list - what would settle each

1. **Was mojibake ever in git history and since repaired?** `git log -p --follow -- packages/engine/src/rules.ts | Select-String "\uFFFD"`. No action needed either way.
2. **Does p18 say a gerrymanded-into Volatile Area triggers a Headline?** (D6 / test 48) Re-read p18. Currently a coin-flip.
3. **May a player decline the staggered starting resources?** (§4.5) Re-read p7. Decides whether `startResources` is required or optional.
4. **What happens on a majority tie within a zone?** (R4 / test 29) Not settled by the rulebook. `rules-reference.md` §16 lists six unsettled points and **majority ties are not among them** - so either it is settled somewhere in the doc I did not flag, or it is a genuine gap. Grep `rules-reference.md` for "tie": only `:91` (Player 1 election) and `:258` (gerrymander rights). **Genuine gap - needs a ruling.**
5. **How are scoring ties at game end broken?** `winners()` returns all tied players (`board.ts:129-135`) and `rules-reference.md` says nothing. Related to R5.
6. **Do the add-on modes in §14 belong to M1?** (D3) Check PLAN.md's milestone table; the doc says "Implemented behind flags" and nothing implements them.

---

## Appendix A - Board facts (from `board.generated.ts` / `scripts/gen-board.mjs`)

9 zones, 129 areas, 11 volatile. Sum of majorities = **69** (the maximum achievable score).

| zone | majority | capacity | volatile |
|---|---:|---:|---:|
| north_west | 6 | 11 | 1 |
| north | 11 | 21 | 1 |
| north_east | 6 | 11 | 1 |
| west | 9 | 17 | 2 |
| central | 5 | 9 | 1 |
| east | 9 | 17 | 2 |
| south_west | 6 | 11 | 1 |
| south | 11 | 21 | 1 |
| south_east | 6 | 11 | 1 |
| **total** | **69** | **129** | **11** |

Source: `scripts/gen-board.mjs:60-78`; generator asserts these totals at `:229-230`.

## Appendix B - Action and Effect coverage for the test author

`Action` (`actions.ts:8-64`) - 16 variants: `REDRAW_IDEOLOGY`, `ANSWER`, `INFLUENCE`,
`PLACE_VOTERS`, `GERRYMANDER`, `TRADE`, `BUY_CONSPIRACY`, `PLAY_CONSPIRACY`,
`POWER_PROSPECT`, `POWER_LAND_GRAB`, `POWER_DONATIONS`, `POWER_PAYBACK`,
`POWER_TOUGH_LOVE`, `RESOLVE_CHOICE`, `ACK_HEADLINE`, `END_TURN`.
All 16 appear in the §3.11 coverage map.

`Effect` (`cards.ts:52-78`) - 13 ops: `gain`, `lose`, `gain-any`, `lose-any`, `steal-any`,
`voters`, `evict`, `discard-voter`, `convert-voter`, `gerrymander`, `draw-conspiracy`,
`refresh-market`, `discount`. All 13 are handled in `applyEffect` (`reduce.ts:248-321`).
Ops with **no test in §3** and therefore a coverage gap worth noting: `gain`,
`lose-any` with `target`, `voters` with a non-`you` target, `evict`/`discard-voter`/
`convert-voter` via a card (as opposed to a power), and `gerrymander` (the bonus-move op,
`reduce.ts:289-296`, whose `__bonus` key at `:294` is a magic string read back at `:341`).
**`__bonus` deserves its own test** - it is a sentinel stored in the same `Record<string,number>`
as real per-zone counts (`state.ts:137`), so `powerUses.gerrymandered` is a mixed bag and
`playerView` ships it. It is a magic string with no type-level distinction.

## Appendix C - Command reference

```
npm run typecheck                        # 16 errors, ground truth in section 2
npx vitest run                           # "No test files found, exiting with code 1"
npx tsc --noEmit -p packages/engine      # same 16 errors, engine only
node packages/engine/scripts/gen-board.mjs   # regenerates board.generated.ts (asserts 129/11)
```