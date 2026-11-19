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

const SKIN = 0xe0ad82, WOOD = 0x6a4a2c, STEEL = 0xf0f3fa, DARK = 0x1c1a1a, WHITE = 0xf6f1e0, BRASS = 0xe0b84a, PACK = 0x6b5030;

// shouldered musket, nearly upright so bayonets read as bright bristles above the ranks
function musket(len, bayo) {
  const th = -1.15, up = -Math.sin(th), fw = Math.cos(th), cy = 1.3, cz = 0.12, ex = 0.24;
  const p = [box(0.06, 0.07, len, WOOD, ex, cy, cz, th)];
  if (bayo) { const e = len / 2 + bayo / 2; p.push(box(0.045, 0.045, bayo, STEEL, ex, cy + up * e, cz + fw * e, th)); }
  return p;
}

function soldier(kind, coat, trousers) {
  const rider = kind === 'lrider' || kind === 'hrider';
  const p = [];
  const dy = rider ? -0.65 : 0;      // rider origin at saddle
  if (!rider) {
    p.push(box(0.17, 0.8, 0.19, trousers, -0.1, 0.4, 0), box(0.17, 0.8, 0.19, trousers, 0.1, 0.4, 0));
    p.push(box(0.17, 0.12, 0.27, DARK, -0.1, 0.06, 0.03), box(0.17, 0.12, 0.27, DARK, 0.1, 0.06, 0.03));
  } else {
    p.push(box(0.15, 0.6, 0.17, trousers, -0.3, -0.05, 0.05, 0, 0, 0.35), box(0.15, 0.6, 0.17, trousers, 0.3, -0.05, 0.05, 0, 0, -0.35));
  }
  p.push(box(0.46, 0.6, 0.29, coat, 0, 1.1 + dy, 0));
  p.push(box(0.06, 0.68, 0.31, WHITE, 0, 1.1 + dy, 0, 0, 0, 0.6), box(0.06, 0.68, 0.31, WHITE, 0, 1.1 + dy, 0, 0, 0, -0.6));
  if (!rider) p.push(box(0.32, 0.36, 0.14, PACK, 0, 1.12, -0.21));
  p.push(box(0.23, 0.25, 0.23, SKIN, 0, 1.54 + dy, 0));
  p.push(box(0.11, 0.5, 0.13, coat, -0.28, 1.12 + dy, 0.14, -1.0), box(0.11, 0.5, 0.13, coat, 0.28, 1.14 + dy, 0.1, -0.5));
  const hy = 1.64 + dy;
  switch (kind) {
    case 'line':   // tall black shako, brass plate, white plume
      p.push(cyl(0.15, 0.17, 0.4, 8, DARK, 0, hy + 0.22, 0), box(0.13, 0.1, 0.03, BRASS, 0, hy + 0.14, 0.17), box(0.05, 0.22, 0.05, WHITE, 0, hy + 0.55, 0));
      p.push(...musket(1.5, 0.6));
      break;
    case 'rifle':  // green plume
      p.push(cyl(0.27, 0.27, 0.04, 10, DARK, 0, hy + 0.04, 0), cyl(0.13, 0.14, 0.2, 8, DARK, 0, hy + 0.14, 0), box(0.04, 0.26, 0.04, 0x58b04c, 0.1, hy + 0.36, 0));
      p.push(...musket(1.35, 0));
      break;
    case 'pike':
      p.push(cyl(0.15, 0.17, 0.13, 8, STEEL, 0, hy + 0.1, 0), cyl(0.26, 0.26, 0.03, 10, STEEL, 0, hy + 0.05, 0), box(0.03, 0.12, 0.34, STEEL, 0, hy + 0.22, 0));
      p.push(box(0.05, 4.8, 0.05, WOOD, 0.26, 2.6 + dy, 0.1, 0.06), box(0.07, 0.36, 0.07, STEEL, 0.26, 5.1 + dy + 0.1, 0.3));
      break;
    case 'musk':   // broad brown hat with white feather
      p.push(cyl(0.28, 0.28, 0.04, 10, 0x7a5a38, 0, hy + 0.04, 0), cyl(0.13, 0.14, 0.17, 8, 0x7a5a38, 0, hy + 0.14, 0), box(0.04, 0.24, 0.07, WHITE, -0.14, hy + 0.26, 0));
      p.push(...musket(1.5, 0));
      break;
    case 'lrider':
      p.push(cyl(0.14, 0.15, 0.4, 8, DARK, 0, hy + 0.22, 0), box(0.12, 0.26, 0.06, coat, 0.12, hy + 0.32, 0), box(0.04, 0.16, 0.04, WHITE, 0, hy + 0.5, 0));
      p.push(box(0.04, 0.04, 1.0, STEEL, 0.32, 0.5 + dy + 0.3, 0.45, -0.9));
      break;
    case 'hrider':
      p.push(cyl(0.15, 0.16, 0.28, 8, STEEL, 0, hy + 0.16, 0), box(0.05, 0.2, 0.4, coat, 0, hy + 0.38, 0), box(0.5, 0.52, 0.32, STEEL, 0, 1.15 + dy, 0.02));
      p.push(box(0.06, 0.06, 3.6, WOOD, 0.34, 0.9 + dy + 0.2, 0.9, 0.1), box(0.01, 0.24, 0.45, coat, 0.34, 1.05 + dy + 0.4, 2.3));
      break;
    case 'crew':
      p.push(cyl(0.14, 0.15, 0.16, 8, 0x2a3350, 0, hy + 0.1, 0));
      p.push(box(0.05, 0.05, 1.5, WOOD, 0.25, 1.1, 0.4, -0.3));
      break;
  }
  return merge(p);
}

function horse(hex) {
  const p = [];
  const leg = new THREE.Color(hex).multiplyScalar(0.55).getHex(), dark = new THREE.Color(hex).multiplyScalar(0.45).getHex();
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

export const COATS = { player: 0xd2301f, enemy: 0x2c58cc };
export const HORSE_COLORS = [0x82501f, 0x4a2e1a, 0xa8793f];

export function buildModels() {
  const m = { soldier: {}, horse: HORSE_COLORS.map(horse), cannon: cannon(), corpse: {} };
  for (const side of ['player', 'enemy']) {
    const coat = COATS[side];
    const dark = new THREE.Color(coat).multiplyScalar(0.8).getHex();
    m.soldier[side] = {
      line: soldier('line', coat, 0xf0eada), rifle: soldier('rifle', dark, 0x55574f),
      pike: soldier('pike', coat, 0xe8e0c8), musk: soldier('musk', coat, 0xe8e0c8),
      lrider: soldier('lrider', coat, 0xe2dccb), hrider: soldier('hrider', coat, 0xe2dccb),
      crew: soldier('crew', 0x2f3c66, 0x4a4a4a),
    };
    m.corpse[side] = m.soldier[side].line;
  }
  return m;
}
