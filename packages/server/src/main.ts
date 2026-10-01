/**
 * `npm start` / `npm run dev` entry point.
 *
 * Separate from `src/index.ts`, which is the importable server module, so that
 * importing the server in a test does not also bind a port and start printing.
 *
 * RUNS WITH ZERO SETUP. No database, no Docker, no environment variables: the
 * default store is the in-memory one, so `npm start` on a fresh clone gives you a
 * playable server. Postgres is opt-in via `SHASN_DATABASE_URL`, and a failure to
 * reach it is a hard error at boot rather than a silent fall back — a server that
 * thinks it is durable and is not would lose a 4-hour match, which is the exact
 * failure this design exists to prevent.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ShasnServer, loadCtx, type ServerConfig } from './index.ts';
import { InMemoryMatchStore, type MatchStore } from './store.ts';
import { PostgresMatchStore, SCHEMA, type SqlDriver } from './store-postgres.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A `pg`-compatible adapter over whatever driver is installed.
 *
 * Built by duck-typing rather than importing `pg`, because `pg` is not a dependency
 * of this package (see `store-postgres.ts` for why) and a server that cannot start
 * without an optional driver installed is a worse default than one that can.
 * Anything exposing `query(text, params)` returning `{rows}` works.
 */
async function driverFor(url: string): Promise<SqlDriver> {
  const candidates = ['pg', 'postgres'] as const;
  for (const name of candidates) {
    let mod: { default?: unknown };
    try {
      mod = (await import(/* @vite-ignore */ name)) as { default?: unknown };
    } catch {
      continue;
    }
    const ctor = (mod.default ?? mod) as new (u: string) => { query(t: string, p?: readonly unknown[]): Promise<{ rows: unknown[] }> };
    const client = new ctor(url);
    return {
      query: async <T,>(text: string, params?: readonly unknown[]): Promise<{ rows: readonly T[] }> => {
        const r = await client.query(text, params as unknown[] | undefined);
        return { rows: r.rows as T[] };
      },
    };
  }
  throw new Error(
    `SHASN_DATABASE_URL is set but no Postgres driver is installed. Install one of: ${candidates.join(', ')}`,
  );
}

async function buildStore(): Promise<MatchStore> {
  const url = process.env['SHASN_DATABASE_URL'];
  if (url === undefined || url === '') {
    // The default. In-memory, with a loud line in the log so nobody deploys it
    // believing matches are durable.
    console.warn('[shasn] no SHASN_DATABASE_URL — using the in-memory store. MATCHES WILL NOT SURVIVE A RESTART.');
    return new InMemoryMatchStore();
  }
  const sql = await driverFor(url);
  const store = new PostgresMatchStore(sql);
  for (const stmt of SCHEMA.split(';')) {
    const s = stmt.trim();
    if (s !== '') await sql.query(s);
  }
  console.log('[shasn] using the Postgres store');
  return store;
}

async function main(): Promise<void> {
  const clientDir = ['dist', 'src'].map((d) => resolve(REPO, 'packages', 'client', d)).find(existsSync);

  const cfg: ServerConfig = {
    port: num('PORT', 8787),
    host: process.env['HOST'] ?? '0.0.0.0',
    clientDir: process.env['SHASN_CLIENT_DIR'] ?? clientDir ?? null,
    dispatchRate: num('SHASN_DISPATCH_RATE', 4),
    graceMs: num('SHASN_GRACE_MS', 24 * 60 * 60 * 1000),
    ctx: loadCtx(),
    store: await buildStore(),
  };

  const server = new ShasnServer(cfg);
  await server.listen();

  const shutdown = (): void => {
    console.log('[shasn] shutting down');
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(`[shasn] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
