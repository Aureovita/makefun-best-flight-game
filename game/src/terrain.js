// The vale itself: a seeded heightfield with a flat valley floor running north, a lake in
// the south-east basin, rim mountains around the edges and one grass-and-asphalt field on
// the valley floor. This module owns the shape of the land and everything fixed in it (the
// runway, the ring course, the trees and rocks); it draws nothing. The same seed always
// builds the same vale, which is what makes flights and screenshots repeatable.

import { GRID, PALETTE, RING, VALE_HEIGHT, WATER_LEVEL, WORLD_SIZE } from './config.js';
import { createRandom } from './random.js';

const HALF = WORLD_SIZE / 2;
const CELL = WORLD_SIZE / GRID;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A small tileable value-noise field: random corner heights, smoothly interpolated. */
function makeNoise(random, period) {
  const values = new Float32Array(period * period);
  for (let index = 0; index < values.length; index += 1) values[index] = random();
  return function noise(x, z) {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const sx = xf * xf * (3 - 2 * xf);
    const sz = zf * zf * (3 - 2 * zf);
    const at = (a, b) => values[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
    const top = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * sx;
    const bottom = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * sx;
    return top + (bottom - top) * sz;
  };
}

/** The runway: a north-facing strip on the vale floor. Its south end is the landing threshold. */
export const RUNWAY = {
  x: 0,
  zNear: 60,
  zFar: -660,
  width: 46,
  heading: 0,
  get zCenter() {
    return (this.zNear + this.zFar) / 2;
  },
  get length() {
    return this.zNear - this.zFar;
  },
};

/** Is a point over the runway strip (with a little apron of forgiveness at the edges)? */
export function onRunway(x, z, margin = 0) {
  return Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2 + margin && z <= RUNWAY.zNear + margin && z >= RUNWAY.zFar - margin;
}

export function createTerrain(seed) {
  const random = createRandom(seed);
  const coarse = makeNoise(random, 16);
  const fine = makeNoise(random, 64);
  const heights = new Float32Array((GRID + 1) * (GRID + 1));

  function rawHeight(x, z) {
    // Rolling country first: two octaves of hills.
    let height = 30 + coarse(x / 620 + 40, z / 620 + 40) * 150 + fine(x / 150 + 9, z / 150 + 9) * 26;
    // Rim mountains shoulder up toward the borders, so the vale feels held in.
    const rim = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    height += smoothstep(0.52, 1.0, rim) * 460;
    // A lake basin in the south-east: press the land below the water line.
    const lakeDist = Math.hypot(x - 1080, z - 1020);
    height = height * (1 - smoothstep(560, 240, lakeDist)) + 6 * smoothstep(560, 240, lakeDist);
    // The valley: a calm floor down the middle, running the whole way north.
    const valley = Math.exp(-((x / 430) ** 2));
    const floor = VALE_HEIGHT + fine(x / 300 + 3, z / 300 + 3) * 7;
    height = height * (1 - valley * 0.94) + floor * valley * 0.94;
    // The field itself is dead level: blend to the vale height across the strip and its shoulders.
    const dx = Math.max(0, Math.abs(x - RUNWAY.x) - RUNWAY.width / 2 - 30);
    const dz = Math.max(0, Math.max(RUNWAY.zFar - 90 - z, z - (RUNWAY.zNear + 90)));
    const flat = smoothstep(120, 0, Math.hypot(dx, dz));
    height = height * (1 - flat) + VALE_HEIGHT * flat;
    return height;
  }

  for (let j = 0; j <= GRID; j += 1) {
    for (let i = 0; i <= GRID; i += 1) {
      heights[j * (GRID + 1) + i] = rawHeight(-HALF + i * CELL, -HALF + j * CELL);
    }
  }

  /** The land height at any point, bilinearly interpolated from the grid. */
  function heightAt(x, z) {
    const gx = clamp((x + HALF) / CELL, 0, GRID - 0.001);
    const gz = clamp((z + HALF) / CELL, 0, GRID - 0.001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const row = GRID + 1;
    const a = heights[j * row + i];
    const b = heights[j * row + i + 1];
    const c = heights[(j + 1) * row + i];
    const d = heights[(j + 1) * row + i + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /** How steep the land is at a point, as a 0..1 slope from the height gradient. */
  function slopeAt(x, z) {
    const step = 14;
    const dx = heightAt(x + step, z) - heightAt(x - step, z);
    const dz = heightAt(x, z + step) - heightAt(x, z - step);
    return clamp(Math.hypot(dx, dz) / (2 * step) / 0.9, 0, 1);
  }

  /** The ground's colour at a point: grass by height, sand at the shore, rock on the steep, snow high up. */
  function colorAt(x, z) {
    const height = heightAt(x, z);
    const slope = slopeAt(x, z);
    const patch = fine(x / 210 + 21, z / 210 + 21);
    let color = height < VALE_HEIGHT + 26 ? PALETTE.grassLow : PALETTE.grassHigh;
    if (patch > 0.62) color = PALETTE.dry;
    if (height < WATER_LEVEL + 3.5) color = PALETTE.dry;
    if (slope > 0.52) color = PALETTE.rock;
    if (height > 330 && slope < 0.75) color = PALETTE.snow;
    return color;
  }

  // The ring course: down the valley, out over the lake and home again. Each ring faces the
  // way the course arrives at it, and floats a comfortable height over the land below.
  const ringPath = [
    [0, 1080],
    [-120, 690],
    [130, 330],
    [-90, -60],
    [170, -430],
    [560, -760],
    [1010, -540],
    [760, -60],
  ];
  const rings = ringPath.map(([x, z], index) => {
    const [nextX, nextZ] = ringPath[(index + 1) % ringPath.length];
    return {
      x,
      z,
      y: Math.max(heightAt(x, z) + 62, VALE_HEIGHT + 66),
      yaw: Math.atan2(nextX - x, -(nextZ - z)),
      radius: RING.radius,
    };
  });

  // Scattered life: pines on the gentle low slopes, rocks where it is steep. None on the
  // strip, in the lake, or in the valley's flying corridor.
  const trees = [];
  const rocks = [];
  const scatter = createRandom(seed ^ 0x5f3759df);
  for (let tries = 0; tries < 5200 && (trees.length < 420 || rocks.length < 130); tries += 1) {
    const x = (scatter() * 2 - 1) * (HALF - 120);
    const z = (scatter() * 2 - 1) * (HALF - 120);
    const height = heightAt(x, z);
    if (height < WATER_LEVEL + 3 || onRunway(x, z, 60)) continue;
    const slope = slopeAt(x, z);
    if (slope < 0.42 && height < 265 && trees.length < 420 && Math.abs(x) > 130) {
      trees.push({ x, z, y: height, scale: 0.8 + scatter() * 0.9, dry: scatter() > 0.72 });
    } else if (slope >= 0.42 && rocks.length < 130) {
      rocks.push({ x, z, y: height, scale: 0.7 + scatter() * 1.6, turn: scatter() * Math.PI });
    }
  }

  return { heights, heightAt, slopeAt, colorAt, rings, trees, rocks, waterLevel: WATER_LEVEL };
}
