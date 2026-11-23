// Aethel OUTER SHELL recipe: a pale teal-grey cratered shell pierced by a regular lattice of circular gates (huge funnel craters whose
// floor is a glowing hatch into the hollow interior). Pure functions of (x, z) shared by the terrain worker, physics, scatter and POIs.
// Gate lattice (plane metres): rows every GATE.sz (bodyview.js paints the orbit-view lattice with the same spacing)
// rows every GATE.sz, odd rows shifted half a column. The prime gate is at (0, 0); the curated landing
// runway sits on its raised rim. bodyview.js paints the same lattice on the orbit-view sphere (keep GATE in sync with the GLSL there).
import { fbm2, ridged2, hash2, craters, smoothstep, mix, clamp } from '../noise.js';

export const id = 'aethel';
export const POI_CELL = 3600;
export const GATE = { sx: 200000, sz: 200000, rimR: 27000, outerR: 60000, boreR: 7500, depth: 3400, gateR: 2800, crest: 130 };

// ---- look + atmosphere data (consumed by main.js applyWorldLook / updateSky)
export const WORLD = {
  name: 'Aethel', lush: 0, waterLevel: -1e9,
  palette: { grassA: [0.1, 0.3, 0.2], grassB: [0.2, 0.45, 0.3], dry: [0.4, 0.45, 0.3], mud: [0.2, 0.2, 0.2], sand: [0.6, 0.62, 0.55], rock: [0.20, 0.23, 0.25], rockLight: [0.40, 0.46, 0.47], moss: [0.18, 0.34, 0.28] },
  fog: { dist: 90000, fall: 7000, mistY: 0, mistDens: 0, mistFall: 40, mistCol: [0.75, 0.9, 0.9] },
  hemi: { sky: [0.55, 0.74, 0.82], ground: [0.30, 0.36, 0.35], intensity: 0.8 },
  sunScale: 0.92, exposure: 1.0, species: { total: 0 },
};
/** barren-world palette overrides for the terrain shader (verdigris shell: pale teal dust, dark glass-grey rock, oxidised copper-green streaks) */
export const LOOK = {
  dust: [0.62, 0.70, 0.67], dustDark: [0.40, 0.48, 0.47], rock: [0.21, 0.25, 0.27], rockLight: [0.43, 0.50, 0.51], rust: [0.28, 0.50, 0.44], blue: [0.74, 0.86, 0.92],
};

// ---------------------------------------------------------------------------- gates
export function nearestGate(x, z, out = { x: 0, z: 0, d: 0 }) {
  const j0 = Math.round(z / GATE.sz); let best = 1e30;
  for (let j = j0 - 1; j <= j0 + 1; j++) {
    const off = (j & 1) ? GATE.sx / 2 : 0, i = Math.round((x - off) / GATE.sx);
    const cx = i * GATE.sx + off, cz = j * GATE.sz, d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d2 < best) { best = d2; out.x = cx; out.z = cz; }
  }
  out.d = Math.sqrt(best); return out;
}
/** additive height of a gate crater at radial distance r: raised ejecta ring, terraced funnel wall, flat floor (the hatch) */
function pit(r) {
  const G = GATE;
  if (r >= G.outerR) return 0;
  let h = G.crest * Math.exp(-(((r - G.rimR - 2500) / 7000) ** 2));
  if (r < G.rimR) {
    const t = clamp((r - G.boreR) / (G.rimR - G.boreR), 0, 1);
    let bowl = -G.depth * Math.pow(1 - t, 1.9);
    const f = bowl / 140, st = Math.floor(f) + smoothstep(0.30, 0.70, f - Math.floor(f));       // shell strata: flat treads, steep risers
    bowl = mix(bowl, st * 140, 0.55);
    h += bowl;
  }
  return h;
}
export const FLOOR = pit(0);                                   // hatch level (flat apron, r < boreR)
const _g = { x: 0, z: 0, d: 0 };

// ---- curated site: runway on the rim of the prime gate (a = along the runway, towards the north; b = to the east)
export const SITE = { x: 29500, z: 0 };
const AX = { x: 0, z: -1 }, BX = { x: 1, z: 0 };
export const toSite = (a, b) => ({ x: SITE.x + AX.x * a + BX.x * b, z: SITE.z + AX.z * a + BX.z * b });
const fromSite = (x, z) => { const dx = x - SITE.x, dz = z - SITE.z; return { u: dx * AX.x + dz * AX.z, v: dx * BX.x + dz * BX.z }; };
export const PAD_H = GATE.crest;
export const RUNWAY = { u0: -1000, u1: 420, hw: 62, h: PAD_H, heading: Math.atan2(AX.x, -AX.z) };

// ---------------------------------------------------------------------------- points of interest
const poiCache = new Map();
const PT = ['ice', 'meteor', 'strata', 'ice', 'strata'];
const CURATED = [['gate', 260, -330, 90], ['ice', 900, 700, 240]];
function curatedXZ() { return CURATED.map(([type, a, b, r], i) => { const q = toSite(a, b); return { type, x: q.x, z: q.z, r, seed: 2000 + i }; }); }
const CUR = curatedXZ();
CUR.push({ type: 'strata', x: 17500, z: -2000, r: 140, seed: 2900 });          // on the funnel wall (fly low past it)
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  for (const c of CUR) if (Math.floor(c.x / POI_CELL) === ix && Math.floor(c.z / POI_CELL) === iz) { p = { type: c.type, ix, iz, x: c.x, z: c.z, r: c.r, seed: c.seed }; break; }
  if (!p && hash2(ix, iz, 501) < 0.5) {
    const type = PT[Math.floor(hash2(ix, iz, 503) * PT.length)];
    const x = (ix + 0.15 + 0.7 * hash2(ix, iz, 502)) * POI_CELL, z = (iz + 0.15 + 0.7 * hash2(ix, iz, 504)) * POI_CELL;
    if (nearestGate(x, z, { x: 0, z: 0, d: 0 }).d > GATE.outerR + 2000) p = { type, ix, iz, x, z, r: type === 'ice' ? 220 : type === 'meteor' ? 20 : 80, seed: Math.floor(hash2(ix, iz, 505) * 1e6) };
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
const _ps = { dh: 0, ice: 0, rust: 0, dark: 0 };
function poiShape(x, z, out) {
  out.dh = 0; out.ice = 0; out.rust = 0; out.dark = 0;
  const p = poiCell(Math.floor(x / POI_CELL), Math.floor(z / POI_CELL)); if (!p) return;
  const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz, R = p.r * 2.4; if (d2 > R * R) return;
  const d = Math.sqrt(d2) / p.r;
  if (p.type === 'ice') { out.dh = (d < 1 ? -16 * (1 - d * d) : 0) + 4 * Math.exp(-((d - 1) * (d - 1)) / 0.05); out.ice = smoothstep(1.05, 0.55, d); }
  else if (p.type === 'meteor') { out.dh = -2.6 * (d < 1 ? 1 - d * d : 0) + 0.9 * Math.exp(-((d - 1) * (d - 1)) / 0.08); out.rust = smoothstep(2.2, 0.8, d); out.dark = smoothstep(1.2, 0.3, d); }
  else if (p.type === 'gate') out.rust = smoothstep(2.4, 0.6, d) * 0.8;
}

// ---------------------------------------------------------------------------- height
function shellHeight(x, z) {
  const wx = fbm2(x / 8000 + 3.1, z / 8000 - 1.7, 3) * 1100, wz = fbm2(x / 8000 - 8.3, z / 8000 + 5.2, 3) * 1100;
  const qx = x + wx, qz = z + wz;
  let h = fbm2(qx / 5200, qz / 5200, 4) * 80 + fbm2(qx / 1000 + 5, qz / 1000, 3) * 16;
  h += fbm2(x / 30000 + 9.2, z / 30000 + 4.4, 3) * 140;
  const mm = smoothstep(0.0, 0.5, fbm2(x / 23000 - 4, z / 23000 + 11, 2));
  if (mm > 0) h += mm * Math.pow(ridged2(qx / 6500, qz / 6500, 4), 1.5) * 520;
  h += craters(x, z, 9000, 700, 3200, 0.45, 11, 0.12, 0.28);
  h += craters(x, z, 1900, 85, 800, 0.55, 23, 0.14, 0.30);
  h += craters(x, z, 420, 14, 160, 0.36, 37, 0.13, 0.30);
  h += craters(x, z, 130, 3, 28, 0.22, 53, 0.1, 0.26);
  h += fbm2(x / 70, z / 70, 3) * 2.6 + fbm2(x / 14 + 9, z / 14, 2) * 0.3;
  return h;
}
export function heightAt(x, z) {
  nearestGate(x, z, _g);
  let h = shellHeight(x, z);
  const { u, v } = fromSite(x, z);
  const sk = 1 - smoothstep(1500, 5500, Math.hypot(u, v));              // calm ground around the landing site
  h *= 1 - 0.88 * sk;
  const wallMask = smoothstep(GATE.boreR * 1.15, GATE.rimR * 0.85, _g.d);   // the funnel wall and the hatch apron are smooth
  h *= wallMask;
  h += pit(_g.d);
  if (u > RUNWAY.u0 - 500 && u < RUNWAY.u1 + 500 && Math.abs(v) < 500) {
    const du = Math.max(RUNWAY.u0 - u, 0, u - RUNWAY.u1), dv = Math.max(Math.abs(v) - RUNWAY.hw, 0);
    h = mix(PAD_H, h, smoothstep(0, 260, Math.hypot(du, dv)));
  }
  poiShape(x, z, _ps);
  return h + _ps.dh;
}
export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}

// ---------------------------------------------------------------------------- material tints: [rust(copper-green), ice, rockExposure, dust]
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  nearestGate(x, z, _g);
  const h = heightAt(x, z);
  const wx = fbm2(x / 3000 + 31, z / 3000 + 2, 2) * 500;
  const qx = x + wx, qz = z + wx * 0.7;
  const regionR = smoothstep(-0.1, 0.35, fbm2(x / 5200 + 14, z / 5200 - 6, 2));
  let rust = regionR * smoothstep(0.25, 0.62, Math.abs(fbm2(qx / 160 + 3, qz / 520 - 1, 3))) * 0.8;
  const regionB = smoothstep(0.05, 0.5, fbm2(x / 6800 - 40, z / 6800 + 9, 2));
  let ice = regionB * smoothstep(0.35, 0.7, fbm2(qx / 240 + 80, qz / 300, 3) * 0.5 + 0.5) * 0.85;
  const rockN = fbm2(x / 130 + 7, z / 130 - 3, 3) * 0.5 + 0.5;
  let rock = smoothstep(0.30, 0.55, slope) * 0.9 + smoothstep(0.62, 0.8, rockN) * 0.5;
  let dust = (1 - smoothstep(0.12, 0.4, slope)) * (0.55 + 0.45 * (fbm2(x / 400, z / 400, 2) * 0.5 + 0.5));
  const wall = 1 - smoothstep(GATE.rimR, GATE.rimR + 3000, _g.d);
  if (wall > 0 && _g.d > GATE.boreR * 0.9) {                         // strata banding down the funnel
    const band = 0.5 + 0.5 * Math.sin(h * 0.045 + 0.6 * fbm2(x / 900, z / 900, 2));
    rust = Math.max(rust, wall * band * 0.85); rock = Math.max(rock, wall * (0.3 + 0.5 * (1 - band))); ice *= 1 - wall;
  }
  const apron = 1 - smoothstep(GATE.boreR, GATE.boreR + 1200, _g.d);
  if (apron > 0) { rust = Math.max(rust, 0.55 * apron); ice *= 1 - apron; }
  poiShape(x, z, _ps);
  if (_ps.ice > 0) { ice = Math.max(ice, _ps.ice); rock *= 1 - _ps.ice; dust *= 1 - 0.6 * _ps.ice; }
  if (_ps.rust > 0) rust = Math.max(rust, _ps.rust);
  if (_ps.dark > 0) { rock = Math.max(rock, _ps.dark); dust *= 1 - _ps.dark; }
  out[0] = clamp(rust, 0, 1); out[1] = clamp(ice, 0, 1); out[2] = clamp(rock, 0, 1); out[3] = clamp(dust, 0, 1);
  return out;
}

// ---------------------------------------------------------------------------- scatter rules (boulders only: the shell is bare)
export function rockField(x, z) { return smoothstep(0.15, 0.7, fbm2(x / 900 + 12, z / 900 + 3, 3) * 0.5 + 0.5 + 0.15 * Math.sin(x / 311)); }
export function spiresInCell() { return []; }
export function archesInCell() { return []; }
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  const rf = rockField(cx, cz);
  const gd = nearestGate(cx, cz, { x: 0, z: 0, d: 0 }).d; if (gd < GATE.boreR + 400) return out;
  const n = Math.floor(2 + 40 * rf * rf + 5 * hash2(ix, iz, 801));
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    const { u, v } = fromSite(x, z); if (u > RUNWAY.u0 - 20 && u < RUNWAY.u1 + 20 && Math.abs(v) < RUNWAY.hw + 30) continue;
    const q = hash2(ix + k, iz + k * 3, 804);
    out.push({ x, z, r: 0.35 + Math.pow(q, 3.0) * 3.0 * (0.6 + 0.8 * rf) + (hash2(ix + k, iz, 809) > 0.985 ? 2.5 + 5 * hash2(ix, iz + k, 810) : 0), variant: Math.floor(hash2(ix + k, iz, 805) * 4),
      yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.55 + 0.45 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808) });
  }
  return out;
}
