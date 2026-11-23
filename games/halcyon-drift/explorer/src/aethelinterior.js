// Aethel hollow world: everything that is not a terrain recipe or the skiff.
//
// GRAVITY / FRAME MODEL (cheap, documented): the interior is a sphere of radius RI = 36 km whose inner wall is the ground. Local physics is
// the ordinary flat-plane model (x east, y up, z south) with "down" = towards the nearest wall, i.e. gravity pulls OUTWARD from the inner
// sun at a constant g = 0.8 m/s2 (spin-gravity style, no gradient with altitude). "Up" is therefore always towards the inner sun and
// rotates with the player's position around the cavity, which the renderer reproduces by bending the terrain into a concave sphere around the
// camera in the vertex shader (gfx.js curv.ri) and by drawing the part of the sphere beyond the near terrain as a procedural far shell.
// The wall is charted azimuthal-equidistant from the gate: plane metres = arc length from the gate window, azimuth = plane bearing.
//
// Contents: pseudo-body for the interior world, sun / frame maths, the Interior renderer (far shell, gate shaft, inner sun, outer-space sky
// through the window, reflection probe), the exterior GateDisc (glowing hatch at the bottom of each gate funnel) and the transition mappings.
import * as THREE from 'three';
import { gfx, curv, setSun, setFill } from './gfx.js';
import { atmU, ATMO_PARS } from './atmo.js';
import { createSky } from './sky.js';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { terrainUniforms } from './terrain/terrain.js';
import * as EX from './terrain/aethel.js';
import * as IN from './terrain/aethelin.js';
import { buildSettlement, buildIslands, Shafts } from './aethelscene.js';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const RI = IN.RI, GATE_R = IN.GATE_R, G_INT = 0.8;
export { EX, IN };

/** pseudo-body for the interior world (not part of BODIES: the patched-conic system never sees it) */
export const BODY = {
  id: 'aethelin', name: 'Aethel interior', kind: 'cavity', interior: true, R: RI, g: G_INT, mu: G_INT * RI * RI, parkAlt: 0, recipe: 'aethelin', airless: false,
  site: { x: 0, z: 0 }, dayLength: 3000,
  atmosphere: { pressure: '0.6 atm', note: 'cavern air', color: [0.5, 0.85, 0.8], height: 0.014,
    scatter: { dens: 0.9, betaR: [3.2, 8.0, 20.0], mieK: 0.5, mieG: 0.6, mieCol: [1.0, 0.8, 0.5], hazeH: 6000, fogDist: 46000, sunI: 0.55, sunCol: [1.0, 0.95, 0.85] } },
};

// ---------------------------------------------------------------------------- frame + sun maths
const _A = new THREE.Matrix3(), _AT = new THREE.Matrix3();
/** rotation (scene <- sphere frame, with the gate on +Y_s) for a camera at plane position (px, pz) on the wall; returns {A, AT, psi, phi, s} */
export function frameAt(px, pz, out = { A: _A, AT: _AT, psi: 0, phi: 0, s: 0 }) {
  const s = Math.hypot(px, pz), psi = Math.min(s / RI, Math.PI - 0.02), phi = s > 1e-3 ? Math.atan2(pz, px) : 0;
  const cp = Math.cos(psi), sp = Math.sin(psi), cf = Math.cos(phi), sf = Math.sin(phi);
  const er = [cp * cf, -sp, cp * sf], ef = [-sf, 0, cf], u = [-sp * cf, -cp, -sp * sf];
  const r0 = [cf * er[0] - sf * ef[0], cf * er[1] - sf * ef[1], cf * er[2] - sf * ef[2]];
  const r2 = [sf * er[0] + cf * ef[0], sf * er[1] + cf * ef[1], sf * er[2] + cf * ef[2]];
  out.A.set(r0[0], r0[1], r0[2], u[0], u[1], u[2], r2[0], r2[1], r2[2]);
  out.AT.copy(out.A).transpose();
  out.psi = psi; out.phi = phi; out.s = s;
  return out;
}
const _fr = { A: _A, AT: _AT, psi: 0, phi: 0, s: 0 };
/** inner sun: hangs 0.42 RI towards the gate side of the centre and 0.52 RI off-axis, circling the axis once every 3000 s (a slow "day") */
export function sunSphere(t, out = new V3()) { const th = t * 0.0021 + 0.8; return out.set(0.52 * Math.cos(th), 0.42, 0.52 * Math.sin(th)).multiplyScalar(RI); }

// ---------------------------------------------------------------------------- palette hooks (barren-world look for the Aethel shell)
const _lookBackup = {};
export function applyLook(look) {
  const tu = terrainUniforms, keys = { dust: 'uDust', dustDark: 'uDustDark', rust: 'uRust', blue: 'uBlue', rock: 'uRock', rockLight: 'uRockLight' };
  tu.uStrataTint.value.set(...(look && look.strata ? look.strata : [1, 1, 1])); tu.uOutcK.value = look && look.outc !== undefined ? look.outc : 1;
  if (look && look.dust) {
    for (const k of Object.keys(keys)) { if (!_lookBackup[k]) _lookBackup[k] = tu[keys[k]].value.clone(); tu[keys[k]].value.setRGB(look[k][0], look[k][1], look[k][2], THREE.SRGBColorSpace); }
  } else for (const k of ['dust', 'dustDark', 'rust', 'blue']) if (_lookBackup[k]) { tu[keys[k]].value.copy(_lookBackup[k]); delete _lookBackup[k]; }
  if (!look || !look.dust) { delete _lookBackup.rock; delete _lookBackup.rockLight; }
}

// ---------------------------------------------------------------------------- shaders
const FSQ = `
uniform vec3 uCurvCam; uniform float uCurvK; uniform float uCurvRi;
vec4 curvWP(vec4 wp){ vec2 q = wp.xz - uCurvCam.xz; float d2 = dot(q, q);
  if (uCurvRi > 0.0) wp.y += uCurvRi - sqrt(uCurvRi * uCurvRi - min(d2, 0.9409 * uCurvRi * uCurvRi)); else wp.y -= d2 * uCurvK; return wp; }
`;
const FOGSH = `
  vec3 rayW = vP - cameraPosition; float dist = length(rayW); vec3 fdir = rayW / max(dist, 1e-3);
  float od = uAFogDens * dist;
  vec3 fogC = aInscatter(normalize(vec3(fdir.x, max(fdir.y, 0.0) * 0.5 + 0.03, fdir.z))) * 1.1;
  fogC = min(fogC / (1.0 + 0.5 * fogC) * 1.5, vec3(1.6));
  float T = exp(-od); col = col * T + fogC * (1.0 - T);
`;
const SHELL_FRAG = `
precision highp float;
varying vec3 vP;
uniform vec3 uCen; uniform mat3 uAT; uniform float uRi; uniform float uGateAng; uniform vec3 uSunPos; uniform float uSunE; uniform vec3 uHemi;
${NOISE_TEX_GLSL}
${ATMO_PARS}
float fb(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 3; k++){ s += a * vn2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s * 1.14; }
void main(){
  vec3 dirC = normalize(vP - uCen);
  vec3 ds = uAT * dirC;
  float psi = acos(clamp(ds.y, -1.0, 1.0));
  if (psi < uGateAng) discard;
  float phi = atan(ds.z, ds.x);
  vec2 pl = uRi * psi * vec2(cos(phi), sin(phi));
  float n0 = fb(pl / 14000.0 + 3.0), n1 = fb(pl / 6000.0), hi = fb(pl / 9000.0 + 9.0);
  float forest = smoothstep(0.40, 0.62, n0 + 0.25 * (n1 - 0.5)), high = smoothstep(0.56, 0.78, hi);
  vec3 alb = mix(mix(vec3(0.04, 0.17, 0.10), vec3(0.09, 0.25, 0.14), n1), vec3(0.025, 0.10, 0.07), forest);
  alb = mix(alb, vec3(0.07, 0.085, 0.12), 0.35 + 0.6 * high);
  vec3 N = -dirC, L = normalize(uSunPos - vP);
  vec3 col = alb * (uSunE * 0.9 * max(dot(N, L), 0.0) / 3.14159 + uHemi);
  ${FOGSH}
  gl_FragColor = vec4(col, 1.0);
}`;
const TUBE_VERT = `${FSQ}
varying vec3 vL; varying vec3 vP;
void main(){ vL = position; vec4 wp = curvWP(modelMatrix * vec4(position, 1.0)); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const TUBE_FRAG = `
precision highp float;
varying vec3 vL; varying vec3 vP;
uniform float uDepth; uniform float uTime;
${NOISE_TEX_GLSL}
void main(){
  float y = -vL.y;                                                        // metres below the wall plane
  float band = 0.5 + 0.5 * sin(y * 0.045 + 1.3 * vn2(vec2(atan(vL.z, vL.x) * 3.0, y / 500.0)));
  vec3 rock = mix(vec3(0.05, 0.08, 0.09), vec3(0.17, 0.27, 0.27), band) * (0.7 + 0.6 * vn2(vec2(atan(vL.z, vL.x) * 8.0, y / 60.0)));
  float lit = smoothstep(0.0, 700.0, uDepth - y) * 0.55 + 0.45;
  float glowK = smoothstep(uDepth * 0.55, uDepth, y);
  vec3 col = rock * (0.25 + 1.1 * glowK) + vec3(0.25, 0.85, 0.8) * glowK * glowK * 2.2 * (0.85 + 0.15 * sin(uTime * 0.5 + y * 0.01));
  gl_FragColor = vec4(col * lit, 1.0);
}`;
const DISC_VERT = `${FSQ}
varying vec2 vXZ;
void main(){ vXZ = position.xz; vec4 wp = curvWP(modelMatrix * vec4(position, 1.0)); gl_Position = projectionMatrix * viewMatrix * wp; }`;
const DISC_FRAG = `
precision highp float;
varying vec2 vXZ; uniform float uTime; uniform float uR;
${NOISE_TEX_GLSL}
void main(){
  float r = length(vXZ) / uR, a = atan(vXZ.y, vXZ.x);
  float sw = vn2(vec2(a * 2.2 + uTime * 0.12 + r * 3.0, r * 7.0 - uTime * 0.35)) * 0.6 + vn2(vec2(a * 5.0 - uTime * 0.2, r * 15.0 + uTime * 0.2)) * 0.4;
  float ring = smoothstep(0.82, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  vec3 c = mix(vec3(0.10, 0.70, 0.80), vec3(1.0, 0.95, 0.80), smoothstep(0.75, 0.0, r) * (0.7 + 0.3 * sw));
  c *= 0.55 + 0.6 * (1.0 - r) + 0.25 * sw; c += vec3(0.4, 1.0, 0.95) * ring * 1.1;
  gl_FragColor = vec4(c, 1.0);
}`;
const PILLAR_FRAG = `
precision highp float;
varying vec2 vUv; uniform float uTime; uniform vec3 uCol; ${NOISE_TEX_GLSL}
void main(){ float h = vUv.y; float a = pow(1.0 - h, 1.1) * (0.55 + 0.45 * vn2(vec2(vUv.x * 18.0 + uTime * 0.1, h * 5.0 - uTime * 0.6))) * 0.30;
  gl_FragColor = vec4(uCol * a, a); }`;

function radialTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}

// ---------------------------------------------------------------------------- the interior renderer
export class Interior {
  constructor() {
    this.group = new THREE.Group();
    const lcols = { uAT: { value: new THREE.Matrix3() }, uCen: { value: new V3() }, uRi: { value: RI }, uGateAng: { value: GATE_R / RI }, uSunPos: { value: new V3() }, uSunE: { value: 5 }, uHemi: { value: new V3(0.5, 0.6, 0.6) }, uNoise: { value: noiseTexture() } };
    this.shellU = Object.assign(lcols, atmU);
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({ uniforms: this.shellU, side: THREE.BackSide, vertexShader: 'varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }', fragmentShader: SHELL_FRAG }));
    this.shell.scale.setScalar(RI + 380); this.shell.frustumCulled = false;
    const cu = { uCurvCam: curv.cam, uCurvK: curv.k, uCurvRi: curv.ri };
    this.tubeU = Object.assign({ uDepth: { value: EX.GATE.depth }, uTime: { value: 0 }, uNoise: { value: noiseTexture() } }, cu);
    const tg = new THREE.CylinderGeometry(GATE_R, GATE_R, EX.GATE.depth, 72, 10, true); tg.translate(0, -EX.GATE.depth / 2, 0);
    this.tube = new THREE.Mesh(tg, new THREE.ShaderMaterial({ uniforms: this.tubeU, side: THREE.BackSide, vertexShader: TUBE_VERT, fragmentShader: TUBE_FRAG })); this.tube.frustumCulled = false;
    const tex = radialTex();
    const spr = (col, order) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false })); s.renderOrder = order; s.frustumCulled = false; return s; };
    this.sunCore = spr(new THREE.Color(26, 19, 9), 20); this.sunHalo = spr(new THREE.Color(0.9, 0.62, 0.32), 19);
    this.settle = buildSettlement(IN.SETTLEMENT.x, IN.SETTLEMENT.z, IN.heightAt);
    const B = IN.BASIN; this.islands = buildIslands([
      { x: 6200, z: 900, up: 950, R: 420, H: 700 }, { x: 9600, z: -1900, up: 1500, R: 650, H: 1100 }, { x: 10800, z: 4800, up: 1150, R: 330, H: 600 },
      { x: 7400, z: 5600, up: 2100, R: 520, H: 900 }, { x: 13200, z: 1700, up: 1700, R: 780, H: 1300 }, { x: 4800, z: -2500, up: 1300, R: 360, H: 650 }, { x: B.x - 200, z: B.z - 300, up: 1900, R: 470, H: 800 }], IN.heightAt);
    this.shafts = new Shafts(GATE_R, RI);
    this.sky = createSky(); this.sky.u.uAOn = { value: 0 }; this.sky.u.uGOn.value = 0; this.sky.u.uStar.value = 1; this.sky.u.uSunAng.value = 0.012;
    this.group.add(this.shell, this.tube, this.settle, this.islands, this.shafts.group, this.sunHalo, this.sunCore, this.sky.mesh);
    this.sunDir = new V3(0, 1, 0); this.sunPos = new V3(); this.active = false; this.env = null;
    this.col1 = new THREE.Color(1.0, 0.78, 0.5);
  }
  /** reflection probe (warm teal cavern light), built once */
  envMap() {
    if (this.env) return this.env;
    const sc = new THREE.Scene();
    const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); }',
      fragmentShader: 'varying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = mix(vec3(0.03, 0.045, 0.06), vec3(0.10, 0.17, 0.34), smoothstep(-0.35, 0.55, d.y)); c += vec3(9.0, 8.0, 5.5) * pow(max(dot(d, normalize(vec3(0.5, 0.75, 0.3))), 0.0), 220.0); gl_FragColor = vec4(c, 1.0); }' });
    sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), m));
    const pm = new THREE.PMREMGenerator(gfx.renderer); this.env = pm.fromScene(sc, 0.02).texture; pm.dispose();
    return this.env;
  }
  attach(scene, on) {
    if (on && this.group.parent !== scene) scene.add(this.group);
    if (!on && this.group.parent) this.group.parent.remove(this.group);
    this.active = on;
    terrainUniforms.uHoleR.value = on ? GATE_R : 0; curv.ri.value = on ? RI : 0;
  }
  /** per frame: cam = camera position (scene coords), origin = terrain origin; returns {sun} for the lighting consumers */
  update(cam, origin, time, hasHoleShaft = true) {
    const px = cam.x + origin.x, pz = cam.z + origin.z;
    const f = frameAt(px, pz, _fr);
    // sun: from the wall point under the camera to the inner sun, expressed in the local frame
    const Ps = new V3(Math.sin(f.psi) * Math.cos(f.phi), Math.cos(f.psi), Math.sin(f.psi) * Math.sin(f.phi)).multiplyScalar(RI);
    const Ss = sunSphere(time, new V3()), d = Ss.clone().sub(Ps), dist = d.length();
    this.sunDir.copy(d).divideScalar(dist).applyMatrix3(f.A);
    this.sunPos.set(cam.x, 0, cam.z).addScaledVector(this.sunDir, dist);
    // far shell + gate shaft + sun sprites
    const C = new V3(cam.x, RI, cam.z);
    this.shell.position.copy(C); this.shellU.uCen.value.copy(C); this.shellU.uAT.value.copy(f.AT); this.shellU.uSunPos.value.copy(this.sunPos);
    this.tube.position.set(-origin.x, 0, -origin.z); this.tubeU.uTime.value = time;
    terrainUniforms.uHoleC.value.set(-origin.x, -origin.z);
    this.sunCore.position.copy(this.sunPos); this.sunHalo.position.copy(this.sunPos);
    const r = dist * 0.0085; this.sunCore.scale.setScalar(r * 3.2); this.sunHalo.scale.setScalar(r * 15);
    this.settle.position.set(-origin.x, 0, -origin.z); this.islands.position.set(-origin.x, 0, -origin.z); this.shafts.update(f.A, Ps, new V3(cam.x, 0, cam.z), time);
    // outer sun + stars through the window (almost straight through the shaft)
    const od = new V3(0.04, 1, 0.03).normalize().applyMatrix3(f.A);
    this.sky.u.uSun.value.copy(od); this.sky.u.uTime.value = time;
    this.sky.mesh.position.copy(cam);
    return { sun: this.sunDir, dist };
  }
  /** light rig for the interior: warm-white inner sun, teal-green hemisphere bounce */
  lights(W) {
    setSun(this.sunDir, 5.0 * W.sunScale, this.col1);
    gfx.hemi.color.setRGB(W.hemi.sky[0], W.hemi.sky[1], W.hemi.sky[2]); gfx.hemi.groundColor.setRGB(W.hemi.ground[0], W.hemi.ground[1], W.hemi.ground[2]); gfx.hemi.intensity = W.hemi.intensity;
    setFill(new V3(0, 1, 0), 0.08, new THREE.Color(0.35, 0.55, 0.9));
    atmU.uAOn.value = 1; atmU.uASun.value.copy(this.sunDir);
    this.shellU.uSunE.value = 5.0 * W.sunScale; this.shellU.uHemi.value.set(W.hemi.sky[0] * 0.30 * W.hemi.intensity, W.hemi.sky[1] * 0.34 * W.hemi.intensity, W.hemi.sky[2] * 0.34 * W.hemi.intensity);
  }
}

// ---------------------------------------------------------------------------- exterior: the glowing hatch at the bottom of the nearest gate funnel
export class GateDisc {
  constructor() {
    this.group = new THREE.Group();
    const cu = { uCurvCam: curv.cam, uCurvK: curv.k, uCurvRi: curv.ri };
    this.u = Object.assign({ uTime: { value: 0 }, uR: { value: GATE_R }, uNoise: { value: noiseTexture() } }, cu);
    const dg = new THREE.CircleGeometry(GATE_R, 96); dg.rotateX(-Math.PI / 2);
    this.disc = new THREE.Mesh(dg, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 })); this.disc.frustumCulled = false;
    const H = 9000, pg = new THREE.CylinderGeometry(GATE_R * 0.6, GATE_R * 0.95, H, 48, 1, true); pg.translate(0, H / 2, 0);
    this.pu = { uTime: this.u.uTime, uCol: { value: new V3(1.6, 4.2, 4.0) }, uNoise: this.u.uNoise };
    this.pillar = new THREE.Mesh(pg, new THREE.ShaderMaterial({ uniforms: this.pu, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: `${FSQ} varying vec2 vUv; void main(){ vUv = uv; vec4 wp = curvWP(modelMatrix * vec4(position, 1.0)); gl_Position = projectionMatrix * viewMatrix * wp; }`, fragmentShader: PILLAR_FRAG }));
    this.pillar.frustumCulled = false; this.pillar.renderOrder = 4;
    this.group.add(this.disc, this.pillar); this.gate = { x: 0, z: 0, d: 1e9 };
  }
  /** cam = camera (scene coords); sets the terrain hole under the hatch; returns the nearest gate (absolute plane coords) */
  update(cam, origin, time) {
    const g = EX.nearestGate(cam.x + origin.x, cam.z + origin.z, this.gate);
    const on = g.d < 150000;
    this.group.visible = on; this.u.uTime.value = time;
    if (on) { this.group.position.set(g.x - origin.x, EX.FLOOR + 0.6, g.z - origin.z); terrainUniforms.uHoleC.value.set(g.x - origin.x, g.z - origin.z); terrainUniforms.uHoleR.value = GATE_R * 0.994; }      // terrain hole a hair smaller than the hatch: no gap, a thin overlap
    else terrainUniforms.uHoleR.value = 0;
    return g;
  }
  off() { this.group.visible = false; terrainUniforms.uHoleR.value = 0; }
}

// ---------------------------------------------------------------------------- transitions (absolute plane coordinates; the interior's terrain origin is (0, 0))
/** exterior skiff state (scene-local p, v, yaw; terrain origin) -> interior state. The exterior hatch normal is down, the interior's is up (towards the sun). */
export function enterState(p, v, yaw, origin) {
  const g = EX.nearestGate(p.x + origin.x, p.z + origin.z, { x: 0, z: 0, d: 0 });
  return { gate: { x: g.x, z: g.z }, p: new V3(p.x + origin.x - g.x, 90, -(p.z + origin.z - g.z)), v: new V3(v.x, Math.max(-v.y, 30), -v.z), yaw: Math.PI - yaw };
}
/** interior skiff state -> exterior state above the hatch of `gate` (scene-local coordinates for the given terrain origin) */
export function exitState(p, v, yaw, gate, origin) {
  return { p: new V3(gate.x + p.x - origin.x, EX.FLOOR + 90, gate.z - p.z - origin.z), v: new V3(v.x, Math.max(-v.y, 30), -v.z), yaw: Math.PI - yaw };
}
/** true while a point (scene-local, exterior) is over the hatch */
export function overHatch(p, origin, margin = 100) { return EX.nearestGate(p.x + origin.x, p.z + origin.z, { x: 0, z: 0, d: 0 }).d < GATE_R - margin; }
