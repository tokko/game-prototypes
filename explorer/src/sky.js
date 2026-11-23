// Sky dome: starfield + faint galactic band, sun disc and glow, a banded/ringed gas giant (ray-traced sphere +
// ring plane with mutual shadows), a small second moon, optional atmosphere haze hook. One draw call.
// All directions are in the render space of the active scene.
import * as THREE from 'three';

import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { atmU, ATMO_PARS } from './atmo.js';
const NOISE = NOISE_TEX_GLSL + `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float fbm5(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float vnq(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 uv = (i.xy + vec2(37.0, 17.0) * i.z + f.xy + 0.5) / 256.0; vec2 rg = texture2D(uNoise, uv).yx; return mix(rg.x, rg.y, f.z); }
float fbq(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnq(p); p = p * 2.07 + 11.3; a *= 0.5; } return s; }
// longitude-periodic, latitude-smooth 2D noise on the sphere (no lattice creases on the pale giant)
float gn2(vec2 ll, float F){ vec2 p = ll * (256.0 / F) / 6.2831853; vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); return texture2D(uNoise, (i + f + 0.5) / 256.0).b; }
float fbg(vec2 ll){ return (0.5 * gn2(ll, 32.0) + 0.27 * gn2(ll + 2.0, 16.0) + 0.14 * gn2(ll + 5.0, 8.0) + 0.08 * gn2(ll + 9.0, 4.0) + 0.04 * gn2(ll + 13.0, 2.0)) / 1.03; }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

const FRAG = `${NOISE}
${ATMO_PARS}
varying vec3 vDir;
uniform vec3 uSun; uniform float uSunAng; uniform float uTime; uniform float uEnv; uniform float uStar;
uniform vec3 uG; uniform float uGR; uniform vec3 uRingN; uniform float uGOn; uniform float uHasRing;
uniform vec3 uGA; uniform vec3 uGB; uniform vec3 uGC; uniform vec2 uRing; uniform float uRingK;
uniform vec3 uM; uniform float uMR; uniform float uMOn; uniform float uGStyle; uniform vec3 uStormA; uniform vec3 uStormB;
uniform vec4 uAtmo; uniform vec3 uUp;
const vec3 GAL = vec3(0.25, 0.9, -0.35);
const mat3 ROT = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);

vec3 starLayer(vec3 d, float sc, float seed, float thresh){
  vec3 p = d * sc; vec3 id = floor(p); vec3 f = fract(p) - 0.5;
  float h = hash13(id + seed);
  float dens = 1.35 / (abs(d.x) + abs(d.y) + abs(d.z));
  if (h < 1.0 - (1.0 - thresh) * dens) return vec3(0.0);
  vec3 off = vec3(hash13(id + 1.3 + seed), hash13(id + 2.7 + seed), hash13(id + 4.1 + seed)) - 0.5;
  float dd = length(f - off * 0.6);
  float b = pow(hash13(id + 9.0 + seed), 4.0);
  float s = 1.0 - smoothstep(0.0, 0.14, dd);
  float temp = hash13(id + 6.6 + seed);
  vec3 c = mix(vec3(1.0, 0.75, 0.55), vec3(0.65, 0.8, 1.0), temp);
  return c * s * (0.3 + 3.2 * b);
}

// ray vs sphere (centre c, radius r), ray from origin; returns near t or -1
float sphereHit(vec3 d, vec3 c, float r){
  float b = dot(d, c); float disc = b * b - (dot(c, c) - r * r);
  if (disc < 0.0) return -1.0;
  return b - sqrt(disc);
}
float ringDensity(float rn){
  float d = 0.55 + 0.16 * sin(rn * 37.0) + 0.1 * sin(rn * 91.0 + 2.0) + 0.1 * sin(rn * 17.0 + 1.0) + 0.1 * (vnoise(vec3(rn * 90.0, 1.0, 2.0)) - 0.5);
  d *= smoothstep(0.0, 0.05, abs(rn - 0.64)) * smoothstep(0.0, 0.02, abs(rn - 0.31)) * smoothstep(0.0, 0.03, abs(rn - 0.86));
  d *= mix(0.45, 1.0, smoothstep(0.1, 0.34, rn));
  d *= smoothstep(0.0, 0.05, rn) * smoothstep(1.0, 0.93, rn);
  return clamp(d, 0.0, 1.0);
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.0015, 0.0018, 0.004);
  // galactic band (faint)
  float lat = dot(d, normalize(GAL));
  float band = exp(-lat * lat / 0.045);
  if (band > 0.02) {
    vec3 q = d * 2.1;
    float w1 = fbm3(q * 1.3 + 3.0);
    float w2 = fbm5(q * 3.0 + w1 * 2.2 + 11.0);
    float neb = smoothstep(0.32, 0.8, w2);
    float dust = smoothstep(0.42, 0.7, fbm3(q * 6.0 + w2 * 3.0 + 40.0));
    vec3 tint = mix(vec3(0.30, 0.34, 0.55), vec3(0.62, 0.42, 0.40), smoothstep(0.3, 0.7, fbm3(q * 2.0 + 7.0)));
    col += tint * neb * band * 0.035 + vec3(0.9, 0.7, 0.5) * exp(-lat * lat / 0.006) * 0.012 * (0.5 + w1);
    col *= 1.0 - 0.18 * dust * band;
  }
  float thr = 0.972 - 0.025 * band;
  vec3 d1 = ROT * d, d2 = ROT * d1;
  col += uStar * (starLayer(d, 70.0, 0.0, thr) + starLayer(d1, 150.0, 7.0, thr) + starLayer(d2, 330.0, 13.0, thr + 0.004));
  col += uStar * vec3(0.7, 0.8, 1.0) * pow(max(vnoise(ROT * ROT * ROT * d * 900.0) - 0.8, 0.0) * 4.0, 2.0) * (0.25 + band);

  // atmosphere haze hook (worlds with air)
  if (uAtmo.a > 0.0) {
    float up = dot(d, uUp);
    float sg = max(dot(d, uSun), 0.0);
    float horizon = pow(1.0 - clamp(up, 0.0, 1.0), 4.0);
    float sunUp = smoothstep(-0.25, 0.3, dot(uUp, uSun));
    col = mix(col, uAtmo.rgb * (0.15 + 0.85 * sunUp) * (0.4 + horizon), uAtmo.a * smoothstep(-0.2, 0.6, 1.0 - up * 0.8));
    col += uAtmo.rgb * pow(sg, 8.0) * 0.5 * uAtmo.a;
  }

  // gas giant + ring
  if (uGOn > 0.5) {
    float r = sin(uGR);
    vec3 c = uG;
    vec3 Nr = normalize(uRingN);
    float tp = sphereHit(d, c, r);
    bool ph = tp > 0.0;
    vec3 base = col;
    // planet
    if (ph) {
      vec3 p = d * tp; vec3 N = normalize(p - c);
      float ang = uTime * 0.00006;
      vec3 axis = Nr;
      vec3 Nrot = N * cos(ang) + cross(axis, N) * sin(ang) + axis * dot(axis, N) * (1.0 - cos(ang));
      float lt = dot(Nrot, axis);
      vec3 pp = Nrot - axis * lt;
      // festooned band edges: latitude displaced by noise that changes with longitude
      float turb, turb2, latw, b1, b2, bt;
      if (uGStyle > 0.5) {         // pale temperate giant: warped multi-octave festoons, many soft bands, a cream storm
        vec3 ea = normalize(cross(axis, vec3(0.3, 0.9, 0.1))), eb = cross(axis, ea);
        vec2 ll = vec2(atan(dot(Nrot, eb), dot(Nrot, ea)), asin(clamp(lt, -1.0, 1.0)));
        float w1 = fbg(ll + 3.0) - 0.5, w2 = fbg(ll + vec2(8.0, 2.0)) - 0.5;
        vec2 llw = ll + vec2(1.6 * w1, 0.05 * w2);                       // longitude shear = festoons
        turb = fbg(llw + 1.0) - 0.5; turb2 = fbg(llw * 3.0 + 4.0) - 0.5;
        latw = lt + 0.12 * turb + 0.04 * turb2;
        b1 = sin(latw * 17.0 + 1.8 * sin(latw * 4.5 + 0.5 + 2.0 * turb)); b2 = sin(latw * 36.0 + 2.0 + 4.0 * turb);
        bt = smoothstep(-1.1, 1.1, b1 * 0.85 + 0.2 * b2 + 0.55 * turb);
      } else {
        turb = fbm3(pp * 2.6 + axis * lt * 2.2 + 1.0) - 0.5; turb2 = fbm3(pp * 6.5 + axis * lt * 5.0 + 4.0) - 0.5;
        latw = lt + 0.065 * turb + 0.02 * turb2;
        b1 = sin(latw * 14.0 + 1.4 * sin(latw * 4.0 + 0.5)); b2 = sin(latw * 31.0 + 2.0);
        bt = smoothstep(-0.75, 0.75, b1 * 0.8 + 0.22 * b2);
      }
      vec3 alb = mix(uGA, uGB, smoothstep(0.08, 0.5, bt));
      alb = mix(alb, uGC, smoothstep(0.5, 0.95, bt));
      float belt = exp(-pow((fract(latw * 2.3 + 0.3) - 0.5) * 5.5, 2.0));
      alb *= 1.0 - 0.28 * belt * (0.6 + 0.8 * turb);
      alb *= 0.96 + 0.1 * ((uGStyle > 0.5 ? fbg(vec2(atan(Nrot.z, Nrot.x), asin(clamp(lt, -1.0, 1.0))) * 2.5 + 7.0) : fbm3(Nrot * 5.0 + axis * lt * 22.0)) - 0.5);
      alb = mix(alb, vec3(0.42, 0.40, 0.42), smoothstep(0.76, 0.97, abs(lt)) * 0.55);
      float t2 = fbm3(Nrot * 10.0 + vec3(3.0, 1.0, 7.0));
      // storm
      vec3 e1 = normalize(cross(axis, vec3(0.3, 0.9, 0.1))); vec3 e2 = cross(axis, e1);
      float latS = uGStyle > 0.5 ? -0.30 : -0.42, lonS = uGStyle > 0.5 ? 0.9 : 0.5;
      vec3 sp = e1 * cos(lonS) * cos(latS) + e2 * sin(lonS) * cos(latS) + axis * sin(latS);
      vec3 vv = Nrot - sp; float va = dot(vv, axis);
      float dist = length(vec2(va * 2.6, length(vv - axis * va)));
      float stormM = smoothstep(0.29, 0.1, dist);
      float swirl = 0.5 + 0.5 * sin(atan(dot(vv, e2), dot(vv, e1)) * 2.0 + dist * 38.0 - fbm3(Nrot * 14.0) * 3.0);
      vec3 stormC = uGStyle > 0.5 ? mix(uStormA, uStormB, swirl) : mix(vec3(0.62, 0.2, 0.1), vec3(0.88, 0.5, 0.28), swirl);
      alb = mix(alb, stormC, stormM);
      alb = mix(alb, uGC * 1.05, smoothstep(0.035, 0.0, abs(dist - 0.31)) * 0.5);
      alb *= 0.9 + 0.2 * t2;
      // lighting
      float NdL = dot(N, uSun);
      float lit = smoothstep(-0.2, 0.6, NdL);
      float mu = clamp(dot(N, -d), 0.0, 1.0);
      float limb = pow(mu, 0.55);
      // ring shadow on planet
      float shadow = 1.0;
      if (uHasRing > 0.5) {
        float den = dot(uSun, Nr);
        if (abs(den) > 1e-3) {
          float ts = -dot(p - c, Nr) / den;
          if (ts > 0.0) { vec3 qq = p + uSun * ts - c; float rr = length(qq) / r; if (rr > uRing.x && rr < uRing.y) shadow = 1.0 - 0.82 * ringDensity((rr - uRing.x) / (uRing.y - uRing.x)); }
        }
      }
      vec3 pc = alb * (lit * 2.3 * shadow * limb + 0.01);
      pc += vec3(1.0, 0.82, 0.6) * pow(1.0 - mu, 5.0) * 0.5 * smoothstep(-0.1, 0.5, NdL);
      float twx = (NdL - 0.04) / 0.16; pc += vec3(0.9, 0.35, 0.15) * exp(-twx * twx) * 0.08;
      base = pc;
    } else {
      // soft glow just outside the limb
      float cd = acos(clamp(dot(d, c), -1.0, 1.0)); float a = uGR;
      base += uGB * exp(-max(cd - a, 0.0) * 28.0) * 0.06 * smoothstep(-0.2, 0.5, dot(normalize(c), uSun) * -0.5 + 0.5);
    }
    // ring
    if (uHasRing > 0.5) {
      float dn = dot(d, Nr);
      if (abs(dn) > 1e-5) {
        float tr = dot(c, Nr) / dn;
        if (tr > 0.0 && (!ph || tr < tp)) {
          vec3 q = d * tr - c; float rr = length(q) / r;
          if (rr > uRing.x && rr < uRing.y) {
            float rn = (rr - uRing.x) / (uRing.y - uRing.x);
            float den = ringDensity(rn);
            // planet shadow on the ring
            float sh = 1.0; float tsun = sphereHit(uSun, -q, r);
            if (tsun > 0.0) sh = 0.07;
            float sunSide = dot(Nr, uSun) * dn; // lit face towards viewer?
            vec3 rc = mix(vec3(0.72, 0.60, 0.45), vec3(0.92, 0.85, 0.72), den) * (0.55 + 0.7 * vnoise(vec3(rn * 220.0, 3.0, 1.0)));
            float lightK = abs(dot(uSun, Nr)) * 0.75 + 0.25;
            // unlit face of a thin ring only scatters forward
            float face = sunSide > 0.0 ? 1.0 : 0.25;
            vec3 rcol = rc * 1.5 * uRingK * lightK * sh * face;
            base = mix(base, rcol, den * 0.7);
          }
        }
      }
    }
    col = base;
  }

  // second moon
  if (uMOn > 0.5) {
    float rm = sin(uMR);
    float tm = sphereHit(d, uM, rm);
    if (tm > 0.0) {
      vec3 p = d * tm; vec3 N = normalize(p - uM);
      float cr = fbm5(N * 7.0 + 3.0) * 0.6 + fbm3(N * 24.0) * 0.4;
      float cc = smoothstep(0.55, 0.62, vnoise(N * 9.0)) * 0.3;
      vec3 alb = vec3(0.34, 0.33, 0.33) * (0.55 + 0.9 * cr) * (1.0 - cc);
      float NdL = dot(N, uSun);
      col = alb * (smoothstep(-0.05, 0.3, NdL) * max(NdL, 0.0) * 3.0 + 0.012);
    }
  }

  // worlds with air: extinction of everything behind the atmosphere + in-scattered sky light
  vec3 sunTint = vec3(1.0, 0.9, 0.74);
  if (uAOn > 0.5) {
    vec3 da = normalize(vec3(d.x, max(d.y, 0.0), d.z));
    { vec3 sc = aInscatter(da); col = col * aTrans(da) + sc / (1.0 + 0.32 * sc); }
    sunTint = aSunDirect() * vec3(1.0, 0.95, 0.86);
  }
  if (uEnv < 0.5) {
  // sun
  float sd = dot(d, uSun);
  float cs = cos(uSunAng);
  float disc = smoothstep(cs - 0.00001, cs + 0.00004, sd) * (uAOn > 0.5 ? 26.0 : 55.0);
  float glow = pow(max(sd, 0.0), uAOn > 0.5 ? 700.0 : 1800.0) * 3.0 + pow(max(sd, 0.0), 160.0) * (uAOn > 0.5 ? 0.25 : 0.45) + pow(max(sd, 0.0), 12.0) * 0.05;
  if (uAOn > 0.5 && d.y < 0.0) { disc = 0.0; glow *= smoothstep(-0.08, 0.0, d.y); }
  col += sunTint * (disc + glow);
  }
  if (uEnv > 0.5) col = min(col, vec3(6.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky() {
  const u = {
    uSun: { value: new THREE.Vector3(1, 0.3, 0.2) }, uSunAng: { value: 0.0045 }, uTime: { value: 0 }, uEnv: { value: 0 }, uStar: { value: 1 }, uNoise: { value: noiseTexture() },
    uG: { value: new THREE.Vector3(0, 0, 1) }, uGR: { value: 0.15 }, uRingN: { value: new THREE.Vector3(0, 1, 0) }, uGOn: { value: 0 }, uHasRing: { value: 0 },
    uGA: { value: new THREE.Color(0.4, 0.2, 0.1) }, uGB: { value: new THREE.Color(0.8, 0.5, 0.25) }, uGC: { value: new THREE.Color(0.9, 0.8, 0.6) },
    uRing: { value: new THREE.Vector2(1.38, 2.35) }, uRingK: { value: 1 },
    uM: { value: new THREE.Vector3(0, 1, 0) }, uMR: { value: 0.015 }, uMOn: { value: 0 }, uGStyle: { value: 0 }, uStormA: { value: new THREE.Vector3(0.8, 0.74, 0.55) }, uStormB: { value: new THREE.Vector3(0.97, 0.94, 0.84) },
    uAtmo: { value: new THREE.Vector4(0, 0, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
  };
  Object.assign(u, atmU);
  const material = new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false, side: THREE.BackSide, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }`,
    fragmentShader: FRAG,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), material);
  mesh.frustumCulled = false; mesh.renderOrder = -1000;
  const col = (a) => new THREE.Color().setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
  return {
    mesh, material, u,
    setGiant(pal, hasRing) { u.uGStyle.value = pal.style || 0; if (pal.storm) { u.uStormA.value.set(...pal.storm[0]); u.uStormB.value.set(...pal.storm[1]); } u.uGA.value.copy(col(pal.c1)); u.uGB.value.copy(col(pal.c2)); u.uGC.value.copy(col(pal.c3)); u.uHasRing.value = hasRing ? 1 : 0; u.uRing.value.set(...(pal.ring || [1.38, 2.35])); u.uRingK.value = pal.ringK || 1; u.uGOn.value = 1; },
    clearGiant() { u.uGOn.value = 0; u.uMOn.value = 0; },
  };
}
