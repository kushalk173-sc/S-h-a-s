#!/usr/bin/env node
/**
 * `npm start` — the production-shaped flow, one process, one URL.
 *
 * Build the client with Vite, then serve the result from the match server so the
 * page and the WebSocket share an origin. That shared origin is not a convenience:
 * `packages/client/src/net/connection.ts:defaultUrl()` derives the socket URL from
 * the page's own origin and falls back to a hardcoded `ws://127.0.0.1:8787/ws`
 * when there is no `location` (i.e. in tests). Same-origin is therefore the only
 * configuration that needs no environment variable and no proxy rule, which is
 * why this is the flow to actually play on.
 *
 * WHY THE STALE-`dist` TRAP IS HANDLED HERE RATHER THAN DOCUMENTED AWAY
 *
 * `packages/server/src/main.ts` picks its static root with
 * `['dist', 'src'].map(...).find(existsSync)` — it serves `packages/client/dist`
 * if that directory exists, and only falls back to `packages/client/src` when it
 * does not. So `dist` is a cache with no invalidation: an agent (or a person) who
 * builds once and then edits client source sees the server happily serve the OLD
 * bundle from the new-looking URL, with no error anywhere. This has already cost
 * this project a debugging session.
 *
 * Two defences, because one is not enough:
 *   - this script always runs a fresh `vite build` first, overwriting `dist`, so
 *     what is served is what is on disk right now; and
 *   - it prints the build's output directory and the served file's mtime, so the
 *     age of what you are about to open is visible rather than inferred.
 *
 * `--skip-build` exists for iterating on server-side code with the client
 * unchanged. It prints a warning that the bundle is being reused and reports the
 * mtime it found, which is the moment to notice you meant to rebuild.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preflight, SERVER_PORT } from './preflight.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(REPO, 'packages', 'client', 'dist');
const IS_WINDOWS = process.platform === 'win32';

const COLOUR = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code) => (s) => (COLOUR ? `\u001b[${code}m${s}\u001b[0m` : s);
const DIM = paint(2);
const BOLD = paint(1);
const GREEN = paint(32);
const RED = paint(31);
const YELLOW = paint(33);

const npmCmd = 'npm';
const stdio = { cwd: REPO, stdio: 'inherit' };

/**
 * Run npm to completion, inheriting this process's stdio so the build and the
 * server's own logs land in the developer's terminal unaltered.
 *
 * On Windows `npm` is a `.cmd` shim that Node will not spawn directly. It goes
 * through `cmd.exe` rather than `shell: true` for two reasons: Node warns
 * (DEP0190) that argv is concatenated unescaped under `shell: true`, and no
 * quoting is needed here because every argument is a literal without spaces.
 * `cmd /d /s /c "npm.cmd ..."` does NOT work — `/s` leaves the quotes in place
 * and cmd then looks for a program literally named `"npm.cmd"`.
 */
function npmInvocation(args) {
  if (IS_WINDOWS) {
    return {
      file: process.env['ComSpec'] ?? 'cmd.exe',
      argv: ['/d', '/c', 'npm.cmd', ...args],
    };
  }
  return { file: npmCmd, argv: args };
}

function run(args, label) {
  process.stdout.write(`${DIM(`▸ ${label}`)}\n`);
  const { file, argv } = npmInvocation(args);
  const r = spawnSync(file, argv, stdio);
  if (r.error !== undefined && r.error !== null) {
    process.stderr.write(`${RED(`${label} failed to start:`)} ${r.error.message}\n`);
    return 1;
  }
  return r.status ?? 1;
}

const skipBuild = process.argv.includes('--skip-build');

// ───────────────────────────────── build ─────────────────────────────────

if (!skipBuild) {
  const code = run(['run', 'build', '--workspace', '@shasn/client'], 'building the client');
  if (code !== 0) {
    process.stderr.write(`\n${RED('Build failed.')} Not starting the server.\n`);
    process.exit(code);
  }
}

if (!existsSync(resolve(DIST, 'index.html'))) {
  process.stderr.write(
    `\n${RED('No client build to serve.')}\n` +
      `  ${resolve(DIST, 'index.html')} does not exist.\n` +
      `  ${DIM('Run `npm run build`, or drop --skip-build.')}\n`,
  );
  process.exit(1);
}

const built = statSync(resolve(DIST, 'index.html'));
const age = Date.now() - built.mtimeMs;
const ageText = age < 90_000 ? 'just now' : `${Math.round(age / 60_000)} min ago`;
if (skipBuild) {
  process.stdout.write(
    `${YELLOW('! --skip-build')} ${DIM(`— reusing packages/client/dist, built ${ageText}`)}\n` +
      `${DIM('  If the client looks stale, this is why.')}\n`,
  );
} else {
  process.stdout.write(`${GREEN('✓')} client built ${DIM(ageText)}\n`);
}

// ───────────────────────────────── serve ─────────────────────────────────

// Only the server port matters here: there is no Vite. Preflight still runs, so
// a stale :8787 holder is named before we try to bind it.
const result = await preflight({ checkPorts: true });
if (!result.ok) {
  process.stderr.write(
    `\n${RED('Not starting.')} Fix the problems above, then try again.\n` +
      `${DIM('Full troubleshooting: docs/RUNNING.md')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\n${BOLD('Digital Shasn')} ${DIM('— serving the built client')}\n\n` +
    `  play at  ${BOLD(`http://localhost:${SERVER_PORT}`)}   ${DIM('one URL: page + socket')}\n` +
    `  health   ${DIM(`http://localhost:${SERVER_PORT}/healthz`)}\n\n` +
    `${DIM('Ctrl-C to stop.')}\n\n`,
);

const { file: serverFile, argv: serverArgv } = npmInvocation(['start', '--workspace', '@shasn/server']);
const child = spawn(serverFile, serverArgv, {
  cwd: REPO,
  detached: !IS_WINDOWS,
  stdio: 'inherit',
});

let done = false;

/**
 * The reaper. Same reasoning as `dev.mjs`: on Windows this process can be killed
 * without any of its JS handlers running, and the server — two levels down, under
 * an npm shim — would survive holding :8787. The watchdog does not care why.
 */
const reaper = spawn(
  process.execPath,
  [
    resolve(REPO, 'scripts', 'reap.mjs'),
    '--parent', String(process.pid),
    '--target', String(child.pid),
  ],
  { cwd: REPO, detached: true, windowsHide: true, stdio: 'ignore' },
);

/**
 * Watch the process that started us, and shut down when it goes.
 *
 * Same reasoning and the same measurements as in `dev.mjs`: on Windows this npm
 * chain does not reliably receive SIGINT, so shutdown must not depend on being
 * asked. `npm run start` exiting, its `cmd.exe` shim being killed, or the terminal
 * closing all look the same from here — the launch is over, so stop.
 */
const LAUNCHER_PID = process.ppid;
let launcherTimer = null;

function launcherAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

if (Number.isInteger(LAUNCHER_PID) && LAUNCHER_PID > 1) {
  launcherTimer = setInterval(() => {
    if (launcherAlive(LAUNCHER_PID)) return;
    process.stdout.write(
      `\n${DIM(`the process that started the server (pid ${LAUNCHER_PID}) has exited — stopping.`)}\n`,
    );
    shutdown(0);
  }, 500);
}

function shutdown(code) {
  if (done) return;
  done = true;
  if (launcherTimer !== null) {
    clearInterval(launcherTimer);
    launcherTimer = null;
  }
  if (reaper.pid !== undefined && reaper.exitCode === null) {
    try {
      reaper.kill();
    } catch {
      /* already gone */
    }
  }
  if (child.pid !== undefined && child.exitCode === null) {
    if (IS_WINDOWS) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => {
  process.stdout.write(`\n${DIM('stopping…')}\n`);
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  if (child.pid !== undefined && child.exitCode === null && IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
});
child.on('exit', (code, signal) => {
  if (done) return;
  shutdown(signal !== null ? 1 : (code ?? 0));
});