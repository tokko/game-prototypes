import * as THREE from 'three';
import { Builder, PAL, rnd, rr, ri, clamp, angDiff, approach } from './util.js?v=32';
import { LANES } from './city.js?v=32';

const SQ_PER_LANE = 3, SQ_SIZE = 16;
const TANK_LANES = [-108, -108, -108, -28, -28, -28, 28, 28, 28, 108, 108, 108, -180, 180];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export const TS = 0.95, IS = 0.92;   // tank / infantry render scale (tank hull ~8.9 m long = player foot length, 4.4 m tall; trooper ~2.4 m)

export class Units {
  constructor(G) {
    this.G = G; const scene = G.scene;
    // ---------- infantry ----------
    const sb = new Builder();
    sb.box(0.95, 1.0, 0.6, 0, 0.5, 0, 0xb0b0b0).box(1.25, 1.1, 0.85, 0, 1.55, 0, 0xffffff).box(1.8, 0.45, 0.95, 0, 2.05, 0, 0xe0e0e0)
      .box(0.45, 0.45, 0.5, 0, 2.45, 0.05, 0x999999).box(0.95, 0.95, 0.5, 0, 1.75, -0.62, 0x777777).box(0.22, 0.26, 1.6, 0.55, 1.5, 0.8, 0x2a2a2a);
    const squads = this.squads = [];
    for (let side = 0; side < 2; side++) for (const lane of LANES) for (let k = 0; k < SQ_PER_LANE; k++)
      squads.push({ side, lane, dir: side === 0 ? -1 : 1, z: (side === 0 ? 1 : -1) * (90 + k * 75 + rr(0, 20)), members: [], alive: 0, tgt: null, tgtKind: 0, scanT: rnd() * 0.4, respawnT: 0, melta: side === 1 && k === 0 && Math.abs(lane) < 150 });
    for (let side = 0; side < 2; side++) squads.push({ side, lane: 108, dir: side === 0 ? -1 : 1, z: -1e4, members: [], alive: 0, tgt: null, tgtKind: 0, scanT: 0, respawnT: 1e9, melta: false, reserve: true });   // the reinforcement gate's extra squad (objectives)
    const N = this.N = squads.length * SQ_SIZE;
    this.x = new Float32Array(N); this.z = new Float32Array(N); this.y = new Float32Array(N); this.yaw = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N); this.spin = new Float32Array(N);
    this.state = new Uint8Array(N); this.fireT = new Float32Array(N); this.sq = new Uint16Array(N); this.side = new Uint8Array(N);
    this.ox = new Float32Array(N); this.oz = new Float32Array(N); this.life = new Float32Array(N);
    this.melta = new Uint8Array(N); this.mCharge = new Float32Array(N); this.mCool = new Float32Array(N);
    const glowMat = k => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 totalEmissiveRadiance += diffuseColor.rgb * ${k.toFixed(2)};`); }; return m; };
    this.infMesh = new THREE.InstancedMesh(sb.build(), glowMat(0.4), N);
    this.infMesh.frustumCulled = false; scene.add(this.infMesh);
    let n = 0;
    squads.forEach((sq, si) => {
      for (let k = 0; k < SQ_SIZE; k++, n++) {
        sq.members.push(n); this.sq[n] = si; this.side[n] = sq.side;
        this.ox[n] = ((k % 4) - 1.5) * 3.5 + rr(-0.9, 0.9); this.oz[n] = (Math.floor(k / 4) - 1.5) * 3.7 + rr(-0.9, 0.9);   // tight blocks read as columns and die as columns
        this.melta[n] = sq.melta && k < 3 ? 1 : 0; this.mCool[n] = rr(1, 4);
        const c = PAL[sq.side]; _c.set(c.inf); if (this.melta[n]) _c.setRGB(1.6, 0.7, 0.15); else _c.multiplyScalar(rr(0.8, 1.2));
        this.infMesh.setColorAt(n, _c);
      }
      this.placeSquad(sq, sq.z);
      if (sq.reserve) { for (const i of sq.members) { this.state[i] = 2; this.infMesh.setMatrixAt(i, ZERO); } sq.alive = 0; }
    });
    // ---------- tanks ----------
    const hb = new Builder(), tb = new Builder();
    hb.box(5.2, 1.8, 8.6, 0, 1.6, 0, 0xffffff).box(1.5, 1.9, 9.4, 3.2, 0.95, 0, 0x555555).box(1.5, 1.9, 9.4, -3.2, 0.95, 0, 0x555555)
      .box(5.2, 1.3, 2.6, 0, 2.0, 3.8, 0xdddddd, 0.5).box(4.2, 1.5, 2.2, 0, 2.9, -3.0, 0x888888).box(1.2, 1.2, 2.6, 3.4, 2.2, 1.2, 0xaaaaaa).box(1.2, 1.2, 2.6, -3.4, 2.2, 1.2, 0xaaaaaa)
      .cyl(0.3, 0.3, 2.2, 0.9, 3.9, -3.6, 0x333333).cyl(0.3, 0.3, 2.2, -0.9, 3.9, -3.6, 0x333333);
    tb.box(3.6, 1.7, 4.2, 0, 0.85, -0.3, 0xffffff).cyl(0.34, 0.4, 6.8, 0, 0.95, 4.6, 0x333333, Math.PI / 2).box(1.0, 1.0, 1.2, 0, 0.95, 7.8, 0x333333)
      .box(1.2, 0.7, 1.2, 0.8, 2.0, -0.8, 0x999999).pyr(0.9, 1.4, -0.9, 1.7, -1.2, 0xbbbbbb);
    const TN = this.TN = TANK_LANES.length * 2 + 2; this.tanks = [];   // +2: one reserve tank per side for the reinforcement gates
    const tmat = glowMat(0.3);
    this.hullMesh = new THREE.InstancedMesh(hb.build(), tmat, TN); this.turMesh = new THREE.InstancedMesh(tb.build(), tmat, TN);
    this.hullMesh.frustumCulled = this.turMesh.frustumCulled = false; scene.add(this.hullMesh, this.turMesh);
    for (let side = 0; side < 2; side++) TANK_LANES.forEach((lane, k) => {
      const dir = side === 0 ? -1 : 1, i = this.tanks.length;
      const ox = [-1, 1, 0][k % 3] * (Math.abs(lane) < 50 ? 9 : 5); const t = { i, side, dir, lane, ox, x: lane + ox, z: -dir * (130 + (k % 3) * 55 + rr(0, 25)), yaw: dir > 0 ? 0 : Math.PI, tur: dir > 0 ? 0 : Math.PI, hp: 100, alive: true, fireT: rr(1, 5), scanT: rnd(), tgt: null, tgtKind: 0, respawnT: 0, recoil: 0 };
      this.tanks.push(t); this.paintTank(t);
    });
    for (let side = 0; side < 2; side++) { const dir = side === 0 ? -1 : 1, i = this.tanks.length, t = { i, side, dir, lane: 108, ox: 0, x: 108, z: 0, yaw: dir > 0 ? 0 : Math.PI, tur: dir > 0 ? 0 : Math.PI, hp: 0, alive: false, fireT: rr(1, 5), scanT: rnd(), tgt: null, tgtKind: 0, respawnT: 1e9, recoil: 0, reserve: true }; this.tanks.push(t); this.paintTank(t); this.hullMesh.setMatrixAt(i, ZERO); this.turMesh.setMatrixAt(i, ZERO); }
    this.walkT = 0; this.patches = [];
  }
  // a held reinforcement gate brings the owner's extra squad and tank (only when the previous ones are gone) in at (x, z)
  gateSpawn(side, x, z) {
    const sq = this.squads.find(q => q.reserve && q.side === side), t = this.tanks.find(q => q.reserve && q.side === side);
    if (sq && sq.alive <= 0) { sq.lane = x; this.placeSquad(sq, z - sq.dir * 34); sq.goalZ = null; }
    if (t && !t.alive) { t.alive = true; t.hp = 100; t.lane = t.x = x; t.z = z + t.dir * 8; t.yaw = t.tur = t.dir > 0 ? 0 : Math.PI; t.goalZ = null; t.respawnT = 1e9; this.paintTank(t); }
    return !!(sq && t);
  }
  paintTank(t) { _c.set(PAL[t.side].hull); if (!t.alive) _c.setRGB(0.03, 0.028, 0.025); else _c.multiplyScalar(1.5); this.hullMesh.setColorAt(t.i, _c); this.turMesh.setColorAt(t.i, _c); this.hullMesh.instanceColor.needsUpdate = true; this.turMesh.instanceColor.needsUpdate = true; }
  placeSquad(sq, z) {
    sq.z = z; sq.alive = SQ_SIZE; sq.tgt = null;
    for (const i of sq.members) { this.state[i] = 0; this.x[i] = sq.lane + this.ox[i]; this.z[i] = z + this.oz[i]; this.y[i] = 0; this.yaw[i] = sq.dir > 0 ? 0 : Math.PI; this.fireT[i] = rr(0.3, 2.5); this.mCharge[i] = 0; }
  }
  kill(i, ix = 0, iz = 0, up = 6, byPlayer = false) {
    if (this.state[i] !== 0) return;
    this.state[i] = 1; this.life[i] = 1.8; this.vx[i] = ix + rr(-2, 2); this.vz[i] = iz + rr(-2, 2); this.vy[i] = up * rr(0.6, 1.3); this.spin[i] = rr(-9, 9); this.y[i] = 0.5;
    const sq = this.squads[this.sq[i]]; sq.alive--;
    if (sq.alive <= 0) sq.respawnT = (sq.side === 0 ? 9 : 13) * this.G.reinforceMul(sq.side);
    this.G.stats.dead[this.side[i]]++; if (byPlayer) { if (this.side[i] === 1) { this.G.stats.kInf++; if (this.G.wrath) this.G.wrath.gain(this.G.stompK ? 0.2 : 0.1); } else this.G.ffKill('inf'); }   // Wrath: infantry kill 0.1, a stomp kill 0.2 (spec 0.5 / 1, retuned: see the Wrath tuning note in wrath.js)
  }
  damageTank(t, dmg, byPlayer = false) {
    if (!t.alive) return;
    if (t.side === 1 && !byPlayer && this.G.hornT > 0) dmg *= 1.25;   // WAR HORN: allied units deal +25%
    t.hp -= dmg; if (t.hp > 0) return;
    const G = this.G; t.alive = false; t.respawnT = 26; t.tgt = null;
    G.fx.explosion(t.x, 3, t.z, 2.2); G.fx.debris(t.x, 4, t.z, 6, 1.5, 22, 0.07);
    t.em = G.fx.addEmitter(t.x, 3.4, t.z, 2.4, 26);
    this.paintTank(t); this.turMesh.setMatrixAt(t.i, ZERO);
    G.stats.deadTanks[t.side]++; if (byPlayer) { if (t.side === 1) { G.stats.kTank++; if (G.wrath) G.wrath.gain(1); } else G.ffKill('tank'); }   // Wrath: tank kill 1 (spec 4)
  }
  // radial damage. Full friendly fire: it hurts every side; `side` is only who fired.
  blast(x, y, z, r, dmg, side, byPlayer) {
    if (y > r + 3) return;
    const r2 = r * r, X = this.x, Z = this.z, st = this.state;
    for (let i = 0; i < this.N; i++) {
      if (st[i] !== 0) continue;
      const dx = X[i] - x, dz = Z[i] - z, d2 = dx * dx + dz * dz; if (d2 > r2) continue;
      if (dmg >= 30 || rnd() < dmg / 30) { const d = Math.sqrt(d2) + 0.5, k = Math.min(18, dmg * 0.12) / d; this.kill(i, dx * k, dz * k, 5 + dmg * 0.05, byPlayer); }
    }
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - x, t.z - z); if (d < r + 5) this.damageTank(t, dmg * (1 - d / (r + 6)), byPlayer);
    }
  }
  // ---- fire ----
  ignite(i, byPlayer) {
    if (this.state[i] !== 0) return false;
    this.state[i] = 3; this.life[i] = rr(1.3, 2.4); const a = rnd() * 6.283; this.vx[i] = Math.cos(a) * 9; this.vz[i] = Math.sin(a) * 9;
    const sq = this.squads[this.sq[i]]; sq.alive--; sq.panicT = 3.8;
    if (sq.alive <= 0) sq.respawnT = (sq.side === 0 ? 9 : 13) * this.G.reinforceMul(sq.side);
    this.G.stats.dead[this.side[i]]++; this.G.stats.burned = (this.G.stats.burned || 0) + 1;
    if (byPlayer) { if (this.side[i] === 1) { this.G.stats.kInf++; this.G.hitMark = 1; this.G.killTick = 1; if (this.G.wrath) this.G.wrath.gain(0.1); } else this.G.ffKill('inf'); }
    return true;
  }
  // flame cone from o along d: sets troopers alight, cooks tanks. dt = 0 just counts allies inside the cone.
  flame(o, d, range, dt, byPlayer) {
    let allies = 0; const X = this.x, Z = this.z;
    for (let i = 0; i < this.N; i++) {
      if (this.state[i] !== 0) continue;
      const px = X[i] - o.x, py = 1.3 - o.y, pz = Z[i] - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 2 || t > range) continue;
      const w = 2.2 + t * 0.2, q2 = px * px + py * py + pz * pz - t * t; if (q2 > w * w) continue;
      if (this.side[i] === 0) allies++;
      if (dt > 0 && rnd() < dt * 6) this.ignite(i, byPlayer);
    }
    for (const tk of this.tanks) {
      if (!tk.alive) continue;
      const px = tk.x - o.x, py = 2 - o.y, pz = tk.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 2 || t > range) continue;
      const w = 5 + t * 0.2; if (px * px + py * py + pz * pz - t * t > w * w) continue;
      if (tk.side === 0) allies++;
      if (dt > 0) this.damageTank(tk, 16 * dt, byPlayer);
    }
    return allies;
  }
  allyNear(x, z, r) {
    const r2 = r * r; for (let i = 0; i < this.N; i++) { if (this.state[i] !== 0 || this.side[i] !== 0) continue; const dx = this.x[i] - x, dz = this.z[i] - z; if (dx * dx + dz * dz < r2) return true; }
    for (const t of this.tanks) if (t.alive && t.side === 0 && Math.hypot(t.x - x, t.z - z) < r + 4) return true;
    return false;
  }
  addPatch(x, z, byPlayer) {
    for (const p of this.patches) if (Math.abs(p.x - x) + Math.abs(p.z - z) < 4.5) { p.ttl = Math.max(p.ttl, rr(6, 10)); return; }
    if (this.patches.length >= 48) this.patches.shift();
    this.patches.push({ x, z, r: 4.6, ttl: rr(6, 10), tick: rnd() * 0.25, acc: 0, byPlayer }); this.G.fx.decal(x, z, 5);
  }
  updatePatches(dt) {
    const G = this.G, fx = G.fx, cam = G.camera.position, pl = G.player;
    for (let k = this.patches.length - 1; k >= 0; k--) {
      const p = this.patches[k]; p.ttl -= dt;
      if (p.ttl <= 0) { this.patches.splice(k, 1); continue; }
      const cd = Math.abs(p.x - cam.x) + Math.abs(p.z - cam.z), life = Math.min(1, p.ttl / 2);
      p.acc += dt * (cd < 250 ? 16 : 5) * life;
      // sticky fire: three persistent tongues per patch, plus heavy dark smoke
      if (cd < 420) for (let f = 0; f < 3; f++) { const ph = k * 3.1 + f * 2.1; fx.flame(p.x + Math.sin(ph) * p.r * 0.55, 1.6 + Math.sin(this.walkT * 5 + ph) * 0.4, p.z + Math.cos(ph * 1.7) * p.r * 0.55, (4.2 + Math.sin(this.walkT * 7 + ph) * 0.8) * (0.4 + 0.6 * life), 0.34 + 0.25 * (1 - life), (ph * 0.173) % 1); }
      while (p.acc > 1) { p.acc -= 1; if (rnd() < 0.35) fx.fire(p.x + rr(-1, 1) * p.r * 0.8, 0.5, p.z + rr(-1, 1) * p.r * 0.8, rr(-1, 1), rr(5, 11), rr(-1, 1), rr(0.4, 0.8), 0.7, 0.2, 1.8, 0.7, 0.12, 0.8, 0.3); if (rnd() < 0.3) fx.smoke(p.x + rr(-2, 2), 3, p.z + rr(-2, 2), rr(-1, 1) + 1.5, rr(5, 9), rr(-1, 1), rr(3, 6), 3, 13, 0.028, 0.7, 0.2); }
      p.tick -= dt; if (p.tick > 0) continue; p.tick = 0.25;
      const r2 = p.r * p.r;
      for (let i = 0; i < this.N; i++) { if (this.state[i] !== 0) continue; const dx = this.x[i] - p.x, dz = this.z[i] - p.z; if (dx * dx + dz * dz < r2) { this.squads[this.sq[i]].panicT = 3.8; if (rnd() < 0.6) this.ignite(i, p.byPlayer); } }
      for (const t of this.tanks) if (t.alive && Math.hypot(t.x - p.x, t.z - p.z) < p.r + 3) this.damageTank(t, 2, p.byPlayer);
      if (!pl.dead && Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < p.r + 2) pl.damage(0.7, 'leg', p.x, p.z);
    }
  }
  crush(x, z, r, side, byPlayer) {
    const r2 = r * r; let n = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.state[i] !== 0 || (side >= 0 && this.side[i] !== side)) continue;
      const dx = this.x[i] - x, dz = this.z[i] - z; if (dx * dx + dz * dz > r2) continue;
      this.kill(i, dx * 2, dz * 2, 2, !!byPlayer); n++;
    }
    if (r > 7) for (const t of this.tanks) if (t.alive && Math.hypot(t.x - x, t.z - z) < r) this.damageTank(t, 999, !!byPlayer);
    return n;
  }
  // hitscan vs infantry of sides != side. kills up to `pierce`; returns nearest t or Infinity.
  rayInfantry(o, d, maxT, side, radius, pierce, byPlayer, probe) {
    const r2 = radius * radius; let best = Infinity, kills = 0;
    for (let i = 0; i < this.N && kills < pierce; i++) {
      if (this.state[i] !== 0 || this.side[i] === side) continue;
      const px = this.x[i] - o.x, py = 1.4 * IS - o.y, pz = this.z[i] - o.z;
      const t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > maxT) continue;
      const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t;
      if (qx * qx + qy * qy + qz * qz > r2) continue;
      if (t < best) best = t;
      if (!probe) { this.kill(i, d.x * 9, d.z * 9, 5, byPlayer); kills++; }
    }
    return best;
  }
  rayTanks(o, d, maxT, side) {
    let best = null, bt = maxT;
    for (const tk of this.tanks) {
      if (!tk.alive || tk.side === side) continue;
      const px = tk.x - o.x, py = 2.3 * TS - o.y, pz = tk.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > bt) continue;
      const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t; if (qx * qx + qy * qy + qz * qz < 20 * TS * TS) { bt = t; best = tk; }
    }
    return best ? { t: bt, tank: best } : null;
  }
  sameCorridor(a, b) { return Math.abs(a - b) < 60; }
  count(side) { let n = 0; for (const s of this.squads) if (s.side === side) n += Math.max(0, s.alive); return n; }
  countTanks(side) { let n = 0; for (const t of this.tanks) if (t.side === side && t.alive) n++; return n; }
  // nearest enemy cluster for support fire (colossi, gunships, bombers)
  findCluster(side, x, z, range) {
    let best = null, bd = range;
    for (const s of this.squads) { if (s.side === side || s.alive < 4) continue; const d = Math.hypot(s.lane - x, s.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  frontZ(side) { let f = side === 0 ? 1e9 : -1e9; for (const s of this.squads) if (s.side === side && s.alive > 0) f = side === 0 ? Math.min(f, s.z) : Math.max(f, s.z); return Math.abs(f) > 1e8 ? 0 : f; }

  update(dt) {
    const G = this.G, pl = G.player, fx = G.fx, cam = G.camera.position; this.walkT += dt;
    const plOk = !pl.dead;
    this.updatePatches(dt);
    // ---------- squads ----------
    for (const sq of this.squads) {
      if (sq.alive <= 0) { if (sq.reserve) continue; sq.respawnT -= dt; if (sq.respawnT <= 0) this.placeSquad(sq, -sq.dir * 610); continue; }
      sq.panicT = Math.max(0, (sq.panicT || 0) - dt);
      if (sq.fleeT > 0) { sq.fleeT -= dt; sq.z -= sq.dir * 6 * dt; }   // WAR HORN: routed squads run for their own lines
      sq.scanT -= dt;
      if (sq.scanT <= 0) {
        sq.scanT = 0.4; let best = null, bd = 105, kind = 0;
        for (const e of this.squads) { if (e.side === sq.side || e.alive <= 0 || !this.sameCorridor(e.lane, sq.lane)) continue; const d = Math.abs(e.z - sq.z); if (d < bd) { bd = d; best = e; kind = 1; } }
        for (const t of this.tanks) { if (t.side === sq.side || !t.alive || !this.sameCorridor(t.lane, sq.lane)) continue; const d = Math.abs(t.z - sq.z); if (d < bd) { bd = d; best = t; kind = 2; } }
        sq.nearPlayer = false;
        if (sq.side === 1 && plOk) {
          const d = Math.hypot(pl.pos.x - sq.lane, pl.pos.z - sq.z);
          if (d < 115 && G.city.los(sq.lane, 3, sq.z, pl.pos.x, 8, pl.pos.z)) { sq.nearPlayer = true; if (!best || rnd() < 0.4) { best = pl; kind = 3; bd = d; } }
        }
        sq.tgt = best; sq.tgtKind = kind; sq.tgtD = bd;
      }
      let sp = sq.tgt ? (sq.tgtD > 75 ? 2.5 : 0) : 5.5, zd = sq.dir;
      if (sq.goalZ != null) { const dg = sq.goalZ - sq.z; if (Math.abs(dg) < 5) sp = 0; else zd = Math.sign(dg); }   // the objective director's goal: walk the lane to it, hold there
      if (sp > 0) {
        for (const o of this.squads) if (o !== sq && o.side === sq.side && o.lane === sq.lane && o.alive > 0) { const dz = (o.z - sq.z) * zd; if (dz > 0 && dz < 30) { sp = 0; break; } }
        if (sq.z * sq.dir > 560 || sq.panicT > 0) sp = 0;
        for (const p of this.patches) { const dz = (p.z - sq.z) * zd; if (dz > -4 && dz < 18 && Math.abs(p.x - sq.lane) < 14) { sp = 0; break; } }   // burning ground denies the lane
        sq.z += zd * sp * dt;
      }
      sq.moving = sp > 0;
    }
    // ---------- soldiers ----------
    const X = this.x, Z = this.z, st = this.state, mesh = this.infMesh, arr = mesh.instanceMatrix.array;
    for (let i = 0; i < this.N; i++) {
      const o = i * 16, s = st[i];
      if (s === 2) continue;
      if (s === 3) {   // on fire: runs flailing, then drops
        this.life[i] -= dt;
        if (rnd() < dt * 4) { const a = rnd() * 6.283; this.vx[i] = Math.cos(a) * 9; this.vz[i] = Math.sin(a) * 9; }
        X[i] += this.vx[i] * dt; Z[i] += this.vz[i] * dt; this.yaw[i] = Math.atan2(this.vx[i], this.vz[i]) + Math.sin(this.walkT * 22 + i) * 0.7;
        fx.flame(X[i], 2.9, Z[i], 3.6, 0.28, (i * 0.137) % 1);
        if (rnd() < dt * 4) fx.smoke(X[i], 2.6, Z[i], rr(-1, 1), rr(3, 6), rr(-1, 1), rr(1.5, 3), 1.5, 6, 0.04, 0.5, 0.3);
        if (this.life[i] <= 0) { st[i] = 2; for (let k = 0; k < 16; k++) arr[o + k] = 0; fx.decal(X[i], Z[i], 1.7); fx.smoke(X[i], 1, Z[i], 0, 3, 0, 2.5, 2, 7, 0.03, 0.6, 0.3); continue; }
        const yw3 = this.yaw[i], c3 = Math.cos(yw3), s3 = Math.sin(yw3), b3 = Math.abs(Math.sin(this.walkT * 16 + i)) * 0.35;
        arr[o] = c3 * IS; arr[o + 1] = 0; arr[o + 2] = -s3 * IS; arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = IS; arr[o + 6] = 0; arr[o + 7] = 0;
        arr[o + 8] = s3 * IS; arr[o + 9] = 0; arr[o + 10] = c3 * IS; arr[o + 11] = 0; arr[o + 12] = X[i]; arr[o + 13] = b3; arr[o + 14] = Z[i]; arr[o + 15] = 1;
        continue;
      }
      if (s === 1) {
        this.life[i] -= dt; this.vy[i] -= 24 * dt; X[i] += this.vx[i] * dt; Z[i] += this.vz[i] * dt; this.y[i] += this.vy[i] * dt;
        if (this.y[i] < 0.3) { this.y[i] = 0.3; this.vy[i] *= -0.25; this.vx[i] *= 0.5; this.vz[i] *= 0.5; this.spin[i] *= 0.4; }
        if (this.life[i] <= 0) { st[i] = 2; for (let k = 0; k < 16; k++) arr[o + k] = 0; if (Math.abs(X[i] - cam.x) + Math.abs(Z[i] - cam.z) < 320) fx.decal(X[i], Z[i], 1.5); continue; }   // leaves a dark smear
        const a = this.life[i] * this.spin[i];
        _q.setFromEuler(_e.set(a, this.yaw[i], a * 0.6)); _m.compose(_p.set(X[i], this.y[i], Z[i]), _q, _s.set(IS, IS, IS)); _m.toArray(arr, o);
        continue;
      }
      const sq = this.squads[this.sq[i]];
      const panic = sq.panicT > 0, pk = panic ? 3 : 1;   // panicking squads scatter, fall back and stop shooting
      const tx = sq.lane + this.ox[i] * pk + (panic ? Math.sin(i * 7.3) * 4 : 0), tz = sq.z + this.oz[i] * pk - (panic ? sq.dir * 12 : 0); let dx = tx - X[i], dz = tz - Z[i]; const d = Math.hypot(dx, dz);
      let moving = false, yawT = sq.dir > 0 ? 0 : Math.PI;
      if (d > 0.6) { const v = Math.min(panic ? 11 : 7.5, d * 3) * dt / d; X[i] += dx * v; Z[i] += dz * v; moving = d > 1.5; if (moving) yawT = Math.atan2(dx, dz); }
      // fire
      if (sq.tgt && !panic) {
        this.fireT[i] -= dt;
        if (this.fireT[i] <= 0) {
          this.fireT[i] = rr(0.5, 2.4); const tc = PAL[sq.side].tracer; let ex, ey, ez;
          if (sq.tgtKind === 1) {
            const e = sq.tgt; if (e.alive > 0) {
              let v = e.members[ri(0, SQ_SIZE - 1)]; if (st[v] !== 0) v = e.members[ri(0, SQ_SIZE - 1)];
              ex = X[v] + rr(-1.5, 1.5); ey = rr(0.6, 3.4); ez = Z[v] + rr(-1.5, 1.5);
              if (st[v] === 0 && rnd() < 0.035 * (sq.side === 0 && G.hornT > 0 ? 1.25 : 1)) this.kill(v, (ex - X[i]) * 0.03, (ez - Z[i]) * 0.03, 3);
              else if (rnd() < 0.004) {   // the odd stray round finds a friend standing in the line of fire
                for (const o2 of this.squads) { if (o2 === sq || o2.side !== sq.side || o2.alive <= 0 || !this.sameCorridor(o2.lane, sq.lane)) continue; const dz2 = (o2.z - sq.z) * sq.dir; if (dz2 > 0 && dz2 < sq.tgtD) { const v2 = o2.members[ri(0, SQ_SIZE - 1)]; if (st[v2] === 0) { this.kill(v2, 0, sq.dir * 3, 3); G.stats.strayFF = (G.stats.strayFF || 0) + 1; } break; } }
              }
            }
          } else if (sq.tgtKind === 2) { const t = sq.tgt; ex = t.x + rr(-3, 3); ey = rr(1.5, 5); ez = t.z + rr(-2, 2); if (rnd() < 0.2) this.damageTank(t, 1.5); }
          else if (plOk) { ex = pl.pos.x + rr(-4, 4); ey = rr(3, 15); ez = pl.pos.z + rr(-4, 4); if (rnd() < 0.4) pl.damage(0.3, rnd() < 0.3 ? 'leg' : 'hull'); }
          if (ex !== undefined) {
            const cd = Math.abs(X[i] - cam.x) + Math.abs(Z[i] - cam.z);
            if (cd < 500 || rnd() < 0.4) fx.tracer(X[i], 1.9 * IS, Z[i], ex, ey, ez, 420, 10, cd > 250 ? 0.34 : 0.2, tc[0], tc[1], tc[2]);
            if (cd < 150 && rnd() < 0.25) G.sfx.crack(cd);
            yawT = Math.atan2(ex - X[i], ez - Z[i]);
          }
        }
      }
      // melta teams: heavy engines within 120 m (the player's included) come first; inside 18 m the shot goes under the ward
      let hv = null;
      if (this.melta[i]) {
        let hd = 120;
        for (const L of [G.hierarchs, G.harrows, G.colossi]) for (const e of L) { if (e.side === this.side[i] || !e.alive) continue; const d = Math.hypot(e.pos.x - X[i], e.pos.z - Z[i]); if (d < hd) { hd = d; hv = e; } }
        if (hv) {
          this.mCool[i] -= dt;
          if (this.mCool[i] <= 0 && (this.mCharge[i] > 0 || rnd() < dt * 2) && G.city.los(X[i], 2, Z[i], hv.pos.x, 8, hv.pos.z)) {
            if (this.mCharge[i] === 0) G.sfx.charge(1.5, 0.08);
            this.mCharge[i] += dt; if (hv.piloted) G.meltaWarn = 0.4; yawT = Math.atan2(hv.pos.x - X[i], hv.pos.z - Z[i]);
            fx.fire(X[i], 3.6, Z[i], rr(-1, 1), rr(0, 2), rr(-1, 1), 0.15, 1.5 + this.mCharge[i] * 3.5, 0.5, 4, 1.6, 0.3, 1);
            if (this.mCharge[i] >= 1.5) {
              this.mCharge[i] = 0; this.mCool[i] = rr(7, 11);
              _a.set(X[i], 3.6, Z[i]); _b.set(hv.pos.x + rr(-4, 4), 5, hv.pos.z + rr(-4, 4));
              fx.beam(_a, _b, 0.6, 2.2, 0.9, 0.2, 0.45); fx.beam(_a, _b, 0.2, 2.6, 2.2, 1.5, 0.45);
              fx.sparks(_b.x, _b.y, _b.z, 22, 20); fx.flash(_b.x, _b.y, _b.z, 1, 0.5, 0.15, 3000, 0.4, 90);
              hv._src = { x: X[i], z: Z[i] }; hv.damage(45, false, hd < 18, { x: hv.pos.x, y: 4, z: hv.pos.z, comp: 'legs' }, 45); G.sfx.melta(hd);   // 45 to the LEGS component
            }
          } else this.mCharge[i] = 0;
        }
      }
      // melta teams hunt the player's legs
      if (!hv && this.melta[i] && plOk) {
        this.mCool[i] -= dt;
        const pd = Math.hypot(pl.pos.x - X[i], pl.pos.z - Z[i]);
        if (pd < 72 && this.mCool[i] <= 0 && (this.mCharge[i] > 0 || rnd() < dt * 2) && G.city.los(X[i], 2, Z[i], pl.pos.x, 5, pl.pos.z)) {
          if (this.mCharge[i] === 0) G.sfx.charge(1.5, 0.08);
          this.mCharge[i] += dt; G.meltaWarn = 0.4; yawT = Math.atan2(pl.pos.x - X[i], pl.pos.z - Z[i]);
          fx.fire(X[i], 3.6, Z[i], rr(-1, 1), rr(0, 2), rr(-1, 1), 0.15, 1.5 + this.mCharge[i] * 3.5, 0.5, 4, 1.6, 0.3, 1);
          if (this.mCharge[i] >= 1.5) {
            this.mCharge[i] = 0; this.mCool[i] = rr(7, 11);
            const left = rnd() < 0.5; const f = pl.legs.feet[left ? 0 : 1];
            _a.set(X[i], 3.6, Z[i]); _b.set(f.pos.x, 4.5, f.pos.z);
            fx.beam(_a, _b, 0.6, 2.2, 0.9, 0.2, 0.45); fx.beam(_a, _b, 0.2, 2.6, 2.2, 1.5, 0.45);
            fx.sparks(_b.x, _b.y, _b.z, 22, 20); fx.flash(_b.x, _b.y, _b.z, 1, 0.5, 0.15, 3000, 0.4, 90);
            fx.fire(_b.x, _b.y, _b.z, 0, 0, 0, 0.3, 6, 14, 5, 2.5, 0.6, 1);
            pl.damage(22, left ? 'legL' : 'legR', X[i], Z[i]); G.sfx.melta(pd);
          }
        } else this.mCharge[i] = 0;
      }
      this.yaw[i] += clamp(angDiff(yawT, this.yaw[i]), -8 * dt, 8 * dt);
      const yw = this.yaw[i], c = Math.cos(yw), sn = Math.sin(yw), sc = this.melta[i] ? 1.9 : IS;
      const by = moving ? Math.abs(Math.sin(this.walkT * 9 + i)) * 0.18 : 0;
      arr[o] = c * sc; arr[o + 1] = 0; arr[o + 2] = -sn * sc; arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = sn * sc; arr[o + 9] = 0; arr[o + 10] = c * sc; arr[o + 11] = 0; arr[o + 12] = X[i]; arr[o + 13] = by; arr[o + 14] = Z[i]; arr[o + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true; this.frame = (this.frame | 0) + 1;
    // ---------- tanks ----------
    for (const t of this.tanks) {
      if (!t.alive) {
        if (t.reserve) { t.respawnT -= dt; if (t.respawnT < 1e8 && t.respawnT <= 0) { t.respawnT = 1e9; this.hullMesh.setMatrixAt(t.i, ZERO); } continue; }   // the gate's tank: its wreck goes, a held gate brings the next
        t.respawnT -= dt;
        if (t.respawnT <= 0) { t.alive = true; t.hp = 100; t.z = -t.dir * 630; t.x = t.lane + t.ox; t.yaw = t.tur = t.dir > 0 ? 0 : Math.PI; this.paintTank(t); }
        else { if (t.respawnT < 3) { _m.makeRotationY(t.yaw); _m.scale(_s.set(TS, TS, TS)); _m.setPosition(t.x, -(3 - t.respawnT) * 2.6, t.z); this.hullMesh.setMatrixAt(t.i, _m); } continue; }
      }
      t.scanT -= dt; if (t.slowT > 0) t.slowT -= dt;
      if (t.scanT <= 0) {
        t.scanT = 0.5; let best = null, bd = 240, kind = 0;
        for (const e of this.tanks) { if (e.side === t.side || !e.alive || !this.sameCorridor(e.lane, t.lane)) continue; const d = Math.abs(e.z - t.z); if (d < bd) { bd = d; best = e; kind = 2; } }
        if (!best) { bd = 200; for (const e of this.squads) { if (e.side === t.side || e.alive <= 0 || !this.sameCorridor(e.lane, t.lane)) continue; const d = Math.abs(e.z - t.z); if (d < bd) { bd = d; best = e; kind = 1; } } }
        if (t.side === 1 && plOk) { const d = Math.hypot(pl.pos.x - t.x, pl.pos.z - t.z); if (d < 250 && (!best || rnd() < 0.5) && G.city.los(t.x, 3, t.z, pl.pos.x, 8, pl.pos.z)) { best = pl; kind = 3; bd = d; } }
        for (const L of [G.scouts.list, G.hierarchs, G.harrows]) for (const sc of L) { if (sc.side === t.side || sc.state !== 'alive') continue; const d = Math.hypot(sc.pos.x - t.x, sc.pos.z - t.z); if (d < 220 && (!best || rnd() < 0.5) && G.city.los(t.x, 3, t.z, sc.pos.x, 8, sc.pos.z)) { best = sc; kind = 4; bd = d; } }   // enemy scout engines and hierarchs
        t.tgt = best; t.tgtKind = kind; t.tgtD = bd;
      }
      let sp = t.tgt ? (t.tgtD > 150 ? 3 : 0) : 8, zd = t.dir;
      if (t.goalZ != null) { const dg = t.goalZ - t.z; if (Math.abs(dg) < 5) sp = 0; else zd = Math.sign(dg); }   // the objective director's goal
      if (sp > 0) {
        for (const o of this.tanks) if (o !== t && o.side === t.side && o.alive && Math.abs(o.x - t.x) < 11) { const dz = (o.z - t.z) * zd; if (dz > 0 && dz < 30) { sp = 0; break; } }
        if (t.z * t.dir > 560) sp = 0;
        if (sp > 0) t.yaw = zd > 0 ? 0 : Math.PI;
        t.z += zd * sp * dt;
        if (sp > 4 && rnd() < dt * 3) fx.smoke(t.x, 3, t.z - t.dir * 4, rr(-1, 1), rr(2, 4), rr(-1, 1), 2, 1.5, 5, 0.06, 0.4);
      }
      let aim = t.yaw;
      if (t.tgt) {
        const tg = t.tgt; let ex, ez;
        if (t.tgtKind === 1) { ex = tg.lane; ez = tg.z; } else if (t.tgtKind === 2) { ex = tg.x; ez = tg.z; } else if (t.tgtKind === 4) { ex = tg.pos.x; ez = tg.pos.z; } else { ex = pl.pos.x; ez = pl.pos.z; }
        aim = Math.atan2(ex - t.x, ez - t.z); t.fireT -= dt * (t.slowT > 0 ? 0.5 : 1);   // WAR HORN: enemy tanks' fire rate halved
        if (t.fireT <= 0 && Math.abs(angDiff(aim, t.tur)) < 0.1) {
          t.fireT = rr(3.5, 6); t.recoil = 1; const sc = t.tgtKind === 3 ? 6 : 4;
          const hx = ex + rr(-sc, sc), hz = ez + rr(-sc, sc), mx = t.x + Math.sin(t.tur) * 8.4 * TS, mz = t.z + Math.cos(t.tur) * 8.4 * TS, tc = PAL[t.side].tracer, side = t.side, kind = t.tgtKind;
          const cd = Math.hypot(t.x - cam.x, t.z - cam.z);
          fx.tracer(mx, 3.45 * TS, mz, hx, kind === 2 ? 3 : 0.3, hz, 300, 18, 0.95, tc[0] * 1.3, tc[1] * 1.3, tc[2] * 1.3, () => {
            fx.explosion(hx, 0.5, hz, 0.95, { silent: cd > 500 });
            if (kind === 2 && tg.alive && rnd() < 0.55) this.damageTank(tg, 60);
            else if (kind === 4 && (tg.isHierarch || tg.isHarrow) && tg.alive && Math.hypot(tg.pos.x - hx, tg.pos.z - hz) < 14) { tg._src = { x: mx, z: mz }; tg.damage(25); }
            G.blast(hx, 0.5, hz, 7, 50, side);
          });
          if (cd < 600) { _p.set(mx, 3.45 * TS, mz); _a.set(Math.sin(t.tur), 0, Math.cos(t.tur)); fx.muzzle(_p, _a, 2, 4, 2.4, 0.8); fx.flash(mx, 4, mz, 1, 0.6, 0.3, 1500, 0.12, 80); G.sfx.boom(cd, 0.45); fx.smoke(mx, 3.45 * TS, mz, _a.x * 6, 2, _a.z * 6, 1.6, 3, 9, 0.3, 0.4); }
        }
      }
      t.tur += clamp(angDiff(aim, t.tur), -1.2 * dt, 1.2 * dt); t.recoil = Math.max(0, t.recoil - dt * 3);
      _m.makeRotationY(t.yaw); _m.scale(_s.set(TS, TS, TS)); _m.setPosition(t.x, 0, t.z); this.hullMesh.setMatrixAt(t.i, _m);
      _m.makeRotationY(t.tur); _m.scale(_s.set(TS, TS, TS)); _m.setPosition(t.x - Math.sin(t.tur) * t.recoil * 0.9, 2.5 * TS, t.z - Math.cos(t.tur) * t.recoil * 0.9); this.turMesh.setMatrixAt(t.i, _m);
    }
    this.hullMesh.instanceMatrix.needsUpdate = true; this.turMesh.instanceMatrix.needsUpdate = true;
  }
}
