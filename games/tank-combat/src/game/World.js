// World: terrain access, collider registry (circles + oriented boxes in XZ) and ray/segment queries.
// Static colliders live in a uniform grid; dynamic ones (tanks, future targets) are checked directly.
// Box orientation uses the tank convention: forward = (sin h, cos h), local +x = (cos h, -sin h).
import { Vector3 } from 'three';
import { PLAY_HALF } from '../environment/Terrain.js';

const CELL = 40;
const GN = 50; // 2000 / 40
const OFF = 1000;

const cellOf = (v) => {
  const i = Math.floor((v + OFF) / CELL);
  return i < 0 ? 0 : i >= GN ? GN - 1 : i;
};

function segCircle(ax, az, bx, bz, cx, cz, r, out) {
  const dx = bx - ax, dz = bz - az;
  const fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) { out.nx = fx; out.nz = fz; return 0; } // starts inside
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return -1;
  out.nx = fx + dx * t; out.nz = fz + dz * t;
  return t;
}

function segBox(ax, az, bx, bz, box, out) {
  const c = box.cos, s = box.sin;
  const px = ax - box.x, pz = az - box.z;
  const lax = px * c - pz * s, laz = px * s + pz * c;
  const qx = bx - box.x, qz = bz - box.z;
  const lbx = qx * c - qz * s, lbz = qx * s + qz * c;
  const dx = lbx - lax, dz = lbz - laz;
  let t0 = 0, t1 = 1, nlx = 0, nlz = 0;
  // x slab
  if (Math.abs(dx) < 1e-9) { if (Math.abs(lax) > box.hx) return -1; }
  else {
    let ta = (-box.hx - lax) / dx, tb = (box.hx - lax) / dx, n = -1;
    if (ta > tb) { const t = ta; ta = tb; tb = t; n = 1; }
    if (ta > t0) { t0 = ta; nlx = n; nlz = 0; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (Math.abs(laz) > box.hz) return -1; }
  else {
    let ta = (-box.hz - laz) / dz, tb = (box.hz - laz) / dz, n = -1;
    if (ta > tb) { const t = ta; ta = tb; tb = t; n = 1; }
    if (ta > t0) { t0 = ta; nlx = 0; nlz = n; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  if (nlx === 0 && nlz === 0) { // started inside
    out.nx = -(bx - ax); out.nz = -(bz - az);
    return 0;
  }
  // local normal -> world: world = lx * (c, -s) + lz * (s, c)
  out.nx = nlx * c + nlz * s;
  out.nz = -nlx * s + nlz * c;
  return t0;
}

export class World {
  constructor(terrain) {
    this.terrain = terrain;
    this.half = PLAY_HALF - 10;
    this.cells = Array.from({ length: GN * GN }, () => []);
    this.dynamics = [];
    this.statics = [];
    this._res = [];
    this._qid = 0;
    this._tmp = { nx: 0, nz: 0 };
    this._nv = new Vector3();
    this._explosionListeners = [];
    this.route = terrain.getRoute();
    this.landmarks = {}; // filled by environment builders (hill, village, barn ...)
    this.targets = new Map(); // damageable target placeholders (id -> target), wired to missions/AI in Phase B
    this._targetListeners = [];
    this.smokeAnchors = []; // { pos: Vector3, flame: bool, strength } ambient smoke/fire sources (wrecks, burnt houses)
  }

  // ---- colliders ----
  _finish(c) {
    if (c.type === 0) {
      c.minX = c.x - c.r; c.maxX = c.x + c.r; c.minZ = c.z - c.r; c.maxZ = c.z + c.r;
    } else {
      c.cos = Math.cos(c.heading); c.sin = Math.sin(c.heading);
      const ex = Math.abs(c.cos) * c.hx + Math.abs(c.sin) * c.hz;
      const ez = Math.abs(c.sin) * c.hx + Math.abs(c.cos) * c.hz;
      c.minX = c.x - ex; c.maxX = c.x + ex; c.minZ = c.z - ez; c.maxZ = c.z + ez;
    }
    return c;
  }

  _insert(c) {
    if (c.dynamic) { this.dynamics.push(c); return; }
    const i0 = cellOf(c.minX), i1 = cellOf(c.maxX), j0 = cellOf(c.minZ), j1 = cellOf(c.maxZ);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * GN + i].push(c);
    this.statics.push(c);
  }

  _base(opts, x, z) {
    const y0 = opts.y0 !== undefined ? opts.y0 : this.terrain.getHeight(x, z) - 1.5;
    return {
      y0, y1: y0 + (opts.height !== undefined ? opts.height : 8) + 1.5,
      owner: opts.owner || null, tag: opts.tag || 'static', dynamic: !!opts.dynamic,
      onHit: opts.onHit || null, qid: 0, active: true,
      // obstacle class: 'solid' (slide along it), 'crush' (tank knocks it down above minSpeed), 'climb' (hull rides over to `top`)
      cls: opts.cls || 'solid', onCrush: opts.onCrush || null, minSpeed: opts.minSpeed || 0, slow: opts.slow === undefined ? 0.9 : opts.slow,
      jolt: opts.jolt || 0, top: opts.top || 0, noRay: !!opts.noRay, mark: false,
    };
  }

  addCircle(x, z, r, opts = {}) {
    const c = Object.assign(this._base(opts, x, z), { type: 0, x, z, r });
    this._insert(this._finish(c));
    return c;
  }

  addBox(x, z, hx, hz, heading, opts = {}) {
    const c = Object.assign(this._base(opts, x, z), { type: 1, x, z, hx, hz, heading });
    this._insert(this._finish(c));
    return c;
  }

  // only valid for dynamic colliders
  moveCollider(c, x, z, heading, y0) {
    c.x = x; c.z = z;
    if (c.type === 1) c.heading = heading;
    if (y0 !== undefined) { c.y1 += y0 - c.y0; c.y0 = y0; }
    this._finish(c);
  }

  removeCollider(c) {
    c.active = false;
    const rm = (arr) => { const k = arr.indexOf(c); if (k >= 0) arr.splice(k, 1); };
    if (c.dynamic) { rm(this.dynamics); return; }
    const i0 = cellOf(c.minX), i1 = cellOf(c.maxX), j0 = cellOf(c.minZ), j1 = cellOf(c.maxZ);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) rm(this.cells[j * GN + i]);
    rm(this.statics);
  }

  // Shared result array: do not call reentrantly.
  query(x0, z0, x1, z1) {
    const res = this._res;
    res.length = 0;
    const id = ++this._qid;
    const i0 = cellOf(x0), i1 = cellOf(x1), j0 = cellOf(z0), j1 = cellOf(z1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const arr = this.cells[j * GN + i];
        for (let k = 0; k < arr.length; k++) {
          const c = arr[k];
          if (c.qid !== id) { c.qid = id; res.push(c); }
        }
      }
    }
    const d = this.dynamics;
    for (let k = 0; k < d.length; k++) {
      const c = d[k];
      if (c.maxX >= x0 && c.minX <= x1 && c.maxZ >= z0 && c.minZ <= z1) res.push(c);
    }
    return res;
  }

  // ---- hull resolution: box = { x, z, hx, hz, cos, sin } is pushed out of overlapping colliders ----
  // out: { hit, nx, nz, depth } where (nx, nz) is the push direction of the deepest contact
  collideOBB(box, ignoreOwner, out) {
    out.hit = false; out.nx = 0; out.nz = 0; out.depth = 0; out.climb = false;
    const crushed = out.crushed || (out.crushed = []);
    crushed.length = 0;
    const speedAbs = Math.abs(box.speed || 0);
    const ex = Math.abs(box.cos) * box.hx + Math.abs(box.sin) * box.hz;
    const ez = Math.abs(box.sin) * box.hx + Math.abs(box.cos) * box.hz;
    for (let iter = 0; iter < 3; iter++) {
      const list = this.query(box.x - ex, box.z - ez, box.x + ex, box.z + ez);
      let any = false;
      for (let k = 0; k < list.length; k++) {
        const c = list[k];
        if (c.owner && c.owner === ignoreOwner) continue;
        let nx = 0, nz = 0, pen = 0;
        if (c.type === 0) {
          // circle vs oriented box
          const dx = c.x - box.x, dz = c.z - box.z;
          const lx = dx * box.cos - dz * box.sin, lz = dx * box.sin + dz * box.cos;
          const qx = Math.max(-box.hx, Math.min(box.hx, lx)), qz = Math.max(-box.hz, Math.min(box.hz, lz));
          const ox = lx - qx, oz = lz - qz;
          const d2 = ox * ox + oz * oz;
          if (d2 > c.r * c.r) continue;
          let lnx, lnz;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2); pen = c.r - d; lnx = -ox / d; lnz = -oz / d;
          } else {
            const px = box.hx - Math.abs(lx), pz = box.hz - Math.abs(lz);
            if (px < pz) { lnx = lx > 0 ? -1 : 1; lnz = 0; pen = px + c.r; }
            else { lnx = 0; lnz = lz > 0 ? -1 : 1; pen = pz + c.r; }
          }
          nx = lnx * box.cos + lnz * box.sin;
          nz = -lnx * box.sin + lnz * box.cos;
        } else {
          // SAT, box vs box
          const a0x = box.cos, a0z = -box.sin, a1x = box.sin, a1z = box.cos;
          const b0x = c.cos, b0z = -c.sin, b1x = c.sin, b1z = c.cos;
          const dx = c.x - box.x, dz = c.z - box.z;
          let best = 1e9, bnx = 0, bnz = 0, sep = false;
          for (let ax = 0; ax < 4; ax++) {
            const Lx = ax === 0 ? a0x : ax === 1 ? a1x : ax === 2 ? b0x : b1x;
            const Lz = ax === 0 ? a0z : ax === 1 ? a1z : ax === 2 ? b0z : b1z;
            const rA = box.hx * Math.abs(a0x * Lx + a0z * Lz) + box.hz * Math.abs(a1x * Lx + a1z * Lz);
            const rB = c.hx * Math.abs(b0x * Lx + b0z * Lz) + c.hz * Math.abs(b1x * Lx + b1z * Lz);
            const dist = dx * Lx + dz * Lz;
            const ov = rA + rB - Math.abs(dist);
            if (ov <= 0) { sep = true; break; }
            if (ov < best) { best = ov; bnx = dist > 0 ? -Lx : Lx; bnz = dist > 0 ? -Lz : Lz; }
          }
          if (sep) continue;
          nx = bnx; nz = bnz; pen = best;
        }
        if (pen <= 0) continue;
        if (c.cls === 'climb') { out.climb = true; continue; } // the hull rides over low obstacles (see climbHeight)
        if (c.cls === 'crush' && speedAbs >= c.minSpeed) { if (!c.mark) { c.mark = true; crushed.push(c); } continue; }
        box.x += nx * pen; box.z += nz * pen;
        any = true;
        out.hit = true;
        if (pen > out.depth) { out.depth = pen; out.nx = nx; out.nz = nz; }
      }
      if (!any) break;
    }
    for (let k = 0; k < crushed.length; k++) crushed[k].mark = false;
    return out.hit || crushed.length > 0;
  }

  // knock a crushable collider down: removes it (no invisible obstacle remains) and runs its visual callback
  crushCollider(c, dirx, dirz, speed) {
    if (!c.active) return;
    this.removeCollider(c);
    if (c.onCrush) c.onCrush(c, dirx, dirz, speed);
  }

  // extra ground height from climbable obstacles at (x, z): a smooth ramp over the last 0.7 m so the hull pitches up and over
  climbHeight(x, z) {
    let best = 0;
    const list = this.query(x - 0.8, z - 0.8, x + 0.8, z + 0.8);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.cls !== 'climb') continue;
      let d;
      if (c.type === 0) d = Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
      else {
        const px = x - c.x, pz = z - c.z;
        const lx = Math.abs(px * c.cos - pz * c.sin) - c.hx, lz = Math.abs(px * c.sin + pz * c.cos) - c.hz;
        d = Math.hypot(Math.max(0, lx), Math.max(0, lz));
      }
      if (d >= 0.7) continue;
      const h = c.top * (1 - d / 0.7);
      if (h > best) best = h;
    }
    return best;
  }

  // ---- segment / ray queries ----
  // hit: { t, x, y, z, nx, ny, nz, kind: 'terrain' | 'collider', collider }
  raycastSegment(ax, ay, az, bx, by, bz, ignoreOwner, hit) {
    const T = this.terrain;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let bestT = 2, kind = null, bestC = null, nx = 0, nz = 0;

    // terrain
    const step = Math.min(10, Math.max(1.5, len / 300));
    const n = Math.max(1, Math.ceil(len / step));
    if (ay <= T.getHeight(ax, az)) { bestT = 0; kind = 'terrain'; }
    else {
      let prev = 0;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        if (ay + dy * t < T.getHeight(ax + dx * t, az + dz * t)) {
          let lo = prev, hi = t;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) * 0.5;
            if (ay + dy * m < T.getHeight(ax + dx * m, az + dz * m)) hi = m; else lo = m;
          }
          bestT = (lo + hi) * 0.5; kind = 'terrain';
          break;
        }
        prev = t;
      }
    }

    // colliders
    const list = this.query(Math.min(ax, bx) - 1, Math.min(az, bz) - 1, Math.max(ax, bx) + 1, Math.max(az, bz) + 1);
    const tmp = this._tmp;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c.owner && c.owner === ignoreOwner) continue;
      if (c.noRay) continue;
      const t = c.type === 0 ? segCircle(ax, az, bx, bz, c.x, c.z, c.r, tmp) : segBox(ax, az, bx, bz, c, tmp);
      if (t < 0 || t >= bestT) continue;
      const y = ay + dy * t;
      if (y < c.y0 || y > c.y1) continue;
      bestT = t; kind = 'collider'; bestC = c; nx = tmp.nx; nz = tmp.nz;
    }

    if (!kind) return false;
    hit.t = bestT;
    hit.x = ax + dx * bestT; hit.y = ay + dy * bestT; hit.z = az + dz * bestT;
    hit.kind = kind; hit.collider = bestC;
    if (kind === 'terrain') {
      const nv = T.getNormal(hit.x, hit.z, this._nv);
      hit.nx = nv.x; hit.ny = nv.y; hit.nz = nv.z;
    } else {
      const l = Math.hypot(nx, nz) || 1;
      hit.nx = nx / l; hit.ny = 0; hit.nz = nz / l;
    }
    hit.dist = bestT * len;
    return true;
  }

  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignoreOwner, hit) {
    return this.raycastSegment(ox, oy, oz, ox + dx * maxDist, oy + dy * maxDist, oz + dz * maxDist, ignoreOwner, hit);
  }

  // ---- damageable target placeholder: { id, hp, maxHp, alive, collider, position, kind } ----
  // Projectile hits on the collider call damageTarget() with the round's damage; listeners get 'damaged'/'destroyed'.
  addTarget(id, { hp = 1000, collider, position = null, kind = 'structure', data = null }) {
    const t = { id, hp, maxHp: hp, alive: true, collider, position, kind, data };
    this.targets.set(id, t);
    if (collider) collider.onHit = (hit, proj) => this.damageTarget(id, (proj && proj.def && proj.def.damage) || 0, hit, proj);
    return t;
  }

  damageTarget(id, amount, hit = null, source = null) {
    const t = this.targets.get(id);
    if (!t || !t.alive || amount <= 0) return t;
    t.hp = Math.max(0, t.hp - amount);
    const destroyed = t.hp <= 0;
    if (destroyed) t.alive = false;
    for (const fn of this._targetListeners) fn({ type: destroyed ? 'destroyed' : 'damaged', target: t, amount, hit, source });
    return t;
  }

  onTarget(fn) { this._targetListeners.push(fn); }

  // ---- events for gameplay systems (enemies, damage) ----
  onExplosion(fn) { this._explosionListeners.push(fn); }
  emitExplosion(info) { for (const fn of this._explosionListeners) fn(info); }
}
