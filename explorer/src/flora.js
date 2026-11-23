// Procedural alien flora geometry: real silhouettes built from tapered tubes, arching leaf ribbons and lathe profiles.
// Every builder returns a BufferGeometry with position / normal / color (vertex colour) / sway (wind weight 0..1 base->tip).
// Species ids match terrain/verdant.js plantsInCell: 0 spire tree, 1 canopy tree, 2 bulb tree, 3 giant umbrella fungus,
// 4 small fungus cluster, 5 shrub, 6 fern, 7 grass tuft, 8 spore pod.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const rnd = (() => { let s = 12345; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return ((s >>> 8) & 0xffff) / 65536; }; })();

class GB {
  constructor() { this.pos = []; this.col = []; this.sw = []; this.idx = []; this.n = 0; }
  v(x, y, z, c, s) { this.pos.push(x, y, z); this.col.push(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)); this.sw.push(s); return this.n++; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, c, b, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sw, 1));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** arching leaf blade: centreline from p (unit dir d), drooping, with width profile fn(t) and colour ramp */
function blade(gb, p, d, len, w0, droop, segs, c0, c1, s0, s1, wfn) {
  const up = new V3(0, 1, 0);
  const side = new V3().crossVectors(d, up); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
  let prev = null;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const cx = p.x + d.x * len * t, cy = p.y + d.y * len * t - droop * len * t * t, cz = p.z + d.z * len * t;
    const w = w0 * (wfn ? wfn(t) : (1 - t * 0.85)) * 0.5;
    const col = mixc(c0, c1, Math.pow(t, 0.8));
    const sw = s0 + (s1 - s0) * t;
    const a = gb.v(cx - side.x * w, cy, cz - side.z * w, col, sw), m = gb.v(cx, cy + w * 0.35, cz, scale3(col, 1.12), sw), b = gb.v(cx + side.x * w, cy, cz + side.z * w, col, sw);
    if (prev) { gb.quad(prev[0], prev[1], a, m); gb.quad(prev[1], prev[2], m, b); }
    prev = [a, m, b];
  }
}
/** tapered tube along points with radii; colour bottom->top */
function tube(gb, pts, radii, radial, cb, ct, s0, s1) {
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const tg = i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1]); tg.normalize();
    const a = Math.abs(tg.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
    const u = new V3().crossVectors(tg, a).normalize(), w = new V3().crossVectors(tg, u).normalize();
    const ring = [];
    for (let k = 0; k < radial; k++) {
      const ang = k / radial * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const rr = radii[i] * (1 + 0.08 * Math.sin(ang * 3 + i));
      ring.push(gb.v(pts[i].x + (u.x * cs + w.x * sn) * rr, pts[i].y + (u.y * cs + w.y * sn) * rr, pts[i].z + (u.z * cs + w.z * sn) * rr, mixc(cb, ct, t), s0 + (s1 - s0) * t));
    }
    if (prev) for (let k = 0; k < radial; k++) { const k2 = (k + 1) % radial; gb.quad(prev[k], prev[k2], ring[k], ring[k2]); }
    prev = ring;
  }
}
function blob(gb, c, rx, ry, rz, seg, col, sw, shade = 0.35) {
  const rings = Math.max(3, seg >> 1), base = gb.n;
  for (let j = 0; j <= rings; j++) {
    const th = j / rings * Math.PI, y = Math.cos(th), r = Math.sin(th);
    for (let i = 0; i <= seg; i++) { const ph = i / seg * Math.PI * 2; gb.v(c.x + Math.cos(ph) * r * rx, c.y + y * ry, c.z + Math.sin(ph) * r * rz, scale3(col, 1 + shade * y), sw); }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = base + j * (seg + 1) + i; gb.quad(a, a + 1, a + seg + 1, a + seg + 2); }
}
/** lathe from profile [[r, y], ...] (bottom -> top) with colour function (t, angle) */
function lathe(gb, prof, seg, colf, swf, cx = 0, cz = 0, k = 1) {
  const base = gb.n;
  for (let j = 0; j < prof.length; j++) for (let i = 0; i <= seg; i++) {
    const ang = i / seg * Math.PI * 2, [r, y] = prof[j];
    gb.v(cx + Math.cos(ang) * r * k, y * k, cz + Math.sin(ang) * r * k, colf(j / (prof.length - 1), ang, j), swf ? swf(j / (prof.length - 1)) : 0);
  }
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < seg; i++) { const a = base + j * (seg + 1) + i; gb.quad(a, a + 1, a + seg + 1, a + seg + 2); }
}

const GREEN_D = [0.04, 0.2, 0.06], GREEN_M = [0.1, 0.34, 0.08], GREEN_L = [0.34, 0.56, 0.1], TEAL_D = [0.03, 0.2, 0.17], TEAL_L = [0.2, 0.52, 0.34];
const BARK_D = [0.14, 0.1, 0.07], BARK_L = [0.3, 0.24, 0.17], GOLD = [0.7, 0.58, 0.14], MAG = [0.55, 0.06, 0.38], ORANGE = [0.72, 0.28, 0.07];

function radial(n, fn) { for (let i = 0; i < n; i++) fn(i / n * Math.PI * 2, i); }
const dir = (ang, up) => new V3(Math.cos(ang) * Math.sqrt(1 - up * up), up, Math.sin(ang) * Math.sqrt(1 - up * up));

// ------------------------------------------------------------------ species
/** 0: lance-palm — slender curved trunk (11 m) with a crown of arching fronds */
export function spireTree(lod) {
  const gb = new GB(); const H = 11;
  const np = lod === 0 ? 8 : 3, pts = [], rad = [];
  for (let i = 0; i < np; i++) { const t = i / (np - 1); pts.push(new V3(Math.sin(t * 2.1) * 0.5 * t, H * t, Math.cos(t * 1.7) * 0.35 * t)); rad.push(0.42 * (1 - t) + 0.13); }
  tube(gb, pts, rad, lod === 0 ? 7 : 4, BARK_D, BARK_L, 0.0, 0.25);
  const top = pts[np - 1];
  const nf = lod === 0 ? 10 : 6, segs = lod === 0 ? 6 : 3;
  radial(nf, (a, i) => blade(gb, top, dir(a, 0.5 + 0.2 * Math.sin(i * 2.3)), 6.2 + 1.2 * Math.sin(i * 1.7), 1.15, 0.95, segs, GREEN_D, mixc(GREEN_L, GOLD, i % 3 === 0 ? 0.6 : 0.15), 0.35, 1.0, (t) => Math.sin(Math.PI * Math.pow(t, 0.7)) * 0.9 + 0.1));
  if (lod === 0) {
    radial(6, (a, i) => blade(gb, top, dir(a + 0.4, 0.88), 3.2, 0.7, 0.35, 4, GREEN_M, GREEN_L, 0.3, 0.9));
    radial(4, (a) => blob(gb, new V3(top.x + Math.cos(a) * 1.0, top.y - 0.9, top.z + Math.sin(a) * 1.0), 0.28, 0.4, 0.28, 8, MAG, 0.6));
  }
  return gb.build();
}
/** 1: veil-umbrella tree — shorter trunk, wide drooping canopy of long fronds and hanging tendrils */
export function canopyTree(lod) {
  const gb = new GB(); const H = 7.5;
  const np = lod === 0 ? 6 : 3, pts = [], rad = [];
  for (let i = 0; i < np; i++) { const t = i / (np - 1); pts.push(new V3(Math.sin(t * 3) * 0.45 * t, H * t, Math.sin(t * 2.2 + 1) * 0.4 * t)); rad.push(0.62 * Math.pow(1 - t, 0.8) + 0.2); }
  tube(gb, pts, rad, lod === 0 ? 8 : 4, BARK_D, BARK_L, 0.0, 0.2);
  const top = pts[np - 1];
  const nf = lod === 0 ? 16 : 8, segs = lod === 0 ? 6 : 3;
  radial(nf, (a, i) => blade(gb, top, dir(a, 0.18 + 0.12 * (i % 2)), 7.2 + 1.5 * Math.sin(i * 2.1), 1.6, 2.4, segs, TEAL_D, mixc(TEAL_L, [0.45, 0.62, 0.3], 0.4), 0.3, 1.0, (t) => 0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.15))));
  if (lod === 0) radial(14, (a, i) => { const r = 3.0 + 3.2 * ((i * 0.37) % 1); const p = new V3(top.x + Math.cos(a) * r, top.y + 0.6 - r * 0.28, top.z + Math.sin(a) * r); blade(gb, p, new V3(0, -1, 0), 2.6 + 1.4 * ((i * 0.53) % 1), 0.14, 0.0, 3, [0.35, 0.5, 0.2], [0.8, 0.45, 0.8], 0.7, 1.0, () => 1); });
  return gb.build();
}
/** 2: bulb tree — squat swollen trunk, three branches ending in large fruit bulbs, a fan of thin blades */
export function bulbTree(lod) {
  const gb = new GB();
  const seg = lod === 0 ? 10 : 6;
  lathe(gb, [[0.0, 0], [0.9, 0.05], [1.0, 0.8], [0.75, 1.9], [0.5, 3.0], [0.34, 4.1], [0.26, 4.6]], seg, (t) => mixc(BARK_D, BARK_L, t), (t) => t * 0.2);
  const top = new V3(0, 4.5, 0);
  radial(3, (a, i) => {
    const d = dir(a + i, 0.55), end = new V3(top.x + d.x * 2.6, top.y + d.y * 2.6, top.z + d.z * 2.6);
    tube(gb, [top, new V3((top.x + end.x) / 2 + 0.2, (top.y + end.y) / 2 + 0.4, (top.z + end.z) / 2), end], [0.2, 0.15, 0.1], 5, BARK_L, BARK_L, 0.2, 0.5);
    blob(gb, new V3(end.x, end.y + 0.7, end.z), 1.15, 1.35, 1.15, seg + 2, mixc(ORANGE, MAG, i / 3), 0.5, 0.45);
  });
  radial(lod === 0 ? 9 : 5, (a, i) => blade(gb, top, dir(a, 0.8), 3.0 + (i % 3) * 0.6, 0.35, 0.3, 4, GREEN_D, GREEN_L, 0.4, 1.0, (t) => 1 - t));
  return gb.build();
}
/** 3: giant umbrella fungus, unit height 1 (cap radius ~0.52). part: 'body' (stem + cap, vertex colours) or 'gills' (emissive underside) */
export function fungus(lod, part) {
  const gb = new GB(); const seg = lod === 0 ? 28 : 10;
  if (part === 'gills') {
    const rows = lod === 0 ? 5 : 2, fins = lod === 0 ? 56 : 18;
    for (let f = 0; f < fins; f++) {
      const a = f / fins * Math.PI * 2;
      let prev = null;
      for (let j = 0; j <= rows; j++) {
        const t = j / rows, r = 0.07 + 0.43 * t, y = 0.765 - 0.012 * t * t + (f % 2 ? 0 : 0.015);
        const hgt = 0.05 * (1 - t * 0.5) * (f % 2 ? 1 : 0.6);
        const c = mixc([1.0, 0.55, 0.85], [1.0, 0.85, 0.55], t);
        const aa = a + (f % 2) * 0.01;
        const p1 = gb.v(Math.cos(aa) * r, y, Math.sin(aa) * r, c, 0), p2 = gb.v(Math.cos(aa) * r, y - hgt, Math.sin(aa) * r, scale3(c, 0.6), 0);
        if (prev) { gb.quad(prev[0], prev[1], p1, p2); gb.quad(prev[1], prev[0], p2, p1); }
        prev = [p1, p2];
      }
    }
    return gb.build();
  }
  // stem with a skirt ring, then the cap dome
  const stem = [[0.075, 0], [0.10, 0.03], [0.062, 0.14], [0.05, 0.3], [0.05, 0.5], [0.07, 0.585], [0.115, 0.6], [0.06, 0.64], [0.05, 0.74]];
  lathe(gb, stem, lod === 0 ? 14 : 6, (t) => mixc([0.85, 0.78, 0.68], [0.98, 0.9, 0.82], t), (t) => 0);
  const cap = [[0.04, 0.76], [0.16, 0.766], [0.3, 0.775], [0.42, 0.79], [0.5, 0.815], [0.528, 0.845], [0.5, 0.9], [0.4, 0.955], [0.27, 0.985], [0.12, 1.0], [0.0, 1.004]];
  lathe(gb, cap, seg, (t, ang, j) => {
    const spot = lod === 0 ? (Math.sin(ang * 9 + j * 1.7) * Math.sin(ang * 5 - j * 2.3) > 0.55 && j > 4 ? 0.8 : 0) : 0;
    const base = mixc([0.3, 0.05, 0.28], [0.85, 0.12, 0.6], Math.min(1, t * 1.25));
    return mixc(base, [0.98, 0.78, 0.9], spot);
  }, null);
  return gb.build();
}
/** 4: small fungus cluster (unit scale ~1 m): 3-5 mini umbrellas of different heights */
export function fungusCluster(lod, part) {
  const gb = new GB(); const seg = lod === 0 ? 12 : 6;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = i * 2.4 + 0.5, d = 0.18 + 0.12 * i, h = 0.5 + 0.35 * ((i * 0.61) % 1), cx = Math.cos(a) * d, cz = Math.sin(a) * d, k = h;
    if (part === 'gills') {
      const fins = lod === 0 ? 16 : 8;
      for (let f = 0; f < fins; f++) { const aa = f / fins * Math.PI * 2; const p0 = gb.v(cx + Math.cos(aa) * 0.04 * k, 0.765 * k, cz + Math.sin(aa) * 0.04 * k, [1, 0.6, 0.9], 0), p1 = gb.v(cx + Math.cos(aa) * 0.46 * k, 0.76 * k, cz + Math.sin(aa) * 0.46 * k, [1, 0.8, 0.6], 0), p2 = gb.v(cx + Math.cos(aa + 0.18) * 0.46 * k, 0.76 * k, cz + Math.sin(aa + 0.18) * 0.46 * k, [1, 0.8, 0.6], 0); gb.tri(p0, p1, p2); gb.tri(p0, p2, p1); }
    } else {
      lathe(gb, [[0.075, 0], [0.05, 0.3], [0.05, 0.74]], 6, (t) => [0.9, 0.84, 0.74], null, cx, cz, k);
      lathe(gb, [[0.04, 0.76], [0.3, 0.775], [0.5, 0.82], [0.46, 0.9], [0.26, 0.98], [0.0, 1.0]], seg, (t) => mixc([0.5, 0.08, 0.4], [0.7, 0.2, 0.75], t), null, cx, cz, k);
    }
  }
  return gb.build();
}
/** 5: shrub — arching blades radiating from the root, a few berry blobs */
export function shrub(lod) {
  const gb = new GB(); const n = lod === 0 ? 14 : 7;
  radial(n, (a, i) => blade(gb, new V3(0, 0.05, 0), dir(a + i * 0.4, 0.55 + 0.3 * ((i * 0.37) % 1)), 1.5 + 0.7 * ((i * 0.61) % 1), 0.36, 0.7, lod === 0 ? 4 : 2, [0.06, 0.2, 0.08], mixc([0.3, 0.5, 0.12], i % 4 === 0 ? [0.8, 0.4, 0.15] : [0.5, 0.65, 0.2], 0.5), 0.2, 1.0));
  if (lod === 0) radial(4, (a) => blob(gb, new V3(Math.cos(a) * 0.5, 0.75, Math.sin(a) * 0.5), 0.09, 0.09, 0.09, 6, [0.75, 0.15, 0.5], 0.8));
  return gb.build();
}
/** 6: fern — feathery fronds (sawtooth width) */
export function fern(lod) {
  const gb = new GB(); const n = lod === 0 ? 12 : 6, segs = lod === 0 ? 12 : 4;
  radial(n, (a, i) => blade(gb, new V3(0, 0.03, 0), dir(a + i * 0.3, 0.62 + 0.25 * ((i * 0.43) % 1)), 1.5 + 0.5 * ((i * 0.7) % 1), 0.5, 0.9, segs, [0.05, 0.22, 0.09], [0.3, 0.55, 0.16], 0.2, 1.0,
    (t) => (1 - t) * (lod === 0 ? (0.62 + 0.38 * (((t * segs) % 1) < 0.5 ? 1 : 0.2)) : 1)));
  return gb.build();
}
/** 7: grass tuft */
export function grass(lod) {
  const gb = new GB(); const n = 8;
  radial(n, (a, i) => blade(gb, new V3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), dir(a + i * 1.7, 0.9 - 0.15 * ((i * 0.37) % 1)), 0.55 + 0.35 * ((i * 0.61) % 1), 0.4, 3, [0.08, 0.22, 0.05], [0.55, 0.62, 0.2], 0.2, 1.0, (t) => 1 - t * 0.9));
  return gb.build();
}
/** 8: spore pod — thin stalk with a glowing bulb (emissive material) */
export function sporePod(lod, part) {
  const gb = new GB();
  if (part === 'glow') { blob(gb, new V3(0, 0.75, 0), 0.26, 0.34, 0.26, lod === 0 ? 12 : 6, [0.5, 1.0, 0.85], 0, 0.3); blob(gb, new V3(0.18, 0.5, 0.05), 0.11, 0.14, 0.11, 8, [0.6, 1.0, 0.75], 0, 0.3); }
  else { tube(gb, [new V3(0, 0, 0), new V3(0.04, 0.3, 0), new V3(0, 0.55, 0.02)], [0.06, 0.04, 0.03], 5, [0.2, 0.3, 0.2], [0.3, 0.5, 0.3], 0.1, 0.5); radial(4, (a) => blade(gb, new V3(0, 0.05, 0), dir(a, 0.5), 0.55, 0.14, 0.3, 2, [0.1, 0.3, 0.12], [0.3, 0.55, 0.2], 0.2, 1.0)); }
  return gb.build();
}
