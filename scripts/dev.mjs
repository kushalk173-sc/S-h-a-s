#!/usr/bin/env node
/**
 * `npm run dev` — the match server and the Vite dev server, in one terminal.
 *
 * WHY A SCRIPT AND NOT `concurrently`.
 *
 * The obvious build is `npm i -D concurrently && concurrently "a" "b"`. It works
 * on Windows, and I would still rather not, for two reasons that are specific to
 * this repo rather than to taste:
 *
 *   1. A dependency is a version to keep current and a failure mode I do not
 *      control. The whole job here is "start two Node processes, print their
 *      output, and stop both" — roughly thirty lines of `child_process` that have
 *      not changed since Node 8.
 *   2. Ctrl-C behaviour is the thing most likely to bite, and it is the thing a
 *      wrapper is least transparent about. See "SHUTDOWN" below — this script
 *      owns that explicitly instead of hoping.
 *
 * WHAT IT DOES
 *
 * Runs the preflight first, so a wrong Node or an occupied port is a one-line
 * error instead of a blank page. Then starts:
 *
 *   - the match server on PORT (default 8787), with `tsx watch` so an edit to
 *     `packages/server` or `packages/engine` restarts it; and
 *   - Vite on 5174, which proxies `/ws` to 127.0.0.1:8787
 *     (`packages/client/vite.config.ts` — that proxy is load-bearing, read its
 *     comment before touching it).
 *
 * Output from both is prefixed so a line is attributable, and both streams stay
 * readable because the prefixes are written to OUR stdout rather than by wrapping
 * each child's.
 *
 * SHUTDOWN — the part that actually matters on Windows
 *
 * Ctrl-C in a terminal delivers SIGINT to the whole foreground process group on
 * POSIX. On Windows there is no such thing: `node` and `npm` get a CTRL_C_EVENT,
 * the `cmd.exe` shim that npm spawns usually does NOT, and the grandchildren
 * (tsx, vite) are in a different process group again and receive nothing. So a
 * Ctrl-C here leaves a `tsx` holding :8787 and a `vite` holding :5174, and the
 * next `npm run dev` dies on EADDRINUSE with a message about a port rather than
 * about the process you forgot. This repository has already been left in exactly
 * that state by a killed session.
 *
 * The fix has three parts, all in `shutdown()`:
 *   - spawn children in their own process group (`detached`) so we know exactly
 *     which trees belong to us;
 *   - on exit, `taskkill /T /F` that tree on Windows (the `/T` is the part that
 *     reaches the grandchildren `/F` alone would miss) and `kill(-pid)` on POSIX;
 *   - `process.on('exit')` as well as the signal handlers, because an unhandled
 *     rejection or an explicit `process.exit` skips the async signal path.
 *
 * The exit path is idempotent and guarded, so a double Ctrl-C cannot fire two
 * overlapping kills and turn a clean shutdown into a partial one.
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { preflight, SERVER_PORT, CLIENT_PORT } from './preflight.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';

const COLOUR = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
const paint = (code) => (s) => (COLOUR ? `\u001b[${code}m${s}\u001b[0m` : s);
const DIM = paint(2);
const BOLD = paint(1);
const RED = paint(31);
const GREEN = paint(32);

/**
 * The two children.
 *
 * `npm run dev --workspace ...` rather than a direct `node node_modules/tsx/...`
 * so that the script actually invoked is the one in the package's own
 * package.json. If a future agent changes how the server starts, this keeps
 * working instead of pinning a path that no longer reflects reality.
 *
 * `--workspace` (not `-w`) is the long form npm documents; both work, and the
 * long form survives copy-paste better.
 */
const TARGETS = [
  { name: 'server', colour: GREEN, args: ['run', 'dev', '--workspace', '@shasn/server'] },
  { name: 'client', colour: paint(35), args: ['run', 'dev', '--workspace', '@shasn/client'] },
];

const children = [];
let reaper = null;
let shuttingDown = false;

/**
 * Prefix and forward a child's output.
 *
 * Chunk boundaries are not line boundaries — a chunk can end mid-line and the
 * next can continue it — so a trailing partial line is held back until its
 * newline arrives. Without this, a fast-bootstrapping server produces a couple
 * of lines with the prefix in the middle of them. Cheap to do, visibly better.
 */
function forward(stream, name, colour) {
  let held = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const text = held + chunk;
    const parts = text.split('\n');
    held = parts.pop() ?? '';
    for (const line of parts) {
      process.stdout.write(`${colour(DIM(`[${name}]`))} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (held !== '') process.stdout.write(`${colour(DIM(`[${name}]`))} ${held}\n`);
  });
}

/**
 * Spawn npm on the current platform.
 *
 * On Windows `npm` is a `.cmd` shim and Node will not spawn one directly, so it
 * goes through `cmd.exe`. Two details, both learned the hard way:
 *
 *   - NOT `shell: true`. Node warns (DEP0190) that argv is concatenated
 *     unescaped, which is a genuine injection surface the day an argument becomes
 *     dynamic. Routing through `cmd.exe` explicitly produces the same process
 *     tree with no warning.
 *   - NO surrounding quotes. `cmd /d /s /c "npm.cmd run dev"` fails with
 *     `'\"npm.cmd\"' is not recognized as an internal or external command` —
 *     `/s` does not strip those quotes the way it is often assumed to. Every
 *     argument here is a literal with no spaces, so the command line needs none.
 *     `TARGETS` is the only source of these strings; nothing user-supplied ever
 *     reaches it.
 *
 * `/d` skips AutoRun commands a developer may have registered.
 */
function spawnNpm(args, opts = {}) {
  const stdio = opts.stdio ?? ['ignore', 'pipe', 'pipe'];
  if (IS_WINDOWS) {
    const comspec = process.env['ComSpec'] ?? 'cmd.exe';
    return spawn(comspec, ['/d', '/c', 'npm.cmd', ...args], { cwd: REPO, stdio, ...opts.spawn });
  }
  return spawn('npm', args, { cwd: REPO, detached: true, stdio, ...opts.spawn });
}

/**
 * Start the reaper: a detached watchdog that kills both children if this process
 * dies without cleaning up. See `scripts/reap.mjs` for the measurement that
 * motivates it — on Windows the SIGINT handler here does not reliably run, so the
 * guarantee cannot live inside the process that is about to die.
 *
 * Started last, once both children exist, so its `--target` list is complete.
 */
function startReaper() {
  const targets = children.map((c) => String(c.pid)).filter((p) => p !== 'undefined');
  if (targets.length === 0) return;
  reaper = spawn(process.execPath, [
    resolve(REPO, 'scripts', 'reap.mjs'),
    '--parent', String(process.pid),
    ...targets.flatMap((p) => ['--target', p]),
  ], {
    cwd: REPO,
    // Detached on BOTH platforms, and this matters on Windows: libuv maps it to
    // DETACHED_PROCESS, so the reaper gets no console and is therefore deaf to
    // the Ctrl-C that is about to kill us. It must outlive us. `windowsHide`
    // stops that from flashing a window on someone's desktop.
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
}

function start(target) {
  const child = spawnNpm(target.args);

  forward(child.stdout, target.name, target.colour);
  forward(child.stderr, target.name, target.colour);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // One child dying takes the whole thing down. Half a dev environment is a
    // state with no good interpretation: if the server is gone the client's
    // `/ws` proxy fails silently (see the vite.config.ts comment), and if the
    // client is gone the server is holding a port for nobody.
    const how = signal !== null ? `signal ${signal}` : `exit code ${code}`;
    process.stdout.write(
      `\n${RED(`[${target.name}] exited (${how}). Stopping everything.`)}\n`,
    );
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

/** Kill one process tree, synchronously and for real. */
function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (IS_WINDOWS) {
    // /T = the whole tree, /F = no asking. `taskkill` is the only thing on
    // Windows that reliably reaches a `cmd.exe` shim's children.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Is a pid still alive? Signal 0 is the portable existence probe. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to someone else — still alive.
    return err?.code === 'EPERM';
  }
}

/**
 * WATCH THE PROCESS THAT STARTED US.
 *
 * This is the mechanism that actually works on Windows, and it is here because of
 * three separate measurements rather than one guess:
 *
 *   1. A real `CTRL_C_EVENT` broadcast to a real console did NOT terminate this
 *      process, and the "stopping…" line from the SIGINT handler never appeared.
 *   2. The `npm` → `cmd.exe /d /s /c` → `node scripts/dev.mjs` chain sat entirely
 *      untouched by that event while a plain PowerShell on the same console was
 *      killed by it. Whatever the platform is doing with process groups and
 *      console-control flags here, "the child gets SIGINT" is not a safe
 *      assumption on Windows.
 *   3. `process.kill(pid, 'SIGINT')` from another Node process is
 *      `TerminateProcess` on Windows and skips every JS handler.
 *
 * So shutdown cannot be something that happens *because we were asked to*. When
 * the thing that launched us goes away, the launch is over — whether that was
 * Ctrl-C at a shell prompt, a closed terminal, or npm exiting because its own
 * `cmd.exe` shim was killed. Polling for the parent's death covers all three, and
 * needs no cooperation from the platform.
 *
 * The SIGINT handler above stays because it is the clean fast path whenever the
 * signal *is* delivered, and it costs nothing.
 */
const LAUNCHER_PID = process.ppid;
let parentTimer = null;

function watchLauncher() {
  // 1 means "no parent" (or init on POSIX). Nothing to watch.
  if (!Number.isInteger(LAUNCHER_PID) || LAUNCHER_PID <= 1) return;
  parentTimer = setInterval(() => {
    if (alive(LAUNCHER_PID)) return;
    process.stdout.write(
      `\n${DIM(`the process that started dev.mjs (pid ${LAUNCHER_PID}) has exited — stopping.`)}\n`,
    );
    shutdown(0);
  }, 500);
  // Deliberately NOT unref'd: the whole point of this timer is to be alive when
  // the launcher dies. `shutdown()` clears it, so it cannot hold the process
  // open after a clean stop.
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (parentTimer !== null) {
    clearInterval(parentTimer);
    parentTimer = null;
  }
  // The reaper's job is only needed while we are alive. Stop it before we go, so
  // it does not race us to `taskkill` the same trees.
  if (reaper?.pid !== undefined && reaper.exitCode === null) {
    try {
      reaper.kill();
    } catch {
      /* already gone */
    }
  }
  for (const child of children) killTree(child);
  process.exit(code);
}

// Ctrl-C and SIGTERM. On Windows the handler running at all is NOT guaranteed —
// measured: a real CTRL_C_EVENT to a real console terminated this process without
// the "stopping…" line below ever being written. That is precisely why the reaper
// exists. Where the handler does run, this is the fast, clean path.
process.on('SIGINT', () => {
  process.stdout.write(`\n${DIM('stopping…')}\n`);
  shutdown(0);
});
process.on('SIGTERM', () => shutdown(0));
// The synchronous backstop for an unhandled rejection or a stray process.exit().
process.on('exit', () => {
  for (const child of children) killTree(child);
});

// ───────────────────────────────── start ─────────────────────────────────

const result = await preflight({ checkPorts: true });
if (!result.ok) {
  process.stderr.write(
    `\n${RED('Not starting.')} Fix the problems above, then try again.\n` +
      `${DIM('Full troubleshooting: docs/RUNNING.md')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\n${BOLD('Digital Shasn')} ${DIM('— dev')}\n\n` +
    `  open   ${BOLD(`http://localhost:${CLIENT_PORT}`)}   ${DIM('the client (Vite, hot reload)')}\n` +
    `  api    ${DIM(`http://localhost:${SERVER_PORT}/healthz`)}\n` +
    `  socket ${DIM(`ws://localhost:${CLIENT_PORT}/ws  →  proxied to :${SERVER_PORT}`)}\n\n` +
    `${DIM('Use localhost, not 127.0.0.1 — Vite binds ::1 only. See docs/RUNNING.md.')}\n\n` +
    `${DIM('Ctrl-C stops both.')}\n\n`,
);

for (const target of TARGETS) start(target);

// Last, so both children exist and the target list is complete.
startReaper();
watchLauncher();