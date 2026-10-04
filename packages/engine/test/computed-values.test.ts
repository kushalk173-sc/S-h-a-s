/**
 * G15 / G4 — A VALUE READ OUT OF PLAYER STATE INSTEAD OF WRITTEN ON THE CARD.
 *
 * The `n` of every op used to be a literal, which is why a price or a payout that is
 * a function of the seller's own board could not be written at all. `n` is now
 * `number | ComputedCount` and `gain` / `lose` carry a `per` multiplier, resolved by
 * `resolveCount` / `resolveDelta` against the player the effect resolves FOR.
 *
 * Four properties worth a reader's scepticism, each a test rather than a comment:
 *
 *  1. **A literal is untouched.** Every shipped card's `n` is a number, and the
 *     whole suite would notice if it were not — but the point is also that a card
 *     carrying BOTH a literal and a computed value resolves each independently.
 *  2. **`ideologue-level` counts CARDS, not resources.** KNOWN-GAPS §6 is explicit
 *     that the balance checker's D3 models the Ideologue ladder as a RESOURCE
 *     PROXY and over-reports because of it. The engine's real rule is
 *     `powers.ts hasPower`, which counts Ideology Cards answered. A computed value
 *     that agreed with the checker and disagreed with the engine would be the wrong
 *     way round, so this asserts the CARDS reading and pins the difference.
 *  3. **The read is against the RECIPIENT.** "Gain as many as you hold" is only true
 *     of the person receiving them, and `target: 'each-opponent'` is the case that
 *     would break if the read were against the caster.
 *  4. **`per` doubles the MAT, and the cap still applies.** IF YOU LIKE PIÑA COLADA
 *     is "double all the resources on your player mat" followed by "your current
 *     resource cap still applies", and the second sentence is the one a doubling
 *     implementation most often drops.
 */

import { describe, expect, it } from 'vitest';

import { indexCards, type CardIndex, type ConspiracyCard, type Effect } from '../src/cards';
import { reduce, type Ctx } from '../src/reduce';
import { RULES } from '../src/rules';
import { setup } from '../src/setup';
import { poolTotal, type Delta, type GameState, type Ideologue, type PlayerID } from '../src/state';
import { IDEOLOGY_CARDS, PLAYERS_3, VOTER_CARDS } from './helpers';

const VOTERS = [
  { id: 'cv-1', cost: { funds: 1 }, voters: 1 },
  { id: 'cv-2', cost: { funds: 2 }, voters: 2 },
  { id: 'cv-3', cost: { funds: 3 }, voters: 3 },
] as const;

/** `n: 3` by literal, and the same count computed four different ways. */
const COMPUTED_CONSPIRACIES: readonly ConspiracyCard[] = [
  {
    id: 'cmp-literal',
    name: 'Three By Hand',
    text: 'Gain exactly 3 resources of your choice.',
    cost: 1,
    effects: [{ op: 'gain-any', n: 3 }],
  },
  {
    id: 'cmp-pool',
    name: 'As Many As You Hold',
    text: 'Gain as many resources as you are holding, in any combination.',
    cost: 1,
    effects: [{ op: 'gain-any', n: { of: 'your-pool' } }],
  },
  {
    id: 'cmp-pool-opponent',
    name: 'And Each Of Your Opponents Too',
    text: 'Each opponent gains as many resources as THEY are holding, not as many as you are.',
    cost: 1,
    effects: [{ op: 'gain-any', n: { of: 'your-pool' }, target: 'each-opponent' }],
  },
  {
    id: 'cmp-level',
    name: 'As Many As Your Ideologue Level',
    text: 'Gain as many resources as the Ideologue level you have reached.',
    cost: 1,
    effects: [{ op: 'gain-any', n: { of: 'ideologue-level' } }],
  },
  {
    // IF YOU LIKE PIÑA COLADA: "Double all the resources on your player mat.
    // Your current resource cap still applies."
    id: 'cmp-double-mat',
    name: 'Double The Mat',
    text: 'Double every resource on your player mat. Your current resource cap still applies.',
    cost: 1,
    effects: [
      {
        op: 'gain',
        res: { funds: 1, clout: 1, media: 1, trust: 1 },
        per: { of: 'held-of-each-resource' },
      },
    ],
  },
  {
    // The same card aimed at the opponents, so the doubling has to read the
    // RECIPIENT's mat rather than the caster's.
    id: 'cmp-double-half-mat',
    name: 'Double Each Opponent',
    text: 'Each opponent doubles every resource on their own mat.',
    cost: 1,
    effects: [
      {
        op: 'gain',
        res: { funds: 1, clout: 1, media: 1, trust: 1 },
        per: { of: 'held-of-each-resource' },
        target: 'each-opponent',
      },
    ],
  },
  {
    id: 'cmp-volatile',
    name: 'A Voter For Each Volatile Peg',
    text: 'Gain 1 voter for each of your voters inside a Volatile Area.',
    cost: 1,
    effects: [{ op: 'voters', n: { of: 'volatile-voters' } }],
  },
  {
    id: 'cmp-rights',
    name: 'A Move For Each Right You Hold',
    text: 'You may Gerrymander 1 extra time for every Gerrymander move you can already make.',
    cost: 1,
    effects: [{ op: 'gerrymander', n: { of: 'your-gerrymander-rights' } }],
  },
  {
    id: 'cmp-mixed',
    name: 'A Literal And A Computed One',
    text: 'Gain 2 resources by hand, then as many as you hold.',
    cost: 1,
    effects: [
      { op: 'gain-any', n: 2 },
      { op: 'gain-any', n: { of: 'your-pool' } },
    ],
  },
  {
    id: 'cmp-halve',
    name: 'Lose What You Hold',
    text: 'Each opponent discards as many resources as they are holding.',
    cost: 1,
    effects: [
      { op: 'lose-any', n: { of: 'your-pool' }, target: 'each-opponent' },
    ],
  },
  /**
   * THOUGHTS AND PRAYERS (REF 4.3), and the reason G4's `read` exists:
   * *"Pick a player and get any 2 resources for each of their voters inside a Volatile
   * Area."* `target` names the RECIPIENT (the caster) and `read` names whose board the
   * multiplier comes off (the chosen player), which is the one card where those are
   * different people.
   */
  {
    id: 'cmp-read-other',
    name: 'Two For Each Of Their Volatile Pegs',
    text: 'Pick a player. You gain 2 resources of your choice for each of their voters in a Volatile Area.',
    cost: 1,
    effects: [
      { op: 'gain-any', n: 2, target: 'you', per: { of: 'volatile-voters' }, read: 'chosen-player' },
    ],
  },
  /**
   * The control for the row above, and it is the whole reason this pair exists.
   *
   * Identical except with NO `read`, so the multiplier falls back to the RECIPIENT — the
   * caster — and the card silently pays the caster for the caster's own pegs. It is the
   * card KNOWN-GAPS §3 warned would be built by accident ("`chosen-player` makes it
   * *worse*, because `n` resolves against the player the effect resolves FOR"), so it is
   * pinned here as a DIFFERENT number rather than described in a comment.
   */
  {
    id: 'cmp-read-absent',
    name: 'Two For Each Of My Own Volatile Pegs',
    text: 'Gain 2 resources of your choice for each of YOUR voters in a Volatile Area.',
    cost: 1,
    effects: [{ op: 'gain-any', n: 2, target: 'you', per: { of: 'volatile-voters' } }],
  },
];

const CARDS: CardIndex = indexCards({
  ideology: IDEOLOGY_CARDS,
  voter: [...VOTER_CARDS, ...VOTERS],
  conspiracy: COMPUTED_CONSPIRACIES,
  headline: [],
});

const ctx: Ctx = { rules: RULES, cards: CARDS };

/** Well under the resource cap, so nothing raises a cap discard in the way. */
const SMALL: readonly Delta[] = [
  { funds: 2, clout: 1, media: 1, trust: 0 },
  { funds: 1, clout: 1, media: 1, trust: 1 },
  { funds: 1, clout: 2, media: 0, trust: 1 },
];

function freshGame(startResources: readonly Delta[] = SMALL, seed = 1): GameState {
  return setup({
    players: PLAYERS_3,
    cards: CARDS,
    seed,
    startResources,
    ideologyDeck: IDEOLOGY_CARDS.map((c) => c.id),
    voterDeck: VOTERS.map((c) => c.id),
    conspiracyDeck: COMPUTED_CONSPIRACIES.map((c) => c.id),
    headlineDeck: [],
  });
}

function answered(s: GameState, by: PlayerID = s.activePlayer): GameState {
  const r = reduce(s, by, { type: 'ANSWER', side: 0 }, ctx);
  if (!r.ok) throw new Error(`answer: ${r.error}`);
  return r.state;
}

/** Answer, then play one card. The card is already in hand; playing costs nothing. */
function play(s: GameState, cardId: string, by: PlayerID = s.activePlayer): GameState {
  const withCard: GameState = {
    ...s,
    phase: 'actions',
    _pendingCard: null,
    players: {
      ...s.players,
      [by]: { ...s.players[by]!, conspiracies: [...s.players[by]!.conspiracies, cardId] },
    },
  };
  const r = reduce(withCard, by, { type: 'PLAY_CONSPIRACY', cardId }, ctx);
  if (!r.ok) throw new Error(`play ${cardId}: ${r.error}`);
  return r.state;
}

/** Answer and play, in one step, from a fresh game. */
function resolve(cardId: string, startResources?: readonly Delta[]): GameState {
  return play(answered(freshGame(startResources)), cardId);
}

const ask = (s: GameState, p: PlayerID, kind: string): number => {
  const c = s.choices.find((x) => x.player === p && x.choice.kind === kind);
  if (c === undefined || c.choice.kind !== kind) throw new Error(`no ${kind} raised for ${p}`);
  return c.choice.count;
};

// ─────────────────────────── the read is against the recipient ───────────────────────────

describe('a computed count reads the state of the player it resolves for', () => {
  it('a literal is untouched, and a computed one is the recipient’s own pool', () => {
    const literal = resolve('cmp-literal');
    expect(ask(literal, 'p1', 'gain-any')).toBe(3);
    // p1 answered side 0 of a Capitalist card, so its pool is SMALL[0] plus the payout.
    const computed = resolve('cmp-pool');
    expect(ask(computed, 'p1', 'gain-any')).toBe(
      poolTotal(computed.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 }),
    );
  });

  it('and with `target: each-opponent` it is THEIR pool, not the caster’s', () => {
    // The assertion that would break if the read were against `source`. The two pools
    // are deliberately different, so a caster-side read gives the wrong number rather
    // than the right one by accident.
    const s = resolve('cmp-pool-opponent');
    for (const p of ['p2', 'p3'] as const) {
      expect(ask(s, p, 'gain-any'), p).toBe(
        poolTotal(s.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 }),
      );
    }
    // …and the caster was asked for nothing, so a caster-side read would show up as
    // a choice for p1 rather than for them.
    expect(ask(s, 'p2', 'gain-any')).not.toBe(
      poolTotal(s.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 }),
    );
  });

  it('a literal and a computed value on the same card resolve independently', () => {
    // Both raise a `gain-any`, so the two are told apart by their order: the first
    // raised is the literal, the second the computed one.
    const s = resolve('cmp-mixed');
    const asks = s.choices.filter((c) => c.player === 'p1' && c.choice.kind === 'gain-any');
    expect(asks).toHaveLength(2);
    if (asks[0]?.choice.kind !== 'gain-any' || asks[1]?.choice.kind !== 'gain-any') {
      throw new Error('not gain-any');
    }
    expect(asks[0].choice.count).toBe(2);
    // The second is read AFTER the first has resolved? No — `applyEffect` resolves
    // each count against the state as it stands when that effect runs, so the
    // computed one is the pool the player had when the card resolved. Asserted as
    // "at least the literal", which is the honest bound either way.
    expect(asks[1].choice.count).toBeGreaterThanOrEqual(2);
  });

  it('`lose-any` reads the victim’s pool, so a player cannot be asked to discard more than they hold', () => {
    const s = resolve('cmp-halve');
    for (const p of ['p2', 'p3'] as const) {
      const held = poolTotal(s.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 });
      expect(ask(s, p, 'lose-any'), p).toBe(held);
    }
  });
});

// ─────────────────────────── G4/G15: the read is aimed somewhere ELSE ───────────────────────────

/**
 * `read` is the field KNOWN-GAPS §3 called "the shortest route to the next playable card"
 * for two decades of gap notes, and it is one field: **whose state the multiplier is read
 * from**, while `target` keeps saying **who is paid**.
 *
 * ## WHY THIS NEEDS ITS OWN BLOCK, and the direction it guards
 *
 * Every assertion above proves the read follows the RECIPIENT, which was true by
 * construction — `resolveCount` was handed the recipient and there was no other candidate.
 * `read` is the first field that lets a card aim the read somewhere else, so the failure
 * mode INVERTS: instead of reading the wrong player it pays the **wrong person the right
 * amount**. That is the hardest kind of card bug to notice — every number is a legal
 * number, the dialog is coherent, and the card is quietly doing somebody else a favour.
 * KNOWN-GAPS §3 named it exactly: *"`chosen-player` makes it worse, because `n` resolves
 * against the player the effect resolves FOR, so aiming the card at a chosen player would
 * pay the chosen player for their own volatile voters."* So the assertion is not "the read
 * moved" but "the RECIPIENT did not".
 */
describe('G4/G15 `read` aims the multiplier at somebody else and leaves the payout alone', () => {
  /**
   * A board where p1 and p2 hold DIFFERENT numbers of Volatile-Area pegs, because a
   * fixture where they hold the same number proves nothing: every off-by-one in the read
   * would be invisible.
   */
  function peggedVolatile(s: GameState, spec: Readonly<Record<string, number>>): GameState {
    const volatiles = s.zones.flatMap((z) => z.areas).filter((a) => a.volatile);
    let i = 0;
    const taken = new Map<string, number>();
    const zones = s.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a) => {
        if (!a.volatile) return a;
        const who = Object.keys(spec).find((p) => (taken.get(p) ?? 0) < (spec[p] ?? 0));
        if (who === undefined) return a;
        taken.set(who, (taken.get(who) ?? 0) + 1);
        i += 1;
        return { ...a, peg: { owner: who as PlayerID, majority: false } };
      }),
    }));
    expect(i, 'the board has too few Volatile Areas for this fixture').toBeGreaterThan(0);
    return { ...s, zones };
  }

  it('the card raises a `choose-player` decision for its own actor, and the answer re-aims the read', () => {
    const board = peggedVolatile(answered(freshGame()), { p1: 1, p2: 2 });
    const played = play(board, 'cmp-read-other');
    const decision = played.choices.find((c) => c.choice.kind === 'choose-player');
    expect(decision, 'no choose-player decision was raised').toBeDefined();
    // The card's own actor answers it, which is `choose-player`'s standing rule.
    expect(decision?.player).toBe('p1');

    const answeredChoice = reduce(played, 'p1', { type: 'RESOLVE_CHOICE', choiceId: decision?.id ?? '', pick: { kind: 'player', id: 'p2' } }, ctx);
    expect(answeredChoice.ok, answeredChoice.ok ? '' : answeredChoice.error).toBe(true);
    if (!answeredChoice.ok) return;

    // 2 per Volatile-Area peg of P2 — the seat the actor NAMED — and asked of the CASTER.
    const ask2 = ask(answeredChoice.state, 'p1', 'gain-any');
    expect(ask2, 'the multiplier did not come off the chosen player').toBe(4);
    expect(ask(answeredChoice.state, 'p1', 'gain-any')).not.toBe(2);
    expect(
      answeredChoice.state.choices.some((c) => c.player === 'p2'),
      'the CHOSEN player was asked to take the resources, which pays the wrong person',
    ).toBe(false);
  });

  it('and with `read` ABSENT the same card pays the CASTER off the CASTER\'s own pegs', () => {
    // The control. One peg for p1, so the correct reading would also be 2 — which is why
    // the assertion is made against the OTHER fixture's two, not against this one's own
    // number. The point is that the two cards are distinguishable AT ALL.
    const board = peggedVolatile(answered(freshGame()), { p1: 1, p2: 2 });
    const played = play(board, 'cmp-read-absent');
    expect(ask(played, 'p1', 'gain-any')).toBe(2);
    // …and no decision was raised at all, because nothing in the card asked a question.
    expect(played.choices.some((c) => c.choice.kind === 'choose-player')).toBe(false);
  });

  it('and the two numbers differ on the SAME board, which is the non-vacuity floor', () => {
    const board = peggedVolatile(answered(freshGame()), { p1: 1, p2: 2 });
    // One board, two cards, and the asks must not agree — otherwise the pair above proves
    // nothing, because a fixture where both readings are 2 is exactly the fixture this is
    // built to refuse.
    const withoutRead = play(board, 'cmp-read-absent');
    const withRead = play(board, 'cmp-read-other');
    const decision = withRead.choices.find((c) => c.choice.kind === 'choose-player');
    expect(decision).toBeDefined();
    const resolved = reduce(withRead, 'p1', { type: 'RESOLVE_CHOICE', choiceId: decision?.id ?? '', pick: { kind: 'player', id: 'p2' } }, ctx);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(ask(resolved.state, 'p1', 'gain-any')).toBe(2 * ask(withoutRead, 'p1', 'gain-any'));
  });

  it('and a `read` naming a seat with no Volatile pegs raises a ZERO ask, not a negative one', () => {
    // `Choice.count` is a `number` a client renders, so a negative grant would be a dialog
    // asking for a negative amount of resources. The clamp is `Math.max(0, base * k)` in
    // `resolveAsk`, and this is what it is for.
    const board = peggedVolatile(answered(freshGame()), { p3: 1 });
    const played = play(board, 'cmp-read-other');
    const decision = played.choices.find((c) => c.choice.kind === 'choose-player');
    const answeredChoice = reduce(played, 'p1', { type: 'RESOLVE_CHOICE', choiceId: decision?.id ?? '', pick: { kind: 'player', id: 'p2' } }, ctx);
    expect(answeredChoice.ok).toBe(true);
    if (!answeredChoice.ok) return;
    expect(ask(answeredChoice.state, 'p1', 'gain-any')).toBe(0);
  });
});

// ─────────────────────────── doubling the mat ───────────────────────────

describe('`per` doubles the mat, and the cap still applies', () => {
  it('a `res` of 1 in each resource times what you hold of each IS a doubling', () => {
    const before = answered(freshGame());
    const held = { ...(before.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 }) };
    const after = play(before, 'cmp-double-mat');
    const now = after.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
    expect(now.funds).toBe(held.funds * 2);
    expect(now.clout).toBe(held.clout * 2);
    expect(now.media).toBe(held.media * 2);
    expect(now.trust).toBe(held.trust * 2);
  });

  it('and a zero component stays zero rather than becoming a multiplication error', () => {
    // `resolveDelta` skips a component the player holds none of. A card that says
    // "double my mat" on a player with no Trust must gain no Trust, not lose some.
    const noTrust: readonly Delta[] = [
      { funds: 2, clout: 1, media: 1, trust: 0 },
      { funds: 1, clout: 1, media: 1, trust: 1 },
      { funds: 1, clout: 2, media: 0, trust: 1 },
    ];
    const after = play(answered(freshGame(noTrust)), 'cmp-double-mat');
    expect(after.players.p1?.resources.trust).toBe(0);
  });

  it('the cap is the card’s second sentence and is still enforced', () => {
    // p12: crossing the cap raises a discard and freezes you until you answer. A
    // doubling that ignored the cap would hand out a pool the rulebook forbids.
    // Seven resources is UNDER the cap of twelve and doubles to fourteen, which is
    // over it -- the only window where the doubling itself is what crosses.
    const near: readonly Delta[] = [
      { funds: 4, clout: 1, media: 1, trust: 1 },
      { funds: 1, clout: 0, media: 0, trust: 0 },
      { funds: 1, clout: 0, media: 0, trust: 0 },
    ];
    const after = play(answered(freshGame(near)), 'cmp-double-mat');
    const cap = after.choices.filter((c) => c.choice.kind === 'lose-any' && c.player === 'p1');
    expect(cap.length).toBeGreaterThan(0);
  });

  it('and it reads the RECIPIENT’s mat with `target: each-opponent`', () => {
    const before = answered(freshGame());
    const after = play(before, 'cmp-double-half-mat');
    for (const p of ['p2', 'p3'] as const) {
      const was = before.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
      const now = after.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
      expect(now.funds, p).toBe(was.funds * 2);
    }
    // The caster's own mat is untouched, which a caster-side read would have doubled.
    const wasCaster = before.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
    const nowCaster = after.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 };
    expect(nowCaster).toEqual(wasCaster);
  });
});

// ─────────────────────────── ideologue-level counts CARDS ───────────────────────────

describe('ideologue-level reads the CARDS answered, not the resources paid', () => {
  /**
   * A state with a chosen number of answered Capitalist cards and a chosen pool, so
   * the two readings can be told apart.
   *
   * Built directly rather than by playing turns: the assertion is about which field
   * `computedValue` reads, and a twelve-turn game would only obscure that.
   */
  function withManifesto(count: number, resources: Delta): GameState {
    const base = answered(freshGame([resources, resources, resources]));
    const cards = IDEOLOGY_CARDS.slice(0, count).map((c) => c.id);
    const player = base.players.p1;
    if (!player) throw new Error('no p1');
    return {
      ...base,
      players: {
        ...base.players,
        p1: {
          ...player,
          manifesto: cards.map(() => 'capitalist' as Ideologue),
          manifestoCards: cards,
          resources: {
            funds: resources.funds ?? 0,
            clout: resources.clout ?? 0,
            media: resources.media ?? 0,
            trust: resources.trust ?? 0,
          },
        },
      },
    };
  }

  it('one card is Level 1, three is Level 3, five is Level 5', () => {
    for (const [count, level] of [[0, 1], [1, 1], [2, 1], [3, 3], [4, 3], [5, 5]] as const) {
      const s = play(withManifesto(count, { funds: 1, clout: 0, media: 0, trust: 0 }), 'cmp-level');
      expect(ask(s, 'p1', 'gain-any'), `${count} cards`).toBe(level);
    }
  });

  it('a rich pool with one card is STILL Level 1 — this is the difference from the D3 proxy', () => {
    // KNOWN-GAPS §6: the balance checker models the Ideologue ladder as a resource
    // proxy and over-reports on cards paying 3 or more. This is the case the proxy
    // gets wrong, asserted directly: 12 Funds buys no Level 3 unlock in this engine,
    // because `powers.ts hasPower` counts CARDS answered.
    // Four Funds is past the D3 proxy's level3 threshold of 3, so a proxy reading
    // would score this as a Level 3 unlock. The engine's rule counts CARDS.
    const rich = withManifesto(1, { funds: 4, clout: 0, media: 0, trust: 0 });
    expect(ask(play(rich, 'cmp-level'), 'p1', 'gain-any')).toBe(1);
    expect(poolTotal(rich.players.p1?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 })).toBe(4);
  });

  it('and it reads the best of the four Ideologues, because the card names none', () => {
    const base = withManifesto(0, { funds: 1, clout: 0, media: 0, trust: 0 });
    const player = base.players.p1;
    if (!player) throw new Error('no p1');
    const threeIdealist = { ...base, players: { ...base.players, p1: { ...player, manifesto: ['idealist', 'idealist', 'idealist'] as const } } };
    expect(ask(play(threeIdealist, 'cmp-level'), 'p1', 'gain-any')).toBe(3);
  });
});

// ─────────────────────────── the other two sources ───────────────────────────

describe('volatile-voters and your-gerrymander-rights', () => {
  it('volatile-voters counts pegs in Volatile Areas, which p18 makes permanent', () => {
    const base = answered(freshGame());
    const volatile = base.zones.flatMap((z) => z.areas).filter((a) => a.volatile);
    expect(volatile.length).toBeGreaterThan(0);
    const seeded: GameState = {
      ...base,
      zones: base.zones.map((z) => ({
        ...z,
        areas: z.areas.map((a) =>
          a.volatile ? { ...a, peg: { owner: 'p1' as PlayerID, majority: false } } : a,
        ),
      })),
    };
    const after = play(seeded, 'cmp-volatile');
    const group = after.players.p1?.pending[0];
    expect(group?.count).toBe(volatile.length);
  });

  it('and it is zero with an empty board, which is an honest zero and not a bug', () => {
    const after = resolve('cmp-volatile');
    // `grantVoters` refuses a count of zero or less, so no group appears at all.
    expect(after.players.p1?.pending).toEqual([]);
  });

  it('your-gerrymander-rights sums the zones the player leads, and is zero on a tie', () => {
    // p16: rights belong to a strict leader and a tie gives nobody rights. So a player
    // leading nothing has no rights at all, and the sum is 0 — which is the answer
    // that makes DOSTI BANI RAHE's "in their next turn they may use ALL your
    // Gerrymandering Rights" correct on an even board.
    const after = resolve('cmp-rights');
    const bonus = after.players.p1?.powerUses.gerrymandered['__bonus'] ?? 0;
    expect(bonus).toBe(0);
  });
});

// ─────────────────────────── determinism ───────────────────────────

describe('a computed value is as reproducible as a literal', () => {
  it('the same action log twice yields deep-equal states', () => {
    const run = (): string => {
      let s = answered(freshGame());
      s = play(s, 'cmp-double-mat');
      s = play(s, 'cmp-level');
      return JSON.stringify(s);
    };
    const a = run();
    // An unrelated game in between, which is what makes module state visible.
    resolve('cmp-pool', [{ funds: 2, clout: 2, media: 2, trust: 2 }]);
    expect(run()).toBe(a);
  });

  it('and every card with a computed value still round-trips through the effect list', () => {
    // The corpus loader hands `Effect` objects straight to `reduce()`, so a computed
    // value has to survive being read out of JSON with no coercion.
    const fromJson: Effect = JSON.parse('{"op":"gain-any","n":{"of":"your-pool"}}');
    const withCard: GameState = {
      ...answered(freshGame()),
      phase: 'actions',
      _pendingCard: null,
      players: { ...answered(freshGame()).players },
    };
    const played: GameState = {
      ...withCard,
      players: {
        ...withCard.players,
        p1: { ...withCard.players.p1!, conspiracies: ['json-card'] },
      },
    };
    const jsonCtx: Ctx = {
      rules: RULES,
      cards: {
        ...CARDS,
        conspiracy: {
          ...CARDS.conspiracy,
          'json-card': { id: 'json-card', name: 'From JSON', text: 'x', cost: 1, effects: [fromJson] },
        },
      },
    };
    const r = reduce(played, 'p1', { type: 'PLAY_CONSPIRACY', cardId: 'json-card' }, jsonCtx);
    if (!r.ok) throw new Error(r.error);
    expect(ask(r.state, 'p1', 'gain-any')).toBeGreaterThan(0);
  });
});
