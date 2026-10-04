/**
 * HOW MANY RECOVERED CARDS CAN ACTUALLY BE PLAYED?
 *
 * `npm run validate` answers a weaker question: is this card well-formed? It says
 * nothing about whether a player can reach a position from which the card resolves.
 * That gap is not academic -- a card that passes every validator and then sits in a
 * hand because the engine refuses it at `reduce()` is exactly the "card that lies"
 * `src/executable.ts` exists to prevent, one layer further out.
 *
 * So this script takes the ~50 recovered real cards from `decks/SOURCES.md` §4 and,
 * for each one, writes the LARGEST honest effect list today's vocabulary can carry
 * (`reduction`) and then PLAYS it through the real reducer. A card counts as playable
 * only if `reduce()` accepts it and the resulting state differs from the opening
 * position in the way the card says.
 *
 * `reduction: null` means no expressible effect list exists at all -- there is no op
 * for any part of the card, so there is nothing to play. Those are counted separately
 * from cards whose reduction the reducer REFUSES, because they are different
 * failures and they need different engine work.
 *
 * ## THE HEADLINE IS A CONJUNCTION, AND IT USED NOT TO BE
 *
 * `reduction` above is the probe's OWN, written from the REF text. It is not read out
 * of a deck file, because a card's capability is a property of the SCHEMA and the
 * schema does not care whether anybody filed the card yet. That is a real measurement
 * and it is worth keeping -- but reading it as "this card ships and works" is a
 * different claim, and an audit found this script making it: seven rows asserted that
 * a card shipped a clause when the card was in no deck file at all, and three rows
 * played something other than what the deck file ships (one of them with no note, so
 * the divergence was entirely undisclosed). Every gap ruling argued from the number
 * inherited the error.
 *
 * So each row now answers THREE questions and the report never collapses them:
 *
 *  1. **EXPRESSIBLE** -- a reduction exists and `reduce()` plays it, moving the state.
 *     "The schema can carry something like this card."
 *  2. **IN THE CORPUS** -- the card is in a deck file on disk, reported with its
 *     `decks/<deck>/<kind>.json:<line>`. "A table can draw this card."
 *  3. **SHIPPED AS AUTHORED** -- the deck file's own `effects` are what the probe
 *     played, field for field, with any divergence named. "The thing that ships is the
 *     thing that was measured."
 *
 * The headline counts **EXPRESSIBLE and IN THE CORPUS**, and says so in its own
 * output. A card nobody has filed cannot be played by anybody, so counting it is the
 * one thing the old number got wrong. The other two tallies are printed next to it
 * rather than instead of it, and the honest reporting LOWERS the headline.
 *
 * The whole point is that `playable` is computed by calling `reduce()`, not by asking
 * the validator. Read the per-gap table at the bottom as the handoff.
 *
 * Reads the decks and the engine source. Writes nothing.
 */

import { readFileSync } from 'node:fs';

import {
  discoverDeckFiles,
  loadConspiracyDeck,
  loadCorpus,
  loadHeadlineDeck,
  toEngineConspiracyCard,
  toEngineHeadlineCard,
  toEngineIdeologyCard,
  toEngineVoterCard,
  type Corpus,
} from '../src/corpus.js';
import { unexecutedEffectProblems, unexecutedCardProblems } from '../src/executable.js';
import { RULES, type CardIndex, type Effect, type Interrupt } from '../src/engine.js';

import { reduce } from '../../engine/src/reduce';
import { setup } from '../../engine/src/setup';
import type { Action } from '../../engine/src/actions';
import type { AreaID, ChoiceScope, GameState, PlayerID, ZoneID } from '../../engine/src/state';

/** Sum of a signed pool. `state.ts` owns it; mirrored here rather than imported as a value. */
const deltaTotal = (d: { funds?: number; clout?: number; media?: number; trust?: number }): number =>
  (d.funds ?? 0) + (d.clout ?? 0) + (d.media ?? 0) + (d.trust ?? 0);

// ─────────────────────────── the 50 recovered cards ───────────────────────────

/**
 * One row per recovered card, from `decks/SOURCES.md` §4.
 *
 * `reduction` is what a corpus owner would write TODAY: the biggest honest subset of
 * the card's real text. `gap` is the KNOWN-GAPS id blocking the dropped remainder.
 * Both are hand-authored from the REF text; the PLAYABILITY VERDICT is not -- it is
 * whatever `reduce()` says about the reduction, below.
 *
 * ## WHAT A ROW MAY NOT DO
 *
 * A `note` may describe the ENGINE. It may not describe the DECK unless the card is in
 * one: "SHIPS the WHOLE of the printed clause" is a statement about `decks/`, and
 * seven rows used to make it for cards that were in no deck file. The script now reads
 * the decks and refuses such a claim when the card is absent, so a note that says it is
 * a build failure rather than a footnote.
 *
 * And where `reduction` is not the shipped card's own `effects`, the difference must be
 * in the `note`. The script derives that difference structurally -- field by field, off
 * the two lists -- and a row whose divergence is undiscovered is a build failure too,
 * which is what RED BLOODED used to be: a probe of a different card than the one in the
 * deck, with no note at all.
 */
type Probe = {
  readonly name: string;
  readonly ref: string;
  readonly kind: 'conspiracy' | 'headline';
  /** The largest effect list today's vocabulary carries. `null` = no expressible subset. */
  readonly reduction: readonly Effect[] | null;
  /** The gap blocking the rest of the card. */
  readonly gap: string;
  /** Why `reduction` is null, when it is. */
  readonly note?: string;
  /**
   * G13. When set, the card carries this `interrupt` instead of being played for its
   * own effects, and the harness drives the RESPONSE WINDOW: somebody else plays a
   * card, and then this card is played into the open window by `responder`.
   *
   * `played` is the card that goes under response — the one the reactive card acts
   * ON. It is a separate synthetic card, and it is what makes the probe measure the
   * mechanic rather than the reactive card's (empty) effect list.
   */
  readonly interrupt?: Interrupt;
  /** The seat holding the reactive card, and where a DEFLECT is pointed. */
  readonly responder?: PlayerID;
  readonly at?: PlayerID;
  /** The card played first, for `block` and `deflect`. Defaults to a fixed payout. */
  readonly played?: { readonly name: string; readonly effects: readonly Effect[] };
};

/** The card the response-window probes put on the table. A plain, visible payout. */
const UNDER_RESPONSE: { readonly name: string; readonly effects: readonly Effect[] } = {
  name: 'The card under response',
  effects: [{ op: 'gain', res: { funds: 3 } }],
};

const PROBES: readonly Probe[] = [
  // ── Earth 2040 Conspiracy Cards, REF §4.2.1 ────────────────────────────────
  { name: 'A Grave Inheritance', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'steal-any', n: 2, target: 'each-opponent' }], gap: 'G2', note: 'PROBE IS WIDER THAN THE DECK FILE, and the difference was undisclosed until the probe started reading the decks. ct-et2040-001 writes `steal-any` n2 with NO target and then a SECOND effect, `evict` n2 — a theft from one chosen victim plus 2 evictions. The reduction above is the single widest reading of the same clause, stealing 2 from EVERY opponent and evicting nobody, which is the capability being measured and is strictly stronger than what is on disk. Not the same card' },
  { name: 'Block', ref: '4.2.1', kind: 'conspiracy', reduction: [], gap: 'G13', interrupt: { op: 'block', window: 'always', target: 'any-card' }, responder: 'p2', note: 'the REACTIVE half, and it is the half the product replays: BLOCK is played out of turn into the response window and cancels the card under response, including a lasting clause. Dropped: the alternative "Discard an open Conspiracy Card or Headline Card", which needs a discard-the-top op that no recovered card needs. DIVERGENT FROM THE DECK FILE: ct-et2040-014 also writes `gain` res clout 1 after the interrupt, omitted here because the interrupt is what is under measurement and its empty effect list is what `RESPOND_INTERRUPT` reads' },
  { name: 'Cut, Copy, and Paste', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'discard-voter', n: 2, target: 'you', zone: 'chosen-zone' }], gap: 'G22', note: 'SHIPS the FIRST TURN as `ct-et2040-016`: "select 1 of your majorities. Discard all your voters in that zone" becomes "select one constituency, discard 2 of your voters from it". G16 landed: `zone: chosen-zone` raises a `choose-zone` decision, and only when a constituency holding a voter of yours exists, so nobody is ever frozen by one. DROPPED, each named: the second turn entirely (the "if any empty area is left at the start of your next turn" clause is a standing effect with a board-state condition, G22/G15); "1 of your MAJORITIES" (the selector offers any constituency holding a voter of yours, which is the ONE clause this card is WIDER on); and "all your voters" as a count, since the discard needs a number' },
  { name: 'Deep Thoughts', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'borrow-power', target: 'chosen-player' }], gap: 'G14a', note: "NOT IN THE CORPUS: no card of this name is in any deck file, so nothing below is a claim about the game — it is a measurement of the vocabulary, and this row is one of the cards the old headline counted. ON THE VOCABULARY the WHOLE of the printed clause is expressible on `borrow-power`: REF 4.2.1 reads \"Select an opponent and use all their Level 3 Ideologue Powers this turn\", and the op raises the existing 'choose-player' decision for the card's OWN actor (so the opponent is named, not guessed), writes a public 'borrowed-powers' rule on the CASTER naming the DONOR, and powers.ts `usesLeft` — the single function every POWER_ case in reduce() already asks — counts the donor's Level 3 manifesto. DROPPED, one clause: \"You cannot use the same Ideologue Power twice\", which needs a per-power use counter and there is no counter on a borrowed power. Level 5 is NOT expressible and deliberately so: all four Level 3 powers are read in `usesLeft` and Election Fever is not, so a Level 5 borrow would be a power available in one code path and not another" },
  { name: 'Deflect', ref: '4.2.1', kind: 'conspiracy', reduction: [], gap: 'G13', interrupt: { op: 'deflect', window: 'always', target: 'any-card' }, responder: 'p2', at: 'p3', note: 'the REACTIVE half: DEFLECT redirects the card under response onto a third player. Two named deviations, both on the type: it redirects the WHOLE resolution rather than "only that partial effect" on the defender (applyEffect computes one target for the effect list, so per-effect granularity is G20), and it ships target: any-card rather than card-affecting-you because "a card that affects YOU" needs a decision over players, which is G1. DIVERGENT FROM THE DECK FILE: ct-et2040-015 also writes `gain` res trust 1 after the interrupt, omitted here for the same reason as BLOCK — the interrupt is what is under measurement' },
  { name: 'Eradicating Germs', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'refresh-market', until: 'rest-of-game' }], gap: 'G3', note: 'the RECURRING obligation — "discard an open Voter Card every turn (mandatory)" — is now installed as a standing live effect and re-applied at the top of every one of your turns; the per-card reward is dropped. DIVERGENT FROM THE DECK FILE, and in the OPPOSITE direction: ct-et2040-002 drops the recurring obligation instead and writes `refresh-market` with no effect-level `until` (so it is one-shot, the card\'s default duration) plus a `gain-any` n1 the reduction above does not carry. The probe measures the half the engine can express and the deck file measures the half it can' },
  { name: 'Holo Sapiens', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'move-card', from: 'draw', to: 'hand', n: 1, target: 'you' }], gap: 'G15/G17', note: 'SHIPS on "this is an extra Ideology Card" alone — the card\'s whole identity. DROPPED for three NAMED gaps: "of your choice" is G17 (a choice over the draw pile\'s contents, a new Choice kind the client owns); the price an opponent pays is G15\'s `price` field, a computed cost the SELLER reads; re-filing under a different Ideologue is G23, and the expiry-on-purchase clause is G12. THE SAME ARCHETYPE AS JUMLA — REF 4.2.2 says so outright — so this is the Earth 2040 skin of ct-et2040-013 / ct-in2020-011 and the three omissions are identical. NOTE WHAT THE OP IS NOT ALLOWED TO REACH: not from the Ideology DISCARD pile, because a discard-pile Ideology Card has been answered and p13 makes that face up under its owner\'s mat, so handing one over blind would publish the answer instead of concealing it' },
  { name: 'If You Like Pina Colada', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'gain', res: { funds: 1, clout: 1, media: 1, trust: 1 }, per: { of: 'held-of-each-resource' } }], gap: 'G4', note: 'FAITHFUL: a res of 1 in each resource multiplied by what you hold of each IS a doubling of the mat, and the cap still applies on top — the card own second sentence' },
  { name: 'Lab-Grown Earworm', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'steal-any', n: 1, when: 'on-voter-influenced', until: 'rest-of-game' }], gap: 'G1', note: 'NOT IN THE CORPUS: no card of this name is in any deck file, so this is a measurement of the vocabulary and not of the game. NOT FAITHFUL, and named: the chosen-opponent binding is G1, so the hook fires on ANY influence including your own and the thief picks the victim. STRICTLY STRONGER than the printed card — this would need a ruling before it went into a deck file' },
  { name: 'Power Trip', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'discard-voter', n: 1, target: 'each-opponent', when: 'on-voter-influenced', until: 'rest-of-game', condition: { byOwner: true, influencedVotersAtLeast: 3 } }], gap: 'G14', note: 'dropped: "non-majority" — the engine reach here is any peg a victim owns. Otherwise faithful, and slightly WEAKER, because each opponent chooses which of their own' },
  { name: 'Quantum Wristband', ref: '4.2.1', kind: 'conspiracy', reduction: null, gap: 'G13/G14', note: 'auction of 3 headlines, IOU bids' },
  { name: 'Selective Access Memory', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'draw-conspiracy', n: 1, from: 'discard', pick: true }], gap: 'none', note: 'WHAT U1 CHANGED: the probe takes the LAST card on the offered list, not the first, and only `pick: true` puts a non-top card within reach — so the pre-U1 reduction would have failed this row and this one passes it. That is the whole measurement, and it is a claim about a CLAUSE EXECUTING, not about a new playable card: the tally is 40 -> 40, because this card already reported PLAYED at HEAD via deterministic top-of-pile. The gap tag moving G17 -> none is likewise the probe no longer finding an inexpressible clause, NOT a claim that G17 is closed. Shipped as `adapted`, because its clause is paraphrased into schema ops — every clause executing is a different property from its text being reproduced' },
  { name: 'Singularity', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'voters', n: 2 }], gap: 'G6' },
  { name: 'The Greta Effect', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'restrict', kind: 'voter-shortfall', value: 1, owed: 2, target: 'chosen-player' }], gap: 'G14b', note: 'NOT IN THE CORPUS: no card of this name is in any deck file, so this row measures the vocabulary and not the game, and it is one of the rows the old headline counted. WHAT THE VOCABULARY CAN CARRY IS the state-changing half of REF 4.2.1: "They will get 1 less voter on the next 2 Voter Cards that they influence." `value` is the voters lost per card and `owed` is the number of CARDS, which is why `remaining` means something different for this kind than for KHAKI TERROR\'s lock. INFLUENCE subtracts it in one place, AFTER Going Viral — subtracting first would let a Showstopper launder the debuff away by pairing it with their own power — and FLOORS AT ZERO: a 1-Voter Card under a 2-voter shortfall yields nothing and the purchase still succeeds, because a restriction that made the influence ILLEGAL would freeze the table on a card that cannot be unbought. DROPPED, named: "Pick up to 2 opponents" is carried as one (applyEffect computes ONE target for a whole effect list, so a card cannot raise two choose-player decisions in one resolution), and the printed rider "This applies to 2 separate voter cards for 2 different players" is therefore dropped with it — one card, one player' },
  { name: 'The Psychohistorian', ref: '4.2.1', kind: 'conspiracy', reduction: [{ op: 'draw-conspiracy', n: 2 }], gap: 'G7/G19', note: 'A DIFFERENT CARD from the one on disk, and undisclosed until the probe started reading the decks. ct-et2040-004 writes `voters` n1 then `gain-any` n2 — REF\'s first branch, "get 1 voter (not card) and any 2 resources". The reduction above is the OTHER branch, `draw-conspiracy` n2, which is G17/G19 and is not what the deck file says the card does. The row stays because the two branches need different engine work and collapsing them would hide one' },
  { name: 'Thoughts and Prayers', ref: '4.2.1', kind: 'conspiracy', reduction: null, gap: 'G4', note: '"for EACH of THEIR voters" needs the read and the payout aimed at different players; there is no field that separates them' },


  // ── India Conspiracy Cards, REF §4.2.2 ───────────────────────────────────
  { name: 'Chai-Paani', ref: '4.2.2', kind: 'conspiracy', reduction: null, gap: 'unknown', note: 'base effect never recovered' },
  { name: 'Jumla', ref: '4.2.2', kind: 'conspiracy', reduction: [{ op: 'move-card', from: 'draw', to: 'hand', n: 1, target: 'you' }], gap: 'G15/G17', note: 'SHIPS as ct-in2020-011 on "this is an extra Ideology Card" alone. DROPPED for NAMED gaps: "of your choice" is G17; the price an opponent pays is G15\'s `price` field; re-filing under a different Ideologue is G23. Same archetype as HOLO SAPIENS per REF 4.2.2 — one template, two campaign skins — so this and Holo Sapiens share a reduction and neither is counted as a new archetype' },
  { name: 'Cult-ivating Obedience', ref: '4.2.2', kind: 'conspiracy', reduction: null, gap: 'G-new/G20', note: 'convert own voters, transfer a card' },

  // ── Headline Cards, all campaigns, REF §4.1 ───────────────────────────────
  { name: 'GREAT LEADER, BAD ECONOMY', ref: '4.1', kind: 'headline', reduction: null, gap: 'G1/G14', note: 'the beneficiary is "the player after you", which is seat-relative; giving it to every opponent instead would be far stronger' },
  { name: 'DOSTI BANI RAHE', ref: '4.1', kind: 'headline', reduction: null, gap: 'G15/G22', note: '"in THEIR next turn they may use your rights" needs a turn trigger that fires on a seat other than the owner, and one named opponent' },
  { name: 'KHAKI TERROR', ref: '4.1', kind: 'headline', reduction: [{ op: 'restrict', kind: 'no-purchases', value: 0, owed: 4, owedRes: { funds: 1, clout: 1, media: 1, trust: 1 }, until: 'rest-of-game' }, { op: 'lose', res: { funds: 1, clout: 1, media: 1, trust: 1 } }], gap: 'G10', note: 'THE ORDER IS THE RULING, and it is now `restrict` BEFORE `lose` where the previous row had it the other way round. `creditDonation` only ever sees a loss that is the actor\'s own GIVING (C1: `p === source` in the `lose` case), so with `lose` first there is no restriction on the board yet and the card\'s own donation could never count against its own lock - the audit\'s third divergence. Written in this order the lock is imposed and then discharged by the same donation, which is what the printed two sentences actually mean: "donate 1 of each type ... you cannot purchase until you do so", and you just did. CONSEQUENCE, stated because it is the whole finding: with `owedRes` at 1 per type, one donation discharges the lock for EVERY holding - a type the player holds none of is waived by `held === 0` - so this reduction is a pure donation and the lock never outlives its own resolution. That is why `hl-in2020-007` already ships the `lose` alone and names the lock as dropped, and why the lock clause is G10 (a token pile that sits ON the card until you choose to hand it over) rather than anything the vocabulary can reach. DROPPED, named: the real card\'s deferral, which is the card\'s whole punchline - its four tokens sit on the card and the discard only happens when all four are donated, so the real lock lasts until a LATER donation and this one lasts not at all' },
  { name: 'GROWING DISSENT', ref: '4.1', kind: 'headline', reduction: [{ op: 'voters', n: 1, when: 'on-gerrymander', until: 'round', condition: { movedMyVoter: true } }], gap: 'G9/G14', note: 'FAITHFUL: "starting this turn, for 1 round" is the round lifetime, and movedMyVoter is "any opponent Gerrymanders your voters". Dropped: "gained voters are placed immediately" — the engine grants them to your mat, so you place them' },

  { name: 'A CALL FROM KARACHI', ref: '4.1', kind: 'headline', reduction: null, gap: 'G13/G17/G20', note: 'auction, deck search, card moving' },
  { name: 'STAY IN YOUR LIMITS', ref: '4.1', kind: 'headline', reduction: [{ op: 'convert-voter', n: 2 }], gap: 'G18/G2', note: 'CANDIDATE, and the finding is that G-new is what unblocked it rather than G18. `convert-voter` with NO target reaches the caster (voterScope returns `others` when chooser === source), so "every player converts 2 voters of the player to their left" is expressible as "YOU convert 2 voters belonging to an opponent" - which is the card conversion without the per-player iteration and without the seat-relative direction. DROPPED, both named: "every player" (only the resolving player acts) and "to their left" (any opponent may be the donor, which is WIDER). The second clause - "each player that doesn\'t break a majority gets 2 resources" - is still G2: no op reads board state to decide a payout' },
  { name: 'Polo Retreat', ref: '4.1', kind: 'headline', reduction: [{ op: 'borrow-power', target: 'chosen-player', until: 'next-turn' }], gap: 'G14a', note: "NOT IN THE CORPUS: no card of this name is in any deck file, so this measures the vocabulary and not the game, and the row was one of the ones the old headline counted. THE REDUCTION is the same borrow as DEEP THOUGHTS across a turn boundary, and `until: 'next-turn'` is the lifetime reading it needs. DROPPED, three clauses, and the first one moves WHO benefits rather than shrinking the effect: \"each OTHER's\" (REF 4.1: \"They can use each other's unlocked Level 3 Ideologue Powers\") — one decision is one donor, so this is \"you may use a named opponent's powers\", not a mutual exchange; \"Pick 2 players\", for the same reason (two decisions in one effect list is not expressible, `applyEffect` computes ONE target for the whole list); and the fallback \"if either of the players don't have any unlocked Level 3 Powers, both players can use any one Level 3 Power of their choice\", which is a power that need not be unlocked at all and is therefore a different mechanism. \"You may pick yourself\" is dropped too, and `resolveChoice` refuses a self-pick rather than the card naming it" },
  { name: 'NEXT BILLION DATA POINTS', ref: '4.1', kind: 'headline', reduction: null, gap: 'G13', note: 'a vote, with no self-votes and a re-vote' },
  { name: 'PYTHONPOST', ref: '4.1', kind: 'headline', reduction: [{ op: 'restrict', kind: 'surcharge', value: 1, target: 'you', until: 'rest-of-game' }], gap: 'G5', note: 'FAITHFUL: a permanent tax on your own purchases. Note the ruling that it stacks ON TOP of a Helping Hands discount rather than being discounted by it — otherwise the Idealist power would erase another player’s card' },
  { name: 'SUBMERGED', ref: '4.1', kind: 'headline', reduction: [{ op: 'gerrymander', n: 1, target: 'everyone' }], gap: 'G9', note: 'the grant is wiped by advanceTurn. NOT IN THE CORPUS: no card of this name is in any deck file, so this measures the vocabulary rather than the game and the old headline should not have counted it — NEW FACE WHO DIS is the filed sibling and it carries no target' },
  { name: 'COUGH IT UP', ref: '4.1', kind: 'headline', reduction: [{ op: 'evict', n: 1, target: 'each-opponent' }], gap: 'G2', note: 'the conditional bonus is dropped' },
  { name: "NERO'S GUESTS", ref: '4.1', kind: 'headline', reduction: [{ op: 'evict', n: 3, target: 'each-opponent', zone: 'this-zone' }], gap: 'G16', note: 'SHIPS as `hl-et2040-017`. `zone: this-zone` is read off `GameState.headlineQueue[0].areaId` — the Volatile Area whose placement drew this Headline — which is exactly REF 4.1\'s own gloss ("this zone" = the volatile zone that triggered it) and needs NO new state field, so `reduce()` stays pure and a replay derives it from what was written down. CAVEAT ON THIS PROBE, stated so the number is not read for more than it is: the harness queues headlines with an EMPTY areaId, so `resolveZone` finds no area and the selector falls back to the whole board — the zone narrowing is proved by `test/g16-zone.test.ts` against a real queue entry, not here. DROPPED: "move" ships as EVICT, strictly WEAKER for everyone affected (an evicted voter returns to its owner\'s Mat and can be influenced again); and the adjacent-zone destination plus the all-or-nothing pairing of the two clauses' },
  { name: 'ON THE "HIGH" SEAS', ref: '4.1', kind: 'headline', reduction: null, gap: 'G11', note: 'hostage object holding 4 pegs' },
  { name: 'A COWARD OR A JOURNALIST?', ref: '4.1', kind: 'headline', reduction: [{ op: 'move-card', from: 'draw', to: 'hand', n: 1, target: 'player-after' }, { op: 'gain-any', n: 6, target: 'player-after' }], gap: 'G12', note: 'NOT IN THE CORPUS: no card of this name is in any deck file, so everything below is a measurement of the vocabulary and NOT a change to the game — nothing here settles G12, and the row is one of the cards the old headline counted. REF 4.1: *"Starting from you, each player can donate 1 of their Ideology Cards to the opponent on their left. They will receive 6 resources of their choice for doing so."* `target: player-after` is ONE index into `GameState.turnOrder` from the actor, wrapping -- and in a clockwise turn order that is exactly "the opponent on their left", so one `EffectTarget` is honest to this card\'s phrasing AND to GREAT LEADER BAD ECONOMY\'s "the player after you" (REF 4.2.1). It raises NO decision: the seat is a pure function of public state, so there is no new `Choice` kind, no satisfiability question and nothing to render. ONE `target` for the whole effect list happens to be exactly right here, because the card goes to the seat on your left AND the 6 resources go to whoever ends up receiving it. DROPPED, four, each named: *"starting from you, EACH player"* is N donations and this is one, because `applyEffect` computes ONE target for the whole list; *"optional"* is dropped (the donation is not a decision); *"you may pass along a card you just received"* is dropped, which is the hand-before-draw path and a hand is a queue its holder cannot enumerate; and the card comes off the Ideology DRAW pile rather than out of the caster\'s HAND, because `from: hand` is refused at the type level for exactly that reason -- see the `move-card` arm in cards.ts' },
  { name: 'BLESSINGS OF PARENTS PAST', ref: '4.1', kind: 'headline', reduction: null, gap: 'G17/G20', note: 'two-player resolution order' },

  // ── Headline Cards, Earth 2040, REF §4.3 ──────────────────────────────────
  { name: '404', ref: '4.3', kind: 'headline', reduction: null, gap: 'G18', note: 'swaps who answers which card' },
  // REF 4.3 reads "Discard 2 of your OWN voters [OR] Donate 1 of your voters to the
  // player to your right". Neither branch is expressible: the first needs a decision
  // that reaches the chooser's own pegs (G-new), the second a directional seat
  // (G18). What the corpus ships as `hl-et2040-003` is the opponents' reading, which
  // `discard-voter` with no target already performs -- so that is probed here, and
  // the reading that does NOT work is recorded as the gap.
  { name: "Ain't No Cure For Love", ref: '4.3', kind: 'headline', reduction: [{ op: 'discard-voter', n: 2, target: 'you' }], gap: 'G1', note: 'G-new is CLOSED, so the FIRST branch now ships the PRINTED clause: `target: "you"` reaches the chooser\'s own pegs (voterScope in reduce.ts passes the RAW target through, so an absent field still means opponents). DROPPED: the OR-branch, which needs a DONATE to a seat-relative neighbour plus a conditional over the whole effect \u2014 G1' },
  { name: 'As Clear As Water', ref: '4.3', kind: 'headline', reduction: [{ op: 'draw-conspiracy', n: 1, target: 'everyone', onlyIfEmpty: true }], gap: 'G20', note: 'SHIPS the only clause with a state change in it: "If any player does not have a Conspiracy Card, they receive 1 from the draw pile (in order of turn)". `onlyIfEmpty` is the condition, and it is a flag rather than a decision because a Conspiracy Card hand is hidden from every viewer including its owner \u2014 reduce() reads a fact no client can see and logs nothing on this path. `target: everyone` is faithful: the caster played a card, so they are holding one and are skipped, unless it was their last. DROPPED, both because a REVEAL has no state consequence in this engine and so nothing to perform: the opening "every player reveals 1 of their Conspiracy Cards" and the trailing "and then reveal it". NOT G17 anymore; the top-up is the only part of this card that moves anything' },
  { name: 'Brave New Worlds', ref: '4.3', kind: 'headline', reduction: null, gap: 'G18', note: 'every player answers, suppressing income' },
  { name: 'Card Games', ref: '4.3', kind: 'headline', reduction: [{ op: 'move-card', from: 'draw', to: 'hand', n: 1, target: 'player-after' }, { op: 'gain-any', n: 6, target: 'player-after' }], gap: 'G12', note: 'NOT IN THE CORPUS: no card of this name is in any deck file either, so this is the same measurement as A COWARD OR A JOURNALIST? and the same caveat — the vocabulary, not the game. THE SAME CARD as A COWARD OR A JOURNALIST? -- REF 4.3 lists it as a re-skin of it, and the two rows here are probed under both names because a duplicate is cheaper to keep visible than to deduplicate by hand. Every clause, dropped or performed, is identical to that row, with ONE addition: REF 4.3 adds *"Can be blocked only at the beginning."* That is a rule about WHEN the response window opens rather than about what happens, and the window that already exists (`GameState.interrupt`, G13) opens for the whole resolution -- so the narrowed timing is dropped and named rather than approximated' },
  { name: "Don't Kiss The Babies", ref: '4.3', kind: 'headline', reduction: [{ op: 'restrict', kind: 'surcharge', value: 1, target: 'you', until: 'next-turn' }], gap: 'G5', note: 'the purchase surcharge, as a restriction rather than a cost modifier. RECONCILED TO THE DECK FILE: the reduction used to say `until: \'rest-of-game\'`, which is what hl-et2040-021 already carried and which is ALSO what PYTHONPOST carries — so the probe was measuring a card nobody has filed and over-taxing for the rest of the game. REF 4.3 reads "All Voter Card costs any 1 extra resource in your next turn", and `next-turn` is both the printed lifetime and the shipped one. This row is now SHIPPED AS AUTHORED' },
  { name: 'Fatality', ref: '4.3', kind: 'headline', reduction: [{ op: 'voters', n: 1, target: 'chosen-player' }], gap: 'G15', note: 'SHIPS as hl-et2040-018: the DONATE to ANY OPPONENT is now performed, because target chosen-player raises the decision for the card own actor. DROPPED, each named: influence an open Voter Card FOR FREE is a purchase the engine cannot grant (G15 price); the voters ships as 1 because the recovered text names no number and inventing one would be a claim the corpus does not support; right away needs an immediately placement' },
  { name: 'Fuelling The News', ref: '4.3', kind: 'headline', reduction: null, gap: 'G17/G20', note: 'draw 3 headlines, keep 1, give 2' },
  { name: 'Gender Trouble', ref: '4.3', kind: 'headline', reduction: [{ op: 'restrict', kind: 'no-power', value: 0, target: 'you', until: 'next-turn' }], gap: 'G1', note: 'SHIPS as `hl-et2040-020`, and G5 is CLOSED for it: `restrict` kind `no-power` is read in powers.ts `usesLeft`, which every POWER_ case in reduce.ts already asks, so the lock is a rule the engine really consults. DROPPED, both named, and BOTH make it weaker rather than stronger: "one of your unlocked Level 3 Ideologue Powers" names ONE power, which is a decision over POWERS and not over players, so no EffectTarget can say it and this takes ALL of them (G1); and the printed "if you do not have a Level 3 Ideologue Power, discard 2 resources in your next turn" is a conditional over the whole effect list, which Effect cannot state. It was held back for three iterations by a corpus gate rather than by the engine - see KNOWN-GAPS.md G5, which records that gate and its removal' },
  { name: 'Good Gig Well Played', ref: '4.3', kind: 'headline', reduction: [{ op: 'draw-conspiracy', n: 1 }], gap: 'G17/G20', note: 'keep-one branch; the discard fallback is dropped' },
  { name: 'Higgs Moron', ref: '4.3', kind: 'headline', reduction: null, gap: 'G10/G12', note: 'tokens on a card, timed pass' },
  { name: 'Just Breathe', ref: '4.3', kind: 'headline', reduction: [{ op: 'evict', n: 2, zone: 'your-strongest' }], gap: 'G16', note: 'SHIPS as `hl-et2040-016`. `zone: your-strongest` is a pure function of the board with ties broken by ZONE_IDS order, so "select the zone where you have the most number of voters" is now PERFORMED rather than approximated. DROPPED, each named: "into an adjacent zone" (a destination is a second decision on top of a source one); "in case of a tie, pick any of the tied zones" (broken deterministically instead, which is a smaller decision rather than a different one); and "move" ships as EVICT, strictly WEAKER for everyone affected because an evicted voter returns to its owner\'s Mat' },
  { name: 'Married With Bits', ref: '4.3', kind: 'headline', reduction: [{ op: 'voters', n: 1, target: 'each-opponent' }], gap: 'G1', note: '2 opponents and the opt-out are dropped' },
  { name: 'Movement Anxiety Disorder', ref: '4.3', kind: 'headline', reduction: [{ op: 'discard-voter', n: 1, target: 'you', when: 'on-gerrymander', until: 'next-turn', condition: { movedMyVoter: true } }], gap: 'G9/G22', note: 'G9 AND G22 ARE BOTH CLOSED, and this probe row understated that: the hook needs nothing either of them did not already do. Dropped, and named: "the next 3" ships as the next ONE, and "the effect only ends when 3 voters have been discarded" is dropped for the owner\'s-next-turn lifetime, because a counter on a card is G10' },
  { name: 'New Face Who Dis', ref: '4.3', kind: 'headline', reduction: [{ op: 'gerrymander', n: 1, target: 'everyone' }], gap: 'G5/G9', note: 'the Volatile-Area ban is dropped; same card as SUBMERGED. DIVERGENT FROM THE DECK FILE: hl-et2040-001 carries NO `target`, so it gerrymanders one of the CASTER\'S voters, while the reduction above says `everyone` — which is wider, and the deck file\'s own `source` records the choice deliberately ("reduce() now honours that target, so the card is free to say `target: \'everyone\'` and mean it; it ships in the `you` reading until then"). SUBMERGED, the other reading, is in no deck file at all' },
  { name: 'Red Blooded', ref: '4.3', kind: 'headline', reduction: [{ op: 'discard-voter', n: 1, target: 'each-opponent' }], gap: 'G4/G-new', note: 'NARROWER THAN THE DECK FILE BY TWO EFFECTS, AND THIS ROW CARRIED NO NOTE AT ALL UNTIL NOW — which is the whole reason the probe now derives the divergence from the two lists instead of trusting the prose beside them. hl-et2040-002 writes `discard-voter` n2 with NO target (which `voterScope` already reads as opponents, so the target is redundant rather than wrong) and then a SECOND effect, `gain-any` n2 `target: each-opponent`. The reduction above halves the count and drops the resource payout entirely' },
  { name: 'Snoop B-O-Double-T', ref: '4.3', kind: 'headline', reduction: [{ op: 'restrict', kind: 'surcharge', value: 1, target: 'you', until: 'rest-of-game' }], gap: 'G5', note: 'the same card as PYTHONPOST, per REF 4.3, and the same measurement; not double-counted as two mechanisms. NOT IN THE CORPUS: no card of this name is in any deck file — PYTHONPOST is, as hl-in2020-015' },
  { name: 'The Big Freeze', ref: '4.3', kind: 'headline', reduction: [{ op: 'set-cap', to: 10, until: 'rest-of-game' }], gap: 'G15', note: 'NOT IN THE CORPUS: no card of this name is in any deck file, so this row measures the vocabulary rather than the game and the old headline should not have counted it. On the vocabulary the WHOLE of REF 4.3\'s *"Reduce your resource cap to 10."* is expressible, via `set-cap` reading `PlayerState.capOverride` — which is a `PlayerState` FIELD rather than a `restrict` kind because a cap is a NUMBER every pool comparison reads, not a gate an action is refused at. THE DEADLOCK ARGUMENT, which is the reason the earlier refusal ("lowering a cap under an already-over player is the convert-voter soft-lock shape") was wrong: enforceCap raises count = overCap(pool, cap) = max(0, total - cap), so excess <= total ALWAYS -- the ask can never exceed what the player holds -- and discarding it lands at min(total, cap) >= 0, so the target state is REACHABLE rather than merely approached. `lose-any` is additionally clamped to the chooser\'s pool at ANSWER time, so a pool that drains in between lowers the ask instead of stranding it. convert-voter\'s bug was a decision with NO acceptable answer; this is a decision whose answer is always affordable. No gate is needed, and the exhaustive proof is in packages/engine/test/cap-override.test.ts at 2/3/4/5 seats. enforceCap runs in the same breath as the write, which is p12\'s "if at any time you cross your resource cap" read literally. DROPPED, both named: the "[OR] Pick an opponent EVERY TURN and donate any 1 resource to them" branch, which is a recurring donation to a chosen opponent (G5 + G9) and is a DIFFERENT card rather than a smaller one; and the resource cap being player-visible as a number on the mat, which the engine enforces but the client does not yet render' },
  { name: 'The Four Horsemen', ref: '4.3', kind: 'headline', reduction: [{ op: 'lose-any', n: 2 }], gap: 'G5', note: 'the purchase lock is dropped' },
  { name: 'Why The Long Face?', ref: '4.3', kind: 'headline', reduction: [{ op: 'voters', n: 1, target: 'chosen-player', when: 'on-voter-influenced', until: 'next-turn' }], gap: 'G14', note: 'SHIPS as hl-et2040-019 and is now WHOLE: G1 names the opponent, G14 fires the hook, G22 is the lifetime, and the printed 1 voter NOT card parenthetical is honoured because voters grants a group rather than drawing. ONE CLAUSE IS DROPPED AND IT MAKES THE CARD STRONGER, which is why it is named rather than approximated: condition byOwner is left OFF, so the hook fires on ANY influence including an opponents, where the printed card says every Voter Card YOU influence' },
];

// ─────────────────────── where the shipped cards actually are ───────────────────────

/**
 * Every shipped Conspiracy and Headline Card, keyed by a normalised name, with the
 * `decks/<deck>/<kind>.json:<line>` a reader can open and check.
 *
 * ## WHY THIS INDEX EXISTS AT ALL
 *
 * `loadCorpus()` hands back card objects with no memory of the file they came from, and
 * a claim about what "the shipped card" does is not checkable unless it can name the
 * line. Nothing in this script ever asked the decks before, which is the whole reason
 * seven rows were able to assert that a card ships a clause while the card was absent
 * from the repository: the probe measured its own hand-written reduction, reported
 * `PLAYED`, and the word "shipped" went unchallenged in the note beside it.
 *
 * Names are normalised to lower-case alphanumerics because the probe spells a card in
 * REF's casing (KHAKI TERROR) and the deck spells it the way the card reads (Khaki
 * Terror). That normalisation must not merge two different cards: `Chai-Paani` and
 * `Chai-Paani, Dobara` normalise differently, so the probe's row cannot quietly borrow
 * the one for the other.
 *
 * A bucket with more than one card is reported as ambiguous rather than resolved by
 * taking the first, because "which of these two did you mean" is a question for a
 * person.
 */
type ShippedCard = {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly Effect[];
  /** `decks/<deck>/<kind>.json:<line>` — `?` if the line could not be located. */
  readonly where: string;
};

const nameKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

function shippedByName(): ReadonlyMap<string, readonly ShippedCard[]> {
  const out = new Map<string, ShippedCard[]>();
  for (const { deck, kind, path } of discoverDeckFiles()) {
    if (kind !== 'conspiracy' && kind !== 'headline') continue;
    // The line numbers come off the RAW text, because `loadCorpus` reads the same file
    // through a different path and a claim about a line has to be a line a reader can
    // open. Ids are unique within a deck file, so the card's own id finds its block.
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const cards = kind === 'conspiracy' ? loadConspiracyDeck(deck) : loadHeadlineDeck(deck);
    for (const card of cards) {
      const at = lines.findIndex((l) => l.includes(`"${card.id}"`));
      const shipped: ShippedCard = {
        id: card.id,
        name: card.name,
        effects: card.effects,
        where: `decks/${deck}/${kind}.json:${at < 0 ? '?' : String(at + 1)}`,
      };
      const key = nameKey(card.name);
      const bucket = out.get(key);
      if (bucket) bucket.push(shipped);
      else out.set(key, [shipped]);
    }
  }
  return out;
}

/** JSON with object keys sorted, so two equal effects compare equal whatever their write order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'ABSENT';
}

const show = (value: unknown): string => (value === undefined ? 'ABSENT' : stableJson(value));

const describeEffect = (e: Effect): string => {
  const { op, ...rest } = e as unknown as Record<string, unknown>;
  return `${op} ${stableJson(rest)}`;
};

/**
 * Field-by-field, how the probe's `reduction` differs from the deck file's own `effects`.
 *
 * Derived rather than asserted, because the alternative is a note -- prose, unchecked --
 * and the one row whose divergence mattered most (RED BLOODED) shipped without one. An
 * empty result means the two lists are the same card; anything else is named, with the
 * field, both values, and which side each came from.
 */
function divergence(probe: readonly Effect[], shipped: readonly Effect[]): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(probe.length, shipped.length); i += 1) {
    const mine = probe[i];
    const theirs = shipped[i];
    if (mine === undefined && theirs === undefined) continue;
    if (mine === undefined) {
      out.push(`#${i} the deck file ships ${describeEffect(theirs!)} and the probe does not play it`);
      continue;
    }
    if (theirs === undefined) {
      out.push(`#${i} the probe plays ${describeEffect(mine)} and the deck file does not ship it`);
      continue;
    }
    if (mine.op !== theirs.op) {
      out.push(`#${i} op is "${mine.op}" in the probe, "${theirs.op}" in the deck file`);
    }
    const mineFields = mine as unknown as Record<string, unknown>;
    const theirFields = theirs as unknown as Record<string, unknown>;
    for (const field of [...new Set([...Object.keys(mineFields), ...Object.keys(theirFields)])]
      .filter((f) => f !== 'op')
      .sort()) {
      const a = mineFields[field];
      const b = theirFields[field];
      if (stableJson(a) === stableJson(b)) continue;
      out.push(`#${i} ${mine.op}: ${field} is ${show(a)} in the probe, ${show(b)} in the deck file`);
    }
  }
  return out;
}

/**
 * The words in a note that turn it into a claim about the DECK rather than about the
 * reducer.
 *
 * Scanned only for cards that are in no deck file, which is the only case where the
 * claim can be false: a shipped card's row is entitled to say it ships, and an absent
 * card's row is entitled to say what a writer would have to do. This is the mechanism
 * by which the probe REFUSES a shipping claim rather than printing it.
 */
const SHIPPING_CLAIM = /\bships?\b|\bshipped\b|\bcloses\b|\bclosed\b/i;

// ─────────────────────────── the harness ───────────────────────────

const corpus: Corpus = loadCorpus();

const INDEX: CardIndex = {
  ideology: Object.fromEntries(corpus.ideology.map((c) => [c.id, toEngineIdeologyCard(c)])),
  voter: Object.fromEntries(corpus.voter.map((c) => [c.id, toEngineVoterCard(c)])),
  conspiracy: Object.fromEntries(corpus.conspiracy.map((c) => [c.id, toEngineConspiracyCard(c)])),
  headline: Object.fromEntries(corpus.headline.map((c) => [c.id, toEngineHeadlineCard(c)])),
};
const CTX = { rules: RULES, cards: INDEX };

/** A synthetic id for each probe card, so nothing here needs a deck file. */
const probeId = (p: Probe) => `probe-${p.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

/** The synthetic id of the card a response-window probe puts under response. */
const underResponseId = (p: Probe) => `under-${probeId(p)}`;

/**
 * A legal opening position, built from fixture decks rather than the corpus.
 *
 * Same reason `test/card-playback.test.ts` owns its decks: a probe measures the
 * REDUCER's opinion of an effect list, so the position must not move underneath it
 * when somebody edits a deck file. Pegs are placed so the voter-targeting ops
 * (`evict`, `discard-voter`, `convert-voter`) have something to reach, which is the
 * whole question for five of these cards.
 */
/**
 * A tiny Ideology deck, declared here so the position cannot drift with the corpus.
 *
 * **TWO cards, and the second one exists for G20.** `setup` deals one card to the
 * opening player, so a ONE-card deck leaves `_ideologyDraw` EMPTY for the whole probe —
 * and `move-card`'s only source is the Ideology draw pile, so JUMLA and HOLO SAPIENS
 * were both measured as "played, NO-OP" in a position the real game never produces. That
 * is the failure mode this file exists to prevent: a capability reported as absent
 * because the harness could not reach it. A real table is drawing from a real deck.
 *
 * `draw.i` is already in `fingerprint()`, so the extra card is measurable without
 * putting the private HAND in the fingerprint — which would be wrong, because
 * `ideologyCards` is hidden from every viewer including its holder (see
 * `PRIVATE_PLAYER_KEYS`). The probe may observe how many cards left the deck; it must
 * not observe which, because no client may.
 */
const FIXTURE_IDEOLOGY = [
  {
    id: 'probe-ig-a',
    campaign: 'probe',
    question: 'Does the probe reach the board?',
    sides: [
      { answer: 'Yes.', ideologue: 'capitalist' as const, pays: { funds: 1 } },
      { answer: 'No.', ideologue: 'idealist' as const, pays: { trust: 1 } },
    ],
  },
  {
    id: 'probe-ig-b',
    campaign: 'probe',
    question: 'Is there still a card in the draw pile?',
    sides: [
      { answer: 'Yes.', ideologue: 'supremo' as const, pays: { clout: 1 } },
      { answer: 'No.', ideologue: 'showstopper' as const, pays: { media: 1 } },
    ],
  },
] as const;

/**
 * THE NEGATIVE CONTROL FOR THE NEW MECHANIC, and it is per-probe rather than
 * global.
 *
 * The control above proves the harness can report a card that does nothing. It
 * cannot prove a BLOCK did something, because a BLOCK's entire effect is an ABSENCE:
 * the card under response does not pay out, so the blocked and the never-played states
 * agree on every pool, and against the no-op control a correct BLOCK would read as
 * "did nothing". The fingerprint therefore carries the log, and the honest gate for
 * an interrupt probe is DIFFERENTIAL: the same card, played by the same seat, with
 * the same effects, resolved the other way.
 *
 * For `block` that is the un-blocked play, and the two must differ. For `deflect` it
 * is the same play answered, and the pools must have moved onto the named player.
 */
function resolveInterruptProbe(p: Probe, base: GameState): GameState | { readonly error: string } {
  const responder = p.responder ?? 'p2';
  const playedId = underResponseId(p);
  const actor = 'p1';

  let s: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: { ...base.players.p1!, conspiracies: [playedId] },
      [responder]: { ...base.players[responder]!, conspiracies: [probeId(p)] },
    },
  };
  const play = reduce(s, actor, { type: 'PLAY_CONSPIRACY', cardId: playedId }, PROBE_CTX);
  if (!play.ok) return { error: `the card under response was refused: ${play.error}` };
  if (play.state.interrupt === null) {
    return { error: 'no response window opened, so nothing was actually answered' };
  }
  s = play.state;

  // Everyone the window is waiting on declines first, so the probe measures the
  // RESPONSE and not a pass round. p1 already answered the Ideology Card in
  // `opening()`, so it is not a player the reducer will accept a card from here.
  const outOfTurnOk = s.phase === 'answer' || s.phase === 'actions';
  if (!outOfTurnOk) return { error: `the card under response was played in phase ${s.phase}` };
  for (const seat of s.turnOrder) {
    if (seat === actor || seat === responder) continue;
    if (s.interrupt === null) break;
    const r = reduce(s, seat, { type: 'PASS_INTERRUPT' }, PROBE_CTX);
    if (!r.ok) return { error: `${seat} could not decline: ${r.error}` };
    s = r.state;
  }
  if (s.interrupt === null) return { error: 'the window closed before the reactive card was played' };

  const answer: Action = { type: 'RESPOND_INTERRUPT', cardId: probeId(p), ...(p.at ? { at: p.at } : {}) };
  const answered = reduce(s, responder, answer, PROBE_CTX);
  if (!answered.ok) return { error: `the reactive card was refused: ${answered.error}` };
  if (answered.state.interrupt !== null) return { error: 'the window did not close on the answer' };

  const settled = settleChoices(answered.state);
  if ('error' in settled) return settled;
  return settled.state;
}

/** The same play with NOBODY holding a reactive card, for the differential gate. */
function resolveWithoutResponse(p: Probe, base: GameState): GameState | { readonly error: string } {
  const playedId = underResponseId(p);
  const s: GameState = {
    ...base,
    players: {
      ...base.players,
      p1: { ...base.players.p1!, conspiracies: [playedId] },
    },
  };
  const play = reduce(s, 'p1', { type: 'PLAY_CONSPIRACY', cardId: playedId }, PROBE_CTX);
  if (!play.ok) return { error: play.error };
  if (play.state.interrupt !== null) return { error: 'a window opened with an empty table' };
  const settled = settleChoices(play.state);
  if ('error' in settled) return settled;
  return settled.state;
}

/**
 * Route one card through the path its kind really takes, and settle what it raises.
 *
 * Returns `null` if the reducer refused it. Note what is NOT compared here: resolving
 * a Headline draws the next one off the headline pile and resolving a Conspiracy
 * moves that card to its discard pile, so EVERY probe changes the state. Deciding
 * "did the card do anything" therefore has to be differential against the control
 * below rather than against the opening position.
 */
function resolve(p: Probe, base: GameState): GameState | { readonly error: string } {
  const id = probeId(p);

  // TWO headlines are queued on purpose. With one, `ACK_HEADLINE` drains the queue
  // into `advanceTurn`, which resets the incoming player's `powerUses` and can end the
  // game outright -- so a one-deep queue measures the turn boundary rather than the
  // card. Control and probe share the depth, so the differential is unaffected either
  // way; two is simply the depth at which the card is the only thing that moved.
  const active: GameState = {
    ...base,
    phase: 'headlines',
    activeHeadline: id,
    headlineQueue: [{ areaId: '', by: 'p1' }, { areaId: '', by: 'p1' }],
  };
  const result =
    p.kind === 'headline'
      ? reduce(active, 'p1', { type: 'ACK_HEADLINE' }, PROBE_CTX)
      : reduce(
          {
            ...base,
            players: {
              ...base.players,
              p1: { ...base.players.p1!, conspiracies: [...base.players.p1!.conspiracies, id] },
            },
          },
          'p1',
          { type: 'PLAY_CONSPIRACY', cardId: id },
          PROBE_CTX,
        );

  if (!result.ok) return { error: result.error };
  const settled = settleChoices(result.state);
  if ('error' in settled) return settled;
  return settled.state;
}

/**
 * The probe's own answer to "how do I know this harness can report a failure?"
 *
 * A measurement that has only ever produced PLAYED is indistinguishable from a
 * measurement that cannot fail. The control is a card whose reduction is a `gain` of
 * nothing, routed through the identical path. If the harness cannot report it as a
 * no-op, the fingerprint is not measuring anything and every other verdict is void.
 */
const CONTROL: Probe = {
  name: 'CONTROL — a card that does nothing',
  ref: 'n/a',
  kind: 'headline',
  reduction: [{ op: 'gain', res: {} }],
  gap: 'n/a',
};

const ALL_PROBE_CARDS: readonly Probe[] = [...PROBES, CONTROL];

/** The state the harness produces when a card does nothing, for comparison. */
function controlState(): GameState | { readonly error: string } {
  const out = resolve(CONTROL, opening());
  if ('error' in out) return out;
  return out;
}

const PROBE_INDEX: CardIndex = {
  ...INDEX,
  ideology: {
    ...INDEX.ideology,
    ...Object.fromEntries(FIXTURE_IDEOLOGY.map((c) => [c.id, c])),
  },
  conspiracy: {
    ...INDEX.conspiracy,
    ...Object.fromEntries(
      ALL_PROBE_CARDS.filter((p) => p.kind === 'conspiracy' && p.reduction !== null).map((p) => [
        probeId(p),
        {
          id: probeId(p),
          name: p.name,
          text: `probe: ${p.name}`,
          cost: 4,
          effects: p.reduction ?? [],
          ...(p.interrupt ? { interrupt: p.interrupt } : {}),
        },
      ]),
    ),
    // The card a response-window probe answers. It is an ordinary Conspiracy Card
    // with an ordinary visible payout, and its whole job is to be cancelled or
    // redirected — which is why it needs to be a REAL card in the index rather than
    // something the harness special-cases.
    ...Object.fromEntries(
      ALL_PROBE_CARDS.filter((p) => p.interrupt !== undefined).map((p) => [
        underResponseId(p),
        {
          id: underResponseId(p),
          name: (p.played ?? UNDER_RESPONSE).name,
          text: 'probe: the card under response',
          cost: 4,
          effects: (p.played ?? UNDER_RESPONSE).effects,
        },
      ]),
    ),
  },
  headline: {
    ...INDEX.headline,
    ...Object.fromEntries(
      ALL_PROBE_CARDS.filter((p) => p.kind === 'headline' && p.reduction !== null).map((p) => [
        probeId(p),
        { id: probeId(p), name: p.name, text: `probe: ${p.name}`, effects: p.reduction ?? [] },
      ]),
    ),
  },
};
const PROBE_CTX = { rules: RULES, cards: PROBE_INDEX };

/**
 * A legal opening position, built from fixture decks rather than the corpus.
 *
 * Same reason `test/card-playback.test.ts` owns its decks: a probe measures the
 * REDUCER's opinion of an effect list, so the position must not move underneath it
 * when somebody edits a deck file. Pegs are placed so the voter-targeting ops
 * (`evict`, `discard-voter`, `convert-voter`) have something to reach, which is the
 * whole question for five of these cards.
 */
function opening(): GameState {
  const s = setup({
    players: ['p1', 'p2', 'p3'],
    cards: PROBE_CTX.cards,
    seed: 4242,
    // 6 total, under the cap of 12, so a `gain` never triggers a cap discard that
    // would sit in `choices` in front of the decision being measured.
    startResources: [
      { funds: 3, clout: 1, media: 1, trust: 1 },
      { funds: 3, clout: 3, media: 3, trust: 3 },
      { funds: 3, clout: 3, media: 3, trust: 3 },
    ],
    ideologyDeck: FIXTURE_IDEOLOGY.map((c) => c.id),
    voterDeck: corpus.voter.slice(0, 6).map((c) => c.id),
    conspiracyDeck: corpus.conspiracy.slice(0, 3).map((c) => c.id),
    headlineDeck: corpus.headline.slice(0, 3).map((c) => c.id),
  });

  // Put a peg on the board for every seat: the voter ops resolve against
  // `state.zones`, and a card whose reduction targets opponents needs there to BE
  // opponents with voters. Empty board would make them resolve to nothing and the
  // probe would pass for the wrong reason.
  const areas = s.zones.flatMap((z) => z.areas).filter((a) => !a.volatile).slice(0, 3);
  const seeded: GameState = {
    ...s,
    zones: s.zones.map((z) => ({
      ...z,
      areas: z.areas.map((a) => {
        const slot = areas.findIndex((c) => c.id === a.id);
        if (slot < 0) return a;
        const owner = (['p1', 'p2', 'p3'] as const)[slot]!;
        return { ...a, peg: { owner, majority: false } };
      }),
    })),
  };

  const answered = reduce(seeded, 'p1', { type: 'ANSWER', side: 0 }, PROBE_CTX);
  if (!answered.ok) throw new Error(`probe opening could not answer: ${answered.error}`);

  // One Conspiracy Card already in the discard pile. SELECTIVE ACCESS MEMORY reaches
  // into that pile, and a freshly-built game has an empty one -- without this the
  // probe would call a working card a no-op, which is the one wrong answer a
  // playability measurement must never give.
  const withDiscard: GameState = {
    ...answered.state,
    _conspiracyDiscard: [corpus.conspiracy[0]?.id ?? 'probe-ig-a'],
  };

  if (withDiscard.choices.length > 0) {
    throw new Error('probe opening left a pending decision; the measurement would be about the wrong thing');
  }
  return withDiscard;
}

/**
 * A cheap, total fingerprint of the parts of the state an effect can move.
 *
 * Deliberately EXCLUDED, each for a stated reason:
 *  - the log and the turn/round counters, which every `reduce()` advances;
 *  - the discard piles and `activeHeadline`, which move as a matter of course when
 *    a card resolves;
 *  - `_headlineDraw`, which is drained by the QUEUE, not by any effect. There is no
 *    op that draws a Headline -- that is exactly why Fuelling The News is G17 -- so
 *    including it would report every headline probe as having done something.
 *
 * INCLUDED, and this is the interesting one: `liveEffects`. A lasting clause does
 * nothing to the pools, the mat or the board on the turn it resolves -- it writes a
 * `GameState.liveEffects` entry and starts acting at the next turn boundary or the
 * next matching event. Without the list in the fingerprint, every `duration`,
 * `until` and `when` card would be reported as "played, NO-OP", which is the one
 * wrong answer a playability measurement must never give: it would read as a
 * capability that does not exist.
 *
 * AND, SINCE G13, the log TAIL — with every quoted string normalised to "…" and the
 * per-play bookkeeping line dropped. A card whose entire effect is an ABSENCE is the
 * one shape this fingerprint could not see: a BLOCK's whole job is that the card
 * under response does NOT pay out, so a blocked state and a never-played state agree
 * on every pool and the block would read as a no-op. The log is where a block is
 * recorded (`Blocked "…".`, a `system` entry).
 *
 * Two normalisations, and both are load-bearing rather than cosmetic:
 *  - the quoted NAMES are normalised, or every card's `Played "…".` line would differ
 *    from the control's and the fingerprint would report EVERY probe as changed;
 *  - the `Played "…".` / `HEADLINE — …` line itself is dropped, because it is
 *    bookkeeping every card produces and including it makes the no-op control report
 *    as having moved the state. That is asserted at the bottom of this file, and the
 *    first version of this change failed exactly there, which is what the control is
 *    for.
 */
function fingerprint(s: GameState, base?: GameState): string {
  const from = base?.log.length ?? 0;
  const tail = s.log
    .slice(from)
    .filter((e) => !e.text.startsWith('Played "') && !e.text.startsWith('HEADLINE — '))
    .map((e) => `${e.kind}:${e.player ?? '-'}:${e.text.replace(/"[^"]*"/g, '"…"')}`);
  return JSON.stringify({
    pools: s.turnOrder.map((id) => s.players[id]?.resources),
    pending: s.turnOrder.map((id) => s.players[id]?.pending),
    conspiracies: s.turnOrder.map((id) => s.players[id]?.conspiracies),
    manifesto: s.turnOrder.map((id) => s.players[id]?.manifesto),
    manifestoCards: s.turnOrder.map((id) => s.players[id]?.manifestoCards),
    gerrymandered: s.turnOrder.map((id) => s.players[id]?.powerUses.gerrymandered),
    helpingHands: s.turnOrder.map((id) => s.players[id]?.powerUses.helpingHands),
    liveEffects: s.liveEffects,
    // A `restrict` effect changes nothing else at all — it writes a rule, and the rule
    // is consulted later by a different action. Without the list here, PYTHONPOST,
    // SNOOP B-O-DOUBLE-T and DON'T KISS THE BABIES would all report "played, NO-OP"
    // even though the tax they impose is live from this moment on.
    restrictions: s.turnOrder.map((id) => s.players[id]?.restrictions),
    // G15, and the SAME argument as `restrictions` above, for THE BIG FREEZE: `set-cap`
    // writes a rule rather than moving anything, and the rule is consulted later by
    // `enforceCap` on a different action. Without it here the card reports "played,
    // NO-OP" in any position where the caster is not ALREADY over the reduced cap — which
    // is not "the card does nothing", it is "the card has nothing to bite on yet", and the
    // two must not share a verdict. The exhaustive proof that the rule really bites, and
    // that it cannot strand anybody, is in packages/engine/test/cap-override.test.ts.
    caps: s.turnOrder.map((id) => s.players[id]?.capOverride ?? null),
    // G13: a response window holds a card's effects un-applied, and the window's
    // existence is part of what the mechanic changed.
    interrupt: s.interrupt,
    pegs: s.zones.flatMap((z) => z.areas).map((a) => (a.peg ? `${a.id}:${a.peg.owner}` : null)),
    market: s.market.map((m) => m.cardId),
    draw: { i: s._ideologyDraw, v: s._voterDraw, c: s._conspiracyDraw },
    logTail: tail,
  });
}

/**
 * Answer every decision the card raised, as the player it was raised to.
 *
 * A card that hands its player a choice -- `steal-any`, `lose-any`, `evict` -- has
 * not finished resolving while that choice is still pending, so measuring the state
 * before it is answered would under-report the card. And "can a player actually make
 * this pick" is part of playability: if no legal pick exists, the card dead-ends and
 * that is a refusal.
 *
 * The picks are greedy and deterministic -- take funds first, take the first legal
 * areas -- because the question is "does a legal resolution exist", not which one a
 * player would prefer.
 */
function settleChoices(s: GameState): { readonly state: GameState } | { readonly error: string } {
  let state = s;
  for (let guard = 0; guard < 12 && state.choices.length > 0; guard += 1) {
    const pending = state.choices[0];
    if (pending === undefined) break;
    const player = state.players[pending.player];
    if (player === undefined) return { error: `a decision was raised for ${pending.player}, who is not in the game` };

    const c = pending.choice;
    let result: ReturnType<typeof reduce> | null = null;

    if (c.kind === 'gain-any' || c.kind === 'lose-any') {
      // Spread over funds first, then the rest, so the pick is legal against the
      // pool the chooser actually holds.
      let remaining = c.count;
      const res: Record<string, number> = {};
      for (const r of ['funds', 'clout', 'media', 'trust'] as const) {
        if (remaining === 0) break;
        const take = Math.min(remaining, player.resources[r]);
        if (take > 0) {
          res[r] = take;
          remaining -= take;
        }
      }
      if (remaining > 0 && c.kind === 'gain-any') {
        // Not enough held to spread; draw from the Public Reserve for the rest.
        res.funds = (res.funds ?? 0) + remaining;
        remaining = 0;
      }
      result = reduce(state, pending.player, {
        type: 'RESOLVE_CHOICE',
        choiceId: pending.id,
        pick: { kind: 'resources', res },
      }, PROBE_CTX);
    } else if (c.kind === 'steal-any') {
      const victim = c.from ?? state.turnOrder.find((id) => id !== pending.player);
      const target = victim === undefined ? undefined : state.players[victim];
      if (target === undefined || victim === undefined) {
        return { error: 'a theft was raised with no eligible victim' };
      }
      let remaining = Math.min(c.count, deltaTotal(target.resources));
      const res: Record<string, number> = {};
      for (const r of ['funds', 'clout', 'media', 'trust'] as const) {
        if (remaining === 0) break;
        const take = Math.min(remaining, target.resources[r]);
        if (take > 0) {
          res[r] = take;
          remaining -= take;
        }
      }
      if (remaining > 0) return { error: 'a theft was raised that nobody could pay' };
      result = reduce(state, pending.player, {
        type: 'RESOLVE_CHOICE',
        choiceId: pending.id,
        pick: { kind: 'steal', from: victim, res },
      }, PROBE_CTX);
    } else if (
      c.kind === 'evict-voter' ||
      c.kind === 'discard-voter' ||
      c.kind === 'convert-voter'
    ) {
      // evict / discard-voter / convert-voter: pick the areas the engine itself
      // says are legal, discovered by asking for one too many and reading the count.
      // `zoneId` is G16's narrowing and is the CARD's, so the pick mirrors it.
      const legal = legalAreas(state, pending.player, c.kind, c.scope, c.count, c.zoneId);
      if (legal.length === 0) return { error: `no legal target for ${c.kind}` };
      result = reduce(state, pending.player, {
        type: 'RESOLVE_CHOICE',
        choiceId: pending.id,
        pick: { kind: 'areas', areaIds: legal },
      }, PROBE_CTX);
    } else if (c.kind === 'choose-player') {
      // G1. `turnOrder` minus the chooser is the engine's candidate set, so the first
      // other seat is always accepted — which is the satisfiability invariant, read
      // off the same expression `applyEffect` offered the decision from.
      const id = state.turnOrder.find((x) => x !== pending.player);
      if (id === undefined) return { error: 'a choose-player decision with no candidate seat' };
      result = reduce(state, pending.player, {
        type: 'RESOLVE_CHOICE',
        choiceId: pending.id,
        pick: { kind: 'player', id },
      }, PROBE_CTX);
    } else if (c.kind === 'choose-card') {
      // G17. The LAST card on the offered list rather than the first, and that is the
      // point of measuring this card through the probe: taking the first would be the
      // pre-U1 behaviour and would pass for a play, so a measurement that took the
      // first could not tell the two apart. A player naming a card is only possible if
      // `pick: true` shipped. This says "last of the offered list", not "bottom of the
      // pile" — the list's ORDER is not public, so nothing here claims to know it.
      const cardId = c.cards[c.cards.length - 1];
      if (cardId === undefined) return { error: 'a choose-card decision with an empty recycle list' };
      result = reduce(state, pending.player, {
        type: 'RESOLVE_CHOICE',
        choiceId: pending.id,
        pick: { kind: 'card', cardId },
      }, PROBE_CTX);
    } else {
      // G16. The first zone `legalZoneIds` would offer, mirrored here so the probe
      // measures the card rather than a bad pick.
      const effect = c.effects[0];
      if (effect === undefined || !('zone' in effect)) {
        return { error: 'a choose-zone decision naming no zone' };
      }
      const named = 'target' in effect ? effect.target : undefined;
      const op = effect.op === 'evict' || effect.op === 'convert-voter' ? effect.op : 'discard-voter';
      const scope: ChoiceScope =
        op === 'evict' ? 'any' : op === 'convert-voter' ? 'others' : named === 'you' ? 'own' : 'others';
      let zoneId: ZoneID | undefined;
      for (const z of state.zones) {
        const has = z.areas.some(
          (a) =>
            a.peg !== null &&
            !a.volatile &&
            !(scope === 'own' && a.peg.owner !== c.source) &&
            !(scope === 'others' && a.peg.owner === c.source) &&
            !(op === 'convert-voter' && a.peg.owner === c.source),
        );
        if (has) {
          zoneId = z.id;
          break;
        }
      }
      if (zoneId === undefined) return { error: 'a choose-zone decision with no legal constituency' };
      result = reduce(state, pending.player, {
        type: 'RESOLVE_CHOICE',
        choiceId: pending.id,
        pick: { kind: 'zone', zoneId },
      }, PROBE_CTX);
    }

    if (result === null) return { error: 'no pick was constructed for the raised decision' };
    if (!result.ok) return { error: result.error };
    state = result.state;
  }
  if (state.choices.length > 0) return { error: 'the card raised a decision that would not clear' };
  return { state };
}

/** The areas `resolveChoice` will accept, mirroring its guards exactly. */
function legalAreas(
  state: GameState,
  playerId: PlayerID,
  kind: string,
  scope: ChoiceScope,
  n: number,
  zoneId?: ZoneID,
): AreaID[] {
  const out: AreaID[] = [];
  for (const z of state.zones) {
    if (zoneId !== undefined && z.id !== zoneId) continue;
    for (const a of z.areas) {
      if (out.length >= n) return out;
      if (a.peg === undefined || a.peg === null) continue;
      if (a.volatile) continue;
      if (scope === 'own' && a.peg.owner !== playerId) continue;
      if (scope === 'others' && a.peg.owner === playerId) continue;
      if (kind === 'convert-voter' && a.peg.owner === playerId) continue;
      out.push(a.id);
    }
  }
  return out;
}

type PlayedVerdict = { readonly how: 'played'; readonly changed: boolean };
type Verdict =
  | PlayedVerdict
  | { readonly how: 'refused'; readonly why: string }
  | { readonly how: 'inexpressible'; readonly why: string }
  | { readonly how: 'unexecutable'; readonly why: string };

const isPlayed = (v: Verdict): v is PlayedVerdict => v.how === 'played';

/**
 * Play one probe card and report what the reducer did with it.
 *
 * Three separate failure modes, deliberately not collapsed:
 *  - `unexecutable`: the effect list is one `unexecutedEffectProblems` rejects, so
 *    the card cannot even be shipped. A schema-level fact.
 *  - `refused`: the list is shippable but `reduce()` rejects it from a real opening
 *    position, or it raises a decision no player can answer. THIS is the case schema
 *    acceptance cannot see, and the reason this script exists.
 *  - `played` with `changed: false`: the reducer accepted it and moved nothing the
 *    control did not also move. Also a lie, and also invisible to the validator.
 */
function play(p: Probe, base: GameState, controlPrint: string): Verdict {
  if (p.reduction === null) {
    return { how: 'inexpressible', why: p.note ?? 'no expressible effect list' };
  }

  // G13: a card carrying an `interrupt` is judged on the CARD, not on its (empty)
  // effect list — `applyEffect` never reads `interrupt`, so asking the effect registry
  // about a probe with no effects would report it shippable for the wrong reason.
  const unexecuted = [
    ...p.reduction.flatMap((e) => unexecutedEffectProblems(e, '')),
    ...unexecutedCardProblems(
      { effects: p.reduction, ...(p.interrupt ? { interrupt: p.interrupt } : {}) },
      '',
    ),
  ];
  if (unexecuted.length > 0) {
    return { how: 'unexecutable', why: unexecuted.map((u) => u.message).join('; ') };
  }

  if (p.interrupt !== undefined) {
    const after = resolveInterruptProbe(p, base);
    if ('error' in after) return { how: 'refused', why: after.error };
    // The differential gate. For a BLOCK, "it changed something" is not provable
    // against the no-op control — its effect is an absence — so the honest test is
    // that the same card, resolved the other way, lands somewhere else.
    const unblocked = resolveWithoutResponse(p, base);
    if ('error' in unblocked) return { how: 'refused', why: `the differential could not run: ${unblocked.error}` };
    if (fingerprint(after, base) === fingerprint(unblocked, base)) {
      return { how: 'played', changed: fingerprint(after, base) !== controlPrint };
    }
    return { how: 'played', changed: true };
  }

  const after = resolve(p, base);
  if ('error' in after) return { how: 'refused', why: after.error };
  return { how: 'played', changed: fingerprint(after, base) !== controlPrint };
}

// ─────────────────────────── the control verdict ───────────────────────────

const BASE = opening();
const CONTROL_STATE = controlState();
const controlSound: true | string =
  'error' in CONTROL_STATE
    ? `CONTROL FAILED: the harness could not route a no-op card at all (${CONTROL_STATE.error})`
    : fingerprint(CONTROL_STATE, BASE) === fingerprint(BASE, BASE)
      ? true
      : 'CONTROL FAILED: a card that does nothing moved the state, so the fingerprint is not measuring effects';

const SHIPPED = shippedByName();

const rows = PROBES.map((p) => {
  const v: Verdict =
    'error' in CONTROL_STATE
      ? { how: 'refused', why: 'the control failed; no verdict is trustworthy' }
      : play(p, BASE, fingerprint(CONTROL_STATE, BASE));

  // The card as the DECK writes it, if it is in one at all. An empty bucket is the
  // honest "not in the corpus", and it is the answer the report leads with rather than
  // the exception: a row whose card is absent is not a broken measurement, it is a
  // capability nobody has turned into a card yet.
  const bucket = SHIPPED.get(nameKey(p.name)) ?? [];
  const shipped = bucket.length === 1 ? bucket[0]! : undefined;
  return {
    p,
    v,
    bucket,
    shipped,
    ambiguous: bucket.length > 1,
    absent: bucket.length === 0,
    diff:
      p.reduction === null || shipped === undefined
        ? []
        : divergence(p.reduction, shipped.effects),
  };
});

const pad = (s: string, n: number) => s.padEnd(n);
const played = rows.filter((r): r is (typeof rows)[number] & { v: PlayedVerdict } => isPlayed(r.v));
const silent = played.filter((r) => !r.v.changed);
const refused = rows.filter((r) => r.v.how === 'refused');
const inexpressible = rows.filter((r) => r.v.how === 'inexpressible');
const unexecutable = rows.filter((r) => r.v.how === 'unexecutable');

/** EXPRESSIBLE: reduce() played the reduction and the state moved. */
const expressible = played.filter((r) => r.v.changed);
/** IN THE CORPUS: named exactly once in a deck file. */
const inCorpus = rows.filter((r) => r.shipped !== undefined);
/** SHIPPED AS AUTHORED: in a deck file, and the probe played that card's own effects. */
const asAuthored = inCorpus.filter((r) => r.diff.length === 0);
/** In the corpus, and the probe played something ELSE. Named below, never absorbed. */
const divergent = inCorpus.filter((r) => r.diff.length > 0);
/** Expressible AND filed. This is the headline, and only this. */
const headline = expressible.filter((r) => r.shipped !== undefined);
/** Expressible but in no deck file: the rows the old headline counted and should not have. */
const phantoms = expressible.filter((r) => r.absent);
/** Rows a card's note says ships something, where no such card is on disk. A build failure. */
const falseClaims = rows.filter(
  (r) => r.absent && r.p.note !== undefined && SHIPPING_CLAIM.test(r.p.note),
);
/** A row that probed a different card from the one on disk, and did not say so. */
const silentDivergences = divergent.filter((r) => r.p.note === undefined);

console.log('shasn cards — how many recovered cards can actually be PLAYED?');
console.log('─'.repeat(96));
console.log('Three separate questions per row, and the headline counts only two of them.\n');

console.log(`${pad('card', 28)} ${pad('REF', 5)} ${pad('EXPRESSIBLE', 13)} ${pad('IN CORPUS', 24)} ${pad('SHIPPED AS AUTHORED', 21)} gap`);
console.log('─'.repeat(96));
for (const r of rows) {
  const expr =
    r.v.how === 'played'
      ? r.v.changed
        ? 'PLAYED'
        : 'played, NO-OP'
      : r.v.how === 'refused'
        ? 'REFUSED'
        : r.v.how === 'inexpressible'
          ? 'inexpressible'
          : r.v.how === 'unexecutable'
            ? 'unexecutable'
            : 'untrusted';
  const corpus = r.ambiguous
    ? `AMBIGUOUS (${r.bucket.length})`
    : r.shipped
      ? `${r.shipped.id} @${r.shipped.where}`
      : 'ABSENT — not in any deck';
  const authored =
    r.shipped === undefined
      ? 'n/a — no card on disk'
      : r.diff.length === 0
        ? 'yes, field for field'
        : `NO — ${r.diff.length} divergence(s)`;
  console.log(`${pad(r.p.name, 28)} ${pad(`§${r.p.ref}`, 5)} ${pad(expr, 13)} ${pad(corpus, 24)} ${pad(authored, 21)} ${r.p.gap}`);
}

console.log('\n' + '─'.repeat(96));
console.log('THE THREE QUESTIONS, and what each one is a claim about');
console.log('─'.repeat(96));
console.log('EXPRESSIBLE          a reduction exists and reduce() plays it, moving the state.');
console.log('                    The reduction is the PROBE\'S OWN, written from the REF text and');
console.log('                    NOT read from a deck file. It says the SCHEMA can carry');
console.log('                    something like this card — not that this card ships and works.');
console.log('IN THE CORPUS        the card is in a deck file on disk, reported with its file:line.');
console.log('                    Without this, a "playable" card is not in the game at all:');
console.log('                    nobody can draw it and no table can reach it.');
console.log('SHIPPED AS AUTHORED  the deck file\'s own effects are what the probe played, field');
console.log('                    for field. A divergence is NAMED, never absorbed.');

console.log('\n' + '─'.repeat(96));
console.log(`recovered cards probed${pad('', 32)}${rows.length}`);
console.log(`  EXPRESSIBLE (reduce() played it)${pad('', 19)}${expressible.length}`);
console.log(`  played but moved nothing${pad('', 24)}${silent.length}`);
console.log(`  reducer REFUSED at play${pad('', 25)}${refused.length}`);
console.log(`  not expressible at all${pad('', 27)}${inexpressible.length}`);
console.log(`  expressible, not executable${pad('', 21)}${unexecutable.length}`);
console.log('');
console.log(`  IN THE CORPUS (deck file)${pad('', 22)}${inCorpus.length}`);
console.log(`  SHIPPED AS AUTHORED${pad('', 31)}${asAuthored.length}`);
console.log(`  in the corpus, probed something else${pad('', 16)}${divergent.length}`);

console.log('\n' + '─'.repeat(96));
console.log(`HEADLINE — EXPRESSIBLE and IN THE CORPUS: ${headline.length} of ${rows.length}`);
console.log('─'.repeat(96));
console.log(`The conjunction, and the conjunction is the honest denominator: a card nobody has`);
console.log(`filed cannot be drawn by anybody, so counting it measures the schema and calls`);
console.log(`it the game.`);
console.log('');
console.log(`  ${expressible.length} of ${rows.length}  EXPRESSIBLE alone — what this file reported until the decks were read.`);
console.log(`              ${phantoms.length} of those ${expressible.length} are in no deck file at all, and the old`);
console.log(`              headline counted every one of them.`);
console.log(`  ${headline.length} of ${rows.length}  EXPRESSIBLE and IN THE CORPUS — THE HEADLINE, and ${expressible.length - headline.length} below the old one.`);
console.log(`  ${asAuthored.length} of ${rows.length}  …and SHIPPED AS AUTHORED, the subset whose deck-file effects are the ones probed.`);
console.log('');
console.log(`The ${expressible.length} is not a wrong number, it is a different claim: "the vocabulary can`);
console.log(`carry something like this card". It is the one the engine work is measured against,`);
console.log(`and the ${phantoms.length} phantoms below are real capability waiting on somebody to file it.`);

console.log('\nthe cards behind the headline — every one of them, and where it lives');
console.log('─'.repeat(96));
for (const r of headline) {
  console.log(`  ${pad(r.p.name, 28)} ${pad(r.shipped!.id, 16)} ${r.shipped!.where}`);
}

if (phantoms.length > 0) {
  console.log('\nEXPRESSIBLE BUT IN NO DECK FILE — measured, and not in the game');
  console.log('─'.repeat(96));
  console.log('The old headline counted these. A note in each of them used to assert that the');
  console.log('card ships a clause; no such card is on disk, and the note now says so instead.');
  for (const r of phantoms) {
    console.log(`  ${pad(r.p.name, 28)} ${pad(r.p.gap, 8)} no deck file anywhere in packages/cards/decks`);
  }
}

if (divergent.length > 0) {
  console.log('\nIN THE CORPUS, BUT THE PROBE PLAYED SOMETHING ELSE');
  console.log('─'.repeat(96));
  console.log('Each divergence is named here whether or not the row\'s note covers it, so a');
  console.log('reader is never left taking the probe\'s word for the deck file\'s.');
  for (const r of divergent) {
    console.log(`  ${pad(r.p.name, 28)} ${r.shipped!.id} (${r.shipped!.where})`);
    for (const d of r.diff) console.log(`      ${d}`);
    console.log(`      note: ${r.p.note === undefined ? 'NONE — the divergence is undisclosed' : 'present'}`);
  }
}

if (silent.length > 0) {
  console.log('\nplayed but changed nothing — these are cards that would ship and lie:');
  for (const { p } of silent) console.log(`  ${p.name} (${p.gap})`);
}
if (refused.length > 0) {
  console.log('\nrefused by reduce() at play time — schema-acceptable, unplayable:');
  for (const { p, v } of refused) console.log(`  ${p.name} (${p.gap}): ${v.how === 'refused' ? v.why : ''}`);
}
if (unexecutable.length > 0) {
  console.log('\nexpressible in the schema, refused by the executability registry:');
  for (const { p } of unexecutable) console.log(`  ${p.name} (${p.gap})`);
}

console.log('\nper blocking gap (first gap named on the card), by verdict');
console.log('─'.repeat(96));
const byGap = new Map<string, { played: number; headline: number; silent: number; refused: number; none: number }>();
for (const r of rows) {
  const key = r.p.gap.split('/')[0]!.trim();
  const row = byGap.get(key) ?? { played: 0, headline: 0, silent: 0, refused: 0, none: 0 };
  if (r.v.how === 'played') {
    if (r.v.changed) {
      row.played += 1;
      if (r.shipped !== undefined) row.headline += 1;
    } else row.silent += 1;
  } else if (r.v.how === 'refused') row.refused += 1;
  else row.none += 1;
  byGap.set(key, row);
}
console.log(`${pad('gap', 10)} ${pad('expressible', 12)} ${pad('headline', 10)} ${pad('no-op', 8)} refused  inexpressible`);
for (const [gap, r] of [...byGap].sort((a, b) => b[1].headline - a[1].headline || a[0].localeCompare(b[0]))) {
  console.log(`${pad(gap, 10)} ${pad(String(r.played), 12)} ${pad(String(r.headline), 10)} ${pad(String(r.silent), 8)} ${pad(String(r.refused), 8)} ${r.none}`);
}

console.log('\nthe two claims this probe refuses to print');
console.log('─'.repeat(96));
if (falseClaims.length === 0 && silentDivergences.length === 0) {
  console.log('No note claims a card ships something that is not on disk, and every row that');
  console.log('probed a different card from the one in the deck says so in its note.');
} else {
  for (const r of falseClaims) {
    console.log(`  ${r.p.name}: the note claims the card ships, and there is no such card in any`);
    console.log(`    deck file. A row may describe the ENGINE; it may not describe the DECK.`);
    console.log(`    offending words: ${(r.p.note!.match(SHIPPING_CLAIM) ?? []).join(', ')}`);
  }
  for (const r of silentDivergences) {
    console.log(`  ${r.p.name}: the probe played something other than ${r.shipped!.id}'s effects, with NO note:`);
    for (const d of r.diff) console.log(`      ${d}`);
    console.log(`    Reconcile the reduction to the deck file, or name the difference in the note.`);
  }
  process.exitCode = 1;
}

// The control goes last so its verdict is the last thing on the screen: if the
// harness cannot detect a card that does nothing, nothing above it means anything.
console.log('\nnegative control');
console.log('─'.repeat(96));
if (controlSound === true) {
  console.log('CONTROL (a card that does nothing) reported NO-OP, so the fingerprint measures');
  console.log('something. Every verdict above is a real state change, not bookkeeping.');
} else {
  console.log(controlSound);
  process.exitCode = 1;
}
