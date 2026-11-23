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

  for (const c of choirs) c.tick();
  for (const c of sobbers) c.tick();
  const zi = P.zoneIndex(s);
  dripT -= dt; distT -= dt;
  if (dripT <= 0) { drip(zi); dripT = DRIP_EVERY[zi] * (0.4 + Math.random() * 1.2) / (1 + inside * 0.5); }
  if (distT <= 0) { distant(zi); distT = 14 + Math.random() * 18; }
}

// ---- the beast's choir: ~12 agonised voices spatialised on the creature (see beast.js) ------------------
// Each voice is a detuned saw + pulse with vibrato and tremor, fed (with breath noise) through three
// vowel-formant bandpass filters, and sings irregular phrases: moans (sagging pitch), sighs, rare high wails.
// Voices are spread over three PannerNodes that follow the beast; `k` (0 far .. 1 close) sets the level and
// how many voices are singing. api: place(x, y, z, k), scuttle(vol), surge(), hush(sec), release().
const VOWELS = [[300, 870, 2240], [730, 1090, 2440], [570, 840, 2410], [530, 1840, 2480], [390, 1990, 2550], [640, 1190, 2390]];
const CHOIR_VOICES = 12, CHOIR_PEAK = 0.17;
const choirs = new Set();

function scuttleSound(out, t, vol) {   // dry skitter of claws plus a wet click
  const n = 2 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) noiseBurst(out, t + i * 0.017 + Math.random() * 0.012, { type: 'bandpass', freq: 2500 + Math.random() * 3500, q: 3, dur: 0.012 + Math.random() * 0.01, gain: 0.5 * vol });
  if (Math.random() < 0.6) {
    const c = Math.random() * 0.04;
    tone(out, t + c, { freq: 500 + Math.random() * 500, freqEnd: 170, type: 'triangle', dur: 0.035, gain: 0.22 * vol });
    noiseBurst(out, t + c, { type: 'bandpass', freq: 900 + Math.random() * 600, q: 6, dur: 0.03, gain: 0.3 * vol });
  }
  if (Math.random() < 0.15) noiseBurst(out, t, { type: 'lowpass', freq: 420, dur: 0.07, gain: 0.35 * vol });   // a wet slap
}

function choir() {
  if (!ctx) return null;
  const srcs = [], buses = [], panners = [];
  for (let i = 0; i < 3; i++) {
    const b = gain(0), p = makePanner({ x: 0, y: 0, z: 0 });
    p.refDistance = 8; p.rolloffFactor = 0.5;
    b.connect(filt('lowpass', 4300, 0.5)).connect(p); buses.push(b); panners.push(p);
  }
  const O = (type, f) => { const o = osc(type, f); srcs.push(o); return o; };
  const voices = [];
  for (let i = 0; i < CHOIR_VOICES; i++) {
    const f0 = [95 + Math.random() * 40, 170 + Math.random() * 80, 250 + Math.random() * 90][i % 3];
    const o1 = O('sawtooth', f0), o2 = O('square', f0 * 1.007), src = gain(1);
    o1.connect(src); o2.connect(gain(0.3)).connect(src);
    const vib = O('sine', 4.5 + Math.random() * 2), vg = gain(f0 * 0.014), tre = O('sine', 8 + Math.random() * 4), tg = gain(f0 * 0.004);
    vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency); tre.connect(tg); tg.connect(o1.frequency); tg.connect(o2.frequency);
    const nz = ctx.createBufferSource(); nz.buffer = noiseBuf('white'); nz.loop = true; nz.start(0, Math.random() * 3); srcs.push(nz);
    const breath = gain(0.1), env = gain(0), bps = [];
    nz.connect(breath);
    [1, 0.6, 0.25].forEach((a, k) => { const bp = filt('bandpass', VOWELS[1][k], 9); src.connect(bp); breath.connect(bp); bp.connect(gain(a)).connect(env); bps.push(bp); });
    env.connect(buses[i % 3]);
    voices.push({ f0, o1, o2, env, bps, breath, next: Math.random() * 2, i });
  }
  let active = 3, hushUntil = 0;
  function sing(v, kind) {
    const t = ctx.currentTime, wail = kind === 'wail', sigh = kind === 'sigh';
    const f = wail ? Math.min(900, v.f0 * (2.4 + Math.random())) * (0.9 + Math.random() * 0.2) : v.f0 * Math.pow(2, (Math.floor(Math.random() * 5) - 2) / 12);
    const dur = wail ? 1.2 + Math.random() * 1.4 : sigh ? 0.9 + Math.random() * 0.9 : 1.5 + Math.random() * 2;
    const f1 = wail ? f * 1.25 : sigh ? f * 0.7 : f * (0.8 + Math.random() * 0.12);
    for (const o of [v.o1, v.o2]) {
      const d = o === v.o2 ? 1.007 : 1;
      o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(o.frequency.value, t);
      o.frequency.setTargetAtTime(f * d, t, 0.05);
      o.frequency.setTargetAtTime(f1 * d, t + dur * (wail ? 0.3 : 0.15), dur * 0.35);
      if (wail) o.frequency.setTargetAtTime(f * 0.8 * d, t + dur * 0.65, dur * 0.2);
    }
    const pick = (a) => a[(Math.random() * a.length) | 0];
    const A = pick(wail ? [1, 3] : sigh ? [1, 5] : [0, 2, 5]), B = pick([0, 1, 2, 3, 5]);
    v.bps.forEach((bp, k) => {
      bp.frequency.cancelScheduledValues(t);
      bp.frequency.setTargetAtTime(VOWELS[A][k] * (0.97 + Math.random() * 0.06), t, 0.12);
      bp.frequency.setTargetAtTime(VOWELS[B][k], t + dur * 0.5, dur * 0.25);   // the vowel slides, as in pain
    });
    const peak = CHOIR_PEAK * (0.55 + Math.random() * 0.45) * (wail ? 0.7 : 1), at = 0.2 + Math.random() * 0.35;
    v.breath.gain.setTargetAtTime(sigh ? 0.45 : 0.1 + Math.random() * 0.12, t, 0.1);
    v.env.gain.cancelScheduledValues(t); v.env.gain.setTargetAtTime(peak, t, at / 3);
    v.env.gain.setTargetAtTime(0.0001, t + dur - 0.3, 0.3 + Math.random() * 0.4);
    v.next = ctx.currentTime + dur + 0.2 + Math.random() * (v.i < 4 ? 1.2 : 3.5);   // irregular: voices drop in and out
  }
  const api = {
    place(x, y, z, k) {
      const now = ctx.currentTime;
      panners.forEach((p, i) => {
        const a = i * 2.1 + now * 0.2;   // the three groups sit a little apart in the pile
        p.positionX.setTargetAtTime(x + Math.cos(a) * 0.7, now, 0.08); p.positionY.setTargetAtTime(y + 0.2 * i, now, 0.08); p.positionZ.setTargetAtTime(z + Math.sin(a) * 0.7, now, 0.08);
      });
      active = 3 + Math.round(9 * Math.pow(k, 0.8));
      const lvl = now < hushUntil ? 0 : 0.35 + 0.65 * k;
      buses.forEach((b) => b.gain.setTargetAtTime(lvl, now, now < hushUntil ? 0.05 : 0.5));
    },
    scuttle(vol = 1) { if (ctx) scuttleSound(panners[1], ctx.currentTime + 0.01, vol); },
    surge() { for (const v of voices) if (v.i < active) sing(v, 'wail'); },                    // everything cries out at once
    hush(sec = 1.5) { hushUntil = ctx.currentTime + sec; for (const v of voices) { v.env.gain.cancelScheduledValues(ctx.currentTime); v.env.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04); v.next = hushUntil + 0.3 + Math.random(); } },
    tick() {
      const now = ctx.currentTime;
      for (const v of voices) if (now >= v.next && now >= hushUntil) {
        if (v.i >= active) { v.next = now + 0.7; v.env.gain.setTargetAtTime(0.0001, now, 0.3); continue; }
        const r = Math.random(); sing(v, r < 0.1 ? 'wail' : r < 0.4 ? 'sigh' : 'moan');
      }
    },
    release() {
      choirs.delete(api); const now = ctx.currentTime;
      buses.forEach((b) => b.gain.setTargetAtTime(0, now, 0.5));
      setTimeout(() => { srcs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }); panners.forEach((p) => p.disconnect()); }, 3000);
    },
  };
  choirs.add(api);
  return api;
}

// ---- the sobbing woman (round 2, see apparitions.js): one voice, spatialised at her window ---------------------------
// Breath-driven and never periodic. A cluster is 2-4 sobs with unequal gaps (sometimes a voiced "hic" intake or a wet catch in
// between), then a longer shuddering intake, sometimes a long shaky out-breath, then a silence of a second or two. Each sob is a
// stuttered breath-in (ragged chest-catch) and a pitch-falling breathy exhale: a glottal-like pulse train (PeriodicWave) with
// vibrato, pitch and amplitude jitter, voice hitches and a creaky tail, plus aspirated noise, both through three moving formant
// filters sliding from a female /a/ towards /e/. A faint short room reverb sits behind the dry voice. api: stop() cuts dead,
// fade(sec), tick() (driven from update), pulse() (0..1 shudder of her shoulders, in step with the sobs), schedule(untilSec).
const SOB_VOW = { a: [850, 1220, 2810], e: [560, 2150, 2850], o: [560, 960, 2600] };   // female /a/, /e/, /o/ formants (F1 F2 F3)
const SOB_PEAK = 0.22;
const sobbers = new Set();
let glottalWave = null, roomIR = null;
function glottal() {   // glottal-flow-like spectrum: harmonics fall about 7 dB/octave, phases a little scattered (not a clean saw)
  if (glottalWave) return glottalWave;
  const N = 56, re = new Float32Array(N), im = new Float32Array(N);
  for (let n = 1; n < N; n++) { const a = 1 / Math.pow(n, 1.2), ph = (Math.random() - 0.5) * 0.7; im[n] = a * Math.cos(ph); re[n] = a * Math.sin(ph); }
  return (glottalWave = ctx.createPeriodicWave(re, im));
}
function sobber(pos) {
  if (!ctx) return null;
  const bus = gain(0), pan = makePanner(pos), now0 = ctx.currentTime;
  pan.refDistance = 8; pan.rolloffFactor = 1;
  const lp = filt('lowpass', 4200, 0.5);
  bus.connect(filt('highpass', 140, 0.7)).connect(lp); lp.connect(pan);
  if (!roomIR) { const n = (ctx.sampleRate * 0.5) | 0; roomIR = ctx.createBuffer(1, n, ctx.sampleRate); const d = roomIR.getChannelData(0); let y = 0; for (let i = 0; i < n; i++) { y += 0.5 * ((Math.random() * 2 - 1) - y); d[i] = y * Math.pow(1 - i / n, 3); } }
  const conv = ctx.createConvolver(); conv.buffer = roomIR; lp.connect(conv).connect(gain(0.22)).connect(pan);   // the faint room
  bus.gain.setTargetAtTime(1, now0, 0.6);
  const rr = (a, b) => a + Math.random() * (b - a), pulses = [];   // pulses: { t, d, a } the shoulders' jolts, for pulse()
  const noise = (t, dur) => { const n = ctx.createBufferSource(); n.buffer = noiseBuf('white'); n.start(t, rr(0, 2.5), dur + 0.05); return n; };
  // a voiced breath. contour: onset overshoot, then pitch falls by `fall` (negative = rises); quaver = amplitude flutter depth
  function voiced(t, { f0, dur, amp, v0 = 'a', v1 = 'e', mix = 1, breathy = 0.4, fall = 0.22, onset = 0.12, crack = false, fry = false, hitch = 0, quaver = 0 }) {
    const n = Math.max(8, Math.round(dur * 160)), fc = new Float32Array(n), ac = new Float32Array(n), nc = new Float32Array(n);
    const vf = rr(5.2, 7.4), vd = rr(0.012, 0.03), vph = rr(0, 6.28), qf = rr(9, 14), qph = rr(0, 6.28);
    const dips = []; for (let i = 0; i < hitch; i++) dips.push([rr(0.25, 0.8), Math.max(0.02, rr(0.02, 0.045) / dur)]);
    const cu = rr(0.3, 0.6); let jit = 0, ajit = 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), s = u * dur;
      jit = jit * 0.6 + rr(-1, 1) * 0.011; ajit = ajit * 0.5 + rr(-1, 1) * 0.14;
      let r = (1 + onset * Math.exp(-s / 0.07)) * (1 - fall * u) * (1 + vd * Math.sin(vph + 6.283 * vf * s) + jit);
      if (crack && u > cu && u < cu + 0.06 / dur) r *= 1.4;                                    // the voice breaks upward for a moment
      let a = Math.min(1, s / 0.03) * Math.pow(1 - u, 0.75) * (1 + ajit);
      const nz = Math.min(1, s / 0.02) * Math.pow(1 - u, 0.5) * (1 + rr(-0.3, 0.3));
      for (const [c, w] of dips) if (Math.abs(u - c) < w / 2) a *= 0.12;                       // chest catch: the voice drops out for a few ms
      if (quaver) a *= 1 - quaver * (0.5 - 0.5 * Math.cos(6.283 * qf * s + qph));
      if (fry && u > 0.78) { r = 0.3 * (1 + rr(-0.28, 0.28)); a *= 0.7; }                       // creaky vocal fry at the tail
      fc[i] = Math.max(40, f0 * r); ac[i] = Math.max(0, a) * amp; nc[i] = Math.max(0, nz) * amp * breathy;
    }
    const o = ctx.createOscillator(); o.setPeriodicWave(glottal()); o.frequency.setValueCurveAtTime(fc, t, dur);
    const vg = gain(0); vg.gain.setValueCurveAtTime(ac, t, dur);
    const ng = gain(0); ng.gain.setValueCurveAtTime(nc, t, dur);
    const src = gain(1), A = SOB_VOW[v0], B = SOB_VOW[v1], z = noise(t, dur);
    o.connect(vg).connect(src); z.connect(ng);
    A.forEach((f, k) => {   // the same three moving formants shape the pulse train (narrow) and the aspiration noise (wide)
      for (const [from, q, g] of [[src, [9, 11, 13][k], [3.2, 2.6, 1.8][k]], [ng, [3, 4, 5][k], [5, 4, 3][k]]]) {
        const bp = filt('bandpass', f, q);
        bp.frequency.setValueAtTime(f, t); bp.frequency.linearRampToValueAtTime(f + (B[k] - f) * mix, t + dur);
        from.connect(bp); bp.connect(gain(g)).connect(bus);
      }
    });
    src.connect(filt('lowpass', 700, 0.7)).connect(gain(0.12)).connect(bus);                   // a little chest under the formants
    o.start(t); o.stop(t + dur + 0.05);
  }
  function breathIn(t, dur, amp, stutter = 1) {   // a rising, sharpening breath cut off short, in `stutter` ragged pieces
    const z = noise(t, dur + 0.05), bp = filt('bandpass', 700, 1.1), bp2 = filt('bandpass', 2400, 1.6), g = gain(0.0001);
    bp.frequency.setValueAtTime(600, t); bp.frequency.linearRampToValueAtTime(rr(1700, 2300), t + dur);
    z.connect(bp).connect(g); z.connect(bp2).connect(gain(0.45)).connect(g); g.connect(bus);
    let u = t; const d = dur / stutter;
    for (let j = 0; j < stutter; j++) {
      const a = amp * (0.55 + 0.45 * (j + 1) / stutter) * rr(0.8, 1.15);
      g.gain.linearRampToValueAtTime(a, u + d * 0.7); g.gain.linearRampToValueAtTime(0.0001, u + d * 0.7 + 0.012);
      u += d * rr(0.85, 1.1); g.gain.setValueAtTime(0.0001, u);
    }
  }
  function wet(t, amp) {   // a wet catch of breath: a tiny click of saliva and a swallowed blip
    noiseBurst(bus, t, { type: 'bandpass', freq: rr(1800, 3000), q: 7, attack: 0.002, dur: 0.02, gain: amp });
    noiseBurst(bus, t + 0.01, { type: 'lowpass', freq: 900, attack: 0.004, dur: 0.05, gain: amp * 0.7 });
    tone(bus, t, { freq: rr(650, 850), freqEnd: 260, attack: 0.002, dur: 0.035, gain: amp * 0.6 });
  }
  function sob(t, k, size) {
    const inD = rr(0.1, 0.22), r = Math.random();
    breathIn(t, inD, SOB_PEAK * rr(0.22, 0.4) * size, r < 0.45 ? 1 : r < 0.8 ? 2 : 3);
    const u = t + inD + rr(0, 0.04), dur = rr(0.28, 0.5) * (0.85 + 0.15 * size);
    voiced(u, { f0: rr(245, 335) * (1 - 0.025 * k), dur, amp: SOB_PEAK * rr(0.6, 1) * size, mix: rr(0.5, 1), breathy: rr(0.3, 0.65), fall: rr(0.14, 0.3),
      crack: Math.random() < 0.2, fry: Math.random() < 0.35, hitch: Math.random() < 0.4 ? 1 + (Math.random() < 0.3 ? 1 : 0) : 0 });
    pulses.push({ t: u, d: dur + 0.1, a: size });
    return u + dur;
  }
  function cluster(t) {
    const n = 2 + ((Math.random() * 3) | 0);
    if (Math.random() < 0.3) { wet(t, SOB_PEAK * rr(0.5, 0.9)); t += rr(0.07, 0.16); }
    for (let i = 0; i < n; i++) {
      t = sob(t, i, Math.max(0.35, 1 - 0.14 * i * rr(0.4, 1.4)));
      if (i < n - 1) {
        t += rr(0.1, 0.5) * (Math.random() < 0.25 ? 2 : 1);                                    // unequal gaps
        if (Math.random() < 0.3) { voiced(t, { f0: rr(330, 430), dur: 0.11, amp: SOB_PEAK * 0.45, v0: 'e', v1: 'a', breathy: 0.7, fall: -0.25, onset: 0 }); t += 0.14; }   // a voiced "hic" intake
      }
    }
    t += rr(0.1, 0.35);
    const sd = rr(0.8, 1.7), steps = 5 + ((Math.random() * 5) | 0);                           // the longer shuddering intake
    breathIn(t, sd, SOB_PEAK * 0.45, steps);
    voiced(t + 0.05, { f0: rr(360, 440), dur: sd * 0.9, amp: SOB_PEAK * 0.14, v0: 'e', v1: 'a', breathy: 0.8, fall: -0.45, onset: 0, quaver: 0.7 });
    for (let i = 0; i < steps; i++) pulses.push({ t: t + (sd * (i + rr(0.2, 0.9))) / steps, d: 0.14, a: 0.3 + 0.35 * i / steps });
    t += sd;
    if (Math.random() < 0.4) { const d = rr(0.6, 1.1); voiced(t + 0.08, { f0: rr(230, 290), dur: d, amp: SOB_PEAK * 0.38, v0: 'a', v1: 'o', breathy: 0.9, fall: 0.3, fry: true, quaver: 0.35 }); t += d + 0.1; }   // a shaky out-breath
    return t + rr(0.5, 2.6);
  }
  let next = now0 + 0.3, ended = false;
  const done = (ms) => { ended = true; sobbers.delete(api); setTimeout(() => pan.disconnect(), ms); };
  const api = {
    schedule(until) { while (!ended && until >= next) next = cluster(Math.max(next, ctx.currentTime + 0.05)); },
    tick() { api.schedule(ctx.currentTime + 0.4); },
    pulse() {   // how hard her shoulders are jolting now: 0..1, fast attack, slower release
      const n = ctx.currentTime; let v = 0;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i], x = (n - p.t) / p.d;
        if (x > 1.5) { pulses.splice(i, 1); continue; }
        if (x >= 0 && x <= 1) v = Math.max(v, p.a * (x < 0.2 ? x / 0.2 : 1 - (x - 0.2) / 0.8));
      }
      return Math.min(1, v);
    },
    stop() { if (ended) return; const t = ctx.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(0, t); done(9000); },   // dead silence
    fade(sec = 3) { if (ended) return; const t = ctx.currentTime; bus.gain.cancelScheduledValues(t); bus.gain.setTargetAtTime(0, t, sec / 4); done(9000 + sec * 1000); },
  };
  sobbers.add(api);
  return api;
}

// A long breathy sigh passing through the trees (the forest wraith): white noise through three vowel-ish formants that bend
// slowly downward, a faint voiced "oh" underneath. Returns { move(x, y, z) } to carry its panner along.
function sigh(pos, dur = 4) {
  if (!ctx) return null;
  const t = ctx.currentTime + 0.03, pan = makePanner(pos), env = gain(0), nz = ctx.createBufferSource();
  pan.refDistance = 9; pan.rolloffFactor = 0.9;
  env.connect(filt('lowpass', 3400, 0.5)).connect(pan);
  nz.buffer = noiseBuf('white'); nz.loop = true; nz.start(t, Math.random() * 3);
  const o = ctx.createOscillator(), vib = ctx.createOscillator(), vg = gain(4), og = gain(0.5), br = gain(1.6), src = gain(1);
  o.type = 'sawtooth'; o.frequency.setValueAtTime(205, t); o.frequency.exponentialRampToValueAtTime(128, t + dur);
  vib.frequency.value = 5.2; vib.connect(vg).connect(o.frequency);
  o.connect(og).connect(src); nz.connect(br).connect(src);
  [[520, 330, 6, 1], [1050, 720, 7, 0.55], [2400, 1900, 9, 0.2]].forEach(([a, b, q, m]) => {
    const bp = filt('bandpass', a, q); bp.frequency.setValueAtTime(a, t); bp.frequency.exponentialRampToValueAtTime(b, t + dur);
    src.connect(bp); bp.connect(gain(m * 3.2)).connect(env);
  });
  env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.8, t + dur * 0.38); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  setTimeout(() => { try { nz.stop(); } catch { /* already stopped */ } pan.disconnect(); }, (dur + 1) * 1000);
  return { move(x, y, z) { const n = ctx.currentTime; pan.positionX.setTargetAtTime(x, n, 0.12); pan.positionY.setTargetAtTime(y, n, 0.12); pan.positionZ.setTargetAtTime(z, n, 0.12); } };
}

function footstep(surface, brisk) {
  if (!ctx) return;
  stepSide = -stepSide; stepPan.pan.value = stepSide * 0.12;
  stepSound(stepPan, ctx.currentTime, surface, brisk ? 0.2 : 0.13);
}

export const audio = {
  start, update, footstep, playAt, footstepAt, makePanner, noiseBurst, tone, stepSound, choir, sobber, sigh, lx: 0, lz: 0,
  get ctx() { return ctx; },
  get ready() { return !!ctx && ctx.state === 'running'; },
};
