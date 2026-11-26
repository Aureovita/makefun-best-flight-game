// How the pilot's hands reach the aeroplane. The keyboard is primary: the arrow keys (and
// A/D) work the stick, W/S (or Shift/Ctrl) work the throttle lever, the mouse wheel nudges
// it too, and holding the mouse button steers toward the pointer for gentler hands.
// One-shot presses — confirm, pause, camera, sound, mission picks — are queued as bit flags
// and taken once by the loop, so a press between two frames is never lost or counted twice.
// read() reports the stick for the flight model: pitch +1 climbs, roll +1 banks right, and
// throttle is a rate, +1 pushing the lever forward as fast as it goes.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_CAMERA = 4;
export const ACTION_MUTE = 8;
export const ACTION_BACK = 16;
export const ACTION_MISSION_1 = 32;
export const ACTION_MISSION_2 = 64;
export const ACTION_MISSION_3 = 128;

const HELD_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
]);
const NO_SCROLL = new Set([...HELD_KEYS, 'Space']);

function clampUnit(value) {
  return Math.max(-1, Math.min(1, value));
}

export function createInput(target) {
  const keys = new Set();
  let actions = 0;
  let mouse = { active: false, x: 0.5, y: 0.5 };
  let stick = { pitch: 0, roll: 0 };
  let throttlePulse = 0;
  let throttlePulseUntil = 0;

  window.addEventListener('keydown', (event) => {
    if (NO_SCROLL.has(event.code)) event.preventDefault();
    if (!event.repeat) {
      if (event.code === 'Enter' || event.code === 'Space') actions |= ACTION_CONFIRM;
      else if (event.code === 'KeyP') actions |= ACTION_PAUSE;
      else if (event.code === 'KeyC') actions |= ACTION_CAMERA;
      else if (event.code === 'KeyM') actions |= ACTION_MUTE;
      else if (event.code === 'Escape') actions |= ACTION_BACK;
      else if (event.code === 'Digit1') actions |= ACTION_MISSION_1;
      else if (event.code === 'Digit2') actions |= ACTION_MISSION_2;
      else if (event.code === 'Digit3') actions |= ACTION_MISSION_3;
    }
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => keys.clear());

  target.addEventListener('pointerdown', (event) => {
    mouse = { active: true, x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
  });
  window.addEventListener('pointermove', (event) => {
    if (mouse.active) mouse = { active: true, x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
  });
  window.addEventListener('pointerup', () => { mouse.active = false; });
  target.addEventListener('wheel', (event) => {
    throttlePulse = event.deltaY < 0 ? 2.2 : -2.2;
    throttlePulseUntil = performance.now() + 160;
  }, { passive: true });

  function held(...codes) {
    return codes.some((code) => keys.has(code));
  }

  return {
    /** The stick and throttle rate for this frame, keyboard and mouse blended. */
    read() {
      let pitch = (held('ArrowUp') ? 1 : 0) - (held('ArrowDown') ? 1 : 0);
      let roll = (held('ArrowRight', 'KeyD') ? 1 : 0) - (held('ArrowLeft', 'KeyA') ? 1 : 0);
      if (mouse.active) {
        // Pointer above centre climbs, below descends; the stick eases toward the hand.
        stick.pitch += ((0.5 - mouse.y) * 1.8 - stick.pitch) * 0.2;
        stick.roll += ((mouse.x - 0.5) * 2.2 - stick.roll) * 0.2;
        if (Math.abs(stick.pitch) > Math.abs(pitch)) pitch = stick.pitch;
        if (Math.abs(stick.roll) > Math.abs(roll)) roll = stick.roll;
      } else {
        stick.pitch *= 0.75;
        stick.roll *= 0.75;
      }
      let throttle = (held('KeyW', 'ShiftLeft', 'ShiftRight') ? 1 : 0) - (held('KeyS', 'ControlLeft', 'ControlRight') ? 1 : 0);
      if (performance.now() < throttlePulseUntil) throttle += throttlePulse;
      return { pitch: clampUnit(pitch), roll: clampUnit(roll), throttle: clampUnit(throttle) };
    },
    /** The one-shot presses since the last call, as ACTION_* flags; reading clears them. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
