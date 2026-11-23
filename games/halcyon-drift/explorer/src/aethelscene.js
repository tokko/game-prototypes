// Aethel interior set dressing built from a few procedural parts: the domed lake-shore settlement (lathe domes, towers, arches, warm lit
// windows, one merged mesh), floating rock islands (inverted-cone chunks with a grassy top) and the cheap additive light shafts that
// stream in through the polar window. All meshes use the shared curvature hook, so they bend with the terrain around the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { setupMat, applyCurvature, curv } from './gfx.js';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { hash2 } from './noise.js';

const V3 = THREE.Vector3;
const rnd = (a, b, s) => hash2(a * 7 + 3, b * 13 + 5, s);

// ---------------------------------------------------------------------------- settlement
function windowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const lit = rnd(i, j, 17) > 0.28; if (!lit) continue;
    g.fillStyle = rnd(i, j, 29) > 0.6 ? '#ffd9a0' : '#ffb35c'; g.fillRect(i * 16 + 4, j * 16 + 3, 8, 10);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function prep(geo, col, x, y, z, ry, sx, sy, sz, uvS) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), ry), new V3(sx, sy, sz)));
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const uv = g.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * uvS[0] + uvS[2], uv.getY(i) * uvS[1] + uvS[3]);
  return g;
}
const STONE = [0.36, 0.33, 0.29], STONE2 = [0.27, 0.30, 0.34], VERD = [0.12, 0.38, 0.34], COPPER = [0.55, 0.30, 0.16], GOLD = [0.75, 0.55, 0.2];
const DARK_UV = [0, 0, 0.02, 0.02];                       // a black texel: no windows on roofs
function domeGeo(r, drum) {
  const pts = [new THREE.Vector2(r, 0), new THREE.Vector2(r, drum)];
  for (let a = 8; a <= 90; a += 11) pts.push(new THREE.Vector2(r * Math.cos(a * Math.PI / 180), drum + r * 0.9 * Math.sin(a * Math.PI / 180)));
  pts.push(new THREE.Vector2(0.01, drum + r * 0.9)); pts.push(new THREE.Vector2(0.01, drum + r * 0.9 + r * 0.45));
  return new THREE.LatheGeometry(pts, 20);
}
function towerGeo(w, H) {
  const pts = [[w, 0], [w, H], [w * 1.2, H], [w * 1.2, H + 2.2], [w * 0.85, H + 2.6], [w * 0.8, H + 7], [w * 0.55, H + 7.4], [w * 0.4, H + 9], [0.05, H + 22]].map(([a, b]) => new THREE.Vector2(a, b));
  return new THREE.LatheGeometry(pts, 14);
}
/** settlement centre (plane coords sx, sz); heightAt(x, z) gives the ground. Returns a Group (positions in plane coordinates; main offsets it by -origin) */
export function buildSettlement(sx, sz, heightAt) {
  const parts = [];
  const at = (x, z) => heightAt(sx + x, sz + z);
  const add = (geo, col, x, z, ry, s3, uvS, dy = 0) => parts.push(prep(geo, col, sx + x, at(x, z) + dy, sz + z, ry, s3[0], s3[1], s3[2], uvS));
  const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true); cyl.translate(0, 0.5, 0);
  const roof = new THREE.ConeGeometry(1, 1, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 0.5, 0);
  // great dome with a drum of lit windows
  add(cyl, STONE, 0, 0, 0, [20, 9, 20], [10, 2, 0, 0]); add(domeGeo(20, 9), VERD, 0, 0, 0, [1, 1, 1], DARK_UV);
  // towers
  for (const [x, z, w, H] of [[-52, -14, 5.5, 44], [58, 10, 6, 52], [8, 46, 5, 36], [-30, 40, 4.2, 30], [34, -32, 4.4, 34]]) {
    add(towerGeo(w, H), STONE2, x, z, 0, [1, 1, 1], [5, H / 5, 0, 0]);
  }
  // small domes on drums, ring round the great dome
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * 6.283 + rnd(i, 1, 3) * 0.35, rr = 34 + rnd(i, 2, 4) * 70, x = Math.cos(a) * rr * 1.5, z = Math.sin(a) * rr * 0.7, r = 5 + rnd(i, 3, 5) * 6, dh = 3.5 + rnd(i, 4, 6) * 4;
    if (Math.hypot(x, z) < 26) continue;
    add(cyl, i % 3 ? STONE : STONE2, x, z, 0, [r, dh, r], [6, 1.5, 0, 0]); add(domeGeo(r, dh), i % 4 === 0 ? COPPER : VERD, x, z, 0, [1, 1, 1], DARK_UV);
  }
  // flat-roofed houses with pyramid roofs
  for (let i = 0; i < 18; i++) {
    const a = rnd(i, 7, 8) * 6.283, rr = 45 + rnd(i, 8, 9) * 95, x = Math.cos(a) * rr * 1.6, z = Math.sin(a) * rr * 0.75, w = 5 + rnd(i, 9, 10) * 6, h = 5 + rnd(i, 10, 11) * 9, ry = rnd(i, 11, 12) * 1.2;
    if (Math.hypot(x / 1.2, z) < 30) continue;
    add(unitBox, STONE, x, z, ry, [w, h, w * 1.2], [w / 3, h / 4, 0, 0]); add(roof, COPPER, x, z, ry, [w * 0.8, 4 + rnd(i, 12, 13) * 3, w * 0.9], DARK_UV, h);
  }
  // arches framing the approach and a gold-tipped lantern pole
  const arch = new THREE.TorusGeometry(1, 0.08, 6, 16, Math.PI);
  add(arch, STONE, -20, 70, 0.15, [11, 11, 11], DARK_UV); add(arch, STONE, 30, 66, -0.2, [9, 9, 9], DARK_UV); add(arch, STONE2, -80, 20, 1.2, [8, 8, 8], DARK_UV);
  for (const [x, z] of [[-10, 62], [14, 64], [0, 80]]) add(towerGeo(0.6, 6), GOLD, x, z, 0, [1, 1, 1], DARK_UV);
  const geo = mergeGeometries(parts, false);
  const tex = windowTexture();
  const mat = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 4.0, envMapIntensity: 0.3 }), 'aeth-city', applyCurvature);
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const g = new THREE.Group(); g.add(mesh); return g;
}

// ---------------------------------------------------------------------------- floating islands
function islandGeo(R, H, seed) {
  const bodyG = new THREE.ConeGeometry(R, H, 26, 7, true); bodyG.rotateX(Math.PI); bodyG.translate(0, -H / 2, 0);
  const p = bodyG.attributes.position, cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), t = -y / H;      // t: 0 at the rim, 1 at the apex
    const n = 0.75 + 0.5 * rnd(Math.round((a + 3.2) * 4), Math.round(t * 7), seed), k = n * (1 - 0.25 * t);
    p.setXYZ(i, x * k, y * (0.85 + 0.3 * rnd(Math.round((a + 3.2) * 3), 9, seed + 1)), z * k);
    const m = 0.5 + 0.5 * rnd(Math.round((a + 3.2) * 5), Math.round(t * 9), seed + 2), moss = Math.max(0, 1 - t * 4) * 0.7;
    cols[i * 3] = (0.10 + 0.12 * m) * (1 - moss) + 0.08 * moss; cols[i * 3 + 1] = (0.11 + 0.12 * m) * (1 - moss) + 0.26 * moss; cols[i * 3 + 2] = (0.15 + 0.13 * m) * (1 - moss) + 0.1 * moss;
  }
  bodyG.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const top = new THREE.CircleGeometry(R * 1.0, 30, 0, Math.PI * 2); top.rotateX(-Math.PI / 2);
  const tp = top.attributes.position, tc = new Float32Array(tp.count * 3);
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), r = Math.hypot(x, z) / R;
    tp.setY(i, R * 0.07 * (1 - r * r) + R * 0.03 * (rnd(Math.round(x / R * 6) + 20, Math.round(z / R * 6) + 20, seed + 3) - 0.5));
    const g = 0.7 + 0.6 * rnd(Math.round(x / R * 9) + 30, Math.round(z / R * 9) + 30, seed + 4);
    tc[i * 3] = 0.07 * g; tc[i * 3 + 1] = 0.26 * g; tc[i * 3 + 2] = 0.09 * g;
  }
  top.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const parts = [bodyG.toNonIndexed(), top.toNonIndexed()];
  // a few tree crowns on top
  for (let k = 0; k < 6; k++) {
    const a = rnd(k, 1, seed + 5) * 6.283, d = Math.sqrt(rnd(k, 2, seed + 5)) * R * 0.8, s = R * (0.05 + 0.05 * rnd(k, 3, seed + 5));
    const ico = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(); ico.scale(s * 1.2, s * 0.7, s * 1.2); ico.translate(Math.cos(a) * d, R * 0.07 * (1 - (d / R) ** 2) + s * 1.6, Math.sin(a) * d);
    const c = new Float32Array(ico.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = 0.05; c[i + 1] = 0.2 + 0.1 * rnd(k, i, seed); c[i + 2] = 0.08; }
    ico.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(ico);
  }
  parts.forEach((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k); });
  const m = mergeGeometries(parts, false); m.computeVertexNormals(); return m;
}
/** specs: [{x, z, up (m above the wall), R, H}] in plane coordinates */
export function buildIslands(specs, heightAt) {
  const g = new THREE.Group();
  const mat = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false, envMapIntensity: 0.3 }), 'aeth-island', applyCurvature);
  specs.forEach((s, i) => {
    const m = new THREE.Mesh(islandGeo(s.R, s.H, 40 + i * 7), mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    m.position.set(s.x, Math.max(heightAt(s.x, s.z), 0) + s.up, s.z); m.rotation.y = i * 1.9; g.add(m);
  });
  return g;
}

// ---------------------------------------------------------------------------- light shafts through the polar window
const SHAFT_VERT = `varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){ vUv = uv; vN = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const SHAFT_FRAG = `precision highp float; varying vec3 vN; varying vec3 vV; varying vec2 vUv; uniform float uTime; uniform vec3 uCol; uniform float uK; ${NOISE_TEX_GLSL}
void main(){
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
  float along = pow(1.0 - vUv.y, 1.2) * smoothstep(0.0, 0.03, vUv.y);
  float n = vn2(vec2(vUv.x * 16.0 + uTime * 0.02, vUv.y * 3.0 - uTime * 0.05)) * 0.6 + vn2(vec2(vUv.x * 41.0, vUv.y * 9.0 - uTime * 0.08)) * 0.4;
  float a = edge * along * (0.4 + 0.9 * n) * uK;
  gl_FragColor = vec4(uCol, a);
}`;
export class Shafts {
  constructor(gateR, ri) {
    this.group = new THREE.Group(); this.gateR = gateR; this.ri = ri; this.items = [];
    const geo = new THREE.CylinderGeometry(1.9, 1, 1, 40, 1, true); geo.translate(0, 0.5, 0);
    const u = { uTime: { value: 0 }, uNoise: { value: noiseTexture() } };
    // [offset in the window plane (sphere frame, m), tilt, radius factor, intensity]
    for (const [ox, oz, tx, tz, rk, k] of [[0, 0, 0.03, 0.02, 0.8, 0.14], [900, 500, 0.14, 0.05, 0.22, 0.34], [-1100, -300, -0.12, -0.09, 0.16, 0.3], [200, -1400, 0.05, -0.16, 0.14, 0.26]]) {
      const mat = new THREE.ShaderMaterial({ uniforms: { ...u, uCol: { value: new V3(0.45, 0.68, 1.0) }, uK: { value: k } }, vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 3; this.group.add(m); this.items.push({ m, ox, oz, tx, tz, rk, u: mat.uniforms });
    }
  }
  /** A: scene <- sphere frame; Ps: camera wall point (sphere frame, m); base: scene position of the wall point under the camera */
  update(A, Ps, base, time) {
    for (const it of this.items) {
      const pole = new V3(it.ox, this.ri, it.oz).sub(Ps).applyMatrix3(A).add(base);
      const dir = new V3(it.tx, -1, it.tz).normalize().applyMatrix3(A), L = this.ri * 1.7;
      it.m.position.copy(pole); it.m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
      const r = this.gateR * 1.05 * it.rk; it.m.scale.set(r, L, r); it.u.uTime.value = time;
    }
  }
}
