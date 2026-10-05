# Running Digital Shasn

Everything needed to run, configure and debug the game locally. For the short
version, see the [README](../README.md).

Every command, port and flag below was run on Windows (PowerShell 5.1) with Node
24.13.0 / npm 11.6.2. Where something could not be verified here, it says so rather
than asserting it.

- [The two processes](#the-two-processes)
- [Commands](#commands)
- [Ports](#ports)
- [The preflight check](#the-preflight-check)
- [Shutdown, and why Ctrl-C needed help](#shutdown-and-why-ctrl-c-needed-help)
- [Using Postgres instead of the in-memory store](#using-postgres-instead-of-the-in-memory-store)
- [Troubleshooting](#troubleshooting)
- [Verifying a clean checkout](#verifying-a-clean-checkout)

---

## The two processes

A human playing locally needs two Node processes:

- the **match server** — WebSocket endpoint plus static file serving, `packages/server`
- the **client** — a Vite dev server in development, or a static bundle in production

In development they are separate and the client's WebSocket has to be *proxied* to
the server, because the page is served from a different port than the socket. In the
production-shaped flow they are one process on one port, which is why that flow needs
no proxy and no configuration: the client derives its socket URL from the page's own
origin (`packages/client/src/net/connection.ts`).

`npm run dev` starts both for you. Do not start them by hand unless you are debugging
the runner itself.

## Commands

All of these are run from the repository root.

### `npm run dev`

```sh
npm run dev
```

Runs the preflight, then starts the match server (`tsx watch src/main.ts`, so edits
under `packages/server` or `packages/engine` restart it) and the Vite dev server.
Output from both is prefixed `[server]` / `[client]`, with partial lines buffered so a
prefix never lands mid-line.

- Client: <http://localhost:5174>
- Health: <http://localhost:8787/healthz>
- Socket: `ws://localhost:5174/ws`, proxied by Vite to `ws://127.0.0.1:8787`

Ctrl-C stops both — see [Shutdown](#shutdown-and-why-ctrl-c-needed-help).

### `npm start`

```sh
npm start                  # build the client, then serve everything from :8787
npm start -- --skip-build  # reuse the existing dist, and print how old it is
```

Builds the client with Vite, then serves `packages/client/dist` from the game server.
One URL, no Vite, page and socket on the same origin. **This is the flow to actually
play on** — it is shaped like a deployment, so anything that only misbehaves under Vite
shows up here.

`--skip-build` exists for iterating on server-side code with the client unchanged. It
prints the age of the bundle it is reusing, which is the moment to notice you meant to
rebuild. See [the stale-`dist` trap](#the-game-is-serving-a-stale-dist).

### `npm run build`

```sh
npm run build
```

`vite build` into `packages/client/dist`. Runs automatically as part of `npm start`;
you only need it directly when you want the artifacts without serving them.

### `npm run check`

```sh
npm run check
```

`npm run typecheck` followed by `npm test`, across every workspace. Run this before
committing. The server's `typecheck` also runs `scripts/check-secrets.mjs`, the gate
described in the README, so a secret-field leak fails here rather than at review.

### `npm run typecheck` and `npm test`

Unchanged, and still fan out across workspaces via `--workspaces --if-present`:

```sh
npm run typecheck
npm test
```

### `npm run preflight`

```sh
npm run preflight
```

Runs every environment check and exits non-zero if any failed, without starting
anything. See below.

### `npm run kill-stale`

```sh
npm run kill-stale
npm run kill-stale -- --dry-run
```

Stops whatever is holding ports 8787 / 5174. It **verifies the process actually belongs
to this repo before signalling it** — the command line must mention this repo *and*
one of `vite` / `tsx` / `src/main.ts`. An unrelated process on 8787 is reported and
left alone:

```
! port 8787 held by pid 53848
  refusing pid 53848 is not a Shasn dev process — leaving it alone.
    "C:\Program Files\nodejs\node.exe" -e require('http')...
```

Exit code is 1 if it had to refuse something, so it doubles as a check.

## Ports

| Port | Process | Configurable? |
|---|---|---|
| 8787 | match server — WebSocket, `/healthz`, `/lobbies`, static client | yes, via `PORT` |
| 5174 | Vite dev server | no — hardcoded in `packages/client/vite.config.ts` |

Both are `strictPort`/fixed on purpose. Silently drifting to another port is worse
than refusing to start: you get a server that boots fine and is unreachable.

**The WebSocket endpoint is always `/ws`, on whichever port serves the page.**

### `PORT` moves the server — but not in dev

`PORT=9000 npm start` works: verified serving the page and the socket from
`http://localhost:9000`.

`PORT=9000 npm run dev` **silently breaks the game.** The Vite `/ws` proxy target is
the literal `ws://127.0.0.1:8787` in `packages/client/vite.config.ts`, with no
environment hook, so the server moves and the proxy keeps pointing at nothing. The
observed symptom is a socket that errors with `socket hang up` and a lobby that looks
empty — no error toast, no console error. Verified.

So leave `PORT` alone for `npm run dev` unless you change the proxy target at the same
time. The preflight follows `PORT`, so it will check and report the right port; it
cannot detect the proxy mismatch for you, because the mismatch is a literal in
another package.

### `SHASN_CLIENT_DIR`

Overrides which directory the server serves statically. Defaults to
`packages/client/dist` if it exists, otherwise `packages/client/src`. Rarely needed —
`SHASN_CLIENT_DIR` pointing at a directory containing an `index.html` is enough.

## The preflight check

`npm run dev`, `npm start` and `npm run preflight` all run it first and **refuse to
start** on failure. Every failure it reports otherwise presents to a developer as a
blank page or an empty lobby — indistinguishable from a broken build, which is what
makes them expensive to diagnose from symptoms.

What it checks:

1. **Node version**, parsed from the root `package.json` `engines` field rather than
   hardcoded, so the two cannot drift. Below the range, `tsx` and Vite fail in ways
   that look like syntax errors in our source.
2. **Dependencies installed** — that `tsx`, `vite` and `ws` resolve. Otherwise you get
   `Cannot find module 'ws'` thrown from inside a workspace, which reads like a broken
   import rather than a missing install.
3. **Ports 8787 and 5174 are free, probing `127.0.0.1` *and* `::1`.** This is not
   paranoia. Vite binds `::1` only and the server binds `0.0.0.0`; a check that probes
   only IPv4 reports the Vite port free while Vite is holding it, and the dev server
   then dies on `strictPort` with no explanation.
4. **`SHASN_DATABASE_URL`** — if set, that a `pg`-compatible driver is importable. The
   server hard-fails at boot otherwise, so it is better to say so up front.

Sample failure, exit code 1, nothing started:

```
preflight
✓ node 24.13.0 satisfies >=20
✓ dependencies installed
✗ port 8787 is already in use
  taken on 127.0.0.1 and ::1 — needed by the match server  (WebSocket + static)
  find and stop the old process: npm run kill-stale
✓ port 5174 free  client dev server (Vite)
✓ store: in-memory  matches do NOT survive a restart
preflight failed: 1 problem(s)
```

`NO_COLOR=1`, or piping to a file, gives plain text without escape codes.

## Shutdown, and why Ctrl-C needed help

**Verified: Ctrl-C leaves no orphan processes.** Killing the process a terminal Ctrl-C
reaches released both ports in about a second, with no surviving `dev.mjs`, `tsx`,
`vite` or reaper.

Getting there took three layers, because two of the obvious ones do not work on
Windows. This is written down because the failure is invisible until it strands you:

1. `process.on('SIGINT')` calling `taskkill /T /F` on both trees. This is the clean fast
   path and it is still there — but it is **not** guaranteed to run. A real
   `CTRL_C_EVENT` broadcast to a real console terminated `scripts/dev.mjs` with the
   handler's own "stopping…" line never appearing in its output.
2. `process.on('exit')`, for unhandled rejections and stray `process.exit()` calls.
   Note that on Windows `process.kill(pid, 'SIGINT')` from another process is
   `TerminateProcess` and skips **both** handlers.
3. **A watchdog and a parent poll**, because neither handler can be relied on:
   - `scripts/reap.mjs` is spawned detached, deaf to console events, and kills both
     process trees within ~250 ms of `dev.mjs` dying for *any* reason. It also exits by
     itself after a quarter of an hour, so it cannot outlive its usefulness.
   - `scripts/dev.mjs` polls the process that launched it. When the launcher is gone the
     run is over, whether that was Ctrl-C at a prompt, a closed terminal, or npm
     exiting because its own shim was killed.

So if you ever *do* find 8787 or 5174 held after a crash, a session kill, or a force
quit, `npm run kill-stale` is the intended way out — not a workaround.

## Using Postgres instead of the in-memory store

The default store is **in-memory**. Matches do not survive a restart, and the server
says so on every boot:

```
[shasn] no SHASN_DATABASE_URL — using the in-memory store. MATCHES WILL NOT SURVIVE A RESTART.
```

To use Postgres:

1. Install a driver. The server duck-types anything exposing
   `query(text, params) → {rows}`; `pg` and `postgres` are both accepted.

   ```sh
   npm install pg
   ```

2. Point it at a database. **PowerShell:**

   ```powershell
   $env:SHASN_DATABASE_URL = "postgres://user:pw@localhost:5432/shasn"
   npm start
   ```

   **bash / zsh:**

   ```sh
   SHASN_DATABASE_URL="postgres://user:pw@localhost:5432/shasn" npm start
   ```

   The schema is created for you on boot — `SCHEMA` in
   `packages/server/src/store-postgres.ts` is executed statement by statement. You do
   not need a migration step.

With the URL set and no driver installed, the server refuses to start rather than
quietly falling back — a server that believes it is durable and is not would lose a
four-hour match, which is the failure this design exists to prevent. Verified:

```
[shasn] failed to start: SHASN_DATABASE_URL is set but no Postgres driver is installed. Install one of: pg, postgres
```

The preflight reports the same problem before the server is even launched.

> **Not verified here:** this environment has neither a `pg` driver nor a Postgres
> server, so the schema creation and a real round trip against Postgres have **not**
> been exercised. What *is* verified is the URL plumbing, the driver-absent failure,
> and that the preflight predicts it. The `pg` install is one `npm install` away from
> a real test.

## Troubleshooting

### Use `localhost`, not `127.0.0.1`

`http://127.0.0.1:5174` is **refused** while `http://localhost:5174` returns 200. Vite
binds IPv6 loopback (`::1`) only, so on a machine where `localhost` resolves to `::1`
you must use the name. Verified on Windows. The production flow (`:8787`) is bound to
all interfaces and does not have this asymmetry.

### The game is silently empty — no error anywhere

The lobby renders, the OPEN ROOMS list is empty or stale, and buttons appear to do
nothing. No toast, no console error. This is the WebSocket failing to connect, and the
client is quiet about it by design: `Connection#onerror` is empty and `onclose`
schedules a silent retry with backoff.

Check, in order:

1. **Is the server actually up?** `curl http://localhost:8787/healthz` → `{"ok":true}`.
2. **Are you on the right port?** In dev the page is on 5174 but the socket goes through
   Vite's `/ws` proxy to 8787. If you opened the page on some other port, or served
   `dist` statically without the server, there is no `/ws` endpoint at all.
3. **Are you in dev with a moved port?** See [`PORT` moves the server](#port-moves-the-server--but-not-in-dev).
   `PORT=9000 npm run dev` produces exactly this symptom.

To confirm the socket is alive independently of the browser:

```sh
node -e "const{createRequire}=require('module');const W=createRequire(process.cwd()+'/')('ws');\
const w=new W('ws://localhost:5174/ws');\
w.on('open',()=>w.send(JSON.stringify({t:'lobby:list'})));\
w.on('message',d=>{console.log('OK:',JSON.parse(String(d)).t);process.exit(0)});\
w.on('error',e=>{console.log('FAIL:',e.message);process.exit(1)})"
```

Expect `OK: lobby:list`. Change the port to `8787` for the production flow.

### The game is serving a stale `dist`

**This has already cost this project a debugging session, so read this one.**

The server picks its static root like this (`packages/server/src/main.ts`):

```js
const clientDir = ['dist', 'src'].map((d) => resolve(REPO, 'packages', 'client', d)).find(existsSync);
```

`dist` is preferred whenever it exists, and it is a cache with **no invalidation**.
Build once, then edit client source and run `npm start`, and the server cheerfully
serves the old bundle from a new-looking URL with no error anywhere. Meanwhile
`npm run dev` shows you your changes — so the two flows disagree, which is the most
misleading possible symptom.

How to tell:

- **The asset filename is the tell.** Vite hashes filenames, so a stale bundle has an
  old hash. Compare what the page asks for against what is on disk:

  ```powershell
  (Select-String -Path packages/client/dist/index.html -Pattern 'assets/[^"]+\.js' -AllMatches).Matches.Value
  Get-ChildItem packages/client/dist/assets/*.js | Select-Object Name, LastWriteTime
  ```

- `npm start` prints the age of what it is about to serve (`client built just now`, or
  `min ago`), and `--skip-build` says outright that it is reusing `dist`.
- If in doubt, `npm start` without `--skip-build` always rebuilds and overwrites.

There is no dev-server equivalent: `npm run dev` compiles from `src` on every request,
so Vite cannot serve you a stale bundle. If you think you are seeing stale client code
in dev, you are almost certainly looking at the wrong port — you have `:8787` open in
another tab.

### `EADDRINUSE`, or "port 8787 is already in use"

Something is holding the port. Find out what before killing anything:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen | Format-Table LocalAddress, OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object Name, CommandLine
```

Then either `npm run kill-stale` (safe — it checks the process is one of ours) or stop
it yourself. A killed agent or a force-quit terminal is the usual cause.

### Blank board, but the server is fine

Work down the chain rather than guessing:

1. `http://localhost:5174/healthz`-equivalent for the client: does `GET /` return the
   HTML? In dev, also try `GET /src/main.tsx` — if that 404s, Vite is serving from the
   wrong root.
2. **Is the JavaScript erroring?** Open devtools → Console. The most common cause is a
   WebSocket that never connects (above), which the UI renders as a dead board rather
   than an error.
3. In the production flow, check the served `index.html` references an asset that
   actually exists in `dist/assets/`. A 404 there means the `dist` on disk is not the
   `dist` being served — see the stale-`dist` section.

### The client and the server disagree about which client is running

Expected, and it is the stale-`dist` trap in another shape: `npm run dev` serves from
`src`, `npm start` serves `dist`. Two tabs on different ports are two different
clients. Close one.

### The server restarted repeatedly while I was editing

`tsx watch` restarts on any change under `packages/server` **or `packages/engine`**,
and it follows those imports into `packages/cards`. Editing a card file restarts the
server. This is correct — it is picking up a changed dependency — but it means a
synchronous edit loop can restart the server mid-test and lose an in-memory match.

## Verifying a clean checkout

This is the procedure used to verify the quickstart, run against a fresh `git clone`
rather than a working tree:

```sh
git clone <repo> shasn-clean
cd shasn-clean
npm ci
npm run preflight
npm run typecheck
npm test
npm start          # then open http://localhost:8787
```

`npm ci` is required, not optional — a fresh clone has no `node_modules`, and the
preflight will tell you so rather than letting you find it via `Cannot find module`.

**A fresh clone has no `packages/client/dist`** (`dist/` is gitignored), which is why
`npm start` builds before serving. Verified: on a bare clone, `npm start` built the
client, served the page at `:8787`, and completed a WebSocket lobby round trip.

What passed on the clean clone used for this documentation:

| Step | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run preflight` | exit 0, all five checks pass |
| `npm run typecheck` | exit 0, secret gate clean |
| `npm test` | exit 0, all workspaces pass |
| `npm start` → `GET /` | 200, and a WebSocket lobby round trip on `:8787` |
| `npm run dev` → `GET /` on `:5174` | 200, and a WebSocket round trip through the `/ws` proxy |

To verify the dev flow specifically:

```sh
npm run dev
```

Then, in another shell: `GET http://localhost:5174/` should return the HTML, and the
WebSocket check above should print `OK: lobby:list`. Then Ctrl-C and confirm both
ports are free:

```powershell
Get-NetTCPConnection -LocalPort 8787,5174 -State Listen
```

No rows means a clean shutdown. If there are rows, `npm run kill-stale`.

### Card data

The corpus has its own checks, run per-workspace and worth running after touching any
deck file:

```sh
npm run validate --workspace @shasn/cards   # exits 1 on any schema error
npm run balance  --workspace @shasn/cards   # exits 1 on any dominance error
npm run balance --workspace @shasn/cards -- --strict   # warnings too
```

`validate` also prints the provenance census. **⚠ Two earlier counts were stale as of
2026-10-03** (`verbatim 0, adapted 19, inferred 45` over 64 cards, then `0 / 41 / 110` over
151); both are left in the record above as history. **The corpus is 222 cards — 0
`verbatim`, 45 `adapted`, 177 `inferred`**, of which **134 are Ideology Cards** (92
`in2020` + 42 `et2040`), plus 18 Voter, 31 Conspiracy and 39 Headline. Counted off
`"id"` and `"provenance"` in `decks/**/*.json`; `decks/SOURCES.md` §3 and §7 carry the same
census and the per-card audit trail. **`npm run playable` reports three verdicts, not one** —
EXPRESSIBLE / IN THE CORPUS / SHIPPED AS AUTHORED — and prints its own denominator beside
them. **Trust the commands' own output over this sentence.** See
`packages/cards/README.md` and `packages/cards/KNOWN-GAPS.md`.

> **One line to add to your reading of `balance` output, 2026-10-03.** The game is now
> **full information** — both of a card's payouts are printed on the card before anyone
> answers (`packages/server/src/FULL-INFORMATION.md`). **A `TOTAL_SKEW` or
> `RESOURCE_BLIND_LEAN` warning is therefore no longer cosmetic.** It used to be tolerable
> precisely because the player could not see the difference; now they can, and
> `PLAN.md` §9 risk #2 explains why that turns a dominated card into a broken one. **The
> checker's severities have not been re-tuned yet, so `--strict` is currently the honest
> setting to read this with.**