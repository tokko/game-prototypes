// Vessel data model, engines/resources and attitude control. No rendering here (see models.js).
// Body axes: +Y nose (thrust pushes along +Y), +Z top, +X right.
import { Vector3, Quaternion } from 'three';
import { G0 } from './orbits.js';

/** Engines burn fuel and oxidizer at this fixed mass mixture (ox kg per fuel kg). */
export const MIX_OX_PER_FUEL = 1.2;
export const FUEL_FRAC = 1 / (1 + MIX_OX_PER_FUEL);

export const SPECS = {
  carrier: {
    kind: 'carrier', label: 'Carrier',
    dry: 60000, fuelCap: 40000 * FUEL_FRAC, oxCap: 40000 * (1 - FUEL_FRAC), oreCap: 20000,
    thrust: 2.4e6, isp: 500, maxRate: 0.25, alpha: 0.3,
    groundOffset: 40, canLand: false, size: 140,
    // power (EC) and heat model: all numbers are per second unless noted
    ecCap: 6000, solarMax: 40, baseGen: 2.0, avionics: 0.4, sasIdle: 0.3, sasMax: 3, drillEC: 0, refEC: 4, refRate: 200,
    heatMax: 1500, heatSoft: 1050, engineHeat: 10, drillHeat: 0, refHeat: 6, fixedRad: 4, radHeat: 24, panelHeat: 3,
    panelAxis: [0, 0, 1], dep: { panels: 1, radiators: 0 },
  },
  lander: {
    kind: 'lander', label: 'Lander',
    dry: 3000, fuelCap: 3600 * FUEL_FRAC, oxCap: 3600 * (1 - FUEL_FRAC), oreCap: 5500,
    thrust: 1.4e5, isp: 360, maxRate: 0.9, alpha: 1.8,
    groundOffset: 3.4, canLand: true, size: 12,
    ecCap: 1000, solarMax: 10, baseGen: 0, avionics: 0.05, sasIdle: 0.05, sasMax: 0.6, drillEC: 1.0, refEC: 1.5, refRate: 50,
    heatMax: 600, heatSoft: 420, engineHeat: 1.5, drillHeat: 1.2, refHeat: 2.0, fixedRad: 0, radHeat: 8, panelHeat: 2,
    panelAxis: [0, 1, 0], dep: { panels: 0, radiators: 0, gear: 0 },
  },
};

// Lander dock pose in the carrier frame: nose (docking port) against the belly, engine pointing away.
export const DOCK_OFFSET = new Vector3(0, 3, -14.4);
export const DOCK_ROT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/** seconds for a deployable to travel fully open/closed */
export const DEP_TIME = { panels: 3, radiators: 2.5, gear: 3 };
export const DEP_NAMES = { panels: 'Solar panels', radiators: 'Radiators', gear: 'Landing gear' };
/** panels/radiators break off above this acceleration (m/s^2) while extended */
export const DEP_G_LIMIT = 1.5 * 9.80665;

export const SAS_MODES = ['stab', 'pro', 'retro', 'normal', 'antinormal', 'radial', 'antiradial', 'target', 'antitarget', 'maneuver'];

export class Vessel {
  constructor(id, name, kind) {
    this.id = id;
    this.name = name;
    this.kind = kind;
    this.spec = SPECS[kind];
    this.body = 'planet';
    this.r = new Vector3();
    this.v = new Vector3();
    this.q = new Quaternion();
    this.w = new Vector3(); // body-frame angular velocity
    this.status = 'flying'; // flying | landed | docked | crashed
    this.dockedTo = null;
    this.landedDir = null;  // unit vector (body frame) when landed
    this.throttle = 0;
    this.sas = { on: true, mode: 'stab' };
    this.ap = null;         // autopilot state (autopilot.js)
    this.nodes = [];        // maneuver nodes [{t, dv: {pro, nrm, rad}}] (m/s in the orbit frame at node time), sorted by t
    this.res = { fuel: this.spec.fuelCap, ox: this.spec.oxCap, ore: 0 };
    this.orbit = null;
    this.railed = true;
    this.stats = { mined: 0, refined: 0, siteId: null };
    this.drilling = false;
    this.refining = false;
    this.flameout = false;
    // electricity / heat / deployables
    this.ec = this.spec.ecCap;
    this.heat = 0;
    this.ecRate = 0; this.heatRate = 0; this.drillF = 0; this.refF = 0;
    this.ecGen = 0; this.ecUse = 0; this.ecNet = 0; this.heatGen = 0; this.heatDis = 0; this.heatNet = 0; this.inSun = true;
    this.ctrlScale = 1;
    this.driving = false; this.driveSpeed = 0; // rover mode (lander, landed)
    this.idleT = 0; this.stress = 0; this.autoRet = [];
    this.dep = {};
    for (const [k, p] of Object.entries(this.spec.dep)) this.dep[k] = { t: p, p, ok: true };
  }
  get propMass() { return this.res.fuel + this.res.ox; }
  get ownMass() { return this.spec.dry + this.res.fuel + this.res.ox + this.res.ore; }
  get isLander() { return this.kind === 'lander'; }

  /** burn `dm` kg of propellant at the fixed mixture; returns the fraction actually available (0..1) */
  burn(dm) {
    if (dm <= 0) return 1;
    const f = Math.min(1, this.res.fuel / (dm * FUEL_FRAC), this.res.ox / (dm * (1 - FUEL_FRAC)));
    this.res.fuel = Math.max(0, this.res.fuel - dm * FUEL_FRAC * f);
    this.res.ox = Math.max(0, this.res.ox - dm * (1 - FUEL_FRAC) * f);
    return f;
  }
  hasProp() { return this.res.fuel > 1e-6 && this.res.ox > 1e-6; }
  massFlow(throttle) { return this.spec.thrust * throttle / (this.spec.isp * G0); }

  noseWorld(out = new Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.q); }

  serialize() {
    return {
      id: this.id, name: this.name, kind: this.kind, body: this.body,
      r: this.r.toArray(), v: this.v.toArray(), q: this.q.toArray(), w: this.w.toArray(),
      status: this.status, dockedTo: this.dockedTo, landedDir: this.landedDir ? this.landedDir.toArray() : null,
      throttle: this.throttle, sas: { ...this.sas }, res: { ...this.res }, stats: { ...this.stats },
      driving: this.driving, driveSpeed: this.driveSpeed,
      nodes: this.nodes.map((n) => ({ t: n.t, dv: { ...n.dv } })),
      ec: this.ec, heat: this.heat, dep: JSON.parse(JSON.stringify(this.dep)), autoRet: [...this.autoRet],
    };
  }
  static deserialize(o) {
    const v = new Vessel(o.id, o.name, o.kind);
    v.body = o.body; v.r.fromArray(o.r); v.v.fromArray(o.v); v.q.fromArray(o.q); v.w.fromArray(o.w);
    v.status = o.status; v.dockedTo = o.dockedTo;
    v.landedDir = o.landedDir ? new Vector3().fromArray(o.landedDir) : null;
    v.throttle = o.throttle; v.sas = { ...o.sas }; v.res = { ...o.res }; v.stats = { ...o.stats };
    v.driving = !!o.driving; v.driveSpeed = o.driveSpeed || 0;
    v.nodes = (o.nodes || []).map((n) => ({ t: n.t, dv: { ...n.dv } }));
    if (o.ec !== undefined) v.ec = o.ec;
    if (o.heat !== undefined) v.heat = o.heat;
    if (o.dep) for (const k of Object.keys(v.dep)) if (o.dep[k]) v.dep[k] = { ...o.dep[k] };
    v.autoRet = o.autoRet ? [...o.autoRet] : [];
    return v;
  }
}

// ---- attitude control ---------------------------------------------------------------
const _n = new Vector3(), _ax = new Vector3(), _wd = new Vector3(), _qi = new Quaternion(), _dq = new Quaternion();

/**
 * Advance orientation by dt.
 * input: Vector3 (x pitch up, y roll right, z yaw left) in [-1,1]
 * dir:   optional world-space direction for the nose (SAS pointing modes)
 */
export function stepAttitude(v, dt, input, dir) {
  const k = v.ctrlScale;  // 0.3 when the battery is flat: weak but still controllable
  const maxRate = v.spec.maxRate * k, alpha = v.spec.alpha * k;
  const manual = input.lengthSq() > 1e-6;
  _wd.set(0, 0, 0);
  if (v.sas.on) {
    if (dir) {
      v.noseWorld(_n);
      const cross = _ax.crossVectors(_n, dir);
      const s = cross.length();
      const ang = Math.atan2(s, _n.dot(dir));
      if (s > 1e-9) cross.divideScalar(s); else cross.set(1, 0, 0).applyQuaternion(v.q);
      _qi.copy(v.q).invert();
      cross.applyQuaternion(_qi);
      const rate = Math.min(maxRate, 1.8 * ang, Math.sqrt(2 * alpha * 0.7 * ang));
      _wd.copy(cross).multiplyScalar(rate);
      _wd.y = 0;
    }
    if (manual) {
      if (Math.abs(input.x) > 0) _wd.x = input.x * maxRate;
      if (Math.abs(input.z) > 0) _wd.z = input.z * maxRate;
    }
    if (manual && Math.abs(input.y) > 0) _wd.y = input.y * maxRate;
  } else if (manual) {
    _wd.copy(v.w);
    if (Math.abs(input.x) > 0) _wd.x = input.x * maxRate;
    if (Math.abs(input.y) > 0) _wd.y = input.y * maxRate;
    if (Math.abs(input.z) > 0) _wd.z = input.z * maxRate;
  } else {
    _wd.copy(v.w);
  }
  const da = alpha * dt;
  v.w.x += Math.max(-da, Math.min(da, _wd.x - v.w.x));
  v.w.y += Math.max(-da, Math.min(da, _wd.y - v.w.y));
  v.w.z += Math.max(-da, Math.min(da, _wd.z - v.w.z));
  const wm = v.w.length();
  if (wm > 1e-9) {
    _dq.setFromAxisAngle(_ax.copy(v.w).divideScalar(wm), wm * dt);
    v.q.multiply(_dq).normalize();
  }
}

/** snap nose to direction (used under on-rails warp) */
export function snapAttitude(v, dir) {
  v.noseWorld(_n);
  _dq.setFromUnitVectors(_n, dir);
  v.q.premultiply(_dq).normalize();
  v.w.set(0, 0, 0);
}
