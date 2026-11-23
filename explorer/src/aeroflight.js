// Winged flight for the Albatross inside a surface scene on worlds with an atmosphere: lift / drag from aero.js, jet thrust
// that falls with density and rams up with speed, a rocket switch for the climb, wheeled taxi / takeoff / landing on the
// terrain (with the real wheel + tail contact points), stability assist, and three autopilots (runway landing with a
// glide slope, automatic takeoff, and the climb to the orbit hand-over).
//
// Conventions: s.q is the flat-stance group orientation (nose = -Z, up = +Y, right = +X); s.p is the centre of mass.
import * as THREE from 'three';
import { wingCoeffs, jetThrustFactor, thermalStep } from './aero.js';
import { PLANE } from './craft.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const ASCENT = { zoomGamma: 0.8 };
export const COM_FLAT = new V3(0, 2.6, -8.9);              // COM in the group frame of the flat stance (model COM (0,2.6,1) minus the 9.9 m pad offset)
const WHEELS = [new V3(0, -2.6, -6.0), new V3(-3.2, -2.6, 1.7), new V3(3.2, -2.6, 1.7)];     // nose, left main, right main bottoms relative to the COM
const TAIL = new V3(0, -1.5, 7.4);
const S_LIFT = 62, S_DRAG = 26, CD0 = 0.022;
const _fwd = new V3(), _up = new V3(), _right = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _q = new Q(), _m = new THREE.Matrix4();
const AX = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, -1) };
function rot(q, axis, ang) { q.multiply(_q.setFromAxisAngle(axis, ang)); }
export function basis(q) { _fwd.set(0, 0, -1).applyQuaternion(q); _up.set(0, 1, 0).applyQuaternion(q); _right.set(1, 0, 0).applyQuaternion(q); }

/** orientation from a forward direction (any) and an up reference */
export function quatFromFwdUp(fwd, up, out = new Q()) {
  const back = _a.copy(fwd).negate().normalize(); const right = _b.crossVectors(up, back).normalize(); const u = _c.crossVectors(back, right);
  _m.makeBasis(right, u, back); return out.setFromRotationMatrix(_m);
}
export function initAero(v, s, env) {
  s.aero = true; s.onGround = true; s.gear = 1; s.pitchG = 0; s.ap = null; s.assist = true; s.apPhase = 0; s.stall = false; s.g = 1; s.aoa = 0; s.mach = 0; s.throttle = 0; s.thrustFrac = 0;
  v.tip = 1; v.tipT = 1; v.stance = 'flat'; v.depT.legs = 0;
}

/** one physics step. ctl: {fwd, strafe, yaw, climb(dthr), full, cut}. env: terrain + atmosphere + runway */
export function stepAero(v, ctl, dt, env) {
  const s = v.surf; s.events.length = 0;
  const rho = env.rhoAt ? env.rhoAt(Math.max(0, s.p.y)) : 0;
  const sp = s.vel.length(), mach = sp / 320;
  const f = thermalStep(v, rho, sp, dt); if (env.world && env.world.entryEffects) env.world.entryEffects(v, rho, sp, f);
  basis(s.q); const fwd = _fwd.clone(), up = _up.clone(), right = _right.clone();
  const gnd = env.h(s.p.x, s.p.z), agl = s.p.y - gnd, mass = v.mass(env.world);
  const vh = Math.hypot(s.vel.x, s.vel.z);
  const gEff = env.g - vh * vh / (env.R + Math.max(0, s.p.y));
  // ---- inputs (pilot or autopilot)
  let pitchIn = -ctl.fwd * -1, rollIn = ctl.strafe, yawIn = ctl.yaw, brake = ctl.climb < -0.5 && s.onGround ? 1 : 0;
  pitchIn = -ctl.fwd;                      // S (ctl.fwd = -1) pulls the nose up, W pushes it over
  let thrCmd = s.throttle;
  if (ctl.full) thrCmd = 1; if (ctl.cut) thrCmd = 0;
  thrCmd = clamp(thrCmd + ctl.dthr * dt * 0.45, 0, 1);
  let rocket = false, airbrakeIn = (ctl.climb < -0.5 && !s.onGround) ? 1 : 0;
  if (s.ap) { const r = autopilot(v, s, env, { sp, mach, agl, fwd, right, up, gnd, mass, rho }, dt); pitchIn = r.pitch; rollIn = r.roll; yawIn = r.yaw; thrCmd = r.thr; brake = r.brake; rocket = r.rocket; airbrakeIn = r.airbrake || 0; if (r.off) s.ap = null; }
  s.throttle = thrCmd; s.airbrake = (s.airbrake || 0) + (airbrakeIn - (s.airbrake || 0)) * Math.min(1, dt * 1.5);
  // ---- airflow in the body frame
  const vF = s.vel.dot(fwd), vU = s.vel.dot(up), vR = s.vel.dot(right);
  const alpha = sp > 6 ? Math.atan2(-vU, Math.max(vF, 0.5)) : 0, beta = sp > 6 ? Math.atan2(vR, Math.max(vF, 0.5)) : 0;
  s.aoa = alpha; s.mach = mach; s.alt = Math.max(0, agl - 2.6); s.vspeed = s.vel.y; s.hspeed = vh;
  const qd = 0.5 * rho * sp * sp, auth = clamp(qd / 380, 0.12, 1);
  // ---- engine
  const env2 = { rho, mach, ap: rocket || (v.mode === 'rocket') };
  const eng = v.engine(env2);
  let thr = v.hasProp(eng) ? thrCmd : 0;
  let thrust = eng.thrust * thr; if (eng.id === 'jet') thrust *= 1 + 0.5 * clamp(mach, 0, 3);
  s.thrustFrac = thr; v.throttle = thr; s.engine = eng.id;
  if (thr > 0) v.consume(eng, v.mdot(eng, thr) * dt);
  // ---- aerodynamics
  const wc = wingCoeffs(alpha); s.stall = wc.stalled && sp > 25;
  const cl = clamp(wc.cl, -0.9, 1.15) * (wc.stalled ? 0.55 : 1), cdT = CD0 + (wc.cd - 0.04) * 0.9 + 0.35 * s.gear * (s.gear > 0.05 ? 0.12 : 0) + 0.55 * s.airbrake;
  const L = qd * S_LIFT * cl, D = qd * S_DRAG * cdT;
  const vhat = sp > 0.5 ? _a.copy(s.vel).divideScalar(sp) : _a.copy(fwd);
  const dirL = _b.copy(up).addScaledVector(vhat, -up.dot(vhat)); if (dirL.lengthSq() > 1e-6) dirL.normalize();
  const acc = new V3().addScaledVector(fwd, thrust / mass).addScaledVector(dirL, L / mass).addScaledVector(vhat, -D / mass);
  acc.y -= gEff;
  s.g = 1 + (L / mass) / Math.max(0.3, env.g);                    // load factor in local g (low-g world: this is large, so scale for HUD)
  s.gLoad = Math.hypot(L, 0) / (mass * 9.81);
  // wheel brakes / rolling friction when rolling on the ground
  if (s.onGround) {
    const hs = Math.hypot(s.vel.x, s.vel.z);
    const dec = (brake ? (hs > 30 ? 4.6 : 3.6) : 0.16);
    if (hs > 0.05) { const k = Math.min(dec * dt, hs) / hs; acc.x -= s.vel.x * k / dt; acc.z -= s.vel.z * k / dt; }
  }
  s.vel.addScaledVector(acc, dt);
  // ---- attitude
  if (!s.onGround) {
    const aT = 0.065;
    if (s.assist) {
      let acmd = aT + pitchIn * 0.2;
      if (s.stall) acmd = 0.05;
      const arate = clamp((acmd - alpha) * 2.4, -1.0, 1.0) * auth;
      rot(s.q, AX.x, arate * dt - 0 * 1);
      const phi = Math.atan2(-right.y, up.y), cmd = rollIn * 1.0;
      rot(s.q, AX.z, clamp((cmd - phi) * 2.6, -1.5, 1.5) * clamp(auth + 0.15, 0.2, 1) * dt);
    } else {
      rot(s.q, AX.x, pitchIn * 0.9 * auth * dt); rot(s.q, AX.z, rollIn * 1.4 * auth * dt);
    }
    rot(s.q, AX.y, -(beta * 2.2 * auth + yawIn * 0.35 * auth) * dt);        // weathervane + rudder
    s.q.normalize();
  }
  s.p.addScaledVector(s.vel, dt);
  // ---- gear: down for landing / near the ground, up in cruise
  const gearWant = s.onGround || (agl < 260 && sp < 120) || s.ap === 'aeroland' ? 1 : 0;
  s.gear += clamp(gearWant - s.gear, -dt * 0.45, dt * 0.45);
  basis(s.q); s.heading = Math.atan2(_fwd.x, -_fwd.z);
  contactAero(v, s, env, dt, { pitchIn, yawIn, rollIn, alpha });
  return s;
}

// ---------------------------------------------------------------- ground contact: wheels, tail strike, touchdown quality
function contactAero(v, s, env, dt, io) {
  const pts = WHEELS.map((w) => w.clone().applyQuaternion(s.q).add(s.p));
  const hs = pts.map((p) => env.h(p.x, p.z));
  let pen = -1e9, worst = 0;
  for (let i = 0; i < 3; i++) { const d = hs[i] - pts[i].y; if (d > pen) pen = d; }
  const tail = TAIL.clone().applyQuaternion(s.q).add(s.p), tailPen = env.h(tail.x, tail.z) - tail.y;
  const speedN = s.vel.length();
  // water / obstacle checks
  if (env.waterDepth) {
    const wd = env.waterDepth(s.p.x, s.p.z);
    if (wd > 0.3 && s.p.y - env.h(s.p.x, s.p.z) < 14) {
      if (!s.waterWarn) { s.waterWarn = 1; s.events.push('waterwarn'); }
      if (pen > -0.2 || s.p.y - hs[0] < 4) { s.events.push('water'); recover(v, s, env, 'water'); return; }
    } else s.waterWarn = 0;
  }
  if (env.scatter) { const c = env.scatter.collide(s.p.x, s.p.z, s.p.y - env.h(s.p.x, s.p.z), 5.5); if (c.hit && speedN > 6) { s.lastCrash = { why: 'obstacle', x: s.p.x, z: s.p.z, y: s.p.y }; s.events.push('crash'); recover(v, s, env, 'crash'); return; } }
  if (pen > 0 || tailPen > 0.3) {
    const vy = -s.vel.y, sink = Math.max(vy, 0);
    basis(s.q); const pitch = Math.asin(clamp(_fwd.y, -1, 1)), bank = Math.atan2(-_right.y, _up.y);
    if (!s.onGround) {
      // touchdown evaluation (forgiving)
      const ok = s.gear > 0.85 && sink < 5.5 && pitch > -0.07 && pitch < 0.3 && Math.abs(bank) < 0.22 && tailPen < 1.2;
      if (!ok) { s.lastCrash = { why: 'touchdown', gear: s.gear, sink, pitch, bank, tailPen, pen }; s.events.push(s.gear <= 0.85 ? 'gearup' : 'crash'); recover(v, s, env, 'crash'); return; }
      s.onGround = true; s.landSink = sink; s.events.push('landed'); s.pitchG = Math.max(pitch, 0);
    }
    if (pen > 0) s.p.y += pen;
    s.onGround = true;
    if (s.vel.y < 0) s.vel.y = 0;
    // fit attitude to the 3 wheel contact points; heading follows the velocity / steering
    const A = new V3(pts[0].x, hs[0], pts[0].z), B = new V3(pts[1].x, hs[1], pts[1].z), C = new V3(pts[2].x, hs[2], pts[2].z);
    const n = new V3().crossVectors(C.clone().sub(A), B.clone().sub(A)).normalize(); if (n.y < 0) n.negate();
    basis(s.q); const hdg0 = Math.atan2(_fwd.x, -_fwd.z);
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const steer = clamp(io.rollIn * 0.9 + io.yawIn, -1, 1);
    const hdg = hdg0 + steer * 0.5 * Math.min(1, (speed + 2) / 14) * dt * (speed > 0.5 || s.throttle > 0.05 ? 1 : 0.3);
    const fh = new V3(Math.sin(hdg), 0, -Math.cos(hdg));
    const pitchCmd = (speed > 24 ? clamp(io.pitchIn, -0.2, 1) * 0.22 : 0) * 1;      // rotate the nose up once there is speed
    s.pitchG += (pitchCmd - s.pitchG) * Math.min(1, dt * 1.6);
    const fwdG = fh.clone().addScaledVector(n, -fh.dot(n)).normalize();
    const right = new V3().crossVectors(fwdG, n).normalize();
    fwdG.multiplyScalar(Math.cos(s.pitchG)).addScaledVector(n, Math.sin(s.pitchG));
    const tq = quatFromFwdUp(fwdG, n, new Q());
    s.q.slerp(tq, Math.min(1, dt * 7)); s.q.normalize();
    // wheels grip: keep velocity along the heading
    const fd = new V3(Math.sin(hdg), 0, -Math.cos(hdg));
    const along = s.vel.x * fd.x + s.vel.z * fd.z;
    s.vel.x += (fd.x * along - s.vel.x) * Math.min(1, dt * 6); s.vel.z += (fd.z * along - s.vel.z) * Math.min(1, dt * 6);
    // liftoff: the wings carry the weight and the nose is up
    basis(s.q);
  } else if (s.onGround && pen < -0.35) {
    s.onGround = false; s.events.push('liftoff');
  }
  if (s.onGround && Math.hypot(s.vel.x, s.vel.z) < 0.15 && s.throttle < 0.02) { s.vel.set(0, 0, 0); }
  s.landed = s.onGround && Math.hypot(s.vel.x, s.vel.z) < 1.6;
}
function recover(v, s, env, why) {
  // forgiving reset: back to a level flight 250 m above the ground, a little damage; water and crash are told apart by the event
  basis(s.q); const hdg = Math.atan2(_fwd.x, -_fwd.z);
  const gh = env.h(s.p.x, s.p.z);
  s.p.y = Math.max(s.p.y, gh) + 260; s.vel.set(Math.sin(hdg) * 85, 0, -Math.cos(hdg) * 85);
  s.q.copy(quatFromFwdUp(new V3(Math.sin(hdg), 0, -Math.cos(hdg)), new V3(0, 1, 0), new Q())); s.onGround = false; s.gear = 0.2; s.ap = null; s.throttle = 0.6;
  if (why !== 'water') { v.damage = Math.min(1, v.damage + 0.15); for (const k of Object.keys(v.tanks)) v.tanks[k] *= 0.97; }
  s.events.push(why === 'water' ? 'splashed' : 'hard'); s.hardSpeed = 0;
}

// ---------------------------------------------------------------- autopilots
function autopilot(v, s, env, st, dt) {
  const out = { pitch: 0, roll: 0, yaw: 0, thr: s.throttle, brake: 0, rocket: false, off: false };
  const rw = env.runway; const { sp, agl, fwd, right } = st;
  // approach speeds scale with the wing loading at the local air density (light craft or thick air: much slower, else the plane floats down the runway); 1.0 at the Verdant reference
  const kv = clamp(Math.sqrt((st.mass * env.g / Math.max(st.rho, 0.05)) / 30735), 0.55, 1.25);
  basis(s.q);
  const velH = Math.hypot(s.vel.x, s.vel.z); const track = velH > 3 ? Math.atan2(s.vel.x, -s.vel.z) : Math.atan2(_fwd.x, -_fwd.z);
  const gamma = sp > 5 ? Math.asin(clamp(s.vel.y / sp, -1, 1)) : 0;
  const alphaTrim = 0.065;
  const holdGamma = (g) => clamp(((g - gamma) * 5.0 + 0) / 0.2 * 0.2 + 0, -1, 1) * 0.0 + clamp((g - gamma) * 4.0, -0.5, 1.0) / 1.0;   // pitch input (alpha cmd = trim + input*0.2)
  const dx = s.p.x - rw.x, dz = s.p.z - rw.z;
  const hx = Math.sin(rw.hdg), hz = -Math.cos(rw.hdg);
  const along = dx * hx + dz * hz, cross = dx * (-hz) + dz * hx;       // cross > 0: right of the runway centreline
  s.track = { along, cross };
  if (s.ap === 'aeroland') {
    const yWheels = s.p.y - 2.6 - rw.h, d = -along;
    if (!s.onGround) {
      // lateral: intercept the centreline
      const want = rw.hdg - clamp(cross * 0.0035, -0.5, 0.5) * (d > 150 ? 1 : 0.4);
      out.roll = clamp(wrap(want - track) * 1.6, -0.5, 0.5);
      // vertical: 3.2 degree glide slope to the touchdown point, flare in the last 7 m
      const hDes = Math.max(0, d - Math.abs(cross) * 2.5) * Math.tan(0.056) + 0.4 + (Math.abs(cross) > 60 ? 40 : 0);      // line up first, then descend
      let gDes = -0.056 + clamp((hDes - yWheels) * 0.0016, -0.06, 0.05);
      let thr = clamp(0.30 + (60 * kv - sp) * 0.05, 0, 1); out.airbrake = clamp((sp - 66 * kv) / 25, 0, 1);
      if (yWheels < 8 || d < 60) { gDes = Math.asin(clamp(-(0.7 + 0.3 * Math.max(0, yWheels)) / Math.max(sp, 20), -0.2, 0)); thr = 0; out.airbrake = clamp((sp - 62 * kv) / 25, 0, 0.6); }
      if (d > 200 && yWheels > 40) gDes = clamp(gDes, -0.2, 0.05);
      out.pitch = (gDes - gamma) * 4.0 + 0; out.pitch = clamp(out.pitch, -0.6, 0.9); out.thr = thr;
      if (along > 400 && yWheels > 60) out.thr = 0.8;       // overshot: keep flying, the pilot takes over
    } else {
      out.thr = 0; out.brake = 1; out.pitch = -0.3;
      out.yaw = clamp(-(cross * 0.03) - wrap(track - rw.hdg) * 2.0, -1, 1) * 0.8;
      if (sp < 1.2) out.off = true;
    }
    return out;
  }
  if (s.ap === 'aerotakeoff' || s.ap === 'aeroclimb') {
    if (s.onGround) {
      out.thr = 1; out.brake = 0;
      out.yaw = clamp(-(cross * 0.04) - wrap(track - rw.hdg) * 2.2, -1, 1) * 0.7;
      out.pitch = sp > 46 ? 0.7 : -0.2;
    } else {
      // energy management: build speed low and fast (jets lose thrust with altitude), then zoom as the speed allows
      const aglNow = s.p.y - 2.6 - env.h(s.p.x, s.p.z), altT = clamp((sp - 105) * 15, 250, 16500);
      const zoom = s.rocketOn ? ASCENT.zoomGamma : 0.42;           // rocket burning: climb steeply out of the dense air (drag loss falls faster than gravity loss rises)
      const climbGamma = aglNow < 120 ? 0.2 : clamp((altT - s.p.y) * 0.012, -0.05, zoom);
      out.thr = 1; out.pitch = clamp((climbGamma - gamma) * 4.0, -0.5, 0.9);
      out.roll = clamp(wrap(rw.hdg - track) * 1.2, -0.3, 0.3);
      s.apPhase = 1;
      const alt = s.p.y;
      if (v.mode === 'auto' && (st.mach > 2.1 || alt > 9500) || (v.engineId === 'jet' && st.mach > 2.6)) out.rocket = true;
      if (alt > 12500 || s.rocketOn) { out.rocket = true; s.rocketOn = true; }
      if (alt > 13500) { s.ap = 'ascent'; s.apHeading = track; s.assist = true; }
      s.ap = s.ap === 'aerotakeoff' ? 'aeroclimb' : s.ap;
    }
    return out;
  }
  if (s.ap === 'ascent') {            // final pitch-over until the orbit hand-over altitude
    const climbGamma = clamp(ASCENT.zoomGamma - st.mach * 0.02, 0.2, 0.9);
    out.thr = 1; out.rocket = true; out.pitch = clamp((climbGamma - gamma) * 4.0, -0.5, 0.9); out.roll = clamp(wrap((s.apHeading ?? track) - track) * 1.0, -0.3, 0.3);
    return out;
  }
  out.off = true; return out;
}
