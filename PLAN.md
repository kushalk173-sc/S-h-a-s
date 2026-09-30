# Digital Shasn — Build Plan

Status: **draft; code exists, engine repair in flight**
Owner: kushalk
Last updated: 2026-09-30

Reconciled 2026-09-30 against four documents that partly supersede sections below:
`docs/ENGINE-AUDIT.md` (read-only audit of `packages/engine`), `docs/ARCHITECTURE.md`
(server, secret-state and milestone design), `docs/AUTHENTIC-SHASN-REFERENCE.md` (fidelity
research on the real product), `docs/UI-SPEC.md` (board and client design). Where they
disagree with this file, the disagreement is now written down here rather than silently
resolved.

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
| Shared types | `@shasn/shared` — ~250 lines of wire types + guards | New in `ARCHITECTURE.md` §1.2 / §8.1 D10. The client/server contract is where a silent mismatch is catastrophic, and the secret-state gate lives on it. |
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
*replay*, not a restore. Snapshot every 10 actions and on every phase change, written
behind the dispatch path. Cost accepted: a `rulesVersion`/`cardsVersion` drift is a
correctness bug rather than a warning, so replay refuses to run on a mismatch.

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
│   │   └── test/                  # EMPTY as of 2026-09-30 — see §7 M1
│   ├── shared/         # wire types + guards (ARCHITECTURE.md §1.2)
│   ├── cards/           # JSON decks + schema + balance checker
│   │   ├── schema/card.schema.json
│   │   ├── decks/
│   │   └── scripts/validate.ts
│   ├── server/          # hand-rolled ws: MatchRunner, broadcast, store, resume
│   └── client/          # React + SVG
├── docs/                # ENGINE-AUDIT, ARCHITECTURE, UI-SPEC, rules-reference,
│                        # AUTHENTIC-SHASN-REFERENCE
├── PLAN.md
└── package.json         # npm workspace
```

> The module list above is the engine **as it exists**, not as originally sketched.
> `zones.ts`, `capital.ts`, `manifesto.ts`, `gerrymander.ts`, `conspiracy.ts` and
> `apply.ts` were folded into the modules shown during a refactor; the barrel
> (`index.ts`) was never updated and still points at six of them
> (`docs/ENGINE-AUDIT.md` §2 B1). `packages/server` is the hand-rolled server from §3,
> not a boardgame.io adapter.

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
> `docs/ENGINE-AUDIT.md` §5.1, the shipped `GameState` carries **ten** server-only
> fields, not three: `_pendingCard`, `_ideologyDraw`, `_ideologyDiscard`, `_voterDraw`,
> `_voterDiscard`, `_conspiracyDraw`, `_conspiracyDiscard`, `_headlineDraw`,
> `_headlineDiscard`, `_seed` — the deck count went from three to four when Voter Cards
> were split out, and `_seed` was added. A leaked `_seed` plus the already-revealed
> cards reconstructs every remaining draw, so it is the one people forget. Zones are
> also not the peg records sketched above: pegs live at `areas[i].peg`, and a `Zone` is
> `{id name majority capacity neighbours areas majorityHolder}`.
>
> Two consequences for the assertion above. First, it must be **structural and
> recursive** — strip by `_` prefix and walk the whole graph — not a hand-maintained key
> list; the current `Omit<GameState, '_deck' | '_pending' | '_conspiracyDeck'>` names
> three fields that do not exist and omits all ten that do, and still typechecks
> (`ENGINE-AUDIT` §2 B3). Second, `_`-prefix is **not sufficient on its own**:
> `PlayerState.conspiracies` is a hidden hand and is not `_`-prefixed, so it is
> currently shipped to every client including its owner (risk R1, HIGH). The test as
> written would pass while that leak ships. Full contract: `docs/ARCHITECTURE.md` §4.
>
> **Note — an unresolved disagreement between two of our own documents, on Conspiracy
> hands.** `docs/ARCHITECTURE.md` §8.1 **D25** says conspiracy hands are **public**, on the
> grounds that they are visible at a physical table and that "the bluffing lives in the
> *answer*, not the hand". `docs/ENGINE-AUDIT.md` **R1** says the opposite and rates it
> HIGH: the rulebook has cards being "bought and held" (`rules-reference.md` §12), and
> shipping every opponent's hand to every client is the same class of defect as the
> blind-answer leak the module's own docstring calls "the single most important function in
> this package" — except that module's reasoning, and its test, only consider `_`-prefixed
> fields, so **the leak passes its own test**. I side with the audit: physical visibility
> is a property of the table, not a security model, and "an attacker enumerates your hand"
> is the correct threat model for an online game where the hand is not physically visible.
> Flagged rather than resolved here because the fix lands in `packages/engine`, which this
> pass does not touch. **It must be settled before M3 ships, not after.**

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
| 9 | **Card schema cannot express phase-changing effects** | `Effect[]` has 12 ops and **cannot represent roughly 40% of real Conspiracy/Headline card effects**. Five of them are not effects at all — `block`, `deflect`, `auction`, `vote`, `pass-card` change the *phase*, not a resource or a voter. There is also no `duration` field, so "this turn / this round / rest of game" is inexpressible. Affects the Ideology schema least (that one is already a correct match) and X-cards most. | M2 schema |
| 10 | **Auctions are a rules system with no representation** | p12/p34: bid above your cap without holding the funds, settle with an **IOU token**, and **no purchases until the bid is paid in full**. There is no `Phase` for it, no debt field, and no way for the action vocabulary to say "you owe 3". The doc never claimed it was implemented; the risk is that it is silently absent from a milestone. | Decide scope: out of v1, or add `PlayerState.debts`. Blocks M6 |
| 11 | **Coalitions cannot be represented without a breaking type change** | Official add-on (p13 of the official site): split a zone's majority in a negotiated ratio, formalised by exchanging an Ideology Card, rights to the larger partner only. `Zone.majorityHolder` is a **single** `PlayerID \| null` — structurally one player per zone. **Decide the type change now, not after M1**, while the engine is already being repaired. | M1/M0r (type), M6 (play) |
| 12 | **Zone majority ties, and end-game scoring ties** | A genuine gap, not an oversight: §16 lists six unsettled points and neither tie is among them, so the rulebook is silent. `recount` today lets board-scan order silently decide a simultaneous majority (R4), while `gerrymanderRights` correctly returns `null` on a tie — two functions in one package disagreeing about what a tie means. `winners()` also returns *every* player when all scores are 0 (R5). | Needs a ruling; pin with tests 29 and 31 |

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
milestone is blocked by the engine repair, and the single file it waits on is
`playerView.ts`. M4 (board) and M2 (cards) have **zero** engine dependencies and can run
today. The milestone list below is kept in this file because it is the project's own
vocabulary; where the two disagree, ARCHITECTURE.md §7 wins on sequencing and §7.2 holds
the current sizes.

### M0 — Scaffold · ½ day ✅ DONE (one box corrected)
- [x] `git init`, **npm** workspace, TS config, vitest
- [x] `engine` package created
- [ ] ~~engine package with a passing test suite~~ — **this box was ticked in error and is
      now unticked.** `packages/engine/test/` contains **0 files** and `npx vitest run`
      exits 1 with `No test files found` (`docs/ENGINE-AUDIT.md` §2, §3).
- [ ] CI lint+test (deferred — no remote yet)

> Changed from the original plan: **npm workspaces, not pnpm.** pnpm wasn't
> installed and npm 11 handles workspaces fine. One less global dependency.

### M1 — Rules engine · 2–3 days · 🔧 NOT DONE — repair in progress

**This milestone was previously marked "✅ DONE — 50 tests passing, `tsc --noEmit` clean".
That claim was false and is withdrawn.** Ground truth at audit time
(`docs/ENGINE-AUDIT.md`, read-only, 16 errors listed verbatim in its §2):
`npm run typecheck` = **16 errors**; `packages/engine/test/` = **0 files**; `npx vitest
run` exits 1. A repair is in flight right now (`ARCHITECTURE.md` §7.3 calls it **M0r**),
run in parallel by another agent. **Do not treat M1 as done, or any figure below as
green, until `npm run typecheck --workspace @shasn/engine` exits 0 and the named tests
pass.**

Defects the repair is addressing, from `ENGINE-AUDIT.md` §2:

| id | file | Class |
|---|---|---|
| B1 | `index.ts` | 6 dead export paths (`./config`, `./capital`, `./zones`, `./manifesto`, `./gerrymander`, `./apply` — all deleted in the refactor) and 9 of the 13 real modules missing from the barrel |
| B2 | `setup.ts` | **Rewrite the function**, not a patch: wrong in **nine** ways, five compile-visible and four silent. The worst are behavioural — no `_pendingCard` at setup means a **turn-1 soft-lock** (no legal move exists), the HQ market is never dealt, `round` is never set, and `staggeredStart` is unimplemented |
| B3 | `playerView.ts` | `Omit` names 3 fields that don't exist and omits all 10 that do; plus the real bug — opponents' Conspiracy hands are shipped (R1) |
| B4 | `reduce.ts:901` | One type annotation. No behaviour change; do **not** "fix" it by mutating `headlineQueue` in place |
| R1–R12 | across the package | 12 logic bugs the compiler cannot see. Two are CRITICAL: **R2**, module-level `let` counters make `reduce` impure, so a replay from seed + action log does **not** reproduce the game; and **R3**, no `Delta` is validated non-negative, so **a client can mint resources** |

M1 checklist. **Ticks below mean the module exists, not that the behaviour has been
tested** — the test suite is empty, so nothing here is verified yet:

- [x] `RulesConfig` with every open-question value as a named constant — now `RULES` in
      `src/rules.ts`
- [x] Zones: placement, majority detection, peg locking
- [x] Capital: earn, spend, cap enforcement
- [x] Manifesto: ideology accumulation → power unlocks + archetype
- [x] Gerrymander legality + execution
- [x] Win/end detection (all zones locked **or** all slots filled)
- [ ] `playerView` correct — the type is wrong and the strip leaks (B3/R1)
- [ ] `setup()` produces a legal `GameState` — it does not today (B2)
- [ ] Structural secret-leak test — **does not exist.** The only test in the M1 exit
      criteria is a full game to completion, and it is not merely untested but
      **unreachable**: `setup()` cannot build a legal state, so a full game cannot be
      constructed at all (`ENGINE-AUDIT.md` §6c)
- [ ] The 135-test suite specified in `ENGINE-AUDIT.md` §3, of which **13 are expected to
      fail on first run** against the current source — that is the correct starting state,
      they are the regression tests for the fixes above

### M1.5 — Legal · 0 days engineering · NEW
- [ ] Send the one email to Memesys (see §8). Day one, in parallel with everything else.
      Exit criterion: sent, and a `docs/licence.md` note recording the date and the ask.

### M2 — Cards · 1 day build + the long content pole
- [ ] JSON Schema + CI validation — **and settle §6 row 9 first**, the schema cannot
      express phase-changing effects or durations
- [ ] 40 seed cards, one setting
- [ ] Balance checker: flag any card where one side strictly dominates (severity is split
      into errors and warnings on purpose — `ARCHITECTURE.md` §6.4)
- [x] ~~`playerView` + the secret-leak test~~ — claimed done in M1; it is not (§2 B3)

### M3 — Server · 3 days · **not boardgame.io**
- [ ] Hand-rolled `ws` server: lobby, seat management, `MatchRunner`, broadcast, store
- [ ] Reconnect/resume with a rotating `resumeToken` — not a `matchID` as credential
- [ ] Action log persisted from the first action; snapshot every 10 actions and on phase
      change, behind the dispatch path (§3)
- [ ] **The secret-state gate lives in this milestone, and it is one file:** `playerView`.
      Everything else on Lane B can be built against fixtures.
- [ ] Send the randomised `order: 'ab' | 'ba'` on the blind prompt (§2 A′, `UI-SPEC` B1)
- [ ] **Exit criterion: two browsers, real game, payouts confirmed absent from devtools** —
      a manual step on purpose. The automated tests prove the projections are correct;
      only a human reading the wire proves they are the ones actually sent.

### M4 — Board UI · 4–5 days
- [ ] SVG board, 9 zones, peg slots as real hit targets. **Fidelity constraint:** the real
      board is a topographic contour map whose zone interiors are *unfilled* — the land
      texture runs through them and only the borders are drawn
      (`docs/AUTHENTIC-SHASN-REFERENCE.md` §6.1). The generator produced a *coastline*;
      the real thing is a contour texture.
- [ ] Answer prompt (payouts hidden **and** order randomised per card), spend panel,
      manifesto tray
- [ ] Lock animation, gerrymander drag
- [ ] Keyboard navigable — roving tabindex, one tab stop for 129 slots
- [ ] 2-player support blocked on §6 row 7

### M5 — Conspiracies + headlines · 2 days
- [ ] Conspiracy purchase + play
- [ ] Headline resolution order — §6 row 5 is now **resolved** (one per volatile
      placement, in placement order, at end of turn); row 8 is the open sub-case
- [ ] ~~Interrupt/out-of-turn action framework~~ — **see the note below before scheduling
      this as framework work.**

> **Note — where I think the architect is wrong (or at least premature).** `ARCHITECTURE.md`
> §8.1 D5 drops the general interrupt framework entirely and argues that `reduce`'s two
> turn-gate exceptions plus `PendingChoice` already *are* the out-of-turn mechanism. On
> reading the code I am not yet convinced, and I am recording the disagreement rather than
> silently adopting it. `PendingChoice` is a channel for *decisions the engine already owes
> a player*; an interrupt framework is a channel for *actions nobody owes anyone*. The
> difference shows up in exactly the case D5 accepts as its cost: a player with no pending
> decision has nothing to be "interrupted into", so `PendingChoice` cannot express it, and
> the architect's own residual risk — no timed window, so a 5-player async table can be
> ambushed — is a *table-experience* problem that a queue would have addressed. My
> position: do not build the framework in M5, but **keep it as an explicit M6+ item with a
> 5-player playtest as its trigger**, rather than closing it as decided. The architect
> flags D5 as its least-confident decision and I agree that a playtest, not more analysis,
> is what settles it — I am only declining to close it in the meantime.

### M6/M7 — NEW, condensed
- **M6 Conspiracies, headlines, interrupts** — mostly rendering, not framework
  construction (`ARCHITECTURE.md` §7.9). Depends on §6 rows 8, 10, 11.
- **M7 Hardening + release gate** — leak fuzzing, balance `--strict`, and a deliberate
  **kill-the-server-mid-game-and-resume** test, which is what turns §9 risk #5 from a
  mitigation into a verified property (`ARCHITECTURE.md` §7.10).

**Playable alpha: ~2 focused weeks. 4–6 weeks part-time** — still roughly right, but note
that the card corpus (§9 risk #1, §10) runs past it and is the only item that does not
compress. Ship with 40 cards.

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
"ship with 40 cards" exists because of #1 (`ARCHITECTURE.md` §8.1 D4, D14). Re-ranked
against what is now known, #1 has gone from "expensive" to "the long pole with nothing
recovered", and #3 has gone from "one careless broadcast" to "the class of bug we just
found twice in code we believed was finished".

1. **The card corpus.** ~100+ dilemmas per setting that are genuinely hard,
   genuinely balanced, and not a partisan tract. This is writing, not
   engineering, and it is most of the project. **See §10 for what we actually
   have, which is close to nothing.**
2. **Payout balance.** If one side of a card is strictly better, players optimize
   instead of deliberating and the entire premise collapses.
3. **Secret-state leaks.** One careless broadcast and the blind-answer mechanic
   is gone. Hence the structural leak test — which is currently in M1/M0r, not M2,
   and does not exist yet (§7).
4. **Interrupt timing.** Out-of-turn plays are where digital board games
   traditionally break. **Now contested:** `ARCHITECTURE.md` §8.1 D5 proposes
   building no interrupt framework at all; see the note in §7 M5. Still on the list
   because the disagreement is unresolved, not because the answer is known.
5. **Session length.** 4–6 hours at 5 players. Async play isn't a nice-to-have,
   it's survival. **This risk has been *accepted and designed for*, not deferred:**
   the action log is the source of truth and a snapshot is only a cache, so a long
   match is replayable rather than losable (§3). What remains is proving it — a
   deliberate kill-the-server-mid-game test is in M7.

---

## 10. What we actually know about the real cards

Short version, because §9 risk #1 is the project and this is the state of its input.

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

