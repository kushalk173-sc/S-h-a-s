/**
 * The resource picker.
 *
 * FOUR DENOMINATIONS, ALL-OR-NOTHING, and a stated shortfall next to the
 * control. This is the one widget the player learns once and then meets
 * everywhere: the redraw payment (§5.3.5), a Conspiracy purchase (§5.9a),
 * Prospecting, and the two sides of a trade (§5.7).
 *
 * IT SHOWS RESOURCE GLYPHS AND NUMERALS, AND THAT IS CORRECT HERE. §9.6 bans
 * resource tokens on the ANSWER PROMPT because the prompt is the private half
 * of a blind answer; this widget is the player's OWN pool, which they can
 * already see on their own mat. The distinction is not a technicality — it is
 * the reason §1.2's ban is scoped to the prompt and not to the product.
 *
 * NO PROP FOR WHAT IS BEING PAID FOR, beyond a label. The picker cannot be
 * pointed at a card's payout, because the only things that can open it are the
 * redraw button, a market card, the conspiracy buy, and the trade composer — all
 * of which already know the cost from public state.
 *
 * ─────────────────── COST OR GAIN, AND WHY IT MUST BE SAID ───────────────────
 *
 * `mode` is not a style switch. It is the ONE property on this widget that
 * decides whether a dead dialog is possible, and the bug it exists to prevent was
 * found by real 5-player playtesting, not by a test:
 *
 * A player holding 0/0/0/0 was offered "gain 1 resource of your choice". With
 * `pool={me.resources}` as the ceiling, every `Add` control was disabled (there
 * was nothing held to add FROM) and `TAKE 1` was disabled (the draft could not
 * exceed the pool) — so the dialog had NO enabled control anywhere and the table
 * was locked until the server restarted. `onCancel` was a deliberate no-op, so
 * there was no way out even if one had been added naively.
 *
 * THE CATEGORY ERROR IS NAMING IT A POOL. "What you can afford" is a statement
 * about a COST. For a gain there is no affordability: the engine's
 * `resolveChoice` imposes no `canAfford` on a `gain-any` (reduce.ts) and credits
 * the pick wholesale, because a resource you are about to be given is not a
 * resource you must already own. Handing a gain the cost widget's ceiling is
 * handing it the wrong question, and the wrong question has no answer.
 *
 * So:
 *   - `mode: 'cost'` (the default, and every existing caller) — the pool IS the
 *     ceiling. Every `Add` is capped at what is held, and the status line names
 *     any shortfall. A player with an empty pool and a payment they cannot make
 *     sees a disabled widget WITH the reason printed next to it, which is
 *     §9.2's rule: never a dead control without an adjacent reason.
 *   - `mode: 'gain'` — the pool is a LABEL, not a limit. The ceiling is `total`:
 *     you can never want more of one denomination than the whole decision is
 *     worth, so it is a ceiling that can never bind. There is no shortfall,
 *     because there is nothing to be short of.
 *
 * Both modes guarantee the property this widget now has a test for: FROM THE
 * INITIAL DRAFT THERE IS ALWAYS A PATH TO AN ENABLED CONFIRM. A player is never
 * asked to resolve a decision they cannot resolve.
 */

import { useMemo } from 'react';

import { RESOURCE_ORDER, deltaTotal, shortfall } from './derive.ts';
import { ResourceGlyph } from './ResourceGlyph.tsx';
import type { Delta, Pool, Resource } from '@shasn/engine';

export type ResourcePickerMode = 'cost' | 'gain';

export type ResourcePickerProps = {
  /**
   * The player's holdings, always shown. Read as a CEILING in `cost` mode and as
   * a LABEL in `gain` mode — see the file header.
   */
  readonly pool: Pool;
  /** Exactly this many resources must be selected. */
  readonly total: number;
  readonly pick: Readonly<Record<string, number>>;
  readonly onPick: (next: Readonly<Record<string, number>>) => void;
  /** Rendered above the grid, so the reason for the picker is on screen. */
  readonly heading: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  /**
   * Omit to render NO cancel control at all.
   *
   * Deliberate, and it is the second half of the dead-dialog fix. A `Cancel`
   * wired to a no-op is a button that lies: it looks like a way out of a
   * decision that has none, and pressing it teaches the player that this dialog
   * ignores them. Where a decision genuinely cannot be backed out of, there is
   * no button; where it can — a purchase that has not been made, a theft whose
   * victim has not been named — the caller passes the real handler.
   */
  readonly onCancel?: () => void;
  /** `'cost'` unless the pick is a receipt. Never guess this at a call site. */
  readonly mode?: ResourcePickerMode;
  /**
   * Render as CONTENT of a dialog that is already open, rather than as a dialog
   * in its own right.
   *
   * A defect found by measuring at 390px: `ChoiceResolver` renders a `.sheet` and
   * the picker rendered a SECOND `.sheet` inside it. Two full sheets means two
   * sets of 20px padding, two borders and two shadows stacked inside a scrim
   * that already has padding — and because `.sheet` is `width: 100%` on a
   * `content-box`, the inner one measured 358px wide inside a 356px content box.
   * 22px of the player's own resources were clipped off the right edge, which is
   * the one thing this widget may never do (§5.9b: the decision is the only thing
   * the player can legally do, so any of it being unreadable is a stall).
   *
   * `nested` also fixes the accessibility half of the same bug. Two stacked
   * `aria-modal="true"` dialogs is a contradiction: the outer says nothing behind
   * it is reachable while the inner is itself modal. Nested, this is a plain
   * `<section>` and the outer dialog stays the only modal.
   */
  readonly nested?: boolean;
};

export function ResourcePicker({
  pool,
  total,
  pick,
  onPick,
  heading,
  confirmLabel,
  onConfirm,
  onCancel,
  mode = 'cost',
  nested = false,
}: ResourcePickerProps) {
  const isGain = mode === 'gain';
  const chosen = useMemo(() => deltaTotal(pick as Record<Resource, number>), [pick]);
  const remaining = total - chosen;
  // A shortfall is a COST concept. On a gain there is nothing to be short of, and
  // printing one would be a lie: the engine credits whatever is picked.
  const short = useMemo(
    () => (isGain ? ({} as Delta) : shortfall(pool, pick as Record<Resource, number>)),
    [isGain, pool, pick],
  );
  const shortText = RESOURCE_ORDER.filter((r) => (short[r] ?? 0) > 0)
    .map((r) => `${short[r]} ${r}`)
    .join(' · ');
  const valid = chosen === total && shortText === '';

  /** What the player holds in total. Only a cost is measured against it. */
  const held = RESOURCE_ORDER.reduce((n, r) => n + pool[r], 0);

  /**
   * THE CEILING FOR ONE DENOMINATION.
   *
   * A cost cannot exceed what is held. A gain cannot exceed the whole decision,
   * because that is the most of any one denomination a single answer can be
   * worth — so on a gain this is a ceiling that cannot bind, which is the point:
   * it guarantees a reachable confirm from a zero draft even when the pool is
   * empty, without inventing a limit the rules do not have.
   */
  const maxOf = (r: Resource): number => (isGain ? total : pool[r]);

  /** One tap adds one; the label states the ceiling rather than hiding it. */
  const bump = (r: Resource, by: number): void => {
    const current = pick[r] ?? 0;
    const next = Math.max(0, Math.min(maxOf(r), current + by));
    if (next === current) return;
    onPick({ ...pick, [r]: next });
  };

  /**
   * ONE PRESS PER DENOMINATION INSTEAD OF ONE PER RESOURCE.
   *
   * `bump` above moves the draft by exactly one, which is right for a payment of
   * four and catastrophic for a cap discard of seventy-one — and a cap discard is
   * the one ask in this game whose size is UNBOUNDED. p12 makes it `held - cap`,
   * and nothing returns resources except card payouts (max 4), so a seat that
   * crosses and cannot discharge climbs every turn. `$TEMP/opencode/shasn-play`
   * holds a seat at 83 against a cap of 12: an ask of 71, entered one resource at
   * a time, which is not a task any player is going to finish.
   *
   * So each denomination gets a third control that moves it by everything the
   * decision still needs:
   *
   *   - it is clamped to `remaining`, so it can never OVERSHOOT the ask. A control
   *     that could take the draft past `total` would leave CONFIRM disabled with
   *     a status reading "47 of 41 chosen" and no way back but `−` on each column,
   *     which is the same dead-end in a new place.
   *   - it is clamped to `maxOf(r)`, so it can never claim more than is held — the
   *     `canAfford` half of the engine's `resolveChoice` check still holds.
   *   - it leaves the DENOMINATION choice with the player, which p12 requires and
   *     which a "discard down to the cap" button would quietly take. Four presses
   *     to discharge any ask; the player still chooses which four.
   *
   * In `gain` mode the same arithmetic is "take as much of this as the decision
   * is worth", `maxOf` is `total`, and both clamps are the same two. There is no
   * separate control because there is no separate question.
   */
  const bumpMax = (r: Resource): void => {
    const current = pick[r] ?? 0;
    const next = Math.max(current, Math.min(maxOf(r), current + Math.max(0, remaining)));
    if (next === current) return;
    onPick({ ...pick, [r]: next });
  };

  /*
   * TWO SHAPES, ONE BODY. The grid, the numerals, the status line and the
   * buttons are identical either way — only the container differs. That is the
   * point: the player learns this widget once (§5.4's reasoning applied to
   * choices), so `nested` must not change a single thing inside it.
   */
  /*
    PICK FOR ME. Paying "any 4" or discarding down to the cap is usually a chore,
    not a decision: you spend what you hold most of. This fills the rest of the
    choice one resource at a time from whatever you have the most of left, which
    keeps your pool as balanced as it can be. The player can still adjust it, and
    nothing is sent until they confirm.
  */
  const autoFill = (): void => {
    const next: Record<string, number> = { ...pick };
    let left = total - chosen;
    while (left > 0) {
      let best: Resource | null = null;
      for (const r of RESOURCE_ORDER) {
        const spare = pool[r] - (next[r] ?? 0);
        if (spare <= 0) continue;
        if (best === null || spare > pool[best] - (next[best] ?? 0)) best = r;
      }
      if (best === null) break;
      next[best] = (next[best] ?? 0) + 1;
      left -= 1;
    }
    onPick(next);
  };
  const canAutoFill = !isGain && chosen < total && held >= total;

  const body = (
    <>
      <h2 className="sheet__title">{heading}</h2>

      <div className="picker__grid">
        {RESOURCE_ORDER.map((r) => {
          const have = pool[r];
          const want = pick[r] ?? 0;
          const max = maxOf(r);
          return (
            <div key={r} className="col">
              <button
                type="button"
                className={`picker__cell ${want > 0 ? 'picker__cell--max' : ''}`}
                data-res={r}
                onClick={() => bump(r, 1)}
                /* The cell and its `+` are the SAME action, so they carry the SAME
                 * state. A cell that stayed live at the ceiling was a button that
                 * silently did nothing — which is, in miniature, the dead-control
                 * failure this widget was just repaired for, and it lies to a screen
                 * reader that is told the control is available. */
                disabled={want >= max}
                aria-disabled={want >= max}
                aria-label={
                  isGain
                    ? `Take one more ${r}. You hold ${have}, ${want} of ${total} chosen.`
                    : `Add one ${r}. You hold ${have}, ${want} chosen.`
                }
              >
                <ResourceGlyph resource={r} />
                <span className="picker__count">
                  {want}
                  {/* A gain has no `want / have` fraction — the numerator is not
                      drawn from the denominator. It states the holding instead, so
                      the cell still answers "what will I end up with". */}
                  <span className="picker__name"> {isGain ? `· hold ${have}` : `/ ${have} held`}</span>
                </span>
                <span className="picker__name">{r}</span>
              </button>
              <div className="row row--tight">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => bump(r, 1)}
                  disabled={want >= max}
                  aria-label={isGain ? `Take one more ${r}` : `Add one ${r}`}
                >
                  +
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => bump(r, -1)}
                  disabled={want <= 0}
                  aria-label={isGain ? `Take one fewer ${r}` : `Remove one ${r}`}
                >
                  −
                </button>
                {/* LAST in the row, deliberately. Every driver in this repository that
                    walks the picker reads `.picker__grid .row--tight button` and takes
                    the first enabled control whose label is not a `Remove` — so this
                    one has to come after `+` or every one of them starts here and the
                    suite stops testing the one-press-at-a-time path it is written
                    against. It is still a `+`-adjacent control on the same row, and
                    *this* control is exercised directly below. */}
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => bumpMax(r)}
                  disabled={want >= max || want >= total}
                  aria-label={
                    isGain
                      ? `Take as many ${r} as this decision is worth. You hold ${have}, ${want} of ${total} chosen.`
                      : `Shed as many ${r} as this decision still needs. You hold ${have}, ${want} of ${total} chosen.`
                  }
                  data-testid={`picker-max-${r}`}
                >
                  ALL
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* The status line sits directly above the confirm, because §9.2's rule is
          that the reason is always adjacent to the disabled control. */}
      <p
        // Untouched is not wrong: a dialog that opens in red is scolding the player
        // for the state it put them in. Red is for a choice that cannot be completed.
        className={`picker__status ${
          valid || (chosen === 0 && shortText === '' && (isGain || held >= total))
            ? ''
            : 'picker__status--short'
        }`}
        role="status"
        data-testid="picker-status"
      >
        {chosen} of {total} chosen.
        {shortText !== '' ? ` Short ${shortText} — you do not hold those.` : ''}
        {chosen !== total && shortText === '' ? ` ${remaining} still to choose.` : ''}
        {/* THE ASK IS BIGGER THAN THE POOL. `shortfall` above compares the pick
            against the pool, which on a zero draft is always satisfied — so a
            payment larger than everything held would say nothing at all, and the
            player would click a `+` that goes dead the moment it is pressed, with
            no reason anywhere. The engine never raises such an ask (`applyEffect`
            and `enforceCap` both clamp to what is held), but a widget that can
            only report a shortfall by way of a pick the player cannot complete is
            a widget that hides one when it happens. State it outright. */}
        {!isGain && held < total ? ` You hold ${held} of the ${total} this needs.` : ''}
      </p>

      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onConfirm}
          disabled={!valid}
          aria-disabled={!valid}
          data-testid="picker-confirm"
        >
          {confirmLabel}
        </button>
        {canAutoFill ? (
          <button type="button" className="btn" onClick={autoFill} data-testid="picker-auto">
            PICK FOR ME
          </button>
        ) : null}
        {chosen > 0 ? (
          <button type="button" className="btn btn--ghost" onClick={() => onPick({})}>
            Clear
          </button>
        ) : null}
        {onCancel === undefined ? null : (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </>
  );

  if (nested) {
    return (
      <div className="picker__nested" data-testid="resource-picker">
        {body}
      </div>
    );
  }

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      data-testid="resource-picker"
    >
      {body}
    </div>
  );
}
