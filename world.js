// The world: procedural geometry for village, forest and estate, pooled lamps, and the
// apparition anchor sites (plain data for the director to consume in WP-001 T2).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as P from './path.js';
import * as T from './textures.js';

const AMBER = 0xffa24a;
const FOG_COLOR = 0x1a2430;
export { FOG_COLOR };

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const mx = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Merge many placed geometries into one mesh per material (few draw calls).
class Batch {
  constructor() { this.m = new Map(); }
  add(geo, mat, matrix) {
    let e = this.m.get(mat); if (!e) this.m.set(mat, (e = []));
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix); e.push(g);
  }
  build() {
    const grp = new THREE.Group();
    for (const [mat, geos] of this.m) grp.add(new THREE.Mesh(mergeGeometries(geos, false), mat));
    return grp;
  }
}
// Same, split into 80 m z-chunks so distant chunks get frustum-culled.
class Chunked {
  constructor() { this.m = new Map(); }
  at(z) { const k = Math.floor(z / 80); if (!this.m.has(k)) this.m.set(k, new Batch()); return this.m.get(k); }
  build(scene) { for (const b of this.m.values()) scene.add(b.build()); }
}

function scaleUV(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
function box(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const [a, b] = f[Math.floor(i / 4)]; uv.setXY(i, (uv.getX(i) * a) / tile, (uv.getY(i) * b) / tile); }
  return g;
}
const plane = (w, h, tile = 3) => scaleUV(new THREE.PlaneGeometry(w, h), w / tile, h / tile);
function gable(span, rise, len) {
  const sh = new THREE.Shape(); sh.moveTo(-span / 2, 0); sh.lineTo(span / 2, 0); sh.lineTo(0, rise); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); g.translate(0, 0, -len / 2); return g;
}
function gableWall(w, rise, span) { // triangular wall under a roof of the given span
  const e = rise * (1 - w / span), sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, e); sh.lineTo(0, rise); sh.lineTo(-w / 2, e); sh.closePath();
  return new THREE.ShapeGeometry(sh);
}
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0);
const unitCone = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
const unitTaper = new THREE.CylinderGeometry(0.55, 1, 1, 6).translate(0, 0.5, 0);
const unitRock = new THREE.DodecahedronGeometry(1, 0);
const unitBush = new THREE.IcosahedronGeometry(1, 1);

export function buildWorld(scene) {
  const rand = T.rng(1337);
  const S1 = P.GATES[0], S2 = P.GATES[1];
  const anchors = { windows: [], covers: [], ends: [] };
  const lamps = [];

  // ---- materials ----------------------------------------------------------------------
  const cob = T.cobbles();
  const ground = T.groundFloor(); ground.repeat.set(150, 250);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    ground: std({ map: ground, roughness: 0.95, color: 0xffffff }),
    cobble: std({ map: cob.map, bumpMap: cob.bump, bumpScale: 2, roughness: 0.26, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    dirt: std({ map: T.dirt(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    gravel: std({ map: T.gravel(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    plaster: std({ map: T.plaster(), roughness: 0.92 }),
    slate: std({ map: T.slate(), roughness: 0.6, metalness: 0.1 }),
    stone: std({ color: 0x4d5560, roughness: 0.95 }),
    iron: std({ color: 0x15181c, roughness: 0.5, metalness: 0.6 }),
    wood: std({ map: T.planks(), roughness: 0.28, metalness: 0.05 }),
    bark: std({ map: T.bark(), roughness: 1 }),
    pine: std({ color: 0x0f1c17, roughness: 1 }),
    bush: std({ color: 0x0d1914, roughness: 1 }),
    rock: std({ color: 0x3a424c, roughness: 0.9 }),
    hedge: std({ color: 0x0c1511, roughness: 1 }),
    window: std({ map: T.windowTex('dark'), roughness: 0.15, metalness: 0.2 }),
    door: std({ map: T.doorTex(), roughness: 0.8 }),
    frame: std({ color: 0x5b646d, roughness: 0.8 }),
    curtain: std({ map: T.curtain(), roughness: 1 }),
    glass: new THREE.MeshBasicMaterial({ map: T.rainGlass(), transparent: true, depthWrite: false }),
    interior: std({ map: T.plaster(), color: 0x8a8070, roughness: 0.9, side: THREE.FrontSide }),
    lampHead: new THREE.MeshBasicMaterial({ color: 0xffc27a }),
    litWindow: new THREE.MeshBasicMaterial({ map: T.windowTex('lit'), fog: false, transparent: true }),
  };
  const glowTex = T.glow(), streakTex = T.streak();
  const addMat = (tex, op) => new THREE.MeshBasicMaterial({ map: tex, color: AMBER, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
  const MStreak = addMat(streakTex, 0.5), MPool = addMat(glowTex, 0.3);

  // ---- lights -------------------------------------------------------------------------
  const moon = new THREE.DirectionalLight(0x7088b8, 2.4); moon.position.set(-25, 45, 35); scene.add(moon);
  const hemi = new THREE.HemisphereLight(0x34476a, 0x10141a, 2.6); scene.add(hemi);
  // Pool of 3 amber point lights, reassigned each frame to the nearest lamps (keeps lights few).
  const pool = [0, 1, 2].map(() => { const l = new THREE.PointLight(AMBER, 0, 20, 2); scene.add(l); return l; });

  function addLamp({ id, zone, pos, range = 24, intensity = 70, halo = 5, color = AMBER }) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    sprite.position.copy(pos); sprite.scale.setScalar(halo); scene.add(sprite);
    const lamp = { id, zone, pos, range, intensity, color: new THREE.Color(color), halo: sprite, flicker: 1, d: 0 };
    lamps.push(lamp); return lamp;
  }

  // ---- ground and path surfaces -------------------------------------------------------
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(900, 1500).rotateX(-Math.PI / 2), M.ground);
  gm.position.set(0, 0, -560); scene.add(gm);

  function ribbon(s0, s1, width, y, tile, mat) {
    const pos = [], uv = [], nor = [], idx = [], n = Math.ceil((s1 - s0) / 2), hw = width / 2;
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n, p = P.pointAt(s);
      pos.push(p.x - p.rx * hw, y, p.z - p.rz * hw, p.x + p.rx * hw, y, p.z + p.rz * hw);
      uv.push(0, s / tile, width / tile, s / tile); nor.push(0, 1, 0, 0, 1, 0);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    scene.add(new THREE.Mesh(g, mat));
  }
  ribbon(0, S1 + 16, 6.4, 0.02, 1.5, M.cobble);
  ribbon(S1 - 16, S2 + 16, 3.4, 0.015, 3, M.dirt);
  ribbon(S2 - 16, P.LENGTH, 5.2, 0.02, 3, M.gravel);

  // ---- helpers for placing things relative to the path --------------------------------
  const lat = (s, side, d) => { const p = P.pointAt(s); return V(p.x + side * p.rx * d, 0, p.z + side * p.rz * d); };

  function lampPost(id, zone, s, side, { latD = 3.1, h = 3.9, range = 24, intensity = 70, halo = 5, streak = true } = {}) {
    const base = lat(s, side, latD), p = P.pointAt(s);
    B.props.at(base.z).add(unitCyl, M.iron, mx(base.x, 0, base.z, 0, 0.14, h, 0.14));
    B.props.at(base.z).add(box(0.34, 0.5, 0.34), M.lampHead, mx(base.x, h + 0.1, base.z));
    B.props.at(base.z).add(box(0.5, 0.1, 0.5), M.iron, mx(base.x, h + 0.4, base.z));
    const lamp = addLamp({ id, zone, pos: V(base.x, h + 0.1, base.z), range, intensity, halo });
    if (streak) { // reflection on the wet ground, stretched toward the viewer
      const th = Math.atan2(p.tx, p.tz) + Math.PI, c = lat(s, side, latD * 0.4);
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 9).rotateX(-Math.PI / 2).rotateY(th), MStreak);
      sm.position.set(c.x - p.tx * 4.5, 0.035, c.z - p.tz * 4.5); sm.renderOrder = 1; scene.add(sm);
    }
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), MPool);
    pm.position.set(base.x, 0.032, base.z); pm.renderOrder = 1; scene.add(pm);
    return lamp;
  }

  const B = { houses: new Chunked(), trees: new Chunked(), rocks: new Chunked(), bushes: new Chunked(), props: new Chunked() };

  // ---- houses and windows -------------------------------------------------------------
  function anchorWindow(id, zone, base, lx, ly, lz) {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(base).multiply(mx(lx, ly, lz));
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.24), M.curtain); curtain.position.z = 0.03;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), M.glass); glass.position.z = 0.09; glass.renderOrder = 2;
    g.add(curtain, glass);
    const fr = (w, h, x, y) => { const m = new THREE.Mesh(box(w, h, 0.14), M.frame); m.position.set(x, y, 0.07); g.add(m); };
    fr(1.12, 0.1, 0, 0.7); fr(1.12, 0.1, 0, -0.7); fr(0.1, 1.5, -0.51, 0); fr(0.1, 1.5, 0.51, 0); fr(0.04, 1.3, 0, 0);
    const sill = new THREE.Mesh(box(1.3, 0.08, 0.3), M.frame); sill.position.set(0, -0.78, 0.15); g.add(sill);
    scene.add(g);
    const pos = V(lx, ly, lz + 0.09).applyMatrix4(base), normal = V(0, 0, 1).transformDirection(base);
    anchors.windows.push({
      id, zone, pos, normal,
      interior: pos.clone().addScaledVector(normal, -0.03), // between curtain and glass
      width: 0.9, height: 1.3, glass, curtain,
      s: P.clampToPath(pos.x, pos.z).s,
    });
  }

  function house(cx, cz, yaw, w, d, h, rise, anchorId = null, zone = 'village', chunk = B.houses) {
    const base = mx(cx, 0, cz, yaw), b = chunk.at(cz);
    const L = (g, m, x, y, z, ry = 0) => b.add(g, m, base.clone().multiply(mx(x, y, z, ry)));
    L(box(w, h, d), M.plaster, 0, h / 2, 0);
    L(gable(w + 0.8, rise, d), M.slate, 0, h, 0);
    const gw = gableWall(w, rise, w + 0.8);
    L(gw, M.plaster, 0, h, d / 2 + 0.02); L(gw, M.plaster, 0, h, -d / 2 - 0.02, Math.PI);
    L(box(0.7, 2.2, 0.7), M.plaster, w * 0.25, h + rise * 0.55, -d * 0.2);
    const wg = new THREE.PlaneGeometry(0.9, 1.3), wz = d / 2 + 0.02;
    const cols = w >= 6 ? [-w * 0.3, w * 0.3] : [0];
    cols.forEach((x, i) => {
      if (anchorId && i === 0) anchorWindow(anchorId, zone, base, x, 1.9, d / 2); else L(wg, M.window, x, 1.9, wz);
    });
    if (w >= 6) L(new THREE.PlaneGeometry(1.1, 2.1), M.door, 0, 1.05, wz);
    if (h >= 5) [-w * 0.3, 0, w * 0.3].forEach((x) => L(wg, M.window, x, h - 1.5, wz));
    L(wg, M.window, 0, h + rise * 0.35, wz + 0.01);
  }

  // Village: houses both sides, a gap for the alley, an end-cap house behind the start.
  const ALLEY_S = 140;
  let wi = 0;
  for (const side of [-1, 1]) {
    let s = 8 + rand() * 8;
    while (s < S1 - 28) {
      const w = 6 + rand() * 4, d = 6 + rand() * 3, h = 4.6 + rand() * 1.8, rise = 2.2 + rand() * 1.2;
      if (side === -1 && s + w > ALLEY_S - 3.5 && s < ALLEY_S + 3.5) { s = ALLEY_S + 3.5; continue; }
      const sc = s + w / 2, F = 4.3 + rand() * 0.8, p = P.pointAt(sc);
      const cx = p.x + side * p.rx * (F + d / 2), cz = p.z + side * p.rz * (F + d / 2);
      const yaw = Math.atan2(-side * p.rx, -side * p.rz) + (rand() - 0.5) * 0.1;
      const anchor = wi % 9 === 4 && anchors.windows.length < 5 ? `village-window-${anchors.windows.length + 1}` : null;
      house(cx, cz, yaw, w, d, h, rise, anchor); wi++;
      s += w + 1 + rand() * 3 + (rand() < 0.08 ? 9 : 0);
    }
  }
  { // end cap behind the start
    const p0 = P.pointAt(0);
    house(p0.x - p0.tx * 8, p0.z - p0.tz * 8, Math.atan2(p0.tx, p0.tz), 9, 7, 6, 3, 'village-window-start');
  }

  // Alley (left side at ALLEY_S): cobbled dead end with a wall lamp.
  {
    const p = P.pointAt(ALLEY_S), dx = -p.rx, dz = -p.rz;
    const at = (d) => V(p.x + dx * d, 0, p.z + dz * d);
    const c = at(10.3), th = Math.atan2(dx, dz);
    const af = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(3.8, 15), 3.8 / 1.5, 15 / 1.5).rotateX(-Math.PI / 2).rotateY(th), M.cobble);
    af.position.set(c.x, 0.025, c.z); scene.add(af);
    const wallC = at(18);
    B.props.at(wallC.z).add(box(5.5, 4.5, 0.5), M.plaster, mx(wallC.x, 2.25, wallC.z, th));
    const lp = at(17.2); lp.y = 3.0;
    B.props.at(lp.z).add(box(0.3, 0.4, 0.3), M.lampHead, mx(lp.x, lp.y, lp.z));
    const lamp = addLamp({ id: 'village-alley-lamp', zone: 'village', pos: lp, range: 15, intensity: 45, halo: 2.4 });
    const dirv = V(dx, 0, dz);
    anchors.ends.push({ id: 'village-alley', zone: 'village', kind: 'alley', pos: at(11), lightPos: lamp.pos.clone(), dir: dirv, lightRadius: 12, s: ALLEY_S, viewFrom: [ALLEY_S - 22, ALLEY_S + 8] });
  }

  // Village street lamps (one pooled amber light follows the player; these are the lamp sites).
  [[45, 1], [110, -1], [175, 1], [240, -1], [305, 1]].forEach(([s, side], i) =>
    lampPost(`village-lamp-${i + 1}`, 'village', s, side, { range: 26, intensity: 75 }));
  for (const [s, id] of [[110, 'village-street-1'], [240, 'village-street-2']]) {
    const lamp = lamps.find((l) => l.id === `village-lamp-${s === 110 ? 2 : 4}`), pe = P.pointAt(s + 11);
    anchors.ends.push({ id, zone: 'village', kind: 'street', pos: V(pe.x, 0, pe.z), lightPos: lamp.pos.clone(), dir: V(pe.tx, 0, pe.tz), lightRadius: 14, s, viewFrom: [s - 34, s - 6] });
  }

  // ---- fog gate props ------------------------------------------------------------------
  function gatePillars(s) { // two stone pillars and short wall runs either side of the path
    const p = P.pointAt(s), ry = Math.atan2(-p.tx, -p.tz);
    for (const side of [-1, 1]) {
      const c = lat(s, side, 3.5), b = B.props.at(c.z);
      b.add(box(0.9, 3.0, 0.9), M.stone, mx(c.x, 1.5, c.z)); b.add(box(1.2, 0.25, 1.2), M.stone, mx(c.x, 3.12, c.z));
      for (const k of [0, 1]) { const w = lat(s, side, 5.55 + k * 3.2); b.add(box(3.2, 1.3, 0.5), M.stone, mx(w.x, 0.65, w.z, ry)); }
    }
  }
  gatePillars(S1); gatePillars(S2);

  // ---- forest ---------------------------------------------------------------------------
  function tree(x, z, dead) {
    const sc = 0.8 + rand() * 0.5, b = B.trees.at(z), lean = (rand() - 0.5) * 0.12, ry = rand() * 6.28;
    if (!dead) {
      const H = 8 + rand() * 5;
      b.add(unitTaper, M.bark, mx(x, 0, z, ry, 0.28 * sc, H, 0.28 * sc, lean, lean));
      b.add(unitCone, M.pine, mx(x, 2.6, z, ry, 2.1 * sc, 5.5, 2.1 * sc));
      b.add(unitCone, M.pine, mx(x, 5.4, z, ry, 1.5 * sc, 4.6, 1.5 * sc));
      b.add(unitCone, M.pine, mx(x, 8.0, z, ry, 0.95 * sc, 3.4, 0.95 * sc));
    } else {
      const H = 5 + rand() * 4;
      b.add(unitTaper, M.bark, mx(x, 0, z, ry, 0.26 * sc, H, 0.26 * sc, lean, lean));
      for (let i = 0; i < 4; i++) {
        const y = H * (0.45 + rand() * 0.5), a = rand() * 6.28, len = 1.3 + rand() * 2.2;
        b.add(unitTaper, M.bark, mx(x, y, z, a, 0.06, len, 0.06, 0.9 + rand() * 0.5));
      }
    }
  }
  for (let s = S1 - 8; s < S2 + 10; s += 2.2) {
    for (const side of [-1, 1]) {
      const n = rand() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const c = lat(s + rand() * 2, side, 3.1 + Math.pow(rand(), 1.6) * 34);
        tree(c.x, c.z, rand() < 0.35);
      }
    }
  }
  for (let i = 0; i < 170; i++) { // scattered stones
    const c = lat(S1 - 8 + rand() * (S2 - S1 + 16), rand() < 0.5 ? -1 : 1, 2.9 + rand() * 20), r = 0.3 + rand() * 0.9;
    B.rocks.at(c.z).add(unitRock, M.rock, mx(c.x, r * 0.35, c.z, rand() * 6.28, r * 1.2, r * 0.75, r, rand() * 0.3, rand() * 0.3));
  }
  function bush(x, z, r = 1) {
    const b = B.bushes.at(z);
    for (let i = 0; i < 3; i++) b.add(unitBush, M.bush, mx(x + (rand() - 0.5) * r, 0.5 * r, z + (rand() - 0.5) * r, 0, r * (0.8 + rand() * 0.5), r * 0.7, r * (0.8 + rand() * 0.5)));
  }
  for (let i = 0; i < 200; i++) {
    const c = lat(S1 - 8 + rand() * (S2 - S1 + 16), rand() < 0.5 ? -1 : 1, 2.8 + rand() * 18);
    bush(c.x, c.z, 0.7 + rand() * 0.8);
  }
  { // cover spots beside the path: stone / foliage alternate, sides alternate
    const n = 15, a = S1 + 30, b = S2 - 30;
    for (let i = 0; i < n; i++) {
      const s = a + ((b - a) * i) / (n - 1), side = i % 2 ? 1 : -1, kind = i % 4 < 2 ? 'stone' : 'foliage';
      const p = P.pointAt(s), c = lat(s, side, 3.2);
      if (kind === 'stone') {
        B.rocks.at(c.z).add(unitRock, M.rock, mx(c.x, 0.75, c.z, rand() * 6.28, 1.1, 0.9, 0.95));
        B.rocks.at(c.z).add(unitRock, M.rock, mx(c.x + 0.6 * side * p.rx + p.tx * 0.8, 0.3, c.z + 0.6 * side * p.rz + p.tz * 0.8, 1, 0.5, 0.4, 0.5));
      } else {
        for (let k = 0; k < 4; k++) B.bushes.at(c.z).add(unitBush, M.bush, mx(c.x + (rand() - 0.5) * 1.2, 0.7 + rand() * 0.5, c.z + (rand() - 0.5) * 1.2, 0, 0.9, 0.85, 0.9));
      }
      const peek = V(c.x - p.tx * 0.8 - side * p.rx * 0.35, 1.3, c.z - p.tz * 0.8 - side * p.rz * 0.35);
      const look = P.pointAt(s - 6), face = V(look.x - peek.x, 0, look.z - peek.z).normalize();
      anchors.covers.push({
        id: `forest-cover-${i + 1}`, zone: 'forest', kind, side: side < 0 ? 'left' : 'right', s,
        pos: V(c.x, 0, c.z), peekPos: peek, faceDir: face, radius: 1, viewFrom: [s - 30, s - 3],
      });
    }
  }
  for (let s = S1 + 40; s < S2 - 40; s += 150) { // forest lanterns (amber practical)
    const i = Math.round((s - S1) / 150);
    lampPost(`forest-lantern-${i}`, 'forest', s, i % 2 ? 1 : -1, { latD: 2.7, h: 2.7, range: 20, intensity: 50, halo: 2.4 });
  }

  // ---- estate --------------------------------------------------------------------------
  const E = P.ESTATE, MZ0 = E.doorZ, MZ1 = -990, MID = (MZ0 + MZ1) / 2, WH = 8.2;
  { // gate: pillars, walls, open iron leaves, gate lamp
    const b = B.props.at(E.gateZ);
    for (const side of [-1, 1]) {
      b.add(box(1.0, 3.4, 1.0), M.stone, mx(side * 3.4, 1.7, E.gateZ)); b.add(box(1.3, 0.28, 1.3), M.stone, mx(side * 3.4, 3.54, E.gateZ));
      b.add(box(34, 1.8, 0.5), M.stone, mx(side * (3.9 + 17), 0.9, E.gateZ));
      const hx = side * 2.9;
      for (let i = 0; i < 9; i++) b.add(box(0.04, 2.0, 0.04), M.iron, mx(hx, 1.1, E.gateZ - 0.15 - i * 0.29));
      b.add(box(0.05, 0.06, 2.6), M.iron, mx(hx, 0.4, E.gateZ - 1.4)); b.add(box(0.05, 0.06, 2.6), M.iron, mx(hx, 1.9, E.gateZ - 1.4));
    }
    b.add(box(0.34, 0.5, 0.34), M.lampHead, mx(-3.4, 3.95, E.gateZ));
    addLamp({ id: 'estate-gate-lamp', zone: 'estate', pos: V(-3.4, 3.95, E.gateZ), range: 24, intensity: 60, halo: 3 });
  }
  for (const side of [-1, 1]) for (let z = E.gateZ - 10; z > MZ0 - 6; z -= 4.2) // hedges along the drive
    B.props.at(z).add(box(3.8, 1.3, 1.3), M.hedge, mx(side * 6.3, 0.65, z));
  for (let s = S2 - 6; s < P.LENGTH; s += 3.2) for (const side of [-1, 1]) if (rand() < 0.55) {
    const c = lat(s, side, 11 + rand() * 32); tree(c.x, c.z, true);
  }
  for (let i = 0; i < 40; i++) { const c = lat(S2 + rand() * (P.LENGTH - S2), rand() < 0.5 ? -1 : 1, 8 + rand() * 25); bush(c.x, c.z, 0.7 + rand() * 0.8); }
  { // lodge by the gate with one anchor window
    const s = P.sAtZ(E.gateZ) + 16, p = P.pointAt(s), c = lat(s, -1, 6.5 + 2.5);
    house(c.x, c.z, Math.atan2(p.rx, p.rz), 6, 5, 3.6, 1.8, 'estate-window-lodge', 'estate');
  }
  { // manor: hollow around the corridor, facade with doorway, gabled roof, chimneys
    const b = B.props.at(MID);
    const bx = (w, h, d, x, y, z, m = M.plaster) => b.add(box(w, h, d), m, mx(x, y, z));
    const dep = MZ0 - MZ1;
    bx(15.6, WH, dep, -9.2, WH / 2, MID); bx(15.6, WH, dep, 9.2, WH / 2, MID); bx(2.8, WH - 3, dep, 0, 3 + (WH - 3) / 2, MID);
    b.add(gable(dep + 1.6, 4.5, 34 + 1.6), M.slate, mx(0, WH, MID, Math.PI / 2));
    b.add(gable(15, 6, dep + 1.6), M.slate, mx(0, WH - 1, MID));
    b.add(gableWall(14.6, 5.4, 15), M.plaster, mx(0, WH - 1, MZ0 + 0.82 + 0.02));
    b.add(plane(2.2, 2.2), M.window, mx(0, WH + 2.2, MZ0 + 0.86));
    bx(1.4, 3.4, 1.4, -8, WH + 3, MID - 6); bx(1.4, 3.4, 1.4, 8, WH + 3, MID - 6);
    bx(0.3, 3.0, 0.3, -1.55, 1.5, MZ0 + 0.1, M.frame); bx(0.3, 3.0, 0.3, 1.55, 1.5, MZ0 + 0.1, M.frame); bx(3.4, 0.3, 0.3, 0, 3.1, MZ0 + 0.1, M.frame);
    const wg = new THREE.PlaneGeometry(0.95, 1.5);
    for (const x of [-13, -9.5, 9.5, 13]) b.add(wg, M.window, mx(x, 2.1, MZ0 + 0.02));
    for (const x of [-13, -6, -3.3, 3.3, 6, 9.5, 13]) b.add(wg, M.window, mx(x, 5.6, MZ0 + 0.02));
    // wing and exit frame beyond the main block
    const wl = P.ESTATE.endZ - MZ1; // negative length
    bx(0.8, 3.6, -wl, -1.8, 1.8, MZ1 + wl / 2); bx(0.8, 3.6, -wl, 1.8, 1.8, MZ1 + wl / 2);
    bx(4.4, 0.7, -wl, 0, 3.35, MZ1 + wl / 2, M.slate);
    bx(0.3, 3.0, 0.3, -1.55, 1.5, E.endZ, M.frame); bx(0.3, 3.0, 0.3, 1.55, 1.5, E.endZ, M.frame); bx(3.4, 0.3, 0.3, 0, 3.1, E.endZ, M.frame);
    // interior shell
    const len = MZ0 - E.endZ, mid = (MZ0 + E.endZ) / 2;
    b.add(plane(len, 3.0), M.interior, mx(-1.4, 1.5, mid, Math.PI / 2));
    b.add(plane(len, 3.0), M.interior, mx(1.4, 1.5, mid, -Math.PI / 2));
    b.add(plane(2.8, len), M.interior, mx(0, 3.0, mid, 0, 1, 1, 1, Math.PI / 2));
    b.add(scaleUV(new THREE.PlaneGeometry(2.8, len), 1.2, len / 3), M.wood, mx(0, 0.04, mid, 0, 1, 1, 1, -Math.PI / 2));
    for (let i = 0; i < 8; i++) { // doors along the corridor
      const z = MZ0 - 9 - i * 11.5, dg = new THREE.PlaneGeometry(1.0, 2.2);
      b.add(dg, M.door, mx(-1.39, 1.1, z, Math.PI / 2)); b.add(dg, M.door, mx(1.39, 1.1, z + 5, -Math.PI / 2));
    }
    // ceiling light: cord, shade, bulb
    b.add(unitCyl, M.iron, mx(0, 2.55, E.lightZ, 0, 0.02, 0.45, 0.02));
    b.add(unitCone, M.iron, mx(0, 2.35, E.lightZ, 0, 0.28, 0.2, 0.28));
    b.add(box(0.16, 0.16, 0.16), M.lampHead, mx(0, 2.28, E.lightZ));
  }
  { // lit window (upper floor), anchor windows (ground floor), corridor ceiling light
    const base = mx(0, 0, MZ0);
    const lw = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.6), M.litWindow); lw.position.set(-9.5, 5.6, MZ0 + 0.05); scene.add(lw);
    addLamp({ id: 'estate-lit-window', zone: 'estate', pos: V(-9.5, 5.4, MZ0 + 1.6), range: 17, intensity: 26, halo: 5 });
    anchorWindow('estate-window-1', 'estate', base, -6, 2.1, 0.02);
    anchorWindow('estate-window-2', 'estate', base, 6, 2.1, 0.02);
    const ceil = addLamp({ id: 'estate-corridor-light', zone: 'estate', pos: V(0, 2.28, E.lightZ), range: 24, intensity: 24, halo: 2.6 });
    const sl = P.sAtZ(E.lightZ);
    anchors.ends.push({
      id: 'estate-corridor', zone: 'estate', kind: 'corridor', pos: V(0, 0, E.lightZ - 11), lightPos: ceil.pos.clone(), dir: V(0, 0, -1),
      lightRadius: 14, s: sl, viewFrom: [sl - 32, sl - 6],
    });
  }
  const litWin = scene.children.find((o) => o.material === M.litWindow);

  Object.values(B).forEach((c) => c.build(scene));

  // ---- per-frame ----------------------------------------------------------------------
  function update(cam, s, density, t) {
    const inside = P.interiorAt(s);
    moon.intensity = 2.4 * (1 - 0.92 * inside); hemi.intensity = 2.6 * (1 - 0.6 * inside);
    const k = 0.004 + 0.4 * density;
    for (const l of lamps) {
      l.d = Math.hypot(l.pos.x - cam.x, l.pos.z - cam.z);
      l.halo.material.opacity = 0.9 * l.flicker * Math.exp(-((l.d * k) ** 2)) * smooth(0.8, 4, l.d);
    }
    litWin.material.opacity = Math.exp(-((Math.hypot(litWin.position.x - cam.x, litWin.position.z - cam.z) * k) ** 2));
    const used = new Set();
    for (const light of pool) {
      let best = null, bs = Infinity;
      for (const l of lamps) { if (used.has(l)) continue; const sc = l.d - l.range; if (sc < bs) { bs = sc; best = l; } }
      used.add(best);
      light.position.copy(best.pos); light.color.copy(best.color); light.distance = best.range;
      light.intensity = best.intensity * best.flicker * (0.97 + 0.03 * Math.sin(t * 7 + best.pos.x));
    }
  }

  return { anchors, lamps, update, moon, hemi, pool };
}
