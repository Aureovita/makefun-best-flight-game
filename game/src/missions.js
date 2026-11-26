// The sorties on offer and how each is judged. A mission is a small state machine the world
// steps: it watches the aeroplane, notices rings threaded and touchdowns made, and when the
// sortie ends it writes the result the debrief panel shows — a title, the scored lines and a
// verdict. Nothing here draws or flies; it only keeps score.

import { RING } from './config.js';
import { RUNWAY, onRunway } from './terrain.js';

export const MISSION_RINGS = 'rings';
export const MISSION_LANDING = 'landing';
export const MISSION_FREE = 'free';

export const MISSIONS = [
  {
    id: MISSION_RINGS,
    name: 'Ring Runner',
    brief: 'Thread all eight gates down the vale, out over the lake and home. Fast is good; fast and smooth is better.',
    objective: 'Fly through the orange gate, then the next.',
  },
  {
    id: MISSION_LANDING,
    name: 'Homecoming',
    brief: 'You are on a long final for Vale Field. Bring her home: on the strip, nose into the north, gentle enough to walk away smiling.',
    objective: 'Land on the runway, heading north, sink under 4 m/s.',
  },
  {
    id: MISSION_FREE,
    name: 'Free Flight',
    brief: 'No gates, no clock that matters. Explore the vale, mind the fuel, and put her down somewhere kind when you are done.',
    objective: 'Fly as you please. Land to finish.',
  },
];

export function missionById(id) {
  return MISSIONS.find((mission) => mission.id === id) ?? MISSIONS[0];
}

/** A fresh mission state: nothing flown, the clock at zero, the first gate waiting. */
export function createMissionState(definition) {
  return {
    definition,
    index: 0,
    passed: [],
    elapsed: 0,
    finished: false,
    ringsFlown: 0,
    bestSplit: 0,
  };
}

/**
 * Watch the plane cross the current gate's plane: inside the ring counts, and the gate is
 * done. `previous` is where the plane was last step, so a fast frame cannot jump the check.
 */
function crossedRing(ring, previous, current) {
  const normal = { x: Math.sin(ring.yaw), z: -Math.cos(ring.yaw) };
  const before = (previous.x - ring.x) * normal.x + (previous.z - ring.z) * normal.z;
  const after = (current.x - ring.x) * normal.x + (current.z - ring.z) * normal.z;
  if (before === 0 || before * after > 0) return false;
  const t = before / (before - after);
  const crossX = previous.x + (current.x - previous.x) * t;
  const crossY = previous.y + (current.y - previous.y) * t;
  const crossZ = previous.z + (current.z - previous.z) * t;
  const off = Math.hypot(crossX - ring.x, crossY - ring.y, crossZ - ring.z);
  return off <= ring.radius - RING.slack;
}

/**
 * Step the mission with the plane's movement this frame. Returns flags:
 * { ring: true } when a gate was threaded. Completion is the world's to declare, since it
 * also depends on the ground; this only advances progress and the clock.
 */
export function stepMission(mission, rings, previous, aircraft, dt) {
  const events = { ring: false };
  if (mission.finished) return events;
  mission.elapsed += dt;
  if (mission.definition.id === MISSION_RINGS && mission.index < rings.length) {
    const ring = rings[mission.index];
    if (crossedRing(ring, previous, aircraft.pos)) {
      mission.passed.push(mission.index);
      mission.index += 1;
      mission.ringsFlown += 1;
      events.ring = true;
      if (mission.index >= rings.length) mission.finished = true;
    }
  }
  return events;
}

/** Judge a touchdown on the strip: how it reads decides the score, and whether it was one at all. */
export function judgeTouchdown(aircraft, groundY) {
  const centreOffset = Math.abs(aircraft.pos.x - RUNWAY.x);
  const sink = -aircraft.verticalSpeed;
  const onStrip = onRunway(aircraft.pos.x, aircraft.pos.z, 4);
  const headingError = Math.abs(((aircraft.yaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
  if (!onStrip) return { kind: 'field', centreOffset, sink };
  if (headingError > 0.35) return { kind: 'wrongway', centreOffset, sink };
  if (sink > 9.5 || aircraft.speed > 74) return { kind: 'crash', centreOffset, sink };
  if (sink > 6) return { kind: 'hard', centreOffset, sink };
  if (sink > 3.4 || aircraft.speed > 58) return { kind: 'firm', centreOffset, sink };
  return { kind: 'greased', centreOffset, sink };
}

/** Format a number of seconds as m:ss.t, the way the debrief shows a time. */
export function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/**
 * Write the debrief for a finished sortie. `ending` is how it ended: 'complete' (the mission
 * done), 'down' (put down somewhere, mission unfinished) or 'crashed'. The lines are the
 * scored facts; the verdict is one sentence in the instructor's voice.
 */
export function buildResult(mission, aircraft, ending, touchdown) {
  const lines = [];
  let score = 0;
  if (mission.definition.id === MISSION_RINGS) {
    lines.push(['Gates threaded', `${mission.ringsFlown} of 8`]);
    score += mission.ringsFlown * 1000;
    if (ending === 'complete') {
      lines.push(['Course time', formatTime(mission.elapsed)]);
      const timeBonus = Math.max(0, 2600 - Math.round(mission.elapsed * 10));
      lines.push(['Time bonus', `${timeBonus}`]);
      score += timeBonus;
    }
  }
  if (mission.definition.id === MISSION_LANDING && touchdown) {
    const judged = { greased: 3000, firm: 2100, hard: 900, wrongway: 300, field: 0, crash: 0 }[touchdown.kind] ?? 0;
    lines.push(['Touchdown', touchdown.kind === 'greased' ? 'Greased her on' : touchdown.kind]);
    lines.push(['Sink at contact', `${touchdown.sink.toFixed(1)} m/s`]);
    lines.push(['Centreline offset', `${touchdown.centreOffset.toFixed(0)} m`]);
    lines.push(['Landing score', `${judged}`]);
    score += judged;
  }
  const fuelBonus = Math.round(aircraft.fuel * 12);
  lines.push(['Fuel remaining', `${aircraft.fuel.toFixed(0)}% (+${fuelBonus})`]);
  score += fuelBonus;
  if (aircraft.damage > 0) {
    const bent = Math.round(aircraft.damage * 6);
    lines.push(['Airframe bent', `-${bent}`]);
    score -= bent;
  }
  score = Math.max(0, score);
  const verdicts = {
    complete: score > 9000 ? 'Textbook. The vale approves.' : score > 5500 ? 'A clean sortie, well flown.' : 'Done, if not always pretty.',
    down: 'Down in one piece. The walk back is long, though.',
    crashed: 'The vale keeps what it catches. Fly gentler.',
  };
  const titles = { complete: 'Mission complete', down: 'Down in the valley', crashed: 'Crashed' };
  return { title: titles[ending], lines, score, verdict: verdicts[ending] };
}
