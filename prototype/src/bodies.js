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

export const BODIES = {
  planet: {
    id: 'planet', name: 'Halcyon', radius: 600e3, mu: planetMu, parent: null,
    soi: 5e8, children: ['moon', 'wren'],
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
    survey: {},
    sites: [
      { id: 'wren-a', name: 'Tansy Pit', lon: 12, lat: 0.3, richness: 1.0 },
      { id: 'wren-b', name: 'Linnet Rise', lon: 40, lat: -0.4, richness: 1.1 },
      { id: 'wren-c', name: 'Sedge Hollow', lon: -25, lat: 0.1, richness: 0.9 },
    ].map((s) => {
      const lon = s.lon * DEG, lat = s.lat * DEG;
      s.dir = new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      s.radius = 180;
      return s;
    }),
  },
};
export const BODY_LIST = Object.values(BODIES);
/** true for any child of the planet (Pell, Wren): airless, landable */
export const isMoon = (id) => BODIES[id].parent === 'planet';

/** state of a body relative to its parent at time t */
export function bodyLocalState(id, t, out) {
  const b = BODIES[id];
  if (!b.parent) { out.r.set(0, 0, 0); out.v.set(0, 0, 0); return out; }
  return stateAt(b.orbit, t, out);
}

// Future hooks (clean structure only): contracts/story, outposts.
export const CONTRACTS = [];
export const OUTPOSTS = [];
