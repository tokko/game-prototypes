// Coordinate frames. F = body-fixed frame (y = spin axis). Surface world: x east, y up, z south.
// Sphere point: n = (cos lat cos lon, sin lat, -cos lat sin lon).  Plane (terrain) coords: x = lon*R, z = -lat*R.
import * as THREE from 'three';

const D2R = Math.PI / 180;
export function enu(lon, lat, E = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3()) {
  const sl = Math.sin(lon), cl = Math.cos(lon), sp = Math.sin(lat), cp = Math.cos(lat);
  E.set(-sl, 0, -cl);
  N.set(-sp * cl, cp, sp * sl);
  U.set(cp * cl, sp, -cp * sl);
  return { E, N, U };
}
export const lonLatOfDir = (n) => ({ lon: Math.atan2(-n.z, n.x), lat: Math.asin(Math.max(-1, Math.min(1, n.y))) });

/** F-direction of a site-relative azimuth (deg from north towards east) and elevation (deg) */
export function azElToF(lon0, lat0, azDeg, elDeg, out = new THREE.Vector3()) {
  const { E, N, U } = enu(lon0, lat0);
  const az = azDeg * D2R, el = elDeg * D2R;
  return out.set(0, 0, 0).addScaledVector(E, Math.sin(az) * Math.cos(el)).addScaledVector(N, Math.cos(az) * Math.cos(el)).addScaledVector(U, Math.sin(el)).normalize();
}

/** matrix rows E, U, S(=-N): converts an F-frame vector to surface world */
export function fToWorldMatrix(lon, lat, out = new THREE.Matrix3()) {
  const { E, N, U } = enu(lon, lat);
  out.set(E.x, E.y, E.z, U.x, U.y, U.z, -N.x, -N.y, -N.z);
  return out;
}
export function fToWorld(v, lon, lat, out = new THREE.Vector3()) {
  const { E, N, U } = enu(lon, lat);
  return out.set(v.dot(E), v.dot(U), -v.dot(N));
}
export function worldToF(w, lon, lat, out = new THREE.Vector3()) {
  const { E, N, U } = enu(lon, lat);
  return out.set(0, 0, 0).addScaledVector(E, w.x).addScaledVector(U, w.y).addScaledVector(N, -w.z);
}

export function siteLonLat(dest) {
  const R = dest.R;
  return { lon: dest.site.x / R, lat: -dest.site.z / R };
}
export function sunDirF(dest, t, out = new THREE.Vector3()) {
  const s = dest.sky, { lon, lat } = siteLonLat(dest);
  if (!s) return out.set(1, 0.2, 0.3).normalize();
  const ph = (t / dest.dayLength) * Math.PI * 2;
  return azElToF(lon, lat, s.sunAz + s.sunAzSwing * Math.sin(ph), s.sunEl + s.sunElSwing * Math.sin(ph + (s.sunPhase ?? 1.0)), out);
}
export function giantDirF(dest, out = new THREE.Vector3()) {
  const s = dest.sky, { lon, lat } = siteLonLat(dest);
  if (!s || !s.giant) return null;
  return azElToF(lon, lat, s.giantAzEl[0], s.giantAzEl[1], out);
}
export function moonDirF(dest, t, out = new THREE.Vector3()) {
  const s = dest.sky, { lon, lat } = siteLonLat(dest);
  if (!s || !s.moonAzEl) return null;
  const k = t * 0.0004;
  return azElToF(lon, lat, s.moonAzEl[0] + 6 * Math.sin(k), s.moonAzEl[1] + 3 * Math.sin(k * 0.7), out);
}
/** ring plane normal in F (tilted `ringTilt` deg from the line of sight so the ring is seen nearly edge-on) */
export function ringNormalF(dest, out = new THREE.Vector3()) {
  const s = dest.sky;
  const T = giantDirF(dest, new THREE.Vector3());
  const { lon, lat } = siteLonLat(dest);
  const { U } = enu(lon, lat);
  let P = U.clone().addScaledVector(T, -U.dot(T)).normalize();
  const side = new THREE.Vector3().crossVectors(T, P);
  P.applyAxisAngle(T, s.ringRoll * D2R);
  const tilt = s.ringTilt * D2R;
  return out.copy(T).multiplyScalar(Math.sin(tilt)).addScaledVector(P, Math.cos(tilt)).normalize();
}
