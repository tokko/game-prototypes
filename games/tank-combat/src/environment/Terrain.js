// Procedural terrain: 2000 x 2000 m heightfield with a dirt road, observation hill and a village plateau.
// Everything else queries it through getHeight(x, z) / getNormal(x, z, out).
import {
  BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial, DataTexture, RGBAFormat, UnsignedByteType,
  LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, Vector3, Float32BufferAttribute, Uint32BufferAttribute,
  RedFormat, HalfFloatType, DataUtils,
} from 'three';
import { Simplex2 } from '../util/noise.js';
import { patchMaterial, atmo } from './Atmosphere.js';
import { clamp, smoothstep, lerp } from '../util/math.js';
import { makeGrassDetail, makeClumpDetail, makeDirtDetail } from './Textures.js';

export const WORLD_SIZE = 2000;
export const WORLD_HALF = WORLD_SIZE / 2;
export const PLAY_HALF = 700; // playable half-extent (collision bounds sit just inside)
export const EDGE_HEIGHT = 60;

const CELL = 2.5;
const N = Math.round(WORLD_SIZE / CELL) + 1; // 801 samples per side
const ROAD_HALF = 3.2;

// road control points (x, z): start in the south, village in the north
const ROAD_CTRL = [
  [0, 640], [0, 540], [-35, 430], [-25, 320], [30, 215], [110, 120], [150, 20],
  [135, -90], [80, -190], [20, -290], [-20, -380], [-55, -460], [-60, -540], [-58, -590], [-60, -622],
];

export class Terrain {
  constructor(seed = 1337) {
    this.noise = new Simplex2(seed);
    this.noise2 = new Simplex2(seed + 99);
    this.hill = { x: 190, z: -30, r: 120, h: 40 };
    this.village = { x: -60, z: -585 };
    this.farm = { x: 50, z: 300 };
    this.startPos = { x: 0, z: 600 };
    // enemy strongpoint site at the south-east village edge (static geometry built in Military.js)
    this.strong = { x: 40, z: -545 };
    this.craters = [[25, -518, 3.4], [58, -560, 3.0], [2, -498, 3.2], [-38, -506, 2.6], [72, -522, 3.6], [12, -588, 2.8], [50, -505, 2.4], [-18, -560, 2.6]];
    this.trench = [[12, -523], [26, -529], [40, -521], [54, -528], [68, -520]];
    this.heights = new Float32Array(N * N);
    this.roadDist = new Float32Array(N * N).fill(1e3);
    this.roadY = new Float32Array(N * N);
    this.roadPoints = [];
    this._buildRoad();
    this._buildHeights();
    this.hillTopY = this.getHeight(this.hill.x, this.hill.z);
  }

  // ---- analytic base height (before road carving) ----
  _raw(x, z) {
    const n = this.noise;
    let h = 11 * n.fbm(x * 0.0021 + 3.1, z * 0.0021 - 1.7, 3);
    h += 3.5 * n.noise(x * 0.0085, z * 0.0085 + 11);
    h += 0.8 * n.noise(x * 0.033 + 5, z * 0.033);
    h += 0.16 * n.noise(x * 0.13, z * 0.13 + 7);
    const hl = this.hill;
    const dh = Math.hypot(x - hl.x, z - hl.z) / hl.r;
    h += hl.h * Math.exp(-dh * dh);
    const v = this.village;
    const dv = Math.hypot(x - v.x, z - v.z) / 230;
    h += 17 * Math.exp(-dv * dv);
    return h;
  }

  _base(x, z) {
    let h = this._raw(x, z);
    // flat village plateau
    if (!this._vy) this._vy = this._raw(this.village.x, this.village.z) + 1.5;
    const dv = Math.hypot(x - this.village.x, z - this.village.z);
    const pw = 1 - smoothstep(85, 165, dv);
    h = lerp(h, this._vy + this.noise.noise(x * 0.05, z * 0.05) * 0.25, pw);
    // level farmyard around the barn
    if (this._fy === undefined) this._fy = this._raw(this.farm.x, this.farm.z);
    const df = Math.hypot(x - this.farm.x, z - this.farm.z);
    h = lerp(h, this._fy, 1 - smoothstep(60, 105, df));
    // small flat summit on the observation hill
    if (!this._hy) { // level observation plateau at the highest natural point within 22 m (clear sightlines from the summit)
      let m = -1e9;
      for (let r = 0; r <= 22; r += 5.5) for (let k = 0; k < 8; k++) m = Math.max(m, this._raw(this.hill.x + Math.cos(k * 0.785) * r, this.hill.z + Math.sin(k * 0.785) * r));
      this._hy = m + 0.1;
    }
    const dh = Math.hypot(x - this.hill.x, z - this.hill.z);
    h = lerp(h, this._hy, 1 - smoothstep(22, 46, dh));
    // raised rim that closes off the horizon beyond the playable area
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h = lerp(h, EDGE_HEIGHT + this.noise2.noise(x * 0.01, z * 0.01) * 6 * (1 - smoothstep(880, 1000, edge)), smoothstep(620, 1000, edge));
    return h;
  }

  _buildRoad() {
    // Catmull-Rom through control points, sampled every ~1.5 m
    const pts = ROAD_CTRL;
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.ceil(seg / 1.5);
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        dense.push([x, z]);
      }
    }
    dense.push(pts[pts.length - 1].slice());
    // road elevation: base height smoothed along the road
    let ys = dense.map((p) => this._base(p[0], p[1]));
    for (let pass = 0; pass < 4; pass++) {
      const out = ys.slice();
      const W = 28;
      for (let i = 0; i < ys.length; i++) {
        let s = 0, c = 0;
        for (let k = -W; k <= W; k++) { const j = i + k; if (j >= 0 && j < ys.length) { s += ys[j]; c++; } }
        out[i] = s / c;
      }
      ys = out;
    }
    this.roadPoints = dense.map((p, i) => ({ x: p[0], z: p[1], y: ys[i] }));
    // stamp distance + target height into the grid
    const R = 34, rc = Math.ceil(R / CELL);
    for (const p of this.roadPoints) {
      const ci = Math.round((p.x + WORLD_HALF) / CELL), cj = Math.round((p.z + WORLD_HALF) / CELL);
      for (let j = cj - rc; j <= cj + rc; j++) {
        if (j < 0 || j >= N) continue;
        for (let i = ci - rc; i <= ci + rc; i++) {
          if (i < 0 || i >= N) continue;
          const x = i * CELL - WORLD_HALF, z = j * CELL - WORLD_HALF;
          const d = Math.hypot(x - p.x, z - p.z);
          const idx = j * N + i;
          if (d < this.roadDist[idx]) { this.roadDist[idx] = d; this.roadY[idx] = p.y; }
        }
      }
    }
  }

  _buildHeights() {
    for (let j = 0; j < N; j++) {
      const z = j * CELL - WORLD_HALF;
      for (let i = 0; i < N; i++) {
        const x = i * CELL - WORLD_HALF;
        const idx = j * N + i;
        let h = this._base(x, z);
        const d = this.roadDist[idx];
        if (d < 34) {
          const w = 1 - smoothstep(6, 32, d);
          // slight drainage ditch beside the road
          const ditch = Math.exp(-((d - 6.2) * (d - 6.2)) / 3) * 0.16;
          h = lerp(h, this.roadY[idx], w) - ditch * (1 - smoothstep(10, 30, d));
        }
        this.heights[idx] = this._features(x, z, h);
      }
    }
  }

  // strongpoint pad, shell craters and the zigzag trench ditch
  _features(x, z, h) {
    const S = this.strong;
    if (this._sy === undefined) this._sy = this._base(S.x, S.z);
    const dS = Math.hypot(x - S.x, z - S.z);
    if (dS < 56) h = lerp(h, this._sy, 1 - smoothstep(30, 54, dS));
    for (const c of this.craters) {
      const r = Math.hypot(x - c[0], z - c[1]);
      if (r > c[2] * 2) continue;
      const rad = c[2];
      h += -1.6 * (1 - smoothstep(0, rad * 0.9, r)) + 0.5 * Math.exp(-(((r - rad) / (rad * 0.28)) ** 2));
    }
    if (Math.abs(x - 40) < 45 && Math.abs(z + 525) < 30) {
      let dd = 1e9;
      const t = this.trench;
      for (let i = 0; i < t.length - 1; i++) {
        const ax = t[i][0], az = t[i][1], bx = t[i + 1][0], bz = t[i + 1][1];
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
        const u = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
        dd = Math.min(dd, Math.hypot(x - ax - vx * u, z - az - vz * u));
      }
      h += -1.25 * (1 - smoothstep(1.4, 3.0, dd)) + 0.5 * Math.exp(-(((dd - 3.5) / 0.9) ** 2));
    }
    return h;
  }

  // ---- queries ----
  getHeight(x, z) {
    let fx = (x + WORLD_HALF) / CELL, fz = (z + WORLD_HALF) / CELL;
    fx = fx < 0 ? 0 : fx > N - 1.001 ? N - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > N - 1.001 ? N - 1.001 : fz;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const H = this.heights, k = j * N + i;
    const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  getNormal(x, z, out = new Vector3()) {
    const e = 1.25;
    const dx = this.getHeight(x - e, z) - this.getHeight(x + e, z);
    const dz = this.getHeight(x, z - e) - this.getHeight(x, z + e);
    return out.set(dx, 2 * e, dz).normalize();
  }

  getRoadDistance(x, z) {
    let fx = (x + WORLD_HALF) / CELL, fz = (z + WORLD_HALF) / CELL;
    fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, D = this.roadDist, k = j * N + i;
    return D[k] * (1 - tx) * (1 - tz) + D[k + 1] * tx * (1 - tz) + D[k + N] * (1 - tx) * tz + D[k + N + 1] * tx * tz;
  }

  // 0..1 golden-field amount (used by shader control map and minimap)
  fieldAt(x, z) {
    const f = this.noise2.fbm(x * 0.0034 + 50, z * 0.0034 - 20, 2) + 0.25 * this.noise2.noise(x * 0.011, z * 0.011);
    const S = this.strong, V = this.village, F = this.farm;
    return smoothstep(0.02, 0.2, f) * smoothstep(20, 36, Math.hypot(x - S.x, z - S.z))
      * smoothstep(62, 84, Math.hypot(x - V.x, z - V.z)) * smoothstep(48, 66, Math.hypot(x - F.x, z - F.z));
  }

  // 0..1 bare soil / dry patches
  soilAt(x, z) {
    const S = this.strong;
    return Math.max(smoothstep(0.5, 0.78, this.noise.noise(x * 0.017 + 9, z * 0.017 + 4)), 1 - smoothstep(18, 34, Math.hypot(x - S.x, z - S.z)));
  }

  // 0..1 flowering meadow patches (fallow fields)
  meadowAt(x, z) {
    return smoothstep(0.35, 0.6, this.noise2.noise(x * 0.012 + 70, z * 0.012 - 31)) * (1 - this.fieldAt(x, z));
  }

  // routes for HUD/minimap
  getRoute() { return this.roadPoints; }

  // ---- baked per-vertex lighting: R sun visibility, G horizon AO, B tree shadow (stamped later) ----
  _bakeLighting(SEG, step) {
    const out = new Float32Array((SEG + 1) * (SEG + 1) * 3);
    const sd = atmo.uSunDir.value;
    const hl = Math.hypot(sd.x, sd.z), dx = sd.x / hl, dz = sd.z / hl, tanE = sd.y / hl;
    const dists = [];
    let d = 0, st = 4;
    for (let i = 0; i < 40; i++) { d += st; dists.push(d); st *= 1.09; }
    const aoDirs = [];
    for (let i = 0; i < 8; i++) aoDirs.push([Math.cos((i / 8) * 6.283), Math.sin((i / 8) * 6.283)]);
    const aoD = [8, 18, 32, 50];
    let k = 0;
    for (let j = 0; j <= SEG; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i <= SEG; i++) {
        const x = -WORLD_HALF + i * step;
        const h0 = this.getHeight(x, z) + 0.6;
        let maxEx = 0;
        for (let n = 0; n < dists.length; n++) {
          const dd = dists[n], px = x + dx * dd, pz = z + dz * dd;
          if (Math.abs(px) > WORLD_HALF || Math.abs(pz) > WORLD_HALF) break;
          const ex = this.getHeight(px, pz) - (h0 + dd * tanE);
          if (ex > maxEx) maxEx = ex;
        }
        let sl = 0;
        for (let a = 0; a < 8; a++) {
          let m = 0;
          for (let n = 0; n < aoD.length; n++) {
            const s2 = (this.getHeight(x + aoDirs[a][0] * aoD[n], z + aoDirs[a][1] * aoD[n]) - h0) / aoD[n];
            if (s2 > m) m = s2;
          }
          sl += m;
        }
        out[k] = 1 - smoothstep(0, 3, maxEx);
        out[k + 1] = clamp(1 - 1.1 * (sl / 8), 0.55, 1);
        out[k + 2] = 1;
        k += 3;
      }
    }
    return out;
  }

  // darken baked vertex light where tree shadows fall (beyond the real shadow-map range)
  // trees: [{ x, z, h, crown }]
  stampTreeShadows(trees) {
    if (!this.bake) return;
    const SEG = this.meshSeg, step = WORLD_SIZE / SEG, B = this.bake;
    const sd = atmo.uSunDir.value, hl = Math.hypot(sd.x, sd.z);
    const sx = -sd.x / hl, sz = -sd.z / hl, tanE = sd.y / hl;
    for (const t of trees) {
      const off = (t.h * 0.5) / tanE, cx = t.x + sx * off, cz = t.z + sz * off, r = t.crown * 1.1;
      const i0 = Math.max(0, Math.floor((cx - r + WORLD_HALF) / step)), i1 = Math.min(SEG, Math.ceil((cx + r + WORLD_HALF) / step));
      const j0 = Math.max(0, Math.floor((cz - r + WORLD_HALF) / step)), j1 = Math.min(SEG, Math.ceil((cz + r + WORLD_HALF) / step));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(-WORLD_HALF + i * step - cx, -WORLD_HALF + j * step - cz);
          if (d >= r) continue;
          const k = (j * (SEG + 1) + i) * 3 + 2, v = 0.45 + 0.55 * (d / r);
          if (v < B[k]) B[k] = v;
        }
      }
    }
    if (this.bakeAttr) this.bakeAttr.needsUpdate = true;
  }

  // R16F height texture (grass ring samples it in the vertex shader)
  createHeightTexture() {
    const half = new Uint16Array(N * N);
    for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat(this.heights[i]);
    const t = new DataTexture(half, N, N, RedFormat, HalfFloatType);
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.minFilter = t.magFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  // ---- mesh ----
  createMesh() {
    const SEG = 400;
    this.meshSeg = SEG;
    const vcount = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3);
    const step = WORLD_SIZE / SEG;
    const tmp = new Vector3();
    let k = 0;
    for (let j = 0; j <= SEG; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i <= SEG; i++) {
        const x = -WORLD_HALF + i * step;
        pos[k] = x; pos[k + 1] = this.getHeight(x, z); pos[k + 2] = z;
        this.getNormal(x, z, tmp);
        nor[k] = tmp.x; nor[k + 1] = tmp.y; nor[k + 2] = tmp.z;
        k += 3;
      }
    }
    const idx = new Uint32Array(SEG * SEG * 6);
    let q = 0;
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    this.bake = this._bakeLighting(SEG, step);
    this.bakeAttr = new BufferAttribute(this.bake, 3);
    geo.setAttribute('aBake', this.bakeAttr);
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const control = this._buildControlTexture();
    const grass = makeGrassDetail(), clump = makeClumpDetail(), dirt = makeDirtDetail();
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uControl = { value: control };
      shader.uniforms.uGrass = { value: grass };
      shader.uniforms.uClump = { value: clump };
      shader.uniforms.uDirt = { value: dirt };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aBake;\nvarying vec2 vWXZ;\nvarying float vNy;\nvarying float vWY;\nvarying vec3 vBake;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = position.xz; vNy = normal.y; vWY = position.y; vBake = aBake;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vWXZ; varying float vNy; varying float vWY; varying vec3 vBake;
uniform sampler2D uControl; uniform sampler2D uGrass; uniform sampler2D uClump; uniform sampler2D uDirt;
vec3 srgb2lin(vec3 c){ return pow(c, vec3(2.2)); }`)
        .replace('#include <map_fragment>', `
vec4 ctrl = texture2D(uControl, (vWXZ + 1000.0) / 2000.0);
float roadD = ctrl.r * 40.0;
vec2 p = vWXZ;
float camD = length(vFogView);
float near = 1.0 - smoothstep(30.0, 90.0, camD);
float gA = mix(texture2D(uGrass, p * 0.27).r, texture2D(uGrass, p * 0.27 * 0.29 + 0.37).r, 0.4) * 2.0;
float gB = texture2D(uGrass, p * 0.031 + 0.37).r * 2.0;
float gC = texture2D(uGrass, p * 1.3).r * 2.0;
float cA = texture2D(uClump, p * 0.045).r * 2.0;
float cM = texture2D(uClump, p * 0.0042 + 0.11).r;
float cMM = texture2D(uClump, p * 0.0008 + 0.53).r;
float dA = texture2D(uDirt, p * 0.31).r * 2.0;
float dB = texture2D(uDirt, p * 0.053 + 0.5).r * 2.0;
vec3 lush    = srgb2lin(vec3(0.353, 0.416, 0.188));
vec3 dry     = srgb2lin(vec3(0.541, 0.502, 0.275));
vec3 burnt   = srgb2lin(vec3(0.612, 0.541, 0.322));
vec3 wet     = srgb2lin(vec3(0.294, 0.369, 0.165));
vec3 gold    = srgb2lin(vec3(0.66, 0.55, 0.30));
vec3 soil    = srgb2lin(vec3(0.33, 0.25, 0.17));
vec3 rockC   = srgb2lin(vec3(0.478, 0.459, 0.424));
vec3 dirtCol = srgb2lin(vec3(0.54, 0.478, 0.384));
vec3 col = mix(lush, dry, smoothstep(0.38, 0.72, cMM) * 0.8 + smoothstep(0.55, 0.9, cM) * 0.2);
col = mix(col, burnt, smoothstep(0.6, 0.85, cM) * 0.45);
col = mix(col, dry, smoothstep(14.0, 32.0, vWY) * 0.25);
col = mix(col, wet, (1.0 - smoothstep(1.0, 4.0, vWY)) * smoothstep(0.82, 0.95, vBake.y) * 0.2);
col = mix(col, srgb2lin(vec3(0.365, 0.416, 0.204)), near * 0.28 * (1.0 - ctrl.g));
col = mix(col, gold * (0.8 + 0.4 * cM), ctrl.g);
col = mix(col, soil, ctrl.b * 0.65);
float blade = mix(1.0, 0.7 + 0.3 * gC, near);
col *= (0.45 + 0.55 * gA) * (0.7 + 0.3 * gB) * (0.75 + 0.25 * cA) * blade * (0.92 + 0.16 * cMM);
float edgeN = (texture2D(uClump, p * 0.18).r - 0.5) * 2.4 + (texture2D(uDirt, p * 0.9).r - 0.5) * 0.9;
float roadMask = 1.0 - smoothstep(2.6 + edgeN, 3.9 + edgeN, roadD);
float wear = 1.0 - smoothstep(3.2, 9.0, roadD + edgeN * 1.5);
float rut = exp(-pow((roadD - 1.2) * 1.6, 2.0)) * 0.22 * roadMask;
vec3 dirt = dirtCol * (0.55 + 0.45 * dA) * (0.8 + 0.3 * dB);
dirt *= 1.0 - rut;
col = mix(col, soil * (0.6 + 0.5 * dA), wear * 0.45);
col = mix(col, dirt, roadMask);
float slope = 1.0 - vNy;
col = mix(col, soil * (0.7 + 0.5 * dA) * 1.2, smoothstep(0.06, 0.16, slope) * 0.5);
col = mix(col, rockC * (0.55 + 0.5 * dA), smoothstep(0.16, 0.30, slope));
vec4 sampledDiffuseColor = vec4(col, 1.0);
diffuseColor *= sampledDiffuseColor;
`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float treeS = mix(1.0, vBake.z, smoothstep(70.0, 95.0, length(vFogView)));
  reflectedLight.directDiffuse *= vBake.x * treeS;
  reflectedLight.indirectDiffuse *= vBake.y;
}`);
    };
    patchMaterial(mat);
    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'terrain';
    return mesh;
  }

  _buildControlTexture() {
    const S = 1024;
    const data = new Uint8Array(S * S * 4);
    for (let j = 0; j < S; j++) {
      const z = -WORLD_HALF + (j + 0.5) * (WORLD_SIZE / S);
      for (let i = 0; i < S; i++) {
        const x = -WORLD_HALF + (i + 0.5) * (WORLD_SIZE / S);
        const k = (j * S + i) * 4;
        data[k] = Math.min(255, (this.getRoadDistance(x, z) / 40) * 255);
        data[k + 1] = this.fieldAt(x, z) * 255;
        data[k + 2] = this.soilAt(x, z) * 255;
        data[k + 3] = this.meadowAt(x, z) * 255;
      }
    }
    const t = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    this.controlTexture = t;
    return t;
  }
}

// giant flat apron that hides the end of the terrain mesh (edge height is constant)
export function createApron() {
  const geo = new BufferGeometry();
  const s = 12000, h = WORLD_HALF;
  // ring: outer corners 0-3, inner corners 4-7
  const xz = [[-s, -s], [s, -s], [s, s], [-s, s], [-h, -h], [h, -h], [h, h], [-h, h]];
  const v = [], n = [];
  for (const [x, z] of xz) { v.push(x, 0, z); n.push(0, 1, 0); }
  const idx = [];
  const tri = (a, b, c) => {
    const ax = xz[a][0], az = xz[a][1];
    const cross = (xz[b][0] - ax) * (xz[c][1] - az) - (xz[b][1] - az) * (xz[c][0] - ax);
    // y of (b-a)x(c-a) = -(bx*cz - bz*cx); we need it positive -> cross negative
    if (cross < 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  for (let e = 0; e < 4; e++) {
    const e1 = (e + 1) % 4;
    tri(e, e1, 4 + e1); tri(e, 4 + e1, 4 + e);
  }
  geo.setAttribute('position', new Float32BufferAttribute(v, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(n, 3));
  geo.setIndex(new Uint32BufferAttribute(idx, 1));
  const mat = new MeshStandardMaterial({ color: 0x4e5b2c, roughness: 1, metalness: 0 });
  patchMaterial(mat);
  const m = new Mesh(geo, mat);
  m.position.y = EDGE_HEIGHT;
  m.receiveShadow = false;
  return m;
}
