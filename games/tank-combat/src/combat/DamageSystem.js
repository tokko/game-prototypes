// Damage model: armour zones (hull front/side/rear, turret front/side, tracks) with simplified effective thickness
// (armour / cos of impact angle), per-ammo penetration and damage, splash vs soft targets/structures, track
// (mobility) hits and kills. Works for the player and for EnemyTank victims through a common interface:
//   victim = { ctrl: TankController, turret: TurretController, armor, isPlayer, takeDamage(dmg, info) -> destroyed, trackHit(), alert(x, z) }
import { Vector3 } from 'three';

export const ARMOR = {
  player: { hullFront: 620, hullSide: 140, hullRear: 60, turretFront: 700, turretSide: 190, track: 20 },
  enemy: { hullFront: 430, hullSide: 80, hullRear: 45, turretFront: 500, turretSide: 100, track: 20 },
  ifv: { hullFront: 38, hullSide: 30, hullRear: 25, turretFront: 35, turretSide: 30, track: 15 },
};

// target classes: 'hard' (tanks), 'light' (IFVs), 'soft' (infantry teams), plus structures (strongpoint).
// APFSDS is the anti-tank round: it over-penetrates light and soft targets. HEAT / HE are the answer to those.
const CLASS_DMG = {
  hard: {},
  light: { APFSDS: 0.4, HEAT: 1.9, HE: 3.6 },
};

// penetration in mm RHA-equivalent. APFSDS falls off with range (760 at 0 m, 600 at 2000 m); HEAT is constant.
const PEN = { APFSDS: 760, HEAT: 500, HE: 60, SMOKE: 0, MG: 9, E_AP: 650, NEST_MG: 12, E_AT: 150, E_AC: 160, ATGM: 640 };
export function penetration(id, p, hit) {
  if (id !== 'APFSDS' || !p || p.ox === undefined) return PEN[id] || 0;
  const range = Math.hypot(hit.x - p.ox, hit.z - p.oz);
  return 760 - 160 * Math.min(1, range / 2000);
}
// damage on a penetration (hit points; tanks have 100)
const DMG = { APFSDS: [55, 80], HEAT: [45, 65], HE: [18, 28], E_AP: [20, 26], E_AT: [14, 18], E_AC: [5, 8], ATGM: [24, 32] };
// light damage even without penetration (optics, crew): fraction of HP per hit
const SOFT = { NEST_MG: 0.25, MG: 0, E_AC: 0.3, ATGM: 4 };
// splash (HE/HEAT) base damage vs tanks (armour ignored) and multiplier vs structures
const SPLASH_TANK = { HE: 6, HEAT: 4 };
const STRUCT = { APFSDS: 0.08, HEAT: 0.5, HE: 1.0 };
// splash vs light vehicles (IFVs): HE kills on a direct hit or near miss
const SPLASH_LIGHT = { HE: 130, HEAT: 55 };
// infantry (soft, 30 hp per man): direct hit damage by round and blast damage at the centre (falls off with distance)
const SOFT_DIRECT = { APFSDS: 4, HEAT: 40, HE: 60, MG: 12, NEST_MG: 0 };
const SOFT_SPLASH = { HE: 90, HEAT: 60 };

const rnd = (a, b) => a + Math.random() * (b - a);

export class DamageSystem {
  constructor(world, hooks = {}) {
    this.world = world;
    this.hooks = hooks; // { playerShot(type, victim), playerHit(info), shake(amount), stat(name), enemyKilled(enemy, info) }
    this.victims = [];  // EnemyTank list (anything with the victim interface + .alive)
    this.softs = [];    // infantry: { alive, x, y, z, hurt(amount, info) -> killed, alert(x, z, hit) }
    this.player = null; // player victim
    world.onExplosion((info) => this.onExplosion(info));
  }

  setPlayer(v) { this.player = v; v.ctrl.collider.onHit = (hit, p) => this.onTankHit(v, hit, p); }

  addVictim(v) {
    this.victims.push(v);
    v.ctrl.collider.onHit = (hit, p) => this.onTankHit(v, hit, p);
  }

  // infantry target: collider hits and blasts call target.hurt(); only the player's rounds count
  addSoft(t) {
    this.softs.push(t);
    t.collider.onHit = (hit, p) => {
      if (!t.alive || !this._fromPlayer(p)) return;
      const amt = SOFT_DIRECT[p.def.id] || 0;
      if (amt <= 0) return;
      if (t.alert) t.alert(this.player.ctrl.x, this.player.ctrl.z, true);
      const killed = t.hurt(amt, { def: p.def });
      this.hooks.stat && this.hooks.stat('hit');
      this.hooks.playerShot && this.hooks.playerShot(killed ? 'kill' : 'hit', null, 'soft');
    };
  }

  // ownership helpers
  _fromPlayer(p) { return this.player && p.owner === this.player.ctrl; }
  _isEnemy(owner) { return this.victims.some((v) => v.ctrl === owner) || (owner && owner.kind === 'nest'); }

  // find the armour zone struck from the box face hit, impact height and turret facing
  classify(v, hit, p) {
    const c = v.ctrl, h = c.heading, cs = Math.cos(h), sn = Math.sin(h);
    const dx = hit.x - c.x, dz = hit.z - c.z;
    const lx = dx * cs - dz * sn, ly = hit.y - c.y;
    const nlx = hit.nx * cs - hit.nz * sn, nlz = hit.nx * sn + hit.nz * cs;
    const face = Math.abs(nlz) > Math.abs(nlx) ? (nlz > 0 ? 'Front' : 'Rear') : 'Side';
    const A = v.armor;
    if (ly > (v.turretY || 1.45)) { // turret zone: front when the struck face looks along the turret's aim
      const th = h + v.turret.yaw, tfx = Math.sin(th), tfz = Math.cos(th);
      const front = hit.nx * tfx + hit.nz * tfz > 0.55;
      return { part: front ? 'turretFront' : 'turretSide', armor: front ? A.turretFront : A.turretSide };
    }
    if (face === 'Side' && ly < 0.95 && Math.abs(lx) > 1.2 && Math.random() < 0.75) return { part: 'track', armor: A.track };
    const key = 'hull' + face;
    return { part: key, armor: A[key] };
  }

  onTankHit(v, hit, p) {
    const def = p.def, id = def.id;
    if (!v.alive && !v.isPlayer) return;
    const fromPlayer = this._fromPlayer(p);
    if (!fromPlayer && !v.isPlayer) return; // no friendly fire between enemy units
    if (v.isPlayer && fromPlayer) return;
    if (id === 'GRENADE' || id === 'SMOKE') return;
    const pen0 = penetration(id, p, hit);
    const z = this.classify(v, hit, p);
    // effective thickness from the angle between the shell path and the struck face
    const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
    const cosT = Math.min(1, Math.max(0.2, -((p.vx * hit.nx + p.vz * hit.nz) / sp)));
    const eff = (z.armor / cosT) * rnd(0.92, 1.08);
    const penetrates = pen0 >= eff;
    const info = { part: z.part, pen: penetrates, hit, proj: p, def, from: { x: -p.vx / sp, z: -p.vz / sp }, soft: SOFT[id] || 0 };
    let type = 'nopen';
    if (z.part === 'track' && pen0 >= 20) {
      v.trackHit(info);
      v.takeDamage(8, info);
      type = 'track';
    } else if (penetrates) {
      const r = DMG[id] || [0, 0];
      const dmg = rnd(r[0], r[1]) * (z.part.startsWith('turret') ? 1.1 : 1) * ((CLASS_DMG[v.cls || 'hard'] || {})[id] ?? 1);
      info.damage = dmg;
      type = 'pen';
      if (v.takeDamage(dmg, info)) type = 'kill';
    } else if (info.soft > 0) {
      info.damage = info.soft;
      if (v.takeDamage(info.soft, info)) type = 'kill';
    }
    info.type = type;
    if (v.alert) v.alert(p.owner && p.owner.x !== undefined ? p.owner.x : v.ctrl.x, p.owner && p.owner.z !== undefined ? p.owner.z : v.ctrl.z, true);
    if (fromPlayer) {
      this.hooks.stat && this.hooks.stat('hit');
      this.hooks.playerShot && this.hooks.playerShot(type, v, z.part);
      if (type === 'kill') this.hooks.stat && this.hooks.stat('kill');
    }
    if (v.isPlayer) this.hooks.playerHit && this.hooks.playerHit(info, v);
    return info;
  }

  // HE/HEAT splash: tanks (armour ignored) and the strongpoint structure
  onExplosion(info) {
    const id = info.ammo && info.ammo.id;
    const fromPlayer = this.player && info.owner === this.player.ctrl;
    if (!fromPlayer) return;
    for (const v of this.victims) {
      if (!v.alive) continue;
      const base = (v.cls === 'light' ? SPLASH_LIGHT : SPLASH_TANK)[id] || 0;
      const d = Math.hypot(v.ctrl.x - info.x, v.ctrl.z - info.z, (v.ctrl.y + 1.2) - info.y);
      if (d >= info.radius) continue;
      const dmg = base * (1 - d / info.radius);
      if (dmg < 1) continue;
      const inf = { part: 'splash', pen: true, damage: dmg, from: { x: 0, z: 0 }, type: 'pen' };
      if (v.alert) v.alert(info.x, info.z, true);
      const killed = v.takeDamage(dmg, inf);
      this.hooks.stat && this.hooks.stat('hit');
      this.hooks.playerShot && this.hooks.playerShot(killed ? 'kill' : 'pen', v, 'splash');
      if (killed) this.hooks.stat && this.hooks.stat('kill');
    }
    // infantry teams: small blast plus fragments
    const sb = SOFT_SPLASH[id] || 0;
    if (sb > 0) {
      for (const t of this.softs) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - info.x, t.y + 0.8 - info.y, t.z - info.z);
        if (d >= info.radius) continue;
        const dmg = sb * (1 - d / info.radius);
        if (dmg < 1) continue;
        if (t.alert) t.alert(info.x, info.z, true);
        const killed = t.hurt(dmg, { def: info.ammo });
        this.hooks.stat && this.hooks.stat('hit');
        this.hooks.playerShot && this.hooks.playerShot(killed ? 'kill' : 'hit', null, 'soft');
      }
    }
    // structures (the strongpoint): HE is by far the best tool
    for (const t of this.world.targets.values()) {
      if (!t.alive || !t.position) continue;
      const d = Math.hypot(t.position.x - info.x, t.position.y - info.y, t.position.z - info.z);
      const mult = STRUCT[id] || 0;
      const dmg = info.damage * mult * Math.max(0, 1 - d / info.radius);
      if (dmg <= 0) continue;
      this.world.damageTarget(t.id, dmg, null, info);
      this.hooks.stat && this.hooks.stat('hit');
      this.hooks.playerShot && this.hooks.playerShot('hit', null, 'structure');
    }
  }

  // direct hits on a structure collider (kinetic only; explosives are handled by their splash)
  structureHit(targetId, hit, p) {
    if (!this._fromPlayer(p)) return;
    const mult = STRUCT[p.def.id];
    if (!mult || p.def.kind === 'explosive') return;
    this.world.damageTarget(targetId, (p.def.damage || 0) * mult, hit, p);
    this.hooks.stat && this.hooks.stat('hit');
    this.hooks.playerShot && this.hooks.playerShot('hit', null, 'structure');
  }

  bindTarget(id) {
    const t = this.world.targets.get(id);
    if (t && t.collider) t.collider.onHit = (hit, p) => this.structureHit(id, hit, p);
  }
}

void Vector3;
export { PEN };
