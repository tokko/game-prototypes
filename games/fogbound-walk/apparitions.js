// The four apparitions, the five round-2 actors (r2: angel, ceiling woman, sobbing woman, wraith, crossers; they enforce the
// rules themselves through the director's host) and the audio-only one-shots. This module only knows how to *show* things;
// the director (director.js) decides when, and enforces the "only change while unobserved" rule.
//
// Visual apparitions share one small interface used by the director:
//   name, fogK, minDist, maxDwell, maxChanges, point (gaze point), lamp
//   pointFor(anchor) -> Vector3, spawn(anchor, lamp), change(), vanish(), noticed(), update(dt, {observed})
// The director's `host` gives it tension(v), log(id) and ring() (per-zone radius scale for random sounds).
import * as THREE from 'three';
import * as P from './path.js';
import * as T from './textures.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V3 = THREE.Vector3;

// Apparition tuning (looks and timing of the shows themselves).
const CREATURE_BEAT = 1.4;      // s after being noticed before the eyes start to curve
const CREATURE_MORPH = 4.5;     // s for the eyes to go from round glows to crescents (counts only while observed)
const FIGURE_STEP = 1.6;        // m a non-doorway figure moves toward the player when it "changes" (at the door it stands up instead)
const CREATURE_EDGE = 0.42;     // m: half-width of the cover stone as seen from the path (where the paw grips)
const CREATURE_LAT = CREATURE_EDGE + 0.43; // m the beast plane's centre sits beside the cover's centre (its edge hides the plane's left 0.22 m)
const DOOR_SIDE = 1;            // doorway lean: 1 = behind the left jamb (the painted side, rim toward the hall lamp), -1 = mirrored
const DOOR_LEAN_S = 1.3;        // lean plane scale: a bigger, taller shape; the head (painted at 2.35 m) lands in the glow under the lintel
const DOOR_LEAN_UP = -0.22;     // m the lean plane's bottom edge relative to the floor
const DOOR_LEAN_LEFT = -0.9;    // m the lean plane's left edge (alpha 0) in the door frame; the head sits in the lit upper-middle of the opening
const DOOR_LEAN_HAND_GAIN = 1.9; // colour gain on the paw on the post so it reads at courtyard distance
const DOOR_LEAN_HEAD = [DOOR_LEAN_LEFT + 0.385 * DOOR_LEAN_S, 1.4 * DOOR_LEAN_S * 2 * 0.84 + DOOR_LEAN_UP]; // x, y of the painted head (UV 0.275, 0.159)
const CREATURE_DEPTH = 0.55;    // m the beast plane sits behind the cover's centre, along the view
const STEPS_ECHO_COUNT = 7;     // follower steps that echo the player's own before drifting out of sync
const STEPS_START_DIST = 11;    // m behind the player
const STEPS_CLOSE_RATE = 1.15;  // m/s while closing in (player walks 1.3)
const STEPS_FACE_CONE_DEG = 50; // looking this close to the sound's direction counts as turning around
const BREATH_CYCLES = 4;

// Round-2 apparitions (assets/round2/SPEC.md). Each is a self-contained actor with its own slot; none uses the director's `active`.
const ANGEL_GAPS = [19, 14, 9.5, 5]; // m AHEAD of the player in each pose (steps of 2-5 m; it can only be seen if it is in front); the last is where it stops, never touching
const ANGEL_JITTER = 0.35;      // m, random spread on the gaps before the last
const ANGEL_CUE = [1.5, 3];     // s from the stone-scrape cue to its first appearance
const ANGEL_STEP_AFTER = 0.6;   // s unobserved after a look-back before it takes the next pose
const ANGEL_GAZE_MAX = 2.6;     // s of looking straight at it before a flicker / fog swell takes the look (it moves on during the blink)
const ANGEL_MIN_DIST = 2.4;     // m: walk back into it and the look is taken away
const ANGEL_LIFE = 120;         // s, in case the player never leaves the lane
const CEIL_TILT = 0.26;         // rad the ceiling woman's plane tilts down about its horizontal axis (never rolled)
const CEIL_GAZE_MAX = 2.4;      // s of looking at her before the lamp flickers and she is gone
const CEIL_GONE_AFTER = 0.35;   // s unobserved after being seen and she is gone
const SOB_RANGE = [5, 16];      // m from the window within which a gaze counts
const SOB_SHOW = [1.0, 1.5];    // s of gaze before she can be made out in the dark window
const SOB_TURN = [2.0, 3.0];    // s of gaze before the sobbing stops and she turns
const SOB_NEAR_CAP = 9;         // s spent watching her from within range, and she turns anyway
const SOB_SILENCE = [0.8, 1.2]; // s of dead silence before she turns
const SOB_TWIST = [0.16, 0.30]; // s: stage 1 (the body twists edge-on), stage 2 (she comes round with a lunge)
const SOB_STARE = [2.5, 4];     // s (watched) she stares before the smile begins
const SOB_SMILE = 1.5;          // s (watched) for the smile to grow
const SOB_AFTER = 1.5;          // s (watched) after the smile is complete, then a flicker or swell takes her
const SOB_FADE = 3.5;           // s for the sobbing to fade when nobody looked
const SOB_SCALE = 0.85, SOB_LOCAL = [0, -0.21, 0.065]; // her plane in the window group: scale, x/y/z (sits on the open gap's floor)
const WRAITH_BEARING = [62, 78]; // deg off the gaze where it starts (outside the view cone, so it drifts in from the side)
const WRAITH_DIST = [10, 20];    // m from the player (the fog is thick here: any further and it is only a smudge)
const WRAITH_TIME = [4, 6];      // s, also the sigh's length
const WRAITH_END = [0, 14];      // deg off the gaze where it ends up (it sweeps in from the periphery to nearly dead ahead, so the view cone is crossed)
const WRAITH_GAZE_MAX = 1.0;     // s of looking at it and it is gone
const WRAITH_FOG_GAIN = 1.8;     // opacity = this * fog transmission squared (nearly gone at the edge of visibility)
const CROSS_ANGLE = [30, 48];    // deg off the gaze where a crosser may start (peripheral, still on a 16:9 screen; never inside the gaze cone)
const CROSS_DIST = [9, 26];      // m from the player
const CROSS_GAZE_DEG = 24;       // the gaze swings this close to it and it is gone that frame
const CROSS_LEAD = [0.35, 0.7];  // s from its sound to the dash
const CROSS_TIME = [0.25, 0.6];  // s visible
const CROSS_LEN = { run: [4, 6.5], low: [3, 5], window: [0.6, 0.6] }; // m travelled along the plane's u axis
const CROSS_TRIES = 40;          // candidate spots tried (each is ray-tested against the solid world, so it crosses a real gap)

export function createApparitions(game, host) {
  const { scene, camera, audio, player, world } = game;
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
  const ring = (r0, r1, y = 0.4) => {   // the director scales the radius per zone (sounds close in as the walk goes on)
    const a = Math.random() * 6.283, r = Math.max(1, rnd(r0, r1) * host.ring());
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
    'heavy-drag'(pos = ring(3, 5)) { // something heavy hauled close by, ending in a crack of wood
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'lowpass', freq: 240, attack: 0.5, dur: 1.5, gain: 0.9 });
        A.tone(out, t, { freq: 64, freqEnd: 42, type: 'sawtooth', attack: 0.5, dur: 1.5, gain: 0.1, lp: 180 });
        A.noiseBurst(out, t + 1.7, { type: 'highpass', freq: 1800, dur: 0.06, gain: 0.7 });
        A.noiseBurst(out, t + 1.7, { type: 'bandpass', freq: 700, q: 1.3, dur: 0.22, gain: 0.6 });
        A.tone(out, t + 1.7, { freq: 200, freqEnd: 90, type: 'triangle', dur: 0.1, gain: 0.3 });
      }, 3.5);
    },
    click(pos = ring(1, 2, 1.2)) { // a switch or a lamp catching
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'highpass', freq: 3000, dur: 0.015, gain: 0.55 });
        A.tone(out, t, { freq: 1800, freqEnd: 900, dur: 0.02, gain: 0.25 });
        A.tone(out, t + 0.05, { freq: 140, freqEnd: 90, dur: 0.06, gain: 0.2 });
      }, 0.6);
    },
    hum(pos = ring(12, 20, 2)) { // the forest lure: a faint wandering whistle, a few uneven notes
      A.playAt(pos, (c, out, t) => {
        const f = rnd(480, 560), notes = [1, 1.19, 1.12, 0.89], o = c.createOscillator(), v = c.createOscillator(), vg = c.createGain(), g = c.createGain();
        o.type = 'sine'; v.type = 'sine'; v.frequency.value = rnd(4.5, 6); vg.gain.value = 5;
        o.frequency.setValueAtTime(f, t);
        notes.forEach((k, i) => i && o.frequency.setTargetAtTime(f * k, t + i * 0.7, 0.12));
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.5); g.gain.setValueAtTime(0.07, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        v.connect(vg).connect(o.frequency); o.connect(g).connect(out);
        A.noiseBurst(out, t, { type: 'bandpass', freq: 1600, q: 4, attack: 0.5, dur: 2.5, gain: 0.025 }); // breath
        o.start(t); v.start(t); o.stop(t + 3.3); v.stop(t + 3.3);
      }, 3.8);
    },
    'distant-steps'(pos = ring(18, 32)) { // someone walking parallel to the path, out in the dark
      const surf = P.surfaceAt(player.s) === 'cobble' ? 'cobble' : player.zone === 'estate' ? 'gravel' : 'dirt';
      const a = Math.random() * 6.283, vx = Math.cos(a) * 0.55, vz = Math.sin(a) * 0.55, n = 4 + ((Math.random() * 4) | 0), p = { ...pos };
      for (let i = 0; i < n; i++) {
        later(() => { p.x += vx; p.z += vz; A.playAt({ ...p }, (c, out, t) => A.stepSound(out, t, surf, 0.9), 0.6); }, i * 0.64);
      }
    },
    'stone-scrape'(pos = ring(14, 22, 0.3)) { // stone dragged on stone, faint (the weeping angel)
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'bandpass', freq: 380, q: 2.2, attack: 0.45, dur: 0.9, gain: 0.55 });
        A.noiseBurst(out, t + 0.1, { type: 'highpass', freq: 2600, attack: 0.4, dur: 0.7, gain: 0.07 });
        A.tone(out, t, { freq: 92, freqEnd: 70, type: 'sawtooth', attack: 0.45, dur: 0.9, gain: 0.04, lp: 220 });
      }, 2.2);
    },
    'sob-creak'(pos = ring(2, 3, 1.2)) { // her body twisting round: cloth dragged, a bone creak, two dry cracks
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'bandpass', freq: 2600, q: 0.9, attack: 0.08, dur: 0.32, gain: 0.25 });
        A.tone(out, t, { freq: 150, freqEnd: 95, type: 'sawtooth', attack: 0.12, dur: 0.42, gain: 0.06, lp: 380 });
        A.tone(out, t + 0.05, { freq: 232, freqEnd: 150, type: 'sawtooth', attack: 0.1, dur: 0.3, gain: 0.03, lp: 520 });
        A.noiseBurst(out, t + 0.09, { type: 'bandpass', freq: 1500, q: 6, dur: 0.02, gain: 0.5 });
        A.noiseBurst(out, t + 0.21, { type: 'bandpass', freq: 1100, q: 6, dur: 0.02, gain: 0.4 });
      }, 1.2);
    },
    'sob-sting'(pos = ring(2, 3, 1.2)) { // the sobbing woman's head comes round: a hard intake, a thump, a bowed dissonant pair (restrained)
      A.playAt(pos, (c, out, t) => {
        A.noiseBurst(out, t, { type: 'bandpass', freq: 1800, q: 1.2, attack: 0.01, dur: 0.16, gain: 0.7 });
        A.tone(out, t, { freq: 62, freqEnd: 40, dur: 0.5, gain: 0.7 });
        A.tone(out, t + 0.02, { freq: 466, type: 'sawtooth', attack: 0.15, dur: 0.9, gain: 0.07, lp: 1100 });
        A.tone(out, t + 0.02, { freq: 493, type: 'sawtooth', attack: 0.15, dur: 0.9, gain: 0.06, lp: 1100 });
        A.tone(out, t + 0.02, { freq: 659, type: 'sawtooth', attack: 0.2, dur: 0.8, gain: 0.03, lp: 1100 });
      }, 2);
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
    const maps = [T.apparitionTex('woman_far'), T.apparitionTex('woman_near')];   // per stage; the near one has the hand on the pane
    const m = mat(maps[0], { opacity: 0.9 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.99), m); mesh.renderOrder = 1; mesh.visible = false; scene.add(mesh);
    const stages = [{ s: 1.0, dy: -0.2, rz: 0, op: 0.9 }, { s: 1.18, dy: -0.12, rz: 0.04, op: 1.0 }]; // [far from the glass, close to it]
    let anchor = null, st = 0;
    const apply = () => {
      const o = stages[st];
      m.map = maps[st];
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
  // Painted for a cover on its LEFT (assets/apparitions/SPEC.md): the plane sits behind the cover, offset sideways so the cover's
  // edge hides the plane's left 0.2 m; with the cover on the other side the whole group is mirrored (scale.x = -1). It is re-seated
  // from the camera's view of the cover every frame, so the cover keeps occluding it while the billboard turns.
  const creature = (() => {
    const grp = new THREE.Group(); grp.visible = false;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1.30, 2.60), mat(T.apparitionTex('beast_body'), { opacity: 1 })); body.position.y = 1.30; body.renderOrder = 1;   // after the lamp halos (order 0), so a halo behind the body silhouettes it
    const hand = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), mat(T.apparitionTex('beast_hand'), { opacity: 1 }));
    hand.position.set(CREATURE_EDGE - CREATURE_LAT - 0.25, 1.25, CREATURE_DEPTH + 0.8); hand.renderOrder = 2;   // right edge on the stone's edge, just in front of its face
    const E = T.eyesTex();
    const em = mat(E.tex, { blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    const eyes = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.125), em); eyes.position.set(-0.29, 1.70, 0.03); eyes.rotation.z = -0.21; eyes.renderOrder = 3;   // on the skull
    grp.add(body, hand, eyes); scene.add(grp);
    let hold = 0, isNoticed = false, step = -1, cover = null;
    const seat = (a, out) => { // behind the cover, offset toward the path side
      const dx = a.pos.x - camera.position.x, dz = a.pos.z - camera.position.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
      const mir = a.side === 'left' ? 1 : -1;   // painted cover side is left, so a left-side cover needs no mirror
      return out.set(a.pos.x - uz * CREATURE_LAT * mir + ux * CREATURE_DEPTH, 0, a.pos.z + ux * CREATURE_LAT * mir + uz * CREATURE_DEPTH);
    };
    const place = () => { grp.scale.x = cover.side === 'left' ? 1 : -1; hand.visible = cover.kind === 'stone'; seat(cover, grp.position); faceCamera(grp); };
    const light = (lit, d) => { body.material.opacity = lit; hand.material.opacity = lit; em.opacity = clamp(fogTr(d) * 3, 0, 1) * lit; };
    return {
      name: 'forest-shadow', fogK: 1, minDist: 9, maxDwell: 7.5, maxChanges: 0, point: new V3(), lamp: null,
      pointFor: (a) => seat(a, new V3()).setY(1.3),
      spawn(a, lamp) {
        cover = a; place(); this.point.copy(grp.position).setY(1.3); hold = 0; isNoticed = false; step = -1; E.draw(0); this.lamp = lamp;
        light(clamp(lamp ? lamp.flicker : 1, 0, 1), grp.position.distanceTo(camera.position));   // the first rendered frame already honours a flicker
        grp.visible = true;
      },
      change: () => false,
      vanish() { grp.visible = false; },
      noticed() { isNoticed = true; },
      update(dt, { observed }) {
        place();
        light(clamp(this.lamp ? this.lamp.flicker : 1, 0, 1), grp.position.distanceTo(camera.position));   // like the figure: dark while its lamp flickers
        if (!isNoticed || !observed) return; // it holds still; the smile only advances while it is being watched
        hold += dt;
        const m = clamp((hold - CREATURE_BEAT) / CREATURE_MORPH, 0, 1), k = Math.round(m * 32);
        if (k !== step) { step = k; E.draw(k / 32); }
      },
    };
  })();

  // ---- 4. the tall one: distant figure at the edge of the light ---------------------------------
  // Doorway anchor: figure_lean parallel to the facade behind the left jamb, plus a hand on the frame post; change() swaps to
  // figure_stand in the opening. Other anchors (corridor, village ends): figure_stand billboarded, change() steps closer.
  const figure = (() => {
    const grp = new THREE.Group(); grp.visible = false;   // the door-frame pose: local x right, z toward the court
    const sg = new THREE.Group(); sg.visible = false;     // the billboarded stand pose
    const mk = (name, w, h) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(T.apparitionTex(name), { opacity: 0.95 })); o.visible = false; o.renderOrder = 1; return o; };   // after the lamp halos, so they silhouette the figure
    const lean = mk('figure_lean', 1.4, 2.8), post = mk('figure_hand', 0.4, 0.4), stand = mk('figure_stand', 1.4, 2.8);
    lean.scale.setScalar(DOOR_LEAN_S); lean.position.set(DOOR_LEAN_LEFT + 0.7 * DOOR_LEAN_S, 1.4 * DOOR_LEAN_S + DOOR_LEAN_UP, -0.65);   // just inside the wall
    post.position.set(-1.6, 2.0, 0.29); post.renderOrder = 2;   // right edge on the post's inner edge, on its front face
    stand.position.y = 1.4;
    post.material.color.setScalar(DOOR_LEAN_HAND_GAIN);   // the lean itself stays unlit: a dark silhouette against the hall glow
    grp.add(lean, post); sg.add(stand); scene.add(grp, sg);
    let isDoor = false, standing = true;
    const inDoor = (a, x, y, z) => { const p = P.pointAt(a.s); return new V3(p.x + p.rx * x - p.tx * z, y, p.z + p.rz * x - p.tz * z); };   // door-frame local -> world
    const pose = () => { lean.visible = post.visible = isDoor && !standing; stand.visible = sg.visible = standing; };
    return {
      name: 'distant-figure', fogK: 1, minDist: 11, maxDwell: 4, maxChanges: 1, point: new V3(), lamp: null,
      pointFor: (a) => (a.kind === 'door' ? inDoor(a, DOOR_LEAN_HEAD[0] * DOOR_SIDE, DOOR_LEAN_HEAD[1], -0.65) : a.pos.clone().setY(1.5)),
      spawn(a, lamp) {
        isDoor = a.kind === 'door'; standing = !isDoor; this.lamp = lamp;
        if (isDoor) { const p = P.pointAt(a.s); grp.position.set(p.x, 0, p.z); grp.rotation.y = Math.atan2(-p.tx, -p.tz); grp.scale.x = DOOR_SIDE; }
        sg.position.copy(a.pos); sg.position.y = 0;
        stand.material.color.setHex(isDoor ? 0x9098a8 : 0xffffff);   // backlit in the doorway the stand pose reads too lit
        this.point.copy(this.pointFor(a)); pose(); grp.visible = true; faceCamera(sg); this.light();
      },
      light() { const o = 0.95 * clamp(this.lamp ? this.lamp.flicker : 1, 0, 1); lean.material.opacity = post.material.opacity = stand.material.opacity = o; },
      change() {
        if (isDoor) { standing = true; pose(); this.point.copy(sg.position).setY(1.5); return true; }
        const dx = camera.position.x - sg.position.x, dz = camera.position.z - sg.position.z, d = Math.hypot(dx, dz) || 1;
        sg.position.x += (dx / d) * FIGURE_STEP; sg.position.z += (dz / d) * FIGURE_STEP; this.point.copy(sg.position).setY(1.5);
        return true;
      },
      vanish() { grp.visible = false; sg.visible = false; },
      noticed() {},
      update() { faceCamera(sg); this.light(); },
    };
  })();

  const visual = { 'window-woman': woman, 'forest-shadow': creature, 'distant-figure': figure };

  // ===== round 2: five scripted apparitions (assets/round2/SPEC.md) ==============================================
  // Each actor owns a small slot of its own and is started by the director (a beat, or the random layer for the wraith and the
  // crossers); it enforces the director's rules itself through `host` (observe, gaze, deny, denyDark, tension): sound before
  // sight, change only while unobserved (the sobbing woman's head is the one stated exception), no clean lingering look.
  // actor api: busy, result, start(spec) -> bool, release() (the beat's window is over), update(dt), status().
  const T2 = (n) => T.apparitionTex(n, 'round2');
  const D2R = Math.PI / 180, cosCross = Math.cos(CROSS_GAZE_DEG * D2R);
  const R = {};
  const _f = new V3(), _e = new V3(), _d = new V3(), rc = new THREE.Raycaster();
  const fwdH = () => { camera.getWorldDirection(_f); const l = Math.hypot(_f.x, _f.z) || 1; return { x: _f.x / l, z: _f.z / l }; };
  const solids = []; scene.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) solids.push(o); });   // the world's solid geometry (houses, trunks, walls)
  const clear = (x, y, z) => {   // an unobstructed line from the eye to the point
    _e.copy(camera.position); _d.set(x, y, z).sub(_e); const d = _d.length(); rc.set(_e, _d.normalize()); rc.far = Math.max(0, d - 0.4);
    return rc.intersectObjects(solids, false).length === 0;
  };
  const surfNow = () => (P.surfaceAt(player.s) === 'cobble' ? 'cobble' : player.zone === 'estate' ? 'gravel' : 'dirt');

  // ---- 1. the weeping angel: stands in the lane AHEAD of the player (nobody looks back), closer each time the look is broken ----
  // `gap` is how far ahead of the player it stands. While it is unobserved it keeps pace (re-seated at `gap` every frame); the moment
  // it is observed it freezes where it is (and the player closes on it). Unobserved for ANGEL_STEP_AFTER s after having been seen, it takes
  // the next pose (a closer gap) before you look again. A look held too long is taken away by a flicker, and it moves on during the blink.
  // It first appears the same way, while the lane is dark: a blink, then it is standing there.
  R.angel = (() => {
    const maps = [0, 1, 2, 3].map((i) => T2(`angel_${i}`));
    const m = mat(maps[0], { opacity: 1 });
    const body = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.0), m); body.position.y = 1.0; body.renderOrder = 1;   // bottom edge on the ground
    const grp = new THREE.Group(); grp.add(body); grp.visible = false; scene.add(grp);
    const S = { on: false, phase: 'off', result: '', gap: 0, pose: 0, lat: 0, cue: 0, age: 0, seenT: 0, seen: false, unobs: 0, dwell: 0, arm: false, leaving: false, leaveT: 0 };
    const pos = new V3(), pt = new V3();
    const seat = () => {
      const p = P.pointAt(player.s + S.gap), lim = Math.max(0.2, P.halfWidth(p.s) - 0.45), lat = clamp(S.lat, -lim, lim);
      pos.set(p.x + p.rx * lat, 0, p.z + p.rz * lat); grp.position.copy(pos); pt.set(pos.x, 1.0, pos.z);
    };
    const end = (why) => { grp.visible = false; S.on = false; S.phase = 'off'; S.result = why; host.log(`angel:${why}`); };
    const advance = () => {
      S.pose = Math.min(S.pose + 1, ANGEL_GAPS.length - 1);
      S.gap = Math.max(ANGEL_MIN_DIST + 0.3, Math.min(ANGEL_GAPS[S.pose] + (S.pose === ANGEL_GAPS.length - 1 ? 0 : rnd(-ANGEL_JITTER, ANGEL_JITTER)), S.gap - 0.8));   // closer than where it stood, however far you walked toward it
      m.map = maps[S.pose]; Object.assign(S, { seen: false, seenT: 0, unobs: 0, dwell: 0, arm: false });
      seat(); snd['stone-scrape']({ x: pos.x, y: 0.3, z: pos.z }); host.tension(0.04); host.log('angel:closer');
    };
    return {
      get busy() { return S.on; }, get result() { return S.result; },
      start() {
        if (S.on) return false;
        Object.assign(S, { on: true, phase: 'cue', result: '', gap: ANGEL_GAPS[0], pose: 0, lat: rnd(-0.85, 0.85), cue: rnd(...ANGEL_CUE), age: 0, wait: 0, seenT: 0, seen: false, unobs: 0, dwell: 0, arm: false, leaving: false, leaveT: 0 });
        grp.scale.x = Math.random() < 0.5 ? -1 : 1; m.map = maps[0];   // mirrored or not, the same for all four poses
        seat(); snd['stone-scrape']({ x: pos.x, y: 0.3, z: pos.z });
        return true;
      },
      release() { S.leaving = true; },
      update(dt) {
        if (!S.on) return;
        if ((S.age += dt) > ANGEL_LIFE) S.leaving = true;
        if (S.phase === 'cue') {
          if ((S.cue -= dt) > 0) return;
          if (S.leaving) return end('missed');
          seat();
          const o = host.observe(pt);
          if (o.obs && !host.denyDark()) {                          // it only appears unseen: if the lane is being watched, a blink makes it so
            if ((S.wait += dt) > 1.5 && !host.denying()) host.deny(pt, o.d);
            return;
          }
          grp.visible = true; S.phase = 'live'; return;
        }
        const dark = host.denyDark(), o = host.observe(pt), obs = o.obs && !dark;
        if (!host.denying()) S.arm = false;
        grp.visible = !dark; faceCamera(grp);
        if (obs) {
          S.unobs = 0; S.seenT += dt; S.gap = Math.min(S.gap, o.d);   // frozen where it stands, and the walker closes on it
          if (S.seenT > 0.15 && !S.seen) { S.seen = true; host.tension(0.12); }
          S.dwell = host.gaze(o) ? S.dwell + dt : Math.max(0, S.dwell - 2 * dt);
          if (S.leaving) S.leaveT += dt;
          if (!S.arm && (S.dwell > ANGEL_GAZE_MAX || o.d < ANGEL_MIN_DIST || S.leaveT > 1) && host.deny(pt, o.d)) S.arm = true;
        } else {
          S.seenT = 0; S.unobs += dt;
          if (S.leaving) return end('left');                        // the window is over: it goes on the first look-away or blink
          if (dark && S.arm) { S.arm = false; if (S.pose === ANGEL_GAPS.length - 1 || o.d < ANGEL_MIN_DIST * 1.6) return end('denied'); advance(); }
          else if (S.seen && S.unobs >= ANGEL_STEP_AFTER) advance();
          else seat();
        }
      },
      status: () => `${S.phase} pose ${S.pose} gap ${S.gap.toFixed(1)} ${S.seen ? 'seen' : '-'} unobs ${S.unobs.toFixed(1)}`,
    };
  })();

  // ---- 2. the woman in the landing's ceiling corner: lit by the landing lamp, gone on look-away-and-back or a flicker --------
  R.ceiling = (() => {
    const apex = world.anchors.corners.find((c) => c.id === 'estate-landing-corner'), lamp = world.lamps.find((l) => l.id === apex.lamp);
    const m = mat(T2('ceiling_woman'), { opacity: 0 });
    const piv = new THREE.Group(); piv.position.copy(apex.pos); piv.rotation.set(CEIL_TILT, apex.yaw, 0, 'YXZ');   // yaw to face down the hall, then tilt down; never rolled
    const body = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), m); body.position.y = -1.0; body.renderOrder = 1; m.color.setScalar(1.35);   // top-centre of the plane at the corner
    piv.add(body); piv.visible = false; scene.add(piv);
    const S = { on: false, phase: 'off', result: '', seen: false, seenT: 0, unobs: 0, dwell: 0, arm: false, leaving: false };
    const end = (why) => { piv.visible = false; S.on = false; S.phase = 'off'; S.result = why; host.log(`ceiling:${why}`); };
    return {
      get busy() { return S.on; }, get result() { return S.result; },
      start() {
        if (S.on) return false;
        Object.assign(S, { on: true, phase: 'wait', result: '', seen: false, seenT: 0, unobs: 0, dwell: 0, arm: false, leaving: false });
        return true;
      },
      release() { S.leaving = true; },
      update(dt) {
        if (!S.on) return;
        const o = host.observe(apex.pos, 1, lamp);                  // lamp-aware: dark while the lamp flickers
        if (S.phase === 'wait') {
          if (S.leaving) return end('missed');
          if (lamp.level < 0.85 || lamp.flicker < 0.9 || o.obs) return;   // the lamp must be on and nobody looking at the corner
          piv.visible = true; S.phase = 'live'; host.tension(0.1); host.log('ceiling:spawn');
        }
        m.opacity = clamp(lamp.level, 0, 1) * clamp(lamp.flicker, 0, 1);
        if (o.obs) {
          S.unobs = 0; if ((S.seenT += dt) > 0.15) S.seen = true;
          S.dwell = host.gaze(o) ? S.dwell + dt : Math.max(0, S.dwell - 2 * dt);
          if (!S.arm && S.dwell > CEIL_GAZE_MAX && host.deny(apex.pos, o.d, lamp.id)) S.arm = true;   // that lamp flickers
        } else {
          S.seenT = 0; S.unobs += dt;
          if (S.leaving || (S.arm && lamp.flicker < 0.3) || (S.seen && S.unobs > CEIL_GONE_AFTER)) end(S.arm ? 'flicker' : S.seen ? 'gone' : 'left');
        }
      },
      status: () => `${S.phase} ${S.seen ? 'seen' : '-'} dwell ${S.dwell.toFixed(1)}`,
    };
  })();

  // ---- 3. the sobbing woman at the open lodge window ----------------------------------------------------------------
  // Sobbing is audible first (audio.sobber, from the beat's start). She is in the dark window from the start, seen from behind with
  // a little life (slow breathing, a sway, her shoulders jolting in step with the sobs), but is only made out as a gaze dwells on it
  // (the eyes adjust: a fade, not a pop). Watched on (or, if you hang about near her, after a time cap) the sobbing stops dead, a beat
  // of silence, then she turns in two stages (a squash and twist of the plane, then a lunge as she comes round, with a cloth and
  // bone creak and a sting). She stares: a clear hold with the eyes bright and a slow drift toward you. Then the smile grows (the
  // creature's eye morph). She is gone only when you look away or a beat after the smile is complete, with a flicker or fog swell,
  // never mid-stare: the stare and the smile only advance while she is being watched.
  R.sob = (() => {
    const maps = [T2('sob_back'), T2('sob_turn')];
    const m = mat(maps[0], { opacity: 0 });
    const haloTex = () => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(0.55, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); };
    const rig = new THREE.Group(); rig.visible = false;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); body.renderOrder = 1; body.scale.setScalar(SOB_SCALE);
    const hm = mat(haloTex(), { opacity: 0 });   // a dark halo behind her and a contact shadow under her: she sits in the opening, not on it
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.25), hm), contact = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), hm);
    shadow.position.set(0, 0.02, -0.02); contact.position.set(0, -0.41, -0.012);
    const E = T.eyesTex(), em = mat(E.tex, { blending: THREE.AdditiveBlending, fog: false, opacity: 0 });
    const eyes = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.075), em); eyes.position.set(0.04, 0.208, 0.004); eyes.renderOrder = 3; body.add(eyes);   // on the painted eyes (plane units)
    rig.add(shadow, contact, body);
    const S = { on: false, phase: 'off', result: '', a: null, voice: null, t: 0, life: 0, limit: 0, dwell: 0, near: 0, away: 0, show: 1.2, turn: 2.5, revealed: false, leaving: false, swapped: false, st: 0, sm: 0, hold: 0, step: -1 };
    const gaze = new V3(), vp = new V3();
    const end = (why) => { S.a.group.remove(rig); rig.visible = false; E.draw(0); S.on = false; S.phase = 'off'; S.result = why; host.log(`sob:${why}`); };
    return {
      get busy() { return S.on; }, get result() { return S.result; },
      start(b) {
        if (S.on) return false;
        const a = world.anchors.windows.find((w) => w.id === b.anchor);
        if (!a) return false;
        Object.assign(S, { on: true, phase: 'sob', result: '', a, t: 0, life: 0, dwell: 0, near: 0, away: 0, show: rnd(...SOB_SHOW), turn: rnd(...SOB_TURN), revealed: false, leaving: false, swapped: false, st: 0, sm: 0, hold: 0, step: -1 });
        a.group.updateWorldMatrix(true, false); a.group.add(rig); rig.position.set(...SOB_LOCAL); rig.visible = true; m.map = maps[0]; m.opacity = hm.opacity = em.opacity = 0;
        body.scale.setScalar(SOB_SCALE); body.rotation.set(0, 0, 0); E.draw(0);
        gaze.set(...SOB_LOCAL).applyMatrix4(a.group.matrixWorld);
        vp.copy(a.interior).addScaledVector(a.normal, -0.5).setY(1.1);   // the voice comes from inside the room
        S.voice = A.sobber(vp);
        return true;
      },
      release() { S.leaving = true; },
      update(dt) {
        if (!S.on) return;
        S.t += dt; S.life += dt;
        const o = host.observe(gaze), inRange = o.d >= SOB_RANGE[0] && o.d <= SOB_RANGE[1], see = o.obs && !host.denyDark();
        S.away = o.obs ? 0 : S.away + dt;
        if (S.phase === 'sob') {
          const pl = S.voice ? S.voice.pulse() : Math.max(0, Math.sin(S.life * 2.3) * Math.sin(S.life * 0.8 + 1)) ** 2;   // her shoulders jolt with each sob (a slow irregular beat when there is no audio)
          rig.position.set(SOB_LOCAL[0] + Math.sin(S.life * 0.5) * 0.006 + rnd(-0.002, 0.002) * pl, SOB_LOCAL[1] + 0.009 * pl, SOB_LOCAL[2]);   // a tiny sway; the shudder
          body.scale.set(SOB_SCALE, SOB_SCALE * (1 + 0.014 * Math.sin(S.life * 1.4) - 0.02 * pl), 1);                                          // slow breathing
          body.rotation.z = Math.sin(S.life * 0.37) * 0.012 + 0.014 * pl * Math.sin(S.life * 38);
          S.dwell = inRange && host.gaze(o) ? S.dwell + dt : Math.max(0, S.dwell - 2 * dt);
          S.near = inRange && o.obs ? S.near + dt : S.near;
          if (S.dwell >= S.show || (S.near >= SOB_NEAR_CAP - 3 && see)) S.revealed = true;
          m.opacity = S.revealed ? Math.min(1, m.opacity + dt * 2.5) : 0;
          hm.opacity = m.opacity * 0.75;
          if (S.revealed && m.opacity >= 1 && (S.dwell >= S.turn || S.near >= SOB_NEAR_CAP)) {
            if (S.voice) S.voice.stop(); S.voice = null;                              // stops dead
            rig.position.set(...SOB_LOCAL); body.scale.setScalar(SOB_SCALE); body.rotation.set(0, 0, 0);
            S.phase = 'silence'; S.t = 0; S.limit = rnd(...SOB_SILENCE);
          } else if (S.leaving) {
            if (S.voice) S.voice.fade(SOB_FADE); S.voice = null;
            if (!S.revealed || !o.obs) end('faded');
          }
        } else if (S.phase === 'silence') {                                              // a beat of dead stillness
          if (S.t >= S.limit) {
            S.phase = 'twist'; S.t = 0; S.swapped = false;
            snd['sob-creak'](vp); host.tension(0.25); host.log('sob:turn');
          }
        } else if (S.phase === 'twist') {                                                // stage 1: the body twists edge-on; stage 2: it comes round with a lunge
          const k1 = clamp(S.t / SOB_TWIST[0], 0, 1), k2 = clamp((S.t - SOB_TWIST[0]) / SOB_TWIST[1], 0, 1);
          if (S.t >= SOB_TWIST[0] && !S.swapped) { S.swapped = true; m.map = maps[1]; snd['sob-sting'](vp); }
          const e1 = k1 * k1 * (3 - 2 * k1), e2 = 1 - (1 - k2) ** 3, lunge = 1 + 0.14 * Math.min(1, S.t / 0.34);
          body.rotation.y = S.swapped ? -0.4 * (1 - e2) : 0.95 * e1;
          body.scale.set(SOB_SCALE * lunge * (S.swapped ? 0.45 + 0.55 * e2 + 0.06 * Math.sin(Math.PI * k2) : 1 - 0.55 * e1), SOB_SCALE * lunge, 1);
          rig.position.z = SOB_LOCAL[2] + 0.02 * Math.min(1, S.t / 0.34);
          if (S.t >= SOB_TWIST[0] + SOB_TWIST[1]) { S.phase = 'stare'; S.t = 0; S.st = 0; S.limit = rnd(...SOB_STARE); body.rotation.y = 0; }
        } else {                                                                         // stare, smile, after: time only counts while she is watched
          const w = see ? dt : 0;
          if (S.phase !== 'leave') em.opacity = Math.min(1, em.opacity + dt * 3);          // the eyes widen and brighten and stay steady
          if (S.phase === 'stare') {
            S.st += w; const k = clamp(S.st / S.limit, 0, 1);
            rig.position.z = SOB_LOCAL[2] + 0.02 + 0.03 * k;                               // a slow drift toward you
            body.scale.setScalar(SOB_SCALE * (1.14 - 0.08 * clamp(S.t / 0.8, 0, 1) + 0.02 * k));
            if (S.st >= S.limit) { S.phase = 'smile'; S.sm = 0; }
          } else if (S.phase === 'smile') {
            S.sm += w; const k = Math.round(clamp(S.sm / SOB_SMILE, 0, 1) * 32);
            if (k !== S.step) { S.step = k; E.draw(k / 32); }
            if (S.sm >= SOB_SMILE) { S.phase = 'after'; S.hold = 0; }
          } else if (S.phase === 'after') {
            if (!o.obs) return end('gone');                                                // looked away: simply gone
            if ((S.hold += dt) >= SOB_AFTER) S.phase = 'leave';
          } else {                                                                         // still watched a beat after the smile: a flicker or fog swell takes the look
            S.hold += dt;
            if (host.denyDark() || !o.obs || S.hold > SOB_AFTER + 4) return end('turned');
            if (!host.denying()) host.deny(gaze, o.d);
          }
          if (S.away > 25 || (S.leaving && S.away > 3)) return end('left');
        }
      },
      status: () => `${S.phase} dwell ${S.dwell.toFixed(1)}${S.revealed ? ' shown' : ''} st ${S.st.toFixed(1)} sm ${S.sm.toFixed(1)}`,
    };
  })();

  // ---- 4. the forest wraith: a long sigh crossing the path, a faint pale shape between the trunks -----------------------
  R.wraith = (() => {
    const m = mat(T2('wraith'), { opacity: 0 });
    const body = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.6), m); body.renderOrder = 1; body.visible = false; scene.add(body);
    const S = { on: false, result: '', x: 0, z: 0, fx: 1, fz: 0, a0: 0, a1: 0, d: 15, y: 1.6, t: 0, dur: 4, dwell: 0, gone: 0, sigh: null };
    const end = (why) => { body.visible = false; S.on = false; S.result = why; host.log(`wraith:${why}`); };
    return {
      get busy() { return S.on; }, get result() { return S.result; },
      start() {
        if (S.on) return false;
        const f = fwdH(), sgn = Math.random() < 0.5 ? -1 : 1, a = rnd(...WRAITH_BEARING) * D2R * sgn, c = Math.cos(a), s = Math.sin(a);
        const d = rnd(WRAITH_DIST[0], Math.min(WRAITH_DIST[1], Math.max(WRAITH_DIST[0], 1.0 / scene.fog.density)));   // thick fog (the gate) brings it nearer, or nothing would show
        const rx = f.x * c - f.z * s, rz = f.x * s + f.z * c;   // starts outside the view cone and sweeps across toward the gaze (bearings are about the heading it appeared in)
        Object.assign(S, { on: true, result: '', x: camera.position.x + rx * d, z: camera.position.z + rz * d, fx: f.x, fz: f.z, a0: a, a1: sgn * rnd(...WRAITH_END) * D2R, d, y: rnd(1.5, 1.8), t: 0, dur: rnd(...WRAITH_TIME), dwell: 0, gone: 0 });
        S.sigh = A.sigh({ x: S.x, y: S.y, z: S.z }, S.dur);
        body.scale.x = sgn; body.visible = true; m.opacity = 0; body.position.set(S.x, S.y, S.z);
        return true;
      },
      release() {},
      update(dt) {
        if (!S.on) return;
        S.t += dt;
        const k = clamp(S.t / S.dur, 0, 1), e = k * k * (3 - 2 * k), aa = S.a0 + (S.a1 - S.a0) * e, ca = Math.cos(aa), sa = Math.sin(aa), dd = S.d * (1 - 0.2 * e);
        S.x = camera.position.x + (S.fx * ca - S.fz * sa) * dd; S.z = camera.position.z + (S.fx * sa + S.fz * ca) * dd;
        body.position.set(S.x, S.y, S.z); faceCamera(body); body.rotation.z = Math.sin(S.t * 0.9) * 0.04;
        if (S.sigh) S.sigh.move(S.x, S.y, S.z);
        const o = host.observe(body.position), tr = fogTr(o.d);
        if (S.t > S.dur || player.zone !== 'forest') return end('done');
        S.dwell = o.obs && host.gaze(o) ? S.dwell + dt : Math.max(0, S.dwell - 2 * dt);
        if (S.dwell > WRAITH_GAZE_MAX || o.d < WRAITH_DIST[0] - 3) S.gone += dt;   // gazed at (or too near): gone within a quarter second, for good
        const fade = clamp(S.t / 1.2, 0, 1) * clamp((S.dur - S.t) / 0.8, 0, 1) * (1 - clamp(S.gone / 0.25, 0, 1));
        m.opacity = clamp(WRAITH_FOG_GAIN * tr * tr, 0, 0.75) * fade;
        if (S.gone > 0.25) end('gazed');
      },
      status: () => `${S.t.toFixed(1)}/${S.dur.toFixed(1)}s dwell ${S.dwell.toFixed(1)} op ${m.opacity.toFixed(2)}`,
    };
  })();

  // ---- 5. the barely-seen crossers: a dash across a gap, behind a pane, visible a fraction of a second ----------------------
  // Spawn in peripheral view, beyond CROSS_DIST[0], never inside the gaze cone; dash along the plane's own u axis (fixed
  // orientation, never re-billboarded); if the gaze swings onto it, it is gone that frame. Its sound comes first.
  R.crosser = (() => {
    const defs = { run: ['crosser_run', 1.6, 1.8], low: ['crosser_low', 1.8, 0.45] };
    const slots = {};
    for (const [k, [name, w, h]] of Object.entries(defs)) {
      const cm = mat(T2(name), { opacity: 0 }), o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cm), g = new THREE.Group();
      o.position.y = h / 2; o.renderOrder = 1; g.add(o); g.visible = false; scene.add(g); slots[k] = { g, m: cm };
    }
    const wm = mat(T2('crosser_window'), { opacity: 0 }), wo = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0), wm); wo.renderOrder = 1; wo.visible = false;
    slots.window = { g: wo, m: wm };
    const S = { on: false, phase: 'off', result: '', kind: '', t: 0, lead: 0, dur: 0, x: 0, z: 0, ux: 0, uz: 0, dir: 1, L: 0, ry: 0, a: null };
    const end = (why) => { const s = slots[S.kind]; s.g.visible = false; s.m.opacity = 0; if (S.a) S.a.group.remove(wo); S.a = null; S.on = false; S.phase = 'off'; S.result = why; host.log(`crosser:${why}`); };
    function pickGround(kind) {
      const f = fwdH(), cam = camera.position, L = rnd(...CROSS_LEN[kind]), h = kind === 'run' ? 1.0 : 0.25;
      for (let i = 0; i < CROSS_TRIES; i++) {
        const a = rnd(...CROSS_ANGLE) * D2R * (Math.random() < 0.5 ? -1 : 1), d = rnd(...CROSS_DIST), c = Math.cos(a), s = Math.sin(a);
        const x = cam.x + (f.x * c - f.z * s) * d, z = cam.z + (f.x * s + f.z * c) * d, ry = Math.atan2(cam.x - x, cam.z - z);
        const ux = Math.cos(ry), uz = -Math.sin(ry), dir = Math.random() < 0.5 ? -1 : 1, x0 = x - ux * dir * L / 2, z0 = z - uz * dir * L / 2;
        if (clear(x0, h, z0) && clear(x, h, z) && clear(x + ux * dir * L / 2, h, z + uz * dir * L / 2)) return { x: x0, z: z0, ux, uz, dir, L, ry };
      }
      return null;
    }
    function pickWindow() {
      const cam = camera.position, f = fwdH(), c = [];
      for (const a of world.anchors.windows) {
        if (a.reserved || a.zone !== player.zone || host.beatOwns(a.id)) continue;
        const dx = a.pos.x - cam.x, dz = a.pos.z - cam.z, d = Math.hypot(dx, dz);
        if (d < CROSS_DIST[0] || d > CROSS_DIST[1] + 6 || dx * a.normal.x + dz * a.normal.z >= 0) continue;   // in range and facing us
        const ang = Math.acos(clamp((f.x * dx + f.z * dz) / d, -1, 1)) / D2R;
        if (ang >= CROSS_ANGLE[0] && ang <= CROSS_ANGLE[1] && clear(a.pos.x, a.pos.y, a.pos.z)) c.push(a);
      }
      return c.length ? c[(Math.random() * c.length) | 0] : null;
    }
    const cue = (kind, x, z, ux, uz) => {   // its sound, a fraction before it shows
      if (kind === 'window') { A.playAt({ x, y: 1.6, z }, (c, out, t) => { knockOne(out, t, 0.14); knockOne(out, t + 0.17, 0.1); }, 0.8); return; }
      const surf = surfNow(), q = { x, y: 0.1, z };
      for (let i = 0; i < 5; i++) later(() => {
        q.x += ux * 0.9; q.z += uz * 0.9;
        A.playAt({ ...q }, (c, out, t) => (kind === 'run' ? A.stepSound(out, t, surf, 0.5) : A.noiseBurst(out, t, { type: 'bandpass', freq: 2800, q: 2, dur: 0.05, gain: 0.35 })), 0.5);
      }, i * (kind === 'run' ? 0.09 : 0.07));
    };
    return {
      get busy() { return S.on; }, get result() { return S.result; },
      start() {
        if (S.on) return false;
        const win = pickWindow(), kind = win && Math.random() < 0.45 ? 'window' : Math.random() < 0.6 ? 'run' : 'low', g = kind === 'window' ? null : pickGround(kind);
        if (kind !== 'window' && !g && !win) return false;                                     // no open gap in the periphery just now
        const k = g ? kind : 'window';
        Object.assign(S, { on: true, phase: 'lead', result: '', kind: k, t: 0, lead: rnd(...CROSS_LEAD), dur: rnd(...CROSS_TIME), a: null });
        if (k === 'window') {
          S.a = win; S.dir = Math.random() < 0.5 ? -1 : 1; S.L = CROSS_LEN.window[0]; S.dur = rnd(0.35, CROSS_TIME[1]);
          cue(k, win.pos.x, win.pos.z, 0, 0);
        } else {
          Object.assign(S, g); S.dir = g.dir; cue(k, g.x, g.z, g.ux * g.dir, g.uz * g.dir);
        }
        return true;
      },
      release() {},
      update(dt) {
        if (!S.on) return;
        S.t += dt;
        const sl = slots[S.kind];
        if (S.phase === 'lead') {
          if (S.t < S.lead) return;
          if (S.kind === 'window') { S.a.group.updateWorldMatrix(true, false); S.a.group.add(wo); }
          S.phase = 'run'; S.t = 0; sl.g.visible = true; sl.g.scale.x = S.dir;
          if (S.kind !== 'window') { sl.g.position.set(S.x, 0, S.z); sl.g.rotation.y = S.ry; }
        }
        const k = S.t / S.dur;
        if (k >= 1) return end('done');
        if (S.kind === 'window') sl.g.position.set(S.dir * S.L * (k - 0.5), -0.3, 0.065);   // local to the window group, along its u axis
        else sl.g.position.set(S.x + S.ux * S.dir * S.L * k, 0, S.z + S.uz * S.dir * S.L * k);
        sl.m.opacity = Math.min(1, S.t / 0.05, (S.dur - S.t) / 0.07) * 0.95;
        const p = S.kind === 'window' ? _e.set(S.a.pos.x, S.a.pos.y, S.a.pos.z) : _e.set(sl.g.position.x, 1.0, sl.g.position.z);
        if (host.observe(p).cos > cosCross) end('gazed');                                      // the gaze swung onto it: gone that frame
      },
      status: () => `${S.kind} ${S.phase} ${S.t.toFixed(2)}/${S.dur.toFixed(2)}s`,
    };
  })();

  const r2 = {
    get busy() { return Object.values(R).some((x) => x.busy); },
    start: (name, spec) => R[name].start(spec),
    release: (name) => R[name].release(),
    running: (name) => R[name].busy,
    result: (name) => R[name].result,
    status: () => Object.entries(R).filter(([, x]) => x.busy).map(([k, x]) => `${k}: ${x.status()}`).join(' | ') || '-',
  };
  return {
    audio: snd, visual, steps, r2,
    onPlayerStep: () => steps.onPlayerStep(),
    update(dt) {
      now += dt;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= now) { const f = timers[i].fn; timers.splice(i, 1); f(); }
      steps.update(dt);
      for (const x of Object.values(R)) x.update(dt);
    },
  };
}
