// Pooled physical projectiles. Every step is a segment raycast against terrain + colliders
// (sub-stepped by speed) so fast rounds cannot tunnel. Tracers are drawn as one instanced mesh.
import {
  InstancedMesh, BoxGeometry, MeshBasicMaterial, InstancedBufferAttribute, AdditiveBlending, DynamicDrawUsage,
  Vector3, Quaternion, Matrix4,
} from 'three';
import { GRAVITY } from './Ballistics.js';

const Z = new Vector3(0, 0, 1);

export class ProjectilePool {
  // onImpact(proj, hit) is called for every impact (hit = { x, y, z, nx, ny, nz, kind, collider, dist })
  constructor(scene, world, max = 192) {
    this.world = world;
    this.max = max;
    this.onImpact = null;
    this.onTrail = null; // (proj, dt) for projectiles with def.trail
    this.onGuide = null; // (proj, dt) steers projectiles with def.guided
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, def: null, owner: null, age: 0, seq: 0,
        px: 0, py: 0, pz: 0, ox: 0, oy: 0, oz: 0, team: null, guided: false, lostT: 0, drift: 0, driftDir: 0,
      });
    }
    this.seq = 0;
    const mat = new MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, fog: false, transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };
    this._q = new Quaternion();
    this._d = new Vector3();
    this._p = new Vector3();
    this._s = new Vector3();
    this._m = new Matrix4();
    this.activeCount = 0;
  }

  spawn(def, ox, oy, oz, dx, dy, dz, owner, speed) {
    let p = null, oldest = null;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (!it.active) { p = it; break; }
      if (!oldest || it.seq < oldest.seq) oldest = it;
    }
    if (!p) p = oldest;
    const sp = speed || def.speed;
    p.active = true; p.def = def; p.owner = owner; p.age = 0; p.seq = ++this.seq;
    p.x = ox; p.y = oy; p.z = oz; p.px = ox; p.py = oy; p.pz = oz; p.ox = ox; p.oy = oy; p.oz = oz;
    p.team = null; p.guided = !!def.guided; p.lostT = 0; p.drift = 0; p.driftDir = 0;
    p.vx = dx * sp; p.vy = dy * sp; p.vz = dz * sp;
    return p;
  }

  update(dt, camera) {
    const hit = this._hit;
    let k = 0;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.age += dt;
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      const nSub = Math.max(1, Math.ceil((speed * dt) / 45));
      const sdt = dt / nSub;
      let dead = false;
      for (let s = 0; s < nSub; s++) {
        if (!p.def.noGravity || !p.guided) p.vy -= GRAVITY * sdt; // a missile that lost its wire falls ballistically
        if (p.def.guided && this.onGuide) this.onGuide(p, sdt); // also steers the drift of a missile that lost its wire
        const nx = p.x + p.vx * sdt, ny = p.y + p.vy * sdt, nz = p.z + p.vz * sdt;
        if (this.world.raycastSegment(p.x, p.y, p.z, nx, ny, nz, p.owner, hit)) {
          hit.dist = hit.dist || 0;
          if (hit.collider && hit.collider.onHit) hit.collider.onHit(hit, p);
          if (this.onImpact) this.onImpact(p, hit);
          dead = true;
          break;
        }
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.x = nx; p.y = ny; p.z = nz;
      }
      if (!dead && p.def.burstTime && p.age >= p.def.burstTime) {
        hit.x = p.x; hit.y = p.y; hit.z = p.z; hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.kind = 'air'; hit.collider = null; hit.dist = 0;
        if (this.onImpact) this.onImpact(p, hit);
        dead = true;
      }
      if (!dead && p.def.trail && this.onTrail) this.onTrail(p, dt);
      if (!dead && (p.age > p.def.life || p.y < -80 || Math.abs(p.x) > 1500 || Math.abs(p.z) > 1500)) dead = true;
      if (dead) { p.active = false; continue; }

      if (p.def.noTracer) continue;
      // tracer instance: oriented along velocity, widened with distance so it stays visible
      const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) || 1;
      this._d.set(p.vx / sp, p.vy / sp, p.vz / sp);
      this._q.setFromUnitVectors(Z, this._d);
      const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2);
      const w = p.def.tracerWidth * Math.min(14, Math.max(1, dist / 55));
      const len = p.def.tracerLen * Math.min(5, Math.max(1, dist / 220));
      this._s.set(w, w, len);
      this._p.set(p.x - this._d.x * len * 0.5, p.y - this._d.y * len * 0.5, p.z - this._d.z * len * 0.5);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(k, this._m);
      const c = p.def.tracerColor;
      const arr = this.mesh.instanceColor.array;
      arr[k * 3] = c[0]; arr[k * 3 + 1] = c[1]; arr[k * 3 + 2] = c[2];
      k++;
    }
    this.mesh.count = k;
    this.activeCount = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
