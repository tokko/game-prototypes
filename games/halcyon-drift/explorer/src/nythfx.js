// Nyth render helpers (everything that is specific to a bioluminescent world and has no other home):
//  - NG: shared uniforms read by the terrain, water and foliage shaders (hue provinces, glow colours, player-proximity glow)
//  - Motes: one draw call of drifting light motes that wrap around the camera
//  - PadLights: glowing edge / threshold lights for the runway and landing pad
//  - setNythLook / nythLight: per-world look and ambient light, called from main.js
import * as THREE from 'three';
import { gfx } from './gfx.js';

export const NG = {
  uNyth: { value: 0 }, uNyTint: { value: new THREE.Color(0.55, 0.62, 1) },
  uNyGlowA: { value: new THREE.Color(0.05, 0.7, 1) }, uNyGlowB: { value: new THREE.Color(0.62, 0.16, 1) },
  uNyGM: { value: new THREE.Vector3(1, 0.15, 0.7) }, uNyGAm: { value: new THREE.Vector3(1, 0.55, 0.1) },      // foliage accents: magenta, amber
  uNyGround: { value: 0.55 }, uNyPl: { value: new THREE.Vector4(0, -1e5, 0, 0) },       // xyz = player (scene-local), w = time
};

/** per-world look: enable / disable the Nyth terrain grade + ground glow (terrain.js reads NG) */
export function setNythLook(W) {
  const N = W && W.nyth;
  NG.uNyth.value = N ? 1 : 0;
  if (!N) for (const l of gfx.csm.lights) l.castShadow = true;        // restore the sun shadows (nythLight switches them off while the sun is down)
  if (!N) return;
  NG.uNyTint.value.setRGB(...N.tint); NG.uNyGlowA.value.setRGB(...N.glowA); NG.uNyGlowB.value.setRGB(...N.glowB); NG.uNyGround.value = N.ground;
  if (N.glowC) NG.uNyGM.value.set(...N.glowC); if (N.glowD) NG.uNyGAm.value.set(...N.glowD);
}
const _fc = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
/** ambient floor and giant-shine fill for a twilight world (replaces the warm sunlit fill in main.js updateSky) */
export function nythLight(W, giant, gfx, setFill, sunCol) {
  const L = W.nyth.light;
  gfx.hemi.intensity = Math.max(gfx.hemi.intensity, L.hemi);
  for (const l of gfx.csm.lights) l.castShadow = l.intensity > 0.15;       // no sun, no shadow passes (saves four cascades)
  setFill(giant || _up, giant ? L.fill : 0.06, _fc.setRGB(...L.fillCol));
  sunCol.setRGB(1, 0.95, 0.88);      // the sun is below the horizon here: do not leak its green-passing horizon transmittance into the orbit-scene sun colour (main.js reuses _c1)
}

// ------------------------------------------------------------------ light motes
const MOTE_VERT = `
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uGround; uniform float uTime; uniform float uBox; uniform float uH; uniform float uSize; uniform float uScale;
uniform vec3 uColA; uniform vec3 uColB; uniform float uK;
varying vec3 vCol; varying float vA;
void main(){
  float t = uTime;
  vec3 b = aSeed.xyz;
  vec3 drift = vec3(sin(t * 0.07 + aSeed.w * 40.0) * 6.0 + 1.6 * t * (aSeed.x - 0.5), 0.9 * t * (0.3 + 0.7 * aSeed.y) * 0.3 + sin(t * 0.21 + aSeed.w * 19.0) * 2.0, cos(t * 0.06 + aSeed.w * 33.0) * 6.0 + 1.6 * t * (aSeed.z - 0.5));
  vec3 q = b * vec3(uBox, uH, uBox) + drift;
  vec3 rel = vec3(mod(q.x - uCam.x, uBox) - 0.5 * uBox, mod(q.y, uH), mod(q.z - uCam.z, uBox) - 0.5 * uBox);
  vec3 wp = vec3(uCam.x + rel.x, uGround + rel.y - 4.0, uCam.z + rel.z);
  float edge = max(abs(rel.x), abs(rel.z)) / (0.5 * uBox);
  float fade = 1.0 - smoothstep(0.55, 1.0, edge);
  float tw = 0.55 + 0.45 * sin(t * (0.8 + 2.2 * aSeed.w) + aSeed.w * 60.0);
  vCol = mix(uColA, uColB, smoothstep(0.35, 0.65, aSeed.w)) * uK * (0.5 + 0.9 * tw);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vA = fade * smoothstep(0.0, 1.2, -mv.z) * (0.35 + 0.65 * smoothstep(0.0, 1.0, aSeed.x * 2.0));
  gl_PointSize = clamp(uSize * uScale * (0.6 + 0.8 * aSeed.y) / max(-mv.z, 0.1), 1.6, 26.0);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = `
varying vec3 vCol; varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c) * 4.0;
  float a = pow(max(1.0 - r2, 0.0), 2.2);
  gl_FragColor = vec4(vCol * a * vA, 1.0);
}`;
export class Motes {
  constructor(cfg) {
    const n = cfg.n, seed = new Float32Array(n * 4), pos = new Float32Array(n * 3);
    let s = 20240611; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n * 4; i++) seed[i] = rnd();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uCam: { value: new THREE.Vector3() }, uGround: { value: 0 }, uTime: { value: 0 }, uBox: { value: cfg.box }, uH: { value: cfg.height }, uSize: { value: cfg.size }, uScale: { value: 600 },
        uColA: { value: new THREE.Color(...cfg.colA) }, uColB: { value: new THREE.Color(...cfg.colB) }, uK: { value: cfg.k } },
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 6;
  }
  update(cam, ground, time, scale) { const u = this.mat.uniforms; u.uCam.value.copy(cam); u.uGround.value = ground; u.uTime.value = time; u.uScale.value = scale; }
}

// ------------------------------------------------------------------ runway / pad lights (fixed true-coordinate sites, re-placed when the terrain origin moves)
const PAD_VERT = `
attribute vec3 aCol; uniform float uScale; uniform float uTime; varying vec3 vCol;
void main(){ vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(uScale * 0.7 / max(-mv.z, 0.1), 3.0, 24.0); gl_Position = projectionMatrix * mv; }`;
const PAD_FRAG = `
varying vec3 vCol; uniform float uTime;
void main(){ vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c) * 4.0; float a = pow(max(1.0 - r2, 0.0), 1.6); gl_FragColor = vec4(vCol * a * (1.4 + 0.3 * sin(uTime * 2.0)), 1.0); }`;
export class PadLights {
  constructor(rc, cfg) {
    this.rc = rc;
    this.pts = [];                                       // true coords {x, z, c}
    const R = rc.RUNWAY, c0 = cfg.col, c1 = cfg.colEnd;
    const add = (u, v, c) => { const p = rc.toSite(u, v); this.pts.push({ x: p.x, z: p.z, c }); };
    for (let u = R.u0; u <= R.u1; u += 40) { add(u, -R.hw - 2, c0); add(u, R.hw + 2, c0); }
    for (let u = R.u0 + 20; u <= R.u1 - 20; u += 40) add(u, 0, [c0[0] * 0.5, c0[1] * 0.5, c0[2] * 0.5]);
    for (let v = -R.hw; v <= R.hw; v += 14) { add(R.u0, v, c1); add(R.u1, v, [1.0, 0.45, 0.2]); }     // threshold + end lights
    if (rc.PAD) for (let k = 0; k < 20; k++) { const a = k / 20 * 6.2832; add(rc.PAD.u + Math.cos(a) * rc.PAD.r, rc.PAD.v + Math.sin(a) * rc.PAD.r, c1); }
    const n = this.pts.length;
    this.geo = new THREE.BufferGeometry(); this.pos = new Float32Array(n * 3); const col = new Float32Array(n * 3);
    this.pts.forEach((p, i) => { col[i * 3] = p.c[0]; col[i * 3 + 1] = p.c[1]; col[i * 3 + 2] = p.c[2]; });
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = new THREE.ShaderMaterial({ vertexShader: PAD_VERT, fragmentShader: PAD_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uScale: { value: 600 }, uTime: { value: 0 } } });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 6;
    this.ox = NaN; this.oz = NaN;
  }
  place(o) {
    this.ox = o.x; this.oz = o.z;
    this.pts.forEach((p, i) => { this.pos[i * 3] = p.x - o.x; this.pos[i * 3 + 1] = this.rc.heightAt(p.x, p.z) + 1.8; this.pos[i * 3 + 2] = p.z - o.z; });
    this.geo.attributes.position.needsUpdate = true;
  }
  update(o, time, scale) { if (o.x !== this.ox || o.z !== this.oz) this.place(o); this.mat.uniforms.uTime.value = time; this.mat.uniforms.uScale.value = scale; }
}

// ------------------------------------------------------------------ floating jellyfish: translucent emissive bells with trailing tentacles, instanced and animated entirely in the vertex shader
const JELLY_VERT = `
attribute vec4 aSeed; attribute vec2 aPart;      // aPart.x: 0 bell / 1 tentacle, aPart.y: 0 at the rim .. 1 at the tentacle tip
uniform vec3 uCam; uniform float uGround; uniform float uTime; uniform float uBox; uniform vec3 uColA; uniform vec3 uColB; uniform float uK;
varying vec3 vCol; varying float vA; varying vec3 vN; varying vec3 vV;
void main(){
  float t = uTime, sd = aSeed.w;
  vec2 drift = vec2(sin(t * 0.05 + sd * 31.0) * 12.0 + t * 1.3 * (aSeed.x - 0.3), cos(t * 0.045 + sd * 17.0) * 12.0 + t * 1.3 * (aSeed.z - 0.4));
  vec2 q = aSeed.xz * uBox + drift;
  vec2 rel = vec2(mod(q.x - uCam.x, uBox) - 0.5 * uBox, mod(q.y - uCam.z, uBox) - 0.5 * uBox);
  float alt = 22.0 + aSeed.y * 180.0 + 5.0 * sin(t * 0.3 + sd * 40.0);
  float sc = 3.5 + 6.5 * fract(sd * 7.0);                            // bell radius 3.5 .. 10 m
  float ph = t * 1.5 + sd * 50.0;
  float pulse = sin(ph);
  vec3 p = position;
  float yaw = sd * 6.2832; float cy = cos(yaw), sy = sin(yaw);
  if (aPart.x < 0.5) { p.xz *= 1.0 + 0.14 * pulse * (1.0 - p.y * 0.3); p.y *= 1.0 - 0.12 * pulse; }
  else {
    float w = aPart.y;
    p.xz += vec2(sin(ph * 0.8 - w * 4.0 + p.x * 3.0), cos(ph * 0.7 - w * 3.5 + p.z * 3.0)) * 0.22 * w * w;
    p.xz *= 1.0 - 0.1 * pulse * w;
    p.y -= 0.18 * pulse * w;
  }
  vec3 loc = vec3(p.x * cy - p.z * sy, p.y, p.x * sy + p.z * cy) * sc;
  vec3 wp = vec3(uCam.x + rel.x, uGround + alt, uCam.z + rel.y) + loc;
  vec3 nl = normal; vec3 nw = vec3(nl.x * cy - nl.z * sy, nl.y, nl.x * sy + nl.z * cy);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vN = normalize(mat3(viewMatrix) * nw); vV = normalize(-mv.xyz);
  float edge = max(abs(rel.x), abs(rel.y)) / (0.5 * uBox);
  vA = (1.0 - smoothstep(0.65, 1.0, edge)) * smoothstep(5.0, 30.0, -mv.z);
  vCol = mix(uColA, uColB, smoothstep(0.3, 0.7, fract(sd * 13.0))) * uK * (0.8 + 0.4 * pulse);
  vA *= aPart.x < 0.5 ? 1.0 : (1.0 - 0.8 * aPart.y);
  gl_Position = projectionMatrix * mv;
}`;
const JELLY_FRAG = `
varying vec3 vCol; varying float vA; varying vec3 vN; varying vec3 vV;
void main(){
  float fr = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0);
  gl_FragColor = vec4(vCol * (0.18 + 1.1 * fr) * vA, 1.0);
}`;
export class Jellies {
  constructor(cfg) {
    const pos = [], nor = [], part = [], idx = [];
    const R = 24, S = 9;                                     // bell: a flared dome, open at the bottom
    for (let j = 0; j <= S; j++) {
      const a = j / S * Math.PI * 0.5, r = Math.sin(a) * (1 + 0.12 * Math.sin(a * 3.0)), y = Math.cos(a) * 0.72 - 0.0;
      for (let i = 0; i <= R; i++) { const th = i / R * Math.PI * 2; const x = Math.cos(th) * r, z = Math.sin(th) * r; pos.push(x, y, z); const n = new THREE.Vector3(x, Math.cos(a) * 1.2, z).normalize(); nor.push(n.x, n.y, n.z); part.push(0, 0); }
    }
    for (let j = 0; j < S; j++) for (let i = 0; i < R; i++) { const a = j * (R + 1) + i, b = a + R + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const base = pos.length / 3, NT = 9, SEG = 7;
    for (let k = 0; k < NT; k++) {
      const th = k / NT * Math.PI * 2 + 0.3 * (k % 2), r0 = 0.82 + 0.1 * (k % 3) * 0.3;
      const L = 1.5 + 1.3 * ((k * 0.37) % 1);
      for (let s = 0; s <= SEG; s++) {
        const w = s / SEG, x = Math.cos(th) * r0 * (1 - 0.5 * w), z = Math.sin(th) * r0 * (1 - 0.5 * w), y = -0.02 - w * L;
        const px = -Math.sin(th) * 0.03, pz = Math.cos(th) * 0.03;
        pos.push(x - px, y, z - pz, x + px, y, z + pz); nor.push(Math.cos(th), 0, Math.sin(th), Math.cos(th), 0, Math.sin(th)); part.push(1, w, 1, w);
      }
      for (let s = 0; s < SEG; s++) { const a = base + (k * (SEG + 1) + s) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 2));
    g.setIndex(idx);
    let s0 = 777001; const rnd = () => { s0 = (Math.imul(s0, 1664525) + 1013904223) >>> 0; return s0 / 4294967296; };
    const seed = new Float32Array(cfg.n * 4); for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = cfg.n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mat = new THREE.ShaderMaterial({ vertexShader: JELLY_VERT, fragmentShader: JELLY_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uCam: { value: new THREE.Vector3() }, uGround: { value: 0 }, uTime: { value: 0 }, uBox: { value: cfg.box }, uColA: { value: new THREE.Color(...cfg.colA) }, uColB: { value: new THREE.Color(...cfg.colB) }, uK: { value: cfg.k } } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }
  update(cam, ground, time) { const u = this.mat.uniforms; u.uCam.value.copy(cam); u.uGround.value = ground; u.uTime.value = time; }
}
