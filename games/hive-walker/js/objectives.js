import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, PAL, rr, clamp } from './util.js?v=32';
import { SITE_XZ, LANES } from './city.js?v=32';
import { splashEngines } from './heavy.js?v=32';

// Map objectives (model/objectives-facings-spec.md section 2, visuals model/objectives-visual.md): five capturable sites down the midfield, A (Synod gate) to E (Vigil gate).
// Each has a 60 m capture ring; progress runs -100 (Synod) .. 0 .. +100 (Vigil). Owned sites pay out: ward anchors B and D (ward regen and reboot near them), the artillery
// manufactorum C (a 6-shell barrage every 45 s), the reinforcement gates A and E (an extra tank and squad every 60 s, Kestrels respawn there). Holding 3 of 5 opens the enemy
// ward generator (bastion.js). Capture checks run at 4 Hz, the AI director every 10 s; visuals update every frame. The sites are indestructible and block like hero spires.
const R = 60, hp_ = Math.PI / 2, q = Math.PI / 4;
const WT = { colossus: 4, hierarch: 3, harrow: 2 };     // presence weights; Kestrel / tank 1, infantry squad 0.5
const TYPES = ['gate', 'anchor', 'arty', 'anchor', 'gate'], START = [1, null, null, null, 0], IDS = 'ABCDE', ROT = [0, 0, hp_, Math.PI, Math.PI];   // site roots: front faces the map centre, C's door along x
const HALF = { gate: [23, 15], anchor: [20, 20], arty: [23, 23] };   // ground footprint (site-local half x, half z): movers are pushed out of it
const SIDE = ['VIGIL', 'SYNOD'], TYPENAME = { gate: 'REINFORCEMENT GATE', anchor: 'WARD ANCHOR', arty: 'ARTILLERY MANUFACTORUM' };
const BENEFIT = { gate: 'TANK + SQUAD EVERY 60 S, KESTRELS RESPAWN HERE', anchor: 'WARD REGEN x1.5 AND REBOOT -40% WITHIN 300 M', arty: '6-SHELL BARRAGE EVERY 45 S' };
const MAST = { gate: [0, 58.5, 0], anchor: [0, 66, 0], arty: [-18, 33, 14] };   // standard (capture progress) mast foot per type
export const GLYPH = { gate: 'M3 14 V3 H13 V14 M6 14 V7 H10 V14', anchor: 'M8 1 L11 12 H5 Z M3 6 H13 M4 14 H12', arty: 'M3 13 L8 3 M6.5 13 L11.5 3 M10 13 L15 3 M1 14.5 H15' };
export const CSS = ['#ffb23c', '#5cff6a'], CSSN = '#b8b0a0';   // objective colours are the faction colours, not ally / foe: Vigil amber, Synod green
const _k = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const K = (hex, k) => { _k.set(hex); return [_k.r * k, _k.g * k, _k.b * k]; };
const N = K(0x5c5852, 1.2), ND = 0x1b1a1c, NT = K(0x8c8a80, 1.2), S = 0x0b0a09, S2 = 0x121212, hot = [2.2, 0.3, 0.1], W = 0xffffff;
// owner colour tables, index = owner + 1 (0 neutral, 1 Vigil, 2 Synod): livery paint, owner glow, ground ring
const LIV = [K(0x2e2c2a, 1), K(PAL[0].trim, 1.5), K(PAL[1].hull, 1.6)], OG = [[0.5, 0.48, 0.42], PAL[0].glow, PAL[1].glow], RC = [[0.75, 0.72, 0.62], [2.0, 1.2, 0.35], [0.45, 2.0, 0.4]];
const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
const glowMat = () => new THREE.MeshBasicMaterial({ toneMapped: false }), paintMat = () => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.15 });
const col = (m, c, k = 1) => m.color.setRGB(c[0] * k, c[1] * k, c[2] * k);
const mix = (a, b, t) => { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * t; };
const flat = g => { g.rotateX(-Math.PI / 2); return g; };

// ---- the geometry kit, built once (faction-neutral: owner colour comes from the per-site materials) ----
function buildParts() {
  const B = () => new Builder(), P = {}, gate = B(), gL = B(), gLamp = B(), gBars = B(), gFlood = B(), anc = B(), aL = B(), aG = B(), h1 = B(), h2 = B(), hall = B(), hL = B(), hG = B(), hHot = B(), bY = B(), bP = B(), bG = B();
  // reinforcement gate
  for (const s of [-1, 1]) gate.box(13, 46, 26, s * 15.5, 23, 0, N).box(15, 8, 28, s * 15.5, 4, 0, ND).box(13.6, 1.4, 26.6, s * 15.5, 30, 0, NT).box(4, 30, 5, s * 19.5, 15, 15.5, ND, -0.3).box(4, 30, 5, s * 19.5, 15, -15.5, ND, 0.3)
    .box(6, 4, 3, s * 19, 60.5, 12.5, N).box(6, 4, 3, s * 19, 60.5, -12.5, N).cyl(4, 4, 12, s * 12, 62.5, 0, ND, 0, 0, hp_, 8);
  gate.box(44, 10, 26, 0, 51, 0, N).box(46, 2.5, 28, 0, 57.25, 0, ND).box(18, 6, 26, 0, 43, 0, N).box(18, 40, 20, 0, 20, -2, S).box(18, 0.8, 12, 0, 0.4, 19, ND).box(1.8, 26, 1.8, 0, 71.5, 0, ND);
  for (const z of [13.3, -13.3]) gL.box(9, 16, 0.8, 15.5, 36, z, W).box(9, 16, 0.8, -15.5, 36, z, W).box(30, 5, 0.8, 0, 51, z, W);
  for (const s of [-1, 1]) for (const z of [13.4, -13.4]) gLamp.box(3.2, 3.2, 0.8, s * 15.5, 22, z, W, 0, 0, q);
  for (const x of [-6, -3, 0, 3, 6]) gBars.box(1.2, 36, 0.5, x, 19, 8.4, W); gBars.box(17, 1, 0.5, 0, 12, 8.4, W).box(17, 1, 0.5, 0, 26, 8.4, W); gFlood.box(17, 38, 0.3, 0, 19.5, 8.2, W);
  // ward anchor
  anc.box(40, 5, 40, 0, 2.5, 0, ND).box(30, 7, 30, 0, 8.5, 0, N).box(31.2, 1.4, 31.2, 0, 12.7, 0, NT).cyl(3.2, 7.5, 50, 0, 37, 0, N, 0, q, 0, 4).box(9.4, 1.2, 9.4, 0, 28, 0, NT).box(7.5, 1.2, 7.5, 0, 44, 0, NT).box(5, 4, 5, 0, 64, 0, ND).box(1.8, 26, 1.8, 0, 79, 0, ND);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) anc.pyr(6, 16, sx * 16, 5, sz * 16, N);
  for (const s of [-1, 1]) aL.box(14, 5, 0.6, 0, 8.5, s * 15.2, W).box(0.6, 5, 14, s * 15.2, 8.5, 0, W); aL.box(8.6, 8, 8.6, 0, 36, 0, W);
  for (const s of [-1, 1]) aG.box(2.4, 8, 0.5, 0, 18, s * 5.2, W).box(0.5, 8, 2.4, s * 5.2, 18, 0, W); aG.box(5.6, 1.6, 5.6, 0, 64, 0, W);
  for (let k = 0; k < 8; k++) { const a = k * q; h1.box(11.6, 1.6, 1.6, Math.sin(a) * 14, 0, Math.cos(a) * 14, W, 0, a, 0); h2.box(7.5, 1.3, 1.3, Math.sin(a) * 9, 0, Math.cos(a) * 9, W, 0, a, 0); }
  // artillery manufactorum
  hall.box(44, 30, 36, 0, 15, 0, N).box(46, 3, 38, 0, 31.5, 0, ND).box(44.8, 1.4, 36.8, 0, 18, 0, NT).box(14, 18, 1, 0, 9, 18.2, S).box(17, 2.5, 1.6, 0, 19.2, 18.5, NT).cyl(13, 14, 5, 0, 35.5, 2, ND, 0, 0, 0, 10).box(1.8, 26, 1.8, -18, 46, 14, ND);
  for (const x of [-21, -9.5, 9.5, 21]) hall.box(4, 26, 4, x, 14, 19.5, ND, -0.25); for (const x of [-12, 12]) hall.box(4, 26, 4, x, 14, -19.5, ND, 0.25);
  for (const s of [-1, 1]) hall.cyl(3, 4.5, 42, s * 17, 54, -13, S, 0, 0, 0, 8).cyl(3.9, 3.9, 1.5, s * 17, 62, -13, NT, 0, 0, 0, 8);
  for (const s of [-1, 1]) hL.box(7, 14, 0.8, s * 15.5, 10, 18.3, W).box(0.8, 12, 12, s * 22.3, 11, 6, W); hL.box(14, 12, 0.8, 0, 10, -18.3, W);
  for (const x of [-4, 0, 4]) hG.box(1.2, 14, 0.5, x, 8, 18.9, W);
  for (const s of [-1, 1]) hG.box(0.5, 8, 2, s * 22.3, 24, 8, W).box(0.5, 8, 2, s * 22.3, 24, -8, W).box(2, 8, 0.5, s * 4, 24, -18.3, W);
  for (const s of [-1, 1]) hHot.box(0.6, 6, 8, s * 22.3, 8, -12, hot);
  bY.box(20, 8, 14, 0, 4, 0, N).box(3, 12, 10, 11, 8, 0, ND).box(3, 12, 10, -11, 8, 0, ND);
  bP.box(18, 8, 8, 0, 0, -2, ND); for (const x of [-6, 0, 6]) bP.cyl(2.4, 3, 26, x, 0, 14, S2, hp_, 0, 0, 8).cyl(3.4, 3.4, 2.5, x, 0, 26, NT, hp_, 0, 0, 8);
  for (const x of [-6, 0, 6]) bG.box(6.6, 6.6, 1, x, 0, 9, W);
  for (const [n, b] of Object.entries({ gate, gL, gLamp, gBars, gFlood, anc, aL, aG, h1, h2, hall, hL, hG, hHot, bY, bP, bG })) P[n] = b.build();
  // shared kit: the standard (a lantern block that climbs a mast), the beacon, the ground rings, the shell markers
  P.stdBlock = B().box(7, 11, 7, 0, 0, 0, W).build();
  const sg = B(); for (const z of [3.6, -3.6]) sg.box(4, 4, 0.5, 0, 0, z, W, 0, 0, q); for (const x of [3.6, -3.6]) sg.box(0.5, 4, 4, x, 0, 0, W, q, 0, 0); P.stdGlow = sg.build();
  P.beacon = B().box(3.5, 3.5, 3.5, 0, 0, 0, W, q, 0, q).build();
  const dash = par => mergeGeometries([...Array(12)].map((_, i) => flat(new THREE.RingGeometry(0.977, 1, 4, 1, (i * 2 + par) * Math.PI / 12, Math.PI / 18))));
  P.ringEven = dash(0); P.ringOdd = dash(1); P.ringProg = flat(new THREE.RingGeometry(0.90, 0.94, 96, 1)); P.pulse = flat(new THREE.RingGeometry(0.985, 1, 96)); P.mark = flat(new THREE.RingGeometry(0.88, 1, 32));
  P.cross = B().box(16, 0.1, 0.8, 0, 0, 0, W).box(0.8, 0.1, 16, 0, 0, 0, W).build(); P.drop = new THREE.CylinderGeometry(0.4, 0.4, 120, 5, 1, true);
  return P;
}

export class Objectives {
  constructor(G) {
    this.G = G; this.paused = false; this.acc = 0; this.dirT = 1; this.n = [0, 0]; this.bar = null;
    this.sites = SITE_XZ.map(([x, z], k) => { const o = START[k] === null ? 0 : START[k] + 1; return { k, id: IDS[k], type: TYPES[k], x, z, rot: ROT[k], owner: START[k], p: START[k] === 1 ? -100 : START[k] === 0 ? 100 : 0, contested: false, w: [0, 0], spT: 30 + k * 3, artT: 25, f: START[k] === null ? 0 : 1, spawnT: -1, pT: 0, pop: -1,
      liv: [...LIV[o]], og: [...OG[o]], rc: [...RC[o]], isStruct: true, side: 2, kind: 'site', alive: true, radius: 22, name: TYPENAME[TYPES[k]] + ' ' + IDS[k], hp: 1, pos: new THREE.Vector3(x, 0, z) }; });
    for (const s of this.sites) { s.chest = out => out.set(s.x, 20, s.z); s.damage = (amt, bp, by, pt) => this.spark(pt); s.rayHit = (o, d, m) => this.rayHit(s, o, d, m); }
    this.recount(); this.build(); this.hudBuild(); G.structs.push(...this.sites);
    for (const s of this.sites) G.city.crush(s.x, s.z, 34);
  }
  // ---- visuals: one root per site (geometry shared, materials per site), the standard, beacon and rings, plus each type's moving parts ----
  build() {
    const G = this.G, scene = G.scene, P = this.P = buildParts(), body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }), fixedGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.tethers = []; this.markers = []; const M = (par, geo, mat) => { const m = new THREE.Mesh(geo, mat); par.add(m); return m; }, grp = (par, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); par.add(g); return g; };
    for (const s of this.sites) {
      const root = s.root = new THREE.Group(); root.position.set(s.x, 0, s.z); root.rotation.y = s.rot; scene.add(root);
      s.mLiv = paintMat(); s.mGlow = glowMat(); s.mStd = paintMat(); s.mStdGlow = glowMat(); s.mBeacon = glowMat(); s.mEven = ringMat(); s.mOdd = ringMat(); s.mProg = ringMat(); s.dyn = {};
      if (s.type === 'gate') {
        M(root, P.gate, body); M(root, P.gL, s.mLiv); s.dyn.lamps = M(root, P.gLamp, s.mGlow); s.dyn.bars = M(root, P.gBars, s.mGlow);
        s.mFlood = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }); M(root, P.gFlood, s.mFlood); s.spawnPt = grp(root, 0, 0, 26); s.mouth = grp(root, 0, 12, 9);
      } else if (s.type === 'anchor') {
        M(root, P.anc, body); M(root, P.aL, s.mLiv); M(root, P.aG, s.mGlow); s.mHalo = new THREE.MeshBasicMaterial({ toneMapped: false });
        s.h1 = grp(root, 0, 50, 0); M(s.h1, P.h1, s.mHalo); s.h2 = grp(root, 0, 58, 0); M(s.h2, P.h2, s.mHalo);
        s.mPulse = ringMat(); s.pulseMesh = M(root, P.pulse, s.mPulse); s.pulseMesh.position.y = 0.5; s.pulseMesh.visible = false;
        for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 5, 1, true); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.5); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); m.frustumCulled = false; m.visible = false; scene.add(m); this.tethers.push({ s, m }); }
      } else {
        M(root, P.hall, body); M(root, P.hL, s.mLiv); M(root, P.hG, s.mGlow); M(root, P.hHot, fixedGlow);
        s.bY = grp(root, 0, 38, 2); M(s.bY, P.bY, body); s.bP = grp(s.bY, 0, 10, 0); s.bP.rotation.x = -1.05; M(s.bP, P.bP, body); s.mCharge = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }); M(s.bP, P.bG, s.mCharge);
        s.mz = [-6, 0, 6].map(x => grp(s.bP, x, 0, 27.5)); s.yaw = 0; s.recoil = 0; s.chFlash = 0; root.updateMatrixWorld(true); s.smoke = [];
        for (const sx of [-17, 17]) { root.localToWorld(_v.set(sx, 77, -13)); s.smoke.push(G.fx.addEmitter(_v.x, 77, _v.z, 2.6, Infinity, true)); }
      }
      const mp = MAST[s.type]; s.mastFoot = mp; s.std = grp(root, mp[0], mp[1] + 6.5, mp[2]); M(s.std, P.stdBlock, s.mStd); M(s.std, P.stdGlow, s.mStdGlow); s.beacon = M(grp(root, mp[0], mp[1] + 27.5, mp[2]), P.beacon, s.mBeacon);
      s.rE = M(root, P.ringEven, s.mEven); s.rO = M(root, P.ringOdd, s.mOdd); s.rE.scale.setScalar(R); s.rO.scale.setScalar(R); s.rE.position.y = s.rO.position.y = 0.45;
      s.gProg = P.ringProg.clone(); s.rP = M(root, s.gProg, s.mProg); s.rP.scale.setScalar(R); s.rP.position.y = 0.4; root.updateMatrixWorld(true);
    }
    // target markers (pool of 6, one per shell): kill ring, closing ring, cross, drop line
    const mm = () => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) { const g = new THREE.Group(), kr = new THREE.Mesh(P.mark, mm()), cr = new THREE.Mesh(P.mark, mm()), xs = new THREE.Mesh(P.cross, mm()), dl = new THREE.Mesh(P.drop, mm()); kr.position.y = cr.position.y = xs.position.y = 0.6; dl.position.y = 60; g.add(kr, cr, xs, dl); g.visible = false; scene.add(g); this.markers.push({ g, kr, cr, xs, dl }); }
  }
  paintSite(s, dt, time) {   // the one place colours are chosen: lerp toward the owner / capturing-side colours, drive the standard, beacon and rings
    const o = s.owner === null ? 0 : s.owner + 1, cs = s.p > 0 ? 1 : 2, fT = Math.abs(s.p) / 100, k = 1 - Math.exp(-dt * 6), changing = Math.abs(fT - s.f) > 0.004;
    mix(s.liv, LIV[o], k); mix(s.og, OG[o], k); mix(s.rc, RC[o], k); s.f += (fT - s.f) * Math.min(1, dt * 6);
    col(s.mLiv, s.liv); col(s.mGlow, s.og); const f = s.f, sc = o && f > 0.995 ? o : f > 0.003 ? cs : 0;
    col(s.mStd, LIV[sc]); col(s.mStdGlow, OG[sc], f > 0.003 && f < 0.995 ? 0.7 + 0.3 * Math.sin(time * 6) : 1);
    s.std.position.set(s.mastFoot[0] + (changing ? 0.15 * Math.sin(time * 40) : 0), s.mastFoot[1] + 6.5 + 14 * f, s.mastFoot[2]);
    if (s.contested) { const on = Math.sin(time * 18.85) > 0 ? 3 : 0; s.mBeacon.color.setRGB(on, on, on); } else if (o) col(s.mBeacon, OG[o], 1.6 + 0.3 * Math.sin(time * 2)); else col(s.mBeacon, OG[0], 0.6);
    // rings: dashed boundary (contested: amber and green turning together, hard blink), progress ring, a pop when a site is taken
    if (s.contested) { col(s.mEven, RC[1]); col(s.mOdd, RC[2]); s.rE.rotation.y = s.rO.rotation.y = time * 0.6; const b = Math.sin(time * 19) > 0; s.mEven.opacity = s.mOdd.opacity = b ? 1 : 0.6; s.mProg.opacity = f < 0.003 ? 0 : b ? 0.2 : 0.9; }
    else { col(s.mEven, s.rc); col(s.mOdd, s.rc); s.rE.rotation.y = s.rO.rotation.y = 0; s.mEven.opacity = s.mOdd.opacity = 0.75 + 0.15 * Math.sin(time * 1.5); s.mProg.opacity = f < 0.003 ? 0 : f < 0.995 ? 0.9 : 0.45; }
    col(s.mProg, RC[cs]); s.gProg.setDrawRange(0, Math.round(96 * f) * 6); s.rP.visible = f > 0.003;
    if (s.pop >= 0) { s.pop += dt; const u = s.pop / 0.4; if (u >= 1) { s.pop = -1; s.rE.scale.setScalar(R); s.rO.scale.setScalar(R); } else { s.rE.scale.setScalar(R + 5 * Math.sin(u * Math.PI)); s.rO.scale.setScalar(R + 5 * Math.sin(u * Math.PI)); s.mEven.opacity = s.mOdd.opacity = 1; } }
  }

  // ---- movers: the structures block as site-local rectangles, like hero spires; shots hit their solid volumes ----
  collide(p, r) {
    for (const s of this.sites) {
      const dx = p.x - s.x, dz = p.z - s.z; if (dx * dx + dz * dz > 4900) continue;
      const c = Math.cos(s.rot), sn = Math.sin(s.rot), lx = dx * c - dz * sn, lz = dx * sn + dz * c, [hx, hz] = HALF[s.type], cx = clamp(lx, -hx, hx), cz = clamp(lz, -hz, hz), ex = lx - cx, ez = lz - cz, d2 = ex * ex + ez * ez; if (d2 >= r * r) continue;
      let nx, nz; if (d2 < 1e-6) { if (hx - Math.abs(lx) < hz - Math.abs(lz)) { nx = Math.sign(lx || 1) * (hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (hz + r); } } else { const d = Math.sqrt(d2); nx = cx + ex / d * r; nz = cz + ez / d * r; }
      p.x = s.x + nx * c + nz * sn; p.z = s.z - nx * sn + nz * c;
    }
  }
  rayHit(s, o, d, maxT) {   // a ray in site space against the type's solid boxes / cylinders (masts, halos, barrels and stacks do not block)
    const c = Math.cos(s.rot), sn = Math.sin(s.rot), ox = o.x - s.x, oz = o.z - s.z, ax = ox * c - oz * sn, az = ox * sn + oz * c, bx = d.x * c - d.z * sn, bz = d.x * sn + d.z * c; let best = -1;
    const hit = t => { if (t >= 0 && t <= maxT && (best < 0 || t < best)) best = t; };
    const box = (x0, x1, y0, y1, z0, z1) => { let t0 = 0, t1 = maxT; for (const [oo, dd, a, b] of [[ax, bx, x0, x1], [o.y, d.y, y0, y1], [az, bz, z0, z1]]) { if (Math.abs(dd) < 1e-9) { if (oo < a || oo > b) return; } else { let ta = (a - oo) / dd, tb = (b - oo) / dd; if (ta > tb) { const w = ta; ta = tb; tb = w; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return; } } hit(t0); };
    const cyl = (cx, cz, r, y0, y1) => { const px = ax - cx, pz = az - cz, a = bx * bx + bz * bz; if (a < 1e-9) return; const b = px * bx + pz * bz, cc = px * px + pz * pz - r * r, disc = b * b - a * cc; if (disc < 0) return; const t = (-b - Math.sqrt(disc)) / a, y = o.y + d.y * t; if (t >= 0 && y >= y0 && y <= y1) hit(t); };
    if (s.type === 'gate') box(-22, 22, 0, 58, -13, 13); else if (s.type === 'anchor') { box(-15, 15, 0, 12, -15, 15); cyl(0, 0, 5, 12, 66); } else { box(-23, 23, 0, 33, -19, 19); cyl(0, 2, 14, 33, 52); }
    return best;
  }
  spark(pt) { if (pt && this.G.fx.camDist(pt.x, pt.y, pt.z) < 700) this.G.fx.sparks(pt.x, pt.y, pt.z, 5, 16); }   // indestructible: sparks only

  // ---- queries used by the rest of the game ----
  pause() {   // test shots: capture and the director off, no goals left behind (the old presets stage their own positions), the generator gate open
    const G = this.G; this.paused = true;
    for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) e.goal = null;
    for (const q2 of G.units.squads) q2.goalZ = null; for (const t of G.units.tanks) t.goalZ = null;
  }
  recount() { this.n[0] = this.n[1] = 0; for (const s of this.sites) if (s.owner !== null) this.n[s.owner]++; }
  holds(side) { return this.paused ? 5 : this.n[side]; }   // sites held (the win gate needs 3); paused (test shots) leaves the gate open
  gateFor(side) { let best = null; for (const s of this.sites) if (s.type === 'gate' && s.owner === side && (!best || (s.z - best.z) * (side === 0 ? -1 : 1) > 0)) best = s; return best; }   // the owned gate furthest forward
  near(u, type) { for (const s of this.sites) if (s.type === type && s.owner === u.side && Math.hypot(u.pos.x - s.x, u.pos.z - s.z) < 300) return s; return null; }
  wardMul(u) { return this.near(u, 'anchor') ? 1.5 : 1; }          // ward regen near a held anchor (stacks with planted)
  rebootRate(u) { return this.near(u, 'anchor') ? 1 / 0.6 : 1; }   // facing reboot 40% shorter
  tip(s) { return `${TYPENAME[s.type]} ${s.id}  -  ${s.contested ? 'CONTESTED' : s.owner === null ? 'NEUTRAL' : SIDE[s.owner]}  -  ${BENEFIT[s.type]}`; }
  gateFx(s) {   // units appear at the gate's mouth (a spawn, or an allied Kestrel coming back)
    const fx = this.G.fx, C = OG[s.owner === null ? 0 : s.owner + 1]; s.spawnT = 0; s.mouth.getWorldPosition(_v); s.spawnPt.getWorldPosition(_w);
    fx.flash(_v.x, _v.y, _v.z, C[0], C[1], C[2], 3000, 0.3, 250); fx.dust(_w.x, 1, _w.z, 5, 8); fx.sparks(_v.x, _v.y, _v.z, 6, 18, C[0], C[1], C[2], 0.6);
  }

  // ---- per frame ----
  update(dt) {
    const G = this.G; if (!this.paused) {
      this.acc += dt; this.dirT -= dt;
      if (this.acc >= 0.25) { const d = this.acc; this.acc = 0; this.capture(d); this.timers(d); }
      if (this.dirT <= 0) { this.dirT = 10; this.direct(); }
      this.huntT = (this.huntT || 0) - dt;
      if (this.huntT <= 0) { this.huntT = 1; const h = this.hunter(), pl = G.player; if (h && h.goal && this.playerHeavy()) { h.goal.x = pl.pos.x; h.goal.z = pl.pos.z; } }   // the hunter follows the player's engine
    }
    if (this.bar) this.barrage(dt);
    for (const s of this.sites) { this.paintSite(s, dt, G.time); this.typeFx(s, dt); }
    this.tetherFx();
  }
  typeFx(s, dt) {
    const G = this.G, time = G.time, o = s.owner === null ? 0 : s.owner + 1, own = s.owner !== null;
    if (s.type === 'gate') {   // pier lamps blink 5 s before a spawn; the portcullis rises and the mouth floods with light around it
      const tt = s.spawnT >= 0 ? s.spawnT : own && !this.paused ? -s.spT : -99; if (s.spawnT >= 0) { s.spawnT += dt; if (s.spawnT > 3.3) s.spawnT = -1; }
      s.dyn.lamps.visible = own && tt > -5 && tt < 0 ? Math.sin(time * 25) > 0 : true;
      let bar = 0, fl = 0; if (tt > -1.2 && tt < 0) { const u = (tt + 1.2) / 1.2; bar = 20 * (1 - (1 - u) * (1 - u)); fl = 0.8 * u; } else if (tt >= 0 && tt < 2.5) { bar = 20; fl = 0.8 * (0.85 + 0.15 * Math.sin(time * 30)); } else if (tt >= 2.5 && tt < 3.3) { const u = (tt - 2.5) / 0.8; bar = 20 * (1 - u * u); fl = 0.8 * (1 - u); }
      s.dyn.bars.position.y = bar; s.mFlood.opacity = fl; col(s.mFlood, OG[o]);
    } else if (s.type === 'anchor') {
      const cont = s.contested;
      if (own && !cont) { s.h1.rotation.y += dt * 0.3; s.h2.rotation.y -= dt * 0.5; s.h1.position.y = 50 + 0.8 * Math.sin(time * 1.1); s.h2.position.y = 58 + 0.6 * Math.sin(time * 1.1 + 1.6); }
      s.kick = Math.max(0, (s.kick || 0) - dt * 4 * (s.kick || 0));
      if (!own) col(s.mHalo, OG[0], 0.5); else if (cont) col(s.mHalo, OG[o], Math.sin(time * 37) > 0 ? 1 : 0.4); else col(s.mHalo, OG[o], (1.2 + 0.2 * Math.sin(time * 3)) * (1 + s.kick));
      if (own && !this.paused) {   // ward-boost pulse every 5 s: a ring runs out to the 300 m boost radius
        s.pT += dt; if (s.pT >= 5) { s.pT = 0; s.kick = 1.2; s.root.localToWorld(_v.set(0, 54, 0)); const C = OG[o]; G.fx.flash(_v.x, _v.y, _v.z, C[0], C[1], C[2], 2500, 0.25, 300); }
        const k = s.pT / 2.5; s.pulseMesh.visible = k < 1; if (k < 1) { s.pulseMesh.scale.setScalar(Math.max(1, 300 * k)); col(s.mPulse, RC[o]); s.mPulse.opacity = 0.55 * (1 - k); }
      } else s.pulseMesh.visible = false;
    } else this.batteryFx(s, dt);
  }
  batteryFx(s, dt) {   // the battery: neutral rests at yaw 0, owned idles pointing at the enemy bastion; a barrage turns it onto the target and charges the collars
    const G = this.G, o = s.owner === null ? 0 : s.owner + 1, b = this.bar && this.bar.site === s ? this.bar : null; let want = 0, ch = 0;
    if (s.owner !== null) { const eb = G.bastions[1 - s.owner]; want = Math.atan2(eb.pos.x - s.x, eb.pos.z - s.z) - s.rot; }
    if (b) { want = Math.atan2(b.aim.x - s.x, b.aim.z - s.z) - s.rot; if (b.t < 0) ch = (1 + b.t / 4) ** 2; }
    s.yaw += clamp(((want - s.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI, -0.4 * dt, 0.4 * dt); s.bY.rotation.y = s.yaw;
    s.recoil = Math.max(0, s.recoil - dt * 5 * s.recoil); s.bP.position.set(0, 10 - 0.867 * s.recoil, -0.498 * s.recoil);   // pushed back along its own (tilted) z, damped home
    s.chFlash = Math.max(0, s.chFlash - dt / 0.4); col(s.mCharge, OG[o], ch * 1.4 + 4 * s.chFlash);
    for (const m of s.smoke) m.size = s.owner !== null ? 3.4 : 2.6;
  }
  tetherFx() {   // an owned anchor tethers its three nearest owner heavies within 300 m (brighter while one of their facings is rebooting)
    const G = this.G, time = G.time;
    for (const s of this.sites) {
      if (s.type !== 'anchor') continue; const ts = this.tethers.filter(t => t.s === s);
      if (s.owner === null) { for (const t of ts) t.m.visible = false; continue; }
      s.root.localToWorld(_v.set(0, 54, 0)); const near = [];
      for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side === s.owner && e.alive) { const d = Math.hypot(e.pos.x - _v.x, e.pos.z - _v.z); if (d < 300) near.push([d, e]); }
      near.sort((a, b) => a[0] - b[0]);
      ts.forEach((t, i) => {
        const nn = near[i]; if (!nn) { t.m.visible = false; return; }
        nn[1].chest(_w); t.m.visible = true; t.m.position.copy(_v); t.m.lookAt(_w); t.m.scale.set(1, 1, _v.distanceTo(_w)); col(t.m.material, RC[s.owner + 1]);
        t.m.material.opacity = nn[1].fac && Object.values(nn[1].fac).some(f => f.t > 0) ? 0.6 : 0.22 + 0.08 * Math.sin(time * 7);
      });
    }
  }

  // ---- gameplay: capture (4 Hz), timers, the barrage ----
  capture(dt) {
    const G = this.G, pl = G.player, u = G.units;
    for (const s of this.sites) {
      let w0 = 0, w1 = 0; const near = (x, z) => (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) < R * R;
      for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.alive && !e.cl && near(e.pos.x, e.pos.z)) { if (e.side) w1 += WT[e.hcls]; else w0 += WT[e.hcls]; }   // CRIPPLED engines (legs out) have capture weight 0 and cannot contest
      if (!pl.heavy && !pl._dead && near(pl.pos.x, pl.pos.z)) w0 += 1;
      for (const k of G.scouts.list) if (k.state === 'alive' && near(k.pos.x, k.pos.z)) { if (k.side) w1 += 1; else w0 += 1; }
      for (const t of u.tanks) if (t.alive && near(t.x, t.z)) { if (t.side) w1 += 1; else w0 += 1; }
      for (const q2 of u.squads) if (q2.alive > 0 && near(q2.lane, q2.z)) { if (q2.side) w1 += 0.5; else w0 += 0.5; }
      s.w[0] = w0; s.w[1] = w1; s.contested = w0 > 0 && w1 > 0;
      if (!s.contested && (w0 > 0 || w1 > 0)) { const rate = Math.min(12, 2.5 * (w0 || w1)); s.p = clamp(s.p + (w0 > 0 ? rate : -rate) * dt, -100, 100); }
      let o = s.owner; if (s.p >= 100) o = 0; else if (s.p <= -100) o = 1; else if ((o === 0 && s.p <= 0) || (o === 1 && s.p >= 0)) o = null;   // owned at +-100, until progress crosses 0
      if (o !== s.owner) {
        s.owner = o; this.recount(); this.gateMsg(); s.spT = 20; s.artT = 20; this.pips[s.k].flip = 0.3;
        if (o === 0 && pl.heavy && !pl._dead && near(pl.pos.x, pl.pos.z) && G.wrath) G.wrath.gain(5);   // Wrath: a site captured with the player in the ring (spec 10)
        if (o !== null) { G.announce(`${TYPENAME[s.type]} ${s.id} TAKEN - ${SIDE[o]}`); s.root.localToWorld(_v.set(MAST[s.type][0], MAST[s.type][1] + 27.5, MAST[s.type][2])); const C = OG[o + 1]; G.fx.flash(_v.x, _v.y, _v.z, C[0], C[1], C[2], 5000, 0.4, 400); s.pop = 0; }
      }
      if (s.contested && s.owner !== null) this.defend(s);
      if (s.contested && G.fx.camDist(s.x, 40, s.z) < 400 && G.time - (s.spk || -9) > 0.5) { s.spk = G.time; s.root.localToWorld(_v.set(MAST[s.type][0], MAST[s.type][1] + 23, MAST[s.type][2])); G.fx.sparks(_v.x, _v.y, _v.z, 4, 14, 3, 3, 3, 0.5); }
    }
  }
  gateMsg() {   // the win gate opens: say so
    for (const side of [0, 1]) { const o = this.n[side] >= 3; if (o !== !!this['open' + side]) { this['open' + side] = o; if (o) this.G.announce(`${SIDE[1 - side]} WARD GENERATOR EXPOSED`); } }
  }
  timers(dt) {
    const G = this.G;
    for (const s of this.sites) {
      if (s.owner === null) continue;
      if (s.type === 'gate') { s.spT -= dt; if (s.spT <= 0) { s.spT = 60; G.units.gateSpawn(s.owner, s.x, s.z); this.gateFx(s); } }
      if (s.type === 'arty' && !this.bar) { s.artT -= dt; if (s.artT <= 0) { s.artT = 45; this.fire(s); } }
    }
  }
  // the manufactorum's target: the player's latest painted zone (when the owner is the player's side), else the enemy heavy nearest the front line, else an infantry cluster
  aimFor(s) {
    const G = this.G, side = s.owner, pl = G.player; let tx = null, tz = null;
    if (side === 0 && pl.heavy && !pl._dead && pl.unit.zones.length) { const z = pl.unit.zones[pl.unit.zones.length - 1]; return { x: z.x, z: z.z }; }
    let bd = 1e9, who = null; for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side !== side && e.alive) { const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z); if (d < bd) { bd = d; who = e; } }
    if (who) { tx = who.pos.x + (who.vel ? who.vel.x * 3 : 0); tz = who.pos.z + (who.vel ? who.vel.z * 3 : 0); } else { const cl = G.units.findCluster(side, s.x, s.z, 500); if (cl) { tx = cl.lane; tz = cl.z; } }
    return tx === null ? null : { x: tx, z: tz };
  }
  fire(s) {   // t runs from -4 (the battery slews and charges) to the first shot at 0; shell i leaves barrel i % 3 at 0.25 i and lands 3 s later
    const a = this.aimFor(s); if (!a) { s.artT = 10; return; }
    this.bar = { t: -4, side: s.owner, site: s, aim: a, shots: 0, pts: [] };
  }
  barrage(dt) {
    const G = this.G, b = this.bar, fx = G.fx, s = b.site, o = b.side + 1; b.t += dt;
    if (b.t < 0) { const a = this.aimFor(s); if (a) b.aim = a; return; }
    if (!b.pts.length) {   // first shot: fix the pattern (one shell on the target, five on a 22 m ring turned at random) and warn the player if it is the target
      const a = this.aimFor(s) || b.aim, r0 = rr(0, 6.283); b.aim = a; b.pts = [{ x: a.x, z: a.z }, ...[...Array(5)].map((_, i) => ({ x: a.x + Math.cos(r0 + i * 1.2566) * 22, z: a.z + Math.sin(r0 + i * 1.2566) * 22 }))];
      if (b.pts.some(p => Math.hypot(p.x - G.player.pos.x, p.z - G.player.pos.z) < 60)) G.announce('ARTILLERY INBOUND');
    }
    while (b.shots < 6 && b.t >= 0.25 * b.shots) {   // a shell leaves its barrel
      const i = b.shots++, p = b.pts[i]; p.t0 = b.t; s.root.updateMatrixWorld(true); const mz = s.mz[i % 3]; mz.getWorldPosition(_v); mz.parent.getWorldDirection(_d);
      fx.muzzle(_v, _d, 4, 3, 1.7, 0.6); fx.flash(_v.x, _v.y, _v.z, 3, 1.7, 0.6, 4000, 0.12, 300); for (let k = 0; k < 3; k++) fx.smoke(_v.x - _d.x * 28, _v.y - _d.y * 28, _v.z - _d.z * 28, rr(-2, 2), rr(1, 4), rr(-2, 2), rr(1.2, 2.2), 2, 8, 0.4, 0.5, 0.5);
      G.sfx.boom(fx.camDist(_v.x, _v.y, _v.z), 2); fx.tracer(_v.x, _v.y, _v.z, _v.x + _d.x * 400, _v.y + _d.y * 400, _v.z + _d.z * 400, 300, 24, 1.6, 3, 1.7, 0.6); s.recoil = 2.5; if (i === 5) s.chFlash = 1;
    }
    for (const p of b.pts) {
      if (p.t0 === undefined || p.done) continue; const u = (b.t - p.t0) / 3;
      if (!p.inb && u >= 0.8) { p.inb = true; fx.tracer(p.x + rr(-30, 30), 400, p.z + rr(-30, 30), p.x, 0, p.z, 650, 30, 1.8, 3, 1.7, 0.6); }
      if (u >= 1) this.impact(p, b.side);
    }
    const tm = G.time;   // markers: coloured by the firing side, one per shell in flight, white in the last half second
    this.markers.forEach((m, i) => {
      const p = b.pts[i]; if (!p || p.t0 === undefined || p.done) { m.g.visible = false; return; }
      const u = clamp((b.t - p.t0) / 3, 0, 1), c = u > 0.8333 ? [3, 3, 3] : RC[o]; m.g.visible = true; m.g.position.set(p.x, 0, p.z); m.kr.scale.setScalar(8); m.cr.scale.setScalar(8 * (3 - 2 * u));
      col(m.kr.material, c); m.kr.material.opacity = Math.sin(tm * (12 + 38 * u)) > 0 ? 1 : 0.4; col(m.cr.material, c); m.cr.material.opacity = 0.3 + 0.5 * u; col(m.xs.material, c); m.xs.material.opacity = 0.8; col(m.dl.material, c); m.dl.material.opacity = 0.15 + 0.35 * u;
    });
    if (b.pts.every(p => p.done)) { this.bar = null; for (const m of this.markers) m.g.visible = false; }
  }
  impact(p, side) {
    const G = this.G, fx = G.fx; p.done = true;
    fx.explosion(p.x, 1, p.z, 3.5); fx.dust(p.x, 1, p.z, 6, 8); fx.debris(p.x, 2, p.z, 6, 1.4, 24, 0.08); G.shakeAt(p.x, 0, p.z, 4);
    G.blast(p.x, 0.5, p.z, 8, 300, side);                                          // infantry, tanks and Kestrels within 8 m
    splashEngines(G, p.x, 0.5, p.z, 8, 120, 40, false, { side }, true, true);   // S 120 / H 40 per shell on engines, the shield share spread over every standing facing
  }

  // ---- the AI director ----
  slot(u, s) { if (u._slotA === undefined) u._slotA = rr(0, 6.283); return { x: s.x + Math.cos(u._slotA) * 36, z: s.z + Math.sin(u._slotA) * 36, site: s.k }; }
  defend(s) {   // an owned site within 400 m is contested and the unit has no heavy target: it turns back to defend
    const G = this.G;
    for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) {
      if (e.side !== s.owner || !e.alive || e.piloted || e.ordered || (e.goal && (e.goal.wd || e.goal.site === s.k)) || Math.hypot(e.pos.x - s.x, e.pos.z - s.z) > 400) continue;
      const t = e.tgt || e.target; if (t && t.fac) continue;
      e.goal = this.slot(e, s);
    }
  }
  score(side, s, d, load) {
    const mine = s.owner === side, lean = side === 0 ? s.p > 0 : s.p < 0; let sc = -d / 350;
    if (s.contested && (mine || lean)) sc += 2;        // contested sites we partly hold come first
    if (!mine) sc += 0.9; else if (!s.contested) sc -= 1.2;
    if (this.n[side] === 2 && !mine) sc += 0.8;        // the third site opens the generator
    return sc - 0.5 * load[s.k];
  }
  direct() {
    const G = this.G;
    for (const side of [0, 1]) {
      const load = [0, 0, 0, 0, 0], push = this.n[side] >= 3;
      for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const u of L) {
        if (u.side !== side || !u.alive || u.piloted) continue;
        if (u.cl || u.ca) { this.withdraw(u); continue; }   // crippled / disarmed: home to the bastion until repaired
        if (u.ordered) continue;                              // the player's order outranks the director
        if (side === 1) { this.plan(u, push); continue; }     // Synod heavies each follow one battle plan (princeps spec)
        if (push && u.hcls !== 'harrow') { const b = G.bastions[1 - side], st = b.gen.alive ? b.gen : b; if (b.hp > 0) { u.goal = { x: 0, z: st.pos.z - (side === 0 ? -1 : 1) * 320, site: -1 }; continue; } }   // 3 held: the great colossi and hierarchs push the enemy generator and bastion
        let best = null, bs = -1e9;
        for (const s of this.sites) { const d = Math.hypot(u.pos.x - s.x, u.pos.z - s.z); let sc = this.score(side, s, d, load); if (u.goal && u.goal.site === s.k && d < R && s.owner !== side) sc += 1.5; if (sc > bs) { bs = sc; best = s; } }
        load[best.k]++; u.goal = this.slot(u, best);
      }
      // infantry and tanks: one goal per lane group, among the sites that lane reaches
      for (const lane of LANES) {
        const sqs = G.units.squads.filter(q2 => q2.side === side && q2.lane === lane), tks = G.units.tanks.filter(t => t.side === side && t.lane === lane), live = [...sqs.filter(q2 => q2.alive > 0).map(q2 => q2.z), ...tks.filter(t => t.alive).map(t => t.z)];
        const cand = this.sites.filter(s => Math.abs(s.x - lane) < 60);
        if (!cand.length || !live.length) { for (const q2 of sqs) if (!q2.ordered) q2.goalZ = null; for (const t of tks) if (!t.ordered) t.goalZ = null; continue; }
        const z0 = live.reduce((a, b) => a + b, 0) / live.length; let best = null, bs = -1e9;
        for (const s of cand) { const sc = this.score(side, s, Math.abs(z0 - s.z), load); if (sc > bs) { bs = sc; best = s; } }
        const dir = side === 0 ? -1 : 1; let k = 0; load[best.k] += 0.5;
        for (const t of tks) { const z = best.z - dir * (22 + 12 * (k++ % 3)); if (!t.ordered) t.goalZ = z; }   // tanks hold on their own side of the structure, squads in front of it
        k = 0; for (const q2 of sqs) { const z = best.z + dir * (20 + 12 * (k++ % 3)); if (!q2.ordered) q2.goalZ = z; }
      }
    }
  }

  // ---- battle plans for Synod heavies (princeps spec): HUNTER (the player's engine; at most one), BREACHER (the Vigil site nearest the Synod side, gate E preferred), SIEGE (holds C or
  // the Synod-leaning anchor and shells). Re-evaluated every 20 s, or at once when the plan becomes impossible; announced when assigned or changed ----
  hunter() { const G = this.G; for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side === 1 && e.alive && e.plan === 'H') return e; return null; }
  withdraw(u) {   // a crippled / disarmed engine's goal: its own bastion (the fall-back zone), 220 m in
    if (u.goal && u.goal.wd) return; const b = this.G.bastions[u.side];
    u.goal = { x: b.pos.x, z: b.pos.z - (u.side === 0 ? 1 : -1) * 220, site: -1, wd: true }; u.plan = null; u.planKey = ''; u.ordered = false; u.ordTgt = null;
  }
  playerHeavy() { const pl = this.G.player; return pl.heavy && !pl._dead && pl.unit.alive; }
  breachSite() { let best = -1, bs = 1e9; for (const s of this.sites) if (s.owner === 0) { const v = s.z - (s.id === 'E' ? 160 : 0); if (v < bs) { bs = v; best = s.k; } } return best; }   // lowest z = nearest the Synod side
  siegeSite() { const C = this.sites[2], B = this.sites[1]; return C.owner === 0 && B.owner !== 0 ? B.k : C.k; }
  planOk(u) { if (u.plan === 'H') return this.playerHeavy(); if (u.plan === 'B') return u.planSite < 0 || this.sites[u.planSite].owner === 0; return !!u.plan; }
  plan(u, push) {
    const G = this.G, now = G.time; let p = null, site = -1;
    if (u.plan && now - u.planAt < 20 && this.planOk(u) && u.goal) return;
    const pref = { colossus: 'S', hierarch: 'B', harrow: 'H' }[u.hcls], hu = this.hunter();
    p = pref; if (p === 'H' && (!this.playerHeavy() || (hu && hu !== u))) p = 'B';
    if (push && p !== 'H' && u.hcls !== 'harrow') { p = 'B'; site = -2; }   // three sites held: the great colossi and hierarchs push the enemy generator and bastion (as before)
    else if (p === 'B') { site = this.breachSite(); if (site < 0) p = 'S'; }
    if (p === 'S') site = this.siegeSite();
    const key = p + site, changed = key !== u.planKey; u.plan = p; u.planAt = now; u.planSite = site; u.planKey = key;
    if (site === -2) { const b = G.bastions[1 - u.side], st = b.gen.alive ? b.gen : b; if (b.hp > 0) u.goal = { x: 0, z: st.pos.z - (u.side === 0 ? -1 : 1) * 320, site: -1 }; u.planSite = -1; return; }
    if (p === 'H') { const pl = G.player; u.goal = { x: pl.pos.x, z: pl.pos.z, site: -1 }; if (changed) G.announce(u.name + ' HUNTS YOU'); return; }
    const st = this.sites[site]; u.goal = this.slot(u, st);
    if (changed) G.announce(p === 'B' ? `${u.name} MARCHES ON ${{ gate: 'GATE', anchor: 'ANCHOR', arty: 'MANUFACTORUM' }[st.type]} ${st.id}` : `THE SYNOD ${u.hcls.toUpperCase()} DIGS IN AT ${st.id}`);
  }

  // ---- HUD: the top-centre strip (type glyph, letter, capture fill, timer bar) with the win-gate counters either side ----
  hudBuild() {
    this.obj = document.getElementById('objs'); this.cv = this.obj.querySelector('.cnt.v'); this.cs = this.obj.querySelector('.cnt.s'); const row = this.obj.querySelector('.pips');
    this.pips = this.sites.map(s => { const d = document.createElement('div'); d.className = 'pip'; d.innerHTML = `<div class="fill"></div><svg viewBox="0 0 16 16"><path d="${GLYPH[s.type]}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><b>${s.id}</b><div class="tm"><i></i></div>`; row.appendChild(d); return { d, fill: d.firstChild, tm: d.querySelector('.tm'), flip: 0 }; });
  }
  hud() {
    for (const s of this.sites) {
      const P = this.pips[s.k], d = P.d, f = Math.abs(s.p) / 100, o = s.owner, cs = s.p > 0 ? 0 : 1, cc = o !== null ? CSS[o] : CSSN, lead = CSS[cs];
      d.style.color = cc; d.classList.toggle('cont', s.contested); d.classList.toggle('flip', P.flip > 0); P.flip = Math.max(0, P.flip - 0.07);
      d.style.borderColor = s.contested ? '' : o !== null ? cc : f > 0 ? lead : 'rgba(184,176,160,0.5)'; d.style.borderWidth = o !== null ? '2px' : '1.5px'; d.style.boxShadow = o !== null && !s.contested ? `0 0 6px ${cc}80` : '';
      P.fill.style.height = (o !== null ? 100 : f * 100) + '%'; P.fill.style.background = o !== null ? cc : lead; P.fill.style.opacity = o !== null ? 0.28 : 0.35;
      P.tm.style.display = o !== null && s.type !== 'anchor' ? 'block' : 'none'; P.tm.firstChild.style.width = clamp(s.type === 'gate' ? 1 - s.spT / 60 : 1 - s.artT / 45, 0, 1) * 100 + '%'; P.tm.firstChild.style.background = cc;
    }
    for (const [el, side] of [[this.cv, 0], [this.cs, 1]]) { const n = this.n[side], big = n >= 3; el.textContent = `${SIDE[side]} ${n}/5`; el.style.color = CSS[side]; el.style.opacity = big ? 1 : side ? 0.6 : 1; el.style.border = big ? `1px solid ${CSS[side]}` : '1px solid transparent'; el.classList.toggle('blink', big && side === 1); }
  }
}
