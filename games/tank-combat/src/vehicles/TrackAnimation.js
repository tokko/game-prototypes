// Track belt geometry (looped ribbon with scrolling texture), wheel geometry and the animation driver.
import {
  BufferGeometry, Float32BufferAttribute, CatmullRomCurve3, Vector3, CylinderGeometry, BoxGeometry,
  Matrix4, Quaternion, Euler,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---- track belt ----
// Control polygon of the outer track surface in (z, y), listed: bottom run rear->front, front arc,
// top run front->rear, rear sprocket arc.
const TRACK_PATH = [
  [-2.65, 0.0], [-1.0, 0.0], [0.8, 0.0], [2.7, 0.0],
  [3.375, 0.135], [3.51, 0.46], [3.375, 0.785], [3.05, 0.92],
  [2.0, 1.05], [0.5, 1.12], [-1.2, 1.18], [-2.9, 1.28],
  [-3.354, 1.134], [-3.5, 0.78], [-3.354, 0.426], [-3.0, 0.28], [-2.8, 0.08],
];

export function buildTrackGeometry(width = 0.56, thick = 0.1, samples = 220) {
  const curve = new CatmullRomCurve3(TRACK_PATH.map((p) => new Vector3(p[0], p[1], 0)), true, 'centripetal');
  const pts = curve.getSpacedPoints(samples).slice(0, samples);
  let length = 0;
  for (let i = 0; i < samples; i++) length += pts[i].distanceTo(pts[(i + 1) % samples]);
  // orientation
  let area = 0;
  for (let i = 0; i < samples; i++) { const a = pts[i], b = pts[(i + 1) % samples]; area += a.x * b.y - b.x * a.y; }
  const sgn = area > 0 ? 1 : -1;
  const tiles = Math.round(length / 0.6); // 2 links (0.3 m pitch) per tile
  const pos = [], nor = [], uv = [], idx = [];
  const hw = width / 2;
  const addV = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); return pos.length / 3 - 1; };
  const M = samples;
  const ring = (kind) => {
    const base = pos.length / 3;
    for (let i = 0; i <= M; i++) {
      const p = pts[i % M], q = pts[(i + 1) % M], o = pts[(i + M - 1) % M];
      const tx = q.x - o.x, ty = q.y - o.y, tl = Math.hypot(tx, ty) || 1;
      const nx = (sgn * ty) / tl, ny = (-sgn * tx) / tl; // outward (z, y)
      const u = (i / M) * tiles;
      if (kind === 0) { // outer
        addV(-hw, p.y, p.x, 0, ny, nx, u, 0); addV(hw, p.y, p.x, 0, ny, nx, u, 1);
      } else if (kind === 1) { // inner
        const iy = p.y - ny * thick, iz = p.x - nx * thick;
        addV(-hw, iy, iz, 0, -ny, -nx, u, 0); addV(hw, iy, iz, 0, -ny, -nx, u, 1);
      } else { // sides: outer & inner edge at x = +-hw
        const iy = p.y - ny * thick, iz = p.x - nx * thick;
        const sx = kind === 2 ? -1 : 1;
        addV(sx * hw, p.y, p.x, sx, 0, 0, u, 0); addV(sx * hw, iy, iz, sx, 0, 0, u, 1);
      }
    }
    for (let i = 0; i < M; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  };
  ring(0); ring(1); ring(2); ring(3);
  // winding fix: make each triangle agree with its vertex normal
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * nor[a * 3] + cy * nor[a * 3 + 1] + cz * nor[a * 3 + 2] < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geometry: g, length, tiles, metersPerTile: length / tiles };
}

// ---- wheels (vertex coloured, merged into one geometry each; axis = X) ----
function paint(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  return geo;
}

function strip(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  return g;
}

const _m = new Matrix4(), _q = new Quaternion(), _e = new Euler();
function cylX(r, len, seg, x, y, z) {
  const g = new CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function coneX(rOut, rIn, len, cx, outward) {
  // frustum along X; the narrow end (rOut) faces outward (+x when outward > 0)
  const g = new CylinderGeometry(rOut, rIn, len, 24);
  if (outward > 0) g.rotateZ(-Math.PI / 2); else g.rotateZ(Math.PI / 2);
  g.translate(cx, 0, 0);
  return g;
}

// vertex colours are LINEAR (three reads them as linear): dirty rubber, olive-grey dished hubs, dull bolts
export function buildRoadWheelGeometry(r) {
  const parts = [];
  for (const sx of [-0.09, 0.09]) parts.push(paint(strip(cylX(r, 0.15, 28, sx, 0, 0)), 0.02, 0.02, 0.02));
  for (const sx of [-1, 1]) {
    parts.push(paint(strip(coneX(r * 0.5, r * 0.74, 0.17, sx * 0.1, sx)), 0.05, 0.05, 0.033));
    parts.push(paint(strip(coneX(r * 0.2, r * 0.36, 0.1, sx * 0.19, sx)), 0.03, 0.03, 0.022));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, rr = r * 0.54;
    parts.push(paint(strip(cylX(r * 0.045, 0.43, 6, 0, Math.sin(a) * rr, Math.cos(a) * rr)), 0.07, 0.07, 0.06));
  }
  return mergeGeometries(parts);
}

export function buildSprocketGeometry(r) {
  const parts = [];
  parts.push(paint(strip(cylX(r * 0.82, 0.36, 24, 0, 0, 0)), 0.035, 0.035, 0.03));
  parts.push(paint(strip(cylX(r * 0.38, 0.46, 14, 0, 0, 0)), 0.02, 0.02, 0.018));
  const teeth = 14;
  for (const sx of [-0.12, 0.12]) {
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const b = new BoxGeometry(0.07, r * 0.3, r * 0.2);
      // box tall axis (y) must point radially: rotating about x by a maps y -> (cos a, sin a) in (y, z)
      _q.setFromEuler(_e.set(a, 0, 0));
      _m.compose(new Vector3(sx, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9), _q, new Vector3(1, 1, 1));
      b.applyMatrix4(_m);
      parts.push(paint(strip(b), 0.04, 0.04, 0.034));
    }
  }
  return mergeGeometries(parts);
}

export function buildRollerGeometry(r) {
  return mergeGeometries([
    paint(strip(cylX(r, 0.3, 14, 0, 0, 0)), 0.02, 0.02, 0.02),
    paint(strip(cylX(r * 0.5, 0.36, 8, 0, 0, 0)), 0.04, 0.04, 0.034),
  ]);
}

// ---- driver ----
export class TrackAnimation {
  constructor(model) {
    this.model = model;
  }

  // vL / vR: signed surface speed (m/s) of left / right track, positive = forward
  update(vL, vR, dt) {
    const m = this.model;
    for (let i = 0; i < m.wheelsL.length; i++) { const w = m.wheelsL[i]; w.mesh.rotation.x += (vL / w.r) * dt; }
    for (let i = 0; i < m.wheelsR.length; i++) { const w = m.wheelsR[i]; w.mesh.rotation.x += (vR / w.r) * dt; }
    // Texture runs bottom-run rear->front along +u; forward motion moves the bottom run backwards relative to hull.
    m.trackTexL.offset.x += (vL * dt) / m.trackMetersPerTile;
    m.trackTexR.offset.x += (vR * dt) / m.trackMetersPerTile;
    m.trackBumpL.offset.x = m.trackTexL.offset.x;
    m.trackBumpR.offset.x = m.trackTexR.offset.x;
  }
}
