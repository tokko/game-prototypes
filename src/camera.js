// RTS camera: focus point on terrain, yaw, zoom distance; pitch derived from zoom.
import * as THREE from 'three';
import { HALF } from './terrain.js';

export class RTSCamera {
  constructor(camera, terrain) {
    this.cam = camera; this.terrain = terrain;
    this.s = { fx: 0, fz: 250, yaw: 0, dist: 260 };       // current
    this.t = { fx: 0, fz: 250, yaw: 0, dist: 260 };       // target
    this.minDist = 30; this.maxDist = 700;
    this.free = true;   // false while a script (intro) drives the camera
    this.apply();
  }
  pitchFor(d) {
    const k = Math.min(1, Math.max(0, (d - this.minDist) / (this.maxDist - this.minDist)));
    return 0.42 + 0.627 * k;   // ~24 deg close, ~38 deg at default zoom (dist ~280), 60 deg at max zoom-out
  }
  get pitch() { return this.pitchFor(this.s.dist); }
  focusOn(x, z) { this.t.fx = x; this.t.fz = z; this.clamp(); }
  zoom(delta) { this.t.dist = Math.min(this.maxDist, Math.max(this.minDist, this.t.dist * Math.exp(delta * 0.0012))); }
  rotate(d) { this.t.yaw += d; }
  clamp() { const m = HALF - 25; this.t.fx = Math.max(-m, Math.min(m, this.t.fx)); this.t.fz = Math.max(-m, Math.min(m, this.t.fz)); }
  // keys: {x:-1..1 (right), y:-1..1 (forward)}, rot: -1..1
  update(dt, move, rot, fast) {
    if (this.free) {
      const sp = (60 + this.t.dist * 1.1) * (fast ? 2 : 1) * dt;
      const sy = Math.sin(this.t.yaw), cy = Math.cos(this.t.yaw);
      this.t.fx += (-sy * move.y + cy * move.x) * sp;
      this.t.fz += (-cy * move.y - sy * move.x) * sp;
      this.t.yaw += rot * 1.6 * dt;
      this.clamp();
      const k = 1 - Math.exp(-dt * 9);
      for (const key of ['fx', 'fz', 'yaw', 'dist']) this.s[key] += (this.t[key] - this.s[key]) * k;
    }
    this.apply();
  }
  apply() {
    const { fx, fz, yaw, dist } = this.s;
    const p = this.pitchFor(dist);
    const fy = this.terrain.heightAt(fx, fz);
    const cp = Math.cos(p);
    const x = fx + Math.sin(yaw) * cp * dist, z = fz + Math.cos(yaw) * cp * dist;
    const y = Math.max(fy + Math.sin(p) * dist, this.terrain.heightAt(x, z) + 4);
    this.cam.position.set(x, y, z);
    this.cam.lookAt(fx, fy, fz);
    const k = Math.min(1, Math.max(0, (dist - this.minDist) / (this.maxDist - this.minDist)));
    this.cam.rotateX(0.19 * (1 - k));   // tilt the view up a little so the horizon haze shows above the field
    this.cam.updateMatrixWorld();
  }
  // scripted placement (intro)
  set(fx, fz, yaw, dist) {
    Object.assign(this.s, { fx, fz, yaw, dist });
    Object.assign(this.t, { fx, fz, yaw, dist });
  }
}
