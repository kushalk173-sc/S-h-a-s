#!/usr/bin/env node
/**
 * The environment check that runs before anything binds a port.
 *
 * The reason this exists is not politeness. Every failure it catches produces a
 * symptom that is indistinguishable from a broken build: a blank page, an empty
 * lobby list, a board that renders but never updates. A developer who cannot
 * tell "my environment is wrong" from "the code is broken" will debug the code,
 * which is the expensive way to be wrong.
 *
 * WHAT IS CHECKED, and why each one earns its place:
 *
 *   1. Node >= the root `engines.node` range. Read from package.json rather than
 *      hardcoded, so the two can never drift. Below it, `tsx` and Vite both fail
 *      in ways that look like syntax errors in our source.
 *   2. Dependencies installed. A missing `node_modules` otherwise surfaces as
 *      `Cannot find module 'ws'`, thrown from inside a workspace, which reads
 *      like a broken import rather than a missing install.
 *   3. The ports, for BOTH loopback families. This is not paranoia: Vite binds
 *      `::1` (IPv6) only, the match server binds `0.0.0.0` (IPv4). A check that
 *      probes only `127.0.0.1` reports the Vite port free while it is occupied,
 *      and then the dev server dies on a `strictPort` EADDRINUSE with no
 *      explanation. Observed on this machine, not theorised.
 *   4. `SHASN_DATABASE_URL`. If it is set, a Postgres driver must be importable
 *      or the server hard-fails at boot. Better to say so here than to have the
 *      server exit one line later with a driver error.
 *
 * Exit code 1 means "do not start". Everything else is a warning.
 *
 * Run standalone for a diagnostic without starting anything:
 *   node scripts/preflight.mjs
 */

import { createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const require_ = createRequire(import.meta.url);

/**
 * The two ports, and what each is for.
 *
 * `SERVER_PORT` is read from PORT so the port can be moved, and the preflight
 * follows it so a conflict is reported against the port actually in use.
 *
 * MEASURED CAVEAT, and the reason this comment exists: `PORT` works for
 * `npm start` (verified on :9000 — page and socket both served from one origin)
 * but it SILENTLY BREAKS `npm run dev`. The Vite dev server's `/ws` proxy target
 * is the literal `ws://127.0.0.1:8787` in `packages/client/vite.config.ts`, with
 * no environment hook, so moving the server leaves the proxy pointing at nothing:
 * the socket hangs up and the game renders empty. Verified — `PORT=9000 npm run
 * dev` binds 9000 and the proxied socket errors with "socket hang up".
 *
 * So: `PORT` is safe for the production-shaped flow. For `npm run dev`, leave it
 * at 8787 unless the proxy target is changed alongside it.
 *
 * `CLIENT_PORT` is NOT configurable at all: it is hardcoded in that same vite
 * config, next to the proxy rule, and the two have to agree. Both numbers are
 * duplicated here deliberately — this is the third place they appear, and the
 * preflight is the only one that can tell you they have drifted apart.
 */
export const SERVER_PORT = Number(process.env['PORT'] ?? 8787);
export const CLIENT_PORT = 5174;

/** Parse `>=20`, `>=20.11 <23`, `20.x` into a predicate. Only `>=` and `>` are honoured. */
function parseEngines(spec) {
  const ranges = String(spec).split(/\s+/).filter(Boolean).map((token) => {
    const m = /^(>=|>|=)?\s*v?(\d+)(?:\.(\d+))?/.exec(token);
    if (m === null) return null;
    return { op: m[1] ?? '>=', major: Number(m[2]), minor: Number(m[3] ?? 0) };
  });
  return {
    raw: String(spec),
    test(version) {
      const [maj, min] = version.split('.').map(Number);
      return ranges
        .filter(Boolean)
        .every((r) => {
          const cur = maj * 1_000_000 + min * 1_000;
          const want = r.major * 1_000_000 + r.minor * 1_000;
          if (r.op === '>') return cur > want;
          if (r.op === '=') return cur === want;
          return cur >= want;
        });
    },
  };
}

/**
 * Colour, but only when a human is watching.
 *
 * `NO_COLOR` (https://no-color.org) and a non-TTY stdout both disable it, so
 * piping this into a file or a CI log gives clean text instead of escape soup.
 */
const COLOUR = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code) => (s) => (COLOUR ? `\u001b[${code}m${s}\u001b[0m` : s);

const RED = paint(31);
const GREEN = paint(32);
const YELLOW = paint(33);
const DIM = paint(2);

/** True when something is already accepting connections on this host:port. */
function probe(host, port, timeoutMs = 700) {
  return new Promise((res) => {
    const sock = createConnection({ host, port });
    let settled = false;
    const done = (inUse, via) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      res({ inUse, via });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true, host));
    sock.once('timeout', () => done(false, null));
    sock.once('error', () => done(false, null));
  });
}

/**
 * Probe both loopback families, because on Windows the two can disagree and a
 * single-family check gives a false "free".
 */
async function portInUse(port) {
  const [v4, v6] = await Promise.all([probe('127.0.0.1', port), probe('::1', port)]);
  const families = [v4.inUse && '127.0.0.1', v6.inUse && '::1'].filter(Boolean);
  return { inUse: families.length > 0, families };
}

let failures = 0;
let warnings = 0;

function fail(label, detail, hint) {
  failures += 1;
  console.log(RED(`✗ ${label}`));
  if (detail) console.log(`  ${detail}`);
  if (hint) console.log(`  ${DIM(hint)}`);
}

function warn(label, detail, hint) {
  warnings += 1;
  console.log(YELLOW(`! ${label}`));
  if (detail) console.log(`  ${detail}`);
  if (hint) console.log(`  ${DIM(hint)}`);
}

function pass(label, detail) {
  console.log(GREEN(`✓ ${label}`) + (detail ? ` ${DIM(detail)}` : ''));
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.checkPorts] Probe the ports. Off when we are only
 *   checking a Node/tooling question (the standalone diagnostic).
 * @returns {Promise<{ok: boolean, failures: number, warnings: number}>}
 */
export async function preflight({ checkPorts = true } = {}) {
  failures = 0;
  warnings = 0;
  console.log(DIM('preflight'));

  // 1. Node version, against the root `engines` field.
  const pkg = JSON.parse(readFileSync(resolve(REPO, 'package.json'), 'utf8'));
  const engines = parseEngines(pkg.engines?.node ?? '>=20');
  const nodeVersion = process.versions.node;
  if (engines.test(nodeVersion)) {
    pass(`node ${nodeVersion}`, `satisfies ${engines.raw}`);
  } else {
    fail(
      `node ${nodeVersion} is too old`,
      `the root package.json requires node ${engines.raw}`,
      'install a newer Node, then re-run. Nothing below will work.',
    );
  }

  // 2. Dependencies present.
  const needed = [
    ['tsx', 'run the server'],
    ['vite', 'run the client dev server'],
    ['ws', 'serve the WebSocket'],
  ];
  const missing = [];
  for (const [name, why] of needed) {
    try {
      require_.resolve(`${name}/package.json`);
    } catch {
      missing.push(`${name} (${why})`);
    }
  }
  if (missing.length === 0) {
    pass('dependencies installed');
  } else {
    fail('dependencies missing', `cannot resolve ${missing.join(', ')}`, 'run: npm install');
  }

  // 3. Ports, both families.
  if (checkPorts) {
    for (const [port, what] of [
      [SERVER_PORT, 'match server  (WebSocket + static)'],
      [CLIENT_PORT, 'client dev server (Vite)'],
    ]) {
      const { inUse, families } = await portInUse(port);
      if (inUse) {
        fail(
          `port ${port} is already in use`,
          `taken on ${families.join(' and ')} — needed by the ${what}`,
          'find and stop the old process: npm run kill-stale',
        );
      } else {
        pass(`port ${port} free`, what);
      }
    }
  }

  // 4. Postgres, only if asked for.
  const dbUrl = process.env['SHASN_DATABASE_URL'];
  if (dbUrl !== undefined && dbUrl !== '') {
    let driver = null;
    for (const name of ['pg', 'postgres']) {
      try {
        require_.resolve(name);
        driver = name;
        break;
      } catch {
        /* try the next */
      }
    }
    if (driver === null) {
      fail(
        'SHASN_DATABASE_URL is set but no Postgres driver is installed',
        `tried: pg, postgres`,
        'npm install pg  — or unset SHASN_DATABASE_URL to use the in-memory store',
      );
    } else {
      pass(`postgres driver: ${driver}`);
    }
  } else {
    pass('store: in-memory', DIM('matches do NOT survive a restart'));
  }

  if (failures > 0) {
    console.log(RED(`preflight failed: ${failures} problem(s)`));
  } else {
    console.log(
      GREEN('preflight ok') + (warnings > 0 ? ` ${DIM(`(${warnings} warning(s))`)}` : ''),
    );
  }
  return { ok: failures === 0, failures, warnings };
}

// Standalone invocation: a diagnostic that starts nothing.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const r = await preflight({ checkPorts: true });
  process.exit(r.ok ? 0 : 1);
}