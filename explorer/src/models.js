// Procedural models (no placeholder primitives left bare): chunky white/grey near-future hulls with orange accents,
// merged per material. Forward is -Z, up +Y, units metres, origin at the ground-contact plane.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { setupMat } from './gfx.js';

const V3 = THREE.Vector3;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------ materials
let M = null;
function panelTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f3f4'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${150 + Math.random() * 90},${150 + Math.random() * 90},${150 + Math.random() * 90},0.18)`; g.fillRect(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 120, 14 + Math.random() * 80); }
  g.strokeStyle = 'rgba(40,44,52,0.85)'; g.lineWidth = 3;
  for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  g.strokeStyle = 'rgba(40,44,52,0.35)'; g.lineWidth = 1.5;
  for (let i = 64; i < 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
  g.fillStyle = 'rgba(30,34,40,0.7)';
  for (let x = 10; x < 512; x += 128) for (let y = 10; y < 512; y += 128) for (const [dx, dy] of [[0, 0], [108, 0], [0, 108], [108, 108]]) { g.beginPath(); g.arc(x + dx + 4, y + dy + 4, 2.2, 0, 7); g.fill(); }
  g.fillStyle = '#e9702a'; g.fillRect(140, 140, 100, 12); g.fillStyle = '#25292f'; g.fillRect(270, 30, 60, 30);
  g.fillStyle = '#ffffff'; g.font = 'bold 22px monospace'; g.fillText('HD-07', 276, 52);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function solarTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#0d1a3a'; g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#3a5ea8'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  g.strokeStyle = '#c9ced8'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 508);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function mats() {
  if (M) return M;
  const pt = panelTexture();
  const mk = (o, key) => setupMat(new THREE.MeshStandardMaterial(o), key);
  M = {
    white: mk({ map: pt, color: 0xf4f4f2, roughness: 0.46, metalness: 0.12 }, 'hull'),
    grey: mk({ map: pt, color: 0x8b9099, roughness: 0.5, metalness: 0.35 }, 'hull'),
    dark: mk({ color: 0x1d2026, roughness: 0.75, metalness: 0.4 }, 'dark'),
    metal: mk({ color: 0xb8bcc4, roughness: 0.32, metalness: 0.9 }, 'metal'),
    gold: mk({ color: 0xc7a14a, roughness: 0.35, metalness: 0.85 }, 'metal'),
    orange: mk({ color: 0xe0661f, roughness: 0.5, metalness: 0.15 }, 'paint'),
    glass: mk({ color: 0x0a1018, roughness: 0.06, metalness: 0.95, emissive: 0x241406, emissiveIntensity: 0.6 }, 'glass'),
    rubber: mk({ color: 0x14151a, roughness: 0.95, metalness: 0.0 }, 'dark'),
    solar: mk({ map: solarTexture(), color: 0xffffff, roughness: 0.3, metalness: 0.7 }, 'solar'),
    lampAmber: setupMat(new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff9020, emissiveIntensity: 3.5, roughness: 0.4 }), 'lamp'),
    lampWhite: setupMat(new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff2dd, emissiveIntensity: 6, roughness: 0.4 }), 'lamp'),
    lampRed: setupMat(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a10, emissiveIntensity: 3, roughness: 0.4 }), 'lamp'),
    suit: mk({ color: 0xd9d9d7, roughness: 0.66, metalness: 0.02 }, 'suit'),
    suitGrey: mk({ color: 0x6d7077, roughness: 0.7, metalness: 0.3 }, 'suit'),
    visor: mk({ color: 0x8fb0d8, roughness: 0.03, metalness: 1.0, emissive: 0x1a2a40, emissiveIntensity: 0.25 }, 'visor'),
    chest: setupMat(new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff7a1a, emissiveIntensity: 5 }), 'lamp'),
    insul: mk({ color: 0xc9b27a, roughness: 0.55, metalness: 0.6 }, 'metal'),
    radiator: mk({ map: pt, color: 0xe8e8e6, roughness: 0.5, metalness: 0.2 }, 'hull'),
  };
  return M;
}

// ------------------------------------------------------------------ builder: collect parts, merge per material
function boxUV(g, s = 0.5) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) { uv[i * 2] = p.getZ(i) * s; uv[i * 2 + 1] = p.getY(i) * s; }
    else if (ay >= az) { uv[i * 2] = p.getX(i) * s; uv[i * 2 + 1] = p.getZ(i) * s; }
    else { uv[i * 2] = p.getX(i) * s; uv[i * 2 + 1] = p.getY(i) * s; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
class Builder {
  constructor() { this.parts = new Map(); }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, uvScale = 0.5) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g = boxUV(g, uvScale);
    const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new V3(sx, sy, sz));
    g.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, r = 0.06) { return this.add(mat, r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)) : new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  cyl(mat, rt, rb, h, x, y, z, rx = 0, ry = 0, rz = 0, seg = 18) { return this.add(mat, new THREE.CylinderGeometry(rt, rb, h, seg, 1), x, y, z, rx, ry, rz); }
  sph(mat, r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 20) { return this.add(mat, new THREE.SphereGeometry(r, seg, Math.ceil(seg * 0.7)), x, y, z, 0, 0, 0, sx, sy, sz); }
  build(shadow = true) {
    const grp = new THREE.Group();
    for (const [mat, gs] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(gs, false), mat);
      m.castShadow = shadow && !mat.emissiveIntensity; m.receiveShadow = true; grp.add(m);
    }
    return grp;
  }
}
const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
function bell(r0, r1, h, seg = 24) { const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([r0 + (r1 - r0) * Math.pow(t, 1.7), -h * t]); } pts.push([r1 * 0.98, -h * 1.0]); return lathe(pts, seg); }
function extrudeShape(points, depth, bevel = 0.1) {
  const sh = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2); return g;
}

// ------------------------------------------------------------------ LANDER (Heron)
export function buildLander() {
  const m = mats(), b = new Builder();
  // hull core + upper deck
  b.box(m.white, 4.6, 2.1, 5.0, 0, 2.9, 0, 0, 0, 0, 0.3);
  b.box(m.white, 3.2, 0.9, 3.0, 0, 4.35, 0.7, 0, 0, 0, 0.22);
  b.box(m.grey, 4.8, 0.3, 5.2, 0, 1.75, 0, 0, 0, 0, 0.1);               // belly plate
  b.box(m.grey, 4.4, 0.25, 4.8, 0, 3.95, -0.1, 0, 0, 0, 0.08);
  // sloped cockpit + windows
  b.box(m.white, 3.3, 1.5, 1.6, 0, 3.55, -2.35, -0.32, 0, 0, 0.25);
  b.box(m.glass, 2.7, 0.85, 0.12, 0, 3.75, -3.05, -0.46, 0, 0, 0.04);
  b.box(m.orange, 3.0, 0.1, 0.14, 0, 4.25, -2.95, -0.4, 0, 0, 0.02);
  for (const sx of [-1, 1]) { b.box(m.glass, 0.12, 0.7, 1.3, sx * 2.32, 3.35, -1.7, 0, 0, 0, 0.03); b.box(m.lampAmber, 0.1, 0.12, 0.7, sx * 2.34, 2.5, 0.4, 0, 0, 0, 0.02); }
  // orange stripes
  b.box(m.orange, 4.62, 0.16, 1.2, 0, 2.55, 0.9, 0, 0, 0, 0.02); b.box(m.orange, 4.62, 0.16, 0.5, 0, 2.55, -1.6, 0, 0, 0, 0.02);
  // side tanks
  for (const sx of [-1, 1]) {
    b.cyl(m.white, 0.85, 0.85, 3.6, sx * 3.0, 2.7, 0.5, Math.PI / 2, 0, 0, 24);
    b.sph(m.white, 0.85, sx * 3.0, 2.7, 2.3); b.sph(m.white, 0.85, sx * 3.0, 2.7, -1.3);
    b.cyl(m.grey, 0.9, 0.9, 0.18, sx * 3.0, 2.7, 0.0, Math.PI / 2, 0, 0, 24); b.cyl(m.orange, 0.9, 0.9, 0.22, sx * 3.0, 2.7, 1.1, Math.PI / 2, 0, 0, 24);
    b.box(m.metal, 1.5, 0.18, 0.3, sx * 2.1, 3.3, 0.0, 0, 0, 0, 0.04); b.box(m.metal, 1.5, 0.18, 0.3, sx * 2.1, 2.1, 1.2, 0, 0, 0, 0.04);
    // RCS blocks
    b.box(m.grey, 0.5, 0.45, 0.5, sx * 2.45, 4.1, -2.2, 0, 0, 0, 0.08); b.box(m.grey, 0.5, 0.45, 0.5, sx * 2.45, 4.1, 2.2, 0, 0, 0, 0.08);
    for (const dz of [-2.2, 2.2]) b.cyl(m.dark, 0.05, 0.11, 0.2, sx * 2.45, 4.45, dz, 0, 0, 0, 8);
  }
  // engine
  b.cyl(m.metal, 0.62, 0.78, 0.55, 0, 1.45, 0.1); b.add(m.dark, bell(0.55, 0.95, 1.1), 0, 1.2, 0.1);
  b.cyl(m.gold, 0.7, 0.7, 0.12, 0, 0.95, 0.1, 0, 0, 0, 20);
  // legs
  const feet = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const top = new V3(sx * 2.0, 2.2, sz * 2.2), foot = new V3(sx * 3.6, 0.28, sz * 3.5);
    const mid = top.clone().lerp(foot, 0.5);
    const dir = foot.clone().sub(top), len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), dir.clone().normalize()); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    b.cyl(m.grey, 0.16, 0.2, len, mid.x, mid.y, mid.z, e.x, e.y, e.z, 12);
    b.cyl(m.metal, 0.1, 0.1, len * 0.55, mid.x * 0.98, mid.y + 0.25, mid.z * 0.98, e.x, e.y, e.z, 10);
    const brace = new V3(sx * 0.5, 1.5, sz * 1.0), bd = foot.clone().sub(brace), bl = bd.length(), bm = brace.clone().lerp(foot, 0.5);
    const bq = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), bd.clone().normalize()); const be = new THREE.Euler().setFromQuaternion(bq, 'YXZ');
    b.cyl(m.grey, 0.07, 0.07, bl, bm.x, bm.y, bm.z, be.x, be.y, be.z, 8);
    b.cyl(m.rubber, 0.62, 0.7, 0.16, foot.x, 0.09, foot.z, 0, 0, 0, 20); b.cyl(m.metal, 0.48, 0.5, 0.14, foot.x, 0.22, foot.z, 0, 0, 0, 20);
    b.sph(m.metal, 0.2, foot.x, 0.35, foot.z);
    feet.push(new V3(foot.x, 0, foot.z));
  }
  // dish + antennas + ISRU box with hose
  b.cyl(m.metal, 0.05, 0.05, 1.2, -1.1, 5.2, 1.5); b.add(m.white, new THREE.SphereGeometry(0.75, 20, 10, 0, 6.28, 0, 1.0), -1.1, 5.85, 1.5, -0.7, 0.4, 0, 1, 0.55, 1);
  b.cyl(m.metal, 0.02, 0.02, 2.4, 1.3, 5.5, 2.0); b.sph(m.lampRed, 0.06, 1.3, 6.7, 2.0);
  b.box(m.grey, 1.6, 0.95, 1.0, 1.0, 2.0, 2.65, 0, 0, 0, 0.1); b.box(m.orange, 1.62, 0.12, 1.02, 1.0, 2.35, 2.65, 0, 0, 0, 0.02);
  for (let i = 0; i < 4; i++) b.cyl(m.dark, 0.2, 0.2, 0.1, 0.6 + i * 0.28, 1.95, 3.18, Math.PI / 2, 0, 0, 12);
  // landing lights + nav lights
  for (const sx of [-1, 1]) { b.box(m.lampWhite, 0.5, 0.22, 0.12, sx * 1.4, 3.2, -3.18, -0.5, 0, 0, 0.03); b.box(m.lampAmber, 0.28, 0.2, 0.2, sx * 2.1, 1.85, -2.4, 0, 0, 0, 0.04); }
  b.sph(m.lampRed, 0.08, 2.35, 4.6, 0); b.sph(m.lampAmber, 0.08, -2.35, 4.6, 0);
  // docking port (top)
  b.cyl(m.metal, 0.55, 0.65, 0.35, 0, 4.9, 0.7); b.cyl(m.dark, 0.38, 0.38, 0.1, 0, 5.1, 0.7);
  const group = b.build();
  return { group, feet, engine: new V3(0, 0.95, 0.1), height: 5.0, footRadius: 3.6, lights: [new V3(0, 3.1, -3.2)], dock: new V3(0, 5.1, 0.7) };
}

const mk1 = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };
// ------------------------------------------------------------------ SPACEPLANE (Albatross)
export function buildPlane() {
  const m = mats();
  const root = new THREE.Group();
  const b = new Builder();
  // fuselage: side profile extruded across the width (lifting-body)
  const prof = [[-7.2, 1.15], [-6.0, 1.75], [-3.4, 2.6], [1.5, 2.75], [5.5, 2.5], [7.1, 2.1], [7.2, 0.7], [6.0, 0.35], [-3.0, 0.3], [-6.0, 0.55]].map(([z, y]) => [z, y]);
  const fus = extrudeShape(prof.map(([z, y]) => [z, y]), 3.0, 0.3);   // shape in (x=z_world, y), extruded along z -> rotate so extrusion goes along x
  fus.rotateY(Math.PI / 2);
  b.add(m.white, fus, 0, 0.0, 0, 0, 0, 0, 1, 1, 1, 0.35);
  // dorsal spine + intake scoops
  b.box(m.white, 1.2, 0.7, 7.0, 0, 3.0, 1.5, 0.04, 0, 0, 0.2);
  for (const sx of [-1, 1]) { b.box(m.grey, 0.8, 0.7, 2.6, sx * 1.35, 1.6, -4.2, 0, 0, 0, 0.2); b.box(m.dark, 0.6, 0.5, 0.1, sx * 1.35, 1.6, -5.55, 0, 0, 0, 0.03); }
  // canopy
  b.box(m.glass, 1.8, 0.6, 2.4, 0, 3.0, -5.0, -0.34, 0, 0, 0.2); b.box(m.orange, 2.0, 0.08, 0.2, 0, 3.15, -3.7, -0.1, 0, 0, 0.02);
  // delta wings (cranked): planform in x,z extruded thin in y
  for (const sx of [-1, 1]) {
    const wing = extrudeShape([[0, 4.8], [sx * 7.4, 3.0], [sx * 7.4, 1.2], [sx * 2.0, -2.8], [0, -3.6]].map(([x, z]) => [x, z]), 0.32, 0.08);
    wing.rotateX(Math.PI / 2);
    b.add(m.white, wing, 0, 1.15, 1.0, 0, 0, 0, 1, 1, 1, 0.35);
    b.box(m.orange, 0.12, 0.35, 2.2, sx * 7.4, 1.2, 2.4, 0, 0, 0, 0.02);                   // wingtip stripe
    b.box(m.grey, 3.4, 0.22, 1.0, sx * 5.0, 1.15, 4.9, 0, 0, sx * 0.0, 0.05);              // elevons
    // twin canted tails
    b.box(m.white, 0.28, 3.0, 2.8, sx * 2.2, 3.7, 5.2, 0, 0, sx * -0.28, 0.1);
    b.box(m.orange, 0.3, 0.5, 2.0, sx * 2.45, 5.0, 5.2, 0, 0, sx * -0.28, 0.02);
    b.box(m.lampRed, 0.12, 0.14, 0.14, sx * 2.5, 5.25, 6.2, 0, 0, 0, 0.02);
    // main engines (aft) + nozzles
    b.cyl(m.metal, 0.75, 0.85, 2.0, sx * 1.35, 1.4, 6.8, Math.PI / 2, 0, 0, 20); b.add(m.dark, bell(0.7, 0.98, 0.9), sx * 1.35, 1.4, 7.9, Math.PI / 2, 0, 0);
    b.cyl(m.gold, 0.82, 0.82, 0.1, sx * 1.35, 1.4, 7.9, Math.PI / 2, 0, 0, 20);
  }
  b.box(m.white, 3.4, 1.5, 3.0, 0, 1.55, 6.6, 0, 0, 0, 0.2);
  // belly: cargo bay doors + VTOL lift nozzles + landing gear bays
  b.box(m.grey, 2.3, 0.14, 3.8, 0, 0.35, 3.2, 0, 0, 0, 0.04);                              // bay floor frame
  // (no VTOL lift nozzles: airless landings are tail-first on the main engines)
  // nuclear-thermal pod (small), top aft
  b.cyl(m.dark, 0.55, 0.55, 1.8, 0, 3.4, 5.3, Math.PI / 2, 0, 0, 16); b.cyl(m.orange, 0.57, 0.57, 0.24, 0, 3.4, 4.5, Math.PI / 2, 0, 0, 16);
  b.add(m.dark, bell(0.4, 0.6, 0.55), 0, 3.4, 6.3, Math.PI / 2, 0, 0);
  // lights
  for (const sx of [-1, 1]) { b.box(m.lampWhite, 0.4, 0.18, 0.12, sx * 0.8, 1.2, -6.95, 0, 0, 0, 0.02); b.box(m.lampAmber, 0.2, 0.18, 0.4, sx * 3.2, 1.15, 0.8, 0, 0, 0, 0.03); }
  b.box(m.lampAmber, 1.0, 0.1, 0.1, 0, 3.0, 5.0, 0, 0, 0, 0.02);
  root.add(b.build());
  // fuselage group sits on the wheeled undercarriage (belly 1.55 m above the ground when horizontal)
  root.children[0].position.y = 1.25;
  // ---- animated parts
  const parts = { panels: [], radiators: [], ramp: null, tailLegs: [], wheels: null };
  // solar panels: two folding arrays on the dorsal flanks (stowed flat on the spine, deploy outwards/up)
  for (const sx of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(sx * 0.7, 4.3, 1.8); root.add(hinge);
    const inner = new THREE.Group(); hinge.add(inner);
    inner.add(mk1(new THREE.BoxGeometry(2.4, 0.07, 4.6), m.solar, sx * 1.2, 0, 0));
    inner.add(mk1(new THREE.BoxGeometry(2.2, 0.06, 4.6), m.metal, sx * 1.2, -0.07, 0));
    const hinge2 = new THREE.Group(); hinge2.position.set(sx * 2.4, 0, 0); inner.add(hinge2);
    hinge2.add(mk1(new THREE.BoxGeometry(2.4, 0.07, 4.6), m.solar, sx * 1.2, 0, 0));
    parts.panels.push({ inner, outer: hinge2, sx });
  }
  // radiator fins: fold flat against the aft flanks, swing out
  for (const sx of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(sx * 1.75, 2.1, 6.3); root.add(piv);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 3.4), m.radiator); fin.position.set(sx * 1.5, 0, 0); fin.castShadow = true; piv.add(fin);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.12, 0.16), m.orange); edge.position.set(sx * 1.5, 0, 1.7); piv.add(edge);
    parts.radiators.push({ piv, sx });
  }
  // cargo ramp: hinged at the aft bay lip, swings down to the ground
  const ramp = new THREE.Group(); ramp.position.set(0, 1.55, 6.15); root.add(ramp);
  const rb = new Builder(); rb.box(m.grey, 2.2, 0.16, 3.4, 0, 0, 1.7, 0, 0, 0, 0.04); rb.box(m.orange, 0.12, 0.2, 3.4, 1.0, 0.05, 1.7, 0, 0, 0, 0.02); rb.box(m.orange, 0.12, 0.2, 3.4, -1.0, 0.05, 1.7, 0, 0, 0, 0.02);
  for (let i = 0; i < 8; i++) rb.box(m.dark, 2.0, 0.04, 0.12, 0, 0.09, 0.4 + i * 0.4, 0, 0, 0, 0.01);
  ramp.add(rb.build()); parts.ramp = ramp;
  // dark cargo bay interior visible when the ramp is open
  const bay = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 0.2), m.dark); bay.position.set(0, 2.2, 6.0); root.add(bay);
  parts.rampEnd = new V3(0, 0, 9.2);
  parts.engines = [new V3(-1.35, 2.65, 7.95), new V3(1.35, 2.65, 7.95)];
  parts.nuke = new V3(0, 4.65, 6.4);
  parts.lights = [new V3(0, 2.4, -7.0)];
  let setDeploy = (name, t) => {
    if (name === 'panels') for (const p of parts.panels) { p.inner.rotation.z = p.sx * t * (80 * D2R); p.outer.rotation.z = -p.sx * (1 - t) * Math.PI * 0.985; p.outer.position.y = 0.1; }
    if (name === 'radiators') for (const r of parts.radiators) r.piv.rotation.z = r.sx * (1 - t) * Math.PI / 2;
    if (name === 'ramp') parts.ramp.rotation.x = t * 0.47;
  };
  // ---- tail landing legs (deploy around the engines; stowed folded forward along the hull)
  const tl = new Builder();
  tl.cyl(m.grey, 0.17, 0.2, 3.95, 0, 0, 1.97, Math.PI / 2, 0, 0, 12); tl.cyl(m.metal, 0.1, 0.1, 2.2, 0, 0.14, 2.7, Math.PI / 2, 0, 0, 10);
  tl.cyl(m.rubber, 0.62, 0.7, 0.16, 0, 0, 3.98, Math.PI / 2, 0, 0, 18); tl.cyl(m.metal, 0.46, 0.5, 0.14, 0, 0, 3.86, Math.PI / 2, 0, 0, 16); tl.sph(m.metal, 0.2, 0, 0, 3.75);
  const legGeo = tl.build();
  const legSpec = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const piv = new THREE.Group(); piv.position.set(sx * 1.9, 2.65 + sy * 1.9, 6.4);
    const leg = legGeo.clone(); piv.add(leg); root.add(piv);
    const dep = new V3(sx * 1.6, sy * 1.6, 3.2).normalize(), sto = new V3(sx * 0.18, sy * 0.18, -1).normalize();
    const qd = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dep), qs = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), sto);
    parts.tailLegs.push({ piv, qd, qs });
    legSpec.push(new V3(sx * 3.5, sy * 3.5, 0));
  }
  // ---- wheeled undercarriage for horizontal stance (deploys before the tip-down)
  const wheelsG = new THREE.Group(); root.add(wheelsG);
  const wb = new Builder();
  for (const [x, z, big] of [[0, -5.0, 0], [-2.7, 3.0, 1], [2.7, 3.0, 1]]) {
    wb.cyl(m.metal, 0.09, 0.11, 1.15, x, 1.0, z, 0, 0, 0, 10); wb.cyl(m.grey, 0.16, 0.16, 0.5, x, 1.2, z, 0, 0, 0, 10);
    wb.add(m.rubber, new THREE.CylinderGeometry(0.5, 0.5, big ? 0.42 : 0.3, 20), x, 0.5, z, 0, 0, Math.PI / 2); wb.add(m.metal, new THREE.CylinderGeometry(0.28, 0.28, big ? 0.46 : 0.34, 16), x, 0.5, z, 0, 0, Math.PI / 2);
  }
  wheelsG.add(wb.build()); parts.wheels = wheelsG;
  setDeploy = ((orig) => (name, t) => {
    if (name === 'legs') for (const l of parts.tailLegs) l.piv.quaternion.copy(l.qs).slerp(l.qd, Math.min(1, Math.max(0, t)));
    else if (name === 'wheels') { wheelsG.position.y = (1 - t) * 1.3; wheelsG.visible = t > 0.02; }
    else orig(name, t);
  })(setDeploy);
  setDeploy('panels', 0); setDeploy('radiators', 0); setDeploy('ramp', 0); setDeploy('legs', 1); setDeploy('wheels', 0);
  // ---- stance rig: vertical (tail-down) pose, tipped to horizontal about the tail-gear pivot
  const flight = new THREE.Group(), tipG = new THREE.Group();
  flight.add(tipG); tipG.add(root);
  root.quaternion.setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2); root.position.set(0, 9.7, -2.65);
  const setTip = (tip) => { tipG.rotation.set(-tip * Math.PI / 2, 0, 0); tipG.position.set(0, 2.65 * tip, 0); };
  setTip(0);
  const feetFlight = [new V3(-3.5, 0, -3.5), new V3(3.5, 0, -3.5), new V3(-3.5, 0, 3.5), new V3(3.5, 0, 3.5)];
  parts.rampEndLocal = new V3(0, 0, -0.5);        // flight-frame position of the ramp foot once flat
  return { group: flight, rig: root, tipG, feet: feetFlight, parts, setDeploy, setTip, height: 16.5, footRadius: 4.9, dock: new V3(0, 16, 0) };
}

// ------------------------------------------------------------------ CARRIER (Wayfarer)
export function buildCarrier() {
  const m = mats(), b = new Builder();
  // central truss spine along z (front = -z)
  b.cyl(m.grey, 0.55, 0.55, 46, 0, 0, 0, Math.PI / 2, 0, 0, 12);
  for (let i = -10; i <= 10; i++) { b.box(m.metal, 1.5, 0.12, 0.12, 0, 0, i * 2.2, 0, 0, 0, 0.02); b.box(m.metal, 0.12, 1.5, 0.12, 0, 0, i * 2.2, 0, 0, 0, 0.02); }
  // crew hab (front): armoured cylinder + window band + ring
  b.cyl(m.white, 3.2, 3.2, 11, 0, 0, -17, Math.PI / 2, 0, 0, 32);
  b.sph(m.white, 3.2, 0, 0, -22.5, 1, 1, 0.55, 32);
  b.cyl(m.glass, 3.25, 3.25, 1.0, 0, 0, -20, Math.PI / 2, 0, 0, 32);
  b.cyl(m.orange, 3.3, 3.3, 0.5, 0, 0, -12.3, Math.PI / 2, 0, 0, 32); b.cyl(m.orange, 3.3, 3.3, 0.35, 0, 0, -21.5, Math.PI / 2, 0, 0, 32);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; b.box(m.lampAmber, 0.25, 0.25, 0.1, Math.cos(a) * 3.27, Math.sin(a) * 3.27, -16.5 - (i % 2), 0, 0, a, 0.02); }
  b.cyl(m.metal, 0.9, 1.1, 0.8, 0, 0, -23.4, Math.PI / 2, 0, 0, 20);
  // propellant tanks (4 around the truss)
  for (const [x, y] of [[-3.1, 3.1], [3.1, 3.1], [-3.1, -3.1], [3.1, -3.1]]) {
    b.cyl(m.insul, 2.15, 2.15, 14, x, y, -2, Math.PI / 2, 0, 0, 28);
    b.sph(m.insul, 2.15, x, y, 5, 1, 1, 0.6, 28); b.sph(m.insul, 2.15, x, y, -9, 1, 1, 0.6, 28);
    b.cyl(m.grey, 2.2, 2.2, 0.4, x, y, -2 + 3.5, Math.PI / 2, 0, 0, 28); b.cyl(m.grey, 2.2, 2.2, 0.4, x, y, -2 - 3.5, Math.PI / 2, 0, 0, 28);
    b.box(m.metal, 0.3, Math.abs(y) * 0.7, 0.3, x * 0.5, y * 0.5, -1.2, 0, 0, 0, 0.03); b.box(m.metal, 0.3, Math.abs(y) * 0.7, 0.3, x * 0.5, y * 0.5, 2.8, 0, 0, 0, 0.03);
  }
  // reactor + shield + engine
  b.cyl(m.dark, 1.6, 1.6, 5.0, 0, 0, 12, Math.PI / 2, 0, 0, 24); b.cyl(m.gold, 3.0, 3.0, 0.35, 0, 0, 9.3, Math.PI / 2, 0, 0, 36); b.cyl(m.orange, 3.02, 3.02, 0.12, 0, 0, 9.6, Math.PI / 2, 0, 0, 36);
  b.add(m.dark, bell(1.1, 3.0, 5.0), 0, 0, 14.3, Math.PI / 2, 0, 0); b.cyl(m.gold, 3.05, 3.05, 0.2, 0, 0, 19.3, Math.PI / 2, 0, 0, 36);
  b.cyl(m.metal, 1.1, 1.3, 0.8, 0, 0, 14.0, Math.PI / 2, 0, 0, 20);
  // radiator wings (large, orange-edged)
  for (const sx of [-1, 1]) for (const dz of [8.5, 12.5]) {
    b.box(m.radiator, 9.0, 0.14, 3.2, sx * 7.6, 0, dz, 0, 0, 0, 0.03); b.box(m.orange, 9.1, 0.18, 0.18, sx * 7.6, 0, dz + 1.6, 0, 0, 0, 0.02);
    b.box(m.metal, 0.2, 0.2, 3.0, sx * 3.2, 0, dz, 0, 0, 0, 0.03);
  }
  // docking cradles (port: lander left, plane right) + nav lights
  b.box(m.grey, 3.0, 0.5, 4.0, -5.2, -1.6, -5.0, 0, 0, 0, 0.1); b.box(m.grey, 3.0, 0.5, 6.0, 5.2, -1.6, -3.0, 0, 0, 0, 0.1);
  b.box(m.metal, 0.4, 1.6, 0.4, -3.6, -0.9, -5.0, 0, 0, -0.4, 0.04); b.box(m.metal, 0.4, 1.6, 0.4, 3.6, -0.9, -3.0, 0, 0, 0.4, 0.04);
  b.sph(m.lampRed, 0.15, -3.4, 3.4, 15); b.sph(m.lampAmber, 0.15, 3.4, 3.4, 15); b.sph(m.lampWhite, 0.15, 0, 3.4, -23);
  const group = b.build();
  return { group, nozzle: new V3(0, 0, 19.4), ports: { lander: new V3(-5.2, -1.3, -5.0), plane: new V3(5.2, -1.3, -3.0) }, length: 46 };
}

// ------------------------------------------------------------------ ASTRONAUT
// ---- stylised female astronaut: smooth sculpted (lathe-like) body, fitted flight suit with panel seams, rounded helmet
/** swept elliptical rows -> smooth closed mesh. rows: [{y, rx, rz, cz?}]. bust adds a gentle forward bulge. */
function sculpt(rows, seg = 28, bust = null) {
  const pos = [], idx = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const x = r.rx * c; let z = (r.cz || 0) + r.rz * s;
      if (bust && s < 0) { const dx = (Math.abs(x) - bust.dx) / bust.w, dy = (r.y - bust.y) / bust.h; z -= bust.a * Math.exp(-(dx * dx + dy * dy)) * -s; }
      pos.push(x, r.y, z);
    }
  }
  for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * (seg + 1) + k, b = a + 1, c2 = a + seg + 1, d = c2 + 1;
    idx.push(a, c2, b, b, c2, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // orient outward regardless of row order
  const nrm = g.attributes.normal, p = g.attributes.position; let dot = 0; for (let i = 0; i < p.count; i++) dot += nrm.getX(i) * p.getX(i) + nrm.getZ(i) * p.getZ(i);
  if (dot < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}
const prof = (pts, sx = 1, sz = 1) => pts.map(([y, r]) => ({ y, rx: r * sx, rz: r * sz }));
function rowAt(rows, y) {
  const a = rows[0].y < rows[rows.length - 1].y ? rows : rows.slice().reverse();
  if (y <= a[0].y) return a[0];
  if (y >= a[a.length - 1].y) return a[a.length - 1];
  for (let i = 0; i < a.length - 1; i++) if (y >= a[i].y && y <= a[i + 1].y) {
    const t = (y - a[i].y) / (a[i + 1].y - a[i].y);
    return { y, rx: a[i].rx + (a[i + 1].rx - a[i].rx) * t, rz: a[i].rz + (a[i + 1].rz - a[i].rz) * t, cz: (a[i].cz || 0) + ((a[i + 1].cz || 0) - (a[i].cz || 0)) * t };
  }
}
/** sub-band of a profile, slightly inflated: colour blocking on the suit */
function band(rows, y0, y1, infl, n = 8) {
  const out = []; for (let i = 0; i <= n; i++) { const y = y0 + (y1 - y0) * (i / n); const r = rowAt(rows, y); out.push({ y, rx: r.rx + infl, rz: r.rz + infl, cz: r.cz }); } return out;
}
/** thin tube following the surface at angle phi (0 = +x side, -PI/2 = front) between y0..y1 */
function seam(rows, phi, y0, y1, rad = 0.0035, off = 0.003, n = 14) {
  const pts = []; for (let i = 0; i <= n; i++) { const y = y0 + (y1 - y0) * (i / n); const r = rowAt(rows, y); pts.push(new V3(Math.cos(phi) * (r.rx + off), y, (r.cz || 0) + Math.sin(phi) * (r.rz + off))); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, rad, 5, false);
}

export function buildAstronaut() {
  const m = mats();
  const root = new THREE.Group();
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = !mat.emissiveIntensity; o.receiveShadow = true; return o; };
  const sph = (r, mat, sx = 1, sy = 1, sz = 1) => { const o = mesh(new THREE.SphereGeometry(r, 20, 14), mat); o.scale.set(sx, sy, sz); return o; };
  const ring = (r, tube, mat, y = 0) => { const o = mesh(new THREE.TorusGeometry(r, tube, 8, 28), mat); o.rotation.x = Math.PI / 2; o.position.y = y; return o; };
  // ---------------- pelvis + hips (y 0 = hip centre)
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const pelvisRows = [
    { y: -0.2, rx: 0.02, rz: 0.02 }, { y: -0.17, rx: 0.13, rz: 0.1 }, { y: -0.11, rx: 0.2, rz: 0.142, cz: 0.014 }, { y: -0.04, rx: 0.222, rz: 0.156, cz: 0.016 },
    { y: 0.03, rx: 0.192, rz: 0.138, cz: 0.006 }, { y: 0.09, rx: 0.14, rz: 0.1 }, { y: 0.13, rx: 0.108, rz: 0.082 },
  ];
  hips.add(mesh(sculpt(pelvisRows, 32), m.suit));
  hips.add(mesh(sculpt(band(pelvisRows, 0.045, 0.1, 0.004), 32), m.suitGrey));                   // grey belt band
  hips.add(mesh(sculpt(band(pelvisRows, 0.098, 0.118, 0.006), 32), m.orange));                   // orange waist trim
  // ---------------- torso (group sits at the waist; hourglass with gentle bust shaping)
  const torso = new THREE.Group(); torso.position.y = 0.11; hips.add(torso);
  const torsoRows = [
    { y: 0.0, rx: 0.108, rz: 0.082 }, { y: 0.06, rx: 0.108, rz: 0.084 }, { y: 0.17, rx: 0.14, rz: 0.108 }, { y: 0.30, rx: 0.17, rz: 0.12 },
    { y: 0.40, rx: 0.172, rz: 0.118 }, { y: 0.47, rx: 0.166, rz: 0.108 }, { y: 0.52, rx: 0.14, rz: 0.096 }, { y: 0.555, rx: 0.08, rz: 0.066 }, { y: 0.575, rx: 0.056, rz: 0.052 },
  ];
  const bust = { dx: 0.07, w: 0.06, y: 0.31, h: 0.07, a: 0.036 };
  torso.add(mesh(sculpt(torsoRows, 36, bust), m.suit));
  torso.add(mesh(sculpt(band(torsoRows, 0.46, 0.53, 0.004, 6), 36), m.suitGrey));                // shoulder yoke
  for (const sx of [-1, 1]) {                                                                    // seams: side stripes + panel lines
    torso.add(mesh(seam(torsoRows, sx > 0 ? 0.0 : Math.PI, 0.02, 0.5, 0.0075, 0.002), m.orange));
    torso.add(mesh(seam(torsoRows, sx > 0 ? -0.62 : Math.PI + 0.62, 0.24, 0.5, 0.0032, 0.004), m.dark));
    torso.add(mesh(seam(torsoRows, sx > 0 ? -2.1 : -1.04, 0.06, 0.24, 0.0032, 0.003), m.dark));
  }
  torso.add(mesh(seam(torsoRows, -Math.PI / 2, 0.02, 0.5, 0.0032, 0.012), m.dark));              // centre zip line
  // chest light + control plate + glowing collar trim
  const chestL = mesh(new THREE.CircleGeometry(0.02, 16), m.chest, -0.082, 0.385, -0.129); chestL.rotation.y = Math.PI; torso.add(chestL);
  torso.add(mesh(new RoundedBoxGeometry(0.05, 0.034, 0.012, 2, 0.006), m.dark, 0.082, 0.39, -0.128));
  torso.add(ring(0.066, 0.0075, m.chest, 0.552));
  // slim life-support backpack
  const pack = new THREE.Group(); pack.position.set(0, 0.3, 0.145); torso.add(pack);
  pack.add(mesh(new RoundedBoxGeometry(0.27, 0.4, 0.1, 4, 0.04), m.suit, 0, 0.04, 0.02));
  pack.add(mesh(new RoundedBoxGeometry(0.2, 0.26, 0.05, 3, 0.02), m.suitGrey, 0, 0.1, 0.075));
  pack.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.052), m.orange, 0, -0.08, 0.075));
  for (const sx of [-1, 1]) pack.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 14), m.metal, sx * 0.075, 0.1, 0.12));
  const jet = []; for (const sx of [-0.085, 0.085]) { const n = mesh(new THREE.CylinderGeometry(0.026, 0.04, 0.06, 12), m.dark, sx, -0.17, 0.045); pack.add(n); jet.push(n); }
  pack.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), m.metal, 0.11, 0.3, 0.02));
  // neck + helmet
  const neck = new THREE.Group(); neck.position.set(0, 0.575, -0.005); torso.add(neck);
  neck.add(mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.07, 16), m.suitGrey, 0, 0.02, 0));
  neck.add(ring(0.072, 0.014, m.orange, 0.04));
  const helmet = sph(0.185, m.suit, 1, 1.02, 1.05); helmet.position.set(0, 0.215, 0.0); neck.add(helmet);
  const visor = mesh(new THREE.SphereGeometry(0.19, 40, 28, -1.15, 2.3, 0.62, 1.2), m.visor, 0, 0.215, -0.012); visor.scale.set(1, 1.02, 1.05); visor.rotation.y = -Math.PI / 2; neck.add(visor);
  for (const sx of [-1, 1]) neck.add(mesh(new THREE.BoxGeometry(0.03, 0.04, 0.04), m.lampWhite, sx * 0.186, 0.245, -0.05));
  neck.add(mesh(new THREE.BoxGeometry(0.1, 0.014, 0.012), m.orange, 0, 0.395, -0.075));           // helmet crest stripe
  // ---------------- arms
  const armUpper = prof([[0.03, 0.05], [-0.03, 0.05], [-0.14, 0.043], [-0.27, 0.036], [-0.31, 0.033]], 1, 0.95);
  const armLower = prof([[0.03, 0.036], [-0.06, 0.036], [-0.16, 0.03], [-0.25, 0.026], [-0.27, 0.024]], 1, 0.95);
  const arm = (sx) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.178, 0.49, 0); torso.add(sh);
    sh.add(sph(0.054, m.suit));
    sh.add(mesh(sculpt(armUpper, 18), m.suit));
    sh.add(mesh(sculpt(band(armUpper, -0.16, -0.11, 0.003, 3), 18), m.orange));
    sh.add(mesh(sculpt(band(armUpper, -0.02, 0.0, 0.004, 3), 18), m.suitGrey));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    el.add(sph(0.036, m.suit));
    el.add(mesh(sculpt(armLower, 16), m.suit));
    el.add(mesh(sculpt(band(armLower, -0.2, -0.255, 0.004, 3), 16), m.suitGrey));                // wrist cuff
    el.add(ring(0.029, 0.005, m.orange, -0.24));
    const hand = sph(0.038, m.suitGrey, 1, 1.3, 0.85); hand.position.y = -0.31; el.add(hand);     // mitten
    const thumb = sph(0.017, m.suitGrey, 1, 1.5, 1); thumb.position.set(-sx * 0.03, -0.3, -0.012); el.add(thumb);
    return { sh, el };
  };
  const aL = arm(-1), aR = arm(1);
  // ---------------- legs
  const thighRows = prof([[0.03, 0.108], [-0.04, 0.108], [-0.2, 0.09], [-0.34, 0.072], [-0.43, 0.06]], 1, 1.04);
  const calfRows = prof([[0.03, 0.058], [-0.08, 0.062], [-0.2, 0.054], [-0.33, 0.04], [-0.4, 0.036]], 1, 1.06);
  const leg = (sx) => {
    const hp = new THREE.Group(); hp.position.set(sx * 0.098, -0.085, 0); hips.add(hp);
    hp.add(sph(0.106, m.suit));
    hp.add(mesh(sculpt(thighRows, 22), m.suit));
    hp.add(mesh(sculpt(band(thighRows, -0.24, -0.29, 0.003, 3), 22), m.orange));
    const kn = new THREE.Group(); kn.position.y = -0.43; hp.add(kn);
    kn.add(sph(0.058, m.suit));
    kn.add(mesh(sculpt(calfRows, 20), m.suit));
    kn.add(mesh(sculpt(band(calfRows, -0.2, -0.38, 0.0035, 5), 20), m.suitGrey));                 // grey lower-leg boot sleeve
    kn.add(mesh(sculpt(band(calfRows, -0.075, -0.095, 0.004, 3), 20), m.orange));
    const boot = sph(0.05, m.suitGrey, 1.05, 0.9, 2.3); boot.position.set(0, -0.435, -0.045); kn.add(boot);
    kn.add(mesh(new RoundedBoxGeometry(0.105, 0.022, 0.255, 2, 0.01), m.orange, 0, -0.475, -0.04));
    return { hp, kn };
  };
  const lL = leg(-1), lR = leg(1);
  const HIP = 0.95;
  const parts = { hips, torso, neck, aL, aR, lL, lR, jet };
  const R = (o, x, y = 0, z = 0) => o.rotation.set(x, y, z);
  const pose = {
    walk(phase, amp = 1) {
      const s = Math.sin(phase), c = Math.cos(phase);
      R(lL.hp, s * 0.62 * amp); R(lR.hp, -s * 0.62 * amp);
      R(lL.kn, Math.max(0, -c) * 0.95 * amp + 0.06); R(lR.kn, Math.max(0, c) * 0.95 * amp + 0.06);
      R(aL.sh, -s * 0.55 * amp, 0, 0.1); R(aR.sh, s * 0.55 * amp, 0, -0.1);
      R(aL.el, -0.25 - Math.max(0, s) * 0.55 * amp); R(aR.el, -0.25 - Math.max(0, -s) * 0.55 * amp);
      hips.position.y = HIP - Math.abs(c) * 0.04 * amp; hips.rotation.set(0, s * 0.1 * amp, -s * 0.03 * amp); R(torso, 0.05 * amp, -s * 0.12 * amp, s * 0.03 * amp); R(neck, 0);
    },
    run(phase, amp = 1) {
      const s = Math.sin(phase), c = Math.cos(phase);
      R(lL.hp, s * 1.0 * amp - 0.1); R(lR.hp, -s * 1.0 * amp - 0.1);
      R(lL.kn, Math.max(0, -c) * 1.7 * amp + 0.25); R(lR.kn, Math.max(0, c) * 1.7 * amp + 0.25);
      R(aL.sh, -s * 0.95 * amp, 0, 0.12); R(aR.sh, s * 0.95 * amp, 0, -0.12);
      R(aL.el, -1.25 - Math.max(0, s) * 0.2); R(aR.el, -1.25 - Math.max(0, -s) * 0.2);
      hips.position.y = HIP - 0.04 - Math.abs(c) * 0.06 * amp; hips.rotation.set(0, s * 0.18 * amp, -s * 0.05 * amp); R(torso, 0.3 * amp, -s * 0.2 * amp, s * 0.04 * amp);
      R(neck, -0.2 * amp);
    },
    idle(t) {
      R(lL.hp, 0, 0, 0.02); R(lR.hp, 0, 0, -0.02); R(lL.kn, 0.04); R(lR.kn, 0.04);
      R(aL.sh, Math.sin(t * 1.3) * 0.04, 0, 0.17); R(aR.sh, -Math.sin(t * 1.3) * 0.04, 0, -0.17); R(aL.el, -0.28); R(aR.el, -0.28);
      hips.position.y = HIP + Math.sin(t * 1.6) * 0.004; hips.rotation.set(0, 0, 0.015); R(torso, Math.sin(t * 0.8) * 0.01, Math.sin(t * 0.5) * 0.04, -0.015); R(neck, 0, Math.sin(t * 0.5) * 0.06);
    },
    air(t) {
      R(lL.hp, 0.5 + Math.sin(t * 2) * 0.1); R(lR.hp, -0.35); R(lL.kn, 0.75); R(lR.kn, 0.55);
      R(aL.sh, -0.45, 0, 0.75); R(aR.sh, -0.45, 0, -0.75); R(aL.el, -0.45); R(aR.el, -0.45); hips.position.y = HIP; hips.rotation.set(0, 0, 0); R(torso, 0.1); R(neck, 0);
    },
    ride(steer = 0, lean = 0) {
      hips.position.y = 0.52; hips.rotation.set(0, 0, 0); R(torso, 0.42, steer * 0.2, lean * 0.15); R(neck, -0.3);
      R(lL.hp, -1.15, 0, 0.16); R(lR.hp, -1.15, 0, -0.16); R(lL.kn, 1.5); R(lR.kn, 1.5);
      R(aL.sh, -1.15, 0, 0.22); R(aR.sh, -1.15, 0, -0.22); R(aL.el, -0.5); R(aR.el, -0.5);
    },
  };
  root.userData = { parts, pose };
  return { group: root, parts, pose };
}

// ------------------------------------------------------------------ DIRT BIKE
export function buildBike() {
  const m = mats();
  const root = new THREE.Group();
  const wheelR = 0.4;
  const wheel = () => {
    const g = new THREE.Group();
    const wb = new Builder();
    wb.add(m.rubber, new THREE.TorusGeometry(wheelR - 0.07, 0.085, 12, 36), 0, 0, 0, 0, Math.PI / 2, 0);
    wb.cyl(m.metal, wheelR - 0.14, wheelR - 0.14, 0.12, 0, 0, 0, 0, 0, Math.PI / 2, 28);
    wb.cyl(m.dark, wheelR - 0.2, wheelR - 0.2, 0.14, 0, 0, 0, 0, 0, Math.PI / 2, 28);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI; wb.box(m.metal, 0.03, wheelR - 0.16, 0.02, 0, 0, 0, a, 0, 0, 0.005); }
    wb.cyl(m.orange, 0.06, 0.06, 0.2, 0, 0, 0, 0, 0, Math.PI / 2, 14);
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; wb.box(m.rubber, 0.13, 0.055, 0.085, 0, Math.cos(a) * (wheelR - 0.005), Math.sin(a) * (wheelR - 0.005), a, 0, 0, 0.01); }
    g.add(wb.build()); return g;
  };
  const front = new THREE.Group(), rear = new THREE.Group();
  const fw = wheel(), rw = wheel(); front.add(fw); rear.add(rw);
  const fork = new THREE.Group(); // steering assembly pivot at head tube
  const b = new Builder();
  // frame
  b.box(m.grey, 0.22, 0.28, 0.9, 0, 0.62, 0.15, 0.25, 0, 0, 0.05);                         // battery pack
  b.box(m.white, 0.3, 0.3, 0.7, 0, 0.78, -0.12, -0.15, 0, 0, 0.1);                           // tank/shroud
  b.box(m.orange, 0.32, 0.06, 0.5, 0, 0.95, -0.15, -0.15, 0, 0, 0.02);
  b.box(m.dark, 0.28, 0.1, 0.8, 0, 0.9, 0.45, 0.1, 0, 0, 0.04);                              // seat
  b.box(m.white, 0.2, 0.06, 0.55, 0, 0.78, 0.98, 0.45, 0, 0, 0.02);                          // rear fender
  b.cyl(m.metal, 0.03, 0.03, 0.8, 0, 0.48, 0.55, Math.PI / 2 - 0.2, 0, 0, 8);                // subframe tube
  b.box(m.dark, 0.18, 0.2, 0.28, 0, 0.36, 0.1, 0, 0, 0, 0.05); b.cyl(m.metal, 0.09, 0.09, 0.3, 0, 0.3, 0.05, 0, 0, Math.PI / 2, 14); // motor
  root.add(b.build());
  const fb = new Builder();
  fb.cyl(m.metal, 0.028, 0.028, 0.75, -0.09, 0.18, 0, 0, 0, 0, 8); fb.cyl(m.metal, 0.028, 0.028, 0.75, 0.09, 0.18, 0, 0, 0, 0, 8);
  fb.cyl(m.gold, 0.034, 0.034, 0.3, -0.09, 0.45, 0, 0, 0, 0, 8); fb.cyl(m.gold, 0.034, 0.034, 0.3, 0.09, 0.45, 0, 0, 0, 0, 8);
  fb.box(m.dark, 0.7, 0.04, 0.04, 0, 0.62, 0.03, 0, 0, 0, 0.01);                              // bars
  fb.cyl(m.rubber, 0.022, 0.022, 0.13, -0.38, 0.62, 0.03, 0, 0, Math.PI / 2, 8); fb.cyl(m.rubber, 0.022, 0.022, 0.13, 0.38, 0.62, 0.03, 0, 0, Math.PI / 2, 8);
  fb.box(m.white, 0.22, 0.2, 0.16, 0, 0.58, -0.1, 0.1, 0, 0, 0.05); fb.box(m.lampWhite, 0.14, 0.1, 0.05, 0, 0.58, -0.19, 0, 0, 0, 0.02);
  fb.box(m.white, 0.18, 0.04, 0.4, 0, 0.4, -0.12, -0.1, 0, 0, 0.02);                          // front fender
  fork.add(fb.build());
  root.add(fork); fork.position.set(0, 0.4, -0.55);
  fork.userData.axle = new V3(0, 0, 0);
  fork.add(front); front.position.set(0, 0.0, -0.18);
  const swing = new THREE.Group(); root.add(swing); swing.position.set(0, 0.42, 0.35);
  const sb = new Builder(); sb.box(m.metal, 0.06, 0.07, 0.9, 0.11, 0, 0.45, 0.0, 0, 0, 0.02); sb.box(m.metal, 0.06, 0.07, 0.9, -0.11, 0, 0.45, 0, 0, 0, 0.02);
  swing.add(sb.build());
  swing.add(rear); rear.position.set(0, 0, 0.88);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.03), m.lampRed.clone()); tail.position.set(0, 0.88, 1.28); root.add(tail);
  return { group: root, front, rear, fork, swing, fw, rw, wheelR, mountPoint: new V3(0, 0.88, 0.35) };
}
