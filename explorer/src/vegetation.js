// Streaming, wind-animated, instanced vegetation. Placement comes from the world recipe (plantsInCell: biome-driven, deterministic).
// Geometry comes from the authored Blender kit (assets/models/verdant/flora_*.glb: LOD0/LOD1 nodes, vertex-colour wind mask
// R = sway, G = branch phase, B = leaf flutter, separate emissive materials); flora.js procedural meshes are the fallback when a
// file failed to load. A "species" is a recipe id (terrain/verdant.js plantsInCell) backed by one or more asset variants.
import * as THREE from 'three';
import { gfx, setupMat, applyCurvature } from './gfx.js';
import * as FL from './flora.js';
import { GLB } from './glbmodels.js';
import { NG, Motes, PadLights, Jellies } from './nythfx.js';      // Nyth: emissive kit variants, motes, pad lights

const windU = { uTime: { value: 0 } };
const rimU = { uSunV: { value: new THREE.Vector3(0, 1, 0) }, uRimCol: { value: new THREE.Color(0, 0, 0) } };      // low sun behind the foliage: warm translucent rim
const _kitMats = new Map();            // 'file/materialName/ampKey' -> material (shared across variants of a file)
let _look = null, _lookId = '';        // per-world material overrides (rc.WORLD.floraLook): Pyra's charred / crystal / ember variants of the kit
const _fixedGlow = [];                 // overridden emissives: constant, gently flickering (not dusk-driven)
const _glowMats = [];                  // { m, k0 } emissive materials driven by the dusk factor

// Nyth emissive variant (ny = kit style from the recipe's WORLD.kit). Dark bodies; the glow is localized: bright texture spots / veins, a fresnel rim,
// a gradient up the model (stems brighten towards the cap), a glow on down-facing surfaces (cap undersides) and a flat term (gills).
// Hue comes from per-instance provinces (cyan -> violet -> magenta, a little amber); the glow swells with the player's proximity (vNyK).
const NY_VERT_PARS = 'varying float vNyH; varying float vNyK; varying float vNyY; varying float vNyD; uniform vec4 uNyPl;\n';
const NY_VERT = `
  float hp_ = 0.5 + 0.25 * sin(ip_.x * 0.0041 + ip_.z * 0.0049 + 1.3) + 0.25 * sin(ip_.x * 0.0093 - ip_.z * 0.0079 + 2.1);
  float hr_ = fract(sin(dot(ip_.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vNyH = fract(hr_ * 13.7) > 0.955 ? 1.0 : clamp(hp_ + 0.8 * (hr_ - 0.5), 0.0, 0.86);      // ~4% amber accents
  vNyY = position.y; vNyD = objectNormal.y;
  float pdn_ = distance(ip_.xz, uNyPl.xz);
  vNyK = (1.0 - smoothstep(3.0, 34.0, pdn_)) * (0.55 + 0.45 * (0.5 + 0.5 * sin(pdn_ * 0.35 - uNyPl.w * 3.0)));`;
const NY_FRAG_PARS = 'varying float vNyH; varying float vNyK; varying float vNyY; varying float vNyD; uniform vec3 uNyA; uniform vec3 uNyB; uniform vec3 uNyGA; uniform vec3 uNyGB; uniform vec3 uNyGM; uniform vec3 uNyGAm; uniform vec3 uNyS; uniform vec3 uNyS2; uniform vec3 uNyS3;\n';
const NY_FRAG = `
  {
    float lum_ = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb = mix(uNyA, uNyB, smoothstep(0.3, 0.7, vNyH)) * (0.12 + 0.9 * lum_) * uNyS.z;
    vec3 gc_ = mix(uNyGA, uNyGB, smoothstep(0.2, 0.5, vNyH));
    gc_ = mix(gc_, uNyGM, smoothstep(0.5, 0.78, vNyH));
    gc_ = mix(gc_, uNyGAm, smoothstep(0.9, 0.97, vNyH));
    vec3 Vn_ = normalize(vViewPosition), Nn_ = normalize(normal);
    float fr_ = pow(1.0 - clamp(abs(dot(Nn_, Vn_)), 0.0, 1.0), 2.4);
    float sp_ = smoothstep(uNyS3.y, uNyS3.y + 0.22, lum_);
    float gr_ = smoothstep(0.0, uNyS3.x, vNyY);
    float dn_ = smoothstep(0.1, -0.7, vNyD);
    float g_ = uNyS.x + uNyS.y * sp_ + uNyS2.x * fr_ + uNyS2.y * gr_ * gr_ + uNyS2.z * dn_;
    float eI_ = max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b);
    totalEmissiveRadiance = gc_ * g_ * eI_ * (1.0 + 1.1 * vNyK);
  }`;
function hookWindKit(amp, ny) {
  return (shader) => {
    applyCurvature(shader);
    shader.uniforms.uTime = windU.uTime; shader.uniforms.uAmp = { value: amp };
    shader.uniforms.uSunV = rimU.uSunV; shader.uniforms.uRimCol = rimU.uRimCol;
    if (ny) {
      const V = (a) => ({ value: new THREE.Vector3(...a) });
      shader.uniforms.uNyPl = NG.uNyPl; shader.uniforms.uNyA = V(ny.a); shader.uniforms.uNyB = V(ny.b); shader.uniforms.uNyGA = V(ny.ga); shader.uniforms.uNyGB = V(ny.gb); shader.uniforms.uNyGM = NG.uNyGM; shader.uniforms.uNyGAm = NG.uNyGAm; shader.uniforms.uNyS = V([ny.base, ny.k, ny.alb]); shader.uniforms.uNyS2 = V([ny.rim || 0, ny.grad || 0, ny.down || 0]); shader.uniforms.uNyS3 = V([ny.hgt || 10, ny.thr || 0.4, 0]);
    }
    shader.fragmentShader = 'uniform vec3 uSunV; uniform vec3 uRimCol;\n' + (ny ? NY_FRAG_PARS : '') + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  ${ny ? NY_FRAG : ''}
  {
    vec3 Vv_ = normalize(vViewPosition), Nv_ = normalize(normal);
    float bl_ = clamp(-dot(Vv_, uSunV), 0.0, 1.0);
    float rim_ = pow(1.0 - clamp(abs(dot(Nv_, Vv_)), 0.0, 1.0), 2.0);
    totalEmissiveRadiance += uRimCol * diffuseColor.rgb * bl_ * bl_ * (0.3 + 0.9 * rim_);
  }`);
    shader.vertexShader = 'attribute vec3 wmask; uniform float uTime; uniform float uAmp;\n' + (ny ? NY_VERT_PARS : '') + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip_ = vec3(instanceMatrix[3]);
#else
  vec3 ip_ = vec3(modelMatrix[3]);
#endif
${ny ? NY_VERT : ''}
  float ph_ = ip_.x * 0.045 + ip_.z * 0.037 + wmask.g * 6.28;
  float gust_ = sin(uTime * 0.37 + ip_.x * 0.004 + ip_.z * 0.003) * 0.5 + 0.5;
  float w_ = wmask.r * (sin(uTime * 1.25 + ph_) * 0.6 + sin(uTime * 2.3 + ph_ * 1.9 + position.y * 0.4) * 0.25 + 0.55 * gust_ + 0.15);
  float fl_ = wmask.b * 0.12 * sin(uTime * 6.5 + ph_ * 3.0 + position.x * 2.0);
  transformed.x += (w_ + fl_) * uAmp; transformed.z += (w_ * 0.65 * sin(ph_) + fl_) * uAmp; transformed.y -= abs(w_) * uAmp * 0.12;`);
  };
}
function kitMaterial(src, key, amp, wind, kit) {
  const style = kit && kit[src.name];
  const k = _lookId + (style ? kit.id + '/' : '') + key + '/' + src.name + '/' + amp;
  let m = _kitMats.get(k); if (m) return m;
  m = src.clone(); m.vertexColors = false; m.side = THREE.DoubleSide; m.envMapIntensity = 0.25; m.roughness = Math.max(m.roughness, 0.88); m.metalness = 0;
  if (m.map) m.map.anisotropy = 4;
  const lk = _look && _look[src.name];
  if (lk) {          // Pyra: charred / crystal / ember materials (WORLD.floraLook)
    m.color.setRGB(...lk.color); if (lk.roughness != null) m.roughness = lk.roughness; if (lk.metalness != null) m.metalness = lk.metalness;
    if (lk.emissive) { m.emissive.setRGB(...lk.emissive); m.emissiveIntensity = lk.emI; _fixedGlow.push({ m, k0: lk.emI, ph: _fixedGlow.length * 1.7 }); }
  }
  if (style) { m.emissive.setRGB(1, 1, 1); m.emissiveMap = null; _glowMats.push({ m, k0: 0.32 }); }       // Nyth: every styled material glows (see hookWindKit)
  else if (!lk && m.emissive && (m.emissiveMap || m.emissive.getHex() !== 0)) { _glowMats.push({ m, k0: Math.max(m.emissiveIntensity, 1) }); }
  setupMat(m, 'veg-kit:' + k, hookWindKit(wind ? amp : 0, style));
  _kitMats.set(k, m); return m;
}
/** pull one LOD node out of a loaded kit file as [{geo, mat}] (one entry per material child) */
function kitParts(file, node, amp, wind, kit) {
  const g = GLB['verdant/' + file]; if (!g) return null;
  const root = g.scene.getObjectByName(node); if (!root) return null;
  const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length) return null;
  const out = [];
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (geo.getAttribute('color') && !geo.getAttribute('wmask')) { geo.setAttribute('wmask', geo.getAttribute('color')); geo.deleteAttribute('color'); }
    if (!geo.getAttribute('wmask')) { const n = geo.getAttribute('position').count; geo.setAttribute('wmask', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); }
    out.push({ geo, mat: kitMaterial(mesh.material, file, amp, wind, kit) });
  }
  return out;
}

// variants: lods = kit node names (LOD0, LOD1); k(p) maps the recipe's p.sc to an instance scale for the real-size asset;
// pick(p) chooses between variants of a species; col = trunk collider {r, h} at scale 1 (m).
const SPECIES = [
  { id: 0, name: 'Lance-palm', proc: FL.spireTree, lodD: 95, maxD: 420, cap0: 600, cap1: 2200, shadow: true, wind: 0.5,
    variants: [{ file: 'flora_trees', nodes: ['tree_lance_LOD0', 'tree_lance_LOD1'], k: (p) => 0.75 + (p.sc - 0.8) * 0.44, col: { r: 0.45, h: 14.5 } }] },
  { id: 1, name: 'Veil-umbrella', proc: FL.canopyTree, lodD: 80, maxD: 1600, cap0: 420, cap1: 6000, shadow: true, wind: 0.45,
    variants: [{ file: 'flora_trees', nodes: ['tree_umbrella_LOD0', 'tree_umbrella_LOD1'], k: (p) => 0.8 + (p.sc - 0.8) * 0.6, col: { r: 0.7, h: 9.4 } }] },
  { id: 2, name: 'Bottle-tree', proc: FL.bulbTree, lodD: 70, maxD: 1400, cap0: 260, cap1: 4000, shadow: true, wind: 0.3,
    variants: [{ file: 'flora_trees', nodes: ['tree_bottle_LOD0', 'tree_bottle_LOD1'], k: (p) => 0.7 + (p.sc - 0.7) * 0.62, col: { r: 1.1, h: 8.1 } }] },
  { id: 3, name: 'Umbrella fungus', proc: FL.fungus, parts: ['body', 'gills'], lodRel: 7, maxD: 5200, cap0: 120, cap1: 900, shadow: true, wind: 0, glowKey: 'gills',
    variants: [
      { file: 'flora_fungi', nodes: ['fungus_hero_LOD0', 'fungus_hero_LOD1'], when: (p) => p.sc >= 21, k: (p) => p.sc / 61, col: { r: 4.2, h: 64, rel: true } },
      { file: 'flora_fungi', nodes: ['fungus_twin_LOD0', 'fungus_twin_LOD1'], when: (p) => p.sc < 21, k: (p) => Math.max(0.25, p.sc / 26), col: { r: 1.6, h: 27 } },
    ] },
  { id: 4, name: 'Fungus cluster', proc: FL.fungusCluster, parts: ['body', 'gills'], lodD: 28, maxD: 300, cap0: 160, cap1: 1500, shadow: false, wind: 0, glowKey: 'gills',
    variants: [{ file: 'flora_fungi', nodes: ['fungus_cluster_LOD0', 'fungus_cluster_LOD1'], k: (p) => 0.4 + (p.sc - 0.7) * 0.8 }] },
  { id: 5, name: 'Berry shrub', proc: FL.shrub, lodD: 40, maxD: 280, cap0: 600, cap1: 2800, shadow: false, wind: 0.12,
    variants: [{ file: 'flora_ground', nodes: ['shrub_berry_LOD0', 'shrub_berry_LOD1'], k: (p) => p.sc }] },
  { id: 6, name: 'Curl fern', proc: FL.fern, lodD: 32, maxD: 150, cap0: 700, cap1: 2500, shadow: false, wind: 0.1,
    variants: [{ file: 'flora_ground', nodes: ['fern_curl_LOD0', 'fern_curl_LOD1'], k: (p) => p.sc * 1.1 }] },
  { id: 7, name: 'Tuft grass', proc: FL.grass, lodD: 22, maxD: 72, cap0: 9000, cap1: 9000, shadow: false, wind: 0.11,
    variants: [{ file: 'flora_ground', nodes: ['grass_clump_LOD0', 'grass_clump_LOD1'], when: (p) => p.tone < 0.62, k: (p) => p.sc * 0.8 },
               { file: 'flora_ground', nodes: ['tuft_clump_LOD0', 'tuft_clump_LOD1'], when: (p) => p.tone >= 0.62, k: (p) => p.sc * 0.85 }] },
  { id: 8, name: 'Lantern bloom', proc: FL.sporePod, parts: ['stalk', 'glow'], lodD: 70, maxD: 500, cap0: 300, cap1: 700, shadow: false, wind: 0.1, glowKey: 'glow_bits',
    variants: [{ file: 'flora_ground', nodes: ['bloom_lantern_LOD0', 'bloom_lantern_LOD1'], k: (p) => p.sc * 1.1 }] },
];
// far LOD (beyond BLOB_D): a lumpy crown mass on a stub trunk, mostly canopy, so distant groves read as full green rather than twigs.
// parts: [{kind:'crown'|'bulb'|'trunk', y, rx, ry, col:[r,g,b]}] at tree scale 1 (metres)
const BLOB_D = 300;
function blobGeo(parts, seed) {
  const pos = [], col = [], nor = [];
  const hash = (a, b, c) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + seed * 19.3) * 43758.5453; return x - Math.floor(x); };
  for (const part of parts) {
    const g = part.kind === 'trunk' ? new THREE.CylinderGeometry(part.rx * 0.7, part.rx, part.ry * 2, 6, 1, true) : new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position; const idx = g.index;
    const vcount = idx ? idx.count : p.count;
    for (let i = 0; i < vcount; i++) {
      const vi = idx ? idx.getX(i) : i;
      let x = p.getX(vi), y = p.getY(vi), z = p.getZ(vi);
      let shade = 1;
      if (part.kind !== 'trunk') {
        const n = 0.82 + 0.36 * hash(Math.round(x * 4), Math.round(y * 4), Math.round(z * 4));      // lumpy surface
        x *= n; y *= n * (y > 0 ? 1.0 : 0.7); z *= n;
        shade = 0.65 + 0.35 * (y > 0 ? 1 : 0.6) * (0.5 + 0.5 * Math.min(1, Math.abs(y) / 0.9 + 0.2));
        pos.push(x * part.rx, y * part.ry + part.y, z * part.rx);
      } else pos.push(x, y + part.y, z);
      col.push(part.col[0] * shade, part.col[1] * shade, part.col[2] * shade);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('wmask', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  geo.computeVertexNormals();
  return geo;
}
const BLOBS = {
  1: () => blobGeo([{ kind: 'trunk', y: 3.4, rx: 0.55, ry: 3.4, col: [0.2, 0.13, 0.09] }, { kind: 'crown', y: 7.4, rx: 6.6, ry: 3.0, col: [0.1, 0.24, 0.07] }, { kind: 'crown', y: 8.2, rx: 4.0, ry: 2.4, col: [0.13, 0.3, 0.085] }], 1),
  2: () => blobGeo([{ kind: 'bulb', y: 2.6, rx: 1.6, ry: 2.8, col: [0.3, 0.27, 0.2] }, { kind: 'crown', y: 7.0, rx: 3.8, ry: 2.4, col: [0.12, 0.28, 0.08] }], 2),
};
const CLASSES = [
  { kind: 'big', S: 96, R: 1650, per: 3, sp: [0, 1, 2, 3] },
  { kind: 'small', S: 32, R: 340, per: 3, sp: [4, 5, 6, 8] },
  { kind: 'grass', S: 12, R: 66, per: 6, sp: [7] },
];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();

export class Vegetation {
  constructor(terrain, rc) {
    this.t = terrain; this.rc = rc; this.group = new THREE.Group();
    _look = (rc.WORLD && rc.WORLD.floraLook) || null; _lookId = _look ? rc.id + ':' : '';      // Pyra
    const WD = rc.WORLD, kit = WD && WD.kit;      // Nyth: kit recoloured as emissive variants
    // fallback (procedural) materials
    const leaf = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 }), 'veg-leaf', applyCurvature);
    const glow = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7, metalness: 0, emissive: 0x000000 }), 'veg-glow', applyCurvature);
    this.kit = SPECIES.map(() => ({}));
    this.meshes = {};          // sp -> variant index -> lod -> InstancedMesh[]
    for (const sp of SPECIES) {
      this.meshes[sp.id] = [];
      sp.vlist = [];
      for (const v of sp.variants) {
        const lods = [kitParts(v.file, v.nodes[0], sp.wind, sp.wind > 0, kit), kitParts(v.file, v.nodes[1], sp.wind, sp.wind > 0, kit)];
        if (lods[0] && lods[1]) { sp.vlist.push({ ...v, lods }); }
      }
      if (!sp.vlist.length) {   // procedural fallback: one variant, same interface
        const mk = (lod) => (sp.parts || ['all']).map((part) => ({ geo: sp.proc(lod, part), mat: part === 'gills' || part === 'glow' ? glow : leaf }));
        sp.vlist.push({ file: null, k: (p) => p.sc, when: null, lods: [mk(0), mk(1)], col: sp.id < 3 ? { r: 0.5, h: 10 } : null, fallback: true });
      }
      for (const v of sp.vlist) {
        const perLod = [];
        for (let lod = 0; lod < 2; lod++) {
          const list = [];
          for (const part of v.lods[lod]) {
            const m = new THREE.InstancedMesh(part.geo, part.mat, Math.round((lod === 0 ? sp.cap0 : sp.cap1) * ((WD && WD.capK) || 1)));
            m.count = 0; m.frustumCulled = false; m.castShadow = sp.shadow && lod === 0 && !(part.mat.emissiveMap) && part.mat.name !== 'fungus_gills'; m.receiveShadow = true;
            m.setColorAt(0, tmpC.setRGB(1, 1, 1)); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
            this.group.add(m); list.push(m);
          }
          perLod.push(list);
        }
        this.meshes[sp.id].push(perLod);
      }
    }
    this.blobs = {};
    const blobMat = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 'veg-blob' + (kit ? '-' + kit.id : ''), hookWindKit(0, kit && (kit.blob || kit.foliage)));
    if (kit) { blobMat.emissive.setRGB(1, 1, 1); _glowMats.push({ m: blobMat, k0: 0.22 }); }
    for (const id of [1, 2]) {
      const m = new THREE.InstancedMesh(BLOBS[id](), blobMat, id === 1 ? 16000 : 11000);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      m.setColorAt(0, tmpC.setRGB(1, 1, 1)); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m); this.blobs[id] = m;
    }
    this.cells = CLASSES.map(() => new Map());
    this.colliders = []; this.last = new THREE.Vector3(1e9, 0, 1e9); this.lastT = 0; this.dirty = true; this.frame = 0;
    this.harvested = new Set(); this.dusk = 0;
    // Nyth: drifting light motes, runway / pad lights, glow floor
    this.ny = !!(WD && WD.nyth); this.glowMin = (WD && WD.glowMin) || 0;
    this.motes = WD && WD.motes ? new Motes(WD.motes) : null; if (this.motes) this.group.add(this.motes.points);
    this.pad = WD && WD.pad && rc.RUNWAY ? new PadLights(rc, WD.pad) : null; if (this.pad) this.group.add(this.pad.points);
    this.jelly = WD && WD.jelly ? new Jellies(WD.jelly) : null; if (this.jelly) this.group.add(this.jelly.mesh);
  }
  reset() { for (const c of this.cells) c.clear(); this.dirty = true; this.last.set(1e9, 0, 1e9); this.harvested.clear(); }
  /** nearest plant (any species, optionally restricted) within r metres of true (x,z); returns {sp, x, z, key} or null */
  nearest(x, z, r, only = null) {
    let best = null, bd = r * r;
    for (let ci = 0; ci < CLASSES.length; ci++) {
      const S = CLASSES[ci].S, i0 = Math.floor((x - r) / S), i1 = Math.floor((x + r) / S), j0 = Math.floor((z - r) / S), j1 = Math.floor((z + r) / S);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const list = this.cells[ci].get(i + ',' + j); if (!list) continue;
        for (const p of list) { if (only && !only.includes(p.sp)) continue; if (p.sp === 7) continue; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd && !this.harvested.has(p.x + ',' + p.z)) { bd = d; best = p; } }
      }
    }
    return best && { sp: best.sp, x: best.x, z: best.z, y: best.y, sc: best.sc, key: best.x + ',' + best.z };
  }
  harvestPod(x, z, r = 4) {
    const p = this.nearest(x, z, r, [8]); if (!p) return null;
    this.harvested.add(p.key); this.dirty = true; return p;
  }
  update(cam, focus, time, sun) {
    this.frame++;
    windU.uTime.value = time;
    { const l = gfx.csm.lights[0]; rimU.uSunV.value.copy(sun).transformDirection(gfx.camera.matrixWorldInverse); rimU.uRimCol.value.copy(l.color).multiplyScalar(Math.min(0.75, l.intensity * 0.11)); }
    // emissive materials: ~off in daylight, rising at dusk and night (kept low so bloom does not blow out)
    const dusk = Math.max(this.glowMin, THREE.MathUtils.clamp((0.12 - sun.y) / 0.3, 0, 1)); this.dusk = dusk;
    if (this.ny) {
      NG.uNyPl.value.set(focus.x, focus.y, focus.z, time);
      const sc = gfx.renderer.domElement.height / (2 * Math.tan(gfx.camera.fov * Math.PI / 360));
      if (this.motes) this.motes.update(cam, this.t.h(focus.x, focus.z), time, sc);
      if (this.pad) this.pad.update(this.t.origin, time, sc);
      if (this.jelly) this.jelly.update(cam, this.t.h(focus.x, focus.z), time);
    }
    for (const g of _glowMats) g.m.emissiveIntensity = g.k0 * (0.05 + 3.0 * dusk);
    for (const g of _fixedGlow) g.m.emissiveIntensity = g.k0 * (0.82 + 0.18 * Math.sin(time * 1.3 + g.ph));
    const ox = this.t.origin.x, oz = this.t.origin.z, cx = cam.x + ox, cz = cam.z + oz;
    let changed = false;
    [2, 1, 0].forEach((ci) => {       // nearest-scale classes first, each with its own time slice (the far forest must not starve the grass)
      const cl = CLASSES[ci], tBudget = performance.now(), slice = ci === 0 ? 1.5 : 1.0, R_ = cl.R * (this.rk || 1);      // AETHEL: rk < 1 shrinks the streaming radius during fast flight
      const S = cl.S, map = this.cells[ci];
      const i0 = Math.floor((cx - R_) / S), i1 = Math.floor((cx + R_) / S), j0 = Math.floor((cz - R_) / S), j1 = Math.floor((cz + R_) / S);
      const need = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = i + ',' + j; if (map.has(k)) continue;
        const dx = (i + 0.5) * S - cx, dz = (j + 0.5) * S - cz, d2 = dx * dx + dz * dz;
        if (d2 < (R_ + S) * (R_ + S)) need.push([i, j, d2]);
      }
      if (need.length) {
        need.sort((a, b) => a[2] - b[2]);
        for (let n = 0; n < Math.min(cl.per, need.length); n++) { if (performance.now() - tBudget > slice) break; const [i, j] = need[n]; map.set(i + ',' + j, this.rc.plantsInCell(cl.kind, i, j, S)); changed = true; }
      }
      if (this.frame % 90 === ci * 30 && map.size > 400) for (const k of map.keys()) { const [i, j] = k.split(',').map(Number); const dx = (i + 0.5) * S - cx, dz = (j + 0.5) * S - cz; if (dx * dx + dz * dz > (cl.R * 1.5) ** 2) map.delete(k); }
    });
    const moved = Math.hypot(cx - this.last.x, cz - this.last.z);
    if ((changed || this.dirty || moved > 9) && time - this.lastT > (this.rk < 1 ? 0.3 : 0.12)) { this.rebuild(cx, cz, ox, oz); this.last.set(cx, 0, cz); this.lastT = time; this.dirty = false; }
  }
  rebuild(cx, cz, ox, oz) {
    const counts = new Map(); this.colliders.length = 0;
    const put = (mesh, p, k, tone, tr = 1, tg = 1, tb = 1) => {
      const n = counts.get(mesh) || 0; if (n >= mesh.instanceMatrix.count) return;
      tmpQ.setFromAxisAngle(UP, p.yaw); tmpP.set(p.x - ox, p.y - 0.05, p.z - oz); tmpS.set(k, k, k); tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(n, tmpM); const t = 0.86 + 0.28 * tone; mesh.setColorAt(n, tmpC.setRGB(t * tr, t * tg * (0.97 + 0.08 * (tone * 7 % 1)), t * tb * (0.94 + 0.1 * (tone * 13 % 1)))); counts.set(mesh, n + 1);
    };
    // two passes: near plants (LOD0) first so they win the instance caps; a full LOD0 pool falls back to LOD1
    for (let pass = 0; pass < 2; pass++) for (let ci = 0; ci < CLASSES.length; ci++) for (const list of this.cells[ci].values()) for (const p of list) {
      const sp = SPECIES[p.sp]; const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      const maxD = sp.maxD * (sp.id === 3 ? Math.min(1.4, 0.5 + p.sc / 30) : 1) * (this.rk || 1);
      if (d > maxD) continue;
      const blob = (sp.id === 1 || sp.id === 2) && d > BLOB_D && !sp.vlist[0].fallback;
      const fall = 1 - THREE.MathUtils.smoothstep(d, maxD * (blob ? 0.8 : 0.45), maxD);
      if (p.r > fall) continue;
      if (sp.id === 8 && this.harvested.has(p.x + ',' + p.z)) continue;
      let lod = (sp.lodRel ? d < p.sc * sp.lodRel : d < sp.lodD) ? 0 : 1;
      if (blob) lod = 2;
      if ((lod === 0) !== (pass === 0)) continue;
      if (lod === 2) { put(this.blobs[sp.id], p, sp.vlist[0].k(p) * 1.3 * (1 + 0.3 * (1 - fall)), p.tone); continue; }
      let vi = 0; if (sp.vlist.length > 1) { vi = sp.vlist.findIndex((v) => !v.when || v.when(p)); if (vi < 0) vi = 0; }
      const v = sp.vlist[vi]; let k = v.k(p);
      if (sp.id === 1 || sp.id === 2) k *= 1 + 0.4 * (1 - fall);          // thinned distant crowns grow a little so groves keep their mass
      if (lod === 0) { const m0 = this.meshes[sp.id][vi][0][0]; if ((counts.get(m0) || 0) >= m0.instanceMatrix.count) lod = 1; }
      const crown = sp.id <= 2;      // crowns read pale and yellow under the low sun: pull them towards green
      for (const m of this.meshes[sp.id][vi][lod]) put(m, p, k, p.tone, crown ? 0.9 : 1, crown ? 1.0 : 1, crown ? 0.8 : 1);
      if (v.col && d < 140) this.colliders.push({ x: p.x, z: p.z, r: v.col.r * k, top: p.y + v.col.h * k });
    }
    for (const id of [1, 2]) { const m = this.blobs[id]; m.count = counts.get(m) || 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const sp of SPECIES) for (const vm of this.meshes[sp.id]) for (const lod of vm) for (const m of lod) { m.count = counts.get(m) || 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
export const SPECIES_INFO = SPECIES.map((s) => ({ id: s.id, name: s.name }));
