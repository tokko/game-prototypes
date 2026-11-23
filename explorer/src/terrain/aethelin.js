// Aethel INTERIOR recipe: the inner wall of the hollow world as a local heightfield (plane coordinates, y up = towards the inner sun).
// The terrain is the ordinary flat-plane heightfield; aethelinterior.js bends it into a concave sphere of radius RI around the camera
// in the vertex shader (the same trick the exteriors use for the convex horizon), so everything downstream (chunk LOD, scatter, vegetation,
// creatures, water, discoveries, physics) is reused unchanged. Plane origin (0, 0) is the foot of the gate window in the wall; plane metres are
// treated as arc length from the gate (azimuthal-equidistant chart), which the far-shell shader and the sun model use as well.
//
// Landmarks (plane metres): a walled lake basin 9 km from the gate (BASIN): a turquoise lake against a west cliff with three waterfalls,
// a flat lip ring all round (viewing ledges), a lake-shore settlement of domes (SETTLEMENT), terraced crag ranges elsewhere with forest only
// in the valleys and shrubs on the ledges.
import { fbm2, ridged2, hash2, smoothstep, mix, clamp } from '../noise.js';

export const id = 'aethelin';
export const POI_CELL = 3600;
export const RI = 36000;                 // cavity radius (m)
export const GATE_R = 2800;              // radius of the window through the shell at the gate (hole in the wall)
export const CLASS = { big: 96, small: 32, grass: 12 };

// ---- lake basin: cliff circle (radius R0 from C) round a lake whose centre is shifted west so it touches the west cliff
export const BASIN = { x: 9000, z: 3000, R0: 1500, face: 26, lipH: 150, floor: 14, lake: 8, lx: 8580, lz: 3000, lakeR: 1130 };
export const LAKE = BASIN.lake;          // water level (m); ecology / vegetation read it
export const SETTLEMENT = { x: 8800, z: 4330 };      // domed settlement on the south shore

export const WORLD = {
  name: 'Aethel interior', lush: 1, waterLevel: BASIN.lake,
  palette: {
    grassA: [0.02, 0.09, 0.06], grassB: [0.05, 0.14, 0.08], dry: [0.06, 0.11, 0.06], mud: [0.07, 0.07, 0.08], sand: [0.17, 0.2, 0.18],
    rock: [0.09, 0.10, 0.14], rockLight: [0.27, 0.31, 0.42], moss: [0.07, 0.22, 0.10],
  },
  fog: { dist: 46000, fall: 1e9, mistY: 20, mistDens: 1 / 9000, mistFall: 60, mistCol: [0.35, 0.5, 0.7] },
  water: { deep: [0.0, 0.20, 0.26], shallow: [0.03, 0.46, 0.46], foam: [0.8, 0.92, 0.95] },
  hemi: { sky: [0.16, 0.30, 0.62], ground: [0.05, 0.08, 0.14], intensity: 0.5 },
  sunScale: 0.85, exposure: 0.8, species: { total: 24 },
};
/** terrain-shader tweaks for this world (see aethelinterior.js applyLook): cool dark-grey strata, almost no tan gravel outcrops */
export const LOOK = { strata: [0.34, 0.44, 0.7], outc: 0.15 };

export const SITE = { x: 0, z: 0 };
export const toSite = (a, b) => ({ x: SITE.x + a, z: SITE.z + b });

// ---------------------------------------------------------------------------- height (wall level 0; never below about -85 so the far shell stays behind it)
function broad(x, z) {
  const wx = fbm2(x / 9000 + 3.1, z / 9000 - 1.7, 3) * 1500, wz = fbm2(x / 9000 - 8.3, z / 9000 + 5.2, 3) * 1500;
  const qx = x + wx, qz = z + wz;
  let h = fbm2(qx / 6000, qz / 6000, 4) * 70 + fbm2(qx / 1300 + 5, qz / 1300, 3) * 18 + fbm2(x / 300, z / 300, 2) * 4 + fbm2(x / 62 + 9, z / 62, 2) * 0.9;
  // terraced crag ranges: steep faces, flat treads (ledges) where shrubs and moss grow
  const mm = smoothstep(-0.1, 0.35, fbm2(x / 13000 - 4, z / 13000 + 11, 2));
  if (mm > 0) {
    let m = Math.pow(ridged2(qx / 3800, qz / 3800, 5), 1.25) * 1100;
    const T = 85, f = m / T, st = (Math.floor(f) + smoothstep(0.30, 0.70, f - Math.floor(f))) * T;
    m = mix(m, st, 0.72);
    h += mm * m + mm * fbm2(x / 130 + 3, z / 130, 2) * 14 * smoothstep(100, 400, m);
  }
  const v = Math.abs(fbm2(qx / 5200 + 20, qz / 5200 - 3, 3));
  const vm = 1 - smoothstep(0.0, 0.12, v);
  h -= 40 * vm * vm;
  return Math.max(h, -60);
}
export function heightAt(x, z) {
  const r0 = Math.hypot(x, z);
  let h = broad(x, z) * smoothstep(3200, 9500, r0);                    // open arrival meadow around the gate
  const B = BASIN, dx = x - B.x, dz = z - B.z, r = Math.hypot(dx, dz);
  if (r < B.R0 + 3300) {
    const pl = mix(B.lipH, h, smoothstep(B.R0 + 450, B.R0 + 3300, r));    // flat lip ring (viewing ledge), then the rolling crags
    if (r >= B.R0) h = pl;
    else {
      const rl = Math.hypot(x - B.lx, z - B.lz);
      const fp = mix(-38, B.floor + 1.8 * fbm2(x / 260, z / 260, 2), smoothstep(560, 1250, rl));      // lake bowl + shore meadow
      const t = clamp((B.R0 - r) / B.face, 0, 1), s = t * t * (3 - 2 * t);
      h = B.lipH + (fp - B.lipH) * s;                                      // the cliff ring the waterfalls pour over
    }
  }
  return h + 220 * smoothstep(GATE_R + 230, GATE_R + 25, r0);          // steep collar around the window (a wall for walkers; the window itself is cut out in the shader)
}
export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}
/** lake surface elevation at (x,z), or -1e9 when dry */
export function waterSurface(x, z, h) {
  if (Math.abs(x - BASIN.lx) > BASIN.lakeR + 80 || Math.abs(z - BASIN.lz) > BASIN.lakeR + 80) return -1e9;
  if (h === undefined) h = heightAt(x, z);
  return h < BASIN.lake && Math.hypot(x - BASIN.lx, z - BASIN.lz) < BASIN.lakeR + 80 ? BASIN.lake : -1e9;
}
export function waterDepth(x, z) { const h = heightAt(x, z); const w = waterSurface(x, z, h); return w > -1e8 ? Math.max(0, w - h) : 0; }
export const riverDistance = () => 1e9;
let _fa = null;
/** three waterfalls over the west cliff into the lake (TRUE plane coordinates, flow inward) */
export function fallAnchors() {
  if (_fa) return _fa;
  const B = BASIN; _fa = [];
  for (const [deg, w, hero] of [[160, 40, false], [185, 64, true], [210, 36, false]]) {
    const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    _fa.push({ x: B.x + ca * B.R0, z: B.z + sa * B.R0, dirx: -ca, dirz: -sa, lip: 0, face: B.face + 2, lipH: B.lipH, baseH: B.lake, width: w, edge: 0, vc: 0, hero });
  }
  return _fa;
}

// ---------------------------------------------------------------------------- biome fields: out = [moisture, forest, fungus, damp, ledge]
export function biome(x, z, h, slope, out = [0, 0, 0, 0, 0]) {
  if (h === undefined) h = heightAt(x, z);
  if (slope === undefined) { const hx = heightAt(x + 3, z) - h, hz = heightAt(x, z + 3) - h; slope = Math.min(1, Math.hypot(hx, hz) / 3); }
  const r = Math.hypot(x, z);
  const low = 1 - smoothstep(-25, 95, h);
  const moist = clamp(low * 0.75 + 0.45 * (fbm2(x / 700 + 5, z / 700, 2) * 0.5 + 0.5), 0, 1);
  const alt = 1 - smoothstep(110, 300, h);
  const clear = smoothstep(3600, 8500, r);
  const dS = Math.hypot(x - SETTLEMENT.x, z - SETTLEMENT.z), clearS = smoothstep(140, 330, dS);
  const gn = fbm2(x / 380 + 41, z / 380 - 7, 3) + 0.3 * fbm2(x / 90 + 5, z / 90, 2) + 0.35 * moist - 0.12;
  const rz = smoothstep(0.42, 0.62, fbm2(x / 2300 + 17, z / 2300 - 5, 3) * 0.5 + 0.5) * smoothstep(1500, 2600, Math.hypot(x - BASIN.lx, z - BASIN.lz)) * smoothstep(2500, 5500, r);      // bare rock plains
  const forest = (1 - rz) * clamp(smoothstep(0.02, 0.3, gn) * (0.55 + 0.45 * moist) * alt * (1 - smoothstep(0.25, 0.5, slope)) * clear * clearS, 0, 1);
  const fung = (1 - rz) * clamp(smoothstep(0.1, 0.5, fbm2(x / 800 + 90, z / 800 + 13, 2)) * alt * (1 - smoothstep(0.4, 0.7, slope)) * clear * clearS, 0, 1) * 0.8;
  const shoreK = (1 - smoothstep(0, 5, h - BASIN.lake)) * (1 - smoothstep(BASIN.lakeR + 60, BASIN.lakeR + 360, Math.hypot(x - BASIN.lx, z - BASIN.lz)));
  const damp = clamp(Math.max(smoothstep(0.72, 0.92, fbm2(x / 520 + 3, z / 520 + 9, 2) * 0.5 + 0.5 + 0.3 * (low - 0.5)) * (1 - smoothstep(0.2, 0.4, slope)), shoreK * 0.9), 0, 1);
  const ledge = clamp(smoothstep(0.2, 0.4, slope) * (1 - smoothstep(0.78, 0.95, slope)) * (1 - smoothstep(600, 1000, h)) * (0.35 + 0.65 * smoothstep(-0.25, 0.25, fbm2(x / 11 + 2, z / 11, 2))) + 0.55 * smoothstep(0.55, 0.8, fbm2(x / 70 + 7, z / 70, 2) * 0.5 + 0.5) * (1 - smoothstep(0.1, 0.22, slope)) * smoothstep(120, 200, h), 0, 1);
  out[0] = moist; out[1] = forest; out[2] = fung; out[3] = damp; out[4] = ledge; out[5] = rz;
  return out;
}
const _b = [0, 0, 0, 0, 0, 0];
/** terrain shader aux: [wet, shore (damp), rock, forest] */
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  const h = heightAt(x, z);
  biome(x, z, h, slope, _b);
  const rockN = fbm2(x / 140 + 7, z / 140 - 3, 3) * 0.5 + 0.5;
  const high = smoothstep(180, 420, h);
  out[0] = _b[0]; out[1] = _b[3];
  const lowK = 1 - smoothstep(120, 400, h);
  out[2] = clamp(_b[5] * 0.9 + smoothstep(0.26 + 0.3 * lowK, 0.5 + 0.3 * lowK, slope) * 1.0 + smoothstep(0.62, 0.82, rockN) * 0.3 * (1 - _b[1]) * (1 - lowK) + high * 0.55, 0, 1);
  out[3] = _b[1];
  return out;
}

// ---------------------------------------------------------------------------- scatter / POIs
export function rockField(x, z) { return smoothstep(0.1, 0.65, fbm2(x / 900 + 12, z / 900 + 3, 3) * 0.5 + 0.5 + 0.2 * Math.sin(x / 431)); }
export function spiresInCell() { return []; }
export function archesInCell() { return []; }
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  if (Math.hypot(cx, cz) < GATE_R + 500) return out;
  const rf = rockField(cx, cz);
  const n = Math.floor(2 + 16 * rf * rf + 2 * hash2(ix, iz, 801));
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    if (Math.hypot(x - SETTLEMENT.x, z - SETTLEMENT.z) < 130) continue;
    const q = hash2(ix + k, iz + k * 3, 804);
    out.push({ x, z, r: 0.4 + Math.pow(q, 3.0) * 3.2 * (0.6 + 0.8 * rf) + (hash2(ix + k, iz, 809) > 0.99 ? 2 + 4 * hash2(ix, iz + k, 810) : 0), variant: Math.floor(hash2(ix + k, iz, 805) * 4),
      yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.6 + 0.4 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808) });
  }
  return out;
}
const poiCache = new Map();
const PT = ['sunfall', 'grove', 'ring', 'bloom', 'sunfall', 'grove'];
const CURATED = [['settlement', SETTLEMENT.x, SETTLEMENT.z, 170], ['sunfall', 6500, 1500, 90], ['ring', 4200, -4300, 70], ['grove', -3500, 5200, 90], ['bloom', 12000, -3000, 80]];
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  for (let i = 0; i < CURATED.length && !p; i++) {
    const [type, a, b, r] = CURATED[i];
    if (Math.floor(a / POI_CELL) === ix && Math.floor(b / POI_CELL) === iz) p = { type, ix, iz, x: a, z: b, r, seed: 3000 + i };
  }
  if (!p && hash2(ix, iz, 501) < 0.5) {
    const type = PT[Math.floor(hash2(ix, iz, 503) * PT.length)];
    const x = (ix + 0.15 + 0.7 * hash2(ix, iz, 502)) * POI_CELL, z = (iz + 0.15 + 0.7 * hash2(ix, iz, 504)) * POI_CELL;
    if (Math.hypot(x, z) > GATE_R + 900 && Math.hypot(x - BASIN.x, z - BASIN.z) > BASIN.R0 + 600 && heightAt(x, z) > BASIN.lake + 2) p = { type, ix, iz, x, z, r: 85, seed: Math.floor(hash2(ix, iz, 505) * 1e6) };
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

// ---------------------------------------------------------------------------- vegetation placement (species ids as terrain/verdant.js: 0 lance-palm, 1 umbrella tree, 2 bottle tree, 3 fungus, 4 fungus cluster, 5 shrub, 6 fern, 7 grass, 8 lantern bloom)
const bb = [0, 0, 0, 0, 0, 0];
export function plantsInCell(kind, ix, iz, S) {
  const out = [];
  const area = S * S;
  const tryPlace = (sp, n, seed, accept, size) => {
    for (let k = 0; k < n; k++) {
      const x = (ix + hash2(ix * 17 + k, iz * 5 + sp, seed)) * S, z = (iz + hash2(ix * 3 + sp, iz * 19 + k, seed + 1)) * S;
      if (x * x + z * z < (GATE_R + 300) * (GATE_R + 300)) continue;
      const h = heightAt(x, z);
      if (h < LAKE + 0.5) continue;
      const hx = heightAt(x + 2.5, z) - h, hz = heightAt(x, z + 2.5) - h; const slope = Math.min(1, Math.hypot(hx, hz) / 2.5);
      biome(x, z, h, slope, bb);
      const r = hash2(ix * 7 + k, iz * 11 + sp, seed + 2);
      if (!accept(bb, slope, r, h, x, z)) continue;
      out.push({ x, z, y: h, sp, sc: size(hash2(ix + k * 3, iz + sp * 9, seed + 3), bb), yaw: hash2(ix + k, iz * 13 + sp, seed + 4) * 6.2832, tone: hash2(ix * 29 + k, iz + sp, seed + 5), r });
    }
  };
  if (kind === 'big') {
    tryPlace(0, Math.floor(area * 0.0026), 11, (b, s, r) => r < b[1] * b[1] * 0.5 && b[0] > 0.2, (t) => 0.8 + t * 0.9);
    tryPlace(1, Math.floor(area * 0.0075), 21, (b, s, r) => r < b[1] * (0.45 + 0.6 * b[0]), (t) => 0.85 + t * 0.85);
    tryPlace(2, Math.floor(area * 0.0050), 31, (b, s, r) => r < b[1] * 0.8 * (1.1 - 0.5 * b[0]), (t) => 0.75 + t * 0.8);
    tryPlace(3, Math.floor(area * 0.00040), 41, (b, s, r) => r < b[2] * 0.9, (t) => (t > 0.93 ? 30 + (t - 0.93) / 0.07 * 30 : t > 0.7 ? 11 + (t - 0.7) / 0.23 * 14 : 4 + t / 0.7 * 7));
  } else if (kind === 'small') {
    tryPlace(4, Math.floor(area * 0.0075), 51, (b, s, r) => r < b[2] * 0.8 + 0.03 * b[1], (t) => 0.7 + t * 1.3);
    tryPlace(5, Math.floor(area * 0.024), 61, (b, s, r) => r < (0.04 + b[1] * 0.9 + b[4] * 1.3), (t) => 0.7 + t * 0.9);
    tryPlace(6, Math.floor(area * 0.045), 71, (b, s, r) => r < (b[1] * (0.4 + 0.6 * b[0]) * 1.3 + b[4] * 1.2), (t) => 0.7 + t * 0.9);
    tryPlace(8, Math.floor(area * 0.0035), 91, (b, s, r) => r < (b[2] * 0.9 + 0.15 * b[0]) * 0.5 && b[0] > 0.5, (t) => 0.8 + t * 0.4);
  } else {
    tryPlace(7, Math.floor(area * 0.7), 81, (b, s, r) => r < (0.2 + 0.8 * Math.max(b[1], b[4], 0.3 * b[0])) * (1 - 0.85 * b[5]) * (1 - s * 1.2 * (1 - 0.75 * b[4])), (t) => 0.8 + t * 0.8);
  }
  return out;
}
