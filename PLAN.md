# Digital Shasn — Build Plan

Status: **engine ✅ · server ✅ · cards ✅ (60 shipped) · board ✅ · client 🔧 written,
does not compile · schema evolution ⬜ not started**
Owner: kushalk
Last updated: 2026-09-30

> **Reconciled against the code 2026-09-30, third pass.** The two earlier passes each
> made optimistic claims the code did not support — the second claimed "M1 DONE, 50 tests
> passing" when the engine did not compile at all. **This pass verifies every status
> below against the code or against test output, and marks unverifiable work as
> unverifiable.** Where a document and the code disagree, the code wins and the
> disagreement is written down rather than resolved silently.
>
> **Verified commands:**
> - `npm run typecheck` (root) → **exit 0**
> - `npm run typecheck --workspace @shasn/client` → **FAILS, 14 errors, all in
>   `src/app/GameScreen.tsx`**
> - `npm test` (root) → **exit 0 — 412 passing**: engine 179, server 101, cards 61,
>   client 71
>
> Reconciled 2026-09-30 against four documents that partly supersede sections below:
> `docs/ENGINE-AUDIT.md` (read-only audit of `packages/engine`), `docs/ARCHITECTURE.md`
> (server, secret-state and milestone design), `docs/AUTHENTIC-SHASN-REFERENCE.md` (fidelity
> research on the real product), `docs/UI-SPEC.md` (board and client design). Where they
> disagree with this file, the disagreement is now written down here rather than silently
> resolved.

---

## 0. SHIP LOG

A dated record of what actually landed, **with the evidence for each claim**, so the next
agent or the human can tell verified work from claims. Every row is traceable to a
command, a file, or a named document. Where something is *claimed* but *unverified*, the
row says so — that is the point of this log.

### 2026-09-30 — engine repair (M0r/M1) · ✅ VERIFIED

| # | What landed | Evidence |
|---|---|---|
| 1 | Engine compiles | `npm run typecheck` from repo root → **exit 0** |
| 2 | 179 engine tests pass | `npm test --workspace @shasn/engine` → **179 passing** |
| 3 | `index.ts` fixed — all 13 live modules re-exported | `packages/engine/src/index.ts:10-21`; the 6 dead paths are gone |
| 4 | `reduce()` is **pure** — ids from `GameState._idSeq`, not module-level `let` | `state.ts:268`, `reduce.ts:91-101`, `setup.ts:173`. **Closes CRITICAL R2**, and it is what makes the action log authoritative |
| 5 | Clients can no longer mint resources | `deltaError()` at `resources.ts:49-60`; **8 call sites across 7 actions** in `reduce.ts` (`:484,752,754,796,963,1078,1088,1101`). Rejects negative, non-integer, non-finite. **Closes CRITICAL R3** |
| 6 | `playerView` strips **all 11** `_` fields | `ServerOnlyKeys` union, `playerView.ts:23-34`; strip is by prefix, structural |
| 7 | `playerView` strips **every player's Conspiracy hand, including the viewer's own** | `playerView.ts:60,68-79`. No `pid === viewer` branch, by design. **Closes R1; settles D25 against the original ruling** (§5, `ARCHITECTURE.md` §8.1.1) |
| 8 | `setup()` builds a legal opening state | Turn-1 soft-lock gone; market dealt, `round` set, staggered start implemented. **Closes B2** |
| 9 | R5, R7, R9, R10, R11, R12 ruled and fixed | Each with a rulebook citation and a regression test, per `ARCHITECTURE.md` §2.1 |
| 10 | **R4 proven dead code, not fixed** | Every zone is exactly `2 × majority − 1`, so a majority tie is unreachable. Pinned by a **geometry** test — a stronger guarantee than a behaviour test |
| 11 | **D6 left explicitly unresolved** | Both readings documented, nothing guessed (`rules-reference.md` §18, `PLAN.md` §6 row 8) |

### 2026-09-30 — server (M3) · ✅ VERIFIED

| # | What landed | Evidence |
|---|---|---|
| 12 | Hand-rolled `ws` server; **boardgame.io never installed** | `packages/server/src/`; absent from every `package.json` in the repo |
| 13 | Action-log-authoritative store, **two** implementations | `store.ts` (`InMemoryMatchStore`, log is truth + `replay()`), `store-postgres.ts` (`PostgresMatchStore`); `main.ts` selects on `SHASN_DATABASE_URL` |
| 14 | Lobby / join / reconnect / resume / spectators | `lobby.ts`, `session.ts`, `room.ts` |
| 15 | Runtime message validation | `validate.ts` (`decode*`) |
| 16 | **Three-layer secret-state gate** | (a) `playerView` applied at exactly one place, `broadcast.ts`; (b) `test/render-all.ts` — `never`-checked, renders every projection; (c) `scripts/check-secrets.mjs` CI grep, wired into `typecheck` so running only tests cannot skip it |
| 17 | 101 server tests pass | `npm test --workspace @shasn/server` → **101 passing** |
| 18 | Seeded per-card answer ordering (`order: 'ab'\|'ba'`) | Computed in `broadcast.ts` from `_seed`, **never `Math.random`** — replay determinism holds |

### 2026-09-30 — cards (M2) · ✅ VERIFIED, with a caveat that outranks it

| # | What landed | Evidence |
|---|---|---|
| 19 | **60 cards** across 3 decks | 60 card ids in 6 deck files: `core/voter` 12, `et2040` 8+8+8, `in2020` 12+6+6 |
| 20 | Provenance **0 verbatim / 15 adapted / 45 inferred** | Counted off `"provenance"` in the deck files. **Zero verbatim is deliberate**, not an oversight (§8 legal) |
| 21 | Schema + validator + balance checker | `schema/card.schema.json`, `src/{schema,validate,balance,effect-ops}.ts`, `BALANCE_TOLERANCE_TOTAL = 1`. **61 tests** |
| 22 | ⛔ **43 of the 50 real recovered cards (86%) cannot be expressed** | `packages/cards/KNOWN-GAPS.md` §0; 24 gaps G0–G24. Predicted 40% — the true figure is worse than double. **This is why "M2 done" is not "corpus fine". M2b.** |

### 2026-09-30 — board (M4) · 🟡 VERIFIED IN PART

| # | What landed | Evidence |
|---|---|---|
| 23 | SVG board, 9 zones, **129** real hit targets, 1000×1500 viewBox | `board/BoardSvg.tsx` + one `VoterSlot` per `AreaSpec`; slot count asserted in tests |
| 24 | **Contour-map ground**, unfilled zone interiors | `contours.ts` — concentric rings clipped to `COASTLINE`. The generator made a coastline; the real board is a contour texture |
| 25 | Peg legend as a **10 × 7 matrix** | `board/pegMatrix.ts` |
| 26 | Roving tabindex — one tab stop for 129 slots | D20; keyboard model in `board/` |
| 27 | `BlindAnswer` with a **type-level proof** no payout can reach the DOM | `answer/blindAnswer.types.ts` + `blindAnswer.test.tsx` |
| 28 | 2-player support | ⛔ **not done** — blocked on §6 row 7, unresolved |

### 2026-09-30 — client shell (M5) · 🔧 WRITTEN, **NOT WORKING**

| # | What landed | Evidence |
|---|---|---|
| 29 | `app/` written in full | `App.tsx`, `Lobby.tsx`, `GameScreen.tsx`, `AnswerScreen.tsx`, `Panels.tsx`, `YourMat.tsx`, `ResourcePicker.tsx`, `ChoiceResolver.tsx`, `BoardBars.tsx`, `derive.ts`, `store.ts`, `session.ts`, `blindWire.ts` |
| 30 | Wired to the server — **not a stub** | `App.tsx` → `net/store.ts` → `session.ts` → `connection.ts`. `GameScreen` reads `store.state` (a `ClientState`) and dispatches through `connection().dispatch(...)` |
| 31 | ⛔ **Does not compile** | `npm run typecheck --workspace @shasn/client` → **14 errors, all in `src/app/GameScreen.tsx`**. A separate agent is fixing this in parallel |
| 32 | ⛔ **Never run against a live server** | No session exists in which `GameScreen` rendered a real `match:state`. **Wiring unverified, not absent** |
| 33 | 71 client tests pass | `npm test --workspace @shasn/client` → **71 passing** (board + `BlindAnswer` + transport) |

### 2026-09-30 — documentation (this pass) · ✅

| # | What landed | Evidence |
|---|---|---|
| 34 | **D25 ruled: Conspiracy hands are PRIVATE** | Overturned the original ruling. p19 (`rules-reference.md:359`) "bought and **held**"; `ENGINE-AUDIT.md` R1 rated the leak HIGH; the physical-table argument does not translate to a machine-readable payload. Full argument `ARCHITECTURE.md` §8.1.1. **Load-bearing for the central mechanic** |
| 35 | §6.4.3 worked example corrected | It compared `trust:2` against `trust:0` **across opposite sides** and called a 0-sum pair a "pure upgrade" — impossible, since X ≥ Y with X ≠ Y implies ΣX > ΣY. **Code says the card is totals-clean and fires `POWER_THRESHOLD_CLIFF`.** Corrected to the verdict the checker produces, which is a better example |
| 36 | §6.4's **D3 definition** corrected to match the code | Doc said "an *ideologue* `i` … `ΣX[i] ≥ level3`" — an Ideologue index compared against a Resource index. Code counts **threshold crossings** (`balance.ts:191-200`), because the per-direction test reports a cliff twice on `{trust:3}` vs `{funds:3}`, a perfectly symmetric card |
| 37 | This log, §7 statuses, M2b, §9 re-rank | — |

### 2026-10-02 — the projection offered a card the engine refuses · ✅ VERIFIED

| # | What landed | Evidence |
|---|---|---|
| 38 | **Fixed a real defect: the PLAY projection offered a Conspiracy Card the reducer refuses during a G13 response window** | `playableConspiraciesFor` transcribed 6 of the 7 guards `reduce` applies to `PLAY_CONSPIRACY` and missed the window check, so the client rendered a PLAY button that could only ever fail. This is the same class as the earlier "server tells the client to do something the engine refuses" fixes |
| 39 | **The rule is a blanket ban, and that is the rule rather than the easy answer** | `reduce.ts:1576-1584` places the window check FIRST — above the per-player freeze, above the turn check, above the phase check — and exempts three **action types** (`RESPOND_INTERRUPT`, `PASS_INTERRUPT`, `RESOLVE_CHOICE`), not seats and not phases. So the **actor is refused too**, and in both `actions` and `answer`. Narrowing to "the actor" or to a phase would re-introduce the bug; a test asserts the actor's own refusal by name |
| 40 | **It cannot break responding, and that is asserted rather than assumed** | Answering is `RESPOND_INTERRUPT` — a different action type the reducer exempts outright, so it never reaches the hand guard. Tests still close a window with a real BLOCK (`cards leave hand, answer logged by name, "Blocked …" logged`) and still close it by all-declines |
| 41 | The old oracle test **could not have caught this**, and the reason is recorded | `secret-state.test.ts` asks `reduce` rather than re-transcribing the rules — but walks `CONSPIRACY_CORPUS`, in which **no state ever has an open window**. Every window the driver reaches opens during `headlines`, which the *phase* guard already covered. The blind spot was the corpus, not the assertion |
| 42 | New tests build a window **during `actions`**, which is where the defect reproduced | The driver never plays a Conspiracy Card, so `resolveCard` is only reached from `ACK_HEADLINE`. The new fixture walks to a free `actions` state, deals the actor two real conspiracies and a non-actor a BLOCK, and plays one — `resolveCard` stages from `PLAY_CONSPIRACY` as readily as from `ACK_HEADLINE` |
| 43 | **Non-vacuity proven twice** | In-suite counterfactual: with `interrupt` nulled the same hands yield **12/322** non-empty seat-views; with the window open, **0/322**. Out-of-suite: with the guard commented out the suite **fails** — `2p seed 1 (actions window), phase actions, viewer p1: the projection offers a card the engine refuses: expected [ 'ct-et2040-005' ] to deeply equal []` |
| 44 | 212 server tests pass (207 before) | `npm test --workspace @shasn/server` → **212 passing**; `npm run typecheck` from root → **exit 0**, secret gate **clean** |
| 45 | **G13 reconciled: 2 of the 5 phase-changing ops shipped** | `block` / `deflect` ship as `ct-et2040-014` / `ct-et2040-015`, resolve through `RESPOND_INTERRUPT`, and `npm run playable` in `packages/cards` (which drives every recovered card through the real reducer) reports **25 of 54 played, 0 refused, 29 inexpressible**. `ARCHITECTURE.md` gaps row **5 → 3**; this checklist item marked done for `block`/`deflect` |
| 46 | Both reactive cards ship as **`adapted`**, dropped clauses named | BLOCK drops the discard-an-open-card branch, blocking a card *stealing this card*, cleansing an active card, and the multi-turn clause (G9). DEFLECT drops *"affects **you**"* (`target` is `any-card`, because `reachesPastActor` is an approximation) and redirects the **whole** resolution, not the partial effect — G20. **0 verbatim, unchanged.** `auction`, `vote`, `pass-card` remain outstanding |

**No new unverified claims from this pass.** The three remaining phase-changing ops are
still inexpressible, so M2b's priority is unchanged.

**Claims in this repository that are still NOT verified by anything.** Listed so they are
not mistaken for shipped:
- The client's server-wiring (row 32) — **no live session**
- The secret-state contract **as actually sent** — only the projections are tested; the
  human devtools check has never been done
- M6, M7, M2b, M1.5 — nothing built
- The coalition type change (§6 row 11) — deferred, now against a *tested* engine
- §6 row 7 (which board ships for 2 players) and §6 row 8 (D6) — unresolved by design

---

## 1. What we're building

A browser-playable, server-authoritative, online multiplayer implementation of the
board game **Shasn** (Zain Memon / Memesys Culture Lab, 2019).

2–5 players, real-time or async, no install. Spectators supported.

### Non-goals for v1

- Native mobile apps
- AI opponents (deferred to v2 — the engine will support them, we won't ship them)
- The *Azadi* expansion
- Voice chat

---

## 2. The constraint that drives the architecture

Shasn's core mechanic: **the player to your right reads an Ideology card aloud, and
you answer without seeing it.** You do not know which resources your answer pays
until after you've committed.

That is hidden information, and it means:

> **The client must never receive the full card object.**

Hiding payouts client-side with CSS or a collapsed component is not hiding them.
Anyone opens devtools, reads the network payload, and the central mechanic of the
game is dead.

Therefore:
- The server is authoritative. Always.
- The server sends `{ cardId, question, labelA, labelB, order }` — `order` was added
  2026-09-30, see the decision table below.
- The client sends back the *position it chose* (`"A"`/`"B"`, mapped through `order`).
- Payouts are resolved server-side and only the *result* is broadcast.

This single requirement eliminates peer-to-peer, client-side rules evaluation, and
any "just sync the state object" design.

### Blind-answer presentation — decision

| Option | Description | Verdict |
|---|---|---|
| **A. Hide payouts only** | Player reads the question text, sees two neutral answer labels, no resource icons. | **CHOSEN for v1** |
| **A′. Hide payouts + randomise the left/right order per card** | As A, and the server picks which side renders first, so "the left one" carries no information. | **CHOSEN for v1** — amendment, 2026-09-30. Supersedes a fixed order; see rationale below. |
| B. Reader-relay | Right-hand player gets the card, reads it over voice chat. | v2 toggle. Most authentic, requires everyone on mic, blocks async play. |
| C. TTS | Server speaks the question, answering player sees nothing. | Rejected. Accessibility and localization cost is not worth it. |

Model the card so B is a later flag on the same data, not a rewrite.

#### A′ — why the presentation order has to be random (amendment, 2026-09-30)

Option A on its own is **not sufficient**, and the reason is specific to Shasn rather
than to UI taste. A card's two answers belong to two *different* Ideologues, and the
India campaign is not balanced left-vs-right mechanically — in fact
`docs/AUTHENTIC-SHASN-REFERENCE.md` §2.3 observes from real tournament hands that the
answer pool is skewed toward Capitalist and Supremo, and that two of the six possible
cross-Ideology pairings are probably absent or rare. So a **fixed** "side A is always on
the left" is a channel: players who notice that Capitalist-flavoured answers cluster on
one side learn the position instead of deliberating, and the premise of the game — that
you choose blind — quietly becomes "guess the slot". That is the same class of leak as
shipping the payout, just slower.

The remedy: **randomise the two sides' presentation order per card, derived from the
engine's `_seed`**, and send `order: 'ab' | 'ba'`. It must be a seeded draw from the
engine, never `Math.random` on the server, or replay determinism breaks
(`docs/ARCHITECTURE.md` §3.6 makes the action log the source of truth precisely because
the engine is deterministic). The client renders `order[0]` in the left cell.

- **Implementation shape:** either a derived per-card field computed in the same
  projection that produces the blind prompt (`docs/ARCHITECTURE.md` §4, `blindPromptFor`),
  or a stored field on the pending-card record. Do **not** have the client decide it from
  a value it can see, or the ordering becomes client-side state that a hostile client can
  simply override — it has to come from the server's `_seed`.
- **Release gate:** a `getComputedStyle` equality assertion over the two option
  elements (`backgroundColor`, `border`, `borderRadius`, `padding`, `minHeight`, `font`,
  `color`, `textAlign`, `maxWidth`) plus a per-deck assertion that neither slot position
  correlates with Ideologue over a full shuffled deck. Spec: `docs/UI-SPEC.md` §1.2, §5.3
  assertion 2, §8.8, and anti-pattern §9.1.
- **Open dependency:** `docs/UI-SPEC.md` Appendix B **B1** asks whether the server already
  sends an ordering field. It does not — the payload at §2 above is what this amendment
  changes. B1 must close before M3 ships.

---

## 3. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Rules engine | Pure TypeScript, zero runtime deps | `apply(state, action) → state`. Deterministic. Testable in Node with no browser, no server, no network. Upheld — `docs/ARCHITECTURE.md` §8.1 D2/D3 and §3.2 both rely on it. |
| Multiplayer | **Hand-rolled WebSocket server on `ws`** — was boardgame.io, **reversed 2026-09-30** | See "Two deliberate reversals" below. `docs/ARCHITECTURE.md` §3.1, §8.1 D1. |
| Client | React 18.3 + TypeScript, **SVG** board | 9 zones of discrete peg slots is vector work. Free hit targets, CSS transitions, and real a11y labels. Canvas gives none of that. Upheld (`ARCHITECTURE.md` §5.1, §8.1 D2). |
| Shared types | **No `packages/shared` package** — protocol defined in `server/src/protocol.ts`, mirrored type-only at `client/src/net/protocol.ts` | `ARCHITECTURE.md` §1.2 argued for a 4th package. It was **never created** — the milestones needing it were scoped to `packages/server/**` and `packages/client/src/net/**` and couldn't add one. The property it was buying was obtained another way: `server/test/protocol-parity.test.ts` asserts the two copies are **mutually assignable**, so drift is a compile error. D10 is **deferred, not reversed** |
| Cards | JSON in-repo + JSON Schema | Cards are content. They belong in git, reviewable in PRs, validated in CI. Upheld (`ARCHITECTURE.md` §8.1 D3). |
| Persistence | **Postgres, action log authoritative** — was "in-memory first", **reversed 2026-09-30** | See "Two deliberate reversals" below. `ARCHITECTURE.md` §3.6, §8.1 D4. |
| Hosting | Fly.io or Railway, **single machine** | Stateful WebSockets. Vercel's serverless model fights this. Agreed and unchanged (`ARCHITECTURE.md` §3.7). |

### Two deliberate reversals (2026-09-30)

Both of these were decisions, not oversights. The reasoning lives in
`docs/ARCHITECTURE.md`; what follows is the short version, so nobody reading this file
later mistakes a reversal for an accident.

**1. boardgame.io → hand-rolled `ws` server. The disqualifier is the undo history.**
boardgame.io keeps state history and exposes rewind, and that history includes
`_ideologyDraw`, `_conspiracyDraw` and `_headlineDraw` — the complete, ordered deck
contents, which the storage adapter writes to the match row. That is **the full answer
key to every card ever dealt, in order, in the database.** It is not a missing feature
we can decline; it is a feature we would have to *actively disable* in a project whose
central mechanic is hiding the answer key, having already paid for it. Three further
reasons: it would own the phase machine that `reduce.ts` already is (two authorities,
intermittent disagreement); its client predicts, and prediction is exactly what
`ARCHITECTURE.md` §5.5 forbids; and it does not solve the hard half of risk #5 below
(durable resume, private lobbies, resume *tokens*, spectator isolation, deploys that do
not drop a live 4-hour match). Cost accepted: ~3 days of server work against PLAN.md's
budgeted 2, no lobby/reconnect for free, and a team of one maintaining it.

**2. "In-memory first" → persist from the first action.** This plan contradicted itself:
§3 said don't build persistence until a match survives a refresh, and §9 risk #5 says a
match is 4–6 hours and must survive one. A game that only persists at the end loses four
hours on the first deploy. Because the engine is deterministic and seeded,
`(seed, rules, cards, actionLog)` reconstructs any state — so a 24-hour match is a
*replay*, not a restore. Cost accepted: a `rulesVersion`/`cardsVersion` drift is a
correctness bug rather than a warning, so replay refuses to run on a mismatch.

> **Shipped, with two corrections to the plan's own wording (2026-09-30).**
>
> 1. **The action log is written *synchronously* per action, not "behind the dispatch
>    path".** The shipped `InMemoryMatchStore` appends the log entry synchronously and the
>    Postgres store awaits its write. This departs from the plan and
>    `ARCHITECTURE.md` §3.6, which specified a write-behind queue. **The shipped
>    behaviour is better and I would not change it back**, for a reason the plan did not
>    anticipate: a fire-and-forget append means a crash in the 50 ms between "accept the
>    action" and "persist the action" loses a move the players were told was accepted. A
>    silently short match is worse than a stalled one, and a stall is visible and
>    retryable. **Cost accepted: a slow database adds latency to dispatch.** If that shows
>    up in playtesting, the fix is a bounded queue with an explicit "not yet durable"
>    state in the protocol — *not* a silent fire-and-forget.
> 2. **"Snapshot every 10 actions and on every phase change" is NOT implemented.** The
>    fields exist (`snapshot?`, `snapshotAtSeq`), `rulesVersion()`/`cardsVersion()` are
>    computed, and `replay()` refuses a mismatch via `ReplayMismatch` — but nothing yet
>    *writes* a snapshot. Log-authoritative replay is correct without it, so this is a
>    performance item. **M7.**
>
> This reversal also only became *true* because R2 was fixed: with module-level `let`
> counters, `reduce` was impure and a replay would **not** have reproduced the game. The
> persistence design was sound in principle and unsound in fact until the engine repair.
> `ARCHITECTURE.md` §3.6 says this and is right to.

**What survives from the original boardgame.io risk note, and is now trivially true:**
the rules engine has zero knowledge of the transport. It is a pure reducer in its own
package, and the entire interface to it from the server is a ~60-line seam
(`MatchRunner.dispatch(playerId, action) → Result`). Swapping transports later touches
the protocol handler and the connection layer and nothing else.

---

## 4. Repo layout

```
shasn/
├── packages/
│   ├── engine/          # pure TS. no deps. the game.
│   │   ├── src/
│   │   │   ├── state.ts          # pools, manifesto, gerrymander rights, GameState
│   │   │   ├── rules.ts          # RulesConfig/RULES, player colours  (was config.ts)
│   │   │   ├── board.generated.ts# 129 areas, 11 volatile          (generated)
│   │   │   ├── board.ts          # recount, freshZones, scores
│   │   │   ├── cards.ts          # IdeologyCard / Conspiracy / Headline, sidePayout
│   │   │   ├── actions.ts        # the 16 Action variants
│   │   │   ├── powers.ts         # unlock thresholds, per-turn allowances
│   │   │   ├── resources.ts      # pool maths, overCap, trimToCap
│   │   │   ├── rng.ts            # seeded LCG, shuffle. no Math.random.
│   │   │   ├── reduce.ts         # the reducer
│   │   │   ├── setup.ts          # 2..5 players, staggered start, market
│   │   │   └── playerView.ts     # the secret-state projection
│   │   └── test/                  # 11 files, 179 tests — all green
│   ├── cards/           # JSON decks + schema + balance checker  ✅ 60 cards
│   │   ├── schema/card.schema.json
│   │   ├── decks/{core,et2040,in2020}/
│   │   ├── scripts/validate.ts
│   │   └── KNOWN-GAPS.md         # G0–G24 — 43/50 real cards unexpressible
│   ├── server/          # hand-rolled ws: MatchRunner, broadcast, store, resume  ✅
│   └── client/          # React + SVG  🔧 app/ written, does not compile
├── docs/                # ENGINE-AUDIT, ARCHITECTURE, UI-SPEC, rules-reference,
│                        # AUTHENTIC-SHASN-REFERENCE
├── PLAN.md
└── package.json         # npm workspace
```

> **Corrected 2026-09-30 against the tree.** Three deltas from the sketch above:
>
> 1. **`packages/shared/` was never created.** The milestones that needed it were scoped
>    to `packages/server/**` and `packages/client/src/net/**` and could not add a
>    package. The protocol lives in `server/src/protocol.ts` and is mirrored type-only
>    at `client/src/net/protocol.ts`, with `server/test/protocol-parity.test.ts`
>    asserting the two are **mutually assignable** — so drift is a compile error.
>    `ARCHITECTURE.md` §1.2 D10 is deferred, not reversed.
> 2. **`packages/engine/test/` is no longer empty.** It holds **11 files and 179
>    passing tests**. The barrel `index.ts` is also fixed — it re-exports all 13 live
>    modules, so the six dead paths this note used to describe (`./config`, `./capital`,
>    `./zones`, `./manifesto`, `./gerrymander`, `./apply`) are gone. Both of those
>    "still broken" claims are now historical.
> 3. **The engine module list above is accurate as written.** The original sketch was
>    behind the refactor that folded `zones.ts`, `capital.ts`, `manifesto.ts`,
>    `gerrymander.ts`, `conspiracy.ts` and `apply.ts` into the modules shown;
>    `packages/server` is the hand-rolled server from §3, not a boardgame.io adapter.

---

## 5. Data model

```ts
type Ideology = 'capitalist' | 'showstopper' | 'supremo' | 'idealist';
type Capital  = 'funds' | 'media' | 'clout' | 'trust';
//              capitalist  showstopper  supremo  idealist

type Zone = {
  id: string;
  slots: number;              // total peg slots
  majorityThreshold: number;  // pegs needed to lock — differs per zone
  pegs: (PlayerID | null)[];
  lockedBy: PlayerID | null;
  neighbours: string[];       // for gerrymander legality
};

type PlayerState = {
  capital: Record<Capital, number>;
  capitalCap: number;
  manifesto: Ideology[];      // one entry per answered card
  conspiracies: CardID[];
  unlockedPowers: PowerID[];  // derived from manifesto, cached
};

type GameState = {
  zones: Zone[];              // 9
  players: Record<PlayerID, PlayerState>;
  phase: 'answer' | 'spend' | 'gerrymander';
  activePlayer: PlayerID;

  // ── SERVER ONLY — stripped by playerView ──
  _deck: { draw: CardID[]; discard: CardID[] };
  _pending: { cardId: CardID; forPlayer: PlayerID } | null;
  _conspiracyDeck: CardID[];
};
```

**Write `playerView` before anything else and write a test that asserts every
`_`-prefixed key is absent from the client payload.** That test is the project's
most important line of defence.

> **The block above is the original sketch, and it is now behind the code.** Per
> `docs/ENGINE-AUDIT.md` §5.1, the shipped `GameState` carries **eleven** server-only
> fields, not three: `_pendingCard`, `_ideologyDraw`, `_ideologyDiscard`, `_voterDraw`,
> `_voterDiscard`, `_conspiracyDraw`, `_conspiracyDiscard`, `_headlineDraw`,
> `_headlineDiscard`, `_seed`, **`_idSeq`** — the deck count went from three to four when
> Voter Cards were split out, `_seed` was added, and `_idSeq` was added by the R2 repair
> (it is what makes `reduce` pure — see below). A leaked `_seed` plus the already-revealed
> cards reconstructs every remaining draw, so it is the one people forget. Zones are also
> not the peg records sketched above: pegs live at `areas[i].peg`, and a `Zone` is
> `{id name majority capacity neighbours areas majorityHolder}`.
>
> Two consequences for the assertion above. First, it must be **structural and
> recursive** — strip by `_` prefix and walk the whole graph — not a hand-maintained key
> list; the old `Omit<GameState, '_deck' | '_pending' | '_conspiracyDeck'>` named three
> fields that did not exist and omitted all ten that did, and still typechecked
> (`ENGINE-AUDIT` §2 B3). **Both are fixed**: `ServerOnlyKeys` now declares the real
> eleven (`playerView.ts:23-34`) and the strip is by prefix. Second, `_`-prefix is **not
> sufficient on its own**: `PlayerState.conspiracies` is a hidden hand and is not
> `_`-prefixed. **Also fixed** — see the resolution note below. Full contract:
> `docs/ARCHITECTURE.md` §4.
>
> **R2 is what made `reduce` pure.** Ids used to come from module-level `let` counters,
> which made `reduce` impure and therefore meant a replay from `(seed, actionLog)` did
> **not** reproduce the game — the property the whole persistence design rests on
> (§3, `ARCHITECTURE.md` §3.6). Ids now come from `GameState._idSeq`
> (`reduce.ts:91-101`, `state.ts:268`, seeded at `setup.ts:173`). That is why `_idSeq`
> is the eleventh server-only field.
>
> > ### ✅ RESOLVED 2026-09-30 — Conspiracy hands are PRIVATE. The code was right.
> >
> > An earlier version of this note recorded an **unresolved disagreement** between
> > `ARCHITECTURE.md` §8.1 **D25** ("conspiracy hands are **public**") and
> > `ENGINE-AUDIT.md` **R1** (they are private, rated HIGH), and said it was "flagged
> > rather than resolved" because the fix lands in `packages/engine`.
> >
> > **The fix has landed and the disagreement is closed — against D25.**
> > `playerView` strips **every** player's `conspiracies`, **including the viewer's own**
> > (`playerView.ts:60,68-79`); there is deliberately no `pid === viewer` branch.
> > `PRIVATE_PLAYER_KEYS = ['conspiracies']` is walked by the leak test, which is what
> > closes the audit's sting — that the original test only inspected `_` fields and so
> > **the leak would have passed its own test**.
> >
> > D25's physical-table argument did not survive translation to a digital client, and
> > p19 settles it: a Conspiracy Card "may be **bought and held**, or used immediately"
> > (`rules-reference.md:359`). **Load-bearing for the central mechanic** — a client
> > holding its hand can decide for itself what to play, which is the same failure as
> > shipping the answer payout, one layer out. The cost is real and is still open: the
> > conspiracy UI must be driven by a server-sent list of *legally playable* card ids,
> > and that does not exist yet.
> >
> > Full argument, including why two physical-table arguments (this one and
> > `manifesto`-is-public) point in opposite directions and the rulebook draws the line:
> > **`ARCHITECTURE.md` §8.1.1.**

### Card schema

```jsonc
{
  "id": "ind2020-041",
  "setting": "india-2020",
  "question": "A drought-hit district demands emergency water tankers…",
  "sides": [
    { "label": "Divert the industrial supply", "ideology": "idealist",
      "pays": { "trust": 2, "clout": 1 } },
    { "label": "Protect the factories",        "ideology": "capitalist",
      "pays": { "funds": 2, "clout": 1 } }
  ]
}
```

---

## 6. Open rules questions

The rulebook **has** now been extracted: `docs/rules-reference.md` (17 sections, page
citations on every rule, plus a §16 "points the rulebook does not settle"). Rows 1–6
below are therefore re-evaluated rather than carried forward. Rows 7–12 are new, surfaced
by `docs/ENGINE-AUDIT.md`, `docs/ARCHITECTURE.md` and `docs/AUTHENTIC-SHASN-REFERENCE.md`.

| # | Question | Conflict | Blocks |
|---|---|---|---|
| 1 | Manifesto power thresholds | **RESOLVED.** Sprites & Dice (bonus every 2, powers at 4 and 6) and Wikipedia (2/3/5) are both wrong. p15/p28–33: passive **+1 resource per 2 cards**, powers unlock at **3** and **5**, usable the turn they unlock. Code agrees (`rules.ts` `level3: 3`, `level5: 5`). | — |
| 2 | Exact voter costs per zone | **RESOLVED, and the question dissolves.** There is no per-zone voter cost. You pay the Voter Card's printed resource combination to the Public Reserve (p10), and there is no limit on how many cards you influence in a turn. What is still open is only the cost *distribution across our own 60 cards* — a writing task, not a rules question (`rules-reference.md` §16 #1). | — |
| 3 | Per-zone majority thresholds (all 9) | **RESOLVED.** p2/p8, and independently counted off the generated board: 6/11, 11/21, 6/11, 9/17, 5/9, 9/17, 6/11, 11/21, 6/11 — totals **69 majority / 129 areas / 11 volatile**. `board.generated.ts` matches; max achievable score is 69. | — |
| 4 | Conspiracy card list + costs | **RESOLVED as rules; the list is now real.** Cost is "any 4–5 resources, the number printed on the card back", and **only the top card of the draw pile** may be bought (p19). The list is no longer one name: **15 Conspiracy Cards recovered verbatim** from Memesys' official player-aids, plus 4 more from India (`docs/AUTHENTIC-SHASN-REFERENCE.md` §4.2). Remaining work is writing *our* deck. | M2, M6 |
| 5 | Headline card timing / resolution order | **RESOLVED.** One Headline **per voter placed in a Volatile Area that turn**, resolved at the **end of that turn**, in **the order the voters were placed** (p18/p21). The ambiguity reviewers flagged does not survive the printed text. One sub-case is still open — see row 8. | — (row 8) |
| 6 | Capital cap value | **RESOLVED, and the reading matters.** **12, total across all four resources**, not per pool. p12 says you must *choose* which excess to discard, which is only meaningful if the cap is a single number. `rules-reference.md` §16 #3 carries the argument; the code implements the total reading and the §6 wording was stale (corrected — `ENGINE-AUDIT.md` D1). | — |
| 7 | **Which board ships for 2 players** — `rules-reference.md` §14 says 2-Player Mode "requires the separate 2–3 player board" (7 zones, 14 Zone Requirements), but the Essential Edition contents list **one** "Double-Sided Game Board" and the official render is captioned **"DUAL LAYERED BOARD"**. `docs/AUTHENTIC-SHASN-REFERENCE.md` §6.1 reads that as *one sheet, two faces, 2-player variant printed on the reverse* — which would reconcile it, but nothing confirms the reverse carries the 7-zone layout or whether it supports **3** players as well as 2. | **UNRESOLVED.** Do not implement §14 until settled. The 9-zone board is unaffected and ships regardless. | M4 (2p support only) |
| 8 | **Does a voter gerrymandered *into* a Volatile Area trigger a Headline?** | **UNRESOLVED.** p18 says placing a voter in a Volatile Area triggers one and that a peg there is permanent; §10 forbids gerrymandering *out of* a volatile but permits placing in. Nothing says whether a *move* counts as a placement. The code currently treats it as one and queues a Headline. Two readings, either defensible. | Settle by re-reading p18 directly, then pin with `ENGINE-AUDIT.md` test 48. Blocks M6 |
| 9 | **Card schema cannot express most real card effects** — **this is now the project's #1 risk and it has its own milestone, M2b** | `Effect[]` cannot represent **86%** of real Conspiracy/Headline card effects: **43 of the 50** real cards recovered from Memesys' player-aids cannot be expressed at all (`packages/cards/KNOWN-GAPS.md` §0). **Far worse than the 40% originally predicted** — §5.4's estimate was made before the recovered cards were analysed against the schema, and the exotic effects live in the Headline/Conspiracy decks, which are the only two we have text for. 24 gaps are enumerated (G0–G24): `duration`/scope (11 cards), `when`/triggers (6), `PlayerState` restrictions (5 — a *state* change, not a card change), five phase-changing ops that **do not belong in an `Effect[]` at all** (5), dynamic values read off own state (5), deck search (4), zone-scoped ops (3). **Cheapest first win: a one-line `gerrymander` target field.** | ⛔ **M2b — first-class, before M6.** See §9 risk #1 and `ARCHITECTURE.md` §6.5. |
| 10 | **Auctions are a rules system with no representation** | p12/p34: bid above your cap without holding the funds, settle with an **IOU token**, and **no purchases until the bid is paid in full**. There is no `Phase` for it, no debt field, and no way for the action vocabulary to say "you owe 3". The doc never claimed it was implemented; the risk is that it is silently absent from a milestone. | Decide scope: out of v1, or add `PlayerState.debts`. Blocks M6 |
| 11 | **Coalitions cannot be represented without a breaking type change** | Official add-on (p13 of the official site): split a zone's majority in a negotiated ratio, formalised by exchanging an Ideology Card, rights to the larger partner only. `Zone.majorityHolder` is a **single** `PlayerID \| null` — structurally one player per zone. **The "decide the type change now, not after M1" window has closed and nothing was done:** M1 is complete and `Zone.majorityHolder` is still a single holder. It is now a breaking change against a *tested, working* engine rather than a free choice during repair. Not urgent — coalitions are not in v1 — but the deferral is now a decision, not an oversight. | M6+ (the type change) |
| 12 | **Zone majority ties, and end-game scoring ties** — **both now settled, in opposite ways** | The rulebook is silent on both (§16 lists six unsettled points and neither tie is among them). **R5 (`winners()` returned *every* player when all scores are 0) was ruled on and FIXED**, with a regression test. **R4 was proven dead code, not fixed:** every zone is exactly `2 × majority − 1` areas, so a majority tie is **unreachable by construction** — the `Map`-scan-order path that was the defect cannot occur. It is pinned by a **geometry test** asserting the odd capacity, which is a stronger guarantee than a behaviour test would have been. | ✅ **CLOSED.** Both pinned. |

**How the numbers now reach the engine.** The placeholder caveat below used to be the
safety net; it is mostly retired. Rows 1, 2, 3 and 6 are real extracted values, read from
a `RulesConfig` object that is now `RULES` in `packages/engine/src/rules.ts` (the original
`config.ts` was folded in during the refactor — `docs/ENGINE-AUDIT.md` §2 B2). Rows 4, 5
and 7–12 are the ones still carrying judgement calls, and each now names what it blocks.
The rulebook PDF is public on Google Drive and on BGG filepage 212891; the game itself is
**BGG id 257305** (the id 298049 given in earlier notes is wrong —
`docs/AUTHENTIC-SHASN-REFERENCE.md` §0, §13).

---

## 7. Milestones

**Sequencing authority moved on 2026-09-30.** `docs/ARCHITECTURE.md` §7 re-plans M2–M7
because the dependency reality is different from the queue below: only the *server*
milestone was blocked by the engine repair, and the single file it waited on was
`playerView.ts`. M4 (board) and M2 (cards) had **zero** engine dependencies and could run
immediately. The milestone list below is kept in this file because it is the project's own
vocabulary; where the two disagree, ARCHITECTURE.md §7 wins on sequencing and §7.2 holds
the current sizes.

> **Naming note, 2026-09-30 — this pass renumbers, deliberately.** An earlier version of
> this section called **M5 "Conspiracies + headlines"**, which collided with
> `ARCHITECTURE.md` §7, where **M5 is "Client panels"** and conspiracies/headlines is
> **M6**. Two documents using "M5" for different milestones is how a status like "M5
> done" becomes meaningless, so this file now adopts `ARCHITECTURE.md`'s numbering:
> **M5 = client shell, M6 = conspiracies/headlines/interrupts, M7 = hardening**, with
> **M2b** inserted for the schema work. The old M5 content did not vanish — it is M6.

### M0 — Scaffold · ½ day ✅ DONE
- [x] `git init`, **npm** workspace, TS config, vitest
- [x] `engine` package created
- [x] engine package with a passing test suite — ⚠ **this box was ticked in error in an
      earlier pass and then correctly unticked** (at that time `packages/engine/test/`
      contained 0 files and `vitest run` exited 1). It is **re-ticked now, for real**:
      `packages/engine/test/` holds **11 files and 179 passing tests**. Kept as a visible
      record because a box that was ticked falsely once should be re-earned visibly.
- [ ] CI lint+test (deferred — no remote yet) — ⚠ note the local substitute that *does*
      exist: `packages/server`'s `typecheck` script runs `check-secrets.mjs` after
      `tsc --noEmit`, so the secret grep cannot be skipped by running tests alone

> Changed from the original plan: **npm workspaces, not pnpm.** pnpm wasn't
> installed and npm 11 handles workspaces fine. One less global dependency.

### M1 — Rules engine · 2–3 days · ✅ DONE AND VERIFIED

> **Status reconciled 2026-09-30 against the code, not against the plan.** `npm run
> typecheck` from the repo root **exits 0**. `npm test --workspace @shasn/engine`
> reports **179 passing**. The engine compiles, the reducer is pure, the secret-state
> projection is correct, and there is a real regression suite.
>
> **Two earlier versions of this section were wrong and the correction is preserved
> above them rather than deleted:**
> - Round 1 claimed *"✅ DONE — 50 tests passing, `tsc --noEmit` clean"*. **False.**
>   Ground truth at audit time was 16 typecheck errors, `packages/engine/test/` empty,
>   `vitest run` exiting 1. That claim is withdrawn.
> - Round 2 said *"🔧 NOT DONE — repair in progress"* with an empty test suite.
>   **Also now stale.** The repair landed.
>
> **Neither claim was harmless.** The first would have let a milestone be closed on a
> package that did not compile; the second would have let a working engine be scheduled
> for repair. A milestone is DONE here only when a command exits 0.

What the repair closed, from `ENGINE-AUDIT.md` §2 and R1–R12:

| id | file | Class | Disposition |
|---|---|---|---|
| B1 | `index.ts` | 6 dead export paths + 9 of 13 real modules missing from the barrel | ✅ **fixed** — now re-exports all 13 live modules |
| B2 | `setup.ts` | **Rewrite**, not a patch: wrong in **nine** ways. Worst were behavioural — no `_pendingCard` at setup (**turn-1 soft-lock**), market never dealt, `round` never set, `staggeredStart` unimplemented | ✅ **fixed** — `setup()` now builds a legal opening state |
| B3 | `playerView.ts` | `Omit` named 3 non-existent fields and omitted all 11 real ones; plus R1 | ✅ **fixed** — real `ServerOnlyKeys` union, structural strip, **Conspiracy hands stripped from everyone including the owner** |
| B4 | `reduce.ts:901` | One type annotation. No behaviour change | ✅ fixed |
| **R2** | `reduce.ts` | **CRITICAL** — module-level `let` counters made `reduce` impure, so a replay from `(seed, actionLog)` did **not** reproduce the game | ✅ **fixed** — ids now come from `GameState._idSeq` |
| **R3** | `reduce.ts` | **CRITICAL** — no `Delta` validated non-negative, so **a client could mint resources** | ✅ **fixed** — `deltaError()` rejects negatives and non-integers at **8 call sites across 7 actions** (`reduce.ts:484,752,754,796,963,1078,1088,1101`) |
| R4 | `board.ts` | **MEDIUM** — a majority tie was decided by board-scan order | ✅ **proven dead code.** Every zone is exactly `2 × majority − 1`, so a tie is unreachable. Pinned by a **geometry test**, which is a stronger guarantee than a behaviour test |
| R5 | `board.ts` | **LOW** — `winners()` returned *every* player when all scores were 0 | ✅ **fixed**, with a regression test |
| R7, R9, R10, R11, R12 | across the package | logic bugs the compiler cannot see | ✅ **each ruled on and fixed**, each with a rulebook citation and a regression test |
| D6 | `rules-reference.md` §11 | gerrymandering a voter *into* a Volatile Area — does it trigger a Headline? | ⬜ **Left UNRESOLVED on purpose**, both readings documented (§6 row 8) |

M1 checklist:

- [x] `RulesConfig` with every open-question value as a named constant — now `RULES` in
      `src/rules.ts`
- [x] Zones: placement, majority detection, peg locking
- [x] Capital: earn, spend, cap enforcement
- [x] Manifesto: ideology accumulation → power unlocks + archetype
- [x] Gerrymander legality + execution
- [x] Win/end detection (all zones locked **or** all slots filled)
- [x] `playerView` correct — real 11-field `Omit`, structural strip, R1 closed
- [x] `setup()` produces a legal `GameState`
- [x] Structural secret-leak test — **exists**, and also walks the graph for
      unprefixed private keys via `PRIVATE_PLAYER_KEYS`
- [x] Regression suite — **179 tests, not the 135 the audit specified.** The extra 44
      are the per-defect regression tests above. `ARCHITECTURE.md` §2.1 records this as
      the repair's one cost overrun, and it bought the verification.

### M1.5 — Legal · 0 days engineering · NEW
- [ ] Send the one email to Memesys (see §8). Day one, in parallel with everything else.
      Exit criterion: sent, and a `docs/licence.md` note recording the date and the ask.

### M2 — Cards · 1 day build + the long content pole · ✅ DONE, and overshot
- [x] JSON Schema + CI validation — one `schema/card.schema.json` covering all four card
      types; kind-narrowing done at validation time in `src/schema.ts`
- [x] **60 seed cards**, not the planned 40, across **3 decks**: `core/voter.json` (12),
      `et2040/{ideology: 8, conspiracy: 8, headline: 8}`, `in2020/{ideology: 12,
      conspiracy: 6, headline: 6}`
- [x] Balance checker — `src/balance.ts`, `BALANCE_TOLERANCE_TOTAL = 1`, with
      `PURE_UPGRADE` / `POWER_THRESHOLD_CLIFF` / `EMPTY_SIDE` as **errors** and
      `TOTAL_SKEW` / `SAME_IDEOLOGUE_SKEW` / `RESOURCE_BLIND_LEAN` / `IDEOLOGUE_SKEW` as
      warnings. 61 tests.
- [x] `playerView` + the secret-leak test — claimed done in M1 and was not; **now
      genuinely done** (see M1)

**Provenance, counted off the deck files — 0 verbatim / 15 adapted / 45 inferred:**

| | count | where |
|---|---:|---|
| `verbatim` | **0** | deliberate. Rules are not copyrightable; card text is (`§8`). A verbatim deck would be the one artefact that could pull the repo down. |
| `adapted` | **15** | `in2020/ideology` 8, `et2040/conspiracy` 4, `et2040/headline` 3 — each names the dropped clause in its `source` field |
| `inferred` | **45** | authored here, register per `AUTHENTIC-SHASN-REFERENCE.md` §8.2 |

**And the thing that makes this milestone's success a trap:**

> ⛔ **60 cards ship, and the schema cannot express most real ones.** **43 of the 50**
> real cards recovered from Memesys' official player-aids (**86%**) **cannot be written
> at all** in the current schema — against a predicted 40%. 24 gaps are enumerated in
> `packages/cards/KNOWN-GAPS.md` as G0–G24. **The 61 green tests are evidence that the
> corpus and the schema agree with each other, not that the corpus represents the game.**
> This is promoted to **M2b** below.

### M2b — Card schema evolution · ⬜ NOT STARTED · **new, first-class, before M6**
- [ ] Add `duration` / scope (`this turn`, `next turn`, `rest of game`) — **G9 + G22, 11
      cards.** `KNOWN-GAPS.md` calls G9 *the single highest-value fix*.
- [ ] Add `when` / trigger clauses — **G14, 6 cards**
- [ ] Add `PlayerState.restrictions` — **G5, 5 cards.** ⚠ **This is a state change, not a
      card change** — "you may not buy Conspiracies next turn" needs a field on
      `PlayerState`, so it is an engine change and touches `playerView`'s private-key
      reasoning. Sequence it deliberately.
- [ ] Give the five phase-changing ops (`block`, `deflect`, `auction`, `vote`,
      `pass-card`) a home **outside `Effect[]`** — **G13, 3 cards outstanding.** They
      change the *phase*; no amount of `Effect` vocabulary expresses them. **`block` and
      `deflect` are DONE** — shipped as `ct-et2040-014` / `ct-et2040-015` and resolved by
      `RESPOND_INTERRUPT`, which is a sibling card field rather than an `Effect`; both
      report PLAYED under `npm run playable`, which puts the corpus at **25 of 54**.
      Still outstanding: `auction` (needs a `PlayerState` debt field and an IOU), `vote`
      (a ballot with a re-vote rule), `pass-card` (an in-flight queue plus a target).
- [ ] Support dynamic values read off own state — **G15, 5 cards**
- [ ] **First move, deliberately small: a one-line `gerrymander` target field.** Not
      because it is the biggest gap but because it is the only one with a one-line fix,
      and the point of the first move is to prove the schema-change loop works end to end
      against a live corpus.

**Why this is before M6 and not after:** M6 is Conspiracies and Headlines — precisely the
content that needs `duration`, triggers and phase-changing ops. Building M6 against the
current schema means building a UI for effects the engine cannot evaluate. **Sequencing
note:** every gap entry cites the real card and the exact clause, so this is a checklist
with evidence behind it, not a research task.

### M3 — Server · 3 days · **not boardgame.io** · ✅ DONE AND VERIFIED
- [x] Hand-rolled `ws` server: lobby, seat management, `MatchRunner`, broadcast, store
- [x] Reconnect/resume with a rotating `resumeToken` — not a `matchID` as credential
- [x] Action-log-authoritative store with **two** implementations —
      `InMemoryMatchStore` (`store.ts`, log is truth + `replay()`) and
      `PostgresMatchStore` (`store-postgres.ts`, one JSONB row per match), selected by
      `main.ts` on `SHASN_DATABASE_URL`. **boardgame.io was never installed.**
- [x] The secret-state gate, in one file: `playerView`, applied at exactly one place
      (`broadcast.ts`) — plus `test/render-all.ts`, which is `never`-checked and renders
      every projection, and `scripts/check-secrets.mjs` as a CI grep wired into
      `typecheck` so it cannot be skipped by running only the tests
- [x] Randomised `order: 'ab' | 'ba'` on the blind prompt — seed-derived in
      `broadcast.ts`, never `Math.random`, so replay determinism holds
- [x] Runtime message validation (`validate.ts`, `decode*`), lobby/join/reconnect/resume/
      spectators, protocol-parity test against the client's mirrored types
- [x] **101 tests passing**
- [ ] ⚠ **Snapshot cadence not implemented.** `snapshot?` / `snapshotAtSeq` exist on the
      type and `rulesVersion()`/`cardsVersion()` are computed and `replay()` refuses a
      mismatch via `ReplayMismatch` — but nothing yet *writes* a snapshot every 10
      actions. Log-authoritative replay is correct without it, so this is a performance
      item, not a correctness one. **M7.**
- [ ] ⚠ **The human exit criterion was never performed:** *"two browsers, real game,
      payouts confirmed absent from devtools."* The automated tests prove the projections
      are correct; only a human reading the wire proves they are the ones actually sent.
      **This cannot be marked done from a test run**, and it blocks M7's release gate.

### M4 — Board UI · 4–5 days · 🟡 SUBSTANTIALLY DONE AND VERIFIED
- [x] SVG board, 9 zones, 129 peg slots as real hit targets — `BoardSvg.tsx` + one
      `VoterSlot` per `AreaSpec`, 1000×1500 viewBox
- [x] **Fidelity constraint honoured:** the real board is a topographic contour map whose
      zone interiors are *unfilled*. The generator produced a *coastline*; `contours.ts`
      now renders concentric contour rings clipped to `COASTLINE`, so the texture runs
      through the zones and only the borders are drawn. Volatile Areas are rosettes, not
      a colour wash (`VolatileRosette.tsx`).
- [x] Peg legend as a **10 × 7 matrix** (`pegMatrix.ts`) — the real board's encoding
- [x] Keyboard navigable — roving tabindex, **one tab stop for 129 slots** (D20)
- [x] Answer prompt with a **type-level proof** that no payout can reach the DOM
      (`answer/blindAnswer.types.ts` + `blindAnswer.test.tsx`)
- [ ] Spend panel / manifesto tray as *separate* components — subsumed by `app/` in M5
- [ ] Lock animation, gerrymander drag
- [ ] 2-player support blocked on §6 row 7 (UNRESOLVED — do not implement)

### M5 — Client panels + app shell · 3 days · 🔧 WRITTEN, **NOT WORKING**

> **This is the one milestone whose plan text and reality disagree in the *opposite*
> direction from the last pass, so read it carefully.** An earlier reconciliation claimed
> M5 was "not started" and that "no game screen renders a `ClientState`". **Both claims
> were false.** The work is written; what is missing is that it compiles.

- [x] `app/App.tsx` — `useSyncExternalStore` over the net store, one connect effect, a
      switch on phase → `ReconnectScreen` / `LobbyScreenHarness` / `GameScreen`
- [x] `app/Lobby.tsx` — create/join/ready/start/spectate
- [x] `app/GameScreen.tsx` — the whole §5.0 shell **is written**: board + mat + log,
      `AnswerScreen`, `HeadlineDialog`, `ChoiceResolver`, `ConspiracyPicker`,
      `TradeComposer`, `PlacementBar`/`GerryBar`, `END TURN`, the §5.13 phone tab bar,
      and the `aria-live` sentence
- [x] `app/{Panels,YourMat,ResourcePicker,ChoiceResolver,BoardBars,AnswerScreen}.tsx` —
      all compile clean
- [x] `app/{derive,store,session,blindWire}.ts` — the `ClientState` → board projection,
      app-local interaction state, the singleton connection
- [x] `net/{protocol,connection,store,index}.ts` — tested
- [x] `board/*` and `answer/*` — see M4
- [ ] ⛔ **`tsc --noEmit` fails: 14 errors, all in `src/app/GameScreen.tsx`.** The app
      shell does not build. A separate agent is on this in parallel.
- [ ] ⛔ **Never run against a live server.** No session exists in which `GameScreen`
      rendered a real `match:state`. **The wiring is unverified, not absent.**
- [ ] `ConspiracyPicker` (`GameScreen.tsx:496-508`) renders **no card and no hand** — it
      is a `ResourcePicker` for paying a blind cost. That is a *direct consequence of the
      D25 reversal*: the correct fix is a **server-sent list of legally-playable
      conspiracy ids**, which does not exist yet. See §5's resolved note.
- [ ] No `a11y` script in `packages/client/package.json`, so the exit criterion
      `npm run a11y --workspace @shasn/client` **cannot currently be run at all**.
- [ ] The no-optimism reference-equality test (`ARCHITECTURE.md` §7.8) — **not verified
      to exist.**

**Why the 14 errors are good news, stated plainly:** they are mechanical, not
architectural. Reading `GameScreen.tsx`, they are type-only names re-exported at `:911`
(`Resource`, `SeatCount`, `WireSeatCount`) with no import in scope, an unused-import
alias at `:74`, and `as never` casts standing in for real `ZoneID` narrowing. **The
structure matches §5's design.** The fix is a typing pass, not a rewrite.

### M6 — Conspiracies, headlines, interrupts · 2 days · ⬜ NOT STARTED
- [ ] Conspiracy purchase + play
- [ ] Headline resolution order — §6 row 5 is **resolved** (one per volatile placement,
      in placement order, at end of turn); **row 8 stays open** (does a gerrymander *into*
      a Volatile Area trigger a Headline? — D6, both readings documented)
- [ ] **`InterruptStrip`** — "Asha played a Conspiracy out of turn", visible to all players
- [ ] ⚠ **Blocked by M2b.** M6 is Conspiracies and Headlines — exactly the content that
      needs `duration`, triggers and phase-changing ops. Building it against the current
      schema means building a UI for effects the engine cannot evaluate.
- [ ] ~~Interrupt/out-of-turn action framework~~ — **see the open note below. Not built.
      Deliberately not closed.**

> ### ⚠ OPEN DISAGREEMENT — D5, "no interrupt framework". UNRESOLVED. Keep it that way.
>
> `ARCHITECTURE.md` §8.1 **D5** drops the general interrupt framework entirely, arguing
> that `reduce`'s two turn-gate exceptions plus `PendingChoice` already *are* the
> out-of-turn mechanism.
>
> **I am not convinced, and I am recording the disagreement rather than silently adopting
> it or silently closing it.** `PendingChoice` is a channel for *decisions the engine
> already owes a player*; an interrupt framework is a channel for *actions nobody owes
> anyone*. The difference shows up in exactly the case D5 accepts as its cost: a player
> with no pending decision has nothing to be "interrupted into", so `PendingChoice`
> cannot express it — and the architect's own residual risk, no timed window, so a
> 5-player async table can be ambushed, is a *table-experience* problem that a queue would
> have addressed.
>
> **State of play, 2026-09-30:** no interrupt framework has been built. The engine ships
> D5's two turn-gate exceptions and `PendingChoice`, and that is all. `ARCHITECTURE.md`
> §8.2 now also carries this as **open**, and names the same disconfirmation I do: a
> 5-player playtest, not more architecture argument.
>
> **Position: do not build the framework in M6, but keep it as an explicit M6+ item with
> a 5-player playtest as its trigger, rather than closing it as decided.** The architect
> flags D5 as its least-confident decision and I agree that a playtest, not more
> analysis, is what settles it — I am only declining to close it in the meantime.

### M7 — Hardening + release gate · 2 days · ⬜ NOT STARTED
- [ ] Property-based leak fuzzing (`test/leak-fuzz.test.ts`) — must also fuzz the
      **unprefixed** private keys, or it re-opens R1
- [ ] Balance `--strict` clean, with every warning argued in a PR
- [ ] **Kill-the-server-mid-game-and-resume** test — this is what turns §9 risk #5 from a
      mitigation into a verified property
- [ ] Snapshot cadence (§3.6) — written every 10 actions and on phase change
- [ ] `docs/RELEASE-CHECKLIST.md`
- [ ] ⚠ **M3's human exit criterion must be performed here and cannot be automated:**
      two browsers, a real game, payouts and conspiracy hands confirmed absent from
      devtools. This is the one gate that no test run can satisfy, and it is the reason
      "tests pass" is not the same claim as "the game is safe".

**Playable alpha: ~2 focused weeks. 4–6 weeks part-time** — **still roughly right, but
the estimate no longer holds for one reason.** The engine, server, board and cards are
done or nearly done; the two things between this and playable are the **14 compile
errors** in the client (hours, not days) and **M2b schema evolution** (§9 risk #1), which
is not on the original critical path at all and is now the thing most likely to decide
whether this game can represent the real game. **Ship with 60 cards, and understand that
the binding constraint is schema coverage, not card count.**

---

## 8. Legal

Shasn is an active commercial product. Memesys also published an official
Tabletop Simulator mod which now appears delisted from the Steam Workshop.

Game *rules* are not copyrightable. The card text, artwork, board design, and the
name **are**.

Two clean paths — pick before M2 (the card-writing milestone), not before M1:

1. **Ask Memesys.** They built a digital version once, so they want one to exist.
   A licensed or blessed build beats a clone and costs one email.
2. **Original decks, own theme.** Shasn-derived mechanics, our own dilemmas and
   identity. Fully legal — and the card corpus was going to be the bulk of the
   work either way.

The engine work is identical under both. **This does not block M0 or M1.**

**Recommendation, 2026-09-30: path 2, and send the email anyway (`ARCHITECTURE.md` §6.1,
D15).** Path 1 has no committed timeline and no cost to waiting, because nothing
downstream depends on the answer. So do not start the corpus on a licence you do not
have, and do not block on the email either: the **schema, validator and balance checker
are licence-agnostic and get built now**, and the corpus is written against an original
theme. If Memesys say yes, the original decks remain valid and shippable and the licensed
decks are added as an alternative `decks/` directory. If they say no, nothing was wasted.
That is now **M1.5** (§7) — one email, day one, zero engineering.

Three constraints the fidelity research adds, which are stricter than "don't copy the
text" (`docs/AUTHENTIC-SHASN-REFERENCE.md` §9):

- **Do not ship the name.** SHASN is a live mark in commerce. An original-word game about
  Indian politics is not confusing; a game *called* SHASN that plays exactly like SHASN is.
  The `@shasn/*` package names are fine internally; the published product name should not
  be. (This is a judgement, not a legal opinion, and it is cheap to reverse now and
  expensive after launch.)
- **Do not use Memesys artwork, including the four resource icons** — they are their line
  drawings, the contour board art is arguably the stronger copyright than the text, and
  the Sri Yantra / Kolkata star are religious and national symbols whose casual commercial
  reuse is a separate reputational question. Keep the *layout, geometry, fraction
  typography* and the one-resource-per-Ideologue mapping, which are mechanics. Use a
  different border motif: the lattice/jaali is the closest thing to trade dress here.
- **The recovered card text stays in the repo as research, not as product.** Keeping it is
  quotation of published rules text for interoperability — the same posture
  `rules-reference.md` takes, and the same posture Memesys published those "X Cards
  Explained" aids *for*. Shipping it in a competing build is a different act. The realistic
  risk is not a lawsuit but a **DMCA takedown** of the repo or a demo build. **This is a
  conscious decision, recorded here so it is not an accident** — and if the project ever
  goes public and commercial, the verbatim tables in `AUTHENTIC-SHASN-REFERENCE.md` §4
  should be reduced to archetype descriptions. Card *names* are the highest-value,
  lowest-weight item and the first thing to change.

Note also that the TTS mod is the single most promising route to the real card text
(§10) and was **not** reachable during the research session. If it turns out to exist, its
art and text are Memesys' and are covered by everything above.

---

## 9. Where this project actually dies

Ranked by real risk, not by how hard the code is. **This register survived review, and
the architect independently relies on it** — §3 above exists because of #5, and M2's
"ship a bounded corpus" exists because of #1 (`ARCHITECTURE.md` §8.1 D4, D14).

> **Re-ranked 2026-09-30, third pass, against what is now built.** #1 has changed
> *character*, not just size: it was "the corpus is expensive and we have recovered
> nothing", and it is now **"the schema cannot express the corpus we recovered"** — a
> sharper and more dangerous risk, because it is invisible to every test we have. #3 has
> fallen from "one careless broadcast" to **largely closed** (the three-layer gate ships
> and R1 is fixed), with one manual gate outstanding.

1. **⛔ THE CARD SCHEMA, not the corpus. (promoted, and now #1 by a wide margin.)**
   **43 of the 50 real cards recovered from Memesys' official player-aids — 86% — cannot
   be expressed at all** in the current schema. Predicted 40%; the true figure is worse
   than double, because the exotic effects live in the Headline and Conspiracy decks and
   those are the only two we have text for. 24 gaps enumerated as G0–G24 in
   `packages/cards/KNOWN-GAPS.md`: `duration`/scope (11 cards), `when`/triggers (6),
   `PlayerState.restrictions` (5 — a *state* change, not a card change), five
   phase-changing ops that do not belong in an `Effect[]` at all (5), dynamic values read
   off own state (5), deck search (4), zone-scoped ops (3). **Cheapest first win is a
   one-line `gerrymander` target field.**
   **Why this is worse than "the corpus is expensive":** a 61-test green suite does not
   see it. The tests prove the corpus and the schema agree; they cannot prove the schema
   matches the game. Writing card #61 against this schema produces a 61st card with the
   same limitation as the first 60 — and M6 (Conspiracies/Headlines) is exactly the
   content that needs the missing vocabulary. **This is M2b, first-class, before M6.**
2. **The card corpus as writing.** Still real and still the long pole — ~100+ dilemmas
   per setting that are genuinely hard, genuinely balanced, and not a partisan tract.
   This is writing, not engineering. **But it has changed rank** because the constraint
   moved: 60 cards ship and the game is *not blocked on having more of them*. It is
   blocked on being able to *express* the ones we have. See §10 for what we recovered.
3. **Secret-state leaks.** One careless broadcast and the blind-answer mechanic is gone.
   **Largely closed, and the closure is three-layered:** the type-level contract
   (`ServerOnlyKeys`, 11 fields), a structural test that walks the whole object graph,
   and a CI grep (`scripts/check-secrets.mjs`, wired into `typecheck` so it cannot be
   skipped by running only tests) plus a `never`-checked `test/render-all.ts`. R1 — the
   Conspiracy hand — is **fixed** by decision (§5, D25). **One gate remains open and no
   test can close it:** a human reading devtools on a live game. That is M7's release
   criterion.
4. **Interrupt timing.** Out-of-turn plays are where digital board games traditionally
   break. **Still contested and deliberately left open:** `ARCHITECTURE.md` §8.1 D5
   proposes building no interrupt framework at all. See the OPEN DISAGREEMENT note in
   §7 M6 — it is on the list because the disagreement is unresolved, not because the
   answer is known.
5. **Session length.** 4–6 hours at 5 players. Async play isn't a nice-to-have, it's
   survival. **Accepted and designed for**, not deferred: the action log is the source of
   truth and a snapshot is only a cache, so a long match is replayable rather than losable
   (§3) — and that is now *true*, not aspirational, because R2 made `reduce` pure. What
   remains is proving it: the kill-the-server-mid-game test is M7, and the snapshot
   cadence itself is not yet written.

**Not on this list, and worth saying so:** the engine no longer belongs here. It was the
top risk for two passes while it did not compile; `npm run typecheck` exits 0 and 179
tests pass. Risk that has been *paid down* should leave the register, or the register
stops being a register.

---

## 10. What we actually know about the real cards

Short version, because §9 risk #1 is the project and this is the state of its input.

> ### ⚠ Read the two numbers below together, or the picture is badly wrong.
>
> | Recovered | Shipped | Unshippable |
> |---:|---:|---:|
> | **50** real X-cards with complete official text | **60** cards (15 adapted, 45 inferred, **0 verbatim**) | **43 of the 50 (86%)** |
>
> **The recovery effort worked and it bought us less than it looks like.** We have
> verbatim text for 50 real cards and we can only *use* 7 of them. §9 risk #1 is no longer
> "we have nothing" — it is **"we have the text and no way to express it"**, which is a
> schema problem, not a writing problem, and a much more tractable one. The 24 gaps are
> enumerated in `packages/cards/KNOWN-GAPS.md`; the milestone is **M2b**.

**Recovered: 55 cards verbatim, from Memesys' own official player-aids.** Not fan wikis,
not forum speculation — the "X Cards Explained" documents Memesys published *as player
aids* (four of them). The breakdown:

- **15 Conspiracy Cards** and **20 Headline Cards** (Earth 2040 deck) with complete
  official rules text.
- **~19 more Headline Cards** verbatim across the India, USA and Rome campaigns.
- **4 India Conspiracy Cards** named: Chai-Paani, Jumla, Block, Cult-ivating Obedience.
- **1 Ideology Card** — a *character* card, side-pair caption only, not a question card.
- **~12 partial Ideology questions/answers**, legible only in tournament-table
  photography.
- **3 Voter Cards** with full print-and-effect text.

**Not recovered: zero ordinary question Ideology Cards.** Not one. Those exist only as
images on the physical product, in photo reviews and in video frames, and **YouTube,
Reddit and BGG were all unreachable** in the research session (BGG returns 403/Cloudflare;
Reddit and the official site's `/play` page return JS-only empty shells). Press coverage
describes the category in general terms and nothing more. `docs/AUTHENTIC-SHASN-REFERENCE.md`
§2.4 names the three places that would actually close the gap, in order of expected yield:

1. **The Tabletop Simulator mod on the Steam Workshop.** TTS mods ship the actual card
   art and JSON, and the Workshop filepages are scrapeable. Highest value per query, and
   it was not reached.
2. **Photo reviews.** Dice Tower's video thumbnail gallery, `meeplemountain` and
   Space Biff review photo sets, and BGG image galleries on `cf.geekdo-images.com` — CDN
   hosted and directly fetchable *without* a Cloudflare challenge. BGG image URLs are the
   practical way around the BGG block.
3. **Buy the deck.** The Essential Edition India 2022-23 is the cheapest route to 108
   real cards and legally the cleanest. This is the one "research" action that solves the
   problem outright.

**Do not fabricate card text.** If none of the above lands, write original cards in the
recovered register and cite §8.2 of the reference doc for the rules of that register.

**Two fidelity findings that are hard constraints on the build, not flavour:**

- **The board is a topographic contour map, and the zones have no fill colour.** The real
  land is a pale cream silhouette filled with fine concentric contour lines; the texture
  runs *through* the zones and only thick slate-blue borders separate them. Volatile Areas
  are large dark cog/sunburst rosettes, ~2.5× a voter area, not a colour wash. Anything
  that tints a zone to carry meaning is wrong twice over — it is not the real board, and
  `docs/UI-SPEC.md` §9.7 already forbids colour as the majority channel for accessibility
  reasons.
- **Real payouts are printed as one icon disc per resource, never as numerals.** Observed
  payouts are 2–5 discs, 0–3 of any single type, and a side need not pay the answerer's own
  resource at all (the shipped "SHOULD WE INVADE NEW SPAIN?" Capitalist side pays 2 Trust
  + 1 Media and **zero Funds**). Therefore: render as
  `repeat(pays[res] ?? 0, <resIcon>)`, **and `sidePayout()` must never drive rendering.**
  `sidePayout()` sums a `Delta` to a single number; that is a balance-checker helper, and
  using it in the UI would throw away exactly the information the player is paying
  attention to. A consequence for the corpus: a side with `pays: {trust: 0}` is
  indistinguishable from `pays: {}`, so the validator should require
  `sidePayout(side) >= 1`. The engine's `Delta = Partial<Record<Resource, number>>` is
  correct as-is — do **not** add a rule that a Capitalist answer must pay Funds, because it
  would reject a real card.

