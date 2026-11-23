import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const _r = mulberry32(20261116);
export const rnd = () => _r();
export const rr = (a, b) => a + (b - a) * _r();
export const ri = (a, b) => Math.floor(a + (b - a + 1) * _r());
export const pick = a => a[Math.floor(_r() * a.length)];
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
export const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const approach = (v, t, rate) => v < t ? Math.min(t, v + rate) : Math.max(t, v - rate);

const _c = new THREE.Color();
// Merges coloured primitives into one BufferGeometry (one draw call per rigid part).
export class Builder {
  constructor() { this.g = []; }
  _add(geo, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    geo.translate(x, y, z);
    if (Array.isArray(color)) _c.setRGB(color[0], color[1], color[2]); else _c.set(color);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.g.push(geo); return this;
  }
  box(w, h, d, x, y, z, color, rx, ry, rz) { return this._add(new THREE.BoxGeometry(w, h, d), x, y, z, color, rx, ry, rz); }
  cyl(r1, r2, h, x, y, z, color, rx, ry, rz, seg = 8) { return this._add(new THREE.CylinderGeometry(r1, r2, h, seg), x, y, z, color, rx, ry, rz); }
  pyr(w, h, x, y, z, color, d) { const g = new THREE.ConeGeometry(0.7071, 1, 4); g.rotateY(Math.PI / 4); g.scale(w, h, d || w); return this._add(g, x, y + h / 2, z, color); }
  build() { return mergeGeometries(this.g, false); }
  get empty() { return this.g.length === 0; }
}

// Faction palettes (original heraldry: the Karnite Vigil vs the Pyre Synod)
export const PAL = [
  { name: 'KARNITE VIGIL', hull: 0x46525e, dark: 0x1d2228, trim: 0x9a7a3a, bone: 0x9a947e, glow: [2.2, 1.3, 0.35], tracer: [2.1, 1.2, 0.32], inf: 0x7c8894 },
  { name: 'PYRE SYNOD', hull: 0x5a211a, dark: 0x191414, trim: 0x6c7434, bone: 0x3a3028, glow: [0.4, 2.1, 0.35], tracer: [0.45, 2.0, 0.35], inf: 0x9a4030 },
];
