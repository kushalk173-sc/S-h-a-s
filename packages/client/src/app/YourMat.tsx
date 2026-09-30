/**
 * Your mat: the one region a player must always be able to see.
 *
 * §9.5 is the reason this file exists as a single panel: "Never let the board
 * consume the viewport such that the player's own mat is off-screen. The player
 * cannot deliberate without their own resources, cap, manifesto, and pending
 * groups." So this is the second column of the shell grid at every breakpoint
 * above 900px, and a tab below it (§5.13) — never a scroll-away afterthought.
 *
 * FIVE REGIONS, TOP TO BOTTOM, PER §5.4:
 *   1. Resource strip + the SINGLE combined cap meter
 *   2. Manifesto strip (four Ideologue cells with L3/L5 chips)
 *   3. Pending voter groups
 *   4. Powers tray
 *   5. END TURN
 *
 * Plus the HQ market strip, which is a separate panel in the same column.
 *
 * THE CAP METER IS ONE METER, NOT FOUR. `RULES.resourceCap` is a COMBINED cap
 * and `rules.ts` says so in as many words: "the rulebook says you must choose
 * what to discard, which only makes sense for a combined cap". Four meters would
 * assert four caps that do not exist, and a player planning against them would be
 * planning against a rule that is not in the book.
 *
 * READ-ONLY MODE. Spectators and other players' turns render this same component
 * with `readonly`, and the difference is the ABSENCE of controls — no SEAL
 * frame, no seat chip, no button (§5.11). The absence is the signal, so there
 * is deliberately no "spectating" prop driving a greyed-out look.
 */

import type { ClientState, PlayerID, Pool } from '@shasn/engine';

import {
  RESOURCE_ORDER,
  UI_RULES,
  manifestoCells,
  poolTotal,
  freeSlotsIn,
} from './derive.ts';
import type { PendingVoters } from '@shasn/engine';
import type { Link } from './store.ts';

export type YourMatProps = {
  readonly state: ClientState;
  readonly you: PlayerID;
  readonly pending: readonly PendingVoters[];
  /** The group currently being placed, if any. */
  readonly placingGroupId: string | null;
  /** How many slots are picked for that group. */
  readonly pickedCount: number;
  readonly isMyTurn: boolean;
  readonly link: Link;
  /**
   * `false` for a spectator and for other players' turns. It controls the
   * ABSENCE of controls, which §5.11 makes the signal for "you are watching" —
   * there is no greyed-out "spectator" styling, because absence is the treatment.
   */
  readonly showControls: boolean;
  /** The ONE region allowed a `SEAL` frame at a time (§5.0). */
  readonly framed: boolean;
  readonly onSelectGroup: (groupId: string) => void;
  readonly onBuyMarket: (index: number) => void;
  readonly onRedraw: () => void;
  readonly onGerry: () => void;
  readonly onPower: (power: string) => void;
  readonly onEndTurn: () => void;
  /**
   * Open the trade composer. §5.7 is a two-party screen, so the mat needs one
   * button per OTHER player rather than a "trade" command that opens a picker —
   * a player proposing to nobody is not a state the game has.
   */
  readonly onTradeWith: (player: PlayerID) => void;
  /** Buy the top Conspiracy Card. The cost is printed on its back, so it is public. */
  readonly onBuyConspiracy: () => void;
  /** Which player is holding an armed market modifier, if any. Shown, not hidden. */
  readonly armedSlot: number | null;
};

/** Resource strip + the single combined cap meter. */
export function ResourceStrip({ pool, showMeter = true }: { pool: Pool; showMeter?: boolean }) {
  const total = poolTotal(pool);
  const overAtTen = total >= UI_RULES.resourceCap - 2;
  return (
    <div>
      <div className="res">
        {RESOURCE_ORDER.map((r) => (
          <div key={r} className="res__cell">
            <span className="res__num">{pool[r]}</span>
            <span className="res__name">{r}</span>
          </div>
        ))}
      </div>
      {showMeter ? (
        <>
          <div
            className="meter"
            role="meter"
            aria-valuenow={total}
            aria-valuemin={0}
            aria-valuemax={UI_RULES.resourceCap}
            aria-label={`Resources held against the cap of ${UI_RULES.resourceCap}`}
          >
            <div
              className={`meter__fill ${overAtTen ? 'meter__fill--warn' : ''}`}
              style={{ width: `${Math.min(100, (total / UI_RULES.resourceCap) * 100)}%` }}
            />
          </div>
          <p className="meter__caption">
            <span>
              {total}/{UI_RULES.resourceCap} held
            </span>
            <span>
              {/* A warning, not a block: the discard is only FORCED on crossing
                  12, so the meter says so rather than refusing to move. */}
              {overAtTen ? 'Over cap after your next gain — you must discard' : 'Cap 12 combined'}
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Four Ideologue cells, with the unlock chips and the passive-bonus forecast. */
export function ManifestoStrip({ state, you }: { state: ClientState; you: PlayerID }) {
  const p = state.players[you];
  if (p === undefined) return null;
  const cells = manifestoCells(p);
  return (
    <div className="mani">
      {cells.map((c) => (
        <div key={c.ideologue} className="mani__cell" data-level={c.level ?? 'none'}>
          <span className="mani__count">{c.count}</span>
          <span className="mani__name">{c.resource}</span>
          {c.level !== null ? (
            <span className={`chip chip--${c.level === 'L3' ? 'l3' : 'l5'}`}>{c.level}</span>
          ) : (
            // The forecast. §5.4 calls this "the main strategic read on the
            // mat": it is what a player looks at to decide what to answer.
            <span className="mani__name">+1 in {c.cardsToBonus}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** The pending voter groups. §6.1.1: a chip each, with the ONE ZONE badge. */
export function PendingGroups({
  groups,
  placingGroupId,
  pickedCount,
  disabled,
  onSelect,
}: {
  groups: readonly PendingVoters[];
  placingGroupId: string | null;
  pickedCount: number;
  disabled: boolean;
  onSelect: (groupId: string) => void;
}) {
  if (groups.length === 0) {
    return <p className="panel__note panel__note--quiet">No voters waiting to be placed.</p>;
  }
  return (
    <div className="col">
      <div className="groups">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`btn group ${g.id === placingGroupId ? 'group--active' : ''}`}
            onClick={() => onSelect(g.id)}
            disabled={disabled}
            aria-pressed={g.id === placingGroupId}
            data-testid="pending-group"
          >
            <span className="group__count">◈ {g.count}</span>
            <span className="group__source">{g.source}</span>
            {g.sameZone ? <span className="chip chip--positive">ONE ZONE</span> : null}
          </button>
        ))}
      </div>
      {groups.length > 1 ? (
        <p className="panel__note">
          {groups.length} groups left to place — the tray empties at the end of your turn.
        </p>
      ) : null}
      {placingGroupId !== null ? (
        <p className="panel__note" data-testid="group-progress">
          {pickedCount} picked for this group.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The powers tray. §5.4: locked powers are a hatch-filled chip with the
 * requirement LABELLED, not faded (§9.2) — a player needs to know what to aim
 * for, and "Unlocks at 3 Capitalist cards" is the only thing that tells them.
 */
export function PowersTray({
  state,
  you,
  disabled,
  onPower,
}: {
  state: ClientState;
  you: PlayerID;
  disabled: boolean;
  onPower: (power: string) => void;
}) {
  const p = state.players[you];
  if (p === undefined) return null;
  const cells = manifestoCells(p);
  const byIdeologue = new Map(cells.map((c) => [c.ideologue, c]));

  const rows: { id: string; name: string; need: string; unlocked: boolean; uses: number; max: number }[] = [
    {
      id: 'prospecting',
      name: 'Prospecting',
      need: 'Capitalist 3',
      unlocked: (byIdeologue.get('capitalist')?.count ?? 0) >= UI_RULES.level3,
      uses: p.powerUses.prospecting,
      max: UI_RULES.prospectingPerTurn,
    },
    {
      id: 'land-grab',
      name: 'Land Grab',
      need: 'Capitalist 5',
      unlocked: (byIdeologue.get('capitalist')?.count ?? 0) >= UI_RULES.level5,
      uses: p.powerUses.landGrab,
      max: UI_RULES.landGrabPerTurn,
    },
    {
      id: 'donations',
      name: 'Donations',
      need: 'Supremo 3',
      unlocked: (byIdeologue.get('supremo')?.count ?? 0) >= UI_RULES.level3,
      uses: p.powerUses.donations,
      max: UI_RULES.donationsPerTurn,
    },
    {
      id: 'payback',
      name: 'Payback',
      need: 'Supremo 5',
      unlocked: (byIdeologue.get('supremo')?.count ?? 0) >= UI_RULES.level5,
      uses: p.powerUses.payback,
      max: UI_RULES.paybackPerTurn,
    },
    {
      id: 'going-viral',
      name: 'Going Viral',
      need: 'Showstopper 3',
      unlocked: (byIdeologue.get('showstopper')?.count ?? 0) >= UI_RULES.level3,
      uses: p.powerUses.goingViral,
      max: UI_RULES.goingViralPerTurn,
    },
    {
      id: 'helping-hands',
      name: 'Helping Hands',
      need: 'Idealist 3',
      unlocked: (byIdeologue.get('idealist')?.count ?? 0) >= UI_RULES.level3,
      uses: p.powerUses.helpingHands,
      max: UI_RULES.helpingHandsPerTurn,
    },
    {
      id: 'tough-love',
      name: 'Tough Love',
      need: 'Idealist 5',
      unlocked: (byIdeologue.get('idealist')?.count ?? 0) >= UI_RULES.level5,
      uses: p.powerUses.toughLove,
      max: UI_RULES.toughLovePerTurn,
    },
  ];

  return (
    <div className="powers">
      {rows.map((r) => {
        const left = r.unlocked ? Math.max(0, r.max - r.uses) : 0;
        return (
          <button
            key={r.id}
            type="button"
            className={`btn btn--sm power ${r.unlocked ? '' : 'power--locked'}`}
            disabled={disabled || !r.unlocked || left <= 0}
            aria-disabled={disabled || !r.unlocked || left <= 0}
            onClick={() => onPower(r.id)}
            data-testid={`power-${r.id}`}
          >
            <span>{r.name}</span>
            <span className="power__uses">
              {r.unlocked
                ? left <= 0
                  ? 'USED — resets next turn'
                  : `${left} of ${r.max} left`
                : `Unlocks at ${r.need}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The HQ market. Always exactly three slots (§5.4, `RULES.marketSize`). */
export function MarketStrip({
  state,
  you,
  disabled,
  onBuy,
}: {
  state: ClientState;
  you: PlayerID;
  disabled: boolean;
  onBuy: (index: number) => void;
}) {
  const p = state.players[you];
  if (p === undefined) return null;
  return (
    <div className="market" data-testid="market">
      {state.market.map((slot, i) => {
        const afford = RESOURCE_ORDER.every((r) => (slot.cost[r] ?? 0) <= p.resources[r]);
        const miss = RESOURCE_ORDER.filter((r) => (slot.cost[r] ?? 0) > p.resources[r]).map(
          (r) => `${slot.cost[r]! - p.resources[r]} ${r} short`,
        );
        return (
          <button
            key={`${slot.cardId}-${i}`}
            type="button"
            className={`mkt ${afford ? '' : 'mkt--unavail'}`}
            disabled={disabled || !afford}
            aria-disabled={disabled || !afford}
            onClick={() => onBuy(i)}
            data-testid="market-card"
          >
            <span className="mkt__cost">
              {RESOURCE_ORDER.filter((r) => (slot.cost[r] ?? 0) > 0)
                .map((r) => `${slot.cost[r]} ${r[0]!.toUpperCase()}`)
                .join(' · ') || 'free'}
            </span>
            <span className="mkt__voters">◈ {slot.voters}</span>
            {/* §9.2: the shortfall is stated, next to the control, in a colour
                that is still readable, so the player can plan around it. */}
            {miss.length > 0 ? <span className="mkt__short">{miss.join(' · ')}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The whole mat, framed or not. Framing is the ONE `SEAL` region at a time. */
export function YourMat(props: YourMatProps) {
  const { state, you, framed, showControls } = props;
  const me = state.players[you];
  if (me === undefined) return null;
  const actionable = showControls && props.isMyTurn && props.link === 'live';

  return (
    <section
      className={`panel ${framed ? 'panel--framed' : ''}`}
      aria-label={showControls ? 'Your mat' : `${me.name}'s mat, read only`}
      data-testid="your-mat"
    >
      <h2 className="panel__title">
        {showControls ? 'YOUR MAT' : `${me.name.toUpperCase()}'S MAT — READ ONLY`}
      </h2>

      <ResourceStrip pool={me.resources} />

      <h3 className="panel__title" style={{ marginTop: 'var(--sp-3)' }}>
        MANIFESTO
      </h3>
      <ManifestoStrip state={state} you={you} />

      <h3 className="panel__title" style={{ marginTop: 'var(--sp-3)' }}>
        PENDING VOTERS
      </h3>
      <PendingGroups
        groups={me.pending}
        placingGroupId={props.placingGroupId}
        pickedCount={props.pickedCount}
        disabled={!actionable}
        onSelect={props.onSelectGroup}
      />

      {showControls ? (
        <>
          <h3 className="panel__title" style={{ marginTop: 'var(--sp-3)' }}>
            POWERS
          </h3>
          <PowersTray state={state} you={you} disabled={!actionable} onPower={props.onPower} />

          <h3 className="panel__title" style={{ marginTop: 'var(--sp-3)' }}>
            HQ MAT · MARKET
          </h3>
          <MarketStrip state={state} you={you} disabled={!actionable} onBuy={props.onBuyMarket} />
          <p className="panel__note panel__note--quiet">
            {state.conspiracyTopCost === null
              ? 'No Conspiracy Card is purchasable.'
              : `Top Conspiracy Card: any ${state.conspiracyTopCost} resources · ${state.conspiracyRemaining} left.`}
          </p>

          {state.conspiracyTopCost === null ? null : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={props.onBuyConspiracy}
              disabled={!actionable}
              aria-disabled={!actionable}
              data-testid="buy-conspiracy"
            >
              BUY THE TOP CONSPIRACY CARD — ANY {state.conspiracyTopCost}
            </button>
          )}

          {/* §5.7: a trade is with a NAMED person. One button per opponent, and a
              spectator or a solo player gets the reason rather than no buttons. */}
          {state.turnOrder.filter((id) => id !== you).length === 0 ? null : (
            <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
              <span className="field__label">TRADE</span>
              {state.turnOrder
                .filter((id) => id !== you)
                .map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="btn btn--sm"
                    onClick={() => props.onTradeWith(id)}
                    disabled={!actionable}
                    aria-disabled={!actionable}
                    data-testid="trade-with"
                  >
                    {state.players[id]?.name ?? '—'}
                  </button>
                ))}
            </div>
          )}

          {props.armedSlot === null ? null : (
            <p className="panel__note" data-testid="armed-modifier">
              A power is armed on market card {props.armedSlot + 1}. Buy that card to spend it, or
              press the power again to cancel.
            </p>
          )}

          <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
            <button
              type="button"
              className="btn"
              onClick={props.onGerry}
              disabled={!actionable}
              data-testid="enter-gerry"
            >
              GERRYMANDER
            </button>
            <button
              type="button"
              className="btn"
              onClick={props.onRedraw}
              disabled={!actionable}
              data-testid="open-redraw"
            >
              REDRAW — {UI_RULES.redrawCost} RESOURCES
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Free-slot counts per zone, for the placement bar's arithmetic strip. */
export function zoneFreeSlots(state: ClientState): readonly { id: string; name: string; free: number }[] {
  return state.zones.map((z) => ({ id: z.id, name: z.name, free: freeSlotsIn(state, z.id) }));
}
