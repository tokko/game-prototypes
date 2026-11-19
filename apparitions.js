// The four apparitions and the audio-only one-shots. This module only knows how to *show* things;
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
    const eyes = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), em); eyes.position.set(0.09, 1.70, 0.03); eyes.rotation.z = -0.21; eyes.renderOrder = 3;   // on the skull
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
