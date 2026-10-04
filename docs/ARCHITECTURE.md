# Digital Shasn — Architecture for Remaining Milestones

> Status: **all sections written; reconciled against the code 2026-09-30 (2nd pass).**
> Ground truth: `PLAN.md`, `packages/*/src/*`, `docs/rules-reference.md`,
> `docs/ENGINE-AUDIT.md`.
> Author: software-architect · Scope: packages/cards, packages/server, packages/client,
> and the boundary contract against the engine.
>
> **Read §0, then §3.1 and §4.** §3.1 overturns PLAN.md §3 (no boardgame.io) and
> §4 is the project's most important subsystem. §9.1 lists what would make this
> document wrong.
>
> ---
>
> ## Reconciliation pass, 2026-09-30 (documentation-only)
>
> This document was written while the engine was mid-repair. Two milestones and one
> security decision have since landed, and the prose below still described the earlier
> state. Corrected here rather than silently, so the correction is auditable:
>
> - **§0, §2.1, §2.2, §4.2, §4.5** — the engine repair (M0r/M1) is **complete**.
>   `npm run typecheck` exits 0; 179 engine tests pass. `playerView.ts` is rewritten,
>   `setup.ts` is rewritten, `index.ts` re-exports all 12 modules, and the secret
>   count is **eleven** `_` fields, not nine and not ten.
> - **§3, §7.6** — the server (M3) is **complete**: hand-rolled `ws`, action-log store
>   with in-memory *and* Postgres implementations, lobby/join/reconnect/resume/spectators,
>   runtime message validation, and the three-layer secret-state gate. boardgame.io was
>   never adopted; D1 is settled in the code, not merely in this document.
> - **§3.4, §4.4, §8.1** — **D25 is OVERTURNED. Conspiracy hands are NOT public.** The
>   engine strips every player's hand, including the viewer's own. See the labelled note
>   at §8.1 D25 for the full argument; this is the single most consequential change in
>   this pass.
> - **§5, §7.7, §7.8** — the board (M4) is **substantially done and verified**.
>   The client (M5) is **written but NOT working**: `src/app/` exists in full —
>   `App.tsx`, `Lobby.tsx`, `GameScreen.tsx`, `AnswerScreen.tsx`, `Panels.tsx`,
>   `YourMat.tsx`, `ResourcePicker.tsx`, `ChoiceResolver.tsx`, `BoardBars.tsx` — and the
>   wiring from `App.tsx` through `net/store.ts` to `connection.ts` is **real, not a
>   stub**. But `tsc --noEmit` in `packages/client` fails with **14 errors, all in
>   `src/app/GameScreen.tsx`**, so the app shell does not build, and it has **never been
>   run against a live server**. Do not read this as "panels not started"; read it as
>   "panels written, wiring unverified". §7.8 says what is specifically missing.
> - **§6, §6.5, §9** — the card pipeline (M2) is **built and 60 cards ship** (verified:
>   60 card ids across 6 deck files; 15 `adapted`, 45 `inferred`, **0 verbatim** — the
>   zero is deliberate, `PLAN.md` §8). But `packages/cards/KNOWN-GAPS.md` records that
>   **43 of the 50 real recovered cards (86%) cannot be expressed in the current
>   schema**, against a predicted 40%. Schema evolution is now a first-class milestone
>   task; §6.5 records it.
> - **§6.4.3** — the worked example was **arithmetically wrong**: it compared `trust:2`
>   against `trust:0` across *opposite sides* of the card, and called a 0-sum pair a
>   "pure upgrade", which a pure upgrade cannot be. Rewritten below. **§6.4's D3
>   definition also did not match the shipped checker**, which counts *threshold
>   crossings* rather than comparing per-resource; corrected in place.
> - **§8.1** — the decision table's **D25 row was itself still the superseded
>   "hands are public" position**, while §4.4 and this header said the opposite — this
>   document contradicted itself in its own most load-bearing row. Now corrected, with
>   the full argument in a labelled note at **§8.1.1**.
>
> Sections describing *design intent* are left as written; where intent and code now
> disagree, the code wins and the intent is annotated. Sections describing *observed
> state* have been updated to match.

> ### ⛔ A SECOND RECONCILIATION, 2026-10-03 — after full information
>
> **Read `packages/server/src/FULL-INFORMATION.md` first.** It is the authority and it is
> short. This document's **§4** carries a supersession block saying plainly what is public
> and what is still secret; §4.1, §4.2, §4.3, §4.4, §4.5, §3.3, §5.4, §6.5 and **D6** each
> carry ⛔ markers at their own location.
>
> **Three corrections that are *not* about the reversal and are drift like any other:**
> - **"60 cards ship"** (this header, §6, §6.5, §9, M2's row in §7.2, and **D14**) is
>   **now 151** — 0 `verbatim`, 41 `adapted`, 110 `inferred`, of which **76 are Ideology
>   Cards**. `packages/cards/decks/SOURCES.md` §3 is the per-card audit trail. **`D14`'s
>   threshold argument is unchanged and its decision stands**; only its counts are stale,
>   and `D14`'s own "the caveat that now dominates" is now outranked by `PLAN.md` §9
>   **risk #2 (dominance)**, which did not exist as a live risk on 2026-09-30.
> - **"the client does not compile — 14 errors in `GameScreen.tsx`"** (this header, §7.7)
>   is **historical**. `AnswerScreen.tsx` and `TableQuestion.tsx` are live shipped code that
>   quotes and depends on the current wire types, which is not consistent with a package
>   that does not build. **I could not run `tsc` for this pass**, so the claim is recorded as
>   *very likely stale* rather than corrected — see the ship-log entry in `PLAN.md`.
> - **M2's ledger row** in §7.2 keeps its 2026-09-30 numbers for the same reason `PLAN.md`'s
>   does: **a milestone ledger's value is that its entries are dated.** Append, never edit.
>
> **One thing that was *not* drift and is now wrong in the other direction:** the boardgame.io
> disqualifier's phrase *"the full answer key, in order"* (this header, §3.1, **D1**) was
> true only while the payout was withheld. What ordered history discloses now is **the deck and
> the `order` argument's input**. Still disqualifying — see `FULL-INFORMATION.md` §6 for the
> 45% position skew — but a smaller claim, and stated as such rather than quietly restated.

---

## 0. TL;DR — the decisions

Five decisions that shape everything else. **Status annotations added 2026-09-30; see
the reconciliation note above.**

1. **Drop boardgame.io. Hand-roll the WebSocket server on `ws`.** The engine is a
   pure synchronous reducer with its own phase machine; boardgame.io wants to own
   the phase machine, and its undo/history would persist complete deck orderings in
   the database. Full argument in §3.1. This **overturns PLAN.md §3**.
   **✅ SHIPPED — `packages/server` exists and boardgame.io was never installed.**
2. **The secret-state contract is enforced at the type level, by a structural test over
   the real broadcast function, and by a CI grep** — not over a hand-listed set of
   fields. `playerView` is the only sanctioned exit from the server, and
   **all eleven** `_` fields plus `PlayerState.conspiracies` are stripped. It is the
   single critical-path file of the project (§4).
   **✅ SHIPPED — see the reconciliation note above; the file no longer fails to compile.**
3. **Uphold SVG for the board.** PLAN.md is right, and the reason is stronger than
   PLAN.md gives: 129 discrete hit targets need real focusable DOM nodes. Canvas's
   advantage (many moving objects) does not apply to 129 static slots (§5.1).
   **✅ SHIPPED — `packages/client/src/board/`, 129 hit targets asserted in tests.**
4. **Match state is snapshotted to durable storage on every action, and the whole
   game is replayable from `(seed, actionLog)`.** Not "in-memory first" as PLAN.md §3
   says — a 4–6 hour match is PLAN.md risk #5, and in-memory loses to a deploy.
   In-memory becomes a *cache* in front of the snapshot, not the source of truth.
   **✅ SHIPPED — `store.ts` (`InMemoryMatchStore`, authoritative log + `replay()`)
   and `store-postgres.ts` (`PostgresMatchStore`, one JSONB row per match).** Postgres
   is opt-in via `SHASN_DATABASE_URL`; see §3.6 for the correction that the
   *action log* is written synchronously per action, not on a write-behind queue.
5. **The card balance checker flags `PURE_UPGRADE` and `POWER_THRESHOLD_CLIFF` as
   CI errors**, with a ±1-resource tolerance band. Total-sum checking is not
   sufficient and misses the failure mode that actually breaks the game (§6.4).
   **✅ SHIPPED — `packages/cards/src/balance.ts`, `BALANCE_TOLERANCE_TOTAL = 1`.**

**Critical path, as of 2026-09-30: the engine repair is complete, the server is
complete, and the board is complete. Two things remain before this is playable, and
neither is the transport:** (a) **the client does not compile** — 14 errors in
`app/GameScreen.tsx`, so the app shell has never rendered a real server state (§7.8);
and (b) **the card schema cannot express most real cards** — 43 of 50 (86%) —
which is **M2b**, promoted to a first-class milestone and sequenced before M6 (§6.5).

---

## 1. Package layout

### 1.1 Final tree

```
shasn/
├── package.json                      # npm workspaces, root scripts
├── tsconfig.base.json                # exists — do not fork per package
├── PLAN.md
├── docs/
│   ├── ARCHITECTURE.md               # this file
│   ├── rules-reference.md            # exists — rulebook transcription
│   ├── ENGINE-AUDIT.md               # exists
│   ├── UI-SPEC.md                    # exists
│   └── AUTHENTIC-SHASN-REFERENCE.md  # exists
├── packages/
│   ├── engine/                       # @shasn/engine   — pure TS
│   │   ├── src/{state,actions,cards,rules,resources,rng,powers,board,
│   │   │       board.generated,reduce,setup,playerView,index}.ts   (13 modules)
│   │   ├── scripts/{gen-board,preview-board}.mjs
│   │   └── test/                     # 11 files, 179 tests — all green
│   │
│   ├── cards/                        # @shasn/cards    — content + validation
│   │   ├── package.json
│   │   ├── schema/card.schema.json   # ONE file, all four card types
│   │   ├── decks/
│   │   │   ├── core/voter.json       # 12 Voter Cards, shared across campaigns
│   │   │   ├── et2040/{ideology,conspiracy,headline}.json
│   │   │   └── in2020/{ideology,conspiracy,headline}.json
│   │   ├── src/{index,corpus,engine,schema,validate,balance,effect-ops}.ts
│   │   ├── scripts/{validate,balance}.ts
│   │   ├── test/{validate,engine-parity,balance}.test.ts   # 61 tests
│   │   ├── KNOWN-GAPS.md             # G0–G24 — what the schema cannot express
│   │   └── README.md
│   │
│   ├── server/                       # @shasn/server  — ws + Room + store
│   │   ├── src/
│   │   │   ├── main.ts               # entrypoint; picks the store from the env
│   │   │   ├── index.ts              # ShasnServer: http + ws upgrade + dispatch
│   │   │   ├── lobby.ts              # LobbyHub, lobbies, seats, presence
│   │   │   ├── session.ts            # SessionStore, resume tokens
│   │   │   ├── room.ts               # Room: owns GameState, calls reduce()
│   │   │   ├── broadcast.ts          # THE ONLY place playerView is applied
│   │   │   ├── protocol.ts           # every client<->server message
│   │   │   ├── validate.ts           # runtime message validation (decode*)
│   │   │   ├── store.ts              # action log + replay + InMemoryMatchStore
│   │   │   └── store-postgres.ts     # PostgresMatchStore
│   │   ├── scripts/check-secrets.mjs # the CI grep (§4.5)
│   │   └── test/                     # 9 files, 101 tests, incl. render-all.ts
│   │
│   └── client/                       # @shasn/client  — React + SVG
│       ├── src/
│       │   ├── main.tsx
│       │   ├── net/
│       │   │   ├── protocol.ts       # type-only mirror of the server's
│       │   │   ├── connection.ts     # ws client, backoff, resume
│       │   │   ├── store.ts          # message-derived state (no optimism)
│       │   │   └── index.ts
│       │   ├── board/
│       │   │   ├── BoardSvg.tsx      # 1000×1500 viewBox, 9 zones, 129 slots
│       │   │   ├── ZoneOutline.tsx   ZoneLabel.tsx   VolatileRosette.tsx
│       │   │   ├── VoterSlot.tsx     # ONE per AreaSpec — 129 of them
│       │   │   ├── geometry.ts       # scales board.generated → viewBox
│       │   │   ├── useBoardGeometry.ts  useBoardScale.ts
│       │   │   ├── pegMatrix.ts      # 10 rows × 7 columns, the peg legend
│       │   │   ├── contours.ts       # the topographic ground
│       │   │   ├── types.ts  pegsOf.ts  fixtures.ts
│       │   │   ├── BoardHarness.tsx  Board.stories.tsx
│       │   │   └── board.css
│       │   └── answer/
│       │       ├── BlindAnswer.tsx   # §5.3 — the blind answer
│       │       ├── blindAnswer.types.ts   # the TYPE-LEVEL proof
│       │       └── blindAnswer.test.tsx
│       │   ├── app/                    # 🔧 WRITTEN, DOES NOT COMPILE YET (§7.8)
│       │   │   ├── App.tsx             # the shell: reconnect | lobby | scoreboard | game
│       │   │   ├── Lobby.tsx           # create/join/ready/start/spectate
│       │   │   ├── GameScreen.tsx      # the §5.0 shell. ⚠ 14 tsc errors — see §7.8
│       │   │   ├── AnswerScreen.tsx    # wraps BlindAnswer + the resource picker
│       │   │   ├── Panels.tsx          # Scoreboard, LogRail, HeadlineDialog, ErrorToast,
│       │   │   │                       #   ReconnectScreen, LinkDot
│       │   │   ├── YourMat.tsx         # your resources, pending groups, powers, end turn
│       │   │   ├── ResourcePicker.tsx  # the denomination stepper
│       │   │   ├── ChoiceResolver.tsx  # §5.9b PendingChoice decisions
│       │   │   ├── BoardBars.tsx       # PlacementBar, GerryBar
│       │   │   ├── store.ts            # app-local interaction state (not the net store)
│       │   │   ├── session.ts          # the singleton connection
│       │   │   ├── derive.ts           # ClientState → board/interaction projection
│       │   │   ├── blindWire.ts
│       │   │   └── app.css
│       ├── theme/tokens.css
```

> **What this tree differs from the design above, and why.** Four deltas, each because
> the milestone that was supposed to own the piece did not own it:
>
> 1. **No `packages/shared`.** §1.2 and D10 argued at length for a fourth package. It
>    was not created, because the milestones that needed it were scoped to
>    `packages/server/**` and `packages/client/src/net/**` and could not add a package.
>    The property §1.2 was buying was obtained a different way: the protocol is defined
>    in `server/src/protocol.ts`, mirrored as `client/src/net/protocol.ts`, and
>    `server/test/protocol-parity.test.ts` asserts the two are **mutually assignable**,
>    so drift is a compile error rather than a promise. See the labelled note at §1.2.
> 2. **One schema file, not four.** `schema/card.schema.json` holds all four card types.
>    The kind-narrowing §6.2 wanted is done at *validation* time instead
>    (`src/schema.ts` narrows `cards.items` to the matching `$defs`), which is
>    better — the schema file stays correct standalone.
> 3. **Deck files are per-kind, not per-card.** `decks/<deck>/<kind>.json` holds an
>    array. §6.3 argued for one file per card "for reviewable diffs"; in practice the
>    per-card `source` field and `git blame` deliver the review history, and a corpus
>    that a future schema change touches on 30 of 60 cards is *more* reviewable as 7
>    files than as 60. Recorded as a reversal, not an oversight.
> 4. **Board components are named differently and there is no `GerrymanderLayer`.**
>    `PegSlot` is `VoterSlot`, the coastline layer became `contours.ts` (the generator
>    produced a coastline but the real board is a contour map — the ground is now
>    contour rings clipped to `COASTLINE`, and the coastline is only a clip path).
>    Gerrymanding is a mode of `BoardSvg`, not a separate overlay component.

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

> ### ⚠ LABELLED NOTE — `packages/shared` does not exist, and D10 is deferred, not reversed
>
> **What happened.** `packages/shared` was never created. The server milestone was
> scoped to `packages/server/**` and the client transport milestone to
> `packages/client/src/net/**`; neither could add a fifth package, and neither was
> blocked on it. So the protocol lives in `server/src/protocol.ts` and is mirrored
> type-only at `client/src/net/protocol.ts`.
>
> **Why this is not a regression.** §1.2 rejected option B — "duplicate the message
> types in both packages" — with the sentence *"Two files, manually kept in sync…
> 'manually kept in sync' is a lie."* That rejection was correct about the *risk* and
> the mitigation for that risk turned out not to require the package. What actually
> landed is not option B:
>
> ```ts
> // packages/server/test/protocol-parity.test.ts — the property §1.2 was buying
> import type { ClientMessage as ServerSideIn, ServerMessage as ServerSideOut } from '../src/protocol';
> import type { ClientMessage as ClientSideIn, ServerMessage as ClientSideOut } from '../../client/src/net/protocol';
> // asserts mutual assignability, both directions, for both unions
> ```
>
> A field added on one side and not the other stops **compiling**. That is the same
> guarantee option C was for. The file that says so — `client/src/net/protocol.ts` —
> documents the reversal in place and states what to do when `shared` is eventually
> created: move both, delete both copies, delete the parity test.
>
> **What is still lost, honestly.** One thing: the server can now import *values* from
> `protocol.ts` (it does — `isSeatCount` is a runtime guard) with nothing stopping it,
> whereas `shared` would have been types-and-pure-functions-only by construction. Today
> that restraint is a review convention. **Open item for whoever creates
> `packages/shared`: keep the parity test until the move is done, then delete it, and
> add the grep that `protocol.ts` imports no `ws`/`node:*`.**

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

> **Corrected 2026-09-30 against the shipped manifests.** The blocks below are what
> actually exists. Three deltas from the design, each with a reason:
>
> - **`@shasn/shared` is absent** (see the labelled note at §1.2).
> - **`packages/cards` declares no dependency on `@shasn/engine`.** It reaches the
>   engine through `src/engine.ts`, which imports `../../engine/src/{cards,rules,state}`
>   by relative path. Two reasons, both real: the engine's `index.ts` does not
>   re-export `./cards` or `./rules` in a way the package could rely on, and the three
>   leaf modules import nothing else. `src/engine.ts` is the single place this happens
>   and the cards README records the follow-up.
> - **`@shasn/engine` is absent from the client's `dependencies` entirely** and is
>   consumed via `import type` from the workspace root. Type-only means no runtime
>   dependency is needed, and the CI grep (§4.5) is what actually enforces it.

Root `package.json` — the workspace wiring. Already `"workspaces": ["packages/*"]`,
which is correct and needs no change; each new package is picked up automatically.

```jsonc
// packages/cards/package.json  (shipped)
{
  "name": "@shasn/cards",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "validate": "tsx scripts/validate.ts",
    "balance": "tsx scripts/balance.ts",
    "test": "vitest run", "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.10.2", "ajv": "^8.17.1", "tsx": "^4.19.2",
    "typescript": "^5.7.2", "vitest": "^2.1.8"
  }
}
```

```jsonc
// packages/server/package.json  (shipped)
// NOTE "typecheck": "tsc --noEmit && node scripts/check-secrets.mjs" — the secret
// gate is inside typecheck, so it cannot be skipped by running only the tests (§4.5).
{
  "name": "@shasn/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "dev": "tsx watch src/main.ts", "start": "tsx src/main.ts",
    "lint:secrets": "node scripts/check-secrets.mjs",
    "typecheck": "tsc --noEmit && node scripts/check-secrets.mjs",
    "test": "vitest run"
  },
  "dependencies": { "@shasn/cards": "*", "@shasn/engine": "*", "ws": "^8.18.0" },
  "devDependencies": { "@types/ws": "^8.5.13", "tsx": "^4.19.2",
                       "typescript": "^5.7.2", "vitest": "^2.1.8" }
}
```

```jsonc
// packages/client/package.json  (shipped)
// "description" is itself the rule: "Pure presentational: imports nothing from
// @shasn/engine." — enforced by the check-secrets grep, not by convention.
{
  "name": "@shasn/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview",
               "test": "vitest run", "test:watch": "vitest", "typecheck": "tsc --noEmit" },
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.12", "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4", "jsdom": "^25.0.1",
    "typescript": "^5.7.2", "vite": "^5.4.11", "vitest": "^2.1.8" }
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

### 2.1 What was broken, and what is fixed (verified, not assumed)

> **Status note 2026-09-30.** This section was written while the engine was mid-repair
> and read *"only three files are broken."* That is no longer the situation: **all
> thirteen rows below now compile**, `npm run typecheck` exits 0 at the workspace root,
> and `npm test --workspace @shasn/engine` reports **179 passing**. The table is kept in
> its original form because the ✅/was-broken columns are the evidence for the repair,
> and because the leftmost ten rows are still useful — they say which files were *never*
> in trouble, which is what justified leaving them alone.

I read the import graph of all 13 source files. Only **three** files were broken, and
the rest of the package was internally consistent:

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
| `reduce.ts` | ✅ clean | imports `state`, `cards`, `rules`, `powers`, `board`, `resources`, `rng` — all resolvable |
| **`index.ts`** | ✅ **FIXED** — was: broken | It re-exported `./config`, `./capital`, `./zones`, `./manifesto`, `./gerrymander`, `./apply`, none of which existed. It now re-exports all 12 live modules (`state`, `rules`, `board.generated`, `board`, `cards`, `actions`, `powers`, `resources`, `rng`, `reduce`, `setup`, `playerView`). |
| **`setup.ts`** | ✅ **FIXED** — was: broken | Was wrong in nine ways (audit B2), including no `_pendingCard` at setup — a turn-1 soft-lock — an undealt market, no `round`, and no staggered start. It now builds a legal opening state from `freshZones()` + `shuffle`, deals the market, sets the pending card, and takes per-seat `startResources` from the caller rather than inventing a split. |
| **`playerView.ts`** | ✅ **FIXED** — was: broken | The `Omit` named three fields that do not exist and omitted all eleven that do. It now declares the real `ServerOnlyKeys` union, strips structurally by `_` prefix, and **strips every player's Conspiracy hand including the viewer's own** — see §8.1 D25. |

**Outcome.** `npm run typecheck` exits 0 across the workspace and
`npm test --workspace @shasn/engine` reports **179 passing**. The mid-refactor is over:
the audit's four compile blockers (B1–B4) and both CRITICAL logic defects (R2 impure
`reduce`, R3 client-minted resources) are closed, each with a rulebook citation and a
regression test. R4 was proven unreachable by arithmetic and is now pinned by a
geometry test instead of a behaviour test; R5, R7, R9, R10, R11, R12 were ruled and
fixed; D6 remains explicitly unresolved with both readings documented.

**What the repair cost against this document's estimate.** §7.3 predicted a
~150-line surface and 1 day. The real repair was larger in test volume (179 tests, not
4) because §4.5's contract only becomes checkable once the projection is correct. The
engine files themselves are as predicted; the verification was not.

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

#### `playerView(state, viewer) → ClientState` — **as shipped**

```ts
// packages/engine/src/playerView.ts — the SHIPPED shape. Do not drift.
export type ServerOnlyKeys =
  | '_pendingCard' | '_ideologyDraw' | '_ideologyDiscard'
  | '_voterDraw' | '_voterDiscard'
  | '_conspiracyDraw' | '_conspiracyDiscard'
  | '_headlineDraw' | '_headlineDiscard' | '_seed' | '_idSeq';   // ELEVEN

export type ClientState = Omit<GameState, ServerOnlyKeys> & {
  readonly deckSizes: {
    readonly ideology: number; readonly voter: number;
    readonly conspiracy: number; readonly headline: number;
  };
  readonly awaitingAnswer: boolean;   // true iff _pendingCard !== null; no card data
};

/** Per-player fields that are private but are NOT `_`-prefixed. */
export const PRIVATE_PLAYER_KEYS = ['conspiracies'] as const;

export function playerView(state: GameState, viewer: PlayerID): ClientState;
```

Three corrections to what this section used to claim:

1. **The secret set is eleven fields, not nine and not ten.** `_idSeq` is the eleventh
   (`state.ts:268`): it is the id counter that R2 moved off module scope, and it leaks
   turn/action counts, which is the same corollary-leakage class as `_seed`. §4.2's
   table has been updated to match.
2. **`PlayerState.conspiracies` is stripped, for every viewer, including the owner.**
   This is the D25 reversal and the single most consequential line in the file. The
   shipped implementation carries an explicit comment at `playerView.ts:68-70`
   forbidding the obvious fix:

   > *Conspiracy hands are hidden from EVERYONE, including their owner. There is no
   > `(pid === viewer)` branch here on purpose: adding one is the R1 bug in a
   > plausible-looking form. Write `clone[k] = []` and rethink.*

   See §8.1 D25 for the full argument.
3. **`viewer` is typed `PlayerID`, not `PlayerID | null`.** The spectate path was
   designed with `null` (§4.3(c)) and the *server* keeps that signature —
   `viewFor(state, viewer: PlayerID | null)` — but the engine does not, so
   `broadcast.ts` passes a `NO_VIEWER = ''` constant that matches no seat, documented
   in place as a pinned decision to revisit if the engine ever branches on the viewer.
   **The property §4.3 wanted (one projection for players *and* spectators) is
   preserved** — there is still exactly one call into the engine and no spectator
   branch. What is lost is a *type-level* guarantee; the guarantee that actually
   matters is behavioural and is unchanged: `viewer` is ignored.

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
npm run typecheck --workspace @shasn/engine     # exit 0        ✅ MET
npm test  --workspace @shasn/engine             # all green    ✅ MET — 179 tests
```

Minimum test set (this section originally specified four; 179 were needed, and the
first three below are the load-bearing ones):

1. ✅ **A full game driven to `finished`** through the real `Action` union
   (`test/integration.test.ts`). This was previously *unreachable* — `setup()` could
   not build a legal state, so a full game could not be constructed at all.
2. ✅ **The secret-leak structural test** (`test/playerView.test.ts`) — walks
   `allKeys(playerView(s, viewer))` for every viewer plus a spectator, and separately
   asserts the declared secret set, that no in-draw `CardID` appears, and that the seed
   never appears as a bare value. §4.5 has the second copy in `packages/server`, which
   walks the *actual broadcast function*.
3. ✅ **Determinism**: same seed + same action sequence → identical state. Two forms:
   one through the public `reduce`, one direct (an R2 regression — see below).
4. ✅ **`reduce` purity**: calling `reduce` twice on the same inputs returns equal
   results and leaves the input object byte-identical.

**The R2 regression is worth naming separately**, because it is the one that was
*architecturally* wrong rather than merely untested. Module-level `let` counters made
ids depend on how many games had been played before yours, so a replay from
`(seed, actionLog)` did **not** reproduce the game — which would have quietly broken
§3.6's entire recovery story. Ids now come from `GameState._idSeq`, and
`test/integration.test.ts` carries both the direct assertion and a comment noting that
the bug was only visible when a *second* game ran in the same process.

**What is still missing from this milestone, honestly:** nothing in the list above.
The engine's `Effect` and `Action` surfaces are complete relative to the rulebook, and
the outstanding rules questions (D6, auctions, coalitions) are tracked in PLAN.md §6
rather than in the repair.

## 3. Server design

### 3.1 boardgame.io vs. hand-rolled WebSocket — **verdict: hand-rolled `ws`** · ✅ implemented

> **Status correction, 2026-09-30.** PLAN.md §3 **no longer names boardgame.io** — it
> was corrected in the same pass that recorded this reversal, and it now carries a
> "Two deliberate reversals" section explaining why. So the paragraph below, which reads
> "PLAN.md §3 names boardgame.io and pre-authorises a swap", is describing the state
> **before** that correction. Kept because the argument is the reason, and the reason
> is what a future reader needs. The `LOUD NOTE` at the end of this section is likewise
> historical. **boardgame.io is not in `package.json`, anywhere in the repo, and never
> was installed.** `packages/server/package.json`'s own `description` field says so:
> *"Hand-rolled on `ws`; boardgame.io is deliberately not used (its history persists the
> answer key)."*

PLAN.md §3 named boardgame.io and pre-authorised a swap ("Budget ~2 extra days if we
swap"). That budget was spent at design time rather than discovered in M3, because the
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
  dependencies. No framework opinions. ✅ shipped
- **A typed message layer** in `server/src/protocol.ts` with hand-written runtime
  guards in `server/src/validate.ts` — not `@shasn/shared` (see §1.2's labelled note).
  No `zod` on the hot path — a `zod` schema per message is a real dependency and a
  per-message parse cost for a 5-player game at ~2 actions/minute. Guards are
  exhaustive narrowing. ✅ shipped: `decodeFrame`, `decodeMessage`, `decodeAction`
- **A `Room`** that owns one `GameState` and calls `reduce`. That is all. ✅ shipped
  (`room.ts`; the design called it `MatchRunner` and PLAN.md still does)
- **`node:http`** for the health endpoint and static client assets. No Express — the
  server has four HTTP routes and Express would be a transitive-dependency
  supply-chain surface for a blind-answer game.

Estimated ~700 lines for lobby + runner + broadcast + store + reconnect. That is
comparable to the amount of boardgame.io *adapter* code you would write, and it does
not come with a phase machine, an undo log, or a prediction layer.

**The trade-off, stated plainly:** boardgame.io has a team. We re-implemented
lobby, seat management, and reconnection, and we will get them subtly wrong in ways
that take a playtest to find. Mitigation: the server's test suite asserts the
*behaviours* boardgame.io would have given us — `reconnect.test.ts` (resume after
simulated disconnect, rotated token), `secret-state.test.ts` (spectator isolation),
`e2e.test.ts` (a full match) — so a future swap to Colyseus is a swap against a
written spec, not against a vibe.

**LOUD NOTE (historical — PLAN.md has since been corrected):** this overturned
PLAN.md §3, which named boardgame.io as the multiplayer layer and budgeted two days
to leave it. Those two days were spent at design time, for a cost of about 2–3 days
of server work that PLAN.md had budgeted as 2. **Actual: the server milestone is
complete**, at roughly the budgeted cost, with 101 tests.

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

> **Corrected 2026-09-30 against `server/src/protocol.ts`.** The file is
> `packages/server/src/protocol.ts`, not `@shasn/shared/src/protocol.ts` (§1.2).
> Four structural deltas, all improvements or consequences, and one deletion:
>
> - **`matchId` is absent from `match:action`, `match:sync` and `match:resign`.**
>   A socket belongs to exactly one room, so carrying the id on every message was
>   redundant surface — and it was an *authorisation* surface, because a mismatch
>   between "the match you named" and "the match your seat is in" is exactly the
>   confusion a hostile client would try to create. `match:spectate` is the sole
>   exception: it names the match you want to join.
> - **`lobby:chat` was deleted.** It was the only message in the protocol that was not
>   about the game, and §3.3's own rule is "the protocol has no richer vocabulary than
>   the rules." The lobby ships `lobby:state` only.
> - **`TOO_LARGE`, `RATE_LIMITED`, `NOT_A_PLAYER` were added** to `ErrorCode`, and
>   `lobby:snapshots` collapsed into `lobby:list`. §8.3 called rate limiting "an
>   afternoon's work and belongs in M7"; the *error code* for it was needed now.
> - **`BlindPrompt` carries `order`, and `match:state` carries `blind` and `you`.**
>   PLAN.md §2's amendment A′ is implemented, not pending: `order` is a seed-derived
>   coin flip computed in `broadcast.ts` from `_seed` and the card id (never
>   `Math.random`, or replay determinism breaks), and `answerSideFor` maps the index
>   the player *pressed* back to the side of the card they *meant*. §5.3 rule 1 is
>   therefore **wrong as originally written** and has been corrected below.
>
> ⛔ **2026-10-03 — the two names in that bullet are retired, and the mechanism is not.**
> **`BlindPrompt` → `AnswerPrompt` (+ `AnswerSide`), and `match:state.blind` →
> `match:state.answer`.** The `order` draw is **unchanged and is now the only thing withheld
> at all**: `AnswerPrompt` carries the whole card — both labels, **both Ideologues, both
> payouts** — plus `order`, owed by exactly one seat. The bullet above is kept as written
> because its *reasoning* (`order` is a seed-derived draw from `_seed` and the card id, never
> `Math.random`) is still exactly right and still load-bearing; see
> `packages/server/src/FULL-INFORMATION.md` §3 and `PLAN.md` §2.

Every message is `{ t: <type> }` plus payload. `id` is a client-supplied correlation id,
echoed back in `error` messages.

#### Client → server

```ts
export type ClientMessage =
  | { readonly t: 'ping'; readonly nonce?: string }
  // ── lobby ──
  | { readonly t: 'lobby:list' }
  | { readonly t: 'lobby:create'; name: string; maxPlayers: 2|3|4|5; isPrivate: boolean }
  | { readonly t: 'lobby:join'; lobbyId: string; name: string }
  | { readonly t: 'lobby:leave' }
  | { readonly t: 'lobby:ready'; ready: boolean }
  | { readonly t: 'lobby:start' }
  | { readonly t: 'lobby:spectate'; lobbyId: string }
  // ── match ──
  | { readonly t: 'match:action'; action: Action }        // THE ONLY WRITE DOOR
  | { readonly t: 'match:sync' }                          // §3.4
  | { readonly t: 'session:resume'; resumeToken: string }  // §3.4
  | { readonly t: 'match:spectate'; matchId: string };
```

**Deliberate absence:** there is no `match:setState`, no `match:cheat`, no
`match:draw`, no admin message. The only way to change a match is
`match:action`, and its payload is exactly the engine's `Action` union. **The
protocol has no richer vocabulary than the rules.** A cheater who patches the client
can send an action the reducer rejects, and nothing else.

#### Server → client

```ts
export type ServerMessage =
  | { readonly t: 'pong'; readonly nonce: string }
  /** Issued on connect and on every successful resume. Carries the token. */
  | { readonly t: 'session:granted'; readonly session: Session }
  | { readonly t: 'session:ended'; readonly reason: string }
  | { readonly t: 'lobby:list'; readonly lobbies: readonly LobbySummary[] }
  | { readonly t: 'lobby:state'; readonly lobby: Lobby }
  /**
   * THE ONLY MESSAGE THAT CARRIES GAME STATE.
   * `state` came out of `viewFor`; `blind` out of `blindPromptFor`.
   */
  | { readonly t: 'match:state'; matchId: MatchId; viewId: number;
      state: ClientState; blind: BlindPrompt | null;
      you: { role: 'player' | 'spectator'; playerId: PlayerID | null } }
  /** Per-recipient events, in engine order. Safe to broadcast identically. */
  | { readonly t: 'match:events'; matchId: MatchId; viewId: number; events: GameEvent[] }
  /** Public, human-readable. Derived from state.log. Already redacted. */
  | { readonly t: 'match:log'; matchId: MatchId; entries: LogEntry[] }
  | { readonly t: 'match:over'; matchId: MatchId; winners: readonly PlayerID[] }
  | { readonly t: 'error'; id?: string; code: ErrorCode; message: string };

export type ErrorCode =
  | 'BAD_MESSAGE' | 'TOO_LARGE' | 'RATE_LIMITED'
  | 'NOT_IN_LOBBY' | 'NOT_HOST' | 'LOBBY_FULL' | 'LOBBY_CLOSED' | 'SEAT_TAKEN'
  | 'NOT_A_PLAYER' | 'MATCH_NOT_FOUND' | 'RESUME_INVALID'
  | 'ILLEGAL_ACTION' | 'INTERNAL';
```

**The security-relevant shape is the `BlindPrompt` type**, and it is worth reading as
an argument rather than a declaration:

```ts
export type BlindPrompt = {
  readonly question: string;
  readonly labels: readonly [string, string];
  /** 'ab' — labels[0] is side 0. 'ba' — labels[0] is side 1. */
  readonly order: 'ab' | 'ba';
};
```

No `Delta`, no `Ideologue`, no `CardID`, no `campaign`, no numeric payout field.
**There is nothing for a later refactor to accidentally bind into the DOM**, which is
the actual threat — not that someone will deliberately render a payout, but that
adding one field to a type is a much smaller act of typing than removing the whole
architecture that made it safe. §5.3's client-side type-level proof
(`client/src/answer/blindAnswer.types.ts`) is the mirror of this on the other side of
the wire, and `order` is why the assertion is a compile-time check rather than a
convention.

> ⛔ **RETIRED IN WHOLE — 2026-10-03. `BlindPrompt` does not exist, and neither does the
> argument it was making.** `packages/server/src/FULL-INFORMATION.md` §3 records the rename to
> `AnswerPrompt` + `AnswerSide` with the reason: *"a type carrying two payouts and still called
> `BlindPrompt` is a lie in a name."* The shipped shape is:
>
> ```ts
> export type AnswerSide = {
>   readonly label: string;
>   readonly ideologue: Ideology;
>   readonly pays: Delta;              // ← now public, to every seat, by decision
> };
> export type AnswerPrompt = {
>   readonly question: string;
>   readonly sides: readonly [AnswerSide, AnswerSide];   // already in DISPLAY order
>   readonly order: 'ab' | 'ba';       // ← the guarantee now lives HERE, and only here
> };
> ```
>
> **The threat the paragraph above identifies is real and has not gone away — the control
> moved.** *"There is nothing for a later refactor to accidentally bind into the DOM"* was
> never quite true once the type held a `Delta`; it is now plainly false, because the DOM is
> **supposed** to hold it. The property that is actually defended now is **narrower and
> sharper**: the two sides must render identically, and no `order` key may reach the client at
> any depth. That is enforced positively — `getComputedStyle` equality over both cells on a
> fixture whose sides carry *different* Ideologues and *different* payouts, a DOM-level check
> that no `data-ideologue` / `data-pays` / `order` attribute exists, and
> `PublishedOpenQuestion` **refusing** a payload carrying `order`.
>
> **And the client-side type-level proof is gone with it**, by the same logic — a proof that
> the payout cannot reach the DOM is a proof that the product is not supposed to ship.
> `answer/blindAnswer.test.tsx` now asserts the *positive* version: the whole card is on
> screen, and the `order` draw is not. The seven "no payout in the DOM" assertions were
> **inverted, not deleted**, and the inversion is listed row by row at
> `FULL-INFORMATION.md` §3.

`Session` is the reconnect credential and the thing a client stores in
`sessionStorage`:

```ts
export type Session = {
  readonly sessionId: string;
  readonly resumeToken: string;  // 256-bit, single-use-until-rotated
  readonly playerId: PlayerID;   // opaque server-assigned, never the player's name
  readonly matchId: MatchId | null;
  readonly lobbyId: LobbyId | null;
  readonly role: 'player' | 'spectator';
  readonly name: string;
};
```

**Note `playerId` is opaque and server-assigned.** A player id that is a username, a
seat index, or anything client-constructible is a seat-takeover vulnerability. Seats
are addressed by an unguessable id (`newId('p')`, 12 random bytes), and the *name* is
presentation only. `newToken()` / `hashToken()` in `room.ts` confirm only the hash is
persisted — the plaintext token is returned once and never stored.

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

`match:spectate` attaches a viewer who is not a seat. The server calls
`viewFor(state, null)` — **the same function**, which is what makes §4's structural
test cover spectators too. Spectators see the full public board, the event stream,
and the log. They never see any `_` field, because no spectator can.

`match:state` also carries `you: { role, playerId }`, so a client can tell a spectator
from a player **without** inferring it from the absence of a hand. That field exists
precisely because the obvious way to distinguish them — "the spectator's view has no
conspiracies" — stopped being true at the D25 reversal. **The UI must never infer
role from the shape of the state; it must read `you.role`.** A client that guessed
would be a client that renders a player's own hand as empty because the server is
being careful, and that is a bug the type system cannot catch.

**Trade-off:** spectators cannot see any Conspiracy hand — anyone's, including the
holders' own. That is now consistent with players, and it follows from D25 being
overturned. Market Voter Card *costs* are public and spectators see them all
(`MarketSlot.cost` is non-underscore, p10); the cards are face up.

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

### 3.6 Persistence — where match state lives · ✅ implemented

> **Corrected 2026-09-30.** PLAN.md §3 **no longer says "in-memory first"** — it was
> corrected in the same pass that recorded the reversal. The paragraph below is the
> argument, and it is kept because the *reason* is what matters: the two lines it
> cites did contradict each other, and a game that only persists at the end loses four
> hours on the first deploy.
>
> **The shipped reality matches the ruling.** `store.ts` implements
> `InMemoryMatchStore` — the action log is authoritative, `snapshot` is a cache, and
> `replay()` reconstructs any state from `(seed, rules, cards, log)`.
> `store-postgres.ts` implements `PostgresMatchStore` against the same
> `MatchStore` interface. `main.ts` selects between them: Postgres when
> `SHASN_DATABASE_URL` is set, in-memory otherwise.
>
> **One design point shipped differently than described.** This section specified the
> snapshot on a **write-behind queue**, "not awaited on the dispatch path — a database
> hiccup must not stall a player's answer." The shipped `InMemoryMatchStore` appends
> the log entry **synchronously** and the Postgres store awaits its write. I think the
> shipped behaviour is the better one and I would not change it back, for a reason
> this document did not anticipate: a fire-and-forget append means a process crash in
> the 50 ms between "accept the action" and "persist the action" loses a move the
> players were told was accepted. PLAN.md risk #5 is *session length*; a silently
> short match is a worse failure than a stalled one, and a stall is visible and
> retryable. **The cost accepted: a slow database does add latency to dispatch.** If
> that shows up in the playtest, the fix is a bounded queue with an explicit
> "not yet durable" state in the protocol — not a silent fire-and-forget.
>
> **What is not implemented:** the snapshot cadence. The type carries
> `snapshot?` and `snapshotAtSeq`, and `rulesVersion`/`cardsVersion` are computed
> (`rulesVersion()`, `cardsVersion()`) and `replay()` refuses a mismatch via
> `ReplayMismatch` — but nothing yet *writes* a snapshot every 10 actions. That is M7.

#### Two tiers

**Tier 1 — the action log (the real source of truth).**

```ts
// packages/server/src/store.ts — as shipped
export type StoredPlayer = { /* id, name, colour, resumeHash */ };
export type LoggedAction = { /* seq, playerId, action */ };

export type StoredMatch = {
  matchId: string;
  seed: number;              // the PRNG seed. Whole game in one integer.
  rulesVersion: string;      // sha() of RULES at match creation
  cardsVersion: string;      // sha() of the deck manifest at match creation
  createdAt: number;
  players: StoredPlayer[];
  /** Append-only. The audit trail and the replay source. */
  log: LoggedAction[];
  /** Written every N actions, purely to bound replay time. */
  snapshot?: { viewId: number; state: GameState };
  snapshotAtSeq: number;
};
```

Because the engine is deterministic and seeded, **`(seed, rules, cards, actionLog)`
fully reconstructs any `GameState` at any point.** A snapshot is a *cache to bound
replay cost*, never the authority. `reduce` never reads a clock and never calls
`Math.random` — this is exactly the property that makes the log authoritative, and it
is **now actually true**: it was false until the R2 repair moved the id counters off
module scope, which is why that defect was CRITICAL rather than cosmetic.

**Tier 2 — a snapshot, every 10 actions and on every phase change.** Specified, not yet
written. Bounds worst-case replay to 10 `reduce` calls.

**Trade-off:** replay-based recovery means a `rulesVersion`/`cardsVersion` drift
between match creation and replay is a correctness bug, not a warning. The versions
are content hashes pinned at match creation, and replay refuses to run on a mismatch
rather than silently playing a different game. **This is the price of determinism
and it is a good price** — the alternative (snapshot-as-truth) silently diverges the
moment a bug is fixed mid-session.

**Storage choice for v1: a single Postgres table (JSONB `body`), one row per match,
`log` as a JSONB array with a sequence index.** Not a `matches` table plus a
`match_actions` table. ✅ shipped — `store-postgres.ts` exports a `SCHEMA` constant
and a structurally-typed `SqlDriver` interface, so it accepts `pg`, `postgres.js` or
anything else without the package taking a driver dependency. **Trade-off:** appending
to a JSONB array is a whole-row rewrite, so a 2,400-action match rewrites a growing
blob. Measured at ~1 MB/row for a long match, well inside Postgres limits, and the write
rate is ~2/minute. **Accepted for v1.** The relational split is a 30-minute change
later and is listed in §9 as a known follow-up rather than built now.

**Why not a file on disk:** Fly.io containers have ephemeral filesystems. A local
file is a cache that lies to you across deploys, which is the exact failure mode
above.

**Why not Redis as the store:** Redis would work and would be faster, but then
persistence is Redis's problem and we have not evaluated its durability config. One
store, one durability story.

**The `MatchStore` interface is the seam that made both of them cheap.** Two
implementations, one test suite: `postgres-store.test.ts` runs the *same* append,
load and replay scenarios against `PostgresMatchStore` that `e2e.test.ts` runs
against the in-memory one. That is the concrete payoff of the decision to put
persistence behind an interface rather than picking a database early — it is also why
D4 was cheap to implement rather than expensive.

### 3.7 Hosting

PLAN.md §3: Fly.io or Railway, because Vercel serverless fights stateful WebSockets.
**Agreed, unchanged.** One process, long-lived connections, and in-heap `Room`s mean
the design needs *a machine that stays up* — the moment you have two instances you
need sticky sessions and cross-instance state sync, and at five players that is a
second architecture.

**Not yet done:** no `fly.toml`, no Dockerfile, no deploy config in the repo. The
hosting decision is recorded and unexecuted, and `main.ts` currently reads
`SHASN_DATABASE_URL` and `PORT` and nothing else. This is M7 work and it is listed as
such in §7.2 rather than implied done.

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

> ### ⛔ PARTIALLY SUPERSEDED 2026-10-03 — full information. This section's *scope* shrank;
> ### its machinery did not.
>
> **The authority is `packages/server/src/FULL-INFORMATION.md`.** Read it before editing
> anything below. This block is the index; the sub-sections carry ⛔ markers at their own
> locations.
>
> **Said plainly, because the section heading above is now a narrower claim than it was.**
>
> **What is PUBLIC, by deliberate reversal:**
> - **The whole Ideology Card.** Question, both answer labels, **both Ideologues, and both
>   payouts** — to every seat and every spectator, before anyone answers. This reaches every
>   seat as `state.openQuestion` (`PublishedOpenQuestion`) and the answerer additionally as
>   the `answer` prompt. At a physical table the card is read aloud and belongs to the table
>   (`AUTHENTIC-SHASN-REFERENCE` §7.2 step 1).
> - **`manifesto` and `manifestoCards`** — unchanged, and unchanged for the same physical-
>   table reason (p13: answered cards sit face up under the mat).
>
> **What is still SECRET, and every item below is still gated by
> `scripts/check-secrets.mjs`:**
> - **`_pendingCard`'s *id*.** The card is public by **content** and secret by **id**. This
>   is the load-bearing one, and the reason is mechanical rather than sentimental:
>   `check-secrets.mjs` works by the field being `_`-prefixed and named in `SECRET_NAMES`, so
>   publishing the id would move the value onto an unprefixed field **where no gate on that
>   list covers it**. Four arguments, at `FULL-INFORMATION.md` §2.
> - **The `order` draw** — refused at both boundaries. `PublicQuestion` admits no such key at
>   any depth; `app/blindWire.ts`'s `openQuestionOf` returns `null` for a payload carrying
>   one. **This is now the entire remaining mechanic**, and it matters more than it did,
>   because the Ideologue is printed beside each answer and the deck's Ideologue-by-position
>   skew is measured at 45%.
> - **All eight draw and discard piles**, `_seed`, `_idSeq`.
> - **`PlayerState.conspiracies`, for every viewer including its owner** (D25) — unchanged,
>   and still a *rulebook* line rather than a convenience (p19: bought and **held**).
> - **`PlayerState.ideologyCards`**, a donated Ideology Card held but not yet answered.
>
> **What did NOT change, and it is the section's real subject:** the machinery. The server is
> still the only exit to the wire; `playerView` is still applied at exactly one place;
> `playerView.ts` still strips **by prefix, structurally, recursively**; `render-all.ts` is
> still `never`-checked; `check-secrets.mjs` is still wired into `typecheck`. `packages/engine`
> is untouched — `_pendingCard` keeps its name, `PRIVATE_PLAYER_KEYS` keeps
> `['conspiracies', 'ideologyCards']`, and the underscore convention keeps its meaning,
> because **the engine's job did not change; the server's publication decision did.**
>
> **The tests got stronger while the threat got narrower.** Every assertion that read *"no
> payout in the payload"* was **inverted, not deleted**: it is now *"the whole card is on
> screen, in the shape the client reads"*, over the production broadcast, plus three new
> gates — no card id for any viewer, the table's and answerer's copies byte-identical apart
> from `order`, and `order` present in exactly one of them. The `BlindPrompt` type is gone
> and so is the type-level proof, and `FULL-INFORMATION.md` §3 records each retirement with
> its replacement rather than leaving a hole.
>
> **One consequence for this document's own §4.4 and §4.5 examples:** the payload sketch
> below shows `blind: { question, labels }` and a `NO pays` footer. Both are retired. Read
> them as the pre-reversal shape, because the shape is still what you must *not* ship.

### 4.1 The threat, stated precisely

The client is fully hostile. Not "a curious user opening devtools" — a user who has
decided to win, has the game's card list in a GitHub repo, and will read every
byte the server sends them. There is exactly one secret that matters:

> **The payout of the Ideology Card currently put to player *X*.**

> ⛔ **RETIRED 2026-10-03 — and this is the exact sentence the reversal happened to kill.**
> Under full information the payout is **published to every seat and every spectator**, so it
> is no longer the secret. `FULL-INFORMATION.md` §1 says what replaced it and why the old
> withholding was protecting something already reachable: the Ideology corpus is public JSON
> in this repository, so every payout was always one lookup away, and what the withholding
> actually protected was *which* card was on the table.
>
> **The threat, restated for the design that ships:**
>
> > **Which side of the card is on the left, and which card is on the table at all** — i.e.
> > the **`order` draw** and **`_pendingCard`'s id.**
>
> Both halves are corollary leakage of each other, and both are needed: `order` alone would
> not tell you what you are looking at, and the id alone would be a lookup key into a public
> corpus. Together they are the game. Everything else below is unchanged, including the
> eleven-field scope and the asymmetry argument — a single successful leak is still
> permanent and unrecoverable for that table, because a player who learns the deck order
> cannot be made to forget it.

Everything else — deck order, `_seed`, the identity of the next card — is *corollary
leakage*: knowing the top of `_ideologyDraw` tells you the next answer's payout
before it is drawn, which is the same defect with more steps. All eleven `_` fields are
therefore in scope, not just `_pendingCard`.

A single successful leak is **permanent and unrecoverable**. A player who learns one
payout cannot be made to forget it; the match cannot be reset; the game's central
mechanic is over for that table forever. This asymmetry — cheap to maintain, fatal to
get wrong — is why this is a first-class subsystem with its own files, not a caveat.

### 4.2 Field-level classification of the 11 server-only fields

> **Corrected 2026-09-30: nine → eleven.** The two this section used to omit are
> **`_idSeq`** (the id counter that R2 moved off module scope) and
> **`_ideologyDiscard`** (an implicit half of the three discard piles, which were
> collapsed into one table row here). Both are in the shipped `ServerOnlyKeys` union
> and both are stripped.

`state.ts` marks **eleven** fields `_`-prefixed. Classified by *what breaks if it leaks*:

| Field | Contents | If leaked | Classification |
|---|---|---|---|
| `_pendingCard` | the `CardID` put to the active player | ⛔ **Reclassified 2026-10-03.** It used to read *"Reveals which card → with the public deck, the payouts. **Instant game over.**"* — the **payouts are published now**, so that inference no longer holds. What the id still reveals is **which card is on the table**, which is the last pointer to the remaining deck and the input to the `order` argument: a client that knows the id knows the card's own `sides` tuple, and therefore which display position is the Capitalists' answer. That is the whole of what is left. | **CATASTROPHIC** — re-ranked on 2026-10-03 from "leaks the payouts" to "leaks the position", and the position is still the game |
| `_ideologyDraw` | ordered remaining Ideology deck | Reveals the next N questions *and their payouts*, before the reveal. | **CATASTROPHIC** (corollary) |
| `_conspiracyDraw` | ordered Conspiracy deck | Reveals conspiracy identities; costs are public. Reveals the *top* card before purchase — and p19 allows buying **only** the top card, so this is the whole of a purchase decision. | HIGH |
| `_headlineDraw` | ordered Headline deck | Reveals pending volatility, including which penalties are queued against you. | HIGH |
| `_voterDraw` | ordered Voter deck | Reveals upcoming market contents. Low value — market cards are face-up by design. | MEDIUM |
| `_ideologyDiscard` | discard pile | The **answered** cards. `manifestoCards` is public, so little extra. | MEDIUM |
| `_voterDiscard` / `_conspiracyDiscard` / `_headlineDiscard` | discard piles | Face-up information already public. **Except**: `_conspiracyDiscard` is the pile a `draw-from-discard` card would reach into (KNOWN-GAPS G17, unshipped), so its value rises the moment that gap closes. | LOW |
| `_seed` | the PRNG cursor | **Reconstructs the entire random stream from the start.** With `setup`'s shuffle calls in a known order, an attacker who knows the deck composition can regenerate every future draw *and* every past one. **This is the highest-leverage single number in the process** — and `broadcast.ts` reads it, legitimately, to derive the answer's `order` (§3.3). That read is the single most delicate line in the server. **⚠ Higher still after 2026-10-03:** with the payout published, `_seed` no longer has to be combined with a card id to extract value — it *is* the deck. | **CATASTROPHIC** |
| `_idSeq` | monotonic counter behind every generated id | Reveals the exact number of pending choices and voter groups created so far — i.e. how far into the game the table is, and how many decisions are outstanding. Not a card secret, but it is state the client has no business holding and it is the field most likely to be added by a well-meaning contributor. | LOW (but must not ship) |

**`_seed` deserves emphasis.** It is easy to overlook because it is a number and
carries no card names. It must never appear in a payload, an error, or a log line.
Note that `rng.ts` threads the seed through `nextSeed`/`shuffle`, so the *entire*
randomness of the game is that one integer. §4.5's test catches it like any other
`_` key; it is called out here because a human skimming a payload might not.

#### 4.2.1 The eleven are not the whole set — `PlayerState.conspiracies` is the twelfth

The `_` convention is **necessary but not sufficient**, and this is the project's
proof of that, because it is a field that leaked through a test designed to catch
leaks:

| Field | Contents | If leaked | Classification |
|---|---|---|---|
| `PlayerState.conspiracies` (`state.ts:162`) | a player's **own** bought Conspiracy Cards | Turns a bluffing mechanic into a solved one. The hand is "bought and held" (p19), and the *only* rule protecting it is that you do not advertise which card you are about to play. | **HIGH** |

`conspiracies` is **not** `_`-prefixed, so a structural `_`-prefix test walks straight
past it. `PRIVATE_PLAYER_KEYS = ['conspiracies']` in `playerView.ts:60` is the
explicit list, and the leak test walks the whole graph for it. **It is stripped for
every viewer, including its owner** — see §8.1 D25 for why, which is the one place
in this document where I concluded the original decision was wrong.

### 4.3 The two sanctioned exits from server memory

There are exactly **two** code paths by which any part of `GameState` may reach a
client. Both live in `packages/server/src/broadcast.ts`.

```ts
// broadcast.ts — THE ONLY FILE THAT TOUCHES GameState AND WRITES TO A SOCKET.
// ⚠ SIGNATURE NOTE: this is the ILLUSTRATIVE version. The shipped `viewFor` passes
// `viewer ?? NO_VIEWER` because the engine types the viewer as `PlayerID` (§2.2).
const NO_VIEWER = '';

export function viewFor(state: GameState, viewer: PlayerID | null): ClientState {
  return playerView(state, viewer ?? NO_VIEWER);
}

/** The one place a card's *content* is ever written to a socket. */
export function blindPromptFor(
  state: GameState,
  cards: CardIndex,
  viewer: PlayerID,
): BlindPrompt | null {
  if (viewer !== state.activePlayer) return null;
  if (state.phase !== 'answer') return null;
  const cardId = readPendingCard(state);         // ← the ONLY sanctioned read
  if (cardId === null) return null;
  const card = cards.ideology[cardId];
  if (card === undefined) return null;
  // Deliberately: question + two answer strings + a derived order.
  // NOT ideologue. NOT pays. NOT the card id.
  const order = orderFor(state, cardId);
  const labels = order === 'ab'
    ? [card.sides[0].answer, card.sides[1].answer]
    : [card.sides[1].answer, card.sides[0].answer];
  return { question: card.question, labels, order };
}
```

> ⛔ **SUPERSEDED 2026-10-03 — the function above no longer exists, and the shape above is
> the shape you must not ship.** `blindPromptFor` is **`answerPromptFor`**, and the
> "Deliberately: … NOT ideologue. NOT pays." comment is precisely the line that was
> reversed. The shipped function returns **the whole card**: question, both `AnswerSide`s
> (each carrying `label`, `ideologue` and `pays`), plus the `order` draw — owed by exactly
> one seat, which is the only viewer-identifying branch left in it.
>
> **The shipped shape, for the reader who needs to edit this rather than read about it:**
>
> ```ts
> // broadcast.ts — the ONLY sanctioned read of the pending card's id.
> export function answerPromptFor(state, cards, viewer): AnswerPrompt | null {
>   if (viewer !== state.activePlayer) return null;   // the ONLY asymmetry left
>   if (state.phase !== 'answer') return null;
>   const cardId = readPendingCard(state);            // ← still `_pendingCard`
>   if (cardId === null) return null;
>   const card = cards.ideology[cardId];
>   if (card === undefined) return null;
>   const order = orderFor(state, cardId);            // STILL seed-derived, never Math.random
>   const sides = order === 'ab' ? card.sides : [card.sides[1], card.sides[0]];
>   return { question: card.question, sides, order };
> }
> ```
>
> **What did not change, and is the part worth noticing:**
> - It is still a **separate function from `playerView`**, and it is still the only sanctioned
>   read of the pending card's id. Decision **(a)** below still holds as an argument — with
>   the caveat that the structural test that used to *prove* it (`keys == ['labels','order',
>   'question']`) has been **inverted**, because the property it asserted no longer exists.
>   The replacement is positive: every viewer receives both whole sides.
> - `orderFor` is unchanged, and is now doing **more** work, not less. See the §4.4 note.
> - `answerSideFor` — decision **(d)** below — is unchanged and still load-bearing.
> - `match:state` still carries the prompt in the same send. ✅ still shipped, under the name
>   `answer` rather than `blind`.
>
> **One decision that had to be re-argued rather than inherited: the `manifestoCards`
> precedent does not transfer.** It is safe to publish an *answered* card by id, because its
> payout has already been paid and revealed. Full information deletes exactly that condition,
> so the precedent is silent here and cannot be borrowed. `FULL-INFORMATION.md` §2 re-argues
> the ruling from the gate instead, which is the argument the next reader will want.

**Four design decisions here, each with a trade-off** (the shipped file states all
four in its own header comment, which is why it is worth reading before editing it):

**(a) `blindPromptFor` is a separate function from `playerView`, and it is
deliberately narrow.** The alternative — a `playerView` that conditionally includes
the prompt — is the shape that actually leaks. The structural test in §4.5 walks
`playerView`'s output and would still pass, because the prompt is not a `_` key. By
keeping it separate, its output type is `BlindPrompt` = `{question, labels, order}`,
which contains no `Delta` and no `Ideologue`, and **can be asserted structurally too**:

```ts
// packages/server/test/secret-state.test.ts — not one assertion, but a
// type-level guarantee. Note `order` is in the key list: it is part of the
// contract, and dropping it would silently break the client's answer mapping.
expect(Object.keys(blindPromptFor(s, cards, me)!).sort())
  .toEqual(['labels', 'order', 'question']);
```

> ⛔ **The assertion above is retired; the separation is not.** It asserted the *absence* of
> a payout, which full information makes false. `FULL-INFORMATION.md` §3 lists every such
> test that was rewritten rather than deleted. **What replaces it, in the same file and the
> same spirit, is positive and stronger**: every viewer receives **both whole sides**, and no
> viewer's payload contains the pending card's id — plus the two new gates (table and
> answerer byte-identical apart from `order`; `order` in exactly one of them).
>
> **The reason the separation survives even though the narrow type is gone** is worth stating
> plainly, because it is the non-obvious part: `AnswerPrompt` **does** now carry a `Delta`.
> The function is still separate so that (i) it is the **one** place that reads
> `readPendingCard`, and (ii) the one branch that identifies a viewer — `viewer !==
> state.activePlayer` — is auditable in isolation. A `playerView` that conditionally appended
> a full payout-bearing card would put a viewer-conditional *content* decision inside the
> one function whose whole contract is "strip, structurally". **That is the leak shape, and it
> has not changed even though the payload has.**

**Trade-off:** a client cannot get the prompt and the state in one message, so there
are two round-trips (or one message with two fields — see below). **Mitigation:**
`match:state` carries a `blind: BlindPrompt | null` field populated by
`blindPromptFor` in the same send. One message, two independently-tested projections,
no merged code path. ✅ shipped.

**(b) `send()` serialises `viewFor(...)` directly. It never accepts a `GameState`
plus a list of fields to include.** A `send(state, pick([...]))` API is how someone
later writes `send(state, true)` and ships the whole object. The only signature
available is the safe one. **Trade-off:** a special payload (the blind prompt) needs
a second call. Accepted, and the second call is the narrow one above.
**Note:** the shipped `broadcast.ts` exports the *projections* (`viewFor`,
`blindPromptFor`, `answerSideFor`, `owesBlindPrompt`) and not a `send()` — the
serialisation happens in `ShasnServer`, which is what lets `render-all.ts` walk every
message without a socket. **That is a better factoring than this section proposed.**

**(c) `viewer` is `PlayerID | null` in both functions.** Spectators and players share
one projection, so there is no spectator-specific code to audit. ✅ preserved, via the
`NO_VIEWER` sentinel described at §2.2.

**(d) NEW — `answerSideFor` maps the pressed index to the meant side, and it lives
here rather than in the dispatch path.** The client sends a *display* position
because that is all it was shown; the reducer's `ANSWER` is written against the card's
own `sides` tuple. The translation has to happen somewhere, and it happens **in the
one file allowed to know the answer key**, because it is a secret-state question:
`return displayIndex === 0 ? (order === 'ab' ? 0 : 1) : order === 'ab' ? 1 : 0`.

This is the load-bearing consequence of PLAN.md §2's amendment A′. Without it, A′ is
not implementable; with it, the two answer buttons can be a fixed symmetric pair
(identical geometry, identical styling, no A/B affordance) while the *card* behind
them is randomly ordered — which is precisely what UI-SPEC §9 anti-pattern 1 forbids
and what makes the fixed-position attack useless.

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
                   "manifestoCards": ["ig-in2020-041", …],
                   "conspiracies": [],            /* ⚠ ALWAYS EMPTY — see below */
                   "pending": [...],
                   "powerUses": {...}, "isBot": false }
    },
    "zones": [ … 9 zones, 129 areas, each with `{id, zone, volatile, peg}` … ],
    "market": [ { "cardId": "vo-core-011", "cost": {...}, "voters": 2 } ],
    "conspiracyTopCost": 5, "conspiracyRemaining": 22,
    "headlineQueue": [...], "activeHeadline": null, "choices": [...],
    "log": [ { "turn": 13, "player": "p_…", "text": "\"…\"", "kind": "answer" } ],
    "finalRoundFrom": null
  },
  "you": { "role": "player", "playerId": "p_9c1d…" }
  /* NO _pendingCard. NO _ideologyDraw. NO _seed. NO _idSeq. NO card id.
     NO order key at any depth. NO conspiracy hand contents, for ANY player
     including the viewer.
     ⚠ 2026-10-03: the payout and the Ideologue ARE here, on purpose. The list
        above is what is still secret — read the ⛔ note below, not this sketch. */
}
```

> ### ⛔ 2026-10-03 — this sketch is the pre-reversal shape. Three things in it are wrong now,
> and one of them is wrong in the dangerous direction.
>
> | In the sketch above | Actually shipped |
> |---|---|
> | `"blind": { question, labels[2] }` | `"answer": { question, sides: [{label, ideologue, pays}, {…}], order }` — and `order` is in **exactly one** copy |
> | `"NO pays. NO ideologue for this card."` | **Both are published.** This is the reversal, and the footer line is now the most misleading sentence in the document |
> | `"blind": null` for non-answerers | Non-answerers get `"answer": null` **and a full `state.openQuestion`** with the whole card in display order |
> | — *(not in the sketch)* | **A card id appears nowhere in any viewer's payload.** That was never true of the sketch either, and it is now the load-bearing assertion |
>
> **The one thing that is easy to get backwards:** reading the retired footer and concluding
> the contract is weaker. It is not. **Three things are now asserted over the production
> broadcast that were not asserted before**, because the old assertions were about absence and
> the new ones can be about *shape*: every viewer receives both whole sides in the shape the
> client reads; **no** viewer's payload contains the pending card's id; and the table's copy
> and the answerer's copy are **byte-identical apart from `order`**, with `order` present in
> exactly one of them.
>
> **`order` is refused, not omitted, at both ends** — `PublicQuestion` admits no such key at
> any depth, and `app/blindWire.ts`'s `openQuestionOf` returns `null` for a payload carrying
> one. **And this is why it matters more than it did.** The sides arrive *already in display
> order*, so the table and the answerer are looking at one card rather than two orderings of
> it — and because the Ideologue is printed beside each answer, a client that knew `order`
> would publish the left-hand cell's faction in one line. Measured across all 76 Ideology
> Cards, **position 0 holds the Capitalists' answer in 34 (45%)**. The `order` draw is the
> only thing closing that, and it is why `orderFor` still reads `_seed`.

> ### ⚠ `conspiracies` is an empty array in this payload. That is the whole point.
>
> This example previously showed `"conspiracies": ["con-003"]` — Asha's own hand, in
> the state sent to Asha. **That was the D25 position, and it was wrong.** The field is
> still present in `ClientState` because `playerView` builds an explicit clone rather
> than deleting keys (`playerView.ts:74-76`), and an explicit empty array is better
> than an absent key: a client that reads `player.conspiracies.length` gets a truthful
> zero rather than a crash, and — more importantly — **a key that is present and
> empty cannot be confused with a key that was forgotten**, which is the failure mode
> that lets a strip quietly stop working.
>
> **The UI consequence, and it is a real design problem, not a detail:** a player
> cannot be shown their own conspiracy hand, and they must still be able to *use* it.
> This is why `conspiracyTopCost` and `conspiracyRemaining` exist as separate
> top-level fields, and why a conspiracy-hand UI has to be driven by a **server-sent
> list of card ids the player may legally play** rather than by the contents of their
> hand. That is an M6 design item and it is the direct cost of the D25 reversal;
> it is recorded here so the next person does not rediscover it as a bug.

**To every other client, the same match:**

```jsonc
{ "t": "match:state", "matchId": "m_7f3a…", "viewId": 412,
  "state": { …identical shape, INCLUDING the empty `conspiracies`…,
             "awaitingAnswer": true, "deckSizes": {…same…},
             "openQuestion": { question, sides: [ {label, ideologue, pays}, {…} ] } },
  "answer": null,                              // only the answerer gets the order draw
  "you": { "role": "player", "playerId": "p_…different…" } }
```

> ⛑ **The second sketch, corrected.** `openQuestion` is the **whole card, in display order,
> for every non-answerer including spectators** — `openQuestionFor(state, cards)` takes **no
> player**, because at a physical table the card is read aloud and belongs to the table
> (`AUTHENTIC-SHASN-REFERENCE` §7.2 step 1). The only thing a non-answerer does not get is
> the `order` draw and the commit control. The `→ to the ACTIVE player` framing in the first
> sketch, and `"blind": null` as a way of saying "they see nothing", are both retired.

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

> ⛔ **One sentence of the paragraph above is retired: *"The payout of a card is not [public],
> because the next one has not been answered."*** That was true only while the *pending*
> card's payout was withheld, and it is the reasoning that `manifestoCards` was safe. **The
> reasoning no longer applies to the pending card — it is published — and it never applied to
> the answered ones, which the same paragraph says are face up.** So after 2026-10-03
> `manifestoCards` is safe for the *same* reason as before: the card it names has already been
> answered and its payout already revealed. It is no longer safe "because the next one is
> hidden", because the next one is not.
>
> **This is exactly the trap `FULL-INFORMATION.md` §2 warns about, recorded where the mistake
> would be made.** The `manifestoCards` precedent — *it is fine to publish an answered card
> by id* — reads as a general licence to publish card ids, and the only thing that ever
> licensed it was the contingent fact that an answered card's payout was already public. Full
> information removes exactly that fact for the **pending** card. **Do not extend the
> precedent.**
>
> The **trade-off** paragraph is unchanged and still accurate: an attacker learns a player's
> answer history, which is public at the table.

> **Note the asymmetry this section now deliberately holds.** `manifestoCards` is
> public because p13 says the answered cards sit face up on the mat. `conspiracies` is
> private because p19 says conspiracy cards are *bought and held*. Both are physical-
> table arguments; they point in opposite directions, and the difference is that the
> rulebook itself draws the line. **§8.1 D25 generalised "visible at a physical
> table" into a general policy. That generalisation is what was wrong — see there.**

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

> ⛔ **The middle test above is retired; the two around it are the contract now, and they are
> stronger — 2026-10-03.** *"'the blind prompt contains exactly two string fields and no
> numbers'"* asserted the absence of a payout and of `order`. Full information makes the
> first false; `order` moved rather than disappeared, so the **key list** is wrong too. It was
> **inverted, not deleted**.
>
> **What replaced it, over the production broadcast, in `test/secret-state.test.ts` LAYER 3**
> — and this is the assertion to read before touching anything here:
>
> ```ts
> // POSITIVE: every viewer receives the whole card, in the shape the client reads.
> for (const viewer of [null, ...Object.keys(s.players)]) {
>   expect(sidesOf(state, viewer)).toEqual([
>     { label: expect.any(String), ideologue: expect.any(String),
>       pays: expect.any(Object) },
>     { label: expect.any(String), ideologue: expect.any(String),
>       pays: expect.any(Object) },
>   ]);
> }
>
> // NO CARD ID, for any viewer including the answerer. ← the load-bearing one now.
> for (const viewer of [null, ...Object.keys(s.players)]) {
>   expect(JSON.stringify(stateFor(viewer))).not.toContain(pendingCardId);
> }
>
> // The table's copy and the answerer's copy are the same card …
> expect(stripOrder(openQuestion)).toEqual(stripOrder(answerPrompt));
> // … and `order` is in exactly one of them.
> expect('order' in openQuestion).toBe(false);
> expect('order' in answerPrompt).toBe(true);
> ```
>
> **Why this is a better gate than the one it replaces, and it is worth stating because the
> instinct is to think a reversal weakens the checks:** the old test could only assert that a
> field was *missing*. The new ones assert that the right **shape** is present for every
> viewer **and** that the one thing that must be absent is absent. A shape assertion fails on
> a missing field; an absence assertion fails on a leak. **The old suite had only the second
> kind. It now has both.**

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
  /** From answerPromptFor. Cleared the moment it is no longer your answer. */
  blind: BlindPrompt | null;
}
```

> ⛔ **Renamed, and the three-mutator line below needs it — 2026-10-03.** `blind:
> BlindPrompt | null` is **`answer: AnswerPrompt | null`**, and `clearBlind` is **`clearAnswer`**.
> **The behaviour is unchanged and still load-bearing**, including the comment: the prompt is
> cleared the moment it stops being *yours* to answer, which is what keeps the `order` draw
> from outliving the turn.
>
> **What is new in the store, and it is a second source of the card:** `state.openQuestion`
> (`PublishedOpenQuestion`) is an ordinary property of `ClientState` and carries the **whole
> card in display order, for every viewer including spectators**. It is read through the
> fail-closed narrow cast in `app/blindWire.ts#openQuestionOf`, which returns `null` for
> anything malformed **and for any payload carrying an `order` key**. So there are two sources
> of the card and they are byte-identical apart from `order` — asserted, not hoped for
> (`test/secret-state.test.ts` LAYER 3).

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

> ⛔ **The premise of this paragraph is retired; the rule and the trade-off stand — 2026-10-03.**
> *"A client with the full deck can compute nothing they couldn't already compute (payouts are
> per-side and only two are relevant)"* was true while the payout was withheld and is **no
> longer true at all**: every payout is published, so a client with the deck can compute
> **every** payout, past and future. That is the accepted cost and it is argued at
> `FULL-INFORMATION.md` §1 — the corpus is public JSON in this repository, so the "shipping the
> deck" would change is a distinction without a difference.
>
> **The rule is unchanged and is now the whole of this paragraph: the deck list is never sent
> in bulk.** Under full information the reason is not that it would leak value — it would not,
> the value is already out — it is that a bulk send is the shape `broadcast.ts` names as its
> own failure mode, and nothing needs it. **The trade-off is unchanged too**, and slightly
> larger: no card gallery, no "cards remaining" preview, and now also **no payout reference a
> player could consult mid-turn** — which is of no consequence, because the two payouts on the
> table are the two that matter.
>
> **One consequential upgrade.** `openQuestion` is now a second place the server places card
> text into `ClientState` (alongside `answer`), for **every** viewer. Both are per-card and
> neither is a bulk send, so §4's standard holds.

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
  `{funds:3}` and the other `{funds:2, media:1}` is 0-sum and totals-clean, and yet
  side 1 reaches `funds@3` while side 0 reaches nothing — so it buys a Capitalist power
  unlock that side 0 does not, and that power pays every turn for the rest of the game
  (p15/p28–33). **Totals miss it entirely.** And a card where side A pays 3 and side B
  pays 2, both to the *same* ideologue, straddles the power-threshold line for the same
  reason. **Totals miss both. This is the whole argument for the checker below.**

#### The dominance relation

A side **X** is *dominant* over side **Y** on card *c* if **all** of:

**D1 — Pure upgrade (no trade-off).** For every resource `r`: `X[r] ≥ Y[r]`, and
strict for at least one `r`. *There is no reason to ever pick Y.*
This is the killer and it is checked first because it is unambiguous.

**D2 — Total skew beyond tolerance.** `ΣX ≥ ΣY + 2`. Two resources of difference
at a cap of 12 is 17% of your entire pool; it decides the game. (The `+2` tolerance
band is §6.4.1.)

**D3 — Power-threshold cliff.** Let `crossings(X)` be the set of `resource@threshold`
pairs X's payout reaches, over `threshold ∈ {rules.level3, rules.level5}`. A cliff
exists iff `|crossings(X)| > |crossings(Y)|`. *Choosing X crosses more power-unlock
lines than Y does.* Worth far more than the raw resources, because an unlocked power
pays out every turn for the rest of the game.

> **Corrected 2026-09-30 to match the shipped checker** (`balance.ts:191-200, 286-310`).
> The previous text read "there exists an **ideologue** `i` present in `X.pays` with
> `ΣX[i] ≥ level3` and `ΣY[i] < level3`". That compared an *Ideologue* key against a
> *Resource* index — a type confusion — and it was the wrong *test*: per-direction it
> reports a cliff twice on a card like `{trust:3}` vs `{funds:3}`, which is perfectly
> symmetric and is one of the best cards in the game. Comparing **counts of crossings**
> is what the code does and is what the argument in §6.4.3 depends on.

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

> ⚠ **Corrected 2026-09-30 — the previous version of this example was wrong twice, and
> the error was load-bearing because it was the section's central argument.**
>
> It showed `{funds:2, trust:2}` against `{funds:4}` and claimed **D1 `PURE_UPGRADE`**,
> arguing "`funds: 4 ≥ funds: 2` strictly, `trust: 2 ≥ trust: 0`". Two defects:
>
> 1. **It mixed sides.** `trust: 2` is on the *first* side and `trust: 0` is the absence
>    of trust on the *second*. D1 compares one side's payout to the other side's
>    componentwise — `isPureUpgrade(x, y)` walks `RESOURCES` and returns `false` the
>    moment `xv < yv` (`packages/cards/src/balance.ts:157-166`). Here `trust` is `0` on
>    the dominant side and `2` on the other, so `0 < 2` and the check returns `false`.
>    **D1 does not fire, and must not.**
> 2. **A pure upgrade cannot be 0-sum, and this card is.** X ≥ Y componentwise with
>    X ≠ Y implies ΣX > ΣY, strictly. Both sides here total 4, so whatever the
>    relationship is, it is not dominance.
>
> Checked against the shipped checker, the card is in fact **totals-clean**:
> `TOTAL_SKEW` needs `|4 − 4| > BALANCE_TOLERANCE_TOTAL (1)` → **0, clear**;
> `PURE_UPGRADE` → **clear**, per above. The rewrite below keeps the card and corrects
> the verdict to the one the code actually produces — which is a *better* example than
> the one it replaces, because it demonstrates a case a totals check cannot see.

```jsonc
// ind-orig-041.json — a BAD card, and it is bad in a way totals cannot see.
{ "id": "ind-orig-041", "campaign": "Reservoir",
  "question": "A drought-hit district demands emergency tanks, and the authority will only release them if you sign…",
  "sides": [
    { "answer": "Divert the industrial supply", "ideologue": "idealist",
      "pays": { "funds": 2, "trust": 2 } },        // Σ=4
    { "answer": "Protect the factories", "ideologue": "capitalist",
      "pays": { "funds": 4 } }                     // Σ=4
  ] }
```

**The verdict the shipped checker produces: `POWER_THRESHOLD_CLIFF`, on side 1.**
`thresholdCrossings` builds, for each side, the set of `resource@threshold` pairs its
payout *reaches*, against `RULES.level3 = 3` and `RULES.level5 = 5`
(`balance.ts:191-200`). Side 1 pays `funds: 4`, which reaches **`funds@3`** — one
crossing. Side 0 pays `funds: 2, trust: 2`, neither of which reaches 3, so it has
**zero** crossings. `1 > 0`, so side 1 buys a Capitalist power unlock that side 0 does
not (`balance.ts:286-310`). Per p15/p28–33 that power then pays out **every turn for the
rest of the game**, which is worth far more than the 0-resource totals gap.

**So the totals are equal, the totals checker is silent, and the card is still a
degenerate choice** — because the *distribution* crosses an unlock line the totals
throw away. That is the whole argument for this checker, stated correctly.

> **Why D3 counts crossings rather than testing per direction.** Because the naive test
> is wrong in a way that floods false positives on exactly the cards the game is made
> of. Consider `{trust: 3}` against `{funds: 3}`: per direction, each side pays 3 of a
> resource the other pays none of, so a per-direction test reports a cliff **twice** and
> declares a card dominated that is in fact perfectly symmetric — both sides buy one
> unlock, and choosing *which* unlock is real deliberation. Counting crossings and
> comparing **sizes** fixes it: `{clout: 5}` crosses `clout@3` and `clout@5` (two) and
> beats `{trust: 4}`, which crosses only `trust@3` (one), even though neither resource
> appears on the other side. `balance.ts:168-190` carries this argument in full.
>
> **This corrected D3 definition is what ships.** The earlier text in §6.4 said
> "there exists an ideologue `i` present in `X.pays` with `ΣX[i] ≥ level3` and
> `ΣY[i] < level3`", which is neither the code nor a sound test — it compared an
> *Ideologue* index against a *Resource* index.

```jsonc
// ind-orig-042.json — a GOOD card. No check fires.
{ "id": "ind-orig-042", "campaign": "Reservoir",
  "question": "The same drought, the same authority, and this time they are filming the tanker queue…",
  "sides": [
    { "answer": "Let them film; the coverage is worth more than the water",
      "ideologue": "showstopper", "pays": { "media": 3, trust: 1 } },   // Σ=4
    { "answer": "Sign, and keep the press out of it",
      "ideologue": "supremo", "pays": { "funds": 2, "clout": 1 } }        // Σ=3
  ] }
```
Totals differ by 1 — **in band**, so `TOTAL_SKEW` is clear. Neither side is componentwise
≥ the other (`media`/`trust` on one, `funds`/`clout` on the other), so **`PURE_UPGRADE`
is clear** — checked in *both* directions, since either side may be dominant.
Crossings: side 0 reaches **`media@3`** (one); side 1 reaches none (`funds: 2 < 3`,
`clout: 1 < 3`). Equal counts are not dominance by construction, so **`POWER_THRESHOLD_CLIFF`
is clear** — this is precisely the `{trust:3}` vs `{funds:3}` shape described above, and
it is a *good* card. The ideologues differ, so `SAME_IDEOLOGUE_SKEW` is clear. **And it is
genuinely hard**: media is nearly useless until you unlock Showstopper powers, and
clout is the currency of influence. That is deliberation. The checker's job is to make
the *shape* of this card and the *shape* of the first one impossible, and to leave the
writing to the humans.


### 6.5 The schema gap — the corpus cannot express most real cards

**This section was added 2026-09-30. It is the most important thing in §6, and it
reorders the milestone plan (§7).**

**The pipeline works and the corpus ships. The schema underneath it does not fit the
game.** Those two facts are easy to hold at once and very easy to blur, so the numbers
first:

| | count | source |
|---|---:|---|
| Cards shipped | **60** | 6 deck files under `packages/cards/decks/`, 60 card ids |
| …`provenance: verbatim` | **0** | deliberate — `PLAN.md` §8. "Rules are not copyrightable; card text is." |
| …`provenance: adapted` | **15** | `in2020/ideology` 8, `et2040/conspiracy` 4, `et2040/headline` 3 |
| …`provenance: inferred` | **45** | authored here, register per `AUTHENTIC-SHASN-REFERENCE.md` §8.2 |
| Real X-cards recovered with complete official text | **50** | `AUTHENTIC-SHASN-REFERENCE.md` §4 |
| …of those, shipped as `adapted` (dropped clause named in `source`) | **7** | `KNOWN-GAPS.md` §0 |
| …of those, **not shipped at all** — nothing faithful can be written | **43** | `KNOWN-GAPS.md` §0 |

> ### ⚠ 43 of 50 — **86%** — of the real recovered cards cannot be expressed in the
> current card schema.
>
> `AUTHENTIC-SHASN-REFERENCE.md` §5.4 **predicted roughly 40%**. The true figure is
> worse than double that, and the reason is structural rather than unlucky: the exotic
> effects live in the **Headline and Conspiracy** decks, and those are the *only* two
> decks for which we have recovered real text (§2.4 records that **zero** ordinary
> question Ideology Cards were recovered in full). So the schema is being measured
> precisely where it is weakest, and the one deck it fits well is the one we have no
> evidence about.
>
> **Stated plainly, because it is easy to miss behind a green test suite: the game as
> shipped cannot express most real card effects.** `npm test --workspace @shasn/cards`
> is green — 61 tests — and it is green because the schema, the validator, and the
> corpus all agree with each other. That is not evidence the schema matches the game.

**The 24 enumerated gaps are `packages/cards/KNOWN-GAPS.md` (G0–G24).** Every entry was
found by *trying to write a real card and failing*, not by inspection, and each names the
card, quotes the clause that does not fit, and states the minimal schema change. The gap
ids are referenced from the `source` field of the affected cards in `decks/`, so
`git diff` on the corpus points back at the line that explains the compromise. **The
architect's instruction was honoured: the schema was not bent to make the gaps go away,
and the corpus is authored against `cards.ts` as it stands.** That is the right call for
evidence-gathering and the wrong call indefinitely — hence this section.

The gaps that cost the most cards (`KNOWN-GAPS.md` §0):

| gap | cards lost | what it is |
|---|---:|---|
| G9 `duration` + G22 "next turn" scope | **11** | no way to say "this turn" / "rest of game". **G9 is called the single highest-value fix in the file.** |
| G14 `when` / triggers | **6** | effects that fire *on* another event, not on resolution |
| G5 `PlayerState` restriction | **5** | **a state change, not a card change** — e.g. "you may not buy Conspiracies next turn" |
| G13 phase-changing ops | **3** | `auction`, `vote`, `pass-card` **do not belong in an `Effect[]` at all** — they change the *phase*. **`block` and `deflect` are no longer lost**: they ship as `ct-et2040-014` / `ct-et2040-015`, resolve through `RESPOND_INTERRUPT` rather than `applyEffect`, and both report **PLAYED** under `npm run playable` (G13 row: 2 played, 3 inexpressible) |
| G15 dynamic value off own state | **5** | "gain as many funds as you have media" |
| G17 deck search | **4** | look into a deck |
| G16 zone-scoped operation | **3** | |

**The cheapest first win is a one-line `gerrymander` target field.** G-something in the
G10–G13 range asks for a gerrymander that names *which* zone or *which* voters it
targets; today the op cannot carry a target at all, so the clause has to be dropped from
every card that uses it. Adding an optional target to one op is an afternoon and recovers
several cards — which makes it the right first move **not** because it is the biggest gap
but because it is the only one with a one-line fix, and the point of the first move is to
prove the schema-change loop works end to end.

**Three consequences for how this document should be read.**

1. **D14 ("ship a bounded corpus") is now a schema decision, not a writing decision.**
   The corpus is not short of *writing* — 60 cards exist. It is short of *expressive
   power*. Writing card #61 without `duration` produces a 61st card with the same
   limitation as the first 60.
2. **§6.4's balance checker cannot check what it cannot parse.** `POWER_THRESHOLD_CLIFF`
   and `PURE_UPGRADE` reason about `pays` only. Every card whose *interesting* clause is
   in the unenumerable part is balance-**invisible**: the checker passes it because it
   cannot see the effect. A corpus that grows without schema coverage grows the
   un-auditable surface faster than the audited one.
3. **This is on the milestone path as a first-class task, not a backlog item.** It is
   **M2b** in `PLAN.md` §7, sequenced after M2 and *before* M6 (Conspiracies/Headlines),
   because M6 is where the phase-changing and duration-bearing cards become load-bearing
   and the schema is what they fail against.

---

## 7. Milestone plan (M2–M5 rewritten)

### 7.1 The dependency reality — read this before scheduling anything

I read the import graph of all 13 engine source files (§2.1). The consequence is that
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

> **Status diagram, 2026-09-30 — the lanes above all ran, and this is now history.**
> The diagram is preserved because §7.1's *reasoning* is what let three lanes run in
> parallel; it is not a description of pending work. **Everything in Lane A, Lane B and
> the board (Lane C) has landed.** The critical path it predicted — **M0r → M3 → M7** —
> has run its first two thirds and both are complete. What is left is **M5's 14 compile
> errors**, **M2b schema coverage (§6.5)**, M6, and M7.

```
                ┌─────────────────────────────────────────────┐
  ENGINE REPAIR │ playerView.ts (rewrite) + index.ts + setup.ts│  ✅ DONE
  (complete)   └───────────────────────┬─────────────────────┘
                                        │ gates ONE thing — and it is now correct
      ┌─────────────────────────────────┼────────────────────────────────┐
      │                                 │                                │
LANE A│  M2 Cards            LANE B    │  M3 Server          LANE C     │  M4 Board
      │  schema, validator,  ✅ DONE    │  hub, MatchRunner,   ✅ DONE    │  ✅ DONE
      │  balance checker,    60 cards   │  broadcast.ts,       101 tests │  129 slots
      │  ⛔ 43/50 real cards  61 tests   │  store, protocol,    3-layer   │  verified
      │     UNEXPRESSIBLE   (KNOWN-    │  secret gate          gate     │
      │     → M2b, §6.5      GAPS.md)   │                        ✅       │
      └─────────────────────────────────┴────────────────────────────────┘
                                          │            │
                              M5 🔧 app/ written, 14 tsc errors, unverified
                                          ▼
                                  M6 · M2b · M7
```

**One scheduling recommendation that is not about code:** the card corpus is risk #1
in PLAN.md and it is *writing*, not engineering. It should start on day one, in
parallel with everything, and it is the milestone most likely to slip. Every lane
below is sized to leave M6/M7 with slack for it.

### 7.2 Milestone summary

> **Status column added 2026-09-30, verified against the code rather than inherited from
> the plan.** "Done" here means *verifiable* — a command exits 0 or a file exists and
> does what the milestone said. A milestone whose work is written but not compiling is
> **not** done, and is marked 🔧.

| # | Milestone | Lane | Blocked by | Size | Depends on server? | **Status (verified)** |
|---|---|---|---|---|---|---|
| **M0r** | Engine repair | — | — | ~1d | — | ✅ **DONE.** `npm run typecheck` exits 0; **179** engine tests. B1–B4 and CRITICAL R2/R3 closed. |
| **M1.5** | Legal: send the email | parallel | nothing | 0d | no | ⬜ **not started.** No `docs/licence.md` exists. |
| **M2** | Card pipeline + first corpus | A | M1.5 *email only* | 2d + writing | no | ✅ **DONE** — and **overshot**: 60 cards, 15 adapted / 45 inferred / **0 verbatim**, 61 tests. Schema + validator + balance checker all real. |
| **M2b** | **Card schema evolution** | A | M2 | **new** | no | ⬜ **NOT STARTED — and this is the new risk #1.** 43/50 (86%) real cards unexpressible. See §6.5. |
| **M3** | Server | B | M0r (`playerView.ts`) | 3d | — | ✅ **DONE.** Hand-rolled `ws`, action-log store + Postgres, lobby/join/reconnect/resume/spectators, runtime validation, 3-layer secret gate. **101** tests. boardgame.io never installed. |
| **M4** | Board SVG + a11y | C | nothing | 4d | no | 🟡 **SUBSTANTIALLY DONE.** 129 slots, 10×7 peg matrix, contour ground, roving tabindex — verified in tests. 2-player support still blocked on PLAN.md §6 row 7. |
| **M5** | Client panels | C | nothing (fixtures) | 3d | no | 🔧 **WRITTEN, NOT WORKING.** `app/` complete and wired to `net/store` + `connection`, but **14 tsc errors in `GameScreen.tsx`**; never run against a live server; no `a11y` script. §7.8. |
| **M6** | Conspiracies, headlines, interrupts | C→B | M0r (soft), **M2b** | 2d | yes | ⬜ **NOT STARTED.** D5's two turn-gate exceptions exist in the engine; nothing rendered. **No interrupt framework built** (see the open D5 note at §8.2). |
| **M7** | Hardening + release gate | all | M2–M6 | 2d | yes | ⬜ **NOT STARTED.** No `test/leak-fuzz.test.ts`, no `docs/RELEASE-CHECKLIST.md`. Snapshot cadence also unbuilt (§3.6). |

Critical path as originally predicted — **M0r → M3 → M7** — has run **M0r ✅ and M3
✅**. The nearest remaining milestone is **M5** (unblock the 14 errors), and the
highest-consequence one is **M2b** (§6.5), because M6's Conspiracy/Headline rendering is
exactly the content the schema currently cannot express.

**Re-sequencing note (2026-09-30): M2b slots in before M6.** §6.5's reason: five of the
enumerated gaps (G13) are *phase-changing ops that do not belong in an `Effect[]` at
all*, and eleven more are `duration`/scope — which is precisely the vocabulary M6's
Headline and Conspiracy screens need. Building M6 against the current schema means
building a UI for effects the engine cannot evaluate.

> **Status 2026-10-02 — G13 is two-fifths closed, and the note above now overstates it.**
> Of the five phase-changing ops, `block` and `deflect` **ship and execute**: they are
> `ct-et2040-014` and `ct-et2040-015` in the live corpus, they resolve through
> `RESPOND_INTERRUPT` (a sibling card field, not an `Effect`), and `npm run playable` in
> `packages/cards` — which drives every recovered card through the real reducer rather
> than asking whether the schema parses it — reports **both as PLAYED**, taking the corpus
> to **25 of 54** played. `auction`, `vote` and `pass-card` remain inexpressible, which is
> why the row above is now 3 and not 5: an auction needs a `PlayerState` debt field and an
> IOU, a vote needs a ballot with a re-vote rule, and a pass needs an in-flight queue plus
> something to pass the card to.
>
> Both reactive cards ship as **`adapted`, not `verbatim`**, and their dropped clauses are
> named in their own `source` fields rather than here. BLOCK drops the *discard an open
> Conspiracy or Headline Card* branch, blocking a card *stealing this card*, cleansing an
> already-active card, and the multi-turn "immediately, not midway" clause (G9).
> DEFLECT drops *"a card that affects **you**"* — its `target` is `any-card`, because the
> engine's `reachesPastActor` is an approximation over the whole effect list — and it
> redirects the **whole** resolution rather than only the partial effect that touched the
> defender, which is G20's granularity. **0 cards ship as `verbatim`**, and that count did
> not move.
>
> Nothing about the defect fixed alongside this changes M2b's priority: the remaining three
> ops are still phase-changing, and the eleven `duration`/scope cards are untouched.

### 7.3 M0r — Engine repair · ✅ COMPLETE

> **Status 2026-09-30 — done and verified.** `npm run typecheck` exits 0 at the
> workspace root; `npm test --workspace @shasn/engine` reports **179 passing**. The
> defect-by-defect disposition is at §2.1: B1–B4 (the four compile blockers) and both
> CRITICAL defects (R2 impure `reduce`, R3 client-minted resources) are closed; **R5,
> R7, R9, R10, R11, R12 were ruled on and fixed**, each with a rulebook citation and a
> regression test; **R4 was proven dead code** (every zone is exactly `2 × majority − 1`,
> so a majority tie is unreachable by construction) and is pinned by a *geometry* test
> rather than a behaviour test; **D6 is left explicitly unresolved** with both readings
> documented. The text below is the original plan, kept for the audit trail.
>
> One deviation worth recording: `reduce()` is now pure because ids come from a
> `GameState._idSeq` counter (`state.ts:268`, `reduce.ts:91-101`, `setup.ts:173`) rather
> than module-level `let` — which is what made the action log authoritative in §3.6
> rather than merely aspirational. Negative `Delta` values are rejected at **eight
> `deltaError` call sites covering seven actions** (`reduce.ts:484,752,754,796,963,1078,
> 1088,1101`), so a client can no longer mint resources. `playerView` strips **all
> eleven** `_`-prefixed fields **and every player's Conspiracy hand including the
> viewer's own**.

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

> ### 🔧 M5 STATUS — WRITTEN, NOT WORKING. Read before believing any "done" claim here.
>
> **Verified 2026-09-30.** `packages/client` **does not compile**:
> ```
> npm run typecheck --workspace @shasn/client
> # src/app/GameScreen.tsx — 14 errors.  Exit code 2.
> ```
> Every error is in one file. Nothing downstream of it has been exercised, and the
> client has **never been run against a live `packages/server` instance** — there is no
> session in which a real `match:state` was rendered by `GameScreen`.
>
> **What actually exists** (this is the part an earlier reconciliation pass got
> wrong — it recorded M5 as "not started" and "the client is not yet wired to the
> server", and both claims were false):
>
> | Piece | State |
> |---|---|
> | `app/App.tsx` | ✅ real. `useSyncExternalStore` over the net store, one connect effect, a switch on phase → `ReconnectScreen` / `LobbyScreenHarness` / `GameScreen`. |
> | `app/Lobby.tsx` | ✅ real — create/join/ready/start/spectate. |
> | `app/GameScreen.tsx` | ⚠ **the whole shell is written** — board + mat + log, `AnswerScreen`, `HeadlineDialog`, `ChoiceResolver`, `ConspiracyPicker`, `TradeComposer`, `PlacementBar`/`GerryBar`, `END TURN`, the §5.13 tab bar, the live-region sentence. **All 14 tsc errors are here.** |
> | `app/Panels.tsx`, `YourMat.tsx`, `ResourcePicker.tsx`, `ChoiceResolver.tsx`, `BoardBars.tsx`, `AnswerScreen.tsx` | ✅ real, compile clean. |
> | `app/derive.ts`, `store.ts`, `session.ts`, `blindWire.ts` | ✅ real — the `ClientState` → board/interaction projection, app-local interaction state, the singleton connection. |
> | `board/*` (M4) | ✅ done and tested — 129 slots, roving tabindex, contour ground. |
> | `answer/BlindAnswer.tsx` + `blindAnswer.types.ts` | ✅ done — the type-level proof that no payout can reach the DOM. |
> | `net/{protocol,connection,store,index}.ts` | ✅ real and tested (71 client tests total). |
>
> **So the wiring is not missing — the wiring is unverified.** `App.tsx` reads
> `net/store.ts`, `GameScreen` reads `store.state` (a `ClientState`) and dispatches
> through `session()` → `connection().dispatch(...)`. That is the intended shape from
> §5, not a stub.
>
> **Why it does not compile.** Read `GameScreen.tsx` and the errors are mostly of three
> kinds, all mechanical: type-only names re-exported at the bottom of the file
> (`export type { Resource, SeatCount as AppSeatCount, WireSeatCount }` at `:911`) with
> **no import for them in scope**; an unused-import alias (`IDLE_INTERACTION as
> UNUSED_IDLE` at `:74`); and `as never` casts standing in for real `ZoneID` narrowing
> (`:279`, `:286`). None of these are design problems, which is the good news: the
> structure is sound and the fix is a typing pass, not a rewrite.
>
> **What is still genuinely absent, and is the real M5 work:** (a) the 14 compile
> errors; (b) the `ConspiracyPicker` in `GameScreen.tsx:496-508` is a
> **`ResourcePicker` for paying a blind cost, not a hand view** — it renders no card
> and cannot show the player what they hold. That is a *direct consequence of the D25
> ruling* (§8.1.1), and the correct fix is a server-sent list of legally-playable
> conspiracy ids, which does not exist yet; (c) the two load-bearing tests quoted below
> (`renders the blind answer with zero secret-derived content`, `does not apply an
> action locally`) — the first exists in spirit as `answer/blindAnswer.test.tsx`; I
> have **not** verified the no-optimism reference-equality test exists; (d) `npm run
> a11y` is referenced by the exit criterion and **there is no `a11y` script in
> `packages/client/package.json`**, so that gate cannot currently be run at all.

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
past M7.

> **As it turned out, 2026-09-30:** M3, M4 and M0r all completed; M5 wrote its shell but
> does not compile. The prediction that "nothing in M3–M7 needs more than 40 cards" held
> in the unhelpful direction — **60 cards shipped** and the corpus is still not the
> constraint. **§6.5 is the constraint:** 43 of the 50 real recovered cards (86%) cannot
> be expressed in the schema. Writing card #61 against the current schema adds a card,
> not coverage. **Do not read a green 61-test cards suite as evidence that the corpus
> represents the game** — it is evidence that the corpus and the schema agree, which is
> a weaker and different claim.


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

> ⛔ **D6 is renamed and its reasoning survives intact — 2026-10-03.** `blindPromptFor` is
> **`answerPromptFor`**, and the cost column's `blind` field is `answer`. **The decision is
> upheld and its argument got stronger, not weaker**, which is the interesting part:
> *"a conditional `playerView` emitting card data passes that structural test and still kills
> the game"* used to mean *the payout leaks*. It now means *a viewer-conditional content
> decision is buried inside the one function whose entire contract is "strip, structurally"* —
> and the content in question is the whole card. **Two narrow projections remain each
> independently assertable**, and `playerView` remains the *only* place `_` keys are removed.
>
> **D1's disqualifier needs the same correction as `PLAN.md` §3's**, since it is the same
> sentence in two documents: *"the full answer key, in order"* was true of the payouts **only
> while the payout was withheld**. Under full information the payouts are public and what the
> ordered history actually discloses is **the remaining deck and the `order` argument's input**
> — which is still disqualifying, still the reason D1 stands, and is a smaller claim than the
> one written. See `FULL-INFORMATION.md` §6 for the 45% position skew that makes deck order
> the thing worth protecting.
| **D7** | **No optimistic UI in the client; the store is a fold over messages** | Optimistic apply + reconcile (what boardgame.io would have given us) | Rejections are frequent and real (`'voters in a Volatile Area cannot be affected'`) so rollback is janky; more importantly, a client that applies actions locally holds a copy of the game, and a client holding a copy is one refactor from holding a card. The rule survives only if it is structural — a store with no `dispatch(action)` has nothing to be optimistic *with*. | ~1 RTT before anything moves. Invisible at 2 actions/min. |
| **D8** | **No optimistic *presentation* either — animate between server facts** | CSS transition on the newly-received state | Same reason, and it keeps the rule absolute rather than negotiable. A 300ms interpolation on an already-true fact is animation, not prediction. | 300ms on every action. |
| **D9** | **One Node process, no workers** | Worker threads / a cluster | The engine is synchronous and pure — a whole turn is sub-millisecond. There is no CPU-bound work to move, and a worker adds a structured-clone boundary around the exact object whose secrets §4 is protecting. Keeps secrets in one heap with one audited exit. | Single point of failure — mitigated by the action log (a crash is a replay, not a loss) and verified in M7. No horizontal scale; designed for, not built (§3.7). |
| **D10** | **`@shasn/shared` — a 4th package for ~250 lines of types** | Client type-imports from the server / duplicate the types | The client/server contract is where a silent mismatch is catastrophic. A build error on a new `state` field is worth one package. | One more manifest, one more tsconfig, one more version to bump. |
| **D11** | **React 18.3, not 19** | React 19 | StrictMode double-rendering is a *leak detector*: any render path that computes a possible gain runs twice in dev and gets noticed. React 19's concurrency makes that signal less reliable. | Missing 19 bugfixes. |
| **D12** | **Ship raw TS from `src` (existing convention) + `tsx` on the server** | Add a build step / `tsc -b` project references | No published artefacts, no runtime consumers. `tsx` is one dev dependency in one package. | A dev dependency in the production image; the client bundles TS through Vite. Revisit if cards force a build. |
| **D13** | **One Postgres JSONB row per match** | Relational `matches` + `match_actions` | ~2 appends/min, ~1 MB at 2,400 actions. The relational split is a 30-minute change later. | Whole-row rewrite per append. Listed in §9. |
| **D14** | **Ship a bounded corpus; 60 cards ship, not 40 and not 100+** | Wait for 100+ | PLAN.md risk #1 is the corpus, and it is writing that does not parallelise. **Corrected 2026-09-30:** the plan said "ship with 40"; the corpus that actually landed is **60 cards across 3 decks** (15 `adapted`, 45 `inferred`, 0 verbatim). The threshold argument is unchanged — 60 is a complete, playable game with replay value; 100 is a content track with a reviewer, not an engineering gate. | Shallower replay variety. **And the caveat that now dominates: 43 of the 50 real recovered cards (86%) cannot be expressed in the schema at all** — `KNOWN-GAPS.md`, §6.5. More cards is not the constraint; **schema coverage is.** |

> ⛔ **D14's counts are stale; its decision is not — corrected 2026-10-03.** The corpus is now
> **151 cards across 7 deck files — 0 `verbatim`, 41 `adapted`, 110 `inferred`** — of which
> **76 are Ideology Cards**, the deck players see every turn. **The threshold argument is
> untouched and this row is not being reopened:** a bounded corpus is still a complete,
> playable game; 100+ was always a content track rather than an engineering gate.
>
> **What has changed is which caveat dominates, and it is now two of them:**
> 1. **Schema coverage** — unchanged and still true. `KNOWN-GAPS.md` §2 and
>    `packages/cards/KNOWN-GAPS.md` remain the handoff for M2b.
> 2. **⚠ Dominance — new, and outranking the first for the Ideology deck.** Under full
>    information a one-resource edge between a card's two sides is **visible to every player at
>    the table** and the player is expected to act on it. One dominated card exists today
>    (`ig-in2020-006`); `PLAN.md` §9 risk #2 carries the entry. **The cost column above gains
>    one more line:** the balance checker's severities were tuned for a game where a skew was
>    invisible, and they have not been re-tuned.
>
> **And the number this row cannot supply, recorded so it is not lost:** for the 76 Ideology
> Cards, **10 carry a recovered question stem and 66 are authored outright.** The deck is
> substantially original because **zero real Ideology Cards were ever recovered**
> (`AUTHENTIC-SHASN-REFERENCE` §2.4 names the three sources that would close that). D14's
> "bounded corpus" is bounded partly by the recovery failing, not by choice alone.
| **D15** | **Original decks; licence question asked, not awaited** | Write licensed decks now, or block on the email | Nothing in the engine or the pipeline depends on the licence. Path 2 keeps both branches open at zero cost. | No real campaign names. CI greps for Memesys/Zain Memon tokens. |
| **D16** | **Balance checker: `PURE_UPGRADE` and `POWER_THRESHOLD_CLIFF` are CI *errors*; `TOTAL_SKEW` is a warning** | Totals-only checking | A **0-sum** card can still be degenerate, because the *distribution* crosses a power-unlock line the totals discard: `{funds:2, trust:2}` vs `{funds:4}` totals 4–4 and is totals-clean, yet side 1 reaches `funds@3` while side 0 reaches nothing, so side 1 buys a Capitalist unlock worth a power per turn forever. A totals checker cannot see it. **Corrected 2026-09-30** — this row previously used the same pair as a `PURE_UPGRADE` example, which is not what it is (see §6.4.3). | The corpus will not be `--strict` clean until human-reviewed. |
| **D17** | **±1 total resource tolerance band** | Zero-tolerance | One resource is 8% of a 12 cap, ~30 resources pass through in a game, and it cannot be decisive. Two is 17% and decides redraw affordability at the margin — which is where Shasn is played. | Some fine cards get flagged and argued about. The argument is the design review. |
| **D18** | **Resident `viewId` per match; events buffered until state lands** | Merge state+events in one message | A full 129-area state is ~40–80 KB; at 5 players × 2 actions/min × 4 h that is ~150 MB per match. | ~20 lines of client ordering logic. |
| **D19** | **Full state on every phase change, not per-area diffs** | Diffing (JSON Patch) | A diff of a state containing nine deck arrays is itself a leak vector, and it is a second thing to get right. Phase changes are ~2/turn and are exactly when a full state is most useful. | A few more full states. Irrelevant at this scale. |
| **D20** | **Roving tabindex on the board (one tab stop for 129 slots)** | Every slot `tabIndex=0` | 129 tab stops means a keyboard user can never reach the rest of the UI. One stop + arrow keys is the standard composite-widget pattern. | Arrow-key movement is custom and is real code in §5.7. |
| **D21** | **`resumeToken` in `sessionStorage`, rotated on every use** | A `matchID` as the reconnect credential; cookies; `localStorage` | A `matchID` is not a credential — it is guessable and takes your seat. Rotation makes a leaked token single-use. `sessionStorage` is per-tab and does not leak on a shared machine. Cookies attach to cross-site requests. | A tab crash loses the session; a closed-and-reopened tab needs a re-join. Correct for a game. |
| **D22** | **24h seat-reclaim grace window** | 1h / never | 4–6 hour sessions are the case the feature exists for. Beyond it, a vote-to-kick is the fix. | An abandoned account can block a table indefinitely. |
| **D23** | **No admin/debug HTTP surface** (3 routes only) | A `/state` or admin endpoint for ops | Every extra route is a place secrets can escape. Ops uses `fly ssh console` + the replay tool against the action log, which is *better* debugging anyway. | No production introspection UI. |
| **D24** | **Events are broadcast verbatim to everyone, including spectators** | Per-recipient event redaction | Every `GameEvent` is public by construction (`answered` carries `{player, cardId, side}`, not the payout). Asserting that once, in the engine, removes an entire class of redaction bug. | The client cannot animate "you gained 2 funds" from the event — it reads its own pool from its own `ClientState`. |
| **D25** | **Conspiracy hands are private — hidden from every client, including the owner's** | "Conspiracy hands are public" (the original ruling, **OVERTURNED 2026-09-30** — see the labelled note below) | p19 (`rules-reference.md:359`) says a Conspiracy Card "may be **bought and held**, or used immediately" — *held* is the rulebook's own word, and it describes a hand you keep. `ENGINE-AUDIT.md` **R1** rates shipping it HIGH: the card is drawn, paid for, and kept precisely so its contents are unknown. The physical-table argument was a category error — see the note. | **Load-bearing.** A player cannot be shown their own hand, so the conspiracy UI must be driven by a server-sent list of *legally playable* card ids (§4.4), not by the hand. That is real design work, and it is the price. |

### 8.1.1 ⚠ LABELLED NOTE — D25 is OVERTURNED. Conspiracy hands are NOT public

**Ruling, 2026-09-30. I am overruling my own earlier decision, and saying so here
rather than editing it away, because a silent reversal of a security contract is
indistinguishable from never having decided it.**

**What D25 originally said.** Conspiracy hands are public. A conspiracy in hand is
visible to opponents at a physical table; hiding it makes the digital game *less*
informative than the physical one; and "the bluffing lives in the *answer*, not the
hand", so the hand carries no strategic secret worth protecting.

**What the code ships.** `playerView` strips **every** player's `conspiracies`,
**including the viewer's own** (`packages/engine/src/playerView.ts:60,68-79`). There
is deliberately no `pid === viewer` branch; the comment in the file says why, and
`PRIVATE_PLAYER_KEYS = ['conspiracies']` is walked by the leak test. The engine is
right and D25 was wrong. The row above is now the corrected ruling.

**Why the physical-table argument does not survive translation.** This is the core of
the correction, so it is worth stating precisely rather than dismissing. The argument
was: *at a real table the card face is visible, therefore hiding it is not hiding
anything*. That inference depends on a property of the physical medium — the client
state is **something you glance at across a table, from outside the game** — and that
property does not hold for a digital client. A digital client state is a
**machine-readable payload**. "The opponent can see it" and "the opponent's client
process holds it, along with the whole ordered deck of every conspiracy in the match"
are different claims with different consequences, and only the first is what a
physical table does. In physical Shasn, looking at an opponent's hand costs you your
turn and their notice. In the version D25 described, it costs one `curl` of a WebSocket
frame, forever, and is invisible. A security contract has to be argued in the medium
it will be enforced in, and D25 was argued in the wrong one.

**The rulebook sides against D25, and this is what settles it.** p19
(`rules-reference.md:359`): *"May be **bought and held**, or used immediately."*
**Held** is the rulebook's own word, and it names a private possession. Contrast the
Ideology/manifesto line D25's argument actually fits: answered cards "sit face up"
at the table (`rules-reference.md`, §11/`manifesto` notes), so `manifesto` **is**
public, and the code ships it public. **Both decisions are physical-table arguments,
and they point in opposite directions** — which is the tell. D25 generalised "visible
at a physical table" into a general policy. The generalisation is what failed: the
rulebook itself draws the line, and D25 erased it in the direction that leaks.

**The audit's R1 finding, which is independent of my own reasoning.**
`docs/ENGINE-AUDIT.md` **R1** rates the leak HIGH and names the same defect class as
the blind-answer leak: shipping every opponent's hand to every client is "the same
class of defect as the blind-answer leak the module's own docstring calls *the single
most important function in this package*" — with the sting that `playerView`'s test
**only inspected `_`-prefixed fields**, so the leak would have passed its own test.
That is why `PRIVATE_PLAYER_KEYS` exists and why the leak test walks the whole graph
for unprefixed private keys too. Two agents reached the same conclusion from different
directions before any of them wrote code, which is the strongest evidence available
that this was the correct call rather than a preference.

**This decision is load-bearing for the game's central mechanic, and I want that
stated plainly.** Shasn's premise is that you act on information you do not have. A
Conspiracy Card is bought top-of-pile (`rules-reference.md:354`) and *kept*; a player
who knows their own hand knows what the next opponent is likely to be holding. Once a
client holds its hand, "you may play this card" becomes a client-side decision the
player can simply override — the client already has the bytes. That is the same
failure as shipping the answer payout, one layer out, and it is why this cannot be
deferred to "a UI problem later": **the moment the payload contains the hand, the
mechanic is gone, and no amount of rendering discipline gets it back.**

**The real cost, stated honestly.** A player cannot be shown their own conspiracy
hand, and must still be able to *use* it. That is a genuine design problem. The
mitigation shipped alongside the ruling: `conspiracyTopCost` and
`conspiracyRemaining` are top-level fields, and a conspiracy UI must be driven by a
**server-sent list of the card ids a player may legally play** rather than by the
contents of the hand. That work is **not done** — see §7.8. Recorded here so the next
person inherits a decision, not a mystery.

**What did not change.** D25 was a secrecy decision only. The D24 position — events
broadcast verbatim, including to spectators — is unaffected, and stays.

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

**D5 (no interrupt framework) — still the decision I hold with least confidence, and
it is still OPEN.** The counter-argument is that "anything, any order, repeatable" plus
out-of-turn plays is a genuinely complex scheduling problem and a queue is the standard
answer. My answer is that the engine's `PendingChoice` list *is* that queue, already
implemented, already addressed per-player. Building a parallel one would be the thing
that breaks. The cheapest disconfirmation is a 5-player playtest, not more analysis.

> **Status: UNRESOLVED AND DELIBERATELY LEFT OPEN.** I am not closing D5, and I am not
> asserting that it is settled. PLAN.md §7 M5 records an independent disagreement with
> this decision from an agent that read the reducer directly, and that disagreement
> stands: `PendingChoice` is a channel for *decisions the engine already owes a player*,
> whereas an interrupt framework is a channel for *actions nobody owes anyone*. The gap
> shows up in exactly the cost D5 accepts — a player with no pending decision has nothing
> to be interrupted into, so `PendingChoice` cannot express it, and with no timed window
> a 5-player async table can be ambushed. **No interrupt framework has been built.** The
> engine ships D5's two turn-gate exceptions. Whether that was right is a playtest
> question and this document does not claim an answer.

**D25 (conspiracy hands private) — overturned, and the security stakes are the reason
it is called out here.** See the labelled note at §8.1.1. Unlike D5 this one is
*closed*: it was decided by the rulebook (p19, "bought and held"), by the audit's R1
finding, and by what the medium actually permits, and it is enforced in code at
`playerView.ts`.

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

