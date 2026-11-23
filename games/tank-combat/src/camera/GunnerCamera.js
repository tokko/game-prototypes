// Gunner optics: blends the camera from the chase view to the sight on the turret, with stepped magnification.
import { smoothstep, clamp, damp } from '../util/math.js';

export const MAGNIFICATIONS = [3, 4, 6, 8, 12];
const SIGHT_HALF_TAN = Math.tan((25 * Math.PI) / 180); // 1x == 50 deg vertical

export class GunnerCamera {
  constructor(baseFov = 62) {
    this.baseFov = baseFov;
    this.active = false;
    this.t = 0;          // linear transition 0..1
    this.magIndex = 2;   // default 6x
    this.magSmooth = 6;  // smoothed magnification for the FOV
    this.fov = baseFov;
    this.duration = 0.4;
  }

  get mag() { return MAGNIFICATIONS[this.magIndex]; }
  get amount() { return smoothstep(0, 1, this.t); }
  get isOptics() { return this.t > 0.02; }

  toggle() { this.active = !this.active; }
  setActive(a) { this.active = a; }
  stepMagnification(dir) { this.magIndex = clamp(this.magIndex + dir, 0, MAGNIFICATIONS.length - 1); }

  update(dt) {
    const target = this.active ? 1 : 0;
    this.t += clamp(target - this.t, -dt / this.duration, dt / this.duration);
    this.magSmooth = Math.exp(Math.log(this.magSmooth) + (Math.log(this.mag) - Math.log(this.magSmooth)) * damp(12, dt));
  }

  // mouse sensitivity multiplier: narrower view = slower turn
  sensitivityScale() {
    return Math.tan((this.fov * Math.PI) / 360) / Math.tan((this.baseFov * Math.PI) / 360);
  }

  // blend camera pose/FOV between the chase position and the sight position
  apply(camera, thirdPos, sightPos) {
    const e = this.amount;
    camera.position.lerpVectors(thirdPos, sightPos, e);
    const sightFov = (2 * Math.atan(SIGHT_HALF_TAN / this.magSmooth) * 180) / Math.PI;
    const fov = Math.exp(Math.log(this.baseFov) + (Math.log(sightFov) - Math.log(this.baseFov)) * e);
    this.fov = fov;
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
