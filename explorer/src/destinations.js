// Scaled Halcyon system: all six destinations + parents. Data only; surfaces are added by writing a
// terrain recipe (src/terrain/<recipe>.js) and setting `recipe`.
// Distances m, times s, mu m^3/s^2. Heliocentric orbits are circular and coplanar (scaled).
const G0 = 9.80665;
const mu = (g, R) => g * R * R;

export const SUN = { id: 'halcyon', name: 'Halcyon', kind: 'star', mu: 2.43e18, radius: 6.0e8, color: '#ffe2b0' };

const B = {};
function add(o) { o.mu = o.mu || mu(o.g, o.R); B[o.id] = o; return o; }

// ------------------------------------------------------------------ planets (orbit the sun)
add({
  id: 'pyra', name: 'Pyra', kind: 'planet', parent: 'halcyon', a: 1.65e10, phase0: 4.1, R: 3.8e6, g: 1.10, parkAlt: 320e3,
  destination: true, recipe: 'pyra', airless: false, dayLength: 4.1e4,
  // ---- PYRA (volcanic) begin: surface recipe terrain/pyra.js; thick orange-red ash atmosphere (scatter.tint recolours the sky and haze)
  atmosphere: { pressure: '3.4 atm', note: 'sulphurous haze', color: [1.0, 0.35, 0.12], height: 0.012, visH: 0.045,
    scatter: { rimK: 3.2, dens: 1.7, betaR: [5.8, 13.5, 33.1], mieK: 1.6, mieG: 0.55, mieCol: [1.0, 0.5, 0.25], hazeH: 4500, fogDist: 24000, sunI: 3.4, sunCol: [1.0, 0.6, 0.35], tint: [1.0, 0.38, 0.17] } },
  site: { x: 1600000, z: -1100000 },
  sky: { giant: 'ymir', giantPal: { c1: [0.28, 0.1, 0.06], c2: [0.55, 0.2, 0.1], c3: [0.85, 0.5, 0.28], style: 0 },
         giantAzEl: [118, 32], giantRadius: 0.06, ringTilt: 0, ringRoll: 0, moonAzEl: null, sunAz: 38, sunAzSwing: 20, sunEl: 9, sunElSwing: 34, sunPhase: 0, goldenStart: true },
  // ---- PYRA end
  palette: { c1: [0.10, 0.045, 0.035], c2: [0.55, 0.16, 0.05], c3: [0.95, 0.45, 0.10], crater: 0.0, cloud: 0.4, cloudColor: [0.2, 0.105, 0.075], lava: 1 },
  blurb: 'Volcanic furnace world. Lava seas, basalt spires and a perpetual ash sky.',
  landing: 'spaceplane (heavy atmosphere)',
});
add({
  id: 'verdant', name: 'Verdant Prime', kind: 'planet', parent: 'halcyon', a: 3.0e10, phase0: 0.4, R: 5.5e6, g: 0.95, parkAlt: 380e3,
  destination: true, recipe: 'verdant', airless: false, dayLength: 3.0e5,
  // per-world atmosphere data: colour = orbit rim tint; scatter = Rayleigh/Mie sky model (see atmo.js); breathable-looking but suit-requiring
  atmosphere: { pressure: '0.9 atm', note: 'nitrogen-oxygen, spore-laden (suit required)', color: [0.35, 0.6, 1.0], height: 0.02,
    scatter: { dens: 1.0, betaR: [5.8, 13.5, 33.1], mieK: 1.0, mieG: 0.66, mieCol: [1.0, 0.82, 0.55], hazeH: 7000, fogDist: 26000, sunI: 4.6, sunCol: [1.0, 0.93, 0.8] } },
  site: { x: 3000000, z: 800000 },     // curated landing meadow (plane metres)
  // a huge pale ice giant is a sky decoration here (Verdant orbits the star, so there is no real parent giant)
  sky: { giant: 'ymir', giantPal: { c1: [0.50, 0.66, 0.60], c2: [0.80, 0.88, 0.80], c3: [0.97, 0.95, 0.85], style: 1, storm: [[0.82, 0.70, 0.45], [0.98, 0.95, 0.86]] },
         giantAzEl: [104, 25], giantRadius: 0.26, ringTilt: 0, ringRoll: 14, moonAzEl: null, sunAz: 62, sunAzSwing: 26, sunEl: 10, sunElSwing: 42, sunPhase: 0, goldenStart: true },      // golden hour for a long while: the sun rises slowly from 10 degrees      // golden hour at t = 0, then dusk, night, dawn
  palette: { c1: [0.03, 0.16, 0.28], c2: [0.12, 0.30, 0.08], c3: [0.75, 0.72, 0.55], ocean: 0.47, crater: 0.0, cloud: 0.42, cloudColor: [0.9, 0.93, 0.97] },
  blurb: 'Lush living world of floating-root forests, waterfalls and drifting fauna.',
  landing: 'spaceplane (earthlike atmosphere)',
});
add({
  id: 'aethel', name: 'Aethel', kind: 'planet', parent: 'halcyon', a: 4.5e10, phase0: 2.2, R: 3.5e6, g: 0.80, parkAlt: 300e3,
  destination: true, recipe: 'aethel', airless: false, dayLength: 6.5e4,
  atmosphere: { pressure: '0.6 atm', note: 'thin teal air outside; cavern air within (suit required)', color: [0.5, 0.75, 1.0], height: 0.014,
    scatter: { dens: 0.62, betaR: [4.6, 12.5, 27.0], mieK: 0.6, mieG: 0.7, mieCol: [0.95, 0.92, 0.7], hazeH: 6000, fogDist: 60000, sunI: 4.2, sunCol: [1.0, 0.95, 0.85] } },
  site: { x: 29500, z: 0 },            // runway on the rim of the prime gate (plane metres)
  sky: { giant: 'tamber', giantAzEl: [150, 26], giantRadius: 0.06, ringTilt: 3.2, ringRoll: 16, moonAzEl: null,
         sunAz: 300, sunAzSwing: 28, sunEl: 20, sunElSwing: 12, sunPhase: 0, goldenStart: true },
  palette: { c1: [0.17, 0.19, 0.21], c2: [0.30, 0.34, 0.35], c3: [0.52, 0.58, 0.57], crater: 1.0, cloud: 0.12, cloudColor: [0.8, 0.88, 0.92], pits: 1 },
  blurb: 'Hollow shell world pierced by a lattice of glowing gates. Land on the rim, deploy the skiff and dive into a sky-lit cavern with a small inner sun.',
  landing: 'spaceplane (thin atmosphere); skiff for the cavern',
});
add({
  id: 'tamber', name: 'Tamber', kind: 'giant', parent: 'halcyon', a: 9.0e10, phase0: 5.3, R: 9.6e7, mu: 5.0e14,
  destination: false, rings: true,
  palette: { c1: [0.55, 0.30, 0.16], c2: [0.9, 0.62, 0.34], c3: [0.95, 0.88, 0.7], crater: 0, cloud: 0, cloudColor: [1, 1, 1] },
  blurb: 'Banded, ringed gas giant. Host of Kestrel, Glaciera and Sable.',
});
add({
  id: 'ymir', name: 'Ymir', kind: 'giant', parent: 'halcyon', a: 1.5e11, phase0: 1.5, R: 6.0e7, mu: 3.0e14,
  destination: false, rings: false,
  palette: { c1: [0.12, 0.28, 0.5], c2: [0.3, 0.55, 0.8], c3: [0.75, 0.9, 0.98], crater: 0, cloud: 0, cloudColor: [1, 1, 1] },
  blurb: 'Pale blue ice giant. Host of Nyth.',
});

// ------------------------------------------------------------------ moons
add({
  id: 'kestrel', name: 'Kestrel', kind: 'moon', parent: 'tamber', a: 6.2e8, phase0: 0.7, R: 320e3, g: 1.18, parkAlt: 40e3,
  destination: true, recipe: 'kestrel', airless: true, dayLength: 2800, // visual day (s): slow sun swing, low sun throughout
  atmosphere: null,
  palette: { c1: [0.78, 0.69, 0.55], c2: [0.30, 0.26, 0.23], c3: [0.55, 0.34, 0.22], crater: 1.0, cloud: 0, cloudColor: [1, 1, 1] },
  blurb: 'Airless, tidally locked moon of Tamber. Pale dust, eroded spires, natural arches and crater fields under a huge ringed sky.',
  landing: 'lander',
  // surface scene
  site: { x: -5000, z: -6500 },     // home landing site (plane metres), chosen near an arch + hoodoo field
  sky: { giant: 'tamber', giantAzEl: [102, 30], giantRadius: 0.155, ringTilt: 3.2, ringRoll: 16,
         moonAzEl: [38, 52], moonRadius: 0.016, sunAz: 332, sunAzSwing: 36, sunEl: 13.5, sunElSwing: 3.5 },
});
add({
  id: 'glaciera', name: 'Glaciera', kind: 'moon', parent: 'tamber', a: 1.35e9, phase0: 3.6, R: 450e3, g: 1.05, parkAlt: 50e3,
  destination: true, recipe: 'glaciera', airless: true, dayLength: 1500,
  atmosphere: null,
  palette: { c1: [0.84, 0.92, 1.0], c2: [0.30, 0.52, 0.88], c3: [0.97, 0.99, 1.0], crater: 0.2, cloud: 0, cloudColor: [1, 1, 1] },
  blurb: 'Airless frozen-ocean moon: cracked ice plates and dark leads, pressure ridges, cryo-geysers and blue crystal spires under a huge ringed sky.',
  landing: 'lander',
  site: { x: 1200000, z: -200000 },     // home landing pad (plane metres)
  sky: { giant: 'tamber', giantAzEl: [95, 27], giantRadius: 0.21, ringTilt: 9, ringRoll: -16,
         // cool blue-green and cream Tamber with a thin bright ring (Glaciera's sky only; Kestrel keeps the banded palette)
         giantPal: { c1: [0.14, 0.40, 0.46], c2: [0.46, 0.72, 0.68], c3: [0.95, 0.93, 0.80], style: 1, storm: [[0.88, 0.9, 0.74], [0.99, 0.97, 0.88]], ring: [1.5, 1.82], ringK: 1.7 },
         moonAzEl: [58, 46], moonRadius: 0.013, sunAz: 350, sunAzSwing: 18, sunEl: 9, sunElSwing: 4 },
});
add({
  id: 'sable', name: 'Sable', kind: 'moon', parent: 'tamber', a: 9.0e8, phase0: 5.0, R: 90e3, g: 0.2,
  destination: false,
  palette: { c1: [0.35, 0.34, 0.34], c2: [0.18, 0.18, 0.19], c3: [0.5, 0.48, 0.46], crater: 1.0, cloud: 0, cloudColor: [1, 1, 1] },
  blurb: 'Small dark moon, a bright dot in Kestrel\'s sky.',
});
add({
  id: 'nyth', name: 'Nyth', kind: 'moon', parent: 'ymir', a: 7.5e8, phase0: 2.8, R: 2.8e6, g: 0.90, parkAlt: 260e3,
  destination: true, recipe: 'nyth', airless: false, dayLength: 5.5e4,
  // --- Nyth: twilight world (sun stays just below the horizon), deep-blue / violet sky, ymir fills half the sky; `amb` = night sky floor colour (atmo.js)
  atmosphere: { pressure: '1.4 atm', note: 'dense, bioluminescent flora', color: [0.4, 0.5, 1.0], height: 0.02,
    scatter: { dens: 1.0, betaR: [14.0, 3.0, 16.0], mieK: 1.2, mieG: 0.5, mieCol: [0.70, 0.30, 1.0], hazeH: 6500, fogDist: 15000, sunI: 4.0, sunCol: [0.8, 0.72, 1.0], amb: [0.022, 0.050, 0.170] } },
  site: { x: 1200000, z: 420000 },    // curated landing plateau + lagoon overlook (plane metres)
  sky: { giant: 'ymir', giantPal: { c1: [0.16, 0.26, 0.52], c2: [0.30, 0.46, 0.76], c3: [0.52, 0.66, 0.92], style: 1, storm: [[0.30, 0.46, 0.80], [0.58, 0.72, 0.98]] },
         giantAzEl: [112, 24], giantRadius: 0.30, ringTilt: 0, ringRoll: 10, moonAzEl: null, sunAz: 18, sunAzSwing: 14, sunEl: -5.5, sunElSwing: 1.5, sunPhase: 0, goldenStart: true },
  palette: { c1: [0.03, 0.07, 0.24], c2: [0.14, 0.24, 0.52], c3: [0.45, 0.60, 0.95], ocean: 0.5, crater: 0.0, cloud: 0.42, cloudColor: [0.55, 0.62, 0.95], glow: [0.10, 0.75, 1.0] },
  blurb: 'Bioluminescent lowland moon of Ymir with towering fungal forests and roaming megafauna.',
  landing: 'spaceplane (dense atmosphere)',
});

export const BODIES = B;
export const DESTINATIONS = ['verdant', 'kestrel', 'pyra', 'nyth', 'aethel', 'glaciera'];
export const body = (id) => B[id];
export const parentOf = (b) => (b.parent === 'halcyon' ? null : B[b.parent]);
/** planet-level body: a moon maps to its parent planet, a planet to itself */
export const planetLevel = (b) => (b.kind === 'moon' ? B[b.parent] : b);
export const parkRadius = (b) => b.R + (b.parkAlt || 0);
export const circSpeed = (b, r = parkRadius(b)) => Math.sqrt(b.mu / r);
export { G0 };

/** angle of a body around its parent at time t */
export function orbitAngle(b, t) {
  const par = b.parent === 'halcyon' ? SUN : B[b.parent];
  return b.phase0 + Math.sqrt(par.mu / (b.a * b.a * b.a)) * t;
}
export const orbitRate = (b) => Math.sqrt((b.parent === 'halcyon' ? SUN : B[b.parent]).mu / (b.a * b.a * b.a));

export const POI_TYPES = {
  melt:   { name: 'Glassy impact melt', color: 0x66ffd0, text: 'A sheet of black glass fused by an ancient impact. It rings like a bell underfoot and refracts the light of Tamber in impossible green.' },
  arch:   { name: 'Ancient arch', color: 0xffc070, text: 'A span of eroded stone, older than the oldest dust. Wind never shaped it; nothing has here for four billion years. Something else did.' },
  ice:    { name: 'Ice-bearing crater floor', color: 0x9fd8ff, text: 'Permanent shadow has kept water ice here since the crater formed. Ground-penetrating echoes suggest metres of it. A refinery\'s dream.' },
  spire:  { name: 'Strange spire resonance', color: 0xff8cf0, text: 'This spire hums at 11 Hz in the sensor suite. The sound is not seismic and it does not stop when you stop moving.' },
  falls:  { name: 'The Singing Falls', color: 0x9fe8ff, text: 'A river leaps seventy metres off a basalt lip into a mist-wrapped pool. The spray hangs in the golden light and the roar carries for kilometres. Small things nest in the rock behind the water.' },
  grove:  { name: 'Umbrella-fungus grove', color: 0xff6adf, text: 'Fungal giants taller than a cathedral, caps wider than a landing field. The gills glow at dusk and something in the soil keeps the whole grove breathing in unison.' },
  bloom:  { name: 'Spore bloom basin', color: 0xb6ff7a, text: 'A damp hollow where glowing pods swell and burst in slow waves. The cloud drifts upwind and the local fauna follow it like a tide.' },
  // ---- PYRA POIs begin
  vent:     { name: 'Fumarole field', color: 0xff7a3a, text: 'A cracked vent field breathing sulphur and ash. The ground ticks as it cools; the suit thermometer climbs the closer you step. Glassy crystals have grown around the rim.' },
  lavalake: { name: 'The Furnace lava lake', color: 0xffa040, text: 'A basin of molten basalt, crusted black and cracked bright orange. The crust heaves with the slow tide of the magma below and the heat on your visor is a physical push.' },
  // ---- PYRA POIs end
  // Nyth
  lumen:  { name: 'Luminous tide pool', color: 0x5cf0ff, text: 'A shallow basin whose water glows from below. The light pulses in slow rings that travel outwards whenever something steps near, as if the whole pool were listening.' },
  choir:  { name: 'Chorus grove', color: 0xc77dff, text: 'A ring of umbrella fungi whose gills brighten in sequence, one cap after the next, round and round. The pattern restarts when you walk in, and it restarts differently each time.' },
  motes:  { name: 'Mote nursery', color: 0x9ad0ff, text: 'Drifting lights lift out of the leaf litter here in their thousands. They are not insects and not spores: they are budding fragments of the forest, carried off to root elsewhere.' },
  hollow: { name: 'Glow hollow', color: 0xff7ae0, text: 'A bowl in the lowland where every plant glows magenta instead of blue. The soil is warm. Something below keeps the whole hollow awake.' },
  gate:   { name: 'The Aethel Gate', color: 0x7ff0ff, text: 'The shell of this world is only a few kilometres thick here, and it has been drilled through: a perfect circle of light at the bottom of the crater. Warm air breathes up out of it. Someone built a door and left it open.' },
  strata: { name: 'Exposed shell strata', color: 0xc8ffb0, text: 'The crater wall cuts the shell like a layer cake: bands of teal ceramic and dark glass, each one a hundred metres thick and ruler flat. Nothing natural stacks stone like this.' },
  ring:   { name: 'Lumen ring', color: 0xfff0a0, text: 'A ring of pale standing stones around a pool of warm light. In the hollow world every direction is down, and the stones all lean toward the small sun overhead.' },
  settlement: { name: 'The Lantern Domes', color: 0xffb060, text: 'Domes, towers and arches of pale stone ring a turquoise lake under three waterfalls. Hundreds of windows glow warm, and no one answers on any frequency. The lamps are lit on a schedule older than the sun above them.' },
  sunfall:{ name: 'Sunfall meadow', color: 0xffc080, text: 'The inner sun hangs straight above this meadow and never sets. The grass here grows in slow spirals following its slight drift, and the whole hillside seems to breathe with its light.' },
  meteor: { name: 'Meteorite fragment', color: 0xffe08a, text: 'A dense iron-nickel fragment, half buried. The crystal lattice is wrong for anything formed in this system.' },
};
