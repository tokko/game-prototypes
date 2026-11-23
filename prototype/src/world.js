// Simulation world: universal time, patched-conic stepping (on-rails Kepler or numeric while
// thrusting), SOI transitions, ground contact/crash, drilling/refining, docking, objectives,
// trajectory prediction, quicksave serialization. No rendering and no DOM in here.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { BODIES, SUN_DIR, isMoon, sitesOf, ventState } from './bodies.js';
import {
  elementsFromState, stateAt, stateFromAnomaly, anomalyAt, TAU, G0, nodeDvVector, nextApoapsisTime, nextPeriapsisTime,
} from './orbits.js';
import { Vessel, stepAttitude, snapAttitude, FUEL_FRAC, DOCK_OFFSET, DOCK_ROT, DEP_TIME, DEP_NAMES, DEP_G_LIMIT } from './vessels.js';
import { updateAutopilot } from './autopilot.js';

export const WARP = [1, 2, 5, 10, 50, 100, 1000, 10000, 100000];
export const NODE_STEPS = [0.1, 1, 10, 100]; // m/s per node nudge
export const nodeDvTotal = (n) => Math.hypot(n.dv.pro, n.dv.nrm, n.dv.rad);
export const THRUST_WARP_MAX = 5; // index of 100x: highest warp allowed while engines burn (sub-stepped, see step())
const DRILL_RATE = 60;   // kg ore / s (at richness 1)
const PUMP_RATE = { fuel: 250, ox: 300, ore: 600 }; // kg/s while docked (a few seconds for a full refuel)
const MAX_SAFE_VERTICAL = 5, MAX_SAFE_HORIZONTAL = 3.5, MAX_SAFE_TILT = 25 * Math.PI / 180;
const DOCK_RANGE = 50, DOCK_SPEED = 2;
const DRIVE_MAX = 7, DRIVE_ACCEL = 2.2, DRIVE_BRAKE = 7, DRIVE_STEER = 0.5, DRIVE_EC = 0.6; // m/s, m/s^2, m/s^2, rad/s, EC per m/s

export const OBJECTIVES = [
  { id: 'soi', text: 'Transfer to Pell: enter its sphere of influence' },
  { id: 'orbit', text: 'Establish a stable orbit around Pell' },
  { id: 'undock', text: 'Undock the lander' },
  { id: 'land', text: 'Land the lander on Pell' },
  { id: 'drill', text: 'Drill ore at a marked rich site' },
  { id: 'refine', text: 'Refine ore into fuel + oxidizer' },
  { id: 'lift', text: 'Lift off and reach orbit around Pell' },
  { id: 'dock', text: 'Dock the lander with the carrier' },
  { id: 'offload', text: 'Offload ore and refuel the lander' },
];

const ZERO = new Vector3();
const _s = { r: new Vector3(), v: new Vector3() };
const _m = { r: new Vector3(), v: new Vector3() };
const _k1r = new Vector3(), _k1v = new Vector3(), _k2r = new Vector3(), _k2v = new Vector3();
const _k3r = new Vector3(), _k3v = new Vector3(), _k4r = new Vector3(), _k4v = new Vector3();
const _tr = new Vector3(), _tv = new Vector3(), _nose = new Vector3();
const _zero = new Vector3(), _sp = new Vector3(), _sw = new Vector3(), _sax = new Vector3();
const _pl = new Vector3(), _plA = new Vector3();
const PLUME_ACC = 3;   // m/s^2 at the base of an erupting Wren geyser (fades with height)
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class World {
  constructor(opts = {}) {
    this.UT = 0;
    this.vessels = [];
    this.activeId = 'carrier';
    this.warpIndex = 0;
    this.status = 'running'; // running | crashed
    this.crash = null;
    this.msgs = [];
    this.input = { rot: new Vector3(), drive: { fwd: 0, steer: 0, brake: false } };
    this.done = {};          // objective id -> true
    this.flags = {};
    this.revertSave = null;  // snapshot taken right before undock
    this.pumps = [];         // active docked transfers
    this.headless = !!opts.headless;
    this._evCache = new Map();
    this._patchCache = new Map();
    this._nodeRev = 0;       // bumped whenever a maneuver node is edited (invalidates cached predictions)
    this._syncSurvey();
    if (!opts.empty) this.setupInitial();
  }

  // ---- scenario ---------------------------------------------------------------------
  setupInitial() {
    const planet = BODIES.planet;
    const alt = 120e3, r = planet.radius + alt, phase = 0.3;
    const carrier = new Vessel('carrier', 'ISV Meridian', 'carrier');
    const lander = new Vessel('lander', 'Pell Lander', 'lander');
    carrier.r.set(Math.cos(phase) * r, Math.sin(phase) * r, 0);
    const vc = Math.sqrt(planet.mu / r);
    carrier.v.set(-Math.sin(phase) * vc, Math.cos(phase) * vc, 0);
    const rh = carrier.r.clone().normalize(), vh = carrier.v.clone().normalize();
    const X = new Vector3().crossVectors(vh, rh);
    carrier.q.setFromRotationMatrix(new Matrix4().makeBasis(X, vh, rh));
    lander.status = 'docked'; lander.dockedTo = 'carrier';
    lander.res.fuel *= 0.55; lander.res.ox *= 0.55; // arrives with limited propellant: must refine
    this.vessels = [carrier, lander];
    this.activeId = 'carrier';
    for (const v of this.vessels) this._rebuildOrbit(v);
  }

  get active() { return this.vessels.find((v) => v.id === this.activeId); }
  vessel(id) { return this.vessels.find((v) => v.id === id); }
  get carrier() { return this.vessel('carrier'); }
  get lander() { return this.vessel('lander'); }
  massOf(v) {
    let m = v.ownMass;
    for (const o of this.vessels) if (o.dockedTo === v.id && o.status === 'docked') m += o.ownMass;
    return m;
  }
  say(text, kind = 'info') { this.msgs.push({ text, kind }); }
  warpFactor() { return WARP[this.warpIndex]; }

  /** state of a moon (default Pell) relative to the planet at time t */
  moonState(t, out = { r: new Vector3(), v: new Vector3() }, id = 'moon') { return stateAt(BODIES[id].orbit, t, out); }
  /** vessel position in the planet-centred inertial frame */
  absPos(v, out = new Vector3()) {
    out.copy(v.r);
    if (isMoon(v.body)) out.add(this.moonState(this.UT, _m, v.body).r);
    return out;
  }
  // ---- targets ----------------------------------------------------------------------
  /** selected target body (Halcyon or a moon id) and landing target on it (an ore site, the Spire, a marked point; none = nearest site) */
  targetBodyId() { return this.flags.tgtBody || 'moon'; }
  /** landing candidates on a body: known ore sites, plus the Spire's landing spot once its signal is detected */
  landingSites(bodyId) {
    const l = [...sitesOf(bodyId)];
    if (bodyId === 'wren' && this.flags.spireSeen) {
      const S = BODIES.wren.spire;
      l.push({ id: 'spire', name: this.flags.spireFound ? 'The Spire' : 'Unidentified signal', dir: S.landDir, markDir: S.dir, radius: 120, spire: true });
    }
    return l;
  }
  targetSite(bodyId) {
    const c = this.flags.tgtCustom;
    if (c && c.body === bodyId) {
      if (this._customSrc !== c) { this._customSrc = c; this._custom = { id: 'custom', name: 'Marked point', dir: new Vector3().fromArray(c.dir), radius: 60, custom: true }; }
      return this._custom;
    }
    return this.landingSites(bodyId).find((s) => s.id === this.flags.tgtSite) || null;
  }
  setTargetBody(id) {
    if (id !== this.targetBodyId()) { delete this.flags.tgtSite; delete this.flags.tgtCustom; }
    this.flags.tgtBody = id;
  }
  cycleTargetBody() {
    const ids = [...BODIES.planet.children, 'planet'];
    this.setTargetBody(ids[(ids.indexOf(this.targetBodyId()) + 1) % ids.length]);
    return this.flags.tgtBody;
  }
  /** set the landing target on a moon: a site object (ore site / Spire) or { dir } for a marked point */
  setLandingTarget(bodyId, site) {
    this.setTargetBody(bodyId);
    delete this.flags.tgtSite; delete this.flags.tgtCustom;
    if (site.id && !site.custom) this.flags.tgtSite = site.id; else this.flags.tgtCustom = { body: bodyId, dir: site.dir.toArray() };
  }
  cycleTargetSite() {
    const sites = this.landingSites(this.targetBodyId());
    const i = (this.flags.tgtCustom ? -1 : sites.findIndex((s) => s.id === this.flags.tgtSite)) + 1; // 0 = none (auto)
    delete this.flags.tgtSite; delete this.flags.tgtCustom;
    if (i < sites.length) this.flags.tgtSite = sites[i].id;
    return this.targetSite(this.targetBodyId());
  }
  /** keep BODIES.wren.survey and the hidden Deep Seam site in step with the saved discovery flag */
  _syncSurvey() {
    const W = BODIES.wren, found = !!this.flags.spireFound;
    if (found) W.survey.spire = { name: 'The Spire', height: W.spire.height, note: 'Crystalline obelisk, no erosion, older than the rift' }; else delete W.survey.spire;
    for (const s of W.sites) if (s.id === 'wren-seam') s.hidden = !found;
  }
  /** a Wren vent is erupting or about to (used to keep warp low near a plume) */
  ventsBusy() { return BODIES.wren.vents.some((vt) => { const s = ventState(vt, this.UT); return s.active || s.next < 60; }); }
  /** acceleration from an erupting geyser at a flying vessel's position (body frame); false when outside every active plume */
  plumeAcc(v, out) {
    if (v.body !== 'wren' || v.status !== 'flying') return false;
    const B = BODIES.wren;
    let hit = false;
    out.set(0, 0, 0);
    for (const vt of B.vents) {
      const st = ventState(vt, this.UT);
      if (st.k <= 0) continue;
      const hh = v.r.dot(vt.dir) - B.radius;
      if (hh < -50 || hh > vt.height) continue;
      _pl.copy(v.r).addScaledVector(vt.dir, -v.r.dot(vt.dir)); // offset from the vent axis (a radial line)
      const lat = _pl.length();
      if (lat > 1500) continue;
      const a = PLUME_ACC * st.k * (1 - Math.max(0, hh) / vt.height) * (1 - 0.35 * lat / 1500);
      out.addScaledVector(vt.dir, a);
      if (lat > 1) out.addScaledVector(_pl, 0.5 * a / lat);
      hit = true;
    }
    return hit;
  }
  altitude(v) { return v.r.length() - BODIES[v.body].radius; }
  targetOf(v) {
    return this.vessels.find((o) => o !== v && (o.status === 'flying' || o.status === 'landed')) || null;
  }

  _rebuildOrbit(v) {
    if (v.status === 'flying') { v.orbit = elementsFromState(BODIES[v.body].mu, v.r, v.v, this.UT); v.railed = true; }
    else { v.orbit = null; }
  }

  // ---- warp -------------------------------------------------------------------------
  setWarp(i, silent) {
    i = Math.max(0, Math.min(WARP.length - 1, i));
    const lim = this.maxWarpIndex();
    if (i > lim) { i = lim; if (!silent) this.say(`Warp limited to ${WARP[lim]}x`, 'warn'); }
    this.warpIndex = i;
  }
  isThrusting(v) { return v.status !== 'docked' && v.status !== 'crashed' && v.throttle > 0.0001 && v.hasProp(); }
  maxWarpIndex() {
    let max = WARP.length - 1;
    for (const v of this.vessels) if (this.isThrusting(v)) max = Math.min(max, THRUST_WARP_MAX);
    const a = this.active;
    if (a && a.status === 'flying') {
      if (a.railed) {
        const ev = this.railsEvent(a);
        if (ev.type !== 'none') {
          const dt = ev.t - this.UT;
          while (max > 0 && WARP[max] * 3 > dt) max--;
        }
      }
      else if (this.isThrusting(a)) {
        // thrusting: the orbit is re-solved every step, so look ahead for SOI changes / ground
        const ev = this.thrustEvent(a);
        if (ev.type !== 'none') {
          const dt = ev.t - this.UT;
          while (max > 0 && WARP[max] * 3 > dt) max--;
        }
      }
      const alt = this.altitude(a);
      if (alt < 2000 && isMoon(a.body) && !a.railed) max = Math.min(max, 1);
      if (a.body === 'wren' && alt < 30000 && this.ventsBusy()) max = Math.min(max, 3); // never skip across an erupting plume
      if (a.nodes.length && !a.ap) { // do not warp through the start of a planned burn
        const dt = a.nodes[0].t - this.burnTime(a, nodeDvTotal(a.nodes[0])) / 2 - 30 - this.UT;
        while (max > 0 && WARP[max] * 3 > dt) max--;
      }
    } else if (a && a.status === 'landed' && (this.isThrusting(a) || a.driving)) max = Math.min(max, a.driving ? 2 : 1);
    return max;
  }

  // ---- events & prediction ------------------------------------------------------------
  /** next patch event along orbit `el` in body frame: impact / exit / enter (any moon of the planet) / escape */
  findEvent(bodyId, el, t0, off = 0, maxT = 6e5) {
    const B = BODIES[bodyId];
    const touchR = B.radius + off;
    const moons = bodyId === 'planet' ? B.children.map((id) => BODIES[id]).filter((m) => el.rp < m.orbit.a + m.soi && el.ra > m.orbit.a - m.soi) : [];
    const canImpact = el.rp < touchR;
    const canExit = el.hyper || el.ra > B.soi;
    if (!canImpact && !canExit && !moons.length) return { type: 'none', t: Infinity, validUntil: Infinity };
    const horizon = el.hyper ? 3e5 : el.period * (moons.length ? 4.2 : 1.02);
    const tEnd = t0 + Math.min(horizon, maxT);
    const s = { r: new Vector3(), v: new Vector3() };
    const ms = { r: new Vector3(), v: new Vector3() };
    const dist = new Vector3();
    let hitBody = null;
    const test = (t) => {
      stateAt(el, t, s);
      const rm = s.r.length();
      if (canImpact && rm <= touchR) return 'impact';
      for (const m of moons) {
        stateAt(m.orbit, t, ms);
        if (dist.copy(s.r).sub(ms.r).length() <= m.soi) { hitBody = m.id; return 'enter'; }
      }
      if (canExit && rm >= B.soi) return bodyId === 'planet' ? 'escape' : 'exit';
      return null;
    };
    let t = t0;
    let hit = test(t);
    if (hit) return { type: hit, t, body: hit === 'enter' ? hitBody : null, validUntil: Infinity };
    let guard = 0;
    while (t < tEnd && guard++ < 60000) {
      stateAt(el, t, s);
      const rm = s.r.length(), vm = s.v.length();
      let dmin = Infinity, vb = vm + 1;
      if (canImpact) dmin = Math.min(dmin, Math.abs(rm - touchR));
      if (canExit) dmin = Math.min(dmin, Math.abs(B.soi - rm));
      let vmoon = 0;
      for (const m of moons) {
        stateAt(m.orbit, t, ms);
        dmin = Math.min(dmin, Math.abs(dist.copy(s.r).sub(ms.r).length() - m.soi));
        vmoon = Math.max(vmoon, ms.v.length());
      }
      vb += vmoon;
      let step = Math.min(0.03 * rm / (vm + 1), 0.5 * dmin / vb);
      step = Math.max(0.02, Math.min(1500, step));
      const tn = Math.min(t + step, tEnd);
      const h = test(tn);
      if (h) {
        let lo = t, hi = tn;
        for (let i = 0; i < 44; i++) { const mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
        const type = test(hi);
        return { type, t: hi, body: type === 'enter' ? hitBody : null, validUntil: Infinity };
      }
      t = tn;
    }
    return { type: 'none', t: Infinity, validUntil: t0 + (tEnd - t0) * 0.5 };
  }

  /** next event for a thrusting vessel (orbit changes every step, so cache briefly in real time) */
  thrustEvent(v) {
    const now = performance.now();
    const c = this._thrEv;
    if (c && c.id === v.id && now - c.now < 120) return c.ev;
    const ev = this.findEvent(v.body, v.orbit, this.UT, v.spec.groundOffset, 3e4);
    this._thrEv = { id: v.id, now, ev };
    return ev;
  }

  railsEvent(v) {
    const c = this._evCache.get(v.id);
    if (c && c.el === v.orbit && this.UT < c.validUntil && this.UT <= c.t) return c;
    const ev = this.findEvent(v.body, v.orbit, this.UT, v.spec.groundOffset);
    // small overshoot so the step lands just past the crossing and the transition/contact triggers
    const rec = { el: v.orbit, t: ev.t + 2e-3, type: ev.type, body: ev.body, validUntil: ev.validUntil };
    this._evCache.set(v.id, rec);
    return rec;
  }

  /** chain of conic patches for a flying vessel: [{bodyId, el, t0, t1, type, body (enter target), post}].
   *  The first upcoming maneuver node (or `node`) is applied impulsively: the pre-node patch ends with type 'node',
   *  later patches have post = true. A node that lies beyond a patch event (SOI change, impact) is ignored. */
  predict(v, maxPatches = 4, node = v.nodes && v.nodes[0]) {
    if (v.status !== 'flying' || !v.orbit) return [];
    const out = [];
    let bodyId = v.body, el = v.orbit, t = this.UT, post = false;
    let pending = node && node.t > this.UT ? node : null;
    if (pending) maxPatches++;
    for (let k = 0; k < maxPatches; k++) {
      const ev = this.findEvent(bodyId, el, t, v.spec.groundOffset);
      if (pending && pending.t > t && (ev.type === 'none' || ev.t > pending.t)) {
        out.push({ bodyId, el, t0: t, t1: pending.t, type: 'node', post, node: pending });
        nodeDvVector(el, pending, _tv, _s); // _s now holds the state at the node time
        const r = _s.r.clone(), vv = _s.v.clone().add(_tv);
        el = elementsFromState(BODIES[bodyId].mu, r, vv, pending.t);
        t = pending.t; post = true; pending = null;
        continue;
      }
      const t1 = ev.type === 'none' ? (el.hyper ? t + 2e5 : t + el.period) : ev.t;
      out.push({ bodyId, el, t0: t, t1, type: ev.type, body: ev.body, post });
      if (ev.type === 'enter' || ev.type === 'exit') {
        stateAt(el, ev.t, _s);
        const r = _s.r.clone(), vv = _s.v.clone();
        if (ev.type === 'enter') { this.moonState(ev.t, _m, ev.body); r.sub(_m.r); vv.sub(_m.v); bodyId = ev.body; }
        else { this.moonState(ev.t, _m, bodyId); r.add(_m.r); vv.add(_m.v); bodyId = 'planet'; }
        el = elementsFromState(BODIES[bodyId].mu, r, vv, ev.t);
        t = ev.t;
      } else break;
    }
    return out;
  }
  getPatches(v) {
    const now = performance.now();
    const c = this._patchCache.get(v.id);
    if (c && (c.orbit === v.orbit || now - c.time < 250) && this.UT < c.until && c.status === v.status && c.rev === this._nodeRev) return c.patches;
    const patches = this.predict(v);
    const until = patches.length ? patches[0].t1 : Infinity;
    this._patchCache.set(v.id, { orbit: v.orbit, time: now, patches, until, status: v.status, rev: this._nodeRev });
    return patches;
  }

  // ---- SAS direction -------------------------------------------------------------------
  sasDirection(v, out = new Vector3()) {
    if (v.ap && v.ap.dir) return out.copy(v.ap.dir);
    if (!v.sas.on || v.status !== 'flying') return null;
    const m = v.sas.mode;
    if (m === 'stab') return null;
    const vm = v.v.length();
    if (m === 'pro' || m === 'retro') {
      if (vm < 0.05) return null;
      out.copy(v.v).divideScalar(vm);
      return m === 'retro' ? out.negate() : out;
    }
    if (m === 'normal' || m === 'antinormal') {
      out.crossVectors(v.r, v.v);
      if (out.lengthSq() < 1e-6) return null;
      out.normalize();
      return m === 'antinormal' ? out.negate() : out;
    }
    if (m === 'radial' || m === 'antiradial') {
      out.copy(v.r).normalize();
      return m === 'antiradial' ? out.negate() : out;
    }
    if (m === 'maneuver') return this.maneuverDirection(v, out);
    if (m === 'target' || m === 'antitarget') {
      const t = this.targetOf(v);
      if (!t || t.body !== v.body) return null;
      out.copy(t.r).sub(v.r);
      if (out.lengthSq() < 1) return null;
      out.normalize();
      return m === 'antitarget' ? out.negate() : out;
    }
    return null;
  }

  // ---- stepping -----------------------------------------------------------------------
  step(dtReal) {
    if (this.status !== 'running') return;
    dtReal = Math.min(dtReal, 0.1);
    const lim = this.maxWarpIndex();
    if (this.warpIndex > lim) {
      this.warpIndex = lim;
      this.say(`Time warp reduced to ${WARP[lim]}x`, 'warn');
    }
    let remaining = dtReal * WARP[this.warpIndex];
    // an assist that is only coasting to a known wake-up time does not need fine sub-steps
    const numeric = this.vessels.some((v) => this.isThrusting(v) || (v.ap && v.ap.wakeAt === undefined));
    // Integration step is independent of warp (RK4 at <= 0.05 s, 0.02 s while an assist burns so cut-offs stay sharp)
    const apBurn = this.vessels.some((v) => v.ap && this.isThrusting(v));
    const maxSub = apBurn ? 0.02 : (numeric || WARP[this.warpIndex] <= 5 ? 0.05 : Infinity);
    let guard = 0;
    while (remaining > 1e-9 && this.status === 'running' && guard++ < 600) {
      let h = Math.min(remaining, maxSub);
      let eventHit = false, wakeHit = false;
      for (const v of this.vessels) {
        if (v.ap && v.ap.wakeAt !== undefined && !this.isThrusting(v)) {
          const dw = v.ap.wakeAt - this.UT;
          if (dw > 1e-6 && dw < h) { h = dw; wakeHit = true; }
        }
      }
      for (const v of this.vessels) {
        if (v.status === 'flying' && v.railed && !this.isThrusting(v)) {
          const ev = this.railsEvent(v);
          if (ev.type !== 'none' && ev.t - this.UT < h) { h = Math.max(0, ev.t - this.UT); eventHit = true; }
        }
      }
      this.advance(h);
      remaining -= h;
      if (eventHit && h === 0) { remaining -= 1e-6; } // never stall on an event
      if (wakeHit) remaining = Math.min(remaining, 0.05);
      if (this.warpIndex > THRUST_WARP_MAX && this.vessels.some((v) => this.isThrusting(v))) {
        this.warpIndex = THRUST_WARP_MAX;
        remaining = Math.min(remaining, dtReal * WARP[THRUST_WARP_MAX]);
      }
    }
    this._pruneNodes();
    this.updateObjectives();
  }

  advance(h) {
    const t0 = this.UT, t1 = t0 + h;
    const warp = this.warpFactor();
    for (const v of this.vessels) {
      if (v.status === 'crashed') continue;
      this._updatePower(v, h);
      if (v.status === 'docked') continue;
      if (v.status === 'landed') this._updateLanded(v, h);
      else this._updateFlying(v, t0, t1, h, warp);
      this._refine(v, h);
      if (this.status !== 'running') return;
    }
    this.UT = t1;
    this._runPumps(h);
    // docked vessels ride along
    const dock = this.vessels.filter((v) => v.status === 'docked');
    for (const d of dock) {
      const p = this.vessel(d.dockedTo);
      if (p) { d.body = p.body; d.r.copy(p.r); d.v.copy(p.v); d.q.copy(p.q); }
    }
    for (const v of this.vessels) if (v.status === 'flying') this._transitions(v);
    this._checkDocking();
  }

  _updateFlying(v, t0, t1, h, warp) {
    const B = BODIES[v.body];
    const isActive = v.id === this.activeId;
    if (v.ap) updateAutopilot(this, v, h);
    if (v.status !== 'flying') return;
    const dir = this.sasDirection(v, _nose.clone());
    const plume = this.plumeAcc(v, _plA); // inside an erupting geyser column: needs numeric stepping, never rails
    if (plume !== !!v._inPlume) {
      v._inPlume = plume;
      if (plume && isActive) this.say('Caught in a cryo-geyser plume: it is pushing the ship up and out', 'warn');
    }
    const thrusting = this.isThrusting(v) || plume;
    if (v.throttle > 0 && !v.hasProp()) { v.throttle = 0; if (isActive) this.say('Out of propellant: engine flameout', 'warn'); }

    if (h > 0.25 && !thrusting) {
      if (dir && v.sas.on) snapAttitude(v, dir); else v.w.set(0, 0, 0);
    } else if (h > 0) {
      stepAttitude(v, h, isActive ? this.input.rot : ZERO, dir);
    }

    if (thrusting) {
      if (v.railed) v.railed = false;
      this._integrate(v, B, h, plume ? _plA : null);
      v.orbit = elementsFromState(B.mu, v.r, v.v, t1);
      this._checkContact(v, B);
    } else {
      if (!v.railed) { v.orbit = elementsFromState(B.mu, v.r, v.v, t0); v.railed = true; }
      stateAt(v.orbit, t1, _s);
      v.r.copy(_s.r); v.v.copy(_s.v);
      this._checkContact(v, B);
    }
  }

  _integrate(v, B, h, ext) {
    if (h <= 0) return;
    const mass = this.massOf(v);
    const frac = v.burn(v.massFlow(v.throttle) * h);
    v.noseWorld(_nose);
    const aT = v.spec.thrust * v.throttle * frac / mass;
    const mu = B.mu;
    const acc = (r, out) => { out.copy(r).multiplyScalar(-mu / Math.pow(r.lengthSq(), 1.5)).addScaledVector(_nose, aT); if (ext) out.add(ext); return out; };
    const r0 = v.r, v0 = v.v;
    // RK4
    _k1r.copy(v0); acc(r0, _k1v);
    _tr.copy(r0).addScaledVector(_k1r, h / 2); _k2r.copy(v0).addScaledVector(_k1v, h / 2); acc(_tr, _k2v);
    _tr.copy(r0).addScaledVector(_k2r, h / 2); _k3r.copy(v0).addScaledVector(_k2v, h / 2); acc(_tr, _k3v);
    _tr.copy(r0).addScaledVector(_k3r, h); _k4r.copy(v0).addScaledVector(_k3v, h); acc(_tr, _k4v);
    r0.addScaledVector(_k1r, h / 6).addScaledVector(_k2r, h / 3).addScaledVector(_k3r, h / 3).addScaledVector(_k4r, h / 6);
    v0.addScaledVector(_k1v, h / 6).addScaledVector(_k2v, h / 3).addScaledVector(_k3v, h / 3).addScaledVector(_k4v, h / 6);
    if (frac < 0.999 && v.throttle > 0) { v.throttle = 0; if (v.id === this.activeId) this.say('Out of propellant: engine flameout', 'warn'); }
  }

  _updateLanded(v, h) {
    const B = BODIES[v.body];
    if (v.ap) updateAutopilot(this, v, h);
    if (v.driving) this._drive(v, h);
    const R = B.radius + v.spec.groundOffset;
    v.r.copy(v.landedDir).multiplyScalar(R);
    v.v.set(0, 0, 0);
    v.w.set(0, 0, 0);
    // settle upright: slerp nose towards local up
    v.noseWorld(_nose);
    const dq = new Quaternion().setFromUnitVectors(_nose, v.landedDir);
    dq.slerp(new Quaternion(), 1 - Math.min(1, 2.5 * h));
    v.q.premultiply(dq).normalize();
    if (v.body === 'wren') { this._ventJostle(v, h); if (v.status !== 'landed') return; this._checkSpire(v); }
    // engine on the ground
    if (v.throttle > 0.001 && v.hasProp()) {
      const mass = this.massOf(v);
      const g = B.mu / (R * R);
      const acc = v.spec.thrust * v.throttle / mass;
      const frac = v.burn(v.massFlow(v.throttle) * h);
      if (acc * frac > g * 1.02) {
        v.status = 'flying'; v.landedDir = null; v.railed = false;
        v.driving = false; v.driveSpeed = 0;
        v.drilling = false; v.refining = false;
        v.orbit = elementsFromState(B.mu, v.r, v.v, this.UT);
        return;
      }
    }
    // drilling & refining (landed only)
    if (v.drilling) {
      const site = this.siteNear(v);
      if (!site) { v.drilling = false; if (v.id === this.activeId) this.say('No ore deposit under the drill: stopped', 'warn'); }
      else if (v.res.ore >= v.spec.oreCap - 1e-6) { v.drilling = false; this.say('Ore hold full', 'ok'); }
      else {
        const dm = Math.min(DRILL_RATE * site.richness * h * v.drillF, v.spec.oreCap - v.res.ore);
        v.res.ore += dm; v.stats.mined += dm; v.stats.siteId = site.id;
      }
    }
  }

  /** landed within 400 m of an erupting Wren vent: the ground shakes and the vessel creeps away; an unbraked rover can flip */
  _ventJostle(v, h) {
    const B = BODIES.wren;
    let j = 0, away = null;
    for (const vt of B.vents) {
      const st = ventState(vt, this.UT);
      if (st.k <= 0) continue;
      const d = Math.acos(Math.min(1, v.landedDir.dot(vt.dir))) * B.radius;
      if (d < 400 && st.k * (1 - d / 400) > j) { j = st.k * (1 - d / 400); away = vt; }
    }
    v.jostle = j;
    if (j <= 0) { v.tipT = 0; return; }
    if (v.id === this.activeId && !(this.UT - (v._jostleMsg || -1e9) < 60)) { v._jostleMsg = this.UT; this.say('Geyser tremors: the ground is shaking', 'warn'); }
    _tv.copy(v.landedDir).addScaledVector(away.dir, -v.landedDir.dot(away.dir));
    if (_tv.lengthSq() > 1e-18) v.landedDir.addScaledVector(_tv.normalize(), 2.5 * j * h / B.radius).normalize();
    if (v.driving && Math.abs(v.driveSpeed) > 1.5 && j > 0.3) {
      v.tipT = (v.tipT || 0) + h;
      if (v.tipT > 1.2) this._crash(v, 'The rover was flipped by a geyser eruption', Math.abs(v.driveSpeed));
    } else v.tipT = Math.max(0, (v.tipT || 0) - h);
  }

  /** landing or driving within 500 m of the Spire reveals it (and the Deep Seam ore site) */
  _checkSpire(v) {
    if (this.flags.spireFound) return;
    const S = BODIES.wren.spire;
    if (Math.acos(Math.min(1, v.landedDir.dot(S.dir))) * BODIES.wren.radius > S.detectRange) return;
    this.flags.spireFound = true; this.flags.spireSeen = true;
    this._syncSurvey();
    this.say('The Spire: no tool marks, no erosion, humming in the key of your own hull. Whatever raised it was here before the rift opened.', 'ok');
    this.say('Survey updated: Deep Seam ore site revealed beside the Spire', 'ok');
  }

  /** ISRU refinery: ore -> fuel + oxidizer at the fixed mixture. Works landed or in flight (lander and carrier). */
  _refine(v, h) {
    if (!v.refining || v.refF <= 0 || h <= 0) return;
    const S = v.spec;
    const x = Math.min(v.res.ore, S.refRate * h * v.refF, (S.fuelCap - v.res.fuel) / FUEL_FRAC, (S.oxCap - v.res.ox) / (1 - FUEL_FRAC));
    if (x <= 1e-9) {
      v.refining = false;
      if (v.id === this.activeId) this.say(v.res.ore <= 1e-6 ? 'Refinery idle: no ore left' : 'Propellant tanks full', 'ok');
    } else {
      v.res.ore -= x; v.res.fuel += x * FUEL_FRAC; v.res.ox += x * (1 - FUEL_FRAC); v.stats.refined += x;
    }
  }

  /** docked transfers: 'refuel' (carrier -> lander fuel + oxidizer) or 'offload' (lander ore -> carrier) */
  startPump(kind) {
    const C = this.carrier, L = this.lander;
    if (!C || !L || L.status !== 'docked' || C.status === 'crashed') return 'Transfers need the lander docked to the carrier';
    this.pumps = kind === 'refuel'
      ? [{ res: 'fuel', from: C, to: L }, { res: 'ox', from: C, to: L }]
      : [{ res: 'ore', from: L, to: C }];
    this.pumpKind = kind;
    return null;
  }
  _runPumps(h) {
    if (!this.pumps.length) return;
    const L = this.lander;
    if (L.status !== 'docked') { this.pumps = []; return; }
    const capKey = { fuel: 'fuelCap', ox: 'oxCap', ore: 'oreCap' };
    let moving = false;
    for (const p of this.pumps) {
      const room = p.to.spec[capKey[p.res]] - p.to.res[p.res];
      const dm = Math.min(PUMP_RATE[p.res] * h, p.from.res[p.res], room);
      if (dm > 1e-6) { p.from.res[p.res] -= dm; p.to.res[p.res] += dm; moving = true; }
    }
    if (!moving) {
      this.say(this.pumpKind === 'refuel' ? 'Lander refuel complete' : 'Ore offloaded to the carrier', 'ok');
      this.pumps = [];
    }
  }

  /** rover mode: drive over the Pell surface (sphere), upright on the local normal. Drains the battery with speed. */
  _drive(v, h) {
    const B = BODIES[v.body];
    if (v.throttle > 0.001 || !v.dep.gear || v.dep.gear.p < 0.95) { v.driving = false; v.driveSpeed = 0; return; }
    const inp = v.id === this.activeId ? this.input.drive : { fwd: 0, steer: 0, brake: false };
    const powered = v.ec > 0.001;
    const target = powered ? inp.fwd * DRIVE_MAX : 0;
    let sp = v.driveSpeed;
    const acc = inp.brake || !powered ? DRIVE_BRAKE : (Math.abs(target) > Math.abs(sp) ? DRIVE_ACCEL : 1.6);
    sp += Math.max(-acc * h, Math.min(acc * h, target - sp));
    v.driveSpeed = sp;
    const up = v.landedDir;
    const f = _nose.set(0, 0, 1).applyQuaternion(v.q);
    f.addScaledVector(up, -f.dot(up));
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0).addScaledVector(up, -up.x);
    f.normalize();
    const turn = powered ? -inp.steer * DRIVE_STEER * h * Math.min(1, 0.4 + Math.abs(sp) / 3) : 0;
    if (turn) { _tv.crossVectors(up, f); f.multiplyScalar(Math.cos(turn)).addScaledVector(_tv, Math.sin(turn)); }
    const a = sp * h / B.radius;
    if (a) {
      const nu = _tr.copy(up).multiplyScalar(Math.cos(a)).addScaledVector(f, Math.sin(a));
      f.multiplyScalar(Math.cos(a)).addScaledVector(up, -Math.sin(a));
      up.copy(nu).normalize();
    }
    f.normalize();
    _sax.crossVectors(up, f); // body +X (right)
    v.q.setFromRotationMatrix(new Matrix4().makeBasis(_sax, up, f));
  }

  toggleDrive(v) {
    if (v.kind !== 'lander') return 'Only the lander rover can drive';
    if (v.driving) { v.driving = false; v.driveSpeed = 0; return null; }
    if (v.status !== 'landed') return 'Driving needs the lander on the ground';
    if (!v.dep.gear || !v.dep.gear.ok || v.dep.gear.p < 0.95) return 'Deploy the wheels first (N)';
    if (v.drilling) return 'Stop the drill first (G)';
    v.driving = true; v.driveSpeed = 0; v.throttle = 0; v.ap = null;
    return null;
  }

  siteNear(v) {
    if (!isMoon(v.body) || v.status !== 'landed') return null;
    const B = BODIES[v.body];
    for (const s of sitesOf(v.body)) {
      const ang = Math.acos(Math.min(1, v.landedDir.dot(s.dir)));
      if (ang * B.radius <= s.radius) return s;
    }
    return null;
  }

  // ---- contact / crash ---------------------------------------------------------------
  _checkContact(v, B) {
    const rm = v.r.length();
    const alt = rm - B.radius - v.spec.groundOffset;
    if (alt > 0.02) return;
    _tr.copy(v.r).divideScalar(rm);
    const vr = v.v.dot(_tr);
    if (vr > 0.05 && alt > -1) return; // moving away (lift-off)
    const vh = _tv.copy(v.v).addScaledVector(_tr, -vr).length();
    v.noseWorld(_nose);
    const tilt = Math.acos(Math.max(-1, Math.min(1, _nose.dot(_tr))));
    if (!isMoon(B.id) || !v.spec.canLand) {
      return this._crash(v, !isMoon(B.id) ? 'Impact with Halcyon (atmospheric flight is not simulated)' : `${v.spec.label} hit the surface at ${v.v.length().toFixed(1)} m/s`, v.v.length());
    }
    if (v.dep.gear && v.dep.gear.p < 0.85) return this._crash(v, 'Touched down with the landing gear retracted', Math.abs(vr));
    if (Math.abs(vr) > MAX_SAFE_VERTICAL) return this._crash(v, `Hard impact: ${Math.abs(vr).toFixed(1)} m/s vertical (limit ${MAX_SAFE_VERTICAL} m/s)`, Math.abs(vr));
    if (vh > MAX_SAFE_HORIZONTAL) return this._crash(v, `Tipped over: ${vh.toFixed(1)} m/s sideways at touchdown`, vh);
    if (tilt > MAX_SAFE_TILT) return this._crash(v, `Tipped over: landed ${(tilt * 180 / Math.PI).toFixed(0)} degrees off vertical`, v.v.length());
    // soft touchdown
    v.status = 'landed';
    v.driving = false; v.driveSpeed = 0;
    v.landedDir = _tr.clone();
    v.w.set(0, 0, 0);
    v.throttle = 0;
    v.railed = false; v.orbit = null;
    v.ap = null;
    this.say(`Touchdown at ${Math.abs(vr).toFixed(1)} m/s`, 'ok');
    if (Math.abs(vr) > 2) for (const k of ['panels', 'radiators']) if (v.dep[k] && v.dep[k].ok && v.dep[k].p > 0.05) this._breakDep(v, k, 'sheared off at touchdown (over 2 m/s)');
    if (v.id === this.activeId && this.warpIndex > 0) this.warpIndex = 0;
  }

  _crash(v, reason, speed) {
    v.status = 'crashed';
    this.status = 'crashed';
    this.warpIndex = 0;
    const pos = this.absPos(v, new Vector3());
    this.crash = { vesselId: v.id, reason, speed, body: v.body, pos };
    this.say(reason, 'bad');
  }

  // ---- electricity, heat, deployables --------------------------------------------------
  /** true if the sun is not hidden behind the planet or the moon */
  sunlit(v) {
    this.absPos(v, _sp);
    const blockers = [[_zero, BODIES.planet.radius]];
    for (const id of BODIES.planet.children) blockers.push([this.moonState(this.UT, undefined, id).r, BODIES[id].radius]);
    for (const [c, R] of blockers) {
      _sw.copy(c).sub(_sp);
      const t = _sw.dot(SUN_DIR);
      if (t > 0 && _sw.lengthSq() - t * t < R * R) return false;
    }
    return true;
  }

  toggleDeploy(v, kind) {
    const d = v.dep[kind];
    if (!d) return `${DEP_NAMES[kind]}: not fitted to this vessel`;
    if (!d.ok) return `${DEP_NAMES[kind]} broke off earlier (quickload or revert to repair)`;
    if (v.status === 'docked') return 'Everything stays folded while docked';
    if (kind === 'gear' && v.status === 'landed' && d.t > 0.5) return 'Cannot retract the landing gear on the ground';
    d.t = d.t > 0.5 ? 0 : 1;
    v.autoRet = v.autoRet.filter((k) => k !== kind);
    return null;
  }

  _breakDep(v, k, why) {
    const d = v.dep[k];
    d.ok = false; d.p = 0; d.t = 0;
    v.autoRet = v.autoRet.filter((x) => x !== k);
    this.say(`${DEP_NAMES[k]} ${why}`, 'bad');
  }

  /** battery, solar, heat, deployable animation and the load limits for deployed panels/radiators */
  _updatePower(v, h) {
    const S = v.spec;
    const active = v.id === this.activeId;
    if (v.status === 'docked') { // the carrier tops the lander up while docked
      const C = this.vessel(v.dockedTo);
      const take = C ? Math.min(100 * h, S.ecCap - v.ec, Math.max(0, C.ec - 0.05 * C.spec.ecCap)) : 0;
      if (C) C.ec -= take;
      v.ec += take; v.heat = Math.max(0, v.heat - 2 * h);
      v.ecRate = 0; v.heatRate = 0; v.drillF = v.refF = 0; v.ctrlScale = 1;
      return;
    }
    for (const k in v.dep) {
      const d = v.dep[k];
      if (!d.ok) { d.p = 0; d.t = 0; continue; }
      const dir = Math.sign(d.t - d.p);
      if (dir) { d.p = clamp01(d.p + dir * h / DEP_TIME[k]); if (Math.abs(d.p - d.t) < 1e-6 || (dir > 0 ? d.p > d.t : d.p < d.t)) d.p = d.t; }
    }
    if (h <= 0) return;
    // acceleration limit for extended panels / radiators
    const thr = this.isThrusting(v) ? v.throttle : 0;
    const acc = S.thrust * thr / this.massOf(v);
    const auto = this.flags.autoRetract !== false;
    if (thr > 0) v.idleT = 0; else v.idleT += h;
    if (acc > DEP_G_LIMIT) {
      for (const k of ['panels', 'radiators']) {
        const d = v.dep[k];
        if (!d || !d.ok || d.t <= 0) continue;
        if (auto) {
          d.t = 0; if (!v.autoRet.includes(k)) v.autoRet.push(k);
          if (active) this.say(`High acceleration: retracting ${DEP_NAMES[k].toLowerCase()}`, 'warn');
        } else if (d.p > 0.05) {
          if (v.stress === 0 && active) this.say(`Warning: ${DEP_NAMES[k].toLowerCase()} will break off above 1.5 g. Retract them!`, 'warn');
          v.stress += h;
          if (v.stress > 2.5) { this._breakDep(v, k, 'torn off by the acceleration'); v.stress = 0; }
        }
      }
    } else v.stress = 0;
    if (v.autoRet.length && auto && v.idleT > 3) {
      for (const k of v.autoRet) if (v.dep[k] && v.dep[k].ok) v.dep[k].t = 1;
      if (active) this.say('Burn over: re-extending panels and radiators', 'info');
      v.autoRet = [];
    }
    // electricity
    let gen = S.baseGen;
    const dp = v.dep.panels;
    v.inSun = this.sunlit(v);
    if (dp && dp.ok && dp.p > 0 && v.inSun) {
      _sax.set(S.panelAxis[0], S.panelAxis[1], S.panelAxis[2]).applyQuaternion(v.q);
      gen += S.solarMax * dp.p * (0.3 + 0.7 * Math.abs(_sax.dot(SUN_DIR)));
    }
    const rot = active && !v.driving ? this.input.rot.length() : 0;
    const sasUse = v.sas.on ? Math.min(1, (rot > 0 ? 1 : 0) + 2 * v.w.length() / S.maxRate) : 0;
    const base = (v.driving ? DRIVE_EC * Math.abs(v.driveSpeed) : 0) + S.avionics + (v.ap ? 0.1 : 0) + (v.sas.on ? S.sasIdle + S.sasMax * sasUse : 0);
    const hf = v.heat >= S.heatMax ? 0 : v.heat <= S.heatSoft ? 1 : 1 - (v.heat - S.heatSoft) / (S.heatMax - S.heatSoft);
    if (v.ec <= 0.001 && (v.drilling || v.refining)) {
      v.drilling = false; v.refining = false;
      if (active) this.say('Battery empty: drill and refinery stopped. Extend solar panels (J).', 'bad');
    }
    let dF = v.status === 'landed' && v.drilling ? hf : 0;
    let rF = v.refining && S.refEC > 0 ? hf : 0;
    const proc = S.drillEC * dF + S.refEC * rF;
    if (proc > 0 && v.ec + (gen - base - proc) * h < 0) { // battery would run dry mid-step: scale the processes
      const s = clamp01((v.ec / h + gen - base) / proc);
      dF *= s; rF *= s;
    }
    v.drillF = dF; v.refF = rF;
    const net = gen - base - S.drillEC * dF - S.refEC * rF;
    v.ecGen = gen; v.ecUse = base + S.drillEC * dF + S.refEC * rF; v.ecNet = net;
    v.ec = Math.max(0, Math.min(S.ecCap, v.ec + net * h));
    v.ecRate = (v.ec >= S.ecCap && net > 0) || (v.ec <= 0 && net < 0) ? 0 : net;
    v.ctrlScale = v.ec > 0.001 ? 1 : 0.3;
    // heat
    const gHeat = S.engineHeat * thr + S.drillHeat * dF + S.refHeat * rF;
    const rad = S.fixedRad + (v.dep.radiators && v.dep.radiators.ok ? v.dep.radiators.p * S.radHeat : 0) + (dp && dp.ok ? dp.p * S.panelHeat : 0);
    const n = Math.max(1, Math.min(40, Math.ceil(h / 0.5))), dt = h / n;
    const H0 = v.heat;
    let H = H0;
    for (let i = 0; i < n; i++) H = Math.max(0, Math.min(S.heatMax, H + (gHeat - (1.2 + 2.0 * H / S.heatMax + rad)) * dt));
    v.heat = H; v.heatRate = (H - H0) / h;
    v.heatGen = gHeat; v.heatDis = 1.2 + 2.0 * H / S.heatMax + rad; v.heatNet = gHeat - v.heatDis;
    // warnings (once per episode)
    v.warn = v.warn || {};
    if (active) {
      if (H > S.heatSoft * 0.7 && (v.drilling || v.refining)) { if (!v.warn.heat) { v.warn.heat = true; this.say(H > S.heatSoft ? 'Overheating: drill/refinery throttled. Deploy radiators (K)!' : 'Heat is building up: deploy radiators (K) and panels (J)', 'warn'); } } else if (H < S.heatSoft * 0.5) v.warn.heat = false;
      if (v.ec < S.ecCap * 0.25 && net < 0) { if (!v.warn.ec) { v.warn.ec = true; this.say(v.inSun ? 'Battery draining: deploy solar panels (J)' : 'In shadow: no solar power, battery draining', 'warn'); } } else if (v.ec > S.ecCap * 0.5 || net >= 0) v.warn.ec = false;
    }
  }

  // ---- SOI transitions ------------------------------------------------------------------
  _transitions(v) {
    if (v.status !== 'flying') return;
    if (isMoon(v.body)) {
      if (v.r.length() >= BODIES[v.body].soi) {
        this.moonState(this.UT, _m, v.body);
        v.r.add(_m.r); v.v.add(_m.v); v.body = 'planet'; v.nodes = [];
        this._rebuildOrbit(v); this._soiMessage(v, 'Halcyon');
      }
    } else {
      for (const id of BODIES.planet.children) {
        this.moonState(this.UT, _m, id);
        if (_tr.copy(v.r).sub(_m.r).length() <= BODIES[id].soi) {
          v.r.sub(_m.r); v.v.sub(_m.v); v.body = id; v.nodes = [];
          this._rebuildOrbit(v); this._soiMessage(v, BODIES[id].name);
          if (id === 'wren' && !this.flags.spireSeen) { this.flags.spireSeen = true; this.say("Unidentified signal detected on Wren's surface", 'warn'); }
          return;
        }
      }
      if (v.r.length() >= BODIES.planet.soi) this._crash(v, 'Lost in deep space: escaped the Halcyon system', 0);
    }
  }
  _soiMessage(v, name) {
    if (v.id === this.activeId) {
      this.say(`Entering ${name} sphere of influence`, 'ok');
      if (this.warpIndex > 1) this.warpIndex = 1;
    }
  }

  // ---- docking / undocking --------------------------------------------------------------
  undock() {
    const L = this.lander, C = this.carrier;
    if (!L || !C || L.status !== 'docked' || C.status !== 'flying') return false;
    this.revertSave = this.serialize();
    try { localStorage.setItem('orbital:revert', JSON.stringify(this.revertSave)); } catch (e) { /* ignore */ }
    const off = DOCK_OFFSET.clone().applyQuaternion(C.q);
    L.status = 'flying'; L.dockedTo = null;
    L.r.copy(C.r).add(off);
    L.v.copy(C.v).addScaledVector(new Vector3(0, 0, -1).applyQuaternion(C.q), 0.8);
    L.q.copy(C.q).multiply(DOCK_ROT); L.w.set(0, 0, 0);
    L.throttle = 0;
    this.flags.undockUT = this.UT; this.flags.dockArmed = false;
    this._rebuildOrbit(L); this._rebuildOrbit(C);
    this.activeId = 'lander';
    this.say('Lander undocked', 'ok');
    return true;
  }

  _checkDocking() {
    const L = this.lander, C = this.carrier;
    if (!L || !C || L.status !== 'flying' || C.status !== 'flying' || L.body !== C.body) return;
    const d = _tr.copy(L.r).sub(C.r).length();
    // after undocking, auto-dock only re-arms once the lander has flown clear of the carrier
    if (this.flags.dockArmed === false) { if (d > 160) this.flags.dockArmed = true; return; }
    if (d > DOCK_RANGE) return;
    const rel = _tv.copy(L.v).sub(C.v).length();
    if (rel > DOCK_SPEED) return;
    L.status = 'docked'; L.dockedTo = 'carrier';
    for (const k in L.dep) L.dep[k].t = 0; // everything folds away for docking
    L.autoRet = [];
    L.throttle = 0; L.ap = null; L.drilling = false; L.refining = false;
    L.orbit = null; L.railed = true;
    if (this.activeId === 'lander') this.activeId = 'carrier';
    L.drilling = false; L.refining = false;
    this.say(L.res.ore > 1 ? `Docked: ${Math.round(L.res.ore)} kg ore aboard (Y refuel, I offload ore)` : 'Docked', 'ok');
    this._rebuildOrbit(C);
    if (this.warpIndex > 1) this.warpIndex = 1;
  }

  cycleVessel(dir = 1) {
    const ok = this.vessels.filter((v) => v.status === 'flying' || v.status === 'landed');
    if (ok.length < 2) return;
    const i = ok.findIndex((v) => v.id === this.activeId);
    this.activeId = ok[(i + dir + ok.length) % ok.length].id;
    this.warpIndex = Math.min(this.warpIndex, 1);
  }

  cancelAutopilot(v, msg) {
    if (v && v.ap) { v.ap = null; v.throttle = 0; if (msg) this.say(msg, 'info'); }
  }

  // ---- maneuver nodes ---------------------------------------------------------------------
  /** burn duration for `dv` m/s (rocket equation, current mass, thrust and isp) */
  burnTime(v, dv) {
    const ve = v.spec.isp * G0, m = this.massOf(v);
    return (m * ve / v.spec.thrust) * (1 - Math.exp(-Math.abs(dv) / ve));
  }
  /** time from burn start to the dv-weighted centre of the burn (later than half the duration: the ship gets lighter) */
  burnCentroid(v, dv) {
    const ve = v.spec.isp * G0, m0 = this.massOf(v), m1 = m0 * Math.exp(-Math.abs(dv) / ve), mdot = v.spec.thrust / ve;
    return dv > 1e-6 ? (m0 - (m0 - m1) / Math.log(m0 / m1)) / mdot : 0;
  }
  nodeStep() { return NODE_STEPS[this.flags.nodeStep === undefined ? 2 : this.flags.nodeStep]; }
  cycleNodeStep() {
    this.flags.nodeStep = ((this.flags.nodeStep === undefined ? 2 : this.flags.nodeStep) + 1) % NODE_STEPS.length;
    return this.nodeStep();
  }
  /** editing is refused mid-burn; an assist that is only waiting for the node is cancelled (re-engage after editing) */
  _nodeEditable(v) {
    if (v.status !== 'flying' || !v.orbit) return 'Maneuver nodes need a free-flying vessel';
    if (v.ap && v.ap.type === 'node') {
      if (v.ap.phase === 'burn') return 'Burn in progress';
      this.cancelAutopilot(v);
    }
    return null;
  }
  setNode(v, node) { v.nodes = [node]; this._nodeRev++; }
  /** add a node (zero dv) at the next apoapsis ('ap') or periapsis ('pe'); circular-ish orbits get one 2 minutes ahead */
  addNode(v, where) {
    const msg = this._nodeEditable(v);
    if (msg) return msg;
    const el = v.orbit, t = this.UT;
    let tn = Infinity;
    if (el.e >= 0.005) tn = where === 'ap' ? nextApoapsisTime(el, t) : nextPeriapsisTime(el, t);
    if (!isFinite(tn) || tn < t) tn = t + 120;
    else if (tn - t < 10 && !el.hyper) tn += el.period;
    this.setNode(v, { t: tn, dv: { pro: 0, nrm: 0, rad: 0 } });
    return null;
  }
  /** nudge one component ('pro' | 'nrm' | 'rad') of the first node by the current step */
  nudgeNode(v, comp, sign) {
    if (!v.nodes.length) return 'No maneuver node (; or \' adds one)';
    const msg = this._nodeEditable(v);
    if (msg) return msg;
    v.nodes[0].dv[comp] += sign * this.nodeStep();
    this._nodeRev++;
    return null;
  }
  /** move the first node along the orbit; the time step scales with the orbital period and the step size */
  shiftNode(v, sign) {
    if (!v.nodes.length) return 'No maneuver node (; or \' adds one)';
    const msg = this._nodeEditable(v);
    if (msg) return msg;
    const n = v.nodes[0];
    n.t = Math.max(this.UT + 2, n.t + sign * (v.orbit.hyper ? 60 : v.orbit.period / 2000) * this.nodeStep());
    this._nodeRev++;
    return null;
  }
  deleteNode(v) {
    if (!v.nodes.length) return 'No maneuver node';
    if (v.ap && v.ap.type === 'node') this.cancelAutopilot(v);
    v.nodes = []; this._nodeRev++;
    return null;
  }
  /** nose direction for the first node's burn vector (inertial), or the assist's live guidance while executing */
  maneuverDirection(v, out = new Vector3()) {
    if (v.ap && v.ap.type === 'node' && v.ap.dir) return out.copy(v.ap.dir);
    if (!v.nodes.length || !v.orbit || v.status !== 'flying') return null;
    nodeDvVector(v.orbit, v.nodes[0], out);
    return out.lengthSq() > 1e-12 ? out.normalize() : null;
  }
  /** drop nodes that can no longer happen: vessel landed/crashed/docked, or the node time has passed (unless executing) */
  _pruneNodes() {
    for (const v of this.vessels) {
      if (!v.nodes.length) continue;
      if (v.status !== 'flying') { v.nodes = []; this._nodeRev++; }
      else if (v.nodes[0].t < this.UT && !(v.ap && v.ap.type === 'node')) { v.nodes = v.nodes.filter((n) => n.t >= this.UT); this._nodeRev++; }
    }
  }

  // ---- objectives -----------------------------------------------------------------------
  updateObjectives() {
    const C = this.carrier, L = this.lander, d = this.done;
    const R = BODIES.moon.radius;
    const set = (id, cond) => {
      if (!d[id] && cond) { d[id] = true; this.say(`Objective complete: ${OBJECTIVES.find((o) => o.id === id).text}`, 'ok'); }
    };
    set('soi', C.body === 'moon' && C.status === 'flying');
    set('orbit', d.soi && C.body === 'moon' && C.status === 'flying' && C.orbit && !C.orbit.hyper && C.orbit.rp > R + 10000);
    set('undock', L.status !== 'docked' && this.flags.undockUT !== undefined);
    set('land', L.status === 'landed' && L.body === 'moon');
    set('drill', L.stats.mined >= 300);
    set('refine', L.stats.refined >= 400);
    set('lift', d.land && L.status === 'flying' && L.body === 'moon' && L.orbit && !L.orbit.hyper && L.orbit.rp > R + 8000);
    set('dock', d.land && L.status === 'docked');
    set('offload', d.dock && L.status === 'docked' && L.res.ore < 50 && L.res.fuel + L.res.ox >= 0.9 * (L.spec.fuelCap + L.spec.oxCap));
    if (!this.flags.complete && OBJECTIVES.every((o) => d[o.id])) { this.flags.complete = true; this.say('Mission complete! Lunar harvest delivered.', 'ok'); }
  }

  // ---- save / load ------------------------------------------------------------------------
  serialize() {
    return {
      v: 1, UT: this.UT, activeId: this.activeId, done: { ...this.done }, flags: { ...this.flags },
      vessels: this.vessels.map((v) => v.serialize()),
    };
  }
  deserialize(o) {
    this.UT = o.UT; this.activeId = o.activeId; this.done = { ...o.done }; this.flags = { ...o.flags };
    this.vessels = o.vessels.map((x) => Vessel.deserialize(x));
    this.status = 'running'; this.crash = null; this.warpIndex = 0; this.pumps = [];
    this._evCache.clear(); this._patchCache.clear(); this._nodeRev++; this._syncSurvey();
    for (const v of this.vessels) this._rebuildOrbit(v);
  }
  clone() {
    const w = new World({ empty: true, headless: true });
    w.deserialize(this.serialize());
    return w;
  }
}
