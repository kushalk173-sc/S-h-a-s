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
import type { CardIndex, Effect, EffectTarget } from './cards';
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
  pegsOf,
  poolTotal,
  type Area,
  type CardID,
  type Delta,
  type GameState,
  type LogEntry,
  type PendingChoice,
  type PlayerID,
  type PlayerState,
  type Pool,
  type Resource,
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

/** Write an area back and recount its zone, emitting majority events. */
function setArea(state: GameState, area: Area): BoardEdit {
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
  return {
    state: { ...state, zones: state.zones.map((z) => (z.id === updated.id ? updated : z)) },
    events,
  };
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

function applyEffect(state: GameState, source: PlayerID, effect: Effect, ctx: Ctx): GameState {
  let s = state;
  const target = 'target' in effect ? (effect.target ?? 'you') : 'you';

  switch (effect.op) {
    case 'gain': {
      for (const p of resolveTargets(s, source, target)) {
        s = enforceCap(addResources(s, p, effect.res), p, ctx.rules);
      }
      return s;
    }
    case 'lose': {
      for (const p of resolveTargets(s, source, target)) {
        [s] = takeResources(s, p, effect.res);
      }
      return s;
    }
    case 'gain-any': {
      for (const p of resolveTargets(s, source, target)) {
        s = pushChoice(s, { kind: 'gain-any', count: effect.n, reason: 'Card effect' }, p);
      }
      return s;
    }
    case 'lose-any': {
      for (const p of resolveTargets(s, source, target)) {
        const held = poolTotal(s.players[p]?.resources ?? { funds: 0, clout: 0, media: 0, trust: 0 });
        const n = Math.min(effect.n, held);
        if (n > 0) s = pushChoice(s, { kind: 'lose-any', count: n, reason: 'Card effect' }, p);
      }
      return s;
    }
    case 'steal-any':
      return pushChoice(s, { kind: 'steal-any', count: effect.n, from: null, reason: 'Card effect' }, source);
    case 'voters': {
      for (const p of resolveTargets(s, source, target)) {
        s = grantVoters(s, p, effect.n, 'Card effect', false);
      }
      return s;
    }
    case 'evict':
      return pushChoice(s, { kind: 'evict-voter', count: effect.n, reason: 'Card effect' }, source);
    case 'discard-voter':
      return pushChoice(s, { kind: 'discard-voter', count: effect.n, reason: 'Card effect' }, source);
    case 'convert-voter':
      return pushChoice(s, { kind: 'convert-voter', count: effect.n, reason: 'Card effect' }, source);
    case 'gerrymander': {
      const p = s.players[source];
      if (!p) return s;
      // Negative "used" counts read as bonus moves in the allowance check.
      const bonus: Record<string, number> = { ...p.powerUses.gerrymandered };
      bonus['__bonus'] = (bonus['__bonus'] ?? 0) + effect.n;
      return withPlayer(s, source, { powerUses: { ...p.powerUses, gerrymandered: bonus } });
    }
    case 'draw-conspiracy': {
      for (let i = 0; i < effect.n; i++) {
        const [next, id] = draw(s, 'conspiracy');
        s = next;
        if (id === null) break;
        const p = s.players[source];
        if (p) s = withPlayer(s, source, { conspiracies: [...p.conspiracies, id] });
      }
      return syncConspiracyTop(s, ctx);
    }
    case 'refresh-market': {
      for (const slot of s.market) s = discardTo(s, 'voter', slot.cardId);
      return refillMarket({ ...s, market: [] }, ctx);
    }
    case 'discount': {
      const p = s.players[source];
      if (!p) return s;
      return withPlayer(s, source, {
        powerUses: {
          ...p.powerUses,
          helpingHands: p.powerUses.helpingHands - effect.n,
        },
      });
    }
  }
}

function applyEffects(
  state: GameState,
  source: PlayerID,
  effects: readonly Effect[],
  ctx: Ctx,
): GameState {
  return effects.reduce((s, e) => applyEffect(s, source, e, ctx), state);
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

// ─────────────────────────── turn advance ───────────────────────────

function endOfGame(state: GameState): Result {
  const w = winners(state);
  return {
    ok: true,
    state: {
      ...state,
      finished: true,
      phase: 'finished',
      log: [...state.log, { turn: state.turn, player: null, text: 'The election is decided.', kind: 'system' }],
    },
    events: [{ type: 'game-over', winners: w }],
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
  // TODO(R10, Phase 3): `cardId` may be null when the Ideology deck AND its
  // discard are both empty, and the state is then stuck in `phase: 'answer'` with
  // no pending card: ANSWER says "no card has been put to you", REDRAW says "no
  // card to redraw", END_TURN says "answer your Ideology Card first". No legal
  // move exists. The headline path has this guard (nextHeadlineOrAdvance); the
  // ideology path needs the same treatment.
  const [drawn, cardId] = draw(s, 'ideology');
  s = drawn;

  s = {
    ...s,
    activePlayer: next,
    phase: 'answer',
    turn: s.turn + 1,
    round: i === s.turnOrder.length - 1 ? s.round + 1 : s.round,
    _pendingCard: cardId,
    activeHeadline: null,
  };

  return { ok: true, state: s, events };
}

// ─────────────────────────── the reducer ───────────────────────────

export function reduce(state: GameState, playerId: PlayerID, action: Action, ctx: Ctx): Result {
  const { rules, cards } = ctx;
  if (state.finished) return fail('the game is over');

  const self = state.players[playerId];
  if (!self) return fail(`unknown player ${playerId}`);

  // A pending decision freezes that player. p12 says so for the resource cap, and it
  // is the only sane reading for a card effect that is mid-resolution.
  const blocker = blockedBy(state, playerId);
  if (blocker && action.type !== 'RESOLVE_CHOICE') {
    return fail(`resolve "${blocker.choice.reason}" first`);
  }

  // p19: a Conspiracy Card may be played out of turn, right before an opponent
  // answers. Everything else is active-player only.
  const outOfTurnOk = action.type === 'PLAY_CONSPIRACY' && state.phase === 'answer';
  // TODO(R9, Phase 3): the guard below exempts the ACTIVE player entirely, and
  // PLAY_CONSPIRACY is the one turn action with no `phase !== 'actions'` check of
  // its own, so a conspiracy can be resolved mid-headline-queue (rules-reference.md
  // :282-283 scopes conspiracy play to "during your turn" and the pre-answer
  // window). Add `state.phase !== 'actions'` to the PLAY_CONSPIRACY case.
  if (playerId !== state.activePlayer && !outOfTurnOk && action.type !== 'RESOLVE_CHOICE') {
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
      const slot = state.market[action.slot];
      if (!slot) return fail('no Voter Card in that slot');

      const discounts = action.discounts ?? [];
      if (discounts.length > usesLeft(self, rules, 'helping-hands')) {
        return fail('not enough Helping Hands discounts left');
      }
      const cost = applyDiscounts(slot.cost, discounts);
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

      return { ok: true, state: s, events: [{ type: 'influenced', player: playerId, voters }] };
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
        const edit = setArea(s, { ...area, peg: { owner: playerId, majority: false } });
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
      let edit = setArea(s, { ...from, peg: null });
      s = edit.state;
      const events = [...edit.events];
      const toNow = findArea(s, to.id);
      if (!toNow) return fail('unknown area');
      edit = setArea(s, { ...toNow, peg: { owner: mover.owner, majority: false } });
      s = edit.state;
      events.push(...edit.events);

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
      const topId = state._conspiracyDraw[0];
      if (topId === undefined) return fail('the Conspiracy deck is exhausted');
      const card = cards.conspiracy[topId];
      if (!card) return fail('unknown conspiracy card');

      const discounts = action.discounts ?? [];
      if (discounts.length > usesLeft(self, rules, 'helping-hands')) {
        return fail('not enough Helping Hands discounts left');
      }
      // p19: "any combination of resources" totalling the printed cost.
      const due = Math.max(0, card.cost - discounts.length);
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
      return { ok: true, state: s, events: [] };
    }

    case 'PLAY_CONSPIRACY': {
      if (!self.conspiracies.includes(action.cardId)) return fail('you do not hold that card');
      const card = cards.conspiracy[action.cardId];
      if (!card) return fail('unknown conspiracy card');

      let s = withPlayer(state, playerId, {
        conspiracies: self.conspiracies.filter((c) => c !== action.cardId),
      });
      s = applyEffects(s, playerId, card.effects, ctx);
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
      const edit = setArea(state, { ...area, peg: null });
      let s = edit.state;
      // p34: the evicted voter goes back to its owner's mat and may be replaced
      // anywhere on their next turn, or it is discarded.
      s = grantVoters(s, victim, 1, 'Evicted', false);
      // TODO(R12, Phase 3): the `!` on `s.players[playerId]` defeats the checker
      // by design. It is safe today because nothing can remove a player, but a
      // future evict-the-player effect would throw an opaque TypeError instead of
      // a `fail(...)`. Replace with a guarded lookup. Same at POWER_PAYBACK and
      // POWER_TOUGH_LOVE.
      s = withPlayer(s, playerId, {
        powerUses: { ...s.players[playerId]!.powerUses, landGrab: self.powerUses.landGrab + 1 },
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
      const edit = setArea(s, { ...area, peg: null });
      s = edit.state;
      s = withPlayer(s, playerId, {
        powerUses: { ...s.players[playerId]!.powerUses, payback: self.powerUses.payback + 1 },
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
        const edit = setArea(s, { ...now, peg: { owner: playerId, majority: false } });
        s = edit.state;
        events.push(...edit.events);
      }
      s = withPlayer(s, playerId, {
        powerUses: {
          ...s.players[playerId]!.powerUses,
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

    case 'ACK_HEADLINE': {
      if (state.phase !== 'headlines') return fail('there is no Headline to resolve');
      const cardId = state.activeHeadline;
      if (cardId === null) return fail('there is no Headline to resolve');
      const card = cards.headline[cardId];
      if (!card) return fail('unknown headline card');

      const entry = state.headlineQueue[0];
      const source = entry?.by ?? playerId;

      let s: GameState = { ...state, headlineQueue: state.headlineQueue.slice(1) };
      s = applyEffects(s, source, card.effects, ctx);
      s = discardTo(s, 'headline', cardId);
      s = log(s, { player: source, text: `HEADLINE — ${card.name}`, kind: 'card' });

      return nextHeadlineOrAdvance({ ...s, activeHeadline: null }, ctx);
    }

    case 'END_TURN': {
      if (state.phase === 'answer') return fail('answer your Ideology Card first');
      if (state.phase === 'headlines') return fail('resolve the Headline first');
      // TODO(R7, Phase 3): this check is global, so a player with no choices of
      // their own is blocked by an opponent's pending decision. rules-reference.md
      // :140 freezes only "you". The per-player freeze above is already scoped
      // correctly; this one should be `state.choices.some(c => c.player === playerId)`.
      if (state.choices.length > 0) return fail('there are unresolved decisions');
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
      if (deltaTotal(pick.res) !== c.count) return fail(`discard exactly ${c.count}`);
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
      const wanted = Math.min(c.count, targetableCount(state, playerId, c.kind));
      if (pick.areaIds.length !== wanted) return fail(`choose exactly ${wanted}`);

      let s = state;
      const events: GameEvent[] = [];
      for (const id of pick.areaIds) {
        const area = findArea(s, id);
        if (!area?.peg) return fail('there is no voter there');
        if (area.volatile) return fail('voters in a Volatile Area cannot be affected');
        if (c.kind !== 'evict-voter' && area.peg.owner === playerId) {
          return fail('that targets an opponent');
        }
        const owner = area.peg.owner;
        const edit = setArea(
          s,
          c.kind === 'convert-voter'
            ? { ...area, peg: { owner: playerId, majority: false } }
            : { ...area, peg: null },
        );
        s = edit.state;
        events.push(...edit.events);
        if (c.kind === 'evict-voter') s = grantVoters(s, owner, 1, 'Evicted', false);
      }
      return { ok: true, state: drop(s), events };
    }
  }
}

/** How many legal targets exist — a card cannot demand more than the board offers. */
function targetableCount(state: GameState, playerId: PlayerID, kind: string): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (!a.peg || a.volatile) continue;
      if (kind !== 'evict-voter' && a.peg.owner === playerId) continue;
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
