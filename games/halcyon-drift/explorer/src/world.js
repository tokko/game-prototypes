// Orbit-side simulation: universal time + warp, vessels on conics (analytic when coasting, numeric while thrusting),
// SOI transitions, chained maneuver nodes with time-compressed burns, orbit-mode attitude / SAS / autopilot,
// docking, and the carrier rendezvous used after an ascent. Surface physics lives in flight.js.
import * as THREE from 'three';
import { BODIES, SUN, G0, parkRadius } from './destinations.js';
import { Vessel } from './vessel.js';
import { exhaustV, CARRIER } from './craft.js';
import * as S from './system.js';
import { guideLand, guideAscent, TRANSITION_DOWN } from './flight.js';
import { enu, lonLatOfDir, fToWorld } from './frames.js';
import { density, dragFor, thermalStep, SKIN, atmosphereOf } from './aero.js';

const V3 = THREE.Vector3;
export const WARP = [1, 2, 5, 10, 50, 100, 1e3, 1e4, 1e5, 1e6, 1e7];
export const THRUST_WARP_MAX = 2, AP_WARP_MAX = 3;
export const NODE_STEPS = [1, 10, 100, 1000];
const _s = { r: new V3(), v: new V3() };
const _dv = new V3();
const D2R = Math.PI / 180;

export const AXIS = { carrier: new V3(0, 0, -1), plane: new V3(0, 0, -1), lander: new V3(0, 1, 0) };

export class World {
  constructor() {
    this.t = 0;
    this.warpIndex = 0;
    this.carrier = new Vessel('carrier'); this.lander = new Vessel('lander'); this.plane = new Vessel('plane');
    this.vessels = [this.carrier, this.lander, this.plane];
    this.active = this.carrier;
    this.msgs = []; this.events = [];
    this.groundHeight = () => 0;             // set by main for the body with a surface recipe
    this.hasSurface = (id) => !!BODIES[id]?.recipe;
    this.dockAssist = null;
    this._patchCache = new Map(); this.nodeRev = 0;
  }
  say(text, kind = 'info') { this.msgs.push({ text, kind }); }
  axisOf(v) { return AXIS[v.kind]; }
  thrustDir(v, out = new V3()) { return out.copy(this.axisOf(v)).applyQuaternion(v.q); }

  // ---------------------------------------------------------------- setup
  placeCircular(body, phase, alt, incl = 0, lon0 = 0) {
    const b = BODIES[body], r = alt != null ? b.R + alt : parkRadius(b);
    const st = S.circularState(b.mu, r, phase);
    if (incl) { const E = new V3(-Math.sin(lon0), 0, -Math.cos(lon0)); st.r.applyAxisAngle(E, -incl); st.v.applyAxisAngle(E, -incl); }
    const c = this.carrier;
    c.body = body; c.r.copy(st.r); c.v.copy(st.v); c.status = 'orbit'; c.railed = true;
    this.orientPrograde(c);
    this.rebuild(c, true);
    for (const o of [this.lander, this.plane]) if (o.docked) this.syncDocked(o);
  }
  orientPrograde(v) {
    // thrust axis along prograde, 'up' side radial out
    const pro = v.v.clone().normalize(), rad = v.r.clone().normalize();
    const ax = this.axisOf(v);
    v.q.setFromUnitVectors(ax, pro);
    return v;
  }
  rebuild(v, force) {
    if (v.status !== 'orbit') { v.el = null; return; }
    v.el = S.elementsFromState(S.muOf(v.body), v.r, v.v, this.t);
    v.railed = true; v.numeric = false;
  }
  syncDocked(o) {
    const c = this.carrier;
    o.body = c.body; o.r.copy(c.r); o.v.copy(c.v); o.q.copy(c.q); o.status = 'docked'; o.el = null;
  }
  frameBody(v = this.active) { return BODIES[v.body] || null; }
  altitude(v) { const b = BODIES[v.body]; return b ? v.r.length() - b.R : 0; }
  groundAlt(v) {
    const b = BODIES[v.body]; if (!b) return 0;
    const n = v.r.clone().normalize(); const { lon, lat } = lonLatOfDir(n);
    return v.r.length() - b.R - (this.hasSurface(v.body) ? this.groundHeight(lon * b.R, -lat * b.R, v.body) : 0);
  }
  /** current state of a railed vessel */
  sync(v) { if (v.railed && v.el) { S.stateAt(v.el, this.t, _s); v.r.copy(_s.r); v.v.copy(_s.v); } }

  // ---------------------------------------------------------------- warp
  isThrusting(v) { return v.status === 'orbit' && !v.docked && (v.throttle > 0.0001 || v.burn || v.ap) && v.hasProp(); }
  maxWarpIndex() {
    let max = WARP.length - 1;
    const a = this.active;
    if (!a || a.status !== 'orbit') return 0;
    if (a.burn || a.throttle > 0.0001) max = Math.min(max, THRUST_WARP_MAX);
    if (a.ap) max = Math.min(max, AP_WARP_MAX);
    if (a.numeric) max = Math.min(max, 4);
    const alt = this.altitude(a), b = BODIES[a.body];
    if (b && alt < Math.max(5000, b.R * 0.03) && !a.railed) max = Math.min(max, 2);
    if (a.railed && a.el) {
      const ev = this.railsEvent(a);
      let dt = ev.t - this.t;
      const nd = a.nodes.find((n) => n.t > this.t);
      if (nd) dt = Math.min(dt, nd.t - 20 - this.t);
      if (isFinite(dt)) while (max > 0 && WARP[max] * 3 > dt) max--;
    }
    return max;
  }
  setWarp(i) {
    i = Math.max(0, Math.min(WARP.length - 1, i));
    const lim = this.maxWarpIndex();
    if (i > lim) { i = lim; this.say(`Warp limited to ${WARP[lim]}x here`, 'warn'); }
    this.warpIndex = i;
  }
  railsEvent(v) {
    const c = this._patchCache.get(v.id + ':ev');
    if (c && c.el === v.el && c.rev === this.nodeRev && this.t <= c.t) return c;
    const atm = BODIES[v.body]?.atmosphere ? atmosphereOf(v.body) : null;
    const ev = S.findEvent(v.body, v.el, this.t, atm ? atm.top : 0);      // atmospheric bodies: the event is the atmospheric interface
    const rec = { el: v.el, rev: this.nodeRev, t: ev.t + 2e-3, type: ev.type, body: ev.body };
    this._patchCache.set(v.id + ':ev', rec);
    return rec;
  }
  /** predicted conic chain for the active vessel (cached) */
  patches(v = this.active) {
    if (v.status !== 'orbit' || !v.el) return [];
    const c = this._patchCache.get(v.id + ':pc');
    const now = performance.now();
    if (c && c.rev === this.nodeRev && c.el === v.el && (now - c.time < 600)) return c.p;
    const p = S.predict({ body: v.body, r: v.r, v: v.v, el: v.el }, this.t, v.nodes, { maxPatches: 9, maxT: 6e8 });
    this._patchCache.set(v.id + ':pc', { rev: this.nodeRev, el: v.el, time: now, p });
    return p;
  }
  touchNodes() { this.nodeRev++; this._patchCache.clear(); }

  // ---------------------------------------------------------------- main step
  step(dtReal, ctl) {
    dtReal = Math.min(dtReal, 0.1);
    const a = this.active;
    const lim = this.maxWarpIndex();
    if (this.warpIndex > lim) { this.warpIndex = lim; }
    let remaining = dtReal * WARP[this.warpIndex];
    const anyNumeric = this.vessels.some((v) => v.status === 'orbit' && !v.docked && (v.numeric || this.isThrusting(v) || v.throttle > 0));
    const maxSub = anyNumeric ? 0.05 : Infinity;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 800) {
      let h = Math.min(remaining, maxSub);
      // events for railed vessels (active only matters for SOI changes; others stay put)
      let evHit = null;
      for (const v of this.vessels) {
        if (v.status !== 'orbit' || v.docked || !v.railed || !v.el) continue;
        const nd = v.nodes.find((n) => n.t > this.t - 1e-6);
        if (nd && nd.t - this.t < h) { h = Math.max(0, nd.t - this.t); evHit = { v, type: 'node', node: nd }; }
        if (v === this.active || v === this.carrier) {
          const ev = this.railsEvent(v);
          if (ev.type !== 'none' && ev.t - this.t < h) { h = Math.max(0, ev.t - this.t); evHit = { v, type: ev.type, body: ev.body }; }
        }
      }
      this.advance(h, ctl);
      remaining -= h;
      if (evHit) this.handleEvent(evHit);
      if (this.events.length) break;
    }
  }

  advance(h, ctl) {
    this.t += h;
    for (const v of this.vessels) {
      if (v.fxT > 0) { v.fxT -= h; if (v.fxT <= 0) { v.fxT = 0; v.throttle = 0; } }
      if (v.status === 'surface') continue;
      if (v.docked) continue;
      if (v === this.active && ctl && ctl.throttle > 0 && v.hasProp() && !v.numeric) { this.sync(v); v.numeric = true; v.railed = false; }
      if (v.railed && !v.numeric) { this.sync(v); if (v === this.active && ctl) this.controlAttitude(v, h, ctl); if (v.skinT > 301) thermalStep(v, 0, 0, h); }
      else this.numericStep(v, h, v === this.active ? ctl : null);
    }
    for (const o of [this.lander, this.plane]) if (o.docked) this.syncDocked(o);
    // docking assist (scripted approach)
    if (this.dockAssist) this.stepDock(h);
    // auto node burns
    for (const v of this.vessels) if (v.status === 'orbit' && !v.docked && v.nodes.length && !v.burn && v.railed) {
      const nd = v.nodes[0];
      if (v.autoNodes !== false && this.t >= nd.t) this.startBurn(v, nd);
    }
  }

  handleEvent(e) {
    const v = e.v;
    if (e.type === 'node') return;
    this.sync(v);
    if (e.type === 'enter' || e.type === 'exit') this.crossSoi(v, e.type, e.body);
    else if (e.type === 'impact') {
      const b = BODIES[v.body];
      if (b && b.atmosphere && v.r.length() > b.R + 200) {                    // atmospheric interface: switch to stepped dynamics so drag and heating act
        v.numeric = true; v.railed = false; this.warpIndex = 0; this.touchNodes();
        if (v === this.active) this.say(`Atmospheric interface at ${b.name}: drag and reentry heating active`, 'warn');
      } else this.impact(v);
    }
  }
  crossSoi(v, type, childId) {
    if (type === 'enter') { const c = S.crossEnter(v.r, v.v, childId, this.t); v.r.copy(c.r); v.v.copy(c.v); v.body = childId; }
    else { const c = S.crossExit(v.r, v.v, v.body, this.t); v.r.copy(c.r); v.v.copy(c.v); v.body = S.parentId(v.body); }
    this.rebuild(v);
    if (v === this.active || v.id === 'carrier') {
      this.say(`Entering ${BODIES[v.body]?.name || SUN.name} sphere of influence`, 'ok');
      if (v === this.active) this.warpIndex = Math.min(this.warpIndex, 6);
    }
    this.touchNodes();
    this.events.push({ type: 'soi', v });
  }
  impact(v) {
    // no surface here for this craft: abort the descent back into a safe parking orbit
    const b = BODIES[v.body];
    if (v === this.active) this.say(this.hasSurface(v.body) ? 'Surface contact' : `Descent aborted: ${b.name} surface survey pending`, 'warn');
    if (this.hasSurface(v.body) && v.kind !== 'carrier') { this.events.push({ type: 'enterSurface', v }); return; }
    const ph = Math.atan2(-v.r.z, v.r.x);
    const st = S.circularState(b.mu, parkRadius(b), ph);
    v.r.copy(st.r); v.v.copy(st.v); this.rebuild(v); this.touchNodes();
    if (v === this.active) this.warpIndex = 0;
  }

  // ---------------------------------------------------------------- numeric (thrusting) orbit stepping
  numericStep(v, h, ctl) {
    const b = BODIES[v.body]; const mu = S.muOf(v.body);
    const env = { vtol: false, rho: 0, mach: 0, ap: !!v.ap };
    const alt = b ? v.r.length() - b.R : 1e9;
    let rho = 0;
    if (b && b.atmosphere) { rho = density(v.body, alt); env.rho = rho; env.mach = v.v.length() / 320; }
    const eng = v.engine(env);
    const mass = v.mass(this);
    // attitude control
    if (v === this.active) this.controlAttitude(v, h, ctl);
    // throttle: autopilot / manual / burn
    let thr = v === this.active ? (ctl ? ctl.throttle : v.throttle) : 0;
    let burnA = 0;
    if (v.burn) {
      const bn = v.burn; const dvStep = Math.min(bn.remaining, bn.rate * h);
      const ve = exhaustV(eng.isp);
      const avail = v.tanks[eng.uses === 'h2' ? 'h2' : 'fuel'] > 0.5;
      if (!avail && eng.uses !== 'h2' && eng.uses !== 'fuel') { /* chem handled by hasProp */ }
      if (!v.hasProp(eng)) { this.say('Out of propellant: burn aborted', 'warn'); v.burn = null; }
      else {
        const dm = Math.min(mass * (1 - Math.exp(-dvStep / ve)), this.propLeft(v, eng));
        const dvDone = ve * Math.log(mass / (mass - dm));
        v.v.addScaledVector(bn.dir, dvDone); v.consume(eng, dm);
        bn.remaining -= dvDone; v.throttle = 1; thr = 0;
        v.q.rotateTowards(bn.qT, 3 * h + 0.05);
        if (bn.remaining <= 1e-3 || dm <= 1e-6) { v.burn = null; v.throttle = 0; v.nodes.shift(); this.touchNodes(); this.say(`Burn complete: ${bn.total.toFixed(0)} m/s`, 'ok'); this.endNumeric(v); }
      }
    }
    if (v.ap && v === this.active) thr = this.autopilot(v, h, eng, mass);
    if (!v.hasProp(eng)) thr = 0;
    if (!v.burn) v.throttle = thr;
    // dynamics
    const rm = v.r.length();
    const acc = new V3().copy(v.r).multiplyScalar(-mu / (rm * rm * rm));
    if (thr > 0 && !v.burn) {
      const dir = this.thrustDir(v, new V3());
      acc.addScaledVector(dir, eng.thrust * thr / mass);
      const dm = v.mdot(eng, thr) * h; v.consume(eng, dm);
    }
    {
      const sp = v.v.length();
      if (rho > 0) {
        let dd = dragFor(v.kind, rho, sp);
        if (v.kind === 'plane') {          // nose-first the plane is a streamlined body (beta ~ 14,000 kg/m2); tail-first / broadside it is blunt
          const nose = _dv.set(0, 0, -1).applyQuaternion(v.q), al = nose.dot(v.v) / Math.max(sp, 1);
          const k = THREE.MathUtils.smoothstep(al, -0.2, 0.6); dd *= 1 / (1 + 21 * k);
        }
        acc.addScaledVector(v.v, -dd / Math.max(sp, 1));
      }
      this.reentry(v, rho, sp, h);
    }
    v.v.addScaledVector(acc, h); v.r.addScaledVector(v.v, h);
    // transitions while numeric
    this.numericTransitions(v);
    if (!v.burn && thr === 0 && !v.ap && rho === 0 && (!ctl || ctl.throttle === 0)) this.endNumeric(v);
    else v.numeric = true;
    if (v.numeric) v.railed = false;
  }
  propLeft(v, eng) {
    const t = v.tanks, mix = v.spec.mixture || 3.6;
    if (eng.uses === 'h2') return t.h2; if (eng.uses === 'fuel') return t.fuel;
    return Math.min(t.fuel * (1 + mix), t.ox * (1 + 1 / mix));
  }
  endNumeric(v) { v.numeric = false; this.rebuild(v); this.touchNodes(); }
  numericTransitions(v) {
    const b = BODIES[v.body] || S.SUN_NODE; const rm = v.r.length();
    if (v.body !== S.ROOT && rm >= b.soi) { this.crossSoi(v, 'exit'); return; }
    for (const id of (S.frame(v.body).children || [])) {
      const c = BODIES[id]; S.bodyRel(id, this.t, _s);
      if (_dv.copy(v.r).sub(_s.r).length() <= c.soi) { this.crossSoi(v, 'enter', id); return; }
    }
    const bb = BODIES[v.body];
    if (bb && rm <= bb.R + 1) {
      this.sync2(v);
      if (v === this.active) { if (this.hasSurface(v.body) && v.kind !== 'carrier') this.events.push({ type: 'enterSurface', v }); else this.impact(v); }
    }
  }
  sync2() { }
  reentry(v, rho, sp, h) {
    const f = thermalStep(v, rho, sp, h);
    this.entryEffects(v, rho, sp, f);
  }
  /** warnings, forced retraction of deployables, thermal damage messages (shared by the surface scene) */
  entryEffects(v, rho, sp, f) {
    if (v.kind === 'plane') {
      const extended = v.dep.panels > 0.05 || v.dep.radiators > 0.05;
      if (extended && (v.glow > 0.02 || 0.5 * rho * sp * sp > 4000)) {
        if (!v.warn.q) { v.warn.q = true; if (v === this.active) this.say('WARNING: panels/radiators extended in the airstream. Retracting.', 'warn'); }
        v.depT.panels = 0; v.depT.radiators = 0;
      } else if (v.glow < 0.01) v.warn.q = false;
      v.aeroHeat = Math.min(40, v.entryQ * 20);
    }
    if (v !== this.active) return;
    if (f.damaging) { if (!v.warn.dmg) { v.warn.dmg = true; this.say('SKIN OVER LIMIT: hull is taking damage. Pitch up / slow down / get out of the dense air', 'warn'); } }
    else if (f.warn) { if (!v.warn.hot) { v.warn.hot = true; this.say('Skin temperature high: reentry heating', 'warn'); } }
    if (!f.warn) { v.warn.hot = false; }
    if (v.skinT < 0.7 * SKIN[v.kind].limit) v.warn.dmg = false;
  }

  // ---------------------------------------------------------------- attitude / SAS / autopilots
  controlAttitude(v, h, ctl) {
    if (v.burn) return;
    const rate = (v.kind === 'carrier' ? 12 : 30) * D2R;
    const ax = this.axisOf(v);
    if (ctl && (ctl.pitch || ctl.yaw || ctl.roll)) {
      const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(ctl.pitch * rate * h, ctl.yaw * rate * h, ctl.roll * rate * h, 'YXZ'));
      v.q.multiply(dq); v.sas = v.sas === 'free' ? 'free' : v.sas; if (v.sas !== 'free' && v.holdKeys) v.sas = 'free';
      return;
    }
    const d = this.sasDirection(v);
    if (d) {
      const cur = new V3().copy(ax).applyQuaternion(v.q);
      const qd = new THREE.Quaternion().setFromUnitVectors(cur, d).multiply(v.q);
      v.q.rotateTowards(qd, rate * 2.2 * h + 1e-4);
    }
  }
  sasDirection(v) {
    if (v.ap && v.ap.dir) return v.ap.dir;
    const m = v.sas;
    if (m === 'free') return null;
    const sp = v.v.length(); if (sp < 0.05) return null;
    if (m === 'pro') return v.v.clone().normalize();
    if (m === 'retro') return v.v.clone().normalize().negate();
    if (m === 'up') return v.r.clone().normalize();
    if (m === 'node' && v.nodes[0]) return this.nodeDir(v, v.nodes[0]);
    return null;
  }
  nodeDir(v, n) {
    if (!v.el) return null;
    S.nodeDvVector(v.el, n, _dv, _s);
    return _dv.length() > 1e-6 ? _dv.clone().normalize() : null;
  }
  /** returns throttle 0..1 */
  autopilot(v, h, eng, mass) {
    const ap = v.ap, b = BODIES[v.body];
    const rm = v.r.length(); const n = v.r.clone().divideScalar(rm);
    const { lon, lat } = lonLatOfDir(n);
    const { E, N, U } = enu(lon, lat);
    const vel = new V3(v.v.dot(E), v.v.dot(U), -v.v.dot(N));
    const vh = Math.hypot(vel.x, vel.z);
    const g = b.mu / (rm * rm), gEff = g - vh * vh / rm;
    const aMax = eng.thrust / mass;
    const h0 = this.groundAlt(v);
    let aT = new V3();
    if (ap.type === 'descent') {
      guideLand(h0, vel, aMax, gEff, aT);
      if (h0 < TRANSITION_DOWN + 500 && this.hasSurface(v.body)) { /* surface handover happens in main at TRANSITION_DOWN */ }
    } else if (ap.type === 'ascent') {
      const r = guideAscent(h0, vel, aMax, gEff, ap.heading ?? Math.PI / 2, b.parkAlt * (b.atmosphere ? 0.45 : 0.75), Math.sqrt(b.mu / rm), aT, b.atmosphere ? 520 : 300);   // atmospheric worlds: insert lower (less climb to pay for)
      if (r.done) { v.ap = null; v.throttle = 0; this.say('Orbit achieved', 'ok'); this.events.push({ type: 'ascentDone', v }); return 0; }
    } else { v.ap = null; return 0; }
    // to F frame
    const aF = new V3().addScaledVector(E, aT.x).addScaledVector(U, aT.y).addScaledVector(N, -aT.z);
    const len = aF.length();
    if (len < 1e-6) { ap.dir = null; return 0; }
    ap.dir = aF.clone().normalize();
    const cur = this.thrustDir(v);
    const align = THREE.MathUtils.clamp((cur.dot(ap.dir) - 0.9) / 0.09, 0, 1);
    const thr = THREE.MathUtils.clamp(len / aMax, 0, 1) * align;
    return v.hasProp(eng) ? thr : 0;
  }
  startAp(v, type, extra = {}) {
    if (v.status !== 'orbit' || v.docked) return false;
    v.ap = { type, ...extra }; v.numeric = true; v.railed = false; this.warpIndex = Math.min(this.warpIndex, AP_WARP_MAX); return true;
  }
  cancelAp(v) { v.ap = null; v.throttle = 0; }

  // ---------------------------------------------------------------- maneuver nodes
  addNode(v, t) {
    const n = { t, dv: { pro: 0, nrm: 0, rad: 0 } };
    v.nodes.push(n); v.nodes.sort((a, b) => a.t - b.t); this.touchNodes(); return n;
  }
  nodeDvTotal(n) { return Math.hypot(n.dv.pro, n.dv.nrm, n.dv.rad); }
  /** Execute a node: the delta-v is applied at the node time (exactly what the patched-conic prediction assumed);
   *  propellant is consumed by the rocket equation and the engine flame plays for a few seconds. */
  startBurn(v, nd) {
    if (!v.el) return;
    this.sync(v);
    S.nodeDvVector(v.el, nd, _dv, _s);
    const total = _dv.length();
    v.nodes.shift(); this.touchNodes();
    if (total < 1e-3) return;
    const eng = v.engine({ vtol: false, rho: 0, ap: false });
    const mass = v.mass(this), ve = exhaustV(eng.isp);
    const maxDv = ve * Math.log(mass / Math.max(1, mass - this.propLeft(v, eng)));
    let dvA = total;
    if (maxDv < total) { dvA = maxDv * 0.999; if (v === this.active) this.say('Out of propellant: burn cut short', 'warn'); }
    const dm = mass * (1 - Math.exp(-dvA / ve)); v.consume(eng, dm);
    const dir = _dv.clone().normalize();
    const cur = this.thrustDir(v);
    v.q.premultiply(new THREE.Quaternion().setFromUnitVectors(cur, dir));
    v.v.addScaledVector(dir, dvA);
    v.fxT = THREE.MathUtils.clamp(total / Math.max(eng.thrust / mass, 0.1), 3, 9); v.throttle = 1;
    this.rebuild(v);
    if (v === this.active) this.say(`Burn executed: ${dvA.toFixed(0)} m/s`, 'ok');
  }
  /** estimated real burn time at the craft's thrust (for display) */
  burnTime(v, dv) {
    const eng = v.engine({}); const m0 = v.mass(this); const ve = exhaustV(eng.isp);
    return (m0 * (1 - Math.exp(-dv / ve))) / (eng.thrust / ve);
  }

  // ---------------------------------------------------------------- docking
  undock(which) {
    const c = this.carrier, d = which;
    if (!d.docked || c.status !== 'orbit') return false;
    d.docked = false; d.status = 'orbit';
    const out = new V3(which.kind === 'lander' ? -1 : 1, 0, 0);
    const portLocal = (which.kind === 'lander' ? new V3(-5.2, -1.3, -5.0) : new V3(5.2, -1.3, -3.0)).addScaledVector(out, which.kind === 'plane' ? 24 : 16);
    const off = portLocal.clone().applyQuaternion(c.q);
    d.r.copy(c.r).add(off);
    d.v.copy(c.v).addScaledVector(out.clone().applyQuaternion(c.q), 0.5);
    d.q.copy(c.q);
    // daughter axes: orient prograde
    if (d.kind === 'lander') d.q.setFromUnitVectors(AXIS.lander, c.v.clone().normalize().negate().add(new V3(0, 0, 0)).normalize());
    d.body = c.body; d.numeric = false; this.rebuild(d);
    d.sas = 'free'; d.nodes = [];
    this.active = d;
    this.say(`${d.name} undocked`, 'ok');
    return true;
  }
  /** begin scripted docking approach (forgiving): needs the same body and < 8 km */
  startDock(d) {
    const c = this.carrier;
    if (d.docked || d.body !== c.body || d.status !== 'orbit' || c.status !== 'orbit') { this.say('Cannot dock: not in the same orbit as the carrier', 'warn'); return false; }
    this.sync(d); this.sync(c);
    const dist = d.r.distanceTo(c.r);
    if (dist > 12000) { this.say(`Carrier is ${(dist / 1000).toFixed(0)} km away: too far for the docking assist (< 12 km)`, 'warn'); return false; }
    d.ap = null; d.throttle = 0;
    const port = (d.kind === 'lander' ? new V3(-5.2, -1.3, -5.0) : new V3(5.2, -1.3, -3.0));
    this.dockAssist = { d, t0: this.t, dur: 14, rel0: d.r.clone().sub(c.r), vrel0: d.v.clone().sub(c.v), port };
    this.say('Docking assist engaged', 'info');
    return true;
  }
  stepDock(h) {
    const a = this.dockAssist, c = this.carrier, d = a.d;
    this.sync(c);
    const u = Math.min(1, (this.t - a.t0) / a.dur), k = u * u * (3 - 2 * u);
    const target = a.port.clone().applyQuaternion(c.q);
    d.r.copy(c.r).add(a.rel0.clone().multiplyScalar(1 - k)).addScaledVector(target, k);
    d.v.copy(c.v);
    d.railed = false; d.numeric = false; d.el = null;
    d.q.slerp(c.q, 0.08);
    if (u >= 1) { d.docked = true; d.status = 'docked'; this.dockAssist = null; this.active = c; this.say(`${d.name} docked`, 'ok'); this.touchNodes(); this.events.push({ type: 'docked', v: d }); }
  }
  /** after an ascent: park the carrier 6 km ahead in the daughter's orbit (so the rendezvous stays short) */
  parkCarrierAhead(d) {
    const c = this.carrier; if (c.status !== 'orbit' || c.docked) return;
    if (c.body !== d.body) return;
    const el = S.elementsFromState(S.muOf(d.body), d.r, d.v, this.t);
    const dt = 6000 / d.v.length();
    S.stateAt(el, this.t + dt, _s);
    c.body = d.body; c.r.copy(_s.r); c.v.copy(_s.v); c.status = 'orbit';
    // keep daughters docked to it only if they are docked (they are not)
    this.orientPrograde(c); this.rebuild(c);
    this.say('Carrier holding 6 km ahead: dock with C', 'info');
  }
}
