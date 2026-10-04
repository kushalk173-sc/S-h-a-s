import type { AreaID, CardID, Delta, PlayerID, Resource, ZoneID } from './state';

/**
 * Everything a player can do. p21 lists the turn actions; each one below maps to a
 * bullet on that page, plus the choice/acknowledgement plumbing a digital table
 * needs where a physical table just uses hands and eye contact.
 */
export type Action =
  /** p13/p21: pay any 4 resources to have your Ideology Card redrawn before answering. */
  | { readonly type: 'REDRAW_IDEOLOGY'; readonly pay: Delta }
  /** The blind answer. The client sends a side index and never sees the payout. */
  | { readonly type: 'ANSWER'; readonly side: 0 | 1 }

  /** p10: spend resources on one of the three face-up Voter Cards. */
  | {
      readonly type: 'INFLUENCE';
      readonly slot: number;
      /** Idealist L3 Helping Hands — one entry per discount used. p32. */
      readonly discounts?: readonly Resource[];
      /** Showstopper L3 Going Viral — +1 voter on this card. p31. */
      readonly viral?: boolean;
    }
  /** Place voters from one pending group. p10. */
  | { readonly type: 'PLACE_VOTERS'; readonly groupId: string; readonly areaIds: readonly AreaID[] }

  /** p16: move one non-majority voter using a zone where you hold Gerrymandering Rights. */
  | {
      readonly type: 'GERRYMANDER';
      readonly zoneId: ZoneID;
      readonly fromAreaId: AreaID;
      readonly toAreaId: AreaID;
    }

  /** p12: any ratio, at least 1 resource from each side, active player involved. */
  | {
      readonly type: 'TRADE';
      readonly withPlayer: PlayerID;
      readonly give: Delta;
      readonly receive: Delta;
      readonly giveCards?: readonly CardID[];
      readonly receiveCards?: readonly CardID[];
    }

  /** p19: buy the top Conspiracy Card for any combination totalling its printed cost. */
  | { readonly type: 'BUY_CONSPIRACY'; readonly pay: Delta; readonly discounts?: readonly Resource[] }
  | { readonly type: 'PLAY_CONSPIRACY'; readonly cardId: CardID }

  // ── Ideologue Powers. p29–32. ──
  | { readonly type: 'POWER_PROSPECT'; readonly give: Resource; readonly take: readonly Resource[] }
  | { readonly type: 'POWER_LAND_GRAB'; readonly areaId: AreaID }
  | { readonly type: 'POWER_DONATIONS'; readonly from: PlayerID; readonly res: Resource }
  | { readonly type: 'POWER_PAYBACK'; readonly areaId: AreaID; readonly pay: Resource }
  | {
      readonly type: 'POWER_TOUGH_LOVE';
      readonly areaIds: readonly AreaID[];
      readonly pay: Delta;
      readonly discounts?: readonly Resource[];
    }

  /** Resolve a pending decision raised by a card, a power, or the resource cap. */
  | { readonly type: 'RESOLVE_CHOICE'; readonly choiceId: string; readonly pick: ChoicePick }
  /** p18/p21: acknowledge the face-up Headline, applying its effects. */
  | { readonly type: 'ACK_HEADLINE' }
  | { readonly type: 'END_TURN' }

  // ── G13: the response window. See `state.ts` `InterruptWindow`. ──
  //
  // Both are legal for ANY player, including the active one, and both are refused
  // outright while no window is open. `RESPOND_INTERRUPT` plays a held BLOCK or
  // DEFLECT into the open window; `PASS_INTERRUPT` declines it. The second one
  // exists for the deadlock argument rather than for the game: it is the move that
  // guarantees a window is always closable, so no table can ever be waiting on a
  // player who has nothing to play.
  //
  // `RESPOND_INTERRUPT` is the whole reason the client needs no new `Choice` kind
  // for DEFLECT: the redirect target rides on the action rather than in a
  // `PendingChoice`, so nothing in the public `choices` array ever says "this player
  // holds a Deflect" before they have played it.
  | { readonly type: 'RESPOND_INTERRUPT'; readonly cardId: CardID; readonly at?: PlayerID }
  | { readonly type: 'PASS_INTERRUPT' };

export type ChoicePick =
  | { readonly kind: 'resources'; readonly res: Delta }
  | { readonly kind: 'steal'; readonly from: PlayerID; readonly res: Delta }
  | { readonly kind: 'areas'; readonly areaIds: readonly AreaID[] }
  /**
   * G1 — answer a `'choose-player'` decision by naming a seat.
   *
   * A single `id`, not a list, because `'choose-player'.count` is 1 for every
   * recovered card and POLO RETREAT's 2 is not being shipped. One pick per decision
   * also means one `RESOLVE_CHOICE` per named player, so a card wanting several
   * players raises several decisions — which keeps `resolveChoice`'s job single-seat
   * and keeps the failure mode of a bad pick local to one player.
   */
  | { readonly kind: 'player'; readonly id: PlayerID }
  /** G16 — answer a `'choose-zone'` decision by naming one of the nine constituencies. */
  | { readonly kind: 'zone'; readonly zoneId: ZoneID }
  /**
   * G17 — answer a `'choose-card'` decision by naming ONE card.
   *
   * A `CardID` and not a pile name, because the decision already carries the set it
   * was offered (`Choice`'s `'choose-card'.cards`) and the resolver validates the
   * pick against the LIVE recycle pile as well — so this is a member of a published
   * list, not an instruction to reach into anything.
   *
   * One id, not a list, for the reason `player` is one id: `'choose-card'.count` is
   * 1 for every recovered card, and one pick per decision keeps the failure mode of a
   * bad pick local to one decision. A card wanting several cards raises several
   * decisions — which IS SELECTIVE ACCESS MEMORY's *"it can be in any order"*, one
   * decision per card, each offering what is left.
   *
   * A pick naming a card that is not in the offered set is refused by `reduce`, not
   * merely ignored: `resolveChoice` is the only authority on the candidate set, and a
   * silent ignore is how a player is shown they succeeded when they did not.
   */
  | { readonly kind: 'card'; readonly cardId: CardID }
  /**
   * G1 - answer a `'choose-peg-dest'` decision by naming BOTH halves of one move.
   *
   * `areaId` is the voter to move and `toAreaId` is where it lands. They are ONE pick
   * rather than two ids on one action because the printed card is one action
   * ("may move 1 of your non-majority voters to an adjacent zone") and because a two-step
   * dialog would ask its satisfiability question twice: once over the pegs and again
   * over the destinations, after the board had already moved under the first answer.
   *
   * `areaId` names an area rather than a `ZoneID`, because a zone has many areas and
   * only one of them is the peg; `toAreaId` is the empty area itself rather than the
   * destination zone, because the destination is where the peg LANDS and p10 places a
   * group in a named area, not in a constituency.
   *
   * A pick whose pair is not jointly legal — a majority peg, a Volatile-Area peg,
   * somebody else's peg, a destination that is occupied, or a destination not adjacent
   * to the source — is REFUSED by `reduce`, not merely ignored, for the reason
   * `choose-card` records: `resolveChoice` is the only authority on the candidate set,
   * and a silent ignore is how a player is shown they succeeded when they did not.
   */
  | { readonly kind: 'peg-dest'; readonly areaId: AreaID; readonly toAreaId: AreaID };

export type GameEvent =
  | { readonly type: 'answered'; readonly player: PlayerID; readonly cardId: CardID; readonly side: 0 | 1 }
  | { readonly type: 'influenced'; readonly player: PlayerID; readonly voters: number }
  | { readonly type: 'placed'; readonly player: PlayerID; readonly areaIds: readonly AreaID[] }
  | { readonly type: 'majority-formed'; readonly zoneId: ZoneID; readonly player: PlayerID }
  | { readonly type: 'majority-broken'; readonly zoneId: ZoneID; readonly player: PlayerID }
  | { readonly type: 'gerrymandered'; readonly player: PlayerID; readonly from: AreaID; readonly to: AreaID }
  | { readonly type: 'headline'; readonly cardId: CardID }
  | { readonly type: 'conspiracy'; readonly player: PlayerID; readonly cardId: CardID }
  | { readonly type: 'volatile'; readonly player: PlayerID; readonly areaId: AreaID }
  | { readonly type: 'turn-ended'; readonly player: PlayerID }
  | { readonly type: 'final-round'; readonly startingWith: PlayerID }
  | { readonly type: 'game-over'; readonly winners: readonly PlayerID[] };

export type Result =
  | { readonly ok: true; readonly state: import('./state').GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: string };
