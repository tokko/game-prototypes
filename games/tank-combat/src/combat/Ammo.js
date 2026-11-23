// Ammunition definitions. Index order = key order (1-4).
export const AMMO = [
  {
    id: 'APFSDS', name: 'APFSDS', kind: 'kinetic', key: '1',
    desc: 'Kinetic penetrator. Very fast, flat trajectory, best against armour.',
    good: 'Best against tanks (penetration drops slowly with range). Passes through IFVs, trucks and infantry.',
    speed: 1650, damage: 1000, splash: 0, count: 18,
    tracerColor: [1.0, 0.9, 0.62], tracerLen: 9, tracerWidth: 0.05, life: 8,
  },
  {
    id: 'HEAT', name: 'HEAT', kind: 'explosive', key: '2',
    desc: 'Shaped charge. Good armour penetration with a small blast.',
    good: 'Constant penetration. Kills IFVs and infantry teams; fair against tanks and structures.',
    speed: 1050, damage: 800, splash: 6, count: 8,
    tracerColor: [1.0, 0.66, 0.3], tracerLen: 6, tracerWidth: 0.06, life: 10,
  },
  {
    id: 'HE', name: 'HE', kind: 'explosive', key: '3',
    desc: 'High explosive. Large blast radius against soft targets and structures.',
    good: 'Infantry, IFVs, missile teams and the strongpoint. Weak against tank armour.',
    speed: 900, damage: 450, splash: 14, count: 12,
    tracerColor: [1.0, 0.55, 0.25], tracerLen: 5, tracerWidth: 0.07, life: 12,
  },
  {
    id: 'SMOKE', name: 'SMOKE', kind: 'smoke', key: '4',
    desc: 'Creates a dense smoke cloud that blocks line of sight for about 25 s.',
    good: 'Breaks line of sight and missile guidance. Use it to cover a move.',
    speed: 400, damage: 0, splash: 0, count: 6,
    tracerColor: [0.95, 0.95, 0.9], tracerLen: 2.2, tracerWidth: 0.08, life: 18,
  },
];

export const MG = {
  id: 'MG', name: 'COAX MG', kind: 'mg',
  speed: 860, damage: 6, rate: 12, belt: 400, spread: 0.004,
  tracerColor: [1.0, 0.82, 0.4], tracerLen: 3.2, tracerWidth: 0.025, life: 3.5,
};

// vehicle smoke grenade: tiny dark body with a grey trail, air-bursts after 0.9 s (~25 m out, ~5 m up)
export const GRENADE = {
  id: 'GRENADE', name: 'SMOKE GRENADE', kind: 'grenade',
  speed: 30, damage: 0, splash: 0, burstTime: 0.9, noTracer: true, trail: true,
  tracerColor: [0.9, 0.9, 0.9], tracerLen: 0.45, tracerWidth: 0.1, life: 3,
};

export const COSTS = {
  reloadTime: 4.0,   // seconds after firing
  swapTime: 2.8,     // seconds to swap a chambered round for another type
  smokeCharges: 3,
  smokeCooldown: 4.0,
};

// ---- enemy weapons ----
export const ENEMY_AP = {
  id: 'E_AP', name: 'AP', kind: 'kinetic', speed: 1500, damage: 30, splash: 0,
  tracerColor: [1.0, 0.55, 0.25], tracerLen: 8, tracerWidth: 0.06, life: 6,
};
// IFV autocannon (fired in bursts): modest damage, only dangerous against the player's side and rear armour
export const ENEMY_AC = {
  id: 'E_AC', name: 'AC', kind: 'mg', speed: 1100, damage: 8, splash: 0,
  tracerColor: [1.0, 0.5, 0.2], tracerLen: 4, tracerWidth: 0.045, life: 4,
};
// wire-guided anti-tank missile: slow, visible, steered by the launching team while it keeps line of sight
export const ATGM = {
  id: 'ATGM', name: 'ATGM', kind: 'explosive', speed: 170, damage: 0, splash: 4, guided: true, noGravity: true, trail: true, trailStep: 0.012,
  tracerColor: [1.0, 0.78, 0.45], tracerLen: 5, tracerWidth: 0.12, life: 14,
};
export const NEST_MG = {
  id: 'NEST_MG', name: 'MG', kind: 'mg', speed: 820, damage: 3, splash: 0,
  tracerColor: [1.0, 0.4, 0.2], tracerLen: 3, tracerWidth: 0.03, life: 3,
};
