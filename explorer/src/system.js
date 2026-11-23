// Patched-conic mechanics for the whole Halcyon system: bodies on rails (Keplerian, coplanar), spheres of influence
// for every planet / giant / moon, conic-to-conic prediction across SOI transitions with chained maneuver nodes.
// Adapted from the prototype's world.js (findEvent / predict) and generalised to a three-level hierarchy.
// Frame: ecliptic = XZ plane, +Y north, orbits counter-clockwise seen from +Y. All SI units.
import { Vector3 } from 'three';
import { SUN, BODIES } from './destinations.js';
import { elementsFromState, stateAt, nodeDvVector, nextPeriapsisTime } from './orbits.js';

export const ROOT = 'halcyon';
const ZERO = new Vector3();

export function circularState(mu, r, phase, out = { r: new Vector3(), v: new Vector3() }) {
  const s = Math.sqrt(mu / r);
  out.r.set(Math.cos(phase) * r, 0, -Math.sin(phase) * r);
  out.v.set(-Math.sin(phase) * s, 0, -Math.cos(phase) * s);
  return out;
}
export const circularElements = (mu, r, phase, t0 = 0) => { const s = circularState(mu, r, phase); return elementsFromState(mu, s.r, s.v, t0); };

// ---- build the tree
for (const b of Object.values(BODIES)) b.children = [];
export const muOf = (id) => (id === ROOT ? SUN.mu : BODIES[id].mu);
for (const b of Object.values(BODIES)) {
  const par = b.parent === ROOT ? null : BODIES[b.parent];
  if (par) par.children.push(b.id);
  const pmu = muOf(b.parent);
  b.orbit = circularElements(pmu, b.a, b.phase0, 0);
  b.soi = b.a * Math.pow(b.mu / pmu, 0.4);
}
export const SUN_NODE = { id: ROOT, name: SUN.name, mu: SUN.mu, R: SUN.radius, soi: Infinity, children: Object.values(BODIES).filter((b) => b.parent === ROOT).map((b) => b.id), kind: 'star' };
export const frame = (id) => (id === ROOT ? SUN_NODE : BODIES[id]);
export const soiOf = (id) => (id === ROOT ? Infinity : BODIES[id].soi);
export const parentId = (id) => (id === ROOT ? null : BODIES[id].parent);
export function lineage(id) { const out = []; let c = id; while (c) { out.push(c); c = parentId(c); } return out; }

const _t = { r: new Vector3(), v: new Vector3() };
/** state of body `id` relative to its parent at time t */
export function bodyRel(id, t, out = { r: new Vector3(), v: new Vector3() }) {
  if (id === ROOT) { out.r.set(0, 0, 0); out.v.set(0, 0, 0); return out; }
  return stateAt(BODIES[id].orbit, t, out);
}
/** heliocentric state of body `id` */
export function bodyAbs(id, t, out = { r: new Vector3(), v: new Vector3() }) {
  out.r.set(0, 0, 0); out.v.set(0, 0, 0);
  let c = id;
  while (c && c !== ROOT) { bodyRel(c, t, _t); out.r.add(_t.r); out.v.add(_t.v); c = BODIES[c].parent; }
  return out;
}
/** state of `id` expressed relative to frame body `fid` */
export function bodyIn(id, fid, t, out = { r: new Vector3(), v: new Vector3() }) {
  const a = bodyAbs(id, t, out); const b = bodyAbs(fid, t, _f2);
  out.r.sub(b.r); out.v.sub(b.v); return out;
}
const _f2 = { r: new Vector3(), v: new Vector3() };

/** next patch event for conic `el` in frame `bodyId`: impact / exit / enter (child) / escape */
export function findEvent(bodyId, el, t0, off = 0, maxT = 4e8) {
  const B = frame(bodyId);
  const touchR = (B.R || 0) + off;
  const kids = B.children.map((id) => BODIES[id]).filter((m) => el.rp < m.a + m.soi && el.ra > m.a - m.soi);
  const canImpact = bodyId !== ROOT && el.rp < touchR;
  const canExit = bodyId !== ROOT && (el.hyper || el.ra > B.soi);
  if (!canImpact && !canExit && !kids.length) return { type: 'none', t: Infinity };
  const slowest = Math.min(...kids.map((m) => 2 * Math.PI / Math.sqrt(m.parent === ROOT ? SUN.mu / (m.a ** 3) : BODIES[m.parent].mu / (m.a ** 3))), 1e30);
  const horizon = el.hyper ? maxT : Math.min(maxT, el.period * (kids.length ? 3.2 : 1.02));
  const tEnd = t0 + horizon;
  const s = { r: new Vector3(), v: new Vector3() }, ms = { r: new Vector3(), v: new Vector3() }, dist = new Vector3();
  let hitBody = null;
  const test = (t) => {
    stateAt(el, t, s);
    const rm = s.r.length();
    if (canImpact && rm <= touchR) return 'impact';
    for (const m of kids) { stateAt(m.orbit, t, ms); if (dist.copy(s.r).sub(ms.r).length() <= m.soi) { hitBody = m.id; return 'enter'; } }
    if (canExit && rm >= B.soi) return 'exit';
    return null;
  };
  let t = t0, hit = test(t);
  if (hit) return { type: hit, t, body: hit === 'enter' ? hitBody : null };
  let guard = 0;
  while (t < tEnd && guard++ < 90000) {
    stateAt(el, t, s);
    const rm = s.r.length(), vm = s.v.length();
    let dmin = Infinity, vmoon = 0;
    if (canImpact) dmin = Math.min(dmin, Math.abs(rm - touchR));
    if (canExit) dmin = Math.min(dmin, Math.abs(B.soi - rm));
    for (const m of kids) { stateAt(m.orbit, t, ms); dmin = Math.min(dmin, Math.abs(dist.copy(s.r).sub(ms.r).length() - m.soi)); vmoon = Math.max(vmoon, ms.v.length()); }
    let step = Math.min(0.03 * rm / (vm + 1), 0.5 * dmin / (vm + vmoon + 1));
    step = Math.max(0.05, Math.min(5e6, step));
    const tn = Math.min(t + step, tEnd);
    if (test(tn)) {
      let lo = t, hi = tn;
      for (let i = 0; i < 46; i++) { const mid = (lo + hi) / 2; if (test(mid)) hi = mid; else lo = mid; }
      const type = test(hi);
      return { type, t: hi, body: type === 'enter' ? hitBody : null };
    }
    t = tn;
  }
  return { type: 'none', t: Infinity };
}

/** convert a state between frames at an SOI boundary */
export function crossEnter(r, v, childId, t) { const c = bodyRel(childId, t, _t); return { r: r.clone().sub(_t.r), v: v.clone().sub(_t.v) }; }
export function crossExit(r, v, fromId, t) { const c = bodyRel(fromId, t, _t); return { r: r.clone().add(_t.r), v: v.clone().add(_t.v) }; }

/** Chain of conic patches. `nodes` = ordered maneuver nodes [{t, dv:{pro,nrm,rad}}], each applied in whichever
 *  frame the craft occupies at node time. patch = {bodyId, el, t0, t1, type, body, node, startNode}. */
export function predict(state, t, nodes = [], opts = {}) {
  const { maxPatches = 12, off = 0, maxT = 4e8 } = opts;
  const out = [];
  let bodyId = state.body, el = state.el || elementsFromState(muOf(bodyId), state.r, state.v, t);
  let now = t, ni = 0;
  while (ni < nodes.length && nodes[ni].t <= now) ni++;
  const s = { r: new Vector3(), v: new Vector3() }, dvv = new Vector3();
  for (let k = 0; k < maxPatches + nodes.length; k++) {
    const ev = findEvent(bodyId, el, now, off, maxT);
    const nd = ni < nodes.length ? nodes[ni] : null;
    if (nd && (ev.type === 'none' || ev.t > nd.t)) {
      out.push({ bodyId, el, t0: now, t1: nd.t, type: 'node', node: nd });
      nodeDvVector(el, nd, dvv, s);
      el = elementsFromState(muOf(bodyId), s.r.clone(), s.v.clone().add(dvv), nd.t);
      now = nd.t; ni++;
      continue;
    }
    const t1 = ev.type === 'none' ? (el.hyper ? now + 1e7 : now + el.period) : ev.t;
    const patch = { bodyId, el, t0: now, t1, type: ev.type, body: ev.body };
    out.push(patch);
    if (ev.type === 'enter' || ev.type === 'exit') {
      stateAt(el, ev.t, s);
      let r, v;
      if (ev.type === 'enter') { const c = crossEnter(s.r, s.v, ev.body, ev.t); r = c.r; v = c.v; bodyId = ev.body; }
      else { const c = crossExit(s.r, s.v, bodyId, ev.t); r = c.r; v = c.v; bodyId = parentId(bodyId); }
      el = elementsFromState(muOf(bodyId), r, v, ev.t);
      now = ev.t;
    } else break;
  }
  return out;
}

/** position of the craft in frame `fid` at time t on a patch chain (null outside) */
export function chainStateIn(patches, fid, t, out = { r: new Vector3(), v: new Vector3() }) {
  for (const p of patches) {
    if (t >= p.t0 && t <= p.t1) {
      stateAt(p.el, t, out);
      // express in frame fid: ship abs = body abs + rel; then subtract fid abs
      const b = bodyAbs(p.bodyId, t, _ab);
      out.r.add(b.r); out.v.add(b.v);
      const f = bodyAbs(fid, t, _ab);
      out.r.sub(f.r); out.v.sub(f.v);
      return out;
    }
  }
  return null;
}
const _ab = { r: new Vector3(), v: new Vector3() };

/** closest approach between the chain and a body (any frame); returns {t, d, rel} */
export function closestApproach(patches, bodyId, n = 600) {
  let best = { d: Infinity, t: 0 };
  const s = { r: new Vector3(), v: new Vector3() }, b = { r: new Vector3(), v: new Vector3() };
  for (const p of patches) {
    if (!isFinite(p.t1)) continue;
    const span = p.t1 - p.t0; if (span <= 0) continue;
    for (let i = 0; i <= n; i++) {
      const t = p.t0 + span * i / n;
      stateAt(p.el, t, s);
      const ab = bodyAbs(p.bodyId, t, _ab); s.r.add(ab.r);
      bodyAbs(bodyId, t, b);
      const d = s.r.distanceTo(b.r);
      if (d < best.d) best = { d, t, patch: p };
    }
  }
  return best;
}

// ---------------------------------------------------------------- Lambert (universal variables, prograde = +Y angular momentum)
function stumpC(z) { if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z; if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z; return 0.5 - z / 24; }
function stumpS(z) { if (z > 1e-6) { const q = Math.sqrt(z); return (q - Math.sin(q)) / (q * q * q); } if (z < -1e-6) { const q = Math.sqrt(-z); return (Math.sinh(q) - q) / (q * q * q); } return 1 / 6 - z / 120; }
export function lambert(mu, r1v, r2v, tof) {
  const r1 = r1v.length(), r2 = r2v.length();
  const cosd = Math.max(-1, Math.min(1, r1v.dot(r2v) / (r1 * r2)));
  let dnu = Math.acos(cosd);
  const cy = r1v.z * r2v.x - r1v.x * r2v.z; // (r1 x r2).y
  if (cy < 0) dnu = 2 * Math.PI - dnu;
  const A = Math.sin(dnu) * Math.sqrt(r1 * r2 / (1 - cosd));
  if (!isFinite(A) || Math.abs(A) < 1e-9) return null;
  const yOf = (z) => r1 + r2 + A * (z * stumpS(z) - 1) / Math.sqrt(stumpC(z));
  const F = (z) => { const y = yOf(z); if (y < 0) return -1e30; return Math.pow(y / stumpC(z), 1.5) * stumpS(z) + A * Math.sqrt(y) - Math.sqrt(mu) * tof; };
  let lo = -4 * Math.PI * Math.PI * 4, hi = 4 * Math.PI * Math.PI - 1e-3;
  while (yOf(lo) < 0 && lo < hi) lo += 1;  // keep y > 0
  if (F(hi) < 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (F(mid) < 0) lo = mid; else hi = mid; if (hi - lo < 1e-10) break; }
  const z = (lo + hi) / 2, y = yOf(z);
  if (!(y > 0)) return null;
  const f = 1 - y / r1, g = A * Math.sqrt(y / mu), gd = 1 - y / r2;
  const v1 = r2v.clone().addScaledVector(r1v, -f).divideScalar(g);
  const v2 = r2v.clone().multiplyScalar(gd).sub(r1v).divideScalar(g);
  return { v1, v2 };
}
export { elementsFromState, stateAt, nodeDvVector, nextPeriapsisTime };
