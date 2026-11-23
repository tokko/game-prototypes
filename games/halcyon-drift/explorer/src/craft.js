// Vessel specifications and rocket-equation helpers (real masses, real Isp).
import { G0 } from './destinations.js';

// Wayfarer: nuclear-thermal interplanetary carrier (hydrogen). Lander and spaceplane dock to its side ports.
export const CARRIER = {
  name: 'Wayfarer', kind: 'carrier',
  dry: 42000,          // kg: structure, reactor, hab, radiators, cargo
  propMax: 70000,      // kg liquid hydrogen (raised with the larger Albatross tanks so the worst transfer leg still fits)
  thrust: 300e3,       // N (vacuum) -> ~2.1 m/s^2 fully loaded with both daughters
  isp: 900,            // s (vacuum, nuclear-thermal)
  cargoMax: 3000,
};
// Prospector: methalox survey rover / lander (replaces the Heron; same mass, tanks and engine). A rocket-spined rover: lands tail-first on its pads,
// tips onto six wheels, drives and surveys, drills, refines (ISRU), stands back up and launches. Systems fields mirror the Albatross power / heat model.
export const LANDER = {
  name: 'Prospector', kind: 'lander',
  dry: 4800, fuelMax: 1520, oxMax: 5480,        // kg; O/F 3.6 -> 7000 kg propellant
  thrust: 45000, isp: 340, mixture: 3.6,         // N, s
  cargoMax: 2500,                                // kg hydrogen cargo for the carrier
  battery: 100, panelPower: 12, radiatorRejection: 10, heatCap: 90,      // rover systems (see Vessel.stepSystems)
  driveMax: 11, driveAccel: 1.5,                  // m/s top speed and acceleration of the six-wheel drive
};
// Albatross: spaceplane. Three engine modes (see PLANE.modes), VTOL lift nozzles, cargo bay for the dirt bike,
// mini drill + mini ISRU, folding solar panels and heat radiators.
export const PLANE = {
  name: 'Albatross', kind: 'plane',
  dry: 9000,                                     // kg (includes the 300 kg dirt bike and mini-ISRU)
  fuelMax: 4300, oxMax: 13500, h2Max: 2200,       // kg methane / oxygen / hydrogen
  mixture: 3.6, cargoMax: 1500,
  modes: {
    jet:     { thrust: 90e3,  isp: 3500, uses: 'fuel', note: 'air-breathing, atmosphere only (thrust falls with density, Mach limit 6.5)' },
    rocket:  { thrust: 140e3, isp: 360,  uses: 'fuel+ox', note: 'closed cycle, vacuum / high altitude, VTOL lift nozzles' },
    nuclear: { thrust: 25e3,  isp: 850,  uses: 'h2', heat: 60, note: 'small NTR: efficient orbital maneuvering and short transfers; needs radiators' },
  },
  battery: 40, panelPower: 9, radiatorRejection: 12, heatCap: 100,
};
export const LANDER_PROP_MAX = LANDER.fuelMax + LANDER.oxMax;

export const exhaustV = (isp) => isp * G0;
export const dvFor = (wet, dry, isp) => (wet > dry ? exhaustV(isp) * Math.log(wet / dry) : 0);
export const propForDv = (m0, dv, isp) => m0 * (1 - Math.exp(-dv / exhaustV(isp)));

export const landerWet = () => LANDER.dry + LANDER.fuelMax + LANDER.oxMax;
export const planeWet = () => PLANE.dry + PLANE.fuelMax + PLANE.oxMax + PLANE.h2Max;
export const dockedPayload = () => landerWet() + planeWet();
export function carrierDv(prop, payload = dockedPayload()) {
  const dry = CARRIER.dry + payload;
  return dvFor(dry + prop, dry, CARRIER.isp);
}
export function landerDv(fuel, ox) {
  const p = Math.min(fuel * (1 + LANDER.mixture), ox * (1 + 1 / LANDER.mixture));
  const dry = LANDER.dry + (fuel + ox - p);
  return dvFor(dry + p, dry, LANDER.isp);
}
/** spaceplane dv for each mode with the other tanks as dead mass */
export function planeDv(t, mode) {
  const m = PLANE.modes[mode];
  const tot = PLANE.dry + t.fuel + t.ox + t.h2;
  if (mode === 'nuclear') return dvFor(tot, tot - t.h2, m.isp);
  if (mode === 'jet') return dvFor(tot, tot - t.fuel, m.isp);
  const p = Math.min(t.fuel * (1 + PLANE.mixture), t.ox * (1 + 1 / PLANE.mixture));
  return dvFor(tot, tot - p, m.isp);
}
