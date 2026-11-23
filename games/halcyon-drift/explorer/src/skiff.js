// "Wisp" skiff: a compact ducted-fan / repulsor flyer carried in the spaceplane's belly bay, deployed near an Aethel gate and flown
// through it into the hollow interior. Procedural model (lathe hull, extruded swept wings, ducted fans, glass canopy, repulsor pads)
// plus a small assisted flight model in the local flat frame (x east, y up, z south; forward = -Z at yaw 0).
//
// Flight model (assisted, always on): W/S target forward speed, A/D turn (auto bank), Q/E strafe, Shift/Ctrl climb/descend, Space boost
// (drains the cell). With no climb input the skiff holds its altitude. Gravity is cancelled by the repulsors, so the same model works
// on the outer shell (g pulls down) and inside the cavity (g pulls towards the shell, i.e. down in the local frame), see aethelinterior.js.
import * as THREE from 'three';
import { createPlume } from './fx.js';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const SKIFF = { cruise: 110, boost: 320, reverse: 28, clearance: 1.15, radius: 2.4 };

function extrudeWing() {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(1.9, 0.55); s.lineTo(2.55, 1.35); s.lineTo(2.35, 1.8); s.lineTo(1.1, 1.55); s.lineTo(0, 1.85); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.11, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2 });
  g.rotateX(Math.PI / 2);                   // shape plane -> XZ, thickness along Y
  g.translate(0, 0.05, -0.9);
  return g;
}

export function buildSkiffModel() {
  const group = new THREE.Group(), rig = new THREE.Group(); group.add(rig);
  const white = new THREE.MeshStandardMaterial({ color: 0x8c9a9a, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.3 });      // albedo kept well below 0.5 so sun + bloom do not clip it
  const dark = new THREE.MeshStandardMaterial({ color: 0x252b30, roughness: 0.55, metalness: 0.7, envMapIntensity: 0.5 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x17706c, roughness: 0.45, metalness: 0.2, envMapIntensity: 0.5 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd9561a, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c2a33, roughness: 0.08, metalness: 0.7, emissive: 0x06303a, emissiveIntensity: 0.5, envMapIntensity: 0.8 });
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.95, 0.9), toneMapped: false });
  const parts = { fans: [], glow: [], plumes: [] };

  // hull: lathe along Z (nose -Z), flattened
  const prof = [[0.0, -3.1], [0.22, -2.95], [0.5, -2.5], [0.74, -1.7], [0.86, -0.6], [0.84, 0.7], [0.7, 1.9], [0.46, 2.65], [0.2, 3.0], [0.0, 3.1]].map(([r, y]) => new THREE.Vector2(r, y));
  const hullG = new THREE.LatheGeometry(prof, 40); hullG.rotateX(Math.PI / 2); hullG.scale(1.0, 0.58, 1.0);
  const hull = new THREE.Mesh(hullG, white); rig.add(hull);
  // dorsal spine + accent stripes
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 3.4, 4, 10), teal); spine.rotation.x = Math.PI / 2; spine.position.set(0, 0.5, 0.9); spine.scale.set(1, 1, 0.8); rig.add(spine);
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 2.9), orange); st.position.set(sx * 0.78, 0.08, 0.35); st.rotation.y = sx * -0.06; rig.add(st); }
  // canopy
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), glass); can.scale.set(0.5, 0.36, 1.15); can.position.set(0, 0.3, -0.85); rig.add(can);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 24), dark); frame.rotation.x = Math.PI / 2; frame.scale.set(1, 2.3, 1); frame.position.set(0, 0.22, -0.85); rig.add(frame);
  // swept wings carrying the fan ducts
  const wingG = extrudeWing();
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(wingG, white); wing.scale.x = sx; wing.position.set(sx * 0.55, -0.05, 0.3); rig.add(wing);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.5), teal); edge.position.set(sx * 2.85, 0.0, 0.5); edge.rotation.y = sx * 0.2; rig.add(edge);
    // ducted fan pod
    const pod = new THREE.Group(); pod.position.set(sx * 1.95, 0.02, 1.15);
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.6, 1.55, 28, 1, true), white); duct.rotation.x = Math.PI / 2; duct.material = white.clone(); duct.material.side = THREE.DoubleSide; pod.add(duct);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.06, 8, 30), teal); lip.position.z = -0.78; pod.add(lip);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.55, 14), dark); hub.rotation.x = Math.PI / 2; pod.add(hub);
    const fan = new THREE.Group(); fan.position.z = -0.1;
    for (let b = 0; b < 9; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.015, 0.2), dark); bl.position.set(0.36, 0, 0); const arm = new THREE.Group(); arm.rotation.z = b / 9 * Math.PI * 2; bl.rotation.x = 0.5; arm.add(bl); fan.add(arm); }
    pod.add(fan); parts.fans.push(fan);
    const stator = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.12), dark); stator.position.z = 0.35; pod.add(stator);
    const stator2 = stator.clone(); stator2.rotation.z = Math.PI / 2; pod.add(stator2);
    const pl = createPlume(0.34, 'jet'); pl.rotation.x = -Math.PI / 2; pl.position.z = 0.75; pod.add(pl); parts.plumes.push(pl);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.9), white); strut.position.set(sx * -0.95, 0.0, 0.25); pod.add(strut);
    rig.add(pod);
  }
  // tail fin + stabilisers
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.95, 0); fs.lineTo(0.35, 1.05); fs.lineTo(0.0, 1.05); fs.closePath();
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.08, bevelEnabled: false }); fg.translate(-0.04, 0, 0); fg.rotateY(-Math.PI / 2); fg.translate(0, 0.22, 3.0);
  const fin = new THREE.Mesh(fg, teal); rig.add(fin);
  for (const sx of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 0.5), white); st.position.set(sx * 0.55, 0.12, 2.75); st.rotation.z = sx * 0.12; rig.add(st); }
  // repulsor pads (underside, glowing)
  for (const [x, z, r] of [[0, -1.6, 0.34], [-0.5, 1.1, 0.4], [0.5, 1.1, 0.4]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 24), dark); ring.rotation.x = Math.PI / 2; ring.position.set(x, -0.5, z); rig.add(ring);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 24), glowMat.clone()); pad.rotation.x = Math.PI / 2; pad.position.set(x, -0.495, z); rig.add(pad); parts.glow.push(pad);
  }
  // skids
  for (const sx of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([new V3(sx * 0.62, -0.42, -1.9), new V3(sx * 0.7, -0.78, -1.5), new V3(sx * 0.72, -0.84, 0.2), new V3(sx * 0.7, -0.8, 1.7), new V3(sx * 0.6, -0.5, 2.1)]);
    rig.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 6), dark));
    for (const z of [-1.2, 1.2]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 5), dark); lg.position.set(sx * 0.68, -0.64, z); rig.add(lg); }
  }
  // nose lamp + nav lights
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2), toneMapped: false })); lamp.position.set(0, -0.12, -2.95); rig.add(lamp);
  for (const [sx, c] of [[-1, new THREE.Color(0.2, 2.5, 0.4)], [1, new THREE.Color(2.5, 0.25, 0.2)]]) { const n = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: c, toneMapped: false })); n.position.set(sx * 2.72, 0.02, 0.55); rig.add(n); }
  rig.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== glowMat; o.receiveShadow = true; } });
  group.userData.parts = parts;
  return { group, rig, parts };
}

export class Skiff {
  constructor() {
    this.model = buildSkiffModel(); this.group = this.model.group;
    this.p = new V3(); this.v = new V3(); this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.holdY = 0; this.charge = 1; this.landed = true; this.boosting = false; this.agl = 0; this.speed = 0; this.fanPhase = 0; this.thrust = 0;
    this.out = false; this.world = null; this.events = [];
    this.group.visible = false;
  }
  place(x, y, z, yaw) { this.p.set(x, y, z); this.v.set(0, 0, 0); this.yaw = yaw; this.holdY = y; this.landed = true; this.pitch = this.roll = 0; this.thrust = 0; }
  forward(out = new V3()) { return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  /** ctl: {fwd, turn, strafe, climb, boost} in -1..1 (boost boolean). env: {h(x,z), scatter, g} */
  step(dt, ctl, env) {
    this.events.length = 0;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const boost = ctl.boost && this.charge > 0.02 && ctl.fwd > 0; this.boosting = boost;
    this.charge = clamp(this.charge + (boost ? -0.11 : 0.035) * dt, 0, 1);
    const vf = this.v.x * fx + this.v.z * fz, vs = this.v.x * rx + this.v.z * rz;
    const vfT = ctl.fwd > 0 ? (boost ? SKIFF.boost : SKIFF.cruise) : ctl.fwd < 0 ? -SKIFF.reverse : 0;
    const af = clamp((vfT - vf) * (vfT === 0 ? 0.5 : 0.8), -13, boost ? 40 : 17);
    const as = clamp((ctl.strafe * 24 - vs) * 2.2, -11, 11);
    this.v.x += (fx * af + rx * as) * dt; this.v.z += (fz * af + rz * as) * dt;
    this.yaw += ctl.turn * (0.95 - 0.4 * Math.min(1, Math.abs(vf) / 220)) * dt;
    // vertical: climb / descend, otherwise hold altitude (the repulsors cancel the world's pull)
    const gh = env.h(this.p.x, this.p.z);
    const climbT = ctl.climb * (boost ? 60 : 30);
    if (ctl.climb !== 0) this.holdY = this.p.y; else if (!(this.landed && this.holdY < gh + 3)) { /* keep holdY */ }
    const vyT = ctl.climb !== 0 ? climbT : clamp((this.holdY - this.p.y) * 0.7, -16, 16);
    this.v.y += clamp((vyT - this.v.y) * 1.7, -10, 10) * dt;
    // terrain look-ahead: lift over rising ground so the hold does not fly into slopes
    const sp = Math.hypot(this.v.x, this.v.z);
    if (sp > 3) { const la = Math.min(900, sp * 4), ah = env.h(this.p.x + this.v.x / sp * la, this.p.z + this.v.z / sp * la); const need = ah + 14 - this.p.y; if (need > 0 && ah > -1e4) { this.v.y += clamp(need * 0.05, 0, 14) * dt; this.holdY = Math.max(this.holdY, this.p.y); } }
    this.p.addScaledVector(this.v, dt);
    // ground contact (skids) + trees / rocks
    const g2 = env.h(this.p.x, this.p.z);
    this.agl = this.p.y - g2;
    this.landed = false;
    if (this.p.y <= g2 + SKIFF.clearance + 0.06) {          // skids on the ground (small tolerance: the altitude hold can rest exactly on the clearance)
      if (this.p.y < g2 + SKIFF.clearance) this.p.y = g2 + SKIFF.clearance; if (this.v.y < 0) { if (this.v.y < -12) this.events.push('thud'); this.v.y = 0; }
      this.landed = this.v.length() < 5 && ctl.climb <= 0 && ctl.fwd === 0; this.agl = SKIFF.clearance;
      if (!this.landed) { const k = Math.pow(0.6, dt); this.v.x *= k; this.v.z *= k; }
      if (this.holdY < this.p.y) this.holdY = this.p.y;
    }
    if (this.landed) { this.v.x *= Math.pow(0.05, dt); this.v.z *= Math.pow(0.05, dt); }
    if (env.scatter) {
      const c = env.scatter.collide(this.p.x, this.p.z, this.p.y - g2, SKIFF.radius);
      if (c.hit) { this.p.x += c.px; this.p.z += c.pz; const vn = this.v.x * c.nx + this.v.z * c.nz; if (vn < 0) { this.v.x -= vn * c.nx * 1.4; this.v.z -= vn * c.nz * 1.4; if (vn < -12) this.events.push('thud'); } }
    }
    this.speed = Math.hypot(this.v.x, this.v.z);
    // visuals: nose down while accelerating, bank into turns
    const tp = clamp(-af * 0.022 - this.v.y * 0.004, -0.34, 0.3), tr = clamp(-ctl.turn * 0.5 - ctl.strafe * 0.18, -0.6, 0.6);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 3.5); this.roll += (tr - this.roll) * Math.min(1, dt * 3.0);
    this.thrust = this.landed ? 0.0 : clamp(0.28 + Math.abs(af) / 22 + Math.abs(this.v.y) / 40, 0, 1) * (boost ? 1.2 : 1);
  }
  applyModel(dt, time) {
    const g = this.group; g.visible = true;
    g.position.copy(this.p); g.rotation.set(this.pitch, -this.yaw, this.roll, 'YXZ');
    const parts = this.model.parts;
    this.fanPhase += dt * (this.landed ? 4 : 30 + this.thrust * 70);
    for (const f of parts.fans) f.rotation.z = this.fanPhase;
    const gl = this.landed ? 0.45 : 1.0 + this.thrust * 0.9;
    for (const m of parts.glow) m.material.color.setRGB(0.25 * gl, 0.95 * gl, 0.9 * gl);
    for (const pl of parts.plumes) pl.userData.set(this.landed ? 0 : clamp((this.thrust - 0.25) * 0.8, 0, 0.8), this.boosting ? 6 : 2.4, time);
  }
}
