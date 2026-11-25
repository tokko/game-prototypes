// Vessel: carrier / lander / spaceplane state, real masses, per-mode engines, power + heat (plane), propellant use.
import * as THREE from 'three';
import { CARRIER, LANDER, PLANE, exhaustV, dvFor, carrierDv, landerDv, planeDv } from './craft.js';
import { G0 } from './destinations.js';
import { jetThrustFactor } from './aero.js';

const V3 = THREE.Vector3;

export class Vessel {
  constructor(kind) {
    this.kind = kind; this.id = kind;
    this.spec = { carrier: CARRIER, lander: LANDER, plane: PLANE }[kind];
    this.name = this.spec.name;
    this.body = 'kestrel';
    this.r = new V3(); this.v = new V3(); this.q = new THREE.Quaternion();
    this.el = null; this.railed = true; this.numeric = false;
    this.docked = kind !== 'carrier';
    this.status = 'orbit';          // 'orbit' | 'surface' | 'docked'
    this.nodes = [];
    this.target = null;
    this.throttle = 0;
    this.sas = 'free';              // free | pro | retro | up | node | target
    this.ap = null;                 // orbit-mode autopilot {type}
    this.burn = null;               // time-compressed node burn
    this.tanks = kind === 'carrier' ? { h2: CARRIER.propMax } : kind === 'lander' ? { fuel: LANDER.fuelMax, ox: LANDER.oxMax } : { fuel: PLANE.fuelMax, ox: PLANE.oxMax, h2: PLANE.h2Max };
    this.cargo = { h2: 0 };         // refined hydrogen carried for the carrier
    this.mode = 'auto';             // plane engine mode request
    this.engineId = kind === 'carrier' ? 'ntr' : kind === 'lander' ? 'chem' : 'rocket';
    // systems (plane): deploy 0..1 (target + current), power, heat
    this.dep = { panels: 0, radiators: 0, ramp: 0, drill: 0, sensor: 0 }; this.depT = { panels: 0, radiators: 0, ramp: 0, drill: 0, sensor: 0 };      // drill / sensor: Prospector
    this.sysBatt = (this.spec.battery || PLANE.battery) * 0.8; this.heat = 8; this.warn = {};
    this.drilling = 0; this.refining = 0; this.damage = 0;
    this.skinT = 300; this.glow = 0; this.heatFrac = 0; this.entryQ = 0;   // reentry skin temperature model (aero.js thermalStep)
    this.surf = null;               // surface state when status==='surface'
    this.heatLoad = 0; this.powerNet = 0; this.overheat = false;
    this.bikeStowed = kind === 'plane';
    this.stance = 'vertical'; this.tip = 0; this.tipT = 0;   // plane on the ground: vertical (tail-down) | tipping | flat
  }
  get isDaughter() { return this.kind !== 'carrier'; }
  selfMass() {
    const t = this.tanks; let m = this.spec.dry;
    for (const k in t) m += t[k];
    m += this.cargo.h2;
    return m;
  }
  mass(world) {
    let m = this.selfMass();
    if (this.kind === 'carrier' && world) for (const o of world.vessels) if (o !== this && o.docked) m += o.selfMass();
    return m;
  }
  /** which engine is active right now given the environment ({atm density ratio, speed, status}) */
  engine(env = {}) {
    const dmgK = 1 - 0.45 * Math.min(1, this.damage || 0);   // thermal/impact damage degrades engines
    if (this.kind === 'carrier') return { id: 'ntr', thrust: CARRIER.thrust * dmgK, isp: CARRIER.isp, axis: 'fwd', uses: 'h2' };
    if (this.kind === 'lander') return { id: 'chem', thrust: LANDER.thrust * dmgK, isp: LANDER.isp, axis: 'up', uses: 'chem' };
    const md = PLANE.modes;
    let id = this.mode;
    const hasAir = (env.rho || 0) > 1e-4;
    if (id === 'auto') {
      if (env.ap) id = 'rocket';
      else if (hasAir && this.tanks.fuel > 1 && (env.mach || 0) < 6.5) id = 'jet';
      else if (env.vtol) id = 'rocket';
      else if (this.tanks.h2 > 1 && this.status === 'orbit') id = 'nuclear';
      else id = 'rocket';
    }
    if (id === 'jet' && !hasAir) id = 'rocket';
    this.engineId = id;
    let thrust = md[id].thrust * dmgK;
    if (id === 'jet') thrust *= jetThrustFactor(env.rho || 0, env.mach || 0);
    // hot nuclear core throttles back when the radiators cannot keep up
    if (id === 'nuclear' && this.overheat) thrust *= 0.25;
    return { id, thrust, isp: md[id].isp, axis: 'fwd', uses: md[id].uses };
  }
  hasProp(eng) {
    eng = eng || this.engine({ vtol: this.status === 'surface' });
    const t = this.tanks;
    if (eng.uses === 'h2') return (t.h2 || 0) > 0.5;
    if (eng.uses === 'fuel') return (t.fuel || 0) > 0.5;
    return (t.fuel || 0) > 0.2 && (t.ox || 0) > 0.5;
  }
  /** burn `dm` kg of propellant for engine eng; returns false if the tanks ran dry */
  consume(eng, dm) {
    const t = this.tanks, mix = this.spec.mixture || 3.6;
    if (eng.uses === 'h2') { t.h2 = Math.max(0, t.h2 - dm); return t.h2 > 0; }
    if (eng.uses === 'fuel') { t.fuel = Math.max(0, t.fuel - dm); return t.fuel > 0; }
    const f = dm / (1 + mix), o = dm * mix / (1 + mix);
    t.fuel = Math.max(0, t.fuel - f); t.ox = Math.max(0, t.ox - o);
    return t.fuel > 0 && t.ox > 0;
  }
  mdot(eng, throttle) { return eng.thrust * throttle / (eng.isp * G0); }
  /** acceleration at full throttle (m/s^2) */
  accelMax(world, env) { const e = this.engine(env); return this.hasProp(e) ? e.thrust / this.mass(world) : 0; }
  dvRemaining(world, env = {}) {
    const e = this.engine(env); const m0 = this.mass(world); const ve = exhaustV(e.isp);
    const t = this.tanks, mix = this.spec.mixture || 3.6;
    let usable;
    if (e.uses === 'h2') usable = t.h2; else if (e.uses === 'fuel') usable = t.fuel;
    else usable = Math.min(t.fuel * (1 + mix), t.ox * (1 + 1 / mix));
    return usable > 0 ? dvFor(m0, m0 - usable, e.isp) : 0;
  }
  propFraction(k) {
    const max = { fuel: this.spec.fuelMax, ox: this.spec.oxMax, h2: this.spec.h2Max ?? this.spec.propMax }[k] || 1;
    return (this.tanks[k] || 0) / max;
  }

  // ---- plane systems: power + heat, deploy animation targets ----
  stepSystems(dt, sunFactor, extra = {}) {
    if (this.kind === 'carrier') return;
    const S = this.spec;          // plane: PLANE, lander (Prospector): LANDER
    for (const k of ['panels', 'radiators', 'ramp', 'drill', 'sensor']) {
      const d = this.depT[k] - this.dep[k]; this.dep[k] += Math.sign(d) * Math.min(Math.abs(d), dt / (k === 'ramp' ? 3 : k === 'drill' ? 3.2 : k === 'sensor' ? 1.6 : 4));
    }
    const eng = this.engineId;
    const nuclearOn = this.kind === 'plane' && eng === 'nuclear' && this.throttle > 0.01;
    let load = 0.3 + (this.drilling ? 5 : 0) + (this.refining ? 7 : 0) + (extra.driveLoad || 0) + (this.dep.sensor > 0.5 ? 0.4 : 0);
    let heatIn = (this.drilling ? 4 : 0) + (this.refining ? 6 : 0) + (nuclearOn ? S.modes.nuclear.heat * this.throttle : 0) + (extra.aeroHeat || 0) + (extra.driveHeat || 0);
    const gen = S.panelPower * this.dep.panels * Math.max(0, sunFactor) * (this.damage > 0.5 ? 0.3 : 1);
    this.sysBatt = Math.max(0, Math.min(S.battery, this.sysBatt + (gen - load) * dt * 0.15));
    this.powerNet = gen - load;
    const rej = S.radiatorRejection * this.dep.radiators + 1.2 + Math.max(0, this.heat - 40) * 0.05;
    this.heat = Math.max(2, Math.min(S.heatCap, this.heat + (heatIn - rej) * dt * 0.35));
    this.heatLoad = heatIn - rej;
    this.overheat = this.heat > S.heatCap * 0.85;
    // overheat throttles systems rather than killing the player
    if (this.overheat) { this.drilling = 0; this.refining = 0; }
    if (this.sysBatt <= 0.01) { this.drilling = 0; this.refining = 0; }
  }
  deployPanels(on) { this.depT.panels = on ? 1 : 0; }
}
