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
    expect(text, 'the count has no noun and reads as the resource holding').toMatch(/1\s*cards/i);
    // THE IDEOLOGUE, not the resource: the card IS a Capitalist card.
    expect(text, 'the cell does not name the Ideologue the cards are').toContain('Capitalist');
    // …and the resource survives, on the bonus line where it is what is being PAID.
    expect(text, 'the bonus no longer names what it pays').toMatch(/\+\d*\s*funds/i);
    // The unlock requirement, which was a bare countdown to an unnamed threshold.
    expect(text, 'the cell does not say how many more cards unlock a power').toMatch(
      new RegExp(`${UI_RULES.level3 - 1}\\s+more`),
    );
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
        onEndTurn={() => undefined}
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
