// Pooled billboard particles (one instanced draw per system) + a small pool of flash lights.
// Atlas (4 x 2 cells of 256 px): 0 softPuff, 1/2 billow smoke (lit from above), 3 flame, 4 flash star, 5 spark streak,
// 6 dirt clod, 7 ember glow. Particles keep centres above the terrain (hard ground-intersection cut fix).
import {
  InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, Mesh,
  CanvasTexture, AdditiveBlending, NormalBlending, DynamicDrawUsage, PointLight, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter,
} from 'three';
import { Simplex2, mulberry32 } from '../util/noise.js';
import { atmo, ATMO_UNIFORMS, ATMO_PARS_VERT, ATMO_VERT, ATMO_PARS_FRAG, ATMO_FRAG } from '../environment/Atmosphere.js';

export const TILE = { PUFF: 0, BILLOW_A: 1, BILLOW_B: 2, FIRE: 3, STAR: 4, STREAK: 5, CLOD: 6, EMBER: 7 };

let ATLAS = null;
export function getAtlas() {
  if (ATLAS) return ATLAS;
  const T = 256, W = T * 4, H = T * 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const put = (tile, x, y, shade, a) => {
    // tile row 0 = lower half of the texture (v 0..0.5) = lower canvas half
    const ox = (tile % 4) * T, oy = (1 - Math.floor(tile / 4)) * T;
    const k = ((oy + y) * W + ox + x) * 4, s = Math.max(0, Math.min(1, shade)) * 255;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = s;
    img.data[k + 3] = Math.max(0, Math.min(1, a)) * 255;
  };
  const rnd = mulberry32(5150);
  for (let tile = 0; tile < 8; tile++) {
    const n = new Simplex2(100 + tile * 7), n2 = new Simplex2(300 + tile * 11);
    // billow circles
    const circles = [];
    for (let i = 0; i < 12; i++) circles.push([128 + (rnd() - 0.5) * 120, 128 + (rnd() - 0.5) * 120, 35 + rnd() * 35]);
    // star ray lengths
    const rays = []; for (let i = 0; i < 6; i++) rays.push(0.7 + rnd() * 0.6);
    // clod polygons
    const polys = [];
    for (let i = 0; i < 7; i++) {
      const cx = 60 + rnd() * 136, cy = 60 + rnd() * 136, r = 14 + rnd() * 26, nv = 6 + ((rnd() * 3) | 0), pts = [];
      for (let k = 0; k < nv; k++) { const a = (k / nv) * 6.283; pts.push([cx + Math.cos(a) * r * (0.7 + rnd() * 0.5), cy + Math.sin(a) * r * (0.7 + rnd() * 0.5)]); }
      polys.push(pts);
    }
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const u = (x + 0.5) / T, v = (y + 0.5) / T;
        const dx = x + 0.5 - 128, dy = y + 0.5 - 128, d = Math.hypot(dx, dy) / 128;
        if (tile === 0) { put(tile, x, y, 1, Math.pow(1 - smooth(0, 1, d), 1.5)); continue; }
        if (tile === 1 || tile === 2) {
          let a = 0;
          for (const ci of circles) { const dd = Math.hypot(x - ci[0], y - ci[1]) / ci[2]; a = Math.max(a, Math.pow(Math.max(0, 1 - dd), 2)); }
          const f = 0.55 + 0.45 * (0.5 + 0.5 * (n.fbm(x / 64, y / 64, 3) * 0.6 + n2.noise(x / 24, y / 24) * 0.4));
          a = Math.min(1, a * f * 1.5) * (1 - smooth(0.75, 1, d));
          const shade = 0.72 + 0.28 * (1 - y / T) + 0.1 * (f - 0.7);
          put(tile, x, y, shade, a);
          continue;
        }
        if (tile === 3) { // flame: tapered ellipse, tip up
          const yy = 1 - v; // canvas-down = 0 at top
          const ty = (y / T);
          const rx = 0.38 * (0.25 + 0.75 * Math.pow(ty, 0.7)), ry = 0.5;
          const e = Math.pow((u - 0.5) / rx, 2) + Math.pow((ty - 0.58) / ry, 2);
          let a = Math.max(0, 1 - e);
          const f = 0.3 + 0.7 * (0.5 + 0.5 * n.fbm(x / 24, y / 24, 3));
          a = Math.min(1, Math.pow(a, 0.8) * f * 1.6);
          put(tile, x, y, 1.0 - 0.4 * e, a * (yy > -1 ? 1 : 1));
          continue;
        }
        if (tile === 4) { // 6-ray flare star
          const th = Math.atan2(dy, dx), dd = d * 0.5;
          const ray = 0.7 + 0.6 * rays[Math.floor(((th + Math.PI) / 6.283) * 6) % 6];
          const r = 0.25 + 0.25 * Math.pow(Math.abs(Math.cos(3 * th)), 8) * ray;
          const a = Math.pow(smooth(r, 0, dd), 1.2) + Math.exp(-(dd * dd) / (2 * 0.12 * 0.12));
          put(tile, x, y, 1, a);
          continue;
        }
        if (tile === 5) { // spark streak, head toward +x
          const a = Math.exp(-((y - 128) * (y - 128)) / 50) * Math.pow(u, 0.6) * (1 - smooth(0.9, 1, u));
          put(tile, x, y, 1, a);
          continue;
        }
        if (tile === 6) { // dirt clods: polygons + specks
          let a = 0;
          for (const poly of polys) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              if (((poly[i][1] > y) !== (poly[j][1] > y)) && (x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0])) inside = !inside;
            }
            if (inside) { a = 1; break; }
          }
          const sp = n.noise(x / 6, y / 6) > 0.62 && d < 0.8 ? 0.8 : 0;
          put(tile, x, y, 0.7 + 0.3 * n.noise(x / 9, y / 9), Math.max(a, sp));
          continue;
        }
        // 7: ember glow
        put(tile, x, y, 1, Math.exp(-(d * d) / (2 * 0.06 * 0.06 * 16)) + 0.3 * Math.exp(-(d * d) / (2 * 0.2 * 0.2 * 4)));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  ATLAS = t;
  return t;
}

const VERT = /* glsl */`
attribute vec3 aPos; attribute vec4 aData; attribute vec3 aColor;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
${ATMO_PARS_VERT}
void main() {
  vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
  float depth = max(-mvPosition.z, 0.01);
  float size = aData.x;
  #ifdef ADDITIVE
  size = min(size, 0.35 * max(depth, 2.0));
  #endif
  float s = sin(aData.z), c = cos(aData.z);
  vec2 q = position.xy * size;
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  mvPosition.xy += q;
  gl_Position = projectionMatrix * mvPosition;
  float tile = aData.w;
  float farNear = step(7.5, tile);
  tile -= 8.0 * farNear;
  vUv = (uv + vec2(mod(tile, 4.0), floor(tile / 4.0))) * vec2(0.25, 0.5);
  // own-gun smoke/dust (flag) fades within ~9 m of the camera so the sight never whites out
  float nearFade = mix(smoothstep(0.4, 2.5, depth), smoothstep(2.0, 9.0, depth), farNear);
  vAlpha = aData.y * nearFade; vColor = aColor;
  ${ATMO_VERT}
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv; varying float vAlpha; varying vec3 vColor;
${ATMO_PARS_FRAG}
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  #ifndef ADDITIVE
  ${ATMO_FRAG}
  #endif
}`;

const FIELDS = ['vx', 'vy', 'vz', 'life', 'maxLife', 'size0', 'size1', 'alpha0', 'rotSpeed', 'drag', 'grav', 'fadeIn', 'fadeOut', 'windF'];

export class ParticleSystem {
  constructor(scene, { max = 2000, additive = false, renderOrder = 10, terrain = null } = {}) {
    this.max = max;
    this.n = 0;
    this.additive = additive;
    this.terrain = terrain;
    for (const f of FIELDS) this[f] = new Float32Array(max);
    this.pos = new Float32Array(max * 3);
    this.data = new Float32Array(max * 4);
    this.col = new Float32Array(max * 3);
    this.rot = new Float32Array(max);

    const plane = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    this.aPos = new InstancedBufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.aData = new InstancedBufferAttribute(this.data, 4).setUsage(DynamicDrawUsage);
    this.aColor = new InstancedBufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new ShaderMaterial({
      uniforms: Object.assign({ uMap: { value: getAtlas() } }, ATMO_UNIFORMS),
      defines: additive ? { ADDITIVE: 1 } : {},
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog: false,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  // o: { x,y,z, vx,vy,vz, life, size0,size1, alpha, r,g,b, tile, drag, grav (+down, -buoyant), wind (0..1), fadeIn, fadeOut, rot, rotSpeed, ground }
  emit(o) {
    if (this.n >= this.max) return;
    const i = this.n++;
    let y = o.y;
    if (this.terrain && o.ground !== false) {
      const sz = Math.max(o.size0 || 1, o.size1 !== undefined ? o.size1 : o.size0 || 1);
      const lift = Math.min(3, sz * (this.additive ? 0.45 : 0.3));
      const h = this.terrain.getHeight(o.x, o.z) + lift;
      if (y < h) y = h;
    }
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = 0; this.maxLife[i] = o.life || 1;
    this.size0[i] = o.size0 || 1; this.size1[i] = o.size1 !== undefined ? o.size1 : this.size0[i];
    this.alpha0[i] = o.alpha !== undefined ? o.alpha : 1;
    this.rotSpeed[i] = o.rotSpeed || 0;
    this.rot[i] = o.rot !== undefined ? o.rot : Math.random() * 6.283;
    this.drag[i] = o.drag || 0; this.grav[i] = o.grav || 0; this.windF[i] = o.wind || 0;
    this.fadeIn[i] = o.fadeIn !== undefined ? o.fadeIn : 0.1;
    this.fadeOut[i] = o.fadeOut !== undefined ? o.fadeOut : 0.6;
    this.col[i * 3] = o.r !== undefined ? o.r : 1; this.col[i * 3 + 1] = o.g !== undefined ? o.g : 1; this.col[i * 3 + 2] = o.b !== undefined ? o.b : 1;
    this.data[i * 4 + 3] = (o.tile !== undefined ? o.tile : 1 + Math.floor(Math.random() * 2)) + (o.nearFade ? 8 : 0);
    this.data[i * 4] = this.size0[i]; this.data[i * 4 + 1] = 0; this.data[i * 4 + 2] = this.rot[i];
  }

  _copy(dst, src) {
    for (let f = 0; f < FIELDS.length; f++) { const a = this[FIELDS[f]]; a[dst] = a[src]; }
    this.rot[dst] = this.rot[src];
    for (let k = 0; k < 3; k++) { this.pos[dst * 3 + k] = this.pos[src * 3 + k]; this.col[dst * 3 + k] = this.col[src * 3 + k]; }
    for (let k = 0; k < 4; k++) this.data[dst * 4 + k] = this.data[src * 4 + k];
  }

  update(dt) {
    let i = 0;
    const pos = this.pos, data = this.data, w = atmo.uWind.value;
    while (i < this.n) {
      const life = (this.life[i] += dt);
      const ml = this.maxLife[i];
      if (life >= ml) { this._copy(i, this.n - 1); this.n--; continue; }
      const d = 1 / (1 + this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] = this.vy[i] * d - this.grav[i] * dt; this.vz[i] *= d;
      const wf = this.windF[i];
      pos[i * 3] += (this.vx[i] + w.x * wf) * dt; pos[i * 3 + 1] += this.vy[i] * dt; pos[i * 3 + 2] += (this.vz[i] + w.z * wf) * dt;
      this.rot[i] += this.rotSpeed[i] * dt;
      const t = life / ml;
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      data[i * 4] = this.size0[i] + (this.size1[i] - this.size0[i]) * e;
      const fi = this.fadeIn[i], fo = this.fadeOut[i];
      let a = this.alpha0[i];
      if (t < fi) a *= t / fi;
      if (t > 1 - fo) a *= (1 - t) / fo;
      data[i * 4 + 1] = a;
      data[i * 4 + 2] = this.rot[i];
      i++;
    }
    this.geometry.instanceCount = this.n;
    this.aPos.needsUpdate = true; this.aData.needsUpdate = true; this.aColor.needsUpdate = true;
  }
}

// ---- pooled point lights (fixed count so shaders never recompile) ----
export class FlashLights {
  constructor(scene, count = 3) {
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new PointLight(0xffb060, 0, 60, 2);
      l.userData = { t: 0, dur: 0.1, peak: 0, active: false };
      scene.add(l);
      this.lights.push(l);
    }
  }

  flash(x, y, z, peak, dur, color = 0xffb060, distance = 60) {
    let best = this.lights[0];
    for (const l of this.lights) { if (!l.userData.active) { best = l; break; } if (l.userData.t > best.userData.t) best = l; }
    best.position.set(x, y, z);
    best.color.setHex(color);
    best.distance = distance;
    best.userData.t = 0; best.userData.dur = dur; best.userData.peak = peak; best.userData.active = true;
  }

  update(dt) {
    for (const l of this.lights) {
      const u = l.userData;
      if (!u.active) continue;
      u.t += dt;
      if (u.t >= u.dur) { u.active = false; l.intensity = 0; continue; }
      const k = 1 - u.t / u.dur;
      l.intensity = u.peak * k * k;
    }
  }
}
