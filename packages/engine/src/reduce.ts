/**
 * The SHASN reducer.
 *
 * Pure: `reduce(state, player, action, ctx)` always yields the same result for the
 * same inputs. No clock, no I/O, no `Math.random` — shuffles run off the seed
 * carried in state. That is what makes a game reproducible from its action log.
 *
 * Rule citations are page numbers in the Collectors Edition rulebook; the full
 * transcription lives in `docs/rules-reference.md`.
 */

import type { Action, ChoicePick, GameEvent, Result } from './actions';
import { allMajoritiesFormed, boardFull, recount, scores, winners } from './board';
import type {
  CardIndex,
  ComputedCount,
  ComputedSource,
  Count,
  Effect,
  EffectCondition,
  EffectDuration,
  EffectTarget,
  EffectTiming,
  EffectTrigger,
  Interrupt,
} from './cards';
import { hasPower, passiveBonus, usesLeft } from './powers';
import { applyDiscounts, canAfford, deltaError, overCap, subtract } from './resources';
import { shuffle } from './rng';
import type { Rules } from './rules';
import {
  IDEOLOGUE_RESOURCE,
  NO_POWER_USES,
  RESOURCES,
  deltaTotal,
  emptyAreas,
  findArea,
  findZone,
  gerrymanderRights,
  ideologyHandOf,
  isInForce,
  ownerNextTurn,
  pegsOf,
  poolTotal,
  roundEndTurn,
  tally,
  type Area,
  type AreaID,
  type CardID,
  type ChoiceScope,
  type Delta,
  type GameState,
  type InterruptWindow,
  type LiveEffect,
  type LogEntry,
  type PendingChoice,
  type PlayerID,
  type PlayerState,
  type Pool,
  type Resource,
  type Restriction,
  type RestrictionKind,
  type Zone,
} from './state';


export type Ctx = { readonly rules: Rules; readonly cards: CardIndex };

const fail = (error: string): Result => ({ ok: false, error });

// ─────────────────────────── small state helpers ───────────────────────────

function withPlayer(state: GameState, id: PlayerID, patch: Partial<PlayerState>): GameState {
  const p = state.players[id];
  if (!p) return state;
  return { ...state, players: { ...state.players, [id]: { ...p, ...patch } } };
}

function log(state: GameState, entry: Omit<LogEntry, 'turn'>): GameState {
  return { ...state, log: [...state.log, { ...entry, turn: state.turn }] };
}

function addResources(state: GameState, id: PlayerID, gain: Delta): GameState {
  const p = state.players[id];
  if (!p) return state;
  const resources: Pool = {
    funds: p.resources.funds + (gain.funds ?? 0),
    clout: p.resources.clout + (gain.clout ?? 0),
    media: p.resources.media + (gain.media ?? 0),
    trust: p.resources.trust + (gain.trust ?? 0),
  };
  return withPlayer(state, id, { resources });
}

/** Take resources, never below zero. Returns the state and what was actually taken. */
function takeResources(state: GameState, id: PlayerID, cost: Delta): [GameState, Delta] {
  const p = state.players[id];
  if (!p) return [state, {}];
  const taken: Delta = {};
  let resources = { ...p.resources };
  for (const r of RESOURCES) {
    const want = cost[r] ?? 0;
    const got = Math.min(want, resources[r]);
    if (got > 0) {
      taken[r] = got;
      resources = { ...resources, [r]: resources[r] - got };
    }
  }
  return [withPlayer(state, id, { resources }), taken];
}

/**
 * Push a pending decision, minting a unique id from the state's own counter.
 *
 * The counter lives in `GameState._idSeq`, not at module scope. A module-level
 * `let` would make `reduce` impure: ids would depend on how many games and tests
 * ran before this one, two concurrent games on one process would interleave
 * their ids, and a restart would invalidate every `choiceId` a client is still
 * holding. Every generated id must be a pure function of state + action. R2.
 */
function pushChoice(state: GameState, choice: PendingChoice['choice'], player: PlayerID): GameState {
  const seq = state._idSeq + 1;
  return {
    ...state,
    _idSeq: seq,
    choices: [...state.choices, { id: `c${seq}`, player, choice }],
  };
}

/**
 * p12: "If at any time you cross your resource cap, you must choose and discard any
 * excess resources down to your current resource cap. You cannot take any other
 * actions until you do so."
 */
function enforceCap(state: GameState, id: PlayerID, rules: Rules): GameState {
  const p = state.players[id];
  if (!p) return state;
  const excess = overCap(p.resources, rules.resourceCap);
  if (excess <= 0) return state;
  const already = state.choices.some(
    (c) => c.player === id && c.choice.kind === 'lose-any' && c.choice.reason === 'Resource cap',
  );
  if (already) return state;
  return pushChoice(state, { kind: 'lose-any', count: excess, reason: 'Resource cap' }, id);
}

function blockedBy(state: GameState, id: PlayerID): PendingChoice | undefined {
  return state.choices.find((c) => c.player === id);
}

// ─────────────────────────── deck plumbing ───────────────────────────

type DeckName = 'ideology' | 'voter' | 'conspiracy' | 'headline';

const DRAW = {
  ideology: '_ideologyDraw',
  voter: '_voterDraw',
  conspiracy: '_conspiracyDraw',
  headline: '_headlineDraw',
} as const;

const DISCARD = {
  ideology: '_ideologyDiscard',
  voter: '_voterDiscard',
  conspiracy: '_conspiracyDiscard',
  headline: '_headlineDiscard',
} as const;

/**
 * Draw one card, reshuffling the discard pile when the draw pile empties.
 * p10 says this explicitly for Voter Cards; the other decks behave the same way.
 */
function draw(state: GameState, deck: DeckName): [GameState, CardID | null] {
  let s = state;
  let pile = s[DRAW[deck]];
  if (pile.length === 0) {
    const discard = s[DISCARD[deck]];
    if (discard.length === 0) return [s, null];
    const [shuffled, seed] = shuffle(discard, s._seed);
    s = { ...s, [DRAW[deck]]: shuffled, [DISCARD[deck]]: [], _seed: seed };
    pile = s[DRAW[deck]];
  }
  const [top, ...rest] = pile;
  if (top === undefined) return [s, null];
  return [{ ...s, [DRAW[deck]]: rest }, top];
}

function discardTo(state: GameState, deck: DeckName, cardId: CardID): GameState {
  return { ...state, [DISCARD[deck]]: [...state[DISCARD[deck]], cardId] };
}

/** p10: three face-up Voter Cards must always be available on the HQ Mat. */
function refillMarket(state: GameState, ctx: Ctx): GameState {
  let s = state;
  const market = [...s.market];
  while (market.length < ctx.rules.marketSize) {
    const [next, id] = draw(s, 'voter');
    s = next;
    if (id === null) break;
    const card = ctx.cards.voter[id];
    if (!card) break;
    market.push({ cardId: id, cost: card.cost, voters: card.voters });
  }
  return { ...s, market };
}

function syncConspiracyTop(state: GameState, ctx: Ctx): GameState {
  const top = state._conspiracyDraw[0];
  const card = top ? ctx.cards.conspiracy[top] : undefined;
  return {
    ...state,
    conspiracyTopCost: card ? card.cost : null,
    conspiracyRemaining: state._conspiracyDraw.length,
  };
}

// ─────────────────────────── board mutation ───────────────────────────

type BoardEdit = { readonly state: GameState; readonly events: GameEvent[] };

/**
 * Write an area back and recount its zone, emitting majority events.
 *
 * The two board events are raised HERE rather than at the seven call sites, because
 * `setArea` is the only thing in the engine that can change a peg, and a trigger
 * registry that has to be remembered at every caller is a registry that will be
 * missed at one. `GERRYMANDER`, `PLACE_VOTERS`, the three powers and
 * `resolveChoice`'s voter branch all route through it, so all of them raise
 * `on-volatile-placement` and `on-majority-formed` for free.
 *
 * THE COST, and it is paid knowingly: `setArea` now needs `ctx` to fire a hook.
 * That is why the recursion is bounded rather than merely hoped-for — no effect op
 * calls `setArea`, so a hook cannot wake a hook through the board, and
 * `live-effects.test.ts` asserts that by reading `applyEffect`'s source.
 */
function setArea(state: GameState, area: Area, ctx: Ctx): BoardEdit {
  const zone = findZone(state, area.zone);
  if (!zone) return { state, events: [] };
  const before = zone.majorityHolder;
  const updated = recount({
    ...zone,
    areas: zone.areas.map((a) => (a.id === area.id ? area : a)),
  });
  const events: GameEvent[] = [];
  if (before !== updated.majorityHolder) {
    if (before) events.push({ type: 'majority-broken', zoneId: zone.id, player: before });
    if (updated.majorityHolder) {
      events.push({ type: 'majority-formed', zoneId: zone.id, player: updated.majorityHolder });
    }
  }
  let s: GameState = {
    ...state,
    zones: state.zones.map((z) => (z.id === updated.id ? updated : z)),
  };

  // p18: a peg in a Volatile Area is permanent and fires a Headline. The actor is the
  // peg's owner, not whoever performed the move — a gerrymander into a Volatile Area
  // attributes the Headline to the mover (D6, ruled in `GERRYMANDER`), but the
  // trigger hook belongs to whoever's voter landed there.
  if (area.volatile && area.peg !== null) {
    s = fireTriggers(
      s,
      {
        trigger: 'on-volatile-placement',
        actor: area.peg.owner,
        voters: 0,
        areaId: area.id,
        pegOwner: area.peg.owner,
      },
      ctx,
    );
  }
  if (updated.majorityHolder !== null && before !== updated.majorityHolder) {
    s = fireTriggers(
      s,
      {
        trigger: 'on-majority-formed',
        actor: updated.majorityHolder,
        voters: 0,
        areaId: area.id,
        pegOwner: updated.majorityHolder,
      },
      ctx,
    );
  }
  return { state: s, events };
}


// ─────────────────────────── effects ───────────────────────────

function resolveTargets(state: GameState, source: PlayerID, target: EffectTarget): PlayerID[] {
  switch (target) {
    case 'you':
      return [source];
    case 'each-opponent':
      return state.turnOrder.filter((p) => p !== source);
    case 'everyone':
      return [...state.turnOrder];
    case 'leader': {
      const s = scores(state);
      const best = Math.max(0, ...Object.values(s));
      const top = Object.entries(s).filter(([, v]) => v === best && v > 0);
      return top.length === 1 && top[0] ? [top[0][0]] : [];
    }
  }
}

/** Mint a group id from the state's counter. Same purity contract as `pushChoice`. R2. */
function grantVoters(
  state: GameState,
  id: PlayerID,
  count: number,
  source: string,
  sameZone: boolean,
): GameState {
  if (count <= 0) return state;
  const p = state.players[id];
  if (!p) return state;
  const seq = state._idSeq + 1;
  return {
    ...withPlayer(state, id, {
      pending: [...p.pending, { id: `g${seq}`, count, sameZone, source }],
    }),
    _idSeq: seq,
  };
}

/**
 * The event that woke a live effect, threaded into `applyEffect`.
 *
 * It is an ARGUMENT and never state: `reduce()` is a pure function of
 * `(state, action, ctx)`, and a fire context that lived in `GameState` would be one
 * more thing a replay from seed + action log has to reproduce. Passing it down means
 * a hook's effects can read "who just did this" without the reducer carrying a
 * mutable cursor.
 *
 * Only three ops read it today, each for one card:
 *  - `steal-any` takes its victim from `actor`, which is LAB-GROWN EARWORM's
 *    "every time THEY influence a Voter Card, they will give you 1 of their
 *    resources" (REF 4.2.1);
 *  - `movedMyVoter`, which compares `pegOwner` against the effect's owner and is
 *    GROWING DISSENT's "every time any opponent Gerrymanders your voters";
 *  - `influencedVotersAtLeast`, which is POWER TRIP's "every time you influence a
 *    3-Voter Card".
 */
export type FireContext = {
  readonly trigger: EffectTrigger;
  readonly actor: PlayerID;
  /** Voters on the purchased card. 0 for an event that is not a purchase. */
  readonly voters: number;
  /** The area a board event touched, where the event has one. */
  readonly areaId: AreaID | null;
  /** The owner of the voter a board event moved. GROWING DISSENT. */
  readonly pegOwner: PlayerID | null;
};

const NO_FIRE: FireContext | undefined = undefined;

/**
 * How many effects ONE firing event may set off, in total.
 *
 * RE-ENTRANCY, and why a number is the right answer. A wave applies at most one
 * live effect, and an effect that has already fired in this cascade is not eligible
 * again, so two hooks on the same event cost two waves and stop. A cycle among live
 * effects — A installs B, B re-arms A — would be the unbounded case, and the cap is
 * what makes it terminate rather than hang the server. Nothing in today's effect
 * vocabulary can install a live effect, so the cap is defence in depth rather than a
 * live hazard; `live-effects.test.ts` proves the clamp is real by driving the
 * cascade with an explicit budget of 1 and 2.
 *
 * 16 is far above the number of live effects a game can plausibly hold (each costs
 * a card from a 22-card Conspiracy deck or a 26-card Headline deck) and far below
 * anything that would stall a request.
 */
export const TRIGGER_MAX_WAVES = 16;

/**
 * G20 — the most Ideology Cards one player can be HOLDING at once.
 *
 * ## THIS IS A TERMINATION BOUND, NOT A RULES CLAIM
 *
 * The physical game has no such number, and asserting one would be a lie about the
 * rulebook. It is here because `move-card` is the first op in the effect vocabulary
 * that can ADD to a queue rather than resolve, and a queue an op can append to with
 * no bound is a hang: a card with `when: { trigger: 'on-turn-start' }` and
 * `to: 'hand'` would put one card in a hand every single turn, forever, from a deck
 * that `draw-conspiracy`'s `from: 'discard'` recycles. `TRIGGER_MAX_WAVES` does not
 * save it — that bound is per FIRING EVENT, and one event per turn is one wave per
 * turn, which is a slow leak rather than a fast one.
 *
 * The same reasoning is why the cap is checked before the card leaves the pile rather
 * than after: a refused move has to leave the world byte-identical, or a full hand
 * would be a way to destroy cards by accident and the `to: 'destroy'` accounting
 * above would stop meaning anything.
 *
 * ## WHY TWO
 *
 * 2 is the deepest the real corpus goes, and it comes from A COWARD OR A JOURNALIST?
 * — *"you may pass along a card you just received"* — which implies a card in flight
 * plus the one you are holding. 1 would be the minimum that makes the mechanic work
 * and would refuse that card's own text; anything higher is headroom the corpus never
 * asks for, and headroom in a bound is licence.
 */
export const IDEOLOGY_HAND_MAX = 2;

const NO_CONSUMED: ReadonlySet<string> = new Set();

/**
 * The trigger registry: fire every live effect hooked on this event.
 *
 * `consumed` is an ARGUMENT, threaded through the loop, precisely so the "already
 * fired" set is not module state and not a field on `GameState` — R2 forbids both.
 * Two identical calls with the same inputs take the same path and reach the same
 * state, which is what the replay test in `integration.test.ts` checks.
 *
 * `waves` is a parameter so a test can prove the clamp rather than assert it. The
 * production call sites pass nothing and take `TRIGGER_MAX_WAVES`.
 */
function fireTriggers(
  state: GameState,
  fire: FireContext,
  ctx: Ctx,
  waves: number = TRIGGER_MAX_WAVES,
  consumed: ReadonlySet<string> = NO_CONSUMED,
): GameState {
  let s = state;
  let done = consumed;
  for (let wave = 0; wave < waves; wave += 1) {
    const next = s.liveEffects.find(
      (le) =>
        !done.has(le.id) &&
        le.trigger === fire.trigger &&
        // `on-turn-start` means the OWNER's turn. Without this a hook would fire at
        // the top of every seat's turn, which is not what a card means when it says
        // "at the top of your turn" — and is the difference between one payout a turn
        // and one per player per turn.
        (fire.trigger !== 'on-turn-start' || fire.actor === le.owner) &&
        isInForce(le, s.turn) &&
        conditionHolds(le, fire),
    );
    if (next === undefined) return s;
    done = new Set([...done, next.id]);
    // The waking event IS threaded in, because `steal-any` reads `actor` for its
    // victim and that is the whole of LAB-GROWN EARWORM: "every time THEY influence
    // a Voter Card, they will give you 1 of their resources". The effect is applied
    // through `applyEffect` rather than `applyEffects`, so its own `when` / `until`
    // are inert here and cannot re-arm it — the cascade cannot install.
    for (const e of next.effects) s = applyEffect(s, next.owner, e, ctx, fire, next.sourceCardId);
    s = log(s, {
      player: next.owner,
      text: `${next.sourceCardId} takes effect.`,
      kind: 'card',
    });
  }
  return s;
}

/** Every key present must hold. `EffectCondition`'s doc is the rule; this is it. */
function conditionHolds(le: LiveEffect, fire: FireContext): boolean {
  const condition = le.condition;
  if (condition === undefined) return true;
  if (condition.byOwner !== undefined && (fire.actor === le.owner) !== condition.byOwner) {
    return false;
  }
  if (condition.influencedVotersAtLeast !== undefined) {
    if (fire.trigger !== 'on-voter-influenced') return false;
    if (fire.voters < condition.influencedVotersAtLeast) return false;
  }
  if (condition.movedMyVoter === true) {
    if (fire.trigger !== 'on-gerrymander') return false;
    if (fire.pegOwner !== le.owner) return false;
  }
  return true;
}


/**
 * Raise the voter-targeting decision for `kind`, one per player the card names.
 *
 * `target` says who is asked to decide, and the SCOPE follows from that: a player
 * the card named chooses among their own pegs, the caster keeps the reach it has
 * always had. See `ChoiceScope` in state.ts for why the corpus needs both.
 *
 * Three `case` arms call this rather than sharing one fallthrough block, and that is
 * deliberate: `packages/cards/test/reducer-parity.test.ts` re-derives the op list and
 * each op's read fields from THIS FILE'S TEXT by slicing between `case '…':` marks,
 * so a fallthrough group would attribute the shared body to whichever op happened to
 * be last and the registry would then claim the other two read nothing.
 */
function raiseVoterDecision(
  state: GameState,
  source: PlayerID,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
  n: Count,
  target: EffectTarget,
  ctx: Ctx,
): GameState {
  let s = state;
  for (const p of resolveTargets(s, source, target)) {
    const scope: ChoiceScope = p === source ? (kind === 'evict-voter' ? 'any' : 'others') : 'own';
    s = pushChoice(
      s,
      { kind, count: resolveCount(s, p, n, ctx), scope, reason: 'Card effect' },
      p,
    );
  }
  return s;
}

/**
 * Resolve a card's `n` against player state, before anything is pushed.
 *
 * G15 / G4: the `n` of every op used to be a literal, and a price or a payout that
 * is a function of the seller's own board cannot be one. The read is ALWAYS against
 * the player the effect is resolved FOR — the recipient of a `gain-any`, the victim
 * of a `lose-any`, the thief of a `steal-any` — because that is the only reading on
 * which "gain as many as you have" is true.
 *
 * A literal passes straight through, so every shipped card is bit-for-bit unchanged.
 */
function resolveCount(
  state: GameState,
  player: PlayerID,
  n: number | ComputedCount,
  ctx: Ctx,
): number {
  if (typeof n === 'number') return n;
  return computedValue(state, player, n.of, undefined, ctx);
}

/**
 * Resolve a `gain` / `lose` `res` against player state, applying `per`.
 *
 * `per: { of: 'held-of-each-resource' }` multiplies each resource by what the player
 * holds OF THAT RESOURCE, which is exactly IF YOU LIKE PIÑA COLADA's *"Double all
 * the resources on your player mat"*: a `res` of 1 in each resource, multiplied by
 * the holder's own count of each, is a doubling. The cap still applies afterwards,
 * because `applyEffect` runs `enforceCap` over whatever comes back — which is the
 * card's own second sentence, *"Your current resource cap still applies"*.
 */
function resolveDelta(
  state: GameState,
  player: PlayerID,
  res: Delta,
  per: ComputedCount | undefined,
  ctx: Ctx,
): Delta {
  if (per === undefined) return res;
  const out: Delta = {};
  for (const r of RESOURCES) {
    const base = res[r] ?? 0;
    if (base <= 0) continue;
    const k = computedValue(state, player, per.of, r, ctx);
    if (k <= 0) continue;
    out[r] = base * k;
  }
  return out;
}

/**
 * Read one computed quantity out of player state. Zero when it cannot be read.
 *
 * `ideologue-level` carries the caveat from KNOWN-GAPS §6, so it is worth stating
 * here where the value is actually produced. The balance checker's D3
 * `POWER_THRESHOLD_CLIFF` models the Ideologue ladder as a RESOURCE PROXY, because
 * it runs on one card in isolation with no manifestos and so cannot count cards.
 * This does not use that proxy: **the engine's real unlock rule counts Ideology
 * CARDS answered** (`powers.ts` `hasPower` is
 * `cardsOf(player, ideologue) >= rules.level3`), so this counts cards too. A player
 * who answers three Capitalist cards unlocks Prospecting whatever those cards paid;
 * a player who answers one Capitalist card paying 3 Funds unlocks nothing. Reading
 * resources here would have made the card agree with the checker and disagree with
 * the engine, which is the wrong way round.
 */
function computedValue(
  state: GameState,
  player: PlayerID,
  of: ComputedSource,
  resource: Resource | undefined,
  ctx: Ctx,
): number {
  const p = state.players[player];
  if (!p) return 0;
  switch (of) {
    case 'your-pool':
      return poolTotal(p.resources);
    case 'held-of-each-resource':
      return resource === undefined ? 0 : p.resources[resource];
    case 'volatile-voters':
      return countVolatilePegs(state, player);
    case 'your-gerrymander-rights':
      return totalGerrymanderAllowance(state, player, ctx.rules);
    case 'ideologue-level':
      return ideologueLevel(state, player, ctx.rules);
  }
}

/** p18: a peg in a Volatile Area is permanent, so this only ever goes up. */
function countVolatilePegs(state: GameState, player: PlayerID): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (a.volatile && a.peg?.owner === player) n += 1;
    }
  }
  return n;
}

/**
 * The best Ideologue LEVEL this player has reached: 5, else 3, else 1.
 *
 * From the card count, per the note on `computedValue`. Which Ideologue is the
 * player's own to choose — the card does not name one — so the best of the four is
 * taken, and 1 is the floor because "the Ideologue level this card is on" is always
 * at least Level 1.
 */
function ideologueLevel(state: GameState, player: PlayerID, rules: Rules): number {
  const p = state.players[player];
  if (!p) return 0;
  const counts = tally(p.manifesto);
  const best = Math.max(
    counts.capitalist,
    counts.supremo,
    counts.showstopper,
    counts.idealist,
  );
  if (best >= rules.level5) return 5;
  if (best >= rules.level3) return 3;
  return 1;
}

/**
 * Gerrymander moves still available across EVERY zone, which is the number a card
 * means by "the Gerrymandering Rights you have at this point" (DOSTI BANI RAHE).
 *
 * Summed over the zones where the player actually holds rights, p16: rights belong
 * to whoever has strictly more voters in a zone than anybody else, and a tie gives
 * nobody rights — so a zone the player does not lead contributes zero, which is what
 * makes the sum the right reading rather than `zones × perZone`.
 */
function totalGerrymanderAllowance(state: GameState, player: PlayerID, rules: Rules): number {
  let total = 0;
  for (const z of state.zones) {
    if (gerrymanderRights(z) !== player) continue;
    total += gerrymanderAllowance(state, player, rules, z.id);
  }
  return total;
}

/**
 * @param cardId the X-Card being resolved, or null. The one op that needs it is
 *   `restrict`, because a restriction records which card imposed it and a client has
 *   to be able to name it. Outside a card resolution — a live effect replaying its
 *   own list — the recorded id is the card that DID impose it, which is the honest
 *   answer rather than a blank.
 */
/** Append one `Restriction`, minting its id from the state's own counter. R2. */
function pushRestriction(
  state: GameState,
  id: PlayerID,
  imposedBy: PlayerID,
  r: Omit<Restriction, 'id' | 'sourcePlayer'>,
): GameState {
  const player = state.players[id];
  if (!player) return state;
  const seq = state._idSeq + 1;
  return {
    ...state,
    _idSeq: seq,
    players: {
      ...state.players,
      [id]: { ...player, restrictions: [...(player.restrictions ?? []), { id: `R${seq}`, sourcePlayer: imposedBy, ...r }] },
    },
  };
}

/** Every restriction of a kind a player currently carries. */
function restrictionsOf(
  state: GameState,
  id: PlayerID,
  kind: RestrictionKind,
): readonly Restriction[] {
  return (state.players[id]?.restrictions ?? []).filter((r) => r.kind === kind);
}

/**
 * The extra resources a purchase costs this player, from their surcharges.
 *
 * PYTHONPOST and SNOOP B-O-DOUBLE-T are the same clause: *"for the rest of the
 * game, you have to pay an extra resource for every Conspiracy Card that you buy"*.
 * Summed, not maxed, so two cards that both tax you tax you twice — which is what
 * two cards means.
 */
function surchargeFor(state: GameState, id: PlayerID): number {
  return restrictionsOf(state, id, 'surcharge').reduce((n, r) => n + Math.max(0, r.value), 0);
}

/** `"you cannot make any purchases"` — true while any unresolved lock is standing. */
function purchasesBlocked(state: GameState, id: PlayerID): boolean {
  return restrictionsOf(state, id, 'no-purchases').some((r) => r.remaining > 0);
}

/**
 * THE KHAKI TERROR RULING, and it is the one that decides whether this card is a
 * card or a soft-lock.
 *
 * *"Donate 1 resource of each type to the Public Reserve. You cannot make any
 * purchases until you do so."* (REF 4.1; rules-reference.md p12 for the freeze.)
 * The card's punchline is that the resources sit physically ON the card and it is
 * discarded when all four are donated.
 *
 * `lose` never takes more than the player holds — `takeResources` clamps, and that
 * is not negotiable, because the alternative is a negative pool. So a player holding
 * 3 Funds and no Media has donated what they could and the card's own words are
 * satisfied. **Therefore `remaining` is decremented by what was ACTUALLY TAKEN, not
 * by what the card asked for.** Decrementing by the ask would make the only card
 * that can clear the lock unplayable for anyone short of 4 resources of every type,
 * which is a table-stalling bug wearing a card's clothes.
 *
 * THE SAFE DIRECTION IS DELIBERATE. Under-decrementing leaves the player locked, who
 * can donate again and eventually get to zero — annoying and recoverable.
 * Over-decrementing unlocks a purchase they have not paid for, which hands out a free
 * Voter Card. So the arithmetic rounds towards "still owed".
 *
 * Called from the `lose` case, because a donation IS a `lose` in this engine — the
 * Public Reserve is modelled as the absence of a resource, not as a pile.
 */
function creditDonation(state: GameState, id: PlayerID, taken: Delta): GameState {
  const given = deltaTotal(taken);
  if (given <= 0) return state;
  const player = state.players[id];
  if (!player) return state;
  let changed = false;
  const restrictions = (player.restrictions ?? []).map((r) => {
    if (r.kind !== 'no-purchases' || r.remaining <= 0) return r;
    const next = Math.max(0, r.remaining - given);
    if (next === r.remaining) return r;
    changed = true;
    return { ...r, remaining: next };
  });
  // A satisfied lock is REMOVED rather than left at zero, so `purchasesBlocked` stays
  // a single honest predicate and the client does not have to know that zero means
  // "cleared".
  const kept = restrictions.filter((r) => !(r.kind === 'no-purchases' && r.remaining <= 0));
  if (!changed) return state;
  return { ...state, players: { ...state.players, [id]: { ...player, restrictions: kept } } };
}

/** Drop restrictions whose deadline has passed. Ticked with live effects. */
function expireRestrictions(state: GameState): GameState {
  let s = state;
  for (const p of state.turnOrder) {
    const player = s.players[p];
    if (!player) continue;
    const kept = (player.restrictions ?? []).filter(
      (r) => r.expiresTurn === null || r.expiresTurn > state.turn,
    );
    if (kept.length !== (player.restrictions ?? []).length) {
      s = { ...s, players: { ...s.players, [p]: { ...player, restrictions: kept } } };
    }
  }
  return s;
}


function applyEffect(
  state: GameState,
  source: PlayerID,
  effect: Effect,
  ctx: Ctx,
  fire: FireContext | undefined = NO_FIRE,
  cardId: CardID | null = null,
): GameState {
  let s = state;
  const target = 'target' in effect ? (effect.target ?? 'you') : 'you';

  switch (effect.op) {
    case 'gain': {
      for (const p of resolveTargets(s, source, target)) {
        s = enforceCap(addResources(s, p, resolveDelta(s, p, effect.res, effect.per, ctx)), p, ctx.rules);
      }
      return s;
    }
    case 'lose': {
      for (const p of resolveTargets(s, source, target)) {
        // The `taken` Delta is what the engine ACTUALLY removed, which is the whole
        // of the KHAKI TERROR ruling — see `creditDonation`.
        const [after, taken] = takeResources(
          s,
          p,
          resolveDelta(s, p, effect.res, effect.per, ctx),
        );
        s = creditDonation(after, p, taken);
      }
      return s;
    }
    case 'gain-any': {
      for (const p of resolveTargets(s, source, target)) {
        s = pushChoice(s, { kind: 'gain-any', count: resolveCount(s, p, effect.n, ctx), reason: 'Card effect' }, p);
      }
      return s;
    }
    case 'lose-any': {
      for (const p of resolveTargets(s, source, target)) {
        const held = poolTotal(s.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 });
        const n = Math.min(resolveCount(s, p, effect.n, ctx), held);
        if (n > 0) s = pushChoice(s, { kind: 'lose-any', count: n, reason: 'Card effect' }, p);
      }
      return s;
    }
    case 'steal-any': {
      // `target` is the SET OF VICTIMS. With no target the thief picks one
      // (`from: null`, today's behaviour); with a target there is one theft
      // decision per resolved player and the victim is already fixed, which is what
      // makes "take N from EVERY opponent" writable at all. `resolveChoice` then
      // requires the pick to name exactly that player.
      const named = target !== 'you' ? resolveTargets(s, source, target) : [];
      if (named.length === 0) {
        return pushChoice(s, { kind: 'steal-any', count: resolveCount(s, source, effect.n, ctx), from: null, reason: 'Card effect' }, source);
      }
      for (const victim of named) {
        // A live effect that fires on somebody's purchase names them, not a field.
        const from = fire?.actor ?? victim;
        // THE SELF-STEAL GUARD BELONGS ON `from`, NOT ON `victim`. — G21, and it is a
        // hard lock when it is wrong, because a pending decision freezes its owner
        // and `resolveChoice` refuses EVERY pick for a theft naming the chooser
        // (`victim.id === playerId` -> 'steal from someone else'). Raise one with
        // `from === source` and the thief is frozen for the rest of the match with no
        // legal pick and no server-side recovery.
        //
        // The guard used to sit on `victim`, one line above the substitution, and the
        // two facts make that a hole rather than a check: `fire.actor` is only ever
        // `source` for `on-turn-start`, because `fireTriggers` requires
        // `fire.actor === le.owner` there and then applies the effect with
        // `source = next.owner`. So the only event that can substitute the thief in as
        // the victim is the one event the guard never saw, and "steal 1 from each
        // opponent" hooked to your own turn start raised a decision aimed at yourself.
        // It was the same defect as the unclamped `lose-any` on a different axis: a
        // choice raised in a state its own resolver cannot satisfy.
        //
        // Skipping is the honest reading, and it is what the guard already did for a
        // named self-target: the card named its victims, and there is nobody to take
        // from, so there is no theft to decide.
        if (from === source) continue;
        s = pushChoice(s, { kind: 'steal-any', count: resolveCount(s, source, effect.n, ctx), from, reason: 'Card effect' }, source);
      }
      return s;
    }
    case 'voters': {
      for (const p of resolveTargets(s, source, target)) {
        s = grantVoters(s, p, resolveCount(s, p, effect.n, ctx), 'Card effect', false);
      }
      return s;
    }
    case 'evict':
      return raiseVoterDecision(s, source, 'evict-voter', effect.n, target, ctx);
    case 'discard-voter':
      return raiseVoterDecision(s, source, 'discard-voter', effect.n, target, ctx);
    case 'convert-voter':
      return raiseVoterDecision(s, source, 'convert-voter', effect.n, target, ctx);
    case 'gerrymander': {
      // G8, closed on the REDUCER (KNOWN-GAPS.md G8). The bonus used to be credited
      // to `source` alone, which is why "starting with you, EVERY player can
      // Gerrymander 1" (NEW FACE WHO DIS / SUBMERGED, REF 4.3) could not be written
      // at all — it was the one resource-shaped op with no `target`, and adding the
      // field to the type without honouring it would have made the card read as if
      // it hit every player while hitting one.
      //
      // The grant lands in `powerUses.gerrymandered`, which `advanceTurn` resets to
      // NO_POWER_USES at the start of each player's own turn — so a bonus handed to
      // every player lasts exactly the turn the card resolved on for whoever has
      // not played yet, which is what the card says ("immediately").
      for (const p of resolveTargets(s, source, target)) {
        const player = s.players[p];
        if (!player) continue;
        // Negative "used" counts read as bonus moves in the allowance check.
        const bonus: Record<string, number> = { ...player.powerUses.gerrymandered };
        bonus['__bonus'] = (bonus['__bonus'] ?? 0) + resolveCount(s, p, effect.n, ctx);
        s = withPlayer(s, p, { powerUses: { ...player.powerUses, gerrymandered: bonus } });
      }
      return s;
    }
    case 'draw-conspiracy': {
      // G17: `from: 'discard'` takes the most recently DISCARDED card rather than the
      // top of the draw pile. `discardTo` pushes onto the end of the pile and `draw`
      // shifts off the front, so "the top of the discard pile" is `length - 1` — and
      // picking it that way is deterministic, which a reshuffle would not be.
      //
      // No `choose-card`: SELECTIVE ACCESS MEMORY's "any card, in any order" needs a
      // decision over the pile's contents, and a new `Choice` kind is a wire-format
      // change the client owns. The top of the pile is the honest subset.
      const fromDiscard = effect.from === 'discard';
      for (const p of resolveTargets(s, source, target)) {
        for (let i = 0; i < resolveCount(s, p, effect.n, ctx); i++) {
          const pile = fromDiscard ? s._conspiracyDiscard : s._conspiracyDraw;
          const id = fromDiscard ? pile[pile.length - 1] : pile[0];
          if (id === undefined) break;
          s = {
            ...s,
            _conspiracyDiscard: fromDiscard ? pile.slice(0, -1) : s._conspiracyDiscard,
            _conspiracyDraw: fromDiscard ? s._conspiracyDraw : pile.slice(1),
          };
          const player = s.players[p];
          if (player) s = withPlayer(s, p, { conspiracies: [...player.conspiracies, id] });
        }
      }
      return syncConspiracyTop(s, ctx);
    }
    case 'refresh-market': {
      for (const slot of s.market) s = discardTo(s, 'voter', slot.cardId);
      return refillMarket({ ...s, market: [] }, ctx);
    }
    case 'restrict': {
      // G5. Writes a rule, not a resource. `target` says who carries it, so `'you'`
      // is KHAKI TERROR on its caster and a surcharge lands on whoever the card names.
      for (const p of resolveTargets(s, source, target)) {
        s = pushRestriction(s, p, source, {
          kind: effect.kind,
          value: effect.value,
          remaining: effect.owed ?? 0,
          // The same absolute-turn arithmetic a live effect uses, so all four
          // durations work with no special case and a replay reproduces it from the
          // state. `durationExpiry` is the single definition; see `Restriction`.
          expiresTurn: durationExpiry(s, source, effect.until ?? 'rest-of-game'),
          sourceCardId: cardId ?? 'unknown',
        });
      }
      return s;
    }
    case 'discount': {
      // Helping Hands' uses are stored as a NEGATIVE number (see gerrymanderAllowance's
      // sibling, the allowance check), so a discount is a subtraction from a negative
      // count. `target` writes another player's counter, which is the only write of
      // somebody else's `powerUses` in the effect vocabulary.
      for (const p of resolveTargets(s, source, target)) {
        const player = s.players[p];
        if (!player) continue;
        s = withPlayer(s, p, {
          powerUses: {
            ...player.powerUses,
            helpingHands: player.powerUses.helpingHands - resolveCount(s, p, effect.n, ctx),
          },
        });
      }
      return s;
    }
    case 'move-card': {
      // G20. The whole of the contract is on `Effect`'s `move-card` arm in cards.ts
      // and on `PlayerState.ideologyCards` in state.ts; what is left here is the
      // things that arm asks this function to guarantee, and each is a branch rather
      // than a comment because a comment does not fail a test.
      //
      // SILENT, ON PURPOSE. There is no `log(...)` and no `GameEvent` on either path,
      // and that is not an oversight the log line is merely forgotten in. A destroyed
      // card must leak nothing about its SIDES, and a card moved into a hand must leak
      // nothing about the hand — and `LogEntry` is a client-visible string (playerView
      // copies `state.log` wholesale) and `GameEvent` is the wire. A line reading "a
      // card was destroyed" is itself a leak: it tells every viewer that a card with two
      // unrevealed answers just left the world, which is information about a hidden card
      // that the game has no reason to publish. `card-transfer.test.ts` scans the whole
      // payload for both ids and for both sides' payouts.
      //
      // The card being PLAYED is a different matter and is logged by the caller, which
      // logs the source card the player chose to reveal. That is public by construction:
      // you played it.
      const n = resolveCount(s, source, effect.n, ctx);
      if (n <= 0) return s;
      // `from: 'draw'` is the only source the type allows, and it is the only honest
      // one: a card in the Ideology DISCARD pile has been ANSWERED, which p13 makes
      // face up under its owner's mat, so handing one to a player blind would publish
      // the answer they are about to give. See the `move-card` arm in cards.ts, which
      // is the long version of why, and which also explains why the drain in
      // `advanceTurn` taking a card INSTEAD OF a draw is what makes the deck count fall
      // by exactly one per turn.
      if (effect.from === 'draw' && s._ideologyDraw.length === 0) return s;

      // "The top of the draw pile" is the end `draw()` takes from — `pile[0]` — and not
      // the end `discardTo` pushes onto. Using the other end would be a second,
      // invisible definition of "top" in the same file, and a card the engine calls top
      // in one function and not in the other is a card a replay cannot reproduce.
      if (effect.to === 'destroy') {
        // Straight off the top, and NOT through `discardTo` — which would put it
        // straight back on a pile, and a "destroy" that recycles is not a destroy. This
        // is the only write in the engine that SHRINKS the total number of Ideology
        // Cards in the world, which is what makes the conservation argument above
        // true for every other path.
        const take = Math.min(n, s._ideologyDraw.length);
        if (take <= 0) return s;
        return { ...s, _ideologyDraw: s._ideologyDraw.slice(take) };
      }

      for (const p of resolveTargets(s, source, target)) {
        const player = s.players[p];
        if (!player) continue;
        for (let i = 0; i < n; i += 1) {
          const pile = s._ideologyDraw;
          const id = pile[0];
          if (id === undefined) break;
          // The cap is checked BEFORE the card leaves the pile, so a refused move
          // leaves the world exactly as it was. A partially-applied `n` is correct and
          // not a bug: the draw pile is a shared resource and two `to: 'hand'` effects
          // in one resolution compete for it.
          if (ideologyHandOf(player).length >= IDEOLOGY_HAND_MAX) break;
          s = { ...s, _ideologyDraw: pile.slice(1) };
          s = withPlayer(s, p, { ideologyCards: [...ideologyHandOf(player), id] });
        }
      }
      return s;
    }
  }
}

/**
 * Is this effect SCOPED — does it describe something that outlives or hangs off an
 * event rather than resolving now?
 *
 * A scoped effect is INSTALLED, never applied. That distinction is the whole reason
 * `installLiveEffects` exists as a separate pass, and getting it wrong is the
 * specific failure the install test pins: an effect that both fires once at play
 * time AND keeps its hook hands out a free effect on the turn it was played. POWER
 * TRIP would give a discard for free the moment you played it, and then keep giving
 * one every time you influence a 3-Voter Card for the rest of the game.
 *
 * `condition` counts as scoped even without a `when`, and `installLiveEffects` drops
 * it in that case — there is no event for it to narrow. The corpus validator refuses
 * the combination outright rather than letting it reach here, so the engine's
 * behaviour is belt and braces rather than the primary defence.
 */
function isScoped(effect: Effect): boolean {
  // `restrict` is the one op that carries `until` WITHOUT being scoped, and that is
  // not an oversight. For every other op `until` is a hook's lifetime: the effect
  // does not happen now, it happens on its trigger until the deadline. For
  // `restrict`, `until` is the DEADLINE OF THE RULE BEING WRITTEN — the restriction
  // is imposed right now and simply stops applying at that turn. Installing it as a
  // live effect instead would (a) never impose it at all, because a scoped effect is
  // not applied, and (b) if it were, re-impose it on every event, stacking a fresh
  // entry each time. The two meanings of one field name is exactly the kind of
  // collision the honesty registry exists to catch, so the case is named here and
  // asserted in restrictions.test.ts.
  if (effect.op === 'restrict') return false;
  return effect.when !== undefined || effect.until !== undefined || effect.condition !== undefined;
}


function applyEffects(
  state: GameState,
  source: PlayerID,
  effects: readonly Effect[],
  ctx: Ctx,
  fire?: FireContext,
  install?: InstallContext,
): GameState {
  const applied = effects.reduce(
    (s, e) => (isScoped(e) ? s : applyEffect(s, source, e, ctx, fire, install?.sourceCardId ?? null)),
    state,
  );
  return install ? installLiveEffects(applied, source, effects, ctx, install) : applied;
}


// ─────────────────────────── live effects (G9 / G22) ───────────────────────────

/**
 * The card-level half of a lasting effect: which card, how long, from when.
 *
 * Passed by `PLAY_CONSPIRACY` and `ACK_HEADLINE` — the only two places a card's
 * effect list is resolved — and threaded into `applyEffects` so that `when` /
 * `until` reach `installLiveEffects` without `applyEffect` ever seeing them. That
 * separation is deliberate and is what the honesty gate re-derives: `applyEffect`
 * decides what ONE resolution does, `installLiveEffects` decides what LINGERS.
 */
type InstallContext = {
  readonly sourceCardId: CardID;
  readonly duration: EffectDuration;
  readonly timing: EffectTiming;
};

/**
 * Turn a resolved card's lasting clauses into `GameState.liveEffects` entries.
 *
 * THREE RULES, and each is a ruling rather than an implementation detail:
 *
 * 1. **An effect carrying `when` or `until` is installed, not applied.** It does
 *    not fire once at play time and then linger; it does nothing until its event
 *    fires or its standing turn arrives. Otherwise POWER TRIP would give a free
 *    discard on the turn it was played and then keep the hook, which is not what
 *    "every time you influence a 3-Voter Card" says.
 * 2. **A card-level `duration` other than `'this-turn'` installs ONE standing
 *    effect** holding the whole list, re-applied at the top of every one of the
 *    owner's turns. One entry rather than one per effect, so a two-effect list
 *    under `duration: 'rest-of-game'` reads as "this happens again each turn", not
 *    as two independent auras that can drift apart.
 * 3. **Per-effect scope wins over card-level.** A card may mix a one-shot branch
 *    with a lasting hook, and the one-shot branch is applied by `applyEffect` in
 *    the same pass.
 *
 * NOTHING HERE READS THE CLOCK. Every number comes out of the state that was
 * handed in, so a replay from seed + action log reproduces the same list — the
 * property `state.ts`'s `LiveEffect` note relies on.
 */
function installLiveEffects(
  state: GameState,
  source: PlayerID,
  effects: readonly Effect[],
  ctx: Ctx,
  install: InstallContext,
): GameState {
  let s = state;
  const perEffect = effects.filter(isScoped);
  if (perEffect.length > 0) {
    for (const effect of perEffect) {
      s = pushLiveEffect(s, source, effect.when ?? null, effect.condition, [effect], ctx, {
        sourceCardId: install.sourceCardId,
        until: effect.until ?? install.duration,
        timing: install.timing,
      });
    }
    return s;
  }
  if (install.duration === 'this-turn') return s;
  // Rule 2: one standing effect for the whole list.
  return pushLiveEffect(s, source, null, undefined, effects, ctx, {
    sourceCardId: install.sourceCardId,
    until: install.duration,
    timing: install.timing,
  });
}

/** Append one `LiveEffect`, minting its id from the state's own counter. R2. */
function pushLiveEffect(
  state: GameState,
  owner: PlayerID,
  trigger: EffectTrigger | null,
  condition: EffectCondition | undefined,
  effects: readonly Effect[],
  ctx: Ctx,
  opts: { readonly sourceCardId: CardID; readonly until: EffectDuration; readonly timing: EffectTiming },
): GameState {
  if (effects.length === 0) return state;
  if (!state.players[owner]) return state;
  const activeFrom = opts.timing === 'next-turn' ? ownerNextTurn(state, owner) : state.turn;
  const rawExpiry = durationExpiry(state, owner, opts.until);
  // A lifetime shorter than the delay before it may first act is a card whose two
  // clauses contradict each other; widen it to one turn rather than install an
  // effect that is born expired. `Math.max` is the safe direction: err towards
  // living too long is a rules problem, err towards expiring before it ever acted
  // is a card that silently does nothing.
  const expiresAt = rawExpiry === null ? null : Math.max(rawExpiry, activeFrom + 1);
  const seq = state._idSeq + 1;
  const entry: LiveEffect = {
    id: `L${seq}`,
    owner,
    sourceCardId: opts.sourceCardId,
    // A condition with no trigger has no event to narrow, so it is dropped rather
    // than stored as a field nothing reads. `isScoped` is why such an effect is not
    // applied once either. The corpus validator refuses the combination outright
    // (CONDITION_FIX); this is the engine declining to half-honour it.
    trigger,
    ...(condition === undefined || trigger === null ? {} : { condition }),
    effects,
    activeFrom,
    expiresAt,
  };
  void ctx;
  return { ...state, _idSeq: seq, liveEffects: [...state.liveEffects, entry] };
}

/** When a lifetime of this length runs out, in absolute turn numbers. */
function durationExpiry(state: GameState, owner: PlayerID, until: EffectDuration): number | null {
  switch (until) {
    case 'this-turn':
      return state.turn + 1;
    case 'next-turn':
      // Live through the owner's next turn, gone at the boundary after it.
      return ownerNextTurn(state, owner) + 1;
    case 'round':
      return roundEndTurn(state);
    case 'rest-of-game':
      return null;
  }
}

/**
 * The turn boundary: drop what has run out, then let what is still in force act.
 *
 * ORDER IS THE WHOLE POINT and is asserted by `live-effects.test.ts`: expiry runs
 * FIRST, so an effect whose last turn is the one that just ended is gone before
 * anything gets a chance to re-apply it. Reversing the two would make a
 * `'this-turn'` effect immortal — it would be re-applied at the very boundary that
 * was supposed to remove it.
 *
 * A STANDING effect (no `when`) applies to the incoming player at the top of their
 * turn. That is ERADICATING GERMS' "discard an open Voter Card every turn
 * (mandatory)": the turn that installed it has already begun, so the first
 * application is the owner's next one, and every turn thereafter.
 *
 * A `when: 'on-turn-start'` hook is fired by `fireTriggers` immediately after, so
 * both families act at the same point and in a fixed order.
 */
function tickLiveEffects(state: GameState, ctx: Ctx): GameState {
  let s: GameState = {
    ...state,
    liveEffects: state.liveEffects.filter((le) => isInForce(le, state.turn)),
  };
  // G5: the same boundary, the same "expire first" ordering. A `'this-turn'` lock
  // is gone before anything re-applies, and a `'next-turn'` one is gone too — both
  // are relative to the turn the card resolved on, and a restriction is not a
  // standing effect, so it acts on the resolver's own clock rather than its owner's.
  s = expireRestrictions(s);
  for (const le of s.liveEffects) {
    if (le.trigger !== null || le.owner !== s.activePlayer) continue;
    if (!isInForce(le, s.turn)) continue;
    for (const e of le.effects) s = applyEffect(s, le.owner, e, ctx, NO_FIRE, le.sourceCardId);
  }
  return fireTriggers(s, TURN_START(s.activePlayer), ctx);
}

/** The `FireContext` for a turn boundary. Carries no card, no area and no voter. */
function TURN_START(actor: PlayerID): FireContext {
  return { trigger: 'on-turn-start', actor, voters: 0, areaId: null, pegOwner: null };
}


// ─────────────────────────── gerrymander allowance ───────────────────────────

function gerrymanderAllowance(state: GameState, player: PlayerID, rules: Rules, zoneId: string): number {
  const p = state.players[player];
  if (!p) return 0;
  const base = hasPower(p, rules, 'election-fever')
    ? rules.gerrymandersPerZoneWithFever
    : rules.gerrymandersPerZone;
  const bonus = p.powerUses.gerrymandered['__bonus'] ?? 0;
  const used = p.powerUses.gerrymandered[zoneId] ?? 0;
  return base + bonus - used;
}

// ─────────────────────────── the response window (G13) ───────────────────────────

/**
 * THE REGISTRY, and `packages/cards/test/reducer-parity.test.ts` re-derives these
 * keys out of this object's own source text.
 *
 * `block` and `deflect` are the two of the five phase-changing ops this engine
 * actually performs, and they are performed by `RESPOND_INTERRUPT` — not by
 * `applyEffect`, which is why they are a sibling card field and not an `Effect`.
 * `auction`, `vote` and `pass-card` are absent, and their absence is the argument
 * recorded in KNOWN-GAPS G13: an auction needs a `PlayerState` debt field and an
 * IOU, a vote needs a ballot with a re-vote rule and a payoff that is itself G20,
 * and a pass needs an in-flight queue (G12) plus something to pass the card to
 * (G20). An op listed here that the reducer cannot honour is a card that lies, so
 * the registry names only what is real.
 */
const REACTIVE_INTERRUPTS: Readonly<Record<string, 'block' | 'deflect'>> = {
  block: 'block',
  deflect: 'deflect',
};

/** Is this op one `RESPOND_INTERRUPT` will act on? */
function isReactive(op: string): op is 'block' | 'deflect' {
  return Object.prototype.hasOwnProperty.call(REACTIVE_INTERRUPTS, op);
}

/** The open window, or null. One accessor so a missing field is never a third state. */
function openInterrupt(state: GameState): InterruptWindow | null {
  return state.interrupt;
}

/**
 * May a card holding this `Interrupt` answer the open window?
 *
 * The two fields are read, not declared-and-ignored, which is the whole reason the
 * enum in `cards.ts` was narrowed from three values to two (see the note there).
 */
function mayRespond(state: GameState, interrupt: Interrupt): string | null {
  if (interrupt.window === 'pre-answer' && state.phase !== 'answer') {
    return 'that card may only be played immediately before an opponent answers';
  }
  if (interrupt.target === 'card-affecting-you' && !reachesPastActor(state)) {
    return 'that card only answers a card that affects a player other than the one who played it';
  }
  return null;
}

/**
 * The engine's approximation of "this card affects somebody other than its player".
 *
 * AN APPROXIMATION, and labelled: `applyEffect` computes `target` once for a whole
 * effect list, so this answers "does any effect in the list aim past its owner", not
 * "does it aim at THIS player". The printed DEFLECT reads "a card that affects
 * YOU", and the narrower question is G1 — a decision over players, which is a new
 * `Choice` kind and a client wire-format change this package may not make. The
 * shipped DEFLECT therefore declares `'any-card'`, which is the reading the
 * defender's judgement supplies at a physical table anyway.
 */
function reachesPastActor(state: GameState): boolean {
  const w = openInterrupt(state);
  if (w === null) return false;
  return w.effects.some((e) => 'target' in e && e.target !== undefined && e.target !== 'you');
}

/**
 * Everybody except the actor, minus anybody frozen by a pending decision.
 *
 * THE DEADLOCK ARGUMENT, in one function. Every player in this set always has
 * `PASS_INTERRUPT` available, so the window is always closable; and a player who
 * cannot act at all is not required to decline, so p12's freeze is honoured rather
 * than overridden. It is derived from the state on every call and never stored, so
 * it cannot drift from who is actually frozen.
 */
function mustRespond(state: GameState, actor: PlayerID): readonly PlayerID[] {
  return state.turnOrder.filter(
    (p) => p !== actor && !state.choices.some((c) => c.player === p),
  );
}

/** Does any OTHER player hold a Conspiracy Card whose `interrupt` this engine acts on? */
function canBeAnswered(state: GameState, ctx: Ctx, actor: PlayerID): boolean {
  for (const p of state.turnOrder) {
    if (p === actor) continue;
    const hand = state.players[p];
    if (!hand) continue;
    for (const cardId of hand.conspiracies) {
      const card = ctx.cards.conspiracy[cardId];
      if (card?.interrupt && isReactive(card.interrupt.op)) return true;
    }
  }
  return false;
}

/** The name of the card under response, for the log. It is already a public play. */
function interruptCardName(w: InterruptWindow, ctx: Ctx): string {
  if (w.kind === 'conspiracy') return ctx.cards.conspiracy[w.cardId]?.name ?? w.cardId;
  return ctx.cards.headline[w.cardId]?.name ?? w.cardId;
}

/**
 * Resolve a played card's effects NOW, or hold them for a beat.
 *
 * Called from exactly the two places a card's effect list is resolved —
 * `PLAY_CONSPIRACY` and `ACK_HEADLINE` — and it is the whole of the phase machine:
 * a card with an effect list that somebody could answer is STAGED, and everything
 * else behaves exactly as it did before G13 landed.
 *
 * Reachable from the shipped decks: BLOCK and DEFLECT ship as `ct-et2040-014` and
 * `ct-et2040-015`, and holding either one is what makes `canBeAnswered` true.
 * `packages/engine/test/interrupts.test.ts` drives both real cards through here and
 * asserts the window opens and the op is performed.
 *
 * AND IT IS THE ONLY WRITER OF `state.interrupt` besides `RESPOND_INTERRUPT` /
 * `PASS_INTERRUPT`, which is why `reduce` freezes every other action while a window
 * is open: this function REPLACES the field rather than merging into it, so a second
 * card play mid-window would orphan the first window's staged `effects` and they
 * would never be applied by anything.
 */
function resolveCard(
  state: GameState,
  actor: PlayerID,
  card: {
    readonly id: CardID;
    readonly effects: readonly Effect[];
    readonly duration?: EffectDuration;
    readonly timing?: EffectTiming;
  },
  kind: 'conspiracy' | 'headline',
  ctx: Ctx,
): GameState {
  const duration = card.duration ?? 'this-turn';
  const timing = card.timing ?? 'now';

  if (card.effects.length > 0 && canBeAnswered(state, ctx, actor)) {
    const seq = state._idSeq + 1;
    return {
      ...state,
      _idSeq: seq,
      interrupt: {
        id: `I${seq}`,
        actor,
        cardId: card.id,
        kind,
        effects: card.effects,
        duration,
        timing,
        blocked: false,
        deflectedTo: null,
        responder: null,
        passed: [],
      },
    };
  }

  return applyEffects(state, actor, card.effects, ctx, undefined, {
    sourceCardId: card.id,
    duration,
    timing,
  });
}

/**
 * CLOSE THE WINDOW and settle the card.
 *
 * The two exits, and the order is the rules: a BLOCK wins outright, because BLOCK
 * says "cannot be reversed or deflected" and a resolution that retargeted a blocked
 * card would be a block that did not block. Otherwise a DEFLECT's target replaces
 * the actor as the player the whole effect list resolves FOR.
 *
 * The deviation is recorded rather than hidden: the printed DEFLECT moves "only
 * that partial effect" that touched the defender, and `applyEffect` computes one
 * `target` for the whole list, so the engine redirects the whole resolution. That is
 * G20's granularity, not a bug, and the card's `source` field says so.
 */
function closeInterrupt(state: GameState, w: InterruptWindow, ctx: Ctx): Result {
  const base: GameState = { ...state, interrupt: null };

  const settled: GameState = w.blocked
    ? log(base, {
        player: w.responder,
        text: `Blocked "${interruptCardName(w, ctx)}".`,
        kind: 'system',
      })
    : applyEffects(base, w.deflectedTo ?? w.actor, w.effects, ctx, undefined, {
        sourceCardId: w.cardId,
        duration: w.duration,
        timing: w.timing,
      });

  // A Headline that was held was still one of a queue, and `ACK_HEADLINE` stopped
  // before draining it. Resuming here rather than there is what keeps the turn
  // boundary exactly where the interrupted action left it — and it is the reason a
  // BLOCK on a Headline delays the game rather than cancelling the whole turn.
  if (w.kind === 'headline') return nextHeadlineOrAdvance({ ...settled, activeHeadline: null }, ctx);
  return { ok: true, state: settled, events: [] };
}

// ─────────────────────────── turn advance ───────────────────────────

function endOfGame(state: GameState, events: GameEvent[] = []): Result {
  const w = winners(state);
  return {
    ok: true,
    state: {
      ...state,
      finished: true,
      phase: 'finished',
      log: [...state.log, { turn: state.turn, player: null, text: 'The election is decided.', kind: 'system' }],
    },
    events: [...events, { type: 'game-over', winners: w }],
  };
}

function advanceTurn(state: GameState, ctx: Ctx): Result {
  let s = state;
  const events: GameEvent[] = [{ type: 'turn-ended', player: s.activePlayer }];

  // p10: influenced voters not placed by the end of the turn are discarded.
  const active = s.players[s.activePlayer];
  if (active && active.pending.length > 0) {
    const lost = active.pending.reduce((n, g) => n + g.count, 0);
    s = withPlayer(s, s.activePlayer, { pending: [] });
    s = log(s, {
      player: s.activePlayer,
      text: `${lost} unplaced voter${lost === 1 ? '' : 's'} discarded.`,
      kind: 'voters',
    });
  }

  // p7/p20 — the standard ending.
  if (allMajoritiesFormed(s)) return endOfGame(s);

  // p20 — the timer ending: the board filled, so everyone gets one last turn,
  // starting with whoever filled the final area. That player's turn was this one.
  if (s.finalRoundFrom === null && boardFull(s)) {
    s = { ...s, finalRoundFrom: s.activePlayer };
    events.push({ type: 'final-round', startingWith: s.activePlayer });
    s = log(s, { player: null, text: 'Every area is filled. Final round.', kind: 'system' });
  }

  const i = s.turnOrder.indexOf(s.activePlayer);
  const next = s.turnOrder[(i + 1) % s.turnOrder.length];
  if (next === undefined) return fail('empty turn order');

  if (s.finalRoundFrom !== null && next === s.finalRoundFrom) return endOfGame(s);

  const nextPlayer = s.players[next];
  if (!nextPlayer) return fail(`unknown player ${next}`);

  s = withPlayer(s, next, { powerUses: NO_POWER_USES });

  // p21: draw and read an Ideology Card for the next player.
  //
  // G20: A HELD CARD IS DRAINED HERE, ONE PER TURN, IN PLACE OF THE DRAW — and this
  // is the only place in the engine a held card is ever read. The ruling on
  // `PlayerState.ideologyCards` is what makes this the right seam and no other:
  // `_pendingCard` is written exactly once per turn, right here, so a card arriving
  // at any other moment cannot collide with the answer a player is in the middle of
  // giving. A card moved to somebody MID-ANSWER is therefore dealt at their NEXT
  // boundary, unchanged answer, no observable difference to anybody — which is the
  // property `card-transfer.test.ts` drives directly.
  //
  // THE ORDER OF THE TWO EXHAUSTION CHECKS IS LOAD-BEARING, and getting it wrong is
  // a soft-lock. The R10 branch below ends the game when the Ideology deck AND its
  // discard are both empty. A player holding a card is dealt one WITHOUT touching
  // either pile, so the hand has to be consulted first: check the deck first and a
  // player carrying the only Ideology Card left in the world gets a game-over on the
  // turn they were about to be handed something. `card-transfer.test.ts` builds
  // exactly that position.
  const held = ideologyHandOf(s.players[next]);
  const [heldCard, ...heldRest] = held;
  let cardId: CardID | null;
  if (heldCard !== undefined) {
    s = withPlayer(s, next, { ideologyCards: heldRest });
    cardId = heldCard;
  } else {
    const [drawn, fromDeck] = draw(s, 'ideology');
    s = drawn;
    cardId = fromDeck;
  }

  // R10, ruled. The Ideology deck AND its discard are both empty, so there is no
  // card to put to the next player. The headline path already handles exactly
  // this (`nextHeadlineOrAdvance`: drop the queue, advance the turn) — the
  // ideology path could not, because a turn that starts with no card has no legal
  // first move: ANSWER says "no card has been put to you", REDRAW_IDEOLOGY says
  // "no card to redraw", and END_TURN says "answer your Ideology Card first". The
  // old code entered `phase: 'answer'` with `_pendingCard: null` and the game was
  // over with no way to end it.
  //
  // There is no rulebook provision for running out of Ideology Cards [NOT IN
  // RULEBOOK]. The rule is that play continues; here it cannot, so the game ends
  // and the standing on the board is the result — the same shape as p20's timer
  // ending, which also stops play and scores the board as it stands.
  //
  // REACHABLE, AND THAT WAS THE BUG (2026-10-01, real 5-player browser playtest).
  // The old comment here claimed this branch was "unreachable in play" because it
  // assumed a 108- (or 432-) card deck, and reasoned that a turn starting with no
  // card has no legal first move — which is a true statement about a *soft-lock*
  // and a false one about a *game-over*. The escape hatch meant to prevent the
  // soft-lock WAS the game-over condition, and the shipped deck is 52 cards
  // (`loadCorpus`: 20 + 32), one drawn per turn. So every game ended at turn 52
  // with 0 of 9 majorities formed and 45 pegs on the board: unwinnable at every
  // seat count. The trigger was upstream of this branch — `ANSWER` never put the
  // answered card on the discard pile, so the pile `draw` recycles from was always
  // empty and the reshuffle could never fire. `ANSWER` now discards, so the
  // recycle this branch was written to survive actually happens.
  //
  // What remains here is a genuinely partial-deck case (a fixture that deals fewer
  // cards than the number of turns played), and ending the game is the right call
  // for it: a `fail` would leave the outgoing player unable to end their turn.
  if (cardId === null) {
    s = log(s, { player: null, text: 'The Ideology deck is exhausted.', kind: 'system' });
    return endOfGame(s, events);
  }

  s = {
    ...s,
    activePlayer: next,
    phase: 'answer',
    turn: s.turn + 1,
    round: i === s.turnOrder.length - 1 ? s.round + 1 : s.round,
    _pendingCard: cardId,
    activeHeadline: null,
  };

  // G9/G22: expire what has run out, then let what is still in force act. Last,
  // because it is the only part of the turn boundary that reads a clock, and
  // putting it last means every number it uses is already the incoming turn's.
  s = tickLiveEffects(s, ctx);

  return { ok: true, state: s, events };
}

// ─────────────────────────── the reducer ───────────────────────────

export function reduce(state: GameState, playerId: PlayerID, action: Action, ctx: Ctx): Result {
  const { rules, cards } = ctx;
  if (state.finished) return fail('the game is over');

  const self = state.players[playerId];
  if (!self) return fail(`unknown player ${playerId}`);

  // G13: an open response window freezes the whole table except the two moves the
  // window exists for, plus `RESOLVE_CHOICE` so a player frozen by p12 can always
  // thaw. Placed FIRST, above the per-player freeze, because the window is the more
  // fundamental one: it is not about this player, it is about the card.
  const window = openInterrupt(state);
  if (
    window !== null &&
    action.type !== 'RESPOND_INTERRUPT' &&
    action.type !== 'PASS_INTERRUPT' &&
    action.type !== 'RESOLVE_CHOICE'
  ) {
    return fail(`"${interruptCardName(window, ctx)}" is resolving — answer it or decline first`);
  }

  // A pending decision freezes that player. p12 says so for the resource cap, and it
  // is the only sane reading for a card effect that is mid-resolution.
  const blocker = blockedBy(state, playerId);
  if (blocker && action.type !== 'RESOLVE_CHOICE') {
    return fail(`resolve "${blocker.choice.reason}" first`);
  }

  // p19 / rules-reference.md:283: a Conspiracy Card may be played out of turn,
  // right before an opponent answers. Everything else is active-player only.
  // The phase windows themselves are checked in the PLAY_CONSPIRACY case.
  const outOfTurnOk = action.type === 'PLAY_CONSPIRACY' && state.phase === 'answer';
  // G13: the two response-window moves are out-of-turn for EVERYBODY, which is the
  // point — a BLOCK is played by a player who is not the active one, and a DEFLECT
  // is played by a player the card they are answering has not even reached yet.
  const responding = action.type === 'RESPOND_INTERRUPT' || action.type === 'PASS_INTERRUPT';
  if (playerId !== state.activePlayer && !outOfTurnOk && !responding && action.type !== 'RESOLVE_CHOICE') {
    return fail('not your turn');
  }

  switch (action.type) {
    // ───────────── start of turn ─────────────

    case 'REDRAW_IDEOLOGY': {
      if (state.phase !== 'answer') return fail('you have already answered');
      if (state._pendingCard === null) return fail('no card to redraw');
      // R3: a Delta arrives from the client. Never trust its sign.
      const bad = deltaError(action.pay, 'a redraw payment');
      if (bad) return fail(bad);
      if (deltaTotal(action.pay) !== rules.redrawCost) {
        return fail(`a redraw costs exactly ${rules.redrawCost} resources`);
      }
      if (!canAfford(self.resources, action.pay)) return fail('you cannot afford that');

      let s = state;
      [s] = takeResources(s, playerId, action.pay);
      s = discardTo(s, 'ideology', state._pendingCard);
      const [drawn, cardId] = draw(s, 'ideology');
      s = { ...drawn, _pendingCard: cardId };
      s = log(s, { player: playerId, text: 'Demanded a different question.', kind: 'card' });
      return { ok: true, state: s, events: [] };
    }

    case 'ANSWER': {
      if (state.phase !== 'answer') return fail('you have already answered');
      const cardId = state._pendingCard;
      if (cardId === null) return fail('no card has been put to you');
      const card = cards.ideology[cardId];
      // No card id in the error: `Result.error` is client-visible, and this id is
      // the card being answered blind. Leaking it ends the game permanently.
      if (!card) return fail('the Ideology Card put to you could not be read');
      const side = card.sides[action.side];
      if (!side) return fail('invalid side');

      let s = state;
      s = withPlayer(s, playerId, {
        manifesto: [...self.manifesto, side.ideologue],
        manifestoCards: [...self.manifestoCards, cardId],
      });
      // The answered card joins the Ideology discard pile, which is what makes the
      // deck recycle. This one line is the difference between a game that ends on
      // a rule and a game that ends on turn 52. Rationale in `advanceTurn`.
      s = discardTo(s, 'ideology', cardId);
      // p13: receive the answer's resources…
      s = addResources(s, playerId, side.pays);
      // …p28: …plus the passive bonus, counting the card just added.
      const after = s.players[playerId];
      if (after) s = addResources(s, playerId, passiveBonus(after, rules));
      s = enforceCap(s, playerId, rules);

      s = { ...s, phase: 'actions', _pendingCard: null };
      s = log(s, { player: playerId, text: `"${side.answer}"`, kind: 'answer' });

      return {
        ok: true,
        state: s,
        events: [{ type: 'answered', player: playerId, cardId, side: action.side }],
      };
    }

    // ───────────── turn actions ─────────────

    case 'INFLUENCE': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      // G5. The freeze is checked BEFORE affordability, so a locked player is told
      // why rather than being left to wonder whether they are poor. p12's language —
      // "you cannot take any other actions" — is the same freeze, and a live effect
      // cannot produce this state: only a `restrict` op can.
      if (purchasesBlocked(state, playerId)) {
        return fail('you cannot make any purchases until you have made your donation');
      }
      const slot = state.market[action.slot];
      if (!slot) return fail('no Voter Card in that slot');

      const discounts = action.discounts ?? [];
      if (discounts.length > usesLeft(self, rules, 'helping-hands')) {
        return fail('not enough Helping Hands discounts left');
      }
      const discounted = applyDiscounts(slot.cost, discounts);
      // A surcharge is added AFTER Helping Hands, and that ordering is a ruling.
      // Helping Hands is the Idealist's own L3 power — p32, "reduce the cost of any
      // purchase" — so letting it discount a tax would let a player buy their way out
      // of somebody else's card. The card says "an EXTRA resource", not "one resource
      // less than usual", and the safe reading of a cost modifier nobody asked for is
      // that it stacks on top of what the player was already going to pay.
      const surcharge = surchargeFor(state, playerId);
      const cost =
        surcharge > 0
          ? { ...discounted, funds: (discounted.funds ?? 0) + surcharge }
          : discounted;
      if (!canAfford(self.resources, cost)) return fail('you cannot afford that Voter Card');

      let voters = slot.voters;
      if (action.viral) {
        if (usesLeft(self, rules, 'going-viral') <= 0) return fail('Going Viral is spent for this turn');
        voters += 1;
      }

      let s = state;
      [s] = takeResources(s, playerId, cost);
      s = withPlayer(s, playerId, {
        powerUses: {
          ...self.powerUses,
          helpingHands: self.powerUses.helpingHands + discounts.length,
          goingViral: self.powerUses.goingViral + (action.viral ? 1 : 0),
        },
      });
      // p10: voters from a single Voter Card cannot be split across zones.
      s = grantVoters(s, playerId, voters, 'Voter Card', true);
      s = discardTo({ ...s, market: s.market.filter((_, i) => i !== action.slot) }, 'voter', slot.cardId);
      s = refillMarket(s, ctx);
      s = log(s, {
        player: playerId,
        text: `Influenced ${voters} voter${voters === 1 ? '' : 's'}.`,
        kind: 'voters',
      });

      // G14, the purchase trigger. TWO events, in this order, and the order is a
      // ruling rather than an accident: `on-voter-influenced` is the specific one and
      // is raised first, so a table with a specific hook and a general hook sees the
      // specific one resolve before the general one. `FireContext.voters` carries the
      // size of the card just bought, which is what POWER TRIP's condition reads.
      s = fireTriggers(
        s,
        { trigger: 'on-voter-influenced', actor: playerId, voters, areaId: null, pegOwner: null },
        ctx,
      );
      s = fireTriggers(
        s,
        { trigger: 'on-purchase', actor: playerId, voters, areaId: null, pegOwner: null },
        ctx,
      );

      return {
        ok: true,
        state: s,
        events: [{ type: 'influenced', player: playerId, voters }],
      };
    }

    case 'PLACE_VOTERS': {
      const group = self.pending.find((g) => g.id === action.groupId);
      if (!group) return fail('no such group of voters');
      if (action.areaIds.length === 0) return fail('place at least one voter');
      if (action.areaIds.length > group.count) return fail('you do not have that many voters');
      if (group.sameZone && action.areaIds.length !== group.count) {
        return fail('voters from one Voter Card must all be placed together');
      }
      if (new Set(action.areaIds).size !== action.areaIds.length) return fail('duplicate area');

      const areas = action.areaIds.map((id) => findArea(state, id));
      if (areas.some((a) => a === undefined)) return fail('unknown area');
      const resolved = areas as Area[];
      if (resolved.some((a) => a.peg !== null)) return fail('that area is already taken');
      if (group.sameZone && new Set(resolved.map((a) => a.zone)).size > 1) {
        return fail('voters from one Voter Card cannot be split across zones');
      }

      let s = state;
      const events: GameEvent[] = [];
      const volatileHits: string[] = [];
      for (const area of resolved) {
        const edit = setArea(s, { ...area, peg: { owner: playerId, majority: false } }, ctx);
        s = edit.state;
        events.push(...edit.events);
        if (area.volatile) {
          volatileHits.push(area.id);
          events.push({ type: 'volatile', player: playerId, areaId: area.id });
        }
      }

      const remaining = group.count - action.areaIds.length;
      s = withPlayer(s, playerId, {
        pending:
          remaining > 0
            ? self.pending.map((g) => (g.id === group.id ? { ...g, count: remaining } : g))
            : self.pending.filter((g) => g.id !== group.id),
      });

      // p18: each voter placed in a Volatile Area triggers one Headline, resolved
      // at the end of the turn, in placement order.
      if (volatileHits.length > 0) {
        s = {
          ...s,
          headlineQueue: [...s.headlineQueue, ...volatileHits.map((areaId) => ({ areaId, by: playerId }))],
        };
        s = log(s, { player: playerId, text: 'A volatile area is stirred. Headlines will follow.', kind: 'card' });
      }

      for (const e of events) {
        if (e.type === 'majority-formed') {
          const zone = findZone(s, e.zoneId);
          s = log(s, {
            player: e.player,
            text: `Majority formed in ${zone?.name ?? e.zoneId}.`,
            kind: 'majority',
          });
        }
      }

      events.push({ type: 'placed', player: playerId, areaIds: action.areaIds });
      return { ok: true, state: s, events };
    }

    case 'GERRYMANDER': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      const rightsZone = findZone(state, action.zoneId);
      if (!rightsZone) return fail('unknown zone');
      if (gerrymanderRights(rightsZone) !== playerId) {
        return fail(`you do not hold Gerrymandering Rights in ${rightsZone.name}`);
      }
      if (gerrymanderAllowance(state, playerId, rules, action.zoneId) <= 0) {
        return fail(`you have already gerrymandered ${rightsZone.name} this turn`);
      }

      const from = findArea(state, action.fromAreaId);
      const to = findArea(state, action.toAreaId);
      if (!from || !to) return fail('unknown area');
      if (from.id === to.id) return fail('that voter is already there');
      if (!from.peg) return fail('there is no voter there');
      if (to.peg) return fail('that area is taken');

      // p18: a peg in a Volatile Area is permanent.
      if (from.volatile) return fail('voters in a Volatile Area cannot be moved');

      // p16: only non-majority voters, unless a power says otherwise. Election Fever
      // (Showstopper L5) is exactly that exception.
      const feverish = hasPower(self, rules, 'election-fever');
      if (from.peg.majority && !feverish) return fail('majority voters cannot be gerrymandered');

      // p16 (rules-reference.md:253-254): the right is scoped to moves "into that
      // zone, out of it, or between it and an adjacent zone". So at least one end
      // of the move must be the rights zone itself — R6: the old code computed
      // `touchesRightsZone`, and when it was false still fell through to a
      // neighbour test, letting a move between two zones where the player holds
      // *no* rights through and charging the allowance to the rights zone.
      const touchesRightsZone = from.zone === action.zoneId || to.zone === action.zoneId;
      if (!touchesRightsZone) return fail('that move does not involve the zone you hold');
      if (from.zone !== to.zone && !rightsZone.neighbours.includes(from.zone) &&
        !rightsZone.neighbours.includes(to.zone)) {
        return fail('zones are not adjacent');
      }

      // p17: you may not move your only voter out of a zone using that zone's rights.
      if (from.zone === action.zoneId && from.peg.owner === playerId && pegsOf(rightsZone, playerId) === 1) {
        return fail('that is your only voter here — moving it would forfeit the zone');
      }

      const mover = from.peg;
      let s = state;
      let edit = setArea(s, { ...from, peg: null }, ctx);
      s = edit.state;
      const events = [...edit.events];
      const toNow = findArea(s, to.id);
      if (!toNow) return fail('unknown area');
      edit = setArea(s, { ...toNow, peg: { owner: mover.owner, majority: false } }, ctx);
      s = edit.state;
      events.push(...edit.events);

      // D6, RULED: a gerrymanded-into Volatile Area queues one Headline, attributed
      // to the player who performed the move. The rulebook never says gerrymandering
      // is a placement, so this is a ruling rather than a citation. Evidence, in
      // order of weight:
      //   1. A real card calls it a placement. SUBMERGED / New Face Who Dis (one
      //      card, printed twice; AUTHENTIC-SHASN-REFERENCE.md:270 and :345):
      //      "every player can Gerrymander 1 majority or non-majority voter
      //      immediately. These voters cannot be placed into Volatile Areas." A
      //      gerrymander is otherwise unremarkable, so the prohibition exists only
      //      because p18's Volatile Area rule attaches to the move.
      //   2. The trigger is a board event. Quantum Wristband (:299) triggers "when
      //      a voter is placed in a Volatile Area" and is analysed as *overriding
      //      the Headline trigger*; the trigger's scope is the placement, not the
      //      verb that caused it.
      //   3. p18 already permits moving anyone's voter (rules-reference.md:324,
      //      "your own or an opponent's"), so this is the same case PLACE_VOTERS
      //      covers, not a new one — and the placement path already attributes the
      //      Headline to the acting player.
      // The rejected reading was that the Headline is the price of drawing from
      // your own supply, so a moved voter should not pay it twice. Rejected because
      // it makes an identical, publicly visible board position — a peg in a cog —
      // carry different consequences depending on how the peg got there, which no
      // player can observe. A future ruling for the other reading deletes this
      // block and the single assertion named in gerrymander.test.ts.
      if (to.volatile) {
        s = {
          ...s,
          headlineQueue: [...s.headlineQueue, { areaId: to.id, by: playerId }],
        };
        events.push({ type: 'volatile', player: playerId, areaId: to.id });
      }

      s = withPlayer(s, playerId, {
        powerUses: {
          ...self.powerUses,
          gerrymandered: {
            ...self.powerUses.gerrymandered,
            [action.zoneId]: (self.powerUses.gerrymandered[action.zoneId] ?? 0) + 1,
          },
        },
      });
      s = log(s, { player: playerId, text: `Gerrymandered a voter out of ${rightsZone.name}.`, kind: 'gerrymander' });

      // G14: `on-gerrymander`, with the OWNER of the moved peg in `pegOwner`. That is
      // the whole of GROWING DISSENT's condition — "every time any opponent
      // Gerrymanders YOUR voters" — and it is why `pegOwner` is a field rather than
      // something re-derived from the board: the peg has already moved by the time
      // anyone asks.
      s = fireTriggers(
        s,
        {
          trigger: 'on-gerrymander',
          actor: playerId,
          voters: 0,
          areaId: to.id,
          pegOwner: mover.owner,
        },
        ctx,
      );

      events.push({ type: 'gerrymandered', player: playerId, from: from.id, to: to.id });
      return { ok: true, state: s, events };
    }

    case 'TRADE': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      const other = state.players[action.withPlayer];
      if (!other) return fail('unknown player');
      if (other.id === playerId) return fail('you cannot trade with yourself');

      const giveCards = action.giveCards ?? [];
      const receiveCards = action.receiveCards ?? [];
      // R3: both sides are client-supplied Deltas. A negative component would make
      // `takeResources` skip it and `addResources` credit the other side, minting
      // resources out of nothing.
      const badGive = deltaError(action.give, 'your side of the trade');
      if (badGive) return fail(badGive);
      const badReceive = deltaError(action.receive, 'their side of the trade');
      if (badReceive) return fail(badReceive);
      // p12: at least 1 resource must be exchanged by both parties.
      if (deltaTotal(action.give) < 1 || deltaTotal(action.receive) < 1) {
        return fail('both sides must exchange at least one resource');
      }
      if (!canAfford(self.resources, action.give)) return fail('you cannot afford your side');
      if (!canAfford(other.resources, action.receive)) return fail('they cannot afford their side');
      if (giveCards.some((c) => !self.conspiracies.includes(c))) return fail('you do not hold that card');
      if (receiveCards.some((c) => !other.conspiracies.includes(c))) return fail('they do not hold that card');

      let s = state;
      [s] = takeResources(s, playerId, action.give);
      [s] = takeResources(s, action.withPlayer, action.receive);
      s = addResources(s, playerId, action.receive);
      s = addResources(s, action.withPlayer, action.give);
      s = withPlayer(s, playerId, {
        conspiracies: [...self.conspiracies.filter((c) => !giveCards.includes(c)), ...receiveCards],
      });
      s = withPlayer(s, action.withPlayer, {
        conspiracies: [...other.conspiracies.filter((c) => !receiveCards.includes(c)), ...giveCards],
      });
      s = enforceCap(s, playerId, rules);
      s = enforceCap(s, action.withPlayer, rules);
      s = log(s, { player: playerId, text: `Struck a deal with ${other.name}.`, kind: 'card' });
      return { ok: true, state: s, events: [] };
    }

    case 'BUY_CONSPIRACY': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      if (purchasesBlocked(state, playerId)) {
        return fail('you cannot make any purchases until you have made your donation');
      }
      const topId = state._conspiracyDraw[0];
      if (topId === undefined) return fail('the Conspiracy deck is exhausted');
      const card = cards.conspiracy[topId];
      if (!card) return fail('unknown conspiracy card');

      const discounts = action.discounts ?? [];
      if (discounts.length > usesLeft(self, rules, 'helping-hands')) {
        return fail('not enough Helping Hands discounts left');
      }
      // p19: "any combination of resources" totalling the printed cost. The surcharge
      // stacks on top of the printed cost, for the same reason as INFLUENCE above:
      // PYTHONPOST taxes a purchase, it does not discount it.
      const due = Math.max(0, card.cost - discounts.length) + surchargeFor(state, playerId);
      // R3: client-supplied payment.
      const bad = deltaError(action.pay, 'a conspiracy payment');
      if (bad) return fail(bad);
      if (deltaTotal(action.pay) !== due) return fail(`that costs ${due} resources in any combination`);
      if (!canAfford(self.resources, action.pay)) return fail('you cannot afford that');

      let s = state;
      [s] = takeResources(s, playerId, action.pay);
      s = { ...s, _conspiracyDraw: s._conspiracyDraw.slice(1) };
      s = withPlayer(s, playerId, {
        conspiracies: [...self.conspiracies, topId],
        powerUses: { ...self.powerUses, helpingHands: self.powerUses.helpingHands + discounts.length },
      });
      s = syncConspiracyTop(s, ctx);
      s = log(s, { player: playerId, text: 'Bought a Conspiracy.', kind: 'card' });

      // G14: a Conspiracy purchase raises `on-purchase` and nothing else.
      // `on-voter-influenced` is deliberately NOT raised — there is no Voter Card
      // here, so `FireContext.voters` would be 0 and a condition like POWER TRIP's
      // would be silently false for a reason that has nothing to do with the card.
      s = fireTriggers(
        s,
        { trigger: 'on-purchase', actor: playerId, voters: 0, areaId: null, pegOwner: null },
        ctx,
      );

      return { ok: true, state: s, events: [] };
    }

    case 'PLAY_CONSPIRACY': {
      // p19 / rules-reference.md:282-283: playable "at any point during your turn"
      // — the `actions` phase — "and also immediately before an opponent answers
      // their Ideology Card", which is the `answer` phase. It is scoped to those
      // two windows, and neither of them is open while the post-turn Headline queue
      // is draining. R9: this case had no phase check of its own, and the turn
      // guard above exempts the ACTIVE player entirely, so a conspiracy could
      // resolve mid-queue, mutate the board and push new choices while Headlines
      // were still pending.
      if (state.phase !== 'actions' && state.phase !== 'answer') {
        return fail('resolve the Headline first');
      }
      if (!self.conspiracies.includes(action.cardId)) return fail('you do not hold that card');
      const card = cards.conspiracy[action.cardId];
      if (!card) return fail('unknown conspiracy card');

      let s = withPlayer(state, playerId, {
        conspiracies: self.conspiracies.filter((c) => c !== action.cardId),
      });
      // G13: somebody who can answer this card holds a BLOCK or a DEFLECT, so the
      // effects are held in `state.interrupt` instead of applied. Otherwise they
      // resolve here, exactly as they always have, in the same order.
      s = resolveCard(s, playerId, card, 'conspiracy', ctx);
      // The card is face up by the time any client can see the state that carries
      // the window: this play logs it by name and puts it on the discard pile, and
      // `InterruptWindow.effects` is public on exactly that strength. A client that
      // reads the window has learned nothing this log line did not already say.
      s = discardTo(s, 'conspiracy', action.cardId);
      s = log(s, { player: playerId, text: `Played "${card.name}".`, kind: 'card' });
      return { ok: true, state: s, events: [{ type: 'conspiracy', player: playerId, cardId: action.cardId }] };
    }

    // ───────────── Ideologue Powers ─────────────

    case 'POWER_PROSPECT': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      if (usesLeft(self, rules, 'prospecting') <= 0) return fail('Prospecting is not available');
      if (action.take.length === 0 || action.take.length > rules.prospectingTake) {
        return fail(`take up to ${rules.prospectingTake} resources`);
      }
      if (self.resources[action.give] < 1) return fail('you do not have that resource');

      let s = state;
      [s] = takeResources(s, playerId, { [action.give]: 1 });
      const gain: Delta = {};
      for (const r of action.take) gain[r] = (gain[r] ?? 0) + 1;
      s = addResources(s, playerId, gain);
      s = withPlayer(s, playerId, {
        powerUses: { ...self.powerUses, prospecting: self.powerUses.prospecting + 1 },
      });
      s = enforceCap(s, playerId, rules);
      s = log(s, { player: playerId, text: 'Prospecting: turned 1 resource into 2.', kind: 'power' });
      return { ok: true, state: s, events: [] };
    }

    case 'POWER_LAND_GRAB': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      if (usesLeft(self, rules, 'land-grab') <= 0) return fail('Land Grab is spent for this turn');
      const area = findArea(state, action.areaId);
      if (!area?.peg) return fail('there is no voter there');
      if (area.volatile) return fail('voters in a Volatile Area cannot be evicted');

      const victim = area.peg.owner;
      const edit = setArea(state, { ...area, peg: null }, ctx);
      let s = edit.state;
      // p34: the evicted voter goes back to its owner's mat and may be replaced
      // anywhere on their next turn, or it is discarded.
      s = grantVoters(s, victim, 1, 'Evicted', false);
      // R12: the acting player is re-read after the board mutation rather than
      // assumed present. `self` was captured before, and nothing in the reducer can
      // remove a player today — but a future evict-the-player effect would make a
      // non-null assertion here throw an opaque TypeError from inside `reduce`
      // instead of returning the `fail(...)` every other bad state produces.
      const me = s.players[playerId];
      if (!me) return fail(`unknown player ${playerId}`);
      s = withPlayer(s, playerId, {
        powerUses: { ...me.powerUses, landGrab: self.powerUses.landGrab + 1 },
      });
      s = log(s, {
        player: playerId,
        text: `Land Grab: evicted a voter belonging to ${s.players[victim]?.name ?? victim}.`,
        kind: 'power',
      });
      return { ok: true, state: s, events: edit.events };
    }

    case 'POWER_DONATIONS': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      if (usesLeft(self, rules, 'donations') <= 0) return fail('Donations is spent for this turn');
      const victim = state.players[action.from];
      if (!victim) return fail('unknown player');
      if (victim.id === playerId) return fail('snatch from someone else');
      if (victim.resources[action.res] < 1) return fail('they do not have that resource');

      let s = state;
      [s] = takeResources(s, action.from, { [action.res]: 1 });
      s = addResources(s, playerId, { [action.res]: 1 });
      s = withPlayer(s, playerId, {
        powerUses: { ...self.powerUses, donations: self.powerUses.donations + 1 },
      });
      s = enforceCap(s, playerId, rules);
      s = log(s, { player: playerId, text: `Donations: snatched from ${victim.name}.`, kind: 'power' });
      return { ok: true, state: s, events: [] };
    }

    case 'POWER_PAYBACK': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      if (usesLeft(self, rules, 'payback') <= 0) return fail('Payback is spent for this turn');
      const area = findArea(state, action.areaId);
      if (!area?.peg) return fail('there is no voter there');
      if (area.peg.owner === playerId) return fail("Payback targets an opponent's voter");
      if (area.volatile) return fail('voters in a Volatile Area cannot be discarded');
      if (self.resources[action.pay] < 1) return fail('you do not have that resource');

      let s = state;
      [s] = takeResources(s, playerId, { [action.pay]: 1 });
      const edit = setArea(s, { ...area, peg: null }, ctx);
      s = edit.state;
      // R12: see POWER_LAND_GRAB. A `fail(...)`, not a TypeError.
      const me = s.players[playerId];
      if (!me) return fail(`unknown player ${playerId}`);
      s = withPlayer(s, playerId, {
        powerUses: { ...me.powerUses, payback: self.powerUses.payback + 1 },
      });
      s = log(s, { player: playerId, text: 'Payback: a voter is struck from the roll.', kind: 'power' });
      return { ok: true, state: s, events: edit.events };
    }

    case 'POWER_TOUGH_LOVE': {
      if (state.phase !== 'actions') return fail('answer your Ideology Card first');
      if (usesLeft(self, rules, 'tough-love') <= 0) return fail('Tough Love is spent for this turn');
      if (action.areaIds.length !== rules.toughLoveConverts) {
        return fail(`Tough Love converts exactly ${rules.toughLoveConverts} voters`);
      }

      const areas = action.areaIds.map((id) => findArea(state, id));
      if (areas.some((a) => !a?.peg)) return fail('there is no voter there');
      const resolved = areas as Area[];
      if (resolved.some((a) => a.volatile)) return fail('voters in a Volatile Area cannot be converted');
      const owners = new Set(resolved.map((a) => a.peg?.owner));
      if (owners.size !== 1) return fail('both voters must belong to the same player');
      if (owners.has(playerId)) return fail('Tough Love targets an opponent');
      if (new Set(resolved.map((a) => a.zone)).size !== 1) return fail('both voters must be in the same zone');

      const discounts = action.discounts ?? [];
      if (discounts.length > usesLeft(self, rules, 'helping-hands')) {
        return fail('not enough Helping Hands discounts left');
      }
      // p32: 2 Trust + any 2 resources. Helping Hands may discount it.
      const baseTrust = rules.toughLoveTrust;
      const trustDiscounts = discounts.filter((d) => d === 'trust').length;
      const otherDiscounts = discounts.length - trustDiscounts;
      const needTrust = Math.max(0, baseTrust - trustDiscounts);
      const needAny = Math.max(0, rules.toughLoveAny - otherDiscounts);
      if ((action.pay.trust ?? 0) < needTrust) return fail(`Tough Love needs ${needTrust} Trust`);
      // R3: client-supplied payment. `{trust: 2, funds: -2}` would otherwise total
      // 2, satisfy the "plus 2 of anything" check, and cost nothing but the Trust.
      const bad = deltaError(action.pay, 'a Tough Love payment');
      if (bad) return fail(bad);
      if (deltaTotal(action.pay) !== needTrust + needAny) {
        return fail(`Tough Love costs ${needTrust} Trust plus ${needAny} of anything`);
      }
      if (!canAfford(self.resources, action.pay)) return fail('you cannot afford that');

      let s = state;
      [s] = takeResources(s, playerId, action.pay);
      const events: GameEvent[] = [];
      for (const area of resolved) {
        const now = findArea(s, area.id);
        if (!now?.peg) continue;
        // p34 Convert: replace the voter in the same area with your own.
        const edit = setArea(s, { ...now, peg: { owner: playerId, majority: false } }, ctx);
        s = edit.state;
        events.push(...edit.events);
      }
      // R12: see POWER_LAND_GRAB. A `fail(...)`, not a TypeError.
      const me = s.players[playerId];
      if (!me) return fail(`unknown player ${playerId}`);
      s = withPlayer(s, playerId, {
        powerUses: {
          ...me.powerUses,
          toughLove: self.powerUses.toughLove + 1,
          helpingHands: self.powerUses.helpingHands + discounts.length,
        },
      });
      s = log(s, { player: playerId, text: 'Tough Love: two voters change their minds.', kind: 'power' });
      return { ok: true, state: s, events };
    }

    // ───────────── choices, headlines, end of turn ─────────────

    case 'RESOLVE_CHOICE':
      return resolveChoice(state, playerId, action.choiceId, action.pick, ctx);

    // ───────────── G13: the response window ─────────────

    case 'RESPOND_INTERRUPT': {
      const w = window;
      if (w === null) return fail('there is nothing to answer');
      // The printed rule: a BLOCK "cannot be reversed or deflected", and a player
      // does not block their own card. Both are also the termination argument — a
      // window takes at most one answer.
      if (playerId === w.actor) return fail('you played that card');
      if (w.responder !== null) return fail('that card has already been answered');

      const card = cards.conspiracy[action.cardId];
      if (!card) return fail('unknown conspiracy card');
      if (!self.conspiracies.includes(action.cardId)) return fail('you do not hold that card');
      const interrupt = card.interrupt;
      if (!interrupt) return fail('that card cannot answer another card');
      if (!isReactive(interrupt.op)) return fail('that card is not a reactive interrupt');
      const notNow = mayRespond(state, interrupt);
      if (notNow !== null) return fail(notNow);

      if (interrupt.op === 'deflect') {
        // "redirect its effect on any player OTHER THAN THEM" — the actor is the
        // one exclusion the card states, and a DEFLECT aimed back at its own player
        // would be a no-op dressed as a card.
        if (action.at === undefined) return fail('name the player the effect is redirected to');
        if (action.at === w.actor) return fail('you cannot redirect it back at the player who played it');
        if (action.at === playerId) return fail('you cannot redirect it at yourself');
        if (!state.players[action.at]) return fail(`unknown player ${action.at}`);
      } else if (action.at !== undefined) {
        return fail('a Block negates the effect; there is nothing to redirect it to');
      }

      // Played face up, from the responder's own hand, into the public log — the
      // same two steps `PLAY_CONSPIRACY` takes, and for the same reason: a card
      // nobody has seen resolved is a card nobody can answer.
      let s = withPlayer(state, playerId, {
        conspiracies: self.conspiracies.filter((c) => c !== action.cardId),
      });
      s = discardTo(s, 'conspiracy', action.cardId);
      s = log(s, { player: playerId, text: `Played "${card.name}".`, kind: 'card' });
      s = {
        ...s,
        interrupt: {
          ...w,
          blocked: interrupt.op === 'block',
          deflectedTo: interrupt.op === 'deflect' ? (action.at ?? null) : null,
          responder: playerId,
        },
      };

      // One answer, then it closes. `advanceTurn` and `nextHeadlineOrAdvance` are
      // NOT re-entered before the window resolves — the card being answered was
      // already accounted for by the action that staged it, so closing resumes
      // exactly where that action left off rather than replaying its bookkeeping.
      return closeInterrupt(s, s.interrupt as InterruptWindow, ctx);
    }

    case 'PASS_INTERRUPT': {
      const w = window;
      if (w === null) return fail('there is nothing to answer');
      if (playerId === w.actor) return fail('you played that card');
      if (w.passed.includes(playerId)) return fail('you have already declined');

      const passed = [...w.passed, playerId];
      const s: GameState = { ...state, interrupt: { ...w, passed } };
      // Every player the window is waiting on has now declined, so it closes and the
      // staged card resolves as it would have with no BLOCK in anybody's hand.
      const outstanding = mustRespond(state, w.actor).some((p) => !passed.includes(p));
      if (outstanding) return { ok: true, state: s, events: [] };
      return closeInterrupt(s, s.interrupt as InterruptWindow, ctx);
    }

    case 'ACK_HEADLINE': {
      if (state.phase !== 'headlines') return fail('there is no Headline to resolve');
      const cardId = state.activeHeadline;
      if (cardId === null) return fail('there is no Headline to resolve');
      const card = cards.headline[cardId];
      if (!card) return fail('unknown headline card');

      const entry = state.headlineQueue[0];
      const source = entry?.by ?? playerId;

      let s: GameState = { ...state, headlineQueue: state.headlineQueue.slice(1) };
      s = resolveCard(s, source, card, 'headline', ctx);
      s = discardTo(s, 'headline', cardId);
      s = log(s, { player: source, text: `HEADLINE — ${card.name}`, kind: 'card' });

      if (openInterrupt(s) !== null) {
        // The window outlives this action, so the queue must NOT drain yet: calling
        // `nextHeadlineOrAdvance` now would advance the turn out from under a card
        // that has not resolved, and the turn boundary would be taken twice.
        // `closeInterrupt` resumes the queue instead.
        return { ok: true, state: s, events: [] };
      }
      return nextHeadlineOrAdvance({ ...s, activeHeadline: null }, ctx);
    }

    case 'END_TURN': {
      if (state.phase === 'answer') return fail('answer your Ideology Card first');
      if (state.phase === 'headlines') return fail('resolve the Headline first');
      // R7, ruled. rules-reference.md:140 (p12) freezes only "you": "You cannot
      // take any other actions until you do so." The old check was global, so a
      // player with no decisions of their own could not end their turn until every
      // opponent had resolved theirs — and a Conspiracy Card played out of turn
      // (p19 / rules-reference.md:283) can leave a decision pending for a player
      // who is not the active one, which stalled the table outright. Scoped to
      // `playerId`, matching the per-player freeze at the top of `reduce`.
      if (state.choices.some((c) => c.player === playerId)) {
        return fail('you have an unresolved decision');
      }
      return nextHeadlineOrAdvance({ ...state, phase: 'headlines' }, ctx);
    }
  }
}

/** Draw the next queued Headline, or move to the next player if the queue is empty. */
function nextHeadlineOrAdvance(state: GameState, ctx: Ctx): Result {
  if (state.headlineQueue.length === 0) {
    return advanceTurn({ ...state, phase: 'actions', activeHeadline: null }, ctx);
  }
  const [s, cardId] = draw(state, 'headline');
  if (cardId === null) {
    return advanceTurn({ ...s, phase: 'actions', headlineQueue: [], activeHeadline: null }, ctx);
  }
  return {
    ok: true,
    state: { ...s, phase: 'headlines', activeHeadline: cardId },
    events: [{ type: 'headline', cardId }],
  };
}

// ─────────────────────────── choice resolution ───────────────────────────

function resolveChoice(
  state: GameState,
  playerId: PlayerID,
  choiceId: string,
  pick: ChoicePick,
  ctx: Ctx,
): Result {
  const pending = state.choices.find((c) => c.id === choiceId);
  if (!pending) return fail('no such decision');
  if (pending.player !== playerId) return fail('that decision is not yours');

  const self = state.players[playerId];
  if (!self) return fail('unknown player');

  const drop = (s: GameState): GameState => ({ ...s, choices: s.choices.filter((c) => c.id !== choiceId) });
  const c = pending.choice;

  switch (c.kind) {
    // The next three take a client-supplied `Delta`. `deltaTotal` sums *signed*
    // values, so without the guard a pick like `{funds: 5, trust: -3}` passes a
    // "take exactly 2" check, `takeResources` skips the negative, and the
    // positive is credited — minting resources. R3.
    case 'gain-any': {
      if (pick.kind !== 'resources') return fail('choose resources');
      const bad = deltaError(pick.res, 'a gain');
      if (bad) return fail(bad);
      if (deltaTotal(pick.res) !== c.count) return fail(`choose exactly ${c.count}`);
      let s = addResources(state, playerId, pick.res);
      s = drop(s);
      return { ok: true, state: enforceCap(s, playerId, ctx.rules), events: [] };
    }

    case 'lose-any': {
      if (pick.kind !== 'resources') return fail('choose resources');
      const bad = deltaError(pick.res, 'a discard');
      if (bad) return fail(bad);
      // Clamp to what is held NOW, not to what was held when the ask was raised.
      //
      // Every other ask in this switch is clamped at resolution for the same
      // reason (`steal-any` to the victim's present pool, the three voter kinds to
      // the board as it stands), and `lose-any` was the one that was not — so it
      // could be left with NO legal pick at all. Real shape of the bug, found by
      // auditing every kind after the client's dead-`gain-any` dialog:
      //
      //   p1 holds 3 Funds and is asked to discard 3 (a card's `lose-any`, clamped
      //   at raise time to exactly what p1 held). Before p1 can answer, p2 plays a
      //   Conspiracy Card that strips 1 Fund from every opponent. p1 now holds 2,
      //   and `deltaTotal(pick) === 3` is unsatisfiable while `canAfford` refuses
      //   3 — so no pick resolves, `blockedBy` freezes p1, and the table is dead.
      //   A pending decision is not a lock the answering player holds: the ask is
      //   frozen but the pool is not.
      //
      // p12 says the player CHOOSES what to discard, so a smaller ask is still their
      // choice — and the clamp can only ever lower it to something they hold, so a
      // legal pick always exists.
      const wanted = Math.min(c.count, poolTotal(self.resources));
      if (deltaTotal(pick.res) !== wanted) return fail(`discard exactly ${wanted}`);
      if (!canAfford(self.resources, pick.res)) return fail('you do not hold those');
      let s = state;
      [s] = takeResources(s, playerId, pick.res);
      s = drop(s);
      // Discarding can still leave you over the cap if two effects stacked.
      return { ok: true, state: enforceCap(s, playerId, ctx.rules), events: [] };
    }

    case 'steal-any': {
      if (pick.kind !== 'steal') return fail('choose a player and resources');
      const bad = deltaError(pick.res, 'a theft');
      if (bad) return fail(bad);
      const victim = state.players[pick.from];
      if (!victim) return fail('unknown player');
      if (victim.id === playerId) return fail('steal from someone else');
      // When the card fixed the victim (`target`, or a live effect firing on this
      // player's purchase), a pick naming anybody else is a redirect of the theft
      // and is refused. `from: null` is the card saying "the thief picks", which is
      // the only case where the pick chooses the victim at all.
      if (c.from !== null && pick.from !== c.from) return fail('that is not the player you may take from');
      const want = Math.min(c.count, poolTotal(victim.resources));
      if (deltaTotal(pick.res) !== want) return fail(`take exactly ${want}`);
      if (!canAfford(victim.resources, pick.res)) return fail('they do not hold those');
      let s = state;
      [s] = takeResources(s, pick.from, pick.res);
      s = addResources(s, playerId, pick.res);
      s = drop(s);
      return { ok: true, state: enforceCap(s, playerId, ctx.rules), events: [] };
    }

    case 'evict-voter':
    case 'discard-voter':
    case 'convert-voter': {
      if (pick.kind !== 'areas') return fail('choose areas');
      const wanted = Math.min(c.count, targetableCount(state, playerId, c.kind, c.scope));
      if (pick.areaIds.length !== wanted) return fail(`choose exactly ${wanted}`);
      if (new Set(pick.areaIds).size !== pick.areaIds.length) return fail('duplicate area');

      let s = state;
      const events: GameEvent[] = [];
      for (const id of pick.areaIds) {
        const area = findArea(s, id);
        if (!area?.peg) return fail('there is no voter there');
        if (area.volatile) return fail('voters in a Volatile Area cannot be affected');
        // The scope is the card's, not the pick's: a card that named this player as
        // its victim asks them about their OWN voters, and a card that did not
        // leaves them unable to reach their own. See `ChoiceScope`.
        if (c.scope === 'own' && area.peg.owner !== playerId) return fail('that voter is not yours');
        if (c.scope === 'others' && area.peg.owner === playerId) return fail('that targets an opponent');
        // Converting your own voter into your own voter is not a conversion.
        if (c.kind === 'convert-voter' && area.peg.owner === playerId) return fail('that voter is already yours');
        const owner = area.peg.owner;
        const edit = setArea(
          s,
          c.kind === 'convert-voter'
            ? { ...area, peg: { owner: playerId, majority: false } }
            : { ...area, peg: null },
          ctx,
        );
        s = edit.state;
        events.push(...edit.events);
        if (c.kind === 'evict-voter') s = grantVoters(s, owner, 1, 'Evicted', false);
      }
      return { ok: true, state: drop(s), events };
    }
  }
}

/**
 * How many legal targets exist — a card cannot demand more than the board offers.
 *
 * `scope` is the card's, for the reason `ChoiceScope` documents: `'own'` counts only
 * the chooser's pegs, `'others'` only theirs opponents', `'any'` everything. The
 * default `'others'` is byte-for-byte the rule this function had before scopes
 * existed, which is what keeps the client's own copy of it in agreement.
 */
function targetableCount(state: GameState, playerId: PlayerID, kind: string, scope: ChoiceScope): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (!a.peg || a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== playerId) continue;
      if (scope === 'others' && a.peg.owner === playerId) continue;
      if (kind === 'convert-voter' && a.peg.owner === playerId) continue;
      n += 1;
    }
  }
  return n;
}

// ─────────────────────────── legality helpers for UI and bots ───────────────────────────

/** Zones where this player currently holds Gerrymandering Rights. p16. */
export function rightsZones(state: GameState, player: PlayerID): Zone[] {
  return state.zones.filter((z) => gerrymanderRights(z) === player);
}

/** Areas a pending group could legally be placed into. */
export function placeableAreas(state: GameState, groupId: string, player: PlayerID): Area[] {
  const p = state.players[player];
  const group = p?.pending.find((g) => g.id === groupId);
  if (!group) return [];
  const out: Area[] = [];
  for (const z of state.zones) {
    // p10: a Voter Card's voters must all fit in one zone or they are all discarded.
    if (group.sameZone && emptyAreas(z).length < group.count) continue;
    out.push(...emptyAreas(z));
  }
  return out;
}

export { subtract };
