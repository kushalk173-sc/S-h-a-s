/**
 * The two board-docked bars: placement and gerrymander.
 *
 * BOTH DOCK AT THE BOTTOM OF THE BOARD COLUMN, not the mat, because both narrate
 * a decision that is being made ON the board (§5.5, §5.6). Putting them on the
 * mat would put the instruction somewhere the player is not looking while they
 * look at the board.
 *
 * BOTH HAVE UNDO-BEFORE-CONFIRM, and both say why.
 *
 *   §6.1.4 — placement writes `Area.peg` and triggers `recount()`. A majority
 *   formed by the placement is FORMED; breaking it costs a power and a turn. An
 *   accidental click is a resource cost, not a five-second mistake. The confirm
 *   button is not generic: it reads `PLACE 3 IN NORTH`, so the confirm is a
 *   statement of what will happen.
 *
 *   §6.2 — a gerrymander moves a peg that already exists. A `CONFIRM MOVE` bar
 *   with `CANCEL` covers the accidental tap, and on a touch device it
 *   auto-dismisses to CANCEL after four seconds (§5.13) — an accidental tap on a
 *   phone is not distinguishable from an intended one by feel.
 *
 * §6.1.2 step 4 AND §9.10 ARE THE SAME RULE: an illegal click is never a silent
 * no-op. The board's own matrix hatches the illegal slot and names the reason in
 * its accessible label, and this bar repeats the reason in prose for 1.2s in
 * `NEGATIVE`. A constraint that does not explain itself is a puzzle.
 */

import { useEffect, useMemo, useState } from 'react';

import type { ClientState, PendingVoters, PlayerID, ZoneID } from '@shasn/engine';

import {
  gerrymanderRefusal,
  gerrymanderUsed,
  lockedZoneFor,
  placementConsequence,
  placementRefusal,
  rightsHolder,
  strandedSentence,
} from './derive.ts';
import { UI_RULES } from './derive.ts';

// ─────────────────────────── placement ───────────────────────────

export type PlacementBarProps = {
  readonly state: ClientState;
  readonly you: PlayerID;
  readonly group: PendingVoters;
  readonly picks: readonly string[];
  readonly refusal: { readonly text: string; readonly at: number } | null;
  readonly onUndo: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

export function PlacementBar(props: PlacementBarProps) {
  const { state, group, picks, refusal } = props;
  const locked = lockedZoneFor(state, group, picks);
  const idx = useMemo(() => {
    const m = new Map<string, { zoneId: ZoneID; zoneName: string; free: number; volatile: boolean }>();
    for (const z of state.zones) {
      const free = z.areas.filter((a) => a.peg === null).length;
      for (const a of z.areas) {
        m.set(a.id, { zoneId: z.id, zoneName: z.name, free, volatile: a.volatile });
      }
    }
    return m;
  }, [state.zones]);

  const receipt = placementConsequence(state, props.you, picks);
  const ready = picks.length === group.count;
  /*
    THE GROUP FITS NOWHERE. The bar says so on entry, before a single slot is
    picked, because the player opened this bar to find out whether they can place
    these voters and the answer is no. The engine's rule is p10's own — all of them
    are discarded — and this client says that in words rather than leaving the bar
    to offer slots that `PLACE_VOTERS` will refuse.
  */
  const stranded = strandedSentence(state, group.id);
  // Clamped, so an over-full draft can never render "-1 more needed here". The
  // click that produced it is refused upstream, but a bar that prints a negative
  // count is worse than one that prints nothing.
  const moreNeeded = Math.max(0, group.count - picks.length);
  const overPicked = picks.length > group.count;
  const lockedName = locked === null ? null : state.zones.find((z) => z.id === locked)?.name ?? null;
  const lockedFree = locked === null ? 0 : state.zones.find((z) => z.id === locked)?.areas.filter((a) => a.peg === null).length ?? 0;

  /** The refusal fades after 1.2s (§6.1.2 step 4), then the line returns to the constraint. */
  const [refusalLive, setRefusalLive] = useState(false);
  useEffect(() => {
    if (refusal === null) {
      setRefusalLive(false);
      return;
    }
    setRefusalLive(true);
    const t = setTimeout(() => setRefusalLive(false), 1200);
    return () => clearTimeout(t);
  }, [refusal]);

  return (
    <div className="bar" data-testid="placement-bar">
      <p className="bar__head">
        <strong>◈ {group.count} voters</strong>
        <span className="chip">{group.source}</span>
        {group.sameZone ? <span className="chip chip--positive">MUST SHARE ONE ZONE</span> : null}
        {stranded !== null ? (
          <span className="chip chip--negative" data-testid="placement-stranded">
            NO ROOM ANYWHERE
          </span>
        ) : null}
        <span className="chip" data-testid="placement-counter">
          {picks.length} of {group.count} placed
        </span>
      </p>

      {/* The 9-cell free-slot strip: the same-zone rule is legible as ARITHMETIC
          before it is legible as a rule (§5.5). */}
      <div className="zones-strip" aria-hidden="true">
        {state.zones.map((z) => {
          const free = z.areas.filter((a) => a.peg === null).length;
          const picked = picks.filter((id) => idx.get(id)?.zoneId === z.id).length;
          return (
            <span
              key={z.id}
              className={`zones-strip__cell ${picked > 0 ? 'zones-strip__cell--picked' : ''} ${
                locked === z.id ? 'zones-strip__cell--locked' : ''
              }`}
              title={`${z.name}: ${free} free`}
            >
              {zoneInitials(z.name)} {free}
            </span>
          );
        })}
      </div>

      <p
        className={`bar__constraint ${stranded !== null ? 'bar__constraint--refused' : ''} ${refusalLive ? 'bar__constraint--refused' : ''}`}
        role="status"
        data-testid="placement-constraint"
      >
        {stranded !== null ? (
          stranded
        ) : refusalLive && refusal !== null ? (
          refusal.text
        ) : lockedName === null
            ? group.sameZone
              ? 'Pick a slot. The first pick fixes the zone — the rest must join it.'
              : 'Pick up to ' + group.count + ' empty slots. They may go in any zones.'
            : overPicked
              ? 'Too many slots chosen — UNDO to pick a different one.'
              : `${lockedName} — ${lockedFree} free slot${lockedFree === 1 ? '' : 's'}, ${moreNeeded} more needed here.`}
      </p>

      {/* §6.1.4: the consequence is spelled out BEFORE the click, because after the
          click it is history. A receipt, never a suggestion (§9.12). */}
      {receipt !== null ? (
        <p className="bar__constraint" data-testid="placement-receipt">
          {receipt.zoneName}: {receipt.before} → {receipt.after}.{' '}
          {receipt.majorityForms
            ? `MAJORITY FORMS (+${receipt.majorityNeeded} points).`
            : `No majority (${receipt.majorityNeeded} needed).`}
          {receipt.volatileHits > 0
            ? ` ⚑ ${receipt.volatileHits} Volatile Area${receipt.volatileHits === 1 ? '' : 's'} — triggers a Headline at end of turn.`
            : ''}
        </p>
      ) : null}

      <div className="bar__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          aria-disabled={!ready}
          onClick={props.onConfirm}
          data-testid="placement-confirm"
        >
          {/* Not a generic label: the count and the zone, so the confirm is a
              statement of what will happen. */}
          {ready && lockedName !== null
            ? `PLACE ${picks.length} IN ${lockedName.toUpperCase()}`
            : `CONFIRM PLACEMENT`}
        </button>
        <button type="button" className="btn" onClick={props.onUndo} disabled={picks.length === 0}>
          UNDO
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── gerrymander ───────────────────────────

export type GerryBarProps = {
  readonly state: ClientState;
  readonly you: PlayerID;
  readonly zoneId: ZoneID;
  readonly sourceAreaId: string | null;
  readonly targetAreaId: string | null;
  readonly refusal: { readonly text: string; readonly at: number } | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/** §5.6 step 5: the whole legality rule, printed, always visible. */
export const GERRY_RULE =
  'Move one voter. From: any voter you own that is not a majority voter and not in a square slot. ' +
  'To: an empty slot in your zone, an adjacent zone, or elsewhere — but you cannot move your only ' +
  'voter out of the zone whose rights you are using. Your voters and theirs both move.';

export function GerryBar(props: GerryBarProps) {
  const { state, you, zoneId, sourceAreaId, targetAreaId, refusal } = props;
  const zone = state.zones.find((z) => z.id === zoneId);
  const rights = rightsHolder(state, zoneId);
  const holderName = rights.player === null ? null : state.players[rights.player]?.name ?? null;
  const used = gerrymanderUsed(state, you, zoneId);
  const budget = UI_RULES.gerrymandersPerZone;

  const [refusalLive, setRefusalLive] = useState(false);
  useEffect(() => {
    if (refusal === null) {
      setRefusalLive(false);
      return;
    }
    setRefusalLive(true);
    const t = setTimeout(() => setRefusalLive(false), 1200);
    return () => clearTimeout(t);
  }, [refusal]);

  const src = sourceAreaId === null ? null : areaOf(state, sourceAreaId);
  const dst = targetAreaId === null ? null : areaOf(state, targetAreaId);
  const refusalNow =
    sourceAreaId !== null && targetAreaId !== null
      ? gerrymanderRefusal(state, you, zoneId, sourceAreaId, targetAreaId)
      : null;
  const ready = refusalNow === null && sourceAreaId !== null && targetAreaId !== null;

  return (
    <div className="bar" data-testid="gerry-bar">
      <p className="bar__head">
        <strong>GERRYMANDER</strong>
        <span className="chip">{zone?.name ?? zoneId}</span>
        {rights.player === you ? (
          <span className="chip chip--positive">⚑ RIGHTS</span>
        ) : (
          <span className="chip">⊘ NO RIGHTS</span>
        )}
        {rights.tied ? <span className="chip chip--warn">TIED — NOBODY HAS RIGHTS</span> : null}
        <span className="chip" data-testid="gerry-counter">
          {Math.min(used + 1, budget)} of {budget} used
        </span>
      </p>

      {/* G5's last clause gets its own line because it is the one players
          discover by breaking it (§5.6). */}
      <p className="bar__constraint">{GERRY_RULE}</p>

      <p
        className={`bar__constraint ${refusalLive ? 'bar__constraint--refused' : ''}`}
        role="status"
        data-testid="gerry-legality"
      >
        {refusalLive && refusal !== null
          ? refusal.text
          : src === null
            ? 'Pick a voter of yours that is not a majority voter and not in a square slot.'
            : dst === null
              ? `From ${src.zoneName}. Now pick an empty slot to move it to.`
              : `${src.zoneName} → ${dst.zoneName}${
                  holderName === null ? '' : ` · rights held by ${holderName}`
                }`}
      </p>

      <div className="bar__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready}
          aria-disabled={!ready}
          onClick={props.onConfirm}
          data-testid="gerry-confirm"
        >
          CONFIRM MOVE
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

function areaOf(
  state: ClientState,
  areaId: string,
): { zoneId: ZoneID; zoneName: string; peg: { owner: string; majority: boolean } | null; volatile: boolean } | null {
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === areaId);
    if (a !== undefined) {
      return { zoneId: z.id, zoneName: z.name, peg: a.peg, volatile: a.volatile };
    }
  }
  return null;
}

export { placementRefusal };

/**
 * A constituency as compass initials — `North West` → `NW`, `Central` → `C`.
 *
 * The strip used to print the first three letters, and six of the nine names start
 * with `Nor` or `Sou`: the strip read `Nor 11 · Nor 21 · Nor 11`, three different
 * zones that looked identical. Initials are unique for all nine and fit the cell.
 */
export function zoneInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
