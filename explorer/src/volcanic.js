// Pyra volcanic effects: ash / smoke columns from every vent (far-field billboard columns + near-field particles), glowing vent sparks,
// and the suit heat hazard (temperature rises near lava; HUD warns; overheating or wading in lava triggers an emergency retrieval).
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const img = g.createImageData(128, 128); const d = img.data;
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (x - 63.5) / 64, dy = (y - 63.5) / 64, r = Math.hypot(dx, dy);
    const n = 0.55 * vn(x / 18, y / 18) + 0.3 * vn(x / 8, y / 8) + 0.15 * vn(x / 3.5, y / 3.5);
    let a = clamp(1 - r, 0, 1); a = Math.pow(a, 0.9) * (0.7 + 0.5 * n); a = clamp(a * 1.25, 0, 1) * sstep(1.0, 0.7, r);
    const i = (y * 128 + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Volcanics {
  constructor(terrain, rc) {
    this.t = terrain; this.rc = rc; this.group = new THREE.Group(); this.time = 0; this.acc = new Map();
    const tex = puffTexture();
    this.cols = [];
    for (const v of rc.VENTS) {
      const sprites = [], N = v.big ? 28 : 14;
      for (let i = 0; i < N; i++) {
        const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x403a36, opacity: 0, fog: false });
        const sp = new THREE.Sprite(m); sp.renderOrder = 4; sp.frustumCulled = false; this.group.add(sp); sprites.push(sp);
      }
      this.cols.push({ v, sprites, ground: null, phase: Math.random() * 10, H: v.big ? 2300 * v.str / 1.8 : 330 * v.str, W: v.big ? 520 * v.str / 1.8 : 55 * v.str });
    }
  }
  /** cam: scene-local camera position; particles: shared Particles; sunY: sun elevation sine; light: sun colour (THREE.Color) */
  update(dt, cam, particles, sunY, light) {
    this.time += dt;
    const o = this.t.origin, rc = this.rc;
    const wx = 0.8, wz = 0.35;                     // wind drift direction (plane axes)
    const lc = light ? Math.max(light.r, light.g, light.b, 0.2) : 1;
    for (const c of this.cols) {
      const v = c.v, bx = v.x - o.x, bz = v.z - o.z;
      if (c.ground == null) c.ground = v.big ? v.rimH + (rc.heightAt(v.x, v.z) - rc.heightAt(v.x, v.z)) : rc.heightAt(v.x, v.z);
      if (c.big === undefined) c.big = v.big;
      const gy = v.big ? rc.heightAt(v.x, v.z) : c.ground;
      const dist = Math.hypot(bx - cam.x, bz - cam.z);
      const vis = dist < (v.big ? 60000 : 5500);
      for (let i = 0; i < c.sprites.length; i++) {
        const sp = c.sprites[i];
        if (!vis) { sp.visible = false; continue; }
        sp.visible = true;
        const uu = (this.time * (v.big ? 0.016 : 0.045) + i / c.sprites.length + c.phase) % 1;
        const h = uu * c.H;
        const spread = 1 + 2.4 * Math.pow(uu, 0.7);
        const sc = c.W * spread * (0.7 + 0.5 * Math.sin(i * 2.3 + c.phase));
        const drift = Math.pow(uu, 1.6) * c.H * 0.55 + (v.big ? 0 : 0);
        sp.position.set(bx + wx * drift + Math.sin(this.time * 0.07 + i * 1.9 + c.phase) * c.W * 0.4 * uu, gy + h + sc * 0.2, bz + wz * drift + Math.cos(this.time * 0.06 + i * 1.3) * c.W * 0.4 * uu);
        sp.scale.set(sc * (1 + (uu > 0.6 ? 0.8 * (uu - 0.6) : 0)), sc * (uu > 0.65 ? 0.55 : 1), 1);
        const fadeIn = sstep(0.0, 0.07, uu), fadeOut = 1 - sstep(0.62, 1.0, uu);
        sp.material.opacity = fadeIn * fadeOut * (v.big ? 0.5 : 0.4);
        // base glows orange from the lava below, the column darkens to ash and the far ones pick up the haze
        const glow = 1 - sstep(0.0, 0.22, uu), hz = sstep(3000, 26000, dist) * 0.55;
        const lit = (0.55 + 0.45 * clamp(sunY * 3 + 0.4, 0, 1)) * lc;
        const r = (0.14 + 0.9 * glow) * lit, g = (0.088 + 0.3 * glow) * lit, b = (0.066 + 0.05 * glow) * lit;
        sp.material.color.setRGB(r + (0.5 - r) * hz * 0.6, g + (0.22 - g) * hz * 0.6, b + (0.12 - b) * hz * 0.6);
      }
      // near field: rolling smoke and sparks as real particles
      if (particles && dist < 900 + (v.big ? 600 : 0)) {
        const k = (v.big ? 0 : 1) * v.str;                     // summit vents are far; fumaroles right next to the site get particles
        let a = (this.acc.get(v) || 0) + dt * 26 * k * (1 - dist / 1500); this.acc.set(v, a);
        while (a > 1) {
          a -= 1;
          const ang = Math.random() * 6.283, rr = Math.random() * 7;
          const sz = 8 + Math.random() * 10;
          particles.emit(bx + Math.cos(ang) * rr, gy + 1, bz + Math.sin(ang) * rr, wx * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2, 5 + Math.random() * 6, wz * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
            sz, sz * 2.4, 9 + Math.random() * 7, 0.3, 0.2, 0.14, 0.32 + Math.random() * 0.2, 0);
          if (Math.random() < 0.3) particles.emit(bx + (Math.random() - 0.5) * 6, gy + 0.5, bz + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, 6 + Math.random() * 8, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.5, 0.2, 1.6 + Math.random() * 1.6, 1.0, 0.4 + Math.random() * 0.3, 0.06, 0.9, 1);
        }
        this.acc.set(v, a);
      }
    }
  }
}

/** suit heat model. S = { t: 0..1 temperature, safe: {x,z}, warned } . Returns { heat, inLava, fail } */
export function suitStep(S, dt, rc, x, z, y) {
  const heat = rc.heatAt(x, z);
  const h = rc.heightAt(x, z), ws = rc.waterSurface(x, z, h);
  const inLava = ws > -1e8 && y < ws + 0.4;
  const rate = heat * 0.16 + (inLava ? 0.7 : 0) - 0.045 * (1 - clamp(heat * 3, 0, 1));
  S.t = clamp(S.t + rate * dt, 0, 1.0001);
  S.heat = heat; S.inLava = inLava;
  if (heat < 0.02 && !inLava) { S.safeT = (S.safeT || 0) + dt; if (S.safeT > 1.5) { S.safe = { x, z }; S.safeT = 0; } }
  return { heat, inLava, fail: S.t >= 1 };
}
export const suitCelsius = (t) => Math.round(36 + t * 150);
