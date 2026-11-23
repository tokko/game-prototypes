// Nyth recipe: bioluminescent lowland moon of Ymir. Dark rolling lowlands threaded with glowing streams and lagoons, towering fungal
// forests, a curated plateau with a runway above a broad lagoon basin (the overlook), distant violet ranges.
// Pure functions of (x, z) shared by the terrain worker, physics, scatter, water, vegetation and ecology (same contract as verdant.js).
import { fbm2, ridged2, hash2, smoothstep, mix, clamp } from '../noise.js';

export const id = 'nyth';
export const POI_CELL = 3600;
export const LAKE = 28;                 // lagoon / sea level (m)
export const PAD_H = 96;                // plateau (runway) elevation

// ---- visual / ecology data for this world (consumed by main.js, nythfx.js, water.js, vegetation.js, ecology.js, terrain.js)
export const WORLD = {
  name: 'Nyth', waterLevel: LAKE,
  palette: {                                       // terrain shader (lush mode) colours: a dark indigo / teal moss ground
    grassA: [0.010, 0.040, 0.070], grassB: [0.020, 0.085, 0.120], dry: [0.030, 0.060, 0.120], mud: [0.010, 0.018, 0.040], sand: [0.04, 0.10, 0.15],
    rock: [0.050, 0.055, 0.110], rockLight: [0.14, 0.16, 0.26], moss: [0.015, 0.080, 0.100],
  },
  fog: { dist: 15000, fall: 4200, mistY: 52, mistDens: 1 / 2600, mistFall: 26, mistCol: [0.38, 0.28, 0.95] },
  water: { deep: [0.004, 0.020, 0.075], shallow: [0.020, 0.150, 0.230], foam: [0.55, 0.85, 1.0], glow: [0.10, 0.62, 0.95] },
  hemi: { sky: [0.18, 0.42, 1.0], ground: [0.05, 0.10, 0.28], intensity: 0.8 },
  sunScale: 0.4, exposure: 0.98, glowMin: 0.9,
  species: { total: 24 },
  // bioluminescence: terrain / foliage grade, glow colours (a / b hue provinces), player proximity glow, ambient floor, giant-shine fill
  nyth: {
    tint: [0.55, 0.62, 1.0], glowA: [0.05, 0.70, 1.0], glowB: [0.62, 0.16, 1.0], glowC: [1.0, 0.15, 0.7], glowD: [1.0, 0.55, 0.1], ground: 0.11, pulse: 1.0,
    light: { hemi: 0.32, fill: 0.5, fillCol: [0.32, 0.5, 1.0] },
  },
  rockGlow: [0.015, 0.04, 0.12],      // faint cold emissive so boulders and spires read as silhouettes instead of black holes (scatter.js)
  motes: { n: 900, box: 150, height: 48, size: 0.2, colA: [0.2, 0.9, 1.0], colB: [0.8, 0.3, 1.0], k: 1.7 },
  pad: { col: [0.25, 0.85, 1.0], colEnd: [1.0, 0.35, 0.9] },
  // flora kit recolour (assets/models/verdant/flora_*.glb materials by name): a/b = lit albedo tint, ga/gb = emissive hue (a / b provinces),
  // base + k * luminance of the kit texture drives the emissive level, alb scales the albedo
  kit: {
    id: 'nyth',
    // base = flat glow, k = glow on the bright parts of the kit texture (veins, spots, fronds; thr = luminance threshold), rim = fresnel rim, grad = gradient up the model
    // (hgt = metres to full), down = glow on down-facing surfaces (cap undersides), alb = albedo scale (kept dark so the glow carries the form)
    bark:         { a: [0.14, 0.14, 0.40], b: [0.26, 0.12, 0.42], ga: [0.10, 0.40, 1.0], gb: [0.55, 0.16, 1.0], base: 0.0, k: 0.6, thr: 0.5, rim: 0.4, grad: 0.3, hgt: 14, alb: 0.5 },
    foliage:      { a: [0.06, 0.30, 0.70], b: [0.30, 0.14, 0.70], ga: [0.03, 0.70, 1.0], gb: [0.55, 0.12, 1.0], base: 0.1, k: 0.45, thr: 0.5, rim: 0.8, grad: 0.12, hgt: 14, alb: 0.16 },
    blob:         { a: [0.05, 0.20, 0.50], b: [0.20, 0.10, 0.50], ga: [0.03, 0.70, 1.0], gb: [0.55, 0.12, 1.0], base: 0.03, k: 0.0, thr: 0.5, rim: 1.3, grad: 0.15, hgt: 12, alb: 0.2 },      // far-LOD crowns (not a kit material: used by the blob mesh only)
    fungus_body:  { a: [0.10, 0.18, 0.60], b: [0.40, 0.12, 0.62], ga: [0.02, 0.45, 1.0], gb: [0.70, 0.08, 0.95], base: 0.0, k: 0.4, thr: 0.65, rim: 0.8, grad: 0.55, down: 0.8, hgt: 30, alb: 0.2 },
    fungus_gills: { a: [0.15, 0.70, 1.0], b: [0.80, 0.25, 0.90], ga: [0.06, 0.95, 1.0], gb: [0.95, 0.20, 0.85], base: 1.3, k: 0.8, thr: 0.5, rim: 0.4, alb: 0.3 },
    glow_bits:    { a: [0.20, 0.80, 1.0], b: [0.90, 0.30, 0.95], ga: [0.10, 1.0, 1.0], gb: [1.0, 0.30, 0.95], base: 1.7, k: 1.0, thr: 0.5, rim: 0.6, alb: 0.5 },
  },
  capK: 2,       // instance caps x2: denser ground flora
  jelly: { n: 56, box: 700, colA: [0.15, 0.85, 1.0], colB: [0.85, 0.25, 1.0], k: 1.7 },
  // creature morphs (glowing variants of the kit animals); all active after dark = always
  fauna: {
    morph: {
      skitter: [
        { key: 'lumen-skitter', body: [0.08, 0.12, 0.34], accent: [0.15, 0.95, 1.0], rule: 'forest', glow: true },
        { key: 'rose-skitter', body: [0.22, 0.08, 0.30], accent: [1.0, 0.35, 0.85], rule: 'forest', glow: true },
        { key: 'prism-skitter', body: [0.20, 0.30, 0.50], accent: [0.55, 0.85, 1.0], rule: 'any', glow: true },
        { key: 'pool-strider', body: [0.05, 0.16, 0.30], accent: [0.2, 1.0, 0.9], rule: 'water', glow: true },
        { key: 'vesper-moth', body: [0.18, 0.08, 0.34], accent: [0.8, 0.4, 1.0], rule: 'night', glow: true },
      ],
      grazer: [
        { key: 'lantern-strider', body: [0.10, 0.14, 0.34], accent: [0.2, 0.9, 1.0], rule: 'any', glow: true },
        { key: 'ringed-strider', body: [0.14, 0.10, 0.34], accent: [0.85, 0.35, 1.0], rule: 'any', stripes: true, glow: true },
        { key: 'plume-strider', body: [0.08, 0.20, 0.34], accent: [1.0, 0.45, 0.80], rule: 'any', crest: true, glow: true },
      ],
      titan: [
        { key: 'veil-giant', body: [0.10, 0.12, 0.30], accent: [0.3, 0.8, 1.0], rule: 'any', glow: true },
        { key: 'aurora-giant', body: [0.16, 0.10, 0.32], accent: [0.9, 0.4, 1.0], rule: 'any', glow: true },
        { key: 'lagoon-giant', body: [0.06, 0.20, 0.32], accent: [0.2, 1.0, 0.85], rule: 'water', glow: true },
      ],
      glider: [
        { key: 'aurora-glider', body: [0.10, 0.12, 0.36], accent: [0.2, 0.95, 1.0], rule: 'night', glow: true },
        { key: 'violet-kite', body: [0.16, 0.08, 0.34], accent: [0.8, 0.35, 1.0], rule: 'night', glow: true },
        { key: 'veil-glider', body: [0.14, 0.22, 0.40], accent: [0.6, 0.9, 1.0], rule: 'night', glow: true },
        { key: 'umbral-glider', body: [0.08, 0.06, 0.26], accent: [0.45, 0.55, 1.0], rule: 'night', glow: true },
      ],
    },
    blurb: {
      skitter: 'Six-legged and thumb-sized, it threads the glowing roots and its markings flicker when a shadow falls across it. It feeds on drifting light motes.',
      grazer: 'A tall-necked herd animal that grazes the luminous meadows, drifting to the lagoon shore to drink. Its dorsal markings pulse slowly in unison across the herd.',
      titan: 'A slow, enormous browser that strips the glowing crowns of the veil-umbrella trees. Its footfalls send ripples of light through the ground.',
      glider: 'A membrane-winged flyer that rides the cool thermals over the lagoons in loose flocks. The wing veins glow, so a flock reads as a drifting constellation.',
    },
    flora: [
      ['Lance-palm', 'A slender, arching palm whose fronds hold a steady blue-white light and brighten when something passes below.'],
      ['Veil-umbrella', 'A wide canopy tree that drapes glowing tendrils to the ground; small things nest in the curtain of light.'],
      ['Bottle-tree', 'A squat tree hung with swollen fruit bulbs that pulse faintly and burst in a puff of luminous spores.'],
      ['Umbrella fungus', 'A fungus the height of a cathedral. Its cap shelters whole communities and its gills glow cyan and violet all night.'],
      ['Fungus cluster', 'Clustered fairy caps that glow in the dark and flare brighter when approached.'],
      ['Berry shrub', 'A low, spreading shrub of softly glowing leaves, browsed by the herds.'],
      ['Curl fern', 'A feathery fern that lights up in a ripple when something brushes past.'],
      ['Tuft grass', 'Silky tuft-grass that carries a cold glow along its blades and ripples like water in the wind.'],
      ['Lantern bloom', 'A glowing spore pod on a thin stalk. Rich in organic compounds; the pods regrow within days.'],
    ],
  },
};

for (const [plan, l] of Object.entries(WORLD.fauna.morph)) for (const m of l) m.skinGlow = plan === 'glider' ? 0.14 : 0.035;      // faint whole-body glow on every creature (ecology.js kitTinted)

// ---- site frame: a = axis along the runway towards the lagoon, b = perpendicular
export const SITE = { x: 1200000, z: 420000 };
const AX = { x: 0.8, z: 0.6 }, BX = { x: -0.6, z: 0.8 };
export const toSite = (a, b) => ({ x: SITE.x + AX.x * a + BX.x * b, z: SITE.z + AX.z * a + BX.z * b });
const fromSite = (x, z) => { const dx = x - SITE.x, dz = z - SITE.z; return { u: dx * AX.x + dz * AX.z, v: dx * BX.x + dz * BX.z }; };
export const RUNWAY = { u0: -950, u1: 480, hw: 56, h: PAD_H, heading: Math.atan2(AX.x, -AX.z) };   // heading in the game's convention (0 = north / -z)
export const PAD = { u: -1130, v: 0, r: 34 };      // round landing pad beyond the runway start

// ---- distant ranges: ridged multifractal, band-limited per terrain chunk (see verdant.js setBand)
let BAND = 0;
export function setBand(step) { BAND = step * 4.5; }
function ranges(x, z) {
  let X = x / 4800, Y = z / 4800, a = 1, sum = 0, norm = 0, w = 1, wl = 4800;
  for (let o = 0; o < 6; o++) {
    const fade = BAND > 0 ? clamp((wl / BAND - 1) * 0.8, 0, 1) : 1;
    if (fade <= 0) break;
    let r = 1 - Math.abs(fbm2(X, Y, 1)); r *= r; r *= w; w = clamp(r * 1.8, 0.2, 1);
    sum += a * r * fade; norm += a; a *= 0.47;
    const nx = (X * 0.8 - Y * 0.6) * 2.05 + 3.1, ny = (X * 0.6 + Y * 0.8) * 2.05 + 7.9; X = nx; Y = ny; wl /= 2.05;
  }
  return Math.pow(sum / norm, 1.3);
}
function mountains(x, z, u, v) {
  const dist = Math.hypot(u * 0.85, v);
  const m = smoothstep(0.12, 0.5, fbm2(x / 15000 + 7, z / 15000 - 3, 2) + 0.08) * smoothstep(7000, 13000, dist);
  let bm = 0;
  if (u > 5200 && u < 36000 && Math.abs(v) < 26000) bm = smoothstep(5200, 9500, u) * (1 - smoothstep(24000, 36000, u)) * (1 - smoothstep(9000, 24000, Math.abs(v)));
  const mask = Math.max(m, bm);
  return mask > 0.002 ? mask * (ranges(x, z) * 1000 + 18 * fbm2(x / 160, z / 160, 2) * (BAND < 400 ? 1 : 0)) : 0;
}

// ---- base height: lowlands, plateau + scarp, lagoon basin, glowing streams, runway strip, mountains
const edgeAt = (v) => 640 + 70 * fbm2(v / 380 + 5.5, 2.2, 3) + 12 * fbm2(v / 70, 8.3, 2);       // plateau edge u as a function of v
const LAGOON = { u: 2550, v: -200 }, TARN = { u: 1450, v: 1050 };
export function heightAt(x, z) {
  const { u, v } = fromSite(x, z);
  let h = 35 + 27 * fbm2(x / 6200 + 3, z / 6200 - 5, 3) + 9 * fbm2(x / 1500 + 1, z / 1500, 2) + 2.2 * fbm2(x / 230, z / 230, 2);
  const siteK = 1 - smoothstep(3800, 8200, Math.hypot(u * 0.85, v));
  if (siteK > 0) {
    const hs = 44 + 15 * fbm2(x / 2600 + 1, z / 2600, 2) + 4.5 * fbm2(x / 520, z / 520, 2) + 1.6 * fbm2(x / 110, z / 110, 2);
    h = mix(h, hs, siteK);
    const dl = Math.hypot((u - LAGOON.u) * 0.92, v - LAGOON.v);
    if (dl < 1250) h = mix(h, 7 + 5 * fbm2(x / 150, z / 150, 2), 1 - smoothstep(520, 1180, dl));
    const dt = Math.hypot(u - TARN.u, v - TARN.v);
    if (dt < 520) h = mix(h, 13 + 4 * fbm2(x / 90, z / 90, 2), 1 - smoothstep(170, 470, dt));
  }
  // glowing streams: narrow meandering channels cut through the low ground (they flood where they dip below LAKE)
  if (h < LAKE + 48) {
    const n = Math.abs(fbm2(x / 2100 + 9, z / 2100 - 4, 2)) + 0.012 * fbm2(x / 70, z / 70, 1);
    const c = 1 - smoothstep(0.0, 0.05, n);
    if (c > 0) h = mix(h, Math.min(h, LAKE - 2.4 + 2.5 * fbm2(x / 55, z / 55, 1)), c * (1 - smoothstep(LAKE + 10, LAKE + 48, h)));
  }
  // plateau with a scarp edge overlooking the lagoon basin
  if (u < 1400 && u > -5200 && Math.abs(v) < 2000) {
    const e0 = edgeAt(v);
    const pu = 1 - smoothstep(e0 - 50, e0 + 380, u);
    const pv = 1 - smoothstep(1050 + 120 * fbm2(u / 500 + 2, 5, 2), 1650 + 120 * fbm2(u / 500, 7, 2), Math.abs(v));
    const pb = 1 - smoothstep(-3400, -4600, u);
    const k = pu * pv * pb;
    if (k > 0) {
      const ts = pu * 6, tf = ts - Math.floor(ts);                                         // faint terracing on the scarp
      const kk = mix(k, pv * pb * (Math.floor(ts) + smoothstep(0.3, 0.7, tf)) / 6, 0.35 * (1 - smoothstep(0.92, 1, pu)) * smoothstep(0.02, 0.1, pu));
      const platH = PAD_H + 7 * fbm2(x / 900 + 21, z / 900, 2) + 1.8 * fbm2(x / 140, z / 140, 2);
      h = mix(h, platH, kk);
    }
  }
  // exactly flat runway strip and pad blended into the plateau
  if (u > RUNWAY.u0 - 320 && u < RUNWAY.u1 + 420 && Math.abs(v) < 460) {
    const du = Math.max(RUNWAY.u0 - 160 - u, 0, u - RUNWAY.u1), dv = Math.max(Math.abs(v) - RUNWAY.hw, 0);
    h = mix(PAD_H, h, smoothstep(0, 240, Math.hypot(du, dv)));
  }
  return h + mountains(x, z, u, v);
}
/** water surface elevation at (x,z), or -1e9 when dry. h = terrain height here (optional) */
export function waterSurface(x, z, h) {
  if (h === undefined) h = heightAt(x, z);
  return h < LAKE ? LAKE : -1e9;
}
export function waterDepth(x, z) { const h = heightAt(x, z); return h < LAKE ? LAKE - h : 0; }
/** no river polyline on Nyth (streams are noise channels): distance to open water is approximated by the elevation above the waterline */
export function riverDistance(x, z) { const h = heightAt(x, z); return h < LAKE ? 0 : Math.max(0, (h - LAKE) * 6); }

export function normalAt(x, z, e = 1.2, out = [0, 1, 0]) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const inv = 1 / Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  out[0] = -hx * inv; out[1] = 2 * e * inv; out[2] = -hz * inv;
  return out;
}

// ---------------------------------------------------------------------------- biome fields
/** out = [moisture, forest, fungus, shore, ledge]; each 0..1. h/slope are optional (computed when omitted) */
export function biome(x, z, h, slope, out = [0, 0, 0, 0, 0]) {
  if (h === undefined) h = heightAt(x, z);
  if (slope === undefined) { const hx = heightAt(x + 3, z) - h, hz = heightAt(x, z + 3) - h; slope = Math.min(1, Math.hypot(hx, hz) / 3); }
  const low = 1 - smoothstep(LAKE + 2, LAKE + 58, h);
  const moist = clamp(low * (0.7 + 0.6 * (fbm2(x / 700 + 5, z / 700, 2) * 0.5 + 0.5)) + 0.32, 0, 1);
  const alt = 1 - smoothstep(520, 900, h);
  const gn = fbm2(x / 420 + 41, z / 420 - 7, 3) + 0.25 * fbm2(x / 90 + 5, z / 90, 2) + 0.25 * moist;
  let forest = smoothstep(-0.02, 0.36, gn) * (0.55 + 0.45 * moist) * alt * (1 - smoothstep(0.5, 0.82, slope));
  const fn = fbm2(x / 1100 + 90, z / 1100 + 13, 3) + 0.22 * fbm2(x / 170, z / 170, 2) + 0.12 * moist;
  let fung = smoothstep(-0.06, 0.28, fn) * alt * (1 - smoothstep(0.45, 0.75, slope));
  const { u, v } = fromSite(x, z);
  const dr = Math.hypot(Math.max(RUNWAY.u0 - 380 - u, 0, u - RUNWAY.u1 - 380), Math.max(Math.abs(v) - RUNWAY.hw - 30, 0));
  const clearK = smoothstep(30, 200, dr);                                             // runway and approach corridor stay open
  const ovl = Math.hypot(Math.max(300 - u, 0, u - 700), Math.max(-300 - v, 0, v - 300));      // the overlook headland stays open
  const clearO = smoothstep(20, 150, ovl);
  forest *= clearK * clearO; fung *= clearK * clearO;
  const wl = h - LAKE;
  const shore = (1 - smoothstep(0.5, 3.6, wl)) * (wl > -4 ? 1 : 0);
  const ledge = clamp(smoothstep(0.3, 0.46, slope) * (1 - smoothstep(0.8, 0.98, slope)) * (1 - smoothstep(500, 900, h)) * (0.4 + 0.6 * smoothstep(-0.2, 0.3, fbm2(x / 11 + 2, z / 11, 2))), 0, 1);
  out[0] = moist; out[1] = clamp(forest, 0, 1); out[2] = clamp(fung, 0, 1); out[3] = clamp(shore, 0, 1); out[4] = ledge;
  return out;
}
const _b = [0, 0, 0, 0, 0];
/** terrain shader aux: [wet, shore, rock, forest] */
export function materialAt(x, z, slope, out = [0, 0, 0, 0]) {
  const h = heightAt(x, z);
  biome(x, z, h, slope, _b);
  const rockN = fbm2(x / 140 + 7, z / 140 - 3, 3) * 0.5 + 0.5;
  const high = smoothstep(850, 1500, h);
  out[0] = _b[0]; out[1] = _b[3];
  out[2] = clamp(smoothstep(0.36, 0.62, slope) * 0.95 + smoothstep(0.68, 0.86, rockN) * 0.2 * (1 - _b[1]) + high * 0.7, 0, 1);
  out[3] = _b[1];
  return out;
}

// ---------------------------------------------------------------------------- scatter: glass spires, boulders, POIs
export function rockField(x, z) { return smoothstep(0.1, 0.65, fbm2(x / 900 + 12, z / 900 + 3, 3) * 0.5 + 0.5 + 0.2 * Math.sin(x / 431)); }
export function hoodooField(x, z) { return smoothstep(-0.2, 0.4, fbm2(x / 4200 + 5.5, z / 4200 - 8.5, 2)); }
export function spiresInCell(ix, iz, S) {
  const out = [];
  const gx = (ix + hash2(ix, iz, 610)) * S, gz = (iz + hash2(ix, iz, 620)) * S;
  if (hash2(ix, iz, 640) > 0.05 + 0.4 * hoodooField(gx, gz)) return out;
  const { u, v } = fromSite(gx, gz); if (u < 1000 && Math.abs(v) < 1900 && u > -4200) return out;       // the plateau stays open
  const gh = heightAt(gx, gz); if (gh < LAKE + 6) return out;
  const n = 2 + Math.floor(hash2(ix, iz, 630) * 5), spread = 40 + hash2(ix, iz, 650) * 120;
  for (let k = 0; k < n; k++) {
    const a = hash2(ix + k * 7, iz, 660) * 6.2832, d = Math.sqrt(hash2(ix + k * 7, iz, 661)) * spread;
    const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
    const u2 = hash2(ix + k * 13, iz, 662), big = hash2(ix + k * 13, iz, 663) > 0.9;
    out.push({ x, z, variant: Math.floor(hash2(ix + k, iz, 664) * 5), yaw: hash2(ix + k, iz, 665) * 6.2832, h: big ? 120 + u2 * 160 : 26 + u2 * u2 * 90, w: 0.2 + hash2(ix + k, iz, 666) * 0.14, lean: 0 });
  }
  return out;
}
export function archesInCell() { return []; }
export function bouldersInCell(ix, iz, S) {
  const out = [];
  const rf = rockField((ix + 0.5) * S, (iz + 0.5) * S);
  const n = Math.floor(1 + 9 * rf * rf + 2 * hash2(ix, iz, 801));
  for (let k = 0; k < n; k++) {
    const x = (ix + hash2(ix * 31 + k, iz, 802)) * S, z = (iz + hash2(ix, iz * 31 + k, 803)) * S;
    const { u, v } = fromSite(x, z); if (u > RUNWAY.u0 - 180 && u < RUNWAY.u1 + 40 && Math.abs(v) < RUNWAY.hw + 40) continue;
    const h = heightAt(x, z); if (h < LAKE + 0.5) continue;
    const q = hash2(ix + k, iz + k * 3, 804);
    out.push({ x, z, r: 0.4 + Math.pow(q, 3.0) * 2.6 * (0.6 + 0.8 * rf), variant: Math.floor(hash2(ix + k, iz, 805) * 4),
      yaw: hash2(ix + k, iz, 806) * 6.2832, flat: 0.6 + 0.4 * hash2(ix + k, iz, 807), tone: hash2(ix + k, iz, 808) });
  }
  return out;
}
const poiCache = new Map();
const PT = ['choir', 'lumen', 'motes', 'hollow', 'choir', 'lumen'];
const CURATED = [['choir', 1500, 650, 90], ['lumen', 2150, -750, 80], ['motes', 1100, -880, 70], ['hollow', 3600, 500, 70]];
export function poiCell(ix, iz) {
  const key = ix * 131071 + iz;
  if (poiCache.has(key)) return poiCache.get(key);
  let p = null;
  for (let i = 0; i < CURATED.length && !p; i++) {
    const [type, a, b, r] = CURATED[i], q = toSite(a, b);
    if (Math.floor(q.x / POI_CELL) === ix && Math.floor(q.z / POI_CELL) === iz) p = { type, ix, iz, x: q.x, z: q.z, r, seed: 2000 + i };
  }
  if (!p && hash2(ix, iz, 501) < 0.5) {
    const type = PT[Math.floor(hash2(ix, iz, 503) * PT.length)];
    const x = (ix + 0.15 + 0.7 * hash2(ix, iz, 502)) * POI_CELL, z = (iz + 0.15 + 0.7 * hash2(ix, iz, 504)) * POI_CELL;
    if (heightAt(x, z) > LAKE + 6) p = { type, ix, iz, x, z, r: 80, seed: Math.floor(hash2(ix, iz, 505) * 1e6) };
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
// species ids (kit): 0 lance-palm, 1 veil-umbrella, 2 bottle-tree, 3 umbrella fungus, 4 fungus cluster, 5 berry shrub, 6 curl fern, 7 tuft grass, 8 lantern bloom
export const CLASS = { big: 96, small: 32, grass: 12 };
const bb = [0, 0, 0, 0, 0];
export function plantsInCell(kind, ix, iz, S) {
  const out = [];
  const area = S * S;
  const tryPlace = (sp, n, seed, accept, size) => {
    for (let k = 0; k < n; k++) {
      const x = (ix + hash2(ix * 17 + k, iz * 5 + sp, seed)) * S, z = (iz + hash2(ix * 3 + sp, iz * 19 + k, seed + 1)) * S;
      const h = heightAt(x, z);
      if (h < LAKE + 0.35) continue;
      const hx = heightAt(x + 2.5, z) - h, hz = heightAt(x, z + 2.5) - h; const slope = Math.min(1, Math.hypot(hx, hz) / 2.5);
      biome(x, z, h, slope, bb);
      const r = hash2(ix * 7 + k, iz * 11 + sp, seed + 2);
      if (!accept(bb, slope, r, h, x, z)) continue;
      out.push({ x, z, y: h, sp, sc: size(hash2(ix + k * 3, iz + sp * 9, seed + 3), bb), yaw: hash2(ix + k, iz * 13 + sp, seed + 4) * 6.2832, tone: hash2(ix * 29 + k, iz + sp, seed + 5), r });
    }
  };
  if (kind === 'big') {
    tryPlace(0, Math.floor(area * 0.0020), 11, (b, s, r) => r < b[1] * b[1] * 0.5 && b[0] > 0.2, (t) => 0.8 + t * 0.9);
    tryPlace(1, Math.floor(area * 0.0060), 21, (b, s, r) => r < b[1] * (0.45 + 0.6 * b[0]), (t) => 0.85 + t * 0.85);
    tryPlace(2, Math.floor(area * 0.0036), 31, (b, s, r) => r < b[1] * 0.8 * (1.1 - 0.5 * b[0]), (t) => 0.75 + t * 0.8);
    // umbrella fungi: the signature of Nyth. A few enormous (30-60 m caps), many mid-size, dense in fungal provinces
    tryPlace(3, Math.floor(area * 0.00075), 41, (b, s, r) => r < b[2] * 0.85, (t) => (t > 0.95 ? 30 + (t - 0.95) / 0.05 * 30 : t > 0.72 ? 11 + (t - 0.72) / 0.23 * 14 : 4 + t / 0.72 * 7));
  } else if (kind === 'small') {
    // meadow = clumped open-ground field: flowers, ferns and shrubs gather in luminous patches even where there is no forest
    const mdw = (x, z) => smoothstep(-0.2, 0.4, fbm2(x / 90 + 60, z / 90 - 20, 2));
    tryPlace(4, Math.floor(area * 0.012), 51, (b, s, r, h, x, z) => r < b[2] * 0.85 + 0.05 * b[1] + 0.03 + 0.1 * mdw(x, z), (t) => 0.7 + t * 1.3);
    tryPlace(5, Math.floor(area * 0.02), 61, (b, s, r, h, x, z) => r < (0.1 + b[1] * 0.8 + b[4] * 0.9 + 0.35 * mdw(x, z)) * (1 - b[3] * 0.8), (t) => 0.7 + t * 0.9);
    tryPlace(6, Math.floor(area * 0.05), 71, (b, s, r, h, x, z) => r < (b[1] * (0.4 + 0.6 * b[0]) * 1.2 + b[2] * 0.5 + b[4] * 0.9 + 0.12 + 0.5 * mdw(x, z)), (t) => 0.7 + t * 0.9);
    tryPlace(8, Math.floor(area * 0.035), 91, (b, s, r, h, x, z) => r < (b[2] * 0.7 + b[1] * 0.35 + 0.15 * b[0] + 0.6 * mdw(x, z)) * 0.6 && b[3] < 0.5, (t) => 0.8 + t * 0.5);
  } else {
    tryPlace(7, Math.floor(area * 0.7), 81, (b, s, r) => r < (0.3 + 0.7 * (1 - b[1] * 0.6)) * (1 - b[3] * 0.9) * (1 - s * 1.2 * (1 - 0.75 * b[4])), (t) => 0.8 + t * 0.8);
  }
  return out;
}

/** streams and lagoons drift slowly (a lazy swirl): the water shader animates its waves only through the flow vector */
export function waterFlow(x, z, out) {
  const a = 6.2832 * (0.5 + 0.5 * fbm2(x / 900 + 2, z / 900 - 6, 2));
  out[0] = Math.cos(a) * 0.32; out[1] = Math.sin(a) * 0.32;
  return out;
}

/** a guaranteed grazer herd on the overlook meadow, west of the scarp edge (site frame u = 430, v = -230); ecology.js asks per spawn cell */
export function curatedHerd(ix, iz, S) {
  const p = toSite(430, -230);
  return Math.floor(p.x / S) === ix && Math.floor(p.z / S) === iz ? p : null;
}
