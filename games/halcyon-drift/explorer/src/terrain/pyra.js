// Pyra recipe: a volcanic furnace world. A basalt headland (runway pad) overlooks a lava basin: lava rivers run down from the volcanoes into a
// lava lake, stratovolcano cones with glowing crater lakes and flank streaks stand in the haze, ash fields, obsidian glass, basalt spires, fumaroles.
// Pure functions of (x, z) shared by the terrain worker, physics, scatter, lava surface meshes and vegetation (same contract as terrain/verdant.js;
// the lava reuses the water pipeline: waterSurface / waterFlow). Aux channels for the terrain shader: [heat, ash, rock, glass].
import { fbm2, simplex2, hash2, smoothstep, mix, clamp } from '../noise.js';

export const id = 'pyra';
export const POI_CELL = 3600;
export const LAKE = -1e6;               // no sea level (kept for modules that read it)
export const PAD_H = 150;               // headland / runway elevation

export const WORLD = {
  name: 'Pyra', waterLevel: -1e6, lushMode: 2, noKitRocks: true, noFauna: true,
  palette: {
    grassA: [0.05, 0.04, 0.04], grassB: [0.08, 0.07, 0.06], dry: [0.2, 0.17, 0.15], mud: [0.05, 0.04, 0.04], sand: [0.18, 0.15, 0.12], moss: [0.045, 0.04, 0.04],
    rock: [0.06, 0.055, 0.052], rockLight: [0.2, 0.17, 0.15],
  },
  fog: { dist: 24000, fall: 5000, mistY: 55, mistDens: 1 / 10000, mistFall: 150, mistCol: [0.9, 0.3, 0.12] },
  water: { deep: [0.5, 0.05, 0.0], shallow: [0.9, 0.3, 0.02], foam: [1.0, 0.7, 0.2], kind: 'lava' },
  hemi: { sky: [0.85, 0.36, 0.2], ground: [0.32, 0.1, 0.05], intensity: 0.85 },
  sunScale: 0.6, exposure: 0.95,
  species: { total: 6 },
  // charred / crystalline / ember variants of the Verdant kit materials (applied by vegetation.js per material name)
  floraLook: {
    bark: { color: [0.16, 0.13, 0.12], roughness: 0.95 },
    foliage: { color: [0.55, 0.22, 0.12], roughness: 0.9, emissive: [0.9, 0.22, 0.04], emI: 0.22 },
    fungus_body: { color: [0.1, 0.085, 0.13], roughness: 0.18, metalness: 0.35, emissive: [0.35, 0.08, 0.45], emI: 0.25 },
    fungus_gills: { color: [0.3, 0.1, 0.05], emissive: [1.0, 0.35, 0.05], emI: 1.6 },
    glow_bits: { color: [0.4, 0.15, 0.05], emissive: [1.0, 0.42, 0.06], emI: 2.2 },
  },
};

// ---- site frame: u along the runway (towards the lava basin), v across
export const SITE = { x: 1600000, z: -1100000 };
const AX = { x: 0.94, z: -0.342 }, BX = { x: 0.342, z: 0.94 };
export const toSite = (a, b) => ({ x: SITE.x + AX.x * a + BX.x * b, z: SITE.z + AX.z * a + BX.z * b });
const fromSite = (x, z) => { const dx = x - SITE.x, dz = z - SITE.z; return { u: dx * AX.x + dz * AX.z, v: dx * BX.x + dz * BX.z }; };
export const RUNWAY = { u0: -1100, u1: 300, hw: 70, h: PAD_H, heading: Math.atan2(AX.x, -AX.z) };

// ---- the basalt headland: plateau ending in a scarp over the lava basin
const edgeAt = (v) => 720 + 70 * fbm2(v / 400 + 3.1, 1.1, 3) + 16 * fbm2(v / 70, 4.2, 2);
const floorTrend = (u, x, z) => 40 - 0.0035 * Math.max(u - 700, 0) + 5 * fbm2(x / 2600 + 5, z / 2600 - 2, 2);

// ---- stratovolcanoes (site frame): H summit height above base, R base radius, cr crater radius, cd crater depth
const CONES = [
  { u: 7200, v: -2600, R: 5600, H: 1900, cr: 380, cd: 300, seed: 3.1 },
  { u: 5400, v: 3700, R: 4200, H: 1250, cr: 300, cd: 240, seed: 7.7 },
  { u: 11800, v: 700, R: 8200, H: 2600, cr: 560, cd: 380, seed: 11.3 },
  { u: 3000, v: -5200, R: 3600, H: 1000, cr: 260, cd: 200, seed: 5.9 },
  { u: 9000, v: 6500, R: 4800, H: 1500, cr: 340, cd: 260, seed: 2.2 },
];
for (const c of CONES) { c.rimH = c.H * Math.pow(1 - (c.cr * 1.2) / c.R, 2.8); c.lavaLvl = c.rimH - c.cd * 0.62; }
function coneH(u, v, c) {
  const dx = u - c.u, dz = v - c.v, d = Math.hypot(dx, dz);
  if (d >= c.R) return 0;
  const dd = Math.max(d, c.cr * 1.2), t = dd / c.R;
  let h = c.H * Math.pow(1 - t, 2.8);
  if (t > 0.03 && t < 0.9) {            // radial gullies / lava channels down the flank
    const ang = Math.atan2(dz, dx);
    h *= 1 + 0.07 * (simplex2(Math.cos(ang) * 3.4 + c.seed, Math.sin(ang) * 3.4) + 0.5 * simplex2(Math.cos(ang) * 9.0 + c.seed, Math.sin(ang) * 9.0 + t * 3));
  }
  if (d < c.cr * 1.2) { const k = d / (c.cr * 1.2); h -= c.cd * (1 - smoothstep(0.28, 1.0, k)) * (1 - 0.15 * k); }
  return h;
}
function coneStreak(u, v, c) {      // glowing lava rivulets on the flank, 0..1
  const dx = u - c.u, dz = v - c.v, d = Math.hypot(dx, dz);
  if (d >= c.R * 0.8 || d < c.cr * 0.9) return 0;
  const t = d / c.R, ang = Math.atan2(dz, dx);
  const g = simplex2(Math.cos(ang) * 3.4 + c.seed, Math.sin(ang) * 3.4);                 // the gully noise of coneH: flows run in its minima
  const th = -0.42 - 0.38 * smoothstep(0.06, 0.62, t);                                   // narrower further downhill: tapering flows
  const w = smoothstep(th + 0.1, th - 0.34, g);
  const brk = 0.78 + 0.22 * simplex2(Math.cos(ang) * 7 + c.seed, t * 5 + c.seed);          // slight variation along the flow, never gaps
  return w * brk * (1 - smoothstep(0.38, 0.7, t)) * smoothstep(0.015, 0.05, t);
}

// ---- lava rivers (site frame polylines, downstream order) and the lava lake
const RIVERS = [
  [[4300, -1700], [3800, -1400], [3300, -1100], [2900, -850], [2600, -650], [2400, -470]],
  [[1300, 2300], [1500, 1700], [1650, 1050], [1900, 450], [2050, -50], [2150, -250]],
  [[800, -2300], [1000, -1750], [1350, -1250], [1700, -850], [1950, -560]],
  [[3300, 1700], [3000, 1200], [2750, 700], [2500, 250], [2350, -150]],
];
const RSEG = []; let RLEN = 0;
for (const pl of RIVERS) for (let i = 0; i < pl.length - 1; i++) {
  const [a, b] = pl[i], [c, d] = pl[i + 1]; const L = Math.hypot(c - a, d - b);
  RSEG.push({ a, b, dx: (c - a) / L, dz: (d - b) / L, L, s0: RLEN }); RLEN += L;
}
const LAKEC = { u: 2150, v: -350, r: 520 };
const lakeD = (u, v) => Math.hypot(u - LAKEC.u, (v - LAKEC.v) * 1.05) * (1 + 0.34 * fbm2((u - LAKEC.u) / 250 + 3.3, (v - LAKEC.v) / 250 - 1.1, 2) + 0.1 * fbm2((u - LAKEC.u) / 70, (v - LAKEC.v) / 70, 2));      // lobed, irregular shoreline
const LAKE_LVL = 26;
const U_MIN = -400, U_MAX = 6800, V_MIN = -3200, V_MAX = 2800;
const inRiverBox = (u, v) => u > U_MIN && u < U_MAX && v > V_MIN && v < V_MAX;
function riverQuery(u, v, o) {
  o.tx = 1; o.tz = 0;
  let best = 1e9, bs = 0, bu = 0, bv = 0;
  for (let i = 0; i < RSEG.length; i++) {
    const g = RSEG[i];
    const px = u - g.a, pz = v - g.b;
    let t = px * g.dx + pz * g.dz; t = t < 0 ? 0 : t > g.L ? g.L : t;
    const cu = g.a + g.dx * t, cv = g.b + g.dz * t;
    const wob = 70 * fbm2(cu / 330 + 3.1, cv / 330 + 0.7, 2) + 20 * fbm2(cu / 100 + 5.2, cv / 100 + 1.9, 2);
    const d = Math.hypot(u - cu, v - (cv + wob));
    if (d < best) { best = d; bs = g.s0 + t; bu = cu; bv = cv + wob; o.tx = g.dx; o.tz = g.dz; }
  }
  o.s = bs; o.cu = bu; o.cv = bv;
  o.w = (16 + 6 * fbm2(bs / 140 + 2.2, 6.6, 2) + 3 * Math.exp(-((bu - LAKEC.u) ** 2 + (bv - LAKEC.v) ** 2) / (2 * 700 * 700))) * (1 + 0.25 * fbm2(bs / 210, 1.3, 2));
  o.d = best + (best < o.w * 3 ? 2.0 * fbm2(u / 17 + 1.1, v / 17 - 3.3, 2) + 0.8 * fbm2(u / 6, v / 6 + 4.0, 1) : 0);
  return o;
}
const _rq = { d: 1e9, s: 0, cu: 0, cv: 0, w: 10 }, _rq2 = { d: 1e9, s: 0, cu: 0, cv: 0, w: 10 }, _rq3 = { d: 1e9, s: 0, cu: 0, cv: 0, w: 10 };

// ---- band-limited ridged basalt ranges between the cones (see terrain/verdant.js: BAND = finest resolvable wavelength)
let BAND = 0;
export function setBand(step) { BAND = step * 4.5; }
function ranges(x, z, u, v) {
  const dist = Math.hypot(u * 0.8, v);
  const mask = smoothstep(5200, 9500, dist) * smoothstep(-0.2, 0.3, fbm2(x / 15000 + 7, z / 15000 - 3, 2) + 0.2);
  if (mask < 0.002) return 0;
  const wx = x + 1800 * fbm2(x / 8000 + 3, z / 8000, 2), wz = z + 1800 * fbm2(x / 8000 + 9, z / 8000 + 4, 2);
  let X = wx / 4200, Y = wz / 4200, a = 1, sum = 0, norm = 0, w = 1, wl = 4200;
  for (let o = 0; o < 6; o++) {
    const fade = BAND > 0 ? clamp((wl / BAND - 1) * 0.8, 0, 1) : 1;
    if (fade <= 0) break;
    const sn = simplex2(X, Y); let q = (1 - Math.sqrt(sn * sn + 0.015)) * 1.12; q = q > 0 ? q * q : 0;
    q *= w; w = clamp(q * 2.0, 0.15, 1);
    sum += a * q * fade; norm += a; a *= 0.5;
    const nx = (X * 0.8 - Y * 0.6) * 2.1 + 3.1, ny = (X * 0.6 + Y * 0.8) * 2.1 + 7.9; X = nx; Y = ny; wl /= 2.1;
  }
  const r = sum / norm;
  return mask * (Math.pow(r, 1.25) * 1500 + (BAND < 400 ? fbm2(x / 110, z / 110, 2) * 8 * r : 0));
}

// ---- base height (everything except the lava channel carve)
function baseHeight(x, z) {
  const { u, v } = fromSite(x, z);
  const siteK = 1 - smoothstep(4200, 7600, Math.hypot(u, v * 0.8));
  let hv = 36 + 16 * fbm2(x / 7000 + 3, z / 7000 - 5, 3);
  if (siteK > 0) {
    const hs = floorTrend(u, x, z) + 3.5 * fbm2(x / 520, z / 520 + 9, 3) + 1.6 * fbm2(x / 70, z / 70, 2);
    const ridge = 5 * Math.pow(1 - Math.abs(simplex2(x / 360 + 2, z / 360 - 1)), 4) + 1.2 * Math.pow(1 - Math.abs(simplex2(x / 120, z / 120 + 4)), 3);     // pressure ridges and cooling cracks
    let cones = 0;                                                                                // scoria cones
    const cix = Math.floor(x / 650), ciz = Math.floor(z / 650);
    for (let jj = -1; jj <= 1; jj++) for (let ii = -1; ii <= 1; ii++) {
      const ci = cix + ii, cj = ciz + jj;
      if (hash2(ci, cj, 901) < 0.62) continue;
      const px = (ci + 0.2 + 0.6 * hash2(ci, cj, 902)) * 650, pz = (cj + 0.2 + 0.6 * hash2(ci, cj, 903)) * 650;
      const dd = Math.hypot(x - px, z - pz), rr = 55 + 70 * hash2(ci, cj, 904);
      if (dd < rr) { const t = dd / rr; cones = Math.max(cones, (16 + 22 * hash2(ci, cj, 905)) * (1 - t) * (1 - t * 0.0) * (1 - 0.55 * Math.exp(-t * t * 30))); }
    }
    hv = mix(hv, hs + ridge * (0.5 + 0.5 * smoothstep(300, 1200, u)) + cones, siteK);
    const dl = lakeD(u, v);
    if (dl < LAKEC.r * 1.9) {                                                               // the lava lake basin with a raised crusted rim
      hv = mix(hv, LAKE_LVL - 9 + 2 * fbm2(x / 90, z / 90, 2), 1 - smoothstep(LAKEC.r * 0.5, LAKEC.r * 1.05, dl));
      const rim = smoothstep(LAKEC.r * 0.85, LAKEC.r * 1.02, dl) * (1 - smoothstep(LAKEC.r * 1.1, LAKEC.r * 1.6, dl));
      if (rim > 0.001) hv = Math.max(hv, LAKE_LVL + 2.4 * rim);
    }
  }
  let h = hv;
  // headland plateau with a rugged scarp
  if (u < 1300 && u > -6500 && Math.abs(v) < 2300) {
    const edge0 = edgeAt(v);
    let pu;
    if (u > edge0 - 40 && u < edge0 + 40) {
      const edge = edge0 + 10 * fbm2(v / 52 + 3.3, u / 40, 2) + 3.5 * fbm2(v / 14 + 1.9, u / 7 + 6.1, 2);
      const hw = 9;
      pu = 1 - smoothstep(edge - hw, edge + hw, u);
      const ts = pu * 6, tf = ts - Math.floor(ts);
      pu = mix(pu, (Math.floor(ts) + smoothstep(0.3, 0.7, tf)) / 6, 0.55);                // stepped basalt flow fronts
    } else pu = u < edge0 ? 1 : 0;
    const pv = 1 - smoothstep(1500 + 160 * fbm2(u / 500 + 2, 5, 2), 1950 + 160 * fbm2(u / 500, 7, 2), Math.abs(v));
    const pb = 1 - smoothstep(-5200, -6300, u);
    const k = pu * pv * pb;
    if (k > 0) {
      const platH = PAD_H + 7 * fbm2(x / 900 + 21, z / 900, 2) + 2.2 * fbm2(x / 140, z / 140, 2) + 0.9 * fbm2(x / 30, z / 30, 2);     // ropy flow surface
      h = mix(h, platH, k);
    }
  }
  if (u > RUNWAY.u0 - 500 && u < RUNWAY.u1 + 500 && Math.abs(v) < 500) {
    const du = Math.max(RUNWAY.u0 - u, 0, u - RUNWAY.u1), dv = Math.max(Math.abs(v) - RUNWAY.hw, 0);
    h = mix(PAD_H, h, smoothstep(0, 260, Math.hypot(du, dv)));
  }
  let cone = 0;
  for (let i = 0; i < CONES.length; i++) cone = Math.max(cone, coneH(u, v, CONES[i]));
  return h + cone + ranges(x, z, u, v);
}

let _lx = NaN, _lz = NaN, _lh = 0;
export function heightAt(x, z) {
  const { u, v } = fromSite(x, z);
  let h = baseHeight(x, z);
  if (inRiverBox(u, v)) {
    const q = riverQuery(u, v, _rq);
    if (q.d < q.w * 6) {
      const c = toSite(q.cu, q.cv);
      const surf = floorTrend(q.cu, c.x, c.z) - 0.7 - 0.0008 * Math.max(0, 2400 - q.cu) * 0;      // the lava surface follows the valley trend (no small bumps)
      const depth = 1.7;
      if (q.d < q.w) { const t = q.d / q.w, tt = Math.max(0, 1 - t * t); h = surf - depth * tt * Math.sqrt(tt); }
      else {
        const hb = h + Math.max(0, surf + 2.3 - h) * (1 - smoothstep(q.w * 1.6, q.w * 5, q.d));     // raised levees keep the lava in its channel
        h = mix(surf, hb, smoothstep(q.w * 0.92, q.w * 2.0, q.d));
      }
    }
  }
  _lx = x; _lz = z; _lh = h;
  return h;
}
/** lava surface elevation at (x,z), or -1e9 where there is none (rivers, the lake, crater lakes) */
export function waterSurface(x, z, h) {
  if (h === undefined) h = (x === _lx && z === _lz) ? _lh : heightAt(x, z);
  let w = -1e9;
  const { u, v } = fromSite(x, z);
  if (inRiverBox(u, v)) {
    const dl = lakeD(u, v);
    if (dl < LAKEC.r * 1.4 && h < LAKE_LVL) w = LAKE_LVL;
    const q = riverQuery(u, v, _rq2);
    if (q.d < q.w + 1.5) { const c = toSite(q.cu, q.cv); const surf = floorTrend(q.cu, c.x, c.z) - 0.7; if (surf > w) w = surf; }
  }
  for (let i = 0; i < CONES.length; i++) { const c = CONES[i]; if (Math.abs(u - c.u) < c.cr * 1.3 && Math.abs(v - c.v) < c.cr * 1.3 && h < c.lavaLvl) w = Math.max(w, c.lavaLvl); }
  return w;
}
export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}
/** lava flow vector (plane coords, m/s): along the channel, slow on the lake */
export function waterFlow(x, z, out) {
  out[0] = 0; out[1] = 0;
  const { u, v } = fromSite(x, z);
  if (!inRiverBox(u, v)) return out;
  const q = riverQuery(u, v, _rq2);
  if (q.d > q.w + 2) return out;
  const sp = 1.5 * (1 - smoothstep(q.w * 0.5, q.w + 2, q.d) * 0.7);
  out[0] = (AX.x * q.tx + BX.x * q.tz) * sp; out[1] = (AX.z * q.tx + BX.z * q.tz) * sp;
  return out;
}
/** distance (m) from (x,z) to the nearest lava surface (approximate), 1e9 when far */
export function lavaDistance(x, z) {
  const { u, v } = fromSite(x, z);
  let d = 1e9;
  if (inRiverBox(u, v)) {
    const q = riverQuery(u, v, _rq3); d = Math.min(d, q.d - q.w);
    d = Math.min(d, lakeD(u, v) - LAKEC.r * 0.78);
  }
  for (let i = 0; i < CONES.length; i++) { const c = CONES[i]; const dc = Math.hypot(u - c.u, v - c.v); if (dc < c.cr * 3) d = Math.min(d, dc - c.cr * 0.7); }
  return d;
}
/** radiant heat 0..1.3 at (x,z) for the suit model */
export function heatAt(x, z) {
  const d = lavaDistance(x, z);
  if (d > 70) return 0;
  return d <= 0 ? 1.3 : Math.pow(1 - d / 70, 1.6);
}
export function riverDistance(x, z) { return lavaDistance(x, z); }

// ---------------------------------------------------------------------------- vents (plume sources)
export const VENTS = (() => {
  const out = [];
  for (const c of CONES) { const p = toSite(c.u, c.v); out.push({ x: p.x, z: p.z, str: 1.6 + c.H / 2500, big: true, rimH: c.rimH, y: c.lavaLvl }); }
  const F = [[1250, -950, 0.8], [1700, -1500, 1.0], [2650, 300, 0.7], [3050, -1150, 1.0], [1500, 750, 0.6], [900, -400, 0.45], [1950, 900, 0.8], [3600, -300, 0.9], [2450, -1500, 0.8]];
  for (const [a, b, s] of F) { const p = toSite(a, b); out.push({ x: p.x, z: p.z, str: s, big: false }); }
  return out;
})();
export function ventsNear(x, z, r) { const out = []; for (const v of VENTS) if ((v.x - x) ** 2 + (v.z - z) ** 2 <= r * r) out.push(v); return out; }

// ---------------------------------------------------------------------------- biome fields and terrain shader aux [heat, ash, rock, glass]
const _bb = [0, 0, 0, 0];
export function biome(x, z, h, slope, out = [0, 0, 0, 0]) {
  if (h === undefined) h = heightAt(x, z);
  if (slope === undefined) { const hx = heightAt(x + 3, z) - h, hz = heightAt(x, z + 3) - h; slope = Math.min(1, Math.hypot(hx, hz) / 3); }
  const { u, v } = fromSite(x, z);
  const ld = lavaDistance(x, z);
  let heat = ld < 90 ? Math.pow(1 - clamp(ld, 0, 90) / 90, 1.0) : 0;                   // warmth: the shader splits it into crust glow (> 0.9) and underglow
  let streak = 0;
  for (let i = 0; i < CONES.length; i++) { const s = coneStreak(u, v, CONES[i]); if (s > streak) streak = s; }
  if (streak > 0.02 && streak > heat) heat = -streak;                                    // negative = flank lava flow (continuous, tapering)
  const low = 1 - smoothstep(60, 220, h);
  const ash = clamp(smoothstep(0.1, 0.7, fbm2(x / 700 + 12, z / 700 - 4, 3) + 0.25 * fbm2(x / 150, z / 150, 2)) * (0.3 + 0.7 * low) * 0.9 + 0.15 * (1 - smoothstep(30, 300, ld)), 0, 1) * (1 - 0.6 * smoothstep(0.3, 0.7, slope));
  const glass = smoothstep(0.42, 0.65, fbm2(x / 330 + 61, z / 330 + 7, 3)) * (1 - smoothstep(0.35, 0.6, slope)) * (0.5 + 0.5 * smoothstep(0, 220, ld));
  out[0] = heat; out[1] = ash; out[2] = slope; out[3] = glass;
  return out;
}
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  const h = (x === _lx && z === _lz) ? _lh : heightAt(x, z);
  biome(x, z, h, slope, _bb);
  out[0] = _bb[0]; out[1] = _bb[1];
  out[2] = clamp(smoothstep(0.33, 0.58, slope) + 0.55 * smoothstep(300, 900, h), 0, 1);
  out[3] = _bb[3];
  return out;
}

// ---------------------------------------------------------------------------- scatter: basalt spires, boulders, POIs
export function rockField(x, z) { return smoothstep(0.0, 0.6, fbm2(x / 800 + 12, z / 800 + 3, 3) * 0.5 + 0.5 + 0.25 * Math.sin(x / 377)); }
export function hoodooField(x, z) { return smoothstep(-0.25, 0.35, fbm2(x / 3800 + 5.5, z / 3800 - 8.5, 2)); }
const CLUSTERS = [[1100, 550, 8, 11, 60, 170], [1900, -1100, 7, 23, 60, 190], [2900, 500, 9, 37, 70, 220], [3500, -800, 8, 53, 60, 170], [1500, 1300, 6, 5, 50, 140], [4300, -300, 9, 67, 80, 260], [2400, 1500, 7, 41, 60, 160], [900, -1300, 6, 73, 50, 130]];
export const HERO_SPIRES = (() => {
  const out = [];
  for (const [a, b, n, seed, h0, h1] of CLUSTERS) for (let k = 0; k < n; k++) {
    const ang = hash2(seed, k, 1) * 6.283, d = Math.sqrt(hash2(seed, k, 2)) * (50 + n * 10);
    const p = toSite(a + Math.cos(ang) * d, b + Math.sin(ang) * d);
    const t = hash2(seed, k, 3);
    out.push({ x: p.x, z: p.z, variant: Math.floor(hash2(seed, k, 4) * 5), yaw: hash2(seed, k, 5) * 6.283, h: h0 + (h1 - h0) * (k === 0 ? 1 : t * t), w: 0.18 + hash2(seed, k, 6) * 0.12 });
  }
  return out;
})();
export function spiresInCell(ix, iz, S) {
  const out = [];
  const groups = 1 + Math.floor(hash2(ix, iz, 601) * 2);
  for (let g = 0; g < groups; g++) {
    const gx = (ix + hash2(ix, iz, 610 + g)) * S, gz = (iz + hash2(ix, iz, 620 + g)) * S;
    if (hash2(ix, iz, 640 + g) > 0.12 + 0.5 * hoodooField(gx, gz)) continue;
    const { u, v } = fromSite(gx, gz); if (u > 400 && u < 5200 && Math.abs(v) < 2000) continue;
    if (u < 800 && Math.abs(v) < 2100 && u > -6000) continue;
    const gh = heightAt(gx, gz); if (waterSurface(gx, gz, gh) > -1e8) continue;
    const n = 2 + Math.floor(hash2(ix, iz, 630 + g) * 6), spread = 50 + hash2(ix, iz, 650 + g) * 150;
    for (let k = 0; k < n; k++) {
      const a = hash2(ix + k * 7, iz + g, 660) * 6.2832, d = Math.sqrt(hash2(ix + k * 7, iz + g, 661)) * spread;
      const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
      const u2 = hash2(ix + k * 13, iz + g * 5, 662), big = hash2(ix + k * 13, iz + g * 5, 663) > 0.88;
      out.push({ x, z, variant: Math.floor(hash2(ix + k, iz + g, 664) * 5), yaw: hash2(ix + k, iz + g, 665) * 6.2832, h: big ? 150 + u2 * 200 : 30 + u2 * u2 * 110, w: 0.18 + hash2(ix + k, iz + g, 666) * 0.12, lean: 0 });
    }
  }
  return out;
}
export function archesInCell() { return []; }
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  const rf = rockField(cx, cz);
  const n = Math.floor(2 + 14 * rf * rf + 2 * hash2(ix, iz, 801));
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    const { u, v } = fromSite(x, z); if (u > RUNWAY.u0 - 20 && u < RUNWAY.u1 + 20 && Math.abs(v) < RUNWAY.hw + 30) continue;
    const h = heightAt(x, z); if (waterSurface(x, z, h) > -1e8) continue;
    const q = hash2(ix + k, iz + k * 3, 804);
    out.push({ x, z, r: 0.5 + Math.pow(q, 3.0) * 3.0 * (0.6 + 0.8 * rf), variant: Math.floor(hash2(ix + k, iz, 805) * 4), yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.6 + 0.4 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808) });
  }
  return out;
}
const poiCache = new Map();
const PT = ['vent', 'spire', 'vent', 'meteor', 'spire'];
const CURATED = [['vent', 1250, -950, 80], ['lavalake', 2150, -350, 330], ['spire', 3000, 500, 60], ['vent', 3050, -1150, 80]];
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  for (let i = 0; i < CURATED.length && !p; i++) {
    const [type, a, b, r] = CURATED[i], q = toSite(a, b);
    if (Math.floor(q.x / POI_CELL) === ix && Math.floor(q.z / POI_CELL) === iz) p = { type, ix, iz, x: q.x, z: q.z, r, seed: 1000 + i };
  }
  if (!p && hash2(ix, iz, 501) < 0.5) {
    const type = PT[Math.floor(hash2(ix, iz, 503) * PT.length)];
    const x = (ix + 0.15 + 0.7 * hash2(ix, iz, 502)) * POI_CELL, z = (iz + 0.15 + 0.7 * hash2(ix, iz, 504)) * POI_CELL;
    if (waterSurface(x, z) < -1e8) p = { type, ix, iz, x, z, r: type === 'spire' ? 60 : 85, seed: Math.floor(hash2(ix, iz, 505) * 1e6) };
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

// ---------------------------------------------------------------------------- hardy flora (Verdant kit silhouettes recoloured by WORLD.floraLook)
// species ids as terrain/verdant.js: 0 lance palm (charred snag), 3 giant fungus (obsidian crystal spire), 4 fungus cluster (crystal cluster),
// 5 berry shrub (charred scrub), 6 curl fern (ember fern), 8 lantern bloom (ember pod)
export const CLASS = { big: 96, small: 32, grass: 12 };
const bb = [0, 0, 0, 0];
export function plantsInCell(kind, ix, iz, S) {
  const out = [];
  if (kind === 'grass') return out;
  const area = S * S;
  const tryPlace = (sp, n, seed, accept, size) => {
    for (let k = 0; k < n; k++) {
      const x = (ix + hash2(ix * 17 + k, iz * 5 + sp, seed)) * S, z = (iz + hash2(ix * 3 + sp, iz * 19 + k, seed + 1)) * S;
      const h = heightAt(x, z);
      if (waterSurface(x, z, h) > -1e8) continue;
      const ld = lavaDistance(x, z); if (ld < 8) continue;
      const hx = heightAt(x + 2.5, z) - h, hz = heightAt(x, z + 2.5) - h; const slope = Math.min(1, Math.hypot(hx, hz) / 2.5);
      if (slope > 0.75) continue;
      biome(x, z, h, slope, bb);
      const { u, v } = fromSite(x, z);
      if (u > RUNWAY.u0 - 120 && u < RUNWAY.u1 + 160 && Math.abs(v) < RUNWAY.hw + 80) continue;       // keep the pad clear
      const r = hash2(ix * 7 + k, iz * 11 + sp, seed + 2);
      if (!accept(bb, slope, r, ld, h)) continue;
      out.push({ x, z, y: h, sp, sc: size(hash2(ix + k * 3, iz + sp * 9, seed + 3), bb), yaw: hash2(ix + k, iz * 13 + sp, seed + 4) * 6.2832, tone: hash2(ix * 29 + k, iz + sp, seed + 5), r });
    }
  };
  if (kind === 'big') {
    tryPlace(0, Math.floor(area * 0.0012), 11, (b, s, r, ld) => r < b[1] * 0.45 * smoothstep(30, 120, ld) && b[1] > 0.3, (t) => 0.7 + t * 0.6);
    tryPlace(3, Math.floor(area * 0.00025), 41, (b, s, r, ld) => r < b[3] * 0.5 * smoothstep(60, 250, ld), (t) => (t > 0.9 ? 24 + (t - 0.9) * 140 : 6 + t * 12));
  } else {
    tryPlace(4, Math.floor(area * 0.006), 51, (b, s, r, ld) => r < b[3] * 0.55 + 0.04 * smoothstep(20, 90, ld) * b[1], (t) => 0.6 + t * 1.0);
    tryPlace(5, Math.floor(area * 0.012), 61, (b, s, r, ld) => r < (0.08 + b[1] * 0.4) * smoothstep(12, 60, ld), (t) => 0.55 + t * 0.7);
    tryPlace(6, Math.floor(area * 0.02), 71, (b, s, r, ld) => r < smoothstep(10, 40, ld) * (1 - smoothstep(60, 180, ld)) * 0.8 + 0.02, (t) => 0.6 + t * 0.7);
    tryPlace(8, Math.floor(area * 0.004), 91, (b, s, r, ld) => r < smoothstep(10, 30, ld) * (1 - smoothstep(40, 120, ld)) * 0.7, (t) => 0.7 + t * 0.4);
  }
  return out;
}
