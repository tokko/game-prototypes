// Enemy tank entity: TankModel('enemy') + the same hull physics as the player (TankController) + turret control.
// Implements the DamageSystem victim interface and the destroyed looks (cook-off with the turret blown off,
// knocked-askew turret, intact burnout) from the visual spec. The AI lives in EnemyController.js.
import { Vector3, Mesh, CircleGeometry, MeshStandardMaterial, Euler } from 'three';
import { TankModel } from '../vehicles/TankModel.js';
import { IfvModel } from '../vehicles/IfvModel.js';
import { TankController } from '../vehicles/TankController.js';
import { TurretController } from '../vehicles/TurretController.js';
import { ARMOR } from '../combat/DamageSystem.js';
import { burnModel } from './Wreck.js';
import { patchMaterial } from '../environment/Atmosphere.js';
import { DEG } from '../util/math.js';

const rnd = (a, b) => a + Math.random() * (b - a);
let ringMat = null;

export class EnemyTank {
  constructor(spec, fx) {
    this.id = spec.id;
    this.name = spec.name || spec.id;
    this.spec = spec;
    this.fx = fx;
    this.detectRange = spec.detect || 450;
    this.maxHp = this.hp = 100;
    this.alive = true;
    this.immobile = false;
    this.isPlayer = false;
    this.ifv = spec.type === 'ifv';
    this.cls = this.ifv ? 'light' : 'hard'; // damage class (see DamageSystem)
    this.turretY = this.ifv ? 2.05 : 1.45;
    this.armor = this.ifv ? ARMOR.ifv : ARMOR.enemy;
    this.spotted = false;       // shown on HUD/minimap
    this.identified = false;    // permanently marked (mission identify)
    this.revealT = 0;           // temporary reveal timer after firing
    this.lastKnown = null;      // { x, z, t } for the hollow "lost contact" marker

    this.model = this.ifv ? new IfvModel() : new TankModel('enemy');
    fx.scene.add(this.model.root);
    this.ctrl = new TankController(fx.world, spec.x, spec.z, spec.heading || 0, this.ifv ? { hx: 1.5, hz: 3.4 } : undefined);
    this.ctrl.collider.tag = 'tank';
    this.turret = new TurretController(this.model);
    this.turret.minPitch = -6 * DEG; this.turret.maxPitch = 14 * DEG; this.turret.yawRate = 32 * DEG;
    if (this.ifv) { this.turret.minPitch = -8 * DEG; this.turret.maxPitch = 30 * DEG; this.turret.yawRate = 60 * DEG; this.turret.pitchRate = 35 * DEG; }
    this.turret.yaw = 0;
    this.ctrl.syncModel(this.model);
    this.model.root.updateMatrixWorld(true);
    this.pos = new Vector3(spec.x, this.ctrl.y, spec.z);
    this.recoilT = 99;

    // wreck state
    this.pops = [];
    this.toss = null;
    this.droop = 0;
  }

  get position() { this.pos.set(this.ctrl.x, this.ctrl.y, this.ctrl.z); return this.pos; }

  // ---- DamageSystem victim interface ----
  takeDamage(dmg, info) {
    if (!this.alive) return false;
    this.hp -= dmg;
    if (this.hp <= 0) { this.destroy(info); return true; }
    return false;
  }

  trackHit() {
    if (this.immobile) return;
    this.immobile = true;
    const c = this.ctrl;
    this.fx.smoke.dust(c.x, c.y + 0.5, c.z, 8, 2.2, 4, 2.4, 1, 0.5);
  }

  alert(x, z, hit) { if (this.brain) this.brain.alert(x, z, hit); }

  fireShell(def, targetDir) {
    const m = this.model, fx = this.fx;
    const pos = new Vector3(), dir = targetDir;
    m.muzzle.getWorldPosition(pos);
    fx.projectiles.spawn(def, pos.x, pos.y, pos.z, dir.x, dir.y, dir.z, this.ctrl);
    this.recoilT = 0;
    if (this.ifv) fx.muzzleFx.mg(pos, dir); else fx.muzzleFx.fire(pos, dir, 1);
    if (fx.log) console.info('[elog] ' + this.id + ' fires');
    if (!this.ifv) this.ctrl.kick(0.1, 0.02, -0.15);
    this.revealT = 6;
    this.spotted = true;
  }

  update(dt, ctx) {
    if (this.alive) {
      if (this.revealT > 0 && !this.identified) { this.revealT -= dt; if (this.revealT <= 0) { this.spotted = false; this.lastKnown = { x: this.ctrl.x, z: this.ctrl.z, t: 6 }; } }
      this.brain.update(dt, ctx);
      this.ctrl.syncModel(this.model);
      this.model.updateTracks(this.ctrl.leftSpeed, this.ctrl.rightSpeed, dt);
      this.model.root.updateMatrixWorld(true);
      // recoil animation
      this.recoilT += dt;
      const t = this.recoilT;
      const f = t < 0.06 ? t / 0.06 : 1 - Math.min(1, (t - 0.06) / 0.9) ** 2 * (3 - 2 * Math.min(1, (t - 0.06) / 0.9));
      this.model.setRecoil(0.5 * Math.max(0, f));
    } else {
      this._updateWreck(dt);
    }
  }

  // ---- destruction ----
  destroy(info) {
    this.alive = false;
    this.spotted = false;
    this.identified = false;
    this.lastKnown = null;
    const fx = this.fx, c = this.ctrl, m = this.model;
    c.speed = 0; c.yawRate = 0;
    c.collider.onHit = null; c.collider.tag = 'wreck';
    burnModel(m);
    const id = info && info.def ? info.def.id : 'HEAT';
    const heavy = id === 'HEAT' || id === 'HE' || (info && info.part === 'splash');
    const roll = Math.random();
    const cook = !this.ifv && roll < (heavy ? 0.3 : 0.15);
    const askew = !cook && roll < (heavy ? 0.8 : 0.65);
    const p = new Vector3(c.x, c.y + 1.5, c.z);
    // open turret ring after a cook-off
    if (!ringMat) ringMat = patchMaterial(new MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }));
    if (cook) {
      const ring = new Mesh(new CircleGeometry(1.05, 20), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 1.56, 0.35);
      m.hull.add(ring);
      // detach the turret and throw it
      const t = m.turret;
      t.updateWorldMatrix(true, false);
      fx.scene.attach(t);
      const a = Math.random() * 6.283, s = rnd(2, 4);
      this.toss = {
        vx: Math.cos(a) * s, vy: rnd(9, 14), vz: Math.sin(a) * s,
        wx: rnd(-3, 3), wy: rnd(-1, 1), wz: rnd(-3, 3), done: false,
      };
      fx.explosions.explosion(p.x, p.y, p.z, 0, 1, 0, 'HE', true);
      for (let i = 0; i < 7; i++) this.pops.push({ t: rnd(1, 12) });
      this.jet = 4 + Math.random() * 2;
      fx.shake(p.x, p.z, 0.8, 120);
    } else {
      fx.explosions.explosion(p.x, p.y, p.z, 0, 1, 0, 'HEAT', true);
      fx.shake(p.x, p.z, 0.5, 70);
      if (askew) {
        m.turret.rotation.y += (Math.random() < 0.5 ? -1 : 1) * rnd(0.35, 0.9);
        m.turret.rotation.z = (Math.random() < 0.5 ? -1 : 1) * rnd(0.05, 0.1);
        m.turret.position.y += 0.08;
        m.gunPivot.rotation.x = -(Math.random() < 0.5 ? -8 : 14) * DEG;
      } else this.droop = 3;
    }
    m.fireAnchor.updateWorldMatrix(true, false);
    const anchor = new Vector3().setFromMatrixPosition(m.fireAnchor.matrixWorld);
    fx.world.smokeAnchors.push({ pos: anchor, flame: true, strength: 1, model: m });
    if (fx.onDestroyed) fx.onDestroyed(this, info);
  }

  _updateWreck(dt) {
    const fx = this.fx, m = this.model;
    if (this.droop > 0) {
      this.droop -= dt;
      const cur = -m.gunPivot.rotation.x;
      m.gunPivot.rotation.x = -(cur + (-6 * DEG - cur) * Math.min(1, dt * 1.2));
    }
    if (this.toss && !this.toss.done) {
      const t = this.toss, o = m.turret;
      o.position.x += t.vx * dt; o.position.y += t.vy * dt; o.position.z += t.vz * dt;
      t.vy -= 9.81 * dt;
      o.rotation.x += t.wx * dt; o.rotation.y += t.wy * dt; o.rotation.z += t.wz * dt;
      const gh = fx.terrain.getHeight(o.position.x, o.position.z) + 0.9;
      if (o.position.y < gh && t.vy < 0) {
        t.done = true;
        o.position.y = gh - 0.15;
        o.rotation.set((Math.random() < 0.5 ? -1 : 1) * rnd(0.35, 1.0), o.rotation.y, (Math.random() < 0.5 ? -1 : 1) * rnd(0.35, 1.0), 'YXZ');
        fx.explosions.kineticImpact(o.position.x, gh - 0.9, o.position.z, 0, 1, 0, true);
        fx.shake(o.position.x, o.position.z, 0.3, 40);
      }
    }
    if (this.jet > 0) { // fire jet from the open turret ring
      this.jet -= dt;
      const c = this.ctrl;
      for (let i = 0; i < 3; i++) {
        fx.explosions.glow.emit({
          x: c.x + rnd(-0.4, 0.4), y: c.y + 1.8, z: c.z + rnd(-0.4, 0.4), vx: rnd(-1, 1), vy: rnd(12, 20), vz: rnd(-1, 1), life: rnd(0.5, 0.8),
          size0: 1.0, size1: 3.0, alpha: 0.9, r: 2.6, g: 1.4, b: 0.4, tile: 3, drag: 1, fadeIn: 0, fadeOut: 0.5,
        });
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i].t -= dt;
      if (this.pops[i].t <= 0) {
        this.pops.splice(i, 1);
        const c = this.ctrl;
        fx.explosions.explosion(c.x + rnd(-1.5, 1.5), c.y + 2, c.z + rnd(-1.5, 1.5), 0, 1, 0, 'HEAT', false);
      }
    }
  }
}

void Euler;
