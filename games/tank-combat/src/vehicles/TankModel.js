// Procedural modern MBT model, reusable for the player and enemies (variant = paint scheme).
// Local frame: ground at y = 0, forward = +Z, tank-left = +X, hull 7.0 m long, ~9.9 m with the gun.
// Turret is a lofted angular wedge, the barrel a lathe (no muzzle brake), paint gets a dust/mud/AO shader patch.
import {
  Group, Mesh, MeshStandardMaterial, Object3D, BoxGeometry, CylinderGeometry, CapsuleGeometry, LatheGeometry, Shape,
  ExtrudeGeometry, BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Matrix4, Quaternion, Euler, Vector3,
  DoubleSide, Color,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getGrimeTextures, getPaintTexture, getMaskTexture, VARIANTS, makeTrackTextures } from './TankTextures.js';
import {
  TrackAnimation, buildTrackGeometry, buildRoadWheelGeometry, buildSprocketGeometry, buildRollerGeometry,
} from './TrackAnimation.js';
import { patchMaterial } from '../environment/Atmosphere.js';

export const TANK_DIMS = {
  hullLength: 7.0, hullHalfWidth: 1.83, hullHalfLength: 3.5,
  turretPos: new Vector3(0, 1.5, 0.2),
  gunPivotPos: new Vector3(0, 0.42, 1.55),
  muzzleZ: 4.7,
};
// enemy "T-class": low dome turret, longer thinner gun, thin skirts (wheels visible), 6 road wheels
export const TANK_DIMS_ENEMY = {
  turretPos: new Vector3(0, 1.52, 0.35),
  gunPivotPos: new Vector3(0, 0.35, 1.05),
  muzzleZ: 5.4,
};

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler(), _v = new Vector3(), _s = new Vector3(1, 1, 1);

// ---- geometry accumulation by material ----
class Bucket {
  constructor() { this.map = new Map(); }

  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_v.set(x, y, z), _q, _s);
    g.applyMatrix4(_m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
  }

  box(mat, w, h, d, x, y, z, rx, ry, rz) { this.add(new BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz); }

  // axis: 'y' | 'z' | 'x'; rTop is the +axis end
  cyl(mat, rTop, rBot, len, axis, x, y, z, seg = 16, rx = 0, ry = 0, rz = 0) {
    const g = new CylinderGeometry(rTop, rBot, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    this.add(g, mat, x, y, z, rx, ry, rz);
  }

  // side profile [[z, y], ...] extruded across x (centred)
  profile(mat, pts, width, x = 0, y = 0, z = 0, bevel = 0.035) {
    const s = new Shape();
    pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    const g = new ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2, 0, 0);
    this.add(g, mat, x, y, z);
  }

  // merged geometry per material; yOff = height of this group's origin above the tank's ground (for the dust shader)
  merge(metricMats, yOff) {
    const out = {};
    for (const [mat, arr] of this.map) {
      const geo = mergeGeometries(arr);
      if (metricMats.includes(mat)) metricUV(geo, 1 / 2.5);
      const p = geo.attributes.position, h = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) h[i] = p.getY(i) + yOff;
      geo.setAttribute('aH', new Float32BufferAttribute(h, 1));
      out[mat] = geo;
    }
    return out;
  }
}

// triplanar-style UV in metres so the grime texture has a consistent scale everywhere
function metricUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true;
}

// Lofted angular turret: flat-shaded, three rings (undercut bottom, widest middle, sloped top) + caps.
function loftTurret() {
  const half = [[0.55, 2.15], [0.66, 2.42], [1.45, 2.12], [1.78, 1.20], [1.78, -0.90], [1.70, -1.55], [1.58, -2.60]];
  const ring = half.slice();
  for (let i = half.length - 1; i >= 0; i--) ring.push([-half[i][0], half[i][1]]);
  const N = ring.length;
  const rings = [
    { y: 0.0, pts: ring.map((p) => [p[0] * 0.9, p[1] * 0.93]) },
    { y: 0.3, pts: ring.map((p) => [p[0], p[1]]) },
    { y: 0.8, pts: ring.map((p) => [p[0] * 0.88, p[1] * 0.95 - 0.06]) },
  ];
  let area = 0;
  for (let i = 0; i < N; i++) { const a = ring[i], b = ring[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area >= 0 ? 1 : -1;
  const pos = [], nor = [];
  const push = (a, b, c, n) => {
    for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); }
  };
  const faceN = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  for (let band = 0; band < 2; band++) {
    const A = rings[band], B = rings[band + 1];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a0 = [A.pts[i][0], A.y, A.pts[i][1]], a1 = [A.pts[j][0], A.y, A.pts[j][1]];
      const b0 = [B.pts[i][0], B.y, B.pts[i][1]], b1 = [B.pts[j][0], B.y, B.pts[j][1]];
      const ex = ring[j][0] - ring[i][0], ez = ring[j][1] - ring[i][1];
      const out = [sgn * ez, 0, -sgn * ex];
      for (const tri of [[a0, a1, b1], [a0, b1, b0]]) {
        let n = faceN(tri[0], tri[1], tri[2]);
        let t = tri;
        if (n[0] * out[0] + n[2] * out[2] < 0) { t = [tri[0], tri[2], tri[1]]; n = faceN(t[0], t[1], t[2]); }
        push(t[0], t[1], t[2], n);
      }
    }
  }
  for (const [r, up] of [[rings[2], 1], [rings[0], -1]]) {
    const contour = r.pts.map((p) => new Vector2(p[0], p[1]));
    const tris = ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      const a = [contour[t[0]].x, r.y, contour[t[0]].y], b = [contour[t[1]].x, r.y, contour[t[1]].y], c = [contour[t[2]].x, r.y, contour[t[2]].y];
      let n = faceN(a, b, c), tt = [a, b, c];
      if (n[1] * up < 0) { tt = [a, c, b]; n = faceN(tt[0], tt[1], tt[2]); }
      push(tt[0], tt[1], tt[2], n);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

// gun barrel: one lathe (profile r, z) with fume extractor, thermal-sleeve clamps and muzzle crown
function barrelGeometry() {
  const prof = [
    [0.0, 0.30], [0.125, 0.30], [0.125, 0.75], [0.112, 0.80], [0.110, 1.70], [0.150, 1.80], [0.158, 1.88], [0.158, 2.42], [0.150, 2.50], [0.104, 2.58],
    [0.100, 3.10], [0.106, 3.12], [0.106, 3.17], [0.098, 3.19], [0.094, 3.90], [0.100, 3.92], [0.100, 3.97], [0.092, 3.99],
    [0.088, 4.62], [0.094, 4.64], [0.094, 4.70], [0.062, 4.70], [0.062, 4.66], [0.0, 4.66],
  ].map((p) => new Vector2(p[0], p[1]));
  const g = new LatheGeometry(prof, 24);
  g.rotateX(Math.PI / 2);
  return g;
}

const PARTS = {};

function buildParts(E = false) {
  const DIMS = E ? TANK_DIMS_ENEMY : TANK_DIMS;
  const hull = new Bucket(), turret = new Bucket(), mantlet = new Bucket(), gun = new Bucket();
  const P = 'paint', D = 'dark', G = 'glass', C = 'cloth', M = 'metal', R = 'rubber', B = 'barrel';
  const CA = 'clothA', CB = 'clothB', CC = 'clothC', CD = 'clothD';

  // ================= HULL =================
  hull.profile(P, [[-3.40, 0.44], [-3.45, 1.20], [-3.38, 1.42], [1.85, 1.50], [3.52, 0.98], [3.46, 0.56], [3.05, 0.44]], 2.5);
  hull.box(P, 1.9, 0.05, 0.12, 0, 1.40, 3.2, 0.33, 0, 0); // glacis lip
  for (const sx of [-1, 1]) {
    // upper hull sponsons over the tracks (top lowered 8 cm)
    hull.box(P, 0.54, 0.2, 5.45, sx * 1.47, 1.32, -0.65);
    hull.box(P, 0.54, 0.06, 1.55, sx * 1.47, 1.27, 2.82, 0.32, 0, 0);
    // side skirts: 6 cm slabs with a bottom lip, 1 cm seams, front two panels 12 cm (ERA-like)
    if (E) { // thin rubber-steel strip only: road wheels stay visible
      hull.box(P, 0.05, 0.3, 5.0, sx * 1.80, 1.07, -0.5);
      hull.box(P, 0.05, 0.3, 1.1, sx * 1.80, 1.07, 2.65, 0, sx * 0.08, 0);
    } else {
      for (let i = 0; i < 4; i++) {
        const z = -2.4 + i * 1.0;
        hull.box(P, 0.06, 0.75, 0.98, sx * 1.80, 0.995, z);
        hull.box(P, 0.1, 0.04, 0.98, sx * 1.83, 0.64, z);
      }
      for (const z of [1.6, 2.6]) {
        hull.box(P, 0.12, 0.72, 0.98, sx * 1.77, 0.985, z, 0, sx * (z > 2 ? 0.08 : 0), 0);
        hull.box(P, 0.15, 0.04, 0.98, sx * 1.8, 0.64, z, 0, sx * (z > 2 ? 0.08 : 0), 0);
      }
    }
    hull.box(D, 0.14, 0.04, 5.2, sx * 1.82, 1.4, -0.4);
    hull.box(R, 0.06, 0.4, 0.5, sx * 1.62, 0.45, -3.52);
    // stowage + equipment on the rear sponson
    hull.box(P, 0.5, 0.34, 0.9, sx * 1.47, 1.55, -2.75);
    hull.cyl(CB, 0.16, 0.16, 0.75, 'z', sx * 1.48, 1.6, -1.55, 12);
    hull.cyl(CC, 0.15, 0.15, 0.6, 'z', sx * 1.5, 1.58, -0.85, 12);
    hull.box(P, 0.3, 0.4, 0.16, sx * 1.62, 1.52, -2.15);
    hull.box(P, 0.3, 0.4, 0.16, sx * 1.62, 1.52, -1.95);
    hull.cyl(D, 0.028, 0.028, 4.2, 'z', sx * 1.32, 1.42, 0.0, 6); // tow cable
    hull.box(D, 0.22, 0.14, 0.12, sx * 1.52, 1.32, 2.35, 0.3, 0, 0);
    hull.box(G, 0.14, 0.08, 0.02, sx * 1.52, 1.33, 2.42, 0.3, 0, 0);
    hull.box(D, 0.2, 0.12, 0.08, sx * 1.55, 1.28, -3.4);
    hull.box(M, 0.1, 0.16, 0.16, sx * 0.95, 0.6, -3.5);
    hull.box(M, 0.1, 0.16, 0.16, sx * 0.75, 0.6, 3.5);
  }
  hull.box(P, 1.95, 0.1, 1.95, 0, 1.52, -2.3);
  for (let i = 0; i < 7; i++) hull.box(D, 1.65, 0.035, 0.1, 0, 1.585, -3.0 + i * 0.26);
  hull.box(D, 1.7, 0.5, 0.06, 0, 0.98, -3.47);
  for (let i = 0; i < 5; i++) hull.box(M, 1.7, 0.02, 0.07, 0, 0.8 + i * 0.1, -3.5);
  hull.box(P, 0.5, 0.2, 0.16, 0, 1.55, -0.8);
  hull.box(P, 0.85, 0.1, 0.7, 0, 1.40, 2.45, 0.32, 0, 0);
  hull.cyl(P, 0.32, 0.32, 0.07, 'y', 0, 1.47, 2.4, 20, 0.32, 0, 0);
  for (const dx of [-0.3, 0, 0.3]) hull.box(G, 0.17, 0.07, 0.07, dx, 1.42, 2.82, 0.32, 0, 0);
  hull.box(D, 0.26, 0.08, 0.2, 0.0, 1.45, 3.05, 0.32, 0, 0);
  hull.box(D, 1.2, 0.08, 0.1, 0, 0.7, 3.55);

  if (E) { // two fuel drums with steel bands on the rear deck
    for (const sx of [-1, 1]) {
      hull.cyl(P, 0.28, 0.28, 0.95, 'x', sx * 0.55, 1.78, -3.0, 14);
      for (const dx of [-0.25, 0.25]) hull.cyl(D, 0.295, 0.295, 0.04, 'x', sx * 0.55 + dx, 1.78, -3.0, 14);
    }
  }

  // ================= TURRET (origin = ring centre on the deck) =================
  if (E) {
    enemyTurret(turret, mantlet, gun);
  } else {
  turret.cyl(D, 1.45, 1.45, 0.1, 'y', 0, 0.0, 0, 32);
  turret.add(loftTurret(), P, 0, 0.04, 0);
  for (const sx of [-1, 1]) {
    turret.box(P, 0.9, 0.02, 0.9, sx * 0.55, 0.86, -1.85);                 // blow-out panels
    turret.box(P, 0.2, 0.38, 1.4, sx * 1.86, 0.49, -1.35);                 // side stowage boxes
    turret.cyl(CB, 0.15, 0.15, 0.9, 'z', sx * 1.9, 0.12, 0.9, 12);
    // smoke dischargers: base plate + two rows of three tubes (20 deg elevation, fanned in azimuth)
    turret.box(D, 0.12, 0.3, 0.5, sx * 1.84, 0.55, 1.35);
    const rows = [[0.07, [25, 45, 65]], [0.17, [15, 35, 55]]];
    rows.forEach(([dy, azs], ri) => azs.forEach((az, ci) => {
      const a = (az * Math.PI) / 180, el = (20 * Math.PI) / 180;
      const dir = new Vector3(sx * Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)).normalize();
      const qq = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
      const ee = new Euler().setFromQuaternion(qq);
      turret.cyl(D, 0.045, 0.045, 0.28, 'y', sx * 1.9, 0.55 + dy + 0.1 * dir.y, 1.2 + ci * 0.15 + 0.1 * dir.z, 10, ee.x, ee.y, ee.z);
    }));
  }
  // bustle rack frame + stowage (duffels, tarp roll, ammo cans, crate, jerrycans)
  for (const y of [0.25, 0.47, 0.70]) turret.cyl(D, 0.018, 0.018, 2.9, 'x', 0, y, -3.15, 6);
  for (let i = 0; i < 7; i++) turret.cyl(D, 0.018, 0.018, 0.45, 'y', -1.45 + i * 0.4833, 0.475, -3.15, 6);
  for (const sx of [-1, 1]) for (const y of [0.25, 0.7]) turret.cyl(D, 0.018, 0.018, 0.7, 'z', sx * 1.45, y, -2.8, 6);
  for (let i = 0; i < 12; i++) turret.cyl(D, 0.012, 0.012, 2.9, 'x', 0, 0.25, -2.6 - (i % 3) * 0.2 - 0.02, 5);
  const jr = (k) => (Math.sin(k * 12.9898) * 43758.5453 % 1) * 0.1;
  const duffel = (mat, r, len, x, y, z, k) => {
    const g = new CapsuleGeometry(r, len, 4, 10);
    g.rotateZ(Math.PI / 2); g.scale(1, 0.78, 1);
    turret.add(g, mat, x, y, z, jr(k), jr(k + 1), jr(k + 2));
  };
  duffel(CA, 0.2, 0.65, 0.85, 0.5, -2.85, 1); duffel(CB, 0.22, 0.8, -0.05, 0.52, -2.88, 4); duffel(CC, 0.18, 0.55, -0.85, 0.48, -2.8, 7);
  turret.cyl(CD, 0.15, 0.15, 1.9, 'x', 0, 0.82, -3.0, 12);
  for (const x of [-0.6, 0.6]) turret.box(D, 0.04, 0.34, 0.34, x, 0.82, -3.0);
  for (const dz of [0, -0.25]) turret.box(P, 0.3, 0.2, 0.16, -1.2, 0.36, -2.75 + dz);
  turret.box(P, 0.5, 0.3, 0.35, 1.2, 0.4, -2.95);
  for (const dz of [0, -0.3]) { turret.box(P, 0.165, 0.47, 0.345, -1.58, 0.45, -2.7 + dz, 0, 0, 0); turret.box(D, 0.02, 0.4, 0.3, -1.67, 0.45, -2.7 + dz); }
  // commander cupola (right = -x) with vision blocks and a remote weapon station
  turret.cyl(P, 0.42, 0.42, 0.16, 'y', -0.7, 0.88, -0.35, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    turret.box(G, 0.12, 0.07, 0.03, -0.7 + Math.sin(a) * 0.395, 0.9, -0.35 + Math.cos(a) * 0.395, 0, a, 0);
  }
  turret.cyl(P, 0.36, 0.36, 0.05, 'y', -0.7, 0.985, -0.35, 20, 0, 0, 0.1);
  turret.cyl(D, 0.07, 0.07, 0.2, 'y', -0.7, 1.11, -0.15, 8);
  turret.box(P, 0.34, 0.22, 0.5, -0.7, 1.32, -0.1);
  turret.box(D, 0.1, 0.12, 0.7, -0.92, 1.3, 0.1);
  turret.cyl(D, 0.016, 0.016, 0.75, 'z', -0.92, 1.3, 0.62, 8);
  turret.cyl(D, 0.025, 0.025, 0.1, 'z', -0.92, 1.3, 1.02, 8);
  turret.box(P, 0.22, 0.22, 0.3, -0.47, 1.3, -0.12);
  turret.box(D, 0.2, 0.16, 0.22, -0.7, 1.51, -0.05);
  turret.box(G, 0.14, 0.1, 0.02, -0.7, 1.51, 0.07);
  // loader hatch (left)
  turret.box(P, 0.75, 0.07, 0.7, 0.65, 0.835, -0.3);
  turret.box(G, 0.14, 0.06, 0.1, 0.65, 0.9, -0.05);
  // gunner primary sight (right front) with doors, and the CITV on a pedestal
  turret.box(P, 0.46, 0.4, 0.62, -0.95, 1.0, 1.2);
  for (const dx of [-0.1, 0.1]) turret.box(G, 0.17, 0.22, 0.02, -0.95 + dx, 1.0, 1.515);
  for (const s2 of [-1, 1]) turret.box(P, 0.2, 0.24, 0.03, -0.95 + s2 * 0.32, 1.0, 1.56, 0, s2 * 1.05, 0);
  turret.cyl(D, 0.15, 0.15, 0.25, 'y', 0.35, 0.925, 0.7, 12);
  turret.box(P, 0.34, 0.28, 0.32, 0.35, 1.19, 0.7);
  turret.box(G, 0.2, 0.14, 0.02, 0.35, 1.19, 0.87);
  // wind sensor mast and antennas (thin whips, slightly bent back)
  turret.cyl(D, 0.012, 0.012, 0.55, 'y', 0, 1.08, -1.2, 6);
  turret.box(D, 0.2, 0.02, 0.02, 0, 1.36, -1.2);
  for (const [sx, L] of [[1, 2.2], [-1, 1.6]]) {
    turret.cyl(D, 0.045, 0.045, 0.14, 'y', sx * 1.25, 0.87, -2.1, 10);
    const t = (8 * Math.PI) / 180;
    turret.cyl(P, 0.004, 0.008, L, 'y', sx * 1.25, 0.94 + (L / 2) * Math.cos(t), -2.1 - (L / 2) * Math.sin(t), 4, -t, 0, 0);
  }
  turret.box(D, 0.18, 0.1, 0.06, 1.0, 0.45, -2.75);

  // ================= MANTLET (child of the pitch pivot) =================
  {
    const s = new Shape();
    [[0.475, 0.25], [0.4, 0.31], [-0.4, 0.31], [-0.475, 0.25], [-0.475, -0.25], [-0.4, -0.31], [0.4, -0.31], [0.475, -0.25]].forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    const g = new ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
    mantlet.add(g, P, 0, 0, 0.25);
  }
  mantlet.cyl(D, 0.03, 0.03, 0.04, 'z', -0.3, -0.06, 0.7, 10);   // coax port
  mantlet.box(G, 0.08, 0.08, 0.01, 0.3, 0.1, 0.705);              // aux sight glass
  mantlet.cyl(C, 0.14, 0.2, 0.14, 'z', 0, 0, 0.77, 16);           // dust cover
  mantlet.cyl(D, 0.022, 0.022, 0.3, 'z', -0.3, -0.06, 0.88, 8);   // coax barrel stub

  // ================= GUN (recoiling group): lathe barrel + reference sensor =================
  gun.add(barrelGeometry(), B, 0, 0, 0);
  gun.box(D, 0.09, 0.07, 0.14, 0, 0.115, 4.55);
  gun.box(D, 0.02, 0.05, 0.02, 0, 0.085, 4.55);
  {
    const bore = new CylinderGeometry(0.06, 0.06, 0.004, 16);
    bore.rotateX(Math.PI / 2);
    gun.add(bore, D, 0, 0, 4.668);
  }

  }
  const metric = [P, C, CA, CB, CC, CD];
  return {
    hull: hull.merge(metric, 0), turret: turret.merge(metric, DIMS.turretPos.y), mantlet: mantlet.merge(metric, DIMS.turretPos.y + DIMS.gunPivotPos.y),
    gun: gun.merge(metric, DIMS.turretPos.y + DIMS.gunPivotPos.y),
    wheel: buildRoadWheelGeometry(E ? 0.38 : 0.36),
    idler: buildRoadWheelGeometry(0.36),
    sprocket: buildSprocketGeometry(0.4),
    roller: buildRollerGeometry(0.12),
    track: buildTrackGeometry(),
  };
}

function getParts(E) { const k = E ? 'e' : 'p'; return PARTS[k] || (PARTS[k] = buildParts(E)); }

// enemy turret: low rounded dome, ERA wedges and bricks, rear commander cupola with a 12.7 mm, IR searchlight,
// snorkel, 12 smoke tubes in an arc, long thin gun with a fume extractor and sleeve clamps
function enemyTurret(turret, mantlet, gun) {
  const P = 'paint', D = 'dark', G = 'glass', C = 'cloth', B = 'barrel';
  turret.cyl(D, 1.4, 1.4, 0.1, 'y', 0, 0.0, 0, 28);
  const dome = new LatheGeometry([[0, 0], [1.40, 0], [1.45, 0.12], [1.35, 0.32], [1.05, 0.50], [0.55, 0.60], [0, 0.62]].map((q) => new Vector2(q[0], q[1])), 16);
  dome.scale(1, 1, 1.12);
  turret.add(dome, P, 0, 0.04, 0.15);
  for (const sx of [-1, 1]) {
    turret.box(P, 0.9, 0.28, 0.12, sx * 0.95, 0.46, 1.2, 0, sx * 0.6, 0);        // ERA cheek wedges
    turret.box(P, 0.35, 0.1, 0.25, sx * 0.3, 0.66, 0.95);                          // ERA bricks (chevron)
    turret.box(P, 0.35, 0.1, 0.25, sx * 0.65, 0.62, 0.65, 0, sx * 0.3, 0);
    turret.box(P, 0.35, 0.1, 0.25, sx * 0.95, 0.56, 0.35, 0, sx * 0.5, 0);
  }
  turret.cyl(P, 0.38, 0.38, 0.2, 'y', 0.55, 0.72, -0.25, 12);                       // commander cupola (left rear)
  turret.box(D, 0.12, 0.14, 0.55, 0.55, 0.98, 0.1);
  turret.cyl(D, 0.02, 0.02, 1.1, 'z', 0.55, 0.98, 0.9, 8);
  turret.box(D, 0.3, 0.3, 0.3, -0.75, 0.55, 0.85);                                  // IR searchlight
  turret.cyl(G, 0.12, 0.12, 0.03, 'z', -0.75, 0.55, 1.0, 14);
  turret.cyl(D, 0.09, 0.09, 2.2, 'x', 0, 0.4, -1.6, 10);                           // snorkel
  turret.cyl(D, 0.04, 0.04, 0.14, 'y', -1.0, 0.7, -1.0, 8);
  turret.cyl(P, 0.004, 0.008, 2.4, 'y', -1.0, 1.9, -1.05, 4, -0.12, 0, 0);
  for (let i = 0; i < 12; i++) {                                                    // smoke tubes
    const az = ((-55 + (110 * i) / 11) * Math.PI) / 180, el = (20 * Math.PI) / 180;
    const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const qq = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir), ee = new Euler().setFromQuaternion(qq);
    turret.cyl(D, 0.045, 0.045, 0.28, 'y', Math.sin(az) * 1.15, 0.5, 0.6 + Math.cos(az) * 1.0, 10, ee.x, ee.y, ee.z);
  }
  mantlet.box(P, 0.8, 0.5, 0.5, 0, 0, 0.25);
  mantlet.cyl(C, 0.2, 0.26, 0.16, 'z', 0, 0, 0.58, 14);
  const prof = [
    [0, 0.3], [0.125, 0.3], [0.125, 0.7], [0.115, 0.75], [0.115, 1.4], [0.14, 1.45], [0.14, 1.95], [0.108, 2.0],
    [0.104, 2.8], [0.11, 2.82], [0.11, 2.87], [0.1, 2.89], [0.098, 3.7], [0.104, 3.72], [0.104, 3.77], [0.095, 3.79],
    [0.088, 5.0], [0.092, 5.02], [0.092, 5.05], [0.085, 5.4], [0, 5.4],
  ].map((q) => new Vector2(q[0], q[1]));
  const barrel = new LatheGeometry(prof, 20);
  barrel.rotateX(Math.PI / 2);
  gun.add(barrel, B, 0, 0, 0);
}

// dust gradient on the lower hull, top-surface dust, mud splatter, edge chips and cheap AO (all in the paint shader)
function paintShader(mat, dust) {
  const u = { value: dust };
  const dustCol = new Color('#9c8c6a'), mudCol = new Color('#5e4f3b'), wearCol = new Color('#7d7a66');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDust = u;
    shader.uniforms.uDustColor = { value: dustCol };
    shader.uniforms.uMudColor = { value: mudCol };
    shader.uniforms.uWearColor = { value: wearCol };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH;\nvarying float vH;\nvarying vec3 vWN;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vWN;\nuniform float uDust; uniform vec3 uDustColor; uniform vec3 uMudColor; uniform vec3 uWearColor;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  vec4 mk = texture2D(roughnessMap, vRoughnessMapUv);
  float up = smoothstep(0.6, 0.95, vWN.y);
  float dustAmt = uDust * (smoothstep(1.5, 0.25, vH) * (0.55 + 0.45 * mk.r) + 0.30 * up * mk.r);
  float mudAmt = smoothstep(0.9, 0.2, vH) * step(0.58, mk.r) * 0.6;
  float chips = pow(mk.b, 4.0) * 0.35;
  diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, chips);
  diffuseColor.rgb = mix(diffuseColor.rgb, uMudColor, mudAmt);
  diffuseColor.rgb = mix(diffuseColor.rgb, uDustColor, clamp(dustAmt, 0.0, 0.85));
  roughnessFactor = mix(roughnessFactor, 0.95, max(dustAmt, mudAmt));
  diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.2, 1.2, vH)) * mix(0.62, 1.0, smoothstep(-0.3, 0.2, vWN.y));
}`);
  };
  mat.customProgramCacheKey = () => 'tankPaint';
}

function createMaterials(variant) {
  const g = getGrimeTextures();
  const mask = getMaskTexture();
  const dust = (VARIANTS[variant] || VARIANTS.player).dustAmt;
  const paint = new MeshStandardMaterial({
    color: 0xffffff, map: getPaintTexture(variant), roughness: 1, roughnessMap: mask,
    bumpMap: g.bump, bumpScale: 1.0, metalness: 0.05, envMapIntensity: 0.4,
  });
  paintShader(paint, dust);
  const cloth = (hex) => {
    const m = new MeshStandardMaterial({ color: hex, map: g.map, roughness: 1, roughnessMap: mask, bumpMap: g.bump, bumpScale: 1.4, metalness: 0, envMapIntensity: 0.3 });
    paintShader(m, dust * 0.6);
    return m;
  };
  const mats = {
    paint,
    cloth: cloth(0x75694a), clothA: cloth(0x6b6448), clothB: cloth(0x3f4430), clothC: cloth(0x5c5a3e), clothD: cloth(0x4a4a36),
    dark: new MeshStandardMaterial({ color: 0x1b1c1a, roughness: 0.65, metalness: 0.3 }),
    glass: new MeshStandardMaterial({ color: 0x0a1218, roughness: 0.06, metalness: 0.85 }),
    metal: new MeshStandardMaterial({ color: 0x3e413b, roughness: 0.55, metalness: 0.6 }),
    barrel: new MeshStandardMaterial({ color: 0x2a2d28, roughness: 0.5, metalness: 0.55 }),
    rubber: new MeshStandardMaterial({ color: 0x131313, roughness: 0.95, metalness: 0 }),
    wheel: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.35 }),
  };
  for (const k of Object.keys(mats)) patchMaterial(mats[k]);
  return mats;
}

let TRACK_TEX = null;

function addMerged(group, geos, mats) {
  const meshes = [];
  for (const key in geos) {
    const mesh = new Mesh(geos[key], mats[key]);
    group.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

export class TankModel {
  constructor(variant = 'player') {
    const E = variant === 'enemy';
    const DIMS = E ? TANK_DIMS_ENEMY : TANK_DIMS;
    const P = getParts(E);
    this.variant = variant;
    this.kind = E ? 'enemy' : 'player';
    this.mats = createMaterials(variant);
    const mats = this.mats;

    this.root = new Group();
    this.root.name = 'TankModel';
    this.hull = new Group();
    this.root.add(this.hull);
    addMerged(this.hull, P.hull, mats);

    // turret pivot (yaw)
    this.turret = new Group();
    this.turret.position.copy(DIMS.turretPos);
    this.root.add(this.turret);
    addMerged(this.turret, P.turret, mats);

    // gun mantlet pivot (pitch)
    this.gunPivot = new Group();
    this.gunPivot.position.copy(DIMS.gunPivotPos);
    this.turret.add(this.gunPivot);
    addMerged(this.gunPivot, P.mantlet, mats);

    // barrel slides inside this group when recoiling
    this.recoilGroup = new Group();
    this.gunPivot.add(this.recoilGroup);
    addMerged(this.recoilGroup, P.gun, mats);
    this.muzzle = new Object3D();
    this.muzzle.position.set(0, 0, DIMS.muzzleZ);
    this.recoilGroup.add(this.muzzle);
    this.mgMuzzle = new Object3D();
    this.mgMuzzle.position.set(-0.3, -0.06, 0.95);
    this.gunPivot.add(this.mgMuzzle);

    // gunner sight mount (camera position for optics): above the primary sight housing
    this.sightMount = new Object3D();
    this.sightMount.position.set(-0.95, 1.3, 1.45);
    if (E) this.sightMount.position.set(-0.75, 0.85, 0.6);
    this.turret.add(this.sightMount);

    // smoke dischargers (12): markers at the tube mouths, userData.dir = launch direction in turret space
    this.dischargers = [];
    for (const sx of E ? [] : [-1, 1]) {
      [[0.07, [25, 45, 65]], [0.17, [15, 35, 55]]].forEach(([dy, azs]) => azs.forEach((az, ci) => {
        const a = (az * Math.PI) / 180, el = (20 * Math.PI) / 180;
        const dir = new Vector3(sx * Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)).normalize();
        const o = new Object3D();
        o.position.set(sx * 1.9 + dir.x * 0.3, 0.55 + dy + dir.y * 0.3, 1.2 + ci * 0.15 + dir.z * 0.3);
        o.userData.dir = dir.clone();
        this.turret.add(o);
        this.dischargers.push(o);
      }));
    }

    if (E) {
      for (let i = 0; i < 12; i++) {
        const az = ((-55 + (110 * i) / 11) * Math.PI) / 180, el = (20 * Math.PI) / 180;
        const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
        const o = new Object3D();
        o.position.set(Math.sin(az) * 1.15 + dir.x * 0.3, 0.5 + dir.y * 0.3, 0.6 + Math.cos(az) * 1.0 + dir.z * 0.3);
        o.userData.dir = dir.clone();
        this.turret.add(o);
        this.dischargers.push(o);
      }
    }

    // hull attach points for dust / exhaust / wreck fire (used by effects)
    this.exhaustPoint = new Object3D(); this.exhaustPoint.position.set(0, 1.0, -3.5); this.hull.add(this.exhaustPoint);
    this.fireAnchor = new Object3D(); this.fireAnchor.position.set(0, 1.75, -2.2); this.hull.add(this.fireAnchor);

    // ---- running gear ----
    if (!TRACK_TEX) TRACK_TEX = makeTrackTextures();
    this.trackMetersPerTile = P.track.metersPerTile;
    this.wheelsL = []; this.wheelsR = [];
    const trackMat = () => {
      const map = TRACK_TEX.map.clone(); map.needsUpdate = true;
      const bump = TRACK_TEX.bump.clone(); bump.needsUpdate = true;
      const mat = new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.0, roughness: 0.85, metalness: 0.25, color: 0xffffff, side: DoubleSide });
      patchMaterial(mat);
      return { mat, map, bump };
    };
    const tl = trackMat(), tr = trackMat();
    this.trackTexL = tl.map; this.trackBumpL = tl.bump;
    this.trackTexR = tr.map; this.trackBumpR = tr.bump;
    for (const side of [1, -1]) {
      const x = side * 1.48;
      const list = side > 0 ? this.wheelsL : this.wheelsR;
      const t = side > 0 ? tl : tr;
      const track = new Mesh(P.track.geometry, t.mat);
      track.position.x = x;
      this.root.add(track);
      const put = (geo, y, z, r) => {
        const m = new Mesh(geo, this.mats.wheel);
        m.position.set(x, y, z);
        this.root.add(m);
        list.push({ mesh: m, r });
      };
      if (E) for (let i = 0; i < 6; i++) put(P.wheel, 0.48, -2.55 + i * 1.02, 0.38);
      else for (let i = 0; i < 7; i++) put(P.wheel, 0.46, -2.35 + i * 0.78, 0.36);
      put(P.sprocket, 0.78, -3.0, 0.4);
      put(P.idler, 0.46, 3.05, 0.36);
      put(P.roller, 0.86, 1.2, 0.12); put(P.roller, 0.9, -0.2, 0.12); put(P.roller, 0.95, -1.6, 0.12);
    }
    this.trackAnim = new TrackAnimation(this);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // vL / vR in m/s
  updateTracks(vL, vR, dt) { this.trackAnim.update(vL, vR, dt); }

  // barrel slides back by 'offset' metres
  setRecoil(offset) { this.recoilGroup.position.z = -offset; }

  setYawPitch(turretYaw, gunPitch) {
    this.turret.rotation.y = turretYaw;
    this.gunPivot.rotation.x = -gunPitch;
  }
}

void BoxGeometry;
