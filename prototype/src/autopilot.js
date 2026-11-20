// Flight assists: circularize, moon-transfer, landing (suicide burn), rendezvous.
// An autopilot is just state in `vessel.ap`; each sim sub-step it may set `vessel.throttle`,
// `vessel.ap.dir` (nose direction for SAS) and request time warp. Pure sim, no DOM.
import { Vector3, Quaternion } from 'three';
import { BODIES } from './bodies.js';
import { elementsFromState, stateAt, nextApoapsisTime, nextPeriapsisTime, TAU, G0 } from './orbits.js';
import { WARP, THRUST_WARP_MAX } from './world.js';

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();

export const AP_NAMES = { circ: 'Circularize', xfer: 'Transfer to Pell', land: 'Landing assist', rdv: 'Rendezvous', asc: 'Ascent assist' };

function aligned(v, dir, cosTol = 0.985) { return v.noseWorld(_a).dot(dir) > cosTol; }

function pickWarp(world, v, timeLeft, margin = 6, fac = 4) {
  if (v.id !== world.activeId) return;
  let idx = 0;
  for (let i = 0; i < WARP.length; i++) if (WARP[i] * fac <= timeLeft - margin) idx = i;
  world.setWarp(idx, true);
}
/** warp while an assist burns: as fast as allowed, dropping to 1x as the cut-off nears */
function burnWarp(world, v, timeLeft) {
  if (v.id !== world.activeId) return;
  let idx = 0;
  if (v.throttle > 0) for (let i = 0; i <= THRUST_WARP_MAX; i++) if (WARP[i] * 3 <= timeLeft) idx = i;
  world.setWarp(idx, true);
}
function noWarp(world, v) { if (v.id === world.activeId && world.warpIndex > 2) world.warpIndex = 2; }

export function engageAutopilot(world, v, type) {
  if (type === 'asc') {
    if (v.body !== 'moon' || !v.spec.canLand) return 'Ascent assist is for the lander around Pell';
    if (v.status === 'landed' && v.res.fuel < 1) return 'No propellant: refine ore first (R)';
    v.ap = { type, phase: 'plan', tgt: 45000 };
    v.sas.on = true;
    return null;
  }
  if (v.status !== 'flying') return 'Autopilot needs a free-flying vessel';
  if (type === 'circ') {
    if (!v.orbit) return 'No orbit solution';
    if (v.orbit.e < 0.004) return 'Orbit is already circular';
    v.ap = { type, phase: 'plan' };
  } else if (type === 'xfer') {
    if (v.body !== 'planet') return 'Transfer assist works from Halcyon orbit';
    if (v.kind !== 'carrier') return 'Transfer assist is for the carrier';
    const msg = planTransfer(world, v);
    if (msg) return msg;
  } else if (type === 'land') {
    if (v.body !== 'moon') return 'Landing assist works around Pell';
    if (!v.spec.canLand) return 'This vessel cannot land';
    v.ap = { type, phase: 'plan' };
  } else if (type === 'rdv') {
    const t = world.targetOf(v);
    if (!t) return 'No target';
    if (t.body !== v.body) return 'Target is in a different sphere of influence';
    v.ap = { type, phase: 'run' };
  }
  v.sas.on = true;
  v.throttle = 0;
  return null;
}

export function updateAutopilot(world, v, h) {
  const ap = v.ap;
  if (!ap || (v.status !== 'flying' && !(v.status === 'landed' && ap.type === 'asc'))) { if (ap && v.status !== 'flying') v.ap = null; return; }
  const fn = { circ: runCirc, xfer: runXfer, land: runLand, rdv: runRdv, asc: runAsc }[ap.type];
  fn(world, v, ap, h);
}

function finish(world, v, text) {
  v.ap = null; v.throttle = 0;
  if (text && !world.headless) world.say(text, 'ok');
}
const accelOf = (world, v) => v.spec.thrust / world.massOf(v);

// ---------------------------------------------------------------------------------- circularize
function runCirc(world, v, ap) {
  const B = BODIES[v.body];
  const mu = B.mu;
  if (ap.phase === 'plan') {
    const el = v.orbit, t = world.UT;
    const tPe = nextPeriapsisTime(el, t), tAp = nextApoapsisTime(el, t);
    let tA, rB;
    if (el.hyper || tPe <= tAp) { tA = tPe; rB = el.rp; } else { tA = tAp; rB = el.ra; }
    if (el.hyper && tPe < t) return finish(world, v, null);
    const vAps = Math.sqrt(mu * (2 / rB - 1 / el.a)), vc = Math.sqrt(mu / rB);
    const dv = vc - vAps;
    const ve = v.spec.isp * G0, m = world.massOf(v);
    const tb = (m / (v.spec.thrust / ve)) * (1 - Math.exp(-Math.abs(dv) / ve));
    ap.sign = dv >= 0 ? 1 : -1; ap.tStart = Math.max(t, tA - tb / 2); ap.tApsis = tA;
    ap.phase = 'wait';
    if (!world.headless) world.say(`Circularize at ${tA === tPe ? 'periapsis' : 'apoapsis'}: ${Math.abs(dv).toFixed(0)} m/s ${dv >= 0 ? 'prograde' : 'retrograde'}`, 'info');
  }
  const vm = v.v.length();
  // thrust along the local horizontal (tangent), pitched radially just enough to hold altitude
  {
    const r = v.r.length();
    _a.copy(v.r).divideScalar(r);
    const vr = v.v.dot(_a);
    _b.copy(v.v).addScaledVector(_a, -vr);
    const vtan = _b.length();
    if (vtan > 1e-3) _b.divideScalar(vtan); else _b.copy(v.v).normalize();
    const g = mu / (r * r);
    let s = ((g - vtan * vtan / r) / Math.max(1, accelOf(world, v)) - 0.04 * vr) * (ap.sign || 1);
    s = Math.max(-0.6, Math.min(0.9, s)) * (ap.sign || 1);
    ap.dir = (ap.dir || new Vector3()).copy(_b).multiplyScalar((ap.sign || 1) * Math.sqrt(1 - s * s)).addScaledVector(_a, s);
  }
  if (ap.phase === 'wait') {
    const left = ap.tStart - world.UT;
    ap.wakeAt = ap.tStart;
    if (left > 0) { pickWarp(world, v, left, 0, 1.5); return; }
    ap.phase = 'burn'; delete ap.wakeAt;
    if (v.id === world.activeId) world.warpIndex = Math.min(world.warpIndex, 2);
  }
  if (ap.phase === 'burn') {
    const r = v.r.length();
    _a.copy(v.r).divideScalar(r);
    const vr = v.v.dot(_a);
    const vtan = Math.sqrt(Math.max(0, vm * vm - vr * vr));
    const rem = ap.sign * (Math.sqrt(mu / r) - vtan);
    if (rem <= 0.25) {
      if (v.orbit && v.orbit.e > 0.01 && (ap.n = (ap.n || 0) + 1) < 3) { v.throttle = 0; ap.phase = 'plan'; return; } // trim pass
      return finish(world, v, `Circularized: ${((r - B.radius) / 1000).toFixed(0)} km`);
    }
    v.throttle = aligned(v, ap.dir) ? Math.max(0.04, Math.min(1, rem / (accelOf(world, v) * 0.5))) : 0;
    burnWarp(world, v, (rem / accelOf(world, v)) * 0.7);
  }
}

// ---------------------------------------------------------------------------------- transfer
function apoFast(mu, r, v) {
  const rm = r.length();
  const a = 1 / (2 / rm - v.lengthSq() / mu);
  if (a < 0) return Infinity;
  const h2 = _d.crossVectors(r, v).lengthSq();
  return a * (1 + Math.sqrt(Math.max(0, 1 - h2 / (mu * a))));
}

/** headless prograde burn to apoapsis raT; replicates the in-game burn (RK4, thrust along velocity).
 *  The last step is shortened so the cut-off is exact regardless of the step size. */
export function simBurn(mu, r0, v0, mass0, F, mdot, raT, h) {
  const r = r0.clone(), v = v0.clone();
  let m = mass0, t = 0;
  const kr = [0, 1, 2, 3].map(() => new Vector3()), kv = [0, 1, 2, 3].map(() => new Vector3());
  const tr = new Vector3(), tv = new Vector3(), pr = new Vector3(), pv = new Vector3();
  const acc = (rr, vv, out) => out.copy(rr).multiplyScalar(-mu / Math.pow(rr.lengthSq(), 1.5)).addScaledVector(vv, F / m / vv.length());
  const step = (hh) => {
    kr[0].copy(v); acc(r, v, kv[0]);
    tr.copy(r).addScaledVector(kr[0], hh / 2); tv.copy(v).addScaledVector(kv[0], hh / 2); kr[1].copy(tv); acc(tr, tv, kv[1]);
    tr.copy(r).addScaledVector(kr[1], hh / 2); tv.copy(v).addScaledVector(kv[1], hh / 2); kr[2].copy(tv); acc(tr, tv, kv[2]);
    tr.copy(r).addScaledVector(kr[2], hh); tv.copy(v).addScaledVector(kv[2], hh); kr[3].copy(tv); acc(tr, tv, kv[3]);
    r.addScaledVector(kr[0], hh / 6).addScaledVector(kr[1], hh / 3).addScaledVector(kr[2], hh / 3).addScaledVector(kr[3], hh / 6);
    v.addScaledVector(kv[0], hh / 6).addScaledVector(kv[1], hh / 3).addScaledVector(kv[2], hh / 3).addScaledVector(kv[3], hh / 6);
  };
  while (t < 900) {
    if (apoFast(mu, r, v) >= raT) break;
    pr.copy(r); pv.copy(v);
    const m0 = m;
    step(h); m -= mdot * h;
    if (apoFast(mu, r, v) >= raT) {
      let lo = 0, hi = h;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        r.copy(pr); v.copy(pv); m = m0; step(mid); m -= mdot * mid;
        if (apoFast(mu, r, v) >= raT) hi = mid; else lo = mid;
      }
      t += hi;
      break;
    }
    t += h;
  }
  return { r, v, t };
}

const PE_TARGET = 55e3;
function planTransfer(world, v) {
  const P = BODIES.planet, M = BODIES.moon, mu = P.mu;
  const el0 = v.orbit;
  if (!el0 || el0.hyper) return 'Need a bound orbit around Halcyon';
  const mass = world.massOf(v), F = v.spec.thrust, mdot = v.massFlow(1);
  const raT = M.orbit.a;
  const T = el0.period;
  const t0 = world.UT;
  const evaluate = (delta, h) => {
    const t = t0 + delta;
    const s = stateAt(el0, t);
    const b = simBurn(mu, s.r, s.v, mass, F, mdot, raT, h);
    const el = elementsFromState(mu, b.r, b.v, t + b.t);
    const ev = world.findEvent('planet', el, t + b.t, 0);
    if (ev.type !== 'enter' || ev.t - (t + b.t) > el.period * 0.75) return null; // first pass only
    const st = stateAt(el, ev.t), ms = world.moonState(ev.t);
    const e2 = elementsFromState(M.mu, st.r.clone().sub(ms.r), st.v.clone().sub(ms.v), ev.t);
    return { delta, pe: e2.rp - M.radius, tEnter: ev.t, burnT: b.t };
  };
  let best = null;
  const consider = (r) => { if (r && (!best || Math.abs(r.pe - PE_TARGET) < Math.abs(best.pe - PE_TARGET))) best = r; };
  const cs = T / 500; // coarse scan step (the window is about a minute wide)
  for (let d = 0; d < T; d += cs) consider(evaluate(d, 0.5));
  if (!best) return 'No transfer window found: try a different orbit';
  const c = best.delta;
  best = null;
  for (let d = c - cs; d <= c + cs; d += 0.25) if (d >= 0) consider(evaluate(d, 0.05));
  if (!best) return 'No precise transfer solution found';
  if (best.pe < 15e3 && !world.headless) world.say('Warning: low predicted periapsis at Pell', 'warn');
  v.ap = { type: 'xfer', phase: 'wait', tStart: t0 + best.delta, raT, pe: best.pe };
  if (!world.headless) world.say(`Transfer planned: burn in ${best.delta.toFixed(0)} s, Pell periapsis ~${(best.pe / 1000).toFixed(0)} km`, 'info');
  return null;
}

function runXfer(world, v, ap) {
  const mu = BODIES.planet.mu;
  if (v.body !== 'planet') return finish(world, v, 'Transfer complete');
  ap.dir = (ap.dir || new Vector3()).copy(v.v).normalize();
  if (ap.phase === 'wait') {
    const left = ap.tStart - world.UT;
    ap.wakeAt = ap.tStart;
    if (left > 0) { pickWarp(world, v, left, 0, 1.5); return; }
    ap.phase = 'burn'; delete ap.wakeAt;
    if (v.id === world.activeId) world.warpIndex = Math.min(world.warpIndex, 2);
  }
  if (ap.phase === 'burn') {
    const ra = apoFast(mu, v.r, v.v);
    if (ra >= ap.raT) return finish(world, v, 'Transfer burn complete: coast to Pell (warp is safe)');
    v.throttle = aligned(v, ap.dir, 0.98) ? 1 : 0;
    // estimate time to cut-off from how fast the apoapsis is climbing; fall back to 1x near it
    if (ap.lastT === undefined || world.UT - ap.lastT > 0.5) {
      if (ap.lastT !== undefined) ap.rate = (ra - ap.lastRa) / (world.UT - ap.lastT);
      ap.lastRa = ra; ap.lastT = world.UT;
    }
    burnWarp(world, v, ap.rate > 0 ? ((ap.raT - ra) / ap.rate) * 0.5 : 0);
  }
}

// ---------------------------------------------------------------------------------- landing
function angleAhead(from, to, W) {
  const cross = _b.crossVectors(from, to);
  return ((Math.atan2(cross.dot(W), from.dot(to)) % TAU) + TAU) % TAU;
}

/** simulate deorbit+descent from the current state to learn how far (rad along the orbit) it travels */
export function landingArc(world, v) {
  const w = world.clone();
  const sv = w.vessel(v.id);
  const dir = sv.v.clone().normalize().negate();
  sv.q.premultiply(new Quaternion().setFromUnitVectors(sv.noseWorld(new Vector3()), dir));
  sv.w.set(0, 0, 0);
  sv.ap = { type: 'land', phase: 'deorbit', site: null };
  sv.sas.on = true;
  w.warpIndex = 0;
  const W = new Vector3().crossVectors(v.r, v.v).normalize();
  let guard = 0;
  while (sv.status === 'flying' && guard++ < 120000) w.advance(0.05);
  if (sv.status !== 'landed') return null;
  return { arc: angleAhead(v.r, sv.r, W), dir: sv.landedDir.clone() };
}

function brakeEndAlt(world, v, B) {
  // forward-integrate full-thrust retrograde braking; return altitude when speed drops below 12 m/s
  const r = _a.copy(v.r), vel = _b.copy(v.v);
  let m = world.massOf(v);
  const F = v.spec.thrust, mdot = v.massFlow(1);
  let t = 0;
  const dt = 0.25;
  while (t < 600) {
    const sp = vel.length();
    if (sp < 12) break;
    const rm = r.length();
    if (rm - B.radius - v.spec.groundOffset < 0) return -1;
    _c.copy(r).multiplyScalar(-B.mu / (rm * rm * rm)).addScaledVector(vel, -F / m / sp);
    vel.addScaledVector(_c, dt); r.addScaledVector(vel, dt);
    m -= mdot * dt; t += dt;
  }
  return r.length() - B.radius - v.spec.groundOffset;
}

/** landing assist safety: put the legs down before anything else */
function ensureGear(world, v) {
  const g = v.dep.gear;
  if (g && g.ok && g.t < 1) { g.t = 1; if (!world.headless) world.say('Landing assist: deploying landing gear', 'info'); }
}

function runLand(world, v, ap) {
  ensureGear(world, v);
  const B = BODIES.moon;
  const mu = B.mu;
  const R = B.radius;
  const off = v.spec.groundOffset;
  const rm = v.r.length();
  const alt = rm - R - off;
  _a.copy(v.r).divideScalar(rm);
  const vr = v.v.dot(_a);
  const vm = v.v.length();
  const retro = (ap.dir = ap.dir || new Vector3()).copy(v.v).divideScalar(vm || 1).negate();

  if (ap.phase === 'plan') {
    if (v.orbit && v.orbit.rp < R + off) { ap.phase = 'fall'; }
    else {
      const sol = landingArc(world, v);
      if (!sol) { v.ap = null; if (!world.headless) world.say('Landing assist: could not find a descent (low propellant?)', 'bad'); return; }
      const W = new Vector3().crossVectors(v.r, v.v).normalize();
      // pick the ore site that needs the least waiting
      let bestWait = Infinity, best = null;
      for (const s of B.sites) {
        const ahead = angleAhead(v.r, s.dir.clone().multiplyScalar(R), W);
        const wait = ((ahead - sol.arc) % TAU + TAU) % TAU;
        if (wait < bestWait) { bestWait = wait; best = s; }
      }
      ap.site = best; ap.arc = sol.arc; ap.phase = 'coast';
      if (!world.headless) world.say(`Landing assist: targeting ${best.name}`, 'info');
    }
  }
  if (ap.phase === 'coast') {
    const W = _c.crossVectors(v.r, v.v).normalize();
    const ahead = angleAhead(v.r, _d.copy(ap.site.dir).multiplyScalar(R), W);
    const wait = ((ahead - ap.arc) % TAU + TAU) % TAU;
    const omega = v.r.clone().cross(v.v).length() / (rm * rm);
    // refine the descent arc from closer to the ignition point (orbit eccentricity changes it)
    const stage = wait < 0.05 ? 2 : wait < 0.45 ? 1 : 0;
    if (stage > (ap.refined || 0) && wait < Math.PI) {
      ap.refined = stage;
      const sol = landingArc(world, v);
      if (sol) ap.arc = sol.arc;
      return;
    }
    const w = wait > Math.PI * 1.9 ? 0 : wait;
    const left = w / omega;
    if (left > 0.08) {
      const next = (ap.refined || 0) < 1 ? 0.45 : (ap.refined || 0) < 2 ? 0.05 : 0;
      ap.wakeAt = world.UT + Math.max(0.02, (w - next) / omega + (next === 0 ? -0.06 : 0.01));
      pickWarp(world, v, left, 0, 1.5);
      return;
    }
    delete ap.wakeAt;
    ap.phase = 'deorbit';
    if (v.id === world.activeId) world.warpIndex = Math.min(world.warpIndex, 2);
  }
  if (ap.phase === 'deorbit') {
    const el = elementsFromState(mu, v.r, v.v, world.UT);
    const err = el.rp - (R - 2000); // soften the cut-off so the result barely depends on the step size
    v.throttle = aligned(v, retro) ? Math.max(0.02, Math.min(1, err / 4000)) : 0;
    if (err <= 0) { v.throttle = 0; ap.phase = 'fall'; }
    noWarp(world, v);
    return;
  }
  if (ap.phase === 'fall') {
    v.throttle = 0;
    // surface-retro attitude while falling
    const ev = v.railed ? world.railsEvent(v) : null;
    const stopDist = vm * vm / (2 * Math.max(1, accelOf(world, v) - mu / (rm * rm)));
    if (ev && ev.type === 'impact') {
      // coast fast, then step down (5x ... 1x) so the burn starts at the right moment; the burn decision itself runs every 0.05 s of sim time at any warp
      const tBrake = vm / Math.max(1, accelOf(world, v) - mu / (rm * rm));
      pickWarp(world, v, ev.t - world.UT - tBrake * 1.6, 12, 2);
    } else if (!v.railed) noWarp(world, v);
    if (alt < stopDist * 3 + 800) {
      if (alt < 5000 && v.id === world.activeId && world.warpIndex > 0) world.warpIndex = 0;
      const end = brakeEndAlt(world, v, B);
      if (end <= 130) ap.phase = 'suicide';
    }
    if (ap.phase === 'fall') return;
  }
  if (ap.phase === 'suicide') {
    if (v.id === world.activeId) world.warpIndex = 0;
    v.throttle = aligned(v, retro, 0.9) ? 1 : 0.0;
    if (vm < 14 || vr > 0.5) ap.phase = 'final';
    else return;
  }
  if (ap.phase === 'final') {
    if (v.id === world.activeId) world.warpIndex = 0;
    const g = mu / (rm * rm);
    const accMax = accelOf(world, v);
    const vt = -Math.min(25, 0.9 + 0.12 * alt);
    let aUp = g + 1.5 * (vt - vr);
    aUp = Math.max(0, Math.min(accMax, aUp));
    _b.copy(v.v).addScaledVector(_a, -vr); // horizontal velocity
    let vhDes = _c.set(0, 0, 0);
    if (ap.site && alt > 3) {
      _d.copy(ap.site.dir).multiplyScalar(R + off).sub(v.r);
      _d.addScaledVector(_a, -_d.dot(_a));
      const dist = _d.length();
      if (dist < 1500 && dist > 1) vhDes = _d.multiplyScalar(Math.min(14, 0.05 * dist, 0.25 * alt) / dist);
    }
    const ah = _d.copy(vhDes).sub(_b).multiplyScalar(1.5);
    const lim = (alt < 6 ? 0.35 : 0.45) * Math.max(aUp, g * 0.5);
    if (ah.length() > lim) ah.setLength(lim);
    const T = new Vector3().copy(_a).multiplyScalar(Math.max(aUp, 0.0)).add(ah);
    const tm = T.length();
    ap.dir.copy(tm > 1e-6 ? T.multiplyScalar(1 / tm) : _a);
    v.throttle = aligned(v, ap.dir, 0.9) ? Math.min(1, tm / accMax) : Math.min(0.5, tm / accMax);
  }
}

// ---------------------------------------------------------------------------------- rendezvous
function runRdv(world, v, ap) {
  const t = world.targetOf(v);
  if (!t || t.body !== v.body || t.status !== 'flying') return finish(world, v, null);
  const rel = _b.copy(t.r).sub(v.r);
  const range = rel.length();
  if (range > 150000) { v.ap = null; v.throttle = 0; world.say('Rendezvous assist: target too far (150 km max)', 'warn'); return; }
  rel.divideScalar(range);
  const u = _c.copy(v.v).sub(t.v);
  const vdes = Math.max(0.6, Math.min(80, 0.012 * range));
  const dv = _d.copy(rel).multiplyScalar(vdes).sub(u);
  const dvm = dv.length();
  ap.dir = (ap.dir || new Vector3());
  if (dvm > 1e-6) ap.dir.copy(dv).divideScalar(dvm);
  const acc = accelOf(world, v);
  const B = BODIES[v.body];
  if (v.orbit && v.orbit.rp < B.radius + 3000 && !(v.orbit.rp > v.r.length() - 100)) {
    v.ap = null; v.throttle = 0;
    world.say('Rendezvous assist stopped: periapsis would drop too low', 'warn');
    return;
  }
  if (range > 1500 && v.id === world.activeId && world.warpIndex < 2) world.setWarp(2, true); // coast the long gap at 5x
  v.throttle = dvm > 0.12 && aligned(v, ap.dir, 0.97) ? Math.max(0.03, Math.min(1, dvm / (acc * 0.6))) : 0;
  noWarp(world, v);
}

// ---------------------------------------------------------------------------------- ascent
function planAscent(world, v, ap) {
  const B = BODIES.moon;
  const C = world.carrier;
  const haveC = C && C !== v && C.status === 'flying' && C.body === 'moon' && C.orbit && !C.orbit.hyper && C.orbit.e < 0.05;
  ap.tgt = haveC ? Math.max(10000, C.orbit.a - B.radius) : 45000;
  ap.phase = 'run';
  if (!haveC || v.status !== 'landed') return;
  // simulate the whole ascent+circularization to learn where the lander ends up relative to the carrier
  const w = world.clone();
  const sv = w.vessel(v.id);
  sv.ap = { type: 'asc', phase: 'run', tgt: ap.tgt };
  sv.sas.on = true; w.warpIndex = 0;
  let guard = 0;
  while (sv.ap && sv.status !== 'crashed' && guard++ < 120000) w.advance(0.05);
  if (sv.status !== 'flying') return;
  const sc = w.vessel('carrier');
  const W = new Vector3().crossVectors(C.r, C.v).normalize();
  const gap = angleAhead(sc.r, sv.r, W);
  const omega = new Vector3().crossVectors(C.r, C.v).length() / C.r.lengthSq();
  const delta = gap / omega;
  ap.phase = 'wait'; ap.tLaunch = world.UT + delta;
  if (!world.headless) world.say(`Ascent assist: launch window in ${delta.toFixed(0)} s (carrier orbit ${((ap.tgt) / 1000).toFixed(0)} km)`, 'info');
}

/** ascent pitch program: vertical until `start` m, then pitch over towards the horizon by `frac` x target altitude */
export const ASC = { start: 100, frac: 0.12, maxPitch: 1.5 };

function runAsc(world, v, ap) {
  const B = BODIES.moon;
  if (ap.phase === 'plan') planAscent(world, v, ap);
  if (ap.phase === 'wait') {
    const left = ap.tLaunch - world.UT;
    ap.wakeAt = ap.tLaunch;
    if (left > 0.05) { v.throttle = 0; pickWarp(world, v, left, 0, 1.5); return; }
    ap.phase = 'run'; delete ap.wakeAt;
    if (v.id === world.activeId) world.warpIndex = 0;
  }
  const rm = v.r.length();
  const rh = _a.copy(v.r).divideScalar(rm);
  const alt = rm - B.radius - v.spec.groundOffset;
  // head along the carrier's orbit direction so the ascent lands in its plane
  const C = world.carrier;
  const W = _b.set(0, 0, 1);
  if (C && C !== v && C.status === 'flying' && C.body === 'moon') W.crossVectors(C.r, C.v).normalize();
  const tan = _c.crossVectors(W, rh);
  if (tan.lengthSq() < 1e-6) tan.set(0, 1, 0).cross(rh);
  tan.normalize();
  const th = alt < ASC.start ? 0 : Math.min(ASC.maxPitch, ((alt - ASC.start) / (ap.tgt * ASC.frac)) * ASC.maxPitch);
  ap.dir = (ap.dir || new Vector3()).copy(rh).multiplyScalar(Math.cos(th)).addScaledVector(tan, Math.sin(th)).normalize();
  if (v.status === 'landed') { v.throttle = 1; return; }
  v.throttle = aligned(v, ap.dir, 0.9) ? 1 : 0.4;
  noWarp(world, v);
  if (v.orbit && !v.orbit.hyper && v.orbit.ra - B.radius >= ap.tgt && alt > 1500) {
    v.throttle = 0;
    v.ap = { type: 'circ', phase: 'plan' };
    if (!world.headless) world.say('Ascent complete: circularizing at apoapsis', 'info');
  }
}
