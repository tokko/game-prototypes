// Surface-to-orbit budget after a FULL surface refuel (ISRU), per body and craft.
// Prospector (chemical, was the Heron): rocket ascent. Albatross: airless worlds = vertical rocket launch (nose up, engines down); atmospheric worlds =
// runway takeoff on wheels, air-breathing jets to Mach 6.5 at high altitude, then closed-cycle rocket to orbit.
import { BODIES, circSpeed } from './destinations.js';
import { LANDER, PLANE, exhaustV, planeWet, landerWet } from './craft.js';

export const JET = { machLimit: 6.5, soundSpeed: 320, climbLossFactor: 1.3, flownDv: 750 };   // flownDv: what the jet leg actually adds before the rocket switch (Mach ~2.1, measured in the flight scene)

function rocketNeed(b, aAvg, drag, flownK = 1) {
  const vc = circSpeed(b), tBurn = vc / aAvg;
  const gravLoss = 0.55 * b.g * tBurn, dragLoss = drag ? 0.07 * vc + 90 : 0;      // flown loss on atmospheric worlds is ~15% above this (see README ascent test)
  return { vc, need: (vc + gravLoss + dragLoss + 20) * (drag ? flownK : 1), gravLoss, dragLoss };
}
export function ascentReport(bodyId) {
  const b = BODIES[bodyId]; const atm = !!b.atmosphere;
  // --- Prospector
  const mH0 = landerWet(), mH1 = LANDER.dry + 150;
  const aH = LANDER.thrust / Math.sqrt(mH0 * mH1);
  const nH = rocketNeed(b, aH, atm);
  const capH = exhaustV(LANDER.isp) * Math.log(mH0 / (LANDER.dry));
  const lander = { need: nH.need, have: capH, ok: capH >= nH.need * 1.05, margin: capH / nH.need - 1, mode: 'rocket' };
  // --- Albatross
  const m0 = planeWet();
  const aP = PLANE.modes.rocket.thrust / Math.sqrt(m0 * (PLANE.dry + PLANE.h2Max + 300));
  let plane;
  if (!atm) {
    const n = rocketNeed(b, aP, false);
    const prop = PLANE.fuelMax + PLANE.oxMax, cap = exhaustV(PLANE.modes.rocket.isp) * Math.log(m0 / (m0 - prop));
    plane = { need: n.need, have: cap, ok: cap >= n.need * 1.05, margin: cap / n.need - 1, mode: 'vertical launch' };
  } else {
    const vJet = JET.flownDv;
    const n = rocketNeed(b, aP, true, 1.15);        // 1.15: flown loss factor measured in the Verdant ascent test (plane only)
    const vTarget = n.vc * 1.02 + 20 + 0.55 * b.g * 60;
    const vUse = Math.min(vJet, vTarget);                                                       // jets only burn as far as they need to
    const mf = m0 * (1 - Math.exp(-(vUse * JET.climbLossFactor) / exhaustV(PLANE.modes.jet.isp)));   // methane burned in the jet climb
    const m1 = m0 - mf;
    const dvR = Math.max(0, vTarget - vJet) * 1.85;      // 1.85: flown rocket dv / ideal rocket dv in the Verdant run (steep zoom climb, drag + gravity loss: about 2,880 to 2,990 flown vs 1,556 ideal)
    const propR = m1 * (1 - Math.exp(-dvR / exhaustV(PLANE.modes.rocket.isp)));
    const fuelNeed = mf + propR / (1 + PLANE.mixture), oxNeed = propR * PLANE.mixture / (1 + PLANE.mixture);
    const okFuel = fuelNeed <= PLANE.fuelMax, okOx = oxNeed <= PLANE.oxMax;
    const margin = Math.min(PLANE.fuelMax / fuelNeed, PLANE.oxMax / oxNeed) - 1;
    plane = { need: n.need, jetDv: vJet, rocketDv: dvR, fuelNeed, oxNeed, ok: okFuel && okOx && margin >= 0.015, margin, mode: 'runway + jets + rocket', rocketOnlyOk: exhaustV(PLANE.modes.rocket.isp) * Math.log(m0 / (m0 - PLANE.fuelMax - PLANE.oxMax)) >= n.need };
  }
  return { body: bodyId, lander, plane };
}
