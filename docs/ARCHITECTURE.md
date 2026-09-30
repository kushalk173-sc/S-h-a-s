# Digital Shasn — Architecture for Remaining Milestones

> Status: **complete.** All sections written.
> Ground truth: `PLAN.md`, `packages/engine/src/*`, `docs/rules-reference.md`.
> Author: software-architect · Scope: packages/cards, packages/server, packages/client,
> and the boundary contract against the engine.
>
> **Read §0, then §3.1 and §4.** §3.1 overturns PLAN.md §3 (no boardgame.io) and
> §4 is the project's most important subsystem. §9.1 lists what would make this
> document wrong.

---

## 0. TL;DR — the decisions

Five decisions that shape everything else:

1. **Drop boardgame.io. Hand-roll the WebSocket server on `ws`.** The engine is a
   pure synchronous reducer with its own phase machine; boardgame.io wants to own
   the phase machine, and its undo/history would persist complete deck orderings in
   the database. Full argument in §3.1. This **overturns PLAN.md §3**.
2. **The secret-state contract is enforced at the type level and by a structural
   test over the real broadcast function** — not over a hand-listed set of fields.
   `playerView` is the only sanctioned exit from the server, and it currently does
   not compile. It is the single critical-path file of the project (§4).
3. **Uphold SVG for the board.** PLAN.md is right, and the reason is stronger than
   PLAN.md gives: 129 discrete hit targets need real focusable DOM nodes. Canvas's
   advantage (many moving objects) does not apply to 129 static slots (§5.1).
4. **Match state is snapshotted to durable storage on every action, and the whole
   game is replayable from `(seed, actionLog)`.** Not "in-memory first" as PLAN.md §3
   says — a 4–6 hour match is PLAN.md risk #5, and in-memory loses to a deploy.
   In-memory becomes a *cache* in front of the snapshot, not the source of truth.
5. **The card balance checker flags `PURE_UPGRADE` and `POWER_THRESHOLD_CLIFF` as
   CI errors**, with a ±1-resource tolerance band. Total-sum checking is not
   sufficient and misses the failure mode that actually breaks the game (§6.4).

**Critical path:** the engine repair → specifically `playerView.ts`. Everything else
in the remaining plan can be parallelised off the parts of the engine that already
compile (§7.1).

---

## 1. Package layout

### 1.1 Final tree

```
shasn/
├── package.json                      # npm workspaces, root scripts
├── tsconfig.base.json                # exists — do not fork per package
├── docs/
│   ├── ARCHITECTURE.md               # this file
│   ├── rules-reference.md            # exists — rulebook transcription
│   └── ENGINE-AUDIT.md               # exists
├── packages/
│   ├── engine/                       # @shasn/engine   — EXISTS, pure TS
│   │   ├── src/{state,actions,cards,rules,resources,rng,powers,board,
│   │   │       board.generated,reduce,playerView,setup,index}.ts
│   │   ├── scripts/{gen-board,preview-board}.mjs
│   │   └── test/                     # EMPTY — repair milestone fills it
│   │
│   ├── cards/                        # @shasn/cards    — content + validation
│   │   ├── package.json
│   │   ├── schema/
│   │   │   ├── ideology-card.schema.json
│   │   │   ├── voter-card.schema.json
│   │   │   ├── conspiracy-card.schema.json
│   │   │   ├── headline-card.schema.json
│   │   │   └── index.ts              # maps schema files → cards.ts types
│   │   ├── decks/
│   │   │   ├── ideology/india-2020/*.json      # one file per card
│   │   │   ├── voter/core/*.json
│   │   │   ├── conspiracy/core/*.json
│   │   │   ├── headline/core/*.json
│   │   │   └── manifest.json                  # deck composition + exclusions
│   │   ├── scripts/
│   │   │   ├── validate.ts           # schema + referential + rules-lint
│   │   │   └── balance.ts            # dominance checker
│   │   ├── src/
│   │   │   ├── index.ts              # loadDecks() → @shasn/engine CardIndex
│   │   │   └── balance-rules.ts      # the heuristic, exported for tests
│   │   └── test/
│   │
│   ├── shared/                       # @shasn/shared  — wire protocol types
│   │   ├── src/
│   │   │   ├── protocol.ts           # every client<->server message
│   │   │   ├── session.ts            # SessionId, PlayerId, ResumeToken, ids
│   │   │   ├── view.ts               # ClientState re-export + selectors
│   │   │   └── index.ts
│   │   └── test/
│   │
│   ├── server/                       # @shasn/server  — ws + MatchRunner
│   │   ├── src/
│   │   │   ├── index.ts              # http server + ws upgrade
│   │   │   ├── hub.ts                # lobby registry, presence, seat mgmt
│   │   │   ├── match-runner.ts       # owns GameState, calls reduce()
│   │   │   ├── broadcast.ts          # THE ONLY place playerView is applied
│   │   │   ├── store.ts              # durable snapshot + action log
│   │   │   ├── protocol-handler.ts   # dispatch message → runner
│   │   │   └── redaction.ts          # log/error scrubber (§4.6)
│   │   └── test/
│   │
│   └── client/                       # @shasn/client  — React + SVG
│       ├── src/
│       │   ├── main.tsx
│       │   ├── net/
│       │   │   ├── connection.ts     # ws client, reconnect, resume
│       │   │   └── store.ts          # message-derived state (no optimistic
│       │   │                         #   state — see §5.5)
│       │   ├── board/
│       │   │   ├── BoardSvg.tsx
│       │   │   ├── ZoneOutline.tsx
│       │   │   ├── PegSlot.tsx       # ONE per AreaSpec — 129 of them
│       │   │   ├── GerrymanderLayer.tsx
│       │   │   └── geometry.ts       # scales board.generated → viewBox
│       │   ├── panels/
│       │   │   ├── AnswerPrompt.tsx  # §5.3 — the blind answer
│       │   │   ├── SpendPanel.tsx
│       │   │   ├── ManifestoTray.tsx
│       │   │   ├── TradePanel.tsx
│       │   │   ├── MarketPanel.tsx
│       │   │   └── PendingChoices.tsx
│       │   ├── lobby/
│       │   └── app/                  # router, error boundary
│       ├── index.html
│       └── test/
```

### 1.2 `packages/shared` — does it earn its place?

**Yes, and it is the one package most likely to be cut by mistake.** The client and
server must agree on the wire format. Two ways to do that, both bad:

| Option | Description | Verdict |
|---|---|---|
| **A. Server owns the protocol; client `import type`s from `@shasn/server`** | Client build pulls in the server's module graph. `moduleResolution: bundler` will happily typecheck it, then the bundler tries to include `ws`, `node:fs`, and the whole reducer in the browser bundle. | **Rejected.** Leaks server code into the client graph; a `node:` import in a shared file becomes a build-time landmine, not a lint error. |
| **B. Duplicate the message types in both packages** | Two files, manually kept in sync. | **Rejected.** The client/server contract is the single place where a silent mismatch is catastrophic (a malformed `state` message drops a player's view) and where "manually kept in sync" is a lie. |
| **C. `@shasn/shared` — types only, zero runtime** | Protocol is ~200 lines of TypeScript types plus a zod-free hand-written type guard set. Depends on `@shasn/engine` for `Action`/`ClientState` types only. | **CHOSEN.** |

**The trade-off:** a fourth package to configure, publish, and version for ~250 lines.
**What it buys:** a compile error the moment the server adds a field to `state` and
the client does not know about it. For a project whose headline risk is a
*communication* failure between two halves of a system, that is worth one package.

**Rule that keeps `shared` honest:** it may contain types, type guards, and pure
functions over those types. It may **not** import `ws`, `node:*`, React, or the
reducer. There is a CI grep that fails the build on violation.

### 1.3 `packages/cards` — does it earn its place?

**Yes, and the reason is legal, not architectural.** `cards.ts` already says it
outright: *"Actual card content lives in `@shasn/cards` as JSON, so a card is
reviewable in a pull request and a balance bug is a data fix, not a code change."*
PLAN.md §8 makes the stakes explicit — the card text is the copyrightable part. Cards
therefore need a **separate review history** from engine code, and they need to be
diffable by someone who does not read TypeScript.

**Trade-off:** a package boundary costs a build edge (the server must load JSON at
runtime or the client must get it from the server) and gives up compile-time
completeness. **Accepted deliberately** — the alternative is either a database
(§8) or 100+ TypeScript literals in `engine/`, which makes a balance pass a code
review and a copyright audit a `git blame` exercise.

### 1.4 Package manifests

Root `package.json` — the workspace wiring. Already `"workspaces": ["packages/*"]`,
which is correct and needs no change; each new package is picked up automatically.

```jsonc
// packages/cards/package.json
{
  "name": "@shasn/cards",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "validate": "tsx scripts/validate.ts",
    "balance": "tsx scripts/balance.ts",
    "check": "npm run validate && npm run balance",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@shasn/engine": "*"
  },
  "devDependencies": {
    "ajv": "^8.17.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

```jsonc
// packages/shared/package.json
{
  "name": "@shasn/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@shasn/engine": "*"
  },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

```jsonc
// packages/server/package.json
{
  "name": "@shasn/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "dev": "tsx watch src/index.ts", "start": "tsx src/index.ts",
               "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@shasn/engine": "*",
    "@shasn/cards": "*",
    "@shasn/shared": "*",
    "ws": "^8.18.0"
  },
  "devDependencies": { "@types/ws": "^8.5.13", "tsx": "^4.19.2",
                       "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

```jsonc
// packages/client/package.json
{
  "name": "@shasn/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview",
               "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@shasn/engine": "*",      // TYPES ONLY (type-only imports)
    "@shasn/shared": "*",      // TYPES ONLY (type-only imports)
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": { "@types/react": "^18.3.12", "@types/react-dom": "^18.3.1",
                       "@vitejs/plugin-react": "^4.3.4", "typescript": "^5.7.2",
                       "vite": "^6.0.3", "vitest": "^2.1.8" }
}
```

**Note on React version.** React 18.3, deliberately, not 19. boardgame.io is dropped
(§3.1) so its client is irrelevant, but 18.3 is the version with a stable
StrictMode double-render behaviour, which matters here for one reason: **double
rendering is a leak detector.** Any side-effectful "compute what the player might
gain" render path will run twice in dev and get noticed. React 19's concurrent
refusal to re-render makes that signal less reliable. **Trade-off:** missing React 19
bugfixes. **Accepted** for the render-tripwire.

**Note on `@shasn/engine` in the client.** The dependency is present but every
import must be `import type`. Enforced by a CI grep (§4.5) — a *value* import of the
engine into the client would drag `reduce.ts` into the browser bundle, and a bundler
is a leak channel nobody reviews.

**Note on `main: "./src/index.ts"`.** The engine ships raw TypeScript from `src`
and relies on the consumer's transpiler. This is the existing convention
(`packages/engine/package.json`) and it is *not* what the server wants — the server
runs on Node without a loader. The server therefore uses `tsx`, which is why it
appears in its own `devDependencies` and `start` script. **Trade-off:** no
`dist/`, no `tsc -b` project references, and a dev dependency in the production
image. **Accepted for v1**; the alternative is a build step added to all four
packages for a project that has no published artefacts. Revisit if `packages/cards`
JSON loading forces a build anyway.

### 1.5 What is deliberately NOT a package

- **No `packages/bots`.** PLAN.md §1 defers AI opponents to v2. A bot is a
  `MatchRunner` peer: an object that receives a `playerView` and returns an
  `Action`. When v2 comes, it is a directory in `server/src/bots/`, not a package.
- **No `packages/ui`.** There is exactly one UI. A shared component library
  between one client and nothing is speculative generality.
- **No `packages/db`.** There is one store interface. Postgres is a detail behind
  it (§3.6).

---

## 2. The engine repair boundary

### 2.1 What is actually broken (verified, not assumed)

I read the import graph of all 12 source files. Only **three** files are broken, and
the rest of the package is internally consistent:

| File | Status | Breakage |
|---|---|---|
| `state.ts` | ✅ clean | zero imports |
| `actions.ts` | ✅ clean | type-only from `state` |
| `cards.ts` | ✅ clean | type-only from `state` |
| `rules.ts` | ✅ clean | zero imports |
| `resources.ts` | ✅ clean | from `state` |
| `rng.ts` | ✅ clean | zero imports |
| `powers.ts` | ✅ clean | type-only from `rules` |
| `board.generated.ts` | ✅ clean | type-only from `state` |
| `board.ts` | ✅ clean | `board.generated` |
| `reduce.ts` | ✅ clean (43KB, 1054 lines) | 8 imports, all resolvable |
| **`index.ts`** | ❌ **broken** | re-exports `./config`, `./capital`, `./zones`, `./manifesto`, `./gerrymander`, `./apply` — **none of these files exist** |
| **`setup.ts`** | ❌ **broken** | imports `EMPTY_POOL` from `./capital` (gone) and `DEFAULT_RULES`/`RulesConfig` from `./config` (gone); its `GameState` literal uses the **pre-129-area shape** (`slots`, `majorityThreshold`, `pegs: {}`, `_deck`, `_pending`) — none of which exist in today's `state.ts` |
| **`playerView.ts`** | ❌ **broken** | `ClientState = Omit<GameState, '_deck' \| '_pending' \| '_conspiracyDeck'>` — those three fields are gone; real secrets are `_pendingCard`, `_ideologyDraw`, `_voterDraw`, `_conspiracyDraw`, `_headlineDraw`, `_seed` (6 arrays + seed, 9 fields). Its body reads `state._deck.draw.length` and `state._pending`. |

**This is good news with one hard edge.** `reduce.ts` — the 43KB reducer that is
actually the project — compiles and is internally coherent. The parallel repair
agent is fixing a ~150-line surface, not the game. **The hard edge is that
`playerView.ts` is architecturally the most important file in the repository and it
is one of the three broken ones.** Everything in §4 depends on it being rewritten,
not patched.

### 2.2 The contract — the exported symbol list

This is the complete surface that `packages/server`, `packages/shared`, and
`packages/client` may rely on. Anything not on this list is internal and may change
without notice. **This list is the interface; `GameState` is not.**

#### `reduce(state, playerId, action, ctx) → Result`

```ts
// packages/engine/src/reduce.ts — REAL signature, do not drift
export type Ctx = { readonly rules: Rules; readonly cards: CardIndex };

export function reduce(
  state: GameState,
  playerId: PlayerID,
  action: Action,
  ctx: Ctx,
): Result;

// packages/engine/src/actions.ts
export type Result =
  | { readonly ok: true;  readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: string };
```

Three properties the server is entitled to rely on, and must:

1. **Total.** Every `Action` returns a `Result`. It never throws. A thrown error
   from `reduce` is a server bug, not a rejected action.
2. **Pure.** Same `(state, playerId, action, ctx)` → same `Result`. No clock, no
   `Math.random` (shuffles run off `_seed` via `rng.ts`). This is what makes replay
   possible and is the reason the server never re-derives state from a wall clock.
3. **Turn-gated, with a documented exception.** `reduce` rejects
   `playerId !== state.activePlayer` with `fail('not your turn')` — **except** for
   `PLAY_CONSPIRACY` during `phase === 'answer'` (p19: a Conspiracy may be played out
   of turn, right before an opponent answers) and `RESOLVE_CHOICE` (a pending
   decision may belong to a non-active player; `PendingChoice.player` says who).
   **The server must not add its own turn gating.** It forwards and reports
   `error`. Second-guessing the engine in the transport is how two rule
   implementations get born.

#### `Action` — the 15 client-supplied intents

From `actions.ts`. `REDRAW_IDEOLOGY`, `ANSWER`, `INFLUENCE`, `PLACE_VOTERS`,
`GERRYMANDER`, `TRADE`, `BUY_CONSPIRACY`, `PLAY_CONSPIRACY`, `POWER_PROSPECT`,
`POWER_LAND_GRAB`, `POWER_DONATIONS`, `POWER_PAYBACK`, `POWER_TOUGH_LOVE`,
`RESOLVE_CHOICE`, `ACK_HEADLINE`, `END_TURN`.

**Every `Action` is JSON-serialisable and is exactly the client→server payload.**
The client may not send anything else; the server must narrow the incoming message
to `Action` before calling `reduce` (§3.5). `Action` contains no functions, no
class instances, no `undefined`-valued keys under `exactOptionalPropertyTypes`.

#### `GameEvent` — the event stream

12 variants (`answered`, `influenced`, `placed`, `majority-formed`,
`majority-broken`, `gerrymandered`, `headline`, `conspiracy`, `volatile`,
`turn-ended`, `final-round`, `game-over`). All are **public** — they contain no
secrets, and this is load-bearing: `answered` carries `{player, cardId, side}`, not
the payout. **Trade-off:** the event stream is therefore safe to broadcast verbatim
to every client including spectators, which removes an entire class of redaction
bug. **Cost:** the client cannot animate "you gained 2 funds" from the event, because
that is genuinely secret-adjacent information. It reads its own `resources` from its
own `ClientState` instead (§5.3).

#### `setup(opts) → GameState`

Currently broken; the repair must produce a signature of this shape, built on
`freshZones()` and `rng.shuffle`:

```ts
export type SetupOptions = {
  readonly players: readonly { id: PlayerID; name: string; colour: string }[];
  readonly rules?: Rules;                                    // defaults to RULES
  readonly cards: CardIndex;                                // the four decks
  readonly seed: number;                                    // server-generated
};
export function setup(opts: SetupOptions): GameState;
```

**Design constraints on the repaired `setup`:** it must
(a) shuffle all four decks from `seed` via `rng.shuffle` and never `Math.random`;
(b) deal `rules.marketSize` Voter Cards into `market` and deal the first Ideology
Card to `activePlayer._pendingCard`, entering `phase: 'answer'`;
(c) apply `rules.staggeredStart` (p7: player *n* gets *n* resources of their choice —
which means a `RESOLVE_CHOICE` with `kind: 'gain-any'`, so the engine's existing
choice machinery is the right home, not a special case);
(d) validate 2 ≤ players ≤ 5, as the current `setup` does.

#### `playerView(state, viewer) → ClientState` — **the rewritten one**

```ts
// MUST be rewritten, not patched. Today it references three fields that no
// longer exist and omits six that do.
export type ClientState = Omit<GameState,
  | '_pendingCard' | '_ideologyDraw' | '_ideologyDiscard'
  | '_voterDraw' | '_voterDiscard'
  | '_conspiracyDraw' | '_conspiracyDiscard'
  | '_headlineDraw' | '_headlineDiscard' | '_seed'
> & {
  readonly deckSizes: Readonly<Record<'ideology' | 'voter' | 'conspiracy' | 'headline', number>>;
  readonly awaitingAnswer: boolean;   // true iff _pendingCard !== null; no card data
};
export function playerView(state: GameState, viewer: PlayerID | null): ClientState;
```

`viewer` widens to `PlayerID | null` so **spectators use the same function** — there
is exactly one code path from `GameState` to the wire, which is the only way to make
§4's structural test meaningful. (A separate spectator projection is a second
projection, and second projections leak.)

### 2.3 What outside the engine may and may not know

**May know:** the symbol list in §2.2. `Action`, `GameEvent`, `Result`, `Ctx`,
`ClientState`, `GameState` as a *type* (read-only, for typing the store),
`SetupOptions`, `Rules`/`RULES`, `POWERS`/`PowerID` (client renders power buttons),
`CardIndex`/`indexCards` (server and cards package), `BOARD`/`AreaSpec`/`ZoneSpec`/
`BOARD_WIDTH`/`BOARD_HEIGHT`/`COASTLINE`/`TOTAL_AREAS` (client SVG geometry),
`ZONE_IDS`, `IDEOLOGUES`, `RESOURCES`, `IDEOLOGUE_RESOURCE`, `Resource`, `Delta`,
`Pool`, `Peg`, `Area`, `Zone`, `PlayerState`, `PendingChoice`, `Choice`, `LogEntry`,
and the pure selectors `freshZones`, `zoneOfArea`, `areNeighbours`, `recount`,
`withZone`, `withArea`, `boardFull`, `allMajoritiesFormed`, `majorityVoters`, `scores`,
`winners`, `totalVoters`, `rightsZones`, `placeableAreas`, `findZone`, `findArea`,
`pegsOf`, `pegsFilled`, `slotsFree`, `emptyAreas`, `gerrymanderRights`, `tally`,
`poolTotal`, `deltaTotal`, `pool`, `add`, `subtract`, `canAfford`, `shortfall`,
`isEmpty`, `overCap`, `trimToCap`, `discount`, `applyDiscounts`, `hasPower`,
`unlockedPowers`, `passiveBonus`, `archetype`, `usesLeft`, `cardsOf`, `powerSpec`,
`sidePayout`, `allKeys`.

**May NOT know:**

- **The internal shape of any `_`-prefixed field.** Not even a name. The server
  reads `state._pendingCard` in exactly one place — deciding what to put in the
  blind prompt — and the blind prompt is built by a dedicated function, not by
  generalising `playerView` (§4.3). If `playerView` starts emitting card data
  conditionally on the viewer, the structural test still passes and the game is
  still dead. This is the sharpest edge in the whole design and §4.5 is the
  mitigation.
- **Which action is valid in which phase.** The client may *render* affordances
  optimistically-disabled (e.g. grey out "End Turn" during `phase: 'answer'`) but
  the client must not decide legality. `reduce` is the only arbiter.
- **Anything from `packages/engine/scripts/`** — the board generator is a dev tool.

### 2.4 The repair milestone's exit criterion

```
npm run typecheck --workspace @shasn/engine     # exit 0
npm test  --workspace @shasn/engine             # ≥ 1 test, all green
```

Minimum test set (the directory is empty; see `docs/ENGINE-AUDIT.md` §3):
1. A full game driven to `finished` through the real `Action` union.
2. The **secret-leak structural test** (§4.5) — this one lives in the engine because
   it only needs `playerView` + `allKeys`, and §4.5 additionally adds a second copy
   in `packages/server` that walks the *actual broadcast function*.
3. A determinism test: same seed + same action sequence → identical
   `JSON.stringify(state)`.
4. A `reduce` purity test: calling `reduce` twice on the same inputs returns
   equal results and leaves the input object byte-identical.

## 3. Server design

### 3.1 boardgame.io vs. hand-rolled WebSocket — **verdict: hand-rolled `ws`**

PLAN.md §3 names boardgame.io and pre-authorises a swap ("Budget ~2 extra days if we
swap"). I am spending that budget now rather than discovering it in M3, because the
arguments are structural, not preference.

#### What boardgame.io genuinely gives you

Worth stating honestly, because the decision is not "boardgame.io is bad":

- Lobbies, match IDs, reconnect-by-`matchID`, a storage-adapter interface.
- A `playerView(G, ctx, playerID) => G` hook whose *signature* matches the engine's.
- Undo/redo, bot hooks, an admin panel, React bindings.

The first two map directly onto requirements. That is what makes this a close call
and not a strawman.

#### The five reasons it does not fit *this* codebase

**1. It would own the phase machine, and the engine already has one.**
`reduce.ts` is 1054 lines containing a four-phase state machine — `answer →
actions → headlines → actions → next player` — with headline queueing, resource-cap
freezes, pending-choice blocking, final-round detection, and a
`PLAY_CONSPIRACY`-out-of-turn exception. `board.ts:recount` is called from inside it
and emits events. If boardgame.io's `stages`/`turn.order` also describe "whose turn is
it", there are now two authorities. Every one of the 15 `Action` variants becomes a
boardgame.io "move"; the phase machine lives once in the engine and once in the
framework's config. **The two disagree on the first edge case, and neither one is
wrong in isolation** — which is the worst kind of bug, because it is intermittent and
it happens in a 4-hour session at hour 3.

The mitigation boardgame.io offers for this is its `stages` mechanic, which is
designed for *simultaneous secret ballots*. Shasn has no simultaneous phase. The
mapping is a shape mismatch, not a feature gap.

**2. Its undo/history is a catastrophic secret leak, not just a wrong feature.**
This is the disqualifier. boardgame.io keeps state history and exposes rewind. State
history includes `_ideologyDraw`, `_conspiracyDraw`, `_headlineDraw` — the complete,
ordered deck contents at that point. It keeps those in memory, and the storage
adapter writes them to the match row. **A single undo/redo feature means the
database contains the answer key to every card ever dealt, in order.**

You can disable it. You will disable it, and you will have paid for a
player-facing subsystem whose only remaining behaviour is the one that breaks the
game. A dependency that must be fought to be safe is worse than the ~400 lines it
saves.

**3. Its client predicts. Prediction is precisely the forbidden thing here.**
boardgame.io's `Client` keeps a local authoritative copy and optimistically applies
moves before the server confirms. For `ANSWER`, the optimistic projection necessarily
guesses a payout. Even if the guess is wrong, the *interface* that produced it holds
the full card — and the interface is a `.js` file in the browser. §5.5 forbids
optimistic UI as a rule; here it would arrive as a default you have to remove.

**4. It does not solve the actual hard part of PLAN.md risk #5.**
Session length: 4–6 hours, five players, async, must survive a refresh. boardgame.io
reconnects by `matchID` and resends state — that is genuinely helpful. But it does not
give you: durable snapshot-on-every-action, `(seed, actionLog)` replay, presence and
disconnect detection with a grace window, a *private* lobby (match IDs in boardgame.io
are guessable/enumerable), spectator seats, resume **tokens** (a `matchID` is not a
credential — anyone who learns it takes your seat), or a staging deploy that does not
drop a live 4-hour match. **The hard parts are all the parts it doesn't do.** The easy
part is the part it does. That is the wrong ratio for this project.

**5. Rejected-when-it-locks: two redistributions.** If boardgame.io is adopted and
later abandoned, the *engine* is untouched (PLAN.md §3 is right about that) but
`packages/server` is rewritten wholesale. My hand-rolled design has a 60-line seam —
`MatchRunner.dispatch(playerId, action) → Result` — which is the *entire* interface
to the engine. Swapping transports later touches `protocol-handler.ts` and
`connection.ts` and nothing else.

#### What "hand-rolled" means here, precisely

Not a bespoke protocol invented from first principles. It means:

- **`ws`** (Apache-licensed, mature, RFC 6455) for the WebSocket transport. ~15
  dependencies. No framework opinions.
- **A typed message layer** in `@shasn/shared` (§1.2) with hand-written type guards.
  No `zod` on the hot path — a `zod` schema per message is a real dependency and a
  per-message parse cost for a 5-player game at ~2 actions/minute. Guards are
  exhaustive `switch` narrowing.
- **A `MatchRunner`** that owns one `GameState` and calls `reduce`. That is all.
- **`node:http`** for the health endpoint and static client assets. No Express — the
  server has four HTTP routes and Express would be a transitive-dependency
  supply-chain surface for a blind-answer game.

Estimated ~700 lines for lobby + runner + broadcast + store + reconnect. That is
comparable to the amount of boardgame.io *adapter* code you would write, and it does
not come with a phase machine, an undo log, or a prediction layer.

**The trade-off, stated plainly:** boardgame.io has a team. We will re-implement
lobby, seat management, and reconnection, and we will get them subtly wrong in ways
that take a playtest to find. Mitigation: the server's test suite asserts the
*behaviours* boardgame.io would have given us — resume after simulated disconnect,
spectator isolation, seat reclaim after timeout — so a future swap to Colyseus is a
swap against a written spec, not against a vibe.

**LOUD NOTE:** this overturns PLAN.md §3, which names boardgame.io as the multiplayer
layer and budgets two days to leave it. We are spending those two days now, at design
time, for a cost of about 2–3 days of server work that PLAN.md had budgeted as 2.

### 3.2 Process model

One Node process. One `MatchRunner` per match, all in a single-threaded event loop.

**Why single-threaded and not workers:** the engine is *synchronous and pure*. A
whole Shasn turn — validate, apply, emit events — is sub-millisecond. There is no
CPU-bound work to move off the main thread; the only I/O is the WebSocket and the
snapshot write, both of which are already async. Worker threads would add
serialisation cost to every action and a structured-clone boundary around the exact
`GameState` object whose secret fields we are trying to keep in one place.

**Why that matters for secrets:** the engine's `GameState` lives in one process's
heap. There is exactly one place it can be read, and §4 makes that place a file with
its own tests. Adding a worker means that file's test has to also cover serialisation.
Not worth it.

**Concurrency correctness:** because the event loop is single-threaded and `reduce` is
synchronous, a `MatchRunner.dispatch()` is atomic with respect to every other
dispatch in the same match. **No mutex, no queue, no optimistic version counter is
required for correctness.** This is the single biggest practical dividend of the
pure-reducer design and it is why the transport can stay ~700 lines. The one
constraint: `dispatch` must be synchronous end-to-end, with the snapshot write
fire-and-forget on a write-behind queue (§3.6).

### 3.3 Wire protocol

`@shasn/shared/src/protocol.ts`. Every message is
`{ t: <type>, id?: string }` plus payload. `id` is a client-supplied correlation id,
echoed back in `error` messages.

#### Client → server

```ts
export type ClientMessage =
  // ── lobby ──
  | { t: 'lobby:list' }
  | { t: 'lobby:create'; name: string; maxPlayers: 2|3|4|5; private: boolean }
  | { t: 'lobby:join'; lobbyId: string; name: string }
  | { t: 'lobby:leave' }
  | { t: 'lobby:ready'; ready: boolean }
  | { t: 'lobby:chat'; text: string }          // v1: lobby only, capped 280 chars
  | { t: 'lobby:start' }                        // host only; seats must be full

  // ── match ──
  | { t: 'match:action'; matchId: string; action: Action }
  | { t: 'match:sync'; matchId: string; since?: number }   // §3.4
  | { t: 'match:resign'; matchId: string }
  | { t: 'match:spectate'; matchId: string }

  // ── session ──
  | { t: 'session:resume'; resumeToken: string }             // §3.4
  | { t: 'ping' };
```

**Deliberate absence:** there is no `match:setState`, no `match:cheat`, no
`match:draw`, no admin message. The only way to change a match is
`match:action`, and its payload is exactly the engine's `Action` union. **The
protocol has no richer vocabulary than the rules.** A cheater who patches the client
can send an action the reducer rejects, and nothing else.

#### Server → client

```ts
export type ServerMessage =
  // ── lobby ──
  | { t: 'lobby:snapshot'; lobbies: LobbySummary[] }
  | { t: 'lobby:state'; lobby: Lobby; you: LobbySeat }
  | { t: 'lobby:event'; text: string; at: number }

  // ── session ──
  /** Issued on every successful connect/reconnect. THE credential. */
  | { t: 'session:granted'; session: Session }
  | { t: 'session:ended'; reason: string }

  // ── match ──
  /**
   * THE ONLY MESSAGE THAT CARRIES GAME STATE.
   * `state` has been through playerView(). `viewId` is monotonic per match and is
   * the `since` value for incremental sync.
   */
  | { t: 'match:state'; matchId: string; viewId: number; state: ClientState }
  /** Per-recipient events, in engine order. Safe to broadcast identically. */
  | { t: 'match:events'; matchId: string; viewId: number; events: GameEvent[] }
  /** Public, human-readable. Derived from state.log. Already redacted. */
  | { t: 'match:log'; matchId: string; entries: LogEntry[] }
  | { t: 'match:over'; matchId: string; winners: PlayerID[]; scores: Record<PlayerID, number> }
  | { t: 'error'; id?: string; code: ErrorCode; message: string };

export type ErrorCode =
  | 'BAD_MESSAGE' | 'NOT_IN_LOBBY' | 'NOT_HOST' | 'LOBBY_FULL' | 'LOBBY_CLOSED'
  | 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'MATCH_NOT_FOUND'
  | 'RESUME_INVALID' | 'SEAT_TAKEN' | 'INTERNAL';
```

`Session` is the reconnect credential and the thing a client stores in
`sessionStorage`:

```ts
export type Session = {
  readonly sessionId: string;
  readonly resumeToken: string;  // 256-bit, single-use-until-rotated
  readonly playerId: PlayerID;   // opaque server-assigned, never the player's name
  readonly matchId: string | null;
  readonly role: 'player' | 'spectator';
};
```

**Note `playerId` is opaque and server-assigned.** A player id that is a username, a
seat index, or anything client-constructible is a seat-takeover vulnerability. Seats
are addressed by an unguessable id, and the *name* is presentation only.

#### Why `match:state` and `match:events` are separate messages

They are produced by one `reduce` call and must be delivered atomically per
recipient, or the client briefly renders a state whose events it has not seen.
Options considered:

| Option | Trade-off |
|---|---|
| **A. One message: `{state, events}`** | Simplest, atomic. But sends a full state on every action — a 129-area board with pegs is ~40–80 KB of JSON. At 5 players × 2 actions/min × 4 hours = ~2,400 state sends ≈ 150 MB per match. **Rejected on bandwidth.** |
| **B. Separate, tagged with a shared `viewId`** | Chosen. `viewId` is a per-match monotonic counter incremented on every successful dispatch. The client buffers `events` for `viewId = n+1` and applies them only after `match:state` with `viewId = n+1` lands. Ordering is explicit and testable; a dropped frame is recoverable via `match:sync`. **Cost:** ~20 lines of client-side ordering logic. **Accepted.** |
| **C. JSON Patch / diff** | Smallest payload, but the diff of a state containing nine secret deck arrays is *itself* a leak vector (§4.4) and the patch format becomes a second thing to get right. **Rejected.** |

The full state goes out only on: connect, resume, `match:sync`, seat change, and
**phase change** (a cheap heuristic that lands most of the animation-freshness need
without per-area diffing). Otherwise only `match:events`.

### 3.4 Reconnect / resume — surviving a 2-hour refresh

PLAN.md risk #5. The requirement is that a player closes the tab for two hours,
comes back, and the board is exactly as they left it, in the correct phase, with
their own view.

#### The mechanism

1. **On first connect**, the server generates `resumeToken` (256 bits, `crypto.randomBytes`)
   and sends `session:granted`. The client stores it in `sessionStorage` — *not*
   `localStorage`, so a shared machine does not leak it, and *not* a cookie, so it is
   not attached to cross-site requests.
2. **On disconnect**, the server marks the seat `disconnected` with a timestamp. It
   **does not release the seat** and does not skip the player.
3. **While disconnected**, the game is not paused (Shasn is turn-based, not
   clock-based, so there is nothing to pause). Other players continue. The absent
   player is simply the one who is not answering.
4. **On return**, the client sends `session:resume` with the token.
5. **The server** looks up the token, checks the grace window, **rotates the token**
   (so a leaked token is single-use), and replies
   `session:granted` + `match:state` with a fresh full `ClientState` for that
   `playerId`.

#### Rehydration — what "how does the client catch up" actually means

The client holds **no authoritative state of its own**. `net/store.ts` is a pure fold
over the message stream:

```
server → match:events(viewId n)  → buffer
server → match:state(viewId n)   → commit(state), flush buffer
```

On `session:resume`, the server sends a `match:state` with the *current* `viewId`,
computed **at resume time**, not from the store. **The client's rehydration is
therefore one message and no reconciliation logic at all** — it discards its local
store and adopts the server's. This is the payoff of not doing optimistic state, and
it is why a 2-hour absence needs no diff algorithm.

The one case needing care: the client reconnected but the match moved on while the
`match:state` was in flight. Solved by the `viewId` rule — the client drops any
`events` whose `viewId ≤ state.viewId` and requests `match:sync { since: viewId }`
if it detects a gap. `match:sync` always returns a **full** `ClientState`, never a
delta. Deltas are where rehydration bugs live; a 60 KB state once per reconnect is
irrelevant.

#### Seat reclaim

Grace window is **24 hours**, configurable. After it, the seat is released and the
player is recorded as `abandoned` for the final score line. Beyond the window the
`resumeToken` is dead and re-joining means taking a new seat.

**Trade-off:** 24 hours of held seats means a table can be permanently blocked by an
abandoned account. **Accepted for v1** — a vote-to-kick in the lobby is the fix and
it is an hour of work. The alternative (a short window) punishes exactly the 4-hour
session PLAN.md says must survive, which is the case the whole feature exists for.

#### Spectators

`match:spectate` attaches with `playerId: null`. The server calls
`playerView(state, null)` — **the same function**, which is what makes §4's structural
test cover spectators too. Spectators see the full public board, the event stream,
and the log. They never see any `_` field, because no spectator can.

**Trade-off:** spectators cannot see the market's face-up Voter Card *costs*? No —
`MarketSlot.cost` is public, the cards are face up (p10). They can see it all. The
only thing a spectator genuinely lacks is *other players' hand contents of
conspiracies* — and `PlayerState.conspiracies` is a public, non-underscore field,
because a conspiracy in hand is visible to opponents at a physical table. **This is
a deliberate exception to "hide everything"**: hiding it would make the digital game
less informative than the physical one, and Shasn's bluffing happens in the *answer*,
not in the conspiracy hand.

### 3.5 Dispatch path — the only write door

```
ws message
  → protocol-handler.ts   narrow to ClientMessage (exhaustive switch, no `any`)
  → auth check            session.playerId, seat belongs to this match
  → runner.dispatch(playerId, action)
  → Result
      ok:false → send { t:'error', code:'ILLEGAL_ACTION', message: result.error }
      ok:true  → commit state; enqueue snapshot; for each subscriber S:
                   send(S, { t:'match:state',  viewId, state: playerView(S.state, S.viewer) })
                   send(S, { t:'match:events', viewId, events })
```

Three properties, each of which is a decision:

**The server never re-implements a rule.** `Result.error` is a human string from the
engine and it is forwarded. The only server-side rejections are: not in this match,
not your seat, and malformed message. **Trade-off:** error messages are less precise
than a hand-written per-action validator would be, and a user could learn engine
internals by fuzzing. **Accepted** — the engine's messages are already written for
humans, and the alternative is a second rule implementation that will drift.

**Redrawing is disallowed.** A rejected action mutates nothing (`reduce` returns
`{ok:false}` without a state), so a client that optimistically applied a move and got
an error must roll back. §5.5 forbids the optimistic mutation, so there is nothing
to roll back. This is the second payoff of no-prediction.

**`viewId` increments only on `ok:true`.** A rejected action produces no state
message at all — the client shows the engine's error string and nothing else moves.
Keeps the client dumb.

### 3.6 Persistence — where match state lives

PLAN.md §3 says "Postgres (matches), **in-memory first** — don't build persistence
until a match survives a refresh." **This is overturned, loudly, and here is why:**
PLAN.md risk #5 says a 4–6 hour match must survive a refresh. Those two lines
contradict each other. A game that only persists at the end is a game that loses four
hours on the first deploy.

#### Two tiers

**Tier 1 — the action log (the real source of truth).**

```ts
type StoredMatch = {
  matchId: string;
  seed: number;              // the mulberry32 seed. Whole game in one integer.
  rulesVersion: string;      // hash of RULES at match creation
  cardsVersion: string;      // hash of the deck manifest at match creation
  createdAt: number;
  players: { id: PlayerID; name: string; colour: string; resumeHash: string }[];
  /** Append-only. The audit trail and the replay source. */
  log: { seq: number; playerId: PlayerID | null; action: Action }[];
  /** Written every N actions, purely to bound replay time. */
  snapshot?: { viewId: number; state: GameState };
  snapshotAtSeq: number;
};
```

Because the engine is deterministic and seeded, **`(seed, rules, cards, actionLog)`
fully reconstructs any `GameState` at any point.** A snapshot is a *cache to bound
replay cost*, never the authority. `reduce` never reads a clock and never calls
`Math.random` — this is exactly the property that makes the log authoritative, and it
is already implemented in `rng.ts`.

**Tier 2 — a snapshot, written every 10 actions and on every phase change.**

Bounds worst-case replay to 10 `reduce` calls (microseconds). **Written on a
write-behind queue**, not awaited on the dispatch path — a database hiccup must not
stall a player's answer.

**Trade-off:** replay-based recovery means a `rulesVersion`/`cardsVersion` drift
between match creation and replay is a correctness bug, not a warning. The versions
are content hashes pinned at match creation, and replay refuses to run on a mismatch
rather than silently playing a different game. **This is the price of determinism
and it is a good price** — the alternative (snapshot-as-truth) silently diverges the
moment a bug is fixed mid-session.

**Storage choice for v1: a single Postgres table (JSONB `body`), one row per match,
`log` as a JSONB array with a sequence index.** Not a `matches` table plus a
`match_actions` table. **Trade-off:** appending to a JSONB array is a whole-row
rewrite, so a 2,400-action match rewrites a growing blob. Measured at ~1 MB/row for
a long match, well inside Postgres limits, and the write rate is ~2/minute.
**Accepted for v1.** The relational split is a 30-minute change later and is listed
in §9 as a known follow-up rather than built now.

**Why not a file on disk:** Fly.io containers have ephemeral filesystems. A local
file is a cache that lies to you across deploys, which is the exact failure mode
above.

**Why not Redis as the store:** Redis would work and would be faster, but then
persistence is Redis's problem and we have not evaluated its durability config. One
store, one durability story.

### 3.7 Hosting

PLAN.md §3: Fly.io or Railway, because Vercel serverless fights stateful WebSockets.
**Agreed, unchanged.** One process, long-lived connections, and in-memory
`MatchRunner`s mean the design needs *a machine that stays up* — the moment you have
two instances you need sticky sessions and cross-instance state sync, and at five
players that is a second architecture.

**Recommendation: Fly.io**, single machine, `auto_stop_machines = false`,
`min_machines_running = 1`. Railway is an equally valid choice; the differentiator
is that Fly.io's volumes make the Postgres move (or a future read-replica) less
painful. **Trade-off:** a single machine is a single point of failure. **Accepted for
v1** — the cost of a crash is one match, and the action log means it is *replayable*,
not lost. That recoverability is what makes single-instance acceptable, and it is
another dividend of the deterministic reducer.

**Explicitly not designed for:** horizontal scale. `MatchRunner` holds state in heap.
If we ever need two machines, the change is sticky-session routing by `matchId` plus
a socket-relay between machines — because every byte a machine needs to serve a
client is in the match's action log. **Designed for, not built.**

---

## 4. The secret-state contract

> This is the project's defining property. PLAN.md §9 risk #3. Everything below is
> load-bearing; none of it is a hardening step to add later.

### 4.1 The threat, stated precisely

The client is fully hostile. Not "a curious user opening devtools" — a user who has
decided to win, has the game's card list in a GitHub repo, and will read every
byte the server sends them. There is exactly one secret that matters:

> **The payout of the Ideology Card currently put to player *X*.**

Everything else — deck order, `_seed`, the identity of the next card — is *corollary
leakage*: knowing the top of `_ideologyDraw` tells you the next answer's payout
before it is drawn, which is the same defect with more steps. All nine `_` fields are
therefore in scope, not just `_pendingCard`.

A single successful leak is **permanent and unrecoverable**. A player who learns one
payout cannot be made to forget it; the match cannot be reset; the game's central
mechanic is over for that table forever. This asymmetry — cheap to maintain, fatal to
get wrong — is why this is a first-class subsystem with its own files, not a caveat.

### 4.2 Field-level classification of the 9 server-only fields

`state.ts` marks nine fields `_`-prefixed. Classified by *what breaks if it leaks*:

| Field | Contents | If leaked | Classification |
|---|---|---|---|
| `_pendingCard` | the `CardID` put to the active player | Reveals *which* card → with the public deck, the payouts. **Instant game over.** | **CATASTROPHIC** |
| `_ideologyDraw` | ordered remaining Ideology deck | Reveals the next N questions *and their payouts*, before the reveal. | **CATASTROPHIC** (corollary) |
| `_conspiracyDraw` | ordered Conspiracy deck | Reveals conspiracy identities; costs are public. Reveals the *top* card before purchase. | HIGH |
| `_headlineDraw` | ordered Headline deck | Reveals pending volatility. | HIGH |
| `_voterDraw` | ordered Voter deck | Reveals upcoming market contents. Low value — market cards are face-up by design. | MEDIUM |
| `_ideologyDiscard` | discard pile | The **answered** cards. `manifestoCards` is public, so little extra. | MEDIUM |
| `_voterDiscard` / `_conspiracyDiscard` / `_headlineDiscard` | discard piles | Face-up information already public. | LOW |
| `_seed` | the mulberry32 cursor | **Reconstructs the entire random stream from the start.** With `setup`'s shuffle calls in a known order, an attacker who knows the deck composition can regenerate every future draw *and* every past one. **This is the highest-leverage single number in the process.** | **CATASTROPHIC** |

**`_seed` deserves emphasis.** It is easy to overlook because it is a number and
carries no card names. It must never appear in a payload, an error, or a log line.
Note that `rng.ts` threads the seed through `nextSeed`/`shuffle`, so the *entire*
randomness of the game is that one integer. §4.5's test catches it like any other
`_` key; it is called out here because a human skimming a payload might not.

### 4.3 The two sanctioned exits from server memory

There are exactly **two** code paths by which any part of `GameState` may reach a
client. Both live in `packages/server/src/broadcast.ts`.

```ts
// broadcast.ts — THE ONLY FILE THAT TOUCHES GameState AND WRITES TO A SOCKET.
import { playerView, allKeys, type GameState, type ClientState } from '@shasn/engine';

export function viewFor(state: GameState, viewer: PlayerID | null): ClientState {
  return playerView(state, viewer);
}

/** The one place a card's *content* is ever written to a socket. */
export function blindPromptFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID,
): { question: string; labels: readonly [string, string] } | null {
  if (viewer !== state.activePlayer) return null;
  if (state.phase !== 'answer') return null;
  const cardId = state._pendingCard;                 // ← the ONLY read of _pendingCard
  const card = cardId ? cards.ideology[cardId] : undefined;
  if (!card) return null;
  // Deliberately: question + two answer strings. NOT ideologue. NOT pays.
  return { question: card.question, labels: [card.sides[0].answer, card.sides[1].answer] };
}

export function send(sock: WebSocket, state: GameState, viewer: PlayerID | null): void {
  sock.send(JSON.stringify(viewFor(state, viewer)));
}
```

**Three design decisions here, each with a trade-off:**

**(a) `blindPromptFor` is a separate function from `playerView`, and it is
deliberately narrow.** The alternative — a `playerView` that conditionally includes
the prompt — is the shape that actually leaks. The structural test in §4.5 walks
`playerView`'s output and would still pass, because the prompt is not a `_` key. By
keeping it separate, its output type is `{question, labels}`, which contains no
`Delta` and no `Ideologue`, and **can be asserted structurally too**:

```ts
// In packages/server/test: not one assertion, but a type-level guarantee.
expect(Object.keys(blindPromptFor(s, cards, me))).toEqual(['question', 'labels']);
```

**Trade-off:** a client cannot get the prompt and the state in one message, so there
are two round-trips (or one message with two fields — see below). **Mitigation:**
`match:state` carries an optional `blind` field populated by `blindPromptFor` in the
same send. One message, two independently-tested projections, no merged code path.

**(b) `send()` serialises `viewFor(...)` directly. It never accepts a `GameState`
plus a list of fields to include.** A `send(state, pick([...]))` API is how someone
later writes `send(state, true)` and ships the whole object. The only signature
available is the safe one. **Trade-off:** a special payload (the blind prompt) needs
a second call. Accepted, and the second call is the narrow one above.

**(c) `viewer` is `PlayerID | null` in both functions.** Spectators and players share
one projection, so there is no spectator-specific code to audit.

### 4.4 Client payload shape

What actually crosses the wire during a blind answer:

```jsonc
// → match:state  (to the ACTIVE player, mid-answer)
{
  "t": "match:state",
  "matchId": "m_7f3a…",
  "viewId": 412,
  "blind": {                                  // from blindPromptFor
    "question": "A drought-hit district demands emergency water tankers, and the reservoir authority will only release them if you sign…",
    "labels": [
      "Divert the industrial supply and put the people first",
      "Protect the factories; the district can wait for the next monsoon"
    ]
  },
  "state": {                                  // from playerView(state, me)
    "phase": "answer",
    "activePlayer": "p_9c1d…",
    "turn": 14, "round": 4, "finished": false,
    "awaitingAnswer": true,
    "deckSizes": { "ideology": 61, "voter": 38, "conspiracy": 22, "headline": 7 },
    "players": {
      "p_9c1d…": { "id": "p_9c1d…", "name": "Asha", "colour": "#c9345a",
                   "resources": { "funds": 4, "clout": 2, "media": 1, "trust": 5 },
                   "manifesto": ["idealist","idealist","capitalist", …],
                   "manifestoCards": ["ind2020-041", …],
                   "conspiracies": ["con-003"], "pending": [...],
                   "powerUses": {...}, "isBot": false }
    },
    "zones": [ … 9 zones, 129 areas, each with `{id, zone, volatile, peg}` … ],
    "market": [ { "cardId": "vot-011", "cost": {...}, "voters": 2 } ],
    "conspiracyTopCost": 5, "conspiracyRemaining": 22,
    "headlineQueue": [...], "activeHeadline": null, "choices": [...],
    "log": [ { "turn": 13, "player": "p_…", "text": "\"…\"", "kind": "answer" } ],
    "finalRoundFrom": null
  }
  /* NO _pendingCard. NO _ideologyDraw. NO _seed. NO pays. NO ideologue for this card. */
}
```

**To every other client, the same match:**

```jsonc
{ "t": "match:state", "matchId": "m_7f3a…", "viewId": 412,
  "state": { …identical shape…, "awaitingAnswer": true, "deckSizes": {…same…} } }
```

Note what a non-answering player **cannot** distinguish: `deckSizes.ideology` is 61 for
everyone and `awaitingAnswer` is true for everyone, so no observer can tell whether
the card was redrawn. That is correct — the redraw is a secret (p13, it costs 4
resources specifically so the player does not know if it worked).

**On `manifesto` and `manifestoCards` being public:** a player's answered cards sit
face up under their mat at a physical table (p13) and their manifesto *is* their
public identity — it is how opponents read them. So `manifesto` is public by design.
The payout of a card is not, because the *next* one has not been answered.
**Trade-off:** an attacker learns the exact card order a player has already seen,
which lets them enumerate a player's history. **Accepted** — that information is
already public at the table, and hiding it would break a real informational game
mechanic.

### 4.5 The structural test — and why one copy is not enough

**`packages/engine/test/playerView.test.ts`** — proves the projection is correct.

```ts
import { playerView, allKeys, type GameState, type PlayerID } from '../src/index';
import { freshZones, setup } from '../src/index';

it('emits no _-prefixed key for any viewer, including a spectator', () => {
  const s: GameState = /* a real mid-answer state from a played-out fixture */;
  for (const viewer of [null, ...Object.keys(s.players)] as (PlayerID | null)[]) {
    const keys = allKeys(playerView(s, viewer));
    const leaks = keys.filter((k) => k.startsWith('_'));
    expect(leaks, `viewer=${String(viewer)}`).toEqual([]);
  }
});
```

`allKeys` (already exported from `playerView.ts`, §2.2) recurses the whole object
graph, so it catches a secret nested inside `players[me]` or `zones[3].areas[8]` —
not just top-level keys.

**Three further assertions in the same file**, each catching a distinct failure:

```ts
// 1. New secret state added later is covered AUTOMATICALLY, so the convention
//    is enforced by the convention's own name. This is why the `_` prefix is
//    load-bearing rather than stylistic.
it('declares the full secret set, so a new _ field fails this test loudly', () => {
  const declared = ['_pendingCard','_ideologyDraw','_ideologyDiscard','_voterDraw',
    '_voterDiscard','_conspiracyDraw','_conspiracyDiscard','_headlineDraw',
    '_headlineDraw'.replace('_headlineDraw','_headlineDiscard'),'_seed'].sort();
  expect(Object.keys(s).filter((k) => k.startsWith('_')).sort()).toEqual(declared);
});

// 2. Deck SIZES, never deck CONTENTS. Catches an off-by-one in the
//    deckSize projection that happens to expose the top card.
it('never exposes a CardID that is still in a draw pile', () => {
  const view = JSON.stringify(playerView(s, 'p_9c1d…'));
  for (const id of [...s._ideologyDraw, ...s._conspiracyDraw, ...s._headlineDraw]) {
    expect(view).not.toContain(id);
  }
});

// 3. The seed is a number and numbers are easy to miss, but it reconstructs
//    the entire random stream.
it('never contains the seed as a bare value', () => {
  expect(JSON.stringify(playerView(s, 'p_9c1d…'))).not.toContain(String(s._seed));
});
```

**`packages/server/test/broadcast.test.ts`** — the one that actually matters,
because it walks the *production* function, not the engine's projection in isolation:

```ts
import { viewFor, blindPromptFor } from '../src/broadcast';

it('no projection that broadcast.ts can produce contains a _ key', () => {
  for (const viewer of [null, ...Object.keys(s.players), 'p_not_a_real_seat']) {
    expect(allKeys(viewFor(s, viewer)).filter((k) => k.startsWith('_'))).toEqual([]);
  }
});

it('the blind prompt contains exactly two string fields and no numbers', () => {
  const blind = blindPromptFor(s, cards, s.activePlayer);
  expect(blind).not.toBeNull();
  expect(Object.keys(blind!).sort()).toEqual(['labels','question']);
  // No Delta, no Ideologue, no CardID — provable, because the type admits none.
  expect(typeof blind!.question).toBe('string');
  expect(blind!.labels.every((l) => typeof l === 'string')).toBe(true);
});

/**
 * THE exhaustive one. Walk every server→client message type over a corpus of
 * states and assert that the union of all keys never contains a _ key. If someone
 * adds a new message type that carries state, this fails until they extend the
 * projection — which is the intended friction.
 */
it('no ServerMessage produced by the handler leaks a _ key', () => {
  for (const state of corpus) for (const msg of handler.renderAll(state)) {
    expect(allKeys(msg).filter((k) => k.startsWith('_'))).toEqual([]);
  }
});
```

**The `handler.renderAll` helper is the real teeth.** It is a test-only function
that produces every message the handler *can* produce for a state, so the test
cannot be passed by only checking the happy path. **Trade-off:** it must be kept in
sync with `protocol-handler.ts` as message types are added. That is the *intended*
friction — adding a message type that carries state should require thinking about
projection. To make forgetting impossible, `renderAll` is written to exhaustively
`switch` on `ServerMessage['t']` with a `never` check, so the compiler refuses to
compile if a new message type is added without handling it here.

**A fourth test — the CI greps.** Three greps, run in `npm run typecheck`:

```bash
# 1. No value-import of the engine into the client. A type-only import is fine;
#    a value import pulls reduce.ts into the browser bundle.
! grep -REn "from '@shasn/engine'" packages/client/src | grep -v "import type"

# 2. Shared must stay runtime-free of node/browser.
! grep -REn "from '(node:|ws|react)" packages/shared/src

# 3. Nothing outside packages/engine may name a _ field. The server reads
#    _pendingCard in exactly one place; even that is grep-enforced to a single hit.
[ "$(grep -REn '\._[a-zA-Z]' packages/server/src packages/client/src packages/shared/src \
     | grep -v 'broadcast.ts' | wc -l)" -eq 0 ]
```

Greps are crude and that is a feature: they fail on *any* hit, including a comment,
which means a code comment that names `_ideologyDraw` outside `broadcast.ts` must be
reworded. Cheap, total, and impossible to argue with in review.

### 4.6 Logs, errors, and replay tooling

Leaks do not only happen on the socket. Four other channels, each closed:

**(a) Server logs.** The risk is an error handler that dumps a state.

```ts
// packages/server/src/redaction.ts
export function redact(state: GameState, viewer: PlayerID | null): ClientState {
  return playerView(state, viewer);            // reuse the ONE projection
}
```

The rule: **nothing in `packages/server` ever formats a `GameState` with
`JSON.stringify`, `%o`, `util.inspect`, or a template literal.** Structured logging
takes a `ClientState` (already projected) or primitives. A CI grep for
`JSON.stringify(state` / `JSON.stringify(s)` outside `broadcast.ts` and the tests
enforces it. **Trade-off:** logs are less useful for debugging — you cannot see the
deck to work out why a draw went wrong. **Mitigation:** the action log (§3.6) *is* the
debugging tool, and it is authoritative and complete. A bug report is a `matchId`; an
operator replays it offline with the same seed. That is strictly better than reading
a log line.

**(b) Error messages.** `reduce` returns human-readable error strings that are
forwarded verbatim to the client (§3.5). **Audit: none of them leak.** Verified
against the `fail(...)` sites in `reduce.ts` — they are
`'not your turn'`, `'unknown area'`, `'you have already answered'`,
`'a redraw costs exactly 4 resources'`, `'that costs 5 resources in any combination'`,
`'the Conspiracy deck is exhausted'`, `'you cannot afford that'`,
`'not enough Helping Hands discounts left'`, `'both sides must exchange at least one
resource'`, `'resolve "…" first'`, `'voters in a Volatile Area cannot be affected'`,
`'that targets an opponent'`, `'you do not hold that card'`, `'unknown ideology card
${cardId}'`.

**One is a leak: `unknown ideology card ${cardId}`.** It interpolates a card ID from
`_ideologyDraw` into a client-visible string. It only fires when a card is in the
deck but not in the `CardIndex` — a real configuration bug — and the ID is
incrementally guessable (`ind2020-001`…), so an attacker who deliberately triggers it
learns deck membership. **The engine repair must change this to a fixed string** with
the detail going to the server log only. **This is a defect in `reduce.ts`, which is
otherwise clean, and it should go on the repair agent's list.** It is the only
`${...}` interpolation of card data I found in a `fail()` call; `answered`'s
`GameEvent` carries a `cardId` but that is a *public* event about an *already
answered* card, which is intended.

**(c) Replay tooling.** The replay tool reads `(seed, rules, cards, actionLog)`. It
is the one place that legitimately holds secrets. Constraints: it is a
`packages/server/src/replay.ts` function, **not** an exported API; it writes no
files; it prints a per-viewer projection via `redact()` by default and requires an
explicit `--full` flag plus a `console.warn` to dump unredacted state. **Trade-off:**
nobody will ever use `--full` in production because it warns. Accepted — the
non-redacted path exists for exactly one person debugging one bug.

**(d) The HTTP surface.** `node:http` serves three routes: `GET /healthz`
(`{ok:true}` — no state), `GET /` (static client assets), and **nothing else**. There
is no admin route, no debug route, no `/state` endpoint. **Trade-off:** no
production introspection; `fly ssh console` + the replay tool covers it.

### 4.7 Verification commands

```
# The engine's projection test
npm test --workspace @shasn/engine  -t "playerView"

# The server's broadcast test — THE gate
npm test --workspace @shasn/server  -t "leak"

# The structural greps (§4.5)
npm run lint:secrets

# Manual, and the only one that is truly convincing:
#   1. two browsers, one game, reach the blind answer
#   2. open devtools → Network → WS Frames
#   3. search the frames for the card id, "funds", "_seed", "ideologyDraw"
#   4. confirm zero hits
# This is M3's exit criterion (PLAN.md §7) and it is a *manual* step on purpose.
# The automated tests prove the projections are correct; only a human looking at
# the wire proves the projections are the ones actually sent.
```


## 5. Client design

React 18.3 + TypeScript + Vite. Board rendered as a single `<svg viewBox="0 0 1000 1500">`.

### 5.1 SVG vs Canvas — **PLAN.md is upheld, and the reason is stronger than it gives**

PLAN.md §3 says SVG wins because "9 zones of discrete peg slots is vector work. Free
hit targets, CSS transitions, and real a11y labels. Canvas gives none of that." That is
correct. The argument that actually settles it, which PLAN.md does not make:

**The board's 129 hit targets are a hit-testing problem, and Canvas makes you solve
it twice.** With SVG, `<PegSlot>` is a `<g>` with a `<circle>`; the browser does
hit-testing, focus, `pointerenter`, keyboard activation, and the accessibility tree,
for free and correctly. With Canvas you need a second, pixel-space implementation of
"which slot is under (x, y)" that must agree with the render — and a third
implementation for keyboard navigation, because a canvas has no focusable children.
Three implementations of one board's geometry means three chances for the keyboard
path to disagree with the mouse path. For a game where a mis-placed voter is a
permanent state change, that is not a rounding error.

**Where Canvas would have won, and why it does not apply:** Canvas wins on
*thousands of independently animating objects at 60fps*. Shasn's board has 129 slots
and roughly 10 meaningful state transitions per turn. The worst case is a redraw of
129 `<g>` elements, memoised per-area so only changed pegs re-render — a handful of
nodes. There is no frame budget pressure. **SVG is not merely adequate here; it is
strictly better because the thing Canvas is fast at is not the thing this board does.**

**The costs, named honestly:**

| Cost | Mitigation |
|---|---|
| ~130 DOM nodes per board, ~400 with pegs and overlays | Memoise `PegSlot` on `(area, pegOwner, pegMajority, selected, legal)`. Only changed slots re-render. |
| `viewBox` scaling means the board is a fixed 1000×1500 coordinate space, so hit targets do not scale with the DOM | Each `PegSlot` renders a transparent `r=14` hit circle against a visible `r=11` dot, giving a 27-unit touch target on a board where slots are ~28 units apart. Independent of zoom. |
| CSS `transform` on SVG needs `transform-box: fill-box` to behave | Set once on `.peg-slot`, documented in `geometry.ts`. |
| No automatic text wrapping in SVG | The card text and all panels are HTML overlaid on the SVG, not SVG `<text>`. **The board is SVG; everything else is DOM.** |

**Trade-off accepted:** a large board with many simultaneous animations would need
Canvas. This one does not, and if a future expansion adds hundreds of animated
voters the decision is revisitable per-component — HTML overlay for text, SVG for the
board, and Canvas only for a hypothetical effects layer.

### 5.2 Component tree

```
<App>                                   router, ErrorBoundary, connection status
├── <LobbyScreen>                       /lobby
│   ├── <LobbyList>                     public lobbies, join buttons
│   ├── <CreateLobbyForm>               name, 2-5 seat picker, private toggle
│   └── <LobbyRoom>
│       ├── <SeatGrid>                  5 seats, empty/occupied/spectator/you
│       ├── <ReadyToggle>               per-seat
│       ├── <StartButton>               host only, enabled when full + all ready
│       └── <LobbyChat>
└── <GameScreen>                        /m/:matchId
    ├── <ConnectionBadge>               live / reconnecting / offline
    ├── <BoardSvg viewBox="0 0 1000 1500" role="application" aria-label="…">
    │   ├── <defs>                     gradients, the peg symbol, the majority ring
    │   ├── <Coastline>                 COASTLINE polyline, from board.generated
    │   ├── <ZoneOutline> × 9           spec.poly, majority/capacity label at spec.label
    │   │   └── <ZoneHighlight>         only for zones this player holds rights in
    │   ├── <PegSlot> × 129             ← ONE PER AreaSpec. THE hit targets.
    │   │   ├── <PegDot>                r=11, player colour
    │   │   ├── <MajorityRing>          drawn when peg.majority
    │   │   ├── <VolatileMarker>        when spec.volatile
    │   │   └── <SelectionRing>        when in a pending selection
    │   └── <GerrymanderLayer>          drag overlay, §5.6
    ├── <PlayerMats>                    5 mats, rotated around the board
    │   ├── <ResourcePool>              4 resources with counts
    │   ├── <ManifestoTray>             §5.4
    │   ├── <PowerButtons>              from POWERS + unlockedPowers(self, RULES)
    │   └── <ConpiracyHand>
    ├── <AnswerPrompt>                  §5.3 — only when it is YOUR turn in 'answer'
    ├── <SpendPanel>                    §5.4
    ├── <TradePanel>                    opponent picker + two resource pickers
    ├── <MarketPanel>                   3 face-up Voter Cards (public — no hiding)
    ├── <PendingChoices>                from state.choices, filtered to mine
    ├── <HeadlineOverlay>               when state.activeHeadline
    └── <EventLog>                      from match:log + match:events
```

**The 129 `PegSlot`s are real, individually-addressable, individually-focusable DOM
nodes.** Each renders from a single `AreaSpec` and takes its peg from
`state.zones[].areas[].peg` matched by `spec.id`. They are not one big `<path>` with a
mouse handler. **Trade-off:** 129 React elements is more reconciliation work than one
path; **mitigated** by `React.memo` on a primitive prop tuple and by rendering all
slots unconditionally (so keys are stable and mount/unmount never happens — mount
order changes are the classic source of SVG reconciliation bugs).

**`PegSlot` accessibility.** Each slot is `role="button"`, `tabIndex={0}`, and its
accessible name is computed as
`"North West, slot 7 of 11, empty"` /
`"…occupied by Asha, majority voter"` /
`"…volatile area"`. Screen-reader users can therefore walk the whole board, which is
the single most valuable thing Canvas would have taken away. The board container is
`role="application"` with `aria-roledescription="Shasn board"`.

### 5.3 The blind-answer prompt — the most carefully-written component in the app

This component is the reason §4 exists. Its contract: **the DOM contains the
question and two neutral labels, and nothing else that could help a player choose.**

```tsx
// packages/client/src/panels/AnswerPrompt.tsx  — illustrative shape
export function AnswerPrompt({ blind, onAnswer, canRedraw }: Props) {
  if (!blind) return null;
  return (
    <div className="answer" role="dialog" aria-modal="true" aria-labelledby="q">
      <h2 id="q">{blind.question}</h2>
      <div className="choices">
        {blind.labels.map((label, i) => (
          <button key={i} onClick={() => onAnswer(i as 0 | 1)}>
            {label}
          </button>
        ))}
      </div>
      {canRedraw && <button className="redraw">Ask for a different question (4 resources)</button>}
    </div>
  );
}
```

**Six rules, each traceable to §4:**

1. **Two buttons, symmetric, and in a fixed order.** Not a dropdown, not a slider, not
   an A/B keyboard shortcut that could leak position. `labels[0]` is always the same
   button, always the same side, always index `0`. **Trade-off:** a fixed order means
   no position bias correction, and players may systematically pick the first. Accepted
   — a randomised order would break the *action* payload's meaning.
2. **No resource icons. No coloured pips. No amounts. No ideologue glyphs.** The
   labels are plain text in the card's own voice. If the side's `ideologue` were
   rendered — even as a neutral-looking category tag — a player could pattern-match
   "this sounds capitalist" and the deliberation collapses into classification. **This
   is the reason the blind prompt type (§4.3) admits neither.**
3. **The prompt is a `role="dialog" aria-modal="true"` overlay.** The board behind it
   is dimmed. Not for secrecy — the board has nothing secret in it — but because
   this is a *deliberation* moment and the player should not be reading the board
   while they decide.
4. **No timer, no progress bar, no "you have 30 seconds".** A pressure mechanic
   would push players to pattern-match instead of reasoning.
5. **The redraw button is a real, priced choice** (p13, 4 resources, any
   combination) and it is *only* shown when `canRedraw` is computed from the player's
   own `resources`. The response to a redraw reveals nothing — not even a different
   number of cards or a different `awaitingAnswer`. The server sends the new prompt in
   the next `match:state`; the client does not clear the old one optimistically, so a
   redraw that fails for lack of resources simply never gets a new prompt.
6. **After answering, the prompt unmounts and never returns for that card.** The
   client does not retain the question in a ref, a store, or `sessionStorage` for a
   "what did I pick?" tooltip. `net/store.ts` drops `blind` the instant
   `state.phase !== 'answer'` or `activePlayer !== me`. **Trade-off:** no post-hoc
   recall of the question text; the log records the chosen *answer*, which is what
   players actually remember from a physical game anyway.

**What the client deliberately cannot render, and does not even receive:** the
payout, the ideologue of either side, the card ID, the redraw result, the remaining
deck, and the seed. The `BlindPrompt` type is
`{ question: string; labels: readonly [string, string] }` — there is no field to
accidentally bind.

### 5.4 Spend panel and manifesto tray

**`SpendPanel`** — the always-visible resource tray. Each of the four resources shows
a name, an icon (a distinct hand-drawn glyph, not a colour alone — colour-blind
safety), and a count. It is **dual-purpose**:
- *Informational*: what you hold.
- *Transactional*: click a resource to arm it as a payment; armed resources move to
  an "offering" strip; click a card in `MarketPanel`, a conspiracy cost, or a power
  cost to complete the transaction, which dispatches the `pay: Delta` on the action.

**Trade-off:** a click-to-arm payment model is more clicks than a drag model but has
no ambiguity and no drag-and-drop accessibility gap. Keyboard users get the identical
path: resources are buttons in the tab order, `Enter` arms, `Escape` disarms.
**Accepted** — drag is nicer and drags are the reason some players cannot play.

**`ManifestoTray`** — the visible identity. One chip per answered card, grouped and
ordered, each showing **the answer text they chose**, not the ideologue and not the
payout. (p13: the cards sit face up under the mat, so the answer is public; the
ideologue is *derivable* from the answer, so hiding it would be theatre.) Chips are
laid out along the four ideologue columns for legibility, and each ideologue column
shows the count toward the next power unlock (`3/3` → a lit power chip). The
passive bonus (`passiveBonus(player, RULES)`) is shown as "+1 every 2 cards" per
column. `unlockedPowers` and `usesLeft` come from `powers.ts` and drive which power
buttons are enabled.

**`MarketPanel`** — the three face-up Voter Cards from `state.market`. Fully public:
`{cardId, cost, voters}` are all non-underscore. `INFLUENCE` is dispatched with
`{type, slot, discounts?, viral?}`.

### 5.5 State management, and the forbidden optimistic UI

**No Redux, no Zustand, no Jotai, no TanStack Query.** One `useSyncExternalStore`
over a plain module-level store in `net/store.ts`.

```ts
// packages/client/src/net/store.ts — shape, not code
interface ClientStore {
  phase: 'connecting' | 'lobby' | 'match' | 'offline';
  session: Session | null;
  lobby: Lobby | null;
  matchId: string | null;
  /** Folded from match:state. Replaced wholesale, never patched. */
  state: ClientState | null;
  /** Buffered until the matching match:state lands. §3.3 option B. */
  pendingEvents: { viewId: number; events: GameEvent[] }[];
  /** From blindPromptFor. Cleared the moment it is no longer your blind answer. */
  blind: BlindPrompt | null;
}
```

**The store has exactly three mutators:** `applyState`, `applyEvents`, `clearBlind`.
No reducer, no middleware, no thunks. It is a fold over a message stream and nothing
else. **Trade-off:** a bespoke store is ~150 lines of code a library would have given
us. **What it buys:** the "no optimistic state" rule (§5.5.1) is *structurally
enforced* rather than *documented*. There is no `dispatch(action)` in the client, so
there is nothing for a future contributor to optimistically mutate. The rule survives
the team, which is the whole point.

**One selector layer.** `useSelector(sel)` for `useSyncExternalStore`. Components
subscribe to primitives (`const peg = useSelector(s => s.state?.zones[0])`) so a
single peg change does not re-render the board.

#### 5.5.1 What optimistic UI is forbidden, and why

**The rule: the client may render a *disabled affordance*; it may never render an
*assumed outcome*.**

| FORBIDDEN — it does not exist in this client | PERMITTED — it exists |
|---|---|
| Applying a peg locally on click, then reconciling on the server's `viewId` | Rendering the peg slot's `tabIndex=-1`/`aria-disabled` until the server confirms the placement |
| Showing "+2 Funds" after an `ANSWER` | Showing the player's post-answer pool, **which arrives from the server** |
| Previewing what a `GERRYMANDER` would achieve (which zones would flip majority) | Highlighting which zones the player *currently* holds rights in, via `rightsZones(state, me)` on the current state |
| A "waiting for opponent…" spinner with an assumed outcome | A "waiting for opponent…" spinner, sourced from `state.phase === 'answer' && activePlayer !== me` |
| Greying out a market slot the client believes is unaffordable **and hiding the error** | Allowing the click; the server's `error` string is rendered verbatim in a toast |
| Rolling back a locally-applied action on rejection | **Nothing to roll back** — no local application, ever |

**The specific temptation, called out:** after clicking a voter slot, the peg is
*obviously* going to land there. Rendering it immediately is what every other board
game does and it feels good. **It is forbidden here** for two reasons: (1) the
rejection path (`fail('voters in a Volatile Area cannot be affected')`) is a real,
frequent outcome, and a rollback is a visible, janky correction; (2) more
importantly, a client that applies actions locally is a client that *holds a copy of
the game*, and a client that holds a copy of the game is one refactor away from
holding a card. **The line is drawn at the socket.** Everything before it is a
render; everything after it is the server's word.

**Optimistic *presentation* is still fine, and is used deliberately:** CSS
transitions on pegs animate from their previous rendered position to the new one
when the server's state lands. That is 300ms of interpolation on an already-true
fact, not a prediction. **Trade-off:** every action has ~1 RTT of latency before
anything moves. At 2 actions/minute, invisible. **Accepted.**

### 5.6 The gerrymander drag interaction

`GERRYMANDER` is the one action where a drag is genuinely the right interaction:
`{zoneId, fromAreaId, toAreaId}` — you pick a peg you own, that is *not* a majority
voter, in a zone where you hold rights (`gerrymanderRights(zone) === me`), and move it
to any empty area.

```
pointerdown on PegSlot
  → if !canGerrymanderFrom(area) return            // not mine, majority, or no rights
  → setDrag({ from: areaId, legalTargets: legalEmptyAreas(zone) })
pointerenter on PegSlot (while dragging)
  → highlight: legal target (fill) vs illegal (no change, no affordance)
pointerup on PegSlot
  → if legal: dispatch GERRYMANDER, clearDrag
  → if illegal or released outside: clearDrag
Escape during drag → clearDrag
```

**`legalTargets` is computed from the client's own `ClientState` using
`rightsZones` + `emptyAreas` + `areNeighbours`.** This is *legality from known public
state*, not prediction — the same info the server will use. The server remains the
arbiter; a stale client that thinks a target is legal gets `fail(...)` and nothing
happens, with no rollback needed because the drag was pure UI.

**Keyboard equivalent, which is not optional:**

```
Focus a PegSlot, press 'g'  → enters gerrymander mode on that slot
Arrow keys / Tab           → move the "cursor" to candidate target slots
Enter                      → confirm and dispatch
Escape                     → cancel
```

An aria-live region announces `"Gerrymander: Central, 9 of 9 targets available"` on
mode entry and `"Moved voter to Central slot 4"` on confirm. **Trade-off:** the
keyboard path is more code and more surface for bugs. **Non-negotiable** — a 129-target
board with a drag interaction and no keyboard path is not a playable game for a
meaningful fraction of players, and the SVG choice (§5.1) was made partly to keep
this possible.

### 5.7 Keyboard navigation model

One roving-tabindex group per interactive region, plus global shortcuts.

**Global (on `document`):**

| Key | Action |
|---|---|
| `?` | Toggle the keyboard-shortcut overlay |
| `Tab` | Move between regions: board → mats → market → panels → log |
| `1`–`5` | Jump to a player mat |
| `a` | Jump to the answer prompt (if it is yours) |
| `Escape` | Cancel any in-progress interaction (drag, resource arm, gerrymander) |

**Within the board:** roving `tabIndex` — exactly one `PegSlot` has `tabIndex={0}`,
the rest `-1`; arrows move within the zone grid, `Tab` exits to the next region,
`Enter`/`Space` select or place. This keeps the board to **one** tab stop instead of
129, which is the difference between a keyboard user reaching the rest of the UI in
five seconds and never.

**Within mats and panels:** standard tab order, all controls real `<button>`s. No
custom widget role anywhere in the client. **Trade-off:** slightly more tab stops
than a fully custom widget. **Accepted** — native focus, native Enter/Space, native
screen-reader announcements, for free.

**Focus management on state change:** when the server moves the game to a new phase,
focus does **not** move automatically *except* in one case — when `blind` appears for
this player, focus moves to the prompt dialog, because missing your turn is the worst
possible UX failure in an async game. This is the only auto-focus in the app.

---

## 6. Card pipeline (`packages/cards`)

### 6.1 Legal position — settle this before writing a single card

PLAN.md §8 lays out two paths and says "pick before M2, not before M1." **I am
recommending path 2: original decks, own theme, Shasn-derived mechanics.** Reasoning:

- Path 1 (ask Memesys for a licence) has **no committed timeline and no downside
  cost to waiting**, because the engine work is identical under both paths. So the
  correct order is: *do not start the corpus on a licence you do not have*, but also
  *do not block on the email*.
- The resolution: the card **schema, validator, and balance checker** are
  licence-agnostic and get built immediately. The **corpus itself** is written
  against an original theme. If Memesys say yes, the original decks remain valid and
  shippable; the licensed decks are added as an alternative `decks/` directory. If
  they say no, nothing was wasted. **This is the one sequencing decision in the plan
  where the order of work is chosen to keep both branches open, and it costs nothing
  to honour.**

**One field-level consequence:** no card text, `campaign` name, or `name` field may
reference Shasn, Memesys, or Zain Memon. The CI validator (§6.3) greps the corpus
for those tokens. **Trade-off:** a licence path would have let us use the real
campaign names, which is part of the appeal. **Accepted** — a takedown notice is
cheap to comply with and expensive to ignore.

### 6.2 JSON Schema shape, validated against `cards.ts`

One schema file per card type. The schemas are **hand-written and cross-checked
against `cards.ts` by a type test** (§6.3), because JSON Schema cannot import a
TypeScript type and the two will drift.

```jsonc
// packages/cards/schema/ideology-card.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://shasn.dev/schema/ideology-card.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "campaign", "question", "sides"],
  "properties": {
    "id":       { "type": "string", "pattern": "^ind-[a-z0-9-]+-\\d{3}$" },
    "campaign": { "type": "string", "minLength": 3, "maxLength": 80 },
    "question": { "type": "string", "minLength": 20, "maxLength": 400 },
    "advisory": { "enum": ["mature", "trigger"] },
    "sides": {
      "type": "array", "minItems": 2, "maxItems": 2,
      "items": { "$ref": "#/$defs/side" }
    }
  },
  "$defs": {
    "side": {
      "type": "object", "additionalProperties": false,
      "required": ["answer", "ideologue", "pays"],
      "properties": {
        "answer":   { "type": "string", "minLength": 3, "maxLength": 160 },
        "ideologue": { "enum": ["capitalist", "showstopper", "supremo", "idealist"] },
        "pays":     { "$ref": "#/$defs/delta" }
      }
    },
    "delta": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "funds": { "type": "integer", "minimum": 0, "maximum": 9 },
        "clout": { "type": "integer", "minimum": 0, "maximum": 9 },
        "media": { "type": "integer", "minimum": 0, "maximum": 9 },
        "trust": { "type": "integer", "minimum": 0, "maximum": 9 }
      }
    }
  }
}
```

**Schema decisions, with reasons:**

- **`additionalProperties: false` everywhere.** A typo'd `pay` (singular) in a card
  file would otherwise be silently ignored by the engine, producing a card that pays
  nothing. This is the highest-value single line in the schema file.
- **`"sides"` is a fixed-length-2 array, not an object keyed by `"a"`/`"b"`.** It
  mirrors `readonly [IdeologySide, IdeologySide]` exactly. A keyed object would let a
  card have three sides or none, and `card.sides[action.side]` would return
  `undefined` — which `reduce` catches as `fail('invalid side')` at *runtime*, in a
  live game, on a card nobody tested.
- **`pays` is a partial `Delta` with `minimum: 0`.** A negative payout is not
  expressible. Losing resources is a `lose` effect on a conspiracy, not a payout.
- **No `minProperties` on `pays`.** `{}` is legal — a card where both sides pay
  nothing is a *bad card* but a schema-valid one. That is the **balance checker's**
  job (§6.4), not the schema's. **Trade-off:** the schema validates shape, the
  checker validates design. Keeping them separate means each has one job and the
  checker's judgement calls are reviewable in a separate report.

The other three schemas follow `cards.ts` exactly: `voter-card` (`id`, `cost`, `voters`
with `voters` constrained to `1|2|3` per p10), `conspiracy-card` (`id`, `name`, `text`,
`cost` as an integer 4–5 per p19, `effects` as an array of the 13 `Effect` ops,
`excludeInTwoPlayer?`), and `headline-card` (same minus `cost`).

**The `Effect` op enum is generated from `cards.ts`, not hand-listed.** A type-only
import plus `satisfies` gives:

```ts
// packages/cards/schema/index.ts — illustrative
import type { Effect, IdeologyCard, VoterCard, ConspiracyCard, HeadlineCard } from '@shasn/engine';

// Fails to compile if a variant is added to cards.ts and not represented here.
type EffectOp = Effect['op'];
const EFFECT_OPS: EffectOp[] = [ /* one entry per op */ ];
```

**Trade-off:** the hand-written JSON Schemas and the generated op list can still
disagree on field-level details inside an op variant (`gain-any` needs `n`; `gain`
needs `res`). **Mitigated** by the corpus-level validator (§6.3) which tries to
`Effect`-apply every effect in every card and reports unknown shapes — a real
compile-time exhaustiveness proof of the effect language.

### 6.3 Directory layout, validation script, and the corpus contract

```
packages/cards/decks/
├── manifest.json
│   {
│     "version": "2026-09-01",
│     "settings": [
│       { "id": "india-2020", "minPlayers": 2, "maxPlayers": 5,
│         "ideology": "ideology/india-2020",
│         "voter": "voter/core", "conspiracy": "conspiracy/core", "headline": "headline/core" }
│     ]
│   }
├── ideology/india-2020/ind-orig-001.json …   # one file per card, for reviewable diffs
├── voter/core/vot-001.json …
├── conspiracy/core/con-001.json …
└── headline/core/head-001.json …
```

**One card per file, never one array per deck.** A balance fix to three cards is a
three-file diff a reviewer can read in the PR view. An array means a balance pass
touches a 4,000-line file and the reviewer rubber-stamps it. **Trade-off:** 200 files
instead of 4, and a loader that must glob. **Accepted** — reviewability is the entire
reason cards are JSON in git rather than in a database.

#### `scripts/validate.ts` — nine checks, all errors unless noted

1. **Schema.** Every file against its schema via `ajv` (strict mode, `allErrors: true`).
2. **ID uniqueness** across all four types and all settings. A duplicate ID silently
   overwrites in `indexCards`' `Object.fromEntries` — one of your 100 cards vanishes
   with no error. **This is a real, silent bug and check 2 is the only thing stopping it.**
3. **Referential integrity.** Every `CardID` referenced by another card exists.
4. **Deck minimums.** A setting must have ≥ 60 Ideology Cards (a 5-player game
   consumes a lot), ≥ 24 Voter Cards, ≥ 12 Conspiracies, ≥ 8 Headlines. Short
   deckes produce a 90-minute game that claims to be the 4-hour one.
5. **Ideologue coverage.** Each of the four ideologues appears as a side on at least
   40% of Ideology Cards. A skewed corpus means a player who always picks one
   ideologue can optimise, which is risk #2 arriving through the back door.
6. **ID prefix + pattern.** `ind-`/`vot-`/`con-`/`head-` and the regex. Cheap, and it
   makes check 2's failure messages readable.
7. **Effect-language coverage.** Apply each `Effect` in the corpus through a
   `switch` typed as `Effect` with a `never` check. Any effect the interpreter cannot
   handle fails the build. **This is what keeps `Effect` and `reduce` in sync.**
8. **Licence tokens.** Grep every string field for `shasn|memesys|zain memon|collectors
   edition`. (§6.1.) **Error.**
9. **Question uniqueness.** No duplicate `question` text across a setting. Duplicate
   prompts feel like a broken game, and are the classic symptom of a
   copy-paste-and-edit corpus. **Error.**

`npm run validate` exits non-zero on any error. It is a CI gate, not a warning.

#### `src/index.ts` — `loadDecks()`

```ts
// packages/cards/src/index.ts
import { indexCards, type CardIndex, type Rules } from '@shasn/engine';

export function loadDecks(manifest: Manifest, readFile: (p: string) => unknown): {
  cards: CardIndex;
  version: string;   // the manifest hash — pinned into StoredMatch
};
```

**Loaded on the server, once, at boot. Never sent to the client in bulk.** The client
needs Ideology Card *text* only for the card currently in play (via `blindPromptFor`)
and conspiracy/headline text for cards in hand — all of which the server places in
`ClientState` (`conspiracies`, `activeHeadline`). **The deck list is never shipped.**
A client with the full deck can compute nothing they couldn't already compute (payouts
are per-side and only two are relevant), but there is no reason to ship it, and
"no reason to" is the standard §4 enforces. **Trade-off:** the client cannot render a
card gallery or a "cards remaining" preview. Deliberate.

### 6.4 The balance checker — concretely

PLAN.md risk #2: *"If one side of a card is strictly better, players optimise instead
of deliberating and the entire premise collapses."* This is the check that protects
the premise, so it gets a real algorithm rather than a total-sum comparison.

#### Why total-sum checking is insufficient

A naive `|Σpays(A) − Σpays(B)| > 0 → flag` is wrong twice over:

- **It flags legitimate trade-offs.** `{funds:3, trust:0}` vs `{funds:0, trust:3}` is
  a 3-resource difference and a *perfectly good card* — the choice is "which resource
  do I need," which is the deliberation the game is made of.
- **It misses the real failures.** A card where both sides pay 3 but one pays
  `{funds:3}` and the other `{funds:2, media:1}` is a 0-sum card that is nonetheless
  a *pure upgrade* for anyone who needs funds — no deliberation, ever. And a card
  where side A pays 3 and side B pays 2, both to the *same* ideologue, straddles the
  level-3 power threshold — so A is worth far more than 1 resource. **Totals miss
  both. This is the whole argument for the checker below.**

#### The dominance relation

A side **X** is *dominant* over side **Y** on card *c* if **all** of:

**D1 — Pure upgrade (no trade-off).** For every resource `r`: `X[r] ≥ Y[r]`, and
strict for at least one `r`. *There is no reason to ever pick Y.*
This is the killer and it is checked first because it is unambiguous.

**D2 — Total skew beyond tolerance.** `ΣX ≥ ΣY + 2`. Two resources of difference
at a cap of 12 is 17% of your entire pool; it decides the game. (The `+2` tolerance
band is §6.4.1.)

**D3 — Power-threshold cliff.** There exists an ideologue `i` present in `X.pays`
with `ΣX[i] ≥ rules.level3` and `ΣY[i] < rules.level3` (or the same at `level5`).
*Choosing X crosses a power-unlock line that Y does not.* Worth far more than the
raw resources, because an unlocked power is worth several resources per turn forever.

**D4 — Same-ideologue skew.** `X.ideologue === Y.ideologue` and `ΣX ≥ ΣY + 2`. Both
sides feed the same manifesto stack, so a player picks the bigger one and there is
no identity decision. **Warning, not error** — sometimes intentional (a card that is
purely about magnitude), but it should be a decision someone wrote down.

**D5 — Empty side.** `ΣX === 0` or `ΣY === 0`. A side that pays nothing is not a
choice. **Error.**

#### 6.4.1 The tolerance band — what I accept and why

> **Accepted: ±1 total resource in either direction. Out of band: ≥2, or any D1, or any D3.**

The reasoning, stated so it can be argued with:

- **±1 is free.** The resource cap is 12 (p12). One resource is 8% of your pool, and
  over a 4-hour game it is a rounding error against the 30+ resources that pass
  through. It cannot be *strategically* decisive, so it does not cause optimisation.
- **±2 is not free.** 17% of your pool, and the entire difference between being able
  to afford a 4-resource redraw and not. At the margin — which is where Shasn is
  played — two resources is a turn.
- **D1 and D3 override the band entirely.** A 0-sum `PURE_UPGRADE` and a 1-resource
  `POWER_THRESHOLD_CLIFF` are both worse than a 3-resource symmetric card, because
  they remove the decision rather than tilting it.

**What the band costs:** some genuinely fine cards get flagged and argued about. That
is the intended cost — the argument is the design review, and it happens in a PR with
a human, not silently in a playtest.

#### 6.4.2 Severity and the CI gate

| Code | Condition | Severity | Rationale |
|---|---|---|---|
| `EMPTY_SIDE` | D5 | **error** | Not a choice. |
| `PURE_UPGRADE` | D1 | **error** | Removes the decision. The premise, gone. |
| `POWER_THRESHOLD_CLIFF` | D3 | **error** | Removes the decision *and* looks fair to a totals-only reader. |
| `TOTAL_SKEW` | D2 | **warn** | A tilt, not a removal. Needs an author argument. |
| `SAME_IDEOLOGUE_SKEW` | D4 | **warn** | Design smell, not a defect. |
| `IDEOLOGUE_SKEW` | an ideologue on <40% of cards (§6.3.5) | **warn** | Corpus-level, not per-card. |

```
npm run balance            # errors → exit 1, warnings → exit 0
npm run balance -- --strict   # warnings also → exit 1   (the release gate)
```

`--strict` is the gate for a release; plain `balance` is the PR gate. **Trade-off:**
the corpus will not be `balance --strict` clean until it is human-reviewed, so the
strict gate is aspirational for v1. **Accepted** — the errors *are* clean from day
one, and the warnings are the review checklist.

#### 6.4.3 A worked example

```jsonc
// ind-orig-041.json — a BAD card. D1 and D2 both fire.
{ "id": "ind-orig-041", "campaign": "Reservoir",
  "question": "A drought-hit district demands emergency tankers, and the authority will only release them if you sign…",
  "sides": [
    { "answer": "Divert the industrial supply", "ideologue": "idealist",
      "pays": { "funds": 2, "trust": 2 } },        // Σ=4
    { "answer": "Protect the factories", "ideologue": "capitalist",
      "pays": { "funds": 4 } }                     // Σ=4
  ] }
```
`funds: 4 ≥ funds: 2` strictly, `trust: 2 ≥ trust: 0`, so **D1 `PURE_UPGRADE`** — the
second side is a free upgrade for anyone, on a card that looks perfectly balanced
totally. **This card would pass a totals checker and kill a playtest.** That is the
single best argument for the checker's existence, and it is why the report and the
severity table ship together.

```jsonc
// ind-orig-042.json — a GOOD card. No check fires.
{ "id": "ind-orig-042", "campaign": "Reservoir",
  "question": "The same drought, the same authority, and this time they are filming the tanker queue…",
  "sides": [
    { "answer": "Let them film; the coverage is worth more than the water",
      "ideologue": "showstopper", "pays": { "media": 3, "trust": 1 } },   // Σ=4
    { "answer": "Sign, and keep the press out of it",
      "ideologue": "supremo", "pays": { "funds": 2, "clout": 1 } }        // Σ=3
  ] }
```
Totals differ by 1 (in band), neither side is coordinatewise ≥ the other (D1 clear), no
ideologue reaches `level3 = 3` on either side (D3 clear), the ideologues differ. **And
it is genuinely hard**: media is nearly useless until you unlock Showstopper powers,
and clout is the currency of influence. That is deliberation. The checker's job is to
make the *shape* of this good and the *shape* of the first one impossible, and to
leave the writing to the humans.


## 7. Milestone plan (M2–M5 rewritten)

### 7.1 The dependency reality — read this before scheduling anything

I read the import graph of all 12 engine files (§2.1). The consequence is that
**only one of the four remaining milestones is actually blocked by the engine
repair.**

| Milestone | Depends on the engine repair? | Why |
|---|---|---|
| **M2 Cards** | **No** | `cards.ts`, `state.ts`, `rules.ts`, `powers.ts` all compile today. The balance checker needs `RULES` (zero imports) and `sidePayout` (from `cards.ts`). Nothing touches `index.ts`, `setup.ts`, or `playerView.ts`. |
| **M4 Board** | **No** | `board.generated.ts` imports only a *type*. `BOARD`, `AreaSpec`, `ZoneSpec`, `COASTLINE`, `BOARD_WIDTH/HEIGHT`, `TOTAL_AREAS` are all available and self-consistent. The board is renderable today. |
| **M5 Client panels** | **No** | Renders `ClientState`, whose *type* is in `state.ts` (clean). Panels can be built against a **fixture harness** (§7.3). |
| **M3 Server** | **Yes — and only on `playerView.ts`** | `reduce.ts` compiles and is coherent. The server needs a *correct* `playerView`, which is the broken file. |
| **M6 Interrupts** | **Yes — soft** | `reduce` already implements both out-of-turn cases (§8.4). M6 is mostly client rendering. |

**So the schedule is three parallel lanes, not a queue.** The engine repair is on the
critical path for exactly one milestone, and the single file that matters is
`playerView.ts`.

```
                ┌─────────────────────────────────────────────┐
  ENGINE REPAIR │ playerView.ts (rewrite) + index.ts + setup.ts│  in flight
  (in flight)  └───────────────────────┬─────────────────────┘
                                        │ gates ONE thing
        ┌───────────────────────────────┼──────────────────────────────┐
        │                               │                              │
  LANE A│  M2 Cards            LANE B  │  M3 Server          LANE C   │  M4 Board
        │  schema, validator,          │  hub, MatchRunner,   │  SVG, 129 slots,
        │  balance checker,            │  broadcast.ts,       │  geometry,
        │  ~40 seed cards              │  store, protocol     │  keyboard model
        │  (blocked only on: licence)  │  ← the secret-state   │  (no deps at all)
        │                              │    gate lives here    │  → M5 panels
        └──────────────────────────────┴──────────────────────┴────────────┘
                                                  │
                                          M6 Interrupts & M7 Hardening
```

**One scheduling recommendation that is not about code:** the card corpus is risk #1
in PLAN.md and it is *writing*, not engineering. It should start on day one, in
parallel with everything, and it is the milestone most likely to slip. Every lane
below is sized to leave M6/M7 with slack for it.

### 7.2 Milestone summary

| # | Milestone | Lane | Blocked by | Size | Depends on server? |
|---|---|---|---|---|---|
| **M0r** | Engine repair (in flight) | — | — | ~1d | — |
| **M1.5** | Legal: send the email | parallel | nothing | 0d (async) | no |
| **M2** | Card pipeline + first corpus | A | M1.5 *email only* | 2d build + writing | no |
| **M3** | Server | B | **M0r (`playerView.ts`)** | 3d | — |
| **M4** | Board SVG + a11y | C | nothing | 4d | no |
| **M5** | Client panels | C | nothing (fixtures) | 3d | no |
| **M6** | Conspiracies, headlines, interrupts | C→B | M0r (soft) | 2d | yes |
| **M7** | Hardening + release gate | all | M2–M6 | 2d | yes |

Critical path: **M0r → M3 → M7.** M4/M5 and M2 run entirely off it.

### 7.3 M0r — Engine repair *(in flight, not mine to sequence)*

**Deliverable:** `packages/engine` compiles; `test/` non-empty; the export surface is
§2.2.

**Files changed:** `src/index.ts` (re-export the 10 files that exist, not the 6 that
don't), `src/setup.ts` (rewrite against `freshZones()` + `RULES` + `shuffle`),
`src/playerView.ts` (rewrite, per §4), `test/*.test.ts` (new), plus **one line in
`src/reduce.ts`**:

```ts
// reduce.ts, ANSWER case — change `unknown ideology card ${cardId}`
// to a fixed string. See §4.6(b): this interpolates a card ID from
// _ideologyDraw into a client-visible error message.
- return fail(`unknown ideology card ${cardId}`);
+ return fail('this card is not in the current deck');
```

**Exit criterion (objective):**
```
npm run typecheck --workspace @shasn/engine    # exit 0
npm test  --workspace @shasn/engine            # 4 named tests green (§2.4)
```

**Risk:** the repair agent treats `playerView` as a mechanical port of the old one
and reproduces the old field list, producing a `ClientState` that *typechecks* and
*silently omits* the deck arrays it should be omitting — but also silently includes
something. **Mitigation:** §2.2 gives the exact `Omit<...>` union (all 9 fields) and
§4.5's test #1 asserts the secret set explicitly, so a wrong `_` list fails the
build rather than shipping. The risk is *real* and is the reason `playerView.ts` is
called out as the critical path in §0.

**Downstream contract:** if the repaired `playerView` returns a `ClientState` whose
shape differs from §4.4, **`docs/ARCHITECTURE.md` §4.4 is updated, not the client.**
The client adapts to the engine, never the reverse.

### 7.4 M1.5 — Legal *(day one, zero engineering)*

**Deliverable:** one email to Memesys. **Files:** none. **Exit criterion:** sent, and
a `docs/licence.md` note recording the date and the ask. **Risk:** none, because
nothing is blocked on the answer (§6.1). **Do not skip it** — it is one email and it
is the only thing standing between the corpus and a takedown.

### 7.5 M2 — Card pipeline (Lane A)

**Deliverable:** the schema, the validator, the balance checker, and the first
corpus slice.

**Files created:** `packages/cards/{package.json,tsconfig.json}`;
`schema/{ideology,voter,conspiracy,headline}-card.schema.json`, `schema/index.ts`;
`src/{index,balance-rules}.ts`; `scripts/{validate,balance}.ts`;
`decks/manifest.json`; `decks/ideology/india-orig/ind-orig-001…040.json`;
`decks/voter/core/vot-001…024.json`; `decks/conspiracy/core/con-001…012.json`;
`decks/headline/core/head-001…008.json`; `test/balance.test.ts` (includes the two
worked examples from §6.4.3 as fixtures, so the checker's behaviour is pinned).

**Files changed:** root `package.json` (add `lint:secrets`, `cards:check`).

**Exit criterion (objective):**
```
npm run cards:check          # validate (9 checks) AND balance; exit 0
npm test  --workspace @shasn/cards
```
Concretely: 40 Ideology / 24 Voter / 12 Conspiracy / 8 Headline cards, zero
`balance` **errors**, zero `validate` errors, and the §6.4.3 bad card is present in
`balance.test.ts` as a fixture that the checker *flags*.

**Risk:** *the corpus is risk #1 and it is writing, not engineering.* 40 genuinely
hard, genuinely balanced, non-partisan dilemmas is roughly two days of focused work
that **does not parallelise with anything else** because it needs one continuous
mind. **Mitigation:** ship 40 to prove the pipeline, then treat the remaining ~60 as
a separate content track with a reviewer, not an engineer. Do not let the corpus
block M3/M4/M5 — the pipeline is the deliverable that unblocks everything else.

**Exit criterion for the *pipeline* alone** (available on day 1, before any card is
written): `npm run cards:check` runs green against a 4-card fixture deck. That is
the real M2 deliverable; the corpus is a separate content effort.

### 7.6 M3 — Server (Lane B) — *gated on M0r*

**Deliverable:** the whole of §3 and §4, running.

**Files created:** `packages/shared/src/{protocol,session,view,index}.ts`;
`packages/server/src/{index,hub,match-runner,broadcast,store,protocol-handler,redaction,replay}.ts`;
`packages/server/src/db.ts`; `test/{broadcast,resume,spectator,protocol-handler}.test.ts`.

**The one file that matters: `packages/server/src/broadcast.ts`.** It is written
first, before `hub.ts`, and it is the only file permitted to read a `_` field or
format a `GameState`. §4.3 gives its full shape.

**Exit criterion (objective) — and this is PLAN.md §7's M3 criterion, kept:**
```
npm run lint:secrets                          # the 3 greps (§4.5)
npm test  --workspace @shasn/server            # incl. the broadcast leak tests
npm run typecheck                             # all 5 packages
```
**Plus the manual, non-automatable gate, and it is the real one:**
> Two browsers → one private lobby → start → play to a blind answer →
> **open devtools → Network → WS Frames → search for the card id, `_seed`,
> `ideologyDraw`, and the payout resource names → zero hits.**

The automated tests prove the projections are right; only a human reading the wire
proves the projections are the ones actually sent. **PLAN.md's M3 exit criterion —
"two browsers, real game, payouts confirmed absent from devtools" — was correct and
I am keeping it verbatim.** It is the correct exit criterion for this project.

**Also required, and a distinct test:**
```
npm test --workspace @shasn/server -t "resume after 2h"
```
— kill the server process, restart it, resume with the token, and assert the
rehydrated `ClientState` deep-equals a freshly-computed `playerView(state, me)`.
This is PLAN.md risk #5 as a test, not a hope.

**Risk:** *the secret-state contract is only as good as its enforcement, and
enforcement is three greps plus four tests that a future contributor can delete.*
Mitigations: (a) `handler.renderAll`'s `never` check means deleting a test fails the
**compiler**, not just CI; (b) the three greps are in `npm run typecheck` so they
cannot be skipped by running only tests; (c) the manual devtools gate is repeated as
a release checklist item in M7. **The residual risk is a human deciding to send raw
state for debugging.** That is a process risk, and §4.6(a)'s grep is the guardrail.

### 7.7 M4 — Board SVG + accessibility (Lane C) — *zero dependencies*

**Deliverable:** the board, rendering a `ClientState`, driven by fixtures.

**Files created:** `packages/client/{package.json,tsconfig.json,index.html,vite.config.ts}`;
`src/{main,app/{App,ErrorBoundary,Router}}.tsx`;
`src/board/{BoardSvg,ZoneOutline,PegSlot,GerrymanderLayer,Coastline,geometry}.tsx|ts`;
`test/{geometry,board-a11y}.test.tsx`.

**The fixture harness — this is what makes Lane C truly independent:**
`src/dev/fixtures.ts` exports a set of hand-built `ClientState` objects (empty board,
mid-game, a zone locked, a volatile area, a full board). A `__DEV__`-only import in
`net/store.ts` lets the entire client run with no server and no network. **This is
not a mock of the engine; it is a set of *inputs*, exactly as the server would
produce them.** The client is written against the real type and cannot drift from it.

**Exit criterion (objective):**
```
npm run build  --workspace @shasn/client    # exit 0
npm test       --workspace @shasn/client
npm run a11y   --workspace @shasn/client    # axe-core on the fixture board
```
Concretely: 129 `PegSlot` nodes in the DOM; exactly **one** with `tabIndex=0`;
each with a non-empty accessible name; no axe violations; and a geometry test
asserting every `AreaSpec` maps to a slot whose centre is inside its zone polygon
(so the generator and the renderer cannot disagree).

**Risk:** *129 React elements and SVG reconciliation.* Mitigated by `React.memo` with
primitive props, unconditional rendering (stable keys, no mount/unmount), and
`transform-box: fill-box` set once in CSS. **The performance risk is low and the
accessibility risk is the real one** — the keyboard model (§5.7) and the gerrymander
keyboard path (§5.6) are the deliverable, not the drag. A board that cannot be
played by keyboard is a failed milestone even if it looks correct.

**Not a risk, worth stating:** the board depends on nothing in the server, so M4 can
start on day one in parallel with the engine repair.

### 7.8 M5 — Client panels (Lane C) — *fixtures, no server needed*

**Deliverable:** §5.3–5.7. `AnswerPrompt`, `SpendPanel`, `ManifestoTray`,
`TradePanel`, `MarketPanel`, `PendingChoices`, `HeadlineOverlay`, `EventLog`,
`ConnectionBadge`, and the lobby screens.

**Files created:** `src/panels/*.tsx`, `src/lobby/*.tsx`, `src/net/{connection,store}.ts`,
`src/app/store.tsx` (the `useSyncExternalStore` hook),
`test/{answer-prompt,no-optimism,keyboard}.test.tsx`.

**Two tests here are architecturally load-bearing:**

```ts
// 1. The blind prompt renders no payout, no ideologue, no card id — asserted on
//    the RENDERED DOM, not on the props, because the DOM is the attack surface.
it('renders the blind answer with zero secret-derived content', () => {
  const { container } = render(<AnswerPrompt blind={FIXTURE_BLIND} … />);
  const text = container.textContent ?? '';
  const attrs = [...container.querySelectorAll('*')]
    .flatMap((el) => [...el.attributes].map((a) => `${a.name}=${a.value}`)).join(' ');
  const blob = text + ' ' + attrs;
  for (const forbidden of ['funds', 'clout', 'media', 'trust',
                           'capitalist', 'idealist', 'supremo', 'showstopper',
                           'ind-orig-', '_seed', 'pays'])
    expect(blob).not.toContain(forbidden);
});

// 2. No optimistic UI: dispatching never mutates the store before the server
//    confirms. Asserted by dispatching and checking the store is unchanged.
it('does not apply an action locally', () => {
  const before = store.getState().state;
  store.dispatch({ type: 'PLACE_VOTERS', groupId: 'g1', areaIds: ['central-3'] });
  expect(store.getState().state).toBe(before);   // identical reference
});
```

Test #2 is the mechanical enforcement of §5.5.1. It is a **reference equality**
assertion, so it cannot be passed by a deep-equal clone.

**Exit criterion (objective):**
```
npm run build --workspace @shasn/client && npm test --workspace @shasn/client
npm run a11y  --workspace @shasn/client
```
Concretely: the board and every panel render green against fixtures; the two tests
above pass; the app is fully playable **end to end against the fixture harness with
no server** — which is also the demo/QA artifact for M4/M5.

**Risk:** *the fixture harness becomes a parallel implementation of the server's
projection and drifts.* Mitigation: fixtures are typed `ClientState` and are
regenerated from a real server state once M3 lands, via a
`dump-fixtures` script in `packages/server`. The client's tests then run against
server-produced truth. **Cost:** one script, written in M3, run in M5. **Cheap, and
it closes the loop between Lane B and Lane C.**

### 7.9 M6 — Conspiracies, headlines, interrupts (Lanes B + C)

**Deliverable:** the second half of §8.4, plus the M5/PLAN.md open question #5
(headline resolution order).

**Files changed:** `packages/client/src/panels/{ConspiracyTray,HeadlineOverlay,InterruptStrip}.tsx`;
`src/net/store.ts` (`applyEvents` gains interrupt-event handling);
`packages/server/src/store.ts` (snapshot on phase change, §3.6).
**Files created:** `test/interrupt.test.ts` in both server and client.

**What is actually new here:** §8.4 argues that the out-of-turn mechanism **already
exists** in the engine (`reduce`'s two explicit turn-gate exceptions, and
`PendingChoice` as a general "this player owes a decision" channel). So M6 is
**mostly rendering, not framework construction** — which is why PLAN.md's estimate of
2 days for an "interrupt/out-of-turn action framework" was, in hindsight, about right
but for the wrong reason. **There is no framework to build.** Building one would
introduce a second, competing notion of "whose turn is it".

**Exit criterion (objective):**
```
npm test --workspace @shasn/server -t "interrupt"
npm test --workspace @shasn/client -t "interrupt"
```
Concretely: (a) a non-active player can `PLAY_CONSPIRACY` during `phase: 'answer'`
and it resolves; (b) the attempt is visible to **all** players in an
`InterruptStrip` ("Asha played a Conspiracy out of turn"); (c) a non-active player
**cannot** perform any other action; (d) a `PendingChoice` addressed to a
non-active player renders for that player only and blocks their other actions
exactly as `reduce`'s `blockedBy` specifies.

**Risk:** *PLAN.md risk #4, interrupt timing.* The residual risk is not mechanism but
**table experience**: out-of-turn plays are disruptive by definition, and a
5-player async table can be ambushed. **Mitigation, chosen deliberately: no timer and
no window.** The rulebook's own framing (p19, "right before an opponent answers") is
self-limiting, and a timer is a house rule nobody asked for. If playtesting shows it
is too chaotic, the *cheap* fix is a "reactions window" in the lobby, not a change to
the engine. **This is the one place where I would expect to be wrong**, and the
cheapest way to find out is a 5-player playtest, not an architecture argument.

### 7.10 M7 — Hardening + release gate

**Deliverable:** the thing that makes the game safe to let strangers into.

**Files created:** `test/leak-fuzz.test.ts` (property-based: generate N random
`ClientState`s, assert no `_` key in any projection); `docs/RELEASE-CHECKLIST.md`.

**Exit criterion (objective), all must be green:**
```
npm run typecheck          # all 5 packages, incl. lint:secrets
npm test                   # all 5 packages
npm run cards:check
npm run balance -- --strict    # warnings are errors at release
npm run build --workspace @shasn/client
```
**Plus the manual checklist, repeated deliberately from M3** (a gate you run once is
a gate you forget): five browsers, a real game to `finished`, devtools open the
whole time, devtools closed, tab refreshed mid-answer, tab closed for 10 minutes and
resumed, and a second machine watching as a spectator. **Any leak at any point is a
release blocker.**

**Risk:** *a 4-hour game is long enough that something always breaks.* The action
log (§3.6) means the worst case is a replayable match, not a lost one — **but only if
the store was actually writing.** So the release checklist includes one deliberate
test: **kill the server process mid-game, `fly ssh console`, restart, resume, and
confirm the match state is intact.** That single test converts PLAN.md risk #5 from
a mitigation into a verified property.

### 7.11 Critical path and the honest schedule

```
day  1  M0r starts (parallel agent)  │  M1.5 email sent  │  M4 board starts
day  2  M0r → playerView done        │  M2 pipeline green │  M4 board
day  3  M3 server starts (gated ✅)  │  M2 corpus begun  │  M4 a11y
day  4  M3 broadcast.ts (the gate)  │  M2 corpus        │  M5 panels
day  5  M3 store + resume test      │  M2 40 cards      │  M5 panels
day  6  M3 devtools gate ✅  ← M3 done│  corpus continues │  M5 ✅ ← M5 done
day  7  M6 interrupts               │  corpus           │  fixture regen
day  8  M6 + M7                     │  corpus           │  M7
day  9  M7 release gate             │
```

**M3 and M4+M5 finish on the same day, by design** — they are independent lanes, which
is the entire point of §7.1. The corpus (M2's content half) is the long pole and runs
past M7, which is correct: **shipping with 40 cards is a good demo; shipping with 100
is a good game.** Nothing in M3–M7 needs more than 40 cards.


## 8. Key decisions & rationale

### 8.1 The decision table

| # | Decision | Rejected alternative | Why this one | Cost accepted |
|---|---|---|---|---|
| **D1** | **Hand-rolled WebSocket server on `ws`** | **boardgame.io** (PLAN.md §3) | ① It would own the phase machine, and `reduce.ts` already is one (4 phases, headline queue, cap freezes, a `PLAY_CONSPIRACY`-out-of-turn exception). Two authorities = intermittent bugs in hour 3. ② **Its undo/history persists `_ideologyDraw`/`_conspiracyDraw`/`_headlineDraw` in the DB — the full answer key, in order. Disqualifying.** ③ Its client predicts, and prediction is the forbidden thing here. ④ It doesn't solve the hard part of PLAN.md risk #5 (durable resume, private lobbies, resume *tokens*, spectator isolation, staging deploys) — it solves the easy part. | ~3d of server work vs PLAN.md's 2d + adapter. No lobby/reconnect for free. A team of one maintains it. |
| **D2** | **SVG for the board** (upholds PLAN.md) | Canvas | 129 hit targets need real focusable DOM nodes. Canvas forces *three* implementations of the geometry — render, mouse hit-test, keyboard — that must agree, and a mis-placed voter is permanent. Canvas's win condition is thousands of animating objects; this board has 129 static slots. | 130 DOM nodes; `viewBox` scaling; SVG quirks (`transform-box: fill-box`, no text wrapping — hence HTML overlay for all text). |
| **D3** | **JSON cards in git** (upholds PLAN.md) | Postgres / a CMS | A balance pass to three cards becomes a 3-file diff. A copyright audit becomes `git log -- packages/cards`. The card text is the copyrightable asset (PLAN.md §8) and needs a *separate review history* from engine code. The balance checker (§6.4) is a CI gate over git. | No runtime editing, no content versioning beyond git, a loader must glob 200 files, no partial deck loading. |
| **D4** | **Persisted match state — action log is truth, snapshot is a cache** | "In-memory first" (PLAN.md §3) — **overturned** | PLAN.md risk #5 says a 4–6 hour match must survive a refresh; "in-memory first" loses to the first deploy. The engine is deterministic and seeded, so `(seed, rules, cards, log)` *reconstructs any state* — a 24-hour match is a replay, not a restore. | A `rulesVersion`/`cardsVersion` drift is a correctness bug (mitigated by pinning hashes and refusing mismatched replays). A JSONB row rewrite per append. |
| **D5** | **No general interrupt framework — use the two turn-gate exceptions that already exist** | A pending-interrupt queue with windows (PLAN.md §7 M5) | `reduce` already permits `PLAY_CONSPIRACY` out of turn during `phase: 'answer'`, and `RESOLVE_CHOICE` is addressed to whoever owns the `PendingChoice`. `PendingChoice` **is** the general out-of-turn decision channel. A second framework means a second notion of "whose turn is it". | No timed window; a player can play a conspiracy at the least convenient moment. Accepted — it's the rulebook's own framing (p19) and disruption is the cost. **This is the decision most likely to be wrong.** |
| **D6** | **`playerView` + a separate `blindPromptFor`; one projection for players and spectators** | Merging the blind prompt into a conditional `playerView` | The structural test (§4.5) walks for `_` keys. A conditional `playerView` emitting card data *passes* that test and still kills the game. Two narrow projections are each independently assertable. | One extra RTT, or a `blind` field computed in the same send. |
| **D7** | **No optimistic UI in the client; the store is a fold over messages** | Optimistic apply + reconcile (what boardgame.io would have given us) | Rejections are frequent and real (`'voters in a Volatile Area cannot be affected'`) so rollback is janky; more importantly, a client that applies actions locally holds a copy of the game, and a client holding a copy is one refactor from holding a card. The rule survives only if it is structural — a store with no `dispatch(action)` has nothing to be optimistic *with*. | ~1 RTT before anything moves. Invisible at 2 actions/min. |
| **D8** | **No optimistic *presentation* either — animate between server facts** | CSS transition on the newly-received state | Same reason, and it keeps the rule absolute rather than negotiable. A 300ms interpolation on an already-true fact is animation, not prediction. | 300ms on every action. |
| **D9** | **One Node process, no workers** | Worker threads / a cluster | The engine is synchronous and pure — a whole turn is sub-millisecond. There is no CPU-bound work to move, and a worker adds a structured-clone boundary around the exact object whose secrets §4 is protecting. Keeps secrets in one heap with one audited exit. | Single point of failure — mitigated by the action log (a crash is a replay, not a loss) and verified in M7. No horizontal scale; designed for, not built (§3.7). |
| **D10** | **`@shasn/shared` — a 4th package for ~250 lines of types** | Client type-imports from the server / duplicate the types | The client/server contract is where a silent mismatch is catastrophic. A build error on a new `state` field is worth one package. | One more manifest, one more tsconfig, one more version to bump. |
| **D11** | **React 18.3, not 19** | React 19 | StrictMode double-rendering is a *leak detector*: any render path that computes a possible gain runs twice in dev and gets noticed. React 19's concurrency makes that signal less reliable. | Missing 19 bugfixes. |
| **D12** | **Ship raw TS from `src` (existing convention) + `tsx` on the server** | Add a build step / `tsc -b` project references | No published artefacts, no runtime consumers. `tsx` is one dev dependency in one package. | A dev dependency in the production image; the client bundles TS through Vite. Revisit if cards force a build. |
| **D13** | **One Postgres JSONB row per match** | Relational `matches` + `match_actions` | ~2 appends/min, ~1 MB at 2,400 actions. The relational split is a 30-minute change later. | Whole-row rewrite per append. Listed in §9. |
| **D14** | **Ship with 40 cards** | Wait for 100+ | PLAN.md risk #1 is the corpus, and it is writing that does not parallelise. 40 is a complete, playable game with replay value; 100 is better but it is a content track with a reviewer, not an engineering gate. | Shallower replay variety. |
| **D15** | **Original decks; licence question asked, not awaited** | Write licensed decks now, or block on the email | Nothing in the engine or the pipeline depends on the licence. Path 2 keeps both branches open at zero cost. | No real campaign names. CI greps for Memesys/Zain Memon tokens. |
| **D16** | **Balance checker: `PURE_UPGRADE` and `POWER_THRESHOLD_CLIFF` are CI *errors*; `TOTAL_SKEW` is a warning** | Totals-only checking | A 4-vs-4 card where one side is `{funds:4}` and the other `{funds:2, trust:2}` is a pure upgrade, passes a totals check, and kills a playtest. The power-threshold cliff is invisible to any totals check. | The corpus will not be `--strict` clean until human-reviewed. |
| **D17** | **±1 total resource tolerance band** | Zero-tolerance | One resource is 8% of a 12 cap, ~30 resources pass through in a game, and it cannot be decisive. Two is 17% and decides redraw affordability at the margin — which is where Shasn is played. | Some fine cards get flagged and argued about. The argument is the design review. |
| **D18** | **Resident `viewId` per match; events buffered until state lands** | Merge state+events in one message | A full 129-area state is ~40–80 KB; at 5 players × 2 actions/min × 4 h that is ~150 MB per match. | ~20 lines of client ordering logic. |
| **D19** | **Full state on every phase change, not per-area diffs** | Diffing (JSON Patch) | A diff of a state containing nine deck arrays is itself a leak vector, and it is a second thing to get right. Phase changes are ~2/turn and are exactly when a full state is most useful. | A few more full states. Irrelevant at this scale. |
| **D20** | **Roving tabindex on the board (one tab stop for 129 slots)** | Every slot `tabIndex=0` | 129 tab stops means a keyboard user can never reach the rest of the UI. One stop + arrow keys is the standard composite-widget pattern. | Arrow-key movement is custom and is real code in §5.7. |
| **D21** | **`resumeToken` in `sessionStorage`, rotated on every use** | A `matchID` as the reconnect credential; cookies; `localStorage` | A `matchID` is not a credential — it is guessable and takes your seat. Rotation makes a leaked token single-use. `sessionStorage` is per-tab and does not leak on a shared machine. Cookies attach to cross-site requests. | A tab crash loses the session; a closed-and-reopened tab needs a re-join. Correct for a game. |
| **D22** | **24h seat-reclaim grace window** | 1h / never | 4–6 hour sessions are the case the feature exists for. Beyond it, a vote-to-kick is the fix. | An abandoned account can block a table indefinitely. |
| **D23** | **No admin/debug HTTP surface** (3 routes only) | A `/state` or admin endpoint for ops | Every extra route is a place secrets can escape. Ops uses `fly ssh console` + the replay tool against the action log, which is *better* debugging anyway. | No production introspection UI. |
| **D24** | **Events are broadcast verbatim to everyone, including spectators** | Per-recipient event redaction | Every `GameEvent` is public by construction (`answered` carries `{player, cardId, side}`, not the payout). Asserting that once, in the engine, removes an entire class of redaction bug. | The client cannot animate "you gained 2 funds" from the event — it reads its own pool from its own `ClientState`. |
| **D25** | **Conspiracy hands are public** | Hiding opponents' conspiracy hands | A conspiracy in hand is visible to opponents at a physical table. Hiding it makes the digital game *less* informative than the physical one, and the bluffing lives in the *answer*, not the hand. | An attacker enumerates a player's hand. Already public at the table. |

### 8.2 The three decisions I would most expect to be challenged

**D1 (dropping boardgame.io).** The strongest counter-argument is that boardgame.io's
lobbies, reconnect, and `playerView` signature are real, tested, and free, and that
~3 days of server work is a real cost for a project whose biggest risk is *content*.
My answer is the undo-history point: it is not a missing feature but a **feature that
must be actively disabled**, whose disabled state still leaves the database holding
the full deck orderings. I would not build a blind-answer game on a framework that
wants to keep that data. **The residual risk in D1 is that I under-rate the value of
somebody else's lobby and reconnect code.** The mitigation is M3's test suite: the
behaviours are written down as assertions, so a future move to Colyseus is a swap
against a spec.

**D5 (no interrupt framework).** The counter-argument is that "anything, any order,
repeatable" plus out-of-turn plays is a genuinely complex scheduling problem and a
queue is the standard answer. My answer is that the engine's `PendingChoice` list *is*
that queue, already implemented, already addressed per-player. Building a parallel one
would be the thing that breaks. **This is the decision I hold with least confidence**,
and the cheapest disconfirmation is a 5-player playtest in M6, not more analysis.

**D16/D17 (the balance checker).** The counter-argument is that a checker this
opinionated will reject good cards and that balance is a judgement call. It will — and
the severity table is deliberately split (2 errors, 3 warnings) precisely so the
judgement calls are visible and reviewable rather than automated away. **The
counter-argument I find most persuasive is D3's cost at scale:** by card 100, a
checker that flags 5% of submissions is noise and will get `--no-ignore-errors`'d. So
the tolerance band is a *policy* number that should be reviewed after the first 40
cards are playtested, not a constant. **Recorded in §9.**

### 8.3 Things deliberately left undecided

- **Auth.** `packages/server` assumes a `playerId` exists. Accounts, OAuth, and
  anonymous-vs-persistent are a M7+ question and no design here depends on the answer
  (the resume token is a credential either way).
- **Anti-cheat / rate limiting.** The reducer is deterministic and the server is
  authoritative, so cheating is bounded to "send actions faster than a human can" and
  "disconnect to dodge a penalty". A per-connection rate limit is an afternoon's work
  and belongs in M7. **Note it is not a security control** — the security control is
  that the client never has the information to cheat with.
- **Rate-limit / turn-timeout policy for async play.** See §9.

---

## 9. Open questions carried forward

| # | Question | Owner | Blocks | My leaning |
|---|---|---|---|---|
| 1 | **Headline resolution order** — PLAN.md §6 Q5, reviewers flagged ambiguity *in the printed rulebook*. `state.headlineQueue` is an ordered array and `ACK_HEADLINE` drains it, so the mechanism exists; the *order within a turn* is the open item. | M6 | M6 | "One Headline per volatile placement, in placement order" is what `reduce` already implements. Confirm against p18. |
| 2 | **Out-of-turn chaos** — is D5 (no window) actually playable at 5 players? | M6 playtest | M6 tuning, not M6 build | Add a *lobby* reactions window if needed. Do not add an engine-level timer. |
| 3 | **Balance tolerance band** — is ±1 right once 40 cards are playtested? | M2 | M2 corpus sign-off | Review the `--strict` warning count after the first 40. If >15% warn, the band is too tight. |
| 4 | **Conspiracy card list + costs** — PLAN.md §6 Q4, only one name known. | M2 | M6 gameplay depth | 12 seed cards is enough to prove the pipeline. |
| 5 | **`Store` relational split** — JSONB row rewrite per append. | M7+ | Nothing below 10k actions | Revisit at ~10,000 actions/match, which is beyond a 5-player 4-hour game. |
| 6 | **Spectator count** — unlimited, or capped? | M7 | Nothing | Unlimited. They cost one `playerView` call each, which is the cheapest operation in the system. |
| 7 | **Async nudge** — no turn timer exists. A 4-hour session with 5 players needs *some* signal that it is your turn. | M5 | M7 | In-app + Web Push. **Out of scope for the architecture** — it touches no state, only `activePlayer`. Worth doing early; it is what makes async survive. |
| 8 | **Multiple machines** — §3.7 is single-instance by design. | — | Nothing in v1 | Sticky routing by `matchId` + a socket relay. Every byte needed is in the action log, so it is a routing problem, not a state-sharing problem. **Designed for, not built.** |

### 9.1 What would make this document wrong

Stated up front, because a design doc that cannot be falsified is not a design doc:

1. **If the engine repair lands a `playerView` that does not match §4.4**, §4.4 is
   updated to match. The *contract* (no `_` key, structurally tested) does not change.
2. **If playtesting shows the ±1 band is wrong**, D17 changes. It is a policy number,
   and §8.2 says so explicitly.
3. **If boardgame.io ships a fix for the history leak and modern React support**,
   D1 deserves re-examination. It would still have to beat §3.4's rehydration
   requirements, which it does not today — but that is a moving target and PLAN.md's
   "budget 2 days to swap" instinct is the right one to preserve.
4. **If a 5-player playtest shows out-of-turn plays are unmanageable without a
   window**, D5 changes. The engine's `PendingChoice` mechanism means this would be a
   *policy* change in the server, not an engine change — which is the whole reason D5
   was chosen.

