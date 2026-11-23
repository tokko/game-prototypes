import * as THREE from 'three';
import { rnd, rr } from './util.js?v=32';

const PVERT = `
attribute vec4 aColor; attribute float aSize;
uniform float uScale; uniform float uFogD;
varying vec4 vColor; varying float vFog;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  gl_PointSize = min(aSize * uScale / d, 520.0);
  vFog = 1.0 - exp(-uFogD * uFogD * d * d);
  vColor = aColor; vColor.a *= smoothstep(3.0, 20.0, d);
}`;
// Smoke and dust go through the cockpit's augmented-vision filter: thinned overall, cleared in a bubble around the
// camera and the walker, and cleared again in a cone about the view axis so the line of sight to the crosshair stays open.
const PVERT_SMOKE = `
attribute vec4 aColor; attribute float aSize;
uniform float uScale; uniform float uFogD;
varying vec4 vColor; varying float vFog;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  gl_PointSize = min(aSize * uScale / d, 520.0);
  vFog = 1.0 - exp(-uFogD * uFogD * d * d);
  float bubble = smoothstep(22.0, 85.0, d);
  float cone = mix(0.16, 1.0, smoothstep(0.04, 0.3, length(mv.xy) / d));
  vColor = aColor; vColor.a *= 0.62 * bubble * cone;
}`;
const PFRAG_ADD = `
varying vec4 vColor; varying float vFog;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r); a *= a;
  gl_FragColor = vec4(vColor.rgb * (1.0 - vFog * 0.85), a * vColor.a);
}`;
const PFRAG_SMOKE = `
uniform vec3 uFogC;
varying vec4 vColor; varying float vFog;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float a = smoothstep(1.0, 0.35, r);
  // lumpy edge + underlit shading so puffs read as volume, not discs
  float lump = sin(p.x * 19.0 + vColor.r * 40.0) * sin(p.y * 17.0 + vColor.g * 50.0);
  a *= 0.85 + 0.15 * lump;
  vec3 c = vColor.rgb * (0.75 + 0.5 * (gl_PointCoord.y)) + vec3(0.10, 0.035, 0.0) * gl_PointCoord.y * vColor.a;
  gl_FragColor = vec4(mix(c, uFogC, vFog), a * vColor.a);
}`;

class Parts {
  constructor(max, additive, fogC, fogD) {
    this.max = max; this.head = 0; this.additive = additive;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uFogD: { value: fogD }, uFogC: { value: fogC } },
      vertexShader: additive ? PVERT : PVERT_SMOKE, fragmentShader: additive ? PFRAG_ADD : PFRAG_SMOKE,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 0, grav = 0) {
    const i = this.head; this.head = (i + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = 0;
    this.drag[i] = drag; this.grav[i] = grav; this.size[i] = s0;
  }
  update(dt) {
    const { pos, vel, life, maxLife, s0, s1, a0, col, size, drag, grav, max, additive } = this;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
      const t = 1 - life[i] / maxLife[i], i3 = i * 3;
      const k = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k - grav[i] * dt; vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.1 && grav[i] > 0) { pos[i3 + 1] = 0.1; vel[i3 + 1] *= -0.35; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      size[i] = s0[i] + (s1[i] - s0[i]) * (additive ? t : Math.sqrt(t));
      col[i * 4 + 3] = a0[i] * (additive ? (1 - t) * (1 - t) : (t < 0.08 ? t / 0.08 : (1 - t) / 0.92));
    }
    const at = this.points.geometry.attributes;
    at.position.needsUpdate = true; at.aColor.needsUpdate = true; at.aSize.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3(), _e = new THREE.Euler(), _col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Fx {
  constructor(G) {
    this.G = G; const scene = G.scene;
    this.smokeP = new Parts(5000, false, G.fogColor, G.fogDensity);
    this.fireP = new Parts(5000, true, G.fogColor, G.fogDensity);
    scene.add(this.smokeP.points, this.fireP.points);

    // tracers
    const TM = this.TM = 1600;
    this.trMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true }), TM);
    this.trMesh.frustumCulled = false; this.trMesh.renderOrder = 12;
    this.tr = []; this.trFree = [];
    for (let i = 0; i < TM; i++) { this.trMesh.setMatrixAt(i, ZERO); this.trMesh.setColorAt(i, _col.setRGB(1, 1, 1)); this.trFree.push(i); }
    scene.add(this.trMesh);

    // beams
    this.beams = [];
    const bg = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.5);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, transparent: true, side: THREE.DoubleSide }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 12; scene.add(m);
      this.beams.push({ m, life: 0, dur: 1, w: 1 });
    }

    // flash lights
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 200, 1.8); scene.add(l);
      this.lights.push({ l, life: 0, dur: 1, i0: 0 });
    }

    // scorch decals
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const pg = new THREE.PlaneGeometry(2, 2); pg.rotateX(-Math.PI / 2);
    this.DM = 300; this.dHead = 0;
    this.decals = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.DM);
    for (let i = 0; i < this.DM; i++) this.decals.setMatrixAt(i, ZERO);
    this.decals.frustumCulled = false; this.decals.renderOrder = 1; scene.add(this.decals);

    // debris chunks
    this.DB = 320; this.dbHead = 0;
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), this.DB);
    this.debrisMesh.frustumCulled = false;
    this.db = [];
    for (let i = 0; i < this.DB; i++) {
      this.debrisMesh.setMatrixAt(i, ZERO); this.debrisMesh.setColorAt(i, _col.setRGB(0.1, 0.1, 0.1));
      this.db.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, sx: 1, sy: 1, sz: 1 });
    }
    scene.add(this.debrisMesh);

    this.emitters = [];

    // Flame sprites: a per-frame list of points shaded with scrolling noise and a heat ramp
    // (yellow-white -> orange -> deep red -> black smoke). Alpha blended so stacked fire cannot white out.
    const FM = this.FM = 700; this.fN = 0;
    this.fPos = new Float32Array(FM * 3); this.fDat = new Float32Array(FM * 3);   // size, age(0 hot..1 spent), seed
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(this.fPos, 3).setUsage(THREE.DynamicDrawUsage));
    fgeo.setAttribute('aDat', new THREE.BufferAttribute(this.fDat, 3).setUsage(THREE.DynamicDrawUsage));
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uT: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 aDat; uniform float uScale; varying float vAge; varying float vSeed; varying float vNear;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = max(-mv.z, 1.0);
          gl_PointSize = min(aDat.x * uScale / d, 280.0); vAge = aDat.y; vSeed = aDat.z; vNear = smoothstep(4.0, 22.0, d); }`,
      fragmentShader: `uniform float uT; varying float vAge; varying float vSeed; varying float vNear;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ return 0.62 * n2(p) + 0.38 * n2(p * 2.3 + 7.0); }
        void main(){
          vec2 p = gl_PointCoord - 0.5; p.y = -p.y; float r = length(p) * 2.0;
          vec2 q = p * (2.2 + vAge * 2.0) + vec2(vSeed * 13.0, vSeed * 7.0 - uT * (2.6 - vAge));     // fire texture scrolls upward
          float n = fbm(q), n1 = fbm(q * 2.3 + 11.0);
          float edge = r + (n - 0.5) * (0.5 + 0.9 * vAge);                                           // ragged, more so as it frays
          float shape = smoothstep(1.0, 0.45, edge);
          float heat = clamp((1.0 - vAge * 0.9) * (0.5 + 0.9 * n1) * (1.2 - r * 0.7) + (0.3 - vAge) * 0.9, 0.0, 1.0);
          heat *= smoothstep(-0.55, 0.15, p.y + (n - 0.5) * 0.5) * 0.35 + 0.65;                      // cooler, sootier top
          vec3 soot = vec3(0.022, 0.016, 0.014), red = vec3(0.62, 0.075, 0.012), org = vec3(1.5, 0.5, 0.06), hot = vec3(1.9, 1.5, 0.7);
          vec3 c = heat < 0.3 ? mix(soot, red, heat / 0.3) : heat < 0.65 ? mix(red, org, (heat - 0.3) / 0.35) : mix(org, hot, (heat - 0.65) / 0.35);
          float a = shape * mix(0.92, 0.6, vAge) * (0.55 + 0.45 * smoothstep(0.05, 0.4, heat) + 0.25 * vAge) * vNear;
          if (a < 0.01) discard;
          gl_FragColor = vec4(c, min(a, 0.95));
        }` });
    this.flamePts = new THREE.Points(fgeo, this.flameMat); this.flamePts.frustumCulled = false; this.flamePts.renderOrder = 11; fgeo.setDrawRange(0, 0);
    scene.add(this.flamePts);
  }

  setScale(px) { this.smokeP.mat.uniforms.uScale.value = px; this.fireP.mat.uniforms.uScale.value = px; this.flameMat.uniforms.uScale.value = px; }
  // queue one flame sprite for this frame. age: 0 = white-hot liquid, 1 = spent, sooty
  flame(x, y, z, size, age, seed) { const i = this.fN; if (i >= this.FM) return; this.fN = i + 1; const o = i * 3; this.fPos[o] = x; this.fPos[o + 1] = y; this.fPos[o + 2] = z; this.fDat[o] = size; this.fDat[o + 1] = age; this.fDat[o + 2] = seed; }
  smoke(x, y, z, vx, vy, vz, life, s0, s1, c, a, drag = 0.4, grav = 0) { this.smokeP.spawn(x, y, z, vx, vy, vz, life * 0.72, s0, s1, c, c * 0.92, c * 0.85, a, drag, grav); }   // shorter-lived: less build-up over a fight
  fire(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1, drag = 0.5, grav = 0) { this.fireP.spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, grav); }
  camDist(x, y, z) { const c = this.G.camera.position; return Math.hypot(x - c.x, y - c.y, z - c.z); }

  tracer(ax, ay, az, bx, by, bz, speed, len, w, r, g, b, cb) {
    let i = this.trFree.pop();
    if (i === undefined) { if (cb) cb(); return; }
    const dx = bx - ax, dy = by - ay, dz = bz - az, dist = Math.hypot(dx, dy, dz) || 0.01;
    _d.set(dx / dist, dy / dist, dz / dist); _q.setFromUnitVectors(_z, _d);
    this.tr.push({ i, ax, ay, az, dx: _d.x, dy: _d.y, dz: _d.z, dist, t: 0, speed, len, w, cb, qx: _q.x, qy: _q.y, qz: _q.z, qw: _q.w });
    this.trMesh.setColorAt(i, _col.setRGB(r, g, b));
    this.trMesh.instanceColor.needsUpdate = true;
  }
  beam(a, b, w, r, g, bl, dur) {
    let best = this.beams[0]; for (const bm of this.beams) if (bm.life < best.life) best = bm;
    best.life = dur; best.dur = dur; best.w = w;
    best.m.position.copy(a); best.m.lookAt(b); best.len = a.distanceTo(b);
    best.m.material.color.setRGB(r, g, bl); best.m.visible = true;
  }
  flash(x, y, z, r, g, b, intensity, dur, dist) {
    intensity = Math.min(3200, intensity * 0.35);
    let best = this.lights[0]; for (const L of this.lights) if (L.life / L.dur * L.i0 < best.life / best.dur * best.i0) best = L;
    if (best.life > 0 && best.life / best.dur * best.i0 > intensity) return;
    best.l.position.set(x, y, z); best.l.color.setRGB(r, g, b); best.l.distance = dist;
    best.life = dur; best.dur = dur; best.i0 = intensity; best.l.intensity = intensity;
  
  }
  decal(x, z, r) {
    const i = this.dHead; this.dHead = (i + 1) % this.DM;
    _m.makeRotationY(rnd() * 6.28); _m.scale(_s.set(r, 1, r * rr(0.7, 1.2))); _m.setPosition(x, 0.05 + i * 0.0004, z);
    this.decals.setMatrixAt(i, _m); this.decals.instanceMatrix.needsUpdate = true;
  }
  debris(x, y, z, n, size, speed, shade = 0.1, up = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.dbHead; this.dbHead = (i + 1) % this.DB; const d = this.db[i];
      const a = rnd() * 6.28, sp = speed * rr(0.3, 1);
      d.x = x + rr(-1, 1) * size; d.y = y + rr(0, 1) * size; d.z = z + rr(-1, 1) * size;
      d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = speed * rr(0.3, 1.1) * up;
      d.rx = rnd() * 6; d.ry = rnd() * 6; d.rz = rnd() * 6; d.wx = rr(-5, 5); d.wy = rr(-5, 5); d.wz = rr(-5, 5);
      d.sx = size * rr(0.4, 1.3); d.sy = size * rr(0.3, 0.9); d.sz = size * rr(0.4, 1.3); d.life = rr(4, 9);
      const s = shade * rr(0.6, 1.3); this.debrisMesh.setColorAt(i, _col.setRGB(s * 1.1, s, s * 0.9));
    }
    this.debrisMesh.instanceColor.needsUpdate = true;
  }
  sparks(x, y, z, n, speed, r = 3, g = 1.6, b = 0.4, life = 0.7) {
    for (let i = 0; i < n; i++) this.fire(x, y, z, rr(-1, 1) * speed, rr(0.1, 1.2) * speed, rr(-1, 1) * speed, rr(0.3, 1) * life, rr(0.5, 1.1), 0.2, r, g, b, 1, 0.6, 22);
  }
  dust(x, y, z, s, n = 6, c = 0.16, a = 0.5) {
    for (let i = 0; i < n; i++) {
      const an = rnd() * 6.28, sp = rr(2, 9) * s;
      this.smoke(x + Math.cos(an) * s, y + rr(0, 1) * s, z + Math.sin(an) * s, Math.cos(an) * sp, rr(0.5, 3) * s, Math.sin(an) * sp, rr(1.6, 4), 3 * s, 11 * s, c * rr(0.8, 1.2), a, 1.2);
    }
  }
  muzzle(p, d, s, r, g, b) {
    this.fire(p.x, p.y, p.z, d.x * 20, d.y * 20, d.z * 20, 0.06, 5 * s, 9 * s, r, g, b, 1);
    this.fire(p.x + d.x * 2 * s, p.y + d.y * 2 * s, p.z + d.z * 2 * s, d.x * 40, d.y * 40, d.z * 40, 0.07, 3 * s, 5 * s, r, g, b, 1);
  }
  impact(x, y, z, s) { // cheap hit: sparks + puff
    const far = this.camDist(x, y, z) > 450;
    this.fire(x, y + 0.5, z, 0, 2, 0, 0.12, 4 * s, 9 * s, 3, 2, 0.8, 1);
    if (!far) { this.sparks(x, y + 0.3, z, 3, 14 * s); }
    this.smoke(x, y + 1, z, rr(-2, 2), rr(2, 6), rr(-2, 2), rr(1, 2.4), 2 * s, 8 * s, 0.14, 0.45, 0.8);
  }
  explosion(x, y, z, s = 1, o = {}) {
    const dist = this.camDist(x, y, z), lod = dist > 700 ? 0.3 : dist > 350 ? 0.6 : 1;
    const nf = Math.ceil(9 * lod * Math.min(s, 2.5)), ns = Math.ceil(7 * lod * Math.min(s, 2.5));
    this.fire(x, y + s, z, 0, 0, 0, 0.16, 12 * s, 26 * s, 3, 2.1, 1.0, 0.9);
    for (let i = 0; i < nf; i++) this.fire(x + rr(-2, 2) * s, y + rr(0, 3) * s, z + rr(-2, 2) * s, rr(-7, 7) * s, rr(2, 13) * s, rr(-7, 7) * s, rr(0.35, 0.95), 4 * s, 11 * s, 3.2, rr(0.9, 1.7), 0.25, 1, 1.5);
    for (let i = 0; i < ns; i++) this.smoke(x + rr(-2, 2) * s, y + rr(1, 4) * s, z + rr(-2, 2) * s, rr(-4, 4) * s, rr(4, 11) * s, rr(-4, 4) * s, rr(2.5, 6) * Math.sqrt(s), 6 * s, 20 * s, rr(0.03, 0.09), 0.75, 0.7);
    if (lod > 0.5) { this.sparks(x, y + 1, z, Math.ceil(10 * s), 24 * Math.sqrt(s)); if (y < 6) this.dust(x, 0.5, z, 1.6 * s, 6, 0.15, 0.45); }
    this.flash(x, y + 4 * s, z, 1, 0.55, 0.2, 2500 * s * s, 0.28 + 0.1 * s, 110 * s + 60);
    if (y < 5) this.decal(x, z, 4.5 * s);
    if (s >= 1 && lod > 0.5 && !o.noDebris) this.debris(x, y, z, Math.ceil(2 * s), 0.7 * s, 16 * Math.sqrt(s));
    if (!o.silent) { this.G.sfx.boom(dist, s); this.G.shakeAt(x, y, z, s * 0.9); }
    this.G.skyFlash = Math.min(1.5, this.G.skyFlash + 0.12 * s * lod);
  }
  addEmitter(x, y, z, size, ttl = Infinity, smokeOnly = false) { const e = { x, y, z, size, ttl, smokeOnly, acc: rnd() }; this.emitters.push(e); return e; }

  update(dt) {
    // emitters (fires / smoke stacks), LOD by camera distance
    const cam = this.G.camera.position;
    for (let k = this.emitters.length - 1; k >= 0; k--) {
      const e = this.emitters[k]; e.ttl -= dt;
      if (e.ttl <= 0) { this.emitters.splice(k, 1); continue; }
      const d = Math.hypot(e.x - cam.x, e.z - cam.z); if (d > 900) continue;
      e.acc += dt * (d > 400 ? 5 : 11);
      while (e.acc > 1) {
        e.acc -= 1; const s = e.size;
        if (!e.smokeOnly) this.fire(e.x + rr(-1, 1) * s, e.y + rr(0, 1) * s, e.z + rr(-1, 1) * s, rr(-1, 1) * s, rr(3, 7) * s, rr(-1, 1) * s, rr(0.5, 1.1), 3.2 * s, 1.2 * s, 3.4, rr(1, 1.7), 0.25, 0.9, 0.3);
        if (rnd() < 0.5) this.smoke(e.x + rr(-1, 1) * s, e.y + 2 * s, e.z + rr(-1, 1) * s, rr(-1, 1) + 2.5, rr(4, 8) * Math.sqrt(s), rr(-1, 1) + 1, rr(5, 10), 3 * s, 16 * s, rr(0.03, 0.08), 0.6, 0.15);
      }
    }
    this.smokeP.update(dt); this.fireP.update(dt);
    { const g = this.flamePts.geometry; g.attributes.position.needsUpdate = true; g.attributes.aDat.needsUpdate = true; g.setDrawRange(0, this.fN); this.fN = 0; this.flameT = (this.flameT || 0) + dt; this.flameMat.uniforms.uT.value = this.flameT; }

    // tracers
    const tr = this.tr, mesh = this.trMesh;
    for (let k = tr.length - 1; k >= 0; k--) {
      const t = tr[k]; t.t += dt;
      const head = t.t * t.speed;
      if (head >= t.dist + t.len * 0.5) {
        mesh.setMatrixAt(t.i, ZERO); this.trFree.push(t.i);
        tr[k] = tr[tr.length - 1]; tr.pop();
        if (t.cb) t.cb(); continue;
      }
      const h = Math.min(head, t.dist), tail = Math.max(0, head - t.len), seg = Math.max(0.5, h - tail), mid = (h + tail) * 0.5;
      _p.set(t.ax + t.dx * mid, t.ay + t.dy * mid, t.az + t.dz * mid); _q.set(t.qx, t.qy, t.qz, t.qw); _s.set(t.w, t.w, seg);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(t.i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    for (const b of this.beams) {
      if (b.life <= 0) continue; b.life -= dt;
      if (b.life <= 0) { b.m.visible = false; continue; }
      const k = b.life / b.dur, w = b.w * (0.35 + 0.65 * k) * (0.8 + 0.4 * Math.random());
      b.m.scale.set(w, w, b.len);
    }
    for (const L of this.lights) {
      if (L.life <= 0) continue; L.life -= dt;
      L.l.intensity = L.life > 0 ? L.i0 * (L.life / L.dur) : 0;
    }
    // debris
    const db = this.db, dm = this.debrisMesh; let any = false;
    for (let i = 0; i < this.DB; i++) {
      const d = db[i]; if (d.life <= 0) continue; any = true;
      d.life -= dt;
      if (d.life <= 0) { dm.setMatrixAt(i, ZERO); continue; }
      if (d.vy !== 0 || d.y > d.sy) {
        d.vy -= 26 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
        if (d.y < d.sy * 0.5) {
          d.y = d.sy * 0.5;
          if (Math.abs(d.vy) < 4) { d.vy = 0; d.vx = d.vz = 0; d.wx = d.wy = d.wz = 0; }
          else { d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.wx *= 0.5; d.wz *= 0.5; }
        }
      }
      const k = Math.min(1, d.life);
      _p.set(d.x, d.y, d.z); _q.setFromEuler(_e.set(d.rx, d.ry, d.rz)); _s.set(d.sx * k, d.sy * k, d.sz * k);
      _m.compose(_p, _q, _s); dm.setMatrixAt(i, _m);
    }
    if (any) dm.instanceMatrix.needsUpdate = true;
  }
}
