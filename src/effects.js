// Particles (gunsmoke, muzzle flash, dust), cannonballs, corpses.
import * as THREE from 'three';
import { SCALE } from './units.js';
import { HORIZON } from './scene.js';

const R = Math.random;

function makeSmokeAtlas() {
  const S = 512, cell = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  for (let c = 0; c < 4; c++) {
    const ox = (c % 2) * cell, oy = Math.floor(c / 2) * cell;
    const lay = document.createElement('canvas'); lay.width = lay.height = cell;
    const l = lay.getContext('2d');
    const blobs = 20 + Math.floor(R() * 8);
    for (let i = 0; i < blobs; i++) {
      const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 62;
      const x = cell / 2 + Math.cos(a) * rr, y = cell / 2 + Math.sin(a) * rr * 0.85;
      const r = 34 + R() * 42;
      const g = l.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.55, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      l.fillStyle = g; l.beginPath(); l.arc(x, y, r, 0, 6.3); l.fill();
    }
    // bake lighting: warm sun side top-left, cool grey shade bottom-right
    l.globalCompositeOperation = 'source-atop';
    const lg = l.createLinearGradient(0, 0, cell, cell);
    lg.addColorStop(0, 'rgba(255,244,222,0.55)'); lg.addColorStop(0.5, 'rgba(255,255,255,0)'); lg.addColorStop(1, 'rgba(95,100,118,0.65)');
    l.fillStyle = lg; l.fillRect(0, 0, cell, cell);
    l.globalCompositeOperation = 'destination-in';
    const m = l.createRadialGradient(cell / 2, cell / 2, cell * 0.2, cell / 2, cell / 2, cell * 0.5);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = m; l.fillRect(0, 0, cell, cell);
    ctx.drawImage(lay, ox, oy);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
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
varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vDepth;
void main(){
  float age = uTime - iT.x;
  if (age < 0.0 || age > iT.y) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  float a = age / iT.y;
  vec3 p = iPos + iVel * ((1.0 - exp(-uDrag*age)) / uDrag) + uWind * age;
  float g = (1.0 - exp(-4.0*a)) / (1.0 - exp(-4.0));
  float size = mix(iT.z, iT.w, g);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = iM.x + iM.w * age;
  vec2 q = position.xy; float cs = cos(rot), sn = sin(rot);
  q = vec2(cs*q.x - sn*q.y, sn*q.x + cs*q.y);
  mv.xy += q * size;
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(iM.y, uAtlas), floor(iM.y / uAtlas));
  vUv = (uv + cell) / uAtlas;
  vA = iM.z * smoothstep(0.0, uFadeIn, a) * (1.0 - smoothstep(uFadeOut, 1.0, a)) * smoothstep(3.0, 18.0, -mv.z);
  vCol = iCol; vDepth = -mv.z;
}`;
const FRAG = `
uniform sampler2D uMap; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying float vA; varying vec3 vCol; varying float vDepth;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float al = t.a * vA; if (al < 0.003) discard;
  vec3 c = t.rgb * vCol;
  c = mix(c, uFog, smoothstep(uFogNear, uFogFar, vDepth) * 0.75);
  gl_FragColor = vec4(c, al);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, world, { capacity, texture, additive, atlas = 1, drag = 0.5, fadeIn = 0.08, fadeOut = 0.5, wind = [1.3, 0.1, 0.5] }) {
    this.w = world; this.cap = capacity; this.head = 0; this.dirty = false;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.a = { iPos: mk(3), iVel: mk(3), iT: mk(4), iM: mk(4), iCol: mk(3) };
    for (const k in this.a) g.setAttribute(k, this.a[k]);
    // dead by default: spawn time far in future with life 0
    for (let i = 0; i < capacity; i++) this.a.iT.array[i * 4] = 1e9;
    g.instanceCount = capacity;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: texture }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3(...wind) }, uDrag: { value: drag }, uFadeIn: { value: fadeIn }, uFadeOut: { value: fadeOut }, uAtlas: { value: atlas },
        uFog: { value: new THREE.Color(HORIZON) }, uFogNear: { value: 350 }, uFogFar: { value: 1900 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
    scene.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, alpha, col, atlasIdx = 0) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    const A = this.a;
    A.iPos.array.set([x, y, z], i * 3); A.iVel.array.set([vx, vy, vz], i * 3);
    A.iT.array.set([this.w.time, life, s0, s1], i * 4);
    A.iM.array.set([(R() - 0.5) * 0.7, atlasIdx, alpha, (R() - 0.5) * 0.06], i * 4);
    A.iCol.array.set(col, i * 3);
    this.dirty = true;
  }
  flush() {
    this.mat.uniforms.uTime.value = this.w.time;
    if (this.dirty) { for (const k in this.a) this.a[k].needsUpdate = true; this.dirty = false; }
  }
}

export class Effects {
  constructor(scene, world, models) {
    this.w = world; this.scene = scene;
    this.smoke = new Particles(scene, world, { capacity: 7000, texture: makeSmokeAtlas(), atlas: 2, drag: 0.35, fadeIn: 0.05, fadeOut: 0.55 });
    this.flash = new Particles(scene, world, { capacity: 600, texture: makeFlashTexture(), additive: true, drag: 1, fadeIn: 0.05, fadeOut: 0.2, wind: [0, 0, 0] });
    this.dust = new Particles(scene, world, { capacity: 1200, texture: this.smoke.mat.uniforms.uMap.value, atlas: 2, drag: 1.2, fadeIn: 0.1, fadeOut: 0.4 });

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
    this.flash.spawn(x + dx * 0.4, y, z + dz * 0.4, 0, 0, 0, 0.09, 0.8 * big, 2.6 * big, 1, [1, 0.85, 0.55]);
    const sp = 2 + R() * 1.5;
    this.smoke.spawn(x + dx * 0.8, y, z + dz * 0.8, dx * sp + (R() - 0.5), 0.5 + R() * 0.4, dz * sp + (R() - 0.5), 18 + R() * 14, 1.6 * big, (5.5 + R() * 2.5) * big, 0.5 + R() * 0.2, [1, 0.98, 0.94], Math.floor(R() * 4));
    if (R() < 0.5) this.smoke.spawn(x + dx * 1.5, y + 0.3, z + dz * 1.5, dx * sp * 1.8, 0.7, dz * sp * 1.8, 14 + R() * 10, 1.2 * big, 4.5 * big, 0.42, [0.96, 0.95, 0.93], Math.floor(R() * 4));
  }
  cannon(x, y, z, dx, dz) {
    this.flash.spawn(x + dx * 1.5, y, z + dz * 1.5, 0, 0, 0, 0.14, 2.5, 8, 1, [1, 0.8, 0.45]);
    for (let i = 0; i < 7; i++) {
      const sp = 4 + R() * 9;
      this.smoke.spawn(x + dx * (1 + i * 0.5), y, z + dz * (1 + i * 0.5), dx * sp + (R() - 0.5) * 3, 0.8 + R() * 1.0, dz * sp + (R() - 0.5) * 3, 24 + R() * 16, 3 + R() * 2, 11 + R() * 7, 0.6 + R() * 0.15, [1, 0.98, 0.94], Math.floor(R() * 4));
    }
  }
  dustKick(x, y, z, n = 3, size = 4) {
    for (let i = 0; i < n; i++) this.dust.spawn(x + (R() - 0.5) * 1.5, y + 0.3, z + (R() - 0.5) * 1.5, (R() - 0.5) * 3, 1.5 + R() * 2, (R() - 0.5) * 3, 2.5 + R() * 2.5, 0.8, size * (0.7 + R() * 0.6), 0.55, [0.72, 0.58, 0.4], Math.floor(R() * 4));
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
    const m = this.ballMesh; m.count = 0;
    for (const b of list) { if (m.count >= 64) break; this._m.makeTranslation(b.x, b.y, b.z); m.setMatrixAt(m.count++, this._m); }
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
    this.smoke.flush(); this.flash.flush(); this.dust.flush();
  }
}
