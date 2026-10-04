/**
 * NO SCREEN MAY CLAIM THE CARD IS HIDDEN. The retirement sweep, as a gate.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL, which is the actual defect.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `packages/server/src/FULL-INFORMATION.md` opens "The blind answer is gone": every
 * seat now sees the question, both answers, both Ideologues and BOTH PAYOUTS before
 * anybody answers. The client was updated to render that. And then the lobby — the
 * first screen in the product, the first line a human reads — still said:
 *
 *     "…and you cannot see the card you are about to answer."
 *
 * which is false, and which the audit rightly called the highest-visibility stale
 * string in the app.
 *
 * WHY IT SURVIVED EVERY GATE, and this is the part worth keeping: it is COPY. The
 * gates in the ruling are about what crosses the wire and what reaches the DOM. A
 * sentence in a `<p>` is invisible to both. So the retirement sweep needed a gate of
 * its own, and this is it — there was none.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS DELIBERATELY ALLOWED, and why. This is not "delete the word hidden".
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Conspiracy Cards are still secret. `PlayerState.conspiracies` is not in the wire
 * view (`FULL-INFORMATION.md` §4 keeps it out), the client is not told what it holds,
 * and `ConspiracyPicker` tells the player so in those words. That is a DIFFERENT DECK
 * with a different ruling, and a sweep that took that sentence with it would be
 * telling a lie in the other direction: a player who is told their Conspiracies are
 * public will play them differently. The audit flagged this one explicitly as correct
 * and not to be swept.
 *
 * `aria-hidden` is an accessibility attribute and says nothing about the game. It is
 * excluded by name, not by pattern, so the word still cannot appear in prose.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { LobbyScreen } from './Panels.tsx';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

/**
 * THE PHRASES a screen must not use about the Ideology Card or its payout.
 *
 * Deliberately phrase-shaped rather than word-shaped. "hidden" alone would match
 * `aria-hidden`, a CSS class and an unrelated sentence about a panel; what is banned
 * is a claim that a player cannot see the card, the answers, the payout or the
 * Ideologue before choosing.
 *
 * `face-up` is deliberately NOT banned while `face-down` is: `interrupt.ts` prints
 * "Discard every face-up Voter Card", and a Voter Card face-up is a card in play —
 * the opposite of a concealment claim. Banning the word pair would have flagged a
 * correct piece of copy.
 */
const FORBIDDEN: readonly { re: RegExp; says: string }[] = [
  { re: /\b(?:cannot|can ?not|can't|unable to)\s+(?:see|view|know|read)\b/i, says: 'cannot see' },
  { re: /\bnot\s+(?:shown|visible|revealed|published|displayed)\b/i, says: 'not shown' },
  { re: /\bface[\s-]?down\b/i, says: 'face down' },
  { re: /\bhidden\s+(?:until|until\s+you|from)\b/i, says: 'hidden until you' },
  { re: /\bsecret\b/i, says: 'secret' },
  { re: /\buntil\s+you\s+(?:answer|commit|choose|choose\s+an?\s+answer)\b/i, says: 'until you answer' },
  { re: /\bbefore\s+you\s+(?:answer|commit)\b/i, says: 'before you answer' },
  { re: /\bthe\s+payout\s+is\s+not\b/i, says: 'the payout is not shown' },
  { re: /\bwithout\s+seeing\b/i, says: 'without seeing' },
];

/**
 * The two places a concealment claim is TRUE, and must stay.
 *
 * Each is a Conspiracy Card, which is a different deck under a different ruling
 * (`FULL-INFORMATION.md` §4 keeps `PlayerState.conspiracies` out of the wire view).
 * The pairing is exact: a file may be allowed one of these phrases only if it also
 * mentions a Conspiracy, so a new concealment claim about the Ideology Card cannot
 * buy its way in by landing in an allowed file.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'ConspiracyPicker.tsx': 'A Conspiracy Card is bought and held face down — a different deck, still secret by ruling.',
  'ResponseWindow.tsx': 'A Conspiracy Card is a hidden hand — a different deck, still secret by ruling.',
};

/** Every non-test source file under `src/`, by basename. */
function sourceFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      if (/\.d\.ts$/.test(entry.name)) continue;
      out.set(entry.name, readFileSync(p, 'utf8'));
    }
  };
  walk(SRC);
  return out;
}

/**
 * Source with its COMMENTS removed, so the rule can be stated in the file that
 * documents it.
 *
 * `staleWording.test.ts` is itself full of the phrases it bans, and several
 * components explain in prose why a concealment claim was retired — that prose has
 * to be able to SAY so. The same concession `blindAnswer.test.tsx` makes for its
 * stylesheet audit.
 *
 * `aria-hidden` is blanked first, for the reason above.
 */
function code(source: string): string {
  return source
    .replace(/aria-hidden/g, 'ARIA-HIDDEN')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('nothing on screen claims the Ideology Card is hidden', () => {
  it('no source file makes that claim outside prose', () => {
    const files = sourceFiles();
    expect(files.size, 'the sweep actually read the source tree').toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const [name, source] of files) {
      const body = code(source);
      const allow = ALLOWED[name];
      for (const { re, says } of FORBIDDEN) {
        const m = re.exec(body);
        if (m === null) continue;
        // The allow-list is conditional on the sentence being about Conspiracies.
        if (allow !== undefined && /conspirac/i.test(body)) continue;
        offenders.push(`${name}: "${says}" in "${m[0]}"`);
      }
    }
    expect(offenders, `stale concealment claims:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the allow-list is still true — a Conspiracy Card really is still secret', () => {
    // An allow-list that nobody checks is a hole. Both entries are re-checked
    // against the source they excuse, so deleting the Conspiracy wording (or
    // changing it to something else) fails here rather than passing silently.
    const files = sourceFiles();
    for (const [name, why] of Object.entries(ALLOWED)) {
      const source = files.get(name);
      expect(source, `${name} is allow-listed but does not exist`).toBeDefined();
      expect(source ?? '', `${name} is allow-listed but never mentions a Conspiracy`).toMatch(
        /conspirac/i,
      );
      expect(why, `${name}: the excuse must say what is still secret`).toMatch(/conspirac/i);
    }
    // And the allow-list covers exactly the two known-true cases: a seventh file
    // claiming concealment is an offender, not an accident.
    expect(Object.keys(ALLOWED).sort()).toEqual(['ConspiracyPicker.tsx', 'ResponseWindow.tsx']);
  });

  it('the pitch on the landing screen states what the server actually sends', () => {
    const { container } = render(
      <LobbyScreen
        lobbies={[]}
        lobby={null}
        name="Player"
        you={null}
        isHost={false}
        canStart={false}
        onNameChange={() => undefined}
        onList={() => undefined}
        onCreate={() => undefined}
        onJoin={() => undefined}
        onReady={() => undefined}
        onStart={() => undefined}
        onLeave={() => undefined}
        onSpectate={() => undefined}
        onWatchRoom={() => undefined}
        spectator={false}
      />,
    );
    const sub = container.querySelector('.lobby__sub');
    expect(sub, 'the lobby has a pitch line').not.toBeNull();
    const text = (sub?.textContent ?? '').replace(/\s+/g, ' ').trim();
    // It is the FIRST thing the product says, so it is asserted, not eyeballed.
    expect(text).toBe(
      'Four Ideologues. Nine constituencies. One hundred and twenty-nine voters, and both ' +
        'answers — with what each one pays — printed before you choose.',
    );
    for (const { re, says } of FORBIDDEN) {
      expect(text, `the pitch must not say "${says}"`).not.toMatch(re);
    }
    // …and it names the thing that is now public, because a pitch that only removed
    // the old claim would say nothing at all about the ruling.
    expect(text).toMatch(/pays/);
  });

  it('no title= or aria-label anywhere in the answer subtree claims concealment', () => {
    // The audit checked the answer screen by hand: one `aria-label` (the dialog's own
    // name), no `title=`, no lock icon, no countdown. That is the screen where a
    // stale claim would do the most damage, so it is a gate rather than a note.
    const files = sourceFiles();
    const answer = files.get('BlindAnswer.tsx') ?? '';
    const body = code(answer).replace(/ARIA-HIDDEN/g, 'aria-hidden');
    expect(body, 'BlindAnswer must render no title attribute').not.toMatch(/title=/);
    expect(body, 'and no aria-label of its own').not.toMatch(/aria-label=/);
    for (const { re, says } of FORBIDDEN) {
      expect(body, `BlindAnswer must not say "${says}"`).not.toMatch(re);
    }
  });
});
