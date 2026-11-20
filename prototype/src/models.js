// Procedural ship models: a large carrier and a legged lander (+Y is the nose).
import * as THREE from 'three';

export const LOGDEPTH_VS_PARS = `
#include <common>
#include <logdepthbuf_pars_vertex>
`;
export const LOGDEPTH_VS = `
#include <logdepthbuf_vertex>
`;
export const LOGDEPTH_FS_PARS = `
#include <logdepthbuf_pars_fragment>
`;
export const LOGDEPTH_FS = `
#include <logdepthbuf_fragment>
`;

// ---- textures ----------------------------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function panelTexture(base = '#d6dae2', seed = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  const cell = 64;
  for (let y = 0; y < 512; y += cell) {
    for (let x = 0; x < 512; x += cell) {
      const l = (r() - 0.5) * 22;
      g.fillStyle = `rgba(${l > 0 ? 255 : 0},${l > 0 ? 255 : 0},${l > 0 ? 255 : 0},${Math.abs(l) / 100})`;
      g.fillRect(x, y, cell, cell);
      if (r() < 0.12) { g.fillStyle = 'rgba(30,34,44,0.55)'; g.fillRect(x + 8, y + 10, cell * 0.5, 6); g.fillRect(x + 8, y + 22, cell * 0.5, 6); }
      if (r() < 0.07) { g.fillStyle = 'rgba(232,134,58,0.85)'; g.fillRect(x + 6, y + 6, 14, 14); }
    }
  }
  g.strokeStyle = 'rgba(40,46,60,0.55)'; g.lineWidth = 2;
  for (let i = 0; i <= 512; i += cell) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  g.fillStyle = 'rgba(30,34,44,0.7)';
  for (let y = 0; y < 512; y += cell) for (let x = 0; x < 512; x += cell) for (const [dx, dy] of [[4, 4], [60, 4], [4, 60], [60, 60]]) { g.beginPath(); g.arc(x + dx, y + dy, 1.4, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function solarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#10213f'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#2c4f86'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _tex = null;
function textures() {
  if (!_tex) _tex = { hull: panelTexture('#d9dde5', 3), dark: panelTexture('#59606e', 9), solar: solarTexture() };
  return _tex;
}
function mats() {
  const t = textures();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    hull: std({ color: 0xffffff, map: t.hull, bumpMap: t.hull, bumpScale: 0.8, metalness: 0.55, roughness: 0.42 }),
    dark: std({ color: 0xffffff, map: t.dark, bumpMap: t.dark, bumpScale: 0.8, metalness: 0.7, roughness: 0.5 }),
    orange: std({ color: 0xe8863a, metalness: 0.4, roughness: 0.5 }),
    gold: std({ color: 0xc9a24a, metalness: 0.9, roughness: 0.35 }),
    solar: std({ color: 0xffffff, map: t.solar, metalness: 0.8, roughness: 0.25, emissive: 0x0a1a38, emissiveIntensity: 0.6 }),
    glass: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.9, 0.5) }),
    glowBlue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.6, 3.2) }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1) }),
    green: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4) }),
    bay: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.3, 0.8) }),
    rad: new THREE.MeshStandardMaterial({ color: 0xb8683a, metalness: 0.7, roughness: 0.45, emissive: 0x000000, side: THREE.DoubleSide }),
  };
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
/** cylinder between two points */
function strut(a, b, radius, mat, parent) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---- engine plume ---------------------------------------------------------------------
const plumeVS = `${LOGDEPTH_VS_PARS}
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz);
 gl_Position = projectionMatrix * mv; ${LOGDEPTH_VS} }`;
const plumeFS = `${LOGDEPTH_FS_PARS}
uniform float uTime; uniform float uIntensity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ ${LOGDEPTH_FS}
 float along = 1.0 - vUv.y;                      // 0 at nozzle, 1 at tip
 float edge = pow(abs(dot(normalize(vN), normalize(vV))), 0.6);
 float flick = 0.85 + 0.15 * sin(uTime * 60.0 + along * 14.0) * sin(uTime * 37.0 + along * 5.0);
 float core = exp(-along * 2.6) * edge * flick * (1.0 - smoothstep(0.85, 1.0, along));
 vec3 col = mix(uColor, vec3(1.6, 1.8, 2.6), exp(-along * 5.0));
 gl_FragColor = vec4(col * core * uIntensity * 2.4, core);
}`;
export function makePlume(radius, length, color = new THREE.Color(0.35, 0.6, 1.6)) {
  const geo = new THREE.CylinderGeometry(radius * 0.7, radius * 1.9, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: plumeVS, fragmentShader: plumeFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uColor: { value: color } },
  });
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  m.frustumCulled = false;
  return m;
}

// ---- carrier --------------------------------------------------------------------------------
export function createCarrier() {
  const M = mats();
  const g = new THREE.Group();
  const plumes = [];
  const deploy = { panels: [], radiators: [], legs: [], radMats: [M.rad] };
  const flat = (geo) => { geo.scale(1.35, 1, 0.85); return geo; };

  mesh(flat(new THREE.CylinderGeometry(8, 9.5, 72, 28)), M.hull, g, 0, 0, 0);
  mesh(flat(new THREE.CylinderGeometry(1.5, 8, 38, 28)), M.hull, g, 0, 55, 0);
  mesh(new THREE.SphereGeometry(1.7, 12, 8), M.dark, g, 0, 74.5, 0);
  // bridge
  mesh(new THREE.BoxGeometry(9, 15, 4.5), M.hull, g, 0, 44, 6.2);
  mesh(new THREE.BoxGeometry(7.4, 1.2, 1.6), M.glass, g, 0, 49.5, 8.6);
  // orange hull band
  mesh(flat(new THREE.CylinderGeometry(8.12, 8.12, 3, 28)), M.orange, g, 0, 18, 0);
  mesh(flat(new THREE.CylinderGeometry(8.12, 8.12, 1.4, 28)), M.orange, g, 0, 11, 0).scale.set(1, 1, 1);
  // engine block
  mesh(new THREE.BoxGeometry(30, 24, 15), M.dark, g, 0, -46, 0);
  mesh(new THREE.BoxGeometry(34, 4, 17), M.hull, g, 0, -35, 0);
  const nozGeo = new THREE.CylinderGeometry(2.4, 4.2, 10, 24, 1, true);
  for (const [x, z] of [[-7.8, -3.4], [7.8, -3.4], [-7.8, 3.6], [7.8, 3.6]]) {
    const n = mesh(nozGeo, M.dark, g, x, -63.5, z);
    n.material = M.dark.clone(); n.material.side = THREE.DoubleSide;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(3.7, 20), M.glowBlue.clone());
    glow.rotation.x = Math.PI / 2; glow.position.set(x, -68.2, z); g.add(glow);
    const p = makePlume(4.0, 120); p.position.set(x, -68.2, z); g.add(p);
    plumes.push({ mesh: p, glow, base: 4.0, length: 120 });
  }
  // side habitat pods
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(3.4, 3.4, 56, 18), M.hull, g, s * 18, -4, -1.5);
    mesh(new THREE.SphereGeometry(3.4, 14, 10), M.hull, g, s * 18, 24, -1.5);
    mesh(new THREE.SphereGeometry(3.4, 14, 10), M.dark, g, s * 18, -32, -1.5);
    for (const y of [-22, 0, 16]) mesh(new THREE.BoxGeometry(11, 1.6, 1.6), M.dark, g, s * 11.5, y, -0.8);
    // deployable solar wings (scale out from the hinge) and radiator fins
    mesh(new THREE.BoxGeometry(2.2, 26.5, 1.4), M.gold, g, s * 21.5, -20, -1.5);
    const wing = new THREE.Group(); wing.position.set(s * 22.6, -20, -1.5); wing.userData.axis = 'x'; g.add(wing);
    mesh(new THREE.BoxGeometry(28, 26, 0.5), M.solar, wing, s * 14, 0, 0);
    deploy.panels.push(wing);
    const fin = new THREE.Group(); fin.position.set(s * 3.2, -30, 7.4); fin.userData.axis = 'z'; g.add(fin);
    mesh(new THREE.BoxGeometry(0.35, 20, 13), M.rad, fin, 0, 0, 6.5);
    deploy.radiators.push(fin);
    // nav lights
    mesh(new THREE.SphereGeometry(0.7, 8, 6), s < 0 ? M.red : M.green, g, s * 51.5, -20, -1.5).castShadow = false;
  }
  // belly hangar + docking cradle
  mesh(new THREE.BoxGeometry(17, 30, 3.6), M.dark, g, 0, 3, -8.2);
  mesh(new THREE.BoxGeometry(14, 0.8, 0.5), M.bay, g, 0, -10.5, -10.1);
  mesh(new THREE.BoxGeometry(14, 0.8, 0.5), M.bay, g, 0, 16.5, -10.1);
  for (const x of [-7.5, 7.5]) mesh(new THREE.BoxGeometry(0.8, 28, 0.5), M.bay, g, x, 3, -10.1);
  // dorsal spine, antennas
  mesh(new THREE.BoxGeometry(3, 62, 2), M.dark, g, 0, -12, 7.6);
  for (const [x, y, h] of [[-2, -30, 14], [2.2, -18, 9], [0, 8, 11]]) mesh(new THREE.CylinderGeometry(0.15, 0.15, h, 6), M.hull, g, x, y, 8.6 + h / 2).rotation.x = 0;
  const dish = mesh(new THREE.SphereGeometry(4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), M.hull, g, 0, 22, 10);
  dish.rotation.x = -0.9;
  // windows
  const win = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.3, 0.8), M.glass, 140);
  const mtx = new THREE.Matrix4(); let k = 0;
  const wr = rng(5);
  for (let y = -30; y <= 32; y += 3.1) {
    for (const s of [-1, 1]) {
      for (const z of [2.6, 0.4]) {
        if (k >= 140) break;
        if (wr() < 0.28) continue;
        const xw = 8 * 1.35 * Math.sqrt(Math.max(0.05, 1 - (z / (8 * 0.85)) ** 2)) + 0.1;
        mtx.makeTranslation(s * xw, y, z); win.setMatrixAt(k++, mtx);
      }
    }
  }
  win.count = k; win.instanceMatrix.needsUpdate = true; g.add(win);

  g.userData = { plumes, deploy, dockOffset: new THREE.Vector3(0, 3, -15.5) };
  return g;
}

// ---- lander: a chunky mobile refinery / drilling rover (+Y up, +Z forward, wheels on retractable legs) ----
export function createLander() {
  const M = mats();
  M.oxBlue = new THREE.MeshStandardMaterial({ color: 0x3f7fd6, metalness: 0.5, roughness: 0.4 });
  const g = new THREE.Group();
  const plumes = [];
  const deploy = { panels: [], radiators: [], legs: [], radMats: [M.rad], wheels: [] };
  const box = (w, h, d, mat, parent, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, parent, x, y, z);
  const cyl = (r0, r1, len, seg, mat, parent, x, y, z, rx = 0, rz = 0) => {
    const m = mesh(new THREE.CylinderGeometry(r0, r1, len, seg), mat, parent, x, y, z);
    m.rotation.x = rx; m.rotation.z = rz; return m;
  };

  // chassis: graphite frame with a burnt-orange belly plate
  box(5.6, 0.9, 9.2, M.dark, g, 0, -1.4, 0);
  box(4.4, 0.3, 8.6, M.orange, g, 0, -1.95, 0);
  // refinery module (white hull, orange bands) with a graphite roof deck
  box(4.8, 2.6, 5.4, M.hull, g, 0, 0.35, -0.9);
  box(4.9, 0.26, 5.5, M.orange, g, 0, 1.0, -0.9);
  box(4.9, 0.26, 5.5, M.orange, g, 0, -0.45, -0.9);
  box(4.4, 0.25, 5.0, M.dark, g, 0, 1.78, -0.9);
  // docking tower: hull collar, graphite neck, port
  cyl(1.1, 1.25, 0.9, 16, M.hull, g, 0, 2.35, -0.9);
  cyl(0.6, 0.6, 0.7, 12, M.dark, g, 0, 3.15, -0.9);
  cyl(0.55, 0.55, 0.45, 12, M.dark, g, 0, 3.8, -0.9);
  // process stacks and vents on the roof
  for (const x of [-1.5, 1.5]) { cyl(0.32, 0.32, 1.5, 10, M.dark, g, x, 2.65, -2.5); cyl(0.38, 0.38, 0.25, 10, M.orange, g, x, 3.45, -2.5); }
  for (const z of [0.4, 1.0]) box(1.6, 0.18, 0.28, M.dark, g, 0, 2.0, z);
  // cab
  box(3.6, 2.0, 2.6, M.hull, g, 0, 0.1, 3.1);
  box(3.7, 0.2, 2.7, M.orange, g, 0, 1.2, 3.1);
  box(3.0, 0.55, 0.12, M.glass, g, 0, 0.5, 4.42).castShadow = false;
  for (const x of [-1.3, 1.3]) box(0.4, 0.25, 0.12, M.bay, g, x, -0.55, 4.42).castShadow = false;
  cyl(0.05, 0.05, 1.6, 6, M.hull, g, 1.4, 2.2, 2.7);
  const dish = mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), M.hull, g, 1.4, 3.05, 2.7); dish.rotation.x = -0.8;
  // ore hopper at the rear (funnel)
  const hop = cyl(1.9, 1.25, 1.3, 4, M.dark, g, 0, 0.75, -4.55); hop.rotation.y = Math.PI / 4;
  const rim = cyl(2.0, 2.0, 0.16, 4, M.orange, g, 0, 1.45, -4.55); rim.rotation.y = Math.PI / 4;
  box(3.2, 0.9, 0.2, M.dark, g, 0, -0.1, -5.2);
  // propellant tanks: orange fuel (left), blue oxidizer (right), white bands
  for (const [x, mat] of [[-3.1, M.orange], [3.1, M.oxBlue]]) {
    cyl(0.8, 0.8, 4.4, 20, mat, g, x, 0.55, -0.9, Math.PI / 2, 0);
    for (const z of [-2.5, -0.9, 0.7]) cyl(0.83, 0.83, 0.2, 20, M.hull, g, x, 0.55, z, Math.PI / 2, 0);
    for (const z of [-3.1, 1.3]) mesh(new THREE.SphereGeometry(0.8, 14, 10), mat, g, x, 0.55, z);
    box(0.6, 0.12, 0.5, M.dark, g, x * 0.88, -0.1, -2.1);
    box(0.6, 0.12, 0.5, M.dark, g, x * 0.88, -0.1, 0.3);
  }
  // landing engine (unchanged behaviour): bell + plume under the belly
  const bell = cyl(0.5, 1.05, 1.3, 16, M.dark.clone(), g, 0, -2.7, 0); bell.material.side = THREE.DoubleSide; bell.geometry.dispose(); bell.geometry = new THREE.CylinderGeometry(0.5, 1.05, 1.3, 16, 1, true);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16), M.glowBlue.clone());
  glow.rotation.x = Math.PI / 2; glow.position.set(0, -3.34, 0); g.add(glow);
  const p = makePlume(0.95, 9); p.position.set(0, -3.34, 0); g.add(p);
  plumes.push({ mesh: p, glow, base: 0.95, length: 9 });
  // six wheels on articulated legs that fold up beside the chassis (gear toggle)
  for (const s of [-1, 1]) {
    for (const z of [-3.3, 0, 3.3]) {
      const leg = new THREE.Group(); leg.position.set(s * 2.3, -1.4, z); g.add(leg);
      const hubRel = new THREE.Vector3(s * 1.1, -1.1, 0);
      strut(new THREE.Vector3(), hubRel, 0.22, M.dark, leg);
      strut(new THREE.Vector3(s * 0.15, 0.3, 0), hubRel.clone().multiplyScalar(0.7), 0.12, M.orange, leg);
      const hub = new THREE.Group(); hub.position.copy(hubRel); leg.add(hub);
      const spin = new THREE.Group(); hub.add(spin);
      mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.8, 20), M.dark, spin, 0, 0, 0).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.95, 12), M.orange, spin, 0, 0, 0).rotation.z = Math.PI / 2;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const t = box(0.86, 0.14, 0.3, M.dark, spin, 0, Math.cos(a) * 0.93, Math.sin(a) * 0.93);
        t.rotation.x = -a;
      }
      deploy.wheels.push(spin);
      const qFold = new THREE.Quaternion().setFromUnitVectors(hubRel.clone().normalize(), new THREE.Vector3(s, 0.5, 0).normalize());
      deploy.legs.push({ g: leg, qFold });
    }
  }
  // drill mast on the nose: the bit (animated by main.js) reaches the ground when deployed
  box(0.8, 0.6, 1.0, M.orange, g, 0, -0.85, 4.95);
  box(0.5, 1.4, 0.5, M.dark, g, 0, -0.2, 5.25);
  const drill = new THREE.Group(); drill.position.set(0, -0.8, 5.45); g.add(drill);
  mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.2, 10), M.dark, drill, 0, -1.1, 0);
  mesh(new THREE.ConeGeometry(0.26, 0.55, 10), M.gold, drill, 0, -2.45, 0).rotation.x = Math.PI;
  drill.scale.y = 0.55;
  // deployables: big solar wings on the roof hinge, radiator fan on a rear gantry
  const wing = new THREE.Group(); wing.position.set(0, 1.98, -0.9); wing.userData.axis = 'x'; g.add(wing);
  mesh(new THREE.BoxGeometry(17, 0.1, 4.6), M.solar, wing, 0, 0, 0);
  deploy.panels.push(wing);
  box(0.6, 0.6, 1.2, M.dark, g, 0, 0.55, -5.7);
  const fin = new THREE.Group(); fin.position.set(0, 0.6, -6.4); fin.userData.axis = 'x'; g.add(fin);
  mesh(new THREE.BoxGeometry(13, 0.08, 2.8), M.rad, fin, 0, 0, 0);
  deploy.radiators.push(fin);
  g.userData = { plumes, drill, deploy, dockOffset: new THREE.Vector3() };
  return g;
}

// ---- deployables -------------------------------------------------------------------------
const _qId = new THREE.Quaternion();
/** pose panels / radiators / legs from a vessel's `dep` state (p = 0 folded .. 1 deployed); radiators glow with heat */
export function applyDeploy(group, dep, heatFrac = 0) {
  const d = group.userData.deploy;
  if (!d) return;
  // folded = a short stowed slab on its hinge (still visible), deployed = full span; broken = gone
  const pose = (list, k) => { const dd = dep[k]; for (const o of list) { o.visible = !!dd && dd.ok; o.scale[o.userData.axis] = 0.09 + 0.91 * (dd ? dd.p : 0); } };
  pose(d.panels, 'panels');
  pose(d.radiators, 'radiators');
  const gp = dep.gear ? dep.gear.p : 1;
  for (const l of d.legs) l.g.quaternion.slerpQuaternions(l.qFold, _qId, gp);
  for (const m of d.radMats) m.emissive.setRGB(heatFrac * 1.8, heatFrac * 0.4, 0);
}
