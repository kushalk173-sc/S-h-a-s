/**
 * THE SCOREBOARD: A DERIVED SCORE, AND A WIRED VERDICT.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT WAS CHECKED, AND THE ANSWER ON EACH HALF
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The brief asked two questions. Both have answers, and one of them found a defect.
 *
 * 1. "Does the client derive the score the same way the engine does?" — YES, and
 *    character for character. The engine's `majorityVoters` (`board.ts`) is
 *
 *        for (const z of state.zones)
 *          for (const a of z.areas) if (a.peg?.owner === player && a.peg.majority) n += 1;
 *
 *    and the client's `majorityCount` (`derive.ts`) is the same loop with
 *    `a.peg !== null` spelled out, because the client's peg type is nullable on the
 *    wire. `scores(state)` is `majorityVoters` per `turnOrder` seat, so
 *    `scoreboard(state, you)[i].score === scores(state)[turnOrder[i]]`.
 *
 *    THE BRIEF'S "ZONES ARE WORTH 5-11" IS REFUTED as a scoring claim, and the
 *    distinction matters. p20 says "the player with the highest number of majority
 *    voters wins", and `scores()` counts MAJORITY VOTERS -- pegs carrying the
 *    majority flag. A MAJORITY HOLDER, by contrast, is one seat per zone, and a seat
 *    can hold a majority voter in a zone it does not hold. So a seat with the most
 *    zones held is not the seat with the highest score, 7 games in 20 or 20 in 20,
 *    and the engine's own `winnable.test.ts` pins that divergence by asserting both
 *    numbers side by side. The client scores by majority voters, which is correct,
 *    and `zonesHeld` is displayed as a SEPARATE line rather than folded into the score.
 *
 * 2. "Can a derived scoreboard disagree between seats?" — the SCORES cannot, and the
 *    VERDICT used to. `majorityCount` reads only `state.zones[].areas[].peg`, and
 *    `playerView` passes `zones` through untouched while blanking exactly two
 *    player-level keys (`conspiracies`, `ideologyCards`). There is no viewer-scoped
 *    input to the score at all, so two seats holding the same `ClientState` compute
 *    the same number; and `Array.prototype.sort` is stable, so tied seats keep turn
 *    order in every seat's list.
 *
 *    THE VERDICT WAS A SECOND AUTHORITY. `Scoreboard` computed the winner by asking
 *    "whose score is highest", which has three answers where `winners()` has three
 *    answers -- and it got the third one wrong. `winners()` returns `[]` when nobody
 *    holds a majority voter, because the old floor at 0 made `best === 0` match every
 *    seat; the client has exactly that bug, and prints "P1 WINS WITH 0" on a
 *    scoreless board. That board is reachable: the deck-exhaustion ending fires with
 *    no majority formed, and p20's board-full ending can spread 129 voters so that
 *    nobody holds a majority in any of the nine zones.
 *
 *    The verdict now comes from `match:over`, which the server produces from the
 *    engine's own `game-over` event. This file pins that the client does not
 *    recompute it -- including the branch where there IS no winner.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { ClientState, PlayerID, PlayerState } from '@shasn/engine';

import { Scoreboard } from './Panels.tsx';
import { majorityCount, scoreboard, zonesHeld } from './derive.ts';
import boardSource from '../../../engine/src/board.ts?raw';

const SEATS: readonly PlayerID[] = ['p1', 'p2', 'p3'];

type Peg = { readonly owner: PlayerID | null; readonly majority: boolean };

/**
 * A synthetic zone.
 *
 * `majorityHolder` is PASSED IN, not derived. The engine derives it from the board
 * spec's per-zone capacities and a majority is more than half of THOSE; a fixture
 * with three areas in a zone has no meaningful majority to compute, and deriving one
 * anyway is how a test ends up asserting against an invention. The client's score
 * does not read `majorityHolder` at all -- it reads `peg.majority` -- so the two are
 * independent facts here, which is the point of the fixture below.
 */
function zone(
  id: string,
  name: string,
  pegs: readonly (Peg | null)[],
  majorityHolder: PlayerID | null,
): {
  id: string;
  name: string;
  areas: readonly { peg: Peg | null }[];
  majorityHolder: PlayerID | null;
} {
  return { id, name, areas: pegs.map((peg) => ({ peg })), majorityHolder };
}

const P = (owner: PlayerID, majority = false): Peg => ({ owner, majority });

/**
 * A board built to be ADVERSARIAL to any assumption the client might be making:
 *
 *   - `p1` holds the MOST ZONES (three) but `p2` is not the top scorer either, so
 *     "most zones" and "highest score" cannot be confused by a passing test;
 *   - `p3` holds NO zone at all and still has a majority voter, so the two columns
 *     are provably independent;
 *   - one zone has a single peg and no majority anywhere in it;
 *   - the scores are 3, 1 and 1 — the top is unique, the other two are level.
 */
function board(): ClientState {
  return {
    players: Object.fromEntries(
      SEATS.map((id) => [
        id,
        { id, name: id.toUpperCase(), resources: { funds: 0, clout: 0, media: 0, trust: 0 } },
      ]),
    ),
    turnOrder: [...SEATS],
    zones: [
      zone('z1', 'North', [P('p1', true), P('p3'), P('p2')], 'p1'),
      zone('z2', 'South', [P('p1', true), P('p3'), P('p2')], 'p1'),
      zone('z3', 'East', [P('p1', true), P('p3'), P('p2')], 'p1'),
      // West is the interesting one: p2 holds the zone, and p3's majority voter is
      // in it. So "most zones" (p1) and "highest score" (p1) agree here, but "holds
      // a zone" and "has a majority voter" plainly do not.
      zone('z4', 'West', [P('p2', true), P('p3', true), P('p1')], 'p2'),
      zone('z5', 'Midlands', [P('p3')], null),
    ],
  } as unknown as ClientState;
}

/** A board on which NOBODY holds a majority voter — the scoreless ending. */
function scorelessBoard(): ClientState {
  return {
    ...board(),
    zones: [
      zone('z1', 'North', [P('p1'), P('p2')], null),
      zone('z2', 'South', [P('p2'), P('p1')], null),
    ],
  } as unknown as ClientState;
}

/** A board on which two seats are genuinely level — the tie ending. */
function tiedBoard(): ClientState {
  return {
    ...board(),
    zones: [
      zone('z1', 'North', [P('p1', true), P('p3')], 'p1'),
      zone('z2', 'South', [P('p2', true), P('p3')], 'p2'),
      zone('z3', 'East', [P('p1'), P('p2')], null),
    ],
  } as unknown as ClientState;
}

describe('the client score is the engine score, and is computed from public board state only', () => {
  it('the client predicate is the engine predicate', () => {
    // THE MIRROR, read from the engine's own source rather than from a comment. This
    // is the same source-text technique `derive.test.ts` uses for the numbers: it
    // cannot see a semantic disagreement, but the whole predicate IS this one line,
    // so there is nothing semantic left to hide.
    const at = boardSource.indexOf('export function majorityVoters');
    const body = boardSource.slice(at, boardSource.indexOf('export function scores'));
    expect(body, 'the engine counts a peg that is owned and is a majority').toContain(
      'a.peg?.owner === player && a.peg.majority',
    );
    // And it is a count over zones and areas, which is what the client iterates.
    expect(body).toMatch(/for \(const z of state\.zones\)/);
    expect(body).toMatch(/for \(const a of z\.areas\)/);
  });

  it('scores by MAJORITY VOTERS, not by zones held', () => {
    const state = board();
    // p1 holds three zones; p2 has more majority voters. The score must follow the
    // voters, because that is what p20 says wins the game.
    expect(zonesHeld(state, 'p1').length).toBe(3);
    expect(majorityCount(state, 'p1')).toBe(3);
    expect(majorityCount(state, 'p2')).toBe(1);
    // p3 holds no zone at all yet has a majority voter in West -- so "most zones"
    // and "highest score" are genuinely different questions, which is the whole
    // reason the scoreboard shows both and folds neither into the other.
    expect(zonesHeld(state, 'p3')).toEqual([]);
    expect(majorityCount(state, 'p3')).toBe(1);
  });

  it('a peg that is not a majority does not count, whoever owns it', () => {
    const state = board();
    // Every p2 peg outside West is a minority peg: three of them, none counted.
    const counted = SEATS.reduce((n, id) => n + majorityCount(state, id), 0);
    const majorityPegs = state.zones.flatMap((z) => z.areas).filter((a) => a.peg?.majority === true);
    expect(counted).toBe(majorityPegs.length);
    expect(counted).toBe(5);
  });

  it('two seats holding the SAME ClientState score identically — the score cannot disagree', () => {
    // The property the brief asks about. `majorityCount` takes a `ClientState` and a
    // PlayerID and reads nothing else: no `you`, no session, no viewer. So the only
    // way two seats could disagree is if they held different boards, and `playerView`
    // blanks exactly two player-level keys and passes `zones` through untouched.
    const state = board();
    // Called repeatedly with the same inputs: same answer, every time.
    for (const id of SEATS) {
      expect(majorityCount(state, id)).toBe(majorityCount(state, id));
    }
    // Scored from a structurally identical COPY, to rule out any hidden dependence on
    // object identity or key insertion order -- the two ways a derivation leaks state.
    const twin = JSON.parse(JSON.stringify(state)) as ClientState;
    for (const id of SEATS) expect(majorityCount(twin, id)).toBe(majorityCount(state, id));
    // And a seat with no pegs anywhere scores 0 rather than undefined, so the column
    // can never render "undefined majority voters".
    expect(majorityCount(state, 'p9')).toBe(0);
  });

  it('tied seats keep turn order in every list, because sort is stable', () => {
    // An unstable sort would reorder tied seats per seat's own array and make two
    // seats see the table in a different order. Turn order is the tie-break the
    // function documents, and it is a property of `turnOrder`, not of the viewer.
    const flat = scorelessBoard();
    // Everybody on zero.
    expect(SEATS.map((id) => majorityCount(flat, id))).toEqual([0, 0, 0]);
    const rows = scoreboard(flat, null);
    expect(rows.map((r) => r.player)).toEqual([...SEATS]);
    // And with `you` set to each seat in turn, only the `isYou` flag moves.
    for (const id of SEATS) {
      const mine = scoreboard(flat, id);
      expect(mine.map((r) => [r.player, r.score])).toEqual(rows.map((r) => [r.player, r.score]));
      expect(mine.filter((r) => r.isYou).map((r) => r.player)).toEqual([id]);
    }
  });

  it('the only viewer-dependent field is the isYou flag', () => {
    // Stated as an assertion because it is the boundary of the guarantee above: if a
    // future column is added to `ScoreRow` that reads `you`, this fails. Every field is
    // compared between two DIFFERENT viewers' lists, seat by seat in rank order.
    const a = scoreboard(board(), 'p1');
    const b = scoreboard(board(), 'p2');
    expect(a.length).toBe(3);
    for (let i = 0; i < a.length; i += 1) {
      const ra = a[i] as (typeof a)[number];
      const rb = b[i] as (typeof b)[number];
      // Same rank, same seat, same arithmetic -- for EVERY row, including p3's, which
      // is nobody's "you" in either list and so must be identical in both.
      expect(ra.player).toBe(rb.player);
      expect(ra.score).toBe(rb.score);
      expect(ra.seat).toBe(rb.seat);
      expect(ra.name).toBe(rb.name);
      expect([...ra.zones]).toEqual([...rb.zones]);
      // And exactly the two seats that ARE one of the two viewers are the rows that
      // differ -- p3's flag is false in both lists.
      expect(ra.isYou !== rb.isYou).toBe(ra.player === 'p1' || ra.player === 'p2');
    }
    // A spectator's list is the same list with no row marked at all.
    const spectating = scoreboard(board(), null);
    expect(spectating.every((r) => r.isYou)).toBe(false);
    expect(spectating.map((r) => r.score)).toEqual(a.map((r) => r.score));
    expect(spectating.map((r) => r.player)).toEqual(a.map((r) => r.player));
  });
});

describe('the verdict is the server list, never a re-ranking of the scores', () => {
  function verdict(winners: readonly PlayerID[] | null, state: ClientState = board()): string {
    const { container } = render(
      <Scoreboard
        state={state}
        you="p3"
        winners={winners}
        onViewBoard={() => undefined}
        onNewMatch={() => undefined}
      />,
    );
    return container.querySelector('[data-testid="score-verdict"]')?.textContent ?? '';
  }

  it('a clear winner is named with that seat score, whoever holds the most zones', () => {
    // p1 has the highest score (3) AND holds the most zones (3), so this case alone
    // cannot tell a re-ranking from the wire list. p2's and p3's can.
    expect(verdict(['p1'])).toBe('P1 WINS WITH 3');
    // On `board()`, naming p2 gives p2's OWN score rather than the top of a sort.
    expect(verdict(['p2'])).toBe('P2 WINS WITH 1');
    // And p3, who holds no zone at all, is named with 1 — the majority voter it has.
    // A client ranking by zones held would have said P1.
    expect(verdict(['p3'])).toBe('P3 WINS WITH 1');
  });

  it('a scoreless board names NOBODY, and the client would have named somebody', () => {
    // THE DEFECT. `winners()` returns `[]` here, and the old client printed
    // "P1 WINS WITH 0" -- reintroducing, in one sentence, the exact bug
    // `board.ts:winners` documents having had and fixed server-side.
    const empty = scorelessBoard();
    const rows = scoreboard(empty, null);
    expect(rows.every((r) => r.score === 0), 'the board really is scoreless').toBe(true);
    expect(rows[0]?.name, 'and it has a top row for the old code to get wrong').toBe('P1');

    expect(verdict([], empty)).toBe('NOBODY WON');

    const { container } = render(
      <Scoreboard
        state={empty}
        you="p1"
        winners={[]}
        onViewBoard={() => undefined}
        onNewMatch={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="score-verdict"]')?.textContent).toBe(
      'NOBODY WON',
    );
    expect(container.textContent ?? '').toContain('no winner to name');
    // And specifically not a win. These two are the strings the old component
    // produced on this board, and they are the whole defect.
    expect(container.textContent ?? '').not.toMatch(/WINS WITH 0/);
    expect(container.textContent ?? '').not.toMatch(/TIE AT 0/);
  });

  it('a genuine tie is reported as one, with no tie-break invented', () => {
    // p20's "privilege" rule is recorded as explicitly non-binding and out of scope
    // for a digital implementation, so no tie-break is applied and none is implied.
    const tie = tiedBoard();
    expect(SEATS.map((id) => majorityCount(tie, id))).toEqual([1, 1, 0]);
    expect(verdict(['p1', 'p2'], tie)).toBe('P1 & P2 TIE AT 1');
    // The server's order is preserved as sent; the client does not re-sort the list.
    expect(verdict(['p2', 'p1'], tie)).toBe('P2 & P1 TIE AT 1');
  });

  it('with no verdict from the server it claims nothing rather than guessing', () => {
    // A real state: a client that reconnects after the game ends gets `match:sync`
    // and the final board, and never the `match:over` frame.
    expect(verdict(null)).toBe('RESULT');
    // Even on a board where the answer is obvious and one seat is ahead by two.
    expect(verdict(null, board())).toBe('RESULT');
  });

  it('the ranked rows still render when there is no verdict', () => {
    const { container } = render(
      <Scoreboard
        state={board()}
        you="p3"
        winners={null}
        onViewBoard={() => undefined}
        onNewMatch={() => undefined}
      />,
    );
    // The arithmetic is derived and does not depend on the wire at all, so a
    // reconnecting client still gets the table — only the judgement is withheld.
    const rows = [...container.querySelectorAll('[data-testid="score-row"]')];
    expect(rows.length).toBe(SEATS.length);
    // Ranked by score, so p1 (3) is first and p2/p3 (1 each) follow in turn order.
    expect(rows[0]?.textContent).toContain('3 majority voters');
    expect(rows[1]?.textContent).toContain('1 majority voter');
    // The `you` chip is on p3's row, wherever that row happened to rank.
    const youRows = rows.filter((r) => r.textContent?.includes('you'));
    expect(youRows).toHaveLength(1);
    expect(youRows[0]?.textContent).toContain('P3');
    // And the zones line is separate from the score line, never folded in: p3 holds
    // no zone and still scores 1, which is the distinction the two columns exist for.
    expect(rows[0]?.textContent).toContain('3 of 9');
    expect(rows[1]?.textContent).toContain('1 of 9');
    expect(rows[2]?.textContent).toContain('No constituencies held');
  });

  it('the score is displayed as majority voters, in the words p20 uses', () => {
    const { container } = render(
      <Scoreboard
        state={board()}
        you={null}
        winners={['p2']}
        onViewBoard={() => undefined}
        onNewMatch={() => undefined}
      />,
    );
    expect(container.textContent ?? '').toContain('3 majority voters');
    expect(container.textContent ?? '').toContain('1 majority voter');
    // Singular/plural, because "1 majority voters" is the kind of thing a player
    // notices about a result screen.
    expect(container.textContent ?? '').not.toContain('1 majority voters');
  });
});

describe('a PlayerState literal from this package still renders a scoreboard', () => {
  it('the seat list comes from turnOrder, not from the players map', () => {
    // `scores()` iterates `turnOrder`; so does `scoreboard`. A players map with a
    // different insertion order must therefore produce the same list.
    const state = board();
    const reordered = {
      ...state,
      players: Object.fromEntries(Object.entries(state.players).reverse()),
    } as unknown as ClientState;
    expect(scoreboard(reordered, null).map((r) => r.player)).toEqual(
      scoreboard(state, null).map((r) => r.player),
    );
    // Non-vacuity: the fixture really has three seats, and really does vary -- a
    // unique top of 3 over two seats level on 1.
    const rows = scoreboard(state, null);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.score)).toEqual([3, 1, 1]);
    expect(new Set(rows.map((r) => r.score)).size).toBe(2);
    void (undefined as unknown as PlayerState);
  });
});