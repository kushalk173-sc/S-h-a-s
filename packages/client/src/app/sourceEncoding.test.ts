/**
 * No source file in the client contains U+FFFD, the Unicode replacement character.
 *
 * A save through the wrong encoding turned every em dash in one sentence into the replacement character,
 * and that sentence was rendered on every seat's market, powers tray and mat for the
 * whole of every opponent's turn: "Waiting for Alice [?] your powers and the HQ Mat
 * come alive on your turn." Nothing failed. The character is never intended in this
 * codebase, so its presence anywhere is the defect, and this is the gate.
 *
 * It also catches a file SAVED in the wrong encoding: `board/pegsOf.ts` was
 * Windows-1252, so its em dashes were bytes that are invalid UTF-8, and reading it as
 * UTF-8 (as Vite does) turns each one into this same character.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** Built from its code point so this file does not contain the character it bans. */
const REPLACEMENT = String.fromCharCode(0xfffd);

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('source encoding', () => {
  it('no client source file contains the replacement character', () => {
    const offenders = walk(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => line.includes(REPLACEMENT))
        .map(({ i }) => `${relative(SRC, file)}:${i + 1}`),
    );
    expect(offenders, 'replace each with the character that was meant (usually — or §)').toEqual([]);
  });
});
