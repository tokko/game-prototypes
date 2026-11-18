// Terrain, road, village, walls, trees, wheat. Look/scenery lives here.
import * as THREE from 'three';

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
  return lerp(h, 9, flat * 0.85);
}

function inField(x, z) {
  const c = Math.cos(FIELD.rot), s = Math.sin(FIELD.rot);
  const dx = x - FIELD.x, dz = z - FIELD.z;
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return { inside: Math.abs(lx) < FIELD.w / 2 && Math.abs(lz) < FIELD.d / 2, lx, lz };
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

  // ---- mesh
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  const shade = new Float32Array((N + 1) * (N + 1));
  const idx = [];
  const C = (h) => new THREE.Color(h);
  const GA = C(0x93a24c), GB = C(0xb2a954), GC = C(0x6f9040), DIRT = C(0x9c7f55), DIRTD = C(0x7a6240), ROAD = C(0xb69a6a), FIELDC = C(0xdcb856);
  const tmp = new THREE.Color();
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i;
    const x = -HALF + i * CELL, z = -HALF + j * CELL, h = heights[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const hx = heights[j * (N + 1) + Math.min(N, i + 1)] - heights[j * (N + 1) + Math.max(0, i - 1)];
    const hz = heights[Math.min(N, j + 1) * (N + 1) + i] - heights[Math.max(0, j - 1) * (N + 1) + i];
    const slope = Math.hypot(hx, hz) / (2 * CELL);
    const n1 = fbm(x * 0.012 + 3.1, z * 0.012 + 7.7, 3), n2 = fbm(x * 0.05, z * 0.05, 2), n3 = fbm(x * 0.004 + 20, z * 0.004 + 9, 3);
    tmp.copy(GA).lerp(GB, sstep(0.35, 0.65, n1)).lerp(GC, sstep(0.55, 0.75, n3) * 0.6);
    tmp.multiplyScalar(0.9 + n2 * 0.2);
    tmp.lerp(DIRT, sstep(0.62, 0.72, fbm(x * 0.02 + 99, z * 0.02 + 40, 3)) * 0.7);
    tmp.lerp(DIRTD, sstep(0.22, 0.5, slope) * 0.5);
    const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    tmp.lerp(DIRT, (1 - sstep(30, VILLAGE.r, dv)) * 0.35);
    const rd = Math.abs(x - roadX(z)) / Math.sqrt(1 + roadSlope(z) ** 2);
    tmp.lerp(ROAD, (1 - sstep(2.5, 6, rd)) * 0.9);
    const f = inField(x, z);
    if (f.inside) {
      const stripe = 0.5 + 0.5 * Math.sin(f.lz * 1.4);
      tmp.lerp(FIELDC, 0.7 + 0.2 * stripe).multiplyScalar(0.92 + 0.12 * stripe);
    }
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
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  scene.add(mesh);

  const rng = mulberry32(4242);
  const dummy = new THREE.Object3D();
  const colr = new THREE.Color();

  // ---- village
  const houses = [];
  const churchPos = { x: 40, z: -205 };
  for (let z = -255; z <= -85; z += 15) {
    for (const side of [-1, 1]) {
      if (rng() < 0.22) continue;
      const rx = roadX(z) + side * (15 + rng() * 7);
      if (Math.hypot(rx - churchPos.x, z - churchPos.z) < 28) continue;
      houses.push({ x: rx, z: z + rng() * 4, w: 7 + rng() * 4, d: 6 + rng() * 3, h: 3.6 + rng() * 1.4, yaw: Math.atan2(roadSlope(z), 1) + (rng() - 0.5) * 0.15 });
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2, r = 35 + rng() * 25;
    const x = VILLAGE.x + Math.cos(a) * r, z = VILLAGE.z + Math.sin(a) * r;
    if (Math.abs(x - roadX(z)) < 12 || Math.hypot(x - churchPos.x, z - churchPos.z) < 25) continue;
    houses.push({ x, z, w: 6 + rng() * 3, d: 5 + rng() * 3, h: 3.4 + rng(), yaw: rng() * Math.PI });
  }
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = prism();
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const hw = new THREE.InstancedMesh(wallGeo, wallMat, houses.length);
  const hr = new THREE.InstancedMesh(roofGeo, roofMat, houses.length);
  const wallCols = [0xd9c9a6, 0xcdb994, 0xe0d2b4, 0xc4ae88], roofCols = [0x9a4a32, 0x8a3f2c, 0xa6573a, 0x7a4636];
  houses.forEach((h, i) => {
    const ground = Math.min(heightAt(h.x - h.w / 2, h.z - h.d / 2), heightAt(h.x + h.w / 2, h.z + h.d / 2), heightAt(h.x - h.w / 2, h.z + h.d / 2), heightAt(h.x + h.w / 2, h.z - h.d / 2));
    dummy.position.set(h.x, ground - 1.5 + (h.h + 1.5) / 2, h.z);
    dummy.rotation.set(0, h.yaw, 0); dummy.scale.set(h.w, h.h + 1.5, h.d); dummy.updateMatrix();
    hw.setMatrixAt(i, dummy.matrix); hw.setColorAt(i, colr.set(wallCols[i % 4]));
    dummy.position.set(h.x, ground + h.h, h.z); dummy.scale.set(h.w + 0.9, 2.4 + rng(), h.d + 0.9); dummy.updateMatrix();
    hr.setMatrixAt(i, dummy.matrix); hr.setColorAt(i, colr.set(roofCols[Math.floor(rng() * 4)]));
    h.ground = ground;
  });
  for (const m of [hw, hr]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // church
  {
    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0xd6c8a8 });
    const roofM = new THREE.MeshLambertMaterial({ color: 0x6f5a4a, side: THREE.DoubleSide });
    const base = heightAt(churchPos.x, churchPos.z);
    const nave = new THREE.Mesh(new THREE.BoxGeometry(10, 8.5, 20), stone); nave.position.set(0, 3.2, 0);
    const naveRoof = new THREE.Mesh(roofGeo, roofM); naveRoof.scale.set(11.2, 5, 21); naveRoof.position.set(0, 7.45, 0);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5.2, 20, 5.2), stone); tower.position.set(0, 8.5, -12);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.0, 11, 4), roofM); spire.rotation.y = Math.PI / 4; spire.position.set(0, 24, -12);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 0.35), new THREE.MeshLambertMaterial({ color: 0xc8a850 })); cross.position.set(0, 31.2, -12);
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.35), cross.material); cross2.position.set(0, 31.5, -12);
    for (const m of [nave, naveRoof, tower, spire, cross, cross2]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.position.set(churchPos.x, base - 1.2, churchPos.z);
    g.rotation.y = 0.12;
    scene.add(g);
  }

  // ---- stone walls
  const wallLines = [];
  const fc = Math.cos(FIELD.rot), fs = Math.sin(FIELD.rot);
  const fcorner = (sx, sz) => [FIELD.x + (sx * FIELD.w / 2 + 6 * sx) * fc - (sz * FIELD.d / 2 + 6 * sz) * fs, FIELD.z + (sx * FIELD.w / 2 + 6 * sx) * fs + (sz * FIELD.d / 2 + 6 * sz) * fc];
  const c1 = fcorner(-1, -1), c2 = fcorner(1, -1), c3 = fcorner(1, 1), c4 = fcorner(-1, 1);
  wallLines.push([c1, c2], [c2, c3], [c3, c4]);
  wallLines.push([[-95, -270], [-95, -120]], [[-95, -120], [-150, -60]], [[75, -250], [75, -110]], [[-300, 20], [-180, 20]], [[100, 140], [260, 140]], [[330, -150], [330, 30]]);
  wallLines.push([[churchPos.x - 18, churchPos.z - 24], [churchPos.x + 18, churchPos.z - 24]], [[churchPos.x + 18, churchPos.z - 24], [churchPos.x + 18, churchPos.z + 18]]);
  const wallPieces = [];
  for (const [a, b] of wallLines) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(len / 3);
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
    for (let i = 0; i < n; i++) {
      if (rng() < 0.06) continue;
      const t = (i + 0.5) / n;
      wallPieces.push({ x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), yaw });
    }
  }
  const stoneM = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), wallPieces.length);
  wallPieces.forEach((w, i) => {
    const g = heightAt(w.x, w.z);
    const hgt = 0.9 + rng() * 0.3;
    dummy.position.set(w.x, g + hgt / 2 - 0.1, w.z); dummy.rotation.set(0, w.yaw, 0); dummy.scale.set(0.8, hgt, 3.1); dummy.updateMatrix();
    stoneM.setMatrixAt(i, dummy.matrix);
    const v = 0.62 + rng() * 0.25; stoneM.setColorAt(i, colr.setRGB(v * 0.95, v * 0.9, v * 0.8));
  });
  stoneM.castShadow = true; stoneM.receiveShadow = true; scene.add(stoneM);

  // ---- trees
  const trees = [];
  for (let a = 0; a < 12000 && trees.length < 900; a++) {
    const x = (rng() - 0.5) * (MAP - 40), z = (rng() - 0.5) * (MAP - 40);
    const f = fbm(x * 0.009 + 55, z * 0.009 + 12, 3);
    if (f < 0.56 && rng() > 0.015) continue;
    if (Math.abs(x - roadX(z)) < 10) continue;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 85) continue;
    if (z > 240 && z < 440 && Math.abs(x) < 330) continue;
    if (z < -70 && z > -270 && Math.abs(x) < 320) continue;
    const ff = inField(x, z); if (Math.abs(ff.lx) < FIELD.w / 2 + 12 && Math.abs(ff.lz) < FIELD.d / 2 + 12) continue;
    trees.push({ x, z, s: 0.8 + rng() * 0.7, cone: rng() < 0.22 });
  }
  const deci = trees.filter(t => !t.cone), cone = trees.filter(t => t.cone);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.55, 3.2, 5), new THREE.MeshLambertMaterial({ color: 0x5a4430 }), trees.length);
  const blob = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), deci.length * 2);
  const conM = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 9, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, cone.length));
  let ti = 0, bi = 0, ci = 0;
  const greens = [0x5f7a34, 0x748a3a, 0x8a8f3c, 0x4f6c32, 0xa09040];
  for (const t of trees) {
    const g = heightAt(t.x, t.z);
    dummy.position.set(t.x, g + 1.6 * t.s, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(t.s, t.s, t.s); dummy.updateMatrix();
    trunk.setMatrixAt(ti++, dummy.matrix);
    if (t.cone) {
      dummy.position.set(t.x, g + 3.2 * t.s + 4.2 * t.s, t.z); dummy.scale.set(t.s, t.s, t.s); dummy.updateMatrix();
      conM.setMatrixAt(ci, dummy.matrix); conM.setColorAt(ci++, colr.set(0x3f5a30).multiplyScalar(0.85 + rng() * 0.3));
    } else {
      const gc = greens[Math.floor(rng() * greens.length)];
      dummy.rotation.set(rng(), rng() * 6, rng());
      dummy.position.set(t.x, g + 4.6 * t.s, t.z); dummy.scale.set(3.3 * t.s, 2.9 * t.s, 3.3 * t.s); dummy.updateMatrix();
      blob.setMatrixAt(bi, dummy.matrix); blob.setColorAt(bi++, colr.set(gc));
      dummy.position.set(t.x + (rng() - 0.5) * 2, g + 6.2 * t.s, t.z + (rng() - 0.5) * 2); dummy.scale.set(2.3 * t.s, 2.1 * t.s, 2.3 * t.s); dummy.updateMatrix();
      blob.setMatrixAt(bi, dummy.matrix); blob.setColorAt(bi++, colr.set(gc).multiplyScalar(1.1));
    }
  }
  trunk.count = ti; blob.count = bi; conM.count = ci;
  for (const m of [trunk, blob, conM]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // ---- wheat
  const rowsN = Math.floor(FIELD.d / 1.3), perRow = Math.floor(FIELD.w / 1.1);
  const wheat = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 0.9, 0.5), new THREE.MeshLambertMaterial({ color: 0xffffff }), rowsN * perRow);
  let wi = 0;
  for (let r = 0; r < rowsN; r++) for (let p = 0; p < perRow; p++) {
    const lx = -FIELD.w / 2 + (p + 0.5) * 1.1 + (rng() - 0.5) * 0.3, lz = -FIELD.d / 2 + (r + 0.5) * 1.3;
    const x = FIELD.x + lx * fc - lz * fs, z = FIELD.z + lx * fs + lz * fc;
    dummy.position.set(x, heightAt(x, z) + 0.35, z); dummy.rotation.set((rng() - 0.5) * 0.15, FIELD.rot, (rng() - 0.5) * 0.15);
    dummy.scale.set(1, 0.8 + rng() * 0.4, 1); dummy.updateMatrix();
    wheat.setMatrixAt(wi, dummy.matrix); wheat.setColorAt(wi++, colr.set(0xd9b64a).multiplyScalar(0.85 + rng() * 0.3));
  }
  wheat.count = wi; scene.add(wheat);

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

  return { mesh, heightAt, minimapCanvas, houses, churchPos };
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
