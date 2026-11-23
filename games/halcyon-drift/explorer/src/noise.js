// Seeded 2D noise helpers (pure JS, usable in workers). simplex2 in [-1,1].
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GX = new Float64Array([1, -1, 1, -1, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float64Array([1, 1, -1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);
const perm = new Uint8Array(512);
(function init() {
  let s = 1337;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

export function simplex2(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0, tt = 0.5 - x0 * x0 - y0 * y0;
  if (tt > 0) { tt *= tt; const g = perm[ii + perm[jj]] & 7; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
  tt = 0.5 - x1 * x1 - y1 * y1;
  if (tt > 0) { tt *= tt; const g = perm[ii + i1 + perm[jj + j1]] & 7; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
  tt = 0.5 - x2 * x2 - y2 * y2;
  if (tt > 0) { tt *= tt; const g = perm[ii + 1 + perm[jj + 1]] & 7; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
  return 70 * n;
}

/** fractal sum, rotating the domain every octave to hide the lattice. ~[-1,1] */
export function fbm2(x, y, oct = 5, gain = 0.5, lac = 2.0) {
  let a = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += a * simplex2(x, y); norm += a; a *= gain;
    const nx = (x * 0.8 - y * 0.6) * lac + 11.7, ny = (x * 0.6 + y * 0.8) * lac - 5.3;
    x = nx; y = ny;
  }
  return sum / norm;
}

/** ridged multifractal, ~[0,1] sharp crests */
export function ridged2(x, y, oct = 5, gain = 0.5, lac = 2.0) {
  let a = 1, sum = 0, norm = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let r = 1 - Math.abs(simplex2(x, y)); r *= r;
    r *= w; w = Math.min(1, Math.max(0, r * 1.6));
    sum += a * r; norm += a; a *= gain;
    const nx = (x * 0.8 - y * 0.6) * lac + 3.1, ny = (x * 0.6 + y * 0.8) * lac + 7.9;
    x = nx; y = ny;
  }
  return sum / norm;
}

export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** crater field: one jittered crater per grid cell (with probability). Returns height contribution (m).
 *  Radius <= 0.45 cell so 3x3 neighbours suffice. */
export function craters(x, z, cell, rMin, rMax, prob, seed, depthK, rimK = 0.3) {
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  let h = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ix = cx + dx, iz = cz + dz;
    if (hash2(ix, iz, seed) > prob) continue;
    const px = (ix + 0.2 + 0.6 * hash2(ix, iz, seed + 1)) * cell;
    const pz = (iz + 0.2 + 0.6 * hash2(ix, iz, seed + 2)) * cell;
    const u = hash2(ix, iz, seed + 3);
    const R = rMin + (rMax - rMin) * u * u;
    const ddx = x - px, ddz = z - pz, d2 = ddx * ddx + ddz * ddz;
    if (d2 > R * R * 2.8) continue;
    const d = Math.sqrt(d2) / R;
    const depth = R * depthK * (0.75 + 0.5 * hash2(ix, iz, seed + 4));
    let p;
    if (d < 1) {
      const b = 1 - d * d;
      p = -depth * Math.min(1, b * 1.6) * (0.65 + 0.35 * b);
      p += depth * rimK * Math.exp(-((d - 1) * (d - 1)) / 0.045);
    } else {
      p = depth * rimK * Math.exp(-((d - 1) * (d - 1)) / 0.045) + depth * 0.1 * Math.exp(-(d - 1) * 2.2);
    }
    h += p;
  }
  return h;
}
