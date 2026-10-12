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
  InterruptWindow,
  LogEntry,
  PlayerID,
  Resource,
  ZoneID,
} from '@shasn/engine';

import { BoardSvg } from '../board/BoardSvg.tsx';
import type { AnswerPrompt, ClientStore } from '../net/index.ts';

import { AnswerResolution, AnswerScreen, cardForResolution } from './AnswerScreen.tsx';
import type { ResolvedCard } from './AnswerScreen.tsx';
import { ChoiceResolver } from './ChoiceResolver.tsx';
import { ConspiracyPicker, type PlayableConspiracy } from './ConspiracyPicker.tsx';
import { ResponseWindow, type ResponsiveCard } from './ResponseWindow.tsx';
import { openQuestionOf } from './blindWire.ts';
import { TableQuestion } from './TableQuestion.tsx';
import { StandBanner } from './StandBanner.tsx';
import { RefusalLine } from './RefusalLine.tsx';
import { windowLiveMessage } from './interrupt.ts';
import { ErrorToast, HeadlineDialog, LinkDot, LogRail, ReconnectScreen, RulesPanel, Scoreboard } from './Panels.tsx';
import { GerryBar, PlacementBar } from './BoardBars.tsx';
import { ResourcePicker } from './ResourcePicker.tsx';
import { YourMat, MarketPanel } from './YourMat.tsx';
import {
  addPick,
  addToughLovePick,
  applyConnectionStatus,
  beginPlacement,
  clearArmedModifier,
  clearPowerTarget,
  clearRefusal,
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
  /** G1 — the two-place pick replaces the list wholesale, because it is a SEQUENCE. */
  setChoicePicks,
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
  choiceBoardInteraction,
  deltaTotal,
  gerrymanderRefusal,
  gerrySourceRefusal,
  lockedZoneFor,
  majorityCount,
  marketCharge,
  pegMovePick,
  placementRefusal,
  powerAreaRefusal,
  powerBoardLegality,
  requiredPicks,
  rightsZones,
  targetableAreas,
  toBoardState,
  type BoardInteraction,
} from './derive.ts';
import { ResourceGlyph } from './ResourceGlyph.tsx';

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
  // VIEW BOARD on the scoreboard. It was wired to `() => undefined`, so the one
  // button that offered to show the final board did nothing at all.
  const [reviewingBoard, setReviewingBoard] = useState(false);
  // END TURN with voters still on the mat discards them. The first press now asks;
  // the second press (or the turn changing) settles it.
  const [confirmEnd, setConfirmEnd] = useState(false);

  // A new turn clears the local interaction state. Without this, a player who
  // disconnects mid-placement comes back to picks for a group the engine has
  // already discarded.
  //
  // `store.viewId`, NOT `state.viewId`: `viewId` is the sync ENVELOPE's field
  // (`net/protocol.ts`), which is what makes a re-applied `match:state` a new
  // render even when the board is identical. `ClientState` has no such field —
  // `state.viewId` was the second half of the same mistake as the import.
  useEffect(() => {
    clearTurnInteraction({ keepArmedModifier: true });
  }, [store.viewId, state?.turn]);

  /*
    THE ARMED MODIFIER IS TURN-SCOPED AND NOT FRAME-SCOPED, and it says so.

    `clearTurnInteraction` runs on every `match:state` envelope, so it used to null
    `marketModifier` here too — which meant an ARM was confirmed on screen by the
    sheet's own words and then silently dropped by the next broadcast from anywhere
    in the game. Going Viral and Helping Hands could not be spent. Found by playing
    them: the driver armed the modifier thirty-odd times in a row and could never
    get it to survive long enough to buy the card.

    A new TURN does end it, because the HQ Mat refills and "market card 1" may be a
    different card tomorrow. So this is keyed on the turn alone, and when there was
    something armed it says what happened rather than letting the note disappear —
    §9.10: a control that leaves without acting and without saying why is a control
    that cannot do anything.
  */
  useEffect(() => {
    if (app.marketModifier === null) return;
    setRefusal('your turn passed with the power still armed, and the HQ Mat has been reshuffled - it is no longer armed');
    clearArmedModifier();
  }, [state?.turn]);

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

  /*
    G13 — THE RESPONSE WINDOW, and the three things it changes about this screen.

    `state.interrupt` is nullable and is NOT a `Phase`: `broadcast.ts` gates hand
    visibility on `phase === 'actions' || 'answer'`, so a phase member would black
    out every hand — including the BLOCK — for as long as the window is open. The
    phase keeps saying which phase of PLAY it is, and this screen has to cope with a
    suspension inside one:

      1. A PANEL, which `ResponseWindow` renders as a modal for the one seat with a
         decision to make and as a banner for everybody else.
      2. THE CONTROLS BELOW ARE FROZEN, and that is not a nicety. `reduce.ts` refuses
         every action except `RESPOND_INTERRUPT`, `PASS_INTERRUPT` and
         `RESOLVE_CHOICE` while a window is open, with the message `"…" is resolving
         — answer it or decline first`. Leaving the mat, the market and END TURN live
         would hand the player eight controls that each earn a refusal toast, and
         the table would look broken rather than suspended.
      3. THE LIVE REGION SAYS SO, which is why `describeForScreenReader` reads
         `state.interrupt`: a window can open on somebody else's turn and has no
         focus target of its own, so without that sentence a screen-reader user
         would hear nothing at all while the game stopped.
  */
  const openWindow = state === null ? null : state.interrupt;
  const windowOpen = openWindow !== null;

  /*
    THE CARD ON THE TABLE — for every seat that is not answering it.

    A and B of the ruling, at the client. The question and both labels are the
    table's to see while the card is out, because in the physical game the player
    to your right READS BOTH SIDES ALOUD (`AUTHENTIC-SHASN-REFERENCE.md` §7.2
    step 1, p764) and the redraw and interception windows are table business
    (step 2, p768; §7.4 step 3, p815). So this is a panel in the flow above the
    board rather than a takeover: during the answer window the rest of the table is
    still allowed to act — p19 lets anybody play a Conspiracy immediately before an
    opponent answers — and a scrim here would take that away from the seats this
    exists to inform.

    `!isMyTurn` is what keeps it off the answerer's screen, and it is also what
    keeps the commit control singular: the answering seat gets `AnswerScreen`,
    which owns the ONE control that sends. This panel has none, not even a disabled
    one (§9.10 — a control that cannot act and looks like it can). A spectator
    satisfies `!isMyTurn` too, which is right: the question is public, and the
    spectator treatment (§5.11) is the absence of CONTROLS, not the absence of
    information.

    COMPUTED, NEVER STORED — `openQuestionOf` reads the server's own field and
    returns `null` for anything malformed, so there is no local flag to fall out of
    step with the table. A redraw swaps the card, and therefore the question and
    both labels, on the very next projection.
  */
  const openQuestion = state === null ? null : openQuestionOf(state);
  const tableQuestion = openQuestion !== null && !isMyTurn ? openQuestion : null;
  const answererName = state === null ? '' : (state.players[state.activePlayer]?.name ?? '');

  const myResponsive = useMemo(
    () => (state === null ? undefined : responsiveConspiracies(state, you)),
    [state, you],
  );

  /*
    A DEFLECT target is local intent, exactly like a placement pick or a drafted
    payment: it is the redirect the player is choosing, and it is spent only when the
    server accepts the response. It is CLEARED when the window changes, because a
    target named for one window means nothing to another — and a stale target that
    silently survived would redirect a card to a player the responder never picked.
  */
  const [deflectTarget, setDeflectTarget] = useState<PlayerID | null>(null);
  useEffect(() => {
    setDeflectTarget(null);
  }, [openWindow?.id]);

  const interaction = useMemo<BoardInteraction>(() => {
    if (state === null) return IDLE_INTERACTION;

    // A pending area-shaped choice takes the board: "choose two voters" is a
    // board decision, and a list of 129 checkboxes would be the same action
    // with a worse interface.
    //
    // IT IS ONE FUNCTION, `derive.ts:choiceBoardInteraction`, and it carries the
    // legal SET to the board. It used to be inlined here, which computed the same
    // `targetableAreas` and returned only `mode: 'place'` — so `BoardSvg` fell
    // back to its own rule, "a placement target must be empty", and highlighted
    // every slot an eviction cannot touch. The dialog said "click the highlighted
    // slots" and the board highlighted the complement: CONFIRM dead at `0 of 3`,
    // no cancel, table locked. Extracted so `choiceInvariant.test.tsx` drives
    // THIS expression rather than a copy of it.
    const owedBoard = choiceBoardInteraction(state, you as PlayerID, app.toughLovePicks);
    if (owedBoard !== null) return owedBoard;

    /*
      G13 — THE BOARD FREEZES, AND IT IS CHECKED *BELOW* THE OWED CHOICE ON PURPOSE.

      `reduce.ts` keeps `RESOLVE_CHOICE` legal for the whole length of an open
      window precisely so a player frozen by p12's cap discard can thaw; the
      window's required set excludes anybody with a pending `PendingChoice` for the
      same reason. So a seat that owes a decision keeps a LIVE board — freezing it
      would make a player who is not waiting on anybody the only player who cannot
      move. Every other mode below is frozen, because every action they can reach
      is refused with `"…" is resolving — answer it or decline first`.
    */
    if (windowOpen) {
      return { ...IDLE_INTERACTION, disabled: true };
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
    //
    // AND IT PASSES THE LEGAL SET, which is the whole fix. Without it `BoardSvg`
    // falls back to "an empty slot is the target", which is true of every placement
    // and false of all three slot powers — Land Grab evicts a voter, Payback
    // strikes one, Tough Love converts two, so every legal target is an OCCUPIED
    // slot and every occupied slot was announced `illegal: already occupied`. The
    // board contradicted the click handler, in front of the player, on all 129
    // squares. That is Defect A's shape one layer out, and it is why Land Grab read
    // as "areas offered, CONFIRM never enables".
    //
    // `powerTargetableAreas` is DERIVED from `powerAreaRefusal` — the same call the
    // click handler makes — so the highlight and the acceptance test cannot drift.
    // For `'tough-love'` it is a function of the picks, and that is correct rather
    // than a re-render cost: the second half of its rule ("both in the same
    // constituency, both the same player") is only knowable once one is down, so
    // the legal set legitimately narrows as the pick is made.
    if (powerTargetsArea(app.powerTarget) && isMyTurn && app.powerTarget !== null) {
      const { legalAreaIds: legal, illegalReasons } = powerBoardLegality(
        state,
        you,
        app.powerTarget,
        app.pickedAreaIds,
      );
      return {
        mode: 'place',
        pickedAreaIds: app.pickedAreaIds,
        lockedZoneId: null,
        gerrySourceAreaId: null,
        resolveGerrySources: false,
        // UNCONDITIONALLY, and that is the whole point of the field. An EMPTY set is
        // a real answer — "this power can reach nothing on this board" — and
        // withholding it hands the board back to its fallback rule, which is the one
        // that made Land Grab unusable. Both existing callers
        // (`choiceBoardInteraction`, `pegMoveInteraction`) supply it the same way,
        // empty or not, and a third reading is how the inconsistency happened.
        legalAreaIds: legal,
        // …and the reasons are handed down PER SLOT, not as one sentence, because
        // Tough Love's set narrows as the picks are made and a slot that was legal
        // one press ago has to say which clause turned it off.
        illegalReasons,
        illegalReason: 'this power cannot reach that voter',
        disabled: false,
      };
    }

    return { ...IDLE_INTERACTION, disabled: !isMyTurn };
  }, [state, app.placingGroupId, app.pickedAreaIds, app.gerryZoneId, app.gerrySourceAreaId, app.toughLovePicks, app.powerTarget, isMyTurn, me, you, windowOpen]);

  // ─────────────────────────── board interaction ───────────────────────────

  /**
   * G17 — THE NAMED RECYCLE LIST, read off the wire fail-closed, on
   * `playableConspiracies`'s exact reasoning.
   *
   * `state.conspiracyRecycle` is on the server's `PublicView` rather than on
   * `ClientState`, because naming a card needs the `CardIndex` and this client does not
   * hold one — so the cast is the same narrow, shape-validating one. A payload without
   * the field, a `null`, a non-array, or a row with no `name` all produce `[]`, and `[]`
   * makes the picker render its honest "there is nothing left to take" state rather than
   * a list of raw card ids — which would be a row of strings a player cannot choose
   * between, and §9.10's prohibited case with the label changed.
   */
  const recycle = useMemo<readonly { readonly id: string; readonly name: string }[]>(() => {
    if (state === null) return [];
    const raw = (state as { conspiracyRecycle?: unknown }).conspiracyRecycle;
    if (!Array.isArray(raw)) return [];
    const out: { readonly id: string; readonly name: string }[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const c = entry as Record<string, unknown>;
      if (typeof c['id'] !== 'string' || typeof c['name'] !== 'string') continue;
      out.push({ id: c['id'], name: c['name'] });
    }
    return out;
  }, [state]);

  const onSlotActivate = useCallback(
    (areaId: string) => {
      if (state === null) return;

      /*
        1a. G1 — a move in progress takes the board too, and it is TWO presses.
        Checked before the area-list kinds because both own the board, and it is its
        own branch rather than a `count` of 2 because its legal set changes with the
        stage: the peg first, then that peg's destinations. `pegMovePick` is the ONE
        expression for that transition — `choiceInvariant.test.tsx` drives the same
        function, so "the board accepts a slot the dialog does not offer" is not
        expressible here either.
      */
      const owedPegMove = state.choices.find(
        (c) => c.player === you && c.choice.kind === 'choose-peg-dest',
      );
      if (owedPegMove !== undefined && you !== null) {
        if (owedPegMove.choice.kind !== 'choose-peg-dest') return;
        const step = pegMovePick(state, owedPegMove.choice, app.toughLovePicks, areaId);
        if (!step.ok) {
          setRefusal(step.reason);
          return;
        }
        setChoicePicks(step.picks);
        return;
      }

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
        const legal = targetableAreas(
          state,
          you,
          kind,
          owedAreaChoice.choice.scope,
          // THE CARD'S CONSTITUENCY. Omitting it made this set the whole board, so
          // a zone-scoped decision offered out-of-zone voters the engine refuses
          // with `that voter is in another zone` — a click the UI called legal and
          // the server called malformed.
          owedAreaChoice.choice.zoneId,
        );
        if (!legal.has(areaId)) {
          setRefusal('no voter here this decision can reach');
          return;
        }
        if (app.toughLovePicks.includes(areaId)) {
          removeToughLovePick();
          return;
        }
        /* The cap is the DERIVED ask, not the card's nominal count.
         *
         * `ChoiceResolver`'s confirm is `picked.length === requiredPicks(...)`, and
         * `requiredPicks` is `min(count, targetable)`. A board that capped at the
         * nominal count while the dialog demanded the derived one let a player
         * collect picks the confirm would then refuse, and — the same failure
         * again — no amount of clicking would clear it. One number, derived once. */
        const ask = requiredPicks(owedAreaChoice.choice, state, you);
        if (app.toughLovePicks.length >= ask) {
          setRefusal(`you may only choose ${ask}`);
          return;
        }
        addToughLovePick(areaId);
        return;
      }

      /*
        1b. G13 — a slot press while a card is being answered.

        Placed after the owed choice and before every other board mode, because
        `RESOLVE_CHOICE` stays legal while a window is open and nothing else does.
        The board is already rendered `disabled` (the `interaction` memo), so this
        is the belt to that braces: a click that arrives anyway — a queued pointer
        event, a keyboard activation that beat the re-render — gets §9.10's named
        refusal rather than a silent no-op. The message is the engine's own shape,
        because it is the one the player will see if the board ever does accept.
      */
      if (windowOpen) {
        setRefusal('a card is being answered — answer it or decline first');
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
        /*
         * §9.10. THIS USED TO BE A BARE `return`, and it was the right suspicion from
         * the tester who reported that Land Grab's CONFIRM "never enables" and
         * pointed at this line: a board click that reaches the dispatcher and leaves
         * without changing anything and without saying why is indistinguishable, from
         * the outside, from a board that is broken. It is unreachable today — the id
         * comes from `me.pending`, so it is in `me.pending`, and
         * `clearTurnInteraction` clears it on every `viewId` — which is exactly why
         * it is dangerous rather than harmless: a dead branch in front of a live one
         * is where the NEXT defect goes to hide, and the live one behind it turned
         * out to be Land Grab.
         *
         * So it speaks. The sentence is what is actually true if it ever fires, and
         * it is actionable: the group is not on the mat any more, so pick another.
         */
        if (group === undefined) {
          setRefusal('that group is no longer waiting to be placed — pick another one');
          return;
        }
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

      // 3b. CLICKING THE BOARD STARTS A PLACEMENT. Voters waiting on the mat used to
      //     need a trip to the mat first — find "Voters to place", press the group,
      //     come back to the board — and a click on a highlighted area before that
      //     did nothing. Now the click itself picks the first waiting group that can
      //     legally go there, starts placing it, and makes this the first pick.
      if (
        app.placingGroupId === null &&
        app.gerryZoneId === null &&
        app.powerTarget === null &&
        me !== null &&
        isMyTurn &&
        state.phase === 'actions' &&
        me.pending.length > 0
      ) {
        const fits = me.pending.find((g) => placementRefusal(state, g, [], areaId) === null);
        const group = fits ?? me.pending[0];
        if (group === undefined) return;
        beginPlacement(group.id);
        if (fits !== undefined) {
          addPick(areaId);
        } else {
          setRefusal(placementRefusal(state, group, [], areaId) ?? 'those voters cannot go there');
        }
        return;
      }

      // 4. A power that targets slots. Deliberately LAST: placement and an owed
      //    choice both outrank a power, because both are commitments the engine is
      //    already blocking on, while a power can always be cancelled.
      if (powerTargetsArea(app.powerTarget) && isMyTurn) {
        const flow = app.powerTarget;
        // Same rule as the guard above, for the same reason. `powerTargetsArea` already
        // excludes `null`, so this is a narrowing rather than a live branch — but a
        // narrowing that silently drops a click is still a narrowing that can hide one.
        if (flow === null) {
          setRefusal('that power is no longer armed — press it again');
          return;
        }
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
    [state, you, app, me, isMyTurn, windowOpen],
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
  // This is also the TRIGGER for the resolution, and it is a trigger rather than a
  // local flag on purpose: the resolution must not appear until the server has
  // actually recorded the answer, or it would celebrate a dispatch the server
  // refused. `answerCount` moving is the server saying so.
  const answerCount =
    state === null || you === null
      ? 0
      : state.log.filter((e) => e.kind === 'answer' && e.player === you).length;

  /*
    THE CARD, CAPTURED AT THE ONE INSTANT IT EXISTS.

    `reduce.ts` sets `phase: 'actions'` and `_pendingCard: null` on the ANSWER branch,
    and `broadcast.ts`'s `openQuestionFor` returns `null` unless `phase === 'answer'`.
    So the moment the answer lands, the card is gone from the wire — there is no
    "fetch the card after the fact" and `store.answer` is nulled by `net/store.ts` in
    the same breath. The resolution screen needs the whole card, so it is snapshotted
    HERE, in the callback that dispatches, which is the last moment it is readable.

    It is a snapshot of something this player was just shown, not a new channel: it is
    the server's own `AnswerPrompt`, and the Ideology corpus is public JSON.

    A REF, not state, deliberately: this is written once at a commit and read by the
    reveal, and putting it in state would mean a re-render at the exact moment the
    phase flips and the answer screen unmounts. `committedCard` below is the state
    that says "show the resolution"; this is what it shows.
  */
  const committedCard = useRef<{ prompt: ResolvedCard; chosenIndex: 0 | 1 } | null>(null);

  /*
    THE RESOLUTION, and it waits for a press rather than expiring on a timer.

    It used to be a four-second sheet that faded in above the board and left on its
    own. A screen that shows you what your answer was and what it paid, and then
    removes itself before you have read it, is worse than not having it: and there is
    no way to see it again, because the card is off the wire. So it is a takeover with
    a CONTINUE button, and it is the only thing on screen until that button is pressed.

    STILL SERVER-DRIVEN. `answerCount` moving is what sets this, so the resolution
    cannot appear for an answer the server refused — which is the same defect the old
    optimistic path would have had.
  */
  const [resolution, setResolution] = useState<ResolvedCard | null>(null);
  const seenAnswers = useRef<number | null>(null);
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
    const captured = committedCard.current;
    // Only if we actually hold the card. A resolution without it would render an
    // empty takeover the player cannot fill — so it is better not to mount at all.
    if (captured !== null) setResolution(captured.prompt);
  }, [answerCount]);

  // What the SERVER says the answer was, from the public log. This is the
  // authoritative half of the resolution: `committedCard` is a local snapshot taken
  // before the dispatch, and if the two ever disagree then the client's idea of which
  // side was taken is wrong — which is the one bug in this area that would silently
  // show a player the wrong payout. So the server's word is what the chosen card
  // prints, and the snapshot only supplies the card's other half.
  const loggedAnswer =
    resolution !== null && state !== null && you !== null
      ? lastAnswerText(state.log, you)
      : null;

  /*
    BUYING A CARD GOES STRAIGHT TO PLACING IT. A purchase used to leave the voters
    sitting in the mat's tray, and the player had to find them, press the group, and
    then find the board — on a phone, by switching tabs. When a NEW group appears on
    your turn and nothing else is in progress, placement starts with it and the board
    is brought forward. Only new ids count, so a refresh mid-turn does not grab a group
    the player had deliberately left.
  */
  const seenGroups = useRef<Set<string> | null>(null);
  const pendingIds = (me?.pending ?? []).map((g) => g.id).join(',');
  useEffect(() => {
    const ids = new Set(pendingIds === '' ? [] : pendingIds.split(','));
    const before = seenGroups.current;
    seenGroups.current = ids;
    if (before === null) return;
    if (!isMyTurn || state === null || state.phase !== 'actions') return;
    if (app.placingGroupId !== null || app.gerryZoneId !== null || app.powerTarget !== null) return;
    if (state.choices.some((c) => c.player === you)) return;
    const fresh = [...ids].find((id) => !before.has(id));
    if (fresh === undefined) return;
    beginPlacement(fresh);
    setTab('board');
  }, [pendingIds, isMyTurn, state, app.placingGroupId, app.gerryZoneId, app.powerTarget, you]);

  useEffect(() => {
    setConfirmEnd(false);
  }, [isMyTurn, pendingIds]);

  // THE TAB TITLE SAYS WHOSE TURN IT IS, so a player who switched to another tab
  // while an opponent played can see from the tab strip that the table is waiting.
  useEffect(() => {
    if (state === null) return;
    const active = state.players[state.activePlayer]?.name ?? '';
    document.title = state.finished
      ? 'Game over — Shasn'
      : isMyTurn
        ? '● Your turn — Shasn'
        : `${active}'s turn — Shasn`;
    return () => {
      document.title = 'Shasn';
    };
  }, [state, isMyTurn]);

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

  // Enter confirms a complete placement and Escape cancels it, so a placement can
  // be finished without travelling to the bar at the bottom of the screen.
  useEffect(() => {
    if (app.placingGroupId === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        endPlacement();
      } else if (e.key === 'Enter' && (t === null || t.tagName !== 'BUTTON')) {
        const group = me?.pending.find((g) => g.id === app.placingGroupId);
        if (group !== undefined && app.pickedAreaIds.length === group.count) commitPlacement();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app.placingGroupId, app.pickedAreaIds, me, commitPlacement]);

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
  if (state.finished && !reviewingBoard) {
    return (
      <Scoreboard
        state={state}
        you={you}
        winners={store.winners}
        onViewBoard={() => setReviewingBoard(true)}
        onNewMatch={() => {
          clearTurnInteraction();
          connection().forget();
          window.location.reload();
        }}
      />
    );
  }

  /*
     ONE SENTENCE PER CAUSE OF INERTNESS, COMPUTED HERE BECAUSE THIS IS THE ONLY
     COMPONENT THAT KNOWS ALL FOUR.

     The powers tray, the market and GERRYMANDER were all disabled by the same
     boolean and all said nothing, so a player watching `Land Grab 3 of 3 left` sit
     there refusing every press had no way to tell "not my turn" from "a card is
     being answered" from "the connection dropped" — a moment, this instant, and a
     reconnect respectively. That is what item 3's "unlocked, had uses left, and
     were untappable" turned out to be, and §9.2's rule is that the reason is
     adjacent to the control.

     Ordered so the most transient cause wins: a window open right now is a better
     explanation than the turn, which is a better explanation than the link, which is
     a better explanation than the seat. Each clause is a fact about state that is
     already computed above, so none of it can go stale.
  */
  const inertReason = !isMyTurn
    ? `Waiting for ${state.players[state.activePlayer]?.name ?? 'the table'} — your powers and the HQ Mat come alive on your turn.`
    : windowOpen
      ? 'A card is being answered — answer it or decline first.'
      : app.link !== 'live'
        ? 'Not connected to the table yet.'
        : null;

  const boardState = toBoardState(state, interaction);
  const placingGroup =
    app.placingGroupId === null || me === null
      ? null
      : me.pending.find((g) => g.id === app.placingGroupId) ?? null;
  const owedChoice = state.choices.find((c) => c.player === you) ?? null;

  const liveMessage = describeForScreenReader(
    state,
    isMyTurn,
    store.answer !== null,
    you,
    openWindow,
  );

  return (
    <div
      className="shell"
      data-testid="game-shell"
      /*
        THE RESOLUTION IS A FULL-VIEWPORT TAKEOVER, so it does not push the board —
        it covers it. The attribute is kept because the RESERVE rule it feeds is
        load-bearing for the one case that still moves the board: the resolution is
        only mounted while `phase === 'actions'`, and a Headline band or the response
        window can be in the flow above the board at the same time. So this now tracks
        "is the resolution up", which is what the 390px reserve below is for.
      */
      data-reveal={resolution !== null ? 'true' : 'false'}
      // G13: same reason, different cause — the response window's banner is in the
      // flow above the board, so the reserve has to know about that too.
      data-window={windowOpen ? 'true' : 'false'}
      // Lets the stylesheet tell "you cannot do this" (your turn, hatched) from
      // "nothing to do yet" (somebody else's turn, quiet). See `polish.css`.
      data-turn={isMyTurn ? 'yours' : 'theirs'}
    >
      <TopBar state={state} store={store} you={you} role={role} />

      {/*
        THE RESOLUTION, ABOVE EVERYTHING AND AFTER `AnswerScreen` in the tree.

        It is a full-viewport takeover because it is the answer to the question the
        player was just asked, and it must not be dismissible by a stray click on the
        board behind it. `AnswerScreen` unmounts the moment the phase moves on, so
        there is no ordering conflict in practice — but it is placed after it anyway,
        because it is the later of the two in every sense that matters.
      */}
      {resolution !== null && you !== null ? (
        <AnswerResolution
          prompt={resolution}
          chosenIndex={committedCard.current?.chosenIndex ?? 0}
          serverText={loggedAnswer}
          onContinue={() => {
            setResolution(null);
            committedCard.current = null;
          }}
        />
      ) : null}

      {/*
        THE RESPONSE WINDOW, in the flow above the board so every seat sees it — the
        actor, a player who has already declined, a player frozen by a decision of
        their own, a spectator, and the one seat that gets the modal. Rendered from
        the state, so a window that opens and closes needs nothing from this client
        but a re-render: there is no local flag, no timer and no queue.
      */}
      <ResponseWindow
        state={state}
        window={openWindow}
        you={you}
        isSpectator={role === 'spectator'}
        responsive={myResponsive}
        onDecline={() => dispatch(actions.passInterrupt())}
        onRespond={(cardId, at) => dispatch(actions.respondInterrupt(cardId, at))}
        deflectTarget={deflectTarget}
        onDeflectTarget={setDeflectTarget}
      />

      {/*
        THE CARD ON THE TABLE, in the flow above the board so every seat that is not
        answering sees it — the same placement as the response window above, and for
        the same reason: this is table information, not an interruption of the seats
        that receive it. Deliberately NOT suppressed by `windowOpen`, unlike the two
        overlays further down: a BLOCK or a DEFLECT does not put a different card on
        the table, it puts a question to somebody else about the card already there,
        so a responder who can see what they are intervening in is being told the
        thing the physical game tells them by reading it aloud.
      */}
      {tableQuestion !== null ? (
        <TableQuestion question={tableQuestion} answererName={answererName} />
      ) : null}

      {/*
        THE STAND OF THE BOARD, third panel in the same place and for the same
        reason: table information, above the board, for every seat including a
        spectator. It renders nothing until the engine says something true — a
        game that is still going anywhere says so by being silent.

        THE DEFECT THIS IS FOR: a real three-seat run sat at 490 turns with eight
        constituencies held and Central one vote short with its last empty slot
        right there, and every screen showed an ordinary game. A player cannot
        concede a game they do not know is over, and they cannot tell a dead table
        from a slow one. It does not end the game and does not say the game is
        over — there is no such rule — so what it says is the one thing that is
        true and was previously said nowhere.
      */}
      <StandBanner state={state} />

      {/*
        AND WHY YOUR LAST PRESS DID NOTHING, fourth panel in the same place.

        This one is not table information, it is a sentence about something that
        happened to THIS seat, and it existed in `store.ts` for a year of commits
        with no renderer outside two bars that are only mounted during a
        placement or a gerrymanding. Every refusal from the market, the powers
        tray, the TRADE row, the Conspiracy buttons and `send` itself was written
        and shown to nobody. Found in a browser: an enabled market card, a real
        click, no frame on the wire and not one word on the page.

        `suppressed` hands the message back to the bar that flashes its own copy,
        so a refusal raised mid-placement is still said once, where the decision
        is being made, and not twice.
      */}
      <RefusalLine
        refusal={app.refusal}
        suppressed={placingGroup !== null || app.gerryZoneId !== null}
        onExpire={clearRefusal}
      />

      <div className="shell__body">
{/*
          THE BOARD'S BOX, AND WHAT ACTUALLY HOLDS IT UP.

          This comment used to say that `BoardSvg` needed an aspect-ratio wrapper
          and `height="100%"` because an SVG with no intrinsic height collapses to
          zero, and that the board had been rendering 0x0 with 258 nodes in the DOM
          and nothing on screen. Both halves of that are wrong, and the second one
          was measuring the wrapper rather than the board.

          MEASURED, in headless Chrome against a live match on a real server,
          2026-10-02, with the reveal frame forced clear so the reserve is not
          moving underneath the numbers. `land` is the board's own rect — what a
          player actually looks at — not the wrapper's:

            page        wrapper        the board itself   nodes  slots
            1600x1000   780 x 610.00   374.13 x 588.73     617    129
            1440x960    780 x 770.00   472.27 x 743.15     617    129
            1280x900    780 x 710.00   435.47 x 685.24     617    129
             900x900    493 x 710.00   435.47 x 685.24     617    129

          There is no zero-height collapse: 617 nodes, 129 slots and a box with
          real dimensions at every viewport. The premise about the SVG does not hold
          either — `BoardSvg` always emits `viewBox="0 0 1000 1500"` alongside the
          `width`/`height` attributes, and an SVG with a viewBox has an intrinsic
          aspect ratio.

          ── AND THE "dead gutter" IS NOT A BUG EITHER ──

          `.board__canvas` sets `aspect-ratio: 1000/1500` AND `max-height`, which
          read as a contradiction: the aspect wants 1.5x the width, the clamp caps
          the height, and `preserveAspectRatio` letterboxes the result — so at
          1440x960 the board draws 472px of content inside a 780px wrapper and
          ~154px goes to waste on each side. The reading is correct about the
          letterbox and wrong about the waste, because the board is HEIGHT-bound:
          it is already as large as the 190px reserve allows, and surplus width is
          not convertible into anything.

          Both candidate rules were A/B'd into the SAME live page at those four
          viewports, so the only variable was the rule:

            page        width cap (new)      height cap (current)   the board
            1600x1000   box 406.66 x 609.98  box 780.00 x 609.98    374.12 x 588.72
            1440x960    box 513.33 x 769.98  box 780.00 x 770.00    472.26 x 743.14
            1280x900    box 473.33 x 709.98  box 780.00 x 710.00    435.46 x 685.23
             900x900    box 473.33 x 709.98  box 493.00 x 710.00    435.47 x 685.24

          The board's rect is the SAME to a hundredth of a pixel in every row, at
          the same distance below the fold. The width cap only makes the wrapper
          tight, and at 900x900 it gives up 20px of width for nothing. So the
          pairing stays and this comment no longer claims a fix that was measured
          and found not to be one. Making the board BIGGER is a different question:
          190px is the topbar, the shell padding and the log rail, and the board
          already has all the height that leaves. That is a different reserve, not a
          different box, and it is not this comment's decision to take.
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

          {/* THE KEY TO THE BOARD. Every constituency prints two fractions — `6/11`
              large and `0/11` small — and nothing said which was which, so the most
              important number on the board (how many voters a majority takes) read
              the same as a fill count. */}
          <p className="board__legend" aria-label="Board key">
            <span>
              <b>6/11</b> voters needed for a majority / areas in the constituency
            </span>
            <span>
              <b className="board__legend-small">0/11</b> areas filled
            </span>
            <span>
              <b aria-hidden="true">✳</b> Volatile area — a voter there is permanent and triggers a
              Headline
            </span>
          </p>

          {placingGroup !== null && !windowOpen ? (
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

          {app.gerryZoneId !== null && you !== null && !windowOpen ? (
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
          {/*
            THE HQ MAT IS FIRST AND YOUR MAT IS SECOND, and this is a layout decision
            with a defect behind it.

            It used to be your mat, then the market — which put the three Voter Cards you
            spend your resources on at the BOTTOM of a `position: sticky` column with
            `overflow-y: auto`. On a short desktop window that made the market the first
            thing below the fold and the powers tray the second. `YourMat`'s own header
            records the same problem from the other side: when the market strip lived
            INSIDE the mat, it pushed the powers tray down.

            So the order is now by how often the eye needs it. The market is three cards
            and a price, it is what you look at when you hold something to spend, and it
            is the shortest panel on the screen. Your mat is longer, holds what you read
            rather than what you press, and scrolls within the column.

            Both are still in the same column and §5.13's tabs are untouched: below 600px
            MARKET and MAT are separate tabs and neither order is visible.

            §5.13's FOURTH TAB also used to be missing here entirely. The phone tab bar
            has four buttons — Board · Mat · Market · Log — while the shell had only
            three tabpanels, so MARKET matched nothing, every panel went `display:none`,
            and the player got a blank screen under a working tab bar. Found by pressing
            all four in a browser; no structural test could see it, because all four
            buttons and all three panels were present in the DOM either way.
          */}
          <div className="tabs" data-tabpanel="market" data-active={tab === 'market'}>
            {role === 'player' && you !== null ? (
              <MarketPanel
                state={state}
                you={you}
                disabled={windowOpen || !isMyTurn || app.link !== 'live'}
                disabledReason={inertReason}
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
                armed={
                  app.marketModifier === null
                    ? null
                    : {
                        slot: app.marketModifier.slot,
                        discounts: app.marketModifier.discounts,
                      }
                }
              />
            ) : (
              /* §5.11: the spectator treatment is the ABSENCE of controls, so the
                 market panel says nothing at all rather than rendering three dead
                 slots. */
              <section className="panel" aria-label="HQ market">
                <h2 className="panel__title">Voter Cards</h2>
                <p className="panel__note panel__note--quiet">
                  You are watching. The market is the players&apos; to buy from.
                </p>
              </section>
            )}
          </div>

          {/* §5.13's MAT TAB. On a desktop this is the second panel in the side
              column, which is what the mat's own header comment always claimed. */}
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
              showControls={role === 'player' && you !== null && !windowOpen}
              inertReason={inertReason}
              onSelectGroup={(id) => beginPlacement(id)}
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
            />
          </div>
        </div>

        {/* §5.13: the log becomes a tab below 600px. The attributes are constant and
            the CSS decides what to do with them — swapping the class in JS meant the
            desktop and phone rules were reading different elements.

            IT IS INSIDE THE BODY GRID NOW. It used to be a 132px strip after the
            body, so on a desktop it sat below the bottom of the board and below the
            whole side column: the record of what just happened was the one thing on
            the page you could only reach by scrolling past everything else. In the
            grid it is a column of its own on a wide screen and sits under the mat on
            a narrower one (`polish.css`). */}
        <div className="tabs shell__logcell" data-tabpanel="log" data-active={tab === 'log'}>
          <LogRail state={state} />
        </div>
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
            {TAB_LABEL[t]}
            {/* A count on the tab that has something waiting, so a phone player on
                the board tab can see their mat needs them without opening it. */}
            {t === 'mat' && isMyTurn && (me?.pending.length ?? 0) > 0 ? (
              <span className="tabbar__badge" aria-label={`${me?.pending.length} groups to place`}>
                {me?.pending.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* END TURN, AND IT IS NOW REACHABLE AT EVERY WIDTH. This is a bug fix, and
          it is the third of three that between them meant a desktop player could not
          end a turn at all:

            1. `.endturn-dock` was `display: none` outside the `max-width: 599px`
               query, so the dock below was phone-only chrome.
            2. The "END TURN on desktop" block that followed it was
               `{isMyTurn && state.phase === 'actions' && !isMyTurn ? null : null}`
               — `isMyTurn && !isMyTurn` is unsatisfiable, so it rendered nothing on
               every width, forever. Dead code with a comment above it explaining a
               button that was not there.
            3. `YourMat` has taken an `onEndTurn` prop since the mat was split into
               its own panel, and has never rendered it — §5.4 lists END TURN as mat
               region 5 and the prop has sat unused ever since.

          So the one live control is this dock, and it is now shown at every width
          rather than only on a phone. It is a FIXED bar along the bottom for the same
          reason it was fixed on a phone: it is the one control that must never require
          a scroll, and it must never be the only way to do something the player
          cannot find. Ending a turn is still a DECISION and never a default (§5.4) —
          it is not auto-highlighted, and it is hidden outright when it is not the
          player's turn, rather than shown dead. */}
      {isMyTurn && state.phase === 'actions' && !windowOpen ? (
        <div className="endturn-dock">
          {/* THE NEXT STEP, IN ONE SENTENCE. The dock used to say only
              "0 groups of voters still to place", which is a consequence of the
              button rather than a guide to the turn — and a new player at the start
              of the actions phase had nothing on screen telling them that the
              market is how you get voters. `turnGuide` reads the same state the
              mat and market render, so it cannot disagree with them. */}
          <div className="endturn-dock__lead">
            <p className="endturn-dock__guide" data-testid="turn-guide">
              {turnGuide(state, you, placingGroup !== null)}
            </p>
            {/* THE GUIDE CAN DO THE STEP IT NAMES. Telling a player "choose a group
                under Voters to place" and leaving them to find it is half a guide. */}
            {(() => {
              if (placingGroup !== null || me === null) return null;
              const first = me.pending[0];
              if (first !== undefined) {
                return (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      beginPlacement(first.id);
                      setTab('board');
                    }}
                    data-testid="guide-place"
                  >
                    PLACE VOTERS
                  </button>
                );
              }
              const affordable = state.market.some((slot) =>
                canAfford(me.resources, marketCharge(state, you as PlayerID, slot, [])),
              );
              if (!affordable) {
                const hint = you === null ? null : tradeHint(state, you);
                if (hint === null) return null;
                return (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      openTrade(hint.partner);
                      setTradeReceive(hint.need);
                    }}
                    data-testid="guide-trade"
                  >
                    TRADE WITH {(state.players[hint.partner]?.name ?? '').toUpperCase()}
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    setTab('market');
                    document
                      .querySelector('[data-testid=market-panel]')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  data-testid="guide-market"
                >
                  SHOW VOTER CARDS
                </button>
              );
            })()}
          </div>
          <div className="endturn-dock__end">
            {/* Only when it is true and matters: "0 groups of voters still to place"
                was printed on every turn, including the turns with nothing to place. */}
            {placingGroup !== null ? (
              <p className="endturn-dock__note">Placing voters — finish or cancel that first.</p>
            ) : (me?.pending.length ?? 0) > 0 ? (
              <p className="endturn-dock__note">
                {me?.pending.length} group{me?.pending.length === 1 ? '' : 's'} of voters still to
                place; ending the turn discards them.
              </p>
            ) : null}
            {confirmEnd ? (
              <button type="button" className="btn btn--sm" onClick={() => setConfirmEnd(false)}>
                KEEP PLAYING
              </button>
            ) : null}
            <button
              type="button"
              className={`btn endturn-dock__btn ${confirmEnd ? 'endturn-dock__btn--confirm' : ''}`}
              onClick={() => {
                const waiting = (me?.pending ?? []).reduce((n, g) => n + g.count, 0);
                if (waiting > 0 && !confirmEnd) {
                  setConfirmEnd(true);
                  return;
                }
                setConfirmEnd(false);
                dispatch(actions.endTurn());
              }}
              disabled={!live}
              aria-disabled={!live}
              data-testid="end-turn"
            >
              {confirmEnd
                ? (() => {
                    const n = (me?.pending ?? []).reduce((sum, g) => sum + g.count, 0);
                    return `DISCARD ${n} VOTER${n === 1 ? '' : 'S'} & END TURN`;
                  })()
                : 'END TURN'}
            </button>
          </div>
        </div>
      ) : null}

      {state.finished && reviewingBoard ? (
        <div className="endturn-dock endturn-dock--review" data-testid="review-dock">
          <p className="endturn-dock__guide endturn-dock__guide--plain">
            The game is over. This is the final board.
          </p>
          <button
            type="button"
            className="btn endturn-dock__btn"
            onClick={() => setReviewingBoard(false)}
          >
            BACK TO RESULTS
          </button>
        </div>
      ) : null}

      {/* ── Overlays, in priority order. ── */}
      {/*
        G13 — THE TWO OVERLAYS WHOSE COMMIT IS A REFUSAL WHILE A WINDOW IS OPEN.

        `ANSWER` and `ACK_HEADLINE` are both in `reduce.ts`'s window guard, so while
        a card is being answered neither prompt can be paid. Rendering either would
        put a full-viewport takeover on screen whose only button earns a toast —
        and in the answer case it would be worse than a dead control, because the
        the answer prompt is the one screen in this game a player must not be able to
        read past. Both reappear the moment `state.interrupt` goes back to `null`,
        with the prompt exactly as it was left, because `store.answer` and
        `state.activeHeadline` are untouched by any of this.

        The one thing that is NOT suppressed is `ChoiceResolver`, below:
        `RESOLVE_CHOICE` is legal for the whole length of the window on purpose.
      */}
      {store.answer !== null && isMyTurn && state.phase === 'answer' && !windowOpen ? (
        <AnswerScreen
          state={state}
          prompt={store.answer as AnswerPrompt}
          you={you as PlayerID}
          viewId={store.viewId}
          errorAt={store.error === null ? null : store.error.at}
          picker={app.picker}
          onCommit={(displayIndex) => {
            // SNAPSHOT THE CARD BEFORE DISPATCHING. This is the last instruction that
            // runs while `store.answer` is still non-null, and it is the only place
            // from which the whole card can still be read — see `committedCard`.
            const prompt = store.answer;
            const landed = dispatch(actions.answer(displayIndex));
            if (landed && prompt !== null) {
              // `cardForResolution` drops `order` on the way in — see its docstring.
              // The snapshot is deliberately NOT the whole `AnswerPrompt`.
              committedCard.current = {
                prompt: cardForResolution(prompt),
                chosenIndex: displayIndex,
              };
            }
            return landed;
          }}
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

      {state.phase === 'headlines' && !windowOpen ? (
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
          onResolvePegDest={(choiceId, areaId, toAreaId) => {
            // G1 — ONE pick carrying BOTH halves, in the engine's field order. Not
            // `areas`: `resolveChoice`'s arm reads `pick.areaId`/`pick.toAreaId` and
            // refuses anything else with "choose a voter and where it goes".
            dispatch(actions.resolveChoice(choiceId, { kind: 'peg-dest', areaId, toAreaId }));
            clearPowerTarget();
            clearToughLove();
          }}
          onResolvePlayer={(choiceId, playerId) => {
            dispatch(actions.resolveChoice(choiceId, { kind: 'player', id: playerId }));
            clearPowerTarget();
          }}
          onResolveZone={(choiceId, zoneId) => {
            dispatch(
              actions.resolveChoice(choiceId, { kind: 'zone', zoneId: zoneId as ZoneID }),
            );
            clearPowerTarget();
          }}
          recycle={recycle}
          onResolveCard={(choiceId, cardId) => {
            dispatch(actions.resolveChoice(choiceId, { kind: 'card', cardId }));
            clearPowerTarget();
          }}
          /*
             NO `draft` / `onDraft`, AND THE ABSENCE IS THE FIX.
             The draft used to be `app.picker.pick` — one store slot shared with the
             redraw payment, the Conspiracy purchase and the trade composer, and
             nulled by `clearTurnInteraction()` on `[store.viewId, state?.turn]`. So
             every `match:state` the server sent wiped a half-entered over-cap
             discard, and at an ask of 41 against a cap of 12 that is a permanent
             lock rather than a race: ten playthroughs, 300+ turns, no resource ever
             discarded. `ChoiceResolver` now keys its own draft on the decision id.
             The full argument, with the harness arcs as evidence, is on that
             component.
          */
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
          you={you as PlayerID}
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
  const [help, setHelp] = useState(false);
  const me = you === null ? null : state.players[you] ?? null;
  const active = state.players[state.activePlayer]?.name ?? '—';
  const yours = you !== null && state.activePlayer === you;
  // THE PHASE, SAID AS A SENTENCE. This used to print the engine's own word —
  // `answer`, `actions`, `headlines` — in the corner, which told a player nothing
  // they could act on. The raw phase stays on `data-phase` for drivers and tests.
  const status =
    state.phase === 'finished'
      ? 'Game over'
      : state.phase === 'answer'
        ? yours
          ? 'Your turn · answer your card'
          : `${active} is answering`
        : state.phase === 'headlines'
          ? 'Headlines are being read'
          : yours
            ? 'Your turn'
            : `${active}'s turn`;
  return (
    <header className="shell__top">
      <span className="shell__wordmark">SHASN</span>
      <span className="shell__meta shell__round">
        Round {state.round} · Turn {state.turn}
      </span>

      {/* THE TABLE, in turn order: seat colour, name, and score — the number of
          majority voters, which is the only thing that wins. The active seat is
          marked by shape (▶ and a ring) as well as by colour. */}
      <ol className="players" aria-label="Turn order">
        {state.turnOrder.map((id) => {
          const p = state.players[id];
          const score = majorityCount(state, id);
          const isActive = id === state.activePlayer;
          return (
            <li
              key={id}
              className={`player seat--${seatIndex(state.turnOrder, id)}`}
              data-active={isActive ? 'true' : undefined}
              data-you={id === you ? 'true' : undefined}
              title={`${p?.name ?? id}: ${score} majority voter${score === 1 ? '' : 's'}${isActive ? ' · playing now' : ''}`}
            >
              <span className="player__name">
                {isActive ? <span aria-hidden="true">▶ </span> : null}
                {p?.name ?? '—'}
                {id === you ? <span className="player__you"> (you)</span> : null}
              </span>
              <span className="player__score" aria-label={`${score} majority voters`}>
                ★ {score}
              </span>
            </li>
          );
        })}
      </ol>

      <span className="shell__spacer" />

      <span
        className="shell__status"
        data-testid="phase-readout"
        data-phase={state.phase}
        data-yours={yours ? 'true' : undefined}
      >
        {status}
      </span>

      {role === 'spectator' ? (
        <span className="shell__meta badge" data-testid="spectator-badge">
          SPECTATING
        </span>
      ) : null}

      {me === null ? null : <span className="sr-only">You: {me.name}</span>}

      <LinkDot link={app.link} attempts={app.attempts} />

      {/* THE RULES, MID-GAME. They were only reachable from the lobby, so a player
          who forgot what a power did or how a majority scores had to remember it. */}
      <button
        type="button"
        className="btn btn--sm shell__help"
        onClick={() => setHelp(true)}
        aria-haspopup="dialog"
        data-testid="open-help"
      >
        ? How to play
      </button>
      {help ? (
        <div className="scrim" onClick={() => setHelp(false)}>
          <div
            className="sheet sheet--wide"
            role="dialog"
            aria-modal="true"
            aria-label="How to play"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setHelp(false);
            }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 className="sheet__title">How to play</h2>
              <button type="button" className="btn btn--sm" onClick={() => setHelp(false)} autoFocus>
                CLOSE
              </button>
            </div>
            <RulesPanel />
          </div>
        </div>
      ) : null}
    </header>
  );
}

/**
 * THE WAY OUT OF "NOTHING IS AFFORDABLE". When no Voter Card can be bought, find
 * the card you are closest to, the resources you are missing for it, and an
 * opponent who holds all of them — so the guide can say who to trade with, and
 * for what, instead of only that you are stuck.
 */
function tradeHint(
  state: ClientState,
  you: PlayerID,
): { readonly partner: PlayerID; readonly need: Partial<Record<Resource, number>>; readonly text: string } | null {
  const me = state.players[you];
  if (me === undefined) return null;
  let best: { need: Partial<Record<Resource, number>>; missing: number } | null = null;
  for (const slot of state.market) {
    const cost = marketCharge(state, you, slot, []);
    const need: Partial<Record<Resource, number>> = {};
    let missing = 0;
    for (const r of RESOURCE_ORDER) {
      const gap = (cost[r] ?? 0) - me.resources[r];
      if (gap > 0) {
        need[r] = gap;
        missing += gap;
      }
    }
    if (missing > 0 && (best === null || missing < best.missing)) best = { need, missing };
  }
  if (best === null) return null;
  const want = best.need;
  const partner = state.turnOrder.find(
    (id) =>
      id !== you &&
      RESOURCE_ORDER.every((r) => (state.players[id]?.resources[r] ?? 0) >= (want[r] ?? 0)),
  );
  if (partner === undefined) return null;
  const words = RESOURCE_ORDER.filter((r) => (want[r] ?? 0) > 0)
    .map((r) => `${want[r]} ${r[0]!.toUpperCase()}${r.slice(1)}`)
    .join(' + ');
  return {
    partner,
    need: want,
    text: `You are ${words} short of a Voter Card, and ${state.players[partner]?.name ?? 'another player'} holds that. Try a trade.`,
  };
}

/**
 * What to do next on your own turn, as one sentence. Order matters: a placement in
 * progress beats voters waiting, which beat buying more.
 */
function turnGuide(state: ClientState, you: PlayerID | null, placing: boolean): string {
  if (you === null) return '';
  const me = state.players[you];
  if (me === undefined) return '';
  if (placing) return 'Click the highlighted areas on the board, then press CONFIRM.';
  const waiting = me.pending.reduce((n, g) => n + g.count, 0);
  if (waiting > 0) {
    return `You have ${waiting} voter${waiting === 1 ? '' : 's'} to place — choose a group under Pending voters, then click areas on the board.`;
  }
  const affordable = state.market.filter((slot) =>
    canAfford(me.resources, marketCharge(state, you, slot, [])),
  ).length;
  if (affordable > 0) {
    return `You can afford ${affordable} Voter Card${affordable === 1 ? '' : 's'} on the HQ Mat — buy one to get voters to place.`;
  }
  const hint = tradeHint(state, you);
  if (hint !== null) return hint.text;
  return 'Nothing on the HQ Mat is affordable and no one holds what you are missing. Use a power if you can, or end your turn.';
}

/** The phone tab bar's labels — words, capitalised, not the internal tab ids. */
const TAB_LABEL = { board: 'Board', mat: 'My mat', market: 'Market', log: 'Log' } as const;

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
 * G13 — the cards the SERVER says this viewer may answer the open window with.
 *
 * The same shape and the same fail-closed cast as `playableConspiracies`, and the
 * same reason: this client is never told what it holds, so a BLOCK or a DEFLECT can
 * only be offered if the server names it. `op` is validated too, and it is the field
 * that decides whether the control needs a target — a DEFLECT must name one and a
 * BLOCK must not, and the engine refuses a BLOCK that carries one.
 *
 * `undefined` — the field was absent, which is what today's server sends — is NOT
 * the same claim as `[]`, and `ResponseWindow` renders them differently rather than
 * showing an empty card list that would read as "you hold nothing that can answer".
 */
function responsiveConspiracies(
  state: ClientState,
  you: PlayerID | null,
): readonly ResponsiveCard[] | undefined {
  if (you === null) return undefined;
  const raw = (state as { responsiveConspiracies?: unknown }).responsiveConspiracies;
  if (!Array.isArray(raw)) return undefined;
  const out: ResponsiveCard[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (typeof c['id'] !== 'string') continue;
    if (typeof c['name'] !== 'string' || typeof c['text'] !== 'string') continue;
    if (c['op'] !== 'block' && c['op'] !== 'deflect') continue;
    out.push({ id: c['id'], name: c['name'], text: c['text'], op: c['op'] });
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

  // NOTHING CHOSEN YET IS NOT AN ERROR. The dialog used to open with a red
  // "add at least 1 resource to your side · ask for at least 1 resource" before the
  // player had touched anything — scolding them for the state it put them in.
  const untouched = giveTotal === 0 && receiveTotal === 0;
  // An empty side is a step still to take, not a mistake: say the step. Red is kept
  // for the one thing that is actually wrong — a side that cannot be paid.
  const nextStep =
    untouched
      ? 'Choose what you offer, and what you want in return.'
      : giveTotal < 1 && iCanGive && theyCanGive
        ? `Now choose what you give ${them.name} in return.`
        : receiveTotal < 1 && iCanGive && theyCanGive
          ? `Now choose what you want from ${them.name}.`
          : null;
  const problems: string[] = [];
  if (giveTotal < 1) problems.push('add at least 1 resource to your side');
  if (receiveTotal < 1) problems.push('ask for at least 1 resource');
  if (!iCanGive) problems.push('you do not hold what you are offering');
  if (!theyCanGive) problems.push(`${them.name} does not hold what you are asking for`);

  return (
    <div className="scrim">
      <div className="sheet sheet--trade" role="dialog" aria-modal="true" aria-label="Propose a trade">
        <h2 className="sheet__title">Trade with {them.name}</h2>
        <p className="sheet__body">
          Swap any of your resources for any of {them.name}&apos;s — any ratio, at least one each
          way. <strong>The trade happens the moment you press MAKE TRADE</strong>; there is no
          accept step, so agree it with {them.name} first. Ideology Cards cannot be traded.
        </p>

        <div className="row" style={{ alignItems: 'stretch' }}>
          <div className="col" style={{ flex: 1 }}>
            <span className="field__label">YOU GIVE</span>
            <DeltaStepper pool={me.resources} value={t.give} onChange={onGive} holder="you" />
          </div>
          <div className="col" style={{ flex: 1 }}>
            <span className="field__label">YOU GET</span>
            <DeltaStepper pool={them.resources} value={t.receive} onChange={onReceive} holder={them.name} />
          </div>
        </div>

        <p
          className={`picker__status ${valid || nextStep !== null ? '' : 'picker__status--short'}`}
          role="status"
          data-testid="trade-status"
        >
          {valid
            ? `${giveTotal} for ${receiveTotal}. Both sides exchange at least one resource.`
            : (nextStep ?? problems.join(' · '))}
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
            MAKE TRADE
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
  holder,
}: {
  pool: import('@shasn/engine').Pool;
  value: Readonly<Record<string, number>>;
  onChange: (v: Readonly<Record<string, number>>) => void;
  /** Whose pool this side draws from, for the "holds N" line. */
  holder: string;
}) {
  return (
    <div className="picker__grid">
      {RESOURCE_ORDER.map((r) => {
        const have = pool[r];
        const have2 = value[r] ?? 0;
        return (
          <div key={r} className="row row--tight stepper" data-res={r} style={{ flexWrap: 'nowrap' }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onChange({ ...value, [r]: Math.min(have, have2 + 1) })}
              disabled={have2 >= have}
              aria-label={`Add one ${r}`}
            >
              +
            </button>
            <span className="stepper__col">
              <ResourceGlyph resource={r} size={14} />
              <span className="picker__count stepper__count">
                {have2}
              </span>
              <span className="picker__name">{r}</span>
              <span className="stepper__have">
                {holder === 'you' ? 'you hold' : `${holder} holds`} {have}
              </span>
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

/*
  A SECOND, UNDISCOUNTED COPY OF THE MARKET BUY WAS HERE AND IT WAS DEAD.
  `onBuyMarket` priced `slot.cost` — no Helping Hands, no surcharge — and dispatched
  `actions.influence(index)` with no modifier at all. Nothing called it: every
  rendered control routes through `buyMarketCard`. So it was not a live defect, it
  was the silent click's own shape sitting in the tree waiting for someone to wire
  it to something, and the two copies disagreed about money. Deleted rather than
  fixed, because a second entry point for one action is a second thing to keep true.
*/

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
  /*
    THE SILENT BRANCH, AND IT WAS A REPORTED ONE.

    "An affordable card click sometimes does nothing" was this line: a bare
    `return` with no name on it. It is unreachable from the rendered strip — the
    index comes from `state.market.map`, so the slot is always there and the seat
    is always in `players` — which is exactly why it needed naming rather than
    deleting. §9.10's rule is the whole of the argument: a branch that leaves
    without acting and without saying why is indistinguishable, from outside, from
    a broken control, and the cost of being wrong is a player who is told nothing
    at all. This is the same invariant `powerInvariant.test.tsx` pins over
    `onSlotActivate`, and it is pinned over this function too.
  */
  if (me === undefined) {
    setRefusal('that seat is not in this game — nothing to buy with');
    return;
  }
  if (slot === undefined) {
    setRefusal('that Voter Card is no longer on the HQ Mat');
    return;
  }

  const mod = app.marketModifier?.slot === index ? app.marketModifier : null;

  /*
    THE PRICE IS `marketCharge`, THE SAME NUMBER THE STRIP PRINTS AND THE SAME
    NUMBER THE ENGINE CHARGES: the card's cost, the armed Helping Hands
    denominations down by one, and this player's surcharges added in Funds.
    Checking the undiscounted cost would refuse a legal buy; checking the
    DISCOUNTED-but-not-taxed cost — which is what lived here until the surcharge
    was found — refuses a buy the Conspiracy Card tax has already made illegal,
    from a button the strip had rendered live a moment earlier. See
    `derive.ts:marketCharge`.
  */
  const cost = marketCharge(state, you, slot, mod === null ? [] : mod.discounts);
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

// ─────────────────────────── small pure helpers ───────────────────────────

/**
 * THE POWER LEGALITY MOVED TO `derive.ts`, next to `powerTargetableAreas`.
 *
 * It used to be a private function here, immediately above this comment, and that
 * was the defect: the board needs the same rule to know what to HIGHLIGHT, and it
 * was not being told. With no `legalAreaIds` supplied, `BoardSvg` fell back to its
 * own rule — "an empty slot is the target" — which is true of every placement that
 * has ever used `mode: 'place'` and false of all three slot powers, whose every
 * legal target is an OCCUPIED slot. So the board announced every occupied slot as
 * `illegal: already occupied` while this handler accepted it, which is why Land
 * Grab read as "areas offered, CONFIRM never enables".
 *
 * One rule, one place, and the board's set is DERIVED from the refusal rather than
 * restated beside it, so the two cannot drift. The full argument is on
 * `derive.ts:powerAreaRefusal`.
 */

/*
 * `REVEAL_MS` USED TO BE HERE — 4000, the payout frame's self-retiring timer — and it
 * is gone rather than retuned. A screen that shows you what your answer was and what
 * it paid, and then removes itself after four seconds, cannot be read by a player who
 * looked away for one, and there is no way to get it back: the card is off the wire
 * by then. So the resolution waits for a press. See the `resolution` state above.
 */

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
 *
 * THE RESPONSE WINDOW IS CHECKED FIRST, and the ordering is the point rather than a
 * detail. A window can open inside ANY phase — `PLAY_CONSPIRACY` out of turn while
 * somebody is answering, `ACK_HEADLINE` in the headline queue, or an active player's
 * own card — and while it is open `reduce.ts` refuses every other action on the
 * table. Every other sentence below describes a phase that is nominally still the
 * one in progress and is, for the duration, not what is happening: a window can open
 * on somebody else's turn, so without this the screen-reader user hears "Ria is
 * thinking" while Ria's own controls are all refused.
 */
function describeForScreenReader(
  state: ClientState,
  isMyTurn: boolean,
  hasPrompt: boolean,
  you: PlayerID | null,
  openWindow: InterruptWindow | null,
): string {
  if (openWindow !== null) return windowLiveMessage(state, openWindow);
  if (hasPrompt && isMyTurn) return 'An Ideology Card has been put to you. Answer it.';
  if (state.phase === 'headlines') return 'A Headline is resolving.';
  const who = state.players[state.activePlayer]?.name ?? 'Someone';
  // The answer window, for every OTHER seat. The question is on the table and is
  // rendered above the board, so a screen-reader user is told where to find it
  // rather than only that somebody is busy — the same reason the response window
  // reads `state.interrupt` instead of saying nothing.
  if (state.phase === 'answer' && !isMyTurn) {
    return `${who} is answering. The question is on the table above the board.`;
  }
  if (isMyTurn) {
    const me = you === null ? null : state.players[you];
    const pending = me?.pending.length ?? 0;
    return `Your turn. ${pending} group${pending === 1 ? '' : 's'} of voters waiting.`;
  }
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
