// Authored GLB models (astronaut, dirt bike, Albatross, Prospector) wrapped behind the same API as the procedural models in models.js.
// Metres, +Y up, -Z forward. Falls back to the procedural builders (in main.js) if a file fails to load.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { setupMat } from './gfx.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const GLB = { astronaut: null, dirtbike: null, albatross: null, prospector: null };
/** Verdant flora / fauna kit (assets/models/verdant/*.glb): loaded into GLB['verdant/<name>'] */
export const KIT_FILES = ['flora_trees', 'flora_fungi', 'flora_ground', 'rocks', 'skitter', 'grazer', 'titan', 'flyer'];
for (const k of KIT_FILES) GLB['verdant/' + k] = null;

/** Preload all three files in parallel. onProgress(0..1, label). A failed file leaves its slot null (procedural fallback). */
export async function loadAssets(onProgress = () => {}) {
  const loader = new GLTFLoader();
  const names = Object.keys(GLB), frac = {};
  const report = () => onProgress(names.reduce((s, n) => s + (frac[n] || 0), 0) / names.length);
  await Promise.all(names.map((n) => loader.loadAsync(`assets/models/${n}.glb`, (e) => { if (e.lengthComputable) { frac[n] = e.loaded / e.total * 0.95; report(); } })
    .then((g) => { GLB[n] = g; frac[n] = 1; report(); })
    .catch((err) => { console.warn(`GLB ${n} failed to load, using the procedural model:`, err && err.message); frac[n] = 1; report(); })));
  return GLB;
}

/** shadows + CSM/curvature hook on every material, per-material tone tuning so white hulls do not clip under sun + bloom */
function prep(root, tint, minShadowR = 0) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = !(o.material && o.material.transparent); o.receiveShadow = true;
    if (minShadowR > 0) {          // fewer shadow draw calls (x4 cascades): skip lamps and tiny parts
      o.geometry.computeBoundingSphere();
      const mn = Array.isArray(o.material) ? o.material[0].name : o.material.name;
      if (o.geometry.boundingSphere.radius < minShadowR || /^(lamp|glass|nozzle_inner|gold)/.test(mn)) o.castShadow = false;
    }
    if (o.isSkinnedMesh) o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.userData.__prepped) continue; m.userData.__prepped = true;
      setupMat(m, 'glb:' + m.name);
      m.envMapIntensity = 0.55;
      if (m.map) m.map.anisotropy = 4;
      if (tint) tint(m);
    }
  });
}
const whiteTint = (m) => {
  const emissive = m.emissiveIntensity > 1 || (m.emissive && m.emissive.getHex() !== 0);
  if (emissive) return;
  const c = m.color; const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  if (lum > 0.5) c.multiplyScalar(0.66);
};

// ------------------------------------------------------------------ DIRT BIKE
export function buildBikeGLB(gltf) {
  const group = gltf.scene; prep(group, whiteTint);
  const get = (n) => group.getObjectByName(n);
  const seat = get('bike_seat');
  const upper = get('bike_shock_upper'), lower = get('bike_shock_lower'), uMount = get('bike_shock_upper_mount'), lMount = get('bike_shock_lower_mount');
  const _a = new V3(), _b = new V3();
  const update = () => {                      // shocks track their mounts as the swingarm moves
    if (!upper || !lower || !uMount || !lMount) return;
    group.updateMatrixWorld(true);
    upper.lookAt(lMount.getWorldPosition(_a)); lower.lookAt(uMount.getWorldPosition(_b));
  };
  return { glb: true, group, front: get('bike_front_susp'), rear: get('bike_rear_wheel'), fork: get('bike_fork'), swing: get('bike_swingarm'), fw: get('bike_front_wheel'), rw: get('bike_rear_wheel'),
    wheelR: 0.4, mountPoint: seat.position.clone(), seat: seat.position.clone(), headlight: get('bike_headlight'), update };
}

// ------------------------------------------------------------------ ASTRONAUT
const NAT = { walk_sexy: 1.3, walk: 1.6, run: 4.0 };      // natural ground speed of each clip (m/s)
export function buildAstronautGLB(gltf) {
  const group = new THREE.Group(); const model = gltf.scene; group.add(model);
  prep(model);
  const bone = (n) => model.getObjectByName(n);
  const jetMats = new Set();
  model.traverse((o) => { if (o.isMesh) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.name === 'Jet') jetMats.add(m); });
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const c of gltf.animations) act[c.name] = mixer.clipAction(c);
  const once = (n) => { const a = act[n]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } };
  ['jump', 'jump_start', 'jump_land'].forEach(once);
  const S = { cur: null, name: '', air: 0, landT: 0, wasAir: false, riding: false };
  const play = (name, fade = 0.25, ts = 1, syncFrom = true) => {
    const a = act[name] || act.idle; if (!a) return;
    if (S.cur === a) { a.setEffectiveTimeScale(ts); return; }
    const prev = S.cur;
    a.reset(); a.setEffectiveWeight(1); a.setEffectiveTimeScale(ts);
    if (syncFrom && prev && !prev.isOnce && a.loop === THREE.LoopRepeat) a.time = (prev.time % prev._clip.duration) / prev._clip.duration * a._clip.duration;
    if (prev) prev.crossFadeTo(a, fade, false);
    a.play(); S.cur = a; S.name = name;
  };
  for (const n of ['jump', 'jump_start', 'jump_land']) if (act[n]) act[n].isOnce = true;
  const spine = [bone('Spine'), bone('Spine1'), bone('Spine2')], _q = new Q(), _e = new THREE.Euler();
  const ride = { steer: 0, lean: 0 };
  /** one call per frame. st: {riding, onGround, speed, run} */
  const drive = (st, dt) => {
    let want, ts = 1;
    if (st.riding) { want = 'ride'; S.wasAir = false; S.landT = 0; }
    else if (!st.onGround) {
      S.air += dt;
      if (!S.wasAir) { S.air = 0; play(act.jump_start ? 'jump_start' : 'jump', 0.12); }
      else if (S.air >= (act.jump_start ? act.jump_start._clip.duration - 0.05 : 99) && S.name !== 'jump_float' && act.jump_float) play('jump_float', 0.2);
      S.wasAir = true; want = null;
    } else {
      if (S.wasAir) { S.wasAir = false; if (act.jump_land) { play('jump_land', 0.08); S.landT = act.jump_land._clip.duration; } }
      if (S.landT > 0) { S.landT -= dt; want = (S.landT < 0.25 && st.speed > 0.6) ? 'move' : null; if (S.landT <= 0) want = 'move'; }
      else want = 'move';
    }
    if (want === 'move') {
      if (st.speed > 0.35) { if (st.run && st.speed > 3.3) { want = 'run'; ts = clamp(st.speed / NAT.run, 0.7, 1.5); } else { want = act.walk_sexy ? 'walk_sexy' : 'walk'; ts = clamp(st.speed / NAT[want], 0.5, 1.9); } }
      else want = 'idle';
    }
    if (want) play(want, want === 'ride' ? 0.3 : 0.22, ts);
    mixer.update(dt);
    if (st.riding) {                            // procedural spine roll + twist for lean / steer
      const k = [0.35, 0.4, 0.25];
      spine.forEach((b, i) => { if (!b) return; _e.set(0, ride.steer * 0.22 * k[i] * 2, ride.lean * 0.25 * k[i] * 2); b.quaternion.multiply(_q.setFromEuler(_e)); });
    }
  };
  const setJet = (on) => { for (const m of jetMats) { m.emissive.setRGB(1, 0.55, 0.2); m.emissiveIntensity = on ? 6 : 0.0; } };
  setJet(false);
  const parts = { jet: [], setJet, jetMats };
  // ride placement contract: parent under the bike root with an IDENTITY transform; the ride clip carries the hips (seat + 0.10 m)
  const ridePos = new V3(0, 0, 0);
  const poseCompat = { idle() {}, walk() {}, run() {}, air() {}, ride(steer = 0, lean = 0, dt = 1 / 60) { ride.steer += (steer - ride.steer) * Math.min(1, dt * 6); ride.lean += (lean - ride.lean) * Math.min(1, dt * 6); drive({ riding: true }, dt); } };
  play('idle', 0);
  return { glb: true, group, parts, pose: poseCompat, drive, setJet, ridePos };
}

// ------------------------------------------------------------------ ALBATROSS
const CLIP_OF = { wheels: 'gear_extend', legs: 'tail_legs_extend', panels: 'panels_deploy', radiators: 'radiators_deploy', ramp: 'ramp_open' };
const COMY = 2.6, PAD_Z = 9.9;
export function buildPlaneGLB(gltf) {
  const model = gltf.scene; prep(model, whiteTint, 0.9);
  const root = model.getObjectByName('Albatross') || model;
  const get = (n) => model.getObjectByName(n);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const c of gltf.animations) { const a = mixer.clipAction(c); a.play(); a.paused = true; a.time = 0; a.setEffectiveWeight(1); actions[c.name] = a; }
  mixer.update(0);
  const last = {};
  // drive deploy states 0..1 through the baked clips (clip time = fraction x clip length)
  const setDeploy = (name, t) => {
    const a = actions[CLIP_OF[name]]; if (!a) return;
    t = clamp(t, 0, 1); if (last[name] !== undefined && Math.abs(last[name] - t) < 1e-3) return; last[name] = t;
    a.time = t * a.getClip().duration; mixer.update(0);
  };
  // surfaces: elevons (pitch + roll), rudders (yaw), smoothed, +-25 deg. + = trailing edge down (elevon) / to the right (rudder)
  const surf = { eiL: get('elevon_in_L'), eoL: get('elevon_out_L'), eiR: get('elevon_in_R'), eoR: get('elevon_out_R'), rL: get('rudder_L'), rR: get('rudder_R') };
  const defl = { l: 0, r: 0, y: 0 };
  const setControls = (pitch, roll, yaw, dt = 1 / 60) => {
    const k = Math.min(1, dt * 8), M = 25 * D2R;
    defl.l += (clamp((-pitch + roll) * M, -M, M) - defl.l) * k; defl.r += (clamp((-pitch - roll) * M, -M, M) - defl.r) * k; defl.y += (clamp(yaw * M, -M, M) - defl.y) * k;
    if (surf.eiL) { surf.eiL.rotation.x = defl.l; surf.eoL.rotation.x = defl.l; surf.eiR.rotation.x = defl.r; surf.eoR.rotation.x = defl.r; surf.rL.rotation.x = defl.y; surf.rR.rotation.x = defl.y; }
  };
  // stance rig: vertical (nose up, engines down) pose, tipped to horizontal about the tail-gear line
  const flight = new THREE.Group(), tipG = new THREE.Group();
  flight.add(tipG); tipG.add(model);
  model.quaternion.setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2); model.position.set(0, PAD_Z, -COMY);
  const setTip = (tip) => { tipG.rotation.set(-tip * Math.PI / 2, 0, 0); tipG.position.set(0, COMY * tip, 0); };
  setTip(0);
  // contact pads (vertical stance), flight-frame ground points: model (x, y, 9.9) -> (x, 0, y - COMY). Order: FL, FR, BL, BR for settleOnGround.
  const feet = [new V3(-3.4, 0, -0.3 - COMY), new V3(3.4, 0, -0.3 - COMY), new V3(-3.2, 0, 6.2 - COMY), new V3(3.2, 0, 6.2 - COMY)];
  const anchors = { plume_main_L: get('plume_main_L'), plume_main_R: get('plume_main_R'), plume_ntr: get('plume_ntr'), plume_oms_L: get('plume_oms_L'), plume_oms_R: get('plume_oms_R'),
    cargo_bike: get('cargo_bike'), ramp_foot: get('ramp_foot'), crew_exit: get('crew_exit'), dock_port: get('dock_port') };
  setDeploy('panels', 0); setDeploy('radiators', 0); setDeploy('ramp', 0); setDeploy('legs', 1); setDeploy('wheels', 0);
  return { glb: true, group: flight, rig: model, tipG, feet, parts: {}, setDeploy, setTip, setControls, anchors, height: 17.8, footRadius: 4.9, dock: new V3(0, 16, 0) };
}

// ------------------------------------------------------------------ PROSPECTOR (survey rover / lander, replaces the Heron)
// Everything is keyed by node / clip names (assets/models/prospector.glb, art/rover/prospector_nodes.json): the model may be re-exported with
// better parts as long as the names stay. Model frame: -Z forward, +Y up, origin on the ground under the rover in the rove stance (legs out).
const P_CLIP = { legs: 'legs_extend', panels: 'panels_deploy', radiators: 'radiators_deploy', drill: 'drill_deploy', sensor: 'sensor_raise' };
// Contact geometry: defaults match prospector_nodes.json; buildProspectorGLB overwrites them in place from the file's own anchors (wheel_N, tail_pad_N, com_ref, dock_port),
// so a re-export with moved wheels or pads is picked up without code changes.
export let P_PAD_LIFT = 4.8;                   // vertical stance: rotate +90 deg about X and lift this far so the tail pads touch the ground
export const P_WHEELS = [[-2.08, -3.1], [2.08, -3.1], [-2.08, -0.05], [2.08, -0.05], [-2.08, 3.0], [2.08, 3.0]];      // rove frame (x, z) of wheel_0..5: FL FR ML MR RL RR
export let P_WHEEL_R = 0.65;
export const P_COM_V = new V3(0, 4.5, 1.6);      // centre of mass in the vertical-stance flight frame (com_ref)
export const P_DOCK = new V3(0, 3.12, -1.55);      // dock_port in the rove-pose model frame
const P_PADS = [[0, 2.5, 4.8], [-0.9093, 0.925, 4.8], [0.9093, 0.925, 4.8]];       // tail_pad_0..2 in model coordinates
export function buildProspectorGLB(gltf) {
  const model = gltf.scene; prep(model, whiteTint, 0.6);
  const get = (n) => model.getObjectByName(n);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const c of gltf.animations) { const a = mixer.clipAction(c); a.play(); a.paused = true; a.time = 0; a.setEffectiveWeight(1); actions[c.name] = a; }
  mixer.update(0);
  const last = {};
  const setDeploy = (name, t) => {
    const a = actions[P_CLIP[name]]; if (!a) return;
    t = clamp(t, 0, 1); if (last[name] !== undefined && Math.abs(last[name] - t) < 1e-3) return; last[name] = t;
    a.time = t * a.getClip().duration; mixer.update(0);
  };
  // ---- read the contact geometry from the file's anchors (rove pose, legs extended)
  {
    const lg = actions[P_CLIP.legs]; const saved = lg ? lg.time : 0; if (lg) { lg.time = lg.getClip().duration; mixer.update(0); }
    model.updateMatrixWorld(true);
    const inv = model.matrixWorld.clone().invert(), p = new V3();
    for (let i = 0; i < 6; i++) { const w = get('wheel_' + i); if (w) { w.getWorldPosition(p).applyMatrix4(inv); P_WHEELS[i][0] = p.x; P_WHEELS[i][1] = p.z; } }
    const tyre = get('wheel_0_tyre'); if (tyre && tyre.geometry) { tyre.geometry.computeBoundingBox(); const bb = tyre.geometry.boundingBox; P_WHEEL_R = Math.max(bb.max.y - bb.min.y, bb.max.z - bb.min.z) / 2 || P_WHEEL_R; }
    const pads = [0, 1, 2].map((i) => get('tail_pad_' + i)); if (pads.every(Boolean)) { P_PADS.forEach((q, i) => { pads[i].getWorldPosition(p).applyMatrix4(inv); q[0] = p.x; q[1] = p.y; q[2] = p.z; }); P_PAD_LIFT = Math.max(...P_PADS.map((q) => q[2])); }
    const com = get('com_ref'); if (com) { com.getWorldPosition(p).applyMatrix4(inv); P_COM_V.set(p.x, P_PAD_LIFT - p.z, p.y); }
    const dk = get('dock_port'); if (dk) { dk.getWorldPosition(p).applyMatrix4(inv); P_DOCK.copy(p); }
    if (lg) { lg.time = saved; mixer.update(0); }
  }
  const flight = new THREE.Group(), tipG = new THREE.Group();
  flight.add(tipG); tipG.add(model);
  model.quaternion.setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2); model.position.set(0, P_PAD_LIFT, 0);     // vertical stance: nose up, tail pads on the ground
  // tipping: rotate about X; the lowest of the tail pads / wheel bottoms stays on the ground. tip 0 = vertical, 1 = horizontal on the wheels
  const wheelNodes = [0, 1, 2, 3, 4, 5].map((i) => get('wheel_' + i)), wheelBase = wheelNodes.map((w) => (w ? w.rotation.x : 0)), wheelSpin = [0, 0, 0, 0, 0, 0];
  const setTip = (tip) => {
    const phi = -clamp(tip, 0, 1) * Math.PI / 2, c = Math.cos(phi), sn = Math.sin(phi);
    tipG.rotation.set(phi, 0, 0);
    let low = 1e9;
    for (const [, my] of P_PADS) low = Math.min(low, -my * sn);                                       // pad: y'' = (4.8 - 4.8) cos - my sin
    if (tip > 0.001) for (const [, wz] of P_WHEELS) low = Math.min(low, (P_PAD_LIFT - wz) * c - P_WHEEL_R * sn - P_WHEEL_R);
    tipG.position.set(0, -Math.max(0, low), P_PAD_LIFT * tip);       // at tip 1 the rover origin (centre, on the ground) sits at the flight-frame origin
  };
  setTip(0);
  /** spin the six wheel nodes (rad per wheel, set absolute) */
  const setWheels = (ang, steerSkid = 0) => { for (let i = 0; i < 6; i++) { const w = wheelNodes[i]; if (w) w.rotation.x = wheelBase[i] + ang * (i % 2 ? 1 : 1); } };
  // vertical-stance contact pads in the flight frame: (mx, 0, my). Order FL, FR, BL, BR for settleOnGround
  const feet = [new V3(-0.9093, 0, 0.925), new V3(0.9093, 0, 0.925), new V3(-0.06, 0, 2.5), new V3(0.06, 0, 2.5)];
  const anchors = { plume_main_L: get('plume_main_L'), plume_main_R: get('plume_main_R'), crew_exit: get('crew_exit'), dock_port: get('dock_port'), drill_tip: get('drill_tip'), sensor_eye: get('sensor_eye'), com_ref: get('com_ref') };
  for (const n of ['panels', 'radiators', 'drill', 'sensor']) setDeploy(n, 0);
  setDeploy('legs', 0);
  return { glb: true, rover: true, group: flight, rig: model, tipG, feet, parts: {}, setDeploy, setTip, setWheels, anchors, height: 9.6, footRadius: 3.2, com: P_COM_V };
}
