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

import type { ClientState, Delta, PlayerID, Pool, Resource } from '@shasn/engine';

import {
  RESOURCE_ORDER,
  UI_RULES,
  IDEOLOGUE_NAME,
  effectiveCap,
  manifestoCells,
  marketCharge,
  marketLockout,
  poolTotal,
  rightsZones,
  freeSlotsIn,
  standOf,
  strandedSentence,
  cardStranded,
  surchargeOf,
} from './derive.ts';
import { ResourceGlyph } from './ResourceGlyph.tsx';
import type { PendingVoters } from '@shasn/engine';
// TYPE-ONLY, and from `./derive.ts` rather than value-imported: it is the return
// shape of the `manifestoCells` call below, and naming it is what lets `cellName`
// and `trackName` be plain functions.
import type { ManifestoCell } from './derive.ts';
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
  /*
    NO `onEndTurn`, AND ITS REMOVAL IS THE THIRD HALF OF A BUG.

    §5.4 lists END TURN as mat region 5, and this prop has been here ever since the
    mat was split into its own panel — and it was never rendered. So for the whole
    time it existed, the type said a control was wired and the component drew nothing.

    Together with `.endturn-dock` being `display: none` outside the phone query and
    the "desktop" END TURN in `GameScreen` being an unsatisfiable condition
    (`isMyTurn && … && !isMyTurn`), that is three controls' worth of intent and zero
    live controls: a desktop player could not end a turn at all.

    END TURN now lives in ONE place — the fixed dock in `GameScreen`, on screen at
    every width — and this prop is gone rather than left as a second, unwired copy.
    A prop nobody renders is how the next reader concludes the control exists.
  */
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
      ? `Over your cap of ${cap} — discard ${total - cap} to get back to it`
      : total === cap
        ? `At your cap of ${cap} — the next resource you gain comes back as a discard`
        : overSoon
          ? `Over your cap of ${cap} after your next gain — you must discard`
          : `Cap ${cap} combined`;
  return (
    <div>
      <div className="res">
        {RESOURCE_ORDER.map((r) => (
          <div key={r} className="res__cell" data-res={r}>
            <ResourceGlyph resource={r} />
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
/**
 * THE CELL'S ACCESSIBLE NAME, as a FUNCTION rather than an inline template.
 *
 * §8.5 parity: a screen-reader user must not have to reassemble "23", "cards",
 * "Capitalist", "L5" from four separate nodes to learn what the number means.
 *
 * It is hoisted out of the JSX for a reason that is not tidiness. Written inline,
 * this sentence is a template literal nested three deep inside a JSX attribute —
 * ternaries inside `${}`, inside another ternary, inside `${}` — and the failure
 * mode is silent and nonlocal: an unbalanced brace in the innermost branch reports
 * its position tens of lines away, at an unrelated comment, as `Expected "}" but
 * found "funds"`. That is exactly how it presented here, and it cost a bisect to
 * locate. As two functions it is plain TypeScript that fails where it is wrong.
 */
function cellName(c: ManifestoCell): string {
  const more = c.cardsToBonus === 1 ? 'card' : 'cards';
  return [
    `${c.count} ${IDEOLOGUE_NAME[c.ideologue]} Ideology Cards.`,
    c.level === null
      ? `A power unlocks at ${UI_RULES.level3} cards, ${c.toNext} more to go.`
      : `Level ${c.level} reached.`,
    c.bonusPerTurn > 0
      ? `Pays ${c.bonusPerTurn} extra ${c.resource} per turn.`
      : `Pays nothing yet, ${c.cardsToBonus} more ${more} for +1.`,
    `One extra ${c.resource} for every ${UI_RULES.passiveBonusPer} cards.`,
  ].join(' ');
}

/**
 * THE PIP TRACK'S NAME, in words.
 *
 * The track is `role="img"` precisely so its POSITIONS carry the rules — the gap
 * after every second pip IS the `passiveBonusPer` cadence and the notched pip IS
 * `level3` — and a position is invisible to anyone not looking at it. So the
 * thresholds are stated here too, for the same reason `cellName` exists: the
 * visual encoding must not be the only place a threshold is written down.
 */
function trackName(c: ManifestoCell): string {
  const filled = Math.min(c.count, UI_RULES.level5);
  return [
    `${filled} of ${UI_RULES.level5} pip slots filled.`,
    c.level === null
      ? `The power unlocks at the ${UI_RULES.level3}rd card.`
      : 'Power unlocked.',
    `Every pair of pips pays +1.`,
  ].join(' ');
}

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
             four separate nodes to learn what the number means.

             It restates the pip track's thresholds in words, because the track is
             `role="img"` precisely so its POSITIONS carry the rules — and a
             position is invisible to anyone not looking at it. The three facts a
             player needs (how many, what it pays, what is still locked) are all
             present, and the "every N cards" cadence is here because it is the one
             number the track encodes rather than prints. */
          aria-label={cellName(c)}
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
              line — `display: block` — because it and the lines below are different
              facts, and rendered as inline spans they ran together into "CAPITALIST2
              MORE · +1 FUNDS PER 2". Also caught by a screenshot.

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
          {/* THE PROGRESS TRACK. The strip has THREE thresholds — `passiveBonusPer`
              (2), `level3` (3) and `level5` (5) — and all three were prose. `3 MORE
              UNLOCKS A POWER` and `+1 FUNDS PER 2` are two of them, and a player
              reading both had to notice they were on different clocks: a cell at one
              card said the power needed two more AND that the next Fund needed one,
              on adjacent lines with nothing marking which was which. Reported as
              "the UI doesn't feel super intuitive", after a screenshot showed the
              strip being arithmetically true and practically unreadable.

              Pips make it legible without arithmetic: three RULES that never change
              (one per threshold) so the track cannot grow to hide a 23rd card, filled
              to `count`. The gap after every second pip IS the `passiveBonusPer`
              grouping — a player watches a pair fill and knows the `+1` is why —
              and the third pip wears a notch because that is where the power comes
              in. Both facts are now POSITIONS rather than sentences to reconcile.

              Capped at `level5`, which is the last threshold in the rules: past five
              the pip track is full and stops being information, so the overflow is
              carried by the numeral above it, which is unbounded and correct. */}
          <span
            className="mani__track"
            data-ideo={c.ideologue}
            role="img"
            aria-label={trackName(c)}
          >
            {Array.from({ length: UI_RULES.level5 }, (_, i) => {
              const n = i + 1;
              return (
                <span
                  key={n}
                  className="mani__pip"
                  data-filled={n <= c.count}
                  data-threshold={n === UI_RULES.level3 ? 'power' : undefined}
                  data-pair-end={n % UI_RULES.passiveBonusPer === 0 || n === UI_RULES.level5}
                />
              );
            })}
          </span>
          {/* THE INCOME, not the rule. `+1 funds per 2` states a RULE; `+1 funds` states
              what the player actually receives this turn, which is the number they
              are playing for and the only one that survives into a score. Stating the
              cadence here was correct and still wrong-shaped: it made the cell's
              bottom line a formula to apply rather than a quantity to bank, and it
              is what put `3` and `2` next to each other in the first place.

              So the cadence lives in the pip gaps (visual, permanent, unmissable) and
              this line carries the income. At zero it says so plainly, because
              "nothing yet" is itself the strategic read — a player deciding whether
              to chase a third Capitalist needs to know the second card is what pays. */}
          <span className="mani__bonus" data-earning={c.bonusPerTurn > 0}>
            {' '}
            {c.bonusPerTurn > 0
              ? `+${c.bonusPerTurn} ${c.resource} per turn`
              : `+0 ${c.resource} · ${
                  c.cardsToBonus === 1 ? 'next card pays' : `next in ${c.cardsToBonus}`
                }`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The pending voter groups. §6.1.1: a chip each, with the ONE ZONE badge. */
export function PendingGroups({
  state,
  groups,
  placingGroupId,
  pickedCount,
  disabled,
  onSelect,
}: {
  readonly state: ClientState;
  readonly groups: readonly PendingVoters[];
  readonly placingGroupId: string | null;
  readonly pickedCount: number;
  readonly disabled: boolean;
  readonly onSelect: (groupId: string) => void;
}) {
  /*
    A GROUP THAT FITS NOWHERE SAYS SO ON THE CHIP, AT THE MOMENT IT IS DEALT.
    p10 (`rules-reference.md:209-210`): *"If no single zone has enough empty areas
    for a card's voters, all voters from that card are discarded."* The rule has
    always been implemented — `placeableAreas` filters the legal set, `PLACE_VOTERS`
    refuses the split, and the end-of-turn sweep discards the rest — so the voters
    leave correctly and nothing is broken. What was missing is that the player is
    never told, and a player handed three voters with nowhere to put them and never
    told concludes the game is broken.

    It is a CHIP BADGE and not a disabled button. The rule makes the voters vanish,
    not the purchase illegal, and a control that cannot be pressed is §9.10's named
    prohibited case; the sentence beside the chip is the whole fix.
  */
  const strandedSet = new Set(standOf(state).stranded.map((g) => g.groupId));
  if (groups.length === 0) {
    return <p className="panel__note panel__note--quiet">No voters waiting to be placed.</p>;
  }
  const strandedHere = groups.filter((g) => strandedSet.has(g.id));
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
            {strandedSet.has(g.id) ? (
              <span className="chip chip--negative" data-testid="group-stranded">
                NO ROOM ANYWHERE
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {strandedHere.length > 0 ? (
        <p className="panel__note panel__note--warn" data-testid="group-stranded-note">
          {strandedHere.map((g) => strandedSentence(state, g.id) ?? '').join(' ')}
        </p>
      ) : null}
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

  const rows: {
    id: string;
    name: string;
    need: string;
    unlocked: boolean;
    uses: number;
    max: number;
  }[] = [
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
      {(() => {
      const renderRow = (r: (typeof rows)[number]) => {
        const left = r.unlocked ? Math.max(0, r.max - r.uses) : 0;
        /*
         * THE LOCKED AND SPENT STATES GET DIFFERENT WORDS, and both are visible
         * reasons rather than a faded button. A locked power names the requirement
         * ("Unlocks at Capitalist 5") because it is a target to aim at; a spent one
         * names when it returns. Neither is `disabled` for want of the player's turn,
         * and the tray's own `disabledReason` above covers that case — so a player
         * can always tell "not mine yet" from "not now" from "not ever again".
         */
        const [ideo, threshold] = r.need.split(' ') as [string, string];
        const have = byIdeologue.get(ideo.toLowerCase() as ManifestoCell['ideologue'])?.count ?? 0;
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
            data-spent={r.unlocked && left <= 0 ? 'true' : undefined}
            disabled={disabled || !r.unlocked || left <= 0}
            aria-disabled={disabled || !r.unlocked || left <= 0}
            onClick={() => onPower(r.id)}
            data-testid={`power-${r.id}`}
          >
            <span className="power__head">
              <span className="power__name">
                {r.unlocked ? null : <span aria-hidden="true">🔒 </span>}
                {r.name}
              </span>
              <span className="power__uses">
                {why}
                {/* Progress toward a locked power, so "Unlocks at Capitalist 5" is a
                    target with a distance rather than a label. */}
                {r.unlocked ? null : ` · ${Math.min(have, Number(threshold))}/${threshold}`}
              </span>
            </span>
            {/* WHAT IT DOES. The tray used to be seven names — Prospecting, Payback,
                Tough Love — and nothing anywhere in the client said what any of them
                did, so a player could not aim at one or decide to use one. */}
            <span className="power__desc">{POWER_TEXT[r.id]}</span>
          </button>
        );
      };
      /*
        LOCKED POWERS FOLD AWAY. Seven rows, all locked, were the tallest thing on
        the mat for the whole opening of every game. The powers you HAVE stay in
        view; the rest sit behind one line that names the closest one to unlock,
        so the target is still visible without the list.
      */
      const unlocked = rows.filter((r) => r.unlocked);
      const locked = rows.filter((r) => !r.unlocked);
      const distance = (r: (typeof rows)[number]): number => {
        const [ideo, threshold] = r.need.split(' ') as [string, string];
        const have = byIdeologue.get(ideo.toLowerCase() as ManifestoCell['ideologue'])?.count ?? 0;
        return Number(threshold) - have;
      };
      const closest = [...locked].sort((x, y) => distance(x) - distance(y))[0];
      return (
        <>
          {unlocked.length === 0 ? (
            <p className="panel__note panel__note--quiet">No powers unlocked yet.</p>
          ) : (
            unlocked.map(renderRow)
          )}
          {locked.length === 0 ? null : (
            <details className="powers__locked">
              <summary>
                {locked.length} locked power{locked.length === 1 ? '' : 's'}
                {closest === undefined
                  ? ''
                  : ` · closest: ${closest.name}, ${distance(closest)} more ${closest.need.split(' ')[0]} card${distance(closest) === 1 ? '' : 's'}`}
              </summary>
              <div className="powers">{locked.map(renderRow)}</div>
            </details>
          )}
        </>
      );
      })()}
    </div>
  );
}

/** The HQ market. Always exactly three slots (§5.4, `RULES.marketSize`). */
export function MarketStrip({
  state,
  you,
  disabled,
  disabledReason,
  armed,
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
  /**
   * The market power armed on one slot, if any.
   *
   * PRESENT FOR ONE REASON, and it is the reason this component used to refuse a
   * purchase the player could afford. `GameScreen`'s `buyMarketCard` has charged
   * the DISCOUNTED cost ever since Helping Hands was folded into `INFLUENCE`,
   * with a comment saying that checking the undiscounted cost would refuse a legal
   * buy — and this strip checked the UNDISCOUNTED cost to decide whether to render
   * the button live. So arm Helping Hands on a `2 funds · 2 trust` card while
   * holding `1 funds · 3 trust`: the engine would accept the purchase and this
   * strip rendered it dead. A player pressing a card they can afford, and nothing
   * happening, with no reason anywhere.
   *
   * So affordability is computed against the same number the engine will charge,
   * and the waived denominations are shown on the card rather than hidden.
   */
  armed: { readonly slot: number; readonly discounts: readonly Resource[] } | null;
  onBuy: (index: number) => void;
}) {
  const p = state.players[you];
  if (p === undefined) return null;
  return (
    <>
    {/* §9.2: the reason the cards are inert is stated next to them — ONCE. It used
        to be printed inside every card, so a three-card market carried the same
        four-line red paragraph three times over, in columns ~80px wide, and the
        thing a player came to read (the price) was the smallest text on the card. */}
    {disabled && disabledReason !== null ? (
      <p className="market__inert" data-testid="market-inert">
        {disabledReason}
      </p>
    ) : null}
    <div className="market" data-testid="market">
      {state.market.map((slot, i) => {
        /*
          THE COST THIS BUY ACTUALLY CHARGES — `marketCharge`, the one place that
          knows it: the card's printed cost, every Helping Hands denomination armed
          against THIS slot down by one, and then this player's surcharges added in
          Funds. The surcharge is the second half of the silent click; see
          `derive.ts:marketCharge` for the engine lines it mirrors.
        */
        const waived =
          armed !== null && armed.slot === i ? new Set(armed.discounts) : new Set<Resource>();
        const charge = marketCharge(state, you, slot, [...waived]);
        const tax = surchargeOf(state, you);
        const afford = RESOURCE_ORDER.every((r) => (charge[r] ?? 0) <= p.resources[r]);
        const miss = RESOURCE_ORDER.filter((r) => (charge[r] ?? 0) > p.resources[r]).map(
          (r) => `${charge[r]! - p.resources[r]} ${r} short`,
        );
        /*
          `mkt--unavail` IS THE LOOK OF "YOU CANNOT PRESS THIS", and it used to be
          gated on `!afford` alone — so a card that was unaffordable looked exactly
          like a card that was merely someone else's turn. Both are disabled; both
          now look disabled; and both say which they are.
        */
        const unavailable = disabled || !afford;
        /*
          p10's discard, warned about BEFORE the purchase. "If no single zone has
          enough empty areas for a card's voters, all voters from that card are
          discarded" — which makes the voters vanish and NOT the purchase illegal.
          So this is a warning printed on the card and never a disabled button:
          refusing the sale would be a rule the rulebook does not contain, and it
          would be a control that cannot do anything, which §9.10 names.
        */
        const stranded = cardStranded(state, slot.voters);
        return (
          <button
            key={`${slot.cardId}-${i}`}
            type="button"
            className={`mkt ${unavailable ? 'mkt--unavail' : ''} ${disabled ? 'mkt--idle' : ''}`}
            disabled={unavailable}
            aria-disabled={unavailable}
            onClick={() => onBuy(i)}
            data-testid="market-card"
          >
            <span className="mkt__cost" data-testid="market-charge">
              {(() => {
                /*
                 * `2 F · 3 T · +1 F tax` WAS THE SURFACE NOBODY COULD READ.
                 *
                 * Four single letters, and F/C/M/T are the four letters a player is
                 * least likely to hold in order: a card costing `3 M` is Media and
                 * a card costing `3 T` is Trust, and they are one glyph apart with
                 * nothing between them. §5.4 already specified the fix — "four
                 * glyph+numeral pairs in TYPE_MKT_COST" — and it was never built.
                 *
                 * The LETTER STAYS, and it has to: `marketCharge.test.tsx` parses
                 * this string on `/^(\d+) ([FCMT])/` to prove the printed price
                 * equals the charged price, which is the invariant that stops a
                 * waiver being priced one thing and charged another. The glyph is
                 * an `<svg>`, so it contributes nothing to `textContent` and that
                 * invariant is untouched. The letter becomes the *abbreviation of*
                 * an identified token rather than the whole of one.
                 *
                 * The `·` separators stay as literal text between the runs for the
                 * same reason: the test splits on them.
                 */
                /*
                 * FULL NAMES NOW, and the parse still holds. The surface printed
                 * `2 C · 1 M`, and a new player has no way to know C is Clout and
                 * M is Media. `marketCharge.test.tsx` reads `/^(\d+) ([FCMT])/`
                 * per ` · `-separated run, which matches the FIRST LETTER of the
                 * word exactly as it matched the letter, so the printed-equals-
                 * charged invariant is untouched. The separators survive as text
                 * (the test splits on them) and are hidden by CSS, which lays the
                 * runs out one per line.
                 */
                const initial = (r: Resource) => RESOURCE_NAME[r];
                /*
                  THE KEY IS NOT THE RESOURCE, AND THE REASON IS THE TAX.

                  `runs` used to be keyed by `run.res`, which is unique for the
                  printed cost — `RESOURCE_ORDER` holds each of the four once. But
                  the surcharge is denominated in FUNDS (`reduce.ts` adds it to
                  `funds`, and it sums), so it pushed a SECOND run whose `res` is
                  `'funds'`. Any card that cost Funds AND carried a surcharge —
                  `funds` is the first of the four, so most of them — rendered two
                  `<span key="funds">` siblings, and React said so, 225 times
                  across the client suite:

                      Warning: Encountered two children with the same key, `funds`.

                  That is not tidiness. Duplicate keys mean React cannot tell those
                  two elements apart across an update, so anything stateful
                  mounted under them can reattach to the wrong node — and it made
                  the suite unreadable, which is the worse of the two because a
                  gate you cannot read is not a gate.

                  So `runs` carries its own key, and the two families are
                  namespaced: `cost-<res>` for the printed price, `tax-funds` for
                  the surcharge. Uniqueness is by CONSTRUCTION rather than by luck
                  of which denominations a card happens to cost, both are stable
                  across updates, and `res` stays as the data attribute because
                  the tax really does take the Funds ink.
                */
                const runs: { key: string; res: Resource; text: string }[] =
                  RESOURCE_ORDER.filter((r) => (slot.cost[r] ?? 0) > 0).map((r) => {
                    const left = Math.max(0, (slot.cost[r] ?? 0) - (waived.has(r) ? 1 : 0));
                    return {
                      key: `cost-${r}`,
                      res: r,
                      text: waived.has(r)
                        ? left === 0
                          ? `${initial(r)} waived`
                          : `${left} ${initial(r)} (waived)`
                        : `${slot.cost[r]} ${initial(r)}`,
                    };
                  });
                // The surcharge is a Funds tax, so it takes the Funds ink — it is
                // money, and a player reading a price should see which resource
                // the extra is denominated in before they read how much.
                if (tax > 0) runs.push({ key: 'tax-funds', res: 'funds', text: `+${tax} Funds tax` });
                if (runs.length === 0) return 'free';
                return runs.map((run, i) => (
                  <span key={run.key} className="cost__run">
                    {i > 0 ? <span className="cost__sep"> · </span> : null}
                    <span className="cost" data-res={run.res}>
                      <ResourceGlyph resource={run.res} size={14} />
                      {run.text}
                    </span>
                  </span>
                ));
              })()}
            </span>
            <span className="mkt__voters">
              <span className="mkt__voters-n">{slot.voters}</span>{' '}
              voter{slot.voters === 1 ? '' : 's'}
            </span>
            {miss.length > 0 ? <span className="mkt__short">{miss.join(' · ')}</span> : null}
            {!unavailable ? <span className="mkt__buy" aria-hidden="true">BUY</span> : null}
            {stranded ? (
              <span className="mkt__short" data-testid="market-stranded">
                NO ROOM FOR THESE — they will be discarded
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
    </>
  );
}

/** What each Ideologue power does, in one line (rules-reference.md, p29–32). */
const POWER_TEXT: Readonly<Record<string, string>> = {
  prospecting: 'Pay 1 resource to take up to 2 of your choice. Once a turn.',
  'land-grab': 'Send any voter back to its owner, outside Volatile Areas. 3 times a turn.',
  donations: 'Take 1 resource from another player. Twice a turn.',
  payback: "Pay 1 resource to discard an opponent's voter. Twice a turn.",
  'going-viral': '+1 voter on a Voter Card you buy. Twice a turn.',
  'helping-hands': '1 resource off a Voter or Conspiracy Card. Twice a turn.',
  'tough-love': "Pay 2 Trust + any 2 to take 2 of an opponent's voters in one zone. Once a turn.",
};

/** A resource's name as a player reads it on a price. */
const RESOURCE_NAME: Readonly<Record<Resource, string>> = {
  funds: 'Funds',
  clout: 'Clout',
  media: 'Media',
  trust: 'Trust',
};

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
  const rightsCount = rightsZones(state, you).length;

  return (
    <section
      className={`panel ${framed ? 'panel--framed' : ''}`}
      aria-label={showControls ? 'Your mat' : `${me.name}'s mat, read only`}
      data-testid="your-mat"
    >
      <h2 className="panel__title">
        {showControls ? 'Your mat' : `${me.name}'s mat (read only)`}
      </h2>

      <ResourceStrip pool={me.resources} cap={effectiveCap(me)} />

      <h3 className="panel__title mat__h">Manifesto</h3>
      {/* The three thresholds, said once in words. The pips encode them, but a new
          player meeting four cells of "+0 MEDIA · NEXT IN 2" had nothing to tell them
          what a Manifesto is for. */}
      <p className="mat__hint">
        Every answer files a card under its Ideologue. Each pair pays +1 of that resource every
        turn; 3 cards unlock its first power, 5 its second.
      </p>
      <ManifestoStrip state={state} you={you} />

      <h3 className="panel__title mat__h">Voters to place</h3>
      <PendingGroups
        state={state}
        groups={me.pending}
        placingGroupId={props.placingGroupId}
        pickedCount={props.pickedCount}
        disabled={!actionable}
        onSelect={props.onSelectGroup}
      />

      {showControls ? (
        <>
          <h3 className="panel__title mat__h">Powers</h3>
          <PowersTray
            state={state}
            you={you}
            disabled={!actionable}
            disabledReason={inertReason}
            onPower={props.onPower}
          />

          {/* §5.7: a trade is with a NAMED person. One button per opponent, and a
              spectator or a solo player gets the reason rather than no buttons. */}
          <h3 className="panel__title mat__h">Other actions</h3>
          {state.turnOrder.filter((id) => id !== you).length === 0 ? null : (
            <div className="row mat__action">
              <span className="mat__action-label">
                <strong>Trade</strong> resources with
              </span>
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
          <div className="row mat__action">
            <span className="mat__action-label">
              <strong>Gerrymander</strong> — move one voter, in a constituency where you have the
              most voters
              {/* Said BEFORE the press. It used to be a live button that answered
                  "you hold Gerrymandering Rights in no constituency" after you
                  pressed it — the rule was only ever discoverable by failing it. */}
              {rightsCount === 0 ? (
                <span className="mat__action-why" data-testid="gerry-why">
                  {' '}
                  You do not have the most voters anywhere yet.
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={props.onGerry}
              disabled={!actionable || rightsCount === 0}
              aria-disabled={!actionable || rightsCount === 0}
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
  /**
   * Which market slot holds an armed power, and what it waives. Shown, not hidden.
   *
   * The DISCOUNTS matter and are the reason this is the whole modifier rather than
   * a slot index: `MarketStrip` prices a card against what the engine will charge,
   * and the engine's charge is `applyDiscounts(cost, discounts)`. Handing it the
   * index alone would leave it pricing against a number nobody charges, which is
   * the silent-click defect this prop's docstring on `MarketStrip` describes.
   */
  readonly armed: {
    readonly slot: number;
    readonly discounts: readonly Resource[];
  } | null;
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
  armed,
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
      <h2 className="panel__title">
        Voter Cards <span className="panel__kicker">HQ Mat · buy one to get voters</span>
      </h2>
      <MarketStrip
        state={state}
        you={you}
        disabled={disabled}
        disabledReason={disabledReason}
        armed={armed}
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
      {armed === null ? null : (
        <p className="panel__note" data-testid="armed-modifier">
          A power is armed on market card {armed.slot + 1}. Buy that card to spend it, or press the
          power again to cancel.
        </p>
      )}
    </section>
  );
}
