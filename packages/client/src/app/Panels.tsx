/**
 * The remaining panels: the log rail, the reconnect screen, the scoreboard, the
 * headline dialog, and the lobby.
 *
 * All in one file because all of them are small and all of them are read-only
 * views over `ClientState`. Splitting four two-hundred-line components across
 * four files would be tidier and would make the "every screen is a STATE of one
 * shell" point (§5) harder to see, which is the thing this file demonstrates.
 */

import { useEffect, useState, type ReactNode } from 'react';

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
/** The verb a log row's kind reads as, after the player's name. */
const LOG_VERB: Readonly<Record<string, string>> = {
  answer: 'answered',
  gerrymander: 'gerrymandered',
  power: 'used a power',
};

export function LogRail({ state }: { state: ClientState }) {
  const rows = logRows(state);
  return (
    <div className="shell__log" aria-label="Match log">
      <h2 className="shell__log-title">
        Table log <span className="shell__log-hint">newest first</span>
      </h2>
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
                {/* WHAT KIND OF ENTRY. An answer is logged as the answer's own
                    words in quotes, so without this a row read as a stray
                    quotation with nobody saying it. */}
                {LOG_VERB[r.kind] === undefined ? '' : ` ${LOG_VERB[r.kind]}`}
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

/** Where the table was when the link dropped, as a sentence rather than the engine's phase id. */
const PHASE_WHERE: Readonly<Record<string, string>> = {
  answer: 'An Ideology Card was being answered.',
  actions: 'A turn was in progress.',
  headlines: 'Headlines were being read.',
  finished: 'The game had finished.',
};

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
        <p className="reconnect__status">{PHASE_WHERE[phase] ?? 'The game was in progress.'}</p>

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
            scores below are the result as it stood.
          </p>
        ) : winners === null ? (
          <p className="sheet__body">
            The game is over. This screen missed the announcement of the winner, so it shows the
            final scores without naming one — reload to fetch the result.
          </p>
        ) : null}

        {boardWasFull ? (
          <p className="sheet__body">
            The board filled before every majority formed, so everyone took one more turn, starting
            with whoever filled the last slot.
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
              <span
                className={`seat seat--${r.seat}`}
                data-winner={winners?.includes(r.player) === true ? 'true' : undefined}
              >
                {winners?.includes(r.player) === true ? (
                  <span className="score__crown" aria-label="winner">
                    ★{' '}
                  </span>
                ) : null}
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
  // Which constituency the front of the queue came from, so "a Headline breaks" is
  // anchored to something the player can see on the board.
  const frontArea = state.headlineQueue[0]?.areaId;
  const triggerZone =
    frontArea === undefined
      ? null
      : (state.zones.find((z) => z.areas.some((ar) => ar.id === frontArea))?.name ?? null);

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

        {/* The queue as a strip only when there IS a queue: a single headline drew a
            lone red box reading "1" that meant nothing. */}
        {remaining > 1 ? (
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
        ) : null}

        <p className="sheet__body">
          A voter landed in a Volatile Area
          {triggerZone === null ? '' : ` in ${triggerZone}`}, so a Headline resolves at the end of
          the turn. Its effects are applied when you resolve it, and it may ask you for a decision.
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
  /** Sign-in control. Omitted by tests that render the lobby without an account. */
  readonly account?: ReactNode;
  /**
   * The room named by this page's `?room=` invite link, when it is in the open-rooms
   * list — rendered as a one-click JOIN above everything else.
   */
  readonly invited?: LobbySummary | null;
};

export function LobbyScreen(props: LobbyScreenProps) {
  const { lobby } = props;
  const [seatCount, setSeatCount] = useState<SeatCount>(2);
  const [showRules, setShowRules] = useState(false);
  const nameMissing = props.name.trim() === '';
  const invited = props.invited ?? null;

  // §5.1: "player list 2–5 with seat colour, name, ready state; a JOIN button per
  // row; and the seat you will take, or the next free seat", all without
  // scrolling. The staggered start is stated per seat, because without that line
  // players read the asymmetry as a bug — and `RULES.staggeredStart` really does
  // give seat n exactly n resources.
  return (
    <div className="lobby" data-testid="lobby-screen">
      <div className="lobby__sheet">
        <header className="lobby__head">
          {props.account}
          <h1 className="lobby__h1">SHASN</h1>
          {/* THE PITCH, AND IT IS THE FIRST THING THE PRODUCT SAYS.
           *
           * It used to read "...and you cannot see the card you are about to answer",
           * which the full-information ruling made false. `staleWording.test.tsx`
           * pins the exact sentence, and it says "SEATS", not "VOTERS", because 129
           * is the AREA count. */}
          <p className="lobby__sub">
            Four Ideologues. Nine constituencies. One hundred and twenty-nine seats, and both
            answers — with what each one pays — printed before you choose.
          </p>
        </header>

        {lobby === null ? (
          <>
            <div className="col">
              <label className="field__label" htmlFor="player-name">
                Your name
              </label>
              <input
                id="player-name"
                className="field field--name"
                value={props.name}
                maxLength={24}
                placeholder="What should the table call you?"
                autoComplete="nickname"
                onChange={(e) => props.onNameChange(e.target.value)}
                // ENTER DOES THE OBVIOUS THING: join the room you were invited to,
                // or create one — so the lobby can be done from the keyboard.
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || nameMissing) return;
                  if (invited !== null && !invited.inProgress && invited.seated < invited.maxPlayers) {
                    props.onJoin(invited.lobbyId);
                  } else if (invited === null) {
                    props.onCreate(seatCount);
                  }
                }}
                data-testid="name-input"
              />
            </div>

            {invited !== null ? (
              <section className="lobby__invite lobby__invite--hero" data-testid="invite-banner">
                <div>
                  <p className="lobby__invite-title">
                    You were invited to {invited.name}&apos;s room
                  </p>
                  <p className="panel__note panel__note--quiet">
                    {invited.seated} of {invited.maxPlayers} seats taken
                    {invited.inProgress ? ' · already playing' : ''}
                  </p>
                </div>
                {invited.inProgress || invited.seated >= invited.maxPlayers ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => props.onWatchRoom(invited.lobbyId)}
                  >
                    WATCH THIS GAME
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => props.onJoin(invited.lobbyId)}
                    disabled={nameMissing}
                    aria-disabled={nameMissing}
                    title={nameMissing ? 'Type a name before joining a room.' : undefined}
                  >
                    {nameMissing ? 'TYPE A NAME TO JOIN' : 'JOIN THIS ROOM'}
                  </button>
                )}
              </section>
            ) : null}

            <div className="lobby__grid">
              <section className="lobby__card" aria-labelledby="create-h">
                <h2 className="lobby__card-title" id="create-h">
                  Start a new room
                </h2>
                <span className="field__label" id="seat-count-label">
                  How many players?
                </span>
                <div className="seg" role="group" aria-labelledby="seat-count-label">
                  {([2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="seg__btn"
                      onClick={() => setSeatCount(n)}
                      aria-pressed={seatCount === n}
                      data-testid={`seat-count-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--wide"
                  onClick={() => props.onCreate(seatCount)}
                  disabled={nameMissing}
                  aria-disabled={nameMissing}
                  title={nameMissing ? 'Type a name first.' : undefined}
                  data-testid="create-room"
                >
                  CREATE ROOM
                </button>
                <p className="panel__note panel__note--quiet">
                  {nameMissing
                    ? 'Type your name above first.'
                    : 'You will get an invite link to send to the other players.'}
                </p>
              </section>

              <section className="lobby__card" aria-labelledby="rooms-h">
                <div className="lobby__card-head">
                  <h2 className="lobby__card-title" id="rooms-h">
                    Join an open room
                  </h2>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={props.onList}
                    data-testid="refresh-rooms"
                    title="The list keeps itself up to date; REFRESH asks again now."
                  >
                    ↻ REFRESH
                  </button>
                </div>
                {props.lobbies.length === 0 ? (
                  <p className="lobby__empty">No rooms are open. Create one, or wait for someone to.</p>
                ) : (
                  <ul className="rooms">
                    {props.lobbies.map((l) => {
                      const refusal = joinRefusalReason(props.name, l);
                      const closed = l.inProgress || l.seated >= l.maxPlayers;
                      return (
                        <li
                          key={l.lobbyId}
                          className="room"
                          data-testid="room-row"
                          data-lobby-id={l.lobbyId}
                          data-invited={invited?.lobbyId === l.lobbyId ? 'true' : undefined}
                        >
                          <span className="room__who">
                            <span className="room__name">{l.name}&apos;s room</span>
                            <span className="seat__meta room__meta">
                              {/* THE ROOM'S OWN KEY, on the row, because a room is not a
                                  NAME: two hosts who both typed "Player" rendered as two
                                  identical rows. It is the disambiguator, so it is shown
                                  small and last rather than hidden. */}
                              {l.seated}/{l.maxPlayers} seated
                              {l.inProgress ? ' · in progress' : ''}
                              {l.inProgress || l.seated < l.maxPlayers ? '' : ' · full'}
                              {' · '}
                              <span className="room__key" data-testid="room-key">
                                {roomKey(l.lobbyId)}
                              </span>
                            </span>
                          </span>
                          <button
                            type="button"
                            className={closed ? 'btn btn--sm' : 'btn btn--sm btn--primary'}
                            onClick={() => props.onJoin(l.lobbyId)}
                            disabled={refusal !== undefined}
                            aria-disabled={refusal !== undefined}
                            /* THE CONTROL NAMES ITS OWN ROW (WCAG 2.1 SC 2.4.6). */
                            aria-label={`Join ${l.name}'s room ${roomKey(l.lobbyId)}`}
                            title={refusal}
                            data-testid="join-room"
                            data-lobby-id={l.lobbyId}
                          >
                            JOIN
                          </button>
                          {/* WATCH is never disabled: watching takes no seat, and it is
                              specifically the full room that needs it. */}
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
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="panel__note panel__note--quiet">
                  The list keeps itself up to date. WATCH takes no seat: you see the whole board
                  and cannot act.
                </p>
              </section>
            </div>
          </>
        ) : (
          <InRoom {...props} lobby={lobby} />
        )}

        <div className="col">
          <button
            type="button"
            className="btn btn--sm btn--ghost lobby__rules-toggle"
            onClick={() => setShowRules((s) => !s)}
            aria-expanded={showRules}
            data-testid="toggle-rules"
          >
            {showRules ? '▾' : '▸'} HOW TO PLAY · RULES &amp; BOARD
          </button>
          {showRules ? <RulesPanel /> : null}
        </div>
      </div>
    </div>
  );
}

/** The room you are sitting in: seats, the invite link, and the start controls. */
function InRoom(props: LobbyScreenProps & { readonly lobby: Lobby }) {
  const { lobby } = props;
  const mine = lobby.seats.find((s) => s.you);
  const openSeats = lobby.maxPlayers - lobby.seats.length;
  const host = lobby.seats.find((s) => s.playerId === lobby.hostId);
  const [copied, setCopied] = useState(false);
  const link = inviteLink(lobby.lobbyId);

  const copy = () => {
    try {
      void navigator.clipboard.writeText(link).then(
        () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        },
        () => undefined,
      );
    } catch {
      /* No clipboard API (an insecure origin); the link is selectable text. */
    }
  };

  // The status line answers the one question everybody in a room has: what are we
  // waiting for?
  const status = props.spectator
    ? 'You are watching this room and holding no seat.'
    : lobby.seats.length < 2
      ? 'Waiting for players — send them the invite link. Two are needed to start.'
      : props.isHost
        ? openSeats > 0
          ? `You can start now, or wait for ${openSeats} more player${openSeats === 1 ? '' : 's'}.`
          : 'Everyone is here. Start when you are ready.'
        : `Waiting for ${host?.name ?? 'the host'} to start the match.`;

  return (
    <>
      <section className="lobby__card" aria-labelledby="room-h">
        <div className="lobby__card-head">
          <h2 className="lobby__card-title" id="room-h">
            {lobby.name}&apos;s room
          </h2>
          <span className="chip">
            {lobby.seats.length}/{lobby.maxPlayers} seated
          </span>
        </div>

        <ol className="seats" aria-label={`SEATS · ${lobby.name}`}>
          {Array.from({ length: lobby.maxPlayers }, (_, i) => {
            const seatNumber = (i + 1) as 1 | 2 | 3 | 4 | 5;
            const taken = lobby.seats[i];
            return (
              <li
                key={seatNumber}
                className={`seat seat--${seatNumber}${taken?.you === true ? ' seat--active' : ''}${taken === undefined ? ' seat--empty' : ''}`}
              >
                <span className="seat__name">
                  {seatNumber}. {taken === undefined ? 'empty' : taken.name}
                  {taken?.you === true ? ' (you)' : ''}
                </span>
                {taken !== undefined && taken.playerId === lobby.hostId ? (
                  <span className="badge">host</span>
                ) : null}
                {taken?.ready === true ? <span className="badge badge--ok">ready</span> : null}
                {taken?.connected === false ? <span className="badge badge--warn">away</span> : null}
                <span className="seat__meta">
                  {/* The staggered start, stated. `RULES.staggeredStart` gives seat n
                      exactly n resources; without the line this reads as a bug. */}
                  {seatNumber} resource{seatNumber === 1 ? '' : 's'} to spend
                </span>
              </li>
            );
          })}
        </ol>
        <p className="panel__note panel__note--quiet">
          Later seats start with more resources, to make up for playing later in the round.
        </p>
      </section>

      {props.spectator ? null : (
        <section className="lobby__invite" aria-label="Invite link">
          <div className="lobby__invite-body">
            <span className="field__label">Invite link — send this to the other players</span>
            <input
              className="field field--link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              data-testid="invite-link"
              aria-label="Invite link for this room"
            />
          </div>
          <button type="button" className="btn" onClick={copy} data-testid="copy-invite">
            {copied ? 'COPIED ✓' : 'COPY LINK'}
          </button>
        </section>
      )}

      <p className="lobby__status" role="status" data-testid="lobby-status">
        {status}
      </p>

      <div className="row lobby__actions">
        {props.isHost ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={props.onStart}
            disabled={!props.canStart}
            aria-disabled={!props.canStart}
            title={props.canStart ? undefined : 'At least two players are needed.'}
            data-testid="start-match"
          >
            START MATCH
          </button>
        ) : null}
        {/* No seat means no READY: `lobby:ready` throws `NOT_IN_LOBBY` for anybody
            who is not a member (§5.11 — the absence is the spectator signal). */}
        {props.spectator ? null : (
          <button
            type="button"
            className="btn"
            onClick={() => props.onReady(mine?.ready !== true)}
            aria-pressed={mine?.ready === true}
            data-testid="ready-toggle"
          >
            {mine?.ready === true ? 'READY ✓' : 'READY'}
          </button>
        )}
        <span className="shell__spacer" />
        {/* THE LABEL NAMES BOTH HALVES, because it does both: it releases the seat
            first (`Connection#giveUpSeatAndWatch`), and a button that quietly gives
            up a seat has to say so. */}
        {props.spectator ? null : (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={props.onSpectate}
            data-testid="give-up-seat"
          >
            GIVE UP MY SEAT AND WATCH
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={props.onLeave}
          data-testid="leave-lobby"
        >
          LEAVE
        </button>
      </div>
      {props.spectator ? (
        <p className="panel__note panel__note--quiet" data-testid="spectating-note">
          You will see every card and the whole board, and nothing you do here reaches the table.
        </p>
      ) : null}
    </>
  );
}

/** The URL that drops a friend straight onto this room's JOIN. */
export function inviteLink(lobbyId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', lobbyId);
  return url.toString();
}

/**
 * How to play, then the nine constituencies with their printed fractions. §5.1.
 *
 * The names and fractions are read from the board package's own geometry rather
 * than restated here: it is already the thing the board renders, so it is the
 * single source of truth for "what does the printed board say".
 */
export function RulesPanel() {
  return (
    <div className="panel rules" data-testid="rules-panel">
      <h3 className="rules__h">A turn</h3>
      <ol className="rules__steps">
        <li>
          <strong>Answer your Ideology Card.</strong> Pick one of two answers. Each answer belongs
          to an Ideologue and pays resources — Funds, Clout, Media or Trust.
        </li>
        <li>
          <strong>Buy Voter Cards from the HQ Mat.</strong> Spend resources on one of the three
          face-up cards. Each card gives you a group of voters to place.
        </li>
        <li>
          <strong>Place those voters</strong> in empty areas on the board.
        </li>
        <li>
          <strong>Use powers, trade or gerrymander</strong> if you can, then press{' '}
          <strong>END TURN</strong>.
        </li>
      </ol>
      <h3 className="rules__h">Winning</h3>
      <p className="panel__note">
        Hold a majority in a constituency and your voters there score. The game ends when every
        majority has formed, and the most majority voters wins. Each answer also adds a card to
        your Manifesto; enough cards for one Ideologue unlock its powers.
      </p>
      <h3 className="rules__h">The board</h3>
      <p className="panel__note">
        Nine constituencies, one hundred and twenty-nine voter areas. A majority is the printed
        fraction of that constituency&apos;s areas, held with the peg turned symbol-side up.
        Eleven areas are Volatile — the rounded squares — and a voter placed there is permanent and
        triggers a Headline at the end of the turn.
      </p>
      <ul className="rules__zones">
        {BOARD.map((z) => (
          <li key={z.id} className="seat seat--1">
            <span className="seat__name">{z.name}</span>
            <span className="seat__meta">
              {z.majority}/{z.capacity} for a majority
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
      <span className="toast__msg">{message}</span>
      {code !== '' ? <span className="toast__code">{code}</span> : null}
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export { seatOf };
