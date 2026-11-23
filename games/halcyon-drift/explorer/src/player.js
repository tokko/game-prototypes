// On-foot astronaut controller: walking, running, long low-gravity jumps, small jetpack boost.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Player {
  constructor(model) {
    this.model = model;                       // {group, pose}
    this.p = new V3(); this.vel = new V3();
    this.yaw = 0; this.onGround = true; this.fuel = 100; this.phase = 0; this.boosting = false; this.airTime = 0; this.t = 0;
    this.speed = 0;
  }
  place(x, y, z, yaw = 0) { this.p.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.onGround = true; this.fuel = 100; }
  /** inp: {fx, fz (move input in camera frame: fz forward), run, jump (edge), jumpHeld}, camYaw: radians (0 = north, -z) */
  update(dt, inp, camYaw, env) {
    this.t += dt;
    const g = env.g;
    const ground = env.h(this.p.x, this.p.z);
    this.onGround = this.p.y <= ground + 0.03 && this.vel.y <= 0.05;
    // desired horizontal velocity relative to camera
    const sx = Math.sin(camYaw), cz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = Math.sin(camYaw);
    let mx = sx * inp.fz + rx * inp.fx, mz = cz * inp.fz + rz * inp.fx;
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    // water: wading slows you, deep water means a slow swim at the surface
    const wd = env.waterDepth ? env.waterDepth(this.p.x, this.p.z) : 0;
    this.wade = wd; this.swimming = wd > 1.35;
    const wk = wd > 1.35 ? 0.34 : wd > 0.4 ? 0.62 : 1;
    const top = (inp.run ? 5.5 : 2.2) * wk;       // tuned towards the authored clips (walk ~1.3-1.6 m/s, run ~4 m/s)
    if (this.onGround || this.swimming) {
      const acc = 14 * dt * (env.gripAt ? Math.max(0.12, env.gripAt(this.p.x, this.p.z)) : 1);      // ice: slow to start, slow to stop
      this.vel.x += clamp(mx * top - this.vel.x, -acc, acc); this.vel.z += clamp(mz * top - this.vel.z, -acc, acc);
      this.vel.y = 0; if (!this.swimming) this.p.y = ground; this.fuel = Math.min(100, this.fuel + 18 * dt); this.airTime = 0;
      if (inp.jump && !this.swimming) { this.vel.y = inp.run ? 4.2 : 3.4; this.onGround = false; this.p.y += 0.05; this.vel.x *= 1.0; }
    } else {
      this.airTime += dt;
      const acc = 2.2 * dt;                                    // weak air control: floaty arcs
      this.vel.x += clamp(mx * top - this.vel.x, -acc, acc); this.vel.z += clamp(mz * top - this.vel.z, -acc, acc);
      this.boosting = false;
      if (inp.jumpHeld && this.fuel > 0 && this.airTime > 0.25) {
        this.vel.y += 2.4 * dt; this.fuel = Math.max(0, this.fuel - 22 * dt); this.boosting = true;
        if (inp.run) { this.vel.x += sx * 3.0 * dt; this.vel.z += cz * 3.0 * dt; }
      }
      this.vel.y -= g * dt;
    }
    if (this.swimming && env.waterSurfaceY) {
      const sy = env.waterSurfaceY(this.p.x, this.p.z) - 1.05;
      this.p.addScaledVector(this.vel, dt); this.p.y += (sy - this.p.y) * Math.min(1, dt * 3.5); this.vel.y = 0; this.onGround = true; this.airTime = 0;
    } else
    this.p.addScaledVector(this.vel, dt);
    // slope: do not climb near-vertical faces
    if (this.onGround) {
      const n = env.normal(this.p.x, this.p.z, [0, 1, 0]);
      if (n[1] < 0.55) { this.p.x -= this.vel.x * dt * 0.9; this.p.z -= this.vel.z * dt * 0.9; this.vel.x *= 0.2; this.vel.z *= 0.2; }
    }
    const g2 = env.h(this.p.x, this.p.z);
    if (this.p.y < g2) { this.p.y = g2; if (this.vel.y < 0) this.vel.y = 0; }
    if (env.scatter) {
      const c = env.scatter.collide(this.p.x, this.p.z, this.p.y - g2, 0.45);
      if (c.hit) { this.p.x += c.px; this.p.z += c.pz; const vn = this.vel.x * c.nx + this.vel.z * c.nz; if (vn < 0) { this.vel.x -= vn * c.nx; this.vel.z -= vn * c.nz; } }
    }
    const hs = Math.hypot(this.vel.x, this.vel.z); this.speed = hs;
    if (hs > 0.4) { const ty = Math.atan2(this.vel.x, -this.vel.z); let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 9); }
    // animate
    const m = this.model;
    m.group.position.copy(this.p); m.group.rotation.set(0, -this.yaw, 0);
    if (m.drive) {
      m.drive({ riding: false, onGround: this.onGround || this.airTime < 0.18, speed: hs, run: !!inp.run }, dt);
      m.setJet(this.boosting);
    } else {
      if (!this.onGround) m.pose.air(this.t);
      else if (hs > 0.5) { this.phase += dt * (3.2 + hs * 1.35); if (hs > 5) m.pose.run(this.phase * 0.85, clamp(hs / 7.5, 0.6, 1.15)); else m.pose.walk(this.phase, clamp(hs / 4, 0.4, 1.3)); }
      else m.pose.idle(this.t);
      for (const j of m.parts.jet) j.material = this.boosting ? m.parts.jetOn : m.parts.jetOff;
    }
  }
}
