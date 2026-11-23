// Water: per-chunk surface meshes built from the terrain worker's water-surface grid (lakes sit at the recipe's water level,
// rivers follow their own sloped surface, so physics / scatter / render all agree with rc.waterSurface), a reflective
// flow-animated water shader (sky + sun + fresnel, depth tint, shoreline foam), and the hero waterfall cascade with spray.
import * as THREE from 'three';
import { curv } from './gfx.js';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { atmU, ATMO_PARS, FOG_FRAG } from './atmo.js';
import { NG } from './nythfx.js';      // Nyth: glow follows the player

const N = 48, G = N + 1;
let sharedUV = null;

const VERT = `
attribute float depth; attribute vec2 flow;
varying vec3 vWP; varying float vDepth; varying vec2 vFlow; varying vec3 vViewPosition;
uniform vec3 uCurvCam; uniform float uCurvK; uniform float uCurvRi;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 q = wp.xz - uCurvCam.xz; if (uCurvRi > 0.0) wp.y += uCurvRi - sqrt(uCurvRi * uCurvRi - min(dot(q, q), 0.9409 * uCurvRi * uCurvRi)); else wp.y -= dot(q, q) * uCurvK;
  vWP = wp.xyz; vDepth = depth; vFlow = flow;
  vec4 mv = viewMatrix * wp; vViewPosition = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
${NOISE_TEX_GLSL}
${ATMO_PARS}
varying vec3 vWP; varying float vDepth; varying vec2 vFlow; varying vec3 vViewPosition;
uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSunCol; uniform float uAmbient;
uniform vec3 uGlow; uniform vec4 uNyPl;      // Nyth: bioluminescent water (uGlow = 0 elsewhere)
float wh(vec2 p, vec2 f, float t){
  return vn2(p * 0.55 + f * t * 0.9) * 0.55 + vn2(p * 1.3 - f.yx * t * 0.7 + 7.0) * 0.3 + vn2(p * 3.1 + f * t * 1.4 + 3.0) * 0.15;
}
void main(){
  if (vDepth < -0.03) discard;
  vec3 V = normalize(cameraPosition - vWP);
  float flowK = length(vFlow);
  vec2 fl = vFlow * 0.5;
  float t = uTime;
  vec2 p = vWP.xz;
  float e = 0.35;
  float h0 = wh(p, fl, t), hx = wh(p + vec2(e, 0.0), fl, t), hz = wh(p + vec2(0.0, e), fl, t);
  float amp = 0.10 + 0.34 * min(flowK, 1.2);
  vec3 N = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) * 0.98 + 0.02;
  float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 sky = min(aInscatter(normalize(R)), vec3(1.2)) * 0.85;
  float sd = max(dot(R, uASun), 0.0);
  vec3 sunSpec = uSunCol * (pow(sd, 700.0) * 9.0 + pow(sd, 60.0) * 0.3);
  float d = max(vDepth, 0.0);
  float depthK = 1.0 - exp(-d * 0.55);
  float shoreD = 1.0 - smoothstep(0.0, 0.6, d);
  vec3 body = mix(uShallow, uDeep, depthK);
  body = mix(body, uShallow * vec3(1.12, 1.0, 0.72), shoreD * 0.45);                  // silty, translucent shallows
  body *= 0.88 + 0.24 * vn2(p * 0.17 + 5.0);                                        // slow patches of deeper and paler water
  float lightK = uAmbient + 0.6 * max(uASun.y, 0.0);
  body *= lightK;
  // foam: shoreline and fast water, broken up by moving noise
  float fn = vn2(p * 2.2 + fl * t * 1.3) * 0.6 + vn2(p * 6.0 - fl * t * 2.0) * 0.4;
  float fpat = vn2(p * 0.23 + 3.0);
  float shoreFoam = (1.0 - smoothstep(0.0, 0.3, d)) * smoothstep(0.6, 0.92, fn + 0.55 * (fpat - 0.5)) * (0.35 + 0.65 * smoothstep(0.3, 0.7, fpat));       // broken wisps, not a continuous strip
  float flowFoam = smoothstep(5.0, 11.0, flowK * 2.0) * smoothstep(0.45, 0.8, fn) + smoothstep(1.0, 2.0, flowK) * 0.3 * smoothstep(0.74, 0.92, fn) * smoothstep(0.35, 0.65, fpat);
  float foam = clamp(shoreFoam + flowFoam, 0.0, 1.0);
  vec3 col = mix(body, sky * vec3(0.78, 0.9, 1.0), clamp(F * 0.7, 0.0, 0.6)) + sunSpec * (0.4 + 0.6 * F) * (1.0 - foam);
  col = mix(col, uFoam * (0.5 + 0.9 * lightK), foam * 0.85);
  float alpha = clamp((1.0 - exp(-d * 1.15)) * 0.9 + F * 0.5 + foam * 0.5, 0.0, 0.96) * smoothstep(-0.03, 0.4, vDepth);
  if (uGlow.r + uGlow.g + uGlow.b > 0.0) {      // Nyth: drifting luminous plankton clouds, glowing shoreline, rings of light around the player
    float cells = smoothstep(0.55, 0.85, vn2(p * 0.35 + vec2(t * 0.05, -t * 0.04)) * 0.6 + vn2(p * 0.9 - fl * t + 4.0) * 0.4);
    float rim = 1.0 - smoothstep(0.0, 1.4, d);
    float pd = distance(vWP.xz, uNyPl.xz); float pk = 1.0 - smoothstep(2.0, 36.0, pd);
    float ring = 0.5 + 0.5 * sin(pd * 0.5 - uNyPl.w * 3.0);
    float gl = 0.2 + 0.9 * cells + 0.9 * rim + pk * (0.8 + 1.4 * ring);
    col += uGlow * gl * (1.0 - foam * 0.6);
    alpha = max(alpha, clamp(gl * 0.35, 0.0, 0.8) * smoothstep(-0.03, 0.12, vDepth));
  }
  gl_FragColor = vec4(col, alpha);
  ${FOG_FRAG}
}`;

// ---- PYRA: the same surface meshes drawn as molten lava: two-phase flow-advected noise, cooling crust plates, bright cracks, emissive HDR (blooms)
const LAVA_FRAG = `
${NOISE_TEX_GLSL}
${ATMO_PARS}
varying vec3 vWP; varying float vDepth; varying vec2 vFlow; varying vec3 vViewPosition;
uniform float uTime;
float lfn(vec2 q){ return vn2(q * 0.11) * 0.5 + vn2(q * 0.27 + 5.0) * 0.3 + vn2(q * 0.66 + 11.0) * 0.2; }
vec2 vor(vec2 p){ vec2 ip = floor(p), fp = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec4 r = texture2D(uNoise, (ip + g + 0.5) / 256.0); float d = length(g + 0.15 + 0.7 * r.gb - fp);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(d1, d2); }
void main(){
  if (vDepth < -0.03) discard;
  vec2 p = vWP.xz;
  float flowK = length(vFlow);
  vec2 fl = vFlow * 6.0 + vec2(0.35, 0.2);                  // slow drift even where the recipe has no flow (lake, far chunks)
  float ph0 = fract(uTime * 0.045), ph1 = fract(uTime * 0.045 + 0.5), bl = abs(2.0 * ph0 - 1.0);
  vec2 warp = vec2(vn2(p * 0.05 + uTime * 0.02), vn2(p * 0.05 + 7.0 - uTime * 0.02)) * 9.0;
  vec2 q0 = p + warp - fl * ph0 * 22.0, q1 = p + warp - fl * ph1 * 22.0 + 17.0;
  float n = mix(lfn(q0), lfn(q1), bl);
  vec2 w0 = vec2(vn2(q0 * 0.21), vn2(q0 * 0.21 + 3.0)) * 3.2, w1 = vec2(vn2(q1 * 0.21 + 9.0), vn2(q1 * 0.21 + 13.0)) * 3.2;
  vec2 v0 = vor((q0 + w0) / 6.5), v1 = vor((q1 + w1) / 6.5);
  float cell = mix(v0.x, v1.x, bl);
  float crack = mix(1.0 - smoothstep(0.0, 0.16, v0.y - v0.x), 1.0 - smoothstep(0.0, 0.16, v1.y - v1.x), bl);   // plate boundaries
  float edge = 1.0 - smoothstep(0.0, 1.1, max(vDepth, 0.0));                                  // shallow rims cool first
  float crust = smoothstep(0.46, 0.62, n + 0.18 * edge - 0.1 * min(flowK * 1.5, 1.0));
  float hotT = clamp(1.0 - n * 1.1 + 0.2 * flowK, 0.0, 1.0);
  vec3 molten = mix(vec3(0.85, 0.075, 0.008), vec3(1.0, 0.36, 0.04), hotT) * (0.9 + 1.0 * hotT) * (0.88 + 0.3 * (1.0 - cell));
  vec3 plate = vec3(0.028, 0.02, 0.018) * (0.7 + 0.8 * cell) + vec3(1.0, 0.27, 0.035) * crack * (0.7 + 0.9 * hotT) * (1.0 - edge * 0.5);
  vec3 col = mix(molten * (0.75 + 0.5 * crack), plate, crust * 0.94);
  col *= 0.92 + 0.08 * sin(uTime * 1.7 + n * 12.0);
  gl_FragColor = vec4(col, 1.0);
  ${FOG_FRAG}
}`;

export class Water {
  constructor(terrain, rc, world) {
    this.t = terrain; this.rc = rc; this.group = new THREE.Group(); this.meshes = new Map();
    const cfg = world.water;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: cfg.kind === 'lava' ? LAVA_FRAG : FRAG, transparent: cfg.kind !== 'lava', depthWrite: cfg.kind === 'lava', side: THREE.DoubleSide, fog: false,
      uniforms: {
        uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uCurvCam: curv.cam, uCurvK: curv.k, uCurvRi: curv.ri,
        uDeep: { value: new THREE.Color(...cfg.deep) }, uShallow: { value: new THREE.Color(...cfg.shallow) }, uFoam: { value: new THREE.Color(...cfg.foam) },
        uSunCol: { value: new THREE.Color(1, 0.9, 0.75) }, uAmbient: { value: 0.5 }, ...atmU,
        uGlow: { value: new THREE.Color(...(cfg.glow || [0, 0, 0])) }, uNyPl: NG.uNyPl,
      },
    });
    terrain.onChunkReady = (c, m) => this.build(c, m);
    terrain.onChunkDispose = (c) => this.remove(c);
  }
  remove(c) { const m = this.meshes.get(c.key); if (m) { this.group.remove(m); m.geometry.dispose(); this.meshes.delete(c.key); } }
  build(c, m) {
    this.remove(c);
    if (!m.wat) return;
    const wat = m.wat, pos = m.pos, nv = G * G;
    const P = new Float32Array(nv * 3), D = new Float32Array(nv), F = new Float32Array(nv * 2);
    const ox = c.mesh ? c.mesh.position.x : 0, oz = c.mesh ? c.mesh.position.z : 0;
    const rc = this.rc, cx = (c.i + 0.5) * c.size, cz = (c.j + 0.5) * c.size, fl = [0, 0];
    for (let k = 0; k < nv; k++) {
      const wv = wat[k], hh = pos[k * 3 + 1];
      const dry = wv < -1e8;
      P[k * 3] = pos[k * 3]; P[k * 3 + 2] = pos[k * 3 + 2];
      P[k * 3 + 1] = dry ? hh - 0.5 : wv;
      D[k] = dry ? -2 : wv - hh;
      if (!dry && rc.waterFlow && c.l <= 1) { rc.waterFlow(cx + pos[k * 3], cz + pos[k * 3 + 2], fl); F[k * 2] = fl[0]; F[k * 2 + 1] = fl[1]; }
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * G + i, b = (j + 1) * G + i, cc = j * G + i + 1, d = (j + 1) * G + i + 1;
      if (Math.max(D[a], D[b], D[cc], D[d]) < -0.05) continue;
      idx.push(a, b, cc, cc, b, d);
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('depth', new THREE.BufferAttribute(D, 1)); g.setAttribute('flow', new THREE.BufferAttribute(F, 2));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (m.ymin + m.ymax) / 2, 0), c.size * 0.75 + (m.ymax - m.ymin));
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.position.set((c.i + 0.5) * c.size - this.t.origin.x, 0, (c.j + 0.5) * c.size - this.t.origin.z);
    mesh.frustumCulled = c.l <= 3; mesh.renderOrder = 3;
    this.group.add(mesh); this.meshes.set(c.key, mesh);
    mesh.visible = c.mesh ? c.mesh.visible : true;
    mesh.userData.chunk = c;
  }
  /** keep water chunk visibility in sync with the terrain's LOD selection */
  update(time, sunDir, sunI) {
    this.mat.uniforms.uTime.value = time;
    for (const [k, mesh] of this.meshes) { const c = mesh.userData.chunk; mesh.visible = !!(c.mesh && c.mesh.visible); }
  }
  setLight(sunCol, ambient) { this.mat.uniforms.uSunCol.value.copy(sunCol); this.mat.uniforms.uAmbient.value = ambient; }
  reset() { for (const m of this.meshes.values()) { this.group.remove(m); m.geometry.dispose(); } this.meshes.clear(); }
}

// ------------------------------------------------------------------ waterfalls (hero Singing Falls + small cascades)
const FALL_VERT = `
varying vec2 vUv; varying vec3 vViewPosition; varying vec3 vWorldP;
uniform vec3 uCurvCam; uniform float uCurvK; uniform float uCurvRi;
void main(){
  vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldP = wp.xyz;
  vec2 q = wp.xz - uCurvCam.xz; if (uCurvRi > 0.0) wp.y += uCurvRi - sqrt(uCurvRi * uCurvRi - min(dot(q, q), 0.9409 * uCurvRi * uCurvRi)); else wp.y -= dot(q, q) * uCurvK;
  vec4 mv = viewMatrix * wp; vViewPosition = -mv.xyz; gl_Position = projectionMatrix * mv;
}`;
const FALL_FRAG = `
${NOISE_TEX_GLSL}
${ATMO_PARS}
varying vec2 vUv; varying vec3 vViewPosition; varying vec3 vWorldP;
uniform float uTime; uniform float uLight; uniform float uDrop;
void main(){
  float x = vUv.x, y = vUv.y;
  float side = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.95, x);
  float rough = vn2(vec2(x * 7.0, 2.0));                             // fixed per-column flow strength: thick and thin lanes
  // layered streaks: coarse lanes, fine strands, fast sparkle; they accelerate down the face
  float v1 = uTime * (1.4 + 2.4 * y);
  float s1 = vn2(vec2(x * 11.0, y * uDrop * 0.020 - v1));
  float s2 = vn2(vec2(x * 29.0 + 4.0, y * uDrop * 0.045 - v1 * 1.7));
  float s3 = vn2(vec2(x * 83.0 + 9.0, y * uDrop * 0.11 - v1 * 2.6));
  float streak = 0.38 + 0.38 * s1 + 0.3 * s2 + 0.22 * s3;
  float lane = smoothstep(0.25, 0.8, 0.5 * rough + 0.6 * s1);
  float lip = smoothstep(0.12, 0.0, y);                              // white lip where the water leaves the edge
  float base = smoothstep(0.62, 1.0, y) * (0.55 + 0.45 * vn2(vec2(x * 13.0, y * 7.0 - uTime * 3.5)));
  float ledge = smoothstep(0.015, 0.0, abs(fract(y * uDrop * 0.028 + 0.2 * s1) - 0.5) - 0.47) * 0.5;   // slight terrace foam bands
  vec3 deep = vec3(0.34, 0.62, 0.62), white = vec3(0.97, 0.99, 1.0);
  vec3 col = mix(deep, white, clamp(streak * 0.55 + lip * 0.9 + base * 0.9 + ledge + lane * 0.2, 0.0, 1.0)) * (0.5 + 0.75 * uLight);
  // sunlit spray tint towards the bottom
  col += vec3(1.0, 0.9, 0.75) * base * 0.15 * uLight;
  float a = side * (0.66 + 0.3 * streak + 0.2 * lane) * smoothstep(0.0, 0.02, y);
  a *= 1.0 - 0.18 * smoothstep(0.7, 1.0, y);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.94));
  ${FOG_FRAG}
}`;

export class Waterfall {
  /** f = recipe fall anchor {x,z (lip, TRUE coords), dirx,dirz (flow direction), lipH, baseH, width, face, hero} */
  constructor(terrain, f) {
    this.t = terrain; this.f = f; this.group = new THREE.Group(); this.time = 0; this.acc = 0; this.accR = 0;
    const segs = f.hero ? 30 : 10, cols = 12, w = f.width, drop = f.lipH - f.baseH;
    const pos = [], uv = [], idx = [];
    const nx = f.dirx, nz = f.dirz, px = -nz, pz = nx;
    for (let j = 0; j <= segs; j++) {
      const t = j / segs;
      const xi = 0.5 - Math.sin(Math.asin(Math.max(-1, Math.min(1, 1 - 2 * t))) / 3);   // inverse smoothstep: matches the cliff-face profile
      const out = f.face * xi + 0.9 + (j === 0 ? -0.4 : 0);                             // just in front of the rock
      const y = f.lipH - drop * t;
      for (let i = 0; i <= cols; i++) {
        const s = (i / cols - 0.5) * w * (1 + 0.14 * t + 0.05 * Math.sin(i * 1.7 + j * 0.3));
        pos.push(nx * out + px * s, y - f.lipH, nz * out + pz * s); uv.push(i / cols, t);
      }
    }
    for (let j = 0; j < segs; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ vertexShader: FALL_VERT, fragmentShader: FALL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uLight: { value: 0.8 }, uDrop: { value: drop }, uCurvCam: curv.cam, uCurvK: curv.k, uCurvRi: curv.ri, ...atmU } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.group.add(this.mesh);
  }
  place() { const o = this.t.origin; this.mesh.position.set(this.f.x - o.x, this.f.lipH, this.f.z - o.z); }
  update(dt, camPos, particles, light, sunY = 0.2, camToSun = 0) {
    this.time += dt; this.mat.uniforms.uTime.value = this.time; this.mat.uniforms.uLight.value = light;
    this.place();
    const f = this.f, o = this.t.origin, hero = f.hero, drop = f.lipH - f.baseH;
    const bx = f.x + f.dirx * (f.face + 1.5) - o.x, bz = f.z + f.dirz * (f.face + 1.5) - o.z;
    const d = Math.hypot(bx - camPos.x, bz - camPos.z);
    const range = hero ? 4200 : 600;
    if (d > range || !particles) return;
    const near = Math.max(0.12, 1 - d / range);
    // mist plume at the base: big soft particles rising and drifting downstream
    this.acc += dt * near * (hero ? 48 : 22);
    while (this.acc > 1) {
      this.acc -= 1;
      const a = Math.random() * 6.283, r = Math.random() * f.width * 0.55;
      const sz = hero ? 16 + Math.random() * 20 : 3 + Math.random() * 4;
      particles.emit(bx + Math.cos(a) * r, f.baseH + 0.5 + Math.random() * (hero ? 8 : 2), bz + Math.sin(a) * r,
        f.dirx * (2 + Math.random() * 6) + (Math.random() - 0.5) * 8, hero ? 2 + Math.random() * 11 : 1.5 + Math.random() * 3, f.dirz * (2 + Math.random() * 6) + (Math.random() - 0.5) * 8,
        sz, sz * (1.8 + Math.random() * 1.2), (hero ? 6 : 3) + Math.random() * 3, 0.95, 0.97, 1.0, (hero ? 0.075 : 0.08) + Math.random() * 0.06);
    }
    // rainbow-ish spray glow when sunlit (low sun, light from behind the viewer)
    if (hero && sunY > -0.02 && camToSun > -0.3) {
      this.accR += dt * near * 22 * clamp01(0.4 + camToSun);
      while (this.accR > 1) {
        this.accR -= 1;
        const a = Math.random() * 6.283, r = Math.random() * f.width * 0.5, h = Math.random();
        const c = hsv(0.0 + 0.75 * h);
        particles.emit(bx + Math.cos(a) * r, f.baseH + 3 + Math.random() * 14, bz + Math.sin(a) * r, f.dirx * 2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 3, f.dirz * 2 + (Math.random() - 0.5) * 2,
          7 + Math.random() * 7, 9 + Math.random() * 8, 2.5 + Math.random() * 2, c[0], c[1], c[2], 0.07 + 0.05 * Math.random(), 0.55);
      }
    }
  }
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function hsv(h) { const i = Math.floor(h * 6), f = h * 6 - i, q = 1 - f; const m = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i % 6]; return [0.55 + 0.45 * m[0], 0.55 + 0.45 * m[1], 0.55 + 0.45 * m[2]]; }
