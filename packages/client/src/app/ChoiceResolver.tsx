/**
 * The pending-choice resolver.
 *
 * THE PIECE THAT IS EASY TO FORGET AND WITHOUT WHICH THE GAME IS UNPLAYABLE.
 *
 * Conspiracies and Headlines are data, and some of their effects need a target
 * the engine cannot pick: `gain-any`, `lose-any`, `steal-any`, `evict-voter`,
 * `discard-voter`, `convert-voter` (`state.ts:Choice`). The engine raises them
 * on `ClientState.choices` and blocks on them — `END_TURN` returns "you have an
 * unresolved decision", and the per-player freeze at the top of `reduce` refuses
 * every other action. A client with no UI for these is a game that stops with a
 * button that does nothing.
 *
 * ONE COMPONENT, SIX SHAPES. The four resource-shaped choices share the
 * `ResourcePicker`, so a player learns the widget once (§5.4's reasoning, applied
 * to choices). The three area-shaped ones share a board-targeting mode, because
 * "choose two voters" is a board decision and pretending otherwise — with a list
 * of 129 checkboxes — is a worse interface for the same action.
 *
 * ON `requiredPicks`. The engine caps every ask at what is actually available
 * (`Math.min(count, …)` in `resolveChoice`), and this component asks for exactly
 * that number rather than the card's nominal count. Getting it wrong produces a
 * picker the server will refuse — the one outcome worse than not offering the
 * choice at all, because the player believes they have finished.
 *
 * IT IS MODAL AND IT BLOCKS. §5.9b: while a decision is owed, that decision is
 * the only thing the player can legally do, so it takes the viewport. Escape
 * does not dismiss it, because there is nothing behind it to go back to.
 */

import { useMemo, useState } from 'react';

import type { ClientState, PlayerID } from '@shasn/engine';

import { choosablePlayers, choosableZones, myChoices, targetableAreas, type MyChoice } from './derive.ts';
import { ResourcePicker } from './ResourcePicker.tsx';

export type ChoiceResolverProps = {
  readonly state: ClientState;
  readonly you: PlayerID;
  /** Areas already picked for an area-shaped choice. */
  readonly pickedAreaIds: readonly string[];
  readonly onPickArea: (areaId: string) => void;
  readonly onRemovePick: () => void;
  readonly onResolveResources: (choiceId: string, pick: Readonly<Record<string, number>>) => void;
  readonly onResolveSteal: (
    choiceId: string,
    from: string,
    pick: Readonly<Record<string, number>>,
  ) => void;
  readonly onResolveAreas: (choiceId: string, areaIds: readonly string[]) => void;
  /** G1 — answer a `'choose-player'`: the seat the card's actor named. */
  readonly onResolvePlayer: (choiceId: string, playerId: string) => void;
  /** G16 — answer a `'choose-zone'`: the constituency the card's actor named. */
  readonly onResolveZone: (choiceId: string, zoneId: string) => void;
  /** The draft the resource picker is holding, when it is for this choice. */
  readonly draft: Readonly<Record<string, number>>;
  readonly onDraft: (next: Readonly<Record<string, number>>) => void;
};

/** Does this choice need the board, or just the four denominations? */
function isAreaShaped(kind: string): kind is 'evict-voter' | 'discard-voter' | 'convert-voter' {
  return kind === 'evict-voter' || kind === 'discard-voter' || kind === 'convert-voter';
}

export function ChoiceResolver(props: ChoiceResolverProps) {
  const { state, you } = props;
  const owed = useMemo(() => myChoices(state, you), [state, you]);

  if (owed.length === 0) return null;
  // The engine processes one at a time, and the last is the important one, so
  // show the FIRST outstanding: a player resolving out of order gets confused by
  // a second dialog appearing behind the first.
  const first = owed[0];
  if (first === undefined) return null;

  const { pending, required, headline, reason } = first;
  const me = state.players[you];
  if (me === undefined) return null;
  /* One binding, narrowed once. `pending.choice.kind === …` inline in the JSX does not
     narrow the OBJECT the following call receives, so the two new branches read the
     discriminant through this local instead. */
  const owed0 = pending.choice;

  return (
    <div className="scrim" data-testid="choice-resolver">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choice-headline"
        data-testid="choice-dialog"
      >
        <h2 className="eyebrow">A DECISION IS OWED</h2>
        <h3 className="sheet__title" id="choice-headline">
          {headline}
        </h3>
        <p className="sheet__body">{reason}</p>

        {isAreaShaped(pending.choice.kind) ? (
          <AreaChoice
            state={state}
            you={you}
            choice={first}
            picked={props.pickedAreaIds}
            onPickArea={props.onPickArea}
            onRemovePick={props.onRemovePick}
            onResolve={props.onResolveAreas}
          />
        ) : owed0.kind === 'choose-player' ? (
          <NameChoice
            state={state}
            choice={first}
            ids={choosablePlayers(state, pending.player).map((id) => ({
              id,
              label: state.players[id]?.name ?? id,
            }))}
            onResolve={props.onResolvePlayer}
            noun="player"
            empty="This game has no other player, so there is nobody to choose."
          />
        ) : owed0.kind === 'choose-zone' ? (
          <NameChoice
            state={state}
            choice={first}
            ids={choosableZones(state, owed0).map((z) => ({ id: z.id, label: z.name }))}
            onResolve={props.onResolveZone}
            noun="constituency"
            empty="No constituency holds a voter this card could reach, so there is nothing to choose."
          />
        ) : owed0.kind === 'steal-any' ? (
          <StealChoice
            state={state}
            you={you}
            choice={first}
            draft={props.draft}
            onDraft={props.onDraft}
            onResolve={props.onResolveSteal}
          />
        ) : (
          <ResourcePicker
            /*
             * `mode` IS THE FIX, and `pool` is deliberately still the player's own
             * holdings — it is a LABEL here, not a ceiling.
             *
             * `gain-any` used to be rendered with `me.resources` as the ceiling,
             * which is a category error: "what you can afford" is a statement about
             * a COST, and the engine imposes no `canAfford` on a gain. A player
             * holding 0/0/0/0 and offered "gain 1 resource" therefore got a dialog
             * with no enabled control at all — every `Add` disabled because there
             * was nothing held to add FROM, and `TAKE 1` disabled because the draft
             * could not exceed the pool. Real 5-player playtesting, turn 7. The
             * table was locked until the server restarted.
             *
             * `lose-any` is the opposite and keeps the default: it is a cost, it
             * must come out of the pool, and the status line names any shortfall
             * beside the disabled control. The engine only ever asks for what is
             * held (`applyEffect` clamps, `enforceCap` clamps), so a cost is never
             * a dead end either — it is merely refused, with a reason.
             */
            mode={pending.choice.kind === 'gain-any' ? 'gain' : 'cost'}
            pool={me.resources}
            total={required}
            pick={props.draft}
            onPick={props.onDraft}
            heading={
              pending.choice.kind === 'gain-any'
                ? `Take exactly ${required}`
                : `Discard exactly ${required}`
            }
            confirmLabel={
              pending.choice.kind === 'gain-any' ? `TAKE ${required}` : `DISCARD ${required}`
            }
            onConfirm={() => props.onResolveResources(pending.id, props.draft)}
            /* No `onCancel`, and that is the correction rather than an omission.
               The old one was `() => undefined`: a Cancel button wired to a no-op,
               which reads as a way out of a decision that has none. `ResourcePicker`
               now renders no cancel control at all when the handler is absent, and
               this dialog is a decision — §5.9b — so it does not get one. */
            /* This sheet IS the dialog; the picker is its content. Rendering it
               as a second sheet put 42px of nested padding and border inside a
               356px content box at 390px and clipped the right edge — see
               `ResourcePicker`'s `nested` prop. */
            nested
          />
        )}

        {owed.length > 1 ? (
          <p className="panel__note panel__note--quiet">
            {owed.length - 1} more decision{owed.length - 1 === 1 ? '' : 's'} after this one.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * `evict-voter` / `discard-voter` / `convert-voter`.
 *
 * The board carries the picking: the caller puts the legal set into the board's
 * `place` mode with the right areas highlighted, and this dialog shows the
 * count. A list of 129 checkboxes would technically satisfy the requirement and
 * would be unusable.
 *
 * THE ZERO-TARGET CASE IS A RESOLUTION, NOT A STALL. When the card's ask exceeds
 * the board — "evict 3 voters" with 2 legal targets — the engine's own
 * `Math.min(count, targetableCount(...))` makes the ask 0, and `resolveChoice`
 * accepts an EMPTY `areaIds` for it. So the confirm is live at `0 of 0` and the
 * dialog closes on a press rather than on a hope. This is why `required` is
 * derived from the board rather than read off the card: a client that demanded
 * the card's nominal 3 here would be asking for something the server refuses, and
 * the player would click CONFIRM forever.
 */
function AreaChoice({
  state,
  you,
  choice,
  picked,
  onPickArea,
  onRemovePick,
  onResolve,
}: {
  state: ClientState;
  you: PlayerID;
  choice: MyChoice;
  picked: readonly string[];
  onPickArea: (areaId: string) => void;
  onRemovePick: () => void;
  onResolve: (choiceId: string, areaIds: readonly string[]) => void;
}) {
  const c = choice.pending.choice;
  /* `AreaChoice` is only ever rendered for the three area-shaped kinds (the
     parent's `isAreaShaped` decides), but the type is a six-way union, so the
     narrowing is restated rather than asserted. */
  if (c.kind !== 'evict-voter' && c.kind !== 'discard-voter' && c.kind !== 'convert-voter') {
    return null;
  }
  const kind = c.kind;
  /* THE SCOPE IS THE CARD'S, not the widget's. Mirroring `reduce.ts:targetableCount`
     here is what stops a `scope: 'own'` ask from being answered with a set the
     engine refuses — see `derive.ts:targetableCount`. */
  const scope = c.scope;
  const legal = useMemo(() => targetableAreas(state, you, kind, scope), [state, you, kind, scope]);
  const ready = picked.length === choice.required;
  const nothingToDo = choice.required === 0;
  const pickedInOneZone = useMemo(() => {
    const idx = new Set<string>();
    for (const id of picked) {
      for (const z of state.zones) {
        if (z.areas.some((a) => a.id === id)) {
          idx.add(z.id);
          break;
        }
      }
    }
    return idx.size;
  }, [picked, state.zones]);

  const verb = kind === 'evict-voter' ? 'evicted' : kind === 'convert-voter' ? 'converted' : 'discarded';

  return (
    <div className="col" data-testid="area-choice">
      <p className="panel__note" data-testid="area-choice-progress">
        {picked.length} of {choice.required} chosen.
        {choice.pending.choice.kind === 'convert-voter' && pickedInOneZone > 1
          ? ' Both must be in the same constituency and belong to the same player.'
          : ''}
      </p>

      {nothingToDo ? (
        /* The one sentence that makes an empty dialog honest. The card asked for
           more than the board holds, the engine capped the ask at what exists, and
           there is nothing left to choose — so say that, and make the only button
           the one that ends the decision. */
        <p className="panel__note" data-testid="area-choice-nothing">
          Nothing on the board can be {verb} — {legal.size} legal voter
          {legal.size === 1 ? '' : 's'} exist and {choice.pending.choice.count} were asked for.
          Confirm to take no action and carry on.
        </p>
      ) : kind === 'convert-voter' ? (
        <p className="panel__note panel__note--quiet">
          {legal.size} opponent voters can be converted. Volatile-Area voters are permanent and
          are not offered.
        </p>
      ) : (
        <p className="panel__note panel__note--quiet">
          {legal.size} voters can be {kind === 'evict-voter' ? 'evicted' : 'discarded'}. Volatile-Area
          voters are permanent and are not offered.
        </p>
      )}

      <div className="row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          aria-disabled={!ready}
          onClick={() => onResolve(choice.pending.id, picked)}
          data-testid="area-choice-confirm"
        >
          {nothingToDo ? 'CONFIRM — NOTHING TO DO' : `CONFIRM — ${picked.length} OF ${choice.required}`}
        </button>
        <button type="button" className="btn" onClick={onRemovePick} disabled={picked.length === 0}>
          UNDO
        </button>
      </div>

      <p className="panel__note panel__note--quiet">
        {nothingToDo
          ? 'No board click is needed — the decision is already decided for you.'
          : 'Close this and click the highlighted slots on the board.'}
      </p>
    </div>
  );
}

/**
 * `steal-any`. Two decisions in one: whose, and which.
 *
 * `choice.from` may be null, in which case the player picks a victim. When it is
 * set, the card named the player and this is only the denomination choice — the
 * two are the same widget with one fewer step, so they share the picker.
 */
function StealChoice({
  state,
  you,
  choice,
  draft,
  onDraft,
  onResolve,
}: {
  state: ClientState;
  you: PlayerID;
  choice: MyChoice;
  draft: Readonly<Record<string, number>>;
  onDraft: (next: Readonly<Record<string, number>>) => void;
  onResolve: (choiceId: string, from: string, pick: Readonly<Record<string, number>>) => void;
}) {
  const me = state.players[you];
  const kind = choice.pending.choice;
  const named = kind.kind === 'steal-any' ? kind.from : null;
  const asked = kind.kind === 'steal-any' ? kind.count : 0;

  const others = state.turnOrder.filter((id) => id !== you);
  const [victim, setVictim] = useState<string | null>(named);

  // A different card, or a different engine answer, must not leave a previous
  // victim's name on this screen — the "adjust state during render" pattern
  // React documents for exactly this, rather than an effect that paints one
  // wrong frame first.
  const victimKey = `${named ?? ''}`;
  const [lastKey, setLastKey] = useState(victimKey);
  if (lastKey !== victimKey) {
    setLastKey(victimKey);
    if (victim !== named) setVictim(named);
  }

  if (me === undefined) return null;
  const target = victim === null ? null : state.players[victim] ?? null;
  // The engine takes `min(count, victim's total)`, so the number to choose is
  // computed from what they actually hold — not from the card's nominal ask.
  const want = target === null ? 0 : Math.min(asked, totalOf(target.resources));

  if (target !== null) {
    return (
      <ResourcePicker
        /*
         * A THEFT IS A COST, and it is a cost out of somebody ELSE's pool — so
         * `cost` mode with the victim's holdings as the ceiling is exactly right.
         * The engine imposes the identical bound (`min(count, victim's total)`,
         * then `canAfford(victim.resources, pick)`), so a pick that satisfies this
         * widget always satisfies the server.
         *
         * The degenerate case is a VICTIM WHO HOLDS NOTHING, and it is NOT a dead
         * dialog: `want` is 0, `chosen` is 0, so the confirm is live at `0 of 0`
         * and the engine accepts the empty pick. `ResourcePicker` does not need a
         * special case for it; what it needs is for `want` to be computed against
         * the victim's real pool, which is what this line does.
         */
        pool={target.resources}
        total={want}
        pick={draft}
        onPick={onDraft}
        heading={`Take from ${target.name}`}
        confirmLabel={want === 0 ? `TAKE NOTHING — ${target.name} IS EMPTY` : `TAKE ${want}`}
        onConfirm={() => onResolve(choice.pending.id, target.id, draft)}
        /* Real behaviour, unlike a no-op: it un-names the victim and returns to
           the list, which is the one thing a player may still do here. */
        onCancel={() => setVictim(named)}
        nested
      />
    );
  }

  return (
    <div className="col" data-testid="steal-choice">
      <p className="panel__note">Choose whose resources to take.</p>
      {others.length === 0 ? (
        /*
         * Unreachable in a real game — `Lobby` refuses to start below two seats, and
         * `steal-any` with `from: null` is only raised by a card somebody played.
         * It is rendered rather than left as an empty list because an empty list is
         * indistinguishable from a broken one, and the engine has no resolution for
         * it either (`pick.kind === 'steal'` needs a victim who is not you). Stated
         * plainly so it reads as a rule edge, not a hang. Reported, not patched:
         * `packages/engine` is not mine.
         */
        <p className="panel__note panel__note--quiet" data-testid="steal-no-victims">
          There is nobody to take from — this game has no opponent. This decision
          cannot be resolved.
        </p>
      ) : null}
      {others.map((id) => {
        const p = state.players[id];
        if (p === undefined) return null;
        return (
          <button
            key={id}
            type="button"
            className="btn"
            onClick={() => setVictim(id)}
            data-testid="steal-victim"
          >
            {p.name} — {totalOf(p.resources)} held
          </button>
        );
      })}
    </div>
  );
}

/**
 * `'choose-player'` and `'choose-zone'` — ONE component, because they are ONE decision
 * with two vocabularies, and a player who has learned "pick one of these" should not
 * have to learn it twice.
 *
 * ## WHY THIS IS A LIST AND NOT THE BOARD
 *
 * A seat is a button and a constituency is nine buttons; neither is a spatial choice
 * over 129 slots, which is what `AreaChoice` is for. The board would be a worse
 * interface for the same action — the rule this file has followed since the area
 * shapes were split out.
 *
 * ## THE LIST IS THE ENGINE'S LIST, and that is the correctness argument
 *
 * `choosablePlayers` / `choosableZones` mirror `applyEffect`'s candidate set and
 * `resolveChoice`'s accepted set, which are the same expression. So every button here
 * is accepted by the server and there is always at least one. **A choice with an empty
 * candidate set never reaches this component** — `applyEffect` raises nothing — so the
 * empty branch below is a stated rule edge rather than a stall, the same treatment
 * `StealChoice`'s no-victims note gets.
 *
 * ## IT SHOWS NO HIDDEN INFORMATION, and that is a design constraint not a coincidence
 *
 * The player list is `turnOrder` minus you: every seat, including players holding no
 * resources and no cards. Filtering by what somebody holds would turn this dialog into
 * a readout of their Mat and their hand, which is the same leak the engine refuses for
 * `ideologyCards` — an option list is as revealing as a value. The zone list is pegs
 * on a public board.
 */
function NameChoice({
  state: _state,
  choice,
  ids,
  onResolve,
  noun,
  empty,
}: {
  state: ClientState;
  choice: MyChoice;
  ids: readonly { readonly id: string; readonly label: string }[];
  onResolve: (choiceId: string, id: string) => void;
  noun: string;
  empty: string;
}) {
  return (
    <div className="col" data-testid="name-choice">
      <p className="panel__note">Choose a {noun}.</p>
      {ids.length === 0 ? (
        <p className="panel__note panel__note--quiet" data-testid="name-choice-empty">
          {empty}
        </p>
      ) : null}
      {ids.map((x) => (
        <button
          key={x.id}
          type="button"
          className="btn"
          onClick={() => onResolve(choice.pending.id, x.id)}
          data-testid="name-choice-option"
          data-name={x.id}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

function totalOf(p: { funds: number; clout: number; media: number; trust: number }): number {
  return p.funds + p.clout + p.media + p.trust;
}
