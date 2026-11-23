// Verdant Prime recipe: broad green valleys, towering mountains, lakes, a river that leaps off a mesa as the Singing Falls,
// a curated runway-flat meadow, biome fields (moisture / forest / fungus) used by terrain shading, vegetation and fauna.
// Pure functions of (x, z) shared by the terrain worker, physics, scatter, water, vegetation and ecology (one source of truth).
import { fbm2, simplex2, hash2, smoothstep, mix, clamp } from '../noise.js';

export const id = 'verdant';
export const POI_CELL = 3600;
export const LAKE = 30;                 // lake / sea level (m)
export const PAD_H = 168;               // plateau (runway meadow) elevation

// ---- visual / ecology data for this world (consumed by main.js, water.js, vegetation.js, ecology.js)
export const WORLD = {
  name: 'Verdant Prime', waterLevel: LAKE,
  palette: {
    grassA: [0.08, 0.31, 0.06], grassB: [0.25, 0.52, 0.11], dry: [0.40, 0.46, 0.17], mud: [0.20, 0.15, 0.10], sand: [0.60, 0.54, 0.38],
    rock: [0.13, 0.125, 0.12], rockLight: [0.30, 0.275, 0.245], moss: [0.18, 0.32, 0.09],
  },
  fog: { dist: 30000, fall: 5200, mistY: 58, mistDens: 1 / 3000, mistFall: 22, mistCol: [1.0, 0.84, 0.64] },
  water: { deep: [0.02, 0.16, 0.18], shallow: [0.10, 0.36, 0.30], foam: [0.95, 0.97, 0.95] },
  hemi: { sky: [0.42, 0.55, 0.78], ground: [0.22, 0.30, 0.12], intensity: 0.8 },
  sunScale: 0.85, exposure: 0.98,
  species: { total: 24 },
};

// ---- site frame: a = axis towards the gas giant / along the runway, b = perpendicular
export const SITE = { x: 3000000, z: 800000 };
const AX = { x: 0.985, z: 0.174 }, BX = { x: -0.174, z: 0.985 };
export const toSite = (a, b) => ({ x: SITE.x + AX.x * a + BX.x * b, z: SITE.z + AX.z * a + BX.z * b });
const fromSite = (x, z) => { const dx = x - SITE.x, dz = z - SITE.z; return { u: dx * AX.x + dz * AX.z, v: dx * BX.x + dz * BX.z }; };
export const RUNWAY = { u0: -1000, u1: 420, hw: 62, h: PAD_H, heading: Math.atan2(AX.x, -AX.z) };   // heading in the game's convention (0 = north / -z)

// ---- the headland: a broad plateau (runway meadow) ending in a cliff edge that overlooks the valley
const PLAT = PAD_H;
const edgeAt = (v) => 790 + 62 * fbm2(v / 420 + 5.5, 2.2, 3) + 14 * fbm2(v / 75, 8.3, 2) + 0 * v;     // cliff-edge u as a function of v (>= ~670)
const valleyMean = (u, v) => {
  const lm = 1 - smoothstep(520, 980, Math.abs(v + 220));                                     // ledges only near the river
  const l1 = 1235 + 55 * fbm2(v / 230 + 1.3, 3.3, 2), l2 = 1790 + 55 * fbm2(v / 230 + 6.1, 4.4, 2);
  return 62 - 0.0045 * Math.max(u - 800, 0) - lm * (10 * smoothstep(l1 - 7, l1 + 7, u) + 12 * smoothstep(l2 - 7, l2 + 7, u));
};

// ---- river: centreline polyline in site frame (ordered downstream): over the plateau, off the cliff as the Singing Falls, meandering to the hero lake
const RIVER = [[-3000, -560], [-2000, -400], [-1000, -270], [-250, -200], [300, -180], [640, -175], [1010, -210], [1280, -270], [1520, -340], [1840, -190], [2130, -250], [2430, -80], [2720, 40], [3000, 80]];
const RSEG = []; let RLEN = 0;
for (let i = 0; i < RIVER.length - 1; i++) { const [a, b] = RIVER[i], [c, d] = RIVER[i + 1]; const L = Math.hypot(c - a, d - b); RSEG.push({ a, b, dx: (c - a) / L, dz: (d - b) / L, L, s0: RLEN }); RLEN += L; }
const LAKEC = { u: 2900, v: 70 };
export const HERO_FALLS = { u: 790, v: -175 };
const U_MIN = -3400, U_MAX = 3600, V_MIN = -1500, V_MAX = 1200;
const inRiverBox = (u, v) => u > U_MIN && u < U_MAX && v > V_MIN && v < V_MAX;

function riverQuery(u, v, o) {
  o.tx = 1; o.tz = 0;
  let best = 1e9, bs = 0, bu = 0, bv = 0;
  for (let i = 0; i < RSEG.length; i++) {
    const g = RSEG[i];
    const px = u - g.a, pz = v - g.b;
    let t = px * g.dx + pz * g.dz; t = t < 0 ? 0 : t > g.L ? g.L : t;
    const cu = g.a + g.dx * t, cv = g.b + g.dz * t;
    const wob = 30 * fbm2(cu / 330 + 3.1, 0.7, 2) + 16 * fbm2(cu / 120 + 5.2, 1.9, 2);       // long drift + tighter meanders
    const d = Math.hypot(u - cu, v - (cv + wob));
    if (d < best) { best = d; bs = g.s0 + t; bu = cu; bv = cv + wob; o.tx = g.dx; o.tz = g.dz; }
  }
  o.s = bs; o.cu = bu; o.cv = bv;
  const fx = bu - edgeAt(bv);
  o.w = (8.5 + 5.5 * (bs / RLEN) + 1.6 * fbm2(bs / 150, 3.3, 2) + 8.5 * Math.exp(-(fx * fx) / (2 * 110 * 110))) * (1 + 0.32 * fbm2(bs / 210 + 2.2, 6.6, 2));      // wider pool above the falls; reaches widen and pinch
  o.d = best + (best < o.w * 3 ? 2.4 * fbm2(u / 19 + 1.1, v / 19 - 3.3, 2) + 0.9 * fbm2(u / 6.3, v / 6.3 + 4.0, 1) : 0);      // irregular shoreline
  return o;
}
const _rq = { d: 1e9, s: 0, cu: 0, cv: 0, w: 10 };
const _rq2 = { d: 1e9, s: 0, cu: 0, cv: 0, w: 10 };
const _rq3 = { d: 1e9, s: 0, cu: 0, cv: 0, w: 10 };

// ---- mountains: domain-warped ridged multifractal massifs (broad eroded ranges, sharp crests only on the upper octaves), sedimentary terraces.
// BAND = finest feature wavelength (m) the current terrain chunk can resolve; the chunk worker sets it from its grid step so distant ranges are
// band-limited instead of aliasing into needles. Physics / scatter run on the main thread with BAND = 0 (full detail).
let BAND = 0;
export function setBand(step) { BAND = step * 4.5; }
function massif(x, z) {
  const wx = x + 2400 * fbm2(x / 9000 + 3, z / 9000, 2) + 520 * fbm2(x / 2500 + 8, z / 2500 + 1, 2);
  const wz = z + 2400 * fbm2(x / 9000 + 9, z / 9000 + 4, 2) + 520 * fbm2(x / 2500 + 2, z / 2500 + 6, 2);
  let X = wx / 5600, Y = wz / 5600, a = 1, sum = 0, norm = 0, w = 1, wl = 5600;
  for (let o = 0; o < 6; o++) {
    const fade = BAND > 0 ? clamp((wl / BAND - 1) * 0.8, 0, 1) : 1;
    if (fade <= 0) break;
    const sn = simplex2(X, Y); let q = (1 - Math.sqrt(sn * sn + 0.022)) * 1.16; q = q > 0 ? q * q : 0;      // rounded crests (soft |n|)
    q *= w; w = clamp(q * 2.0, 0.15, 1);
    sum += a * q * fade; norm += a; a *= 0.46;
    const nx = (X * 0.8 - Y * 0.6) * 2.07 + 3.1, ny = (X * 0.6 + Y * 0.8) * 2.07 + 7.9; X = nx; Y = ny; wl /= 2.07;
  }
  const r = sum / norm;
  const pk = smoothstep(0.2, 0.85, fbm2(wx / 12000 + 11, wz / 12000, 2) * 0.5 + 0.5);
  let hh = Math.pow(r, 1.22) * (1500 + 1900 * pk) + fbm2(x / 120, z / 120, 2) * 9 * r * (BAND < 400 ? 1 : 0);
  const T = 64, t = hh / T, f = t - Math.floor(t);
  const ter = (Math.floor(t) + smoothstep(0.25, 0.75, f)) * T;
  return mix(hh, ter, 0.32 * smoothstep(160, 520, hh));
}
function mountains(x, z, u, v) {
  const dist = Math.hypot(u * 0.8, v);
  const gm = smoothstep(-0.05, 0.45, fbm2(x / 17000 + 7, z / 17000 - 3, 2) + 0.12) * smoothstep(6500, 12500, dist);
  let bm = 0;
  if (u > 4800 && u < 42000 && Math.abs(v) < 28000) bm = smoothstep(4800, 9500, u) * (1 - smoothstep(28000, 42000, u)) * (1 - smoothstep(10000, 26000, Math.abs(v)));
  const mask = Math.max(gm, bm);
  return mask > 0.002 ? mask * massif(x, z) : 0;
}

// ---- base height: plateau + valley + lake + mountains (everything except the river carve)
function baseHeight(x, z) {
  const { u, v } = fromSite(x, z);
  const hGen = 62 + 24 * fbm2(x / 7000 + 3, z / 7000 - 5, 3) - 58 * smoothstep(0.26, 0.48, fbm2(x / 5600 - 8, z / 5600 + 2, 2));
  const siteK = 1 - smoothstep(4200, 7600, Math.hypot(u, v * 0.8));
  let hv = hGen;
  if (siteK > 0) {
    const hs = valleyMean(u, v) + 9 * fbm2(x / 3200 + 1, z / 3200, 2) * (0.4 + 0.6 * smoothstep(300, 1500, u)) + 4 * fbm2(x / 520, z / 520, 3);
    hv = mix(hGen, hs, siteK);
    const dl = Math.hypot((u - LAKEC.u) * 0.9, v - LAKEC.v);                                   // the hero lake in the valley
    if (dl < 760) hv = mix(hv, 10 + 5 * fbm2(x / 120, z / 120, 2), 1 - smoothstep(330, 700, dl));
  }
  let h = hv + 2.0 * fbm2(x / 90, z / 90, 2);
  // headland plateau with its cliff edge
  if (u < 1300 && u > -6500 && Math.abs(v) < 2300) {
    const edge0 = edgeAt(v);
    let pu;
    if (u > edge0 - 40 && u < edge0 + 40) {
      // rugged scarp: buttresses and gullies in plan, stepped strata (kept smooth right at the river so the Singing Falls sheet hugs the rock)
      const q = riverQuery(edge0, v, _rq3);
      const rug = smoothstep(q.w * 1.7 + 30, q.w * 1.7 + 130, q.d);
      const edge = edge0 + rug * (9 * fbm2(v / 46 + 3.3, u / 38, 2) + 3.2 * fbm2(v / 14 + 1.9, u / 7 + 6.1, 2));      // ribs vary with depth into the face: blocky buttresses, not curtains
      const hw = 7 + 3 * rug;
      pu = 1 - smoothstep(edge - hw, edge + hw, u);
      const ts = pu * 7, tf = ts - Math.floor(ts);
      pu = mix(pu, (Math.floor(ts) + smoothstep(0.3, 0.7, tf)) / 7, 0.6 * rug);
    } else pu = u < edge0 ? 1 : 0;
    const pv = 1 - smoothstep(1500 + 160 * fbm2(u / 500 + 2, 5, 2), 1950 + 160 * fbm2(u / 500, 7, 2), Math.abs(v));
    const pb = 1 - smoothstep(-5200, -6300, u);
    const k = pu * pv * pb;
    if (k > 0) {
      const platH = PLAT + 9 * fbm2(x / 900 + 21, z / 900, 2) + 2.4 * fbm2(x / 140, z / 140, 2);
      h = mix(h, platH, k);
    }
  }
  // exactly flat runway strip blended into the plateau
  if (u > RUNWAY.u0 - 500 && u < RUNWAY.u1 + 500 && Math.abs(v) < 500) {
    const du = Math.max(RUNWAY.u0 - u, 0, u - RUNWAY.u1), dv = Math.max(Math.abs(v) - RUNWAY.hw, 0);
    h = mix(PAD_H, h, smoothstep(0, 260, Math.hypot(du, dv)));
  }
  return h + mountains(x, z, u, v);
}

let _lx = NaN, _lz = NaN, _lh = 0;
export function heightAt(x, z) {
  const { u, v } = fromSite(x, z);
  let h = baseHeight(x, z);
  if (inRiverBox(u, v)) {
    const q = riverQuery(u, v, _rq);
    if (q.d < q.w * 6) {
      const c = toSite(q.cu, q.cv);
      const surf = baseHeight(c.x, c.z) - 1.1;
      const depth = 2.6 + 1.4 * Math.min(1, q.s / 3000);
      if (q.d < q.w) { const t = q.d / q.w, tt = Math.max(0, 1 - t * t); h = surf - depth * tt * Math.sqrt(tt); }      // (1 - t^2)^1.5: the bed shoals gently into the bank
      else {
        const hb = h + Math.max(0, surf + 1.4 - h) * (1 - smoothstep(q.w * 2, q.w * 6, q.d));   // levee keeps the banks above the water
        h = mix(surf, hb, smoothstep(q.w * 0.92, q.w * 2.6, q.d));
      }
    }
  }
  _lx = x; _lz = z; _lh = h;
  return h;
}
/** water surface elevation at (x,z), or -1e9 when dry. h = terrain height here (optional, avoids a recompute) */
export function waterSurface(x, z, h) {
  if (h === undefined) h = (x === _lx && z === _lz) ? _lh : heightAt(x, z);
  let w = h < LAKE ? LAKE : -1e9;
  const { u, v } = fromSite(x, z);
  if (inRiverBox(u, v)) {
    const q = riverQuery(u, v, _rq2);
    if (q.d < q.w + 1.5) {
      const c = toSite(q.cu, q.cv);
      const surf = baseHeight(c.x, c.z) - 1.1;
      if (surf > w) w = surf;
    }
  }
  return w;
}
export function waterDepth(x, z) { const h = heightAt(x, z); const w = waterSurface(x, z, h); return w > -1e8 ? Math.max(0, w - h) : 0; }
/** distance (m, approximate) to the nearest river centreline point, 1e9 far away */
export function riverDistance(x, z) { const { u, v } = fromSite(x, z); if (!inRiverBox(u, v)) return 1e9; return riverQuery(u, v, _rq2).d; }

export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}

// ---------------------------------------------------------------------------- biome fields
/** out = [moisture, forest, fungus, shore]; each 0..1. h/slope are optional (computed when omitted) */
export function biome(x, z, h, slope, out = [0, 0, 0, 0, 0]) {
  if (h === undefined) h = heightAt(x, z);
  if (slope === undefined) { const hx = heightAt(x + 3, z) - h, hz = heightAt(x, z + 3) - h; slope = Math.min(1, Math.hypot(hx, hz) / 3); }
  const rd = riverDistance(x, z);
  const low = 1 - smoothstep(LAKE + 2, LAKE + 70, h);
  let moist = Math.max(low, 1 - smoothstep(14, 220, rd));
  moist = clamp(moist * (0.75 + 0.5 * (fbm2(x / 600 + 5, z / 600, 2) * 0.5 + 0.5)), 0, 1);
  const alt = 1 - smoothstep(560, 1050, h);
  const clear = smoothstep(-0.25, 0.25, fbm2(x / 520 + 41, z / 520 - 7, 3));         // meadows and clearings (used by fungus / flowers)
  // groves: clustered islands of dense canopy separated by open meadow, favouring wet ground; gallery forest along the rivers
  const gn = fbm2(x / 360 + 41, z / 360 - 7, 3) + 0.3 * fbm2(x / 85 + 5, z / 85, 2) + 0.28 * moist;
  const grove = smoothstep(-0.08, 0.3, gn);
  const ripar = smoothstep(7, 34, rd) * (1 - smoothstep(110, 380, rd)) * (0.55 + 0.45 * smoothstep(-0.3, 0.2, gn));
  let forest = Math.max(grove * (0.6 + 0.4 * moist), ripar * 0.9) * alt * (1 - smoothstep(0.5, 0.82, slope));
  const { u, v } = fromSite(x, z);
  const dr = Math.hypot(Math.max(RUNWAY.u0 - 400 - u, 0, u - RUNWAY.u1 - 500), Math.max(Math.abs(v) - RUNWAY.hw - 25, 0));
  const clearK = smoothstep(30, 190, dr);                                             // keep the runway meadow and its approach corridor open
  const ovl = Math.hypot(Math.max(300 - u, 0, u - 960), Math.max(-420 - v, 0, v - 150));      // keep the overlook headland open
  const clearO = smoothstep(30, 300, ovl);
  forest *= clearK * clearO;
  const fung = smoothstep(0.05, 0.5, fbm2(x / 760 + 90, z / 760 + 13, 2)) * alt * (1 - smoothstep(0.5, 0.75, slope)) * clearK * clearO;
  const wl = h - LAKE;
  const shore = (1 - smoothstep(0.5, 3.4, wl)) * (wl > -4 ? 1 : 0.0) + (rd < 30 ? (1 - smoothstep(4, 28, rd)) * 0.6 : 0);
  // rock ledges and the scarp's top rim: shrub / fern / grass growth on steep or stepped ground
  const ed = edgeAt(v) - u;
  const rim = (ed > -6 && ed < 55 && u < 1300) ? smoothstep(-6, 4, ed) * (1 - smoothstep(14, 55, ed)) : 0;
  const ledge = clamp(smoothstep(0.28, 0.45, slope) * (1 - smoothstep(0.8, 0.98, slope)) * (1 - smoothstep(500, 900, h)) * (0.35 + 0.65 * smoothstep(-0.2, 0.3, fbm2(x / 11 + 2, z / 11, 2))) + rim * (0.55 + 0.45 * smoothstep(-0.3, 0.3, fbm2(x / 17, z / 17 + 8, 2))), 0, 1);
  out[0] = moist; out[1] = clamp(forest, 0, 1); out[2] = clamp(fung, 0, 1) * (0.4 + 0.6 * smoothstep(0.1, 0.5, clear)); out[3] = clamp(shore, 0, 1); out[4] = ledge;
  return out;
}
const _b = [0, 0, 0, 0, 0];
/** terrain shader aux: [wet, shore, rock, forest] */
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  const h = (x === _lx && z === _lz) ? _lh : heightAt(x, z);
  biome(x, z, h, slope, _b);
  const rockN = fbm2(x / 140 + 7, z / 140 - 3, 3) * 0.5 + 0.5;
  const high = smoothstep(1150, 2100, h);
  out[0] = _b[0]; out[1] = _b[3];
  const lowK = 1 - smoothstep(450, 1500, h);
  out[2] = clamp(smoothstep(0.34 + 0.34 * lowK, 0.6 + 0.34 * lowK, slope) * 0.95 + smoothstep(0.66, 0.85, rockN) * 0.25 * (1 - _b[1]) * (1 - lowK) + high * 0.7, 0, 1);
  out[3] = _b[1];
  return out;
}

// ---------------------------------------------------------------------------- scatter: pinnacles, boulders, POIs
export function rockField(x, z) { return smoothstep(0.1, 0.65, fbm2(x / 900 + 12, z / 900 + 3, 3) * 0.5 + 0.5 + 0.2 * Math.sin(x / 431)); }
export function hoodooField(x, z) { return smoothstep(-0.2, 0.4, fbm2(x / 4200 + 5.5, z / 4200 - 8.5, 2)); }
// curated pinnacle clusters (a, b, count, seed, hmin, hmax): behind the falls, flanking the runway view and out on the plain
const CLUSTERS = [[1150, 650, 8, 11, 70, 190], [1900, -720, 9, 23, 90, 240], [1500, 160, 6, 5, 50, 140], [3700, 520, 12, 37, 100, 290], [3350, -700, 9, 53, 60, 170], [4500, -250, 10, 67, 120, 330], [2350, 930, 7, 41, 70, 190], [1400, -1050, 6, 73, 60, 150], [900, 1080, 6, 81, 60, 140], [5400, 350, 9, 91, 150, 360]];
export const HERO_SPIRES = (() => {
  const out = [];
  for (const [a, b, n, seed, h0, h1] of CLUSTERS) for (let k = 0; k < n; k++) {
    const ang = hash2(seed, k, 1) * 6.283, d = Math.sqrt(hash2(seed, k, 2)) * (50 + n * 10);
    const p = toSite(a + Math.cos(ang) * d, b + Math.sin(ang) * d);
    const t = hash2(seed, k, 3);
    out.push({ x: p.x, z: p.z, variant: Math.floor(hash2(seed, k, 4) * 5), yaw: hash2(seed, k, 5) * 6.283, h: h0 + (h1 - h0) * (k === 0 ? 1 : t * t), w: 0.2 + hash2(seed, k, 6) * 0.14 });
  }
  return out;
})();
export function spiresInCell(ix, iz, S) {
  const out = [];
  const groups = 1 + Math.floor(hash2(ix, iz, 601) * 2);
  for (let g = 0; g < groups; g++) {
    const gx = (ix + hash2(ix, iz, 610 + g)) * S, gz = (iz + hash2(ix, iz, 620 + g)) * S;
    if (hash2(ix, iz, 640 + g) > 0.12 + 0.55 * hoodooField(gx, gz)) continue;
    const { u, v } = fromSite(gx, gz); if (u > 500 && u < 6200 && Math.abs(v) < 1500) continue;     // curated valley uses HERO_SPIRES
    if (u < 800 && Math.abs(v) < 2100 && u > -6000) continue;   // the plateau stays open
    const gh = heightAt(gx, gz); if (gh < LAKE + 6) continue;
    const n = 2 + Math.floor(hash2(ix, iz, 630 + g) * 6);
    const spread = 50 + hash2(ix, iz, 650 + g) * 150;
    for (let k = 0; k < n; k++) {
      const a = hash2(ix + k * 7, iz + g, 660) * 6.2832, d = Math.sqrt(hash2(ix + k * 7, iz + g, 661)) * spread;
      const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
      const u2 = hash2(ix + k * 13, iz + g * 5, 662);
      const big = hash2(ix + k * 13, iz + g * 5, 663) > 0.88;
      out.push({ x, z, variant: Math.floor(hash2(ix + k, iz + g, 664) * 5), yaw: hash2(ix + k, iz + g, 665) * 6.2832, h: big ? 160 + u2 * 220 : 35 + u2 * u2 * 120, w: 0.2 + hash2(ix + k, iz + g, 666) * 0.14, lean: 0 });
    }
  }
  return out;
}
export function archesInCell() { return []; }
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  const rf = rockField(cx, cz);
  const rdc = riverDistance(cx, cz);
  const n = Math.floor(1 + 14 * rf * rf + 2 * hash2(ix, iz, 801) + (rdc < 140 ? 7 * (1 - rdc / 140) : 0));      // more boulders along the streams
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    const { u, v } = fromSite(x, z); if (u > RUNWAY.u0 - 20 && u < RUNWAY.u1 + 20 && Math.abs(v) < RUNWAY.hw + 30) continue;
    const h = heightAt(x, z); if (h < LAKE + 0.5) continue;
    const wsb = waterSurface(x, z, h); if (wsb > -1e8 && h < wsb - 0.7) continue;
    const q = hash2(ix + k, iz + k * 3, 804);
    out.push({ x, z, r: 0.4 + Math.pow(q, 3.0) * 2.8 * (0.6 + 0.8 * rf) + (hash2(ix + k, iz, 809) > 0.99 ? 2 + 4 * hash2(ix, iz + k, 810) : 0), variant: Math.floor(hash2(ix + k, iz, 805) * 4),
      yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.6 + 0.4 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808) });
  }
  return out;
}
const poiCache = new Map();
const PT = ['grove', 'bloom', 'spire', 'falls', 'grove', 'bloom'];
const CURATED = [['falls', 640, -100, 70], ['grove', 1300, 700, 90], ['bloom', 2900, -750, 80], ['spire', 3700, 500, 60]];
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  const c0 = fromSite(SITE.x, SITE.z);
  for (let i = 0; i < CURATED.length && !p; i++) {
    const [type, a, b, r] = CURATED[i], q = toSite(a, b);
    if (Math.floor(q.x / POI_CELL) === ix && Math.floor(q.z / POI_CELL) === iz) p = { type, ix, iz, x: q.x, z: q.z, r, seed: 1000 + i };
  }
  if (!p && hash2(ix, iz, 501) < 0.5) {
    const type = PT[Math.floor(hash2(ix, iz, 503) * PT.length)];
    const x = (ix + 0.15 + 0.7 * hash2(ix, iz, 502)) * POI_CELL, z = (iz + 0.15 + 0.7 * hash2(ix, iz, 504)) * POI_CELL;
    if (heightAt(x, z) > LAKE + 8) p = { type: type === 'falls' ? 'grove' : type, ix, iz, x, z, r: type === 'spire' ? 60 : 85, seed: Math.floor(hash2(ix, iz, 505) * 1e6) };
  }
  poiCache.set(key, p);
  return p;
}
export function poisNear(x, z, radius) {
  const out = [];
  const i0 = Math.floor((x - radius) / POI_CELL), i1 = Math.floor((x + radius) / POI_CELL);
  const j0 = Math.floor((z - radius) / POI_CELL), j1 = Math.floor((z + radius) / POI_CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const p = poiCell(i, j);
    if (p && (p.x - x) ** 2 + (p.z - z) ** 2 <= (radius + p.r) ** 2) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------- vegetation placement rules
// species ids: 0 spire tree, 1 canopy tree, 2 bulb tree, 3 giant umbrella fungus, 4 small fungus cluster, 5 shrub, 6 fern, 7 grass tuft, 8 spore pod
export const CLASS = { big: 96, small: 32, grass: 12 };
const bb = [0, 0, 0, 0, 0];
/** deterministic plants in cell (ix,iz) of size S; kind = 'big' | 'small' | 'grass' */
export function plantsInCell(kind, ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  const area = S * S;
  const tryPlace = (sp, n, seed, accept, size) => {
    for (let k = 0; k < n; k++) {
      const x = (ix + hash2(ix * 17 + k, iz * 5 + sp, seed)) * S, z = (iz + hash2(ix * 3 + sp, iz * 19 + k, seed + 1)) * S;
      const h = heightAt(x, z);
      if (h < LAKE + 0.35) continue;
      const wsf = waterSurface(x, z, h); if (wsf > -1e8 && h < wsf + 0.4) continue;
      const hx = heightAt(x + 2.5, z) - h, hz = heightAt(x, z + 2.5) - h; const slope = Math.min(1, Math.hypot(hx, hz) / 2.5);
      biome(x, z, h, slope, bb);
      const r = hash2(ix * 7 + k, iz * 11 + sp, seed + 2);
      if (!accept(bb, slope, r, h, x, z)) continue;
      out.push({ x, z, y: h, sp, sc: size(hash2(ix + k * 3, iz + sp * 9, seed + 3), bb), yaw: hash2(ix + k, iz * 13 + sp, seed + 4) * 6.2832, tone: hash2(ix * 29 + k, iz + sp, seed + 5), r });
    }
  };
  if (kind === 'big') {
    // trees: candidates scale with area, accepted by forest density
    // groves: the umbrella and bottle trees make the canopy, a few lance palms stand out of it
    tryPlace(0, Math.floor(area * 0.0034), 11, (b, s, r) => r < b[1] * b[1] * 0.5 && b[0] > 0.2, (t) => 0.8 + t * 0.9);
    tryPlace(1, Math.floor(area * 0.0090), 21, (b, s, r) => r < b[1] * (0.45 + 0.6 * b[0]), (t) => 0.85 + t * 0.85);
    tryPlace(2, Math.floor(area * 0.0058), 31, (b, s, r) => r < b[1] * 0.8 * (1.1 - 0.5 * b[0]), (t) => 0.75 + t * 0.8);
    // umbrella fungi: a few enormous (20-60 m caps), mostly mid-size, inside fungal patches
    tryPlace(3, Math.floor(area * 0.00040), 41, (b, s, r) => r < b[2] * 0.9, (t) => (t > 0.93 ? 30 + (t - 0.93) / 0.07 * 30 : t > 0.7 ? 11 + (t - 0.7) / 0.23 * 14 : 4 + t / 0.7 * 7));
  } else if (kind === 'small') {
    tryPlace(4, Math.floor(area * 0.0075), 51, (b, s, r) => r < b[2] * 0.8 + 0.03 * b[1], (t) => 0.7 + t * 1.3);
    tryPlace(5, Math.floor(area * 0.02), 61, (b, s, r) => r < (0.1 + b[1] * 0.9 + b[4] * 0.9) * (1 - b[3] * 0.8), (t) => 0.7 + t * 0.9);
    tryPlace(6, Math.floor(area * 0.04), 71, (b, s, r) => r < (b[1] * (0.4 + 0.6 * b[0]) * 1.3 + b[4] * 0.9), (t) => 0.7 + t * 0.9);
    tryPlace(8, Math.floor(area * 0.0035), 91, (b, s, r) => r < (b[2] * 0.9 + 0.15 * b[0]) * 0.5 && b[0] > 0.5, (t) => 0.8 + t * 0.4);
  } else {
    tryPlace(7, Math.floor(area * 0.7), 81, (b, s, r) => r < (0.35 + 0.65 * (1 - b[1])) * (1 - b[3] * 0.9) * (1 - s * 1.2 * (1 - 0.75 * b[4])), (t) => 0.8 + t * 0.8);
  }
  return out;
}

/** river flow vector (plane coords, m/s) at (x,z): out = [fx, fz]; zero on lakes / away from the river */
export function waterFlow(x, z, out) {
  out[0] = 0; out[1] = 0;
  const { u, v } = fromSite(x, z);
  if (!inRiverBox(u, v)) return out;
  const q = riverQuery(u, v, _rq2);
  if (q.d > q.w + 2) return out;
  const sp = (Math.abs(u - edgeAt(q.cv)) < 22 ? 7 : 1.7) * (1 - smoothstep(q.w * 0.6, q.w + 2, q.d) * 0.6);
  out[0] = (AX.x * q.tx + BX.x * q.tz) * sp; out[1] = (AX.z * q.tx + BX.z * q.tz) * sp;
  return out;
}
/** waterfalls: the hero Singing Falls over the cliff edge, plus smaller cascades on the valley ledges. TRUE plane coordinates. */
let _fa = null;
export function fallAnchors() {
  if (_fa) return _fa;
  const tmp = { d: 0, s: 0, cu: 0, cv: 0, w: 10, tx: 1, tz: 0 };
  const mk = (edgeFn, v0, face, hero) => {
    let vc = v0, edge = edgeFn(vc);
    for (let i = 0; i < 14; i++) { const q = riverQuery(edge, vc, tmp); vc = q.cv; edge = edgeFn(vc); }
    const q = riverQuery(edge, vc, tmp);
    const lip = toSite(edge - face * 0.5, vc), base = toSite(edge + face * 0.5 + 2, vc);
    const lipH = baseHeight(lip.x, lip.z) - 1.1, baseH = baseHeight(base.x, base.z) - 1.1;
    return { x: lip.x, z: lip.z, dirx: AX.x, dirz: AX.z, lip: 0, face: face + 2, lipH, baseH, width: 2 * q.w * (hero ? 1.1 : 1.0), edge, vc, hero };
  };
  _fa = [mk(edgeAt, -175, 14, true),
    mk((v) => 1235 + 55 * fbm2(v / 230 + 1.3, 3.3, 2), -330, 14, false),
    mk((v) => 1790 + 55 * fbm2(v / 230 + 6.1, 4.4, 2), -200, 14, false)];
  return _fa;
}
