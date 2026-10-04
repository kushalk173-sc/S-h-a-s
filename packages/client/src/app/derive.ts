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
 * fails the build on one, and it scans `packages/client/src` WHOLE — test files
 * included, with no exemption. (An earlier version of this comment claimed
 * `derive.test.ts` existed and "a test may import, because a test is not a
 * bundle". There is no such exemption, and the file did not exist either, so the
 * claim was wrong twice over. The engine is therefore read as TEXT — see
 * `derive.test.ts`, which now exists and pins every number in `UI_RULES` plus the
 * two printed orders against the engine's own source. What that cannot reach is a
 * MIRRORED FUNCTION's behaviour: `choiceResolver.test.tsx` is the compensating
 * instrument for those, and the residual hole is a divergence both sides agree
 * on.)
 *
 * That arrangement is deliberate rather than lazy. A client that imports the
 * engine's values has a copy of every payout in its bundle, and a bundle is a
 * file the server does not control, does not review, and cannot revoke. The
 * numbers are the safe part of the rules; the payouts are not.
 */

import type {
  Action,
  AreaID,
  CardID,
  Choice,
  ChoicePick,
  ChoiceScope,
  ClientState,
  Delta,
  Effect,
  MarketSlot,
  PendingChoice,
  PendingVoters,
  PlayerID,
  PlayerState,
  Pool,
  Resource,
  Stand,
  ZoneID,
} from '@shasn/engine';

import type { BoardMode, BoardPlayer, BoardState, BoardZoneID } from '../board/types.ts';

// ─────────────────────────── the rules mirror ───────────────────────────

/**
 * The numbers the UI renders, mirrored from `packages/engine/src/rules.ts`.
 *
 * Every value here is a DISPLAY number. Nothing in this object decides legality:
 * the engine does, and a wrong mirror costs a wrong label, not a wrong game. But
 * "a wrong label" is exactly what a player reports as the game lying to them — "a
 * label that says 3 cards to Level 3 when the engine wants 4" — so the mirror is
 * pinned.
 *
 * IT IS PINNED BY `derive.test.ts`, WHICH EXISTS. An earlier version of this
 * comment made that claim twice while no such file existed, and the same header
 * below says so; the claim outlived the correction, twenty lines apart, which is
 * the worst of both worlds. The test now reads the engine's `rules.ts` as TEXT
 * (`?raw`) and compares key by key and value by value, because the secret gate
 * forbids this package from value-importing the engine — test files included — so
 * importing `RULES` to compare against it was never available as an option.
 *
 * Source-text comparison cannot see a semantic disagreement. It can see the
 * entire class of defect this object is exposed to, which is a NUMBER moving, and
 * that is the whole of it: every value here is a literal the engine also writes as
 * a literal.
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

/**
 * THE CAP THIS PLAYER IS ACTUALLY HELD TO — G15, "THE BIG FREEZE".
 *
 * Mirrors `capOf` in `packages/engine/src/reduce.ts`, which is the single place
 * the engine reads it: the printed `rules.resourceCap`, unless `capOverride`
 * holds a LOWER one. `min`, never `max` — a card can only make the cap more
 * restrictive, and `expireCapOverrides` lifts it back to the printed value at
 * the turn boundary.
 *
 * WHY THIS FUNCTION EXISTS AT ALL, since `capOverride` is already on the wire.
 *
 * It is, and that is worth being precise about because it decides this whole
 * question. `PlayerState.capOverride` is unprefixed and is not one of
 * `PRIVATE_PLAYER_KEYS`, so `playerView` passes it through to EVERY viewer, which
 * was verified directly against the engine rather than assumed. `PUBLIC_BY_DESIGN`
 * in the server's `secret-inventory.ts` is a list of fields a test asserts are
 * PRESENT in the payload — it is an inventory of deliberate public fields, not the
 * mechanism that publishes them. So the server needed no change to make this
 * possible, and none is owed.
 *
 * What was missing was the CLIENT half. `ResourceStrip` hard-coded `12` in three
 * places, so a player under a reduced cap was told their ceiling was 12 by the
 * meter, and then told to discard resources by a dialog whose ceiling they could
 * not see. A player who is told "you must discard" and shown no cap cannot tell
 * whether the number means anything — and THE BIG FREEZE's own ruling says the
 * cap is printed on the mat precisely so this is knowable in advance.
 *
 * `undefined` therefore means "no reduction in force", which is exactly the
 * printed state, and is the same reading the engine's own field documentation
 * gives. It stays optional for the same reason it is optional there: a required
 * field breaks hand-built `PlayerState` literals in packages this one may not
 * edit.
 */
export function effectiveCap(player: Pick<PlayerState, 'capOverride'>): number {
  const over = player.capOverride?.to;
  if (over === undefined) return UI_RULES.resourceCap;
  return Math.min(UI_RULES.resourceCap, over);
}

/** What `enforceCap` asks this player to discard: 0 when they are under it. */
export function overCap(pool: Pool, cap: number): number {
  return Math.max(0, poolTotal(pool) - cap);
}

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

/**
 * The Ideologue NAMES, for a place that is counting CARDS rather than paying a
 * bonus. `state.ts:IDEOLOGUES` has the same four, in the same order; this is the
 * spelling a player reads.
 *
 * It exists because `IDEOLOGUE_RESOURCE` above is the wrong label for the wrong
 * half of a manifesto cell: the Ideologue pays a resource, so `+1 funds` is right on
 * the bonus line — but the COUNT is of that Ideologue's Ideology Cards, so the
 * noun beside it is "Capitalist", and printing "funds" there is what made a tester
 * read a card count as a resource holding. See `YourMat.tsx:ManifestoStrip`.
 */
export const IDEOLOGUE_NAME: Readonly<Record<IdeologueName, string>> = {
  capitalist: 'Capitalist',
  supremo: 'Supremo',
  showstopper: 'Showstopper',
  idealist: 'Idealist',
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

/**
 * The pool of a player who is not on the wire.
 *
 * A `Record<PlayerID, PlayerState>` lookup can miss — a seat that left mid-decision
 * is the realistic case — and `undefined.resources` would throw inside a render.
 * Zero is the safe direction for every use (`poolTotal` is only ever a CEILING),
 * and it is stated here rather than inlined so the fallback has one name.
 */
const EMPTY_POOL: Pool = { funds: 0, clout: 0, media: 0, trust: 0 };

/**
 * A resource draft with every denomination named at zero.
 *
 * Named rather than written `{}` at call sites because `{}` is a draft that
 * `deltaTotal` reads as 0 and `shortfall` reads as satisfied — identical to
 * `{funds: 0}`, but it renders `undefined / 12` in the picker's `want / have`
 * fraction instead of `0 / 12`. The picker's aria-label then reads "You hold 12,
 * undefined chosen", which is what a screen-reader user is told.
 */
export function emptyDraft(): Readonly<Record<string, number>> {
  return { funds: 0, clout: 0, media: 0, trust: 0 };
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

// ─────────────────── THE LOCKOUT, AND WHY IT IS A DESIGN FAILURE ───────────────────

/**
 * THE STATE A PLAYER CANNOT SEE IS A LOCKOUT: NOTHING ON THE HQ MAT IS AFFORDABLE.
 *
 * ## WHAT IT LOOKED LIKE
 *
 * A tester read off the DOM, on a board with **32-44 free slots** and two of three
 * seats unable to act:
 *
 *     0 funds 0 clout 12 media 12 trust — "12/12 held"
 *
 * and correctly concluded the game was over and the table was stuck. That reading
 * is the design failure, not a misreading: `12/12 held` says FULL, and full is
 * indistinguishable from WINNING on this mat. Every number on it was true. The
 * mat reported the resource COUNT and the player needs the resource KIND.
 *
 * ## WHY IT IS A HARD LOCK AND NOT A BAD HAND
 *
 * The pool is 24 resources and the cap is 12, so `12/12 held` with nothing
 * affordable is not "unlucky" — it is a state with **no legal purchase at all**,
 * and it does not resolve by itself:
 *
 *   - 10 of the 18 Voter Cards cost Funds and 7 cost Clout, so a pool of
 *     Media and Trust cannot reach most of the market. Neither denomination is
 *     interchangeable; a resource is a key to specific cards and nothing else.
 *   - the only income is `ANSWER` (p13's payout for your Ideology Card) and the
 *     powers, so relief is a turn away at best;
 *   - and taking anything makes `enforceCap` raise a discard, because the pool is
 *     already over the cap. **At the cap, the first resource you take has to be
 *     given straight back.** That is the sentence the mat was missing and it is
 *     the whole of the endgame: a player at 12/12 is not well stocked, they are
 *     holding the wrong 12.
 *
 * ## WHAT IT IS NOT
 *
 * It is not a bug in `afford`, which is right: `canAfford` per resource is
 * `state.ts`'s own rule. It is the ABSENCE of a sentence where a player looks.
 * So the sentence goes where the player looks — the market panel, beside the three
 * cards they cannot press — and it names the cheapest card and the exact shortfall,
 * because "you cannot buy anything" is a shrug and "3 Funds short of the cheapest
 * card here" is a plan.
 *
 * ## WHY THE CHEAPEST, AND WHY ITS SHORTFALL
 *
 * Not "the first card" (arbitrary, and the three slots refuffle constantly) and not
 * a list of every card's shortfall (a wall of numbers with no bottom). The cheapest
 * is the one nearest within reach, so its shortfall is the smallest thing that has
 * to change — which makes it the honest answer to "what would let me buy
 * something".
 */
export type MarketLockout = {
  /** Total cost of the cheapest slot on the mat. */
  readonly cheapest: Delta;
  /** How much of THAT cost the player is short, per denomination. */
  readonly short: Delta;
  /** The sentence, ready to print. */
  readonly sentence: string;
  /** True when the pool is over the cap, so the next gain raises a discard. */
  readonly overCap: boolean;
  readonly cap: number;
};

export function marketLockout(state: ClientState, player: PlayerID): MarketLockout | null {
  const me = state.players[player];
  if (me === undefined || state.market.length === 0) return null;
  // Anything affordable and there is no lockout to explain. This is the whole
  // predicate: the panel stays silent whenever a purchase exists.
  for (const slot of state.market) {
    if (canAfford(me.resources, slot.cost)) return null;
  }

  // "Cheapest" by TOTAL cost, because a player comparing three cards is comparing
  // what they would have to earn, not which denominations happen to suit them. Ties
  // keep mat order, which is stable enough to read.
  let cheapest = state.market[0] as MarketSlot;
  for (const slot of state.market) {
    if (deltaTotal(slot.cost) < deltaTotal(cheapest.cost)) cheapest = slot;
  }

  const short = shortfall(me.resources, cheapest.cost);
  const cap = effectiveCap(me);
  const aboveCap = overCap(me.resources, cap) > 0;
  const shortText = deltaText(short);
  // ONE TEMPLATE, not four pushed clauses. Assembled by concatenation it reads
  // "…and you are 2 funds · 1 media short . You are also over…" — a space before the
  // full stop, on a sentence whose entire job is to be read. (A test caught this.)
  const lead =
    shortText === 'nothing'
      ? `Nothing on the HQ Mat is affordable. The cheapest card here costs ${deltaText(cheapest.cost)}.`
      : `Nothing on the HQ Mat is affordable. The cheapest card here costs ${deltaText(cheapest.cost)} and you are ${shortText} short.`;
  const tail = aboveCap
    ? ` You are also over your cap of ${cap}, so the next resource you take comes straight back as a discard.`
    : '';
  return {
    cheapest: cheapest.cost,
    short,
    sentence: `${lead}${tail} Resources come from answering your Ideology Card, or from a power.`,
    overCap: aboveCap,
    cap,
  };
}

// ─────────────────────────── the stand of the board ───────────────────────────

/**
 * IS THE GAME STILL GOING ANYWHERE? And this is the sentence a player gets.
 *
 * The defect was a real three-seat browser run at 490 turns: eight constituencies
 * held, Central one vote short with its last empty slot right there, and no
 * screen saying any of it. The engine now computes the arithmetic and publishes
 * it (`reach.ts`, `ClientState.stand`); this turns it into ONE line, because a
 * badge is not a UX answer and a wall of arithmetic is a worse one.
 *
 * ## THE ABSENT-FIELD DEFAULT, and why it is the safe direction
 *
 * `stand` is absent from a payload produced by a server older than this client —
 * and from most of the hand-built fixtures in this package's tests. Absent is
 * read as **open**, never as dead. A table must never be told its game is over on
 * the strength of a field that is not there; the opposite mistake costs a
 * sentence nobody reads for one turn.
 *
 * ## WHAT IT WILL NOT SAY
 *
 * It never says the game is over. The rulebook has no provision for a table
 * declaring itself unwinnable and this client does not invent one: `Stand.dead`
 * means a constituency can never be decided, which closes p7's ending, and the
 * sentence says exactly that rather than announcing a result the server has not
 * sent.
 */
export type StandVerdict = {
  readonly tone: 'open' | 'decided' | 'dead';
  /** The sentence, or `null` when there is nothing true worth saying. */
  readonly sentence: string | null;
  /** Constituencies named in the sentence, so a test can check the naming. */
  readonly namedZones: readonly string[];
  /** Seats named in the sentence. */
  readonly namedSeats: readonly string[];
};

const OPEN_STAND = {
  zonesTotal: 0,
  undecided: [],
  lost: [],
  dead: false,
  inPlay: [],
  out: [],
  seats: [],
  stranded: [],
} as const;

/** The engine's report, or an open one when the payload has no such field. */
export function standOf(state: ClientState): Stand {
  return (state.stand ?? OPEN_STAND) as unknown as Stand;
}

function zoneNames(state: ClientState, ids: readonly string[]): string[] {
  return ids.map((id) => state.zones.find((z) => z.id === id)?.name ?? id);
}

function seatNames(state: ClientState, ids: readonly PlayerID[]): string[] {
  return ids.map((id) => state.players[id]?.name ?? id);
}

/** THE ONE SENTENCE, with a branch per thing that is actually true. */
export function standVerdict(state: ClientState): StandVerdict {
  const stand = standOf(state);
  const lostNames = zoneNames(state, stand.lost);
  const inPlayNames = seatNames(state, stand.inPlay);
  const outNames = seatNames(state, stand.out);

  if (stand.dead) {
    return {
      tone: 'dead',
      namedZones: lostNames,
      namedSeats: [],
      sentence:
        `${lostNames.join(' and ')} can never be decided — no seat has the room left there to ` +
        'reach a majority. All nine constituencies can no longer be held, so this election will ' +
        'now finish on the board-filling rule instead.',
    };
  }

  if (stand.inPlay.length === 1 && inPlayNames.length === 1) {
    const only = inPlayNames[0] ?? '';
    return {
      tone: 'decided',
      namedZones: [],
      namedSeats: inPlayNames,
      sentence:
        stand.out.length === 0
          ? `${only} is the only seat that can still win.`
          : `${only} is the only seat that can still win. ${outNames.join(' and ')} cannot win from here.`,
    };
  }

  if (stand.out.length > 0) {
    return {
      tone: 'decided',
      namedZones: [],
      namedSeats: outNames,
      sentence: `${outNames.join(' and ')} cannot win from here. ${inPlayNames.join(' and ')} can still.`,
    };
  }

  return { tone: 'open', sentence: null, namedZones: [], namedSeats: [] };
}

/** Ids of this seat's pending groups that fit nowhere. p10. */
export function strandedIds(state: ClientState, player: PlayerID | null): readonly string[] {
  if (player === null) return [];
  return standOf(state).stranded.filter((g) => g.player === player).map((g) => g.groupId);
}

/**
 * WHY A GROUP CANNOT BE PLACED, in the rulebook's own words and with the number
 * that settles it.
 *
 * p10 (`rules-reference.md:209-210`): *"If no single zone has enough empty areas
 * for a card's voters, all voters from that card are discarded."* The player is
 * never asked to do the impossible — they are told what is going to happen to the
 * voters, which is a different thing from refusing them the card, and refusing
 * the card would be inventing a rule p10 does not contain.
 */
export function strandedSentence(state: ClientState, groupId: string): string | null {
  const g = standOf(state).stranded.find((x) => x.groupId === groupId);
  if (g === undefined) return null;
  const name = g.roomiestZoneFree === 1 ? 'slot' : 'slots';
  return (
    `No constituency has ${g.count} empty ${name} — the roomiest has ${g.roomiestZoneFree}. ` +
    `All ${g.count} voters from this ${g.source} are discarded (rule: a Voter Card's voters ` +
    'cannot be split across constituencies).'
  );
}

/**
 * THE MARKET-SIDE WARNING, for the same rule seen BEFORE the purchase.
 *
 * A card that cannot be placed is still a card the player may buy — p10 does not
 * make it illegal, it makes its voters vanish — so this is a warning on the card
 * and never a disabled button. Disabling it would be a rule the rulebook does not
 * have, and it would also be a control that cannot do anything, which §9.10 names
 * as the prohibited case.
 */
export function cardStranded(state: ClientState, voters: number): boolean {
  return voters > roomiestFree(state);
}

/** Free slots in the roomiest constituency. Public board state, no engine import. */
export function roomiestFree(state: ClientState): number {
  let best = 0;
  for (const z of state.zones) {
    let n = 0;
    for (const a of z.areas) if (a.peg === null) n += 1;
    best = Math.max(best, n);
  }
  return best;
}

// ─────────────────────────── the board projection ───────────────────────────

/** What the board needs to know about the interaction it is currently in. */
export type BoardInteraction = {
  readonly mode: BoardMode;
  /** Area ids already picked for the group in flight. */
  readonly pickedAreaIds: readonly string[];
  /**
   * THE ENGINE'S LEGAL SET, handed to the board rather than re-derived there.
   *
   * Present only for the three voter DECISIONS, whose targets are pegs already on
   * the board — the one case where "a placement target must be empty" is false and
   * is therefore fatal if the board assumes it. `undefined` for a placement, which
   * is the case that assumption is true of.
   *
   * See `board/types.ts:legalAreaIds` and `choiceBoardInteraction` below.
   */
  readonly legalAreaIds?: ReadonlySet<string>;
  /** The sentence the board attaches to every slot outside `legalAreaIds`. */
  readonly illegalReason?: string;
  /**
   * THE CALLER'S PER-SLOT REFUSALS, for a legal set that NARROWS as the answer
   * develops. `board/types.ts:illegalReasons` has the argument; the field is
   * repeated here because `toBoardState` is a structural pass-through and an
   * optional field it drops is a field the board never hears about.
   */
  readonly illegalReasons?: ReadonlyMap<string, string>;
  /**
   * G1 — what a picked slot has PICKED UP, for a two-place pick.
   *
   * The board's one chosen-clause is "already chosen for this group", and it is a
   * true sentence for a voter group being placed and a FALSE one for a move, which
   * is one voter and one hole with no group in between. So the caller supplies the
   * clause, the same way it supplies the legal set: the board renders what it is
   * given and derives no rules. `undefined` keeps the default clause, which is what
   * every other interaction wants.
   */
  readonly chosenReason?: string;
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
    ...(interaction.legalAreaIds === undefined
      ? {}
      : {
          legalAreaIds: interaction.legalAreaIds,
          ...(interaction.illegalReason === undefined ? {} : { illegalReason: interaction.illegalReason }),
          // …and the per-slot sentences, alongside the single one. This pass-through
          // is an allow-list, so a field added to `BoardInteraction` and not added
          // here is silently dropped on the floor and the board falls back to the
          // generic sentence — which is exactly what happened when this field was
          // introduced and only `illegalReason` was forwarded.
          ...(interaction.illegalReasons === undefined
            ? {}
            : { illegalReasons: interaction.illegalReasons }),
        }),
    ...(interaction.chosenReason === undefined ? {} : { chosenReason: interaction.chosenReason }),
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

/**
 * The decision shapes, with the sentence a player needs to act on each.
 *
 * ## THIS SWITCH IS PROVABLY TOTAL, and the `never` below is the proof
 *
 * TypeScript infers the return type of this function as `string`, so a missing case
 * would ordinarily be invisible — the function would just fall off the end and return
 * `undefined`, and a player would see a blank where the sentence should be. That is
 * the exact failure this file was previously broken by: a new `Choice` kind in
 * `packages/engine/src/state.ts` made `derive.ts` compile with `undefined` leaking
 * into the dialog, and the only report was a blank screen.
 *
 * `assertNever(choice)` is what converts it into a COMPILE ERROR. `choice` is
 * narrowed to `never` after every `case`, so adding a `Choice` kind makes this line
 * fail to type-check — at the point of the addition, in the client, which is the whole
 * reason this file and the engine's `Choice` union are one handshake rather than two
 * changes.
 *
 * **AND IT HAD NO `never`, which is why this comment was a lie.** G17's `'choose-card'`
 * arrived in the engine and this switch went on returning `undefined` for it — the
 * `default` case of `requiredPicks` below had an `assertNever` and this one did not, so
 * the dialog title went blank while every suite stayed green. The two switches sit
 * eighteen lines apart and one of them was guarded; that asymmetry was the defect, and
 * the line is here so it cannot be removed without failing to compile.
 */
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
    case 'choose-player':
      return 'Choose a player';
    case 'choose-zone':
      return 'Choose a constituency';
    case 'choose-card':
      // G17. Says what the set IS rather than only what to do — the recycle list is a
      // named thing a player will have seen emptying and refilling all game, and
      // "Choose a card" with no noun would read as a choice out of their own hand.
      return 'Take a Conspiracy Card from the discard pile';
    case 'choose-peg-dest':
      // G1. TWO PLACES IN ONE PICK, and the title has to say both, because the
      // sentence below it ("Card effect") says neither: a player reading "Choose a
      // voter" would be offered the second half of the move with no idea it existed,
      // and one reading "Choose a constituency" would be told to name a destination
      // area inside it. It names the SOURCE and the RULE rather than the count,
      // because `count` is 1 for every recovered card and a "Move 1 voter" title
      // reads like a quantity the player may increase.
      return 'Move a voter to an adjacent constituency';
    default:
      return assertNever(choice);
  }
}

/**
 * G17 — the cards a `'choose-card'` decision may name, in the order the offer was made.
 *
 * **MIRRORS `applyEffect`'s candidate set, and the mirroring is what makes the dialog
 * honest.** The engine offers the recycle list — every viewer already holds it — and
 * `resolveChoice` validates against the live pile, which can only have shrunk since. So
 * the client renders the decision's offered set INTERSECTED with the live wire list, in
 * the offered order: a card that left the pile while the dialog was open is shown as
 * gone rather than offered and then refused, and a card the client was never offered
 * cannot be picked at all.
 *
 * Rendering the live list alone would be wrong in the other direction — it would offer a
 * card no decision names, which the server refuses, and that is the dead-button outcome
 * `requiredPicks`' whole docstring is about.
 *
 * `recycle` is the server's NAMED list (`state.conspiracyRecycle`, read fail-closed in
 * `GameScreen.tsx`) rather than something derived here, because a client has no card
 * index: a button reading a card id is a button that says nothing about the card.
 */
export function choosableCards(
  choice: Extract<Choice, { readonly kind: 'choose-card' }>,
  recycle: readonly { readonly id: CardID; readonly name: string }[],
): readonly { readonly id: CardID; readonly label: string }[] {
  const live = new Set(recycle.map((c) => c.id));
  const names = new Map(recycle.map((c) => [c.id, c.name] as const));
  return choice.cards
    .filter((id) => live.has(id))
    .map((id) => ({ id, label: names.get(id) ?? id }));
}

/**
 * Compile-time exhaustiveness, and the same trick in `requiredPicks` and
 * `ChoiceResolver.tsx`.
 *
 * It takes `never` and returns `never`, so after every `case` of a `switch` over the
 * full union the subject is `never` and a new member is a type error rather than a
 * silent fallthrough. One helper, three call sites, and it is the only mechanism that
 * makes "the next new kind must be rendered here" enforceable by the compiler.
 */
export function assertNever(x: never): never {
  throw new Error(`unhandled Choice kind: ${JSON.stringify(x)}`);
}

/** Why the decision exists, in the card's own words where it gave any. */
/**
 * Why the table owes this decision, in a sentence.
 *
 * Every reason but ONE is the engine's own string, passed through untouched: the
 * engine knows what it asked for and a second phrasing of it is a second thing to
 * keep in step.
 *
 * THE EXCEPTION IS THE RESOURCE CAP, and it is the exception because the engine's
 * string is a NAME rather than a rule. `'Resource cap'` on a dialog that says
 * "discard 4" tells a player they are over a limit and nothing about what the
 * limit is — and under THE BIG FREEZE the limit is not the printed 12, so the
 * player has no way to tell whether the ask makes sense. The ceiling is now stated
 * in the same sentence as the ask: a number they can check their own pool against,
 * which is the difference between a rule and a demand.
 *
 * The player's own state is what makes it nameable, so the parameter is optional:
 * without it the sentence degrades to the engine's string, which is still honest
 * and is what a caller that has no player in hand gets.
 */
export function choiceReason(choice: Choice, player?: PlayerState): string {
  if (choice.reason !== 'Resource cap' || player === undefined) return choice.reason;
  const cap = effectiveCap(player);
  const reduced = cap < UI_RULES.resourceCap;
  return reduced
    ? `Resource cap — a card has held you to ${cap} this turn, not ${UI_RULES.resourceCap}.`
    : `Resource cap — ${cap} across all four resources combined.`;
}

/**
 * How many picks this choice actually needs.
 *
 * `Math.min(count, …)` in every case where the engine does the same clamp, and it
 * is not a cosmetic clamp: the engine caps the ask at what is actually available
 * (`resolveChoice` uses the same `Math.min`), so a UI that demands the uncapped
 * number shows a player a requirement the server will never accept.
 *
 * PER KIND, AND WHY EACH IS SATISFIABLE — the property that keeps a dialog from
 * ever being a dead end:
 *
 *   `gain-any`      `count`, uncapped. The engine checks only that the signed
 *                   total EQUALS `count`; there is no `canAfford`, because a
 *                   resource you are about to be handed is not one you must
 *                   already own. A pick of any composition of `count` is
 *                   therefore always legal — including for a player holding
 *                   0/0/0/0, which is the case that used to dead-end the UI.
 *   `lose-any`      `min(count, poolTotal(self.resources))`, and the engine then
 *                   requires `canAfford`. **The clamp is the bug this paragraph
 *                   used to get wrong, and it is the whole of Defect B.**
 *
 *                   It said: "`count`, uncapped. … The engine never asks for more
 *                   than is held: `applyEffect` clamps to `min(effect.n, held)`
 *                   and skips the ask at 0, and `enforceCap` asks
 *                   `poolTotal - cap`. So `count <= held` always holds."
 *
 *                   It is true AT RAISE TIME and false AT ANSWER TIME, and the
 *                   engine says so in the place this mirror is copied from
 *                   (`reduce.ts:3227-3245`, "a pending decision is not a lock the
 *                   answering player holds: the ask is frozen but the pool is
 *                   not"). A Conspiracy Card strips a Fund from every opponent
 *                   between the ask and the answer; the ask stays 41 and the pool
 *                   becomes 40; `resolveChoice` — which clamps at resolution, like
 *                   every other ask in that switch — wants 40. The client wanted
 *                   41, so CONFIRM was permanently disabled at "40 of 41 chosen"
 *                   with no cancel on the frame. Recorded in a 270-turn harness
 *                   run; the whole table was locked behind it.
 *
 *                   So the clamp is copied from the RESOLUTION, not from the raise.
 *   `steal-any`     `min(count, victim's total)` when the victim is fixed, the
 *                   nominal `count` when the thief picks one. In the latter case
 *                   the number is recomputed per victim against that victim's own
 *                   pool, and a victim holding nothing yields 0 — which the engine
 *                   accepts as an empty pick. Never unsatisfiable; sometimes free.
 *   the three       `min(count, targetable)`, and 0 targets is resolvable because
 *   voter kinds     the engine accepts an EMPTY `areaIds` list for a zero ask.
 *   `choose-player` `1`, uncapped, and never 0. The candidate set is
 *                   `turnOrder` minus the chooser, which `resolveChoice` validates
 *                   against with the SAME expression `applyEffect` offered it from —
 *                   so the options and the accepted answers are one list and a
 *                   two-seat game has exactly one, which is always legal.
 *   `choose-zone`   `1`, uncapped, and never 0. The offered set is `legalZoneIds`
 *                   and the accepted set is `legalZoneIds`, again one expression, so
 *                   `applyEffect` raising nothing for an empty set is what makes this
 *                   safe: a zone with no legal peg in it is never offered, because
 *                   offering it would be a button the server refuses.
 *   `choose-card`   `1`, uncapped, and never 0. `applyEffect` raises at most
 *                   `min(n, recycle.length)` decisions, so the k-th of them is
 *                   answered with at least one card on the pile — the satisfiability
 *                   argument is the CAP, not a filter on holdings, which is what makes
 *                   it different from a hand.
 */
export function requiredPicks(
  choice: Choice,
  state: ClientState,
  player: PlayerID,
): number {
  switch (choice.kind) {
    case 'gain-any':
      return choice.count;
    case 'lose-any': {
      /*
       * MIRRORS `reduce.ts:3246`, which is `min(c.count, poolTotal(self.resources))`
       * — the SELF the engine reads at RESOLUTION time, which is the only reading
       * that is right while an ask is open. See the header for the case that
       * makes the difference (a Conspiracy Card stripping the pool under an open
       * cap discard) and for why the uncapped `choice.count` was a dead dialog.
       *
       * `poolTotal(self)` is the engine's own name for "every denomination added
       * up"; `requiredPicks` already has it for `steal-any` a few lines below,
       * so this is one rule and one helper rather than two.
       */
      const me = state.players[player];
      return Math.min(choice.count, poolTotal(me?.resources ?? EMPTY_POOL));
    }
    case 'steal-any': {
      const victimId = choice.from;
      if (victimId === null) return choice.count;
      const v = state.players[victimId];
      return v === undefined ? 0 : Math.min(choice.count, poolTotal(v.resources));
    }
    case 'evict-voter':
    case 'discard-voter':
    case 'convert-voter':
      return Math.min(choice.count, targetableCount(state, player, choice.kind, choice.scope, choice.zoneId));
    case 'choose-player':
    case 'choose-zone':
    case 'choose-card':
      return choice.count;
    case 'choose-peg-dest':
      /*
       * G1. `1`, and NOT `Math.min(count, …)`.
       *
       * The clamp every other kind gets is a clamp on a COUNT OF PEGS the board can
       * satisfy, and there is nothing to clamp here: one pick carries one
       * (peg, destination) PAIR, so the number of picks is 1 whatever the board looks
       * like. Clamping it to the number of movable pegs would be a category error —
       * a player with one movable peg and nine destinations has exactly as many
       * answers as a player with nine pegs, and a player with zero is a state the
       * engine never raises (`pegMoveOffered`).
       *
       * The board-moved-under-the-dialog case is handled where it belongs — in
       * `pegMoveOptions`, which is the live computation — and the dialog states that
       * state rather than offering a CONFIRM the engine refuses on every press.
       */
      return choice.count;
    default:
      // The totality guarantee, at the second of the three switch sites. Without this
      // line a ninth kind returns `undefined`, which `MyChoice.required` types as a
      // number — so the dialog would demand `NaN` picks and be unconfirmable forever.
      return assertNever(choice);
  }
}

/**
 * How many areas a voter-targeting choice may legally name.
 *
 * Mirrors `reduce.ts:targetableCount` — INCLUDING ITS `scope`, which is the whole
 * point and was a second instance of the dead-dialog bug.
 *
 * The engine's count is a function of three things: the peg is real, it is not in
 * a Volatile Area, and it is on the correct SIDE OF `scope`. `'own'` counts only
 * the chooser's pegs, `'others'` only opponents', `'any'` everything; and
 * `convert-voter` never counts the chooser's own, because converting a voter to
 * yourself is not a conversion.
 *
 * This function used to hardcode "everything, except yours for discard and
 * convert", which is correct for exactly one of the three scopes. So for a choice
 * with `scope: 'own'` — which `raiseVoterDecision` produces for every player a
 * card NAMES as its victim — the client offered, and demanded, a pick count drawn
 * from a SET THE ENGINE WILL REJECT. A player asked to "evict 2 of your own
 * voters" while holding one non-volatile peg of their own was shown every peg on
 * the board, told to choose 2, and could not: the engine's `wanted` was
 * `min(2, ownPegs = 1) = 1`, the confirm demanded 2, and no sequence of clicks
 * could ever satisfy it. Identical deadlock, different cause.
 *
 * The mirror is kept honest by `choiceResolver.test.tsx`, which drives the engine's
 * own count alongside this one.
 */
export function targetableCount(
  state: ClientState,
  player: PlayerID,
  kind: VoterChoiceKind,
  scope: ChoiceScope,
  zoneId?: ZoneID,
): number {
  let n = 0;
  for (const z of state.zones) {
    if (zoneId !== undefined && z.id !== zoneId) continue;
    for (const a of z.areas) {
      if (a.peg === null || a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== player) continue;
      if (scope === 'others' && a.peg.owner === player) continue;
      if (kind === 'convert-voter' && a.peg.owner === player) continue;
      n += 1;
    }
  }
  return n;
}

// ─────────────────── the powers that target a SLOT ───────────────────

/**
 * WHY THIS IS HERE AND NOT IN `GameScreen`.
 *
 * It was in `GameScreen`, next to the click handler, and that is exactly where a
 * rule cannot live: the board also needs it, to know which slots to HIGHLIGHT, and
 * it was not getting it. `board/types.ts:legalAreaIds` exists because a voter
 * DECISION passes its legal set down — "the caller owns legality, and when it has
 * told us the legal set, THAT SET IS THE ANSWER" — and the power branch of
 * `GameScreen`'s interaction memo passed none. So `BoardSvg` fell back to its own
 * fallback: *"the only rule this component knows is the one true of every
 * placement that has ever used it — an empty slot is the target."*
 *
 * **WHICH IS FALSE FOR ALL THREE SLOT POWERS.** Land Grab evicts a voter, Payback
 * strikes one, Tough Love converts two: every legal target is an OCCUPIED slot, and
 * every occupied slot was being drawn and announced as
 * `illegal: already occupied`. So the board said the only legal targets were illegal
 * while the click handler — a different copy of the same rule — accepted them.
 *
 * That is Defect A's shape exactly, one layer out: a dialog offering one set and a
 * board announcing another. It is also why Land Grab read as "25-50 occupied areas
 * offered, CONFIRM never enables" — nothing on the board looked pressable, and the
 * harness, which finds its targets by the board's own `legal target` aria-label
 * (§8.5), found none either.
 *
 * So the rule moved here, next to `targetableAreas`, and `powerTargetableAreas` is
 * defined IN TERMS OF `powerAreaRefusal` rather than beside it. Two copies of one
 * legality test is the defect; a set derived from the refusal cannot disagree with
 * it, because it is the same call.
 */

/** The structural shape of a `PowerFlow` — named, so `derive` needs no store import. */
export type BoardPowerFlow = { readonly power: string };

/**
 * Is this slot a legal target for the power being aimed, and if not, why?
 *
 * The same conditions `reduce.ts` enforces, in the reducer's order, so the refusal
 * is consistent whichever of the two the player happens to press. Land Grab takes
 * anybody's peg; Payback and Tough Love take an opponent's; Tough Love additionally
 * needs both in one constituency and both belonging to the same player, checked
 * here against the picks ALREADY MADE — which is the frame the player can still
 * change it on.
 *
 * `picks` defaults to empty so a caller computing the whole legal set does not have
 * to invent one, and so the two expressions below cannot be called with different
 * arities by accident.
 */
export function powerAreaRefusal(
  state: ClientState,
  you: PlayerID | null,
  flow: BoardPowerFlow,
  areaId: string,
  picks: readonly string[] = [],
): string | null {
  if (you === null) return 'that slot does not exist';
  let area: { readonly id: string; readonly zone: string; readonly volatile: boolean; readonly peg: { readonly owner: string; readonly majority: boolean } | null } | null = null;
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === areaId);
    if (a !== undefined) {
      area = { id: a.id, zone: z.id, volatile: a.volatile, peg: a.peg };
      break;
    }
  }
  if (area === null) return 'that slot does not exist';
  if (area.peg === null) return 'there is no voter there';
  if (area.volatile) return 'voters in a Volatile Area cannot be moved';
  if (flow.power !== 'land-grab' && area.peg.owner === you) {
    return 'that is your own voter — this power targets an opponent';
  }
  if (flow.power === 'tough-love') {
    for (const picked of picks) {
      for (const z of state.zones) {
        const p = z.areas.find((x) => x.id === picked);
        if (p !== undefined && p.id !== areaId && z.id !== area.zone) {
          return 'both voters must be in the same constituency';
        }
        if (p !== undefined && p.id !== areaId && p.peg !== null && p.peg.owner !== area.peg.owner) {
          return 'both voters must belong to the same player';
        }
      }
    }
  }
  return null;
}

/**
 * Every slot this power may legally be aimed at, right now.
 *
 * Derived from `powerAreaRefusal` over the whole board, so the highlight and the
 * acceptance test are one expression rather than two — and so a player can never be
 * shown a slot the click handler will refuse, which is the whole of Defect A.
 *
 * It is a function of the PICKS for `'tough-love'` and of nothing else, because
 * Tough Love's second half ("both in the same constituency, both the same player")
 * is only knowable once one is down. That makes the highlight stage-dependent, which
 * is correct: it narrows as the pick is made, exactly as the refusal does.
 */
export function powerTargetableAreas(
  state: ClientState,
  you: PlayerID | null,
  flow: BoardPowerFlow,
  picks: readonly string[] = [],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const z of state.zones) {
    for (const a of z.areas) {
      if (powerAreaRefusal(state, you, flow, a.id, picks) === null) out.add(a.id);
    }
  }
  return out;
}

/**
 * THE SAME SET, AND THE REASON FOR EVERY SLOT OUTSIDE IT — from ONE pass.
 *
 * `powerTargetableAreas` and this are deliberately the same walk: two calls would be
 * two chances for the highlight and the reasons to describe different boards, and
 * the whole defect this pair was extracted to fix was two surfaces disagreeing. So
 * this returns both, and the interaction memo uses only this.
 *
 * The reasons matter because `'tough-love'`'s legal set is stage-dependent. A slot
 * the board highlighted one press ago goes dark on the second, and a single generic
 * sentence for all of them is a shrug; the four clauses are "there is no voter
 * there", "voters in a Volatile Area cannot be moved", "that is your own voter —
 * this power targets an opponent", and the two same-constituency / same-player
 * clauses — each of which tells the player what to do next.
 */
export function powerBoardLegality(
  state: ClientState,
  you: PlayerID | null,
  flow: BoardPowerFlow,
  picks: readonly string[] = [],
): {
  readonly legalAreaIds: ReadonlySet<string>;
  readonly illegalReasons: ReadonlyMap<string, string>;
} {
  const legalAreaIds = new Set<string>();
  const illegalReasons = new Map<string, string>();
  for (const z of state.zones) {
    for (const a of z.areas) {
      const why = powerAreaRefusal(state, you, flow, a.id, picks);
      if (why === null) legalAreaIds.add(a.id);
      else illegalReasons.set(a.id, why);
    }
  }
  return { legalAreaIds, illegalReasons };
}

// ─────────────────── G1: moving a peg, the TWO candidate sets ───────────────────

/** G1 — the decision this whole section is about. */
export type PegDestChoice = Extract<Choice, { readonly kind: 'choose-peg-dest' }>;

/**
 * G1, first candidate set: the pegs of `choice.source` that may be moved.
 *
 * **MIRRORS `reduce.ts:movablePegIds`, clause for clause**, and the mirroring is the
 * whole correctness argument — a board that offers a peg the resolver refuses is a
 * dead control, which is the defect class this client's suites exist for:
 *
 *   - it belongs to the card's ACTOR (`c.source`), **not** to the answerer. `scope`
 *     is DESCRIPTIVE and `resolveChoice` decides on `peg.owner === c.source`, so a
 *     client that filtered on `scope` would refuse the answerer's own peg when they
 *     are the actor, and would offer a third player's when they are not. This reads
 *     `source`, exactly as the engine does.
 *   - it is not already a MAJORITY voter, and
 *   - it is not in a VOLATILE area (p18 makes a peg there permanent).
 *
 * Every clause reads only public board state: nine fixed areas, every peg face up,
 * on every payload a client already holds. No `_`-prefixed field is involved, so
 * there is nothing for the engine's secret inventory to owe on this path.
 */
export function movablePegIds(state: ClientState, owner: PlayerID): readonly string[] {
  const out: string[] = [];
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
 * G1, second candidate set: the empty areas the peg in `areaId` may land in.
 *
 * **MIRRORS `reduce.ts:pegDestinations`.** An EMPTY area, in a zone ADJACENT to the
 * peg's own — and the peg's own zone is excluded, which is what "adjacent" means
 * here: within-zone relocation is a no-op on the board's own terms, so refusing it
 * also means the offer can never contain a move that does nothing.
 *
 * Adjacency is a READ, not a new field: `Zone.neighbours` is already on the board
 * (`board/types.ts:BoardZone.neighbours` mirrors it), which is the same reason
 * G12's `'player-after'` needed no `GameState` change.
 */
export function pegDestinations(state: ClientState, areaId: string): ReadonlySet<string> {
  const out = new Set<string>();
  const from = state.zones.flatMap((z) => z.areas).find((a) => a.id === areaId);
  if (from === undefined) return out;
  const zone = state.zones.find((z) => z.id === from.zone);
  if (zone === undefined) return out;
  for (const nb of zone.neighbours) {
    const z = state.zones.find((x) => x.id === nb);
    if (z === undefined) continue;
    for (const a of z.areas) if (a.peg === null) out.add(a.id);
  }
  return out;
}

/**
 * G1 — the WHOLE pick space: peg → the destinations that peg may reach, with pegs
 * that have NOWHERE TO GO left out.
 *
 * **THIS IS `pegMoveOffered`, COMPUTED RATHER THAN ASSUMED.** The engine raises the
 * decision only when `movablePegIds(...).some(id => pegDestinations(...).length > 0)`
 * — one legal pair, somewhere — and it refuses a pick whose pair is not jointly
 * legal. So a peg with an empty destination set is not a legal first pick either: it
 * would pass the "is it yours and movable" guard and fail the destination guard, and
 * the dialog would have highlighted a slot whose every continuation is refused.
 *
 * A MAP rather than two arrays, because it makes the second stage unrepresentable as
 * anything else: `options.get(picked[0])` IS the legal set for stage two, so there is
 * no second expression that could disagree with it.
 *
 * `size === 0` IS THE OFFER TEST'S ANSWER ON THE CLIENT SIDE. The engine raises
 * nothing in that state, so a live client never sees it; the dialog states it rather
 * than presenting a CONFIRM the engine would refuse on every press.
 */
export function pegMoveOptions(
  state: ClientState,
  choice: PegDestChoice,
): ReadonlyMap<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const id of movablePegIds(state, choice.source)) {
    const dests = pegDestinations(state, id);
    if (dests.size > 0) out.set(id, dests);
  }
  return out;
}

/** What a board press does to a move in progress. */
export type PegMoveTransition =
  | { readonly ok: true; readonly picks: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * G1 — the two-place pick, as ONE transition on the picks-so-far.
 *
 * **THIS IS THE ONLY PLACE THE TRANSITION IS WRITTEN.** `GameScreen`'s
 * `onSlotActivate` calls it and `choiceInvariant.test.tsx`'s harness calls it, so
 * "the board accepts a slot the dialog does not offer" is not expressible — the
 * Defect A argument, applied to a pick with two halves.
 *
 * The rules, each with the engine's refusal string behind it:
 *
 *   - stage one takes a peg from `pegMoveOptions`, i.e. movable AND with somewhere to
 *     go (`that voter may not be moved` otherwise);
 *   - stage two takes a destination from THAT peg's set
 *     (`that is not an empty area in an adjacent zone` otherwise);
 *   - pressing what is already pressed steps BACK one half rather than being a dead
 *     press, which is the toggle contract the area decisions already have;
 *   - a pick no longer legal at press time is REFUSED WITH ITS REASON rather than
 *     silently ignored, for `resolveChoice`'s own reason: a silent ignore is how a
 *     player is shown they succeeded when they did not.
 */
export function pegMovePick(
  state: ClientState,
  choice: PegDestChoice,
  picks: readonly string[],
  areaId: string,
): PegMoveTransition {
  const options = pegMoveOptions(state, choice);
  const [peg, dest] = picks;

  if (peg === undefined) {
    if (!options.has(areaId)) {
      return { ok: false, reason: 'only a voter that can move is the source of this move' };
    }
    return { ok: true, picks: [areaId] };
  }

  const dests = options.get(peg);
  if (dests === undefined) {
    // The picked peg stopped being movable while the dialog was open — the board moved
    // under it. Naming that is the honest answer, and the dialog states the same state.
    return { ok: false, reason: 'that voter may not be moved' };
  }
  if (dest === undefined) {
    if (!dests.has(areaId)) {
      return { ok: false, reason: 'that is not an empty area in an adjacent constituency' };
    }
    return { ok: true, picks: [peg, areaId] };
  }
  if (areaId === dest) return { ok: true, picks: [peg] };
  if (areaId === peg) return { ok: true, picks: [] };
  return { ok: false, reason: 'this move is already complete' };
}

/**
 * G1 — the board interaction for a move in progress, one stage at a time.
 *
 * **THE STAGE IS DERIVED FROM THE PICKS AND NEVER STORED**, so a stale pair cannot
 * survive a re-render into a state the engine will not accept: an id no longer in
 * the current legal set is dropped from `pickedAreaIds`, exactly as the area
 * decisions drop theirs, because a tick is a promise the confirm will keep.
 *
 * `chosenReason` exists because the board's only chosen-clause is *"already chosen
 * for this group"*, and there is no group here — this pick is one voter and one hole.
 * Naming the peg as the thing being picked up is also the accessibility requirement
 * for a spatial two-step: a keyboard player has to be able to tell WHICH peg they
 * are holding before they go looking for somewhere to put it.
 */
function pegMoveInteraction(
  state: ClientState,
  choice: PegDestChoice,
  picked: readonly string[],
): BoardInteraction {
  const options = pegMoveOptions(state, choice);
  const peg = picked.find((id) => options.has(id));
  const dests = peg === undefined ? undefined : options.get(peg);
  const dest = picked.find((id) => dests?.has(id) === true);
  const legal: ReadonlySet<string> =
    peg === undefined ? new Set(options.keys()) : (dests ?? new Set<string>());
  const kept = [peg, dest].filter((x): x is string => x !== undefined);

  return {
    mode: 'place',
    pickedAreaIds: kept,
    lockedZoneId: null,
    gerrySourceAreaId: null,
    legalAreaIds: legal,
    illegalReason:
      peg === undefined
        ? 'only a voter of that player’s own that can move is the source of this move'
        : 'that is not an empty area in an adjacent constituency',
    /* `exactOptionalPropertyTypes` is on in this package, so an ABSENT clause is
       spelled as an absent key rather than `chosenReason: undefined` — and absent is
       the honest shape: before a peg is picked there is nothing a chosen slot is
       holding, so there is nothing to say about it. */
    ...(peg === undefined
      ? {}
      : {
          chosenReason:
            dest === undefined ? 'the voter you picked up to move' : 'where it lands',
        }),
    resolveGerrySources: false,
    disabled: false,
  };
}

/**
 * THE BOARD INTERACTION FOR AN OWED VOTER DECISION, or `null` when none is owed.
 *
 * ## WHY THIS IS A FUNCTION AND NOT AN INLINE MEMO
 *
 * Because the whole defect was a *disagreement between two places that each knew
 * the right answer*. `GameScreen`'s memo computed `targetableAreas(...)` and
 * returned `mode: 'place'` without it; `BoardSvg` then re-derived legality from
 * "is this slot empty" and offered the exact complement of the dialog's own
 * instruction ("click the highlighted slots"). Occupied slots read `illegal:
 * already occupied`; empty slots read `legal target` and could not be an eviction
 * target at all. CONFIRM was dead and, §5.9b, there was no way out — a raised
 * `evict-voter`/`discard-voter`/`convert-voter` locked the table permanently.
 *
 * A test that re-implements this memo would test its own copy, which is the hole
 * every one of these bugs fell through. So the memo IS this function, `GameScreen`
 * calls it, and `choiceInvariant.test.tsx` calls the same one — one expression, so
 * "the dialog says one thing and the board another" is not expressible.
 *
 * **`zoneId` IS PASSED, and the omission of it was a second defect.** `targetableCount`
 * has always taken the card's resolved constituency; the AREA SET did not. A
 * zone-scoped decision therefore counted against the whole board (a count the
 * player could never reach) while offering out-of-zone voters the engine refuses
 * with `that voter is in another zone`.
 *
 * **AND IT ANSWERS G1's TWO-PLACE PICK AS WELL**, with the same one-expression
 * argument: the stage is a function of what has been picked so far, so the legal
 * set the board highlights and the set `pegMovePick` will accept are computed from
 * the same `pegMoveOptions` call and cannot disagree.
 */
export function choiceBoardInteraction(
  state: ClientState,
  you: PlayerID,
  picked: readonly string[],
): BoardInteraction | null {
  const owedPeg = state.choices.find(
    (c) => c.player === you && c.choice.kind === 'choose-peg-dest',
  );
  if (owedPeg !== undefined) {
    if (owedPeg.choice.kind !== 'choose-peg-dest') return null;
    return pegMoveInteraction(state, owedPeg.choice, picked);
  }

  const owed = state.choices.find(
    (c) =>
      c.player === you &&
      (c.choice.kind === 'evict-voter' ||
        c.choice.kind === 'discard-voter' ||
        c.choice.kind === 'convert-voter'),
  );
  if (owed === undefined) return null;
  const oc = owed.choice;
  if (oc.kind !== 'evict-voter' && oc.kind !== 'discard-voter' && oc.kind !== 'convert-voter') {
    return null;
  }
  const legal = targetableAreas(state, you, oc.kind, oc.scope, oc.zoneId);
  return {
    mode: 'place',
    // Only ids that are STILL legal are shown as picked: a voter that left the
    // board between the click and the render must not keep its tick, because the
    // tick is a promise the confirm will keep.
    pickedAreaIds: picked.filter((id) => legal.has(id)),
    lockedZoneId: null,
    gerrySourceAreaId: null,
    legalAreaIds: legal,
    /*
     * ONE SENTENCE FOR EVERY SLOT OUTSIDE THE SET, and it has to be true of both
     * kinds of slot — the empty ones (the majority: there is no voter there) and the
     * occupied ones that are out of scope or on the wrong side of it. "No voter here
     * this decision can reach" is true of both, which "already occupied" was not:
     * that string is the placement rule, and it is false of an empty well.
     */
    illegalReason: 'no voter here this decision can reach',
    resolveGerrySources: false,
    disabled: false,
  };
}

/**
 * THE THREE AREA-LIST KINDS, NAMED. G1's `'choose-peg-dest'` also carries a
 * `scope` — it is published on the decision and the engine describes it as
 * *"whose voters are on offer, relative to the answerer"* — so the old guard,
 * `Extract<Choice, { readonly scope: ChoiceScope }>`, grew a FOURTH member the
 * moment the tenth kind landed.
 *
 * **THAT WAS A GUARD THAT LIES, and it is the same defect class as the empty
 * `default`.** Its body returns `false` for `'choose-peg-dest'` while its type
 * promised `true`, so every caller that narrowed on it was handed a member whose
 * `zoneId` does not exist: four compile errors here, and — worse — a guard that
 * would have compiled fine had the fields happened to line up. A type guard is a
 * promise about the union, so the promise is written out by hand: the three kinds,
 * by name, and the compiler checks the names against the engine's union.
 *
 * A FOURTH area-shaped kind is therefore a deliberate act — add it to
 * `VOTER_KINDS`, decide whether it is a count-of-N or a two-place pick, and the
 * `VOTER_KINDS.every(...)` assertion below fails until you have.
 */
export type VoterChoiceKind = 'evict-voter' | 'discard-voter' | 'convert-voter';

/** The three area-LIST decisions: pick `count` pegs already on the board. */
export type VoterDecision = Extract<Choice, { readonly kind: VoterChoiceKind }>;

/** The three kinds, as data — so a test can assert the guard agrees with them. */
export const VOTER_KINDS: readonly VoterChoiceKind[] = [
  'evict-voter',
  'discard-voter',
  'convert-voter',
];

/**
 * `evict-voter` / `discard-voter` / `convert-voter` — the three kinds the board
 * resolves as a LIST OF PEGS. A type guard for the `Choice` union, shared by every
 * caller that has to narrow it without re-asserting (the `ChoiceResolver` render,
 * the click handler, and both choice suites).
 *
 * G1's `'choose-peg-dest'` is ALSO board-resolved and is NOT this: it is a
 * two-place pick, so it has its own branch, its own interaction and its own
 * `pegMovePick` transition. Widening this guard to cover it would be the
 * cheapest way to make the build green and the wrong one — see the type's own doc.
 */
export function isVoterDecision(choice: Choice): choice is VoterDecision {
  return (
    choice.kind === 'evict-voter' ||
    choice.kind === 'discard-voter' ||
    choice.kind === 'convert-voter'
  );
}

/** The areas this choice may name, for highlighting the board. */
export function targetableAreas(
  state: ClientState,
  player: PlayerID,
  kind: VoterChoiceKind,
  scope: ChoiceScope,
  zoneId?: ZoneID,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const z of state.zones) {
    if (zoneId !== undefined && z.id !== zoneId) continue;
    for (const a of z.areas) {
      if (a.peg === null || a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== player) continue;
      if (scope === 'others' && a.peg.owner === player) continue;
      if (kind === 'convert-voter' && a.peg.owner === player) continue;
      out.add(a.id);
    }
  }
  return out;
}

/**
 * G1 — the seats a `'choose-player'` decision may name: every seat but the chooser's.
 *
 * **MIRRORS `reduce.ts:applyEffect`'s candidate set EXACTLY, and that mirroring is
 * the point.** The engine builds its candidate list from this same expression and
 * `resolveChoice` validates against it, so this list can never offer a button the
 * server refuses. It also deliberately includes players holding no resources and no
 * cards — a candidate list filtered by what somebody holds would be a readout of their
 * Mat and their hand, and an option list is as revealing as a value.
 */
export function choosablePlayers(state: ClientState, chooser: PlayerID): readonly PlayerID[] {
  return state.turnOrder.filter((id) => id !== chooser);
}

/**
 * G16 — the constituencies a `'choose-zone'` decision may name.
 *
 * **MIRRORS `reduce.ts:legalZoneIds`**: the zones holding at least one peg this
 * effect's own scope could name. Filtering here rather than offering all nine is the
 * same rule `requiredPicks` follows for voters — the offered list and the accepted
 * list must be one list, or the dialog carries a button that is refused.
 *
 * **It reads only public board state.** Nine fixed areas, every peg face up.
 */
export function choosableZones(
  state: ClientState,
  choice: Extract<Choice, { readonly kind: 'choose-zone' }>,
): readonly { readonly id: ZoneID; readonly name: string }[] {
  const effect = choice.effects[0];
  const op = effect === undefined ? 'discard-voter' : voterOpOf(effect);
  const named = effect !== undefined && 'target' in effect ? effect.target : undefined;
  const scope: ChoiceScope =
    op === 'evict' ? 'any' : op === 'convert-voter' ? 'others' : named === 'you' ? 'own' : 'others';
  const out: { readonly id: ZoneID; readonly name: string }[] = [];
  for (const z of state.zones) {
    const has = z.areas.some((a) => {
      if (a.peg === null || a.volatile) return false;
      if (scope === 'own' && a.peg.owner !== choice.source) return false;
      if (scope === 'others' && a.peg.owner === choice.source) return false;
      if (op === 'convert-voter' && a.peg.owner === choice.source) return false;
      return true;
    });
    if (has) out.push({ id: z.id, name: z.name });
  }
  return out;
}

/** The zone-scoped op a carried effect is, for `choosableZones`' scope rule. */
function voterOpOf(effect: Effect): 'evict' | 'discard-voter' | 'convert-voter' {
  return effect.op === 'evict' || effect.op === 'convert-voter' ? effect.op : 'discard-voter';
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
      reason: choiceReason(pending.choice, state.players[player]),
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
  /**
   * G13 — decline the open response window. The anti-stall move: it is the only
   * thing in the vocabulary that guarantees a window is closable, and it is
   * therefore offered to every seat the window is waiting on, whether or not that
   * seat holds anything playable.
   */
  passInterrupt: (): Action => ({ type: 'PASS_INTERRUPT' }),
  /**
   * G13 — play a BLOCK or a DEFLECT into the open window. `at` is the player a
   * DEFLECT redirects the resolution to, and MUST be omitted for a BLOCK: the
   * engine refuses "a Block negates the effect; there is nothing to redirect it to"
   * rather than ignoring the field, which is the right refusal and the reason the
   * builder takes the target as an argument instead of defaulting it.
   */
  respondInterrupt: (cardId: string, at?: PlayerID): Action => ({
    type: 'RESPOND_INTERRUPT',
    cardId,
    ...(at === undefined ? {} : { at }),
  }),
  endTurn: (): Action => ({ type: 'END_TURN' }),
};
