// Glaciera terrain recipe (frozen ocean moon): pure functions of plane coordinates (x east, z south), CPU-evaluable and
// three.js-free (the chunk worker imports this file). Used by the worker (render), physics, scatter, POIs and the orbit bake.
//   - frozen-ocean flats: jittered ice plates separated by cracks, some cracks widened into dark open-water leads
//   - ice-sheet highlands: pressure ridges (double crests), crevasse fields, snow drifts, a distant ice range
//   - cryo-geysers and cryovolcano cones (plumes are drawn by src/iceworld.js), crystal spire groves, landing pads
// Material channels (vAux in the ice shader): [snow, ice, lead, pad]
//   ice: < 0.5 stained / regolith-rich ice, 0.56 clean ice, up to 1 deep blue exposure (crack walls, ridge faces)
//   lead: dark open water / black ice. pad: normalised distance from the nearest pad centre (2 = no pad).
import { fbm2, ridged2, simplex2, hash2, smoothstep, mix, clamp } from '../noise.js';
import { POI_TYPES } from '../destinations.js';

export const id = 'glaciera';
export const ICE = true;                 // switches on the ice terrain material, ice props, geysers and the surface-physics tweak
export const BAKE = true;                // orbit view uses the baked map of this recipe
export const POI_CELL = 3600;
export const ENV = 0.85;                 // terrain environment-map intensity (ice mirrors the sky and Tamber)
// look of the surface scene (read by main.js: exposure, hemisphere light, Tamber-shine fill)
export const LOOK = { exposure: 1.0, hemi: { sky: [0.36, 0.52, 0.95], ground: [0.45, 0.58, 0.85], intensity: 0.62 }, fill: { intensity: 0.7, color: [0.55, 0.7, 1.0] }, sunScale: 1.0 };
// tunable surface physics (bike + on foot): 1 = Kestrel dirt, lower = more slippery
export const PHYS = { grip: 0.34, snowGrip: 0.52, leadGrip: 0.12 };

Object.assign(POI_TYPES, {
  geyser:  { name: 'Cryo-geyser vent', color: 0xbfe8ff, text: 'A fissure venting water vapour and ice grains in a ballistic fan. With no air to slow it the plume climbs over a hundred metres before the grains fall back as fresh frost. The vent hisses in the suit sensors.' },
  cryo:    { name: 'Cryovolcano', color: 0x8fd0ff, text: 'A broad cone of layered ice, built from a billion eruptions of slush. The caldera still breathes: a tall, steady plume of vapour leans over the plain, lit white by the sun and blue by Tamber.' },
  pad:     { name: 'Survey landing pad', color: 0xffb060, text: 'A scraped, level ice apron with a faded bullseye and a dead guidance beacon. Whoever laid it out wanted a lander to come down softly and be found again. The ice here is clean and cheap to mine.' },
  lead:    { name: 'Open-water lead', color: 0x3d7bff, text: 'A black crack where the buried ocean breaks through the sheet and holds a skin of glassy ice. It is far slicker than the surrounding frost, and it hums quietly as the tide of the ocean below flexes the plate.' },
  crystal: { name: 'Crystal spire grove', color: 0xa0f0ff, text: 'Blue crystal pillars taller than a cathedral, grown in a lattice that shows no sign of erosion. They catch the light of Tamber and hold it for a long time after the sun has moved on.' },
});

// ---------------------------------------------------------------------------- site and curated landmarks
// site-relative frame: a = axis towards Tamber (east, slightly south), b = perpendicular (right of the view)
export const SITE = { x: 1200000, z: -200000 };
const AX = { x: 0.996, z: 0.087 }, BX = { x: -0.087, z: 0.996 };
export const toSite = (a, b) => ({ x: SITE.x + AX.x * a + BX.x * b, z: SITE.z + AX.z * a + BX.z * b });
const fromSite = (x, z) => { const dx = x - SITE.x, dz = z - SITE.z; return { u: dx * AX.x + dz * AX.z, v: dx * BX.x + dz * BX.z }; };
let band = 0;
/** called by the chunk worker: grid step of the chunk being built (fine cracks and crevasses fade out on coarse LODs) */
export function setBand(step) { band = step; }

// ---------------------------------------------------------------------------- shared field evaluation
const WIND = 0.55, WC = Math.cos(WIND), WS = Math.sin(WIND);
const CS = 150;      // ice plate size (m)
const F = { qx: 0, qz: 0, fl: 0, ha: 1, open: 1, rr: 0, ridge: 0, rm: 0, ld: 0, e: 0, ck: 0, major: false, lead: 0, pOff: 0, cn: 1, cm: 0, hw: 0.03, drift: 0, sm: 0, ix: 0, iz: 0 };
const _pl = { e: 0, ix: 0, iz: 0, px: 0, pz: 0, eh: 0 };
function plates(x, z, o) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  let d1 = 1e9, d2 = 1e9, a1x = 0, a1z = 0, a2x = 0, a2z = 0, p1x = 0, p1z = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cx + dx, iz = cz + dz;
    const px = (ix + 0.14 + 0.72 * hash2(ix, iz, 901)) * CS, pz = (iz + 0.14 + 0.72 * hash2(ix, iz, 902)) * CS;
    const d = Math.hypot(x - px, z - pz);
    if (d < d1) { d2 = d1; a2x = a1x; a2z = a1z; d1 = d; a1x = ix; a1z = iz; p1x = px; p1z = pz; }
    else if (d < d2) { d2 = d; a2x = ix; a2z = iz; }
  }
  o.e = (d2 - d1) * 0.5; o.ix = a1x; o.iz = a1z; o.px = p1x; o.pz = p1z;
  o.eh = hash2(a1x + a2x, a1z + a2z, 905);       // symmetric edge hash: both plates agree on the crack's character
}

function field(x, z) {
  const f = F;
  f.qx = x + 600 * fbm2(x / 7000 + 3.1, z / 7000 - 1.7, 2); f.qz = z + 600 * fbm2(x / 7000 - 8.3, z / 7000 + 5.2, 2);
  f.fl = smoothstep(-0.05, 0.3, fbm2(x / 11000 + 3.3, z / 11000 - 7.7, 2));        // frozen-ocean flats (1) vs ice-sheet highlands (0)
  f.ha = 1 - 0.85 * f.fl;
  f.open = smoothstep(1100, 2600, Math.hypot(x - SITE.x, z - SITE.z));            // calm ground around the home pad
  // pressure ridges: double-crested welts of rubble along ridged noise lines
  const rr = 1 - Math.abs(fbm2(f.qx / 1100 + 13, f.qz / 1100 - 4, 2));
  f.rr = rr; f.ridge = smoothstep(0.86, 1.0, rr);
  f.rm = 0.25 + 0.75 * smoothstep(-0.2, 0.4, fbm2(x / 8000 + 55, z / 8000 + 2, 2));
  // ice plates + cracks + leads
  plates(x, z, _pl);
  const eh = _pl.eh;
  f.ix = _pl.ix; f.iz = _pl.iz; f.e = _pl.e;
  f.ld = smoothstep(0.15, 0.5, fbm2(x / 6000 + 90, z / 6000 - 20, 2)) * f.fl * (0.3 + 0.7 * f.open);
  f.major = eh < 0.2;
  let wC = f.major ? 5 + 14 * eh : 2.4 + 2.6 * eh;
  const leadEdge = eh < 0.55;
  wC += f.ld * (leadEdge ? 8 + 40 * (0.55 - eh) : 0);
  f.wC = wC;
  const wcell = f.ld > 0.4 && hash2(_pl.ix, _pl.iz, 907) < 0.2;                    // whole plate sunk: an open-water pond
  f.wcell = wcell;
  f.ck = 1 - smoothstep(wC * 0.55, wC, _pl.e);
  f.lead = wcell ? 1 : (leadEdge ? clamp(f.ld * 2.2, 0, 1) * f.ck : 0);
  f.pOff = wcell ? -2.8 : (hash2(_pl.ix, _pl.iz, 903) - 0.5) * 2.6 + (hash2(_pl.ix, _pl.iz, 904) - 0.5) * 0.024 * (x - _pl.px) + (hash2(_pl.ix, _pl.iz, 906) - 0.5) * 0.024 * (z - _pl.pz);
  // crevasse fields (highlands only, away from the pad)
  f.cm = 0; f.cn = 1;
  const cb = 1 - smoothstep(2.5, 8, band);
  if (cb > 0) {
    f.cm = smoothstep(-0.12, 0.22, fbm2(x / 6500 + 50, z / 6500 + 8, 2)) * f.open * f.ha * cb;
    if (f.cm > 0.01) { f.cn = Math.abs(fbm2(f.qx / 480 + 31, f.qz / 480 - 9, 2)); f.hw = 0.026 + 0.008 * simplex2(x / 230, z / 230); }
  }
  // wind-scoured snow: elongated drifts along WIND
  const u = x * WC + z * WS, v = -x * WS + z * WC;
  f.sm = smoothstep(-0.25, 0.25, fbm2(x / 4200 + 71, z / 4200 - 12, 3)) * (1 - 0.5 * f.fl);
  f.drift = smoothstep(0.38, 0.85, fbm2(u / 190, v / 40, 3) * 0.5 + 0.5);
  return f;
}

/** 0..1 serac-field strength at a point (debug / queries) */
export function seracField(x, z) { return seracMask(x, z, field(x, z)); }
/** 0..1 crevasse-field strength at a point (debug / hazard queries) */
export function crevasseField(x, z) { return field(x, z).cm; }

/** curated pressure ridge in the middle distance of the home view */
function heroRidge(x, z) {
  const { u, v } = fromSite(x, z);
  if (u < 300 || u > 1300 || v < -1200 || v > 1400) return 0;
  const cu = 620 + 150 * Math.sin(v / 310) + 60 * Math.sin(v / 97 + 1);
  const du = (u - cu) / (48 + 14 * Math.sin(v / 210));
  const taper = smoothstep(-1200, -600, v) * (1 - smoothstep(700, 1400, v)) * smoothstep(70, 240, Math.abs(v + 350));   // gate: a smooth pass at b = -350 (bike route)
  const jag = 1 + 0.28 * fbm2(v / 85 + 3, u / 120, 2);
  return taper * jag * (34 * Math.exp(-du * du) - 12 * Math.exp(-((du * 4.2) ** 2)));
}
function heroRidgeMask(x, z) {
  const { u, v } = fromSite(x, z);
  if (u < 300 || u > 1300 || v < -1200 || v > 1400) return 0;
  const cu = 620 + 150 * Math.sin(v / 310) + 60 * Math.sin(v / 97 + 1), du = (u - cu) / (48 + 14 * Math.sin(v / 210));
  return smoothstep(-1200, -600, v) * (1 - smoothstep(700, 1400, v)) * smoothstep(70, 240, Math.abs(v + 350)) * Math.exp(-((du / 2.1) ** 2));
}

// ---- serac fields: broken, blocky ice with sharp edges (two rotated cell scales: big tilted towers and small rubble blocks)
const _cv = { d1: 0, d2: 0, ix: 0, iz: 0 };
function cellular(x, z, S, seed) {
  const cx = Math.floor(x / S), cz = Math.floor(z / S);
  let d1 = 1e9, d2 = 1e9, i1 = 0, j1 = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cx + dx, iz = cz + dz;
    const d = Math.hypot(x - (ix + 0.1 + 0.8 * hash2(ix, iz, seed)) * S, z - (iz + 0.1 + 0.8 * hash2(ix, iz, seed + 1)) * S);
    if (d < d1) { d2 = d1; d1 = d; i1 = ix; j1 = iz; } else if (d < d2) d2 = d;
  }
  _cv.d1 = d1; _cv.d2 = d2; _cv.ix = i1; _cv.iz = j1;
}
/** 0..1 serac strength: highland zones, pressure-ridge crests, and the wall of the curated hero ridge (calm near the pad) */
function seracMask(x, z, f) {
  const zone = smoothstep(-0.05, 0.35, fbm2(x / 3200 + 17, z / 3200 - 23, 2)) * (0.3 + 0.7 * (1 - f.fl)) * f.open;
  const crest = smoothstep(0.9, 0.985, f.rr) * f.open * (0.5 + 0.5 * f.ha);
  return clamp(zone + crest * 0.9 + heroRidgeMask(x, z), 0, 1);
}
const SC_ = 0.825, SS_ = 0.565;
function seracH(x, z, m) {
  const k = 1 - smoothstep(4, 12, band);
  if (m < 0.02 || k <= 0) return 0;
  const rx = x * SC_ - z * SS_, rz = x * SS_ + z * SC_;
  cellular(rx, rz, 44, 1301);
  const e1 = (_cv.d2 - _cv.d1) * 0.5, hc = Math.pow(hash2(_cv.ix, _cv.iz, 1302), 1.5) * 24 * (0.55 + 0.45 * smoothstep(0.3, 3, e1));
  cellular(rx + 91, rz - 37, 17, 1311);
  const e2 = (_cv.d2 - _cv.d1) * 0.5, hf = Math.pow(hash2(_cv.ix, _cv.iz, 1312), 1.4) * 9 * smoothstep(0.2, 1.8, e2);
  return k * m * (hc + hf);
}

function baseHeight(x, z) {
  const f = field(x, z);
  const qx = f.qx, qz = f.qz;
  let h = (fbm2(qx / 5200, qz / 5200, 4) * 55 + fbm2(qx / 1500 + 5, qz / 1500, 3) * 9) * f.ha + fbm2(x / 30000 + 9, z / 30000 + 4, 2) * 40;
  // distant ice range (rare, never near the pad)
  const mm = smoothstep(0.08, 0.5, fbm2(x / 24000 + 14, z / 24000 - 6, 2)) * smoothstep(5000, 9000, Math.hypot(x - SITE.x, z - SITE.z)) * f.ha;
  if (mm > 0) h += mm * Math.pow(ridged2(qx / 5200, qz / 5200, 4), 1.5) * 560;
  const calm = 0.35 + 0.65 * f.open;
  // pressure ridges
  const crest = smoothstep(0.975, 1.0, f.rr);
  const ridgeN = smoothstep(0.935, 0.992, f.rr);
  h += (f.ridge * (3 + 8 * f.rm) + ridgeN * (9 + 16 * f.rm) - crest * (2.5 + 4 * f.rm)) * calm * (0.4 + 0.6 * f.ha);
  const rr2 = 1 - Math.abs(fbm2(qx / 260 + 7, qz / 260 - 11, 2));
  h += (smoothstep(0.93, 1, rr2) * 4 + fbm2(x / 9, z / 9, 2) * 1.2) * f.ridge * calm;
  const sm = seracMask(x, z, f);
  h += seracH(x, z, sm);
  h += heroRidge(x, z);
  // plates and cracks (full strength on the flats, hairline on the highlands)
  const pa = 0.15 + 0.85 * f.fl;
  const dep = f.major ? 2.2 : 0.5, deep = f.ld > 0.15 && f.wC > 8 ? 3.2 : dep;
  h += pa * (f.pOff * 0.5 - deep * f.ck);
  h += pa * (f.major ? 1.1 : 0.3) * Math.exp(-(((f.e - f.wC * 1.15) / (f.wC * 0.5 + 0.4)) ** 2));
  // crevasses
  if (f.cm > 0.01 && f.cn < f.hw * 3) {
    const t = f.cn / f.hw;
    h -= f.cm * 9.0 * Math.exp(-t * t * 1.5);
    h += f.cm * 0.9 * Math.exp(-(((t - 2.0) / 0.55) ** 2));
  }
  // snow drifts (+ wedges on the lee of ridges), sastrugi roughness
  h += f.sm * (f.drift * 1.2 + smoothstep(0.7, 0.95, f.rr) * 3.2 * calm * f.ha) * (1 - f.ck) * (1 - 0.8 * sm);
  h += (fbm2(x / 48 + 3, z / 48, 2) * 0.28 + fbm2(x / 13, z / 13, 2) * 0.07) * (1 - f.ck);
  return h;
}

// ---------------------------------------------------------------------------- features: pads, geysers, cryovolcano, leads, crystal groves
const HEROES = [];
const addHero = (type, a, b, r, extra) => { const p = toSite(a, b); HEROES.push({ type, ix: 7000 + HEROES.length, iz: 7000, x: p.x, z: p.z, r, seed: 1000 + HEROES.length, hero: true, ...extra }); };
addHero('pad', 0, 0, 52);
addHero('geyser', 560, -230, 38, { plume: 1.4 });
addHero('lead', 300, 470, 120);
addHero('cryo', 2500, 850, 260, { plume: 2.6 });
addHero('crystal', 980, -60, 130);
addHero('geyser', 1500, 520, 40, { plume: 1.0 });

const poiCache = new Map();
const POI_KINDS = ['geyser', 'geyser', 'crystal', 'pad', 'lead', 'cryo'];
const POI_WEIGHTS = [0.18, 0.34, 0.56, 0.74, 0.92, 1.0];
const POI_R = { geyser: 40, crystal: 130, pad: 52, lead: 110, cryo: 260 };
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  if (hash2(ix, iz, 501) < 0.6) {
    const t = hash2(ix, iz, 503); let k = 0; while (POI_WEIGHTS[k] < t) k++;
    const type = POI_KINDS[k];
    p = { type, ix, iz, x: (ix + 0.2 + 0.6 * hash2(ix, iz, 502)) * POI_CELL, z: (iz + 0.2 + 0.6 * hash2(ix, iz, 504)) * POI_CELL, r: POI_R[type], seed: Math.floor(hash2(ix, iz, 505) * 1e6), plume: type === 'cryo' ? 2.2 : 0.7 + hash2(ix, iz, 506) };
    for (const h of HEROES) if (Math.hypot(h.x - p.x, h.z - p.z) < h.r * 2.4 + p.r * 2.4 + 400) { p = null; break; }
    if (p && p.type === 'cryo' && Math.hypot(p.x - SITE.x, p.z - SITE.z) < 7000) p = null;
    if (p && p.type === 'pad' && !padOk(p)) p = null;
  }
  poiCache.set(key, p);
  return p;
}
/** pads only where the ground is plain: no ridge, crevasse, lead or plate edge within the apron */
function padOk(p) {
  for (let k = 0; k < 9; k++) {
    const a = k * 0.785, d = k === 8 ? 0 : 90;
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    const f = field(x, z);
    if (f.lead > 0.01 || f.ridge > 0.12 || f.cm > 0.05 && f.cn < 0.12 || f.ld > 0.2 || smoothstep(0.7, 0.95, f.rr) * f.sm > 0.1) return false;
  }
  return true;
}
export function poisNear(x, z, radius) {
  const out = [];
  for (const h of HEROES) if ((h.x - x) ** 2 + (h.z - z) ** 2 <= (radius + h.r) ** 2) out.push(h);
  const i0 = Math.floor((x - radius) / POI_CELL), i1 = Math.floor((x + radius) / POI_CELL);
  const j0 = Math.floor((z - radius) / POI_CELL), j1 = Math.floor((z + radius) / POI_CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const p = poiCell(i, j);
    if (p && (p.x - x) ** 2 + (p.z - z) ** 2 <= (radius + p.r) ** 2) out.push(p);
  }
  return out;
}
const _near = [];
function nearFeatures(x, z) {
  _near.length = 0;
  for (const h of HEROES) { const R = h.r * 2.5; if ((h.x - x) ** 2 + (h.z - z) ** 2 < R * R) _near.push(h); }
  const p = poiCell(Math.floor(x / POI_CELL), Math.floor(z / POI_CELL));
  if (p) { const R = p.r * 2.5; if ((p.x - x) ** 2 + (p.z - z) ** 2 < R * R) _near.push(p); }
  return _near;
}
const _fs = { dh: 0, blend: 0, snow: 0, lead: 0, pad: 2, dirt: 0, blue: 0 };
function featureShape(p, x, z, o) {
  const dx = x - p.x, dz = z - p.z, d = Math.sqrt(dx * dx + dz * dz) / p.r;
  o.dh = 0; o.blend = 0; o.snow = 0; o.lead = 0; o.pad = 2; o.dirt = 0; o.blue = 0;
  if (p.type === 'pad') {
    o.blend = 1 - smoothstep(1.1, 2.3, d);
    if (d < 1.3) o.pad = d;
    o.snow = 0; o.blue = 0;
  } else if (p.type === 'geyser') {
    o.dh = 6 * Math.exp(-d * d / 0.9) - 3.2 * Math.exp(-((d / 0.13) ** 2));
    o.blend = smoothstep(2.4, 0.6, d) * 0.7; o.snow = smoothstep(2.4, 0.9, d); o.dirt = smoothstep(0.35, 0.0, d);
  } else if (p.type === 'cryo') {
    const k = Math.max(0, 1 - d / 1.5);
    o.dh = 120 * Math.pow(k, 1.7) - 34 * smoothstep(0.17, 0.0, d) + 3 * fbm2(x / 70, z / 70, 2) * k;
    o.blend = smoothstep(2.4, 1.2, d); o.snow = smoothstep(2.4, 0.6, d) * 0.9; o.blue = smoothstep(0.5, 0.15, d) * 0.5;
  } else if (p.type === 'lead') {
    const rr = d * (1 + 0.28 * simplex2(x / 55 + p.seed % 13, z / 55));
    const inside = 1 - smoothstep(0.82, 1.0, rr);
    o.dh = -3.2 * inside + 0.9 * Math.exp(-(((rr - 1.06) / 0.1) ** 2));
    o.blend = smoothstep(1.9, 1.0, d) * 0.85; o.lead = inside; o.blue = smoothstep(1.4, 0.9, rr) * 0.6;
  } else {      // crystal grove: gently levelled ground, blue-white frost
    o.blend = smoothstep(2.4, 1.0, d) * 0.6; o.blue = smoothstep(1.8, 0.4, d) * 0.5; o.snow = smoothstep(2.4, 0.8, d) * 0.4;
  }
}
function featureBase(p) { if (p.base === undefined) { p.base = 0; p.base = baseHeight(p.x, p.z); } return p.base; }

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const nf = nearFeatures(x, z);
  for (let i = 0; i < nf.length; i++) {
    const p = nf[i]; featureShape(p, x, z, _fs);
    if (_fs.blend > 0 || _fs.dh !== 0) h = mix(h, featureBase(p), _fs.blend) + _fs.dh;
  }
  return h;
}

export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}

// ---------------------------------------------------------------------------- material channels
/** returns [snow, ice, lead, pad] in 0..1 (pad: distance in pad radii, 2 = none) */
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  const f = field(x, z);
  const calm = 0.35 + 0.65 * f.open;
  const sera = seracMask(x, z, f);
  const crev = f.cm > 0.01 && f.cn < f.hw * 3 ? f.cm * Math.exp(-((f.cn / f.hw) ** 2) * 0.5) : 0;
  let snow = f.sm * (0.5 + 0.7 * (f.drift - 0.4) + 0.5 * smoothstep(0.7, 0.95, f.rr)) * (1 - f.ck) * (1 - smoothstep(0.3, 0.55, slope)) * (1 - crev) * (1 - 0.6 * sera);
  const stain = smoothstep(0.35, 0.68, fbm2(x / 2600 + 41, z / 2600 + 13, 3)) * smoothstep(0.1, 0.5, 1 - f.fl * 0.4);
  let blue = Math.max(smoothstep(0.22, 0.6, slope), f.ck * (f.major ? 1 : 0.55) * (0.3 + 0.7 * f.fl), f.ridge * 0.5 * calm);
  blue = Math.max(blue, crev, sera * 0.85);
  let lead = f.lead;
  let pad = 2, dirt = 0;
  const nf = nearFeatures(x, z);
  for (let i = 0; i < nf.length; i++) {
    const p = nf[i]; featureShape(p, x, z, _fs);
    snow = mix(snow, _fs.snow, _fs.snow > 0 ? Math.min(1, _fs.snow) * (p.type === 'pad' ? 0 : 0.8) : 0);
    if (p.type === 'pad') { if (_fs.blend > 0) { snow *= 1 - _fs.blend; blue *= 1 - _fs.blend; lead *= 1 - _fs.blend; } if (_fs.pad < pad) pad = _fs.pad; }
    blue = Math.max(blue, _fs.blue); lead = Math.max(lead, _fs.lead); dirt = Math.max(dirt, _fs.dirt);
  }
  const ice = clamp(0.56 + 0.44 * blue - 0.5 * stain * (1 - blue) - 0.6 * dirt, 0, 1);
  out[0] = clamp(snow, 0, 1); out[1] = ice; out[2] = clamp(lead, 0, 1); out[3] = pad;
  return out;
}
/** orbit-map channels (bodyview bake: G -> bright frost, B -> stained ice, A -> blue ice): planet-scale lineae, snowfields, ocean flats */
export function bakeMaterial(x, z, slope, out = [0, 0, 0, 0]) {
  const l1 = 1 - Math.abs(fbm2(x / 52000 + 3, z / 52000 - 9, 2)), l2 = 1 - Math.abs(fbm2(x / 21000 - 5, z / 21000 + 2, 2));
  const lin = Math.max(smoothstep(0.92, 0.985, l1), smoothstep(0.95, 0.99, l2) * 0.85);
  const fl = smoothstep(-0.05, 0.3, fbm2(x / 11000 + 3.3, z / 11000 - 7.7, 2));
  out[0] = 0.15 + 0.7 * smoothstep(-0.3, 0.45, fbm2(x / 9000 + 71, z / 9000 - 12, 3)) * (1 - 0.5 * fl);
  out[1] = 0.85 * smoothstep(0.35, 0.68, fbm2(x / 26000 + 41, z / 26000 + 13, 3));
  out[2] = Math.min(1, lin + 0.35 * fl);
  return out;
}
/** friction multiplier at a point (physics): slick ice, a little grip in snow, nearly none on lead ice */
export function gripAt(x, z) {
  const m = materialAt(x, z, 0.12, _gm);
  let g = PHYS.grip + (PHYS.snowGrip - PHYS.grip) * m[0];
  g = mix(g, PHYS.leadGrip, m[2]);
  if (m[3] < 1.2) g = Math.max(g, 0.5);       // scraped pad: grippy enough to walk
  return g;
}
const _gm = [0, 0, 0, 0];

// ---------------------------------------------------------------------------- scatter rules
/** 0..1: ice rubble density (pressure ridges and big cracks) */
export function rockField(x, z) {
  const f = field(x, z);
  const hr = (() => { const { u, v } = fromSite(x, z); return u > 300 && u < 1300 && v > -1200 && v < 1400 ? Math.exp(-(((u - (620 + 150 * Math.sin(v / 310))) / 150) ** 2)) : 0; })();
  return clamp(f.ridge * 1.1 * (0.4 + 0.6 * f.ha) + (f.major ? f.ck * 0.5 : 0) + hr * 0.9 + 0.5 * seracMask(x, z, f) + 0.03, 0, 1);
}
/** 0..1: frost-shard density (small crystal clusters on the ground) */
export function frostAt(x, z) {
  const f = field(x, z), r = f.ridge, ck = f.ck, v = 0.12 + 0.5 * smoothstep(-0.1, 0.5, fbm2(x / 520 + 8, z / 520 - 2, 2)) + r * 0.5 + ck * 0.3;
  const m = materialAt(x, z, 0.1, _gm);
  return clamp(v, 0, 1) * (1 - m[2]) * (m[3] < 1.35 ? 0 : 1);
}
export function crystalField(x, z) { return smoothstep(0.0, 0.5, fbm2(x / 5200 + 8, z / 5200 - 3, 2)) * (0.5 + 0.5 * (1 - 0.7 * field(x, z).fl)); }

/** crystal pillars (the spire slot of the scatter system): clustered groups in crystal country, big groves at 'crystal' POIs */
export const HERO_SPIRES = (() => {
  const out = [], g = HEROES.find((h) => h.type === 'crystal');
  const CLUSTERS = [[760, -420, 6, 11, 70, 150], [1300, 420, 7, 23, 60, 170], [1750, -150, 8, 37, 80, 190], [560, 380, 4, 5, 45, 105], [1100, -950, 6, 53, 60, 140]];
  for (const [a, b, n, seed, h0, h1] of CLUSTERS) for (let k = 0; k < n; k++) {
    const ang = hash2(seed, k, 1) * 6.283, d = Math.sqrt(hash2(seed, k, 2)) * (60 + n * 9);
    const p = toSite(a + Math.cos(ang) * d, b + Math.sin(ang) * d), t = hash2(seed, k, 3);
    out.push({ x: p.x, z: p.z, variant: Math.floor(hash2(seed, k, 4) * 5), yaw: hash2(seed, k, 5) * 6.283, h: h0 + (h1 - h0) * (k === 0 ? 1 : t * t), w: 0.34 + hash2(seed, k, 6) * 0.2 });
  }
  for (let k = 0; k < 12; k++) {
    const ang = hash2(77, k, 1) * 6.283, d = Math.sqrt(hash2(77, k, 2)) * 120;
    out.push({ x: g.x + Math.cos(ang) * d, z: g.z + Math.sin(ang) * d, variant: Math.floor(hash2(77, k, 4) * 5), yaw: hash2(77, k, 5) * 6.283, h: 45 + hash2(77, k, 3) ** 2 * 105, w: 0.36 + hash2(77, k, 6) * 0.18 });
  }
  return out;
})();
export function spiresInCell(ix, iz, S) {
  const out = [];
  const groups = 1 + Math.floor(hash2(ix, iz, 601) * 3);
  for (let g = 0; g < groups; g++) {
    const gx = (ix + hash2(ix, iz, 610 + g)) * S, gz = (iz + hash2(ix, iz, 620 + g)) * S;
    if (Math.hypot(gx - SITE.x, gz - SITE.z) < 2800) continue;
    if (hash2(ix, iz, 640 + g) > 0.12 + 0.7 * crystalField(gx, gz)) continue;
    const n = 2 + Math.floor(hash2(ix, iz, 630 + g) * 4);
    const spread = 30 + hash2(ix, iz, 650 + g) * 110;
    for (let k = 0; k < n; k++) {
      const a = hash2(ix + k * 7, iz + g, 660) * 6.2832, d = Math.sqrt(hash2(ix + k * 7, iz + g, 661)) * spread;
      const u = hash2(ix + k * 13, iz + g * 5, 662), big = hash2(ix + k * 13, iz + g * 5, 663) > 0.93;
      out.push({ x: gx + Math.cos(a) * d, z: gz + Math.sin(a) * d, variant: Math.floor(hash2(ix + k, iz + g, 664) * 5), yaw: hash2(ix + k, iz + g, 665) * 6.2832, h: big ? 120 + u * 80 : 30 + u * u * 90, w: 0.32 + hash2(ix + k, iz + g, 666) * 0.2, lean: 0 });
    }
  }
  // crystal groves
  for (const p of poisNear((ix + 0.5) * S, (iz + 0.5) * S, S * 0.75)) {
    if (p.type !== 'crystal' || p.hero || Math.floor(p.x / S) !== ix || Math.floor(p.z / S) !== iz) continue;
    for (let k = 0; k < 11; k++) {
      const a = hash2(p.seed, k, 1) * 6.283, d = Math.sqrt(hash2(p.seed, k, 2)) * 110;
      out.push({ x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, variant: Math.floor(hash2(p.seed, k, 4) * 5), yaw: hash2(p.seed, k, 5) * 6.283, h: 40 + hash2(p.seed, k, 3) ** 2 * 110, w: 0.36 + hash2(p.seed, k, 6) * 0.18, lean: 0 });
    }
  }
  return out;
}
export function archesInCell() { return []; }
/** ice blocks in a small cell of size S (rubble along pressure ridges and big cracks) */
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const cx = (ix + 0.5) * S, cz = (iz + 0.5) * S;
  const rf = rockField(cx, cz);
  const n = Math.floor(0.4 + 55 * rf * rf + 2 * hash2(ix, iz, 801));
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    const u = hash2(ix + k, iz + k * 3, 804);
    out.push({
      x, z, r: 0.35 + Math.pow(u, 3.0) * 3.0 * (0.6 + 0.8 * rf) + (hash2(ix + k, iz, 809) > 0.985 ? 2.5 + 4 * hash2(ix, iz + k, 810) : 0), variant: Math.floor(hash2(ix + k, iz, 805) * 4),
      yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.55 + 0.45 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808),
    });
  }
  return out;
}
