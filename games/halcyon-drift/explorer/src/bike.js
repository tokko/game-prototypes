// Dirt bike: raycast-suspension rigid body on the heightfield. Low gravity (long air, floaty landings), air control,
// wheelies, wipe-out + gentle respawn. Body frame: x right, y up, z back (front wheel at -z).
import * as THREE from 'three';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const MASS = 260, I = { x: 42, y: 30, z: 16 };
const COM = new V3(0, 0.62, 0.3);                // centre of mass in model coordinates
const MOUNT = [new V3(0, 0.78, -0.73), new V3(0, 0.78, 1.23)];
const REST = 0.38, R = 0.4, TRAVEL = 0.46, K = 12000, C = 1700;
const _v = new V3(), _w = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _q = new Q();

export class Bike {
  constructor(model) {
    this.model = model;
    this.p = new V3(); this.q = new Q(); this.v = new V3(); this.w = new V3();
    this.steer = 0; this.spinF = 0; this.spinR = 0;
    this.wheels = [{ c: 0, contact: false, pt: new V3(), n: new V3(0, 1, 0), v: 0 }, { c: 0, contact: false, pt: new V3(), n: new V3(0, 1, 0), v: 0 }];
    this.air = 0; this.airMax = 0; this.lastAir = 0; this.best = 0;
    this.crashed = 0; this.speed = 0; this.throttle = 0; this.events = [];
    this.lean = 0; this.hasRider = false; this.boost = 100; this.wheelie = false; this.alt = 0;
    this.groundPitchInput = 0; this.groundRollInput = 0;
  }
  place(x, z, yaw, env) {
    this.q.setFromAxisAngle(new V3(0, 1, 0), -yaw);
    const gh = env.h(x, z);
    this.p.set(x, gh + 0.68, z); this.v.set(0, 0, 0); this.w.set(0, 0, 0); this.crashed = 0; this.air = 0;
    // align to terrain
    const n = env.normal(x, z, [0, 1, 0]);
    const qa = new Q().setFromUnitVectors(new V3(0, 1, 0), new V3(n[0], n[1], n[2]));
    this.q.premultiply(qa);
    this.groundPitchInput = 0; this.groundRollInput = 0;
  }
  get forward() { return _a.set(0, 0, -1).applyQuaternion(this.q); }
  get yaw() { const f = new V3(0, 0, -1).applyQuaternion(this.q); return Math.atan2(f.x, -f.z); }
  /** ctl: {thr (-1..1), steer (-1..1), pitch, roll, yaw (air), brake, wheelie, boost} */
  step(dt, ctl, env) {
    this.events.length = 0;
    const g = env.g;
    const up = _b.set(0, 1, 0).applyQuaternion(this.q);
    const fwdV = new V3(0, 0, -1).applyQuaternion(this.q), rightV = new V3(1, 0, 0).applyQuaternion(this.q);
    const speed = this.v.length();
    const crashedNow = this.crashed > 0;
    if (crashedNow) { ctl = { thr: 0, steer: 0, pitch: 0, roll: 0, yaw: 0, brake: 0 }; this.crashed -= dt; if (this.crashed <= 0) { this.respawn(env); return; } }
    // steering
    const maxSteer = 0.62 / (1 + 0.07 * speed);
    this.steer += clamp(ctl.steer * maxSteer - this.steer, -4 * dt, 4 * dt);
    const force = new V3(), torque = new V3();
    force.y -= MASS * g;
    const comW = new V3().copy(COM).applyQuaternion(this.q).negate().add(this.p);   // model origin in world
    let grounded = 0, lat = 0;
    const fwdSpeed = this.v.dot(fwdV);
    for (let i = 0; i < 2; i++) {
      const wh = this.wheels[i];
      const mount = new V3().copy(MOUNT[i]).sub(COM).applyQuaternion(this.q).add(this.p);
      const down = new V3(0, -1, 0).applyQuaternion(this.q);
      // find ground along the suspension axis (3 fixed-point iterations)
      let t = REST + R;
      for (let k = 0; k < 4; k++) { const px = mount.x + down.x * t, pz = mount.z + down.z * t, py = mount.y + down.y * t; const gh = env.h(px, pz); t = clamp(t + (py - gh) / Math.max(0.3, -down.y), 0.0, REST + R + 3); }
      const hitT = t;
      const comp = REST + R - hitT;
      wh.contact = comp > -0.02 && hitT < REST + R + 0.02;
      const cpx = mount.x + down.x * hitT, cpz = mount.z + down.z * hitT, cpy = mount.y + down.y * hitT;
      wh.pt.set(cpx, cpy, cpz);
      const n = env.normal(cpx, cpz, [0, 1, 0]); wh.n.set(n[0], n[1], n[2]);
      if (wh.contact) {
        grounded++;
        const cc = clamp(comp, 0, TRAVEL + 0.15);
        const rel = new V3().copy(wh.pt).sub(this.p);
        const pv = _w.copy(this.w).cross(rel).add(this.v);
        const vN = pv.dot(wh.n);
        let Fn = K * cc - C * vN * (cc > 0 ? 1 : 0);
        if (cc > TRAVEL * 0.75) Fn += K * 8 * (cc - TRAVEL * 0.75);
        Fn = Math.max(0, Fn);
        wh.c += (cc - wh.c) * Math.min(1, dt * 30); wh.load = Fn;
        const Fv = new V3().copy(wh.n).multiplyScalar(Fn);
        force.add(Fv); torque.add(new V3().crossVectors(rel, Fv));
        // tyre: wheel axes in the ground plane
        const fa = i === 0 ? fwdV.clone().applyAxisAngle(up, -this.steer) : fwdV.clone();
        fa.addScaledVector(wh.n, -fa.dot(wh.n)).normalize();
        const sa = new V3().crossVectors(wh.n, fa).normalize();   // side axis
        const vf = pv.dot(fa), vs = pv.dot(sa);
        const gk = env.gripAt ? env.gripAt(cpx, cpz) : 1;           // surface friction multiplier (Glaciera ice); 1 = dirt
        const grip = gk * 1.1 * (MASS * 9.5 * (i === 1 ? 0.62 : 0.38) + 0.4 * Fn);
        // lateral: kill side slip
        let Fs = clamp(-vs * 30 * 0.6 / Math.max(dt, 1e-3), -grip * 1.3, grip * 1.3);
        const sideF = new V3().copy(sa).multiplyScalar(Fs);
        let Fl = 0;
        if (i === 1) {
          const boostK = ctl.boost && this.boost > 0 ? 1.55 : 1;
          const vmax = 52 * boostK;
          const eng = ctl.thr > 0 ? ctl.thr * 1500 * boostK * Math.max(0, 1 - (vf / vmax) ** 2) : ctl.thr * 600 * (vf < 0.5 ? 1 : 0.0);
          Fl += clamp(eng, -grip, grip);
        }
        if (ctl.brake) Fl += clamp(-vf * 60 / Math.max(dt, 1e-3) * 0.5, -grip * 0.9, grip * 0.9);
        else if (ctl.thr === 0) Fl += clamp(-vf * 20, -80, 80);       // light rolling resistance
        const longF = new V3().copy(fa).multiplyScalar(Fl);
        // ground contact point at tyre bottom
        const Ft = sideF.add(longF);
        force.add(Ft);
        const tq = new V3().crossVectors(rel, Ft);
        // tyre forces only steer (yaw torque): roll is a ghost-balanced lean and pitch comes from the suspension,
        // otherwise low gravity would flip the bike on any acceleration
        torque.addScaledVector(up, tq.dot(up));
        wh.spin = vf / R;
      } else { wh.c += (0 - wh.c) * Math.min(1, dt * 6); wh.load = 0; }
    }
    // lean / balance (ghost): lateral accel -> lean angle, keeps the bike upright without real roll dynamics
    if (grounded > 0) {
      const wn = new V3();
      for (const wh of this.wheels) if (wh.contact) wn.add(wh.n);
      wn.normalize();
      const alat = fwdSpeed * fwdSpeed * Math.tan(this.steer) / 1.96;
      const targetLean = clamp(Math.atan2(alat, 9.8), -0.48, 0.48);
      // roll angle relative to surface normal about forward axis
      const upNow = up.clone();
      const side = new V3().crossVectors(fwdV, wn).normalize(); // points to the right? (fwd x n)
      const cur = Math.atan2(upNow.dot(side), upNow.dot(wn));
      const err = targetLean - cur;
      const tq = fwdV.clone().multiplyScalar(clamp(err * 900 - this.w.dot(fwdV) * 130, -1400, 1400) * (grounded > 1 ? 1 : 0.4));
      torque.add(tq); this.lean = cur;
    }
    // pitch leveling on the ground (ghost balance): rest the bike on the surface like a real suspension would
    const rightW = rightV;
    if (grounded > 0) {
      const nAvg = new V3();
      for (const wh of this.wheels) if (wh.contact) nAvg.add(wh.n);
      nAvg.normalize();
      const cr = new V3().crossVectors(up, nAvg);
      const pe = Math.atan2(cr.dot(rightW), up.dot(nAvg)) + (ctl.wheelie ? -0.55 : 0);
      torque.addScaledVector(rightW, clamp(pe * 1100 - this.w.dot(rightW) * 160, -1500, 1500) * (grounded > 1 ? 0.7 : 1));
    }
    // wheelie / pitch assist on the ground
    if (grounded > 0 && ctl.wheelie) torque.addScaledVector(rightW, 520);
    // air control
    if (grounded === 0) {
      // A crest should not turn held throttle and steering into a midair stunt.
      if (ctl.pitch !== this.groundPitchInput) this.groundPitchInput = 0;
      if (ctl.roll !== this.groundRollInput) this.groundRollInput = 0;
      ctl = { ...ctl, pitch: this.groundPitchInput ? 0 : ctl.pitch, roll: this.groundRollInput ? 0 : ctl.roll };
      if (Math.abs(this.w.dot(rightW)) < 1.7 || Math.sign(this.w.dot(rightW)) === Math.sign(ctl.pitch)) torque.addScaledVector(rightW, -ctl.pitch * 340);   // W (pitch>0): nose down
      torque.addScaledVector(fwdV, ctl.roll * 300);
      torque.addScaledVector(up, -ctl.yaw * 220);
      this.w.multiplyScalar(Math.max(0, 1 - 0.9 * dt));
      if (Math.abs(ctl.roll) < 0.05) torque.addScaledVector(fwdV, rightV.y * 380 - this.w.dot(fwdV) * 70);
      if (Math.abs(ctl.yaw) < 0.05) torque.addScaledVector(up, -this.w.dot(up) * 35);
      // gyro trim: with no pitch input the nose gently follows the flight path (keeps big jumps controllable)
      if (Math.abs(ctl.pitch) < 0.05) {
        const hs = Math.hypot(this.v.x, this.v.z);
        const target = Math.atan2(this.v.y, Math.max(hs, 3)) * 0.8;
        const f = fwdV, curP = Math.asin(clamp(f.y, -1, 1));
        torque.addScaledVector(rightW, -(clamp(target - curP, -1.2, 1.2) * -260) - this.w.dot(rightW) * 70);
      }
      this.air += dt; this.airMax = Math.max(this.airMax, this.air); this.alt = this.p.y - env.h(this.p.x, this.p.z);
    } else {
      this.groundPitchInput = ctl.pitch; this.groundRollInput = ctl.roll;
      if (this.air > 0.3) { this.lastAir = this.air; this.events.push({ type: 'land', air: this.air, vy: this.v.y }); if (this.air > this.best) this.best = this.air; }
      this.air = 0;
      // gentle damping of pitch rate on the ground
      this.w.addScaledVector(rightW, -this.w.dot(rightW) * Math.min(1, 1.2 * dt));
    }
    // integrate (angular accel in body frame inertia)
    this.v.addScaledVector(force, dt / MASS);
    const wl = _c.copy(this.w).applyQuaternion(_q.copy(this.q).invert());
    const tl = new V3().copy(torque).applyQuaternion(_q.copy(this.q).invert());
    wl.x += tl.x / I.x * dt; wl.y += tl.y / I.y * dt; wl.z += tl.z / I.z * dt;
    this.w.copy(wl).applyQuaternion(this.q);
    if (this.w.length() > 14) this.w.setLength(14);
    this.p.addScaledVector(this.v, dt);
    const ang = this.w.length() * dt;
    if (ang > 1e-9) { const dq = _q.setFromAxisAngle(_a.copy(this.w).normalize(), ang); this.q.premultiply(dq).normalize(); }
    // hard floor + obstacles
    const gh = env.h(this.p.x, this.p.z);
    const headW = new V3(0, 1.45, 0.25).sub(COM).applyQuaternion(this.q).add(this.p);
    if (this.p.y < gh + 0.12) { this.p.y = gh + 0.12; if (this.v.y < 0) this.v.y *= -0.1; }
    if (!crashedNow) {
      const hg = env.h(headW.x, headW.z);
      if (headW.y < hg + 0.1 && speed > 6 && up.y < 0.5) this.crash('flip');
      else if (up.y < -0.25 && grounded > 0) this.crash('flip');
    }
    if (env.scatter) {
      const c = env.scatter.collide(this.p.x, this.p.z, this.p.y - gh, 0.55);
      if (c.hit) {
        const vn = this.v.x * c.nx + this.v.z * c.nz;
        this.p.x += c.px; this.p.z += c.pz;
        if (vn < 0) { if (-vn > 12 && !crashedNow) this.crash('rock'); this.v.x -= vn * c.nx * 1.35; this.v.z -= vn * c.nz * 1.35; }
      }
    }
    this.speed = this.v.length();
    // boost meter
    if (ctl.boost && ctl.thr > 0) this.boost = Math.max(0, this.boost - 22 * dt); else this.boost = Math.min(100, this.boost + 9 * dt);
    this.throttle = ctl.thr;
    const sp = this.v.dot(fwdV) / R;
    this.spinF += (this.wheels[0].contact ? this.wheels[0].spin : sp) * dt; this.spinR += (this.wheels[1].contact ? this.wheels[1].spin : sp * 0.9) * dt; this.grounded = grounded;
  }
  crash(why) {
    if (this.crashed > 0) return;
    this.crashed = 2.2; this.events.push({ type: 'crash', why });
    this.w.add(new V3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6));
  }
  respawn(env) {
    const yaw = this.yaw;
    const sx = Math.sin(yaw), sz = -Math.cos(yaw);
    this.place(this.p.x + sx * 4, this.p.z + sz * 4, yaw, env);
    this.events.push({ type: 'respawn' });
  }
  /** apply to the model group */
  applyModel(rider, dt = 1 / 60) {
    const m = this.model;
    m.group.quaternion.copy(this.q);
    m.group.position.copy(COM).negate().applyQuaternion(this.q).add(this.p);
    m.fork.rotation.y = -this.steer;
    m.front.position.y = this.wheels[0].c;
    m.swing.rotation.x = -this.wheels[1].c / 0.88;
    m.fw.rotation.x = this.spinF; m.rw.rotation.x = this.spinR;
    if (m.update) m.update();
    if (rider) rider.pose.ride(-this.steer, this.lean, dt);
  }
}
