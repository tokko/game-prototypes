// "Plan transfer" assist: builds a chain of maneuver nodes on the real patched-conic prediction.
//   N1 ejection from the parking orbit (timed for the launch window + moon phase),
//   N2 mid-course correction on entering the common frame (Lambert aim at the target system, with periapsis offset),
//   N3 second correction inside the target planet's SOI when the target is a moon (Lambert aim at the moon),
//   N4 capture burn at periapsis into the parking orbit.
// Everything is computed from the same conics the map draws, so a human can edit / extend the chain by hand.
import { Vector3 } from 'three';
import * as S from './system.js';
import { BODIES, parkRadius } from './destinations.js';
import { planLeg } from './transfer.js';
import { nextPeriapsisTime } from './orbits.js';

const TAU = Math.PI * 2;
const wrap = (x) => x - TAU * Math.round(x / TAU);
const ang = (v) => Math.atan2(-v.z, v.x);
const dirOf = (a) => new Vector3(Math.cos(a), 0, -Math.sin(a));
const Y = new Vector3(0, 1, 0);
const hypNu = (mu, r, vinf) => Math.acos(-1 / (1 + r * vinf * vinf / mu));

function hypTimeToSoi(mu, r, vinf, soi) {
  const e = 1 + r * vinf * vinf / mu, a = mu / (vinf * vinf);
  const ch = (soi / a + 1) / e; if (ch < 1) return 0;
  const F = Math.acosh(ch);
  return Math.sqrt(a * a * a / mu) * (e * Math.sinh(F) - F);
}
export function nodeComponents(r, v, dv) {
  const pro = v.clone().normalize(), nrm = new Vector3().crossVectors(r, v).normalize(), rad = new Vector3().crossVectors(pro, nrm);
  return { pro: dv.dot(pro), nrm: dv.dot(nrm), rad: dv.dot(rad) };
}
/** state at time t on a predicted chain (frame of the patch containing t) */
export function chainState(patches, t) {
  for (const p of patches) if (t >= p.t0 && t <= p.t1) { const s = S.stateAt(p.el, t, { r: new Vector3(), v: new Vector3() }); return { r: s.r, v: s.v, p }; }
  return null;
}

/** aim point: target position + offset giving periapsis rp for the relative approach velocity */
function aimPoint(targetId, t, uHat, vinfMag, rp, scale = 1) {
  const rel = S.bodyRel(targetId, t);
  const mu = BODIES[targetId].mu;
  const b = scale * rp * Math.sqrt(1 + 2 * mu / (rp * vinfMag * vinfMag));
  const off = new Vector3().crossVectors(uHat, Y).normalize().multiplyScalar(b);
  return { r: rel.r.clone().add(off), v: rel.v.clone() };
}

/** find an aim-offset scale whose resulting encounter has periapsis ~ target. trial(scale) -> {rp, ...} */
function refineScale(trial, target, tol) {
  let best = null;
  for (const sc of [1, 0.7, 1.4, 0.45, 2.0, 0.25, 3.0]) { const r = trial(sc); if (r.p) { best = { ...r, s: sc }; break; } }
  if (!best) return null;
  let cur = best;
  for (let i = 0; i < 10; i++) {
    if (Math.abs(cur.rp - target) < tol * target) break;
    const ns = cur.s * Math.pow(target / cur.rp, 0.7);
    const r = trial(ns);
    if (!r.p) { cur = { ...cur, s: (cur.s + ns) / 2 }; const r2 = trial(cur.s); if (r2.p) cur = { ...r2, s: cur.s }; continue; }
    if (Math.abs(r.rp - target) < Math.abs(cur.rp - target)) cur = { ...r, s: ns };
    else break;
  }
  return cur;
}

function planOnce(world, v, targetId, skip = 0) {
  const log = [];
  const fail = (msg) => ({ ok: false, error: msg, log });
  const A = v.body, B = targetId;
  if (v.status !== 'orbit' || v.docked) return fail('Vessel must be in orbit');
  if (A === B) return fail('Already at the target');
  if (!BODIES[A]?.destination) return fail('Plan transfers from a destination body orbit');
  if (!v.el || v.el.hyper || v.el.e > 0.08) return fail('Circularize the parking orbit first (e < 0.08)');
  const lineA = S.lineage(A), lineB = S.lineage(B);
  const C = lineA.find((id) => lineB.includes(id));
  if (!C || C === A || C === B) return fail('Unsupported leg');
  const chainA = lineA.slice(0, lineA.indexOf(C)), chainB = lineB.slice(0, lineB.indexOf(C));
  const PA = chainA[chainA.length - 1], PB = chainB[chainB.length - 1];
  const muC = S.muOf(C);
  const t0 = world.t;
  const aA = BODIES[PA].a, aB = BODIES[PB].a, at = (aA + aB) / 2;
  const TOF = Math.PI * Math.sqrt(at * at * at / muC);
  const leg = planLeg(A, B, t0);
  const rpB = parkRadius(BODIES[B]);
  const rpArr = B === PB ? rpB : BODIES[B].a;      // periapsis around PB when the target is a moon
  const muA = BODIES[A].mu, rPark = v.el.a;
  const pOrbit = v.el.period, nS = TAU / pOrbit;
  const shipAng = (t) => ang(S.stateAt(v.el, t, { r: new Vector3(), v: new Vector3() }).r);

  // ---- 1. departure: Lambert in frame C between the planet-level bodies at the window time
  let TOFc = TOF;
  const lamb = (tD, tof = TOFc) => {
    const sA = S.bodyRel(PA, tD);
    const sB0 = S.bodyRel(PB, tD + tof);
    // aim point: centre first, then offset using the approach direction
    let aim = sB0.r.clone(), L = S.lambert(muC, sA.r, aim, tof);
    if (!L) return null;
    for (let k = 0; k < 2; k++) {
      const vrel = L.v2.clone().sub(sB0.v); const u = vrel.clone().normalize();
      const ap = aimPoint(PB, tD + tof, u, vrel.length(), rpArr);
      L = S.lambert(muC, sA.r, ap.r, tof); if (!L) return null;
    }
    return { v1: L.v1, vA: sA.v, rA: sA.r, vinf: L.v1.clone().sub(sA.v) };
  };
  const costTof = (t, tof) => { const L = lamb(t, tof); if (!L) return 1e12; const sB = S.bodyRel(PB, t + tof); const L2 = S.lambert(muC, L.rA, sB.r, tof); return L.vinf.length() + (L2 ? L2.v2.clone().sub(sB.v).length() * 0.8 : 1e9); };
  const optTof = (t) => { let best = Infinity, bt = TOF; for (let k = 0; k <= 28; k++) { const tof = TOF * (0.5 + 1.4 * k / 28); const c = costTof(t, tof); if (c < best) { best = c; bt = tof; } } return { tof: bt, cost: best }; };
  let tw = t0 + (isFinite(leg.windowIn) ? leg.windowIn : 0);
  const synod0 = TAU / Math.max(1e-12, Math.abs(Math.sqrt(S.muOf(C) / (aA ** 3)) - Math.sqrt(S.muOf(C) / (aB ** 3))));
  tw += skip * synod0;
  if (tw < t0 + 600) tw = t0 + 600;
  let dep = null, tD = tw;
  if (chainA.length === 1) {
    // one level: eject straight from A towards the Lambert asymptote
    TOFc = optTof(tD).tof;
    dep = lamb(tD); if (!dep) return fail('Lambert failed at departure');
    const vx = dep.vinf.length(), eh = hypNu(muA, rPark, vx);
    const nodeAngle = ang(dep.vinf) - eh;
    const tx = hypTimeToSoi(muA, rPark, vx, BODIES[A].soi);
    let ts = Math.max(t0 + 120, tD - tx);
    const dtN = ((wrap(nodeAngle - shipAng(ts))) + TAU) % TAU / nS;
    const tN = ts + dtN;
    const dvN = Math.sqrt(vx * vx + 2 * muA / rPark) - Math.sqrt(muA / rPark);
    dep.node = { t: tN, pro: dvN }; dep.tx = tx; dep.vx = vx;
  } else {
    // two levels (moon of PA): the moon must be at the right place on its orbit around PA when we leave
    const moon = BODIES[A], PAb = BODIES[PA];
    const scanSpan = moon.orbit.period;
    const f = (t) => { const L = lamb(t); if (!L) return null; const vm = L.vinf.length(), nu = hypNu(PAb.mu, moon.a, vm); return { L, err: wrap(ang(S.bodyRel(A, t).r) - (ang(L.vinf) - nu)) }; };
    const cost = (t) => optTof(t).cost;
    const synodic = Math.abs(leg.windowIn) < 1e30 ? TAU / Math.abs(Math.sqrt(S.muOf(C) / (aA ** 3)) - Math.sqrt(S.muOf(C) / (aB ** 3))) : 1e9;
    let bestCost = Infinity, bestT = null;
    for (let kw = 0; kw < 3; kw++) {
      const twk = tw + kw * synodic;
      const start = Math.max(t0 + 900, twk - scanSpan * 1.0), span = scanSpan * 2.0, steps = 320;
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const t = start + span * i / steps; const r = f(t); if (!r) { prev = null; continue; }
        if (prev && Math.sign(prev.err) !== Math.sign(r.err) && Math.abs(prev.err - r.err) < 2) {
          let lo = prev.t, hi = t; const el0 = prev.err;
          for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2, rm = f(mid); if (!rm) break; if (Math.sign(rm.err) === Math.sign(el0)) lo = mid; else hi = mid; }
          const tr = (lo + hi) / 2, c = cost(tr) + 0.8 * Math.max(0, tr - t0) / 86400;
          if (c < bestCost) { bestCost = c; bestT = tr; }
        }
        prev = { t, err: r.err };
      }
    }
    if (bestT == null) return fail('No moon-phase window found');
    tD = bestT; TOFc = optTof(tD).tof;
    { // re-solve the moon-phase root with the optimised time of flight
      let prev = null, bestR = null;
      for (let i = 0; i <= 120; i++) { const t = bestT - scanSpan * 0.25 + scanSpan * 0.5 * i / 120; const r = f(t); if (!r) { prev = null; continue; }
        if (prev && Math.sign(prev.err) !== Math.sign(r.err) && Math.abs(prev.err - r.err) < 2) {
          let lo = prev.t, hi = t; const el0 = prev.err;
          for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2, rm = f(mid); if (!rm) break; if (Math.sign(rm.err) === Math.sign(el0)) lo = mid; else hi = mid; }
          const tr = (lo + hi) / 2; if (bestR == null || Math.abs(tr - bestT) < Math.abs(bestR - bestT)) bestR = tr; }
        prev = { t, err: r.err }; }
      if (bestR != null) tD = bestR;
    }
    dep = lamb(tD);
    const vm = dep.vinf.length();
    const vP1 = Math.sqrt(vm * vm + 2 * PAb.mu / moon.a), vMoon = Math.sqrt(PAb.mu / moon.a);
    const vx = Math.max(vP1 - vMoon, 5);
    const eh = hypNu(muA, rPark, vx);
    const moonState = S.bodyRel(A, tD);
    const tangent = ang(moonState.r) + Math.PI / 2;
    const nodeAngle = tangent - eh;
    const tx = hypTimeToSoi(muA, rPark, vx, BODIES[A].soi);
    const ts = Math.max(t0 + 120, tD - tx);
    const dtN = ((wrap(nodeAngle - shipAng(ts))) + TAU) % TAU / nS;
    dep.node = { t: ts + dtN, pro: Math.sqrt(vx * vx + 2 * muA / rPark) - Math.sqrt(muA / rPark) }; dep.tx = tx; dep.vx = vx;
  }
  const nodes = [{ t: dep.node.t, dv: { pro: dep.node.pro, nrm: 0, rad: 0 } }];
  const state0 = { body: v.body, r: v.r, v: v.v, el: v.el };
  const run = (nl) => S.predict(state0, t0, nl, { maxPatches: 12, maxT: 3e9 });
  const findPatch = (pl, id, fromT = 0) => pl.find((p) => p.bodyId === id && p.t0 >= fromT - 1);

  // ---- 2. mid-course correction on entering frame C (aim at the target system)
  let pl = run(nodes);
  const pC = findPatch(pl, C);
  if (!pC) return fail('Ejection did not leave the departure system: ' + pl.map((p) => p.bodyId + ':' + p.type).join(' > '));
  let tm = pC.t0 + Math.min(0.02 * TOFc, 4e6) + 2000;
  const stM = chainState(pl, tm);
  if (!stM) return fail('MCC state unavailable');
  const tArr = tD + TOFc;
  const mcc1 = (scale) => {
    let aimB = S.bodyRel(PB, tArr).r.clone();
    let L = S.lambert(muC, stM.r, aimB, tArr - tm);
    if (!L) return null;
    for (let k = 0; k < 3; k++) {
      const vb = S.bodyRel(PB, tArr); const vrel = L.v2.clone().sub(vb.v);
      const ap = aimPoint(PB, tArr, vrel.clone().normalize(), vrel.length(), rpArr, scale);
      L = S.lambert(muC, stM.r, ap.r, tArr - tm); if (!L) return null;
    }
    return L.v1.clone().sub(stM.v);
  };
  const base1 = nodes.slice();
  const trial1 = (scale) => {
    const dv = mcc1(scale); if (!dv) return { rp: null };
    const nl = base1.concat([{ t: tm, dv: nodeComponents(stM.r, stM.v, dv) }]).sort((x, y) => x.t - y.t);
    const p2 = run(nl); const pp = findPatch(p2, PB, tm);
    return { nl, pl: p2, p: pp, rp: pp ? pp.el.rp : null };
  };
  let tr1 = refineScale(trial1, B === PB ? rpB : rpArr, B === PB ? 0.04 : 0.5);
  if (!tr1) return fail('Midcourse did not reach the target system');
  nodes.length = 0; nodes.push(...tr1.nl);
  pl = tr1.pl;
  let pB = tr1.p;

  // ---- 3. target moon: aim inside the planet's SOI
  if (B !== PB) {
    const tm2 = pB.t0 + 2000;
    const st2 = chainState(pl, tm2);
    if (!st2) return fail('Second midcourse state unavailable');
    const speed = st2.v.length();
    const baseT = Math.max(3600, (BODIES[PB].soi * 0.8) / Math.max(speed, 100));
    const muPB = S.muOf(PB), RPB = BODIES[PB].R;
    // choose the arrival time with the cheapest correction (paths that skim the planet are rejected)
    let bestDv = null;
    const lambFor = (tArr2, scale) => {
      let L = S.lambert(muPB, st2.r, S.bodyRel(B, tArr2).r.clone(), tArr2 - tm2); if (!L) return null;
      for (let j = 0; j < 2; j++) {
        const sb = S.bodyRel(B, tArr2); const vrel = L.v2.clone().sub(sb.v);
        const ap = aimPoint(B, tArr2, vrel.clone().normalize(), vrel.length(), rpB, scale);
        L = S.lambert(muPB, st2.r, ap.r, tArr2 - tm2); if (!L) return null;
      }
      const e = S.elementsFromState(muPB, st2.r, L.v1, tm2);
      if (e.rp < RPB * 1.4) return null;
      return L;
    };
    for (let k = 0; k <= 90; k++) {
      const tArr2 = tm2 + baseT * (0.25 + 2.8 * k / 90);
      const L = lambFor(tArr2, 1); if (!L) continue;
      const dv = L.v1.clone().sub(st2.v);
      if (!bestDv || dv.length() < bestDv.dv.length()) bestDv = { dv, t: tArr2 };
    }
    if (!bestDv) return fail('No moon intercept found');
    const base2 = nodes.slice();
    const trial2 = (scale) => {
      const L = lambFor(bestDv.t, scale); if (!L) return { rp: null };
      const nl = base2.concat([{ t: tm2, dv: nodeComponents(st2.r, st2.v, L.v1.clone().sub(st2.v)) }]).sort((x, y) => x.t - y.t);
      const p2 = run(nl); const pp = findPatch(p2, B, tm2);
      return { nl, pl: p2, p: pp, rp: pp ? pp.el.rp : null };
    };
    const tr2 = refineScale(trial2, rpB, 0.04);
    if (!tr2) return fail('Moon intercept missed');
    nodes.length = 0; nodes.push(...tr2.nl); pl = tr2.pl; pB = tr2.p;
  }

  // ---- 4. capture burn at periapsis
  const el = pB.el;
  if (!el.hyper) return fail('Unexpected bound approach');
  const tp = nextPeriapsisTime(el, pB.t0);
  const sp = S.stateAt(el, tp, { r: new Vector3(), v: new Vector3() });
  const rp = sp.r.length(), vp = sp.v.length(), vc = Math.sqrt(BODIES[B].mu / rp);
  if (rp < BODIES[B].R + 1000) return fail(`Approach periapsis too low (${((rp - BODIES[B].R) / 1000).toFixed(0)} km)`);
  nodes.push({ t: tp, dv: { pro: vc - vp, nrm: 0, rad: 0 } });
  nodes.sort((a, b) => a.t - b.t);
  const final = run(nodes);
  const last = final[final.length - 1];
  const total = nodes.reduce((s, n) => s + Math.hypot(n.dv.pro, n.dv.nrm, n.dv.rad), 0);
  const okCap = last.bodyId === B && !last.el.hyper;
  return { ok: okCap, nodes, total, tArr: tp, tDep: nodes[0].t, tof: tp - nodes[0].t, ideal: leg.dvTotalIdeal, patches: final, periAlt: rp - BODIES[B].R, error: okCap ? null : 'Chain did not end in a bound orbit: ' + final.map((p) => p.bodyId + ':' + p.type).join(' > '), log };
}

/** public entry: tries successive launch windows until an encounter chain closes */
export function planTransfer(world, v, targetId) {
  let last = null;
  for (let skip = 0; skip < 5; skip++) {
    let r; try { r = planOnce(world, v, targetId, skip); } catch (e) { r = { ok: false, error: 'planner error: ' + e.message }; }
    if (r.ok) return r;
    last = r;
    if (r.error && /Vessel must|Already|Circularize|Plan transfers|Unsupported/.test(r.error)) break;
  }
  return last;
}
