import * as THREE from 'three';
import { Builder, mulberry32, clamp } from './util.js?v=32';
import { LANES, AVENUES } from './city.js?v=32';

// Civilian wreckage and street debris: burned-out ground cars, cargo haulers and transit carriers left where the district
// died, plus rubble, fallen masonry and statuary, girders, barricades, crates and shell craters. Everything is instanced
// (one draw call per kind) and purely cosmetic for movement: nothing here blocks walkers, tanks or infantry. Feet, tracks,
// colossus stomps and blasts flatten it (and a walker's stride kicks the wreck along a little).
const CELL = 24, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const rnd = mulberry32(77120413), rr = (a, b) => a + (b - a) * rnd(), pick = a => a[Math.floor(rnd() * a.length)];
const g = v => [v, v, v], HP = Math.PI / 2;

function geoCar() {
  const b = new Builder();
  b.box(2.0, 0.75, 4.8, 0, 0.7, 0, g(1)).box(1.7, 0.1, 1.3, 0, 1.1, 1.6, g(1.45)).box(2.04, 0.4, 1.2, 0, 0.75, -1.7, g(0.6)).box(1.8, 0.75, 2.5, 0, 1.4, -0.4, g(0.7)).box(1.86, 0.4, 1.9, 0, 1.48, -0.4, g(0.16)).box(1.5, 0.4, 2.56, 0, 1.48, -0.4, g(0.16))
    .box(0.3, 0.22, 2.7, 0, 1.86, -0.4, g(0.7)).box(1.6, 0.5, 0.14, 0, 0.72, 2.42, g(0.2)).box(2.1, 0.2, 0.3, 0, 0.42, 2.45, g(0.5)).box(2.1, 0.2, 0.3, 0, 0.42, -2.45, g(0.5));
  for (const x of [1.05, -1.05]) for (const z of [1.5, -1.5]) b.box(0.35, 0.72, 0.95, x, 0.36, z, g(0.13));
  return b.build();
}
function geoHauler() {
  const b = new Builder();
  b.box(2.6, 0.5, 9.2, 0, 0.85, 0, g(0.3)).box(2.8, 2.2, 2.4, 0, 2.2, 2.6, g(1)).box(2.84, 0.5, 2.44, 0, 1.4, 2.6, g(1.4)).box(2.5, 0.75, 0.12, 0, 2.6, 3.82, g(0.15)).box(2.86, 0.7, 1.2, 0, 2.6, 2.9, g(0.15))
    .box(2.4, 1.3, 1.5, 0, 1.75, 4.3, g(0.9)).box(2.0, 0.9, 0.14, 0, 1.7, 5.07, g(0.2)).box(0.3, 2.6, 0.3, 1.25, 3.6, 1.2, g(0.25))
    .box(2.9, 0.3, 5.6, 0, 1.25, -1.7, g(0.6)).cyl(1.15, 1.15, 4.8, 0, 2.5, -1.7, g(0.8), HP, 0, 0, 8).box(2.4, 0.25, 0.4, 0, 2.5, -0.4, g(0.3)).box(2.4, 0.25, 0.4, 0, 2.5, -3.0, g(0.3));
  for (const x of [1.25, -1.25]) for (const z of [3.4, -1.2, -3.2]) b.box(0.5, 1.1, 1.3, x, 0.55, z, g(0.13));
  return b.build();
}
function geoCarrier() {
  const b = new Builder();
  b.box(3.0, 2.7, 13, 0, 2.15, 0, g(1)).box(3.04, 0.5, 13.04, 0, 1.5, 0, g(1.4)).box(3.06, 0.95, 11.8, 0, 2.6, 0, g(0.14)).box(2.6, 0.5, 12.4, 0, 3.75, 0, g(0.75)).box(0.5, 0.35, 11, 0, 4.15, 0, g(0.55))
    .box(2.2, 1.1, 0.14, 0, 2.6, 6.52, g(0.14)).box(1.2, 0.5, 0.3, 0, 1.2, 6.6, g(0.4)).box(3.1, 0.3, 13.1, 0, 0.9, 0, g(0.45));
  for (let k = -3; k <= 3; k++) b.box(3.12, 0.97, 0.45, 0, 2.6, k * 1.85, g(0.9));
  for (const z of [4.2, -4.2]) b.box(2.5, 0.85, 2.8, 0, 0.45, z, g(0.13));
  b.pyr(0.7, 1.1, 0, 4.3, 5.2, g(0.5)); b.box(0.2, 1.8, 0.2, 0, 4.9, -5.2, g(0.3));
  return b.build();
}
function geoRubble() {
  const b = new Builder();
  for (let k = 0; k < 11; k++) { const a = rnd() * 6.28, r = rr(0, 2.6), s = rr(0.6, 1.9) * (1 - r * 0.18); b.box(s * rr(0.7, 1.4), s * rr(0.4, 0.9), s * rr(0.7, 1.4), Math.cos(a) * r, s * 0.3, Math.sin(a) * r, g(rr(0.6, 1.1)), rr(-0.5, 0.5), rnd() * 3, rr(-0.5, 0.5)); }
  b.box(3.2, 0.3, 2.0, 0.4, 0.5, -0.3, g(0.8), 0.25, 0.6, 0.1).box(0.2, 0.2, 3.4, -1, 1.0, 0.6, g(0.35), 0.5, 1.1, 0);
  return b.build();
}
function geoMasonry() {
  const b = new Builder();
  b.cyl(0.9, 0.9, 3.4, -1.6, 0.9, 0.4, g(0.95), 0, 0.5, HP, 8).cyl(0.9, 0.9, 1.6, 1.9, 0.9, -1.4, g(0.85), 0, -0.9, HP, 8).cyl(1.25, 0.9, 0.7, 3.2, 0.5, -2.2, g(1), 0.3, 0, HP + 0.3, 8)
    .box(2.4, 0.8, 2.4, 0.6, 0.4, 2.3, g(0.8), 0.12, 0.5, 0.08)
    // a toppled statue: robed torso, head rolled clear, one arm
    .box(1.5, 2.6, 1.0, -0.6, 0.6, -2.4, g(1.05), HP - 0.2, 0.4, 0).box(1.9, 0.5, 1.2, -1.5, 0.45, -1.5, g(0.9), HP - 0.2, 0.4, 0)
    .cyl(0.5, 0.45, 0.9, 1.3, 0.48, -3.4, g(1.1), 0.6, 0, 0.9, 7).box(0.4, 1.5, 0.4, 0.9, 0.25, -1.6, g(1), HP, 1.2, 0)
    .box(0.9, 0.6, 0.8, -2.8, 0.3, 2.2, g(0.7), 0.3, 1, 0.2).box(0.7, 0.5, 0.9, 2.6, 0.25, 1.0, g(0.75), 0, 2, 0.3)
    // a slab of facade, arch openings punched through, leaning on the pile
    .box(4.6, 0.5, 3.4, 2.4, 0.9, 2.6, g(0.9), 0.32, 0.4, 0.1).box(0.9, 0.52, 1.6, 1.7, 1.0, 2.5, g(0.2), 0.32, 0.4, 0.1).box(0.9, 0.52, 1.6, 3.3, 1.05, 3.0, g(0.2), 0.32, 0.4, 0.1)
    .box(3.6, 0.45, 2.2, -2.6, 0.3, -0.2, g(0.8), -0.1, 2.2, 0.05);
  return b.build();
}
function geoGirder() {
  const b = new Builder();
  for (const [x, y, z, ry, rx, L] of [[0, 0.5, 0, 0, 0.06, 11], [1.4, 0.95, 0.8, 0.7, -0.05, 8], [-1.2, 0.3, -2.4, -0.35, 0, 6]]) {
    const q = new Builder(); q.box(0.9, 0.12, L, 0, 0.4, 0, g(1)).box(0.9, 0.12, L, 0, -0.4, 0, g(0.9)).box(0.14, 0.8, L, 0, 0, 0, g(0.7));
    const geo = q.build(); geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ'))); geo.translate(x, y, z); b.g.push(geo);
  }
  b.box(1.6, 0.7, 1.4, 0.3, 0.35, 4.6, g(0.5), 0.2, 0.5, 0);
  return b.build();
}
function geoBarricade() {
  const b = new Builder();
  for (const [x, z] of [[-2.6, 0.3], [0, -0.4], [2.7, 0.2]]) for (const [rx, rz] of [[0.78, 0], [-0.78, 0.4], [0, 1.2]]) b.box(0.26, 2.9, 0.26, x, 1.0, z, g(0.55), rx, rnd() * 0.5, rz);
  b.box(2.8, 1.0, 0.9, -1.4, 0.5, -2.2, g(1), 0, 0.12, 0).box(2.8, 0.5, 0.5, -1.4, 1.2, -2.2, g(0.9), 0, 0.12, 0).box(2.8, 1.0, 0.9, 1.7, 0.5, -2.5, g(0.95), 0, -0.2, 0).box(2.8, 0.5, 0.5, 1.7, 1.2, -2.5, g(0.85), 0, -0.2, 0)
    .box(0.12, 1.2, 6.5, 0, 1.3, 1.6, g(0.3), 0, HP, 0);
  return b.build();
}
function geoCrates() {
  const b = new Builder();
  for (const [x, y, z, s, r] of [[0, 0.7, 0, 1.4, 0.2], [1.6, 0.6, 0.4, 1.2, 0.8], [0.3, 1.95, 0.1, 1.1, 0.5], [-1.7, 0.55, -0.8, 1.1, 1.2], [0.9, 0.5, -1.9, 1.0, 0.1]]) { b.box(s, s, s, x, y, z, g(rr(0.8, 1.1)), 0, r, 0).box(s * 1.04, s * 0.14, s * 1.04, x, y, z, g(0.45), 0, r, 0); }
  b.box(1.3, 1.3, 1.3, -0.6, 0.5, 1.9, g(0.9), 0.5, 0.3, 0.9).cyl(0.48, 0.48, 1.15, 2.3, 0.57, -1.0, g(0.6), 0, 0, 0, 8).cyl(0.48, 0.48, 1.15, -2.2, 0.48, 0.9, g(0.55), HP, 0.7, 0, 8);
  return b.build();
}
function geoCrater() {
  const b = new Builder();
  b.cyl(2.3, 4.0, 0.45, 0, 0.22, 0, g(0.75), 0, 0, 0, 10).cyl(2.0, 2.2, 0.1, 0, 0.42, 0, g(0.12), 0, 0, 0, 10);
  for (let k = 0; k < 6; k++) { const a = rnd() * 6.28, r = rr(3.4, 5.2); b.box(rr(0.4, 1), rr(0.3, 0.6), rr(0.4, 1), Math.cos(a) * r, 0.2, Math.sin(a) * r, g(rr(0.6, 1)), rnd(), rnd() * 3, rnd()); }
  return b.build();
}

const PAINT = [[0.62, 0.45, 0.16], [0.52, 0.14, 0.1], [0.26, 0.34, 0.44], [0.62, 0.58, 0.48], [0.2, 0.36, 0.24]];
// burnt: rust and char, a third of them with the old paint still showing through
const BURNT = () => { const v = rr(0.13, 0.26), c = [v * 1.55, v * 0.8, v * 0.5]; if (rnd() < 0.35) { const q = pick(PAINT); for (let i = 0; i < 3; i++) c[i] = c[i] * 0.55 + q[i] * 0.4; } return c; };
const STONE = () => { const v = rr(0.22, 0.36), w = rr(-0.02, 0.03); return [v + w, v, v - w]; };
const KINDS = {
  car: { geo: geoCar, r: 2.4, vehicle: true }, hauler: { geo: geoHauler, r: 4.2, vehicle: true }, carrier: { geo: geoCarrier, r: 6, vehicle: true },
  rubble: { geo: geoRubble, r: 3 }, masonry: { geo: geoMasonry, r: 3.4 }, girder: { geo: geoGirder, r: 4.5 }, barricade: { geo: geoBarricade, r: 3.6 }, crates: { geo: geoCrates, r: 2.6 }, crater: { geo: geoCrater, r: 4, flat: true },
};

export class Streets {
  constructor(G) {
    this.G = G; this.items = []; this.grid = new Map(); this.dirty = new Set();
    const city = G.city, items = this.items;
    const free = (x, z, r) => { _p.set(x, 0, z); if (city.collideCircle(_p, r * 0.6 + 1.2)) return false; if (Math.hypot(x - 40, z - 205) < 16) return false; for (const o of this.near(x, z, r + 2)) if (Math.hypot(o.x - x, o.z - z) < r + o.r * 0.8) return false; return true; };
    const add = (kind, x, z, yaw, col, s = 1) => {
      const K = KINDS[kind]; if (!free(x, z, K.r * s)) return null;
      const it = { kind, x, z, yaw, s, sy: 1, y: 0, r: K.r * s, col, alive: !K.flat, idx: 0 }; items.push(it);
      const k = this.key(x, z); let cell = this.grid.get(k); if (!cell) this.grid.set(k, cell = []); cell.push(it); return it;
    };
    const vehicle = (x, z, along) => {
      const k = rnd(), kind = k < 0.66 ? 'car' : k < 0.9 ? 'hauler' : 'carrier', burnt = rnd() < 0.82;
      const skew = rnd() < 0.3 ? rr(-1.2, 1.2) : rr(-0.15, 0.15);
      const it = add(kind, x, z, along + (rnd() < 0.5 ? Math.PI : 0) + skew, burnt ? BURNT() : pick(PAINT).map(v => v * rr(0.75, 1.1)));
      if (it) { it.burnt = burnt; if (burnt && rnd() < 0.25) { it.tilt = rr(-0.3, 0.3); } }
      return it;
    };
    const debris = (x, z) => {
      const k = rnd();
      if (k < 0.27) add('rubble', x, z, rnd() * 6.28, STONE(), rr(1.0, 2.2));
      else if (k < 0.5) add('masonry', x, z, rnd() * 6.28, STONE(), rr(1.6, 2.8));   // walker-scale: statue torsos 4-7 m, column drums 3-5 m across
      else if (k < 0.63) add('girder', x, z, rnd() * 6.28, [0.36, 0.17, 0.09], rr(1.3, 2.2));
      else if (k < 0.73) add('barricade', x, z, rr(-0.3, 0.3) + (rnd() < 0.5 ? HP : 0), [0.36, 0.36, 0.34], rr(1.1, 1.5));
      else if (k < 0.86) add('crates', x, z, rnd() * 6.28, [0.42, 0.3, 0.16], rr(1, 1.4));
      else add('crater', x, z, rnd() * 6.28, [0.2, 0.18, 0.16], rr(0.9, 1.9));
    };
    // north-south lanes and avenues: traffic abandoned in file along the kerbs, debris anywhere on the carriageway
    const reach = (x, z, dx, dz) => { let k = 2; while (k < 34 && !city.solid(x + dx * k, 1, z + dz * k)) k += 2; return k - 2; };
    const fill = (x, z, dx, dz, along) => {   // one slice across a road at (x, z); (dx, dz) points across it
      const a = reach(x, z, dx, dz), b = reach(x, z, -dx, -dz), w = a + b; if (w < 6) return;
      for (let n = Math.max(1, Math.round(w / 13)); n > 0; n--) {
        if (rnd() < 0.58) { const kerb = rnd() < 0.7, o = kerb ? (rnd() < 0.5 ? a - rr(2.5, 5) : -b + rr(2.5, 5)) : rr(-b + 3, a - 3); vehicle(x + dx * o, z + dz * o, along); }
        else { const o = rr(-b + 2, a - 2); debris(x + dx * o, z + dz * o); }
      }
    };
    for (const road of [-288, -180, -108, 0, 108, 180, 288]) for (let z = -570; z < 570; z += rr(9, 16)) fill(road, z, 1, 0, 0);
    // east-west cross streets
    for (let j = -8; j < 8; j++) for (let x = -330; x < 330; x += rr(9, 16)) fill(x, 36 + j * 72, 0, 1, HP);
    // meshes
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.3;'); };   // never fully lost in the murk
    this.mesh = {};
    for (const kind in KINDS) {
      const list = items.filter(o => o.kind === kind); if (!list.length) continue;
      const mesh = this.mesh[kind] = new THREE.InstancedMesh(KINDS[kind].geo(), mat, list.length); mesh.frustumCulled = false;
      list.forEach((it, i) => { it.idx = i; this.setMatrix(it); mesh.setColorAt(i, _c.setRGB(it.col[0], it.col[1], it.col[2])); });
      G.scene.add(mesh);
    }
    // a few wrecks still burn
    // some wrecks still burn: fire + smoke emitter, and a bed of glowing embers through the frame
    const burning = items.filter(it => it.burnt && Math.abs(it.z) < 500 && rnd() < 0.13).slice(0, 34);
    const eb = new Builder(); for (let k = 0; k < 9; k++) eb.box(rr(0.25, 0.7), rr(0.15, 0.4), rr(0.25, 0.8), rr(-0.9, 0.9), rr(0.35, 1.5), rr(-2, 2), [2.6, rr(0.5, 1.0), 0.12]);
    this.embers = new THREE.InstancedMesh(eb.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), Math.max(1, burning.length)); this.embers.frustumCulled = false; G.scene.add(this.embers);
    burning.forEach((it, i) => { it.ember = i; this.setEmber(it); G.fx.addEmitter(it.x, it.kind === 'car' ? 1.6 : 2.6, it.z, it.kind === 'car' ? rr(1.2, 1.8) : rr(1.8, 2.6)); });
    this.fires = burning.length;
    this.counts = {}; for (const it of items) this.counts[it.kind] = (this.counts[it.kind] || 0) + 1;
  }
  key(x, z) { return Math.floor(x / CELL) * 4096 + Math.floor(z / CELL); }
  near(x, z, r) {
    const out = [], i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const c = this.grid.get(i * 4096 + j); if (c) for (const o of c) out.push(o); }
    return out;
  }
  setEmber(it) { const k = it.kind === 'car' ? 1 : it.kind === 'hauler' ? 1.5 : 2.2; _q.setFromEuler(_e.set(0, it.yaw, 0)); _m.compose(_p.set(it.x, it.alive ? (k - 1) * 0.5 : 0, it.z), _q, _s.set(k, it.alive ? k : 0.3, k * (it.kind === 'carrier' ? 1.6 : 1))); this.embers.setMatrixAt(it.ember, _m); this.embers.instanceMatrix.needsUpdate = true; }
  setMatrix(it) {
    _q.setFromEuler(_e.set(it.tilt || 0, it.yaw, it.roll || 0, 'YXZ')); _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.s * (it.wide || 1), it.s * it.sy, it.s * (it.wide || 1)));
    this.mesh[it.kind].setMatrixAt(it.idx, _m); this.dirty.add(it.kind);
  }
  // flatten whatever lies within r of (x, z); (vx, vz) is the velocity of the thing that trod on it, which shoves the wreck along
  crush(x, z, r, vx = 0, vz = 0) {
    let n = 0; const G = this.G;
    for (const it of this.near(x, z, r + 6)) {
      if (!it.alive) continue; const d = Math.hypot(it.x - x, it.z - z); if (d > r + it.r * 0.45) continue;
      it.alive = false; n++;
      const veh = KINDS[it.kind].vehicle, sp = Math.hypot(vx, vz);
      it.sy = veh ? 0.3 : 0.38; it.wide = veh ? 1.12 : 1.2; it.tilt = 0; it.roll = veh ? (rnd() - 0.5) * 0.12 : 0;
      if (sp > 2) { const k = Math.min(5, sp * 0.16) / sp; it.x += vx * k; it.z += vz * k; it.yaw += (rnd() - 0.5) * 1.2; }
      this.setMatrix(it); if (it.ember !== undefined) this.setEmber(it);
      const cd = G.fx.camDist(it.x, 1, it.z);
      if (cd < 260) { if (veh) { G.fx.sparks(it.x, 1, it.z, 8, 12); G.fx.debris(it.x, 1, it.z, 3, 0.6, 10, 0.08); } else G.fx.dust(it.x, 0.6, it.z, 1.6, 3, 0.16, 0.4); if (cd < 70) G.sfx.crunch(veh ? 0.35 : 0.2); }
    }
    return n;
  }
  update(dt) {
    // tank tracks grind wrecks flat as the armour advances
    this.n = (this.n | 0) + 1;
    if ((this.n & 3) === 0) for (const t of this.G.units.tanks) if (t.alive) this.crush(t.x, t.z, 2.6, 0, t.dir * 8);
    // infantry step round intact wrecks: an eighth of the troopers are checked each frame against their own grid cell,
    // and the push goes into the trooper's formation slot as well so he does not walk straight back in
    const u = this.G.units, X = u.x, Z = u.z;
    for (let i = this.n & 7; i < u.N; i += 8) {
      if (u.state[i] !== 0) continue; const cell = this.grid.get(this.key(X[i], Z[i])); if (!cell) continue;
      for (const it of cell) {
        if (!it.alive || !KINDS[it.kind].vehicle) continue; const dx = X[i] - it.x, dz = Z[i] - it.z, r = it.r * 0.75, d2 = dx * dx + dz * dz; if (d2 > r * r || d2 < 1e-4) continue;
        const d = Math.sqrt(d2), k = (r - d) / d; X[i] += dx * k; Z[i] += dz * k; u.ox[i] = clamp(u.ox[i] + dx * k, -10, 10); u.oz[i] = clamp(u.oz[i] + dz * k, -10, 10);
      }
    }
    if (this.dirty.size) { for (const k of this.dirty) this.mesh[k].instanceMatrix.needsUpdate = true; this.dirty.clear(); }
  }
}
