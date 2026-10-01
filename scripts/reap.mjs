#!/usr/bin/env node
/**
 * The reaper: a watchdog that kills the dev processes if `dev.mjs` dies without
 * getting to clean up.
 *
 * WHY THIS EXISTS — measured, not predicted
 *
 * `scripts/dev.mjs` has a `process.on('SIGINT')` handler that runs
 * `taskkill /T /F` on both process trees. On Windows that handler does not
 * reliably run. This was tested with a real `CTRL_C_EVENT` broadcast to a real
 * console, and the result was:
 *
 *   - the runner exited, but its "stopping…" line never appeared in its own
 *     output, so the handler never executed;
 *   - `tsx` and `vite` survived;
 *   - ports 8787 and 5174 stayed bound by those survivors.
 *
 * The same test also showed `process.kill(pid, 'SIGINT')` from another Node
 * process is not a substitute: on Windows Node turns it into `TerminateProcess`,
 * which skips every JS handler including `process.on('exit')`. So "the parent
 * died" and "the parent's cleanup ran" are genuinely different events on this
 * platform, and only the first one can be relied upon.
 *
 * So the cleanup is moved out of the dying process and into one that is not
 * dying. `dev.mjs` starts this script, detached, with its own pid and the pids
 * to clean up. This process polls for the parent's existence and, the moment
 * the parent is gone, takes the trees down.
 *
 * This makes the guarantee independent of the cause of death: Ctrl-C, the task
 * manager, a session kill, an OOM, or a crash all look the same from here, which
 * is exactly the set of things that have left this repo's ports held.
 *
 * EXIT CONDITIONS, all of them bounded
 *
 *   - the parent is gone            -> reap, then exit 0
 *   - 15 minutes with a live parent  -> exit 0. If nobody has Ctrl-C'd in a
 *     quarter of an hour the runner is not being used, and a watchdog that
 *     outlives its usefulness is a process nobody remembers to kill.
 *   - `reap.mjs` is also told the parent pid explicitly rather than relying on
 *     `process.ppid`, because the reaper is detached and so is NOT the runner's
 *     child — its ppid would be whatever launched the reaper.
 *
 * `--dry-run` reports what it would do and exits immediately; used by the tests
 * and useful when debugging the reaper itself.
 */

import { spawnSync } from 'node:child_process';

const IS_WINDOWS = process.platform === 'win32';
const POLL_MS = 250;
const MAX_LIFETIME_MS = 15 * 60 * 1000;

/**
 * IGNORE Ctrl-C. This is the whole reason the reaper can work.
 *
 * The reaper is spawned onto the same console as the dev runner, so a Ctrl-C
 * aimed at the runner is aimed at the reaper too — and an earlier version of this
 * file was killed by exactly that, leaving the orphans it existed to prevent.
 * Measured: with the default handler, Ctrl-C killed the reaper and both children
 * survived holding 8787 and 5174.
 *
 * A no-op handler makes this process deliberately deaf. It has no terminal, no
 * output and nothing to interrupt: its entire job is to notice the runner is gone
 * and act on it, and being killed by the same event it is watching for defeats
 * that completely. `dev.mjs` also spawns it detached, which is a second,
 * independent layer — but only one of the two has to hold, and this one is the
 * one that does not depend on how the platform routes console events.
 */
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
process.on('SIGHUP', () => {});

function argValues(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]);
  }
  return out;
}

const parentPid = Number(argValues('parent')[0]);
const targets = argValues('target').map(Number).filter((n) => Number.isInteger(n) && n > 0);

if (!Number.isInteger(parentPid) || parentPid <= 0) {
  // Nothing to watch. Exiting non-zero would be noise; there is no caller to
  // report it to, because the whole point of this process is to outlive its
  // parent quietly.
  process.exit(0);
}

if (process.argv.includes('--dry-run')) {
  process.stdout.write(
    `reaper: would watch pid ${parentPid} and kill [${targets.join(', ')}] when it exits\n`,
  );
  process.exit(0);
}

/** Is this pid still alive? Signal 0 is the portable existence probe. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to someone else — still alive.
    return err?.code === 'EPERM';
  }
}

function killTree(pid) {
  if (!alive(pid)) return false;
  if (IS_WINDOWS) {
    // /T reaches the cmd.exe shim's children, which is the entire problem.
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    // The children were spawned detached, so they are their own process groups
    // and the negative pid takes the group.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  return true;
}

/**
 * Sleep without yielding, and without spawning anything.
 *
 * `Atomics.wait` on a shared buffer blocks this thread for real, which is what a
 * poll loop wants: no event loop to keep alive, no timers, no child processes.
 * An earlier version of this slept via `spawnSync(node -e setTimeout)`, which
 * meant spawning a Node process four times a second for the watchdog's entire
 * lifetime — technically a sleep, and an absurd way to buy one.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const deadline = Date.now() + MAX_LIFETIME_MS;

while (Date.now() < deadline) {
  if (!alive(parentPid)) {
    // The runner is gone. Take the trees with it, then leave.
    for (const pid of targets) killTree(pid);
    process.exit(0);
  }
  sleepSync(POLL_MS);
}

process.exit(0);