/**
 * Projections: `ClientState` (the wire) → the shapes the components render.
 *
 * WHY A SEPARATE FILE, AND WHY IT IS ALL PURE.
 *
 * `net/store.ts` holds the server's state and nothing else. Every other thing
 * the UI needs — which seat colour a player is, whether a group is being placed,
 * how many slots a zone has left, what the scoreboard says — is DERIVED, and it
 * is derived here, in one place, as pure functions of the state and a handful of
 * local interaction facts.
 *
 * The rule this file exists to keep intact: no derived value is ever CACHED and
 * no derived value is ever SENT. There is no "optimistic" derivation, because
 * there is no such thing as an optimistic majority. If a value cannot be
 * computed from what the server last said, it does not exist in this client.
 *
 * ENGINE IMPORTS ARE TYPE-ONLY, for the reason spelled out in `net/index.ts`:
 * a value import drags `reduce.ts` — every card, every payout, the whole rule
 * engine — into the browser bundle. `packages/server/scripts/check-secrets.mjs`
 * fails the build on one. So the handful of rule NUMBERS the UI needs to render
 * (the resource cap, the redraw cost, the unlock thresholds) are re-declared
 * below as a frozen mirror, and `derive.test.ts` asserts they still agree with
 * the engine's `RULES` — which a test may import, because a test is not a bundle.
 *
 * That arrangement is deliberate rather than lazy. A client that imports the
 * engine's values has a copy of every payout in its bundle, and a bundle is a
 * file the server does not control, does not review, and cannot revoke. The
 * numbers are the safe part of the rules; the payouts are not.
 */

import type {
  Action,
  AreaID,
  Choice,
  ChoicePick,
  ClientState,
  Delta,
  MarketSlot,
  PendingChoice,
  PendingVoters,
  PlayerID,
  PlayerState,
  Pool,
  Resource,
  ZoneID,
} from '@shasn/engine';

import type { BoardMode, BoardPlayer, BoardState, BoardZoneID } from '../board/types.ts';

// ─────────────────────────── the rules mirror ───────────────────────────

/**
 * The numbers the UI renders, mirrored from `packages/engine/src/rules.ts`.
 *
 * Every value here is a DISPLAY number. Nothing in this object decides legality:
 * the engine does, and a wrong mirror costs a wrong label, not a wrong game. The
 * mirror is still checked — `derive.test.ts` imports the real `RULES` and
 * asserts equality — because "a label that says 3 cards to Level 3 when the
 * engine wants 4" is a bug players report as the game lying to them.
 */
export const UI_RULES = Object.freeze({
  resourceCap: 12,
  redrawCost: 4,
  passiveBonusPer: 2,
  level3: 3,
  level5: 5,
  marketSize: 3,
  gerrymandersPerZone: 1,
  gerrymandersPerZoneWithFever: 2,
  prospectingPerTurn: 1,
  prospectingTake: 2,
  landGrabPerTurn: 3,
  donationsPerTurn: 2,
  paybackPerTurn: 2,
  goingViralPerTurn: 2,
  helpingHandsPerTurn: 2,
  toughLovePerTurn: 1,
  toughLoveTrust: 2,
  toughLoveAny: 2,
  toughLoveConverts: 2,
});

/** The four resources, in the printed order. Mirrors `state.ts:RESOURCES`. */
export const RESOURCE_ORDER: readonly Resource[] = ['funds', 'clout', 'media', 'trust'];

/** The four Ideologues, in the printed order. Mirrors `state.ts:IDEOLOGUES`. */
export const IDEOLOGUE_ORDER = ['capitalist', 'supremo', 'showstopper', 'idealist'] as const;
export type IdeologueName = (typeof IDEOLOGUE_ORDER)[number];

/** `IDEOLOGUE_RESOURCE`, p11 & p33. Capitalist→Funds, Supremo→Clout, … */
export const IDEOLOGUE_RESOURCE: Readonly<Record<IdeologueName, Resource>> = {
  capitalist: 'funds',
  supremo: 'clout',
  showstopper: 'media',
  idealist: 'trust',
};

/** The seat index into `--seat-1..5`, 1-based, from the turn order. */
export function seatOf(turnOrder: readonly PlayerID[], id: PlayerID): 1 | 2 | 3 | 4 | 5 {
  const i = turnOrder.indexOf(id);
  if (i < 0 || i > 4) return 1;
  return (i + 1) as 1 | 2 | 3 | 4 | 5;
}

/** The CSS custom property for a seat. The board reads the same token. */
export function seatToken(seat: number): string {
  return `var(--seat-${seat})`;
}

// ─────────────────────────── small numerics ───────────────────────────

export function poolTotal(p: Pool): number {
  return p.funds + p.clout + p.media + p.trust;
}

export function deltaTotal(d: Delta): number {
  return (d.funds ?? 0) + (d.clout ?? 0) + (d.media ?? 0) + (d.trust ?? 0);
}

/** Can this pool pay this delta? Mirrors `resources.ts:canAfford`. */
export function canAfford(pool: Pool, cost: Delta): boolean {
  for (const r of RESOURCE_ORDER) {
    if ((cost[r] ?? 0) > pool[r]) return false;
  }
  return true;
}

/** How short is this pool on this delta? Mirrors `resources.ts:shortfall`. */
export function shortfall(pool: Pool, cost: Delta): Delta {
  const out: Record<string, number> = {};
  for (const r of RESOURCE_ORDER) {
    const miss = (cost[r] ?? 0) - pool[r];
    if (miss > 0) out[r] = miss;
  }
  return out as Delta;
}

/** `funds 2 · clout 1` — the compact cost/readout form used all over the mat. */
export function deltaText(d: Delta): string {
  const parts: string[] = [];
  for (const r of RESOURCE_ORDER) {
    const n = d[r] ?? 0;
    if (n > 0) parts.push(`${n} ${r}`);
  }
  return parts.length === 0 ? 'nothing' : parts.join(' · ');
}

// ─────────────────────────── the board projection ───────────────────────────

/** What the board needs to know about the interaction it is currently in. */
export type BoardInteraction = {
  readonly mode: BoardMode;
  /** Area ids already picked for the group in flight. */
  readonly pickedAreaIds: readonly string[];
  /** The zone the first pick locked, for a `sameZone: true` group. */
  readonly lockedZoneId: BoardZoneID | null;
  /** The gerrymander source the player has armed, if any. */
  readonly gerrySourceAreaId: string | null;
  /**
   * §6.2 "Enter": source-legality rings are NOT resolved on mode entry, because
   * a board that flashes 129 overlays on a mode toggle reads as a glitch. The
   * player arms a source explicitly; the matrix teaches G3/G4 from that point.
   */
  readonly resolveGerrySources: boolean;
  /** The whole board is inert: not your turn, or a modal owns the interaction. */
  readonly disabled: boolean;
};

export const IDLE_INTERACTION: BoardInteraction = {
  mode: 'idle',
  pickedAreaIds: [],
  lockedZoneId: null,
  gerrySourceAreaId: null,
  resolveGerrySources: false,
  disabled: true,
};

/**
 * `ClientState` → the board's `BoardState`.
 *
 * A structural mapping, not a re-derivation: the engine's `Zone`/`Area` already
 * have the exact field names and readonly modifiers `board/types.ts` mirrors, so
 * this is an assignability the compiler checks rather than a copy that can rot.
 * The `zones` array is passed through untouched.
 */
export function toBoardState(state: ClientState, interaction: BoardInteraction): BoardState {
  const players: BoardPlayer[] = state.turnOrder.map((id) => {
    const p = state.players[id];
    return { id, name: p?.name ?? '—', seat: seatOf(state.turnOrder, id) };
  });
  return {
    zones: state.zones,
    players,
    activePlayerId: state.activePlayer,
    mode: interaction.mode,
    disabled: interaction.disabled,
    ...(interaction.lockedZoneId === null ? {} : { lockedZoneId: interaction.lockedZoneId }),
    pickedAreaIds: interaction.pickedAreaIds,
    ...(interaction.gerrySourceAreaId === null
      ? {}
      : { gerrySourceAreaId: interaction.gerrySourceAreaId }),
  };
}

/** Every area id, with its zone, volatile flag and occupant. One flat index. */
export type AreaIndex = ReadonlyMap<
  string,
  { readonly zoneId: ZoneID; readonly zoneName: string; readonly volatile: boolean; readonly peg: { readonly owner: PlayerID; readonly majority: boolean } | null }
>;

export function indexAreas(state: ClientState): AreaIndex {
  const out = new Map();
  for (const z of state.zones) {
    for (const a of z.areas) {
      out.set(a.id, { zoneId: z.id, zoneName: z.name, volatile: a.volatile, peg: a.peg });
    }
  }
  return out;
}

/** Empty slots in a zone, i.e. what the same-zone placement bar counts. */
export function freeSlotsIn(state: ClientState, zoneId: ZoneID): number {
  const z = state.zones.find((x) => x.id === zoneId);
  if (z === undefined) return 0;
  return z.areas.filter((a) => a.peg === null).length;
}

/** Majority voters held by a player. This is the score, and the only score. */
export function majorityCount(state: ClientState, player: PlayerID): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (a.peg !== null && a.peg.owner === player && a.peg.majority) n += 1;
    }
  }
  return n;
}

/** Zones this player holds a majority in. */
export function zonesHeld(state: ClientState, player: PlayerID): readonly string[] {
  return state.zones.filter((z) => z.majorityHolder === player).map((z) => z.name);
}

/**
 * The board is FULL — every slot occupied. p20: the game ends one round early,
 * starting with whoever filled the last slot.
 */
export function boardFull(state: ClientState): boolean {
  return state.zones.every((z) => z.areas.every((a) => a.peg !== null));
}

/** A majority in all nine zones. The other way the game ends. */
export function allMajoritiesFormed(state: ClientState): boolean {
  return state.zones.every((z) => z.majorityHolder !== null);
}

// ─────────────────────────── gerrymandering rights ───────────────────────────

/**
 * Who holds Gerrymanding Rights in a zone. p16 / `state.ts:gerrymanderRights`.
 *
 * STRICTLY more voters wins; a TIE GIVES NOBODY RIGHTS. That tie clause is not a
 * detail — it is the rule players misremember most, and §5.6 requires both
 * states to be shown on the zone label, so the UI needs the same answer the
 * engine has or the badge lies.
 */
export function rightsHolder(
  state: ClientState,
  zoneId: ZoneID,
): { readonly player: PlayerID | null; readonly tied: boolean } {
  const z = state.zones.find((x) => x.id === zoneId);
  if (z === undefined) return { player: null, tied: false };
  const counts = new Map<PlayerID, number>();
  for (const a of z.areas) {
    if (a.peg === null) continue;
    counts.set(a.peg.owner, (counts.get(a.peg.owner) ?? 0) + 1);
  }
  if (counts.size === 0) return { player: null, tied: false };
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (top === undefined) return { player: null, tied: false };
  if (second !== undefined && second[1] === top[1]) return { player: null, tied: true };
  return { player: top[0], tied: false };
}

export function holdsRightsIn(state: ClientState, player: PlayerID, zoneId: ZoneID): boolean {
  return rightsHolder(state, zoneId).player === player;
}

/** Zones where this player may spend a gerrymander this turn. */
export function rightsZones(state: ClientState, player: PlayerID): readonly ZoneID[] {
  return state.zones.filter((z) => rightsHolder(state, z.id).player === player).map((z) => z.id);
}

/** The per-zone move budget already spent. p16: one per zone, per turn. */
export function gerrymanderUsed(state: ClientState, player: PlayerID, zoneId: ZoneID): number {
  return state.players[player]?.powerUses.gerrymandered[zoneId] ?? 0;
}

// ─────────────────────────── the mat projection ───────────────────────────

/** One Ideologue cell on the manifesto strip, with its lock state. */
export type ManifestoCell = {
  readonly ideologue: IdeologueName;
  readonly resource: Resource;
  readonly count: number;
  /** `null` below Level 3, `'L3'` / `'L5'` at and above. */
  readonly level: 'L3' | 'L5' | null;
  /** Cards still needed for the next unlock, or 0 at max. */
  readonly toNext: number;
  /** `+1 / turn` is paid every `passiveBonusPer` cards (p15/p28). */
  readonly bonusPerTurn: number;
  /** How many more cards until that next `+1`. */
  readonly cardsToBonus: number;
};

export function manifestoCells(player: PlayerState): readonly ManifestoCell[] {
  return IDEOLOGUE_ORDER.map((ideologue) => {
    const count = player.manifesto.filter((i) => i === ideologue).length;
    const level: ManifestoCell['level'] =
      count >= UI_RULES.level5 ? 'L5' : count >= UI_RULES.level3 ? 'L3' : null;
    const nextAt = count >= UI_RULES.level5 ? UI_RULES.level5 : count >= UI_RULES.level3 ? UI_RULES.level3 : UI_RULES.level3;
    const toNext = level === null ? Math.max(0, nextAt - count) : Math.max(0, UI_RULES.level5 - count);
    const bonusPerTurn = Math.floor(count / UI_RULES.passiveBonusPer);
    const cardsToBonus = UI_RULES.passiveBonusPer - (count % UI_RULES.passiveBonusPer);
    return {
      ideologue,
      resource: IDEOLOGUE_RESOURCE[ideologue],
      count,
      level,
      toNext,
      bonusPerTurn,
      cardsToBonus: bonusPerTurn === 0 && level === null ? cardsToBonus : cardsToBonus,
    };
  });
}

// ─────────────────────────── the market projection ───────────────────────────

export type MarketView = {
  readonly slot: MarketSlot;
  readonly index: number;
  readonly affordable: boolean;
  /** Human-readable shortfall, e.g. `2 clout short`. `null` when affordable. */
  readonly short: string | null;
};

export function marketView(state: ClientState, player: PlayerID): readonly MarketView[] {
  const me = state.players[player];
  if (me === undefined) return [];
  return state.market.map((slot, index) => {
    const ok = canAfford(me.resources, slot.cost);
    const miss = shortfall(me.resources, slot.cost);
    const shortList = RESOURCE_ORDER.filter((r) => (miss[r] ?? 0) > 0).map(
      (r) => `${miss[r]} ${r} short`,
    );
    return { slot, index, affordable: ok, short: ok ? null : shortList.join(' · ') };
  });
}

// ─────────────────────────── choices ───────────────────────────

/** The six decision shapes, with the sentence a player needs to act on each. */
export function choiceHeadline(choice: Choice): string {
  // `resource(s)` is built once so all three resource headlines pluralise the
  // same way the voter ones already did: a cap discard of 1 read "Discard 1
  // resources" in the browser, which is the sort of small wrongness that makes a
  // printed rulebook feel untrustworthy.
  const res = (n: number): string => `resource${n === 1 ? '' : 's'}`;
  const voter = (n: number): string => `voter${n === 1 ? '' : 's'}`;
  switch (choice.kind) {
    case 'gain-any':
      return `Take ${choice.count} ${res(choice.count)} of your choice`;
    case 'lose-any':
      return `Discard ${choice.count} ${res(choice.count)}`;
    case 'steal-any':
      return `Take ${choice.count} ${res(choice.count)} from another player`;
    case 'evict-voter':
      return `Evict ${choice.count} ${voter(choice.count)} from the board`;
    case 'discard-voter':
      return `Discard ${choice.count} opponent ${voter(choice.count)}`;
    case 'convert-voter':
      return `Convert ${choice.count} opponent ${voter(choice.count)} to yours`;
  }
}

/** Why the decision exists, in the card's own words where it gave any. */
export function choiceReason(choice: Choice): string {
  return choice.reason;
}

/**
 * How many picks this choice actually needs.
 *
 * `Math.min(count, …)` in every case, and it is not a cosmetic clamp: the engine
 * caps the ask at what is actually available (`resolveChoice` uses the same
 * `Math.min`), so a UI that demands the uncapped number shows a player a
 * requirement the server will never accept.
 */
export function requiredPicks(
  choice: Choice,
  state: ClientState,
  player: PlayerID,
): number {
  switch (choice.kind) {
    case 'gain-any':
    case 'lose-any':
      return choice.count;
    case 'steal-any': {
      const victimId = choice.from;
      if (victimId === null) return choice.count;
      const v = state.players[victimId];
      return v === undefined ? 0 : Math.min(choice.count, poolTotal(v.resources));
    }
    case 'evict-voter':
      return Math.min(choice.count, targetableCount(state, player, 'evict-voter'));
    case 'discard-voter':
    case 'convert-voter':
      return Math.min(choice.count, targetableCount(state, player, choice.kind));
  }
}

/**
 * How many areas a voter-targeting choice may legally name.
 *
 * Mirrors `reduce.ts:targetableCount`: a peg in a non-Volatile Area, and for
 * `discard-voter` / `convert-voter` NOT one of yours (the engine rejects your
 * own with "that targets an opponent"). Getting this wrong produces a picker
 * the engine refuses, so it is derived rather than trusted from the choice.
 */
export function targetableCount(
  state: ClientState,
  player: PlayerID,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
): number {
  let n = 0;
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (a.peg === null || a.volatile) continue;
      if (kind !== 'evict-voter' && a.peg.owner === player) continue;
      n += 1;
    }
  }
  return n;
}

/** The areas this choice may name, for highlighting the board. */
export function targetableAreas(
  state: ClientState,
  player: PlayerID,
  kind: 'evict-voter' | 'discard-voter' | 'convert-voter',
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (a.peg === null || a.volatile) continue;
      if (kind !== 'evict-voter' && a.peg.owner === player) continue;
      out.add(a.id);
    }
  }
  return out;
}

/** The decisions owed to THIS player. `net/store.ts:myChoices` filters; this shapes. */
export type MyChoice = {
  readonly pending: PendingChoice;
  readonly required: number;
  readonly headline: string;
  readonly reason: string;
};

export function myChoices(state: ClientState, player: PlayerID): readonly MyChoice[] {
  return state.choices
    .filter((c) => c.player === player)
    .map((pending) => ({
      pending,
      required: requiredPicks(pending.choice, state, player),
      headline: choiceHeadline(pending.choice),
      reason: choiceReason(pending.choice),
    }));
}

// ─────────────────────────── placement legality ───────────────────────────

/**
 * Can this group be placed into this area RIGHT NOW?
 *
 * A client-side legibility check, not a second authority. The engine re-checks
 * all of it in `PLACE_VOTERS` and its answer wins; this exists so an illegal
 * click can NAME its reason on the same frame (§6.1.2 step 4, §9.10), which is
 * the difference between a constraint and a puzzle.
 *
 * The reasons are the engine's reasons, in player language.
 */
export function placementRefusal(
  state: ClientState,
  group: PendingVoters,
  picks: readonly string[],
  areaId: string,
): string | null {
  if (picks.includes(areaId)) return 'already chosen for this group';
  const area = indexAreas(state).get(areaId);
  if (area === undefined) return 'that slot does not exist';
  if (group.sameZone) {
    const locked = lockedZoneFor(state, group, picks);
    if (locked !== null && locked !== area.zoneId) {
      return `${lockedName(state, locked)} is already chosen — these voters must share one zone`;
    }
  }
  if (area.peg !== null) return 'already occupied';
  return null;
}

/** The zone the first pick locked, or null while the group is still free. */
export function lockedZoneFor(
  state: ClientState,
  group: PendingVoters,
  picks: readonly string[],
): ZoneID | null {
  if (!group.sameZone || picks.length === 0) return null;
  const idx = indexAreas(state);
  const first = picks[0];
  if (first === undefined) return null;
  return idx.get(first)?.zoneId ?? null;
}

function lockedName(state: ClientState, zoneId: ZoneID): string {
  return state.zones.find((z) => z.id === zoneId)?.name ?? zoneId;
}

/**
 * The consequence of confirming, stated before the click. §6.1.4.
 *
 * This is a RECEIPT, not a suggestion (§9.12): it describes the position the
 * player's own picks create, computed from `zone.majority` and the pegs already
 * on the board. It never suggests a zone and never picks one.
 */
export type PlacementConsequence = {
  readonly zoneName: string;
  readonly before: number;
  readonly after: number;
  readonly majorityNeeded: number;
  readonly majorityForms: boolean;
  readonly volatileHits: number;
};

export function placementConsequence(
  state: ClientState,
  player: PlayerID,
  picks: readonly string[],
): PlacementConsequence | null {
  const first = picks[0];
  if (first === undefined) return null;
  const idx = indexAreas(state);
  const firstArea = idx.get(first);
  if (firstArea === undefined) return null;
  const zone = state.zones.find((z) => z.id === firstArea.zoneId);
  if (zone === undefined) return null;
  // `before` counts the pegs THIS player already has in the zone, because the
  // receipt is about whether *their* majority forms.
  const before = zone.areas.filter((a) => a.peg?.owner === player).length;
  const added = picks.filter((id) => idx.get(id)?.zoneId === zone.id).length;
  const volatileHits = picks.filter((id) => idx.get(id)?.volatile === true).length;
  return {
    zoneName: zone.name,
    before,
    after: before + added,
    majorityNeeded: zone.majority,
    // A majority forms when the pegs present reach the printed numerator. The
    // engine's `recount` also requires a majority not already held elsewhere,
    // which is a detail this receipt deliberately does not model: over-promising
    // a majority that then does not form is a wrong receipt, and under-promising
    // one that does is the same. The engine is authoritative either way.
    majorityForms: before + added >= zone.majority,
    volatileHits,
  };
}

// ─────────────────────────── gerrymander legality ───────────────────────────

/**
 * Is this move legal, and if not, why?
 *
 * The same posture as `placementRefusal`: the engine decides, this names the
 * reason on the frame the player clicked. All five of §6.2's G1–G5 are checked
 * here so the confirm bar can state what it is about to do.
 */
export function gerrymanderRefusal(
  state: ClientState,
  player: PlayerID,
  rightsZoneId: ZoneID,
  fromAreaId: string,
  toAreaId: string,
): string | null {
  const idx = indexAreas(state);
  const from = idx.get(fromAreaId);
  const to = idx.get(toAreaId);
  if (from === undefined || to === undefined) return 'that slot does not exist';
  if (fromAreaId === toAreaId) return 'that voter is already there';
  if (!holdsRightsIn(state, player, rightsZoneId)) {
    const z = state.zones.find((x) => x.id === rightsZoneId);
    return `you do not hold Gerrymanding Rights in ${z?.name ?? rightsZoneId}`;
  }
  if (from.peg === null) return 'there is no voter there';
  if (to.peg !== null) return 'that slot is taken';
  if (from.volatile) return 'Permanent — Volatile Area.';
  if (from.peg.majority) return 'Majority voters do not move.';
  const touches = from.zoneId === rightsZoneId || to.zoneId === rightsZoneId;
  if (!touches) return 'that move does not involve the zone you hold rights in';
  const rightsZone = state.zones.find((z) => z.id === rightsZoneId);
  const adjacent =
    rightsZone !== undefined &&
    (rightsZone.neighbours.includes(from.zoneId) || rightsZone.neighbours.includes(to.zoneId));
  if (from.zoneId !== to.zoneId && !adjacent) return 'zones are not adjacent';
  // p17: you may not move your only voter out of the zone whose rights you use.
  if (from.zoneId === rightsZoneId && from.peg.owner === player) {
    const z = state.zones.find((x) => x.id === rightsZoneId);
    const mine = z === undefined ? 0 : z.areas.filter((a) => a.peg?.owner === player).length;
    if (mine === 1) return 'that is your only voter here — moving it forfeits the zone';
  }
  return null;
}

// ─────────────────────────── the scoreboard ───────────────────────────

export type ScoreRow = {
  readonly player: PlayerID;
  readonly name: string;
  readonly seat: 1 | 2 | 3 | 4 | 5;
  readonly score: number;
  readonly zones: readonly string[];
  readonly isYou: boolean;
};

/** Ranked by score. Ties keep turn order, so the list never reshuffles itself. */
export function scoreboard(state: ClientState, you: PlayerID | null): readonly ScoreRow[] {
  const rows = state.turnOrder.map((id) => ({
    player: id,
    name: state.players[id]?.name ?? '—',
    seat: seatOf(state.turnOrder, id),
    score: majorityCount(state, id),
    zones: zonesHeld(state, id),
    isYou: id === you,
  }));
  return [...rows].sort((a, b) => b.score - a.score);
}

// ─────────────────────────── log ───────────────────────────

export type LogRow = {
  readonly turn: number;
  readonly who: string | null;
  readonly text: string;
  readonly kind: string;
  readonly seat: 1 | 2 | 3 | 4 | 5 | null;
};

export function logRows(state: ClientState): readonly LogRow[] {
  return [...state.log].reverse().map((e) => {
    const p = e.player === null ? undefined : state.players[e.player];
    return {
      turn: e.turn,
      who: p?.name ?? null,
      text: e.text,
      kind: e.kind,
      seat: e.player === null ? null : seatOf(state.turnOrder, e.player),
    };
  });
}

// ─────────────────────────── action builders ───────────────────────────

/**
 * Actions. Every one of these is a pure function returning a wire value; none
 * of them applies anything. The caller hands the result to
 * `Connection.dispatch`, and the server's broadcast is the only thing that
 * changes what is on screen.
 *
 * They are builders rather than inline literals at call sites so that the shape
 * of every action the client can send is enumerable in one place — which is what
 * makes "the client can do exactly these things and no others" checkable.
 */
export const actions = {
  answer: (displayIndex: 0 | 1): Action => ({ type: 'ANSWER', side: displayIndex }),
  redraw: (pay: Delta): Action => ({ type: 'REDRAW_IDEOLOGY', pay }),
  influence: (slot: number, opts?: { viral?: boolean; discounts?: readonly Resource[] }): Action => ({
    type: 'INFLUENCE',
    slot,
    ...(opts?.viral === true ? { viral: true } : {}),
    ...(opts?.discounts !== undefined ? { discounts: opts.discounts } : {}),
  }),
  placeVoters: (groupId: string, areaIds: readonly string[]): Action => ({
    type: 'PLACE_VOTERS',
    groupId,
    areaIds,
  }),
  gerrymander: (zoneId: ZoneID, fromAreaId: string, toAreaId: string): Action => ({
    type: 'GERRYMANDER',
    zoneId,
    fromAreaId,
    toAreaId,
  }),
  trade: (withPlayer: PlayerID, give: Delta, receive: Delta): Action => ({
    type: 'TRADE',
    withPlayer,
    give,
    receive,
  }),
  buyConspiracy: (pay: Delta): Action => ({ type: 'BUY_CONSPIRACY', pay }),
  playConspiracy: (cardId: string): Action => ({ type: 'PLAY_CONSPIRACY', cardId }),
  prospecting: (give: Resource, take: readonly Resource[]): Action => ({
    type: 'POWER_PROSPECT',
    give,
    take,
  }),
  landGrab: (areaId: AreaID): Action => ({ type: 'POWER_LAND_GRAB', areaId }),
  donations: (from: PlayerID, res: Resource): Action => ({ type: 'POWER_DONATIONS', from, res }),
  payback: (areaId: AreaID, pay: Resource): Action => ({ type: 'POWER_PAYBACK', areaId, pay }),
  toughLove: (areaIds: readonly string[], pay: Delta): Action => ({
    type: 'POWER_TOUGH_LOVE',
    areaIds,
    pay,
  }),
  resolveChoice: (choiceId: string, pick: ChoicePick): Action => ({
    type: 'RESOLVE_CHOICE',
    choiceId,
    pick,
  }),
  ackHeadline: (): Action => ({ type: 'ACK_HEADLINE' }),
  endTurn: (): Action => ({ type: 'END_TURN' }),
};
