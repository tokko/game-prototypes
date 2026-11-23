import * as THREE from 'three';
import { angDiff, clamp } from './util.js?v=32';

const _hip = new THREE.Vector3(), _ank = new THREE.Vector3(), _d = new THREE.Vector3(), _bend = new THREE.Vector3(), _knee = new THREE.Vector3(), _fwd = new THREE.Vector3(), _t = new THREE.Vector3(), _foot = new THREE.Vector3();

// Procedural two-legged gait with foot planting + 2-bone IK. Used by the player walker and the colossi.
export class Legs {
  constructor(scene, o) {
    this.o = o; this.time = 0; this.feet = [];
    for (const side of [1, -1]) {
      const f = { side, pos: new THREE.Vector3(), from: new THREE.Vector3(), t: 1, planted: true, yaw: 0, yawFrom: 0, lastLand: -9,
        thigh: null, shin: null, meta: null, foot: null };
      // o.makeParts(side) supplies ready-made segment objects (the scout walker's GLB legs, with a third "meta" segment)
      if (o.makeParts) Object.assign(f, o.makeParts(side));
      else { f.thigh = new THREE.Mesh(o.thighGeo, o.mat); f.shin = new THREE.Mesh(o.shinGeo, o.mat); f.foot = new THREE.Mesh(o.footGeo, o.mat); }
      scene.add(f.thigh, f.shin, f.foot); if (f.meta) scene.add(f.meta); this.feet.push(f);
    }
  }
  setVisible(v) { for (const f of this.feet) { f.thigh.visible = f.shin.visible = f.foot.visible = v; if (f.meta) f.meta.visible = v; } }
  reset(pos, yaw) {
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    for (const f of this.feet) { f.pos.set(pos.x + lx * f.side * this.o.hipW, 0, pos.z + lz * f.side * this.o.hipW); f.planted = true; f.t = 1; f.yaw = yaw; }
  }
  update(dt, pos, yaw, vx, vz, hipY, tilt = 0) {
    const o = this.o; this.time += dt;
    const lx = Math.cos(yaw), lz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
    const speed = Math.hypot(vx, vz), sn = Math.min(1, speed / o.refSpeed);
    const stepT = o.stepTime / (1 + sn * 0.7);
    const dirx = speed > 0.01 ? vx / speed : 0, dirz = speed > 0.01 ? vz / speed : 0;
    let want = null, wantD = 0;
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k], other = this.feet[1 - k];
      const nx = pos.x + lx * f.side * o.hipW, nz = pos.z + lz * f.side * o.hipW;
      if (f.planted) {
        const d = Math.hypot(nx + vx * stepT * 0.5 - f.pos.x, nz + vz * stepT * 0.5 - f.pos.z);
        const thr = speed < 0.4 ? o.stride * 0.14 : o.stride * 0.5;
        if ((d > thr || Math.abs(angDiff(yaw, f.yaw)) > 0.45) && other.planted && this.time - other.lastLand > stepT * 0.12 && d > wantD) { want = f; wantD = d; }
      } else {
        f.t += dt / stepT;
        const tx = nx + vx * stepT * 0.5 + dirx * o.stride * 0.5 * sn, tz = nz + vz * stepT * 0.5 + dirz * o.stride * 0.5 * sn;
        const t = Math.min(1, f.t), e = t * t * (3 - 2 * t);
        f.pos.x = f.from.x + (tx - f.from.x) * e; f.pos.z = f.from.z + (tz - f.from.z) * e;
        f.pos.y = Math.sin(Math.PI * t) * o.stepH * (0.45 + 0.55 * sn) * (t < 0.5 ? 1 : 0.85);
        f.yaw = f.yawFrom + angDiff(yaw, f.yawFrom) * e;
        if (f.t >= 1) { f.planted = true; f.pos.y = 0; f.lastLand = this.time; if (o.onStep) o.onStep(f, sn); }
      }
    }
    if (want) { want.planted = false; want.t = 0; want.from.copy(want.pos); want.yawFrom = want.yaw; }
    // IK + meshes
    _fwd.set(fx, 0, fz);
    for (const f of this.feet) {
      _hip.set(pos.x + lx * f.side * o.hipW * 0.82, hipY + f.side * tilt, pos.z + lz * f.side * o.hipW * 0.82);
      _ank.set(f.pos.x, f.pos.y + o.footH, f.pos.z);
      if (o.metaL) {
        // digitigrade leg: a rigid metatarsus rises back from the ankle to the hock; thigh + shin are solved hip -> hock.
        // The lean follows the stride (upright at toe-off, folded back when the foot reaches ahead) and tucks while the foot is in the air.
        const ffx = Math.sin(f.yaw), ffz = Math.cos(f.yaw), lift = f.planted ? 0 : Math.sin(Math.PI * Math.min(1, f.t));
        const ahead = (_hip.x - f.pos.x) * ffx + (_hip.z - f.pos.z) * ffz;
        const th = clamp(o.metaLean + lift * 0.5 - ahead * 0.05, 0.08, 1.3), sn2 = Math.sin(th) * o.metaL;
        _foot.copy(_ank); _ank.set(_ank.x - ffx * sn2, _ank.y + Math.cos(th) * o.metaL, _ank.z - ffz * sn2);   // _ank is now the hock
        // over-reach: swing the metatarsus toward the hip until the hock comes within reach of thigh + shin
        const mx = o.thighL + o.shinL - 0.02;
        if (_ank.distanceTo(_hip) > mx) for (const k of [0.35, 0.6, 1]) {
          _t.subVectors(_ank, _foot).normalize(); _d.subVectors(_hip, _foot).normalize(); _t.lerp(_d, k).normalize();
          _ank.copy(_foot).addScaledVector(_t, o.metaL); if (_ank.distanceTo(_hip) <= mx) break;
        }
      }
      _d.subVectors(_ank, _hip); let len = _d.length(); const maxL = o.thighL + o.shinL - 0.02;
      if (len > maxL) {
        _d.multiplyScalar(maxL / len); len = maxL; _ank.addVectors(_hip, _d);
        if (o.metaL) { _t.subVectors(_foot, _ank).normalize(); _foot.copy(_ank).addScaledVector(_t, o.metaL); }   // still out of reach: the whole lower leg stays rigid and the foot is drawn in with it
      }
      _d.multiplyScalar(1 / len);
      const a = Math.acos(clamp((o.thighL * o.thighL + len * len - o.shinL * o.shinL) / (2 * o.thighL * len), -1, 1));
      _bend.copy(_fwd).multiplyScalar(o.knee); _bend.addScaledVector(_d, -_bend.dot(_d)).normalize();
      _knee.copy(_hip).addScaledVector(_d, Math.cos(a) * o.thighL).addScaledVector(_bend, Math.sin(a) * o.thighL);
      f.thigh.position.copy(_hip); f.thigh.up.copy(_fwd); f.thigh.lookAt(_knee);
      f.shin.position.copy(_knee); f.shin.up.copy(_fwd); f.shin.lookAt(_ank);
      if (o.metaL) { f.meta.position.copy(_ank); f.meta.up.copy(_fwd); f.meta.lookAt(_foot); }
      if (o.metaL) f.foot.position.set(_foot.x, _foot.y - o.footH, _foot.z); else f.foot.position.set(f.pos.x, f.pos.y, f.pos.z);
      f.foot.rotation.set(f.planted ? 0 : o.metaL ? Math.sin(2 * Math.PI * Math.min(1, f.t)) * 0.42 : -Math.sin(Math.PI * Math.min(1, f.t)) * 0.25, f.yaw, 0, 'YXZ');
    }
  }
}
