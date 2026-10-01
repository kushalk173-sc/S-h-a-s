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

import { myChoices, targetableAreas, type MyChoice } from './derive.ts';
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
        ) : pending.choice.kind === 'steal-any' ? (
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
            onCancel={() => undefined}
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
  const kind = choice.pending.choice.kind;
  const legal = useMemo(
    () =>
      kind === 'evict-voter' || kind === 'discard-voter' || kind === 'convert-voter'
        ? targetableAreas(state, you, kind)
        : new Set<string>(),
    [state, you, kind],
  );
  const ready = picked.length === choice.required;
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

  return (
    <div className="col" data-testid="area-choice">
      <p className="panel__note" data-testid="area-choice-progress">
        {picked.length} of {choice.required} chosen.
        {choice.pending.choice.kind === 'convert-voter' && pickedInOneZone > 1
          ? ' Both must be in the same constituency and belong to the same player.'
          : ''}
      </p>

      {kind === 'convert-voter' ? (
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
          CONFIRM — {picked.length} OF {choice.required}
        </button>
        <button type="button" className="btn" onClick={onRemovePick} disabled={picked.length === 0}>
          UNDO
        </button>
      </div>

      <p className="panel__note panel__note--quiet">
        Close this and click the highlighted slots on the board.
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
        pool={target.resources}
        total={want}
        pick={draft}
        onPick={onDraft}
        heading={`Take from ${target.name}`}
        confirmLabel={`TAKE ${want}`}
        onConfirm={() => onResolve(choice.pending.id, target.id, draft)}
        onCancel={() => setVictim(named)}
        nested
      />
    );
  }

  return (
    <div className="col" data-testid="steal-choice">
      <p className="panel__note">Choose whose resources to take.</p>
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

function totalOf(p: { funds: number; clout: number; media: number; trust: number }): number {
  return p.funds + p.clout + p.media + p.trust;
}
