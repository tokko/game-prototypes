// Regiments: stats, orders, movement, soldier slots, instanced rendering, banners, rings, army setup.
import * as THREE from 'three';
import { layout, defaultFiles, fileRange } from './formations.js';
import { HALF } from './terrain.js';

export const SCALE = 2.1;
export const SIDE_COLOR = { player: '#b32a2a', enemy: '#2c4fa0' };

export const TYPES = {
  line: { id: 'line', name: 'Line Infantry', short: 'Line', men: 160, formation: 'grid', ranks: 4, sx: 1.15, sz: 1.7, kind: 'line',
    walk: 3.6, run: 6, turn: 1.1, range: 150, reload: 8, acc: 0.13, arc: 0.8, fireFrac: 0.67, ma: 6, md: 6, charge: 0.1, morale: 85, frag: 1.5 },
  rifle: { id: 'rifle', name: 'Riflemen', short: 'Rifles', men: 60, formation: 'grid', ranks: 2, sx: 2.8, sz: 3.0, kind: 'rifle', loose: true,
    walk: 4.5, run: 7.5, turn: 1.8, range: 220, reload: 10, acc: 0.2, arc: 1.2, fireFrac: 1.0, ma: 3, md: 3, charge: 0.05, morale: 70, frag: 1.6, meleeMorale: 2 },
  pike: { id: 'pike', name: 'Pike & Shot Tercio', short: 'Tercio', men: 260, formation: 'tercio', pikeFrac: 0.62, sx: 1.15, sz: 1.35, msx: 1.15, msz: 1.6,
    walk: 2.8, run: 4.5, turn: 0.7, range: 110, reload: 11, acc: 0.11, arc: 1.0, fireFrac: 1.0, ma: 7, md: 9, charge: 0.05, antiCav: true, morale: 90, frag: 1.2 },
  lcav: { id: 'lcav', name: 'Light Cavalry', short: 'Hussars', men: 60, formation: 'grid', ranks: 3, sx: 1.6, sz: 3.4, kind: 'lrider', cav: true, caracole: true,
    walk: 7, run: 14, turn: 2.5, range: 45, reload: 9, acc: 0.16, arc: 1.0, fireFrac: 0.8, ma: 6, md: 4, charge: 0.35, morale: 75, frag: 1.5 },
  hcav: { id: 'hcav', name: 'Heavy Cavalry (Lancers)', short: 'Lancers', men: 48, formation: 'grid', ranks: 3, sx: 1.75, sz: 3.7, kind: 'hrider', cav: true,
    walk: 6, run: 13, turn: 1.7, range: 0, reload: 0, acc: 0, arc: 0, fireFrac: 0, ma: 4.5, md: 6, charge: 0.9, morale: 85, frag: 1.3 },
  artillery: { id: 'artillery', name: 'Artillery Battery', short: 'Guns', men: 20, formation: 'battery', guns: 4, kind: 'crew',
    walk: 1.8, run: 2.5, turn: 0.6, range: 320, canister: 60, reload: 12, acc: 0, arc: 0.6, fireFrac: 0, ma: 1.5, md: 1, charge: 0, morale: 90, frag: 0.6, deploy: 4 },
};

export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function edgeDist(r, px, pz) {
  const c = Math.cos(r.facing), s = Math.sin(r.facing), dx = px - r.x, dz = pz - r.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.hypot(lx - clamp(lx, -r.halfW, r.halfW), lz - clamp(lz, -r.halfD, r.halfD));
}
export const rangeTo = (a, t) => Math.max(0, edgeDist(t, a.x, a.z) - a.halfD * 0.5);
export function pointInOBB(r, px, pz, margin = 0) {
  const c = Math.cos(r.facing), s = Math.sin(r.facing), dx = px - r.x, dz = pz - r.z;
  return Math.abs(dx * c - dz * s) <= r.halfW + margin && Math.abs(dx * s + dz * c) <= r.halfD + margin;
}
export function obbOverlap(a, b, margin) {
  const ca = Math.cos(a.facing), sa = Math.sin(a.facing), cb = Math.cos(b.facing), sb = Math.sin(b.facing);
  const axes = [[ca, -sa], [sa, ca], [cb, -sb], [sb, cb]];
  const dx = b.x - a.x, dz = b.z - a.z;
  let best = 1e9, nx = 0, nz = 0;
  for (const [ux, uz] of axes) {
    const ra = a.halfW * Math.abs(ux * ca - uz * sa) + a.halfD * Math.abs(ux * sa + uz * ca);
    const rb = b.halfW * Math.abs(ux * cb - uz * sb) + b.halfD * Math.abs(ux * sb + uz * cb);
    const proj = dx * ux + dz * uz;
    const ov = ra + rb + margin - Math.abs(proj);
    if (ov <= 0) return null;
    if (ov < best) { best = ov; const sg = proj >= 0 ? 1 : -1; nx = ux * sg; nz = uz * sg; }
  }
  return { depth: best, nx, nz };
}

export class Regiment {
  constructor(id, side, typeId, name, x, z, facing) {
    this.id = id; this.side = side; this.typeId = typeId; this.def = TYPES[typeId]; this.name = name;
    this.x = x; this.z = z; this.facing = facing;
    this.maxMen = this.def.men; this.men = this.maxMen;
    this.morale = this.def.morale; this.state = 'steady';
    this.order = { type: 'idle' }; this.run = false; this.fireAtWill = true;
    this.speedNow = 0; this.moving = false; this.selected = false;
    this.reloadT = 3 + Math.random() * 4; this.aimT = 0; this.aimTarget = null; this.canShoot = false;
    this.deployT = this.def.deploy || 0;
    this.engaged = 0; this.contacts = []; this.prevContacts = new Set(); this.meleeAcc = 0;
    this.lastHit = -99; this.spacing = 1; this.formationMode = 'normal';
    this.guns = 0; this.dirty = true; this.group = 0;
    this.soldiers = [];
    const np = this.def.formation === 'tercio' ? Math.round(this.maxMen * this.def.pikeFrac) : 0;
    for (let i = 0; i < this.maxMen; i++) {
      this.soldiers.push({ x: 0, z: 0, yaw: facing, role: this.def.formation === 'tercio' ? (i < np ? 'pike' : 'musk') : 'all', slot: 0,
        phase: Math.random() * 6.28, jx: Math.random() - 0.5, jz: Math.random() - 0.5, hv: Math.floor(Math.random() * 3), mv: false });
    }
    this.files = defaultFiles(this.def, this.maxMen);
    this.updateLayout();
    for (const s of this.soldiers) { const t = this.slotWorld(s); s.x = t[0]; s.z = t[1]; }
  }
  get active() { return this.state !== 'gone' && this.state !== 'routing'; }
  get radius() { return Math.hypot(this.halfW, this.halfD); }
  updateLayout() {
    const counts = { all: 0, pike: 0, musk: 0, guns: 0 };
    for (const s of this.soldiers) {
      if (s.role === 'all') s.slot = counts.all++;
      else if (s.role === 'pike') s.slot = counts.pike++;
      else s.slot = counts.musk++;
    }
    if (this.def.formation === 'battery') { this.guns = Math.min(this.def.guns, Math.ceil(this.men / 4)); counts.guns = this.guns; }
    this.layout = layout(this.def, counts, this.files, this.spacing);
    this.halfW = this.layout.halfW; this.halfD = this.layout.halfD;
    this.dirty = false;
  }
  slotWorld(s) {
    const arr = this.layout[s.role];
    let lx = arr[s.slot * 2], lz = arr[s.slot * 2 + 1];
    if (lx === undefined) { lx = 0; lz = 0; }
    if (this.def.loose) { lx += s.jx * this.def.sx * 0.7; lz += s.jz * this.def.sz * 0.6; }
    const c = Math.cos(this.facing), sn = Math.sin(this.facing);
    return [this.x + c * lx + sn * lz, this.z - sn * lx + c * lz];
  }
  setFiles(f) { const [a, b] = fileRange(this.def, this.maxMen); this.files = clamp(Math.round(f), a, b); this.dirty = true; }
  setSpacing(mode) {
    this.formationMode = mode === this.formationMode ? 'normal' : mode;
    this.spacing = this.formationMode === 'tight' ? 0.8 : this.formationMode === 'loose' ? 1.5 : 1;
    this.dirty = true;
  }
  removeSoldier(i) {
    const s = this.soldiers[i];
    this.soldiers[i] = this.soldiers[this.soldiers.length - 1]; this.soldiers.pop();
    this.men = this.soldiers.length; this.dirty = true;
    return s;
  }

  // ---- orders
  cmdMove(x, z, face = null, files = null, run = false) {
    if (this.state === 'routing' || this.state === 'gone') return;
    this.order = { type: 'move', x: clamp(x, -HALF + 8, HALF - 8), z: clamp(z, -HALF + 8, HALF - 8), face };
    this.run = run;
    if (files) this.setFiles(files);
  }
  cmdAttack(t, run) {
    if (this.state === 'routing' || this.state === 'gone') return;
    this.order = { type: 'attack', target: t }; if (run !== undefined) this.run = run;
  }
  cmdHalt() { if (this.state === 'routing') return; this.order = { type: 'idle' }; this.run = false; }

  // ---- movement (called every sim step)
  update(dt, w) {
    if (this.state === 'gone') return;
    const def = this.def;
    let dest = null, maxSp = 0, wantFace = null, stopAt = 0.8, crab = false;
    if (this.state === 'routing') {
      const ez = this.side === 'player' ? HALF - 4 : -HALF + 4;
      dest = [clamp(this.x, -HALF + 20, HALF - 20), ez]; maxSp = def.run * 1.05; stopAt = 2;
    } else if (this.order.type === 'move') {
      dest = [this.order.x, this.order.z]; maxSp = this.run ? def.run : def.walk;
      if (this.order.face !== null && Math.hypot(dest[0] - this.x, dest[1] - this.z) < 14) { wantFace = this.order.face; crab = true; }
    } else if (this.order.type === 'attack') {
      let t = this.order.target;
      if (t && t.state === 'gone' && this.side === 'player') {   // target destroyed/fled: keep attacking the nearest foe (AI manages its own retargeting)
        let bd = 1e9; t = null;
        for (const e of w.regs) {
          if (e.side === this.side || e.state === 'gone') continue;
          const d = Math.hypot(e.x - this.x, e.z - this.z); if (d < bd) { bd = d; t = e; }
        }
        if (t) this.order.target = t;
      }
      if (!t || t.state === 'gone') { this.order = { type: 'idle' }; }
      else {
        const d = rangeTo(this, t);
        const melee = this.run || def.range === 0;
        const reloading = this.reloadT > 0;
        if (melee) { dest = [t.x, t.z]; maxSp = def.run; stopAt = 0.5; }
        else if (def.caracole && reloading && d < def.range * 1.5 && this.engaged === 0) {
          const dd = Math.max(1, Math.hypot(this.x - t.x, this.z - t.z));
          dest = [this.x + (this.x - t.x) / dd * 40, this.z + (this.z - t.z) / dd * 40]; maxSp = def.run * 0.7;
        } else if (!(def.caracole && reloading) && d > def.range * 0.85) { dest = [t.x, t.z]; maxSp = def.walk; stopAt = 2; }
        else wantFace = Math.atan2(t.x - this.x, t.z - this.z);
      }
    }
    // artillery: limber / deploy
    let blocked = false;
    if (def.id === 'artillery') {
      if (dest) { this.deployT = Math.max(0, this.deployT - dt); if (this.deployT > 0) blocked = true; }
      else this.deployT = Math.min(def.deploy, this.deployT + dt);
    }
    if (this.engaged > 0 && !dest && this.contacts[0]) wantFace = Math.atan2(this.contacts[0].x - this.x, this.contacts[0].z - this.z);
    if (!dest && !wantFace && this.state !== 'routing' && def.range > 0 && this.aimTarget && !this.canShoot && this.order.type !== 'move' && this.fireAtWill)
      wantFace = Math.atan2(this.aimTarget.x - this.x, this.aimTarget.z - this.z);

    let v = 0;
    if (dest && !blocked) {
      const dx = dest[0] - this.x, dz = dest[1] - this.z, dist = Math.hypot(dx, dz);
      if (dist < stopAt && this.state !== 'routing') {
        if (this.order.type === 'move') { if (this.order.face !== null) wantFace = this.order.face; this.order = { type: 'idle' }; }
      } else {
        const desired = Math.atan2(dx, dz);
        const target = crab ? wantFace : desired;
        const diff = wrapAngle(target - this.facing);
        this.facing += clamp(diff, -def.turn * dt, def.turn * dt);
        const diffTravel = crab ? 0 : Math.abs(diff);
        v = maxSp * clamp(1 - diffTravel / 1.1, 0.12, 1);
        wantFace = null;
        this.speedNow += (v - this.speedNow) * Math.min(1, dt * 2.5);
        const step = Math.min(this.speedNow * dt, dist);
        this.x += dx / dist * step; this.z += dz / dist * step;
      }
    } else if (blocked) { this.speedNow *= 0.9; }
    if (!(dest && !blocked)) this.speedNow += (0 - this.speedNow) * Math.min(1, dt * 4);
    if (wantFace !== null && !(dest && !blocked)) {
      const diff = wrapAngle(wantFace - this.facing);
      this.facing += clamp(diff, -def.turn * dt, def.turn * dt);
    }
    if (this.state !== 'routing') { this.x = clamp(this.x, -HALF + 6, HALF - 6); this.z = clamp(this.z, -HALF + 6, HALF - 6); }
    this.moving = this.speedNow > 0.4;
    if (this.state === 'routing' && Math.abs(this.z) > HALF - 8 && (this.side === 'player') === (this.z > 0)) { this.state = 'gone'; this.fled = true; }
  }

  updateSoldiers(dt, time) {
    if (this.dirty) this.updateLayout();
    const routing = this.state === 'routing';
    for (const s of this.soldiers) {
      const t = this.slotWorld(s);
      const dx = t[0] - s.x, dz = t[1] - s.z, d = Math.hypot(dx, dz);
      if (d > 0.02) {
        const sp = this.speedNow * 1.1 + 1.0 + d * 1.0 + (routing ? 3 : 0);
        const step = Math.min(d, Math.min(sp, 16) * dt);
        s.x += dx / d * step; s.z += dz / d * step;
      }
      s.mv = d > 0.5 || (this.moving && !s.hold);
      const want = (d > 1.5 || routing) ? Math.atan2(dx, dz) : this.facing;
      s.yaw += wrapAngle(want - s.yaw) * Math.min(1, dt * 8);
    }
  }
}

// ---- rendering of soldiers (instanced) ---------------------------------------------
export class UnitRenderer {
  constructor(scene, models, world) {
    this.scene = scene; this.world = world; this.meshes = {};
    const cap = {};
    const add = (k, n) => { cap[k] = (cap[k] || 0) + n; };
    for (const r of world.regs) {
      const d = r.def;
      if (d.formation === 'tercio') { add(`${r.side}_pike`, r.maxMen); add(`${r.side}_musk`, r.maxMen); }
      else add(`${r.side}_${d.kind}`, r.maxMen);
      if (d.cav) for (let i = 0; i < 3; i++) add(`horse${i}`, r.maxMen);
      if (d.formation === 'battery') add('cannon', d.guns);
    }
    for (const side of ['player', 'enemy']) { add(`${side}_officer`, 1); for (let i = 0; i < 3; i++) add(`horse${i}`, 2); }
    this.uTime = models.uTime;
    // one hi + one lo (key@lo) InstancedMesh per figure type; GPU pose shader reads the per-instance iAnim attribute
    const make = (key, geo, mk) => {
      const n = Math.max(1, cap[key.replace('@lo', '')] || 1), g = geo.clone();
      const ia = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); ia.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iAnim', ia);
      const m = new THREE.InstancedMesh(g, models.mats[mk].mat, n);
      m.customDepthMaterial = models.mats[mk].depth;
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      m.iAnim = ia;
      this.meshes[key] = m; scene.add(m);
    };
    const matKind = (k) => /rider|officer/.test(k) ? 'rider' : 'infantry';
    for (const side of ['player', 'enemy']) for (const k of Object.keys(models.soldier[side])) {
      make(`${side}_${k}`, models.soldier[side][k], matKind(k));
      if (models.lod.soldier[side][k]) make(`${side}_${k}@lo`, models.lod.soldier[side][k], matKind(k));
    }
    models.horse.forEach((g, i) => { make(`horse${i}`, g, 'horse'); make(`horse${i}@lo`, models.lod.horse[i], 'horse'); });
    make('cannon', models.cannon, 'cannon');
    this.bannerGroup = new THREE.Group(); scene.add(this.bannerGroup);
    this.ringGroup = new THREE.Group(); scene.add(this.ringGroup);
    for (const r of world.regs) this.attach(r);
    this.tmpV = new THREE.Vector3();
  }
  attach(r) {
    r.banner = new Banner(r); this.bannerGroup.add(r.banner.sprite);
    r.ring = new Ring(0xe8c860, 0.9); r.targetRing = new Ring(0xd03030, 0.8); r.destRing = new Ring(0xe8c860, 0.4);
    for (const g of [r.ring, r.targetRing, r.destRing]) this.ringGroup.add(g.mesh);
  }
  // a0..a3 -> iAnim: walk cycle (rad), gait (speed / walk speed), aim/charge pose 0..1, recoil 0..1
  put(key, x, y, z, yaw, s, v = 1, a0 = 0, a1 = 0, a2 = 0, a3 = 0) {
    const m = this.meshes[key]; const i = m.count;
    if (i >= m.instanceMatrix.count) return;
    const ia = m.iAnim.array, q = i * 4; ia[q] = a0; ia[q + 1] = a1; ia[q + 2] = a2; ia[q + 3] = a3;
    const a = m.instanceMatrix.array, o = i * 16, c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s;
    a[o] = c; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = c; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    const ca = m.instanceColor.array; ca[i * 3] = ca[i * 3 + 1] = ca[i * 3 + 2] = v;
    m.count++;
  }
  update(time, camera, camDist) {
    const w = this.world, th = w.terrain;
    const dt = this.lastT === undefined ? 0 : Math.min(0.1, Math.max(0, time - this.lastT)); this.lastT = time;
    if (this.uTime) this.uTime.value = time;
    for (const k in this.meshes) this.meshes[k].count = 0;
    const TAU = Math.PI * 2, kA = Math.min(1, dt * 5);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, LOD2 = 230 * 230;
    for (const r of w.regs) {
      if (r.state === 'gone') continue;
      const d = r.def, cav = !!d.cav, routing = r.state === 'routing', tercio = d.formation === 'tercio';
      // volley detection (reload timer jumps up) drives the per-figure recoil and the gun recoil below
      if (r._rl !== undefined && r.reloadT > r._rl + 0.5) r._ft = time;
      r._rl = r.reloadT;
      const since = r._ft === undefined ? 99 : time - r._ft;
      const melee = !routing && (r.engaged > 0 || (r.order.type === 'attack' && (r.run || d.range === 0) && r.moving));
      const ready = !routing && d.range > 0 && r.fireAtWill && !!r.aimTarget && r.canShoot && !r.moving && r.engaged === 0 && r.reloadT < 2;
      const at = r.aimTarget;
      const pikeDown = melee || (!routing && !!at && at.state !== 'gone' && Math.hypot(at.x - r.x, at.z - r.z) < 70);
      const kMain = `${r.side}_${d.kind}`, kPike = `${r.side}_pike`, kMusk = `${r.side}_musk`;
      for (const s of r.soldiers) {
        const kind = tercio ? s.role : d.kind;
        const sp = s.mv ? (routing ? d.run : Math.max(r.speedNow, d.walk * 0.85)) : 0, gt = sp / d.walk;
        s._g = s._g === undefined ? gt : s._g + (gt - s._g) * kA;
        s._c = ((s._c === undefined ? s.phase : s._c) + dt * TAU * (cav ? 0.75 + 0.45 * s._g : 0.95 * s._g)) % (TAU * 1000);
        let aim = 0, rec = 0;
        if (cav) aim = melee ? 1 : 0;
        else if (kind === 'pike') aim = pikeDown ? 1 : 0;
        else if (kind !== 'crew' && !routing) {
          const stag = (s.phase % 1) * 0.9, tf = since - stag;   // shots ripple along the line
          aim = ready || since < stag + 0.7 ? 1 : 0;
          if (tf >= 0 && tf < 0.45) rec = 1 - tf / 0.45;
        }
        s._a = s._a === undefined ? aim : s._a + (aim - s._a) * kA;
        const y = th.heightAt(s.x, s.z);
        const ex = s.x - cx, ey = y - cy, ez = s.z - cz, lo = ex * ex + ey * ey + ez * ez > LOD2 ? '@lo' : '';
        const v = 0.86 + (s.phase % 1) * 0.28;   // per-figure tone variation
        const key = (tercio ? (kind === 'pike' ? kPike : kMusk) : kMain) + lo;
        if (cav) this.put(`horse${s.hv}${lo}`, s.x, y, s.z, s.yaw, SCALE, v, s._c, s._g, s._a, 0);
        this.put(key, s.x, y, s.z, s.yaw, SCALE, v, s._c, s._g, s._a, rec);
      }
      if (d.formation === 'battery') {
        const c = Math.cos(r.facing), sn = Math.sin(r.facing), g = r.layout.guns;
        for (let i = 0; i < r.guns; i++) {
          const lx = g[i * 2], lz = g[i * 2 + 1];
          const gx = r.x + c * lx + sn * lz, gz = r.z - sn * lx + c * lz;
          r.layout.gunWorld = r.layout.gunWorld || [];
          r.layout.gunWorld[i] = [gx, gz];
          const t = since - i * 0.35 - 0.3, rec = t >= 0 && t < 0.9 ? (1 - t / 0.9) ** 2 : 0;
          this.put('cannon', gx, th.heightAt(gx, gz), gz, r.facing, SCALE * 1.15, 1, 0, 0, 0, rec);
        }
      }
    }
    for (const gn of w.generals) {
      const y = th.heightAt(gn.x, gn.z);
      const sp = gn._px === undefined || dt <= 0 ? 0 : Math.hypot(gn.x - gn._px, gn.z - gn._pz) / dt;
      gn._px = gn.x; gn._pz = gn.z;
      const gt = sp > 0.3 ? sp / 5 : 0;
      gn._g = gn._g === undefined ? 0 : gn._g + (gt - gn._g) * kA;
      gn._c = ((gn._c || 0) + dt * TAU * (0.75 + 0.45 * gn._g)) % (TAU * 1000);
      this.put('horse1', gn.x, y, gn.z, gn.facing, SCALE * 1.05, 1, gn._c, gn._g, 0, 0);
      this.put(`${gn.side}_officer`, gn.x, y, gn.z, gn.facing, SCALE * 1.05, 1, gn._c, gn._g, 0, 0);
    }
    const upd = (a, n, c) => { a.clearUpdateRanges(); a.addUpdateRange(0, c * n); a.needsUpdate = true; };
    for (const k in this.meshes) {
      const m = this.meshes[k]; m.visible = m.count > 0;
      if (m.count) { upd(m.instanceMatrix, 16, m.count); upd(m.instanceColor, 3, m.count); upd(m.iAnim, 4, m.count); }
    }

    // banners & rings
    const sel = w.selection;
    const targeted = new Set();
    for (const r of sel) if (r.order.type === 'attack' && r.order.target) targeted.add(r.order.target);
    const thick = clamp(camDist * 0.004, 0.5, 2.5);
    for (const r of w.regs) {
      if (r.state === 'gone') { r.banner.sprite.visible = false; r.ring.mesh.visible = r.targetRing.mesh.visible = r.destRing.mesh.visible = false; continue; }
      r.banner.update(camDist, th, camera);
      if (r.selected) { r.ring.set(r.x, r.z, r.facing, r.halfW, r.halfD, th, thick); }
      else r.ring.mesh.visible = false;
      if (!r.selected && targeted.has(r)) r.targetRing.set(r.x, r.z, r.facing, r.halfW, r.halfD, th, thick); else r.targetRing.mesh.visible = false;
      if (r.selected && r.order.type === 'move') {
        const f = r.order.face !== null ? r.order.face : Math.atan2(r.order.x - r.x, r.order.z - r.z);
        r.destRing.set(r.order.x, r.order.z, f, r.halfW, r.halfD, th, thick * 0.7);
      } else r.destRing.mesh.visible = false;
    }
  }
}

// ---- glyphs ---------------------------------------------------------------------------
export function drawGlyph(ctx, typeId, cx, cy, size, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * 0.08);
  const u = size / 10;
  switch (typeId) {
    case 'line': for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) ctx.fillRect((c - 1.5) * 2.2 * u - u * 0.6, (r - 1) * 2.4 * u - u * 0.6, u * 1.2, u * 1.2); break;
    case 'rifle': for (const [x, y] of [[-3, -2], [0, -3], [3, -1], [-2, 2], [2, 3]]) ctx.fillRect(x * u - u * 0.6, y * u - u * 0.6, u * 1.2, u * 1.2); break;
    case 'pike': for (let c = -2; c <= 2; c++) { ctx.beginPath(); ctx.moveTo(c * 2 * u, -4.5 * u); ctx.lineTo(c * 2 * u, 1.5 * u); ctx.stroke(); }
      ctx.fillRect(-5 * u, 1.5 * u, 10 * u, 3 * u); break;
    case 'lcav': ctx.beginPath(); ctx.moveTo(-4 * u, 3 * u); ctx.lineTo(0, -3 * u); ctx.lineTo(4 * u, 3 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4 * u, -3 * u); ctx.lineTo(4 * u, 4 * u); ctx.stroke(); break;
    case 'hcav': ctx.beginPath(); ctx.moveTo(-5 * u, 2 * u); ctx.lineTo(4 * u, -2 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5 * u, -2.5 * u); ctx.lineTo(2 * u, -3.5 * u); ctx.lineTo(3 * u, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4 * u, 4 * u); ctx.lineTo(-1 * u, 1 * u); ctx.lineTo(2 * u, 4 * u); ctx.stroke(); break;
    case 'artillery': ctx.beginPath(); ctx.arc(-1 * u, 2 * u, 3 * u, 0, 6.3); ctx.stroke();
      ctx.save(); ctx.rotate(-0.25); ctx.fillRect(-2 * u, -2.2 * u, 8 * u, 2.2 * u); ctx.restore(); break;
  }
  ctx.restore();
}

export class Banner {
  constructor(r) {
    this.r = r; this.key = '';
    this.cv = document.createElement('canvas'); this.cv.width = 192; this.cv.height = 112;
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.sprite.center.set(0.08, 0); this.sprite.renderOrder = 20;
    this.draw();
  }
  draw() {
    const r = this.r, ctx = this.cv.getContext('2d');
    ctx.clearRect(0, 0, 192, 112);
    ctx.fillStyle = '#d8c58a'; ctx.fillRect(12, 4, 4, 108);
    const col = r.state === 'routing' ? '#555' : SIDE_COLOR[r.side];
    ctx.fillStyle = col; ctx.fillRect(16, 6, 150, 52);
    ctx.strokeStyle = r.selected ? '#ffe9a0' : '#d8b860'; ctx.lineWidth = r.selected ? 5 : 3; ctx.strokeRect(16, 6, 150, 52);
    drawGlyph(ctx, r.typeId, 56, 32, 38, '#f2e6c0');
    ctx.fillStyle = '#f2e6c0'; ctx.font = 'bold 30px Georgia, serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(String(r.men), 92, 33);
    if (r.state === 'wavering') { ctx.fillStyle = '#f0c040'; ctx.beginPath(); ctx.moveTo(16, 90); ctx.lineTo(46, 90); ctx.lineTo(31, 62); ctx.fill(); ctx.fillStyle = '#222'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', 31, 82); }
    else if (r.state === 'routing') { ctx.fillStyle = '#e04040'; ctx.beginPath(); ctx.moveTo(16, 90); ctx.lineTo(46, 90); ctx.lineTo(31, 62); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', 31, 82); }
    this.tex.needsUpdate = true;
  }
  update(camDist, th, camera) {
    const r = this.r;
    const key = `${r.state}|${r.men}|${r.selected}`;
    if (key !== this.key) { this.key = key; this.draw(); }
    const s = clamp(camDist * 0.032, 4.5, 24);
    this.sprite.scale.set(s * 1.7, s, 1);
    this.sprite.position.set(r.x, th.heightAt(r.x, r.z) + (r.def.cav ? 8 : 9) + s * 0.1, r.z);
    this.sprite.visible = true;
  }
}

// terrain-draped ring/strip following a regiment footprint
const RING_N = 96;
export class Ring {
  constructor(color, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_N + 1) * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < RING_N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 5;
  }
  set(cx, cz, f, hw, hd, th, thick) {
    const p = this.mesh.geometry.attributes.position.array;
    const c = Math.cos(f), s = Math.sin(f), per = 4 * (hw + hd);
    for (let i = 0; i <= RING_N; i++) {
      for (let k = 0; k < 2; k++) {
        const off = k === 0 ? -thick : thick;
        const w2 = hw + off, d2 = hd + off;
        let u = (i / RING_N) * 4 * (w2 + d2) , lx, lz;
        if (u < 2 * w2) { lx = -w2 + u; lz = d2; }
        else if ((u -= 2 * w2) < 2 * d2) { lx = w2; lz = d2 - u; }
        else if ((u -= 2 * d2) < 2 * w2) { lx = w2 - u; lz = -d2; }
        else { u -= 2 * w2; lx = -w2; lz = -d2 + u; }
        const x = cx + c * lx + s * lz, z = cz - s * lx + c * lz;
        const o = (i * 2 + k) * 3;
        p[o] = x; p[o + 1] = th.heightAt(x, z) + 0.5; p[o + 2] = z;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.visible = true;
  }
}

// ---- general: morale aura + visual --------------------------------------------------
export class General {
  constructor(side, x, z) { this.side = side; this.x = x; this.z = z; this.facing = side === 'player' ? Math.PI : 0; }
  update(dt, w) {
    let sx = 0, sz = 0, n = 0;
    for (const r of w.regs) if (r.side === this.side && r.active) { sx += r.x; sz += r.z; n++; }
    if (!n) return;
    const tx = sx / n, tz = sz / n + (this.side === 'player' ? 50 : -50);
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    if (d > 4) { const st = Math.min(d, 5 * dt); this.x += dx / d * st; this.z += dz / d * st; }
  }
}

// ---- army setup ---------------------------------------------------------------------
const NAMES = {
  player: { line: ['Crown Guards', 'Redmere Fusiliers', 'Ashford Foot', 'Lionheart Regiment', 'Harrow Grenadiers'], rifle: ['Fenwick Rifles', 'Greenhill Skirmishers'], pike: ['Old Standard Tercio'], lcav: ['Marlow Hussars'], hcav: ['Royal Lancers'], artillery: ['1st Field Battery', '2nd Field Battery'] },
  enemy: { line: ['Valden Musketeers', 'Corvane Line', 'Ostrel Foot', 'Blue Marsh Regiment', 'Iron Crest Grenadiers'], rifle: ['Dunmoor Jaegers', 'Kestrel Skirmishers'], pike: ['Tercio of Saint Orric'], lcav: ['Corvane Dragoons'], hcav: ['Imperial Lancers'], artillery: ['Reserve Battery', 'Hill Battery'] },
};
const PLAYER = [['line', -170, 300], ['line', -85, 300], ['line', 0, 300], ['line', 85, 300], ['line', 170, 300], ['pike', 0, 355], ['rifle', -120, 250], ['rifle', 120, 250], ['lcav', -300, 330], ['hcav', 300, 340], ['artillery', -230, 285], ['artillery', 235, 295]];
const ENEMY = [['line', -195, -110], ['line', -125, -110], ['line', 125, -110], ['line', 195, -110], ['line', 0, -195], ['pike', 0, -112], ['rifle', -90, -50], ['rifle', 90, -50], ['lcav', -290, -120], ['hcav', 290, -130], ['artillery', -95, -150], ['artillery', 95, -150]];

export function createArmies(world) {
  let id = 1;
  for (const [side, list] of [['player', PLAYER], ['enemy', ENEMY]]) {
    const used = {};
    for (const [t, x, z] of list) {
      const i = used[t] = (used[t] || 0) + 1;
      const name = NAMES[side][t][i - 1] || NAMES[side][t][0];
      world.regs.push(new Regiment(id++, side, t, name, x, z, side === 'player' ? Math.PI : 0));
    }
  }
  world.generals.push(new General('player', 0, 400), new General('enemy', 0, -260));
}
