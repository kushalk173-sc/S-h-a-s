/**
 * The game screen: the §5.0 shell with whichever regions are live.
 *
 * SCREENS ARE STATES, NOT ROUTES (§5). This component never unmounts the board;
 * it changes which regions are populated around it. That is not a stylistic
 * choice — a board that remounts on a phase change loses the player's focus
 * position, re-runs 129 slot renders, and drops any in-progress local pick. So
 * there is exactly one `BoardSvg` in the tree and it is here, always.
 *
 * THE RENDER ORDER IS LOAD-BEARING, and it is a priority order, not a layout one:
 *
 *   1. the shell (board + mat + log)      — always
 *   2. `AnswerScreen`                     — §5.3, a full-viewport takeover
 *   3. `HeadlineDialog`                   — §5.9b, a full-viewport takeover
 *   4. `ChoiceResolver`                   — §5.9b's decisions, ABOVE the headline,
 *                                          because a Headline's effects are what
 *                                          RAISE the choice, so the choice must be
 *                                          answerable before the acknowledge is
 *                                          offered or the player is stuck behind a
 *                                          dialog whose button refuses.
 *
 * THE 3-REGION RULE (§5.0): exactly one region is `SEAL`-framed at a time. The
 * frame moves: to the answer panel during `answer`, to your mat during actions
 * and placement and gerrymandering, to the card being resolved during a
 * Headline, and NOWHERE when it is not your turn — a `TABLE_600` banner instead,
 * because a framed region with nothing in it reads as "something is wrong with
 * your turn" when the truth is "it is not your turn".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  Action,
  ClientState,
  Delta,
  LogEntry,
  PlayerID,
  Resource,
  ZoneID,
} from '@shasn/engine';

import { BoardSvg } from '../board/BoardSvg.tsx';
import type { BlindPrompt, ClientStore } from '../net/index.ts';

import { AnswerReveal, AnswerScreen } from './AnswerScreen.tsx';
import { ChoiceResolver } from './ChoiceResolver.tsx';
import { ConspiracyPicker, type PlayableConspiracy } from './ConspiracyPicker.tsx';
import { ErrorToast, HeadlineDialog, LinkDot, LogRail, ReconnectScreen, Scoreboard } from './Panels.tsx';
import { GerryBar, PlacementBar } from './BoardBars.tsx';
import { ResourcePicker } from './ResourcePicker.tsx';
import { YourMat, MarketPanel } from './YourMat.tsx';
import {
  addPick,
  addToughLovePick,
  applyConnectionStatus,
  beginPlacement,
  clearPowerTarget,
  clearMarketModifier,
  clearMarketPower,
  clearToughLove,
  clearTurnInteraction,
  closePicker,
  closeTrade,
  endGerry,
  endPlacement,
  openGerry,
  openPicker,
  openTrade,
  powerAreaCount,
  powerTargetsArea,
  removePick,
  removeToughLovePick,
  setGerrySource,
  setGerryTarget,
  setMarketModifier,
  setMarketPower,
  setPowerTarget,
  setRefusal,
  setTradeGive,
  setTradeReceive,
  useApp,
  type AppState,
  type PowerFlow,
} from './store.ts';
import { connection, send } from './session.ts';
import { clearError } from '../net/index.ts';
import { MarketModifierDialog, PowerDialog, type PowerSubmit } from './PowerDialog.tsx';
import {
  IDLE_INTERACTION,
  RESOURCE_ORDER,
  UI_RULES,
  actions,
  canAfford,
  deltaTotal,
  gerrymanderRefusal,
  lockedZoneFor,
  placementRefusal,
  rightsZones,
  targetableAreas,
  toBoardState,
  type BoardInteraction,
} from './derive.ts';

export type GameScreenProps = {
  readonly store: ClientStore;
};

export function GameScreen({ store }: GameScreenProps) {
  const app = useApp();
  const state = store.state;
  const you = store.you.playerId;
  const role = store.you.role;

  // THE LIFECYCLE, AND WHY NOTHING BELOW ASSERTS `state` IS NOT NULL.
  //
  // `state` is null until the server's first `match:state` lands, and it goes null
  // again if the credential is revoked. Both are ordinary states, not error states:
  // a cold load, and a reconnect that has not yet been answered. The component
  // therefore computes every derived value against a null-SAFE view and defers the
  // early return until after the hooks, because returning first would change the
  // hook count between renders and React would throw.
  //
  // There is no `state!` anywhere below. `!` would silence the compiler without
  // making the runtime any safer: the same reconnect that makes `state` null would
  // then crash the render instead of showing the reconnect screen, which is the
  // one thing a four-hour game must not do.
  const isMyTurn = role === 'player' && you !== null && state !== null && state.activePlayer === you;

  // The phone tab bar (§5.13). Below 600px the mat and market become tabs and
  // the board is the default, because a cold load should show the board rather
  // than a wall of numbers.
  const [tab, setTab] = useState<'board' | 'mat' | 'market' | 'log'>('board');

  // A new turn clears the local interaction state. Without this, a player who
  // disconnects mid-placement comes back to picks for a group the engine has
  // already discarded.
  //
  // `store.viewId`, NOT `state.viewId`: `viewId` is the sync ENVELOPE's field
  // (`net/protocol.ts`), which is what makes a re-applied `match:state` a new
  // render even when the board is identical. `ClientState` has no such field —
  // `state.viewId` was the second half of the same mistake as the import.
  useEffect(() => {
    clearTurnInteraction();
  }, [store.viewId, state?.turn]);

  const me = state === null || you === null ? null : state.players[you] ?? null;

  /*
    THE SERVER'S PLAYABLE-CONSPIRACY LIST, read once.

    Two consumers need it — the market panel's PLAY button and the dialog itself —
    and they must never disagree about whether the player has a card to play. So it
    is computed once here rather than twice at the two call sites, where a future
    edit to one and not the other would produce a button that opens a dialog with
    nothing in it: §9.10's prohibited control, arrived at from the other direction.

    `undefined` (the server did not send the field) is distinct from `[]` (it sent
    it and the answer is none), and the PLAY button only appears for the second.
  */
  const myConspiracies = useMemo(
    () => (state === null ? undefined : playableConspiracies(state, you)),
    [state, you],
  );

  const interaction = useMemo<BoardInteraction>(() => {
    if (state === null) return IDLE_INTERACTION;

    // A pending area-shaped choice takes the board: "choose two voters" is a
    // board decision, and a list of 129 checkboxes would be the same action
    // with a worse interface.
    const owedAreaChoice = state.choices.find(
      (c) =>
        c.player === you &&
        (c.choice.kind === 'evict-voter' ||
          c.choice.kind === 'discard-voter' ||
          c.choice.kind === 'convert-voter'),
    );
    if (owedAreaChoice !== undefined) {
      const kind = owedAreaChoice.choice.kind;
      const legal =
        kind === 'evict-voter' || kind === 'discard-voter' || kind === 'convert-voter'
          ? targetableAreas(state, you as PlayerID, kind)
          : new Set<string>();
      return {
        mode: 'place',
        pickedAreaIds: app.toughLovePicks.filter((id) => legal.has(id)),
        lockedZoneId: null,
        gerrySourceAreaId: null,
        resolveGerrySources: false,
        disabled: false,
      };
    }

    if (app.gerryZoneId !== null) {
      return {
        mode: 'gerry',
        pickedAreaIds: [],
        lockedZoneId: null,
        gerrySourceAreaId: app.gerrySourceAreaId,
        // §6.2 "Enter": no peg changes appearance on mode entry, because a board
        // that flashes 129 overlays on a toggle reads as a glitch.
        resolveGerrySources: app.gerrySourceAreaId !== null,
        disabled: false,
      };
    }

    if (app.placingGroupId !== null && isMyTurn) {
      const group = me?.pending.find((g) => g.id === app.placingGroupId) ?? null;
      if (group !== null) {
        const locked = lockedZoneFor(state, group, app.pickedAreaIds);
        return {
          mode: 'place',
          pickedAreaIds: app.pickedAreaIds,
          lockedZoneId: locked,
          gerrySourceAreaId: null,
          resolveGerrySources: false,
          disabled: false,
        };
      }
    }

    // A power that targets slots puts the board in the same `place` mode with the
    // slots it has collected so far. It is checked AFTER placement because a player
    // mid-placement has already committed to a group, and yanking the board out from
    // under them to answer a power would be worse than making them cancel first.
    if (powerTargetsArea(app.powerTarget) && isMyTurn) {
      return {
        mode: 'place',
        pickedAreaIds: app.pickedAreaIds,
        lockedZoneId: null,
        gerrySourceAreaId: null,
        resolveGerrySources: false,
        disabled: false,
      };
    }

    return { ...IDLE_INTERACTION, disabled: !isMyTurn };
  }, [state, app.placingGroupId, app.pickedAreaIds, app.gerryZoneId, app.gerrySourceAreaId, app.toughLovePicks, app.powerTarget, isMyTurn, me, you]);

  // ─────────────────────────── board interaction ───────────────────────────

  const onSlotActivate = useCallback(
    (areaId: string) => {
      if (state === null) return;

      // 1. A pending area-shaped choice owns the board.
      const owedAreaChoice = state.choices.find(
        (c) =>
          c.player === you &&
          (c.choice.kind === 'evict-voter' ||
            c.choice.kind === 'discard-voter' ||
            c.choice.kind === 'convert-voter'),
      );
      if (owedAreaChoice !== undefined && you !== null) {
        const kind = owedAreaChoice.choice.kind;
        if (kind !== 'evict-voter' && kind !== 'discard-voter' && kind !== 'convert-voter') return;
        const legal = targetableAreas(state, you, kind);
        if (!legal.has(areaId)) {
          setRefusal('that voter cannot be chosen — Volatile-Area voters are permanent');
          return;
        }
        if (app.toughLovePicks.includes(areaId)) {
          removeToughLovePick();
          return;
        }
        if (app.toughLovePicks.length >= owedAreaChoice.choice.count) {
          setRefusal(`you may only choose ${owedAreaChoice.choice.count}`);
          return;
        }
        addToughLovePick(areaId);
        return;
      }

      // 2. A gerrymander in flight: first click arms a source, second picks a
      //    destination. Tap-source → tap-destination is also the phone
      //    interaction (§5.13) — no drag-only path anywhere.
      if (app.gerryZoneId !== null && you !== null) {
        if (app.gerrySourceAreaId === null) {
          const refusal = gerrySourceRefusal(state, you, app.gerryZoneId, areaId);
          if (refusal !== null) {
            setRefusal(refusal);
            return;
          }
          setGerrySource(areaId);
          return;
        }
        const refusal = gerrymanderRefusal(state, you, app.gerryZoneId, app.gerrySourceAreaId, areaId);
        if (refusal !== null) {
          setRefusal(refusal);
          return;
        }
        setGerryTarget(areaId);
        return;
      }

      // 3. Placing a pending group.
      if (app.placingGroupId !== null && me !== null && isMyTurn) {
        const group = me.pending.find((g) => g.id === app.placingGroupId);
        if (group === undefined) return;
        if (app.pickedAreaIds.includes(areaId)) {
          setRefusal('already chosen for this group');
          return;
        }
        // A Voter Card's voters cannot be split or partially placed, so the group is
        // ALL-OR-NOTHING at `group.count`. Without this the bar happily accepted a
        // second slot for a one-voter group and then read "2 of 1 placed — -1 more
        // needed", and the server would have refused the placement: a constraint the
        // player only discovers by pressing Confirm.
        if (app.pickedAreaIds.length >= group.count) {
          setRefusal(`this group is already complete — undo a pick to choose a different slot`);
          return;
        }
        const refusal = placementRefusal(state, group, app.pickedAreaIds, areaId);
        if (refusal !== null) {
          // §6.1.2 step 4 / §9.10: an illegal click is never a silent no-op.
          setRefusal(refusal);
          return;
        }
        addPick(areaId);
        return;
      }

      // 4. A power that targets slots. Deliberately LAST: placement and an owed
      //    choice both outrank a power, because both are commitments the engine is
      //    already blocking on, while a power can always be cancelled.
      if (powerTargetsArea(app.powerTarget) && isMyTurn) {
        const flow = app.powerTarget;
        if (flow === null) return;
        if (app.pickedAreaIds.includes(areaId)) {
          removePick();
          return;
        }
        const refusal = powerAreaRefusal(state, you, flow, areaId, app.pickedAreaIds);
        if (refusal !== null) {
          setRefusal(refusal);
          return;
        }
        addPick(areaId);
      }
    },
    [state, you, app, me, isMyTurn],
  );

  // ─────────────────────────── dispatches ───────────────────────────

  /**
   * The one write door this component has.
   *
   * `send` turns a `false` from the socket into a visible refusal rather than a
   * silently-dead button, which is why it is `send(fn)` and not `c.dispatch(a)`
   * inline: the caller never learns whether the press landed, so every caller
   * routes through here where the refusal is raised once.
   *
   * IT RETURNS THE BOOLEAN, because one caller needs it. `AnswerScreen` cannot
   * say "sending your answer" unless the frame actually left the socket; a press
   * that never left must re-arm the control rather than show an in-flight state
   * that resolves to nothing. Every other caller ignores the return value, which
   * is legal against a `void`-returning signature.
   */
  const dispatch = useCallback((action: Action): boolean => {
    return send((c) => c.dispatch(action));
  }, []);

  /**
   * Turn a power dialog's answer into the engine's action, and close the flow.
   *
   * Every branch dispatches and then clears. The clears are not tidiness: `clearTurnInteraction`
   * on the next `match:state` would do it eventually, but between the dispatch and that
   * state the dialog would still be on screen over a board the server has already changed,
   * which is the one frame where a player could double-submit against a stale legal set.
   */
  const commitPower = useCallback(
    (submit: PowerSubmit) => {
      switch (submit.kind) {
        case 'prospect':
          dispatch(actions.prospecting(submit.give, submit.take));
          break;
        case 'land-grab':
          dispatch(actions.landGrab(submit.areaId));
          break;
        case 'donations':
          dispatch(actions.donations(submit.from, submit.res));
          break;
        case 'payback':
          dispatch(actions.payback(submit.areaId, submit.pay));
          break;
        case 'tough-love':
          dispatch(actions.toughLove(submit.areaIds, submit.pay));
          break;
      }
      clearPowerTarget();
      endPlacement();
    },
    [dispatch],
  );

  const live = app.link === 'live';

  // ─────────────────────────── the payout frame (§9.3) ───────────────────────────
  //
  // ONE frame, then it is gone. It is driven by the PUBLIC LOG, not by the
  // `answered` EVENT, and that is not a preference: the server sends `match:state`
  // before `match:events` for the same `viewId`, while `net/store.ts:applyEvents`
  // drops any `viewId <= store.viewId` — so no events ever reach `recentEvents` at
  // all (reported; `net/` is not this file's to change). The log is in `ClientState`
  // for every player, so it always arrives, and reading it leaks nothing the other
  // players cannot already read.
  //
  // Nothing counts up, nothing flips, and there is no "you would have got" line,
  // because every one of those animates on a length that leaks to whoever watched it.
  const answerCount =
    state === null || you === null
      ? 0
      : state.log.filter((e) => e.kind === 'answer' && e.player === you).length;

  // A reveal only for an answer that lands WHILE this player is watching. The first
  // sighting is a baseline, so a refresh mid-turn does not replay the last payout —
  // which matters on reconnect, where re-announcing a payout would also be noise.
  const seenAnswers = useRef<number | null>(null);
  const [revealLive, setRevealLive] = useState(false);
  useEffect(() => {
    if (seenAnswers.current === null) {
      seenAnswers.current = answerCount;
      return;
    }
    if (answerCount <= seenAnswers.current) {
      seenAnswers.current = answerCount;
      return;
    }
    seenAnswers.current = answerCount;
    setRevealLive(true);
    const t = window.setTimeout(() => setRevealLive(false), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [answerCount]);

  const showReveal =
    revealLive && you !== null && state !== null && state.phase === 'actions';
  const answeredLabel =
    showReveal && state !== null && you !== null ? lastAnswerText(state.log, you) : null;

  const commitPlacement = useCallback(() => {
    if (me === null || app.placingGroupId === null) return;
    const group = me.pending.find((g) => g.id === app.placingGroupId);
    if (group === undefined) return;
    if (app.pickedAreaIds.length !== group.count) {
      setRefusal(`place all ${group.count} — a Voter Card's voters cannot be split or partially placed`);
      return;
    }
    dispatch(actions.placeVoters(group.id, app.pickedAreaIds));
    endPlacement();
  }, [me, app.placingGroupId, app.pickedAreaIds, dispatch]);

  const commitGerry = useCallback(() => {
    if (you === null || state === null || app.gerryZoneId === null) return;
    if (app.gerrySourceAreaId === null || app.gerryTargetAreaId === null) return;
    const refusal = gerrymanderRefusal(
      state,
      you,
      app.gerryZoneId,
      app.gerrySourceAreaId,
      app.gerryTargetAreaId,
    );
    if (refusal !== null) {
      setRefusal(refusal);
      return;
    }
    dispatch(actions.gerrymander(app.gerryZoneId, app.gerrySourceAreaId, app.gerryTargetAreaId));
    endGerry();
  }, [you, state, app, dispatch]);

  // ─────────────────────────── phases ───────────────────────────

  if (state === null) {
    return <ReconnectScreen {...reconnectProps(app, store, onRetry, onLeave)} />;
  }

  // The scoreboard replaces the shell entirely (§5: only Lobby and Scoreboard do).
  if (state.finished) {
    return (
      <Scoreboard
        state={state}
        you={you}
        onViewBoard={() => undefined}
        onNewMatch={() => {
          clearTurnInteraction();
          connection().forget();
          window.location.reload();
        }}
      />
    );
  }

  const boardState = toBoardState(state, interaction);
  const placingGroup =
    app.placingGroupId === null || me === null
      ? null
      : me.pending.find((g) => g.id === app.placingGroupId) ?? null;
  const owedChoice = state.choices.find((c) => c.player === you) ?? null;

  const liveMessage = describeForScreenReader(state, isMyTurn, store.blind !== null, you);

  return (
    <div
      className="shell"
      data-testid="game-shell"
      // The one-frame payout pushes the board down by ~192px, so the board's
      // `max-height` reserve has to know. See the `.shell[data-reveal]` rule.
      data-reveal={showReveal ? 'true' : 'false'}
    >
      <TopBar state={state} store={store} you={you} role={role} />

      {showReveal ? (
        <AnswerReveal state={state} you={you as PlayerID} answeredLabel={answeredLabel} />
      ) : null}

      <div className="shell__body">
        {/*
          THE BOARD NEEDS AN INTRINSIC HEIGHT, OR IT RENDERS AT 0×0.

          `BoardSvg` takes `width` and an optional `height` that defaults to the
          viewBox aspect. Given `width="100%"` and no height, the SVG is a flex item in
          `.shell__board` (a COLUMN flex box), so its cross-size is content-based — and
          an SVG with no intrinsic height has none. The board collapsed to literally
          zero pixels: 258 SVG nodes in the DOM and nothing on screen.

          The fix is an aspect-ratio on the canvas wrapper, matching the board's own
          1000×1500 viewBox, plus `height="100%"` so the SVG fills it. The board
          component is another agent's file; this needs no change there, because it
          already accepts both props.
        */}
        <div className="shell__board tabs" data-tabpanel="board" data-active={tab === 'board'}>
          <div className="board__canvas">
            <BoardSvg
              state={boardState}
              width="100%"
              height="100%"
              onSlotActivate={onSlotActivate}
              resolveGerrySources={false}
              liveMessage={liveMessage}
            />
          </div>

          {placingGroup !== null ? (
            <PlacementBar
              state={state}
              you={you as PlayerID}
              group={placingGroup}
              picks={app.pickedAreaIds}
              refusal={app.refusal}
              onUndo={removePick}
              onCancel={endPlacement}
              onConfirm={commitPlacement}
            />
          ) : null}

          {app.gerryZoneId !== null && you !== null ? (
            <GerryBar
              state={state}
              you={you}
              zoneId={app.gerryZoneId}
              sourceAreaId={app.gerrySourceAreaId}
              targetAreaId={app.gerryTargetAreaId}
              refusal={app.refusal}
              onCancel={endGerry}
              onConfirm={commitGerry}
            />
          ) : null}
        </div>

        <div className="shell__side">
          <div className="tabs" data-tabpanel="mat" data-active={tab === 'mat'}>
            <YourMat
              state={state}
              you={you as PlayerID}
              pending={me?.pending ?? []}
              placingGroupId={app.placingGroupId}
              pickedCount={app.pickedAreaIds.length}
              isMyTurn={isMyTurn}
              link={app.link}
              framed={isMyTurn && state.phase === 'actions'}
              showControls={role === 'player' && you !== null}
              onSelectGroup={(id) => beginPlacement(id)}
              onRedraw={() => openPicker({ forKind: 'redraw', total: UI_RULES.redrawCost, pick: {} })}
              onTradeWith={(other) => openTrade(other)}
              onGerry={() => {
                if (you === null) return;
                const zones = rightsZones(state, you);
                if (zones.length === 0) {
                  setRefusal('you hold Gerrymanding Rights in no constituency');
                  return;
                }
                const first = zones[0];
                if (first !== undefined) openGerry(first);
              }}
              onPower={(power) => onPower(state, you, power, app, dispatch)}
              onEndTurn={() => dispatch(actions.endTurn())}
            />
          </div>

          {/*
            §5.13's FOURTH TAB. The phone tab bar has always had four buttons —
            Board · Mat · Market · Log — while the shell had only three tabpanels,
            so MARKET matched nothing, every panel went `display:none`, and the
            player got a blank screen under a working tab bar. Found by pressing
            all four in a browser; no structural test can see it, because all four
            buttons and all three panels are present in the DOM either way.

            On a desktop this is simply the second panel in the side column, which
            is what the mat's own header comment always claimed it was.
          */}
          <div className="tabs" data-tabpanel="market" data-active={tab === 'market'}>
            {role === 'player' && you !== null ? (
              <MarketPanel
                state={state}
                you={you}
                disabled={!isMyTurn || app.link !== 'live'}
                onBuy={(index) => buyMarketCard(state, you, index, app, dispatch)}
                onBuyConspiracy={() => {
                  const cost = state.conspiracyTopCost;
                  if (cost === null) {
                    setRefusal('no Conspiracy Card is purchasable');
                    return;
                  }
                  openPicker({ forKind: 'conspiracy', total: cost, pick: {} });
                }}
                /**
                 * THE PLAY TRIGGER, and why it is gated on the server's list rather
                 * than on a hand count. This client is never told what it holds, so
                 * there is nothing local to test — the only honest question is "does
                 * the server say I have something to play?", and asking it is what
                 * makes the button's presence truthful. It appears during the
                 * `answer` window too, not only on your own turn, because p19 lets
                 * any player play a Conspiracy immediately before an opponent
                 * answers; the button's own `disabled` is therefore only about the
                 * LINK, never about whose turn it is.
                 */
                playableConspiracies={myConspiracies ?? []}
                onPlayConspiracy={() => openPicker({ forKind: 'conspiracy', total: state.conspiracyTopCost ?? 0, pick: {} })}
                armedSlot={app.marketModifier?.slot ?? null}
              />
            ) : (
              /* §5.11: the spectator treatment is the ABSENCE of controls, so the
                 market panel says nothing at all rather than rendering three dead
                 slots. */
              <section className="panel" aria-label="HQ market">
                <h2 className="panel__title">HQ MAT · MARKET</h2>
                <p className="panel__note panel__note--quiet">
                  You are watching. The market is the players&apos; to buy from.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* §5.13: the log becomes a bottom sheet / tab below 600px. The attributes are
          constant and the CSS decides what to do with them — swapping the class in
          JS meant the desktop and phone rules were reading different elements. */}
      <div className="tabs" data-tabpanel="log" data-active={tab === 'log'}>
        <LogRail state={state} />
      </div>

      {/* The phone tab bar. `END TURN` is a persistent bar pinned above it,
          because it is the one control that must never require a scroll. */}
      <div className="tabbar" role="tablist" aria-label="Screen">
        {(['board', 'mat', 'market', 'log'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="tabbar__btn"
            aria-pressed={tab === t}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {isMyTurn && state.phase === 'actions' ? (
        <div className="endturn-dock">
          <button
            type="button"
            className="btn btn--primary btn--wide"
            onClick={() => dispatch(actions.endTurn())}
            disabled={!live}
            aria-disabled={!live}
            data-testid="end-turn"
          >
            END TURN
          </button>
        </div>
      ) : null}

      {/* END TURN on desktop, bottom-right of the mat column. It is never the
          only enabled button and never auto-highlighted: ending a turn is a
          decision, not a default (§5.4). */}
      {isMyTurn && state.phase === 'actions' && !isMyTurn ? null : null}

      {/* ── Overlays, in priority order. ── */}
      {store.blind !== null && isMyTurn && state.phase === 'answer' ? (
        <AnswerScreen
          state={state}
          prompt={store.blind as BlindPrompt}
          you={you as PlayerID}
          viewId={store.viewId}
          errorAt={store.error === null ? null : store.error.at}
          picker={app.picker}
          onCommit={(displayIndex) => dispatch(actions.answer(displayIndex))}
          onRedrawRequest={() =>
            openPicker({ forKind: 'redraw', total: UI_RULES.redrawCost, pick: {} })
          }
          onPick={(next) => {
            const p = app.picker;
            if (p === null) return;
            openPicker({ ...p, pick: next });
          }}
          onRedrawConfirm={(pay) => {
            closePicker();
            dispatch(actions.redraw(pay as Record<string, number>));
          }}
          onPickerCancel={closePicker}
        />
      ) : null}

      {state.phase === 'headlines' ? (
        <HeadlineDialog state={state} you={you} onAcknowledge={() => dispatch(actions.ackHeadline())} />
      ) : null}

      {owedChoice !== null && you !== null ? (
        <ChoiceResolver
          state={state}
          you={you}
          pickedAreaIds={app.toughLovePicks}
          onPickArea={onSlotActivate}
          onRemovePick={removeToughLovePick}
          onResolveResources={(choiceId, pick) => {
            dispatch(actions.resolveChoice(choiceId, { kind: 'resources', res: pick as never }));
            clearPowerTarget();
          }}
          onResolveSteal={(choiceId, from, pick) => {
            dispatch(actions.resolveChoice(choiceId, { kind: 'steal', from, res: pick as never }));
            clearPowerTarget();
          }}
          onResolveAreas={(choiceId, areaIds) => {
            dispatch(actions.resolveChoice(choiceId, { kind: 'areas', areaIds }));
            clearPowerTarget();
            clearToughLove();
          }}
          draft={app.picker?.pick ?? {}}
          onDraft={(next) => {
            const p = app.picker;
            if (p === null) openPicker({ forKind: 'redraw', total: 0, pick: next });
            else openPicker({ ...p, pick: next });
          }}
        />
      ) : null}

      {app.picker?.forKind === 'conspiracy' && me !== null ? (
        <ConspiracyPicker
          pool={me.resources}
          total={state.conspiracyTopCost ?? 0}
          pick={app.picker.pick}
          playable={myConspiracies}
          onPick={(next) => openPicker({ ...app.picker!, pick: next })}
          onConfirm={(pay) => {
            closePicker();
            dispatch(actions.buyConspiracy(pay as Record<string, number>));
          }}
          onPlay={(cardId) => {
            /*
              CLOSE FIRST, THEN ASK. A Conspiracy's effects can raise a
              `PendingChoice`, which mounts the `ChoiceResolver` as a full-viewport
              takeover. Leaving this dialog mounted underneath it would put two
              `aria-modal` dialogs on screen at once, which is the contradiction
              `ResourcePicker`'s `nested` prop exists to avoid.
            */
            closePicker();
            dispatch(actions.playConspiracy(cardId));
          }}
          onCancel={closePicker}
        />
      ) : null}

      {/* The power dialogs sit ABOVE the choice resolver's scrim in the DOM because
          they are opened BY the player from the mat; a Headline that raises a choice
          while a power is mid-targeting is handled by the choice resolver taking the
          viewport, which is the same precedence rule §5.9b states. */}
      {app.powerTarget !== null && me !== null && you !== null && owedChoice === null ? (
        <PowerDialog
          state={state}
          you={you}
          flow={app.powerTarget}
          pickedAreaIds={app.pickedAreaIds}
          onPickSlot={onSlotActivate}
          onRemovePick={removePick}
          onCancel={() => {
            clearPowerTarget();
            endPlacement();
          }}
          onSubmit={commitPower}
        />
      ) : null}

      {app.pendingMarketPower !== null && me !== null ? (
        <MarketModifierDialog
          state={state}
          power={app.pendingMarketPower}
          left={
            app.pendingMarketPower === 'going-viral'
              ? UI_RULES.goingViralPerTurn - me.powerUses.goingViral
              : UI_RULES.helpingHandsPerTurn - me.powerUses.helpingHands
          }
          onArm={(slot, discounts) => {
            const power = app.pendingMarketPower;
            if (power === null) return;
            setMarketModifier({
              power,
              slot,
              viral: power === 'going-viral',
              discounts,
            });
            clearMarketPower();
          }}
          onCancel={clearMarketPower}
        />
      ) : null}

      {app.trade !== null && me !== null ? (
        <TradeComposer
          state={state}
          you={you as PlayerID}
          onGive={(give) => setTradeGive(give)}
          onReceive={(receive) => setTradeReceive(receive)}
          onSend={() => {
            const t = app.trade;
            if (t === null) return;
            dispatch(
              actions.trade(t.with, t.give, t.receive),
            );
            closeTrade();
          }}
          onCancel={closeTrade}
        />
      ) : null}

      {store.error !== null ? (
        <ErrorToast
          code={store.error.code}
          message={store.error.message}
          onDismiss={clearError}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────── the topbar ───────────────────────────

function TopBar({
  state,
  store,
  you,
  role,
}: {
  state: ClientState;
  store: ClientStore;
  you: PlayerID | null;
  role: 'player' | 'spectator';
}) {
  const app = useApp();
  const me = you === null ? null : state.players[you] ?? null;
  return (
    <header className="shell__top">
      <span className="shell__wordmark">SHASN</span>
      <span className="shell__meta">Round {state.round}</span>
      <span className="shell__meta">TURN {state.turn}</span>

      {/* Turn order as seat-coloured dots, so "whose turn" is a glance. */}
      <span className="row row--tight" aria-label="Turn order">
        {state.turnOrder.map((id) => (
          <span
            key={id}
            className={`seat seat--${seatIndex(state.turnOrder, id)}`}
            style={{ padding: '0 4px', borderLeftWidth: 6 }}
            title={state.players[id]?.name ?? id}
          >
            <span className="seat__name">
              {id === state.activePlayer ? '● ' : ''}
              {state.players[id]?.name ?? '—'}
            </span>
          </span>
        ))}
      </span>

      <span className="shell__spacer" />

      {role === 'spectator' ? (
        <span className="shell__meta" data-testid="spectator-badge">
          SPECTATING
        </span>
      ) : null}

      <span className="shell__meta">
        {me === null ? '' : `You: ${me.name.toUpperCase()}`}
      </span>

      <LinkDot link={app.link} attempts={app.attempts} />

      <span className="shell__meta" data-testid="phase-readout">
        {state.phase}
      </span>
    </header>
  );
}

function seatIndex(order: readonly string[], id: string): 1 | 2 | 3 | 4 | 5 {
  const i = order.indexOf(id);
  return (i < 0 || i > 4 ? 0 : i + 1) as 1 | 2 | 3 | 4 | 5;
}

// ─────────────────────────── the small composers ───────────────────────────

/**
 * The Conspiracy Cards the SERVER says this player may play, right now.
 *
 * `ClientState` does not declare the field, and cannot: it is the engine's type and
 * the engine's `playerView` deliberately ships no hand. The server therefore
 * attaches one extra, viewer-scoped array to the payload it builds — see
 * `packages/server/src/broadcast.ts` — and it arrives here as an ordinary property
 * of `state`.
 *
 * Read through a NARROW CAST rather than by editing `@shasn/engine`'s type, and the
 * cast FAILS CLOSED, which is the direction that matters: a payload without the
 * field, a `null`, or a non-array all produce `undefined`, and `undefined` makes the
 * picker render its honest "the server has not sent this" state rather than an empty
 * list that would read as "you hold nothing". Those two are different claims and only
 * one of them is safe to make on the server's behalf.
 *
 * And note what is NOT read, because it is the whole point: `state.players[you]
 * .conspiracies` is `[]` here, as it is for every client, and this function would
 * have nothing to return if it were not for the server's list. The client cannot
 * construct or guess a hand, and does not try.
 */
function playableConspiracies(
  state: ClientState,
  you: PlayerID | null,
): readonly PlayableConspiracy[] | undefined {
  if (you === null) return undefined;
  const raw = (state as { playableConspiracies?: unknown }).playableConspiracies;
  if (!Array.isArray(raw)) return undefined;
  const out: PlayableConspiracy[] = [];
  for (const entry of raw) {
    // Validate the SHAPE, not just the array. A payload is attacker-adjacent input:
    // a row missing its text would otherwise render an empty card that looks real.
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (typeof c['id'] !== 'string' || typeof c['name'] !== 'string' || typeof c['text'] !== 'string') continue;
    out.push({ id: c['id'], name: c['name'], text: c['text'] });
  }
  return out;
}

/**
 * §5.7: both sides must exchange at least one resource, and the shortfall line
 * sits directly above the disabled SEND, because §9.2's rule is that the reason
 * is always adjacent to the control.
 */
function TradeComposer({
  state,
  you,
  onGive,
  onReceive,
  onSend,
  onCancel,
}: {
  state: ClientState;
  you: PlayerID;
  onGive: (d: Readonly<Record<string, number>>) => void;
  onReceive: (d: Readonly<Record<string, number>>) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const app = useApp();
  const t = app.trade;
  // `?? null` rather than a bare lookup: `noUncheckedIndexedAccess` makes a Record
  // index `| undefined`, and a `=== null` guard cannot narrow `undefined` away.
  const me = state.players[you] ?? null;
  const them = t === null ? null : state.players[t.with] ?? null;
  if (t === null || me === null || them === null) return null;

  const giveTotal = deltaTotal(t.give);
  const receiveTotal = deltaTotal(t.receive);
  const iCanGive = canAfford(me.resources, t.give);
  const theyCanGive = canAfford(them.resources, t.receive);
  const valid = giveTotal >= 1 && receiveTotal >= 1 && iCanGive && theyCanGive;

  const problems: string[] = [];
  if (giveTotal < 1) problems.push('add at least 1 resource to your side');
  if (receiveTotal < 1) problems.push('ask for at least 1 resource');
  if (!iCanGive) problems.push('you do not hold what you are offering');
  if (!theyCanGive) problems.push(`${them.name} does not hold what you are asking for`);

  return (
    <div className="scrim">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Propose a trade">
        <h2 className="sheet__title">Trade with {them.name}</h2>
        <p className="sheet__body">
          Any ratio, at least one resource exchanged by both parties. Ideology Cards cannot be
          traded.
        </p>

        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="col" style={{ flex: 1 }}>
            <span className="field__label">YOU GIVE</span>
            <DeltaStepper pool={me.resources} value={t.give} onChange={onGive} />
          </div>
          <div className="col" style={{ flex: 1 }}>
            <span className="field__label">YOU GET</span>
            <DeltaStepper pool={them.resources} value={t.receive} onChange={onReceive} />
          </div>
        </div>

        <p
          className={`picker__status ${valid ? '' : 'picker__status--short'}`}
          role="status"
          data-testid="trade-status"
        >
          {valid
            ? `${giveTotal} for ${receiveTotal}. Both sides exchange at least one resource.`
            : problems.join(' · ')}
        </p>

        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={onSend}
            disabled={!valid}
            aria-disabled={!valid}
            data-testid="trade-send"
          >
            SEND OFFER
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

/** Four denominations, +/−, bounded by the pool being drawn from. */
function DeltaStepper({
  pool,
  value,
  onChange,
}: {
  pool: import('@shasn/engine').Pool;
  value: Readonly<Record<string, number>>;
  onChange: (v: Readonly<Record<string, number>>) => void;
}) {
  return (
    <div className="picker__grid">
      {RESOURCE_ORDER.map((r) => {
        const have = pool[r];
        const have2 = value[r] ?? 0;
        return (
          <div key={r} className="row row--tight" style={{ flexWrap: 'nowrap' }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onChange({ ...value, [r]: Math.min(have, have2 + 1) })}
              disabled={have2 >= have}
              aria-label={`Add one ${r}`}
            >
              +
            </button>
            <span className="picker__count" style={{ fontSize: '18px' }}>
              {have2}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onChange({ ...value, [r]: Math.max(0, have2 - 1) })}
              disabled={have2 <= 0}
              aria-label={`Remove one ${r}`}
            >
              −
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── dispatch helpers ───────────────────────────

type Dispatch = (a: import('@shasn/engine').Action) => void;

function onBuyMarket(state: ClientState, you: PlayerID | null, index: number, dispatch: Dispatch): void {
  if (you === null) return;
  const me = state.players[you];
  const slot = state.market[index];
  if (me === undefined || slot === undefined) return;
  if (!canAfford(me.resources, slot.cost)) {
    setRefusal('you cannot afford that Voter Card');
    return;
  }
  dispatch(actions.influence(index));
}

/**
 * Powers that need a target open a second step; the two market-modifier powers
 * arm a modifier against a slot instead; everything else is a refusal by name.
 *
 * There is no `default: 'not implemented'` left. Seven powers, seven branches, and
 * the two that are folded into `INFLUENCE` are the two that arm a market modifier —
 * a shape that is the engine's, not a gap in this client.
 */
function onPower(
  state: ClientState,
  you: PlayerID | null,
  power: string,
  app: AppState,
  dispatch: Dispatch,
): void {
  if (you === null) return;
  const me = state.players[you];
  if (me === undefined) return;

  const flow = POWER_FLOWS[power];
  if (flow !== undefined) {
    setPowerTarget(flow);
    return;
  }

  switch (power) {
    case 'going-viral':
    case 'helping-hands':
      // These two ride on a market BUY rather than being actions of their own, so
      // what the player chooses first is WHICH CARD to spend them on. Arming a
      // pending power opens that chooser; nothing is spent until the buy lands.
      if (power === 'going-viral' && me.powerUses.goingViral >= UI_RULES.goingViralPerTurn) {
        setRefusal('Going Viral is spent for this turn.');
        return;
      }
      if (
        power === 'helping-hands' &&
        me.powerUses.helpingHands >= UI_RULES.helpingHandsPerTurn
      ) {
        setRefusal('Helping Hands is spent for this turn.');
        return;
      }
      if (app.pendingMarketPower === power) {
        clearMarketPower();
        return;
      }
      setMarketPower(power);
      return;
    default:
      // §9.10: a control that cannot do anything says so and names itself, rather
      // than being a button that swallows a press.
      setRefusal(`${power} is not available to you yet.`);
  }
}

/** The five powers with a dialog of their own. */
const POWER_FLOWS: Readonly<Record<string, PowerFlow>> = {
  prospecting: { power: 'prospecting' },
  'land-grab': { power: 'land-grab' },
  donations: { power: 'donations' },
  payback: { power: 'payback' },
  'tough-love': { power: 'tough-love' },
};

/**
 * Build the `INFLUENCE` action, folding in whatever modifier is armed.
 *
 * The modifier is cleared AFTER the dispatch and not before, so a refused buy
 * (unaffordable, engine rejects) leaves the player's intent intact to retry. The
 * server is the only thing that decides whether it was spent.
 */
function buyMarketCard(
  state: ClientState,
  you: PlayerID,
  index: number,
  app: AppState,
  dispatch: Dispatch,
): void {
  const me = state.players[you];
  const slot = state.market[index];
  if (me === undefined || slot === undefined) return;

  const mod = app.marketModifier?.slot === index ? app.marketModifier : null;

  // Affordability is checked against the DISCOUNTED cost, because that is what the
  // engine charges (`applyDiscounts`). Checking the undiscounted cost would refuse a
  // buy the Helping Hands discount has already made legal.
  const cost = mod === null ? slot.cost : discounted(slot.cost, mod.discounts);
  if (!canAfford(me.resources, cost)) {
    setRefusal('you cannot afford that Voter Card');
    return;
  }
  dispatch(
    actions.influence(
      index,
      mod === null ? undefined : { viral: mod.viral, discounts: mod.discounts },
    ),
  );
  clearMarketModifier();
  closePicker();
}

/** `reduce.ts:applyDiscounts`, mirrored so the client can refuse before sending. */
function discounted(cost: Delta, discounts: readonly Resource[]): Delta {
  const out: Record<string, number> = {};
  for (const r of RESOURCE_ORDER) {
    const n = cost[r] ?? 0;
    if (n === 0) continue;
    const waived = discounts.includes(r) ? 1 : 0;
    const left = n - waived;
    if (left > 0) out[r] = left;
  }
  return out as Delta;
}

// ─────────────────────────── small pure helpers ───────────────────────────

/**
 * Is this slot a legal gerrymander SOURCE?
 *
 * Mirrors the engine's three conditions — yours, not a majority voter, not in a
 * Volatile Area — plus the rights question, because §6.2's "Arm (hover)" table
 * lists "You have no Gerrymanding Rights in North" as one of the reasons a peg
 * cannot be armed. A refusal that does not name its reason is a puzzle (§9.10).
 */
function gerrySourceRefusal(
  state: ClientState,
  you: PlayerID,
  rightsZoneId: string,
  areaId: string,
): string | null {
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === areaId);
    if (a === undefined) continue;
    if (a.peg === null) return 'there is no voter there';
    if (a.volatile) return 'Permanent — Volatile Area.';
    if (a.peg.owner !== you) return 'you may gerrymander any voter, but this board only arms your own';
    if (a.peg.majority) return 'Majority voters do not move.';
    if (z.id !== rightsZoneId) {
      const rights = rightsZones(state, you);
      if (!rights.includes(z.id) && !rights.some((r) => state.zones.find((x) => x.id === r)?.neighbours.includes(z.id))) {
        return `you hold no rights in ${z.name} or next to it`;
      }
    }
    return null;
  }
  return 'that slot does not exist';
}

/**
 * Is this slot a legal target for the power being aimed?
 *
 * The same three conditions `PowerDialog` shows and `reduce.ts` enforces, so the
 * refusal is consistent whichever of the two the player happens to press. Land Grab
 * takes anybody's peg; Payback and Tough Love take an opponent's, and Tough Love
 * additionally needs both in one zone — checked here on the SECOND pick, because
 * that is the frame the player can still change it on.
 */
function powerAreaRefusal(
  state: ClientState,
  you: PlayerID | null,
  flow: PowerFlow,
  areaId: string,
  picks: readonly string[],
): string | null {
  if (you === null) return 'that slot does not exist';
  let area: { readonly id: string; readonly zone: string; readonly volatile: boolean; readonly peg: { readonly owner: string; readonly majority: boolean } | null } | null = null;
  for (const z of state.zones) {
    const a = z.areas.find((x) => x.id === areaId);
    if (a !== undefined) {
      area = { id: a.id, zone: z.id, volatile: a.volatile, peg: a.peg };
      break;
    }
  }
  if (area === null) return 'that slot does not exist';
  if (area.peg === null) return 'there is no voter there';
  if (area.volatile) return 'voters in a Volatile Area cannot be moved';
  if (flow.power !== 'land-grab' && area.peg.owner === you) {
    return 'that is your own voter — this power targets an opponent';
  }
  if (flow.power === 'tough-love') {
    for (const picked of picks) {
      for (const z of state.zones) {
        const p = z.areas.find((x) => x.id === picked);
        if (p !== undefined && p.id !== areaId && z.id !== area.zone) {
          return 'both voters must be in the same constituency';
        }
        if (p !== undefined && p.id !== areaId && p.peg !== null && p.peg.owner !== area.peg.owner) {
          return 'both voters must belong to the same player';
        }
      }
    }
  }
  return null;
}

/** How long the payout frame stays up before it retires. §9.3: one readable frame. */
const REVEAL_MS = 4_000;

/**
 * The answer the player committed, from the PUBLIC log.
 *
 * `reduce.ts` writes `"${side.answer}"` on the `ANSWER` branch, and the log is in
 * `ClientState` for every player — so once the answer is committed this text is
 * public by rule, and reading it here leaks nothing that the other three players
 * cannot already read.
 */
function lastAnswerText(log: readonly LogEntry[], you: PlayerID): string | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const e = log[i];
    if (e !== undefined && e.kind === 'answer' && e.player === you) return e.text;
  }
  return null;
}

/**
 * The polite live-region sentence. §8.5: state changes with no focus target
 * announce here, and a screen-reader user must hear the same information a
 * sighted one gets.
 */
function describeForScreenReader(
  state: ClientState,
  isMyTurn: boolean,
  hasPrompt: boolean,
  you: PlayerID | null,
): string {
  if (hasPrompt && isMyTurn) return 'An Ideology Card has been put to you. Answer it.';
  if (state.phase === 'headlines') return 'A Headline is resolving.';
  if (isMyTurn) {
    const me = you === null ? null : state.players[you];
    const pending = me?.pending.length ?? 0;
    return `Your turn. ${pending} group${pending === 1 ? '' : 's'} of voters waiting.`;
  }
  const who = state.players[state.activePlayer]?.name ?? 'Someone';
  return `${who} is thinking.`;
}

function reconnectProps(
  app: ReturnType<typeof useApp>,
  store: ClientStore,
  onRetry: () => void,
  onLeave: () => void,
) {
  return {
    link: app.link,
    attempts: app.attempts,
    retryingMs: app.retryingMs,
    onRetry,
    onLeave,
    name: store.you.playerId === null ? 'spectator' : (store.state?.players[store.you.playerId]?.name ?? '—'),
    phase: store.state?.phase ?? 'unknown',
  };
}

function onRetry(): void {
  const c = connection();
  applyConnectionStatus('connecting');
  // `connect` is idempotent and resumes when a credential is held, which is
  // exactly the REJOIN behaviour §5.2 asks for.
  c.connect();
  window.setTimeout(() => c.sync(), 250);
}

function onLeave(): void {
  clearTurnInteraction();
  connection().forget();
  window.location.reload();
}
