import * as THREE from 'three';
import { rnd, angDiff } from './util.js?v=32';
import { buildMounts, tickMounts } from './loadout.js?v=32';

// Shared helper for the heavy engines (Harrow, Hierarch, great colossus), AI and piloted alike: five damage components behind the ward,
// three implicit capacitor banks (WARD / DRIVE / ARMS), planting, and energy-weapon costs. See model/heavy-combat-spec.md.
export const COMPS = ['armL', 'armR', 'legs', 'head', 'reactor'];
const SHARE = { armL: 0.18, armR: 0.18, legs: 0.28, head: 0.12, reactor: 0.24 };
const OUT = { colossus: 30, hierarch: 36, harrow: 42 };          // reactor output per second
const WARD6 = { colossus: 6, hierarch: 4, harrow: 3 };            // shield HP removed per WARD capacitor point spent
export const COST = { lance: 100, blaster: 55, lascannon: 35, fist: 20 };
const NAMEOF = { armL: 'LEFT ARM', armR: 'RIGHT ARM', legs: 'LEGS', head: 'HEAD', reactor: 'REACTOR' };
// ward facings (model/objectives-facings-spec.md section 1): the class shield becomes four pools relative to the torso yaw. The shares add up to
// more than 1 on purpose: a frontal-only attacker sees 60% of the old pool, an all-round one has to work for it.
export const FACS = ['front', 'left', 'right', 'rear'];
export const FSHARE = { front: 0.60, left: 0.35, right: 0.35, rear: 0.25 };
export const FSUM = 1.55;                                           // sum of the shares
const REBOOT = { colossus: 15, hierarch: 12, harrow: 10 };          // seconds a collapsed facing stays down
const FNAME = { front: 'FRONT', left: 'LEFT', right: 'RIGHT', rear: 'REAR' };
const DOME = { colossus: 50, hierarch: 30, harrow: 24 };            // dome radius, for the collapse flare
const FANG = { front: 0, left: Math.PI / 2, right: -Math.PI / 2, rear: Math.PI };   // facing centre, from torso forward (+ = the walker's left)
const _a = new THREE.Vector3();

// call once from the constructor (before enter): which class, its maxima, its AI top speed, and its hit volumes
export function setupHeavy(u, hcls, hull, shield, top, geo) { u.hcls = hcls; u.hullMax = hull; u.shieldMax = shield; u.topSpeed = top; u.geo = geo; buildMounts(u, geo.mp); }
// call from enter(): full components, full capacitors
export function resetHeavy(u) {
  u.comp = {}; for (const k of COMPS) u.comp[k] = { hp: SHARE[k] * u.hullMax, max: SHARE[k] * u.hullMax };
  u.cap = { ward: 100, drive: 100, arms: 100 }; u.stillT = 0; u.planted = false; u.recoverT = 0; u.breakT = 0;
  u.lock = { L: null, R: null }; u.auto = { L: false, R: false }; u.lockPt = { L: new THREE.Vector3(), R: new THREE.Vector3() }; u.zones = []; u.focus = null; u.spineCd = 6; u.spineQ = []; u.queuedQ = null; u.legMul = 1; u.spreadMul = 1; u.spent = 0; u.pending = 0;
  u.fac = {}; for (const k of FACS) u.fac[k] = { hp: FSHARE[k] * u.shieldMax, max: FSHARE[k] * u.shieldMax, t: 0, flare: 0, pause: 0 };
  u.wardFx = 0; u.hitFace = null; u.hitT = -99; u.hitYaw = 0; u.shieldHP = FSUM * u.shieldMax;
  u.cl = null; u.ca = null; u.legHitT = -99; u.ocT = 0; u.plan = null; u.planAt = -99; u.planKey = ''; u.planSite = -1; u.ordTgt = null; u.ordered = false;   // princeps spec: crippled legs / disarmed state, Overcharge, battle plan, order state
}
const wardSync = u => { let s = 0; for (const k of FACS) s += u.fac[k].hp; u.shieldHP = s; };
export const wardFrac = u => u.shieldHP / (FSUM * u.shieldMax);                   // total ward, 0..1 (HUD bars)
export function zeroWard(u) { for (const k of FACS) u.fac[k].hp = 0; u.shieldHP = 0; }   // shots: a bare engine
export const faceYaw = (u, k) => u.torsoYaw + FANG[k];                              // world yaw of a facing's centre line
export const faceFrac = (u, k) => { const f = u.fac[k]; return f.t > 0 ? 0 : f.hp / f.max; };
export const faceName = k => FNAME[k];
// which facing a point (or the stashed source u._src) lies on: bearing from the engine centre relative to the torso
export function facingOf(u, pt) {
  const p = pt && pt.x !== undefined && Math.abs(pt.x - u.pos.x) + Math.abs(pt.z - u.pos.z) > 1 ? pt : u._src; if (!p) return 'front';   // no usable point: the stashed source (flames, melta, tank shells)
  const dx = p.x - u.pos.x, dz = p.z - u.pos.z, fx = Math.sin(u.torsoYaw), fz = Math.cos(u.torsoYaw), a = Math.atan2(dx * fz - dz * fx, dx * fx + dz * fz), aa = Math.abs(a);
  return aa < 1.0472 ? 'front' : aa > 2.3562 ? 'rear' : a > 0 ? 'left' : 'right';
}
// the facing breaks: flare and crackle on that side of the dome, an announcement, a timer
function collapse(u, k, byPlayer) {
  const G = u.G, f = u.fac[k]; f.hp = 0; f.t = REBOOT[u.hcls]; f.flare = 2.5;
  const a = faceYaw(u, k), r = DOME[u.hcls]; u.chest(_a); G.fx.flash(u.pos.x + Math.sin(a) * r, _a.y, u.pos.z + Math.cos(a) * r, 0.7, 0.9, 1, 7000, 0.45, 300); G.fx.sparks(u.pos.x + Math.sin(a) * r, _a.y, u.pos.z + Math.cos(a) * r, 18, 26);
  u.shieldA = Math.max(u.shieldA || 0, 1.4);
  G.announce(u.piloted ? 'WARD COLLAPSE - ' + FNAME[k] : u.name + ' - ' + FNAME[k] + ' WARD DOWN');
  if (byPlayer && u.side === 1 && G.wrath) G.wrath.gain(3);   // Wrath: collapsing an enemy heavy's facing (spec 6)
}
// per frame: the dome's collapse glow (uniform uF = flare per facing) and whether the dome must be drawn at all
function wardVis(u, dt) {
  let any = 0; const F = u.shield.material.uniforms.uF.value;
  FACS.forEach((k, i) => { const f = u.fac[k]; f.flare = Math.max(0, f.flare - dt * 2.2); const v = f.t > 0 ? 0.7 + 0.3 * Math.sin(u.G.time * 31 + i * 2) + f.flare : f.flare; F.setComponent(i, v); if (v > 0.01) any = 1; });
  u.shield.material.uniforms.uT.value = u.G.time; u.wardFx = any;
}
export const armOk = (u, k) => u.comp[k].hp > 0;
export const driveScale = u => 0.35 + 0.65 * u.cap.drive / 100;
export const speedMul = u => driveScale(u) * u.legMul * (u.cl ? 0.5 : 1);   // destroyed legs: legMul 0.5 and, while CRIPPLED, a further 0.5 = x0.25

// ---- crippling (model/princeps-spec.md): LEGS destroyed = CRIPPLED (x0.25 speed, capture weight 0, withdraws, repairs LEGS to 40% over 30 s after reaching its bastion zone or 60 s);
// both arms destroyed = DISARMED (withdraws, regains one arm at 40% after 45 s). The piloted engine repairs the same way after 45 s (legs: of not taking leg damage). u.cl / u.ca = the live states.
function crip(u, kind, byPlayer) {
  const G = u.G, legs = kind === 'legs', fresh = legs ? !u.cl : !u.ca;
  if (legs) u.cl = { t: 0, rep: -1 }; else if (!u.ca) u.ca = { t: 0 };
  if (!fresh) return;
  if (u.piloted) G.announce(legs ? 'ENGINE CRIPPLED - LEGS OUT' : 'ENGINE DISARMED - BOTH ARMS OUT');
  else { G.announce(u.name + (legs ? ' CRIPPLED' : ' DISARMED') + ' - WITHDRAWING'); if (G.objectives) G.objectives.withdraw(u); }
  if (byPlayer && u.side === 1 && G.wrath) G.wrath.gain(8);   // Wrath: crippling or disarming an enemy heavy (spec 15)
}
function atBastion(u) { const b = u.G.bastions[u.side]; return Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z) < 300; }
function recovered(u) { if (!u.cl && !u.ca && u.goal && u.goal.wd) { u.goal = null; if (u.G.objectives) u.G.objectives.dirT = Math.min(u.G.objectives.dirT, 0.5); } }
function tickCrip(u, dt) {
  const G = u.G, c = u.comp;
  if (u.cl) {
    const l = u.cl; l.t += dt;
    if (u.piloted) { if (G.time - u.legHitT >= 45) { c.legs.hp = Math.max(c.legs.hp, 0.4 * c.legs.max); u.cl = null; u.legMul = 1; G.announce('LEGS REPAIRED - 40%'); } }
    else {
      if (l.rep < 0 && (l.t >= 60 || atBastion(u))) l.rep = 0;
      if (l.rep >= 0) { l.rep += dt; c.legs.hp = Math.max(c.legs.hp, 0.4 * c.legs.max * Math.min(1, l.rep / 30)); if (l.rep >= 30) { u.cl = null; u.legMul = 1; G.announce(u.name + ' RETURNS TO DUTY'); } }
    }
  }
  if (u.ca) { u.ca.t += dt; if (u.ca.t >= 45) { c.armL.hp = 0.4 * c.armL.max; u.ca = null; if (u.piloted) G.announce('ARM RESTORED - 40%'); else G.announce(u.name + ' RETURNS TO DUTY'); } }
  if (!u.piloted) { if (u.cl || u.ca) { if (G.objectives && !(u.goal && u.goal.wd)) G.objectives.withdraw(u); } else recovered(u); }
}
// a heavy has just been destroyed (call from its damage() when the state goes to dying)
export function heavyDown(u, byPlayer) {
  const G = u.G; u.diedAt = G.time; u.plan = null; u.planKey = ''; u.ordered = false; u.ordTgt = null; u.cl = u.ca = null;
  if (byPlayer && u.side === 1 && G.wrath) G.wrath.gain(12);   // Wrath: heavy kill (spec 25)
}
export const crippled = u => !!(u.cl || u.ca);

// world position of a component (for smoke, sparks and the hit test)
export function partPos(u, k, out) {
  const g = u.geo;
  if (k === 'head') return g.head.getWorldPosition(out);
  if (k === 'armL' || k === 'armR') return g[k][0].getWorldPosition(out);
  if (k === 'legs') { const f = u.legs.feet[0]; return out.set(f.pos.x, g.legTop * 0.5, f.pos.z); }
  return g.reactor.getWorldPosition(out);
}
// which component a hit at world point pt lands on. det: deterministic (for the aim indicator)
export function locate(u, pt, det) {
  u._rear = false;
  if (pt && pt.comp) return pt.comp;
  const g = u.geo;
  if (!pt) { let r = rnd(), k = 0; for (const c of COMPS) { r -= SHARE[c]; if (r <= 0) return c; k++; } return 'reactor'; }
  g.head.getWorldPosition(_a); if (_a.distanceTo(pt) < g.rHead + 0.6) return 'head';
  for (const side of ['armL', 'armR']) for (const o of g[side]) { o.getWorldPosition(_a); if (_a.distanceTo(pt) < g.rArm + 0.6) return side; }
  if (pt.y < g.legTop - (u.sink || 0)) return 'legs';
  const fx = Math.sin(u.torsoYaw), fz = Math.cos(u.torsoYaw), dx = pt.x - u.pos.x, dz = pt.z - u.pos.z;
  if (dx * fx + dz * fz < (g.rearZ || 0)) { u._rear = true; return 'reactor'; }   // rear half of the torso
  const lat = dx * Math.cos(u.torsoYaw) - dz * Math.sin(u.torsoYaw), arm = lat > 0 ? 'armL' : 'armR';   // +x local is the walker's left
  return det ? arm : rnd() < 0.5 ? 'reactor' : arm;                  // front hits split between the reactor and the nearest arm
}
// one hit: S to the shield, H to the bare hull (assigned to a component); `under` is the share of H that ignores the shield outright.
// Returns { ab: shield absorbed, down: the shield broke on this hit }.
export function strike(u, S, H, pt, bypass, byPlayer, under = 0) {
  const G = u.G; let ab = 0, down = false, hull = H * under, rest = H - hull;
  if (u.side === 1 && !byPlayer && G.hornT > 0) { S *= 1.25; H *= 1.25; hull *= 1.25; rest *= 1.25; }   // WAR HORN: allied units deal +25%
  // the ward is four facings: the hit lands on the one its bearing falls in (artillery from above, pt.split, spreads over every standing one); a collapsed arc stops nothing
  const split = !!(pt && pt.split), fk = split ? null : facingOf(u, pt), live = split ? FACS.filter(k => u.fac[k].hp > 0) : u.fac[fk].hp > 0 ? [fk] : [];
  const fs = u._src; u._src = null;   // a stashed source is good for one hit only
  if (!split) { u.hitFace = fk; u.hitT = G.time; const p = pt && pt.x !== undefined && Math.abs(pt.x - u.pos.x) + Math.abs(pt.z - u.pos.z) > 1 ? pt : fs; if (p) u.hitYaw = Math.atan2(p.x - u.pos.x, p.z - u.pos.z); }
  if (live.length && !bypass) {
    const each = S / live.length, broke = [];
    for (const k of live) { const f = u.fac[k], t = Math.min(f.hp, each); f.hp -= t; ab += t; f.pause = Math.max(f.pause, pt && pt.lance ? 8 : pt && pt.brk ? 6 : 5); if (f.hp <= 0) broke.push(k); }   // a hit pauses THAT facing's regen: 3 s, a breaker (lance, battery, missiles, rockets, artillery) 5 s
    rest *= S > 0 ? 1 - ab / S : 0;   // what the shield could not stop carries on to the hull
    for (const k of broke) collapse(u, k, byPlayer);
    wardSync(u);
  } else rest = H - hull;
  hull += rest;
  if (hull > 0) {
    const k = locate(u, pt, false); if (k === 'reactor' && u._rear) hull *= 1.5; if (k === 'legs' && u.planted) hull *= 0.5;
    if (k === 'legs') u.legHitT = G.time;
    const c = u.comp[k], was = c.hp; let take = hull; if (pt && pt.cap) take = Math.min(hull, c.max * pt.cap);   // the Sunspear: at most 60% of the component's max per hit; the excess still comes off total hull, no component
    c.hp = Math.max(0, c.hp - take); u.hp -= hull;
    if (was > 0 && c.hp <= 0 && k !== 'reactor') {
      if (k === 'head') u.spreadMul = 3;
      G.announce(u.name + ' - ' + (k === 'armL' || k === 'armR' ? 'ARM DISABLED' : k === 'legs' ? 'LEGS DISABLED' : 'HEAD DESTROYED'));
      partPos(u, k, _a); G.fx.explosion(_a.x, _a.y, _a.z, 0.9, { silent: true });
      if (byPlayer && u.side === 1 && G.wrath) G.wrath.gain(5);   // Wrath: destroying an enemy component (spec 10)
      if (k === 'legs') { u.legMul = 0.5; crip(u, 'legs', byPlayer); } else if (k !== 'head' && !armOk(u, 'armL') && !armOk(u, 'armR')) crip(u, 'arms', byPlayer);
    }
  }
  return { ab, down };
}

// capacitors and shield regeneration, once a frame for an alive heavy (AI or piloted)
export function tickHeavy(u, dt) {
  const G = u.G, c = u.cap, out = OUT[u.hcls], sp = Math.abs(u.speed);
  if (sp < 1.5) u.stillT += dt; else u.stillT = 0;
  u.planted = u.stillT >= 1.0;
  c.drive = Math.max(0, c.drive - out * 0.7 * Math.min(1, sp / u.topSpeed) * dt);      // moving costs power
  let fl = out * dt; const d = Math.min(fl, 100 - c.drive); c.drive += d; fl -= d;      // DRIVE draws first
  const a = Math.min(fl, 100 - c.arms); c.arms += a; fl -= a;                            // ARMS gets what is left until full
  const share = fl / (out * dt); c.ward = Math.min(100, c.ward + fl);                    // WARD gets the rest
  u.recoverT = Math.max(0, u.recoverT - dt); u.breakT = Math.max(0, u.breakT - dt);   // breakT: a shield-breaker hit pauses regen for 3 s
  // each facing regenerates on its own: the ward's regen rate is shared out by facing max (a collapsed facing takes its share with it); only FRONT gets the planted max bonus
  const base = 70 * u.shieldMax / 900, O = G.objectives; let R = 0;
  if ((u.planted || G.time - u.lastDmg > 18) && u.recoverT <= 0) R = (u.planted ? 1.5 * base : base * (0.4 + 1.2 * share)) * (O ? O.wardMul(u) : 1) * dt;   // planted: a flat 1.5x the base rate; a held ward anchor stacks 1.5x
  const rb = O ? O.rebootRate(u) : 1;
  for (const k of FACS) {
    const f = u.fac[k]; f.pause = Math.max(0, f.pause - dt * (u.ocT > 0 ? 2 : 1));   // OVERCHARGE: the regen pause runs twice as fast (halved)
    if (f.t > 0) { f.t -= dt * rb; if (f.t <= 0) { f.t = 0; f.hp = 0.3 * f.max; f.flare = 1.2; } continue; }   // collapsed: back at 30% when the reboot ends
    const cap = f.max * (k === 'front' && u.planted ? 1.15 : 1);
    if (R > 0 && f.pause <= 0 && f.hp < cap) f.hp = Math.min(cap, f.hp + R * f.max / (FSUM * u.shieldMax));
    if (f.hp > f.max && !(k === 'front' && u.planted)) f.hp = Math.max(f.max, f.hp - 20 * dt * f.max / u.shieldMax);   // the planted bonus bleeds off once you move
  }
  wardSync(u); wardVis(u, dt);
  tickCrip(u, dt); u.ocT = Math.max(0, u.ocT - dt);
  tickMounts(u, dt);   // quad flak and the zone-driven secondaries
  // destroyed components smoke and spark from their part of the rig
  for (const k of COMPS) if (k !== 'reactor' && u.comp[k].hp <= 0 && rnd() < dt * 5) {
    partPos(u, k, _a); G.fx.smoke(_a.x, _a.y, _a.z, 2, 6, 0, 3, 5, 14, 0.05, 0.6, 0.2); if (rnd() < 0.5) G.fx.sparks(_a.x, _a.y, _a.z, 6, 20);
  }
}
// take `amt` from ARMS, then DRIVE, then WARD (each WARD point lost strips shield)
function drain(u, amt) {
  const c = u.cap; let t = Math.min(c.arms, amt); c.arms -= t; amt -= t;
  t = Math.min(c.drive, amt); c.drive -= t; amt -= t;
  t = Math.min(c.ward, amt); c.ward -= t;
  let loss = t * WARD6[u.hcls];   // WARD-capacitor spill strips FRONT first, then the sides, then REAR
  for (const k of FACS) { const f = u.fac[k]; if (loss <= 0) break; if (f.hp <= 0) continue; const x = Math.min(f.hp, loss); f.hp -= x; loss -= x; if (f.hp <= 0) collapse(u, k); }
  wardSync(u);
}
export function spendEnergy(u, cost) { if (u.ocT > 0) return; drain(u, cost); u.recoverT = 2.5; }   // OVERCHARGE: energy weapons cost no capacitor          // an energy shot: you can always fire, but you pay
export function chargeDrain(u, amt) { if (u.ocT > 0) return; drain(u, amt); u.spent += amt; }                // a charging weapon drains over the charge
export function chargeDone(u) { u.spent = 0; u.pending = 0; u.recoverT = 2.5; }
export function chargeCancel(u) { u.cap.arms = Math.min(100, u.cap.arms + u.spent * 0.5); u.spent = 0; u.pending = 0; }   // half refunded
// AI rule: do not fire an energy weapon if it would drop WARD below 30 while an enemy heavy is targeting it
export function aiMayFire(u, cost, threatened) {
  if (!threatened) return true; const c = u.cap, spill = Math.max(0, cost - c.arms - c.drive); return c.ward - spill >= 30;
}
// splash that hurts heavy engines as well as the usual blast: S/H per engine within r (+ its body radius) of the impact
export const HITR = { colossus: 36, hierarch: 18, harrow: 16 };
export function splashEngines(G, x, y, z, r, S, H, byPlayer, except, brk, split) {
  const pt = { x, y, z, brk: !!brk }; if (split) pt.split = true;
  for (const st of G.structs) if (st.alive && (byPlayer ? st.side === 1 : st.side !== (except ? except.side : -1)) && Math.hypot(st.pos.x - x, st.pos.z - z) < r + st.radius) st.damage(S, byPlayer, false, pt, H);
  for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) {
    if (e === except || !e.alive || (e.piloted && byPlayer)) continue;
    if (Math.hypot(e.pos.x - x, e.pos.z - z) < r + HITR[e.hcls]) { e.damage(S, byPlayer, false, pt, H); if (brk) e.breakT = Math.max(e.breakT, 5); }   // breaker splash (battery/missiles): 5 s regen pause, planted colossus breaks in ~26 s
  }
}
export const nameOf = k => NAMEOF[k];
// ---- AI use of the facings (spec section 3) ----
// +0.3 target weight on an enemy heavy whose arc toward (x, z) is collapsed, if there is a line of fire into it
export function foeWeak(t, x, z) { return t.fac && t.fac[facingOf(t, { x, z })].t > 0 && t.G.city.los(x, 40, z, t.pos.x, 40, t.pos.z) ? 0.3 : 0; }
// torso offset (|off| <= cap, so it can still shoot) that swings the attacker out of a collapsed arc and into the healthy front one; 0 when nothing to do
export function wardTurn(u, ay, cap) {
  if (u.G.time - u.hitT > 6 || !u.hitFace || u.hitFace === 'front' || u.fac[u.hitFace].t <= 0 || u.fac.front.t > 0) return 0;
  const rel = angDiff(u.hitYaw, ay), need = rel - Math.sign(rel) * 0.95; if (need * rel <= 0) return 0;
  return Math.max(-cap, Math.min(cap, need));
}
// allied AI: when the enemy heavy `t` is engaging the player's engine, a stand-off point on `t` at a bearing 60+ degrees off the player's line (the nearer side); false when already there / n/a
export function flankPoint(u, t, range, out) {
  const G = u.G, pl = G.player; if (u.side !== 0 || !pl.heavy || pl._dead || !t.fac || !t.alive || (t.tgt !== pl.unit && t.target !== pl.unit && u.ordTgt !== t) || u === pl.unit) return false;   // (an engine ordered to KILL it flanks it too)
  const a0 = Math.atan2(pl.pos.x - t.pos.x, pl.pos.z - t.pos.z), mine = angDiff(Math.atan2(u.pos.x - t.pos.x, u.pos.z - t.pos.z), a0);
  if (Math.abs(mine) >= 1.1) return false;   // already well off the line
  const a = a0 + (mine >= 0 ? 1.3 : -1.3); out.set(t.pos.x + Math.sin(a) * range, 0, t.pos.z + Math.cos(a) * range); return true;
}
export function isTargeted(u) {   // is an enemy heavy aiming at this engine?
  const G = u.G;
  for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side !== u.side && e.alive && !e.piloted && (e.tgt === u || e.target === u)) return true;
  return false;
}

// paper-doll of the five components (HUD): colour by remaining HP, shield as an outline, hi = highlighted component
const ARC = { front: [-60, 60], right: [60, 135], rear: [135, 225], left: [225, 300] }, ptAt = d => `${(30 + 28 * Math.sin(d * Math.PI / 180)).toFixed(1)} ${(40 - 36 * Math.cos(d * Math.PI / 180)).toFixed(1)}`;
export function dollSVG(u, hi, face, own) {   // ring of four facing arcs (front up): colour = fill, a collapsed arc is broken dark red (own doll: with its countdown); face = the arc the player's shot would hit
  const col = k => { const c = u.comp[k], f = c.hp / c.max; return f <= 0 ? '#2a1a14' : f > 0.6 ? '#7ad06a' : f > 0.3 ? '#e0b030' : '#e04a28'; };
  const st = k => `fill="${col(k)}" stroke="${hi === k ? '#fff' : '#000'}" stroke-width="${hi === k ? 2.2 : 0.8}"`;
  let ring = '';
  for (const k of FACS) {
    const [a, b] = ARC[k], f = u.fac[k], d = `M${ptAt(a + 2)} A28 36 0 0 1 ${ptAt(b - 2)}`, fr = f.t > 0 ? 0 : f.hp / f.max;
    if (face === k) ring += `<path d="${d}" fill="none" stroke="#fff" stroke-width="5.5" stroke-opacity="0.85" stroke-linecap="round"/>`;
    ring += f.t > 0 ? `<path d="${d}" fill="none" stroke="#8a1a14" stroke-width="2.4" stroke-dasharray="${own ? '5 3' : '2 5'}"/>` : `<path d="${d}" fill="none" stroke="${fr > 0.6 ? '#5ab8ff' : fr > 0.3 ? '#e0b030' : '#e04a28'}" stroke-width="${(2.6 * (0.45 + 0.55 * fr)).toFixed(2)}"/>`;
    if (own && f.t > 0) { const m = (a + b) / 2 * Math.PI / 180, tx = 30 + 21 * Math.sin(m), ty = 40 - 27 * Math.cos(m) + 3; ring += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="9" font-family="Consolas,monospace" text-anchor="middle" fill="#ff5a40">${Math.ceil(f.t)}</text>`; }
  }
  return `<svg viewBox="0 0 60 78" width="${own ? 64 : 54}" height="${own ? 83 : 70}">${ring}`
    + `<circle cx="30" cy="14" r="6" ${st('head')}/><rect x="19" y="22" width="22" height="22" ${st('reactor')}/><rect x="6" y="22" width="11" height="20" ${st('armL')}/><rect x="43" y="22" width="11" height="20" ${st('armR')}/>`
    + `<rect x="19" y="46" width="9" height="26" ${st('legs')}/><rect x="32" y="46" width="9" height="26" ${st('legs')}/></svg>`;
}
