// Crushable obstacles: a tank driving into a registered 'crush' collider above its minSpeed knocks the object down.
// The collider is removed immediately (World.crushCollider); the visual falls over a short animation, either by editing
// instance matrices (trees, fences, bales ...) or by rotating a small Object3D (poles, lamps, boom gate), or the whole
// light building squashes into a rubble pad. Created by Game and stored as world.crush before the builders run.
import { Matrix4, Quaternion, Vector3 } from 'three';

const _q = new Quaternion(), _ax = new Vector3(), _m1 = new Matrix4(), _m2 = new Matrix4(), _m3 = new Matrix4();
const ease = (s) => s * s * (1.4 - 0.4 * s); // accelerating fall

export class Crush {
  constructor(world) {
    this.world = world;
    world.crush = this;
    this.anims = [];
    this.onFx = null; // (x, y, z, kind) => void, set by Game for dust / leaf puffs
    this.fallen = 0;
  }

  // rigs: [{ mesh, index }] (instanced) or [{ obj }] (Object3D with its origin at the base). Rigs may be shared by several
  // colliders (fence posts): a rig that already fell is skipped. o: { height, mode, minSpeed, slow, jolt, shove, sink, dur, fx, y }
  _prep(rigs, px, py, pz) {
    return rigs.map((r) => {
      if (r.ready) return r;
      r.ready = true; r.fallen = false;
      if (r.mesh) { r.base = new Matrix4(); r.mesh.getMatrixAt(r.index, r.base); r.p = r.p || new Vector3(px, py, pz); }
      else { r.baseQ = r.obj.quaternion.clone(); r.p = r.obj.position.clone(); }
      return r;
    });
  }

  _opts(rigs, px, py, pz, o) {
    const prepared = this._prep(rigs, px, py, pz);
    const h = o.height || 2;
    return {
      cls: 'crush', minSpeed: o.minSpeed || 0, slow: o.slow === undefined ? 0.92 : o.slow, jolt: o.jolt || 0.04, noRay: !!o.noRay,
      height: o.colHeight || h, y0: o.y0, tag: o.tag || 'crushable',
      onCrush: (c, dx, dz, sp) => this._start(prepared, px, py, pz, dx, dz, sp, o),
    };
  }

  circle(x, z, r, rigs, o = {}) {
    const py = o.y !== undefined ? o.y : this.world.terrain.getHeight(x, z);
    return this.world.addCircle(x, z, r, this._opts(rigs, x, py, z, o));
  }

  box(x, z, hx, hz, heading, rigs, o = {}) {
    const py = o.y !== undefined ? o.y : this.world.terrain.getHeight(x, z);
    return this.world.addBox(x, z, hx, hz, heading, this._opts(rigs, x, py, z, o));
  }

  _start(rigs, px, py, pz, dx, dz, speed, o) {
    if (o.dirFn) { const d = o.dirFn(dx, dz); dx = d[0]; dz = d[1]; } // e.g. fences fall sideways, not along their length
    if (o.onStart) o.onStart();
    const list = rigs.filter((r) => !r.fallen);
    for (const r of list) r.fallen = true;
    if (this.onFx) this.onFx(px, py + (o.height || 2) * 0.5, pz, o.fx || 'dust', o.height || 2);
    if (!list.length) return;
    const l = Math.hypot(dx, dz) || 1;
    this.fallen++;
    this.anims.push({
      rigs: list, dx: dx / l, dz: dz / l, t: 0, dur: o.dur || (0.45 + 0.06 * (o.height || 2)), maxAng: o.maxAng || 1.5,
      shove: o.shove || 0, sink: o.sink || 0, o, px, py, pz, fx2: false,
    });
  }

  // a light structure collapses into a rubble pad: the group (built in world space) is squashed about its footprint centre
  squash(group, cx, cz, gy, final = 0.22) {
    return (c, dx, dz) => {
      if (this.onFx) this.onFx(cx, gy + 2, cz, 'rubble', 6);
      this.anims.push({ squash: { group, cx, cz, gy, final }, t: 0, dur: 1.1, dx, dz, rigs: [], o: {} });
    };
  }

  update(dt) {
    const A = this.anims;
    for (let i = A.length - 1; i >= 0; i--) {
      const a = A[i];
      a.t += dt;
      const s = Math.min(1, a.t / a.dur), e = ease(s);
      if (a.squash) {
        const q = a.squash, sy = 1 - (1 - q.final) * e, k = 1 + 0.12 * e;
        q.group.scale.set(k, sy, k);
        q.group.position.set(q.cx * (1 - k), q.gy * (1 - sy), q.cz * (1 - k));
        if (s >= 1) A.splice(i, 1);
        continue;
      }
      const ang = a.maxAng * e;
      _ax.set(a.dz, 0, -a.dx);
      _q.setFromAxisAngle(_ax, ang);
      const ox = a.dx * a.shove * e, oz = a.dz * a.shove * e, oy = -a.sink * e;
      for (const r of a.rigs) {
        const p = r.p;
        if (r.mesh) {
          _m1.makeTranslation(-p.x, -p.y, -p.z);
          _m2.makeRotationFromQuaternion(_q);
          _m1.premultiply(_m2);
          _m3.makeTranslation(p.x + ox, p.y + oy, p.z + oz);
          _m1.premultiply(_m3);
          _m1.multiply(r.base);
          r.mesh.setMatrixAt(r.index, _m1);
          r.mesh.instanceMatrix.needsUpdate = true;
        } else {
          r.obj.quaternion.copy(_q).multiply(r.baseQ);
          r.obj.position.set(p.x + ox, p.y + oy, p.z + oz);
          if (!r.obj.matrixAutoUpdate) r.obj.updateMatrix();
        }
      }
      if (s > 0.85 && !a.fx2) { a.fx2 = true; if (this.onFx) this.onFx(a.px + a.dx * (a.o.height || 2) * 0.6, a.py + 0.3, a.pz + a.dz * (a.o.height || 2) * 0.6, a.o.fx2 || 'thud', a.o.height || 2); }
      if (s >= 1) A.splice(i, 1);
    }
  }
}
