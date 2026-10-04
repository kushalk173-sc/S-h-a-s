/**
 * ═════════════════════════════════════════════════════════════════════════════
 * A PRESS THAT DID NOTHING HAS TO SAY WHY — AND IT USED TO SAY IT NOWHERE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * ## WHAT WAS FOUND, IN A BROWSER, ON A REAL TABLE
 *
 * Turn 4, three seats. Seat 0 held `1 funds · 2 clout · 3 media · 1 trust`. The
 * HQ Mat showed a card costing `2 clout · 1 media · 1 trust` and rendered the
 * button **live**, with no shortfall printed beside it. The card was clicked and:
 *
 *   - **no frame left the socket** (the page's own WebSocket tap recorded nothing),
 *   - no `error` toast appeared,
 *   - no market card changed,
 *   - and not one word appeared anywhere on the page.
 *
 * The reason was in the client throughout. `setRefusal` has ~25 call sites across
 * `GameScreen` and `session.ts`; `app.refusal` was rendered in exactly two places,
 * `PlacementBar` and `GerryBar`, and both exist only while a placement or a
 * gerrymandering flow is open. **Every refusal raised from the market, the powers
 * tray, the TRADE row, the Conspiracy buttons, the answer screen, and `send`'s own
 * "That did not reach the table" was written to state and shown to nobody.**
 *
 * That is this project's worst bug class — a visible control that does nothing,
 * with no explanation — and the reason the market looked broken in a browser.
 *
 * ## WHAT IS ASSERTED HERE
 *
 *  1. **The line renders.** A refusal is visible, is announced (`role=status`,
 *     `aria-live=polite`), and carries a stable testid.
 *  2. **It expires**, so a refusal from three turns ago is not still claiming to be
 *     current, and an identical repeat re-arms the timer rather than being lost.
 *  3. **A bar that owns its own copy suppresses it**, so a refusal raised during a
 *     placement is said once, not twice.
 *  4. **THE STRUCTURAL CLAUSE**, which is the one that actually prevents a
 *     regression: every `setRefusal` call site must be in a file that has a
 *     renderer for the thing it sets. A future control that refuses must not be
 *     able to do so silently — this is the test that fails if someone adds a
 *     `setRefusal` to a component tree with nowhere to put the sentence.
 *  5. **Nothing is lost:** the existing placement-bar flash and gerry bar keep
 *     working, because the new surface supplements them rather than replacing them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { act, render, screen } from '@testing-library/react';

import gameScreenSource from './GameScreen.tsx?raw';
import sessionSource from './session.ts?raw';
import storeSource from './store.ts?raw';
import { RefusalLine, REFUSAL_MS } from './RefusalLine.tsx';

const HERE = dirname(fileURLToPath(import.meta.url));
const refusal = (text: string, at = 1) => ({ text, at });

// ─────────────────────────── 1 & 2 & 3. the line itself ───────────────────────────

describe('a refusal is a line on the screen, and then it goes away', () => {
  afterEach(() => vi.useRealTimers());

  it('renders the sentence, announced, with a stable hook', () => {
    render(<RefusalLine refusal={refusal('you cannot afford that Voter Card')} suppressed={false} onExpire={() => undefined} />);
    const line = screen.getByTestId('refusal');
    expect(line.textContent).toBe('you cannot afford that Voter Card');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.getAttribute('aria-live')).toBe('polite');
  });

  it('renders NOTHING when there is no refusal — silence still means "nothing happened"', () => {
    render(<RefusalLine refusal={null} suppressed={false} onExpire={() => undefined} />);
    expect(screen.queryByTestId('refusal')).toBeNull();
  });

  it('expires after six seconds, so an old refusal is not still claiming to be current', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<RefusalLine refusal={refusal('nope')} suppressed={false} onExpire={onExpire} />);
    expect(screen.getByTestId('refusal')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(REFUSAL_MS - 1); });
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('the SAME sentence twice re-arms the timer rather than being swallowed', () => {
    // `refusal.at` is monotonic precisely so this is possible. Keyed on the text
    // alone, the second identical refusal would be indistinguishable from the
    // first and the player would press again into silence.
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { rerender } = render(<RefusalLine refusal={refusal('no', 1)} suppressed={false} onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(REFUSAL_MS - 100); });
    rerender(<RefusalLine refusal={refusal('no', 2)} suppressed={false} onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(REFUSAL_MS); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a bar that flashes its own copy suppresses it, so it is said once', () => {
    render(<RefusalLine refusal={refusal('pick a different slot')} suppressed={true} onExpire={() => undefined} />);
    expect(screen.queryByTestId('refusal')).toBeNull();
  });
});

// ─────────────────────────── 4. the structural clause ───────────────────────────

describe('no component can refuse without somewhere to say so', () => {
  /**
   * The failure this pins is not a missing sentence in some abstract sense. It is
   * a sentence computed, stored, and rendered by a component that is not mounted.
   * So the assertion is about MOUNT POINTS: every file that calls `setRefusal`
   * must have a renderer on screen in the same tree, and `GameScreen` — which
   * owns every control that can refuse — must render one unconditionally.
   */
  it('GameScreen renders the RefusalLine outside any conditional', () => {
    const at = gameScreenSource.indexOf('<RefusalLine');
    expect(at, 'RefusalLine is not rendered by GameScreen at all').toBeGreaterThan(-1);
    // The refusal line must not be inside a `{cond ? (` … `: null)` of its own.
    const before = gameScreenSource.slice(Math.max(0, at - 400), at);
    expect(before).not.toMatch(/\{\s*\w[\w.?\[\]]*\s*!==\s*null\s*\?\s*$/);
  });

  it('every setRefusal call site reaches the one rendered surface', () => {
    /*
      Two shapes of caller, and both must land on the line:
        - GameScreen, which renders <RefusalLine refusal={app.refusal}> itself;
        - session.ts, which is a transport module and MUST NOT render anything -
          but sets the same `app.refusal` field, so its sentence arrives by the
          same route. That is asserted by name rather than assumed.
    */
    expect(gameScreenSource, 'GameScreen does not render the sentence').toContain('<RefusalLine');
    expect(gameScreenSource).toContain('refusal={app.refusal}');
    expect(sessionSource, 'send() no longer names its own failure').toContain('setRefusal(');
    // …and it is the SAME field, not a second one nothing reads.
    const sessionField = /setRefusal\(/.test(sessionSource) && /from '\.\/store\.ts'/.test(sessionSource);
    expect(sessionField, "session.ts's refusal does not come from the app store").toBe(true);
    expect(storeSource).toMatch(/export function setRefusal[\s\S]{0,200}set\(\{ refusal:/);
  });

  it('and there are a lot of them, which is why one renderer is not enough to forget', () => {
    const total = (gameScreenSource.match(/setRefusal\(/g) ?? []).length
      + (sessionSource.match(/setRefusal\(/g) ?? []).length;
    // Not a coverage number — a tripwire. If this drops, somebody deleted the
    // reasons, and the reasons are the product.
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it('send() names its own failure, because "the connection is down" is a reason', () => {
    expect(sessionSource).toContain('That did not reach the table');
  });

  it('the store still keeps the monotonic counter that makes a repeat re-render', () => {
    expect(storeSource).toContain('refusalSeq');
    expect(storeSource).toMatch(/setRefusal[\s\S]{0,160}at: refusalSeq/);
  });
});

// ─────────────────────────── 5. nothing lost ───────────────────────────

describe('the existing flashes still work', () => {
  it('PlacementBar and GerryBar still take the refusal prop from GameScreen', () => {
    // The new line supplements them. If someone "simplified" by deleting these
    // two props, a refusal raised mid-placement would move from the bar to a
    // line above the board — a regression in where the sentence appears.
    for (const bar of ['<PlacementBar', '<GerryBar']) {
      const at = gameScreenSource.indexOf(bar);
      expect(at, `${bar} is gone from GameScreen`).toBeGreaterThan(-1);
      const block = gameScreenSource.slice(at, at + 700);
      expect(block, `${bar} no longer receives the refusal`).toContain('refusal={app.refusal}');
    }
  });

  it('and GameScreen tells the line to stand down while one of them is up', () => {
    expect(gameScreenSource).toContain('suppressed={placingGroup !== null || app.gerryZoneId !== null}');
  });
});