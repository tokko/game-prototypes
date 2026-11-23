// Prospector rover drive + ground survey. Compact on purpose: a kinematic six-wheel vehicle (heavy, slow, torquey) whose body follows the terrain through the
// six wheel_N contact points (least-squares ground plane), with grip / lava / water / obstacle handling and a gentle tip-over + self-right.
// The vessel is the 'lander' (kind) vessel; its surf.p stays the tail-pad reference point and the rover centre is REACH metres ahead along the heading.
// Heritage: prototype Pell rover (_drive / drilling / site search), bike.js (grip, reset).
import * as THREE from 'three';
import { LANDER } from './craft.js';
import { orientationFor } from './flight.js';
import { P_WHEELS, P_WHEEL_R } from './glbmodels.js';
import { sampleAt } from './discovery.js';
import { simplex2 } from './noise.js';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const REACH = 4.8;                 // pad reference to rover centre
const TIP_LIMIT = 0.63;                   // ground tilt (rad, about 36 degrees) beyond which the rover rolls over
const _n = new V3(), _q = new THREE.Quaternion(), _z = new V3(0, 0, 1), _qr = new THREE.Quaternion();
export const roverCenter = (v, out = new V3()) => { const rv = v.rv; return out.set(rv.cx, rv.cy, rv.cz); };

/** switch a landed, fully tipped Prospector to rover control (centre ahead of the pad reference) */
export function roverInit(v, env) {
  const s = v.surf, h = s.heading;
  const cx = s.p.x + Math.sin(h) * REACH, cz = s.p.z - Math.cos(h) * REACH;
  v.rv = { cx, cz, cy: env.h(cx, cz), speed: 0, vlat: 0, yawRate: 0, steer: 0, spin: 0, n: new V3(0, 1, 0), flip: 0, flipT: 0, flipDir: 1, wet: 0, tilt: 0, slip: 0, bump: 0,
    survey: null, surveyT: 99, lastMsg: '', clearance: 0 };
  return v.rv;
}
const wheelPoint = (rv, h, i, out) => {            // world xz of wheel i (rover frame: x right, z aft)
  const [lx, lz] = P_WHEELS[i]; const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  return out.set(rv.cx + rx * lx - fx * lz, 0, rv.cz + rz * lx - fz * lz);
};
/** ground plane under the six wheels: returns {cy (height at the centre), a (slope across), b (slope along aft), tilt} */
function groundFit(rv, h, env) {
  let sy = 0, sxy = 0, szy = 0, sxx = 0, szz = 0; const p = new V3();
  for (let i = 0; i < 6; i++) { wheelPoint(rv, h, i, p); const y = env.h(p.x, p.z); const [lx, lz] = P_WHEELS[i]; sy += y; sxy += lx * y; szy += lz * y; sxx += lx * lx; szz += lz * lz; }
  const a = sxy / sxx, b = szy / szz, cy = sy / 6;
  return { cy, a, b, tilt: Math.atan(Math.hypot(a, b)) };
}

/** one drive step. ctl: {fwd (-1..1), steer (-1..1), brake}. env: surfEnv(). Returns nothing; events go to v.surf.events */
export function roverStep(v, ctl, dt, env) {
  const s = v.surf, rv = v.rv; s.events.length = 0;
  const g = env.g, h = s.heading;
  const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
  const gf = groundFit(rv, h, env);
  // ---- attitude from the wheel plane (heavy: slow follow); body height follows the plane
  _n.set(-gf.a * rx + gf.b * fx, 1, -gf.a * rz + gf.b * fz).normalize();      // a: dy per metre to the right, b: dy per metre aft (aft = -forward)
  rv.n.lerp(_n, Math.min(1, dt * 5)).normalize(); rv.tilt = gf.tilt;
  const dyTarget = gf.cy; rv.bump = (dyTarget - rv.cy);
  rv.cy += (dyTarget - rv.cy) * Math.min(1, dt * 10);
  // ---- tip-over / self-right
  if (rv.flipT > 0.5 || (gf.tilt > TIP_LIMIT && !rv.flipT)) { if (!rv.flipT) { rv.flipT = 1; rv.flipDir = (gf.a * rx > 0 ? -1 : 1); rv.speed = 0; s.events.push('rolled'); } }
  rv.flip += ((rv.flipT ? 1 : 0) - rv.flip) * Math.min(1, dt * 2.6);
  if (rv.flipT) { rv.speed *= Math.pow(0.05, dt); ctl = { fwd: 0, steer: 0, brake: 1 }; }
  // ---- drive
  const grip = clamp(env.gripAt ? env.gripAt(rv.cx, rv.cz) : 1, 0.08, 1.2);
  const battOk = v.sysBatt > 0.05;
  const vmax = LANDER.driveMax * (battOk ? 1 : 0.15) * (1 - 0.25 * (1 - grip));
  let tv = ctl.fwd > 0 ? ctl.fwd * vmax : ctl.fwd * vmax * 0.35;
  // along-heading ground gradient: dh per metre in the forward direction (height rises forward when positive)
  const dhds = -(gf.b);                                     // b is dy per metre aft, so forward gradient is -b
  const slopeA = -g * dhds / Math.sqrt(1 + dhds * dhds);    // gravity component along the heading
  let sp = rv.speed;
  const acc = LANDER.driveAccel * grip * (1 - 0.55 * clamp(sp / LANDER.driveMax, 0, 1));
  if (tv > sp + 0.01) sp += Math.min(acc * dt, tv - sp); else if (tv < sp - 0.01) sp -= Math.min((ctl.brake ? 4.5 : 1.6 + 0.8 * Math.abs(ctl.fwd)) * grip * dt + 0.25 * dt, sp - tv);
  if (Math.abs(ctl.fwd) < 0.05 && !ctl.brake) sp -= Math.sign(sp) * Math.min(Math.abs(sp), 0.5 * dt);      // coasting: rolling resistance
  if (ctl.brake && Math.abs(ctl.fwd) < 0.05) sp -= Math.sign(sp) * Math.min(Math.abs(sp), 5.5 * grip * dt);
  sp += slopeA * dt * (Math.abs(ctl.fwd) > 0.05 ? 0.55 : 1);                          // the drive motors fight most of the slope
  sp = clamp(sp, -vmax * 0.4, vmax * 1.05);
  // steering: skid-steered, heavy; limited so that the lateral acceleration stays inside what the track width allows
  const yawCap = 0.55 / (1 + Math.abs(sp) * 0.045), latCap = 0.75 * g / Math.max(Math.abs(sp), 1);
  const wantYaw = ctl.steer * Math.min(yawCap, latCap) * (Math.abs(sp) < 0.4 && Math.abs(ctl.fwd) < 0.05 ? 0.5 : 1) * (sp < -0.1 ? -1 : 1);
  rv.yawRate += (wantYaw - rv.yawRate) * Math.min(1, dt * 2.2 * (0.4 + 0.6 * grip));
  s.heading += rv.yawRate * dt;
  // lateral slip on loose / icy ground: the velocity lags the heading
  const hn = s.heading, fx2 = Math.sin(hn), fz2 = -Math.cos(hn), rx2 = Math.cos(hn), rz2 = Math.sin(hn);
  rv.vlat += -rv.yawRate * sp * (1 - Math.min(1, grip)) * 0.9 * dt;
  rv.vlat *= Math.exp(-dt * (7 * grip));
  const vx = fx2 * sp + rx2 * rv.vlat, vz = fz2 * sp + rz2 * rv.vlat;
  // move with blocking: water, lava, boulders / spires
  let nx = rv.cx + vx * dt, nz = rv.cz + vz * dt;
  const wd = env.waterDepth ? env.waterDepth(nx, nz) : 0;
  const lava = !!env.heatAt;
  rv.wet = wd;
  if (wd > (lava ? 0.2 : 1.1)) { sp = -sp * 0.2; rv.vlat = 0; nx = rv.cx; nz = rv.cz; s.events.push(lava ? 'lava' : 'deepwater'); }
  if (env.scatter) {
    const c = env.scatter.collide(nx, nz, rv.cy - env.h(nx, nz) + 1.2, 2.7);
    if (c.hit) { nx += c.px; nz += c.pz; if (Math.abs(sp) > 3) s.events.push('bump'); sp *= 0.3; }
  }
  rv.cx = nx; rv.cz = nz; rv.speed = sp;
  rv.spin += sp * dt / P_WHEEL_R;
  // reference point + bookkeeping
  s.p.x = rv.cx - fx2 * REACH; s.p.z = rv.cz - fz2 * REACH; s.p.y = env.h(s.p.x, s.p.z);
  s.vel.set(vx, 0, vz); s.hspeed = Math.hypot(vx, vz); s.vspeed = 0; s.alt = 0; s.thrustFrac = 0; v.throttle = 0; s.landed = true;
  // orientation: ground plane up vector, heading; rollover about the forward axis
  orientationFor(rv.n, s.heading, s.q);
  if (rv.flip > 0.001) { _qr.setFromAxisAngle(_z, rv.flipDir * rv.flip * Math.PI); s.q.multiply(_qr); }
  rv.clearance = 3.1 * Math.sin(rv.flip * Math.PI / 2);
  return s;
}
/** self-right: roll back and move to the nearest gentle ground if the spot is too steep */
export function roverRight(v, env) {
  const rv = v.rv, s = v.surf; if (!rv.flipT) return false;
  let best = null;
  const tilt = (x, z) => { const gf = groundFit({ cx: x, cz: z }, s.heading, env); return gf.tilt; };
  if (tilt(rv.cx, rv.cz) > 0.4) for (let r = 8; r <= 90 && !best; r += 8) for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, x = rv.cx + Math.cos(a) * r, z = rv.cz + Math.sin(a) * r; if (tilt(x, z) < 0.3 && env.waterDepth(x, z) < 0.1) { best = [x, z]; break; } }
  if (best) { rv.cx = best[0]; rv.cz = best[1]; }
  rv.flipT = 0; rv.speed = 0; rv.vlat = 0; rv.yawRate = 0;
  return true;
}

// ------------------------------------------------------------------ ground survey (sensor mast): richness map, gradient search, drill yield
/** 0..1 richness of the ground at true plane coordinates (x, z): water / ice / volatile content that a drill would find */
export function richnessAt(rc, x, z) {
  const m = rc.materialAt(x, z, 0.1, [0, 0, 0, 0]);
  let s;
  if (rc.waterSurface && !rc.heatAt && rc.riverDistance) { const d = rc.riverDistance(x, z); s = 1 - sstep(0, 260, d); }       // lush worlds: water table follows the rivers
  else s = clamp(m[1], 0, 1);                                                                                     // ice / volatile channel of the recipe
  const n = 0.6 * simplex2(x / 420 + 3.1, z / 420 - 1.7) + 0.4 * simplex2(x / 130 + 9.4, z / 130 + 2.2);      // regolith volatile content varies everywhere: there is always a better spot to find
  return clamp(0.2 + 0.8 * s + 0.27 * n, 0.02, 1);
}
const DIRS = 12;
/** refresh the survey readout (throttled by the caller): richness here, the richest of a ring of probes, and its bearing relative to the heading */
export function surveyUpdate(v, rc, ox, oz) {
  const rv = v.rv, s = v.surf; const x = rv.cx + ox, z = rv.cz + oz;
  const here = richnessAt(rc, x, z);
  let best = here, bd = 0, bk = -1;
  for (const R of [60, 140, 300, 600]) for (let k = 0; k < DIRS; k++) {
    const a = k / DIRS * Math.PI * 2, px = x + Math.sin(a) * R, pz = z - Math.cos(a) * R;     // a: compass bearing (0 = north / -z)
    const r = richnessAt(rc, px, pz) - 0.0006 * R;                                         // slight preference for nearer ground
    if (r > best + 0.02) { best = r; bd = R; bk = a; }
  }
  const smp = sampleAt(rc, ox, oz, rv.cx, rv.cz);
  const rel = bk < 0 ? null : Math.atan2(Math.sin(bk - s.heading), Math.cos(bk - s.heading));       // + clockwise from the nose
  rv.survey = { here, best: bk < 0 ? here : best + 0.0006 * bd, dist: bd, rel, bearing: bk, kind: smp.kind, amount: smp.amount };
  rv.surveyT = 0;
  return rv.survey;
}
/** drill yield (kg) at a spot of known richness */
export const drillYield = (smp, richness) => Math.round(smp.amount * (1 + 3.5 * richness));
