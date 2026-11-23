import * as THREE from 'three';
import { Builder, PAL, rnd, rr, clamp, damp, angDiff } from './util.js?v=32';
import { shieldMaterial } from './colossus.js?v=32';

// Bastion fortresses, ward generators and bastion guns (model/heavy-combat-spec.md section 5, model/bastion-visual.md): primitive-built.
// Synod bastion at z -740 (ward generator at -580), Vigil at +740 (+580). Destroying the Synod bastion is victory, losing the Vigil one is defeat.
// The bastion is immune while its ward generator stands. Everything destructible implements the same small interface as an engine
// (side, alive, pos, chest(out), damage(amt, byPlayer, bypass, pt, hAmt), rayHit) and lives in G.structs.
const hp_ = Math.PI / 2, q = Math.PI / 4, o8 = Math.PI / 8;
const BASTION_HP = 8000, GEN_HP = 1600, LANCE_HP = 600, AC_HP = 300;
const _k = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const K = (hex, k) => { _k.set(hex); return [_k.r * k, _k.g * k, _k.b * k]; };
let shared = null;

function buildParts(side) {
  const C = PAL[side], H = K(C.hull, 1.2), H2 = K(C.hull, 0.8), D = C.dark, T = K(C.trim, 1.2), Bn = K(C.bone, 1.2), S = 0x0b0a09, S2 = 0x121212, S3 = [0.06, 0.055, 0.05];
  const g = C.glow, gB = [g[0] * 1.5, g[1] * 1.5, g[2] * 1.5], hot = [2.2, 0.3, 0.1], W = 0xffffff, hp = hp_, o = o8;
  const B = () => new Builder(), base = B(), gate = B(), tower = B(), ward2 = B(), keep = B(), crown = B(), crownGlow = B(), glow = B(), scar = B(), ruin = B(), acYaw = B(), acPitch = B(), lanceYaw = B(), lancePitch = B(), lanceGlow = B(), gen = B(), genClaws = B(), genGlow = B(), genCore = B();
  base.box(170, 44, 90, 0, 22, 0, H2).box(176, 4, 96, 0, 46, 0, D).box(171.6, 1.6, 91.6, 0, 31, 0, T).box(62, 30, 5, 55, 13.5, 50.5, D, -0.35).box(62, 30, 5, -55, 13.5, 50.5, D, -0.35)
    .box(172, 30, 5, 0, 13.5, -50.5, D, 0.35).box(5, 30, 92, 90.5, 13.5, 0, D, 0, 0, 0.35).box(5, 30, 92, -90.5, 13.5, 0, D, 0, 0, -0.35);
  for (const x of [-64, -48, -32, 32, 48, 64]) base.box(8, 6, 3, x, 51, 46.5, H);
  for (let x = -64; x <= 64; x += 16) base.box(8, 6, 3, x, 51, -46.5, H);
  for (const s of [-1, 1]) for (const z of [-16, 0, 16]) base.box(3, 6, 8, s * 86.5, 51, z, H);
  for (const x of [-66, -38, 38, 66]) base.box(6, 26, 3, x, 31, 46.5, H);
  for (const x of [-60, -36, -12, 12, 36, 60]) base.box(6, 26, 3, x, 31, -46.5, H);
  for (const s of [-1, 1]) for (const z of [-24, 0, 24]) base.box(3, 26, 6, s * 86.5, 31, z, H);
  for (const s of [-1, 1]) base.box(14, 20, 0.8, s * 52, 33, 45.4, Bn).box(3, 16, 0.5, s * 52, 33, 45.9, D).box(6, 6, 0.5, s * 52, 36, 46, side ? T : H, 0, 0, q);
  gate.box(44, 58, 22, 0, 29, 53, H).box(48, 3, 26, 0, 59.5, 53, D).box(10, 72, 12, 22, 36, 60, D).box(10, 72, 12, -22, 36, 60, D).box(24, 34, 1, 0, 17, 64.2, S).box(28, 3, 1.6, 0, 35.5, 64.5, T)
    .box(3, 34, 1.6, 13.5, 17, 64.5, T).box(3, 34, 1.6, -13.5, 17, 64.5, T).box(18, 16, 0.8, 0, 47, 64.3, Bn).box(26, 2, 18, 0, 1.2, 72.5, D, 0.14);
  for (const x of [-14, 0, 14]) gate.box(8, 5, 3, x, 63.5, 64.5, H);
  for (const s of [-1, 1]) { if (side) gate.cyl(7, 4.5, 5, s * 22, 74.5, 60, S, 0, 0, 0, 8); else gate.pyr(11, 12, s * 22, 72, 60, T, 13); }
  tower.cyl(18, 22, 14, 0, 7, 0, D, 0, 0, 0, 10).cyl(16, 18, 66, 0, 33, 0, H, 0, 0, 0, 10).cyl(17, 17, 1.6, 0, 48, 0, T, 0, 0, 0, 10).cyl(18, 17, 4, 0, 65, 0, D, 0, 0, 0, 10).cyl(7, 8, 6, 0, 70, 0, D, 0, 0, 0, 8);
  ward2.box(120, 30, 60, 0, 63, -6, H).box(124, 3, 64, 0, 79.5, -6, D).box(121.6, 1.6, 61.6, 0, 66, -6, T);
  for (const x of [-32, -16, 0, 16, 32]) ward2.box(8, 5, 3, x, 83.5, 24.5, H);
  for (let x = -48; x <= 48; x += 16) ward2.box(8, 5, 3, x, 83.5, -36.5, H);
  for (const s of [-1, 1]) for (const z of [-26, -10]) ward2.box(3, 5, 8, s * 60.5, 83.5, z, H);
  for (const x of [-34, -16, 16, 34]) ward2.box(5, 34, 5, x, 62, 29.5, D, -0.3);
  for (const s of [-1, 1]) for (const z of [-24, -4]) ward2.box(5, 34, 5, s * 65.5, 62, z, D, 0, 0, s * 0.3);
  for (const x of [-40, 0, 40]) ward2.box(5, 34, 5, x, 62, -41.5, D, 0.3);
  for (const s of [-1, 1]) ward2.cyl(10, 12, 10, s * 50, 83, 14, D, 0, 0, 0, 10).cyl(10.6, 10.6, 1.2, s * 50, 87.4, 14, T, 0, 0, 0, 10);
  keep.box(56, 44, 44, 0, 100, -12, H).box(62, 5, 50, 0, 124.5, -12, D);
  for (const sx of [-1, 1]) for (const z of [10, -34]) keep.box(8, 52, 8, sx * 28, 104, z, D).box(9.6, 2.4, 9.6, sx * 28, 131.2, z, T);
  for (const s of [-1, 1]) keep.box(10, 8, 4, s * 12, 131, 11, H).box(10, 8, 4, s * 12, 131, -35, H).box(4, 8, 10, s * 29, 131, -20, H).box(4, 8, 10, s * 29, 131, -4, H);
  keep.box(20, 36, 0.8, 0, 100, 10.4, Bn).box(4, 30, 0.5, 0, 100, 10.9, D).box(10, 10, 0.5, 0, 108, 11, side ? T : H, 0, 0, q);
  for (const x of [-16, 0, 16]) keep.box(3, 40, 2, x, 100, -35, T);
  for (const s of [-1, 1]) keep.cyl(3, 4, 32, s * 18, 138, -28, S, 0, 0, 0, 8);
  if (!side) { crown.box(34, 4, 14, 0, 2, 0, D).box(6, 34, 8, 12, 21, 0, D).box(6, 34, 8, -12, 21, 0, D).pyr(6, 10, 12, 38, 0, T, 8).pyr(6, 10, -12, 38, 0, T, 8).box(30, 3, 5, 0, 14, 0, T); crownGlow.box(8, 8, 8, 0, 23, 0, gB, q, 0, q); }
  else { crown.box(30, 10, 30, 0, 5, 0, D).box(20, 10, 20, 0, 15, 0, H).cyl(13, 8, 6, 0, 23, 0, S, 0, 0, 0, 8).box(3, 20, 3, 12, 30, 0, T, 0, 0, -0.3).box(3, 20, 3, -12, 30, 0, T, 0, 0, 0.3).box(3, 20, 3, 0, 30, 12, T, 0.3).box(3, 20, 3, 0, 30, -12, T, -0.3); crownGlow.box(16, 1.5, 16, 0, 25.6, 0, hot); }
  for (const x of [-8, -4, 0, 4, 8]) glow.box(1.2, 30, 0.5, x, 16, 64.9, g);
  glow.box(22, 1, 0.5, 0, 10, 64.9, g).box(22, 1, 0.5, 0, 22, 64.9, g).box(9, 9, 0.6, 0, 47, 64.9, gB, 0, 0, q);
  for (const x of [-76, -31, 31, 76]) glow.box(1.6, 9, 0.5, x, 38, 45.3, g);
  for (const s of [-1, 1]) for (const z of [-12, 12]) glow.box(0.5, 9, 1.6, s * 85.3, 38, z, g);
  for (const s of [-1, 1]) glow.box(14, 5, 0.6, s * 24, 37, -45.3, hot);
  for (const x of [-25, 25]) glow.box(2.4, 14, 0.5, x, 64, 24.3, g);
  glow.box(2.4, 14, 0.5, -7, 64, 24.3, g).box(2.4, 14, 0.5, 7, 64, 24.3, g).box(3, 18, 0.5, 0, 66, 24.3, g);
  for (const s of [-1, 1]) glow.box(3, 26, 0.6, s * 16, 102, 10.3, g).box(0.6, 22, 3, s * 28.3, 102, -4, g).box(0.6, 22, 3, s * 28.3, 102, -20, g).box(10, 24, 0.6, s * 8, 100, -34.3, hot);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const a = Math.atan2(sx, sz); glow.box(1.6, 10, 0.8, sx * 85 + Math.sin(a) * 16.9, 40, sz * 45 + Math.cos(a) * 16.9, g, 0, a, 0).box(4, 4, 0.8, sx * 85 + Math.sin(a) * 16.6, 56, sz * 45 + Math.cos(a) * 16.6, g, 0, a, q); }
  acYaw.cyl(5.5, 5.5, 1.2, 0, 0.6, 0, D, 0, 0, 0, 10).box(11, 6, 12, 0, 4.2, -1, H).box(11.6, 1, 12.6, 0, 7.7, -1, T).box(2, 5.5, 7, 6.3, 4.2, 1.5, D).box(2, 5.5, 7, -6.3, 4.2, 1.5, D).cyl(2.6, 2.6, 9, 0, 4.5, -8.5, T, 0, 0, hp, 8);
  acPitch.box(8, 4.5, 3, 0, 0, 1.5, D).cyl(0.9, 0.9, 16, 2.2, 0, 11, S2, hp, 0, 0, 6).cyl(0.9, 0.9, 16, -2.2, 0, 11, S2, hp, 0, 0, 6).box(2.6, 2.6, 2.2, 2.2, 0, 19.6, D).box(2.6, 2.6, 2.2, -2.2, 0, 19.6, D);
  lanceYaw.cyl(9, 9, 2, 0, 1, 0, D, 0, 0, 0, 10).box(14, 9, 16, 0, 6.5, -1, H).box(14.8, 1.2, 16.8, 0, 11.6, -1, T).box(3, 10, 9, 8.5, 7, 3, D).box(3, 10, 9, -8.5, 7, 3, D).box(10, 7, 6, 0, 6, -12, D);
  for (const z of [-10.5, -12.5, -14.5]) lanceYaw.box(12, 8.5, 0.8, 0, 6.5, z, T);
  lancePitch.box(7, 7, 9, 0, 0, 1.5, D).cyl(1.6, 2.2, 28, 0, 0, 20, D, hp).box(1.4, 1.4, 9, 2.6, 0, 37, T).box(1.4, 1.4, 9, -2.6, 0, 37, T).box(6.6, 3, 3, 0, 0, 33.5, D).box(2, 3, 14, 0, -3.4, 13, D);
  for (const z of [11, 18, 25]) lancePitch.cyl(4, 4, 1.2, 0, 0, z, T, hp, 0, 0, 10);
  lanceGlow.box(2.4, 1.6, 7, 0, 0, 37.5, W).box(5, 5, 2.5, 0, 0, 14.5, W).box(5, 5, 2.5, 0, 0, 21.5, W);
  gen.cyl(20, 23, 6, 0, 3, 0, D, 0, o, 0, 8).cyl(15, 17, 12, 0, 12, 0, H, 0, o, 0, 8).cyl(17.5, 17.5, 1.6, 0, 18.6, 0, T, 0, o, 0, 8).cyl(5, 7, 16, 0, 27, 0, D, 0, o, 0, 8).cyl(8, 5, 3, 0, 36.5, 0, T, 0, o, 0, 8)
    .box(6, 26, 7, 15, 30, 0, H, 0, 0, -0.25).box(6, 26, 7, -15, 30, 0, H, 0, 0, 0.25).box(7, 26, 6, 0, 30, 15, H, 0.25).box(7, 26, 6, 0, 30, -15, H, -0.25);
  genClaws.cyl(3.6, 3.6, 8, 19, 42.5, 0, D, hp, 0, 0, 8).cyl(3.6, 3.6, 8, -19, 42.5, 0, D, hp, 0, 0, 8).cyl(3.6, 3.6, 8, 0, 42.5, 19, D, 0, 0, hp, 8).cyl(3.6, 3.6, 8, 0, 42.5, -19, D, 0, 0, hp, 8)
    .box(4.5, 22, 6, 15.5, 51, 0, T, 0, 0, 0.55).box(4.5, 22, 6, -15.5, 51, 0, T, 0, 0, -0.55).box(6, 22, 4.5, 0, 51, 15.5, T, -0.55).box(6, 22, 4.5, 0, 51, -15.5, T, 0.55);
  genGlow.box(5, 3, 0.6, 0, 11, 15.1, g).box(5, 3, 0.6, 0, 11, -15.1, g).box(0.6, 3, 5, 15.1, 11, 0, g).box(0.6, 3, 5, -15.1, 11, 0, g)
    .box(1.2, 14, 0.6, 0, 27, 5.8, g).box(1.2, 14, 0.6, 0, 27, -5.8, g).box(0.6, 14, 1.2, 5.8, 27, 0, g).box(0.6, 14, 1.2, -5.8, 27, 0, g);
  genCore.box(9, 9, 9, 0, 0, 0, W, q, 0, q).box(8, 8, 8, 0, 0, 0, W, 0, q, 0);
  scar.box(24, 20, 5, 52, 32, 47.5, S, 0, 0, 0.15).box(14, 12, 5, 62, 22, 47.5, S, 0, 0, -0.3).box(12, 10, 5, 42, 42, 47.5, S, 0, 0, 0.5).box(16, 6, 10, 54, 3, 62, S3, 0, 0.3, 0).box(8, 5, 7, 44, 2.5, 64, S3, 0, -0.5, 0.1)
    .box(22, 18, 5, -10, 112, 10.5, S, 0, 0, -0.2).box(5, 20, 24, -28.5, 110, -14, S, 0.15, 0, 0);
  ruin.box(112, 12, 58, 0, 53, -6, S3, 0, 0, 0.03).box(46, 26, 34, -6, 66, -14, H2, 0.1, 0.2, -0.08).box(20, 40, 6, 14, 70, 2, D, 0.5, 0, 0.2).box(8, 30, 8, -26, 68, -34, D, 0, 0, 0.15).box(30, 8, 22, 30, 60, 10, S3, 0, 0.4, 0)
    .box(26, 10, 20, -38, 58, 12, S3, 0, -0.3, 0.05).box(44, 24, 22, 0, 12, 53, H2).box(10, 34, 12, -22, 17, 60, D, 0, 0, 0.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ruin.cyl(17.2, 18, 24, sx * 85, 12, sz * 45, H2, 0, 0, 0, 10).box(14, 10, 6, sx * 85, 27, sz * 45, D, 0.3, 0.5, 0.2);
  const P = {}; for (const [n, b] of Object.entries({ base, gate, tower, ward2, keep, crown, crownGlow, glow, scar, ruin, acYaw, acPitch, lanceYaw, lancePitch, lanceGlow, gen, genClaws, genGlow, genCore })) P[n] = b.build();
  P.gate.translate(0, 0, -53); P.ward2.translate(0, -48, 6); P.keep.translate(0, -78, 12);
  return P;
}

// a destructible thing with the engine-like interface: a bastion, a ward generator or a turret
class Struct {
  constructor(B, kind, hp, radius) { this.B = B; this.G = B.G; this.side = B.side; this.kind = kind; this.hp = this.maxHp = hp; this.alive = true; this.radius = radius; this.pos = new THREE.Vector3(); this.isStruct = true; this.name = ''; }
  chest(out) { return out.copy(this.pos); }
  rayHit() { return -1; }
}
const sphereHit = (o, d, c, r, maxT) => { const px = c.x - o.x, py = c.y - o.y, pz = c.z - o.z, b = px * d.x + py * d.y + pz * d.z, cc = px * px + py * py + pz * pz - r * r, disc = b * b - cc; if (disc < 0) return -1; const t = b - Math.sqrt(disc); return t >= 0 && t <= maxT ? t : (cc < 0 ? 0 : -1); };
const boxHit = (o, d, x0, x1, y0, y1, z0, z1, maxT) => {   // world AABB slab test
  let t0 = 0, t1 = maxT;
  for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < a || oo > b) return -1; } else { let ta = (a - oo) / dd, tb = (b - oo) / dd; if (ta > tb) { const s = ta; ta = tb; tb = s; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return -1; }
  }
  return t0;
};

export class Bastion {
  constructor(G, side) {
    this.G = G; this.side = side; this.s = side ? 1 : -1; this.oz = side ? -740 : 740; this.name = side ? 'THE SYNOD BASTION' : 'THE VIGIL BASTION';
    if (!shared) shared = { body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }), scorch: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x8a8078, roughness: 0.95, metalness: 0.05 }), glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), parts: [buildParts(0), buildParts(1)] };
    const P = shared.parts[side], M = shared.body, GL = shared.glow, scene = G.scene, gC = PAL[side].glow;
    const grp = (parent, x, y, z) => { const n = new THREE.Group(); n.position.set(x, y, z); parent.add(n); return n; };
    this.root = new THREE.Group(); this.root.position.set(0, 0, this.oz); this.root.rotation.y = side ? 0 : Math.PI; scene.add(this.root);
    const R = this.root; this.meshes = {};
    const mesh = (parent, geo, mat, n) => { const m = new THREE.Mesh(geo, mat); parent.add(m); if (n) this.meshes[n] = m; return m; };
    mesh(R, P.base, M, 'base'); mesh(R, P.glow, GL, 'glow'); mesh(R, P.scar, M, 'scar').visible = false; mesh(R, P.ruin, M, 'ruin').visible = false;
    this.gate = grp(R, 0, 0, 53); mesh(this.gate, P.gate, M, 'gate');
    this.towers = [[85, 45, q], [-85, 45, -q], [85, -45, 3 * q], [-85, -45, -3 * q]].map(([x, z, ry]) => { const t = grp(R, x, 0, z); t.rotation.order = 'YXZ'; t.rotation.y = ry; mesh(t, P.tower, M); return t; });
    this.ward2 = grp(R, 0, 48, -6); mesh(this.ward2, P.ward2, M, 'ward2');
    this.keep = grp(this.ward2, 0, 30, -6); mesh(this.keep, P.keep, M, 'keep');
    this.crown = grp(this.keep, 0, 49, 0); this.crown.rotation.order = 'YXZ'; mesh(this.crown, P.crown, M); mesh(this.crown, P.crownGlow, GL);
    this.receptor = grp(this.crown, 0, side ? 27 : 23, 0);
    this.heart = grp(R, 0, 100, -12);
    // turrets
    this.turrets = [];
    for (const [i, t] of this.towers.entries()) {
      const yaw = grp(t, 0, 73, 0), ymesh = mesh(yaw, P.acYaw, M), pitch = grp(yaw, 0, 4.5, 4), pmesh = mesh(pitch, P.acPitch, M), a = grp(pitch, 2.2, 0, 21), b = grp(pitch, -2.2, 0, 21);
      const T = new Struct(this, 'ac', AC_HP, 10); T.name = 'AUTOCANNON'; Object.assign(T, { yawN: yaw, pitchN: pitch, ymesh, pmesh, anchors: [a, b], alt: 0, cd: rr(0.5, 2), yMin: -2.2, yMax: 2.2, pMin: -0.5, pMax: 0.9, slew: 1.4, range: 300, rHit: 8, pivot: pitch, smoke: null });
      this.turrets.push(T);
    }
    this.lanceGlowMats = [];
    for (const sgn of [1, -1]) {
      const yaw = grp(this.ward2, sgn * 50, 40, 20), ymesh = mesh(yaw, P.lanceYaw, M), pitch = grp(yaw, 0, 7, 4), pmesh = mesh(pitch, P.lancePitch, M);
      const gm = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }), gmesh = new THREE.Mesh(P.lanceGlow, gm); pitch.add(gmesh); const anchor = grp(pitch, 0, 0, 42);
      const T = new Struct(this, 'lance', LANCE_HP, 12); T.name = 'LANCE TURRET'; Object.assign(T, { yawN: yaw, pitchN: pitch, ymesh, pmesh, gmesh, gm, anchors: [anchor], cycle: rr(0, 3), yMin: sgn > 0 ? -0.6 : -2.3, yMax: sgn > 0 ? 2.3 : 0.6, pMin: -0.45, pMax: 0.7, slew: 0.5, range: 600, rHit: 11, pivot: pitch, flash: 0, recoil: 0, smoke: null });
      yaw.rotation.y = 0; pitch.rotation.x = -0.05; this.turrets.push(T);
    }
    // the ward: dome, ring and the beam from the generator
    this.shieldMat = shieldMaterial(side); this.shieldMat.side = THREE.DoubleSide;
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.shieldMat); this.dome.position.set(0, 0, 6); this.dome.scale.set(138, 184, 106); this.dome.renderOrder = 8; R.add(this.dome);
    const rg = new THREE.RingGeometry(0.985, 1, 64); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: new THREE.Color(gC[0] * 0.6, gC[1] * 0.6, gC[2] * 0.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })); this.ring.position.set(0, 0.4, 6); this.ring.scale.set(138, 1, 106); R.add(this.ring);
    this.wardA = 1;
    // the generator
    this.gen = new Struct(this, 'gen', GEN_HP, 23); this.gen.name = side ? 'SYNOD WARD GENERATOR' : 'VIGIL WARD GENERATOR';
    this.genRoot = new THREE.Group(); this.genRoot.position.set(0, 0, this.oz + this.s * 160); scene.add(this.genRoot); this.gen.pos.set(0, 47, this.genRoot.position.z);
    this.genMeshes = { gen: new THREE.Mesh(P.gen, M), claws: new THREE.Mesh(P.genClaws, M), glow: new THREE.Mesh(P.genGlow, GL) }; for (const m of Object.values(this.genMeshes)) this.genRoot.add(m);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }); this.core = new THREE.Mesh(P.genCore, this.coreMat); this.core.position.y = 47; this.genRoot.add(this.core); this.coreK = 0;
    const bg = new THREE.CylinderGeometry(1.2, 1.2, 1, 6, 1, true); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 0.5);
    this.beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: new THREE.Color(gC[0] * 1.2, gC[1] * 1.2, gC[2] * 1.2), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); this.beam.frustumCulled = false; scene.add(this.beam);
    // the bastion itself
    this.hp = this.maxHp = BASTION_HP; this.radius = 95; this.kind = 'bastion'; this.pos = new THREE.Vector3(0, 0, this.oz); this.isStruct = true; this.phase = 'intact'; this.T = 0; this.endT = 0; this.klaxT = 0; this.fires = [];
    this.root.updateMatrixWorld(true);
    // ambient fire and smoke (bastion-local -> world)
    const W_ = (x, y, z) => ({ x: this.s * x, y, z: this.oz + this.s * z });
    this.W = W_;
    this.amb = [];
    for (const x of [18, -18]) { const p = W_(x, 157, -28); this.amb.push(G.fx.addEmitter(p.x, p.y, p.z, 3.2, Infinity, true)); }
    if (side) { const p = W_(0, 156, -12); this.pyre = G.fx.addEmitter(p.x, p.y, p.z, 5, Infinity); for (const x of [22, -22]) { const b = W_(x, 79, 60); this.amb.push(G.fx.addEmitter(b.x, b.y, b.z, 2.6, Infinity)); } }
    else { this.lights = [22, -22].map(x => { const m = new THREE.Mesh(G.city.beamGeo, G.city.beamMat); m.frustumCulled = false; m.renderOrder = 9; scene.add(m); m.userData.x = x; return m; }); }
    this.dying = null;
    for (const T of this.turrets) { T.damage = (amt, byPlayer, bypass, pt, hAmt) => this.hitTurret(T, hAmt === undefined ? amt : Math.max(amt, hAmt), byPlayer); T.chest = out => T.pivot.getWorldPosition(out); T.rayHit = (o, d, m) => { T.pivot.getWorldPosition(_v); return T.alive ? sphereHit(o, d, _v, T.rHit, m) : -1; }; }
    this.gen.damage = (amt, byPlayer, bypass, pt, hAmt) => this.hitGen(hAmt === undefined ? amt : Math.max(amt, hAmt), byPlayer);
    this.gen.rayHit = (o, d, m) => this.gen.alive ? cylHit(o, d, this.gen.pos.x, this.gen.pos.z, 21, 0, 61, m) : cylHit(o, d, this.gen.pos.x, this.gen.pos.z, 16, 0, 43, m);   // GV1+GV2, or the stump
    this.gen.chest = out => out.set(this.gen.pos.x, 47, this.gen.pos.z);
    this.chest = out => out.set(0, 60, this.oz);
    this.damage = (amt, byPlayer, bypass, pt, hAmt) => this.hitBastion(hAmt === undefined ? amt : Math.max(amt, hAmt), byPlayer, pt);
    this.rayHit = (o, d, m) => this.rayBastion(o, d, m);
    G.structs.push(this, this.gen, ...this.turrets);
    for (const T of this.turrets) { T.pos.copy(_v.set(0, 0, 0)); T.pivot.getWorldPosition(T.pos); }
  }
  // ---- rays: the dome first while the ward stands, else the solid volumes (V1-V6 + the towers), in world space ----
  rayBastion(o, d, maxT) {
    if (this.phase === 'ruin') return -1;
    const s = this.s, oz = this.oz, X = (a, b) => s > 0 ? [a, b] : [-b, -a], Z = (a, b) => s > 0 ? [oz + a, oz + b] : [oz - b, oz - a];
    if (this.gen.alive) {   // dome: (x/138)^2 + (y/184)^2 + ((z-6)/106)^2 = 1 in bastion-local
      const ox = s * o.x, oy = o.y, oz_ = s * (o.z - oz) - 6, dx = s * d.x, dy = d.y, dz = s * d.z, A = (dx / 138) ** 2 + (dy / 184) ** 2 + (dz / 106) ** 2, B = (ox * dx / 138 ** 2 + oy * dy / 184 ** 2 + oz_ * dz / 106 ** 2), Cc = (ox / 138) ** 2 + (oy / 184) ** 2 + (oz_ / 106) ** 2 - 1;
      if (Cc < 0) return -1;   // already inside (the bastion's own garrison fires from within)
      const disc = B * B - A * Cc; if (disc < 0) return -1; const t = (-B - Math.sqrt(disc)) / A; return t >= 0 && t <= maxT && oy + dy * t >= 0 ? t : -1;
    }
    let best = -1; const test = (x0, x1, y0, y1, z0, z1) => { const [a, b] = X(x0, x1), [c, e] = Z(z0, z1), t = boxHit(o, d, a, b, y0, y1, c, e, maxT); if (t >= 0 && (best < 0 || t < best)) best = t; };
    if (this.phase !== 'collapsing') { test(-85, 85, 0, 48, -45, 45); test(-27, 27, 0, 61, 45, 66); test(-60, 60, 48, 81, -36, 24); test(-32, 32, 78, 130, -38, 14); if (this.phase === 'intact') test(-17, 17, 130, 165, -20, -4); for (const [x, z] of [[85, 45], [-85, 45], [85, -45], [-85, -45]]) test(x - 18, x + 18, 0, 73, z - 18, z + 18); }
    else test(-85, 85, 0, 48, -45, 45);
    return best;
  }
  hitTurret(T, amt, byPlayer) {
    if (!T.alive) return; const G = this.G; T.hp -= amt; if (byPlayer) G.hitMark = 1; G.stats.structDmg = (G.stats.structDmg || 0) + amt;
    if (T.hp <= 0) this.killTurret(T);
  }
  killTurret(T) {
    const G = this.G, fx = G.fx, lance = T.kind === 'lance'; T.alive = false; T.pivot.getWorldPosition(_w);
    fx.explosion(_w.x, _w.y, _w.z, lance ? 4 : 2.5); fx.debris(_w.x, _w.y, _w.z, lance ? 9 : 5, lance ? 1.8 : 1.2, lance ? 26 : 22, 0.08);
    T.pmesh.visible = false; if (T.gmesh) T.gmesh.visible = false; T.ymesh.material = shared.scorch; T.ymesh.rotation.x = -0.18; T.ymesh.rotation.z = lance ? -0.2 : 0.25;
    fx.addEmitter(_w.x, _w.y + (lance ? 4 : 3), _w.z, lance ? 3 : 2.2, lance ? 60 : 40); T.smoke = fx.addEmitter(_w.x, _w.y + (lance ? 6 : 4), _w.z, lance ? 2.6 : 2, Infinity, true);
    G.stats.turretKills = (G.stats.turretKills || 0) + 1; G.announce(this.name + ' - ' + T.name + ' DESTROYED');
  }
  hitGen(amt, byPlayer) {
    const G = this.G, g = this.gen; if (!g.alive) return;
    // win gate (objectives-facings spec section 2): the generator can only be hurt while the attacking side holds 3 of the 5 sites; otherwise its shell is warded and only flares
    if (G.objectives && G.objectives.holds(1 - this.side) < 3) { this.coreK = Math.min(2, this.coreK + 0.5); this.wardA = Math.min(2.4, this.wardA + 0.2); if (byPlayer && G.time - (this.gateMsgT || -99) > 8) { this.gateMsgT = G.time; G.announce('WARD GENERATOR SHIELDED - HOLD 3 OF 5 SITES'); } return; }
    g.hp -= amt; this.coreK = Math.min(2, this.coreK + 1.5); if (byPlayer) G.hitMark = 1; G.stats.structDmg = (G.stats.structDmg || 0) + amt;
    if (g.hp <= 0) {
      g.alive = false; const fx = G.fx, p = g.pos, gC = PAL[this.side].glow;
      fx.explosion(p.x, 47, p.z, 5); fx.flash(p.x, 47, p.z, gC[0], gC[1], gC[2], 9000, 0.5, 400); fx.debris(p.x, 45, p.z, 12, 2.2, 28, 0.08);
      for (const m of [this.genMeshes.claws, this.genMeshes.glow, this.core, this.beam]) m.visible = false; this.genMeshes.gen.material = shared.scorch;
      this.domeDie = 0; fx.addEmitter(p.x, 24, p.z, 4, 90); fx.addEmitter(p.x, 36, p.z, 3, Infinity, true);
      this.receptor.getWorldPosition(_w); fx.flash(_w.x, _w.y, _w.z, gC[0], gC[1], gC[2], 6000, 0.4, 500);
      G.announce(g.name + ' DESTROYED - THE BASTION IS EXPOSED'); G.sfx.boom(fx.camDist(p.x, 47, p.z), 4);
    }
  }
  hitBastion(amt, byPlayer, pt) {
    const G = this.G, fx = G.fx; if (this.hp <= 0) return;
    if (this.gen.alive) {   // immune under the ward: only the dome flares
      this.wardA = Math.min(2.4, this.wardA + 0.25 + amt * 0.003); if (pt) fx.sparks(pt.x, pt.y, pt.z, 6, 20, 1, 1, 1, 0.5); return;
    }
    this.hp -= amt; if (byPlayer) G.hitMark = 1; G.stats.structDmg = (G.stats.structDmg || 0) + amt;
    if (this.phase === 'intact' && this.hp <= BASTION_HP * 0.5) this.breach();
    if (this.hp <= 0) this.collapse();
  }
  get alive() { return this.hp > 0; }
  breach() {
    const G = this.G, fx = G.fx, W = this.W; this.phase = 'breached'; this.crownT = 0;
    let p = W(0, 130, -12); fx.explosion(p.x, p.y, p.z, 4); fx.debris(p.x, p.y, p.z, 10, 2.5, 26, 0.08);
    this.meshes.scar.visible = true; this.meshes.keep.material = shared.scorch; p = W(52, 32, 50); fx.explosion(p.x, p.y, p.z, 3.5);
    if (this.pyre) this.pyre.ttl = 0; if (this.lights) for (const m of this.lights) m.visible = false;
    for (const [x, y, z, s, smokeOnly] of [[52, 30, 51, 4, false], [-10, 114, 13, 3.5, false], [0, 130, -12, 5, false], [-31, 108, -14, 3, true], [40, 50, -30, 3, false], [-14, 63, 56, 2.5, true]]) { const w = W(x, y, z); this.fires.push(fx.addEmitter(w.x, w.y, w.z, s, Infinity, smokeOnly)); }
    G.announce(this.name + ' BREACHED');
  }
  collapse() {
    const G = this.G; if (this.phase === 'collapsing' || this.phase === 'ruin') return; if (this.phase === 'intact') this.breach();
    this.phase = 'collapsing'; this.T = 0; this.meshes.glow.visible = false; for (const e of this.amb) e.ttl = 0; for (const T of this.turrets) if (T.smoke) T.smoke.ttl = 0;
    this.destroyQueue = this.turrets.filter(t => t.alive); this.dqT = 0; G.stats.bastionKills = (G.stats.bastionKills || 0) + 1;
    G.announce(this.name + ' - REACTOR CRITICAL'); G.stats.bastionDownT = G.time; G.bastionDown(this.side);
  }

  // ---- turrets: slew within limits, find targets, fire ----
  update(dt) {
    const G = this.G, fx = G.fx, time = G.time;
    // ward dome / ring / beam / core
    const gC = PAL[this.side].glow; this.wardA = damp(this.wardA, 1 + 0.15 * Math.sin(time * 1.3), 3, dt);
    if (this.gen.alive) {
      this.shieldMat.uniforms.uA.value = this.wardA; this.ring.material.opacity = Math.min(1, 0.8 * this.wardA); this.coreK = damp(this.coreK, 0, 4, dt);
      let k = 1.6 + 0.3 * Math.sin(time * 5) + this.coreK; if (this.gen.hp < GEN_HP * 0.3) k *= 0.5 + 0.5 * (Math.sin(time * 37) > 0 ? 1 : 0);
      this.coreMat.color.setRGB(gC[0] * k, gC[1] * k, gC[2] * k); this.core.rotation.y += dt * 0.8; this.core.position.y = 47 + 0.8 * Math.sin(time * 1.3);
      this.root.updateMatrixWorld(); this.receptor.getWorldPosition(_w); _v.set(this.gen.pos.x, 47, this.gen.pos.z); this.beam.position.copy(_v); this.beam.lookAt(_w); const bl = _v.distanceTo(_w); const p = 1 + 0.25 * Math.sin(time * 9); this.beam.scale.set(p, p, bl);
    } else if (this.domeDie !== undefined && this.domeDie < 1) {
      this.domeDie = Math.min(1, this.domeDie + dt / 1.2); const f = 2.6 * (1 - this.domeDie) * (0.55 + 0.45 * Math.sin(time * 55)); this.shieldMat.uniforms.uA.value = Math.max(0, f); this.ring.material.opacity = Math.min(1, 0.8 * Math.max(0, f));
      if (this.domeDie >= 1) { this.dome.visible = false; this.ring.visible = false; }
    }
    if (this.lights && this.phase === 'intact') for (const m of this.lights) { const w = this.W(m.userData.x, 84, 60), a = time * 0.7 + (m.userData.x > 0 ? 0 : 2); m.position.set(w.x, w.y, w.z); _d.set(Math.sin(a), 0.55, Math.cos(a)).normalize(); m.quaternion.setFromUnitVectors(_y, _d); m.scale.set(0.4, 1.2, 0.4); }
    if (this.phase === 'breached') { this.meshes.glow.visible = rnd() > 0.08; this.updateCrown(dt); }
    if (this.phase === 'collapsing') this.updateCollapse(dt);
    if (this.phase === 'ruin') return;
    this.root.updateMatrixWorld(true);
    if (this.phase === 'collapsing') return;
    for (const T of this.turrets) if (T.alive) this.updateTurret(T, dt);
  }
  updateTurret(T, dt) {
    const G = this.G, fx = G.fx, lance = T.kind === 'lance', gC = PAL[this.side].glow, tr = PAL[this.side].tracer;
    T.pivot.getWorldPosition(_w); T.pos.copy(_w);
    // target: lances hunt enemy engines within 600 m (and a Kestrel within 450); autocannons hunt small units within 300 m
    T.scanT = (T.scanT || 0) - dt;
    if (T.scanT <= 0) { T.scanT = rr(0.4, 0.7); T.tp = null; this.pick(T, _w); }
    let tp = T.tp, err = 9;
    if (tp && T.tgtAlive && !T.tgtAlive()) { T.tp = tp = null; }
    if (tp) {
      if (T.getP) T.getP(_e); else _e.copy(tp);
      const yp = T.yawN.parent; yp.updateWorldMatrix(true, false); _v.copy(_e); yp.worldToLocal(_v);
      let wy = Math.atan2(_v.x - T.yawN.position.x, _v.z - T.yawN.position.z); const wyc = clamp(wy, T.yMin, T.yMax);
      T.yawN.rotation.y += clamp(angDiff(wyc, T.yawN.rotation.y), -T.slew * dt, T.slew * dt); T.yawN.updateWorldMatrix(true, false);
      _v.copy(_e); T.yawN.worldToLocal(_v); const hp2 = Math.hypot(_v.x - T.pitchN.position.x, _v.z - T.pitchN.position.z), wp = Math.atan2(_v.y - T.pitchN.position.y, hp2), wpc = clamp(wp, T.pMin, T.pMax), cur = -T.pitchN.rotation.x;
      T.pitchN.rotation.x = -(cur + clamp(wpc - cur, -T.slew * dt, T.slew * dt));
      err = Math.abs(angDiff(wyc, T.yawN.rotation.y)) + Math.abs(wpc - (-T.pitchN.rotation.x)) + Math.abs(angDiff(wy, wyc)) * 2 + Math.abs(wp - wpc) * 2;
    } else {   // back to the rest pose at half slew
      T.yawN.rotation.y += clamp(angDiff(0, T.yawN.rotation.y), -T.slew * 0.5 * dt, T.slew * 0.5 * dt); T.pitchN.rotation.x += clamp((lance ? -0.05 : 0) - T.pitchN.rotation.x, -T.slew * 0.5 * dt, T.slew * 0.5 * dt);
      if (lance) T.cycle = Math.min(T.cycle, 4.5);
    }
    T.pitchN.updateWorldMatrix(true, true);
    if (lance) {
      // 6 s cycle, charge tell over the last 1.5 s, then the beam
      if (tp) T.cycle += dt; const k = clamp((T.cycle - 4.5) / 1.5, 0, 1);
      if (T.flash > 0) { T.flash -= dt; const f = T.flash; if (f > 0.4) T.gm.color.setRGB(gC[0] * 4, gC[1] * 4, gC[2] * 4); else { const e = Math.max(0, f / 0.4) * 4; T.gm.color.setRGB(gC[0] * e, gC[1] * e, gC[2] * e); } }
      else if (tp && k > 0) { let e = k * k * 1.4; if (T.cycle > 5.8) e *= 1 + 0.3 * Math.sin(G.time * 90); T.gm.color.setRGB(gC[0] * e, gC[1] * e, gC[2] * e); } else T.gm.color.setRGB(0, 0, 0);
      T.recoil = damp(T.recoil, 0, 4, dt); T.pitchN.position.z = 4 - T.recoil * 2 + 0; T.pitchN.position.z = T.pitchN.position.z;
      if (tp && T.cycle >= 6 && err < 0.12) { T.cycle = 0; this.fireLance(T, tr, gC); }
    } else {
      T.cd -= dt; T.pitchN.position.z = 4 - (T.kick || 0); T.kick = damp(T.kick || 0, 0, 12, dt);
      if (tp && T.cd <= 0 && err < 0.14) { T.cd = rr(0.32, 0.5); this.fireAc(T, tr); }
    }
  }
  pick(T, from) {
    const G = this.G, enemy = 1 - this.side; let best = null, bd = T.range, get = null, alive = null;
    if (T.kind === 'lance') {
      for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) { if (e.side !== enemy || !e.alive) continue; const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z); if (d < bd) { bd = d; best = e; get = out => e.chest(out); alive = () => e.alive; } }
      const pl = G.player; if (!best && !pl.dead && this.side === 1) { const d = Math.hypot(pl.pos.x - from.x, pl.pos.z - from.z); if (d < 450) { best = pl; get = out => out.set(pl.pos.x, 15, pl.pos.z); alive = () => !pl.dead; } }
    } else {
      for (const s of G.scouts.list) { if (s.side !== enemy || s.state !== 'alive') continue; const d = Math.hypot(s.pos.x - from.x, s.pos.z - from.z); if (d < bd) { bd = d; best = s; get = out => out.set(s.pos.x, 14, s.pos.z); alive = () => s.state === 'alive'; } }
      for (const t of G.units.tanks) { if (t.side !== enemy || !t.alive) continue; const d = Math.hypot(t.x - from.x, t.z - from.z); if (d < bd) { bd = d; best = t; get = out => out.set(t.x, 2.5, t.z); alive = () => t.alive; } }
      for (const sq of G.units.squads) { if (sq.side !== enemy || sq.alive < 3) continue; const d = Math.hypot(sq.lane - from.x, sq.z - from.z); if (d < bd) { bd = d; best = sq; get = out => out.set(sq.lane, 1.5, sq.z); alive = () => sq.alive > 0; } }
      const pl = G.player; if (!pl.dead && this.side === 1) { const d = Math.hypot(pl.pos.x - from.x, pl.pos.z - from.z); if (d < bd) { best = pl; get = out => out.set(pl.pos.x, 15, pl.pos.z); alive = () => !pl.dead; } }
    }
    T.tp = best; T.getP = get; T.tgtAlive = alive; T.tgt = best;
  }
  fireLance(T, tr, gC) {
    const G = this.G, fx = G.fx, pl = G.player, a = T.anchors[0]; a.getWorldPosition(_w); a.parent.getWorldDirection(_d);
    _e.copy(_d); T.flash = 0.5; T.recoil = 1;
    const h = G.shoot(_w, _d, 650, this.side, { probe: true, radius: 2 }); let hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref;
    if (!pl.dead && this.side === 1) { const px = pl.pos.x - _w.x, py = 15 - _w.y, pz = pl.pos.z - _w.z, t = px * _d.x + py * _d.y + pz * _d.z; if (t > 0 && t < h.t) { const qx = px - _d.x * t, qy = py - _d.y * t, qz = pz - _d.z * t; if (qx * qx + qy * qy + qz * qz < 60) { hx = _w.x + _d.x * t; hy = _w.y + _d.y * t; hz = _w.z + _d.z * t; type = 'player'; } } }
    _v.set(hx, hy, hz); fx.beam(_w, _v, 2.2, tr[0] * 1.5, tr[1] * 1.5, tr[2] * 1.5, 0.25); fx.muzzle(_w, _d, 3, tr[0], tr[1], tr[2]); fx.flash(_w.x, _w.y, _w.z, gC[0], gC[1], gC[2], 5000, 0.3, 300); fx.explosion(hx, hy, hz, 2, { silent: true });
    G.sfx.lance(fx.camDist(_w.x, _w.y, _w.z)); G.shakeAt(hx, hy, hz, 2);
    const pt = { x: hx, y: hy, z: hz };
    if (type === 'col' || type === 'hier' || type === 'harrow') { pt.brk = true; pt.lance = true; ref.damage(200, false, false, pt, 350); }   // S 200 / H 350; pauses its ward regen
    else if (type === 'scout') G.scouts.damage(ref, 400, false, _w.x, _w.z); else if (type === 'tank') G.units.damageTank(ref, 999);
    else if (type === 'player') pl.damage(30, 'hull', _w.x, _w.z); else if (type === 'bld') G.city.damage(ref, 800, _d.x, _d.z); else if (type === 'inf') G.units.blast(hx, hy, hz, 6, 80, this.side, false);
  }
  fireAc(T, tr) {
    const G = this.G, fx = G.fx, pl = G.player, a = T.anchors[T.alt ^= 1]; a.getWorldPosition(_w); a.parent.getWorldDirection(_d); T.kick = 0.6;
    _d.x += rr(-0.012, 0.012); _d.y += rr(-0.006, 0.006); _d.z += rr(-0.012, 0.012); _d.normalize();
    const h = G.shoot(_w, _d, 320, this.side, { probe: true, radius: 1.4 }); let hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref;
    if (!pl.dead && this.side === 1) { const px = pl.pos.x - _w.x, py = 15 - _w.y, pz = pl.pos.z - _w.z, t = px * _d.x + py * _d.y + pz * _d.z; if (t > 0 && t < h.t) { const qx = px - _d.x * t, qy = py - _d.y * t, qz = pz - _d.z * t; if (qx * qx + qy * qy + qz * qz < 42) { const tt = Math.max(0, t - 3); hx = _w.x + _d.x * tt; hy = _w.y + _d.y * tt; hz = _w.z + _d.z * tt; type = 'player'; } } }
    const ox = _w.x, oz = _w.z, cd = fx.camDist(_w.x, _w.y, _w.z);
    fx.muzzle(_w, _d, 1.6, tr[0], tr[1], tr[2]); fx.tracer(_w.x, _w.y, _w.z, hx, hy, hz, 260, 10, 1.8, tr[0], tr[1], tr[2], () => {
      fx.explosion(hx, hy, hz, 0.9, { silent: cd > 500, noDebris: true });
      if (type === 'tank') G.units.damageTank(ref, 110); else if (type === 'scout') G.scouts.damage(ref, 100, false, ox, oz); else if (type === 'player') pl.damage(5, rnd() < 0.4 ? 'leg' : 'hull', ox, oz);
      else if (type === 'col' || type === 'hier' || type === 'harrow') ref.damage(3, false, false, { x: hx, y: hy, z: hz }, 5);
      G.units.blast(hx, hy, hz, 3.5, 30, this.side, false);
    });
    if (cd < 600) G.sfx.boom(cd, 0.5);
  }

  // ---- destruction states ----
  updateCrown(dt) {   // the crown falls over 2.2 s after the 50% breach
    if (this.crownT === undefined || this.crownT >= 2.2 || !this.crown.visible) return;
    const G = this.G, fx = G.fx; this.crownT += dt; const k = Math.min(1, this.crownT / 2.2);
    this.crown.rotation.y = 0.6; this.crown.rotation.x = 1.52 * Math.pow(k, 2.3); this.crown.position.y = 49 - 20 * k * k;
    if (k >= 1) { this.crown.visible = false; const p = this.W(25, 82, 22); fx.explosion(p.x, p.y, p.z, 3, { silent: true }); fx.dust(p.x, p.y, p.z, 4, 8); }
  }
  updateCollapse(dt) {
    const G = this.G, fx = G.fx, T = this.T += dt, W = this.W, s = this.s; const k = (a, b) => clamp((T - a) / (b - a), 0, 1), jit = (n, a, b) => { if (T > a && T < b) { n.position.x += rr(-0.5, 0.5); n.position.z += rr(-0.5, 0.5); } };
    this.klaxT -= dt; if (this.klaxT <= 0 && T < 9) { this.klaxT = 0.7; G.sfx.klaxon(0.2); }
    this.dqT -= dt; if (T < 2 && this.dqT <= 0 && this.destroyQueue.length) { this.dqT = 0.3; const t = this.destroyQueue.pop(); if (t.alive) this.killTurret(t); }
    if (T < 9 && rnd() < dt * 6) { const p = W(rr(-28, 28), rr(80, 125), rr(-34, 12)); fx.explosion(p.x, p.y, p.z, rr(1.5, 3)); fx.debris(p.x, p.y, p.z, 3, 1.8, 24, 0.08); }
    if (T > 2 && T < 9) for (let n = Math.floor(dt * 26 + rnd()); n > 0; n--) { const a = rnd() * 6.283, r = rr(0.6, 1.2), p = W(Math.cos(a) * 95 * r, 0, Math.sin(a) * 55 * r); fx.smoke(p.x, rr(0, 50), p.z, s * Math.cos(a) * rr(4, 16), rr(1, 9), s * Math.sin(a) * rr(4, 16), rr(4, 9), 14, 46, rr(0.1, 0.17), 0.65, 0.5); }
    let u = k(2, 5.5); if (this.keep.visible) { this.keep.position.set(this.keep.position.x, 30 - 44 * u * u, this.keep.position.z); this.keep.rotation.x = 0.10 * u; if (u >= 1) this.keep.visible = false; else jit(this.keep, 2, 5.5); }
    u = k(4.5, 8); if (this.ward2.visible) { this.ward2.position.y = 48 - 30 * u * u; this.ward2.rotation.z = -0.04 * u; if (u >= 1) this.ward2.visible = false; }
    this.towers.forEach((t, i) => {
      if (!t.visible) return; if (i === 0 || i === 3) {   // FL and RR topple outward
        const f = k(5.5, 8.5); t.rotation.x = 1.52 * Math.pow(f, 2.3); if (f > 0.8 && !t.fell) { t.fell = true; const a = t.rotation.y; for (const dd of [18, 34, 50, 66]) { const p = W(t.position.x + Math.sin(a) * dd, 2, t.position.z + Math.cos(a) * dd); fx.dust(p.x, 2, p.z, 5, 5, 0.14, 0.6); fx.explosion(p.x, 2, p.z, 1.4, { silent: true }); fx.debris(p.x, 4, p.z, 2, 2.2, 20, 0.09); G.blast(p.x, 2, p.z, 14, 400, -1); } G.sfx.boom(fx.camDist(...Object.values(W(t.position.x, 2, t.position.z))), 3); const q_ = W(t.position.x, 0, t.position.z); G.shakeAt(q_.x, 0, q_.z, 5); }
        if (f >= 1) t.visible = false;
      } else { const f = k(6, 9); t.position.y = -42 * f * f; if (f >= 1) t.visible = false; }
    });
    u = k(6.5, 9); if (this.gate.visible) { this.gate.position.y = -46 * u * u; this.gate.rotation.x = 0.08 * u; if (u >= 1) this.gate.visible = false; }
    if (T >= 9 && !this.final) {
      this.final = true; const p0 = W(0, 60, -6); fx.explosion(p0.x, p0.y, p0.z, 6); for (const [x, y, z, sz] of [[-40, 30, 50, 5], [40, 30, 50, 5], [0, 20, -50, 4.5]]) { const p = W(x, y, z); fx.explosion(p.x, p.y, p.z, sz, { silent: true }); }
      const c = W(0, 0, 0); for (let n = 0; n < 44; n++) { const a = n / 44 * 6.283, cc = Math.cos(a), sn = Math.sin(a); fx.smoke(c.x + cc * 60, 3, c.z + sn * 60, cc * rr(50, 75), rr(1, 6), sn * rr(50, 75), rr(2.5, 4.5), 12, 40, 0.15, 0.6, 1.1); }
      fx.flash(c.x, 80, c.z, 1, 0.55, 0.2, 9000, 0.6, 600); G.shakeAt(c.x, 0, c.z, 8); G.sfx.boom(fx.camDist(c.x, 40, c.z), 5); G.skyFlash = 1.5;
      this.meshes.base.material = shared.scorch; this.meshes.scar.visible = false; this.meshes.ruin.visible = true; this.meshes.glow.visible = false;
      for (const e of this.fires) e.ttl = 0; this.fires.length = 0;
      for (const [x, y, z, sz, ttl, smoke] of [[-6, 80, -14, 6, 180, false], [30, 64, 10, 4.5, 150, false], [-38, 62, 12, 4, 120, false], [0, 30, 62, 4, 120, false], [85, 26, 45, 3.5, Infinity, true], [-85, 26, 45, 3.5, Infinity, true], [85, 26, -45, 3.5, Infinity, true], [-85, 26, -45, 3.5, Infinity, true], [0, 66, -30, 7, Infinity, true]]) { const w = W(x, y, z); fx.addEmitter(w.x, w.y, w.z, sz, ttl, smoke); }
      this.phase = 'ruin'; this.dome.visible = false; this.ring.visible = false; this.beam.visible = false;
      for (const t of this.turrets) { t.alive = false; } this.hp = 0;
    }
  }
  // ground footprint for movers (F1-F6): push a circle out of the rectangles, exactly as a lot
  collide(p, r) {
    const s = this.s, oz = this.oz;
    for (const [cx, cz, hx, hz] of [[0, 0, 93, 55], [0, 61, 28, 6], [85, 45, 19, 19], [-85, 45, 19, 19], [85, -45, 19, 19], [-85, -45, 19, 19]]) this.pushOut(p, r, s * cx, oz + s * cz, hx, hz);
    this.pushOut(p, r, 0, this.genRoot.position.z, 21, 21);
  }
  pushOut(p, r, cx, cz, hx, hz) {
    const x = clamp(p.x, cx - hx, cx + hx), z = clamp(p.z, cz - hz, cz + hz), dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz; if (d2 >= r * r) return;
    if (d2 < 1e-6) { const ex = hx - Math.abs(p.x - cx), ez = hz - Math.abs(p.z - cz); if (ex < ez) p.x = cx + Math.sign(p.x - cx || 1) * (hx + r); else p.z = cz + Math.sign(p.z - cz || 1) * (hz + r); } else { const d = Math.sqrt(d2); p.x = x + dx / d * r; p.z = z + dz / d * r; }
  }
}
function cylHit(o, d, cx, cz, r, y0, y1, maxT) {   // vertical cylinder
  const px = o.x - cx, pz = o.z - cz, a = d.x * d.x + d.z * d.z; if (a < 1e-9) return -1; const b = px * d.x + pz * d.z, c = px * px + pz * pz - r * r, disc = b * b - a * c; if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a; if (t < 0 || t > maxT) return -1; const y = o.y + d.y * t; return y >= y0 && y <= y1 ? t : -1;
}
