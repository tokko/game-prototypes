// Flight assists: circularize, moon-transfer, landing (suicide burn), rendezvous.
// An autopilot is just state in `vessel.ap`; each sim sub-step it may set `vessel.throttle`,
// `vessel.ap.dir` (nose direction for SAS) and request time warp. Pure sim, no DOM.
import { Vector3, Quaternion } from 'three';
import { BODIES, isMoon, sitesOf, ventState } from './bodies.js';
import { elementsFromState, stateAt, stateFromAnomaly, nextApoapsisTime, nextPeriapsisTime, nodeDvVector, TAU, G0 } from './orbits.js';
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

const fmtWait = (s) => (s < 5400 ? `${(s / 60).toFixed(0)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} days`);

/** Transfer planner entry: by where the vessel is (Halcyon orbit or a moon orbit) and what is targeted (a moon or Halcyon) */
export function planTransferNode(world, v, bodyId) {
  const el0 = v.orbit;
  if (v.status !== 'flying' || !el0) return 'Transfers need a free-flying vessel in orbit';
  if (el0.hyper) return 'Need a bound orbit first (circularize)';
  if (bodyId === v.body) return v.body === 'planet' ? 'Already orbiting Halcyon: pick a moon with `' : `Already orbiting ${BODIES[bodyId].name}: pick another target with \``;
  return v.body === 'planet' ? planToMoonNode(world, v, bodyId) : planEjectionNode(world, v, bodyId);
}

/**
 * Moon orbit -> the other moon, or back to Halcyon: one prograde ejection node. For every burn time the dv is solved (secant,
 * analytic hyperbolic exit to the SOI edge, then the planet-frame conic) so the post-exit planet-frame orbit has its apoapsis at the
 * target moon's orbit (or periapsis at the Halcyon target). The time is scanned over the synodic period (the phasing window can be
 * days away) and refined through the same findEvent chain the map uses until the target periapsis is met.
 */
function planEjectionNode(world, v, bodyId) {
  const A = BODIES[v.body], P = BODIES.planet, T = BODIES[bodyId], muA = A.mu, muP = P.mu;
  const el0 = v.orbit, toPlanet = bodyId === 'planet';
  const rA = A.orbit.a, nA = A.orbit.n, raT = toPlanet ? 0 : T.orbit.a, rpT = P.radius + P.targetPe;
  const inward = !toPlanet && raT < rA; // planet-frame orbit touches the target moon at its periapsis instead of its apoapsis
  const peT = toPlanet ? P.targetPe : T.targetPe;
  const Tv = el0.period, t0 = world.UT;
  const lead = world.burnTime(v, 300) / 2 + 45;
  // planet-frame speed the ejection has to leave with -> nominal v-infinity (signed against the moon's own speed)
  const vreq = Math.sqrt(muP * (2 / rA - 2 / (rA + (toPlanet ? rpT : raT))));
  const vinf = vreq - nA * rA;
  const burned = { r: new Vector3(), v: new Vector3() }, q = { r: new Vector3(), v: new Vector3() }, qm = { r: new Vector3(), v: new Vector3() };
  /** state after burning dv prograde at time tn, followed to the SOI edge: { tExit, el (planet frame) } */
  const exitState = (tn, dv) => {
    stateAt(el0, tn, burned);
    const el = elementsFromState(muA, burned.r, burned.v.clone().multiplyScalar(1 + dv / burned.v.length()), tn);
    if (!el.hyper) return null;
    const c = ((A.soi + 1) / -el.a + 1) / el.e;
    if (c < 1) return null;
    const F = Math.acosh(c);
    const tExit = el.t0 + (el.e * Math.sinh(F) - F - el.M0) / el.n;
    const st = stateFromAnomaly(el, F), ms = world.moonState(tExit, undefined, v.body);
    st.r.add(ms.r); st.v.add(ms.v);
    return { tExit, el: elementsFromState(muP, st.r, st.v, tExit) };
  };
  const resid = (x) => {
    if (toPlanet) return x.el.rp - rpT;
    if (inward) return x.el.hyper ? -1e12 : x.el.rp - raT;
    return (x.el.hyper ? 1e12 : x.el.ra) - raT;
  };
  const solveDv = (tn) => {
    stateAt(el0, tn, q);
    const d0 = Math.sqrt(vinf * vinf + 2 * muA / q.r.length()) - q.v.length();
    let a = d0, b = d0 * 1.02 + 1;
    const xa = exitState(tn, a), xb = exitState(tn, b);
    if (!xa || !xb) return null;
    let fa = resid(xa), fb = resid(xb);
    for (let i = 0; i < 14 && Math.abs(fb) > 300; i++) {
      if (fa === fb || !isFinite(fb)) return null;
      const c = b - fb * (b - a) / (fb - fa);
      if (!(c > 0)) return null;
      a = b; fa = fb; b = c;
      const x = exitState(tn, b);
      if (!x) return null;
      fb = resid(x);
    }
    return Math.abs(fb) <= 300 ? b : null;
  };
  /** signed angle (rad) between the transfer orbit's far point and the target moon when the ship gets there */
  const phase = (tn) => {
    const dv = solveDv(tn);
    if (dv === null) return null;
    const x = exitState(tn, dv);
    const tX = inward ? nextPeriapsisTime(x.el, x.tExit) : nextApoapsisTime(x.el, x.tExit);
    stateAt(x.el, tX, q); stateAt(T.orbit, tX, qm);
    return { tn, dv, x, delta: Math.atan2(q.r.x * qm.r.y - q.r.y * qm.r.x, q.r.dot(qm.r)), miss: q.r.distanceTo(qm.r) };
  };
  const evaluate = (tn) => {
    const dv = solveDv(tn);
    if (dv === null) return null;
    const x = exitState(tn, dv);
    if (toPlanet) {
      const ev = world.findEvent('planet', x.el, x.tExit, 0);
      if (ev.type !== 'none' && ev.t < nextPeriapsisTime(x.el, x.tExit) + 5) return null; // another body in the way
      return { tn, dv, pe: x.el.rp - P.radius };
    }
    const ev = world.findEvent('planet', x.el, x.tExit, 0);
    if (ev.type !== 'enter' || ev.body !== bodyId) return null; // first encounter must be the target
    const st = stateAt(x.el, ev.t), ms = world.moonState(ev.t, undefined, bodyId);
    const e2 = elementsFromState(T.mu, st.r.sub(ms.r), st.v.sub(ms.v), ev.t);
    return { tn, dv, pe: e2.rp - T.radius };
  };
  let best = null;
  const consider = (r) => { if (r && (!best || Math.abs(r.pe - peT) < Math.abs(best.pe - peT))) best = r; };
  let span;
  if (toPlanet) {
    span = 2 * Tv;
    const hits = [];
    for (let d = 0; d < span; d += Tv / 60) { const r = evaluate(t0 + lead + d); if (r) hits.push(r); }
    if (hits.length) best = hits.reduce((a, b) => (b.dv < a.dv ? b : a)); // cheapest ejection
  } else {
    // The far point sweeps round the moon's orbit once per orbit of the ship, so the arrival phase lines up at one burn time per
    // orbit; the cheap ones cluster at the synodic window. Find every zero of the phase miss, then take the best dv-vs-wait trade.
    span = 1.05 * TAU / Math.abs(nA - T.orbit.n);
    const cs = Math.min(Tv / 40, 60);
    const roots = [];
    let prev = null;
    for (let d = 0; d < span; d += cs) {
      const p = phase(t0 + lead + d);
      if (p && prev && Math.abs(p.delta) < 1 && Math.abs(prev.delta) < 1 && (p.delta > 0) !== (prev.delta > 0)) {
        let lo = prev, hi = p;
        for (let i = 0; i < 30 && hi.tn - lo.tn > 0.01; i++) {
          const m = phase((lo.tn + hi.tn) / 2);
          if (!m) { lo = null; break; }
          if ((m.delta > 0) === (lo.delta > 0)) lo = m; else hi = m;
        }
        if (lo) roots.push({ tn: hi.tn, dv: hi.dv });
      }
      prev = p;
    }
    roots.sort((a, b) => (a.dv + (a.tn - t0) / 3000) - (b.dv + (b.tn - t0) / 3000));
    for (const r of roots) {
      // aim the encounter periapsis: at the root the moon is hit dead centre, so offset the burn time until pe matches the target
      best = null;
      let step = 120; // the miss changes slowly with burn time (about 1 km per 0.4 s here)
      for (let level = 0; level < 6; level++) {
        const c = best ? best.tn : r.tn, sub = step / 10;
        for (let t = c - step; t <= c + step + 1e-9; t += sub) if (t >= t0 + lead) consider(evaluate(t));
        step = sub;
      }
      if (best) break;
    }
  }
  if (!best) return `No ${T.name} window found within ${fmtWait(span)}: try a different orbit`;
  const msg = world._nodeEditable(v);
  if (msg) return msg;
  world.setNode(v, { t: best.tn, dv: { pro: best.dv, nrm: 0, rad: 0 } });
  if (!world.headless) {
    if (Math.abs(best.pe - peT) > 0.3 * peT + 3000) world.say(`Warning: predicted ${T.name} periapsis ${(best.pe / 1000).toFixed(0)} km misses the ${(peT / 1000).toFixed(0)} km target`, 'warn');
    world.say(`${toPlanet ? 'Return to Halcyon' : `Transfer to ${T.name}`} planned: node in ${fmtWait(best.tn - t0)}, ${best.dv.toFixed(0)} m/s, periapsis ~${(best.pe / 1000).toFixed(0)} km`, 'info');
  }
  return null;
}

/**
 * Plan a transfer to a moon as a prograde node. For every departure time over one orbit the node dv is the Hohmann-style
 * burn that puts the apoapsis at the moon's orbit; the departure time is then refined (impulsive model, same findEvent
 * the map uses) until the encounter periapsis matches the body's target. The node executor guides against the planned
 * post-node orbit, so the finite burn reproduces this impulsive solution.
 */
function planToMoonNode(world, v, bodyId) {
  const P = BODIES.planet, M = BODIES[bodyId], mu = P.mu;
  const el0 = v.orbit;
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
    finish(world, v, ap.msg || `Maneuver complete (${remM.toFixed(2)} m/s off)`);
    if (ap.then === 'land' && !engageAutopilot(world, v, 'land')) { v.ap.pc = ap.pc; v.ap.pref = ap.pref; } // landing assist continues after the plane change
    return;
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
  return { arc: angleAhead(v.r, sv.r, W), dir: sv.landedDir.clone(), t: w.UT - world.UT };
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

/**
 * Landing needs the site in the orbit plane (moons do not rotate, the descent stays in the plane). Plan one node that rotates the
 * velocity about the radius vector so the new plane contains site direction s, at the cheapest point of the next orbit (the line of
 * nodes), and hand it to the node executor, which resumes the landing assist when done. Returns an error message or null.
 */
function planLandPlaneChange(world, v, site, W) {
  const el = v.orbit, s = site.dir, t0 = world.UT;
  const speed = v.v.length();
  const tl = t0 + world.burnCentroid(v, 2 * speed) + 30; // earliest burn centre: time to turn the ship and start
  const st = { r: new Vector3(), v: new Vector3() }, rh = new Vector3(), n2 = new Vector3(), Wt = new Vector3(), dvv = new Vector3();
  const cands = [];
  const N = 240;
  for (let k = 0; k < N; k++) {
    const t = tl + el.period * k / N;
    stateAt(el, t, st);
    rh.copy(st.r).normalize();
    n2.crossVectors(rh, s);
    const len = n2.length();
    if (len < 1e-3) continue; // site straight above/below: any plane contains it
    Wt.crossVectors(st.r, st.v).normalize();
    n2.divideScalar(len);
    if (n2.dot(Wt) < 0) n2.negate(); // keep the direction of travel
    const alpha = Math.atan2(rh.dot(_a.crossVectors(Wt, n2)), Wt.dot(n2));
    dvv.copy(st.v).applyAxisAngle(rh, alpha).sub(st.v);
    cands.push({ t, alpha, dv: dvv.length(), pro: dvv.dot(_b.copy(st.v).normalize()), nrm: dvv.dot(Wt), rad: dvv.dot(_c.crossVectors(_b, Wt)) });
  }
  if (!cands.length) return null;
  const minDv = Math.min(...cands.map((c) => c.dv));
  const c = cands.find((x) => x.dv <= minDv * 1.01 + 0.5); // the two nodes are equally cheap: take the earlier
  const ve = v.spec.isp * G0, m = world.massOf(v);
  const avail = ve * Math.log(m / Math.max(1, m - v.propMass));
  const deg = (Math.abs(c.alpha) * 180 / Math.PI).toFixed(0);
  const reserve = 2 * speed; // a full descent costs ~1.8x the orbital speed (deorbit, brake, hover)
  if (c.dv + reserve > avail) return `Landing assist: plane change to ${site.name} needs ${c.dv.toFixed(0)} m/s, only ${Math.max(0, avail - reserve).toFixed(0)} available`;
  const msg = world._nodeEditable(v);
  if (msg) return msg;
  world.setNode(v, { t: c.t, dv: { pro: c.pro, nrm: c.nrm, rad: c.rad } });
  v.ap = { type: 'node', phase: 'plan', body: v.body, msg: 'Plane change complete: resuming landing assist' };
  if (!world.headless) world.say(`Landing assist: plane change ${deg}° (${c.dv.toFixed(0)} m/s) before descent to ${site.name}`, 'info');
  return null;
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
      const sel = ap.pref || world.targetSite(v.body); // pref: the site a finished plane change was for
      const missOf = (s) => Math.asin(Math.min(1, Math.abs(s.dir.dot(W)))) * R; // out-of-plane distance of a site
      let bestWait = Infinity, best = null, bestMiss = Infinity;
      for (const s of (sel ? [sel] : sitesOf(v.body))) {
        const ahead = angleAhead(v.r, s.dir.clone().multiplyScalar(R), W);
        const wait = ((ahead - sol.arc) % TAU + TAU) % TAU;
        // without a selected site prefer one already in the orbit plane, else the one needing the smallest plane change
        const miss = sel ? 0 : Math.max(150, missOf(s));
        if (miss < bestMiss || (miss === bestMiss && wait < bestWait)) { bestMiss = miss; bestWait = wait; best = s; }
      }
      const pc = ap.pc || 0;
      if (pc < 2 && !v.orbit.hyper && missOf(best) > (pc ? 300 : 150)) { // the landing only follows the orbit plane: change plane first
        const pcMsg = planLandPlaneChange(world, v, best, W);
        if (pcMsg) { v.ap = null; v.throttle = 0; if (!world.headless) world.say(pcMsg, 'bad'); return; }
        v.ap.then = 'land'; v.ap.pc = pc + 1; v.ap.pref = best;
        return;
      }
      ap.site = best; ap.arc = sol.arc; ap.phase = 'coast';
      if (v.body === 'wren' && !world.headless) { // warn when the target sits next to a geyser that will be erupting at touchdown
        const tTouch = world.UT + bestWait / (_c.crossVectors(v.r, v.v).length() / (rm * rm)) + sol.t;
        for (const vt of B.vents) {
          const d = Math.acos(Math.min(1, best.dir.dot(vt.dir))) * R;
          if (d < 1500 && ventState(vt, tTouch).active) world.say(`Warning: a geyser ${d.toFixed(0)} m from ${best.name} will be erupting at touchdown`, 'warn');
        }
      }
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
