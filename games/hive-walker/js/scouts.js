import * as THREE from 'three';
import { PAL, rnd, rr, clamp, damp, angDiff, approach } from './util.js?v=32';
import { Legs } from './legs.js?v=32';
import { makeWalker, WALKER } from './walker.js?v=32';
import { FACS, faceYaw, faceFrac } from './heavy.js?v=32';

// AI scout engines: the same Kestrel-class walker the player drives, in either livery. They hunt along the streets,
// duel each other, shell armour, flame infantry and (Pyre Synod only) go after the player. All damage is shared with the
// rest of the world: blasts, the player's guns and flame, colossus feet, and their own side's stray shells hurt them.
const HP = 650, VEIL = 200, SPEED = 28, RESPAWN = [40, 55];   // SPEED 21 -> 28: the Kestrel stays 1.3x the Harrow's new 21 m/s top (spec section 6)
const _m = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _p = new THREE.Vector3();

export class Scouts {
  constructor(G) {
    this.G = G; this.list = [];
    // two Synod hunters, one Vigil escort: enough to matter, not enough to swarm the player
    for (const [side, lane, z, name] of [[1, -108, -300, 'ASHHOUND'], [1, 108, -430, 'CINDER-STALKER'], [0, -28, 330, 'VIGILANT THORN']]) this.list.push(this.make(side, lane, z, name));
  }
  make(side, lane, z, name) {
    const G = this.G, rig = makeWalker(side);
    const s = { side, lane, name, rig, dir: side === 0 ? -1 : 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), goal: new THREE.Vector3() };
    G.scene.add(rig.root);
    s.legs = new Legs(G.scene, {
      hipW: WALKER.hipW, thighL: WALKER.thighL, shinL: WALKER.shinL, metaL: WALKER.metaL, metaLean: WALKER.metaLean, footH: WALKER.footH,
      stride: 12, stepTime: 0.42, stepH: 2.9, refSpeed: SPEED, knee: 1, makeParts: rig.legParts, onStep: f => this.onStep(s, f),
    });
    s.veilMat = G.player.veilMat.clone();
    s.veilMesh = new THREE.Mesh(G.player.veilMesh.geometry, s.veilMat); s.veilMesh.renderOrder = 13; s.veilMesh.visible = false; G.scene.add(s.veilMesh);
    const sg = new THREE.CircleGeometry(9, 16); sg.rotateX(-Math.PI / 2);
    s.shadow = new THREE.Mesh(sg, G.player.shadow.material); G.scene.add(s.shadow);
    this.place(s, lane, z);
    return s;
  }
  place(s, x, z) {
    s.pos.set(x, 0, z); this.G.city.collideCircle(s.pos, 7);
    s.vel.set(0, 0, 0); s.yaw = s.aim = s.dir > 0 ? 0 : Math.PI; s.speed = 0; s.hp = HP; s.veil = VEIL; s.veilK = 0; s.lastHit = -99; s.hitByPlayerT = -99;
    s.state = 'alive'; s.t = 0; s.tgt = null; s.tgtKind = 0; s.scanT = rnd(); s.cd = rr(1.5, 3); s.recoil = 0; s.flameK = 0; s.heat = 0; s.bob = 0; s.bobV = 0; s.pitch = 0; s.roll = 0;
    s.orbit = rnd() < 0.5 ? 1 : -1; s.orbitT = rr(3, 7); s.slideT = 0; s.slideS = 1; s.hipY = WALKER.hipY; s.em = null;
    s.rig.root.visible = true; s.legs.setVisible(true); s.shadow.visible = true; s.legs.reset(s.pos, s.yaw);
    s.rig.body.rotation.set(0, 0, 0); s.rig.arm_L.rotation.x = s.rig.arm_R.rotation.x = 0; s.rig.root.position.y = 0;
  }
  alive(s) { return s.state === 'alive'; }
  count(side) { let n = 0; for (const s of this.list) if (s.side === side && s.state === 'alive') n++; return n; }

  // ---- taking damage ----
  ray(o, d, maxT, side) {
    let best = null, bt = maxT;
    for (const s of this.list) {
      if (s.state !== 'alive' || s.side === side) continue;
      for (const [y, r2] of [[18, 46], [8, 30]]) {
        const px = s.pos.x - o.x, py = y - o.y, pz = s.pos.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > bt) continue;
        const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t; if (qx * qx + qy * qy + qz * qz < r2) { bt = Math.max(0, t - 4); best = s; }
      }
    }
    return best ? { t: bt, s: best } : null;
  }
  damage(s, amt, byPlayer = false, fx = null, fz = null, bypass = false) {
    if (s.state !== 'alive' || amt <= 0) return;
    const G = this.G; s.lastHit = G.time;
    if (s.side === 1 && !byPlayer && G.hornT > 0) amt *= 1.25;   // WAR HORN: allied units deal +25%
    if (byPlayer) { s.hitByPlayerT = G.time; G.hitMark = 1; if (s.side === 0) G.ffKill('scout', true); }
    if (s.veil > 0 && !bypass) {
      const ab = Math.min(s.veil, amt); s.veil -= ab; amt -= ab;
      const dx = fx === null ? rr(-1, 1) : fx - s.pos.x, dz = fz === null ? rr(-1, 1) : fz - s.pos.z, l = Math.hypot(dx, dz) || 1;
      s.veilMat.uniforms.uHit.value.set(dx / l * 0.9, 0.25, dz / l * 0.9).normalize(); s.veilK = Math.min(0.75, s.veilK + 0.22 + ab * 0.003);
      if (s.veil <= 0) { G.fx.flash(s.pos.x, 14, s.pos.z, 0.5, 0.8, 1, 5000, 0.3, 120); G.fx.sparks(s.pos.x, 14, s.pos.z, 30, 30, 1.2, 2.4, 4.5); if (G.fx.camDist(s.pos.x, 10, s.pos.z) < 300) G.sfx.veilBreak(); }
      if (amt < 0.5) return;
    }
    s.hp -= amt;
    if (amt > 20) { G.fx.sparks(s.pos.x, 13, s.pos.z, 10, 18); G.fx.debris(s.pos.x, 13, s.pos.z, 2, 0.8, 14, 0.1); }
    if (s.hp <= 0) this.kill(s, byPlayer);
  }
  kill(s, byPlayer) {
    const G = this.G; s.state = 'dying'; s.t = 0; s.tgt = null; s.hp = 0; s.veil = 0; s.veilMesh.visible = false;
    s.fallDir = s.speed > -2 ? 1 : -1; s.fallRoll = rr(-0.5, 0.5); s.hit = false;
    G.fx.explosion(s.pos.x, 13, s.pos.z, 1.6); G.fx.debris(s.pos.x, 13, s.pos.z, 8, 1.2, 22, 0.1);
    G.stats.scoutKills = G.stats.scoutKills || [0, 0]; G.stats.scoutKills[s.side]++;
    if (byPlayer) { if (s.side === 1) { G.stats.kScout = (G.stats.kScout || 0) + 1; G.killTick = 1; if (G.wrath) G.wrath.gain(4); G.announce('SYNOD SCOUT ENGINE ' + s.name + ' DESTROYED'); } else { G.ffKill('scout'); G.announce('YOU HAVE KILLED THE ' + s.name); } }
    else if (G.fx.camDist(s.pos.x, 10, s.pos.z) < 500) G.announce((s.side === 0 ? 'VIGIL' : 'SYNOD') + ' SCOUT ENGINE ' + s.name + ' IS DOWN');
  }
  blast(x, y, z, r, dmg, side, byPlayer) {
    if (y > 32) return;
    for (const s of this.list) { if (s.state !== 'alive') continue; const d = Math.hypot(s.pos.x - x, s.pos.z - z); if (d < r + 6) this.damage(s, dmg * (1 - d / (r + 7)), byPlayer, x, z); }
  }
  flame(o, d, range, dt, byPlayer, skip) {
    for (const s of this.list) {
      if (s.state !== 'alive' || s === skip) continue;
      const px = s.pos.x - o.x, py = 10 - o.y, pz = s.pos.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > range + 5) continue;
      const w = 7 + t * 0.2; if (px * px + py * py + pz * pz - t * t > w * w) continue;
      this.damage(s, 70 * dt, byPlayer, o.x, o.z);
    }
  }
  stomp(x, z, r, dmg = 0) { for (const s of this.list) if (s.state === 'alive' && Math.hypot(s.pos.x - x, s.pos.z - z) < r * 0.85) { s.veil = 0; this.damage(s, dmg || 9999); } }   // dmg: a hierarch's foot deals 250, a great colossus's kills outright

  onStep(s, f) {
    const G = this.G, d = G.fx.camDist(f.pos.x, 0, f.pos.z);
    s.bobV -= 3;
    if (d < 420) { G.fx.dust(f.pos.x, 0.4, f.pos.z, 1.2, d < 200 ? 4 : 2, 0.17, 0.4); if (d < 160) { G.fx.sparks(f.pos.x, 0.4, f.pos.z, 2, 8, 2.5, 1.6, 0.6, 0.4); G.sfx.stomp(d * 2.2, 0.3); G.shakeAt(f.pos.x, 0, f.pos.z, 0.9); } }
    G.streets.crush(f.pos.x, f.pos.z, 3.4, s.vel.x, s.vel.z); G.city.crush(f.pos.x, f.pos.z, 3.4); G.units.crush(f.pos.x, f.pos.z, 3.2, 1 - s.side);
  }

  // ---- thinking ----
  // allied Kestrels escort a piloted heavy: engage melta teams, tanks and enemy Kestrels within 150 m of the player (those near its rear first)
  scanEscort(s) {
    const G = this.G, pl = G.player, u = G.units, px = pl.pos.x, pz = pl.pos.z, rx = px - Math.sin(pl.legYaw) * 40, rz = pz - Math.cos(pl.legYaw) * 40; let best = null, bs = 1e9, kind = 0;
    for (const e of this.list) { if (e.side === s.side || e.state !== 'alive' || Math.hypot(e.pos.x - px, e.pos.z - pz) > 150) continue; const d = e.pos.distanceTo(s.pos) * (Math.hypot(e.pos.x - rx, e.pos.z - rz) < 60 ? 0.2 : 0.7); if (d < bs) { bs = d; best = e; kind = 1; } }
    for (const t of u.tanks) { if (t.side === s.side || !t.alive || Math.hypot(t.x - px, t.z - pz) > 150) continue; const d = Math.hypot(t.x - s.pos.x, t.z - s.pos.z) * 0.8; if (d < bs) { bs = d; best = t; kind = 3; } }
    for (const q of u.squads) { if (q.side === s.side || q.alive < 3 || !q.melta || Math.hypot(q.lane - px, q.z - pz) > 150) continue; const d = Math.hypot(q.lane - s.pos.x, q.z - s.pos.z) * 0.5; if (d < bs) { bs = d; best = q; kind = 4; } }
    s.tgt = best; s.tgtKind = kind;
  }
  scan(s) {
    if (s.side === 0 && s.ordTgt && s.ordTgt.alive) { const t = s.ordTgt; s.tgt = t; s.tgtKind = t.isHarrow ? 6 : t.isHierarch ? 5 : 7; return; }   // ordered to harass an engine: its weakest ward facing (kinds 5-7)
    if (s.side === 0 && s.ordPt) {   // ordered to sweep a point: the nearest foe within 110 m of it
      const P = s.ordPt, u2 = this.G.units; let b = null, bd = 1e9, k = 0;
      for (const e of this.list) if (e.side !== 0 && e.state === 'alive') { const d = Math.hypot(e.pos.x - P.x, e.pos.z - P.z); if (d < 110 && d < bd) { bd = d; b = e; k = 1; } }
      for (const t of u2.tanks) if (t.side !== 0 && t.alive) { const d = Math.hypot(t.x - P.x, t.z - P.z); if (d < 90 && d * 0.8 < bd) { bd = d * 0.8; b = t; k = 3; } }
      for (const q of u2.squads) if (q.side !== 0 && q.alive >= 3) { const d = Math.hypot(q.lane - P.x, q.z - P.z); if (d < 90 && d < bd) { bd = d; b = q; k = 4; } }
      if (b) { s.tgt = b; s.tgtKind = k; return; }
    }
    if (s.side === 0 && this.G.player.heavy && !this.G.player._dead) return this.scanEscort(s);
    const G = this.G, pl = G.player, u = G.units; let best = null, bs = 1e9, kind = 0;
    const hu = s.side === 1 && G.objectives.hunter() ? 700 : 300;   // a HUNTER plan sends the Synod Kestrels after the player's engine (its weakest facing, kinds 5-7)
    for (const e of this.list) { if (e.side === s.side || e.state !== 'alive') continue; const d = e.pos.distanceTo(s.pos); if (d < 340 && d * 0.8 < bs) { bs = d * 0.8; best = e; kind = 1; } }
    if (s.side === 1 && !pl.dead && !G.noHunt) { const d = pl.pos.distanceTo(s.pos), k = G.time - s.hitByPlayerT < 10 ? 0.6 : 1; if (d < 280 && d * k < bs) { bs = d * k; best = pl; kind = 2; } }
    for (const h of G.hierarchs) { if (h.side === s.side || !h.alive) continue; const d = Math.hypot(h.pos.x - s.pos.x, h.pos.z - s.pos.z); if (d < (h.piloted ? hu : 300) && d * 0.95 < bs) { bs = d * 0.95; best = h; kind = 5; } }   // scouts and hierarchs fight
    for (const h of G.harrows) { if (h.side === s.side || !h.alive) continue; const d = Math.hypot(h.pos.x - s.pos.x, h.pos.z - s.pos.z); if (d < (h.piloted ? hu : 300) && d < bs) { bs = d; best = h; kind = 6; } }   // harrow: weight 0.8
    if (s.side === 1) for (const c of G.colossi) { if (!c.piloted || !c.alive) continue; const d = Math.hypot(c.pos.x - s.pos.x, c.pos.z - s.pos.z); if (d < hu && d < bs) { bs = d; best = c; kind = 7; } }   // the player's colossus
    for (const t of u.tanks) { if (t.side === s.side || !t.alive) continue; const d = Math.hypot(t.x - s.pos.x, t.z - s.pos.z); if (d < 230 && d * 1.3 + 20 < bs) { bs = d * 1.3 + 20; best = t; kind = 3; } }
    for (const q of u.squads) { if (q.side === s.side || q.alive < 3) continue; const d = Math.hypot(q.lane - s.pos.x, q.z - s.pos.z); if (d < 200 && d * 1.5 + 30 < bs) { bs = d * 1.5 + 30; best = q; kind = 4; } }
    s.tgt = best; s.tgtKind = kind;
  }
  tgtPos(s, out) {
    const t = s.tgt, k = s.tgtKind;
    if (k === 5) return out.set(t.pos.x, 36, t.pos.z);
    if (k === 6) return out.set(t.pos.x, 28, t.pos.z);
    if (k === 7) return out.set(t.pos.x, 40, t.pos.z);
    if (k === 1 || k === 2) return out.set(t.pos.x, 16.5, t.pos.z);
    if (k === 3) return out.set(t.x, 2.5, t.z);
    return out.set(t.lane, 1.5, t.z);
  }
  tgtAlive(s) { const t = s.tgt, k = s.tgtKind; return !!t && (k === 1 ? t.state === 'alive' : k >= 5 ? t.alive : k === 2 ? !t.dead : k === 3 ? t.alive : t.alive > 0); }

  update(dt) {
    const G = this.G, pl = G.player, fx = G.fx, city = G.city;
    for (const s of this.list) {
      s.t += dt;
      if (s.state === 'gone') { /* a held reinforcement gate is where the owner's Kestrels come back */ if (s.t > RESPAWN[s.side] * G.reinforceMul(s.side)) { const gt = G.objectives && G.objectives.gateFor(s.side); this.place(s, gt ? gt.x + rr(-14, 14) : s.lane, gt ? gt.z : -s.dir * 600); if (gt) G.objectives.gateFx(gt); if (s.side === 1) G.announce('SYNOD SCOUT ENGINE SIGHTED'); } continue; }
      if (s.state !== 'alive') { this.updateWreck(s, dt); continue; }
      // --- target ---
      s.scanT -= dt; if (s.scanT <= 0 || !this.tgtAlive(s)) { s.scanT = 0.7; this.scan(s); }
      let dist = 1e9, range = 0;
      if (s.tgt) {
        this.tgtPos(s, _p); dist = Math.hypot(_p.x - s.pos.x, _p.z - s.pos.z);
        range = s.tgtKind === 4 ? 26 : s.tgtKind === 3 ? 80 : s.tgtKind >= 5 ? 28 : 68;   // against a heavy: flank to its rear arc, flamer range
        s.orbitT -= dt; if (s.orbitT <= 0) { s.orbitT = rr(3, 7); s.orbit = -s.orbit; }
        // stand off at range and circle: the goal is a point on the ring around the target, a little way round from here
        if (s.tgtKind >= 5) { const t = s.tgt; let wk = 'rear'; for (const k of FACS) if (faceFrac(t, k) < faceFrac(t, wk)) wk = k; const a = faceYaw(t, wk); s.goal.set(t.pos.x + Math.sin(a) * range, 0, t.pos.z + Math.cos(a) * range); }   // the weakest ward facing (the rear on a tie)
        else { const a = Math.atan2(s.pos.x - _p.x, s.pos.z - _p.z) + s.orbit * (s.tgtKind === 4 ? 0.2 : 0.55); s.goal.set(_p.x + Math.sin(a) * range, 0, _p.z + Math.cos(a) * range); }
      } else if (s.side === 0 && s.ordPt) s.goal.set(s.ordPt.x, 0, s.ordPt.z);   // ordered to a point with nothing to shoot yet
      else if (s.side === 0 && pl.heavy && !pl._dead) s.goal.set(pl.pos.x - Math.sin(pl.legYaw + 0.6) * 85, 0, pl.pos.z - Math.cos(pl.legYaw + 0.6) * 85);   // escort station 60-110 m off the player's rear quarter
      else s.goal.set(s.lane, 0, clamp(s.pos.z + s.dir * 90, -430, 430));
      // --- legs ---
      let gx = s.goal.x - s.pos.x, gz = s.goal.z - s.pos.z; const gd = Math.hypot(gx, gz);
      let want = Math.atan2(gx, gz), spd = gd < 4 ? 0 : Math.min(SPEED, 4 + gd * 0.9);
      if (s.slideT > 0) { s.slideT -= dt; want = s.slideYaw; spd = Math.max(spd, 12); }
      const turn = clamp(angDiff(want, s.yaw) * 4, -1, 1) * 2.6; s.yaw += turn * dt;
      if (Math.abs(angDiff(want, s.yaw)) > 1.2) spd = Math.min(spd, 7);
      const prev = s.speed; s.speed = approach(s.speed, spd, 14 * dt);
      const fxx = Math.sin(s.yaw), fzz = Math.cos(s.yaw);
      s.vel.set(fxx * s.speed, 0, fzz * s.speed); s.pos.x += s.vel.x * dt; s.pos.z += s.vel.z * dt;
      const hit = city.collideCircle(s.pos, 5.8);
      if (hit && s.slideT <= 0) {
        // walk the wall: turn along it, toward whichever way lies nearer the goal, and hold that for a moment
        const nx = city.cnx || 0, nz = city.cnz || 0, tx = -nz, tz = nx, dot = tx * gx + tz * gz;
        s.slideS = Math.abs(dot) > gd * 0.25 ? Math.sign(dot) : s.slideS; s.slideYaw = Math.atan2(tx * s.slideS + nx * 0.25, tz * s.slideS + nz * 0.25); s.slideT = 1.1;
      }
      s.pos.x = clamp(s.pos.x, -680, 680); s.pos.z = clamp(s.pos.z, -640, 640);
      // keep clear of the player and of each other
      if (!pl.dead) { const dx = s.pos.x - pl.pos.x, dz = s.pos.z - pl.pos.z, d = Math.hypot(dx, dz); if (d < 12 && d > 0.01) { s.pos.x += dx / d * (12 - d) * 0.5; s.pos.z += dz / d * (12 - d) * 0.5; } }
      for (const o of this.list) if (o !== s && o.state !== 'gone') { const dx = s.pos.x - o.pos.x, dz = s.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 12 && d > 0.01) { s.pos.x += dx / d * (12 - d) * 0.5; s.pos.z += dz / d * (12 - d) * 0.5; } }
      // --- torso + weapons ---
      let aimErr = 9, aimP = 0;
      if (s.tgt) {
        const ay = Math.atan2(_p.x - s.pos.x, _p.z - s.pos.z);
        s.aim += clamp(angDiff(ay, s.aim), -2.4 * dt, 2.4 * dt); aimErr = Math.abs(angDiff(ay, s.aim));
        aimP = clamp(Math.atan2(_p.y - 17, Math.max(8, dist)), -0.4, 0.5);
      } else s.aim += clamp(angDiff(s.yaw, s.aim), -1.5 * dt, 1.5 * dt);
      const tw = clamp(angDiff(s.aim, s.yaw), -2.3, 2.3); s.aim = s.yaw + tw;
      s.cd -= dt; s.recoil = damp(s.recoil, 0, 5, dt);
      const rig = s.rig;
      // --- body ---
      s.bobV += (-s.bob * 130 - s.bobV * 12) * dt; s.bob += s.bobV * dt;
      s.pitch = damp(s.pitch, clamp((s.speed - prev) / Math.max(dt, 1e-3), -20, 20) * 0.009 + s.speed * 0.0055, 6, dt);
      s.roll = damp(s.roll, clamp(-turn * 0.05 * (0.4 + s.speed / SPEED), -0.3, 0.3), 7, dt);
      s.hipY = WALKER.hipY + s.bob - Math.min(s.speed, SPEED) / SPEED * 0.9;
      rig.root.position.set(s.pos.x, 0, s.pos.z); rig.root.rotation.y = s.yaw;
      rig.body.position.y = s.hipY; rig.body.rotation.set(s.pitch, 0, s.roll); rig.torso.rotation.y = tw;
      rig.arm_L.rotation.x = rig.arm_R.rotation.x = -aimP; rig.head.rotation.x = -aimP * 0.5; rig.barrel_R.position.z = -s.recoil * 2.4;
      s.legs.update(dt, s.pos, s.yaw, s.vel.x, s.vel.z, s.hipY, 0);
      s.shadow.position.set(s.pos.x, 0.08, s.pos.z);
      rig.root.updateMatrixWorld(true);
      // autocannon
      if (s.tgt && s.cd <= 0 && aimErr < 0.14 && dist < 270 && dist > 14 && city.los(s.pos.x, 17, s.pos.z, _p.x, Math.max(_p.y, 5), _p.z)) this.fireCannon(s, _p, dist);
      // inferno projector at close range
      const flaming = !!s.tgt && dist < 40 && aimErr < 0.3;
      s.flameK = damp(s.flameK, flaming ? 1 : 0, 5, dt); s.heat = clamp(s.heat + (flaming ? dt * 0.9 : -dt * 0.25), 0, 1);
      { const h = s.heat * s.heat; rig.nozzleMat.color.setRGB(2.2 * h, 0.6 * h, 0.1 * h); }
      if (flaming) this.flameJet(s, _p, dt);
      // --- veil ---
      s.veilK = Math.max(0, s.veilK - dt * 1.8);
      if (s.veil < VEIL && G.time - s.lastHit > 7) s.veil = Math.min(VEIL, s.veil + VEIL / 6 * dt);
      const vu = s.veilMat.uniforms; vu.uHitK.value = s.veilK; vu.uBase.value = 0; vu.uT.value = G.time;
      s.veilMesh.visible = s.veilK > 0.01; s.veilMesh.position.set(s.pos.x, 13.5, s.pos.z);
      if (s.hp < HP * 0.4 && rnd() < dt * 10) fx.smoke(s.pos.x + rr(-2, 2), 16, s.pos.z + rr(-2, 2), rr(-1, 1), rr(3, 6), rr(-1, 1), 2.5, 2, 8, 0.07, 0.6);
    }
  }
  fireCannon(s, tp, dist) {
    const G = this.G, fx = G.fx, pl = G.player, side = s.side, vsWalker = s.tgtKind <= 2;
    s.cd = rr(2.1, 3.0); s.recoil = 1; s.bobV -= 2.5;
    s.rig.anchor_muzzle.getWorldPosition(_m);
    const sp = (vsWalker ? 0.03 : 0.02) + dist * 0.00008;
    _d.set(tp.x - _m.x + rr(-1, 1) * sp * dist, tp.y - _m.y + rr(-1, 1) * sp * dist * 0.6, tp.z - _m.z + rr(-1, 1) * sp * dist).normalize();
    const h = G.shoot(_m, _d, 700, side, { probe: true, radius: 1.4 });
    let hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref;
    if (!pl.dead) {   // the player is not in the general hitscan
      const px = pl.pos.x - _m.x, py = 15 - _m.y, pz = pl.pos.z - _m.z, t = px * _d.x + py * _d.y + pz * _d.z;
      if (t > 0 && t < h.t) { const qx = px - _d.x * t, qy = py - _d.y * t, qz = pz - _d.z * t; if (qx * qx + qy * qy + qz * qz < 42) { const tt = Math.max(0, t - 4); hx = _m.x + _d.x * tt; hy = _m.y + _d.y * tt; hz = _m.z + _d.z * tt; type = 'player'; } }
    }
    const T = PAL[side].tracer, ox = _m.x, oz = _m.z, dx = _d.x, dz = _d.z, cd = fx.camDist(_m.x, _m.y, _m.z);
    fx.tracer(_m.x, _m.y, _m.z, hx, hy, hz, 480, 30, 1.0, T[0] * 2, T[1] * 2, T[2] * 2, () => {
      fx.explosion(hx, hy, hz, 1.3, { silent: cd > 500 });
      if (type === 'tank') G.units.damageTank(ref, 110);
      else if (type === 'scout') this.damage(ref, 130, false, ox, oz);
      else if (type === 'player') pl.damage(5, rnd() < 0.4 ? 'leg' : 'hull', ox, oz);
      else if (type === 'air') G.air.damage(ref, 90);
      else if (type === 'col') ref.damage(20, false, false, { x: hx, y: hy, z: hz });
      else if (type === 'hier') ref.damage(30, false, false, { x: hx, y: hy, z: hz });
      else if (type === 'harrow') ref.damage(30, false, false, { x: hx, y: hy, z: hz });
      else if (type === 'bld') G.city.damage(ref, 70, dx, dz);
      G.blast(hx, hy, hz, 8, 55, side);
    });
    if (cd < 600) {
      fx.muzzle(_m, _d, 2.0, 4, 2.4, 0.8); fx.flash(_m.x, _m.y, _m.z, 1, 0.65, 0.3, 3000, 0.14, 120); G.sfx.boom(cd, 0.6);
      for (let k = 0; k < 4; k++) fx.smoke(_m.x + _d.x * k, _m.y, _m.z + _d.z * k, _d.x * rr(4, 16), rr(0, 3), _d.z * rr(4, 16), rr(1.2, 2.2), 2.5, 8, 0.35, 0.45);
    }
  }
  flameJet(s, tp, dt) {
    const G = this.G, fx = G.fx, pl = G.player;
    s.rig.anchor_nozzle.getWorldPosition(_m);
    _d.set(tp.x - _m.x, Math.min(tp.y, 6) - _m.y, tp.z - _m.z).normalize();
    const reach = 38 * s.flameK, cd = fx.camDist(_m.x, _m.y, _m.z);
    if (cd < 500) {
      const n = cd < 220 ? 14 : 7;
      for (let k = 0; k < n; k++) { const u = (k + rnd()) / n, t = u * reach, w = u * u * 3; fx.flame(_m.x + _d.x * t + rr(-w, w), _m.y + _d.y * t - u * u * 3 + rr(-w, w) * 0.5, _m.z + _d.z * t + rr(-w, w), 1.6 + u * 8, u * 0.6, rnd()); }
      if (rnd() < dt * 5) fx.smoke(_m.x + _d.x * reach, _m.y + _d.y * reach + 2, _m.z + _d.z * reach, rr(-1, 1), rr(4, 8), rr(-1, 1), rr(2, 4), 3, 12, 0.03, 0.7, 0.4);
      if (rnd() < dt * 10) fx.flash(_m.x + _d.x * reach * 0.6, _m.y + 2, _m.z + _d.z * reach * 0.6, 1, 0.5, 0.14, 900, 0.2, 70);
    }
    G.units.flame(_m, _d, reach, dt, false); this.flame(_m, _d, reach, dt, false, s);
    if (s.tgtKind >= 5 && s.tgt && s.tgt.alive) { const t = s.tgt, dd = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z); if (dd < 40) t.damage(50 * dt, false, dd < 25, { x: s.pos.x, y: t.geo.legTop + 6, z: s.pos.z }, 50 * dt); }   // the flamer on the rear (x1.5 to the reactor), under the ward inside 25 m
    if (rnd() < dt * 2.5) G.units.addPatch(_m.x + _d.x * reach * 0.8, _m.z + _d.z * reach * 0.8, false);
    if (!pl.dead) { const px = pl.pos.x - _m.x, py = 10 - _m.y, pz = pl.pos.z - _m.z, t = px * _d.x + py * _d.y + pz * _d.z; if (t > 0 && t < reach + 5 && px * px + py * py + pz * pz - t * t < 64) pl.damage(6 * dt, rnd() < 0.5 ? 'leg' : 'hull', _m.x, _m.z); }
  }
  // death: the legs give way, the hull pitches over and slams into the street, burns as a wreck, then is hauled off (sinks)
  updateWreck(s, dt) {
    const G = this.G, fx = G.fx, rig = s.rig;
    if (s.state === 'dying') {
      const k = Math.min(1, s.t / 1.5), e = k * k;
      s.hipY = WALKER.hipY * (1 - e) + 3.6 * e;
      rig.body.position.y = s.hipY; rig.body.rotation.set(s.fallDir * 1.15 * e + Math.sin(s.t * 30) * 0.02 * (1 - k), 0, s.fallRoll * e);
      rig.arm_L.rotation.x = damp(rig.arm_L.rotation.x, 0.7, 3, dt); rig.arm_R.rotation.x = damp(rig.arm_R.rotation.x, 0.5, 3, dt); rig.head.rotation.x = damp(rig.head.rotation.x, 0.5, 3, dt);
      s.legs.update(dt, s.pos, s.yaw, 0, 0, s.hipY, 0);
      if (rnd() < dt * 25) fx.sparks(s.pos.x + rr(-3, 3), s.hipY + rr(0, 5), s.pos.z + rr(-3, 3), 4, 14);
      if (rnd() < dt * 12) fx.smoke(s.pos.x, s.hipY + 4, s.pos.z, rr(-2, 2), rr(4, 8), rr(-2, 2), 2.5, 3, 10, 0.05, 0.7);
      if (k >= 1 && !s.hit) {
        s.hit = true; const fx2 = Math.sin(s.yaw) * 7 * s.fallDir, fz2 = Math.cos(s.yaw) * 7 * s.fallDir;
        fx.explosion(s.pos.x + fx2, 4, s.pos.z + fz2, 2.2); fx.dust(s.pos.x + fx2, 1, s.pos.z + fz2, 5, 10, 0.15, 0.55); fx.debris(s.pos.x + fx2, 4, s.pos.z + fz2, 10, 1.4, 22, 0.1); fx.decal(s.pos.x + fx2, s.pos.z + fz2, 9);
        G.shakeAt(s.pos.x, 0, s.pos.z, 6); G.blast(s.pos.x + fx2, 2, s.pos.z + fz2, 9, 60, -1); G.sfx.boom(fx.camDist(s.pos.x, 5, s.pos.z), 1);
        s.em = fx.addEmitter(s.pos.x + fx2 * 0.5, 5, s.pos.z + fz2 * 0.5, 3, 28);
      }
      if (s.t > 2.2) { s.state = 'wreck'; s.t = 0; }
    } else if (s.state === 'wreck') {
      if (s.t > 28) { const sink = (s.t - 28) * 2.2; rig.root.position.y = -sink; for (const f of s.legs.feet) for (const p of [f.thigh, f.shin, f.meta, f.foot]) p.position.y -= 2.2 * dt; }
      if (s.t > 35) { s.state = 'gone'; s.t = 0; rig.root.visible = false; s.legs.setVisible(false); s.shadow.visible = false; }
    }
  }
}
