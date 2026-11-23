// The fleshbeast: one fused pile of pale bodies (assets/fleshbeast_anim.glb, skinned clips; fleshbeast.glb is the static fallback) that scuttles through the dark in
// stop-start bursts. It is never fought and never catches the player; it keeps MIN_DIST away, is seen only
// in part (lamp-light edge, fog, behind walls, banks and corners), and bolts or vanishes in a flicker when
// stared at. The director (director.js) starts a SCRIPT from a beat and lends this module its "observed"
// test and its lamp-flicker / fog-swell denial; the choir and the skittering live in audio.js.
//
// Positions are kept in the path frame (s along the path, lat to the right of it, y up) so the beast follows
// bends, corridor walls and the ceiling for free. Everything moves on a ~12 Hz tick, so the motion is stepped.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as P from './path.js';

// ===== TUNING ==========================================================================================
export const BEAST = {
  MODEL_ANIM: './assets/fleshbeast_anim_v6.glb',   // skinned, clips idle_writhe / skitter / lunge / thrash (30 fps)
  FADE: 0.25,                 // s crossfade between clips
  SKITTER_SPEED: 2.5,         // model-units/s the skitter clip's planted feet slide back; timeScale = world speed / (this * scale)
  CLOSE_THRASH: 5,            // m, thrash when this close to the camera
  ANIM_WRITHE: 1 / 3,         // factor on ROLL / SHIVER when the clips drive the body
  MODEL: './assets/fleshbeast.glb',   // fallback (static mesh, old behaviour): 3.07 m deep, 2.5 m wide, 1.77 m high raw; origin at ground centre, front +Z
  SCALE: 0.68,                // outdoors: about 2.1 m deep, 1.7 m wide
  SCALE_TIGHT: 0.5,           // in the hall and corridor (half width 1.15 m)
  TICK_HZ: [10, 14],          // transform / logic tick rate (random per tick)
  SPEED: [5, 9],              // m/s inside a burst
  BURST_T: [0.3, 1.2],        // s per burst
  STILL: [0.5, 2.8],          // s between bursts
  STILL_LONG: [3.5, 6.5],     // an occasional long freeze
  LONG_CHANCE: 0.2,
  ZIGZAG: 0.7,                // rad, max odd-angle swerve of a burst away from the line to its goal
  SIDEWAYS_CHANCE: 0.3,       // chance the body faces sideways / backwards while it scuttles
  BOB: 0.07, TILT: 0.12,      // m / rad, stepped bobbing and tilt that imply legs
  TWITCH_CHANCE: 0.18,        // per still tick: a sudden micro twitch
  MIN_DIST: 2.8,              // m, never closer to the player than this
  GAZE_DEG: 26,               // half angle that counts as "looked at"
  GAZE_LIMIT: [1.5, 2.5],     // s of being gazed at before it bolts or is denied
  DENY_CHANCE: 0.4,           // chance the denial is a freeze + lamp flicker / fog swell instead of a bolt
  BOLT_SPEED: 9,              // m/s
  FLEE_MAX: 4,                // s a bolt may stay in sight before a flicker/fog swell takes over
  SPAWN_WAIT: 14,             // s a spawn waits for its spot to be unobserved before the script is dropped
  SEEN_TENSION: 0.15,         // tension added when it first shows
  ROLL: 0.035, SHIVER: 0.006, // m, vertex writhing (slow roll) and shiver amplitude in model space
  GLOW: 0.07,                 // faint self-light (fraction of its colour) so the pale mass still reads in the dark; fog still applies
  CHOIR_RANGE: 48,            // m over which the choir thins out
};

// Acts run in order. ds = metres ahead of the player's arc length and lat = metres right of the path centre,
// both resolved when a burst starts (so goals keep pace with the player). surf: g ground (default), w wall
// (side = sign of lat, y = height), c ceiling. `mirror` flips lat per run. A stage starts at a 'spawn';
// after a bolt the beast skips to the next stage, and ends when none is left.
//   ghost  choir only, out of sight, hovering at (ds, lat) for t s
//   spawn  appear at (ds, lat) - waits until that spot is unobserved
//   go     scuttle there in bursts (still: [a,b] between bursts, speed, hold: [a,b] at the end)
//   rush   a fast go that is exempt from the gaze rule, choir surges (any act may be `exempt: true`; `maxS` caps its arc length)
//   freeze hold in place (hushing the choir), then `deny` a lamp (id) flicker / fog swell and vanish
export const SCRIPTS = {
  warn:      { s1: 264, maxT: 30, acts: [{ a: 'ghost', t: 16, ds: 42, lat: 22 }] },
  hollow: { s1: 304, maxT: 60, acts: [
    { a: 'ghost', t: 3, ds: 40, lat: 9 },
    { a: 'spawn', ds: -6, lat: 5.2 },                                       // over the shoulder on the bank, off screen
    { a: 'go', ds: 12, lat: 4.6, speed: [6, 9], still: [0.3, 1.0] },        // skitters past along the bank
    { a: 'go', ds: 11, lat: -4.6, speed: [8, 10], still: [0.15, 0.5] },     // crosses the path ahead
    { a: 'go', ds: 6.5, lat: -4.6, hold: [1, 2.5] },                        // lingers on the far bank
    { a: 'go', ds: -9, lat: -5, speed: [8, 10], still: [0.1, 0.4] },        // circles round behind
    { a: 'go', ds: -28, lat: 5, speed: [8, 10], still: [0.1, 0.3] },
    { a: 'spawn', ds: 50, lat: 5.5 },                                       // second stage, if it was driven off: out in the fog
    { a: 'go', ds: 24, lat: 5 }, { a: 'go', ds: 13, lat: -4.5, speed: [8, 10], still: [0.15, 0.5] },
    { a: 'go', ds: -20, lat: -5, speed: [8, 10], still: [0.1, 0.3] },
  ] },
  courtyard: { s1: 386, maxT: 40, acts: [                                      // short: the player is at the door within seconds
    { a: 'ghost', t: 1.2, ds: -4, lat: 12 },
    { a: 'spawn', ds: -5, lat: 8.8, surf: 'w', y: 1.2 },                   // over the player's shoulder, off screen
    { a: 'go', ds: 9, lat: 8.8, surf: 'w', y: 1.5, maxS: 371, speed: [7, 9], still: [0.2, 0.7] },    // along the right wall
    { a: 'go', ds: 10, lat: 8.8, surf: 'w', y: 2.4, maxS: 371, still: [0.3, 0.8] },                   // up it
    { a: 'go', ds: 10, lat: -8.8, surf: 'w', y: 1.0, maxS: 371, speed: [8, 10], still: [0.1, 0.4] },  // across the court
    { a: 'go', ds: 6, lat: -8.8, surf: 'w', y: 1.6, maxS: 371, hold: [1.2, 2.5] },
    { a: 'go', ds: -3.6, lat: 1.5, speed: [8, 10], still: [0.1, 0.3] },     // behind the player, in the porch
    { a: 'go', ds: -3.6, lat: 1.5, hold: [2, 3] },
  ] },
  corridor: { s1: 424, maxT: 40, acts: [
    { a: 'ghost', t: 3.5, ds: 18, lat: 0 },
    { a: 'spawn', ds: 15, lat: -1.2, surf: 'w', y: 1.5 },                   // beyond the bend, behind the wall
    { a: 'go', ds: 10, lat: -1.2, surf: 'w', y: 1.7, still: [0.3, 0.9], exempt: true },   // comes round the corner
    { a: 'go', ds: 8, lat: 0, surf: 'c', still: [0.3, 0.8], hold: [0.2, 0.5], exempt: true },   // onto the ceiling at the edge of the light
    { a: 'rush', ds: 3.3, lat: 0, surf: 'c', still: [0.12, 0.3], speed: [8, 10] },
    { a: 'freeze', t: [0.6, 0.9], lamp: 'estate-corridor-light' },
  ] },
  glimpse: { s1: 1e9, maxT: 24, acts: [                                        // rare, distant only
    { a: 'ghost', t: 2.5, ds: 25, lat: 20 },
    { a: 'spawn', ds: 10, lat: 20 },
    { a: 'go', ds: 18, lat: 22, still: [0.3, 1.0] }, { a: 'go', ds: 22, lat: -20, still: [0.1, 0.4], speed: [8, 10] },
  ] },
};

const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const range = (r) => rand(r[0], r[1]);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const HO = P.PLACES['forest-hollow'].s, DS = P.DOOR_S, ES = P.END_S, COURT0 = P.PLACES['estate-courtyard'].s - 13;
const interior = (s) => s >= DS - 0.5 && s <= ES + 1;
const courtyard = (s) => s >= COURT0 && s < DS - 0.5;
const wallLat = (s) => (interior(s) ? P.halfWidth(s) + 0.05 : 8.85);   // corridor walls / courtyard walls
const ceilY = (s) => (s < 389 ? 4.3 : 2.85);
function groundY(s, lat) {   // flat except the hollow's earth banks (same profile as world.js)
  const hk = smooth(HO - 22, HO - 12, s) * (1 - smooth(HO + 12, HO + 22, s));
  if (hk <= 0) return 0;
  const d = Math.abs(lat) - P.halfWidth(s), k = [[0.05, 0.1], [0.9, 1.5 * hk + 0.1], [2.3, 2.15 * hk + 0.1], [6, 2.6 * hk + 0.1]];
  if (d <= k[0][0]) return 0.1;
  for (let i = 1; i < 4; i++) if (d < k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (d - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
  return k[3][1];
}

export function createBeast(game, host) {
  const { scene, camera, player, audio } = game;
  const K = BEAST, cosGaze = Math.cos(K.GAZE_DEG * Math.PI / 180);
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const uniforms = { uTime: { value: 0 } };
  let loaded = false;

  // ---- model: one mesh, one material; vertex shader adds a slow writhing roll and a faint shiver ----------
  // Preferred: skinned GLB with clips driven by an AnimationMixer. Fallback: the old static GLB, code-driven.
  let mixer = null, actions = {}, cur = null;
  function onModel(gltf, animated) {
    const wk = animated ? K.ANIM_WRITHE : 1;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (animated) o.frustumCulled = false;   // bounds come from the bind pose
      const m = o.material;
      m.emissive.set(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = K.GLOW;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uniforms.uTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float roll = 0.5 * sin(position.x * 2.3 + position.z * 1.7 + uTime * 0.8) + 0.5 * sin(position.y * 3.1 + position.z * 2.2 - uTime * 0.6);
          float shiv = sin(dot(position, vec3(31.0, 27.0, 35.0)) + uTime * 23.0);
          transformed += normal * (roll * ${(K.ROLL * wk).toFixed(4)} + shiv * ${(K.SHIVER * wk).toFixed(4)});
          transformed.xz += vec2(-position.z, position.x) * ${(0.02 * wk).toFixed(4)} * sin(uTime * 0.5 + position.y * 2.0);`);
      };
      m.customProgramCacheKey = () => (animated ? 'fleshbeast-writhe-skin' : 'fleshbeast-writhe');
    });
    if (animated) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      for (const n of ['idle_writhe', 'skitter', 'lunge', 'thrash']) {
        const c = THREE.AnimationClip.findByName(gltf.animations, n);
        if (c) actions[n] = mixer.clipAction(c);
      }
      if (actions.lunge) { actions.lunge.setLoop(THREE.LoopOnce, 1); actions.lunge.clampWhenFinished = true; }
    }
    root.add(gltf.scene); loaded = true;
  }
  function loadFallback(why) {
    console.warn('fleshbeast animated model unavailable (' + why + '); using static model');
    new GLTFLoader().load(K.MODEL, (gltf) => onModel(gltf, false), undefined, (e) => console.warn('fleshbeast model failed to load', e));
  }
  new GLTFLoader().load(K.MODEL_ANIM, (gltf) => {
    if (gltf.animations?.length) onModel(gltf, true); else loadFallback('no animations');
  }, undefined, (e) => loadFallback(e?.message || e));

  // ---- state ------------------------------------------------------------------------------------------
  const S = { mode: 'off', script: null, ai: 0, act: null, t: 0, u: { s: 0, lat: 0, y: 0 }, n: new V3(0, 0, 1), nT: new V3(0, 0, 1),
    h: new V3(1, 0, 0), timer: 0, burst: null, shown: false, vis: false, d: 99, dwell: 0, limit: 2, yaw: 0, phase: 0, tickT: 0, acc: 0,
    tw: new V3(), twYaw: 0, twTilt: 0, speed: 0, lungeT: 0, lunged: false, spawnT: 0, fleeT: 0, deniedT: 0, closing: false, seen: false, mirror: 1, choir: null, sgn: 1 };
  // n and h are (s, lat, up) vectors in the path frame.
  const q = new THREE.Quaternion(), qt = new THREE.Quaternion(), mat = new THREE.Matrix4(), eu = new THREE.Euler();
  const W = new V3(), nW = new V3(), fW = new V3(), xW = new V3(), tV = new V3(), rV = new V3(), uV = new V3(0, 1, 0), tmp = new V3();

  const toWorld = (u, out) => { const p = P.pointAt(u.s); return out.set(p.x + p.rx * u.lat, u.y, p.z + p.rz * u.lat); };
  function playerU() { const p = P.pointAt(player.s); return { s: player.s, lat: (player.x - p.x) * p.rx + (player.z - p.z) * p.rz, y: camera.position.y }; }
  function occluded(w) {   // the eye-to-point line passes through the hall or corridor wall
    const c = camera.position;
    for (let i = 1; i < 8; i++) {
      const x = c.x + (w.x - c.x) * i / 8, z = c.z + (w.z - c.z) * i / 8, cp = P.clampToPath(x, z);
      if (interior(cp.s) && Math.hypot(x - cp.x, z - cp.z) > 0.05) return true;
    }
    return false;
  }
  const hiddenAt = (u) => { toWorld(u, tmp); return !host.observe(tmp).obs || occluded(tmp); };

  function target(A) {
    const pu = playerU(), s = Math.min(pu.s + A.ds, A.maxS ?? 1e9), lat = A.lat * S.mirror;
    if (A.surf === 'w') { const sd = Math.sign(lat) || 1; return { s, lat: sd * wallLat(s), y: A.y ?? 1.3, n: new V3(0, -sd, 0) }; }
    if (A.surf === 'c') { const m = wallLat(s); return { s, lat: clamp(lat, -m, m), y: ceilY(s), n: new V3(0, 0, -1) }; }
    return { s, lat, y: groundY(s, lat), n: new V3(0, 0, 1) };
  }
  function envelope(u) {
    const s = u.s;
    if (interior(s)) { const m = wallLat(s); u.lat = clamp(u.lat, -m, m); u.y = clamp(u.y, 0, ceilY(s)); }
    else if (courtyard(s)) { u.lat = clamp(u.lat, -8.85, 8.85); u.y = clamp(u.y, 0, Math.abs(u.lat) > 8 ? 2.5 : 0); }
    else u.y = groundY(s, u.lat);
  }
  function keepAway(u) {   // never closer than MIN_DIST to the player (path-frame distance, ignores height)
    const pu = playerU(); let ds = u.s - pu.s, dl = u.lat - pu.lat; const d = Math.hypot(ds, dl);
    if (d >= K.MIN_DIST) return;
    if (d < 0.01) { ds = 1; dl = 0; } else { ds *= K.MIN_DIST / d; dl *= K.MIN_DIST / d; }
    u.s = pu.s + ds; u.lat = pu.lat + dl; envelope(u);
  }

  // ---- transform: written on ticks only, with stepped bob / tilt and random micro offsets ------------------
  function applyTransform(moving) {
    const p = P.pointAt(S.u.s);
    toWorld(S.u, W);
    rV.set(p.rx, 0, p.rz); tV.set(p.tx, 0, p.tz);
    nW.set(0, S.n.z, 0).addScaledVector(rV, S.n.y).normalize();     // n.y = lat component, n.z = up component
    fW.set(0, S.h.z, 0).addScaledVector(tV, S.h.x).addScaledVector(rV, S.h.y);
    fW.addScaledVector(nW, -fW.dot(nW));
    if (fW.lengthSq() < 0.01) fW.copy(tV).addScaledVector(nW, -tV.dot(nW));
    fW.normalize().applyAxisAngle(nW, S.yaw + (mixer ? 0 : S.twYaw));
    xW.crossVectors(nW, fW);
    mat.makeBasis(xW, nW, fW); q.setFromRotationMatrix(mat);
    const step = Math.sin(S.phase * Math.PI), j = mixer ? 0 : 1;   // with clips, stepped bob / tilt / twitch would duplicate the animation
    eu.set(j * (S.twTilt + (moving ? Math.cos(S.phase * Math.PI * 0.5) * K.TILT * 0.5 : 0)), 0, j * (moving ? step * K.TILT : S.twTilt * 0.5));
    q.multiply(qt.setFromEuler(eu));
    root.quaternion.copy(q);
    root.position.copy(W).addScaledVector(nW, (moving ? Math.abs(step) * K.BOB * j : 0) + S.tw.y * j).addScaledVector(xW, S.tw.x * j).addScaledVector(fW, S.tw.z * j);
    root.scale.setScalar(interior(S.u.s) ? K.SCALE_TIGHT : K.SCALE);
    if (mixer) pose(moving);
  }
  // ---- clips: idle/hold -> idle_writhe, bursts/flee -> skitter (timeScale from real speed), reacting or close -> thrash,
  // first burst of a rush -> lunge once (then back to whatever the state calls for) ---------------------------
  function play(name, ts) {
    const a = actions[name] || actions.idle_writhe;
    if (!a) return;
    if (a === cur) { if (name === 'skitter') a.timeScale = ts; return; }
    a.reset(); a.timeScale = ts; a.play();
    if (cur) cur.crossFadeTo(a, K.FADE, false);
    cur = a;
  }
  function pose(moving) {
    if (S.lungeT > 0) return play('lunge', 1);
    if (moving) return play('skitter', S.speed / (K.SKITTER_SPEED * root.scale.x));
    play(S.mode === 'denied' || S.mode === 'freeze' || S.d < K.CLOSE_THRASH ? 'thrash' : 'idle_writhe', 1);
  }
  const setShown = (on) => { S.shown = on; root.visible = on && loaded; };

  // ---- script control -----------------------------------------------------------------------------------
  function start(name, force = false) {
    if (S.mode !== 'off') {
      if (!force || (S.shown && S.vis)) return false;
      end();
    }
    const sc = SCRIPTS[name];
    if (!sc || !loaded) return false;
    Object.assign(S, { script: sc, ai: 0, t: 0, closing: false, dwell: 0, seen: false, mirror: name === 'glimpse' && Math.random() < 0.5 ? -1 : 1, acc: 0, tickT: 0 });
    S.n.set(0, 0, 1); S.nT.set(0, 0, 1); S.h.set(1, 0, 0);
    S.choir = audio.choir?.() || null;
    beginAct();
    return true;
  }
  function end() {
    setShown(false);
    if (S.choir) { S.choir.release(); S.choir = null; }
    S.mode = 'off'; S.act = null; S.script = null;
  }
  function nextStage() {   // after a bolt: jump to the next spawn, or finish
    if (!S.closing) for (let i = S.ai + 1; i < S.script.acts.length; i++) if (S.script.acts[i].a === 'spawn') { S.ai = i - 1; return nextAct(); }
    end();
  }
  const nextAct = () => { S.ai++; beginAct(); };
  function beginAct() {
    const A = S.act = S.script.acts[S.ai];
    if (!A) return end();
    S.burst = null; S.spawnT = 0; S.timer = 0; S.lunged = false;
    if (A.a === 'ghost') { setShown(false); S.mode = 'ghost'; S.timer = A.t; }
    else if (A.a === 'spawn') S.mode = 'spawn';
    else if (A.a === 'freeze') { S.mode = 'freeze'; S.timer = range(A.t); S.deniedT = 0; S.denied = false; if (S.choir) S.choir.hush(1.6); }
    else {
      S.mode = 'still'; S.timer = 0;
      if (A.a === 'rush' && S.choir) S.choir.surge();
    }
  }
  function hide() { setShown(false); S.vis = false; S.dwell = 0; nextStage(); }

  function startBurst(T, A, fast) {
    const u = S.u, dir = new V3(T.s - u.s, T.lat - u.lat, T.y - u.y), D = dir.length();
    dir.normalize();
    const z = D > 3 && !fast ? K.ZIGZAG : D > 1.5 ? K.ZIGZAG * 0.3 : 0;
    if (z) dir.applyAxisAngle(tmp.set(0, S.n.y, S.n.z), rand(-z, z));
    const v = fast ? K.BOLT_SPEED : range(A.speed || K.SPEED);
    S.speed = v;
    if (A && A.a === 'rush' && !S.lunged) { S.lunged = true; S.lungeT = 1; }
    S.burst = { dir, v, left: Math.min(range(K.BURST_T), (D + 0.4) / v) };
    S.h.copy(dir);
    S.yaw = Math.random() < K.SIDEWAYS_CHANCE ? [1.3, -1.3, Math.PI][(Math.random() * 3) | 0] : 0;
    S.mode = fast ? 'flee' : 'burst';
  }
  function moveBurst(h, T) {
    const B = S.burst, u = S.u, m = Math.min(h, B.left);
    u.s += B.dir.x * B.v * m; u.lat += B.dir.y * B.v * m; u.y += B.dir.z * B.v * m;
    envelope(u); keepAway(u);
    S.nT.copy(T.n); S.n.lerp(S.nT, 0.35).normalize();
    S.phase += h * 2.6; B.left -= h;
    S.tw.set(rand(-0.02, 0.02), rand(-0.015, 0.015), rand(-0.02, 0.02)); S.twYaw = rand(-0.12, 0.12); S.twTilt = 0;
    if (S.choir) S.choir.scuttle(1);
    return B.left <= 0;
  }
  const twitch = () => {
    if (Math.random() < K.TWITCH_CHANCE) {
      S.tw.set(rand(-0.03, 0.03), rand(-0.015, 0.015), rand(-0.03, 0.03)); S.twYaw = rand(-0.3, 0.3); S.twTilt = rand(-0.1, 0.1);
      if (S.choir && Math.random() < 0.5) S.choir.scuttle(0.35);
    } else { S.tw.multiplyScalar(0.5); S.twYaw *= 0.5; S.twTilt *= 0.5; }
  };

  // ---- gaze: too long a look and it bolts, or freezes while a lamp flickers / fog swells -------------------
  function watch(h, exempt) {
    toWorld(S.u, tmp);
    const o = host.observe(tmp); S.d = Math.hypot(tmp.x - camera.position.x, tmp.z - camera.position.z);
    S.vis = S.shown && o.obs && !occluded(tmp);
    if (S.vis && !S.seen) { S.seen = true; host.tension(K.SEEN_TENSION); }
    const gazing = S.vis && o.cos > cosGaze;
    S.dwell = gazing ? S.dwell + h : Math.max(0, S.dwell - 2 * h);
    if (S.dwell === 0 && !gazing) S.limit = range(K.GAZE_LIMIT);
    if (S.dwell > S.limit && !exempt && S.mode !== 'denied' && S.mode !== 'flee') {
      S.dwell = 0;
      if (Math.random() < K.DENY_CHANCE && host.deny(tmp, S.d)) { S.mode = 'denied'; S.deniedT = 0; S.burst = null; }
      else { S.fleeT = 0; startBurst({ s: S.u.s + (S.u.s >= player.s ? 40 : -40), lat: S.u.lat, y: S.u.y, n: S.n }, null, true); }
    }
  }

  // ---- one tick -----------------------------------------------------------------------------------------
  function tick(h) {
    S.t += h; S.lungeT = Math.max(0, S.lungeT - h);
    if (!S.closing && (player.s > S.script.s1 || S.t > S.script.maxT)) { S.closing = true; if (!S.shown) return end(); }
    const A = S.act, pu = playerU();
    let moving = false;
    if (S.mode === 'ghost') {
      const T = target(A); S.u.s = T.s + 5 * Math.sin(S.t * 0.25); S.u.lat = T.lat + 4 * Math.sin(S.t * 0.37); S.u.y = 0;
      if ((S.timer -= h) <= 0) nextAct();
    } else if (S.mode === 'spawn') {
      const T = target(A); envelope(T);
      if (hiddenAt(T)) {
        S.u.s = T.s; S.u.lat = T.lat; S.u.y = T.y; S.n.copy(T.n); S.nT.copy(T.n); S.h.set(-Math.sign(A.ds) || -1, 0, 0);
        setShown(true); S.dwell = 0; S.seen = false; nextAct();
      } else if ((S.spawnT += h) > K.SPAWN_WAIT) { S.closing = true; end(); return; }
    } else if (S.mode === 'still' || S.mode === 'hold') {
      twitch();
      if ((S.timer -= h) <= 0) {
        const T = target(A), u = S.u;
        if (S.mode === 'hold') nextAct();
        else if (Math.hypot(T.s - u.s, T.lat - u.lat, T.y - u.y) < (A.a === 'rush' ? 1.4 : 1.0)) { if (A.hold) { S.mode = 'hold'; S.timer = range(A.hold); } else nextAct(); }
        else startBurst(T, A, false);
      }
    } else if (S.mode === 'burst') {
      moving = true;
      if (moveBurst(h, target(A))) { S.mode = 'still'; S.timer = A.still ? range(A.still) : Math.random() < K.LONG_CHANCE ? range(K.STILL_LONG) : range(K.STILL); S.burst = null; }
    } else if (S.mode === 'freeze') {
      twitch();
      S.h.set(pu.s - S.u.s, pu.lat - S.u.lat, 0).normalize(); S.yaw = 0;   // turned to the player
      if ((S.timer -= h) <= 0 && !S.denied) { S.denied = true; if (!host.deny(toWorld(S.u, tmp), S.d, A.lamp)) { end(); return; } }
      if (S.denied && (host.denyDark() || (S.deniedT += h) > 3)) { end(); return; }
    } else if (S.mode === 'denied') {
      twitch(); S.deniedT += h;
      if (host.denyDark()) return hide();
      if (S.deniedT > 3) { S.fleeT = 0; startBurst({ s: S.u.s + (S.u.s >= player.s ? 40 : -40), lat: S.u.lat, y: S.u.y, n: S.n }, null, true); }
    } else if (S.mode === 'flee') {
      moving = true; S.fleeT += h;
      const T = { s: S.u.s + (S.u.s >= pu.s ? 40 : -40), lat: S.u.lat, y: S.u.y, n: S.n };
      if (moveBurst(h, T)) startBurst(T, null, true);
      if (!S.vis || S.fleeT > K.FLEE_MAX) { if (S.vis) { if (host.deny(tmp, S.d)) { S.mode = 'denied'; S.deniedT = 0; } } else return hide(); }
    }
    if (S.shown) {
      const C = S.act;   // the act as it is now (it may have just advanced)
      keepAway(S.u); watch(h, C && (C.exempt || C.a === 'rush' || C.a === 'freeze')); applyTransform(moving);
    }
    if (S.choir) {
      toWorld(S.u, tmp);
      S.choir.place(tmp.x, tmp.y + 0.6, tmp.z, clamp(1 - (Math.hypot(tmp.x - camera.position.x, tmp.z - camera.position.z) - 3) / K.CHOIR_RANGE, 0, 1));
    }
  }

  function update(dt) {
    uniforms.uTime.value += dt;
    if (mixer && root.visible) mixer.update(dt);
    if (S.mode === 'off') return;
    S.acc += dt;
    if (S.acc >= S.tickT) { const h = S.acc; S.acc = 0; S.tickT = 1 / range(K.TICK_HZ); tick(h); }
  }
  const status = () => (S.mode === 'off' ? 'off' : `${S.mode} ${S.act ? S.act.a : '-'} act ${S.ai} d ${S.d.toFixed(0)}m ds ${(S.u.s - player.s).toFixed(0)} lat ${S.u.lat.toFixed(1)} ${S.vis ? 'VISIBLE' : 'unseen'} dwell ${S.dwell.toFixed(1)}`);

  return { update, start, status, root, get busy() { return S.mode !== 'off'; }, get visible() { return S.shown && S.vis; }, get point() { return root.position; } };
}
