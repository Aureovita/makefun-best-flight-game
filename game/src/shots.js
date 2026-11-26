// The screenshot scenes behind ?shot=cover|cockpit|landing|complete. Each one puts the real
// world into a fixed, hand-set state — a pose, a mission mid-flight, a result already
// written — rather than playing the game forward, so the frame is exactly the one intended
// and the same seed always gives the same picture. main.js paints the staged scene twice
// (renderer, then HUD) and sets window.__shotReady; tools/take-screenshots.mjs does the rest.

import { VALE_HEIGHT } from './config.js';
import { placeAircraft } from './flight-model.js';
import { buildResult } from './missions.js';

/** Pose the plane: a start spot plus the flight state the still frame should show. */
function pose(world, spot) {
  placeAircraft(world.state.aircraft, spot);
  world.state.aircraft.propPhase = spot.propPhase ?? 1.2;
}

/** The cover: chase view down the vale, the first gate lit ahead, the strip beyond it. */
function stageCover(world) {
  world.reset('rings');
  const firstGate = world.state.terrain.rings[0];
  pose(world, {
    x: 30, y: firstGate.y + 6, z: 1150,
    yaw: 0.02, pitch: 0.02, roll: -0.12, speed: 54, throttle: 0.66, propPhase: 1.2,
  });
  world.state.mission.elapsed = 47.3;
  return { screen: 'play', view: 'chase' };
}

/** The cockpit: three gates down, the fourth ahead over the vale, the dash lit. */
function stageCockpit(world) {
  world.reset('rings');
  const mission = world.state.mission;
  mission.index = 3;
  mission.passed = [0, 1, 2];
  mission.ringsFlown = 3;
  mission.elapsed = 96.4;
  const ring = world.state.terrain.rings[3];
  const aheadX = Math.sin(ring.yaw);
  const aheadZ = -Math.cos(ring.yaw);
  // On the gate's own arrival line, wings level and a little above its centre, so the
  // windscreen holds the gate ahead, the vale below and the field off to the right —
  // nothing between the eye and the world but glass.
  pose(world, {
    x: ring.x - aheadX * 150, y: ring.y + 6, z: ring.z - aheadZ * 150,
    yaw: ring.yaw, pitch: 0, roll: 0, speed: 49, throttle: 0.58, fuel: 61, propPhase: 2.4,
  });
  return { screen: 'play', view: 'cockpit' };
}

/** The landing: on final for runway 36, the threshold ahead, everything quiet and lit. */
function stageLanding(world) {
  world.reset('landing');
  pose(world, {
    x: 8, y: VALE_HEIGHT + 48, z: 580,
    yaw: 0, pitch: -0.06, roll: 0.03, speed: 33, throttle: 0.38, fuel: 74, propPhase: 0.7,
  });
  world.state.mission.elapsed = 38.2;
  return { screen: 'play', view: 'chase' };
}

/** The debrief: the ring course flown, the score written, the plane coasting over the lake. */
function stageComplete(world) {
  world.reset('rings');
  const mission = world.state.mission;
  mission.index = 8;
  mission.passed = [0, 1, 2, 3, 4, 5, 6, 7];
  mission.ringsFlown = 8;
  mission.finished = true;
  mission.elapsed = 214.6;
  pose(world, {
    x: 700, y: 300, z: -500,
    yaw: 2.4, pitch: 0.05, roll: 0.3, speed: 58, throttle: 0.6, fuel: 57, propPhase: 3.1,
  });
  world.state.aircraft.damage = 6;
  world.state.outcome = 'complete';
  world.state.result = buildResult(mission, world.state.aircraft, 'complete', null);
  return { screen: 'complete', view: 'chase' };
}

const SCENES = {
  cover: stageCover,
  cockpit: stageCockpit,
  landing: stageLanding,
  complete: stageComplete,
};

/**
 * Set `world` to the named scene and return the screen and camera view to draw it with.
 * Any other name stages the cover.
 */
export function stageShot(name, world) {
  return (SCENES[name] ?? stageCover)(world);
}
