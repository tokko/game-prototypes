import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL } from './util.js?v=32';

// Kestrel-class scout engine: one GLB (model/scout_walker.glb, authored in Blender) shared by the player and the AI scouts.
// The GLB's material slots are only livery keys; each node is re-merged here into one vertex-coloured geometry per faction
// (slot colour x baked AO), so a walker costs one draw call per moving part.
export const WALKER = { hipY: 14.6, hipW: 4.0, thighL: 6.6, shinL: 6.4, metaL: 6.2, metaLean: 0.5, footH: 1.5 };
export const LIVERY = [
  { hull: PAL[0].hull, hull2: PAL[0].bone, dark: PAL[0].dark, trim: PAL[0].trim, bone: PAL[0].bone, soot: 0x0b0a09, tank: 0x7a2a1c },
  { hull: PAL[1].hull, hull2: 0x17130f, dark: PAL[1].dark, trim: PAL[1].trim, bone: 0x8a6a22, soot: 0x0b0a09, tank: 0x8a6a22 },
];
const NODES = new Set(['walker', 'pelvis', 'torso', 'head', 'arm_L', 'arm_R', 'barrel_R', 'aa_rack', 'sunspear',
  'anchor_nozzle', 'anchor_pilot', 'anchor_muzzle', 'anchor_rack', 'anchor_lance', 'anchor_lamp',
  'thigh_L', 'shin_L', 'meta_L', 'foot_L', 'thigh_R', 'shin_R', 'meta_R', 'foot_R']);

const WNODES = new Set(['pelvis', 'torso', 'head', 'arm_L', 'forearm_L', 'fist_L', 'fist_glow', 'arm_R', 'lascannon_glow', 'rocket_rack',
  'anchor_reactor', 'anchor_fist', 'anchor_lascannon', 'anchor_rack', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']);

const CNODES = new Set(['pelvis', 'torso', 'head', 'arm_L', 'barrels_L', 'arm_R', 'lance_glow', 'anchor_gatling', 'anchor_lance', 'anchor_battery', 'anchor_head',
  'anchor_reactor', 'anchor_shield', 'anchor_stack_L', 'anchor_stack_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']);

const HNODES = new Set(['hierarch', 'pelvis', 'torso', 'head', 'arm_L', 'barrels_L', 'arm_R', 'blaster_glow', 'missile_pod',
  'anchor_cannon', 'anchor_blaster', 'anchor_pod', 'anchor_reactor', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R']);

// One kit per GLB: node name -> { node, prims: [{ geo, mat }] }, plus its per-faction baked-geometry cache.
async function loadKit(url, nodes) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const src = {};
  gltf.scene.traverse(o => {
    if (!nodes.has(o.name)) return;
    const prims = [];
    if (o.isMesh) prims.push({ geo: o.geometry, mat: o.material.name });
    for (const c of o.children) if (c.isMesh && !nodes.has(c.name)) prims.push({ geo: c.geometry, mat: c.material.name });
    src[o.name] = { node: o, prims };
  });
  return { src, cache: [{}, {}] };
}
const kitS = await loadKit('model/scout_walker.glb?v=3', NODES), kitH = await loadKit('model/hierarch.glb?v=1', HNODES), kitW = await loadKit('model/harrow.glb?v=1', WNODES), kitC = await loadKit('model/colossus.glb?v=1', CNODES);
const src = kitS.src;
export const walkerTris = Object.values(src).reduce((n, s) => n + s.prims.reduce((m, p) => m + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0), 0);

const _c = new THREE.Color();
function bake(prims, colorOf) {
  const out = [];
  for (const p of prims) {
    const rgb = colorOf(p.mat); if (!rgb) continue;
    const g = new THREE.BufferGeometry(), n = p.geo.attributes.position.count, ao = p.geo.attributes.color, col = new Float32Array(n * 3);
    g.setAttribute('position', p.geo.attributes.position); g.setAttribute('normal', p.geo.attributes.normal); if (p.geo.index) g.setIndex(p.geo.index);
    for (let i = 0; i < n; i++) { const k = ao ? ao.getX(i) : 1; col[i * 3] = rgb[0] * k; col[i * 3 + 1] = rgb[1] * k; col[i * 3 + 2] = rgb[2] * k; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.push(g);
  }
  return out.length ? mergeGeometries(out, false) : null;
}
function geos(kit, side, name) {
  const key = name.replace(/_[LR]$/, m => (name.startsWith('arm') || name.startsWith('barrel')) ? m : '');
  let e = kit.cache[side][key];
  if (!e) {
    const L = LIVERY[side], prims = kit.src[name].prims, gl = PAL[side].glow;
    e = kit.cache[side][key] = {
      body: bake(prims, m => { if (L[m] === undefined) return null; _c.set(L[m]); return [_c.r * 1.3, _c.g * 1.3, _c.b * 1.3]; }),
      glow: bake(prims.map(p => ({ geo: p.geo, mat: p.mat })), m => m === 'glow' ? gl : m === 'glow_hot' ? [2.2, 0.3, 0.1] : null),
      inner: bake(prims, m => m === 'nozzle_inner' || m === 'glow_charge' ? [1, 1, 1] : null),   // per-instance tell material: scout nozzle heat / hierarch blaster charge
    };
    // glow slots carry no baked AO: force flat colour
    if (e.glow) { const c = e.glow.attributes.color; let i = 0; for (const p of prims) { const rgb = p.mat === 'glow' ? gl : p.mat === 'glow_hot' ? [2.2, 0.3, 0.1] : null; if (!rgb) continue; for (let k = 0; k < p.geo.attributes.position.count; k++, i++) c.setXYZ(i, rgb[0], rgb[1], rgb[2]); } }
  }
  return e;
}
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0.3 });
MAT.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.14;'); };   // augmented vision: engines never sink fully into shadow
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

function part(kit, side, name, nozzleMat) {
  const e = geos(kit, side, name), g = new THREE.Group(); g.name = name;
  if (e.body) g.add(new THREE.Mesh(e.body, MAT));
  if (e.glow) g.add(new THREE.Mesh(e.glow, GLOW));
  if (e.inner) g.add(new THREE.Mesh(e.inner, nozzleMat));
  return g;
}

// Builds one walker (or, with the hierarch kit, one Hierarch-class colossus). Returns the animated groups and anchors; the legs
// come separately through legParts(side) for Legs. The hierarch has two-bone legs only (no meta); its nozzleMat is the charge tell.
// `tells` maps a node name to its own per-instance tell material (the Harrow's lascannon_glow / fist_glow nodes).
function makeRig(kit, side, meta, tells) {
  const nozzleMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  const rig = { side, nozzleMat, root: new THREE.Group() };
  const build = (name, parent) => {
    const s = kit.src[name], g = s.prims.length ? part(kit, side, name, tells && tells[name] || nozzleMat) : new THREE.Object3D();
    g.position.copy(s.node.position); g.quaternion.copy(s.node.quaternion); parent.add(g); rig[name] = g;
    for (const c of s.node.children) if (c.name in kit.src) build(c.name, g);
    return g;
  };
  build('pelvis', rig.root); rig.pelvis.position.set(0, 0, 0);
  rig.body = new THREE.Group(); rig.root.add(rig.body); rig.body.add(rig.pelvis);
  rig.legParts = sgn => {
    const t = sgn > 0 ? '_L' : '_R', p = { thigh: part(kit, side, 'thigh' + t), shin: part(kit, side, 'shin' + t), foot: part(kit, side, 'foot' + t) };
    if (meta) p.meta = part(kit, side, 'meta' + t);
    return p;
  };
  return rig;
}
export const makeWalker = side => makeRig(kitS, side, true);
export const makeHierarch = side => makeRig(kitH, side, false);
export const makeColossus = (side, tells) => makeRig(kitC, side, false, tells);   // tells: { lance_glow } black-at-rest material, ramped per instance
export const makeHarrow = (side, tells) => makeRig(kitW, side, false, tells);   // tells: { lascannon_glow, fist_glow } black-at-rest materials, driven per instance
