// Procedural low-poly figures: infantry, riders, horses, cannon. Origin at feet (riders share the horse's origin), facing +z.
// Every vertex carries a colour, an atlas UV (small canvas detail texture) and aAnim = (part, pivotY, pivotZ, kneeY),
// which the pose shader (figMaterial) uses with the per-instance iAnim = (cycle, gait, aim, recoil) to animate on the GPU.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- detail atlas: 4x2 cells of 32px ------------------------------------------------------
const AC = 4, AR = 2, CPX = 32;
const CELL = { plain: 0, cloth: 1, plastron: 2, face: 3, wood: 4, hide: 5, metal: 6, wheel: 7 };
function cellUV(c) {
  const col = c % AC, row = Math.floor(c / AC), ins = 4 / CPX;
  return [(col + ins) / AC, (col + 1 - ins) / AC, 1 - (row + 1 - ins) / AR, 1 - (row + ins) / AR];
}
function makeAtlas() {
  const cv = document.createElement('canvas'); cv.width = AC * CPX; cv.height = AR * CPX;
  const ctx = cv.getContext('2d');
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cell = (c, fn) => { ctx.save(); ctx.translate((c % AC) * CPX, Math.floor(c / AC) * CPX); ctx.beginPath(); ctx.rect(0, 0, CPX, CPX); ctx.clip(); fn(); ctx.restore(); };
  const grad = (stops) => { const g = ctx.createLinearGradient(0, 4, 0, 28); for (const [o, c] of stops) g.addColorStop(o, c); ctx.fillStyle = g; ctx.fillRect(0, 0, CPX, CPX); };
  const speck = (n, a) => { for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(0,0,0,${a * rnd()})`; ctx.fillRect(rnd() * CPX, rnd() * CPX, 1 + rnd() * 2, 1); } };
  const dot = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
  cell(CELL.plain, () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CPX, CPX); });
  cell(CELL.cloth, () => { // top-lit fabric with fold lines
    grad([[0, '#ffffff'], [1, '#bdbdbd']]);
    for (let x = 5; x < CPX; x += 5 + rnd() * 4) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x, 0, 1.5, CPX); }
    speck(50, 0.08);
  });
  cell(CELL.plastron, () => { // lapels with two rows of brass buttons
    grad([[0, '#ffffff'], [1, '#d4d4d4']]);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(15, 0, 2, CPX);
    for (let y = 7; y < 28; y += 5) for (const x of [10.5, 21.5]) { dot(x, y + 0.5, 2.2, '#6a4a10'); dot(x - 0.4, y, 1.4, '#fff0b0'); }
  });
  cell(CELL.face, () => {
    grad([[0, '#ffffff'], [0.75, '#f4e8e0'], [1, '#c8b0a4']]);
    ctx.fillStyle = '#4a2e1a'; ctx.fillRect(0, 0, CPX, 8);                       // hair fringe
    ctx.fillStyle = 'rgba(80,45,25,0.7)'; ctx.fillRect(8, 11, 6, 1.5); ctx.fillRect(18, 11, 6, 1.5);   // brows
    ctx.fillStyle = '#1e140c'; ctx.fillRect(9, 13, 4, 2.5); ctx.fillRect(19, 13, 4, 2.5);             // eyes
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(15, 15, 2, 5);                                   // nose shade
    ctx.fillStyle = 'rgba(120,40,30,0.5)'; ctx.fillRect(12, 22, 8, 1.8);                              // mouth
  });
  cell(CELL.wood, () => { ctx.fillStyle = '#efefef'; ctx.fillRect(0, 0, CPX, CPX); for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(60,30,0,${0.06 + rnd() * 0.12})`; ctx.fillRect(0, rnd() * CPX, CPX, 1); ctx.fillRect(rnd() * CPX, 0, 1, CPX); } });
  cell(CELL.hide, () => { grad([[0, '#ffffff'], [1, '#d8d8d8']]); speck(70, 0.07); for (let i = 0; i < 6; i++) dot(rnd() * CPX, rnd() * CPX, 2 + rnd() * 2, 'rgba(255,255,255,0.12)'); });
  cell(CELL.metal, () => grad([[0, '#c8ccd2'], [0.3, '#ffffff'], [0.55, '#9aa0a8'], [1, '#d8dce2']]));
  cell(CELL.wheel, () => { // cap UVs span the cell's visible 24px: rim, spokes and hub on dark gaps
    ctx.fillStyle = '#3a3028'; ctx.fillRect(0, 0, CPX, CPX);
    ctx.strokeStyle = '#efe6d6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(16, 16, 10.3, 0, 7); ctx.stroke();
    ctx.lineWidth = 2.2; for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; ctx.beginPath(); ctx.moveTo(16 + Math.cos(a) * 3, 16 + Math.sin(a) * 3); ctx.lineTo(16 + Math.cos(a) * 9.5, 16 + Math.sin(a) * 9.5); ctx.stroke(); }
    dot(16, 16, 3.6, '#d8cfbe'); dot(16, 16, 1.4, '#555');
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---- geometry kit -----------------------------------------------------------------------------
const _c = new THREE.Color();
let PART = 0, PY = 0, PZ = 0, KNEE = 0;
const part = (id = 0, py = 0, pz = 0) => { PART = id; PY = py; PZ = pz; KNEE = 0; };
// o: { cell, front (cell for the +z face of a box), cap (cell for cylinder caps) }
function fin(g, hex, o = {}) {
  _c.set(hex);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), an = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    an[i * 4] = PART; an[i * 4 + 1] = PY; an[i * 4 + 2] = PZ; an[i * 4 + 3] = KNEE;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aAnim', new THREE.BufferAttribute(an, 4));
  const uv = g.attributes.uv, base = cellUV(o.cell ?? CELL.plain);
  const capStart = o.capFrom ?? n;
  for (let i = 0; i < n; i++) {
    let r = base;
    if (o.front !== undefined && i >= 16 && i < 20) r = cellUV(o.front);
    else if (o.cap !== undefined && i >= capStart) r = cellUV(o.cap);
    uv.setXY(i, r[0] + uv.getX(i) * (r[1] - r[0]), r[2] + uv.getY(i) * (r[3] - r[2]));
  }
  return g;
}
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; }
// scale x/z linearly from 1 at the bottom to (tx, tz) at the top of a centred geometry of height h
function taperG(g, h, tx, tz) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = p.getY(i) / h + 0.5; p.setX(i, p.getX(i) * (1 + (tx - 1) * k)); p.setZ(i, p.getZ(i) * (1 + (tz - 1) * k)); }
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, hex, x, y, z, rx, ry, rz, o) => fin(place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz), hex, o);
const tbox = (wb, wt, h, db, dt, hex, x, y, z, rx, ry, rz, o) => fin(place(taperG(new THREE.BoxGeometry(wb, h, db), h, wt / wb, dt / db), x, y, z, rx, ry, rz), hex, o);
const cyl = (rt, rb, h, seg, hex, x, y, z, rx, ry, rz, o = {}) => fin(place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz), hex, { ...o, capFrom: (seg + 1) * 2 });
function ell(r, ws, hs, hex, x, y, z, sx, sy, sz, o, thetaLen = Math.PI) {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen); g.scale(sx, sy, sz);
  return fin(place(g, x, y, z), hex, o);
}
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// box running from point a to point b (w across x, d across the bending plane), optionally tapering toward b
function limb(a, b, w, d, hex, o, taper = 1) {
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = _v.length(); _v.normalize();
  const g = new THREE.BoxGeometry(w, L, d); if (taper !== 1) taperG(g, L, taper, taper);
  _q.setFromUnitVectors(_up, _v); g.applyQuaternion(_q);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return fin(g, hex, o);
}
function xform(parts, rx, x, y, z) { for (const g of parts) { g.rotateX(rx); g.translate(x, y, z); } return parts; }
const merge = (arr) => { const g = mergeGeometries(arr, false); g.computeBoundingSphere(); return g; };
const mul = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

const SKIN = 0xe0ad82, WOOD = 0x6a4a2c, STEEL = 0xf4f7ff, DARK = 0x1c1a1a, WHITE = 0xf6f1e0, BRASS = 0xe8c050,
  PACK = 0x4a3422, LEATHER = 0x3a281a, GOLD = 0xf2c44a, BRONZE = 0x9a7438, HOOF = 0x1e1a16;
const CLOTH = { cell: CELL.cloth }, MET = { cell: CELL.metal }, WD = { cell: CELL.wood }, HIDE = { cell: CELL.hide };

// ---- infantry pieces (dy shifts the upper body: 0 standing, saddle offset for riders) ------------------------
function legs(o, lo) {
  const p = [];
  for (const [id, sx] of [[1, -0.1], [2, 0.1]]) {
    part(id, 0.88, 0);
    if (lo) { p.push(tbox(0.12, 0.17, 0.88, 0.14, 0.19, o.trousers, sx, 0.44, 0, 0, 0, 0, CLOTH)); continue; }
    p.push(tbox(0.13, 0.17, 0.44, 0.15, 0.19, o.trousers, sx, 0.67, 0, 0, 0, 0, CLOTH));
    KNEE = 0.47;
    p.push(tbox(0.11, 0.135, 0.42, 0.12, 0.15, o.gaiter, sx, 0.27, 0, 0, 0, 0, CLOTH));
    p.push(box(0.12, 0.07, 0.24, DARK, sx, 0.035, 0.035));
  }
  part(0);
  return p;
}
function torso(o, dy, lo, pack) {
  part(0);
  const p = [tbox(0.35, 0.46, 0.6, 0.23, 0.27, o.coat, 0, 1.12 + dy, 0, 0, 0, 0, CLOTH)];
  if (lo) {
    p.push(tbox(0.17, 0.19, 0.24, 0.19, 0.21, SKIN, 0, 1.6 + dy, 0.01, 0, 0, 0, { front: CELL.face }));
    if (pack) p.push(box(0.3, 0.32, 0.12, PACK, 0, 1.15 + dy, -0.19));
    return p;
  }
  p.push(box(0.2, 0.42, 0.02, o.facing, 0, 1.2 + dy, 0.139, 0.033, 0, 0, { cell: CELL.plastron }));   // lapels + buttons
  p.push(box(0.25, 0.34, 0.03, o.coat, 0, 0.7 + dy, -0.12, 0.16, 0, 0, CLOTH));                          // coat tails
  for (const s of [-1, 1]) p.push(box(0.045, 0.72, 0.31, o.belt, 0, 1.13 + dy, 0, 0, 0, s * 0.62));     // crossbelts
  p.push(box(0.22, 0.07, 0.21, o.facing, 0, 1.445 + dy, 0));                                             // collar
  p.push(tbox(0.17, 0.18, 0.24, 0.19, 0.2, SKIN, 0, 1.6 + dy, 0.01, 0, 0, 0, { front: CELL.face }));   // head
  if (pack) p.push(box(0.3, 0.3, 0.12, PACK, 0, 1.14 + dy, -0.2, 0, 0, 0, CLOTH), cyl(0.055, 0.055, 0.34, 4, 0x8a8070, 0, 1.33 + dy, -0.19, 0, 0, Math.PI / 2));
  return p;
}
function hat(type, dy, o, lo) {
  const hy = 1.72 + dy;
  switch (type) {
    case 'shako': return lo ? [cyl(0.13, 0.115, 0.26, 5, DARK, 0, hy + 0.12, 0), box(0.05, 0.1, 0.05, o.plume, 0, hy + 0.3, 0.06)] : [
      cyl(0.135, 0.118, 0.26, 7, DARK, 0, hy + 0.12, 0), box(0.2, 0.02, 0.1, DARK, 0, hy + 0.0, 0.14, 0.3),
      box(0.09, 0.1, 0.02, BRASS, 0, hy + 0.12, 0.129, 0.07, 0, 0, MET), box(0.05, 0.13, 0.05, o.plume, 0, hy + 0.3, 0.08)];
    case 'tricorne': return [cyl(0.11, 0.12, 0.12, lo ? 4 : 6, DARK, 0, hy + 0.05, 0), cyl(0.27, 0.27, 0.04, 3, DARK, 0, hy + 0.02, -0.02), ...(lo ? [] : [cyl(0.285, 0.285, 0.012, 3, GOLD, 0, hy + 0.0, -0.02)])];
    case 'brim': return [cyl(0.29, 0.29, 0.03, lo ? 6 : 8, 0x3a2a1a, 0, hy + 0.02, 0), cyl(0.12, 0.14, 0.17, lo ? 4 : 6, 0x3a2a1a, 0, hy + 0.1, 0), box(0.03, 0.26, 0.07, WHITE, -0.13, hy + 0.2, -0.02, 0, 0, 0.35)];
    case 'morion': {
      const brim = fin(place(new THREE.CylinderGeometry(0.22, 0.22, 0.02, lo ? 6 : 8).scale(0.72, 1, 1), 0, hy - 0.02, 0), STEEL, MET);
      return lo ? [cyl(0.05, 0.15, 0.17, 5, STEEL, 0, hy + 0.05, 0, 0, 0, 0, MET), brim] :
        [ell(0.15, 7, 3, STEEL, 0, hy - 0.03, 0, 1, 0.95, 1.1, MET, Math.PI / 2), brim, box(0.02, 0.09, 0.26, STEEL, 0, hy + 0.12, 0, 0, 0, 0, MET)];
    }
    case 'cap': return [cyl(0.125, 0.13, 0.12, lo ? 4 : 7, o.capCol, 0, hy + 0.05, 0), ...(lo ? [] : [box(0.18, 0.02, 0.09, DARK, 0, hy - 0.0, 0.13, 0.3)])];
    case 'busby': return lo ? [cyl(0.13, 0.12, 0.3, 5, 0x2a1d14, 0, hy + 0.13, 0)] :
      [cyl(0.135, 0.12, 0.3, 7, 0x2a1d14, 0, hy + 0.13, 0), box(0.06, 0.2, 0.12, o.facing, 0.12, hy + 0.16, -0.02, 0, 0, -0.25), box(0.05, 0.16, 0.05, o.plume, 0, hy + 0.36, 0.06)];
    case 'helmet': return lo ? [cyl(0.06, 0.15, 0.2, 5, STEEL, 0, hy + 0.06, 0, 0, 0, 0, MET), box(0.04, 0.1, 0.28, BRASS, 0, hy + 0.18, 0)] :
      [ell(0.15, 7, 3, STEEL, 0, hy - 0.04, 0, 1, 1.05, 1.1, MET, Math.PI / 2), box(0.04, 0.11, 0.3, BRASS, 0, hy + 0.13, 0, 0, 0, 0, MET),
        box(0.03, 0.28, 0.06, DARK, 0, hy - 0.02, -0.17, -0.25)];
  }
  return [];
}
// arms holding a musket at port; the musket (part 5) swings level to the shoulder when aiming
function musketArms(o, dy, lo) {
  const p = [];
  part(3, 1.4 + dy, 0);
  if (lo) p.push(limb([-0.23, 1.42 + dy, 0], [0.12, 1.36 + dy, 0.34], 0.1, 0.1, o.coat));
  else p.push(limb([-0.23, 1.42 + dy, 0], [-0.15, 1.17 + dy, 0.17], 0.1, 0.11, o.coat, CLOTH), limb([-0.15, 1.17 + dy, 0.17], [0.15, 1.4 + dy, 0.36], 0.085, 0.09, o.coat, CLOTH));
  part(4, 1.4 + dy, 0);
  if (lo) p.push(limb([0.23, 1.42 + dy, 0], [0.22, 0.98 + dy, 0.17], 0.1, 0.1, o.coat));
  else p.push(limb([0.23, 1.42 + dy, 0], [0.27, 1.15 + dy, 0.02], 0.1, 0.11, o.coat, CLOTH), limb([0.27, 1.15 + dy, 0.02], [0.22, 0.98 + dy, 0.17], 0.085, 0.09, o.coat, CLOTH));
  part(0);
  return p;
}
function musket(len, bayo, dy, lo) {
  const butt = [0.21, 0.95 + dy, 0.17];
  part(5, butt[1], butt[2]);
  const p = lo ? [box(0.06, 0.08, len, WOOD, 0, 0, len / 2)] : [
    box(0.06, 0.11, 0.42, WOOD, 0, -0.01, 0.21, 0, 0, 0, WD),
    box(0.05, 0.06, len - 0.4, WOOD, 0, 0, 0.4 + (len - 0.4) / 2, 0, 0, 0, WD),
    box(0.028, 0.028, len - 0.3, 0x50535a, 0, 0.04, 0.3 + (len - 0.3) / 2, 0, 0, 0, MET)];
  if (bayo) p.push(box(0.024, 0.03, bayo, STEEL, 0.03, 0.03, len + bayo / 2 - 0.05, 0, 0, 0, MET));
  part(0);
  return xform(p, -1.15, butt[0], butt[1], butt[2]);
}

// o: { coat, facing, trousers, gaiter, belt, plume, capCol }
function infantry(kind, o, lo) {
  const p = [...legs(o, lo), ...torso(o, 0, lo, kind !== 'pike')];
  switch (kind) {
    case 'line': p.push(...hat('shako', 0, o, lo), ...musketArms(o, 0, lo), ...musket(1.5, 0.55, 0, lo)); break;
    case 'rifle': p.push(...hat('shako', 0, o, lo), ...musketArms(o, 0, lo), ...musket(1.3, 0, 0, lo)); break;
    case 'musk': p.push(...hat('brim', 0, o, lo), ...musketArms(o, 0, lo), ...musket(1.55, 0, 0, lo)); break;
    case 'pike': {
      part(0);
      p.push(...hat('morion', 0, o, lo));
      if (!lo) p.push(tbox(0.4, 0.48, 0.32, 0.27, 0.3, STEEL, 0, 1.27, 0, 0, 0, 0, MET));            // corselet
      part(3, 1.4, 0);
      p.push(lo ? limb([-0.23, 1.42, 0], [-0.24, 1.0, 0.1], 0.1, 0.1, o.coat) : limb([-0.23, 1.42, 0], [-0.26, 1.13, 0.06], 0.1, 0.11, o.coat, CLOTH));
      if (!lo) p.push(limb([-0.26, 1.13, 0.06], [-0.2, 0.98, 0.22], 0.085, 0.09, o.coat, CLOTH));
      part(7, 1.4, 0);
      p.push(lo ? limb([0.23, 1.42, 0], [0.27, 1.2, 0.14], 0.1, 0.1, o.coat) : limb([0.23, 1.42, 0], [0.31, 1.12, -0.02], 0.1, 0.11, o.coat, CLOTH));
      if (!lo) p.push(limb([0.31, 1.12, -0.02], [0.27, 1.2, 0.14], 0.085, 0.09, o.coat, CLOTH));
      part(6, 1.2, 0.14);
      p.push(box(0.045, 4.9, 0.045, WOOD, 0.27, 2.55, 0.14, 0, 0, 0, WD), cyl(0, 0.045, 0.34, 4, STEEL, 0.27, 5.17, 0.14, 0, 0, 0, MET));
      part(0);
      break;
    }
    case 'crew': {
      p.push(...hat('cap', 0, o, lo), ...musketArms(o, 0, lo));
      p.push(limb([0.32, 0.35, -0.25], [0.18, 2.3, 0.45], 0.04, 0.04, WOOD, WD), cyl(0.07, 0.07, 0.22, lo ? 4 : 6, 0x3a3a3a, 0.165, 2.4, 0.49, 0.36));
      break;
    }
  }
  return merge(p);
}

// ---- riders (origin at the horse's feet; hips on the saddle) ---------------------------------------------------
const HS = 1.12, SADDLE = 1.45 * HS;   // horse geometry is built at 1.0 and scaled by HS
function rider(kind, o, lo) {
  const dy = SADDLE - 0.86, S = SADDLE, p = [];
  part(0);
  for (const sx of [-1, 1]) {
    if (lo) { p.push(limb([sx * 0.1, S + 0.02, 0.02], [sx * 0.31, S - 0.58, 0.18], 0.13, 0.14, o.trousers)); continue; }
    p.push(limb([sx * 0.1, S + 0.02, 0.02], [sx * 0.3, S - 0.12, 0.3], 0.14, 0.15, o.trousers, CLOTH));
    p.push(limb([sx * 0.3, S - 0.12, 0.3], [sx * 0.32, S - 0.58, 0.14], 0.12, 0.13, DARK), box(0.1, 0.07, 0.2, DARK, sx * 0.32, S - 0.6, 0.19));
  }
  p.push(box(0.72, 0.34, 0.68, o.coat, 0, S - 0.22, -0.06, 0, 0, 0, CLOTH));                          // shabraque
  if (!lo) p.push(box(0.73, 0.05, 0.69, o.facing, 0, S - 0.38, -0.06), box(0.32, 0.08, 0.42, LEATHER, 0, S - 0.02, -0.02));
  p.push(...torso(o, dy, lo, false));
  // left hand on the reins
  if (lo) p.push(limb([-0.23, 1.42 + dy, 0], [-0.06, 1.12 + dy, 0.3], 0.1, 0.1, o.coat));
  else p.push(limb([-0.23, 1.42 + dy, 0], [-0.2, 1.15 + dy, 0.12], 0.1, 0.11, o.coat, CLOTH), limb([-0.2, 1.15 + dy, 0.12], [-0.06, 1.12 + dy, 0.3], 0.085, 0.09, o.coat, CLOTH));
  const sabre = () => {   // part 9: arm + blade carried upright, raised when charging
    part(9, 1.4 + dy, 0);
    if (lo) p.push(limb([0.23, 1.42 + dy, 0], [0.28, 1.02 + dy, 0.26], 0.1, 0.1, o.coat));
    else p.push(limb([0.23, 1.42 + dy, 0], [0.28, 1.16 + dy, 0.08], 0.1, 0.11, o.coat, CLOTH), limb([0.28, 1.16 + dy, 0.08], [0.28, 1.02 + dy, 0.26], 0.085, 0.09, o.coat, CLOTH),
      box(0.12, 0.03, 0.05, GOLD, 0.28, 1.04 + dy, 0.27, 0, 0, 0, MET));
    p.push(limb([0.28, 1.02 + dy, 0.26], [0.28, 1.92 + dy, 0.5], 0.035, 0.014, STEEL, MET, 0.6));
    part(0);
  };
  switch (kind) {
    case 'lrider':
      p.push(...hat('busby', dy, o, lo));
      if (!lo) p.push(limb([-0.17, 0.98 + dy, -0.17], [0.2, 1.62 + dy, -0.17], 0.04, 0.05, WOOD, WD));   // slung carbine
      sabre();
      break;
    case 'officer':
      p.push(...hat('tricorne', dy, o, lo));
      if (!lo) p.push(box(0.12, 0.04, 0.14, GOLD, -0.22, 1.43 + dy, 0), box(0.12, 0.04, 0.14, GOLD, 0.22, 1.43 + dy, 0), box(0.37, 0.07, 0.27, 0xb02828, 0, 0.88 + dy, 0, 0, 0, 0, CLOTH));
      sabre();
      break;
    case 'hrider': {
      p.push(...hat('helmet', dy, o, lo));
      if (!lo) p.push(tbox(0.38, 0.48, 0.42, 0.27, 0.3, STEEL, 0, 1.22 + dy, 0, 0, 0, 0, MET));       // cuirass
      p.push(lo ? limb([0.23, 1.42 + dy, 0], [0.32, 1.12 + dy, 0.14], 0.1, 0.1, o.coat) : limb([0.23, 1.42 + dy, 0], [0.31, 1.18 + dy, -0.02], 0.1, 0.11, o.coat, CLOTH));
      if (!lo) p.push(limb([0.31, 1.18 + dy, -0.02], [0.32, 1.12 + dy, 0.14], 0.085, 0.09, o.coat, CLOTH));
      part(8, 1.12 + dy, 0.14);   // lance: upright, couched when charging
      p.push(box(0.05, 3.9, 0.05, WOOD, 0.32, S + 1.35, 0.14, 0, 0, 0, WD), cyl(0, 0.04, 0.3, 4, STEEL, 0.32, S + 3.45, 0.14, 0, 0, 0, MET));
      p.push(box(0.012, 0.12, 0.5, o.coat, 0.32, S + 3.1, -0.13), box(0.012, 0.12, 0.5, WHITE, 0.32, S + 2.98, -0.13));
      part(0);
      break;
    }
  }
  return merge(p);
}

// ---- horse ------------------------------------------------------------------------------------------------
function scaleHorse(g) {
  g.scale(HS, HS, HS);
  const a = g.attributes.aAnim.array;
  for (let i = 0; i < a.length; i += 4) { a[i + 1] *= HS; a[i + 2] *= HS; a[i + 3] *= HS; }
  g.computeBoundingSphere();
  return g;
}
function horse(hex, lo) {
  const leg = mul(hex, 0.55), mane = mul(hex, 0.32), p = [];
  part(0);
  if (lo) {
    p.push(box(0.56, 0.66, 1.75, hex, 0, 1.12, 0));
    part(15, 1.3, 0.62); p.push(limb([0, 1.2, 0.62], [0, 1.8, 0.98], 0.2, 0.3, hex), limb([0, 1.86, 0.97], [0, 1.5, 1.33], 0.16, 0.22, hex));
    part(16, 1.28, -0.82); p.push(limb([0, 1.3, -0.84], [0, 0.72, -1.0], 0.1, 0.14, mane));
    [[11, -0.16, 0.52], [12, 0.16, 0.52], [13, -0.16, -0.55], [14, 0.16, -0.55]].forEach(([id, x, z]) => { part(id, 1.05, z); p.push(box(0.12, 1.0, 0.14, leg, x, 0.52, z)); });
    part(0);
    return scaleHorse(merge(p));
  }
  const body = new THREE.CylinderGeometry(0.3, 0.28, 1.0, 8); body.rotateX(Math.PI / 2); body.scale(1, 1.15, 1); body.translate(0, 1.12, 0);
  p.push(fin(body, hex, HIDE));
  p.push(ell(0.3, 8, 6, hex, 0, 1.13, 0.52, 0.95, 1.12, 0.85, HIDE), ell(0.31, 8, 6, hex, 0, 1.17, -0.5, 1.0, 1.08, 0.95, HIDE));
  part(15, 1.3, 0.62);   // neck + head nod
  p.push(limb([0, 1.12, 0.6], [0, 1.78, 0.92], 0.24, 0.44, hex, HIDE, 0.58), limb([0, 1.32, 0.44], [0, 1.92, 0.8], 0.05, 0.09, mane));
  p.push(limb([0, 1.88, 0.9], [0, 1.52, 1.3], 0.17, 0.26, hex, HIDE, 0.62));
  for (const sx of [-1, 1]) p.push(box(0.04, 0.11, 0.04, hex, sx * 0.05, 1.97, 0.93, -0.2));
  part(16, 1.28, -0.82);  // tail
  p.push(limb([0, 1.3, -0.82], [0, 0.66, -1.0], 0.1, 0.14, mane, undefined, 1.6));
  for (const [id, x, z, front] of [[11, -0.16, 0.52, 1], [12, 0.16, 0.52, 1], [13, -0.16, -0.54, 0], [14, 0.16, -0.54, 0]]) {
    if (front) {
      part(id, 1.05, z);
      p.push(limb([x, 1.08, z], [x, 0.58, z + 0.02], 0.13, 0.18, hex, HIDE, 0.65));
      KNEE = 0.58;
      p.push(limb([x, 0.58, z + 0.02], [x, 0.11, z], 0.075, 0.085, leg), box(0.1, 0.1, 0.13, HOOF, x, 0.05, z + 0.02));
    } else {
      part(id, 1.1, z);
      p.push(limb([x, 1.12, z], [x, 0.62, z - 0.08], 0.14, 0.24, hex, HIDE, 0.55));
      KNEE = 0.62;
      p.push(limb([x, 0.62, z - 0.08], [x, 0.11, z - 0.02], 0.075, 0.09, leg), box(0.1, 0.1, 0.13, HOOF, x, 0.05, z));
    }
  }
  part(0);
  return scaleHorse(merge(p));
}

// ---- cannon -----------------------------------------------------------------------------------------------
function cannon() {
  const wood = 0x7a5a36, iron = 0x2c2a28, p = [];
  const el = Math.PI / 2 - 0.06, ay = 0.06, az = 0.998;   // barrel axis (y,z)
  const at = (t) => [1.15 + ay * t, 0.45 + az * t];
  part(20, 0, 0);
  p.push(cyl(0.16, 0.24, 2.2, 10, BRONZE, 0, 1.15, 0.45, el, 0, 0, MET));
  for (const [t, r, h] of [[1.04, 0.2, 0.14], [-0.98, 0.27, 0.12], [0.1, 0.215, 0.08]]) { const [y, z] = at(t); p.push(cyl(r, r, h, 10, BRONZE, 0, y, z, el, 0, 0, MET)); }
  { const [y, z] = at(-1.16); p.push(ell(0.1, 6, 4, BRONZE, 0, y, z, 1, 1, 1, MET)); }
  part(0);
  for (const sx of [-0.21, 0.21]) p.push(box(0.08, 0.36, 1.5, wood, sx, 0.98, -0.15, 0.12, 0, 0, WD));
  p.push(limb([0, 0.85, -0.55], [0, 0.12, -2.4], 0.34, 0.2, wood, WD), box(1.25, 0.12, 0.14, iron, 0, 0.82, 0));
  p.push(box(0.34, 0.22, 0.3, wood, 0, 0.62, -1.3, 0.36, 0, 0, WD));
  for (const sx of [-0.62, 0.62]) {
    p.push(cyl(0.82, 0.82, 0.1, 14, 0x8a6a44, sx, 0.82, 0, 0, 0, Math.PI / 2, { cell: CELL.wood, cap: CELL.wheel }));
    p.push(cyl(0.12, 0.12, 0.26, 6, iron, sx, 0.82, 0, 0, 0, Math.PI / 2));
  }
  return merge(p);
}

// ---- pose shader ----------------------------------------------------------------------------------------
// part ids: 1/2 legs, 3 left arm, 4 musket arm, 5 musket, 6 pike, 7 pike arm, 8 lance, 9 sabre arm,
// 11-14 horse legs (FL FR BL BR), 15 horse neck, 16 tail, 20 cannon barrel. FIG_KIND: 0 foot, 1 rider, 2 horse, 3 cannon.
const FIG_GLSL = /* glsl */`
attribute vec4 aAnim;
attribute vec4 iAnim;
uniform float uTime;
vec2 figRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
void figRX(inout vec3 p, inout vec3 n, vec2 piv, float a) { p.yz = figRot(p.yz - piv, a) + piv; n.yz = figRot(n.yz, a); }
bool figIs(float part, float id) { return abs(part - id) < 0.5; }
void figPose(inout vec3 p, inout vec3 n) {
  float part = aAnim.x; vec2 piv = aAnim.yz; float knee = aAnim.w;
  float cyc = iAnim.x, g = iAnim.y, aim = iAnim.z, rec = iAnim.w;
  float amp = clamp(g, 0.0, 1.0);
#if FIG_KIND == 0
  if (part > 0.5 && part < 2.5) {
    float ph = cyc + (part < 1.5 ? 0.0 : 3.14159);
    if (knee > 0.0) figRX(p, n, vec2(knee, piv.y), max(0.0, cos(ph)) * 0.9 * amp);
    figRX(p, n, piv, -sin(ph) * 0.5 * amp);
  } else if (figIs(part, 3.0)) figRX(p, n, piv, -aim * 0.35 + sin(cyc) * 0.15 * amp * (1.0 - aim));
  else if (figIs(part, 4.0)) figRX(p, n, piv, -aim * 0.85 + rec * 0.15);
  else if (figIs(part, 5.0)) { figRX(p, n, piv, aim * 1.15 - rec * 0.22); p += aim * vec3(0.0, 0.45, -0.17) + rec * vec3(0.0, 0.0, -0.07); }
  else if (figIs(part, 6.0)) figRX(p, n, piv, aim * 1.1);
  else if (figIs(part, 7.0)) figRX(p, n, piv, -aim * 0.6);
  figRX(p, n, vec2(0.0), 0.07 * amp - rec * 0.05);                       // lean into the march, rock back on recoil
  p.y += abs(cos(cyc)) * 0.05 * amp;
  p.x += sin(uTime * 0.9 + cyc * 3.0) * 0.012 * p.y * (1.0 - amp);       // idle sway
#elif FIG_KIND == 3
  if (figIs(part, 20.0)) p.z -= rec * 0.45;
  p.z -= rec * 0.3;
#else
  float gal = smoothstep(1.25, 1.75, g);
#if FIG_KIND == 2
  if (part > 10.5 && part < 14.5) {
    float id = part - 11.0;
    float trot = (id < 0.5 || id > 2.5) ? 0.0 : 3.14159;
    float galo = id < 0.5 ? 0.0 : id < 1.5 ? 0.7 : id < 2.5 ? 3.3 : 4.0;
    float ph = cyc + mix(trot, galo, gal);
    if (knee > 0.0) figRX(p, n, vec2(knee, piv.y), max(0.0, cos(ph)) * (id < 1.5 ? 1.1 : 0.6) * amp);
    figRX(p, n, piv, -sin(ph) * (0.32 + 0.3 * gal) * amp);
  } else if (figIs(part, 15.0)) figRX(p, n, piv, sin(cyc * 2.0) * 0.06 * amp + 0.12 * gal * amp + sin(uTime * 0.5 + cyc) * 0.04 * (1.0 - amp));
  else if (figIs(part, 16.0)) figRX(p, n, piv, -0.55 * gal * amp + sin(uTime * 1.7 + cyc) * 0.07);
#else
  if (figIs(part, 8.0)) figRX(p, n, piv, aim * 1.35);
  else if (figIs(part, 9.0)) figRX(p, n, piv, -aim * 1.25);
#endif
  figRX(p, n, vec2(1.25, 0.0), sin(cyc + 1.2) * 0.06 * gal * amp);       // gallop rocking, shared by horse and rider
  p.y += mix(abs(cos(cyc)) * 0.05, (0.5 + 0.5 * sin(cyc)) * 0.16, gal) * amp;
#endif
}
`;
function figMaterial(kind, atlas, uTime, depth) {
  const mat = depth ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }) : new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas });
  mat.defines = { FIG_KIND: kind };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FIG_GLSL);
    if (depth) {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec3 figN = vec3(0.0, 1.0, 0.0); figPose(transformed, figN); }');
    } else {
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 figP = vec3(position); figPose(figP, objectNormal);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = figP;');
      // emissive lift + rim so coat colours stay saturated in shadow
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float rim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += diffuseColor.rgb * (0.1 + 0.45 * rim * rim * rim); }`);
    }
  };
  mat.customProgramCacheKey = () => `fig${kind}${depth ? 'd' : ''}`;
  return mat;
}

export const COATS = { player: 0xd2301f, enemy: 0x2c58cc };
export const HORSE_COLORS = [0x82501f, 0x4a2e1a, 0xa8793f];

export function buildModels() {
  const m = { soldier: {}, horse: HORSE_COLORS.map(h => horse(h, false)), cannon: cannon(), corpse: {}, lod: { soldier: {}, horse: HORSE_COLORS.map(h => horse(h, true)) } };
  for (const side of ['player', 'enemy']) {
    const coat = COATS[side];
    const fac = side === 'player' ? 0xf2ead2 : 0xf0dc8a;
    const line = { coat, facing: fac, trousers: 0xf0eada, gaiter: 0x262220, belt: WHITE, plume: WHITE };
    const rifle = { coat: mul(coat, 0.5), facing: 0x1e1e1e, trousers: 0x4a4c40, gaiter: 0x1e1c1a, belt: 0x1e1a16, plume: 0x3c8a34 };
    const tercio = { coat, facing: fac, trousers: 0xd8c8a0, gaiter: 0xd0c098, belt: 0x6a4a2a, plume: WHITE };
    const cav = { coat, facing: fac, trousers: 0xe2dccb, gaiter: DARK, belt: WHITE, plume: WHITE };
    const crew = { coat: mul(coat, 0.45), facing: mul(coat, 0.9), trousers: 0x6a6a64, gaiter: 0x262220, belt: WHITE, capCol: 0x24242a };
    const officer = { ...cav, facing: GOLD, belt: GOLD };
    const set = (lo) => ({
      line: infantry('line', line, lo), rifle: infantry('rifle', rifle, lo),
      pike: infantry('pike', tercio, lo), musk: infantry('musk', tercio, lo),
      lrider: rider('lrider', cav, lo), hrider: rider('hrider', cav, lo), officer: rider('officer', officer, lo),
      crew: infantry('crew', crew, lo),
    });
    m.soldier[side] = set(false);
    m.lod.soldier[side] = set(true);
    m.corpse[side] = infantry('line', line, false);   // static pose; Effects lays it down
  }
  m.uTime = { value: 0 };
  const atlas = makeAtlas();
  m.mats = {};
  for (const [k, id] of [['infantry', 0], ['rider', 1], ['horse', 2], ['cannon', 3]]) m.mats[k] = { mat: figMaterial(id, atlas, m.uTime, false), depth: figMaterial(id, atlas, m.uTime, true) };
  return m;
}
