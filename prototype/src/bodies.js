// Celestial bodies (data model). One planet (Halcyon) and two airless moons (Pell, and the small outer moon Wren).
// Everything is plain data so future systems can hang off it: `survey` (exploration),
// `sites` (ore now; outposts/logistics later), `pois`, contracts etc.
import { Vector3 } from 'three';
import { circularElements, stateAt } from './orbits.js';

const DEG = Math.PI / 180;

export const SUN_DIR = new Vector3(1, -0.38, 0.22).normalize(); // direction towards the sun (physics frame)

const planetMu = 3.53e12; // 600 km radius -> 9.8 m/s^2 surface gravity, ~2.2 km/s low orbit (KSP-like)
const moonMu = 6.0e10;
const moonA = 9.0e6;
const wrenMu = 1.6e9;
const wrenA = 2.0e7;

const lonLat = (lonDeg, latDeg) => {
  const lon = lonDeg * DEG, lat = latDeg * DEG;
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
};
const offsetDir = (dir, tangent, metres) => dir.clone().addScaledVector(tangent, metres / 30e3).normalize();

// Wren's rift: one canyon along a tilted great circle (normal n), wrapping 240 degrees of it from angle a0.
const rift = (() => {
  const n = new Vector3(0.38, -0.22, 0.9).normalize();
  const e1 = new Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
  const e2 = new Vector3().crossVectors(n, e1);
  return { n, e1, e2, a0: 0.4, span: 240 * DEG, halfWidth: 2800, floorWidth: 1100 };
})();
/** four cryo-geysers along the rift; each erupts on its own deterministic cycle (see ventState) */
const ventSpecs = [0.12, 0.38, 0.62, 0.88].map((f, i) => {
  const a = rift.a0 + rift.span * f;
  const dir = rift.e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(rift.e2, Math.sin(a));
  const tangent = rift.e1.clone().multiplyScalar(-Math.sin(a)).addScaledVector(rift.e2, Math.cos(a));
  return { id: `vent${i}`, dir, tangent, height: [14e3, 19e3, 24e3, 11e3][i], active: [90, 70, 120, 100][i], dormant: [240, 360, 180, 300][i], offset: [0, 130, 40, 210][i] };
});
/** eruption state of a vent at universal time t: k in 0..1 (ramps over 8 s), active flag, seconds until it erupts next */
export function ventState(vent, t) {
  const cyc = vent.active + vent.dormant;
  const ph = (((t + vent.offset) % cyc) + cyc) % cyc;
  const on = ph < vent.active;
  return { k: on ? Math.min(1, ph / 8, (vent.active - ph) / 8) : 0, active: on, next: on ? 0 : cyc - ph };
}

export const BODIES = {
  planet: {
    id: 'planet', name: 'Halcyon', radius: 600e3, mu: planetMu, parent: null,
    soi: 5e8, children: ['moon', 'wren'],
    targetPe: 120e3,    // periapsis altitude for planned returns to Halcyon
    atmosphere: { height: 70e3 },       // visual only
    rotationPeriod: 5400,               // visual only
    survey: {}, // future: exploration data
  },
  moon: {
    id: 'moon', name: 'Pell', radius: 100e3, mu: moonMu, parent: 'planet', children: [],
    soi: moonA * Math.pow(moonMu / planetMu, 0.4),
    orbit: circularElements(planetMu, moonA, 1.9, 0),
    targetPe: 55e3,  // default periapsis altitude for planned transfers
    survey: {},
    // Rich ore fields (equatorial, sunlit). dir = unit vector from moon centre (physics frame).
    sites: [
      { id: 'pell-a', name: 'Aster Field', lon: 8, lat: 0.15, richness: 1.0 },
      { id: 'pell-b', name: 'Corvid Basin', lon: 21, lat: -0.35, richness: 1.2 },
      { id: 'pell-c', name: 'Ember Ridge', lon: 33, lat: 0.4, richness: 0.9 },
      { id: 'pell-d', name: 'Quill Flats', lon: -7, lat: -0.1, richness: 1.1 },
      { id: 'pell-e', name: 'Vesper Crater', lon: 46, lat: 0.1, richness: 1.0 },
    ].map((s) => {
      const lon = s.lon * DEG, lat = s.lat * DEG;
      s.dir = new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      s.radius = 180;       // metres: within this you can drill
      return s;
    }),
  },
  wren: {
    id: 'wren', name: 'Wren', radius: 30e3, mu: wrenMu, parent: 'planet', children: [],
    soi: wrenA * Math.pow(wrenMu / planetMu, 0.4),
    orbit: circularElements(planetMu, wrenA, 4.2, 0),
    targetPe: 15e3,
    survey: {},           // discoveries (filled by the world: the Spire)
    craterScale: 3.3,     // moon shader crater/feature scale (Wren is 1/3.3 the size of Pell)
    ring: { inner: 45e3, outer: 70e3 },   // faint ice-debris ring in the equatorial plane (visual only)
    rift,
    vents: ventSpecs,
    // Two volatile-vent sites next to eruptions (rich, but time the cycle), one calm site, and a hidden one near the Spire.
    sites: [
      ...ventSpecs.slice(0, 2).map((vt, i) => ({ id: `wren-v${i}`, name: i ? 'Volatile Vent Beta' : 'Volatile Vent Alpha', dir: offsetDir(vt.dir, vt.tangent, 300), richness: 2.0, vent: vt.id })),
      { id: 'wren-c', name: 'Sedge Hollow', dir: lonLat(-70, 4), richness: 1.2 },
      { id: 'wren-seam', name: 'Deep Seam', dir: lonLat(-26.1, 69.2), richness: 3.0, hidden: true },
    ].map((s) => { s.radius = 180; return s; }),
    // "The Spire": ~600 m crystalline obelisk at high latitude, far from the rift. Not listed until a signal is detected.
    spire: { dir: lonLat(-30, 70), landDir: lonLat(-30, 70 - 300 / 30e3 / DEG), height: 600, detectRange: 500 },
  },
};
export const BODY_LIST = Object.values(BODIES);
/** true for any child of the planet (Pell, Wren): airless, landable */
export const isMoon = (id) => BODIES[id].parent === 'planet';
/** ore sites currently known (hidden ones appear once discovered) */
export const sitesOf = (id) => (BODIES[id].sites || []).filter((s) => !s.hidden);

/** state of a body relative to its parent at time t */
export function bodyLocalState(id, t, out) {
  const b = BODIES[id];
  if (!b.parent) { out.r.set(0, 0, 0); out.v.set(0, 0, 0); return out; }
  return stateAt(b.orbit, t, out);
}

// Future hooks (clean structure only): contracts/story, outposts.
export const CONTRACTS = [];
export const OUTPOSTS = [];
