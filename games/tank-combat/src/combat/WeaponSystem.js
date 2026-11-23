// Cannon (ammo selection, chambering/reload), coaxial MG and smoke launcher for one tank.
import { Vector3 } from 'three';
import { AMMO, MG, GRENADE, COSTS } from './Ammo.js';
import { DEG } from '../util/math.js';

export class WeaponSystem {
  // hooks: onFire(def, pos, dir), onMGShot(pos, dir), onSmokeLaunch(), onMessage(text)
  constructor({ model, turret, projectiles, owner, hooks = {} }) {
    this.model = model;
    this.turret = turret;
    this.projectiles = projectiles;
    this.owner = owner;
    this.hooks = hooks;

    this.counts = AMMO.map((a) => a.count);
    this.chambered = 0;      // index of the round in the breech, -1 if none
    this.selected = 0;       // type the crew will load / has loaded
    this.loadingType = -1;   // type currently being loaded
    this.reloadTimer = 0;
    this.reloadDuration = COSTS.reloadTime;

    this.mgBelt = MG.belt;
    this.mgTimer = 0;
    this.mgFiring = false;

    this.smokeCharges = COSTS.smokeCharges;
    this.smokeCooldown = 0;
    this.salvo = []; // pending grenade launches: { delay, i, n }

    this.recoilT = 99;
    this.recoilDist = 0.6;

    this._pos = new Vector3();
    this._dir = new Vector3();
    this._tmp = new Vector3();
  }

  get ready() { return this.chambered >= 0; }
  get selectedDef() { return AMMO[this.selected]; }
  get loadFraction() {
    if (this.chambered >= 0) return 1;
    if (this.loadingType < 0) return 0;
    return 1 - Math.max(0, this.reloadTimer) / this.reloadDuration;
  }
  get totalRounds() { return this.counts.reduce((a, b) => a + b, 0); }

  canSelect(i) { return this.counts[i] > 0; }

  selectAmmo(i) {
    if (i < 0 || i >= AMMO.length) return false;
    if (this.counts[i] <= 0) { this.hooks.onMessage && this.hooks.onMessage(AMMO[i].name + ' DEPLETED'); return false; }
    if (this.chambered === i) { this.selected = i; return true; }
    if (this.selected === i && this.loadingType === i) return true;
    this.selected = i;
    if (this.chambered >= 0) {
      // swap: unload the chambered round (returns to the rack) and load the new type
      this.chambered = -1;
      this.loadingType = i;
      this.reloadDuration = COSTS.swapTime;
      this.reloadTimer = COSTS.swapTime;
    } else if (this.loadingType >= 0) {
      this.loadingType = i; // retarget the loading in progress, keep its timer
    } else {
      this.loadingType = i;
      this.reloadDuration = COSTS.reloadTime;
      this.reloadTimer = COSTS.reloadTime;
    }
    return true;
  }

  fireCannon() {
    if (this.chambered < 0) return false;
    const idx = this.chambered, def = AMMO[idx];
    this.model.muzzle.getWorldPosition(this._pos);
    this.turret.getGunDirection(this._dir);
    this.projectiles.spawn(def, this._pos.x, this._pos.y, this._pos.z, this._dir.x, this._dir.y, this._dir.z, this.owner);
    this.counts[idx]--;
    this.chambered = -1;
    this.recoilT = 0;
    // choose what to load next
    let next = this.selected;
    if (this.counts[next] <= 0) next = this.counts.findIndex((c) => c > 0);
    if (next >= 0) {
      this.selected = next; this.loadingType = next;
      this.reloadDuration = COSTS.reloadTime; this.reloadTimer = COSTS.reloadTime;
    } else {
      this.loadingType = -1;
      this.hooks.onMessage && this.hooks.onMessage('OUT OF MAIN GUN AMMO');
    }
    if (this.hooks.onFire) this.hooks.onFire(def, this._pos, this._dir);
    return true;
  }

  fireMG() {
    this.model.mgMuzzle.getWorldPosition(this._pos);
    this.turret.getGunDirection(this._dir);
    const s = MG.spread;
    const dx = this._dir.x + (Math.random() - 0.5) * 2 * s;
    const dy = this._dir.y + (Math.random() - 0.5) * 2 * s;
    const dz = this._dir.z + (Math.random() - 0.5) * 2 * s;
    const l = Math.hypot(dx, dy, dz);
    this.projectiles.spawn(MG, this._pos.x, this._pos.y, this._pos.z, dx / l, dy / l, dz / l, this.owner);
    this.mgBelt--;
    if (this.hooks.onMGShot) this.hooks.onMGShot(this._pos, this._dir);
  }

  deploySmoke() {
    if (this.smokeCharges <= 0) { this.hooks.onMessage && this.hooks.onMessage('NO SMOKE CHARGES'); return false; }
    if (this.smokeCooldown > 0) return false;
    this.smokeCharges--;
    this.smokeCooldown = COSTS.smokeCooldown;
    const n = this.model.dischargers.length;
    // 12 tubes fire 0.06 s apart in a scrambled order so the burst points form a continuous wall (~+-40 deg)
    for (let i = 0; i < n; i++) this.salvo.push({ delay: i * 0.06, tube: i, slot: (i * 5) % n, n });
    if (this.hooks.onSmokeLaunch) this.hooks.onSmokeLaunch(this._pos);
    return true;
  }

  _launchGrenade(s) {
    const d = this.model.dischargers[s.tube];
    d.getWorldPosition(this._pos);
    const yaw = (-40 + (80 * s.slot) / (s.n - 1) + (Math.random() - 0.5) * 4) * DEG;
    const el = (20 + (Math.random() - 0.5) * 4) * DEG;
    this._tmp.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).transformDirection(this.model.turret.matrixWorld);
    this.projectiles.spawn(GRENADE, this._pos.x, this._pos.y, this._pos.z, this._tmp.x, this._tmp.y, this._tmp.z, this.owner, 28 + Math.random() * 3);
    if (this.hooks.onGrenadeLaunch) this.hooks.onGrenadeLaunch(this._pos, this._tmp);
  }

  // ctl: { fireMG: bool }
  update(dt, ctl) {
    if (this.loadingType >= 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) { this.chambered = this.loadingType; this.loadingType = -1; this.reloadTimer = 0; }
    }
    if (this.smokeCooldown > 0) this.smokeCooldown = Math.max(0, this.smokeCooldown - dt);
    for (let i = this.salvo.length - 1; i >= 0; i--) {
      const s = this.salvo[i];
      s.delay -= dt;
      if (s.delay <= 0) { this._launchGrenade(s); this.salvo.splice(i, 1); }
    }

    this.mgFiring = ctl.fireMG && this.mgBelt > 0;
    if (this.mgFiring) {
      this.mgTimer -= dt;
      let guard = 0;
      while (this.mgTimer <= 0 && this.mgBelt > 0 && guard++ < 4) { this.fireMG(); this.mgTimer += 1 / MG.rate; }
    } else this.mgTimer = Math.min(this.mgTimer, 0);

    // barrel recoil: fast stroke back, slower return to battery
    this.recoilT += dt;
    const t = this.recoilT;
    let f;
    if (t < 0.06) f = t / 0.06;
    else { const u = Math.min(1, (t - 0.06) / 0.85); f = 1 - u * u * (3 - 2 * u); }
    this.model.setRecoil(this.recoilDist * f);
  }
}
