// Particles (gunsmoke, muzzle flash, dust), cannonballs, corpses.
import * as THREE from 'three';
import { SCALE } from './units.js';
import { HORIZON } from './scene.js';

const R = Math.random;
const ATLAS = 4;                                   // 4x4 grid of smoke variants
const SUN_DIR = new THREE.Vector3(-0.55, 0.5, 0.45).normalize(); // matches scene.js sunDir

// ---- cauliflower smoke atlas: lobed metaball density + domain-warped fbm, baked relief (R) and core thickness (G)
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
  const S = 192, W = S * ATLAS, data = new Uint8Array(W * W * 4), h = new Float32Array(S * S), al = new Float32Array(S * S);
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
      al[k] = sstep(0.14, 0.7, d) * (1 - sstep(0.33, 0.48, rad));
    }
    const ox = (c % ATLAS) * S, oy = Math.floor(c / ATLAS) * S;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const k = py * S + px;
      const gx = h[py * S + Math.min(S - 1, px + 2)] - h[py * S + Math.max(0, px - 2)];
      const gy = h[Math.min(S - 1, py + 2) * S + px] - h[Math.max(0, py - 2) * S + px];
      const bump = Math.max(-1, Math.min(1, -(gx * -0.7 + gy * -0.7) * 4));
      const o = ((oy + py) * W + ox + px) * 4;
      data[o] = (0.8 + 0.2 * bump) * 255;
      data[o + 1] = Math.min(1, h[k] / 1.4) * 255;
      data[o + 2] = 255;
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
uniform float uLift; uniform float uWob; uniform float uGrav; uniform vec3 uSunDir;
varying vec2 vUv; varying vec2 vN; varying float vA; varying float vAge; varying vec3 vCol; varying float vDepth; varying vec3 vSunV;
void main(){
  float age = uTime - iT.x;
  if (age < 0.0 || age > iT.y) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  float a = age / iT.y;
  vec3 p = iPos + iVel * ((1.0 - exp(-uDrag*age)) / uDrag) + uWind * age;
  p.y -= 0.5 * uGrav * age * age;
  float g = (1.0 - exp(-4.0*a)) / (1.0 - exp(-4.0));
  float size = mix(iT.z, iT.w, g);
  float ph = iM.x * 23.0;
  p.xz += uWob * size * vec2(sin(age * 0.55 + ph), cos(age * 0.43 + ph * 1.3)) * smoothstep(0.0, 0.3, a);
  p.y += size * uLift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = iM.x + iM.w * age;
  vec2 q = position.xy; float cs = cos(rot), sn = sin(rot);
  vN = q * 2.0;
  q = vec2(cs*q.x - sn*q.y, sn*q.x + cs*q.y);
  mv.xy += q * size;
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(iM.y, uAtlas), floor(iM.y / uAtlas));
  vUv = (uv + cell) / uAtlas;
  vA = iM.z * smoothstep(0.0, uFadeIn, a) * (1.0 - smoothstep(uFadeOut, 1.0, a)) * smoothstep(3.0, 18.0, -mv.z);
  vCol = iCol; vDepth = -mv.z; vAge = a;
  vSunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
}`;
const FRAG = `
uniform sampler2D uMap; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uLight;
varying vec2 vUv; varying vec2 vN; varying float vA; varying float vAge; varying vec3 vCol; varying float vDepth; varying vec3 vSunV;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float al = t.a * vA; if (al < 0.003) discard;
  vec3 c;
  if (uLight > 0.5) {
    // fake sphere normal in view space: sun side warm and bright, far side cool grey
    float r2 = min(1.0, dot(vN, vN));
    vec3 n = vec3(vN, sqrt(1.0 - r2));
    float sh = smoothstep(-0.2, 0.65, dot(n, vSunV));
    vec3 lit = mix(vec3(0.26, 0.32, 0.45), vec3(1.15, 1.03, 0.85), sh);
    lit *= mix(0.84, 1.0, vN.y * 0.5 + 0.5);                 // underside of the puff darker
    lit *= 1.0 - 0.3 * t.g;                                  // dense cores self-shadow
    lit *= mix(1.0, 0.86, vAge);                              // thinning smoke greys out
    c = vCol * lit * t.r;
  } else {
    c = t.rgb * vCol;
  }
  c = mix(c, uFog, smoothstep(uFogNear, uFogFar, vDepth) * 0.75);
  gl_FragColor = vec4(c, al);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, world, { capacity, texture, additive, atlas = 1, drag = 0.5, fadeIn = 0.08, fadeOut = 0.5, wind = [0.9, 0.08, 0.35], light = true, lift = 0, wob = 0, grav = 0, reject = false, order = 8 }) {
    this.w = world; this.cap = capacity; this.head = 0; this.dirty = false; this.reject = reject;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.a = { iPos: mk(3), iVel: mk(3), iT: mk(4), iM: mk(4), iCol: mk(3) };
    for (const k in this.a) g.setAttribute(k, this.a[k]);
    // dead by default: spawn time far in future with life 0
    for (let i = 0; i < capacity; i++) this.a.iT.array[i * 4] = 1e9;
    g.instanceCount = capacity;
    const fog = scene.fog;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: texture }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3(...wind) }, uDrag: { value: drag }, uFadeIn: { value: fadeIn }, uFadeOut: { value: fadeOut }, uAtlas: { value: atlas },
        uLift: { value: lift }, uWob: { value: wob }, uGrav: { value: grav }, uSunDir: { value: SUN_DIR }, uLight: { value: light ? 1 : 0 },
        uFog: { value: new THREE.Color(fog ? fog.color : HORIZON) }, uFogNear: { value: fog ? fog.near : 350 }, uFogFar: { value: fog ? fog.far : 1900 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
    scene.add(this.mesh);
  }
  // returns false when the pool is saturated with young puffs (reject pools only), so clouds never pop out early
  spawn(x, y, z, vx, vy, vz, life, s0, s1, alpha, col, atlasIdx = 0) {
    const i = this.head, A = this.a, T = A.iT.array;
    if (this.reject) {
      const age = this.w.time - T[i * 4];
      if (age >= 0 && age < 0.45 * T[i * 4 + 1]) return false;
    }
    this.head = (i + 1) % this.cap;
    A.iPos.array.set([x, y, z], i * 3); A.iVel.array.set([vx, vy, vz], i * 3);
    T[i * 4] = this.w.time; T[i * 4 + 1] = life; T[i * 4 + 2] = s0; T[i * 4 + 3] = s1;
    A.iM.array.set([(R() - 0.5) * 0.7, atlasIdx, alpha, (R() - 0.5) * 0.05], i * 4);
    A.iCol.array.set(col, i * 3);
    this.dirty = true;
    return true;
  }
  flush() {
    this.mat.uniforms.uTime.value = this.w.time;
    if (this.dirty) { for (const k in this.a) this.a[k].needsUpdate = true; this.dirty = false; }
  }
}

const rv = () => Math.floor(R() * ATLAS * ATLAS);
const WHITE = [1, 0.98, 0.94];

export class Effects {
  constructor(scene, world, models) {
    this.w = world; this.scene = scene;
    const atlas = makeSmokeAtlas();
    this.smoke = new Particles(scene, world, { capacity: 3500, texture: atlas, atlas: ATLAS, drag: 0.35, fadeIn: 0.04, fadeOut: 0.5, lift: 0.3, wob: 0.06, reject: true, order: 8 });
    this.puff = new Particles(scene, world, { capacity: 1500, texture: atlas, atlas: ATLAS, drag: 0.6, fadeIn: 0.06, fadeOut: 0.45, lift: 0.25, wob: 0.05, reject: true, order: 8 });
    this.dust = new Particles(scene, world, { capacity: 1000, texture: atlas, atlas: ATLAS, drag: 1.2, fadeIn: 0.08, fadeOut: 0.4, lift: 0.2, wob: 0.03, order: 7 });
    this.dirt = new Particles(scene, world, { capacity: 800, texture: atlas, atlas: ATLAS, drag: 0.4, fadeIn: 0.03, fadeOut: 0.6, grav: 16, wind: [0.3, 0, 0.1], order: 7 });
    this.flash = new Particles(scene, world, { capacity: 600, texture: makeFlashTexture(), additive: true, light: false, drag: 1, fadeIn: 0.05, fadeOut: 0.2, wind: [0, 0, 0], order: 9 });
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
  // ---- spawners
  musket(x, y, z, dx, dz, big = 1) {
    // muzzle flash, then a dense rounded puff that billows out in front of the line
    this.flash.spawn(x + dx * 0.4, y, z + dz * 0.4, 0, 0, 0, 0.11, 1.6 * big, 4.2 * big, 1, [1, 0.82, 0.5]);
    const sp = 2 + R() * 1.6, lf = 0.55 + 0.45 * big;
    const ok = this.smoke.spawn(x + dx * 0.9, y, z + dz * 0.9, dx * sp + (R() - 0.5), 0.5 + R() * 0.4, dz * sp + (R() - 0.5), (9 + R() * 6) * lf, 2.6 * big, (10 + R() * 5) * big, 0.62 + R() * 0.14, WHITE, rv());
    if (ok && R() < 0.5) this.smoke.spawn(x + dx * 1.8, y + 0.4, z + dz * 1.8, dx * sp * 1.7 + (R() - 0.5), 0.7, dz * sp * 1.7 + (R() - 0.5), (8 + R() * 5) * lf, 2 * big, (8 + R() * 4) * big, 0.5, [0.97, 0.96, 0.94], rv());
  }
  cannon(x, y, z, dx, dz) {
    this.flash.spawn(x + dx * 1.5, y, z + dz * 1.5, 0, 0, 0, 0.2, 4, 15, 1, [1, 0.78, 0.42]);
    this.flash.spawn(x + dx * 3, y + 0.2, z + dz * 3, dx * 6, 0, dz * 6, 0.14, 2, 8, 0.9, [1, 0.9, 0.6]);
    for (let i = 0; i < 12; i++) {
      const fwd = i < 6, sp = fwd ? 5 + R() * 10 : 0.5 + R() * 2.5;
      this.smoke.spawn(x + dx * (1 + i * 0.5) + (R() - 0.5) * 2, y + R() * 0.8, z + dz * (1 + i * 0.5) + (R() - 0.5) * 2, dx * sp + (R() - 0.5) * 3, 0.8 + R() * 1.2, dz * sp + (R() - 0.5) * 3, 12 + R() * 7, 4 + R() * 3, 16 + R() * 10, 0.68 + R() * 0.12, WHITE, rv());
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
    const th = this.w.terrain;
    for (let k = this.falling.length - 1; k >= 0; k--) {
      const f = this.falling[k]; f.t += dt;
      const e = Math.min(1, f.t / 0.55), a = e * e * (Math.PI / 2) * f.dir * 0.97;
      this._e.set(f.roll ? 0 : a, f.yaw, f.roll ? a : 0); this._q.setFromEuler(this._e);
      this._p.set(f.x, f.y + 0.12 * e, f.z); this._s.set(SCALE, SCALE, SCALE);
      f.c.mesh.setMatrixAt(f.i, this._m.compose(this._p, this._q, this._s)); f.c.mesh.instanceMatrix.needsUpdate = true;
      if (e >= 1) this.falling.splice(k, 1);
    }
    this.smoke.flush(); this.puff.flush(); this.flash.flush(); this.dust.flush(); this.dirt.flush();
  }
}
