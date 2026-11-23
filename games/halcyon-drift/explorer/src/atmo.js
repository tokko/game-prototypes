// Atmosphere model shared by the sky dome, the aerial-perspective / valley-mist fog injected into every lit material,
// and the CPU side (sun colour, ambient light). Single-scattering Rayleigh + Henyey-Greenstein Mie with an analytic airmass,
// driven by the destination's atmosphere.scatter data (dens, betaR, mieK, mieG, mieCol, sunI, sunCol) plus the per-world recipe fog.
// With uAOn = 0 (Kestrel, orbit) everything below is inert.
import * as THREE from 'three';
import { noiseTexture } from './noisetex.js';

/** shared uniform objects (same references used by the sky ShaderMaterial and by the fog hook on every lit material) */
export const atmU = {
  uAOn: { value: 0 }, uASun: { value: new THREE.Vector3(0, 1, 0) }, uABeta: { value: new THREE.Vector3(5.8, 13.5, 33.1) }, uADens: { value: 1 },
  uAMieK: { value: 0.5 }, uAMieG: { value: 0.76 }, uAMieCol: { value: new THREE.Vector3(1, 0.82, 0.55) }, uASunI: { value: 3.5 },
  uAFogDens: { value: 0 }, uAFogFall: { value: 1 / 5000 }, uAMistY: { value: 0 }, uAMistDens: { value: 0 }, uAMistFall: { value: 1 / 40 }, uAMistCol: { value: new THREE.Vector3(0.9, 0.85, 0.75) },
  uAAmb: { value: new THREE.Vector3(0.012, 0.016, 0.03) },
  uATint: { value: new THREE.Vector3(1, 1, 1) },      // per-world colour cast on sky / haze / sun (Pyra's orange ash atmosphere)
  uMistN: { value: noiseTexture() }, uATime: { value: 0 },
};

export const ATMO_PARS = `
uniform float uAOn; uniform vec3 uASun; uniform vec3 uABeta; uniform float uADens; uniform float uAMieK; uniform float uAMieG; uniform vec3 uAMieCol; uniform float uASunI;
uniform sampler2D uMistN; uniform float uATime; uniform float uAFogDens; uniform float uAFogFall; uniform float uAMistY; uniform float uAMistDens; uniform float uAMistFall; uniform vec3 uAMistCol; uniform vec3 uAAmb; uniform vec3 uATint;
float mistN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = texture2D(uMistN, (i + 0.5) / 256.0).r, b = texture2D(uMistN, (i + vec2(1.5, 0.5)) / 256.0).r, c = texture2D(uMistN, (i + vec2(0.5, 1.5)) / 256.0).r, d = texture2D(uMistN, (i + 1.5) / 256.0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float aMass(float h){ h = max(h, 0.0); return 1.0 / (h + 0.045 + 0.05 * exp(-14.0 * h)); }
vec3 aTau(float am){ return uABeta * (0.012 * uADens) * am; }
vec3 aSunDirect(){ return exp(-aTau(aMass(uASun.y))); }
vec3 aSunScatter(){ return exp(-aTau(aMass(uASun.y)) * 0.35); }
vec3 aTrans(vec3 d){ return exp(-aTau(aMass(d.y))); }
// radiance scattered towards the viewer along unit direction d (world up = +Y)
vec3 aInscatter(vec3 d){
  float h = max(d.y, 0.0), am = aMass(h);
  float mu = dot(d, uASun);
  vec3 ray = (vec3(1.0) - exp(-aTau(am))) * (0.75 * (1.0 + mu * mu)) * 0.3;
  float g = uAMieG, g2 = g * g;
  float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 0.02), 1.5) * 0.0796;
  vec3 mie = uAMieCol * hg * (1.0 - exp(-am * uAMieK * 0.22));
  float day = smoothstep(-0.18, 0.12, uASun.y);
  return (uASunI * (aSunScatter() * ray + aSunDirect() * mie) * day + uAAmb * (1.0 - 0.6 * day)) * uATint;
}
`;

/** fragment snippet appended after <fog_fragment>: aerial perspective + valley mist, in scene space */
export const FOG_FRAG = `
if (uAOn > 0.5) {
  vec3 rayW = transpose(mat3(viewMatrix)) * (-vViewPosition);
  float dist = length(rayW); vec3 dir = rayW / max(dist, 1e-3);
  float y0 = cameraPosition.y, dy = rayW.y, k = uAFogFall;
  float ex = (abs(k * dy) < 1e-3) ? 1.0 : (1.0 - exp(-k * dy)) / (k * dy);
  float od = uAFogDens * dist * exp(-k * y0) * ex;
  float km = uAMistFall, dm = dy;
  float mh0 = max(y0 - uAMistY, 0.0), mh1 = max(y0 + dm - uAMistY, 0.0);           // mist heights of eye and fragment above the mist base (clamped: no exp() overflow when looking down from altitude)
  float me0 = exp(-km * mh0), me1 = exp(-km * mh1);                              // both <= 1: mean density along the ray = (me0 - me1) / (km * dh)
  float exm = (abs(km * (mh1 - mh0)) < 1e-3) ? me0 : (me0 - me1) / (km * (mh1 - mh0));
  vec3 fwp = cameraPosition + rayW;
  vec2 mq = fwp.xz + vec2(uATime * 2.2, uATime * 1.1);
  float mn = mistN(mq / 1500.0) * 0.55 + mistN(mq / 430.0 + 37.7) * 0.45;      // bilinear (the noise texture is nearest-filtered: sampled raw it speckles)
  float mmod = (0.08 + 1.9 * smoothstep(0.35, 0.78, mn)) * clamp(1.25 - 2.6 * uASun.y, 0.18, 1.0);      // patchy banks that thin as the sun climbs
  float odm = uAMistDens * mmod * dist * exm;
  vec3 fogC = aInscatter(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.5 + 0.03, dir.z))) * 1.1;
  fogC = min(fogC / (1.0 + 0.5 * fogC) * 1.5, vec3(1.6));            // soft knee: the sun-side glow stays warm instead of clipping to white
  float T = exp(-od), Tm = exp(-odm);
  gl_FragColor.rgb = gl_FragColor.rgb * T + fogC * (1.0 - T);
  vec3 mistC = mix(fogC * 0.85, uAMistCol * length(fogC) * 0.55, 0.45);
  gl_FragColor.rgb = gl_FragColor.rgb * Tm + mistC * (1.0 - Tm);
}
`;

// ------------------------------------------------------------------ CPU port of the same formulas
const _v = new THREE.Vector3();
const am = (h) => { h = Math.max(h, 0); return 1 / (h + 0.045 + 0.05 * Math.exp(-14 * h)); };
export function params() {
  return { tint: atmU.uATint.value, beta: atmU.uABeta.value, dens: atmU.uADens.value, mieK: atmU.uAMieK.value, mieG: atmU.uAMieG.value, mieCol: atmU.uAMieCol.value, sunI: atmU.uASunI.value, amb: atmU.uAAmb.value };
}
export function sunDirect(sunY, out = new THREE.Color()) {
  const P = params(), a = am(sunY);
  return out.setRGB(Math.exp(-P.beta.x * 0.012 * P.dens * a) * P.tint.x, Math.exp(-P.beta.y * 0.012 * P.dens * a) * P.tint.y, Math.exp(-P.beta.z * 0.012 * P.dens * a) * P.tint.z);
}
/** scattered sky radiance (linear rgb) toward direction d (x,y,z), sun unit vector s */
export function inscatter(d, s, out = new THREE.Color()) {
  const P = params(), h = Math.max(d.y, 0), a = am(h), as = am(s.y);
  const mu = d.x * s.x + d.y * s.y + d.z * s.z;
  const g = P.mieG, g2 = g * g, hg = (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * mu, 0.02), 1.5) * 0.0796;
  const mieT = 1 - Math.exp(-a * P.mieK * 0.22);
  const day = Math.min(1, Math.max(0, (s.y + 0.18) / 0.30)); const dd = day * day * (3 - 2 * day);
  const c = [P.beta.x, P.beta.y, P.beta.z], m = [P.mieCol.x, P.mieCol.y, P.mieCol.z], amb = [P.amb.x, P.amb.y, P.amb.z], r = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tau = c[i] * 0.012 * P.dens;
    const ray = (1 - Math.exp(-tau * a)) * (0.75 * (1 + mu * mu)) * 0.3;
    const sunS = Math.exp(-tau * as * 0.35), sunD = Math.exp(-tau * as);
    r[i] = P.sunI * (sunS * ray + sunD * m[i] * hg * mieT) * dd + amb[i] * (1 - 0.6 * dd);
  }
  return out.setRGB(r[0] * P.tint.x, r[1] * P.tint.y, r[2] * P.tint.z);
}
export function setAtmosphere(scatter, fog, on = true) {
  atmU.uAOn.value = on ? 1 : 0;
  if (!scatter) return;
  atmU.uABeta.value.set(...scatter.betaR); atmU.uADens.value = scatter.dens; atmU.uAMieK.value = scatter.mieK; atmU.uAMieG.value = scatter.mieG;
  atmU.uAMieCol.value.set(...scatter.mieCol); atmU.uASunI.value = scatter.sunI; atmU.uATint.value.set(...(scatter.tint || [1, 1, 1]));
  atmU.uAAmb.value.set(...(scatter.amb || [0.012, 0.016, 0.03]));      // night-sky floor colour (Nyth: deep blue)
  if (fog) {
    atmU.uAFogDens.value = 1 / fog.dist; atmU.uAFogFall.value = 1 / fog.fall;
    atmU.uAMistY.value = fog.mistY; atmU.uAMistDens.value = fog.mistDens; atmU.uAMistFall.value = 1 / fog.mistFall; atmU.uAMistCol.value.set(...fog.mistCol);
  }
}
export function clearAtmosphere() { atmU.uAOn.value = 0; atmU.uAFogDens.value = 0; atmU.uAMistDens.value = 0; }
