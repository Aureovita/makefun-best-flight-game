// The world the loop steps: the terrain, the aeroplane and the mission being flown, bound
// together. The world owns the moments the model cannot decide alone — what the ground
// does to a plane that reaches it, whether a touchdown was a landing or an arrival — and
// reports them as event flags, so the loop can answer with sound and announcements without
// the world knowing about either. Screens live in main.js; this is only the sortie.

import { FLIGHT } from './config.js';
import { createTerrain, onRunway } from './terrain.js';
import { createAircraft, placeAircraft, stepAircraft, touchesGround } from './flight-model.js';
import { buildResult, createMissionState, judgeTouchdown, missionById, stepMission } from './missions.js';

export const EVENT_RING = 1;
export const EVENT_TOUCHDOWN = 2;
export const EVENT_COMPLETE = 4;
export const EVENT_CRASH = 8;
export const EVENT_BOUNCE = 16;

/** Where each mission begins: airborne, set up for the work, the field in view. */
const STARTS = {
  rings(terrain) {
    return { x: 60, y: terrain.heightAt(60, 1420) + 120, z: 1420, yaw: 0, speed: 52, throttle: 0.62 };
  },
  landing(terrain) {
    return { x: 42, y: terrain.heightAt(42, 1560) + 140, z: 1560, yaw: 0, speed: 47, throttle: 0.42 };
  },
  free(terrain) {
    return { x: -340, y: terrain.heightAt(-340, 940) + 165, z: 940, yaw: 0.35, speed: 55, throttle: 0.6 };
  },
};

export function createWorld(seed) {
  const terrain = createTerrain(seed);
  const aircraft = createAircraft();
  const state = {
    terrain,
    aircraft,
    mission: createMissionState(missionById('rings')),
    outcome: null,
    crashReason: '',
    result: null,
    touchdown: null,
  };

  /** Begin a sortie: a fresh plane on the mission's start line, the clock at zero. */
  function reset(missionId) {
    const definition = missionById(missionId);
    state.mission = createMissionState(definition);
    state.outcome = null;
    state.crashReason = '';
    state.result = null;
    state.touchdown = null;
    placeAircraft(aircraft, STARTS[definition.id](terrain));
  }

  /** End the sortie where it lies and write its debrief. */
  function finish(ending, reason = '') {
    if (state.outcome) return 0;
    state.outcome = ending;
    state.crashReason = reason;
    state.result = buildResult(state.mission, aircraft, ending, state.touchdown);
    return ending === 'crashed' ? EVENT_CRASH : EVENT_COMPLETE;
  }

  /**
   * The ground's say. The plane has reached the land under it: on the strip, flown gently,
   * it is a landing; anywhere else, or any harder, it is damage or worse. Returns events.
   */
  function meetGround(events) {
    const groundY = terrain.heightAt(aircraft.pos.x, aircraft.pos.z);
    if (!touchesGround(aircraft, groundY)) {
      if (aircraft.onGround && aircraft.verticalSpeed > 2.5) aircraft.onGround = false;
      return events;
    }
    aircraft.pos.y = groundY + FLIGHT.gearClearance;
    const wasFlying = !aircraft.onGround;
    if (wasFlying) {
      const judged = judgeTouchdown(aircraft, groundY);
      state.touchdown = judged;
      events |= EVENT_TOUCHDOWN;
      if (judged.kind === 'crash') {
        aircraft.damage = 100;
        return events | finish('crashed', judged.centreOffset > 30 ? 'Came down off the strip, too fast to walk away.' : 'Hit the ground too hard — the airframe is done.');
      }
      if (judged.kind === 'hard') {
        aircraft.damage = Math.min(100, aircraft.damage + 34);
        events |= EVENT_BOUNCE;
      } else if (judged.kind === 'firm') {
        aircraft.damage = Math.min(100, aircraft.damage + 10);
      }
      aircraft.onGround = true;
      aircraft.pitch = Math.max(aircraft.pitch, 0);
      if (state.mission.definition.id === 'landing') {
        if (judged.kind === 'greased' || judged.kind === 'firm' || judged.kind === 'hard') {
          return events | finish('complete');
        }
        if (judged.kind === 'wrongway') {
          return events | finish('down', 'Down safely — but the strip runs north, and you landed south.');
        }
        return events | finish('down', 'Down in the rough beside the field.');
      }
      if (judged.kind === 'field' || judged.kind === 'wrongway') {
        return events | finish('down', 'Put down in the valley, away from the field.');
      }
      // A landing on the strip in the middle of another mission is a pause, not an ending:
      // the plane may roll, and take off again if the pilot chooses.
    }
    // Rolling: rough ground at speed bends the plane; a full stop ends the sortie kindly.
    if (aircraft.onGround) {
      if (!onRunway(aircraft.pos.x, aircraft.pos.z, 6) && aircraft.speed > 26) {
        aircraft.damage = Math.min(100, aircraft.damage + 26 * (1 / 60));
        if (aircraft.damage >= 100) return events | finish('crashed', 'The rough ground tore the gear away.');
      }
      if (aircraft.speed <= 0.4 && state.mission.definition.id !== 'landing') {
        return events | finish(state.mission.finished ? 'complete' : 'down');
      }
    }
    return events;
  }

  /**
   * One fixed step of the sortie under `controls` ({ pitch, roll, throttle }). Returns the
   * EVENT_* flags of anything that happened, for sound and announcements.
   */
  function step(dt, controls) {
    let events = 0;
    if (state.outcome) return events;
    const previous = { x: aircraft.pos.x, y: aircraft.pos.y, z: aircraft.pos.z };
    const groundY = terrain.heightAt(aircraft.pos.x, aircraft.pos.z);
    stepAircraft(aircraft, controls, dt, groundY);
    const missionEvents = stepMission(state.mission, terrain.rings, previous, aircraft, dt);
    if (missionEvents.ring) events |= EVENT_RING;
    events |= meetGround(events);
    if (!state.outcome && state.mission.finished && state.mission.definition.id === 'rings') {
      events |= finish('complete');
    }
    if (!state.outcome && aircraft.fuel <= 0 && aircraft.onGround) {
      events |= finish('down', 'Out of fuel, and out of sky to trade for time.');
    }
    // The world's edge is a wall of weather: turn a departing plane gently home.
    const edge = 2280;
    if (Math.abs(aircraft.pos.x) > edge || Math.abs(aircraft.pos.z) > edge) {
      const home = Math.atan2(-aircraft.pos.x, aircraft.pos.z);
      aircraft.yaw += clampTurn(home - aircraft.yaw, dt * 0.5);
    }
    return events;
  }

  function clampTurn(delta, maxStep) {
    const wrapped = ((delta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return Math.max(-maxStep, Math.min(maxStep, wrapped));
  }

  reset('rings');
  return { state, reset, step };
}
