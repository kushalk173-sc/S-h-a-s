/**
 * The dev harness. This is the page you actually look at.
 *
 * It renders the board in the five representative states from
 * `./Board.stories`, with a width slider so the 500px floor and the 780px
 * ceiling can both be checked, and the blind answer beside it — because that
 * component is the most important thing in the product and it needs to be
 * eyeballable next to the board it is supposed to be indistinguishable within.
 *
 * It is a harness, not a screen: no routing, no state machine, no engine.
 */

import { useCallback, useMemo, useState } from 'react';
import { BoardSvg } from './BoardSvg';
import { BlindAnswer } from '../answer/BlindAnswer';
import { PLAYERS } from './fixtures';
import { BOARD_STORIES, STORY_SPECS, buildStory, storyState, type StoryId } from './Board.stories';
import type { BoardState } from './types';
import { TOTAL_AREAS, TOTAL_MAJORITY_VOTERS } from './geometry';
import { flattenSlots } from './useBoardGeometry';
import './harness.css';

const STORIES = BOARD_STORIES.map(buildStory);

export function BoardHarness() {
  const [caseId, setCaseId] = useState<StoryId>('majority');
  const [boardWidth, setBoardWidth] = useState(560);
  const [seed, setSeed] = useState(20260930);
  // State, not a ref: a ref mutation does not re-render, so a read-out driven
  // by one would silently never update.
  const [lastSlot, setLastSlot] = useState('');
  const onSlotActivate = useCallback((areaId: string) => setLastSlot(areaId), []);

  const story = useMemo(() => STORIES.find((s) => s.id === caseId) ?? STORIES[0], [caseId]);
  const state: BoardState = useMemo(() => (story === undefined ? {
    zones: [],
    activePlayerId: 'p1',
    mode: 'idle' as const,
    players: PLAYERS,
  } : storyState(story)), [story]);

  const slotCount = useMemo(() => flattenSlots(STORY_SPECS).length, []);

  return (
    <div className="harness">
      <header className="harness__bar">
        <span className="harness__wordmark">SHASN</span>
        <span className="harness__meta">
          {slotCount} slots · {TOTAL_MAJORITY_VOTERS} majority voters · viewBox 1000×1500
        </span>
        <span className="harness__meta" data-testid="last-slot">
          {lastSlot === '' ? 'no slot activated' : `activated ${lastSlot}`}
        </span>
      </header>

      <nav className="harness__cases" aria-label="Board states">
        {STORIES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`harness__tab ${s.id === caseId ? 'is-active' : ''}`}
            aria-pressed={s.id === caseId}
            onClick={() => setCaseId(s.id)}
          >
            {s.title}
          </button>
        ))}
      </nav>

      <div className="harness__controls">
        <label>
          board width {boardWidth}px
          <input
            type="range"
            min={320}
            max={900}
            step={20}
            value={boardWidth}
            onChange={(e) => setBoardWidth(Number(e.target.value))}
          />
        </label>
        <button type="button" onClick={() => setSeed((s) => s + 1)}>
          answer seed {seed} ↻
        </button>
      </div>

      <p className="harness__note">{story?.note}</p>

      <div className="harness__grid">
        <section className="harness__board" aria-label="Board">
          <BoardSvg
            state={state}
            specs={STORY_SPECS}
            width={boardWidth}
            height={boardWidth * 1.5}
            onSlotActivate={onSlotActivate}
            liveMessage={`${caseId} state`}
          />
        </section>

        <section className="harness__answer" aria-label="Blind answer">
          <h2>The blind answer</h2>
          <p className="harness__note">
            Two surfaces that must be provably indistinguishable. Same class, no per-side
            override, no prop through which a payout could arrive. Change the seed: the order
            flips, the styles do not.
          </p>
          <BlindAnswer
            seed={seed}
            question="The trusts have quietly bought the land your party needs for a bypass. Do you let the deal stand, or sue?"
            labelA="Sue them and stall the project for three years."
            labelB="Let it stand. The bypass goes in, and the party gets the credit."
          />
        </section>
      </div>

      <footer className="harness__foot">
        MEASURED · {TOTAL_AREAS} areas · min centre distance 52.84 · hit rect 48u = 24.0px at the
        500px floor · amber renders as #B87A0C because #E0A020 measures 2.11:1 on parchment
      </footer>
    </div>
  );
}

export default BoardHarness;
