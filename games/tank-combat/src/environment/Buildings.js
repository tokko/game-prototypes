// Settlements: village (stone/plaster houses with tile/slate roofs, real window openings, damaged variants),
// church, farm (red barn, farmhouse, sheds, hay bales), dry-stone walls, fences, paved village road, lamps, poles.
// All static geometry is merged per material (BuildingKit); big objects register colliders in the World.
import {
  Group, Mesh, MeshStandardMaterial, BoxGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, SphereGeometry,
  Matrix4, Vector3, InstancedMesh, BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial, Color,
  InstancedBufferAttribute,
} from 'three';
import { Simplex2, mulberry32 } from '../util/noise.js';
import { clamp, smoothstep, lerp } from '../util/math.js';
import { Kit, createMaterials, wallGeometry, roofSlabGeometry, jitterColor, PAL, hexLin } from './BuildingKit.js';
import { makeAsphalt, makeCobble } from './ProcTextures.js';
import { patchMaterial } from './Atmosphere.js';

const T = 0.45; // wall thickness

export function buildSettlements(world, terrain) {
  const group = new Group();
  group.name = 'settlements';
  const rnd = mulberry32(4242), noise = new Simplex2(4243);
  const mats = createMaterials();
  let kit = new Kit(mats); // `kit` is swapped for a private one while a light (crushable) building is built
  const baseKit = kit;
  const footprints = [];
  world.buildings = [];
  world.smokeAnchors = world.smokeAnchors || [];
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const groundMax = (x, z, hw, hd, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let m = -1e9;
    for (const [lx, lz] of [[0, 0], [hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) m = Math.max(m, terrain.getHeight(x + lx * c + lz * s, z - lx * s + lz * c));
    return m;
  };

  // ---- wall helpers ----
  const jagged = (len, h, loss, cornerLoss, cornerSide) => {
    const pts = [], n = Math.max(3, Math.round(len / 0.7));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let y = h - loss * rnd() - cornerLoss * (1 - smoothstep(0, 0.5, cornerSide > 0 ? t : 1 - t));
      y = Math.max(1.2, Math.round(y * 2) / 2 + (rnd() - 0.5) * 0.2);
      pts.push([t * len, y]);
    }
    return pts;
  };

  const windowLayout = (W, floors, floorH, sill0, doorX, ww = 1.0, wh = 1.4) => {
    const out = [], n = Math.max(1, Math.floor((W - 1.6) / 2.2) + 1);
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < n; i++) {
        const x = W / 2 + (i - (n - 1) / 2) * 2.2;
        if (f === 0 && doorX !== null && Math.abs(x - doorX) < 1.5) continue;
        out.push({ x, y: sill0 + f * floorH, w: ww, h: wh });
      }
    }
    return out;
  };

  // window / door furniture in the wall's local frame (wm = world matrix of the wall panel)
  const windowUnit = (wm, o, shutters, damaged, y0) => {
    const L = (x, y, z) => wm.clone().multiply(new Matrix4().makeTranslation(x, y, z));
    const frame = PAL.trim;
    if (!damaged || rnd() < 0.3) {
      kit.add('glass', new PlaneGeometry(o.w - 0.1, o.h - 0.1), { m: L(o.x, o.y + o.h / 2, T - 0.15), color: PAL.glass, uv: 'keep', ao: false });
    }
    const fr = (w, h, x, y) => kit.add('trim', new BoxGeometry(w, h, 0.07), { m: L(x, y, T - 0.1), color: frame, uv: 'keep', ao: false });
    fr(o.w, 0.07, o.x, o.y + 0.035); fr(o.w, 0.07, o.x, o.y + o.h - 0.035);
    fr(0.07, o.h, o.x - o.w / 2 + 0.035, o.y + o.h / 2); fr(0.07, o.h, o.x + o.w / 2 - 0.035, o.y + o.h / 2);
    fr(0.05, o.h, o.x, o.y + o.h / 2); fr(o.w, 0.05, o.x, o.y + o.h * 0.62);
    kit.add('stone', new BoxGeometry(o.w + 0.2, 0.08, 0.2), { m: L(o.x, o.y - 0.04, T + 0.06), color: [0.8, 0.78, 0.74], y0 });
    if (shutters) {
      const col = pick(PAL.shutter);
      for (const s of [-1, 1]) {
        kit.add('timber', new BoxGeometry(o.w * 0.5, o.h, 0.05), { m: L(o.x + s * (o.w / 2 + o.w * 0.27), o.y + o.h / 2, T + 0.03), color: col, y0, ao: false });
      }
    }
  };
  const doorUnit = (wm, x, y0) => {
    const L = (px, py, pz) => wm.clone().multiply(new Matrix4().makeTranslation(px, py, pz));
    kit.add('timber', new BoxGeometry(1.0, 2.1, 0.08), { m: L(x, 1.05, T - 0.2), color: [0.1, 0.07, 0.05], y0, ao: false });
    kit.add('stone', new BoxGeometry(0.15, 2.35, 0.15), { m: L(x - 0.65, 1.17, T + 0.07), color: [0.8, 0.78, 0.74], y0 });
    kit.add('stone', new BoxGeometry(0.15, 2.35, 0.15), { m: L(x + 0.65, 1.17, T + 0.07), color: [0.8, 0.78, 0.74], y0 });
    kit.add('stone', new BoxGeometry(1.45, 0.15, 0.15), { m: L(x, 2.3, T + 0.07), color: [0.8, 0.78, 0.74], y0 });
  };

  const soot = (wm, o, y0) => {
    // soot plume above a window opening (narrow at the top)
    const g = new BufferGeometry();
    const w0 = o.w * 0.5 + 0.1, w1 = o.w * 0.9, hh = 2.4;
    const v = [o.x - w0, o.y + o.h, 0.02, o.x + w0, o.y + o.h, 0.02, o.x + w1, o.y + o.h + hh, 0.02, o.x - w1, o.y + o.h + hh, 0.02];
    g.setAttribute('position', new Float32BufferAttribute(v, 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    kit.add('burnt', g, { m: wm.clone().multiply(new Matrix4().makeTranslation(0, 0, T + 0.02)), color: [0.18, 0.16, 0.15], uv: 'keep', ao: false });
  };

  // four walls of a rectangular box footprint around (cx, cz) in the building frame B.
  // sides: { front, back, left, right } each { h, topPts?, holes?, key, color, windows?: [..], door?: x, shutters, damaged, soot }
  const walls = (B, cx, cz, w, d, sides, y0, eaveY) => {
    const Lg = d - 2 * T;
    const defs = {
      front: { len: w, m: new Matrix4().makeTranslation(cx - w / 2, 0, cz + d / 2 - T) },
      back: { len: w, m: new Matrix4().makeRotationY(Math.PI).setPosition(cx + w / 2, 0, cz - d / 2 + T) },
      left: { len: Lg, m: new Matrix4().makeRotationY(-Math.PI / 2).setPosition(cx - w / 2 + T, 0, cz - Lg / 2) },
      right: { len: Lg, m: new Matrix4().makeRotationY(Math.PI / 2).setPosition(cx + w / 2 - T, 0, cz + Lg / 2) },
    };
    for (const name of ['front', 'back', 'left', 'right']) {
      const s = sides[name];
      if (!s) continue;
      const holes = [...(s.holes || [])];
      for (const o of s.windows || []) holes.push(o.arch ? o : { x: o.x, y: o.y, w: o.w, h: o.h });
      if (s.door !== undefined && s.door !== null) holes.push({ x: s.door, y: 0, w: 1.1, h: 2.2 });
      const geo = wallGeometry(defs[name].len, s.h, T, { topPts: s.topPts, holes });
      const wm = B.clone().multiply(defs[name].m);
      kit.add(s.key, geo, { m: wm, color: s.color, y0, eaveY: y0 + eaveY });
      for (const o of s.windows || []) {
        if (o.arch) { kit.add('glass', new PlaneGeometry(o.w - 0.1, o.h - 0.1), { m: wm.clone().multiply(new Matrix4().makeTranslation(o.x, o.y + o.h / 2, T - 0.15)), color: PAL.glass, uv: 'keep', ao: false }); continue; }
        windowUnit(wm, o, s.shutters, s.damaged, y0);
        if (s.soot) soot(wm, o, y0);
      }
      if (s.door !== undefined && s.door !== null && !s.noDoorUnit) doorUnit(wm, s.door, y0);
    }
  };

  // ---------- generic gabled building ----------
  function building(spec) {
    const light = spec.light || 0; // min speed (m/s) at which a tank collapses this light wooden structure
    const prevKit = kit;
    if (light) kit = new Kit(mats);
    const { x, z, yaw = 0, w, d, wallH, pitch = 42, wallKey = 'plaster', roofKey = 'tile', floors = 2, shutters = false, damage = null } = spec;
    const y0 = groundMax(x, z, w / 2, d / 2, yaw) - 0.2;
    const B = kit.matrix(x, y0, z, yaw);
    const wallCol = spec.wallColor || (wallKey === 'stone' ? jitterColor([1, 1, 1], rnd, 0.08) : jitterColor(pick(PAL[wallKey] || PAL.plaster), rnd));
    const tanp = Math.tan((pitch * Math.PI) / 180), rise = (d / 2) * tanp;
    const burnt = damage === 'burnt', collapsed = damage === 'collapsed', holesDmg = damage === 'holes';
    const Lg = d - 2 * T;
    const doorX = spec.doorOn === 'gable' ? null : w / 2 + (spec.doorOffset || 0);
    const floorH = wallH / floors;
    const wins = windowLayout(w, floors, Math.min(3.0, floorH), 0.9, doorX, 1.0, 1.4);
    const backWins = windowLayout(w, floors, Math.min(3.0, floorH), 0.9, null, 1.0, 1.4);
    const gableWins = [];
    for (let f = 0; f < floors; f++) gableWins.push({ x: Lg / 2, y: 0.9 + f * Math.min(3.0, floorH), w: 0.8, h: 1.1 });
    const front = { h: wallH, key: wallKey, color: wallCol, windows: wins, door: doorX, shutters, damaged: burnt || collapsed || holesDmg };
    const back = { h: wallH, key: wallKey, color: wallCol, windows: backWins, shutters, damaged: burnt || collapsed };
    const gtop = [[0, wallH], [Lg / 2, wallH + rise - 0.2], [Lg, wallH]];
    const left = { h: wallH, key: wallKey, color: wallCol, topPts: gtop, windows: spec.gableWindows === false ? [] : gableWins, damaged: burnt };
    const right = { h: wallH, key: wallKey, color: wallCol, topPts: gtop, windows: spec.gableWindows === false ? [] : gableWins, damaged: burnt };
    if (spec.gableDoor) { right.windows = []; right.holes = [{ x: Lg / 2, y: 0, w: 4, h: 4 }]; right.doorUnit = true; }
    if (burnt) {
      front.topPts = jagged(w, wallH, 1.5, 0, 1); back.topPts = jagged(w, wallH, 1.5, 0, 1);
      left.topPts = jagged(Lg, wallH + 0.5, 2.5, 0, 1).map((p, i, a) => [p[0], Math.min(p[1], wallH + rise * (1 - Math.abs(p[0] / Lg * 2 - 1)))]);
      right.topPts = left.topPts;
      front.soot = back.soot = true;
    }
    if (collapsed) {
      front.topPts = jagged(w, wallH, 0.6, 4.5, 1);
      front.windows = wins.filter((o) => o.x < w * 0.55);
      right.topPts = jagged(Lg, wallH, 0.8, 3.5, 1).map((p) => [p[0], Math.min(p[1], wallH + rise * (1 - Math.abs(p[0] / Lg * 2 - 1)))]);
    }
    if (holesDmg) {
      front.holes = [];
      for (let k = 0; k < 2; k++) {
        const r = 0.5 + rnd() * 0.6, hx = w * (0.2 + 0.6 * rnd()), hy = wallH * (0.45 + 0.3 * rnd());
        if (wins.some((o) => Math.abs(o.x - hx) < o.w / 2 + r + 0.3 && Math.abs(o.y + 0.7 - hy) < r + 1.0) || Math.abs(hx - doorX) < r + 1.0) continue;
        const poly = [];
        for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283, rr = r * (0.8 + rnd() * 0.4); poly.push([hx + Math.cos(a) * rr, hy + Math.sin(a) * rr]); }
        front.holes.push({ poly });
      }
    }
    walls(B, 0, 0, w, d, { front, back, left, right }, y0, wallH);
    if (spec.gableDoor) { // closed double barn door with X bracing, set inside the gable opening
      const gm = B.clone().multiply(new Matrix4().makeRotationY(Math.PI / 2).setPosition(w / 2 - T, 0, Lg / 2));
      const L = (px, py, pz, ry = 0, rz = 0) => gm.clone().multiply(kit.matrix(px, py, pz, ry, 0, rz));
      kit.add('barn', new BoxGeometry(4, 4, 0.1), { m: L(Lg / 2, 2, T - 0.25), color: [0.8, 0.75, 0.7], y0, ao: false });
      for (const s of [-1, 1]) kit.add('trim', new BoxGeometry(0.15, 4.8, 0.06), { m: L(Lg / 2, 2, T - 0.18, 0, s * 0.8), color: PAL.trim, uv: 'keep', ao: false });
      kit.add('trim', new BoxGeometry(0.15, 4, 0.06), { m: L(Lg / 2, 2, T - 0.18), color: PAL.trim, uv: 'keep', ao: false });
      // white corner trim boards
      for (const sx of [-1, 1]) kit.add('trim', new BoxGeometry(0.15, wallH + 0.2, 0.15), { m: B.clone().multiply(kit.matrix(sx * (w / 2 + 0.02), (wallH) / 2, d / 2 + 0.02)), color: PAL.trim, uv: 'keep', ao: false });
    }

    // interior darkness behind openings
    if (!burnt) kit.add('interior', new BoxGeometry(w - 2 * T - 0.05, wallH, d - 2 * T - 0.05), { m: B.clone().multiply(new Matrix4().makeTranslation(0, wallH / 2, 0)), color: PAL.interior, uv: 'keep', ao: false });
    else {
      // charred beams across the open shell
      for (let i = 0; i < 5; i++) kit.box('burnt', 0.2, 0.25, d - 1.5, -w / 2 + 1.2 + i * (w - 2.4) / 4, wallH * 0.6 - (rnd() * 0.8), 0, 0, pick(PAL.burnt), { uv: 'keep', m: B.clone().multiply(kit.matrix(-w / 2 + 1.2 + i * (w - 2.4) / 4, wallH * 0.55 - rnd() * 0.8, 0, 0, rnd() * 0.2, rnd() * 0.2)) });
    }

    // roof
    if (!burnt) {
      const ov = 0.45, thick = 0.14;
      const run = (d / 2 + ov) / Math.cos((pitch * Math.PI) / 180);
      const ridgeY = wallH + rise, eaveY = ridgeY - (d / 2 + ov) * tanp;
      const roofCol = jitterColor(spec.roofColor || pick(PAL[roofKey] || PAL.tile), rnd, 0.05);
      for (const side of [-1, 1]) {
        if (collapsed && side === 1) continue;
        const g = roofSlabGeometry(w + 0.6, run, thick, noise, x * 0.01 + side, 0.05);
        const m = B.clone().multiply(kit.matrix(0, (ridgeY + eaveY) / 2 + 0.05, side * (d / 2 + ov) / 2, 0, side * (pitch * Math.PI) / 180));
        kit.add(roofKey, g, { m, color: roofCol, uv: 'keep', ao: false });
      }
      // ridge cap
      const cap = new CylinderGeometry(0.12, 0.12, w + 0.6, 8);
      cap.rotateZ(Math.PI / 2);
      kit.add(roofKey === 'metal' ? 'metal' : roofKey, cap, { m: B.clone().multiply(new Matrix4().makeTranslation(0, ridgeY + 0.08, 0)), color: roofCol.map((v) => v * 0.8), uv: 'keep', ao: false });
      if (spec.chimney !== false) {
        const ch = (rise + 1.3);
        kit.add('stone', new BoxGeometry(0.6, ch, 0.6), { m: B.clone().multiply(new Matrix4().makeTranslation(w * 0.28, wallH + ch / 2 - 0.3, -d * 0.1)), color: jitterColor([0.85, 0.8, 0.75], rnd), y0: y0 + wallH });
        kit.add('stone', new BoxGeometry(0.8, 0.12, 0.8), { m: B.clone().multiply(new Matrix4().makeTranslation(w * 0.28, wallH + ch - 0.3, -d * 0.1)), color: [0.5, 0.48, 0.45], y0: y0 + wallH });
      }
    }

    // collider + minimap + footprint
    const hx = w / 2 + 0.25, hz = d / 2 + 0.25;
    if (light) {
      const lg = new Group(); lg.name = 'lightBuilding';
      kit.finish(lg); group.add(lg);
      kit = prevKit;
      const sq = world.crush.squash(lg, x, z, y0, 0.15);
      world.addBox(x, z, hx, hz, yaw, {
        height: wallH + rise + 1, y0: y0 - 1, tag: 'lightbuilding', cls: 'crush', minSpeed: light, slow: 0.5, jolt: 0.1,
        onCrush: (c, dx, dz, sp) => { sq(c, dx, dz, sp); world.addBox(x, z, hx, hz, yaw, { height: 1.2, y0: y0 - 1, tag: 'rubble', cls: 'climb', top: 1.0 }); },
      });
    } else world.addBox(x, z, hx, hz, yaw, { height: wallH + rise + 1, y0: y0 - 1, tag: 'building' });
    world.buildings.push({ x, z, hx, hz, heading: yaw });
    footprints.push({ x, z, r: Math.hypot(hx, hz) + 1, garden: spec.garden });
    if (burnt) world.smokeAnchors.push({ pos: new Vector3(x, y0 + wallH * 0.7, z), flame: false, strength: 0.8 });
    return { x, z, y0, B };
  }

  // ---------- rubble mound ----------
  function rubble(x, z, r) {
    const y = terrain.getHeight(x, z);
    const g = new SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 + noise.noise(p.getX(i) * 0.7 + x, p.getZ(i) * 0.7 + z) * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.45, p.getZ(i) * k); }
    g.computeVertexNormals();
    kit.add('rubble', g, { m: kit.matrix(x, y - 0.1, z), color: [0.7, 0.66, 0.6], y0: y, ao: false });
    const pal = [...PAL.stone, ...PAL.plaster, ...PAL.brick, ...PAL.tile];
    for (let i = 0; i < 50; i++) {
      const a = rnd() * 6.283, dd = Math.sqrt(rnd()) * r, s = 0.15 + rnd() * 0.45;
      const cx = x + Math.cos(a) * dd, cz = z + Math.sin(a) * dd;
      const cy = terrain.getHeight(cx, cz) + (1 - dd / r) * r * 0.38;
      kit.add('rubble', new BoxGeometry(s, s * 0.7, s * 1.2), { m: kit.matrix(cx, cy, cz, rnd() * 6.28, rnd() * 0.8, rnd() * 0.8), color: jitterColor(pick(pal), rnd, 0.1), y0: y, ao: false });
    }
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.283, dd = rnd() * r * 0.7, cx = x + Math.cos(a) * dd, cz = z + Math.sin(a) * dd;
      kit.add('timber', new BoxGeometry(0.16, 0.2, 2 + rnd() * 2), { m: kit.matrix(cx, terrain.getHeight(cx, cz) + 0.5, cz, rnd() * 6.28, (20 + rnd() * 30) * Math.PI / 180), color: PAL.burnt[1], y0: y, uv: 'keep', ao: false });
    }
    world.addCircle(x, z, r * 0.8, { height: 1.4, tag: 'rubble', cls: 'climb', top: 1.0 });
    footprints.push({ x, z, r: r + 1 });
  }

  // ================= VILLAGE LAYOUT (street runs N-S along x ~ -60) =================
  const v = terrain.village;
  const sx = v.x;
  const stoneHouse = (o) => building(Object.assign({ w: 9 + rnd() * 1.6, d: 7 + rnd(), wallH: 6, floors: 2, wallKey: 'stone', pitch: 42, roofKey: rnd() < 0.6 ? 'slate' : 'tile', garden: true }, o));
  const plasterHouse = (o) => building(Object.assign({ w: 10, d: 7, wallH: 4.2, floors: 2, wallKey: 'plaster', pitch: 45, roofKey: 'tile', shutters: rnd() < 0.5, garden: true, doorOffset: (rnd() - 0.5) * 2 }, o));
  const E = -Math.PI / 2, Wd = Math.PI / 2; // yaw so that the façade faces west / east

  // street fronts: west side faces east (yaw +90), east side faces west (yaw -90)
  stoneHouse({ x: sx - 15, z: -535, yaw: Wd });
  plasterHouse({ x: sx + 15, z: -533, yaw: E });
  plasterHouse({ x: sx - 15, z: -557, yaw: Wd });
  stoneHouse({ x: sx + 15, z: -556, yaw: E, damage: 'holes' });
  // townhouse rows around the little square (z ~ -585)
  for (let i = 0; i < 3; i++) {
    building({ x: sx - 16.5, z: -574 - i * 7.1, yaw: Wd, w: 7, d: 10, wallH: 9, floors: 3, wallKey: i === 1 ? 'plaster' : 'stone', wallColor: i === 1 ? PAL.brick[0] : undefined, pitch: 38, roofKey: 'tile', chimney: i !== 1, garden: false, gableWindows: false });
    building({ x: sx + 16.5, z: -574 - i * 7.1, yaw: E, w: 7, d: 10, wallH: 9, floors: 3, wallKey: i === 2 ? 'plaster' : 'stone', wallColor: i === 2 ? PAL.plaster[3] : undefined, pitch: 38, roofKey: 'tile', damage: i === 0 ? 'holes' : null, chimney: i !== 2, garden: false, gableWindows: false });
  }
  stoneHouse({ x: sx - 15, z: -610, yaw: Wd });
  plasterHouse({ x: sx + 15, z: -612, yaw: E, damage: 'burnt' });
  plasterHouse({ x: sx - 15, z: -633, yaw: Wd });
  stoneHouse({ x: sx + 15, z: -634, yaw: E });
  // second row behind the street
  stoneHouse({ x: sx - 42, z: -548, yaw: Wd + 0.1 });
  plasterHouse({ x: sx + 41, z: -552, yaw: E - 0.12, damage: 'collapsed', keepRoofSide: 1 });
  plasterHouse({ x: sx - 44, z: -585, yaw: Wd - 0.08 });
  stoneHouse({ x: sx + 43, z: -590, yaw: E + 0.1, damage: 'burnt' });
  plasterHouse({ x: sx - 40, z: -622, yaw: Wd + 0.05 });
  stoneHouse({ x: sx + 42, z: -626, yaw: E - 0.05 });

  // rubble beside the damaged houses
  rubble(sx + 28, -546, 3.6);
  rubble(sx + 58, -556, 4.2);
  rubble(sx + 29, -604, 3.4);

  // ================= CHURCH (tower faces the street) =================
  {
    const cx = sx, cz = v.z - 85, yaw = -Math.PI / 2; // local +x (tower end) -> world +z
    const y0 = groundMax(cx, cz, 12, 6, yaw) - 0.2;
    const B = kit.matrix(cx, y0, cz, yaw);
    const w = 22, d = 11, wallH = 9, pitch = 50, tanp = Math.tan((pitch * Math.PI) / 180), rise = (d / 2) * tanp, Lg = d - 2 * T;
    const cream = PAL.plaster[0];
    const arch = [];
    for (let i = 0; i < 4; i++) arch.push({ x: 3.5 + i * 5, y: 2.6, w: 1.4, h: 4.0, arch: true });
    const gtop = [[0, wallH], [Lg / 2, wallH + rise - 0.2], [Lg, wallH]];
    walls(B, 0, 0, w, d, {
      front: { h: wallH, key: 'plaster', color: cream, windows: arch },
      back: { h: wallH, key: 'plaster', color: cream, windows: arch },
      left: { h: wallH, key: 'plaster', color: cream, topPts: gtop, windows: [{ x: Lg / 2, y: 3.0, w: 1.2, h: 3.0, arch: true }] },
      right: { h: wallH, key: 'plaster', color: cream, topPts: gtop },
    }, y0, wallH);
    kit.add('interior', new BoxGeometry(w - 2 * T - 0.05, wallH, d - 2 * T - 0.05), { m: B.clone().multiply(new Matrix4().makeTranslation(0, wallH / 2, 0)), color: PAL.interior, uv: 'keep', ao: false });
    // nave roof (slate)
    const ov = 0.5, run = (d / 2 + ov) / Math.cos((pitch * Math.PI) / 180), ridgeY = wallH + rise, eaveY = ridgeY - (d / 2 + ov) * tanp;
    const slate = jitterColor(PAL.slate[0], rnd, 0.04);
    for (const side of [-1, 1]) {
      kit.add('slate', roofSlabGeometry(w + 0.8, run, 0.16, noise, 3 + side, 0.06), { m: B.clone().multiply(kit.matrix(0, (ridgeY + eaveY) / 2 + 0.06, side * (d / 2 + ov) / 2, 0, side * (pitch * Math.PI) / 180)), color: slate, uv: 'keep', ao: false });
    }
    // apse at the -x end: half cylinder + half cone
    const apse = new CylinderGeometry(4.5, 4.5, 7.5, 14, 1, false, Math.PI, Math.PI);
    kit.add('plaster', apse, { m: B.clone().multiply(new Matrix4().makeTranslation(-w / 2 + 0.3, 3.75, 0)), color: cream, y0 });
    kit.add('slate', new ConeGeometry(4.7, 3.4, 14, 1, false, Math.PI, Math.PI), { m: B.clone().multiply(new Matrix4().makeTranslation(-w / 2 + 0.3, 7.5 + 1.7, 0)), color: slate, uv: 'keep', ao: false });
    // tower at the +x end
    const tx = w / 2 + 2.9, th = 22, tw = 6;
    const belfry = (px) => [{ x: px, y: 17, w: 1.2, h: 3, arch: true }];
    walls(B, tx, 0, tw, tw, {
      front: { h: th, key: 'plaster', color: cream, windows: belfry(tw / 2 - 1.0).concat(belfry(tw / 2 + 1.0)) },
      back: { h: th, key: 'plaster', color: cream, windows: belfry(tw / 2 - 1.0).concat(belfry(tw / 2 + 1.0)) },
      left: { h: th, key: 'plaster', color: cream, windows: [{ x: (tw - 2 * T) / 2 - 1.0, y: 17, w: 1.2, h: 3, arch: true }, { x: (tw - 2 * T) / 2 + 1.0, y: 17, w: 1.2, h: 3, arch: true }] },
      right: { h: th, key: 'plaster', color: cream, door: (tw - 2 * T) / 2, windows: [{ x: (tw - 2 * T) / 2 - 1.0, y: 17, w: 1.2, h: 3, arch: true }, { x: (tw - 2 * T) / 2 + 1.0, y: 17, w: 1.2, h: 3, arch: true }] },
    }, y0, th);
    kit.add('interior', new BoxGeometry(tw - 2 * T - 0.05, th, tw - 2 * T - 0.05), { m: B.clone().multiply(new Matrix4().makeTranslation(tx, th / 2, 0)), color: PAL.interior, uv: 'keep', ao: false });
    // tower cap: flat deck then octagonal spire with a cross
    kit.add('stone', new BoxGeometry(tw + 0.6, 0.5, tw + 0.6), { m: B.clone().multiply(new Matrix4().makeTranslation(tx, th + 0.2, 0)), color: [0.75, 0.72, 0.68], y0 });
    kit.add('slate', new ConeGeometry(4.2, 14, 8), { m: B.clone().multiply(new Matrix4().makeTranslation(tx, th + 0.45 + 7, 0)), color: PAL.slate[0], uv: 'keep', ao: false });
    kit.add('trim', new BoxGeometry(0.12, 1.6, 0.12), { m: B.clone().multiply(new Matrix4().makeTranslation(tx, th + 0.45 + 14.7, 0)), color: [0.05, 0.05, 0.05], uv: 'keep', ao: false });
    kit.add('trim', new BoxGeometry(0.8, 0.12, 0.12), { m: B.clone().multiply(new Matrix4().makeTranslation(tx, th + 0.45 + 15.0, 0)), color: [0.05, 0.05, 0.05], uv: 'keep', ao: false });
    // clock faces on 3 sides at 15 m
    for (const [rx, px, pz] of [[0, 0, 1], [Math.PI, 0, -1], [Math.PI / 2, 1, 0]]) {
      const cm = B.clone().multiply(kit.matrix(tx + px * (tw / 2 + 0.05), 15, pz * (tw / 2 + 0.05), rx)).multiply(new Matrix4().makeRotationX(Math.PI / 2));
      kit.add('trim', new CylinderGeometry(0.7, 0.7, 0.08, 20), { m: cm, color: PAL.trim, uv: 'keep', ao: false });
      kit.add('interior', new CylinderGeometry(0.62, 0.62, 0.1, 20), { m: cm, color: [0.02, 0.02, 0.02], uv: 'keep', ao: false });
      kit.add('trim', new BoxGeometry(0.06, 0.08, 0.5), { m: cm.clone().multiply(new Matrix4().makeTranslation(0, 0.06, -0.2)), color: PAL.trim, uv: 'keep', ao: false });
    }
    // world-space colliders
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const wpos = (lx, lz) => [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs];
    world.addBox(cx, cz, w / 2 + 0.3, d / 2 + 0.3, yaw, { height: 16, y0: y0 - 1, tag: 'building' });
    const tp = wpos(tx, 0);
    world.addBox(tp[0], tp[1], tw / 2 + 0.3, tw / 2 + 0.3, yaw, { height: 36, y0: y0 - 1, tag: 'building' });
    const ap = wpos(-w / 2, 0);
    world.addCircle(ap[0], ap[1], 4.7, { height: 10, y0: y0 - 1, tag: 'building' });
    world.buildings.push({ x: cx, z: cz, hx: w / 2, hz: d / 2, heading: yaw }, { x: tp[0], z: tp[1], hx: 3, hz: 3, heading: yaw });
    footprints.push({ x: cx, z: cz, r: 16 }, { x: tp[0], z: tp[1], r: 8 });
    world.landmarks.church = { x: tp[0], z: tp[1], y: y0 + 36 };

    // churchyard wall (1.1 m) with a gate gap in front, gravestones
    const wx0 = -w / 2 - 6, wx1 = w / 2 + 12, wz0 = -d / 2 - 6, wz1 = d / 2 + 6;
    const wallRun = (a, b, h = 1.1, gap = null) => stoneWall(wpos(a[0], a[1]), wpos(b[0], b[1]), h);
    wallRun([wx0, wz0], [wx1, wz0]); wallRun([wx0, wz1], [wx1, wz1]); wallRun([wx0, wz0], [wx0, wz1]);
    wallRun([wx1, wz0], [wx1, -2.5]); wallRun([wx1, 2.5], [wx1, wz1]);
    {
      const gg = new BoxGeometry(0.5, 0.8, 0.12);
      gg.setAttribute('color', new Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 3).fill(0.85), 3));
      const gm = new InstancedMesh(gg, mats.stone, 12), gs = [];
      for (let i = 0; i < 12; i++) {
        const lx = -w / 2 + 2 + rnd() * (w - 2 + 8), lz = (rnd() < 0.5 ? -1 : 1) * (d / 2 + 1.5 + rnd() * 3.5);
        const gp = wpos(lx, lz), gyy = terrain.getHeight(gp[0], gp[1]);
        gm.setMatrixAt(i, kit.matrix(gp[0], gyy + 0.35, gp[1], yaw + (rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.2));
        gs.push([gp[0], gp[1], gyy]);
      }
      gm.castShadow = true; gm.receiveShadow = true; gm.frustumCulled = false; gm.matrixAutoUpdate = false;
      group.add(gm);
      gs.forEach((g, i) => world.crush.circle(g[0], g[1], 0.4, [{ mesh: gm, index: i, p: new Vector3(g[0], g[2], g[1]) }], { y: g[2], height: 0.9, minSpeed: 0.3, slow: 0.95, jolt: 0.02, maxAng: 1.45, fx: 'dust', fx2: 'none', tag: 'gravestone', noRay: true }));
    }
  }

  // ---------- dry-stone wall runs (merged, with one OBB collider per run) ----------
  function stoneWall(a, b, h = 1.1) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) return;
    const n = Math.ceil(len / 3), ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const segLen = len / n;
    let minY = 1e9;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      const gy = terrain.getHeight(px, pz);
      minY = Math.min(minY, gy);
      const g = new BoxGeometry(0.6, h * (0.9 + rnd() * 0.25), segLen + 0.05, 2, 3, 6);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const top = p.getY(k) > 0 ? 1 : 0;
        p.setXYZ(k, p.getX(k) + noise.noise(k * 0.37 + i, 1.3) * 0.03, p.getY(k) + (top ? noise.noise(p.getZ(k) * 2 + i, 4) * 0.08 : 0), p.getZ(k));
      }
      g.computeVertexNormals();
      kit.add('stone', g, { m: kit.matrix(px, gy + h * 0.45 - 0.15, pz, ang), color: jitterColor([1, 1, 1], rnd, 0.1), y0: gy - 0.2, uv: 'wall' });
    }
    world.addBox((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.4, len / 2, ang, { height: h, y0: minY - 0.5, tag: 'wall', cls: 'climb', top: h * 0.95 });
  }

  // garden walls between village houses and along lanes
  stoneWall([sx - 8, -545], [sx - 8, -566]); stoneWall([sx + 8, -545], [sx + 8, -566]);
  stoneWall([sx - 8, -604], [sx - 8, -642]); stoneWall([sx + 8, -604], [sx + 8, -642]);
  stoneWall([sx - 56, -540], [sx - 56, -565], 1.0); stoneWall([sx + 54, -535], [sx + 54, -565], 1.0);

  // ================= FARM =================
  const farm = terrain.farm;
  const fx = farm.x, fz = farm.z;
  // red barn: ridge along x, gable end (+x) faces the road (west) with yaw = PI
  building({ x: fx, z: fz, yaw: Math.PI, w: 18, d: 10, wallH: 5, floors: 1, pitch: 35, wallKey: 'barn', wallColor: jitterColor(PAL.barn[1], rnd, 0.05), roofKey: 'metal', roofColor: PAL.metalRoof, doorOn: 'gable', gableDoor: true, chimney: false, shutters: false, gableWindows: false, light: 3.0 });
  building({ x: fx + 4, z: fz + 36, yaw: -Math.PI / 2, w: 12, d: 8, wallH: 5.5, floors: 2, pitch: 42, wallKey: 'plaster', roofKey: 'tile', shutters: true, garden: true });
  building({ x: fx + 22, z: fz - 8, yaw: 0, w: 8, d: 5, wallH: 3, floors: 1, pitch: 30, wallKey: 'timber', wallColor: pick(PAL.timber), roofKey: 'metal', roofColor: PAL.metalRoof, chimney: false, gableWindows: false, light: 2.0 });
  building({ x: fx + 25, z: fz + 12, yaw: 0.1, w: 7, d: 4.5, wallH: 3, floors: 1, pitch: 25, wallKey: 'timber', wallColor: pick(PAL.timber), roofKey: 'metal', roofColor: PAL.metalRoof, chimney: false, gableWindows: false, light: 2.0 });
  building({ x: fx - 18, z: fz - 30, yaw: 0.3, w: 6, d: 4.5, wallH: 3, floors: 1, pitch: 28, wallKey: 'timber', wallColor: pick(PAL.timber), roofKey: 'metal', roofColor: PAL.metalRoof, chimney: false, gableWindows: false, light: 2.0 });
  // trough + log pile
  kit.box('timber', 2, 0.6, 0.6, fx + 14, terrain.getHeight(fx + 14, fz + 22) + 0.3, fz + 22, 0.2, pick(PAL.timber));
  world.addBox(fx + 14, fz + 22, 1, 0.3, 0.2, { height: 0.7, tag: 'prop', cls: 'climb', top: 0.6 });
  for (let i = 0; i < 12; i++) {
    const row = i < 5 ? 0 : i < 9 ? 1 : 2, col = i < 5 ? i : i < 9 ? i - 5 + 0.5 : i - 9 + 1;
    const g = new CylinderGeometry(0.16, 0.16, 2.2, 8);
    g.rotateZ(Math.PI / 2);
    kit.add('timber', g, { m: kit.matrix(fx - 8, terrain.getHeight(fx - 8, fz + 24) + 0.2 + row * 0.3, fz + 24 - 0.4 * (col - 2), 0), color: pick(PAL.timber), y0: 0, uv: 'wall', ao: false });
  }
  world.addBox(fx - 8, fz + 24, 1.2, 1.2, 0, { height: 1, tag: 'prop', cls: 'climb', top: 0.85 });

  // ================= PAVED VILLAGE ROAD =================
  const rp = terrain.roadPoints;
  const paved = rp.filter((p) => p.z < -515 && p.z > -626);
  const buildRibbon = (pts, halfW, yOff, uvMode, fade = 0) => {
    const pos = [], nor = [], uv = [], col = [], idx = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      const tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl, nz = tx / tl;
      if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      let a = 1;
      if (fade) a = smoothstep(0, fade, along) * smoothstep(0, fade, (pts.length - 1 - i) * 3);
      for (const s of [-1, 1]) {
        const x = p.x + nx * halfW * s, z = p.z + nz * halfW * s;
        pos.push(x, terrain.getHeight(x, z) + yOff, z); nor.push(0, 1, 0);
        uv.push(s < 0 ? 0 : 1, along / (uvMode === 'asphalt' ? 7 : 1));
        col.push(1, 1, 1, a);
      }
      if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  // sample every ~3 m
  const pv = paved.filter((_, i) => i % 2 === 0);
  if (pv.length > 3) {
    const asph = patchMaterial(new MeshStandardMaterial({ map: makeAsphalt(), vertexColors: true, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    const road = new Mesh(buildRibbon(pv, 3.5, 0.045, 'asphalt', 12), asph);
    road.receiveShadow = true; road.renderOrder = 1;
    group.add(road);
    // sidewalks inside the village only
    const inner = paved.filter((p) => p.z < -535 && p.z > -622).filter((_, i) => i % 2 === 0);
    const cob = patchMaterial(new MeshStandardMaterial({ map: makeCobble(), roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 }));
    cob.map.repeat.set(1, 1);
    for (const s of [-1, 1]) {
      const side = inner.map((p, i) => {
        const q = inner[Math.min(inner.length - 1, i + 1)], o = inner[Math.max(0, i - 1)];
        const tx = q.x - o.x, tz = q.z - o.z, tl = Math.hypot(tx, tz) || 1;
        return { x: p.x + (-tz / tl) * 4.3 * s, z: p.z + (tx / tl) * 4.3 * s };
      });
      if (side.length > 3) {
        const g = buildRibbon(side, 0.75, 0.13, 'cobble');
        const m = new Mesh(g, cob);
        m.receiveShadow = true; m.renderOrder = 2;
        group.add(m);
        // concrete curb along the inner edge of the sidewalk
        for (let i = 0; i < inner.length - 2; i += 2) {
          const a = inner[i], b = inner[i + 2], ang = Math.atan2(b.x - a.x, b.z - a.z), len = Math.hypot(b.x - a.x, b.z - a.z);
          const mx = (a.x + b.x) / 2 + Math.cos(ang) * 3.6 * s * 0 - (-Math.cos(ang)) * 0, mz = (a.z + b.z) / 2;
          const nx = Math.cos(ang), nz = -Math.sin(ang); // right-hand normal of the travel direction
          const cx2 = mx + nx * 3.6 * s * -1, cz2 = mz + nz * 3.6 * s * -1;
          kit.add('concrete', new BoxGeometry(0.25, 0.2, len + 0.1), { m: kit.matrix(cx2, terrain.getHeight(cx2, cz2) + 0.1, cz2, ang), color: PAL.concrete, y0: 0 });
        }
      }
    }
    // lamp posts every ~25 m
    for (let i = 0; i < inner.length; i += 12) {
      const p = inner[i];
      for (const s of [-1, 1]) {
        const lx = p.x + 4.8 * s, lz = p.z, gy = terrain.getHeight(lx, lz);
        // own small group per lamp so it can be knocked over (crushable)
        const lampG = new Group(); lampG.position.set(lx, gy, lz);
        const pk = new Kit(mats), dark = [0.02, 0.025, 0.02];
        pk.add('interior', new CylinderGeometry(0.07, 0.09, 4.5, 8), { m: pk.matrix(0, 2.25, 0), color: dark, uv: 'keep', ao: false });
        pk.add('interior', new BoxGeometry(0.9, 0.06, 0.06), { m: pk.matrix(-0.4 * s, 4.5, 0), color: dark, uv: 'keep', ao: false });
        pk.add('glass', new BoxGeometry(0.3, 0.35, 0.3), { m: pk.matrix(-0.85 * s, 4.3, 0), color: [0.8, 0.7, 0.45], uv: 'keep', ao: false });
        pk.finish(lampG); group.add(lampG);
        world.crush.circle(lx, lz, 0.3, [{ obj: lampG }], { y: gy, height: 4.6, minSpeed: 0.6, slow: 0.93, jolt: 0.03, maxAng: 1.5, fx: 'dust', fx2: 'thud', tag: 'lamp', noRay: true });
      }
    }
  }

  // ================= FENCES (instanced posts + rails, 10% broken spans) =================
  const posts = [], rails = [], spans = [];
  const fence = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const segs = Math.max(1, Math.round(len / 2.5));
      for (let k = 0; k <= segs; k++) {
        const t = k / segs, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        posts.push([x, terrain.getHeight(x, z), z]);
        if (k < segs) {
          const t2 = (k + 1) / segs, x2 = a[0] + (b[0] - a[0]) * t2, z2 = a[1] + (b[1] - a[1]) * t2;
          const y1 = terrain.getHeight(x, z), y2 = terrain.getHeight(x2, z2);
          const l = Math.hypot(x2 - x, z2 - z, y2 - y1), broken = rnd() < 0.1;
          const span = { x, z, x2, z2, pa: posts.length - 1, pb: posts.length, r0: rails.length, r1: 0 };
          spans.push(span);
          for (const [hi, hgt] of [[0, 0.45], [1, 0.95]]) {
            if (broken && hi === 1) continue;
            rails.push([(x + x2) / 2, (y1 + y2) / 2 + hgt - 0.02 + (rnd() - 0.5) * 0.03 - (broken ? 0.15 : 0), (z + z2) / 2, Math.atan2(x2 - x, z2 - z), Math.atan2(y1 - y2, Math.hypot(x2 - x, z2 - z)) + (broken ? 0.12 : 0), l]);
          }
          span.r1 = rails.length;
        }
      }
    }
  };
  fence([[fx - 28, fz - 40], [fx + 40, fz - 40], [fx + 40, fz + 58], [fx - 28, fz + 58], [fx - 28, fz - 40]]);
  const side = [], side2 = [], side3 = [];
  for (let i = 0; i < rp.length; i += 6) {
    const p = rp[i], q = rp[Math.min(rp.length - 1, i + 1)];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    if (p.z > 150 && p.z < 520) side.push([p.x + nx * 8.5, p.z + nz * 8.5]);
    if (p.z > -250 && p.z < -60) side2.push([p.x - nx * 8.5, p.z - nz * 8.5]);
    if (p.z > -500 && p.z < -300) side3.push([p.x + nx * 9, p.z + nz * 9]);
  }
  for (const s of [side, side2, side3]) if (s.length > 1) fence(s);
  const woodMat = patchMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }));
  const postMesh = new InstancedMesh(new BoxGeometry(0.12, 1.6, 0.12), woodMat, Math.max(1, posts.length));
  const railMesh = new InstancedMesh(new BoxGeometry(0.12, 0.06, 1), woodMat, Math.max(1, rails.length));
  const dm = new Matrix4(), dq = new Matrix4();
  const wcol = new Color();
  posts.forEach((p, i) => {
    dm.copy(kit.matrix(p[0], p[1] + 0.5, p[2], rnd() * 6.28, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1));
    postMesh.setMatrixAt(i, dm);
    const c = pick(PAL.timber); wcol.setRGB(c[0] * 1.3, c[1] * 1.3, c[2] * 1.3); postMesh.setColorAt(i, wcol);
  });
  rails.forEach((r, i) => {
    dm.copy(kit.matrix(r[0], r[1], r[2], r[3], r[4]));
    dq.makeScale(1, 1, r[5]);
    dm.multiply(dq);
    railMesh.setMatrixAt(i, dm);
    const c = pick(PAL.timber); wcol.setRGB(c[0] * 1.3, c[1] * 1.3, c[2] * 1.3); railMesh.setColorAt(i, wcol);
  });
  for (const m of [postMesh, railMesh]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
  // every span between two posts is crushable: the posts and rails of the span fall flat away from the tank's side
  {
    const postRigs = posts.map((p, i) => ({ mesh: postMesh, index: i, p: new Vector3(p[0], p[1], p[2]) }));
    const railRigs = rails.map((r, i) => ({ mesh: railMesh, index: i, p: new Vector3(r[0], terrain.getHeight(r[0], r[2]), r[2]) }));
    for (const sp of spans) {
      const rigs = [postRigs[sp.pa], postRigs[sp.pb]];
      for (let i = sp.r0; i < sp.r1; i++) rigs.push(railRigs[i]);
      const len = Math.hypot(sp.x2 - sp.x, sp.z2 - sp.z) || 1, nx = (sp.z2 - sp.z) / len, nz = -(sp.x2 - sp.x) / len;
      world.crush.box((sp.x + sp.x2) / 2, (sp.z + sp.z2) / 2, 0.18, len / 2, Math.atan2(sp.x2 - sp.x, sp.z2 - sp.z), rigs, {
        height: 1.0, minSpeed: 0.4, slow: 0.96, jolt: 0.015, maxAng: 1.5, fx: 'dust', fx2: 'none', noRay: true, tag: 'fence',
        dirFn: (dx, dz) => (dx * nx + dz * nz >= 0 ? [nx, nz] : [-nx, -nz]),
      });
    }
  }

  // ================= HAY BALES =================
  {
    const bales = [];
    const fieldC = [fx - 70, fz + 30];
    for (let i = 0; i < 22; i++) {
      const x = fieldC[0] + (rnd() - 0.5) * 50, z = fieldC[1] + (rnd() - 0.5) * 30;
      if (terrain.getRoadDistance(x, z) < 8) continue;
      bales.push([x, z]);
    }
    const bg = new CylinderGeometry(0.75, 0.75, 1.2, 16);
    bg.rotateZ(Math.PI / 2);
    const hm = patchMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    const mesh = new InstancedMesh(bg, hm, bales.length);
    const hc = hexLin('#b59a5c');
    bales.forEach((b, i) => {
      mesh.setMatrixAt(i, kit.matrix(b[0], terrain.getHeight(b[0], b[1]) + 0.72, b[1], rnd() * 6.28));
      const k = 0.85 + rnd() * 0.3; wcol.setRGB(hc[0] * k, hc[1] * k, hc[2] * k * 0.95); mesh.setColorAt(i, wcol);
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    group.add(mesh);
    bales.forEach((b, i) => world.crush.circle(b[0], b[1], 0.9, [{ mesh, index: i, p: new Vector3(b[0], terrain.getHeight(b[0], b[1]), b[1]) }], { height: 1.5, minSpeed: 0.5, slow: 0.92, jolt: 0.03, shove: 1.2, maxAng: 1.57, fx: 'dust', fx2: 'none', tag: 'prop' }));
  }

  // ================= UTILITY POLES along the dirt road (east side) =================
  {
    const poles = [], wireMat = new LineBasicMaterial({ color: 0x2a2826 });
    for (let i = 0; i < rp.length; i += 47) {
      const p = rp[i], q = rp[Math.min(rp.length - 1, i + 1)];
      if (p.z < -440) break;
      const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
      const x = p.x + (-tz / tl) * 7.5, z = p.z + (tx / tl) * 7.5, gy = terrain.getHeight(x, z);
      poles.push([x, gy, z, Math.atan2(tx, tz)]);
    }
    const poleGroups = poles.map((p) => {
      const g = new Group(); g.position.set(p[0], p[1], p[2]);
      const pk = new Kit(mats);
      pk.add('timber', new CylinderGeometry(0.11, 0.14, 8.5, 8), { m: pk.matrix(0, 4.0, 0), color: PAL.timber[2], y0: 0, ao: false });
      pk.add('timber', new BoxGeometry(1.6, 0.1, 0.1), { m: pk.matrix(0, 7.6, 0, p[3] + Math.PI / 2), color: PAL.timber[2], y0: 0, ao: false });
      pk.finish(g); group.add(g);
      return g;
    });
    // wires: one line set per span so a span can disappear when either of its poles is knocked down
    const wireSpans = [];
    for (let i = 0; i < poles.length - 1; i++) {
      const hang = [];
      for (const off of [-0.7, 0.7]) {
        const a = poles[i], b = poles[i + 1];
        const ca = [a[0] + Math.cos(a[3]) * off, a[1] + 7.55, a[2] - Math.sin(a[3]) * off], cb = [b[0] + Math.cos(b[3]) * off, b[1] + 7.55, b[2] - Math.sin(b[3]) * off];
        let prev = ca;
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, cur = [lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t) - 0.7 * 4 * t * (1 - t) * 1.4, lerp(ca[2], cb[2], t)];
          hang.push(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2]);
          prev = cur;
        }
      }
      const lg = new BufferGeometry();
      lg.setAttribute('position', new Float32BufferAttribute(hang, 3));
      const lines = new LineSegments(lg, wireMat);
      lines.frustumCulled = false;
      group.add(lines);
      wireSpans.push(lines);
    }
    poles.forEach((p, i) => world.crush.circle(p[0], p[2], 0.25, [{ obj: poleGroups[i] }], {
      y: p[1], height: 8.5, minSpeed: 0.6, slow: 0.88, jolt: 0.06, maxAng: 1.5, fx: 'dust', fx2: 'thud', noRay: true, tag: 'pole',
      onStart: () => { if (wireSpans[i - 1]) wireSpans[i - 1].visible = false; if (wireSpans[i]) wireSpans[i].visible = false; }, // the span drops out (no dangling ends)
    }));
  }

  world.landmarks.village = { x: v.x, z: v.z, y: terrain.getHeight(v.x, v.z) };
  world.landmarks.hill = { x: terrain.hill.x, z: terrain.hill.z, y: terrain.hillTopY };
  world.landmarks.barn = { x: fx, z: fz };

  return { group, footprints, kit, rubble, stoneWall, mats, finish: () => kit.finish(group) };
}

void BoxGeometry; void clamp; void InstancedBufferAttribute;
