// The world: procedural geometry for village, forest and estate, pooled lamps, the apparition anchor
// sites (plain data for the director) and the toggle props the director can switch (candle, lamps, doors).
// Every place named in path.js PLACES is built here from primitives; nothing is cloned along the street.
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
const pg = (w, h) => new THREE.PlaneGeometry(w, h);
function gable(span, rise, len) {
  const sh = new THREE.Shape(); sh.moveTo(-span / 2, 0); sh.lineTo(span / 2, 0); sh.lineTo(0, rise); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); g.translate(0, 0, -len / 2); return g;
}
function gableWall(w, rise, span) { // triangular wall under a roof of the given span
  const e = rise * (1 - w / span), sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, e); sh.lineTo(0, rise); sh.lineTo(-w / 2, e); sh.closePath();
  return new THREE.ShapeGeometry(sh);
}
function wedge(w, d, rise) { // right-triangle prism, high at the back (-z): fills the sides under a shed roof
  const sh = new THREE.Shape(); sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(d / 2, rise); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2); return g;
}
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0);
const unitCone = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
const unitTaper = new THREE.CylinderGeometry(0.55, 1, 1, 6).translate(0, 0.5, 0);
const unitRock = new THREE.DodecahedronGeometry(1, 0);
const unitBush = new THREE.IcosahedronGeometry(1, 1);
const unitHip = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);

export function buildWorld(scene) {
  const rand = T.rng(1337);
  const S1 = P.GATES[0], S2 = P.GATES[1], PL = P.PLACES;
  const anchors = { windows: [], covers: [], ends: [], corners: [] };
  const lamps = [];
  const sway = [];   // per-frame animators (t, cam, dt): laundry, lantern, doors
  const toggles = {}; // switchable props for the director: shrineCandle, landingLamp, corridorDoor, sideDoor
  let lanternPos = null, sideDoor = null, sideGaze = V(0, 1.1, 0);

  // ---- materials ----------------------------------------------------------------------
  const cob = T.cobbles(), plasterTex = T.plaster(), planksTex = T.planks(), barkTex = T.bark();
  const ground = T.groundFloor();
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const dbl = THREE.DoubleSide;
  const M = {
    ground: std({ map: ground, roughness: 0.95, color: 0xffffff }),
    cobble: std({ map: cob.map, bumpMap: cob.bump, bumpScale: 2, roughness: 0.26, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    dirt: std({ map: T.dirt(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    gravel: std({ map: T.gravel(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    plaster: std({ map: plasterTex, roughness: 0.92 }),
    plasterB: std({ map: plasterTex, color: 0x9a8c7c, roughness: 0.95 }),   // warm, filthy
    plasterC: std({ map: plasterTex, color: 0x6f7a86, roughness: 0.95 }),   // cold, damp
    timber: std({ map: planksTex, color: 0x6e6050, roughness: 0.9 }),
    slate: std({ map: T.slate(), roughness: 0.6, metalness: 0.1 }),
    shingle: std({ map: barkTex, color: 0x8a7a68, roughness: 1 }),
    thatch: std({ color: 0x3a3022, roughness: 1 }),
    stone: std({ color: 0x4d5560, roughness: 0.95 }),
    stoneD: std({ color: 0x4d5560, roughness: 0.95, side: dbl }),
    iron: std({ color: 0x15181c, roughness: 0.5, metalness: 0.6 }),
    wood: std({ map: planksTex, roughness: 0.28, metalness: 0.05 }),
    woodD: std({ map: planksTex, roughness: 0.35, metalness: 0.05, side: dbl }),
    bark: std({ map: barkTex, roughness: 1 }),
    soil: std({ map: T.dirt(), color: 0x6a5e52, roughness: 1, side: dbl }),
    pine: std({ color: 0x0f1c17, roughness: 1 }),
    bush: std({ color: 0x0d1914, roughness: 1 }),
    rock: std({ color: 0x3a424c, roughness: 0.9 }),
    menhir: std({ color: 0x556068, roughness: 0.95 }),
    hedge: std({ color: 0x0c1511, roughness: 1 }),
    dead: std({ color: 0x2a2018, roughness: 1 }),
    burlap: std({ color: 0x5e4f36, roughness: 1 }),
    wax: std({ color: 0xb7ad96, roughness: 0.8 }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    window: std({ map: T.windowTex('dark'), roughness: 0.15, metalness: 0.2 }),
    door: std({ map: T.doorTex(), roughness: 0.8 }),
    doorD: std({ map: T.doorTex(), roughness: 0.8, side: dbl }),
    frame: std({ color: 0x5b646d, roughness: 0.8 }),
    curtain: std({ map: T.curtain(), roughness: 1 }),
    glass: new THREE.MeshBasicMaterial({ map: T.rainGlass(), transparent: true, depthWrite: false }),
    interior: std({ map: plasterTex, color: 0x8a8070, roughness: 0.9 }),
    interiorD: std({ map: plasterTex, color: 0x8a8070, roughness: 0.9, side: dbl }),
    rug: std({ color: 0x3a1616, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, side: dbl }),
    sheet: std({ map: T.sheet(), roughness: 1, side: dbl }),
    icon: std({ map: T.icon(), roughness: 0.7 }),
    lampHead: new THREE.MeshBasicMaterial({ color: 0xffc27a }),
    lampOff: std({ color: 0x2c2216, roughness: 0.6 }),
    litWindow: new THREE.MeshBasicMaterial({ map: T.windowTex('lit'), fog: false, transparent: true }),
    room: new THREE.MeshBasicMaterial({ map: T.roomTex() }),   // the dim inside of the open lodge window
  };
  const glowTex = T.glow(), streakTex = T.streak();
  const addMat = (tex, op) => new THREE.MeshBasicMaterial({ map: tex, color: AMBER, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
  const MStreak = addMat(streakTex, 0.5), MPool = addMat(glowTex, 0.3), MSpill = addMat(streakTex, 0.55);

  // ---- lights -------------------------------------------------------------------------
  const moon = new THREE.DirectionalLight(0x7088b8, 2.4); moon.position.set(-25, 45, 35); scene.add(moon);
  const hemi = new THREE.HemisphereLight(0x34476a, 0x10141a, 2.6); scene.add(hemi);
  // Pool of 3 amber point lights, reassigned each frame to the nearest lamps (keeps lights few).
  const pool = [0, 1, 2].map(() => { const l = new THREE.PointLight(AMBER, 0, 20, 2); scene.add(l); return l; });

  // `flicker` belongs to the director; `level` (eased toward `target`) is the on/off multiplier for toggled lamps.
  function addLamp({ id, zone, pos, range = 24, intensity = 70, halo = 5, color = AMBER, on = true }) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    sprite.position.copy(pos); sprite.scale.setScalar(halo); scene.add(sprite);
    const lamp = { id, zone, pos, range, intensity, color: new THREE.Color(color), halo: sprite, flicker: 1, level: on ? 1 : 0, target: on ? 1 : 0, d: 0 };
    lamps.push(lamp); return lamp;
  }

  // ---- placement helpers --------------------------------------------------------------
  const hw = P.halfWidth;
  const hwMax = (s, r) => { let m = 0; for (let k = -r; k <= r + 0.01; k += 1) m = Math.max(m, hw(s + k)); return m; };
  const out = (s, r, gap = 0.4) => hwMax(s, Math.ceil(r)) + r + gap;   // lateral distance for a solid prop of radius r (outside the walkable width)
  const lat = (s, side, d) => { const p = P.pointAt(s); return V(p.x + side * p.rx * d, 0, p.z + side * p.rz * d); };
  // Path frame at s: local +x = right of travel, local -z = forward, local +z = toward the player.
  const frame = (s) => { const p = P.pointAt(s); return mx(p.x, 0, p.z, Math.atan2(-p.tx, -p.tz)); };
  const B = { houses: new Chunked(), trees: new Chunked(), rocks: new Chunked(), bushes: new Chunked(), props: new Chunked() };
  // Adder into a batch in the local space of `base`: (geo, mat, x, y, z, ry, sx, sy, sz, rx, rz).
  const placed = (base, chunk = B.props) => (g, m, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => {
    const mm = base.clone().multiply(mx(x, y, z, ry, sx, sy, sz, rx, rz)); chunk.at(mm.elements[14]).add(g, m, mm);
  };
  const at = (s, chunk) => placed(frame(s), chunk);
  const world = (base, x, y, z) => V(x, y, z).applyMatrix4(base);
  const bar = (L, a, b, th, mat) => { // a box beam from local point a to local point b
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 0.01;
    L(box(th, th, len, 1), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, Math.atan2(dx, dz), 1, 1, 1, -Math.atan2(dy, Math.hypot(dx, dz)));
  };

  // ---- ground and path surfaces -------------------------------------------------------
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of P.PATH) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  { const gw = x1 - x0 + 700, gh = z1 - z0 + 700;
    ground.repeat.set(gw / 6, gh / 6);
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh).rotateX(-Math.PI / 2), M.ground);
    gm.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); scene.add(gm); }

  function ribbon(s0, s1, wfn, y, tile, mat) { // flat surface following the path, width = wfn(s)
    const pos = [], uv = [], nor = [], idx = [], n = Math.ceil(s1 - s0);
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n, p = P.pointAt(s), h = wfn(s) / 2;
      pos.push(p.x - p.rx * h, y, p.z - p.rz * h, p.x + p.rx * h, y, p.z + p.rz * h);
      uv.push(-h / tile, s / tile, h / tile, s / tile); nor.push(0, 1, 0, 0, 1, 0);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    scene.add(new THREE.Mesh(g, mat));
  }
  // Vertical or sloped surface along the path: pts = [u, off, y] with lateral = side * (halfWidth(s) * u + off);
  // each of u/off/y may be a function of s. Used for walls, ceilings, banks, floors.
  function strip(s0, s1, side, pts, mat, tile = 3) {
    const val = (v, s) => (typeof v === 'function' ? v(s) : v);
    const n = Math.max(1, Math.ceil((s1 - s0) * 1.5)), k = pts.length, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n, p = P.pointAt(s), h = hw(s);
      let len = 0, px = 0, py = 0, pz = 0;
      pts.forEach(([u, off, y], j) => {
        const d = side * (h * val(u, s) + val(off, s)), Y = val(y, s), x = p.x + p.rx * d, z = p.z + p.rz * d;
        if (j > 0) len += Math.hypot(x - px, Y - py, z - pz);
        px = x; py = Y; pz = z; pos.push(x, Y, z); uv.push(len / tile, s / tile);
      });
      if (i > 0) for (let j = 0; j < k - 1; j++) { const a = (i - 1) * k + j, c = i * k + j; idx.push(a, a + 1, c, a + 1, c + 1, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, mat));
  }
  const wVillage = (s) => { const h = hw(s); return 2 * h + 1.4 + 3 * clamp01((h - 3) / 1.5); };   // wider paved apron in the square
  const courtK = (s) => smooth(PL['estate-courtyard'].s - 17, PL['estate-courtyard'].s - 12, s) * (1 - smooth(P.DOOR_S - 6, P.DOOR_S - 1, s));
  ribbon(0, S1 + 16, wVillage, 0.02, 1.5, M.cobble);
  ribbon(S1 - 16, S2 + 16, (s) => 2 * hw(s) + 0.4, 0.015, 3, M.dirt);
  ribbon(S2 - 16, P.DOOR_S, (s) => Math.max(2 * hw(s) + 1, 18 * courtK(s)), 0.02, 3, M.gravel);

  function lampPost(id, zone, s, side, { latD = hwMax(s, 1) + 0.6, h = 3.9, range = 24, intensity = 70, halo = 5, streak = true } = {}) {
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
  function lightPool(x, z, size = 7) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), MPool);
    pm.position.set(x, 0.033, z); pm.renderOrder = 1; scene.add(pm);
  }

  // ---- windows and houses ---------------------------------------------------------------
  // `open` (the lodge): the lower sash is pushed up, so only the upper half is glazed; behind the open gap is a dim room
  // (a painted backing, the sobbing woman's billboard is hung in the group in front of it) and half a curtain.
  function anchorWindow(id, zone, base, lx, ly, lz, open = false) {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(base).multiply(mx(lx, ly, lz));
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.24), open ? M.room : M.curtain); curtain.position.z = 0.03;
    const glass = new THREE.Mesh(open ? new THREE.PlaneGeometry(0.9, 0.42) : new THREE.PlaneGeometry(0.9, 1.3), M.glass); glass.position.set(0, open ? 0.44 : 0, 0.09); glass.renderOrder = 2;
    g.add(curtain, glass);
    const fr = (w, h, x, y, z = 0.07, d = 0.14) => { const m = new THREE.Mesh(box(w, h, d), M.frame); m.position.set(x, y, z); g.add(m); };
    fr(1.12, 0.1, 0, 0.7); fr(1.12, 0.1, 0, -0.7); fr(0.1, 1.5, -0.51, 0); fr(0.1, 1.5, 0.51, 0);
    if (open) {
      fr(0.04, 0.42, 0, 0.44); fr(0.92, 0.07, 0, 0.22, 0.1, 0.06);   // the raised sash's bottom rail, up in the top third
      const half = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 1.2), M.curtain); half.position.set(-0.27, 0, 0.05); g.add(half);
    } else fr(0.04, 1.3, 0, 0);
    const sill = new THREE.Mesh(box(1.3, 0.08, 0.3), M.frame); sill.position.set(0, -0.78, 0.15); g.add(sill);
    scene.add(g);
    const pos = V(lx, ly, lz + 0.09).applyMatrix4(base), normal = V(0, 0, 1).transformDirection(base);
    anchors.windows.push({
      id, zone, pos, normal,
      interior: pos.clone().addScaledVector(normal, -0.03), // between curtain and glass
      width: 0.9, height: 1.3, glass, curtain, group: g, reserved: open,   // reserved: a beat owns it, random events skip it
      s: P.clampToPath(pos.x, pos.z).s,
    });
  }

  // A door leaf on a vertical hinge that can swing (ajar village door, corridor door).
  // base: matrix whose local +z faces out of the wall; hingeX is where the hinge sits; the leaf extends toward -x.
  function pivotDoor(base, hingeX, z, wd, ht, angle) {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(base).multiply(mx(hingeX, 0, z)); scene.add(g);
    const leaf = new THREE.Object3D(); leaf.rotation.y = angle; g.add(leaf);
    leaf.add(new THREE.Mesh(new THREE.PlaneGeometry(wd, ht).translate(-wd / 2, ht / 2, 0), M.doorD));
    const d = { leaf, cur: angle, target: angle };
    sway.push((t, cam, dt) => {
      if (Math.abs(d.target - d.cur) < 0.0005) return;
      d.cur += (d.target - d.cur) * (1 - Math.exp(-dt * 4)); leaf.rotation.y = d.cur;
    });
    return d;
  }

  const roofs = {
    gable(L, o) { // gable end faces the street
      const { w, d, h, rise, roof, wall } = o;
      L(gable(w + 0.8, rise, d + 0.6), roof, 0, h, 0);
      const gw = gableWall(w, rise, w + 0.8);
      L(gw, wall, 0, h, d / 2 + 0.02); L(gw, wall, 0, h, -d / 2 - 0.02, Math.PI);
    },
    across(L, o) { // ridge parallel to the street
      const { w, d, h, rise, roof, wall } = o;
      L(gable(d + 0.8, rise, w + 0.6), roof, 0, h, 0, Math.PI / 2);
      const gw = gableWall(d, rise, d + 0.8);
      L(gw, wall, w / 2 + 0.02, h, 0, Math.PI / 2); L(gw, wall, -w / 2 - 0.02, h, 0, -Math.PI / 2);
    },
    shed(L, o) { // lean-to, falling toward the street
      const { w, d, h, rise, roof, wall } = o;
      L(wedge(w, d, rise), wall, 0, h, 0);
      L(box(w + 0.7, 0.14, Math.hypot(d + 0.7, rise)), roof, 0, h + rise / 2 + 0.07, 0, 0, 1, 1, 1, Math.atan2(rise, d + 0.7));
    },
    hipped(L, o) {
      const { w, d, h, rise, roof } = o;
      L(unitHip, roof, 0, h, 0, 0, (w + 0.8) * 0.7071, rise, (d + 0.8) * 0.7071);
    },
    collapsed(L, o) { // one slope survives, the other is bare broken rafters
      const { w, d, h, rise, roof, wall } = o, half = (w + 0.8) / 2, sl = Math.hypot(half, rise), a = Math.atan2(rise, half);
      const gw = gableWall(w, rise, w + 0.8);
      L(gw, wall, 0, h, d / 2 + 0.02); L(gw, wall, 0, h, -d / 2 - 0.02, Math.PI);
      L(box(sl, 0.14, d + 0.6), roof, half / 2, h + rise / 2, 0, 0, 1, 1, 1, 0, -a);
      L(box(0.18, 0.18, d + 0.6), M.timber, 0, h + rise, 0);
      for (let i = 0; i < 6; i++) {
        const z = -d / 2 + 0.2 + ((d - 0.4) * i) / 5, broken = i === 1 || i === 4, len = broken ? sl * 0.5 : sl, tilt = broken ? a + 0.5 : a;
        L(box(len, 0.12, 0.12), M.timber, -(len / 2) * Math.cos(tilt), h + rise - (len / 2) * Math.sin(tilt), z, 0, 1, 1, 1, 0, tilt);
      }
      L(box(sl * 0.8, 0.14, d * 0.5), roof, -half * 0.45, h + 0.5, 0.2, 0, 1, 1, 1, 0.1, 0.5); // slabs fallen into the attic
    },
  };
  const wg = new THREE.PlaneGeometry(0.9, 1.3);

  // One house standing beside the path at s. side -1 left, +1 right; turn swings the face back toward the
  // approaching player (so an anchor window is not seen edge-on). Footprint stays outside the walkable width.
  function house(o) {
    const { s, side, w = 8, d = 7, h = 5, rise = 2.4, kind = 'gable', wall = M.plaster, roof = M.slate, gap = 0.6, turn = 0,
      anchor = null, zone = 'village', boards = [], door = 'closed', jet = 0, lean = 0, holes = 0, shutters = 0.35, chimney = true, anchorY = 1.9, openWindow = false } = o;
    const latHalf = (d / 2) * Math.cos(turn) + (w / 2) * Math.sin(turn);
    const cx = side * (hwMax(s, Math.ceil(w / 2 + 1.5)) + gap + latHalf);
    const hb = frame(s).multiply(mx(cx, 0, 0, -side * (Math.PI / 2 - turn), 1, 1, 1, 0, lean));
    const L = placed(hb, B.houses);
    const lower = jet ? 3.0 : h;
    L(box(w, lower, d), wall, 0, lower / 2, 0);
    let W = w, D = d, zc = 0, fzU = d / 2;
    const fz = d / 2;
    if (jet) { // the upper floor overhangs the street
      const h2 = h - lower; W = w + 0.5; D = d + jet; zc = jet / 2; fzU = d / 2 + jet;
      L(box(W, h2, D), M.plasterB === wall ? M.plaster : M.plasterB, 0, lower + h2 / 2, zc);
      for (const x of [-w * 0.36, 0, w * 0.36]) L(box(0.22, 0.5, jet * 0.85), M.timber, x, lower - 0.05, d / 2 + jet * 0.42);
      L(box(W + 0.1, 0.16, 0.12), M.timber, 0, lower, fzU + 0.02);
    }
    roofs[kind]((g, m, x, y, z, ...r) => L(g, m, x, y, z + zc, ...r), { w: W, d: D, h, rise, roof, wall });

    const nCol = w >= 8 ? 3 : w >= 5.5 ? 2 : 1, step = w / (nCol + 0.4);
    const xs = Array.from({ length: nCol }, (_, i) => (i - (nCol - 1) / 2) * step);
    const doorI = door === 'none' ? -1 : nCol === 1 ? 0 : 1;
    const winY = 1.8;
    const shutter = (x, y, z) => { if (rand() > shutters) return; const sd = rand() < 0.5 ? -1 : 1; L(box(0.42, 1.2, 0.04), M.timber, x + sd * 0.62, y, z + 0.1, sd * (0.4 + rand() * 0.9)); };
    const win = (key, x, y, z) => {
      L(wg, M.window, x, y, z);
      if (boards.includes(key)) for (let k = 0; k < 3; k++) L(box(1.25, 0.14, 0.05), M.timber, x + (rand() - 0.5) * 0.12, y - 0.42 + k * 0.42, z + 0.04, 0, 1, 1, 1, 0, (rand() - 0.5) * 0.45);
      else shutter(x, y, z);
    };
    const anchorI = xs.findIndex((_, i) => i !== doorI);
    xs.forEach((x, i) => {
      if (i === doorI) return;
      if (anchor && i === anchorI) anchorWindow(anchor, zone, hb, x, anchorY, fz, openWindow); else win(`g${i}`, x, winY, fz + 0.02);
    });
    const hU = jet ? lower + (h - lower) / 2 : h - 1.5;
    if (h >= 5 || jet) xs.forEach((x, i) => win(`u${i}`, x, hU, fzU + 0.02));
    if (doorI >= 0) {
      const dx = xs[doorI];
      if (door === 'ajar') {
        L(pg(1.0, 2.1), M.black, dx, 1.05, fz + 0.015);
        sideDoor = pivotDoor(hb, dx + 0.5, fz + 0.03, 1.0, 2.1, 0.75); sideGaze = world(hb, dx, 1.1, fz + 0.1);
      } else {
        L(pg(1.1, 2.1), M.door, dx, 1.05, fz + 0.02);
        if (door === 'boarded') for (let k = 0; k < 3; k++) L(box(1.4, 0.14, 0.05), M.timber, dx, 0.55 + k * 0.6, fz + 0.06, 0, 1, 1, 1, 0, (rand() - 0.5) * 0.7);
      }
    }
    for (let k = 0; k < holes; k++) L(pg(0.6 + rand() * 0.5, 0.5 + rand() * 0.5), M.black, (rand() - 0.5) * w * 0.8, 0.9 + rand() * 1.8, fz + 0.03);
    if (chimney) {
      const cy = h + rise * (kind === 'shed' ? 0.8 : kind === 'hipped' ? 0.45 : 0.55), cxp = w * (rand() < 0.5 ? 0.25 : -0.25);
      L(box(0.7, 2.2, 0.7), wall, cxp, cy, -d * 0.2 + zc, 0, 1, 1, 1, 0, (rand() - 0.5) * 0.08);
      L(box(0.95, 0.12, 0.95), M.stone, cxp, cy + 1.15, -d * 0.2 + zc);
    }
    return hb;
  }

  // ======================================================================================
  // VILLAGE
  // ======================================================================================
  { // end cap behind the start: a big dead-eyed house, boarded, listing
    const hb = frame(0).multiply(mx(0, 0, 11, Math.PI));
    const L = placed(hb, B.houses);
    L(box(10, 6, 7), M.plasterC, 0, 3, 0);
    roofs.across((g, m, x, y, z, ...r) => L(g, m, x, y, z, ...r), { w: 10, d: 7, h: 6, rise: 3, roof: M.slate, wall: M.plasterC });
    for (const x of [-3, 0, 3]) { L(wg, M.window, x, 1.9, 3.52); L(wg, M.window, x, 4.4, 3.52); }
    for (let k = 0; k < 3; k++) L(box(1.25, 0.14, 0.05), M.timber, 0, 1.5 + k * 0.4, 3.56, 0, 1, 1, 1, 0, (rand() - 0.5) * 0.4);
    L(pg(1.2, 2.2), M.door, 5.0 - 1.0, 1.1, 3.52);
  }

  const SQ = PL['village-square'].s;
  // street, ajar door, laundry
  house({ s: 17, side: 1, w: 6.4, d: 7, h: 4.6, rise: 2.5, kind: 'gable', wall: M.plasterB, roof: M.slate, door: 'ajar', boards: ['g0'], holes: 1, lean: 0.015 });
  house({ s: 12, side: -1, w: 5.4, d: 6, h: 3.7, rise: 1.5, kind: 'shed', wall: M.timber, roof: M.shingle, door: 'boarded', shutters: 0.6, lean: -0.02 });
  house({ s: 27, side: -1, w: 7.5, d: 7, h: 5.8, rise: 2.8, kind: 'across', wall: M.plaster, roof: M.slate, boards: ['u0', 'u1'], holes: 2 });
  house({ s: 34, side: 1, w: 8, d: 7, h: 6.2, rise: 3, kind: 'hipped', wall: M.plasterC, roof: M.shingle, anchor: 'village-window-1', turn: 0.55 });
  house({ s: 43, side: -1, w: 8.5, d: 8, h: 5, rise: 2.8, kind: 'collapsed', wall: M.plasterB, roof: M.slate, boards: ['g0', 'u1'], holes: 2, lean: 0.03 });
  house({ s: 45, side: 1, w: 5, d: 6, h: 3.9, rise: 1.6, kind: 'shed', wall: M.plaster, roof: M.thatch, door: 'none', lean: 0.02 });

  { // laundry line across the street with sheets that sway
    const s = PL['village-laundry'].s, half = hwMax(s, 4) + 0.55, yA = 3.7, yB = 3.3, len = half * 2;
    const f = at(s), g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(frame(s)); scene.add(g);
    f(box(len, 0.03, 0.03, 1), M.iron, 0, (yA + yB) / 2 - 0.04, 0, 0, 1, 1, 1, 0, Math.atan2(yB - yA, len));
    const sheets = [];
    [-0.62, -0.28, 0.02, 0.33, 0.66].forEach((k, i) => {
      const x = k * half, y = yA + ((yB - yA) * (x + half)) / len - 0.08, geo = new THREE.PlaneGeometry(0.95, 1.3 + (i % 2) * 0.25, 5, 3).translate(0, -0.65 - (i % 2) * 0.12, 0);
      const mesh = new THREE.Mesh(geo, M.sheet); mesh.position.set(x, y, 0); mesh.frustumCulled = false; g.add(mesh);
      sheets.push({ geo, base: geo.attributes.position.array.slice(), ph: i * 1.7 });
    });
    sway.push((t, cam) => {
      if (Math.hypot(cam.x - g.matrix.elements[12], cam.z - g.matrix.elements[14]) > 70) return;
      for (const sh of sheets) {
        const a = sh.geo.attributes.position;
        for (let i = 0; i < a.count; i++) {
          const y = sh.base[i * 3 + 1], x = sh.base[i * 3], k = Math.min(1, -y / 1.2);
          a.setZ(i, Math.sin(t * 1.5 + sh.ph + x * 3.2 + y) * 0.13 * k + Math.sin(t * 0.7 + sh.ph) * 0.1 * k);
        }
        a.needsUpdate = true;
      }
    });
  }

  // the lane: tall houses either side, the upper floors leaning over
  house({ s: 57, side: -1, w: 11, d: 8, h: 7.6, rise: 2.4, kind: 'across', wall: M.plasterB, roof: M.slate, jet: 1.1, boards: ['u0'], gap: 0.12 });
  house({ s: 59, side: 1, w: 9, d: 8, h: 7.2, rise: 3, kind: 'across', wall: M.plaster, roof: M.shingle, boards: ['g0', 'g1', 'u1', 'u2'], holes: 2, gap: 0.12, door: 'boarded' });
  house({ s: 69.5, side: -1, w: 9, d: 8, h: 6.8, rise: 3.2, kind: 'hipped', wall: M.plasterC, roof: M.slate, gap: 0.12, boards: ['u1'] });
  house({ s: 70, side: 1, w: 9, d: 8, h: 7.4, rise: 2.4, kind: 'shed', wall: M.plasterB, roof: M.slate, jet: 1.0, gap: 0.12, shutters: 0.7 });

  // the square: well, shrine, the window house across it, big houses around
  const shrineLamp = addLamp({ id: 'shrine-candle', zone: 'village', pos: V(0, 0, 0), range: 11, intensity: 13, halo: 1.5, on: false });
  let shrineHead = null;
  { // well on the right
    const s = PL['village-well'].s, X = out(s, 1.5), f = at(s);
    f(unitCyl, M.stone, X, 0, 0, 0, 1.9, 0.95, 1.9);
    f(new THREE.CircleGeometry(0.62, 10).rotateX(-Math.PI / 2), M.black, X, 0.96, 0);
    for (const z of [-1.0, 1.0]) f(box(0.14, 2.3, 0.14), M.timber, X, 1.15, z);
    f(box(0.12, 0.12, 2.2), M.timber, X, 2.2, 0);
    f(gable(2.3, 0.75, 2.5), M.shingle, X, 2.25, 0);
    f(unitCyl, M.timber, X, 1.6, -1.05, 0, 0.2, 2.1, 0.2, Math.PI / 2);
    f(box(0.02, 0.8, 0.02), M.iron, X + 0.15, 1.25, 0.1);
    f(unitTaper, M.wood, X + 0.15, 0.82, 0.1, 0, 0.32, 0.38, 0.32);
    f(unitTaper, M.wood, X + 1.3, 0, 0.9, 0, 0.3, 0.34, 0.3, 0.1, 0.9);   // a second bucket knocked over
  }
  { // shrine on the left: stone niche, small roof, icon, statuette, dead flowers
    const s = PL['village-shrine'].s, base = frame(s).multiply(mx(-(hwMax(s, 2) + 0.4 + 0.7), 0, 0, Math.PI / 2)), L = placed(base);
    L(box(1.9, 0.15, 1.5), M.stone, 0, 0.075, 0); L(box(1.6, 0.4, 1.2), M.stone, 0, 0.35, 0);
    L(box(1.3, 1.8, 0.2), M.stone, 0, 1.45, -0.35);
    for (const x of [-0.49, 0.49]) L(box(0.32, 1.8, 0.9), M.stone, x, 1.45, 0);
    L(box(1.3, 0.35, 0.9), M.stone, 0, 2.52, 0);
    L(gable(1.9, 0.6, 1.4), M.slate, 0, 2.7, 0);
    L(pg(0.62, 0.95), M.icon, 0, 1.75, -0.24);
    L(box(0.64, 0.06, 0.45), M.stone, 0, 0.95, 0.0);
    L(unitTaper, M.stone, -0.15, 0.98, 0.05, 0, 0.16, 0.42, 0.16); L(unitBush, M.stone, -0.15, 1.46, 0.05, 0, 0.08, 0.09, 0.08);
    L(unitCyl, M.wax, 0.17, 0.98, 0.05, 0, 0.06, 0.13, 0.06);
    shrineHead = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), M.wax); scene.add(shrineHead);
    shrineHead.position.copy(world(base, 0.17, 1.14, 0.05)); shrineLamp.pos.copy(world(base, 0.17, 1.2, 0.2));
    shrineLamp.halo.position.copy(shrineLamp.pos);
    L(unitTaper, M.dead, 0.65, 0.05, 0.85, 0, 0.17, 0.12, 0.17);            // dish of dead flowers
    for (let i = 0; i < 6; i++) L(unitTaper, M.dead, 0.65 + (rand() - 0.5) * 0.15, 0.12, 0.85 + (rand() - 0.5) * 0.15, rand() * 6, 0.012, 0.5 + rand() * 0.2, 0.012, (rand() - 0.5) * 0.9, (rand() - 0.5) * 0.9);
    for (let i = 0; i < 5; i++) L(unitBush, M.dead, -0.6 + rand() * 1.2, 0.18, 0.7 + rand() * 0.25, 0, 0.07, 0.03, 0.07);   // fallen petals
  }
  house({ s: 89, side: -1, w: 6.5, d: 7, h: 5.2, rise: 2.4, kind: 'gable', wall: M.plaster, roof: M.slate, boards: ['g0'], shutters: 0.5 });
  house({ s: 107, side: -1, w: 8, d: 7, h: 5.6, rise: 2.8, kind: 'gable', wall: M.plasterB, roof: M.slate, anchor: 'village-square-window', turn: 0.75, gap: 1.2 });
  house({ s: 99, side: 1, w: 10, d: 8, h: 5.6, rise: 3, kind: 'across', wall: M.plasterC, roof: M.shingle, holes: 1 });
  house({ s: 111, side: 1, w: 7, d: 7, h: 4.4, rise: 1.8, kind: 'shed', wall: M.timber, roof: M.shingle, door: 'boarded' });

  { // overturned cart, one wheel still on, one loose; sacks spilled
    const s = PL['village-cart'].s, X = out(s, 2.3, 0.4), base = frame(s).multiply(mx(X, 0.8, 0.3, 0.35 + Math.PI / 2, 1, 1, 1, -0.95, 0)), L = placed(base);
    L(box(2.3, 0.14, 1.15, 1), M.timber, 0, 0, 0);
    for (const z of [-0.58, 0.58]) L(box(2.3, 0.4, 0.08, 1), M.timber, 0, 0.2, z);
    L(box(0.08, 0.4, 1.15, 1), M.timber, -1.15, 0.2, 0);
    L(box(1.9, 0.08, 0.08, 1), M.timber, -2.1, -0.12, 0.2, 0, 1, 1, 1, 0, 0.15);   // shaft
    L(box(0.07, 0.07, 1.5, 1), M.iron, 0.3, -0.35, 0);
    const ring = new THREE.TorusGeometry(0.52, 0.06, 5, 12);
    L(ring, M.timber, 0.3, -0.35, 0.78);
    for (let k = 0; k < 4; k++) L(box(0.07, 1.0, 0.05, 1), M.timber, 0.3, -0.35, 0.78, 0, 1, 1, 1, 0, (k * Math.PI) / 4);
    const f = at(s); // loose wheel lying in the dirt further on
    f(ring, M.timber, X - 0.2, 0.1, -3.2, 0.3, 1, 1, 1, Math.PI / 2 - 0.12);
    for (let k = 0; k < 4; k++) f(box(0.07, 1.0, 0.05, 1), M.timber, X - 0.2, 0.1, -3.2, 0.3 + (k * Math.PI) / 4, 1, 1, 1, Math.PI / 2 - 0.12, Math.PI / 2);
    const gx = hwMax(s, 4) + 0.5;
    [[-1.1, 1.2], [-0.5, 2.2], [0.4, -0.6], [1.3, 0.7], [0.9, -1.6]].forEach(([dx, dz], i) =>
      f(unitBush, M.burlap, gx + 1.0 + dx + i * 0.2, 0.22, dz + (i - 2) * 0.9, rand() * 6, 0.42, 0.24 + (i % 2) * 0.05, 0.58));
    f(pg(2.4, 1.6).rotateX(-Math.PI / 2), M.dead, gx + 1.6, 0.04, 0.5);   // spilled grain
  }

  { // dead-end alley on the left, the path narrows past its mouth
    const s = PL['village-alley'].s, hwA = hwMax(s, 3), f = at(s), X0 = hwA + 0.3, len = 14.5;
    const base = frame(s);
    f(scaleUV(new THREE.PlaneGeometry(len, 3.2), len / 1.5, 3.2 / 1.5).rotateX(-Math.PI / 2), M.cobble, -(X0 + len / 2), 0.025, 0);
    for (const z of [-1.7, 1.7]) f(box(len, 5.2, 0.4), M.plasterB, -(X0 + len / 2), 2.6, z);
    f(box(0.4, 4.8, 3.8), M.plaster, -(X0 + len), 2.4, 0);
    f(unitCyl, M.wood, -(X0 + 5), 0, 1.1, 0, 0.7, 0.9, 0.7); f(box(0.7, 0.6, 0.7), M.wood, -(X0 + 8), 0.3, -1.0, 0.4);
    f(box(1.4, 0.05, 0.1), M.timber, -(X0 + 10), 1.4, 1.2, 0, 1, 1, 1, 0, 0.3);   // leaning plank
    const lp = world(base, -(X0 + len - 0.5), 2.9, 0);
    f(box(0.3, 0.4, 0.3), M.lampHead, -(X0 + len - 0.5), 2.9, 0);
    const lamp = addLamp({ id: 'village-alley-lamp', zone: 'village', pos: lp, range: 15, intensity: 40, halo: 2.4 });
    const pe = P.pointAt(s);
    anchors.ends.push({ id: 'village-alley', zone: 'village', kind: 'alley', pos: world(base, -(X0 + 8.5), 0, 0), lightPos: lamp.pos.clone(), dir: V(-pe.rx, 0, -pe.rz), lightRadius: 12, s, viewFrom: [s - 22, s + 8] });
  }
  house({ s: 127, side: -1, w: 7, d: 7, h: 4.9, rise: 2.2, kind: 'hipped', wall: M.plaster, roof: M.thatch, boards: ['g0'], gap: 0.3 });   // right edge at the alley mouth
  house({ s: 139.5, side: -1, w: 7, d: 7, h: 5.4, rise: 2.6, kind: 'gable', wall: M.plasterC, roof: M.slate, gap: 0.3, holes: 1 });
  house({ s: 128, side: 1, w: 7.5, d: 7, h: 5, rise: 2.4, kind: 'across', wall: M.plasterB, roof: M.slate, lean: -0.015 });
  house({ s: 140, side: 1, w: 8, d: 7, h: 4.8, rise: 2.2, kind: 'gable', wall: M.plaster, roof: M.shingle, boards: ['g0', 'u0'] });

  { // weak wall lantern in the lane so its walls read
    const s = 63, f = at(s), x = -(hw(s) + 0.12);
    f(box(0.2, 0.3, 0.2), M.lampHead, x, 2.7, 0);
    addLamp({ id: 'village-lane-lamp', zone: 'village', pos: world(frame(s), x + 0.25, 2.7, 0), range: 12, intensity: 18, halo: 1.8 });
  }

  // village street lamps (one pooled amber light follows the player; these are the lamp sites)
  [[8, -1], [40, 1], [86, 1], [112, -1], [146, 1]].forEach(([s, side], i) =>
    lampPost(`village-lamp-${i + 1}`, 'village', s, side, { range: 26, intensity: 75 }));
  { const lamp = lamps.find((l) => l.id === 'village-lamp-4'), s = 112, pe = P.pointAt(s + 11);
    anchors.ends.push({ id: 'village-street-1', zone: 'village', kind: 'street', pos: V(pe.x, 0, pe.z), lightPos: lamp.pos.clone(), dir: V(pe.tx, 0, pe.tz), lightRadius: 14, s, viewFrom: [s - 34, s - 6] }); }

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

  // ======================================================================================
  // FOREST
  // ======================================================================================
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
  const CL = PL['forest-clearing'].s, HO = PL['forest-hollow'].s;
  const clearK = (s) => clamp01((hw(s) - 1.9) / 1.6);                    // 1 inside the clearing, trees are pushed back
  const latFree = (s, side, extra) => lat(s, side, hw(s) + 0.9 + clearK(s) * 10 + extra);
  for (let s = S1 - 4; s < S2 + 10; s += 2.2) {
    for (const side of [-1, 1]) {
      const n = rand() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const sp = s + rand() * 2, c = lat(sp, side, hw(sp) + 1.1 + clearK(sp) * 10 + Math.pow(rand(), 1.6) * 34);
        tree(c.x, c.z, rand() < 0.35);
      }
    }
  }
  for (let i = 0; i < 150; i++) { // scattered stones
    const s = S1 - 4 + rand() * (S2 - S1 + 8), r = 0.3 + rand() * 0.9, c = latFree(s, rand() < 0.5 ? -1 : 1, r * 1.4 + rand() * 20);
    B.rocks.at(c.z).add(unitRock, M.rock, mx(c.x, r * 0.35, c.z, rand() * 6.28, r * 1.2, r * 0.75, r, rand() * 0.3, rand() * 0.3));
  }
  function bush(x, z, r = 1) {
    const b = B.bushes.at(z);
    for (let i = 0; i < 3; i++) b.add(unitBush, M.bush, mx(x + (rand() - 0.5) * r, 0.5 * r, z + (rand() - 0.5) * r, 0, r * (0.8 + rand() * 0.5), r * 0.7, r * (0.8 + rand() * 0.5)));
  }
  for (let i = 0; i < 170; i++) {
    const s = S1 - 4 + rand() * (S2 - S1 + 8), r = 0.7 + rand() * 0.8, c = latFree(s, rand() < 0.5 ? -1 : 1, r * 1.5 + rand() * 18);
    bush(c.x, c.z, r);
  }

  { // broken fence on the right, one section smashed toward the path
    const a = PL['forest-fence'].s - 14, n = 12, spacing = 28 / (n - 1), FL = placed(new THREE.Matrix4());
    const posts = [], hit = (i) => i >= 5 && i <= 7;
    for (let i = 0; i < n; i++) {
      const s = a + i * spacing, h = 1.15 + rand() * 0.35, off = hw(s) + 0.9 + (rand() - 0.5) * 0.12;
      const lean = hit(i) ? 0.55 + rand() * 0.35 : (rand() - 0.5) * 0.12;      // toward the path: top at smaller lateral
      const c = lat(s, 1, off), p = P.pointAt(s), ry = Math.atan2(-p.tx, -p.tz);
      if (i === 6) { FL(box(0.16, 0.45, 0.16), M.timber, c.x, 0.22, c.z, ry, 1, 1, 1, 0, 0.3); posts.push(null); continue; }   // snapped stump
      FL(box(0.15, h, 0.15), M.timber, c.x - p.rx * Math.sin(lean) * h / 2, Math.cos(lean) * h / 2, c.z - p.rz * Math.sin(lean) * h / 2, ry, 1, 1, 1, 0, lean);
      posts.push({ s, h, c, p, top: V(c.x - p.rx * Math.sin(lean) * h, Math.cos(lean) * h, c.z - p.rz * Math.sin(lean) * h) });
    }
    for (let i = 0; i < n - 1; i++) {
      const A = posts[i], Bp = posts[i + 1];
      if (!A || !Bp) { // rails snapped at the stump: splintered halves pointing outward from the surviving post
        const P0 = A || Bp, dir = A ? 1 : -1;
        for (const y of [0.5, 0.9]) {
          const q = V(P0.c.x, y, P0.c.z), e = V(P0.c.x + P0.p.tx * dir * 0.9 - P0.p.rx * 0.5, y - 0.25, P0.c.z + P0.p.tz * dir * 0.9 - P0.p.rz * 0.5);
          bar(FL, q, e, 0.08, M.timber);
        }
        continue;
      }
      for (const y of [0.5, 0.92]) {
        const a1 = V(A.c.x + (A.top.x - A.c.x) * (y / A.h), y, A.c.z + (A.top.z - A.c.z) * (y / A.h));
        const b1 = V(Bp.c.x + (Bp.top.x - Bp.c.x) * (y / Bp.h), y, Bp.c.z + (Bp.top.z - Bp.c.z) * (y / Bp.h));
        if (hit(i) && hit(i + 1)) { // smashed: rails kicked in toward the path, one end on the ground
          const drop = V(b1.x - A.p.rx * 1.3, 0.08 + rand() * 0.1, b1.z - A.p.rz * 1.3);
          bar(FL, a1, V((a1.x + drop.x) / 2, (a1.y + drop.y) / 2, (a1.z + drop.z) / 2), 0.08, M.timber);
          bar(FL, drop, V(drop.x - A.p.rx * 0.8 + A.p.tx * 0.7, 0.07, drop.z - A.p.rz * 0.8 + A.p.tz * 0.7), 0.07, M.timber);
        } else bar(FL, a1, b1, 0.08, M.timber);
      }
    }
  }

  { // clearing: ring of standing stones (one fallen) beside the path, a lantern on a dead tree at its edge
    const sr = CL, R = 4.2, cxl = -(hw(sr) + 0.6 + R), f = at(sr), base = frame(sr);
    const stones = [];
    for (let k = 0; k < 10; k++) {
      const th = (k / 10) * Math.PI * 2 + (rand() - 0.5) * 0.18, x = cxl + R * Math.cos(th), z = R * Math.sin(th);
      const w = 0.7 + rand() * 0.4, h = 1.5 + rand() * 1.0, ry = Math.atan2(cxl - x, -z);
      if (k === 3) f(unitRock, M.menhir, x, 0.4, z, ry + 0.4, w * 0.9, 0.42, h * 0.55, 0, 0.12);   // the fallen one
      else f(unitRock, M.menhir, x, h * 0.45, z, ry, w, h, 0.38 + rand() * 0.15, (rand() - 0.5) * 0.14, (rand() - 0.5) * 0.14);
      stones.push({ x, z, k });
    }
    f(box(1.3, 0.25, 0.9), M.menhir, cxl, 0.12, 0, 0.5);   // flat stone at the centre
    // dead tree with the lantern branch
    const sl = PL['forest-lantern'].s, tx = -(hw(sl) + 1.0), lf = at(sl, B.trees);
    lf(unitTaper, M.bark, tx, 0, 0, 0, 0.36, 6.8, 0.36, 0.04, 0.03);
    for (let i = 0; i < 5; i++) lf(unitTaper, M.bark, tx, 3.6 + rand() * 2.8, 0, rand() * 6.28, 0.07, 1.6 + rand() * 1.8, 0.07, 0.9 + rand() * 0.5);
    const ex = tx + 1.55, ey = 3.15; // branch end over the path edge
    bar(lf, V(tx, 3.7, 0), V(ex, ey, 0.1), 0.13, M.bark);
    lf(unitTaper, M.bark, ex - 0.4, ey + 0.1, 0.1, 0, 0.05, 0.7, 0.05, 0.2, -0.9);
    const pivot = new THREE.Group(); const pw = world(base, ex, ey, 0.1); pivot.position.copy(pw); scene.add(pivot);
    const cage = new THREE.Group(); pivot.add(cage);
    const lm = (g, m, y) => { const o = new THREE.Mesh(g, m); o.position.y = y; cage.add(o); return o; };
    lm(box(0.012, 0.5, 0.012, 1), M.iron, -0.25);
    lm(box(0.3, 0.05, 0.3), M.iron, -0.52); lm(box(0.22, 0.34, 0.22), M.lampHead, -0.7); lm(box(0.3, 0.05, 0.3), M.iron, -0.89);
    const lpos = world(base, ex, ey - 0.7, 0.1);
    const lamp = addLamp({ id: 'forest-lantern', zone: 'forest', pos: lpos, range: 24, intensity: 60, halo: 3.2 });
    lightPool(lpos.x, lpos.z, 9);
    sway.push((t) => { cage.rotation.z = Math.sin(t * 0.9) * 0.05; cage.rotation.x = Math.sin(t * 0.63 + 1) * 0.035; });
    lanternPos = lpos;
    // the cover: the ring stone nearest the lantern, so a creature there reads by its light
    let best = null, bd = 1e9;
    for (const st of stones) { if (st.k === 3) continue; const w = world(base, st.x, 0, st.z), d = w.distanceTo(lpos); if (d < bd) { bd = d; best = w; } }
    const c = best, p = P.pointAt(P.clampToPath(c.x, c.z).s), side = -1, s = p.s;
    const peek = V(c.x - p.tx * 0.8 - side * p.rx * 0.35, 1.3, c.z - p.tz * 0.8 - side * p.rz * 0.35);
    const look = P.pointAt(s - 6), face = V(look.x - peek.x, 0, look.z - peek.z).normalize();
    anchors.covers.push({ id: 'forest-clearing-stone', zone: 'forest', kind: 'stone', side: 'left', s, pos: V(c.x, 0, c.z), peekPos: peek, faceDir: face, radius: 1, viewFrom: [s - 30, s - 3], lightPos: lamp.pos.clone() });
  }

  { // hollow: earth banks, roots, overhanging dead branches
    const hk = (s) => smooth(HO - 22, HO - 12, s) * (1 - smooth(HO + 12, HO + 22, s));
    for (const side of [-1, 1]) strip(HO - 24, HO + 24, side, [
      [1, 0.05, 0.1], [1, 0.9, (s) => 1.5 * hk(s) + 0.1], [1, 2.3, (s) => 2.15 * hk(s) + 0.1], [1, 6, (s) => 2.6 * hk(s) + 0.1],
    ], M.soil, 3);
    for (let i = 0; i < 20; i++) {
      const s = HO - 12 + rand() * 24, side = rand() < 0.5 ? -1 : 1, f = at(s, B.trees);
      f(unitTaper, M.bark, side * (hw(s) + 0.12), 0.05 + rand() * 0.7, 0, rand() * 0.5, 0.1 + rand() * 0.07, 1.2 + rand() * 1.1, 0.1, 0, -side * (0.8 + rand() * 0.6));
    }
    for (let i = 0; i < 9; i++) {
      const s = HO - 12 + (i / 8) * 24 + (rand() - 0.5) * 2, side = i % 2 ? -1 : 1, f = at(s, B.trees), y = 2.55 + rand() * 0.6, len = 3.4 + rand() * 1.6;
      f(unitTaper, M.bark, side * (hw(s) + 3.2), y, 0, 0, 0.09, len, 0.09, 0.05, side * (Math.PI / 2 - 0.1 + rand() * 0.2));
      for (let k = 0; k < 2; k++) f(unitTaper, M.bark, side * (hw(s) + 2.4 - k * 1.3), y + 0.1, 0, 0, 0.035, 0.8 + rand() * 0.6, 0.035, rand() * 0.8, side * (Math.PI / 2 - 0.9 - rand() * 0.8) + (rand() - 0.5));
    }
    lampPost('forest-lantern-1', 'forest', S1 + 14, 1, { latD: hwMax(S1 + 14, 1) + 0.6, h: 2.7, range: 20, intensity: 50, halo: 2.4 });
    lampPost('forest-lantern-2', 'forest', HO + 24, -1, { latD: hwMax(HO + 24, 1) + 0.6, h: 2.7, range: 20, intensity: 50, halo: 2.4 });
  }
  { // cover spots beside the path: stone / foliage; sides alternate. (The clearing stone is built above.)
    [[160, -1, 'foliage'], [196, -1, 'stone'], [246, 1, 'foliage'], [290, -1, 'stone'], [296, 1, 'foliage'], [172, 1, 'stone']].forEach(([s, side, kind], i) => {
      const p = P.pointAt(s), c = lat(s, side, hw(s) + 1.3);
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
    });
  }

  // ======================================================================================
  // ESTATE
  // ======================================================================================
  const DS = P.DOOR_S, ES = P.END_S, WH = 8.2;
  const hallEnd = 388, CH = (s) => 2.9 + 1.5 * (1 - smooth(hallEnd - 1, hallEnd + 2, s));   // ceiling height: hall tall, corridor low
  const bay = (s) => smooth(DS + 1.5, DS + 3.5, s) * (1 - smooth(389, 391, s));              // the stair bay widens the hall's left side
  const wl = (s) => 0.05 + 2.2 * bay(s);   // left wall offset beyond the walkable width (stair bay)
  const wr = (s) => 0.05 + 0.55 * bay(s);  // right wall offset (a shallow alcove for the hall furniture)
  { // estate gate: pillars, walls, open iron leaves, gate lamp
    const s = PL['estate-gate'].s, f = at(s);
    for (const side of [-1, 1]) {
      f(box(1.0, 3.4, 1.0), M.stone, side * 3.4, 1.7, 0); f(box(1.3, 0.28, 1.3), M.stone, side * 3.4, 3.54, 0);
      f(box(34, 1.8, 0.5), M.stone, side * (3.9 + 17), 0.9, 0);
      const hx = side * 2.9;
      for (let i = 0; i < 9; i++) f(box(0.04, 2.0, 0.04), M.iron, hx, 1.1, -0.15 - i * 0.29);
      f(box(0.05, 0.06, 2.6), M.iron, hx, 0.4, -1.4); f(box(0.05, 0.06, 2.6), M.iron, hx, 1.9, -1.4);
    }
    f(box(0.34, 0.5, 0.34), M.lampHead, -3.4, 3.95, 0);
    addLamp({ id: 'estate-gate-lamp', zone: 'estate', pos: world(frame(s), -3.4, 3.95, 0), range: 24, intensity: 60, halo: 3 });
  }
  { // hedged drive: hedges both sides, uneven and overgrown
    for (let s = 326; s < 345; s += 4.2) for (const side of [-1, 1]) {
      if (side < 0 && s > 328 && s < 340) continue;   // the lodge stands here
      const hh = 1.0 + rand() * 0.7, f = at(s);
      f(box(1.3, hh, 3.8), M.hedge, side * (hw(s) + 0.4 + 0.65), hh / 2, 0, (rand() - 0.5) * 0.08);
      if (rand() < 0.5) f(unitBush, M.hedge, side * (hw(s) + 1.1), hh + 0.1, (rand() - 0.5) * 2, 0, 0.8, 0.5, 0.8);
    }
  }
  for (let s = S2 - 6; s < DS - 6; s += 3.2) for (const side of [-1, 1]) if (rand() < 0.55) {
    const c = lat(s, side, 11 + rand() * 32); tree(c.x, c.z, true);
  }
  for (let i = 0; i < 40; i++) { const c = lat(S2 + rand() * (DS - S2), rand() < 0.5 ? -1 : 1, 11 + rand() * 25); bush(c.x, c.z, 0.7 + rand() * 0.8); }
  house({ s: PL['estate-lodge'].s, side: -1, w: 6, d: 5, h: 3.6, rise: 1.8, kind: 'gable', wall: M.plasterC, roof: M.slate, anchor: 'estate-window-lodge', zone: 'estate', turn: 0.6, gap: 0.7, anchorY: 1.45, openWindow: true });

  { // courtyard: walls, dead fountain off-centre, a dead tree, a wall lantern
    const c0 = PL['estate-courtyard'].s - 13, c1 = DS - 0.5, f = at(PL['estate-courtyard'].s);
    for (const side of [-1, 1]) {
      strip(c0, c1, side, [[0, 9, 0], [0, 9, 2.7]], M.stoneD, 3);
      strip(c0, c1, side, [[0, 8.75, 2.7], [0, 9.3, 2.7]], M.stoneD, 3);
      const fr = at(c0); fr(box(4.8, 2.7, 0.5), M.stone, side * 6.6, 1.35, 0);   // wall return at the drive
      for (let s = c0 + 4; s < c1; s += 8) at(s)(box(0.7, 3.2, 0.7), M.stone, side * 9, 1.6, 0);
    }
    const fx = 5.6;
    f(new THREE.TorusGeometry(1.25, 0.2, 6, 14).rotateX(Math.PI / 2), M.stone, fx, 0.6, 0);
    f(unitCyl, M.stone, fx, 0, 0, 0, 2.5, 0.6, 2.5);
    f(new THREE.CircleGeometry(1.1, 12).rotateX(-Math.PI / 2), M.black, fx, 0.55, 0);
    f(unitTaper, M.stone, fx, 0.3, 0, 0, 0.5, 1.5, 0.5);
    f(unitCyl, M.stone, fx, 1.7, 0, 0, 1.1, 0.18, 1.1, 0.15, 0.12);          // tilted dry bowl
    f(unitRock, M.stone, fx + 1.0, 0.25, 1.6, 0.7, 0.45, 0.3, 0.4);          // a chunk of the rim
    for (let i = 0; i < 8; i++) f(unitBush, M.dead, fx + (rand() - 0.5) * 1.6, 0.58, (rand() - 0.5) * 1.6, 0, 0.12, 0.02, 0.1);
    const dt = lat(PL['estate-courtyard'].s + 3, -1, 6.4); tree(dt.x, dt.z, true);
    const lx = at(PL['estate-courtyard'].s - 6);
    lx(box(0.3, 0.4, 0.3), M.lampHead, -8.6, 2.5, 0);
    addLamp({ id: 'estate-courtyard-lamp', zone: 'estate', pos: world(frame(PL['estate-courtyard'].s - 6), -8.6, 2.5, 0), range: 16, intensity: 28, halo: 2 });
  }

  const mid = -17;   // manor block: x -17.4..17, z 0..-34 in the door frame
  const hallLamp = (() => { const l = world(frame(DS), 0, 3.45, -3.6); return addLamp({ id: 'estate-hall-lamp', zone: 'estate', pos: l, range: 18, intensity: 38, halo: 4 }); })();
  const landingLamp = addLamp({ id: 'estate-landing-lamp', zone: 'estate', pos: world(frame(DS), -3.0, 3.6, -12.4), range: 12, intensity: 20, halo: 1.8, on: false });
  let landingHead = null;
  { // manor: solid shell seen from outside (its faces cull from inside), facade, doorway, roof
    const f = at(DS), bx = (w, h, d, x, y, z, m = M.plaster) => f(box(w, h, d), m, x, y, z);
    const dep = 34;
    // facade slabs with the doorway cut out; the other three walls are single outward-facing planes (culled from inside,
    // so the hall and corridor strips below are what the player sees)
    bx(15.85, WH, 0.6, -9.475, WH / 2, -0.3); bx(15.45, WH, 0.6, 9.275, WH / 2, -0.3); bx(3.1, WH - 3.3, 0.6, 0, 3.3 + (WH - 3.3) / 2, -0.3);
    f(plane(dep, WH), M.plaster, -17.4, WH / 2, mid, -Math.PI / 2); f(plane(dep, WH), M.plaster, 17, WH / 2, mid, Math.PI / 2); f(plane(34.4, WH), M.plaster, -0.2, WH / 2, -dep, Math.PI);
    f(gable(dep + 1.6, 4.5, 36), M.slate, -0.2, WH, mid, Math.PI / 2);
    f(gable(15, 6, dep + 1.6), M.slate, 0, WH - 1, mid);
    f(gableWall(14.6, 5.4, 15), M.plaster, 0, WH - 1, 0.82 + 0.02);
    f(pg(2.2, 2.2), M.window, 0, WH + 2.2, 0.86);
    bx(1.4, 3.4, 1.4, -8, WH + 3, mid + 11); bx(1.4, 3.4, 1.4, 8, WH + 3, mid + 11);
    for (const x of [-15.2, -11.3, -7.9, -4.2, 4.2, 7.9, 11.3, 15.2]) bx(0.6, WH, 0.5, x, WH / 2, 0.2, M.stone);   // pilasters
    bx(18, 0.25, 0.6, -8, 3.6, 0.3, M.stone); bx(18, 0.25, 0.6, 8, 3.6, 0.3, M.stone);                                 // string course
    bx(0.3, 3.0, 0.3, -1.55, 1.5, 0.1, M.frame); bx(0.3, 3.0, 0.3, 1.55, 1.5, 0.1, M.frame); bx(3.4, 0.3, 0.3, 0, 3.1, 0.1, M.frame);
    bx(5.2, 0.18, 1.6, 0, 0.09, 0.8, M.stone); bx(4.2, 0.18, 1.0, 0, 0.27, 0.5, M.stone);                               // steps
    for (const x of [-2.3, 2.3]) f(unitCyl, M.stone, x, 0, 1.1, 0, 0.5, 3.4, 0.5);                                      // porch columns
    f(box(0.07, 3.0, 1.5), M.wood, 1.78, 1.5, 0.78, 0.22);                                                               // the open door leaf, swung out against the porch
    const wgl = new THREE.PlaneGeometry(0.95, 1.5);
    for (const x of [-13, -9.5, 9.5, 13]) f(wgl, M.window, x, 2.1, 0.02);
    for (const x of [-13, -6, -3.3, 3.3, 6, 9.5, 13]) f(wgl, M.window, x, 5.6, 0.02);
    f(box(0.5, 1.5, 0.05), M.timber, 13.6, 2.05, 0.08, 0, 1, 1, 1, 0, 0.5);                                               // a shutter torn loose
    // exit frame beyond the corridor
    const fe = at(ES);
    fe(box(0.3, 3.0, 0.3), M.frame, -1.45, 1.5, 0); fe(box(0.3, 3.0, 0.3), M.frame, 1.45, 1.5, 0); fe(box(3.2, 0.3, 0.3), M.frame, 0, 3.1, 0);
    // dark window upstairs, the lit one
    const lw = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.6), M.litWindow); lw.position.copy(world(frame(DS), -9.5, 5.6, 0.05)); lw.quaternion.setFromRotationMatrix(frame(DS)); scene.add(lw);
    addLamp({ id: 'estate-lit-window', zone: 'estate', pos: world(frame(DS), -9.5, 5.4, 1.6), range: 17, intensity: 26, halo: 5 });
    const base = frame(DS);
    anchorWindow('estate-window-1', 'estate', base, -6, 2.1, 0.02);
    anchorWindow('estate-window-2', 'estate', base, 6, 2.1, 0.02);
    // hall light spilling out of the door onto the court
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 11).rotateX(-Math.PI / 2), MSpill);
    spill.matrixAutoUpdate = false; spill.matrix.copy(base).multiply(mx(0, 0.045, 5.6)); spill.renderOrder = 1; scene.add(spill);
  }

  { // interior: hall (stairs to a dark landing), corridor (one bend, one ceiling light, doors), built along the path
    const wallY = (s) => CH(s);
    const wallL = [[1, wl, 0], [1, wl, wallY]], wallR = [[1, wr, 0], [1, wr, wallY]];
    strip(DS, ES, -1, wallL, M.interiorD, 3); strip(DS, ES, 1, wallR, M.interiorD, 3);
    strip(DS, ES, -1, [[1, (s) => wl(s) - 0.02, 0], [1, (s) => wl(s) - 0.02, 1.0]], M.woodD, 2);    // wainscot
    strip(DS, ES, 1, [[1, (s) => wr(s) - 0.02, 0], [1, (s) => wr(s) - 0.02, 1.0]], M.woodD, 2);
    strip(DS, ES, -1, [[0, 0, wallY], [1, wl, wallY]], M.interiorD, 3); strip(DS, ES, 1, [[0, 0, wallY], [1, wr, wallY]], M.interiorD, 3);
    strip(DS, ES + 2, -1, [[0, 0, 0.04], [1, wl, 0.04]], M.woodD, 3); strip(DS, ES + 2, 1, [[0, 0, 0.04], [1, wr, 0.04]], M.woodD, 3);
    strip(DS, ES, 1, [[0, -0.8, 0.05], [0, 0.8, 0.05]], M.rug, 3);                                     // runner

    const f = at(DS);   // hall features in the door frame (the hall is straight): x right, z = -(s - DS)
    // staircase up the left side to the landing
    const n = 14, rise = 0.22, run = 0.55, z0s = 3.3, sx = -3.55;
    for (let i = 0; i < n; i++) f(box(2.0, rise * (i + 1), run), M.timber, sx, (rise * (i + 1)) / 2, -(z0s + i * run + run / 2));
    const lz = z0s + n * run;          // landing start (f)
    f(box(2.0, 3.0, 4.0), M.timber, sx, 1.5, -(lz + 2)); f(box(2.0, 0.12, 4.0), M.woodD, sx, 3.07, -(lz + 2));
    f(box(2.0, 1.3, 0.1), M.black, sx, 3.75, -(lz + 4.05));                                              // dark doorway above
    for (let i = 0; i <= n; i += 2) f(box(0.07, 0.95, 0.07), M.timber, -2.52, rise * i + 0.5, -(z0s + i * run));
    bar(f, V(-2.52, 0.98, -z0s), V(-2.52, rise * n + 0.98, -lz), 0.08, M.timber);
    f(box(0.07, 0.95, 0.07), M.timber, -2.52, 3.55, -(lz + 2)); f(box(0.07, 0.95, 0.07), M.timber, -2.52, 3.55, -(lz + 4));
    bar(f, V(-2.52, 4.03, -lz), V(-2.52, 4.03, -(lz + 4)), 0.08, M.timber);
    f(box(0.2, 0.3, 0.2), M.iron, -3.0, 3.28, -(lz + 1.4));
    landingHead = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), M.lampOff); landingHead.position.copy(world(frame(DS), -3.0, 3.5, -(lz + 1.4))); scene.add(landingHead);
    landingLamp.pos.copy(landingHead.position); landingLamp.halo.position.copy(landingHead.position);
    { const pd = P.pointAt(DS);   // the landing's upper corner beside the lamp (the ceiling woman crouches here), plane faces along the path toward the corridor, where you look back from
      anchors.corners.push({ id: 'estate-landing-corner', zone: 'estate', pos: world(frame(DS), -3.4, 4.3, -13.3), yaw: Math.atan2(pd.tx, pd.tz), lamp: 'estate-landing-lamp' }); }
    // hall: doors in the right wall, a dead chandelier above the lamp, a hall table
    for (const z of [-5.5, -9.5]) f(pg(1.3, 2.6), M.door, 2.93, 1.3, z, -Math.PI / 2);
    f(unitCyl, M.iron, 0, 3.3, -3.6, 0, 0.02, 1.1, 0.02); f(unitCone, M.iron, 0, 3.15, -3.6, 0, 0.5, 0.25, 0.5); f(box(0.18, 0.18, 0.18), M.lampHead, 0, 3.4, -3.6);
    f(box(0.5, 0.75, 1.5), M.timber, 2.72, 0.375, -7.5); f(box(0.35, 0.6, 0.35), M.iron, 2.72, 1.05, -7.5);

    // corridor doors (both sides), one of them pivots and is closed at start
    const doorAt = (s, side, pivot) => {
      const wx = side * (hw(s) + 0.03), base = frame(s).multiply(mx(wx, 0, 0, -side * Math.PI / 2)), L = placed(base);
      L(box(1.2, 0.1, 0.07, 1), M.timber, 0, 2.3, 0.03); L(box(0.1, 2.3, 0.07, 1), M.timber, -0.58, 1.15, 0.03); L(box(0.1, 2.3, 0.07, 1), M.timber, 0.58, 1.15, 0.03);
      if (!pivot) { L(pg(1.0, 2.2), M.door, 0, 1.1, 0.04); return null; }
      L(pg(1.0, 2.2), M.black, 0, 1.1, 0.015);
      return { pd: pivotDoor(base, 0.5, 0.03, 1.0, 2.2, 0), gaze: world(base, 0, 1.2, 0.1) };
    };
    doorAt(393.5, 1, false); doorAt(411.5, 1, false); doorAt(415.5, -1, false);
    const cd = doorAt(397, -1, true);
    toggles.corridorDoor = { id: 'corridorDoor', gaze: cd.gaze, open: false, set(open) { this.open = !!open; cd.pd.target = open ? 0.95 : 0; } };
    addLamp({ id: 'estate-exit-glow', zone: 'estate', pos: world(frame(ES), 0, 1.6, -1.2), range: 16, intensity: 12, halo: 3.4, color: 0x7f97b8 });   // cold fog light beyond the exit door
    // the corridor ceiling light
    const sl = PL['estate-corridor'].s, lf = at(sl);
    lf(unitCyl, M.iron, 0, 2.5, 0, 0, 0.02, 0.45, 0.02); lf(unitCone, M.iron, 0, 2.3, 0, 0, 0.28, 0.2, 0.28); lf(box(0.16, 0.16, 0.16), M.lampHead, 0, 2.23, 0);
    const ceil = addLamp({ id: 'estate-corridor-light', zone: 'estate', pos: world(frame(sl), 0, 2.23, 0), range: 24, intensity: 24, halo: 2.6 });
    const pe = P.pointAt(sl + 4);
    anchors.ends.push({ id: 'estate-corridor', zone: 'estate', kind: 'corridor', pos: V(pe.x + pe.rx * 0.3, 0, pe.z + pe.rz * 0.3), lightPos: ceil.pos.clone(), dir: V(pe.tx, 0, pe.tz), lightRadius: 14, s: sl, viewFrom: [sl - 18, sl - 4] });
    // doorway end anchor: someone standing backlit in the open front door
    const base = frame(DS);
    anchors.ends.push({ id: 'estate-courtyard-door', zone: 'estate', kind: 'door', pos: world(base, 0, 0, -0.5), lightPos: hallLamp.pos.clone(), dir: V(P.pointAt(DS).tx, 0, P.pointAt(DS).tz), lightRadius: 12, s: DS, viewFrom: [DS - 30, DS - 8] });
  }

  const litWin = scene.children.find((o) => o.material === M.litWindow);
  Object.values(B).forEach((c) => c.build(scene));

  // ---- toggle props (the director switches these) -------------------------------------
  const lampToggle = (id, lamp, head, gaze) => ({
    id, gaze, on: false,
    set(on) { this.on = !!on; lamp.target = on ? 1 : 0; head.material = on ? M.lampHead : id === 'shrineCandle' ? M.wax : M.lampOff; },
  });
  toggles.shrineCandle = lampToggle('shrineCandle', shrineLamp, shrineHead, shrineLamp.pos.clone());
  toggles.landingLamp = lampToggle('landingLamp', landingLamp, landingHead, landingLamp.pos.clone());
  // the ajar door of the village house at s = 17: closed state is ajar (0.75 rad), open swings wide
  toggles.sideDoor = { id: 'sideDoor', gaze: sideGaze, open: false, set(open) { this.open = !!open; sideDoor.target = open ? 1.5 : 0.75; } };

  // ---- places ------------------------------------------------------------------------
  const places = {};
  for (const [id, pl] of Object.entries(P.PLACES)) { const p = P.pointAt(pl.s); places[id] = { s: pl.s, pos: id === 'forest-lantern' ? lanternPos : V(p.x, 0, p.z) }; }

  // ---- per-frame ----------------------------------------------------------------------
  let tPrev = 0;
  function update(cam, s, density, t) {
    const dt = Math.min(0.1, Math.max(0, t - tPrev)); tPrev = t;
    const inside = P.interiorAt(s);
    moon.intensity = 2.4 * (1 - 0.92 * inside); hemi.intensity = 2.6 * (1 - 0.6 * inside);
    const k = 0.004 + 0.4 * density;
    for (const l of lamps) {
      l.level += (l.target - l.level) * (1 - Math.exp(-dt * 8));
      l.d = Math.hypot(l.pos.x - cam.x, l.pos.z - cam.z);
      l.halo.material.opacity = 0.9 * l.flicker * l.level * Math.exp(-((l.d * k) ** 2)) * smooth(0.8, 4, l.d);
    }
    litWin.material.opacity = Math.exp(-((Math.hypot(litWin.position.x - cam.x, litWin.position.z - cam.z) * k) ** 2));
    const used = new Set();
    for (const light of pool) {
      let best = null, bs = Infinity;
      for (const l of lamps) { if (used.has(l) || l.level < 0.02) continue; const sc = l.d - l.range; if (sc < bs) { bs = sc; best = l; } }
      if (!best) { light.intensity = 0; continue; }
      used.add(best);
      light.position.copy(best.pos); light.color.copy(best.color); light.distance = best.range;
      light.intensity = best.intensity * best.flicker * best.level * (0.97 + 0.03 * Math.sin(t * 7 + best.pos.x));
    }
    for (const fn of sway) fn(t, cam, dt);
  }

  return { anchors, lamps, update, moon, hemi, pool, places, toggles };

}
