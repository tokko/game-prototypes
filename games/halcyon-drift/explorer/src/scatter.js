// Reusable instanced scatter: boulder fields, eroded hoodoo spires, natural arches. Placement rules come from the terrain
// recipe (seeded per cell); instances are rebuilt into a few big InstancedMeshes as regions stream in/out.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { simplex2, hash2, smoothstep } from './noise.js';
import { setupMat, applyCurvature } from './gfx.js';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { GLB } from './glbmodels.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const n3 = (x, y, z, s = 0) => simplex2(x + 0.53 * z + s, y - 0.41 * z + s * 1.7);

// ------------------------------------------------------------------ geometry
function boulderGeo(detail, seed) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = n3(x * 1.4, y * 1.4, z * 1.4, seed), b = n3(x * 3.1, y * 3.1, z * 3.1, seed + 9);
    const cr = Math.abs(n3(x * 2.2, y * 2.2, z * 2.2, seed + 21));
    const k = 1 + 0.32 * a + 0.13 * b - 0.16 * (1 - cr);
    x *= k * (1.0 + 0.18 * Math.sin(seed)); z *= k * (1.0 - 0.15 * Math.cos(seed * 1.3)); y *= k * 0.66;
    if (y < -0.32) y = -0.32 + (y + 0.32) * 0.15;
    p.setXYZ(i, x, y, z);
    const t = 0.82 + 0.28 * b - 0.18 * (1 - cr) + 0.1 * y;
    col[i * 3] = t; col[i * 3 + 1] = t; col[i * 3 + 2] = t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** hoodoo spire, unit height 1 (base underground at y=-0.06): layered hard/soft strata, flutes, caprock, jagged tip */
function spireGeo(variant, rings, radial) {
  const seed = variant * 13.7 + 2.3;
  const rot = 0.75 + 0.5 * hash2(variant, 1, 7), asp = 0.7 + 0.3 * hash2(variant, 2, 7);
  const capAt = 0.72 + 0.2 * hash2(variant, 3, 7), capW = 0.5 + 0.9 * hash2(variant, 4, 7);
  const neckAt = 0.3 + 0.3 * hash2(variant, 5, 7), neckK = 0.25 + 0.3 * hash2(variant, 6, 7);
  const layers = 4 + variant, flutes = 4 + variant;
  const pos = [], col = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, y = -0.06 + t * 1.06;
    let prof = 0.5 * (1 + 1.1 * Math.exp(-t * 4.5)) * (1 - 0.4 * t);
    prof *= 1 - neckK * Math.exp(-Math.pow((t - neckAt) / 0.13, 2));
    const lf = (t * layers) % 1, li = Math.floor(t * layers);
    const hard = smoothstep(0.08, 0.25, lf) * (1 - smoothstep(0.62, 0.8, lf));
    const lh = hash2(li, variant, 11);
    prof *= 0.9 + (0.12 + 0.1 * lh) * hard;                                       // ledges: hard layers stick out
    prof *= 1 + 0.75 * capW * Math.exp(-Math.pow((t - capAt) / 0.06, 2));            // caprock
    if (t > capAt + 0.06) prof *= Math.max(0.0, 1 - Math.pow((t - capAt - 0.06) / (1 - capAt - 0.06 + 1e-4), 1.8));
    for (let a = 0; a <= radial; a++) {
      const th = (a / radial) * Math.PI * 2, cx = Math.cos(th), sz = Math.sin(th);
      const flute = 0.06 * Math.sin(th * flutes + 3 * n3(t * 2, seed, 0)) * (0.4 + hard);
      const disp = 0.2 * n3(cx * 1.6 + seed, sz * 1.6, t * 4.5, seed) + 0.1 * n3(cx * 5 + seed, sz * 5, t * 13, seed + 3) + 0.1 * Math.abs(n3(cx * 8, sz * 8, t * 20, seed + 9));
      const rr = Math.max(0.005, prof * (1 + disp + flute));
      const wob = 0.1 * n3(t * 2.2, seed, 1) * t;
      pos.push(cx * rr * rot + wob, y, sz * rr * asp);
      const band = 0.5 + 0.5 * Math.sin(li * 2.1 + lh * 5);
      const tone = 0.55 + 0.4 * band + 0.18 * hard + 0.1 * n3(cx * 3, sz * 3, t * 9, seed);
      const rust = Math.max(0, n3(t * 7 + seed, th * 0.5, 3)) * 0.6;
      col.push(Math.min(1.3, tone * (1 + rust * 0.5)), tone * (1 - rust * 0.12), tone * (1 - rust * 0.55));
    }
  }
  const W = radial + 1;
  for (let r = 0; r < rings; r++) for (let a = 0; a < radial; a++) { const i0 = r * W + a, i1 = i0 + 1, i2 = i0 + W, i3 = i2 + 1; idx.push(i0, i2, i1, i1, i2, i3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** natural arch, span 1 along x, feet buried: thick eroded piers, thinner crown, clear opening */
function archGeo(variant) {
  const seed = variant * 7.7 + 11, rings = 96, radial = 22;
  const pos = [], col = [], idx = [];
  const height = 0.46 + 0.1 * hash2(variant, 9, 3), asym = (hash2(variant, 5, 3) - 0.5) * 0.2;
  const C = (u) => { const ang = Math.PI * u; let y = height * Math.pow(Math.sin(ang), 0.75); if (u < 0.05) y -= (0.05 - u) * 3; if (u > 0.95) y -= (u - 0.95) * 3; return [-0.5 * Math.cos(ang) + asym * Math.sin(ang), y]; };
  for (let r = 0; r <= rings; r++) {
    const u = r / rings, [cx, cy] = C(u), [x2, y2] = C(Math.min(1, u + 0.004)), [x1, y1] = C(Math.max(0, u - 0.004));
    let tx = x2 - x1, ty = y2 - y1; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    const crown = Math.sin(Math.PI * u);
    const thick = 0.034 + 0.05 * Math.pow(1 - crown, 2.2) + 0.012 * n3(u * 5, seed, 1);
    for (let a = 0; a <= radial; a++) {
      const th = (a / radial) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const disp = 1 + 0.3 * n3(c * 1.5 + seed, s * 1.5, u * 7, seed) + 0.14 * n3(c * 4, s * 4, u * 18, seed + 5) + 0.08 * Math.abs(n3(c * 7, s * 7, u * 30, seed + 8));
      const ra = thick * disp, rb = thick * 1.75 * disp;
      pos.push(cx + nx * c * ra, cy + ny * c * ra, s * rb);
      const band = 0.5 + 0.5 * Math.sin(cy * 70 + 2 * n3(u * 2, seed, 6));
      const tone = 0.62 + 0.38 * band + 0.1 * n3(c * 2, s * 2, u * 8, seed);
      col.push(tone * 1.04, tone * 0.93, tone * 0.8);
    }
  }
  const W = radial + 1;
  for (let r = 0; r < rings; r++) for (let a = 0; a < radial; a++) { const i0 = r * W + a, i1 = i0 + 1, i2 = i0 + W, i3 = i2 + 1; idx.push(i0, i1, i2, i1, i3, i2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ material
function hookRock(shader, mossK, mossC) {
  applyCurvature(shader);
  shader.uniforms.uNoise = { value: noiseTexture() }; shader.uniforms.uMossK = mossK; shader.uniforms.uMossC = mossC;
  shader.vertexShader = 'varying vec3 vWP; varying vec3 vWN; varying float vLY;\n' + shader.vertexShader.replace('#include <begin_vertex>',
    `#include <begin_vertex>
  vLY = position.y;
#ifdef USE_INSTANCING
  vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);
#endif`);
  shader.fragmentShader = `varying vec3 vWP; varying vec3 vWN; varying float vLY; uniform float uMossK; uniform vec3 uMossC;\n${NOISE_TEX_GLSL}\n` + shader.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
  float nA = vnoise(vWP * 0.9), nB = vnoise(vWP * 3.7 + 5.0), nC = vnoise(vec3(vWP.x * 0.4, vWP.y * 3.0, vWP.z * 0.4) + 2.0);
  diffuseColor.rgb *= 0.82 + 0.4 * nA * (0.7 + 0.5 * nB);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 0.9, 0.7), smoothstep(0.55, 0.8, nC) * 0.5);
  float topW = smoothstep(0.55, 0.9, vWN.y) * (0.45 + 0.55 * nB);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.34, 0.28, 0.22), uMossC, step(0.001, uMossK)), topW * 0.5);   // dust (or moss) settled on top faces
  float mossW = uMossK * clamp(smoothstep(0.4, 0.85, vWN.y + 0.3 * nB - 0.1) * 0.85 + smoothstep(0.78, 0.95, vLY) * 0.9, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uMossC * (0.75 + 0.5 * nB), mossW);   // green-topped pinnacles on lush worlds
`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { float h0 = vnoise(vWP * 2.1), hx = vnoise(vWP * 2.1 + vec3(0.12, 0.0, 0.0)), hz = vnoise(vWP * 2.1 + vec3(0.0, 0.0, 0.12)), hy = vnoise(vWP * 2.1 + vec3(0.0, 0.12, 0.0));
    vec3 gw = vec3(hx - h0, hy - h0, hz - h0); normal = normalize(normal - mat3(viewMatrix) * gw * 0.45); }`);
}
function hookDepth(shader) { applyCurvature(shader); }

// ------------------------------------------------------------------ system
const RS = 256;                    // boulder region size (m)
const BR = 1100;                   // boulder load radius
const SC = 1500, SR = 26000;       // spire cell / load radius
const AC = 6000, AR = 42000;       // arch cell / radius

export class Scatter {
  constructor(terrain, rc, look = null) {
    this.t = terrain; this.rc = rc; this.group = new THREE.Group(); this.nearSpire = look ? 1600 : 4800;
    const mossK = { value: look ? 1 : 0 }, mossC = { value: look ? new THREE.Color(...look.moss) : new THREE.Color(0.2, 0.34, 0.1) };
    const rock = look ? look.rock.map((c) => Math.min(1, c * 1.05)) : null;
    this.mat = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, color: rock ? new THREE.Color(rock[0], rock[1], rock[2]) : new THREE.Color().setRGB(0.50, 0.42, 0.35, THREE.SRGBColorSpace), roughness: 0.94, metalness: 0.0 }), look ? 'rock-lush' : 'rock', (sh) => hookRock(sh, mossK, mossC));
    const RG = rc.WORLD && rc.WORLD.rockGlow; if (RG) this.mat.emissive.setRGB(...RG);      // Nyth: faint cold glow on rocks
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMat.onBeforeCompile = hookDepth; this.depthMat.customProgramCacheKey = () => 'rock-depth';
    const mk = (geo, cap, shadow) => {
      const m = new THREE.InstancedMesh(geo, this.mat, cap);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true; m.customDepthMaterial = this.depthMat;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); return m;
    };
    this.bigB = [0, 1].map((i) => mk(boulderGeo(2, i * 5 + 1), 9000, !look));
    this.smallB = [2, 3].map((i) => mk(boulderGeo(1, i * 5 + 1), 16000, false));
    // authored kit rocks (rocks.glb: rounded boulder / flat slab / standing stone, baked albedo + normal) replace the procedural boulders on lush worlds
    this.kitRocks = null;
    const rg = look && !look.noKit && GLB['verdant/rocks'];
    if (rg) {
      const kmat = (() => { let src = null; rg.scene.traverse((o) => { if (o.isMesh && !src) src = o.material; }); const m = src.clone(); m.vertexColors = false; m.envMapIntensity = 0.4; m.roughness = 0.92; if (RG) m.emissive.setRGB(...RG); setupMat(m, 'rock-kit', applyCurvature); return m; })();
      const part = (node) => { let g = null; rg.scene.getObjectByName(node).traverse((o) => { if (o.isMesh && !g) g = o.geometry; }); return g; };
      const half = [1.5, 2.3, 0.95];
      this.kitRocks = ['a', 'b', 'c'].map((n, i) => ['LOD0', 'LOD1'].map((l, lod) => { const m = new THREE.InstancedMesh(part('rock_' + n + '_' + l), kmat, lod === 0 ? 1400 : 9000); m.count = 0; m.frustumCulled = false; m.castShadow = lod === 0; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); return m; }));
      this.kitHalf = half;
    }
    this.spireNear = [0, 1, 2, 3, 4].map((v) => mk(spireGeo(v, 72, 30), 400, true));
    this.spireFar = [0, 1, 2, 3, 4].map((v) => mk(spireGeo(v, 22, 12), 3000, false));
    this.arches = [0, 1, 2].map((v) => mk(archGeo(v), 120, true));
    this.regions = new Map(); this.spCells = new Map(); this.arCells = new Map();
    this.dirty = true; this.last = new THREE.Vector3(1e9, 0, 1e9); this.frame = 0;
    this.specials = []; this.specialKeys = new Set();
    this.colliders = [];   // rebuilt with instances: {x,z (true), r, top, y}
  }
  reset() { this.heroDone = false; this.regions.clear(); this.spCells.clear(); this.arCells.clear(); this.specials = []; this.specialKeys.clear(); this.dirty = true; this.last.set(1e9, 0, 1e9); }

  _boulderRegion(ix, iz) {
    const rc = this.rc, list = [];
    const sub = RS / 128;
    for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
      for (const b of rc.bouldersInCell(ix * sub + i, iz * sub + j, 128)) {
        const y = rc.heightAt(b.x, b.z);
        list.push({ x: b.x, z: b.z, y: y - b.r * 0.18, r: b.r, yaw: b.yaw, flat: b.flat, v: b.variant, tone: b.tone });
      }
    }
    return list;
  }
  _spireCell(ix, iz) {
    const list = [];
    for (const s of this.rc.spiresInCell(ix, iz, SC)) list.push({ ...s, y: this.rc.heightAt(s.x, s.z) });
    return list;
  }
  _archCell(ix, iz) {
    const list = [];
    for (const a of this.rc.archesInCell(ix, iz, AC)) {
      const y0 = this.rc.heightAt(a.x, a.z);
      const dx = Math.cos(a.yaw) * a.span * 0.5, dz = -Math.sin(a.yaw) * a.span * 0.5;
      const y = Math.min(y0, this.rc.heightAt(a.x + dx, a.z + dz), this.rc.heightAt(a.x - dx, a.z - dz));
      list.push({ ...a, y: y - 0.5 });
    }
    return list;
  }
  _addSpecials(cx, cz, rad) {
    for (const p of this.rc.poisNear(cx, cz, rad)) {
      const key = p.ix + ',' + p.iz; if (this.specialKeys.has(key)) continue;
      this.specialKeys.add(key);
      const y = this.rc.heightAt(p.x, p.z);
      if (p.type === 'arch') { const span = p.span || 92, yaw = p.yaw ?? (p.seed % 628) / 100; const dx = Math.cos(yaw) * span * 0.5, dz = -Math.sin(yaw) * span * 0.5; const yy = Math.min(y, this.rc.heightAt(p.x + dx, p.z + dz), this.rc.heightAt(p.x - dx, p.z - dz)); this.specials.push({ kind: 'arch', x: p.x, z: p.z, y: yy - 0.5, variant: p.seed % 3, yaw, span }); }
      else if (p.type === 'spire') this.specials.push({ kind: 'spire', x: p.x, z: p.z, y, variant: p.seed % 5, yaw: (p.seed % 628) / 100, h: 150, w: 0.5 });
      else if (p.type === 'meteor') for (let k = 0; k < 9; k++) {
        const a = k * 2.4, d = 2 + (k % 3) * 3.5, bx = p.x + Math.cos(a) * d, bz = p.z + Math.sin(a) * d;
        this.specials.push({ kind: 'boulder', x: bx, z: bz, y: this.rc.heightAt(bx, bz) - 0.2, r: 0.9 + (k % 4) * 0.55, yaw: a, flat: 0.8, v: k % 4 });
      }
    }
  }

  /** stream regions around the camera (scene-local coords) */
  update(cam) {
    this.frame++;
    const ox = this.t.origin.x, oz = this.t.origin.z, cx = cam.x + ox, cz = cam.z + oz;
    let changed = false, built = 0;
    // boulder regions: nearest first, 1-2 per frame
    const need = [];
    const i0 = Math.floor((cx - BR) / RS), i1 = Math.floor((cx + BR) / RS), j0 = Math.floor((cz - BR) / RS), j1 = Math.floor((cz + BR) / RS);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * RS - cx, dz = (j + 0.5) * RS - cz;
      if (dx * dx + dz * dz < (BR + RS) * (BR + RS)) need.push([i, j, dx * dx + dz * dz]);
    }
    need.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of need) {
      const k = i + ',' + j;
      if (!this.regions.has(k)) { if (built >= 2) break; this.regions.set(k, this._boulderRegion(i, j)); built++; changed = true; }
    }
    if (this.frame % 30 === 0) for (const [k, v] of this.regions) {
      const [i, j] = k.split(',').map(Number);
      const dx = (i + 0.5) * RS - cx, dz = (j + 0.5) * RS - cz;
      if (dx * dx + dz * dz > (BR + RS * 2) ** 2) { this.regions.delete(k); changed = true; }
    }
    // spires + arches (cheap): build up to 60 cells/frame
    let cells = 0;
    const si0 = Math.floor((cx - SR) / SC), si1 = Math.floor((cx + SR) / SC), sj0 = Math.floor((cz - SR) / SC), sj1 = Math.floor((cz + SR) / SC);
    for (let j = sj0; j <= sj1 && cells < 60; j++) for (let i = si0; i <= si1 && cells < 60; i++) {
      const dx = (i + 0.5) * SC - cx, dz = (j + 0.5) * SC - cz; if (dx * dx + dz * dz > SR * SR) continue;
      const k = i + ',' + j;
      if (!this.spCells.has(k)) { this.spCells.set(k, this._spireCell(i, j)); cells++; changed = true; }
    }
    const ai0 = Math.floor((cx - AR) / AC), ai1 = Math.floor((cx + AR) / AC), aj0 = Math.floor((cz - AR) / AC), aj1 = Math.floor((cz + AR) / AC);
    for (let j = aj0; j <= aj1 && cells < 70; j++) for (let i = ai0; i <= ai1 && cells < 70; i++) {
      const k = i + ',' + j;
      if (!this.arCells.has(k)) { this.arCells.set(k, this._archCell(i, j)); cells++; changed = true; }
    }
    if (!this.heroDone && this.rc.HERO_SPIRES) { this.heroDone = true; for (const h of this.rc.HERO_SPIRES) this.specials.push({ kind: 'spire', x: h.x, z: h.z, y: this.rc.heightAt(h.x, h.z), variant: h.variant, yaw: h.yaw, h: h.h, w: h.w }); changed = true; }
    if (this.frame % 40 === 1) { const n = this.specialKeys.size; this._addSpecials(cx, cz, 14000); if (this.specialKeys.size !== n) changed = true; }
    if (this.spCells.size > 2600 && this.frame % 120 === 0) {
      for (const k of this.spCells.keys()) { const [i, j] = k.split(',').map(Number); const dx = (i + 0.5) * SC - cx, dz = (j + 0.5) * SC - cz; if (dx * dx + dz * dz > (SR * 1.3) ** 2) this.spCells.delete(k); }
    }
    const moved = Math.hypot(cx - this.last.x, cz - this.last.z);
    if (changed || this.dirty || moved > 35) { this.rebuild(cx, cz); this.last.set(cx, 0, cz); this.dirty = false; }
  }

  rebuild(cx, cz) {
    const ox = this.t.origin.x, oz = this.t.origin.z;
    this.colliders.length = 0;
    const counts = new Map();
    const put = (mesh, x, y, z, yaw, sx, sy, sz) => {
      const n = counts.get(mesh) || 0; if (n >= mesh.instanceMatrix.count) return;
      tmpQ.setFromAxisAngle(UP, yaw); tmpP.set(x - ox, y, z - oz); tmpS.set(sx, sy, sz);
      tmpM.compose(tmpP, tmpQ, tmpS); mesh.setMatrixAt(n, tmpM); counts.set(mesh, n + 1);
    };
    // boulders (distance-banded by size)
    for (const list of this.regions.values()) for (const b of list) {
      const d = Math.hypot(b.x - cx, b.z - cz);
      const maxD = 140 + b.r * 380;
      if (d > maxD) continue;
      if (this.kitRocks) { const vi = b.v % 3, k = b.r / this.kitHalf[vi], mm = this.kitRocks[vi][d < 55 + b.r * 40 ? 0 : 1]; put(mm, b.x, b.y, b.z, b.yaw, k, k * (0.75 + 0.45 * b.flat), k); }
      else if (b.r > 1.0) put(this.bigB[b.v & 1], b.x, b.y, b.z, b.yaw, b.r, b.r * b.flat * 1.1, b.r * (0.8 + 0.3 * b.flat));
      else put(this.smallB[b.v & 1], b.x, b.y, b.z, b.yaw, b.r, b.r * b.flat * 1.1, b.r * (0.8 + 0.3 * b.flat));
      if (b.r > 1.4 && d < 260) this.colliders.push({ x: b.x, z: b.z, r: b.r * 0.9, top: b.y + b.r * 0.9 });
    }
    for (const b of this.specials) if (b.kind === 'boulder') { if (this.kitRocks) { const vi = b.v % 3, k = b.r * 1.3 / this.kitHalf[vi]; put(this.kitRocks[vi][0], b.x, b.y, b.z, b.yaw, k, k * b.flat, k); } else put(this.bigB[b.v & 1], b.x, b.y, b.z, b.yaw, b.r * 1.3, b.r * b.flat * 1.3, b.r * 1.2); this.colliders.push({ x: b.x, z: b.z, r: b.r * 1.1, top: b.y + b.r }); }
    // spires
    const spireList = [...this.specials.filter((s) => s.kind === 'spire')];
    for (const cell of this.spCells.values()) for (const s of cell) spireList.push(s);
    for (const s of spireList) {
      const d = Math.hypot(s.x - cx, s.z - cz);
      const hw = s.h * s.w * 0.5;
      const mesh = (d < this.nearSpire ? this.spireNear : this.spireFar)[s.variant % 5];
      put(mesh, s.x, s.y, s.z, s.yaw, hw * 2, s.h, hw * 2);
      if (d < 700) this.colliders.push({ x: s.x, z: s.z, r: s.h * s.w * 0.55, top: s.y + s.h });
    }
    // arches
    const archList = [...this.specials.filter((s) => s.kind === 'arch')];
    for (const cell of this.arCells.values()) for (const a of cell) archList.push(a);
    for (const a of archList) {
      put(this.arches[a.variant % 3], a.x, a.y, a.z, a.yaw, a.span, a.span, a.span);
      const d = Math.hypot(a.x - cx, a.z - cz);
      if (d < 900) { const dx = Math.cos(a.yaw) * a.span * 0.5, dz = -Math.sin(a.yaw) * a.span * 0.5;
        const pr = a.span * 0.075; const top = a.y + a.span * 0.4;
        this.colliders.push({ x: a.x + dx, z: a.z + dz, r: pr, top }, { x: a.x - dx, z: a.z - dz, r: pr, top }); }
    }
    for (const m of [...this.bigB, ...this.smallB, ...this.spireNear, ...this.spireFar, ...this.arches, ...(this.kitRocks ? this.kitRocks.flat() : [])]) {
      m.count = counts.get(m) || 0; m.instanceMatrix.needsUpdate = true;
    }
  }

  /** circle-vs-cylinders push-out in TRUE coordinates; (x,z) local scene coords. Returns {px,pz,hit} */
  collide(x, z, y, radius, out = { px: 0, pz: 0, hit: false, nx: 0, nz: 0 }) {
    const ox = this.t.origin.x, oz = this.t.origin.z, tx = x + ox, tz = z + oz;
    out.px = 0; out.pz = 0; out.hit = false;
    const absY = y + this.rc.heightAt(tx, tz);        // y is height above the ground here; colliders store absolute tops
    const lists = this.extraColliders ? [this.colliders, this.extraColliders] : [this.colliders];
    for (const list of lists) for (const c of list) {
      if (absY > c.top + 1.5) continue;
      const dx = tx - c.x, dz = tz - c.z, rr = c.r + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-3, push = rr - d;
        out.px += (dx / d) * push; out.pz += (dz / d) * push; out.nx = dx / d; out.nz = dz / d; out.hit = true;
      }
    }
    return out;
  }
}
