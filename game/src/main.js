// Boot and the one loop. The world advances in fixed 1/60 s steps (several in a slow frame,
// none in a fast one) while the renderer and the HUD paint what is there; this file owns the
// screens the game moves between — title, briefing, play, paused, and the debrief — and what
// each key, click and world event means on each of them. Sound starts on the first gesture,
// as browsers require, and the best score per mission is kept in local storage.
//
// ?seed=N fixes the vale (default 7). ?shot=cover|cockpit|landing|complete stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.

import { BEST_KEY, STEP } from './config.js';
import { createWorld, EVENT_BOUNCE, EVENT_COMPLETE, EVENT_CRASH, EVENT_RING, EVENT_TOUCHDOWN } from './world.js';
import {
  ACTION_BACK, ACTION_CAMERA, ACTION_CONFIRM, ACTION_MISSION_1, ACTION_MISSION_2, ACTION_MISSION_3,
  ACTION_MUTE, ACTION_PAUSE, createInput,
} from './input.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;

const glCanvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const status = document.getElementById('status');
const world = createWorld(seed);
const renderer = createRenderer(glCanvas, world.state.terrain);
const hud = createHud(hudCanvas);
const audio = createAudio();

function announce(message) {
  status.textContent = message;
}

function loadBest() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}');
    return { rings: parsed.rings ?? null, landing: parsed.landing ?? null };
  } catch {
    return { rings: null, landing: null };
  }
}

function saveBest(best) {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    // Storage can be off (private windows): the best lasts this visit only.
  }
}

function rendererScene(viewOverride, orbitT) {
  const state = world.state;
  return { aircraft: state.aircraft, rings: state.terrain.rings, mission: state.mission, view: viewOverride, orbitT };
}

function runShot(name) {
  const staged = stageShot(name, world);
  const state = world.state;
  const scene = {
    screen: staged.screen,
    aircraft: state.aircraft,
    mission: state.mission,
    result: state.result,
    outcome: state.outcome,
    crashReason: state.crashReason,
    view: staged.view,
    agl: Math.max(0, state.aircraft.pos.y - state.terrain.heightAt(state.aircraft.pos.x, state.aircraft.pos.z)),
    notice: '',
    noticeAge: 99,
    best: loadBest(),
    muted: false,
  };
  let painted = 0;
  function paint() {
    if (renderer) renderer.draw(rendererScene(staged.view, 0), 0);
    else window.__shotError = 'webgl-unavailable';
    hud.draw(scene);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(hudCanvas);
  const best = loadBest();
  let screen = 'title';
  let selected = 'rings';
  let view = 'chase';
  let orbitT = 0;
  let clock = 0;
  let notice = '';
  let noticeAt = -99;
  let accumulator = 0;
  let last = performance.now();

  function sayNotice(message) {
    notice = message;
    noticeAt = clock;
  }

  function hudScene() {
    const state = world.state;
    return {
      screen,
      aircraft: state.aircraft,
      mission: state.mission,
      result: state.result,
      outcome: state.outcome,
      crashReason: state.crashReason,
      view,
      agl: Math.max(0, state.aircraft.pos.y - state.terrain.heightAt(state.aircraft.pos.x, state.aircraft.pos.z)),
      notice,
      noticeAge: clock - noticeAt,
      best,
      muted: audio.muted,
    };
  }

  function toBrief(missionId) {
    selected = missionId;
    world.reset(missionId);
    screen = 'brief';
    if (renderer) renderer.snapCamera();
    announce(`${world.state.mission.definition.name}. ${world.state.mission.definition.brief}`);
  }

  function toPlay() {
    screen = 'play';
    if (renderer) renderer.snapCamera();
    audio.startEngine();
    announce(`Flying. ${world.state.mission.definition.objective}`);
  }

  function toTitle() {
    world.reset(selected);
    screen = 'title';
    announce('Kestrel Vale. Pick a mission.');
  }

  function finishSortie() {
    const state = world.state;
    screen = state.outcome === 'crashed' ? 'crashed' : 'complete';
    const id = state.mission.definition.id;
    if ((id === 'rings' || id === 'landing') && state.result && (best[id] == null || state.result.score > best[id])) {
      best[id] = state.result.score;
      saveBest(best);
    }
    if (state.outcome === 'crashed') {
      audio.crash();
      announce(`Crashed. ${state.crashReason}`);
    } else {
      audio.complete();
      announce(`${state.result.title}. Score ${state.result.score}.`);
    }
  }

  function handleEvents(events) {
    const state = world.state;
    if (events & EVENT_RING) {
      audio.gate();
      sayNotice(state.mission.index >= 8 ? 'Final gate — the course is yours' : `Gate ${state.mission.ringsFlown} of 8`);
      announce(`Gate ${state.mission.ringsFlown} of 8 threaded.`);
    }
    if (events & EVENT_TOUCHDOWN) {
      const firmness = { greased: 0.2, firm: 0.5, hard: 0.85, wrongway: 0.5, field: 0.6, crash: 1 }[state.touchdown?.kind] ?? 0.5;
      audio.touchdown(firmness);
      if (state.touchdown?.kind === 'greased') sayNotice('Greased her on');
      else if (state.touchdown?.kind === 'hard') sayNotice('Heavy arrival — she is bent');
    }
    if (events & EVENT_BOUNCE) announce('A heavy arrival. The airframe is bent.');
    if (events & (EVENT_COMPLETE | EVENT_CRASH)) finishSortie();
  }

  function handleClick(action) {
    if (!action) return;
    audio.startEngine();
    if (action.startsWith('mission:')) {
      audio.click();
      toBrief(action.slice('mission:'.length));
    } else if (action === 'fly' && screen === 'brief') toPlay();
    else if (action === 'resume' && screen === 'paused') toPlay();
    else if (action === 'again' && (screen === 'complete' || screen === 'crashed')) {
      world.reset(selected);
      toPlay();
    } else if (action === 'hangar') toTitle();
  }

  hudCanvas.addEventListener('click', (event) => handleClick(hud.hitTest(event.clientX, event.clientY)));
  window.addEventListener('pointerdown', () => audio.startEngine(), { once: true });
  window.addEventListener('keydown', () => audio.startEngine(), { once: true });

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) announce(audio.toggleMute() ? 'Sound off.' : 'Sound on.');
    if (screen === 'title') {
      if (actions & ACTION_MISSION_1) toBrief('rings');
      else if (actions & ACTION_MISSION_2) toBrief('landing');
      else if (actions & ACTION_MISSION_3) toBrief('free');
      else if (actions & ACTION_CONFIRM) toBrief(selected);
    } else if (screen === 'brief') {
      if (actions & ACTION_CONFIRM) toPlay();
      else if (actions & ACTION_BACK) toTitle();
    } else if (screen === 'play') {
      if (actions & (ACTION_PAUSE | ACTION_BACK)) {
        screen = 'paused';
        announce('Paused.');
      } else if (actions & ACTION_CAMERA) {
        view = view === 'chase' ? 'cockpit' : 'chase';
        if (renderer) renderer.snapCamera();
        announce(view === 'cockpit' ? 'Cockpit view.' : 'Chase view.');
      }
    } else if (screen === 'paused') {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) toPlay();
      else if (actions & ACTION_BACK) toTitle();
    } else if (screen === 'complete' || screen === 'crashed') {
      if (actions & ACTION_CONFIRM) {
        world.reset(selected);
        toPlay();
      } else if (actions & ACTION_BACK) toTitle();
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    clock = now / 1000;
    handleActions();
    if (screen === 'title') orbitT += dt * 0.05;
    if (screen === 'play') {
      const controls = input.read();
      accumulator += dt;
      let guard = 0;
      while (accumulator >= STEP && guard < 6 && screen === 'play') {
        handleEvents(world.step(STEP, controls));
        accumulator -= STEP;
        guard += 1;
      }
      if (guard >= 6) accumulator = 0;
      audio.update(world.state.aircraft);
    } else {
      accumulator = 0;
    }
    if (renderer) renderer.draw(rendererScene(screen === 'title' ? 'orbit' : view, orbitT), dt);
    hud.draw(hudScene());
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') {
      screen = 'paused';
      announce('Paused.');
    }
  });

  if (!renderer) announce('Kestrel Vale needs WebGL, and this browser did not provide it.');
  else announce('Kestrel Vale. Pick a mission.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
