// Kestrel terrain recipe: pure functions of plane coordinates (x east, z south), all CPU-evaluable.
// Used by the chunk worker (rendering), physics, scatter placement, POIs and the orbit-view bake.
import { fbm2, ridged2, hash2, craters, smoothstep, mix, clamp } from '../noise.js';

export const id = 'kestrel';
export const POI_CELL = 3600;

// ---------------------------------------------------------------------------- points of interest
const poiCache = new Map();
const POI_TYPES = ['melt', 'arch', 'meteor', 'spire', 'ice', 'arch', 'spire', 'ice'];
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  if (hash2(ix, iz, 501) < 0.62 || (ix === HOME_CELL[0] && iz === HOME_CELL[1])) {
    const type = POI_TYPES[Math.floor(hash2(ix, iz, 503) * POI_TYPES.length)];
    p = {
      type, ix, iz,
      x: (ix + 0.15 + 0.7 * hash2(ix, iz, 502)) * POI_CELL,
      z: (iz + 0.15 + 0.7 * hash2(ix, iz, 504)) * POI_CELL,
      r: type === 'ice' ? 250 : type === 'melt' ? 95 : type === 'meteor' ? 20 : 60,
      seed: Math.floor(hash2(ix, iz, 505) * 1e6),
    };
  }
  if (ix === -2 && iz === -2) p = { type: 'arch', ix, iz, x: HERO_ARCH.x, z: HERO_ARCH.z, r: 70, seed: 1, yaw: HERO_ARCH.yaw, span: HERO_ARCH.span };
  poiCache.set(key, p);
  return p;
}
const HOME_CELL = [0, 0];
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
/** height delta + material tint of the local POI shape (each POI fits inside its own cell) */
function poiShape(x, z, out) {
  const ix = Math.floor(x / POI_CELL), iz = Math.floor(z / POI_CELL);
  const p = poiCell(ix, iz);
  out.dh = 0; out.blend = 0; out.ice = 0; out.rust = 0; out.dark = 0;
  if (!p) return;
  const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
  const R = p.r * 2.4;
  if (d2 > R * R) return;
  const d = Math.sqrt(d2) / p.r;
  if (p.type === 'ice') {
    // bowl with flat icy floor and raised rim
    const bowl = d < 1 ? -42 * (1 - d * d) * (0.7 + 0.3 * (1 - d * d)) : 0;
    const rim = 10 * Math.exp(-((d - 1.0) * (d - 1.0)) / 0.05);
    out.dh = bowl + rim; out.blend = smoothstep(2.4, 1.3, d);
    out.ice = smoothstep(1.05, 0.55, d);
  } else if (p.type === 'melt') {
    out.dh = -2.2 * smoothstep(1.3, 0.4, d) + 0.9 * Math.exp(-((d - 1.1) * (d - 1.1)) / 0.04);
    out.blend = smoothstep(2.0, 0.9, d) * 0.55; out.dark = smoothstep(1.1, 0.6, d);
  } else if (p.type === 'meteor') {
    out.dh = -3.2 * (d < 1 ? 1 - d * d : 0) + 1.1 * Math.exp(-((d - 1.0) * (d - 1.0)) / 0.08);
    out.blend = 0; out.rust = smoothstep(2.2, 0.8, d); out.dark = smoothstep(1.2, 0.3, d);
  } else {
    // arch / spire: gentle pad so the feature stands on stable ground
    out.blend = smoothstep(2.4, 1.0, d) * 0.7; out.dh = 0; out.rust = smoothstep(2.0, 0.5, d) * 0.5;
  }
}
const _ps = { dh: 0, blend: 0, ice: 0, rust: 0, dark: 0 };

// ---------------------------------------------------------------------------- height
function coreHeight(x, z) {
  const wx = fbm2(x / 9000 + 3.1, z / 9000 - 1.7, 3) * 1300;
  const wz = fbm2(x / 9000 - 8.3, z / 9000 + 5.2, 3) * 1300;
  const qx = x + wx, qz = z + wz;
  // rolling hills + regional swell
  let h = fbm2(qx / 4200, qz / 4200, 5) * 120 + fbm2(qx / 900 + 5, qz / 900, 3) * 20;
  const reg = fbm2(x / 26000 + 9.2, z / 26000 + 4.4, 3);
  h += reg * 200;
  // mountain ranges
  const mm = smoothstep(0.02, 0.5, fbm2(x / 21000 - 4, z / 21000 + 11, 2));
  if (mm > 0) h += mm * Math.pow(ridged2(qx / 6500, qz / 6500, 5), 1.5) * 1250;
  // sinuous valleys with wide floors
  const v = Math.abs(fbm2(qx / 7500 + 20, qz / 7500 - 3, 3));
  const vm = 1 - smoothstep(0.0, 0.12, v);
  h -= 150 * vm * vm * (0.6 + 0.4 * smoothstep(-0.3, 0.3, reg));
  // long natural ramps: gentle incline ending in a sharp scarp (kickers)
  const tm = smoothstep(-0.35, 0.25, fbm2(x / 12000 + 70, z / 12000 - 40, 2));
  if (tm > 0) {
    const tn = fbm2(qx / 3300 + 40, qz / 3300 + 7, 3) * 3.0 + 50;
    const f = tn - Math.floor(tn);
    const saw = f < 0.9 ? f / 0.9 : 1 - smoothstep(0.9, 1.0, f);
    h += 42 * tm * saw;
  }
  // craters, four scales
  h += craters(x, z, 7000, 650, 2900, 0.55, 11, 0.13, 0.28);
  h += craters(x, z, 1700, 85, 740, 0.62, 23, 0.16, 0.32);
  h += craters(x, z, 380, 14, 150, 0.36, 37, 0.13, 0.30);
  h += craters(x, z, 120, 3, 26, 0.22, 53, 0.1, 0.26);
  // roughness
  h += fbm2(x / 70, z / 70, 3) * 3.0 + fbm2(x / 14 + 9, z / 14, 2) * 0.35;
  return h;
}

// ---------------------------------------------------------------------------- curated landmarks near the home site
// site-relative frame: a = axis towards Tamber (east-south-east), b = perpendicular
export const SITE = { x: -5000, z: -6500 };
const AX = { x: 0.978, z: 0.208 }, BX = { x: -0.208, z: 0.978 };
export const toSite = (a, b) => ({ x: SITE.x + AX.x * a + BX.x * b, z: SITE.z + AX.z * a + BX.z * b });
const fromSite = (x, z) => { const dx = x - SITE.x, dz = z - SITE.z; return { u: dx * AX.x + dz * AX.z, v: dx * BX.x + dz * BX.z }; };
export const HERO_ARCH = (() => { const p = toSite(380, -70); return { x: p.x, z: p.z, yaw: Math.atan2(-BX.z, BX.x), span: 128, variant: 1 }; })();
/** spire clusters (a, b, count, seed, hmin, hmax) */
const CLUSTERS = [[620, -300, 8, 11, 55, 150], [980, 420, 9, 23, 60, 170], [1500, -80, 11, 37, 70, 190], [420, 330, 5, 5, 35, 85], [2300, 650, 12, 41, 90, 230], [800, -760, 7, 53, 50, 130]];
export const HERO_SPIRES = (() => {
  const out = [];
  for (const [a, b, n, seed, h0, h1] of CLUSTERS) for (let k = 0; k < n; k++) {
    const ang = hash2(seed, k, 1) * 6.283, d = Math.sqrt(hash2(seed, k, 2)) * (60 + n * 9);
    const p = toSite(a + Math.cos(ang) * d, b + Math.sin(ang) * d);
    const t = hash2(seed, k, 3);
    out.push({ x: p.x, z: p.z, variant: Math.floor(hash2(seed, k, 4) * 5), yaw: hash2(seed, k, 5) * 6.283, h: h0 + (h1 - h0) * (k === 0 ? 1 : t * t), w: 0.17 + hash2(seed, k, 6) * 0.12 });
  }
  return out;
})();
// long ramps: [u0, b0, L, W, rise, bowl depth]
const RAMPS = [[120, -260, 430, 70, 34, 30], [250, 520, 620, 90, 58, 44]];
const rampBase = RAMPS.map(() => null);
function rampBlend(x, z, h) {
  const { u, v } = fromSite(x, z);
  if (u < 40 || u > 2200 || v < -600 || v > 900) return h;
  for (let i = 0; i < RAMPS.length; i++) {
    const [u0, b0, L, W, rise, depth] = RAMPS[i];
    const uu = u - u0, vv = v - b0;
    if (uu < -80 || uu > L + 420 || Math.abs(vv) > W * 1.1) continue;
    if (rampBase[i] === null) { const p = toSite(u0, b0); rampBase[i] = coreHeight(p.x, p.z); }
    let prof;
    const Lb = 190, Lq = 12;
    if (uu < 0) prof = 0;
    else if (uu < L) prof = rise * Math.pow(uu / L, 1.35);
    else if (uu < L + Lb) prof = rise - (rise + depth) * smoothstep(0, 1, (uu - L) / Lq);
    else prof = -depth + depth * smoothstep(0, 1, (uu - L - Lb) / 170);
    const wl = 1 - smoothstep(W * 0.5, W, Math.abs(vv));
    const m = wl * smoothstep(-80, 0, uu) * (1 - smoothstep(L + Lb + 170, L + Lb + 330, uu));
    h = h + (rampBase[i] + prof - h) * m;
  }
  return h;
}
/** jagged horizon range 9..26 km out along the view axis */
function rangeBump(x, z, h) {
  const { u, v } = fromSite(x, z);
  if (u < 7000 || u > 30000 || Math.abs(v) > 26000) return h;
  const m = smoothstep(7000, 13000, u) * (1 - smoothstep(20000, 30000, u)) * (1 - smoothstep(14000, 26000, Math.abs(v)));
  const qx = x + 900 * fbm2(x / 3000, z / 3000, 2), qz = z + 900 * fbm2(x / 3000 + 9, z / 3000, 2);
  const crest = Math.pow(ridged2(qx / 2400, qz / 2400, 4), 1.2) * 1100 + ridged2(qx / 650, qz / 650, 3) * 380;
  return h + m * crest;
}

export function heightAt(x, z) {
  let h = coreHeight(x, z);
  h = rampBlend(x, z, h);
  h = rangeBump(x, z, h);
  // POI shapes (blend toward a pad then add shape)
  poiShape(x, z, _ps);
  if (_ps.blend > 0 || _ps.dh !== 0) {
    const pad = h * (1 - _ps.blend) + (_ps.blend > 0 ? padHeight(x, z) * _ps.blend : 0);
    h = pad + _ps.dh;
  }
  return h;
}
// POI pad height: terrain sampled at the POI centre (cached by cell)
const padCache = new Map();
function padHeight(x, z) {
  const ix = Math.floor(x / POI_CELL), iz = Math.floor(z / POI_CELL), key = ix * 131071 + iz;
  let v = padCache.get(key);
  if (v === undefined) {
    const p = poiCell(ix, iz);
    const sv = { ..._ps };
    // centre height without the POI itself
    const keep = poiCache.get(key); poiCache.set(key, null);
    v = heightAt(p.x, p.z); poiCache.set(key, keep);
    Object.assign(_ps, sv);
    padCache.set(key, v);
  }
  return v;
}

export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}

// ---------------------------------------------------------------------------- material tints
/** returns [rust, blueGrey, rockExposure, dust] in 0..1; ice deposits are blueGrey ~ 1 */
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  const wx = fbm2(x / 3000 + 31, z / 3000 + 2, 2) * 500;
  const qx = x + wx, qz = z + wx * 0.7;
  const regionR = smoothstep(-0.1, 0.35, fbm2(x / 5200 + 14, z / 5200 - 6, 2));
  const streakR = smoothstep(0.25, 0.62, Math.abs(fbm2(qx / 160 + 3, qz / 520 - 1, 3)));
  let rust = regionR * streakR * 0.95;
  const regionB = smoothstep(0.0, 0.45, fbm2(x / 6800 - 40, z / 6800 + 9, 2));
  const blotchB = smoothstep(0.35, 0.7, fbm2(qx / 240 + 80, qz / 300, 3) * 0.5 + 0.5 - 0.0);
  let blue = regionB * blotchB * 0.85;
  const rockN = fbm2(x / 130 + 7, z / 130 - 3, 3) * 0.5 + 0.5;
  let rock = smoothstep(0.30, 0.55, slope) * 0.9 + smoothstep(0.62, 0.8, rockN) * 0.55;
  let dust = (1 - smoothstep(0.12, 0.4, slope)) * (0.55 + 0.45 * (fbm2(x / 400, z / 400, 2) * 0.5 + 0.5));
  poiShape(x, z, _ps);
  if (_ps.ice > 0) { blue = Math.max(blue, _ps.ice); rock *= 1 - _ps.ice; dust *= 1 - 0.6 * _ps.ice; }
  if (_ps.rust > 0) rust = Math.max(rust, _ps.rust);
  if (_ps.dark > 0) { rock = Math.max(rock, _ps.dark); dust *= 1 - _ps.dark; }
  out[0] = clamp(rust, 0, 1); out[1] = clamp(blue, 0, 1); out[2] = clamp(rock, 0, 1); out[3] = clamp(dust, 0, 1);
  return out;
}

// ---------------------------------------------------------------------------- scatter rules
/** 0..1: how rocky / boulder-strewn the ground is here */
export function rockField(x, z) {
  return smoothstep(0.15, 0.7, fbm2(x / 900 + 12, z / 900 + 3, 3) * 0.5 + 0.5 + 0.15 * Math.sin(x / 311));
}
export function hoodooField(x, z) {
  return smoothstep(-0.3, 0.35, fbm2(x / 3600 + 5.5, z / 3600 - 8.5, 2));
}

/** spires in a square cell [ix,iz] of size S. Clustered hoodoo groups. */
export function spiresInCell(ix, iz, S) {
  const out = [];
  const groups = 1 + Math.floor(hash2(ix, iz, 601) * 3);
  for (let g = 0; g < groups; g++) {
    const gx = (ix + hash2(ix, iz, 610 + g)) * S, gz = (iz + hash2(ix, iz, 620 + g)) * S;
    if (hash2(ix, iz, 640 + g) > 0.25 + 0.75 * hoodooField(gx, gz)) continue;
    const n = 2 + Math.floor(hash2(ix, iz, 630 + g) * 7);
    const spread = 40 + hash2(ix, iz, 650 + g) * 160;
    for (let k = 0; k < n; k++) {
      const a = hash2(ix + k * 7, iz + g, 660) * 6.2832, d = Math.sqrt(hash2(ix + k * 7, iz + g, 661)) * spread;
      const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
      const u = hash2(ix + k * 13, iz + g * 5, 662);
      const big = hash2(ix + k * 13, iz + g * 5, 663) > 0.92;
      out.push({
        x, z, variant: Math.floor(hash2(ix + k, iz + g, 664) * 5), yaw: hash2(ix + k, iz + g, 665) * 6.2832,
        h: big ? 130 + u * 110 : 22 + u * u * 85, w: (big ? 0.15 : 0.17) + hash2(ix + k, iz + g, 666) * 0.13, lean: (hash2(ix + k, iz + g, 667) - 0.5) * 0.08,
      });
    }
  }
  return out;
}
/** natural arches in cell of size S (rare) */
export function archesInCell(ix, iz, S) {
  const out = [];
  if (hash2(ix, iz, 701) > 0.32) return out;
  out.push({
    x: (ix + 0.2 + 0.6 * hash2(ix, iz, 702)) * S, z: (iz + 0.2 + 0.6 * hash2(ix, iz, 703)) * S,
    variant: Math.floor(hash2(ix, iz, 704) * 3), yaw: hash2(ix, iz, 705) * 6.2832, span: 38 + hash2(ix, iz, 706) * 75,
  });
  return out;
}
/** boulders in a small cell of size S */
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  const rf = rockField(cx, cz);
  const n = Math.floor(3 + 90 * rf * rf + 8 * hash2(ix, iz, 801));
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    const u = hash2(ix + k, iz + k * 3, 804);
    out.push({
      x, z, r: 0.3 + Math.pow(u, 3.0) * 3.2 * (0.6 + 0.8 * rf) + (hash2(ix + k, iz, 809) > 0.985 ? 2.5 + 5 * hash2(ix, iz + k, 810) : 0), variant: Math.floor(hash2(ix + k, iz, 805) * 4),
      yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.55 + 0.45 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808),
    });
  }
  return out;
}
