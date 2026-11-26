// The aircraft: one prop plane's state and the rules that move it. Nothing here draws or
// touches the browser; the world feeds it control inputs and a ground height, and reads back
// where the plane went. The model is an arcade one with real discipline in it: speed is
// energy, traded against climb and lost in turns; below the stall speed the wing gives up,
// the nose drops and the controls go soft; the engine drinks fuel faster the harder it works.

import { FLIGHT } from './config.js';

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** Move `value` toward `target` by at most `amount`. */
function approach(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  return Math.max(target, value - amount);
}

/** The unit vector the nose points along, from heading (0 = north) and pitch (up positive). */
export function forwardVector(state) {
  const cosPitch = Math.cos(state.pitch);
  return {
    x: Math.sin(state.yaw) * cosPitch,
    y: Math.sin(state.pitch),
    z: -Math.cos(state.yaw) * cosPitch,
  };
}

/** A plane parked at a position, engine off, tanks full, nothing bent. */
export function createAircraft() {
  return {
    pos: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: 100,
    damage: 0,
    sink: 0,
    verticalSpeed: 0,
    propPhase: 0,
    onGround: true,
    stalled: false,
    overspeed: false,
  };
}

/** Put the plane in the air at a spot, flying a heading, ready to be stepped. */
export function placeAircraft(state, spot) {
  state.pos.x = spot.x;
  state.pos.y = spot.y;
  state.pos.z = spot.z;
  state.yaw = spot.yaw ?? 0;
  state.pitch = spot.pitch ?? 0;
  state.roll = spot.roll ?? 0;
  state.speed = spot.speed ?? 0;
  state.throttle = spot.throttle ?? 0;
  state.fuel = spot.fuel ?? 100;
  state.damage = 0;
  state.sink = 0;
  state.verticalSpeed = 0;
  state.onGround = spot.speed === 0;
}

/**
 * Advance the plane one step. `controls` is { pitch, roll, throttle } each in -1..1: pitch
 * positive climbs, roll positive banks right, throttle is a rate the lever moves at.
 * `groundY` is the terrain height under the plane (without gear clearance); the world, not
 * the model, decides what touching it means.
 */
export function stepAircraft(state, controls, dt, groundY) {
  // The lever, the tanks and the engine.
  state.throttle = clamp(state.throttle + controls.throttle * dt * 0.7, 0, 1);
  const burn = (FLIGHT.fuelBurnIdle + state.throttle * FLIGHT.fuelBurnFull) * dt;
  state.fuel = Math.max(0, state.fuel - burn);
  const engine = state.fuel > 0 ? state.throttle : 0;

  // Control authority grows with airspeed; a stalled wing answers late and weakly.
  const stalled = state.speed < FLIGHT.stallSpeed && !state.onGround;
  state.stalled = stalled;
  let authority = clamp((state.speed - 10) / 30, 0.25, 1);
  if (stalled) authority *= 0.5;

  // Bank toward the stick, then let the bank swing the nose around: a coordinated turn.
  const bankTarget = controls.roll * FLIGHT.maxBank * (state.onGround ? 0.15 : 1);
  state.roll = approach(state.roll, bankTarget, FLIGHT.rollRate * dt * (state.onGround ? 1 : authority + 0.4));
  const yawRate = state.onGround ? 0 : (FLIGHT.gravity * Math.tan(state.roll)) / Math.max(state.speed, 22);
  state.yaw += clamp(yawRate, -0.65, 0.65) * dt;

  // Pitch follows the stick; a stalled wing also drags the nose down on its own.
  const pitchTargetRate = controls.pitch * FLIGHT.pitchRate * authority;
  state.pitch = clamp(state.pitch + pitchTargetRate * dt, -1.15, 0.95);
  if (stalled) state.pitch = approach(state.pitch, -0.42, 0.55 * dt);

  // Speed is energy: thrust against drag, the climb and the turn all take their cut.
  const turnDrag = Math.abs(yawRate) * state.speed * 0.028;
  let accel = engine * FLIGHT.thrustAccel - FLIGHT.dragFactor * state.speed * state.speed - FLIGHT.gravity * Math.sin(state.pitch) - turnDrag;
  if (state.onGround) accel -= state.speed * 0.35 + 1.2;
  state.speed = clamp(state.speed + accel * dt, 0, FLIGHT.maxSpeed);

  // A wing short of lift sags: the sag builds while the speed is low and bleeds off as it recovers.
  if (stalled) state.sink = approach(state.sink, ((FLIGHT.stallSpeed - state.speed) / FLIGHT.stallSpeed) * 12, 9 * dt);
  else state.sink = approach(state.sink, 0, 14 * dt);

  // Move along the nose; the vertical speed is what a landing is judged on.
  const ahead = forwardVector(state);
  state.pos.x += ahead.x * state.speed * dt;
  state.pos.z += ahead.z * state.speed * dt;
  state.verticalSpeed = ahead.y * state.speed - state.sink;
  state.pos.y += state.verticalSpeed * dt;

  // Overspeed stresses the airframe; the propeller spins with the engine.
  state.overspeed = state.speed > FLIGHT.stressSpeed;
  if (state.overspeed) state.damage = Math.min(100, state.damage + dt * 2.5);
  state.propPhase += dt * (3 + engine * 42 + state.speed * 0.12);

  // On the ground the plane sits at gear height and follows it; leaving it is the world's call.
  const gearY = groundY + FLIGHT.gearClearance;
  if (state.onGround && state.pos.y < gearY) state.pos.y = gearY;
  return state;
}

/** True when the plane's belly has reached the ground under it. */
export function touchesGround(state, groundY) {
  return state.pos.y <= groundY + FLIGHT.gearClearance + 0.001;
}
