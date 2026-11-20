import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
const { Vector3 } = await import('three');
const P = new URL('../src/', import.meta.url).href;
const { World, WARP } = await import(P + 'world.js');
const A = await import(P + 'autopilot.js');
const { BODIES } = await import(P + 'bodies.js');
const w = new World(); const C = w.carrier, L = w.lander;
const log = (s) => console.log(`UT ${w.UT.toFixed(0)} warp ${WARP[w.warpIndex]} ${s}`);
function run(cond, maxT = 2e6, dtf = 1 / 60) {
  let n = 0; const T0 = w.UT;
  while (w.UT < T0 + maxT && w.status === 'running' && !cond()) { w.step(dtf); n++; while (w.msgs.length) log(w.msgs.shift().text); if (n > 4e6) break; }
}
const prop = (v) => v.res.fuel + v.res.ox;
const orb = (v) => { const B = BODIES[v.body]; return `${v.id}@${v.body} pe ${((v.orbit.rp - B.radius) / 1000).toFixed(1)} ap ${isFinite(v.orbit.ra) ? ((v.orbit.ra - B.radius) / 1000).toFixed(1) : 'inf'} e ${v.orbit.e.toFixed(3)}`; };
const dv = (v, m0, m1) => v.spec.isp * 9.80665 * Math.log(m0 / m1);

// ---- transfer, capture
console.log('xfer:', A.engageAutopilot(w, C, 'xfer'));
run(() => C.body === 'moon');
console.log('circ:', A.engageAutopilot(w, C, 'circ'));
run(() => !C.ap, 20000);
console.log(orb(C), 'carrier prop', prop(C).toFixed(0), 'ec', C.ec.toFixed(0), 'heat', C.heat.toFixed(1));
assert(C.body === 'moon' && C.orbit.e < 0.01, 'captured in a circular Pell orbit');

// ---- undock, land
const cProp0 = prop(C), lProp0 = L.spec.fuelCap + L.spec.oxCap; // placeholder, set below after undock
assert(w.undock(), 'undock');
w.warpIndex = 0;
const lStart = prop(L), mStart = w.massOf(L);
console.log('lander at undock: prop', lStart.toFixed(0), 'mass', mStart.toFixed(0));
console.log('land:', A.engageAutopilot(w, L, 'land'));
run(() => L.status !== 'flying', 20000);
assert(L.status === 'landed', 'landed: ' + (w.crash && w.crash.reason));
const mLand = w.massOf(L);
const descentProp = lStart - prop(L);
console.log(`landed: gear ${L.dep.gear.p} descent propellant ${descentProp.toFixed(0)} kg (dv ${dv(L, mStart, mLand).toFixed(0)} m/s) ec ${L.ec.toFixed(0)} heat ${L.heat.toFixed(1)}`);
assert(L.dep.gear.p === 1, 'landing assist deployed the gear');

// ---- rover: displace the lander ~260 m off its beacon (as if the assist had missed), then drive back into the ring
{
  const site = w.siteNear(L); assert(site, 'landed inside a ring');
  const Rm = BODIES.moon.radius, up0 = L.landedDir.clone();
  const tang = new Vector3().crossVectors(site.dir, new Vector3(0, 0, 1)).normalize();
  const a = 260 / Rm;
  L.landedDir.copy(site.dir).multiplyScalar(Math.cos(a)).addScaledVector(tang, Math.sin(a)).normalize();
  assert(!w.siteNear(L), 'moved out of the ring');
  assert(!w.toggleDrive(L), 'drive mode on');
  const ec0 = L.ec; let t = 0, topSpeed = 0;
  while (!w.siteNear(L) && t < 300) {
    const up = L.landedDir, f = new Vector3(0, 0, 1).applyQuaternion(L.q); f.addScaledVector(up, -f.dot(up)).normalize();
    const right = new Vector3().crossVectors(f, up), to = site.dir.clone().addScaledVector(up, -site.dir.dot(up));
    const rel = Math.atan2(to.dot(right), to.dot(f));
    w.input.drive = { fwd: Math.abs(rel) < 0.9 ? 1 : 0, steer: Math.max(-1, Math.min(1, rel * 2)), brake: false };
    w.step(1 / 60); t += 1 / 60; topSpeed = Math.max(topSpeed, Math.abs(L.driveSpeed));
  }
  w.input.drive = { fwd: 0, steer: 0, brake: true };
  for (let i = 0; i < 300 && Math.abs(L.driveSpeed) > 0.05; i++) w.step(1 / 60);
  const dist = Math.acos(Math.min(1, L.landedDir.dot(site.dir))) * Rm;
  const up = L.landedDir, nose = new Vector3(0, 1, 0).applyQuaternion(L.q);
  console.log(`rover: drove back into ${site.name} in ${t.toFixed(0)} s (top ${topSpeed.toFixed(1)} m/s), ${dist.toFixed(0)} m from centre, EC ${ec0.toFixed(0)} -> ${L.ec.toFixed(0)}, upright error ${(Math.acos(Math.min(1, nose.dot(up))) * 180 / Math.PI).toFixed(2)} deg`);
  assert(w.siteNear(L), 'drove into the beacon ring');
  assert(topSpeed > 3 && topSpeed <= 7.01, 'chill top speed');
  assert(L.ec < ec0, 'driving used battery');
  assert(!w.toggleDrive(L) && !L.driving, 'drive mode off');
  w.input.drive = { fwd: 0, steer: 0, brake: false };
}

// ---- ISRU on the ground: panels + radiators, drill to a full hold, refine to full tanks
w.toggleDeploy(L, 'panels'); w.toggleDeploy(L, 'radiators'); run(() => false, 4);
let t0 = w.UT;
// drill AND refine at the same time with panels + radiators out: must be sustainable (battery never falls, heat stays far below the soft limit)
const ecStart = L.ec; let minEC = L.ec, maxHeat = 0, minDrillF = 1, minRefF = 1;
L.drilling = true; L.refining = true;
let firstCheck = true;
run(() => { if (firstCheck) { firstCheck = false; return false; } minEC = Math.min(minEC, L.ec); maxHeat = Math.max(maxHeat, L.heat); if (L.drilling) minDrillF = Math.min(minDrillF, L.drillF); if (L.refining) minRefF = Math.min(minRefF, L.refF); return !L.drilling; }, 3000);
console.log(`ISRU drill+refine, panels+radiators out: EC gen ${L.ecGen.toFixed(1)} use ${L.ecUse.toFixed(1)} net ${L.ecNet.toFixed(1)}/s (min ${minEC.toFixed(0)}), heat made ${L.heatGen.toFixed(1)} radiated ${L.heatDis.toFixed(1)} (max ${(maxHeat / L.spec.heatMax * 100).toFixed(0)}% of max, soft ${(L.spec.heatSoft / L.spec.heatMax * 100).toFixed(0)}%), min throttle factors drill ${minDrillF.toFixed(2)} refine ${minRefF.toFixed(2)}`);
assert(minEC >= ecStart - 1, 'battery sustained (panels out, sunlight)');
assert(maxHeat < 0.5 * L.spec.heatSoft, 'never near the heat soft limit with radiators out');
assert(minDrillF === 1 && minRefF === 1, 'no throttling in normal operation');
console.log(`drilled ${L.res.ore.toFixed(0)} kg ore in ${(w.UT - t0).toFixed(0)} s; ec ${L.ec.toFixed(0)} heat ${L.heat.toFixed(1)}`);
const oreMined = L.res.ore; L.refining = false;
t0 = w.UT; L.refining = true; run(() => !L.refining, 3000);
console.log(`refined to ${prop(L).toFixed(0)} kg propellant in ${(w.UT - t0).toFixed(0)} s; ore left ${L.res.ore.toFixed(0)}; ec ${L.ec.toFixed(0)} heat ${L.heat.toFixed(1)}`);
assert(prop(L) > 0.99 * (L.spec.fuelCap + L.spec.oxCap), 'lander tanks full');

// ---- ascent, circularize
w.warpIndex = 0;
const mLift = w.massOf(L), pLift = prop(L);
console.log('asc:', A.engageAutopilot(w, L, 'asc'));
run(() => !L.ap || L.ap.type !== 'asc', 4000);
run(() => !L.ap, 20000);
const ascentProp = pLift - prop(L);
console.log(`orbit: ${orb(L)} ascent+circularize propellant ${ascentProp.toFixed(0)} kg (dv ${dv(L, mLift, w.massOf(L)).toFixed(0)} m/s)`);
assert(L.status === 'flying' && L.orbit.e < 0.02, 'lander in orbit');
// refine the rest of the ore in orbit (works in flight)
const pBefore = prop(L); L.refining = true; run(() => !L.refining, 10); L.refining = false;
console.log(`in-orbit refine: ${pBefore.toFixed(0)} -> ${prop(L).toFixed(0)} kg propellant, ore left ${L.res.ore.toFixed(0)}`);
assert(prop(L) > pBefore, 'lander refined in orbit');

// ---- rendezvous, dock
console.log('rdv:', A.engageAutopilot(w, L, 'rdv'));
run(() => L.status === 'docked' || !L.ap, 20000);
assert(L.status === 'docked', 'docked');
const oreAboard = L.res.ore;

// ---- docked transfers: offload ore, refine on the carrier, refuel the lander
assert(!w.startPump('offload'), 'offload pump'); const tp = w.UT; run(() => !w.pumps.length, 120);
console.log(`offloaded ${oreAboard.toFixed(0)} kg ore in ${(w.UT - tp).toFixed(0)} s; carrier ore ${C.res.ore.toFixed(0)}`);
w.toggleDeploy(C, 'radiators'); run(() => false, 4);
const cp1 = prop(C); t0 = w.UT; C.refining = true; run(() => !C.refining, 3000);
console.log(`carrier refined ore: propellant ${cp1.toFixed(0)} -> ${prop(C).toFixed(0)} kg in ${(w.UT - t0).toFixed(0)} s (heat ${C.heat.toFixed(1)}, ec ${C.ec.toFixed(0)})`);
const lp = prop(L); assert(!w.startPump('refuel'), 'refuel pump'); const tq = w.UT; run(() => !w.pumps.length, 120);
console.log(`refuelled lander ${lp.toFixed(0)} -> ${prop(L).toFixed(0)} kg in ${(w.UT - tq).toFixed(0)} s`);
w.updateObjectives();
console.log('done objectives', Object.keys(w.done).length, 'complete', !!w.flags.complete);

// ---- the loop must be net-positive
const trip = descentProp + ascentProp;
console.log(`round trip propellant: descent ${descentProp.toFixed(0)} + ascent ${ascentProp.toFixed(0)} = ${trip.toFixed(0)} kg; ore mined ${oreMined.toFixed(0)} kg`);
console.log(`carrier propellant: at undock ${cProp0.toFixed(0)} -> now ${prop(C).toFixed(0)} (net ${(prop(C) - cProp0).toFixed(0)} kg); lander ${lStart.toFixed(0)} -> ${prop(L).toFixed(0)}`);
assert(prop(C) > cProp0, 'carrier ends with more propellant than at undock');
assert(prop(L) >= lStart - 1, 'lander ends at least as full as it started');
assert(w.flags.complete, 'all objectives complete');
console.log('PASS');
