import * as THREE from 'three';
import { rnd, rr, clamp, damp, angDiff } from './util.js?v=32';
import { Legs } from './legs.js?v=32';
import { setupHeavy, resetHeavy, strike, tickHeavy, armOk, speedMul, spendEnergy, chargeDrain, chargeDone, chargeCancel, aiMayFire, isTargeted, splashEngines, foeWeak, wardTurn, flankPoint, heavyDown, COST } from './heavy.js?v=32';
import { makeHarrow } from './walker.js?v=32';
import { shieldMaterial } from './colossus.js?v=32';

// Harrow-class line engine (model/harrow.glb via walker.js makeHarrow; spec model/harrow-spec.md + model/harrow-visual.md): an aggressive mid-weight brawler
// between the Kestrel and the Hierarch. Lascannon beam (right), siege fist (left, 0.7 s wind-up the player can dodge), rocket rack.
// One engine per side; it returns 80 s after it dies. Never targets a great colossus.
export const HARROW_HP = 950, HARROW_SHIELD = 350;
const HIP = 19, TOP = 21, SLEW = 1.4, WIND = 0.7, STRIKE = 0.16, HOLD = 0.25, REC = 0.9, CHARGE = 0.6;
const NAMES = ['THE PENITENT BLADE', 'ASHTONGUE'];
const RANGE = [0, 24, 24, 24, 170, 170, 200];   // stand-off range by target kind: 1 harrow, 2 scout, 3 player (these three close to fist range), 4 tank, 5 squad, 6 hierarch
const _fp = new THREE.Vector3(), _m = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _f = new THREE.Vector3(), _e = new THREE.Vector3(), _s = new THREE.Vector3();
const ease = t => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;

export class Harrow {
  constructor(G, side, lane, startZ, holdZ) {
    this.G = G; this.side = side; this.dir = side === 0 ? -1 : 1; this.lane = lane; this.isHarrow = true; this.name = NAMES[side];
    const scene = G.scene;
    const tell = () => new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });   // per-instance, per-mesh charge tells
    this.lasMat = tell(); this.fistMat = tell();
    const r = this.rig = makeHarrow(side, { lascannon_glow: this.lasMat, fist_glow: this.fistMat });
    scene.add(r.root);
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(24, 2), shieldMaterial(side)); this.shield.position.y = 4; this.shield.scale.set(1, 1.1, 1); r.torso.add(this.shield); this.shieldA = 0;
    this.legs = new Legs(scene, { hipW: 8.5, thighL: 11, shinL: 11.5, footH: 2.5, knee: 1, stride: 15, stepTime: 0.72, stepH: 3.5, refSpeed: TOP, makeParts: r.legParts, onStep: f => this.onStep(f) });
    const sg = new THREE.CircleGeometry(16, 20); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); scene.add(this.shadow);
    // hit volumes (measured on model/harrow.glb in rig space, see rayHit): spheres of radius rArm along each arm, one on the head/hood, so the
    // locational test and the shot test share one set of points
    const hp = (par, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); par.add(o); return o; };
    setupHeavy(this, 'harrow', HARROW_HP, HARROW_SHIELD, TOP, { head: hp(r.head, 0, -0.3, 3), armL: [r.arm_L, hp(r.arm_L, 2, -4.5, 0), hp(r.forearm_L, 2, 0, 3.2), hp(r.fist_L, -0.8, 0.2, 2.5), r.anchor_fist],
      armR: [r.arm_R, hp(r.arm_R, -3.5, -2, 1), hp(r.arm_R, -3.5, -2, 12.5), r.anchor_lascannon], reactor: r.anchor_reactor, mp: r.torso, rArm: 6.5, rHead: 5, legTop: 16, rearZ: 3.5 });
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.holdBase = holdZ; this.enter(startZ);
  }
  enter(z) {
    this.pos.set(this.lane, 0, z); this.yaw = this.dir > 0 ? 0 : Math.PI; this.torsoYaw = this.yaw; this.pitch = 0; this.headYaw = 0; this.vel.set(0, 0, 0);
    this.hp = HARROW_HP; this.shieldHP = HARROW_SHIELD; this.lastDmg = -99; this.staggerT = 0; this.grudge = 0; this.grudgeT = 0;
    this.lastHunt = -99; this.huntT = 0; this.hurtByPlayerT = -99; this.state = 'alive'; this.t = 0; this.deadT = 0; this.klaxT = 0;
    this.bob = 0; this.bobV = 0; this.speed = 0; this.sink = 0; this.lean = 0; this.rollK = 0; this.swing = 0; this.tgt = null; this.tgtKind = 0; this.scanT = rnd();
    this.holdZ = this.holdBase; this.holdT = rr(16, 30); this.goal = null; this.charge = 0; this.flashT = 0; this.coolT = 0; this.recoil = 0; this.lasCd = rr(1, 3);
    this.mp = 'none'; this.mt = 0; this.meleeCd = rr(0.5, 2); this.rackT = rr(4, 9); this.salvo = []; this.alarmT = 0;
    this.rig.root.visible = true; this.legs.setVisible(true); this.shadow.visible = true; this.legs.reset(this.pos, this.yaw);
    this.fistMat.color.setRGB(0, 0, 0); this.lasMat.color.setRGB(0, 0, 0); resetHeavy(this);
  }
  place(x, z) { this.enter(z); this.pos.x = x; this.holdBase = this.holdZ = z; this.holdT = 99; this.lane = x; this.legs.reset(this.pos, this.yaw); }
  get alive() { return this.state === 'alive'; }
  chest(out) { return out.set(this.pos.x, 31 - this.sink, this.pos.z); }
  get limp() { return this.staggerT > 0 || this.hp < HARROW_HP * 0.3; }
  onStep(f) { this.bobV -= 5; this.rollK = 0.025 * f.side; this.swing = 0.1 * f.side; this.legs.o.stepTime = this.limp ? 1.07 : 0.72; this.G.stomp(f.pos.x, f.pos.z, 7.5, this); }

  // ---- taking damage ----
  damage(amt, byPlayer, bypass, pt, hAmt, under) {
    if (!this.alive) return;
    const G = this.G; this.lastDmg = G.time;
    if (byPlayer) { this.hurtByPlayerT = G.time; G.hitMark = 1; G.stats.harrowDmg = (G.stats.harrowDmg || 0) + amt; }
    if (byPlayer && this.side === 0) {   // keep shooting your own harrow and it holds a grudge
      this.grudge += amt; G.ffKill('harrow', true);
      if (this.grudge > 50 && !(this.grudgeT > 0)) { this.grudgeT = 24; this.grudge = 0; this.lastHunt = -99; this.huntT = 0; G.announce(this.name + ' TURNS ITS GUNS ON YOU'); }
    }
    const r = strike(this, amt, hAmt === undefined ? amt : hAmt, pt, bypass, byPlayer, under);   // shield first, then a component
    if (r.ab > 0) this.shieldA = Math.min(0.9, this.shieldA + 0.14 + r.ab * 0.005);
    if (r.down) { this.shieldA = 2.2; G.fx.flash(this.pos.x, 28, this.pos.z, 0.7, 0.9, 1, 6000, 0.4, 260); G.announce(this.name + ' - SHIELD DOWN'); }
    if (this.hp <= 0 || this.comp.reactor.hp <= 0) {
      this.state = 'dying'; this.t = 0; this.deadT = 0; this.charge = 0; this.mp = 'none'; this.salvo.length = 0; this.flashT = 0; heavyDown(this, byPlayer);
      (G.stats.harrowKills = G.stats.harrowKills || [0, 0])[this.side]++;
      G.announce(this.name + ' - REACTOR CRITICAL');
    }
  }
  // the player's sunspear: ignores every shield; legs and rear are the soft spots (1.6x) and stagger the engine for 10 s
  spearHit(d, leg, pt) {
    if (!this.alive) return;
    const G = this.G, rear = d.x * Math.sin(this.torsoYaw) + d.z * Math.cos(this.torsoYaw) > 0.3;
    if (!leg && this.shieldHP > 0) this.shieldA = 1.8;
    this.damage(520 * (leg || rear ? 1.6 : 1), true, true, leg ? { x: pt.x, y: pt.y, z: pt.z, comp: 'legs', cap: 0.6 } : { x: pt.x, y: pt.y, z: pt.z, cap: 0.6 });
    if (leg || rear) { this.staggerT = 10; this.bobV -= 6; if (this.alive) G.announce(this.name + ' STAGGERS'); }
    G.fx.debris(pt.x, pt.y, pt.z, 8, 1.6, 22, 0.1); G.stats.spearCol = (G.stats.spearCol || 0) + 1;
  }
  // a heavier engine's foot lands on or beside it
  stomped(x, z, r, dmg) { if (this.alive && Math.hypot(this.pos.x - x, this.pos.z - z) < r * 0.9 + 3) this.damage(dmg, false); }
  rayLeg(o, d, maxT) {   // per leg: a capsule hip to ankle (radius 4.2, thigh 6.6 x 8.9 / shin 6.4 x 11 in the GLB) and a foot capsule heel to toe (radius 3.2); sampled
    if (!this.alive && this.state !== 'dying') return null;
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw), hy = HIP - this.sink; let best = null;
    for (const f of this.legs.feet) {
      const hx = this.pos.x + lx * f.side * 6.97, hz = this.pos.z + lz * f.side * 6.97, fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      const ax = f.pos.x + fx * 1.1, ay = f.pos.y + 1.9, az = f.pos.z + fz * 1.1;   // foot centre (the GLB foot spans z -5.7..7.9, y 0..3.8)
      for (const [x0, y0, z0, x1, y1, z1, r2, n] of [[ax, ay, az, hx, hy, hz, 17.64, 8], [ax - fx * 3.5, ay, az - fz * 3.5, ax + fx * 4.5, ay, az + fz * 4.5, 10.24, 3]]) for (let k = 0; k <= n; k++) {
        const u = k / n, px = x0 + (x1 - x0) * u - o.x, py = y0 + (y1 - y0) * u - o.y, pz = z0 + (z1 - z0) * u - o.z;
        const t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > maxT) continue;
        const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t;
        if (qx * qx + qy * qy + qz * qz < r2) { maxT = t; best = { t: Math.max(0, t - 3) }; }
      }
    }
    return best;
  }
  // hit volumes measured on the GLB (rig space, rest pose): the torso is an ellipsoid in the torso-yaw frame, centre (lat 0.8, y 31.8, fwd 3.8),
  // semi-axes 18.5 x 12.5 x 14.5 (hull box x -19.5..21.2, y 19.7..43.9, z -11.1..18.7); plus the locational spheres of the head (r 5), the arm
  // points (r 6.5: arm, forearm, fist, lascannon barrel) and the pelvis (centre y 15.6, r 8.5), so every visible part can be shot
  rayHit(o, d, maxT) {
    if (!this.alive && this.state !== 'dying') return -1;
    const px = this.pos.x - o.x, pz = this.pos.z - o.z, py = 28 - this.sink - o.y, bs = px * d.x + py * d.y + pz * d.z, bc = px * px + py * py + pz * pz - 1444;   // bounding sphere r 38 (muzzle reaches 30 m out)
    if (bs * bs - bc < 0 || bs < -38) return -1;
    let best = -1; const g = this.geo;
    const hit = t => { if (t >= 0 && t <= maxT && (best < 0 || t < best)) best = t; };
    const sph = (cx, cy, cz, r) => { const x = cx - o.x, y = cy - o.y, z = cz - o.z, b = x * d.x + y * d.y + z * d.z, c = x * x + y * y + z * z - r * r, disc = b * b - c; if (disc >= 0) hit(b - Math.sqrt(disc)); };
    const cs = Math.cos(this.torsoYaw), sn = Math.sin(this.torsoYaw), cy = 31.8 - this.sink;   // local frame: lat = x cos - z sin (+x = the walker's left), fwd = x sin + z cos
    const ox = o.x - this.pos.x, oz = o.z - this.pos.z, ex = 1 / 18.5, ey = 1 / 12.5, ez = 1 / 14.5;
    const qx = ((ox * cs - oz * sn) - 0.8) * ex, qy = (o.y - cy) * ey, qz = ((ox * sn + oz * cs) - 3.8) * ez;
    const vx = (d.x * cs - d.z * sn) * ex, vy = d.y * ey, vz = (d.x * sn + d.z * cs) * ez;
    const a = vx * vx + vy * vy + vz * vz, b = qx * vx + qy * vy + qz * vz, c = qx * qx + qy * qy + qz * qz - 1, disc = b * b - a * c;
    if (disc >= 0) hit((-b - Math.sqrt(disc)) / a);
    sph(this.pos.x, 15.6 - this.sink, this.pos.z, 8.5);
    _s.setFromMatrixPosition(g.head.matrixWorld); sph(_s.x, _s.y, _s.z, g.rHead);
    for (const k of ['armL', 'armR']) for (const n of g[k]) { _s.setFromMatrixPosition(n.matrixWorld); sph(_s.x, _s.y, _s.z, g.rArm); }
    return best;
  }
  flame(o, d, range, dt, byPlayer) {
    if (!this.alive) return;
    for (const y of [6, 31]) {
      const px = this.pos.x - o.x, py = y - o.y, pz = this.pos.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > range + 5) continue;
      const w = 9 + t * 0.2; if (px * px + py * py + pz * pz - t * t > w * w) continue;
      this._src = o; this.damage(60 * dt, byPlayer); return;
    }
  }

  // ---- targeting: harrow 1.0, scout 0.9, player 0.85 (Synod / grudge, <= 240 m, LOS), tank 0.6, squad 0.4, hierarch 0.5; never a great colossus ----
  scan() {
    const G = this.G, pl = G.player, u = G.units; let best = null, bs = 0, kind = 0;
    const cand = (t, k, w, d, R) => { if (d >= R) return; const sc = w * (1 - d / R); if (sc > bs) { bs = sc; best = t; kind = k; } };
    const dist = (x, z) => Math.hypot(x - this.pos.x, z - this.pos.z);
    for (const h of G.harrows) if (h.side !== this.side && h.alive) cand(h, 1, 1.0 + foeWeak(h, this.pos.x, this.pos.z), dist(h.pos.x, h.pos.z), 480);   // +0.3 on an engine with a collapsed arc facing us
    for (const s of G.scouts.list) if (s.side !== this.side && s.state === 'alive') cand(s, 2, 0.9, dist(s.pos.x, s.pos.z), 400);
    if ((this.side === 1 || this.grudgeT > 0) && !pl.dead && !G.noHunt) {
      const pd = dist(pl.pos.x, pl.pos.z);
      if (pd < 240 && (this.huntT > 0 || G.time - this.lastHunt > 24 || G.time - this.hurtByPlayerT < 12) && G.city.los(this.pos.x, 30, this.pos.z, pl.pos.x, 9, pl.pos.z)) cand(pl, 3, 0.85, pd, 240);
    }
    for (const t of u.tanks) if (t.side !== this.side && t.alive) cand(t, 4, 0.6, dist(t.x, t.z), 300);
    for (const q of u.squads) if (q.side !== this.side && q.alive >= 3) cand(q, 5, 0.4, dist(q.lane, q.z), 260);
    for (const h of G.hierarchs) if (h.side !== this.side && h.alive) cand(h, 6, 0.5 + foeWeak(h, this.pos.x, this.pos.z), dist(h.pos.x, h.pos.z), 420);
    if (this.plan === 'H' && pl.heavy && !pl._dead && pl.unit.alive) cand(pl.unit, 1, 1.4, dist(pl.unit.pos.x, pl.unit.pos.z), 700);   // HUNTER: the player's engine, closed on as a duel (kind 1)
    const ot = this.ordTgt; if (ot && ot.alive) { best = ot; kind = ot.isHarrow ? 1 : 6; }   // ordered to KILL it
    if (kind === 3 && !(this.huntT > 0)) { this.huntT = rr(16, 26); this.lastHunt = G.time; }
    this.tgt = best; this.tgtKind = kind;
  }
  tgtPos(out) {
    const pa = this.curAim || this.aimPt; if (pa) return out.copy(pa);   // piloted: the crosshair point, or a locked arm's target
    const t = this.tgt, k = this.tgtKind;
    if (k === 1) return out.set(t.pos.x, 30, t.pos.z);
    if (k === 2) return out.set(t.pos.x, 16, t.pos.z);
    if (k === 3) return out.set(t.pos.x, 14, t.pos.z);
    if (k === 4) return out.set(t.x, 2.5, t.z);
    if (k === 5) return out.set(t.lane, 1.5, t.z);
    return out.set(t.pos.x, 36, t.pos.z);
  }
  tgtAlive() { const t = this.tgt, k = this.tgtKind; return !!t && (k === 1 || k === 6 ? t.alive : k === 2 ? t.state === 'alive' : k === 3 ? !t.dead : k === 4 ? t.alive : t.alive > 0); }

  update(dt) {
    const G = this.G, fx = G.fx;
    this.t += dt;
    if (this.state === 'gone') { this.deadT += dt; if (this.deadT > 80) { this.enter(-this.dir * 700); G.announce(this.name + ' STRIDES INTO THE DISTRICT'); } return; }
    if (this.state !== 'alive') { this.deadT += dt; this.updateWreck(dt); return; }
    if (this.piloted) return;   // the player is driving this engine: see pilotUpdate
    // ----- hold line, timers, shield regeneration, damage states -----
    this.holdT -= dt; if (this.holdT <= 0) { this.holdT = rr(16, 30); this.holdZ = this.holdBase + rr(-40, 40); }
    this.staggerT = Math.max(0, this.staggerT - dt); this.huntT = Math.max(0, this.huntT - dt); this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.grudgeT = Math.max(0, this.grudgeT - dt); this.grudge = Math.max(0, this.grudge - 3 * dt);
    tickHeavy(this, dt);   // capacitors, planting and shield regeneration
    const frac = this.hp / HARROW_HP, px = this.pos.x, pz = this.pos.z;
    if (frac < 0.72 && rnd() < dt * (4 + 16 * (0.72 - frac))) fx.smoke(px + rr(-8, 8), rr(22, 40), pz + rr(-6, 6), rr(-2, 2) + 2, rr(4, 9), rr(-2, 2), rr(3, 5), 4, 14, 0.05, 0.6, 0.2);
    if (frac < 0.46 && rnd() < dt * 10) { const k = rnd() < 0.5 ? 1 : -1; fx.fire(px + k * 8 + rr(-2, 2), 30 + rr(-2, 2), pz + rr(-4, 4), rr(-1, 1), rr(5, 10), rr(-1, 1), rr(0.5, 1.1), 5, 2, 3.4, rr(1, 1.6), 0.25, 0.9, 0.3); }
    if ((frac < 0.46 || this.staggerT > 0) && rnd() < dt * 2.5) { const lx = px + rr(-10, 10), ly = rr(10, 38), lz = pz + rr(-6, 6); fx.sparks(lx, ly, lz, 8, 20); fx.flash(lx, ly, lz, 1, 0.7, 0.3, 1000, 0.1, 80); }
    // ----- target -----
    this.scanT -= dt; if (this.scanT <= 0 || !this.tgtAlive()) { this.scanT = 0.6; this.scan(); }
    let dist = 1e9, ay = this.yaw, aimErr = 9, aimP = 0;
    const has = !!this.tgt, k = this.tgtKind, melee = this.mp !== 'none' && this.mp !== 'rec';
    if (has) { this.tgtPos(_p); dist = Math.hypot(_p.x - px, _p.z - pz); ay = Math.atan2(_p.x - px, _p.z - pz); aimP = clamp(Math.atan2(_p.y - 31, Math.max(10, dist)), -0.5, 0.5); }
    // ----- legs: close to fist range on a harrow / scout / player, hold off with the lascannon on the rest -----
    let want, spd;
    // a target in reach (or no goal) is fought as before; an objective goal otherwise (targets of opportunity on the way, hold inside the ring); allies flank an engine that is engaging the player
    const gl = this.goal;
    if (has && (!gl || (!gl.wd && dist < RANGE[k] + 110))) {   // a withdrawing engine keeps walking home and fires on the way
      want = ay; spd = dist > RANGE[k] - 2 ? Math.min(TOP, 3 + (dist - RANGE[k]) * 0.4) : 0;
      if ((k === 1 || k === 6) && flankPoint(this, this.tgt, Math.max(RANGE[k] * 0.8, 40), _fp)) { const fx = _fp.x - px, fz = _fp.z - pz, fd = Math.hypot(fx, fz); if (fd > 12) { want = Math.atan2(fx, fz); spd = Math.min(TOP, 3 + fd * 0.4); } }
    } else { const dx = (gl ? gl.x : this.lane) - px, dz = (gl ? gl.z : this.holdZ) - pz, gd = Math.hypot(dx, dz); want = gd > 8 ? Math.atan2(dx, dz) : has ? ay : (this.dir > 0 ? 0 : Math.PI); spd = gd > 8 ? Math.min(TOP * 0.8, 2 + gd * 0.15) : 0; }
    if (melee || this.charge > 0) spd = 0;
    const slow = (this.staggerT > 0 ? 0.4 : 1) * (frac < 0.3 ? 0.6 : 1) * speedMul(this);
    this.yaw += clamp(angDiff(want, this.yaw) * 3, -1, 1) * 1.575 * (this.limp ? 0.6 : 1) * this.legMul * dt;   // leg turn 1.2 -> 1.575 (speed pass)
    if (Math.abs(angDiff(want, this.yaw)) > 0.9) spd = Math.min(spd, 4);
    this.speed = damp(this.speed, spd * slow, 2.1, dt);
    this.vel.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed); this.pos.x = clamp(px + this.vel.x * dt, -680, 680); this.pos.z = clamp(pz + this.vel.z * dt, -640, 640); if (G.objectives) G.objectives.collide(this.pos, 10);
    const wantT = clamp(angDiff(has ? ay : this.yaw, this.yaw), -1.7, 1.7) + this.yaw + (has ? wardTurn(this, ay, 0.12) : 0), slew = SLEW * (this.staggerT > 0 ? 0.5 : 1) * dt;
    this.torsoYaw += clamp(angDiff(wantT, this.torsoYaw), -slew, slew);
    if (has) aimErr = Math.abs(angDiff(ay, this.torsoYaw));
    this.pitch = damp(this.pitch, aimP, 4, dt);
    this.headYaw = damp(this.headYaw, has ? clamp(angDiff(ay, this.torsoYaw), -0.35, 0.35) : 0, 4, dt);
    this.updateMelee(dt);
    this.applyPose(dt);
    const rig = this.rig; let lk = 0;

    // ----- siege fist: within 24 m of a harrow / scout / player (or anything in easy reach), 0.7 s wind-up, then the swing -----
    if (this.mp === 'none' && has && this.meleeCd <= 0 && this.charge <= 0 && armOk(this, 'armL') && aimErr < 0.6 && (k <= 3 ? dist < 24 : dist < 14 && k !== 6)) this.startMelee();
    if (has && k === 3) { const wk = this.mp === 'wind' ? this.mt / WIND : this.charge > 0 ? this.charge / CHARGE : 0; G.threat = G.threat || { col: this, t: 0, k: clamp(wk, 0, 1) }; }
    // ----- lascannon: 0.6 s charge (crimson tell), instant beam to 260 m, 4.5 s cooldown; silent during the fist swing -----
    this.lasCd = Math.max(0, this.lasCd - dt * (this.staggerT > 0 ? 0.6 : 1));
    if (this.charge > 0) {
      this.charge += dt; lk = Math.min(1, this.charge / CHARGE); rig.anchor_lascannon.getWorldPosition(_m);
      fx.fire(_m.x + rr(-1, 1), _m.y + rr(-1, 1), _m.z + rr(-1, 1), 0, 0, 0, 0.1, 1.5 + 4 * lk, 1, 2.8, 0.5, 0.4, 1);
      if (has && k === 3) { this.alarmT -= dt; if (this.alarmT <= 0) { this.alarmT = 0.4 - 0.2 * lk; G.sfx.alarm(); } }
      if (!has || melee) { this.charge = 0; this.lasCd = 1; }
      else if (this.charge >= CHARGE && aimErr < 0.14) this.fireBeam();
      else if (this.charge > CHARGE + 2.5) { this.charge = 0; this.lasCd = 1.5; }
    } else if (has && !melee && this.mp === 'none' && this.lasCd <= 0 && armOk(this, 'armR') && aiMayFire(this, COST.lascannon, isTargeted(this)) && dist < 260 && dist > 10 && aimErr < 0.2 && G.city.los(px, 31, pz, _p.x, Math.max(_p.y, 3), _p.z)) {
      this.charge = 1e-4; this.alarmT = 0; G.sfx.charge(CHARGE, Math.min(0.2, 30 / Math.max(30, fx.camDist(px, 30, pz))));
    }
    { let e = 0;   // lascannon glow: crimson ramp, shimmer in the last 0.1 s, white flash on firing, then decay
      if (this.charge > 0) { e = lk * lk * (this.charge > CHARGE - 0.1 ? 1 + 0.3 * Math.sin(G.time * 90) : 1); this.lasMat.color.setRGB(2.8 * e, 0.35 * e, 0.3 * e); }
      else if (this.flashT > 0) { this.flashT -= dt; const f = this.flashT; if (f > 0.3) this.lasMat.color.setRGB(7, 0.9, 0.75); else { e = Math.max(0, f / 0.3); this.lasMat.color.setRGB(7 * e, 0.9 * e, 0.75 * e); } }
      else this.lasMat.color.setRGB(0, 0, 0); }
    this.recoil = damp(this.recoil, 0, 6, dt); rig.arm_R.position.z = 1 - this.recoil * 1.2;
    // ----- rocket rack: 8 rockets every 10 s at the densest enemy infantry / armour cluster within 300 m -----
    this.rackT -= dt; if (this.rackT <= 0) this.fireRack();
    for (let i = this.salvo.length - 1; i >= 0; i--) { const s = this.salvo[i]; s.t -= dt; if (s.t <= 0) { this.salvo.splice(i, 1); this.launch(s); } }
    if (rnd() < dt * 4) fx.smoke(px + rr(-1, 1) + Math.cos(this.torsoYaw) * 7, 40, pz - Math.sin(this.torsoYaw) * 7 - Math.cos(this.torsoYaw) * 8, rr(-1, 1) + 2, rr(5, 9), rr(-1, 1), rr(3, 5), 3, 14, 0.05, 0.55, 0.15);
  }

  // ---- piloted by the player (PlayerClass 'harrow'): the Player owns movement; this runs the weapons and the pose ----
  pilotUpdate(dt, inp) {
    const G = this.G, fx = G.fx, rig = this.rig, frac = this.hp / HARROW_HP;
    this.t += dt; this.staggerT = Math.max(0, this.staggerT - dt); this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.lasCd = Math.max(0, this.lasCd - dt * (this.staggerT > 0 ? 0.6 : 1)); this.rackT = Math.max(0, this.rackT - dt);
    tickHeavy(this, dt);   // capacitors, planting and shield regeneration
    if (frac < 0.72 && rnd() < dt * (4 + 16 * (0.72 - frac))) fx.smoke(this.pos.x + rr(-8, 8), rr(22, 40), this.pos.z + rr(-6, 6), rr(-2, 2) + 2, rr(4, 9), rr(-2, 2), rr(3, 5), 4, 14, 0.05, 0.6, 0.2);
    if ((frac < 0.46 || this.staggerT > 0) && rnd() < dt * 2.5) fx.sparks(this.pos.x + rr(-10, 10), rr(10, 38), this.pos.z + rr(-6, 6), 8, 20);
    this.legs.o.stepTime = this.limp ? 1.07 : 0.72;
    // LMB: siege fist (0.7 s wind-up, then the swing; the arc test runs on release)
    if (inp.fire1 && this.mp === 'none' && this.meleeCd <= 0 && this.charge <= 0 && armOk(this, 'armL')) this.startMelee();
    this.updateMelee(dt);
    // RMB: lascannon, 0.6 s charge then the beam to the crosshair
    if (inp.fire2 && this.charge <= 0 && this.lasCd <= 0 && this.mp === 'none' && armOk(this, 'armR')) { this.charge = 1e-4; G.sfx.charge(CHARGE, 0.2); }
    let lk = 0;
    if (this.charge > 0) {
      this.charge += dt; lk = Math.min(1, this.charge / CHARGE); rig.anchor_lascannon.getWorldPosition(_m);
      fx.fire(_m.x + rr(-1, 1), _m.y + rr(-1, 1), _m.z + rr(-1, 1), 0, 0, 0, 0.1, 1.5 + 4 * lk, 1, 2.8, 0.5, 0.4, 1);
      if (this.mp !== 'none' && this.mp !== 'rec') this.charge = 0; else if (this.charge >= CHARGE) { this.curAim = this.aimR; this.fireBeam(); this.curAim = null; }
    }
    { let e = 0;
      if (this.charge > 0) { e = lk * lk * (this.charge > CHARGE - 0.1 ? 1 + 0.3 * Math.sin(G.time * 90) : 1); this.lasMat.color.setRGB(2.8 * e, 0.35 * e, 0.3 * e); }
      else if (this.flashT > 0) { this.flashT -= dt; const f = this.flashT; if (f > 0.3) this.lasMat.color.setRGB(7, 0.9, 0.75); else { e = Math.max(0, f / 0.3); this.lasMat.color.setRGB(7 * e, 0.9 * e, 0.75 * e); } }
      else this.lasMat.color.setRGB(0, 0, 0); }
    this.recoil = damp(this.recoil, 0, 6, dt); rig.arm_R.position.z = 1 - this.recoil * 1.2; this.pending = this.charge > 0 ? COST.lascannon : this.mp === 'wind' ? COST.fist : 0;
    // Q: rocket barrage on the crosshair ground point
    if (inp.aa && !this.qHeld && this.rackT <= 0 && this.aimPt) { for (let i = 0; i < 8; i++) this.salvo.push({ t: i * 0.1, x: this.aimPt.x, z: this.aimPt.z }); this.rackT = 10; }
    this.qHeld = inp.aa;
    for (let i = this.salvo.length - 1; i >= 0; i--) { const s = this.salvo[i]; s.t -= dt; if (s.t <= 0) { this.salvo.splice(i, 1); this.launch(s); } }
    this.applyPose(dt);
  }
  pilotHud() {   // [fraction, text] for LMB, RMB, Q
    const f = (a, b) => [Math.max(0, Math.min(1, a)), b];
    return [this.mp === 'none' ? f(1 - this.meleeCd / 1.5, this.meleeCd > 0 ? '...' : 'RDY') : f(0.4, 'SWING'),
      this.charge > 0 ? f(this.charge / CHARGE, 'CHG') : f(1 - this.lasCd / 4.5, this.lasCd > 0 ? this.lasCd.toFixed(1) : 'RDY'),
      f(1 - this.rackT / 10, this.rackT > 0 ? this.rackT.toFixed(0) : 'RDY')];
  }

  startMelee() { this.mp = 'wind'; this.mt = 0; this.G.sfx.charge(WIND, Math.min(0.2, 30 / Math.max(30, this.G.fx.camDist(this.pos.x, 30, this.pos.z)))); }
  updateMelee(dt) {
    if (this.mp === 'none') return;
    this.mt += dt;
    if (this.mp === 'wind' && this.mt >= WIND) { this.mp = 'strike'; this.mt = 0; }
    else if (this.mp === 'strike' && this.mt >= STRIKE) { this.mp = 'hold'; this.mt = 0; this.fistLand(); }
    else if (this.mp === 'hold' && this.mt >= HOLD) { this.mp = 'rec'; this.mt = 0; }
    else if (this.mp === 'rec' && this.mt >= REC) { this.mp = 'none'; this.mt = 0; this.meleeCd = rr(1.2, 2.2); }
  }
  // arm pose for the current phase (rest / wind-up / strike / hold / recover); see harrow-visual.md section 7
  meleePose(o) {
    const st = this.staggerT > 0, A0 = st ? 0.3 : 0.15, F0 = st ? 0.5 : -0.06, L0 = st ? 0.22 : 0.10;   // rest forearm eased up from 0.15 so the leaned-forward fist bottom clears world y 15
    o.A = A0; o.F = F0; o.ram = 0; o.yaw = 0; o.lean = L0; o.k = 0;
    const mp = this.mp, t = this.mt; if (mp === 'none') return;
    const W = { A: 1.05, F: -0.95, ram: -2.5, yaw: 0.35, lean: 0.05 }, S = { A: -0.55, F: 1.0, ram: 3, yaw: -0.45, lean: 0.18 };
    const mix = (a, b, u) => { o.A = lerp(a.A, b.A, u); o.F = lerp(a.F, b.F, u); o.ram = lerp(a.ram, b.ram, u); o.yaw = lerp(a.yaw, b.yaw, u); o.lean = lerp(a.lean, b.lean, u); };
    const R = { A: A0, F: F0, ram: 0, yaw: 0, lean: L0 };
    if (mp === 'wind') { mix(R, W, ease(clamp(t / WIND, 0, 1))); o.k = clamp(t / WIND, 0, 1); }
    else if (mp === 'strike') { mix(W, S, (t / STRIKE) * (t / STRIKE)); o.ram = lerp(-2.5, 3, clamp((t - 0.08) / 0.08, 0, 1)); o.k = 1; }
    else if (mp === 'hold') { mix(S, S, 0); o.k = lerp(1, 0.6, t / HOLD); }
    else { mix(S, R, ease(clamp(t / REC, 0, 1))); o.k = lerp(0.6, 0, t / REC); }
  }
  // the fist lands: damage at the end of the strike phase
  fistLand() {
    const G = this.G, fx = G.fx, pl = G.player, side = this.side, aim = this.torsoYaw, bp = !!this.piloted;
    this.rig.root.updateMatrixWorld(true); this.rig.anchor_fist.getWorldPosition(_f);
    const fp = { x: _f.x, y: _f.y, z: _f.z }; spendEnergy(this, COST.fist);
    const fxp = _f.x, fzp = _f.z, ox = this.pos.x, oz = this.pos.z, hit = (x, z, r) => Math.hypot(x - fxp, z - fzp) < r;
    this.bobV -= 6; G.shakeAt(fxp, 8, fzp, 4); G.sfx.boom(fx.camDist(fxp, 10, fzp), 1.6);
    fx.explosion(fxp, 8, fzp, 1.6, { silent: true }); fx.debris(fxp, 8, fzp, 6, 1.6, 24, 0.1); fx.dust(fxp, 1, fzp, 4, 8, 0.15, 0.5); fx.flash(fxp, 12, fzp, 3.2, 1.6, 0.4, 5000, 0.3, 160);
    if (!pl.dead && hit(pl.pos.x, pl.pos.z, 11)) {
      pl.damage(30, 'hull', ox, oz);
      _e.set(pl.pos.x - ox, 0, pl.pos.z - oz).normalize().multiplyScalar(40);   // the shove: a strong lateral velocity push
      const lf = Math.sin(pl.legYaw), lz = Math.cos(pl.legYaw);
      pl.vel.x += _e.x; pl.vel.z += _e.z; pl.speed = clamp(pl.speed + _e.x * lf + _e.z * lz, -30, 55); pl.bobV -= 6; G.addTrauma(0.5); G.kick(1.5, 4);
    }
    for (const s of G.scouts.list) if (s.state === 'alive' && hit(s.pos.x, s.pos.z, 11)) G.scouts.damage(s, 400, bp, ox, oz);
    for (const h of G.hierarchs) if (h.alive && hit(h.pos.x, h.pos.z, 17)) h.damage(60, bp, false, fp, 380, 0.7);   // the fist goes under the ward: 70% of its hull damage ignores the shield
    for (const h of G.harrows) if (h !== this && h.alive && hit(h.pos.x, h.pos.z, 12)) h.damage(60, bp, false, fp, 380, 0.7);
    // tanks and infantry anywhere in the swept arc (about 60 degrees left of the aim to 5 degrees right, 12-30 m out)
    for (const [dd, a] of [[0, 0], [22, 0.0], [22, 0.5], [22, 0.95], [16, 0.5], [28, 0.3]]) {
      const x = dd ? ox + Math.sin(aim + a) * dd : fxp, z = dd ? oz + Math.cos(aim + a) * dd : fzp; G.units.crush(x, z, 9, -1);
    }
    // buildings in the arc: small and medium blocks are demolished, towers and cathedrals are cracked
    for (const b of G.city.buildings) {
      if (!b.alive) continue;
      const cx = clamp(ox, b.x - b.hw, b.x + b.hw), cz = clamp(oz, b.z - b.hd, b.z + b.hd), d = Math.hypot(cx - ox, cz - oz); if (d > 31) continue;
      const rel = angDiff(Math.atan2(cx - ox, cz - oz), aim); if (rel < -0.45 || rel > 1.1) continue;
      const down = G.city.damage(b, b.hero || b.h0 > 90 ? 400 : 99999, Math.sin(aim), Math.cos(aim), false, this.piloted);
      if (down) G.blast(b.x, 0, b.z, b.hw + 4, 150, -1);
    }
  }
  fireBeam() {
    const G = this.G, fx = G.fx, pl = G.player, side = this.piloted ? -1 : this.side, bp = !!this.piloted;
    this.charge = 0; this.lasCd = 4.5; this.flashT = 0.38; this.recoil = 1; spendEnergy(this, COST.lascannon);
    this.rig.anchor_lascannon.getWorldPosition(_m); this.tgtPos(_p);
    _d.subVectors(_p, _m); _d.multiplyScalar(1 / (_d.length() || 1));
    if (this.spreadMul > 1) { _d.x += rr(-1, 1) * 0.04; _d.y += rr(-1, 1) * 0.02; _d.z += rr(-1, 1) * 0.04; _d.normalize(); }   // a destroyed head: aim spread x3
    const h = G.shoot(_m, _d, 260, side, { probe: true, radius: 1.2 });
    let hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref;
    if (!pl.dead) {   // the player is not in the general hitscan
      const qx0 = pl.pos.x - _m.x, qy0 = 15 - _m.y, qz0 = pl.pos.z - _m.z, t = qx0 * _d.x + qy0 * _d.y + qz0 * _d.z;
      if (t > 0 && t < h.t) { const qx = qx0 - _d.x * t, qy = qy0 - _d.y * t, qz = qz0 - _d.z * t; if (qx * qx + qy * qy + qz * qz < 42) { const tt = Math.max(0, t - 3); hx = _m.x + _d.x * tt; hy = _m.y + _d.y * tt; hz = _m.z + _d.z * tt; type = 'player'; } }
    }
    const ox = _m.x, oz = _m.z, cd = fx.camDist(_m.x, _m.y, _m.z);
    _e.set(hx, hy, hz);
    fx.beam(_m, _e, 1.8, 3.2, 0.45, 0.4, 0.3); fx.beam(_m, _e, 0.6, 5, 3.4, 3.2, 0.3);
    fx.muzzle(_m, _d, 3.5, 3.2, 0.7, 0.6); fx.flash(_m.x, _m.y, _m.z, 1, 0.25, 0.2, 5000, 0.4, 260); fx.explosion(hx, hy, hz, 1.3); fx.sparks(hx, hy, hz, 14, 24);
    G.sfx.lance(cd); G.shakeAt(_m.x, _m.y, _m.z, 1.2); this.bobV -= 2;
    if (type === 'tank') G.units.damageTank(ref, 999);
    else if (type === 'scout') G.scouts.damage(ref, 220, bp, ox, oz);   // an anti-light precision weapon: 220 to a Kestrel, a tank dies, aircraft 120, engines 40/40
    else if (type === 'player') pl.damage(22, 'hull', ox, oz);
    else if (type === 'hier' || type === 'harrow' || type === 'col' || type === 'struct') ref.damage(40, bp, false, { x: hx, y: hy, z: hz }, 40);   // S 40, H 40 against engines: the Harrow has no shield-breaker by design
    else if (type === 'air') G.air.damage(ref, 120, bp);
    else if (type === 'bld') G.city.damage(ref, 400, _d.x, _d.z, false, bp);
    else if (type === 'inf') G.units.blast(hx, hy, hz, 4, 40, side, bp);
  }
  fireRack() {
    const G = this.G, u = G.units; let best = null, bs = 0;
    const score = (x, z) => { let n = 0; for (const q of u.squads) if (q.side !== this.side && q.alive > 0 && Math.hypot(q.lane - x, q.z - z) < 28) n += q.alive; for (const t of u.tanks) if (t.side !== this.side && t.alive && Math.hypot(t.x - x, t.z - z) < 28) n += 8; return n; };
    for (const q of u.squads) if (q.side !== this.side && q.alive >= 3 && Math.hypot(q.lane - this.pos.x, q.z - this.pos.z) < 300) { const s = score(q.lane, q.z); if (s > bs) { bs = s; best = { x: q.lane, z: q.z }; } }
    for (const t of u.tanks) if (t.side !== this.side && t.alive && Math.hypot(t.x - this.pos.x, t.z - this.pos.z) < 300) { const s = score(t.x, t.z); if (s > bs) { bs = s; best = { x: t.x, z: t.z }; } }
    if (!best) { this.rackT = 2.5; return; }
    this.rackT = 10; for (let i = 0; i < 8; i++) this.salvo.push({ t: i * 0.1, x: best.x, z: best.z });
  }
  launch(s) {
    const G = this.G, fx = G.fx, side = this.side, bp = !!this.piloted; this.rig.anchor_rack.getWorldPosition(_m);
    const hx = s.x + rr(-12, 12), hz = s.z + rr(-12, 12); _d.set(hx - _m.x, -_m.y, hz - _m.z).normalize(); const cd = fx.camDist(_m.x, _m.y, _m.z);
    fx.tracer(_m.x, _m.y, _m.z, hx, 0.5, hz, 130, 10, 0.8, 3, 1.7, 0.6, () => { fx.explosion(hx, 0.5, hz, 1.3, { silent: fx.camDist(hx, 0.5, hz) > 500 }); G.blast(hx, 0.5, hz, 7, 160, side, bp); splashEngines(G, hx, 0.5, hz, 7, 20, 10, bp, this, true); });   // S 20, H 10 per rocket against engines
    fx.muzzle(_m, _d, 1.8, 3, 2, 1); for (let k = 0; k < 3; k++) fx.smoke(_m.x, _m.y, _m.z, -_d.x * rr(2, 8), rr(1, 4), -_d.z * rr(2, 8), rr(1.2, 2.2), 2, 8, 0.4, 0.5, 0.5);
    if (cd < 600) G.sfx.missile();
  }

  // death: the legs fold and the hull topples forward (lean to 1.2 over 2.5 s, hip sinks 10 m), the reactor goes up, then a burning wreck sinks away
  updateWreck(dt) {
    const G = this.G, fx = G.fx;
    if (this.state === 'dying') {
      const cd = fx.camDist(this.pos.x, 30, this.pos.z), fxx = Math.sin(this.torsoYaw), fzz = Math.cos(this.torsoYaw), u = clamp(this.t / 2.5, 0, 1);
      this.lean = 1.2 * u * u; this.sink = 10 * u;
      this.rig.anchor_reactor.getWorldPosition(_m);
      fx.fire(_m.x + rr(-2, 2), _m.y + rr(-2, 2), _m.z + rr(-2, 2), 0, 0, 0, 0.12, 6 + 18 * u, 3, 4, 2.0, 0.7, 1);
      this.klaxT -= dt; if (this.klaxT <= 0) { this.klaxT = 0.6; G.sfx.klaxon(Math.min(0.25, 40 / Math.max(60, cd))); }
      if (rnd() < dt * 20) fx.sparks(this.pos.x + rr(-8, 8), rr(8, 30), this.pos.z + rr(-6, 6), 4, 16);
      if (this.t > 3) {
        this.state = 'wreck'; this.t = 0;
        const cx = this.pos.x + fxx * 18, cz = this.pos.z + fzz * 18; this.rig.anchor_reactor.getWorldPosition(_m);
        fx.explosion(_m.x, _m.y, _m.z, 4); fx.explosion(cx, 8, cz, 3.5, { silent: true });
        for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, c = Math.cos(a), sn = Math.sin(a); fx.smoke(cx + c * 8, 3, cz + sn * 8, c * rr(35, 55), rr(1, 5), sn * rr(35, 55), rr(2, 3.5), 8, 26, 0.15, 0.6, 1.1); if (k % 2) fx.fire(cx + c * 6, 2, cz + sn * 6, c * 60, 2, sn * 60, 0.4, 6, 2, 3.5, 1.6, 0.4, 1, 1.2); }
        fx.debris(cx, 8, cz, 10, 2, 28, 0.09); G.shakeAt(cx, 0, cz, 9); G.sfx.boom(cd, 2.6); G.skyFlash = 1.0;
        G.blast(cx, 0, cz, 32, 300, -1); G.blast(this.pos.x, 0, this.pos.z, 20, 300, -1);
        for (const dd of [14, 32]) { const b = G.city.lot(this.pos.x + fxx * dd, this.pos.z + fzz * dd); if (b) G.city.damage(b, 3000, fxx, fzz); }
        this.em = fx.addEmitter(cx, 12, cz, 4, 26); fx.addEmitter(this.pos.x, 16, this.pos.z, 3, 26);
        G.announce(this.name + ' HAS FALLEN');
      }
    } else {
      if (this.t > 14) { this.sink += dt * 6; fx.smoke(this.pos.x + rr(-12, 12), rr(0, 10), this.pos.z + rr(-12, 12), rr(-6, 6), rr(2, 8), rr(-6, 6), rr(3, 5), 10, 28, 0.13, 0.6); }
      if (this.t > 22) { this.state = 'gone'; this.t = 0; this.rig.root.visible = false; this.legs.setVisible(false); this.shadow.visible = false; return; }
    }
    this.applyPose(dt);
  }
  applyPose(dt) {
    const rig = this.rig, T = this.t, time = this.G.time, alive = this.state === 'alive', o = this._pose || (this._pose = {});
    this.bobV += (-this.bob * 40 - this.bobV * 6) * dt; this.bob += this.bobV * dt;
    this.rollK = damp(this.rollK, 0, 5, dt); this.swing = damp(this.swing, 0, 3, dt);
    this.shieldA = Math.max(0, this.shieldA - dt * 0.9); this.shield.material.uniforms.uA.value = this.shieldA; this.shield.visible = this.shieldA > 0.01 || this.wardFx > 0.01;
    const walking = Math.min(1, Math.abs(this.speed) / 6), hipY = HIP + this.bob - this.sink - Math.min(Math.abs(this.speed), TOP) / TOP * 0.6;
    if (alive) this.meleePose(o); else { o.A = 0.4; o.F = 0.9; o.ram = 0; o.yaw = 0; o.lean = this.lean; o.k = 0; }
    let A = o.A, F = o.F;
    if (!armOk(this, 'armL')) { A = 0.4; F = 0.9; }   // a destroyed fist arm hangs limp
    if (alive && this.mp === 'none') { A += (1 - walking) * 0.04 * Math.sin(time * 1.1) + walking * this.swing; F -= (1 - walking) * 0.03 * Math.sin(time * 1.1); }
    const sway = alive && !this.tgt && this.mp === 'none' ? 0.03 * Math.sin(time * 1.6) : 0;
    rig.root.position.set(this.pos.x, 0, this.pos.z); rig.root.rotation.y = this.yaw;
    rig.body.position.y = hipY; rig.body.rotation.set((alive ? o.lean + 0.012 * Math.sin(time * 0.9) : o.lean), 0, this.rollK);
    rig.torso.rotation.y = angDiff(this.torsoYaw, this.yaw) + o.yaw + sway;
    rig.head.rotation.y = this.headYaw; rig.arm_R.rotation.x = armOk(this, 'armR') ? -this.pitch : 0.8;
    rig.arm_L.rotation.x = A; rig.forearm_L.rotation.x = F; rig.fist_L.position.z = 10 + o.ram;
    { const e = Math.pow(o.k, 1.5) * (o.k > 0.5 ? 1 + 0.2 * Math.sin(time * 56) : 1); this.fistMat.color.setRGB(3.2 * e, 1.6 * e, 0.4 * e); }
    this.legs.update(dt, this.pos, this.yaw, this.vel.x, this.vel.z, hipY);
    this.shadow.position.set(this.pos.x, 0.07, this.pos.z);
    rig.root.updateMatrixWorld(true);
  }
}
