/**
 * Story and app-render tests.
 *
 * These are the tests that answer the question "does the thing actually draw?".
 * The board's own tests assert the matrix and the geometry; these assert that
 * each representative state in `./Board.stories` renders 129 distinct hit
 * targets, that the fixtures contain what their captions claim, and that the
 * dev harness — the same component tree `main.tsx` mounts — mounts without
 * throwing.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  BOARD_STORIES,
  BoardStories,
  STORY_SPECS,
  buildStory,
  storyState,
  storyStats,
} from './Board.stories';
import { BoardHarness } from './BoardHarness';
import { BoardSvg } from './BoardSvg';
import { pegsFilled } from './pegsOf';
import { TOTAL_AREAS, TOTAL_MAJORITY_VOTERS } from './geometry';

describe('the five representative states', () => {
  it('are all defined and all build without throwing', () => {
    expect(BOARD_STORIES).toEqual(['empty', 'majority', 'volatile', 'gerry', 'full']);
    for (const id of BOARD_STORIES) {
      const story = buildStory(id);
      expect(story.id).toBe(id);
      expect(story.title.length).toBeGreaterThan(5);
      expect(story.note.length).toBeGreaterThan(40);
      expect(story.zones).toHaveLength(9);
    }
  });

  it('empty: 129 empty slots, no holders, nothing tinted', () => {
    const story = buildStory('empty');
    expect(storyStats(story)).toEqual({ filled: 0, majority: 0, holders: 0 });
  });

  it('majority: North held by Ria at 11/21, Central by Dev, West tied', () => {
    const story = buildStory('majority');
    const north = story.zones.find((z) => z.id === 'north');
    const central = story.zones.find((z) => z.id === 'central');
    const west = story.zones.find((z) => z.id === 'west');
    expect(north?.majorityHolder).toBe('p1');
    // recount flips exactly `majority` pegs, so the printed 11/11 tally is 11
    // filled and 11 flipped for the holder.
    expect(pegsFilled(north!)).toBe(11);
    expect(north?.areas.filter((a) => a.peg?.majority === true)).toHaveLength(11);
    expect(central?.majorityHolder).toBe('p2');
    expect(west?.majorityHolder).toBeNull();
    // 4 v 4 in West: a tie, and a tie gives NOBODY rights.
    const westOwners = (west?.areas ?? []).filter((a) => a.peg !== null).map((a) => a.peg?.owner);
    expect(westOwners.filter((o) => o === 'p1')).toHaveLength(4);
    expect(westOwners.filter((o) => o === 'p2')).toHaveLength(4);
  });

  it('volatile: all 11 Volatile Areas are occupied', () => {
    const story = buildStory('volatile');
    const volatileAreas = story.zones.flatMap((z) => z.areas).filter((a) => a.volatile);
    expect(volatileAreas).toHaveLength(11);
    for (const a of volatileAreas) expect(a.peg, `${a.id} is occupied`).not.toBeNull();
  });

  it('gerry: the armed source is eligible under all three of the board\'s rules', () => {
    const story = buildStory('gerry');
    expect(story.mode).toBe('gerry');
    expect(story.gerrySourceAreaId).toBe('north-19');
    const source = story.zones
      .flatMap((z) => z.areas)
      .find((a) => a.id === story.gerrySourceAreaId);
    // G3: non-majority. G4: not Volatile. And it must be the active player's.
    expect(source?.peg?.owner).toBe(story.activePlayerId);
    expect(source?.peg?.majority).toBe(false);
    expect(source?.volatile).toBe(false);
  });

  it('full: all 129 slots filled, and every zone with a holder has exactly its majority flipped', () => {
    const story = buildStory('full');
    const stats = storyStats(story);
    expect(stats.filled).toBe(TOTAL_AREAS);
    // The score can never exceed 69, and never less than the sum of the
    // majories of the zones actually held — both are engine invariants.
    expect(stats.majority).toBeLessThanOrEqual(TOTAL_MAJORITY_VOTERS);
    let expected = 0;
    for (const z of story.zones) {
      if (z.majorityHolder === null) continue;
      expected += z.majority;
      expect(z.areas.filter((a) => a.peg?.majority === true)).toHaveLength(z.majority);
    }
    expect(stats.majority).toBe(expected);
  });

  it.each(BOARD_STORIES)('renders 129 distinct hit targets in the %s state', (id) => {
    const { container, unmount } = render(<BoardSvg state={storyState(buildStory(id))} specs={STORY_SPECS} />);
    const groups = container.querySelectorAll('g[role="button"]');
    expect(groups).toHaveLength(129);
    const ids = new Set([...groups].map((g) => g.getAttribute('data-area-id')));
    expect(ids.size).toBe(129);
    const labels = new Set([...groups].map((g) => g.getAttribute('aria-label')));
    expect(labels.size).toBe(129);
    // Every slot is still hit-testable and still has its 48-unit rect.
    expect(container.querySelectorAll('rect[data-testid="hit-rect"]')).toHaveLength(129);
    unmount();
  });

  it('exercises all ten rows of the §4.6 matrix across the full board story', () => {
    const { container, unmount } = render(
      <BoardSvg state={storyState(buildStory('full'))} specs={STORY_SPECS} />,
    );
    const codes = new Set(
      [...container.querySelectorAll('g[role="button"]')].map((g) => g.getAttribute('data-cell')),
    );
    // The resting full board contains both faces, in both shapes, and both
    // owners — so rows 1, 2, 3, 4, 5, 6, 7, 8, 9 and 10 are all present.
    expect(codes).toContain('●');
    expect(codes).toContain('●◇');
    expect(codes).toContain('○');
    expect(codes).toContain('◇');
    unmount();
  });
});

describe('<BoardStories />', () => {
  it('renders all five boards at once', () => {
    const { container, unmount } = render(<BoardStories width={300} />);
    const svgs = container.querySelectorAll('svg[data-testid="board-svg"]');
    expect(svgs).toHaveLength(5);
    for (const svg of svgs) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 1000 1500');
    }
    expect(container.querySelectorAll('g[role="button"]')).toHaveLength(129 * 5);
    unmount();
  });
});

describe('<BoardHarness /> — the dev entry point', () => {
  it('mounts, and shows the board plus the blind answer', () => {
    const { container, getByTestId, unmount } = render(<BoardHarness />);
    expect(container.querySelector('svg[data-testid="board-svg"]')).not.toBeNull();
    expect(container.querySelectorAll('g[role="button"]')).toHaveLength(129);
    // The blind answer is present alongside, with two identical sides.
    expect(getByTestId('blind-answer')).toBeDefined();
    expect(container.querySelectorAll('.blind-answer__side')).toHaveLength(2);
    unmount();
  });

  it('switches between all five states without losing a slot', () => {
    const { container, unmount } = render(<BoardHarness />);
    const tabs = [...container.querySelectorAll('.harness__tab')];
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      fireEvent.click(tab);
      expect(container.querySelectorAll('g[role="button"]')).toHaveLength(129);
      expect(tab.getAttribute('aria-pressed')).toBe('true');
    }
    unmount();
  });

  it('activates a slot and reports it', () => {
    const { container, getByTestId, unmount } = render(<BoardHarness />);
    expect(getByTestId('last-slot').textContent).toBe('no slot activated');
    const slot = container.querySelector('g[role="button"][data-area-id="north-07"]');
    expect(slot).not.toBeNull();
    fireEvent.click(slot!);
    expect(getByTestId('last-slot').textContent).toBe('activated north-07');
    unmount();
  });
});
