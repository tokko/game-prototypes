import * as THREE from 'three';
import { rnd, rr, ri, pick, clamp } from './util.js?v=32';

export const P = 72;          // lot pitch
const NI = 9, NJ = 11;        // lots span i:-9..9, j:-11..11
const GW = NI * 2 + 1;
export const AVENUES = [-288, 0, 288];   // wide N-S roads (colossi + gunships)
export const LANES = [-180, -108, -28, 28, 108, 180];
export const SITE_XZ = [[108, -324], [-108, -180], [72, 0], [108, 180], [-108, 324]];   // the five objective sites A-E (js/objectives.js): the lots around each are left out, a plaza at a street junction

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _ax = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function hiveMaterial(base) {
  const mat = new THREE.MeshLambertMaterial(base);
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWin; varying vec3 vWp; varying vec3 vON; varying float vWin;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWp = (modelMatrix * wp4).xyz; vON = normal; vWin = aWin;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp; varying vec3 vON; varying float vWin;
        float hh1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
        float hh2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 hwGlow = vec3(0.0);
        {
          float hgt = vWp.y; vec3 an = abs(vON);
          float u = an.x > 0.5 ? vWp.z : vWp.x;
          float wall = 1.0 - step(0.5, an.y);
          float sc = max(vWin, 1.0);
          float streak = hh1(floor(u * 0.6 / sc));
          float grime = hh2(floor(vec2(u, hgt) * 0.45 / sc));
          diffuseColor.rgb *= mix(0.5, 1.2, smoothstep(0.0, 80.0 * sc, hgt)) * (0.8 + 0.25 * streak * wall + 0.2 * grime);
          float ledge = step(0.9, fract(hgt / (9.0 * sc))) * wall;
          diffuseColor.rgb *= 1.0 - 0.5 * ledge;
          float pil = step(0.86, fract(u / (12.8 * sc))) * wall;   // pilaster strips
          diffuseColor.rgb *= 1.0 + 0.35 * pil;
          if (vWin > 0.5 && wall > 0.5) {
            vec2 cell = vec2(u / (3.2 * sc), hgt / (6.0 * sc));
            vec2 id = floor(cell); vec2 f = fract(cell);
            float arch = 0.88 - abs(f.x - 0.5) * 1.4;
            float inside = step(0.28, f.x) * step(f.x, 0.72) * step(0.16, f.y) * step(f.y, arch);
            float grp = hh2(floor(id / vec2(4.0, 3.0)) + 11.0);
            float lit = step(0.86, hh2(id) * 0.55 + grp * 0.5);
            diffuseColor.rgb *= 1.0 - 0.7 * inside;
            vec3 wc = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.62, 0.25), hh2(id + 7.3));
            hwGlow = wc * inside * lit * (0.45 + 1.3 * hh2(id + 3.1));
          }
          // street-fire underglow
          hwGlow += vec3(0.30, 0.085, 0.02) * 0.07 * wall * smoothstep(60.0, 0.0, hgt);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += hwGlow;');
  };
  return mat;
}

function groundMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a443e });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWp;
        float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 w = vWp.xz;
          float n = gn(w * 0.035) * 0.55 + gn(w * 0.16) * 0.3 + gn(w * 0.9) * 0.15;
          vec2 sl = abs(fract(w / 9.0) - 0.5);
          float seam = smoothstep(0.47, 0.5, max(sl.x, sl.y));
          float slab = gh(floor(w / 9.0));
          float c = (0.45 + 0.75 * n) * (0.85 + 0.3 * slab) * (1.0 - 0.6 * seam);
          // boulevard / avenue centre markings and tram rails
          float ax = min(min(abs(w.x), abs(abs(w.x) - 288.0)), abs(w.y));
          float rail = smoothstep(0.5, 0.2, abs(ax - 6.0)) + smoothstep(0.5, 0.2, abs(ax - 9.0));
          c *= 1.0 + 0.7 * rail;
          float puddle = smoothstep(0.62, 0.7, gn(w * 0.05 + 40.0));
          diffuseColor.rgb *= c * mix(vec3(1.0), vec3(0.45, 0.4, 0.4), puddle);
          diffuseColor.rgb += vec3(0.02, 0.007, 0.0) * puddle;
        }`);
  };
  return mat;
}

export class City {
  constructor(G) {
    this.G = G; const scene = G.scene, fx = G.fx;
    this.grid = new Array(GW * (NJ * 2 + 1)).fill(null);
    this.buildings = []; this.collapsing = []; this.burning = []; this.heroes = [];
    const boxes = [], pyrs = [];
    const B = (b, x, y, z, sx, sy, sz, c, win = 0, rot = 0) => { boxes.push({ x, y: y + sy / 2, z, sx, sy, sz, c, win, rot }); if (b) b.parts.push(boxes.length - 1); };
    const Py = (b, x, y, z, sx, sy, sz, c) => { pyrs.push({ x, y: y + sy / 2, z, sx, sy, sz, c, win: 0, rot: 0 }); if (b) b.parts.push(-pyrs.length); };
    const stone = (k = 1) => { const v = rr(0.10, 0.21) * k, w = rr(-0.015, 0.022); return [v + w, v, v - w * 0.7]; };
    const dk = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

    const hab = b => {
      const { x, z, hw, hd } = b, c = stone(), c2 = dk(c, 0.7);
      const h = rr(24, 60); B(b, x, 0, z, hw * 2, h, hd * 2, c, 1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B(b, x + sx * hw, 0, z + sz * hd, 4.4, h + 7, 4.4, c2); Py(b, x + sx * hw, h + 7, z + sz * hd, 5.2, 9, 5.2, c2); }
      for (const k of [-0.5, 0, 0.5]) {
        B(b, x + k * hw, 0, z + hd + 0.5, 2.2, h + 2.5, 1.8, c2); B(b, x + k * hw, 0, z - hd - 0.5, 2.2, h + 2.5, 1.8, c2);
        B(b, x + hw + 0.5, 0, z + k * hd, 1.8, h + 2.5, 2.2, c2); B(b, x - hw - 0.5, 0, z + k * hd, 1.8, h + 2.5, 2.2, c2);
      }
      B(b, x, h, z, hw * 2 + 2.4, 2, hd * 2 + 2.4, c2);
      let top = h + 2, sw = 0, sd = 0;
      if (rnd() < 0.8) {
        const k = rr(0.5, 0.78), h2 = rr(10, 30); sw = hw * k; sd = hd * k;
        B(b, x, h + 2, z, sw * 2, h2, sd * 2, c, 1); top = h + 2 + h2;
        if (rnd() < 0.45) { const ph = rr(9, 20); Py(b, x, top, z, sw * 2.06, ph, sd * 2.06, c2); top += ph; }
        else { B(b, x, top, z, sw * 2 + 1.6, 1.5, sd * 2 + 1.6, c2); for (let k2 = 0; k2 < 3; k2++) B(b, x + rr(-sw, sw) * 0.7, top, z + rr(-sd, sd) * 0.7, rr(2, 6), rr(3, 9), rr(2, 6), c2); top += 6; }
      }
      if (rnd() < 0.3) { const sh = rr(18, 42), px = x + rr(-1, 1) * hw * 0.7, pz = z + rr(-1, 1) * hd * 0.7; B(b, px, h, pz, 4, sh, 4, c2); B(b, px, h + sh, pz, 5.2, 2, 5.2, c2); if (rnd() < 0.6) fx.addEmitter(px, h + sh + 3, pz, 2.6, Infinity, true); }
      b.h = h + 2; b.sw = sw; b.sd = sd; b.top = top; b.hp = 500;
    };
    const cathedral = b => {
      const { x, z, hw, hd } = b, c = stone(1.1), c2 = dk(c, 0.68);
      B(b, x, 0, z, hw * 2, 22, hd * 2, c, 1); B(b, x, 22, z, hw * 2 + 2, 1.6, hd * 2 + 2, c2);
      const nw = hw * 0.58; B(b, x, 23, z, nw * 2, 27, hd * 1.9, c, 1);
      Py(b, x, 50, z, nw * 2.1, 17, hd * 1.96, c2);
      for (let k = -2; k <= 2; k++) for (const s of [-1, 1]) {
        B(b, x + s * (hw - 1.5), 22, z + k * hd * 0.4, 2.2, 22, 2.6, c2); Py(b, x + s * (hw - 1.5), 44, z + k * hd * 0.4, 3, 7, 3.4, c2);
        B(b, x + s * (hw + nw) * 0.5, 37, z + k * hd * 0.4, hw - nw, 2, 1.6, c2, 0, s * 0.5);   // flying buttress
      }
      const th = rr(64, 92);
      for (const s of [-1, 1]) { B(b, x + s * (hw - 5), 0, z - hd + 5, 10, th, 10, c, 1); B(b, x + s * (hw - 5), th, z - hd + 5, 11.5, 2, 11.5, c2); Py(b, x + s * (hw - 5), th + 2, z - hd + 5, 10.5, 24, 10.5, c2); }
      for (let k = 0; k < 2; k++) { const sh = rr(60, 95), px = x + (k ? 1 : -1) * hw * 0.55, pz = z + hd - 5; B(b, px, 0, pz, 5.5, sh, 5.5, c2); B(b, px, sh, pz, 7, 2.5, 7, c2); fx.addEmitter(px, sh + 4, pz, 3.2, Infinity, rnd() < 0.6); }
      b.h = 50; b.sw = nw; b.sd = hd * 0.95; b.top = 64; b.hp = 900;
    };
    const spire = b => {
      const { x, z, hw, hd } = b, c = stone(0.95), c2 = dk(c, 0.66);
      let y = rr(24, 36), w = Math.min(hw, hd); B(b, x, 0, z, hw * 2, y, hd * 2, c, 1); B(b, x, y, z, hw * 2 + 2.4, 2, hd * 2 + 2.4, c2); y += 2;
      b.h = y; const tiers = ri(4, 6); let first = true;
      for (let t = 0; t < tiers; t++) {
        w *= rr(0.72, 0.84); const th = rr(20, 34);
        if (first) { b.sw = w; b.sd = w; first = false; }
        B(b, x, y, z, w * 2, th, w * 2, c, 1);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B(b, x + sx * w, y - 3, z + sz * w, 2.8, th + 9, 2.8, c2); Py(b, x + sx * w, y + th + 6, z + sz * w, 3.6, 10, 3.6, c2); }
        y += th; B(b, x, y, z, w * 2 + 2, 1.6, w * 2 + 2, c2); y += 1.6;
      }
      const nh = rr(28, 52); Py(b, x, y, z, w * 2, nh, w * 2, c2); y += nh; B(b, x, y - 6, z, 0.9, 26, 0.9, c2); y += 18;
      b.top = y; b.hp = 700; b.hero = true; this.heroes.push(b);
    };

    for (let j = -NJ; j <= NJ; j++) for (let i = -NI; i <= NI; i++) {
      if (i === 0 || Math.abs(i) === 4 || j === 0 || (Math.abs(i) <= 2 && Math.abs(j) >= 9) || (Math.abs(i) <= 1 && Math.abs(j) === 8)) continue;   // clear ground for the bastions and their ward generators
      const x = i * P, z = j * P;
      if (SITE_XZ.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 62)) continue;   // clear ground around an objective site
      const b = { x, z, i, j, hw: rr(20, 23), hd: rr(20, 23), h: 0, sw: 0, sd: 0, top: 0, hp: 500, alive: true, hero: false, parts: [], fall: null };
      const nearBlvd = Math.abs(i) === 1 || Math.abs(i) === 3 || Math.abs(i) === 5 || Math.abs(j) === 1;
      const r = rnd();
      if (r < (nearBlvd ? 0.3 : 0.12)) spire(b); else if (r < (nearBlvd ? 0.52 : 0.3)) cathedral(b); else hab(b);
      b.hp0 = b.hp; b.h0 = b.h;
      this.grid[(i + NI) + (j + NJ) * GW] = b; this.buildings.push(b);
    }
    // sky-bridges and pipe runs across side streets
    for (const b of this.buildings) {
      const n = this.grid[(b.i + 1 + NI) + (b.j + NJ) * GW];
      if (b.i < NI && n && rnd() < 0.3) {
        const y = rr(24, Math.min(b.h, n.h) - 8); if (y > 23) { const zz = b.z + rr(-12, 12); B(b, (b.x + n.x) / 2, y, zz, P - b.hw - n.hw + 4, 4.5, 5, [0.08, 0.075, 0.07], 1); B(b, (b.x + n.x) / 2, y + 4.5, zz, P - b.hw - n.hw + 4, 0.8, 6, [0.05, 0.05, 0.05]); }
      }
      const n2 = this.grid[(b.i + NI) + (b.j + 1 + NJ) * GW];
      if (b.j < NJ && n2 && rnd() < 0.22) { const y = rr(26, Math.min(b.h, n2.h) - 4); if (y > 25) B(b, b.x + rr(-12, 12), y, (b.z + n2.z) / 2, 2.2, 2.2, P - b.hd - n2.hd + 4, [0.06, 0.05, 0.045]); }
    }
    // far skyline megastructures (no collision)
    for (let k = 0; k < 90; k++) {
      const a = rnd() * 6.283, rad = rr(1000, 2100), x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (Math.abs(x) < 760 && Math.abs(z) < 880) continue;
      let w = rr(60, 190), y = 0; const c = stone(0.8), tiers = ri(2, 5);
      for (let t = 0; t < tiers; t++) { const h = rr(60, 190); B(null, x, y, z, w * 2, h, w * 2 * rr(0.7, 1.2), c, 4); y += h; w *= rr(0.55, 0.8); }
      if (rnd() < 0.6) Py(null, x, y, z, w * 2, rr(60, 180), w * 2, c);
    }
    // the enemy hive-fortress at the far north end: a stepped mountain of iron
    { let w = 520, y = 0; const c = [0.11, 0.09, 0.085];
      for (let t = 0; t < 7; t++) { const h = 80 + t * 22; B(null, 0, y, -1750, w * 2, h, w * 1.6, c, 4); for (const s of [-1, 1]) B(null, s * w * 0.95, y, -1750 + w * 0.6, 40, h + 60, 40, dk(c, 0.8), 4); y += h; w *= 0.7; }
      Py(null, 0, y, -1750, w * 2, 320, w * 2, dk(c, 0.8)); }

    const mk = (geo, list, mat) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const win = new Float32Array(list.length);
      list.forEach((o, k) => {
        _q.setFromEuler(_e.set(0, 0, o.rot)); _m.compose(_p.set(o.x, o.y, o.z), _q, _s.set(o.sx, o.sy, o.sz));
        mesh.setMatrixAt(k, _m); mesh.setColorAt(k, _c.setRGB(o.c[0], o.c[1], o.c[2])); win[k] = o.win;
      });
      geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(win, 1));
      mesh.frustumCulled = false; scene.add(mesh);
      return mesh;
    };
    const pg = new THREE.ConeGeometry(0.7071, 1, 4); pg.rotateY(Math.PI / 4);
    this.mat = hiveMaterial({ color: 0xffffff });
    this.boxMesh = mk(new THREE.BoxGeometry(1, 1, 1), boxes, this.mat);
    this.pyrMesh = mk(pg, pyrs, this.mat);
    this.boxBase = this.boxMesh.instanceMatrix.array.slice(); this.pyrBase = this.pyrMesh.instanceMatrix.array.slice();
    this.counts = { boxes: boxes.length, pyrs: pyrs.length, buildings: this.buildings.length };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMaterial());
    ground.rotation.x = -Math.PI / 2; scene.add(ground);

    // burning buildings
    for (let k = 0; k < 34; k++) {
      const b = pick(this.buildings); const side = rnd() < 0.5;
      fx.addEmitter(b.x + (side ? rr(-1, 1) * b.hw : (rnd() < 0.5 ? -1 : 1) * b.hw), rr(6, b.h), b.z + (side ? (rnd() < 0.5 ? -1 : 1) * b.hd : rr(-1, 1) * b.hd), rr(2, 4.5));
    }
    // street fires near the front
    for (let k = 0; k < 16; k++) fx.addEmitter(pick(LANES) + rr(-9, 9), 0.5, rr(-320, 320), rr(1, 2.2));

    // searchlights
    this.lights = [];
    const cg = new THREE.ConeGeometry(26, 520, 14, 1, true); cg.rotateX(Math.PI); cg.translate(0, 260, 0);
    const cm = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(0.55, 0.62, 0.7) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; varying vec2 vUv; void main(){ float a = pow(vUv.y, 1.6) * 0.17; gl_FragColor = vec4(uC * a, 1.0); }',
    });
    this.beamGeo = cg; this.beamMat = cm;
    for (let k = 0; k < 12; k++) {
      const b = pick(this.buildings); const m = new THREE.Mesh(cg, cm); m.position.set(b.x, b.h + 1, b.z); m.frustumCulled = false; m.renderOrder = 9;
      scene.add(m); this.lights.push({ m, a: rnd() * 6, b: rnd() * 6, sa: rr(0.1, 0.3), sb: rr(0.07, 0.2), b0: b });
    }

    // street clutter (crushable)
    const props = [];
    const pc = () => { const v = rr(0.1, 0.22); return [v * rr(0.9, 1.3), v, v * 0.9]; };
    for (const b of this.buildings) for (let k = 0; k < 4; k++) {
      const side = ri(0, 3), t = rr(-1, 1), off = rr(2, 4.5);
      const x = b.x + (side < 2 ? t * b.hw : (side === 2 ? 1 : -1) * (b.hw + off)), z = b.z + (side < 2 ? (side ? 1 : -1) * (b.hd + off) : t * b.hd);
      const kind = rnd();
      if (kind < 0.3) props.push({ x, z, sx: 0.4, sy: rr(7, 10), sz: 0.4, c: [0.06, 0.06, 0.06], r: 0 });
      else if (kind < 0.6) props.push({ x, z, sx: rr(1.4, 2.4), sy: rr(1.2, 2.2), sz: rr(1.4, 2.4), c: pc(), r: rnd() * 3 });
      else if (kind < 0.85) props.push({ x, z, sx: 2.3, sy: 1.5, sz: 5, c: pc(), r: side < 2 ? 1.57 + rr(-0.2, 0.2) : rr(-0.2, 0.2) });
      else props.push({ x, z, sx: 5.5, sy: 1.5, sz: 1.1, c: [0.13, 0.12, 0.11], r: rnd() * 3 });
    }
    for (let k = 0; k < 260; k++) { const x = pick(LANES) + rr(-10, 10), z = rr(-560, 560); props.push(rnd() < 0.5 ? { x, z, sx: 5.5, sy: 1.5, sz: 1.1, c: [0.13, 0.12, 0.11], r: rr(-0.4, 0.4) } : { x, z, sx: 2.3, sy: 1.5, sz: 5, c: pc(), r: rnd() * 3 }); }
    this.props = props;
    this.propMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), props.length);
    props.forEach((o, k) => { o.alive = true; _q.setFromEuler(_e.set(0, o.r, 0)); _m.compose(_p.set(o.x, o.sy / 2, o.z), _q, _s.set(o.sx, o.sy, o.sz)); this.propMesh.setMatrixAt(k, _m); this.propMesh.setColorAt(k, _c.setRGB(o.c[0], o.c[1], o.c[2])); });
    this.propMesh.frustumCulled = false; scene.add(this.propMesh);
  }

  lot(x, z) {
    const i = Math.round(x / P), j = Math.round(z / P);
    if (i < -NI || i > NI || j < -NJ || j > NJ) return null;
    return this.grid[(i + NI) + (j + NJ) * GW];
  }
  solid(x, y, z) {
    const b = this.lot(x, z); if (!b) return null;
    const dx = Math.abs(x - b.x), dz = Math.abs(z - b.z);
    if (dx < b.hw && dz < b.hd && y < b.h) return b;
    if (dx < b.sw && dz < b.sd && y < b.top) return b;
    return null;
  }
  // returns {t, b} (b null = ground) or null
  raycast(ox, oy, oz, dx, dy, dz, max) {
    const step = 4;
    for (let t = step; t <= max; t += step) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y <= 0) { const tg = dy < 0 ? -oy / dy : t; return { t: tg, b: null }; }
      const b = this.solid(x, y, z);
      if (b) { let tt = t; for (let k = 0; k < 4; k++) { tt -= 1; if (!this.solid(ox + dx * tt, oy + dy * tt, oz + dz * tt)) break; } return { t: tt + 0.5, b }; }
    }
    return null;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz), n = Math.ceil(d / 8);
    for (let k = 1; k < n; k++) { const t = k / n; if (this.solid(ax + dx * t, ay + dy * t, az + dz * t)) return false; }
    return true;
  }
  collideCircle(p, r) {
    let hit = null;   // returns the building touched (or null)
    const i0 = Math.round(p.x / P), j0 = Math.round(p.z / P);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < -NI || i > NI || j < -NJ || j > NJ) continue;
      const b = this.grid[(i + NI) + (j + NJ) * GW]; if (!b || !b.alive) continue;
      const cx = clamp(p.x, b.x - b.hw, b.x + b.hw), cz = clamp(p.z, b.z - b.hd, b.z + b.hd);
      let dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (!hit) hit = b;
        const px0 = p.x, pz0 = p.z;
        if (d2 < 1e-6) { const ex = b.hw - Math.abs(p.x - b.x), ez = b.hd - Math.abs(p.z - b.z); if (ex < ez) p.x = b.x + Math.sign(p.x - b.x || 1) * (b.hw + r); else p.z = b.z + Math.sign(p.z - b.z || 1) * (b.hd + r); }
        else { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
        { const ox = p.x - px0, oz = p.z - pz0, ol = Math.hypot(ox, oz); if (ol > 1e-6) { this.cnx = ox / ol; this.cnz = oz / ol; } }
      }
    }
    if (this.G.bastions) for (const bs of this.G.bastions) bs.collide(p, r);   // the fortress footprints block movers like lots do
    if (this.G.objectives) this.G.objectives.collide(p, r);   // so do the objective structures
    return hit;
  }
  damage(b, amt, dx = 0, dz = 0, fast = false, byPlayer = false) {
    if (!b || !b.alive) return false;
    if (byPlayer) b.byP = true;   // the player's heavy did this: its collapse pays Wrath
    b.hp -= amt;
    if (!b.burn && b.hp > 0 && b.hp < b.hp0 * 0.55) { b.burn = true; const s = rnd() < 0.5 ? 1 : -1; this.G.fx.addEmitter(b.x + s * b.hw, rr(8, Math.max(10, b.h0 * 0.7)), b.z + rr(-1, 1) * b.hd, 3.2, 120); this.G.fx.debris(b.x + s * b.hw, b.h0 * 0.5, b.z, 6, 1.8, 16, 0.09); }   // visibly wounded
    if (b.hp <= 0) { this.collapse(b, dx, dz, fast); return true; }
    return false;
  }
  collapse(b, dx = 0, dz = 0, fast = false) {
    if (!b.alive) return; b.alive = false;
    let l = Math.hypot(dx, dz); if (l < 0.01) { const a = rnd() * 6.28; dx = Math.cos(a); dz = Math.sin(a); l = 1; }
    dx /= l; dz /= l;
    const topple = b.top > 85 && rnd() < 0.85;
    b.fall = { t: 0, dur: 2.6 + b.top / 40, top: b.top, topple, dx, dz, pivot: topple ? Math.max(8, b.h * rr(0.5, 1.0)) : 0, hit: false, acc: 0 };
    if (fast) b.fall.dur *= 0.55;
    b.h = 0; b.top = 0; b.sw = 0; b.sd = 0;
    this.collapsing.push(b);
    const G = this.G; G.fx.explosion(b.x, 8, b.z, 2.2); G.fx.debris(b.x, 14, b.z, 10, 2.2, 24, 0.09);
    G.stats.spires += 1; if (b.byP && G.wrath) G.wrath.gain(b.hero ? 5 : 1.5);   // Wrath: building destroyed 1.5, a hero spire 5 (spec 3 / 10)
  }
  // flame on a wall: small blocks catch and weaken, big ones just scorch
  ignite(b, x, y, z) {
    if (!b || !b.alive) return;
    if (!(b.burnT > 0)) this.burning.push(b);
    b.burnT = 24; b.fireN = b.fireN || 0;
    if (b.fireN < 4 && rnd() < 0.08) { b.fireN++; this.G.fx.addEmitter(x, Math.max(3, y), z, 2.8, 26); }
  }
  crush(x, z, r) {
    if (this.G.streets) this.G.streets.crush(x, z, r);   // civilian wrecks and street debris
    let n = 0; const pr = this.props, r2 = r * r;
    for (let k = 0; k < pr.length; k++) {
      const o = pr[k]; if (!o.alive) continue;
      const dx = o.x - x, dz = o.z - z; if (dx * dx + dz * dz > r2) continue;
      o.alive = false; n++;
      _q.setFromEuler(_e.set(0, o.r, o.sy > 5 ? 1.5 : 0)); _m.compose(_p.set(o.x, 0.12, o.z), _q, _s.set(o.sx * 1.25, o.sy > 5 ? o.sy : 0.22, o.sz * 1.25));
      this.propMesh.setMatrixAt(k, _m);
      this.G.fx.sparks(o.x, 0.6, o.z, 3, 9);
    }
    if (n) this.propMesh.instanceMatrix.needsUpdate = true;
    return n;
  }
  update(dt, time) {
    for (const L of this.lights) {
      if (!L.b0.alive) { L.m.visible = false; continue; }
      L.m.rotation.x = Math.sin(time * L.sa + L.a) * 0.75; L.m.rotation.z = Math.sin(time * L.sb + L.b) * 0.75;
    }
    for (let k = this.burning.length - 1; k >= 0; k--) { const b = this.burning[k]; b.burnT -= dt; if (!b.alive || b.burnT <= 0) { b.burnT = 0; this.burning.splice(k, 1); continue; } this.damage(b, (!b.hero && b.hp0 <= 500 ? 16 : 3) * dt); }
    if (!this.collapsing.length) return;
    const G = this.G, fx = G.fx;
    for (let n = this.collapsing.length - 1; n >= 0; n--) {
      const b = this.collapsing[n], f = b.fall; f.t += dt; const k = Math.min(1, f.t / f.dur);
      const ang = 1.52 * Math.pow(k, 2.3);
      _ax.set(f.dz, 0, -f.dx);
      _m2.makeTranslation(b.x, f.pivot - k * k * f.pivot * 0.85, b.z); _m3.makeRotationAxis(_ax, ang); _m2.multiply(_m3);
      _m3.makeTranslation(-b.x, -f.pivot, -b.z); _m2.multiply(_m3);
      for (const pi of b.parts) {
        const isBox = pi >= 0, idx = isBox ? pi : -pi - 1, base = isBox ? this.boxBase : this.pyrBase, mesh = isBox ? this.boxMesh : this.pyrMesh;
        _m.fromArray(base, idx * 16);
        if (k >= 1) { mesh.setMatrixAt(idx, ZERO); continue; }
        if (f.topple && base[idx * 16 + 13] > f.pivot) _m.premultiply(_m2);
        else { _m3.makeTranslation(rr(-0.5, 0.5), -k * k * ((f.topple ? f.pivot : f.top) + 14), rr(-0.5, 0.5)); _m.premultiply(_m3); }
        mesh.setMatrixAt(idx, _m);
      }
      this.boxMesh.instanceMatrix.needsUpdate = true; this.pyrMesh.instanceMatrix.needsUpdate = true;
      // billowing dust
      f.acc += dt * 26;
      while (f.acc > 1) {
        f.acc -= 1; const a = rnd() * 6.28, rad = rr(0.6, 1.3) * b.hw;
        fx.smoke(b.x + Math.cos(a) * rad, rr(0, 14), b.z + Math.sin(a) * rad, Math.cos(a) * rr(4, 16), rr(1, 9), Math.sin(a) * rr(4, 16), rr(4, 9), 14, 46, rr(0.1, 0.17), 0.65, 0.5);
        if (f.topple) { const hh = rr(0, f.top - f.pivot), s = Math.sin(ang), c = Math.cos(ang); fx.smoke(b.x + f.dx * hh * s, f.pivot * (1 - k * k * 0.85) + hh * c, b.z + f.dz * hh * s, rr(-3, 3), rr(-2, 3), rr(-3, 3), rr(2, 5), 8, 26, 0.13, 0.5, 0.6); }
      }
      if (rnd() < dt * 10) fx.debris(b.x + rr(-1, 1) * b.hw, rr(5, 30), b.z + rr(-1, 1) * b.hd, 1, 2, 14, 0.09);
      if (f.topple && !f.hit && k > 0.8) {
        f.hit = true; const len = f.top - f.pivot;
        for (let d = 18; d < len; d += 16) {
          const x = b.x + f.dx * d, z = b.z + f.dz * d;
          fx.dust(x, 2, z, 5, 5, 0.14, 0.6); fx.explosion(x, 2, z, 1.4, { silent: true }); fx.debris(x, 4, z, 2, 2.2, 20, 0.09);
          G.blast(x, 2, z, 14, 400, -1);
        }
        G.sfx.boom(fx.camDist(b.x, 0, b.z), 4); G.shakeAt(b.x + f.dx * len * 0.5, 0, b.z + f.dz * len * 0.5, 5);
      }
      if (k >= 1) {
        // leave rubble
        const pi = b.parts.find(p => p >= 0), rh = rr(3.5, 7);
        _m.compose(_p.set(b.x, rh / 2, b.z), _q.identity(), _s.set(b.hw * 2.1, rh, b.hd * 2.1)); this.boxMesh.setMatrixAt(pi, _m);
        this.boxMesh.setColorAt(pi, _c.setRGB(0.06, 0.055, 0.05)); this.boxMesh.instanceColor.needsUpdate = true;
        const at = this.boxMesh.geometry.attributes.aWin; at.array[pi] = 0; at.needsUpdate = true;
        fx.debris(b.x, 3, b.z, 8, 3, 9, 0.08); fx.dust(b.x, 3, b.z, 7, 10, 0.14, 0.6);
        fx.addEmitter(b.x + rr(-8, 8), rh, b.z + rr(-8, 8), 3, 60);
        if (!f.topple) { G.sfx.boom(fx.camDist(b.x, 0, b.z), 3); G.shakeAt(b.x, 0, b.z, 3); }
        this.collapsing.splice(n, 1); b.fall = null;
      }
    }
  }
}
