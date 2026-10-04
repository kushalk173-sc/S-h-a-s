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
import { allMajoritiesFormed, areNeighbours, boardFull, recount, scores, winners } from './board';
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
  ZoneSelector,
} from './cards';
import { borrowedFrom, hasPower, passiveBonus, usesLeft } from './powers';
import { applyDiscounts, canAfford, deltaError, overCap, subtract } from './resources';
import { shuffle } from './rng';
import type { Rules } from './rules';
import {
  IDEOLOGUE_RESOURCE,
  NO_POWER_USES,
  RESOURCES,
  ZONE_IDS,
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
  revealedCardsOf,
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
  type ZoneID,
  type ZoneScope,
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
  const excess = overCap(p.resources, capOf(p, rules));
  if (excess <= 0) return state;
  const already = state.choices.some(
    (c) => c.player === id && c.choice.kind === 'lose-any' && c.choice.reason === 'Resource cap',
  );
  if (already) return state;
  return pushChoice(state, { kind: 'lose-any', count: excess, reason: 'Resource cap' }, id);
}

/**
 * G15 — THE CAP THIS PLAYER IS ACTUALLY HELD TO.
 *
 * The printed `rules.resourceCap`, unless `PlayerState.capOverride` holds a LOWER one
 * (THE BIG FREEZE). Read through this helper at every cap comparison rather than off
 * `rules` directly, which is what makes a reduction reach `enforceCap` instead of being a
 * number on a mat that nothing enforces — and a cap nothing enforces is not a rule.
 *
 * `min`, never `max`: a card can only make the cap more restrictive. The full argument,
 * the stacking ruling and the deadlock arithmetic are on the field.
 */
function capOf(player: PlayerState, rules: Rules): number {
  const over = player.capOverride?.to;
  if (over === undefined) return rules.resourceCap;
  return Math.min(rules.resourceCap, over);
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

/**
 * ANNOUNCE A CARD LEAVING THE RECYCLE PILE. `Picked "NAME".`, by the RECIPIENT.
 *
 * ## WHY A DEPARTURE HAS TO BE SPOKEN ALOUD
 *
 * Every other writer of `_conspiracyDiscard` puts a card ON the pile and is heard
 * doing it: `PLAY_CONSPIRACY` and `RESPOND_INTERRUPT` both write `Played "NAME".` in the
 * same breath. These two paths are the departures, and a departure that is not announced
 * is a side channel rather than an absence. The pile is PUBLIC — it is
 * `PublicView.conspiracyRecycle` — so a spectator holding two payloads can diff them,
 * see a named card leave with no log line, and combine that silence with the public
 * `Played "NAME".` to learn the card is now in a `PRIVATE_PLAYER_KEYS` hand. One card of
 * a hidden hand, disclosed to the whole table, by nothing but a missing line.
 *
 * So the departure is announced instead, and that is not a concession — it is the faithful
 * behaviour. The Conspiracy discard pile is face up at a real table; everyone watching
 * sees which card a player lifts off it and into whose hand it goes. Announcing removes
 * the covert channel by making the event legitimately public, which is the same
 * information the deduction already yields.
 *
 * ## AND IT REPAIRS THE PILE'S DERIVABILITY
 *
 * `pile = announced-Played minus announced-Picked`, in order, modulo a reshuffle. Every
 * departure now has a line, so the replay in `packages/server/test/secret-state.test.ts`
 * reconstructs the pile exactly and U1's safety argument is TRUE rather than merely
 * plausible. Before this line the reconstruction was a SUBSET relation and the pile could
 * silently lose a card — the 13% of real states where a played card is picked straight
 * back up, which no fixture reached and the deduction did.
 *
 * ## THE RECIPIENT, NOT THE ACTOR
 *
 * `draw-conspiracy` hands the card to a resolved target, and the announcement says who
 * now holds it. The actor is the card's player, who is on the log for the play itself.
 *
 * ## FAILS LOUD, NOT SILENT
 *
 * A card the index cannot name is announced WITHOUT a name rather than not at all. The
 * alternative is the exact bug this function exists to close, and it is unreachable
 * besides: every id on the pile got there via a `Played` line, and `PLAY_CONSPIRACY` and
 * `RESPOND_INTERRUPT` both refuse a `cardId` the index cannot read.
 */
function announcedPick(state: GameState, recipient: PlayerID, cardId: CardID, ctx: Ctx): GameState {
  const card = ctx.cards.conspiracy[cardId];
  return log(state, {
    player: recipient,
    text: card === undefined ? 'Picked a Conspiracy Card.' : `Picked "${card.name}".`,
    kind: 'card',
  });
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

function resolveTargets(
  state: GameState,
  source: PlayerID,
  target: EffectTarget,
  forced: PlayerID | null = null,
): PlayerID[] {
  // G1. A `'choose-player'` effect has ALREADY been resolved — `resolveChoice` named
  // the player — so the decision is over and the effect re-runs against them. This
  // one line is why no op needs to know that `'chosen-player'` exists: every
  // `resolveTargets` call in `applyEffect` is correct for a forced player without
  // knowing why it is being forced.
  if (forced !== null) return [forced];
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
    case 'chosen-player':
      // Unreachable: `applyEffect` intercepts `'chosen-player'` above its switch and
      // never reaches an op's case with it. It is here so the switch is TOTAL, which
      // is what makes a future `EffectTarget` member a compile error at every site
      // rather than a `undefined` player list at runtime.
      return [];
    case 'player-after': {
      // G12. One index into the seat order, wrapping. See `EffectTarget` in cards.ts for
      // why one member serves both recovered phrasings ("the opponent on their left"
      // and "the player after you") and why this is a pure function rather than a
      // decision — it is `turnOrder`, which every client already has in full, so it
      // adds nothing to the wire and needs no `Choice` kind.
      //
      // The `indexOf === -1` guard is about a HAND-BUILT state rather than a card: the
      // seat is always in the order the engine produced. It returns `[]` rather than
      // `undefined`-ish nonsense because "affects nobody" is the safe direction for a
      // target, and it is a branch rather than a comment because a comment does not
      // fail a test.
      const i = state.turnOrder.indexOf(source);
      if (i < 0 || state.turnOrder.length < 2) return [];
      const next = state.turnOrder[(i + 1) % state.turnOrder.length];
      return next === undefined ? [] : [next];
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
  /**
   * The card's RAW `target` field — `undefined` when it wrote none.
   *
   * G-new, and the distinction is the whole of it. `applyEffect` computes one
   * `target` for the whole effect list and defaults it to `'you'`, so by the time a
   * case gets here an absent field and an explicit `target: 'you'` are the same
   * value. They are NOT the same card: *"Discard 2 voters"* and *"Discard 2 of your
   * OWN voters"* are both real recovered text (REF 4.3: AIN'T NO CURE FOR LOVE says
   * the second, RED BLOODED says the first), both land on `discard-voter`, and before
   * this change both reached opponents' voters only. Passing the raw field is what
   * lets `voterScope` tell them apart.
   */
  named: EffectTarget | undefined,
  /**
   * G16 — the RAW `zone` field, plus the constituency a `'choose-zone'` decision
   * already resolved to. `resolveZone` prefers the resolved value, so the three
   * selectors and the two entry points (raise fresh, resolve a decision) are one
   * path and not two.
   */
  zone: ZoneSelector | undefined,
  forcedZone: ZoneID | null,
  ctx: Ctx,
): GameState {
  let s = state;
  const target = named ?? 'you';
  const resolvedZone = resolveZone(s, source, zone, forcedZone);
  for (const p of resolveTargets(s, source, target)) {
    const scope = voterScope(p, source, kind, named);
    s = pushChoice(
      s,
      {
        kind,
        count: resolveCount(s, p, n, ctx),
        scope,
        // G16. Both halves are published: `zone` says WHICH rule narrowed the decision
        // so the dialog can explain it, and `zoneId` is the narrowing itself. The id is
        // public — it is a fixed constituency on a board every client already has in
        // full — and it is the only piece that is NOT re-derivable from the card, since
        // for `'chosen-zone'` it is the player's own answer.
        ...(zone === undefined ? {} : { zone: zoneOfSelector(zone, forcedZone) }),
        ...(resolvedZone === null ? {} : { zoneId: resolvedZone }),
        reason: 'Card effect',
      },
      p,
    );
  }
  return s;
}

/**
 * G16 — the `ZoneScope` a resolved zone is published under.
 *
 * `'chosen-zone'` becomes a concrete `ZoneID` on the decision rather than staying a
 * selector, which is the whole reason the two kinds are different types: a client
 * cannot act on a selector, so it never receives one. A zone resolved from
 * `'this-zone'` or `'your-strongest'` keeps its selector name so the UI can say
 * WHICH zone rule produced it ("the constituency whose placement drew this Headline")
 * rather than naming a bare id it cannot explain.
 */
function zoneOfSelector(zone: ZoneSelector | undefined, forcedZone: ZoneID | null): ZoneScope {
  if (forcedZone !== null) return 'chosen-zone';
  return zone === 'this-zone' || zone === 'your-strongest' ? zone : 'any';
}

/**
 * Which pegs a voter decision may name. G-new, and each row is a shipped card.
 *
 *  - somebody the card NAMED answers about their own pegs — *"All your opponents
 *    evict 1 voter"* (KHAKI TERROR's shape), and the victim of a theft picks the
 *    denomination, so `own` is right for all three kinds.
 *  - the caster evicting may reach anything: eviction said "any voter" before scopes
 *    existed.
 *  - the caster CONVERTING may not reach their own, because `resolveChoice` refuses
 *    it — converting your own voter into your own voter is not a conversion, and
 *    naming `target: 'you'` does not make it one.
 *  - the caster DISCARDING reaches their OWN pegs when the card SAID `target: 'you'`
 *    (G-new) and opponents' when it said nothing. The default is unchanged, and it
 *    has to be: three shipped cards state the opponents' reading in their own text
 *    and `others` is what they have always performed.
 */
function voterScope(
  chooser: PlayerID,
  source: PlayerID,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
  named: EffectTarget | undefined,
): ChoiceScope {
  if (chooser !== source) return 'own';
  if (kind === 'evict-voter') return 'any';
  if (kind === 'convert-voter') return 'others';
  return named === 'you' ? 'own' : 'others';
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
 * G4/G15 — the ask a `gain-any` / `lose-any` decision carries: `n`, times `per`.
 *
 * **`per` is read off `readFrom`, which is `forcedRead` when a `'chosen-player'` has
 * already been answered and the RECIPIENT otherwise.** That single ternary is the whole of
 * THOUGHTS AND PRAYERS: with `read: 'chosen-player'`, `per: { of: 'volatile-voters' }` and
 * `target: 'you'`, the caster is paid `2 ×` the CHOSEN player's Volatile-Area pegs. Without
 * `per` the multiplier is 1 and the arithmetic is byte-identical to every shipped card.
 *
 * `Math.max(0, …)` rather than a bare product: a computed source that reads zero must
 * produce a ZERO ask, not a negative one, because `Choice.count` is a `number` the client
 * renders and a negative grant would be a dialog asking for a negative amount of
 * resources. `lose-any` clamps to the pool immediately afterwards in any case, and
 * `gain-any` has no ceiling at all — which is the deliberate asymmetry `gain-any`'s own
 * case documents (a resource you are about to be given is not one you must already own).
 */
function resolveAsk(
  state: GameState,
  recipient: PlayerID,
  n: Count,
  per: ComputedCount | undefined,
  readFrom: PlayerID | null,
  ctx: Ctx,
): number {
  const base = resolveCount(state, recipient, n, ctx);
  if (per === undefined) return base;
  const k = computedValue(state, readFrom ?? recipient, per.of, undefined, ctx);
  return Math.max(0, base * k);
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
    case 'revealed-card':
      // HOW MANY OF THE PLAYER'S OWN CARDS ARE FACE UP RIGHT NOW, which is a count of
      // the table rather than of a pile: every id in the list was turned over by a
      // `reveal`, so this value discloses nothing a client cannot already see by
      // looking. `revealedCardsOf` rather than `state.revealedCards[player] ?? []` so
      // the read is the SAME expression the write in `case 'reveal'` used, and an
      // empty reveal and an un-updated fixture are one thing to the reducer.
      //
      // The empty-set case is `0`, which is the honest answer: a player who has
      // revealed nothing has nothing to count. It is the same number the pre-execution
      // stub returned, and it is now reachable only through that route — a card with
      // this source and no reveal in front of it — rather than being the fallback for
      // every player in the game.
      return revealedCardsOf(state, player).length;
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
 * G14b — voters LOST on each Voter Card this player influences right now.
 *
 * Summed rather than maxed, for the same reason `surchargeFor` sums: two cards that both
 * shorten a purchase shorten it twice, which is what two cards means.
 *
 * `remaining > 0` is the whole of the liveness test, and it is not a second definition of
 * the deadline — a spent entry is REMOVED by `spendVoterShortfall`, so an entry at zero
 * cannot be in this list.
 */
function voterShortfall(state: GameState, id: PlayerID): number {
  return restrictionsOf(state, id, 'voter-shortfall')
    .filter((r) => r.remaining > 0)
    .reduce((n, r) => n + Math.max(0, r.value), 0);
}

/**
 * G14b, the counter: one Voter Card's worth of every shortfall this player carries.
 *
 * Decremented per INFLUENCE rather than per voter lost, because the printed clause counts
 * CARDS. A 1-Voter Card under a 2-voter shortfall yields nothing and still spends one, so
 * a player cannot extend a debuff by buying small cards.
 *
 * **Pure, and derived from state only.** `remaining` is a number that was written down
 * when the card resolved, so a replay from seed + action log reproduces the counter
 * without re-deriving it — which is R2's requirement, and the reason this is not a
 * module-scope `let`.
 */
function spendVoterShortfall(state: GameState, id: PlayerID): GameState {
  const player = state.players[id];
  if (!player) return state;
  const restrictions = player.restrictions ?? [];
  if (!restrictions.some((r) => r.kind === 'voter-shortfall' && r.remaining > 0)) return state;
  const next = restrictions
    .map((r) => (r.kind === 'voter-shortfall' && r.remaining > 0 ? { ...r, remaining: r.remaining - 1 } : r))
    .filter((r) => !(r.kind === 'voter-shortfall' && r.remaining <= 0));
  return { ...state, players: { ...state.players, [id]: { ...player, restrictions: next } } };
}

/**
 * G18 — is this player earning nothing for answering an Ideology Card?
 *
 * **EXPIRY IS NOT CHECKED HERE**, for the same reason `powers.ts usesLeft` does not
 * check it: `restrictionsOf` reads a `PlayerState` and `expiresTurn` is an absolute
 * TURN number, so re-deriving the deadline here would be a second definition of the
 * same clock — the failure mode where a rule lives one turn too long in one place and
 * not another. `expireRestrictions` in `advanceTurn` removes what has run out, on the
 * same clock that resets `powerUses`. `restrictions.test.ts` pins that a `no-income`
 * imposed for `'next-turn'` is in force for exactly that turn and no other.
 */
function incomeBlocked(state: GameState, id: PlayerID): boolean {
  return restrictionsOf(state, id, 'no-income').length > 0;
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
 * ## RULING 1 — IT IS A *GIVING*, NOT A LOSING (C1)
 *
 * **THE BUG THIS FUNCTION HAD.** It was reached from the `lose` case for EVERY
 * resource loss to the player, from any card, by anyone, and it decremented every
 * `'no-purchases'` entry it found. So an OPPONENT'S DRAIN discharged the lock: the
 * audit's probe had a locked player lose 4 Funds to somebody else's card, donate
 * nothing whatever, and find the restriction removed — the entry was not even
 * zeroed, it was `filter`ed away. "Until you donate" is a claim about the DIRECTION
 * of a loss. A `lose` whose affected player is somebody else is a *taking*, and it
 * is precisely the one thing the printed sentence is not.
 *
 * **THE FIX IS AT THE CALL SITE, not here, and that placement is the ruling.**
 * `applyEffect`'s `lose` case computes `donated = p === source` — the loss landed on
 * the actor's own mat — and only then calls this function. `p === source` is the
 * whole test, and it is a test rather than a flag threaded through the effect list
 * because the engine has no notion of "this particular clause is a donation": a
 * donation and a drain are the same op with a different target, and the target is
 * already resolved here.
 *
 * **WHY NOT "ONLY THE IMPOSING CARD'S DONATION", which is the stricter reading.**
 * Because a Headline Card resolves once per game, so a lock keyed to its own card
 * is a lock whose only key is a card nobody holds any more — the undischargeable-ask
 * shape this codebase has now been bitten by twice (the original scalar `remaining`
 * argument above, and `lose-any` before it was clamped to the chooser's pool). The
 * printed condition is "until you donate", not "until you play this card again", and
 * the direction test is what the sentence actually says. What is left is therefore
 * *strictly weaker than any drain* and *strictly weaker than any other player's
 * giving*, which is the honest reading of a public condition.
 *
 * ## RULING 2 — `lose` NEVER TAKES MORE THAN THE PLAYER HOLDS
 *
 * `takeResources` clamps, and that is not negotiable, because the alternative is a
 * negative pool. So a player holding 3 Funds and no Media has donated what they could
 * and the card's own words are satisfied. **Therefore `remaining` is decremented by
 * what was ACTUALLY TAKEN, not by what the card asked for.** Decrementing by the ask
 * would make the only card that can clear the lock unplayable for anyone short of 4
 * resources of every type, which is a table-stalling bug wearing a card's clothes.
 *
 * THE SAFE DIRECTION IS DELIBERATE. Under-decrementing leaves the player locked, who
 * can donate again and eventually get to zero — annoying and recoverable.
 * Over-decrementing unlocks a purchase they have not paid for, which hands out a free
 * Voter Card. So the arithmetic rounds towards "still owed".
 *
 * ## RULING 3 — "OF EACH TYPE" IS A VECTOR, AND A DONATION SETTLES A WHOLE TYPE
 *
 * `Restriction.owedRes` carries the requirement per resource rather than as a total,
 * because a total sums away the very information the card's sentence turns on: four
 * Funds of one type is not one of each of the four. `held` is the pool BEFORE the
 * take, which is what the waiver is read against.
 *
 * Per resource `r` with `ask = owedRes[r]`:
 *  - `ask === 0` — nothing owed for it.
 *  - `taken[r] >= ask` — SETTLED. The donation carried it.
 *  - `held[r] === 0` — SETTLED BY WAIVER. `takeResources` clamps, so a player holding
 *    no Media can never give Media, and a lock that kept asking for it would be the
 *    undischargeable-ask shape this codebase has been bitten by twice. This is
 *    Ruling 2 read per resource instead of as a total.
 *  - otherwise — `ask - taken[r]` still owed, tracked per type so the NEXT donation
 *    knows which resource it has to bring.
 *
 * **THE DISCHARGEABILITY PROOF, and `held` is the whole of it.** The residue after
 * any donation is, per type, either 0 (covered or waived) or `ask - taken[r]` with
 * `0 < taken[r] < ask[r]`. With every per-type ask at most 1 — enforced by the corpus
 * validator and argued on `Effect.restrict.owedRes` — the third case is empty, so a
 * donation under a card that asks at least the owed amount of every resource type
 * discharges the WHOLE lock in one donation. **Every surviving residue is therefore a
 * resource the player demonstrably HOLDS**, which is the `capOverride` argument in a
 * different costume: the target state is REACHABLE rather than merely approached,
 * because the next card that donates that resource reaches it. KHAKI TERROR's own
 * reduction asks one of each, which is the whole ask, so **in the corpus the lock is
 * discharged in the resolution that imposes it and no `'no-purchases'` restriction is
 * ever reachable at all** — `packages/engine/test/restrictions.test.ts` checks that by
 * exhausting all 81 holding patterns rather than trusting this paragraph.
 *
 * Called from the `lose` case, because a donation IS a `lose` in this engine — the
 * Public Reserve is modelled as the absence of a resource, not as a pile.
 */
function creditDonation(
  state: GameState,
  id: PlayerID,
  taken: Delta,
  held: Pool,
): GameState {
  const player = state.players[id];
  if (!player) return state;
  if (deltaTotal(taken) <= 0) return state;
  let changed = false;
  const restrictions = (player.restrictions ?? []).map((r) => {
    if (r.kind !== 'no-purchases' || r.remaining <= 0) return r;
    if (r.owedRes === undefined) {
      // The legacy total. Still a *donation*-gated credit — the gate is at the call
      // site — but it cannot say "each type", which is the rest of C1.
      const next = Math.max(0, r.remaining - deltaTotal(taken));
      if (next === r.remaining) return r;
      changed = true;
      return { ...r, remaining: next };
    }
    const owedRes: Delta = {};
    let still = 0;
    for (const res of RESOURCES) {
      const ask = Math.max(0, r.owedRes[res] ?? 0);
      if (ask === 0) {
        owedRes[res] = 0;
        continue;
      }
      const gave = Math.max(0, taken[res] ?? 0);
      const left = gave >= ask ? 0 : (held[res] ?? 0) === 0 ? 0 : ask - gave;
      owedRes[res] = left;
      still += left;
    }
    if (still === r.remaining) return r;
    changed = true;
    return { ...r, owedRes, remaining: still };
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

/**
 * G15 — the reduced cap this player is being held to, or `undefined` when none is.
 *
 * A helper rather than `player.capOverride?.to` at each site, so the stacking `min` that
 * `set-cap` writes is also the value a reader sees, and so absent has exactly one meaning.
 * `expiresTurn` is deliberately NOT consulted here: this is a `PlayerState`, not a
 * `GameState`, so it cannot see the turn, and a second definition of the same deadline is
 * how a rule lives one turn too long in one place and not another. `expireCapOverrides`
 * is the only thing that retires it — the same arrangement as `Restriction.expiresTurn`
 * and `usesLeft`.
 */
function capOverrideOf(player: PlayerState): number | undefined {
  return player.capOverride === undefined ? undefined : Math.max(0, player.capOverride.to);
}

/**
 * G15 — retire a cap reduction whose deadline has passed, at the turn boundary.
 *
 * Runs on the same clock as `expireRestrictions` and the `powerUses` reset, and for the
 * same reason: expiry that is checked in two places is expiry that disagrees in two
 * places. Absent field means "no reduction", which is the printed state, so the removal
 * restores p12 exactly rather than setting anything.
 */
function expireCapOverrides(state: GameState): GameState {
  let s = state;
  for (const p of state.turnOrder) {
    const player = s.players[p];
    if (player?.capOverride === undefined) continue;
    const { expiresTurn } = player.capOverride;
    if (expiresTurn === null || expiresTurn > state.turn) continue;
    const { capOverride: _retired, ...rest } = player;
    s = { ...s, players: { ...s.players, [p]: rest as PlayerState } };
  }
  return s;
}


/**
 * G16 — resolve a `ZoneSelector` against the board, or `null` when it names nothing.
 *
 * ## THE THREE, AND WHY NONE OF THEM NEEDS A NEW `GameState` FIELD
 *
 *  - `'this-zone'` — the zone of the Volatile Area whose placement drew the Headline
 *    being resolved. `GameState.headlineQueue[0].areaId` already says so, so this is
 *    a READ of state that was written down rather than a value threaded down from
 *    `ACK_HEADLINE`. That is what keeps `reduce()` a pure function of
 *    `(state, action, ctx)`: a replay derives it without re-running the trigger.
 *    REF 4.1 is explicit that "this zone" means exactly this — *"'this zone' = the
 *    volatile zone that triggered it."*
 *  - `'your-strongest'` — the zone `actor` holds the most pegs in. Ties are broken by
 *    `ZONE_IDS` order, which makes it a pure function of the board rather than a
 *    "pick any of the tied ones" decision; the dropped tie-break is named on
 *    `ZoneSelector`'s refusal list rather than approximated.
 *  - `'chosen-zone'` — never resolved here. It is raised as a decision by
 *    `applyEffect` and arrives back as `forced`, so the value that reaches this
 *    function is already a `ZoneID`.
 *
 * **`null` MEANS "NO ZONE", AND IT FALLS BACK TO EVERY ZONE** — which is the
 * satisfiability decision, and it is the safe direction for the reason the rest of
 * this file argues it everywhere else: a selector that cannot be resolved must not
 * narrow the target set to nothing, because an empty target set is a decision with no
 * legal pick and this codebase has been bitten by that bug three times. A card that
 * says "in this zone" and finds no zone acts on the whole board, which is a card that
 * over-delivers; the alternative is a card that freezes a player, which is a dead
 * table.
 */
function resolveZone(
  state: GameState,
  actor: PlayerID,
  zone: ZoneSelector | undefined,
  forcedZone: ZoneID | null,
): ZoneID | null {
  if (forcedZone !== null) return forcedZone;
  if (zone === undefined || zone === 'chosen-zone') return null;
  if (zone === 'this-zone') {
    const areaId = state.headlineQueue[0]?.areaId;
    if (areaId === undefined || areaId === '') return null;
    return findArea(state, areaId)?.zone ?? null;
  }
  // 'your-strongest'
  let best: ZoneID | null = null;
  let bestN = 0;
  for (const id of ZONE_IDS) {
    const z = findZone(state, id);
    if (!z) continue;
    const n = pegsOf(z, actor);
    // `>` not `>=`, and ZONE_IDS is a fixed order, so the first zone to reach the
    // maximum wins — deterministic, and a replay reaches the same one.
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/**
 * G16 — the zones a `'choose-zone'` decision may offer: those holding at least one
 * peg this effect could actually name.
 *
 * ## WHY THE SET IS FILTERED BY WHAT THE EFFECT COULD NAME
 *
 * `resolveChoice` accepts a pick whose zone contains at least one legal peg, so a
 * zone that could not be picked must not be offered — otherwise the dialog would
 * carry a button the server refuses, which is the one outcome worse than not
 * offering the choice at all ("the player believes they have finished"). That is the
 * same reasoning `derive.ts:requiredPicks` implements on the client, and it is why
 * the count of legal zones is a function of the pegs rather than a constant nine.
 *
 * **It reads only PUBLIC state.** The board is nine fixed areas with every peg face
 * up; there is no hidden-pile read anywhere in this function, and that is the whole
 * reason a zone decision is safe to put on the wire at all.
 *
 * `scope` comes from `voterScope`, so it is the same rule the decision itself will
 * use — one expression, offered and validated.
 */
function legalZoneIds(
  state: GameState,
  source: PlayerID,
  effect: Effect,
): readonly ZoneID[] {
  const named = 'target' in effect ? effect.target : undefined;
  const scope = voterScope(source, source, voterKindOf(effect.op), named);
  const out: ZoneID[] = [];
  for (const id of ZONE_IDS) {
    const z = findZone(state, id);
    if (!z) continue;
    const has = z.areas.some(
      (a) =>
        a.peg !== null &&
        !a.volatile &&
        !(scope === 'own' && a.peg.owner !== source) &&
        !(scope === 'others' && a.peg.owner === source) &&
        !(effect.op === 'convert-voter' && a.peg.owner === source),
    );
    if (has) out.push(id);
  }
  return out;
}

/** The three ops that share `raiseVoterDecision` and the `zone` field. */
function voterKindOf(op: Effect['op']): 'evict-voter' | 'discard-voter' | 'convert-voter' {
  // `applyEffect` only ever reaches `legalZoneIds` with one of the three, because
  // `'zone' in effect` is the guard at every call site. The default is the loudest
  // available one rather than a silent `'own'`: a fourth op gaining `zone` without
  // gaining a case here fails its own test rather than quietly narrowing wrong.
  if (op === 'evict') return 'evict-voter';
  if (op === 'convert-voter') return 'convert-voter';
  return 'discard-voter';
}

/**
 * G1 — `move-peg`'s FIRST candidate set: the voters `owner` may have relocated.
 *
 * GREAT LEADER, BAD ECONOMY (REF 4.2.1): *"the player after you may move 1 of **your**
 * non-majority voters to an adjacent zone."* Four conditions, and each is the printed
 * word rather than a narrowing chosen for convenience:
 *
 *  - **the card's actor's** peg, because *"your"* is measured from the card and not
 *    from the answerer. The beneficiary moving a peg that is not theirs is the whole
 *    point of the card.
 *  - **not already a majority voter**, because a majority peg *is* the score (p20) and
 *    relocating one would move points rather than position.
 *  - **not in a Volatile Area**, because p18 makes a peg there permanent. This is a
 *    rules exclusion rather than an engine one and it is why the card silently cannot
 *    move such a peg — named on the card, not approximated.
 *  - and the peg must exist at all.
 *
 * **It reads only PUBLIC state.** Every peg on every area is face up on every payload,
 * so this is not a hidden-set read and it is not a §2bis question.
 */
function movablePegIds(state: GameState, owner: PlayerID): readonly AreaID[] {
  const out: AreaID[] = [];
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (a.peg === null || a.peg.owner !== owner) continue;
      if (a.peg.majority) continue;
      if (a.volatile) continue;
      out.push(a.id);
    }
  }
  return out;
}

/**
 * G1 — `move-peg`'s SECOND candidate set: where the peg in `areaId` may land.
 *
 * An **empty** area, in a zone **adjacent** to the peg's own. `Zone.neighbours` is on
 * the board already (`freshZones` copies it out of `BOARD`), so adjacency is a read and
 * not a new field — the same reason `'player-after'` needed no `GameState` change in
 * §3.1.
 *
 * **THE SAME ZONE IS REFUSED, and that is what "adjacent" means.** p16 lets a player
 * gerrymander a voter only to a constituency they hold rights in, but this is not a
 * gerrymander: nobody's rights are consulted, because the card gives the move away.
 * Within-zone relocation would be a no-op on the board's own terms (a peg lifted and put
 * back in the same constituency changes nothing), so refusing it also means the decision
 * can never offer a move that does nothing — which is the `played-but-no-op` verdict
 * `npm run playable` refuses to print.
 */
function pegDestinations(state: GameState, areaId: AreaID): readonly AreaID[] {
  const from = findArea(state, areaId);
  if (from === undefined) return [];
  const out: AreaID[] = [];
  for (const z of state.zones) {
    if (z.id === from.zone) continue;
    if (!areNeighbours(from.zone, z.id)) continue;
    for (const a of z.areas) if (a.peg === null) out.push(a.id);
  }
  return out;
}

/**
 * G1 — whether a `'choose-peg-dest'` decision is OFFERED at all, and why the answer is
 * a boolean rather than a decision with an empty pick space.
 *
 * **THE UNSATISFIABLE-CHOICE RULE, and it is the one this file has been bitten by four
 * times.** A pending decision freezes its owner: `blockedBy` refuses every other action
 * that player could take and `END_TURN` is refused while any decision is open, so a
 * decision with no acceptable answer is a dead TABLE with no server-side recovery. So a
 * card whose two candidate sets cannot both be non-empty raises NOTHING — which is the
 * honest reading, because "you may move one of your voters to an adjacent zone" is not
 * an instruction a player who has no such voter can carry out, and `'chosen-zone'`
 * already sets this precedent for an unresolvable selector.
 *
 * **AND BEING TRUE HERE IS NECESSARY BUT NOT SUFFICIENT, which is the whole of the
 * `'choose-peg-dest'` staleness defect.** This function is a statement about ONE state.
 * The decision it gates outlives that state: the board is public to every seat, so the
 * card's ACTOR — a different player from the frozen answerer — can act in the gap and
 * empty both sets. A raise-time guarantee is therefore NOT the invariant; the invariant
 * is that the decision is satisfiable in *every* state reachable while it is open. Two
 * things carry that, and this function is neither of them: the staleness gate in `reduce`
 * (the board cannot move), and the withdrawal in `resolveChoice` (an emptied offer closes
 * itself). `test/peg-dest-staleness.test.ts` asserts both, at 2/3/4/5 seats.
 *
 * `chooser` is accepted and deliberately UNUSED in the offer test, which is the point:
 * the offer depends only on the BOARD and on whose voter it is, never on who is being
 * asked. Filtering the offer by what the answerer holds is the leak `EffectTarget`'s
 * doc refuses for `'chosen-player'`, and it is the same mistake a narrower question
 * invites here. A player with nothing to move with is not offered a move; a player who
 * could move but chooses not to is not offered a "decline" flag, and that clause is
 * named on the card rather than invented here.
 */
function pegMoveOffered(state: GameState, owner: PlayerID, chooser: PlayerID): boolean {
  void chooser;
  return movablePegIds(state, owner).some((id) => pegDestinations(state, id).length > 0);
}

/** G1 — WITH DRAW EVERY RELOCATION WHOSE PICK SPACE HAS EMPTIED. See `reduce`. */
function withdrawStaleRelocations(s: GameState): GameState {
  const lapsed = s.choices.filter((c) => relocationLapsed(s, c));
  if (lapsed.length === 0) return s;
  const gone = new Set(lapsed.map((c) => c.id));
  let next: GameState = { ...s, choices: s.choices.filter((c) => !gone.has(c.id)) };
  for (const c of lapsed) {
    next = log(next, { player: c.player, text: 'The relocation lapses — nothing on the board is left to move.', kind: 'system' });
  }
  return next;
}

/**
 * G1 — HAS THIS RELOCATION GONE STALE? and the second half of the fix.
 *
 * ## WHY A RELOCATION CAN GO STALE AT ALL
 *
 * `pegMoveOffered` reads the BOARD, and the board is public to every seat, so the seat the
 * decision FREEZES (`blockedBy` freezes `PendingChoice.player`, the answerer) is not the
 * seat whose voter is on offer (`c.source`, the card's actor). GREAT LEADER, BAD ECONOMY
 * makes that a different player by design — *"the player after you may move 1 of YOUR
 * non-majority voters"* — and the consequence is that the actor, who is the active player
 * on their own turn, was free to keep acting: a second firing of the card's own trigger,
 * or simply a further influence that completed a majority and turned the only peg on offer
 * into the score (`board.ts`'s majority block). With both halves re-derived live at answer
 * time, the answerer was left frozen with an EMPTY pick space and `END_TURN` refused to
 * them too, while the actor's `END_TURN` still succeeded: a dead TABLE, reproduced with
 * legal actions at two seats.
 *
 * ## WHAT IS DONE ABOUT IT, and it is deliberately NOT a laxer `resolveChoice`
 *
 * `resolveChoice`'s two half-guards stay exactly as strict as they were. A stale pick is
 * still refused, in the same words, because a stale pick really is illegal: the printed
 * clause says **NON-MAJORITY** voters and the peg in the player's hand is now the score.
 * Accepting it, or accepting some other pair the player did not pick, would be the engine
 * choosing a move on the answerer's behalf.
 *
 * What changes is WHEN the offer dies. This predicate, read on every successful
 * resolution, **withdraws** a relocation whose pick space has emptied — the decision closes
 * itself, the board does not change, and the frozen seat is free. `'move-peg'`'s printed
 * verb is *"MAY move"*, so an offer with nothing left to offer is satisfied by not moving,
 * which is the same honest reading `applyEffect` takes when it raises NOTHING at all
 * (`pegMoveOffered`). The difference between the two is that raising nothing is decided at
 * raise time and this is decided the moment it becomes true, which is the entire point.
 *
 * **A REFUSAL HAS NO EXIT AND A WITHDRAWAL DOES**, and that is the whole ruling. Refusing
 * a stale pick is not "you cannot do that", it is "you cannot do anything, ever, again":
 * `blockedBy` refuses this player every action including `END_TURN`, the actor's
 * `END_TURN` still succeeds, and the table turns forever. This is the fifth instance of the
 * dead-table class in this engine.
 *
 * **THE RESIDUAL ROUTE IS ONE ACTION WIDE, and this predicate is why that is enough.**
 * `reduce`'s staleness gate refuses every action except the three that discharge a
 * decision, so between a raise and an answer the only thing that can move the board is an
 * action the gate lets through — chiefly another seat's `RESOLVE_CHOICE`, which must stay
 * permitted or a player frozen by p12 could never thaw. So the withdrawal is a POST-PASS on
 * every successful `reduce` result rather than something each action has to remember, and
 * it is therefore reachable from every route that can empty the pick space, including the
 * ones no gate enumerates. See `reduce`.
 */
function relocationLapsed(state: GameState, pending: PendingChoice): boolean {
  return pending.choice.kind === 'choose-peg-dest' && !pegMoveOffered(state, pending.choice.source, pending.player);
}

function applyEffect(
  state: GameState,
  source: PlayerID,
  effect: Effect,
  ctx: Ctx,
  fire: FireContext | undefined = NO_FIRE,
  cardId: CardID | null = null,
  /**
   * G1/G16 — the player or the constituency a `choose-player` / `choose-zone`
   * decision has already resolved to, or `null` when this is an ordinary resolution.
   *
   * **WHY THE DECISION IS RAISED HERE AND CARRIED, rather than inside an op's
   * `case`.** `'chosen-player'` and `'chosen-zone'` are `EffectTarget`s and
   * `ZoneSelector`s, i.e. *fields*, and a field is read by whoever needs it. Raising
   * the decision up here means one interception covers every op that can carry the
   * field, so `gain`, `voters`, `steal-any`, `restrict`, `discount` and the three
   * voter ops all get it without a single one of them growing a branch. When
   * `resolveChoice` re-runs the effect it passes the named player back in as
   * `forced`, which `resolveTargets` turns into `[forced]`.
   *
   * The effect list carried on the decision is the card's OWN effect, unchanged.
   * Termination does not need a counter: the re-run passes `forced` / `forcedZone`
   * back in, which short-circuits the two interceptions above, so the same decision
   * can never be raised twice. `TRIGGER_MAX_WAVES` does not cover this — it bounds
   * one FIRING EVENT, and this is a decision a player answers.
   */
  forced: PlayerID | null = null,
  forcedZone: ZoneID | null = null,
  /**
   * G17 — the card a `'choose-card'` decision has already resolved to, or `null` for
   * an ordinary resolution.
   *
   * **THIS IS THE WHOLE OF THE CASCADE BOUND, and it is the `'chosen-player'` /
   * `'chosen-zone'` argument verbatim.** `draw-conspiracy { pick: true }` raises a
   * decision and carries its own effect list, so `resolveChoice` re-runs that effect
   * with the named card handed back in here. The case then takes THAT card instead
   * of raising again, so one resolution can consume exactly as many cards as the
   * decision it answered named — and a pile of *n* is finite, so the chain is
   * `min(n, pile.length)` long whether or not anybody is trying to make it longer.
   *
   * It is a PARAMETER rather than a field on the effect because a card must not be
   * able to say "take THIS card": the choice is the player's, and a card that could
   * pre-commit one would make `pick` a lie.
   */
  forcedCard: CardID | null = null,
  /**
   * G4/G15 — the player `effect.read` has already resolved to, or `null`.
   *
   * **A SEPARATE PARAMETER FROM `forced`, and that is the whole mechanism.** `forced` is
   * who the payout LANDS ON and `forcedRead` is whose board the MULTIPLIER is read from;
   * THOUGHTS AND PRAYERS is exactly the card where they are different people — the caster
   * is paid, a named opponent is read. Folding them into one parameter would have made
   * the card pay the chosen opponent for their own pegs, which is what §3 warned would
   * happen and called "worse, not better".
   *
   * It is a parameter rather than state for the reason every other one here is: a replay
   * from seed + action log reproduces the answer without re-running the decision.
   */
  forcedRead: PlayerID | null = null,
): GameState {
  let s = state;
  const target = 'target' in effect ? (effect.target ?? 'you') : 'you';

  // G1. Raise rather than guess. `turnOrder.filter(p => p !== source)` IS the
  // candidate set `resolveChoice` validates against, so an empty candidate set raises
  // NOTHING and a non-empty one always has a legal answer. See `Choice`'s
  // `'choose-player'` note for the satisfiability proof and the visibility argument.
  if (target === 'chosen-player' && forced === null) {
    const candidates = s.turnOrder.filter((p) => p !== source);
    if (candidates.length === 0) return s;
    return pushChoice(
      s,
      {
        kind: 'choose-player',
        count: 1,
        effects: [effect],
        source,
        reason: 'Card effect',
      },
      source,
    );
  }

  // G4/G15. The READ half of THOUGHTS AND PRAYERS, and it is the same interception one
  // branch above with a different question: `read` names whose BOARD the multiplier is
  // read from while `target` keeps naming who is paid, so the two are independent. The
  // guard is the same expression `resolveChoice` validates against, so an empty candidate
  // set raises NOTHING and a non-empty one always has a legal answer.
  //
  // `target !== 'chosen-player'` matters: a card may not raise two decisions for one
  // effect, and if both fields asked the same question the second would be unreachable
  // because `resolveChoice` re-runs with BOTH forced, short-circuiting this branch too.
  if (
    'read' in effect &&
    effect.read === 'chosen-player' &&
    target !== 'chosen-player' &&
    forcedRead === null
  ) {
    const candidates = s.turnOrder.filter((p) => p !== source);
    if (candidates.length === 0) return s;
    return pushChoice(
      s,
      {
        kind: 'choose-player',
        count: 1,
        effects: [effect],
        source,
        reason: 'Card effect',
      },
      source,
    );
  }

  // G16. Same argument, same shape: the candidate set is the zones a decision over
  // this effect's own `target` could actually name, and a zone with nothing in it
  // cannot be a pick `resolveChoice` would accept, so it is not offered.
  if ('zone' in effect && effect.zone === 'chosen-zone' && forcedZone === null) {
    const candidates = legalZoneIds(s, source, effect);
    if (candidates.length === 0) return s;
    return pushChoice(
      s,
      {
        kind: 'choose-zone',
        count: 1,
        effects: [effect],
        source,
        reason: 'Card effect',
      },
      source,
    );
  }

  switch (effect.op) {
    case 'gain': {
      for (const p of resolveTargets(s, source, target, forced)) {
        s = enforceCap(addResources(s, p, resolveDelta(s, p, effect.res, effect.per, ctx)), p, ctx.rules);
      }
      return s;
    }
    case 'lose': {
      for (const p of resolveTargets(s, source, target, forced)) {
        // C1 — THE GATE. `p === source` is "this loss is the actor's own giving", which
        // is what a donation is; a `lose` aimed at anybody else is somebody else taking,
        // and must not touch a lock whose printed condition is "until you donate". See
        // the argument on `creditDonation` for why the gate lives here and not on the
        // imposing card's id.
        if (p !== source) {
          s = takeResources(s, p, resolveDelta(s, p, effect.res, effect.per, ctx))[0];
          continue;
        }
        // The `taken` Delta is what the engine ACTUALLY removed and `held` is the pool
        // before it, which is the whole of Ruling 2 and the waiver in Ruling 3.
        const before = s.players[p]?.resources;
        const [after, taken] = takeResources(
          s,
          p,
          resolveDelta(s, p, effect.res, effect.per, ctx),
        );
        s = creditDonation(after, p, taken, before ?? { funds: 0, clout: 0, media: 0, trust: 0 });
      }
      return s;
    }
    case 'gain-any': {
      for (const p of resolveTargets(s, source, target, forced)) {
        s = pushChoice(
          s,
          { kind: 'gain-any', count: resolveAsk(s, p, effect.n, effect.per, forcedRead, ctx), reason: 'Card effect' },
          p,
        );
      }
      return s;
    }
    case 'lose-any': {
      for (const p of resolveTargets(s, source, target, forced)) {
        const held = poolTotal(s.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 });
        const n = Math.min(resolveAsk(s, p, effect.n, effect.per, forcedRead, ctx), held);
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
      const named = target !== 'you' ? resolveTargets(s, source, target, forced) : [];
      if (forced !== null) {
        // G1: a `'chosen-player'` theft is "take N from the player you named", which
        // is the ONE case where the thief and the victim are different by
        // construction rather than by a guard. `from = forced` and `resolveChoice`
        // then refuses any other victim, so the named player cannot be redirected.
        if (forced === source) return s;
        return pushChoice(
          s,
          { kind: 'steal-any', count: resolveCount(s, source, effect.n, ctx), from: forced, reason: 'Card effect' },
          source,
        );
      }
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
      for (const p of resolveTargets(s, source, target, forced)) {
        s = grantVoters(s, p, resolveCount(s, p, effect.n, ctx), 'Card effect', false);
      }
      return s;
    }
    case 'evict':
      return raiseVoterDecision(s, source, 'evict-voter', effect.n, effect.target, effect.zone, forcedZone, ctx);
    case 'discard-voter':
      // G-new: the RAW field, not the defaulted one, so `discard-voter` with an
      // explicit `target: 'you'` can reach the caster's OWN pegs. See `voterScope`.
      return raiseVoterDecision(s, source, 'discard-voter', effect.n, effect.target, effect.zone, forcedZone, ctx);
    case 'convert-voter':
      return raiseVoterDecision(s, source, 'convert-voter', effect.n, effect.target, effect.zone, forcedZone, ctx);
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
      for (const p of resolveTargets(s, source, target, forced)) {
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
      // G17: `from: 'discard'` takes from the DISCARD pile rather than the top of the
      // draw pile. `discardTo` pushes onto the end of the pile and `draw` shifts off
      // the front, so "the top of the discard pile" is `length - 1` — and picking it
      // that way is deterministic, which a reshuffle would not be.
      //
      // THE THREE SHAPES THIS CASE HAS, and only one of them publishes anything:
      //
      //   no `pick`              take the top. Deterministic, silent, the shape every
      //                          shipped card has always had.
      //   `pick: true`           raise a `'choose-card'` naming the recycle list. The
      //                          ONLY enumerated set in the game, and U1's whole reason.
      //   `forcedCard`           the answer to such a decision, arriving here so the
      //                          re-run cannot raise again (the cascade bound).
      //
      // `to: 'discard'` is honoured only from the public pile — see the field's note in
      // `cards.ts` for why the draw-pile pairing is refused rather than merely unused.
      const fromDiscard = effect.from === 'discard';
      const toDiscard = effect.to === 'discard';
      if (toDiscard && !fromDiscard) {
        // Silent refusal. No log, no event, no state change — "this clause did not
        // fire" is not a thing a client can act on, and a message would describe the
        // draw pile. `to: 'discard'` therefore has exactly one legal source and a
        // corpus card cannot reach the other without the schema's own enum refusing.
        return s;
      }
      for (const p of resolveTargets(s, source, target, forced)) {
        // `onlyIfEmpty`, which is what makes AS CLEAR AS WATER expressible: a resolved
        // player who is already holding a Conspiracy Card is skipped and takes nothing.
        // The check is on the RECIPIENT, because a Conspiracy Card is bought and held
        // and its hand is hidden from every viewer including its owner, so this reads a
        // fact nobody at the table can see and nothing here discloses which players were
        // skipped. There is no log line and no event on this path, and that is
        // deliberate rather than forgotten: "p2 was given a card" would be a
        // disclosure about a hidden hand.
        const holder = s.players[p];
        if (effect.onlyIfEmpty === true && holder !== undefined && holder.conspiracies.length > 0) {
          continue;
        }
        const want = resolveCount(s, p, effect.n, ctx);
        if (effect.pick === true) {
          // G17's `pick`, and both of its refusals, in one place.
          //
          // REFUSED unless `from: 'discard'`, which is the only set every client already
          // holds in full. A decision's OPTION LIST is the disclosure (§2bis), so a
          // `pick` over `_conspiracyDraw` raises NOTHING rather than raising a dialog
          // whose buttons enumerate a hidden pile. And `forcedCard` short-circuits the
          // whole branch — that is the answer arriving back from `resolveChoice`, and it
          // is what stops one resolution from consuming the pile (the cascade bound, and
          // the `'chosen-player'` / `'chosen-zone'` argument verbatim).
          if (forcedCard === null) {
            if (!fromDiscard) return s;
            const pile = s._conspiracyDiscard;
            if (pile.length === 0) continue;
            // ONE DECISION PER CARD, and never more of them than the pile holds. That
            // second half is the satisfiability proof rather than a courtesy: the k-th
            // of these is answered when `pile.length - (k - 1)` cards remain, so the
            // last one is answered with exactly one card left and always has a legal
            // pick. An over-eager `n` therefore lengthens the chain and cannot strand
            // it — the same shape as `'chosen-zone'` raising nothing for an empty
            // candidate set, and U1's whole termination claim.
            for (let k = 0; k < Math.min(want, pile.length); k++) {
              s = pushChoice(
                s,
                {
                  kind: 'choose-card',
                  count: 1,
                  cards: [...pile],
                  effects: [effect],
                  source: p,
                  reason: 'Card effect',
                },
                p,
              );
            }
            continue;
          }
          // The named card, taken out of the recycle list by commitment rather than by
          // enumeration. `resolveChoice` validated it against the live pile; the `at <
          // 0` branch is the pile having emptied between raise and answer, where the
          // safe direction is the deterministic top — the same fallback `resolveZone`
          // uses rather than narrowing a decision's target set to nothing.
          const live = s._conspiracyDiscard;
          const at = live.indexOf(forcedCard);
          const taken = at < 0 ? live[live.length - 1] : live[at];
          if (taken === undefined) continue;
          s = {
            ...s,
            _conspiracyDiscard: at < 0 ? live.slice(0, -1) : [...live.slice(0, at), ...live.slice(at + 1)],
          };
          const player = s.players[p];
          if (player) s = withPlayer(s, p, { conspiracies: [...player.conspiracies, taken] });
          // The pile is PUBLIC, so taking a card OFF it is an event, not an absence. The
          // announcement names `taken` and NOT `forcedCard`, because `taken` is the card
          // that actually left — in the `at < 0` fallback those are two different cards and
          // announcing the requested one would misdescribe the pile.
          s = announcedPick(s, p, taken, ctx);
          continue;
        }
        for (let i = 0; i < want; i++) {
          const pile = fromDiscard ? s._conspiracyDiscard : s._conspiracyDraw;
          const id = fromDiscard ? pile[pile.length - 1] : pile[0];
          if (id === undefined) break;
          s = {
            ...s,
            _conspiracyDiscard: fromDiscard ? pile.slice(0, -1) : s._conspiracyDiscard,
            _conspiracyDraw: fromDiscard ? s._conspiracyDraw : pile.slice(1),
          };
          if (toDiscard) {
            // The recycle-loop exit. The card came OFF the public pile and goes back ON
            // it — same card, same end, byte-identical pile — so there is no departure
            // to announce and announcing one would put a `Picked` on the log for a card
            // that never left. The derivation is unaffected either way, which is what
            // makes this the one writer that can be silent.
            s = discardTo(s, 'conspiracy', id);
            continue;
          }
          const player = s.players[p];
          if (player) s = withPlayer(s, p, { conspiracies: [...player.conspiracies, id] });
          // `from: 'discard'` only. `from: 'draw'` takes a card nobody has played, and
          // announcing THAT by name would put an unplayed card on the public record — the
          // one thing `conspiracyRecycle` exists to avoid — so the line is gated on the
          // pile the card actually left.
          if (fromDiscard) s = announcedPick(s, p, id, ctx);
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
      for (const p of resolveTargets(s, source, target, forced)) {
        // C1 — "1 resource of EACH TYPE" is a per-resource requirement, and `owed`
        // alone is a total that sums the four types away. `owedRes` when present is
        // BOTH the ask and the initial remainder; `owed` stays the sum so `remaining`
        // remains the one predicate that means "cleared". The clamp is per resource
        // and not total, so a player holding no Media is not recorded as owing Media.
        const ask: Delta = {};
        let total = 0;
        if (effect.owedRes !== undefined) {
          for (const res of RESOURCES) {
            const n = Math.max(0, effect.owedRes[res] ?? 0);
            if (n === 0) continue;
            const held = s.players[p]?.resources[res] ?? 0;
            const clamped = Math.min(n, held);
            if (clamped > 0) ask[res] = clamped;
            total += clamped;
          }
          // Nothing owed of anything the player holds, so there is no lock to write.
          // Pushing a zero-`remaining` entry instead would leave an inert row on a
          // PUBLIC list, and `purchasesBlocked` would read it as clear while a client
          // rendering the list would still show a purchase ban. Not writing it is the
          // only version where the wire and the predicate agree.
          if (effect.kind === 'no-purchases' && total === 0) continue;
        }
        const remaining = effect.owedRes !== undefined ? total : effect.owed ?? 0;
        s = pushRestriction(s, p, source, {
          kind: effect.kind,
          value: effect.value,
          remaining,
          ...(effect.owedRes !== undefined ? { owedRes: ask } : {}),
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
      for (const p of resolveTargets(s, source, target, forced)) {
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

      // `from: 'revealed'` — THE PUBLIC HALF OF THE SAME OP. A revealed card has been
      // turned face up in front of the whole table, so taking one discloses nothing at
      // all; this is the *"a card the whole table can already see"* clause where
      // `'draw'` below is the *"the top of a pile nobody can see"* one, and neither
      // touches the half §2bis refuses. There is no `from` in this union that
      // enumerates a pile: one member each, taken by position.
      //
      // THE CARD LEAVES THE REVEALED SET, and that is not bookkeeping. The invariant on
      // `GameState.revealedCards` is that it holds what the table can currently SEE; a
      // card moved into a hidden hand is a card nobody can see any more, and leaving it
      // listed would publish its identity after it has been hidden again — the
      // `choose-card` refusal over `_ideologyDraw`, arriving by a different route. Read
      // through `revealedCardsOf`, so the take and the removal are one expression.
      //
      // STILL SILENT, on the `move-card` arm's own reasoning: no `log(...)`, no
      // `GameEvent`, for either `to`. The log is read the same way for every card, and a
      // line that appeared for face-up cards and not for draw-pile cards would itself
      // report which source was used.
      if (effect.from === 'revealed') {
        for (const p of resolveTargets(s, source, target, forced)) {
          for (let i = 0; i < n; i += 1) {
            const revealed = revealedCardsOf(s, p);
            const id = revealed[0];
            // An empty revealed list is a SAFE NO-OP, not a failure: a card can name a
            // take from a set that a previous clause, a target that resolved to nobody,
            // or a shorter pile left empty. Same shape as the draw path's `break`.
            if (id === undefined) break;
            if (effect.to === 'hand') {
              const player = s.players[p];
              if (!player) break;
              // Checked BEFORE the card leaves the revealed set, for the reason the
              // draw path checks it before the card leaves the pile: a refused take must
              // leave the world exactly as it was.
              if (ideologyHandOf(player).length >= IDEOLOGY_HAND_MAX) break;
              s = withPlayer(s, p, { ideologyCards: [...ideologyHandOf(player), id] });
            }
            // `to: 'destroy'` falls through to here and does nothing else, which is the
            // only way this op shrinks the Ideology card count — the same conservation
            // property the `'draw'` destroy branch below is the sole other exception to.
            s = { ...s, revealedCards: { ...s.revealedCards, [p]: revealed.slice(1) } };
          }
        }
        return s;
      }

      // `from: 'draw'` is the other of the two sources the type allows, and the
      // draw-pile one: a card in the Ideology DISCARD pile has been ANSWERED, which p13
      // makes face up under its owner's mat, so handing one to a player blind would
      // publish the answer they are about to give. See the `move-card` arm in cards.ts,
      // which is the long version of why, and which also explains why the drain in
      // `advanceTurn` taking a card INSTEAD OF a draw is what makes the deck count fall
      // by exactly one per turn.
      if (s._ideologyDraw.length === 0) return s;

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

      for (const p of resolveTargets(s, source, target, forced)) {
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
    case 'reveal': {
      // G-new. The whole contract is on `Effect`'s `reveal` arm in cards.ts and on
      // `GameState.revealedCards` in state.ts; what is left here is the three things
      // that arm asks this function to guarantee, and each is a branch rather than a
      // comment because a comment does not fail a test.
      const n = resolveCount(s, source, effect.n, ctx);
      if (n <= 0) return s;
      for (const p of resolveTargets(s, source, target, forced)) {
        for (let i = 0; i < n; i += 1) {
          // COMMIT FIRST. `pile[0]` is the end `draw()` takes from and the end
          // `move-card { from: 'draw' }` takes from, so the member is chosen by
          // POSITION and not by anything a client can observe, and the choice is made
          // before the write. There is no `pick` flag on this op because a search over
          // the pile is the other mechanism — the one §2bis refuses — and an `n` is a
          // bound, not a search.
          const pile = s[DRAW[effect.kind]];
          const id = pile[0];
          // A SHORT PILE REVEALS WHAT IT HAS, and this is the whole termination
          // argument: each pass removes one card from a shared pile that is finite and
          // monotonically shrinking, so the loop runs at most `pile.length` times per
          // resolved target and cannot append to a structure that grows on its own. A
          // partially-applied reveal is correct, not a bug — two reveals in one
          // resolution compete for the same pile, exactly as two `to: 'hand'` moves do.
          if (id === undefined) break;
          // MOVE, NEVER COPY. The card leaves the `_` pile in the same write that puts
          // it on the public list, so the deck count falls by exactly the number
          // revealed and no id is on two lists at once — which is the refusal that
          // keeps `to: 'discard'` off `_conspiracyDraw` from being reached by another
          // route. Written as two spreads so the pile write and the list write are one
          // expression each and neither can be dropped by accident.
          s = { ...s, [DRAW[effect.kind]]: pile.slice(1) };
          s = {
            ...s,
            revealedCards: { ...s.revealedCards, [p]: [...revealedCardsOf(s, p), id] },
          };
        }
      }
      // NO LOG LINE AND NO EVENT, on the `move-card` arm's own reasoning: the
      // publication here is the face-up card itself, the field is public and
      // unprefixed, and nothing about the REST of the pile has become knowable — which
      // is the tell, because `draw-conspiracy`'s `announcedPick` is LOUD for exactly the
      // opposite reason (it removes a NAMED card from a pile the table already holds).
      //
      // `_conspiracyDraw` is the one pile whose LENGTH is on the wire
      // (`conspiracyRemaining`), so a reveal off it re-syncs the two derived public
      // counters `syncConspiracyTop` owns — the same call `draw-conspiracy` ends with.
      // A stale count is a public field reporting a number the engine no longer
      // believes.
      return effect.kind === 'conspiracy' ? syncConspiracyTop(s, ctx) : s;
    }
    case 'borrow-power': {
      // G14a. DEEP THOUGHTS: *"Select an opponent and use all their Level 3 Ideologue
      // Powers this turn."*
      //
      // THE TYPE MAKES THIS ONE BRANCH AND NOT A CHOICE OF READINGS: `target` is a
      // required `'chosen-player'`, so the only way to arrive here is with `forced`
      // naming the donor the card's own actor picked. The guard is therefore about a
      // hand-built state rather than a card — but it is a branch rather than a comment
      // because a comment does not fail a test.
      if (target !== 'chosen-player') return s;
      const donor = forced;
      if (donor === null || donor === source) return s;
      // SILENT, and for a different reason than `move-card`. A borrow is PUBLIC: the
      // entry lands on the public `restrictions` list, every client already receives
      // that list whole, and `public-payload.test.ts` pins the field set to exactly
      // `{ liveEffects, restrictions }`. `fireTriggers` already logs a lasting effect
      // taking hold, and a log line here would be a second statement of a fact every
      // client can read for itself.
      //
      // THE WRITER IS THE CASTER and the `sourcePlayer` IS THE DONOR, which is the one
      // inverting field on `Restriction` — see `'borrowed-powers'` in state.ts. Reversed,
      // this is a card that lets the donor use the caster's own powers.
      return pushRestriction(s, source, donor, {
        kind: 'borrowed-powers',
        value: 0,
        remaining: 0,
        // The same absolute-turn arithmetic `restrict` uses, so `'this-turn'` means
        // "live through the turn the card resolved on" without a special case and a
        // replay reproduces it from the state. `durationExpiry` is the single
        // definition; `expireRestrictions` in `advanceTurn` is the only thing that
        // retires it.
        expiresTurn: durationExpiry(s, source, effect.until ?? 'this-turn'),
        sourceCardId: cardId ?? 'unknown',
      });
    }
    case 'set-cap': {
      // G15. THE BIG FREEZE: *"Reduce your resource cap to 10."* See the `set-cap` arm in
      // cards.ts for the full argument; the three rulings that live HERE are the ones that
      // have to be branches rather than comments, because a comment does not fail a test.
      //
      // 1. STACK TAKES THE MINIMUM, never the incoming value and never the printed cap as
      //    a floor. Two overlapping reductions then compose to the more restrictive of the
      //    two rather than fighting, and a `to` above the printed cap is a no-op.
      // 2. `until` is THIS RULE'S DEADLINE and is read here — which is why `isScoped`
      //    carves the op out. Installed as a hook it would re-impose the reduction on
      //    every event and never retire it.
      // 3. `enforceCap` RUNS IMMEDIATELY, in the same breath as the write. p12 reads
      //    "if at any time you cross your resource cap you must choose and discard any
      //    excess"; a reduction that waits for the next cap check is a card that reads as
      //    though it bites and does not. This is also the step that carries the whole
      //    deadlock argument: the ask it raises is `max(0, total - cap) <= total`, so it is
      //    always affordable and always dischargeable.
      for (const p of resolveTargets(s, source, target, forced)) {
        const player = s.players[p];
        if (!player) continue;
        const expiresTurn = durationExpiry(s, source, effect.until ?? 'rest-of-game');
        const current = capOverrideOf(player);
        s = withPlayer(s, p, {
          capOverride: {
            to: Math.min(current === undefined ? effect.to : Math.min(current, effect.to), ctx.rules.resourceCap),
            expiresTurn,
          },
        });
        s = enforceCap(s, p, ctx.rules);
      }
      return s;
    }

    case 'move-peg': {
      // G1 — GREAT LEADER, BAD ECONOMY. See the `move-peg` arm in cards.ts for why this
      // is an op rather than a `target` on `evict`, and `Choice`'s `'choose-peg-dest'`
      // arm for the visibility and satisfiability arguments. The three things that have
      // to be branches rather than comments, because a comment does not fail a test:
      //
      // 1. THE OFFER IS A BOOLEAN. `pegMoveOffered` is false whenever the board cannot
      //    satisfy both halves of the pick, and then this raises NOTHING rather than a
      //    decision whose pick space is empty. That is the unsatisfiable-choice rule the
      //    rest of this file argues everywhere else, and it is NECESSARY BUT NOT
      //    SUFFICIENT for this one kind: it is a claim about the board at raise time, and
      //    the board is public, so the staleness gate in `reduce` and the withdrawal in
      //    `resolveChoice` are what make the decision satisfiable in every state it can be
      //    open in. Neither of those two can be left out and this one cannot be trusted
      //    alone; see `pegMoveOffered`'s own docstring for the full statement.
      // 2. `scope` IS DESCRIPTIVE. `'own'` when the answerer IS the card's actor,
      //    `'others'` when they are a different seat — which is GREAT LEADER, whose
      //    answerer is `'player-after'` and whose voter is therefore NOT the answerer's.
      //    `resolveChoice` decides on `peg.owner === c.source`, one expression, and never
      //    on this field; publishing it is what lets a dialog describe the offer without
      //    naming the card's owner.
      // 3. `count` IS 1, ALWAYS, because the pick carries ONE (peg, destination) pair.
      //    A card asking for more would be offered fewer than it says, so `n` is READ
      //    here and a resolved ask below one raises nothing; the corpus validator is what
      //    refuses a `move-peg` whose `n` is not 1, so a shipped card cannot get here.
      for (const p of resolveTargets(s, source, target, forced)) {
        const wanted = resolveCount(s, p, effect.n, ctx);
        if (wanted < 1) continue;
        if (!pegMoveOffered(s, source, p)) continue;
        s = pushChoice(
          s,
          {
            kind: 'choose-peg-dest',
            count: 1,
            scope: p === source ? 'own' : 'others',
            source,
            reason: 'Card effect',
          },
          p,
        );
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
 *
 * **G14a adds a second op to the carve-out, and it is the same reason rather than a
 * new one.** `borrow-power` writes a RULE now and `until` is that rule's deadline, so
 * treating it as a hook's lifetime would install a live effect that does not happen now
 * and re-arms on every event — which is a card that reads as *"in your next turn"* and
 * acts on somebody else's turn boundary instead. The rule for the carve-out is a
 * property of the op, not a list of ops: **an op that writes a `Restriction` is never
 * scoped**, and there are exactly two of those.
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
  // G14a. `borrow-power` writes a `Restriction` too — see `'borrowed-powers'` in
  // state.ts for why it is one list rather than two — so it means the same thing by
  // `until` and gets the same answer. Asserted in borrowed-powers.test.ts.
  if (effect.op === 'borrow-power') return false;
  // G15. `set-cap` writes a rule the same way and means the same thing by `until`: the
  // cap is reduced NOW and simply stops being reduced at the deadline. Installed as a hook
  // it would (a) never reduce anything, because a scoped effect is not applied, and (b) if
  // it were, re-reduce on every event with no way to retire it, since a live effect's
  // expiry only stops it RE-APPENDING.
  if (effect.op === 'set-cap') return false;
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
  // G15: same boundary, same "expire first" ordering, and same reason — THE BIG FREEZE's
  // cap reduction is a rule on the resolver's own clock, not a standing effect, so it is
  // retired here rather than by a live effect's expiry (which would only stop it
  // RE-APPENDING and never lift the reduction already in force).
  s = expireCapOverrides(s);
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

/**
 * THE TURN BOUNDARY, plus the one thing it clears that nothing else does.
 *
 * `turnBoundary` is the body that used to be `advanceTurn` verbatim, and it is a
 * separate function for one reason: `revealedCards` is cleared HERE, on the RESULT, and
 * `turnBoundary` has THREE returns that are not its last one — both `endOfGame`
 * endings and R10's exhausted-Ideology ending all return from the middle. Clearing in
 * the body would mean remembering the write at four exits, and the exit somebody
 * forgets is a public field carrying a card nobody is looking at any more. Wrapping is
 * the `reduce` / `reduceStep` shape this file already uses for exactly that reason:
 * a post-pass over the returned state is a property of the RESULT rather than of any
 * one exit.
 *
 * ## WHY THE BOUNDARY IS WHERE A RESOLUTION ENDS
 *
 * The ruling on `GameState.revealedCards` in state.ts: EMPTY IN EVERY STATE OUTSIDE A
 * RESOLUTION. A card's resolution is not one action — it is everything from the play
 * until the next player's turn starts, because a resolution PAUSES: any effect can
 * raise a decision, and the state that pauses at one is a state the server keeps and
 * re-serves. A reveal placed before that decision has to still be there when the
 * decision is answered, or a card's own second clause (`'revealed-card'`) counts zero
 * and its third (`move-card { from: 'revealed' }`) takes nothing. So the set has to
 * outlive the action that raised it, and the turn boundary is the first instant at
 * which no clause of that resolution can still run.
 *
 * That is the same clock `tickLiveEffects`, `expireRestrictions` and
 * `expireCapOverrides` run on, and the same discipline: whatever a resolution was doing
 * on the way out, the next player inherits none of it. It is written HERE, after
 * `tickLiveEffects` rather than before it, so a hook that reveals on turn start is
 * cleared by the same boundary that fired it — a reveal whose whole lifetime is one
 * function is a card doing nothing, which is what such a card should do.
 *
 * ## WHY NOT IN `resolveChoice` OR `closeInterrupt`, where `interrupt` and `choices` go
 *
 * Both of those clear at the point of CLOSURE, and neither is this boundary: a decision
 * can be answered and the resolution carry straight on, and an interrupt window closes
 * mid-action with the turn boundary still ahead. Clearing here covers all three exits
 * at once and cannot be routed around.
 */
function advanceTurn(state: GameState, ctx: Ctx): Result {
  const r = turnBoundary(state, ctx);
  return r.ok ? { ...r, state: { ...r.state, revealedCards: {} } } : r;
}

function turnBoundary(state: GameState, ctx: Ctx): Result {
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

/**
 * G1 — THE REDUCER, and it is a thin wrapper around `reduceStep` for one reason.
 *
 * `reduceStep` is the whole rules engine and it has never been wrapped before, so the
 * reason is stated rather than assumed: **every successful action withdraws a relocation
 * whose offer has gone stale**, and that is a property of the RESULT rather than of any
 * one action. Doing it per-action would mean remembering it in `PLAY_CONSPIRACY`, in
 * `INFLUENCE`, in `END_TURN`, in `ACK_HEADLINE`, in all nine `POWER_*` arms and in
 * `resolveChoice` — nine places to forget one, and the forgetting is a dead table.
 *
 * ## WHY IT IS NOT THE FIRST THING THE ENGINE DOES
 *
 * It is a POST-PASS on the returned state, which is what makes it sound rather than
 * clever: the board it reads is the board the action actually produced, so a relocation is
 * withdrawn at the first instant its pick space is empty and not one instant earlier. A
 * check placed before the action would be a check about the wrong board.
 *
 * ## WHY IT IS STILL A PURE FUNCTION OF `(state, action, ctx)`
 *
 * It reads only the state it is handed, writes only that state, and reads no clock and no
 * module scope — `withdrawStaleRelocations` is three lines over `relocationLapsed`, which
 * is `pegMoveOffered` over the live board. So `(seed, actionLog)` replay still reproduces
 * every intermediate state, which `packages/engine/test/rng.test.ts` proves exhaustively
 * and which would fail loudly here if a log line were stamped from anywhere but
 * `state.turn`.
 *
 * ## WHAT IT DOES NOT DO
 *
 * It does not touch a refusal. `resolveChoice`'s two half-guards are unchanged, so a stale
 * PICK is still refused in the same words — the printed clause says *non-majority* voters
 * and that peg is now the score, and the engine does not pick a different move on the
 * answerer's behalf. `packages/server`'s `peg-dest-boundary.test.ts` pins the wire against
 * exactly that and is unaffected by this pass.
 */
export function reduce(state: GameState, playerId: PlayerID, action: Action, ctx: Ctx): Result {
  const r = reduceStep(state, playerId, action, ctx);
  return r.ok ? { ...r, state: withdrawStaleRelocations(r.state) } : r;
}

/** The rules engine proper. `reduce` is this plus the staleness post-pass above. */
function reduceStep(state: GameState, playerId: PlayerID, action: Action, ctx: Ctx): Result {
  const { rules, cards } = ctx;
  if (state.finished) return fail('the game is over');

  const self = state.players[playerId];
  if (!self) return fail(`unknown player ${playerId}`);

  // G14a. The manifests this player may currently count for a BORROWED Level 3 power.
  // Computed once, here, because `state` is never reassigned inside the switch below —
  // every case returns a new state rather than mutating this binding — so this cannot
  // go stale between reading it and a `usesLeft` call in any of the nine `POWER_*`
  // cases. `state.players[playerId]!.manifesto` is public (p13: an answered card is face
  // up under its owner's mat), so this reads nothing hidden and adds no `_` field.
  const donors = borrowedFrom(state, playerId);

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

  // G1 — THE STALENESS GATE, and it is the fifth instance of one class in this file.
  //
  // `blockedBy` freezes the seat that OWNS a pending decision. That is enough for every
  // kind whose candidate set is read from the answerer's own mat or pool, because the
  // board cannot move under them. `'choose-peg-dest'` is the ONE kind whose candidate
  // sets are read from the BOARD, and the board is public to everybody — so the actor,
  // who is a DIFFERENT seat from the answerer, could keep acting: another
  // `on-voter-influenced` firing of GREAT LEADER's own trigger, or simply a further
  // influence that completes a majority and turns the card's only peg into the score
  // (`board.ts`'s `recount`). `pegMoveOffered` guarantees a legal pair AT RAISE TIME, and
  // that guarantee does not survive the gap. With both halves re-derived live at answer
  // time — which is the correct behaviour, because "your NON-MAJORITY voters" is a
  // property of the card as ANSWERED — the answerer is left frozen with an empty pick
  // space, and `END_TURN` is refused to them by the same `blockedBy`. That is a dead
  // TABLE, not a stuck dialog: the actor's `END_TURN` still succeeds, the turn rotates
  // forever, and the answerer never plays again.
  //
  // ## THE INVARIANT, stated once, because four other files restate it
  //
  // **A pending decision must be satisfiable in EVERY state reachable while it is open —
  // not merely in the state it was raised in.** `state.ts`'s capOverride ruling
  // (`state.ts:323-340`) states it for `lose-any`, whose ask is clamped DOWN to what the
  // chooser holds when they answer; `Choice`'s `'choose-player'` arm states it for a
  // candidate set that is literally `turnOrder` minus the actor. This is the case where
  // the naive reading of the invariant — "guarantee a pick at raise time and re-validate
  // at answer time, and the offer is safe because the answerer holds something" — DOES
  // NOT HOLD, because the answerer holds nothing: the peg belongs to somebody else.
  //
  // ## WHAT IS DONE ABOUT IT, in two independent layers
  //
  //  1. **This gate, so the offer does not go stale in the first place.** While any
  //     `'choose-peg-dest'` is open AND still has a legal pair, EVERY action is refused
  //     except the three that discharge one: `RESOLVE_CHOICE`, and the two
  //     interrupt-window moves (which are the window's own escape and are already the only
  //     actions a window admits). The board therefore cannot move between the raise and the
  //     answer for any reason short of another `RESOLVE_CHOICE`, so the pair the dialog
  //     showed is the pair the resolver will accept.
  //  2. **THE WITHDRAWAL IN `resolveChoice`, because layer 1 alone is not a proof.** Two
  //     decisions can be open at once, and `RESOLVE_CHOICE` is exempt from this gate — it
  //     must be, or a player frozen by p12 could never thaw. So an `evict-voter` or
  //     `convert-voter` belonging to a THIRD seat can still be answered while the
  //     relocation is open, and answering it can lift or re-own the very peg the
  //     relocation needs. `resolveChoice`'s `drop` therefore WITHDRAWS a
  //     `'choose-peg-dest'` whose pick space has emptied, which frees the frozen seat
  //     without moving anything. `relocationLapsed` carries the whole argument, and the
  //     resolver's own half-guards are untouched: a stale PICK is still refused, because
  //     the printed clause says **non-majority** voters and that peg is now the score.
  //
  // ## WHY THE GATE IS CONDITIONED ON THE OFFER STILL BEING LIVE, and this is load-bearing
  //
  // A gate that fired on a STALE relocation would be the deadlock it was written to end: the
  // offer can only go stale through a `RESOLVE_CHOICE`, so in a stale state the only action
  // that could withdraw it is the one that made it stale — which has already happened — and
  // the gate would then freeze that state in place forever. So this reads `relocationLapsed`
  // and LIFTS the moment the offer dies: the actor can act again, any successful action
  // withdraws the stale offer, and the answerer is freed. A table always has a legal move —
  // the active player can always answer their Ideology Card or end their turn — so a stale
  // offer can never be the last thing standing.
  //
  // The printed clause is *"the player after you MAY move 1 of your non-majority voters"*.
  // `MAY` is optionality, so an offer that has nothing to offer is satisfied by not moving,
  // and it is satisfied by a move in every other state. There is no reading on which
  // withdrawing it is a wrong outcome and there is one on which refusing forever is: the
  // refusal has no exit.
  //
  // **PLACED AFTER `blockedBy`, not before**, so the seat that actually OWNS the decision
  // is still told to resolve its own, which is the more useful of the two messages and the
  // one `packages/client`'s refusal-string assertions are ordered against.
  if (
    state.choices.some((c) => c.choice.kind === 'choose-peg-dest' && !relocationLapsed(state, c)) &&
    action.type !== 'RESOLVE_CHOICE' &&
    action.type !== 'RESPOND_INTERRUPT' &&
    action.type !== 'PASS_INTERRUPT'
  ) {
    return fail('a voter relocation is being answered — resolve it first');
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
      // G18. BRAVE NEW WORLDS: *"Players will not receive any resources (active &
      // passive) for doing so."* Both halves are suppressed at ONE point, which is why
      // it is one edit and not two — p13's payout and p28's passive bonus are credited
      // together here, so a second consult point could drift from this one and give a
      // player the bonus while withholding the answer's resources.
      //
      // **SUPPRESSED, NEVER REFUSED.** The answer still succeeds, still joins
      // `manifesto` / `manifestoCards` and still recycles the card. A restriction that
      // made the answer *illegal* would be a lock with no escape — the card cannot be
      // un-drawn — and zero is the safe direction: the deck keeps falling by exactly
      // one per turn either way.
      if (incomeBlocked(s, playerId)) {
        s = log(s, { player: playerId, text: 'No resources for this answer.', kind: 'system' });
      } else {
        // p13: receive the answer's resources…
        s = addResources(s, playerId, side.pays);
        // …p28: …plus the passive bonus, counting the card just added.
        const after = s.players[playerId];
        if (after) s = addResources(s, playerId, passiveBonus(after, rules));
      }
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
      if (discounts.length > usesLeft(self, rules, 'helping-hands', donors)) {
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
        if (usesLeft(self, rules, 'going-viral', donors) <= 0) return fail('Going Viral is spent for this turn');
        voters += 1;
      }

      // G14b. THE GRETA EFFECT: *"They will get 1 less voter on the next 2 Voter Cards
      // that they influence."* Subtracted AFTER Going Viral, and that ordering is the
      // ruling rather than an accident — see `'voter-shortfall'` in state.ts. FLOORED AT
      // ZERO and it never refuses the purchase: a 1-Voter Card under a 2-voter shortfall
      // yields nothing, and a restriction that made the influence ILLEGAL would be a
      // table-stalling lock, because a Voter Card that has been bought cannot be unbought.
      const shortfall = voterShortfall(state, playerId);
      if (shortfall > 0) voters = Math.max(0, voters - shortfall);

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
      // G14b, the counter. One card's worth consumed per INFLUENCE, whether or not the
      // shortfall shortened anything — the printed clause counts CARDS ("the next 2
      // Voter Cards that they influence"), not voters. A spent entry is REMOVED rather
      // than left at zero, the same rule `creditDonation` follows.
      s = spendVoterShortfall(s, playerId);
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
      if (discounts.length > usesLeft(self, rules, 'helping-hands', donors)) {
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
      if (usesLeft(self, rules, 'prospecting', donors) <= 0) return fail('Prospecting is not available');
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
      if (usesLeft(self, rules, 'land-grab', donors) <= 0) return fail('Land Grab is spent for this turn');
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
      if (usesLeft(self, rules, 'donations', donors) <= 0) return fail('Donations is spent for this turn');
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
      if (usesLeft(self, rules, 'payback', donors) <= 0) return fail('Payback is spent for this turn');
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
      if (usesLeft(self, rules, 'tough-love', donors) <= 0) return fail('Tough Love is spent for this turn');
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
      if (discounts.length > usesLeft(self, rules, 'helping-hands', donors)) {
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

      // G16 — THE SLICE IS DELIBERATELY AFTER `resolveCard`, and that ordering is load-
      // bearing rather than cosmetic. `'this-zone'` resolves by reading
      // `headlineQueue[0].areaId`, because the zone a Headline came from is the Volatile
      // Area whose placement drew it and that is already written down. Slicing first
      // made the head the NEXT Headline's placement, so NERO'S GUESTS silently fell
      // back to the whole board -- a card that reads as though it is zone-scoped and is
      // not. `packages/cards/test/recovered-cards.test.ts` caught it the moment a
      // fixture arranged a real placement, which is exactly what a fixture is for.
      //
      // Nothing else depends on the order: the effects, the discard and the log all read
      // or write fields this slice does not touch, and the interrupt window `resolveCard`
      // may open is carried on by the spread below.
      let s: GameState = state;
      s = resolveCard(s, source, card, 'headline', ctx);
      s = { ...s, headlineQueue: s.headlineQueue.slice(1) };
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

  /**
   * G1 — DROP THE DECISION BEING ANSWERED, AND ANY RELOCATION THAT HAS GONE STALE.
   *
   * The second clause is the whole of the second layer of the staleness fix and it runs on
   * every successful arm of this switch exactly once, because `RESOLVE_CHOICE` is the only
   * action the staleness gate lets through that can move the board (see
   * `relocationLapsed`). A relocation whose pick space has emptied WITHDRAWS: the frozen
   * seat is freed, nothing moves, and the log says so in public words rather than leaving
   * a dialog open on a card that can never be answered.
   */
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
      const wanted = Math.min(c.count, targetableCount(state, playerId, c.kind, c.scope, c.zoneId));
      if (pick.areaIds.length !== wanted) return fail(`choose exactly ${wanted}`);
      if (new Set(pick.areaIds).size !== pick.areaIds.length) return fail('duplicate area');

      let s = state;
      const events: GameEvent[] = [];
      for (const id of pick.areaIds) {
        const area = findArea(s, id);
        if (!area?.peg) return fail('there is no voter there');
        if (area.volatile) return fail('voters in a Volatile Area cannot be affected');
        // G16. The zone is the CARD's, checked the same way the scope is: it says
        // which voters the ask reaches, and it is resolved before the decision
        // existed, so a pick cannot redirect it into another constituency.
        if (c.zoneId !== undefined && area.zone !== c.zoneId) return fail('that voter is in another zone');
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

    /**
     * G1 — the card's actor named a player, and the effect runs against them.
     *
     * ## WHY THE VALIDATION IS `turnOrder.filter(p => p !== source)` AND NOTHING ELSE
     *
     * It is the SAME expression `applyEffect` built the candidate set from, which is
     * the whole satisfiability argument: the options offered and the picks accepted
     * are one list, so there is no state in which this decision has no legal answer.
     * A two-seat game has exactly one candidate. An unknown id is refused rather than
     * ignored, so a stale client cannot aim a card at a seat that has left.
     *
     * **`source` is the CHOOSER and is checked first.** A pick answered by anybody else
     * is refused outright, which is the G21 self-target guard in its most direct
     * form: a `choose-player` decided by the named player could aim a card's effect at
     * them without the card's actor ever consenting, and since the actor is the only
     * player with standing to name somebody, that is a redirect nobody authorised.
     *
     * **`applyEffect` is called directly, not `applyEffects`**, for the reason
     * `fireTriggers` does it: the carried effect came off a card that is already
     * resolved, so re-installing its `when` / `until` would re-arm it a second time.
     * One pass, no cascade, and `TRIGGER_MAX_WAVES` is not what bounds it — the
     * decision can only be answered once because `drop` removes it in the same breath.
     */
    case 'choose-player': {
      if (pick.kind !== 'player') return fail('choose a player');
      if (playerId !== c.source) return fail('that decision is not yours');
      const chosen = state.turnOrder.filter((p) => p !== c.source);
      if (!chosen.includes(pick.id)) return fail('you may not choose that player');
      let s = drop(state);
      // **WHICH SLOT the named player goes in is decided here, from the effect itself**,
      // and it is the whole of G4's read-vs-target split arriving in one place.
      //
      //  - the effect's `target` asked the question → the named player is the RECIPIENT,
      //    and `forced` is where they go. That is every card that used `'chosen-player'`
      //    before G4, and it is byte-identical for them.
      //  - the effect's `read` asked it → the named player is the READER, `forcedRead` is
      //    where they go, and `forced` stays null so `target` still decides who is PAID.
      //    THOUGHTS AND PRAYERS is this case: the caster is paid, the chosen opponent's
      //    Volatile-Area pegs are counted.
      //
      // Putting the named player in `forced` unconditionally would be the bug §3 warned
      // about by name: *"aiming the card at a chosen player would pay the chosen player for
      // their own volatile voters."* It pays the WRONG PERSON the RIGHT AMOUNT, which is
      // the hardest kind of card bug to notice and the reason the decision is here.
      for (const effect of c.effects) {
        const askedByTarget = 'target' in effect && effect.target === 'chosen-player';
        s = applyEffect(
          s,
          c.source,
          effect,
          ctx,
          NO_FIRE,
          null,
          askedByTarget ? pick.id : null,
          null,
          null,
          askedByTarget ? null : pick.id,
        );
      }
      return { ok: true, state: s, events: [] };
    }

    /**
     * G16 — the card's actor named a constituency, and the effect runs inside it.
     *
     * **THE VALIDATION IS `legalZoneIds`, WHICH IS WHAT THE CANDIDATE SET WAS.** Same
     * one-expression argument as `'choose-player'`, and it is why a zone with nothing
     * legal in it was never offered: offering it would give a button the server
     * refuses, which is the outcome the engine has spent this whole file refusing to
     * produce.
     *
     * **THE RE-RUN CAN RAISE A NEW DECISION, AND THAT IS CORRECT.** A card that names
     * a zone AND an opponent raises a `'choose-player'` for the opponent inside the
     * chosen zone, and a card with two such effects raises two in turn — each one
     * dropped before the next is applied, so the cascade is bounded by the card's own
     * effect list length rather than by anything in the state. Termination is a
     * property of the CARD here, exactly as it is for any effect list, and no cycle is
     * reachable because an effect cannot name itself.
     */
    case 'choose-zone': {
      if (pick.kind !== 'zone') return fail('choose a zone');
      if (playerId !== c.source) return fail('that decision is not yours');
      const effect = c.effects[0];
      if (!effect || !('zone' in effect)) return fail('that decision names no zone');
      const legal = legalZoneIds(state, c.source, effect);
      if (!legal.includes(pick.zoneId)) return fail('you may not choose that constituency');
      let s = drop(state);
      for (const e of c.effects) s = applyEffect(s, c.source, e, ctx, NO_FIRE, null, null, pick.zoneId);
      return { ok: true, state: s, events: [] };
    }

    /**
     * G17 — the card's RECIPIENT named a card from the recycle list.
     *
     * ## THE VALIDATION IS THE LIVE PILE, AND THE OFFER WAS A COPY OF IT
     *
     * `c.cards` is `_conspiracyDiscard` copied at raise time and this reads
     * `_conspiracyDiscard` again. Between the two the pile can only GROW — `PLAY_CONSPIRACY`
     * appends the card it just played, in the same breath as the `Played "NAME"` line
     * that makes it public — so the accepted set is a SUPERSET of the offered one, which
     * is the safe direction: a client that shows a stale list has a dead button, and a
     * dead button the server refuses is the one outcome worse than showing nothing.
     * `applyEffect` raised at most `pile.length` decisions, so the k-th is answered with
     * at least one card on the pile and **no state can strand this**.
     *
     * **`source` IS THE CHOOSER, and it is checked first.** The same reasoning as
     * `'choose-player'`: a `'choose-card'` answered by anybody else is a card's
     * recipient choosing for the card's actor, and the actor is the only player with
     * standing to say who receives anything.
     *
     * **THE RE-RUN CANNOT RAISE AGAIN**, because `forcedCard` short-circuits the
     * `pick` branch in `applyEffect` — the `'chosen-player'` argument again, and the
     * bound that makes a cascade a property of the pile rather than of the state.
     * `TRIGGER_MAX_WAVES` covers neither this nor `'choose-player'`: it bounds one
     * FIRING EVENT, and this is a decision a player answers once.
     */
    case 'choose-card': {
      if (pick.kind !== 'card') return fail('choose a card');
      if (playerId !== c.source) return fail('that decision is not yours');
      let s = drop(state);
      for (const effect of c.effects) {
        s = applyEffect(s, c.source, effect, ctx, NO_FIRE, null, c.source, null, pick.cardId);
      }
      return { ok: true, state: s, events: [] };
    }

    /**
     * G1 — the answerer named ONE of the card's actor's voters AND where it goes.
     *
* ## THE VALIDATION IS THE BOARD AS IT STANDS, and both halves are re-derived here
     *
     * `movablePegIds(state, c.source)` and `pegDestinations(state, pick.areaId)` are the
     * same two expressions `applyEffect` offered from, re-read at ANSWER time. That is the
     * `lose-any` clamp argument (`choices.test.ts`'s header: *the pool is not frozen
     * while the decision is open*) applied to the board: between the raise and the
     * answer a majority can form, a peg can be gerrymandered away, and a destination
     * area can be filled — so the pick the dialog was showing can become illegal.
     *
     * **RE-DERIVING IS RIGHT AND THE OLD DOCSTRING'S INFERENCE WAS NOT.** An earlier
     * version of this comment argued that refusing a stale pick "is safe precisely
     * because `pegMoveOffered` guaranteed at raise time that at least one legal pair
     * existed, and every one of this function's guards is checked against a live board,
     * so a player holding a stale dialog still has a legal pick to make". **That
     * inference does not hold, and the gap is the answerer's own holdings.** For
     * `lose-any` the pool the decision reads IS the pool the answerer holds and cannot
     * spend while frozen, so a guard that fails has shrunk the ask rather than emptied
     * it. Here the candidate sets are the BOARD, and the board is public to every seat:
     * `pegMoveOffered` was computed over `c.source`'s pegs, the card's actor, who is a
     * DIFFERENT player from the one this branch freezes. GREAT LEADER, BAD ECONOMY makes
     * that difference the whole point of the card, and it is exactly what let the actor
     * complete a majority between the raise and the answer and leave the answerer with an
     * empty pick space and a permanent refusal — a dead table, reproduced with legal
     * actions at two seats. So the guarantee is now made twice over and in neither place
     * by an inference about what the offerer still holds:
     *
     *  - `reduce`'s staleness gate refuses every action except the three that discharge a
     *    decision while a LIVE `'choose-peg-dest'` is open, so the documented route into a
     *    stale board does not exist; and
     *  - **`relocationLapsed`, which is the actual guarantee.** It is not an optimisation
     *    and it is not a fallback: it is what makes this kind satisfiable in EVERY state
     *    reachable while it is open, including the one no gate can reach — a second
     *    decision belonging to a third seat, which `RESOLVE_CHOICE` is deliberately exempt
     *    from the gate so that a player frozen by p12 can thaw. A relocation whose pick
     *    space has emptied is WITHDRAWN by `drop`, so the frozen seat is freed and no pick
     *    is ever accepted that the printed "non-majority voters" clause forbids.
     *
     * **THE PICK SPACE OF A WITHDRAWN OFFER IS EMPTY AND THAT IS NOT A BUG.** The player
     * never sees a legal move, because the moment one does not exist the dialog closes
     * itself. A refusal would have left them looking at a button that cannot work, and
     * `blockedBy` would have kept refusing them everything including `END_TURN` — which is
     * the dead table this whole change exists to end.
     *
     * `playerId !== pending.player` is the G21 self-redirect guard**, and it is
     * checked FIRST: a beneficiary who could answer somebody else's relocation would be
     * moving a voter the card's owner never offered them. `c.source` names the card's
     * ACTOR, which is why it is a different field from the answerer — that is what makes
     * `'others'` mean anything at all.
     *
     * **THE MOVE ITSELF IS TWO `setArea` CALLS**, so both constituencies are recounted
     * and both raise `on-majority-formed` for free, and a peg landing in a Volatile Area
     * draws its Headline attributed to the peg's OWNER — the same attribution rule
     * `setArea` already documents (D6).
     */
    case 'choose-peg-dest': {
      if (pick.kind !== 'peg-dest') return fail('choose a voter and where it goes');
      if (playerId !== pending.player) return fail('that decision is not yours');
      if (!movablePegIds(state, c.source).includes(pick.areaId)) {
        return fail('that voter may not be moved');
      }
      if (!pegDestinations(state, pick.areaId).includes(pick.toAreaId)) {
        return fail('that is not an empty area in an adjacent zone');
      }
      const from = findArea(state, pick.areaId);
      if (from === undefined || from.peg === null) return fail('there is no voter there');
      const owner = from.peg.owner;
      let s = setArea(state, { ...from, peg: null }, ctx).state;
      const to = findArea(s, pick.toAreaId);
      if (to === undefined || to.peg !== null) return fail('that area is taken');
      const moved = setArea(s, { ...to, peg: { owner, majority: false } }, ctx);
      s = log(moved.state, { player: playerId, text: `${owner} moves a voter.`, kind: 'card' });
      // The event is `gerrymandered` because it IS one in the only sense the engine has:
      // a voter went from area A to area B. `player` is the MOVER, matching `GERRYMANDER`,
      // and `majority-formed` / `majority-broken` for both constituencies ride in
      // `moved.events`, so a client sees the board change in the same breath.
      return {
        ok: true,
        state: drop(s),
        events: [
          ...moved.events,
          { type: 'gerrymandered', player: playerId, from: pick.areaId, to: pick.toAreaId },
        ],
      };
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
function targetableCount(
  state: GameState,
  playerId: PlayerID,
  kind: string,
  scope: ChoiceScope,
  zoneId?: ZoneID,
): number {
  // G16. `zoneId` is the RESOLVED constituency, or absent for the whole board — and
  // it is absent for the whole board whenever the selector resolved to nothing, which
  // is the safe direction `resolveZone` argues: a selector that cannot be resolved
  // must not narrow the target set to nothing.
  let n = 0;
  for (const z of state.zones) {
    if (zoneId !== undefined && z.id !== zoneId) continue;
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
