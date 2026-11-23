// Square minimap (canvas): pre-rendered terrain shading, roads, buildings, route; rotates with the hull heading.
import { smoothstep } from '../util/math.js';

const HALF = 1000;     // metres covered by the base image on each side
const BASE_SCALE = 0.5; // base image pixels per metre
const VIEW_PPM = 0.34;  // on-screen pixels per metre

export class Minimap {
  constructor(parent, world) {
    this.world = world;
    this.size = 190;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = Math.round(this.size * dpr);
    this.dpr = dpr;
    parent.insertBefore(this.canvas, parent.firstChild);
    this.ctx = this.canvas.getContext('2d');
    this.markers = []; // { x, z, type: 'objective' | 'optional' | 'enemy' | 'friendly' }
    this.base = this._renderBase();
  }

  setMarkers(list) { this.markers = list; }
  setRoute(points) { this.route = points; }

  _renderBase() {
    const { terrain, statics, buildings, route } = this.world;
    const N = Math.round(HALF * 2 * BASE_SCALE);
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    const T = terrain;
    for (let j = 0; j < N; j++) {
      const z = -HALF + (j + 0.5) / BASE_SCALE;
      for (let i = 0; i < N; i++) {
        const x = -HALF + (i + 0.5) / BASE_SCALE;
        const h = T.getHeight(x, z);
        const shade = (T.getHeight(x - 3, z - 3) - T.getHeight(x + 3, z + 3)) * 0.07;
        const gold = T.fieldAt(x, z);
        let r = 62 + gold * 70, g = 88 + gold * 34, b = 46 + gold * -2;
        const hk = smoothstep(0, 45, h) * 0.35;
        r += hk * 40; g += hk * 30; b += hk * 18;
        const k = 1 + Math.max(-0.45, Math.min(0.5, shade));
        const idx = (j * N + i) * 4;
        // dark tactical look: desaturate to ~30% and darken
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        r = (lum + (r - lum) * 0.32) * 0.52; g = (lum + (g - lum) * 0.32) * 0.52; b = (lum + (b - lum) * 0.32) * 0.56;
        img.data[idx] = Math.min(255, r * k); img.data[idx + 1] = Math.min(255, g * k); img.data[idx + 2] = Math.min(255, b * k); img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const px = (x) => (x + HALF) * BASE_SCALE;
    // faint 100 m grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let g = -HALF; g <= HALF; g += 100) { ctx.moveTo(px(g), 0); ctx.lineTo(px(g), N); ctx.moveTo(0, px(g)); ctx.lineTo(N, px(g)); }
    ctx.stroke();
    // forests as dark dots
    ctx.fillStyle = 'rgba(14,24,14,0.5)';
    for (const col of statics) {
      if (col.tag !== 'tree') continue;
      ctx.beginPath(); ctx.arc(px(col.x), px(col.z), 2.2, 0, 6.3); ctx.fill();
    }
    // roads
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(214,205,176,0.9)'; ctx.lineWidth = 2.6;
    ctx.beginPath();
    route.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z))));
    ctx.stroke();
    // buildings
    ctx.fillStyle = 'rgba(46,40,36,0.95)';
    for (const b of buildings || []) {
      ctx.save();
      ctx.translate(px(b.x), px(b.z));
      ctx.rotate(-b.heading);
      ctx.fillRect(-b.hx * BASE_SCALE, -b.hz * BASE_SCALE, b.hx * 2 * BASE_SCALE, b.hz * 2 * BASE_SCALE);
      ctx.restore();
    }
    return c;
  }

  // px, pz: player position; hullHeading: hull h (forward = (sin h, cos h)); aimYaw: view yaw
  update(px, pz, hullHeading, aimYaw) {
    const c = this.ctx, S = this.canvas.width, s = VIEW_PPM * this.dpr, half = S / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#26311f';
    c.fillRect(0, 0, S, S);
    const bearing = Math.PI - hullHeading; // clockwise from north
    c.save();
    c.translate(half, half);
    c.rotate(-bearing);
    const k = s / BASE_SCALE;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.base, (-HALF - px) * s, (-HALF - pz) * s, HALF * 2 * s, HALF * 2 * s);
    void k;
    // route to the current objective (blue, under-stroked), through the road where possible
    if (this.route && this.route.length > 1) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      const path = () => { c.beginPath(); this.route.forEach((p, i) => (i ? c.lineTo((p.x - px) * s, (p.z - pz) * s) : c.moveTo((p.x - px) * s, (p.z - pz) * s))); };
      c.strokeStyle = 'rgba(8,24,52,0.85)'; c.lineWidth = 5 * this.dpr; path(); c.stroke();
      c.strokeStyle = '#3d8bff'; c.lineWidth = 3 * this.dpr; path(); c.stroke();
    }
    // markers
    const lim = half - 10 * this.dpr;
    for (const m of this.markers) {
      let dx = (m.x - px) * s, dz = (m.z - pz) * s;
      const d = Math.hypot(dx, dz);
      let edge = false;
      if (d > lim * 1.35) { dx *= (lim * 1.35) / d; dz *= (lim * 1.35) / d; edge = true; }
      c.save();
      c.translate(dx, dz);
      c.rotate(bearing); // keep glyphs upright
      const r = 5 * this.dpr;
      if (m.type === 'enemy') { c.fillStyle = '#ff4a3a'; c.beginPath(); c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath(); c.fill(); }
      else if (m.type === 'hollow') { c.strokeStyle = '#ff4a3a'; c.lineWidth = 1.5 * this.dpr; c.beginPath(); c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath(); c.stroke(); }
      else if (m.type === 'friendly') { c.fillStyle = '#5aa0ff'; c.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4); }
      else {
        c.strokeStyle = m.type === 'optional' ? 'rgba(160,200,255,0.9)' : '#4d9bff';
        c.fillStyle = m.type === 'optional' ? 'rgba(0,0,0,0)' : '#4d9bff';
        c.lineWidth = 1.6 * this.dpr;
        c.beginPath(); c.moveTo(0, -r * 1.2); c.lineTo(r * 1.2, 0); c.lineTo(0, r * 1.2); c.lineTo(-r * 1.2, 0); c.closePath();
        c.fill(); c.stroke();
      }
      if (edge) { c.globalAlpha = 0.6; }
      c.restore();
    }
    c.restore();

    // north marker
    c.save();
    c.translate(half, half);
    const nr = half - 11 * this.dpr;
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.font = `${11 * this.dpr}px "Segoe UI", Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', -Math.sin(bearing) * nr, -Math.cos(bearing) * nr);
    // view cone (aim direction relative to the hull)
    const rel = hullHeading - aimYaw;
    c.rotate(rel);
    const cone = c.createLinearGradient(0, 0, 0, -70 * this.dpr);
    cone.addColorStop(0, 'rgba(255,255,255,0.32)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = cone;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(-22 * this.dpr, -70 * this.dpr); c.lineTo(22 * this.dpr, -70 * this.dpr); c.closePath(); c.fill();
    c.rotate(-rel);
    // player arrow
    const a = 6.5 * this.dpr;
    c.fillStyle = '#ffffff'; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.2 * this.dpr;
    c.beginPath(); c.moveTo(0, -a * 1.3); c.lineTo(a, a); c.lineTo(0, a * 0.45); c.lineTo(-a, a); c.closePath();
    c.fill(); c.stroke();
    c.restore();
  }
}
