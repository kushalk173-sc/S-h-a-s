/**
 * The board's representative states.
 *
 * This is the deliverable's "stories" file: the states a reviewer needs to see
 * in order to believe the board works, expressed as data so they can be driven
 * from a test as well as from the dev harness. Every fixture is built from the
 * real `ZoneSpec[]` in `./geometry`, so a story can never invent a slot that
 * does not exist on the actual board.
 *
 * The five states between them exercise every cell of the §4.6 matrix:
 *
 *   empty     70 cells' worth of `w` / `w▪` — the resting board
 *   majority  `●` and `○` at rest, plus a held zone and a tied zone
 *   volatile  `◇` and `●◇` — the rounded-square rows
 *   gerry     `⟲`, `◈`, `○+✕`, `d+○` — source and both destination verdicts
 *   full      all ten rows at once, on all 129 slots
 */

import { useMemo } from 'react';
import { BoardSvg } from './BoardSvg';
import { makeZones, putPegs, PLAYERS } from './fixtures';
import type { BoardMode, BoardState, ZoneSpec } from './types';
import { BOARD } from './geometry';

export const STORY_SPECS: readonly ZoneSpec[] = BOARD;

export type StoryId = 'empty' | 'majority' | 'volatile' | 'gerry' | 'full';

export type BoardStory = {
  readonly id: StoryId;
  readonly title: string;
  /** What this state is FOR, and what to look at. */
  readonly note: string;
  readonly zones: ReturnType<typeof makeZones>;
  readonly mode: BoardMode;
  readonly activePlayerId: string;
  readonly gerrySourceAreaId?: string;
};

function pairs(ids: readonly string[], owner: string): (readonly [string, string])[] {
  return ids.map((a) => [a, owner] as const);
}

export function buildStory(id: StoryId): BoardStory {
  switch (id) {
    case 'empty':
      return {
        id,
        title: 'Empty board',
        note: '129 printed wells, 11 Volatile cogs, contours running through every zone with no zone fill. Nothing is placed, so nothing spends colour.',
        zones: makeZones(),
        mode: 'idle',
        activePlayerId: 'p1',
      };

    case 'majority': {
      // North 11/21 for Ria → 11 pegs, 11 flipped. Central 5/9 for Dev. West is
      // Ria 4 / Dev 4, which is a tie, so it shows ⊘ no rights rather than
      // nothing at all.
      const zones = putPegs(makeZones(), [
        ...pairs(
          ['north-01', 'north-03', 'north-05', 'north-07', 'north-09', 'north-11', 'north-13', 'north-15', 'north-17', 'north-19', 'north-21'],
          'p1',
        ),
        ...pairs(['central-01', 'central-02', 'central-04', 'central-06', 'central-08'], 'p2'),
        ...pairs(['west-01', 'west-03', 'west-05', 'west-07'], 'p1'),
        ...pairs(['west-02', 'west-04', 'west-06', 'west-08'], 'p2'),
        ['south-11', 'p5'],
        ['south-13', 'p3'],
        ['east-04', 'p4'],
      ]);
      return {
        id,
        title: 'North at majority · Central held · West tied',
        note: 'Three simultaneous majority channels: a 3px seat border, the filled seal disc, and the literal ● RIA. West is tied, so it states ⊘ no rights. The progress rule is full to the tick in North and short in Central.',
        zones,
        mode: 'idle',
        activePlayerId: 'p1',
      };
    }

    case 'volatile': {
      // All 11 Volatile Areas occupied, across three seats, so the
      // ink-asterisk-on-solid-fill case sits next to the
      // ink-asterisk-on-paper case.
      const zones = putPegs(makeZones(), [
        ['north_west-07', 'p1'],
        ['north-11', 'p1'],
        ['north_east-02', 'p2'],
        ['west-09', 'p3'],
        ['west-16', 'p3'],
        ['central-05', 'p1'],
        ['east-04', 'p4'],
        ['east-11', 'p4'],
        ['south_west-09', 'p5'],
        ['south-11', 'p5'],
        ['south_east-05', 'p2'],
        ['north-02', 'p1'],
        ['north-04', 'p2'],
        ['north-06', 'p3'],
        ['north-08', 'p1'],
        ['north-10', 'p2'],
        ['north-12', 'p3'],
        ['central-01', 'p1'],
        ['central-03', 'p2'],
        ['central-04', 'p3'],
        ['east-01', 'p4'],
        ['east-02', 'p5'],
        ['south-01', 'p1'],
        ['south-03', 'p2'],
        ['south_west-01', 'p5'],
        ['south_east-01', 'p2'],
      ]);
      return {
        id,
        title: 'Volatile Areas occupied',
        note: 'Rounded-square pegs with the paper-000 asterisk on the solid ones and the ink-900 asterisk on the hollow ones. The square is the channel and the cog is the printed reminder; no Volatile colour appears at rest.',
        zones,
        mode: 'idle',
        activePlayerId: 'p1',
      };
    }

    case 'gerry': {
      // North full for Ria plus a couple of Ria pegs elsewhere. The armed
      // source must satisfy all three source rules at once: it is Ria's, it is
      // non-Volatile, and it is non-majority — which, in a zone where Ria holds
      // 21 of 21, means one of the pegs `recount` did NOT flip (slots 12–21).
      // north-19 is one of those, so this story is row 3 of §4.6: the only cell
      // that can be picked up.
      const zones = putPegs(makeZones(), [
        ...pairs(
          [
            'north-01', 'north-02', 'north-03', 'north-04', 'north-05', 'north-06', 'north-07',
            'north-08', 'north-09', 'north-10', 'north-11', 'north-13', 'north-14', 'north-15',
            'north-16', 'north-17', 'north-18', 'north-19', 'north-20', 'north-21',
          ],
          'p1',
        ),
        ['north-12', 'p2'],
        ['west-02', 'p1'],
        ['west-03', 'p1'],
        ['east-02', 'p2'],
        ['east-03', 'p2'],
        ['south-02', 'p1'],
        ['central-02', 'p2'],
      ]);
      return {
        id,
        title: 'Gerrymander in progress',
        note: 'Source armed in North. POSITIVE seams on North and its five neighbours; ◈ on legal destinations including an opponent\'s peg; ✕ + hatch + dim on your own occupied slots. Majority and Volatile pegs are hatched, so the two rules that surprise people are visible without a tutorial.',
        zones,
        mode: 'gerry',
        activePlayerId: 'p1',
        gerrySourceAreaId: 'north-19',
      };
    }

    case 'full': {
      // Every slot filled. Each zone gets a clear dominant seat holding
      // `majority` or more, so all nine zones form a majority, the score is the
      // full 69, and all ten rows of the §4.6 matrix appear on one board. The
      // remaining slots are spread across the other seats, which is what puts
      // `other` pegs on both faces in both shapes.
      const zones0 = makeZones();
      const placements: (readonly [string, string])[] = [];
      const seats = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;
      zones0.forEach((z) => {
        const dominant = seats[z.id.length % seats.length] ?? 'p1';
        z.areas.forEach((a, i) => {
          if (i < z.majority) {
            placements.push([a.id, dominant]);
            return;
          }
          // Everyone else, chosen so the other seats are not all one colour.
          const others = seats.filter((s) => s !== dominant);
          placements.push([a.id, others[(i - z.majority) % others.length] ?? dominant]);
        });
      });
      return {
        id,
        title: 'Full board',
        note: 'All 129 slots filled and all nine majorities formed — the full 69. The busiest state the board has to stay readable in: 129 cogs and wells, nine borders, and no zone fill to hide behind.',
        zones: putPegs(zones0, placements),
        mode: 'idle',
        activePlayerId: 'p1',
      };
    }
  }
}

export const BOARD_STORIES: readonly StoryId[] = [
  'empty',
  'majority',
  'volatile',
  'gerry',
  'full',
];

export function storyState(story: BoardStory): BoardState {
  return {
    zones: story.zones,
    activePlayerId: story.activePlayerId,
    mode: story.mode,
    players: PLAYERS,
    ...(story.gerrySourceAreaId !== undefined ? { gerrySourceAreaId: story.gerrySourceAreaId } : {}),
  };
}

/**
 * Every story at once, for a reviewer who would rather scroll than click.
 * Widths are explicit so all five boards are directly comparable.
 */
export function BoardStories({ width = 420 }: { width?: number }) {
  const stories = useMemo(() => BOARD_STORIES.map(buildStory), []);
  return (
    <div data-testid="board-stories">
      {stories.map((story) => (
        <section key={story.id} aria-label={story.title}>
          <h3>{story.title}</h3>
          <p>{story.note}</p>
          <BoardSvg
            state={storyState(story)}
            specs={STORY_SPECS}
            width={width}
            height={width * 1.5}
          />
        </section>
      ))}
    </div>
  );
}

/** A self-check used by the tests: does a story actually show what it claims? */
export function storyStats(story: BoardStory): {
  readonly filled: number;
  readonly majority: number;
  readonly holders: number;
} {
  let filled = 0;
  let majority = 0;
  let holders = 0;
  for (const zone of story.zones) {
    for (const a of zone.areas) {
      if (a.peg === null) continue;
      filled += 1;
      if (a.peg.majority) majority += 1;
    }
    if (zone.majorityHolder !== null) holders += 1;
  }
  return { filled, majority, holders };
}

export default BoardStories;
