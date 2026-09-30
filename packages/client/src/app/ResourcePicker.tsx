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
 */

import { useMemo } from 'react';

import { RESOURCE_ORDER, canAfford, deltaTotal, shortfall } from './derive.ts';
import type { Pool, Resource } from '@shasn/engine';

export type ResourcePickerProps = {
  /** The pool being drawn from. The player's own. */
  readonly pool: Pool;
  /** Exactly this many resources must be selected. */
  readonly total: number;
  readonly pick: Readonly<Record<string, number>>;
  readonly onPick: (next: Readonly<Record<string, number>>) => void;
  /** Rendered above the grid, so the reason for the picker is on screen. */
  readonly heading: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
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
}: ResourcePickerProps) {
  const chosen = useMemo(() => deltaTotal(pick as Record<Resource, number>), [pick]);
  const remaining = total - chosen;
  const short = useMemo(() => shortfall(pool, pick as Record<Resource, number>), [pool, pick]);
  const shortText = RESOURCE_ORDER.filter((r) => (short[r] ?? 0) > 0)
    .map((r) => `${short[r]} ${r}`)
    .join(' · ');
  const affordable = canAfford(pool, pick as Record<Resource, number>);
  const valid = chosen === total && shortText === '';

  /** One tap adds one; the label states the ceiling rather than hiding it. */
  const bump = (r: Resource, by: number): void => {
    const current = pick[r] ?? 0;
    const max = pool[r];
    const next = Math.max(0, Math.min(max, current + by));
    if (next === current) return;
    onPick({ ...pick, [r]: next });
  };

  return (
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      data-testid="resource-picker"
    >
      <h2 className="sheet__title">{heading}</h2>

      <div className="picker__grid">
        {RESOURCE_ORDER.map((r) => {
          const have = pool[r];
          const want = pick[r] ?? 0;
          return (
            <div key={r} className="col">
              <button
                type="button"
                className={`picker__cell ${want > 0 ? 'picker__cell--max' : ''}`}
                onClick={() => bump(r, 1)}
                aria-label={`Add one ${r}. You hold ${have}, ${want} chosen.`}
              >
                <span className="picker__count">
                  {want}
                  <span className="picker__name"> / {have}</span>
                </span>
                <span className="picker__name">{r}</span>
              </button>
              <div className="row row--tight">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => bump(r, 1)}
                  disabled={want >= have}
                  aria-label={`Add one ${r}`}
                >
                  +
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => bump(r, -1)}
                  disabled={want <= 0}
                  aria-label={`Remove one ${r}`}
                >
                  −
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* The status line sits directly above the confirm, because §9.2's rule is
          that the reason is always adjacent to the disabled control. */}
      <p
        className={`picker__status ${valid ? '' : 'picker__status--short'}`}
        role="status"
        data-testid="picker-status"
      >
        {chosen} of {total} chosen.
        {shortText !== '' ? ` Short ${shortText} — you do not hold those.` : ''}
        {chosen !== total && shortText === '' ? ` ${remaining} still to choose.` : ''}
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
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
