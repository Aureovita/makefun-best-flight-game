// Everything drawn flat over the 3D view: the instruments a pilot actually reads (speed and
// altitude tapes, a heading strip, a small attitude ball), the throttle / fuel / damage
// bars, the mission panel and warnings, and every screen the game stops on — title,
// briefing, pause, and the debrief after a sortie, good or bad. The HUD works in a fixed
// 1280x720 space and scales to fit its canvas, so it reads the same at any window size.
// Buttons are drawn here and their rectangles remembered, so main.js can ask what a click
// landed on without the HUD owning any game state.

import { FONT, PALETTE, VIEW } from './config.js';
import { formatTime } from './missions.js';

const INK = '#2a1c10';
const PANEL = 'rgba(34, 22, 13, 0.84)';
const PANEL_EDGE = 'rgba(255, 240, 214, 0.55)';
const CREAM = '#fff3da';
const DIM = '#d9c39a';
const RED = '#e2543e';
const AMBER = '#f0a13c';
const GREEN = '#8fce6e';

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  const buttons = [];
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || VIEW.width;
    const height = canvas.clientHeight || VIEW.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    offsetX = (canvas.width - VIEW.width * scale) / 2;
    offsetY = (canvas.height - VIEW.height * scale) / 2;
  }

  /** What a click at client coordinates landed on, or null. */
  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) * (canvas.width / rect.width) - offsetX) / scale;
    const y = ((clientY - rect.top) * (canvas.height / rect.height) - offsetY) / scale;
    for (const button of buttons) {
      if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) return button.action;
    }
    return null;
  }

  function box(x, y, w, h, fill = PANEL, edge = PANEL_EDGE) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function text(str, x, y, size, color = CREAM, align = 'left', weight = 600) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function button(action, x, y, w, h, label, size = 20) {
    box(x, y, w, h, 'rgba(64, 40, 20, 0.9)');
    text(label, x + w / 2, y + h / 2 + 1, size, CREAM, 'center', 700);
    buttons.push({ action, x, y, w, h });
  }

  function bar(x, y, w, label, fraction, color, valueText) {
    text(label, x, y + 9, 13, DIM, 'left', 700);
    ctx.beginPath();
    ctx.roundRect(x + 44, y, w, 18, 5);
    ctx.fillStyle = 'rgba(20, 12, 6, 0.75)';
    ctx.fill();
    ctx.strokeStyle = PANEL_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
    const fillW = Math.max(0, Math.min(1, fraction)) * (w - 4);
    if (fillW > 0) {
      ctx.beginPath();
      ctx.roundRect(x + 46, y + 2, fillW, 14, 4);
      ctx.fillStyle = color;
      ctx.fill();
    }
    text(valueText, x + 52 + w, y + 9, 13, CREAM, 'left', 700);
  }

  /** A vertical tape: a window of values sliding past a fixed pointer at centre. */
  function tape(x, y, h, value, step, format, label) {
    box(x, y, 96, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y + 26, 92, h - 52);
    ctx.clip();
    const pxPerUnit = 2.4;
    const centre = y + h / 2;
    const first = Math.floor((value - (h / 2) / pxPerUnit) / step) * step;
    for (let v = first; v < value + (h / 2) / pxPerUnit + step; v += step) {
      if (v < 0) continue;
      const ty = centre + (value - v) * pxPerUnit;
      ctx.strokeStyle = 'rgba(255, 243, 218, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x + 66, ty);
      ctx.lineTo(x + 80, ty);
      ctx.stroke();
      text(format(v), x + 60, ty, 13, DIM, 'right', 600);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(x + 82, centre - 9);
    ctx.lineTo(x + 96, centre);
    ctx.lineTo(x + 82, centre + 9);
    ctx.closePath();
    ctx.fillStyle = AMBER;
    ctx.fill();
    text(label, x + 48, y + 14, 12, DIM, 'center', 700);
    text(format(Math.max(0, Math.round(value))), x + 48, y + h - 16, 21, CREAM, 'center', 800);
  }

  function headingStrip(aircraft) {
    const w = 340;
    const x = (VIEW.width - w) / 2;
    const y = 18;
    box(x, y, w, 44);
    const heading = ((aircraft.yaw * 180 / Math.PI) % 360 + 360) % 360;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 4, y + 4, w - 8, 36);
    ctx.clip();
    const pxPerDeg = 3;
    for (let d = -70; d <= 70; d += 5) {
      const deg = Math.round((heading + d) / 5) * 5;
      const shown = ((deg % 360) + 360) % 360;
      const tx = VIEW.width / 2 + (deg - heading) * pxPerDeg;
      if (shown % 15 !== 0) continue;
      const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
      const label = names[shown] ?? `${Math.round(shown / 10)}`;
      text(label, tx, y + 24, shown % 90 === 0 ? 17 : 13, shown % 90 === 0 ? CREAM : DIM, 'center', 700);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(VIEW.width / 2 - 7, y + 44);
    ctx.lineTo(VIEW.width / 2 + 7, y + 44);
    ctx.lineTo(VIEW.width / 2, y + 54);
    ctx.closePath();
    ctx.fillStyle = AMBER;
    ctx.fill();
    text(`${String(Math.round(heading)).padStart(3, '0')}°`, VIEW.width / 2, y + 66, 15, CREAM, 'center', 700);
  }

  /** A small attitude ball: the horizon tilts with the bank and slides with the pitch. */
  function attitude(aircraft) {
    const cx = VIEW.width / 2;
    const cy = 512;
    const r = 52;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-aircraft.roll);
    const drop = Math.max(-46, Math.min(46, aircraft.pitch * 150));
    ctx.fillStyle = '#7fb2d9';
    ctx.fillRect(-r - 8, -r - 8, (r + 8) * 2, r + 8 + drop);
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(-r - 8, drop, (r + 8) * 2, r + 8 - drop);
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r - 8, drop);
    ctx.lineTo(r + 8, drop);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = PANEL_EDGE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 7);
    ctx.stroke();
  }

  function instruments(scene) {
    const { aircraft, mission } = scene;
    tape(28, 218, 300, aircraft.speed * 3.6, 20, (v) => `${v}`, 'SPD km/h');
    tape(1156, 218, 300, scene.agl, 20, (v) => `${v}`, 'ALT m');
    headingStrip(aircraft);
    attitude(aircraft);
    bar(28, 560, 150, 'THR', aircraft.throttle, AMBER, `${Math.round(aircraft.throttle * 100)}%`);
    const fuelColor = aircraft.fuel <= 25 ? RED : GREEN;
    bar(28, 592, 150, 'FUEL', aircraft.fuel / 100, fuelColor, `${aircraft.fuel.toFixed(0)}%`);
    bar(28, 624, 150, 'DMG', aircraft.damage / 100, aircraft.damage > 55 ? RED : '#c9b18a', `${aircraft.damage.toFixed(0)}%`);
    text(scene.view === 'cockpit' ? 'COCKPIT' : 'CHASE', 1156, 560, 13, DIM, 'left', 700);
    text('C camera · P pause · M sound', 1156, 584, 12, 'rgba(217, 195, 154, 0.75)', 'left', 600);

    // The mission panel, top-left: what you are doing and how it is going.
    box(28, 18, 300, 92);
    text(mission.definition.name.toUpperCase(), 44, 40, 16, AMBER, 'left', 800);
    if (mission.definition.id === 'rings') {
      text(`Gates  ${mission.ringsFlown} / 8`, 44, 66, 16);
      text(`Next gate ${mission.index < 8 ? mission.index + 1 : '—'}`, 190, 66, 14, DIM);
    } else if (mission.definition.id === 'landing') {
      text('Vale Field, runway 36', 44, 66, 16);
      text(scene.agl < 60 ? 'Final — hold her steady' : 'On final approach', 44, 88, 13, DIM);
    } else {
      text('The vale is yours', 44, 66, 16);
      text('Land anywhere kind to finish', 44, 88, 13, DIM);
    }
    text(formatTime(mission.elapsed), 312, 40, 16, CREAM, 'right', 700);

    // Warnings, in the order a pilot would want them.
    const warnings = [];
    if (aircraft.stalled) warnings.push(['STALL', RED]);
    if (aircraft.fuel <= 0) warnings.push(['ENGINE OUT — GLIDE', RED]);
    else if (aircraft.fuel <= 25) warnings.push(['FUEL LOW', AMBER]);
    if (aircraft.overspeed) warnings.push(['OVERSPEED', AMBER]);
    if (aircraft.damage >= 70) warnings.push(['AIRFRAME CRITICAL', RED]);
    warnings.forEach(([label, color], i) => {
      const w = 250;
      const x = (VIEW.width - w) / 2;
      const y = 108 + i * 40;
      const blink = color === RED && Math.floor(performance.now() / 400) % 2 === 0;
      box(x, y, w, 32, blink ? 'rgba(120, 30, 18, 0.9)' : PANEL);
      text(label, VIEW.width / 2, y + 17, 16, color, 'center', 800);
    });

    if (scene.notice && scene.noticeAge < 3.2) {
      const alpha = scene.noticeAge < 2.4 ? 1 : 1 - (scene.noticeAge - 2.4) / 0.8;
      ctx.globalAlpha = Math.max(0, alpha);
      text(scene.notice, VIEW.width / 2, 452, 24, CREAM, 'center', 800);
      ctx.globalAlpha = 1;
    }
  }

  function dimScreen() {
    ctx.fillStyle = 'rgba(16, 9, 4, 0.45)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  function titleScreen(scene) {
    dimScreen();
    text('KESTREL VALE', VIEW.width / 2, 128, 84, CREAM, 'center', 800);
    text('V A L L E Y   F L I G H T   S C H O O L', VIEW.width / 2, 182, 20, AMBER, 'center', 700);
    text('Eight gates, one grass strip, and a lake that has seen things.', VIEW.width / 2, 216, 16, DIM, 'center', 600);
    const missions = [
      ['mission:rings', '1 · RING RUNNER', 'Thread the gates down the vale', scene.best.rings],
      ['mission:landing', '2 · HOMECOMING', 'One gentle landing, runway 36', scene.best.landing],
      ['mission:free', '3 · FREE FLIGHT', 'Explore. Land to finish', null],
    ];
    missions.forEach(([action, name, sub, best], i) => {
      const y = 262 + i * 86;
      button(action, 390, y, 500, 72, '', 20);
      text(name, 414, y + 26, 21, CREAM, 'left', 800);
      text(sub, 414, y + 52, 14, DIM, 'left', 600);
      if (best != null) text(`best ${best}`, 866, y + 36, 15, AMBER, 'right', 700);
    });
    text('Arrow keys / A D steer · W S throttle · hold the mouse to steer gently · C camera · P pause', VIEW.width / 2, 556, 15, DIM, 'center', 600);
    text('Sound on first click. Your best scores are kept on this machine.', VIEW.width / 2, 584, 13, 'rgba(217,195,154,0.7)', 'center', 600);
  }

  function briefScreen(scene) {
    dimScreen();
    box(340, 190, 600, 330);
    text(scene.mission.definition.name.toUpperCase(), VIEW.width / 2, 240, 30, AMBER, 'center', 800);
    wrapText(scene.mission.definition.brief, 380, 292, 520, 21, 16, CREAM);
    text(scene.mission.definition.objective, VIEW.width / 2, 420, 16, DIM, 'center', 700);
    button('fly', 490, 448, 300, 48, 'FLY  (Enter)', 19);
  }

  function wrapText(str, x, y, maxWidth, lineHeight, size, color) {
    ctx.font = `600 ${size}px ${FONT}`;
    const words = str.split(' ');
    let line = '';
    let row = 0;
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > maxWidth && line) {
        text(line, x, y + row * lineHeight, size, color, 'left', 600);
        line = word;
        row += 1;
      } else {
        line = trial;
      }
    }
    if (line) text(line, x, y + row * lineHeight, size, color, 'left', 600);
  }

  function pauseScreen() {
    dimScreen();
    box(440, 240, 400, 220);
    text('PAUSED', VIEW.width / 2, 292, 30, CREAM, 'center', 800);
    text('The vale waits. It is patient.', VIEW.width / 2, 330, 15, DIM, 'center', 600);
    button('resume', 490, 356, 300, 44, 'RESUME  (P)', 17);
    button('hangar', 490, 408, 300, 40, 'BACK TO HANGAR  (Esc)', 15);
  }

  function endScreen(scene) {
    dimScreen();
    const { result } = scene;
    box(390, 148, 500, 430);
    text(result.title.toUpperCase(), VIEW.width / 2, 196, 32, scene.outcome === 'crashed' ? RED : AMBER, 'center', 800);
    if (scene.crashReason) text(scene.crashReason, VIEW.width / 2, 232, 14, DIM, 'center', 600);
    result.lines.forEach(([label, value], i) => {
      const y = 272 + i * 30;
      text(label, 430, y, 16, DIM, 'left', 600);
      text(value, 850, y, 16, CREAM, 'right', 700);
    });
    const scoreY = 282 + result.lines.length * 30;
    text('SCORE', 430, scoreY, 15, DIM, 'left', 700);
    text(`${result.score}`, 850, scoreY, 30, CREAM, 'right', 800);
    text(result.verdict, VIEW.width / 2, scoreY + 42, 16, AMBER, 'center', 700);
    button('again', 430, 512, 200, 46, 'FLY AGAIN', 16);
    button('hangar', 650, 512, 200, 46, 'HANGAR', 16);
  }

  /** Paint one frame of overlay for the scene main.js describes. */
  function draw(scene) {
    fit();
    buttons.length = 0;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    ctx.clearRect(-offsetX / scale, -offsetY / scale, canvas.width / scale, canvas.height / scale);
    if (scene.screen === 'title') {
      instruments({ ...scene, notice: '' });
      titleScreen(scene);
      return;
    }
    instruments(scene);
    if (scene.screen === 'brief') briefScreen(scene);
    if (scene.screen === 'paused') pauseScreen();
    if (scene.screen === 'complete' || scene.screen === 'crashed') endScreen(scene);
  }

  return { draw, hitTest };
}
