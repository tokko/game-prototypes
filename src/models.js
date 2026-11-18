// Merged-primitive geometry for soldiers, horses, cannon. Origin at feet, facing +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpC = new THREE.Color();
function fin(g, hex, x, y, z, rx = 0, ry = 0, rz = 0, mul = 1) {
  if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  tmpC.set(hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = tmpC.r * mul; a[i * 3 + 1] = tmpC.g * mul; a[i * 3 + 2] = tmpC.b * mul; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w, h, d, hex, x, y, z, rx, ry, rz) => fin(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz);
const cyl = (rt, rb, h, seg, hex, x, y, z, rx, ry, rz) => fin(new THREE.CylinderGeometry(rt, rb, h, seg), hex, x, y, z, rx, ry, rz);
const sph = (r, hex, x, y, z) => fin(new THREE.SphereGeometry(r, 6, 4), hex, x, y, z);
const merge = (arr) => mergeGeometries(arr, false);

const SKIN = 0xd9a77c, WOOD = 0x5b3f26, STEEL = 0xc9ccd2, DARK = 0x23201e, WHITE = 0xece6d4, BRASS = 0xc9a850;

function soldier(kind, coat, trousers) {
  const rider = kind === 'lrider' || kind === 'hrider';
  const p = [];
  const dy = rider ? -0.65 : 0;      // rider origin at saddle
  if (!rider) {
    p.push(box(0.15, 0.8, 0.17, trousers, -0.1, 0.4, 0), box(0.15, 0.8, 0.17, trousers, 0.1, 0.4, 0));
    p.push(box(0.16, 0.12, 0.25, DARK, -0.1, 0.06, 0.03), box(0.16, 0.12, 0.25, DARK, 0.1, 0.06, 0.03));
  } else {
    p.push(box(0.14, 0.6, 0.16, trousers, -0.3, -0.05, 0.05, 0, 0, 0.35), box(0.14, 0.6, 0.16, trousers, 0.3, -0.05, 0.05, 0, 0, -0.35));
  }
  p.push(box(0.44, 0.6, 0.27, coat, 0, 1.1 + dy, 0));
  p.push(box(0.05, 0.66, 0.29, WHITE, 0, 1.1 + dy, 0, 0, 0, 0.6), box(0.05, 0.66, 0.29, WHITE, 0, 1.1 + dy, 0, 0, 0, -0.6));
  p.push(box(0.21, 0.23, 0.21, SKIN, 0, 1.52 + dy, 0));
  p.push(box(0.1, 0.5, 0.12, coat, -0.27, 1.12 + dy, 0.14, -1.0), box(0.1, 0.5, 0.12, coat, 0.27, 1.14 + dy, 0.1, -0.5));
  const hy = 1.64 + dy;
  switch (kind) {
    case 'line':
      p.push(cyl(0.12, 0.14, 0.32, 8, DARK, 0, hy + 0.2, 0), box(0.1, 0.08, 0.02, BRASS, 0, hy + 0.12, 0.14), sph(0.05, WHITE, 0, hy + 0.42, 0));
      p.push(box(0.05, 0.06, 1.5, WOOD, 0.22, 1.2 + dy, 0.45, -0.3), box(0.03, 0.03, 0.55, STEEL, 0.22, 1.2 + dy + 0.18, 1.25, -0.3));
      break;
    case 'rifle':
      p.push(cyl(0.23, 0.23, 0.04, 10, DARK, 0, hy + 0.04, 0), cyl(0.11, 0.12, 0.15, 8, DARK, 0, hy + 0.12, 0), box(0.03, 0.18, 0.03, 0x3f7a3a, 0.08, hy + 0.3, 0));
      p.push(box(0.05, 0.06, 1.35, WOOD, 0.22, 1.2 + dy, 0.4, -0.3));
      break;
    case 'pike':
      p.push(cyl(0.13, 0.15, 0.11, 8, STEEL, 0, hy + 0.1, 0), cyl(0.22, 0.22, 0.03, 10, STEEL, 0, hy + 0.05, 0), box(0.03, 0.1, 0.3, STEEL, 0, hy + 0.2, 0));
      p.push(box(0.04, 4.8, 0.04, WOOD, 0.24, 2.6 + dy, 0.1, 0.06), box(0.05, 0.3, 0.05, STEEL, 0.24, 5.1 + dy + 0.1, 0.3));
      break;
    case 'musk':
      p.push(cyl(0.24, 0.24, 0.04, 10, 0x6b5238, 0, hy + 0.04, 0), cyl(0.11, 0.12, 0.14, 8, 0x6b5238, 0, hy + 0.12, 0), box(0.03, 0.2, 0.06, WHITE, -0.12, hy + 0.22, 0));
      p.push(box(0.05, 0.06, 1.5, WOOD, 0.22, 1.2 + dy, 0.45, -0.3));
      break;
    case 'lrider':
      p.push(cyl(0.12, 0.13, 0.36, 8, DARK, 0, hy + 0.2, 0), box(0.1, 0.2, 0.05, coat, 0.1, hy + 0.3, 0));
      p.push(box(0.03, 0.03, 0.95, STEEL, 0.3, 0.5 + dy + 0.3, 0.45, -0.9));
      break;
    case 'hrider':
      p.push(cyl(0.13, 0.14, 0.26, 8, STEEL, 0, hy + 0.15, 0), box(0.04, 0.16, 0.36, coat, 0, hy + 0.34, 0), box(0.47, 0.5, 0.3, STEEL, 0, 1.15 + dy, 0.02));
      p.push(box(0.05, 0.05, 3.6, WOOD, 0.32, 0.9 + dy + 0.2, 0.9, 0.1), box(0.01, 0.2, 0.4, coat, 0.32, 1.05 + dy + 0.4, 2.3));
      break;
    case 'crew':
      p.push(cyl(0.12, 0.13, 0.14, 8, 0x2a3350, 0, hy + 0.1, 0));
      p.push(box(0.04, 0.04, 1.5, WOOD, 0.25, 1.1, 0.4, -0.3));
      break;
  }
  return merge(p);
}

function horse(hex) {
  const p = [];
  const leg = new THREE.Color(hex).multiplyScalar(0.8).getHex(), dark = new THREE.Color(hex).multiplyScalar(0.45).getHex();
  p.push(box(0.55, 0.62, 1.7, hex, 0, 1.05, 0), box(0.6, 0.7, 0.5, hex, 0, 1.07, 0.65), box(0.58, 0.66, 0.5, hex, 0, 1.05, -0.6));
  p.push(box(0.24, 0.75, 0.3, hex, 0, 1.5, 0.95, 0.55), box(0.2, 0.22, 0.5, hex, 0, 1.78, 1.3, 0.7));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.12, 0.9, 0.12, leg, sx * 0.2, 0.45, sz * 0.65));
  p.push(box(0.06, 0.5, 0.3, dark, 0, 1.68, 0.85, 0.55), box(0.08, 0.7, 0.1, dark, 0, 1.1, -1.0, -0.4));
  p.push(box(0.5, 0.06, 0.5, 0x4a3320, 0, 1.38, 0));
  return merge(p);
}

function cannon() {
  const bronze = 0x6e5a36, wood = 0x5c4026;
  const p = [];
  p.push(cyl(0.2, 0.28, 2.7, 10, bronze, 0, 1.2, 0.7, Math.PI / 2 - 0.07));
  p.push(box(0.7, 0.3, 1.8, wood, 0, 0.9, -0.1), box(0.25, 0.2, 2.2, wood, 0, 0.55, -1.7, 0.12));
  for (const sx of [-1, 1]) p.push(cyl(0.85, 0.85, 0.14, 12, wood, sx * 0.7, 0.85, 0, 0, 0, Math.PI / 2));
  p.push(box(0.15, 0.15, 0.15, DARK, 0, 0.85, 0));
  return merge(p);
}

export const COATS = { player: 0xb02727, enemy: 0x2a4b9b };
export const HORSE_COLORS = [0x6b4423, 0x3d2a1a, 0x9a7a4e];

export function buildModels() {
  const m = { soldier: {}, horse: HORSE_COLORS.map(horse), cannon: cannon(), corpse: {} };
  for (const side of ['player', 'enemy']) {
    const coat = COATS[side];
    const dark = new THREE.Color(coat).multiplyScalar(0.75).getHex();
    m.soldier[side] = {
      line: soldier('line', coat, 0xe2dccb), rifle: soldier('rifle', dark, 0x4a4a4a),
      pike: soldier('pike', coat, 0xd8cfb8), musk: soldier('musk', coat, 0xd8cfb8),
      lrider: soldier('lrider', coat, 0xe2dccb), hrider: soldier('hrider', coat, 0xe2dccb),
      crew: soldier('crew', 0x2a3350, 0x3a3a3a),
    };
    m.corpse[side] = m.soldier[side].line;
  }
  return m;
}
