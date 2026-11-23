// Points of interest (beacons, ground patches, discovery log) and ISRU resources (sampling + refining).
import * as THREE from 'three';
import { POI_TYPES } from './destinations.js';
import { createBeacon } from './fx.js';
import { setupMat, applyCurvature } from './gfx.js';

const V3 = THREE.Vector3;
const SHORT = { melt: 'Impact glass', arch: 'Arch', ice: 'Ice crater', spire: 'Resonant spire', meteor: 'Meteorite', falls: 'Singing Falls', grove: 'Fungus grove', bloom: 'Spore basin',
  lumen: 'Tide pool', choir: 'Chorus grove', motes: 'Mote nursery', hollow: 'Glow hollow',      // Nyth
  gate: 'Aethel Gate', strata: 'Shell strata', ring: 'Lumen ring', sunfall: 'Sunfall meadow', settlement: 'Lantern Domes' };      // Aethel

export class Discovery {
  constructor(rc, terrain) {
    this.rc = rc; this.t = terrain; this.group = new THREE.Group();
    this.found = new Map(); this.journal = [];
    this.markers = new Map(); this.time = 0;
    this.iceMat = setupMat(new THREE.MeshStandardMaterial({ color: 0xcfe9ff, roughness: 0.12, metalness: 0.0, emissive: 0x2a5a80, emissiveIntensity: 0.25, transparent: true, opacity: 0.88 }), 'decal-ice', applyCurvature);
    this.meltMat = setupMat(new THREE.MeshStandardMaterial({ color: 0x07100e, roughness: 0.05, metalness: 0.85, emissive: 0x0a5a40, emissiveIntensity: 0.35 }), 'decal-melt', applyCurvature);
    this.onDiscover = null;
  }
  reset() { for (const m of this.markers.values()) this.group.remove(m.obj); this.markers.clear(); }
  key(p) { return p.ix + ',' + p.iz; }
  pois(x, z, r) { return this.rc.poisNear(x + this.t.origin.x, z + this.t.origin.z, r); }
  _decal(p, mat, radius) {
    const rings = 12, segs = 40, pos = [], idx = [];
    const ox = this.t.origin.x, oz = this.t.origin.z;
    pos.push(0, this.rc.heightAt(p.x, p.z) + 0.1, 0);
    for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
      const a = s / segs * Math.PI * 2, d = radius * r / rings;
      const x = Math.cos(a) * d, z = Math.sin(a) * d * 1.0;
      pos.push(x, this.rc.heightAt(p.x + x, p.z + z) + 0.1 + 0.05 * (r / rings), z);
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + (s + 1) % segs, 1 + s);
    for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + (s + 1) % segs, c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.position.set(p.x - ox, 0, p.z - oz); m.frustumCulled = false;
    return m;
  }
  update(dt, x, z, y, canDiscover, camPos) {
    this.time += dt;
    const ox = this.t.origin.x, oz = this.t.origin.z;
    const near = this.pois(x, z, 2200);
    const keep = new Set();
    for (const p of near) {
      const k = this.key(p); keep.add(k);
      let mk = this.markers.get(k);
      if (!mk) {
        const obj = new THREE.Group(); const gy = this.rc.heightAt(p.x, p.z);
        obj.position.set(p.x - ox, gy, p.z - oz);
        const color = POI_TYPES[p.type].color;
        const beam = createBeacon(color, p.type === 'spire' ? 120 : 60); obj.add(beam);
        if (p.type === 'ice') obj.add(this._decal(p, this.iceMat, 205));
        if (p.type === 'melt') obj.add(this._decal(p, this.meltMat, 82));
        if (obj.children.length > 1) { for (const c of obj.children) if (c !== beam) { c.position.set(0, -gy, 0); } }
        this.group.add(obj); mk = { obj, beam, p }; this.markers.set(k, mk);
      }
      const dx = p.x - ox - x, dz = p.z - oz - z; const d = Math.hypot(dx, dz);
      const found = this.found.has(k);
      mk.beam.visible = d < 900;
      mk.beam.material.uniforms.uK.value = THREE.MathUtils.clamp((900 - d) / 500, 0, 1) * (found ? 0.7 : 1);
      mk.beam.material.uniforms.uTime.value = this.time;
      if (canDiscover && d < p.r + 55 && Math.abs(y - this.t.h(x, z)) < 140) this.discover(p);
    }
    for (const [k, m] of this.markers) if (!keep.has(k)) { this.group.remove(m.obj); this.markers.delete(k); }
  }
  discover(p) {
    const k = this.key(p); if (this.found.has(k)) return false;
    const T = POI_TYPES[p.type];
    this.found.set(k, true);
    const e = { key: k, type: p.type, name: T.name, text: T.text, x: p.x, z: p.z, n: this.found.size };
    this.journal.push(e);
    this.onDiscover && this.onDiscover(e);
    return true;
  }
  /** scan: reveal anything within range */
  scan(x, z, range = 450) {
    const near = this.pois(x, z, range); let n = 0;
    for (const p of near) if (this.discover(p)) n++;
    return { n, seen: near.length };
  }
  compassList(x, z, range = 8000) {
    const ox = this.t.origin.x, oz = this.t.origin.z;
    return this.pois(x, z, range).map((p) => {
      const dx = p.x - ox - x, dz = p.z - oz - z; const k = this.key(p), found = this.found.has(k);
      return { bearing: Math.atan2(dx, -dz), label: found ? (SHORT[p.type] || POI_TYPES[p.type].name) : '?', color: '#' + POI_TYPES[p.type].color.toString(16).padStart(6, '0'), found, dist: Math.hypot(dx, dz) };
    });
  }
}

// ------------------------------------------------------------------ resources
export const inventory = { ice: 0, regolith: 0, samples: 0 };
export function sampleAt(rc, ox, oz, x, z) {
  if (rc.waterDepth && rc.waterDepth(x + ox, z + oz) > 0.05) return { kind: 'ice', amount: 140 };       // wading: draw water (ISRU feedstock)
  const m = rc.materialAt(x + ox, z + oz, 0.12, [0, 0, 0, 0]);
  if (!rc.waterSurface && m[1] > 0.5) return { kind: 'ice', amount: 60 + Math.round(m[1] * 60) };
  return { kind: 'regolith', amount: 70 };
}
/** convert the carried ice / regolith into propellant for craft `v`. Returns {msg, usedIce, usedReg} */
export function refineInto(v, inv, rateScale = 1) {
  const spec = v.spec, t = v.tanks;
  if (inv.ice + inv.regolith <= 0.5) return { ok: false, msg: 'Nothing to refine: sample ice or regolith first (G)' };
  const mix = spec.mixture || 3.6;
  let ice = inv.ice, reg = inv.regolith, out = [];
  // 1. regolith -> oxygen
  if (spec.oxMax != null && reg > 0) {
    const room = spec.oxMax - t.ox; const use = Math.min(reg, room / 0.15);
    if (use > 0) { t.ox += use * 0.15; reg -= use; out.push(`+${(use * 0.15).toFixed(0)} kg ox`); }
  }
  // 2. ice -> methalox (0.5 kg propellant per kg ice)
  if (spec.fuelMax != null && ice > 0) {
    const roomP = Math.min((spec.fuelMax - t.fuel) * (1 + mix), (spec.oxMax - t.ox) * (1 + 1 / mix));
    const use = Math.min(ice, Math.max(0, roomP) / 0.5);
    if (use > 0) { const p = use * 0.5; t.fuel += p / (1 + mix); t.ox += p * mix / (1 + mix); ice -= use; out.push(`+${p.toFixed(0)} kg methalox`); }
  }
  // 3. remaining ice -> hydrogen (plane tank, then cargo for the carrier)
  if (ice > 0 && t.h2 != null) {
    const room = spec.h2Max - t.h2; const use = Math.min(ice, room / 0.14);
    if (use > 0) { t.h2 += use * 0.14; ice -= use; out.push(`+${(use * 0.14).toFixed(0)} kg H2`); }
  }
  if (ice > 0) {
    const room = spec.cargoMax - v.cargo.h2; const use = Math.min(ice, room / 0.14);
    if (use > 0) { v.cargo.h2 += use * 0.14; ice -= use; out.push(`+${(use * 0.14).toFixed(0)} kg H2 cargo`); }
  }
  const usedIce = inv.ice - ice, usedReg = inv.regolith - reg;
  inv.ice = ice; inv.regolith = reg;
  if (usedIce + usedReg < 0.5) return { ok: false, msg: 'Tanks are full', usedIce: 0, usedReg: 0 };
  return { ok: true, msg: 'Refined: ' + out.join(', '), usedIce, usedReg };
}
