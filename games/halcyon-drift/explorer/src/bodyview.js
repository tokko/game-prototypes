// Orbit-view body renderer: one shader sphere for any body (palette-driven continents/bands, procedural craters at
// several scales, clouds, giant bands), a rim-scattering atmosphere shell, and the baked Kestrel map (same height recipe
// as the surface terrain, sampled at low resolution by workers).
import * as THREE from 'three';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { BODIES } from './destinations.js';

const FRAG = `
precision highp float;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
uniform vec3 uSun; uniform vec3 uFill; uniform vec3 uFillCol; uniform float uFillI;
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uCrater; uniform float uCloud; uniform vec3 uCloudCol;
uniform float uPits; uniform float uGiant; uniform float uR; uniform float uAlt; uniform float uTime; uniform float uBakeOn; uniform float uSunI;
uniform sampler2D uBake; uniform vec3 uAtmoCol; uniform float uAtmo; uniform float uSeed; uniform float uOcean; uniform float uOceanSpec; uniform float uLava;
uniform vec3 uGlowCol; uniform float uGlowK;      // Nyth: night-side bioluminescence
${NOISE_TEX_GLSL}
float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vh(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbh(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vh(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.97; }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float hash1(vec3 c){ vec2 uv = (c.xy + vec2(37.0, 17.0) * c.z + 0.5) / 256.0; return texture2D(uNoise, uv).b; }
vec4 hash4(vec3 c){ vec2 uv = (c.xy + vec2(37.0, 17.0) * c.z + 0.5) / 256.0; return texture2D(uNoise, uv); }
// crater height field (1 unit = 1 crater radius scale), 8 nearest cells
float craterH(vec3 p, float scale){
  vec3 q = p * scale; vec3 i = floor(q); vec3 f = fract(q); vec3 s = step(0.5, f) * 2.0 - 1.0; float h = 0.0;
  for (int k = 0; k < 8; k++){
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2)) * s; vec3 c = i + o;
    vec4 r = hash4(c); if (r.w < 0.3) continue;
    vec3 ctr = c + 0.2 + 0.6 * r.xyz;
    float sz = (r.w - 0.3) / 0.7;                       // 0..1, many small and a few large
    float rad = 0.09 + 0.4 * pow(sz, 3.0);
    float d = length(q - ctr) / rad;
    if (d > 1.8) continue;
    float bowl = d < 1.0 ? -(1.0 - d * d) * (0.75 + 0.25 * d) : 0.0;
    float rim = 0.3 * exp(-(d - 1.0) * (d - 1.0) * 9.0);
    float eject = d > 1.0 ? 0.08 * exp(-(d - 1.0) * 2.5) : 0.0;
    h += (bowl + rim + eject) * rad * (0.55 + 0.45 * sz);
  }
  return h / scale;
}
float craters(vec3 p){
  float h = 0.0;
  float cell0 = uR / 4.0; h += craterH(p, 4.0) * (1.0 - smoothstep(cell0 * 40.0, cell0 * 400.0, uAlt));
  float cell1 = uR / 14.0; h += craterH(p, 14.0) * (1.0 - smoothstep(cell1 * 30.0, cell1 * 300.0, uAlt));
  float cell2 = uR / 52.0; h += craterH(p, 52.0) * (1.0 - smoothstep(cell2 * 25.0, cell2 * 220.0, uAlt));
  float cell3 = uR / 190.0; h += craterH(p, 190.0) * (1.0 - smoothstep(cell3 * 20.0, cell3 * 140.0, uAlt));
  return h;
}
void main(){
  vec3 n = normalize(vObj); vec3 N = normalize(vWN); vec3 L = normalize(uSun); vec3 V = normalize(cameraPosition - vWP);
  vec3 alb; vec3 Np = N; float spec = 0.0; float oceanMask = 0.0; float lavaE = 0.0;
  float cr = 0.0;
  if (uGiant > 0.5) {
    float lat = n.y;
    float lw = lat + 0.07 * (fbm(n * 3.0 + uSeed) - 0.5) + 0.02 * (fbm(n * 9.0) - 0.5);
    float s1 = 0.5 + 0.5 * sin(lw * 15.0 + 2.0 * sin(lw * 4.0)), s2 = 0.5 + 0.5 * sin(lw * 38.0 + 1.0);
    float bt = clamp(s1 * 0.6 + s2 * 0.2 + (fbm(n * 2.0 + vec3(0.0, lat * 22.0, 0.0)) - 0.5) * 0.9, 0.0, 1.0);
    alb = mix(uC1, uC2, smoothstep(0.15, 0.55, bt)); alb = mix(alb, uC3, smoothstep(0.55, 0.95, bt));
  } else {
    float wA = fbm(n * 3.2 + uSeed), wB = fbm(n * 9.0 + 4.0 + uSeed);
    alb = mix(uC1, uC2, smoothstep(0.3, 0.7, fbm(n * 1.7 + uSeed + 7.0) * 0.6 + wA * 0.4));
    alb = mix(alb, uC3, smoothstep(0.55, 0.8, wB) * 0.55);
    if (uBakeOn > 0.5) {
      float lon = atan(-n.z, n.x), lat = asin(clamp(n.y, -1.0, 1.0));
      vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
      vec2 tx = vec2(1.0 / 2048.0, 1.0 / 1024.0);
      vec4 b = texture2D(uBake, uv);
      vec2 t8 = tx * 8.0;
      float hL = textureLod(uBake, uv - vec2(t8.x, 0.0), 3.0).r, hR = textureLod(uBake, uv + vec2(t8.x, 0.0), 3.0).r;
      float hD = textureLod(uBake, uv - vec2(0.0, t8.y), 3.0).r, hU = textureLod(uBake, uv + vec2(0.0, t8.y), 3.0).r;
      float cl = max(length(n.xz), 1e-3); float cLon = n.x / cl, sLon = -n.z / cl;
      vec3 E = vec3(-sLon, 0.0, -cLon), Nn = vec3(-n.y * cLon, cl, n.y * sLon);
      float texM = 6.2831853 * uR / 2048.0 * 8.0;
      float gx = (hR - hL) * 1800.0 / (2.0 * texM), gy = (hU - hD) * 1800.0 / (2.0 * texM);
      Np = normalize(N - (E * gx + Nn * gy) * 2.5);
      vec3 dust = uC1 * (0.95 + 0.1 * wA), rock = uC2 * 1.15;
      vec4 lo = textureLod(uBake, uv, 4.5);
      alb = mix(dust, rock, clamp(smoothstep(0.18, 0.6, lo.a) * 0.4 + b.a * 0.3 + smoothstep(0.62, 0.72, wB) * 0.12, 0.0, 0.8));
      alb = mix(alb, uC3, clamp(lo.g * 0.3 + b.g * 0.04, 0.0, 0.3));
      alb = mix(alb, vec3(0.74, 0.8, 0.86), clamp(lo.b * 0.4 + b.b * 0.15, 0.0, 0.35));
      alb *= 0.9 + 0.22 * b.r;
    }
        if (uOcean > 0.0) {      // living world: oceans, green continents, deserts, mountains, polar caps (low frequency version of the surface recipe)
      vec3 wn = n + 0.18 * (vec3(fbh(n * 2.3 + 5.0), fbh(n * 2.3 + 9.0), fbh(n * 2.3 + 14.0)) - 0.5);       // warp: ragged coastlines
      float e = fbh(wn * 1.9 + uSeed * 0.37) * 0.5 + fbh(wn * 5.3 + 3.0) * 0.3 + fbh(wn * 13.0 + 1.0) * 0.14 + fbh(wn * 34.0) * 0.06;
      float shore = smoothstep(uOcean - 0.022, uOcean + 0.026, e);
      float lat = abs(n.y);
      float moistL = fbh(n * 3.1 + 21.0) + 0.25 * (1.0 - lat) - 0.12;                                          // wetter near the equator
      float desert = smoothstep(0.40, 0.28, moistL) * smoothstep(0.1, 0.35, lat) * (1.0 - smoothstep(0.65, 0.8, lat));
      float hi = smoothstep(uOcean + 0.08, uOcean + 0.2, e);
      vec3 forest = uC2 * vec3(0.8, 0.95, 0.7), grassL = uC2 * vec3(1.25, 1.35, 0.75), sand = vec3(0.62, 0.52, 0.32), rockL = vec3(0.34, 0.31, 0.27);
      vec3 land = mix(forest, grassL, smoothstep(0.35, 0.7, fbh(n * 6.0 + 2.0)));
      land = mix(land, sand * (0.85 + 0.3 * fbh(n * 12.0)), desert);
      land = mix(land, rockL * (0.8 + 0.4 * fbh(n * 20.0)), hi * 0.65);
      land *= 0.82 + 0.34 * fbh(n * 40.0);
      float seaDeep = smoothstep(uOcean - 0.01, uOcean - 0.16, e);
      vec3 sea = mix(uC1 * 1.7 + vec3(0.0, 0.06, 0.05), uC1 * 0.55, seaDeep);
      alb = mix(sea, land, shore);
      alb = mix(alb, vec3(0.62, 0.7, 0.68), (1.0 - smoothstep(0.0, 0.05, abs(e - uOcean))) * 0.4 * (1.0 - shore * 0.0));
      float cap = smoothstep(0.78, 0.9, lat + 0.07 * (fbh(n * 8.0) - 0.5)); alb = mix(alb, vec3(0.92, 0.95, 0.98), cap);
      oceanMask = (1.0 - shore) * (1.0 - cap);
    }
    if (uCrater > 0.0) {
      cr = craters(n) * uCrater;
      float e = 0.0015 * 2.0;
      vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.01))); vec3 t2 = cross(n, t1);
      float c0 = cr; float c1 = craters(normalize(n + t1 * e)) * uCrater, c2 = craters(normalize(n + t2 * e)) * uCrater;
      float k = uR * 0.9;
      Np = normalize(Np - (t1 * (c1 - c0) + t2 * (c2 - c0)) / e * 0.12);
      alb *= 1.0 + 1.3 * clamp(cr * 0.5, -0.2, 0.15);
      float fineA = 1.0 - smoothstep(uR * 0.08, uR * 0.5, uAlt);
      alb *= 1.0 + fineA * (0.5 * (fbm(n * 1400.0) - 0.5) + 0.35 * (fbm(n * 5200.0) - 0.5));
    }
    if (uLava > 0.0) {      // PYRA: dark basalt crust cut by glowing lava veins and seas (emissive: visible on the night side too)
      float f1 = fbh(n * 3.0 + uSeed), f2 = fbh(n * 8.0 + 11.0);
      alb = mix(vec3(0.03, 0.026, 0.026), vec3(0.15, 0.115, 0.1), smoothstep(0.3, 0.72, 0.5 * f1 + 0.5 * f2));
      vec3 wv = 1.6 * vec3(fbh(n * 2.0), fbh(n * 2.0 + 4.0), fbh(n * 2.0 + 8.0));
      float vein = 1.0 - smoothstep(0.0, 0.03, abs(fbh(n * 5.0 + 3.0 + wv) - 0.5));
      float vein2 = 1.0 - smoothstep(0.0, 0.012, abs(fbh(n * 13.0 + 5.0 + wv) - 0.5));
      float seas = smoothstep(0.7, 0.9, fbh(n * 2.3 + 9.0 + uSeed));
      float brk = 0.55 + 0.9 * fbh(n * 26.0 + 2.0);
      lavaE = clamp((vein * 0.9 + vein2 * 0.4 * smoothstep(0.4, 0.7, f2)) * brk + seas * 0.7 * (0.5 + 0.6 * fbh(n * 17.0)), 0.0, 1.0);
      alb = mix(alb, vec3(0.02, 0.014, 0.012), seas);
    }
    if (uCloud > 0.0) {
      // slowly rotating cloud deck: jet-stream bands + swirled cumulus, thicker over oceans, with a soft shadow on the surface
      float rot = uTime * 2.2e-5;
      float cs = cos(rot), sn = sin(rot);
      vec3 nr = vec3(n.x * cs - n.z * sn, n.y, n.x * sn + n.z * cs);
      vec3 cp = nr * 4.2;
      float band = 0.5 + 0.5 * sin(nr.y * 11.0 + 2.5 * fbh(nr * 2.0 + 3.0));
      float cb = fbh(cp + 1.6 * vec3(fbh(cp * 1.7), fbh(cp * 1.7 + 5.0), fbh(cp * 1.7 + 9.0)));
      float cloud = smoothstep(0.46 - 0.1 * band, 0.86 - 0.06 * band, cb) * uCloud * (0.7 + 0.45 * oceanMask);
      float cloudS = smoothstep(0.46 - 0.1 * band, 0.86 - 0.06 * band, fbh(cp * 0.99 + 1.6 * vec3(fbh(cp * 1.7), fbh(cp * 1.7 + 5.0), fbh(cp * 1.7 + 9.0)) + 0.012 * vec3(1.0, 0.0, 0.5))) * uCloud;
      alb *= 1.0 - 0.45 * clamp(cloudS - cloud, 0.0, 1.0);
      alb = mix(alb, uCloudCol, clamp(cloud, 0.0, 1.0));
    }
  }
  // AETHEL: lattice of gates (keep in sync with GATE in terrain/aethel.js): bright ejecta apron, terraced dark funnel, glowing hatch
  vec3 pitEmit = vec3(0.0);
  if (uPits > 0.5 && uGiant < 0.5) {
    float latP = asin(clamp(n.y, -1.0, 1.0)), lonP = atan(-n.z, n.x);
    if (abs(latP) < 1.05) {
      float px = lonP * uR, pz = -latP * uR, clP = cos(latP), best = 1e9, j0 = floor(pz / 200000.0 + 0.5);
      for (int jj = -1; jj <= 1; jj++) {
        float j = j0 + float(jj), off = abs(mod(j, 2.0)) * 100000.0, i = floor((px - off) / 200000.0 + 0.5);
        best = min(best, length(vec2((px - (i * 200000.0 + off)) * clP, pz - j * 200000.0)));
      }
      best /= 1.5;                       // painted 1.5x the real size so the gates read from orbit
      float tP = clamp((best - 7500.0) / 19500.0, 0.0, 1.0), depthP = pow(1.0 - tP, 1.0);
      float inside = 1.0 - smoothstep(27000.0, 29000.0, best);
      alb = mix(alb, alb * 1.3 + vec3(0.03, 0.05, 0.05), smoothstep(60000.0, 30000.0, best) * 0.55);
      alb *= 1.0 - 0.96 * smoothstep(0.0, 0.5, depthP) * inside;
      alb *= 1.0 - 0.12 * inside * (0.5 + 0.5 * sin(depthP * 90.0));
      pitEmit = (vec3(0.30, 0.95, 0.85) * smoothstep(13000.0, 2500.0, best) * 1.2 + vec3(1.0, 0.92, 0.65) * smoothstep(4200.0, 0.0, best) * 3.0) * (0.85 + 0.15 * sin(uTime * 0.4 + best * 0.0004));
    }
  }
  float NdLg = dot(N, L); float NdL = mix(dot(Np, L), NdLg, 0.3);
  float diff = max(NdL, 0.0) * smoothstep(-0.02, 0.12, NdLg);
  vec3 col = alb * (diff * uSunI / 3.14159 * 1.1);
  // giant-shine / ambient fill
  col += alb * uFillCol * uFillI * max(dot(Np, normalize(uFill)) * 0.6 + 0.4, 0.0);
  col += alb * 0.004 + pitEmit;
  if (uLava > 0.0) { float limbH = pow(1.0 - max(dot(N, V), 0.0), 2.0); col += mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.45, 0.1), lavaE) * lavaE * 0.7 * uLava * (1.0 - 0.75 * limbH); }      // lava glows through the ash: veiled towards the limb
  if (uOcean > 0.0 && oceanMask > 0.5) { vec3 R = reflect(-L, N); float sp = pow(max(dot(R, V), 0.0), 70.0); col += vec3(1.0, 0.92, 0.75) * sp * uSunI * 0.5 * smoothstep(0.0, 0.1, NdLg); }
  // terminator warmth + atmosphere tint
  if (uAtmo > 0.0) {
    float tw = exp(-pow((NdLg - 0.02) / 0.18, 2.0));
    col += uAtmoCol * tw * 0.12 * uAtmo;
    col = mix(col, col + uAtmoCol * pow(1.0 - max(dot(N, V), 0.0), uLava > 0.0 ? 5.0 : 3.0) * (uLava > 0.0 ? 0.26 : 0.5) * smoothstep(-0.2, 0.4, NdLg), uAtmo);
  }
  if (uGlowK > 0.0 && uGiant < 0.5) {        // bioluminescent world: glowing root veins and plankton seas on the night side
    float land = 1.0 - oceanMask;
    float gv = max(1.0 - smoothstep(0.0, 0.05, abs(fbh(n * 7.0 + 3.0 + uSeed) - 0.5)), 0.7 * (1.0 - smoothstep(0.0, 0.05, abs(fbh(n * 19.0 + 8.0) - 0.5))));
    float gp = smoothstep(0.55, 0.8, fbh(n * 2.6 + 9.0 + uSeed));
    float gs = (gv * 0.8 + gp * 0.9) * land + 0.35 * oceanMask * smoothstep(0.5, 0.8, fbh(n * 5.0 + 1.0));
    col += uGlowCol * gs * (1.0 - smoothstep(-0.06, 0.2, NdLg)) * uGlowK * (0.4 + 0.6 * fbh(n * 1.3 + 2.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_FRAG = `
precision highp float;
varying vec3 vWP; uniform vec3 uSun; uniform vec3 uAtmoCol; uniform float uK; uniform vec3 uCen; uniform float uRp; uniform float uRa; uniform float uH;
uniform vec3 uBeta; uniform vec3 uMieCol; uniform vec3 uTint;
float sph(vec3 ro, vec3 rd, float r, out float t1){ float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c; if (d < 0.0) { t1 = -1.0; return -1.0; } float s = sqrt(d); t1 = -b + s; return -b - s; }
void main(){
  vec3 ro = cameraPosition - uCen; vec3 rd = normalize(vWP - cameraPosition);
  float ta1; float ta0 = sph(ro, rd, uRa, ta1); if (ta1 < 0.0) discard;
  float tp1; float tp0 = sph(ro, rd, uRp, tp1);
  float t0 = max(ta0, 0.0), t1 = ta1; if (tp0 > 0.0) t1 = min(t1, tp0);
  if (t1 <= t0) discard;
  const int N = 14; float dt = (t1 - t0) / float(N);
  vec3 L = normalize(uSun); float mu = dot(rd, L); float g = 0.74;
  float phR = 0.75 * (1.0 + mu * mu), phM = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08;
  vec3 sum = vec3(0.0); vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float t = t0 + (float(i) + 0.5) * dt; vec3 p = ro + rd * t; float h = length(p) - uRp; float dens = exp(-max(h, 0.0) / uH);
    vec3 up = normalize(p); float sunUp = dot(up, L);
    float sunAm = 1.0 / max(sunUp + 0.12, 0.06);
    vec3 sunT = exp(-uBeta * dens * uH * 1e-7 * sunAm * 1.0);
    float lit = smoothstep(-0.28, 0.1, sunUp);
    od += uBeta * dens * dt * 1e-7;
    sum += exp(-od) * dens * dt * 1e-7 * lit * (uBeta * 1.0 * phR * 0.25 * sunT + uMieCol * phM * 6.0 * sunT * 1.0);
  }
  gl_FragColor = vec4(sum * uK * uTint, 1.0);
}`;

export class BodyView {
  constructor() {
    this.group = new THREE.Group();
    const u = {
      uSun: { value: new THREE.Vector3(1, 0, 0) }, uFill: { value: new THREE.Vector3(0, 1, 0) }, uFillCol: { value: new THREE.Color(1, 0.6, 0.3) }, uFillI: { value: 0 },
      uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() }, uCrater: { value: 1 }, uCloud: { value: 0 }, uCloudCol: { value: new THREE.Color() },
      uGiant: { value: 0 }, uR: { value: 3e5 }, uAlt: { value: 4e4 }, uTime: { value: 0 }, uBakeOn: { value: 0 }, uPits: { value: 0 }, uSunI: { value: 4.5 }, uBake: { value: null }, uOcean: { value: 0 },
      uAtmoCol: { value: new THREE.Color(0.3, 0.5, 1) }, uLava: { value: 0 }, uAtmo: { value: 0 }, uSeed: { value: 0 }, uNoise: { value: noiseTexture() },
      uGlowCol: { value: new THREE.Color() }, uGlowK: { value: 0 },
    };
    this.u = u;
    this.mat = new THREE.ShaderMaterial({
      uniforms: u, fragmentShader: FRAG,
      vertexShader: 'varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; void main(){ vObj = position; vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 160), this.mat);
    this.mesh.frustumCulled = false;
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { uSun: u.uSun, uAtmoCol: u.uAtmoCol, uK: { value: 1 }, uCen: { value: new THREE.Vector3() }, uRp: { value: 1 }, uRa: { value: 1 }, uH: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uBeta: { value: new THREE.Vector3(5.8, 13.5, 33.1) }, uMieCol: { value: new THREE.Vector3(1, 0.82, 0.55) } }, fragmentShader: ATMO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vWN; varying vec3 vWP; void main(){ vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.atmoMat);
    this.atmo.frustumCulled = false; this.atmo.visible = false;
    this.group.add(this.mesh, this.atmo);
    this.bodyId = null; this.bake = {};
  }
  setBody(id) {
    if (this.bodyId === id) return;
    this.bodyId = id; const b = BODIES[id]; const u = this.u;
    const c = (a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
    u.uC1.value.copy(c(b.palette.c1)); u.uC2.value.copy(c(b.palette.c2)); u.uC3.value.copy(c(b.palette.c3)); u.uCloudCol.value.copy(c(b.palette.cloudColor));
    u.uCrater.value = b.palette.crater; u.uCloud.value = b.palette.cloud; u.uGiant.value = b.kind === 'giant' ? 1 : 0; u.uR.value = b.R;
    u.uSeed.value = (id.charCodeAt(0) * 7 + id.length * 13) % 50;
    const bk = this.bake[id];
    u.uBakeOn.value = bk ? 1 : 0; u.uBake.value = bk || null;
    if (b.atmosphere) { u.uAtmo.value = 1; u.uAtmoCol.value.setRGB(b.atmosphere.color[0], b.atmosphere.color[1], b.atmosphere.color[2]); this.atmo.visible = true; const vh = b.atmosphere.visH || b.atmosphere.height; this.atmo.scale.setScalar(b.R * (1 + vh * 1.5)); const au = this.atmoMat.uniforms; au.uRp.value = b.R; au.uRa.value = b.R * (1 + vh * 1.5); au.uH.value = b.R * vh * 0.3; const sc = b.atmosphere.scatter; if (sc) { au.uBeta.value.set(...sc.betaR); au.uMieCol.value.set(...sc.mieCol); } au.uK.value = sc ? (sc.rimK || 0.9) : 0.5; au.uTint.value.set(...((sc && sc.tint) || [1, 1, 1])); }
    else { u.uAtmo.value = 0; this.atmo.visible = false; }
    u.uOcean.value = b.palette.ocean || 0; u.uLava.value = b.palette.lava || 0; u.uPits.value = b.palette.pits ? 1 : 0;
    u.uGlowK.value = b.palette.glow ? 1 : 0; if (b.palette.glow) u.uGlowCol.value.setRGB(b.palette.glow[0], b.palette.glow[1], b.palette.glow[2]);      // Nyth
    this.mesh.scale.setScalar(b.R);
  }
  setBake(id, tex) { this.bake[id] = tex; if (this.bodyId === id) { this.u.uBakeOn.value = 1; this.u.uBake.value = tex; } }
  /** pos: body centre in render space */
  update(pos, alt, sunDir, t) {
    this.group.position.copy(pos); this.atmoMat.uniforms.uCen.value.copy(pos);
    this.u.uSun.value.copy(sunDir); this.u.uAlt.value = Math.max(alt, 100); this.u.uTime.value = t;
  }
}

/** bake the equirectangular orbit map in workers (R height, G rust, B ice, A rock) */
export function bakeOrbitMap(recipeId, R, W = 1024, H = 512, onProgress) {
  return new Promise((resolve) => {
    const data = new Uint8Array(W * H * 4);
    const nw = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const chunk = 16; let next = 0, done = 0; const total = Math.ceil(H / chunk);
    const workers = [];
    const feed = (w) => {
      if (next >= H) return;
      const r0 = next, r1 = Math.min(H, next + chunk); next = r1;
      w.postMessage({ t: 'bake', id: 0, recipe: recipeId, W, H, r0, r1, R });
    };
    for (let i = 0; i < nw; i++) {
      const w = new Worker(new URL('./terrain/worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const m = e.data; data.set(m.out, m.r0 * W * 4); done++;
        if (onProgress) onProgress(done / total);
        if (done >= total) {
          workers.forEach((x) => x.terminate());
          const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
          tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
          resolve(tex);
        } else feed(w);
      };
      workers.push(w); feed(w);
    }
  });
}
