#!/usr/bin/env node
/**
 * `npm run kill-stale` — stop whatever is holding the dev ports.
 *
 * WHY THIS IS A SCRIPT AND NOT A DOCUMENTED `taskkill` LINE.
 *
 * The preflight names this command when it finds a port occupied, so it has to
 * exist and it has to be right. The manual version of this is
 * `netstat -ano | findstr :8787`, read the PID, then `taskkill /F /PID <n>` — and
 * the manual version is wrong in a specific way: it kills the PID holding the
 * port without checking what that PID is. If the developer left a Postgres on
 * 5432 and mistyped a port, or if an unrelated app grabbed 8787, this script
 * refuses to touch it, because the only thing that makes it safe is that it
 * verifies the process is actually one of ours before signalling it.
 *
 * The test is deliberately narrow — the command line must mention this repo AND
 * one of our dev entry points (`vite`, `tsx`, `src/main.ts`). "Mentions the repo"
 * alone would match an editor's language server; "mentions vite" alone would
 * match an unrelated project's Vite on another drive. Both together is
 * conservative, and being conservative here only costs a manual kill.
 *
 * `--dry-run` prints what it would do and exits 0 without signalling anything.
 */

import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

import { SERVER_PORT, CLIENT_PORT } from './preflight.mjs';

const IS_WINDOWS = process.platform === 'win32';
const DRY_RUN = process.argv.includes('--dry-run');

const COLOUR = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code) => (s) => (COLOUR ? `\u001b[${code}m${s}\u001b[0m` : s);
const DIM = paint(2);
const RED = paint(31);
const GREEN = paint(32);
const YELLOW = paint(33);

/** "Does this command line look like it is one of our dev processes?" */
function isOurs(commandLine) {
  if (typeof commandLine !== 'string' || commandLine === '') return false;
  const cl = commandLine.toLowerCase();
  const repoish = cl.includes('shasn');
  const oursMarker =
    cl.includes('vite') || cl.includes('tsx') || cl.includes('src\\main.ts') || cl.includes('src/main.ts');
  return repoish && oursMarker;
}

/** pids listening on a port, per platform. */
function pidsOnPort(port) {
  if (IS_WINDOWS) {
    // `netstat -ano`, and DELIBERATELY not `netstat -ano -p TCP`.
    //
    // Observed on this machine (Windows): `netstat -ano -p TCP` does not report
    // IPv6 listeners at all, while `netstat -ano` does. The Vite dev server binds
    // `::1` only, so the `-p TCP` form reported port 5174 free while Vite was
    // holding it — which would have made this script silently useless for exactly
    // the port it exists to clear. `netstat -ano` lists IPv4 and IPv6 together;
    // the `LISTENING` state filter is what separates TCP from the UDP noise.
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port}`)) continue;
      if (!/\sLISTENING\s/i.test(line)) continue;
      const cols = line.trim().split(/\s+/);
      const pid = cols[cols.length - 1];
      if (pid !== undefined && /^\d+$/.test(pid)) pids.add(Number(pid));
    }
    return [...pids];
  }
  // POSIX: no netstat -ano. Ask the shell for the table.
  try {
    const out = execFileSync('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true`], {
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number);
  } catch {
    return [];
  }
}

function commandLineFor(pid) {
  if (IS_WINDOWS) {
    try {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: 'utf8', timeout: 10_000 },
      );
      return out.trim();
    } catch {
      return null;
    }
  }
  try {
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

let killed = 0;
let refused = 0;

for (const port of [SERVER_PORT, CLIENT_PORT]) {
  const pids = pidsOnPort(port);
  if (pids.length === 0) {
    process.stdout.write(`${GREEN('✓')} port ${port} ${DIM('free')}\n`);
    continue;
  }
  process.stdout.write(`${YELLOW('!')} port ${port} ${DIM(`held by pid ${pids.join(', ')}`)}\n`);

  for (const pid of pids) {
    const cl = commandLineFor(pid);
    if (!isOurs(cl)) {
      refused += 1;
      process.stdout.write(
        `  ${RED('refusing')} ${DIM(`pid ${pid} is not a Shasn dev process — leaving it alone.`)}\n` +
          `    ${DIM(String(cl ?? '(command line unavailable)').slice(0, 140))}\n` +
          `    ${DIM('Stop it yourself, or move the server: PORT=… (works for `npm start`; for `npm run dev` the Vite /ws proxy target is fixed at 8787)')}\n`,
      );
      continue;
    }

    if (DRY_RUN) {
      process.stdout.write(`  ${DIM(`would kill pid ${pid}`)}\n    ${DIM(String(cl).slice(0, 140))}\n`);
      continue;
    }

    const r = IS_WINDOWS
      ? spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { encoding: 'utf8' })
      : spawnSync('kill', ['-TERM', String(pid)], { encoding: 'utf8' });
    if (r.status === 0) {
      killed += 1;
      process.stdout.write(`  ${GREEN('killed')} pid ${pid}\n`);
    } else {
      refused += 1;
      process.stdout.write(
        `  ${RED('could not kill')} pid ${pid} ${DIM(String(r.stdout ?? r.stderr ?? '').trim())}\n`,
      );
    }
  }
}

if (DRY_RUN) {
  process.stdout.write(`\n${DIM('dry run — nothing was signalled.')}\n`);
} else if (killed > 0) {
  process.stdout.write(`\n${GREEN(`stopped ${killed} process(es).`)} ${DIM('npm run dev should start now.')}\n`);
} else if (refused === 0) {
  process.stdout.write(`\n${GREEN('nothing to stop.')}\n`);
}

process.exit(refused > 0 ? 1 : 0);