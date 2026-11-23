// Visual effects: pooled dust / spark particles (premultiplied soft sprites), engine plumes, POI beacons.
import * as THREE from 'three';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';

export class Particles {
  constructor(max = 6000) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.grow = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.alpha = new Float32Array(max); this.glow = new Float32Array(max);
    this.aPos = new Float32Array(max * 3); this.aSize = new Float32Array(max); this.aCol = new Float32Array(max * 4); this.aGlow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.BufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('glow', new THREE.BufferAttribute(this.aGlow, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uScale = { value: 800 }; this.light = { value: new THREE.Color(1, 1, 1) };
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, fog: false,
      uniforms: { uScale: this.uScale, uLight: this.light, uNear: { value: 0 } },
      vertexShader: `attribute float size; attribute vec4 col; attribute float glow; varying vec4 vC; varying float vG; uniform float uScale; uniform float uNear;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uScale / max(-mv.z, 0.1), 1.0, 220.0); vC = col; if (uNear > 0.0) vC.a *= smoothstep(uNear * 0.45, uNear, -mv.z); vG = glow; }`,
      fragmentShader: `varying vec4 vC; varying float vG; uniform vec3 uLight;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; float a = pow(1.0 - d, 1.6) * vC.a;
          vec3 c = mix(vC.rgb * uLight, vC.rgb * 2.2, vG); gl_FragColor = vec4(c * a, a * (1.0 - vG)); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.geo = g;
  }
  emit(x, y, z, vx, vy, vz, size, grow, life, r, g, b, a = 0.8, glow = 0) {
    if (this.iceTint && glow === 0 && r > b + 0.05) { const l = (r + g + b) / 3 * 1.9; r = l * 0.9; g = l * 0.98; b = l * 1.1; size *= 0.3; grow *= 0.45; a *= 0.8; }      // dust-coloured sprites become snow on Glaciera
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max; this.n = Math.min(this.max, this.n + 1);
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b; this.alpha[i] = a; this.glow[i] = glow;
  }
  update(dt, grav, groundFn) {
    for (let i = 0; i < this.max; i++) {
      let l = this.life[i];
      if (l <= 0) { this.aSize[i] = 0; this.aCol[i * 4 + 3] = 0; continue; }
      l -= dt; this.life[i] = l;
      const k = i * 3;
      this.vel[k + 1] -= grav * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (groundFn && this.pos[k + 1] < 40) { const gh = groundFn(this.pos[k], this.pos[k + 2]); if (this.pos[k + 1] < gh + 0.05) { this.pos[k + 1] = gh + 0.05; this.vel[k + 1] *= -0.15; this.vel[k] *= 0.6; this.vel[k + 2] *= 0.6; } }
      const u = 1 - l / this.maxLife[i];
      this.aPos[k] = this.pos[k]; this.aPos[k + 1] = this.pos[k + 1]; this.aPos[k + 2] = this.pos[k + 2];
      this.aSize[i] = this.size[i] + this.grow[i] * u;
      this.aCol[i * 4] = this.col[k]; this.aCol[i * 4 + 1] = this.col[k + 1]; this.aCol[i * 4 + 2] = this.col[k + 2];
      this.aCol[i * 4 + 3] = this.alpha[i] * Math.min(1, u * 8) * (1 - u) * (1 - u * 0.2);
      this.aGlow[i] = this.glow[i];
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.size.needsUpdate = true; this.geo.attributes.col.needsUpdate = true; this.geo.attributes.glow.needsUpdate = true;
  }
}

const COLORS = { chem: [1.0, 0.62, 0.28], rocket: [1.0, 0.66, 0.3], nuclear: [0.78, 0.62, 1.0], ntr: [0.9, 0.55, 1.0], jet: [0.55, 0.75, 1.0] };
/** engine plume: additive tapered cone along -Y from the nozzle exit; scale.y = length */
export function createPlume(radius = 0.9, kind = 'chem') {
  const geo = new THREE.CylinderGeometry(radius * 0.45, radius * 1.7, 1, 24, 6, true); geo.translate(0, -0.5, 0);
  const u = { uK: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(...(COLORS[kind] || COLORS.chem)) }, uNoise: { value: noiseTexture() } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; varying vec3 vP; uniform float uK; uniform float uTime; uniform vec3 uCol; ${NOISE_TEX_GLSL}
      void main(){ float y = 1.0 - vUv.y; float ang = atan(vP.z, vP.x);
        float n = vnoise(vec3(ang * 1.5, y * 6.0 - uTime * 9.0, 1.0)) * 0.6 + vnoise(vec3(ang * 3.0, y * 14.0 - uTime * 17.0, 4.0)) * 0.4;
        float core = exp(-y * 3.2) * (0.8 + 0.5 * n); float edge = 0.5 + 0.5 * n;
        float a = core * (1.0 - smoothstep(0.55, 1.0, y)) * uK;
        vec3 c = mix(uCol, vec3(1.0, 0.95, 0.9), exp(-y * 6.0)) * (2.5 + 5.0 * exp(-y * 4.0));
        gl_FragColor = vec4(c * a * edge, a * 0.0 + a); }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 6;
  m.userData.set = (throttle, length, t) => { u.uK.value = throttle; u.uTime.value = t; m.scale.set(1, Math.max(0.01, length * (0.3 + 0.7 * throttle)), 1); m.visible = throttle > 0.01; };
  m.userData.setKind = (k) => u.uCol.value.setRGB(...(COLORS[k] || COLORS.chem));
  return m;
}

/** faint vertical light shaft for points of interest */
export function createBeacon(color = 0xffc070, height = 120) {
  const geo = new THREE.CylinderGeometry(0.5, 1.1, height, 12, 1, true); geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(color) }, uK: { value: 1 }, uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform vec3 uCol; uniform float uK; uniform float uTime; void main(){ float a = pow(1.0 - vUv.y, 1.5) * (0.7 + 0.3 * sin(vUv.y * 25.0 - uTime * 2.0)) * 0.16 * uK; gl_FragColor = vec4(uCol * 1.6 * a, a); }',
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 4; return m;
}

/** Reentry plasma: an additive shock shell hugging the leading surfaces with a stretched wake. Parent it to a vessel's model group. */
export function createPlasma(size = 6) {
  const geo = new THREE.SphereGeometry(1, 40, 24);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
    uniforms: { uDir: { value: new THREE.Vector3(0, 0, 1) }, uI: { value: 0 }, uT: { value: 0 }, uSize: { value: size } },
    vertexShader: `uniform vec3 uDir; uniform float uI; uniform float uSize; uniform float uT; varying vec3 vN; varying float vLead; varying vec3 vP; varying vec3 vV;
      void main(){ vec3 n = normalize(position); float lead = dot(n, uDir); vec3 p = position * uSize;
        float flick = 1.0 + 0.04 * sin(uT * 31.0 + position.x * 9.0 + position.y * 7.0);
        p *= (lead > 0.0 ? 1.0 + 0.12 * lead : 1.0) * flick;
        p += uDir * min(lead, 0.0) * uSize * (1.2 + 2.6 * uI);          // trailing wake: stretch back along the flow
        vN = normalize(normalMatrix * n); vLead = lead; vP = n;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; uniform float uT; varying vec3 vN; varying float vLead; varying vec3 vP; varying vec3 vV;
      void main(){ float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float mask = smoothstep(-0.35, 0.9, vLead);
        float streak = 0.65 + 0.35 * sin(vP.x * 23.0 + vP.y * 17.0 - uT * 40.0 + sin(vP.z * 9.0 + uT * 6.0) * 2.0);
        float tail = smoothstep(-1.0, 0.0, vLead) * 0.5;
        float a = (mask * (0.30 + 0.9 * fres) * streak + tail * fres) * uI;
        vec3 hot = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.82, 0.62), smoothstep(0.35, 1.0, uI * mask));
        hot = mix(hot, vec3(0.75, 0.62, 1.0), smoothstep(0.85, 1.0, uI) * (1.0 - mask) * 0.6);
        gl_FragColor = vec4(hot * a * 5.0, a); }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 6; m.visible = false; m.userData.mat = mat;
  return m;
}
