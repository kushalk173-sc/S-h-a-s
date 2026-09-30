/**
 * The app store: everything the UI reads that is NOT in `net/store.ts`.
 *
 * `net/store.ts` is the server's truth and is left alone. This module holds the
 * two things a client legitimately has state of its own about:
 *
 *   1. THE CONNECTION LIFECYCLE. `connecting / live / reconnecting / lost`.
 *      `net/connection.ts` reports a `ConnectionStatus` and does the backoff;
 *      this translates it into the honest four states UI-SPEC §5.2 asks for, and
 *      — the part that matters — decides when "reconnecting" has become "lost",
 *      because a spinner that never resolves is worse than an honest failure.
 *
 *   2. LOCAL INTERACTION STATE. Which voter group is in flight, which areas are
 *      picked for it, which gerrymander source is armed, which trade is being
 *      composed, and — critically — WHICH RESOURCES THE PLAYER HAS ALREADY
 *      COMMITTED TO A DRAFT PAYMENT.
 *
 * ON (2), AND WHY IT IS NOT A VIOLATION OF "NO OPTIMISTIC STATE":
 *
 * The rule is that the client must never apply a GAME action locally. Nothing
 * here does. A picked slot is not a placed peg: the board renders it as a
 * `⌾*` tick over a slot that is still, in `ClientState`, empty, and the peg
 * appears only when the server's next `match:state` says it is there. A drafted
 * redraw payment is not a paid redraw: no resource leaves the pool until the
 * server says it has. Drop the connection mid-placement and every pick here
 * evaporates, which is the correct outcome — the game never saw them.
 *
 * What this state DOES buy is undo-before-confirm, which UI-SPEC §6.1 requires
 * and which is impossible without somewhere to hold a not-yet-committed pick.
 * The distinction is one line long and worth stating: **pending intent is local;
 * applied state is the server's.**
 *
 * SUBSCRIPTION. One `useSyncExternalStore` over a module-level object, matching
 * the pattern in `net/store.ts` rather than introducing a second one. `getSnapshot`
 * returns the object identity, which only changes on a real change, so React's
 * identity check does the work and no selector-memoisation layer is needed.
 */

import { useSyncExternalStore } from 'react';

import type { Delta, PlayerID, Resource, ZoneID } from '@shasn/engine';

import type { ConnectionStatus } from '../net/index.ts';

import { UI_RULES } from './derive.ts';

/** UI-SPEC §5.2. `lost` is a state, not a message: it is what "still trying" becomes. */
export type Link = 'connecting' | 'live' | 'reconnecting' | 'lost';

/**
 * Which trade composer is open, if any.
 *
 * `with` is a `PlayerID` and the two sides are `Delta`s — the engine's own shapes —
 * rather than bare strings. That is not pedantry: the action builder in `derive.ts`
 * wants exactly these types, so typing them here is what lets `GameScreen` compose a
 * `TRADE` with no cast. A `string` here would mean an `as never` at the call site, and
 * an `as never` at the point a message is built is a cast that can hide a wrong value.
 */
export type TradeDraft = {
  readonly with: PlayerID;
  /** What this player offers. */
  readonly give: Delta;
  /** What this player asks for. */
  readonly receive: Delta;
};

/**
 * An Ideologue Power that is mid-targeting.
 *
 * Only the powers that need something the client cannot infer enter this. It is a
 * tagged union rather than a bag of nullable fields because the four shapes have
 * genuinely different targets, and a bag would let `power: 'land-grab'` with a
 * `from` set — a state that is not a state the game has.
 *
 * `prospecting` needs no target at all: give one resource, take two. It is here
 * because the dialog that collects the other four is the same dialog.
 */
export type PowerFlow =
  | { readonly power: 'prospecting' }
  /** Evict any voter from the board. The target is a board slot. */
  | { readonly power: 'land-grab' }
  /** Take one resource from another player. */
  | { readonly power: 'donations' }
  /** Strike one opponent's voter, paying a resource. */
  | { readonly power: 'payback' }
  /** Convert two of one opponent's voters in one zone, paying 2 Trust + 2 any. */
  | { readonly power: 'tough-love' };

/** The powers whose target is a board slot, so the board can enter `place` mode. */
export function powerTargetsArea(flow: PowerFlow | null): boolean {
  return (
    flow !== null &&
    (flow.power === 'land-grab' || flow.power === 'payback' || flow.power === 'tough-love')
  );
}

/** How many slots this flow needs picked. Mirrors the engine's exact-count checks. */
export function powerAreaCount(flow: PowerFlow | null): number {
  if (flow === null) return 0;
  if (flow.power === 'tough-love') return UI_RULES.toughLoveConverts;
  return powerTargetsArea(flow) ? 1 : 0;
}

/** Which resources to waive, and whether to add a voter, on one market slot. */
export type MarketModifier = {
  readonly power: MarketPower;
  readonly slot: number;
  /** Going Viral: +1 voter on this card. */
  readonly viral: boolean;
  /** Helping Hands: each entry is one resource this buy costs nothing. */
  readonly discounts: readonly Resource[];
};

/**
 * The two powers `reduce.ts` folds into `INFLUENCE` rather than giving an action.
 *
 * They are modifiers on a BUY, so the player's first decision is which of the three
 * face-up Voter Cards to spend them on, and only the second is the power itself.
 */
export type MarketPower = 'going-viral' | 'helping-hands';

/** The resource picker: a target count and the draft against it. */
export type PickerDraft = {
  /** What the picker is paying for: a redraw, a market card, a conspiracy. */
  readonly forKind: 'redraw' | 'conspiracy' | 'prospecting';
  /** Exactly this many resources must be chosen. */
  readonly total: number;
  readonly pick: Readonly<Record<string, number>>;
};

export type AppState = {
  readonly link: Link;
  /** Reconnect attempts since the last successful open. Shown, not hidden. */
  readonly attempts: number;
  /** Milliseconds spent in the current `reconnecting` run. */
  readonly retryingMs: number;
  /** The last transport-level failure, for the honest-failure copy. */
  readonly lastFailure: string | null;
  /** Set when a reconnect has given up, so the banner stops claiming to try. */
  readonly gaveUp: boolean;

  /** The pending group being placed, and the areas picked for it. */
  readonly placingGroupId: string | null;
  readonly pickedAreaIds: readonly string[];
  /** The reason the last illegal click was refused, and when it was said. */
  readonly refusal: { readonly text: string; readonly at: number } | null;

  /** The gerrymander flow: rights zone, source, and the awaiting confirm. */
  readonly gerryZoneId: ZoneID | null;
  readonly gerrySourceAreaId: string | null;
  readonly gerryTargetAreaId: string | null;

  /** The open resource picker, if any. */
  readonly picker: PickerDraft | null;
  /** The open trade composer, if any. */
  readonly trade: TradeDraft | null;
  /** The power being targeted, if any. */
  readonly powerTarget: PowerFlow | null;

  /**
   * A Going Viral / Helping Hands modifier armed against one market slot.
   *
   * These two are not separate engine actions: `reduce.ts` folds them into
   * `INFLUENCE` as `viral` and `discounts`. So the player picks a CARD first and a
   * modifier second, and this holds the pairing until the buy. It is local intent,
   * not applied state — the modifier is spent only when the server says so.
   */
  readonly marketModifier: MarketModifier | null;

  /** A market power waiting for the player to name the CARD it applies to. */
  readonly pendingMarketPower: MarketPower | null;
  /** The two areas Tough Love has collected so far. */
  readonly toughLovePicks: readonly string[];
};

const INITIAL: AppState = {
  link: 'connecting',
  attempts: 0,
  retryingMs: 0,
  lastFailure: null,
  gaveUp: false,

  placingGroupId: null,
  pickedAreaIds: [],
  refusal: null,

  gerryZoneId: null,
  gerrySourceAreaId: null,
  gerryTargetAreaId: null,

  picker: null,
  trade: null,
  powerTarget: null,
  marketModifier: null,
  pendingMarketPower: null,
  toughLovePicks: [],
};

/**
 * When a reconnect becomes a `lost`.
 *
 * `net/connection.ts` retries forever, which is right for a four-hour game: the
 * seat is held server-side and nothing is lost by waiting. But a UI that says
 * "reconnecting" indefinitely is lying by omission — the player cannot tell a
 * thirty-second blip from a server that is gone, and they are making different
 * decisions about each. So: keep retrying, and after this long say plainly that
 * it is not working. Retrying continues underneath either way; the copy changes,
 * the behaviour does not.
 *
 * Thirty seconds is chosen against the transport's own backoff: `DEFAULT_BACKOFF`
 * reaches 15 s, so by then roughly five attempts have been made. A player who has
 * waited thirty seconds through five attempts has earned the truth.
 */
export const LOST_AFTER_MS = 30_000;

let state: AppState = INITIAL;
const listeners = new Set<() => void>();
let refusalSeq = 0;
let retryTicker: ReturnType<typeof setInterval> | null = null;
let retryStartedAt = 0;

function emit(): void {
  for (const fn of listeners) fn();
}

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeApp(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getAppState(): AppState {
  return state;
}

/** Test seam, and the "hard start over" button. */
export function resetApp(): void {
  stopTicker();
  state = INITIAL;
  refusalSeq = 0;
  emit();
}

/**
 * Translate a transport status into the four states a player can act on.
 *
 * `closed` is the only ambiguous input: it is both "I called disconnect" and
 * "the socket went away and we are not retrying". The connection layer only
 * reaches `closed` on an explicit disconnect, so a game in progress cannot land
 * there — but if it ever did, `lost` is the honest reading.
 */
export function applyConnectionStatus(status: ConnectionStatus): void {
  switch (status) {
    case 'connecting':
      stopTicker();
      set({ link: 'connecting', attempts: 0, retryingMs: 0, gaveUp: false, lastFailure: null });
      return;
    case 'open':
      stopTicker();
      set({ link: 'live', attempts: 0, retryingMs: 0, gaveUp: false, lastFailure: null });
      return;
    case 'reconnecting': {
      // Only count a run once. Re-entering `reconnecting` on every failed
      // attempt would inflate the number a player is shown.
      if (state.link !== 'reconnecting') {
        startTicker();
        set({
          link: 'reconnecting',
          attempts: state.attempts + 1,
          retryingMs: 0,
          gaveUp: false,
          lastFailure: null,
        });
        return;
      }
      return;
    }
    case 'closed':
      stopTicker();
      set({ link: 'lost', gaveUp: true, lastFailure: 'The connection was closed.' });
      return;
    case 'idle':
      return;
  }
}

/**
 * A reconnect run has timed out. Marked as `lost` — but note the transport is
 * STILL retryING. `gaveUp` is about the COPY, not the behaviour: it means "we
 * have stopped promising you this is about to work".
 */
export function markReconnectStalled(): void {
  if (state.link !== 'reconnecting') return;
  set({ link: 'lost', gaveUp: true, lastFailure: 'The table has not answered.' });
}

function startTicker(): void {
  stopTicker();
  retryStartedAt = Date.now();
  retryTicker = setInterval(() => {
    const ms = Date.now() - retryStartedAt;
    if (state.link === 'reconnecting') {
      if (ms >= LOST_AFTER_MS) markReconnectStalled();
      else set({ retryingMs: ms });
    }
  }, 500);
}

function stopTicker(): void {
  if (retryTicker !== null) {
    clearInterval(retryTicker);
    retryTicker = null;
  }
}

// ─────────────────────────── local interaction mutators ───────────────────────────

/** Clear everything that belongs to a turn in progress. */
export function clearTurnInteraction(): void {
  set({
    placingGroupId: null,
    pickedAreaIds: [],
    refusal: null,
    gerryZoneId: null,
    gerrySourceAreaId: null,
    gerryTargetAreaId: null,
    picker: null,
    trade: null,
powerTarget: null,
    marketModifier: null,
    pendingMarketPower: null,
    toughLovePicks: [],
  });
}

export function beginPlacement(groupId: string): void {
  set({ placingGroupId: groupId, pickedAreaIds: [], refusal: null });
}

export function endPlacement(): void {
  set({ placingGroupId: null, pickedAreaIds: [], refusal: null });
}

export function addPick(areaId: string): void {
  set({ pickedAreaIds: [...state.pickedAreaIds, areaId], refusal: null });
}

/**
 * UNDO. §6.1.2 step 5: undoing the last pick re-enables the full legal set, and
 * undoing with one pick left RELEASES THE ZONE LOCK — which is the only way a
 * player can change their mind about which zone. That is not a nicety; without
 * it the first click is the whole decision and the game has no undo at all.
 */
export function removePick(): void {
  const next = state.pickedAreaIds.slice(0, -1);
  set({ pickedAreaIds: next, refusal: null });
}

/** Name the reason a click was refused. Monotonic, so a repeat still re-renders. */
export function setRefusal(text: string): void {
  refusalSeq += 1;
  set({ refusal: { text, at: refusalSeq } });
}

export function clearRefusal(): void {
  if (state.refusal === null) return;
  set({ refusal: null });
}

export function openGerry(zoneId: ZoneID): void {
  set({
    gerryZoneId: zoneId,
    gerrySourceAreaId: null,
    gerryTargetAreaId: null,
    refusal: null,
  });
}

export function setGerrySource(areaId: string): void {
  set({ gerrySourceAreaId: areaId, gerryTargetAreaId: null, refusal: null });
}

export function setGerryTarget(areaId: string): void {
  set({ gerryTargetAreaId: areaId });
}

export function endGerry(): void {
  set({ gerryZoneId: null, gerrySourceAreaId: null, gerryTargetAreaId: null });
}

export function openPicker(picker: PickerDraft): void {
  set({ picker });
}

export function setPickerPick(pick: Readonly<Record<string, number>>): void {
  if (state.picker === null) return;
  set({ picker: { ...state.picker, pick } });
}

export function closePicker(): void {
  set({ picker: null });
}

export function openTrade(withPlayer: PlayerID): void {
  set({ trade: { with: withPlayer, give: {}, receive: {} } });
}

export function setTradeGive(give: Delta): void {
  if (state.trade === null) return;
  set({ trade: { ...state.trade, give } });
}

export function setTradeReceive(receive: Delta): void {
  if (state.trade === null) return;
  set({ trade: { ...state.trade, receive } });
}

export function closeTrade(): void {
  set({ trade: null });
}

/**
 * Begin targeting with a power.
 *
 * Resets the area picks, because a power that needs slots and a stale pick from a
 * previous one would silently target the wrong voter. `clearPowerTarget` is what
 * a player gets from CANCEL, and the two leave the store in the same state.
 */
export function setPowerTarget(flow: PowerFlow): void {
  set({ powerTarget: flow, pickedAreaIds: [], refusal: null });
}

export function clearPowerTarget(): void {
  if (state.powerTarget === null) return;
  set({ powerTarget: null, pickedAreaIds: [], refusal: null });
}

/** Arm a market modifier against a slot, or replace the one already armed there. */
export function setMarketModifier(modifier: MarketModifier): void {
  set({ marketModifier: modifier });
}

/** Used when the armed slot leaves the market — a buy, or another player's turn. */
export function clearMarketModifier(): void {
  if (state.marketModifier === null) return;
  set({ marketModifier: null });
}

/** Open the "which card do you spend this on" chooser. */
export function setMarketPower(power: MarketPower): void {
  set({ pendingMarketPower: power, marketModifier: null, refusal: null });
}

export function clearMarketPower(): void {
  if (state.pendingMarketPower === null) return;
  set({ pendingMarketPower: null });
}

export function addToughLovePick(areaId: string): void {
  set({ toughLovePicks: [...state.toughLovePicks, areaId], refusal: null });
}

export function removeToughLovePick(): void {
  set({ toughLovePicks: state.toughLovePicks.slice(0, -1) });
}

export function clearToughLove(): void {
  set({ toughLovePicks: [] });
}

// ─────────────────────────── React binding ───────────────────────────

export function useApp(): AppState {
  return useSyncExternalStore(subscribeApp, getAppState, getAppState);
}
