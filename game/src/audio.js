// Sound with no files: a small WebAudio synth. The engine is two detuned sawtooths and a
// low rumble through a low-pass filter, its pitch and volume following throttle and
// airspeed; the wind is filtered noise that rises with speed. Over both sit the short
// voices the game speaks with — a chime for a gate, a thud for a touchdown, a crunch for a
// crash, a two-note jingle when a sortie ends well. Browsers only allow audio after a
// gesture, so everything starts lazily on the first pointer or key event, and M mutes.

export function createAudio() {
  let context = null;
  let master = null;
  let engineOscA = null;
  let engineOscB = null;
  let engineRumble = null;
  let engineFilter = null;
  let engineGain = null;
  let windSource = null;
  let windFilter = null;
  let windGain = null;
  let muted = false;
  let running = false;

  function ensureContext() {
    if (context) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(context.destination);
    return true;
  }

  function noiseBuffer() {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Start the continuous engine and wind voices. Safe to call on every gesture. */
  function startEngine() {
    if (!ensureContext()) return;
    if (context.state === 'suspended') context.resume();
    if (running) return;
    running = true;
    engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = context.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOscA = context.createOscillator();
    engineOscA.type = 'sawtooth';
    engineOscA.frequency.value = 62;
    engineOscB = context.createOscillator();
    engineOscB.type = 'sawtooth';
    engineOscB.frequency.value = 63.5;
    engineRumble = context.createOscillator();
    engineRumble.type = 'triangle';
    engineRumble.frequency.value = 31;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.5;
    engineOscA.connect(engineFilter);
    engineOscB.connect(engineFilter);
    engineRumble.connect(rumbleGain);
    rumbleGain.connect(engineFilter);
    engineOscA.start();
    engineOscB.start();
    engineRumble.start();

    windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.6;
    windGain = context.createGain();
    windGain.gain.value = 0;
    windSource = context.createBufferSource();
    windSource.buffer = noiseBuffer();
    windSource.loop = true;
    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSource.start();
  }

  /** Shape the continuous voices to the aeroplane, once a frame. */
  function update(aircraft, dt) {
    if (!running || !context) return;
    const t = context.currentTime;
    const rpm = 46 + aircraft.throttle * 68 + aircraft.speed * 0.22;
    engineOscA.frequency.setTargetAtTime(rpm, t, 0.08);
    engineOscB.frequency.setTargetAtTime(rpm * 1.013 + 1.2, t, 0.08);
    engineRumble.frequency.setTargetAtTime(rpm / 2, t, 0.08);
    engineFilter.frequency.setTargetAtTime(300 + aircraft.throttle * 700, t, 0.1);
    const engineLevel = aircraft.fuel > 0 ? 0.05 + aircraft.throttle * 0.11 : 0.012;
    engineGain.gain.setTargetAtTime(engineLevel, t, 0.12);
    windFilter.frequency.setTargetAtTime(280 + aircraft.speed * 9, t, 0.15);
    windGain.gain.setTargetAtTime(Math.min(0.16, aircraft.speed * 0.0016), t, 0.15);
  }

  function blip(frequency, seconds, type, volume, when = 0, slideTo = null) {
    if (!ensureContext()) return;
    const start = context.currentTime + when;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + seconds);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + seconds + 0.05);
  }

  function noiseHit(seconds, volume, frequency) {
    if (!ensureContext()) return;
    const start = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start);
    source.stop(start + seconds + 0.05);
  }

  return {
    startEngine,
    update,
    gate() {
      blip(880, 0.16, 'sine', 0.22);
      blip(1318, 0.22, 'sine', 0.18, 0.07);
    },
    touchdown(firmness) {
      noiseHit(0.18, 0.2 + firmness * 0.2, 300);
      blip(96, 0.2, 'sine', 0.25, 0, 55);
    },
    crash() {
      noiseHit(0.7, 0.5, 700);
      blip(140, 0.6, 'sawtooth', 0.2, 0, 38);
    },
    complete() {
      blip(523, 0.16, 'triangle', 0.22);
      blip(659, 0.16, 'triangle', 0.22, 0.12);
      blip(784, 0.3, 'triangle', 0.24, 0.24);
    },
    click() {
      blip(660, 0.07, 'square', 0.08);
    },
    toggleMute() {
      muted = !muted;
      if (master && context) master.gain.setTargetAtTime(muted ? 0 : 0.9, context.currentTime, 0.03);
      return muted;
    },
    get muted() {
      return muted;
    },
  };
}
