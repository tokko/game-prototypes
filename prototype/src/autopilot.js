// Flight assists: circularize, moon-transfer, landing (suicide burn), rendezvous.
// An autopilot is just state in `vessel.ap`; each sim sub-step it may set `vessel.throttle`,
// `vessel.ap.dir` (nose direction for SAS) and request time warp. Pure sim, no DOM.
import { Vector3, Quaternion } from 'three';
import { BODIES, isMoon } from './bodies.js';
import { elementsFromState, stateAt, nextApoapsisTime, nextPeriapsisTime, nodeDvVector, TAU, G0 } from './orbits.js';
import { WARP, THRUST_WARP_MAX } from './world.js';

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _d = new Vector3();

export const AP_NAMES = { circ: 'Circularize', xfer: 'Transfer', node: 'Execute node', land: 'Landing assist', rdv: 'Rendezvous', asc: 'Ascent assist' };

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
    if (!isMoon(v.body) || !v.spec.canLand) return 'Ascent assist is for the lander around a moon';
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
    const bid = world.targetBodyId();
    const msg = planTransferNode(world, v, bid);
    if (msg) return msg;
    v.ap = { type: 'node', phase: 'plan', body: v.body, msg: `Transfer burn complete: coast to ${BODIES[bid].name} (warp is safe)` };
  } else if (type === 'node') {
    if (!v.nodes.length) return "No maneuver node: add one (; or ') or plan a transfer";
    v.ap = { type, phase: 'plan', body: v.body };
  } else if (type === 'land') {
    if (!isMoon(v.body)) return 'Landing assist works around a moon (Pell, Wren)';
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
  const fn = { circ: runCirc, node: runNode, land: runLand, rdv: runRdv, asc: runAsc }[ap.type];
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

// ---------------------------------------------------------------------------------- maneuver nodes
const _p = { r: new Vector3(), v: new Vector3() };

/** prograde dv (m/s) that raises the apoapsis to raT from state (r, v); null if it already reaches it */
function dvToApo(mu, r, v, raT) {
  const rm = r.length(), vm = v.length();
  const h0 = _d.crossVectors(r, v).length();
  const apo = (dv) => {
    const sp = vm + dv, en = sp * sp / 2 - mu / rm;
    if (en >= 0) return Infinity;
    const a = -mu / (2 * en), h = h0 * sp / vm;
    return a * (1 + Math.sqrt(Math.max(0, 1 - h * h / (mu * a))));
  };
  if (apo(0) >= raT) return null;
  let lo = 0, hi = Math.sqrt(2 * mu / rm) - vm + 1;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (apo(mid) >= raT) hi = mid; else lo = mid; }
  return hi;
}

/**
 * Plan a transfer to a moon as a prograde node. For every departure time over one orbit the node dv is the Hohmann-style
 * burn that puts the apoapsis at the moon's orbit; the departure time is then refined (impulsive model, same findEvent
 * the map uses) until the encounter periapsis matches the body's target. The node executor guides against the planned
 * post-node orbit, so the finite burn reproduces this impulsive solution.
 */
export function planTransferNode(world, v, bodyId) {
  const P = BODIES.planet, M = BODIES[bodyId], mu = P.mu;
  const el0 = v.orbit;
  if (v.body !== 'planet') return 'Transfers are planned from Halcyon orbit';
  if (v.status !== 'flying' || !el0 || el0.hyper) return 'Need a bound orbit around Halcyon';
  const raT = M.orbit.a, T = el0.period, t0 = world.UT;
  const lead = world.burnTime(v, 1000) / 2 + 45; // earliest node: time to turn the ship and start the burn
  const evaluate = (delta) => {
    const t = t0 + lead + delta;
    stateAt(el0, t, _p);
    const dv = dvToApo(mu, _p.r, _p.v, raT);
    if (dv === null) return null;
    const el = elementsFromState(mu, _p.r, _p.v.clone().multiplyScalar(1 + dv / _p.v.length()), t);
    const ev = world.findEvent('planet', el, t, 0);
    if (ev.type !== 'enter' || ev.body !== bodyId || ev.t - t > el.period * 0.75) return null; // first pass, this moon only
    const st = stateAt(el, ev.t), ms = world.moonState(ev.t, undefined, bodyId);
    const e2 = elementsFromState(M.mu, st.r.sub(ms.r), st.v.sub(ms.v), ev.t);
    return { delta, dv, pe: e2.rp - M.radius };
  };
  let best = null;
  const consider = (r) => { if (r && (!best || Math.abs(r.pe - M.targetPe) < Math.abs(best.pe - M.targetPe))) best = r; };
  // the encounter window is about +-soi/(ra * orbital rate) wide in departure time: scan with a fraction of that
  const cs = Math.max(1, Math.min(T / 20, 0.8 * M.soi / (raT * 2 * Math.PI / T)));
  for (let d = 0; d < T; d += cs) consider(evaluate(d));
  if (!best) return `No transfer window to ${M.name} found: try a different orbit`;
  let step = cs;
  for (let level = 0; level < 4; level++) {
    const c = best.delta, sub = step / 10;
    for (let d = c - step; d <= c + step + 1e-9; d += sub) if (d >= 0) consider(evaluate(d));
    step = sub;
  }
  const msg = world._nodeEditable(v);
  if (msg) return msg;
  world.setNode(v, { t: t0 + lead + best.delta, dv: { pro: best.dv, nrm: 0, rad: 0 } });
  if (!world.headless) {
    if (Math.abs(best.pe - M.targetPe) > 0.3 * M.targetPe + 3000) world.say(`Warning: predicted ${M.name} periapsis ${(best.pe / 1000).toFixed(0)} km misses the ${(M.targetPe / 1000).toFixed(0)} km target`, 'warn');
    world.say(`Transfer to ${M.name} planned: node in ${(lead + best.delta).toFixed(0)} s, ${best.dv.toFixed(0)} m/s, periapsis ~${(best.pe / 1000).toFixed(0)} km`, 'info');
  }
  return null;
}

/** circularization node at the next apoapsis ('ap') or periapsis ('pe') */
export function planCircNode(world, v, where) {
  const el = v.orbit;
  if (v.status !== 'flying' || !el) return 'No orbit solution';
  if (where === 'ap' && el.hyper) return 'A hyperbolic orbit has no apoapsis';
  const mu = BODIES[v.body].mu, t = world.UT;
  const lead = world.burnTime(v, 300) / 2 + 40;
  let tA = where === 'ap' ? nextApoapsisTime(el, t) : nextPeriapsisTime(el, t);
  if (el.hyper) { if (tA < t + lead) return 'Periapsis already passed'; } else while (tA < t + lead) tA += el.period;
  const rB = where === 'ap' ? el.ra : el.rp;
  const dv = Math.sqrt(mu / rB) - Math.sqrt(mu * (2 / rB - 1 / el.a));
  const msg = world._nodeEditable(v);
  if (msg) return msg;
  world.setNode(v, { t: tA, dv: { pro: dv, nrm: 0, rad: 0 } });
  if (!world.headless) world.say(`Circularize node at ${where === 'ap' ? 'apoapsis' : 'periapsis'}: ${dv >= 0 ? '+' : ''}${dv.toFixed(0)} m/s`, 'info');
  return null;
}

/**
 * Execute the first node: warp to (node - half the burn), point along the node's inertial burn vector, then burn guided by
 * the remaining dv = (planned post-node velocity) - (actual velocity), which is the node vector minus the dv delivered with
 * gravity cancelled. Throttle tapers near the end; the node is removed once the remainder is ~0.
 */
function runNode(world, v, ap, h) {
  const node = v.nodes[0];
  if (!node || v.body !== ap.body) return finish(world, v, null);
  if (ap.phase === 'plan') {
    const dvv = nodeDvVector(v.orbit, node, _a, _p);
    ap.dvm = dvv.length();
    if (ap.dvm < 0.05) { v.nodes.shift(); world._nodeRev++; return finish(world, v, 'Node is empty: removed'); }
    ap.d0 = dvv.clone().divideScalar(ap.dvm);
    ap.ref = elementsFromState(BODIES[v.body].mu, _p.r.clone(), _p.v.clone().add(dvv), node.t);
    ap.tStart = node.t - world.burnCentroid(v, ap.dvm); // centre the dv (not the duration) on the node
    ap.dir = ap.d0.clone();
    ap.phase = 'wait';
    if (!world.headless) world.say(`Executing node: ${ap.dvm.toFixed(0)} m/s, burn ${world.burnTime(v, ap.dvm).toFixed(0)} s`, 'info');
  }
  if (ap.phase === 'wait') {
    ap.dir.copy(ap.d0);
    const left = ap.tStart - world.UT;
    ap.wakeAt = ap.tStart;
    if (left > 0) { pickWarp(world, v, left, 0, 1.5); return; }
    ap.phase = 'burn'; delete ap.wakeAt;
    if (v.id === world.activeId) world.warpIndex = Math.min(world.warpIndex, 2);
  }
  if (!v.hasProp()) { v.nodes = []; world._nodeRev++; return finish(world, v, null); }
  const rem = _b.copy(stateAt(ap.ref, world.UT, _p).v).sub(v.v);
  const remM = rem.length();
  if (remM > 1e-6) ap.dir.copy(rem).divideScalar(remM);
  if (remM < 0.004 || (ap.started && rem.dot(ap.d0) < 0)) {
    v.nodes.shift(); world._nodeRev++;
    return finish(world, v, ap.msg || `Maneuver complete (${remM.toFixed(2)} m/s off)`);
  }
  const acc = accelOf(world, v);
  const thr = Math.min(1, remM / (acc * h), Math.max(0.05, remM / (acc * 0.5))); // taper, last step is dead-beat
  v.throttle = aligned(v, ap.dir, 0.98) ? thr : 0;
  if (v.throttle > 0) ap.started = true;
  burnWarp(world, v, (remM / acc) * 0.7);
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
  const B = BODIES[v.body];
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
      // the selected site of this moon, else the ore site that needs the least waiting
      const sel = world.targetSite(v.body);
      let bestWait = Infinity, best = null;
      for (const s of (sel ? [sel] : B.sites)) {
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
  const B = BODIES[v.body];
  const C = world.carrier;
  const haveC = C && C !== v && C.status === 'flying' && C.body === v.body && C.orbit && !C.orbit.hyper && C.orbit.e < 0.05;
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
  const B = BODIES[v.body];
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
  if (C && C !== v && C.status === 'flying' && C.body === v.body) W.crossVectors(C.r, C.v).normalize();
  const tan = _c.crossVectors(W, rh);
  if (tan.lengthSq() < 1e-6) tan.set(0, 1, 0).cross(rh);
  tan.normalize();
  const th = alt < ASC.start ? 0 : Math.min(ASC.maxPitch, ((alt - ASC.start) / (ap.tgt * ASC.frac)) * ASC.maxPitch);
  ap.dir = (ap.dir || new Vector3()).copy(rh).multiplyScalar(Math.cos(th)).addScaledVector(tan, Math.sin(th)).normalize();
  // cap the acceleration at 8 surface g: a no-op at Pell, but keeps the climb sane on tiny low-gravity Wren
  const cap = Math.min(1, 8 * B.mu / (B.radius * B.radius) / accelOf(world, v));
  if (v.status === 'landed') { v.throttle = cap; return; }
  v.throttle = aligned(v, ap.dir, 0.9) ? cap : 0.4 * cap;
  noWarp(world, v);
  if (v.orbit && !v.orbit.hyper && v.orbit.ra - B.radius >= ap.tgt && alt > 1500) {
    v.throttle = 0;
    v.ap = { type: 'circ', phase: 'plan' };
    if (!world.headless) world.say('Ascent complete: circularizing at apoapsis', 'info');
  }
}
