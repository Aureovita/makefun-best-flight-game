// Kestrel Vale: every tuning number and colour in one place. The world is measured in metres
// on a ground plane where +X is east and +Z is south, Y is up, and a heading of 0 faces
// north (-Z) and grows as the aircraft turns right, toward east. The HUD is drawn on a fixed
// 1280x720 logical canvas that the overlay scales to the window, so no rule below depends
// on the screen size.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The logical size of the HUD overlay canvas. */
export const VIEW = { width: 1280, height: 720 };

/** The terrain is a square WORLD_SIZE across, sampled on a GRID x GRID height grid. */
export const WORLD_SIZE = 4800;
export const GRID = 128;

/** Altitudes the terrain builder works to: the vale floor, the water level, the rim. */
export const VALE_HEIGHT = 46;
export const WATER_LEVEL = 16;

/** The flight model's numbers: speeds in m/s, rates in rad/s, fuel in percent. */
export const FLIGHT = {
  stallSpeed: 27,
  maxSpeed: 108,
  thrustAccel: 15.5,
  dragFactor: 0.0042,
  gravity: 9.81,
  maxBank: 1.05,
  rollRate: 2.4,
  pitchRate: 1.0,
  gearClearance: 1.6,
  fuelBurnIdle: 0.22,
  fuelBurnFull: 0.95,
  fuelLow: 25,
  stressSpeed: 98,
};

/** The ring course: how big a gate is, and how close to its centre still counts as through. */
export const RING = { radius: 26, tube: 2.4, slack: 3 };

export const PALETTE = {
  skyTop: '#33608c',
  skyHorizon: '#f2b880',
  sun: '#ffd9a0',
  fog: '#eec39a',
  grassLow: '#6f9a52',
  grassHigh: '#97a75e',
  dry: '#c9b47e',
  rock: '#8a8178',
  snow: '#f7f3ea',
  water: '#2e6d8c',
  runway: '#42474f',
  runwayMark: '#f6f1de',
  runwayEdge: '#ffd27f',
  planeCream: '#f2e3c2',
  planeRed: '#c33e28',
  planeDark: '#23272e',
  glass: '#1d2f3d',
  treeTrunk: '#6b4a2f',
  treeLeaf: '#4e7d3a',
  treeLeafDry: '#7d8f3f',
  cloud: '#fdf6ec',
  ringNext: '#ffa726',
  ringTodo: '#bfe3ec',
  ringDone: '#58c472',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score for each mission is kept between visits (this browser only). */
export const BEST_KEY = 'kestrel-vale.best';
