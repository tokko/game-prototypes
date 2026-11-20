// Kepler orbit math (patched-conic building blocks).
// Pure maths on THREE.Vector3 (JS doubles). Physics frame is Z-up: orbital plane of the
// system is XY. Rendering converts to three.js Y-up (see main.js `world` group rotation).
import { Vector3 } from 'three';

export const TAU = Math.PI * 2;
export const G0 = 9.80665;

const wrapPi = (x) => x - TAU * Math.round(x / TAU);

/** Elements stored as a vector basis (P periapsis, Q in-plane, W normal) so that circular
 *  and equatorial orbits (the common case in this game) have no singularities. */
export function elementsFromState(mu, r, v, t0) {
  const rm = r.length();
  const h = new Vector3().crossVectors(r, v);
  const hm = h.length();
  const W = hm > 1e-9 ? h.clone().divideScalar(hm) : new Vector3(0, 0, 1);
  const evec = new Vector3().crossVectors(v, h).divideScalar(mu).sub(r.clone().divideScalar(rm));
  let e = evec.length();
  const P = e > 1e-7 ? evec.clone().divideScalar(e) : r.clone().divideScalar(rm);
  const Q = new Vector3().crossVectors(W, P);
  const energy = v.lengthSq() / 2 - mu / rm;
  if (Math.abs(1 - e) < 1e-9) e = 1 + 1e-9; // dodge the exactly-parabolic case
  const hyper = e > 1;
  const a = hyper ? -mu / (2 * energy) : mu / (-2 * energy); // a<0 for hyperbola
  const nu = Math.atan2(r.dot(Q), r.dot(P));
  let M0, n;
  if (!hyper) {
    const E = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
    M0 = E - e * Math.sin(E);
    n = Math.sqrt(mu / (a * a * a));
  } else {
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    M0 = e * Math.sinh(F) - F;
    n = Math.sqrt(mu / (-a * a * a));
  }
  const rp = hyper ? -a * (e - 1) : a * (1 - e);
  const ra = hyper ? Infinity : a * (1 + e);
  return {
    mu, a, e, P, Q, W, n, M0, t0, hyper, rp, ra,
    period: hyper ? Infinity : TAU / n,
    h: hm,
  };
}

function solveE(M, e) {
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 40; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}
function solveF(M, e) {
  let F = Math.asinh(M / e);
  if (Math.abs(M) > 5) F = Math.sign(M) * Math.log(2 * Math.abs(M) / e + 1.8);
  for (let i = 0; i < 60; i++) {
    const d = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1);
    F -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return F;
}

/** unwrapped eccentric/hyperbolic anomaly at time t */
export function anomalyAt(el, t) {
  const M = el.M0 + el.n * (t - el.t0);
  if (!el.hyper) {
    const Mw = wrapPi(M);
    return solveE(Mw, el.e) + (M - Mw);
  }
  return solveF(M, el.e);
}

/** state at an (unwrapped) anomaly X. out = {r, v} optional */
export function stateFromAnomaly(el, X, out = { r: new Vector3(), v: new Vector3() }) {
  const { a, e, P, Q, n } = el;
  let x, y, vx, vy;
  if (!el.hyper) {
    const sE = Math.sin(X), cE = Math.cos(X), sq = Math.sqrt(1 - e * e);
    const rd = a * (1 - e * cE);
    x = a * (cE - e); y = a * sq * sE;
    vx = -(n * a * a / rd) * sE; vy = (n * a * a * sq / rd) * cE;
  } else {
    const A = -a, sh = Math.sinh(X), ch = Math.cosh(X), sq = Math.sqrt(e * e - 1);
    const dF = n / (e * ch - 1);
    x = A * (e - ch); y = A * sq * sh;
    vx = -A * sh * dF; vy = A * sq * ch * dF;
  }
  out.r.copy(P).multiplyScalar(x).addScaledVector(Q, y);
  out.v.copy(P).multiplyScalar(vx).addScaledVector(Q, vy);
  return out;
}

export function stateAt(el, t, out) {
  return stateFromAnomaly(el, anomalyAt(el, t), out);
}

export function radiusAtAnomaly(el, X) {
  return el.hyper ? -el.a * (el.e * Math.cosh(X) - 1) : el.a * (1 - el.e * Math.cos(X));
}

/** next time >= t of periapsis (may be < t for hyperbolic orbits already past it) */
export function nextPeriapsisTime(el, t) {
  const M = el.M0 + el.n * (t - el.t0);
  if (el.hyper) return el.t0 - el.M0 / el.n;
  return t + (TAU * Math.ceil(M / TAU) - M) / el.n;
}
export function nextApoapsisTime(el, t) {
  if (el.hyper) return Infinity;
  const M = el.M0 + el.n * (t - el.t0);
  const k = Math.ceil((M - Math.PI) / TAU);
  return t + (Math.PI + TAU * k - M) / el.n;
}

/** points of the conic between two times (<= one revolution), uniform in anomaly */
export function sampleConic(el, t0, t1, count, rLimit = Infinity) {
  let X0 = anomalyAt(el, t0);
  let X1 = anomalyAt(el, t1);
  if (!el.hyper && X1 - X0 > TAU) X1 = X0 + TAU;
  if (el.hyper) {
    // clip to radius limit
    const cosh = (rLimit / -el.a + 1) / el.e;
    if (cosh >= 1) { const Fm = Math.acosh(cosh); X0 = Math.max(X0, -Fm); X1 = Math.min(X1, Fm); }
  }
  const pts = [];
  for (let i = 0; i <= count; i++) pts.push(stateFromAnomaly(el, X0 + (X1 - X0) * (i / count)).r);
  return pts;
}

export const circularSpeed = (mu, r) => Math.sqrt(mu / r);

/** construct circular orbit elements around a body: radius r, phase angle (rad), prograde (+Z normal) */
export function circularElements(mu, r, phase, t0 = 0, retro = false) {
  const pos = new Vector3(Math.cos(phase) * r, Math.sin(phase) * r, 0);
  const s = Math.sqrt(mu / r) * (retro ? -1 : 1);
  const vel = new Vector3(-Math.sin(phase) * s, Math.cos(phase) * s, 0);
  return elementsFromState(mu, pos, vel, t0);
}
