/**
 * THE MIRRORS IN `derive.ts`, PINNED AGAINST THE ENGINE'S OWN SOURCE TEXT.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS: A COMMENT CITED IT AND IT DID NOT EXIST
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `derive.ts` said, of the 19 numbers in `UI_RULES`:
 *
 *     "The mirror is still checked — `derive.test.ts` imports the real `RULES`
 *      and asserts equality"
 *
 * There was no `derive.test.ts`. The same file's header, twenty lines earlier,
 * said so in as many words — and then twenty lines after THAT repeated the claim
 * anyway. So the one stated reason those numbers are trustworthy did not exist,
 * and nothing in the repository compared `UI_RULES.redrawCost` with
 * `packages/engine/src/rules.ts`. A one-line drift (`redrawCost: 4` -> 3) makes
 * the redraw button quote a price the server will not charge, and every test in
 * the repository still passes.
 *
 * That is worse than a missing test. A missing test is a debt with an obvious
 * shape; a comment claiming a guard that is not there converts the next real
 * defect into "the guard must have been dropped" and teaches the next reader not
 * to bother writing it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * HOW IT IS PINNED, AND WHY NOT BY IMPORTING THE ENGINE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Not by value-importing `@shasn/engine`. `packages/server/scripts/check-secrets.mjs`
 * fails the build on a value import of the engine ANYWHERE under
 * `packages/client/src`, test files included with no exemption, because a value
 * import drags `reduce.ts` — every card and every payout — into a bundle. An
 * earlier version of the `derive.ts` comment excused itself on the grounds that
 * "a test is not a bundle"; that was wrong twice over, as the same comment
 * records: the file did not exist, and a test here may not do it either.
 *
 * So the engine is read as TEXT — `?raw`, the route `redrawControl.test.tsx`
 * already uses, giving the bytes on disk rather than a build of them. This is the
 * technique `packages/engine/test/reducer-parity.test.ts` uses to re-derive its
 * registry from `reduce.ts`, and it is the same trade: source-text comparison
 * cannot see a semantic disagreement, but it CAN see a numeric one, and a numeric
 * one is the entire class of defect `UI_RULES` is exposed to.
 *
 * WHAT IT STILL CANNOT SEE, stated rather than implied: nothing here compares a
 * MIRRORED FUNCTION's behaviour against the engine's — only numbers and ordered
 * lists. `choiceResolver.test.tsx` is the compensating instrument for the
 * behavioural mirrors, and the residual hole is a divergence both sides agree on.
 */

import { describe, expect, it } from 'vitest';

import engineRulesSource from '../../../engine/src/rules.ts?raw';
import engineStateSource from '../../../engine/src/state.ts?raw';

import { IDEOLOGUE_ORDER, IDEOLOGUE_RESOURCE, RESOURCE_ORDER, UI_RULES } from './derive.ts';

/**
 * The engine's `RULES` literal, read out of its source.
 *
 * Sliced from `export const RULES: Rules = {` to the first `};` after it, so the
 * `Rules` TYPE above it — which is full of rulebook citations and no numbers —
 * cannot be mistaken for the value. Values are compared as JSON so `'3'` and `3`
 * cannot pass as equal.
 */
const RULES_TEXT: string = engineRulesSource.slice(
  engineRulesSource.indexOf('export const RULES: Rules = {'),
  engineRulesSource.indexOf('\n};', engineRulesSource.indexOf('export const RULES: Rules = {')),
);

/** Every `key: value` line of the engine's `RULES` literal. */
function engineRules(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of RULES_TEXT.matchAll(/^[ \t]*([A-Za-z0-9_]+):[ \t]*(.+?),?$/gm)) {
    const key = m[1] ?? '';
    const raw = (m[2] ?? '').replace(/,$/, '').trim();
    out[key] = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
  }
  return out;
}

describe('UI_RULES is pinned against the engine RULES it claims to mirror', () => {
  it('the mirror and the engine agree, key by key and value by value', () => {
    // THE ASSERTION THE COMMENT CLAIMED EXISTED. Every number the UI renders is
    // compared to the number the engine will use, so a one-line drift in either
    // file is red here rather than reported by a player as the game lying.
    expect({ ...UI_RULES }).toEqual({
      ...engineRules(),
      // The one engine key that is deliberately NOT a display number. Asserted as an
      // explicit deletion rather than ignored, so a new engine key cannot slip in
      // unmirrored without this test noticing the shape change.
      staggeredStart: undefined,
    });
  });

  it('nothing in the mirror is a rule the engine does not have', () => {
    // The other direction. A typo'd key in `UI_RULES` would render a label from a
    // number no engine rule mentions, which is a lie the type system cannot see.
    for (const key of Object.keys(UI_RULES)) {
      expect(Object.keys(engineRules()), `UI_RULES.${key} is not an engine rule`).toContain(key);
    }
  });

  it('the engine rule left out of the mirror is the one that is not a number', () => {
    // `staggeredStart` is a boolean and is not a display constant, so its absence
    // is a decision. Pinned so that absence cannot become "the mirror drifted".
    expect(Object.keys(engineRules()).filter((k) => !(k in UI_RULES))).toEqual(['staggeredStart']);
  });

  it('the slice really found the engine rules — non-vacuity', () => {
    // If the slice ever matched nothing, the equality above would compare an empty
    // object to an empty object and pass. This is the assertion that stops that.
    const parsed = engineRules();
    expect(Object.keys(parsed).length).toBe(20);
    expect(parsed.resourceCap).toBe(12);
    expect(parsed.staggeredStart).toBe(true);
    expect(Object.keys(UI_RULES).length).toBe(19);
    // And the numbers that actually reach a player, called out by name, because a
    // generic diff is easy to read past and these are the ones a wrong mirror
    // makes the game lie about: the price of the redraw and the size of the cap.
    expect(UI_RULES.redrawCost).toBe(parsed.redrawCost);
    expect(UI_RULES.resourceCap).toBe(parsed.resourceCap);
    expect(UI_RULES.marketSize).toBe(parsed.marketSize);
  });
});

/**
 * The two ORDERED lists and the one lookup, which `derive.ts` mirrors with the
 * same "check the mirror" sentence and were equally unchecked.
 *
 * Order matters for display and membership matters for arithmetic, so both are
 * compared as sequences rather than as sets.
 */
describe('the printed orders are pinned to the engine orders they claim to mirror', () => {
  /** `export const RESOURCES: readonly Resource[] = [...] as const;` and IDEOLOGUES. */
  function engineList(name: string): readonly string[] {
    const at = engineStateSource.indexOf(`export const ${name}`);
    const slice = engineStateSource.slice(at, engineStateSource.indexOf(';', at));
    return [...slice.matchAll(/'([a-z]+)'/g)].map((m) => m[1] ?? '');
  }

  it('RESOURCE_ORDER is state.ts:RESOURCES, in order', () => {
    expect(engineList('RESOURCES').length, 'non-vacuity').toBe(4);
    expect([...RESOURCE_ORDER]).toEqual(engineList('RESOURCES'));
  });

  it('IDEOLOGUE_ORDER is state.ts:IDEOLOGUES, in order', () => {
    expect(engineList('IDEOLOGUES').length, 'non-vacuity').toBe(4);
    expect([...IDEOLOGUE_ORDER]).toEqual(engineList('IDEOLOGUES'));
  });

  it('IDEOLOGUE_RESOURCE is state.ts:IDEOLOGUE_RESOURCE, key for key', () => {
    // p11/p33: Capitalist to Funds, Supremo to Clout, and so on. A mirror that kept
    // the four names right and permuted the four resources would render the
    // Ideologue strip as a claim about the wrong resource.
    const at = engineStateSource.indexOf('export const IDEOLOGUE_RESOURCE');
    const slice = engineStateSource.slice(at, engineStateSource.indexOf('};', at) + 2);
    const declared = Object.fromEntries(
      [...slice.matchAll(/([a-z]+):[ \t]*'([a-z]+)'/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
    );
    expect(Object.keys(declared).length, 'non-vacuity').toBe(4);
    expect({ ...IDEOLOGUE_RESOURCE }).toEqual(declared);
    // …and every named Ideologue has a resource, so no lookup can return undefined
    // and print "undefined funds" beside a seat.
    for (const who of IDEOLOGUE_ORDER) expect(IDEOLOGUE_RESOURCE[who]).toBeDefined();
  });
});