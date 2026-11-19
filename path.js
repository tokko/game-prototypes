// Path data: the one linear route village -> forest -> estate -> exit (about 430 m).
// Pure data + helpers (no scene objects). Units are metres, y is up. The route is defined by arc
// length: BENDS turn the heading, PLACES name the set pieces, WIDTH gives the walkable half width.

export const ZONES = ['village', 'forest', 'estate'];

// Named places, id -> arc length s (and extent len where it is a stretch). world.js builds each one and
// exposes them as world.places; the width table below and the fog gates are keyed to these.
export const PLACES = {
  'village-start':    { s: 0 },
  'village-ajar':     { s: 17 },                 // house with its door ajar
  'village-laundry':  { s: 30 },                 // laundry line across the street
  'village-lane':     { s: 64, len: 28 },        // enclosed: narrow lane between tall houses
  'village-well':     { s: 92 },
  'village-square':   { s: 97, len: 30 },        // open: small square with well and shrine
  'village-shrine':   { s: 98 },
  'village-cart':     { s: 119 },
  'village-alley':    { s: 134 },                // dead-end alley mouth, path narrows past it
  'gate-1':           { s: 152 },                // fog gate village | forest
  'forest-fence':     { s: 180, len: 28 },       // broken fence, one section smashed toward the path
  'forest-lantern':   { s: 214 },                // lantern hanging from a dead branch
  'forest-clearing':  { s: 224, len: 32 },       // open: standing stones beside the path
  'forest-hollow':    { s: 268, len: 28 },       // enclosed: sunken hollow
  'gate-2':           { s: 300 },                // fog gate forest | estate
  'estate-gate':      { s: 320 },
  'estate-lodge':     { s: 334 },
  'estate-courtyard': { s: 359, len: 26 },       // walled courtyard before the manor
  'estate-door':      { s: 374 },                // open front door: the interior begins
  'estate-hall':      { s: 381 },                // hall with the staircase
  'estate-landing':   { s: 386 },                // stair landing (scenery)
  'estate-corridor':  { s: 396 },                // corridor ceiling light
  'estate-bend':      { s: 404 },                // the corridor turns left here
  'estate-exit':      { s: 420 },                // exit door: fade begins
};
export const LENGTH = 432;

// Heading changes, [s0, s1, degrees]; positive turns left. The path starts at the origin heading -Z.
const BENDS = [
  [34, 52, -24], [82, 98, 34], [112, 128, -22],            // village
  [154, 168, 20], [176, 198, -42], [244, 258, 38], [260, 278, -36], [284, 298, 14], // forest
  [401, 408, 90],                                          // the corridor bend
];

// Walkable half width by s: [s, halfWidth] keys, smoothstep between neighbours (equal keys = plateau).
const WIDTH = [
  [0, 2.7], [40, 2.7], [50, 1.4], [78, 1.4], [86, 4.5], [108, 4.5], [118, 2.7], [126, 2.7], [130, 1.7], [139, 1.7], [147, 2.6], // village: street, lane, square, alley
  [152, 2.6], [162, 1.9], [204, 1.9], [210, 3.5], [238, 3.5], [244, 1.9], [254, 1.2], [282, 1.2], [290, 1.9], [304, 1.9],       // forest: path, clearing, hollow
  [310, 2.4], [342, 2.4], [348, 3.6], [366, 3.6], [372, 1.5], [375, 1.5], [378, 2.4], [387, 2.4], [391, 1.15], [LENGTH, 1.15],  // estate: drive, courtyard, door, hall, corridor
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const STEP = 0.5;
export const PATH = [];
{
  const heading = (s) => { let a = 0; for (const [s0, s1, deg] of BENDS) a += (deg * Math.PI / 180) * smooth(s0, s1, s); return a; };
  let x = 0, z = 0;
  const n = Math.round(LENGTH / STEP);
  for (let i = 0; i <= n; i++) {
    const s = i * STEP, h = heading(s + STEP / 2);
    PATH.push({ x, z, s, tx: 0, tz: 0 });
    x += -Math.sin(h) * STEP; z += -Math.cos(h) * STEP;
  }
  PATH.forEach((p, i) => {
    const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    p.tx = dx / l; p.tz = dz / l;
  });
}

export const GATES = [PLACES['gate-1'].s, PLACES['gate-2'].s];   // arc length of each fog gate centre
export const GATE_HALF = 22;                                     // crossfade half width (m)
export const DOOR_S = PLACES['estate-door'].s;   // manor front door: the interior begins
export const END_S = PLACES['estate-exit'].s;    // corridor exit door

// Position and frame at arc length s. Right-hand normal (rx,rz) = (-tz, tx); right of travel.
export function pointAt(s) {
  s = Math.min(LENGTH, Math.max(0, s));
  const i = Math.min(PATH.length - 2, Math.floor(s / STEP));
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

// 0 outside, 1 inside the manor hall and corridor.
export function interiorAt(s) {
  return smooth(DOOR_S - 2.5, DOOR_S + 1.5, s) * (1 - smooth(END_S + 1, END_S + 4, s));
}

const FOG_BASE = [0.024, 0.034, 0.014];
export function fogDensity(s) {
  const w = zoneWeights(s);
  let d = w[0] * FOG_BASE[0] + w[1] * FOG_BASE[1] + w[2] * FOG_BASE[2];
  const i = interiorAt(s);
  d = d * (1 - i) + 0.025 * i;
  for (const g of GATES) d += 0.06 * Math.exp(-(((s - g) / 12) ** 2)); // the fog gate swell
  return d;
}

export function halfWidth(s) {
  if (s <= WIDTH[0][0]) return WIDTH[0][1];
  for (let i = 1; i < WIDTH.length; i++) {
    if (s < WIDTH[i][0]) { const a = WIDTH[i - 1], b = WIDTH[i]; return a[1] + (b[1] - a[1]) * smooth(a[0], b[0], s); }
  }
  return WIDTH[WIDTH.length - 1][1];
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
