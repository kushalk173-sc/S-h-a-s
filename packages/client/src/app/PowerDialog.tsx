/**
 * The Ideologue Power dialogs.
 *
 * §5.9a/§5.4 put the powers in a tray on the mat, and four of the seven need
 * something the mat cannot supply: a slot on the board, a victim, a resource. This
 * file is where those four get collected, and it is deliberately ONE component
 * with five shapes rather than five components, because the shape of the answer
 * differs less than it looks — it is always "pick N things, then confirm".
 *
 * GOING VIRAL AND HELPING HANDS ARE NOT HERE. They are not separate engine
 * actions: `reduce.ts` folds them into `INFLUENCE` as `viral` and `discounts`, so
 * they modify a market BUY rather than being an action of their own. They are
 * armed in `MarketModifier` (see `store.ts`) and spent by the buy itself. Putting
 * them here would mean inventing a submit step the engine does not have.
 *
 * EVERY REFUSAL IS THE ENGINE'S. Each flow checks the same conditions
 * `reduce.ts` does before it dispatches, and names the reason. The engine still
 * decides — this exists so an illegal press explains itself on the frame it
 * happened (§9.10), not so the client can second-guess the reducer.
 */

import { useState } from 'react';

import type { Area, ClientState, Delta, PlayerID, Pool, Resource } from '@shasn/engine';

import {
  RESOURCE_ORDER,
  UI_RULES,
  canAfford,
  deltaText,
  deltaTotal,
  marketCharge,
  powerAreaRefusal,
  poolTotal,
  shortfall,
} from './derive.ts';
import { ResourceGlyph } from './ResourceGlyph.tsx';
import type { MarketPower, PowerFlow } from './store.ts';
import { powerAreaCount, powerTargetsArea } from './store.ts';

export type PowerDialogProps = {
  readonly state: ClientState;
  readonly you: PlayerID;
  readonly flow: PowerFlow;
  /** Slots already picked for the board-targeting powers. */
  readonly pickedAreaIds: readonly string[];
  readonly onPickSlot: (areaId: string) => void;
  readonly onRemovePick: () => void;
  readonly onCancel: () => void;
  readonly onSubmit: (action: PowerSubmit) => void;
};

/** What the dialog hands back, so GameScreen can build the action in one place. */
export type PowerSubmit =
  | { readonly kind: 'prospect'; readonly give: Resource; readonly take: readonly Resource[] }
  | { readonly kind: 'land-grab'; readonly areaId: string }
  | { readonly kind: 'donations'; readonly from: PlayerID; readonly res: Resource }
  | { readonly kind: 'payback'; readonly areaId: string; readonly pay: Resource }
  | { readonly kind: 'tough-love'; readonly areaIds: readonly string[]; readonly pay: Delta };

export function PowerDialog(props: PowerDialogProps) {
  const { flow } = props;
  const title = TITLES[flow.power];
  const body = BODIES[flow.power];
  /*
     THREE OF THE FIVE SHAPES ARE RESOLVED ON THE BOARD, SO THREE OF THEM MUST NOT
     COVER THE BOARD.

     `.scrim` is `position: fixed; inset: 0; z-index: 20` over an OPAQUE
     `--table-900`, and this dialog used it for all five. Land Grab, Payback and
     Tough Love are answered by clicking slots — `commitPower` takes an `areaId`,
     and `PowerDialog` has no slot list of its own. So for those three the only
     place the pick could be made was under an opaque full-viewport overlay, and
     `CONFIRM` (`ready = area !== null && …`) could never go live.

     That is the measured symptom: "25-50 occupied areas offered, CONFIRM never
     enables", across every playthrough that armed one of the three. It is the
     seventh recurrence of this project's unreachable-dialog class, and the same one
     `ChoiceResolver` was repaired for — see its header, and `.scrim--area` in
     `app.css`, which exists for exactly this and which this dialog was not using.

     `.scrim--area` is `pointer-events: none` with a translucent wash and the sheet
     anchored to the BOTTOM, so the board stays visible, stays clickable, and sits
     ABOVE the sheet rather than behind it. The sheet takes its pointer events back,
     so CONFIRM, UNDO and CANCEL all still work.

     `aria-modal` goes with it, for the same reason it does in `ChoiceResolver`:
     telling a screen reader the rest of the page is inert stops being true the
     moment the board is the other half of the answer. It is dropped for the three
     board shapes only — Prospecting and Donations genuinely are modal, and saying
     otherwise about them would be its own small lie.
  */
  const onBoard = powerTargetsArea(flow);

  return (
    <div
      className={onBoard ? 'scrim scrim--area' : 'scrim'}
      data-testid="power-dialog"
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal={onBoard ? undefined : true}
        aria-label={title}
        data-testid={`power-dialog-${flow.power}`}
      >
        <h2 className="sheet__title">{title}</h2>
        <p className="sheet__body">{body}</p>

        {flow.power === 'prospecting' ? <Prospecting pool={poolOf(props)} onSubmit={props.onSubmit} /> : null}
        {flow.power === 'land-grab' ? <SlotTarget {...props} verb="evict" /> : null}
        {flow.power === 'payback' ? <SlotTarget {...props} verb="strike" pay /> : null}
        {flow.power === 'donations' ? <Donations {...props} /> : null}
        {flow.power === 'tough-love' ? <ToughLove {...props} /> : null}

        <div className="row">
          <button type="button" className="btn" onClick={props.onCancel} data-testid="power-cancel">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

const TITLES: Record<PowerFlow['power'], string> = {
  prospecting: 'Prospecting',
  'land-grab': 'Land Grab',
  donations: 'Donations',
  payback: 'Payback',
  'tough-love': 'Tough Love',
};

const BODIES: Record<PowerFlow['power'], string> = {
  prospecting: `Give one resource, take up to ${UI_RULES.prospectingTake}. Turning one into two is the whole trick.`,
  'land-grab': 'Choose any voter on the board — theirs or yours. It goes back to its owner to place again.',
  donations: 'Take one resource from another player. Choose what, and from whom.',
  payback: "Strike one of an opponent's voters from the roll, paying one resource. Volatile-Area voters are permanent.",
  'tough-love': `Convert ${UI_RULES.toughLoveConverts} of one opponent's voters into yours. They must be in the same constituency, and you pay ${UI_RULES.toughLoveTrust} Trust plus any ${UI_RULES.toughLoveAny} resources.`,
};

function poolOf({ state, you }: { state: ClientState; you: PlayerID }): Pool {
  const me = state.players[you];
  if (me === undefined) return { funds: 0, clout: 0, media: 0, trust: 0 };
  return me.resources;
}

// ─────────────────────────── prospecting ───────────────────────────

/**
 * Give one, take up to two.
 *
 * The engine takes `take` as a LIST (`action.take`), so duplicates are meaningful
 * and a toggle would be wrong: taking two of one denomination is a different play
 * from taking one of two. Each row is therefore a count, and the sum is capped at
 * `prospectingTake` rather than by disabling rows — a disabled row that never
 * explains itself is a puzzle (§9.2).
 */
function Prospecting({
  pool,
  onSubmit,
}: {
  pool: Pool;
  onSubmit: (s: PowerSubmit) => void;
}) {
  const giveable = RESOURCE_ORDER.filter((r) => pool[r] > 0);
  const [give, setGive] = useState<Resource | null>(giveable[0] ?? null);
  const [take, setTake] = useState<Partial<Record<Resource, number>>>({});

  const taken = RESOURCE_ORDER.reduce((n, r) => n + (take[r] ?? 0), 0);
  const cap = UI_RULES.prospectingTake;
  const full = taken >= cap;
  const gain = Math.min(taken, cap);
  const net = gain - 1;

  const bump = (r: Resource, by: number): void => {
    const next = Math.max(0, (take[r] ?? 0) + by);
    if (next === 0) {
      const { [r]: _drop, ...rest } = take;
      setTake(rest);
      return;
    }
    // Bumping past the cap is clamped, and the status line below already says how
    // much room is left, so the control never silently refuses.
    const room = cap - taken;
    const allowed = by > 0 ? Math.min(next, (take[r] ?? 0) + room) : next;
    setTake({ ...take, [r]: allowed });
  };

  return (
    <div className="col" data-testid="prospecting">
      <span className="field__label">YOU GIVE</span>
      <div className="picker__grid">
        {giveable.map((r) => (
          <button
            key={r}
            type="button"
            className={`picker__cell ${give === r ? 'picker__cell--max' : ''}`}
            data-res={r}
            onClick={() => setGive(r)}
            aria-pressed={give === r}
            data-testid={`prospect-give-${r}`}
          >
            <ResourceGlyph resource={r} />
            <span className="picker__count">{pool[r]}</span>
            <span className="picker__name">{r}</span>
          </button>
        ))}
      </div>

      <span className="field__label">YOU TAKE — UP TO {cap}</span>
      <div className="picker__grid">
        {RESOURCE_ORDER.map((r) => (
          <div key={r} className="col">
            <button
              type="button"
              className={`picker__cell ${(take[r] ?? 0) > 0 ? 'picker__cell--max' : ''}`}
              data-res={r}
              onClick={() => bump(r, 1)}
              aria-label={`Take one ${r}. ${taken} of ${cap} chosen.`}
            >
              <ResourceGlyph resource={r} />
              <span className="picker__count">{take[r] ?? 0}</span>
              <span className="picker__name">{r}</span>
            </button>
            <div className="row row--tight">
              <button type="button" className="btn btn--sm" onClick={() => bump(r, 1)}>
                +
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => bump(r, -1)}
                disabled={(take[r] ?? 0) <= 0}
              >
                −
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="picker__status" role="status" data-testid="prospect-status">
        {give === null
          ? 'You hold nothing to give.'
          : net === 0
            ? `Give 1 ${give}, take ${gain}. No gain — take another if you have the room.`
            : `Give 1 ${give}, take ${gain}. Net ${net > 0 ? '+' : ''}${net}.`}
      </p>

      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={give === null || taken === 0}
          aria-disabled={give === null || taken === 0}
          onClick={() => {
            if (give === null) return;
            const list: Resource[] = [];
            for (const r of RESOURCE_ORDER) {
              for (let i = 0; i < (take[r] ?? 0); i += 1) list.push(r);
            }
            onSubmit({ kind: 'prospect', give, take: list });
          }}
          data-testid="prospect-confirm"
        >
          PROSPECT
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── the slot-targeting powers ───────────────────────────

/**
 * Land Grab and Payback. One slot, and the board carries the picking.
 *
 * The legality shown here is the reducer's, checked in the same order:
 * a peg must exist, it must not be in a Volatile Area, and for Payback it must
 * belong to an opponent. Anything else and the reason is named rather than the
 * slot being merely unclickable (§9.2).
 */
function SlotTarget({
  state,
  you,
  flow,
  pickedAreaIds,
  onRemovePick,
  onCancel,
  onSubmit,
  verb,
  pay,
}: PowerDialogProps & { verb: string; pay?: boolean }) {
  const [cost, setCost] = useState<Resource | null>(null);

  const picked = pickedAreaIds[0] ?? null;
  const area = picked === null ? null : findArea(state, picked);
  const owned = poolOf({ state, you });
  const payables = RESOURCE_ORDER.filter((r) => owned[r] > 0);

  const refusal = area === null ? null : powerAreaRefusal(state, you, flow, area.id);
  const ready = area !== null && refusal === null && (pay !== true || (cost !== null && owned[cost] > 0));
  /*
     THE PAYMENT IS PART OF THE GATE ONLY WHEN THERE IS A PAYMENT.

     This read `if (area === null || cost === null) return;` — but `cost` is
     `useState<Resource | null>(null)` and nothing sets it unless `pay === true`, so
     for LAND GRAB it was `null` forever and **CONFIRM did nothing at all**. The
     button was enabled (`ready` gates on `pay !== true`, correctly), it looked
     live, and pressing it silently dropped the power: §9.10's prohibited control,
     reached by copying Payback's guard into a component that serves both.

     `pay` is the only thing that distinguishes the two shapes here, and `ready`
     above already reads it that way — the gate and the guard now agree.
  */
  const needsPay = pay === true;
  const paid = !needsPay || (cost !== null && owned[cost] > 0);

  return (
    <div className="col" data-testid="slot-target">
      {pay === true ? (
        <>
          <span className="field__label">YOU PAY ONE</span>
          <div className="picker__grid">
            {payables.map((r) => (
              <button
                key={r}
                type="button"
                className={`picker__cell ${cost === r ? 'picker__cell--max' : ''}`}
                data-res={r}
                onClick={() => setCost(r)}
                aria-pressed={cost === r}
                data-testid={`payback-pay-${r}`}
              >
                <ResourceGlyph resource={r} />
                <span className="picker__count">{owned[r]}</span>
                <span className="picker__name">{r}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="picker__status" role="status" data-testid="slot-target-status">
        {area === null
          ? `Click a slot on the board to ${verb} it.`
          : refusal !== null
            ? refusal
            : `${areaName(state, area)} — ${verb} this voter.`}
      </p>

      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          aria-disabled={!ready}
          onClick={() => {
            if (area === null || !paid || (needsPay && cost === null)) return;
            onSubmit(
              flow.power === 'land-grab'
                ? { kind: 'land-grab', areaId: area.id }
                : { kind: 'payback', areaId: area.id, pay: cost as Resource },
            );
          }}
          data-testid="slot-target-confirm"
        >
          CONFIRM
        </button>
        <button
          type="button"
          className="btn"
          onClick={onRemovePick}
          disabled={pickedAreaIds.length === 0}
          data-testid="slot-target-undo"
        >
          UNDO
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── donations ───────────────────────────

/**
 * Donations: a victim and a denomination, in that order.
 *
 * Only resources the victim ACTUALLY HOLDS are offered. Offering all four and
 * refusing three on submit would be the same interface as a rule the player has
 * to learn by failing; a list of what they can lose is the decision itself.
 */
function Donations({ state, you, onSubmit }: PowerDialogProps) {
  const others = state.turnOrder.filter((id) => id !== you);
  const [target, setTarget] = useState<PlayerID | null>(null);
  const victim = target === null ? null : state.players[target] ?? null;

  if (victim !== null) {
    const held = RESOURCE_ORDER.filter((r) => victim.resources[r] > 0);
    return (
      <div className="col" data-testid="donations-pick">
        <span className="field__label">TAKE FROM {victim.name.toUpperCase()}</span>
        <div className="picker__grid">
          {held.map((r) => (
            <button
              key={r}
              type="button"
              className="picker__cell"
              data-res={r}
              onClick={() => onSubmit({ kind: 'donations', from: victim.id, res: r })}
              data-testid={`donations-take-${r}`}
            >
              <ResourceGlyph resource={r} />
              <span className="picker__count">{victim.resources[r]}</span>
              <span className="picker__name">{r}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setTarget(null)}>
            BACK
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="col" data-testid="donations-victim">
      <p className="panel__note">Choose whose resources to take.</p>
      {others.map((id) => {
        const p = state.players[id];
        if (p === undefined) return null;
        return (
          <button
            key={id}
            type="button"
            className="btn"
            onClick={() => setTarget(id)}
            disabled={poolTotal(p.resources) === 0}
            aria-disabled={poolTotal(p.resources) === 0}
            data-testid="donations-victim"
          >
            {p.name} — {poolTotal(p.resources)} held
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────── tough love ───────────────────────────

/**
 * Tough Love: two voters, one constituency, one owner, and a payment the engine
 * will accept.
 *
 * THE PAYMENT IS NOT AN `ResourcePicker`, and that is deliberate. The engine wants
 * `trust >= 2` AND `any 2 resources` — two conditions, not one count — and R3 in
 * `reduce.ts` rejects a payment whose numbers go negative precisely so a crafted
 * `{trust: 2, funds: -2}` cannot slip past the total. So the two Trust are fixed
 * and the remaining two are chosen, and the whole draft is shown as one `Delta`
 * before it is sent.
 */
function ToughLove({ state, you, pickedAreaIds, onRemovePick, onCancel, onSubmit }: PowerDialogProps) {
  const owned = poolOf({ state, you });
  const trustNeed = UI_RULES.toughLoveTrust;
  const anyNeed = UI_RULES.toughLoveAny;
  const [extra, setExtra] = useState<Partial<Record<Resource, number>>>({});

  const others = RESOURCE_ORDER.filter((r) => r !== 'trust');
  const chosen = others.reduce((n, r) => n + (extra[r] ?? 0), 0);

  const pay: Delta = { trust: trustNeed };
  for (const r of others) {
    const n = extra[r] ?? 0;
    if (n > 0) pay[r] = n;
  }

  const payOk = chosen >= anyNeed && canAfford(owned, pay);
  const slotsOk = pickedAreaIds.length === powerAreaCount({ power: 'tough-love' });

  return (
    <div className="col" data-testid="tough-love">
      <p className="panel__note" data-testid="tough-love-slots">
        {pickedAreaIds.length} of {powerAreaCount({ power: 'tough-love' })} voters chosen. Click
        highlighted slots on the board — one opponent, one constituency, no square slots.
      </p>

      <span className="field__label">
        YOU PAY {trustNeed} TRUST {`+ ANY ${anyNeed}`}
      </span>
      <div className="picker__grid">
        {others.map((r) => (
          <div key={r} className="col">
            <button
              type="button"
              className={`picker__cell ${(extra[r] ?? 0) > 0 ? 'picker__cell--max' : ''}`}
              onClick={() => setExtra({ ...extra, [r]: Math.min(owned[r], (extra[r] ?? 0) + 1) })}
              disabled={(extra[r] ?? 0) >= owned[r] || chosen >= anyNeed}
              data-testid={`toughlove-pay-${r}`}
            >
              <span className="picker__count">{extra[r] ?? 0}</span>
              <span className="picker__name">{r}</span>
            </button>
            <div className="row row--tight">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  const n = Math.max(0, (extra[r] ?? 0) - 1);
                  if (n === 0) {
                    const { [r]: _d, ...rest } = extra;
                    setExtra(rest);
                    return;
                  }
                  setExtra({ ...extra, [r]: n });
                }}
                disabled={(extra[r] ?? 0) <= 0}
              >
                −
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="picker__status" role="status" data-testid="tough-love-status">
        {slotsOk ? '' : 'Choose both voters first. '}
        {chosen < anyNeed
          ? `${chosen} of ${anyNeed} extra chosen. `
          : payOk
            ? 'Payment complete. '
            : 'You do not hold that payment. '}
        Total {deltaTotal(pay)} resources, including {trustNeed} Trust.
      </p>

      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!slotsOk || !payOk}
          aria-disabled={!slotsOk || !payOk}
          onClick={() => onSubmit({ kind: 'tough-love', areaIds: pickedAreaIds, pay })}
          data-testid="tough-love-confirm"
        >
          CONVERT
        </button>
        <button
          type="button"
          className="btn"
          onClick={onRemovePick}
          disabled={pickedAreaIds.length === 0}
        >
          UNDO
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── the market modifiers ───────────────────────────

/**
 * Going Viral / Helping Hands: WHICH CARD do you spend this on?
 *
 * Not a dialog about the power, but about the purchase. `reduce.ts` takes them as
 * `viral` and `discounts` on `INFLUENCE`, so the power has no meaning until a card
 * is chosen — and choosing the card first is also what tells the player whether the
 * power is worth spending, which is the decision they are actually making.
 *
 * Helping Hands needs one more thing: WHICH resource to waive. Each entry in
 * `discounts` is one resource the buy costs nothing, so this lists only the
 * denominations the card actually charges — waiving a resource it does not cost
 * would send a discount the engine spends a use on for nothing.
 */
export function MarketModifierDialog({
  state,
  you,
  power,
  left,
  onArm,
  onCancel,
}: {
  state: ClientState;
  /** Whose mat this is. The sheet prices every card against THIS seat's pool. */
  readonly you: PlayerID;
  readonly power: MarketPower;
  /** Uses of this power still available this turn. */
  readonly left: number;
  readonly onArm: (slot: number, discounts: readonly Resource[]) => void;
  readonly onCancel: () => void;
}) {
  const [slot, setSlot] = useState<number | null>(null);
  const [discounts, setDiscounts] = useState<readonly Resource[]>([]);
  const me = state.players[you];

  const charging = state.market.map((s, i) => ({
    slot: s,
    index: i,
    charged: RESOURCE_ORDER.filter((r) => (s.cost[r] ?? 0) > 0),
  }));

  /*
    THE SHEET USED TO OFFER THREE CARDS AND REFUSE NONE OF THEM.

    Arming is free and local — `reduce.ts` takes `viral` and `discounts` as fields
    on `INFLUENCE`, so nothing is spent until the card is bought — which meant the
    chooser could arm a modifier on a card the player could not pay for. The note
    then says *"Buy that card to spend it"* about a card that can never be bought,
    and the only way out is to notice that and press the power again.

    Found in a browser: Helping Hands armed on a `2 media` card against a pool with
    no media, the strip honestly printing `11 media short`, and a player with a
    dead power and a sentence telling them to spend it.

    The bar is deliberately the BEST case for the power, not the likely one:
    Helping Hands waives at most one of each charging denomination, so a card that
    is unaffordable even with every one of them waived can never be bought with
    this power on it. Anything affordable at the sticker price is affordable under
    the best case too, so this refuses nothing that could have worked.
  */
  const affordAtBest = me === undefined
    ? () => true
    : (s: (typeof charging)[number]): boolean => {
        const best =
          power === 'helping-hands'
            ? marketCharge(state, you, s.slot, s.charged)
            : marketCharge(state, you, s.slot, []);
        return canAfford(me.resources, best);
      };
  const shortAtBest = (s: (typeof charging)[number]): string => {
    if (me === undefined) return '';
    const best =
      power === 'helping-hands'
        ? marketCharge(state, you, s.slot, s.charged)
        : marketCharge(state, you, s.slot, []);
    const miss = shortfall(me.resources, best);
    return miss === undefined ? '' : deltaText(miss);
  };
  const anyAffordable = charging.some((c) => affordAtBest(c));

  if (slot === null) {
    return (
      <div className="scrim" data-testid="market-power-dialog">
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Choose a Voter Card">
          <h2 className="sheet__title">{power === 'going-viral' ? 'Going Viral' : 'Helping Hands'}</h2>
          <p className="sheet__body">
            {power === 'going-viral'
              ? 'One extra voter on the card you buy. Choose the card.'
              : 'Waive the cost of one resource on the card you buy. Choose the card.'}
          </p>
          {anyAffordable ? null : (
            <p className="picker__status picker__status--short" role="status" data-testid="market-power-none">
              You cannot pay for any card on the HQ Mat, so this power has nothing to spend itself
              on. Answer a card, or end your turn — it is not wasted, it is waiting.
            </p>
          )}
          <div className="col">
            {charging.map((c) => {
              const afford = affordAtBest(c);
              const miss = afford ? '' : shortAtBest(c);
              return (
                <button
                  key={c.index}
                  type="button"
                  className={`btn ${afford ? '' : 'btn--ghost'}`}
                  disabled={!afford}
                  aria-disabled={!afford}
                  onClick={() => setSlot(c.index)}
                  data-testid="market-power-slot"
                >
                  ◈ {c.slot.voters} voters ·{' '}
                  {c.charged.map((r) => `${c.slot.cost[r]} ${r}`).join(' · ') || 'free'}
                  {miss === '' ? null : ` — ${miss} short`}
                </button>
              );
            })}
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={onCancel}>
              CANCEL
            </button>
          </div>
        </div>
      </div>
    );
  }

  const chosen = charging.find((c) => c.index === slot);
  const pickedCharging = chosen === undefined ? [] : chosen.charged;

  return (
    <div className="scrim" data-testid="market-power-dialog">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Choose what to waive">
        <h2 className="sheet__title">{power === 'going-viral' ? 'Going Viral' : 'Helping Hands'}</h2>

        {power === 'going-viral' ? (
          <>
            <p className="sheet__body">
              This card will give you ◈ {(chosen?.slot.voters ?? 0) + 1} voters instead of ◈{' '}
              {chosen?.slot.voters ?? 0}.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onArm(slot, [])}
                data-testid="market-power-arm"
              >
                ARM GOING VIRAL
              </button>
              <button type="button" className="btn" onClick={() => setSlot(null)}>
                BACK
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet__body">
              Choose which resource this buy costs nothing. {left} use{left === 1 ? '' : 's'} left.
            </p>
            <div className="picker__grid">
              {pickedCharging.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`picker__cell ${discounts.includes(r) ? 'picker__cell--max' : ''}`}
                  onClick={() =>
                    setDiscounts(
                      discounts.includes(r)
                        ? discounts.filter((d) => d !== r)
                        : [...discounts, r],
                    )
                  }
                  aria-pressed={discounts.includes(r)}
                  data-testid={`market-power-discount-${r}`}
                >
                  <span className="picker__count">{discounts.includes(r) ? 'FREE' : chosen?.slot.cost[r]}</span>
                  <span className="picker__name">{r}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={discounts.length === 0}
                aria-disabled={discounts.length === 0}
                onClick={() => onArm(slot, discounts)}
                data-testid="market-power-arm"
              >
                ARM THE DISCOUNT
              </button>
              <button type="button" className="btn" onClick={() => setSlot(null)}>
                BACK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── shared helpers ───────────────────────────

function findArea(state: ClientState, areaId: string): Area | null {
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === areaId);
    if (a !== undefined) return a;
  }
  return null;
}

function areaName(state: ClientState, area: Area): string {
  return state.zones.find((z) => z.id === area.zone)?.name ?? area.zone;
}

/**
 * `slotRefusal` USED TO BE A SECOND COPY OF THIS RULE, HERE.
 *
 * Three copies of one legality test is the defect that made Land Grab unusable, so
 * this one is gone: `SlotTarget` reads `derive.ts:powerAreaRefusal`, which is the
 * same call `powerTargetableAreas` is derived from and the same call the click
 * handler in `GameScreen` makes. The player now sees ONE sentence for a slot the
 * power cannot reach, whichever of the three surfaces produced it — this dialog's
 * status line, the board's `illegal: <reason>` aria-clause, and the refusal toast.
 *
 * The wording moved with it. This copy said "Payback targets an opponent's voter",
 * which is `reduce.ts`'s own string for the SERVER's answer; the surviving one says
 * "that is your own voter — this power targets an opponent", which names what is
 * wrong rather than what would happen. An engine refusal string in a live region is
 * a message the player cannot act on.
 */
