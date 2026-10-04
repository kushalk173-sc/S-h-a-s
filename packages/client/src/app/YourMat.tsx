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
  IDEOLOGUE_NAME,
  effectiveCap,
  manifestoCells,
  marketLockout,
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
  /**
   * WHY every control on this mat is dead, or `null` when they are live.
   *
   * Four causes, one appearance, and the player cannot tell them apart — see the
   * `YourMat` body. Supplied by `GameScreen` because it alone knows all four: this
   * prop's own `link` and `isMyTurn` are two of them and the response window is the
   * third, which is only visible above this component.
   */
  readonly inertReason: string | null;
  /** The ONE region allowed a `SEAL` frame at a time (§5.0). */
  readonly framed: boolean;
  readonly onSelectGroup: (groupId: string) => void;
  /**
   * GERRYMANDER only. There is deliberately no `onRedraw` here any more: the redraw
   * is legal only while a card is pending, which is precisely when this column is
   * behind `AnswerScreen`'s full-viewport takeover, so a second control for it could
   * only ever be a duplicate of the one on that screen. See the GERRYMANDER row.
   */
  readonly onGerry: () => void;
  readonly onPower: (power: string) => void;
  readonly onEndTurn: () => void;
  /**
   * Open the trade composer. §5.7 is a two-party screen, so the mat needs one
   * button per OTHER player rather than a "trade" command that opens a picker —
   * a player proposing to nobody is not a state the game has.
   */
  readonly onTradeWith: (player: PlayerID) => void;
};

/**
 * Resource strip + the single combined cap meter.
 *
 * `cap` is the player's EFFECTIVE cap, from `effectiveCap` — not the printed
 * `UI_RULES.resourceCap`. Under THE BIG FREEZE those differ, and every number this
 * meter renders is wrong if the printed one is used: the ceiling, the fill
 * fraction, the warning threshold and the caption all move together. It defaults
 * to the printed cap so a caller with no player in hand is still correct rather
 * than undefined.
 */
export function ResourceStrip({
  pool,
  cap = UI_RULES.resourceCap,
  showMeter = true,
}: {
  readonly pool: Pool;
  readonly cap?: number;
  readonly showMeter?: boolean;
}) {
  const total = poolTotal(pool);
  // The warning fires two resources from the CEILING, because the discard is only
  // forced on crossing it — under a reduced cap that threshold moves down with it,
  // which is the whole point: at a cap of 6 a player on 4 is already one gain from
  // being asked to discard.
  const reduced = cap < UI_RULES.resourceCap;
  const overSoon = total >= cap - 2;
  /*
   * `12/12 held` IS NOT A NEUTRAL FRACTION, and reading it as one is the endgame
   * failure this caption exists to prevent.
   *
   * A player holding `0 funds 0 clout 12 media 12 trust` at a cap of 12 is FULL, and
   * "full" here does not mean "well stocked": 10 of the 18 Voter Cards cost Funds
   * and 7 cost Clout, so a pool of Media and Trust cannot buy ANY of them, and the
   * next resource taken comes straight back as a discard. A tester read that mat as
   * healthy and as a lock at the same time, because the only words on it were a
   * fraction and a threat.
   *
   * So the three states get three sentences, and the AT-cap one says the true thing
   * rather than the reassuring one: you are full, and full is a constraint. It
   * deliberately does NOT claim to know why nothing is affordable — the KIND of
   * resources is not on this widget, and the market panel is where the player's eye
   * goes when a purchase is what they wanted. `derive.ts:marketLockout` is that
   * sentence.
   */
  const caption = reduced
    ? `Held to ${cap} by a card, not ${UI_RULES.resourceCap}`
    : total > cap
      ? `OVER your cap of ${cap} — discard ${total - cap} down to it`
      : total === cap
        ? `AT your cap of ${cap} — full; the next resource you take comes back as a discard`
        : overSoon
          ? `Over your cap of ${cap} after your next gain — you must discard`
          : `Cap ${cap} combined`;
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
            aria-valuemax={cap}
            aria-label={`Resources held against the cap of ${cap}`}
          >
            <div
              className={`meter__fill ${overSoon ? 'meter__fill--warn' : ''}`}
              style={{ width: `${Math.min(100, (total / cap) * 100)}%` }}
            />
          </div>
          <p className="meter__caption" data-testid="meter-caption">
            <span>
              {total}/{cap} held
            </span>
            <span>{caption}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * THE MANIFESTO STRIP, AND WHAT THE BIG NUMBER IS.
 *
 * ## CONFIRMED, AND THE TESTER'S READING WAS WRONG IN OUR FAVOUR
 *
 * Reported: "`MANIFESTO` shows 54 under a pool of 12, and nobody could work out what
 * it is. A tester concluded the big number is the resource holding, not manifesto
 * progress."
 *
 * `derive.ts:manifestoCells` reads `player.manifesto.filter((i) => i === ideologue)
 * .length` — the number of **Ideology Cards of that Ideologue in your hand**. It is
 * NOT a resource holding, and it cannot be: `54` against a cap of 12 is a card count,
 * and the resource strip four lines above prints the holdings in a different font at
 * a different size with a different name. Both numbers were on screen and both were
 * correct.
 *
 * ## BUT A CORRECT NUMBER WITH NO NOUN IS A LIE BY OMISSION, AND THIS ONE WAS
 *
 * The cell rendered `23` · `funds` · `L5`. Put under the heading `MANIFESTO`, on a mat
 * whose resource strip also prints a funds number, that reads as **"23 funds"** — and
 * a tester with the DOM in front of them read it that way. They were given no way to
 * tell, because the noun after the numeral was a RESOURCE (correct for the bonus,
 * which pays `+1 Funds`, and wrong for the count, which counts Capitalist cards).
 *
 * So the two nouns are separated and both are spoken:
 *
 *   - the count is labelled `cards`, and the cell is named after the **Ideologue**,
 *     because Capitalist is what the 23 are;
 *   - the RESOURCE moves to the bonus line, where it is the thing being paid, and it
 *     is stated as what it is: `+1 funds per 3 cards` — the actual p28 rule, which
 *     until now was a bare `+1 in 2` counting down to an unnamed threshold.
 *
 * The second half is the part that earns the first: a player aiming at L3 needs to
 * know that three Capitalist cards is the price and that each one pays a Fund, and
 * `23 funds L5` told them neither.
 */
export function ManifestoStrip({ state, you }: { state: ClientState; you: PlayerID }) {
  const p = state.players[you];
  if (p === undefined) return null;
  const cells = manifestoCells(p);
  return (
    <div className="mani">
      {cells.map((c) => (
        <div
          key={c.ideologue}
          className="mani__cell"
          data-level={c.level ?? 'none'}
          /* The whole cell, in one accessible name. §8.5 parity: a screen-reader
             user must not have to reassemble "23", "cards", "Capitalist", "L5" from
             four separate nodes to learn what the number means. */
          aria-label={`${c.count} ${IDEOLOGUE_NAME[c.ideologue]} Ideology Cards. ${
            c.level === null
              ? `${c.toNext} more unlocks a power and pays ${c.bonusPerTurn} extra ${c.resource} per turn.`
              : `Level ${c.level} reached. Pays ${c.bonusPerTurn} extra ${c.resource} per turn.`
          }`}
          data-testid={`manifesto-${c.ideologue}`}
        >
          <span className="mani__count">
            {c.count}
            {/* THE NOUN, VISIBLE. `cards` is 11px of text on a cell whose numeral is
                24px, so it costs no vertical space, and it is the whole difference
                between "23 funds" and "23 cards". PLURALISED, because a cell reading
                "1 cards" is the same class of error as one reading "23 funds": a
                number attached to a noun it does not agree with, on the strip whose
                whole job is to be believed. A screenshot caught it. */}
            <span className="mani__noun"> {c.count === 1 ? 'card' : 'cards'}</span>
          </span>
          {/* THE IDEOLOGUE, not the resource: the cards ARE Capitalist cards. Its own
              line — `display: block` — because it and the bonus line are two
              different facts, and rendered as two inline spans they ran together into
              "CAPITALIST2 MORE · +1 FUNDS PER 2". Also caught by a screenshot.

              The explicit `{' '}` between the spans is not decoration either: `display:
              block` is a VISUAL break, so `textContent` — which is what a screen
              reader concatenates, and what this project's own harness reads out of
              the DOM — still got "1cardCapitalist2 more". A separator that only exists
              in the layout is not a separator for anything that reads the text. */}
          <span className="mani__ideo">{' '}
            {IDEOLOGUE_NAME[c.ideologue]}
          </span>
          {c.level !== null ? (
            <span className={`chip chip--${c.level === 'L3' ? 'l3' : 'l5'}`}> {c.level}</span>
          ) : null}
          {/* §5.4 calls this "the main strategic read on the mat": it is what a
              player looks at to decide what to answer, so it is the p28 rule in words
              rather than a countdown to an unnamed threshold. INDEPENDENT of the chip
              above, not its alternative — a cell at L5 still pays `+2 funds per turn`,
              and folding this into the chip's `else` would have shown the forecast
              only until the unlock and never again, which is exactly when it stops
              being a forecast. */}
          <span className="mani__bonus">
            {' '}
            {c.level === null
              ? `${c.toNext} more · +1 ${c.resource} per ${UI_RULES.passiveBonusPer}`
              : `+${c.bonusPerTurn} ${c.resource} per turn`}
          </span>
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
  disabledReason,
  onPower,
}: {
  state: ClientState;
  you: PlayerID;
  disabled: boolean;
  /**
   * WHY the tray is inert, or `null` when it is live — the same §9.2 contract as
   * `MarketPanelProps.disabledReason`, and for the same reason.
   *
   * It matters MORE here, because the reported symptom was "powers were unlocked,
   * had uses left, and were untappable", which is a player describing a tray that
   * says `3 of 3 left` and refuses every press. A tray in that state is
   * indistinguishable from a bug in the unlock, and the player cannot see which
   * powers are theirs, which are spent, and which are simply not their turn.
   */
  disabledReason: string | null;
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
      {disabled && disabledReason !== null ? (
        <p className="panel__note panel__note--quiet" data-testid="powers-inert">
          {disabledReason}
        </p>
      ) : null}
      {rows.map((r) => {
        const left = r.unlocked ? Math.max(0, r.max - r.uses) : 0;
        /*
         * THE LOCKED AND SPENT STATES GET DIFFERENT WORDS, and both are visible
         * reasons rather than a faded button. A locked power names the requirement
         * ("Unlocks at Capitalist 5") because it is a target to aim at; a spent one
         * names when it returns. Neither is `disabled` for want of the player's turn,
         * and the tray's own `disabledReason` above covers that case — so a player
         * can always tell "not mine yet" from "not now" from "not ever again".
         */
        const why = !r.unlocked
          ? `Unlocks at ${r.need}`
          : left <= 0
            ? 'USED — resets next turn'
            : `${left} of ${r.max} left`;
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
            <span className="power__uses">{why}</span>
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
  disabledReason,
  onBuy,
}: {
  state: ClientState;
  you: PlayerID;
  disabled: boolean;
  /**
   * WHY the strip is inert, in a sentence, or `null` when it is live.
   *
   * §9.2, and the second half of item 2's defect: the strip used to render three
   * grey-ish buttons on every seat but the active one and say nothing at all. A
   * player watching a card they cannot press has no way to tell "not my turn" from
   * "I cannot afford this" from "the connection is down", and those three have
   * nothing in common — one passes in a moment, one needs resources, one needs a
   * reconnect. The caller knows which, because it is the one that decided.
   */
  disabledReason: string | null;
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
        /*
         * `mkt--unavail` IS THE LOOK OF "YOU CANNOT PRESS THIS", and it used to be
         * gated on `!afford` alone — so a card that was unaffordable looked exactly
         * like a card that was merely someone else's turn. Both are disabled; both
         * now look disabled; and both say which they are.
         */
        const unavailable = disabled || !afford;
        return (
          <button
            key={`${slot.cardId}-${i}`}
            type="button"
            className={`mkt ${unavailable ? 'mkt--unavail' : ''}`}
            disabled={unavailable}
            aria-disabled={unavailable}
            onClick={() => onBuy(i)}
            data-testid="market-card"
          >
            <span className="mkt__cost">
              {RESOURCE_ORDER.filter((r) => (slot.cost[r] ?? 0) > 0)
                .map((r) => `${slot.cost[r]} ${r[0]!.toUpperCase()}`)
                .join(' · ') || 'free'}
            </span>
            <span className="mkt__voters">◈ {slot.voters}</span>
            {/* §9.2: the reason is stated, next to the control, in a colour
                that is still readable, so the player can plan around it. The
                NOT-MY-TURN reason is stated too, for the reason above. */}
            {disabled && disabledReason !== null ? (
              <span className="mkt__short" data-testid="market-inert">
                {disabledReason}
              </span>
            ) : null}
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
  /*
   * WHY THE MAT IS INERT, NAMED ON THE MAT.
   *
   * Four different causes produce the same dead powers tray, the same dead
   * GERRYMANDER button and the same dead market, and a player cannot tell them
   * apart: not your turn (a moment), a card is being answered (this instant), the
   * link is down (a reconnect), or you are not on this seat at all (forever, and
   * nothing is coming). §9.2 is "never a dead control without an adjacent reason",
   * and "not your turn" is both the commonest of them and the one that most looks
   * like a bug — it is what a tester logged as "powers were unlocked, had uses
   * left, and were untappable".
   *
   * COMPUTED BY THE CALLER, not here, because `YourMat` knows only `link` and
   * `isMyTurn` and cannot see the response window — and the window is one of the
   * four. `GameScreen` is the only component that holds all of them.
   */
  const inertReason = actionable ? null : props.inertReason;

  return (
    <section
      className={`panel ${framed ? 'panel--framed' : ''}`}
      aria-label={showControls ? 'Your mat' : `${me.name}'s mat, read only`}
      data-testid="your-mat"
    >
      <h2 className="panel__title">
        {showControls ? 'YOUR MAT' : `${me.name.toUpperCase()}'S MAT — READ ONLY`}
      </h2>

      <ResourceStrip pool={me.resources} cap={effectiveCap(me)} />

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
          <PowersTray
            state={state}
            you={you}
            disabled={!actionable}
            disabledReason={inertReason}
            onPower={props.onPower}
          />

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

          {/*
            THE REDRAW USED TO BE HERE TOO, and it was the wrong place.

            `REDRAW_IDEOLOGY` is legal only while a card is pending — `reduce.ts`
            refuses it with "no card to redraw" otherwise — and a pending card is
            exactly the state in which `AnswerScreen` is a full-viewport takeover
            over this whole column. So this button was rendered, enabled, and
            unreachable at the only moment it could do anything: the audit measured
            `open-redraw disabled=false` and `redraw-offer disabled=false` on one
            screen, both labelled "REDRAW — 4 RESOURCES", both present, one of them
            behind a z-index 20 scrim.

            Two identically labelled controls for one action is a player with two
            keys and no way to tell which is which, and the copy that explains what
            the redraw now means — that both payouts are printed, so you are buying
            a different question — only makes sense next to the two payouts. So the
            control that survives is the one in `AnswerScreen`, and this row is left
            with GERRYMANDER alone rather than padded with a second way to do
            something already on screen.
          */}
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

export type MarketPanelProps = {
  readonly state: ClientState;
  readonly you: PlayerID;
  readonly disabled: boolean;
  /**
   * WHY `disabled`, in a sentence — or `null` when the panel is live.
   *
   * The caller is the only party that knows, because the caller is the one that
   * decided: `GameScreen` combines a response window, the turn, and the link.
   * Passed as a string rather than a boolean set so the three cases stay
   * distinguishable at the surface, which is the whole of §9.2.
   */
  readonly disabledReason: string | null;
  readonly onBuy: (index: number) => void;
  readonly onBuyConspiracy: () => void;
  /**
   * The server's list of Conspiracy Cards this player may legally play, or `[]`.
   *
   * It arrives here already read out of the payload and validated, and it is the
   * ONLY thing that may decide whether the PLAY button is rendered. There is no
   * local hand count to test — this client is not told what it holds (D25,
   * ARCHITECTURE §8.1.1) — so a button gated on anything else would either lie about
   * the player's cards or stay dead forever.
   */
  readonly playableConspiracies: readonly { readonly id: string }[];
  readonly onPlayConspiracy: () => void;
  /** Which market slot holds an armed power, if any. Shown, not hidden. */
  readonly armedSlot: number | null;
};

/**
 * THE HQ MARKET, AS ITS OWN PANEL.
 *
 * This file's header has always said the market is "a separate panel in the same
 * column", and §5.13 requires it to be its own tab beside Board, Mat and Log. It
 * used to be a `<h3>` section inside `YourMat`, which made that tab unimplementable:
 * the phone tab bar had four buttons and the shell had only THREE tabpanels
 * (`board`, `mat`, `log`), so pressing MARKET matched no panel, every panel went
 * `display:none`, and the player was looking at a blank screen with a working tab
 * bar. Found by clicking all four tabs in a browser.
 *
 * Two panels, one per concern, is also §9.5's shape: deliberating over your
 * resources and deciding which Voter Card to buy are different jobs, and putting
 * a 3-slot market strip in the middle of the mat pushed the powers tray below the
 * fold on a short desktop window.
 */
export function MarketPanel({
  state,
  you,
  disabled,
  disabledReason,
  onBuy,
  onBuyConspiracy,
  playableConspiracies,
  onPlayConspiracy,
  armedSlot,
}: MarketPanelProps) {
  const me = state.players[you];
  if (me === undefined) return null;
  const canPlay = playableConspiracies.length > 0;
  /*
   * THE LOCKOUT SENTENCE, AND IT LIVES HERE BECAUSE THIS IS WHERE THE PLAYER LOOKS.
   *
   * `0 funds 0 clout 12 media 12 trust` reads on the mat as `12/12 held` — full, and
   * indistinguishable from winning. 32-44 free slots on the board, two of three
   * seats unable to act, and nothing anywhere saying why. The card the player wants
   * is three feet from this sentence, so the sentence goes here, and it names the
   * cheapest card and the exact shortfall rather than restating "you cannot buy
   * anything" — which is the shrug that produced the report. See
   * `derive.ts:marketLockout` for why it is a hard lock and not a bad hand.
   */
  const lockout = marketLockout(state, you);
  return (
    <section className="panel" aria-label="HQ market" data-testid="market-panel">
      <h2 className="panel__title">HQ MAT · MARKET</h2>
      <MarketStrip
        state={state}
        you={you}
        disabled={disabled}
        disabledReason={disabledReason}
        onBuy={onBuy}
      />
      {lockout === null ? null : (
        <p
          className="panel__note market__lockout"
          role="status"
          data-testid="market-lockout"
        >
          {lockout.sentence}
        </p>
      )}
      <p className="panel__note panel__note--quiet">
        {state.conspiracyTopCost === null
          ? 'No Conspiracy Card is purchasable.'
          : `Top Conspiracy Card: any ${state.conspiracyTopCost} resources · ${state.conspiracyRemaining} left.`}
      </p>
      {state.conspiracyTopCost === null ? null : (
        <button
          type="button"
          className="btn btn--sm"
          onClick={onBuyConspiracy}
          disabled={disabled}
          aria-disabled={disabled}
          data-testid="buy-conspiracy"
        >
          BUY THE TOP CONSPIRACY CARD — ANY {state.conspiracyTopCost}
        </button>
      )}
      {/*
        THE PLAY BUTTON EXISTS ONLY WHEN THE SERVER SAYS SO.

        Two things it deliberately does NOT do. It does not render the count of
        cards in hand — this client is not told that, and inventing a number from
        the deck sizes would be a lie the player could act on. And it does not
        survive a reconnect on its own: `match:state` is the only source, so a
        reconnect that has not landed yet shows no button, which is the correct
        answer for "I do not know what I may play".

        `disabled` is passed straight through rather than ANDed with the turn. The
        server already scoped the list — during the `answer` window it is non-empty
        for a player who is NOT on move, and gating that button on `isMyTurn` would
        make a legal play unreachable.
      */}
      {canPlay ? (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={onPlayConspiracy}
          disabled={disabled}
          aria-disabled={disabled}
          data-testid="play-conspiracy"
        >
          PLAY A CONSPIRACY CARD — {playableConspiracies.length}{' '}
          {playableConspiracies.length === 1 ? 'CARD' : 'CARDS'} READY
        </button>
      ) : null}
      {armedSlot === null ? null : (
        <p className="panel__note" data-testid="armed-modifier">
          A power is armed on market card {armedSlot + 1}. Buy that card to spend it, or press the
          power again to cancel.
        </p>
      )}
    </section>
  );
}
