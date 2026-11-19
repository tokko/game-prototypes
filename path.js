// Path data: the one linear route village -> forest -> estate -> exit.
// Pure data + helpers (no scene objects). Units are metres, y is up, path runs along -Z.
import * as THREE from 'three';

export const ZONES = ['village', 'forest', 'estate'];

// Control points (x, z). Index 5 is fog gate 1 (village|forest), index 11 is fog gate 2 (forest|estate).
// From (0,-840) on the route is dead straight along x=0 (gate, drive, manor, corridor, exit).
const CTRL = [
  [0, 0], [2, -60], [7, -130], [5, -200], [-1, -270], [0, -330],
  [-10, -400], [-6, -480], [12, -560], [10, -640], [-4, -720], [0, -780],
  [0, -840], [0, -1052],
];
const GATE_IDX = [5, 11];

// Estate layout along z (used by world.js too).
export const ESTATE = { gateZ: -830, doorZ: -946, lightZ: -996, endZ: -1040 };

const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
curve.arcLengthDivisions = 4000;
const N = Math.round(curve.getLength() / 2);

export const PATH = [];
{
  const raw = curve.getSpacedPoints(N);
  let acc = 0;
  raw.forEach((v, i) => {
    if (i > 0) acc += Math.hypot(v.x - raw[i - 1].x, v.z - raw[i - 1].z);
    PATH.push({ x: v.x, z: v.z, s: acc, tx: 0, tz: 0 });
  });
  PATH.forEach((p, i) => {
    const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    p.tx = dx / l; p.tz = dz / l;
  });
}
export const LENGTH = PATH[PATH.length - 1].s;

function nearestIdx(x, z) {
  let best = 0, bd = Infinity;
  PATH.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
export function sAtZ(z) {
  for (const p of PATH) if (p.z <= z) return p.s;
  return LENGTH;
}

export const GATES = GATE_IDX.map((i) => PATH[nearestIdx(CTRL[i][0], CTRL[i][1])].s); // arc length of each gate centre
export const GATE_HALF = 22;                                                           // crossfade half width (m)
export const DOOR_S = sAtZ(ESTATE.doorZ);   // manor front door: corridor begins
export const END_S = sAtZ(ESTATE.endZ);     // corridor exit door

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Position and frame at arc length s. Right-hand normal (rx,rz) = (-tz, tx); right of travel.
export function pointAt(s) {
  s = Math.min(LENGTH, Math.max(0, s));
  let i = Math.min(PATH.length - 2, Math.floor(s / (LENGTH / (PATH.length - 1))));
  while (i < PATH.length - 2 && PATH[i + 1].s < s) i++;
  while (i > 0 && PATH[i].s > s) i--;
  const a = PATH[i], b = PATH[i + 1];
  const t = (s - a.s) / ((b.s - a.s) || 1);
  let tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz, rx: -tz, rz: tx, s };
}

export function zoneIndex(s) { return s < GATES[0] ? 0 : s < GATES[1] ? 1 : 2; }
export function zoneAt(s) { return ZONES[zoneIndex(s)]; }
export function zoneStart(name) { const i = ZONES.indexOf(name); return i === 0 ? 0 : GATES[i - 1]; }

// Crossfade weights [village, forest, estate] that swap across each fog gate.
export function zoneWeights(s) {
  const w0 = 1 - smooth(GATES[0] - GATE_HALF, GATES[0] + GATE_HALF, s);
  const w2 = smooth(GATES[1] - GATE_HALF, GATES[1] + GATE_HALF, s);
  return [w0, Math.max(0, 1 - w0 - w2), w2];
}

// 0 outside, 1 inside the manor corridor.
export function interiorAt(s) {
  return smooth(DOOR_S - 2.5, DOOR_S + 1.5, s) * (1 - smooth(END_S + 1, END_S + 4, s));
}

const FOG_BASE = [0.040, 0.058, 0.022];
export function fogDensity(s) {
  const w = zoneWeights(s);
  let d = w[0] * FOG_BASE[0] + w[1] * FOG_BASE[1] + w[2] * FOG_BASE[2];
  const i = interiorAt(s);
  d = d * (1 - i) + 0.04 * i;
  for (const g of GATES) d += 0.10 * Math.exp(-(((s - g) / 12) ** 2)); // the fog gate swell
  return d;
}

export function halfWidth(s) {
  const w = zoneWeights(s);
  const base = w[0] * 2.8 + w[1] * 1.7 + w[2] * 2.4;
  const i = interiorAt(s);
  return base * (1 - i) + 1.15 * i;
}

export function surfaceAt(s) {
  if (s >= DOOR_S && s < END_S) return 'wood';
  return ['cobble', 'dirt', 'gravel'][zoneIndex(s)];
}

// Clamp a world xz position to the path corridor. hint = previous segment index (or -1).
export function clampToPath(x, z, hint = -1) {
  let lo = 0, hi = PATH.length - 2;
  if (hint >= 0) { lo = Math.max(0, hint - 40); hi = Math.min(PATH.length - 2, hint + 40); }
  let bd = Infinity, bi = lo, bpx = 0, bpz = 0, bs = 0;
  for (let i = lo; i <= hi; i++) {
    const a = PATH[i], b = PATH[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const t = clamp01(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz));
    const px = a.x + abx * t, pz = a.z + abz * t;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bd) { bd = d; bi = i; bpx = px; bpz = pz; bs = a.s + (b.s - a.s) * t; }
  }
  const d = Math.sqrt(bd), hw = halfWidth(bs);
  if (d > hw) { const k = hw / d; x = bpx + (x - bpx) * k; z = bpz + (z - bpz) * k; }
  return { x, z, s: bs, idx: bi };
}
