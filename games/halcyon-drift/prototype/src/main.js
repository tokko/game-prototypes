// Entry point: scene setup, render loop, camera rigs, action dispatch, save/load, crash FX.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BODIES, SUN_DIR, isMoon, ventState } from './bodies.js';
import { World, WARP } from './world.js';
import { DOCK_OFFSET, DOCK_ROT, DEP_NAMES } from './vessels.js';
import { engageAutopilot, planTransferNode, planCircNode, AP_NAMES } from './autopilot.js';
import { createCarrier, createLander, applyDeploy } from './models.js';
import { createSky, createPlanet, createAtmosphere, createMoon, createGroundPatch, createSiteMarker, createSpire, createPlume, createRing } from './sky.js';
import { MapView } from './map.js';
import { Hud } from './hud.js';
import { Input } from './input.js';

const $ = (id) => document.getElementById(id);
const P2R = (v, out = new THREE.Vector3()) => out.set(v.x, v.z, -v.y); // physics (Z-up) -> render (Y-up)
const Zaxis = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------------------ renderer & scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.3, 4e10);
const world3 = new THREE.Group();            // physics frame lives inside; Z-up -> Y-up
world3.rotation.x = -Math.PI / 2;
scene.add(world3);

const sunRender = P2R(SUN_DIR).normalize();
const sky = createSky(sunRender);
scene.add(sky);

const hemi = new THREE.HemisphereLight(0x8090c0, 0x4a4038, 0.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
world3.add(sun, sun.target);
const shine = new THREE.DirectionalLight(0x6a9cff, 0.0);
world3.add(shine, shine.target);

// bodies
const planetPivot = new THREE.Group(); planetPivot.rotation.x = Math.PI / 2; world3.add(planetPivot);
const planetMesh = createPlanet(BODIES.planet.radius, sunRender); planetPivot.add(planetMesh);
const atmo = createAtmosphere(BODIES.planet.radius, BODIES.planet.atmosphere.height, sunRender); world3.add(atmo);
// moons (Pell, Wren): globe slightly inside its exact-radius ground patch, ore beacons
const moonVis = {};
for (const id of BODIES.planet.children) {
  const B = BODIES[id];
  const look = id === 'wren' ? { scale: B.craterScale, ice: true, rift: B.rift, vents: B.vents.map((vt) => vt.dir.clone().multiplyScalar(B.radius)) } : undefined; // Wren: pale ice, small craters, glowing rift
  const mesh = createMoon(B.radius, look); mesh.scale.setScalar((B.radius - 1.2) / B.radius); world3.add(mesh);
  const gp = createGroundPatch(B.radius, look); world3.add(gp);
  moonVis[id] = { mesh, patch: gp, markers: B.sites.map((s) => { const m = createSiteMarker(s); world3.add(m); return m; }) };
}
// Wren extras: debris ring, four geyser plumes, the Spire
const wrenVis = { ring: createRing(BODIES.wren.ring.inner, BODIES.wren.ring.outer, sunRender), spire: createSpire(BODIES.wren.spire.height), plumes: BODIES.wren.vents.map((vt, i) => createPlume(vt.height, i + 1, sunRender)) };
world3.add(wrenVis.ring, wrenVis.spire);
for (const p of wrenVis.plumes) world3.add(p.points);
// custom landing target ("Marked point"): one magenta beacon that follows the selection
const customMarker = createSiteMarker({ radius: 60, dir: new THREE.Vector3(1, 0, 0), custom: true }, new THREE.Color(1.6, 0.45, 1.4)); customMarker.visible = false; world3.add(customMarker);
const moonMesh = moonVis.moon.mesh, patch = moonVis.moon.patch, markers = moonVis.moon.markers;

// ------------------------------------------------------------------------------ post
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
// safety net: one NaN/Inf pixel would be smeared by the bloom mip chain into a flickering black box
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0); gl_FragColor = vec4(min(c.rgb, vec3(64.0)), 1.0); }',
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 1.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------------------ game state
const world = new World();
const hud = new Hud();
const map = new MapView(world3, $('maplabels'));
const fcam = { yaw: -1.2, pitch: 0.3, dist: 300, min: 5, max: 5000 };
const mcam = { yaw: 0.6, pitch: 0.95, dist: 2.6e7, min: 4e4, max: 3e8, focus: 0 };
let mapOn = false;
let paused = false;
const input = new Input(canvas, { flight: fcam, map: mcam, isMap: () => mapOn }, onAction);

const vis = {};
function visual(v) {
  if (!vis[v.id]) { vis[v.id] = v.kind === 'carrier' ? createCarrier() : createLander(); world3.add(vis[v.id]); }
  return vis[v.id];
}
function rememberCam(v) {
  fcam.dist = v.spec.size * (v.kind === 'carrier' ? 2.4 : 3.6);
  fcam.min = v.spec.size * 0.7; fcam.max = v.spec.size * 80;
}
rememberCam(world.active);

// ------------------------------------------------------------------------------ saves
function quicksave() {
  if (world.status !== 'running') { hud.toast('Cannot save after a crash', 'warn'); return; }
  try { localStorage.setItem('orbital:quick', JSON.stringify(world.serialize())); hud.toast('Quicksaved', 'ok'); } catch (e) { hud.toast('Save failed', 'bad'); }
}
function applySave(data, label) {
  world.deserialize(data);
  world.msgs.length = 0;
  rememberCam(world.active);
  crashShown = false; explosion = null;
  for (const id in vis) vis[id].visible = true;
  hud.showCrash(world, hasRevert());
  hud.toast(label, 'ok');
}
function quickload() {
  const raw = localStorage.getItem('orbital:quick');
  if (!raw) { hud.toast('No quicksave found (F5 to save)', 'warn'); return; }
  applySave(JSON.parse(raw), 'Quickload');
}
function hasRevert() { return !!world.revertSave || !!localStorage.getItem('orbital:revert'); }
function revertData() {
  if (world.revertSave) return world.revertSave;
  const raw = localStorage.getItem('orbital:revert');
  return raw ? JSON.parse(raw) : null;
}
function revert() {
  const d = revertData();
  if (!d) { hud.toast('No undock revert point yet', 'warn'); return; }
  applySave(d, 'Reverted to before undock');
}
function restart() {
  const fresh = new World();
  fresh.revertSave = null;
  applySave(fresh.serialize(), 'Flight restarted');
  world.revertSave = null;
}
$('cr-load').onclick = quickload;
$('cr-revert').onclick = revert;
$('cr-restart').onclick = restart;

// ------------------------------------------------------------------------------ actions
function ap(type) {
  const v = world.active;
  const msg = engageAutopilot(world, v, type);
  if (msg) hud.toast(msg, 'warn'); else hud.toast(`${AP_NAMES[type]} engaged`, 'info');
}
function onAction(name, arg) {
  const v = world.active;
  if (name === 'help') { $('help').classList.toggle('hidden'); return; }
  if (name === 'map') { toggleMap(); return; }
  if (name === 'map-focus') { mcam.focus = (mcam.focus + 1) % 4; hud.toast(['Focus: vessel', 'Focus: Halcyon', 'Focus: Pell', 'Focus: Wren'][mcam.focus]); return; }
  if (name === 'menu-close') return closeMenu();
  if (name === 'context') return onContext(arg.x, arg.y);
  if (name === 'quicksave') return quicksave();
  if (name === 'quickload') return quickload();
  if (name === 'pause') { paused = !paused; return; }
  if (world.status !== 'running') return;
  switch (name) {
    case 'sas-toggle': v.sas.on = !v.sas.on; world.cancelAutopilot(v); hud.toast(`SAS ${v.sas.on ? 'on' : 'off'}`); break;
    case 'sas-mode': v.sas.on = true; v.sas.mode = arg; world.cancelAutopilot(v); hud.toast(`SAS: ${arg}`); break;
    case 'vessel': world.cycleVessel(arg); rememberCam(world.active); hud.toast(`Controlling ${world.active.name}`); break;
    case 'warp': world.setWarp(world.warpIndex + arg); break;
    case 'throttle': if (v.status === 'flying' || v.status === 'landed') { world.cancelAutopilot(v); v.throttle = arg; } break;
    case 'undock': if (!world.undock()) hud.toast('Undock needs the carrier in free flight with the lander docked', 'warn'); else rememberCam(world.active); break;
    case 'circ': case 'xfer': case 'land': case 'asc': case 'rdv': case 'node': ap(name); break;
    case 'node-add': { const msg = world.addNode(v, arg); hud.toast(msg || `Maneuver node added at ${arg === 'ap' ? 'apoapsis' : 'periapsis'} (or +2 min if circular)`, msg ? 'warn' : 'info'); break; }
    case 'node-nudge': { const msg = world.nudgeNode(v, arg[0], arg[1]); if (msg) hud.toast(msg, 'warn'); break; }
    case 'node-shift': { const msg = world.shiftNode(v, arg); if (msg) hud.toast(msg, 'warn'); break; }
    case 'node-step': hud.toast(`Node step: ${world.cycleNodeStep()} m/s`); break;
    case 'node-del': { const msg = world.deleteNode(v); hud.toast(msg || 'Maneuver node deleted', msg ? 'warn' : 'info'); break; }
    case 'tgt-body': hud.toast(`Target body: ${BODIES[world.cycleTargetBody()].name}`); break;
    case 'tgt-site': {
      if (world.targetBodyId() === 'planet') { hud.toast('Halcyon has no landing targets: pick a moon first (`)', 'warn'); break; }
      const s = world.cycleTargetSite();
      hud.toast(`Landing target: ${s ? s.name : 'auto (nearest site)'} on ${BODIES[world.targetBodyId()].name}`);
      break;
    }
    case 'plan-xfer': { const msg = planTransferNode(world, v, world.targetBodyId()); if (msg) hud.toast(msg, 'warn'); break; }
    case 'plan-circ-ap': case 'plan-circ-pe': { const msg = planCircNode(world, v, name === 'plan-circ-ap' ? 'ap' : 'pe'); if (msg) hud.toast(msg, 'warn'); break; }
    case 'cancel': if (v.ap) world.cancelAutopilot(v, 'Autopilot cancelled'); v.drilling = false; v.refining = false; break;
    case 'panels': case 'radiators': case 'gear': {
      const msg = world.toggleDeploy(v, name);
      hud.toast(msg || `${DEP_NAMES[name]} ${v.dep[name].t > 0.5 ? 'extending' : 'retracting'}`, msg ? 'warn' : 'info');
      break;
    }
    case 'autoret':
      world.flags.autoRetract = world.flags.autoRetract === false;
      hud.toast(`Auto-retract on burn: ${world.flags.autoRetract === false ? 'OFF (panels break above 1.5 g!)' : 'on'}`, world.flags.autoRetract === false ? 'warn' : 'info');
      break;
    case 'drill':
      if (v.kind !== 'lander' || v.status !== 'landed') hud.toast('Drilling needs the lander landed on a beacon ring', 'warn');
      else if (v.drilling) { v.drilling = false; hud.toast('Drill stopped'); }
      else if (v.driving && Math.abs(v.driveSpeed) > 0.5) hud.toast('Stop the rover first (Space)', 'warn');
      else if (!world.siteNear(v)) hud.toast('No ore deposit here: land or drive (F) inside a blue ring', 'warn');
      else { v.driving = false; v.driveSpeed = 0; v.drilling = true; hud.toast('Drilling...', 'ok'); if (v.dep.radiators.t < 0.5) hud.toast('Tip: extend radiators (K) and solar panels (J) first', 'info'); }
      break;
    case 'drive': { const msg = world.toggleDrive(v); hud.toast(msg || (v.driving ? 'Drive mode: W/S throttle, A/D steer, Space brake, F to exit' : 'Drive mode off'), msg ? 'warn' : 'info'); break; }
    case 'refuel': case 'offload': { const msg = world.startPump(name); hud.toast(msg || (name === 'refuel' ? 'Pumping propellant to the lander' : 'Pumping ore to the carrier'), msg ? 'warn' : 'info'); break; }
    case 'refine':
      if (!(v.spec.refEC > 0) || v.status === 'docked') hud.toast('No refinery available on this vessel right now', 'warn');
      else if (v.refining) { v.refining = false; hud.toast('Refinery stopped'); }
      else if (v.res.ore < 1) hud.toast('No ore to refine: drill first', 'warn');
      else { v.refining = true; hud.toast('Refining ore into fuel + oxidizer', 'ok'); if (v.dep.radiators.t < 0.5) hud.toast('Tip: extend radiators (K) and solar panels (J) first', 'info'); }
      break;
    default: break;
  }
}
for (const b of document.querySelectorAll('#vdep button')) b.addEventListener('click', () => onAction(b.dataset.dep === 'auto' ? 'autoret' : b.dataset.dep));
for (const b of document.querySelectorAll('#actbtns button')) b.addEventListener('click', () => onAction(b.dataset.act));
const MN_ACT = { tbody: 'tgt-body', tsite: 'tgt-site', xfer: 'plan-xfer', circap: 'plan-circ-ap', circpe: 'plan-circ-pe', exec: 'node', del: 'node-del' };
for (const b of document.querySelectorAll('#mn-btns button')) b.addEventListener('click', () => onAction(MN_ACT[b.dataset.mn]));
for (const b of document.querySelectorAll('#sas button')) b.addEventListener('click', () => onAction(b.dataset.sas === 'toggle' ? 'sas-toggle' : 'sas-mode', b.dataset.sas));
// ------------------------------------------------------------------------------ map context menu
const ctxMenu = $('ctxmenu');
function closeMenu() { ctxMenu.classList.add('hidden'); }
function openMenu(items, x, y) {
  ctxMenu.innerHTML = '';
  for (const [label, fn] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { closeMenu(); fn(); });
    ctxMenu.appendChild(b);
  }
  ctxMenu.classList.remove('hidden');
  ctxMenu.style.left = `${Math.min(x, innerWidth - ctxMenu.offsetWidth - 6)}px`;
  ctxMenu.style.top = `${Math.min(y, innerHeight - ctxMenu.offsetHeight - 6)}px`;
}
function onContext(x, y) {
  closeMenu();
  if (!mapOn) return;
  const hit = map.pick(camera, { x: innerWidth, y: innerHeight }, x, y);
  if (!hit) return;
  const items = [];
  const focusItem = (id) => ['Focus camera', () => { mcam.focus = id === 'planet' ? 1 : 2 + BODIES.planet.children.indexOf(id); hud.toast(`Focus: ${BODIES[id].name}`); }];
  const targetItem = (id) => [`Set target: ${BODIES[id].name}`, () => { world.setTargetBody(id); hud.toast(`Target body: ${BODIES[id].name}`); }];
  if (hit.kind === 'site') {
    items.push([`Set landing target: ${hit.site.name}`, () => { world.setLandingTarget(hit.body, hit.site); hud.toast(`Landing target: ${hit.site.name} on ${BODIES[hit.body].name}`); }]);
  } else if (hit.kind === 'surface') {
    items.push(['Set landing target here', () => { world.setLandingTarget(hit.body, { dir: hit.dir }); hud.toast(`Landing target: marked point on ${BODIES[hit.body].name}`); }], targetItem(hit.body), focusItem(hit.body));
  } else items.push(targetItem(hit.id), focusItem(hit.id));
  openMenu(items, x, y);
}
function toggleMap() { closeMenu(); mapOn = !mapOn; map.setVisible(mapOn); document.body.classList.toggle('map', mapOn); }

// ------------------------------------------------------------------------------ crash fx
let crashShown = false, explosion = null, crashTime = 0;
function startExplosion() {
  const c = world.crash;
  const N = 500;
  const pos = new Float32Array(N * 3), vel = [];
  const size = world.vessel(c.vesselId).spec.size;
  for (let i = 0; i < N; i++) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((0.3 + Math.random()) * size * 2.5);
    vel.push(d);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: Math.max(2, size * 0.12), color: new THREE.Color(3, 1.5, 0.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; world3.add(pts);
  explosion = { pts, vel, t: 0, pos: c.pos.clone() };
  const o = vis[c.vesselId]; if (o) o.visible = false;
  if (c.vesselId === 'carrier' && vis.lander) vis.lander.visible = false;
  crashTime = performance.now();
}

// ------------------------------------------------------------------------------ frame
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4();
const E = new THREE.Vector3(), Nn = new THREE.Vector3(), Uu = new THREE.Vector3();
function enuBasis(r) {
  Uu.copy(r).normalize();
  Nn.set(0, 0, 1).addScaledVector(Uu, -Uu.z);
  if (Nn.lengthSq() < 1e-6) Nn.set(1, 0, 0).addScaledVector(Uu, -Uu.x);
  Nn.normalize(); E.crossVectors(Nn, Uu);
}

const dbg = { look: null };
let last = performance.now(), clock = 0, lastActive = world.activeId;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
  const thr = input.update(dt);
  if (world.activeId !== lastActive) { lastActive = world.activeId; rememberCam(world.active); }
  const av = world.active;
  if (world.status === 'running') {
    if (thr !== 0 && (av.status === 'flying' || av.status === 'landed')) { world.cancelAutopilot(av); av.throttle = Math.max(0, Math.min(1, av.throttle + thr)); }
    const driving = av.driving;
    world.input.rot.copy(driving ? new THREE.Vector3() : input.rot);
    Object.assign(world.input.drive, input.drive);
    if (!paused) world.step(dt);
  }
  while (world.msgs.length) { const m = world.msgs.shift(); hud.toast(m.text, m.kind === 'info' ? 'info' : m.kind); }
  if (world.status === 'crashed' && !crashShown) { crashShown = true; startExplosion(); }
  if (crashShown && performance.now() - crashTime > 1400 && world.status === 'crashed') hud.showCrash(world, hasRevert());
  else if (world.status !== 'crashed') hud.showCrash(world, false);

  render(dt);
  hud.update(world, { paused });
  composer.render();
  hud.nav.render(renderer, world);
  requestAnimationFrame(frame);
}

function render(dt) {
  const v = world.active;
  const B = BODIES[v.body];
  const moonAbs = {};
  for (const id of BODIES.planet.children) moonAbs[id] = world.moonState(world.UT, undefined, id).r;
  let origin;
  const focusAbs = new THREE.Vector3();
  if (mapOn) {
    focusAbs.set(0, 0, 0);
    if (mcam.focus === 0) world.absPos(v, focusAbs); else if (mcam.focus >= 2) focusAbs.copy(moonAbs[BODIES.planet.children[mcam.focus - 2]]);
    origin = focusAbs;
  } else origin = world.absPos(v, new THREE.Vector3());

  // --- body placement
  planetMesh.parent.position.set(-origin.x, -origin.y, -origin.z);
  atmo.position.copy(planetMesh.parent.position);
  planetMesh.rotation.y = (world.UT * Math.PI * 2 / BODIES.planet.rotationPeriod) % (Math.PI * 2);
  planetMesh.material.uniforms.uTime.value = world.UT % 100000;
  for (const id of BODIES.planet.children) {
    const mv = moonVis[id], MB = BODIES[id];
    mv.mesh.position.copy(moonAbs[id]).sub(origin);
    // --- ground patch under the active vessel when low over the moon
    const nearMoon = !mapOn && v.body === id && world.altitude(v) < 60000;
    mv.patch.visible = nearMoon;
    if (nearMoon) {
      _v1.copy(v.r).normalize();
      mv.patch.position.copy(mv.mesh.position);
      mv.patch.quaternion.setFromUnitVectors(Zaxis, _v1);
      mv.patch.material.userData.uToMoon.value.setFromMatrix4(_m4.makeRotationFromQuaternion(mv.patch.quaternion));
    }
    // --- ore beacons
    MB.sites.forEach((s, i) => {
      const m = mv.markers[i];
      m.position.copy(mv.mesh.position).addScaledVector(s.dir, MB.radius);
      m.quaternion.setFromUnitVectors(Zaxis, s.dir);
      const dist = m.position.length();
      m.visible = !s.hidden && !mapOn && dist < 3e6;
      m.userData.beamMat.uniforms.uTime.value = clock;
      m.userData.sprite.visible = dist > 2500; // far-away glow only; up close the ring and beam mark the site
      m.userData.sprite.scale.setScalar(Math.max(300, dist * 0.012));
    });
  }

  // --- landing target marked on the map: a magenta beacon on whichever moon it belongs to
  const cs = world.flags.tgtCustom;
  customMarker.visible = !!cs && !mapOn;
  if (cs) {
    const cd = _v2.fromArray(cs.dir);
    customMarker.position.copy(moonVis[cs.body].mesh.position).addScaledVector(cd, BODIES[cs.body].radius);
    customMarker.quaternion.setFromUnitVectors(Zaxis, cd);
    customMarker.userData.beamMat.uniforms.uTime.value = clock;
    const cdist = customMarker.position.length();
    customMarker.userData.sprite.visible = cdist > 2500;
    customMarker.userData.sprite.scale.setScalar(Math.max(300, cdist * 0.012));
  }
  // --- Wren: ring, geyser plumes, the Spire
  {
    const W = BODIES.wren, wp = moonVis.wren.mesh.position, wdist = wp.length();
    wrenVis.ring.position.copy(wp); wrenVis.ring.visible = !mapOn && wdist < 4e6;
    wrenVis.ring.rotation.z = (world.UT * 0.003) % (Math.PI * 2); wrenVis.ring.userData.update(clock); // clumps drift at the Kepler rate (faster under warp)
    W.vents.forEach((vt, i) => {
      const pl = wrenVis.plumes[i], k = ventState(vt, world.UT).k;
      pl.points.position.copy(wp).addScaledVector(vt.dir, W.radius);
      pl.points.quaternion.setFromUnitVectors(Zaxis, vt.dir);
      pl.update(clock, mapOn || wdist > 4e6 ? 0 : k);
    });
    const sp = wrenVis.spire, S = W.spire;
    sp.position.copy(wp).addScaledVector(S.dir, W.radius - 5);
    sp.quaternion.setFromUnitVectors(Zaxis, S.dir);
    sp.visible = !mapOn && wdist < 4e6;
    const tipDist = _v1.copy(sp.position).addScaledVector(S.dir, S.height).length();
    sp.userData.update(clock, tipDist, !!world.flags.spireSeen); // the secret stays gated on spireSeen
  }

  // --- vessels
  for (const ves of world.vessels) {
    const o = visual(ves);
    if (ves.status === 'crashed') { o.visible = false; continue; }
    if (ves.status === 'docked') {
      const car = visual(world.vessel(ves.dockedTo));
      if (o.parent !== car) car.add(o);
      o.position.copy(DOCK_OFFSET); o.quaternion.copy(DOCK_ROT);
      o.visible = !mapOn && car.visible;
    } else {
      if (o.parent !== world3) world3.add(o);
      world.absPos(ves, _v1).sub(origin);
      o.position.copy(_v1); o.quaternion.copy(ves.q);
      o.visible = !mapOn;
    }
    applyDeploy(o, ves.dep, ves.heat / ves.spec.heatMax);
    // engine plumes
    const burning = ves.status !== 'docked' && ves.throttle > 0.001 && ves.hasProp();
    for (const p of o.userData.plumes) {
      p.mesh.visible = burning;
      p.glow.material.color.setRGB(0.6 + 1.2 * ves.throttle, 1.2 + 1.2 * ves.throttle, 2.6 + 2 * ves.throttle).multiplyScalar(burning ? 1 : 0.15);
      if (burning) {
        const f = 0.9 + 0.1 * Math.sin(clock * 55 + p.mesh.id);
        p.mesh.scale.set(1, ves.throttle * f, 1);
        p.mesh.material.uniforms.uTime.value = clock;
        p.mesh.material.uniforms.uIntensity.value = 0.5 + ves.throttle;
      }
    }
    for (const wl of (o.userData.deploy && o.userData.deploy.wheels) || []) wl.rotation.x += ves.driveSpeed * dt / 0.9;
    if (o.userData.drill) {
      const d = o.userData.drill;
      d.scale.y += ((ves.drilling ? 1 : 0.55) - d.scale.y) * Math.min(1, dt * 3);
      if (ves.drilling) d.rotation.y += dt * 12;
    }
  }

  // --- lights: sun, planetshine, shadow frustum around the active vessel
  sun.target.position.set(0, 0, 0);
  sun.position.copy(SUN_DIR).multiplyScalar(700);
  if (mapOn) { sun.castShadow = false; } else {
    sun.castShadow = true;
    const S = Math.max(14, v.spec.size * 0.9);
    const sc = sun.shadow.camera;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 10; sc.far = 1500; sc.updateProjectionMatrix();
  }
  const bodyAbsPos = isMoon(v.body) ? moonAbs[v.body] : _v2.set(0, 0, 0);
  _v1.copy(bodyAbsPos).sub(origin);
  const dPlanet = world.absPos(v, _v2).length();
  shine.position.copy(_v2.set(0, 0, 0).sub(origin).normalize());
  shine.intensity = mapOn ? 0 : 1.1 * Math.min(1, Math.pow(BODIES.planet.radius / Math.max(dPlanet, 1), 2) * 3);
  // planetshine strength follows how lit the planet looks from here
  if (!mapOn) { const lit = SUN_DIR.dot(world.absPos(v, _v2).normalize()) * 0.5 + 0.5; shine.intensity *= lit; }

  // --- camera
  if (mapOn) {
    const c = mcam;
    const off = _v1.set(Math.cos(c.pitch) * Math.cos(c.yaw), Math.cos(c.pitch) * Math.sin(c.yaw), Math.sin(c.pitch)).multiplyScalar(c.dist);
    camera.position.set(off.x, off.z, -off.y);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(50, c.dist * 0.002); camera.far = 4e10;
    map.update(world, origin, camera, { x: innerWidth, y: innerHeight });
  } else {
    enuBasis(v.r);
    const c = fcam;
    const off = _v1.copy(E).multiplyScalar(Math.sin(c.yaw) * Math.cos(c.pitch)).addScaledVector(Nn, Math.cos(c.yaw) * Math.cos(c.pitch)).addScaledVector(Uu, Math.sin(c.pitch)).multiplyScalar(c.dist);
    // keep the camera above the ground
    for (let i = 0; i < 3; i++) {
      const rc = _v2.copy(v.r).add(off);
      const d = B.radius + 3 - rc.length();
      if (d > 0) off.addScaledVector(rc.normalize(), d);
    }
    camera.position.set(off.x, off.z, -off.y);
    camera.up.set(Uu.x, Uu.z, -Uu.y);
    camera.lookAt(0, 0, 0);
    if (dbg.look) camera.lookAt(dbg.look); // debug: aim at a sky direction (used to inspect the skybox)
    camera.near = 0.3; camera.far = 4e10;
  }
  camera.updateProjectionMatrix();

  // --- explosion
  if (explosion) {
    explosion.t += dt;
    const t = explosion.t;
    const a = explosion.pts.geometry.attributes.position;
    for (let i = 0; i < explosion.vel.length; i++) a.setXYZ(i, explosion.vel[i].x * t, explosion.vel[i].y * t, explosion.vel[i].z * t);
    a.needsUpdate = true;
    explosion.pts.position.copy(explosion.pos).sub(origin);
    explosion.pts.material.opacity = Math.max(0, 1 - t / 3.5);
    if (t > 4) { world3.remove(explosion.pts); explosion = null; }
  }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

window.__game = { dbg, world, hud, onAction, BODIES, ventState, map, wrenVis, fcam, mcam, input, THREE, renderer, camera, scene, patch, markers, moonMesh, moonVis, toggleMap: () => toggleMap(), setPaused: (p) => { paused = p; } };
requestAnimationFrame((t) => { last = t; $('loading').classList.add('gone'); hud.toast('Welcome aboard. F1 for controls, M for the map.', 'info'); requestAnimationFrame(frame); });
window.__ready = true;
