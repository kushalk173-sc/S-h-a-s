# Engine widening — decision record

Scope: how to make ~10 unrepresentable recovered cards expressible without weakening
`reducer-parity.test.ts`, which re-derives the engine's capabilities from `reduce.ts`
**source text**.

Evidence read (only these):
`packages/cards/src/executable.ts` (901 lines), `packages/cards/test/reducer-parity.test.ts`
(slicing machinery `:60-354`), `packages/engine/src/reduce.ts` (`applyEffect` `:1540-1799`),
plus a grep of `packages/cards/src/effect-ops.ts` for its compile-time guard.

---

## 1. Recommendation — **(c) hybrid**

Widen the union with a small number of **real ops and fields**, and add **one** declarative
escape-hatch op whose instruction vocabulary is itself source-sliced. Reject pure (a) and
pure (b).

**Why not (a), pure widening.** `EXECUTED_OPS` is typed `Readonly<Record<Effect['op'], …>>`
(`executable.ts:58`), so every new union member is a *compile* obligation on the registry, and
`effect-ops.ts:34` (`as const satisfies readonly Effect['op'][]`) plus `effect-ops.ts:40`
(`Exclude<Effect['op'], …> extends never`) make `EFFECT_OPS` and the union identical at compile
time. That is a good property, and it is exactly what a general escape hatch would throw away:
the moment an op's payload becomes a free-form program, "every field is read" collapses to
"one field (`do`) is read", and the per-op guard at `reducer-parity.test.ts:344-352` stops
being per-op. Ten narrow widenings keep it sharp; an unbounded `do` does not.

**Why not (b), pure escape hatch.** It is one type instead of ten, but it makes the reducer an
interpreter over card-authored data, which is a much larger review surface than ten typed cases
— and the drift guard here is a *text slicer*, which can only police a vocabulary it can
enumerate.

**Why (c) wins against this repo specifically.** The drift guard is a parser
(`reducer-parity.test.ts:79-96`: slice `function applyEffect` → `function applyEffects`, then
`/^ {4}case '([^']+)':/gm`). A parser can be made honest about a **closed vocabulary** — the repo
already proves this five times over: the four honesty seams named in `executable.ts:196-212`,
`executable.ts:294-302`, `executable.ts:396-409`, `executable.ts:751-763`, and
`reducer-parity.test.ts:100-141`, each a slice of a *different* function
(`installLiveEffects`, the `chosen-player` interception, `RESPOND_INTERRUPT`/`mayRespond`,
`resolveTargets`). So the escape hatch is admissible **iff its verbs are a closed set sliced from
one function**, exactly as `resolvedTargets()` (`reducer-parity.test.ts:185-200`) does for
`EffectTarget`. It is not admissible as a free-form string.

The hybrid's cost is one new seam to cut. Its benefit is that ~4 of the 10 recovered cards become
expressible with **no new op at all** — only new fields, which the generic assertion at
`reducer-parity.test.ts:344-352` already covers automatically.

---

## 2. Concrete types

### 2a. Real ops (each gets its own `case`, its own `EXECUTED_OPS` row)

```ts
// packages/engine/src/cards.ts — additions to the Effect union

/** Fill a zone's empty Areas with a given player's pegs. */
export interface FillZoneEffect {
  readonly op: 'fill-zone';
  /** Whose pegs fill. Read in the case via resolveTargets, so `target` is honest here. */
  readonly target?: EffectTarget;
  /** Which areas: an owned one, or every empty one in a zone. */
  readonly zone: ZoneSelector;
  readonly scope: 'this-zone' | 'chosen-zone' | 'adjacent';
  /** 'own' = only Areas the target leads; 'empty' = every unled Area in scope. */
  readonly into: 'own' | 'empty';
  readonly upTo?: Count;
}
```

```ts
/**
 * Draw one card of a named kind and put it in a player's REVEALED set without
 * making them choose. NOTE: verify `DRAW` in reduce.ts already carries
 * 'headline' before landing this — executable.ts:119-127 says the reveal `kind`
 * reads `s[DRAW[effect.kind]]` and names four values, but does not list them.
 * If headline is already there, this op is unnecessary and the card is already
 * expressible as `reveal`.
 */
export interface DrawCardEffect {
  readonly op: 'draw-card';
  readonly kind: DrawKind;
  readonly n?: Count;
  readonly target?: EffectTarget;
  readonly to?: 'hand' | 'revealed';
}
```

### 2b. New fields on existing ops (no new `case`; the generic check at `:344-352` covers them)

```ts
// `lose` — the donation credit
export interface LoseEffect {
  readonly op: 'lose';
  readonly res: ResourceDelta;
  readonly per?: ComputedMultiplier;
  readonly target?: EffectTarget;
  /**
   * Credit `creditDonation` even when the resources land on somebody OTHER than
   * the caster. reduce.ts:1686-1698 gates the credit on `p === source`, so
   * "donate to X" is currently inexpressible; this field is read in the case
   * and moves the gate from an identity test to an explicit one.
   */
  readonly asDonation?: boolean;
}

/** Widen every op that already takes a `Count`. */
export type Count = number | { readonly of: ComputedSource };

// On `voters`, `evict`, `discard-voter`, `convert-voter`, `gerrymander`,
// `take-voter`, `discount`, `gain-any`, `lose-any`, `steal-any`:
/** Resolve `n` as min(n, legal count) instead of refusing past the supply. */
readonly upTo?: true;

// On an X-card answer side:
/** Which side's payout the rest of the effects run against. */
readonly on?: 'success' | 'failure';

// On `move-peg`:
/** Destination: an empty Area in this zone, or another player's. */
readonly to?: 'empty' | EffectTarget;

// Restriction — needs a NEW per-zone field on `Restriction`, which does not exist.
export interface Restriction {
  readonly kind: RestrictionKind;
  readonly value?: number;
  readonly zones?: readonly ZoneSelector[];   // absent = every zone
}
```

New `RestrictionKind` values, each with a **consult site** (this is the whole discipline — see
`executable.ts:272-286`, where `voter-shortfall` is admitted only because `INFLUENCE` consults
it): `no-gerrymander` (consulted in `GERRYMANDER`), `no-gerrymander-in-volatile` (same, gated on
`zones`), `one-chosen-power` (consulted in `powers.ts usesLeft`), `no-obligation` (consulted in
`ANSWER`), `newest-wins` (consulted in `resolveZone`).

New `ComputedSource` values — `spent-resources`, `discarded-voters`, `your-mat-voters`,
`majorities-you-hold`, `event-voters` — each read in `computedValue()`, each added to
`EXECUTABLE_COMPUTED_SOURCES` (`executable.ts:380-387`) **and** the JSON Schema enum, which
`reducer-parity.test.ts:245-248` pins to `EXECUTABLE_TARGETS` for targets and the corpus validator
pins for sources.

`'adjacent'` is added to `ZoneSelector` **only** when `resolveZone` grows the case; per
`executable.ts:242-250` a selector it cannot resolve narrows to nothing and therefore acts on the
whole board, which over-delivers silently.

### 2c. The escape hatch — one op, closed verb set

```ts
// packages/engine/src/cards.ts
export type Instruction =
  /** Run another Effect inline. Authority is exactly the union's — no new verbs. */
  | { readonly do: Effect }
  /** Repeat the enclosed instructions. `over` is a Count, resolved by resolveCount. */
  | { readonly repeat: { readonly over: Count; readonly each: readonly Instruction[] } }
  /** Run the enclosed instructions only if the read holds. */
  | { readonly when: InstructionCondition; readonly then: readonly Instruction[] }
  /** Read a quantity. PURE: returns a number, mutates nothing. */
  | { readonly count: ComputedSource };

export type InstructionCondition =
  | { readonly is: 'majority-in'; readonly zone: ZoneSelector }
  | { readonly has: 'peg-in'; readonly zone: ZoneSelector }
  | { readonly cmp: 'ge' | 'le' | 'eq'; readonly left: InstructionCount; readonly right: number };

export interface ApplyInstructionEffect {
  readonly op: 'apply';
  readonly do: readonly Instruction[];
}
```

`InstructionCondition` deliberately contains **no** verb that creates state, changes phase, or
moves a card. So `apply { do: [...] }` composes already-vetted effects and read-only queries, and
gains no authority the union does not already have. Anything needing a new `GameState` field
(`hostage` pegs-on-a-card, `add-tokens`, `auction` IOU debt, `vote` ballots) is **refused by the
type**, which is the honest refusal — cf. `executable.ts:306-316`.

In the reducer, `apply` is one `case` plus one new interpreter:

```ts
    case 'apply': {
      return runInstruction(state, source, effect.do, ctx, fire, cardId);
    }
```

and `runInstruction`'s `switch` labels become `EXECUTED_INSTRUCTIONS`, sliced by a new
`instructionVerbs()` reader in `reducer-parity.test.ts`, mirroring `resolvedTargets()`.

---

## 3. Guard-honesty mechanism

### 3.1 Keep the slicing? — **Yes. Keep it, and add a second layer beside it.**

The slicing is load-bearing in three places that no imported registry can replace:

- `DEADLINE_OPS` in `semantic-agreement.test.ts` is derived from `isScoped`'s source
  (`semantic-agreement.test.ts:632-633` slices `function isScoped(`).
- Per-op field lists: `reducer-parity.test.ts:344-352` needs to know whether *this case body*
  contains `effect.<field>`. Only source text answers that. `:268` and `:278` do the same for
  `target` (bare word) and `n` (with the raw-push ban at `:305`).
- The directional set claims: `:208` (`EXECUTED_OPS` keys ⇄ slice labels) and `:212`
  (`EXECUTED_OPS` keys ⇄ `EFFECT_OPS`).

An "import the registry and assert by execution" replacement would have to answer *"does the
`lose-any` case read `effect.per`?"* — and execution cannot. Worse, `reduce` is not a pure
function of a card (`reducer-parity.test.ts:72-75` says so explicitly), so any execution-based
field oracle needs a fixture per (op, field) pair and becomes a fuzz harness. **Keep the parser.
Add an execution layer for the claim the parser cannot make: that a case is not inert.**

### 3.2 What currently lets a fake op through

`reducer-parity.test.ts:85` is `/^ {4}case '([^']+)':/gm`. It matches a *label*. It does not care
what follows. So these three all pass today:

```ts
case 'hostage':
  return s;                       // label present, body inert
case 'donate':                    // unreachable — dead code after a `return`
  …
case 'fill-zone':                 // falls through into the next case
  …
case 'sideways':                  // right indent, wrong switch (nested 6-space case)
```

`executable.ts:546` already documents the underlying hazard: *"an unknown op returns undefined
and the next `reduce` call throws on it"* — there is no `default:` in the switch.

### 3.3 The additional assertions (add to `reducer-parity.test.ts`, layer 1)

**A — every case body RETURNS.** The structural convention is uniform: every `case` in
`applyEffect` ends in `return` (`reduce.ts:1677`, `:1701`, `:1711`, `:1718`, `:1769`, `:1775`; the
one-liners at `:1777-1783` are `return raiseVoterDecision(...)`).

```ts
it('every case body ends in a return, so no case can fall through into the next', () => {
  for (const [op, body] of Object.entries(CASES)) {
    expect(/\breturn\b[\s\S]*\}\s*$/, `${op} ends in a return`).toBe(true);
  }
});
```

**B — no case body is the identity.** This is the direct answer to "a `case` that exists but does
nothing".

```ts
/** Ops whose whole semantic is "return the state unchanged". Empty today, on purpose. */
const INERT_BY_DESIGN: ReadonlySet<string> = new Set();

it('no case body is `return s;` unless it is INERT_BY_DESIGN', () => {
  for (const [op, body] of Object.entries(CASES)) {
    if (INERT_BY_DESIGN.has(op)) continue;
    const norm = body
      .replace(/case '[^']+':/, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, '');
    expect(norm, `${op} is not an identity case`).not.toBe('{returns;}');
  }
});
```

Note this deliberately does **not** fire on `'evict'` / `'discard-voter'` / `'convert-voter'`
(`reduce.ts:1776-1783`), which are thin but real delegations.

**C — the slice cannot see a nested or misindented case.** Add a count check so a `case` living
at the wrong indentation is *found* rather than silently excluded from `CASES`:

```ts
it('the case-label count equals the switch-label count, so no case hides from the slicer', () => {
  const src = reducerSource();                       // existing helper, :934-936
  const inSwitch = src.slice(src.indexOf('switch (effect.op)'), src.indexOf('function applyEffects'));
  const labels = [...inSwitch.matchAll(/case '([^']+)':/g)].map((m) => m[1]).sort();
  expect(labels).toEqual(Object.keys(CASES).sort());
});
```

**D — reachability, proved by execution, not by parse.** The parser can prove a case *exists and
ends in a return*; it cannot prove the code path is live. So add the execution oracle the repo
currently lacks entirely — one test, one minimal instance per op:

```ts
/** Every op gets a minimal instance here. A missing entry fails the test, not the suite. */
const MINIMAL_EFFECT: Readonly<Record<Effect['op'], Effect>> = { /* …20+, then the new ones… */ };

describe('every registered op is EXECUTED, not merely declared', () => {
  for (const op of Object.keys(EXECUTED_OPS) as Effect['op'][]) {
    it(`${op} changes state or raises a decision`, () => {
      const before = fixture();
      const after = applyEffectForTest(before, 'p1', MINIMAL_EFFECT[op]);
      expect(
        after !== before || (after.pending?.length ?? 0) > (before.pending?.length ?? 0),
        `${op} did nothing at all — it is a declared op with no behaviour`,
      ).toBe(true);
    });
  }
});
```

This needs one new export from the engine — `applyEffectForTest`, a thin wrapper over the
existing non-exported `applyEffect` (`reduce.ts:1540`) that supplies `NO_FIRE` and
`cardId: null`. That is the *entire* cost of the execution layer: one exported symbol.

`apply` is exempt from assertion D in its minimal form only if `MINIMAL_EFFECT.apply` is
`{ op: 'apply', do: [{ do: { op: 'gain', res: { funds: 1 } } }] }` — which does mutate state, so
it needs no exemption. Good: the escape hatch is held to the same bar as everything else.

### 3.4 Where the single source of truth lives

**The union in `packages/engine/src/cards.ts` is the single source of truth. The slice is a
two-way consistency oracle, never a source.** This is already true and already load-bearing:

| artefact | obligation | enforced at |
|---|---|---|
| `Effect['op']` union | the vocabulary | — |
| `EFFECT_OPS` | `=` union | `effect-ops.ts:34` `satisfies` + `:40` `Exclude<…, never>` (compile) |
| `EXECUTED_OPS` | exhaustive `Record<Effect['op'], …>` | `executable.ts:58` (compile); `:212` (test) |
| `applyEffect` `case` labels | `=` `EXECUTED_OPS` keys | `reducer-parity.test.ts:208` (both directions) |
| per-op field list | every claimed field appears in the body | `:344-352` (generic) |

Because `EXECUTED_OPS` is an exhaustive `Record` over the union, "op added to the union, no
registry entry" is a **compile error**, not a runtime hole. And `:208` compares *sorted* keys both
ways, so `case` in one place only also fails. The union cannot disagree with the three
derivatives.

The consequence for `reduce.ts` being the parsed artefact: **that is correct and should not
change.** `reduce.ts` is the *authority* (it decides what the engine does); the registry is a
*promise about* it; the test compares them in both directions. If `reduce.ts` instead imported
the registry, the test would compare the registry to itself and the whole file would be
vacuous. Add exactly one new derivation for the new seam — `instructionVerbs()` slicing
`runInstruction`'s `switch` labels — and register it as `EXECUTED_INSTRUCTIONS` beside
`EXECUTED_TARGETS` (`executable.ts:233-240`).

The one place drift is still possible: a **field** on an op that the type declares but the case
ignores. That is caught generically at `:344-352` for every op and every field with no per-field
test needed — which is why the new fields in §2b need no test of their own.

---

## 4. Sequencing

Ordered by cost per card, each step green before the next.

| # | Change | Kind | Cards unlocked | Cost |
|---|---|---|---|---|
| 1 | `lose.asDonation` | field | the donate-to-named-player cards | move the `p !== source` gate at `reduce.ts:1686` to `!effect.asDonation`; one `EXECUTED_OPS` token (`lose` gains `asDonation`) |
| 2 | `upTo?: true` on the Count ops | field | "up to N" phrasing, common in Headlines | `resolveCount` variant; one token per op |
| 3 | `on?: 'success' \| 'failure'` on an answer side | field | the conditional-answer Conspiracies | read in `ANSWER`; X-card level, so no `EXECUTED_OPS` row |
| 4 | `move-peg.to` | field | peg-relocation Headlines | one `EXECUTED_OPS` token |
| 5 | `Restriction.zones` + 5 new `RestrictionKind`s | type + registry | `no-gerrymander`, `no-obligation`, `newest-wins`, `one-chosen-power`, `no-gerrymander-in-volatile` | a consult site each; the `zones` field makes `protected-majority` expressible |
| 6 | `'adjacent'` `ZoneSelector` | type + registry | adjacency Headlines | a case in `resolveZone`; add to `EXECUTABLE_ZONE_SELECTORS` in the same commit |
| 7 | 5 new `ComputedSource`s | type + registry | `spent-resources`, `discarded-voters`, `your-mat-voters`, `majorities-you-hold`, `event-voters` | cases in `computedValue()` |
| 8 | `fill-zone` | **new op** | the zone-fill Conspiracies | a real `case`; a new `EXECUTED_OPS` row; one `MINIMAL_EFFECT` entry |
| 9 | `draw-card` | **new op, possibly unnecessary** | the headline-draw cards | first re-check `DRAW` (`executable.ts:119-127`) — if `headline` is already a `DRAW` key, the cards ship as `reveal` and step 9 is deleted |
| 10 | `apply { do }` | **new op + new seam** | the residue: `on:'tokens-reach'`-shaped clauses, per-op `read` combinations | `runInstruction` + `instructionVerbs()` + `EXECUTED_INSTRUCTIONS` + assertions A–D |

Steps 1-4 are pure field widenings: **no new `case`, no new registry row, no new test.** The
generic assertion at `:344-352` picks them up, and `EXECUTED_OPS` gains one token per op per field.
That is why they go first — they are the cheapest possible confirmation that the guard accepts
new surface area correctly, before any test in §3 is changed.

Step 10 last, and only after A–D exist — because A–D are what make a general escape hatch
admissible in the first place.

**Never, under any step:** `hostage` (needs pegs-on-a-card state), `add-tokens` (needs a token
counter on `GameState`), `auction` / `vote` / `pass-card` (documented as *systems*, not ops, at
`executable.ts:306-316` and `:822-849`). These need `PlayerState` / `GameState` fields that change
`canAfford`, `enforceCap` and `poolTotal`, which every pool read in the engine assumes are
non-negative. The `Instruction` union in §2c refuses them by construction.

---

## Follow-ups

- `MINIMAL_EFFECT` must be added to in the same commit as any new op — make assertion D's
  exhaustiveness the thing that fails, so a new op cannot skip it.
- `INERT_BY_DESIGN` starts empty. If an op is ever genuinely identity, add it there with a
  one-line reason, in the same commit, so the exception is visible rather than inferred.
- `applyEffectForTest` is the only new engine export. Everything else stays where it is.
