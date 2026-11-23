// Rendering of the space environment: procedural nebula skybox + sun, the planet with
// atmosphere, the cratered moon (shader-detailed + a local high-res ground patch) and ore beacons.
// All distances in metres; objects are positioned in the physics (Z-up) frame by main.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOGDEPTH_VS_PARS, LOGDEPTH_VS, LOGDEPTH_FS_PARS, LOGDEPTH_FS } from './models.js';

const NOISE = `
float hash13(vec3 p){
  uvec3 v = uvec3(ivec3(floor(p * 8.0 + 0.5)));
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return float(v.x >> 8u) * (1.0 / 16777216.0);
}
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float fbm4(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// ------------------------------------------------------------------------------------ sky
export function createSky(sunDirRender) {
  const mat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, side: THREE.BackSide,
    uniforms: { uSun: { value: sunDirRender.clone() }, uGal: { value: new THREE.Vector3(0.25, 0.9, -0.35).normalize() } },
    vertexShader: `varying vec3 vDir;
      void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = vec4(p.xy, p.w * 0.9999, p.w); }`,
    fragmentShader: `${NOISE}
      varying vec3 vDir; uniform vec3 uSun; uniform vec3 uGal;
      // cube-cell stars: a unit sphere crosses ~|d|_1 times more cells towards the diagonals, so thin the
      // probability by that factor to keep the density uniform (no visible axis/pole pattern)
      const mat3 ROT = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
      vec3 starLayer(vec3 d, float sc, float seed, float thresh){
        vec3 p = d * sc; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
        float h = hash13(id + seed);
        float dens = 1.35 / (abs(d.x) + abs(d.y) + abs(d.z));
        if (h < 1.0 - (1.0 - thresh) * dens) return vec3(0.0);
        vec3 off = vec3(hash13(id + 1.3 + seed), hash13(id + 2.7 + seed), hash13(id + 4.1 + seed)) - 0.5;
        float dd = length(f - off * 0.6);
        float b = pow(hash13(id + 9.0 + seed), 4.0);
        float s = 1.0 - smoothstep(0.0, 0.16, dd);
        float temp = hash13(id + 6.6 + seed);
        vec3 c = mix(vec3(1.0, 0.72, 0.5), vec3(0.62, 0.78, 1.0), temp);
        return c * s * (0.35 + 5.0 * b);
      }
      void main(){
        vec3 d = normalize(vDir);
        float lat = dot(d, uGal);
        float band = exp(-lat * lat / 0.05);
        float core = exp(-lat * lat / 0.008);
        vec3 q = d * 2.1;
        float w1 = fbm(q * 1.3 + 3.0);
        float w2 = fbm(q * 3.0 + w1 * 2.6 + 11.0);
        float neb = smoothstep(0.30, 0.85, w2);
        float dust = smoothstep(0.42, 0.72, fbm(q * 5.5 + w2 * 3.0 + 40.0));
        float m = fbm(q * 2.0 + 7.0);
        vec3 cool = vec3(0.32, 0.26, 0.95), magenta = vec3(0.85, 0.22, 0.6), teal = vec3(0.08, 0.5, 0.75), warm = vec3(1.0, 0.52, 0.2);
        vec3 tint = mix(cool, magenta, smoothstep(0.35, 0.7, m));
        tint = mix(tint, teal, smoothstep(0.5, 0.8, fbm(q * 1.6 + 21.0)) * 0.65);
        vec3 col = vec3(0.004, 0.006, 0.016);
        col += tint * neb * (0.07 + 0.9 * band) * 0.85;
        col += warm * core * (0.2 + 0.9 * fbm(q * 4.0 + 2.0)) * 0.7;
        col *= 1.0 - 0.8 * dust * band;
        float sg = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.42, 0.14) * pow(sg, 5.0) * 0.5 * (0.35 + fbm(q * 3.0 + 5.0));
        col += vec3(0.4, 0.3, 0.9) * pow(max(dot(d, normalize(vec3(-0.6, 0.15, 0.7))), 0.0), 6.0) * 0.25 * fbm(q * 2.5 + 31.0);
        // stars: denser along the galactic band
        float thr = 0.968 - 0.03 * band;
        vec3 d1 = ROT * d, d2 = ROT * d1;
        col += starLayer(d, 70.0, 0.0, thr) + starLayer(d1, 150.0, 7.0, thr) + starLayer(d2, 330.0, 13.0, thr + 0.004);
        col += vec3(0.7, 0.8, 1.0) * pow(max(vnoise(ROT * ROT * ROT * d * 900.0) - 0.78, 0.0) * 4.0, 2.0) * (0.3 + band);
        // sun
        float sd = dot(d, uSun);
        float disc = smoothstep(0.99935, 0.99955, sd) * 90.0;
        float glow = pow(max(sd, 0.0), 700.0) * 4.0 + pow(max(sd, 0.0), 60.0) * 0.5 + pow(max(sd, 0.0), 8.0) * 0.06;
        col += vec3(1.0, 0.88, 0.7) * (disc + glow);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), mat);
  m.frustumCulled = false;
  m.renderOrder = -1000;
  return m;
}

// ------------------------------------------------------------------------------------ planet
export function createPlanet(radius, sunDirRender) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDirRender.clone() }, uTime: { value: 0 } },
    vertexShader: `${LOGDEPTH_VS_PARS}
      varying vec3 vObj; varying vec3 vN; varying vec3 vP;
      void main(){ vObj = position; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; ${LOGDEPTH_VS} }`,
    fragmentShader: `${LOGDEPTH_FS_PARS}${NOISE}
      varying vec3 vObj; varying vec3 vN; varying vec3 vP; uniform vec3 uSun; uniform float uTime;
      void main(){ ${LOGDEPTH_FS}
        vec3 n = normalize(vObj);
        vec3 N = normalize(vN); vec3 L = normalize(uSun); vec3 V = normalize(cameraPosition - vP);
        float h = fbm(n * 4.2 + 3.1) * 0.78 + 0.22 * fbm(n * 14.0 + 5.0);
        float land = smoothstep(0.5, 0.52, h);
        float lat = abs(n.y);
        float moist = fbm(n * 4.5 + 9.0);
        vec3 grass = mix(vec3(0.05, 0.16, 0.04), vec3(0.17, 0.25, 0.07), moist);
        vec3 dry = vec3(0.35, 0.28, 0.17);
        vec3 landCol = mix(grass, dry, smoothstep(0.42, 0.68, moist) * smoothstep(0.15, 0.55, 1.0 - lat * 1.3));
        landCol = mix(landCol, vec3(0.2, 0.19, 0.18), smoothstep(0.6, 0.78, h));
        float snow = smoothstep(0.76, 0.92, lat + (h - 0.5) * 0.35);
        landCol = mix(landCol, vec3(0.8, 0.86, 0.9), snow);
        float depth = 1.0 - smoothstep(0.32, 0.51, h);
        vec3 ocean = mix(vec3(0.02, 0.16, 0.3), vec3(0.003, 0.02, 0.085), depth);
        ocean = mix(ocean, vec3(0.7, 0.8, 0.88), smoothstep(0.9, 0.97, lat));
        landCol *= 0.65 + 0.7 * fbm4(n * 80.0 + 2.0) + 0.25 * (fbm4(n * 24.0) - 0.5);
        vec3 surf = mix(ocean, landCol, land);
        // clouds
        vec3 cp = n * 3.2 + vec3(uTime * 0.004, 0.0, uTime * 0.003);
        vec3 warp = vec3(fbm4(cp * 1.4), fbm4(cp * 1.4 + 5.0), fbm4(cp * 1.4 + 9.0));
        float cl = fbm(cp * 1.5 + warp * 1.8);
        float cloud = smoothstep(0.56, 0.8, cl) * (0.5 + 0.5 * smoothstep(0.3, 0.8, fbm4(n * 12.0 + 2.0)));
        float NdL = dot(N, L);
        float day = smoothstep(-0.1, 0.3, NdL);
        float diff = max(NdL, 0.0);
        vec3 albedo = mix(surf, vec3(0.85, 0.87, 0.92), cloud);
        vec3 col = albedo * (diff * 2.0 + 0.012);
        // ocean glint
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 140.0) * (1.0 - land) * (1.0 - cloud) * 3.0 + pow(max(dot(N, H), 0.0), 14.0) * (1.0 - land) * 0.12;
        col += vec3(1.0, 0.92, 0.8) * spec * step(0.0, NdL);
        // twilight band
        float twx = (NdL - 0.02) / 0.14;
        float tw = exp(-twx * twx);
        col += vec3(1.0, 0.38, 0.12) * tw * 0.22 * (0.4 + cloud);
        // night side: city lights + faint airglow
        float cities = smoothstep(0.78, 0.9, fbm(n * 55.0 + 3.0)) * smoothstep(0.35, 0.6, fbm(n * 6.0 + 1.0)) * land * (1.0 - snow) * (1.0 - cloud * 0.8);
        col += vec3(1.0, 0.72, 0.36) * cities * (1.0 - day) * 1.6;
        // limb haze
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
        col += vec3(0.25, 0.5, 1.0) * fres * (0.1 + 0.8 * smoothstep(-0.25, 0.5, NdL));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 160, 100), mat);
  return m;
}

export function createAtmosphere(radius, height, sunDirRender) {
  const Ra = radius + height;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: sunDirRender.clone() }, uR: { value: radius }, uRa: { value: Ra } },
    vertexShader: `${LOGDEPTH_VS_PARS}
      varying vec3 vP; varying vec3 vC;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; vC = modelMatrix[3].xyz; gl_Position = projectionMatrix * viewMatrix * wp; ${LOGDEPTH_VS} }`,
    fragmentShader: `${LOGDEPTH_FS_PARS}
      varying vec3 vP; varying vec3 vC; uniform vec3 uSun; uniform float uR; uniform float uRa;
      vec2 sph(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c; if (d < 0.0) return vec2(-1.0); d = sqrt(d); return vec2(-b - d, -b + d); }
      void main(){ ${LOGDEPTH_FS}
        vec3 ro = cameraPosition - vC; vec3 rd = normalize(vP - cameraPosition); vec3 L = normalize(uSun);
        vec2 ta = sph(ro, rd, uRa); if (ta.y < 0.0) discard;
        float t0 = max(ta.x, 0.0), t1 = ta.y;
        vec2 tp = sph(ro, rd, uR); if (tp.x > 0.0) t1 = min(t1, tp.x);
        if (t1 <= t0) discard;
        const int N = 14; float dt = (t1 - t0) / float(N);
        float H = 14000.0;
        vec3 acc = vec3(0.0); float trans = 1.0;
        vec3 kR = vec3(0.45, 1.0, 2.3) * 5.2e-6;
        for (int i = 0; i < N; i++){
          vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
          float hgt = length(p) - uR;
          float dens = exp(-max(hgt, 0.0) / H);
          float s = dot(normalize(p), L);
          float lit = smoothstep(-0.18, 0.22, s);
          vec3 sunTint = mix(vec3(1.0, 0.42, 0.18), vec3(1.0), smoothstep(-0.05, 0.45, s));
          acc += trans * dens * dt * kR * sunTint * lit;
          trans *= exp(-dens * dt * 3.0e-6);
        }
        float mie = pow(max(dot(rd, L), 0.0), 10.0);
        acc *= 1.0 + mie * 2.2;
        gl_FragColor = vec4(acc * 1.1, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(Ra, 128, 80), mat);
  m.renderOrder = 2;
  m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------------------------ moon
const MOON_FS_HEAD = `
${NOISE}
varying vec3 vMoonP;
uniform mat3 uToMoon;
#ifdef ICE
// Wren's ice palette (linear)
const vec3 FROST = vec3(0.70, 0.83, 1.00), PLATE = vec3(0.36, 0.56, 0.84), LINEA = vec3(0.10, 0.30, 0.58), SSS = vec3(0.028, 0.212, 0.672);
const vec3 RIFT_CORE = vec3(0.578, 0.965, 1.0), RIFT_MID = vec3(0.010, 0.694, 1.0), RIFT_DEEP = vec3(0.003, 0.159, 0.672);
const vec3 WALL_HI = vec3(0.025, 0.117, 0.246), WALL_LO = vec3(0.003, 0.020, 0.051);
// constant-width (metres) antialiased line, fades out when sub-pixel
float lineM(float d, float hw, float fw){ return (1.0 - smoothstep(hw, hw + fw, d)) * clamp(2.0 * hw / fw, 0.0, 1.0); }
float lineH(float d, float hw){ return 1.0 - smoothstep(0.0, 2.0 * hw, d); }   // soft profile for bump heights (no vertical walls up close)
// warped parallel fracture family, never closed loops; skipped when the pattern is finer than a pixel
vec2 fam(vec3 wp, vec3 rn, vec3 axis, float spacing, float hw, float warp, float seed, float maskF, float fwr){
  if (fwr >= 0.5 * spacing) return vec2(0.0);
  float f = dot(wp, normalize(axis)) / spacing + warp * (fbm4(wp / (2.9 * spacing) + seed) - 0.5);
  float d = abs(fract(f) - 0.5) / max(fwidth(f) / fwr, 1e-9);
  float mask = maskF > 0.0 ? smoothstep(0.42, 0.60, vnoise(rn * maskF + seed * 1.7)) : 1.0;
  return vec2(lineM(d, hw, fwr), lineH(d, hw)) * mask;
}
#endif
float craterLayer(vec3 p, float cell, float depthK, float seed, float fw){
#ifdef ICE
  float wgt = 1.0 - smoothstep(0.04 * cell, 0.12 * cell, fw);
#else
  float wgt = 1.0 - smoothstep(0.1 * cell, 0.3 * cell, fw);
#endif
  if (wgt < 0.01) return 0.0;
  vec3 q = p / cell; vec3 id = floor(q); vec3 f = fract(q);
  float res = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){
    vec3 o = vec3(float(x), float(y), float(z)); vec3 cid = id + o;
#ifdef ICE
    if (hash13(cid + seed) < 0.86) continue;
#else
    if (hash13(cid + seed) < 0.5) continue;
#endif
    vec3 c = o + vec3(hash13(cid + 1.7 + seed), hash13(cid + 3.1 + seed), hash13(cid + 5.3 + seed)) - f;
    float rad = 0.12 + 0.3 * hash13(cid + 8.8 + seed);
    float d = length(c) / rad;
    if (d > 2.2) continue;
#ifdef ICE
    float bowl = -0.5 * (1.0 - smoothstep(0.45, 1.0, d));   // flat relaxed pans
    float rx = (d - 1.0) / 0.16;
    float rim = exp(-rx * rx) * 0.10;
#else
    float bowl = -max(1.0 - d * d, 0.0);
    float rx = (d - 1.0) / 0.16;
    float rim = exp(-rx * rx) * 0.28;
#endif
    float ex = max(d - 1.0, 0.0) / 0.9;
    float eject = exp(-ex * ex) * 0.04 * (1.0 - smoothstep(1.3, 2.2, d));
    res += (bowl + rim + eject) * rad * cell * depthK;
  }
  return res * wgt;
}
float moonHeight(vec3 p, float fw){
  float h = craterLayer(p, 22000.0, 0.34, 1.0, fw) + craterLayer(p, 5200.0, 0.3, 11.0, fw) + craterLayer(p, 1100.0, 0.28, 21.0, fw)
          + craterLayer(p, 240.0, 0.26, 31.0, fw);
#ifndef ICE
  h += craterLayer(p, 52.0, 0.24, 41.0, fw) + craterLayer(p, 11.0, 0.22, 51.0, fw);
#endif
  h += (fbm4(p / 9000.0) - 0.5) * 900.0;
  h += (fbm4(p / 800.0) - 0.5) * 80.0 * (1.0 - smoothstep(60.0, 400.0, fw));
  h += (fbm4(p / 60.0) - 0.5) * 9.0 * (1.0 - smoothstep(4.0, 24.0, fw));
  h += (fbm4(p / 4.0) - 0.5) * 0.9 * (1.0 - smoothstep(0.15, 0.7, fw));
  h += (vnoise(p / 0.45) - 0.5) * 0.12 * (1.0 - smoothstep(0.03, 0.18, fw));
  return h;
}
`;

/** ten seeded small-circle arcs (lineae) as GLSL constants: axis, basis, offset/halfwidth/wobble/start, length */
function arcGlsl() {
  let s = 90210;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const A = [], U1 = [], U2 = [], P = [], L = [];
  const v3 = (v) => `vec3(${v.map((x) => x.toFixed(5)).join(', ')})`;
  for (let i = 0; i < 10; i++) {
    const a = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], al = Math.hypot(...a); a.forEach((_, k) => { a[k] /= al; });
    const h = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u1 = [a[1] * h[2] - a[2] * h[1], a[2] * h[0] - a[0] * h[2], a[0] * h[1] - a[1] * h[0]]; const ul = Math.hypot(...u1); u1 = u1.map((x) => x / ul);
    const u2 = [a[1] * u1[2] - a[2] * u1[1], a[2] * u1[0] - a[0] * u1[2], a[0] * u1[1] - a[1] * u1[0]];
    A.push(v3(a)); U1.push(v3(u1)); U2.push(v3(u2));
    P.push(`vec4(${((r() * 2 - 1) * 0.55).toFixed(4)}, ${(90 + 170 * r()).toFixed(1)}, ${((r() < 0.5 ? -1 : 1) * (0.02 + 0.05 * r())).toFixed(4)}, ${(r() * 6.2831853).toFixed(4)})`);
    L.push(((70 + 135 * r()) * Math.PI / 180).toFixed(4));
  }
  return `const vec3 ARC_A[10] = vec3[10](${A.join(', ')});
        const vec3 ARC_U1[10] = vec3[10](${U1.join(', ')});
        const vec3 ARC_U2[10] = vec3[10](${U2.join(', ')});
        const vec4 ARC_P[10] = vec4[10](${P.join(', ')});
        const float ARC_L[10] = float[10](${L.join(', ')});`;
}

/** opts: scale (feature scale for small moons), ice (Wren's pale ice look), rift (Wren's canyon), vents (metre positions of the geysers, hot spots in the canyon) */
export function createMoonMaterial(isPatch, opts = {}) {
  const S = (opts.scale || 1).toFixed(3), ice = !!opts.ice, rf = opts.rift;
  const f = (x) => x.toFixed(6);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: ice ? 0.5 : 0.96, metalness: 0.0 });
  mat.userData.uToMoon = { value: new THREE.Matrix3() };
  if (isPatch) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2; }
  mat.customProgramCacheKey = () => `moon-${S}-${ice}-${!!rf}`; // Pell and Wren must not share one compiled program
  // Wren: ice albedo, lineae, canyon (needs ice + rift)
  const HW = rf ? f(rf.halfWidth) : '2800.0', FW = rf ? f(rf.floorWidth) : '1100.0';
  const vp = (opts.vents || []).map((v) => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`);
  const iceMap = ice && rf ? `
        vec3 mp = vMoonP * ${S};
        float fwp = length(fwidth(mp));
        float hgt = moonHeight(mp, fwp) / ${S};
        float fwr = fwp / ${S};
        vec3 wp = vMoonP; vec3 rn = normalize(vMoonP);
        float maria = smoothstep(0.42, 0.58, fbm4(mp / 30000.0 + 4.0));
        float tone = 1.0 + 0.2 * (fbm4(mp / 2500.0) - 0.5) * (1.0 - smoothstep(10.0, 300.0, fwp)) + 0.16 * (fbm4(mp / 3.0) - 0.5) * (1.0 - smoothstep(0.1, 0.6, fwp));
        float riftSd = dot(rn, vec3(${f(rf.n.x)}, ${f(rf.n.y)}, ${f(rf.n.z)}));
        float riftAng = atan(dot(rn, vec3(${f(rf.e2.x)}, ${f(rf.e2.y)}, ${f(rf.e2.z)})), dot(rn, vec3(${f(rf.e1.x)}, ${f(rf.e1.y)}, ${f(rf.e1.z)})));
        float riftRel = mod(riftAng - ${f(rf.a0)}, 6.2831853);
        float riftSpan = smoothstep(0.0, 0.15, riftRel) * (1.0 - smoothstep(${f(rf.span - 0.15)}, ${f(rf.span)}, riftRel));
        float riftDm = abs(riftSd * 30000.0 + (fbm4(rn * 9.0 + 2.0) - 0.5) * 5200.0 + (vnoise(rn * 45.0) - 0.5) * 700.0);
        float fresh = exp(-riftDm / 6000.0) * riftSpan;
        vec3 iceCol = mix(FROST, PLATE, 0.75 * maria * (1.0 - fresh)) * 0.93 * tone;
        // lineae: ten global small-circle arcs, warped fracture families, tiger stripes either side of the rift
        ${arcGlsl()}
        float arcs = 0.0, arcsWide = 0.0, arcsH = 0.0;
        {
          float wob = fbm4(rn * 5.0 + 1.0) - 0.5, wob2 = fbm4(rn * 17.0 + 8.0) - 0.5;
          for (int i = 0; i < 10; i++) {
            float di = abs(dot(rn, ARC_A[i]) - ARC_P[i].x + ARC_P[i].z * wob + 0.006 * wob2) * 30000.0;
            float rel = mod(atan(dot(rn, ARC_U2[i]), dot(rn, ARC_U1[i])) - ARC_P[i].w, 6.2831853);
            float win = smoothstep(0.0, 0.25, rel) * (1.0 - smoothstep(ARC_L[i] - 0.25, ARC_L[i], rel));
            arcs = max(arcs, lineM(di, ARC_P[i].y, fwr) * win);
            arcsWide = max(arcsWide, lineM(di, 3.5 * ARC_P[i].y, fwr) * win);
            arcsH = max(arcsH, lineH(di, ARC_P[i].y) * win);
          }
        }
        vec2 f1v = fam(wp, rn, vec3(0.2, 0.9, 0.4), 2600.0, 45.0, 3.0, 3.0, 2.5, fwr);
        vec2 f2v = fam(wp, rn, vec3(-0.8, 0.1, 0.6), 3400.0, 55.0, 2.4, 11.0, 2.0, fwr);
        vec2 f3v = fam(wp, rn, vec3(0.6, -0.5, 0.6), 900.0, 16.0, 3.6, 23.0, 4.0, fwr);
        vec2 f4v = fam(wp, rn, vec3(0.1, 0.4, -0.9), 70.0, 1.6, 4.0, 37.0, 0.0, fwr);
        vec2 f5v = fam(wp, rn, vec3(0.9, -0.3, 0.2), 7.0, 0.22, 3.0, 41.0, 0.0, fwr);
        vec2 f6v = fam(wp, rn, vec3(-0.3, 0.8, 0.5), 9.0, 0.22, 3.0, 43.0, 0.0, fwr);
        float f1 = f1v.x, f2 = f2v.x, f3 = f3v.x, f4 = f4v.x, f5 = f5v.x, f6 = f6v.x;
        float tiger = 0.0, tigerH = 0.0;
        {
          float tw = fbm4(rn * 20.0) - 0.5;
          tiger = max(lineM(abs(riftDm - 4600.0 + 600.0 * tw), 150.0, fwr), max(lineM(abs(riftDm - 7200.0 - 450.0 * tw), 110.0, fwr), lineM(abs(riftDm - 10400.0 + 520.0 * tw), 80.0, fwr))) * riftSpan;
          tigerH = max(lineH(abs(riftDm - 4600.0 + 600.0 * tw), 150.0), max(lineH(abs(riftDm - 7200.0 - 450.0 * tw), 110.0), lineH(abs(riftDm - 10400.0 + 520.0 * tw), 80.0))) * riftSpan;
        }
        float crack = clamp(0.8 * arcs + 0.6 * max(f1, f2) + 0.45 * f3 + 0.5 * f4 + 0.45 * max(f5, f6) + 0.7 * tiger, 0.0, 1.0) * (1.0 - 0.5 * fresh);
        iceCol *= 1.0 + 0.06 * (arcsWide - arcs);
        iceCol = mix(iceCol, LINEA, 0.8 * crack);
        hgt -= 40.0 * arcsH + 30.0 * tigerH + 14.0 * f1v.y + 16.0 * f2v.y + 5.0 * f3v.y + 0.7 * f4v.y + 0.1 * max(f5v.y, f6v.y);
        // the rift as a canyon: terraced walls, strata, a bright floor
        float wallT = clamp((${HW} - riftDm) / (${HW} - ${FW}), 0.0, 1.0) * riftSpan;
        float wall = smoothstep(0.0, 0.25, wallT);
        float riftFloor = (1.0 - smoothstep(0.7 * ${FW}, ${FW}, riftDm)) * riftSpan;
        hgt -= 1100.0 * (wallT * wallT * (3.0 - 2.0 * wallT) + 0.04 * sin(wallT * 31.4) * smoothstep(0.02, 0.15, wallT)) * (1.0 - smoothstep(150.0, 700.0, fwr)); // bump only when the walls are resolved
        float strata = 0.82 + 0.18 * sin(wallT * 38.0 + 3.0 * vnoise(rn * 60.0));
        iceCol = mix(iceCol, mix(WALL_HI, WALL_LO, wallT) * strata, wall);
        diffuseColor.rgb *= iceCol;` : '';
  const iceEmissive = ice && rf ? `
        #include <emissivemap_fragment>
        float day = 1.0;
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 sunV = directionalLights[0].direction;
          float ndlG = dot(nonPerturbedNormal, sunV), ndl = dot(normal, sunV);
          day = smoothstep(-0.15, 0.25, ndlG);
          float sss = smoothstep(-0.35, 0.15, ndlG) * (1.0 - smoothstep(0.0, 0.55, ndl));
          totalEmissiveRadiance += SSS * (0.16 * sss * diffuseColor.rgb + 0.035 * (1.0 - day));   // blue in shadowed slopes, blue terminator, navy night
          float lvl = exp2(floor(log2(max(fwr * 2.5, 0.25))));
          vec3 Vv = normalize(vViewPosition);
          float gh = hash13(floor(vMoonP / lvl) + floor(dot(Vv, vec3(31.0, 17.0, 23.0))));          // re-rolls as the camera moves
          float glint = step(0.994, gh) * pow(max(dot(normal, normalize(sunV + Vv)), 0.0), 60.0) * day * (1.0 - crack);
          totalEmissiveRadiance += vec3(1.6, 1.8, 2.2) * 2.5 * glint;                                // tiny stars along the sun path
        }
        #endif
        {
          float gain = mix(2.0, 0.55, day);                                                          // night blooms, day is a thin hot thread in a blue gorge
          float veins = 1.0 - smoothstep(0.02, 0.22, abs(fbm4(wp / 420.0 + 3.0) - 0.5) * 2.0);
          veins = mix(veins, 0.35, smoothstep(80.0, 400.0, fwr));
          float core = exp(-(riftDm / 260.0) * (riftDm / 260.0));
          vec3 e = RIFT_MID * riftFloor * (0.25 + 1.3 * veins) + RIFT_CORE * riftFloor * 2.2 * core
                 + RIFT_MID * 0.55 * wall * (1.0 - riftFloor) * wallT * wallT
                 + RIFT_DEEP * 0.16 * riftSpan * exp(-max(riftDm - ${HW}, 0.0) / 900.0) * (1.0 - wall) * (1.0 - day)
                 + RIFT_MID * 0.12 * tiger * (1.0 - day);
          ${vp.length ? `vec3 vpos[${vp.length}] = vec3[${vp.length}](${vp.join(', ')}); float hot = 0.0; for (int i = 0; i < ${vp.length}; i++) { vec3 dv = wp - vpos[i]; hot += exp(-dot(dv, dv) / 810000.0); } e *= 1.0 + 2.5 * hot;` : ''}
          totalEmissiveRadiance += e * gain;
        }` : '';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uToMoon = mat.userData.uToMoon;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMoonP;\nuniform mat3 uToMoon;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMoonP = uToMoon * position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${ice ? '#define ICE\n' : ''}${MOON_FS_HEAD}`)
      .replace('#include <map_fragment>', ice && rf ? iceMap : `
        vec3 mp = vMoonP * ${S};
        float fwp = length(fwidth(mp));
        float hgt = moonHeight(mp, fwp) / ${S};
        float maria = smoothstep(0.42, 0.58, fbm4(mp / 30000.0 + 4.0));
        float tone = 1.0 + 0.9 * (fbm4(mp / 2500.0) - 0.5) * (1.0 - smoothstep(10.0, 300.0, fwp)) + 0.5 * (fbm4(mp / 3.0) - 0.5) * (1.0 - smoothstep(0.1, 0.6, fwp));
        float albedo = mix(0.2, 0.09, maria) * tone * (1.0 + 0.35 * smoothstep(40.0, 700.0, hgt));
        diffuseColor.rgb *= vec3(1.0, 0.97, 0.94) * albedo;`);
    if (ice && rf) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.62, 0.34, 0.7 * maria * (1.0 - fresh));`)
        .replace('#include <emissivemap_fragment>', iceEmissive);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        {
          float dHdx = dFdx(hgt), dHdy = dFdy(hgt);
          vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
          vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
          float det = dot(sX, R1);
          vec3 grad = sign(det) * (dHdx * R1 + dHdy * R2);
          normal = normalize(abs(det) * normal - grad);
        }`);
  };
  return mat;
}

export function createMoon(radius, opts) {
  const geo = new THREE.SphereGeometry(radius, 384, 192);
  const mesh = new THREE.Mesh(geo, createMoonMaterial(false, opts));
  mesh.receiveShadow = false;
  return mesh;
}

/** polar grid patch (pole = +Z) of exact-sphere vertices: dense at the centre, sinking below the global sphere at its rim */
export function createGroundPatch(radius, opts) {
  const rings = [0];
  let r = 2.5;
  while (r < 7000) { rings.push(r); r *= 1.115; }
  const segs = 96;
  const pos = [], idx = [];
  pos.push(0, 0, radius);
  const maxR = rings[rings.length - 1];
  for (let i = 1; i < rings.length; i++) {
    const th = rings[i] / radius;
    const rr = radius;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(rr * Math.sin(th) * Math.cos(a), rr * Math.sin(th) * Math.sin(a), rr * Math.cos(th));
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
  for (let i = 1; i < rings.length - 1; i++) {
    const a = 1 + (i - 1) * segs, b = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      idx.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = [];
  for (let i = 0; i < pos.length; i += 3) { const v = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]).normalize(); nrm.push(v.x, v.y, v.z); }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, createMoonMaterial(true, opts));
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------------------------ ore beacons
const beamFS = `${LOGDEPTH_FS_PARS}
uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
void main(){ ${LOGDEPTH_FS}
  float a = pow(1.0 - vUv.y, 1.6) * (0.8 + 0.2 * sin(uTime * 3.0 + vUv.y * 20.0));
  gl_FragColor = vec4(uColor * a * 1.8, a);
}`;
const beamVS = `${LOGDEPTH_VS_PARS}
varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); ${LOGDEPTH_VS} }`;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(150,215,255,0.55)'); gr.addColorStop(1, 'rgba(60,140,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** marker for one ore site, local frame: +Z up (rotate to the surface normal), origin on the surface */
export function createSiteMarker(site, color = new THREE.Color(0.25, 0.8, 1.6)) {
  const g = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(site.radius - 6, site.radius, 96);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.z = 0.4; g.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(site.radius, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.14, 0.3), transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.position.z = 0.3; g.add(disc);
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: beamVS, fragmentShader: beamFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: color } },
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(5, 18, 5000, 12, 1, true), beamMat);
  beam.rotation.x = Math.PI / 2; beam.position.z = 2500; beam.frustumCulled = false; g.add(beam);
  // crystals
  const cm = new THREE.MeshStandardMaterial({ color: 0x66bfff, emissive: new THREE.Color(0.2, 0.7, 1.6), emissiveIntensity: 1, roughness: 0.2, metalness: 0.2 });
  let s = site.dir.x * 1000 + 7;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < (site.custom ? 0 : 26); i++) {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.5 + rnd() * 1.6), cm);
    const a = rnd() * Math.PI * 2, d = rnd() * site.radius * 0.8;
    c.position.set(Math.cos(a) * d, Math.sin(a) * d, 0.6); c.scale.set(0.7, 0.7, 1.7);
    c.rotation.set(rnd(), rnd(), rnd()); g.add(c);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sprite.position.z = 30; g.add(sprite);
  g.userData = { sprite, beamMat };
  return g;
}

// ------------------------------------------------------------------------------------ Wren extras
const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** one faceted crystal shard along +Z: pentagonal rings (squashed, jittered, twisted), hard facets */
function shardGeo(len, r, twist, seed, doubleEnded) {
  const rnd = lcg(seed);
  const ts = doubleEnded ? [0, 0.2, 0.5, 0.82, 1] : [0, 0.10, 0.55, 0.88, 1];
  const fs = doubleEnded ? [0, 0.55, 1.0, 0.5, 0] : [0.70, 1.0, 0.60, 0.24, 0];
  const rings = ts.map((t, i) => {
    const ring = [];
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * Math.PI * 2 + twist * t, rr = r * fs[i] * (1 + (rnd() * 2 - 1) * 0.18);
      ring.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.62, t * len]);
    }
    return ring;
  });
  const pos = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      const p00 = rings[i][j], p01 = rings[i][(j + 1) % 5], p10 = rings[i + 1][j], p11 = rings[i + 1][(j + 1) % 5];
      pos.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** the Spire: one vertical twisted needle, two blades crossing it, splinters, and a crown of four floating shards held by a thread of light.
 *  Local frame +Z up, built for height 600 m and scaled for other heights. */
export function createSpire(height) {
  const k = height / 600, g = new THREE.Group();
  const rnd = lcg(777);
  const D = Math.PI / 180;
  const place = (geo, baseR, baseAz, lean, leanAz) => {
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(Math.cos(baseAz) * baseR * k, Math.sin(baseAz) * baseR * k, -20 * k)
      .multiply(new THREE.Matrix4().makeRotationZ(leanAz)).multiply(new THREE.Matrix4().makeRotationY(lean)));
    return geo;
  };
  const parts = [
    place(shardGeo(450 * k, 30 * k, 110 * D, 1, false), 0, 0, 0, 0),
    place(shardGeo(330 * k, 24 * k, -75 * D, 2, false), 34, 200 * D, 12 * D, 350 * D),
    place(shardGeo(245 * k, 20 * k, 60 * D, 3, false), 30, 320 * D, 19 * D, 120 * D),
  ];
  for (let i = 0; i < 5; i++) {
    const az = rnd() * Math.PI * 2;
    parts.push(place(shardGeo((50 + 70 * rnd()) * k, (8 + 6 * rnd()) * k, (rnd() * 2 - 1) * 40 * D, 10 + i, false), 40 + 35 * rnd(), az, (35 + 30 * rnd()) * D, az + (rnd() * 2 - 1) * 40 * D));
  }
  // obsidian that mirrors the nebula at grazing angles, oil-slick facet edges, veins of light that climb with the pulse
  const uni = { uTime: { value: 0 }, uVein: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x07060c, metalness: 0, roughness: 0.08, flatShading: true });
  mat.customProgramCacheKey = () => 'spire';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime; sh.uniforms.uVein = uni.uVein;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nvarying vec3 vObj;\nuniform float uTime, uVein;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          const vec3 ENV_LO = vec3(0.006, 0.003, 0.014), ENV_HI = vec3(0.004, 0.068, 0.133), VIOLET = vec3(0.195, 0.074, 1.0), RIFT_MID = vec3(0.010, 0.694, 1.0);
          vec3 V = normalize(vViewPosition); float nv = clamp(dot(normal, V), 0.0, 1.0);
          vec3 Rw = inverseTransformDirection(reflect(-V, normal), viewMatrix);
          vec3 env = mix(ENV_LO, ENV_HI, smoothstep(-0.2, 0.8, Rw.y)) + VIOLET * 0.25 * pow(max(Rw.x * 0.6 + Rw.z * 0.8, 0.0), 3.0);
          totalEmissiveRadiance += env * 3.5 * (0.15 + 0.85 * pow(1.0 - nv, 3.0));
          vec3 irid = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + nv * 1.6 + vObj.z * 0.0018 + uTime * 0.03));
          irid = mix(vec3(dot(irid, vec3(0.333))), irid, 0.35); // mostly desaturated: a faint oil sheen, not a rainbow
          totalEmissiveRadiance += irid * vec3(0.55, 0.7, 1.0) * 0.35 * pow(1.0 - nv, 5.0);
          float vein = 1.0 - smoothstep(0.0, 0.035, abs(fbm4(vObj * vec3(0.05, 0.05, 0.012) + 3.0) - 0.5));
          float crest = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(vObj.z * 0.02 - uTime * 1.6), 6.0);
          totalEmissiveRadiance += RIFT_MID * 3.0 * vein * crest * uVein;
        }`);
  };
  const body = new THREE.Mesh(mergeGeometries(parts), mat);
  g.add(body);
  // crown: four double-ended shards floating on the axis with growing gaps
  const crown = [[461, 42, 12, 0.10, 1.05], [510, 32, 9, -0.16, -1.1], [552, 24, 6.5, 0.25, 0.9], [582, 16, 4.5, -0.38, -1.3]].map(([zc, len, r, spin, tw], i) => {
    const geo = shardGeo(len * k, r * k, tw, 20 + i, true);
    geo.translate(0, 0, (zc - len / 2) * k);
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    return { m, spin, phase: i * 1.7 };
  });
  const filMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 2.4) });
  const fgeo = new THREE.CylinderGeometry(0.6 * k, 0.6 * k, 176 * k); fgeo.rotateX(Math.PI / 2);
  const fil = new THREE.Mesh(fgeo, filMat); fil.position.z = 518 * k; g.add(fil);
  const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.5, 1.6, 2.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  tip.position.z = height + 12; tip.scale.setScalar(120);
  g.add(tip);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.0, 2.6) }));
  core.position.z = height + 6; core.scale.set(0.7, 0.7, 1.8);
  g.add(core);
  // seen from afar (only once the signal is detected): light shaft and a pulsing pool of light on the ground
  const shaftMat = new THREE.ShaderMaterial({
    vertexShader: beamVS, fragmentShader: beamFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.2, 0.75, 1.3).multiplyScalar(0.06) } },
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2, 9, 3000, 8, 1, true), shaftMat);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = height + 1500; shaft.frustumCulled = false; g.add(shaft);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(0.1, 0.5, 0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.position.z = 6; g.add(pool);
  g.userData = {
    tip, core,
    /** clock (s), distance from the camera frame origin to the tip, whether the signal has been detected */
    update(t, tipDist, seen) {
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(height * 0.02 - t * 1.6), 6); // light climbs the veins, the tip flares on arrival
      uni.uTime.value = t;
      uni.uVein.value = seen ? 1 : smooth01(6000, 2500, tipDist);
      for (const c of crown) { c.m.rotation.z = t * c.spin; c.m.position.z = Math.sin(t * 0.5 + c.phase) * 1.2 * k; }
      filMat.color.setRGB(0.5, 1.6, 2.4).multiplyScalar(0.4 + 0.6 * pulse);
      const far = seen || tipDist < 6000; // the glow only gives it away once the signal is detected
      tip.visible = far; shaft.visible = far; pool.visible = far;
      tip.scale.setScalar(Math.max(60, tipDist * 0.007) * (0.6 + 0.6 * pulse));
      pool.material.opacity = 0.35 * pulse;
      shaftMat.uniforms.uTime.value = t;
    },
  };
  return g;
}

// light shared by the plume and ring shaders: Wren's shadow cylinder (radius 30 km, penumbra to 31.8 km) for a point q relative to its centre
const WREN_SHADOW_GLSL = `
float wrenLit(vec3 q, vec3 sun){ float d = dot(q, sun); return d > 0.0 ? 1.0 : smoothstep(29400.0, 31800.0, length(q - sun * d)); }
`;

/**
 * A cryo-geyser plume (local frame +Z up from the vent): 640 soft particles animated in the vertex shader (a jet and a drifting
 * mist, base-bright, fading at the top) plus one axis-locked fan billboard that carries the volume and the long-range read.
 * White where the sun reaches it, dim cyan in Wren's shadow. update(t, k): t = clock (s), k = eruption strength 0..1.
 */
export function createPlume(height, seed = 1, sunRender = new THREE.Vector3(1, 0, 0)) {
  const N = 640, g = new THREE.Group();
  const rnd = lcg(seed * 7919 + 13);
  const aSeed = new Float32Array(N * 4), aKind = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    aSeed.set([rnd(), rnd() * Math.PI * 2, Math.sqrt(rnd()), rnd()], i * 4);
    aKind[i] = rnd() < 200 / 640 ? 0 : 1; // jet / mist, shuffled so a draw range thins both
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  geo.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
  const dAng = rnd() * Math.PI * 2;
  const U = {
    uTime: { value: 0 }, uH: { value: height }, uK: { value: 0 }, uViewH: { value: 720 }, uSeed: { value: seed * 3.7 },
    uDrift: { value: new THREE.Vector2(Math.cos(dAng), Math.sin(dAng)) }, uSun: { value: sunRender.clone().normalize() },
  };
  const common = `${LOGDEPTH_VS_PARS}
    uniform float uTime, uH, uK, uViewH; uniform vec2 uDrift; uniform vec3 uSun;
    ${WREN_SHADOW_GLSL}
    const vec3 PLUME_LIT = vec3(0.888, 0.956, 1.0), PLUME_SHADE = vec3(0.112, 0.238, 0.479), UNDERGLOW = vec3(0.005, 0.392, 0.687);`;
  const pm = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${common}
      attribute vec4 aSeed; attribute float aKind;
      varying vec3 vCol;
      void main(){
        vec4 s = aSeed; bool jet = aKind < 0.5;
        float life = jet ? mix(22.0, 34.0, s.w) : mix(45.0, 80.0, s.w);
        float age = fract(s.x + uTime / life);
        float top = uH * (0.15 + 0.85 * uK) * (jet ? 1.0 : mix(0.55, 0.92, s.z));
        float rad = jet ? (90.0 + 0.05 * uH * pow(age, 1.3)) * s.z : (250.0 + 0.30 * uH * pow(age, 1.4)) * sqrt(s.z);
        float a = s.y + age * (jet ? 1.5 : 0.4);
        vec3 p = vec3(cos(a) * rad, sin(a) * rad, top * (1.0 - (1.0 - age) * (1.0 - age))) + vec3(uDrift, 0.0) * (0.12 * uH * age * age);
        float size = jet ? mix(650.0, 0.07 * uH, age) : mix(0.05 * uH, 0.16 * uH, age);
        float fade = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.55, 1.0, age));
        float bright = jet ? 0.32 * pow(1.0 - age, 1.2) : 0.035;
        vec4 wpos = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * wpos;
        gl_Position = projectionMatrix * mv;
        float px = size * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z;
        gl_PointSize = clamp(px, 2.0, 320.0);
        float big = min(1.0, (320.0 / max(px, 1.0)) * (320.0 / max(px, 1.0))), tiny = min(1.0, px / 2.0);
        vec3 cen = (modelMatrix * vec4(0.0, 0.0, -30000.0, 1.0)).xyz;
        float lit = wrenLit(wpos.xyz - cen, uSun);
        vec3 sl = transpose(mat3(modelMatrix)) * uSun;
        vec2 sp = length(sl.xy) > 1e-4 ? normalize(sl.xy) : vec2(1.0, 0.0);
        float side = 0.5 + 0.5 * dot(vec2(cos(a), sin(a)), sp) * s.z;
        vec3 c = mix(PLUME_SHADE * 0.9, PLUME_LIT, side) * lit + UNDERGLOW * 1.0 * exp(-p.z / 6000.0) * (1.0 - 0.6 * lit);
        c *= 1.0 + 2.0 * pow(max(dot(normalize(wpos.xyz - cameraPosition), uSun), 0.0), 6.0);   // backlit plumes flare
        vCol = c * bright * fade * big * tiny;
        ${LOGDEPTH_VS}
      }`,
    fragmentShader: `${LOGDEPTH_FS_PARS}
      varying vec3 vCol;
      void main(){ ${LOGDEPTH_FS}
        vec2 pc = gl_PointCoord - 0.5;
        float a = pow(1.0 - smoothstep(0.0, 1.0, 4.0 * dot(pc, pc)), 2.0);
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, pm);
  pts.frustumCulled = false;
  // the fan: unit quad, axis-locked billboard
  const fm = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `${common}
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vToCam; varying vec3 vAx; varying vec3 vSide;
      void main(){
        vUv = uv;
        vec3 ax = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
        vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - base;
        float camDist = length(toCam); toCam /= max(camDist, 1.0);
        vec3 side = normalize(cross(ax, toCam));
        float Hk = uH * (0.15 + 0.85 * uK);
        vec3 pos = base + ax * (uv.y * 1.05 * Hk) + side * ((uv.x - 0.5) * 0.80 * Hk);
        vWorld = pos; vToCam = vec3(camDist, 0.0, 0.0); vAx = ax; vSide = side;
        vec4 mv = viewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        ${LOGDEPTH_VS}
      }`,
    fragmentShader: `${LOGDEPTH_FS_PARS}
      ${NOISE}
      uniform float uTime, uK, uSeed, uH; uniform vec3 uSun;
      ${WREN_SHADOW_GLSL}
      const vec3 PLUME_LIT = vec3(0.888, 0.956, 1.0), PLUME_SHADE = vec3(0.112, 0.238, 0.479), UNDERGLOW = vec3(0.005, 0.392, 0.687);
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vToCam; varying vec3 vAx; varying vec3 vSide;
      void main(){ ${LOGDEPTH_FS}
        float v = clamp(vUv.y, 1e-4, 1.0), x = clamp(2.0 * vUv.x - 1.0, -1.0, 1.0);   // v is never negative (pow would give NaN)
        float w = mix(0.05, 1.0, pow(v, 0.75));
        float dens = exp(-2.4 * (x / w) * (x / w)) / (0.25 + 2.2 * w);
        float streak = 0.7 + 0.3 * vnoise(vec3(x / w * 4.0, v * 7.0 - uTime * 0.04, uSeed));
        float cap = (1.0 - smoothstep(0.55, 1.0, v)) * smoothstep(0.0, 0.02, v);
        float alpha = dens * streak * cap * uK * 1.2;
        vec3 base = vWorld - vAx * (v * 1.05 * uH * (0.15 + 0.85 * uK)) - vSide * (x * 0.4 * uH * (0.15 + 0.85 * uK));
        vec3 cen = base + vAx * -30000.0;
        float lit = wrenLit(vWorld - cen, uSun);
        float flank = 0.5 + 0.5 * x * sign(dot(vSide, uSun)) * w;
        vec3 c = mix(PLUME_SHADE * 0.9, PLUME_LIT, flank) * lit + UNDERGLOW * 1.0 * exp(-v * uH / 6000.0) * (1.0 - 0.6 * lit);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        c *= 1.0 + 2.0 * pow(max(dot(-viewDir, uSun), 0.0), 6.0);
        float camDist = vToCam.x;
        alpha *= (1.0 - pow(abs(dot(vAx, viewDir)), 6.0)) * mix(0.35, 1.0, smoothstep(2.0e4, 8.0e4, camDist)) * (1.0 + 1.5 * smoothstep(1.5e5, 1.5e6, camDist));
        gl_FragColor = vec4(c * alpha, 1.0);
      }`,
  });
  const fan = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
  fan.frustumCulled = false;
  g.add(fan, pts);
  g.visible = false;
  const before = (r) => { const rt = r.getRenderTarget(); U.uViewH.value = rt ? rt.height : r.domElement.height; };
  pts.onBeforeRender = before; fan.onBeforeRender = before;
  return {
    points: g,
    update(t, k) {
      g.visible = k > 0.001;
      if (!g.visible) return;
      U.uTime.value = t; U.uK.value = k;
      geo.setDrawRange(0, Math.max(1, Math.ceil(N * k)));
    },
  };
}

/**
 * Faint ice-debris ring in the equatorial (XY) plane: three bands (a dense inner ringlet, a broad middle band, an outer veil)
 * separated by gaps, with fine ringlet banding and clumps; lit and shadowed by Wren; plus twinkling sparkle points.
 * update(t) animates the sparkle. Local frame = the body's equatorial frame.
 */
export function createRing(inner, outer, sunRender = new THREE.Vector3(1, 0, 0)) {
  const g = new THREE.Group();
  const sun = sunRender.clone().normalize();
  const prof = (u) => {
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return ss(0.03, 0.08, u) * (1 - ss(0.28, 0.32, u)) + ss(0.38, 0.42, u) * (1 - ss(0.70, 0.74, u)) * 0.6 + ss(0.77, 0.80, u) * (1 - ss(0.90, 0.98, u)) * 0.28;
  };
  const bandMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun }, uInner: { value: inner }, uOuter: { value: outer } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `${LOGDEPTH_VS_PARS}
      varying vec3 vP; varying vec3 vW; varying vec3 vNrm; varying vec3 vCen;
      void main(){ vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vNrm = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz); vCen = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * w; ${LOGDEPTH_VS} }`,
    fragmentShader: `${LOGDEPTH_FS_PARS}
      ${NOISE}
      ${WREN_SHADOW_GLSL}
      uniform vec3 uSun; uniform float uInner, uOuter;
      varying vec3 vP; varying vec3 vW; varying vec3 vNrm; varying vec3 vCen;
      void main(){ ${LOGDEPTH_FS}
        float u = (length(vP.xy) - uInner) / (uOuter - uInner);
        float A = smoothstep(0.03, 0.08, u) * (1.0 - smoothstep(0.28, 0.32, u));
        float B = smoothstep(0.38, 0.42, u) * (1.0 - smoothstep(0.70, 0.74, u)) * 0.6;
        float C = smoothstep(0.77, 0.80, u) * (1.0 - smoothstep(0.90, 0.98, u)) * 0.28;
        float fine = 0.65 + 0.35 * sin(u * 150.0 + 2.5 * sin(u * 23.0));
        float clump = 0.8 + 0.4 * vnoise(vec3(vP.xy / 9000.0, 1.0));
        float dens = (A + B + C) * fine * clump;
        vec3 viewDir = normalize(cameraPosition - vW);
        vec3 nrm = vNrm, cen = vCen;
        float phase = 0.55 + 1.6 * pow(max(dot(-viewDir, uSun), 0.0), 5.0);
        float graze = 0.5 / max(abs(dot(viewDir, nrm)), 0.35);
        float shadow = wrenLit(vW - cen, uSun);
        gl_FragColor = vec4(vec3(0.521, 0.745, 1.0) * dens * 0.07 * phase * graze * shadow, 1.0);
      }`,
  });
  const band = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 192, 1), bandMat);
  band.frustumCulled = false;
  // sparkle points: rejection-sampled against the band profile
  const N = 7000, rnd = lcg(4242);
  const pos = new Float32Array(N * 3), aSeed = new Float32Array(N), aSize = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let u;
    do { u = rnd(); } while (rnd() * 0.95 > prof(u));
    const a = rnd() * Math.PI * 2, r = inner + (outer - inner) * u;
    pos.set([Math.cos(a) * r, Math.sin(a) * r, (rnd() - 0.5) * 220], i * 3);
    aSeed[i] = rnd(); aSize[i] = 40 + 140 * rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  const pu = { uTime: { value: 0 }, uViewH: { value: 720 }, uSun: { value: sun } };
  const pm = new THREE.ShaderMaterial({
    uniforms: pu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${LOGDEPTH_VS_PARS}
      ${WREN_SHADOW_GLSL}
      attribute float aSeed; attribute float aSize; uniform float uTime, uViewH; uniform vec3 uSun;
      varying vec3 vCol;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0); vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.5, aSize * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z);
        float tw = pow(0.5 + 0.5 * sin(uTime * (0.6 + 2.4 * aSeed) + aSeed * 100.0), 12.0);
        float shadow = wrenLit(w.xyz - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, uSun);
        vCol = vec3(0.7, 0.9, 1.1) * (0.25 + 2.2 * tw) * shadow * 0.55;
        ${LOGDEPTH_VS}
      }`,
    fragmentShader: `${LOGDEPTH_FS_PARS}
      varying vec3 vCol;
      void main(){ ${LOGDEPTH_FS}
        float r = clamp(length(gl_PointCoord - 0.5) * 2.0, 0.0, 1.0);
        gl_FragColor = vec4(vCol * pow(1.0 - r, 3.0), 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, pm);
  pts.frustumCulled = false;
  pts.onBeforeRender = (r) => { const rt = r.getRenderTarget(); pu.uViewH.value = rt ? rt.height : r.domElement.height; };
  g.add(band, pts);
  g.userData = { update(t) { pu.uTime.value = t; } };
  return g;
}
