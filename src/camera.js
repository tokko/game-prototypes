// RTS camera: focus point on terrain, yaw, zoom distance; pitch derived from zoom.
import * as THREE from 'three';
import { HALF } from './terrain.js';

export class RTSCamera {
  constructor(camera, terrain) {
    this.cam = camera; this.terrain = terrain;
    this.s = { fx: 0, fz: 285, yaw: 0, dist: 180 };       // current
    this.t = { fx: 0, fz: 285, yaw: 0, dist: 180 };       // target
    this.minDist = 40; this.maxDist = 600;
    this.free = true;   // false while a script (intro) drives the camera
    this.apply();
  }
  kFor(d) { return Math.min(1, Math.max(0, (d - this.minDist) / (this.maxDist - this.minDist))); }
  pitchFor(d) {
    return 0.40 + 0.647 * Math.pow(this.kFor(d), 0.6);   // 23 deg close (dist 40; stays above foliage), ~39 deg at dist 180, 60 deg at max zoom-out (600)
  }
  get pitch() { return this.pitchFor(this.s.dist); }
  focusOn(x, z) { this.t.fx = x; this.t.fz = z; this.t.dist = Math.max(this.t.dist, 90); this.clamp(); }   // keep zoom, but never closer than 90
  // optional (px, pz): world point under the cursor; focus shifts proportionally so it stays put as the zoom changes
  zoom(delta, px, pz) {
    const old = this.t.dist;
    this.t.dist = Math.min(this.maxDist, Math.max(this.minDist, old * Math.exp(delta * 0.0012)));
    if (px === undefined) return;
    const f = 1 - this.t.dist / old;
    this.t.fx += (px - this.t.fx) * f; this.t.fz += (pz - this.t.fz) * f;
    this.clamp();
  }
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
      const k = 1 - Math.exp(-dt * 7);
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
    // keep the camera (and a few points along its view ray) clear of terrain and tree canopies (~14 units)
    const th = this.terrain;
    let y = Math.max(fy + Math.sin(p) * dist, th.heightAt(x, z) + 14);
    for (const u of [0.2, 0.4, 0.6]) {
      const hu = th.heightAt(x + (fx - x) * u, z + (fz - z) * u) + 8;
      y = Math.max(y, (hu - fy * u) / (1 - u));
    }
    this.cam.position.set(x, y, z);
    this.cam.lookAt(fx, fy, fz);
    // tilt the view up so the horizon sits near the top of the screen (fov 46: half 0.40 rad); fades out toward top-down zoom
    const k = this.kFor(dist), u = Math.min(1, Math.max(0, (k - 0.3) / 0.7)), fade = 1 - u * u * (3 - 2 * u);
    this.cam.rotateX(Math.max(0, p - 0.32) * fade);
    this.cam.updateMatrixWorld();
  }
  // scripted placement (intro)
  set(fx, fz, yaw, dist) {
    Object.assign(this.s, { fx, fz, yaw, dist });
    Object.assign(this.t, { fx, fz, yaw, dist });
  }
}
