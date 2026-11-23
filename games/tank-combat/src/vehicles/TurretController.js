// Turret traverse and gun elevation: slews toward a world-space aim point at limited rates,
// stabilised against hull motion (the hull-relative angles are recomputed every frame).
import { Vector3, Quaternion } from 'three';
import { wrapPi, clamp, DEG } from '../util/math.js';
import { solveElevation } from '../combat/Ballistics.js';

export class TurretController {
  constructor(model) {
    this.model = model;
    this.yaw = 0;    // relative to hull
    this.pitch = 0;  // relative to hull plane (nose-up positive)
    this.yawRate = 40 * DEG;
    this.pitchRate = 20 * DEG;
    this.minPitch = -8 * DEG;
    this.maxPitch = 20 * DEG;
    this._d = new Vector3();
    this._p = new Vector3();
    this._qi = new Quaternion();
    this.worldYaw = 0;
  }

  // Slew toward 'point' (world space) compensating for the ammo's drop. Call after the hull has been synced.
  update(dt, point, muzzleVelocity) {
    const m = this.model;
    m.gunPivot.getWorldPosition(this._p);
    const dx = point.x - this._p.x, dy = point.y - this._p.y, dz = point.z - this._p.z;
    const dh = Math.hypot(dx, dz);
    const yawW = Math.atan2(dx, dz);
    const el = solveElevation(dh, dy, muzzleVelocity);
    const ce = Math.cos(el);
    this._d.set(Math.sin(yawW) * ce, Math.sin(el), Math.cos(yawW) * ce);
    // into hull space
    this._qi.copy(m.root.quaternion).invert();
    this._d.applyQuaternion(this._qi);
    const tYaw = Math.atan2(this._d.x, this._d.z);
    const tPitch = clamp(Math.asin(clamp(this._d.y, -1, 1)), this.minPitch, this.maxPitch);

    const dy2 = wrapPi(tYaw - this.yaw);
    const sy = clamp(dy2 * 6, -this.yawRate, this.yawRate) * dt;
    this.yaw = wrapPi(this.yaw + (Math.abs(sy) > Math.abs(dy2) ? dy2 : sy));
    const dp = tPitch - this.pitch;
    const sp = clamp(dp * 6, -this.pitchRate, this.pitchRate) * dt;
    this.pitch += Math.abs(sp) > Math.abs(dp) ? dp : sp;

    m.setYawPitch(this.yaw, this.pitch);
    m.root.updateMatrixWorld(true);
  }

  // current barrel direction in world space
  getGunDirection(out) {
    return out.set(0, 0, 1).transformDirection(this.model.gunPivot.matrixWorld);
  }
}
