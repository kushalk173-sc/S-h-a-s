# Digital Shasn

A server-authoritative online multiplayer implementation of Shasn: players sit at a
shared political board, are dealt hidden cards, and answer them blind.

The point of the design is that **the client never receives a card's payout, or any
player's hidden hand.** The server holds the whole game, strips the answer from
everything it sends, and a build-time gate fails the build if that ever changes. See
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
| `@shasn/server` | The authoritative match server: a WebSocket server on `ws` (boardgame.io is deliberately not used — its history persists the answer key). Also serves the built client. |
| `@shasn/client` | The React board. Purely presentational; it imports nothing from the engine, not even as a value. |

**The one fact that matters most:** the client is never told an answer. Cards are
dealt and resolved server-side, each player's `conspiracies` hand is stripped before
anything crosses the wire, and every draw and discard pile plus the RNG seed stay
server-only. `packages/server/scripts/check-secrets.mjs` greps for those field names
and for any read of a `_`-prefixed field outside the single exit to the wire, and it
runs as part of `npm run typecheck` — so violating the rule fails the build rather
than shipping.

## Cards, provenance and licensing

The shipped decks are **original work**, written against the mechanics but not copied
from any published card. Counted off the deck files by `npm run validate`:
**64 cards — 0 verbatim, 19 adapted, 45 inferred.** Zero verbatim is the deliberate
invariant, not an accident.

Two things to know before showing this to anyone:

- **No licence has been obtained.** Rules and mechanics are not copyrightable; card
  text, artwork and the *Shasn* name are. The licensing email is still unsent (milestone
  M1.5 in `PLAN.md`), so there is no permission behind any of this.
- **Recovered card text in `docs/AUTHENTIC-SHASN-REFERENCE.md` is research, not
  product.** It is quoted there for interoperability, the same posture
  `docs/rules-reference.md` takes. It is not part of any deck, and shipping it in a
  competing build would be a different act.

Full reasoning: `PLAN.md` §8 and `docs/AUTHENTIC-SHASN-REFERENCE.md` §9.

## Read deeper

| Document | What is in it |
|---|---|
| **[docs/RUNNING.md](docs/RUNNING.md)** | **Start here if something is broken.** Every script and flag, the ports, Postgres, and troubleshooting. |
| [PLAN.md](PLAN.md) | The build plan and the dated ship log — every claim with its evidence, and unverified claims marked as such. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design decisions and rationale, milestone by milestone. |
| [docs/AUTHENTIC-SHASN-REFERENCE.md](docs/AUTHENTIC-SHASN-REFERENCE.md) | Web research on the real game: rules, and the provenance/legal analysis. |
| [docs/UI-SPEC.md](docs/UI-SPEC.md) | Visual and UX specification. |
| [docs/ENGINE-AUDIT.md](docs/ENGINE-AUDIT.md) | Audit of `packages/engine`. |
| [docs/rules-reference.md](docs/rules-reference.md) | The rules, for checking the engine against something. |