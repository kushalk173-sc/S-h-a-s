/**
 * Every tunable number in SHASN, in one place, each with its rulebook citation.
 *
 * Unlike the first draft of this file, nothing here is a guess: the Collectors
 * Edition rulebook was located and extracted. See `docs/rules-reference.md`.
 */

export type Rules = {
  /**
   * p12: "Players have a default resource cap of 12." Total across all four
   * resources — the rulebook says you must *choose* what to discard, which only
   * makes sense for a combined cap.
   */
  readonly resourceCap: number;

  /** p13: pay any 4 resources to have your Ideology Card redrawn before answering. */
  readonly redrawCost: number;

  /** p15/p28: +1 resource per N Ideology Cards of that Ideologue, every turn. */
  readonly passiveBonusPer: number;

  /** p15: Ideologue power unlock thresholds. */
  readonly level3: number;
  readonly level5: number;

  /** p10: face-up Voter Cards on the HQ Mat. */
  readonly marketSize: number;

  /** p16: gerrymander moves per turn, per zone where you hold rights. */
  readonly gerrymandersPerZone: number;
  /** Showstopper L5 "Election Fever" raises the above to this. p31. */
  readonly gerrymandersPerZoneWithFever: number;

  // Per-turn use limits for Ideologue Powers. p29–32.
  readonly prospectingPerTurn: number;
  readonly prospectingTake: number;
  readonly landGrabPerTurn: number;
  readonly donationsPerTurn: number;
  readonly paybackPerTurn: number;
  readonly goingViralPerTurn: number;
  readonly helpingHandsPerTurn: number;
  readonly toughLovePerTurn: number;
  /** p32: Tough Love costs 2 Trust + any 2 resources and converts 2 voters. */
  readonly toughLoveTrust: number;
  readonly toughLoveAny: number;
  readonly toughLoveConverts: number;

  /** p7: Player n receives n resources of their choice at setup. */
  readonly staggeredStart: boolean;
};

export const RULES: Rules = {
  resourceCap: 12,
  redrawCost: 4,
  passiveBonusPer: 2,
  level3: 3,
  level5: 5,
  marketSize: 3,
  gerrymandersPerZone: 1,
  gerrymandersPerZoneWithFever: 2,
  prospectingPerTurn: 1,
  prospectingTake: 2,
  landGrabPerTurn: 3,
  donationsPerTurn: 2,
  paybackPerTurn: 2,
  goingViralPerTurn: 2,
  helpingHandsPerTurn: 2,
  toughLovePerTurn: 1,
  toughLoveTrust: 2,
  toughLoveAny: 2,
  toughLoveConverts: 2,
  staggeredStart: true,
};

/** Player peg colours, in seat order. Chosen for contrast against the parchment board. */
export const PLAYER_COLOURS: readonly string[] = [
  '#c9345a', // crimson
  '#2f7ec2', // cobalt
  '#e0a020', // amber
  '#5f4b9b', // violet
  '#2b9d78', // jade
];
