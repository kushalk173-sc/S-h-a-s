/**
 * THE RESPONSE WINDOW, MOUNTED — every stage, every seat, and the decline control.
 *
 * ─────────────────────────── WHAT THIS FILE GUARDS ───────────────────────────
 *
 * `interrupt.test.ts` pins the DERIVATION. This file pins what a player can
 * actually do, which is a different and more dangerous claim, because the failure
 * mode is a hung table rather than a wrong number:
 *
 *   - THE CONTROL EXISTS, IS ENABLED, AND IS LABELLED, for every seat the engine
 *     will accept a decline from. A window needs up to `n - 1` of them.
 *   - PRESSING IT DISPATCHES EXACTLY ONCE. One press, one `PASS_INTERRUPT`. A
 *     double dispatch would be refused by the server with "you have already
 *     declined", which is a toast on the one control that has to work.
 *   - A RE-RENDER MID-WINDOW neither loses the control nor duplicates it. The
 *     server sends a fresh state on every action, so a window that flickered
 *     through "no control" for one frame is a window a player cannot answer in.
 *   - A SPECTATOR SEES THE WINDOW AND CANNOT ACT.
 *   - RESOLVED STAGES ARE DISTINGUISHABLE, by word and glyph, never by colour.
 *   - A STRAY <Enter> DOES NOT DECLINE. Focus goes to the dialog container, which
 *     is not a control, so the key a screen-reader user presses to move on does
 *     nothing at all.
 *
 * ─────────────────────────── HOW NON-VACUITY WAS PROVEN ───────────────────────────
 *
 * Every test below that asserts the control was re-run with the decline button
 * REMOVED from `ResponseWindow.tsx`, and every one of them fails. The transcript
 * is in the commit message for the file. A test that asserts a control exists is
 * worth nothing if it would also pass without one, and that is a claim about the
 * test rather than about the component, so it was checked rather than assumed.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import APP_CSS from './app.css?raw';

import type {
  Choice,
  ClientState,
  Effect,
  InterruptWindow,
  PendingChoice,
  PlayerID,
  PlayerState,
  Pool,
} from '@shasn/engine';

import { ResponseWindow, type ResponsiveCard } from './ResponseWindow.tsx';

const POOL: Pool = { funds: 4, clout: 4, media: 4, trust: 4 };

function player(id: PlayerID): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    colour: '#000',
    resources: POOL,
    manifesto: [],
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
  };
}

const EFFECTS: readonly Effect[] = [{ op: 'gain-any', n: 3 }];

function windowOf(over: Partial<InterruptWindow> = {}): InterruptWindow {
  return {
    id: 'I1',
    actor: 'p1',
    cardId: 'cs-0001',
    kind: 'conspiracy',
    effects: EFFECTS,
    duration: 'this-turn',
    timing: 'now',
    blocked: false,
    deflectedTo: null,
    responder: null,
    passed: [],
    ...over,
  };
}

function tableOf(n: number, w: InterruptWindow, choices: readonly PendingChoice[] = []): ClientState {
  const seats = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  const players: Record<PlayerID, PlayerState> = {};
  for (const s of seats) players[s] = player(s);
  return {
    players,
    turnOrder: seats,
    activePlayer: 'p1',
    phase: 'actions',
    turn: 1,
    round: 1,
    finished: false,
    market: [],
    conspiracyTopCost: null,
    conspiracyRemaining: 0,
    headlineQueue: [],
    activeHeadline: null,
    choices,
    liveEffects: [],
    interrupt: w,
    finalRoundFrom: null,
    log: [{ turn: 1, player: 'p1', text: 'Played "PETTY GRAND".', kind: 'card' }],
    deckSizes: { ideology: 0, voter: 0, conspiracy: 0, headline: 0 },
    awaitingAnswer: false,
  } as unknown as ClientState;
}

const CARD: ResponsiveCard = {
  id: 'cs-0100',
  name: 'PARTIAL DEFLECTION',
  text: 'Redirect the card to a player other than the one who played it.',
  op: 'deflect',
};

type Opts = {
  readonly you?: PlayerID | null;
  readonly isSpectator?: boolean;
  readonly responsive?: readonly ResponsiveCard[] | undefined;
  readonly n?: number;
  readonly choices?: readonly PendingChoice[];
  readonly w?: InterruptWindow;
  /** `state.interrupt === null` — no window at all. */
  readonly closed?: boolean;
};

/**
 * The harness `GameScreen` runs: the DEFLECT target is local state, and the
 * component is driven with a real one-way loop rather than a bare `vi.fn()`, so a
 * click that changes a prop re-renders as it would in the product.
 */
function Harness({
  opts,
  onDecline,
  onRespond,
}: {
  opts: Opts;
  onDecline: () => void;
  onRespond: (cardId: string, at: PlayerID | undefined) => void;
}) {
  const [target, setTarget] = useState<PlayerID | null>(null);
  const w = opts.w ?? windowOf();
  return (
    <ResponseWindow
      state={tableOf(opts.n ?? 4, w, opts.choices ?? [])}
      window={opts.closed === true ? null : w}
      you={opts.you === undefined ? 'p2' : opts.you}
      isSpectator={opts.isSpectator ?? false}
      responsive={opts.responsive}
      onDecline={onDecline}
      onRespond={onRespond}
      deflectTarget={target}
      onDeflectTarget={setTarget}
    />
  );
}

function mount(opts: Opts = {}) {
  const onDecline = vi.fn();
  const onRespond = vi.fn();
  const view = render(
    <Harness opts={opts} onDecline={onDecline} onRespond={onRespond} />,
  );
  return { ...view, onDecline, onRespond };
}

const decline = () => screen.queryByTestId('interrupt-decline');
const modal = () => screen.queryByTestId('interrupt-window');
const banner = () => screen.queryByTestId('interrupt-window-banner');

// ─────────────────────────── the control ───────────────────────────

describe('the decline control', () => {
  it('exists, is enabled, and is a labelled button a keyboard can reach', () => {
    mount();
    const b = decline();
    expect(b).toBeTruthy();
    expect(b?.tagName).toBe('BUTTON');
    // A real `<button>` with no `disabled` and no `aria-disabled`. §9.2's
    // "merely low-contrast refusal" must not be how the anti-stall control is
    // expressed.
    expect(b?.hasAttribute('disabled')).toBe(false);
    expect(b?.getAttribute('aria-disabled')).toBeNull();
    // Labelled in words a player reads, and it names its consequence via
    // `aria-describedby` rather than leaving the reason in the CSS.
    expect(b?.textContent).toContain('DECLINE');
    const why = screen.getByText(/Declining spends nothing/);
    expect(b?.getAttribute('aria-describedby')).toBe(why.getAttribute('id'));
  });

  it('dispatches EXACTLY ONE decline per press', () => {
    const { onDecline } = mount();
    fireEvent.click(decline()!);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('is reachable and pressable by keyboard, and is the only decline path', () => {
    // `<button type="button">` is in the tab order and answers both Enter and
    // Space natively. There is no second element anywhere in this component that
    // calls `onDecline` — asserted by the count below, which would be 2 if a
    // wrapper or a key handler existed as well.
    const { onDecline } = mount();
    const b = decline() as HTMLButtonElement;
    b.focus();
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'Enter' });
    fireEvent.click(b);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-testid="interrupt-decline"]')).toHaveLength(1);
  });

  it('survives a re-render mid-window: neither lost nor duplicated', () => {
    // The server sends a fresh state on every action, so this is the ordinary
    // path, not an edge case: the control must be the same single element before
    // and after, and pressing after the re-render must still be exactly one.
    const { onDecline, rerender } = mount();
    const first = decline();
    expect(first).toBeTruthy();

    rerender(
      <Harness
        opts={{ w: windowOf({ passed: ['p3'] }) }}
        onDecline={onDecline}
        onRespond={vi.fn()}
      />,
    );

    const second = decline();
    expect(second).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="interrupt-decline"]')).toHaveLength(1);
    fireEvent.click(second!);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('a stray Enter on the focused element does NOT decline for anybody', () => {
    // The dangerous frame: the window opens, focus lands somewhere, and the player
    // presses the key they press to move on. So focus goes to the DIALOG, which is
    // not a control, and Enter on it does nothing.
    const { onDecline } = mount();
    expect(document.activeElement).toBe(modal());
    expect(modal()?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).not.toBe(decline());
    fireEvent.keyDown(modal()!, { key: 'Enter' });
    fireEvent.keyDown(modal()!, { key: ' ' });
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('a click on the scrim outside the sheet does NOT decline', () => {
    // The scrim exists partly so a stray click on the board behind cannot be
    // mistaken for a decline. It is a plain div with no handler, and this asserts
    // that rather than assuming it.
    const { onDecline } = mount();
    const scrim = screen.getByTestId('interrupt-window-modal');
    fireEvent.click(scrim);
    expect(onDecline).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── every seat role, every stage ───────────────────────────

describe('every seat, every stage', () => {
  const FROZEN: readonly PendingChoice[] = [
    { id: 'ch-1', player: 'p3', choice: { kind: 'lose-any', count: 4, reason: 'the cap' } },
  ];

  const SEATS: readonly { label: string; opts: Opts; controls: number; title: RegExp }[] = [
    { label: 'a required seat', opts: { you: 'p2' }, controls: 1, title: /it is your move/ },
    { label: 'the actor', opts: { you: 'p1' }, controls: 0, title: /Your card is being answered/ },
    { label: 'an already-declined seat', opts: { you: 'p4', w: windowOf({ passed: ['p4'] }) }, controls: 0, title: /You have declined/ },
    { label: 'a frozen seat', opts: { you: 'p3', choices: FROZEN }, controls: 0, title: /A card is being answered/ },
    { label: 'a spectator', opts: { you: null, isSpectator: true }, controls: 0, title: /A card is being answered/ },
  ];

  for (const seat of SEATS) {
    it(`${seat.label} sees the window; it has ${seat.controls === 1 ? 'the' : 'no'} control`, () => {
      mount(seat.opts);
      // The window itself is visible for every seat — that is the whole point of
      // an unprefixed, public field.
      expect(modal() !== null || banner() !== null).toBe(true);
      expect(screen.getByTestId('window-state')).toBeTruthy();
      expect(screen.getByText(seat.title)).toBeTruthy();

      const found = document.querySelectorAll('[data-testid="interrupt-decline"]');
      expect(found).toHaveLength(seat.controls);
      if (seat.controls === 1) {
        // The one seat with a decision gets the MODAL, not a banner: it takes the
        // viewport because it is the only control that matters until pressed.
        expect(modal()).toBeTruthy();
        expect(banner()).toBeNull();
      } else {
        // Everybody else gets a status. A modal with nothing to press is the dead
        // dialog `choiceResolver.test.tsx` exists to prevent.
        expect(banner()).toBeTruthy();
        expect(modal()).toBeNull();
      }
    });
  }

  it('a required seat is told what responding means and that declining is the alternative', () => {
    mount({ you: 'p2' });
    expect(screen.getByText(/you may play it instead/)).toBeTruthy();
    expect(decline()).toBeTruthy();
  });

  it('a seat holding nothing playable is told they may still decline, not left staring', () => {
    // `[]` is the server saying "you hold nothing that can answer" — a real claim
    // that needs its own words, because the ordinary case for a decliner is
    // exactly that and a frozen-looking board would be a player believing they
    // have no move.
    mount({ you: 'p2', responsive: [] });
    expect(screen.getByTestId('window-respond-none')).toBeTruthy();
    expect(screen.getByText(/declining is a real move/)).toBeTruthy();
    expect(decline()).toBeTruthy();
  });

  it('an ABSENT card list is a different claim from an empty one, and is not guessed at', () => {
    mount({ you: 'p2', responsive: undefined });
    expect(screen.getByTestId('window-respond-unknown')).toBeTruthy();
    expect(screen.queryByTestId('window-respond-none')).toBeNull();
    // No invented card: the respond list is absent entirely.
    expect(document.querySelectorAll('[data-responsive-id]')).toHaveLength(0);
    expect(decline()).toBeTruthy();
  });

  it('a spectator is told they are watching and cannot act', () => {
    mount({ you: null, isSpectator: true });
    expect(screen.getByText(/You are watching/)).toBeTruthy();
    expect(decline()).toBeNull();
  });

  it('the actor is told they may not answer their own card', () => {
    mount({ you: 'p1' });
    expect(screen.getByText(/you may not answer it/)).toBeTruthy();
    expect(decline()).toBeNull();
  });
});

// ─────────────────────────── the resolved stages ───────────────────────────

describe('the resolved stages are distinguishable', () => {
  it('an open window says HELD, an answered one says ANSWERED, and neither is colour', () => {
    const open = mount({ you: 'p2' });
    const openState = screen.getByTestId('window-state');
    expect(openState.getAttribute('data-state')).toBe('open');
    expect(openState.textContent).toContain('HELD — NOT YET APPLIED');
    // §8.2: the word and the glyph are both plain text and always rendered, so a
    // greyscale render and a screen reader read the same sentence.
    expect(within(openState).getByText('‖')).toBeTruthy();
    open.unmount();

    mount({ you: 'p2', w: windowOf({ responder: 'p2', blocked: true }) });
    const answered = screen.getByTestId('window-state');
    expect(answered.getAttribute('data-state')).toBe('answered');
    expect(answered.textContent).toContain('ANSWERED');
    expect(within(answered).getByText('✔')).toBeTruthy();
    // A BLOCK's outcome is a word too, not a colour and not a glyph alone.
    expect(answered.textContent).toContain('Blocked');
    // …and an answered window offers nobody a decline.
    expect(decline()).toBeNull();
  });

  it('says what has NOT happened, in words, before the control', () => {
    // The most damaging failure here is a player believing a resolution has landed
    // when it is still held.
    mount({ you: 'p2' });
    expect(screen.getByTestId('window-card').textContent).toContain('nothing has been applied yet');
    // The effects are legible BEFORE the control, not summarised in the log later.
    const order = screen.getByTestId('window-card').compareDocumentPosition(
      screen.getByTestId('window-effects'),
    );
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const effects = screen.getByTestId('window-effects');
    expect(effects.textContent).toContain('Take 3 resources of your choice');
  });

  it('renders nothing at all when no window is open', () => {
    // `state.interrupt` back to `null` is the only exit, and it must leave no
    // residue: a banner that outlives its window is a player being told a card is
    // still held after it has resolved.
    mount({ closed: true });
    expect(modal()).toBeNull();
    expect(banner()).toBeNull();
    expect(decline()).toBeNull();
    expect(document.body.textContent).toBe('');
  });
});

// ─────────────────────────── the show-the-card path ───────────────────────────

describe('the show-the-card path', () => {
  it('a responding player sees the card identity and its printed effect text', () => {
    // A responding player is SPENDING a reactive card, so its identity and what it
    // does have to be legible before they press anything. Both strings come from
    // the server's list — this client has no card index and must not be given one.
    mount({ you: 'p2', responsive: [CARD] });
    expect(screen.getByText(CARD.name)).toBeTruthy();
    expect(screen.getByText(CARD.text)).toBeTruthy();
    expect(screen.getByTestId(`window-respond-${CARD.id}`)).toBeTruthy();
  });

  it('a DEFLECT names a player before it may be played, and offers only legal ones', () => {
    // The engine refuses the actor (cannot redirect back) and the responder (a
    // no-op dressed as a card), so those two are not offered at all.
    mount({ you: 'p2', responsive: [CARD] });
    expect(screen.getByTestId('window-deflect-target-p3')).toBeTruthy();
    expect(screen.getByTestId('window-deflect-target-p4')).toBeTruthy();
    expect(screen.queryByTestId('window-deflect-target-p1')).toBeNull();
    expect(screen.queryByTestId('window-deflect-target-p2')).toBeNull();
  });

  it('a DEFLECT is unplayable until a target is picked, then plays for that player', () => {
    const { onRespond } = mount({ you: 'p2', responsive: [CARD] });
    const play = screen.getByTestId(`window-respond-${CARD.id}`);
    expect(play.hasAttribute('disabled')).toBe(true);
    fireEvent.click(play);
    expect(onRespond).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('window-deflect-target-p4'));
    fireEvent.click(screen.getByTestId(`window-respond-${CARD.id}`));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith(CARD.id, 'p4');
  });

  it('a BLOCK takes no target and plays with the field OMITTED', () => {
    // `reduce` refuses a Block that carries one ("there is nothing to redirect it
    // to"), and `exactOptionalPropertyTypes` is on, so `at` must be absent rather
    // than `undefined`. Asserting the omitted key is asserting the difference
    // between a legal Block and a refusal.
    const block: ResponsiveCard = { ...CARD, id: 'cs-0200', op: 'block' };
    const { onRespond } = mount({ you: 'p2', responsive: [block] });
    expect(screen.queryByTestId('window-deflect-target-p3')).toBeNull();
    fireEvent.click(screen.getByTestId(`window-respond-${block.id}`));
    expect(onRespond).toHaveBeenCalledWith(block.id, undefined);
  });
});

// ─────────────────────────── accessibility, structurally ───────────────────────────

describe('accessibility, structurally', () => {
  it('the modal is a labelled, described, focusable dialog', () => {
    mount();
    const d = modal()!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-label')).toBe('A card is being answered');
    expect(d.getAttribute('aria-describedby')).toBe('window-card');
  });

  it('the banner is a labelled group and is NOT a live region', () => {
    // §8.5: the shell has exactly ONE polite live region — the board's — and
    // `describeForScreenReader` extends its sentence for every stage. A second
    // region here would announce the same event twice on every screen reader, and
    // a duplicated announcement is worse than one that arrives a beat late.
    mount({ you: 'p1' });
    const b = banner()!;
    expect(b.getAttribute('role')).toBe('group');
    expect(b.getAttribute('aria-label')).toBe('A card is being answered');
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('the banner never steals focus', () => {
    // A panel that appears mid-turn and takes the caret out from under a player
    // reading their own mat is a worse defect than one that is merely announced.
    mount({ you: 'p1' });
    expect(banner()).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it('the state is carried by a word and a glyph, never by colour alone', () => {
    // §8.2. The assertion is structural on purpose: a computed-style check would
    // pass vacuously in jsdom unless `css: true` is set, and it would still not
    // say that the WORD is there.
    mount();
    const line = screen.getByTestId('window-state');
    expect(line.querySelector('.window__word')?.textContent).toBe('HELD — NOT YET APPLIED');
    expect(line.querySelector('.window__glyph')?.textContent).toBe('‖');
  });

  it('no CSS rule for this panel moves anything, so there is no payout to watch', () => {
    // …asserted against the STYLESHEET rather than against `getComputedStyle`, and
    // deliberately so: jsdom returns `''` for an unset `animation-name`, so a
    // computed-style assertion here would either be vacuous or have to be loosened
    // into meaninglessness. Reading the source is the only assertion here that
    // cannot pass by accident. `?raw` is Vite's own text loader, which sidesteps
    // the jsdom `import.meta.url` that is not a file URL.
    const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

    const offenders: string[] = [];
    for (const rule of css.split('}')) {
      const brace = rule.indexOf('{');
      if (brace < 0) continue;
      const selector = rule.slice(0, brace);
      if (!selector.includes('.window')) continue;
      const body = rule.slice(brace + 1);
      for (const m of body.matchAll(/(?:^|[;{\s])(animation|transition|transform)\s*:\s*([^;]+)/g)) {
        const value = (m[2] ?? '').trim();
        // `none` is the assertion holding, not a violation of it.
        if (value !== 'none' && !value.startsWith('none')) {
          offenders.push(`${selector.trim()} { ${m[1]}: ${value} }`);
        }
      }
    }
    expect(offenders).toEqual([]);

    // And the stylesheet does carry rules for the panel at all, so the scan above
    // was reading something rather than matching nothing.
    expect(css).toMatch(/\.window-band\s*\{/);
    expect(css).toMatch(/\.window-scrim\s*\{/);
  });
});