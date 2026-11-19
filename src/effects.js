// Particles (gunsmoke, muzzle flash, dust), cannonballs, corpses.
// Smoke is an instanced billboard pool shaded as a volume: generated normal/thickness atlas, sun-lit from the scene's
// DirectionalLight, forward scatter, cheap self-shadow, soft depth fade against a half-res scene depth pass and a
// back-to-front CPU sort of the instance buffer.
import * as THREE from 'three';
import { SCALE } from './units.js';
import { HORIZON } from './scene.js';

const R = Math.random;
const ATLAS = 4;                                   // 4x4 grid of smoke variants

// ---- cauliflower smoke atlas: lobed metaball density + domain-warped fbm.
// R,G = fake surface normal xy (from the height field), B = core thickness, A = density
function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, s) { return vnoise(x, y, s) * 0.5 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.28 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.14 + vnoise(x * 8.7, y * 8.7, s + 29) * 0.08; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function makeSmokeAtlas() {
  const S = 160, W = S * ATLAS, data = new Uint8Array(W * W * 4), h = new Float32Array(S * S), al = new Float32Array(S * S);
  for (let c = 0; c < ATLAS * ATLAS; c++) {
    const seed = c * 17 + 3, blobs = [];
    const nb = 13 + Math.floor(R() * 7);
    for (let i = 0; i < nb; i++) { // big lobes
      const a = R() * 6.283, d = Math.sqrt(R()) * 0.24;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.9, 0.11 + R() * 0.10, 0.7 + R() * 0.5]);
    }
    for (let i = 0; i < 12; i++) { // small rim bumps -> cauliflower edge
      const a = R() * 6.283, d = 0.17 + R() * 0.15;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.9, 0.05 + R() * 0.05, 0.5 + R() * 0.4]);
    }
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S - 0.5, v = (py + 0.5) / S - 0.5;
      const wu = u + (fbm(u * 4 + 5, v * 4, seed) - 0.5) * 0.10, wv = v + (fbm(u * 4, v * 4 + 9, seed + 1) - 0.5) * 0.10;
      let d = 0;
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i], dx = wu - b[0], dy = wv - b[1], t2 = (dx * dx + dy * dy) / (b[2] * b[2]);
        if (t2 < 1) { const f = 1 - t2; d += b[3] * f * f; }
      }
      d *= 0.65 + 0.7 * fbm(u * 11 + 3, v * 11 + 3, seed + 2);
      const rad = Math.hypot(u, v), k = py * S + px;
      h[k] = d;
      al[k] = sstep(0.15, 0.80, d) * (1 - sstep(0.28, 0.47, rad));
    }
    const ox = (c % ATLAS) * S, oy = Math.floor(c / ATLAS) * S;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const k = py * S + px;
      const gx = h[py * S + Math.min(S - 1, px + 3)] - h[py * S + Math.max(0, px - 3)];   // +u = right
      const gy = h[Math.min(S - 1, py + 3) * S + px] - h[Math.max(0, py - 3) * S + px];   // +v = up on the quad
      const nx = Math.max(-1, Math.min(1, -gx * 1.5)), ny = Math.max(-1, Math.min(1, -gy * 1.5));
      const o = ((oy + py) * W + ox + px) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = Math.pow(Math.min(1, h[k] / 1.3), 0.8) * 255;
      data[o + 3] = al[k] * 255;
    }
  }
  const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return t;
}
function makeFlashTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d'), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,200,110,0.8)'); g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const VERT = `
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iT; attribute vec4 iM; attribute vec3 iCol;
uniform float uTime; uniform vec3 uWind; uniform float uDrag; uniform float uFadeIn; uniform float uFadeOut; uniform float uAtlas;
uniform float uLift; uniform float uWob; uniform float uGrav; uniform float uGrow; uniform float uShear; uniform vec3 uSunDir;
varying vec2 vLoc; varying vec2 vCell; varying vec2 vN; varying vec2 vRot; varying float vA; varying float vAge; varying float vDepth; varying float vSize;
varying vec3 vCol; varying vec3 vSunV; varying vec3 vUpV; varying vec3 vVP; varying float vSeed;
void main(){
  float age = uTime - iT.x;
  if (age < 0.0 || age > iT.y) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  float a = age / iT.y;
  vec3 p = iPos + iVel * ((1.0 - exp(-uDrag*age)) / uDrag);
  float sh = 1.0 + uShear * (fract(iM.x * 37.0) - 0.5);                    // per-puff wind variation = slow shear
  p += uWind * age * sh;
  p.y -= 0.5 * uGrav * age * age;
  float g = (1.0 - exp(-uGrow*a)) / (1.0 - exp(-uGrow));
  float size = mix(iT.z, iT.w, g);
  float ph = iM.x * 23.0;
  p.xz += uWob * size * vec2(sin(age * 0.55 + ph), cos(age * 0.43 + ph * 1.3)) * smoothstep(0.0, 0.3, a);
  p.y += size * uLift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = iM.x + iM.w * age;
  vec2 q = position.xy; float cs = cos(rot), sn = sin(rot);
  vN = q * 2.0; vRot = vec2(cs, sn);
  q = vec2(cs*q.x - sn*q.y, sn*q.x + cs*q.y);
  mv.xy += q * size;
  gl_Position = projectionMatrix * mv;
  vCell = vec2(mod(iM.y, uAtlas), floor(iM.y / uAtlas));
  vLoc = uv;
  float nearF = smoothstep(2.0 + size * 0.4, 10.0 + size * 1.1, -mv.z);
  vA = iM.z * smoothstep(0.0, uFadeIn, a) * (1.0 - smoothstep(uFadeOut, 1.0, a)) * nearF;
  vCol = iCol; vDepth = -mv.z; vAge = a; vSize = size; vVP = mv.xyz; vSeed = fract(iM.x * 91.7);
  vSunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
}`;
const FRAG = `
#include <packing>
uniform sampler2D uMap; uniform sampler2D uDepth; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uLight; uniform float uGain;
uniform float uAtlas; uniform float uThick; uniform float uErode; uniform float uAmb; uniform vec3 uSunCol; uniform vec3 uSky;
uniform vec2 uView; uniform float uNear; uniform float uFar; uniform float uDepthOn;
varying vec2 vLoc; varying vec2 vCell; varying vec2 vN; varying vec2 vRot; varying float vA; varying float vAge; varying float vDepth; varying float vSize;
varying vec3 vCol; varying vec3 vSunV; varying vec3 vUpV; varying vec3 vVP; varying float vSeed;
float sceneZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(uDepth, uv).x, uNear, uFar); }
// fraction of this puff's depth extent that lies in front of the opaque scene (4 taps = smoothed edge)
float softFade(float thick){
  vec2 uv = gl_FragCoord.xy / uView, o = 1.2 / uView;
  float front = vDepth - thick * 0.5, s = 0.0;
  s += clamp((sceneZ(uv + vec2( o.x,  o.y)) - front) / thick, 0.0, 1.0);
  s += clamp((sceneZ(uv + vec2(-o.x,  o.y)) - front) / thick, 0.0, 1.0);
  s += clamp((sceneZ(uv + vec2( o.x, -o.y)) - front) / thick, 0.0, 1.0);
  s += clamp((sceneZ(uv + vec2(-o.x, -o.y)) - front) / thick, 0.0, 1.0);
  s *= 0.25;
  return s * s * (3.0 - 2.0 * s);
}
void main(){
  vec2 uv = (vLoc + vCell) / uAtlas;
  vec4 t = texture2D(uMap, uv);
  // thinning: the ragged low-density edge erodes away as the puff ages
  float er = vAge * uErode;
  float dens = clamp((t.a - er) / (1.0 - er), 0.0, 1.0);
  float al = dens * vA; if (al < 0.003) discard;
  if (uDepthOn > 0.5) { al *= softFade(max(vSize * uThick * max(t.b, 0.35), 0.05)); if (al < 0.003) discard; }
  vec3 c;
  if (uLight > 0.5) {
    // view-space normal: sphere blended with the baked relief (rotated with the billboard)
    vec2 tn = t.rg * 2.0 - 1.0;
    tn = vec2(vRot.x * tn.x - vRot.y * tn.y, vRot.y * tn.x + vRot.x * tn.y);
    float r2 = min(1.0, dot(vN, vN));
    vec3 n = normalize(vec3(vN * 0.85 + tn * 1.3, sqrt(1.0 - r2) * 0.9 + 0.25));
    float ndl = dot(n, vSunV);
    float sunTerm = smoothstep(0.0, 1.0, clamp((ndl + 0.4) / 1.4, 0.0, 1.0));
    // self-shadow: look toward the sun through the thickness map; thicker material that way shades this texel
    vec2 sv = vSunV.xy;
    vec2 dt = vec2(vRot.x * sv.x + vRot.y * sv.y, -vRot.y * sv.x + vRot.x * sv.y);
    float h1 = texture2D(uMap, (clamp(vLoc + dt * 0.07, 0.01, 0.99) + vCell) / uAtlas).b;
    float h2 = texture2D(uMap, (clamp(vLoc + dt * 0.16, 0.01, 0.99) + vCell) / uAtlas).b;
    float shadow = clamp((h1 * 0.55 + h2 * 0.45 - t.b * 0.55) * 2.2, 0.0, 1.0);
    float sunVis = 1.0 - 0.8 * shadow;
    // bank base: darker toward the bottom of each puff and in dense cores
    float up = dot(vN, vUpV.xy);
    float ao = mix(0.52, 1.0, smoothstep(-0.95, 0.55, up)) * mix(1.0, 0.76, t.b * t.b);
    float up01 = dot(n, vUpV) * 0.5 + 0.5;
    vec3 amb = uSky * (mix(0.38, 1.0, up01) * uAmb);
    // forward scatter: looking toward the sun lights thin edges and bleeds light through the puff
    float cosT = dot(normalize(vVP), vSunV);
    float fs = pow(clamp(cosT, 0.0, 1.0), 2.5);
    float edge = 1.0 - t.b;
    vec3 scat = uSunCol * fs * (0.28 + 0.6 * edge + 0.5 * edge * edge);
    vec3 albedo = vCol * (0.93 + 0.1 * vSeed);
    c = albedo * ((uSunCol * sunTerm * sunVis + amb) * ao + scat);
    c *= mix(1.0, 0.9, vAge);
  } else {
    c = t.rgb * vCol * uGain;
  }
  c = mix(c, uFog, smoothstep(uFogNear, uFogFar, vDepth) * 0.75);
  gl_FragColor = vec4(c, al);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Shared look/wind/depth uniforms. Effects.update refreshes them; every pool's material points at the same objects.
const makeShared = (scene) => ({
  uWind: { value: new THREE.Vector3(1.1, 0.05, 0.4) },
  uSunDir: { value: new THREE.Vector3(-0.82, 0.40, 0.28).normalize() },   // overwritten from the scene's DirectionalLight
  uSunCol: { value: new THREE.Color(1.15, 0.8, 0.5) },
  uSky: { value: new THREE.Color(0.2, 0.25, 0.33) },
  uFog: { value: scene.fog ? scene.fog.color : new THREE.Color(HORIZON) },
  uFogNear: { value: scene.fog ? scene.fog.near : 350 }, uFogFar: { value: scene.fog ? scene.fog.far : 1900 },
  uDepth: { value: null }, uView: { value: new THREE.Vector2(1, 1) }, uNear: { value: 1 }, uFar: { value: 4500 }, uDepthOn: { value: 0 },
});

class Particles {
  constructor(scene, world, shared, owner, { capacity, texture, additive, atlas = 1, drag = 0.5, fadeIn = 0.08, fadeOut = 0.5, wind = null, light = true, lift = 0, wob = 0, grav = 0, grow = 4, shear = 0, thick = 0.5, erode = 0, gain = 1, reject = 0, every = 3, order = 8 }) {
    this.w = world; this.cap = capacity; this.reject = reject; this.every = every; this.drag = drag; this.live = 0; this.fresh = 0; this.lastSync = -99; this.owner = owner;
    this.windV = wind ? new THREE.Vector3(...wind) : shared.uWind.value;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const sizes = { iPos: 3, iVel: 3, iT: 4, iM: 4, iCol: 3 };
    this.m = {}; this.a = {};   // m = ring-buffer master data (spawn order); a = GPU copy rewritten back-to-front on sync
    for (const k in sizes) {
      this.m[k] = new Float32Array(capacity * sizes[k]);
      const at = new THREE.InstancedBufferAttribute(new Float32Array(capacity * sizes[k]), sizes[k]); at.setUsage(THREE.DynamicDrawUsage);
      this.a[k] = at; g.setAttribute(k, at);
    }
    this.sizes = sizes; this.keys = new Float32Array(capacity); this.idx = new Uint32Array(capacity);
    for (let i = 0; i < capacity; i++) this.m.iT[i * 4] = 1e9;   // dead by default
    g.instanceCount = 0; this.geo = g; this.head = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uMap: { value: texture }, uTime: { value: 0 }, uWind: wind ? { value: this.windV } : shared.uWind, uDrag: { value: drag }, uFadeIn: { value: fadeIn }, uFadeOut: { value: fadeOut }, uAtlas: { value: atlas },
        uLift: { value: lift }, uWob: { value: wob }, uGrav: { value: grav }, uGrow: { value: grow }, uShear: { value: shear }, uThick: { value: thick }, uErode: { value: erode }, uGain: { value: gain },
        uLight: { value: light ? 1 : 0 }, uAmb: { value: 1.9 },
        uSunDir: shared.uSunDir, uSunCol: shared.uSunCol, uSky: shared.uSky, uFog: shared.uFog, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar,
        uDepth: shared.uDepth, uView: shared.uView, uNear: shared.uNear, uFar: shared.uFar, uDepthOn: shared.uDepthOn,
      },
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    this.mesh.onBeforeRender = (renderer, sc, camera) => owner.prepare(renderer, camera, this);
    scene.add(this.mesh);
  }
  // returns false when the pool is saturated with young puffs (reject pools only), so clouds never pop out early
  spawn(x, y, z, vx, vy, vz, life, s0, s1, alpha, col, atlasIdx = 0, delay = 0) {
    const i = this.head, M = this.m, T = M.iT;
    if (this.reject) {
      const age = this.w.time - T[i * 4];
      if (age >= 0 && age < this.reject * T[i * 4 + 1]) return false;
    }
    this.head = (i + 1) % this.cap;
    M.iPos.set([x, y, z], i * 3); M.iVel.set([vx, vy, vz], i * 3);
    T[i * 4] = this.w.time + delay; T[i * 4 + 1] = life; T[i * 4 + 2] = s0; T[i * 4 + 3] = s1;
    M.iM.set([(R() - 0.5) * 0.7, atlasIdx, alpha, (R() - 0.5) * 0.1], i * 4);
    M.iCol.set(col, i * 3);
    this.fresh++;
    return true;
  }
  // copy live puffs into the GPU buffers sorted far -> near along the camera's view axis
  sync(camera, frame) {
    if (frame - this.lastSync < this.every) return;
    this.lastSync = frame;
    const t = this.w.time, M = this.m, T = M.iT, P = M.iPos, V = M.iVel, e = camera.matrixWorldInverse.elements, wd = this.windV, dr = this.drag, keys = this.keys, idx = this.idx;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      const age = t - T[i * 4];
      if (age < 0 || age > T[i * 4 + 1]) continue;
      const k = (1 - Math.exp(-dr * age)) / dr, x = P[i * 3] + V[i * 3] * k + wd.x * age, y = P[i * 3 + 1] + V[i * 3 + 1] * k + wd.y * age, z = P[i * 3 + 2] + V[i * 3 + 2] * k + wd.z * age;
      keys[i] = e[2] * x + e[6] * y + e[10] * z + e[14];
      idx[n++] = i;
    }
    this.live = n; this.fresh = 0;
    const sub = idx.subarray(0, n); sub.sort((p, q) => keys[p] - keys[q]);   // most negative view z (farthest) first
    for (const k in this.sizes) {
      const sz = this.sizes[k], src = M[k], dst = this.a[k];
      for (let j = 0; j < n; j++) { const s = sub[j] * sz, d = j * sz; for (let c = 0; c < sz; c++) dst.array[d + c] = src[s + c]; }
      dst.clearUpdateRanges(); if (n > 0) dst.addUpdateRange(0, n * sz); dst.needsUpdate = true;
    }
    this.geo.instanceCount = n;
  }
  flush() { this.mat.uniforms.uTime.value = this.w.time; }
}

// Half-res depth of the opaque scene for soft particles. Rendered from inside the first particle mesh's onBeforeRender
// (Reflector-style nested render) so no other module has to cooperate. Falls back to hard-edged particles on any error.
class SceneDepth {
  constructor(scene, shared) {
    this.scene = scene; this.u = shared; this.rt = null; this.ok = true; this.stamp = -1; this.hide = []; this.nKids = -1; this.age = 0;
    this.mat = new THREE.MeshDepthMaterial(); this.mat.colorWrite = false; this.mat.side = THREE.DoubleSide;
    this.v2 = new THREE.Vector2(); this.mine = new Set();
  }
  refresh() {   // objects that must not write depth: blended/overlay/sky meshes and our own particle meshes
    this.hide.length = 0;
    this.scene.traverse((o) => {
      if (this.mine.has(o)) { this.hide.push(o); return; }
      if (o.isSprite || o.isPoints || o.isLine) { this.hide.push(o); return; }
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.some((m) => !m || m.transparent || m.depthWrite === false || m.side === THREE.BackSide)) this.hide.push(o);
    });
    this.nKids = this.scene.children.length; this.age = 0;
  }
  run(renderer, camera, want) {
    const u = this.u;
    if (!want || !this.ok) { u.uDepthOn.value = 0; return; }
    const cur = renderer.getRenderTarget();
    let rw, rh;
    if (cur) { rw = cur.width; rh = cur.height; } else { renderer.getDrawingBufferSize(this.v2); rw = this.v2.x; rh = this.v2.y; }
    const w = Math.max(2, rw >> 1), h = Math.max(2, rh >> 1);
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.rt.depthTexture = new THREE.DepthTexture(w, h);
      u.uDepth.value = this.rt.depthTexture;
    }
    if (this.nKids !== this.scene.children.length || ++this.age > 90) this.refresh();
    const sc = this.scene, ac = renderer.autoClear, su = renderer.shadowMap.autoUpdate, sn = renderer.shadowMap.needsUpdate, ar = renderer.info.autoReset, xr = renderer.xr.enabled, om = sc.overrideMaterial;
    const vis = this.hide.map((o) => o.visible);
    try {
      for (const o of this.hide) o.visible = false;
      renderer.autoClear = true; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; renderer.info.autoReset = false; renderer.xr.enabled = false;
      sc.overrideMaterial = this.mat;
      renderer.setRenderTarget(this.rt);
      renderer.render(sc, camera);
      u.uDepthOn.value = 1;
    } catch (err) {
      this.ok = false; u.uDepthOn.value = 0; console.warn('soft particle depth pass disabled:', err);
    } finally {
      sc.overrideMaterial = om;
      renderer.setRenderTarget(cur);
      renderer.autoClear = ac; renderer.shadowMap.autoUpdate = su; renderer.shadowMap.needsUpdate = sn; renderer.info.autoReset = ar; renderer.xr.enabled = xr;
      this.hide.forEach((o, i) => { o.visible = vis[i]; });
    }
    u.uView.value.set(rw, rh); u.uNear.value = camera.near; u.uFar.value = camera.far;
  }
}

const rv = () => Math.floor(R() * ATLAS * ATLAS);
const WHITE = [1, 0.98, 0.94];
const GREY = [0.97, 0.96, 0.94];
const LUM = new THREE.Vector3(0.2126, 0.7152, 0.0722);

export class Effects {
  constructor(scene, world, models) {
    this.w = world; this.scene = scene; this._frame = 0; this.load = 0; this._lightAge = 1e9; this._sunL = null; this._hemiL = null;
    const atlas = makeSmokeAtlas();
    const sh = this.sh = makeShared(scene);
    const P = (o) => new Particles(scene, world, sh, this, { texture: atlas, atlas: ATLAS, ...o });
    // long-lived banks: slow growth, slow thinning, wind shear; reject so clouds never pop out early
    this.smoke = P({ capacity: 3500, drag: 0.35, fadeIn: 0.05, fadeOut: 0.55, lift: 0.32, wob: 0.05, grow: 2.2, shear: 0.5, thick: 0.5, erode: 0.55, reject: 0.3, every: 3, order: 8 });
    this.puff = P({ capacity: 1500, drag: 0.6, fadeIn: 0.06, fadeOut: 0.45, lift: 0.25, wob: 0.05, grow: 3, shear: 0.3, thick: 0.4, erode: 0.4, reject: 0.45, every: 3, order: 8 });
    this.dust = P({ capacity: 1000, drag: 1.2, fadeIn: 0.08, fadeOut: 0.4, lift: 0.2, wob: 0.03, thick: 0.35, erode: 0.3, every: 2, order: 7 });
    this.dirt = P({ capacity: 800, drag: 0.4, fadeIn: 0.03, fadeOut: 0.6, grav: 16, wind: [0.3, 0, 0.1], thick: 0.2, every: 2, order: 7 });
    this.flash = P({ capacity: 600, texture: makeFlashTexture(), additive: true, light: false, drag: 1, fadeIn: 0.05, fadeOut: 0.2, wind: [0, 0, 0], thick: 0.1, gain: 2.4, every: 1, order: 9 });
    this.pools = [this.smoke, this.puff, this.dust, this.dirt, this.flash];
    this.depth = new SceneDepth(scene, sh);
    for (const p of this.pools) this.depth.mine.add(p.mesh);
    this._trail = new WeakMap();

    this.ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4 * SCALE, 8, 6), new THREE.MeshLambertMaterial({ color: 0x1c1c1c }), 64);
    this.ballMesh.count = 0; this.ballMesh.frustumCulled = false; this.ballMesh.castShadow = true; scene.add(this.ballMesh);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.corpseCap = 1600; this.corpse = {};
    for (const side of ['player', 'enemy']) {
      const m = new THREE.InstancedMesh(models.corpse[side], mat, this.corpseCap);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m);
      this.corpse[side] = { mesh: m, head: 0 };
    }
    this.horseCorpse = new THREE.InstancedMesh(models.horse[0], mat, 500);
    this.horseCorpse.count = 0; this.horseCorpse.frustumCulled = false; this.horseCorpse.castShadow = true; scene.add(this.horseCorpse);
    this.hcHead = 0; this.falling = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  // called from each particle mesh's onBeforeRender: once-per-frame depth pass, then that pool's back-to-front sync
  prepare(renderer, camera, pool) {
    const f = this._frame;
    if (this.depth.stamp !== f) { this.depth.stamp = f; this.depth.run(renderer, camera, this.smoke.live + this.puff.live + this.dust.live > 0); }
    pool.sync(camera, f);
  }
  // sun direction/colour and sky ambient come from the scene's own lights so the grade stays in one place
  _readLights() {
    if (this._lightAge++ > 300 || !this._sunL) {
      this._lightAge = 0; this._sunL = null; this._hemiL = null;
      this.scene.traverse((o) => { if (o.isDirectionalLight && !this._sunL) this._sunL = o; else if (o.isHemisphereLight && !this._hemiL) this._hemiL = o; });
    }
    const s = this._sunL, u = this.sh;
    if (s) {
      u.uSunDir.value.copy(s.position).sub(s.target.position);
      if (u.uSunDir.value.lengthSq() > 1e-6) u.uSunDir.value.normalize(); else u.uSunDir.value.set(-0.82, 0.4, 0.28).normalize();
      const l = LUM.x * s.color.r + LUM.y * s.color.g + LUM.z * s.color.b, k = s.intensity / Math.PI;
      u.uSunCol.value.setRGB((s.color.r + (l - s.color.r) * 0.1) * k * 1.05, (s.color.g + (l - s.color.g) * 0.1) * k * 1.05, (s.color.b + (l - s.color.b) * 0.1) * k * 1.05);
    }
    const h = this._hemiL;
    if (h) u.uSky.value.setRGB(h.color.r * h.intensity / Math.PI, h.color.g * h.intensity / Math.PI, h.color.b * h.intensity / Math.PI);
  }
  // ---- spawners
  musket(x, y, z, dx, dz, big = 1) {
    // muzzle flash, then (thinned as the pool fills) a big slow puff that builds the rolling bank in front of the line
    this.flash.spawn(x + dx * 0.4, y, z + dz * 0.4, 0, 0, 0, 0.11, 1.6 * big, 4.2 * big, 1, [1, 0.82, 0.5]);
    if (R() > 0.5 * Math.min(1, Math.max(0.05, (1 - this.load) * 1.6))) return;
    const sp = 1.5 + R() * 2, lf = 0.75 + 0.25 * big;
    const ok = this.smoke.spawn(x + dx * 0.9, y, z + dz * 0.9, dx * sp + (R() - 0.5) * 0.8, 0.3 + R() * 0.5, dz * sp + (R() - 0.5) * 0.8, (16 + R() * 12) * lf, 3.5 * big, (18 + R() * 10) * big, 0.55 + R() * 0.15, WHITE, rv());
    if (ok && R() < 0.25) this.smoke.spawn(x + dx * 2, y + 0.4, z + dz * 2, dx * sp * 1.8 + (R() - 0.5), 0.5, dz * sp * 1.8 + (R() - 0.5), (13 + R() * 8) * lf, 2.5 * big, (12 + R() * 6) * big, 0.45, GREY, rv(), 0.3);
  }
  cannon(x, y, z, dx, dz) {
    this.flash.spawn(x + dx * 1.5, y, z + dz * 1.5, 0, 0, 0, 0.2, 4, 15, 1, [1, 0.78, 0.42]);
    this.flash.spawn(x + dx * 3, y + 0.2, z + dz * 3, dx * 6, 0, dz * 6, 0.14, 2, 8, 0.9, [1, 0.9, 0.6]);
    for (let i = 0; i < 5; i++) { // blast rolling out along the barrel line
      const sp = 5 + R() * 6;
      this.smoke.spawn(x + dx * (1 + i * 0.8) + (R() - 0.5) * 2, y + R() * 0.8, z + dz * (1 + i * 0.8) + (R() - 0.5) * 2, dx * sp + (R() - 0.5) * 3, 0.6 + R() * 1.0, dz * sp + (R() - 0.5) * 3, 18 + R() * 12, 5 + R() * 3, 26 + R() * 14, 0.68 + R() * 0.12, WHITE, rv(), i * 0.05);
    }
    for (let i = 0; i < 7; i++) { // billowing column: staggered puffs that climb and swell
      this.smoke.spawn(x + dx * (1.5 + R() * 2) + (R() - 0.5) * 2.5, y + i * 0.9 + R(), z + dz * (1.5 + R() * 2) + (R() - 0.5) * 2.5, (R() - 0.5) * 2 + dx * 1.5, 1.2 + R() * 2.4, (R() - 0.5) * 2 + dz * 1.5, 20 + R() * 10, 4 + R() * 3, 22 + R() * 14 + i * 1.5, 0.66 + R() * 0.14, i < 3 ? WHITE : GREY, rv(), 0.15 + i * 0.22);
    }
    for (let i = 0; i < 4; i++) { // blast scours dust off the ground in front of the muzzle
      const a = (R() - 0.5) * 2.4, c = Math.cos(a), s = Math.sin(a), sp = 6 + R() * 6;
      this.dust.spawn(x + dx * 2, y - 1, z + dz * 2, (dx * c - dz * s) * sp, 0.3, (dx * s + dz * c) * sp, 3 + R() * 2, 2, 6 + R() * 4, 0.45, [0.55, 0.43, 0.3], rv());
    }
  }
  dustKick(x, y, z, n = 3, size = 4) {
    for (let i = 0; i < n; i++) this.dust.spawn(x + (R() - 0.5) * 1.5, y + 0.3, z + (R() - 0.5) * 1.5, (R() - 0.5) * 3, 1.5 + R() * 2, (R() - 0.5) * 3, 2.5 + R() * 2.5, 0.8, size * (0.8 + R() * 0.8), 0.55, [0.55, 0.43, 0.3], rv());
    if (n >= 2) for (let i = 0; i < n * 2; i++) { // flying dirt clods
      const a = R() * 6.283, sp = 2 + R() * 5;
      this.dirt.spawn(x, y + 0.3, z, Math.cos(a) * sp, 4 + R() * 7, Math.sin(a) * sp, 0.9 + R() * 0.9, 0.5, 0.9 + R() * 0.6, 0.85, [0.32, 0.23, 0.15], rv());
    }
  }
  // ---- corpses
  addCorpse(side, x, y, z, yaw) {
    const c = this.corpse[side], i = c.head; c.head = (c.head + 1) % this.corpseCap;
    c.mesh.count = Math.max(c.mesh.count, i + 1);
    this.falling.push({ c, i, x, y, z, yaw: yaw + (R() - 0.5) * 0.8, t: 0, dir: R() < 0.7 ? 1 : -1, roll: R() < 0.2 });
  }
  addHorseCorpse(x, y, z, yaw) {
    const i = this.hcHead; this.hcHead = (this.hcHead + 1) % 500; this.horseCorpse.count = Math.max(this.horseCorpse.count, i + 1);
    this._e.set(0, yaw, R() < 0.5 ? Math.PI / 2 : -Math.PI / 2); this._q.setFromEuler(this._e);
    this._p.set(x, y + 0.5 * SCALE, z); this._s.set(SCALE, SCALE, SCALE);
    this.horseCorpse.setMatrixAt(i, this._m.compose(this._p, this._q, this._s)); this.horseCorpse.instanceMatrix.needsUpdate = true;
  }
  setBalls(list) {
    const m = this.ballMesh, t = this.w.time; m.count = 0; this._s.set(2, 2, 2);
    for (const b of list) {
      if (m.count >= 64) break;
      this._m.compose(this._p.set(b.x, b.y, b.z), this._q.identity(), this._s); m.setMatrixAt(m.count++, this._m);
      const last = this._trail.get(b);
      if (last === undefined) this._trail.set(b, t);
      else if (t - last >= 0.04) { // thin smoke trail so the shot's flight is readable
        this._trail.set(b, t);
        this.puff.spawn(b.x, b.y, b.z, (R() - 0.5) * 0.6, 0.2 + R() * 0.3, (R() - 0.5) * 0.6, 2 + R() * 1.5, 0.6, 2.4 + R() * 0.8, 0.3, [0.95, 0.95, 0.93], rv());
      }
    }
    m.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k]; f.t += dt;
      const e = Math.min(1, f.t / 0.55), a = e * e * (Math.PI / 2) * f.dir * 0.97;
      this._e.set(f.roll ? 0 : a, f.yaw, f.roll ? a : 0); this._q.setFromEuler(this._e);
      this._p.set(f.x, f.y + 0.12 * e, f.z); this._s.set(SCALE, SCALE, SCALE);
      f.c.mesh.setMatrixAt(f.i, this._m.compose(this._p, this._q, this._s)); f.c.mesh.instanceMatrix.needsUpdate = true;
      if (e >= 1) this.falling.splice(k, 1);
    }
    this._frame++;
    this._readLights();
    this.load = (this.smoke.live + this.smoke.fresh) / this.smoke.cap;
    for (const p of this.pools) p.flush();
  }
}
