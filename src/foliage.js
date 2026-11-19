// Ground splat shader, GPU-scattered grass, woods, hedgerows, bushes, rocks, stone-wall material and wheat.
// All textures are procedural canvases. Called from terrain.js (createTerrain); owns nothing outside scenery.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ 7771;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function pnoise(x, y, p) {   // value noise wrapping every p lattice cells
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (i) => ((i % p) + p) % p;
  const a = hash2(w(xi), w(yi)), b = hash2(w(xi + 1), w(yi)), c = hash2(w(xi), w(yi + 1)), d = hash2(w(xi + 1), w(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function canvasTex(w, h, draw, o = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8;
  if (o.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// draw fn(x,y) at every wrapped copy that touches the canvas, so textures tile
function wrapDraw(w, h, x, y, r, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    const px = x + ox, py = y + oy;
    if (px < -r || px > w + r || py < -r || py > h + r) continue;
    fn(px, py);
  }
}
function noiseImage(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h), d = img.data, o = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    fn(x, y, o); const k = (y * w + x) * 4;
    d[k] = o[0] * 255; d[k + 1] = o[1] * 255; d[k + 2] = o[2] * 255; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
const fract = (x) => x - Math.floor(x);

// ---- ground detail textures (mid-tone, tinted by the baked macro colour in the shader) --------------
function groundGrassTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    noiseImage(ctx, w, h, (x, y, o) => {
      const n = pnoise(x / 64, y / 64, 8) * 0.4 + pnoise(x / 32, y / 32, 16) * 0.3 + pnoise(x / 8, y / 8, 64) * 0.2 + pnoise(x / 4, y / 4, 128) * 0.1;
      const v = 0.74 + (n - 0.5) * 0.5; o[0] = v * 0.93; o[1] = v; o[2] = v * 0.66;
    });
    const r = mulberry32(7); ctx.lineWidth = 1.2;
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h, l = 3 + r() * 7, lean = (r() - 0.5) * 4, dark = r() < 0.5;
      ctx.strokeStyle = dark ? `rgba(60,76,24,${0.15 + r() * 0.25})` : `rgba(255,250,190,${0.12 + r() * 0.25})`;
      wrapDraw(w, h, x, y, 10, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + lean, py - l); ctx.stroke(); });
    }
  });
}
function groundDryTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    noiseImage(ctx, w, h, (x, y, o) => {
      const n = pnoise(x / 64, y / 64, 8) * 0.45 + pnoise(x / 16, y / 16, 32) * 0.35 + pnoise(x / 4, y / 4, 128) * 0.2;
      const v = 0.8 + (n - 0.5) * 0.5; o[0] = v * 0.98; o[1] = v * 0.86; o[2] = v * 0.56;
    });
    const r = mulberry32(17); ctx.lineWidth = 1;
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h, l = 5 + r() * 12, a = (r() - 0.5) * 1.5 - Math.PI / 2, dark = r() < 0.4;
      ctx.strokeStyle = dark ? `rgba(110,80,36,${0.15 + r() * 0.25})` : `rgba(255,236,170,${0.15 + r() * 0.3})`;
      wrapDraw(w, h, x, y, 14, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); });
    }
  });
}
function groundDirtTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    noiseImage(ctx, w, h, (x, y, o) => {
      const n = pnoise(x / 64, y / 64, 8) * 0.4 + pnoise(x / 16, y / 16, 32) * 0.3 + pnoise(x / 4, y / 4, 128) * 0.2 + pnoise(x / 2, y / 2, 256) * 0.1;
      const v = 0.8 + (n - 0.5) * 0.7; o[0] = v * 0.95; o[1] = v * 0.8; o[2] = v * 0.6;
    });
    const r = mulberry32(27);
    for (let i = 0; i < 1800; i++) {   // pebbles
      const x = r() * w, y = r() * h, rr = 0.8 + r() * 2.4, lt = r() < 0.5;
      ctx.fillStyle = lt ? `rgba(240,225,195,${0.25 + r() * 0.3})` : `rgba(50,36,24,${0.2 + r() * 0.3})`;
      wrapDraw(w, h, x, y, 4, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, rr, rr * 0.7, r() * 3, 0, TAU); ctx.fill(); });
    }
    ctx.strokeStyle = 'rgba(60,44,30,0.28)'; ctx.lineWidth = 1;
    for (let i = 0; i < 70; i++) {   // dry cracks
      let x = r() * w, y = r() * h, a = r() * TAU; ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 7; y += Math.sin(a) * 7; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}
function groundMudTex() {
  return canvasTex(512, 512, (ctx, w, h) => {
    noiseImage(ctx, w, h, (x, y, o) => {
      const n = pnoise(x / 64, y / 64, 8) * 0.5 + pnoise(x / 16, y / 16, 32) * 0.3 + pnoise(x / 4, y / 4, 128) * 0.2;
      const wet = sstep(0.55, 0.7, pnoise(x / 32 + 3, y / 32 + 5, 16));
      const v = (0.62 + (n - 0.5) * 0.6) * (1 - wet * 0.35); o[0] = v * 0.9; o[1] = v * 0.72; o[2] = v * 0.55;
    });
    const r = mulberry32(37);
    for (let i = 0; i < 260; i++) {   // churned lumps and glints
      const x = r() * w, y = r() * h, rr = 2 + r() * 6;
      ctx.fillStyle = r() < 0.5 ? `rgba(35,24,15,${0.18 + r() * 0.2})` : `rgba(190,160,120,${0.08 + r() * 0.12})`;
      wrapDraw(w, h, x, y, 10, (px, py) => { ctx.beginPath(); ctx.ellipse(px, py, rr, rr * 0.6, r() * 3, 0, TAU); ctx.fill(); });
    }
  });
}
function groundNormalTex() {
  const S = 256, H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    H[y * S + x] = pnoise(x / 32, y / 32, 8) * 0.45 + pnoise(x / 8, y / 8, 32) * 0.35 + pnoise(x / 4, y / 4, 64) * 0.2;
  }
  return canvasTex(S, S, (ctx, w, h) => {
    const img = ctx.createImageData(w, h), d = img.data, at = (x, y) => H[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let nx = (at(x - 1, y) - at(x + 1, y)) * 3.2, ny = (at(x, y - 1) - at(x, y + 1)) * 3.2;
      const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l; const nz = 1 / l, k = (y * w + x) * 4;
      d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { linear: true });
}

// ---- foliage / stone textures ------------------------------------------------------------------------
function grassTuftTex() {   // alpha-cut tuft of curved, tapered blades
  return canvasTex(128, 128, (ctx, w, h) => {
    const r = mulberry32(5);
    for (let i = 0; i < 22; i++) {
      const x0 = 12 + r() * (w - 24), hh = 52 + r() * 70, lean = (r() - 0.5) * 46, bw = 3 + r() * 4.5;
      const tx = x0 + lean, ty = h - hh, cx = x0 + lean * 0.25, cy = h - hh * 0.55;
      const g = ctx.createLinearGradient(0, h, 0, ty);
      g.addColorStop(0, 'rgb(110,110,90)'); g.addColorStop(0.45, 'rgb(205,205,180)'); g.addColorStop(1, 'rgb(255,255,235)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0 - bw, h);
      ctx.quadraticCurveTo(cx - bw * 0.7, cy, tx, ty); ctx.quadraticCurveTo(cx + bw * 0.7, cy, x0 + bw, h); ctx.fill();
    }
  }, { repeat: false });
}
function wheatTex() {   // alpha-cut card: stalks with awned ears
  return canvasTex(128, 128, (ctx, w, h) => {
    const r = mulberry32(15);
    for (let i = 0; i < 34; i++) {
      const x0 = 6 + r() * (w - 12), lean = (r() - 0.5) * 24, top = 8 + r() * 24, k = 0.78 + r() * 0.22;
      const g = ctx.createLinearGradient(0, h, 0, top);
      g.addColorStop(0, `rgb(${120 * k},${120 * k},${50 * k})`); g.addColorStop(0.6, `rgb(${215 * k},${180 * k},${84 * k})`); g.addColorStop(1, `rgb(${236 * k},${200 * k},${96 * k})`);
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, h); ctx.quadraticCurveTo(x0 + lean * 0.2, h * 0.5, x0 + lean, top + 10); ctx.stroke();
      ctx.fillStyle = `rgb(${244 * k},${208 * k},${98 * k})`;   // ear
      ctx.beginPath(); ctx.ellipse(x0 + lean * 1.05, top + 5, 2.6, 9, lean * 0.012, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,236,150,${0.7 * k})`; ctx.lineWidth = 0.7;   // awns
      for (let a = -1; a <= 1; a += 2) { ctx.beginPath(); ctx.moveTo(x0 + lean * 1.05, top + 8); ctx.lineTo(x0 + lean * 1.05 + a * 3, top - 9); ctx.stroke(); }
    }
  }, { repeat: false });
}
function leafTex() {   // clustered leaves, alpha-cut for ragged canopy edges
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = mulberry32(21);
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 330; i++) {
      const x = r() * w, y = r() * h, a = r() * TAU, l = 6 + r() * 5, wd = 3 + r() * 2.4;
      const v = layer === 0 ? 0.46 + r() * 0.16 : layer === 1 ? 0.66 + r() * 0.18 : 0.86 + r() * 0.14;
      ctx.fillStyle = `rgb(${v * 230 | 0},${v * 255 | 0},${v * 165 | 0})`;
      wrapDraw(w, h, x, y, 12, (px, py) => { ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, l, wd, 0, 0, TAU); ctx.fill(); ctx.restore(); });
    }
  });
}
function needleTex() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(120,140,100)'; ctx.fillRect(0, 0, w, h);
    const r = mulberry32(31); ctx.lineWidth = 1.4;
    for (let i = 0; i < 1100; i++) {
      const x = r() * w, y = r() * h, l = 5 + r() * 8, a = Math.PI / 2 + (r() - 0.5) * 1.8, v = 0.45 + r() * 0.75;
      ctx.strokeStyle = `rgba(${v * 150 | 0},${v * 190 | 0},${v * 120 | 0},0.8)`;
      wrapDraw(w, h, x, y, 14, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); });
    }
  });
}
function barkTex() {
  return canvasTex(64, 256, (ctx, w, h) => {
    noiseImage(ctx, w, h, (x, y, o) => {
      const n = pnoise(x / 4, y / 64, 16) * 0.55 + pnoise(x / 2, y / 8, 32) * 0.45, v = 0.5 + n * 0.6;
      const crack = sstep(0.62, 0.8, pnoise(x / 3, y / 24, 21)); const k = v * (1 - crack * 0.45);
      o[0] = k * 0.95; o[1] = k * 0.88; o[2] = k * 0.8;
    });
  });
}
function stoneTex(size, cells, seed) {   // tileable voronoi stones with dark joints and lichen
  return canvasTex(size, size, (ctx, w, h) => {
    const r = mulberry32(seed), pts = [], cs = size / cells;
    for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) pts.push([(gx + 0.15 + r() * 0.7) * cs, (gy + 0.15 + r() * 0.7) * cs, 0.55 + r() * 0.4, r()]);
    noiseImage(ctx, w, h, (x, y, o) => {
      let d1 = 1e9, d2 = 1e9, best = null;
      const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy, p = pts[((gy % cells + cells) % cells) * cells + ((gx % cells + cells) % cells)];
        const px = p[0] + Math.floor(gx / cells) * size, py = p[1] + Math.floor(gy / cells) * size;
        const d = Math.hypot(x - px, y - py);
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const edge = sstep(0.4, 3.2, d2 - d1);
      let v = best[2] * (0.78 + 0.3 * (1 - Math.min(1, d1 / (cs * 0.75)))) * (0.9 + 0.2 * pnoise(x / 6, y / 6, Math.max(1, Math.round(size / 6))));
      const warm = best[3];
      let rr = v * (0.96 + warm * 0.1), gg = v * (0.92 + warm * 0.04), bb = v * (0.8 + warm * 0.04);
      const lich = sstep(0.62, 0.78, pnoise(x / 9 + seed, y / 9, Math.max(1, Math.round(size / 9)))) * 0.55;
      rr = lerp(rr, 0.62, lich * 0.7); gg = lerp(gg, 0.68, lich * 0.7); bb = lerp(bb, 0.3, lich * 0.7);
      const k = edge; o[0] = lerp(0.1, rr, k); o[1] = lerp(0.09, gg, k); o[2] = lerp(0.08, bb, k);
    });
  });
}

// ---- geometry helpers ---------------------------------------------------------------------------------
// ellipsoid blob (lumpy icosphere) appended to arrays; normals tilt toward the crown centre for soft foliage lighting
function addBlob(A, cx, cy, cz, rx, ry, rz, seed, o = {}) {
  const g = new THREE.IcosahedronGeometry(1, o.detail ?? 1), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const lump = o.lump ?? 0.2, lo = o.lo ?? 0.55, hi = o.hi ?? 1.15, ctr = o.center || [cx, cy, cz], bright = o.bright ?? 1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + lump * (Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.7) + 0.6 * Math.sin(z * 3.9 + seed * 0.6) * Math.sin(x * 2.3 - seed));
    const wx = cx + x * k * rx, wy = cy + y * k * ry, wz = cz + z * k * rz;
    A.pos.push(wx, wy, wz);
    let ox = wx - ctr[0], oy = wy - ctr[1], oz = wz - ctr[2]; const ol = Math.hypot(ox, oy, oz) || 1;
    let nx = lerp(n.getX(i), ox / ol, 0.55), ny = lerp(n.getY(i), oy / ol, 0.55), nz = lerp(n.getZ(i), oz / ol, 0.55); const nl = Math.hypot(nx, ny, nz) || 1;
    A.nrm.push(nx / nl, ny / nl, nz / nl);
    A.uv.push(uv.getX(i), uv.getY(i));
    const c = lerp(lo, hi, (y + 1) / 2) * bright; A.col.push(c, c, c);
  }
  g.dispose();
}
function toGeo(A) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
  if (A.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(A.col, 3));
  return g;
}
const newA = () => ({ pos: [], nrm: [], uv: [], col: [] });
function addCyl(A, rt, rb, h, y0, seg, tilt = 0, yaw = 0, ox = 0, oz = 0, bright = 1) {   // trunk / branch cylinder
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, true).toNonIndexed();
  g.translate(0, h / 2, 0); g.rotateZ(tilt); g.rotateY(yaw); g.translate(ox, y0, oz);
  const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { A.pos.push(p.getX(i), p.getY(i), p.getZ(i)); A.nrm.push(n.getX(i), n.getY(i), n.getZ(i)); A.uv.push(u.getX(i), u.getY(i)); A.col.push(bright, bright, bright); }
  g.dispose();
}
function oakCrown(seed) {
  const A = newA(), r = mulberry32(seed), c = [0, 6.1, 0];
  const o = { center: c, lump: 0.22 };
  addBlob(A, 0, 6.2, 0, 3.3, 2.7, 3.3, seed, { ...o, lo: 0.5, hi: 1.15 });
  for (let k = 0; k < 4; k++) { const a = k * 1.57 + r(); addBlob(A, Math.cos(a) * 2.6, 5.3 + r() * 0.8, Math.sin(a) * 2.6, 2.2, 1.8, 2.2, seed + k, { ...o, lo: 0.45, hi: 1.1, bright: 0.92 }); }
  addBlob(A, (r() - 0.5) * 1.2, 8.1, (r() - 0.5) * 1.2, 2.3, 1.9, 2.3, seed + 9, { ...o, lo: 0.7, hi: 1.25 });
  return toGeo(A);
}
function elmCrown(seed) {
  const A = newA(), r = mulberry32(seed), c = [0, 7.5, 0];
  const ys = [4.8, 6.4, 8.0, 9.4, 10.6], rs = [2.5, 2.7, 2.4, 1.9, 1.3];
  ys.forEach((y, i) => addBlob(A, (r() - 0.5) * 1.1, y, (r() - 0.5) * 1.1, rs[i], rs[i] * 1.05, rs[i], seed + i, { center: c, lump: 0.2, lo: 0.5 + i * 0.05, hi: 1.15 }));
  return toGeo(A);
}
function birchCrown(seed) {
  const A = newA(), r = mulberry32(seed), c = [0, 5.4, 0];
  const L = [[0, 5.6, 0, 1.9], [1.4, 4.7, 0.8, 1.6], [-1.2, 5.0, -1.0, 1.7], [0.3, 6.9, 0.3, 1.5], [-0.4, 4.3, 1.3, 1.3]];
  L.forEach(([x, y, z, rr], i) => addBlob(A, x, y, z, rr, rr * 1.1, rr, seed + i, { center: c, lump: 0.22, lo: 0.55, hi: 1.2 }));
  return toGeo(A);
}
function trunkGeo(kind, seed) {
  const A = newA(), r = mulberry32(seed);
  if (kind === 'birch') { addCyl(A, 0.12, 0.22, 5.2, 0, 5); addCyl(A, 0.07, 0.11, 2.0, 3.4, 4, 0.5, r() * 6); }
  else if (kind === 'elm') { addCyl(A, 0.22, 0.5, 6.0, 0, 6); addCyl(A, 0.1, 0.18, 3.0, 4.4, 4, 0.5, 1.0); addCyl(A, 0.1, 0.18, 3.0, 4.2, 4, -0.5, 2.6); }
  else { addCyl(A, 0.3, 0.62, 5.0, 0, 6); addCyl(A, 0.12, 0.24, 3.0, 3.4, 4, 0.55, r() * 6); addCyl(A, 0.12, 0.24, 3.0, 3.2, 4, -0.55, r() * 6); }
  return toGeo(A);
}
function conifer(tiers, h0, step, r0, seed, spread) {   // star-edged stacked cones, no trunk needed
  const A = newA(), r = mulberry32(seed), seg = 9;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1), R = lerp(r0, 0.4, f * 0.92), y = h0 + t * step, hh = lerp(2.6, 1.8, f) * (spread ? 0.85 : 1.0);
    const rot = r() * TAU, ring = [];
    for (let k = 0; k < seg; k++) { const a = rot + (k / seg) * TAU, rr = R * (k % 2 ? 0.74 : 1.04) * (0.94 + r() * 0.12); ring.push([Math.cos(a) * rr, y - 0.1 * (k % 2), Math.sin(a) * rr]); }
    for (let k = 0; k < seg; k++) {
      const a = ring[k], b = ring[(k + 1) % seg], tp = [0, y + hh, 0];
      for (const [p, u, v] of [[a, 0, 0], [tp, 0.5, 1], [b, 1, 0]]) {   // winding faces outward/up
        A.pos.push(p[0], p[1], p[2]);
        const dl = Math.hypot(p[0], p[2]) || 1; const ny = 0.65, nx = p[0] / dl * 0.76, nz = p[2] / dl * 0.76;
        A.nrm.push(p === tp ? 0 : nx, p === tp ? 1 : ny, p === tp ? 0 : nz);
        A.uv.push(u * 1.5 + k, v * 1.2 + t * 0.5);
        const c = lerp(0.45 + 0.08 * (1 - f), 1.15, v) * (0.85 + f * 0.25); A.col.push(c, c, c);
      }
    }
  }
  return toGeo(A);
}
function stoneGeometry() {   // irregular block: corners jittered consistently so faces never crack
  const g = new THREE.BoxGeometry(1, 1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const sx = Math.sign(p.getX(i)), sy = Math.sign(p.getY(i)), sz = Math.sign(p.getZ(i)), s = (sx + 1) * 1 + (sy + 1) * 2 + (sz + 1) * 4;
    p.setXYZ(i, p.getX(i) + (hash2(s, 1) - 0.5) * 0.26, p.getY(i) + (hash2(s, 2) - 0.5) * 0.22, p.getZ(i) + (hash2(s, 3) - 0.5) * 0.26);
  }
  g.computeVertexNormals();
  return g;
}
function rockGeometry(seed) {
  const A = newA(); addBlob(A, 0, 0, 0, 1, 0.7, 0.85, seed, { lump: 0.32, lo: 0.8, hi: 1.05, detail: 1, center: [0, 0, 0] });
  const g = toGeo(A); g.deleteAttribute('color'); return g;
}

// ---- shared shader pieces -----------------------------------------------------------------------------
const windTime = { value: 0 };
const U = {   // world-layout uniforms shared by ground + grass shaders (filled in createFoliage)
  uField: { value: new THREE.Vector4() }, uFieldRot: { value: new THREE.Vector2() },
  uVill: { value: new THREE.Vector3() }, uMapInfo: { value: new THREE.Vector4() },   // MAP, HALF, CELL, N
};
const GLSL_COMMON = `
uniform vec4 uField; uniform vec2 uFieldRot; uniform vec3 uVill; uniform vec4 uMapInfo; uniform float uTime;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1.0,0.0)), f.x), mix(h21(i+vec2(0.0,1.0)), h21(i+vec2(1.0,1.0)), f.x), f.y); }
float fbm2(vec2 p){ return vn(p)*0.55 + vn(p*2.03+17.1)*0.3 + vn(p*4.07+3.3)*0.15; }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
float roadSgn(vec2 p){ float a = (p.y+170.0)*0.0045; float sl = 60.0*0.0045*cos(a); return (p.x - 60.0*sin(a)) / sqrt(1.0+sl*sl); }
float roadAmt(vec2 p){ float d = abs(roadSgn(p)) + (fbm2(p*0.3)-0.5)*2.4 + (vn(p*1.6)-0.5)*0.6; return 1.0 - smoothstep(2.4, 4.4, d); }
float fieldAmt(vec2 p, out vec2 l){ vec2 d = p - uField.xy; l = vec2(d.x*uFieldRot.x + d.y*uFieldRot.y, -d.x*uFieldRot.y + d.y*uFieldRot.x);
  float m = max(abs(l.x)-uField.z, abs(l.y)-uField.w); return 1.0 - smoothstep(-0.4, 0.8, m); }
vec2 windAt(vec2 w, float h, float amp, float flut, float ph){
  float b = h*h;
  float g = sin(uTime*1.45 + w.x*0.045 + w.y*0.03)*0.6 + 0.4*sin(uTime*2.3 + w.x*0.1 - w.y*0.07);
  float f = sin(uTime*3.7 + ph*6.283 + w.x*0.9);
  return vec2(g*amp + f*flut, g*amp*0.4 + sin(uTime*3.1 + ph*9.0)*flut) * b;
}
`;
const UP_NORMAL_FRAG = 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;';

// patch a Lambert material: custom vertex stages + optional extra fragment code
function patch(mat, key, o) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windTime;
    for (const k in (o.uniforms || {})) sh.uniforms[k] = o.uniforms[k];
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>\n${o.defs || ''}\n${GLSL_COMMON}\n${o.vHead || ''}`);
    fs = fs.replace('#include <common>', `#include <common>\n${o.defs || ''}\n${GLSL_COMMON}\n${o.fHead || ''}`);
    for (const [from, to] of o.vRep || []) vs = vs.replace(from, to);
    for (const [from, to] of o.fRep || []) fs = fs.replace(from, to);
    sh.vertexShader = vs; sh.fragmentShader = fs;
  };
}
// instanced wind: bends by normalised height, travelling gusts plus per-instance flutter
function windMat(mat, key, { href, amp, flut, leaf = 0, upNormal = false, stoneUV = false }) {
  const defs = `#define WH ${href.toFixed(2)}\n#define WAMP ${amp.toFixed(3)}\n#define WFLUT ${flut.toFixed(3)}\n#define WLEAF ${leaf.toFixed(3)}${leaf > 0 ? '\n#define HAS_LEAF' : ''}`;
  const proj = `
    float wph = h21(instanceMatrix[3].xz);
    #ifdef HAS_LEAF
    transformed += sin(position*4.1 + uTime*vec3(2.3,2.9,2.1) + wph*6.283) * WLEAF;
    #endif
    vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
    float wsc = length(instanceMatrix[1].xyz);
    mvPosition.xz += windAt(mvPosition.xz, clamp(transformed.y / WH, 0.0, 1.0), WAMP*wsc, WFLUT*wsc, wph);
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;`;
  const vRep = [['#include <project_vertex>', proj]];
  if (upNormal) vRep.push(['#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);']);
  patch(mat, key, { defs, vRep, fRep: upNormal ? [['#include <normal_fragment_begin>', UP_NORMAL_FRAG]] : [] });
  return mat;
}

// ---- ground material ------------------------------------------------------------------------------------
function groundMaterial(tex) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const uniforms = { tGrass: { value: tex.grass }, tDry: { value: tex.dry }, tDirt: { value: tex.dirt }, tMud: { value: tex.mud }, tNorm: { value: tex.norm }, tMask: { value: tex.mask }, tMacro: { value: tex.macro }, ...U };
  patch(mat, 'ground-splat', {
    uniforms,
    vHead: 'varying vec3 vWPos; varying float vSlope;',
    fHead: `varying vec3 vWPos; varying float vSlope; uniform sampler2D tGrass, tDry, tDirt, tMud, tNorm, tMask, tMacro;`,
    vRep: [['#include <begin_vertex>', `vec3 transformed = vec3(position);
      vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vSlope = 1.0 - normalize(mat3(modelMatrix) * normal).y;`]],
    fRep: [
      ['#include <map_fragment>', `
      vec2 gp = vWPos.xz;
      vec2 muv = (gp + uMapInfo.y) / uMapInfo.x;
      vec4 mk = texture2D(tMask, muv), mc = texture2D(tMacro, muv);
      vec3 macro = mc.rgb; float dryK = mc.a;
      vec3 tg = mix(texture2D(tGrass, gp/2.3).rgb, texture2D(tGrass, gp/9.7 + 0.31).rgb, 0.5);
      vec3 td = mix(texture2D(tDry, gp/2.6).rgb, texture2D(tDry, gp/11.3 + 0.17).rgb, 0.5);
      vec3 tr = mix(texture2D(tDirt, gp/3.1).rgb, texture2D(tDirt, gp/13.7 + 0.53).rgb, 0.4);
      vec3 tm = texture2D(tMud, gp/2.9).rgb;
      vec3 col = mix(tg * macro * 1.35, td * mix(macro, lin(vec3(0.86,0.72,0.40)), 0.45) * 1.3, smoothstep(0.4, 0.8, dryK));
      float vd = length(gp - uVill.xy);
      float trample = max(mk.g, (1.0 - smoothstep(28.0, uVill.z, vd)) * 0.5);
      float dirtN = mk.a;
      float dirtW = clamp(dirtN * 0.45 + smoothstep(0.18, 0.42, vSlope) * 0.85 + trample * 0.7, 0.0, 1.0);
      vec3 dirtCol = tr * lin(vec3(0.76, 0.65, 0.46)) * 1.3;
      col = mix(col, dirtCol, dirtW);
      float wet = smoothstep(0.58, 0.8, fbm2(gp*0.045 + vec2(5.0,60.0)));
      vec3 mudCol = tm * lin(vec3(0.64, 0.50, 0.36)) * 1.25;
      col = mix(col, mudCol, clamp(wet * 0.3 + mk.g * 0.35, 0.0, 1.0) * 0.7);
      float rs = roadSgn(gp), road = roadAmt(gp);
      float rut = exp(-pow((abs(rs) - 1.75) / 0.5, 2.0));
      float strip = exp(-pow(rs / 0.9, 2.0));
      vec3 roadCol = tr * lin(vec3(0.80, 0.68, 0.50)) * 1.35;
      roadCol = mix(roadCol, mudCol * 0.9, rut * 0.8 * (0.6 + 0.4 * vn(gp * 0.8)));
      roadCol = mix(roadCol, col, strip * 0.6 * smoothstep(0.45, 0.72, fbm2(gp * 0.5)));
      col = mix(col, dirtCol * 0.95, (1.0 - smoothstep(3.0, 8.5, abs(rs))) * 0.3 * smoothstep(0.35, 0.6, fbm2(gp * 0.2)));
      col = mix(col, roadCol, road);
      vec2 fl; float fld = fieldAmt(gp, fl);
      float fur = 0.5 + 0.5 * sin(fl.y * 2.6 + vn(gp * 0.4) * 0.8);
      vec3 fcol = mix(td * lin(vec3(0.82, 0.62, 0.26)) * 1.15, tr * lin(vec3(0.64, 0.44, 0.22)) * 1.1, 0.3 + 0.35 * fur);
      col = mix(col, fcol * (0.85 + 0.2 * fur), fld);
      col *= 1.0 - mk.b * 0.4;
      col = mix(col, dirtCol * 0.55, mk.b * 0.3);
      col *= 0.84 + 0.32 * fbm2(gp * 0.07 + 9.0);
      diffuseColor.rgb *= col;`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 nA = texture2D(tNorm, gp/1.9).xyz * 2.0 - 1.0, nB = texture2D(tNorm, gp/7.3 + 0.2).xyz * 2.0 - 1.0;
        float st = (0.5 + dirtW * 0.8 + road * 0.4) * (1.0 - fld * 0.5);
        vec3 dW = vec3((nA.x + nB.x * 0.7) * st, 0.0, (nA.y + nB.y * 0.7) * st);
        normal = normalize(normal + mat3(viewMatrix) * dW * 0.55); }`],
    ],
  });
  return mat;
}

// ---- baked control maps -----------------------------------------------------------------------------------
function bakeMaps(c, trees) {
  const { HALF, MAP, fbm } = c;
  // macro colour (rgb sRGB) + dryness (a) at 512
  const M1 = 512, d1 = new Uint8Array(M1 * M1 * 4);
  const cGreen = [0.52, 0.60, 0.24], cDeep = [0.34, 0.47, 0.17], cOlive = [0.66, 0.63, 0.28], cOchre = [0.82, 0.71, 0.38];
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  for (let j = 0; j < M1; j++) for (let i = 0; i < M1; i++) {
    const x = -HALF + (i + 0.5) / M1 * MAP, z = -HALF + (j + 0.5) / M1 * MAP;
    const n1 = fbm(x * 0.011 + 3.1, z * 0.011 + 7.7, 3), n2 = fbm(x * 0.0042 + 20, z * 0.0042 + 9, 3), n3 = fbm(x * 0.032 + 71, z * 0.032 + 5, 3);
    let col = mix3(cGreen, cDeep, sstep(0.46, 0.6, n2) * 0.85);
    col = mix3(col, cOlive, sstep(0.4, 0.6, n3) * 0.55);
    const dry = Math.min(1, Math.max(0, sstep(0.44, 0.62, n1) * 0.85 + (n3 - 0.5) * 0.5));
    col = mix3(col, cOchre, dry * 0.8);
    const k = (0.82 + 0.36 * sstep(0.3, 0.7, n3)) * 255, o = (j * M1 + i) * 4;
    d1[o] = Math.min(255, col[0] * k); d1[o + 1] = Math.min(255, col[1] * k); d1[o + 2] = Math.min(255, col[2] * k); d1[o + 3] = dry * 255;
  }
  const macro = new THREE.DataTexture(d1, M1, M1, THREE.RGBAFormat);
  macro.colorSpace = THREE.SRGBColorSpace; macro.minFilter = macro.magFilter = THREE.LinearFilter; macro.wrapS = macro.wrapT = THREE.ClampToEdgeWrapping; macro.needsUpdate = true;

  // control mask at 1024: R structure footprint, G trample, B woodland floor, A bare-patch noise
  const M2 = 1024, d2 = new Uint8Array(M2 * M2 * 4), tx = MAP / M2;
  for (let j = 0; j < M2; j++) for (let i = 0; i < M2; i++) {
    const x = -HALF + (i + 0.5) * tx, z = -HALF + (j + 0.5) * tx;
    d2[(j * M2 + i) * 4 + 3] = sstep(0.58, 0.72, fbm(x * 0.02 + 99, z * 0.02 + 40, 3)) * 255;
  }
  const paint = (x0, z0, x1, z1, fn) => {
    const i0 = Math.max(0, Math.floor((x0 + HALF) / tx)), i1 = Math.min(M2 - 1, Math.ceil((x1 + HALF) / tx));
    const j0 = Math.max(0, Math.floor((z0 + HALF) / tx)), j1 = Math.min(M2 - 1, Math.ceil((z1 + HALF) / tx));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn((j * M2 + i) * 4, -HALF + (i + 0.5) * tx, -HALF + (j + 0.5) * tx);
  };
  const rectDist = (x, z, cx, cz, hw, hd, yaw) => {
    const dx = x - cx, dz = z - cz, s = Math.sin(yaw), cc = Math.cos(yaw), lx = dx * cc - dz * s, lz = dx * s + dz * cc;
    return Math.hypot(Math.max(Math.abs(lx) - hw, 0), Math.max(Math.abs(lz) - hd, 0));
  };
  const structure = (cx, cz, hw, hd, yaw) => {
    const R = Math.max(hw, hd) + 8;
    paint(cx - R, cz - R, cx + R, cz + R, (o, x, z) => {
      const d = rectDist(x, z, cx, cz, hw, hd, yaw);
      d2[o] = Math.max(d2[o], (1 - sstep(0.5, 2.4, d)) * 255);
      d2[o + 1] = Math.max(d2[o + 1], (1 - sstep(0.8, 6.5, d)) * 255 * 0.85);
    });
  };
  for (const h of c.houses) structure(h.x, h.z, h.w / 2 + 0.5, h.d / 2 + 0.5, h.yaw);
  structure(c.churchPos.x, c.churchPos.z, 6.2, 16.5, 0.12);
  for (const t of trees) {
    const R = (t.v >= 3 ? 3.6 : 5.2) * t.s;
    paint(t.x - R, t.z - R, t.x + R, t.z + R, (o, x, z) => { const d = Math.hypot(x - t.x, z - t.z); if (d < R) d2[o + 2] = Math.max(d2[o + 2], (1 - d / R) * 255 * 1.3); });
  }
  const mask = new THREE.DataTexture(d2, M2, M2, THREE.RGBAFormat);
  mask.minFilter = mask.magFilter = THREE.LinearFilter; mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping; mask.needsUpdate = true;
  return { macro, mask };
}

// ---- grass: GPU-placed instances on a world-anchored grid around the camera look-at point ---------------
function makeGrass(c, scene, tex, maps, heightTex, count) {
  const quads = [0, Math.PI / 3, -Math.PI / 3], pos = [], uvs = [], idx = [];
  quads.forEach((a, q) => {
    const ca = Math.cos(a), sa = Math.sin(a), b = q * 4;
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) { pos.push(x * ca, y, x * sa); uvs.push(x + 0.5, y); }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  const GW = Math.round(Math.sqrt(count));
  geo.instanceCount = GW * GW;
  const gu = { uGW: { value: GW }, uS: { value: 0.5 }, uR: { value: 60 }, uHS: { value: 1 }, uCenter: { value: new THREE.Vector2() }, tMask: { value: maps.mask }, tMacro: { value: maps.macro }, tHeight: { value: heightTex }, ...U };
  const mat = new THREE.MeshLambertMaterial({ map: tex.tuft, alphaTest: 0.45, side: THREE.DoubleSide });
  patch(mat, 'grass', {
    uniforms: gu,
    vHead: `varying vec3 vTint; uniform float uGW, uS, uR, uHS; uniform vec2 uCenter; uniform sampler2D tMask, tMacro, tHeight;
      float hAt(vec2 p){ vec2 g = clamp((p + uMapInfo.y) / uMapInfo.z, 0.0, uMapInfo.w - 0.001); return texture2D(tHeight, (g + 0.5) / (uMapInfo.w + 1.0)).r; }`,
    fHead: 'varying vec3 vTint;',
    vRep: [
      ['#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);'],
      ['#include <begin_vertex>', `vec3 transformed = vec3(0.0);
      {
        float gid = float(gl_InstanceID);
        float gx = mod(gid, uGW), gz = floor(gid / uGW);
        vec2 ci = floor(uCenter / uS) + vec2(gx, gz) - uGW * 0.5;
        vec2 r1 = vec2(h21(ci + vec2(0.37, 1.71)), h21(ci * 1.31 + vec2(7.3, 2.9)));
        float r2 = h21(ci * 0.77 + vec2(31.7, 5.3)), r3 = h21(ci * 1.93 + vec2(11.9, 13.1));
        vec2 wp = (ci + 0.1 + 0.8 * r1) * uS;
        float fade = 1.0 - smoothstep(uR * 0.6, uR, length(wp - uCenter));
        vec2 muv = (wp + uMapInfo.y) / uMapInfo.x;
        vec4 mk = texture2D(tMask, muv), mc = texture2D(tMacro, muv);
        vec2 fl; float road = roadAmt(wp), fld = fieldAmt(wp, fl);
        float h0 = hAt(wp), hx = hAt(wp + vec2(1.5, 0.0)), hz = hAt(wp + vec2(0.0, 1.5));
        float slope = length(vec2(hx - h0, hz - h0)) / 1.5;
        float dens = (1.0 - smoothstep(0.1, 0.45, road)) * (1.0 - smoothstep(0.05, 0.3, fld)) * (1.0 - smoothstep(0.1, 0.5, mk.r))
                   * (1.0 - mk.g * 0.65) * (1.0 - mk.b * 0.8) * (1.0 - mk.a * 0.85) * (1.0 - smoothstep(0.3, 0.6, slope));
        float ok = step(r2, dens) * step(0.03, fade);
        float gh = uHS * (0.34 + 0.5 * r3) * (1.0 - 0.25 * mc.a) * (0.4 + 0.6 * fade) * ok;
        float gw = uS * 2.2 * ok;
        float ang = r3 * 6.2831 + r1.x * 3.0, ca = cos(ang), sa = sin(ang);
        vec2 q = vec2(position.x * ca - position.z * sa, position.x * sa + position.z * ca) * gw;
        vec2 wind = windAt(wp, position.y, 0.5 * gh, 0.06 * gh, r3);
        transformed = vec3(wp.x + q.x + wind.x, h0 - 0.06 + position.y * gh, wp.y + q.y + wind.y);
        vTint = mc.rgb * (0.82 + 0.4 * r3) * mix(0.55, 1.2, position.y);
      }`],
    ],
    fRep: [
      ['#include <normal_fragment_begin>', UP_NORMAL_FRAG],
      ['#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= vTint * 1.9;'],
    ],
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  const dir = new THREE.Vector3();
  mesh.onBeforeRender = (r, s, cam) => {   // look-at point on the ground, radius grows with camera height
    cam.getWorldDirection(dir);
    const cp = cam.position; let t = 100;
    if (dir.y < -0.05) { t = (cp.y - c.heightAt(cp.x, cp.z)) / -dir.y; for (let i = 0; i < 3; i++) t = (cp.y - c.heightAt(cp.x + dir.x * t, cp.z + dir.z * t)) / -dir.y; }
    t = Math.min(Math.max(t, 5), 450);
    const cx = cp.x + dir.x * t, cz = cp.z + dir.z * t, H = Math.max(2, cp.y - c.heightAt(cx, cz));
    const R = Math.round(Math.min(150, Math.max(55, 40 + H * 0.5)) / 10) * 10, S = (2 * R) / GW;
    gu.uCenter.value.set(cx, cz); gu.uR.value = R; gu.uS.value = S; gu.uHS.value = Math.min(2.4, Math.max(1, S / 0.42));
  };
  scene.add(mesh);
  return { mesh, instances: GW * GW };
}

// ---- main entry -------------------------------------------------------------------------------------------
export function stoneMaterial() {
  const m = new THREE.MeshLambertMaterial({ map: stoneTex(256, 3, 3), color: 0xffffff });
  const vRep = [['#include <uv_vertex>', `#include <uv_vertex>
    #ifdef USE_MAP
    vMapUv += vec2(h21(instanceMatrix[3].xz * 0.37), h21(instanceMatrix[3].zx * 0.53 + 3.1));
    #endif`]];
  patch(m, 'stone-wall', { vRep });
  return m;
}
export { stoneGeometry };

export function createFoliage(c) {
  const { scene, heightAt, HALF, MAP, FIELD, VILLAGE, N, CELL, heights } = c;
  const stats = {};
  const rng = mulberry32(9091), dummy = new THREE.Object3D(), colr = new THREE.Color();
  const lodList = [];

  // ---- placement
  const trees = [];   // v: 0 oak, 1 elm, 2 birch/autumn, 3 spruce, 4 fir
  const pushTree = (x, z, s, cone) => {
    const v = cone ? 3 + (rng() < 0.4 ? 1 : 0) : (() => { const q = rng(); return q < 0.5 ? 0 : q < 0.8 ? 1 : 2; })();
    trees.push({ x, z, s, v, sd: Math.floor(rng() * 2) });
  };
  const CELLT = 6.2;
  for (let z = -HALF + 24; z < HALF - 24; z += CELLT) for (let x = -HALF + 24; x < HALF - 24; x += CELLT) {
    const tx = x + (rng() - 0.5) * CELLT * 1.2, tz = z + (rng() - 0.5) * CELLT * 1.2;
    const f = c.fbm(tx * 0.009 + 55, tz * 0.009 + 12, 3);
    const p = sstep(0.55, 0.66, f) * 0.8 + (f < 0.55 ? 0.01 : 0);
    if (rng() > p || !c.treeOk(tx, tz)) continue;
    pushTree(tx, tz, 0.78 + rng() * 0.62, rng() < (f > 0.62 ? 0.5 : 0.2));
  }
  for (let k = 0, made = 0; k < 600 && made < 46; k++) {   // copses
    const cx = (rng() - 0.5) * (MAP - 80), cz = (rng() - 0.5) * (MAP - 80);
    if (!c.treeOk(cx, cz)) continue;
    made++;
    const n = 9 + Math.floor(rng() * 20), mix = rng() < 0.3, rad = 7 + rng() * 9, coneP = mix ? 0.55 : 0.1;
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * rad, x = cx + Math.cos(a) * d * 1.4, z = cz + Math.sin(a) * d;
      if (c.treeOk(x, z)) pushTree(x, z, 0.72 + rng() * 0.7, rng() < coneP);
    }
  }
  // hedgerows: bush runs with the odd tree
  const hedgeLines = [[[-250, -50], [-120, -30], [-60, -45]], [[120, 70], [120, 200]], [[140, -130], [290, -130]], [[-200, 100], [-60, 110], [40, 100]],
    [[350, -20], [350, 150], [420, 170]], [[-420, -100], [-420, 100]], [[-30, 70], [-30, 200]], [[200, 80], [330, 90]], [[-360, 40], [-290, 140]], [[260, -250], [400, -240], [430, -180]]];
  const hedges = [];
  for (const line of hedgeLines) for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.floor(len / 1.7);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = lerp(a[0], b[0], t) + Math.sin(k * 0.4 + i) * 1.1 + (rng() - 0.5) * 0.8, z = lerp(a[1], b[1], t) + Math.cos(k * 0.37) * 1.1 + (rng() - 0.5) * 0.8;
      if (!c.treeOk(x, z)) continue;
      hedges.push({ x, z, s: 0.9 + rng() * 0.8, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), c: rng() });
      if (rng() < 0.07) pushTree(x + (rng() - 0.5) * 1.5, z + (rng() - 0.5) * 1.5, 0.7 + rng() * 0.4, false);
    }
  }
  const bushes = [], rocks = [];
  for (let a = 0; a < 9000 && bushes.length < 900; a++) {
    const cx = (rng() - 0.5) * (MAP - 60), cz = (rng() - 0.5) * (MAP - 60);
    const f = c.fbm(cx * 0.009 + 55, cz * 0.009 + 12, 3);
    if (Math.abs(cx - c.roadX(cz)) < 8 || c.inField(cx, cz).inside || Math.hypot(cx - VILLAGE.x, cz - VILLAGE.z) < 40 || rng() > 0.2 + sstep(0.48, 0.62, f) * 0.5) continue;
    for (let i = 0, n = 1 + Math.floor(rng() * 4); i < n; i++) bushes.push({ x: cx + (rng() - 0.5) * 5, z: cz + (rng() - 0.5) * 5, s: 0.7 + rng() * 0.9, c: rng() });
  }
  for (let a = 0; a < 6000 && rocks.length < 420; a++) {
    const x = (rng() - 0.5) * (MAP - 60), z = (rng() - 0.5) * (MAP - 60);
    if (Math.abs(x - c.roadX(z)) < 7 || c.inField(x, z).inside || rng() > 0.1 + 2.5 * Math.hypot(heightAt(x + 3, z) - heightAt(x - 3, z), heightAt(x, z + 3) - heightAt(x, z - 3))) continue;
    rocks.push({ x, z, s: 0.5 + rng() * rng() * 2.4 });
  }

  // ---- textures, baked maps, ground material
  const tex = { grass: groundGrassTex(), dry: groundDryTex(), dirt: groundDirtTex(), mud: groundMudTex(), norm: groundNormalTex(), tuft: grassTuftTex() };
  U.uField.value.set(FIELD.x, FIELD.z, FIELD.w / 2, FIELD.d / 2); U.uFieldRot.value.set(Math.cos(FIELD.rot), Math.sin(FIELD.rot));
  U.uVill.value.set(VILLAGE.x, VILLAGE.z, VILLAGE.r); U.uMapInfo.value.set(MAP, HALF, CELL, N);
  const maps = bakeMaps(c, trees);
  tex.mask = maps.mask; tex.macro = maps.macro;
  const groundMat = groundMaterial(tex);
  const hd = new Uint16Array(heights.length); for (let i = 0; i < hd.length; i++) hd[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const heightTex = new THREE.DataTexture(hd, N + 1, N + 1, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter; heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping; heightTex.needsUpdate = true;

  // ---- grass
  const grass = makeGrass(c, scene, tex, maps, heightTex, c.grassCount || 65536);
  stats.grass = grass.instances;

  // ---- chunked instanced groups
  const CH = 120, key = (o) => Math.floor((o.x + HALF) / CH) * 100 + Math.floor((o.z + HALF) / CH);
  const groupBy = (list, extra) => { const m = new Map(); for (const o of list) { const k = key(o) + ':' + (extra ? extra(o) : ''); (m.get(k) || m.set(k, []).get(k)).push(o); } return m; };
  const finish = (mesh, items, lodDist, cast = true) => {
    mesh.count = items.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.castShadow = cast; mesh.receiveShadow = true; scene.add(mesh);
    if (lodDist) { const cx = items[0].x, cz = items[0].z; lodList.push({ mesh, cx, cz, d2: (lodDist + 170) * (lodDist + 170) }); }
  };

  // trees
  const leafT = leafTex(); leafT.repeat.set(4, 2.5);
  const needleT = needleTex(); needleT.repeat.set(1, 1);
  const barkT = barkTex();
  const crownMat = windMat(new THREE.MeshLambertMaterial({ map: leafT, alphaTest: 0.5, vertexColors: true }), 'crown', { href: 10, amp: 0.34, flut: 0.05, leaf: 0.07 });
  const trunkMat = windMat(new THREE.MeshLambertMaterial({ map: barkT }), 'trunk', { href: 10, amp: 0.34, flut: 0.02 });
  const coneMat = windMat(new THREE.MeshLambertMaterial({ map: needleT, vertexColors: true }), 'cone', { href: 12, amp: 0.2, flut: 0.03, leaf: 0.03 });
  const crowns = [[oakCrown(11), oakCrown(12)], [elmCrown(21), elmCrown(22)], [birchCrown(31), birchCrown(32)]];
  const trunks = [trunkGeo('oak', 1), trunkGeo('elm', 2), trunkGeo('birch', 3)];
  const conGeos = [[conifer(7, 0.7, 1.35, 2.7, 41, false), conifer(7, 0.6, 1.4, 2.5, 42, false)], [conifer(5, 0.9, 1.6, 3.0, 43, true), conifer(5, 0.9, 1.5, 3.2, 44, true)]];
  const greens = [[0x5a7c30, 0x6f8e34, 0x4a6c2c, 0x78903a, 0x66863a], [0x6a8a34, 0x879a3a, 0x5a7c30, 0x78903a], [0x8a9a3a, 0xa09a3c, 0xb08a34, 0x7a9438, 0xc09034]];
  const autumn = [0xb08a34, 0xa5682c, 0xc09a38, 0x8e5a28];
  const firs = [0x2f4e2c, 0x3a5a30, 0x2a4a36, 0x44602f, 0x35552c];
  const barkCols = [0x6b5440, 0x5e4a38, 0x75604a], birchCol = 0xd6d2c2;
  let nTrunk = 0, nCrown = 0, nCone = 0;
  const tG = groupBy(trees, (t) => t.v + '' + t.sd);
  for (const items of tG.values()) {
    const t0 = items[0], v = t0.v, n = items.length;
    const place = (i, t) => {
      dummy.position.set(t.x, heightAt(t.x, t.z) - 0.2, t.z); dummy.rotation.set((rng() - 0.5) * 0.05, rng() * 6.28, (rng() - 0.5) * 0.05);
      const sy = t.s * (0.92 + rng() * 0.18); dummy.scale.set(t.s * (0.92 + rng() * 0.16), sy, t.s * (0.92 + rng() * 0.16)); dummy.updateMatrix();
    };
    if (v < 3) {
      const crown = new THREE.InstancedMesh(crowns[v][t0.sd], crownMat, n), trunk = new THREE.InstancedMesh(trunks[v], trunkMat, n);
      items.forEach((t, i) => {
        place(i, t); crown.setMatrixAt(i, dummy.matrix); trunk.setMatrixAt(i, dummy.matrix);
        const pal = rng() < 0.12 ? autumn : greens[v], tint = colr.set(pal[Math.floor(rng() * pal.length)]).multiplyScalar(1.15 + rng() * 0.35);
        crown.setColorAt(i, tint);
        trunk.setColorAt(i, colr.set(v === 2 ? birchCol : barkCols[Math.floor(rng() * barkCols.length)]).multiplyScalar(0.85 + rng() * 0.3));
      });
      finish(crown, items, 0); finish(trunk, items, 700, false); nCrown += n; nTrunk += n;
    } else {
      const cone = new THREE.InstancedMesh(conGeos[v - 3][t0.sd], coneMat, n);
      items.forEach((t, i) => { place(i, t); dummy.scale.y *= 0.95 + rng() * 0.3; dummy.updateMatrix(); cone.setMatrixAt(i, dummy.matrix); cone.setColorAt(i, colr.set(firs[Math.floor(rng() * firs.length)]).multiplyScalar(1.15 + rng() * 0.35)); });
      finish(cone, items, 0); nCone += n;
    }
  }
  stats.trees = trees.length; stats.deciduous = nCrown; stats.conifers = nCone;

  // bushes + hedgerow segments (shared lumpy blob pair), rocks
  {
    const bushA = newA(); addBlob(bushA, 0, 0.55, 0, 1.15, 0.85, 1.05, 3, { lump: 0.25, lo: 0.5, hi: 1.15, center: [0, 0.4, 0] }); addBlob(bushA, 0.6, 0.45, -0.4, 0.8, 0.65, 0.8, 8, { lump: 0.25, lo: 0.5, hi: 1.1, center: [0, 0.4, 0] });
    const hedgeA = newA(); addBlob(hedgeA, 0, 0.9, 0, 1.5, 1.05, 1.1, 5, { lump: 0.22, lo: 0.45, hi: 1.15, center: [0, 0.7, 0] }); addBlob(hedgeA, 1.0, 0.8, 0.1, 1.2, 0.9, 1.0, 6, { lump: 0.22, lo: 0.5, hi: 1.1, center: [0, 0.7, 0] });
    const bushMat = windMat(new THREE.MeshLambertMaterial({ map: leafT, alphaTest: 0.5, vertexColors: true }), 'bush', { href: 2, amp: 0.06, flut: 0.02, leaf: 0.04 });
    const bcols = [0x56742c, 0x6c8434, 0x7f8f38, 0x4c6a30, 0x8a8a3a, 0x9a8a30], bushG = toGeo(bushA), hedgeG = toGeo(hedgeA);
    for (const items of groupBy(bushes).values()) {
      const m = new THREE.InstancedMesh(bushG, bushMat, items.length);
      items.forEach((b, i) => { dummy.position.set(b.x, heightAt(b.x, b.z) - 0.1, b.z); dummy.rotation.set(0, rng() * 6, 0); dummy.scale.set(b.s, b.s * 0.85, b.s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, colr.set(bcols[Math.floor(rng() * bcols.length)]).multiplyScalar(0.85 + rng() * 0.3)); });
      finish(m, items, 420);
    }
    for (const items of groupBy(hedges).values()) {
      const m = new THREE.InstancedMesh(hedgeG, bushMat, items.length);
      items.forEach((b, i) => { dummy.position.set(b.x, heightAt(b.x, b.z) - 0.1, b.z); dummy.rotation.set(0, b.yaw + (rng() - 0.5) * 0.5, 0); dummy.scale.set(b.s, b.s * (0.9 + rng() * 0.3), b.s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, colr.set(bcols[Math.floor(b.c * 4.99)]).multiplyScalar(0.85 + rng() * 0.25)); });
      finish(m, items, 520);
    }
    const rockMat = new THREE.MeshLambertMaterial({ map: stoneTex(256, 3, 9) }), rg = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
    for (const items of groupBy(rocks, (r) => Math.floor(r.s * 997) % 3).values()) {
      const m = new THREE.InstancedMesh(rg[Math.floor(items[0].s * 997) % 3], rockMat, items.length);
      items.forEach((r, i) => { dummy.position.set(r.x, heightAt(r.x, r.z) + 0.1 * r.s, r.z); dummy.rotation.set((rng() - 0.5) * 0.4, rng() * 6, (rng() - 0.5) * 0.4); dummy.scale.set(r.s, r.s * (0.55 + rng() * 0.4), r.s * (0.8 + rng() * 0.4)); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); const v = 0.7 + rng() * 0.45; m.setColorAt(i, colr.setRGB(v * 1.02, v * 0.97, v * 0.9)); });
      finish(m, items, 450);
    }
    stats.bushes = bushes.length; stats.hedge = hedges.length; stats.rocks = rocks.length;
  }

  // ---- wheat
  {
    const parts = [0, Math.PI / 3, -Math.PI / 3].map((rot) => { const g = new THREE.PlaneGeometry(1.9, 1.35, 1, 2); g.translate(0, 0.62, 0); g.rotateY(rot); return g; });
    let np = 0; for (const g of parts) np += g.attributes.position.count;
    const pa = new Float32Array(np * 3), ua = new Float32Array(np * 2), na = new Float32Array(np * 3), ix = []; let off = 0;
    for (const g of parts) { pa.set(g.attributes.position.array, off * 3); ua.set(g.attributes.uv.array, off * 2); na.set(g.attributes.normal.array, off * 3); for (const k of g.index.array) ix.push(k + off); off += g.attributes.position.count; }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(pa, 3)); wg.setAttribute('uv', new THREE.BufferAttribute(ua, 2)); wg.setAttribute('normal', new THREE.BufferAttribute(na, 3)); wg.setIndex(ix);
    const SP = 0.7, rowsN = Math.floor(FIELD.d / SP), perRow = Math.floor(FIELD.w / SP);
    const wmat = windMat(new THREE.MeshLambertMaterial({ map: wheatTex(), alphaTest: 0.5, side: THREE.DoubleSide }), 'wheat', { href: 1.4, amp: 0.3, flut: 0.07, upNormal: true });
    const wheat = new THREE.InstancedMesh(wg, wmat, rowsN * perRow), fc = Math.cos(FIELD.rot), fs = Math.sin(FIELD.rot); let wi = 0;
    for (let r = 0; r < rowsN; r++) for (let p = 0; p < perRow; p++) {
      const lx = -FIELD.w / 2 + (p + 0.5) * SP + (rng() - 0.5) * 0.5, lz = -FIELD.d / 2 + (r + 0.5) * SP + (rng() - 0.5) * 0.4;
      const x = FIELD.x + lx * fc - lz * fs, z = FIELD.z + lx * fs + lz * fc;
      dummy.position.set(x, heightAt(x, z) - 0.05, z); dummy.rotation.set((rng() - 0.5) * 0.12, rng() * 6, (rng() - 0.5) * 0.12);
      dummy.scale.set(0.9 + rng() * 0.3, 0.8 + rng() * 0.45, 0.9 + rng() * 0.3); dummy.updateMatrix();
      wheat.setMatrixAt(wi, dummy.matrix); wheat.setColorAt(wi++, colr.set(0xdcc666).multiplyScalar(0.8 + rng() * 0.35 + 0.1 * Math.sin(lz * 0.8)));
    }
    wheat.count = wi; wheat.instanceMatrix.needsUpdate = true; wheat.instanceColor.needsUpdate = true; wheat.computeBoundingSphere(); wheat.receiveShadow = true; scene.add(wheat);
    stats.wheat = wi;
  }

  const cp = new THREE.Vector3();
  function update(cam) {   // per-frame: wind clock + distance culling of small stuff
    windTime.value = (performance.now() / 1000) % 600;
    cam.getWorldPosition(cp);
    for (const e of lodList) { const dx = cp.x - e.cx, dz = cp.z - e.cz; e.mesh.visible = dx * dx + dz * dz < e.d2; }
  }
  return { groundMaterial: groundMat, update, stats };
}
