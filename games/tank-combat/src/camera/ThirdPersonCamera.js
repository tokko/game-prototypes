// Chase camera that orbits the tank with the mouse aim (yaw/pitch), independent of turret and hull.
// Follows the hull position with damping, never clips terrain and pulls in when geometry blocks the view.
import { Vector3 } from 'three';
import { damp } from '../util/math.js';

export class ThirdPersonCamera {
  constructor(world) {
    this.world = world;
    this.position = new Vector3();
    this.focus = new Vector3();
    this.dir = new Vector3();
    this.distance = 13.5;
    this.curDist = this.distance;
    this.height = 3.1;
    this.shoulder = 1.0;
    this.ready = false;
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };
    this._target = new Vector3();
  }

  // aim direction (unit) from yaw/pitch: forward = (sin yaw cos p, sin p, cos yaw cos p)
  static aimDir(out, yaw, pitch) {
    const cp = Math.cos(pitch);
    return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  }

  update(dt, yaw, pitch, tank) {
    const t = this._target;
    // right-hand vector of the aim heading = (-cos yaw, 0, sin yaw)
    t.set(tank.x - Math.cos(yaw) * this.shoulder, tank.y + this.height, tank.z + Math.sin(yaw) * this.shoulder);
    if (!this.ready) { this.focus.copy(t); this.ready = true; }
    else {
      const k = damp(9, dt);
      this.focus.x += (t.x - this.focus.x) * k;
      this.focus.z += (t.z - this.focus.z) * k;
      this.focus.y += (t.y - this.focus.y) * damp(6, dt);
    }
    ThirdPersonCamera.aimDir(this.dir, yaw, pitch);

    // desired distance, shortened when something blocks the line from the tank to the camera
    let want = this.distance;
    const f = this.focus, d = this.dir;
    if (this.world.raycastSegment(f.x, f.y, f.z, f.x - d.x * want, f.y - d.y * want, f.z - d.z * want, tank.collider ? tank : null, this._hit)) {
      want = Math.max(2.5, this._hit.dist - 0.8);
    }
    if (want < this.curDist) this.curDist = want;
    else this.curDist += (want - this.curDist) * damp(2.5, dt);
    this.position.set(f.x - d.x * this.curDist, f.y - d.y * this.curDist, f.z - d.z * this.curDist);

    // keep above the ground
    const gh = this.world.terrain.getHeight(this.position.x, this.position.z) + 1.1;
    if (this.position.y < gh) this.position.y = gh;
    return this.position;
  }
}
