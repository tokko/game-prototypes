import * as THREE from 'three';
import { PAL, rnd, rr, clamp, damp, angDiff } from './util.js?v=32';
import { Legs } from './legs.js?v=32';
import { setupHeavy, resetHeavy, strike, tickHeavy, armOk, speedMul, spendEnergy, chargeDrain, chargeDone, chargeCancel, aiMayFire, isTargeted, splashEngines, foeWeak, wardTurn, flankPoint, heavyDown, COST } from './heavy.js?v=32';
import { makeHierarch } from './walker.js?v=32';
import { shieldMaterial } from './colossus.js?v=32';

// Hierarch-class battle colossus (model/hierarch.glb, spec model/battle-colossus-spec.md): the middle tier between the Kestrel
// scout engine and the great colossi. Same ward-shield / damage-state / topple rules as the colossi, but quicker on its feet and
// a real duel opponent: fusion blaster (right arm, charge tell), rotary macro-cannon (left arm), carapace missile pod.
// One engine per side; when it dies its replacement (the side's second name) strides in after the colossus respawn delay.
export const HIER_HP = 1300, HIER_SHIELD = 500;
const HIP = 28, TOP = 15, SLEW = 0.45 * 1.6, CHARGE = 1.2, BOLT = 120, RESPAWN = 110;   // RESPAWN: seconds from the kill until the replacement strides in
const NAMES = [["SAINT ORVANE'S FIST", 'THE IRON CANTOR'], ['EMBERWRIGHT', 'THE GRIEF-ENGINE']];
const RANGE = [0, 230, 170, 160, 220, 220, 200, 300];   // stand-off range by target kind: 1 engine, 2 scout, 3 player, 4 tank, 5 squad, 6 harrow
const _m = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _fp = new THREE.Vector3();

export class Hierarch {
  constructor(G, side, lane, startZ, holdZ) {
    this.G = G; this.side = side; this.dir = side === 0 ? -1 : 1; this.lane = lane; this.isHierarch = true; this.n = 0; this.name = NAMES[side][0];
    const scene = G.scene, rig = this.rig = makeHierarch(side);
    scene.add(rig.root);
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(30, 2), shieldMaterial(side));
    this.shield.position.y = 3; this.shield.scale.set(1, 1.1, 1); rig.torso.add(this.shield); this.shieldA = 0;
    this.legs = new Legs(scene, { hipW: 9, thighL: 14, shinL: 14.5, footH: 3, stride: 18, stepTime: 0.82, stepH: 4.5, refSpeed: TOP, knee: 1, makeParts: rig.legParts, onStep: f => this.onStep(f) });
    const sg = new THREE.CircleGeometry(20, 20); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); scene.add(this.shadow);
    // hit points (see rayHit): child empties along each arm and on the head, so the locational test and the shot test share one set
    const hpt = (par, x, y, z) => { const e = new THREE.Object3D(); e.position.set(x, y, z); par.add(e); return e; };
    setupHeavy(this, 'hierarch', HIER_HP, HIER_SHIELD, TOP, { head: hpt(rig.head, 0, 0.8, 1), armL: [rig.arm_L, hpt(rig.arm_L, 0, -2, 10), hpt(rig.arm_L, 0, -2, 19)], armR: [rig.arm_R, hpt(rig.arm_R, 0, -2, 10), hpt(rig.arm_R, 0, -2, 19)],
      reactor: rig.anchor_reactor, mp: rig.torso, rArm: 7, rHead: 5.5, legTop: 24, rearZ: -1.5 });
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.holdBase = holdZ; this.enter(startZ);
  }
  enter(z) {
    this.pos.set(this.lane, 0, z); this.yaw = this.dir > 0 ? 0 : Math.PI; this.torsoYaw = this.yaw; this.pitch = 0; this.vel.set(0, 0, 0);
    this.hp = HIER_HP; this.shieldHP = HIER_SHIELD; this.lastDmg = -99; this.firstDmg = -1; this.staggerT = 0; this.limpT = 0; this.grudge = 0; this.grudgeT = 0;
    this.lastHunt = -99; this.huntT = 0; this.hurtByPlayerT = -99; this.shotByColT = -99; this.state = 'alive'; this.t = 0; this.klaxT = 0;
    this.bob = 0; this.bobV = 0; this.speed = 0; this.sink = 0; this.lean = 0; this.tgt = null; this.tgtKind = 0; this.scanT = rnd();
    this.holdZ = this.holdBase; this.holdT = rr(16, 30); this.goal = null; this.charge = 0; this.flashT = 0; this.bCd = rr(2, 5); this.cT = rr(1, 3); this.burstLeft = 0; this.burstAcc = 0;
    this.podT = rr(3, 8); this.salvo = []; this.alarmT = 0; this.barrelSpin = 0; this.em = null; this.heat = 0; this.overheat = false;
    this.rig.root.visible = true; this.legs.setVisible(true); this.shadow.visible = true; this.legs.reset(this.pos, this.yaw); resetHeavy(this);
  }
  // test shots: stand the engine at (x, z), holding there
  place(x, z) { this.enter(z); this.pos.x = x; this.holdBase = this.holdZ = z; this.holdT = 99; this.lane = x; this.legs.reset(this.pos, this.yaw); }
  get alive() { return this.state === 'alive'; }
  chest(out) { return out.set(this.pos.x, 40 - this.sink, this.pos.z); }
  get limp() { return this.staggerT > 0 || this.limpT > 0 || this.hp < HIER_HP * 0.3; }
  onStep(f) { this.bobV -= this.limp && f.side > 0 ? 6 : 2.5; this.G.stomp(f.pos.x, f.pos.z, 8.5, this); }

  // ---- taking damage ----
  damage(amt, byPlayer, bypass, pt, hAmt, under) {
    if (!this.alive) return;
    const G = this.G; this.lastDmg = G.time; if (this.firstDmg < 0) this.firstDmg = G.time;
    if (byPlayer) { this.hurtByPlayerT = G.time; G.hitMark = 1; G.stats.hierDmg = (G.stats.hierDmg || 0) + amt; }
    if (byPlayer && this.side === 0) {   // keep shooting your own hierarch and it holds a grudge
      this.grudge += amt; G.ffKill('hier', true);
      if (this.grudge > 70 && !(this.grudgeT > 0)) { this.grudgeT = 24; this.grudge = 0; this.lastHunt = -99; this.huntT = 0; G.announce(this.name + ' TURNS ITS GUNS ON YOU'); }
    }
    const r = strike(this, amt, hAmt === undefined ? amt : hAmt, pt, bypass, byPlayer, under);   // shield first, then a component
    if (r.ab > 0) this.shieldA = Math.min(0.9, this.shieldA + 0.14 + r.ab * 0.004);
    if (r.down) { this.shieldA = 2.2; G.fx.flash(this.pos.x, 40, this.pos.z, 0.7, 0.9, 1, 7000, 0.45, 300); G.announce(this.name + ' - SHIELD DOWN'); }
    if (this.hp <= 0 || this.comp.reactor.hp <= 0) {
      this.state = 'dying'; this.t = 0; this.charge = 0; this.burstLeft = 0; this.salvo.length = 0; this.flashT = 0; heavyDown(this, byPlayer);
      (G.stats.hierKills = G.stats.hierKills || [0, 0])[this.side]++;
      G.announce(this.name + ' - REACTOR CRITICAL');
    }
  }
  // the player's sunspear: ignores every shield; legs and rear are the soft spots (1.6x) and stagger the engine for 10 s
  spearHit(d, leg, pt) {
    if (!this.alive) return;
    const G = this.G, rear = d.x * Math.sin(this.torsoYaw) + d.z * Math.cos(this.torsoYaw) > 0.3;
    if (!leg && this.shieldHP > 0) this.shieldA = 1.8;   // the lance passes straight through the ward (flare only, no absorb)
    this.damage(520 * (leg || rear ? 1.6 : 1), true, true, leg ? { x: pt.x, y: pt.y, z: pt.z, comp: 'legs', cap: 0.6 } : { x: pt.x, y: pt.y, z: pt.z, cap: 0.6 });
    if (leg || rear) { this.staggerT = 10; this.bobV -= 6; if (this.alive) G.announce(this.name + ' STAGGERS'); }
    G.fx.debris(pt.x, pt.y, pt.z, 8, 1.6, 22, 0.1); G.stats.spearCol = (G.stats.spearCol || 0) + 1;
  }
  // a great colossus foot came down on or near it: the leg actuators are crushed, half speed for 15 s
  stomped(x, z, r) {
    if (!this.alive || Math.hypot(this.pos.x - x, this.pos.z - z) > r + 8) return;
    if (!(this.limpT > 0)) this.G.announce(this.name + ' - LEG ACTUATORS CRUSHED');
    this.limpT = 15; this.bobV -= 8;
  }
  // ray vs the two legs, measured on model/hierarch.glb (thigh 6.6 x 8.5, shin 7.6 x 11.2, foot 8.6 x 5 x 17.6): per leg a capsule hip to ankle (radius 4.5)
  // and a foot capsule heel to toe (radius 3.5), sampled; returns {t} or null
  rayLeg(o, d, maxT) {
    if (!this.alive && this.state !== 'dying') return null;
    const lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw), hy = HIP - this.sink; let best = null;
    for (const f of this.legs.feet) {
      const hx = this.pos.x + lx * f.side * 7.4, hz = this.pos.z + lz * f.side * 7.4, fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      const ax = f.pos.x + fx * 0.8, ay = f.pos.y + 3, az = f.pos.z + fz * 0.8;   // ankle / foot centre (GLB foot z -8..9.6)
      for (const [x0, y0, z0, x1, y1, z1, r2, n] of [[f.pos.x, f.pos.y + 3, f.pos.z, hx, hy, hz, 20.25, 8], [ax - fx * 6, ay - 0.5, az - fz * 6, ax + fx * 8, ay - 0.5, az + fz * 8, 12.25, 3]]) for (let k = 0; k <= n; k++) {
        const u = k / n, px = x0 + (x1 - x0) * u - o.x, py = y0 + (y1 - y0) * u - o.y, pz = z0 + (z1 - z0) * u - o.z;
        const t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > maxT) continue;
        const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t;
        if (qx * qx + qy * qy + qz * qz < r2) { maxT = t; best = { t: Math.max(0, t - 3) }; }
      }
    }
    return best;
  }
  // hit volumes measured on the GLB (root space, rest pose): torso as stacked boxes in the torso-yaw frame (lat, y, fwd): hull and shoulders (+-18.5, y 30.7..40,
  // z +-10.5), upper hull (+-19, y 40..50, z -13.5..10.2), chapel (+-10.6, y 50..60, z -7.8..4.3), spire (+-5.3, y 60..66); pelvis (+-7.8, y 13.5..31.8, z -8.1..5.6)
  // in the leg-yaw frame; plus the locational spheres: head (r 5.5), arm points (r 7: housing, barrel, blaster / cannon). A ray hits the nearest of all of them.
  rayHit(o, d, maxT) {
    if (!this.alive && this.state !== 'dying') return -1;
    const px = this.pos.x - o.x, pz = this.pos.z - o.z, py = 40 - this.sink - o.y, bs = px * d.x + py * d.y + pz * d.z, bc = px * px + py * py + pz * pz - 1296;   // bounding sphere r 36
    if (bs * bs - bc < 0 || bs < -36) return -1;
    let best = -1; const g = this.geo;
    const hit = t => { if (t >= 0 && t <= maxT && (best < 0 || t < best)) best = t; };
    const sph = (cx, cy, cz, r) => { const x = cx - o.x, y = cy - o.y, z = cz - o.z, b = x * d.x + y * d.y + z * d.z, c = x * x + y * y + z * z - r * r, disc = b * b - c; if (disc >= 0) hit(b - Math.sqrt(disc)); };
    const boxes = (ang, list) => {   // slab test per oriented box; box = [cx, cy, cz (lat, y, fwd), hx, hy, hz]
      const cs = Math.cos(ang), sn = Math.sin(ang), ox = o.x - this.pos.x, oz = o.z - this.pos.z;
      const qx = ox * cs - oz * sn, qy = o.y + this.sink, qz = ox * sn + oz * cs, vx = d.x * cs - d.z * sn, vy = d.y, vz = d.x * sn + d.z * cs;
      for (const [cx, cy, cz, hx, hy, hz] of list) {
        let t0 = 0, t1 = 1e9, ok = true;
        for (const [q, v, c, h] of [[qx, vx, cx, hx], [qy, vy, cy, hy], [qz, vz, cz, hz]]) {
          if (Math.abs(v) < 1e-9) { if (Math.abs(q - c) > h) { ok = false; break; } continue; }
          let a = (c - h - q) / v, b = (c + h - q) / v; if (a > b) { const w = a; a = b; b = w; }
          t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
        }
        if (ok) hit(t0);
      }
    };
    boxes(this.torsoYaw, [[0, 35.35, 0, 18.5, 4.65, 10.5], [0, 45, -1.65, 19, 5, 11.85], [0, 55, -1.75, 10.6, 5, 6.05], [0, 63, -4.85, 5.3, 3, 2]]);
    boxes(this.yaw, [[0, 22.65, -1.25, 7.8, 9.15, 6.85]]);
    _v.setFromMatrixPosition(g.head.matrixWorld); sph(_v.x, _v.y, _v.z, g.rHead);
    for (const k of ['armL', 'armR']) for (const n of g[k]) { _v.setFromMatrixPosition(n.matrixWorld); sph(_v.x, _v.y, _v.z, g.rArm); }
    return best;
  }
  flame(o, d, range, dt, byPlayer) {
    if (!this.alive) return;
    for (const y of [8, 42]) {
      const px = this.pos.x - o.x, py = y - o.y, pz = this.pos.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > range + 5) continue;
      const w = 11 + t * 0.2; if (px * px + py * py + pz * pz - t * t > w * w) continue;
      this._src = o; this.damage(55 * dt, byPlayer); return;
    }
  }

  // ---- targeting: weights engine 1.0, scout 0.9, player 0.8 (Synod / grudge only, <= 220 m, line of sight), tank 0.6, squad 0.3 ----
  scan() {
    const G = this.G, pl = G.player, u = G.units; let best = null, bs = 0, kind = 0;
    const cand = (t, k, w, d, R) => { if (d >= R) return; const sc = w * (1 - d / R); if (sc > bs) { bs = sc; best = t; kind = k; } };
    const dist = (x, z) => Math.hypot(x - this.pos.x, z - this.pos.z);
    for (const h of G.hierarchs) if (h.side !== this.side && h.alive) cand(h, 1, 1.0 + foeWeak(h, this.pos.x, this.pos.z), dist(h.pos.x, h.pos.z), 480);   // +0.3 on an engine with a collapsed arc facing us
    if (G.time - this.shotByColT < 14) for (const c of G.colossi) if (c.side !== this.side && c.alive) cand(c, 1, 1.0 + foeWeak(c, this.pos.x, this.pos.z), dist(c.pos.x, c.pos.z), 700);   // a great colossus is only engaged once it has fired on us
    for (const s of G.scouts.list) if (s.side !== this.side && s.state === 'alive') cand(s, 2, 0.9, dist(s.pos.x, s.pos.z), 420);
    for (const h of G.harrows) if (h.side !== this.side && h.alive) cand(h, 6, 0.75 + foeWeak(h, this.pos.x, this.pos.z), dist(h.pos.x, h.pos.z), 450);
    for (const b of G.bastions) if (b.side !== this.side && b.hp > 0 && (!G.objectives || G.objectives.holds(this.side) >= 3)) { const st = b.gen.alive ? b.gen : b; cand(st, 7, 0.35, dist(st.pos.x, st.pos.z), 480); }   // the enemy ward generator, then the bastion
    if ((this.side === 1 || this.grudgeT > 0) && !pl.dead && !G.noHunt) {
      const pd = dist(pl.pos.x, pl.pos.z);
      if (pd < 220 && (this.huntT > 0 || G.time - this.lastHunt > 28 || G.time - this.hurtByPlayerT < 12) && G.city.los(this.pos.x, 40, this.pos.z, pl.pos.x, 9, pl.pos.z)) cand(pl, 3, 0.8, pd, 220);
    }
    for (const t of u.tanks) if (t.side !== this.side && t.alive) cand(t, 4, 0.6, dist(t.x, t.z), 340);
    for (const q of u.squads) if (q.side !== this.side && q.alive >= 3) cand(q, 5, 0.3, dist(q.lane, q.z), 300);
    const ot = this.ordTgt; if (ot && ot.alive) { best = ot; kind = ot.isHarrow ? 6 : 1; }   // ordered to KILL it
    if (kind === 3 && !(this.huntT > 0)) { this.huntT = rr(16, 26); this.lastHunt = G.time; }
    this.tgt = best; this.tgtKind = kind;
  }
  tgtPos(out) {
    const pa = this.curAim || this.aimPt; if (pa) return out.copy(pa);   // piloted: the crosshair point, or a locked arm's target
    const t = this.tgt, k = this.tgtKind;
    if (k === 1) return out.set(t.pos.x, 40, t.pos.z);
    if (k === 6) return out.set(t.pos.x, 30, t.pos.z);
    if (k === 7) return t.chest(out);
    if (k === 2) return out.set(t.pos.x, 16, t.pos.z);
    if (k === 3) return out.set(t.pos.x, 14, t.pos.z);
    if (k === 4) return out.set(t.x, 2.5, t.z);
    return out.set(t.lane, 1.5, t.z);
  }
  tgtAlive() { const t = this.tgt, k = this.tgtKind; return !!t && (k === 1 || k === 6 || k === 7 ? t.alive : k === 2 ? t.state === 'alive' : k === 3 ? !t.dead : k === 4 ? t.alive : t.alive > 0); }
  // lead a moving target by part of the bolt's flight time
  lead(out, k, speed) {
    const v = this.tgtKind === 2 || this.tgtKind === 3 ? this.tgt.vel : null; if (!v) return out;   // scouts and the player carry a velocity
    const tt = Math.hypot(out.x - _m.x, out.z - _m.z) / speed * k; out.x += v.x * tt; out.z += v.z * tt; return out;
  }

  update(dt) {
    const G = this.G, fx = G.fx;
    this.t += dt;
    if (this.state === 'gone') { if (G.time - this.diedAt > RESPAWN) { this.n ^= 1; this.name = NAMES[this.side][this.n]; this.enter(-this.dir * 720); G.announce(this.name + ' STRIDES INTO THE DISTRICT'); } return; }
    if (this.state !== 'alive') { this.updateWreck(dt); return; }
    if (this.piloted) return;   // the player is driving this engine: see pilotUpdate
    // ----- hold line, timers, shield regeneration, damage states -----
    this.holdT -= dt; if (this.holdT <= 0) { this.holdT = rr(16, 30); this.holdZ = this.holdBase + rr(-40, 40); }
    if (!this.tgt && !this.goal) this.holdBase = clamp(this.holdBase + this.dir * 2.5 * dt, -300, 300);   // the lane is clear: push toward the enemy bastion
    this.staggerT = Math.max(0, this.staggerT - dt); this.limpT = Math.max(0, this.limpT - dt); this.huntT = Math.max(0, this.huntT - dt);
    this.grudgeT = Math.max(0, this.grudgeT - dt); this.grudge = Math.max(0, this.grudge - 3 * dt);
    tickHeavy(this, dt);   // capacitors, planting and shield regeneration
    const frac = this.hp / HIER_HP, px = this.pos.x, pz = this.pos.z;
    if (frac < 0.72 && rnd() < dt * (4 + 18 * (0.72 - frac))) fx.smoke(px + rr(-12, 12), rr(30, 55), pz + rr(-8, 8), rr(-2, 2) + 2, rr(4, 9), rr(-2, 2), rr(3, 6), 5, 18, 0.05, 0.6, 0.2);
    if (frac < 0.46 && rnd() < dt * 12) { const k = rnd() < 0.5 ? 1 : -1; fx.fire(px + k * 11 + rr(-3, 3), (k > 0 ? 46 : 36) + rr(-2, 2), pz + rr(-5, 5), rr(-1, 1), rr(5, 10), rr(-1, 1), rr(0.5, 1.1), 7, 2.5, 3.4, rr(1, 1.6), 0.25, 0.9, 0.3); }
    if ((frac < 0.46 || this.staggerT > 0 || this.limpT > 0) && rnd() < dt * 2.5) { const lx = px + rr(-14, 14), ly = rr(12, 52), lz = pz + rr(-8, 8); fx.sparks(lx, ly, lz, 10, 22); fx.flash(lx, ly, lz, 1, 0.7, 0.3, 1200, 0.1, 100); }
    // ----- target -----
    this.scanT -= dt; if (this.scanT <= 0 || !this.tgtAlive()) { this.scanT = 0.7; this.scan(); }
    let dist = 1e9, ay = this.yaw, aimErr = 9, aimP = 0;
    const has = !!this.tgt;
    if (has) { this.tgtPos(_p); dist = Math.hypot(_p.x - px, _p.z - pz); ay = Math.atan2(_p.x - px, _p.z - pz); aimP = clamp(Math.atan2(_p.y - 36, Math.max(10, dist)), -0.5, 0.55); }
    // ----- legs: walk to the hold line, or close to stand-off range; the torso slews about 1.6x a great colossus -----
    // a target in reach (or no goal) is fought as before; an objective goal otherwise (targets of opportunity on the way, hold inside the ring); allies flank an engine that is engaging the player
    let want, spd; const gl = this.goal;
    if (has && (!gl || (!gl.wd && dist < RANGE[this.tgtKind] + 60))) {   // a withdrawing engine keeps walking home and fires on the way
      want = ay; spd = dist > RANGE[this.tgtKind] ? Math.min(TOP, 2 + (dist - RANGE[this.tgtKind]) * 0.25) : 0;
      if (this.tgtKind === 1 && flankPoint(this, this.tgt, RANGE[1] * 0.8, _fp)) { const fx = _fp.x - px, fz = _fp.z - pz, fd = Math.hypot(fx, fz); if (fd > 12) { want = Math.atan2(fx, fz); spd = Math.min(TOP, 2 + fd * 0.25); } }
    } else { const dx = (gl ? gl.x : this.lane) - px, dz = (gl ? gl.z : this.holdZ) - pz, gd = Math.hypot(dx, dz); want = gd > 8 ? Math.atan2(dx, dz) : has ? ay : (this.dir > 0 ? 0 : Math.PI); spd = gd > 8 ? Math.min(TOP * 0.75, 2 + gd * 0.15) : 0; }
    const slow = (this.limpT > 0 ? 0.5 : 1) * (this.staggerT > 0 ? 0.35 : 1) * (frac < 0.3 ? 0.5 : 1) * speedMul(this);
    this.yaw += clamp(angDiff(want, this.yaw) * 3, -1, 1) * 0.75 * (this.limp ? 0.6 : 1) * this.legMul * dt;   // leg turn 0.55 -> 0.75 (speed pass)
    if (Math.abs(angDiff(want, this.yaw)) > 0.9) spd = Math.min(spd, 3);
    this.speed = damp(this.speed, spd * slow, 1.23, dt);
    this.vel.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed); this.pos.x = clamp(px + this.vel.x * dt, -680, 680); this.pos.z = clamp(pz + this.vel.z * dt, -640, 640); if (G.objectives) G.objectives.collide(this.pos, 12);
    const wantT = clamp(angDiff(has ? ay : this.yaw, this.yaw), -1.6, 1.6) + this.yaw + (has ? wardTurn(this, ay, 0.12) : 0), slew = SLEW * (this.staggerT > 0 ? 0.5 : 1) * dt;
    this.torsoYaw += clamp(angDiff(wantT, this.torsoYaw), -slew, slew);
    if (has) aimErr = Math.abs(angDiff(ay, this.torsoYaw));
    this.pitch = damp(this.pitch, aimP, 3, dt);
    this.applyPose(dt);
    const rig = this.rig;

    // ----- fusion blaster: 1.2 s charge with a glow tell, slow heavy bolt, 6 s cooldown -----
    this.bCd = Math.max(0, this.bCd - dt * (this.staggerT > 0 ? 0.6 : 1)); let gk = 0;
    if (this.charge > 0) {
      this.charge += dt; gk = Math.min(1, this.charge / CHARGE); rig.anchor_blaster.getWorldPosition(_m);
      fx.fire(_m.x + rr(-1.5, 1.5), _m.y + rr(-1.5, 1.5), _m.z + rr(-1.5, 1.5), 0, 0, 0, 0.1, 2 + 7 * gk, 1, 0.6 * 2.4, 1.4 * 2.4, 2.6 * 2.4, 1);
      if (has && this.tgtKind === 3) { G.threat = G.threat || { col: this, t: CHARGE - this.charge, k: gk }; this.alarmT -= dt; if (this.alarmT <= 0) { this.alarmT = 0.5 - 0.25 * gk; G.sfx.alarm(); } }
      if (!has || this.tgtKind === 5) { this.charge = 0; this.bCd = 1.5; }
      else if (this.charge >= CHARGE && aimErr < 0.14) this.fireBlaster();
      else if (this.charge > CHARGE + 3) { this.charge = 0; this.bCd = 2; }
    } else if (has && this.bCd <= 0 && armOk(this, 'armR') && aiMayFire(this, COST.blaster, isTargeted(this)) && this.tgtKind !== 5 && dist < 360 && dist > 30 && aimErr < 0.2 && G.city.los(px, 36, pz, _p.x, Math.max(_p.y, 3), _p.z)) {
      this.charge = 1e-4; this.alarmT = 0; G.sfx.charge(CHARGE, Math.min(0.25, 40 / Math.max(40, fx.camDist(px, 40, pz))));
    } else if (has && this.tgtKind === 3 && !G.threat) G.threat = { col: this, t: 0, k: 0 };   // targeting the player but not yet charging: it has seen you
    if (this.charge <= 0 && this.flashT > 0) { this.flashT -= dt; gk = 3.2 * Math.max(0, this.flashT / 0.14); }   // flash, then drop
    rig.nozzleMat.color.setRGB(0.6 * gk, 1.4 * gk, 2.6 * gk);

    // ----- rotary macro-cannon: 6-round bursts every 3.5 s -----
    this.cT -= dt; this.barrelSpin = damp(this.barrelSpin, this.burstLeft > 0 ? 24 : 1.5, 6, dt); rig.barrels_L.rotation.z += this.barrelSpin * dt;
    if (this.burstLeft > 0) { this.burstAcc -= dt; if (this.burstAcc <= 0) { this.burstAcc = 0.11; this.burstLeft--; if (has) this.fireRound(); else this.burstLeft = 0; } }
    else if (has && this.cT <= 0 && armOk(this, 'armL') && dist < 260 && dist > 12 && aimErr < 0.25) {
      rig.anchor_cannon.getWorldPosition(_m);
      if (G.city.los(_m.x, _m.y, _m.z, _p.x, Math.max(_p.y, 3), _p.z)) { this.burstLeft = 6; this.burstAcc = 0; this.cT = 3.5; } else this.cT = 1;
    }
    // ----- carapace missile pod: volleys of 6 at aircraft within 400 m (8 s), else a ground salvo at an infantry cluster -----
    this.podT -= dt; if (this.podT <= 0) this.firePod();
    for (let i = this.salvo.length - 1; i >= 0; i--) { const s = this.salvo[i]; s.t -= dt; if (s.t <= 0) { this.salvo.splice(i, 1); this.launch(s); } }
    // ----- crushing stacks -----
    if (rnd() < dt * 5) fx.smoke(px + rr(-4, 4), 52, pz - Math.cos(this.torsoYaw) * 4, rr(-1, 1) + 2, rr(5, 9), rr(-1, 1), rr(4, 7), 4, 18, 0.05, 0.55, 0.15);
  }

  // ---- piloted by the player (PlayerClass 'hierarch'): the Player owns movement; this runs the weapons and the pose ----
  pilotUpdate(dt, inp) {
    const G = this.G, fx = G.fx, rig = this.rig, frac = this.hp / HIER_HP;
    this.t += dt; this.staggerT = Math.max(0, this.staggerT - dt); this.limpT = Math.max(0, this.limpT - dt);
    this.bCd = Math.max(0, this.bCd - dt * (this.staggerT > 0 ? 0.6 : 1)); this.podT = Math.max(0, this.podT - dt);
    tickHeavy(this, dt);   // capacitors, planting and shield regeneration
    if (frac < 0.72 && rnd() < dt * (4 + 18 * (0.72 - frac))) fx.smoke(this.pos.x + rr(-12, 12), rr(30, 55), this.pos.z + rr(-8, 8), rr(-2, 2) + 2, rr(4, 9), rr(-2, 2), rr(3, 6), 5, 18, 0.05, 0.6, 0.2);
    if ((frac < 0.46 || this.staggerT > 0 || this.limpT > 0) && rnd() < dt * 2.5) fx.sparks(this.pos.x + rr(-14, 14), rr(12, 52), this.pos.z + rr(-8, 8), 10, 22);
    // LMB: rotary macro-cannon, held fire with spin-up and overheat
    const firing = inp.fire1 && !this.overheat && armOk(this, 'armL');
    this.barrelSpin = damp(this.barrelSpin, firing ? 24 : 1.5, 4, dt); rig.barrels_L.rotation.z += this.barrelSpin * dt;
    if (firing && this.barrelSpin > 14) { this.burstAcc -= dt; if (this.burstAcc <= 0) { this.burstAcc = 0.11; this.curAim = this.aimL; this.fireRound(); this.curAim = null; this.heat += 0.06; if (this.heat >= 1) { this.heat = 1; this.overheat = true; G.announce('MACRO-CANNON OVERHEAT'); } } }
    else this.heat = Math.max(0, this.heat - dt * 0.3);
    if (this.overheat && this.heat < 0.4) this.overheat = false;
    if (this.ocT > 0) { this.heat = 0; this.overheat = false; }   // OVERCHARGE: no overheating
    // RMB: fusion blaster, 1.2 s charge with the glow tell, slow heavy bolt to the crosshair
    if (inp.fire2 && this.charge <= 0 && this.bCd <= 0 && armOk(this, 'armR')) { this.charge = 1e-4; G.sfx.charge(CHARGE, 0.25); }
    let gk = 0;
    if (this.charge > 0) {
      this.charge += dt; gk = Math.min(1, this.charge / CHARGE); rig.anchor_blaster.getWorldPosition(_m);
      fx.fire(_m.x + rr(-1.5, 1.5), _m.y + rr(-1.5, 1.5), _m.z + rr(-1.5, 1.5), 0, 0, 0, 0.1, 2 + 7 * gk, 1, 0.6 * 2.4, 1.4 * 2.4, 2.6 * 2.4, 1);
      if (this.charge >= CHARGE) { this.curAim = this.aimR; this.fireBlaster(); this.curAim = null; }
    } else if (this.flashT > 0) { this.flashT -= dt; gk = 3.2 * Math.max(0, this.flashT / 0.14); }
    rig.nozzleMat.color.setRGB(0.6 * gk, 1.4 * gk, 2.6 * gk); this.pending = this.charge > 0 ? COST.blaster : 0;
    // Q: missile pod, 6-missile volley; locks on to an aircraft under the crosshair, else a salvo at the crosshair ground point
    if (inp.aa && !this.qHeld && this.podT <= 0 && this.aimPt) {
      G.camera.getWorldDirection(_d); const lk = G.air.lockCandidate(G.camera.position, _d);
      for (let i = 0; i < 6; i++) this.salvo.push(lk ? { t: i * 0.12, air: lk } : { t: i * 0.12, cl: { lane: this.aimPt.x, z: this.aimPt.z } });
      this.podT = 8;
    }
    this.qHeld = inp.aa;
    for (let i = this.salvo.length - 1; i >= 0; i--) { const s = this.salvo[i]; s.t -= dt; if (s.t <= 0) { this.salvo.splice(i, 1); this.launch(s); } }
    this.applyPose(dt);
  }
  pilotHud() {   // [fraction, text] for LMB, RMB, Q
    const f = (a, b) => [Math.max(0, Math.min(1, a)), b];
    return [this.overheat ? f(1 - this.heat, 'HOT') : f(1 - this.heat, this.heat > 0.02 ? (this.heat * 100).toFixed(0) : 'RDY'),
      this.charge > 0 ? f(this.charge / CHARGE, 'CHG') : f(1 - this.bCd / 6, this.bCd > 0 ? this.bCd.toFixed(1) : 'RDY'),
      f(1 - this.podT / 8, this.podT > 0 ? this.podT.toFixed(0) : 'RDY')];
  }

  fireBlaster() {
    const G = this.G, fx = G.fx, pl = G.player, side = this.piloted ? -1 : this.side, bp = !!this.piloted;
    this.charge = 0; this.bCd = 6; this.flashT = 0.14; spendEnergy(this, COST.blaster);
    this.rig.anchor_blaster.getWorldPosition(_m); this.tgtPos(_p); this.lead(_p, 0.5, BOLT);
    _d.subVectors(_p, _m); const dist = _d.length() || 1; _d.multiplyScalar(1 / dist);
    const h = G.shoot(_m, _d, 800, side, { probe: true, radius: 1.8 });
    let hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref;
    if (!pl.dead) {   // the player is not in the general hitscan
      const qx0 = pl.pos.x - _m.x, qy0 = 15 - _m.y, qz0 = pl.pos.z - _m.z, t = qx0 * _d.x + qy0 * _d.y + qz0 * _d.z;
      if (t > 0 && t < h.t) { const qx = qx0 - _d.x * t, qy = qy0 - _d.y * t, qz = qz0 - _d.z * t; if (qx * qx + qy * qy + qz * qz < 60) { const tt = Math.max(0, t - 4); hx = _m.x + _d.x * tt; hy = _m.y + _d.y * tt; hz = _m.z + _d.z * tt; type = 'player'; } }
    }
    const ox = _m.x, oz = _m.z, dx = _d.x, dz = _d.z, cd = fx.camDist(_m.x, _m.y, _m.z);
    fx.tracer(_m.x, _m.y, _m.z, hx, hy, hz, BOLT, 24, 3.0, 1.6, 3.2, 5.5, () => {
      fx.explosion(hx, hy, hz, 3.0); fx.debris(hx, hy, hz, 4, 1.4, 26, 0.1);
      G.units.blast(hx, hy, hz, 8, 260, side, bp); G.scouts.blast(hx, hy, hz, 8, 260, side, bp);   // kills tanks and infantry, 260 at the centre to a scout
      if (!pl.dead && hy < 24 && Math.hypot(pl.pos.x - hx, pl.pos.z - hz) < 9) pl.damage(35, 'hull', ox, oz);   // the veil absorbs normally
      if ((type === 'col' || type === 'hier' || type === 'harrow' || type === 'struct') && ref.alive) ref.damage(120, bp, false, { x: hx, y: hy, z: hz }, 420);   // S 120, H 420 against engines
      else if (type === 'bld') G.city.damage(ref, 600, dx, dz, false, bp);
      if (hy < 6) G.city.crush(hx, hz, 5);
    });
    fx.muzzle(_m, _d, 6, 1.5, 3, 5.5); fx.flash(_m.x, _m.y, _m.z, 0.6, 1.4, 2.6, 6000, 0.5, 300);
    G.sfx.lance(cd); G.shakeAt(_m.x, _m.y, _m.z, 2.5); this.bobV -= 3;
  }
  fireRound() {
    const G = this.G, fx = G.fx, pl = G.player, side = this.side, T = PAL[side].tracer, sh = this.piloted ? -1 : side, bp = !!this.piloted;
    this.rig.anchor_cannon.getWorldPosition(_m); this.tgtPos(_p); this.lead(_p, 0.5, 520);
    const dist = Math.hypot(_p.x - _m.x, _p.z - _m.z), sp = (0.025 + dist * 0.00006) * this.spreadMul;
    _d.set(_p.x - _m.x + rr(-1, 1) * sp * dist, _p.y - _m.y + rr(-1, 1) * sp * dist * 0.6, _p.z - _m.z + rr(-1, 1) * sp * dist).normalize();
    const h = G.shoot(_m, _d, 600, sh, { probe: true, radius: 1.4 });
    let hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref;
    if (!pl.dead) {
      const qx0 = pl.pos.x - _m.x, qy0 = 15 - _m.y, qz0 = pl.pos.z - _m.z, t = qx0 * _d.x + qy0 * _d.y + qz0 * _d.z;
      if (t > 0 && t < h.t) { const qx = qx0 - _d.x * t, qy = qy0 - _d.y * t, qz = qz0 - _d.z * t; if (qx * qx + qy * qy + qz * qz < 42) { const tt = Math.max(0, t - 4); hx = _m.x + _d.x * tt; hy = _m.y + _d.y * tt; hz = _m.z + _d.z * tt; type = 'player'; } }
    }
    const ox = _m.x, oz = _m.z, dx = _d.x, dz = _d.z, cd = fx.camDist(_m.x, _m.y, _m.z);
    fx.tracer(_m.x, _m.y, _m.z, hx, hy, hz, 520, 18, 0.8, T[0] * 1.6, T[1] * 1.6, T[2] * 1.6, () => {
      fx.explosion(hx, hy, hz, 0.7, { silent: cd > 400, noDebris: true });
      if (type === 'tank') G.units.damageTank(ref, 35);   // plus splash: two rounds kill a tank
      else if (type === 'scout') G.scouts.damage(ref, 25, bp, ox, oz);
      else if (type === 'player') pl.damage(4, rnd() < 0.4 ? 'leg' : 'hull', ox, oz);
      else if (type === 'air') G.air.damage(ref, 30, bp);
      else if (type === 'col' || type === 'hier' || type === 'harrow' || type === 'struct') ref.damage(3, bp, false, { x: hx, y: hy, z: hz }, 5);   // S 3, H 5 against engines
      else if (type === 'bld') G.city.damage(ref, 60, dx, dz, false, bp);
      G.units.blast(hx, hy, hz, 3.5, 30, side, bp);   // splash kills infantry
    });
    if (cd < 600) { fx.muzzle(_m, _d, 2.4, T[0] * 1.5, T[1] * 1.5, T[2] * 1.5); fx.flash(_m.x, _m.y, _m.z, 1, 0.7, 0.3, 2000, 0.08, 120); G.sfx.boom(cd, 0.45); }
  }
  firePod() {
    const G = this.G, ap = G.air.list; this.rig.anchor_pod.getWorldPosition(_m);
    let best = null, bd = 400;
    for (const a of ap) { if (a.side === this.side || !a.alive || a.falling) continue; const d = a.pos.distanceTo(_m); if (d < bd) { bd = d; best = a; } }
    if (best) { for (let i = 0; i < 6; i++) this.salvo.push({ t: i * 0.12, air: best }); this.podT = 8; return; }
    const cl = G.units.findCluster(this.side, this.pos.x, this.pos.z + this.dir * 100, 340);
    if (cl && G.city.los(_m.x, _m.y, _m.z, cl.lane, 4, cl.z)) { for (let i = 0; i < 6; i++) this.salvo.push({ t: i * 0.12, cl }); this.podT = 8; } else this.podT = 2.5;
  }
  launch(s) {
    const G = this.G, fx = G.fx, side = this.side, bp = !!this.piloted; this.rig.anchor_pod.getWorldPosition(_m);
    let hx, hy, hz, a = s.air;
    if (a) {
      if (!a.alive || a.falling) return;
      const lt = _m.distanceTo(a.pos) / 170; hx = a.pos.x + a.dir.x * a.speed * lt + rr(-4, 4); hy = a.pos.y + a.dir.y * a.speed * lt + rr(-3, 3); hz = a.pos.z + a.dir.z * a.speed * lt + rr(-4, 4);
    } else { hx = s.cl.lane + rr(-18, 18); hy = 0.5; hz = s.cl.z + rr(-18, 18); }
    _d.set(hx - _m.x, hy - _m.y, hz - _m.z).normalize(); const cd = fx.camDist(_m.x, _m.y, _m.z);
    fx.tracer(_m.x, _m.y, _m.z, hx, hy, hz, a ? 170 : 140, 9, 0.7, 3, 1.7, 0.6, () => {
      fx.explosion(hx, hy, hz, a ? 0.8 : 1.2, { silent: fx.camDist(hx, hy, hz) > 500, noDebris: !!a });
      if (a) { if (a.alive && !a.falling && a.pos.distanceTo(_v.set(hx, hy, hz)) < 28) G.air.damage(a, 55, bp); }
      else { G.blast(hx, 0.5, hz, 6, 60, side, bp); splashEngines(G, hx, 0.5, hz, 6, 65, 15, bp, this, true); }   // S 65, H 15 per missile against engines; a shield-breaker
    });
    fx.muzzle(_m, _d, 1.6, 3, 2, 1); for (let k = 0; k < 3; k++) fx.smoke(_m.x, _m.y, _m.z, -_d.x * rr(2, 8), rr(1, 4), -_d.z * rr(2, 8), rr(1.2, 2.2), 2, 8, 0.4, 0.5, 0.5);
    if (cd < 600) G.sfx.missile();
  }

  // death: reactor goes critical (glow + klaxon), the hull topples forward and detonates; then a burning wreck that sinks away
  updateWreck(dt) {
    const G = this.G, fx = G.fx;
    if (this.state === 'dying') {
      const fxx = Math.sin(this.torsoYaw), fzz = Math.cos(this.torsoYaw), cd = fx.camDist(this.pos.x, 40, this.pos.z), pulse = 0.55 + 0.45 * Math.sin(this.t * 13);
      this.rig.anchor_reactor.getWorldPosition(_m);
      fx.fire(_m.x + rr(-2, 2), _m.y + rr(-2, 2), _m.z + rr(-2, 2), 0, 0, 0, 0.12, (8 + 24 * Math.min(1, this.t / 3)) * pulse, 3, 4, 2.0, 0.7, 1);
      this.klaxT -= dt; if (this.klaxT <= 0) { this.klaxT = 0.7; G.sfx.klaxon(Math.min(0.25, 50 / Math.max(60, cd))); fx.flash(_m.x, _m.y, _m.z, 1, 0.45, 0.15, 6000, 0.35, 260); }
      if (rnd() < dt * 4) { const y = rr(15, 60); fx.explosion(this.pos.x + rr(-14, 14), y, this.pos.z + rr(-9, 9), rr(0.9, 2)); fx.debris(this.pos.x + rr(-14, 14), y, this.pos.z, 3, 1.5, 24, 0.08); }
      if (this.t > 3) { this.lean = Math.min(1.25, this.lean + dt * (0.15 + (this.t - 3) * 0.4)); this.sink = Math.min(11, this.sink + dt * 4.5); }
      if (this.t > 5.5) {
        this.state = 'wreck'; this.t = 0;
        const cx = this.pos.x + fxx * 24, cz = this.pos.z + fzz * 24;
        fx.explosion(this.pos.x, 20, this.pos.z, 4.5); fx.explosion(cx, 10, cz, 4.5, { silent: true }); fx.explosion(cx + fxx * 16, 6, cz + fzz * 16, 3.2, { silent: true });
        for (let k = 0; k < 32; k++) {   // shockwave ring
          const a = k / 32 * 6.283, c = Math.cos(a), sn = Math.sin(a);
          fx.smoke(cx + c * 10, 3, cz + sn * 10, c * rr(40, 60), rr(1, 5), sn * rr(40, 60), rr(2, 4), 10, 32, 0.15, 0.6, 1.1);
          if (k % 2) fx.fire(cx + c * 7, 2, cz + sn * 7, c * 70, 2, sn * 70, 0.45, 7, 2.5, 3.5, 1.6, 0.4, 1, 1.2);
        }
        fx.debris(cx, 10, cz, 14, 2.2, 30, 0.09);
        G.shakeAt(cx, 0, cz, 12); G.sfx.boom(cd, 3); G.skyFlash = 1.2;
        G.blast(cx, 0, cz, 44, 300, -1); G.blast(this.pos.x, 0, this.pos.z, 28, 300, -1);
        for (const dd of [18, 42]) { const b = G.city.lot(this.pos.x + fxx * dd, this.pos.z + fzz * dd); if (b) G.city.damage(b, 4000, fxx, fzz); }
        this.em = fx.addEmitter(cx, 16, cz, 5, 26); fx.addEmitter(this.pos.x, 22, this.pos.z, 4, 26);
        G.announce(this.name + ' HAS FALLEN');
      }
    } else {
      if (this.t > 16) { this.sink += dt * 10; fx.smoke(this.pos.x + rr(-16, 16), rr(0, 14), this.pos.z + rr(-16, 16), rr(-6, 6), rr(2, 8), rr(-6, 6), rr(3, 6), 12, 36, 0.13, 0.6); }
      if (this.t > 28) { this.state = 'gone'; this.t = 0; this.rig.root.visible = false; this.legs.setVisible(false); this.shadow.visible = false; return; }
    }
    this.applyPose(dt);
  }
  applyPose(dt) {
    const rig = this.rig;
    this.bobV += (-this.bob * 22 - this.bobV * 4) * dt; this.bob += this.bobV * dt;
    this.shieldA = Math.max(0, this.shieldA - dt * 0.9); this.shield.material.uniforms.uA.value = this.shieldA; this.shield.visible = this.shieldA > 0.01 || this.wardFx > 0.01;
    const hipY = HIP + this.bob - this.sink - Math.min(Math.abs(this.speed), TOP) / TOP * 0.8;
    rig.root.position.set(this.pos.x, 0, this.pos.z); rig.root.rotation.y = this.yaw;
    rig.body.position.y = hipY; rig.body.rotation.set(this.lean + this.speed * 0.004, 0, (this.staggerT > 0 || this.limpT > 0) && this.alive ? Math.sin(this.t * 2.6) * 0.05 : 0);
    rig.torso.rotation.y = angDiff(this.torsoYaw, this.yaw); rig.arm_L.rotation.x = rig.arm_R.rotation.x = -this.pitch;
    if (!armOk(this, 'armL')) rig.arm_L.rotation.x = 0.9; if (!armOk(this, 'armR')) rig.arm_R.rotation.x = 0.9;   // a destroyed arm droops
    this.legs.update(dt, this.pos, this.yaw, this.vel.x, this.vel.z, hipY);
    this.shadow.position.set(this.pos.x, 0.07, this.pos.z);
    rig.root.updateMatrixWorld(true);
  }
}
