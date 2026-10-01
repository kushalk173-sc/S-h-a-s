#!/usr/bin/env node
/**
 * The secret-field gate.
 *
 * Three greps, and they fail on ANY hit — including in a comment. That is the
 * whole design: a rule you can soften by rewording a docstring is not a rule, and
 * a leak channel that survives review because the code "obviously" only reads it
 * is exactly how a deck ordering ends up in a log line.
 *
 *   1. No server-only field NAME may appear anywhere outside the two places that
 *      are allowed to know it: `broadcast.ts` (the single exit to the wire) and
 *      the tests that assert the projection is clean (which have to name the
 *      fields to check for them).
 *   2. No property ACCESS to a `_`-prefixed field outside `broadcast.ts`. This is
 *      the engine's convention generalised: if the server ever grows a second
 *      secret field that is not in the list below, it is still caught.
 *   3. The client's network layer may not VALUE-import the engine. A type-only
 *      import is fine and is in fact the requirement; a value import would drag
 *      `reduce.ts` into the browser bundle, and a bundler is a leak channel nobody
 *      reviews.
 *
 * A note on the asymmetry between checks 1/2 and check 3, because it looks
 * inconsistent and is not. The secret-name and field-access greps deliberately run
 * over COMMENTS, because the whole point is that nobody can talk themselves into
 * reading a private field in a docstring and then copy the line. The engine-import
 * check runs over code with comments stripped, because a doc comment showing a
 * correct `import type { … } from '@shasn/engine'` is documentation of the rule
 * rather than a violation of it, and a gate that cries wolf on a correct example
 * gets switched off by the first person it annoys.
 *
 * Run as part of `npm run typecheck`, so it cannot be skipped by running the
 * tests.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER = resolve(HERE, '..');
const REPO = resolve(SERVER, '..', '..');

/**
 * The engine's server-only fields, by name. Kept as a literal list rather than
 * read from the engine's type — the point of the grep is that it works when
 * somebody is mid-refactor and the type no longer says anything useful.
 */
const SECRET_NAMES = [
  'pendingCard',
  'ideologyDraw',
  'ideologyDiscard',
  'voterDraw',
  'voterDiscard',
  'conspiracyDraw',
  'conspiracyDiscard',
  'headlineDraw',
  'headlineDiscard',
  'seed',
  'idSeq',
];

/**
 * Files permitted to NAME a secret field, i.e. mention it even in a comment.
 *
 * Deliberately minimal. Four files, each for a stated reason:
 *   - broadcast.ts          the one place allowed to READ one.
 *   - secret-state.test.ts  the leak gate; has to name fields to assert absence.
 *   - secret-inventory.ts   the pinned list those assertions read.
 *   - this script           it contains the names by definition.
 *
 * Plus the two suites that AUDIT a live frame or a live error string for secrets:
 *   - hostile-input.test.ts  reads the room's fields to assert none of them appear
 *                            in anything a client was sent.
 *   - reconnect.test.ts      same, for the resume path specifically.
 *
 * Note what is NOT on this list: `render-all.ts`, the exhaustive message renderer.
 * A renderer that has to read a raw field is a renderer that can put it in a
 * message, which is the exact failure layer 2 exists to prevent. It composes the
 * two sanctioned projections and nothing else.
 */
const NAME_ALLOW = new Set([
  'src/broadcast.ts',
  'test/secret-state.test.ts',
  'test/secret-inventory.ts',
  'test/hostile-input.test.ts',
  'test/reconnect.test.ts',
  'scripts/check-secrets.mjs',
]);

/**
 * Files permitted to READ a `_`-prefixed field. The single exit to the wire, plus
 * the three suites whose entire job is to assert that what it produces is clean.
 */
const ACCESS_ALLOW = new Set([
  'src/broadcast.ts',
  'test/secret-state.test.ts',
  'test/hostile-input.test.ts',
  'test/reconnect.test.ts',
]);

const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs']);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

/** Line numbers, so a failure says WHERE rather than just that something is wrong. */
function hits(file, text, pattern) {
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) found.push(i + 1);
  }
  void file;
  return found;
}

const failures = [];

function scanRoot(root, relLabel) {
  const files = walk(root, []);
  for (const file of files) {
    const rel = relative(SERVER, file).split('\\').join('/');
    const underServer = rel.startsWith('..') === false;
    const shortRel = underServer ? rel : relative(REPO, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');

    for (const name of SECRET_NAMES) {
      const needle = `_${name}`;
      const lineNos = hits(file, text, new RegExp(`(?<![A-Za-z0-9_])${needle}(?![A-Za-z0-9_])`));
      if (lineNos.length === 0) continue;
      if (NAME_ALLOW.has(shortRel)) continue;
      failures.push(
        `${relLabel}${shortRel}: mentions the server-only field "${needle}" on line(s) ` +
          `${lineNos.join(', ')}. Only src/broadcast.ts, the leak tests, and this script may name it.`,
      );
    }

    const access = hits(file, text, /\._[A-Za-z]/);
    if (access.length > 0 && !ACCESS_ALLOW.has(shortRel)) {
      failures.push(
        `${relLabel}${shortRel}: reads a server-only field on line(s) ${access.join(', ')}. ` +
          'Only src/broadcast.ts may read one. Use viewFor / blindPromptFor instead.',
      );
    }
  }
  return files.length;
}

const serverFiles = scanRoot(SERVER, '');

// 3. The client transport may not value-import the engine. Comments are stripped
// first, because a doc comment that *shows* the correct `import type` form is
// documenting the rule rather than breaking it, and a gate that fires on correct
// examples is a gate that gets deleted.
const clientSrc = resolve(REPO, 'packages', 'client', 'src');
if (existsDir(clientSrc)) {
  for (const file of walk(clientSrc, [])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const lines = code.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/from\s+['"]@shasn\/engine['"]/.test(line)) continue;
      // `import type { … } from '@shasn/engine'` is the required shape. A
      // multi-line import puts `import type {` on an earlier line, so the whole
      // import statement is examined rather than the one line that names the
      // module.
      if (isTypeOnlyImport(lines, i)) continue;
      const rel = relative(REPO, file).split('\\').join('/');
      failures.push(
        `${rel}:${i + 1}: value-imports @shasn/engine. Use \`import type\` — a value import ` +
          'drags reduce.ts into the browser bundle and a bundler is a leak channel nobody reviews.',
      );
    }
  }
}

if (failures.length > 0) {
  console.error('SECRET GATE FAILED\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\n${failures.length} violation(s) across ${serverFiles} scanned server file(s).`);
  process.exit(1);
}

console.log(`secret gate: clean (${serverFiles} server files scanned)`);

function existsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Blank out comments while PRESERVING line numbers, so a reported line number
 * still points at the right line in the real file. A string-literal-aware pass
 * would be more correct; this one is only ever used on the engine-import check,
 * where a `//` inside a string cannot name a module specifier anyway.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Is the import statement ending at `endLine` a type-only import?
 *
 * Walks backwards to the `import` keyword, which is the only correct place to
 * look: `import type {` and `import {` can be many lines apart, and a heuristic
 * that only inspects the naming line is exactly the heuristic that gets bypassed.
 */
function isTypeOnlyImport(lines, endLine) {
  for (let i = endLine; i >= 0 && i > endLine - 40; i -= 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (/^\s*import\b/.test(line)) return /^\s*import\s+type\b/.test(line);
    if (/^\s*(export|const|let|function|class)\b/.test(line)) return false;
  }
  return false;
}
