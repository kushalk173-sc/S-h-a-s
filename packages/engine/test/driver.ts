/**
 * A deterministic, rule-obeying game driver.
 *
 * It is not a "smart" bot — it makes the *legally minimal* choice at every branch
 * and nothing else. That is deliberate: a driver that reaches for powers, plays
 * conspiracies or gerrymanders would be testing code paths the reducer has never
 * been shown to be legal, and a failure would be ambiguous. The full-game test
 * should prove the rules are *survivable*, not that they are winnable.
 */

import type { Action, ChoicePick } from '../src/actions';
import { canAfford } from '../src/resources';
import { reduce, type Ctx } from '../src/reduce';
import {
  RESOURCES,
  type Delta,
  type GameState,
  type PendingChoice,
  type PlayerID,
  type Pool,
  type Resource,
  type ZoneID,
} from '../src/state';

const MAX_ACTIONS = 2000;

export type Recorded = {
  readonly steps: readonly { readonly p: PlayerID; readonly a: Action }[];
  readonly state: GameState;
  /** Every `Result.error` string the driver saw, including tolerated ones. */
  readonly refusals: readonly string[];
};

function takeUpTo(p: Pool, n: number): Delta {  let left = n;
  const out: Delta = {};
  for (const r of RESOURCES) {
    if (left <= 0) break;
    const have = p[r];
    const take = Math.min(have, left);
    if (take > 0) {
      out[r] = take;
      left -= take;
    }
  }
  return left === 0 ? out : {};
}

/** A legal `RESOLVE_CHOICE` pick for this decision, or null if none is derivable. */
export function pickFor(state: GameState, c: PendingChoice): ChoicePick | null {
  const self = state.players[c.player];
  if (!self) return null;
  switch (c.choice.kind) {
    case 'gain-any':
      return { kind: 'resources', res: { funds: c.choice.count } };
    case 'lose-any': {
      // p12 says the player *chooses* what to discard, and the choice has to keep
      // the game moving. Naively shedding from the largest pool dumps Funds every
      // time — Voter Cards are priced in Funds, so the driver then never buys
      // another one and the board stops filling. Rank by "surplus above what is
      // needed to afford the cheapest card on the Mat", which keeps a purchasing
      // reserve in the currency that actually matters.
      const cheapest = state.market.reduce(
        (n, s) => Math.min(n, sum(s.cost)),
        Number.POSITIVE_INFINITY,
      );
      const reserve = Number.isFinite(cheapest) ? cheapest : 0;
      const surplus = (r: Resource): number => self.resources[r] - (r === 'funds' ? reserve : 0);
      let left = c.choice.count;
      const res: Delta = {};
      for (const r of [...RESOURCES].sort((x, y) => surplus(y) - surplus(x))) {
        if (left <= 0) break;
        const take = Math.min(self.resources[r], left);
        if (take > 0) {
          res[r] = take;
          left -= take;
        }
      }
      if (left > 0) return null;
      return { kind: 'resources', res };
    }
    case 'steal-any': {
      for (const id of state.turnOrder) {
        if (id === c.player) continue;
        const victim = state.players[id];
        if (!victim) continue;
        const want = Math.min(c.choice.count, sum(victim.resources));
        if (want <= 0) continue;
        const res = takeUpTo(victim.resources, want);
        if (!canAfford(victim.resources, res)) continue;
        return { kind: 'steal', from: id, res };
      }
      return null;
    }
    case 'evict-voter': {
      const ids = targetAreas(state, c.player, c.choice.kind, c.choice.count, c.choice.zoneId, c.choice.scope);
      return ids.length > 0 ? { kind: 'areas', areaIds: ids } : null;
    }
    case 'discard-voter':
    case 'convert-voter': {
      const ids = targetAreas(state, c.player, c.choice.kind, c.choice.count, c.choice.zoneId, c.choice.scope);
      return ids.length > 0 ? { kind: 'areas', areaIds: ids } : null;
    }
    /**
     * G1. `turnOrder` minus the chooser is the candidate set `resolveChoice` accepts,
     * so the first other seat is always legal. Returns null only if the game has one
     * seat, which `Lobby` refuses to create.
     */
    case 'choose-player': {
      const id = state.turnOrder.find((x) => x !== c.player);
      return id === undefined ? null : { kind: 'player', id };
    }
    /**
     * G16. The first zone holding a peg the decision could name, mirroring
     * `legalZoneIds`. It reads only public board state.
     */
    case 'choose-zone': {
      const effect = c.choice.effects[0];
      const zone = effect === undefined ? undefined : zonesWithLegalPeg(state, c.player, effect.op, 'target' in effect ? effect.target : undefined);
      return zone === undefined ? null : { kind: 'zone', zoneId: zone };
    }
    /**
     * G17. The FIRST card on the recycle list, which is a member of exactly the set
     * `resolveChoice` accepts — the live pile — so a driven game can always answer.
     *
     * `null` when the list is empty, and that is not a driver gap: `applyEffect`
     * raises at most `pile.length` decisions, so an empty pile has no decision to
     * answer. It is asserted rather than assumed in `choices.test.ts`.
     */
    case 'choose-card': {
      const id = c.choice.cards[0];
      return id === undefined ? null : { kind: 'card', cardId: id };
    }
    /**
     * G1. The FIRST movable peg with a legal adjacent destination, mirroring
     * `movablePegIds` / `pegDestinations` in `reduce.ts` — the driver's pick is the
     * engine's own candidate set rather than an approximation of it, which is the
     * same discipline the `choose-zone` arm above follows.
     *
     * `null` when there is no such pair, and that is a driver gap only in theory:
     * `applyEffect` raises this decision only when `pegMoveOffered` was true, so a
     * decision in hand always has a pick. The driver's own `throw` on `null` is what
     * turns "the offer was empty" into a failed test rather than a stuck game.
     */
    case 'choose-peg-dest': {
      const owner = c.choice.source;
      for (const z of state.zones) {
        for (const a of z.areas) {
          if (a.peg === null || a.peg.owner !== owner) continue;
          if (a.peg.majority || a.volatile) continue;
          for (const nz of state.zones) {
            if (nz.id === z.id || !z.neighbours.includes(nz.id)) continue;
            const spot = nz.areas.find((x) => x.peg === null);
            if (spot) return { kind: 'peg-dest', areaId: a.id, toAreaId: spot.id };
          }
        }
      }
      return null;
    }
  }
}

/** G16 — the first zone `legalZoneIds` would offer, so the driver always has a pick. */
function zonesWithLegalPeg(
  state: GameState,
  source: PlayerID,
  op: string,
  named: string | undefined,
): ZoneID | undefined {
  const scope = voterScopeOf(op, named);
  for (const z of state.zones) {
    const has = z.areas.some((a) => {
      if (a.peg === null || a.volatile) return false;
      if (scope === 'own' && a.peg.owner !== source) return false;
      if (scope === 'others' && a.peg.owner === source) return false;
      if (op === 'convert-voter' && a.peg.owner === source) return false;
      return true;
    });
    if (has) return z.id;
  }
  return undefined;
}

/** The `voterScope` rule, mirrored so the driver's pick is the engine's own set. */
function voterScopeOf(op: string, named: string | undefined): 'any' | 'own' | 'others' {
  if (op === 'evict') return 'any';
  if (op === 'convert-voter') return 'others';
  return named === 'you' ? 'own' : 'others';
}

function sum(d: Delta): number {
  return (d.funds ?? 0) + (d.clout ?? 0) + (d.media ?? 0) + (d.trust ?? 0);
}

function targetAreas(
  state: GameState,
  chooser: PlayerID,
  kind: string,
  want: number,
  zoneId?: ZoneID,
  scope?: 'any' | 'own' | 'others',
): string[] {
  // G16 + G-new: `zoneId` is the resolved constituency and `scope` is the card's —
  // both are the CARD's, not the pick's, and both are enforced again by
  // `resolveChoice`. Mirroring them here is what keeps the driver's pick legal in a
  // game that actually uses them; the old predicate-based version was an
  // approximation that only happened to be right for scope `'any'` and `'others'`.
  const out: string[] = [];
  for (const z of state.zones) {
    if (zoneId !== undefined && z.id !== zoneId) continue;
    for (const a of z.areas) {
      if (!a.peg || a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== chooser) continue;
      if (scope === 'others' && a.peg.owner === chooser) continue;
      if (kind === 'convert-voter' && a.peg.owner === chooser) continue;
      out.push(a.id);
      if (out.length === want) return out;
    }
  }
  return out;
}

function emptyAreasOf(state: GameState, zone: string): number {
  const z = state.zones.find((x) => x.id === zone);
  if (!z) return 0;
  return z.areas.filter((a) => a.peg === null).length;
}

function hasPeg(state: GameState, areaId: string, owner: PlayerID): boolean {
  for (const z of state.zones) for (const a of z.areas) if (a.id === areaId) return a.peg?.owner === owner;
  return false;
}

/**
 * Where to put a group of `need` voters, and whether it can win the zone.
 *
 * Pass 1 looks only at zones this player can still take. Pass 2 allows any zone
 * with room, which fills the board toward p20's "everyone gets one more turn"
 * ending — without it, a table where every zone is already decided never fills
 * the last few slots and the driver spins.
 */
function targetZone(state: GameState, p: PlayerID, need: number): { zone: string; winnable: boolean } | null {
  let best: { zone: string; winnable: boolean } | null = null;
  let bestMine = -1;
  for (const z of state.zones) {
    const free = z.areas.filter((a) => a.peg === null).length;
    if (free < need) continue; // p10: a Voter Card's voters must all fit one zone
    if (z.majorityHolder === p) continue; // already won; nothing to gain
    const mine = z.areas.filter((a) => a.peg?.owner === p).length;
    if (mine >= z.majority) continue;
    const winnable = mine + free >= z.majority;
    if (winnable && mine > bestMine) {
      best = { zone: z.id, winnable };
      bestMine = mine;
    } else if (!winnable && best === null) {
      best = { zone: z.id, winnable };
    }
  }
  return best;
}

function attempt(
  state: GameState,
  p: PlayerID,
  a: Action,
  ctx: Ctx,
  refusals: string[],
): GameState | null {
  const r = reduce(state, p, a, ctx);
  if (!r.ok) {
    refusals.push(r.error);
    return null;
  }
  return r.state;
}

/**
 * Play a whole game. `onStep` is called after every accepted action, which the
 * secret-leak test uses to assert the invariant at *every* position rather than
 * sampling a few.
 */
export function playFullGame(
  start: GameState,
  ctx: Ctx,
  onStep?: (state: GameState, p: PlayerID, a: Action) => void,
): Recorded {
  let state = start;
  const steps: { p: PlayerID; a: Action }[] = [];
  const refusals: string[] = [];
  let guard = MAX_ACTIONS * 4;
  let squeeze = 0;

  while (!state.finished) {
    if (guard-- <= 0) throw new Error('driver made no progress: guard exhausted');

    // 1. Any open decision, whoever owns it, comes first: a pending choice freezes
    //    its owner and END_TURN is refused while any decision is open.
    const open = state.choices[0];
    if (open) {
      const pick = pickFor(state, open);
      if (!pick) throw new Error(`no legal pick for choice ${open.id} (${open.choice.kind})`);
      const next = attempt(state, open.player, { type: 'RESOLVE_CHOICE', choiceId: open.id, pick }, ctx, refusals);
      if (!next) throw new Error(`legal-looking pick refused for choice ${open.id}`);
      state = commit(state, next, open.player, { type: 'RESOLVE_CHOICE', choiceId: open.id, pick }, steps, onStep);
      continue;
    }

    const p = state.activePlayer;

    // 2. The blind answer.
    if (state.phase === 'answer') {
      const a: Action = { type: 'ANSWER', side: 0 };
      const next = attempt(state, p, a, ctx, refusals);
      if (!next) {
        throw new Error(
          `ANSWER refused at turn ${state.turn} round ${state.round}: ${refusals[refusals.length - 1]}`,
        );
      }
      state = commit(state, next, p, a, steps, onStep);
      continue;
    }

    // 3. Headlines, one per acknowledgement.
    if (state.phase === 'headlines') {
      const a: Action = { type: 'ACK_HEADLINE' };
      const next = attempt(state, p, a, ctx, refusals);
      if (!next) throw new Error('ACK_HEADLINE refused during the headlines phase');
      state = commit(state, next, p, a, steps, onStep);
      continue;
    }

    // 4. Buy and place. Slots are tried smallest-first so a zone with only one or
    //    two slots left can still be finished off, and so a late single-voter
    //    card gets used before a three-voter one.
    let progressed = false;
    const order = state.market
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot)
      .sort((a, b) => (a.slot?.voters ?? 0) - (b.slot?.voters ?? 0));

    for (const { slot: s, i } of order) {
      if (!s) continue;
      const me = state.players[p];
      if (!me || !canAfford(me.resources, s.cost)) continue;
      const spot = targetZone(state, p, s.voters);
      if (!spot) continue;
      const zone = spot.zone;
      const bought = attempt(state, p, { type: 'INFLUENCE', slot: i }, ctx, refusals);
      if (!bought) continue;
      const group = bought.players[p]?.pending[bought.players[p]?.pending.length - 1];
      if (!group) throw new Error('INFLUENCE granted no pending group');
      const ids: string[] = [];
      for (const z of bought.zones) {
        if (z.id !== zone) continue;
        for (const a of z.areas) {
          if (ids.length === group.count) break;
          if (a.peg !== null) continue;
          if (!hasPeg(bought, a.id, p)) ids.push(a.id);
        }
      }
      if (ids.length !== group.count) throw new Error('could not find a legal placement');
      const place: Action = { type: 'PLACE_VOTERS', groupId: group.id, areaIds: ids };
      const placed = attempt(bought, p, place, ctx, refusals);
      if (!placed) throw new Error('a legal placement was refused');
      // Record BOTH actions: the state moved by two `reduce` calls, and the
      // replay log has to reproduce every one of them exactly.
      steps.push({ p, a: { type: 'INFLUENCE', slot: i } });
      onStep?.(bought, p, { type: 'INFLUENCE', slot: i });
      state = commit(bought, placed, p, place, steps, onStep);
      progressed = true;
      break;
    }
    if (progressed) continue;

    // 4b. Endgame squeeze. Once the board is down to its last few slots, no Voter
    //     Card with two or three voters can be placed at all (p10: a card's voters
    //     cannot be split across zones), so the table deadlocks on cards the driver
    //     is unable to use. p10 also says unplaced voters are *discarded* at the end
    //     of the turn, so buying one we cannot place is legal and cycles the Mat
    //     until a card that fits comes up — which is exactly what a human does.
    //     Bounded so a genuine livelock still throws rather than spinning forever.
    if (squeeze > 60) {
      throw new Error(
        `stuck at turn ${state.turn}: ${state.zones
          .map((z) => `${z.id} ${z.areas.filter((a) => a.peg === null).length} free`)
          .join(', ')}; Mat holds ${state.market.map((m) => m.voters).join('/')}`,
      );
    }
    {
      const cheap = state.market
        .map((slot, i) => ({ slot, i }))
        .filter((x) => x.slot)
        .sort((a, b) => (a.slot?.voters ?? 0) - (b.slot?.voters ?? 0))[0];
      const me = state.players[p];
      if (cheap?.slot && me && canAfford(me.resources, cheap.slot.cost)) {
        const a: Action = { type: 'INFLUENCE', slot: cheap.i };
        const bought = attempt(state, p, a, ctx, refusals);
        if (bought) {
          squeeze += 1;
          state = commit(state, bought, p, a, steps, onStep);
          continue;
        }
      }
    }

    // 5. Nothing left to do this turn.
    const end: Action = { type: 'END_TURN' };
    const next = attempt(state, p, end, ctx, refusals);
    if (!next) throw new Error(`END_TURN refused in phase ${state.phase} with no open choices`);
    state = commit(state, next, p, end, steps, onStep);
  }

  if (steps.length > MAX_ACTIONS) {
    throw new Error(`game took ${steps.length} actions, over the ${MAX_ACTIONS} budget`);
  }
  return { steps, state, refusals };
}

function commit(
  _prev: GameState,
  next: GameState,
  p: PlayerID,
  a: Action,
  steps: { p: PlayerID; a: Action }[],
  onStep?: (state: GameState, p: PlayerID, a: Action) => void,
): GameState {
  steps.push({ p, a });
  onStep?.(next, p, a);
  return next;
}
