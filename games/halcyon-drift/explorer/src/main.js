// Halcyon Drift - Solar System Explorer, milestone 1. Game controller: scenes, modes, transitions, HUD wiring.
import * as THREE from 'three';
import { initGfx, gfx, setSun, setFill, curv, setupMat } from './gfx.js';
import { createSky } from './sky.js';
import { Terrain, terrainUniforms } from './terrain/terrain.js';
import * as kestrel from './terrain/kestrel.js';
import * as verdant from './terrain/verdant.js';
import * as pyra from './terrain/pyra.js';          // PYRA
import { Volcanics, suitStep, suitCelsius } from './volcanic.js';          // PYRA
import * as nyth from './terrain/nyth.js';                      // NYTH
import { setNythLook, nythLight } from './nythfx.js';             // NYTH
// --- glaciera (frozen ocean moon)
import * as glaciera from './terrain/glaciera.js';
import { IceWorld } from './iceworld.js';
// --- /glaciera
import { Water, Waterfall } from './water.js';
import { Vegetation } from './vegetation.js';
import { Ecology, SURVEY_TOTAL } from './ecology.js';
import { COM_FLAT, initAero, quatFromFwdUp } from './aeroflight.js';
import { setAtmosphere, clearAtmosphere, atmU, sunDirect, inscatter } from './atmo.js';
import { Scatter } from './scatter.js';
import * as MD from './models.js';
import { loadAssets, GLB, buildBikeGLB, buildAstronautGLB, buildPlaneGLB, buildProspectorGLB, P_COM_V, P_DOCK } from './glbmodels.js';
import { roverInit, roverStep, roverRight, roverCenter, REACH, surveyUpdate, richnessAt, drillYield, tipSpotTilt, standSpotTilt } from './rover.js';      // PROSPECTOR
import { BODIES, SUN, G0, parkRadius, POI_TYPES } from './destinations.js';
import { sunDirF, giantDirF, moonDirF, ringNormalF, siteLonLat, fToWorld, enu, lonLatOfDir } from './frames.js';
import { input, initInput } from './input.js';
import { hud, $el } from './hud.js';
import { World, WARP } from './world.js';
import * as S from './system.js';
import * as F from './flight.js';
import { Player } from './player.js';
import { Bike } from './bike.js';
import { Particles, createPlume, createPlasma, createBeacon } from './fx.js';
import { Discovery, inventory, sampleAt, refineInto } from './discovery.js';
import { SystemMap, fmtUT } from './systemmap.js';
import { bakeOrbitMap, BodyView } from './bodyview.js';
import { carrierDv, LANDER, PLANE, CARRIER } from './craft.js';
import { atmosphereOf, density } from './aero.js';
// AETHEL (hollow world): recipes, interior renderer + gate hatch, skiff
import * as aethel from './terrain/aethel.js';
import * as aethelin from './terrain/aethelin.js';
import * as AE from './aethelinterior.js';
import { Skiff } from './skiff.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const D2R = Math.PI / 180;
let K = BODIES.kestrel;
const RECIPES = { kestrel, verdant, pyra, nyth, glaciera };      // PYRA, NYTH, GLACIERA
RECIPES.aethel = aethel; RECIPES.aethelin = aethelin;      // AETHEL: outer shell + interior wall
const QS = new Q().setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2);   // plane model -> flight frame (nose = thrust axis)
const QS_INV = QS.clone().invert();
const PLANE_COM = new V3(0, 2.6, -9.9);
let LANDER_COM = new V3(0, 2.9, 0);          // PROSPECTOR: replaced by the rover's vertical-stance centre of mass when the GLB loaded

// ------------------------------------------------------------------ setup
const canvas = document.getElementById('view');
initGfx(canvas);
hud.init();
const q = new URLSearchParams(location.search);
const sceneO = new THREE.Scene(), sceneS = new THREE.Scene();
sceneS.fog = new THREE.FogExp2(0x2a2420, 1 / 80000);
const sky = createSky();
const world = new World();
const bodyView = new BodyView(); sceneO.add(bodyView.group);
const particles = new Particles(); sceneS.add(particles.points);
world.groundHeight = (x, z, id) => (RECIPES[id] || kestrel).heightAt(x, z);
// ---- surface worlds: each world = recipe module + destinations.js data; terrain / scatter / discovery (+ water, flora, fauna) are built lazily per world
const SW = {};
let terrain, scatter, disc, water = null, falls = null, veg = null, eco = null, volc = null;      // volc: PYRA
const onDiscover = (e) => { say(`${e.type === 'bio' ? 'Species logged' : 'Discovery'}: ${e.name}`, 'ok', true); say(e.text.length > 90 ? e.text.slice(0, 88) + '...' : e.text, 'info'); };
function makeWorld(id) {
  const rc = RECIPES[id], T = new Terrain(id, rc), SC = new Scatter(T, rc, rc.WORLD ? { rock: rc.WORLD.palette.rock, moss: rc.WORLD.palette.moss, noKit: rc.WORLD.noKitRocks } : null), D = new Discovery(rc, T);
  D.onDiscover = onDiscover;
  if (rc.WORLD) { T.shadowLevel = 2; T.split = 1.9; }
  if (rc.RI) T.maxD = rc.RI * 0.95;      // AETHEL interior: near terrain ends inside the cavity radius (the far shell takes over)
  const w = { id, rc, terrain: T, scatter: SC, disc: D, extras: [T.group, SC.group, D.group], water: null, falls: null, veg: null, eco: null, volc: null };
  if (rc.VENTS) { w.volc = new Volcanics(T, rc); w.extras.push(w.volc.group); }          // PYRA: ash columns
  if (rc.ICE) { w.ice = new IceWorld(T, rc, SC, D); w.extras.push(w.ice.group); }      // glaciera: ice material, crystals, geysers, pads
  if (rc.waterSurface) {
    w.water = new Water(T, rc, rc.WORLD); w.extras.push(w.water.group);
    if (rc.fallAnchors) { w.falls = rc.fallAnchors().map((f) => new Waterfall(T, f)); for (const f of w.falls) w.extras.push(f.group); }
  }
  if (rc.plantsInCell) {
    w.veg = new Vegetation(T, rc); w.extras.push(w.veg.group); SC.extraColliders = w.veg.colliders;
    if (!(rc.WORLD && rc.WORLD.noFauna)) { w.eco = new Ecology(T, rc, w.veg); w.extras.push(w.eco.group);
    w.eco.onSpecies = (e) => { D.journal.push({ key: e.key, type: 'bio', name: e.name, text: e.text + ' Documented by you: first of its kind in the survey.', n: D.journal.length + 1 }); onDiscover({ type: 'bio', name: e.name, text: e.text }); };
    }
  }
  return w;
}
SW.kestrel = makeWorld('kestrel');
({ terrain, scatter, disc } = SW.kestrel); for (const g of SW.kestrel.extras) sceneS.add(g);

// models
{ const t = document.getElementById('titleSub'); if (t) t.textContent = 'Loading models... 0%';
  await loadAssets((p) => { if (t) t.textContent = `Loading models... ${Math.round(p * 100)}%`; }); }
const M = { carrier: MD.buildCarrier(), lander: GLB.prospector ? buildProspectorGLB(GLB.prospector) : MD.buildLander(),      // PROSPECTOR: procedural Heron model is the fallback
  plane: GLB.albatross ? buildPlaneGLB(GLB.albatross) : MD.buildPlane(),
  astro: GLB.astronaut ? buildAstronautGLB(GLB.astronaut) : MD.buildAstronaut(),
  bike: GLB.dirtbike ? buildBikeGLB(GLB.dirtbike) : MD.buildBike() };
world.carrier.model = M.carrier; world.lander.model = M.lander; world.plane.model = M.plane;
{
  const m = MD.mats();
  if (!M.astro.glb) { M.astro.parts.jetOff = M.astro.parts.jet[0].material; M.astro.parts.jetOn = m.lampWhite; }
  for (const k of Object.keys(m)) m[k].envMapIntensity = 0.7;
  // plumes
  const mk = (r, kind, parent, pos, rot) => { const p = createPlume(r, kind); p.position.copy(pos); p.rotation.set(rot[0], rot[1], rot[2]); parent.add(p); return p; };
  if (M.lander.rover) {         // PROSPECTOR: plumes ride on the main nozzle empties (exhaust along +Z), one control object for both
    LANDER_COM = P_COM_V.clone();
    const pl = ['plume_main_L', 'plume_main_R'].map((n) => mk(0.5, 'chem', M.lander.anchors[n], new V3(), [-Math.PI / 2, 0, 0]));
    M.lander.plume = { userData: { set: (thr, len, t) => pl.forEach((p) => p.userData.set(thr, len, t)) } };
  } else M.lander.plume = mk(0.9, 'chem', M.lander.group, M.lander.engine.clone().add(new V3(0, -0.1, 0)), [0, 0, 0]);
  if (M.plane.glb) {          // plumes ride on the authored nozzle empties (exhaust along +Z)
    M.plane.plumes = ['plume_main_L', 'plume_main_R'].map((n) => mk(0.62, 'rocket', M.plane.anchors[n], new V3(), [-Math.PI / 2, 0, 0]));
    M.plane.plumeN = mk(0.45, 'nuclear', M.plane.anchors.plume_ntr, new V3(), [-Math.PI / 2, 0, 0]);
  } else {
    M.plane.plumes = [-1.35, 1.35].map((x) => mk(0.85, 'rocket', M.plane.rig, new V3(x, 2.65, 8.1), [-Math.PI / 2, 0, 0]));
    M.plane.plumeN = mk(0.55, 'nuclear', M.plane.rig, new V3(0, 4.65, 6.7), [-Math.PI / 2, 0, 0]);
  }
  M.carrier.plume = mk(3.0, 'ntr', M.carrier.group, new V3(0, 0, 19.5), [-Math.PI / 2, 0, 0]);
  // reentry plasma shells (intensity from v.glow, set by aero.thermalStep)
  const pm = (v, size, pos) => { v.plasma = createPlasma(size); v.plasma.position.copy(pos); v.model.group.add(v.plasma); };
  pm(world.lander, 5.5, LANDER_COM); pm(world.plane, 10.5, PLANE_COM); pm(world.carrier, 26, new V3(0, 0, 0));
}
const player = new Player(M.astro); const bike = new Bike(M.bike);
const skiff = new Skiff();      // AETHEL
M.astro.group.visible = false; M.bike.group.visible = false;
const mapUI = new SystemMap(world, {
  toast: (t, k) => hud.toast(t, k), dock: dockCraft,
  surfacePosition(v) {
    const s = v.surf, origin = SW[v.body].terrain.origin;
    return F.surfaceToOrbit(s.p.x + (s.abs ? 0 : origin.x), s.p.y, s.p.z + (s.abs ? 0 : origin.z), s.vel, s.q, BODIES[v.body].R).r;
  },
});

// state
const G = {
  started: false, mode: 'orbit', sv: null, t0: performance.now(), uiOpen: false,
  cam: { yaw: 0.6, pitch: 0.28, dist: 60, off: 0 }, camPos: new V3(), fadeT: 0, fadeState: null, bikeOut: false, riding: false,
  harvest: null, refine: null, drill: null, surfOrigin: false, descentOrigin: false, time: 0, discCount: 0, airToast: 0, bikeParked: false,
  bakes: {}, startPhase: 0, bodyForView: null, helpShown: false, lastSkyBody: null, speedTrail: 0, worldId: 'kestrel',
};
window.__game = G; G.bodyView = bodyView; G.world = world; G.M = M; G.terrain = terrain; G.scatter = scatter; G.player = player; G.bike = bike; G.disc = disc; G.inventory = inventory; G.map = mapUI; G.THREE = THREE; G.hud = hud; G.gfx = gfx;

function setWorldOrigin(x, z) { terrain.setOrigin(x, z); scatter.reset(); disc.reset(); if (water) water.reset(); if (veg) veg.reset(); if (eco) eco.reset(); G.descentOrigin = true; }
function applyWorldLook(w) {
  const tu = terrainUniforms, W = w.rc.WORLD;
  if (W) {
    tu.uLush.value = W.lush === 0 ? 0 : (W.lushMode || 1); gfx.renderer.toneMappingExposure = 1.05 * (W.exposure || 1); const c = (a) => [a[0], a[1], a[2]];
    tu.uGrassA.value.setRGB(...c(W.palette.grassA)); tu.uGrassB.value.setRGB(...c(W.palette.grassB)); tu.uDry.value.setRGB(...c(W.palette.dry));
    tu.uMud.value.setRGB(...c(W.palette.mud)); tu.uSand.value.setRGB(...c(W.palette.sand)); tu.uMoss.value.setRGB(...c(W.palette.moss));
    tu.uRock.value.setRGB(...c(W.palette.rock)); tu.uRockLight.value.setRGB(...c(W.palette.rockLight));
    sceneS.fog.density = 0;
  } else {
    tu.uLush.value = 0; gfx.renderer.toneMappingExposure = 1.05 * (w.rc.LOOK ? w.rc.LOOK.exposure : 1);
    tu.uRock.value.setRGB(0.30, 0.255, 0.22, THREE.SRGBColorSpace); tu.uRockLight.value.setRGB(0.52, 0.45, 0.39, THREE.SRGBColorSpace);
  }
  setNythLook(W);      // NYTH: bioluminescent terrain grade on / off
  particles.iceTint = !!w.rc.ICE; particles.mat.uniforms.uNear.value = w.rc.ICE ? 8 : 0;                 // dust kicked up on Glaciera is snow
  const sc = w.rc.WORLD && K.atmosphere && K.atmosphere.scatter;
  if (sc) setAtmosphere(sc, W.fog); else clearAtmosphere();
  AE.applyLook(w.rc.LOOK || null);      // AETHEL: verdigris shell palette for the barren terrain shader
}
function activateWorld(id) {
  if (G.worldId === id) return;
  const prev = SW[G.worldId]; if (prev) for (const g of prev.extras) sceneS.remove(g);
  const w = SW[id] || (SW[id] = makeWorld(id));
  for (const g of w.extras) sceneS.add(g);
  ({ terrain, scatter, disc, water, falls, veg, eco } = w); volc = w.volc || null; G.suit = { t: 0, safe: null };      // PYRA: volcanic fx + suit heat state
  K = BODIES[id] || AE.BODY; G.interior = !!K.interior; G.worldId = id; G.descentOrigin = false;      // AETHEL: the interior is a pseudo-body
  G.solarT0 = K.sky && K.sky.goldenStart ? world.t : 0;      // local solar time starts at golden hour on arrival
  G.bodyView = bodyView; G.terrain = terrain; G.scatter = scatter; G.disc = disc; G.veg = veg; G.eco = eco; G.water = water; G.falls = falls;
  applyWorldLook(w);
  buildEnv();
}
// ------------------------------------------------------------------ environment map (reflections for metals / visor)
function buildEnv() {
  if (K.interior) { sceneS.environment = interior().envMap(); terrain.mat.envMapIntensity = 0.3; scatter.mat.envMapIntensity = 0.3; return; }      // AETHEL interior probe
  const envScene = new THREE.Scene();
  const es = createSky(); es.u.uEnv.value = 1; es.u.uStar.value = 0.6; envScene.add(es.mesh);
  const w = (v) => fToWorld(v, siteLonLat(K).lon, siteLonLat(K).lat);
  es.u.uSun.value.copy(w(sunDirF(K, 0))); es.u.uG.value.copy(w(giantDirF(K))); es.u.uGR.value = K.sky.giantRadius; es.u.uRingN.value.copy(w(ringNormalF(K)));
  es.setGiant(K.sky.giantPal || BODIES[K.sky.giant].palette, !!BODIES[K.sky.giant].rings);
  if (K.atmosphere && K.atmosphere.scatter) { atmU.uAOn.value = 1; atmU.uASun.value.copy(es.u.uSun.value); }
  const pm = new THREE.PMREMGenerator(gfx.renderer);
  const tex = pm.fromScene(envScene, 0.02).texture; pm.dispose();
  sceneS.environment = tex;
  terrain.mat.envMapIntensity = K.id === 'kestrel' ? 0.12 : (RECIPES[K.id].ENV ?? 0.25); scatter.mat.envMapIntensity = 0.3;
}

// ------------------------------------------------------------------ initial orbit (calibrated so a descent lands near the home site)
function initialOrbit() {
  const { lon, lat } = siteLonLat(K);
  const sim = (phase) => {
    const w = new World(); w.groundHeight = world.groundHeight;
    w.placeCircular('kestrel', phase, null, lat, lon);
    w.undock(w.plane); w.startAp(w.plane, 'descent');
    let n = 0;
    while (n++ < 12000) { w.step(0.05, { throttle: 0, pitch: 0, yaw: 0, roll: 0 }); if (w.groundAlt(w.plane) < F.TRANSITION_DOWN) break; }
    const p = w.plane.r.clone().normalize(); return lonLatOfDir(p);
  };
  let phase = lon - 0.07;
  for (let i = 0; i < 3; i++) { const r = sim(phase); let d = lon - r.lon; d = Math.atan2(Math.sin(d), Math.cos(d)); phase += d; if (Math.abs(d) * K.R < 800) break; }
  G.startPhase = phase;
  world.placeCircular('kestrel', phase, null, lat, lon);
}

// ------------------------------------------------------------------ helpers: sky & light for the active scene
const _c1 = new THREE.Color(1, 0.95, 0.88), _c2 = new THREE.Color(1, 0.7, 0.46), _sd = new THREE.Color(), _zen = new THREE.Color(), _hz = new THREE.Color(), _up = new V3(0, 1, 0);
function updateSky(mode, surfLonLat, camPos) {
  const t = world.t;
  const bodyId = mode === 'orbit' ? world.active.body : K.id;
  const b = BODIES[bodyId] || null;
  let sun, giant = null, ringN = null, moon = null, giantAng = 0.15, giantPal = null, hasRing = false;
  if (b && b.sky) {
    const { lon, lat } = siteLonLat(b);
    const conv = mode === 'orbit' ? (v) => v : (v) => fToWorld(v, surfLonLat.lon, surfLonLat.lat);
    sun = conv(sunDirF(b, mode === 'orbit' ? t : t - (G.solarT0 || 0))); giant = conv(giantDirF(b)); ringN = conv(ringNormalF(b)); moon = b.sky.moonAzEl ? conv(moonDirF(b, t)) : null;
    giantAng = b.sky.giantRadius; giantPal = b.sky.giantPal || BODIES[b.sky.giant].palette; hasRing = !!BODIES[b.sky.giant].rings;
  } else {
    const v = world.active; const ab = S.bodyAbs(v.body, t); const pos = ab.r.clone().add(v.r);
    sun = pos.clone().negate().normalize();
    if (b && b.parent !== S.ROOT && BODIES[b.parent].kind === 'giant') {
      const P = BODIES[b.parent]; const rel = S.bodyRel(b.id, t).r.clone().add(v.r);
      giant = rel.clone().negate().normalize(); giantAng = Math.min(1.2, Math.asin(Math.min(0.99, P.R / rel.length()))); giantPal = P.palette; hasRing = !!P.rings;
      ringN = new V3(0.05, 1, 0).normalize();
    }
  }
  sky.u.uSun.value.copy(sun); sky.u.uTime.value = t;
  if (giant) { sky.u.uG.value.copy(giant); sky.u.uGR.value = giantAng; sky.u.uRingN.value.copy(ringN || new V3(0, 1, 0)); sky.setGiant(giantPal, hasRing); } else sky.u.uGOn.value = 0;
  if (moon) { sky.u.uM.value.copy(moon); sky.u.uMR.value = b.sky.moonRadius; sky.u.uMOn.value = 1; } else sky.u.uMOn.value = 0;
  // Kestrel-like thin halo of nothing; atmosphere haze for bodies with air handled by the body shell
  let sunI = mode === 'orbit' ? 4.3 : 7.4;
  const sunK = b && b.sky ? 1 : 1;
  const sc = mode !== 'orbit' && K.atmosphere && K.atmosphere.scatter;
  if (sc) {
    // atmosphere world: sun colour and level from the transmittance of the air, sky-tinted hemisphere, stars fade by day
    atmU.uAOn.value = 1; atmU.uASun.value.copy(sun); atmU.uATime.value = G.time;
    const sd = sunDirect(sun.y, _sd), day = clamp((sun.y + 0.1) / 0.16, 0, 1), dd = day * day * (3 - 2 * day);
    _c1.setRGB(Math.pow(sd.r, 0.56), Math.pow(sd.g, 0.56), Math.pow(sd.b, 0.56));
    const W = RECIPES[K.id].WORLD;
    setSun(sun, 6.2 * W.sunScale * dd * clamp(0.55 + 0.9 * sun.y, 0.55, 1.1), _c1);
    const zen = inscatter(_up, sun, _zen); const m = Math.max(zen.r, zen.g, zen.b, 1e-4);
    const hz = inscatter(new V3(sun.x, 0.04, sun.z).normalize().negate().setY(0.04).normalize(), sun, _hz);
    gfx.hemi.color.setRGB(zen.r / m * 0.75 + 0.25 * W.hemi.sky[0], zen.g / m * 0.75 + 0.25 * W.hemi.sky[1], zen.b / m * 0.75 + 0.25 * W.hemi.sky[2]);
    gfx.hemi.groundColor.setRGB(W.hemi.ground[0] * (0.4 + 0.6 * dd), W.hemi.ground[1] * (0.4 + 0.6 * dd), W.hemi.ground[2] * (0.4 + 0.6 * dd));
    gfx.hemi.intensity = W.hemi.intensity * (0.12 + 0.88 * dd) * clamp(0.5 + 0.8 * Math.min(m, 2), 0.5, 1.5);
    sky.u.uStar.value = 1 - clamp((sun.y + 0.08) / 0.2, 0, 1) * 0.985;
    if (water) water.setLight(_c1, 0.25 + 0.5 * dd);
    for (const m of gfx.mats) { if (m.userData.env0 === undefined) m.userData.env0 = m.envMapIntensity; m.envMapIntensity = m.userData.env0 * (0.12 + 0.88 * dd); }      // the reflection probe is a daytime sky: fade it with the sun
    if (giant) setFill(giant, 0.12 * dd + 0.03, _c2); else setFill(new V3(0, 1, 0), 0.02, _c2);
    if (W.nyth) nythLight(W, giant, gfx, setFill, _c1);      // NYTH: ambient floor + blue giant-shine fill
  } else {
    atmU.uAOn.value = 0; sky.u.uStar.value = 1;
    for (const m of gfx.mats) if (m.userData.env0 !== undefined) m.envMapIntensity = m.userData.env0;
    gfx.hemi.color.setHex(0x242b3c); gfx.hemi.groundColor.setHex(0x3a342c); gfx.hemi.intensity = 0.3;
    setSun(sun, sunI * sunK, _c1);
    if (giant) { setFill(giant, 0.4, _c2); } else setFill(new V3(0, 1, 0), 0.05, _c2);
    const LK = mode !== 'orbit' && RECIPES[K.id].LOOK;       // glaciera: cold blue sky-shine off the ice
    if (LK) { gfx.hemi.color.setRGB(...LK.hemi.sky); gfx.hemi.groundColor.setRGB(...LK.hemi.ground); gfx.hemi.intensity = LK.hemi.intensity; if (giant) { _c2.setRGB(...LK.fill.color); setFill(giant, LK.fill.intensity, _c2); } }
  }
  particles.light.value.set(1, 0.93, 0.84).multiplyScalar(clamp(0.35 + sun.y * 0.9, 0.35, 1.05));
  return { sun, giant };
}

// ------------------------------------------------------------------ vessels in the orbit scene
function placeModel(v, rel, qF) {
  const m = v.model;
  if (v.kind === 'plane') { m.setTip(1); m.group.quaternion.copy(qF); m.group.position.copy(rel).sub(PLANE_COM.clone().applyQuaternion(qF)); }
  else if (v.kind === 'lander') { if (m.rover) m.setTip(0); m.group.quaternion.copy(qF); m.group.position.copy(rel).sub(LANDER_COM.clone().applyQuaternion(qF)); }
  else { m.group.quaternion.copy(qF); m.group.position.copy(rel); }
}
const QZ90 = new Q().setFromAxisAngle(new V3(0, 0, 1), -Math.PI / 2);
const DOCK_P = P_DOCK;      // PROSPECTOR dock_port in the rove-pose model frame (read from the GLB anchors)
function layoutOrbitScene() {
  const a = world.active;
  const ref = a.status === 'orbit' || a.docked ? (a.docked ? world.carrier : a) : world.carrier;
  const origin = ref.r.clone();
  for (const v of world.vessels) {
    const m = v.model;
    const same = v.body === ref.body && (v.status === 'orbit' || v.status === 'docked');
    if (!same) { if (m.group.parent === sceneO) sceneO.remove(m.group); continue; }
    if (m.group.parent !== sceneO) sceneO.add(m.group);
    m.group.visible = true;
    if (v.docked) {
      const c = world.carrier, cq = c.q, crel = c.r.clone().sub(origin);
      if (v.kind === 'lander') {
        if (m.rover) m.setTip(1);          // PROSPECTOR: docked in the rove pose, roof ring (dock_port) against the carrier port
        const dq = cq.clone().multiply(QZ90);
        const off = new V3(-5.2, -1.3, -5.0).sub((m.rover ? DOCK_P : new V3(0, 5.1, 0.7)).clone().applyQuaternion(QZ90));
        m.group.quaternion.copy(dq); m.group.position.copy(crel).add(off.applyQuaternion(cq));
      } else {
        m.setTip(1); m.group.quaternion.copy(cq);
        const off = new V3(13.0, -1.4, -3.0).sub(PLANE_COM).applyQuaternion(cq);
        m.group.position.copy(crel).add(off);
      }
    } else placeModel(v, v.r.clone().sub(origin), v.q);
  }
  return origin;
}
function setOrbitVisuals(v, t) {
  // gears / panels etc on the plane
  const p = world.plane;
  M.plane.setDeploy('panels', p.dep.panels); M.plane.setDeploy('radiators', p.dep.radiators); M.plane.setDeploy('ramp', p.dep.ramp);
  M.plane.setDeploy('legs', p.status === 'orbit' ? 0 : 1); M.plane.setDeploy('wheels', 0);
  if (M.lander.rover && world.lander.status !== 'surface') { for (const n of ['legs', 'panels', 'radiators', 'drill', 'sensor']) M.lander.setDeploy(n, 0); }      // PROSPECTOR: everything stowed in orbit
  // plumes
  for (const v of world.vessels) {
    const thr = v.status === 'orbit' && !v.docked ? v.throttle : 0;
    if (v.kind === 'lander') M.lander.plume.userData.set(thr, 14, t);
    else if (v.kind === 'carrier') M.carrier.plume.userData.set(world.carrier.docked ? 0 : (world.carrier.status === 'orbit' ? world.carrier.throttle : 0), 60, t);
    else {
      const e = v.engineId; const on = thr > 0.01;
      M.plane.plumes.forEach((pl) => { pl.userData.setKind(e === 'jet' ? 'jet' : 'rocket'); pl.userData.set(on && e !== 'nuclear' ? thr : 0, 12, t); });
      M.plane.plumeN.userData.set(on && e === 'nuclear' ? thr : 0, 10, t);
    }
  }
}

// ------------------------------------------------------------------ surface scene management
const surfaceVessels = () => world.vessels.filter((v) => v.status === 'surface' && !G.interior);      // AETHEL: the plane and its bay stay on the outer shell while the skiff is inside
function padRef(v, out = new V3()) { const s = v.surf; out.copy(s.p); if (s.aero) out.sub(_aeroOff.copy(COM_FLAT).applyQuaternion(s.q)); return out; }
function vesselPlacePos(v, out = new V3()) {
  const s = v.surf; out.copy(s.p);
  if (s.aero) return out;
  if (v.kind === 'plane' && v.stance !== 'vertical') { /* flat: centre ahead of the tail pivot along heading */ out.x += Math.sin(s.heading) * 9.6 * v.tip; out.z += -Math.cos(s.heading) * 9.6 * v.tip; }
  if (v.kind === 'lander' && v.model.rover && v.stance !== 'vertical') { if (v.stance === 'flat' && v.rv) return roverCenter(v, out); const e = F.roverPhase(v.tip).tip * REACH; out.x += Math.sin(s.heading) * e; out.z += -Math.cos(s.heading) * e; }      // PROSPECTOR
  return out;
}
function applySurfaceModel(v, t) {
  const s = v.surf, m = v.model;
  if (m.group.parent !== sceneS) sceneS.add(m.group);
  m.group.visible = true;
  m.group.position.copy(s.p); m.group.quaternion.copy(s.q);
  if (v.kind === 'plane') {
    if (s.aero) m.group.position.copy(s.p).sub(_aeroOff.copy(COM_FLAT).applyQuaternion(s.q));
    m.setTip(v.tip); const g = F.gearPhase(v.tip);
    m.setDeploy('wheels', s.aero ? s.gear : g.wheels); m.setDeploy('legs', g.legs);
    m.setDeploy('panels', v.dep.panels); m.setDeploy('radiators', v.dep.radiators); m.setDeploy('ramp', v.dep.ramp);
    const thr = v.status === 'surface' ? s.thrustFrac : 0;
    M.plane.plumes.forEach((pl) => { pl.userData.setKind(s.aero && s.engine === 'jet' ? 'jet' : 'rocket'); pl.userData.set(thr, 10, t); }); M.plane.plumeN.userData.set(0, 1, t);
    if (M.plane.setControls && v === world.active) M.plane.setControls(ctlF.fwd, ctlF.strafe, ctlF.yaw, 1 / 60); else if (M.plane.setControls) M.plane.setControls(0, 0, 0, 1 / 60);
  } else if (v.kind === 'lander') {
    if (m.rover) {      // PROSPECTOR: tip-down rig, deployables, wheel spin; the rover centre rides the wheel-plane fit when driving
      const ph = F.roverPhase(v.tip); m.setTip(ph.tip); m.setDeploy('legs', ph.legs);
      for (const n of ['panels', 'radiators', 'drill', 'sensor']) m.setDeploy(n, v.dep[n]);
      if (v.stance === 'flat' && v.rv) { const rv = v.rv; m.group.position.set(rv.cx, rv.cy + rv.clearance, rv.cz); m.setWheels(-rv.spin); }
      else { const e = ph.tip * REACH; m.group.position.set(s.p.x + Math.sin(s.heading) * e, s.p.y, s.p.z - Math.cos(s.heading) * e); }
    }
    M.lander.plume.userData.set(s.thrustFrac, 14, t);
  }
}
const _aeroOff = new V3();
let _rwCache = null;
function runwayEnv() {
  const rc = RECIPES[K.id]; if (!rc.RUNWAY) return null;
  const o = terrain.origin; if (_rwCache && _rwCache.ox === o.x && _rwCache.oz === o.z && _rwCache.id === K.id) return _rwCache.r;
  const p = rc.toSite(rc.RUNWAY.u0 + 300, 0); const r = { x: p.x - o.x, z: p.z - o.z, hdg: rc.RUNWAY.heading, h: rc.RUNWAY.h };
  _rwCache = { ox: o.x, oz: o.z, id: K.id, r }; return r;
}
function surfEnv() {
  return { gripAt: RECIPES[K.id].gripAt ? (x, z) => RECIPES[K.id].gripAt(x + terrain.origin.x, z + terrain.origin.z) : null, waterSurfaceY: (x, z) => { const rc = RECIPES[K.id]; return rc.waterSurface ? rc.waterSurface(x + terrain.origin.x, z + terrain.origin.z) : -1e9; }, waterDepth: (x, z) => (RECIPES[K.id].waterDepth ? RECIPES[K.id].waterDepth(x + terrain.origin.x, z + terrain.origin.z) : 0), runway: runwayEnv(), h: (x, z) => terrain.h(x, z), normal: (x, z, o) => terrain.normal(x, z, o), g: K.g, R: K.R, world, scatter, parkAlt: K.parkAlt, footR: 3.6, rhoAt: (alt) => (K.atmosphere ? density(K.id, alt) : 0),
    heatAt: RECIPES[K.id].heatAt ? (x, z) => RECIPES[K.id].heatAt(x + terrain.origin.x, z + terrain.origin.z) : null };      // PROSPECTOR: lava heat on the hull
}
function hideOrbitModels() { for (const v of world.vessels) if (v.status !== 'surface' && v.model.group.parent === sceneS) sceneS.remove(v.model.group); }

function enterSurface(v) {
  if (v.status === 'surface') return;
  activateWorld(v.body);
  const R = K.R;
  const aeroEntry = v.kind === 'plane' && !!K.atmosphere;                   // winged entry: the plane keeps its flat attitude
  const st = F.orbitToSurface(v.r, v.v, v.kind === 'plane' ? v.q.clone().multiply(QS_INV) : v.q, R);
  if (aeroEntry) st.q.multiply(QS);
  if (!G.descentOrigin) { setWorldOrigin(st.x, st.z); }
  const lx = st.x - terrain.origin.x, lz = st.z - terrain.origin.z;
  for (const o of world.vessels) if (o !== v && o.surf && o.surf.abs) { o.surf.p.x -= terrain.origin.x; o.surf.p.z -= terrain.origin.z; o.surf.abs = false; }
  if (bike.absSet) { bike.p.x -= terrain.origin.x; bike.p.z -= terrain.origin.z; bike.absSet = false; }
  const model = v.model; v.model = model;
  const ap = v.ap; v.ap = null;
  let heading = Math.atan2(st.vel.x, -st.vel.z); if (Math.hypot(st.vel.x, st.vel.z) < 5) heading = 1.78;
  const s = F.makeSurf(v, new V3(lx, st.y, lz), st.vel, st.q.clone(), heading);
  v.status = 'surface'; v.docked = false; v.stance = 'vertical'; v.tip = 0; v.tipT = 0; v.numeric = false; v.railed = false;
  if (v.kind === 'lander') { v.rv = null; v.sensorManual = false; for (const k of Object.keys(v.dep)) { v.dep[k] = 0; v.depT[k] = 0; } v.drilling = 0; v.refining = 0; }      // PROSPECTOR: arrives stowed
  s.assist = true; if (ap && ap.type === 'descent') s.ap = 'land';
  if (aeroEntry) { initAero(v, s, surfEnv()); s.onGround = false; s.gear = 0; s.ap = null; s.throttle = 0.0; s.p.add(_aeroOff.copy(new V3())); hud.toast('Atmospheric flight: fly her down (WASD pitch/roll, Shift/Ctrl throttle). L = runway landing assist', 'info'); }
  // keep an upright-ish attitude hint: re-orient smoothly (flight code rotates towards thrust direction)
  G.sv = v; G.mode = 'flight'; world.active = v;
  // Orbit camera angles already use the craft's local east, north and up directions.
  const c = G.cam, offset = c.yaw - heading - Math.PI;
  c.off = Math.atan2(Math.sin(offset), Math.cos(offset));
  G.aeroYaw = heading;
  camTarget.copy(s.p);
  gfx.camera.position.set(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch))
    .multiplyScalar(c.dist).add(camTarget);
  gfx.camera.up.set(0, 1, 0); gfx.camera.lookAt(camTarget);
  G.camInit = 'flight';
  hideOrbitModels(); sceneS.add(v.model.group);
  world.warpIndex = 0; world.warpTo = null;
}
function exitSurface(v) {
  const s = v.surf, R = K.R;
  const offset = gfx.camera.position.clone().sub(camTarget);
  G.cam.yaw = Math.atan2(offset.x, -offset.z);
  G.cam.pitch = Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
  G.cam.dist = offset.length();
  const qm = s.aero ? s.q.clone().multiply(QS_INV) : s.q.clone();
  const o = F.surfaceToOrbit(s.p.x + terrain.origin.x, s.p.y, s.p.z + terrain.origin.z, s.vel, qm, R);
  v.r.copy(o.r); v.v.copy(o.v); v.q.copy(v.kind === 'plane' ? o.q.multiply(QS) : o.q);
  v.status = 'orbit'; v.body = K.id; v.surf = null;
  world.rebuild(v); world.active = v;
  const wasAscent = s.ap === 'ascent';
  if (wasAscent) world.startAp(v, 'ascent', { heading: s.apHeading ?? Math.PI / 2 });
  const ox = terrain.origin.x, oz = terrain.origin.z;
  for (const o of surfaceVessels()) if (o !== v && o.surf && !o.surf.abs) { o.surf.p.x += ox; o.surf.p.z += oz; o.surf.abs = true; }
  if (G.bikeOut && !bike.absSet) { bike.p.x += ox; bike.p.z += oz; bike.absSet = true; }
  G.descentOrigin = false;
  G.sv = null; G.mode = 'orbit'; sceneS.remove(v.model.group);
  M.astro.group.visible = false;
}
function transition(fn, then) {
  if (G.fadeState) return;
  G.fadeState = { phase: 'out', t: 0, fn, then };
}
function stepFade(dt) {
  const f = G.fadeState; if (!f) return;
  f.t += dt;
  if (f.phase === 'out') { gfx.finalPass.uniforms.uFade.value = clamp(1 - f.t / 0.45, 0, 1); if (f.t >= 0.45) { f.fn(); f.phase = 'in'; f.t = 0; } }
  else { gfx.finalPass.uniforms.uFade.value = clamp(f.t / 0.55, 0, 1); if (f.t >= 0.55) { gfx.finalPass.uniforms.uFade.value = 1; G.fadeState = null; f.then && f.then(); } }
}

// ------------------------------------------------------------------ game flow actions
function uiKey(c) { return input.hit(c); }
function nearestVessel(pos, range = 16) {
  let best = null, bd = range;
  for (const v of surfaceVessels()) { const p = vesselPlacePos(v); const d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d < bd) { bd = d; best = v; } }
  return best;
}
function say(text, kind = 'info', big = false) { hud.toast(text, kind, big); }
function pushWorldMsgs() { for (const m of world.msgs.splice(0)) hud.toast(m.text, m.kind); }

function exitCraft(v) {
  const s = v.surf;
  const hd = s.heading, side = new V3(Math.cos(hd), 0, Math.sin(hd));
  if (v.model.rover && v.stance === 'flat' && v.rv) {      // PROSPECTOR: out of the crew hatch on the left flank (crew_exit)
    if (Math.abs(v.rv.speed) > 0.6) return say('Stop the rover first', 'warn');
    const c = roverCenter(v), fx = Math.sin(hd), fz = -Math.cos(hd);
    const x = c.x - side.x * 3.7 + fx * 1.6, z = c.z - side.z * 3.7 + fz * 1.6;
    player.place(x, terrain.h(x, z), z, hd - Math.PI / 2); M.astro.group.visible = true; sceneS.add(M.astro.group);
    G.mode = 'onfoot'; G.cam.yaw = hd + 0.6; G.cam.pitch = 0.2; G.cam.dist = 5; say('Outside the rover. E near it to climb back in', 'info'); return;
  }
  // step out beside the hatch (plane: near the cargo ramp side)
  const glbFlat = v.kind === 'plane' && v.stance === 'flat' && M.plane.glb;
  let p = vesselPlacePos(v); if (v.kind === 'plane' && v.stance === 'flat') p = padRef(v).add(new V3(Math.sin(hd), 0, -Math.cos(hd)).multiplyScalar(glbFlat ? 12.9 : 4));
  const off = glbFlat ? -3.4 : v.kind === 'plane' && v.stance === 'flat' ? 4.2 : 5.5;   // GLB: crew_exit beside the left hatch
  const x = p.x + side.x * off, z = p.z + side.z * off;
  player.place(x, terrain.h(x, z), z, hd + Math.PI / 2);
  M.astro.group.visible = true; sceneS.add(M.astro.group);
  G.mode = 'onfoot'; G.cam.yaw = hd + 0.6; G.cam.pitch = 0.2; G.cam.dist = 5;
  say('Outside. Walk (WASD), jump (Space), E near a craft or bike', 'info');
}
function enterCraft(v) {
  world.active = v; G.sv = v; G.mode = 'flight'; M.astro.group.visible = false; G.cam.pitch = 0.2; G.cam.dist = v.kind === 'plane' ? 26 : 16;
  say(`Aboard ${v.name}`, 'ok');
}
function deployBike(v) {
  if (G.bikeOut) { stowBike(v); return; }
  if (v.kind !== 'plane') return say('The bike lives in the spaceplane bay', 'warn');
  if (v.stance !== 'flat') return say('Tip the plane to horizontal first (T)', 'warn');
  if (v.dep.ramp < 0.95) return say('Lower the cargo ramp first (Y)', 'warn');
  const s = v.surf, hd = s.heading;
  const back = new V3(-Math.sin(hd), 0, Math.cos(hd));
  const RAMP_OUT = M.plane.glb ? -3.4 : 4.5;      // GLB: ramp foot is ~3.4 m ahead of the tail-pad line (s.p)
  const pr = padRef(v); const x = pr.x + back.x * RAMP_OUT, z = pr.z + back.z * RAMP_OUT;
  bike.place(x, z, hd + Math.PI, surfEnv()); bike.v.set(back.x * 1.2, 0, back.z * 1.2);
  M.bike.group.visible = true; sceneS.add(M.bike.group); G.bikeOut = true; v.bikeStowed = false;
  say('Bike rolling out. E to ride', 'ok');
}
function stowBike(v) {
  const s = v.surf; const d = Math.hypot(bike.p.x - s.p.x, bike.p.z - s.p.z);
  if (d > 22) return say('Bring the bike close to the plane to stow it', 'warn');
  M.bike.group.visible = false; G.bikeOut = false; v.bikeStowed = true; say('Bike stowed', 'info');
}
function mountBike() {
  G.mode = 'bike'; G.riding = true; M.astro.group.visible = true; M.astro.group.position.set(0, 0, 0); M.bike.group.add(M.astro.group); if (M.astro.glb) M.astro.group.position.set(0, 0, 0); else M.astro.group.position.set(0, 0.36, 0.48); M.astro.group.rotation.set(0, 0, 0);   // GLB ride clip carries the hips: identity under the bike root
  G.cam.pitch = 0.22; G.cam.dist = 6.5; G.cam.off = 0;
  say('Ride: W throttle, S brake, A/D steer, Shift boost, Q wheelie, R reset', 'info');
}
function dismountBike() {
  G.riding = false; sceneS.add(M.astro.group); M.astro.group.rotation.set(0, 0, 0);
  const hd = bike.yaw, side = new V3(Math.cos(hd), 0, Math.sin(hd));
  const x = bike.p.x + side.x * 1.4, z = bike.p.z + side.z * 1.4; player.place(x, terrain.h(x, z), z, hd);
  G.mode = 'onfoot'; G.cam.dist = 5; bike.v.multiplyScalar(0.3);
}
function doHarvest() {
  if (G.harvest) return;
  if (veg) {            // glowing spore pods are a rare biological resource
    const pod = veg.harvestPod(player.p.x + terrain.origin.x, player.p.z + terrain.origin.z, 4.5);
    if (pod) { G.harvest = { t: 0, dur: 1.8, smp: { kind: 'spore', amount: 1 } }; if (eco) eco.scan(pod.x, pod.z, 6); say('Collecting a spore pod...', 'info'); return; }
  }
  const smp = sampleAt(RECIPES[K.id], terrain.origin.x, terrain.origin.z, player.p.x, player.p.z);
  G.harvest = { t: 0, dur: 3.2, smp }; say(`Sampling ${smp.kind === 'ice' && K.id !== 'kestrel' && !RECIPES[K.id].ICE ? 'water' : smp.kind}...`, 'info');
}
function doScan(x, z, range = 480, bioR = 60) {
  const r = disc.scan(x, z, range);
  let bio = 0;
  if (eco) { const l = eco.scan(x + terrain.origin.x, z + terrain.origin.z, bioR); bio = l.length; }
  if (r.n) say(`Scan: ${r.n} new signal(s) logged`, 'ok');
  else if (bio) say(`Survey: ${bio} new species logged`, 'ok');
  else if (r.seen) say('Scan: nothing new within range', 'info'); else say(eco ? `Scan: no signals within ${range} m; nothing new in the survey radius` : `Scan: no signals within ${range} m`, 'info');
}
function canRefine(v) { return v && v.status === 'surface' && v.surf.landed; }
function doRefine(v) {
  if (!canRefine(v)) return say('Land first, then refine', 'warn');
  if (G.refine) return;
  const mini = v.kind === 'plane', rover = v.kind === 'lander' && v.model.rover;
  if (rover && v.rv && Math.abs(v.rv.speed) > 0.5) return say('Park the rover to run the refinery', 'warn');
  if (mini || rover) { if (v.overheat) return say('Overheating: deploy radiators (K) and wait', 'warn'); if (v.sysBatt < 2) return say('Battery low: deploy solar panels (P)', 'warn'); }
  G.refine = { v, t: 0, dur: mini ? 8 : rover ? 6 : 4 }; v.refining = 1; say(mini ? 'Mini-ISRU running (slow, draws power, makes heat)...' : rover ? 'Refinery running: the hopper feeds the electrolysis stacks (draws power, makes heat)...' : 'Refining propellant...', 'info');
}
function doDrill(v) {
  const rover = v.kind === 'lander' && v.model.rover;
  if (!canRefine(v) || (v.kind !== 'plane' && !rover)) return say(v.kind === 'lander' ? 'Land first, then tip the rover down (T) to drill' : 'The drill is on the spaceplane and the Prospector: land first', 'warn');
  if (G.drill) return;
  if (rover && (v.stance !== 'flat' || !v.rv)) return say('Tip the rover down onto its wheels (T) to swing the drill down', 'warn');
  if (rover && (Math.abs(v.rv.speed) > 0.4 || v.rv.flipT)) return say('Park the rover upright to drill', 'warn');
  if (v.overheat || v.sysBatt < 2) return say('Drill needs power and cool radiators (P / K)', 'warn');
  if (rover) { v.depT.drill = 1; G.drill = { v, t: 0, dur: 9, wait: true, rover: true }; v.drilling = 1; say('Drill mast swinging down through the belly bay...', 'info'); return; }
  G.drill = { v, t: 0, dur: 9 }; v.drilling = 1; say('Mini drill working...', 'info');
}

// ------------------------------------------------------------------ keyboard handling shared across modes
function handleGlobalKeys() {
  if (uiKey('KeyM')) toggleMap();
  if (uiKey('KeyJ')) toggleJournal();
  if (uiKey('F1') || (uiKey('KeyH') && !G.uiOpen)) toggleHelp();
  if (uiKey('Escape')) { if (hud.isOpen('map')) toggleMap(false); else if (hud.isOpen('journal')) toggleJournal(false); else if (hud.isOpen('help')) toggleHelp(false); else if (document.pointerLockElement) document.exitPointerLock(); }
}
function toggleMap(on) { const o = on ?? !hud.isOpen('map'); mapUI.show(o); G.uiOpen = o || hud.isOpen('journal') || hud.isOpen('help'); if (o && document.pointerLockElement) document.exitPointerLock(); }
function toggleJournal(on) { const o = on ?? !hud.isOpen('journal'); hud.overlay('journal', o); if (o) buildJournal(); G.uiOpen = o || hud.isOpen('map') || hud.isOpen('help'); if (o && document.pointerLockElement) document.exitPointerLock(); }
function toggleHelp(on) { const o = on ?? !hud.isOpen('help'); hud.overlay('help', o); G.uiOpen = o || hud.isOpen('map') || hud.isOpen('journal'); if (o && document.pointerLockElement) document.exitPointerLock(); }
function buildJournal() {
  const inv = inventory, v = world.active;
  let h = `<div class="jitem"><b>Cargo</b><br>Ice ${inv.ice.toFixed(0)} kg - Regolith ${inv.regolith.toFixed(0)} kg - ${inv.samples} samples taken</div>`;
  h += `<div class="jitem"><b>Craft</b><br>Wayfarer H2 ${world.carrier.tanks.h2.toFixed(0)} kg (dv ${carrierDv(world.carrier.tanks.h2).toFixed(0)} m/s) - ${world.lander.name} ${world.lander.tanks.fuel.toFixed(0)}/${world.lander.tanks.ox.toFixed(0)} kg - Albatross ${world.plane.tanks.fuel.toFixed(0)}/${world.plane.tanks.ox.toFixed(0)}/${world.plane.tanks.h2.toFixed(0)} kg</div>`;
  h += `<div class="jitem"><b>Discoveries (${disc.journal.length})</b></div>`;
  if (!disc.journal.length) h += `<div class="dim jitem">Nothing logged yet. Signals show on the compass as diamonds. Walk, ride or fly low near one, or press F on foot to scan.</div>`;
  for (const e of disc.journal) h += `<div class="jitem"><b>${e.n}. ${e.name}</b><br><span class="dim">${e.text}</span></div>`;
  $el('journalBody').innerHTML = h;
}
function buildHelp() {
  $el('helpBody').innerHTML = `<div class="cols">
  <div><b>Anywhere</b><br>M system map &middot; J journal &middot; F1/H this help &middot; Esc close / free mouse<br>
  <b>Orbit view</b><br>W/S pitch &middot; A/D yaw &middot; Q/E roll &middot; Shift/Ctrl throttle &middot; Z full &middot; X cut<br>1 prograde &middot; 2 retrograde &middot; 3 radial out &middot; 4 free &middot; 5 node<br>, / . warp &middot; / warp 1x &middot; Tab switch craft<br>U undock spaceplane &middot; I undock lander &middot; C dock (within 12 km)<br>G begin descent (Prospector / Albatross, Kestrel) &middot; N engine mode &middot; P panels &middot; K radiators<br>Mouse drag orbit camera &middot; wheel zoom<br>
  <b>Map</b><br>Click a world to select &middot; plan transfer, edit nodes, warp to window / node</div>
  <div><b>Powered flight (Prospector hover assist / Albatross descent hold)</b><br>W/S/A/D move &middot; Q/E turn &middot; Shift/Ctrl climb/descend (assist) or throttle (manual)<br>Space velocity-hold assist on/off (plane: Descent hold; Prospector: Hover assist) &middot; L auto-land &middot; O launch to orbit &middot; E leave craft (landed)<br>
  <b>Spaceplane on the ground</b><br>T tip down to horizontal / stand up for vertical launch (nose up) &middot; Y cargo ramp &middot; B roll out bike<br>P solar panels &middot; K radiators &middot; N engine mode &middot; V drill &middot; R refine (mini-ISRU)<br>
  <b>Prospector rover</b><br>It lands tail-first on its pads. T unfolds the wheel legs and tips it onto six wheels; T again stands it up for a vertical launch (O)<br>W/S drive &middot; A/D steer &middot; Space brake &middot; wheel &middot; mouse zoom / orbit camera &middot; R right it after a rollover<br>Ground survey: the sensor mast rises when driving (Y toggles it) and the HUD shows ground richness and the direction of richer ground. F scans (1.1 km)<br>Park, then V drill (yield follows the surveyed richness) &middot; R refine (ISRU) &middot; P panels &middot; K radiators (they fold away when driving fast, in flight and on reentry) &middot; E exit / enter (crew hatch)<br>
  <b>On foot</b><br>WASD move &middot; Shift run &middot; Space jump / hold for jetpack &middot; mouse look (click to capture) &middot; wheel zoom<br>E enter craft / ride bike &middot; B bike stow &middot; G sample ice / regolith &middot; F scan &middot; R refine at the Prospector / Albatross<br>
  <b>Bike</b><br>W throttle &middot; S brake/reverse &middot; A/D steer &middot; Shift boost &middot; Q wheelie &middot; Space brake<br>In the air W/S pitch, A/D roll, E/Q yaw &middot; R reset upright &middot; E dismount<br>
  <b>Aethel skiff</b> (Aethel only)<br>U (plane landed or on foot beside it) deploy / stow &middot; E board &middot; W/S speed &middot; A/D turn &middot; Q/E strafe &middot; Shift/Ctrl climb / descend &middot; Space boost &middot; F scan &middot; U leave (landed)<br>Dive into the glowing gate at the bottom of a funnel crater to enter the hollow interior; fly down through the window in the sky to come back out</div></div>
  <p class="dim small">Landing: gentle touchdown (< 4 m/s) succeeds. A hard landing damages the craft (moderate hits bounce, severe ones stay down). Wipe-outs on the bike just respawn you upright.</p>`;
}

// ------------------------------------------------------------------ per-mode updates
const ctlO = { pitch: 0, yaw: 0, roll: 0, throttle: 0 };
function orbitControls(dt) {
  const v = world.active;
  const free = !G.uiOpen;
  if (!free) { ctlO.pitch = ctlO.yaw = ctlO.roll = 0; ctlO.throttle = v.docked ? 0 : (v.thrCmd || 0); return; }
  ctlO.pitch = (input.down('KeyS') ? 1 : 0) - (input.down('KeyW') ? 1 : 0);
  ctlO.yaw = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
  ctlO.roll = (input.down('KeyQ') ? 1 : 0) - (input.down('KeyE') ? 1 : 0);
  v.thrCmd = v.thrCmd || 0;
  if (input.down('ShiftLeft') || input.down('ShiftRight')) v.thrCmd = Math.min(1, v.thrCmd + 0.6 * dt);
  if (input.down('ControlLeft') || input.down('ControlRight')) v.thrCmd = Math.max(0, v.thrCmd - 0.6 * dt);
  if (input.hit('KeyZ')) v.thrCmd = 1; if (input.hit('KeyX')) v.thrCmd = 0;
  ctlO.throttle = v.docked ? 0 : v.thrCmd;
  if (input.hit('Digit1')) v.sas = 'pro'; if (input.hit('Digit2')) v.sas = 'retro'; if (input.hit('Digit3')) v.sas = 'up'; if (input.hit('Digit4')) v.sas = 'free'; if (input.hit('Digit5')) v.sas = 'node';
  if (input.hit('Comma')) world.setWarp(world.warpIndex - 1);
  if (input.hit('Period')) world.setWarp(world.warpIndex + 1);
  if (input.hit('Slash')) { world.warpIndex = 0; world.warpTo = null; }
  if (input.hit('KeyU')) undockCraft(world.plane); if (input.hit('KeyI')) undockCraft(world.lander);
  if (input.hit('KeyC')) dockCraft();
  if (input.hit('KeyG')) beginDescent();
  if (input.hit('Tab')) cycleCraft();
  if (input.hit('KeyN')) cycleMode(); if (input.hit('KeyP')) toggleDeploy('panels'); if (input.hit('KeyK')) toggleDeploy('radiators');
  if (input.wheel) G.cam.dist = clamp(G.cam.dist * (input.wheel > 0 ? 1.12 : 1 / 1.12), 6, 400);
  if (input.drag && (input.mouseDX || input.mouseDY)) { G.cam.yaw -= input.mouseDX * 0.006; G.cam.pitch = clamp(G.cam.pitch + input.mouseDY * 0.006, -1.4, 1.4); }
}
function undockCraft(d) {
  const c = world.carrier;
  if (!d.docked) return say(`${d.name} is already free`, 'info');
  if (world.active !== c && world.active.status === 'orbit' && !world.active.docked) return say('Switch to the carrier (Tab) to undock', 'warn');
  if (world.undock(d)) { G.cam.dist = d.kind === 'plane' ? 40 : 22; world.warpIndex = 0; }
}
function dockCraft() {
  const d = world.active;
  if (world.dockAssist) return;
  if (d.target) {
    const host = d.target.docked ? world.carrier : d.target;
    if (d === world.carrier && host !== d) return world.startDock(host);
    if (host === world.carrier && d !== host) return world.startDock(d);
    return say(host === d ? 'That craft is already aboard Wayfarer' : 'Albatross and Prospector dock at Wayfarer’s ports', 'info');
  }
  if (d.kind === 'carrier') { const free = [world.plane, world.lander].find((x) => !x.docked && x.status === 'orbit' && x.body === d.body); if (free) return world.startDock(free); return say('No free craft nearby', 'info'); }
  world.startDock(d);
}
function cycleCraft() {
  const list = world.vessels.filter((v) => v.status === 'orbit' && !v.docked);
  if (list.length < 2) return say('No other free craft in orbit', 'info');
  const i = list.indexOf(world.active); world.active = list[(i + 1) % list.length]; say(`Controlling ${world.active.name}`, 'ok');
}
function cycleMode() {
  const v = world.active; if (v.kind !== 'plane') return;
  const modes = ['auto', 'jet', 'rocket', 'nuclear']; v.mode = modes[(modes.indexOf(v.mode) + 1) % modes.length];
  say(`Engine mode: ${v.mode.toUpperCase()} - ${v.mode === 'auto' ? 'picks jet in air, rocket for landings, nuclear for orbital moves' : PLANE.modes[v.mode].note}`, 'info');
}
function toggleDeploy(what, craft) {
  const v = craft || (G.mode === 'orbit' ? world.active : (G.sv || world.plane));
  const p = world.plane;
  const tgt = v.kind === 'plane' || (v.kind === 'lander' && v.model.rover && v.status === 'surface') ? v : p;
  if (tgt.kind === 'lander') {
    if (tgt.stance !== 'flat') return say('Tip the rover down onto its wheels first (T)', 'warn');
    if (tgt.rv && Math.abs(tgt.rv.speed) > 1) return say('Stop the rover before deploying arrays', 'warn');
  }
  tgt.depT[what] = tgt.depT[what] > 0.5 ? 0 : 1;
  say(`${what === 'panels' ? 'Solar panels' : what === 'radiators' ? 'Radiators' : 'Cargo ramp'} ${tgt.depT[what] ? 'deploying' : 'retracting'}`, 'info');
}
function beginDescent() {
  const v = world.active;
  if (v.status !== 'orbit' || v.docked) return;
  if (v.kind === 'carrier') return say('The carrier cannot land: undock the spaceplane (U) or lander (I)', 'warn');
  if (v.ap) { world.cancelAp(v); return say('Descent assist cancelled', 'info'); }
  if (!world.hasSurface(v.body)) return say(`${BODIES[v.body].name}: surface survey pending`, 'warn');
  if (world.groundAlt(v) > 120000) return say('Descend from a lower orbit first', 'warn');
  world.startAp(v, 'descent'); say('Descent assist: retrograde burn, then powered descent', 'ok');
}

function updateOrbitMode(dt) {
  handleOrbitMapWarp();
  orbitControls(dt);
  world.step(dt, ctlO);
  pushWorldMsgs();
  for (const e of world.events.splice(0)) {
    if (e.type === 'enterSurface' && e.v === world.active) enterSurface(e.v);
    if (e.type === 'ascentDone') { world.parkCarrierAhead(e.v); }
    if (e.type === 'docked') { G.cam.dist = 70; }
    if (e.type === 'soi') { /* already toasted */ }
  }
  const v = world.active;
  // transition to the surface scene when descending below 14 km
  if (v.status === 'orbit' && !v.docked && v.kind !== 'carrier' && RECIPES[v.body] && !G.fadeState) {
    if (G.worldId !== v.body && world.groundAlt(v) < 60000) activateWorld(v.body);
    const alt = world.groundAlt(v);
    if (alt < 48000) prewarm(v);
    if (alt < F.TRANSITION_DOWN && v.v.dot(v.r) < 0 && terrain.pending < 12) enterSurface(v);
  }
  if (!RECIPES[v.body]) G.descentOrigin = false;
}
function prewarm(v) {
  const st = F.orbitToSurface(v.r, v.v, v.q, K.R);
  if (!G.descentOrigin) { setWorldOrigin(st.x, st.z); }
  const cp = new V3(st.x - terrain.origin.x, st.y, st.z - terrain.origin.z);
  terrain.update(cp); scatter.update(cp);
}
function handleOrbitMapWarp() {
  if (world.warpTo != null) {
    const rem = world.warpTo - world.t;
    if (rem <= 0) { world.warpTo = null; world.warpIndex = 0; }
    else { let i = 0; for (let k = WARP.length - 1; k >= 0; k--) if (WARP[k] * 0.12 <= rem) { i = k; break; } world.warpIndex = Math.min(i, world.maxWarpIndex()); }
  }
}

// surface flight ------------------------------------------------------
const ctlF = { fwd: 0, strafe: 0, yaw: 0, climb: 0, dthr: 0, full: false, cut: false, run: false };
let lzBeacon = null;
function updateLzBeacon(v) {          // green beam over the chosen landing site (final descent diversion)
  const s = v.surf, on = !!(s.site && !s.landed);
  if (!lzBeacon) { if (!on) return; lzBeacon = createBeacon(0x6dff9a, 140); sceneS.add(lzBeacon); }
  lzBeacon.visible = on; if (!on) return;
  lzBeacon.position.set(s.site.x, terrain.h(s.site.x, s.site.z), s.site.z);
  lzBeacon.material.uniforms.uK.value = 1; lzBeacon.material.uniforms.uTime.value = G.time;
}
function updateFlight(dt) {
  const v = G.sv, s = v.surf;
  const free = !G.uiOpen;
  updateLzBeacon(v);
  syncRover(v);
  const roverOn = v.kind === 'lander' && v.model.rover && v.stance === 'flat' && !!v.rv;      // PROSPECTOR: six-wheel drive mode
  ctlF.fwd = free ? (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0) : 0;
  ctlF.strafe = free ? (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) : 0;
  ctlF.yaw = free ? (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0) : 0;
  const up = free && (input.down('ShiftLeft') || input.down('ShiftRight')), dn = free && (input.down('ControlLeft') || input.down('ControlRight'));
  ctlF.climb = (up ? 1 : 0) - (dn ? 1 : 0); ctlF.dthr = ctlF.climb; ctlF.run = false;
  ctlF.full = free && input.hit('KeyZ'); ctlF.cut = free && input.hit('KeyX');
  if (free) {
    if (input.hit('Space') && s.aero) { s.assist = !s.assist; s.ap = null; say(s.assist ? 'Stability assist ON: A/D bank, W/S pitch' : 'Direct control: A/D roll rate, W/S pitch rate', 'info'); }
    else if (input.hit('Space') && !roverOn) { s.assist = !s.assist; s.ap = null; if (!s.assist) s.throttle = s.thrustFrac; say(s.assist ? (v.kind === 'plane' ? 'Descent hold ON: WASD move, Shift/Ctrl climb (velocity hold on the main engines)' : 'Hover assist ON: WASD move, Shift/Ctrl climb') : 'Manual flight: WASD tilt, Shift/Ctrl throttle, Z full, X cut', 'info'); }
    if (input.hit('KeyL') && s.aero) { if (s.landed) say('Already on the ground', 'info'); else { s.ap = s.ap === 'aeroland' ? null : 'aeroland'; s.assist = true; say(s.ap ? 'Runway landing assist: glide slope to the meadow strip' : 'Landing assist off', 'info'); } }
    else if (input.hit('KeyL')) { if (s.landed) say('Already landed', 'info'); else { s.ap = s.ap === 'land' ? null : 'land'; s.assist = true; say(s.ap ? 'Auto-land engaged' : 'Auto-land off', 'info'); } }
    if (input.hit('KeyO') && s.aero) {
      if (v.dep.panels > 0.2 || v.dep.radiators > 0.2) { v.depT.panels = 0; v.depT.radiators = 0; say('Retracting panels/radiators for flight', 'warn'); }
      if (G.bikeOut && s.onGround) return say('Stow the bike first (B near the plane)', 'warn');
      if (v.dep.ramp > 0.05) { v.depT.ramp = 0; return say('Closing the ramp: press O again', 'warn'); }
      s.ap = s.onGround ? 'aerotakeoff' : 'aeroclimb'; s.assist = true; say('Automatic takeoff and climb: jets, then rocket, then orbit hand-over', 'info');
    } else if (input.hit('KeyO')) launchToOrbit(v);
    if (input.hit('KeyE') && s.landed && v.stance !== 'tipping') exitCraft(v);
    if (input.hit('KeyT')) { if (s.aero) say('Winged craft: this world has a runway, no tail-stand needed', 'info'); else tipPlane(v); }
    if (input.hit('KeyY')) rampToggle(v);
    if (input.hit('KeyB')) deployBike(v);
    if (input.hit('KeyU')) deploySkiff(v);      // AETHEL
    if (input.hit('KeyP')) toggleDeploy('panels', v); if (input.hit('KeyK')) toggleDeploy('radiators', v); if (input.hit('KeyN')) cycleMode();
    if (input.hit('KeyV')) doDrill(v);
    if (input.hit('KeyR')) { if (roverOn && v.rv.flipT) { if (roverRight(v, surfEnv())) say('Righting the rover: rolling back onto its wheels', 'info'); } else doRefine(v); }
    if (input.hit('KeyF') && v.model.rover && s.landed) { const c = vesselPlacePos(v); doScan(c.x, c.z, 1100, 150); }      // PROSPECTOR: the mast scans further than a suit
    if (input.wheel) G.cam.dist = clamp(G.cam.dist * (input.wheel > 0 ? 1.12 : 1 / 1.12), 8, 120);
    if (input.drag && (input.mouseDX || input.mouseDY)) { G.cam.off -= input.mouseDX * 0.006; G.cam.pitch = clamp(G.cam.pitch + input.mouseDY * 0.005, -0.3, 1.3); }
    if (input.hit('Comma') || input.hit('Period')) { if (s.aero && s.ap && !s.onGround) { G.fwarp = clamp((G.fwarp || 1) * (input.hit('Period') ? 2 : 0.5), 1, 8); say(`Flight time x${G.fwarp} (autopilot only)`, 'info'); } else say('Time warp is for orbit view (or an aeroplane autopilot leg)', 'info'); }
  }
  if (!input.drag) G.cam.off *= Math.pow(0.4, dt);
  F.stepStance(v, dt);
  const wp = (s.aero && s.ap && !s.onGround) ? (G.fwarp || 1) : (G.fwarp = 1);
  const dtE = dt * wp, steps = Math.max(1, Math.round(dtE / (1 / (wp > 1 ? 60 : 120))));
  const envF = surfEnv();
  if (roverOn) driveRover(v, dt, free, envF);          // PROSPECTOR
  else { s.events.length = 0; for (let i = 0; i < steps; i++) F.stepFlight(v, ctlF, dtE / steps, envF); }
  tickWorkers(dt, s.p);          // drilling / refining also progress from the cab (they used to wait for the crew to step outside)
  world.advance(dt, null);
  for (const e of s.events) flightEvent(v, e);
  // other surface craft just rest; power / heat for plane and Prospector systems
  for (const o of surfaceVessels()) { if (o !== v) restCraft(o, dt, false); craftSystems(o, dt); }
  stepBikeParked(dt);
  // dust
  emitFlightDust(v, dt);
  // transition up
  if (s.p.y > F.TRANSITION_UP || s.events.includes('orbit')) exitSurface(v);
  checkBodyEvents();
  if (s.ap === 'land' && s.landed) { s.ap = null; }
}
// ---- PROSPECTOR: rover drive, parked craft, power / heat systems
const _rctl = { fwd: 0, steer: 0, brake: 0 };
function driveRover(v, dt, free, envF) {
  const rv = v.rv, s = v.surf;
  const drillBusy = v.dep.drill > 0.05 || v.drilling;
  _rctl.fwd = drillBusy ? 0 : ctlF.fwd; _rctl.steer = ctlF.strafe; _rctl.brake = free && input.down('Space') ? 1 : 0;
  if (drillBusy && ctlF.fwd !== 0 && G.time - (G.drillHint || -9) > 4) { G.drillHint = G.time; say('Raise the drill first (V)', 'warn'); }
  const n = 2; for (let i = 0; i < n; i++) roverStep(v, _rctl, dt / n, envF);
  for (const e of s.events) {
    if (e === 'rolled') say('The rover has rolled over on the slope! Press R to right it', 'warn', true);
    else if (e === 'steepahead') { if (G.time - (G.lavaHint || -9) > 3) { G.lavaHint = G.time; say('Too steep ahead: the stability control stops the rover (turn, or go round)', 'warn'); } }
    else if (e === 'lava') { if (G.time - (G.lavaHint || -9) > 3) { G.lavaHint = G.time; say('Lava ahead: the rover will not drive into it', 'warn'); } }
    else if (e === 'deepwater') { if (G.time - (G.lavaHint || -9) > 3) { G.lavaHint = G.time; say('Too deep for the wheels', 'warn'); } }
  }
  // sensor mast: up while driving (and for a few seconds afterwards) or when the crew raised it (Y)
  const moving = Math.abs(rv.speed) > 0.25; if (moving) rv.mastT = 8; rv.mastT = Math.max(0, (rv.mastT || 0) - dt);
  v.depT.sensor = (rv.mastT > 0 || v.sensorManual) ? 1 : 0;
  rv.surveyT += dt;
  if (v.dep.sensor > 0.6 && rv.surveyT > 0.45) surveyUpdate(v, RECIPES[K.id], terrain.origin.x, terrain.origin.z);
  // wheel dust
  if (Math.abs(rv.speed) > 2 && Math.random() < 0.6) { const c = roverCenter(v), hd = s.heading; particles.emit(c.x - Math.sin(hd) * 3, c.y + 0.2, c.z + Math.cos(hd) * 3, -rv.speed * Math.sin(hd) * 0.1, 0.8, rv.speed * Math.cos(hd) * 0.1, 0.5, 1.2, 1.6, 0.82, 0.74, 0.62, 0.3); }
  // drilling dust at the drill tip
  if (v.drilling && v.dep.drill > 0.9 && Math.random() < 0.8) { const c = roverCenter(v), hd = s.heading; particles.emit(c.x - Math.sin(hd) * 1.15 + (Math.random() - 0.5) * 0.4, c.y + 0.1, c.z + Math.cos(hd) * 1.15 + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.3, 0.7, 1.4, 0.8, 0.72, 0.6, 0.4); }
}
/** craft resting on the ground: stance animation, settle on the terrain; a parked (flat) Prospector keeps following the wheel plane */
function syncRover(o) { if (!(o.model && o.model.rover)) return; if (o.stance === 'flat') { if (!o.rv) roverInit(o, surfEnv()); } else if (o.rv) o.rv = null; }
function restCraft(o, dt, doStance, allLanded = false) {
  if (doStance) F.stepStance(o, dt);
  syncRover(o);
  const rover = o.model && o.model.rover && o.stance === 'flat' && o.rv;
  if (rover) { if (o !== G.sv || G.mode !== 'flight') { _rctl.fwd = 0; _rctl.steer = 0; _rctl.brake = 1; roverStep(o, _rctl, dt, surfEnv()); } return; }
  if (o.surf.landed && (allLanded || !o.surf.aero)) F.settleOnGround(o, o.surf, surfEnv(), dt);
}
const _sysX = {};
function craftSystems(o, dt) {
  if (o.kind !== 'plane' && !(o.kind === 'lander' && o.model && o.model.rover)) return;
  _sysX.driveLoad = 0; _sysX.driveHeat = 0; _sysX.aeroHeat = 0;
  if (o.kind === 'lander') {
    const rv = o.rv, flat = rv && o.stance === 'flat';
    if (flat) {
      const sp = Math.abs(rv.speed); _sysX.driveLoad = 0.06 * sp; _sysX.driveHeat = 0.05 * sp;
      const env = surfEnv(); if (env.heatAt) _sysX.aeroHeat = env.heatAt(rv.cx, rv.cz) * 14;          // radiant heat from lava
      if (sp > 4 && (o.depT.panels || o.depT.radiators)) { o.depT.panels = 0; o.depT.radiators = 0; say('Panels and radiators retracted for driving', 'warn'); }
    }
    // stowed for flight and reentry (and a tail-landing is never made with the arrays out)
    if (!o.surf.landed || o.glow > 0.02 || o.stance === 'tipping') { o.depT.panels = 0; o.depT.radiators = 0; o.depT.drill = 0; o.depT.sensor = 0; }
  }
  o.stepSystems(dt, clamp(sunElevSin(), 0, 1), _sysX);
}
function sunElevSin() { const sd = sunDirF(K, world.t - (G.solarT0 || 0)); const l = lonLatOfSite(); return fToWorld(sd, l.lon, l.lat).y; }
function focusPos() { return G.mode === 'flight' && G.sv ? G.sv.surf.p : G.mode === 'bike' ? bike.p : G.mode === 'skiff' ? skiff.p : player.p; }
function lonLatOfSite() { const p = focusPos(); return { lon: (p.x + terrain.origin.x) / K.R, lat: -(p.z + terrain.origin.z) / K.R }; }
function flightEvent(v, e) {
  if (e === 'landed') { say(`Touchdown (${(v.surf.aero ? (v.surf.landSink ?? 0) : (v.surf.landSpeed ?? 0)).toFixed(1)} m/s${v.surf.aero ? ' sink' : ''}). ${v.name} is safe`, 'ok', true); for (let i = 0; i < 40; i++) dustBurst(v.surf.p, 8, 3); }
  else if (e === 'hard') { say(`Hard landing (${(v.surf.hardSpeed ?? 0).toFixed(1)} m/s): hull damaged`, 'warn', true); }
  else if (e === 'steep') say(`Ground too steep to stand on (${(v.surf.tilt * 57.3).toFixed(0)} deg): lifting off. Find flatter ground and land again (L)`, 'warn', true);
  else if (e === 'divert') say(`Landing site found ${(v.surf.site.d).toFixed(0)} m away: diverting (marked LZ on the compass)`, 'ok', true);
  else if (e === 'nosite') say('No flat, dry ground within reach: landing where the track ends (find a patch yourself: Shift climbs, L lands)', 'warn', true);
  else if (e === 'liftoff') say(v.surf.aero ? 'Airborne' : 'Liftoff', 'info');
  else if (e === 'waterwarn') say('Water below: this craft cannot land on water. Climb or divert to the meadow', 'warn');
  else if (e === 'water' || e === 'splashed') say('Splashdown avoided: the autopilot pulled you out of the water (the craft cannot land on water)', 'warn', true);
  else if (e === 'crash') say('Rough contact: hull damaged, flight recovered at 250 m', 'warn', true);
  else if (e === 'gearup') say('Gear was up! Belly contact: flight recovered at 250 m', 'warn', true);
}
function launchToOrbit(v) {
  const s = v.surf;
  if ((v.kind === 'plane' || v.model.rover) && v.stance !== 'vertical') return say(v.kind === 'plane' ? 'Stand the plane up first (T)' : 'Stand the rover up first (T)', 'warn');
  if (v.dep.panels > 0.2 || v.dep.radiators > 0.2) { v.depT.panels = 0; v.depT.radiators = 0; say('Retracting panels/radiators for vertical launch', 'warn'); }
  if (!v.hasProp()) return say('No propellant: refine some (R) first', 'warn');
  s.ap = s.ap === 'ascent' ? null : 'ascent'; s.assist = true; s.apHeading = Math.PI / 2; s.landed = false;
  say(s.ap ? 'Ascent assist: climbing to orbit' : 'Ascent cancelled', 'info');
}
function tipRover(v) {      // PROSPECTOR: legs unfold, hull pivots down onto the six wheels; and back up for a vertical launch
  if (!v.surf.landed || v.stance === 'tipping') return;
  if (v.stance === 'vertical') { const tt = tipSpotTilt(v, surfEnv()); if (tt > 0.5) return say(`Ground too steep to tip down here (${(tt * 57.3).toFixed(0)} deg under the wheels): the rover would roll over. Lift off (Shift) and land on flatter ground (L)`, 'warn', true); v.tipT = 1; v.depT.panels = 0; v.depT.radiators = 0; say('Wheel legs unfolding: tipping the rover down onto its wheels...', 'info'); return; }
  const rv = v.rv; if (rv && (Math.abs(rv.speed) > 0.5 || rv.flipT)) return say(rv.flipT ? 'Right the rover first (R)' : 'Stop the rover before standing it up', 'warn');
  if (v.dep.drill > 0.05 || v.drilling) { v.depT.drill = 0; return say('Drill retracting: press T again', 'warn'); }
  if (v.dep.panels > 0.05 || v.dep.radiators > 0.05) { v.depT.panels = 0; v.depT.radiators = 0; return say('Panels and radiators retracting: press T again', 'warn'); }
  { const st = standSpotTilt(v, surfEnv()); if (st > 0.4) return say(`Slope too steep to stand up here (${(st * 57.3).toFixed(0)} deg under the tail pads): drive to flatter ground first`, 'warn', true); }
  v.sensorManual = false; v.depT.sensor = 0; v.tipT = 0; say('Standing the rover up for vertical launch (nose up, engines down)...', 'info');
}
function tipPlane(v) {
  if (v.model.rover && v.kind === 'lander') return tipRover(v);
  if (v.kind !== 'plane' || !v.surf.landed) return;
  if (v.stance === 'tipping') return;
  if (v.stance === 'vertical') { v.depT.panels = 0; v.tipT = 1; say('Landing gear tipping the plane down...', 'info'); }
  else { if (G.bikeOut) return say('Stow the bike first (B near the plane)', 'warn'); v.depT.ramp = 0; if (v.dep.ramp > 0.1) return say('Raise the ramp first (Y)', 'warn'); v.tipT = 0; say('Standing the plane up for vertical launch (nose up, engines down)...', 'info'); }
}
function rampToggle(v) {
  if (v.kind === 'lander' && v.model.rover) { if (v.stance !== 'flat') return say('Tip the rover down first (T)', 'warn'); v.sensorManual = !v.sensorManual; return say(v.sensorManual ? 'Sensor mast raised: ground survey on' : 'Sensor mast stowed (it rises by itself when driving)', 'info'); }
  if (v.kind !== 'plane') return;
  if (v.stance !== 'flat') return say('Tip the plane to horizontal before using the ramp (T)', 'warn');
  v.depT.ramp = v.depT.ramp > 0.5 ? 0 : 1; say(v.depT.ramp ? 'Cargo ramp lowering' : 'Cargo ramp closing', 'info');
}
function checkBodyEvents() { }

function dustBurst(p, speed, size) {
  const gh = terrain.h(p.x, p.z);
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * 6.283, sp = speed * (0.4 + Math.random());
    particles.emit(p.x, gh + 0.3, p.z, Math.cos(a) * sp, 0.8 + Math.random() * 2.5, Math.sin(a) * sp, size * (0.6 + Math.random()), size * 2, 3 + Math.random() * 3, 0.82, 0.72, 0.58, 0.5);
  }
}
const _tip = new V3();
function emitVapor(v, dt) {       // wingtip vapour at high angle of attack / load, plus a dust wake on the runway
  const s = v.surf, sp = s.vel.length(); if (sp < 30) return;
  const rho = K.atmosphere ? density(K.id, s.p.y) : 0;
  const load = clamp(((s.aoa || 0) - 0.08) / 0.12, 0, 1) * clamp(sp / 90, 0, 1) * clamp(rho / 0.3, 0, 1);
  if (load > 0.05 && !s.onGround) {
    for (const sx of [-1, 1]) {
      if (Math.random() > load * 1.4) continue;
      _tip.set(sx * 7.3, 2.7, 4.8); M.plane.rig.localToWorld(_tip);
      particles.emit(_tip.x, _tip.y, _tip.z, -s.vel.x * 0.04 + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, -s.vel.z * 0.04 + (Math.random() - 0.5) * 2, 0.7 + load, 5 + 5 * load, 1.1 + load, 0.96, 0.98, 1.0, 0.28 * load + 0.06);
    }
  }
  if (s.onGround && sp > 12) { const gh = terrain.h(s.p.x, s.p.z); for (let i = 0; i < 2; i++) particles.emit(s.p.x + (Math.random() - 0.5) * 8, gh + 0.3, s.p.z + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 3, 1.5, 3.5, 2 + Math.random(), 0.45, 0.5, 0.3, 0.12); }
}
function emitFlightDust(v, dt) {
  const s = v.surf; if (s.thrustFrac < 0.03) return;
  const gh = terrain.h(s.p.x, s.p.z); const alt = s.p.y - gh;
  if (alt > 40) return;
  const k = (1 - alt / 40) * s.thrustFrac;
  const n = Math.round(14 * k * dt * 60 / 30) + (Math.random() < k * 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, sp = (6 + Math.random() * 16) * (0.4 + k);
    particles.emit(s.p.x + Math.cos(a) * 2, gh + 0.4, s.p.z + Math.sin(a) * 2, Math.cos(a) * sp, 0.6 + Math.random() * 3, Math.sin(a) * sp, 3.5 + Math.random() * 3, 7, 3 + Math.random() * 3.5, 0.84, 0.74, 0.6, 0.38 * k + 0.1);
  }
  // exhaust sparks
  if (Math.random() < 0.6) particles.emit(s.p.x, s.p.y + 0.5, s.p.z, (Math.random() - 0.5) * 3, -6 - Math.random() * 6, (Math.random() - 0.5) * 3, 0.5, -0.3, 0.5, 1, 0.6, 0.3, 0.8, 1);
}

// on foot ------------------------------------------------------------
function updateOnFoot(dt) {
  const free = !G.uiOpen;
  const inp = { fx: free ? input.axis('KeyA', 'KeyD') : 0, fz: free ? input.axis('KeyS', 'KeyW') : 0, run: free && input.down('ShiftLeft'), jump: free && input.hit('Space'), jumpHeld: free && input.down('Space') };
  if (free) {
    if (input.locked || input.drag) G.cam.yaw += input.mouseDX * 0.0028;
    if (input.locked || input.drag) G.cam.pitch = clamp(G.cam.pitch + input.mouseDY * 0.0026, -0.6, 1.3);
    if (input.wheel) G.cam.dist = clamp(G.cam.dist * (input.wheel > 0 ? 1.12 : 1 / 1.12), 1.8, 16);
  }
  player.update(dt, inp, G.cam.yaw, surfEnv());
  if (!player.onGround && player.boosting) for (let i = 0; i < 2; i++) particles.emit(player.p.x + (Math.random() - 0.5) * 0.3, player.p.y + 0.9, player.p.z + 0.2, (Math.random() - 0.5), -2.5, (Math.random() - 0.5), 0.25, -0.1, 0.5, 1, 0.8, 0.5, 0.8, 1);
  if (player.onGround && player.speed > 3.6 && Math.random() < 0.5) particles.emit(player.p.x, player.p.y + 0.1, player.p.z, -player.vel.x * 0.2, 0.5, -player.vel.z * 0.2, 0.5, 0.8, 1.4, 0.82, 0.72, 0.58, 0.35);
  // vehicles / craft interaction
  const near = nearestVessel(player.p, 17);
  const dBike = G.bikeOut ? Math.hypot(bike.p.x - player.p.x, bike.p.z - player.p.z) : 1e9;
  if (free) {
    if (input.hit('KeyE')) { if (dBike < 4.5) { mountBike(); } else if (skiffNear()) boardSkiff(); else if (near) enterCraft(near); }      // AETHEL: skiff
    if (input.hit('KeyU')) { if (near && near.kind === 'plane') deploySkiff(near); else if (skiffNear()) boardSkiff(); }
    if (input.hit('KeyB')) { if (near && near.kind === 'plane') deployBike(near); else if (G.bikeOut && dBike < 25) { const p = world.plane; if (p.status === 'surface') stowBike(p); } else say('Stand near the spaceplane with its ramp down (T, Y first)', 'info'); }
    if (input.hit('KeyG')) doHarvest();
    if (input.hit('KeyF') && !(near && near.model.rover)) doScan(player.p.x, player.p.z);
    if (input.hit('KeyR')) { if (near) doRefine(near); else say('Stand next to a craft to refine', 'info'); }
    if (input.hit('KeyV')) { if (near && (near.kind === 'plane' || near.model.rover)) doDrill(near); }
    if (input.hit('KeyT') && near && (near.kind === 'plane' || near.model.rover)) { G.sv = near; tipPlane(near); }
    if (input.hit('KeyY') && near && near.kind === 'plane') { rampToggle(near); }
    if (input.hit('KeyP') && near) toggleDeploy('panels', near); if (input.hit('KeyK') && near) toggleDeploy('radiators', near);
    if (input.hit('KeyF') && near && near.model.rover) { const c = vesselPlacePos(near); doScan(c.x, c.z, 1100, 150); }
  }
  tickWorkers(dt, player.p);
  world.advance(dt, null);
  for (const o of surfaceVessels()) { restCraft(o, dt, true); craftSystems(o, dt); }
  stepBikeParked(dt);
  G.near = near; G.dBike = dBike;
}
function stepBikeParked(dt) {
  if (!G.bikeOut || G.riding || G.interior) return;
  const steps = Math.max(1, Math.ceil(dt * 180)), env = surfEnv();
  for (let i = 0; i < steps; i++) bike.step(dt / steps, { thr: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, brake: 1, wheelie: false }, env);
  bike.applyModel(null);
}
function tickWorkers(dt, pos) {
  if (G.harvest) {
    G.harvest.t += dt;
    if (Math.random() < 0.8) particles.emit(player.p.x + Math.sin(player.yaw) * 0.7, player.p.y + 0.15, player.p.z - Math.cos(player.yaw) * 0.7, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.35, 0.6, 1.5, G.harvest.smp.kind === 'ice' ? 0.7 : 0.85, G.harvest.smp.kind === 'ice' ? 0.85 : 0.74, G.harvest.smp.kind === 'ice' ? 1 : 0.6, 0.6);
    if (G.harvest.t >= G.harvest.dur) {
      const s = G.harvest.smp; if (s.kind === 'ice') inventory.ice += s.amount; else if (s.kind === 'spore') inventory.spores = (inventory.spores || 0) + 1; else inventory.regolith += s.amount; inventory.samples++;
      say(s.kind === 'spore' ? '+1 spore pod (organic feedstock)' : `+${s.amount} kg ${s.kind === 'ice' && K.id !== 'kestrel' && !RECIPES[K.id].ICE ? 'water' : s.kind}`, 'ok'); G.harvest = null;
    }
    if (player.speed > 2.5) { G.harvest = null; say('Sampling interrupted', 'warn'); }
  }
  if (G.refine) {
    G.refine.t += dt; const v = G.refine.v;
    if (!v.refining) G.refine = null;
    else if (G.refine.t >= G.refine.dur) { const r = refineInto(v, inventory); v.refining = 0; say(r.msg, r.ok ? 'ok' : 'warn'); G.refine = null; }
  }
  if (G.drill) {
    const v = G.drill.v;
    if (G.drill.wait) { if (v.dep.drill >= 0.97) G.drill.wait = false; } else G.drill.t += dt;      // PROSPECTOR: the clock starts when the bit is in the ground
    if (!v.drilling) { G.drill = null; if (v.depT) v.depT.drill = 0; }
    else if (G.drill.rover && !G.drill.wait && G.drill.t >= G.drill.dur) {
      const rc = RECIPES[K.id], rv = v.rv, ox = terrain.origin.x, oz = terrain.origin.z;
      const smp = sampleAt(rc, ox, oz, rv.cx, rv.cz), rich = richnessAt(rc, rv.cx + ox, rv.cz + oz), amt = drillYield(smp, rich);
      if (smp.kind === 'ice') inventory.ice += amt; else inventory.regolith += amt; inventory.samples++; v.drilling = 0; v.depT.drill = 0;
      say(`Core sample: ${amt} kg ${smp.kind === 'ice' && K.id !== 'kestrel' && !RECIPES[K.id].ICE ? 'water' : smp.kind} (ground richness ${Math.round(rich * 100)}%)`, 'ok', true); G.drill = null;
    }
    else if (!G.drill.rover && G.drill.t >= G.drill.dur) { const smp = sampleAt(RECIPES[K.id], terrain.origin.x, terrain.origin.z, v.surf.p.x, v.surf.p.z); const amt = smp.amount * 3; if (smp.kind === 'ice') inventory.ice += amt; else inventory.regolith += amt; inventory.samples++; v.drilling = 0; say(`Drill brought up ${amt} kg ${smp.kind}`, 'ok'); G.drill = null; }
  }
}

// bike ------------------------------------------------------------------
const ctlB = { thr: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, brake: 0, wheelie: false, boost: false };
function updateBike(dt) {
  const free = !G.uiOpen;
  const k = (c) => free && input.down(c);
  ctlB.thr = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 0.0 : 0) ; ctlB.brake = k('KeyS') || k('Space') ? 1 : 0;
  if (k('KeyS') && bike.v.dot(bike.forward) < 1.0) ctlB.thr = -0.6;
  ctlB.steer = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + ((k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0));
  ctlB.pitch = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  ctlB.roll = ctlB.steer; ctlB.yaw = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
  ctlB.wheelie = k('KeyQ'); ctlB.boost = k('ShiftLeft') || k('ShiftRight');
  { const wdp = RECIPES[K.id].waterDepth ? RECIPES[K.id].waterDepth(bike.p.x + terrain.origin.x, bike.p.z + terrain.origin.z) : 0; G.bikeWater = wdp;
    if (wdp > 0.85) { ctlB.thr = Math.min(ctlB.thr, 0) * 0.5; ctlB.boost = false; bike.v.multiplyScalar(Math.pow(0.12, dt)); if (!G.stallToast || G.time - G.stallToast > 6) { G.stallToast = G.time; say('The bike stalls in deep water: back out slowly (S) or dismount (E)', 'warn'); } }
    else if (wdp > 0.35) { ctlB.thr *= 0.6; bike.v.multiplyScalar(Math.pow(0.5, dt)); } }
  if (ctlB.brake && ctlB.thr < 0) ctlB.brake = 0;
  if (free) {
    if (input.hit('KeyR')) bike.respawn(surfEnv());
    if (input.hit('KeyE') && bike.speed < 5 && bike.grounded > 0) dismountBike();
    if (input.wheel) G.cam.dist = clamp(G.cam.dist * (input.wheel > 0 ? 1.12 : 1 / 1.12), 3, 30);
    if (input.drag) { G.cam.off -= input.mouseDX * 0.005; G.cam.pitch = clamp(G.cam.pitch + input.mouseDY * 0.004, -0.2, 1.2); }
  }
  if (!input.drag) G.cam.off *= Math.pow(0.3, dt);
  const env = surfEnv();
  const sub = Math.max(1, Math.ceil(dt * 180));
  for (let i = 0; i < sub; i++) bike.step(dt / sub, ctlB, env);
  bike.applyModel(G.riding ? M.astro : null, dt);
  for (const e of bike.events) {
    if (e.type === 'land') {
      if (e.air > 2.5) { say(`AIR ${e.air.toFixed(1)} s${e.air >= bike.best - 1e-6 ? '  (best!)' : ''}`, 'ok', true); }
      for (const w of bike.wheels) for (let i = 0; i < 26; i++) { const a2 = Math.random() * 6.283, sp2 = (2 + Math.random() * 6) * Math.min(1.6, 0.6 + e.air * 0.12); particles.emit(w.pt.x, w.pt.y + 0.2, w.pt.z, Math.cos(a2) * sp2 + bike.v.x * 0.3, 1.2 + Math.random() * 3.2, Math.sin(a2) * sp2 + bike.v.z * 0.3, 1.1 + Math.random() * 1.4, 3.5, 4 + Math.random() * 3, 0.88, 0.8, 0.68, 0.55); }
    } else if (e.type === 'crash') say('Wipe-out! Respawning upright...', 'warn');
    else if (e.type === 'respawn') say('Back on the bike', 'info');
  }
  // rooster-tail dust from the rear tyre: ballistic arcs (low g = slow, long, high)
  if (bike.speed > 2.5) {
    const w = bike.wheels[1]; const fwd = bike.forward.clone(); const sp = bike.speed;
    if (w.contact) {
      const n = Math.min(9, Math.round(2 + sp * 0.3)) * (dt * 60 > 1.5 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const spread = 1.2 + sp * 0.04;
        particles.emit(w.pt.x, w.pt.y + 0.12, w.pt.z,
          bike.v.x * 0.38 - fwd.x * sp * 0.22 + (Math.random() - 0.5) * spread, 1.6 + Math.random() * 1.8 + sp * 0.1, bike.v.z * 0.38 - fwd.z * sp * 0.22 + (Math.random() - 0.5) * spread,
          0.9 + Math.random() * 0.9, 2.6 + sp * 0.05, 4 + Math.random() * 2.5, 0.88, 0.8, 0.68, 0.5);
      }
    }
    const f = bike.wheels[0]; if (f.contact && sp > 6 && Math.random() < 0.5) particles.emit(f.pt.x, f.pt.y + 0.1, f.pt.z, bike.v.x * 0.2 + (Math.random() - 0.5), 0.8 + Math.random(), bike.v.z * 0.2 + (Math.random() - 0.5), 0.5, 1.2, 2.5, 0.88, 0.8, 0.68, 0.35);
  }
  world.advance(dt, null);
  for (const o of surfaceVessels()) { restCraft(o, dt, true, true); craftSystems(o, dt); }
}

// ================================================================== AETHEL (hollow world): skiff, gate transitions, interior frame ==================
// Exterior gates: a glowing hatch at the bottom of each funnel crater (terrain/aethel.js). The Wisp skiff (skiff.js) is carried in the spaceplane's bay
// (U on the ground), flown over a hatch and dived into it: a short fade swaps the exterior world for the interior world ('aethelin', a concave local
// scene, see aethelinterior.js) and back the same way. Only the skiff goes through (the plane stays on the rim).
let INT = null; const interior = () => INT || (INT = new AE.Interior());
let gateDisc = null;
const aeLights = { sun: new V3(0, 1, 0), giant: null };
const _g0 = { x: 0, z: 0, d: 0 };
const _sk = { fwd: 0, turn: 0, strafe: 0, climb: 0, boost: false };
function skiffEnv() {
  const e = surfEnv(), h0 = e.h, o = terrain.origin;
  const inHole = G.interior ? (x, z) => Math.hypot(x + o.x, z + o.z) < AE.GATE_R : (x, z) => aethel.nearestGate(x + o.x, z + o.z, _g0).d < AE.GATE_R;
  e.h = (x, z) => (inHole(x, z) ? (G.interior || G.aeReady ? -1e5 : aethel.FLOOR + 30) : h0(x, z));      // the hatch is solid glass until the interior has been streamed in
  return e;
}
// stream the interior terrain around the window while the skiff is near a hatch (so the swap shows a built world, like the 48 km pre-warm of the 14 km handover)
function prewarmInterior() {
  const w = SW.aethelin || (SW.aethelin = makeWorld('aethelin'));
  if (!w.warmed) { w.terrain.setOrigin(0, 0); w.warmed = true; }
  const st = AE.enterState(skiff.p, skiff.v, skiff.yaw, terrain.origin);
  w.terrain.update(new V3(st.p.x, 100, st.p.z));
  return w.terrain.pending < 25;
}
function aethelFrame(cam) {
  // fast skiff flight: fewer, cheaper streaming updates (smaller vegetation radius, coarser terrain LOD, at most 1-2 finished chunks turned into meshes per frame)
  if (K.id === 'aethel' || K.interior) { const fast = G.mode === 'skiff' ? clamp((skiff.speed - 45) / 130, 0, 1) : 0; terrain.msgCap = fast > 0.6 ? 1 : fast > 0 ? 2 : 0; if (K.interior) terrain.split = 1.9 - 0.8 * fast; if (veg) veg.rk = 1 - 0.6 * fast; }
  if (G.interior) {
    const I = interior(); if (!I.active) I.attach(sceneS, true);
    if (gateDisc) gateDisc.group.visible = false;
    I.update(cam.position, terrain.origin, world.t);
    I.lights(aethelin.WORLD); aeLights.sun.copy(I.sunDir); atmU.uATime.value = G.time; sky.mesh.visible = false;
    if (water) water.setLight(I.col1, 0.32);
    gfx.finalPass.uniforms.uVig.value = 0.62;
    particles.light.value.set(1, 0.95, 0.86).multiplyScalar(1.0);
  } else {
    sky.mesh.visible = true; gfx.finalPass.uniforms.uVig.value = 0.42;
    if (INT && INT.active) INT.attach(sceneS, false);
    if (K.id === 'aethel') { gateDisc = gateDisc || new AE.GateDisc(); if (gateDisc.group.parent !== sceneS) sceneS.add(gateDisc.group); gateDisc.update(cam.position, terrain.origin, G.time); }
    else if (gateDisc) gateDisc.off();
  }
}
function skiffNear() { return skiff.out && skiff.world === K.id && Math.hypot(skiff.p.x - player.p.x, skiff.p.z - player.p.z) < 9; }
function deploySkiff(v) {
  if (K.id !== 'aethel') return say('The Wisp skiff is only rated for Aethel', 'info');
  if (skiff.out) {
    const s = v && v.surf; const d = s ? Math.hypot(skiff.p.x - s.p.x, skiff.p.z - s.p.z) : 1e9;
    if (!skiff.landed || d > 60) return say(d > 60 ? 'Bring the skiff within 60 m of the plane to stow it' : 'Land the skiff first', 'warn');
    skiff.out = false; skiff.group.visible = false; return say('Skiff stowed in the belly bay', 'info');
  }
  if (!v || v.status !== 'surface' || !v.surf.landed) return say('Land the spaceplane first, then deploy the skiff (U)', 'warn');
  const s = v.surf, hd = s.heading, pr = padRef(v);
  const x = pr.x + Math.cos(hd) * 15, z = pr.z + Math.sin(hd) * 15;
  skiff.out = true; skiff.world = K.id; skiff.place(x, terrain.h(x, z) + 1.2, z, hd); sceneS.add(skiff.group); skiff.applyModel(0, G.time);
  say('Skiff deployed beside the plane. Walk over (E) and board; the gate is the glowing circle at the bottom of the crater', 'ok');
}
function boardSkiff() {
  G.mode = 'skiff'; M.astro.group.visible = false; G.cam.pitch = 0.2; G.cam.dist = 16; G.cam.off = 0; G.camInit = null;
  say('Skiff: W/S speed, A/D turn, Q/E strafe, Shift/Ctrl climb, Space boost. Dive into the glowing gate to enter Aethel', 'info');
}
function exitSkiff() {
  if (!skiff.landed) return say('Land the skiff first (Ctrl to descend)', 'warn');
  const side = new V3(Math.cos(skiff.yaw), 0, Math.sin(skiff.yaw)), x = skiff.p.x + side.x * 4.5, z = skiff.p.z + side.z * 4.5;
  player.place(x, terrain.h(x, z), z, skiff.yaw + Math.PI / 2); M.astro.group.visible = true; sceneS.add(M.astro.group);
  G.mode = 'onfoot'; G.cam.yaw = skiff.yaw + 0.6; G.cam.pitch = 0.2; G.cam.dist = 5; G.camInit = null;
  say('Outside the skiff. E near it to board again', 'info');
}
function updateSkiff(dt) {
  const free = !G.uiOpen, k = (c) => free && input.down(c);
  _sk.fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0); _sk.turn = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0); _sk.strafe = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
  _sk.climb = ((k('ShiftLeft') || k('ShiftRight')) ? 1 : 0) - ((k('ControlLeft') || k('ControlRight')) ? 1 : 0); _sk.boost = k('Space');
  if (free) {
    if (input.hit('KeyU')) exitSkiff();
    if (input.hit('KeyF')) doScan(skiff.p.x, skiff.p.z);
    if (input.wheel) G.cam.dist = clamp(G.cam.dist * (input.wheel > 0 ? 1.12 : 1 / 1.12), 7, 80);
    if (input.drag && (input.mouseDX || input.mouseDY)) { G.cam.off -= input.mouseDX * 0.006; G.cam.pitch = clamp(G.cam.pitch + input.mouseDY * 0.005, -0.3, 1.3); }
  }
  if (!input.drag) G.cam.off *= Math.pow(0.4, dt);
  const env = skiffEnv();
  skiff.step(dt * 0.5, _sk, env); skiff.step(dt * 0.5, _sk, env);
  for (const e of skiff.events) if (e === 'thud') say('Skid scrape', 'warn');
  world.advance(dt, null);
  // dust under the repulsors
  if (!skiff.landed && skiff.agl < 24 && skiff.agl > 0.5 && Math.random() < 0.7) { const gh = terrain.h(skiff.p.x, skiff.p.z), a = Math.random() * 6.283; particles.emit(skiff.p.x + Math.cos(a) * 1.5, gh + 0.3, skiff.p.z + Math.sin(a) * 1.5, Math.cos(a) * 6, 0.6 + Math.random() * 2, Math.sin(a) * 6, 1.4, 4, 2.2, G.interior ? 0.55 : 0.6, G.interior ? 0.62 : 0.66, 0.5, 0.25 * (1 - skiff.agl / 24)); }
  if (!G.interior) {
    const gd = aethel.nearestGate(skiff.p.x + terrain.origin.x, skiff.p.z + terrain.origin.z, _g0).d;
    G.aeReady = K.id === 'aethel' && gd < 9000 && skiff.p.y < aethel.FLOOR + 2500 ? prewarmInterior() : false;
    if (!G.aeReady && gd < AE.GATE_R && skiff.p.y < aethel.FLOOR + 80 && G.time - (G.aeSyncMsg || -99) > 6) { G.aeSyncMsg = G.time; say('Gate field syncing: hold position over the hatch', 'info'); }
  }
  if (!G.fadeState) {
    if (!G.interior) { if (G.aeReady && skiff.p.y < aethel.FLOOR + 70 && AE.overHatch(skiff.p, terrain.origin)) transition(enterInterior); }
    else if (skiff.p.y < 55 && Math.hypot(skiff.p.x, skiff.p.z) < AE.GATE_R - 100) transition(exitInterior);
  }
}
function enterInterior() {
  const st = AE.enterState(skiff.p, skiff.v, skiff.yaw, terrain.origin);
  G.aeGate = st.gate;
  for (const v of world.vessels) if (v.model.group.parent === sceneS) sceneS.remove(v.model.group);
  M.bike.group.visible = false;
  activateWorld('aethelin'); if (SW.aethelin.warmed) G.descentOrigin = true; else setWorldOrigin(0, 0);
  skiff.world = 'aethelin'; skiff.p.copy(st.p); skiff.v.copy(st.v); skiff.yaw = st.yaw; skiff.holdY = st.p.y; skiff.landed = false;
  G.camInit = null; G.cam.dist = 16; G.cam.off = 0;
  say('Inside Aethel. Gravity points at the wall in every direction; the small sun hangs above the middle of the world', 'ok', true);
}
function exitInterior() {
  activateWorld('aethel'); G.descentOrigin = true;
  const st = AE.exitState(skiff.p, skiff.v, skiff.yaw, G.aeGate || { x: 0, z: 0 }, terrain.origin);
  if (G.bikeOut) M.bike.group.visible = true;
  skiff.world = 'aethel'; skiff.p.copy(st.p); skiff.v.copy(st.v); skiff.yaw = st.yaw; skiff.holdY = st.p.y; skiff.landed = false;
  G.camInit = null; G.cam.dist = 16; G.cam.off = 0;
  say('Back on the outer shell', 'info');
}
// debug: put the skiff at local (x, z) in the current world, height alt over the ground, and board it
function skiffTo(x, z, alt = 40, yaw = 0, board = true) {
  skiff.out = true; skiff.world = K.id; skiff.place(x, terrain.h(x, z) + alt, z, yaw); skiff.landed = alt < 2; sceneS.add(skiff.group); skiff.applyModel(0, G.time);
  if (board) { G.mode = 'skiff'; M.astro.group.visible = false; G.camInit = null; G.cam.dist = 16; G.cam.pitch = 0.2; G.cam.off = 0; }
}
// ================================================================== /AETHEL ==================

// ------------------------------------------------------------------ camera
const camTarget = new V3(), camDesired = new V3();
let bikeCamHeading = 0;
function orbitBasis() {
  const v = world.active.docked ? world.carrier : world.active;
  const r = v.r.clone(); if (r.lengthSq() < 1) r.set(1, 0, 0);
  const { lon, lat } = lonLatOfDir(r.normalize());
  return enu(lon, lat);
}
function updateCamera(dt, origin) {
  const cam = gfx.camera, c = G.cam;
  if (G.mode === 'orbit') {
    const v = world.active;
    const rel = v.docked ? world.carrier.r.clone().sub(origin) : v.r.clone().sub(origin);
    camTarget.copy(rel);
    // keep the vessel centred: the scene origin is the reference vessel
    const d = c.dist * (v.docked ? 1 : 1);
    const lb = orbitBasis();
    camDesired.set(0, 0, 0).addScaledVector(lb.E, Math.sin(c.yaw) * Math.cos(c.pitch)).addScaledVector(lb.N, Math.cos(c.yaw) * Math.cos(c.pitch)).addScaledVector(lb.U, Math.sin(c.pitch)).multiplyScalar(d).add(camTarget);
    cam.position.copy(camDesired); cam.up.copy(lb.U); cam.lookAt(camTarget);
  } else if (G.camFree) {           // debug / photography: free camera in scene-local coordinates
    const f = G.camFree; cam.position.set(f.x, f.y, f.z); cam.up.set(0, 1, 0); cam.lookAt(f.tx, f.ty, f.tz); camTarget.set(f.tx, f.ty, f.tz); G.camYaw = Math.atan2(f.tx - f.x, -(f.tz - f.z));
  } else if (G.mode === 'bike') {
    const targetY = bike.p.y + 0.9;
    if (G.camInit !== 'bike') {
      bikeCamHeading = bike.yaw;
      camTarget.y = targetY;
      G.camInit = 'bike';
    } else if (bike.grounded && !bike.crashed && Math.hypot(bike.v.x, bike.v.z) > 1) {
      const forward = bike.forward;
      const reversing = bike.v.x * forward.x + bike.v.z * forward.z < 0;
      const track = Math.atan2(bike.v.x, -bike.v.z) + (reversing ? Math.PI : 0);
      const delta = track - bikeCamHeading;
      const turn = Math.atan2(Math.sin(delta), Math.cos(delta)) * -Math.expm1(-3 * dt);
      bikeCamHeading += clamp(turn, -1.6 * dt, 1.6 * dt);
    }
    // Move horizontally with the rider and absorb suspension motion at a shared camera pivot.
    camTarget.x = bike.p.x; camTarget.z = bike.p.z;
    camTarget.y += (targetY - camTarget.y) * -Math.expm1(-6 * dt);
    const yaw = bikeCamHeading + Math.PI + c.off;
    cam.position.set(Math.sin(yaw) * Math.cos(c.pitch), Math.sin(c.pitch), -Math.cos(yaw) * Math.cos(c.pitch))
      .multiplyScalar(c.dist).add(camTarget);
    cam.position.y = Math.max(cam.position.y, terrain.h(cam.position.x, cam.position.z) + 1);
    cam.up.set(0, 1, 0); cam.lookAt(camTarget); G.camYaw = yaw;
  } else {
    let tgt, yaw, dist = c.dist, pitch = c.pitch;
    if (G.mode === 'flight') {
      const s = G.sv.surf, v = G.sv; tgt = s.p.clone();
      if (v.kind === 'plane' && s.aero) {
        // chase camera: behind the flight path, smoothed, pitching a little with the climb; closer + lower when fast and low
        const sp = s.vel.length(); const trk = Math.hypot(s.vel.x, s.vel.z) > 12 ? Math.atan2(s.vel.x, -s.vel.z) : s.heading;
        if (G.aeroYaw === undefined) G.aeroYaw = trk; let dy = trk - G.aeroYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); G.aeroYaw += dy * Math.min(1, dt * 2.4);
        const gm = sp > 5 ? Math.asin(clamp(s.vel.y / sp, -1, 1)) : 0;
        tgt.y += 2.4 + 0.0; yaw = G.aeroYaw + Math.PI + c.off; dist = c.dist * (1 + 0.12 * clamp(sp / 150, 0, 1)); pitch = clamp(c.pitch * 0.55 - gm * 0.6 + 0.06, -0.2, 0.9);
      } else {
      if (v.kind === 'plane') { const cp = vesselPlacePos(v); tgt.copy(cp); tgt.y = s.p.y + 3 + 6 * (1 - v.tip); }
      else if (v.kind === 'lander' && v.model.rover) { const cp = vesselPlacePos(v); tgt.copy(cp); tgt.y = (v.stance === 'flat' && v.rv ? v.rv.cy : s.p.y) + 2.2 + 3.4 * (1 - v.tip); }      // PROSPECTOR
      else tgt.y += 3.2;
      yaw = s.heading + Math.PI + c.off; dist = c.dist; }
    } else if (G.mode === 'onfoot') { tgt = player.p.clone(); tgt.y += 1.5; yaw = c.yaw + Math.PI; }
    else if (G.mode === 'skiff') { tgt = skiff.p.clone(); tgt.y += 1.3; yaw = skiff.yaw + Math.PI + c.off; dist = c.dist; }      // AETHEL
    // smooth follow
    const d = new V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    // yaw convention: camera sits behind (opposite the heading vector (sin h, -cos h))
    const wantPos = tgt.clone().add(new V3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist));
    // convert: heading h faces (sin h, -cos h); behind = -(that) = (-sin h, cos h) -> yaw = h + PI gives (sin(h+PI), -cos(h+PI)) = (-sin h, cos h) as required
    const gh = terrain.h(wantPos.x, wantPos.z);
    if (wantPos.y < gh + 1.0) wantPos.y = gh + 1.0;
    if (G.camInit !== G.mode) { cam.position.copy(wantPos); G.camInit = G.mode; }
    cam.position.lerp(wantPos, 1 - Math.pow(G.mode === 'skiff' ? 1e-6 : 0.002, dt));
    camTarget.lerp(tgt, 1 - Math.pow(G.mode === 'skiff' ? 1e-7 : 0.0001, dt));
    if (G.camInit === G.mode && camTarget.distanceTo(tgt) > 50) camTarget.copy(tgt);
    cam.up.set(0, 1, 0); cam.lookAt(camTarget);
    G.camYaw = yaw;
  }
}

// ------------------------------------------------------------------ HUD
function fmtM(m) { return Math.abs(m) >= 10000 ? (m / 1000).toFixed(1) + ' km' : m.toFixed(0) + ' m'; }
function updateHud(dt) {
  const v = world.active, mode = G.mode;
  const prompts = [];
  hud.mode(modeLabel(), subLabel());
  let flags = [];
  let rows, dvText = '-';
  if (mode === 'orbit') {
    const b = BODIES[v.body]; const alt = b ? world.altitude(v) : 0; const sp = v.v.length(); const el = v.el;
    rows = [{ l: 'ALT', v: b ? fmtM(alt) : 'deep space' }, { l: 'SPEED', v: sp >= 10000 ? (sp / 1000).toFixed(2) + ' km/s' : sp.toFixed(0) + ' m/s' }, { l: el && !el.hyper ? 'AP/PE' : 'ECC', v: el ? (el.hyper ? 'hyper ' + el.e.toFixed(2) : `${fmtM(el.ra - (b?.R || 0))} / ${fmtM(el.rp - (b?.R || 0))}`) : '-' }];
    hud.air(world.t ? 'UT ' + fmtUT(world.t) + ' - warp ' + WARP[world.warpIndex] + 'x' : '');
    if (v.sas !== 'free') flags.push('SAS ' + v.sas.toUpperCase()); if (v.ap) flags.push(v.ap.type === 'descent' ? 'DESCENT ASSIST' : 'ASCENT ASSIST'); if (v.fxT > 0) flags.push('BURN'); if (v.nodes.length) flags.push('NODES ' + v.nodes.length);
    if (v.kind === 'plane') flags.push('ENG ' + v.engineId.toUpperCase());
    dvText = v.dvRemaining(world, {}).toFixed(0) + ' m/s' + (v.kind === 'carrier' ? '' : '');
    if (v.docked) prompts.push('U|Undock Albatross', 'I|Undock ' + world.lander.name);
    else if (v.kind === 'carrier') prompts.push('M|Open the map', 'U|Undock Albatross');
    else { prompts.push('G|Begin descent'); if ((!v.target || v.target === world.carrier || v.target.docked) && world.carrier.body === v.body) prompts.push('C|Dock with Wayfarer'); }
    if (v.target) {
      const host = v.target.docked ? world.carrier : v.target;
      const sameOrbit = v.body === host.body && host.status === 'orbit';
      rows[2] = { l: v.target.name, v: sameOrbit
        ? fmtM(v.r.distanceTo(host.r)) + ' · ' + v.v.distanceTo(host.v).toFixed(1) + ' m/s rel'
        : (BODIES[host.body]?.name || SUN.name) };
    }
    hud.bar('b-thr', v.thrCmd || 0, !v.docked && v.status === 'orbit', 'THR');
  } else if (mode === 'flight') {
    const s = v.surf;
    rows = [{ l: 'ALT', v: fmtM(s.alt) }, { l: 'V.SPD', v: s.vspeed.toFixed(1) + ' m/s' }, { l: 'H.SPD', v: s.hspeed.toFixed(1) + ' m/s' }];
    const rvOn = v.kind === 'lander' && v.model.rover && v.stance === 'flat' && v.rv;      // PROSPECTOR drive mode
    if (rvOn) { const rv = v.rv; rows = [{ l: 'SPEED', v: Math.abs(rv.speed).toFixed(1) + ' m/s' }, { l: 'SLOPE', v: (rv.tilt * 57.3).toFixed(0) + ' deg' }, { l: 'HEADING', v: ((((s.heading * 57.3) % 360) + 360) % 360).toFixed(0) + ' deg' }]; }
    if (s.aero) { const sp = s.vel.length(); rows = [{ l: 'AIRSPEED', v: sp.toFixed(0) + ' m/s' }, { l: 'ALT AGL', v: fmtM(s.alt) }, { l: 'V.SPD', v: s.vspeed.toFixed(1) + ' m/s' }]; }
    hud.air(rvOn ? (v.rv.flipT ? 'ROLLED OVER (R)' : v.drilling ? 'DRILLING' : v.refining ? 'REFINING' : 'ROVE MODE') : s.aero ? (s.landed ? 'ON THE GROUND' : `MACH ${(s.mach || 0).toFixed(2)}  AOA ${((s.aoa || 0) * 57.3).toFixed(0)} deg`) : (s.landed ? 'LANDED' : s.tilt ? '' : ''));
    if (s.aero) { if ((G.fwarp || 1) > 1) flags.push('TIME x' + G.fwarp); if (s.gear > 0.5) flags.push('GEAR'); if (s.stall) flags.push('STALL'); if (s.ap === 'aeroland') flags.push('LANDING ASSIST'); if (s.ap === 'aeroclimb' || s.ap === 'aerotakeoff' || s.ap === 'ascent') flags.push('AUTO CLIMB'); if (s.engine) flags.push('ENG ' + s.engine.toUpperCase()); if (s.track && s.ap === 'aeroland') flags.push(`RWY ${Math.round(-s.track.along)} m  X-TRK ${Math.round(s.track.cross)} m`); }
    if (s.assist) flags.push('ASSIST'); else flags.push('MANUAL'); if (s.ap === 'land') flags.push('AUTO-LAND'); if (s.ap === 'ascent' && !s.aero) flags.push('ASCENT');
    if ((v.kind === 'plane' && !s.aero) || (v.kind === 'lander' && v.model.rover && s.landed)) flags.push('STANCE ' + v.stance.toUpperCase());
    dvText = v.dvRemaining(world, { vtol: true }).toFixed(0) + ' m/s';
    if (s.landed) {
      if (K.id === 'aethel') prompts.push('U|' + (skiff.out ? 'Stow the skiff' : 'Deploy the skiff'));      // AETHEL
      prompts.push('E|Exit ' + v.name);
      if (v.kind === 'plane') { if (!s.aero) prompts.push(v.stance === 'vertical' ? 'T|Tip plane down' : v.stance === 'flat' ? 'T|Stand plane up (vertical launch)' : 'T|... tipping'); if (v.stance === 'flat') prompts.push('Y|' + (v.dep.ramp > 0.5 ? 'Raise' : 'Lower') + ' cargo ramp', 'B|' + (G.bikeOut ? 'Stow bike' : 'Deploy bike')); }
      if (v.model.rover && v.kind === 'lander') {      // PROSPECTOR
        if (v.stance === 'vertical') prompts.push('T|Tip down onto the wheels', 'O|Launch to orbit');
        else if (v.stance === 'tipping') prompts.push('T|... tipping');
        else if (v.rv && v.rv.flipT) prompts.push('R|Right the rover');
        else if (v.rv && Math.abs(v.rv.speed) > 0.4) prompts.push('W/S A/D|Drive', 'F|Scan (mast)');
        else prompts.push('V|Drill here', 'R|Refine', 'T|Stand up for launch');
      } else { prompts.push(s.aero ? 'O|Takeoff + climb to orbit' : 'O|Launch to orbit'); prompts.push('R|Refine propellant'); }
    } else if (s.aero) prompts.push('L|Runway landing assist', 'O|Climb to orbit'); else prompts.push('L|Auto-land', v.kind === 'plane' ? 'Space|Toggle descent hold' : 'Space|Toggle hover assist');
    hud.bar('b-thr', s.thrustFrac, true, 'THR');
  } else if (mode === 'onfoot') {
    rows = [{ l: 'SPEED', v: player.speed.toFixed(1) + ' m/s' }, { l: 'ALT', v: (player.p.y - terrain.h(player.p.x, player.p.z)).toFixed(1) + ' m' }];
    hud.air(player.boosting ? 'JETPACK' : '');
    const near = G.near;
    if (G.dBike < 4.5) prompts.push('E|Ride bike'); else if (skiffNear()) prompts.push('E|Board the skiff'); else if (near) prompts.push('E|Enter ' + near.name);
    if (near && near.kind === 'plane') { prompts.push('T|' + (near.stance === 'vertical' ? 'Tip plane down' : 'Stand plane up'), 'Y|Ramp', 'B|Bike', 'V|Drill'); }
    prompts.push('G|Sample ice / regolith', 'F|Scan for signals'); if (near) prompts.push('R|Refine at ' + near.name);
    hud.bar('b-fuel', player.fuel / 100, true, 'JET'); dvText = '-';
    if (G.harvest) prompts.unshift('|Sampling ' + Math.round(G.harvest.t / G.harvest.dur * 100) + '%');
  } else if (mode === 'skiff') {      // AETHEL
    rows = [{ l: 'ALT', v: skiff.agl > 1e4 ? 'open air' : fmtM(skiff.agl) }, { l: 'SPEED', v: skiff.speed.toFixed(0) + ' m/s' }, { l: 'V.SPD', v: skiff.v.y.toFixed(1) + ' m/s' }];
    hud.air(G.interior ? 'INSIDE AETHEL' : (aethel.nearestGate(skiff.p.x + terrain.origin.x, skiff.p.z + terrain.origin.z, _g0).d < 40000 ? 'GATE ' + fmtM(aethel.nearestGate(skiff.p.x + terrain.origin.x, skiff.p.z + terrain.origin.z, _g0).d) : ''));
    prompts.push(skiff.landed ? 'U|Leave the skiff' : 'Shift/Ctrl|Climb / descend', 'Space|Boost'); hud.bar('b-fuel', skiff.charge, true, 'CELL'); dvText = '-';
    flags.push('ASSIST'); if (skiff.boosting) flags.push('BOOST'); if (G.interior) flags.push('INTERIOR');
  } else {
    rows = [{ l: 'SPEED', v: (bike.speed * 3.6).toFixed(0) + ' km/h' }, { l: 'AIR', v: bike.air > 0.3 ? bike.air.toFixed(1) + ' s' : '-' }, { l: 'BEST', v: bike.best.toFixed(1) + ' s' }];
    hud.air(bike.alt > 1 && bike.air > 0.3 ? 'alt ' + bike.alt.toFixed(0) + ' m' : '');
    prompts.push('E|Dismount (slow)', 'R|Reset upright'); hud.bar('b-fuel', bike.boost / 100, true, 'BOOST');
    if (bike.crashed > 0) flags.push('WIPEOUT');
  }
  hud.gauges(rows); hud.dv(dvText);
  const showFuel = mode === 'orbit' || mode === 'flight';
  if (showFuel) {
    const t = v.tanks;
    if (v.kind === 'carrier') { hud.bar('b-fuel', v.propFraction('h2'), true, 'H2'); hud.bar('b-ox', 0, false); hud.bar('b-h2', 0, false); }
    else if (v.kind === 'lander') { hud.bar('b-fuel', v.propFraction('fuel'), true, 'CH4'); hud.bar('b-ox', v.propFraction('ox'), true, 'LOX'); hud.bar('b-h2', 0, false); }
    else { hud.bar('b-fuel', v.propFraction('fuel'), true, 'CH4'); hud.bar('b-ox', v.propFraction('ox'), true, 'LOX'); hud.bar('b-h2', v.propFraction('h2'), true, 'H2'); }
  } else { hud.bar('b-ox', 0, false); hud.bar('b-h2', 0, false); if (mode === 'bike' || mode === 'onfoot') { /* fuel bar used as boost/jet */ } hud.bar('b-thr', 0, false); }
  const sysOf = (c) => c && c.kind === 'lander' && c.model.rover;
  const pl = (mode === 'flight' && sysOf(v)) ? v : (mode === 'onfoot' && sysOf(G.near)) ? G.near : world.plane;      // PROSPECTOR: the power / heat bars follow the rover when it is the craft in use
  const showPlane = (mode === 'orbit' && v.kind === 'plane') || (mode === 'flight' && (v.kind === 'plane' || (sysOf(v) && v.status === 'surface'))) || (mode === 'onfoot' && G.near && (G.near.kind === 'plane' || sysOf(G.near)));
  hud.bar('b-pwr', pl.sysBatt / pl.spec.battery, showPlane, 'PWR'); hud.bar('b-heat', pl.heat / pl.spec.heatCap, showPlane, 'HEAT');
  if (showPlane) { if (pl.dep.panels > 0.5) flags.push('PANELS'); if (pl.dep.radiators > 0.5) flags.push('RADIATORS'); if (pl.overheat) flags.push('OVERHEAT'); if (pl.drilling) flags.push('DRILL'); if (pl.refining) flags.push('ISRU'); }
  { const rvv = mode === 'flight' && sysOf(v) && v.stance === 'flat' && v.rv ? v : null; hud.survey(rvv ? surveyView(rvv) : null); }      // PROSPECTOR: ground-survey readout
  { const hot = (mode === 'orbit' || mode === 'flight') && (v.glow > 0.01 || v.skinT > 420); hud.bar('b-skin', v.heatFrac, hot, `SKIN ${v.skinT.toFixed(0)}K  ${Math.round(Math.max(0, v.heatFrac) * 100)}%`); if (hot && v.heatFrac > 1) flags.push('HULL DAMAGE'); else if (hot && v.heatFrac > 0.8) flags.push('REENTRY HOT'); else if (hot && v.glow > 0.05) flags.push('REENTRY'); }
  if (G.suit && (mode === 'onfoot' || mode === 'bike') && RECIPES[K.id].heatAt) {          // PYRA: suit temperature reuses the SKIN bar
    hud.bar('b-skin', G.suit.t, true, `SUIT ${suitCelsius(G.suit.t)} C`);
    if (G.suit.t > 0.55) flags.push(G.suit.t > 0.85 ? 'SUIT OVERHEATING' : 'HEAT WARNING');
  }
  { const lz = mode === 'flight' && G.sv.surf.site; if (lz) flags.push(`LZ ${fmtM(lz.dist || lz.d)}`); }
  hud.flags(flags);
  hud.prompts(G.uiOpen ? [] : prompts.slice(0, 2));
  hud.inv(`Ice ${inventory.ice.toFixed(0)} kg   Regolith ${inventory.regolith.toFixed(0)} kg   ` + (eco ? `Spores ${inventory.spores || 0}   Species ${eco.known.size}/${SURVEY_TOTAL}   ` : '') + `Discoveries ${disc.journal.filter((e) => e.type !== 'bio').length}`);
  buttons(v);
  // compass
  if (mode !== 'orbit') {
    const heading = Math.atan2(-Math.sin(G.camYaw || 0) * -1, 1) * 0;
    const cam = gfx.camera; const fwd = new V3(0, 0, -1).applyQuaternion(cam.quaternion); const hd = Math.atan2(fwd.x, -fwd.z);
    const px = mode === 'flight' ? G.sv.surf.p : mode === 'onfoot' ? player.p : mode === 'skiff' ? skiff.p : bike.p;
    const pois = disc.compassList(px.x, px.z, 9000);
    const lz = mode === 'flight' && G.sv.surf.site; if (lz) pois.push({ bearing: Math.atan2(lz.x - px.x, -(lz.z - px.z)), label: 'LZ', color: '#6dff9a', found: true, dist: lz.dist || 0 });      // landing-site marker
    hud.compassDraw(hd, pois);
  } else hud.compassDraw(0, []);
  document.getElementById('compass').style.opacity = mode === 'orbit' ? 0.0 : 1;
}
function surveyView(v) {      // PROSPECTOR: survey panel data (the mast must be up)
  const sv = v.rv && v.rv.survey; if (v.dep.sensor < 0.6 || !sv) return { stowed: true };
  return { here: sv.here, best: sv.best, dist: sv.dist, rel: sv.rel, kind: sv.kind };
}
function modeLabel() { return { orbit: 'ORBIT', flight: world.active.kind === 'plane' ? 'SPACEPLANE' : world.active.model.rover ? (world.active.stance === 'flat' ? 'ROVER' : 'PROSPECTOR') : 'LANDER', onfoot: 'ON FOOT', bike: 'DIRT BIKE', skiff: 'WISP SKIFF' }[G.mode]; }
function subLabel() {
  const v = world.active; const b = BODIES[v.body];
  if (G.mode === 'orbit') return `${v.name} - ${b ? b.name : 'deep space'} ${b && b.recipe ? '' : b ? '(survey pending)' : ''}`;
  return `${K.name} - ${fmtUT(world.t)}`;
}
let btnSig = '';
function buttons(v) {
  const mode = G.mode; const defs = [], defs2 = [];
  const mapB = { label: 'Map', k: 'M', fn: () => toggleMap(true) };
  if (mode === 'orbit') {
    if (v.docked) { defs.push({ k: 'U', label: 'Undock Albatross', fn: () => undockCraft(world.plane), disabled: !world.plane.docked }, { k: 'I', label: 'Undock ' + world.lander.name, fn: () => undockCraft(world.lander), disabled: !world.lander.docked }); }
    else if (v.kind === 'carrier') { defs.push({ k: 'U', label: 'Undock Albatross', fn: () => undockCraft(world.plane), disabled: !world.plane.docked }, { k: 'I', label: 'Undock ' + world.lander.name, fn: () => undockCraft(world.lander), disabled: !world.lander.docked }); }
    else { defs.push({ k: 'G', label: v.ap ? 'Cancel descent' : 'Begin descent', fn: beginDescent, on: !!v.ap }, { k: 'C', label: 'Dock', fn: dockCraft }); }
    defs.push({ k: 'Tab', label: 'Switch craft', fn: cycleCraft });
    if (!v.docked) defs2.push({ k: '1', label: 'Pro', on: v.sas === 'pro', fn: () => (v.sas = 'pro') }, { k: '2', label: 'Retro', on: v.sas === 'retro', fn: () => (v.sas = 'retro') }, { k: '3', label: 'Radial', on: v.sas === 'up', fn: () => (v.sas = 'up') }, { k: '4', label: 'Free', on: v.sas === 'free', fn: () => (v.sas = 'free') }, { k: 'X', label: 'Cut', fn: () => (v.thrCmd = 0) }, { k: 'Z', label: 'Full', fn: () => (v.thrCmd = 1) });
    defs2.push({ k: ',', label: 'Warp -', fn: () => world.setWarp(world.warpIndex - 1) }, { k: '.', label: 'Warp +', fn: () => world.setWarp(world.warpIndex + 1) }, { k: '/', label: '1x', fn: () => { world.warpIndex = 0; world.warpTo = null; } });
    if (v.kind === 'plane') defs.push({ k: 'N', label: 'Mode ' + v.mode, fn: cycleMode }, { k: 'P', label: 'Panels', on: v.depT.panels > 0.5, fn: () => toggleDeploy('panels') }, { k: 'K', label: 'Radiators', on: v.depT.radiators > 0.5, fn: () => toggleDeploy('radiators') });
    if (world.carrier.nodes.length || v.nodes.length) defs2.push({ label: 'Nodes: ' + v.nodes.length, fn: () => toggleMap(true) });
    if (v.kind === 'carrier' && !v.docked) { const cgo = world.carrier.cargoRefuel; }
    // docked-craft cargo transfer + emergency resupply
    if (v.kind === 'carrier') {
      const cargo = world.plane.cargo.h2 + world.lander.cargo.h2;
      if (cargo > 1 && world.plane.docked && world.lander.docked) defs2.push({ label: `Transfer ${cargo.toFixed(0)} kg H2`, fn: transferCargo });
      if (v.dvRemaining(world, {}) < 150) defs2.push({ label: 'Request resupply', fn: resupply });
    }
  } else if (mode === 'flight') {
    const s = v.surf;
    defs.push({ k: 'Space', label: s.aero ? 'Stability assist' : v.kind === 'plane' ? 'Descent hold' : 'Hover assist', on: s.assist, fn: () => { s.assist = !s.assist; s.ap = null; } }, { k: 'L', label: 'Auto-land', on: s.ap === 'land', fn: () => { if (!s.landed) { s.ap = s.ap === 'land' ? null : 'land'; s.assist = true; } } }, { k: 'O', label: 'Launch to orbit', on: s.ap === 'ascent', fn: () => launchToOrbit(v) });
    if (s.landed) defs.push({ k: 'E', label: 'Exit', fn: () => exitCraft(v) }, { k: 'R', label: 'Refine', fn: () => doRefine(v) });
    if (v.kind === 'lander' && v.model.rover && s.landed) {      // PROSPECTOR
      const flat = v.stance === 'flat';
      defs2.push({ k: 'T', label: v.stance === 'vertical' ? 'Tip down' : 'Stand up', fn: () => tipRover(v), disabled: v.stance === 'tipping' });
      if (flat) defs2.push({ k: 'V', label: 'Drill', on: !!v.drilling, fn: () => doDrill(v) }, { k: 'F', label: 'Scan', fn: () => { const c = vesselPlacePos(v); doScan(c.x, c.z, 1100, 150); } }, { k: 'Y', label: 'Mast', on: v.depT.sensor > 0.5, fn: () => rampToggle(v) }, { k: 'P', label: 'Panels', on: v.depT.panels > 0.5, fn: () => toggleDeploy('panels', v) }, { k: 'K', label: 'Radiators', on: v.depT.radiators > 0.5, fn: () => toggleDeploy('radiators', v) });
    }
    if (s.landed && K.id === 'aethel') defs.push({ k: 'U', label: skiff.out ? 'Stow skiff' : 'Deploy skiff', fn: () => deploySkiff(v) });      // AETHEL
    if (v.kind === 'plane') defs2.push({ k: 'T', label: v.stance === 'vertical' ? 'Tip down' : 'Stand up', fn: () => tipPlane(v), disabled: !s.landed || v.stance === 'tipping' }, { k: 'Y', label: 'Ramp', on: v.depT.ramp > 0.5, fn: () => rampToggle(v) }, { k: 'B', label: G.bikeOut ? 'Stow bike' : 'Bike', fn: () => deployBike(v) }, { k: 'P', label: 'Panels', on: v.depT.panels > 0.5, fn: () => toggleDeploy('panels') }, { k: 'K', label: 'Radiators', on: v.depT.radiators > 0.5, fn: () => toggleDeploy('radiators') }, { k: 'V', label: 'Drill', on: !!v.drilling, fn: () => doDrill(v) });
  } else if (mode === 'onfoot') {
    defs.push({ k: 'G', label: 'Sample', fn: doHarvest }, { k: 'F', label: 'Scan', fn: () => doScan(player.p.x, player.p.z) });
    const near = G.near; if (near) defs.push({ k: 'E', label: 'Enter ' + near.name, fn: () => enterCraft(near) }, { k: 'R', label: 'Refine', fn: () => doRefine(near) });
    if (G.bikeOut && G.dBike < 4.5) defs.push({ k: 'E', label: 'Ride bike', fn: mountBike });
  } else if (mode === 'skiff') { defs.push({ k: 'U', label: 'Leave skiff', fn: exitSkiff, disabled: !skiff.landed }, { k: 'F', label: 'Scan', fn: () => doScan(skiff.p.x, skiff.p.z) }); }      // AETHEL
  else if (mode === 'bike') defs.push({ k: 'E', label: 'Dismount', fn: dismountBike }, { k: 'R', label: 'Reset', fn: () => bike.respawn(surfEnv()) });
  hud.buttons('craftbtns', defs); hud.buttons('orbitbtns', defs2);
}
function transferCargo() {
  const c = world.carrier; let n = 0;
  for (const d of [world.plane, world.lander]) { const room = CARRIER.propMax - c.tanks.h2; const mv = Math.min(room, d.cargo.h2); c.tanks.h2 += mv; d.cargo.h2 -= mv; n += mv; }
  say(`Transferred ${n.toFixed(0)} kg hydrogen to Wayfarer (+${(carrierDv(c.tanks.h2) - carrierDv(c.tanks.h2 - n)).toFixed(0)} m/s)`, 'ok');
}
function resupply() { const c = world.carrier; c.tanks.h2 = Math.min(CARRIER.propMax, c.tanks.h2 + 6000); say('Resupply drone delivered 6,000 kg hydrogen', 'ok'); }

// ------------------------------------------------------------------ main loop
let last = performance.now(), fpsAcc = 0, fpsN = 0;
const _pq = new Q(), _pd = new V3();
function updatePlasma(t) {
  for (const v of world.vessels) {
    const pl = v.plasma; if (!pl) continue;
    const sp = v.status === 'surface' && v.surf ? v.surf.vel : v.v;
    const on = v.glow > 0.012 && sp.length() > 20 && !v.docked;
    pl.visible = on; if (!on) continue;
    _pd.copy(sp).normalize().applyQuaternion(_pq.copy(v.model.group.quaternion).invert());
    const u = pl.userData.mat.uniforms; u.uDir.value.copy(_pd); u.uI.value = Math.min(1.3, v.glow * 1.1); u.uT.value = t;
  }
}
// ---- PYRA: suit heat hazard and heat shimmer (inert on worlds without rc.heatAt)
function pyraHeat(dt, focus, cam) {
  const rc = RECIPES[K.id], U = gfx.sanitize.uniforms;
  if (!rc.heatAt) { if (U.uHeat.value) U.uHeat.value = 0; return; }
  const ox = terrain.origin.x, oz = terrain.origin.z, S = G.suit;
  const hc = rc.heatAt(cam.position.x + ox, cam.position.z + oz) * (1 - clamp((cam.position.y - terrain.h(cam.position.x, cam.position.z) - 40) / 120, 0, 1));
  U.uHeat.value += (clamp(hc * 1.4, 0, 1) - U.uHeat.value) * Math.min(1, dt * 3); U.uHT.value += dt;
  if (G.mode !== 'onfoot' && G.mode !== 'bike') { S.t = Math.max(0, S.t - 0.1 * dt); return; }
  const r = suitStep(S, dt, rc, focus.x + ox, focus.z + oz, G.mode === 'onfoot' ? player.p.y : bike.p.y);
  if (!S.warnA && S.t > 0.55) { S.warnA = true; say('Suit temperature rising: back away from the lava', 'warn', true); }
  if (S.warnA && S.t < 0.3) S.warnA = false;
  if (!S.warnB && S.t > 0.85) { S.warnB = true; say('SUIT OVERHEATING: retreat now', 'warn', true); }
  if (S.warnB && S.t < 0.5) S.warnB = false;
  if (r.fail) {
    const sp = S.safe || { x: SW.pyra.rc.toSite(-200, 0).x, z: SW.pyra.rc.toSite(-200, 0).z };
    const lx = sp.x - ox, lz = sp.z - oz;
    player.place(lx, terrain.h(lx, lz), lz, G.cam.yaw); if (G.mode === 'bike') { G.act.dismountBike && G.act.dismountBike(); }
    S.t = 0.3; S.warnA = S.warnB = false; say('Suit failure: emergency retrieval to the last safe ground', 'warn', true);
  }
}
function frame(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000); last = now; const dt = dtReal;
  fpsAcc += dtReal; fpsN++; if (fpsAcc > 1) { G.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  G.time += dt;
  if (G.started) {
    handleGlobalKeys();
    stepFade(dt);
    let origin = new V3();
    if (G.mode === 'orbit') {
      updateOrbitMode(dt);
    }
    else if (G.mode === 'flight') updateFlight(dt);
    else if (G.mode === 'onfoot') updateOnFoot(dt);
    else if (G.mode === 'bike') updateBike(dt);
    else if (G.mode === 'skiff') updateSkiff(dt);      // AETHEL
    updatePlasma(G.time);
    render(dt);
    if (hud.isOpen('map')) { mapUI.draw(world.t); mapUI.refreshSide(false); }
    updateHud(dt);
    if (!G.mapResized && hud.isOpen('map')) { }
  } else {
    // title screen: slow orbit fly-around
    G.cam.yaw += dt * 0.05; render(dt);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}

function render(dt) {
  const cam = gfx.camera;
  if (G.mode === 'orbit') {
    // ---- orbit scene
    const v = world.active;
    const origin = layoutOrbitScene();
    const b = BODIES[v.body];
    if (sky.mesh.parent !== sceneO) { sceneO.add(sky.mesh); sceneO.add(gfx.rig); }
    // body sphere
    if (b) {
      bodyView.setBody(v.body);
      if (RECIPES[v.body] && RECIPES[v.body].BAKE && !G.bakes[v.body]) { G.bakes[v.body] = true; bakeOrbitMap(v.body, b.R, 2048, 1024).then((tex) => bodyView.setBake(v.body, tex)); }      // glaciera: baked orbit map, built lazily on first view
      const rel = origin.clone().negate();
      const alt = origin.length() - b.R;
      const lights = updateSky('orbit', null);
      bodyView.update(rel, alt, lights.sun, world.t);
      if (lights.giant) { bodyView.u.uFill.value.copy(lights.giant); bodyView.u.uFillI.value = 0.12; }
      else bodyView.u.uFillI.value = 0;
      bodyView.group.visible = true;
      cam.near = 0.5; cam.far = Math.max(2e6, origin.length() * 4 + b.R * 3); cam.updateProjectionMatrix();
    } else { bodyView.group.visible = false; updateSky('orbit', null); cam.near = 0.5; cam.far = 1e7; cam.updateProjectionMatrix(); }
    setOrbitVisuals(v, G.time);
    updateCamera(dt, origin);
    curv.cam.value.set(0, -1e9, 0); curv.k.value = 0; curv.ri.value = 0; if (INT && INT.active) INT.attach(sceneO, false); if (gateDisc) gateDisc.off();      // AETHEL: no hatch / concave bend in the orbit scene
    gfx.csm.maxFar = 600; gfx.csm.updateFrustums();
    sceneO.fog = null; atmU.uAOn.value = 0;
    gfx.csm.update();
    gfx.renderPass.scene = sceneO; gfx.renderPass.camera = cam;
    gfx.bloom.strength = 0.42;
  } else {
    // ---- surface scene
    if (sky.mesh.parent !== sceneS) { sceneS.add(sky.mesh); sceneS.add(gfx.rig); }
    const ll = lonLatOfSite();
    const lights = G.interior ? aeLights : updateSky('surface', ll, cam.position);      // AETHEL: the interior has its own sun and sky
    curv.k.value = G.interior ? 0 : 1 / (2 * K.R);
    const camPos = cam.position;
    updateCamera(dt, null);
    curv.cam.value.copy(cam.position);
    aethelFrame(cam);      // AETHEL: gate hatch / interior shell + sun
    cam.near = 0.3; cam.far = 400000;
    { const sf = G.mode === 'flight' && G.sv.surf.aero ? 62 + clamp(G.sv.surf.vel.length() - 50, 0, 200) * 0.09 : G.interior ? 76 : 62; if (Math.abs(cam.fov - sf) > 0.05) { cam.fov += (sf - cam.fov) * Math.min(1, dt * 2); } cam.updateProjectionMatrix(); }
    const focus = G.mode === 'flight' ? G.sv.surf.p : G.mode === 'onfoot' ? player.p : G.mode === 'skiff' ? skiff.p : bike.p;
    terrain.update(cam.position); scatter.update(focus);
    { const iw = SW[G.worldId].ice; if (iw) iw.update(dt, cam.position, focus, lights.sun, particles, G.time, K.g); }     // glaciera: shards, pad lamps, geyser plumes, spindrift
    if (water) water.update(G.time);
    if (falls) { const fl = G.interior ? 0.0 : clamp(0.35 + lights.sun.y * 2.2, 0.35, 1), cd = new V3(0, 0, -1).applyQuaternion(cam.quaternion); const cts = -(lights.sun.x * cd.x + lights.sun.y * cd.y + lights.sun.z * cd.z); for (const f of falls) f.update(dt, cam.position, particles, fl, lights.sun.y, cts); }
    if (veg) veg.update(cam.position, focus, G.time, lights.sun);
    if (volc) volc.update(dt, cam.position, particles, lights.sun.y, gfx.csm.lights[0].color);          // PYRA
    terrainUniforms.uCrackT.value = G.time; pyraHeat(dt, focus, cam);          // PYRA
    if (eco) { const rr = G.mode === 'onfoot' ? (input.down('ShiftLeft') ? 1.8 : 1) : G.mode === 'bike' ? 1 + Math.min(2.2, bike.speed * 0.09) : G.mode === 'skiff' ? 2.2 : (G.sv.surf.p.y - terrain.h(focus.x, focus.z) < 200 ? 3.2 : 0.2); eco.setThreat(focus.x, focus.z, rr); eco.update(dt, focus, G.time, lights.sun, cam.position); }
    disc.update(dt, focus.x, focus.z, focus.y, G.mode !== 'flight' || G.sv.surf.p.y - terrain.h(focus.x, focus.z) < 150, cam.position);
    const hr = world.t; particles.update(dt, K.g, (x, z) => terrain.h(x, z));
    particles.uScale.value = gfx.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    for (const o of surfaceVessels()) applySurfaceModel(o, G.time);
    if (skiff.out && skiff.world === K.id) skiff.applyModel(dt, G.time); else skiff.group.visible = false;      // AETHEL
    if (G.mode === 'flight' && G.sv.surf.aero) emitVapor(G.sv, dt);
    // fog tint: faint warm dust haze
    sceneS.fog.density = RECIPES[K.id].WORLD || RECIPES[K.id].ICE ? 0 : 1 / 70000;
    gfx.csm.maxFar = RECIPES[K.id].WORLD ? 800 : 1600; gfx.csm.updateFrustums();
    gfx.csm.update();
    gfx.renderPass.scene = sceneS; gfx.renderPass.camera = cam;
    if (G.discNote !== disc.journal.length) { G.discNote = disc.journal.length; }
  }
  gfx.composer.render();
  window.__ready = G.ready = true;
}

// ------------------------------------------------------------------ start / debug hooks
buildHelp();
initInput(canvas, () => { });
document.querySelectorAll('#topbtns button').forEach((b) => (b.onclick = () => { const a = b.dataset.act; if (a === 'map') toggleMap(); if (a === 'journal') toggleJournal(); if (a === 'help') toggleHelp(); }));
$el('mapClose').onclick = () => toggleMap(false);
addEventListener('resize', () => { if (hud.isOpen('map')) mapUI.resize(); });

function placeSurfaceStart(kind, x = 0, z = 0) {
  // debug: put craft landed near (x, z) local to the home site
  const v = kind === 'plane' ? world.plane : world.lander;
  v.docked = false; v.status = 'surface';
  if (!G.descentOrigin) { setWorldOrigin(K.site.x, K.site.z); }
  const hd0 = (RECIPES[K.id].RUNWAY && RECIPES[K.id].RUNWAY.heading) || 1.78;
  F.makeSurf(v, new V3(x, 0, z), new V3(), new Q(), hd0);
  F.placeLanded(v, x, z, hd0, surfEnv());
  if (kind === 'plane' && K.atmosphere) {          // atmospheric world: the plane rests flat on its wheels and flies like an aeroplane
    const s = v.surf; v.tip = 1; v.tipT = 1; v.stance = 'flat'; v.dep.ramp = 0; initAero(v, s, surfEnv());
    s.q.copy(quatFromFwdUp(new V3(Math.sin(hd0), 0, -Math.cos(hd0)), new V3(0, 1, 0), new Q()));
    s.p.set(x, terrain.h(x, z) + 2.62, z); s.vel.set(0, 0, 0); s.heading = hd0; s.landed = true; s.onGround = true;
  }
  return v;
}
G.teleport = (mode, x = 0, z = 0, opt = {}) => {
  const target = opt.craft === 'lander' ? world.lander : world.plane;
  if (mode === 'orbit') { world.active = world.carrier; G.mode = 'orbit'; return; }
  if (opt.world) activateWorld(opt.world);
  if (!G.descentOrigin) { setWorldOrigin(K.site.x, K.site.z); }
  const v = placeSurfaceStart(opt.craft === 'lander' ? 'lander' : 'plane', x, z);
  hideOrbitModels(); sceneS.add(v.model.group);
  G.sv = v; world.active = v; G.camInit = null; G.cam.dist = v.kind === 'plane' ? 26 : 16; G.cam.pitch = 0.2;
  if (opt.flat && v.kind === 'plane') { v.tip = 1; v.tipT = 1; v.stance = 'flat'; v.dep.ramp = 1; v.depT.ramp = 1; }
  if (opt.flat && v.kind === 'lander' && v.model.rover) { v.tip = 1; v.tipT = 1; v.stance = 'flat'; for (const k of Object.keys(v.dep)) { v.dep[k] = 0; v.depT[k] = 0; } v.dep.sensor = 0; }      // PROSPECTOR: start in the rove pose
  if (mode === 'flight') { v.surf.landed = !opt.alt; if (opt.alt) { v.surf.p.y = terrain.h(x, z) + opt.alt; v.surf.landed = false; v.surf.vel.set(0, 0, 0); } G.mode = 'flight'; }
  else if (mode === 'onfoot') {
    G.mode = 'onfoot'; const px = x + 14, pz = z + 6; player.place(px, terrain.h(px, pz), pz, 0.6); M.astro.group.visible = true; sceneS.add(M.astro.group); G.cam.dist = 5; G.cam.yaw = opt.yaw ?? 0.6;
  } else if (mode === 'bike') {
    if (v.kind === 'plane' && !opt.flat) { v.tip = 1; v.tipT = 1; v.stance = 'flat'; v.dep.ramp = 1; v.depT.ramp = 1; }
    const bx = opt.bx ?? x + 30, bz = opt.bz ?? z + 10;
    bike.place(bx, bz, opt.yaw ?? 1.2, surfEnv()); M.bike.group.visible = true; sceneS.add(M.bike.group); G.bikeOut = true;
    player.place(bx, terrain.h(bx, bz), bz, 0); M.astro.group.visible = true; mountBike(); G.mode = 'bike';
  }
};
G.setTime = (t) => { world.t = t; };
G.rover = { roverInit, roverStep, roverRight, surveyUpdate, richnessAt, tipRover, doDrill, doRefine, doScan, exitCraft, enterCraft, undockCraft, dockCraft, beginDescent, launchToOrbit, restCraft, craftSystems };      // PROSPECTOR debug hooks
G.quatFromFwdUp = quatFromFwdUp; G.setAirborne = (x, y, z, speed, hdg, gamma = 0, thr = 0.5) => { const v = world.plane, s = v.surf; const f = new V3(Math.sin(hdg) * Math.cos(gamma), Math.sin(gamma), -Math.cos(hdg) * Math.cos(gamma)); s.p.set(x, y, z); s.vel.copy(f).multiplyScalar(speed); s.q.copy(quatFromFwdUp(f, new V3(0, 1, 0), new Q())); s.onGround = false; s.landed = false; s.gear = 0; s.throttle = thr; s.ap = null; };
G.start = () => {
  if (G.started) return; G.started = true; $el('title').classList.add('hidden'); hud.show(true);
  G.cam.dist = 75; G.cam.yaw = 0.7; G.cam.pitch = 0.22;
  say('Wayfarer is in a 40 km orbit above Kestrel. Undock the spaceplane (U) to begin.', 'info', true);
  setTimeout(() => say('F1 for controls - M for the system map', 'info'), 1500);
};
G.setCamTowardGiant = (dist = 90, lift = 0.1) => { const T = giantDirF(K); const d = T.clone().negate(); G.cam.yaw = Math.atan2(d.x, d.z); G.cam.pitch = Math.asin(d.y) + lift; G.cam.dist = dist; };
G.setCamDir = (x, y, z, dist = 90) => { const d = new V3(x, y, z).normalize(); const b = orbitBasis(); G.cam.yaw = Math.atan2(d.dot(b.E), d.dot(b.N)); G.cam.pitch = Math.asin(d.dot(b.U)); G.cam.dist = dist; };
G.giantDir = () => giantDirF(K);
G.aethel = { AE, aethel, aethelin, skiff, interior, deploySkiff, boardSkiff, exitSkiff, enterInterior, exitInterior, skiffTo, aeLights, gate: () => gateDisc };      // AETHEL debug hooks
G.atmU = atmU; G.sunDot = () => 0; G.updateHud = updateHud; G.input = input; G.act = { undockCraft, beginDescent, exitCraft, enterCraft, tipPlane, rampToggle, deployBike, mountBike, dismountBike, doHarvest, doScan, doRefine, doDrill, launchToOrbit, toggleMap, toggleJournal, toggleHelp, dockCraft, cycleCraft, enterSurface, exitSurface, transferCargo, toggleDeploy };

(async function boot() {
  world.t = 1200;                      // low sun (~8-13 deg) in the north-west: long shadows, lit Tamber
  initialOrbit();
  buildEnv();
  const title = $el('titleSub'), btn = $el('startBtn');
  requestAnimationFrame(frame);
  const tex = await bakeOrbitMap('kestrel', K.R, 2048, 1024, (p) => { title.textContent = `Surveying Kestrel... ${Math.round(p * 100)}%`; });
  bodyView.setBake('kestrel', tex);
  title.textContent = 'Kestrel, moon of Tamber. Ready.'; btn.disabled = false;
  btn.onclick = () => G.start();
  if (q.get('autostart')) G.start();
})();
