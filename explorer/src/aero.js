// Generic aerodynamics keyed off a destination's atmosphere params: density profile, wing lift/drag with stall,
// air-breathing jet thrust falloff, and reentry heating. Pure functions (no scene state).
import { BODIES } from './destinations.js';

export function atmosphereOf(bodyId) {
  const b = BODIES[bodyId];
  if (!b || !b.atmosphere) return null;
  const a = b.atmosphere;
  // surface density from pressure label (atm) ~ 1.2 kg/m^3 per atm (scaled), scale height from the shell thickness
  const atm = parseFloat(a.pressure) || 1;
  const height = a.height * b.R;           // visual shell height (m)
  return { rho0: 1.2 * atm * (b.g / 9.8) ** 0.2, H: height / 7, top: height, R: b.R, g: b.g };
}
export function density(bodyId, alt) {
  const a = atmosphereOf(bodyId);
  if (!a || alt > a.top) return 0;
  return a.rho0 * Math.exp(-Math.max(0, alt) / a.H);
}
export const RHO_REF = 1.2;
/** air-breathing thrust multiplier: falls with density^0.8, dies at Mach 6.5 */
export function jetThrustFactor(rho, mach) {
  if (rho <= 1e-4) return 0;
  const d = Math.pow(Math.min(1.5, rho / RHO_REF), 0.8);
  const m = mach < 3 ? 1 : Math.max(0, 1 - (mach - 3) / 3.5);
  return d * m;
}
/** wing model: area S (m^2), angle of attack alpha (rad). Returns {cl, cd, stalled} */
export function wingCoeffs(alpha, stallAlpha = 0.34) {
  const a = Math.abs(alpha);
  if (a < stallAlpha) return { cl: 5.2 * alpha * 0.5, cd: 0.04 + 1.1 * alpha * alpha, stalled: false };
  const post = Math.sin(2 * alpha) * 0.55;
  return { cl: post, cd: 0.04 + 1.2 * Math.sin(a) ** 2 + 0.2, stalled: true };
}
/** full force on a plane-like body. vAir = airspeed (m/s), alpha rad. Returns {lift, drag} in newtons */
export function aeroForces(rho, speed, alpha, S = 60) {
  const q = 0.5 * rho * speed * speed;
  const c = wingCoeffs(alpha);
  return { lift: q * S * c.cl, drag: q * S * c.cd, q, stalled: c.stalled };
}
/** convective heat flux proxy (W/m^2 scaled) for entry: k * sqrt(rho/Rn) * v^3 */
export function entryHeatFlux(rho, speed, noseR = 1.2) { return 1.7e-4 * Math.sqrt(rho / noseR) * speed * speed * speed; }
/** drag deceleration for blunt orbital craft: ballistic coefficient beta (kg/m^2) */
export function dragDecel(rho, speed, beta = 350) { return 0.5 * rho * speed * speed / beta; }
export const speedOfSound = (bodyId) => 320;

// ---- unified drag + skin-temperature model (same functions drive the orbit view and the surface scene) ----
const SIGMA = 5.67e-8;
/** ballistic coefficient beta (kg/m^2): small = draggy. Lander is a blunt body with no lift; the plane is streamlined. */
export const BETA = { lander: 240, plane: 640, carrier: 1400 };
/** skin limits (K), nose radius (m) controlling stagnation flux, thermal time constant (s) */
export const SKIN = {
  lander:  { limit: 2300, noseR: 3.0, tau: 7 },
  plane:   { limit: 1900, noseR: 0.9, tau: 5 },
  carrier: { limit: 1600, noseR: 4.0, tau: 12 },
};
export const T_AMB = 300;
/** terminal velocity (m/s) of a craft falling at density rho and gravity g */
export const terminalVelocity = (kind, rho, g) => (rho > 0 ? Math.sqrt(2 * g * (BETA[kind] || 640) / rho) : Infinity);
/** drag deceleration (m/s^2) for a vessel kind */
export const dragFor = (kind, rho, speed) => dragDecel(rho, speed, BETA[kind] || 640);
/**
 * Advance skin temperature. Sets v.skinT, v.glow (0..1 visual plasma), v.heatFrac (T/limit, shown on HUD), v.entryQ (MW/m^2).
 * Forgiving: warning at 80% of limit; above the limit damage accrues slowly (v.damage 0..1), never an instant kill.
 * Returns {warn, damaging} flags for the caller to message.
 */
export function thermalStep(v, rho, speed, dt) {
  const S = SKIN[v.kind] || SKIN.plane;
  if (v.skinT === undefined) v.skinT = T_AMB;
  const q = rho > 0 ? entryHeatFlux(rho, speed, S.noseR) : 0;          // W/m^2
  const eq = Math.pow(T_AMB ** 4 + 0.85 * q / SIGMA, 0.25);              // radiative equilibrium wall temp
  const k = 1 - Math.exp(-dt / S.tau);
  v.skinT += (eq - v.skinT) * k;
  v.entryQ = q / 1e6;
  v.heatFrac = (v.skinT - T_AMB) / (S.limit - T_AMB);
  v.glow = Math.max(0, Math.min(1, (v.skinT - 650) / (0.8 * S.limit - 650)));
  let warn = false, damaging = false;
  if (v.skinT > S.limit * 0.8) warn = true;
  if (v.skinT > S.limit) { damaging = true; v.damage = Math.min(1, (v.damage || 0) + dt * (0.012 + 0.08 * (v.skinT / S.limit - 1))); }
  return { warn, damaging };
}
