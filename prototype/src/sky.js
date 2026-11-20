// Rendering of the space environment: procedural nebula skybox + sun, the planet with
// atmosphere, the cratered moon (shader-detailed + a local high-res ground patch) and ore beacons.
// All distances in metres; objects are positioned in the physics (Z-up) frame by main.js.
import * as THREE from 'three';
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
float craterLayer(vec3 p, float cell, float depthK, float seed, float fw){
  float wgt = 1.0 - smoothstep(0.1 * cell, 0.3 * cell, fw);
  if (wgt < 0.01) return 0.0;
  vec3 q = p / cell; vec3 id = floor(q); vec3 f = fract(q);
  float res = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){
    vec3 o = vec3(float(x), float(y), float(z)); vec3 cid = id + o;
    if (hash13(cid + seed) < 0.5) continue;
    vec3 c = o + vec3(hash13(cid + 1.7 + seed), hash13(cid + 3.1 + seed), hash13(cid + 5.3 + seed)) - f;
    float rad = 0.12 + 0.3 * hash13(cid + 8.8 + seed);
    float d = length(c) / rad;
    if (d > 2.2) continue;
    float bowl = -max(1.0 - d * d, 0.0);
    float rx = (d - 1.0) / 0.16;
    float rim = exp(-rx * rx) * 0.28;
    float ex = max(d - 1.0, 0.0) / 0.9;
    float eject = exp(-ex * ex) * 0.04 * (1.0 - smoothstep(1.3, 2.2, d));
    res += (bowl + rim + eject) * rad * cell * depthK;
  }
  return res * wgt;
}
float moonHeight(vec3 p, float fw){
  float h = craterLayer(p, 22000.0, 0.34, 1.0, fw) + craterLayer(p, 5200.0, 0.3, 11.0, fw) + craterLayer(p, 1100.0, 0.28, 21.0, fw)
          + craterLayer(p, 240.0, 0.26, 31.0, fw) + craterLayer(p, 52.0, 0.24, 41.0, fw) + craterLayer(p, 11.0, 0.22, 51.0, fw);
  h += (fbm4(p / 9000.0) - 0.5) * 900.0;
  h += (fbm4(p / 800.0) - 0.5) * 80.0 * (1.0 - smoothstep(60.0, 400.0, fw));
  h += (fbm4(p / 60.0) - 0.5) * 9.0 * (1.0 - smoothstep(4.0, 24.0, fw));
  h += (fbm4(p / 4.0) - 0.5) * 0.9 * (1.0 - smoothstep(0.15, 0.7, fw));
  h += (vnoise(p / 0.45) - 0.5) * 0.12 * (1.0 - smoothstep(0.03, 0.18, fw));
  return h;
}
`;

export function createMoonMaterial(isPatch) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.0 });
  mat.userData.uToMoon = { value: new THREE.Matrix3() };
  if (isPatch) { mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2; }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uToMoon = mat.userData.uToMoon;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMoonP;\nuniform mat3 uToMoon;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMoonP = uToMoon * position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${MOON_FS_HEAD}`)
      .replace('#include <map_fragment>', `
        vec3 mp = vMoonP;
        float fwp = length(fwidth(mp));
        float hgt = moonHeight(mp, fwp);
        float maria = smoothstep(0.42, 0.58, fbm4(mp / 30000.0 + 4.0));
        float tone = 1.0 + 0.9 * (fbm4(mp / 2500.0) - 0.5) * (1.0 - smoothstep(10.0, 300.0, fwp)) + 0.5 * (fbm4(mp / 3.0) - 0.5) * (1.0 - smoothstep(0.1, 0.6, fwp));
        float albedo = mix(0.2, 0.09, maria) * tone * (1.0 + 0.35 * smoothstep(40.0, 700.0, hgt));
        diffuseColor.rgb *= vec3(1.0, 0.97, 0.94) * albedo;`)
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

export function createMoon(radius) {
  const geo = new THREE.SphereGeometry(radius, 384, 192);
  const mesh = new THREE.Mesh(geo, createMoonMaterial(false));
  mesh.receiveShadow = false;
  return mesh;
}

/** polar grid patch (pole = +Z) of exact-sphere vertices: dense at the centre, sinking below the global sphere at its rim */
export function createGroundPatch(radius) {
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
  const mesh = new THREE.Mesh(geo, createMoonMaterial(true));
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
export function createSiteMarker(site) {
  const g = new THREE.Group();
  const color = new THREE.Color(0.25, 0.8, 1.6);
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
  for (let i = 0; i < 26; i++) {
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
