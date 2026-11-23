// Enemy AI: idle / patrol / detect (detection meter, needs line of sight, blocked by smoke) / engage (turret slews,
// ballistic solution, aim error that shrinks over time and grows with player speed or smoke) / search (lost contact).
// Also the strongpoint MG nest and the EnemyManager that places the units.
import { Vector3 } from 'three';
import { clamp, lerp, wrapPi } from '../util/math.js';
import { solveElevation } from '../combat/Ballistics.js';
import { ENEMY_AP, ENEMY_AC, NEST_MG } from '../combat/Ammo.js';
import { EnemyTank } from './EnemyTank.js';
import { AtgmTeam } from './AtgmTeam.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.2;
const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };
const _fhit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };
let _feelWorld = null;

// positions chosen so the first 400 m of the road are peaceful; tank1 is visible from the observation hill
export const ENEMY_SPECS = [
  { id: 'tank1', name: 'Enemy tank', x: -44, z: -452, heading: 0.9, detect: 380, patrol: null, leash: 42 },
  { id: 'tank2', name: 'Village tank', x: -60, z: -598, heading: 0.0, detect: 450, patrol: null, leash: 55 },
  { id: 'tank3', name: 'Patrol east', x: 30, z: -600, heading: Math.PI / 2, detect: 520, patrol: [[78, -604], [30, -600]] },
  { id: 'tank4', name: 'Patrol west', x: -132, z: -572, heading: Math.PI, detect: 450, patrol: [[-132, -626], [-132, -572]] },
  // light IFVs (8x8, autocannon): one escorts the village tanks, one covers the strongpoint, one holds the north of the village
  { id: 'ifv1', name: 'Escort IFV', type: 'ifv', x: -58, z: -626, heading: 0.15, detect: 380, patrol: null, leash: 60 },
  { id: 'ifv2', name: 'Strongpoint IFV', type: 'ifv', x: 80, z: -538, heading: 2.9, detect: 400, patrol: null, leash: 60 },
  { id: 'ifv3', name: 'Village IFV', type: 'ifv', x: -22, z: -644, heading: 0.5, detect: 380, patrol: null, leash: 60 },
];

// ATGM teams: treeline on the approach after the hill, rubble in the village, beside the strongpoint
function teamSpecs(terrain) {
  const rp = terrain.roadPoints;
  // atgm1 ambushes the drive to the village from the treeline, but far enough down the road that the whole observation-hill
  // zone (radius 24) stays more than range + 120 m away from every team
  const hill = terrain.hill;
  let i = rp.findIndex((p) => p.z < -380 && Math.hypot(p.x - hill.x, p.z - hill.z) >= 500);
  if (i < 1) i = rp.findIndex((p) => p.z < -440);
  if (i < 1) i = 1;
  const p = rp[i], q = rp[Math.min(rp.length - 1, i + 2)];
  const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
  const x1 = p.x + (-tz / tl) * 14, z1 = p.z + (tx / tl) * 14;
  const S = terrain.strong, V = terrain.village;
  return [
    { id: 'atgm1', name: 'ATGM team', x: x1, z: z1, yaw: Math.atan2(p.x - x1, p.z - z1), n: 3, range: 330 },
    { id: 'atgm2', name: 'ATGM team', x: V.x + 29, z: -549, yaw: 0.4, n: 2, range: 330 },
    { id: 'atgm3', name: 'ATGM team', x: S.x + 9, z: S.z + 5, yaw: 0.1, n: 3, range: 330 },
  ];
}

export class EnemyController {
  constructor(tank) {
    this.tank = tank;
    tank.brain = this;
    this.home = tank.spec.patrol ? 'patrol' : 'idle';
    this.state = this.home;
    this.detection = 0;
    this.visible = false;
    this.scan = rnd(0, 0.2);
    this.lastSeen = null;
    this.engageT = 0;
    this.losLost = 0;
    this.searchT = 0;
    this.reload = 3;
    this.aimTimer = 0;
    this.aim = new Vector3();
    this.wp = 0;
    this.pause = 0;
    this.stuck = 0;
    this.backT = 0;
    this._eye = new Vector3(); this._tgt = new Vector3(); this._muz = new Vector3(); this._dir = new Vector3(); this._des = new Vector3();
    this._fwd = new Vector3();
    // movement state: leash circle around the home area, post-shot / hit relocation, obstacle feelers, unstick
    const sp = tank.spec;
    if (sp.patrol) {
      const mx = (sp.patrol[0][0] + sp.patrol[sp.patrol.length - 1][0]) / 2, mz = (sp.patrol[0][1] + sp.patrol[sp.patrol.length - 1][1]) / 2;
      this.leash = { x: mx, z: mz, r: Math.hypot(sp.patrol[0][0] - mx, sp.patrol[0][1] - mz) + 70 };
    } else this.leash = { x: sp.x, z: sp.z, r: sp.leash || 50 };
    // weapon / behaviour by vehicle type: tanks fire single AP rounds, IFVs fire autocannon bursts and move more
    this.ifv = !!tank.ifv;
    this.weapon = this.ifv ? ENEMY_AC : ENEMY_AP;
    this.burst = 0; this.burstT = 0;
    this.prefFar = this.ifv ? 250 : 300; this.prefNear = this.ifv ? 70 : 110; this.speedK = this.ifv ? 1.3 : 1;
    this.relocT = 0; this.relocMode = 'strafe'; this.relocGoal = null; this.backSteer = 1;
    this.sideSign = Math.random() < 0.5 ? 1 : -1; this.detour = 0; this.detourT = 0;
  }

  // keep movement goals inside the leash circle
  _leash(x, z) {
    const L = this.leash, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    return d > L.r ? { x: L.x + (dx / d) * L.r, z: L.z + (dz / d) * L.r } : { x, z };
  }

  // three feelers ahead (or behind when reversing) against solid colliders (crushable / climbable ones are ignored)
  _feel(back = false) {
    const c = this.tank.ctrl, y = c.y + 1.0;
    const probe = (a, len) => {
      const h = c.heading + a + (back ? Math.PI : 0);
      if (!_feelWorld.raycastSegment(c.x, y, c.z, c.x + Math.sin(h) * len, y, c.z + Math.cos(h) * len, c, _fhit)) return len;
      return _fhit.kind === 'collider' && _fhit.collider && _fhit.collider.cls === 'solid' ? _fhit.dist : len;
    };
    const dc = probe(0, 14), dl = probe(0.6, 10), dr = probe(-0.6, 10);
    let steer = 0;
    if (dc < 14) steer = dl >= dr ? 1 : -1;
    else if (dl < 10 && dr >= 10) steer = -0.6;
    else if (dr < 10 && dl >= 10) steer = 0.6;
    return { steer: back ? -steer : steer, blocked: dc < 10, near: dc < 5, dc };
  }

  // drive toward (gx, gz): feelers steer around solid obstacles, stuck detection backs off and detours
  _drive(gx, gz, vmax, dt) {
    const c = this.tank.ctrl;
    const fl = this._feel(false);
    let ang = Math.atan2(gx - c.x, gz - c.z) + fl.steer * 0.9;
    if (this.detourT > 0) { this.detourT -= dt; ang += this.detour; }
    const diff = wrapPi(ang - c.heading);
    const dist = Math.hypot(gx - c.x, gz - c.z);
    const vt = Math.min(vmax * this.speedK, 1.2 + dist * 0.35) * (fl.near ? 0.5 : 1) * (Math.abs(diff) > 0.7 ? 0.5 : 1);
    const input = { throttle: 0, steer: clamp(diff * 2.2, -1, 1), brake: false };
    if (Math.abs(diff) < 1.0 && c.speed < vt) input.throttle = 0.7;
    else if (c.speed > vt + 1) input.brake = true;
    // stuck: commanded forward but not moving
    if (Math.abs(c.speed) < 0.3 && input.throttle > 0) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.6) {
      this.stuck = 0; this.backT = 2.0; this.backSteer = Math.random() < 0.5 ? 1 : -1;
      this.detour = (Math.random() < 0.5 ? 1 : -1) * rnd(0.7, 1.3); this.detourT = 4;
    }
    return input;
  }

  // post-shot / on-hit relocation: strafe sideways or back up (front armour toward the player), inside the leash
  _startReloc(P, hit = false) {
    const c = this.tank.ctrl;
    const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz) || 1, fx = dx / d, fz = dz / d;
    this.sideSign = -this.sideSign;
    this.relocT = hit ? rnd(3.5, 5.5) : rnd(3, 5);
    if (Math.random() < 0.45 && !this._feel(true).blocked) { this.relocMode = 'reverse'; this.relocGoal = null; return; }
    this.relocMode = 'strafe';
    const k = rnd(25, 45), fwd = rnd(-10, 25) * (d > 260 ? 1 : 0.4);
    let g = this._leash(c.x + -fz * this.sideSign * k + fx * fwd, c.z + fx * this.sideSign * k + fz * fwd);
    if (Math.hypot(g.x - c.x, g.z - c.z) < 10) { this.sideSign = -this.sideSign; g = this._leash(c.x + -fz * this.sideSign * k, c.z + fx * this.sideSign * k); }
    this.relocGoal = g;
  }

  // engage movement: advance / flank to a firing position, halt to shoot, reposition after firing or being hit
  _engageMove(dt, P) {
    const c = this.tank.ctrl;
    if (this.backT > 0) { this.backT -= dt; return { throttle: -0.7, steer: this.backSteer * 0.8, brake: false }; }
    const dx = P.x - c.x, dz = P.z - c.z, dist = Math.hypot(dx, dz);
    const face = Math.atan2(dx, dz), fd = wrapPi(face - c.heading);
    const halt = () => ({ throttle: 0, steer: Math.abs(fd) > 0.12 ? clamp(fd * 2, -1, 1) : 0, brake: true });
    if (this.relocT > 0) {
      this.relocT -= dt;
      if (this.reload < 1.2 && this.visible) { this.relocT = 0; return halt(); } // stop and shoot
      if (this.relocMode === 'reverse') {
        const fl = this._feel(true);
        if (fl.near) { this.relocT = 0; return halt(); }
        if (Math.abs(c.speed) < 0.25) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
        if (this.stuck > 1.5) { this.stuck = 0; this.relocT = 0; }
        return { throttle: -0.8, steer: clamp(fd * 2 + fl.steer * 0.5, -1, 1), brake: false };
      }
      const g = this.relocGoal;
      if (g && Math.hypot(g.x - c.x, g.z - c.z) > 4) return this._drive(g.x, g.z, 4.0, dt);
      this.relocT = 0;
      return halt();
    }
    // lost sight: go to where the player was last seen (or toward the player), inside the leash
    if (!this.visible && this.losLost > 1.2) {
      const S = this.lastSeen || P, g = this._leash(S.x, S.z);
      if (Math.hypot(g.x - c.x, g.z - c.z) > 20) return this._drive(g.x, g.z, 4.2, dt);
      return halt();
    }
    // too far: advance (curving to one side so the approach is a flank, not a straight line)
    if (dist > this.prefFar) {
      const a = face + this.sideSign * 0.35, k = Math.min(dist - (this.prefFar - 60), 70);
      const g = this._leash(c.x + Math.sin(a) * k, c.z + Math.cos(a) * k);
      if (Math.hypot(g.x - c.x, g.z - c.z) > 6) return this._drive(g.x, g.z, 4.4, dt);
    } else if (dist < this.prefNear) { // too close: back away
      const g = this._leash(c.x - Math.sin(face) * 40, c.z - Math.cos(face) * 40);
      if (Math.hypot(g.x - c.x, g.z - c.z) > 6) return this._drive(g.x, g.z, 3.5, dt);
    }
    return halt();
  }

  // autocannon burst: rounds leave along the current gun line with a little spread (worse while moving)
  _burstFire(dt) {
    const t = this.tank;
    this.burstT -= dt;
    while (this.burstT <= 0 && this.burst > 0) {
      this.burstT += 0.1; this.burst--;
      t.turret.getGunDirection(this._dir);
      const sg = 0.004 * (1 + Math.abs(t.ctrl.speed));
      this._des.set(this._dir.x + gauss() * sg, this._dir.y + gauss() * sg * 0.7, this._dir.z + gauss() * sg).normalize();
      t.fireShell(this.weapon, this._des);
    }
  }

  // search: drive to the last known position, keep scanning
  _searchMove(dt) {
    const c = this.tank.ctrl;
    if (this.backT > 0) { this.backT -= dt; return { throttle: -0.7, steer: this.backSteer * 0.8, brake: false }; }
    if (!this.lastSeen) return { throttle: 0, steer: 0, brake: true };
    const g = this._leash(this.lastSeen.x, this.lastSeen.z);
    if (Math.hypot(g.x - c.x, g.z - c.z) > 18) return this._drive(g.x, g.z, 3.6, dt);
    return { throttle: 0, steer: 0, brake: true };
  }

  alert(x, z, hit) {
    if (!this.tank.alive) return;
    if (hit && this.state === 'engage' && this.relocT <= 0 && this._P) this._startReloc(this._P, true); // hit: shift sideways / back up
    this.detection = 1;
    if (this.state !== 'engage') { this.state = 'engage'; this.engageT = 0; this.losLost = 0; this.aimTimer = 0; }
    if (!this.lastSeen) this.lastSeen = { x, y: this.tank.ctrl.y, z, t: 0 };
    this.searchT = 0;
  }

  _look(P, ctx) {
    const t = this.tank, c = t.ctrl;
    this._eye.set(c.x, c.y + 2.6, c.z);
    this._tgt.set(P.x, P.y + 1.6, P.z);
    const dist = this._eye.distanceTo(this._tgt);
    const speedK = Math.min(0.35, (Math.abs(P.speed) / (60 / 3.6)) * 0.35);
    const eff = t.detectRange * (1 + speedK);
    let vis = false;
    if (dist < eff * 1.6) {
      const e = this._eye, g = this._tgt;
      const blockedTerrain = ctx.world.raycastSegment(e.x, e.y, e.z, g.x, g.y, g.z, c, _hit);
      vis = !blockedTerrain || (_hit.collider && _hit.collider.owner === P);
      if (vis && ctx.smoke.isBlocked(e.x, e.y, e.z, g.x, g.y, g.z)) vis = false;
    }
    this.visible = vis;
    this.dist = dist;
    if (vis) this.lastSeen = { x: P.x, y: P.y, z: P.z, t: 0 };
    if (vis && dist < eff) {
      const T = 2.2 + 2.0 * (dist / eff);
      this.detection = Math.min(1, this.detection + 0.2 / T);
    } else this.detection = Math.max(0, this.detection - 0.1);
  }

  _holdTurret(dt, ctx) {
    const c = this.tank.ctrl;
    this._fwd.set(c.x + Math.sin(c.heading) * 200, c.y + 2, c.z + Math.cos(c.heading) * 200);
    this.tank.turret.update(dt, this._fwd, this.weapon.speed);
  }

  update(dt, ctx) {
    const t = this.tank, c = t.ctrl, P = ctx.player;
    _feelWorld = ctx.world;
    this._P = P;
    this.scan -= dt;
    if (this.scan <= 0) { this.scan = 0.2; this._look(P, ctx); }
    if (this.lastSeen) this.lastSeen.t += dt;
    let input = { throttle: 0, steer: 0, brake: true };

    if (this.state === 'idle' || this.state === 'patrol') {
      const suspicious = this.detection > 0.25;
      if (this.detection >= 1) { this.state = 'engage'; this.engageT = 0; this.losLost = 0; this.aimTimer = 0; this.reload = Math.max(this.reload, 1.5); }
      else if (this.state === 'patrol' && !suspicious && !t.immobile) {
        const w = t.spec.patrol[this.wp];
        if (this.pause > 0) { this.pause -= dt; input = { throttle: 0, steer: 0, brake: true }; }
        else {
          input = this._drive(w[0], w[1], 4.4, dt);
          if (Math.hypot(w[0] - c.x, w[1] - c.z) < 7) { this.wp = (this.wp + 1) % t.spec.patrol.length; this.pause = 3; }
          if (this.backT > 0) { this.backT -= dt; input = { throttle: -0.7, steer: this.backSteer * 0.8, brake: false }; if (this.backT <= 0) this.wp = (this.wp + 1) % t.spec.patrol.length; }
        }
      }
      if (suspicious && this.lastSeen) { // someone is out there: turn the turret toward them
        this._tgt.set(this.lastSeen.x, this.lastSeen.y + 1.5, this.lastSeen.z);
        t.turret.update(dt, this._tgt, this.weapon.speed);
      } else this._holdTurret(dt, ctx);
    } else if (this.state === 'engage') {
      this.engageT += dt;
      if (this.visible) this.losLost = 0; else this.losLost += dt;
      if (this.losLost > 7) { this.state = 'search'; this.searchT = 10; this.detection = 0.5; }
      this.aimTimer -= dt;
      this.reload -= dt;
      this._engage(dt, ctx, P);
      if (this.burst > 0) this._burstFire(dt);
      input = this._engageMove(dt, P);
    } else if (this.state === 'search') {
      this.searchT -= dt;
      if (this.visible && this.detection > 0.6) { this.state = 'engage'; this.losLost = 0; }
      else if (this.searchT <= 0) { this.state = this.home; this.detection = 0; this.lastSeen = null; }
      input = this._searchMove(dt);
      if (this.lastSeen) {
        const a = Math.sin(this.searchT * 0.6) * 0.5;
        this._tgt.set(this.lastSeen.x + Math.cos(a) * 20, this.lastSeen.y + 1.5, this.lastSeen.z + Math.sin(a) * 20);
        t.turret.update(dt, this._tgt, this.weapon.speed);
      }
    }

    if (t.immobile) input = { throttle: 0, steer: 0, brake: true };
    c.update(dt, input);
  }

  _engage(dt, ctx, P) {
    const t = this.tank, m = t.model;
    // choose the aim point (re-sampled periodically so error behaves like per-shot dispersion)
    if (this.aimTimer <= 0) {
      this.aimTimer = 0.9;
      m.muzzle.getWorldPosition(this._muz);
      const seen = this.visible || this.losLost < 1;
      const S = this.visible ? P : (this.lastSeen || P);
      const px = seen ? P.x : S.x, py = seen ? P.y : S.y, pz = seen ? P.z : S.z;
      const dist = Math.hypot(px - this._muz.x, pz - this._muz.z);
      const learn = clamp((this.engageT / 16) * (Math.abs(P.speed) < 0.6 ? 1.5 : 1), 0, 1);
      let sigma = lerp(0.014, 0.0022, learn) * (1 + Math.abs(P.speed) / 4) * (1 + Math.abs(t.ctrl.speed) * 1.4) * (this.ifv ? 1.7 : 1); // firing on the move is far less accurate
      this._eye.set(this._muz.x, this._muz.y, this._muz.z);
      this._tgt.set(px, py + 1.4, pz);
      if (!seen || ctx.smoke.isBlocked(this._eye.x, this._eye.y, this._eye.z, this._tgt.x, this._tgt.y, this._tgt.z)) sigma *= 3;
      const leadT = (dist / this.weapon.speed) * (learn > 0.25 ? 1 : 0.4);
      const vx = Math.sin(P.heading) * P.speed, vz = Math.cos(P.heading) * P.speed;
      this.aim.set(px + vx * leadT + gauss() * sigma * dist, py + 1.3 + gauss() * sigma * dist * 0.7, pz + vz * leadT + gauss() * sigma * dist);
    }
    t.turret.update(dt, this.aim, this.weapon.speed);
    if (this.reload > 0 || this.engageT < 2.5 || this.losLost > 3 || Math.abs(t.ctrl.speed) > 3.5) return;
    // fire when the barrel agrees with the ballistic solution
    m.muzzle.getWorldPosition(this._muz);
    const dx = this.aim.x - this._muz.x, dy = this.aim.y - this._muz.y, dz = this.aim.z - this._muz.z;
    const dh = Math.hypot(dx, dz), el = solveElevation(dh, dy, this.weapon.speed), yaw = Math.atan2(dx, dz), ce = Math.cos(el);
    this._des.set(Math.sin(yaw) * ce, Math.sin(el), Math.cos(yaw) * ce);
    t.turret.getGunDirection(this._dir);
    if (this._dir.dot(this._des) > Math.cos(this.ifv ? 0.02 : 0.011) && dh < t.detectRange * 2.2) {
      if (this.ifv) { this.burst = 6; this.burstT = 0; } else t.fireShell(this.weapon, this._dir);
      this.reload = this.ifv ? rnd(3.2, 4.5) : rnd(7, 9);
      this.aimTimer = 0;
      this._startReloc(P); // after firing: reposition
    }
  }
}

// ---- MG nest in the strongpoint bunker: fires bursts at the player in range (low damage) ----
export class NestController {
  constructor(strongpoint, fx, range = 430) {
    this.sp = strongpoint; this.fx = fx; this.range = range;
    this.enabled = true;
    this.detection = 0; this.scan = 0; this.visible = false;
    this.burst = 0; this.cool = 1.5; this.shotT = 0;
    this._o = new Vector3(); this._t = new Vector3(); this._d = new Vector3();
  }

  disable() { this.enabled = false; }

  update(dt, ctx) {
    if (!this.enabled) return;
    const P = ctx.player, o = this.sp.slit;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.2;
      this._t.set(P.x, P.y + 1.5, P.z);
      const dist = o.distanceTo(this._t);
      let vis = false;
      if (dist < this.range) {
        const blocked = ctx.world.raycastSegment(o.x, o.y, o.z, this._t.x, this._t.y, this._t.z, this.sp.owner, _hit);
        vis = !blocked || (_hit.collider && _hit.collider.owner === P);
        if (vis && ctx.smoke.isBlocked(o.x, o.y, o.z, this._t.x, this._t.y, this._t.z)) vis = false;
      }
      this.visible = vis; this.dist = dist;
      this.detection = vis ? Math.min(1, this.detection + 0.2 / 1.2) : Math.max(0, this.detection - 0.1);
    }
    this.cool -= dt;
    if (this.detection >= 1 && this.visible) {
      if (this.burst <= 0 && this.cool <= 0) { this.burst = 8; this.cool = 3.5; this.shotT = 0; }
    }
    if (this.burst > 0) {
      this.shotT -= dt;
      while (this.shotT <= 0 && this.burst > 0) {
        this.shotT += 0.11; this.burst--;
        const dist = this.dist || 200;
        const sg = 0.02 * (1 + Math.abs(P.speed) / 8);
        this._d.set(P.x - o.x + gauss() * sg * dist, P.y + 1.3 - o.y + gauss() * sg * dist * 0.7, P.z - o.z + gauss() * sg * dist).normalize();
        this.fx.projectiles.spawn(NEST_MG, o.x, o.y, o.z, this._d.x, this._d.y + 7.3e-6 * dist, this._d.z, this.sp.owner);
        this.fx.muzzleFx.mg(o, this._d);
      }
    }
  }
}

export class EnemyManager {
  constructor(fx) {
    this.fx = fx;
    this.tanks = ENEMY_SPECS.map((s) => {
      const t = new EnemyTank(s, fx);
      new EnemyController(t);
      return t;
    });
    this.nest = null;
    this.teams = teamSpecs(fx.terrain).map((s) => new AtgmTeam(s, fx));
  }

  get(id) { return this.tanks.find((t) => t.id === id); }
  get aliveCount() { return this.tanks.filter((t) => t.alive).length; }

  update(dt, ctx) {
    for (const t of this.tanks) t.update(dt, ctx);
    for (const t of this.teams) t.update(dt, ctx);
    if (this.nest) this.nest.update(dt, ctx);
  }

  guide(p, dt, player) { if (p.team) p.team.guide(p, dt, player); }

  // shots landing near enemies (or hits) alert them
  alertNear(x, z, radius, player) {
    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (Math.hypot(t.ctrl.x - x, t.ctrl.z - z) < radius) t.alert(player.x, player.z);
    }
    for (const t of this.teams) if (t.alive && Math.hypot(t.x - x, t.z - z) < radius) t.alert(player.x, player.z, false);
  }
}
