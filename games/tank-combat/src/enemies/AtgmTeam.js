// Enemy ATGM team: 2-3 infantry (enemy uniform) behind a tripod launcher. Detects the player with line of sight, then fires
// a slow wire-guided missile every ~15 s. The missile is a guided projectile in the shared ProjectilePool; it is steered
// toward the player with a limited turn rate only while the team is alive and keeps line of sight (smoke, cover or
// terrain break the guidance). Team members are small dynamic colliders: HE / HEAT / coax kill them, APFSDS barely
// scratches them (see DamageSystem softs). A downed soldier falls over and is removed after a while.
import { Group, Mesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { Soldier } from '../game/Infantry.js';
import { patchMaterial } from '../environment/Atmosphere.js';
import { ATGM } from '../combat/Ammo.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };
const MAX_TURN = 0.55;  // rad/s: the missile can follow a walking target, not a fast one
const RELOAD = 15;

let LAUNCHER = null;
function launcherParts() {
  if (LAUNCHER) return LAUNCHER;
  const m = patchMaterial(new MeshStandardMaterial({ color: 0x2c2f2a, roughness: 0.6, metalness: 0.3 }));
  LAUNCHER = { m, tube: new CylinderGeometry(0.07, 0.07, 1.3, 8), leg: new BoxGeometry(0.04, 0.7, 0.04), box: new BoxGeometry(0.22, 0.2, 0.3) };
  return LAUNCHER;
}

export class AtgmTeam {
  // spec: { id, name, x, z, yaw, n, range }
  constructor(spec, fx) {
    this.id = spec.id; this.name = spec.name || spec.id; this.spec = spec; this.fx = fx;
    this.range = spec.range || 420;
    this.x = spec.x; this.z = spec.z; this.y = fx.terrain.getHeight(spec.x, spec.z);
    this.yaw = spec.yaw || 0;
    this.detection = 0; this.visible = false; this.losLostT = 99; this.scan = rnd(0, 0.3);
    this.reload = 4; this.alive = true;
    this.spotted = false; this.revealT = 0; this.lastKnown = null;
    this.isTeam = true;
    this.ctrl = { x: this.x, y: this.y, z: this.z }; // marker anchor (same shape as a tank controller)
    this.soldiers = [];
    const n = spec.n || 3, sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 1.7;
      const s = new Soldier(fx.scene, fx.terrain, this.x + sx * off + (i === 0 ? 0 : 0.4), this.z + sz * off, this.yaw, [[0, 0]], 0, true);
      const sol = {
        s, team: this, hp: 30, alive: true, fallT: 0, x: s.x, z: s.z,
        get y() { return fx.terrain.getHeight(this.x, this.z); },
      };
      sol.collider = fx.world.addCircle(s.x, s.z, 0.5, { dynamic: true, owner: this, tag: 'soldier', height: 1.8, y0: sol.y - 0.3 });
      sol.hurt = (amt, info) => this._hurt(sol, amt, info);
      sol.alert = (x, z, hit) => this.alert(x, z, hit);
      this.soldiers.push(sol);
    }
    // tripod launcher in front of the middle soldier
    const L = launcherParts(), g = this.launcher = new Group();
    const tube = new Mesh(L.tube, L.m); tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.62, 0.3);
    const box = new Mesh(L.box, L.m); box.position.set(0, 0.5, 0.15);
    g.add(tube, box);
    for (const a of [0, 2.1, -2.1]) { const l = new Mesh(L.leg, L.m); l.position.set(Math.sin(a) * 0.25, 0.3, Math.cos(a) * 0.25 + 0.2); l.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35); g.add(l); }
    for (const o of g.children) o.castShadow = true;
    g.position.set(this.x + Math.sin(this.yaw) * 0.9, this.y, this.z + Math.cos(this.yaw) * 0.9);
    g.rotation.y = this.yaw;
    fx.scene.add(g);
    this.muzzle = new Vector3();
    this._eye = new Vector3(); this._tgt = new Vector3(); this._d = new Vector3();
  }

  get position() { return this._eye.set(this.x, this.y, this.z); }

  alert(x, z, hit) {
    if (!this.alive) return;
    if (hit) this.detection = 1;
    else this.detection = Math.max(this.detection, 0.6);
  }

  _hurt(sol, amt) {
    if (!sol.alive) return false;
    sol.hp -= amt;
    if (sol.hp > 0) return false;
    sol.alive = false;
    this.fx.world.removeCollider(sol.collider);
    this.alive = this.soldiers.some((q) => q.alive);
    if (!this.alive) { this.spotted = false; this.lastKnown = null; if (this.fx.onTeamDestroyed) this.fx.onTeamDestroyed(this); }
    return true;
  }

  _look(P, ctx) {
    this._eye.set(this.x, this.y + 1.2, this.z);
    this._tgt.set(P.x, P.y + 1.5, P.z);
    const dist = this._eye.distanceTo(this._tgt);
    let vis = false;
    if (dist < this.range) {
      const e = this._eye, g = this._tgt;
      const blocked = ctx.world.raycastSegment(e.x, e.y, e.z, g.x, g.y, g.z, this, _hit);
      vis = !blocked || (_hit.collider && _hit.collider.owner === P);
      if (vis && ctx.smoke.isBlocked(e.x, e.y, e.z, g.x, g.y, g.z)) vis = false;
    }
    this.visible = vis; this.dist = dist;
    if (vis) { this.losLostT = 0; this.detection = Math.min(1, this.detection + 0.2 / (2.0 + 1.5 * (dist / this.range))); }
    else this.detection = Math.max(0, this.detection - 0.08);
  }

  update(dt, ctx) {
    const P = ctx.player;
    // fallen soldiers: tip over, then disappear
    for (const q of this.soldiers) {
      if (q.alive) { q.s.update(dt, 0); continue; }
      q.fallT += dt;
      q.s.root.rotation.x = -Math.min(1.45, q.fallT * 3.2);
      q.s.root.position.y = this.fx.terrain.getHeight(q.x, q.z) - Math.min(0.2, q.fallT * 0.1);
      if (q.fallT > 14) q.s.root.visible = false;
    }
    if (!this.alive) { this.launcher.rotation.x = 0.4; this.launcher.visible = this.soldiers.some((q) => q.fallT < 14); return; }
    if (this.revealT > 0 && (this.revealT -= dt) <= 0) { this.spotted = false; this.lastKnown = { x: this.x, z: this.z, t: 6 }; }
    this.losLostT += dt;
    this.scan -= dt;
    if (this.scan <= 0) { this.scan = 0.15; this._look(P, ctx); }
    this.reload -= dt;
    if (this.visible && this.detection >= 1 && this.reload <= 0) this._fire(P);
  }

  _fire(P) {
    const fx = this.fx;
    this.reload = RELOAD;
    this.muzzle.set(this.x + Math.sin(this.yaw) * 1.4, this.y + 1.0, this.z + Math.cos(this.yaw) * 1.4);
    // launch toward the target, lofted a little so it clears the ground in front of the tube
    this._d.set(P.x - this.muzzle.x, P.y + 1.3 - this.muzzle.y, P.z - this.muzzle.z);
    const dist = this._d.length();
    this._d.normalize();
    this._d.y += 0.1; this._d.normalize();
    const p = fx.projectiles.spawn(ATGM, this.muzzle.x, this.muzzle.y, this.muzzle.z, this._d.x, this._d.y, this._d.z, this);
    p.team = this; p.guided = true; p.lostT = 0;
    // launch flash + backblast
    fx.explosions.glow.emit({ x: this.muzzle.x, y: this.muzzle.y, z: this.muzzle.z, life: 0.12, size0: 1.6, size1: 2.6, alpha: 1, r: 3, g: 2.2, b: 1.2, tile: 3, fadeIn: 0, fadeOut: 0.8, ground: false });
    fx.smoke.dust(this.muzzle.x - this._d.x * 2, this.y + 0.4, this.muzzle.z - this._d.z * 2, 6, 2.2, 4, 1.8, 1, 0.5, [0.7, 0.68, 0.62]);
    this.revealT = 6; this.spotted = true;
    if (fx.log) console.info('[elog] ' + this.id + ' launches missile at range', Math.round(dist));
    if (fx.onMissileLaunch) fx.onMissileLaunch(this, p);
  }

  // called for each in-flight guided projectile of this team (ProjectilePool.onGuide)
  guide(p, dt, P) {
    if (!p.guided) { // wire cut: keep the last heading, drifting off-course more and more, and dive
      p.drift += dt;
      if (!p.driftDir) p.driftDir = Math.random() < 0.5 ? -1 : 1;
      const a = p.driftDir * 1.6 * p.drift * dt, c = Math.cos(a), s = Math.sin(a);
      const vx = p.vx * c - p.vz * s, vz = p.vx * s + p.vz * c;
      p.vx = vx; p.vz = vz;
      p.vy -= 5 * p.drift * dt;
      return;
    }
    if (!this.alive || !this.visible) p.lostT += dt; else p.lostT = 0;
    if (p.lostT > 0.2) { p.guided = false; if (this.fx.log) console.info('[elog] missile guidance lost (' + (this.alive ? 'line of sight' : 'team down') + ')'); return; }
    const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
    const dx = P.x - p.x, dy = P.y + 1.3 - p.y, dz = P.z - p.z, dl = Math.hypot(dx, dy, dz) || 1;
    const cx = p.vx / sp, cy = p.vy / sp, cz = p.vz / sp;
    const tx = dx / dl, ty = dy / dl, tz = dz / dl;
    const ang = Math.acos(Math.max(-1, Math.min(1, cx * tx + cy * ty + cz * tz)));
    if (ang < 1e-4) return;
    const k = Math.min(1, (MAX_TURN * dt) / ang);
    let nx = cx + (tx - cx) * k, ny = cy + (ty - cy) * k, nz = cz + (tz - cz) * k;
    const nl = Math.hypot(nx, ny, nz) || 1;
    p.vx = (nx / nl) * sp; p.vy = (ny / nl) * sp; p.vz = (nz / nl) * sp;
  }
}
