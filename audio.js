// Procedural WebAudio: wind bed, per-zone ambience crossfaded across the fog gates, drips,
// player footsteps by surface, and a small spatial (HRTF) API for world-positioned event sounds.
// Nothing is created until audio.start() is called from a user gesture.
import * as THREE from 'three';
import * as P from './path.js';

let ctx = null, master, revIn, eventBus, stepPan;
let windGain, windHiGain;
const beds = [];                       // one gain bus per zone [village, forest, estate]
const BED_LEVEL = [1, 1, 1];
const WIND_LEVEL = [0.34, 0.5, 0.26];
const DRIP_EVERY = [1.8, 4.2, 1.3];    // mean seconds between drips per zone
let dripT = 2, distT = 12, stepSide = 1;
const noiseBufs = {};
const fwd = new THREE.Vector3();

function noiseBuf(kind) {
  if (noiseBufs[kind]) return noiseBufs[kind];
  const len = ctx.sampleRate * 4, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return (noiseBufs[kind] = b);
}
function loopNoise(kind) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf(kind); s.loop = true;
  s.start(0, Math.random() * 3); return s;
}
function filt(type, freq, q = 0.7) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
function gain(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
function osc(type, freq) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); return o; }
function lfo(freq, depth, param) { const o = osc('sine', freq), g = gain(depth); o.connect(g).connect(param); }

// One-shot helpers, usable by other modules through the audio object.
function noiseBurst(out, t, { type = 'bandpass', freq = 1000, q = 1, attack = 0.004, dur = 0.1, gain: vol = 0.3 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf('white');
  const f = filt(type, freq, q), g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 2.5, attack + dur + 0.05);
}
function tone(out, t, { freq = 440, freqEnd = null, type = 'sine', attack = 0.004, dur = 0.2, gain: vol = 0.2, lp = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  let n = o; if (lp) n = o.connect(filt('lowpass', lp));
  n.connect(g).connect(out);
  o.start(t); o.stop(t + attack + dur + 0.05);
}

function stepSound(out, t, surface, vol) {
  const j = 0.9 + Math.random() * 0.2;
  if (surface === 'cobble') {
    noiseBurst(out, t, { type: 'bandpass', freq: 1500 * j, q: 1.1, dur: 0.09, gain: 0.9 * vol });
    noiseBurst(out, t + 0.012, { type: 'lowpass', freq: 500, dur: 0.22, gain: 0.5 * vol });
    tone(out, t, { freq: 120 * j, freqEnd: 60, dur: 0.09, gain: 0.6 * vol });
  } else if (surface === 'dirt') {
    noiseBurst(out, t, { type: 'lowpass', freq: 420 * j, attack: 0.015, dur: 0.2, gain: 1.0 * vol });
    tone(out, t, { freq: 80, freqEnd: 50, dur: 0.1, gain: 0.4 * vol });
    if (Math.random() < 0.12) noiseBurst(out, t + 0.05, { type: 'highpass', freq: 3500, dur: 0.02, gain: 0.5 * vol });
  } else if (surface === 'gravel') {
    for (let i = 0; i < 5; i++) noiseBurst(out, t + i * 0.022 + Math.random() * 0.01, { type: 'highpass', freq: 1800 + Math.random() * 1500, dur: 0.03, gain: 0.45 * vol });
    tone(out, t, { freq: 90, freqEnd: 55, dur: 0.1, gain: 0.35 * vol });
  } else { // wood
    tone(out, t, { freq: 150 * j, freqEnd: 75, dur: 0.12, gain: 0.8 * vol });
    noiseBurst(out, t, { type: 'bandpass', freq: 700, q: 2, dur: 0.08, gain: 0.5 * vol });
  }
}

function makePanner(pos) {
  const p = new PannerNode(ctx, {
    panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, maxDistance: 200, rolloffFactor: 1.3,
    positionX: pos.x, positionY: pos.y, positionZ: pos.z,
  });
  p.connect(eventBus);
  return p;
}

// Spatial one-shot: playAt({x,y,z}, (ctx, out, t) => {...build nodes into out...}, durationSec).
// Returns the PannerNode (positionX/Y/Z are AudioParams, so a caller may move it).
function playAt(pos, build, dur = 2) {
  if (!ctx) return null;
  const p = makePanner(pos);
  build(ctx, p, ctx.currentTime + 0.02);
  setTimeout(() => p.disconnect(), (dur + 0.5) * 1000);
  return p;
}
function footstepAt(pos, surface = 'dirt', vol = 0.3) { return playAt(pos, (c, out, t) => stepSound(out, t, surface, vol), 0.6); }

function build() {
  const comp = ctx.createDynamicsCompressor();
  master = gain(0.9); master.connect(comp).connect(ctx.destination);

  // short reverb, shared by drips and spatial events
  const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let y = 0;
    for (let i = 0; i < len; i++) { y += 0.3 * ((Math.random() * 2 - 1) - y); d[i] = y * Math.pow(1 - i / len, 2.5); }
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  revIn = gain(1); revIn.connect(conv).connect(gain(0.6)).connect(master);
  eventBus = gain(1); eventBus.connect(master); eventBus.connect(gain(0.35)).connect(revIn);
  stepPan = new StereoPannerNode(ctx, { pan: 0 });
  stepPan.connect(master); stepPan.connect(gain(0.2)).connect(revIn);

  // wind: brown noise through a drifting bandpass, plus a thin whistle
  const bp = filt('bandpass', 380, 0.7);
  windGain = gain(0.3);
  loopNoise('brown').connect(bp).connect(windGain).connect(master);
  lfo(0.07, 160, bp.frequency); lfo(0.11, 0.06, windGain.gain);
  const wh = filt('bandpass', 900, 8);
  windHiGain = gain(0.012);
  loopNoise('white').connect(wh).connect(windHiGain).connect(master);
  lfo(0.05, 300, wh.frequency); lfo(0.13, 0.008, windHiGain.gain);

  // zone beds
  const v = gain(0); // village: sodium lamp hum + distant low rumble
  osc('sine', 100).connect(gain(0.010)).connect(v); osc('sine', 200).connect(gain(0.004)).connect(v);
  loopNoise('brown').connect(filt('lowpass', 140)).connect(gain(0.3)).connect(v);
  const f = gain(0); // forest: leaf rustle + low drone
  const rg = gain(0.03); loopNoise('white').connect(filt('highpass', 2500)).connect(filt('bandpass', 5000, 0.4)).connect(rg).connect(f);
  lfo(0.17, 0.02, rg.gain);
  osc('sine', 55).connect(gain(0.05)).connect(f); osc('sine', 55.6).connect(gain(0.05)).connect(f);
  const e = gain(0); // estate: cold detuned drone + room tone
  const lp = filt('lowpass', 180); lp.connect(gain(0.06)).connect(e);
  osc('sawtooth', 55).connect(lp); osc('sawtooth', 55.5).connect(lp);
  const ag = gain(0.02); loopNoise('white').connect(filt('bandpass', 700, 0.8)).connect(ag).connect(e);
  lfo(0.09, 0.012, ag.gain); lfo(0.06, 40, lp.frequency);
  [v, f, e].forEach((b) => { b.connect(master); beds.push(b); });
}

function drip(zone) {
  const a = Math.random() * 6.283, r = 2.5 + Math.random() * 9;
  const pos = { x: audio.lx + Math.cos(a) * r, y: Math.random() * 1.5, z: audio.lz + Math.sin(a) * r };
  playAt(pos, (c, out, t) => {
    const f = 700 + Math.random() * 1100;
    tone(out, t, { freq: f, freqEnd: f * 1.6, dur: 0.07, gain: zone === 2 ? 0.16 : 0.1 });
    if (Math.random() < 0.4) tone(out, t + 0.16, { freq: f * 0.8, freqEnd: f * 1.3, dur: 0.05, gain: 0.04 });
  }, 0.5);
}

function distant(zone) { // far, quiet, zone-flavoured one-shot
  const a = Math.random() * 6.283, r = 70 + Math.random() * 40;
  const pos = { x: audio.lx + Math.cos(a) * r, y: 2, z: audio.lz + Math.sin(a) * r };
  playAt(pos, (c, out, t) => {
    if (zone === 0) { // muffled bell / clank
      tone(out, t, { freq: 310, dur: 3, gain: 0.12, lp: 900 }); tone(out, t, { freq: 466, dur: 2.2, gain: 0.07, lp: 900 });
    } else if (zone === 1) { // creaking wood, a snap
      tone(out, t, { freq: 140, freqEnd: 88, type: 'sawtooth', dur: 0.9, gain: 0.05, lp: 500 });
      noiseBurst(out, t + 0.7, { type: 'highpass', freq: 2500, dur: 0.03, gain: 0.25 });
    } else { // somewhere in the house: a heavy door
      tone(out, t, { freq: 60, freqEnd: 35, dur: 0.5, gain: 0.4 });
      noiseBurst(out, t, { type: 'lowpass', freq: 300, dur: 0.5, gain: 0.4 });
    }
  }, 3.5);
}

function start() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    build();
  }
  if (ctx.state !== 'running') ctx.resume();
}

function update(dt, s, camera) {
  if (!ctx) return;
  audio.lx = camera.position.x; audio.lz = camera.position.z;
  const l = ctx.listener;
  camera.getWorldDirection(fwd);
  if (l.positionX) {
    l.positionX.value = camera.position.x; l.positionY.value = camera.position.y; l.positionZ.value = camera.position.z;
    l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(camera.position.x, camera.position.y, camera.position.z);
    l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
  }
  const now = ctx.currentTime, w = P.zoneWeights(s), inside = P.interiorAt(s);
  w.forEach((x, i) => beds[i].gain.setTargetAtTime(x * BED_LEVEL[i], now, 0.35));
  const wl = (w[0] * WIND_LEVEL[0] + w[1] * WIND_LEVEL[1] + w[2] * WIND_LEVEL[2]) * (1 - 0.7 * inside);
  windGain.gain.setTargetAtTime(Math.max(0.12, wl), now, 0.35);
  windHiGain.gain.setTargetAtTime(0.012 * (1 - 0.8 * inside), now, 0.35);

  const zi = P.zoneIndex(s);
  dripT -= dt; distT -= dt;
  if (dripT <= 0) { drip(zi); dripT = DRIP_EVERY[zi] * (0.4 + Math.random() * 1.2) / (1 + inside * 0.5); }
  if (distT <= 0) { distant(zi); distT = 14 + Math.random() * 18; }
}

function footstep(surface, brisk) {
  if (!ctx) return;
  stepSide = -stepSide; stepPan.pan.value = stepSide * 0.12;
  stepSound(stepPan, ctx.currentTime, surface, brisk ? 0.2 : 0.13);
}

export const audio = {
  start, update, footstep, playAt, footstepAt, makePanner, noiseBurst, tone, stepSound, lx: 0, lz: 0,
  get ctx() { return ctx; },
  get ready() { return !!ctx && ctx.state === 'running'; },
};
