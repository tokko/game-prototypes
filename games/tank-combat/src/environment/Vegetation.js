// Instanced trees built from leaf/needle cards (oak, spruce, poplar, fruit, bush) with spherical normals, inner
// darkening, wind and back-light; a cheap low-LOD version for distance; rocks and a low-LOD rim forest.
// Grass/flowers live in Grass.js. Everything is chunked for frustum + distance culling.
import {
  BufferGeometry, Float32BufferAttribute, CylinderGeometry, IcosahedronGeometry, MeshStandardMaterial,
  MeshDepthMaterial, RGBADepthPacking, InstancedMesh, Group, Matrix4, Quaternion, Euler, Vector3, Color,
  InstancedBufferAttribute, DoubleSide, ShaderChunk, Scene, Mesh, HemisphereLight, DirectionalLight, OrthographicCamera,
  WebGLRenderTarget, SRGBColorSpace, MeshBasicMaterial, LinearMipmapLinearFilter, LinearFilter,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Simplex2, mulberry32 } from '../util/noise.js';
import { smoothstep, clamp, lerp } from '../util/math.js';
import { makeFoliageAtlas, ATLAS_UV } from './ProcTextures.js';
import { patchMaterial, atmo } from './Atmosphere.js';

const CHUNK = 300;
const lin = (hex) => { const c = new Color(hex); return [c.r, c.g, c.b]; };
const UVI = 0.012; // inset to avoid mipmap bleeding between atlas quadrants

// ---------- geometry builder ----------
class TB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.k = []; }

  vert(pos, nor, u, v, col, crown) {
    this.p.push(pos.x, pos.y, pos.z); this.n.push(nor.x, nor.y, nor.z);
    this.u.push(u, v); this.c.push(col[0], col[1], col[2]); this.k.push(crown);
  }

  // leaf/needle card; normals are blended toward the crown-centre direction
  card(P, R, U, cc, crownR, rect, tint, crown, sphereBlend = 0.8, innerDark = true) {
    const corners = [
      new Vector3().copy(P).sub(R).sub(U), new Vector3().copy(P).add(R).sub(U),
      new Vector3().copy(P).add(R).add(U), new Vector3().copy(P).sub(R).add(U),
    ];
    const uvs = [[rect[0] + UVI, rect[2] + UVI], [rect[1] - UVI, rect[2] + UVI], [rect[1] - UVI, rect[3] - UVI], [rect[0] + UVI, rect[3] - UVI]];
    const cn = new Vector3().crossVectors(R, U).normalize();
    const vs = corners.map((q) => {
      const sph = new Vector3().subVectors(q, cc).normalize();
      const cardN = cn.dot(sph) < 0 ? cn.clone().negate() : cn.clone();
      const n = cardN.multiplyScalar(1 - sphereBlend).addScaledVector(sph, sphereBlend).normalize();
      const d = q.distanceTo(cc) / crownR;
      let k = innerDark ? 0.45 + 0.55 * smoothstep(0, 1, d) : 1;
      if (q.y < cc.y) k *= 0.88;
      return { q, n, col: [tint[0] * k, tint[1] * k, tint[2] * k] };
    });
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(vs[i].q, vs[i].n, uvs[i][0], uvs[i][1], vs[i].col, crown);
  }

  // add a Three geometry; uvFn maps its uv to atlas uv; colFn(x,y,z) -> rgb; norFn optional (x,y,z)->Vector3
  geo(g, uvFn, colFn, crown, norFn) {
    const ng = g.index ? g.toNonIndexed() : g;
    const pa = ng.attributes.position, na = ng.attributes.normal, ua = ng.attributes.uv;
    const v = new Vector3(), nv = new Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i);
      if (norFn) nv.copy(norFn(v)); else nv.fromBufferAttribute(na, i);
      const uv = uvFn(ua.getX(i), ua.getY(i));
      this.vert(v, nv, uv[0], uv[1], colFn(v.x, v.y, v.z), crown);
    }
  }

  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.c, 3));
    g.setAttribute('aCrown', new Float32BufferAttribute(this.k, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const barkUV = (u, v) => { const r = ATLAS_UV.bark; return [r[0] + UVI + u * (r[1] - r[0] - 2 * UVI), r[2] + UVI + v * (r[3] - r[2] - 2 * UVI)]; };
const solidUV = () => { const r = ATLAS_UV.bark; return [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2]; }; // opaque texel

function trunkGeo(tb, rnd, h, r0, r1, col, offset = new Vector3()) {
  const g = new CylinderGeometry(r1, r0, h, 8, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const ring = Math.round(((p.getY(i) + h / 2) / h) * 4);
    const j = (Math.sin(ring * 12.9 + Math.atan2(p.getZ(i), p.getX(i)) * 3) * 0.04);
    p.setXYZ(i, p.getX(i) * (1 + j), p.getY(i) + h / 2 + offset.y, p.getZ(i) * (1 + j));
  }
  tb.geo(g, barkUV, () => col, 0);
}

function branchGeo(tb, base, dir, len, r, col) {
  const g = new CylinderGeometry(r * 0.5, r, len, 6, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate(base.x, base.y, base.z);
  tb.geo(g, barkUV, () => col, 0);
}

// a lump of foliage: many outward-facing leaf cards (no solid core: it read as dark boxes)
function lump(tb, noise, rnd, c, rx, ry, rz, cardsN, rect, tint, crownC, crownR, cardSize, seed, coreTint) {
  const n = Math.round(cardsN * 2.1);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, e = Math.asin(clamp(rnd() * 1.45 - 0.45, -1, 1));
    const d = new Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
    const k = 0.4 + 0.6 * rnd();
    const P = new Vector3(c.x + d.x * rx * k, c.y + d.y * ry * k, c.z + d.z * rz * k);
    const rollA = rnd() * 6.283;
    const t1 = new Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).normalize();
    const t2 = new Vector3().crossVectors(d, t1).normalize();
    const cs = cardSize * 1.2;
    const R = t1.clone().multiplyScalar(Math.cos(rollA)).addScaledVector(t2, Math.sin(rollA)).multiplyScalar(cs * (0.5 + rnd() * 0.12));
    const U = new Vector3().crossVectors(d, R).normalize().multiplyScalar(cs * (0.5 + rnd() * 0.12));
    tb.card(P, R, U, crownC, crownR, rect, tint, 1);
  }
}

function buildOak(noise, seed, H = 12, fruit = false) {
  const rnd = mulberry32(seed), tb = new TB();
  const barkC = lin('#6b6150');
  const th = H * (fruit ? 0.3 : 0.4);
  trunkGeo(tb, rnd, th, fruit ? 0.2 : 0.45, fruit ? 0.12 : 0.22, barkC);
  const crownR = H * 0.45, cc = new Vector3(0, th + H * 0.3, 0);
  if (!fruit) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.283 + rnd(), up = (35 + rnd() * 20) * Math.PI / 180;
      branchGeo(tb, new Vector3(0, th * 0.8, 0), new Vector3(Math.cos(a) * Math.cos(up), Math.sin(up), Math.sin(a) * Math.cos(up)), 2.4, 0.12, barkC);
    }
  }
  const n = fruit ? 4 : 8;
  const tint = lin('#e8eecc');
  const core = [0.42, 1.0, 0.36];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rnd() * 0.6, d = i === 0 ? 0 : (0.25 + rnd() * 0.45) * H * (fruit ? 0.25 : 0.45);
    const r = H * (fruit ? 0.2 : 0.2) * (0.8 + rnd() * 0.45);
    const c = new Vector3(Math.cos(a) * d, th + H * (fruit ? 0.28 : 0.3) + (rnd() - 0.3) * H * 0.18 + (i === 0 ? H * 0.12 : 0), Math.sin(a) * d);
    lump(tb, noise, rnd, c, r * 1.15, r * 0.9, r * 1.15, fruit ? 7 : 10, ATLAS_UV.leaf, tint, cc, crownR, fruit ? 1.5 : 2.1, seed + i, core);
  }
  return tb.build();
}

function buildPoplar(noise, seed, H = 20) {
  const rnd = mulberry32(seed), tb = new TB();
  trunkGeo(tb, rnd, H * 0.25, 0.3, 0.12, lin('#6b6150'));
  const tint = lin('#e6f0c0'), core = [0.45, 1.0, 0.36];
  const cc = new Vector3(0, H * 0.55, 0);
  for (let i = 0; i < 6; i++) {
    const t = i / 5, y = H * (0.2 + 0.72 * t), r = H * 0.1 * (1 - 0.35 * Math.abs(t - 0.4));
    lump(tb, noise, rnd, new Vector3((rnd() - 0.5) * 0.3, y, (rnd() - 0.5) * 0.3), r, H * 0.14, r, 8, ATLAS_UV.leaf, tint, cc, H * 0.45, 1.7, seed + i * 3, core);
  }
  return tb.build();
}

function buildBush(noise, seed) {
  const rnd = mulberry32(seed), tb = new TB();
  const tint = lin('#e4eac0'), core = [0.42, 1.0, 0.36], cc = new Vector3(0, 0.7, 0);
  for (let i = 0; i < 4; i++) {
    const a = rnd() * 6.283, d = i ? 0.6 * rnd() + 0.2 : 0;
    lump(tb, noise, rnd, new Vector3(Math.cos(a) * d, 0.6, Math.sin(a) * d), 0.8, 0.55, 0.8, 6, ATLAS_UV.leaf, tint, cc, 1.3, 1.1, seed + i, core);
  }
  return tb.build();
}

function buildSpruce(noise, seed, H = 16, slim = 0.2) {
  const rnd = mulberry32(seed), tb = new TB();
  const barkC = lin('#5a5040');
  trunkGeo(tb, rnd, H * 0.9, 0.35, 0.06, barkC);
  const tint = lin('#f0f4e0');
  const cc = new Vector3(0, H * 0.5, 0);
  const W = 9, rect = ATLAS_UV.conifer, su = solidUV();
  for (let w = 0; w < W; w++) {
    const t = w / (W - 1);
    const y0 = H * (0.12 + 0.8 * t * 0.97);
    const lh = H * 0.2 * (1 - 0.3 * t);
    const R = Math.max(0.5, slim * H * Math.pow(1 - t, 0.9) + 0.3);
    // dark core cone (stops see-through between cards)
    const cone = new CylinderGeometry(0.05, R * 0.43, lh, 10, 1, true);
    const cp = cone.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const rim = cp.getY(i) < 0;
      cp.setXYZ(i, cp.getX(i), cp.getY(i) + y0 + lh / 2 - (rim ? 0.45 : 0), cp.getZ(i));
    }
    cone.computeVertexNormals();
    tb.geo(cone, () => su, () => [0.17, 0.42, 0.15], 1, (v) => new Vector3(v.x, (v.y - cc.y) * 0.2 + 0.4, v.z).normalize());
    // drooping branch cards around the whorl
    const nc = 16;
    for (let i = 0; i < nc; i++) {
      const a = (i / nc) * 6.283 + rnd() * 0.4;
      const dirx = Math.cos(a), dirz = Math.sin(a);
      const len = R * (0.95 + rnd() * 0.35);
      const top = new Vector3(dirx * 0.3, y0 + lh * 0.95, dirz * 0.3);
      const bot = new Vector3(dirx * len, y0 - 0.45 - rnd() * 0.4, dirz * len);
      const P = new Vector3().addVectors(top, bot).multiplyScalar(0.5);
      const U = new Vector3().subVectors(top, bot).multiplyScalar(0.5);
      const R_ = new Vector3(-dirz, 0, dirx).multiplyScalar(Math.max(1.1, (2 * Math.PI * len) / nc * 1.05));
      tb.card(P, R_, U, cc, H * 0.4, rect, tint, 1, 0.6);
    }
  }
  // leader spray at the top
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * 6.283, dirx = Math.cos(a), dirz = Math.sin(a);
    const top = new Vector3(0, H * 0.99, 0), bot = new Vector3(dirx * 0.7, H * 0.86, dirz * 0.7);
    const P = new Vector3().addVectors(top, bot).multiplyScalar(0.5), U = new Vector3().subVectors(top, bot).multiplyScalar(0.5);
    tb.card(P, new Vector3(-dirz, 0, dirx).multiplyScalar(0.5), U, cc, H * 0.4, rect, tint, 1, 0.7);
  }
  return tb.build();
}

// ---------- low-LOD (opaque, no cards) ----------
function blobLow(noise, c, rx, ry, rz, col, seed) {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.2 * noise.noise(x * 1.6 + seed, y * 1.6 + z * 1.2 + seed);
    p.setXYZ(i, c.x + x * d * rx, c.y + y * d * ry, c.z + z * d * rz);
    const nv = new Vector3(x, y + 0.25, z).normalize();
    n.setXYZ(i, nv.x, nv.y, nv.z);
  }
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.65 + 0.5 * clamp((p.getY(i) - (c.y - ry)) / (2 * ry), 0, 1);
    colors[i * 3] = col[0] * k; colors[i * 3 + 1] = col[1] * k; colors[i * 3 + 2] = col[2] * k;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function buildLow(kind, noise) {
  const parts = [];
  if (kind === 'oak' || kind === 'fruit') {
    const col = lin('#34421f'), H = kind === 'oak' ? 12 : 5;
    parts.push(blobLow(noise, new Vector3(0, H * 0.7, 0), H * 0.42, H * 0.3, H * 0.42, col, 1));
    parts.push(blobLow(noise, new Vector3(H * 0.2, H * 0.55, H * 0.1), H * 0.28, H * 0.22, H * 0.28, col, 2));
    parts.push(blobLow(noise, new Vector3(-H * 0.2, H * 0.6, -H * 0.12), H * 0.28, H * 0.22, H * 0.28, col, 3));
  } else if (kind === 'poplar') {
    const col = lin('#3c4a22');
    for (let i = 0; i < 3; i++) parts.push(blobLow(noise, new Vector3(0, 6 + i * 5, 0), 2.1, 4.2, 2.1, col, i));
  } else {
    const col = lin('#1e2a17'), H = 16;
    for (let i = 0; i < 4; i++) {
      const t = i / 3, r = (1 - t * 0.8) * 3.6 + 0.4, y = H * (0.2 + 0.7 * t);
      const g = new CylinderGeometry(0.05, r, H * 0.3, 8, 1, true).toNonIndexed();
      g.translate(0, y, 0);
      const p = g.attributes.position, n = g.attributes.normal;
      const colors = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const nv = new Vector3(n.getX(k), n.getY(k) + 0.4, n.getZ(k)).normalize();
        n.setXYZ(k, nv.x, nv.y, nv.z);
        const f = 0.7 + 0.4 * clamp((p.getY(k) - (y - H * 0.15)) / (H * 0.3), 0, 1);
        colors[k * 3] = col[0] * f; colors[k * 3 + 1] = col[1] * f; colors[k * 3 + 2] = col[2] * f;
      }
      g.setAttribute('color', new Float32BufferAttribute(colors, 3));
      g.deleteAttribute('uv');
      parts.push(g);
    }
    const t = new CylinderGeometry(0.1, 0.3, H * 0.3, 5).toNonIndexed();
    t.translate(0, H * 0.15, 0);
    const colors = new Float32Array(t.attributes.position.count * 3).fill(0.05);
    t.setAttribute('color', new Float32BufferAttribute(colors, 3)); t.deleteAttribute('uv');
    parts.push(t);
  }
  return mergeGeometries(parts);
}

// ---------- materials ----------
const FACE_FIX = ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0');

function treeMaterial(atlas, amp, bark = false) {
  const mat = new MeshStandardMaterial({
    map: atlas, vertexColors: true, alphaTest: 0.5, side: DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.5,
  });
  mat.alphaToCoverage = true;
  const windUniform = { value: amp };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = atmo.uTime;
    shader.uniforms.uWindAmp = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCrown;\nvarying float vCrown;\nuniform float uTime; uniform float uWindAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vCrown = aCrown;
#ifdef USE_INSTANCING
float hN = clamp(position.y / 14.0, 0.0, 1.0);
float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
transformed.x += (sin(uTime * 1.1 + ph) * 0.6 + 0.4) * uWindAmp * hN * hN;
transformed.z += (sin(uTime * 0.9 + ph * 1.3) * 0.4) * uWindAmp * hN * hN;
transformed += aCrown * 0.03 * sin(uTime * 5.3 + dot(position, vec3(1.7, 2.3, 1.1)));
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCrown;')
      .replace('#include <normal_fragment_begin>', FACE_FIX)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float bl = pow(max(dot(normalize(vFogView), sunV), 0.0), 4.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.85, 0.62) * 0.9 * bl * vCrown;
}`);
  };
  patchMaterial(mat);
  mat.customProgramCacheKey = () => 'tree' + (bark ? 'b' : '');
  return mat;
}

// ---------- chunked instancing with hi/lo LOD ----------
class LodInstances {
  // items: [{ x,y,z, ry, sx,sy,sz, tilt, r,g,b }]
  constructor(parent, hiGeo, hiMat, loGeo, loMat, items, { loDist = 220, maxDist = 950, depthMat = null, cast = true, shadowDist = 140 } = {}) {
    this.loDist = loDist; this.maxDist = maxDist; this.shadowDist = shadowDist; this.cast = cast;
    this.chunks = [];
    const cells = new Map();
    for (const it of items) {
      const key = Math.floor((it.x + 1000) / CHUNK) * 100 + Math.floor((it.z + 1000) / CHUNK);
      let a = cells.get(key);
      if (!a) cells.set(key, (a = []));
      a.push(it);
    }
    const m = new Matrix4(), q = new Quaternion(), e = new Euler(), p = new Vector3(), s = new Vector3(), col = new Color();
    const make = (geo, mat, arr, shadow) => {
      const mesh = new InstancedMesh(geo, mat, arr.length);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(arr.length * 3), 3);
      arr.forEach((it, i) => {
        q.setFromEuler(e.set(it.tilt || 0, it.ry || 0, (it.tilt || 0) * 0.7));
        m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz));
        mesh.setMatrixAt(i, m);
        col.setRGB(it.r, it.g, it.b);
        mesh.setColorAt(i, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      if (depthMat) mesh.customDepthMaterial = depthMat;
      mesh.computeBoundingSphere();
      if (!(mesh.boundingSphere.radius >= 0)) mesh.frustumCulled = false; // never hide because of a bad sphere
      parent.add(mesh);
      return mesh;
    };
    for (const arr of cells.values()) {
      const hi = hiGeo ? make(hiGeo, hiMat, arr, false) : null;
      const lo = loGeo ? make(loGeo, loMat, arr, false) : null;
      arr.forEach((it, i) => { it.rigs = [hi && { mesh: hi, index: i }, lo && { mesh: lo, index: i }].filter(Boolean); }); // for knock-down (Crush)
      // chunk centre/radius from the items themselves (robust against bad geometry bounds)
      let cx = 0, cz = 0;
      for (const it of arr) { cx += it.x; cz += it.z; }
      cx /= arr.length; cz /= arr.length;
      let r = 0;
      for (const it of arr) r = Math.max(r, Math.hypot(it.x - cx, it.z - cz));
      this.chunks.push({ hi, lo, cx, cz, r: r + 8 });
    }
  }

  // zoom = camera fov / base fov: when zoomed, objects are treated as closer so optics get the detailed version
  update(cam, zoom = 1) {
    for (const c of this.chunks) {
      const dRaw = Math.hypot(c.cx - cam.x, c.cz - cam.z) - c.r;
      const d = Math.max(0, dRaw);
      if (!c.lo) { c.hi.visible = d < this.maxDist; continue; }
      const near = d * zoom < this.loDist;
      if (c.hi) {
        c.hi.visible = near && d < this.maxDist;
        c.hi.castShadow = this.cast && dRaw < this.shadowDist && near;
      }
      c.lo.visible = c.hi ? (!near && d < this.maxDist) : d < this.maxDist;
    }
  }
}

// ---------- impostors: crossed alpha quads textured with the card tree rendered once at load ----------
function makeImpostor(renderer, hiGeo, atlas, H, crownR) {
  const mat = new MeshStandardMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: DoubleSide, roughness: 0.9, metalness: 0 });
  const sc = new Scene();
  sc.add(new Mesh(hiGeo, mat));
  sc.add(new HemisphereLight(0xffffff, 0x6e6a52, 3.4));
  const dl = new DirectionalLight(0xfff0dc, 1.9); dl.position.set(0.5, 1, 0.7); sc.add(dl);
  hiGeo.computeBoundingBox();
  const bb = hiGeo.boundingBox;
  const Rw = Math.max(crownR * 1.15, Math.abs(bb.min.x), bb.max.x, Math.abs(bb.min.z), bb.max.z) * 1.03, y0 = Math.min(-0.15, bb.min.y), y1 = Math.max(H * 1.03, bb.max.y * 1.02);
  const cam = new OrthographicCamera(-Rw, Rw, y1, y0, 0.1, 200);
  const rt = new WebGLRenderTarget(512, 512, { samples: 0 });
  rt.texture.colorSpace = SRGBColorSpace;
  rt.texture.generateMipmaps = true; rt.texture.minFilter = LinearMipmapLinearFilter; rt.texture.magFilter = LinearFilter;
  const prev = { ca: renderer.getClearAlpha(), cc: renderer.getClearColor(new Color()), ac: renderer.autoClear };
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.setRenderTarget(rt);
  rt.scissorTest = false; renderer.clear();
  rt.scissorTest = true;
  for (let v = 0; v < 2; v++) {
    rt.viewport.set(v * 256, 0, 256, 512); rt.scissor.copy(rt.viewport);
    if (v === 0) cam.position.set(0, 0, 80); else cam.position.set(80, 0, 0);
    cam.lookAt(0, 0, 0);
    cam.rotation.z = 0;
    cam.updateMatrixWorld(true);
    renderer.render(sc, cam);
  }
  renderer.setRenderTarget(null);
  renderer.autoClear = prev.ac; renderer.setClearColor(prev.cc, prev.ca);
  // camera looks at the origin from a fixed height of 0: shift is handled by the ortho bounds (y0..y1)
  const pos = [], uv = [], nor = [], idx = [];
  for (let v = 0; v < 2; v++) {
    const base = pos.length / 3, ca = v === 0 ? 1 : 0, sa = v === 0 ? 0 : 1; // quad 0 spans x, quad 1 spans z
    const u0 = v * 0.5, u1 = u0 + 0.5;
    const corners = [[-Rw, y0], [Rw, y0], [Rw, y1], [-Rw, y1]];
    const us = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
    corners.forEach((c, i) => {
      // view 0 looks down -z so the right edge is +x; view 1 looks down -x so the right edge is -z
      pos.push(v === 0 ? c[0] : 0, c[1], v === 0 ? 0 : -c[0]);
      nor.push(0, 1, 0); uv.push(us[i][0], us[i][1]);
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    void ca; void sa;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return { geo: g, map: rt.texture };
}

function rockGeometry(noise) {
  const g = new IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.3 * noise.noise(x * 1.3 + 5, y * 1.3 + z * 1.1) + 0.2 * noise.noise(x * 3.7, z * 3.7 + y * 2.9);
    // flatten + angular facets
    const f = Math.round(d * 5) / 5;
    p.setXYZ(i, x * (d * 0.7 + f * 0.3), y * (d * 0.7 + f * 0.3) * 0.55, z * (d * 0.7 + f * 0.3));
  }
  g.computeVertexNormals();
  const n = g.attributes.normal, colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 0.13 + 0.07 * noise.noise(p.getX(i) * 3, p.getZ(i) * 3 + p.getY(i));
    const moss = Math.max(0, n.getY(i) - 0.6) * 0.5;
    colors[i * 3] = k * (1 - moss * 0.4); colors[i * 3 + 1] = k * (1 + moss * 0.5); colors[i * 3 + 2] = k * (1 - moss * 0.5);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

export class Vegetation {
  constructor(world, terrain, exclusions = [], renderer = null) {
    this.group = new Group();
    this.group.name = 'vegetation';
    this.sets = [];
    this.trees = []; // for baked tree shadows: { x, z, h, crown }
    const noise = new Simplex2(777);
    const rnd = mulberry32(2024);
    const atlas = makeFoliageAtlas();
    this.atlas = atlas;
    const mats = {
      oak: treeMaterial(atlas, 0.15), spruce: treeMaterial(atlas, 0.08), poplar: treeMaterial(atlas, 0.2), bush: treeMaterial(atlas, 0.1),
    };
    const lowMat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.5 }));
    const depthMat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: atlas, alphaTest: 0.5 });
    const rockMat = patchMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));

    const geo = {
      oak: buildOak(noise, 5, 12), fruit: buildOak(noise, 15, 5, true), spruce: buildSpruce(noise, 11, 16, 0.2),
      fir: buildSpruce(noise, 23, 11, 0.24), poplar: buildPoplar(noise, 9, 20), bush: buildBush(noise, 3),
    };
    let lowGeo = { oak: buildLow('oak', noise), fruit: buildLow('fruit', noise), spruce: buildLow('spruce', noise), fir: buildLow('spruce', noise), poplar: buildLow('poplar', noise) };
    const lowMats = {};
    if (renderer) { // impostors rendered once from the card trees
      const dims = { oak: [12, 5.4], fruit: [5, 2.2], spruce: [16, 3.6], fir: [11, 3.0], poplar: [20, 2.6] };
      lowGeo = {};
      for (const k of Object.keys(dims)) {
        const imp = makeImpostor(renderer, geo[k], atlas, dims[k][0], dims[k][1]);
        lowGeo[k] = imp.geo;
        lowMats[k] = patchMaterial(new MeshBasicMaterial({ map: imp.map, alphaTest: 0.45, side: DoubleSide, color: 0xf0f0f0 }));
        lowMats[k].alphaToCoverage = true;
        lowMats[k].customProgramCacheKey = () => 'impostor';
      }
    }
    const matOf = { oak: mats.oak, fruit: mats.oak, spruce: mats.spruce, fir: mats.spruce, poplar: mats.poplar, bush: mats.bush };
    const sizeOf = { oak: [12, 5.4], fruit: [5, 2.2], spruce: [16, 3.2], fir: [11, 2.6], poplar: [20, 2.4] };

    const tmpN = new Vector3();
    const items = { oak: [], fruit: [], spruce: [], fir: [], poplar: [] };
    const bushItems = [];
    const village = terrain.village, hill = terrain.hill, start = terrain.startPos;
    const blocked = (x, z, pad) => {
      for (const e of exclusions) { if (Math.hypot(x - e.x, z - e.z) < e.r + pad) return true; }
      return false;
    };
    const mk = (kind, x, z, s0, s1, trunkR) => {
      const s = lerp(s0, s1, rnd());
      const y = terrain.getHeight(x, z) - 0.25;
      const v = 0.88 + 0.24 * rnd(), hue = rnd() - 0.5;
      let r = v * (1 + hue * 0.1), g = v, b = v * (1 - hue * 0.12);
      if (rnd() < 0.1 && (kind === 'oak' || kind === 'fruit')) { r *= 1.18; g *= 1.04; b *= 0.8; } // dry tint
      return { x, y, z, ry: rnd() * 6.283, sx: s, sy: s, sz: s, tilt: (rnd() - 0.5) * 0.05, r, g, b, trunk: trunkR * s, kind };
    };
    // keep the last stretch of the sight line from the observation hill to the first enemy tank free of trunks
    // (decided after mk() so the random stream, and therefore every other tree, stays unchanged)
    const laneBlock = (x, z) => {
      const ex = -44, ez = -452, dx = ex - hill.x, dz = ez - hill.z, L2 = dx * dx + dz * dz;
      const t = ((x - hill.x) * dx + (z - hill.z) * dz) / L2;
      if (t < 0.82 || t > 1.03) return false;
      return Math.hypot(x - (hill.x + dx * t), z - (hill.z + dz * t)) < 9;
    };
    const addTree = (kind, x, z, s0, s1, trunkR, collide = true) => {
      const it = mk(kind, x, z, s0, s1, trunkR);
      if (laneBlock(x, z)) return it;
      items[kind].push(it);
      this.trees.push({ x, z, h: sizeOf[kind][0] * it.sy, crown: sizeOf[kind][1] * it.sy });
      it.collide = collide;
      return it;
    };

    // ---- forests, copses and scattered singles ----
    let treeCount = 0;
    for (let i = 0; i < 16000; i++) {
      const x = (rnd() * 2 - 1) * 760, z = (rnd() * 2 - 1) * 760;
      const f = noise.fbm(x * 0.0042 + 20, z * 0.0042 - 5, 3);
      const dens = smoothstep(0.0, 0.26, f);
      const roadD = terrain.getRoadDistance(x, z);
      if (roadD < 10) continue;
      let p = dens * 0.9 + 0.01;
      if (roadD < 24) p = Math.max(p * 0.3, 0.05 * (1 - (roadD - 10) / 14));
      if (Math.hypot(x - village.x, z - village.z) < 110) p *= 0.5;
      if (rnd() > p) continue;
      terrain.getNormal(x, z, tmpN);
      if (tmpN.y < 0.88) continue;
      if (Math.hypot(x - hill.x, z - hill.z) < 26) continue;
      if (Math.hypot(x - start.x, z - start.z) < 45) continue;
      if (blocked(x, z, 8)) continue;
      const hgt = terrain.getHeight(x, z);
      const kindN = noise.noise(x * 0.006 + 80, z * 0.006 + 40) + (hgt > 25 ? 0.4 : 0);
      const r = rnd();
      let kind;
      if (kindN > 0.15) kind = r < 0.6 ? 'spruce' : r < 0.88 ? 'fir' : 'poplar';
      else if (kindN > -0.2) kind = r < 0.5 ? 'oak' : r < 0.72 ? 'spruce' : r < 0.86 ? 'fir' : 'poplar';
      else kind = r < 0.75 ? 'oak' : r < 0.88 ? 'poplar' : 'fir';
      if (kind === 'spruce') addTree(kind, x, z, 0.75, 1.3, 0.3);
      else if (kind === 'fir') addTree(kind, x, z, 0.8, 1.3, 0.3);
      else if (kind === 'oak') addTree(kind, x, z, 0.8, 1.3, 0.4);
      else addTree(kind, x, z, 0.8, 1.2, 0.25);
      treeCount++;
    }

    // ---- poplar rows along the approach to the village and the farm windbreak ----
    const rp = terrain.roadPoints;
    for (let i = 0; i < rp.length; i += 9) {
      const p = rp[i];
      if (p.z > -300 || p.z < -520) continue;
      const q = rp[Math.min(rp.length - 1, i + 1)];
      const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
      for (const side of [-1, 1]) {
        const x = p.x + (-tz / tl) * 9.5 * side + (rnd() - 0.5), z = p.z + (tx / tl) * 9.5 * side;
        if (blocked(x, z, 2) || rnd() < 0.15) continue;
        addTree('poplar', x, z, 0.9, 1.15, 0.25);
      }
    }
    const farm = terrain.farm;
    for (let i = 0; i < 10; i++) addTree('poplar', farm.x - 30 + i * 7 + (rnd() - 0.5), farm.z - 52 + (rnd() - 0.5), 0.95, 1.2, 0.25);
    // orchard: jittered 6 m grid of fruit trees east of the farmhouse
    for (let gx = 0; gx < 7; gx++) {
      for (let gz = 0; gz < 5; gz++) {
        const x = farm.x + 30 + gx * 6 + (rnd() - 0.5) * 2.4, z = farm.z + 20 + gz * 6 + (rnd() - 0.5) * 2.4;
        if (blocked(x, z, 1) || terrain.getRoadDistance(x, z) < 8) continue;
        addTree('fruit', x, z, 0.85, 1.2, 0.2);
      }
    }
    // gardens and lindens in the village
    for (const e of exclusions) {
      if (e.garden && rnd() < 0.8) {
        const a = rnd() * 6.283, d = e.r + 5 + rnd() * 3, x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d;
        if (!blocked(x, z, 4) && terrain.getRoadDistance(x, z) > 9) addTree(rnd() < 0.5 ? 'fruit' : 'oak', x, z, 0.8, 1.1, 0.3);
      }
    }
    this.treeCount = treeCount + this.trees.length - treeCount;

    const treeParams = { loDist: 220, maxDist: 1000, depthMat };
    for (const k of Object.keys(items)) {
      if (!items[k].length) continue;
      const lg = lowGeo[k];
      this.sets.push(new LodInstances(this.group, geo[k], matOf[k], lg, lowMats[k] || lowMat, items[k], treeParams));
      // every tree is crushable: faster/heavier trunks need a little run-up, then the whole tree (hi + impostor copy) topples
      for (const it of items[k]) {
        if (!it.collide) continue;
        const H = sizeOf[k][0] * it.sy, tr = Math.max(0.3, it.trunk);
        // minSpeed stays below the ~0.8 m/s a tank can build up pressed against a trunk, so it never gets stuck at rest
        world.crush.circle(it.x, it.z, tr, it.rigs, { y: it.y + 0.25, height: H, colHeight: 12, minSpeed: 0.45 + 0.5 * tr, slow: 0.86, jolt: 0.04 + tr * 0.1, maxAng: 1.46, sink: 0.25, fx: 'leaf', fx2: 'thud', tag: 'tree' });
      }
    }

    // ---- bushes ----
    for (let i = 0; i < 800; i++) {
      const x = (rnd() * 2 - 1) * 740, z = (rnd() * 2 - 1) * 740;
      const roadD = terrain.getRoadDistance(x, z);
      const near = roadD > 6 && roadD < 30;
      const f = noise.fbm(x * 0.0042 + 20, z * 0.0042 - 5, 3);
      const edge = f > -0.05 && f < 0.12;
      if (!(near && rnd() < 0.5) && !(edge && rnd() < 0.5)) continue;
      terrain.getNormal(x, z, tmpN);
      if (tmpN.y < 0.9 || blocked(x, z, 3)) continue;
      const it = mk('bush', x, z, 0.7, 1.7, 0);
      it.sy *= 0.85;
      bushItems.push(it);
    }
    // hedges and garden shrubs inside the village
    for (const e of exclusions) {
      if (!e.garden) continue;
      for (let k = 0; k < 4; k++) {
        const a = rnd() * 6.283, d = e.r + 1.5 + rnd() * 3, x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d;
        if (blocked(x, z, 0.5) || terrain.getRoadDistance(x, z) < 6) continue;
        const it = mk('bush', x, z, 0.6, 1.1, 0); bushItems.push(it);
      }
    }
    this.sets.push(new LodInstances(this.group, geo.bush, mats.bush, null, null, bushItems, { loDist: 0, maxDist: 450, depthMat }));
    for (const it of bushItems) world.crush.circle(it.x, it.z, 0.5 * it.sx, it.rigs, { y: it.y + 0.25, height: 1.4 * it.sy, minSpeed: 0, slow: 0.97, jolt: 0.012, maxAng: 1.15, sink: 0.25, fx: 'leaf', fx2: 'none', noRay: true, tag: 'bush' });

    // ---- low-LOD rim forest (700..1000 m): no cards, no shadows, no colliders ----
    const rim = { oak: [], spruce: [], poplar: [] };
    for (let i = 0; i < 7000; i++) {
      const x = (rnd() * 2 - 1) * 1000, z = (rnd() * 2 - 1) * 1000;
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (edge < 705) continue;
      if (rnd() > 0.55) continue;
      const r = rnd();
      const kind = r < 0.65 ? 'oak' : r < 0.9 ? 'spruce' : 'poplar';
      const s = 1.0 + rnd() * 0.9, y = terrain.getHeight(x, z) - 0.3, v = 0.8 + rnd() * 0.4;
      rim[kind].push({ x, y, z, ry: rnd() * 6.283, sx: s, sy: s, sz: s, tilt: 0, r: v, g: v, b: v * 0.95 });
    }
    const rimKind = { oak: 'oak', spruce: 'spruce', poplar: 'poplar' };
    for (const k of Object.keys(rim)) this.sets.push(new LodInstances(this.group, null, null, lowGeo[rimKind[k]], lowMats[rimKind[k]] || lowMat, rim[k], { maxDist: 2600 }));

    // ---- rocks ----
    const rocks = [];
    const addRock = (x, z, s) => {
      const k = 0.8 + 0.5 * rnd();
      rocks.push({
        x, y: terrain.getHeight(x, z) - s * 0.28, z, ry: rnd() * 6.283, sx: s * (0.9 + 0.5 * rnd()), sy: s * (0.7 + 0.4 * rnd()), sz: s * (0.9 + 0.5 * rnd()),
        tilt: (rnd() - 0.5) * 0.3, r: k, g: k, b: k * 0.97,
      });
      // small rocks can be driven over, big ones are solid (the hull slides along them)
      world.addCircle(x, z, s * 0.85, s < 0.9 ? { height: s * 1.2, tag: 'rock', cls: 'climb', top: s * 0.7 } : { height: s * 1.2, tag: 'rock' });
    };
    for (let i = 0; i < 330; i++) {
      const x = (rnd() * 2 - 1) * 720, z = (rnd() * 2 - 1) * 720;
      const roadD = terrain.getRoadDistance(x, z);
      if (roadD < 8 || blocked(x, z, 3) || Math.hypot(x - start.x, z - start.z) < 40) continue;
      const nearHill = Math.hypot(x - hill.x, z - hill.z) < 150;
      if (!nearHill && rnd() > 0.35) continue;
      const s = 0.7 + rnd() * rnd() * 3.2;
      addRock(x, z, s);
      if (rnd() < 0.5) addRock(x + rnd() * 5 - 2.5, z + rnd() * 5 - 2.5, s * (0.3 + 0.4 * rnd()));
    }
    this.sets.push(new LodInstances(this.group, rockGeometry(noise), rockMat, null, null, rocks, { loDist: 0, maxDist: 800 }));
    this.rockMeshes = this.sets[this.sets.length - 1];
  }

  update(camPos, time, zoom = 1) {
    for (const s of this.sets) s.update(camPos, zoom);
  }
}
