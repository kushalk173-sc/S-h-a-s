/**
 * The remaining panels: the log rail, the reconnect screen, the scoreboard, the
 * headline dialog, and the lobby.
 *
 * All in one file because all of them are small and all of them are read-only
 * views over `ClientState`. Splitting four two-hundred-line components across
 * four files would be tidier and would make the "every screen is a STATE of one
 * shell" point (§5) harder to see, which is the thing this file demonstrates.
 */

import { useEffect, useState } from 'react';

import type { ClientState, PlayerID } from '@shasn/engine';

import type { Lobby, LobbySummary, SeatCount } from '../net/index.ts';

import { BOARD } from '../board/geometry.ts';

import {
  allMajoritiesFormed,
  boardFull,
  logRows,
  scoreboard,
  seatOf,
} from './derive.ts';
import { LOST_AFTER_MS } from './store.ts';
import type { Link } from './store.ts';

// ─────────────────────────── the log rail (§5.12) ───────────────────────────

/**
 * §9.11: the log is SENTENCES, not an icon-delta feed. `▲3 ⬤` is not a record;
 * `T11 · RIA placed 3 voters in North — North is now held by RIA (11/21)` is,
 * and a player who was away for twenty minutes catches up by reading it
 * top-down. So the entries render the engine's own `text` verbatim, at
 * TYPE_LOG in INK_700, with a 4px seat spine and a TYPE_LOG_META prefix.
 */
export function LogRail({ state }: { state: ClientState }) {
  const rows = logRows(state);
  return (
    <div className="shell__log" aria-label="Match log">
      {rows.length === 0 ? (
        <p className="panel__note panel__note--quiet">Nothing has happened yet.</p>
      ) : (
        <ul className="log" data-testid="log-rail">
          {rows.map((r, i) => (
            <li
              key={`${r.turn}-${i}`}
              className="log__row"
              data-seat={r.seat === null ? 'system' : String(r.seat)}
            >
              <span className="log__meta">
                T{r.turn}
                {r.who === null ? '' : ` · ${r.who}`}
              </span>
              <span className="log__text">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────── the reconnect screen (§5.2) ───────────────────────────

/**
 * `REJOIN MATCH`, and the honest-failure case.
 *
 * The requirement that shapes this component is the last one in the brief: never
 * show a spinner forever — a failed reconnect must SAY SO. So there are three
 * distinct states with three distinct bodies of copy, and the third is a plain
 * statement of failure with a manual retry, not an indefinite "reconnecting…":
 *
 *   connecting     what is happening
 *   reconnecting   what is happening, with the attempt count and elapsed time
 *   lost           the table has not answered, here is how long we waited, and
 *                  here is a button. The transport is STILL retrying underneath;
 *                  this only stops the copy promising something it cannot deliver.
 *
 * The seat is held server-side for a full day (`DEFAULT_GRACE_MS` on the server),
 * so "lost" is never "your game is gone" — and the copy says so, because a player
 * who thinks a four-hour game died will not do anything sensible next.
 */
export function ReconnectScreen({
  link,
  attempts,
  retryingMs,
  onRetry,
  onLeave,
  name,
  phase,
}: {
  link: Link;
  attempts: number;
  retryingMs: number;
  onRetry: () => void;
  onLeave: () => void;
  name: string;
  phase: string;
}) {
  const lost = link === 'lost';
  const seconds = Math.floor(retryingMs / 1000);
  return (
    <div className="reconnect" data-testid="reconnect-screen">
      <div className="reconnect__sheet" role="status">
        <p className="eyebrow">SHASN</p>
        <h1 className="sheet__title">
          {lost ? 'The table has not answered' : link === 'connecting' ? 'Connecting' : 'Reconnecting'}
        </h1>

        <p className="reconnect__status">
          Seat: <strong>{name}</strong>
        </p>
        <p className="reconnect__status">Phase you were in: {phase}</p>

        <p className={`reconnect__status ${lost ? 'reconnect__status--bad' : ''}`} data-testid="reconnect-status">
          {lost
            ? `We have been trying for ${LOST_AFTER_MS / 1000} seconds and heard nothing back. ` +
              'Your seat is still held — the game has not been lost, and nothing you did was ' +
              'discarded. Try again, or leave and come back later.'
            : link === 'connecting'
              ? 'Opening the connection.'
              : `Attempt ${attempts}${seconds > 0 ? ` · ${seconds}s elapsed` : ''}. The seat is held ` +
                'while we wait; the turn simply waits with it.'}
        </p>

        <div className="row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={onRetry}
            data-testid="rejoin"
            autoFocus
          >
            REJOIN MATCH
          </button>
          <button type="button" className="btn" onClick={onLeave} data-testid="leave">
            LEAVE
          </button>
        </div>

        {lost ? (
          <p className="panel__note panel__note--quiet">
            A background tab is a common cause: a sleeping laptop stops answering sockets. Bringing
            the tab forward usually resolves it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────── the scoreboard (§5.10) ───────────────────────────

/**
 * The score IS the count of majority voters — there is no other scoring
 * expression in this game, which is why the bar is drawn against exactly that
 * and not against a board percentage.
 *
 * §5.10's requirement about ties is a VISUAL one: a single 12px rule with a tick
 * at the winning score, so a tie reads as two equal bars rather than as two
 * numbers with no context. No crown, no confetti (§9.9).
 *
 * AND THE TIE RULE IS PRINTED, because §5.10 says so for a reason: a player who
 * filled the board and then lost will otherwise think the game was rigged. The
 * `finalRoundFrom` field is the evidence, and it is shown.
 */
export function Scoreboard({
  state,
  you,
  winners,
  onViewBoard,
  onNewMatch,
}: {
  state: ClientState;
  you: PlayerID | null;
  /**
   * WHO WON, from the server's `match:over`. `null` means the server has not said.
   *
   * THE SCORES BELOW ARE DERIVED and this list is not, and the asymmetry is the
   * point. A score is `majorityCount` per seat: a pure function of the board every
   * viewer already holds, so deriving it is free and cannot be stale. A WINNER is a
   * judgement with three branches -- one winner, a genuine tie, and the scoreless
   * board on which `winners()` deliberately names nobody -- and this component used
   * to decide it by asking "whose score is highest", which on a scoreless board
   * printed "P1 WINS WITH 0". That is the same bug `board.ts:winners` documents
   * having had and fixed server-side, re-introduced in the sentence that tells a
   * player they won.
   *
   * So the ranking is computed here and the verdict is not. `null` is a real state:
   * a client that reconnects after the game ended gets the final board and never the
   * `match:over` frame. It then shows the ranked table and claims nothing, which is
   * the honest answer and the only one available without inventing an authority.
   */
  winners: readonly PlayerID[] | null;
  onViewBoard: () => void;
  onNewMatch: () => void;
}) {
  const rows = scoreboard(state, you);
  const top = rows[0]?.score ?? 0;
  const max = Math.max(top, 1);
  const boardWasFull = boardFull(state);
  const allFormed = allMajoritiesFormed(state);

  /** The score of a seat the server named, for the headline sentence. */
  const scoreOf = (id: PlayerID): number =>
    rows.find((r) => r.player === id)?.score ?? 0;
  const nameOf = (id: PlayerID): string =>
    rows.find((r) => r.player === id)?.name ?? '—';

  /**
   * THE HEADLINE. Three branches because the engine has three, and no branch is
   * inferred from the scores: `winners` is either empty (nobody), one seat, or two
   * or more tied at the top.
   */
  const verdict = ((): string => {
    if (winners === null) return 'RESULT';
    if (winners.length === 0) return 'NOBODY WON';
    if (winners.length === 1) {
      const id = winners[0] as PlayerID;
      return `${nameOf(id)} WINS WITH ${scoreOf(id)}`;
    }
    // A tie is a genuine draw and is reported as one. p20's "privilege" tie-breaker
    // is recorded as explicitly non-binding and out of scope for a digital
    // implementation, so no tie-break is applied and none is implied.
    return `${winners.map(nameOf).join(' & ')} TIE AT ${scoreOf(winners[0] as PlayerID)}`;
  })();

  return (
    <div className="lobby">
      <div className="sheet sheet--wide" data-testid="scoreboard">
        <p className="eyebrow">RESULT</p>
        <h1 className="sheet__title" data-testid="score-verdict">
          {verdict}
        </h1>

        {winners !== null && winners.length === 0 ? (
          <p className="sheet__body">
            Nobody held a majority voter when the game ended, so there is no winner to name. The
            board below is the result as it stood — which is the same standing the engine records,
            and p20 asks for no substitute.
          </p>
        ) : winners === null ? (
          <p className="sheet__body">
            The game is over and the final board is below. This client was not on the wire when the
            result was announced, so it is not going to guess who won from the scores — the server
            sends that, and a guess is how a table gets told two different things.
          </p>
        ) : null}

        {boardWasFull ? (
          <p className="sheet__body">
            The board filled before every majority formed, so everyone took one more turn, starting
            with whoever filled the last slot. That is p20, and it is why the result is not simply
            the first player to run out of room.
          </p>
        ) : allFormed ? (
          <p className="sheet__body">
            Every constituency has a majority. The game ends when all nine are held — there is no
            tiebreak and no bonus for the order they formed in.
          </p>
        ) : null}

        {rows.map((r) => (
          <div key={r.player} className="score__row" data-testid="score-row">
            <div className="score__head">
              <span className={`seat seat--${r.seat}`}>
                <span className="seat__name">{r.name}</span>
                {r.isYou ? <span className="chip">you</span> : null}
              </span>
              <span className="score__value">
                {r.score} majority voter{r.score === 1 ? '' : 's'}
              </span>
            </div>
            <div className="score__bar" aria-hidden="true">
              <div className="score__bar-fill" style={{ width: `${(r.score / max) * 100}%` }} />
            </div>
            <p className="score__zones">
              {r.zones.length === 0
                ? 'No constituencies held.'
                : `Held ${r.zones.join(', ')} — ${r.zones.length} of 9.`}
            </p>
          </div>
        ))}

        <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
          <button type="button" className="btn" onClick={onViewBoard}>
            VIEW BOARD
          </button>
          <button type="button" className="btn btn--primary" onClick={onNewMatch}>
            NEW MATCH
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── the headline dialog (§5.9b) ───────────────────────────

/**
 * One Headline per Volatile-Area placement, in placement order.
 *
 * THE CARD TEXT IS NOT AVAILABLE TO THE CLIENT, and this is a real limitation
 * rather than a shortcut. `ClientState` carries `activeHeadline: CardID | null`
 * and `headlineQueue`, but the card corpus is not part of the wire view, and
 * `packages/client` deliberately has no value import of the engine — so there is
 * no legal way for this client to read a Headline's name or body. The dialog
 * therefore resolves the Headline and says plainly which one is up, using the
 * queue position §5.9b asks for. The full text would need a server-side
 * projection; that is reported rather than faked.
 *
 * A pending `Choice` raised by the Headline is resolved first, by
 * `ChoiceResolver`, which sits above this dialog in the render order. The order
 * is load-bearing: `ACK_HEADLINE` applies the card's effects, and a card whose
 * effect needs a target raises the choice, so the choice must be answerable
 * before the acknowledge is offered.
 */
export function HeadlineDialog({
  state,
  you,
  onAcknowledge,
}: {
  state: ClientState;
  you: PlayerID | null;
  onAcknowledge: () => void;
}) {
  if (state.phase !== 'headlines' || state.activeHeadline === null) return null;
  const me = you === null ? null : state.players[you];
  const isMine = you !== null && state.activePlayer === you;
  // The queue is drained in array order, so the position is the array length
  // remaining — stated as "1 of N" counting from the front, which is the order
  // they will actually be played in.
  const remaining = state.headlineQueue.length;

  return (
    <div className="scrim" data-testid="headline-dialog">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Headline resolution"
      >
        <p className="eyebrow">
          HEADLINE {Math.max(1, remaining - remaining + 1)} OF {remaining}
        </p>
        <h2 className="sheet__title">A Headline breaks</h2>

        <div className="zones-strip" style={{ marginBottom: 'var(--sp-3)' }} aria-hidden="true">
          {state.headlineQueue.map((q, i) => (
            <span
              key={`${q.areaId}-${i}`}
              className={`zones-strip__cell ${i === 0 ? 'zones-strip__cell--picked' : ''}`}
            >
              {i + 1}
            </span>
          ))}
        </div>

        <p className="sheet__body">
          A voter landed in a Volatile Area, so a Headline resolves at the end of the turn. Its
          effects are applied when you resolve it, and it may ask you for a decision.
        </p>

        {/*
          THE DEVELOPER NOTE THAT WAS HERE IS GONE, and it is worth saying what it
          said: "The card's printed text is not part of the public state this client
          is given, so the card resolves by its effect alone. That is a gap in the
          wire view, not a rendering choice."

          That is a true sentence about `broadcast.ts` addressed to nobody. It
          rendered to a PLAYER, mid-turn, in the middle of the decision they owed —
          the highest-cognitive-cost moment in the game — and told them nothing
          they could act on. A wire-shape gap is a bug report, not copy.

          The gap itself is real, is not this client's to close, and is documented
          where a limitation belongs: the `HeadlineDialog` docstring above. Nothing
          is lost by deleting it from the frame.
        */}

        <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onAcknowledge}
            disabled={!isMine || me === null}
            aria-disabled={!isMine}
            data-testid="ack-headline"
          >
            RESOLVE
          </button>
          {!isMine ? <p className="panel__note">Waiting for the active player to resolve it.</p> : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── the lobby (§5.1) ───────────────────────────

/**
 * A room's own key, as shown on its row.
 *
 * `lobbyId` is minted by the server as `l_` + 8 random bytes (`room.ts:newId`), so
 * it is already eleven characters and was already chosen to be short enough to
 * show. This function therefore shortens NOTHING — and that is worth stating,
 * because the obvious "trim it to six characters for the row" instinct produces a
 * worse key: `l_aB3xY9zQ1` and `l_aB3xW2pL8` share their first six characters, so
 * a truncated key re-creates the very collision this row exists to remove. (A test
 * caught exactly that while this was being written: two realistic ids that differ
 * only after the sixth character rendered as identical rows.)
 *
 * It stays a function so the decision has one name, and so a future id shape that
 * IS too long to show has somewhere to go.
 */
function roomKey(lobbyId: string): string {
  return lobbyId;
}

/**
 * WHY this room's JOIN is disabled, as a sentence — `undefined` when it is not.
 *
 * A greyed JOIN with no reason is the §9.2 prohibited case, and in a list of
 * rooms it is worse than a dead control: `inProgress` and `seated ===
 * maxPlayers` are properties of ONE room, and without this the only visible fact
 * is that *some* room's button is off. A first-time player reads that as "I am
 * looking at the wrong room" — which cost the harness two wrong joins.
 *
 * A `title` is not reachable by touch or by a screen reader on some
 * combinations, so it is a summary, not the only channel: the row itself prints
 * `in progress`, and the seat count is right there beside it.
 */
function joinRefusalReason(name: string, l: LobbySummary): string | undefined {
  if (name.trim() === '') return 'Type a name before joining a room.';
  if (l.inProgress) return 'That match has already started — WATCH it instead.';
  if (l.seated >= l.maxPlayers) return 'That room is full — WATCH it instead.';
  return undefined;
}

export type LobbyScreenProps = {
  readonly lobbies: readonly LobbySummary[];
  readonly lobby: Lobby | null;
  readonly name: string;
  readonly you: PlayerID | null;
  readonly isHost: boolean;
  readonly canStart: boolean;
  readonly onNameChange: (name: string) => void;
  readonly onList: () => void;
  readonly onCreate: (maxPlayers: SeatCount) => void;
  readonly onJoin: (lobbyId: string) => void;
  readonly onReady: (ready: boolean) => void;
  readonly onStart: () => void;
  readonly onLeave: () => void;
  readonly onSpectate: () => void;
  /**
   * Watch a room from the OPEN ROOMS list, holding no seat in it. A different
   * action from `onSpectate`, and deliberately available on a FULL room.
   */
  readonly onWatchRoom: (lobbyId: string) => void;
  /**
   * This connection is watching rather than seated: it holds no seat, so the
   * seat-taking controls are not rendered at all (§5.11 — the absence is the
   * signal). A spectator that was given a room by `lobby:spectate`.
   */
  readonly spectator: boolean;
};

export function LobbyScreen(props: LobbyScreenProps) {
  const { lobby } = props;
  const [seatCount, setSeatCount] = useState<SeatCount>(2);
  const [showRules, setShowRules] = useState(false);

  // §5.1: "player list 2–5 with seat colour, name, ready state; a JOIN button per
  // row; and the seat you will take, or the next free seat", all without
  // scrolling. The staggered start is stated per seat, because without that line
  // players read the asymmetry as a bug — and `RULES.staggeredStart` really does
  // give seat n exactly n resources.
  return (
    <div className="lobby" data-testid="lobby-screen">
      <div className="lobby__sheet">
        <div>
          <h1 className="lobby__h1">SHASN</h1>
          {/* THE PITCH, AND IT IS THE FIRST THING THE PRODUCT SAYS.
           *
           * It used to read "...and you cannot see the card you are about to answer",
           * which the full-information ruling made false — `FULL-INFORMATION.md` opens
           * "The blind answer is gone", and every seat now sees the question, both
           * answers, both Ideologues and both payouts before anybody answers. The
           * audit's judgement was right that this is the highest-visibility stale
           * string in the app: it is the first line a player reads.
           *
           * It survived because it is copy. None of the gates in the ruling can see
           * copy — they are about what crosses the wire and what reaches the DOM — so
           * this needed a gate of its own, and `staleWording.test.tsx` is it.
           *
           * WHAT THE NEW LINE PROMISES IS WHAT THE SERVER NOW SENDS, and no more: the
           * two answers and the two payouts are on the card before the choice. It does
           * NOT claim the payouts are knowable or that choosing is easy — the Ideologue
           * balance still makes one side the better bet, and that is a balance problem
           * argued in the corpus checker, not something a pitch line may paper over.
           *
           * AND IT SAYS "SEATS", NOT "VOTERS", because 129 is the AREA count. A
           * headless run read the old line literally, against a board that has 129
           * printed wells and no voters in them at the start, and filed it under
           * the things "a human would trip over": the first sentence the product
           * says miscounts its own board. The rules blurb lower down already said
           * "voter areas", so the pitch did not even agree with the app. */}
          <p className="lobby__sub">
            Four Ideologues. Nine constituencies. One hundred and twenty-nine seats, and both
            answers — with what each one pays — printed before you choose.
          </p>
        </div>

        <div className="col">
          <label className="field__label" htmlFor="player-name">
            YOUR NAME
          </label>
          <input
            id="player-name"
            className="field"
            value={props.name}
            maxLength={24}
            onChange={(e) => props.onNameChange(e.target.value)}
            data-testid="name-input"
          />
        </div>

        {lobby === null ? (
          <>
            <div className="col">
              <span className="field__label">CREATE A ROOM</span>
              <div className="row">
                <span className="chip">Players</span>
                {([2, 3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn btn--sm ${seatCount === n ? 'btn--primary' : ''}`}
                    onClick={() => setSeatCount(n)}
                    aria-pressed={seatCount === n}
                    data-testid={`seat-count-${n}`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => props.onCreate(seatCount)}
                  disabled={props.name.trim() === ''}
                  aria-disabled={props.name.trim() === ''}
                  data-testid="create-room"
                >
                  CREATE ROOM
                </button>
              </div>
            </div>

            <div className="col">
              <span className="field__label">OPEN ROOMS</span>
              {props.lobbies.length === 0 ? (
                <p className="panel__note panel__note--quiet">
                  No rooms are open. Create one, or wait for someone to.
                </p>
              ) : (
                props.lobbies.map((l) => (
                  <div
                    key={l.lobbyId}
                    className="row"
                    data-testid="room-row"
                    data-lobby-id={l.lobbyId}
                  >
                    <span className="seat seat--1">
                      <span className="seat__name">{l.name}</span>
                      <span className="seat__meta">
                        {/*
                          THE ROOM'S OWN KEY, on the row, because a room is not a
                          NAME. Two rooms created by players who both typed "Player"
                          rendered as two identical rows, so "press JOIN" was a guess:
                          the harness's driver joined the wrong room twice before it
                          gave its host a unique name, which is exactly the trap a
                          human falls into. `lobbyId` is already on the wire and is
                          the one field that distinguishes two rooms, so it is shown
                          — shortened, because it is a disambiguator and not a name.

                          The server mints it, so this client cannot make it prettier
                          than this; making it VISIBLE is the whole of the fix.
                        */}
                        <span data-testid="room-key">{roomKey(l.lobbyId)}</span>
                        {' · '}
                        {l.seated}/{l.maxPlayers}
                        {l.inProgress ? ' · in progress' : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => props.onJoin(l.lobbyId)}
                      disabled={props.name.trim() === '' || l.inProgress || l.seated >= l.maxPlayers}
                      aria-disabled={props.name.trim() === '' || l.inProgress || l.seated >= l.maxPlayers}
                      /* THE CONTROL NAMES ITS OWN ROW. "JOIN" on a list of identical
                         rows is an ambiguous label under WCAG 2.1 SC 2.4.6, and the
                         disabled case is worse: a full or running room's JOIN goes
                         grey with no reason on the button, so a first-time player
                         reads "JOIN is off, so this is the wrong room" — which is a
                         claim about the WRONG room when the room next to it is the
                         one they want. */
                      aria-label={`Join ${l.name}'s room ${roomKey(l.lobbyId)}`}
                      title={joinRefusalReason(props.name, l)}
                      data-testid="join-room"
                      data-lobby-id={l.lobbyId}
                    >
                      JOIN
                    </button>
                    {/* WATCH, AND WHY IT IS NEVER DISABLED.
                        Watching takes no seat — `lobby:spectate` mints a session no
                        write door accepts — so it has none of `JOIN`'s conditions. It
                        is specifically the FULL room that needs it: a full room's JOIN
                        is disabled, which left a finished-or-full table impossible to
                        watch from the real client at all. */}
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => props.onWatchRoom(l.lobbyId)}
                      data-testid="watch-room"
                      aria-label={`Watch ${l.name}'s room ${roomKey(l.lobbyId)} without taking a seat`}
                      data-lobby-id={l.lobbyId}
                    >
                      WATCH
                    </button>
                  </div>
                ))
              )}
              <button
                type="button"
                className="btn btn--sm"
                onClick={props.onList}
                data-testid="refresh-rooms"
              >
                REFRESH
              </button>
              <p className="panel__note panel__note--quiet">
                The list keeps itself up to date; REFRESH asks again now.
              </p>
              <p className="panel__note panel__note--quiet">
                WATCH takes no seat. The watcher sees the whole board and cannot act.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="col">
              <span className="field__label">SEATS · {lobby.name}</span>
              {Array.from({ length: lobby.maxPlayers }, (_, i) => {
                const seatNumber = (i + 1) as 1 | 2 | 3 | 4 | 5;
                const taken = lobby.seats[i];
                return (
                  <div
                    key={seatNumber}
                    className={`seat seat--${seatNumber} ${taken?.you === true ? 'seat--active' : ''}`}
                  >
                    <span className="seat__name">
                      {seatNumber}. {taken === undefined ? 'empty' : taken.name}
                      {taken?.you === true ? ' (you)' : ''}
                    </span>
                    <span className="seat__meta">
                      {/* The staggered start, stated. `RULES.staggeredStart` gives
                          seat n exactly n resources; without the line this reads
                          as a bug. */}
                      {seatNumber} resource{seatNumber === 1 ? '' : 's'} to spend
                      {taken?.ready === true ? ' · ready' : ''}
                      {taken?.connected === false ? ' · away' : ''}
                    </span>
                  </div>
                );
              })}
              {lobby.seats.length < 2 ? (
                <p className="panel__note">
                  Waiting for players — share the link. Two are needed to start.
                </p>
              ) : null}
            </div>

            <div className="row">
              {/* No seat means no READY. `lobby:ready` reaches `hub.setReady`, which
                  throws `NOT_IN_LOBBY` for anybody who is not a member, so a READY on
                  this screen could only ever earn a refusal toast — §9.10's dead
                  control. Absence is the spectator signal (§5.11). */}
              {props.spectator ? null : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const me = lobby.seats.find((s) => s.you);
                    props.onReady(me?.ready !== true);
                  }}
                  data-testid="ready-toggle"
                >
                  {lobby.seats.find((s) => s.you)?.ready === true ? 'READY ✓' : 'READY'}
                </button>
              )}
              {props.isHost ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={props.onStart}
                  disabled={!props.canStart}
                  aria-disabled={!props.canStart}
                  data-testid="start-match"
                >
                  START MATCH
                </button>
              ) : null}
              {/* THE LABEL NAMES BOTH HALVES, because it now does both.
                  This used to read `WATCH INSTEAD` and sent `lobby:spectate` alone —
                  which orphaned the seat this connection already held and hung the
                  table. It now RELEASES the seat first (`Connection#giveUpSeatAndWatch`),
                  and a button that quietly gives up a seat has to say so: an
                  unreversible "instead" is not a decision a player can make by
                  misreading a verb. */}
              {props.spectator ? null : (
                <button
                  type="button"
                  className="btn"
                  onClick={props.onSpectate}
                  data-testid="give-up-seat"
                >
                  GIVE UP MY SEAT AND WATCH
                </button>
              )}
              <button type="button" className="btn" onClick={props.onLeave} data-testid="leave-lobby">
                LEAVE
              </button>
            </div>
            {props.spectator ? (
              <p className="panel__note panel__note--quiet" data-testid="spectating-note">
                You are watching this room and holding no seat. You will see every card and the
                whole board, and nothing you do here reaches the table.
              </p>
            ) : null}
            {!props.isHost ? (
              <p className="panel__note panel__note--quiet">Only the host can start the match.</p>
            ) : !props.canStart ? (
              <p className="panel__note panel__note--quiet">At least two players are needed.</p>
            ) : null}
          </>
        )}

        <div className="col">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setShowRules((s) => !s)}
            aria-expanded={showRules}
            data-testid="toggle-rules"
          >
            RULES &amp; BOARD
          </button>
          {showRules ? <RulesPanel /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The nine constituencies with their printed fractions, inline. §5.1.
 *
 * The names and fractions are read from the board package's own geometry rather
 * than restated here. That package is presentational, imports nothing from the
 * engine, and is already the thing the board renders — so it is the single
 * source of truth for "what does the printed board say", and a second copy in
 * the lobby would be one more thing to drift.
 */
function RulesPanel() {
  return (
    <div className="panel" data-testid="rules-panel">
      <p className="panel__note">
        Nine constituencies, one hundred and twenty-nine voter areas. A majority is the printed
        fraction of that constituency&apos;s areas, held with the peg turned symbol-side up.
        Eleven areas are Volatile — the rounded squares — and a voter placed there is permanent and
        triggers a Headline at the end of the turn.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--sp-2) 0 0' }}>
        {BOARD.map((z) => (
          <li key={z.id} className="seat seat--1" style={{ marginBottom: 2 }}>
            <span className="seat__name">{z.name}</span>
            <span className="seat__meta">
              {z.majority}/{z.capacity}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────── the topbar (§5.0) ───────────────────────────

/**
 * The connection dot and the turn order.
 *
 * §5.2 specifies the dot precisely: 8px, `POSITIVE` when live, amber when
 * retrying, NEVER negative, with the attempt count in TYPE_LOG_META, and the
 * state carried by SHAPE (filled circle vs ring) as well as colour. All three
 * channels are implemented in `.link` in `app.css`.
 */
export function LinkDot({
  link,
  attempts,
}: {
  link: Link;
  attempts: number;
}) {
  const label =
    link === 'live'
      ? 'live'
      : link === 'connecting'
        ? 'connecting'
        : link === 'reconnecting'
          ? `reconnecting, attempt ${attempts}`
          : 'not connected';
  return (
    <span className={`link link--${link}`} data-testid="link-dot" title={label}>
      <span className="link__dot" aria-hidden="true" />
      <span className="link__meta">{label}</span>
    </span>
  );
}

/** The error toast. The server's words, and nothing else. */
export function ErrorToast({
  code,
  message,
  onDismiss,
}: {
  code: string;
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <div className="toast" role="alert" data-testid="error-toast">
      {message}
      <span className="toast__code">{code}</span>
    </div>
  );
}

export { seatOf };
