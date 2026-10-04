/**
 * THE RESPONSE WINDOW, DERIVED. Everything this file computes is a projection of
 * what the server sent, and nothing in it is a decision.
 *
 * ─────────────────────────── WHAT THE WINDOW IS ───────────────────────────
 *
 * `GameState.interrupt` is a nullable field, NOT a `Phase`, and the reason is in
 * `packages/engine/src/state.ts` (`InterruptWindow`): the server decides whether a
 * player may see their Conspiracy hand by testing
 * `phase === 'actions' || 'answer'` (`packages/server/src/broadcast.ts`), so a new
 * phase member would black out every hand — including the hand of the player who is
 * supposed to be holding the BLOCK — for exactly as long as the window is open.
 *
 * So the game has not stopped. One card's resolution is being argued about, and the
 * phase keeps saying which phase of PLAY it is. That is what this client renders: a
 * suspension inside a phase, never a new screen and never a frozen table.
 *
 * ─────────────────────────── THE ANTI-STALL ARGUMENT ───────────────────────────
 *
 * The window closes on the first answer, or when every player it is waiting on has
 * declined. The set it waits on is derived here from the state on every call and is
 * never stored, mirroring `reduce.ts:mustRespond` exactly:
 *
 *     turnOrder MINUS the actor MINUS anybody with a pending `PendingChoice`
 *
 * The exclusions are the two that matter. The actor played the card, so the engine
 * refuses them a decline ("you played that card") — and a player owed a decision
 * cannot act at all, so making them decline would be holding the table hostage to a
 * card's mid-resolution question. What is left is at most `n - 1` players, and
 * **every one of them can decline**, so a window is always closable in at most
 * `n - 1` presses. That is the whole reason this client exists: without a decline
 * control on every seat, a real table would wait for ever.
 *
 * ─────────────────────────── WHAT IS NEVER GUESSED ───────────────────────────
 *
 * Three things this client does not know and does not pretend to:
 *
 *   1. WHO may respond. `InterruptWindow` deliberately has no `responders` list and
 *      no list of reactive-card holders, because a Conspiracy hand is hidden and
 *      such a field would answer "who is holding a Block" for the whole table. So
 *      the decline control is offered to EVERY required seat, whether or not that
 *      seat holds anything playable, and the copy says so.
 *   2. WHAT is in a player's hand. `playerView` blanks every player's
 *      `conspiracies`, the viewer's own included. This client therefore cannot
 *      enumerate a BLOCK or a DEFLECT to play, and does not.
 *   3. THE PRINTED TEXT of the card under response. The card has been played and
 *      discarded by the time any client can see the window, so its NAME is in the
 *      public log and its EFFECTS are in `InterruptWindow.effects` — but the
 *      players' own printed wording is not in the wire view at all, exactly as
 *      `HeadlineDialog` already reports for a Headline.
 *
 * So the effect list is rendered as this client's own plain description of the
 * server's structured effect data, and an effect it has no words for is SAID to be
 * an effect it has no words for rather than paraphrased into a plausible lie.
 */

import type {
  ClientState,
  ComputedCount,
  ComputedSource,
  Count,
  Effect,
  EffectDuration,
  EffectTarget,
  InterruptWindow,
  LogEntry,
  PlayerID,
  RestrictionKind,
} from '@shasn/engine';

import { deltaText } from './derive.ts';

// ─────────────────────────── the stages ───────────────────────────

/**
 * Which stage the window is in.
 *
 * `'open'` is the ordinary one: effects staged, nobody answered, every required seat
 * may still decline or answer.
 *
 * `'answered'` exists because the field is a value, not an event. `reduce.ts` nulls
 * `interrupt` in the same `closeInterrupt` call that logs the outcome, so a
 * `responder` is never set in a state a real client receives — but the type allows
 * it, a replay model can carry a persisted one, and a future engine change could
 * settle a window without nulling it. Rendering that case as "still open, still
 * yours to decline" would offer a decline for a card that has already been answered,
 * which the engine refuses, so the two stages are distinguished here rather than
 * assumed identical. It costs one comparison and it is the difference between a
 * panel that is right in both states and one that is right in the state that
 * happens today.
 */
export type WindowStage = 'open' | 'answered';

export function windowStage(w: InterruptWindow): WindowStage {
  return w.responder !== null ? 'answered' : 'open';
}

/**
 * How the window ENDED, for the answered stage. `null` while it is still open.
 *
 * A BLOCK wins outright ("cannot be reversed or deflected"), so it is checked first;
 * otherwise a DEFLECT named a player the whole effect list now resolves for.
 */
export type WindowOutcome =
  | { readonly kind: 'blocked' }
  | { readonly kind: 'deflected'; readonly to: PlayerID }
  | { readonly kind: 'unanswered' };

export function windowOutcome(w: InterruptWindow): WindowOutcome {
  if (w.blocked) return { kind: 'blocked' };
  if (w.deflectedTo !== null) return { kind: 'deflected', to: w.deflectedTo };
  return { kind: 'unanswered' };
}

// ─────────────────────────── who the window is waiting on ───────────────────────────

/**
 * Everybody the window is waiting on: `turnOrder` minus the actor minus anybody the
 * engine has frozen with a `PendingChoice`.
 *
 * A transcription of `reduce.ts:mustRespond`, and it has to be exact in both
 * directions. Offering a decline to the actor produces a control the engine refuses
 * with "you played that card"; withholding one from a frozen player would leave the
 * table waiting on somebody who cannot move. Both are the same defect — a control
 * that lies about the game's state — so the mirror is one expression, in the
 * engine's order, and `interrupt.test.ts` pins it.
 */
export function mustRespond(state: ClientState, w: InterruptWindow): readonly PlayerID[] {
  return state.turnOrder.filter(
    (p) => p !== w.actor && !state.choices.some((c) => c.player === p),
  );
}

/** Who has still to decline. The set shrinks monotonically and never re-grows. */
export function outstanding(state: ClientState, w: InterruptWindow): readonly PlayerID[] {
  return mustRespond(state, w).filter((p) => !w.passed.includes(p));
}

/** Has this player already declined? Read from the server's own list, not remembered. */
export function hasPassed(w: InterruptWindow, player: PlayerID | null): boolean {
  return player !== null && w.passed.includes(player);
}

// ─────────────────────────── the seat's part in the window ───────────────────────────

/**
 * What this client may show the viewer, which is a property of the SEAT and not of
 * the hand — the hand is invisible, so nothing here may depend on it.
 *
 *  - `decliner`  a seated player the window is waiting on. The only role that gets a
 *                control. The copy must work whether or not they hold a reactive
 *                card, because the client cannot know and must not pretend.
 *  - `declined`  they have already declined. The window is still open and they are
 *                waiting on other people; they get a status, never a second
 *                control, because the engine refuses a second decline outright.
 *  - `actor`     they played the card under response. Their own answer is still owed
 *                and will be owed the moment the window closes.
 *  - `frozen`    they owe a `PendingChoice`. The engine exempts them from the window
 *                and keeps `RESOLVE_CHOICE` legal, so a decision of theirs outranks
 *                this one and this panel must not compete for the viewport.
 *  - `spectator` not seated. They see that a window is open and cannot act.
 */
export type WindowRole =
  | 'decliner'
  | 'declined'
  | 'actor'
  | 'frozen'
  | 'spectator'
  | 'absent';

export function windowRole(
  state: ClientState,
  w: InterruptWindow,
  you: PlayerID | null,
  isSpectator: boolean,
): WindowRole {
  if (isSpectator || you === null || state.players[you] === undefined) return 'spectator';
  if (you === w.actor) return 'actor';
  if (state.choices.some((c) => c.player === you)) return 'frozen';
  if (w.passed.includes(you)) return 'declined';
  if (mustRespond(state, w).includes(you)) return 'decliner';
  return 'absent';
}

/** Only `decliner` gets the control, and only while the window is still open. */
export function mayDecline(
  state: ClientState,
  w: InterruptWindow,
  you: PlayerID | null,
  isSpectator: boolean,
): boolean {
  return (
    windowStage(w) === 'open' && windowRole(state, w, you, isSpectator) === 'decliner'
  );
}

// ─────────────────────────── the card under response ───────────────────────────

/**
 * The printed NAME of the card under response, from the PUBLIC LOG, or `null`.
 *
 * `reduce.ts` opens the window inside the same action that logs the play — one
 * `Played "NAME".` for a Conspiracy, one `HEADLINE — NAME` for a Headline — so the
 * name is already in `ClientState.log` for every player and the panel can print it
 * without a card index this client does not have and must not be given.
 *
 * The window's own `cardId` is deliberately NOT matched against the log text, and a
 * card id is never rendered as text: it is a database key, and a player reading
 * "cs-0042" on a card is reading a debug artefact as though it were the card. The
 * lookup is the most recent `kind === 'card'` entry by the window's own actor, which
 * is the play that opened it, because the log is append-only and that action wrote
 * it last.
 *
 * `null` is a real answer, not a failure: a payload whose log was trimmed, or a
 * window restored from a replay model with no log, gets honest generic copy rather
 * than an invented name.
 */
export function stagedCardName(
  log: readonly LogEntry[],
  actor: PlayerID,
): string | null {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const e = log[i];
    if (e !== undefined && e.kind === 'card' && e.player === actor) return e.text;
  }
  return null;
}

/** A one-clause name for the card, or the honest generic. */
export function stagedCardLabel(
  log: readonly LogEntry[],
  w: InterruptWindow,
): string {
  const text = stagedCardName(log, w.actor);
  if (text === null) return w.kind === 'headline' ? 'a Headline' : 'a Conspiracy Card';
  // The log's own sentence is already a readable sentence ("Played \"X\"."), so it
  // is used verbatim rather than re-templated — a second phrasing of the same fact
  // is a second thing to keep in step.
  return text.replace(/\.$/, '');
}

// ─────────────────────────── the staged effects ───────────────────────────

/**
 * `Readonly<Record<EffectTarget, string>>` IS one of the three totality proofs, and
 * it is the strongest of the three because the language enforces it: a new
 * `EffectTarget` member is a compile error at this literal with no `never` and no
 * discipline required. `chosen-player` is here because it is a real target a player
 * must be able to predict — a card that will hit somebody the caster names is a
 * threat everybody at the table has to be able to read off the window.
 *
 * **AND IT DID NOT CHANGE FOR G1, WHICH IS WORTH SAYING.** The tenth `Effect` OP
 * (`'move-peg'`) came with no new TARGET — `move-peg`'s target field is the same six
 * members — so this record was already total and compiled untouched. The union that
 * grew is the OP union, which the language cannot pin this way (a `switch` ending in
 * `default` satisfies any closed union), so that one is guarded by the switch below
 * plus `interrupt.test.ts`'s diff against `cards.ts`'s own source. Two proofs over one
 * union, of different strengths, and neither covers the other's gap.
 */
const TARGET_TEXT: Readonly<Record<EffectTarget, string>> = {
  you: '',
  'each-opponent': ' · each opponent',
  everyone: ' · everyone',
  leader: ' · whoever holds the most majorities',
  'chosen-player': ' · a player you name',
  'player-after': ' · the player after you',
};

const COMPUTED_TEXT: Readonly<Record<ComputedSource, string>> = {
  'your-pool': 'as many as you hold',
  'ideologue-level': 'one per Ideology level you have reached',
  'your-gerrymander-rights': 'one per Gerrymander you have left this turn',
  'volatile-voters': 'one per voter you hold in a Volatile Area',
  'held-of-each-resource': 'for each you already hold',
  // A computed count read off `GameState.revealedCards` — the cards a player
  // turned face up during the current resolution. The map is exhaustive by TYPE,
  // which is the point of it: a new `ComputedSource` in the engine stops
  // compiling here rather than falling through to "a number this client cannot
  // compute" on a live card.
  'revealed-card': 'one per card you have revealed face up',
};

/**
 * Which draw pile a `reveal` takes off, in the words a table uses.
 *
 * Exhaustive by type off the engine's `Effect['kind']`, and singular because it
 * qualifies a noun the sentence supplies the number for: `Turn 1 Conspiracy Card
 * face up`, not `Turn 1 Conspiracy Cards`.
 */
const PILE_TEXT: Readonly<Record<'ideology' | 'voter' | 'conspiracy' | 'headline', string>> = {
  ideology: 'Ideology Card',
  voter: 'Voter Card',
  conspiracy: 'Conspiracy Card',
  headline: 'Headline Card',
};

const DURATION_TEXT: Readonly<Record<EffectDuration, string>> = {
  'this-turn': 'this turn',
  round: 'for this round',
  'next-turn': 'from your next turn',
  'rest-of-game': 'for the rest of the game',
};

/**
 * READ `target` OFF AN `Effect`, WHICH IS A UNION AND NOT EVERY MEMBER HAS ONE.
 *
 * The engine owns `Effect`, and `EffectTarget` is its vocabulary. Rather than
 * widen the engine's type from a client that does not own it, the read is made
 * once, here, through a cast that is checked against the engine's OWN target
 * type: if `cards.ts` ever changes what `target` can be, `TARGET_TEXT` stops
 * compiling and the failure lands on this file — which is the right place for it
 * to land, because this is the only place in the client that prints one.
 *
 * `'target' in e` is not used for this: the field is OPTIONAL on the members that
 * carry it, so `in` narrows to nothing useful and the property access still
 * errors. A `'refresh-market'` genuinely has no target, and the honest answer for
 * it is the empty clause — which is what `undefined` becomes.
 */
function effectTarget(e: Effect): EffectTarget | undefined {
  return (e as { readonly target?: EffectTarget }).target;
}

/** The `n` of an effect, printed. A computed `n` says what it is read from. */
function countText(n: Count): string {
  if (typeof n === 'number') return String(n);
  if (typeof n === 'object' && n !== null && 'of' in n) {
    return COMPUTED_TEXT[n.of as ComputedSource] ?? 'a number this client cannot compute';
  }
  return 'a number this client cannot compute';
}

/** The `per` multiplier, printed, or `null` when there is not one. */
function perText(per: ComputedCount | undefined): string | null {
  if (per === undefined) return null;
  return COMPUTED_TEXT[per.of] ?? null;
}

/**
 * ONE SENTENCE PER `restrict` KIND, and this helper exists because the bug was a
 * ternary.
 *
 * `Effect.op === 'restrict'` carries FIVE kinds (`packages/engine/src/cards.ts`),
 * and they are five different rules about five different subsystems: a purchase
 * gate, a purchase price, the Ideologue Power ladder, the answer payout and the p28
 * passive, and the voters a later card will yield. A two-armed ternary that names
 * one of them and sends the other four to the purchase-price sentence is not an
 * omission — it is four FALSE sentences printed in the one panel whose entire job
 * is to tell the table what is about to happen to them before it happens. A player
 * deciding whether to spend a BLOCK was told a power lock-out was a purchase tax.
 *
 * So the shape is a `switch` over all five members, each with its own wording, and
 * `RestrictionKind` is a closed union, so the compiler enforces that a sixth kind
 * lands here. `interrupt.test.ts` derives the op list from the engine's own source,
 * so a new kind also fails that suite at the level of the SENTENCE rather than only
 * at the level of the type.
 *
 * `voter-shortfall` reads BOTH numbers and they are not interchangeable: `value` is
 * how many voters EACH of the next `owed` cards yields less, and `owed` is how many
 * CARDS that is (the engine's own field docs argue this; see `'voter-shortfall'` in
 * `state.ts`). Printing the wrong one of the pair is the same defect as printing the
 * surcharge for a power lock-out.
 */
function restrictText(
  kind: RestrictionKind,
  value: number,
  owed: number | undefined,
  target: string,
): string {
  switch (kind) {
    case 'no-purchases':
      return `The named player may not purchase until they donate${target}`;
    case 'surcharge':
      return `Every purchase costs ${value} more${target}`;
    case 'no-power':
      return `The named player cannot use an Ideologue Power${target}`;
    case 'no-income':
      return `The named player gains nothing: no answer payout and no passive bonus${target}`;
    case 'voter-shortfall': {
      const cards = owed ?? 1;
      const clause =
        cards === 1
          ? 'The next Voter Card they influence gives'
          : `The next ${cards} Voter Cards they influence give`;
      return `${clause} ${value} fewer${target}`;
    }
    default:
      return 'a restriction this client has no words for';
  }
}

/**
 * ONE staged effect, in this client's own words.
 *
 * The printed card text is not in the wire view, so this is a description of the
 * server's STRUCTURED effect — the same numbers the engine is about to apply, from
 * the same payload, rather than from anything this client remembers or invents.
 *
 * EVERY `Effect` OP IS HANDLED, and that is a second totality proof alongside the
 * compiler's. `Effect` is a closed union, so TypeScript is satisfied by any switch
 * that ends in `default` — including one that handles nothing. That is exactly the
 * shape that shipped a `restrict` arm naming one of five kinds: the type was total,
 * the WORDS were not. So the `default` below is reserved for an op this client has
 * never heard of (a future engine, or a state hand-built by something else), and
 * `interrupt.test.ts` re-derives the op list from the engine's own source and fails
 * if any op of this union reaches it.
 */
export function describeEffect(e: Effect): string {
  const named = effectTarget(e);
  const target = named === undefined ? '' : TARGET_TEXT[named];
  const per = 'per' in e ? perText(e.per) : null;
  const scaled = per === null ? '' : `, ${per}`;

  switch (e.op) {
    case 'gain':
      return `Take ${deltaText(e.res)}${scaled}${target}`;
    case 'lose':
      return `Pay ${deltaText(e.res)}${scaled}${target}`;
    case 'gain-any':
      return `Take ${countText(e.n)} resources of your choice${target}`;
    case 'lose-any':
      return `Pay ${countText(e.n)} resources of your choice${target}`;
    case 'steal-any':
      return `Take ${countText(e.n)} from each opponent${target}`;
    case 'voters':
      return `Gain ${countText(e.n)} voters to place${target}`;
    case 'evict':
      return `Send ${countText(e.n)} voters back to their owners${target}`;
    case 'discard-voter':
      return `Discard ${countText(e.n)} voters from the board${target}`;
    case 'convert-voter':
      return `Convert ${countText(e.n)} opponents' voters${target}`;
    case 'gerrymander':
      return `${countText(e.n)} extra Gerrymander moves this turn${target}`;
    case 'draw-conspiracy':
      return `Draw ${countText(e.n)} Conspiracy Card${e.n === 1 ? '' : 's'}${
        e.from === 'discard' ? ' from the discard pile' : ''
      }${target}`;
    case 'refresh-market':
      return 'Discard every face-up Voter Card and deal three fresh ones';
    case 'reveal':
      /*
        A REVEAL turns the top of a draw pile FACE UP, which is the whole of what
        makes it publishable (see `GameState.revealedCards` in the engine): the
        table sees the card, not the pile. So the sentence says the deck and says
        "face up", and it never says the pile is being shown — the one wording
        `staleWording.test.tsx` and §2bis would both object to.
      */
      return `Turn ${countText(e.n)} ${PILE_TEXT[e.kind]} face up${target}`;
    case 'restrict':
      return restrictText(e.kind, e.value, e.owed, target);
    case 'discount':
      return `${countText(e.n)} purchases cost nothing this turn${target}`;
    case 'set-cap':
      return `Their resource cap becomes ${e.to}${target}`;
    case 'move-card':
      // Copy discipline, and it is load-bearing rather than stylistic:
      // `staleWording.test.tsx` bans "face down" in every non-test source file,
      // because under full information a phrase about an unseen card is a stale
      // concealment claim. A moved card IS held in a hand, so the tempting wording
      // is exactly the banned one. What the table can actually ACT on is not the
      // hand, it is the consequence: an extra card somebody will be asked to answer,
      // in place of the draw they would otherwise have got (`cards.ts`, G20).
      return e.to === 'destroy'
        ? `${countText(e.n)} Ideology Card${e.n === 1 ? '' : 's'} removed from the game`
        : `${countText(e.n)} extra Ideology Card${e.n === 1 ? '' : 's'} — answered in place of that player's next draw`;
case 'borrow-power':
      // `target` is REQUIRED here and `'chosen-player'` is the only legal value
      // (cards.ts), so it is stated in the sentence rather than appended: this is the
      // one op whose target is part of what it DOES rather than who it hits.
      return 'Use every Level 3 Ideologue Power a player you name holds, once each';
    case 'move-peg': {
      // G1. THE TENTH OP, and the sentence has to name BOTH halves because the panel
      // is the last thing a table reads before it happens: "move a voter" reads as a
      // mat operation, and this is a RELOCATION between two areas of the board, which
      // is a different thing to every player at the table.
      //
      // Pluralised off `count` rather than hardcoded because `move-peg` is a `Count`,
      // not a literal 1, and a sentence that said "voters" for a one-voter move would
      // be the same small untrustworthiness `choiceHeadline`'s `res()` helper exists to
      // stop. It is 1 for every recovered card — the corpus validator refuses a
      // `move-peg` whose `n` is not 1 — so the singular is the one that ships.
      const n = countText(e.n);
      return `Move ${n} ${n === '1' ? 'voter' : 'voters'} to an empty area in an adjacent constituency${target}`;
    }
    default:
      return 'an effect this client has no words for';
  }
}

/**
 * The staged effect list, plus the lifetime clause, as lines.
 *
 * A lasting clause matters more here than anywhere else in the UI: a card whose
 * effect is not one shot stays in force after the window closes, so "this turn" and
 * "for the rest of the game" are the difference between a temporary inconvenience
 * and a permanent one. It is printed with the effects rather than left to the log,
 * because the whole point of the window is deciding whether to let this happen.
 */
export function describeEffects(effects: readonly Effect[], duration: EffectDuration): readonly string[] {
  const lines = effects.map(describeEffect);
  if (duration !== 'this-turn') lines.push(`Lasts ${DURATION_TEXT[duration]}`);
  return lines;
}

// ─────────────────────────── the announcement ───────────────────────────

/**
 * The polite live-region sentence for an open window.
 *
 * ONE live region exists in this shell and it is the board's (§8.5: state changes
 * with no focus target announce there). So the window is announced by EXTENDING
 * that sentence rather than by mounting a second live region beside the panel —
 * two polite regions describing the same event is a double announcement on every
 * screen reader, which is a worse failure than a slightly late one.
 *
 * The sentence names the actor and says a response is possible, and it never says
 * who holds a reactive card: the state does not know, and neither may the copy.
 */
export function windowLiveMessage(state: ClientState, w: InterruptWindow): string {
  const who = state.players[w.actor]?.name ?? 'Someone';
  if (windowStage(w) === 'answered') {
    return `${windowOutcomeSentence(w)} ${who}'s card has been answered.`;
  }
  return `${who} has played a card and it is being answered. The table may respond, and the card resolves once everyone has declined.`;
}

/** One clause for how a window ended. `null` while it has not. */
export function windowOutcomeSentence(w: InterruptWindow): string | null {
  const o = windowOutcome(w);
  switch (o.kind) {
    case 'blocked':
      return 'Blocked — the card does not resolve at all.';
    case 'deflected':
      return 'Deflected — the card resolves for a different player instead.';
    case 'unanswered':
      return null;
  }
}
