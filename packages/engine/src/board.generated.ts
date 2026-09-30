/**
 * GENERATED FILE — do not edit. Run `node scripts/gen-board.mjs`.
 *
 * The SHASN board: 9 zones, 129 voter areas, 11 volatile areas.
 * Coordinates are in a 1000 × 1500 viewBox; the client renders them directly.
 */

import type { ZoneID } from './state';

export type AreaSpec = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly volatile: boolean;
};

export type ZoneSpec = {
  readonly id: ZoneID;
  readonly name: string;
  readonly majority: number;
  readonly capacity: number;
  readonly neighbours: readonly ZoneID[];
  /** Polygon outline in board coordinates. */
  readonly poly: readonly (readonly [number, number])[];
  /** Where to anchor the "6/11" label. */
  readonly label: readonly [number, number];
  readonly areas: readonly AreaSpec[];
};

export const BOARD_WIDTH = 1000;
export const BOARD_HEIGHT = 1500;

/** The coastline, drawn behind the zones. */
export const COASTLINE: readonly (readonly [number, number])[] = [
  [500, 25],
  [700, 45],
  [880, 130],
  [950, 320],
  [960, 560],
  [930, 800],
  [955, 1030],
  [880, 1260],
  [690, 1410],
  [500, 1470],
  [310, 1420],
  [130, 1300],
  [65, 1040],
  [95, 800],
  [40, 545],
  [75, 270],
  [255, 55],
];

export const BOARD: readonly ZoneSpec[] = [
  {
    id: 'north_west',
    name: 'North West',
    majority: 6,
    capacity: 11,
    neighbours: ['north', 'north_east', 'west'],
    label: [291, 272],
    poly: [[500, 25], [500, 235], [345, 320], [320, 455], [40, 545], [75, 270], [255, 55]],
    areas: [
      { id: 'north_west-01', x: 277, y: 148, volatile: false },
      { id: 'north_west-02', x: 371, y: 148, volatile: false },
      { id: 'north_west-03', x: 466, y: 148, volatile: false },
      { id: 'north_west-04', x: 229, y: 230, volatile: false },
      { id: 'north_west-05', x: 324, y: 230, volatile: false },
      { id: 'north_west-06', x: 419, y: 230, volatile: false },
      { id: 'north_west-07', x: 182, y: 312, volatile: true },
      { id: 'north_west-08', x: 277, y: 312, volatile: false },
      { id: 'north_west-09', x: 135, y: 394, volatile: false },
      { id: 'north_west-10', x: 229, y: 394, volatile: false },
      { id: 'north_west-11', x: 87, y: 476, volatile: false },
    ],
  },
  {
    id: 'north',
    name: 'North',
    majority: 11,
    capacity: 21,
    neighbours: ['north_west', 'north_east', 'west', 'central', 'east'],
    label: [521, 446],
    poly: [[500, 235], [730, 345], [755, 530], [600, 625], [400, 610], [320, 455], [345, 320]],
    areas: [
      { id: 'north-01', x: 426, y: 327, volatile: false },
      { id: 'north-02', x: 497, y: 327, volatile: false },
      { id: 'north-03', x: 568, y: 327, volatile: false },
      { id: 'north-04', x: 391, y: 388, volatile: false },
      { id: 'north-05', x: 462, y: 388, volatile: false },
      { id: 'north-06', x: 533, y: 388, volatile: false },
      { id: 'north-07', x: 604, y: 388, volatile: false },
      { id: 'north-08', x: 674, y: 388, volatile: false },
      { id: 'north-09', x: 426, y: 450, volatile: false },
      { id: 'north-10', x: 497, y: 450, volatile: false },
      { id: 'north-11', x: 568, y: 450, volatile: true },
      { id: 'north-12', x: 639, y: 450, volatile: false },
      { id: 'north-13', x: 710, y: 450, volatile: false },
      { id: 'north-14', x: 391, y: 511, volatile: false },
      { id: 'north-15', x: 462, y: 511, volatile: false },
      { id: 'north-16', x: 533, y: 511, volatile: false },
      { id: 'north-17', x: 604, y: 511, volatile: false },
      { id: 'north-18', x: 674, y: 511, volatile: false },
      { id: 'north-19', x: 426, y: 573, volatile: false },
      { id: 'north-20', x: 497, y: 573, volatile: false },
      { id: 'north-21', x: 568, y: 573, volatile: false },
    ],
  },
  {
    id: 'north_east',
    name: 'North East',
    majority: 6,
    capacity: 11,
    neighbours: ['north_west', 'north', 'east'],
    label: [747, 274],
    poly: [[500, 25], [700, 45], [880, 130], [950, 320], [960, 560], [755, 530], [730, 345], [500, 235]],
    areas: [
      { id: 'north_east-01', x: 550, y: 156, volatile: false },
      { id: 'north_east-02', x: 651, y: 156, volatile: true },
      { id: 'north_east-03', x: 752, y: 156, volatile: false },
      { id: 'north_east-04', x: 853, y: 156, volatile: false },
      { id: 'north_east-05', x: 601, y: 244, volatile: false },
      { id: 'north_east-06', x: 702, y: 244, volatile: false },
      { id: 'north_east-07', x: 803, y: 244, volatile: false },
      { id: 'north_east-08', x: 853, y: 331, volatile: false },
      { id: 'north_east-09', x: 803, y: 419, volatile: false },
      { id: 'north_east-10', x: 904, y: 419, volatile: false },
      { id: 'north_east-11', x: 853, y: 506, volatile: false },
    ],
  },
  {
    id: 'west',
    name: 'West',
    majority: 9,
    capacity: 17,
    neighbours: ['north_west', 'north', 'central', 'south_west', 'south'],
    label: [200, 756],
    poly: [[40, 545], [320, 455], [400, 610], [300, 835], [180, 1010], [65, 1040], [95, 800]],
    areas: [
      { id: 'west-01', x: 149, y: 550, volatile: false },
      { id: 'west-02', x: 222, y: 550, volatile: false },
      { id: 'west-03', x: 295, y: 550, volatile: false },
      { id: 'west-04', x: 113, y: 613, volatile: false },
      { id: 'west-05', x: 186, y: 613, volatile: false },
      { id: 'west-06', x: 259, y: 613, volatile: false },
      { id: 'west-07', x: 332, y: 613, volatile: false },
      { id: 'west-08', x: 149, y: 676, volatile: false },
      { id: 'west-09', x: 222, y: 676, volatile: true },
      { id: 'west-10', x: 295, y: 676, volatile: false },
      { id: 'west-11', x: 186, y: 739, volatile: false },
      { id: 'west-12', x: 259, y: 739, volatile: false },
      { id: 'west-13', x: 149, y: 803, volatile: false },
      { id: 'west-14', x: 222, y: 803, volatile: false },
      { id: 'west-15', x: 186, y: 866, volatile: false },
      { id: 'west-16', x: 149, y: 929, volatile: true },
      { id: 'west-17', x: 113, y: 992, volatile: false },
    ],
  },
  {
    id: 'central',
    name: 'Central',
    majority: 5,
    capacity: 9,
    neighbours: ['north', 'west', 'east', 'south'],
    label: [450, 730],
    poly: [[400, 610], [600, 625], [500, 850], [300, 835]],
    areas: [
      { id: 'central-01', x: 433, y: 679, volatile: false },
      { id: 'central-02', x: 486, y: 679, volatile: false },
      { id: 'central-03', x: 539, y: 679, volatile: false },
      { id: 'central-04', x: 406, y: 725, volatile: false },
      { id: 'central-05', x: 459, y: 725, volatile: true },
      { id: 'central-06', x: 512, y: 725, volatile: false },
      { id: 'central-07', x: 380, y: 771, volatile: false },
      { id: 'central-08', x: 433, y: 771, volatile: false },
      { id: 'central-09', x: 486, y: 771, volatile: false },
    ],
  },
  {
    id: 'east',
    name: 'East',
    majority: 9,
    capacity: 17,
    neighbours: ['north', 'north_east', 'central', 'south', 'south_east'],
    label: [763, 768],
    poly: [[600, 625], [755, 530], [960, 560], [930, 800], [955, 1030], [640, 980], [500, 850]],
    areas: [
      { id: 'east-01', x: 776, y: 570, volatile: false },
      { id: 'east-02', x: 638, y: 650, volatile: false },
      { id: 'east-03', x: 730, y: 650, volatile: false },
      { id: 'east-04', x: 822, y: 650, volatile: true },
      { id: 'east-05', x: 915, y: 650, volatile: false },
      { id: 'east-06', x: 592, y: 729, volatile: false },
      { id: 'east-07', x: 684, y: 729, volatile: false },
      { id: 'east-08', x: 776, y: 729, volatile: false },
      { id: 'east-09', x: 868, y: 729, volatile: false },
      { id: 'east-10', x: 638, y: 809, volatile: false },
      { id: 'east-11', x: 730, y: 809, volatile: true },
      { id: 'east-12', x: 822, y: 809, volatile: false },
      { id: 'east-13', x: 592, y: 889, volatile: false },
      { id: 'east-14', x: 684, y: 889, volatile: false },
      { id: 'east-15', x: 776, y: 889, volatile: false },
      { id: 'east-16', x: 868, y: 889, volatile: false },
      { id: 'east-17', x: 822, y: 969, volatile: false },
    ],
  },
  {
    id: 'south_west',
    name: 'South West',
    majority: 6,
    capacity: 11,
    neighbours: ['west', 'south', 'south_east'],
    label: [269, 1251],
    poly: [[65, 1040], [180, 1010], [250, 1230], [450, 1290], [500, 1470], [310, 1420], [130, 1300]],
    areas: [
      { id: 'south_west-01', x: 157, y: 1090, volatile: false },
      { id: 'south_west-02', x: 126, y: 1143, volatile: false },
      { id: 'south_west-03', x: 157, y: 1196, volatile: false },
      { id: 'south_west-04', x: 188, y: 1249, volatile: false },
      { id: 'south_west-05', x: 218, y: 1302, volatile: false },
      { id: 'south_west-06', x: 280, y: 1302, volatile: false },
      { id: 'south_west-07', x: 341, y: 1302, volatile: false },
      { id: 'south_west-08', x: 310, y: 1355, volatile: false },
      { id: 'south_west-09', x: 371, y: 1355, volatile: true },
      { id: 'south_west-10', x: 433, y: 1355, volatile: false },
      { id: 'south_west-11', x: 402, y: 1408, volatile: false },
    ],
  },
  {
    id: 'south',
    name: 'South',
    majority: 11,
    capacity: 21,
    neighbours: ['west', 'central', 'east', 'south_west', 'south_east'],
    label: [413, 1059],
    poly: [[300, 835], [500, 850], [640, 980], [570, 1215], [450, 1290], [250, 1230], [180, 1010]],
    areas: [
      { id: 'south-01', x: 296, y: 935, volatile: false },
      { id: 'south-02', x: 373, y: 935, volatile: false },
      { id: 'south-03', x: 450, y: 935, volatile: false },
      { id: 'south-04', x: 527, y: 935, volatile: false },
      { id: 'south-05', x: 257, y: 1002, volatile: false },
      { id: 'south-06', x: 334, y: 1002, volatile: false },
      { id: 'south-07', x: 411, y: 1002, volatile: false },
      { id: 'south-08', x: 488, y: 1002, volatile: false },
      { id: 'south-09', x: 565, y: 1002, volatile: false },
      { id: 'south-10', x: 296, y: 1069, volatile: false },
      { id: 'south-11', x: 373, y: 1069, volatile: true },
      { id: 'south-12', x: 450, y: 1069, volatile: false },
      { id: 'south-13', x: 527, y: 1069, volatile: false },
      { id: 'south-14', x: 257, y: 1135, volatile: false },
      { id: 'south-15', x: 334, y: 1135, volatile: false },
      { id: 'south-16', x: 411, y: 1135, volatile: false },
      { id: 'south-17', x: 488, y: 1135, volatile: false },
      { id: 'south-18', x: 296, y: 1202, volatile: false },
      { id: 'south-19', x: 373, y: 1202, volatile: false },
      { id: 'south-20', x: 450, y: 1202, volatile: false },
      { id: 'south-21', x: 527, y: 1202, volatile: false },
    ],
  },
  {
    id: 'south_east',
    name: 'South East',
    majority: 6,
    capacity: 11,
    neighbours: ['east', 'south_west', 'south'],
    label: [669, 1236],
    poly: [[640, 980], [955, 1030], [880, 1260], [690, 1410], [500, 1470], [450, 1290], [570, 1215]],
    areas: [
      { id: 'south_east-01', x: 697, y: 1108, volatile: false },
      { id: 'south_east-02', x: 795, y: 1108, volatile: false },
      { id: 'south_east-03', x: 894, y: 1108, volatile: false },
      { id: 'south_east-04', x: 647, y: 1194, volatile: false },
      { id: 'south_east-05', x: 746, y: 1194, volatile: true },
      { id: 'south_east-06', x: 844, y: 1194, volatile: false },
      { id: 'south_east-07', x: 598, y: 1279, volatile: false },
      { id: 'south_east-08', x: 697, y: 1279, volatile: false },
      { id: 'south_east-09', x: 795, y: 1279, volatile: false },
      { id: 'south_east-10', x: 549, y: 1364, volatile: false },
      { id: 'south_east-11', x: 647, y: 1364, volatile: false },
    ],
  },
];

export const TOTAL_AREAS = 129;
export const TOTAL_MAJORITY_VOTERS = 69;
