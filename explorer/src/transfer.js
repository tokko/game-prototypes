// Simplified patched-conic transfer planning between any two destinations.
//  - parents differ  : departure from parking orbit -> escape parent system -> Hohmann around the Sun -> capture
//  - same parent     : Hohmann around the parent giant between the two moon orbits
// Burns are applied as time-compressed impulses by main.js; moon-phase alignment inside a parent system
// is assumed (forgiving). Launch-window phase error costs extra delta-v.
import { SUN, BODIES, planetLevel, orbitAngle, orbitRate, parkRadius } from './destinations.js';

const TAU = Math.PI * 2;
const wrap = (x) => x - TAU * Math.round(x / TAU);
const hyp = (mu, r, vinf) => Math.sqrt(vinf * vinf + 2 * mu / r) - Math.sqrt(mu / r);

function hohmann(mu, r1, r2) {
  const at = (r1 + r2) / 2;
  const vc1 = Math.sqrt(mu / r1), vc2 = Math.sqrt(mu / r2);
  const vt1 = Math.sqrt(mu * (2 / r1 - 1 / at)), vt2 = Math.sqrt(mu * (2 / r2 - 1 / at));
  return { at, vc1, vc2, vt1, vt2, vinf1: Math.abs(vt1 - vc1), vinf2: Math.abs(vc2 - vt2), tof: Math.PI * Math.sqrt(at * at * at / mu) };
}

/** delta-v to leave / enter the parking orbit of `b` given the excess speed relative to its planet-level body */
function stageDv(b, vInf) {
  const r = parkRadius(b);
  if (b.kind === 'planet') return { dv: hyp(b.mu, r, vInf), vInfLocal: vInf };
  const P = BODIES[b.parent];
  const vm = Math.sqrt(P.mu / b.a);
  const vdep = Math.sqrt(vInf * vInf + 2 * P.mu / b.a);
  const vx = Math.max(vdep - vm, 1);
  return { dv: hyp(b.mu, r, vx), vInfLocal: vx };
}

/** Plan a leg. t = current universal time. Returns every number the UI shows. */
export function planLeg(fromId, toId, t) {
  const A = BODIES[fromId], Bd = BODIES[toId];
  const sibling = A.kind === 'moon' && Bd.kind === 'moon' && A.parent === Bd.parent;
  let central, h, n1, n2, th1, th2, rate, ref;
  if (sibling) {
    central = BODIES[A.parent];
    h = hohmann(central.mu, A.a, Bd.a);
    th1 = orbitAngle(A, t); th2 = orbitAngle(Bd, t);
    n1 = orbitRate(A); n2 = orbitRate(Bd);
    // departing moon speed vs transfer speed
    var depStage = { dv: hyp(A.mu, parkRadius(A), Math.max(Math.abs(h.vt1 - h.vc1), 1)), vInfLocal: Math.abs(h.vt1 - h.vc1) };
    var arrStage = { dv: hyp(Bd.mu, parkRadius(Bd), Math.max(Math.abs(h.vc2 - h.vt2), 1)), vInfLocal: Math.abs(h.vc2 - h.vt2) };
    ref = h.vc1;
  } else {
    const PA = planetLevel(A), PB = planetLevel(Bd);
    central = SUN;
    h = hohmann(SUN.mu, PA.a, PB.a);
    th1 = orbitAngle(PA, t); th2 = orbitAngle(PB, t);
    n1 = orbitRate(PA); n2 = orbitRate(PB);
    var depStage = stageDv(A, h.vinf1);
    var arrStage = stageDv(Bd, h.vinf2);
    ref = h.vc1;
  }
  const phaseReq = wrap(Math.PI - n2 * h.tof);          // target must lead origin by this at departure
  const phaseNow = wrap(th2 - th1);
  const err = wrap(phaseNow - phaseReq);
  const rel = n2 - n1;
  let windowIn;
  if (Math.abs(rel) < 1e-15) windowIn = Infinity;
  else {
    const need = rel > 0 ? ((-err) % TAU + TAU) % TAU : ((err) % TAU + TAU) % TAU;
    windowIn = need / Math.abs(rel);
  }
  const penalty = (Math.abs(err) / Math.PI) * (1000 + 0.35 * (depStage.vInfLocal + arrStage.vInfLocal));
  const inward = (sibling ? Bd.a < A.a : planetLevel(Bd).a < planetLevel(A).a);
  return {
    from: fromId, to: toId, sibling, central: central.id || 'halcyon', centralMu: central.mu,
    r1: sibling ? A.a : planetLevel(A).a, r2: sibling ? Bd.a : planetLevel(Bd).a, inward,
    hohmann: h, tof: h.tof, phaseReq, phaseNow, phaseErr: err, windowIn,
    dvDep: depStage.dv, dvArr: arrStage.dv, vxDep: depStage.vInfLocal, vxArr: arrStage.vInfLocal,
    penalty, dvDepTotal: depStage.dv + penalty, dvTotalIdeal: depStage.dv + arrStage.dv,
    dvTotal: depStage.dv + penalty + arrStage.dv,
  };
}

/** Kepler solve */
function kepler(M, e) { let E = M + e * Math.sin(M); for (let i = 0; i < 30; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return E; }

/** state along the transfer arc at elapsed time tau since departure. Angle measured around `central` from the
 *  departure angle th1 (supplied). Returns {r, ang, ratio} in the central body's frame. */
export function arcState(plan, tau, th1) {
  const { r1, r2, inward } = plan;
  const rp = Math.min(r1, r2), ra = Math.max(r1, r2);
  const a = (rp + ra) / 2, e = (ra - rp) / (ra + rp);
  const n = Math.sqrt(plan.centralMu / (a * a * a));
  const M0 = inward ? Math.PI : 0;
  const M = M0 + n * tau;
  const E = kepler(((M % TAU) + TAU) % TAU, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));
  const nu0 = inward ? Math.PI : 0;
  let dnu = nu - nu0; if (dnu < -1e-9) dnu += TAU;
  return { r, ang: th1 + dnu, u: Math.min(1, tau / plan.tof) };
}

export function arcPoints(plan, th1, count = 90) {
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const s = arcState(plan, plan.tof * i / count, th1);
    pts.push([Math.cos(s.ang) * s.r, Math.sin(s.ang) * s.r]);
  }
  return pts;
}

/** burn time (real physics) for a dv at mass m, thrust T, isp */
export function burnTime(dv, m0, thrust, isp) {
  const ve = isp * 9.80665;
  const mdot = thrust / ve;
  return (m0 * (1 - Math.exp(-dv / ve))) / mdot;
}
