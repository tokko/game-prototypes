import * as THREE from 'three';
import { Builder, PAL, rr, angDiff, clamp, damp } from './util.js?v=32';
import { LIVERY } from './walker.js?v=32';
import { COST } from './heavy.js?v=32';

// Loadouts and command (model/loadouts-command-spec.md, mount visuals model/hardpoints-visual.md): quad flak (aircraft only) and zone-driven
// secondaries as a small data table per class, attached to the existing rig nodes; arm target-locks; the back missile spine. Targets are picked
// at 5 Hz, shots share the tracer pool. The Kestrel has none of this.
const PI = Math.PI, DEG = PI / 180, hp_ = PI / 2, q_ = PI / 4;
const FREE = [-PI, PI];
const MOUNTS = {
  harrow: [
    { id: 'flak_1', k: 'flak', kind: 'turret', sc: 0.9, par: 'torso', pos: [15.5, 19.5, -1.0], arc: FREE, pit: [0.25, 1.45], rest: [0, 0.6], slew: 2.5, range: 350 },
    { id: 'autogun', k: 'sec', kind: 'ball', par: 'torso', pos: [0, 12.34, 13.3], rotx: 0.4, arc: [-90 * DEG, 90 * DEG], pit: [-0.4, 0.35], rest: [0, 0], slew: 3, range: 120, rate: 8, d: { tank: 15, scout: 4, S: 1, H: 1 }, tr: [480, 12, 0.35, 1.3], mz: 0.8, imp: 0.6 }],
  hierarch: [
    { id: 'flak_1', k: 'flak', kind: 'turret', sc: 1.0, par: 'torso', pos: [-13.6, 15.6, 0], arc: [-195 * DEG, 100 * DEG], pit: [0.25, 1.45], rest: [-40 * DEG, 0.6], slew: 2.5, range: 350 },
    { id: 'flak_2', k: 'flak', kind: 'turret', sc: 0.9, par: 'torso', pos: [0, 15.1, -10.7], arc: [80 * DEG, 280 * DEG], pit: [0.25, 1.45], rest: [180 * DEG, 0.6], slew: 2.5, range: 350 },
    { id: 'bolter_L', k: 'sec', kind: 'ball', par: 'torso', pos: [22.4, 11, 0], arc: [-45 * DEG, 225 * DEG], pit: [-0.5, 0.5], rest: [0, 0], slew: 3, range: 150, rate: 10, d: { tank: 20, scout: 6, S: 1, H: 2 }, tr: [420, 9, 0.6, 1.6], mz: 1.1, imp: 0.9 },
    { id: 'bolter_R', k: 'sec', kind: 'ball', par: 'torso', pos: [-22.4, 11, 0], arc: [-225 * DEG, 45 * DEG], pit: [-0.5, 0.5], rest: [0, 0], slew: 3, range: 150, rate: 10, d: { tank: 20, scout: 6, S: 1, H: 2 }, tr: [420, 9, 0.6, 1.6], mz: 1.1, imp: 0.9 },
    { id: 'kneegun_L', k: 'sec', kind: 'ball', par: 'knee0', pos: [0, 4.0, 6.5], rotx: -hp_, arc: [-100 * DEG, 100 * DEG], pit: [-0.6, 0.6], rest: [0, 0], slew: 4, range: 90, rate: 12, every: 2, d: { tank: 10, scout: 4 }, tr: [380, 7, 0.3, 1.1], mz: 0.6, imp: 0.5, knee: true },
    { id: 'kneegun_R', k: 'sec', kind: 'ball', par: 'knee1', pos: [0, 4.0, 6.5], rotx: -hp_, arc: [-100 * DEG, 100 * DEG], pit: [-0.6, 0.6], rest: [0, 0], slew: 4, range: 90, rate: 12, every: 2, d: { tank: 10, scout: 4 }, tr: [380, 7, 0.3, 1.1], mz: 0.6, imp: 0.5, knee: true }],
  colossus: [
    { id: 'flak_1', k: 'flak', kind: 'turret', sc: 1.5, par: 'torso', pos: [0, 27, 15], arc: [-100 * DEG, 100 * DEG], pit: [0.25, 1.45], rest: [0, 0.6], slew: 2.5, range: 450 },
    { id: 'flak_2', k: 'flak', kind: 'turret', sc: 1.5, par: 'torso', pos: [17, 29.5, 7], arc: [-20 * DEG, 220 * DEG], pit: [0.25, 1.45], rest: [45 * DEG, 0.6], slew: 2.5, range: 450 },
    { id: 'flak_3', k: 'flak', kind: 'turret', sc: 1.5, par: 'torso', pos: [-17, 29.5, 7], arc: [-220 * DEG, 20 * DEG], pit: [0.25, 1.45], rest: [-45 * DEG, 0.6], slew: 2.5, range: 450 },
    { id: 'turret_L', k: 'sec', kind: 'turret', par: 'torso', pos: [28.5, 35, -2], arc: [-80 * DEG, 220 * DEG], pit: [-0.35, 0.9], rest: [0, 0], slew: 1.6, range: 300, burst: 4, gap: 0.12, d: { tank: 40, scout: 25, air: 30, S: 2, H: 4 }, splash: 6, tr: [500, 30, 1.0, 1.7], mz: 2.0, imp: 0.8 },
    { id: 'turret_R', k: 'sec', kind: 'turret', par: 'torso', pos: [-28.5, 35, -2], arc: [-220 * DEG, 80 * DEG], pit: [-0.35, 0.9], rest: [0, 0], slew: 1.6, range: 300, burst: 4, gap: 0.12, d: { tank: 40, scout: 25, air: 30, S: 2, H: 4 }, splash: 6, tr: [500, 30, 1.0, 1.7], mz: 2.0, imp: 0.8 },
    { id: 'spine', k: 'spine', kind: 'fixed', par: 'torso', pos: [0, 0, 0], rest: [0, 0] },
    { id: 'kneebat_L', k: 'sec', kind: 'ball', par: 'knee0', pos: [0, 6.9, 13], rotx: -hp_, arc: [-100 * DEG, 100 * DEG], pit: [-0.6, 0.6], rest: [0, 0], slew: 4, range: 120, rate: 20, every: 2, d: { tank: 12, scout: 5 }, tr: [420, 10, 0.45, 1.3], mz: 0.9, imp: 0.7, knee: true },
    { id: 'kneebat_R', k: 'sec', kind: 'ball', par: 'knee1', pos: [0, 6.9, 13], rotx: -hp_, arc: [-100 * DEG, 100 * DEG], pit: [-0.6, 0.6], rest: [0, 0], slew: 4, range: 120, rate: 20, every: 2, d: { tank: 12, scout: 5 }, tr: [420, 10, 0.45, 1.3], mz: 0.9, imp: 0.7, knee: true }],
};
const _hd = new THREE.Vector3();
const PAL_T = [[2.1, 1.2, 0.32], [0.45, 2.0, 0.35]];
const _mp = new THREE.Vector3(), _tp = new THREE.Vector3(), _lv = new THREE.Vector3(), _inv = new THREE.Matrix4(), _d0 = new THREE.Vector3(0, 1, 0), _cm = new THREE.Color();
const mats = {};   // shared materials

// ---- geometry, per spec (one merged geometry per mesh, cached per class and side) ----
function palette(hcls, side) {
  if (hcls === 'colossus') { const C = PAL[side]; return { H: C.hull, H2: C.bone, D: C.dark, T: C.trim, S: 0x121212, hot: [2.2, 0.3, 0.1] }; }
  const Lv = LIVERY[side], col = k => { _cm.set(Lv[k]); return [_cm.r * 1.3, _cm.g * 1.3, _cm.b * 1.3]; };
  return { H: col('hull'), H2: col('hull2'), D: col('dark'), T: col('trim'), S: col('soot'), hot: [2.2, 0.3, 0.1] };
}
const geoCache = {};
function flakGeo(P, k, key) {
  if (geoCache[key]) return geoCache[key];
  const { H, H2, D, S } = P, fy = new Builder(), fp = new Builder();
  fy.cyl(2.4, 2.8, 1.1, 0, 0.55, 0, D, 0, 0, 0, 6).box(0.6, 2.6, 2.2, 1.7, 2.3, 0, H).box(0.6, 2.6, 2.2, -1.7, 2.3, 0, H);
  fp.box(2.6, 1.6, 2.2, 0, 0, 0.1, D).box(2.7, 2.8, 0.3, 0, 0.5, 1.5, H2, -0.2);
  for (const x of [-0.62, 0.62]) for (const y of [-0.45, 0.45]) fp.box(0.42, 0.42, 5.6, x, y, 4.0, S, 0, 0, q_);
  const a = fy.build(), b = fp.build(); a.scale(k, k, k); b.scale(k, k, k); return (geoCache[key] = { yaw: a, pitch: b });
}
function gunGeo(P, id, hcls) {
  const key = id + hcls + P.D; if (geoCache[key]) return geoCache[key];
  const { H, H2, D, T, S } = P, base = new Builder(), gun = new Builder(); let g;
  if (id === 'autogun') {
    base.box(3.6, 0.8, 3.6, 0, 0.4, 0, D).box(1.4, 1.4, 1.4, 0, 1.3, 0, T);
    gun.box(1.6, 1.6, 3.6, 0, 0, -0.2, H).box(1.0, 1.0, 2.0, 0, 0, 2.6, D).box(0.6, 0.6, 4.4, 0, 0, 3.6, S, 0, 0, q_).box(1.4, 1.6, 1.8, 1.4, -0.2, -0.4, T).box(3.6, 2.4, 0.3, 0, 0.2, 1.5, H2, -0.15);
    g = { gy: 2.2, mz: 6.0 };
  } else if (id.startsWith('bolter')) {
    const s = id.endsWith('L') ? 1 : -1;
    base.box(4.0, 1.0, 2.4, s * -1.8, -1.7, 0, D).box(0.6, 4.4, 3.0, s * -3.4, -0.6, 0, T);
    gun.box(2.6, 2.6, 2.6, 0, 0, 0, D).box(2.8, 0.5, 2.8, 0, 1.45, 0, T).box(0.7, 0.7, 2.2, 0.55, 0, 2.2, S, 0, 0, q_).box(0.7, 0.7, 2.2, -0.55, 0, 2.2, S, 0, 0, q_);
    g = { gy: 0, mz: 3.4 };
  } else if (id.startsWith('kneegun')) {
    base.box(3.0, 2.6, 1.0, 0, 0, 0.5, H); gun.box(2.0, 1.8, 2.0, 0, 0, 0, D).box(0.6, 0.6, 3.2, 0, 0, 2.4, S, 0, 0, q_); g = { gz: 1.9, mz: 4.1 };
  } else {   // kneebat
    base.box(3.6, 4, 1.6, 0, 0, 0.8, H); gun.box(3.2, 2.6, 3.2, 0, 0, 0, D).box(0.7, 0.7, 5, 0.8, 0, 3.6, S, 0, 0, q_).box(0.7, 0.7, 5, -0.8, 0, 3.6, S, 0, 0, q_); g = { gz: 3.0, mz: 6.3 };
  }
  return (geoCache[key] = { base: base.build(), gun: gun.build(), ...g });
}
function turretGeo(P, key) {   // the colossus shoulder turret
  if (geoCache[key]) return geoCache[key];
  const { H, D, T, S } = P, ty = new Builder(), tp = new Builder();
  ty.cyl(2.8, 3.2, 4, 0, 2, 0, D, 0, 0, 0, 8).box(5.6, 3.2, 6.4, 0, 5.6, -0.4, H).box(6.0, 0.5, 6.8, 0, 7.45, -0.4, T);
  tp.box(4.4, 2.4, 1.6, 0, 0, 0.6, D).box(0.9, 0.9, 5.5, 1.2, 0, 4.0, S, 0, 0, q_).box(0.9, 0.9, 5.5, -1.2, 0, 4.0, S, 0, 0, q_);
  return (geoCache[key] = { yaw: ty.build(), pitch: tp.build() });
}
function spineGeo(P, key) {
  if (geoCache[key]) return geoCache[key];
  const { D, T, hot } = P, sp = new Builder(), sg = new Builder();
  sp.box(6, 20, 3, 0, 29.6, -15.9, D).box(1.0, 19, 1.2, 0, 31, -19.3, T);
  for (const y of [23.5, 28, 32.5, 37]) { sp.box(10, 3.2, 5.5, 0, y, -16.5, D, 0.45); sg.box(7.6, 1.8, 0.4, 0, y + 1.24, -19.07, hot, 0.45); }
  return (geoCache[key] = { body: sp.build(), glow: sg.build() });
}
let tailGeo = {};
export function buildMounts(u, torso) {
  u.mounts = []; const side = u.side, P = palette(u.hcls, side), pkey = u.hcls + side;
  if (!mats[u.hcls]) mats[u.hcls] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: u.hcls === 'colossus' ? 0.75 : 0.66, metalness: u.hcls === 'colossus' ? 0.2 : 0.3 });
  if (!mats.glow) mats.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const M = mats[u.hcls], grp = (par, x, y, z) => { const n = new THREE.Group(); n.position.set(x, y, z); par.add(n); return n; };
  if (u.hcls === 'hierarch') {   // the tail platform and the shoulder shelves, static
    const kk = 'tail' + side; if (!tailGeo[kk]) { const tp = new Builder(); tp.box(6.4, 1.6, 5.6, 0, 14.3, -10.7, P.D); tailGeo[kk] = tp.build(); }
    torso.add(new THREE.Mesh(tailGeo[kk], M));
  }
  for (const def of MOUNTS[u.hcls]) {
    const par = def.par === 'torso' ? torso : u.legs.feet[def.par === 'knee0' ? 0 : 1].shin, g = grp(par, ...def.pos); if (def.rotx) g.rotation.x = def.rotx;
    const m = { def, node: g, cd: rr(0, 1), tgt: null, bc: 0, vis: 0, yaw: def.rest[0], pit: def.rest[1], wy: def.rest[0], wp: def.rest[1], ok: false };
    if (def.kind === 'turret') {
      const gg = def.k === 'flak' ? flakGeo(P, def.sc, 'flak' + pkey + def.sc) : turretGeo(P, 'tur' + pkey), py = def.k === 'flak' ? 2.6 * def.sc : 5.8, pz = def.k === 'flak' ? 0 : 2.4;
      m.yawN = grp(g, 0, 0, 0); m.yawN.add(new THREE.Mesh(gg.yaw, M)); m.pitchN = grp(m.yawN, 0, py, pz); m.pitchN.add(new THREE.Mesh(gg.pitch, M)); m.pivotY = py; m.mzz = def.k === 'flak' ? 7.0 * def.sc : 6.9; m.mzN = grp(m.pitchN, 0, 0, m.mzz);
      m.yawN.rotation.y = m.yaw; m.pitchN.rotation.x = -m.pit;
    } else if (def.kind === 'ball') {
      const gg = gunGeo(P, def.id, u.hcls); g.add(new THREE.Mesh(gg.base, M)); m.yawN = m.pitchN = grp(g, 0, gg.gy || 0, gg.gz || 0); m.yawN.rotation.order = 'YXZ'; m.yawN.add(new THREE.Mesh(gg.gun, M)); m.pivotY = gg.gy || 0; m.mzN = grp(m.yawN, 0, 0, gg.mz);
    } else if (def.kind === 'fixed') {
      const gg = spineGeo(P, 'spine' + pkey); torso.add(new THREE.Mesh(gg.body, M), new THREE.Mesh(gg.glow, mats.glow)); m.cells = [];
      for (let i = 0; i < 4; i++) for (const sx of [1, -1]) m.cells.push(grp(torso, sx * 2.6, [23.5, 28, 32.5, 37][i] + 1.25, -19.3));
      m.torso = torso; m.node = m.cells[0];
    }
    u.mounts.push(m);
  }
}
export function tpos(t, out) {
  const r = t.r;
  switch (t.k) { case 'scout': case 'air': return out.copy(r.pos); case 'tank': return out.set(r.x, 2.5, r.z); case 'squad': return out.set(r.lane, 1.5, r.z); default: return r.chest(out); }
}
export function tAlive(t) {
  const r = t.r; switch (t.k) { case 'scout': return r.state === 'alive'; case 'tank': return r.alive; case 'squad': return r.alive > 0; case 'air': return r.alive && !r.falling; default: return r.alive; }
}
// a crosshair hit (a G.shoot result) as a lockable enemy entity
export function entityAt(G, h) {
  if (!h) return null; const r = h.ref;
  if ((h.type === 'col' || h.type === 'hier' || h.type === 'harrow') && r.side === 1) return { k: 'eng', r };
  if (h.type === 'struct' && r.side === 1) return { k: 'struct', r };
  if (h.type === 'scout' && r.side === 1) return { k: 'scout', r };
  if (h.type === 'tank' && r.side === 1) return { k: 'tank', r };
  if (h.type === 'air' && r.side === 1) return { k: 'air', r };
  if (h.type === 'inf') { let best = null, bd = 25; for (const q of G.units.squads) { if (q.side !== 1 || q.alive <= 0) continue; const d = Math.hypot(q.lane - h.x, q.z - h.z); if (d < bd) { bd = d; best = q; } } if (best) return { k: 'squad', r: best }; }
  return null;
}
// the aim solve in the mount's own frame: yaw / pitch toward a world point, the yaw unwrapped into the arc. Returns the distance, or -1 if the
// point is out of range, outside the arc, or outside the pitch limits (so a mount only fires on what it can really bear on).
function solve(m, x, y, z, out) {
  const d = m.def; _lv.set(x, y, z).applyMatrix4(_inv);
  const lx = _lv.x, lz = _lv.z, dist = Math.hypot(_lv.x, _lv.y - m.pivotY, lz) * (m.node.getWorldScale ? 1 : 1);
  let a = Math.atan2(lx, lz); const lo = d.arc[0], hi = d.arc[1]; while (a < lo) a += 2 * PI; while (a >= lo + 2 * PI) a -= 2 * PI;
  const inArc = a <= hi, p = Math.atan2(_lv.y - m.pivotY, Math.hypot(lx, lz)), inP = p >= d.pit[0] - 0.02 && p <= d.pit[1] + 0.02;
  out.wy = inArc ? a : (Math.abs(angDiff(a, lo)) < Math.abs(angDiff(a, hi)) ? lo : hi); out.wp = clamp(p, d.pit[0], d.pit[1]);
  return inArc && inP ? dist : -1;
}
const _sv = { wy: 0, wp: 0 };
function pickMount(u, m) {
  const G = u.G, d = m.def; m.node.getWorldPosition(_mp); m.tgt = null; m.node.updateWorldMatrix(true, false); _inv.copy(m.node.matrixWorld).invert();
  if (d.knee && u.comp.legs.hp <= 0) return;
  const rng = (x, y, z) => { const wd = Math.hypot(x - _mp.x, y - _mp.y, z - _mp.z); if (wd > d.range) return -1; return solve(m, x, y, z, _sv) >= 0 ? wd : -1; };
  if (d.k === 'flak') { let bd = d.range; for (const a of G.air.list) { if (a.side === u.side || !a.alive || a.falling) continue; const dd = rng(a.pos.x, a.pos.y, a.pos.z); if (dd >= 0 && dd < bd) { bd = dd; m.tgt = { k: 'air', r: a }; } } return; }
  const zones = u.zones && u.zones.length ? u.zones : null; let best = null, bs = 1e9;
  const consider = (t, x, y, z, bias) => { const dd = rng(x, y, z); if (dd < 0) return; const s = dd + bias; if (s < bs) { bs = s; best = t; } };
  const enemyQ = q => q.side !== u.side && q.alive > 0;
  for (const q of G.units.squads) if (enemyQ(q) && q.melta && Math.hypot(q.lane - _mp.x, q.z - _mp.z) < 60) consider({ k: 'squad', r: q }, q.lane, 1.5, q.z, -1000);   // 1. fusion-lance teams within 60 m
  if (best) { m.tgt = best; return; }
  if (zones) {   // 2. enemies inside a painted zone, nearest first
    const inZ = (x, z) => { for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return true; return false; };
    for (const s of G.scouts.list) if (s.side !== u.side && s.state === 'alive' && inZ(s.pos.x, s.pos.z)) consider({ k: 'scout', r: s }, s.pos.x, 14, s.pos.z, 0);
    for (const t of G.units.tanks) if (t.side !== u.side && t.alive && inZ(t.x, t.z)) consider({ k: 'tank', r: t }, t.x, 2.5, t.z, 0);
    for (const q of G.units.squads) if (enemyQ(q) && inZ(q.lane, q.z)) consider({ k: 'squad', r: q }, q.lane, 1.5, q.z, 0);
    if (best) { m.tgt = best; return; }
  }
  for (const s of G.scouts.list) { if (s.side === u.side || s.state !== 'alive') continue; const rear = Math.abs(angDiff(Math.atan2(s.pos.x - u.pos.x, s.pos.z - u.pos.z), u.torsoYaw)) > 1.57; consider({ k: 'scout', r: s }, s.pos.x, 14, s.pos.z, rear ? -500 : 0); }   // 3. Kestrels in the rear arc
  for (const t of G.units.tanks) if (t.side !== u.side && t.alive) consider({ k: 'tank', r: t }, t.x, 2.5, t.z, 20);   // 4. the nearest small threat
  for (const q of G.units.squads) if (enemyQ(q)) consider({ k: 'squad', r: q }, q.lane, 1.5, q.z, 10);
  if (best) { m.tgt = best; return; }
  if (u.focus && u.focus.alive) { if (rng(u.focus.pos.x, 30, u.focus.pos.z) >= 0) { m.tgt = { k: u.focus.isStruct ? 'struct' : 'eng', r: u.focus }; return; } }   // never a heavy unless focused, or nothing else
  for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side !== u.side && e.alive) consider({ k: 'eng', r: e }, e.pos.x, 30, e.pos.z, 0);
  for (const st of G.structs) if (st.side !== u.side && st.alive && st.kind !== 'bastion' && st.kind !== 'site') consider({ k: 'struct', r: st }, st.pos.x, st.pos.y, st.pos.z, 30);
  m.tgt = best;
}
function muzzleWorld(m, out) { (m.mzN || m.node).getWorldPosition(out); return out; }
function fireMount(u, m, bp) {
  const G = u.G, fx = G.fx, d = m.def, t = m.tgt; muzzleWorld(m, _mp); tpos(t, _tp); const x = _tp.x, y = _tp.y, z = _tp.z, tr = PAL_T[u.side];
  if (d.k === 'flak') {   // 8 rounds a second drawn; every second one an airburst, about 60 dps a quad
    m.cd = 0.125; m.bc++; const k = d.sc >= 1.5 ? 1.4 : 1;
    fx.tracer(_mp.x, _mp.y, _mp.z, x, y, z, 520, d.sc >= 1.5 ? 20 : 14, d.sc >= 1.5 ? 0.65 : 0.45, tr[0] * 1.2, tr[1] * 1.2, tr[2] * 1.2);
    if (m.bc & 1) {
      G.air.damage(t.r, 15, bp); const bx = x + rr(-9, 9), by = Math.max(25, y + rr(-6, 6)), bz = z + rr(-9, 9);
      fx.fire(bx, by, bz, 0, 0, 0, 0.09, 3 * k, 7 * k, 3, 2.2, 1.0, 1); for (let i = 0; i < 3; i++) fx.smoke(bx + rr(-1.5, 1.5), by + rr(-1, 1), bz + rr(-1.5, 1.5), rr(-3, 3), rr(-1, 2), rr(-3, 3), rr(2.2, 3.0) * k, 3, 11, rr(0.04, 0.07), 0.8, 1.5);
      if (fx.camDist(bx, by, bz) < 400) fx.sparks(bx, by, bz, 3, 18);
    }
    return;
  }
  if (d.burst) { m.bc++; m.cd = m.bc >= d.burst ? (m.bc = 0, 1.5) : d.gap; } else m.cd = 1 / d.rate;
  const sd = bp ? -1 : u.side, dm = d.d;
  if (t.k === 'squad') G.units.blast(x + rr(-4, 4), 0.5, z + rr(-4, 4), d.splash || 2.5, 30, sd, bp);
  else if (t.k === 'tank') G.units.damageTank(t.r, dm.tank, bp);
  else if (t.k === 'scout') G.scouts.damage(t.r, dm.scout, bp, _mp.x, _mp.z);
  else if (t.k === 'air') G.air.damage(t.r, dm.air || 30, bp);
  else if (dm.S !== undefined) {   // an engine target: the point is where the line from the mount to the aim point first meets its hit volumes (random height only on a miss)
    let pt = null;
    if (t.k === 'eng') { _hd.set(x - _mp.x, y - _mp.y, z - _mp.z); const L = _hd.length() || 1; _hd.multiplyScalar(1 / L); const tt = t.r.rayHit(_mp, _hd, L + 80); pt = tt >= 0 ? { x: _mp.x + _hd.x * (tt + 1), y: _mp.y + _hd.y * (tt + 1), z: _mp.z + _hd.z * (tt + 1) } : { x, y: y + rr(-10, 10), z }; }
    t.r.damage(dm.S, bp, false, pt, dm.H);
  }
  m.vis++; if (!d.every || m.vis % d.every === 0) {
    const [sp, ln, w, mul] = d.tr, cd = fx.camDist(_mp.x, _mp.y, _mp.z); _d0.set(x - _mp.x, y - _mp.y, z - _mp.z).normalize();
    fx.tracer(_mp.x, _mp.y, _mp.z, x + rr(-2, 2), Math.max(y, 0.5), z + rr(-2, 2), sp, ln, w, tr[0] * mul, tr[1] * mul, tr[2] * mul, () => { if (d.imp) fx.impact(x, Math.max(0.3, y), z, d.imp); });
    if (cd < 700) fx.muzzle(_mp, _d0, d.mz, tr[0] * 1.3, tr[1] * 1.3, tr[2] * 1.3);
    if (d.burst && m.bc === 1) { const C = PAL[u.side].glow; fx.flash(_mp.x, _mp.y, _mp.z, C[0], C[1], C[2], 1800, 0.08, 160); G.sfx.boom(cd, 0.5); }
  }
}
function autoCluster(u, range) {
  const G = u.G; let best = null, bs = 0;
  const score = (x, z) => { let n = 0; for (const q of G.units.squads) if (q.side !== u.side && q.alive > 0 && Math.hypot(q.lane - x, q.z - z) < 28) n += q.alive; for (const t of G.units.tanks) if (t.side !== u.side && t.alive && Math.hypot(t.x - x, t.z - z) < 28) n += 8; return n; };
  for (const q of G.units.squads) if (q.side !== u.side && q.alive >= 3 && Math.hypot(q.lane - u.pos.x, q.z - u.pos.z) < range) { const s = score(q.lane, q.z); if (s > bs) { bs = s; best = { x: q.lane, z: q.z }; } }
  for (const t of G.units.tanks) if (t.side !== u.side && t.alive && Math.hypot(t.x - u.pos.x, t.z - u.pos.z) < range) { const s = score(t.x, t.z); if (s > bs) { bs = s; best = { x: t.x, z: t.z }; } }
  return best;
}
const _ap = new THREE.Vector3();
// the back missile spine (colossus): 8 anti-armour missiles every 14 s at its order: a locked target, the latest zone, else the densest enemy cluster.
// Each flies two tracer legs, up to an apex over the engine and then down onto the target, so it never crosses its own hull.
function spine(u, dt, m) {
  const G = u.G, fx = G.fx, bp = !!u.piloted; u.spineCd -= dt;
  if (u.spineCd <= 0 && !u.spineQ.length) {
    let o = null;
    if (bp) {
      for (const a of ['L', 'R']) { const l = u.lock[a]; if (l && tAlive(l)) { tpos(l, _tp); o = { x: _tp.x, z: _tp.z, eng: l.k === 'eng' || l.k === 'struct' ? l.r : null }; break; } }
      if (!o && u.zones.length) { const z = u.zones[u.zones.length - 1]; o = { x: z.x, z: z.z }; }
    }
    if (!o) { const c = autoCluster(u, 400); if (c) o = { x: c.x, z: c.z }; }
    if (o) { u.spineCd = 14; for (let i = 0; i < 8; i++) u.spineQ.push({ t: i * 0.12, i, x: o.x, z: o.z, eng: o.eng }); } else u.spineCd = 1.5;
  }
  for (let i = u.spineQ.length - 1; i >= 0; i--) {
    const s = u.spineQ[i]; s.t -= dt; if (s.t > 0) continue; u.spineQ.splice(i, 1);
    const cell = m.cells[s.i]; cell.getWorldPosition(_mp); const hx = s.x + rr(-8, 8), hz = s.z + rr(-8, 8), eng = s.eng, sgn = s.i % 2 ? -1 : 1;
    _ap.set(sgn * 6 + rr(-4, 4), 80 + rr(-4, 4), -38 + rr(-4, 4)); m.torso.localToWorld(_ap); const ax = _ap.x, ay = _ap.y, az = _ap.z, ox = _mp.x, oy = _mp.y, oz = _mp.z;
    fx.tracer(ox, oy, oz, ax, ay, az, 90, 9, 1.0, 3, 1.7, 0.6, () => {
      fx.tracer(ax, ay, az, hx, 0.5, hz, 170, 12, 1.0, 3, 1.7, 0.6, () => {
        fx.explosion(hx, 0.5, hz, 1.5, { silent: fx.camDist(hx, 0.5, hz) > 500 }); G.units.blast(hx, 0.5, hz, 6, 100, bp ? -1 : u.side, bp);
        for (const t of G.units.tanks) if (t.alive && t.side !== u.side && Math.hypot(t.x - hx, t.z - hz) < 8) G.units.damageTank(t, 999, bp);
        for (const sc of G.scouts.list) if (sc.state === 'alive' && sc.side !== u.side && Math.hypot(sc.pos.x - hx, sc.pos.z - hz) < 8) G.scouts.damage(sc, 80, bp, hx, hz);
        if (eng && eng.alive) { if (eng.isStruct) eng.damage(60, bp, false, { x: hx, y: 1, z: hz }, 60); else if (Math.hypot(eng.pos.x - hx, eng.pos.z - hz) < 36) eng.damage(30, bp, false, { x: hx, y: 30, z: hz }, 20); }
      });
    });
    fx.muzzle(_mp, _d0.set(0, 1, 0), 2.2, 3, 2, 1); for (let k = 0; k < 3; k++) fx.smoke(_mp.x, _mp.y, _mp.z, rr(-2, 2), rr(1, 4), rr(-6, -2), rr(1.2, 2.2), 2, 8, 0.4, 0.5, 0.5); G.sfx.missile();
  }
}
export function tickMounts(u, dt) {
  if (!u.mounts) return;
  u.mScan = (u.mScan || 0) - dt; const scan = u.mScan <= 0; if (scan) u.mScan = 0.2;   // 5 Hz target picks
  const bp = !!u.piloted, legsOut = u.comp.legs.hp <= 0;
  for (const m of u.mounts) {
    const d = m.def; if (d.k === 'spine') { spine(u, dt, m); continue; }
    m.cd -= dt;
    if (scan) { pickMount(u, m); if (m.tgt) { tpos(m.tgt, _tp); m.node.updateWorldMatrix(true, false); _inv.copy(m.node.matrixWorld).invert(); solve(m, _tp.x, _tp.y, _tp.z, _sv); m.wy = _sv.wy; m.wp = _sv.wp; } else { m.wy = d.rest[0]; m.wp = d.rest[1]; } }
    if (d.knee && legsOut) { m.wy = 0; m.wp = -0.6; m.tgt = null; }   // a wrecked leg lets its knee gun sag
    m.yaw += clamp(m.wy - m.yaw, -d.slew * dt * (m.tgt ? 1 : 0.5), d.slew * dt * (m.tgt ? 1 : 0.5)); m.pit += clamp(m.wp - m.pit, -d.slew * dt * (m.tgt ? 1 : 0.5), d.slew * dt * (m.tgt ? 1 : 0.5));
    if (m.pitchN === m.yawN) { m.yawN.rotation.y = m.yaw; m.yawN.rotation.x = -m.pit; } else { m.yawN.rotation.y = m.yaw; m.pitchN.rotation.x = -m.pit; }
    if (!m.tgt || m.cd > 0) continue;
    if (!tAlive(m.tgt)) { m.tgt = null; continue; }
    if (Math.abs(m.yaw - m.wy) > 0.15 || Math.abs(m.pit - m.wp) > 0.15) continue;   // only fire once the barrels are on
    fireMount(u, m, bp);
  }
}

// ---- arm target-locks (the player's heavy): a locked arm tracks and auto-fires while the crosshair stays free for the other arm ----
const armSpec = u => u.hcls === 'harrow'
  ? { L: { range: 24, cost: COST.fist, ready: u => u.mp === 'none' && u.meleeCd <= 0 && u.charge <= 0 }, R: { range: 260, cost: COST.lascannon, ready: u => u.charge <= 0 && u.lasCd <= 0 && u.mp === 'none' } }
  : u.hcls === 'hierarch' ? { L: { range: 260, cost: 0, ready: u => !u.overheat }, R: { range: 360, cost: COST.blaster, ready: u => u.charge <= 0 && u.bCd <= 0 } }
  : { L: { range: 700, cost: 0, ready: u => !u.rakeDead && u.gLock <= 0 }, R: { range: 900, cost: COST.lance, ready: u => !u.mode && u.lanceT <= 0 } };
export function updateLocks(u, dt, inp) {
  const G = u.G, spec = armSpec(u); u.auto.L = u.auto.R = false; u.lockLosT = (u.lockLosT || 0) - dt;
  for (const a of ['L', 'R']) {
    const s = u.lock[a]; if (!s) continue;
    if (!tAlive(s)) { u.lock[a] = null; continue; }
    tpos(s, _tp); const dx = _tp.x - u.pos.x, dz = _tp.z - u.pos.z, dist = Math.hypot(dx, dz), sp = spec[a];
    s.out = dist > sp.range ? (s.out || 0) + dt : 0; if (s.out > 3) { u.lock[a] = null; continue; }
    const arc = Math.abs(angDiff(Math.atan2(dx, dz), u.torsoYaw)) > 1.2; s.arcOut = arc ? (s.arcOut || 0) + dt : 0; if (s.arcOut > 2) { u.lock[a] = null; continue; }
    u.lockPt[a].copy(_tp);
    if (a === 'L' ? inp.fire1 : inp.fire2) { s.ovr = true; continue; }   // holding the button overrides the lock back to the crosshair while held
    s.ovr = false;
    const charging = a === 'R' && (u.charge > 0 || u.mode === 'pilot');
    if (u.lockLosT <= 0) s.los = G.city.los(u.pos.x, 40, u.pos.z, _tp.x, Math.max(_tp.y, 3), _tp.z);
    if ((dist > sp.range || arc || s.los === false) && !charging) continue;
    if (!charging && (!sp.ready(u) || u.cap.arms < (u.hcls === 'colossus' && a === 'R' ? 99.5 : sp.cost))) continue;   // energy weapons only auto-fire when ARMS covers the full cost
    u.auto[a] = true;
  }
  if (u.lockLosT <= 0) u.lockLosT = 0.3;
}
