# Digital Shasn

A server-authoritative online multiplayer implementation of Shasn: players sit at a
shared political board, are dealt Ideology Cards, and answer them at the table.

> ### ⛔ The design changed. This is the one-paragraph version.
>
> **This project used to ship a blind answer** — the answering player could not see the card
> or its payout, and a build-time gate failed the build if the payout ever reached the wire.
> **That design has been deliberately reversed.** While a card is out, **every seat and every
> spectator now sees the whole Ideology Card: question, both answers, both Ideologues, and
> both payouts**, before anyone answers.
>
> **What is still secret:** the card's **id**, the **seed-derived face order** (so a table
> cannot learn which faction the left-hand cell holds by reading the printed Ideologue), every
> draw and discard pile, the RNG seed, and **every player's Conspiracy hand — including its
> owner's**. All still gated by the same build-failing grep.
>
> **Why, in one sentence:** the Ideology corpus is public JSON in this repository, so every
> card's payout was always one lookup away — the withholding was protecting *which* card was
> on the table, and the new design prints that on the card. **The full argument, and what the
> change retired, is [`packages/server/src/FULL-INFORMATION.md`](packages/server/src/FULL-INFORMATION.md).**
> Read it before you touch the answer screen; `docs/UI-SPEC.md` §1.2 and §5.3 carry the
> superseded rules as a labelled audit trail rather than deleting them.

The server holds the whole game and is the only thing that writes to a socket. See
[Architecture](#architecture) below.

## Quickstart

Requires **Node 20 or newer** (the root `package.json` enforces this).

```sh
npm install
npm run dev          # server + client together, with the WebSocket proxy wired up
```

Then open **<http://localhost:5174>**.

> Use `localhost`, **not** `127.0.0.1`. The Vite dev server binds IPv6 loopback
> (`::1`) only, so `http://127.0.0.1:5174` is refused while `http://localhost:5174`
> works. This is a Vite default, not a bug here — see
> [docs/RUNNING.md](docs/RUNNING.md#use-localhost-not-127001).

Two or more players: open a second browser window (or a private window) at the same
URL and join the same room.

To play the **production-shaped** way — one process, one URL, no Vite:

```sh
npm start            # builds the client, then serves it from the game server
```

Then open **<http://localhost:8787>**. This is the flow to actually judge the game
by: the page and the WebSocket share an origin, exactly as they would deployed.

## Commands

Run from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Server **and** Vite dev server together, `/ws` proxy configured. Hot reload for the client; the server restarts on changes to `packages/server` or `packages/engine`. |
| `npm start` | Builds the client, then serves it from the game server. One URL, no Vite. `-- --skip-build` reuses the existing `dist` and warns how old it is. |
| `npm run build` | Builds the client (`vite build`) into `packages/client/dist`. |
| `npm run check` | `typecheck` then `test`, across all workspaces. **Run this before committing.** |
| `npm run typecheck` | `tsc --noEmit` per workspace, plus the server's secret-field gate. |
| `npm test` | Vitest across all workspaces. |
| `npm run preflight` | Checks your environment without starting anything. See below. |
| `npm run kill-stale` | Stops whatever is holding ports 8787 / 5174. `-- --dry-run` to preview. |

`npm run dev`, `npm start` and `npm run preflight` all run the preflight first and
**refuse to start** if the environment is wrong, so you find out immediately instead
of staring at a blank page. It checks: your Node version against the root
`engines` range; that `tsx`, `vite` and `ws` are installed; that ports 8787 and
5174 are free (probing **both** IPv4 and IPv6 loopback, because they can disagree on
Windows); and that if `SHASN_DATABASE_URL` is set, a Postgres driver is importable.

## Architecture

Four packages under `packages/*`, wired as npm workspaces.

| Package | What it is |
|---|---|
| `@shasn/engine` | Pure rules engine. Zero runtime dependencies, knows nothing about the network. |
| `@shasn/cards` | The card corpus as JSON, plus a JSON Schema, a validator and a balance checker. The engine never authors cards. |
| `@shasn/server` | The authoritative match server: a WebSocket server on `ws` (boardgame.io is deliberately not used — its persistent state history would hold every draw pile in order). Also serves the built client. |
| `@shasn/client` | The React board. Purely presentational; it imports nothing from the engine, not even as a value. |

**The one fact that matters most:** the server is the only exit to the wire, and it is
narrower than a state object. Cards are resolved server-side; each player's `conspiracies`
hand is stripped **from every viewer including its owner** before anything crosses the wire;
every draw and discard pile, the PRNG seed, the id counter and **the pending card's id** stay
server-only; and the **face order of the answer is drawn server-side and never sent to
anyone** — the table gets the card already ordered, and the answerer gets the same card plus
the one `order` value that identifies which face is which.

`packages/server/scripts/check-secrets.mjs` greps for those field names and for any read of a
`_`-prefixed field outside the single exit to the wire, and it runs as part of
`npm run typecheck` — so violating the rule fails the build rather than shipping.

> **What is deliberately *not* secret, and it is a design decision rather than a gap:** the
> card's **content**. Question, both answers, both Ideologues, both payouts, to everyone at
> the table. See the note at the top of this file. The one thing the build-time gate exists
> to keep off the wire, above all, is the **card's id** — publishing that would move a
> secret onto an unprefixed field where the gate cannot see it.

## Cards, provenance and licensing

The shipped decks are **original work**, written against the mechanics but not copied
from any published card. Counted off the deck files:

> ### 🔴 151 cards — 0 verbatim, 41 adapted, 110 inferred. And the honest version.
>
> | | count | |
> |---|---:|---|
> | `verbatim` | **0** | Deliberate and structurally unreachable: reproducing a recovered card's rules text word-for-word would print a clause the engine does not implement. |
> | `adapted` | **41** | Recovered material, played as a reconstruction. Each names what it dropped. |
> | `inferred` | **110** | **Authored here.** |

> **⚠ The provenance split above is measured on a corpus that has since grown.** It is left
> as counted, because it was correct when counted and a README that silently rewrites its own
> history is not a README. What is known to have moved since: the corpus reached **221 cards**
> (`KNOWN-GAPS.md` §8, which added nine original substitutes for the recovered names it ruled
> out), and the Ideology deck is now **134 cards**, not 76. The `verbatim`/`adapted`/
> `inferred` split has **not** been re-measured — re-run `npm run validate --workspace
> @shasn/cards` and trust its output over this block, exactly as `docs/RUNNING.md` says.

**The part that should be impossible to miss: zero real Ideology Cards were ever recovered.**
The 55 real cards recovered from Memesys' own official player-aids are almost all Conspiracy
and Headline. The Ideology deck — **the 134 cards players see every single turn** — rests on
**ten recovered question stems**; everything past `ig-in2020-032` is authored outright, and
no answer side of any real Ideology Card was ever recovered. YouTube, Reddit and BGG were
all unreachable during the research session.

**The fidelity number, counted off the deck files on 2026-10-04:**

- **Only 31 of the 151 shipped cards — 21% — are recovered real material.** Those are the 31
  Conspiracy and Headline Cards tagged `adapted`. The other 10 `adapted` cards are Ideology
  Cards carrying a recovered question stem and nothing else, so the whole recovered corpus
  reaches **31 playable-looking cards**. **⚠ Superseded in part:** `KNOWN-GAPS.md` §8 measures
  the corpus-resident recovered cards at **34** (and shipped-as-authored at **26**) after three
  more were built and nine substitutes filed. The `21%` is a proportion of a corpus that has
  since grown, so it has not been recomputed.
- **All 134 Ideology Cards are authored.** That is the deck a player handles on every single
  turn, and it is authored end to end.
- **23 of the 54 named recovered cards are absent from the corpus entirely** — 17 not
  representable, 3 expressible and played but not yet shipped, 1 played and held back on a
  ruling (LAB-GROWN EARWORM), and 2 recovered as names with no effect. **Superseded in part:
  all 14 of the inexpressible recovered cards now carry a ruling** (`KNOWN-GAPS.md` §8) — 3
  built, 8 ruled out with an original substitute filed, 2 blocked on a named decision, and 1
  (CHAI-PAANI) ruled never to have been a gap at all.
- **X-card coverage:** Earth 2040 ships 25 of its 35 distinct named cards; India ships 6 of
  the 18 named rows §4 lists. The gap is a schema gap, not a research gap, for everything
  except the Ideology deck.

Three sources would close that, named in
[`docs/AUTHENTIC-SHASN-REFERENCE.md`](docs/AUTHENTIC-SHASN-REFERENCE.md) §2.4: the
**Tabletop Simulator mod on the Steam Workshop** (ships real card art and JSON, and its
filepages are scrapeable); **photo reviews** (Dice Tower, `meeplemountain`, Space Biff, and
BGG galleries on `cf.geekdo-images.com`, which are CDN-hosted and fetchable *without* a
Cloudflare challenge); and **buying the deck** (Essential Edition India 2022-23 — 108 real
cards, and the legally cleanest route). That is the highest-value unfunded research task in
the project.

Three more things to know before showing this to anyone:

- **The payout is on the card, so a player can compute the better side instead of
  deliberating.** That is the accepted cost of the design, not a bug — and it makes
  **dominance in the corpus a broken card rather than a smell**. There is one today:
  `ig-in2020-006`, where one side pays four resources and the other three. See `PLAN.md` §9
  risk #2.
- **No licence has been obtained.** Rules and mechanics are not copyrightable; card
  text, artwork and the *Shasn* name are. The licensing email is still unsent (milestone
  M1.5 in `PLAN.md`), so there is no permission behind any of this.
- **Recovered card text in `docs/AUTHENTIC-SHASN-REFERENCE.md` is research, not
  product.** It is quoted there for interoperability, the same posture
  `docs/rules-reference.md` takes. It is not part of any deck, and shipping it in a
  competing build would be a different act.

Full reasoning: `PLAN.md` §8 and §10, `packages/cards/decks/SOURCES.md` (per-card audit
trail), and `docs/AUTHENTIC-SHASN-REFERENCE.md` §9.

## Project state

- **1088 tests passing across four packages, zero failures; `npm run typecheck` exits 0.**
- **Winnability proven** at 2, 3, 4 and 5 seats over 20 seeds each, real corpus, real
  reducer (`packages/server/test/winnable.test.ts`).
- **~140 local commits, and no git remote configured.** Nothing here has ever left the
  machine, and `npm run check` is the gate instead of CI.
- **Still open:** the card schema cannot express most real Conspiracy/Headline effects
  (`PLAN.md` §9 risk #1, milestone M2b), and M6/M7 are unstarted.

Numbers above are reported from the 2026-10-03 reconciliation pass and were **not re-run by
it**; `PLAN.md`'s ship log records exactly which claims were observed and which were carried
on report.

## Read deeper

| Document | What is in it |
|---|---|
| **[docs/RUNNING.md](docs/RUNNING.md)** | **Start here if something is broken.** Every script and flag, the ports, Postgres, and troubleshooting. |
| **[packages/server/src/FULL-INFORMATION.md](packages/server/src/FULL-INFORMATION.md)** | **Read this before touching the answer screen.** What the full-information change retired, what replaced it, and what it cost the game. |
| [PLAN.md](PLAN.md) | The build plan and the dated ship log — every claim with its evidence, and unverified claims marked as such. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design decisions and rationale, milestone by milestone. §4 is the secret-state contract. |
| [docs/AUTHENTIC-SHASN-REFERENCE.md](docs/AUTHENTIC-SHASN-REFERENCE.md) | Web research on the real game: rules, and the provenance/legal analysis. |
| [docs/UI-SPEC.md](docs/UI-SPEC.md) | Visual and UX specification. **Partially superseded** — opens with a table of what is current and what is retired. |
| [docs/ENGINE-AUDIT.md](docs/ENGINE-AUDIT.md) | Audit of `packages/engine`. A historical document; several of its premises are retired. |
| [docs/rules-reference.md](docs/rules-reference.md) | The rules, for checking the engine against something. |