// The four apparitions and the audio-only one-shots. This module only knows how to *show* things;
// the director (director.js) decides when, and enforces the "only change while unobserved" rule.
//
// Visual apparitions share one small interface used by the director:
//   name, fogK, minDist, maxDwell, maxChanges, point (gaze point), lamp
//   pointFor(anchor) -> Vector3, spawn(anchor, lamp), change(), vanish(), noticed(), update(dt, {observed})
import * as THREE from 'three';
import * as P from './path.js';
import * as T from './textures.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V3 = THREE.Vector3;

// Apparition tuning (looks and timing of the shows themselves).
const CREATURE_BEAT = 1.4;      // s after being noticed before the eyes start to curve
const CREATURE_MORPH = 4.5;     // s for the eyes to go from round glows to crescents (counts only while observed)
const FIGURE_STEP = 0.95;       // m the distant figure moves toward the player when it "changes"
const STEPS_ECHO_COUNT = 7;     // follower steps that echo the player's own before drifting out of sync
const STEPS_START_DIST = 11;    // m behind the player
const STEPS_CLOSE_RATE = 1.15;  // m/s while closing in (player walks 1.3)
const STEPS_FACE_CONE_DEG = 50; // looking this close to the sound's direction counts as turning around
const BREATH_CYCLES = 4;

export function createApparitions(game, host) {
  const { scene, camera, audio, player } = game;
  const A = audio;
  const fogTr = (d, k = 1) => Math.exp(-((d * scene.fog.density * k) ** 2));
  const q = new THREE.Quaternion();
  const mat = (map, o = {}) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, ...o });
  const faceCamera = (obj) => { obj.rotation.y = Math.atan2(camera.position.x - obj.position.x, camera.position.z - obj.position.z); };

  // ---- timers (run on the director's clock, so they pause with the game) ----------------------
  let now = 0;
  const timers = [];
  const later = (fn, s) => timers.push({ at: now + s, fn });

  // ---- audio-only one-shots: each takes an optional world position -------------------------------
  const ring = (r0, r1, y = 0.4) => {
    const a = Math.random() * 6.283, r = rnd(r0, r1);
    return { x: camera.position.x + Math.cos(a) * r, y, z: camera.position.z + Math.sin(a) * r };
  };
  const knockOne = (out, t, g = 0.5) => {
    A.tone(out, t, { freq: 130, freqEnd: 70, dur: 0.1, gain: g });
    A.noiseBurst(out, t, { type: 'bandpass', freq: 650, q: 1.6, dur: 0.07, gain: g * 0.8 });
  };
  const snd = {
    'branch-snap'(pos = ring(9, 24)) {
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'highpass', freq: 2200, dur: 0.05, gain: 0.55 });
        A.noiseBurst(out, t, { type: 'bandpass', freq: 900, q: 1.5, dur: 0.14, gain: 0.45 });
        A.tone(out, t, { freq: 260, freqEnd: 120, type: 'triangle', dur: 0.08, gain: 0.2 });
        if (Math.random() < 0.6) A.noiseBurst(out, t + 0.4, { type: 'highpass', freq: 3000, attack: 0.08, dur: 0.4, gain: 0.06 }); // leaves settling
      }, 1.5);
    },
    'door-creak'(pos = ring(10, 26, 1.2)) {
      A.playAt(pos, (c, out, t) => {
        const f = rnd(180, 260);
        A.tone(out, t, { freq: f, freqEnd: f * 0.62, type: 'sawtooth', attack: 0.2, dur: 1.5, gain: 0.07, lp: 420 });
        A.tone(out, t + 0.1, { freq: f * 1.5, freqEnd: f * 0.9, type: 'sawtooth', attack: 0.25, dur: 1.2, gain: 0.025, lp: 600 });
        A.noiseBurst(out, t + 1.7, { type: 'lowpass', freq: 250, dur: 0.25, gain: 0.3 });
      }, 2.5);
    },
    knock(pos = ring(8, 18, 1.3)) {
      A.playAt(pos, (c, out, t) => { let at = 0; for (let i = 0; i < 3; i++) { knockOne(out, t + at); at += rnd(0.34, 0.5); } }, 1.8);
    },
    whisper(pos = ring(1.0, 1.8, 1.5)) {
      A.playAt(pos, (c, out, t) => {
        let at = 0;
        for (let i = 0; i < 6; i++) {
          A.noiseBurst(out, t + at, { type: 'bandpass', freq: rnd(2200, 3800), q: 2.5, attack: 0.05, dur: rnd(0.12, 0.24), gain: 0.2 });
          A.noiseBurst(out, t + at, { type: 'bandpass', freq: rnd(900, 1400), q: 3, attack: 0.05, dur: 0.15, gain: 0.07 });
          at += rnd(0.11, 0.26);
        }
      }, 2.5);
    },
    drag(pos = ring(14, 26)) {
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'lowpass', freq: 280, attack: 0.7, dur: 1.6, gain: 0.5 });
        A.tone(out, t, { freq: 72, freqEnd: 52, type: 'sawtooth', attack: 0.6, dur: 1.6, gain: 0.05, lp: 200 });
      }, 3);
    },
    'distant-steps'(pos = ring(18, 32)) { // someone walking parallel to the path, out in the dark
      const surf = P.surfaceAt(player.s) === 'cobble' ? 'cobble' : player.zone === 'estate' ? 'gravel' : 'dirt';
      const a = Math.random() * 6.283, vx = Math.cos(a) * 0.55, vz = Math.sin(a) * 0.55, n = 4 + ((Math.random() * 4) | 0), p = { ...pos };
      for (let i = 0; i < n; i++) {
        later(() => { p.x += vx; p.z += vz; A.playAt({ ...p }, (c, out, t) => A.stepSound(out, t, surf, 0.9), 0.6); }, i * 0.64);
      }
    },
  };

  // ---- 1. footsteps and breathing behind the player (audio only) ---------------------------------
  const live = []; // gain nodes of the follower's sounds, so everything can be cut instantly
  const S = { active: false, phase: '', now: 0, D: 0, k: 0, q: [], timer: 0, faceT: 0, side: 1, breaths: 0, echoT: 0 };
  function behind(D) {
    const c = P.pointAt(player.s), p = P.pointAt(Math.max(0, player.s - D));
    const lat = (player.x - c.x) * c.rx + (player.z - c.z) * c.rz;
    return { x: p.x + p.rx * lat * 0.5, y: 0.1, z: p.z + p.rz * lat * 0.5 };
  }
  function followerSound(pos, make, dur) {
    A.playAt(pos, (c, out, t) => {
      const g = c.createGain(); g.connect(out); live.push(g); if (live.length > 16) live.shift();
      make(g, t);
    }, dur);
  }
  function followerStep() {
    const surf = P.surfaceAt(player.s), vol = Math.max(0.35, 1.25 - 0.09 * (STEPS_START_DIST - S.D));
    S.side = -S.side;
    const p = behind(S.D); const c = P.pointAt(player.s);
    p.x += c.rx * 0.35 * S.side; p.z += c.rz * 0.35 * S.side;
    followerSound(p, (g, t) => A.stepSound(g, t, surf, vol), 0.6);
  }
  function breathe(k) {
    const p = behind(1.1), c = P.pointAt(player.s), fade = 1 - 0.55 * (k / BREATH_CYCLES);
    p.x += c.rx * 0.4; p.z += c.rz * 0.4; p.y = 1.5;
    followerSound(p, (g, t) => {
      A.noiseBurst(g, t, { type: 'bandpass', freq: 850, q: 0.7, attack: 0.9, dur: 0.9, gain: 0.3 * fade });         // in
      A.noiseBurst(g, t + 1.35, { type: 'bandpass', freq: 520, q: 0.7, attack: 0.5, dur: 1.1, gain: 0.26 * fade }); // out
    }, 3);
  }
  function stopSteps(why) {
    if (!S.active) return;
    S.active = false;
    if (A.ctx) for (const g of live) { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(0, A.ctx.currentTime); }
    live.length = 0;
    host.log(`steps-behind:${why}`);
    if (why !== 'end') host.tension(0.18);
  }
  const steps = {
    get active() { return S.active; },
    start() {
      Object.assign(S, { active: true, phase: 'echo', now: 0, D: STEPS_START_DIST, k: 0, q: [], timer: 0, faceT: 0, breaths: 0, echoT: 0 });
    },
    onTurn() { stopSteps('turn-around'); },
    onPlayerStep() { // echo the player's steps, a little later each time, then fall out of sync
      if (!S.active || S.phase !== 'echo') return;
      S.q.push(S.now + 0.17 + 0.03 * S.k); S.D -= 0.35;
      if (++S.k >= STEPS_ECHO_COUNT) { S.phase = 'close'; S.timer = 0.9; }
    },
    update(dt) {
      if (!S.active) return;
      S.now += dt;
      while (S.q.length && S.q[0] <= S.now) { S.q.shift(); followerStep(); }
      if (S.phase === 'echo') { S.echoT += dt; if (S.echoT > 9) { S.phase = 'close'; S.timer = 0.5; } }
      else if (S.phase === 'close') {
        S.D = Math.max(1.3, S.D - STEPS_CLOSE_RATE * dt); S.timer -= dt;
        if (S.timer <= 0) { followerStep(); S.k++; S.timer = Math.max(0.5, 0.68 - 0.012 * (S.k - STEPS_ECHO_COUNT)); }
        if (S.D <= 1.35) { S.phase = 'breath'; S.timer = 0.4; }
      } else if (S.phase === 'breath') {
        S.timer -= dt;
        if (S.timer <= 0) { if (S.breaths >= BREATH_CYCLES) { stopSteps('end'); return; } breathe(S.breaths++); S.timer = 2.6; }
      }
      // turning to face the sound: everything stops at once and nothing is there
      const p = behind(S.D), vx = p.x - camera.position.x, vz = p.z - camera.position.z, d = Math.hypot(vx, vz) || 1;
      const f = camera.getWorldDirection(new V3()), fl = Math.hypot(f.x, f.z) || 1;
      const cos = (vx * f.x + vz * f.z) / (d * fl);
      S.faceT = cos > Math.cos((STEPS_FACE_CONE_DEG * Math.PI) / 180) ? S.faceT + dt : 0;
      if (S.faceT > 0.1) stopSteps('looked-back');
    },
  };

  // ---- 2. pale woman behind a window pane --------------------------------------------------------
  const woman = (() => {
    const m = mat(T.womanTex(), { opacity: 0.8 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.99), m); mesh.renderOrder = 1; mesh.visible = false; scene.add(mesh);
    const stages = [{ s: 0.82, dy: -0.2, rz: 0, op: 0.7 }, { s: 1.0, dy: -0.12, rz: 0.04, op: 0.9 }]; // [far from the glass, close to it]
    let anchor = null, st = 0;
    const apply = () => {
      const o = stages[st];
      mesh.position.copy(anchor.interior); mesh.position.y += o.dy; mesh.scale.setScalar(o.s); m.opacity = o.op;
      mesh.quaternion.copy(q); mesh.rotateZ(o.rz);
    };
    return {
      name: 'window-woman', fogK: 1, minDist: 9, maxDwell: 5, maxChanges: 1, point: new V3(), lamp: null,
      pointFor: (a) => a.interior.clone(),
      spawn(a) { anchor = a; st = 0; a.glass.updateWorldMatrix(true, false); a.glass.getWorldQuaternion(q); this.point.copy(a.interior); apply(); mesh.visible = true; },
      change() { if (st >= stages.length - 1) return false; st++; apply(); return true; },
      vanish() { mesh.visible = false; },
      noticed() {}, update() {},
    };
  })();

  // ---- 3. shadow creature half behind stone or foliage -------------------------------------------
  const creature = (() => {
    const grp = new THREE.Group(); grp.visible = false;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.9), mat(T.creatureTex(), { opacity: 0.95 })); body.position.y = 0.98;
    const E = T.eyesTex();
    const em = mat(E.tex, { blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    const eyes = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.32), em); eyes.position.set(0, 1.4, 0.03); eyes.renderOrder = 2;
    grp.add(body, eyes); scene.add(grp);
    let hold = 0, isNoticed = false, step = -1;
    const place = (a) => new V3(a.pos.x + (a.peekPos.x - a.pos.x) * 0.45, 0, a.pos.z + (a.peekPos.z - a.pos.z) * 0.45); // tucked in behind the cover
    return {
      name: 'forest-shadow', fogK: 1, minDist: 9, maxDwell: 7.5, maxChanges: 0, point: new V3(), lamp: null,
      pointFor: (a) => place(a).setY(1.3),
      spawn(a) { grp.position.copy(place(a)); this.point.copy(grp.position).setY(1.3); hold = 0; isNoticed = false; step = -1; E.draw(0); grp.visible = true; faceCamera(grp); },
      change: () => false,
      vanish() { grp.visible = false; },
      noticed() { isNoticed = true; },
      update(dt, { observed }) {
        faceCamera(grp);
        const d = grp.position.distanceTo(camera.position);
        em.opacity = clamp(fogTr(d) * 2.5, 0, 1) * 0.95;
        if (!isNoticed || !observed) return; // it holds still; the smile only advances while it is being watched
        hold += dt;
        const m = clamp((hold - CREATURE_BEAT) / CREATURE_MORPH, 0, 1), k = Math.round(m * 32);
        if (k !== step) { step = k; E.draw(k / 32); }
      },
    };
  })();

  // ---- 4. distant figure at the edge of the light ------------------------------------------------
  const figure = (() => {
    const grp = new THREE.Group(); grp.visible = false;
    const m = mat(T.figureTex(), { opacity: 0.85 });
    const body = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.0), m); body.position.y = 1.0; grp.add(body); scene.add(grp);
    return {
      name: 'distant-figure', fogK: 1, minDist: 11, maxDwell: 4, maxChanges: 1, point: new V3(), lamp: null,
      pointFor: (a) => a.pos.clone().setY(1.0),
      spawn(a, lamp) { grp.position.copy(a.pos); grp.position.y = 0; this.lamp = lamp; this.point.copy(a.pos).setY(1.0); grp.visible = true; faceCamera(grp); },
      change() {
        const dx = camera.position.x - grp.position.x, dz = camera.position.z - grp.position.z, d = Math.hypot(dx, dz) || 1;
        grp.position.x += (dx / d) * FIGURE_STEP; grp.position.z += (dz / d) * FIGURE_STEP; this.point.copy(grp.position).setY(1.0);
        return true;
      },
      vanish() { grp.visible = false; },
      noticed() {},
      update() { faceCamera(grp); m.opacity = 0.85 * clamp(this.lamp ? this.lamp.flicker : 1, 0, 1); },
    };
  })();

  const visual = { 'window-woman': woman, 'forest-shadow': creature, 'distant-figure': figure };
  return {
    audio: snd, visual, steps,
    onPlayerStep: () => steps.onPlayerStep(),
    update(dt) {
      now += dt;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= now) { const f = timers[i].fn; timers.splice(i, 1); f(); }
      steps.update(dt);
    },
  };
}
