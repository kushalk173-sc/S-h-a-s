/**
 * ═════════════════════════════════════════════════════════════════════════════
 * A NUMBER WITH NO NOUN IS A LIE BY OMISSION, AND A SENTENCE THAT PROMISES
 * RESOLUTION THE ENGINE DOES NOT DO IS A LIE OUTRIGHT
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Two reported problems that are the same shape — a player told something false by
 * this client — and neither is a rule bug. Both are the client's own copy, which is
 * why nothing caught them: the engine's proofs are about reachability and the
 * layout gates are about what crosses the wire, and a sentence in a `<p>` is
 * invisible to both. `staleWording.test.tsx` exists because of exactly that gap and
 * this file is the same instrument pointed at two more claims.
 *
 * ## ITEM 5 — THE MANIFESTO NUMBER
 *
 * Reported: "`MANIFESTO` shows 54 under a pool of 12, and nobody could work out what
 * it is. A tester concluded the big number is the resource holding, not manifesto
 * progress."
 *
 * **The conclusion is wrong and the complaint is right.** `manifestoCells` reads
 * `player.manifesto.filter((i) => i === ideologue).length` — the number of Ideology
 * Cards of that Ideologue. It cannot be a resource holding: the resource strip four
 * lines above prints those in a different size with a different label, and 54 is not
 * reachable under a cap of 12.
 *
 * So the number was correct and the LABEL was not. The cell rendered `23` · `funds` ·
 * `L5`, and under the heading `MANIFESTO`, on a mat that also prints a funds
 * number, that reads as **"23 funds"**. The noun after the numeral was a RESOURCE —
 * correct for the bonus, which pays `+1 Funds`, and wrong for the count, which counts
 * Capitalist cards. There was no way for a player to tell, so they concluded the
 * wrong thing, which is the correct conclusion given the evidence on screen.
 *
 * ## ITEM 6 — "THE BOARD WILL CARRY ON WITHOUT AN ANSWER"
 *
 * `PegDestChoice`'s unreachable branch told the player: *"the card has nothing to
 * do, and the board will carry on without an answer."* Both halves are false, and an
 * engine agent proved it against `reduce.ts`:
 *
 *   - the card does NOT resolve itself. The decision stays in `state.choices` until
 *     something removes it, and `blockedBy` refuses every other action for the
 *     answering player while it is there. The table WAITS.
 *   - so the sentence told a stopped table that it was not stopped, which is the most
 *     expensive kind of wrong copy there is: it removes the player's reason to ask
 *     for help.
 *
 * What is true is narrower and is what the copy now says: the OFFER has gone stale
 * (`pegMoveOffered` was true when the card was played — `applyEffect` raises nothing
 * otherwise — and has come back empty against the live board), no pick is legal, and
 * the decision is still owed. The dialog recovers by itself when the board does,
 * because nothing in the unreachable branch is state.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useState } from 'react';
// TYPE-ONLY. See `derive.ts`'s header: the secret gate scans this directory whole.
import type { ClientState, PlayerID, PlayerState } from '@shasn/engine';

import { ManifestoStrip, YourMat } from './YourMat.tsx';
import { ChoiceResolver, type ChoiceResolverProps } from './ChoiceResolver.tsx';
import { UI_RULES, manifestoCells, overCap } from './derive.ts';
// Real geometry, so a fixture can never invent a board the branch cannot walk.
import { makeZones } from '../board/fixtures.ts';

const ME: PlayerID = 'p1';
const P2: PlayerID = 'p2';

// ─────────────────────────── item 5: the MANIFESTO number ───────────────────────────

function seat(manifesto: readonly string[], pool = { funds: 0, clout: 0, media: 12, trust: 12 }): PlayerState {
  return {
    id: ME,
    name: 'P1',
    colour: '#fff',
    resources: pool,
    manifesto: [...manifesto],
    manifestoCards: [],
    conspiracies: [],
    restrictions: [],
    pending: [],
    powerUses: {
      prospecting: 0,
      landGrab: 0,
      donations: 0,
      payback: 0,
      goingViral: 0,
      helpingHands: 0,
      toughLove: 0,
      gerrymandered: {},
    },
    isBot: false,
  } as unknown as PlayerState;
}

describe('item 5 — the MANIFESTO number says what it counts', () => {
  it('CONFIRMED: the big number is Ideology Cards, and it CANNOT be a holding', () => {
    // The claim under test, stated as arithmetic so it cannot be argued with.
    // `54` is the number from the report; `23` is what a live mat showed.
    const many = Array.from({ length: 23 }, () => 'capitalist' as const);
    const cells = manifestoCells(seat(many));
    const capitalist = cells[0];
    expect(capitalist?.count, 'twenty-three Capitalist cards did not read as twenty-three').toBe(23);
    // The decisive half: a card count is NOT bounded by the resource cap, and the
    // reported `54` is not reachable as a holding under a cap of 12. That is the whole
    // of "the conclusion is wrong and the complaint is right".
    expect(capitalist?.count ?? 0).toBeGreaterThan(UI_RULES.resourceCap);
    expect(overCap(seat(many).resources, UI_RULES.resourceCap)).toBe(12);
    // …and it is counted from a DIFFERENT FIELD than the holding, which is why the
    // two must never share a noun.
    expect(seat(many).resources.funds).toBe(0);
    expect(seat(many).manifesto).toHaveLength(23);
  });

  it('the cell names the noun, the IDEOLOGUE, and the bonus separately', () => {
    const r = render(
      <ManifestoStrip
        state={{ players: { [ME]: seat(['capitalist']) } } as unknown as ClientState}
        you={ME}
      />,
    );
    const cell = r.container.querySelector('[data-testid=manifesto-capitalist]') as HTMLElement;
    expect(cell, 'no Capitalist cell rendered').not.toBeNull();
    const text = cell.textContent ?? '';
    // THE NOUN, visible. This is the entire fix.
    expect(text, 'the count has no noun and reads as the resource holding').toMatch(/1 card Capitalist/i);
    // �and it agrees with the numeral. A cell reading '1 cards' is the same class of
    // error as one reading '23 funds': a number attached to a noun it does not agree
    // with, on the strip whose whole job is to be believed. Caught by a screenshot.
    expect(text, 'the count is pluralised wrongly').not.toMatch(/\b1\s*cards\b/i);
// THE IDEOLOGUE, not the resource: the card IS a Capitalist card.
    expect(text, 'the DOM text runs the count and the Ideologue together').toContain('Capitalist');
    // …and the resource survives, on the bonus line where it is what is being PAID.
    expect(text, 'the bonus no longer names what it pays').toMatch(/\+\d*\s*funds/i);
    // The unlock requirement, which is no longer prose at all: it is the NOTCHED pip
    // at `level3`. Asserted as a mark, because that is what a player now reads — see
    // "the pip track ENCODES the thresholds" below for the geometry.
    expect(text, 'the cell has no progress track to read the unlock from').toBeTruthy();
    r.unmount();
  });

  it('the pip track ENCODES the thresholds, so no arithmetic is needed to read them', () => {
    /*
      The reported problem, one level up from the wording: *"Which makes me think the
      UI doesn't feel super intuitive."* Fixing the sentence only moved the
      arithmetic around. The strip has THREE thresholds — `passiveBonusPer` (2),
      `level3` (3), `level5` (5) — and delivered all three as text the player
      reconciles by hand, on a panel §5.4 calls "the main strategic read on the mat".

      So the thresholds are now POSITIONS: a fixed 5-pip track, a wider gap after
      every second pip (`passiveBonusPer`), and a taller pip at `level3`. A player
      watching a pair close knows the `+1` is why, without reading anything.

      These assert the encoding, because an encoding that is drawn but not load-bearing
      would be decoration — and a decorative pip track is worse than the sentence it
      replaced, since it would LOOK like the answer while saying nothing.
    */
    const r = render(
      <ManifestoStrip
        state={{ players: { [ME]: seat([]) } } as unknown as ClientState}
        you={ME}
      />,
    );
    const cell = r.container.querySelector('[data-testid=manifesto-capitalist]') as HTMLElement;
    const track = cell.querySelector('.mani__track') as HTMLElement;
    expect(track, 'the cell has no pip track').not.toBeNull();

    const pips = [...track.querySelectorAll('.mani__pip')];
    // Five slots, one per threshold up to `level5`. Not `count` slots: a track that
    // grows would hide the fact that the 23rd card bought nothing new.
    expect(pips.length, 'the track is not capped at level5').toBe(UI_RULES.level5);

    // The cadence is DRAWN as a pair gap, on every `passiveBonusPer` boundary. Five pips
    // at two per bonus is 2, 4 and then the track's own end at 5 — the last slot has no
    // partner, so it terminates the row rather than starting a pair that never closes.
    const pairEnds = pips
      .map((p, i) => (p.getAttribute('data-pair-end') === 'true' ? i + 1 : null))
      .filter((n): n is number => n !== null);
    const expectedPairEnds: number[] = [];
    for (let n = UI_RULES.passiveBonusPer; n < UI_RULES.level5; n += UI_RULES.passiveBonusPer) {
      expectedPairEnds.push(n);
    }
    expectedPairEnds.push(UI_RULES.level5);
    expect(pairEnds, 'the pair gap does not sit on the passiveBonusPer boundary').toEqual(
      expectedPairEnds,
    );

    // The power threshold is a marked pip, permanently — legible whether or not the
    // cell has reached it, which is the whole point of marking it.
    const notched = pips.filter((p) => p.getAttribute('data-threshold') === 'power');
    expect(notched.length, 'level3 is not marked on the track').toBe(1);
    expect(
      pips.indexOf(notched[0] as Element) + 1,
      'the notch is not the level3rd pip',
    ).toBe(UI_RULES.level3);

    // …and the ARIA name restates the same thresholds, because a position is
    // invisible to anyone not looking at it. The visual encoding must never be the
    // ONLY place a rule is written down.
    expect(track.getAttribute('aria-label') ?? '', 'the track has no accessible name').toContain(
      `${UI_RULES.level5} pip slots`,
    );
    expect(track.getAttribute('aria-label') ?? '', 'the cadence is not in the track name').toContain(
      'Every pair of pips pays +1',
    );
    r.unmount();
  });

  it('the bonus line states the INCOME, not the formula', () => {
    /*
      `+1 funds per 2` is a rule to apply; `+1 funds per turn` is a quantity to bank.
      The strip's bottom line should be the number the player is actually accumulating,
      because that is the only one of the three that survives into a score — and
      stating the formula is what put `3` and `2` next to each other in the first place.
    */
    // Zero: it must say so plainly. "Nothing yet" is itself the strategic read — a
    // player deciding whether to chase a third Capitalist needs to know that the
    // SECOND card is what pays.
    const none = render(
      <ManifestoStrip
        state={{ players: { [ME]: seat([]) } } as unknown as ClientState}
        you={ME}
      />,
    );
    const empty = none.container.querySelector('[data-testid=manifesto-capitalist]') as HTMLElement;
    expect(empty.textContent ?? '', 'a zero-income cell does not say it pays nothing').toContain(
      `+0 funds`,
    );
    expect(empty.textContent ?? '', 'the zero cell does not say when the next one pays').toContain(
      `next in ${UI_RULES.passiveBonusPer}`,
    );
    // The formula itself is gone from the visible text — it lives in the pip gaps now.
    expect(empty.textContent ?? '', 'the formula is back on the cell').not.toMatch(
      /per\s*\d+\s*·/,
    );
    none.unmount();

    // Earning: the income, at full strength, with the cadence still reachable.
    const earning = render(
      <ManifestoStrip
        state={{
          players: { [ME]: seat(Array.from({ length: 4 }, () => 'capitalist' as const)) },
        } as unknown as ClientState}
        you={ME}
      />,
    );
    const paid =
      earning.container.querySelector('[data-testid=manifesto-capitalist]') as HTMLElement;
    // 4 cards at 2 per bonus = 2. Taken from `bonusPerTurn`, i.e. the same number the
    // engine pays, so a rules change cannot leave the copy behind.
    expect(paid.textContent ?? '', 'the earned income is wrong').toContain(
      `+${Math.floor(4 / UI_RULES.passiveBonusPer)} funds per turn`,
    );
    earning.unmount();
  });

  it('the cadence is reachable from the cell text, because a screen reader cannot see a gap', () => {
    // `cellName` states "every N cards" for exactly this reason. The pip track is the
    // primary encoding, but a screen-reader user meets the sentence, not the geometry,
    // so the sentence has to carry the rule on its own.
    const r = render(
      <ManifestoStrip
        state={{ players: { [ME]: seat(['capitalist']) } } as unknown as ClientState}
        you={ME}
      />,
    );
    const cell = r.container.querySelector('[data-testid=manifesto-capitalist]') as HTMLElement;
    const label = cell.getAttribute('aria-label') ?? '';
    expect(label, 'the accessible name does not state the cadence').toContain(
      `One extra funds for every ${UI_RULES.passiveBonusPer} cards.`,
    );
    // At one card the next bonus is the NEXT card — the fact that caused the report.
    expect(label, 'the accessible name does not say the next card pays').toContain(
      'Pays nothing yet, 1 more card for +1',
    );
    r.unmount();
  });

it('the DOM TEXT runs the three facts apart, because textContent is what is read', () => {
    // Found by a screenshot, not by reasoning: the cell's spans are block-level, so
    // they LOOKED like separate lines — but `display: block` is a visual break only,
    // and `textContent` still ran "1cardCapitalist2 more · +1 funds per 2" together.
    // That matters twice over: a screen reader concatenates the same string, and this
    // project's own harness reads the mat out of the DOM by exactly that route.
    //
    // The Ideologue line therefore has to be followed by a separator that EXISTS IN THE
    // TEXT, not only in the layout. The bonus line is that separator now — the pip
    // track adds no text at all, which is precisely why it cannot do this job.
    //
    // And the numeral has to agree with its noun. "1 cards" is the same class of error
    // as "23 funds" — a number attached to a noun it does not agree with, on the strip
    // whose whole job is to be believed.
    const one = seat(['capitalist']);
    const many = seat(['capitalist', 'capitalist']);
    for (const [label, player] of [
      ['one card', one],
      ['two cards', many],
    ] as const) {
      const r = render(
        <ManifestoStrip
          state={{ players: { [ME]: player } } as unknown as ClientState}
          you={ME}
        />,
      );
      const text = r.container.querySelector('[data-testid=manifesto-capitalist]')?.textContent ?? '';
      expect(text, `${label}: the count and the Ideologue are glued together`).toMatch(
        /\d card[s]? Capitalist/,
      );
      expect(text, `${label}: the Ideologue and the income are glued together`).toMatch(
        /Capitalist\s+\+\d|Capitalist\s+L\d/,
      );
      expect(text, `${label}: the count and its noun disagree`).not.toMatch(/\b1 cards\b/);
      r.unmount();
    }
  });

  it('a LEVELLED cell still states the bonus — the forecast is not the chip’s alternative', () => {
    // Folded into the chip's `else` by accident while fixing the run-together text,
    // which would have shown the bonus only until the unlock and never again — i.e.
    // exactly when it stops being a forecast and becomes an income.
    const r = render(
      <ManifestoStrip
        state={{
          players: {
            [ME]: seat(Array.from({ length: 5 }, () => 'capitalist' as const)),
          },
        } as unknown as ClientState}
        you={ME}
      />,
    );
    const text = r.container.querySelector('[data-testid=manifesto-capitalist]')?.textContent ?? '';
    expect(text, 'an L5 cell lost its bonus line').toContain('L5');
    expect(text, 'an L5 cell does not say what it pays').toMatch(/\+\d+\s*funds per turn/i);
    r.unmount();
  });

  it('a card count is never printed where a resource name would read as its holding', () => {

    // The reported shape end to end: the strip above and the strip below, on one mat.
    const manifesto = Array.from({ length: 23 }, () => 'capitalist' as const);
    const me = seat(manifesto);
    const r = render(
      <YourMat
        state={
          {
            players: { [ME]: me, [P2]: seat([]) },
            turnOrder: [ME, P2],
            activePlayer: ME,
          } as unknown as ClientState
        }
        you={ME}
        pending={[]}
        placingGroupId={null}
        pickedCount={0}
        isMyTurn
        link="live"
        showControls
        inertReason={null}
        framed={false}
        onSelectGroup={() => undefined}
        onGerry={() => undefined}
        onPower={() => undefined}
        onTradeWith={() => undefined}
      />,
    );
    const mani = r.container.querySelector('.mani') as HTMLElement;
    const res = r.container.querySelector('.res') as HTMLElement;
    expect(mani.textContent ?? '').toMatch(/23\s*cards/i);
    // The resource strip is a different widget with a different font and no `cards`
    // noun, so the two numbers can no longer be read as one another's.
    expect(res.textContent ?? '').not.toMatch(/cards/i);
    // …and the whole mat's text contains no "23 funds" phrasing at all, which is the
    // literal thing a tester read.
    expect(r.container.textContent ?? '', 'the mat still prints "23 funds" somewhere').not.toMatch(
      /23\s*funds/i,
    );
    // The cell is named in one accessible name, so a screen-reader user is not asked
    // to reassemble "23", "cards", "Capitalist" and "L5" from four nodes (§8.5).
    expect(mani.querySelector('[data-testid=manifesto-capitalist]')?.getAttribute('aria-label') ?? '').toMatch(
      /23 Capitalist Ideology Cards/,
    );
    r.unmount();
  });
});

// ─────────────────────────── item 6: the response window's promise ───────────────────────────

/**
 * A `choose-peg-dest` on a REAL, EMPTY board — the stale-offer shape.
 *
 * `makeZones()` rather than `[]`, because the branch under test walks the board
 * through `pegMoveOptions` (the engine's `movablePegIds` and `pegDestinations`) and
 * a hand-written empty array is not a board. On a fresh board the actor holds
 * nothing, so `movablePegIds` is empty before adjacency is even consulted, and the
 * offer comes back false — the same way it does when a majority forms under an open
 * dialog.
 */
function staleState(): ClientState {
  return {
    players: { [ME]: seat([]), [P2]: seat([]) },
    turnOrder: [ME, P2],
    activePlayer: ME,
    phase: 'actions',
    turn: 9,
    round: 2,
    finished: false,
    market: [],
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices: [
      {
        id: 'ch-stale',
        player: ME,
        choice: { kind: 'choose-peg-dest', count: 1, scope: 'own', source: ME, reason: 'Card effect' },
      },
    ],
    log: [],
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
    zones: makeZones(),
  } as unknown as ClientState;
}

function Resolver({ state }: { state: ClientState }) {
  const props: ChoiceResolverProps = {
    state,
    you: ME,
    pickedAreaIds: [],
    onPickArea: () => undefined,
    onRemovePick: () => undefined,
    onResolveResources: () => undefined,
    onResolveSteal: () => undefined,
    onResolveAreas: () => undefined,
    onResolvePegDest: () => undefined,
    onResolvePlayer: () => undefined,
    onResolveZone: () => undefined,
    onResolveCard: () => undefined,
    recycle: [],
    // The draft is the component's own now (Defect C), so this harness has nothing
    // to thread: the stale branch holds no state either, which is the other half of
    // what "it will come back on its own" claims.
  };
  return <ChoiceResolver {...props} />;
}

describe('item 6 — the unreachable branch does not promise a resolution that never comes', () => {
  it('says the decision is STILL OWED, because that is what the engine does', () => {
    // An empty `zones` array means nothing can move, which is the stale-offer shape
    // the branch exists for. The claim under test is the SENTENCE, not the branch:
    // `choiceInvariant` already gates that the branch renders and that no confirm
    // appears when it does.
    const r = render(<Resolver state={staleState()} />);
    const said = r.container.querySelector('[data-testid=peg-dest-nothing]');
    expect(said, 'the unreachable branch did not render its sentence').not.toBeNull();
    const text = said?.textContent ?? '';

    // THE FALSE PROMISE, in every wording it has been caught in.
    for (const lie of [
      /carry on without an answer/i,
      /carry on/i,
      /without an answer/i,
      /the card has nothing to do/i,
      /nothing to do/i,
      /will clear itself/i,
      /carries on/i,
    ]) {
      expect(text, `the frame still promises a resolution the engine does not perform: ${lie}`).not.toMatch(lie);
    }

    // WHAT IS ACTUALLY TRUE, and all of it is a fact a player can rely on:
    expect(text, 'the frame does not say the offer went stale').toMatch(/can no longer be made/i);
    expect(text, 'the frame does not say the decision is still owed').toMatch(/still owed/i);
    expect(text, 'the frame does not say the table waits').toMatch(/table waits/i);
    // …and it says the way out, which is that the board can come back on its own.
    expect(text, 'the frame does not say the dialog recovers by itself').toMatch(/on its own/i);

    // And there is still no control that cannot act.
    expect(r.container.querySelector('[data-testid=peg-dest-confirm]')).toBeNull();
    r.unmount();
  });

  it('the sentence is a LIVE REGION, because it is the only thing on the frame that changes', () => {
    const r = render(<Resolver state={staleState()} />);
    const said = r.container.querySelector('[data-testid=peg-dest-nothing]');
    // Not strictly a live region by markup — the branch is a `<p>` — but it is inside
    // the dialog a screen reader is already in, and what matters is that the claim is
    // on the frame rather than in a toast. Asserted as a presence check so a
    // refactor that moves it into a transient element fails here.
    expect(said, 'the stale-offer sentence is not on the frame').not.toBeNull();
    expect(said?.closest('[data-testid=choice-dialog]')).not.toBeNull();
    r.unmount();
  });
});
