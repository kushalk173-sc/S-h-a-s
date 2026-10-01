/**
 * Test fixtures.
 *
 * Two card sets, and the reason for having both — and note that the reason has
 * CHANGED, because the first version of this comment was wrong in a way that cost
 * the project a month:
 *
 *  - `realCards()` / `loadCtx()` is the shipped corpus, loaded through the same path
 *    the server uses at boot. This is now what `startHarness()` deals by DEFAULT, so
 *    every server test that does not ask for something else is on the real cards.
 *
 *  - `bigCards()` is synthetic, and it is now opt-in. It exists for tests that need
 *    a deck with room to spare, and nothing else.
 *
 * WHAT USED TO BE HERE, AND WHY IT WAS WRONG
 *
 * This file used to say:
 *
 *   "The shipped corpus has 20 Ideology Cards and 12 Voter Cards, which is 36
 *    voters — nowhere near the 69 majority voters needed to form all nine zones, so
 *    a real-corpus game cannot be driven to `finished` and the acceptance criterion
 *    'a 2-player game runs to completion' would be untestable."
 *
 * Every number in that paragraph is wrong, and the conclusion drawn from them was
 * the reason the shipped game was unwinnable for a month. The real corpus is 52
 * Ideology Cards, 18 Voter Cards and 36 voters — not 20 and 12. And 36 voters is
 * never a cap, because a Voter Card RECYCLES: `INFLUENCE` discards it and
 * `refillMarket` reshuffles. The same 36 voters can be bought and placed over and
 * over, so 69 pegs and 129 are reachable from 18 cards.
 *
 * A fixture that declares the real game unwinnable, with invented numbers to
 * support it, is worse than no fixture: it makes every test built on it a test of
 * the fixture. The suite drove `bigCards()` because `bigCards()` was the only corpus
 * anyone had checked, and the deck-size blindness hid the shipped bug in the engine
 * because 240 and 4000 are both far from 52.
 *
 * The measurements that replaced it are in `test/corpus.test.ts` (the corpus's size
 * and composition, pinned) and `test/winnable.test.ts` (a real-corpus game reaching
 * nine majorities at 2, 3, 4 and 5 seats across a seed sweep).
 *
 * The one caveat that is still true, and is now a property of the ENGINE rather
 * than an excuse for a fixture: the Ideology deck must be larger than the number of
 * turns a game takes, or a table runs out of cards with no legal move. At 52 cards
 * the shipped corpus relies on `ANSWER` discarding the answered card so the pile
 * can be reshuffled. `test/corpus.test.ts` asserts that recycle happens; this file
 * must not paper over it again.
 */

import { createHash } from 'node:crypto';

import { WebSocket } from 'ws';

import {
  indexCards,
  playerView,
  RULES,
  setup,
  type ClientState,
  type Action,
  type CardIndex,
  type ConspiracyCard,
  type Ctx,
  type GameState,
  type HeadlineCard,
  type IdeologyCard,
  type PlayerID,
  type VoterCard,
} from '@shasn/engine';

import { loadCards, loadCtx } from '../src/index.ts';
import { decksOf } from '../src/store.ts';
import { InMemoryMatchStore } from '../src/store.ts';
import { ShasnServer } from '../src/index.ts';
import type { ServerMessage, Session } from '../src/protocol.ts';

// ─────────────────────────── card sets ───────────────────────────

/**
 * The shipped corpus, loaded through the server's own boot path.
 *
 * `loadCtx()` is what `ShasnServer` builds when it is not handed a `ctx`, so it is
 * the cards a real deployment deals. Prefer it over calling this.
 */
export function realCards(): CardIndex {
  return loadCards();
}

const IDEOLOGUES = ['capitalist', 'supremo', 'showstopper', 'idealist'] as const;

/**
 * `n` Ideology Cards, each paying a different Ideologue flavour on each side, so
 * the side-to-Ideologue balance is visibly unbalanced in a way a real corpus also
 * is — which is the whole reason the prompt order is randomised.
 */
export function bigCards(n = 240): CardIndex {
  const ideology = Array.from({ length: n }, (_, i): IdeologyCard => {
    const a = IDEOLOGUES[i % 4] ?? 'capitalist';
    const b = IDEOLOGUES[(i + 1) % 4] ?? 'idealist';
    return {
      id: `t-ide-${String(i).padStart(4, '0')}`,
      campaign: 'Test Campaign',
      question: `Test question number ${i}: which way does the district lean?`,
      sides: [
        { answer: `Take the ${a} road on question ${i}.`, ideologue: a, pays: { funds: 2, media: 1 } },
        { answer: `Take the ${b} road on question ${i}.`, ideologue: b, pays: { trust: 2, clout: 1 } },
      ],
    };
  });

  const voter = Array.from({ length: n }, (_, i): VoterCard => ({
    id: `t-vot-${String(i).padStart(4, '0')}`,
    // Cheap enough that a scripted player can buy every turn, and 3 voters each so
    // the board fills in a sane number of turns.
    cost: { funds: 1 },
    voters: 3,
  }));

  const conspiracy = Array.from({ length: 24 }, (_, i): ConspiracyCard => ({
    id: `t-con-${String(i).padStart(4, '0')}`,
    name: `Test Conspiracy ${i}`,
    text: 'Does a test thing.',
    cost: 4,
    effects: [{ op: 'voters', n: 1 }],
  }));

  const headline = Array.from({ length: 24 }, (_, i): HeadlineCard => ({
    id: `t-hed-${String(i).padStart(4, '0')}`,
    name: `Test Headline ${i}`,
    text: 'Something happens in a test place.',
    effects: [{ op: 'gain', res: { media: 1 } }],
  }));

  return indexCards({ ideology, voter, conspiracy, headline });
}

export function makeCtx(cards: CardIndex = bigCards()): Ctx {
  return { rules: RULES, cards };
}

// ─────────────────────────── server harness ───────────────────────────

export type Harness = {
  readonly server: ShasnServer;
  readonly url: string;
  readonly store: InMemoryMatchStore;
  readonly ctx: Ctx;
  close(): Promise<void>;
};

let clock = 1_700_000_000_000;
function tick(): number {
  clock += 1;
  return clock;
}

export async function startHarness(
  opts: { cards?: CardIndex; store?: InMemoryMatchStore; dispatchRate?: number } = {},
): Promise<Harness> {
  // THE SHIPPED CORPUS, unless a test asks for something else.
  //
  // This used to default to `bigCards()`, which dealt 240 Ideology Cards against
  // the shipped 52 — and 52, drawn one per turn, is the number that decides whether
  // a game is winnable. A suite that defaults to a 4.6x deck is a suite that
  // cannot see the game shipping unwinnable, and it did not see it for a month.
  // `loadCtx()` is the server's own boot path, so the default here is the same
  // cards a deployment deals, not a lookalike.
  //
  // `test/corpus.test.ts` asserts this, so a future change that reintroduces a
  // synthetic default has to change an assertion to get past it.
  const ctx = opts.cards === undefined ? loadCtx() : makeCtx(opts.cards);
  const store = opts.store ?? new InMemoryMatchStore();
  const server = new ShasnServer({
    port: 0,
    host: '127.0.0.1',
    now: tick,
    skipRestore: true,
    clientDir: null,
    ...(opts.dispatchRate === undefined ? {} : { dispatchRate: opts.dispatchRate }),
    ctx,
    store,
  });
  const { port } = await server.listen();
  return {
    server,
    store,
    ctx,
    url: `ws://127.0.0.1:${port}/ws`,
    close: () => server.close(),
  };
}

/**
 * A minimal but real `ClientState`, for exercising the CLIENT store without
 * standing up a whole match.
 *
 * Built by projecting a real `setup()` output rather than hand-writing the shape,
 * so it cannot drift from what the engine actually emits — a hand-written fixture
 * here would pass against a `ClientState` that no longer exists.
 */
export function testClientState(
  over: { phase?: GameState['phase']; activePlayer?: string } = {},
): ClientState {
  const base = setup({
    players: ['p_1', 'p_2'],
    names: { p_1: 'Ada', p_2: 'Bo' },
    cards: bigCards(8),
    seed: 4242,
    ...decksOf(bigCards(8)),
  });
  const state: GameState = {
    ...base,
    ...(over.phase === undefined ? {} : { phase: over.phase }),
    ...(over.activePlayer === undefined ? {} : { activePlayer: over.activePlayer }),
  };
  return playerView(state, 'p_1');
}

// ─────────────────────────── wire client ───────────────────────────

/**
 * A real WebSocket client.
 *
 * Real, not a stub, because the properties under test are transport properties: a
 * payload cap, a rate limiter, a close that holds a seat, and a resume that
 * arrives on a different socket. A mock would test the mock.
 */
export class TestClient {
  readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];
  /** Never cleared, so a later test can audit everything an earlier one provoked. */
  readonly history: ServerMessage[] = [];
  #waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  closed = false;

  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString('utf8')) as ServerMessage;
      this.received.push(msg);
      this.history.push(msg);
for (const w of [...this.#waiters]) {
        if (w.match(msg)) {
          this.#waiters = this.#waiters.filter((x) => x !== w);
          w.resolve(msg);
        }
      }
      for (const t of [...this.#tickers]) t(msg);
    });
    this.socket.on('close', () => {
      this.closed = true;
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const c = new TestClient(url);
    await new Promise<void>((resolve, reject) => {
      c.socket.once('open', () => resolve());
      c.socket.once('error', reject);
    });
    // The server deliberately sends NOTHING on connect: an anonymous socket is not
    // a session, and granting one would mean every TCP probe that completed a
    // handshake walked away with a credential. Readiness is `ping`.
    c.send({ t: 'ping', nonce: 'ready' });
    await c.expect(c.is('pong'), 'pong (socket ready)');
    return c;
  }

  send(msg: unknown): void {
    this.socket.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  /** Send raw bytes, bypassing the encoder — for the hostile-input suite. */
  sendRaw(raw: string | Buffer): void {
    this.socket.send(raw);
  }

  /** Wait for the first message satisfying `match`, including ones already in. */
  async expect<T extends ServerMessage>(
    match: (m: ServerMessage) => m is T,
    label = 'message',
    timeoutMs = 5000,
  ): Promise<T> {
    for (const m of this.received) {
      if (match(m)) return m;
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((w) => w.match !== match);
        reject(
          new Error(
            `timed out waiting for ${label}. saw: ${JSON.stringify(this.received.map((m) => m.t))}`,
          ),
        );
      }, timeoutMs);
      this.#waiters.push({
        match: (m) => match(m),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      });
    });
  }

  is<T extends ServerMessage['t']>(
    t: T,
  ): (m: ServerMessage) => m is Extract<ServerMessage, { t: T }> {
    return (m): m is Extract<ServerMessage, { t: T }> => m.t === t;
  }

  clear(): void {
    this.received.length = 0;
  }

  /** All messages of a type in arrival order, since the last `clear()`. */
  all<T extends ServerMessage['t']>(t: T): readonly Extract<ServerMessage, { t: T }>[] {
    return this.received.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }

  /** All messages of a type over the whole session, ignoring `clear()`. */
  ever<T extends ServerMessage['t']>(t: T): readonly Extract<ServerMessage, { t: T }>[] {
    return this.history.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }

  /** The most recent credential this client was handed. */
  latestSession(): Session {
    const all = this.ever('session:granted');
    const last = all[all.length - 1];
    if (last === undefined) throw new Error('this client was never granted a session');
    return last.session;
  }

  /** The current credential for a given match, which is what `resume` needs. */
  tokenFor(matchId: string): string {
    const all = this.ever('session:granted').filter((m) => m.session.matchId === matchId);
    const last = all[all.length - 1];
    if (last === undefined) throw new Error(`this client has no session for match ${matchId}`);
    return last.session.resumeToken;
  }

  /** The most recent full state this client was sent. */
  latestState(): Extract<ServerMessage, { t: 'match:state' }> {
    const all = this.ever('match:state');
    const last = all[all.length - 1];
    if (last === undefined) throw new Error('this client has received no match:state');
    return last;
  }

  /**
   * Resolve when the NEXT message arrives, whatever it is.
   *
   * Kept because the reconnect and hostile-input suites need to await an arbitrary
   * frame, and because a driver that polls with `sleep(4)` between actions is
   * timing-dependent — it passed four times in a row and then failed on the one run
   * where the module graph was being transformed cold and every `sleep` was shorter
   * than the server's turnaround.
   *
   * NOT how a driver should synchronise. The e2e and winnability drivers wait on the
   * room's `viewId` instead, because "a message arrived" is not the same as "my
   * action was applied": the room's reply is a `match:state` and possibly a
   * `match:events`, so consuming one message can consume the PREVIOUS action's
   * events. See the header of `e2e.test.ts`.
   */
  next(timeoutMs = 10_000): Promise<ServerMessage> {
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#tickers = this.#tickers.filter((t) => t !== onMessage);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for a message`));
      }, timeoutMs);
      const onMessage = (m: ServerMessage): void => {
        clearTimeout(timer);
        this.#tickers = this.#tickers.filter((t) => t !== onMessage);
        resolve(m);
      };
      this.#tickers.push(onMessage);
    });
  }

  #tickers: ((m: ServerMessage) => void)[] = [];

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.socket.once('close', () => resolve());
      this.socket.close();
    });
  }
}

// ─────────────────────────── scripted play ───────────────────────────

/**
 * A short digest of any value.
 *
 * Used instead of comparing state objects directly in assertions, for one reason
 * that matters more than it looks: a FAILED `toBe` on a `GameState` prints the
 * whole object — which means the entire ordered Ideology deck, the PRNG cursor and
 * the pending card, in the CI build log, every time the test that exists to prove
 * they never leave the server fails. The test protecting the secret would be the
 * thing that publishes it. Digests compare just as strictly and leak nothing.
 */
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex').slice(0, 16);
}

/**
 * Advance a live match by `plies` committed actions, choosing whichever seat is
 * actually on move each time.
 *
 * Written this way deliberately. A naive `for (i) alternate(a, b)` is wrong,
 * because after an ANSWER the ACTIVE player does not change — the phase moves
 * from `answer` to `actions` with the same seat, and only END_TURN hands over. The
 * naive loop therefore dispatches out of turn, gets refused, and the test then
 * fails for a reason that has nothing to do with what it is testing.
 *
 * Returns the number of actions actually committed, which is asserted against
 * `plies` by the callers so a silent no-op cannot pass.
 */
export async function advance(
  clients: readonly { client: TestClient; playerId: string }[],
  plies: number,
): Promise<number> {
  let done = 0;
  for (let n = 0; n < plies * 4 && done < plies; n += 1) {
    let moved = false;
    for (const { client, playerId } of clients) {
      const view = client.ever('match:state').at(-1);
      if (view === undefined) continue;
      const s = view.state;
      if (s.finished) continue;
      if (s.activePlayer !== playerId) continue;
      const action: Action | null =
        s.phase === 'answer' ? { type: 'ANSWER', side: 0 } : s.phase === 'actions' ? { type: 'END_TURN' } : null;
      if (action === null) continue;

      client.clear();
      client.send({ t: 'match:action', action });
      const before = client.ever('match:state').length;
      await new Promise((r) => setTimeout(r, 25));
      const after = client.ever('match:state').length;
      if (after > before) {
        done += 1;
        moved = true;
        break;
      }
    }
    if (!moved && n > plies * 2) break;
  }
  return done;
}
