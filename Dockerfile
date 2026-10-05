# syntax=docker/dockerfile:1

# ONE STAGE, DELIBERATELY. The obvious multi-stage split — build the client with
# Vite, then copy `dist` into a slim runtime that carries only production
# dependencies — does not work for this repository, and it is worth recording why
# so nobody "fixes" it back.
#
# The production start path runs TypeScript directly: `main.ts` imports
# `./index.ts` by explicit `.ts` extension, which is tsx's resolution style, and
# the server's start script is `tsx src/main.ts`
# (packages/server/package.json:14). `tsx` is a **devDependency**. So a runtime
# image built with `--omit=dev` has no way to boot the server at all, and
# converting the server to compiled output is a code change with its own risk
# rather than a packaging decision.
#
# A multi-stage build would therefore still have to carry the full devDependency
# tree into the runtime layer, so it would save nothing while adding a layer
# where a missing file silently produces a 404 instead of a boot failure.
FROM node:20-alpine

WORKDIR /app

# ── dependencies ─────────────────────────────────────────────────────────────
# Manifests only, so this layer is cached until a dependency actually changes.
# The workspace package.json files must each be copied to their real paths
# because npm resolves the `workspaces` globs before it can install anything.
COPY package.json package-lock.json ./
COPY packages/engine/package.json  packages/engine/
COPY packages/cards/package.json   packages/cards/
COPY packages/client/package.json  packages/client/
COPY packages/server/package.json  packages/server/

# `npm ci`, devDependencies INCLUDED — see the note above.
#
# NODE_ENV is deliberately NOT set to production anywhere in this file. npm
# treats NODE_ENV=production as `--omit=dev`, so setting it before this line
# would produce an image with no tsx and no vite and a failure that looks like a
# missing package rather than a missing flag. Nothing reads NODE_ENV anyway:
# the server's entire environment surface is PORT, HOST, SHASN_CLIENT_DIR,
# SHASN_DISPATCH_RATE, SHASN_GRACE_MS and SHASN_DATABASE_URL (main.ts:64-93).
RUN npm ci

# ── source ───────────────────────────────────────────────────────────────────
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages

# The client build has to happen in the image. `.gitignore` excludes
# `packages/client/dist`, so a fresh clone contains no client at all — and
# `main.ts:83` resolves its static root as `['dist', 'src'].find(existsSync)`,
# which would silently fall back to `packages/client/src`, a directory with no
# index.html. The result is a server that boots cleanly, passes `/healthz`, and
# 404s every page request. `scripts/start.mjs:100` exists to catch exactly this,
# and its check is why that fallback must never be what ships.
RUN npm run build

# ── run ──────────────────────────────────────────────────────────────────────
ENV HOST=0.0.0.0

# PORT IS DELIBERATELY NOT SET HERE.
#
# Every PaaS that can run this image assigns its own port at runtime — Render,
# Fly, Railway and Heroku all inject `PORT`, and each routes its health check and
# its proxy at whatever that value is. Baking `ENV PORT=8787` into the image puts
# a second, competing source of truth in the picture, and the failure mode is
# silent and nasty: the container answers on 8787, the platform waits on 10000,
# and the deploy fails its health check with the app reporting itself healthy in
# its own logs.
#
# The default already lives in exactly one place — `num('PORT', 8787)` in
# packages/server/src/main.ts:86 — so leaving PORT unset gives you 8787 on a
# laptop and the platform's port in the cloud, with no override to reconcile.
EXPOSE 8787

# tsx is PID 1 so SIGTERM reaches the server's own handler
# (packages/server/src/main.ts:98-103) directly. Not `npm start`: that path
# goes through scripts/start.mjs, which spawns the server under an npm shim and
# wraps it in a reaper (scripts/reap.mjs) plus a parent-PID watchdog, both built
# for a terminal session. Under a container runtime that process tree only gets
# between the signal and the socket close, and the connections go ungracefully.
#
# No healthcheck: the app already exposes GET /healthz (index.ts:323), and a
# container HEALTHCHECK here would be checked against a port the platform has
# already been told about.
CMD ["./node_modules/.bin/tsx", "packages/server/src/main.ts"]