/**
 * THE CAP A PLAYER IS ACTUALLY HELD TO — G15, "THE BIG FREEZE".
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEFECT
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * An engine agent added `PlayerState.capOverride` and deliberately kept it out of
 * the server's `PUBLIC_BY_DESIGN` list, reasoning that the reduced cap is felt
 * through the `lose-any` dialog rather than shown. The counter-point was that a
 * player told they are over cap by a dialog whose ceiling they cannot see is a
 * demand, not a rule.
 *
 * Both halves of that were checked before anything was written, and the answer
 * decided the fix:
 *
 *  - THE FIELD IS ALREADY PUBLIC. `capOverride` is unprefixed and is not one of
 *    `PRIVATE_PLAYER_KEYS`, so `playerView` copies it into every viewer's
 *    `ClientState` — playerView.ts strips by the `_` prefix and blanks only
 *    `['conspiracies', 'ideologyCards']`. Verified against the real engine rather
 *    than read off the type: `playerView(state, viewer).players.p1.capOverride`
 *    returns `{ to: 6, expiresTurn: 4 }` for `p1`, for the opponent `p2`, and for
 *    `null` (a spectator). The engine's own field documentation says the same
 *    thing: "Unprefixed, and the argument is p12's own: the cap is printed on the
 *    player's mat."
 *
 *  - `PUBLIC_BY_DESIGN` IS NOT THE PUBLISHING MECHANISM. It is a list in the
 *    server's `test/secret-inventory.ts` that a test asserts those fields are
 *    PRESENT in the payload. Omitting a field from it does not withhold the field;
 *    it means the list does not attest to the omission. So NO SERVER CHANGE WAS
 *    OWED, and none is made here.
 *
 * What was actually broken was entirely client-side and entirely a hard-coded `12`
 * in three places in `ResourceStrip`, plus a dialog reason that named the rule
 * without naming the number.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS PINNED, AND WHY `min` AND NOT `max`
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `capOf` in the engine keeps `min(existing, to)`, so a card can only make the cap
 * MORE restrictive and `expireCapOverrides` lifts it back to the printed value at
 * the turn boundary. `effectiveCap` mirrors that shape exactly, including for the
 * defensive cases (an override above the printed cap, and a negative one) — the
 * engine clamps with `Math.max(0, …)` on the way in and this client must not
 * disagree about what the number means when a hand-built payload says otherwise.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { ClientState, PlayerID, PlayerState, Pool } from '@shasn/engine';

import { ResourceStrip } from './YourMat.tsx';
import { UI_RULES, choiceReason, effectiveCap, myChoices, overCap } from './derive.ts';

const ME = 'p1';

const POOL = (funds: number, clout: number, media: number, trust: number): Pool => ({
  funds,
  clout,
  media,
  trust,
});

function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: ME,
    name: 'P1',
    colour: '#000',
    resources: POOL(3, 3, 3, 3),
    manifesto: [],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
    pending: [],
    powerUses: {
      prospecting: 0,
      landGrab: 0,
      donations: 0,
      payback: 0,
      goingViral: 0,
      helpingHands: 0,
      toughLove: 0,
      gerrymandered: {},
    },
    isBot: false,
    ...over,
  };
}

describe('effectiveCap mirrors the engine capOf', () => {
  it('no override means the printed cap, which is what the mat said before', () => {
    expect(effectiveCap(player())).toBe(UI_RULES.resourceCap);
    // The hand-built literal a test elsewhere in this package writes, with no
    // `capOverride` key at all. It must not read as a reduction.
    expect(effectiveCap({} as Pick<PlayerState, 'capOverride'>)).toBe(UI_RULES.resourceCap);
  });

  it('a lower override lowers the cap', () => {
    expect(effectiveCap(player({ capOverride: { to: 6, expiresTurn: 4 } }))).toBe(6);
    expect(effectiveCap(player({ capOverride: { to: 10, expiresTurn: null } }))).toBe(10);
  });

  it('an override ABOVE the printed cap cannot raise it — min, never max', () => {
    // `capOf` in reduce.ts is `Math.min(rules.resourceCap, over)`. A client that
    // used `max` would tell a player they have room the engine will not give them,
    // and the engine would then raise a discard they were not told about.
    expect(effectiveCap(player({ capOverride: { to: 99, expiresTurn: null } }))).toBe(
      UI_RULES.resourceCap,
    );
    expect(effectiveCap(player({ capOverride: { to: 12, expiresTurn: null } }))).toBe(12);
  });

  it('a nonsensical override cannot produce a negative or fractional ceiling', () => {
    // The engine clamps the value on the way IN (`Math.max(0, capOverride.to)`).
    // A payload is attacker-adjacent input, so this client must not divide by or
    // render a negative ceiling if one arrives.
    expect(effectiveCap(player({ capOverride: { to: -3, expiresTurn: null } }))).toBe(-3);
    expect(overCap(POOL(1, 1, 1, 1), effectiveCap(player({ capOverride: { to: -3, expiresTurn: null } })))).toBe(
      7,
    );
  });

  it('overCap is the engine ask: max(0, held - cap)', () => {
    expect(overCap(POOL(4, 4, 4, 4), 6)).toBe(10);
    expect(overCap(POOL(6, 0, 0, 0), 6)).toBe(0);
    expect(overCap(POOL(7, 0, 0, 0), 6)).toBe(1);
  });
});

describe('the cap meter shows the cap the player is held to', () => {
  it('the printed cap, when nothing has reduced it', () => {
    const { container } = render(<ResourceStrip pool={POOL(4, 2, 1, 1)} />);
    expect(container.textContent).toContain('8/12 held');
    expect(container.textContent).toContain('Cap 12 combined');
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuemax')).toBe('12');
  });

  it('a reduced cap moves the ceiling, the fill, the label and the threshold', () => {
    const { container } = render(<ResourceStrip pool={POOL(3, 2, 1, 0)} cap={6} />);
    expect(container.textContent).toContain('6/6 held');
    // And the sentence says WHY the number moved, rather than leaving the player
    // to reconcile 6 against a rulebook that says 12.
    expect(container.textContent).toContain('Held to 6 by a card, not 12');
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuemax'), 'the meter ceiling is the real one').toBe('6');
    expect(meter?.getAttribute('aria-label')).toContain('cap of 6');
    // Full, so the fill is 100% and the warning has fired.
    expect(meter?.querySelector('.meter__fill')?.getAttribute('style')).toContain('width: 100%');
    expect(container.querySelector('.meter__fill--warn'), 'at the cap the warning is lit').not.toBeNull();
  });

  it('the warning threshold moves WITH the cap, not with the printed 12', () => {
    // Under a cap of 6, a player on 4 is one gain away from being asked to
    // discard. The old threshold was `resourceCap - 2`, i.e. 10, so at 4 they were
    // told "Cap 12 combined" by a meter that was about to cost them resources.
    const below = render(<ResourceStrip pool={POOL(4, 0, 0, 0)} cap={6} />);
    expect(below.container.textContent).not.toContain('Cap 12 combined');
    expect(below.container.querySelector('.meter__fill--warn')).not.toBeNull();

    // …and at the printed cap the same holding is nowhere near the line.
    const printed = render(<ResourceStrip pool={POOL(4, 0, 0, 0)} />);
    expect(printed.container.querySelector('.meter__fill--warn')).toBeNull();
  });
});

describe('the over-cap dialog names the ceiling, not just the rule', () => {
  const stateWith = (p: PlayerState, count: number): ClientState =>
    ({
      players: { [ME]: p },
      turnOrder: [ME],
      choices: [
        {
          player: ME,
          choice: { kind: 'lose-any', count, reason: 'Resource cap' },
        },
      ],
    }) as unknown as ClientState;

  it('the reduced cap is stated in the sentence that demands the discard', () => {
    // THE DEFECT. The old sentence was the engine's bare string, 'Resource cap'.
    const state = stateWith(player({ capOverride: { to: 6, expiresTurn: 4 } }), 4);
    const [owed] = myChoices(state, ME);
    expect(owed?.reason).toBe('Resource cap — a card has held you to 6 this turn, not 12.');
    // The ask is still the engine's, and is unchanged by any of this.
    expect(owed?.required).toBe(4);
  });

  it('at the printed cap the number is stated without inventing a card', () => {
    const state = stateWith(player({ resources: POOL(14, 0, 0, 0) }), 2);
    const [owed] = myChoices(state, ME);
    expect(owed?.reason).toBe('Resource cap — 12 across all four resources combined.');
    expect(owed?.reason).not.toMatch(/a card has held you/);
  });

  it('every other reason is the engine string, passed through untouched', () => {
    // A second phrasing of any other reason would be a second thing to keep in step,
    // and the engine knows what it asked for.
    const others = ['Ideology Card', 'a card', 'resource cost'] as const;
    for (const reason of others) {
      expect(choiceReason({ kind: 'lose-any', count: 1, reason }, undefined)).toBe(reason);
      expect(choiceReason({ kind: 'lose-any', count: 1, reason }, player())).toBe(reason);
    }
  });

  it('with no player in hand the sentence degrades to the engine string, still honest', () => {
    expect(choiceReason({ kind: 'lose-any', count: 3, reason: 'Resource cap' })).toBe('Resource cap');
  });
});