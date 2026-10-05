/**
 * The trust boundary.
 *
 * Everything above this file trusts its input. Everything below it does not. A
 * `ClientMessage` arriving on a socket is attacker-controlled data until it has
 * been narrowed here, and narrowing is done with real runtime checks — not casts,
 * not `as ClientMessage`, not a `try { JSON.parse } catch`.
 *
 * The checks are hand-written rather than schema-driven on purpose. ARCHITECTURE
 * §3.3 rejected `zod` on the hot path: a schema per message is a real dependency
 * and a per-message parse cost, for a game running at roughly two actions a minute.
 * An exhaustive `switch` that narrows by discriminant is the same amount of
 * assurance for a few more lines, and it typechecks against the protocol.
 *
 * The three things a hostile message must never do:
 *   1. throw out of the handler and take the room down;
 *   2. reach `reduce` as something that is not an `Action`;
 *   3. become a channel for smuggling a secret out (so no server-only value is
 *      ever echoed, and no error text is built from anything but a fixed string
 *      plus the caller's own input).
 */

import {
  BOARD,
  RESOURCES,
  ZONE_IDS,
  areNeighbours,
  zoneOfArea,
  type Action,
  type AreaID,
  type CardID,
  type ChoicePick,
  type Delta,
  type GameState,
  type PlayerID,
  type Resource,
  type ZoneID,
} from '@shasn/engine';

import type { ClientMessage, SeatCount } from './protocol.ts';
import { isModeId } from './modes.ts';

export type DecodeResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly reason: string };

/** Hard cap on a single frame. A Shasn action is well under 1 KB. */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

const MAX_NAME = 24;
const MAX_TOKEN = 128;
const MAX_ID = 64;

export function decodeFrame(raw: string | Buffer<ArrayBufferLike>): DecodeResult {
  if (typeof raw !== 'string') {
    if (raw.byteLength > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'payload too large' };
    return { ok: false, reason: 'binary frames are not accepted' };
  }
  // Byte length, not `.length`. A multi-byte name inflates the character count
  // relative to the wire size, and this is the number the socket actually cost.
  if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: 'payload too large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  return decodeMessage(parsed);
}

export function decodeMessage(value: unknown): DecodeResult {
  if (!isRecord(value)) return { ok: false, reason: 'message must be an object' };
  const t = value['t'];
  if (typeof t !== 'string') return { ok: false, reason: 'missing message type' };
  if (Object.keys(value).length > 24) return { ok: false, reason: 'too many fields' };

  switch (t) {
    case 'ping':
      return onlyKeys(value, ['t', 'nonce'], { ok: true, message: { t: 'ping', ...nonce(value) } });

    case 'lobby:list':
      return onlyKeys(value, ['t'], { ok: true, message: { t: 'lobby:list' } });

    case 'lobby:create': {
      const name = str(value['name'], MAX_NAME);
      const max = num(value['maxPlayers']);
      const priv = value['isPrivate'];
      if (name === null) return bad('lobby name');
      // `typeof` only. An earlier version wrote `if (!priv || typeof priv !== 'boolean')`,
      // which reads as though it rejects non-booleans and in fact rejects `false` —
      // i.e. it made every public room private and every private room illegal.
      if (typeof priv !== 'boolean') return bad('isPrivate');
      if (max === null || !isSeatCount(max)) return bad('maxPlayers');
      const mode = value['mode'];
      // Same shape and same reason as `isSeatCount` above: a closed set, checked
      // against the registry rather than parsed. An unrecognised mode is refused
      // here, at the boundary, instead of travelling into a live match and turning
      // into a card lookup that resolves to nothing. See `modes.ts`.
      if (!isModeId(mode)) return bad('mode');
      return onlyKeys(value, ['t', 'name', 'maxPlayers', 'isPrivate', 'mode'], {
        ok: true,
        message: { t: 'lobby:create', name, maxPlayers: max, isPrivate: priv, mode },
      });
    }

    case 'lobby:join': {
      const lobbyId = str(value['lobbyId'], MAX_ID);
      const name = str(value['name'], MAX_NAME);
      if (lobbyId === null) return bad('lobbyId');
      if (name === null) return bad('name');
      return onlyKeys(value, ['t', 'lobbyId', 'name'], { ok: true, message: { t: 'lobby:join', lobbyId, name } });
    }

    case 'lobby:leave':
      return onlyKeys(value, ['t'], { ok: true, message: { t: 'lobby:leave' } });

    case 'lobby:ready': {
      const ready = value['ready'];
      if (typeof ready !== 'boolean') return bad('ready');
      return onlyKeys(value, ['t', 'ready'], { ok: true, message: { t: 'lobby:ready', ready } });
    }

    case 'lobby:start':
      return onlyKeys(value, ['t'], { ok: true, message: { t: 'lobby:start' } });

    case 'lobby:spectate': {
      const lobbyId = str(value['lobbyId'], MAX_ID);
      if (lobbyId === null) return bad('lobbyId');
      return onlyKeys(value, ['t', 'lobbyId'], { ok: true, message: { t: 'lobby:spectate', lobbyId } });
    }

    case 'match:action': {
      const action = decodeAction(value['action']);
      if (action === null) return bad('action');
      return onlyKeys(value, ['t', 'action'], { ok: true, message: { t: 'match:action', action } });
    }

    case 'match:sync':
      return onlyKeys(value, ['t'], { ok: true, message: { t: 'match:sync' } });

    case 'match:spectate': {
      const matchId = str(value['matchId'], MAX_ID);
      if (matchId === null) return bad('matchId');
      return onlyKeys(value, ['t', 'matchId'], { ok: true, message: { t: 'match:spectate', matchId } });
    }

    case 'session:resume': {
      const token = str(value['resumeToken'], MAX_TOKEN);
      if (token === null) return bad('resumeToken');
      return onlyKeys(value, ['t', 'resumeToken'], {
        ok: true,
        message: { t: 'session:resume', resumeToken: token },
      });
    }

    default:
      return { ok: false, reason: 'unknown message type' };
  }
}

// ─────────────────────────── actions ───────────────────────────

/**
 * Narrow an untrusted value to the engine's `Action`.
 *
 * The exhaustiveness is the point: the `switch` on `type` has no `default`, so
 * adding a sixteenth action to the engine is a compile error here, and this file
 * is where the new variant's runtime check has to be written. That is intentional
 * friction, the same friction ARCHITECTURE §4.5 asks for on the send side.
 *
 * Every numeric field is range-checked and every resource delta is checked for a
 * finite, non-negative integer before the value is allowed near `reduce`. The
 * engine validates delta signs itself now, but validating at the boundary means a
 * bug in that validation is not reachable from a socket.
 */
export function decodeAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  const type = value['type'];
  if (typeof type !== 'string') return null;

  // Every case declares the keys it accepts, and an action carrying anything else
  // is refused. This is the same smuggling defence as `onlyKeys` on the envelope,
  // applied one level down — and the level that matters more, because an extra
  // key inside an action is a field a handler could later start reading.
  const check = (...allowed: readonly string[]): boolean => {
    for (const k of Object.keys(value)) {
      if (!allowed.includes(k)) return false;
    }
    return true;
  };

  switch (type) {
    case 'REDRAW_IDEOLOGY': {
      if (!check('type', 'pay')) return null;
      const pay = delta(value['pay']);
      if (pay === null) return null;
      return { type, pay };
    }

    case 'ANSWER': {
      if (!check('type', 'side')) return null;
      const side = value['side'];
      if (side !== 0 && side !== 1) return null;
      return { type, side };
    }

    case 'INFLUENCE': {
      if (!check('type', 'slot', 'discounts', 'viral')) return null;
      const slot = smallInt(value['slot'], 0, 8);
      if (slot === null) return null;
      const out: {
        type: 'INFLUENCE';
        slot: number;
        discounts?: readonly Resource[];
        viral?: boolean;
      } = { type, slot };
      // `exactOptionalPropertyTypes` is on: an absent key and an `undefined` value
      // are different types, so optional fields are added by key, never assigned.
      if (value['discounts'] !== undefined) {
        const d = resourceList(value['discounts']);
        if (d === null) return null;
        out.discounts = d;
      }
      if (value['viral'] !== undefined) {
        if (typeof value['viral'] !== 'boolean') return null;
        out.viral = value['viral'];
      }
      return out;
    }

    case 'PLACE_VOTERS': {
      if (!check('type', 'groupId', 'areaIds')) return null;
      const groupId = str(value['groupId'], MAX_ID);
      const areaIds = strList(value['areaIds'], MAX_ID, 32);
      if (groupId === null || areaIds === null) return null;
      return { type, groupId, areaIds };
    }

    case 'GERRYMANDER': {
      if (!check('type', 'zoneId', 'fromAreaId', 'toAreaId')) return null;
      const zoneId = zone(value['zoneId']);
      const fromAreaId = str(value['fromAreaId'], MAX_ID);
      const toAreaId = str(value['toAreaId'], MAX_ID);
      if (zoneId === null || fromAreaId === null || toAreaId === null) return null;
      return { type, zoneId, fromAreaId, toAreaId };
    }

    case 'TRADE': {
      if (!check('type', 'withPlayer', 'give', 'receive', 'giveCards', 'receiveCards')) return null;
      const withPlayer = str(value['withPlayer'], MAX_ID);
      const give = delta(value['give']);
      const receive = delta(value['receive']);
      if (withPlayer === null || give === null || receive === null) return null;
      const out: {
        type: 'TRADE';
        withPlayer: PlayerID;
        give: Delta;
        receive: Delta;
        giveCards?: readonly CardID[];
        receiveCards?: readonly CardID[];
      } = { type, withPlayer, give, receive };
      if (value['giveCards'] !== undefined) {
        const c = strList(value['giveCards'], MAX_ID, 32);
        if (c === null) return null;
        out.giveCards = c;
      }
      if (value['receiveCards'] !== undefined) {
        const c = strList(value['receiveCards'], MAX_ID, 32);
        if (c === null) return null;
        out.receiveCards = c;
      }
      return out;
    }

    case 'BUY_CONSPIRACY': {
      if (!check('type', 'pay', 'discounts')) return null;
      const pay = delta(value['pay']);
      if (pay === null) return null;
      const out: { type: 'BUY_CONSPIRACY'; pay: Delta; discounts?: readonly Resource[] } = { type, pay };
      if (value['discounts'] !== undefined) {
        const d = resourceList(value['discounts']);
        if (d === null) return null;
        out.discounts = d;
      }
      return out;
    }

    case 'PLAY_CONSPIRACY': {
      if (!check('type', 'cardId')) return null;
      const cardId = str(value['cardId'], MAX_ID);
      if (cardId === null) return null;
      return { type, cardId };
    }

    case 'POWER_PROSPECT': {
      if (!check('type', 'give', 'take')) return null;
      const give = resource(value['give']);
      const take = resourceList(value['take']);
      if (give === null || take === null) return null;
      return { type, give, take };
    }

    case 'POWER_LAND_GRAB': {
      if (!check('type', 'areaId')) return null;
      const areaId = str(value['areaId'], MAX_ID);
      if (areaId === null) return null;
      return { type, areaId };
    }

    case 'POWER_DONATIONS': {
      if (!check('type', 'from', 'res')) return null;
      const from = str(value['from'], MAX_ID);
      const res = resource(value['res']);
      if (from === null || res === null) return null;
      return { type, from, res };
    }

    case 'POWER_PAYBACK': {
      if (!check('type', 'areaId', 'pay')) return null;
      const areaId = str(value['areaId'], MAX_ID);
      const pay = resource(value['pay']);
      if (areaId === null || pay === null) return null;
      return { type, areaId, pay };
    }

    case 'POWER_TOUGH_LOVE': {
      if (!check('type', 'areaIds', 'pay', 'discounts')) return null;
      const areaIds = strList(value['areaIds'], MAX_ID, 32);
      const pay = delta(value['pay']);
      if (areaIds === null || pay === null) return null;
      const out: {
        type: 'POWER_TOUGH_LOVE';
        areaIds: readonly AreaID[];
        pay: Delta;
        discounts?: readonly Resource[];
      } = { type, areaIds, pay };
      if (value['discounts'] !== undefined) {
        const d = resourceList(value['discounts']);
        if (d === null) return null;
        out.discounts = d;
      }
      return out;
    }

    case 'RESOLVE_CHOICE': {
      if (!check('type', 'choiceId', 'pick')) return null;
      const choiceId = str(value['choiceId'], MAX_ID);
      const pick = choicePick(value['pick']);
      if (choiceId === null || pick === null) return null;
      return { type, choiceId, pick };
    }

    // G13 — the response window's two moves, and they are the ONLY two actions a
    // client may send while a window is open (`reduce` refuses everything else with
    // '"<card>" is resolving - answer it or decline first'`).
    //
    // These cases were MISSING while the engine's window was already built, which is
    // the same class of bug as the driver not being able to act in one: the rules
    // existed, the reducer honoured them, and the wire refused to carry them, so a
    // live table holding a BLOCK could not be closed by ANY seat and the match hung.
    // `decodeAction`'s `switch` is exhaustive by design, so the omission was a
    // compile-clean `default: return null` — and the client sees it as
    // `malformed action`, not as "unknown action", which is why it would have been
    // hard to diagnose from a log.
    case 'RESPOND_INTERRUPT': {
      if (!check('type', 'cardId', 'at')) return null;
      const cardId = str(value['cardId'], MAX_ID);
      if (cardId === null) return null;
      // `at` is the DEFLECT target and is REQUIRED by the reducer for a deflect and
      // FORBIDDEN for a block ("a Block negates the effect; there is nothing to
      // redirect it to"). The decoder cannot tell the two apart — that needs the
      // card body, which the client is not sent — so it passes the field through
      // when present and lets `reduce` be the authority on whether it is legal.
      // `exactOptionalPropertyTypes` is on, so an absent key and `undefined` are
      // different types and the field is added by key, never assigned.
      const at = value['at'];
      if (at === undefined) return { type, cardId };
      // THE BOUND, and it used to be missing its second half.
      //
      // The audit read this arm as "bounded to 64 chars and control-character-free by
      // `validate.ts:358`" and the second clause was wrong: the check below was written
      // out by hand instead of going through `str`, so it bounded the LENGTH and
      // nothing else. `str` is where the control-character rule lives (`c < 0x20 ||
      // c === 0x7f` → refuse), and a hand-written length check silently opts out of it.
      //
      // It matters more here than anywhere else in this file, because `at` is the ONE
      // field the engine INTERPOLATES into a client-visible string: `reduce` answers
      // `fail('unknown player ' + action.at)` and `#dispatch` forwards the engine's
      // words verbatim. Every other id in this file is compared against something and
      // never reaches a human; this one ends up in an error toast. Under full
      // information the attacker already knows their own input, so this is hardening
      // and not a vulnerability — but a name that can carry a newline and an escape
      // into a rendered string is a control character away from a log-injection bug,
      // and the whole cost of closing it is one function call.
      //
      // `str` is also exactly the right check rather than a stricter one: `at` is a
      // `PlayerID`, and every other `PlayerID` on this wire (`choicePick`'s `player`
      // arm, `lobbyId`, `matchId`) already goes through it.
      const checked = str(at, MAX_ID);
      if (checked === null) return null;
      return { type, cardId, at: checked };
    }

    case 'PASS_INTERRUPT':
      if (!check('type')) return null;
      return { type };

    case 'ACK_HEADLINE':
    case 'END_TURN':
      if (!check('type')) return null;
      return { type };

    default:
      return null;
  }
}

function choicePick(value: unknown): ChoicePick | null {
  if (!isRecord(value)) return null;
  const kind = value['kind'];
  switch (kind) {    case 'resources': {
      if (!keysOnly(value, ['kind', 'res'])) return null;
      const res = delta(value['res']);
      return res === null ? null : { kind, res };
    }
    case 'steal': {
      if (!keysOnly(value, ['kind', 'from', 'res'])) return null;
      const from = str(value['from'], MAX_ID);
      const res = delta(value['res']);
      if (from === null || res === null) return null;
      return { kind, from, res };
    }
    case 'areas': {
      if (!keysOnly(value, ['kind', 'areaIds'])) return null;
      const areaIds = strList(value['areaIds'], MAX_ID, 32);
      return areaIds === null ? null : { kind, areaIds };
    }
    /**
     * G1 — the card's actor named a player. One id, not a list, because
     * `'choose-player'.count` is 1 for every card the corpus can express.
     *
     * **This arm was missing while the engine could already raise the decision**, which
     * is the shape of the bug worth naming: a client could be handed a `choose-player`
     * dialog and every answer to it was refused `malformed action`, so the seat froze
     * with no legal reply. `reduce` validates the pick properly (it is the only
     * authority on the candidate set); this is the shape check that decides what the
     * wire may carry at all, and a kind it does not know is not a wrong answer, it is
     * no answer. `id` is a `PlayerID` as an opaque bounded string here for the reason
     * every other id in this file is: which seats exist is not this file's business.
     */
    case 'player': {
      if (!keysOnly(value, ['kind', 'id'])) return null;
      const id = str(value['id'], MAX_ID);
      return id === null ? null : { kind, id };
    }
    /**
     * G16 — the card's actor named one of the nine constituencies. The zone is checked
     * against `ZONE_IDS` rather than accepted as a string, because nine fixed names is a
     * closed set and a pick naming anything else cannot be a constituency whatever the
     * client meant. `reduce` still decides whether this one is LEGAL; this only decides
     * whether it is a thing.
     */
    case 'zone': {
      if (!keysOnly(value, ['kind', 'zoneId'])) return null;
      const zoneId = zone(value['zoneId']);
      return zoneId === null ? null : { kind, zoneId };
    }
    /**
     * G17 — the card's RECIPIENT named one card out of the published recycle list.
     *
     * **A `cardId` HERE IS NOT A CARD THE SERVER MAY HAVE NEVER HEARD OF**, and that is
     * the whole reason this arm is not a formality. `cardId` is an opaque bounded string
     * for the reason every other id in this file is: this module decides what the WIRE
     * may carry, and `reduce` is the only authority on whether the named card is on the
     * recycle list right now. What this arm adds is that a `choose-card` decision is
     * ANSWERABLE at all — the missing-arm shape the `'player'` note above is about, in a
     * place where a wrong answer would have been a `CardID` from the draw pile rather
     * than a dead seat.
     *
     * `MAX_ID` and not something tighter because a card id is the same length of opaque
     * string as every other id here, and `MAX_PAYLOAD_BYTES` bounds the frame.
     */
    case 'card': {
      if (!keysOnly(value, ['kind', 'cardId'])) return null;
      const cardId = str(value['cardId'], MAX_ID);
      return cardId === null ? null : { kind, cardId };
    }
    /**
     * G1 — the answerer names ONE voter AND an adjacent empty area for it to land in.
     *
     * ## THIS ARM WAS MISSING WHILE THE ENGINE COULD ALREADY RAISE THE DECISION
     *
     * The same shape as the `'player'` arm above, and found the same way: a live table
     * could be handed a `choose-peg-dest` dialog and **every** answer to it was refused
     * `malformed action`, so the seat froze with no legal reply. `decodeAction`'s
     * `switch` is exhaustive, so the omission was a compile-clean `default: return null`
     * — and the client sees it as "malformed action" rather than "unknown action", which
     * is what makes it hard to diagnose from a log. It was found by the socket driver in
     * `test/winnable.test.ts`, which is the only path that goes through the wire at all.
     *
     * ## ADJACENCY IS DECIDED **HERE**, AND THAT IS THE POINT OF THIS ARM
     *
     * Every other arm checks SHAPE: `zone` checks the name against `ZONE_IDS` because
     * nine fixed names is a closed set, and this one checks both ids against the real
     * areas of `BOARD`. What it adds on top is the first check in this file that reads
     * the *relationship* between two values — and it is cheap and exact because
     * **adjacency is board data, not game state**. `Zone.neighbours` is fixed data
     * copied out of `BOARD` by `freshZones` and no action moves a constituency, so
     * `areNeighbours` is the same answer before and after every action in the match.
     *
     * So a pick whose two areas are in the same zone or in non-touching zones is
     * refused at the wire rather than reaching `reduce`. `pegDestinations` in the engine
     * says *"an empty area in a zone adjacent to the peg's own"* and refuses the peg's
     * OWN zone for a reason the engine states: a peg lifted and put back in the same
     * constituency changes nothing, so a decision must never offer a move that does
     * nothing. That reasoning holds for the wire too, and a non-adjacent pair is the
     * cheapest possible malformed pick — no state read, no rollback, nothing to undo.
     *
     * **What is NOT checked here, and why.** Whether `areaId` holds a movable peg and
     * whether `toAreaId` is empty are properties of the board *as it stands*, and they
     * change under the table's feet — between the offer and the answer a majority can
     * form and an area can be filled. Deciding them at decode time would be deciding
     * them against a stale board, and `decodeFrame` has no state to be stale against.
     * They are the other half of the trust boundary and they live in
     * `pegDestRefusal` below, which reads the live board.
     */
    case 'peg-dest': {
      if (!keysOnly(value, ['kind', 'areaId', 'toAreaId'])) return null;
      const areaId = area(value['areaId']);
      const toAreaId = area(value['toAreaId']);
      if (areaId === null || toAreaId === null) return null;
      if (!areNeighbours(zoneOfArea(areaId), zoneOfArea(toAreaId))) return null;
      return { kind, areaId, toAreaId };
    }
    default:
      return null;
  }
}

// ─────────────────────── the second half of the pick boundary ───────────────────────

/**
 * The state-dependent half of a `'peg-dest'` answer: does this pair name anything that
 * could be moved, *on the board as it stands*?
 *
 * ## WHY THIS IS NOT IN `choicePick`
 *
 * `choicePick` decides what the WIRE may carry. It has no state — it cannot have one,
 * because `decodeFrame` runs before the message is bound to a room, and a
 * `RESOLVE_CHOICE` naming a `choiceId` the table never issued is legal to decode and
 * refused later. Occupancy and p18 are properties of the board, and the board moves
 * between the offer and the answer, so a decode-time check would be a check against a
 * board that does not exist. `Room.dispatch` calls this instead, where the live
 * `GameState` is the same one `reduce` is about to be handed.
 *
 * ## AND IT REFUSES EXACTLY WHAT `reduce` REFUSES, NO MORE
 *
 * That is the load-bearing property and it is not automatic. The three clauses below are
 * `movablePegIds`' two exclusions and `pegDestinations`' emptiness test, transcribed, so
 * **anything this accepts, `reduce` accepts.** Nothing legal is dropped: if the engine
 * would accept a pair then the peg is not a majority peg, is not in a Volatile Area, and
 * the destination is empty and adjacent — which is exactly what was just checked. The
 * one clause deliberately LEFT to `reduce` is ownership (`peg.owner === c.source`),
 * because that needs the pending decision and this function is handed a bare pick.
 *
 * ## THE RULING ON A VOLATILE **DESTINATION**, which is the reading worth having written
 *
 * The ask was "refuse a destination naming a non-adjacent, occupied, or volatile area".
 * Non-adjacent and occupied are refused. Volatile is refused for the peg's OWN area and
 * **accepted for the destination**, because the engine accepts it: `pegDestinations`
 * filters on `peg === null` and nothing else, and `setArea` puts the peg down and draws
 * the Headline p18 owes for it — the peg lands there and is permanent from then on.
 *
 * That is a legal outcome and the engine means it. Refusing it here would make the wire
 * accept a strict SUBSET of the picks `reduce` accepts, which is the one thing this
 * function must not do: the client's own invariant suite asserts every `Choice` kind
 * renders a resolvable control, so a wire narrower than the engine is a dialog with a
 * button the server rejects — the failure mode the `'zone'` arm's note calls worse than
 * not offering the choice at all. The engine's `movablePegIds` docstring says the same
 * thing about the OTHER end of the move ("this is a rules exclusion rather than an
 * engine one"), and rules exclusions belong where the printed card can name them.
 *
 * **THE TWO REFUSAL STRINGS ARE `reduce`'s OWN, VERBATIM AND UNINTERPOLATED.** No id
 * from the wire reaches them, so nothing an attacker sends can reach a client-visible
 * string through this path — and the client cannot tell whether the pair was refused at
 * the wire or in the reducer, which is the point: a wire check that changes the wording
 * is a wire check that has started telling the client something about the board.
 */
export function pegDestRefusal(state: GameState, pick: ChoicePick): string | null {
  if (pick.kind !== 'peg-dest') return null;
  const from = findArea(state, pick.areaId);
  if (from === undefined || from.peg === null) return 'that voter may not be moved';
  // p18: a peg in a Volatile Area is permanent. A majority peg IS the score (p20), so
  // relocating one would move points rather than position.
  if (from.volatile || from.peg.majority) return 'that voter may not be moved';
  const to = findArea(state, pick.toAreaId);
  if (to === undefined || to.peg !== null) return 'that is not an empty area in an adjacent zone';
  return null;
}

function findArea(
  state: GameState,
  id: AreaID,
): { readonly peg: { readonly owner: PlayerID; readonly majority: boolean } | null; readonly volatile: boolean } | undefined {
  for (const z of state.zones) {
    for (const a of z.areas) if (a.id === id) return a;
  }
  return undefined;
}

/** Every area id on the fixed board — the closed set an `AreaID` has to come from. */
const AREA_IDS: ReadonlySet<string> = new Set(BOARD.flatMap((z) => z.areas.map((a) => a.id)));

/**
 * An area id, checked against the board rather than accepted as a string.
 *
 * The same argument as `zone()` below, one level down: 129 fixed names is a closed set,
 * and `zoneOfArea` will happily return a constituency for any string with a dash in it,
 * so an unchecked id would sail past the adjacency check by naming a zone twice.
 */
function area(v: unknown): AreaID | null {
  return typeof v === 'string' && AREA_IDS.has(v) ? (v as AreaID) : null;
}

// ─────────────────────────── scalar checks ───────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > max) return null;
  // No control characters: they break logs and are never legitimate in a name,
  // a token or a card id.
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  return v;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function smallInt(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}

function resource(v: unknown): Resource | null {
  return typeof v === 'string' && (RESOURCES as readonly string[]).includes(v) ? (v as Resource) : null;
}

function resourceList(v: unknown): readonly Resource[] | null {
  if (!Array.isArray(v) || v.length > 8) return null;
  const out: Resource[] = [];
  for (const x of v) {
    const r = resource(x);
    if (r === null) return null;
    out.push(r);
  }
  return out;
}

function strList(v: unknown, max: number, cap: number): readonly string[] | null {
  if (!Array.isArray(v) || v.length > cap) return null;
  const out: string[] = [];
  for (const x of v) {
    const s = str(x, max);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

function zone(v: unknown): ZoneID | null {
  return typeof v === 'string' && (ZONE_IDS as readonly string[]).includes(v) ? (v as ZoneID) : null;
}

/**
 * A resource cost or payout from the wire.
 *
 * Negative, fractional, non-finite and NaN values are all rejected HERE, at the
 * boundary, rather than being passed to the reducer with a `fail(...)` for a
 * reason the caller cannot act on. `exactOptionalPropertyTypes` also means an
 * absent resource must stay absent: `{funds: undefined}` is a type error, and
 * `deltaTotal` would read it as 0 while the object still carries the key.
 */
function delta(v: unknown): Delta | null {
  if (!isRecord(v)) return null;
  // Only the four resource keys, and no others. A `Delta` carrying a fifth key is
  // not a Delta, and `deltaTotal` would silently ignore it while the object still
  // shipped it.
  for (const k of Object.keys(v)) {
    if (!(RESOURCES as readonly string[]).includes(k)) return null;
  }
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, raw] of Object.entries(v)) {
    const r = resource(k);
    if (r === null) return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0 || raw > 99) {
      return null;
    }
    out[r] = raw;
    n += 1;
  }
  if (n > 4) return null;
  return out;
}

function nonce(value: Record<string, unknown>): { nonce: string } | Record<string, never> {
  const n = value['nonce'];
  if (n === undefined) return {};
  if (typeof n !== 'string' || n.length > 64) return {};
  return { nonce: n };
}

function bad(field: string): DecodeResult {
  return { ok: false, reason: `malformed ${field}` };
}

/**
 * Reject any key the message does not declare.
 *
 * This is the check that stops a client smuggling a field. A client that appends
 * a server-only key to a well-formed message gets a rejection rather than a
 * message the handler quietly ignores — and "quietly ignores" is precisely how a
 * smuggled field would end up being logged on its way to being trusted.
 *
 * It also means adding a field to the protocol without adding it to the decoder is
 * a live, testable difference rather than a silent one.
 */
function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  built: DecodeResult,
): DecodeResult {
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) return { ok: false, reason: 'unexpected field' };
  }
  return built;
}

/**
 * The same smuggling defence one level down, for an action's own keys.
 *
 * An extra key inside an action is the more dangerous of the two, because it is
 * the shape a future refactor would start reading: `if (action.something)` reads
 * as a bug fix, not as a channel. Returns a boolean so a `case` can bail in one
 * line without restructuring its result.
 */
function keysOnly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) return false;
  }
  return true;
}

export function isSeatCount(n: number): n is SeatCount {
  return n === 2 || n === 3 || n === 4 || n === 5;
}
