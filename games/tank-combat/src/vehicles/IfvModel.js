// Cheap procedural 8x8 wheeled IFV: sloped box hull, eight wheels, small turret with an autocannon.
// Same public interface as TankModel (root, hull, turret, gunPivot, recoilGroup, muzzle, sightMount, fireAnchor, mats,
// updateTracks, setRecoil, setYawPitch) so the enemy entity, turret controller and burnModel work unchanged.
// Local frame: ground at y = 0, forward = +Z, left = +X, ~6.8 m long, ~2.9 m wide, 2.6 m tall with the turret.
import { Group, Mesh, MeshStandardMaterial, Object3D, BoxGeometry, CylinderGeometry, Matrix4, Euler, Vector3, Quaternion } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../environment/Atmosphere.js';

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const std = (o) => patchMaterial(new MeshStandardMaterial(Object.assign({ metalness: 0.1, roughness: 0.85 }, o)));
  SHARED = {
    paint: std({ color: 0x5b6149, roughness: 0.9 }),
    dark: std({ color: 0x1d1e1b, roughness: 0.95 }),
    wheel: std({ color: 0x151514, roughness: 0.95, metalness: 0 }),
    barrel: std({ color: 0x2b2c29, roughness: 0.55, metalness: 0.5 }),
  };
  return SHARED;
}

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _v = new Vector3(), _s = new Vector3(1, 1, 1);
function put(list, geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  const g = geo.clone();
  g.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _s));
  list.push(g);
}
function mergedMesh(parent, list, mat) {
  if (!list.length) return;
  const g = mergeGeometries(list.map((l) => (l.index ? l.toNonIndexed() : l)));
  const m = new Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
}

export class IfvModel {
  constructor() {
    const M = shared();
    this.kind = 'ifv';
    this.mats = { paint: M.paint, dark: M.dark, wheel: M.wheel, barrel: M.barrel };
    this.root = new Group(); this.root.name = 'IfvModel';
    this.hull = new Group(); this.root.add(this.hull);

    // hull: lower box, sloped glacis, upper deck, fenders, rear block, hatches
    const P = [], D = [];
    put(P, new BoxGeometry(2.6, 0.95, 6.5), 0, 1.15, 0);
    put(P, new BoxGeometry(2.5, 0.12, 1.9), 0, 1.5, 3.05, -0.5);      // sloped glacis
    put(P, new BoxGeometry(2.3, 0.62, 3.9), 0, 1.92, -0.55);          // upper deck
    put(P, new BoxGeometry(2.3, 0.1, 1.5), 0, 1.78, 2.25, -0.3);      // forward deck slope
    for (const s of [-1, 1]) {
      put(P, new BoxGeometry(0.55, 0.09, 6.3), s * 1.42, 1.2, 0);     // fenders over the wheels
      put(P, new BoxGeometry(0.1, 0.55, 6.0), s * 1.27, 0.95, 0);     // side skirt
      put(P, new CylinderGeometry(0.28, 0.28, 0.12, 10), s * 0.7, 2.28, -1.9); // hatches
    }
    put(P, new BoxGeometry(2.4, 0.7, 0.5), 0, 1.35, -3.3);            // rear block
    put(D, new BoxGeometry(1.5, 0.06, 0.04), 0, 1.2, 3.12);           // headlight bar
    put(D, new BoxGeometry(0.5, 0.4, 0.1), 0, 1.25, -3.58);           // exhaust / rear door shadow
    put(D, new BoxGeometry(2.0, 0.08, 1.1), 0, 1.74, 2.45, -0.3);     // driver vision strip (dark)
    mergedMesh(this.hull, P, M.paint);
    mergedMesh(this.hull, D, M.dark);

    // turret: yaw pivot on the deck
    this.turret = new Group(); this.turret.position.set(0, 2.2, -0.3); this.root.add(this.turret);
    const T = [], TD = [];
    put(T, new BoxGeometry(1.6, 0.5, 1.85), 0, 0.27, 0);
    put(T, new BoxGeometry(1.45, 0.14, 0.8), 0, 0.27, 1.05, -0.45); // sloped front
    put(T, new BoxGeometry(0.35, 0.22, 0.4), 0.55, 0.62, -0.2);     // commander sight box
    put(TD, new BoxGeometry(0.3, 0.12, 0.05), -0.45, 0.4, 1.12);    // sight glass
    mergedMesh(this.turret, T, M.paint);
    mergedMesh(this.turret, TD, M.dark);

    // gun pivot + barrel (30 mm class cannon with a thick sleeve)
    this.gunPivot = new Group(); this.gunPivot.position.set(0.3, 0.28, 0.95); this.turret.add(this.gunPivot);
    const housing = new Mesh(new BoxGeometry(0.28, 0.24, 0.5), M.paint); housing.position.z = 0.1; housing.castShadow = true; this.gunPivot.add(housing);
    this.recoilGroup = new Group(); this.gunPivot.add(this.recoilGroup);
    const sleeve = new Mesh(new CylinderGeometry(0.07, 0.07, 1.0, 8), M.barrel); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.75; sleeve.castShadow = true;
    const tube = new Mesh(new CylinderGeometry(0.04, 0.04, 1.5, 8), M.barrel); tube.rotation.x = Math.PI / 2; tube.position.z = 1.7; tube.castShadow = true;
    this.recoilGroup.add(sleeve, tube);
    this.muzzle = new Object3D(); this.muzzle.position.set(0, 0, 2.45); this.recoilGroup.add(this.muzzle);
    this.mgMuzzle = new Object3D(); this.mgMuzzle.position.set(-0.2, 0, 0.6); this.gunPivot.add(this.mgMuzzle);
    this.sightMount = new Object3D(); this.sightMount.position.set(-0.45, 0.55, 0.5); this.turret.add(this.sightMount);
    this.dischargers = [];
    this.exhaustPoint = new Object3D(); this.exhaustPoint.position.set(0, 1.2, -3.5); this.hull.add(this.exhaustPoint);
    this.fireAnchor = new Object3D(); this.fireAnchor.position.set(0, 2.1, -1.0); this.hull.add(this.fireAnchor);

    // eight wheels (2 x 4 axles); spin with the track speeds
    this.wheelsL = []; this.wheelsR = [];
    const wg = new CylinderGeometry(0.52, 0.52, 0.42, 14);
    wg.rotateZ(Math.PI / 2);
    for (const side of [1, -1]) {
      for (const z of [-2.6, -0.9, 0.9, 2.6]) {
        const g = new Group(); g.position.set(side * 1.45, 0.52, z);
        const w = new Mesh(wg, M.wheel); w.castShadow = true; w.receiveShadow = true;
        g.add(w); this.root.add(g);
        (side > 0 ? this.wheelsL : this.wheelsR).push(g);
      }
    }
    this.antenna = new Mesh(new CylinderGeometry(0.012, 0.012, 2.2, 5), M.dark); this.antenna.position.set(-0.9, 3.3, -2.9); this.antenna.rotation.z = 0.08;
    this.root.add(this.antenna);
  }

  updateTracks(vL, vR, dt) {
    for (const g of this.wheelsL) g.rotation.x += (vL / 0.52) * dt;
    for (const g of this.wheelsR) g.rotation.x += (vR / 0.52) * dt;
  }

  setRecoil(offset) { this.recoilGroup.position.z = -offset * 0.4; }

  setYawPitch(turretYaw, gunPitch) {
    this.turret.rotation.y = turretYaw;
    this.gunPivot.rotation.x = -gunPitch;
  }
}
