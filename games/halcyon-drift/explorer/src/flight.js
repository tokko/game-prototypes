// Hover / VTOL flight for the lander and spaceplane in the local surface frame, plus the shared guidance laws
// (powered descent, ascent to orbit) that the orbit-mode autopilot reuses. Frame: x east, y up, z south.
import * as THREE from 'three';
import { fToWorldMatrix, enu, lonLatOfDir } from './frames.js';
import { dragFor, thermalStep, density } from './aero.js';
import { stepAero } from './aeroflight.js';

const V3 = THREE.Vector3, UP = new V3(0, 1, 0);
const _a = new V3(), _b = new V3(), _c = new V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const D2R = Math.PI / 180;

export const TRANSITION_DOWN = 14000, TRANSITION_UP = 16000;
export const SAFE_VSPEED = 4.0, SAFE_HSPEED = 3.5, SAFE_TILT = 22 * D2R;

// ------------------------------------------------------------------ guidance laws (ENU world frame, pure)
/** powered descent: thrust-acceleration vector that tracks a vertical speed profile and kills horizontal speed */
export function guideLand(h, vel, aMax, gEff, out = new V3()) {
  const aNet = Math.max(aMax - gEff, 0.6);
  const vy = -clamp(Math.min(Math.sqrt(2 * 0.5 * aNet * Math.max(h - 1.6, 0)), 1.0 + 0.2 * h), 0.9, 400);      // final-approach cap: the tracking lag grows with aNet, so a light craft must not arrive at the full braking-curve speed
  const k = 1.0;
  out.set(-vel.x * k, (vy - vel.y) * k + gEff, -vel.z * k);
  if (out.y < 0) out.y = 0;
  return out;
}
/** ascent: vertical rise, then accelerate horizontally while holding a climb profile towards the parking altitude */
export function guideAscent(h, vel, aMax, gEff, heading, hTarget, vCirc, out = new V3(), vzCap = 300) {
  const fwd = _b.set(Math.sin(heading), 0, -Math.cos(heading));
  const vh = Math.hypot(vel.x, vel.z);
  if (h < 250 && vh < 25) { out.set(0, aMax, 0); return { aT: out, done: false }; }
  // climb along a braking curve that reaches the target altitude with zero vertical speed (thrust may point slightly down)
  const aD = 0.35 * aMax;
  const vzT = h < hTarget ? Math.min(vzCap, Math.sqrt(2 * aD * (hTarget - h))) : -Math.min(30, (h - hTarget) * 0.03);
  const aV = clamp((vzT - vel.y) * 0.9 + gEff, -0.6 * aMax, 0.985 * aMax);
  const aH = vh >= vCirc ? 0 : Math.sqrt(Math.max(aMax * aMax - aV * aV, 0));
  out.set(fwd.x * aH, aV, fwd.z * aH);
  const done = vh >= vCirc * 0.997 && Math.abs(vel.y) < 25 && h > 18000;
  return { aT: out, done };
}

// ------------------------------------------------------------------ attitude helpers
export function orientationFor(upDir, heading, out = new THREE.Quaternion()) {
  const Y = _a.copy(upDir).normalize();
  const nose = _b.set(Math.sin(heading), 0, -Math.cos(heading));
  nose.addScaledVector(Y, -nose.dot(Y));
  if (nose.lengthSq() < 1e-6) nose.set(1, 0, 0).addScaledVector(Y, -Y.x);
  nose.normalize();
  const Z = _c.copy(nose).negate();
  const X = new V3().crossVectors(Y, Z).normalize();
  _m.makeBasis(X, Y, Z);
  return out.setFromRotationMatrix(_m);
}

export function makeSurf(v, p, vel, q, heading = 0) {
  v.surf = { p: p.clone(), vel: vel.clone(), q: q.clone(), landed: false, assist: true, ap: null, heading, throttle: 0, events: [], tilt: 0, alt: 0, vspeed: 0, hspeed: 0, gEff: 1.18, thrustFrac: 0, groundN: new V3(0, 1, 0), liftOff: 0 };
  return v.surf;
}

/** One physics step. ctl: {fwd, strafe, yaw, climb, dthr, full, cut}. env: {h(x,z), normal(x,z,out), g, R, world, scatter, footR} */
export function stepFlight(v, ctl, dt, env) {
  const s = v.surf;
  if (s.aero && v.kind === 'plane') return stepAero(v, ctl, dt, env);
  const eng = v.engine({ vtol: true, rho: 0 });
  const hasP = v.hasProp(eng);
  const mass = v.mass(env.world);
  const aMax = hasP ? eng.thrust / mass : 0;
  const ground = env.h(s.p.x, s.p.z);
  const alt = s.p.y - ground;
  const vh = Math.hypot(s.vel.x, s.vel.z);
  const gEff = env.g - (vh * vh) / (env.R + Math.max(0, s.p.y));
  s.gEff = gEff; s.alt = alt; s.vspeed = s.vel.y; s.hspeed = vh;
  s.events.length = 0;
  // atmosphere: drag + skin heating (same model as the orbit view, so the handover is continuous)
  const rho = env.rhoAt ? env.rhoAt(Math.max(0, s.p.y)) : 0;
  const spd = s.vel.length();
  { const f = thermalStep(v, rho, spd, dt); if (env.world && env.world.entryEffects) env.world.entryEffects(v, rho, spd, f); }
  if ((v.kind === 'plane' || (v.model && v.model.rover)) && s.landed && v.stance !== 'vertical') { v.throttle = 0; s.thrustFrac = 0; return s; }      // tipped / tipping (the Prospector's rover drive is rover.js)

  // heading
  if (Math.abs(ctl.yaw) > 0.01) s.heading += ctl.yaw * 0.9 * dt;
  else if (v.kind === 'plane' && vh > 4 && !s.landed) { const ht = Math.atan2(s.vel.x, -s.vel.z); let d = ht - s.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); s.heading += d * Math.min(1, dt * 1.2); }

  const desired = _c.set(0, 1, 0); // desired thrust-acceleration vector (world)
  let aT = new V3(0, gEff, 0), manual = false;
  if (s.ap === 'land') {
    guideLand(alt, s.vel, aMax, gEff, aT);
    if (alt < 60 && vh < 6) aT.x = aT.z = 0;
  } else if (s.ap === 'ascent') {
    const r = guideAscent(alt, s.vel, aMax, gEff, s.apHeading ?? Math.PI / 2, (env.parkAlt || 40000) * 0.75, Math.sqrt(env.g * env.R * env.R / (env.R + Math.max(alt, 1000))), aT);
    if (r.done) { s.ap = null; s.events.push('orbit'); }
    s.landed = false;
  } else if (s.assist) {
    const vmax = ctl.run ? 60 : 24;
    const hd = s.heading;
    const fx = Math.sin(hd), fz = -Math.cos(hd), rx = Math.cos(hd), rz = Math.sin(hd);
    const vTx = (fx * ctl.fwd + rx * ctl.strafe) * vmax, vTz = (fz * ctl.fwd + rz * ctl.strafe) * vmax;
    const vTy = ctl.climb * (ctl.run ? 16 : 7);
    // terrain keeping: gently avoid dropping into the ground when drifting
    aT.set((vTx - s.vel.x) * 1.15, (vTy - s.vel.y) * 1.3 + gEff, (vTz - s.vel.z) * 1.15);
    if (s.landed && ctl.climb <= 0.05) aT.set(0, 0, 0);
  } else {
    manual = true;
  }

  // limit tilt of the thrust vector
  if (!manual && aT.lengthSq() > 1e-6) {
    const hmag = Math.hypot(aT.x, aT.z);
    const maxTilt = s.ap === 'land' && vh > 30 ? 1.4 : s.ap === 'ascent' ? 1.55 : Math.tan(52 * D2R);
    const lim = Math.max(aT.y, 0.0001) * maxTilt;
    if (hmag > lim && s.ap !== 'ascent') { const k = lim / hmag; aT.x *= k; aT.z *= k; }
    const len = aT.length(); if (len > aMax && len > 0) aT.multiplyScalar(aMax / len);
  }

  // attitude
  let dirT;
  if (manual) {
    const pitch = -ctl.fwd * 32 * D2R, roll = ctl.strafe * 32 * D2R;
    const hd = s.heading;
    dirT = new V3(Math.sin(hd) * Math.sin(-pitch) + Math.cos(hd) * Math.sin(roll), 1, -Math.cos(hd) * Math.sin(-pitch) + Math.sin(hd) * Math.sin(roll)).normalize();
    if (ctl.full) s.throttle = 1; if (ctl.cut) s.throttle = 0;
    s.throttle = clamp(s.throttle + ctl.dthr * dt * 0.5, 0, 1);
  } else {
    dirT = aT.lengthSq() > 1e-4 ? aT.clone().normalize() : new V3(0, 1, 0);
    if (s.landed) dirT.set(0, 1, 0);
  }
  if (!s.landed) {
    orientationFor(dirT, s.heading, _q);
    const rate = (v.kind === 'plane' ? 110 : 85) * D2R * dt;
    s.q.rotateTowards(_q, rate);
  }
  const thrustDir = _a.set(0, 1, 0).applyQuaternion(s.q);
  // throttle
  let thr;
  if (manual) thr = s.throttle;
  else {
    const align = clamp((thrustDir.dot(dirT) - 0.8) / 0.18, 0, 1);
    thr = aMax > 0 ? clamp(aT.length() / aMax, 0, 1) * align : 0;
    if (s.landed && thr < 0.0001) thr = 0;
  }
  if (!hasP) thr = 0;
  s.thrustFrac = thr;
  v.throttle = thr;

  if (s.landed) {
    // lift-off when the thrust would beat gravity
    const lift = thr * aMax * thrustDir.y;
    if (lift > gEff * 1.02 && (ctl.climb > 0.05 || manual || s.ap === 'ascent' || s.ap === 'land' || ctl.fwd !== 0)) { s.landed = false; s.vel.y = Math.max(s.vel.y, 0.3); s.p.y += 0.15; s.events.push('liftoff'); }
    else { settleOnGround(v, s, env, dt); consumeProp(v, eng, 0, dt, mass); return s; }
  }
  // integrate
  const acc = new V3().copy(thrustDir).multiplyScalar(thr * aMax);
  acc.y -= gEff;
  if (rho > 0 && spd > 0.01) acc.addScaledVector(s.vel, -dragFor(v.kind, rho, spd) / spd);
  s.vel.addScaledVector(acc, dt);
  s.p.addScaledVector(s.vel, dt);
  consumeProp(v, eng, thr, dt, mass);

  // scatter collisions (spires / boulders / arch piers)
  if (env.scatter) {
    const c = env.scatter.collide(s.p.x, s.p.z, s.p.y - env.h(s.p.x, s.p.z), (env.footR || 3.5) * 0.8);
    if (c.hit) { s.p.x += c.px; s.p.z += c.pz; const vn = s.vel.x * c.nx + s.vel.z * c.nz; if (vn < 0) { s.vel.x -= vn * c.nx * 1.3; s.vel.z -= vn * c.nz * 1.3; } }
  }
  contact(v, s, env);
  return s;
}

function consumeProp(v, eng, thr, dt, mass) {
  if (thr <= 0) return;
  const dm = v.mdot(eng, thr) * dt;
  v.consume(eng, dm);
}

const _fp = new V3();
function footWorld(v, s, f, out) { return out.copy(f).applyQuaternion(s.q).add(s.p); }

function contact(v, s, env) {
  const feet = v.model?.feet || env.feet;
  let pen = 0, worst = 0;
  for (const f of feet) {
    footWorld(v, s, f, _fp);
    const g = env.h(_fp.x, _fp.z);
    const d = g - _fp.y;
    if (d > worst) worst = d;
  }
  if (env.waterDepth && env.waterDepth(s.p.x, s.p.z) > 0.35) {
    if (worst > -3) { s.events.push('water'); s.vel.set(s.vel.x * 0.3, 4, s.vel.z * 0.3); s.p.y += Math.max(worst, 0) + 18; s.ap = null; s.assist = true; return; }   // no landing on water: gently lifted clear
    if (!s.waterWarn && worst > -40) { s.waterWarn = 1; s.events.push('waterwarn'); }
  } else s.waterWarn = 0;
  if (worst <= 0) return;
  // touching: evaluate landing
  const n = env.normal(s.p.x, s.p.z, new V3().set(0, 1, 0));
  const up = new V3(0, 1, 0).applyQuaternion(s.q);
  const tilt = Math.acos(clamp(up.dot(new V3(n[0], n[1], n[2])), -1, 1));
  const vy = -s.vel.y, vh = Math.hypot(s.vel.x, s.vel.z);
  s.tilt = tilt;
  if (vy < SAFE_VSPEED && vh < SAFE_HSPEED && tilt < SAFE_TILT + 0.12) {
    s.vel.set(0, 0, 0); s.landed = true; s.p.y += worst; s.events.push('landed'); s.landSpeed = vy;
    return;
  }
  if (vy < SAFE_VSPEED && vh < SAFE_HSPEED) {      // a gentle touch on ground too steep to stand on: no damage, hop clear and hand control back (find flatter ground)
    s.events.push('steep'); s.p.y += worst; s.vel.set(s.vel.x * 0.3, 3.5, s.vel.z * 0.3); s.ap = null; s.assist = true; return;
  }
  // hard landing: hull damage scaled by the impact; a moderate one bounces (and may settle on the next touch), a severe one stays down on the ground
  s.events.push('hard'); const imp = Math.max(vy, vh); s.hardSpeed = imp;
  const nowT = performance.now() / 1000;
  if (nowT - (s.hardAt ?? -9) > 1.5) {      // damage once per impact, not once per frame of a skid
    s.hardAt = nowT; v.damage = Math.min(1, v.damage + 0.08 + 0.03 * Math.max(0, imp - SAFE_VSPEED));
    for (const k of Object.keys(v.tanks)) v.tanks[k] *= 0.96;       // damage costs a slice of propellant
  }
  s.p.y += worst;
  if (vy < 3 * SAFE_VSPEED) { s.vel.y = vy * 0.25; s.vel.x *= 0.5; s.vel.z *= 0.5; }
  else { s.vel.set(0, 0, 0); s.landed = true; s.ap = null; s.assist = true; }
}

/** while landed: rest on the slope (plane fit through the feet), keep heading */
export function settleOnGround(v, s, env, dt) {
  const feet = v.model?.feet || env.feet;
  const g = feet.map((f) => { const wp = _fp.copy(f).applyQuaternion(s.q).add(s.p); return env.h(wp.x, wp.z); });
  // plane normal from feet (assume order FL,FR,BL,BR => indices 0..3)
  const w = (i) => { const f = feet[i]; return new V3(s.p.x + f.x, g[i], s.p.z + f.z); };
  const A = w(0), B = w(1), C = w(2), D = w(3);
  const n = new V3().crossVectors(D.clone().sub(A), C.clone().sub(B)).normalize();
  if (n.y < 0) n.negate();
  s.groundN.lerp(n, Math.min(1, dt * 6)).normalize();
  orientationFor(s.groundN, s.heading, _q);
  s.q.slerp(_q, Math.min(1, dt * 5));
  // height: lowest foot rests on the ground
  let y = -1e9;
  for (let i = 0; i < feet.length; i++) { const off = _fp.copy(feet[i]).applyQuaternion(s.q); y = Math.max(y, g[i] - off.y); }
  s.p.y = y; s.vel.set(0, 0, 0);
}

/** plane stance animation: gear tips the plane between tail-down and horizontal (a deliberate, mechanical few seconds) */
export function stepStance(v, dt) {
  if (v.kind !== 'plane' && !(v.model && v.model.rover)) return;
  const d = v.tipT - v.tip;
  if (Math.abs(d) > 1e-4) v.tip += Math.sign(d) * Math.min(Math.abs(d), dt / (v.kind === 'plane' ? 6.0 : 7.0));
  v.stance = v.tip <= 0.0001 ? 'vertical' : v.tip >= 0.9999 ? 'flat' : 'tipping';
}
export const gearPhase = (tip) => ({ wheels: clamp(tip / 0.3, 0, 1), legs: 1 - clamp((tip - 0.72) / 0.28, 0, 1) });
/** Prospector: the six wheel legs unfold first (tip 0 to 0.25), then the hull pivots down onto them; reversed when standing up */
export const roverPhase = (tip) => { const t = clamp((tip - 0.22) / 0.78, 0, 1); return { legs: clamp(tip / 0.25, 0, 1), tip: t * t * (3 - 2 * t) }; };

/** drop a freshly spawned vessel onto the terrain */
export function placeLanded(v, x, z, heading, env) {
  const s = v.surf || makeSurf(v, new V3(x, 0, z), new V3(), new THREE.Quaternion(), heading);
  s.p.set(x, env.h(x, z) + 6, z); s.vel.set(0, 0, 0); s.heading = heading; s.landed = true; s.ap = null; s.assist = true; s.throttle = 0;
  s.q.copy(orientationFor(UP, heading, new THREE.Quaternion()));
  for (let i = 0; i < 12; i++) settleOnGround(v, s, env, 0.2);
  return s;
}

// ------------------------------------------------------------------ orbit <-> surface frame conversion
const _E = new V3(), _N = new V3(), _U = new V3();
/** body-fixed F state -> surface local state. R = body radius. Returns {p, vel, q, lon, lat, heading} (p in true plane coords + datum altitude) */
export function orbitToSurface(r, vel, qF, R) {
  const n = _a.copy(r).normalize();
  const { lon, lat } = lonLatOfDir(n);
  enu(lon, lat, _E, _N, _U);
  const alt = r.length() - R;
  const pv = new V3(vel.dot(_E), vel.dot(_U), -vel.dot(_N));
  const M3 = fToWorldMatrix(lon, lat);
  const M4 = new THREE.Matrix4().setFromMatrix3(M3);
  const qB = new THREE.Quaternion().setFromRotationMatrix(M4);
  const q = qB.multiply(qF.clone());
  return { x: lon * R, z: -lat * R, y: alt, vel: pv, q, lon, lat };
}
export function surfaceToOrbit(x, y, z, vel, q, R) {
  const lon = x / R, lat = -z / R;
  const n = new V3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  enu(lon, lat, _E, _N, _U);
  const r = n.clone().multiplyScalar(R + y);
  const v = new V3().addScaledVector(_E, vel.x).addScaledVector(_U, vel.y).addScaledVector(_N, -vel.z);
  const M3 = fToWorldMatrix(lon, lat);
  const M4 = new THREE.Matrix4().setFromMatrix3(M3);
  const qB = new THREE.Quaternion().setFromRotationMatrix(M4);
  const qF = qB.invert().multiply(q.clone());
  return { r, v, q: qF };
}
