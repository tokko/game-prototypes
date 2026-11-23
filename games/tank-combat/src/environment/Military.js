// Military dressing: enemy strongpoint (bunker, sandbags, revetted trench, concertina wire, supplies, camo net) built
// as static geometry and registered in the World as a damageable target placeholder; checkpoint with jersey barriers,
// boom gate and guard hut; burnt-out vehicle wrecks (reusing TankModel); scorch decals. Phase B wires the target.
import {
  Group, Mesh, MeshStandardMaterial, BoxGeometry, CylinderGeometry, PlaneGeometry, TubeGeometry, SphereGeometry, Curve, Shape, ExtrudeGeometry,
  InstancedMesh, Matrix4, Vector3, Color, MeshDepthMaterial, RGBADepthPacking, DoubleSide, MeshBasicMaterial,
} from 'three';
import { Simplex2, mulberry32 } from '../util/noise.js';
import { Kit } from './BuildingKit.js';
import { burnModel } from '../enemies/Wreck.js';
import { smoothstep, lerp } from '../util/math.js';
import { PAL, hexLin, wallGeometry, jitterColor } from './BuildingKit.js';
import { makeSandbagWeave, makeCamoNet, makeBurnt, makeSignTexture } from './ProcTextures.js';
import { patchMaterial } from './Atmosphere.js';
import { TankModel } from '../vehicles/TankModel.js';
import { makeScorchTexture } from '../effects/Explosions.js';

class Helix extends Curve {
  constructor(len, radius, pitch) { super(); this.arcLengthDivisions = 1500; this.len = len; this.r = radius; this.turns = len / pitch; }
  getPoint(t, out = new Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return out.set(t * this.len, this.r + Math.cos(a) * this.r, Math.sin(a) * this.r);
  }
}

export function buildMilitary(env, world, terrain) {
  const { kit } = env;
  const group = new Group();
  group.name = 'military';
  const rnd = mulberry32(777), noise = new Simplex2(778);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const exclusions = [];
  const S = terrain.strong;
  const gy = (x, z) => terrain.getHeight(x, z);

  // ---------- sandbags (single InstancedMesh for the whole map) ----------
  const bags = [];
  const sbPal = ['#9c8a64', '#8a7a58', '#a69872', '#6e6448'].map(hexLin);
  function sandbagWall(ax, az, bx, bz, courses = 5, deep = 2, gap = null) {
    const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
    const dx = (bx - ax) / len, dz = (bz - az) / len, nx = dz, nz = -dx;
    let minY = 1e9;
    for (let c = 0; c < courses; c++) {
      for (let r = 0; r < deep; r++) {
        const off = (c + r) % 2 ? 0.3 : 0;
        for (let t = off; t < len - 0.1; t += 0.6) {
          if (gap && t > gap[0] && t < gap[1] && c >= gap[2]) continue;
          const x = ax + dx * t + nx * (r - (deep - 1) / 2) * 0.36 + (rnd() - 0.5) * 0.04;
          const z = az + dz * t + nz * (r - (deep - 1) / 2) * 0.36 + (rnd() - 0.5) * 0.04;
          const y = gy(x, z) + 0.07 + c * 0.145;
          if (c === 0) minY = Math.min(minY, gy(x, z));
          bags.push({ x, y, z, ang: ang + (rnd() - 0.5) * 0.12, col: jitterColor(pick(sbPal), rnd, 0.08) });
        }
      }
    }
    world.addBox((ax + bx) / 2, (az + bz) / 2, deep * 0.2, len / 2, ang, { height: courses * 0.15 + 0.2, y0: minY - 1.5, tag: 'sandbag', cls: 'climb', top: courses * 0.145 + 0.1 });
  }

  function finishSandbags() {
    if (!bags.length) return;
    const g = new BoxGeometry(0.6, 0.15, 0.35, 4, 2, 3);
    const p = g.attributes.position;
    const R = [0.3, 0.075, 0.175];
    for (let i = 0; i < p.count; i++) {
      const v = [p.getX(i), p.getY(i), p.getZ(i)];
      const l = Math.hypot(v[0] / R[0], v[1] / R[1], v[2] / R[2]) || 1;
      for (let k = 0; k < 3; k++) v[k] = lerp(v[k], v[k] / l, 0.4);
      v[1] -= (Math.abs(v[0]) < 0.03 && v[1] > 0) ? 0.01 : 0;
      p.setXYZ(i, v[0], v[1], v[2]);
    }
    g.computeVertexNormals();
    const mat = patchMaterial(new MeshStandardMaterial({ map: makeSandbagWeave(), roughness: 1, metalness: 0 }));
    const mesh = new InstancedMesh(g, mat, bags.length);
    const col = new Color();
    bags.forEach((b, i) => {
      mesh.setMatrixAt(i, kit.matrix(b.x, b.y, b.z, b.ang));
      col.setRGB(b.col[0], b.col[1], b.col[2]); mesh.setColorAt(i, col);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // ---------- camo nets ----------
  const netTex = makeCamoNet();
  const netMat = patchMaterial(new MeshStandardMaterial({ map: netTex, alphaTest: 0.5, side: DoubleSide, roughness: 1, metalness: 0 }));
  netMat.alphaToCoverage = true;
  const netDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: netTex, alphaTest: 0.5 });
  function camoNet(x, z, w, d, yaw, h, k = kit) {
    const g = new PlaneGeometry(w, d, 16, 12);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w * 2, v = p.getZ(i) / d * 2;
      p.setY(i, -0.6 * (1 - u * u) * (1 - v * v) + noise.noise(p.getX(i) * 0.6 + x, p.getZ(i) * 0.6) * 0.15);
    }
    g.computeVertexNormals();
    const mesh = new Mesh(g, netMat);
    mesh.position.set(x, h, z); mesh.rotation.y = yaw;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = netDepth;
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    group.add(mesh);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [lx, lz] of [[-w / 2 + 0.3, -d / 2 + 0.3], [w / 2 - 0.3, -d / 2 + 0.3], [-w / 2 + 0.3, d / 2 - 0.3], [w / 2 - 0.3, d / 2 - 0.3], [0, 0]]) {
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c, base = gy(px, pz);
      k.add('timber', new CylinderGeometry(0.04, 0.04, h - base + 0.2, 6), { m: kit.matrix(px, (h + base) / 2 - 0.3, pz), color: PAL.timber[2], uv: 'keep', ao: false });
    }
    return mesh;
  }

  // ---------- scorch decals (terrain-conforming) ----------
  const scorchMat = new MeshBasicMaterial({ map: makeScorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.9 });
  function scorch(x, z, size) {
    const g = new PlaneGeometry(1, 1, 8, 8);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const px = x + p.getX(i) * size, pz = z + p.getZ(i) * size; p.setXYZ(i, px, gy(px, pz) + 0.07, pz); }
    g.computeBoundingSphere();
    const m = new Mesh(g, scorchMat);
    m.renderOrder = 2;
    group.add(m);
  }

  // =============== STRONGPOINT ===============
  // The bunker lives in its own kit/group so it can be replaced by a ruin when the target is destroyed.
  const sy = gy(S.x, S.z);
  const BW = 6, BD = 4, BH = 2.5;
  const nestOwner = { kind: 'nest' }; // projectile owner for the nest (so rounds fired from the slit ignore the bunker collider)
  const spGroup = new Group(); spGroup.name = 'strongpoint';
  const ruinGroup = new Group(); ruinGroup.name = 'strongpointRuin'; ruinGroup.visible = false;
  group.add(spGroup, ruinGroup);
  const skit = new Kit(env.mats), rkit = new Kit(env.mats);
  let bunkerCol, netMesh;
  {
    const c = PAL.bunker;
    // front (south, +z) wall with a firing slit, rear + side walls, roof slab, dark interior
    const front = wallGeometry(BW, BH, 0.5, { holes: [{ x: BW / 2, y: 1.45, w: 3.0, h: 0.3 }], drop: 1.0 });
    skit.add('concrete', front, { m: new Matrix4().makeTranslation(S.x - BW / 2, sy, S.z + BD / 2 - 0.5), color: c, y0: sy });
    skit.add('concrete', new BoxGeometry(BW, BH + 1, 0.5), { m: kit.matrix(S.x, sy + (BH - 1) / 2, S.z - BD / 2 + 0.25), color: c, y0: sy });
    for (const sx of [-1, 1]) skit.add('concrete', new BoxGeometry(0.5, BH + 1, BD - 1), { m: kit.matrix(S.x + sx * (BW / 2 - 0.25), sy + (BH - 1) / 2, S.z), color: c, y0: sy });
    skit.add('concrete', new BoxGeometry(BW + 0.6, 0.4, BD + 0.6), { m: kit.matrix(S.x, sy + BH + 0.2, S.z), color: c.map((v) => v * 0.95), y0: sy });
    skit.add('interior', new BoxGeometry(BW - 1, BH, BD - 1), { m: kit.matrix(S.x, sy + BH / 2 - 0.4, S.z), color: PAL.interior, uv: 'keep', ao: false });
    skit.add('rubble', new BoxGeometry(BW + 3, 0.6, BD + 3), { m: kit.matrix(S.x, sy - 0.1, S.z), color: [0.28, 0.22, 0.15], y0: sy, ao: false });
    bunkerCol = world.addBox(S.x, S.z, BW / 2 + 0.3, BD / 2 + 0.3, 0, { height: BH + 1, y0: sy - 1, tag: 'bunker', owner: nestOwner });
    world.addTarget('strongpoint', { hp: 1000, collider: bunkerCol, position: new Vector3(S.x, sy + 1.2, S.z), kind: 'bunker', data: { radius: 22 } });
    world.buildings.push({ x: S.x, z: S.z, hx: BW / 2, hz: BD / 2, heading: 0 });
    world.landmarks.strongpoint = { x: S.x, z: S.z, y: sy, radius: 22 };
    sandbagWall(S.x - 5.6, S.z + BD / 2 + 1.3, S.x + 5.6, S.z + BD / 2 + 1.3, 5, 2, [4.6, 7.0, 3]);
    sandbagWall(S.x - 5.6, S.z + BD / 2 + 1.3, S.x - 5.6, S.z - 3.5, 5, 2);
    sandbagWall(S.x + 5.6, S.z + BD / 2 + 1.3, S.x + 5.6, S.z - 3.5, 5, 2);
    netMesh = camoNet(S.x, S.z - 0.5, 9, 7, 0.1, sy + BH + 1.3, skit);
    spGroup.add(netMesh);
    scorch(S.x + 6, S.z + 8, 7);
    // ruin: broken slab pieces, a rubble mound with concrete chunks and charred timber
    const cc = PAL.bunker;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * 6.283, d = rnd() * 3;
      rkit.add('concrete', new BoxGeometry(1.2 + rnd() * 2, 0.35, 1 + rnd() * 1.5), { m: kit.matrix(S.x + Math.cos(a) * d, sy + 0.5 + rnd() * 0.9, S.z + Math.sin(a) * d, rnd() * 6.28, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7), color: cc, y0: sy });
    }
    const mound = new SphereGeometry(4.2, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const mp = mound.attributes.position;
    for (let i = 0; i < mp.count; i++) { const k = 1 + noise.noise(mp.getX(i) * 0.6 + 4, mp.getZ(i) * 0.6) * 0.3; mp.setXYZ(i, mp.getX(i) * k, mp.getY(i) * k * 0.4, mp.getZ(i) * k); }
    mound.computeVertexNormals();
    rkit.add('rubble', mound, { m: kit.matrix(S.x, sy - 0.1, S.z), color: [0.6, 0.57, 0.52], y0: sy, ao: false });
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * 4, sz = 0.2 + rnd() * 0.5;
      rkit.add('rubble', new BoxGeometry(sz, sz * 0.7, sz * 1.2), { m: kit.matrix(S.x + Math.cos(a) * d, sy + (1 - d / 4) * 1.4, S.z + Math.sin(a) * d, rnd() * 6.28, rnd(), rnd()), color: jitterColor(pick(PAL.stone), rnd, 0.1), y0: sy, ao: false });
    }
    for (let i = 0; i < 4; i++) rkit.add('burnt', new BoxGeometry(0.15, 0.2, 2.5 + rnd() * 2), { m: kit.matrix(S.x + (rnd() - 0.5) * 5, sy + 1 + rnd(), S.z + (rnd() - 0.5) * 4, rnd() * 6.28, rnd() * 0.6), color: PAL.burnt[1], uv: 'keep', ao: false });
    rkit.add('burnt', new BoxGeometry(7, 0.05, 6), { m: kit.matrix(S.x, sy + 0.04, S.z), color: [0.05, 0.045, 0.04], uv: 'keep', ao: false });
  }
  skit.finish(spGroup);
  rkit.finish(ruinGroup);
  const strongpoint = {
    group: spGroup, ruin: ruinGroup, owner: nestOwner, collider: bunkerCol, slit: new Vector3(S.x, sy + 1.6, S.z + BD / 2 + 0.2), pos: new Vector3(S.x, sy + 1.2, S.z),
    collapse() {
      spGroup.visible = false; ruinGroup.visible = true;
      world.removeCollider(bunkerCol);
      world.addCircle(S.x, S.z, 3.6, { height: 1.8, y0: sy - 1, tag: 'rubble', cls: 'climb', top: 1.1 });
      world.smokeAnchors.push({ pos: new Vector3(S.x, sy + 1.6, S.z), flame: true, strength: 1 });
    },
  };
  exclusions.push({ x: S.x, z: S.z, r: 46 });
  // keep an open firing lane from the village-edge road to the strongpoint (and its approach field) free of trees/rocks
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    exclusions.push({ x: -55 + (S.x + 55) * t, z: -498 + (S.z + 498) * t - 4 * Math.sin(t * 3), r: 9 });
  }
  for (let k = 0; k <= 8; k++) exclusions.push({ x: -45 + 12 * k * 0.3, z: -460 - 5 * k, r: 8 });

  // trench: revetment panels both sides, duckboards on the floor, sandbag parapet on the south berm
  {
    const t = terrain.trench;
    for (let i = 0; i < t.length - 1; i++) {
      const ax = t[i][0], az = t[i][1], bx = t[i + 1][0], bz = t[i + 1][1];
      const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, floor = gy(mx, mz);
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      if (nz < 0) { nx = -nx; nz = -nz; }
      for (const s of [-1, 1]) {
        const cx = mx + nx * 1.55 * s, cz = mz + nz * 1.55 * s;
        kit.add('timber', new BoxGeometry(0.1, 1.5, len + 0.15), { m: kit.matrix(cx, floor + 0.62, cz, ang), color: jitterColor(pick(PAL.timber), rnd, 0.1), y0: floor });
        for (let k = 0; k <= Math.round(len / 2); k++) {
          const u = -len / 2 + (k / Math.round(len / 2)) * len;
          kit.add('timber', new BoxGeometry(0.14, 1.7, 0.14), { m: kit.matrix(cx - nx * 0.1 * s + Math.sin(ang) * u, floor + 0.7, cz - nz * 0.1 * s + Math.cos(ang) * u, ang), color: PAL.timber[2], y0: floor, ao: false });
        }
      }
      kit.add('timber', new BoxGeometry(2.3, 0.05, len), { m: kit.matrix(mx, floor + 0.05, mz, ang), color: pick(PAL.timber), y0: floor });
      sandbagWall(ax + nx * 2.35, az + nz * 2.35, bx + nx * 2.35, bz + nz * 2.35, 3, 1);
    }
  }

  // concertina wire along the front of the trench (instanced helices) + angle-iron pickets
  {
    const L = 8;
    const geo = new TubeGeometry(new Helix(L, 0.45, 0.22), 220, 0.014, 3, false);
    const mat = patchMaterial(new MeshStandardMaterial({ color: 0x3a3631, metalness: 0.6, roughness: 0.5 }));
    const coils = [];
    for (let k = 0; k < 6; k++) coils.push([S.x - 32 + k * 8.2, S.z + 38 + (rnd() - 0.5) * 2, 0.04 * k, 0]);
    for (let k = 0; k < 5; k++) coils.push([S.x - 28 + k * 8.2, S.z + 39, 0, 0.7]);
    const mesh = new InstancedMesh(geo, mat, coils.length);
    coils.forEach((c, i) => {
      const x = c[0], z = c[1];
      mesh.setMatrixAt(i, kit.matrix(x, gy(x + 4, z) + 0.02 + c[3], z, c[2] + (rnd() - 0.5) * 0.04));
    });
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    group.add(mesh);
    for (let x = S.x - 32; x < S.x + 20; x += 3) kit.add('interior', new BoxGeometry(0.05, 1.3, 0.05), { m: kit.matrix(x, gy(x, S.z + 38) + 0.55, S.z + 38 + (rnd() - 0.5) * 0.1), color: [0.03, 0.03, 0.028], uv: 'keep', ao: false });
    // checkpoint wire (2 coils)
  }

  // supplies: crates, fuel drums, pallets (olive/rust vertex colours on the 'trim' bucket)
  {
    const olive = [hexLin('#4f5236'), hexLin('#5b5e46'), hexLin('#4c5233')];
    const rust = [hexLin('#6b4a2a'), hexLin('#4a4d34'), hexLin('#5a4630')];
    const drums = [], crates = [];
    for (let i = 0; i < 34; i++) {
      const a = rnd() * 6.283, d = 6 + rnd() * 14, x = S.x + Math.cos(a) * d, z = S.z + Math.sin(a) * d * 0.8 - 2;
      if (Math.abs(x - S.x) < BW / 2 + 1.5 && Math.abs(z - S.z) < BD / 2 + 1.5) continue;
      const y = gy(x, z);
      if (i % 3 === 0) drums.push({ x, y, z, col: pick(rust) });
      else if (i % 3 === 1) crates.push({ x, y, z, ry: rnd() * 3, col: pick(olive), stack: rnd() < 0.5, col2: pick(olive) });
      else kit.add('timber', new BoxGeometry(1.2, 0.14, 0.8), { m: kit.matrix(x, y + 0.07, z, rnd() * 3), color: pick(PAL.timber), y0: y });
    }
    // drums and crates are separate instances so they can be knocked over
    const supMat = patchMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 }));
    const col = new Color();
    const dm = new InstancedMesh(new CylinderGeometry(0.29, 0.29, 0.88, 12), supMat, Math.max(1, drums.length));
    drums.forEach((o, i) => { dm.setMatrixAt(i, kit.matrix(o.x, o.y + 0.44, o.z)); col.setRGB(o.col[0], o.col[1], o.col[2]); dm.setColorAt(i, col); });
    const cm = new InstancedMesh(new BoxGeometry(0.8, 0.4, 0.3), supMat, Math.max(1, crates.length * 2));
    let ci = 0;
    const crateIdx = crates.map((o) => {
      const i0 = ci++;
      cm.setMatrixAt(i0, kit.matrix(o.x, o.y + 0.2, o.z, o.ry)); col.setRGB(o.col[0], o.col[1], o.col[2]); cm.setColorAt(i0, col);
      let i1 = -1;
      if (o.stack) { i1 = ci++; cm.setMatrixAt(i1, kit.matrix(o.x, o.y + 0.6, o.z, o.ry)); col.setRGB(o.col2[0], o.col2[1], o.col2[2]); cm.setColorAt(i1, col); }
      return [i0, i1];
    });
    dm.count = drums.length; cm.count = ci;
    for (const m of [dm, cm]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
    drums.forEach((o, i) => world.crush.circle(o.x, o.z, 0.32, [{ mesh: dm, index: i }], { y: o.y, height: 0.9, minSpeed: 0.3, slow: 0.95, jolt: 0.02, shove: 1.5, maxAng: 1.5, fx: 'dust', fx2: 'none', tag: 'prop', noRay: true }));
    crates.forEach((o, i) => {
      const rigs = [{ mesh: cm, index: crateIdx[i][0] }];
      if (crateIdx[i][1] >= 0) rigs.push({ mesh: cm, index: crateIdx[i][1] });
      world.crush.circle(o.x, o.z, 0.5, rigs, { y: o.y, height: o.stack ? 0.8 : 0.4, minSpeed: 0.3, slow: 0.95, jolt: 0.02, shove: 1.0, maxAng: 1.5, fx: 'dust', fx2: 'none', tag: 'prop', noRay: true });
    });
    world.addBox(S.x + 9, S.z - 4, 1.6, 1.2, 0.4, { height: 1.2, tag: 'prop', cls: 'climb', top: 0.8 });
  }

  // =============== CHECKPOINT (paved village entry) ===============
  {
    const rp = terrain.roadPoints;
    let idx = rp.findIndex((p) => p.z < -527);
    if (idx < 1) idx = 1;
    const p = rp[idx], q = rp[idx + 2];
    const ang = Math.atan2(q.x - p.x, q.z - p.z);
    const fwd = [Math.sin(ang), Math.cos(ang)], right = [Math.cos(ang), -Math.sin(ang)];
    const at = (f, r) => [p.x + fwd[0] * f + right[0] * r, p.z + fwd[1] * f + right[1] * r];
    // F-profile jersey barriers, staggered along both edges (a 5 m driving lane stays open)
    const sh = new Shape();
    [[-0.4, 0], [0.4, 0], [0.4, 0.15], [0.22, 0.55], [0.12, 0.8], [-0.12, 0.8], [-0.22, 0.55], [-0.4, 0.15]].forEach((v, i) => (i ? sh.lineTo(v[0], v[1]) : sh.moveTo(v[0], v[1])));
    const jb = new ExtrudeGeometry(sh, { depth: 3, bevelEnabled: false });
    jb.translate(0, 0, -1.5);
    const jersey = [[-12, 3.0], [-8, -3.1], [-4, 3.1], [0, -3.0], [4, 3.0], [8, -3.1]];
    for (const [f, r] of jersey) {
      const [x, z] = at(f * 0.5, r);
      kit.add('concrete', jb, { m: kit.matrix(x, gy(x, z), z, ang), color: PAL.concrete, y0: gy(x, z) });
      world.addBox(x, z, 0.42, 1.5, ang, { height: 0.8, y0: gy(x, z) - 1.5, tag: 'barrier' });
    }
    // boom gate (open) with red/white bands, post and counterweight
    const [gx, gz] = at(2, -4.8);
    const gyy = gy(gx, gz);
    const gg = new Group(); gg.position.set(gx, gyy, gz); group.add(gg);
    const gk = new Kit(env.mats);
    gk.add('trim', new BoxGeometry(0.25, 1.1, 0.25), { m: gk.matrix(0, 0.55, 0, ang), color: [0.3, 0.3, 0.3], uv: 'keep', ao: false });
    gk.add('trim', new BoxGeometry(0.3, 0.3, 0.5), { m: gk.matrix(0, 1.2, 0, ang), color: [0.2, 0.2, 0.2], uv: 'keep', ao: false });
    for (let i = 0; i < 12; i++) {
      const u = 0.5 * i + 0.25;
      gk.add('trim', new BoxGeometry(0.5, 0.1, 0.1), { m: gk.matrix(0, 1.2, 0, ang, 0, (70 * Math.PI) / 180).multiply(new Matrix4().makeTranslation(u, 0, 0)), color: i % 2 ? hexLin('#c9c4b6') : hexLin('#9a1c15'), uv: 'keep', ao: false });
    }
    gk.finish(gg);
    world.crush.circle(gx, gz, 0.5, [{ obj: gg }], { y: gyy, height: 3, minSpeed: 0.5, slow: 0.95, jolt: 0.02, maxAng: 1.5, fx: 'dust', fx2: 'thud', tag: 'boomgate', noRay: true });
    // guard hut
    const [hx, hz] = at(-1, 6.0), hy = gy(hx, hz);
    const hutG = new Group(); group.add(hutG);
    const hk = new Kit(env.mats);
    hk.add('plaster', new BoxGeometry(2.6, 2.6, 2.6), { m: kit.matrix(hx, hy + 1.3, hz, ang), color: hexLin('#9a988f'), y0: hy });
    hk.add('concrete', new BoxGeometry(3.0, 0.15, 3.0), { m: kit.matrix(hx, hy + 2.65, hz, ang), color: PAL.concrete, y0: hy });
    hk.add('glass', new BoxGeometry(0.05, 0.8, 1.2), { m: kit.matrix(hx, hy + 1.6, hz, ang).multiply(new Matrix4().makeTranslation(-1.31, 0, 0)), color: PAL.glass, uv: 'keep', ao: false });
    hk.finish(hutG);
    const hutSq = world.crush.squash(hutG, hx, hz, hy, 0.2);
    world.addBox(hx, hz, 1.4, 1.4, ang, {
      height: 3, y0: hy - 1, tag: 'lightbuilding', cls: 'crush', minSpeed: 2.0, slow: 0.6, jolt: 0.08,
      onCrush: (c, dx, dz, sp) => { hutSq(c, dx, dz, sp); world.addBox(hx, hz, 1.4, 1.4, ang, { height: 0.9, y0: hy - 1, tag: 'rubble', cls: 'climb', top: 0.6 }); },
    });
    world.buildings.push({ x: hx, z: hz, hx: 1.4, hz: 1.4, heading: ang });
    const sb0 = at(-2.8, 4.7), sb1 = at(0.8, 4.7);
    sandbagWall(sb0[0], sb0[1], sb1[0], sb1[1], 5, 2);
    // stop sign
    const [px, pz] = at(-3, -4.6), py = gy(px, pz);
    kit.add('interior', new CylinderGeometry(0.04, 0.04, 2.2, 6), { m: kit.matrix(px, py + 1.1, pz), color: [0.1, 0.1, 0.1], uv: 'keep', ao: false });
    const sign = new Mesh(new PlaneGeometry(1.2, 0.9), patchMaterial(new MeshStandardMaterial({ map: makeSignTexture(), side: DoubleSide, roughness: 0.6 })));
    sign.position.set(px, py + 2.0, pz); sign.rotation.y = ang + Math.PI; sign.castShadow = true;
    sign.updateMatrix(); sign.matrixAutoUpdate = false;
    group.add(sign);
    camoNet(...at(-1, 8.5), 7, 6, ang, hy + 3.6);
    exclusions.push({ x: p.x, z: p.z, r: 14 });
    world.landmarks.checkpoint = { x: p.x, z: p.z };
  }

  // =============== WRECKS ===============
  function tankWreck(x, z, heading, burning, askew) {
    const model = new TankModel('enemy');
    burnModel(model);
    if (askew) { model.setYawPitch((rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.5), (rnd() < 0.5 ? -0.14 : 0.24)); }
    else model.setYawPitch((rnd() - 0.5) * 1.2, -0.1);
    // sit on the terrain with a slope-following pose plus extra wrecked tilt
    const c = Math.cos(heading), s = Math.sin(heading);
    const hF = (gy(x + s * 3, z + c * 3) + gy(x + s * 3 + c * 1.6, z + c * 3 - s * 1.6)) / 2, hR = (gy(x - s * 3, z - c * 3) + gy(x - s * 3 - c * 1.6, z - c * 3 + s * 1.6)) / 2;
    const hL = gy(x + c * 1.6, z - s * 1.6), hRg = gy(x - c * 1.6, z + s * 1.6);
    const y = (hF + hR + hL + hRg) / 4;
    model.root.rotation.order = 'YXZ';
    model.root.position.set(x, y - 0.15, z);
    model.root.rotation.set(-Math.atan((hF - hR) / 6) + (rnd() - 0.5) * 0.12, heading, Math.atan((hL - hRg) / 3.2) + (0.05 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1));
    model.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model.root.updateMatrixWorld(true);
    model.root.traverse((o) => { o.matrixAutoUpdate = false; });
    group.add(model.root);
    world.addBox(x, z, 1.85, 3.55, heading, { height: 2.8, y0: y - 1.5, tag: 'wreck' });
    world.buildings.push({ x, z, hx: 1.8, hz: 3.5, heading });
    scorch(x, z, 12);
    world.smokeAnchors.push({ pos: new Vector3(x - s * 2.2, y + 1.9, z - c * 2.2), flame: burning, strength: 1.0, model });
    exclusions.push({ x, z, r: 8 });
    return model;
  }
  tankWreck(-24, -514, 0.7, true, false);
  tankWreck(86, -503, -2.4, true, true);

  // truck wreck beside the road (boxes + empty window openings), tilted into the ditch
  {
    const x = -75, z = -498, ang = 0.2, y = gy(x, z);
    const bc = PAL.burnt;
    const tilt = 0.14;
    const M = (px, py, pz, ry = 0) => kit.matrix(x, y - 0.1, z, ang, tilt, 0.1).multiply(kit.matrix(px, py, pz, ry));
    kit.add('burnt', new BoxGeometry(0.9, 0.3, 6), { m: M(0, 0.75, 0), color: bc[0], uv: 'wall', y0: y });
    kit.add('burnt', new BoxGeometry(2.0, 0.12, 3.4), { m: M(0, 1.0, -1.2), color: bc[1], uv: 'wall', y0: y });
    for (let i = 0; i < 4; i++) kit.add('burnt', new BoxGeometry(0.06, 1.2, 0.06), { m: M(-0.95 + (i % 2) * 1.9, 1.6, -2.4 + Math.floor(i / 2) * 2.2), color: bc[0], uv: 'wall', y0: y, ao: false });
    // cab with window openings
    const cab = wallGeometry(2.0, 2.2, 0.08, { holes: [{ x: 1.0, y: 1.2, w: 1.5, h: 0.8 }], drop: 0 });
    kit.add('burnt', new BoxGeometry(2.0, 2.0, 2.0), { m: M(0, 1.95, 2.0), color: bc[1], uv: 'wall', y0: y });
    kit.add('burnt', cab, { m: M(-1.0, 0.95, 3.02), color: [0.35, 0.18, 0.1], uv: 'wall', y0: y });
    kit.add('interior', new BoxGeometry(1.6, 0.7, 0.1), { m: M(0, 2.5, 3.0), color: PAL.interior, uv: 'keep', ao: false });
    for (const [wx, wz] of [[-0.95, 2.2], [0.95, 2.2], [-0.95, -1.9], [0.95, -1.9]]) {
      const wg = new CylinderGeometry(0.5, 0.5, 0.3, 14); wg.rotateZ(Math.PI / 2);
      kit.add('burnt', wg, { m: M(wx, 0.5, wz), color: [0.04, 0.04, 0.04], uv: 'keep', ao: false });
    }
    world.addBox(x, z, 1.2, 3.2, ang, { height: 3, y0: y - 1.5, tag: 'wreck' });
    world.buildings.push({ x, z, hx: 1.2, hz: 3.2, heading: ang });
    scorch(x, z, 9);
    world.smokeAnchors.push({ pos: new Vector3(x, y + 2.4, z + 1.5), flame: false, strength: 0.9 });
    exclusions.push({ x, z, r: 7 });
  }

  finishSandbags();
  return { group, exclusions, strongpoint };
}
