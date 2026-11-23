// Terrain, road, village, walls, trees, wheat. Look/scenery lives here.
import * as THREE from 'three';
import { createFoliage, stoneMaterial, stoneGeometry } from './foliage.js';

export const MAP = 1200;
export const HALF = MAP / 2;
export const VILLAGE = { x: 0, z: -170, r: 75 };
export const FIELD = { x: 200, z: -40, w: 110, d: 70, rot: 0.3 };
const N = 300; // segments
const CELL = MAP / N;
const SEED = 1337;

export function roadX(z) { return 60 * Math.sin((z + 170) * 0.0045); }
function roadSlope(z) { return 60 * 0.0045 * Math.cos((z + 170) * 0.0045); }

function hash2(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; }
  return s;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function rawHeight(x, z) {
  let h = (fbm(x * 0.0032 + 10, z * 0.0032 + 3, 4) - 0.45) * 30;
  h += 12 * Math.exp(-((x - VILLAGE.x) ** 2 + (z - VILLAGE.z) ** 2) / (2 * 110 * 110));
  h += 7 * Math.exp(-((x + 230) ** 2 + (z - 290) ** 2) / (2 * 80 * 80));
  h += 7 * Math.exp(-((x - 240) ** 2 + (z - 300) ** 2) / (2 * 80 * 80));
  const d = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  const flat = 1 - sstep(40, 100, d);
  h = lerp(h, 9, flat * 0.85);
  return lerp(h, 0, sstep(HALF - 90, HALF, Math.max(Math.abs(x), Math.abs(z))));   // settle to the skirt plane at the rim
}

function inField(x, z) {
  const c = Math.cos(FIELD.rot), s = Math.sin(FIELD.rot);
  const dx = x - FIELD.x, dz = z - FIELD.z;
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return { inside: Math.abs(lx) < FIELD.w / 2 && Math.abs(lz) < FIELD.d / 2, lx, lz };
}

// ---- procedural canvas textures (all tileable / self-contained) ---------------------------
function pnoise(x, y, p) {   // value noise that wraps every p lattice cells
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (i) => ((i % p) + p) % p;
  const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi)), c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function canvasTex(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// coursed stone blocks with optional openings; `feat` draws windows/doors on top
function wallTexture(w, h, base, feat) {
  return canvasTex(w, h, (ctx) => {
    const r = mulberry32(w * 7 + h);
    ctx.fillStyle = `rgb(${base[0] * 0.7},${base[1] * 0.7},${base[2] * 0.7})`; ctx.fillRect(0, 0, w, h);
    const ch = Math.max(12, Math.round(h / 16));
    for (let y = 0; y < h; y += ch) {
      let x = -r() * 30;
      while (x < w) {
        const bw = 22 + r() * 26, k = 0.82 + r() * 0.3;
        ctx.fillStyle = `rgb(${Math.min(255, base[0] * k)},${Math.min(255, base[1] * k)},${Math.min(255, base[2] * k * (0.95 + r() * 0.08))})`;
        ctx.fillRect(x + 1, y + 1, bw - 2, ch - 2);
        x += bw;
      }
    }
    feat(ctx, w, h);
  });
}
function houseTexture() {
  return wallTexture(256, 256, [212, 196, 160], (ctx) => {
    const win = (x, y, ww, hh) => { ctx.fillStyle = '#d9cfb4'; ctx.fillRect(x - 5, y - 5, ww + 10, hh + 10); ctx.fillStyle = '#2a2622'; ctx.fillRect(x, y, ww, hh); ctx.fillStyle = '#5a5a58'; ctx.fillRect(x + ww / 2 - 1, y, 2, hh); ctx.fillRect(x, y + hh / 2 - 1, ww, 2); };
    win(48, 56, 34, 48); win(174, 56, 34, 48);
    ctx.fillStyle = '#d9cfb4'; ctx.fillRect(102, 112, 52, 82);
    ctx.fillStyle = '#4a3320'; ctx.fillRect(108, 120, 40, 74);
    ctx.fillStyle = '#c8a850'; ctx.fillRect(140, 158, 4, 4);
  });
}
function churchTexture() {
  return wallTexture(256, 256, [214, 204, 180], (ctx) => {
    for (const x of [52, 128, 204]) {
      ctx.fillStyle = '#c9bfa2'; ctx.fillRect(x - 18, 60, 36, 120);
      ctx.fillStyle = '#26324a'; ctx.beginPath(); ctx.moveTo(x - 12, 170); ctx.lineTo(x - 12, 86); ctx.arc(x, 86, 12, Math.PI, 0); ctx.lineTo(x + 12, 170); ctx.fill();
    }
  });
}
function towerTexture() {
  return wallTexture(128, 512, [210, 200, 176], (ctx) => {
    const op = (y, hh) => { ctx.fillStyle = '#c9bfa2'; ctx.fillRect(34, y - 6, 60, hh + 12); ctx.fillStyle = '#1f1d1a'; ctx.beginPath(); ctx.moveTo(42, y + hh); ctx.lineTo(42, y + 14); ctx.arc(64, y + 14, 22, Math.PI, 0); ctx.lineTo(86, y + hh); ctx.fill(); };
    op(60, 90); op(290, 36);
    ctx.fillStyle = '#c9bfa2'; ctx.fillRect(48, 350, 32, 8);
    ctx.beginPath(); ctx.arc(64, 200, 20, 0, 7); ctx.fillStyle = '#e8e0c4'; ctx.fill(); ctx.fillStyle = '#2a2622'; ctx.fillRect(63, 188, 2, 12); ctx.fillRect(63, 198, 9, 2);
  });
}
export function createTerrain(scene) {
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    heights[j * (N + 1) + i] = rawHeight(-HALF + i * CELL, -HALF + j * CELL);
  }
  function heightAt(x, z) {
    let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    gx = Math.min(N - 0.001, Math.max(0, gx)); gz = Math.min(N - 0.001, Math.max(0, gz));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const k = j * (N + 1) + i;
    const a = heights[k], b = heights[k + 1], c = heights[k + N + 1], d = heights[k + N + 2];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  // height of the rendered triangle surface (for thin decals draped on the mesh)
  function meshY(x, z) {
    let gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    gx = Math.min(N - 0.001, Math.max(0, gx)); gz = Math.min(N - 0.001, Math.max(0, gz));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * (N + 1) + i;
    const a = heights[k], b = heights[k + 1], c = heights[k + N + 1], d = heights[k + N + 2];
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (b - d) * (1 - fz) + (c - d) * (1 - fx);
  }

  // ---- mesh
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  const uv = new Float32Array((N + 1) * (N + 1) * 2);
  const shade = new Float32Array((N + 1) * (N + 1));
  const idx = [];
  const C = (h) => new THREE.Color(h);
  const GA = C(0x92a244), GB = C(0xc2ae4e), GC = C(0x62923c), GD = C(0xcdbb66), FOREST = C(0x4a6a2c);
  const DIRT = C(0xa38154), DIRTD = C(0x74603f), ROAD = C(0xb99c6c), FIELDC = C(0xb58d38);
  const tmp = new THREE.Color();
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i;
    const x = -HALF + i * CELL, z = -HALF + j * CELL, h = heights[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 14; uv[k * 2 + 1] = z / 14;
    const hx = heights[j * (N + 1) + Math.min(N, i + 1)] - heights[j * (N + 1) + Math.max(0, i - 1)];
    const hz = heights[Math.min(N, j + 1) * (N + 1) + i] - heights[Math.max(0, j - 1) * (N + 1) + i];
    const slope = Math.hypot(hx, hz) / (2 * CELL);
    const n1 = fbm(x * 0.012 + 3.1, z * 0.012 + 7.7, 3), n2 = fbm(x * 0.05, z * 0.05, 2), n3 = fbm(x * 0.004 + 20, z * 0.004 + 9, 3), n4 = fbm(x * 0.025 + 71, z * 0.025 + 5, 3);
    tmp.copy(GA).lerp(GB, sstep(0.38, 0.62, n1)).lerp(GC, sstep(0.5, 0.72, n3) * 0.75).lerp(GD, sstep(0.55, 0.75, n4) * 0.55);
    tmp.multiplyScalar(0.84 + n2 * 0.32 + (hash2(i, j) - 0.5) * 0.08);
    tmp.lerp(FOREST, sstep(0.55, 0.68, fbm(x * 0.009 + 55, z * 0.009 + 12, 3)) * 0.6);
    tmp.lerp(DIRT, sstep(0.6, 0.7, fbm(x * 0.02 + 99, z * 0.02 + 40, 3)) * 0.8);
    tmp.lerp(DIRTD, sstep(0.22, 0.5, slope) * 0.5);
    const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    tmp.lerp(DIRT, (1 - sstep(30, VILLAGE.r, dv)) * 0.3);
    const rd = Math.abs(x - roadX(z)) / Math.sqrt(1 + roadSlope(z) ** 2);
    tmp.lerp(ROAD, (1 - sstep(2.5, 6, rd)) * 0.9);
    const f = inField(x, z);
    if (f.inside) {
      const stripe = 0.5 + 0.5 * Math.sin(f.lz * 1.4);
      tmp.lerp(FIELDC, 0.8 + 0.2 * stripe).multiplyScalar(0.9 + 0.14 * stripe);
    }
    tmp.multiplyScalar(1.08);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    // hillshade for minimap, light from west-south
    shade[k] = Math.min(1.3, Math.max(0.55, 1 + (-hx * 0.6 + hz * 0.3) / (2 * CELL) * 2.2));
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x92a244 }));   // replaced by the splat material from createFoliage
  mesh.receiveShadow = true;
  scene.add(mesh);

  // skirt: flat ground beyond the map rim so the horizon never shows a cliff
  const sk = new THREE.Shape(); sk.moveTo(-4500, -4500); sk.lineTo(4500, -4500); sk.lineTo(4500, 4500); sk.lineTo(-4500, 4500);
  const hole = new THREE.Path(); hole.moveTo(-HALF, -HALF); hole.lineTo(-HALF, HALF); hole.lineTo(HALF, HALF); hole.lineTo(HALF, -HALF); sk.holes.push(hole);
  const skirt = new THREE.Mesh(new THREE.ShapeGeometry(sk), new THREE.MeshLambertMaterial({ color: 0x7f9440, side: THREE.DoubleSide }));
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.05; scene.add(skirt);

  const rng = mulberry32(4242);
  const dummy = new THREE.Object3D();
  const colr = new THREE.Color();

  // ---- village: dense double row along the road, plus a ring of farmsteads
  const houses = [];
  const churchPos = { x: 40, z: -205 };
  const spot = (x, z, w, d) => {
    if (Math.hypot(x - churchPos.x, z - churchPos.z) < 30) return false;
    for (const o of houses) if (Math.hypot(o.x - x, o.z - z) < (w + o.w) * 0.5 + 3.5) return false;
    return true;
  };
  for (let z = -255; z <= -85; z += 11) {
    for (const side of [-1, 1]) {
      if (rng() < 0.12) continue;
      const w = 7 + rng() * 4, d = 6 + rng() * 3, rz = z + (rng() - 0.5) * 4;
      const rx = roadX(rz) + side * (11.5 + w / 2 + rng() * 2.5);
      if (!spot(rx, rz, w, d)) continue;
      houses.push({ x: rx, z: rz, w, d, h: 3.6 + rng() * 1.4, yaw: Math.atan2(roadSlope(rz), 1) + (rng() - 0.5) * 0.12 });
    }
    for (const side of [-1, 1]) {   // back row, looser and more turned
      if (rng() < 0.4) continue;
      const w = 6 + rng() * 3, d = 5.5 + rng() * 3, rz = z + (rng() - 0.5) * 6;
      const rx = roadX(rz) + side * (30 + rng() * 12);
      if (!spot(rx, rz, w, d)) continue;
      houses.push({ x: rx, z: rz, w, d, h: 3.4 + rng() * 1.2, yaw: Math.atan2(roadSlope(rz), 1) + (rng() - 0.5) * 0.7 });
    }
  }
  for (let i = 0; i < 40 && houses.length < 70; i++) {
    const a = rng() * Math.PI * 2, r = 30 + rng() * 38;
    const x = VILLAGE.x + Math.cos(a) * r, z = VILLAGE.z + Math.sin(a) * r, w = 6 + rng() * 3, d = 5 + rng() * 3;
    if (Math.abs(x - roadX(z)) < 12 || !spot(x, z, w, d)) continue;
    houses.push({ x, z, w, d, h: 3.4 + rng(), yaw: rng() * Math.PI });
  }
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = prism();
  const hw = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: houseTexture() }), houses.length);
  const hr = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), houses.length);
  const ch = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ color: 0x8a7a68 }), houses.length);
  const wallTints = [0xffffff, 0xf3e8d2, 0xd9d2c4, 0xeadcc0, 0xe0d6c4];
  const roofCols = [0x4c505c, 0x5a5560, 0x4a4742, 0x6a4b3c, 0xa5482e, 0x8e3f2a, 0x555a66];
  houses.forEach((h, i) => {
    const ground = Math.min(heightAt(h.x - h.w / 2, h.z - h.d / 2), heightAt(h.x + h.w / 2, h.z + h.d / 2), heightAt(h.x - h.w / 2, h.z + h.d / 2), heightAt(h.x + h.w / 2, h.z - h.d / 2));
    dummy.position.set(h.x, ground - 1.5 + (h.h + 1.5) / 2, h.z);
    dummy.rotation.set(0, h.yaw, 0); dummy.scale.set(h.w, h.h + 1.5, h.d); dummy.updateMatrix();
    hw.setMatrixAt(i, dummy.matrix); hw.setColorAt(i, colr.set(wallTints[Math.floor(rng() * wallTints.length)]));
    const rh = 2.6 + rng() * 1.2;
    dummy.position.set(h.x, ground + h.h, h.z); dummy.scale.set(h.w + 0.9, rh, h.d + 0.9); dummy.updateMatrix();
    hr.setMatrixAt(i, dummy.matrix); hr.setColorAt(i, colr.set(roofCols[Math.floor(rng() * roofCols.length)]).multiplyScalar(0.85 + rng() * 0.3));
    // chimney on the ridge gable end
    const cs = Math.sin(h.yaw), cc = Math.cos(h.yaw), off = h.d * 0.28 * (rng() < 0.5 ? -1 : 1), ox = h.x + cs * off, oz = h.z + cc * off;
    dummy.position.set(ox, ground + h.h + rh * 0.55, oz); dummy.scale.set(0.9, rh * 1.1 + 0.6, 0.9); dummy.updateMatrix();
    ch.setMatrixAt(i, dummy.matrix);
    h.ground = ground;
  });
  for (const m of [hw, hr, ch]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // church: nave, apse, tall tower with steeple
  {
    const g = new THREE.Group();
    const tex = (t, rx, ry) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(rx, ry); return new THREE.MeshLambertMaterial({ map: c }); };
    const stone = tex(churchTexture(), 2, 1), plain = tex(towerTexture(), 1, 1), grey = new THREE.MeshLambertMaterial({ color: 0xa89f8c });
    const roofM = new THREE.MeshLambertMaterial({ color: 0x4a4d58, side: THREE.DoubleSide });
    const spireM = new THREE.MeshLambertMaterial({ color: 0x3f4350 });
    const gold = new THREE.MeshLambertMaterial({ color: 0xe0b848 });
    const base = heightAt(churchPos.x, churchPos.z);
    const nave = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 22), stone); nave.position.set(0, 3.45, 0);
    const naveRoof = new THREE.Mesh(roofGeo, roofM); naveRoof.scale.set(11.6, 5.6, 22.8); naveRoof.position.set(0, 7.95, 0);
    const apse = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 8.4, 8, 1, false, -Math.PI / 2, Math.PI), stone); apse.position.set(0, 3.15, 11);
    const apseRoof = new THREE.Mesh(new THREE.ConeGeometry(4.9, 3.6, 8, 1, false, -Math.PI / 2, Math.PI), roofM); apseRoof.position.set(0, 9.1, 11);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(6.2, 25, 6.2), plain); tower.position.set(0, 11.45, -13);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(7, 0.9, 7), grey); cornice.position.set(0, 23.9, -13);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.6, 17, 8), spireM); spire.rotation.y = Math.PI / 8; spire.position.set(0, 32.8, -13);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3, 0.4), gold); cross.position.set(0, 42.8, -13);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.4), gold); cross2.position.set(0, 43.1, -13);
    for (const m of [nave, naveRoof, apse, apseRoof, tower, cornice, spire, cross, cross2]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.position.set(churchPos.x, base - 1.2, churchPos.z);
    g.rotation.y = 0.12;
    scene.add(g);
  }

  // ---- dry-stone walls (two courses of irregular stones + capstones) and post-and-rail fences
  const wallLines = [];
  const fc = Math.cos(FIELD.rot), fs = Math.sin(FIELD.rot);
  const fcorner = (sx, sz) => [FIELD.x + (sx * FIELD.w / 2 + 6 * sx) * fc - (sz * FIELD.d / 2 + 6 * sz) * fs, FIELD.z + (sx * FIELD.w / 2 + 6 * sx) * fs + (sz * FIELD.d / 2 + 6 * sz) * fc];
  const c1 = fcorner(-1, -1), c2 = fcorner(1, -1), c3 = fcorner(1, 1), c4 = fcorner(-1, 1);
  wallLines.push([c1, c2], [c2, c3], [c3, c4]);
  wallLines.push([[-95, -270], [-95, -120]], [[-95, -120], [-150, -60]], [[75, -250], [75, -110]], [[-300, 20], [-180, 20]], [[100, 140], [260, 140]], [[330, -150], [330, 30]]);
  wallLines.push([[churchPos.x - 18, churchPos.z - 24], [churchPos.x + 18, churchPos.z - 24]], [[churchPos.x + 18, churchPos.z - 24], [churchPos.x + 18, churchPos.z + 18]]);
  const stones = [];
  for (const [a, b] of wallLines) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(len / 1.1);
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
    for (let i = 0; i < n; i++) {
      if (rng() < 0.03) continue;
      const t = (i + 0.5) / n, x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
      stones.push({ x, z, yaw, c: 0 }, { x, z, yaw, c: 1 });
      if (rng() < 0.55) stones.push({ x, z, yaw, c: 2 });
    }
  }
  const stoneM = new THREE.InstancedMesh(stoneGeometry(), stoneMaterial(), stones.length);
  stones.forEach((w, i) => {
    const g = heightAt(w.x, w.z), L = 1.1 + rng() * 0.45, T = 0.7 + rng() * 0.25;
    const y = w.c === 0 ? 0.22 : w.c === 1 ? 0.62 : 0.93, hh = w.c === 0 ? 0.55 : w.c === 1 ? 0.4 : 0.22 + rng() * 0.12;
    const jit = (rng() - 0.5) * 0.25, cs = Math.sin(w.yaw), cc = Math.cos(w.yaw), sh = w.c === 1 ? 0.5 : 0;   // stagger joints
    dummy.position.set(w.x - cc * sh + (-cs) * jit * 0.4, g + y - 0.05 + (rng() - 0.5) * 0.06, w.z + cs * sh - cc * jit * 0.4);
    dummy.rotation.set((rng() - 0.5) * 0.12, w.yaw + (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.1);
    dummy.scale.set(L, hh, T * (w.c === 2 ? 0.8 : 1)); dummy.updateMatrix();
    stoneM.setMatrixAt(i, dummy.matrix);
    const v = 0.72 + rng() * 0.4, warm = rng();
    stoneM.setColorAt(i, colr.setRGB(v * (0.96 + warm * 0.1), v * (0.92 + warm * 0.04), v * (0.8 + warm * 0.02)));
  });
  stoneM.castShadow = true; stoneM.receiveShadow = true; scene.add(stoneM);

  {
    const fences = [[c4, c1]];
    for (const side of [-1, 1]) {
      let prev = null;
      for (let z = -255; z <= -85; z += 3) { const p = [roadX(z) + side * 8, z]; if (prev && rng() > 0.1) fences.push([prev, p]); prev = p; }
    }
    const posts = [], rails = [];
    for (const [a, b] of fences) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2.6));
      const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, x0 = lerp(a[0], b[0], t0), z0 = lerp(a[1], b[1], t0), x1 = lerp(a[0], b[0], t1), z1 = lerp(a[1], b[1], t1);
        posts.push([x0, z0, yaw]);
        for (const ry of [0.45, 0.85]) rails.push([(x0 + x1) / 2, (z0 + z1) / 2, yaw, Math.hypot(x1 - x0, z1 - z0), ry]);
      }
    }
    const wood = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const pm = new THREE.InstancedMesh(wallGeo, wood, posts.length), rm = new THREE.InstancedMesh(wallGeo, wood, rails.length);
    posts.forEach(([x, z, yaw], i) => {
      dummy.position.set(x, heightAt(x, z) + 0.55, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(0.16, 1.1 + rng() * 0.1, 0.16); dummy.updateMatrix();
      pm.setMatrixAt(i, dummy.matrix); pm.setColorAt(i, colr.set(0x7a6648).multiplyScalar(0.8 + rng() * 0.3));
    });
    rails.forEach(([x, z, yaw, l, ry], i) => {
      dummy.position.set(x, heightAt(x, z) + ry, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(l, 0.09, 0.06); dummy.updateMatrix();
      rm.setMatrixAt(i, dummy.matrix); rm.setColorAt(i, colr.set(0x8a7654).multiplyScalar(0.8 + rng() * 0.3));
    });
    for (const m of [pm, rm]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }

  // ---- ground splat shader, grass, woods, hedges, bushes, rocks, wheat (see foliage.js)
  const treeOk = (x, z) => {
    if (Math.abs(x - roadX(z)) < 10) return false;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 85) return false;
    if (z > 240 && z < 440 && Math.abs(x) < 330) return false;
    if (z < -70 && z > -270 && Math.abs(x) < 320) return false;
    const ff = inField(x, z); if (Math.abs(ff.lx) < FIELD.w / 2 + 12 && Math.abs(ff.lz) < FIELD.d / 2 + 12) return false;
    return Math.abs(x) < HALF - 20 && Math.abs(z) < HALF - 20;
  };
  const fol = createFoliage({ scene, heightAt, heights, N, CELL, MAP, HALF, FIELD, VILLAGE, fbm, roadX, inField, treeOk, houses, churchPos });
  mesh.material = skirt.material = fol.groundMaterial;
  mesh.onBeforeRender = (r, s, cam) => fol.update(cam);

  function minimapCanvas(size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = Math.min(N, Math.round(x / (size - 1) * N)), j = Math.min(N, Math.round(y / (size - 1) * N));
      const k = j * (N + 1) + i, s = shade[k];
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, Math.pow(Math.min(1, col[k * 3 + c] * s), 1 / 2.2) * 255 * 0.85);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // read-only cover lists for skirmishers (trees, hedge runs, rocks, wall stones, house footprints)
  const cover = { ...fol.cover, walls: stones.filter((w, i) => w.c === 0 && i % 6 === 0).map(w => ({ x: w.x, z: w.z })), houses };
  return { mesh, heightAt, minimapCanvas, houses, churchPos, cover };
}

function prism() {
  const v = [[-.5, 0, .5], [.5, 0, .5], [0, 1, .5], [-.5, 0, -.5], [.5, 0, -.5], [0, 1, -.5]];
  const tris = [[0, 1, 2], [4, 3, 5], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2], [0, 3, 4], [0, 4, 1]];
  const p = [];
  for (const t of tris) for (const i of t) p.push(...v[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return g;
}
