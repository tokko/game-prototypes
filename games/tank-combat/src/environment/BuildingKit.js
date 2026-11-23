// Shared toolkit for static structures: materials, per-material geometry buckets (merged at the end, vertex-tinted,
// base-AO baked), wall panels with real window/door/shell holes, roof slabs. Keeps the whole village at ~12 draw calls.
import {
  Group, Mesh, MeshStandardMaterial, BufferGeometry, Float32BufferAttribute, BoxGeometry, Shape, Path, ExtrudeGeometry,
  Matrix4, Quaternion, Euler, Vector3, Color,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep, lerp } from '../util/math.js';
import { patchMaterial } from './Atmosphere.js';
import {
  makeStoneWall, makePlasterTall, makeTileRoof, makeSlateRoof, makePlanks, makeConcrete, makeBurnt,
} from './ProcTextures.js';
import { makeMetalRoofTexture } from './Textures.js';

export const hexLin = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };

// palettes (sRGB hex from the environment spec, stored linear)
export const PAL = {
  stone: ['#9a8e7a', '#857a68', '#a89c86', '#6f665a', '#b3a690'].map(hexLin),
  plaster: ['#d8cdb5', '#cdb99a', '#c9c3b4', '#b9a184', '#d6c4a0', '#c9ab9a'].map(hexLin),
  brick: ['#8d5a48'].map(hexLin),
  tile: ['#9a4a32', '#a8573a', '#874030', '#b06844', '#7c4a3a'].map(hexLin),
  slate: ['#4f535c', '#5b5f68', '#444852', '#626570'].map(hexLin),
  timber: ['#6b5a46', '#5a4a39', '#3e3328', '#8a7154', '#7d776c'].map(hexLin),
  barn: ['#7e2f25', '#8c3a2b', '#6e3a30'].map(hexLin),
  trim: hexLin('#d9d4c8'),
  shutter: ['#4b5a45', '#5a4535'].map(hexLin),
  glass: hexLin('#1d2226'),
  interior: hexLin('#0d0b09'),
  concrete: hexLin('#8f8c85'),
  bunker: hexLin('#7c7a72'),
  metalRoof: hexLin('#7b7d7f'),
  burnt: ['#2b2724', '#3a332d'].map(hexLin),
};

const TILES = { stone: [2, 2], plaster: [2, 8], tile: [2, 2], slate: [2, 2], timber: [2, 2], barn: [2, 2], concrete: [2, 2], metal: [2, 2], rubble: [2, 2], burnt: [3, 3], trim: [2, 2], glass: [2, 2], interior: [2, 2] };

export function createMaterials() {
  const stone = makeStoneWall();
  const tile = makeTileRoof(), slate = makeSlateRoof();
  const planks = makePlanks(true);
  const mk = (o) => patchMaterial(new MeshStandardMaterial(Object.assign({ vertexColors: true, metalness: 0, roughness: 0.9, envMapIntensity: 0.5 }, o)));
  const burntTex = makeBurnt();
  return {
    stone: mk({ map: stone.map, bumpMap: stone.bump, bumpScale: 2.0 }),
    rubble: mk({ map: stone.map, bumpMap: stone.bump, bumpScale: 2.0 }),
    plaster: mk({ map: makePlasterTall(), roughness: 0.92 }),
    tile: mk({ map: tile.map, bumpMap: tile.bump, bumpScale: 2.5, roughness: 0.8 }),
    slate: mk({ map: slate.map, bumpMap: slate.bump, bumpScale: 1.5, roughness: 0.6 }),
    timber: mk({ map: planks, roughness: 0.85 }),
    barn: mk({ map: planks, roughness: 0.85 }),
    trim: mk({ roughness: 0.7 }),
    glass: mk({ roughness: 0.12, envMapIntensity: 1.0 }),
    interior: mk({ roughness: 1, envMapIntensity: 0 }),
    concrete: mk({ map: makeConcrete(), roughness: 0.95 }),
    metal: mk({ map: makeMetalRoofTexture(), roughness: 0.6, metalness: 0.35 }),
    burnt: mk({ map: burntTex, roughness: 0.95 }),
  };
}

function metricWallUV(g, key, y0) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const [tu, tv] = TILES[key] || [2, 2];
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
    let u, v;
    if (ny > nx && ny > nz) { u = p.getX(i) / tu; v = p.getZ(i) / tv; }
    else { u = (nx > nz ? p.getZ(i) : p.getX(i)) / tu; v = (p.getY(i) - y0) / tv; }
    uv.setXY(i, u, v);
  }
}

export class Kit {
  constructor(mats) {
    this.mats = mats;
    this.buckets = {};
    this._m = new Matrix4(); this._q = new Quaternion(); this._e = new Euler(); this._v = new Vector3(); this._s = new Vector3(1, 1, 1);
    this.colliders = [];
  }

  // geo: any geometry with position/normal/uv. opts: { color, m (Matrix4), y0 (ground y for wall UV/AO), uv: 'wall'|'keep', ao }
  add(key, geo, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (opts.m) g.applyMatrix4(opts.m);
    const y0 = opts.y0 !== undefined ? opts.y0 : 0;
    if (opts.uv !== 'keep') metricWallUV(g, key, y0);
    const col = opts.color || [1, 1, 1];
    const p = g.attributes.position, arr = new Float32Array(p.count * 3);
    const ao = opts.ao !== false;
    const top = opts.eaveY;
    for (let i = 0; i < p.count; i++) {
      let k = 1;
      if (ao) {
        k = lerp(0.65, 1, smoothstep(0, 0.8, p.getY(i) - y0));
        if (top !== undefined) k *= 1 - 0.15 * smoothstep(top - 0.5, top, p.getY(i));
      }
      arr[i * 3] = col[0] * k; arr[i * 3 + 1] = col[1] * k; arr[i * 3 + 2] = col[2] * k;
    }
    g.setAttribute('color', new Float32BufferAttribute(arr, 3));
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a);
    (this.buckets[key] || (this.buckets[key] = [])).push(g);
  }

  matrix(x, y, z, ry = 0, rx = 0, rz = 0) {
    this._q.setFromEuler(this._e.set(rx, ry, rz, 'YXZ'));
    return new Matrix4().compose(this._v.set(x, y, z), this._q, this._s);
  }

  box(key, w, h, d, x, y, z, ry, color, opts = {}) {
    this.add(key, new BoxGeometry(w, h, d), Object.assign({ m: this.matrix(x, y, z, ry || 0), color }, opts));
  }

  finish(group) {
    const meshes = [];
    for (const key of Object.keys(this.buckets)) {
      const geo = mergeGeometries(this.buckets[key]);
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, this.mats[key]);
      mesh.castShadow = key !== 'glass' && key !== 'interior';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'static_' + key;
      group.add(mesh);
      meshes.push(mesh);
    }
    this.buckets = {};
    return meshes;
  }
}

// ---------- wall panels ----------
// topPts: [[x, y], ...] left->right (defaults to a flat top at h). holes: [{ x, y, w, h, arch?, poly? }]
export function wallGeometry(w, h, d, { topPts = null, holes = [], drop = 1.0 } = {}) {
  const s = new Shape();
  const pts = topPts || [[0, h], [w, h]];
  s.moveTo(0, -drop); s.lineTo(w, -drop);
  s.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  for (let i = pts.length - 2; i >= 0; i--) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  for (const o of holes) {
    const hp = new Path();
    if (o.poly) {
      o.poly.forEach((p, i) => (i ? hp.lineTo(p[0], p[1]) : hp.moveTo(p[0], p[1])));
    } else if (o.arch) {
      const r = o.w / 2, cy = o.y + o.h - r;
      hp.moveTo(o.x - r, o.y); hp.lineTo(o.x + r, o.y); hp.lineTo(o.x + r, cy);
      for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI; hp.lineTo(o.x + r * Math.cos(a), cy + r * Math.sin(a)); }
      hp.lineTo(o.x - r, o.y);
    } else {
      hp.moveTo(o.x - o.w / 2, o.y); hp.lineTo(o.x + o.w / 2, o.y); hp.lineTo(o.x + o.w / 2, o.y + o.h); hp.lineTo(o.x - o.w / 2, o.y + o.h);
    }
    hp.closePath();
    s.holes.push(hp);
  }
  return new ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
}

// roof slab: subdivided box with sag/noise, UV in metres along the slab
export function roofSlabGeometry(len, run, thick, noise, seed, sag = 0.05) {
  const g = new BoxGeometry(len, thick, run, 10, 1, 8);
  const p = g.attributes.position, uv = g.attributes.uv;
  const hw = len / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const edge = Math.abs(x) >= hw - 1e-3 || Math.abs(z) >= run / 2 - 1e-3;
    const nz = noise.noise(x * 0.9 + seed, z * 0.9 + seed * 0.7) * (edge ? 0.0 : 0.03);
    const sg = -sag * (1 - (x / hw) * (x / hw)) * (1 - Math.abs(z / (run / 2)) * 0.6);
    p.setY(i, p.getY(i) + nz + sg * (edge ? 0.4 : 1));
    uv.setXY(i, x / 2, z / 2);
  }
  g.computeVertexNormals();
  return g;
}

export function jitterColor(base, rnd, v = 0.06) {
  const k = 1 + (rnd() - 0.5) * 2 * v;
  const h = 1 + (rnd() - 0.5) * 0.06;
  return [base[0] * k * h, base[1] * k, base[2] * k / h];
}

void Group; void BufferGeometry;
