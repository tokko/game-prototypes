// Living ecosystem: procedural segmented creatures with procedural gaits, spawned deterministically per region around the
// player, with niche behaviour (skittering scuttlers, grazing herds that wander between pasture and water and bolt as a
// group, slow giants, soaring gliders that flock), a day / night activity bias and a biological-survey registry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { setupMat } from './gfx.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SPECIES_INFO } from './vegetation.js';
import { GLB } from './glbmodels.js';

const V3 = THREE.Vector3;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hash = (a, b, s = 0) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ------------------------------------------------------------------ species table (survey ids: c:<key> for fauna, p:<n> for flora)
const MORPH = {
  skitter: [
    { key: 'ember-skitter', body: [0.62, 0.22, 0.08], accent: [0.95, 0.55, 0.12], rule: 'forest' },
    { key: 'moss-skitter', body: [0.18, 0.34, 0.1], accent: [0.6, 0.75, 0.25], rule: 'forest' },
    { key: 'glass-skitter', body: [0.55, 0.7, 0.72], accent: [0.9, 0.97, 1.0], rule: 'any' },
    { key: 'lake-strider', body: [0.12, 0.3, 0.4], accent: [0.5, 0.85, 0.9], rule: 'water' },
    { key: 'dusk-moth', body: [0.3, 0.12, 0.4], accent: [0.8, 0.4, 1.0], rule: 'night', glow: true },
  ],
  grazer: [
    { key: 'dun-strider', body: [0.55, 0.45, 0.3], accent: [0.85, 0.75, 0.55], rule: 'any' },
    { key: 'banded-strider', body: [0.4, 0.34, 0.28], accent: [0.9, 0.85, 0.7], rule: 'any', stripes: true },
    { key: 'crested-strider', body: [0.34, 0.45, 0.4], accent: [0.95, 0.4, 0.55], rule: 'any', crest: true },
  ],
  titan: [
    { key: 'ashen-giant', body: [0.5, 0.48, 0.45], accent: [0.72, 0.68, 0.6], rule: 'any' },
    { key: 'ember-giant', body: [0.5, 0.3, 0.2], accent: [0.9, 0.6, 0.3], rule: 'any' },
    { key: 'tide-giant', body: [0.28, 0.42, 0.45], accent: [0.6, 0.85, 0.8], rule: 'water' },
  ],
  glider: [
    { key: 'ridge-glider', body: [0.42, 0.34, 0.28], accent: [0.95, 0.7, 0.35], rule: 'day' },
    { key: 'sun-glider', body: [0.85, 0.65, 0.3], accent: [1.0, 0.9, 0.5], rule: 'day' },
    { key: 'mist-glider', body: [0.5, 0.6, 0.66], accent: [0.85, 0.95, 1.0], rule: 'day' },
    { key: 'night-glider', body: [0.16, 0.14, 0.26], accent: [0.5, 0.6, 1.0], rule: 'night', glow: true },
  ],
};
const WORDS = {
  skitter: ['skitter', 'scuttler', 'darter', 'tick'], grazer: ['strider', 'browser', 'drifter', 'stalker'], titan: ['giant', 'colossus', 'wader', 'monarch'], glider: ['glider', 'soarer', 'kite', 'drake'],
};
const FIRST = ['Ember', 'Moss', 'Glass', 'Lake', 'Dusk', 'Dun', 'Banded', 'Crested', 'Ashen', 'Tide', 'Ridge', 'Sun', 'Mist', 'Night'];
const BLURB = {
  skitter: 'Six-legged and thumb-sized, it slips between the roots and bolts the moment a shadow falls across it. It feeds on spore dust and sheds its carapace in the fungus groves.',
  grazer: 'A tall-necked herd animal that crops the valley grasses at dawn and dusk, drifting to the lakeshore to drink. The herd bolts as one when anything large approaches.',
  titan: 'A slow, enormous browser that strips the crowns of the lance-palms. Its footfalls shake the ground; nothing on this world hunts it.',
  glider: 'A membrane-winged flyer that rides the warm updrafts above the valleys in loose flocks, folding into a stoop to snatch skitters from the canopy.',
};
function makeFauna(morphs, blurbs) {        // per-world creature table (a recipe may supply its own morphs via WORLD.fauna: Nyth)
  const out = [];
  for (const [plan, list] of Object.entries(morphs)) for (const m of list) {
    const nm = m.key.split('-'); const nice = nm[0][0].toUpperCase() + nm[0].slice(1) + ' ' + nm[1];
    out.push({ key: 'c:' + m.key, plan, morph: m, name: nice, text: blurbs[plan] + (m.glow ? ' It glows faintly after dark.' : '') + (m.rule === 'water' ? ' Found only near open water.' : '') });
  }
  return out;
}
export const FAUNA = makeFauna(MORPH, BLURB);
export const SURVEY_TOTAL = FAUNA.length + SPECIES_INFO.length;     // 15 fauna + 9 flora = 24
const FLORA_TEXT = [
  'A slender, arching palm whose fronds track the sun across the day.', 'A wide canopy tree that drapes pale tendrils to the ground; small things nest in the curtain.', 'A squat tree hung with swollen fruit bulbs that pop with a puff of spores.',
  'A fungus the height of a cathedral. Its cap shelters whole communities and its gills glow at dusk.', 'Clustered fairy caps that bloom after rain and glow faintly in the dark.', 'A low, spreading shrub with berry-like pods the herds browse.',
  'A feathery fern that closes its fronds when something brushes past.', 'Silky tuft-grass that ripples like water in the wind.', 'A glowing spore pod on a thin stalk. Rich in organic compounds; the pods regrow within days.',
];
export function floraEntry(sp, tab) { return tab ? { key: 'p:' + sp, name: tab[sp][0], text: tab[sp][1] } : { key: 'p:' + sp, name: SPECIES_INFO[sp].name, text: FLORA_TEXT[sp] }; }

// ------------------------------------------------------------------ geometry helpers
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), UP = new V3(0, 1, 0);
function paint(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3), r = Math.pow(c[0], 2.2), gg = Math.pow(c[1], 2.2), b = Math.pow(c[2], 2.2); for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function ell(c, rx, ry, rz, x, y, z, seg = 10) { const g = new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1)); g.scale(rx, ry, rz); g.translate(x, y, z); return paint(g, c); }
function limb(c, a, b, r0, r1, seg = 6) {
  const d = new V3().subVectors(b, a), len = d.length(); const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  _q.setFromUnitVectors(UP, d.clone().normalize()); _m.compose(new V3().addVectors(a, b).multiplyScalar(0.5), _q, new V3(1, 1, 1)); g.applyMatrix4(_m); return paint(g, c);
}
function tri(c, a, b, d) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2)); g.computeVertexNormals(); return paint(g, c); }
const merge = (list) => mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));      // primitives keep their smooth normals
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ body plans -> { root, parts, anim(c, ...) }
const matCache = new Map();
function matFor(key, glow, side) {
  let m = matCache.get(key + glow + side);
  if (!m) {
    m = setupMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0, side: side ? THREE.DoubleSide : THREE.FrontSide, emissive: glow ? 0x66ccff : 0x000000, emissiveIntensity: 0 }), 'creature');
    matCache.set(key + glow + side, m);
  }
  return m;
}
const mesh = (g, mat, shadow = true) => { const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = true; return m; };
const planCache = new Map();

function buildSkitter(mo) {
  const body = merge([ell(mo.body, 0.2, 0.09, 0.12, 0, 0.17, 0, 10), ell(mix(mo.body, mo.accent, 0.5), 0.07, 0.06, 0.07, -0.2, 0.17, 0, 8), ell(mo.accent, 0.12, 0.05, 0.09, 0.02, 0.23, 0, 8),
    limb(mo.accent, new V3(-0.24, 0.2, 0.02), new V3(-0.5, 0.4, 0.1), 0.012, 0.004, 4), limb(mo.accent, new V3(-0.24, 0.2, -0.02), new V3(-0.5, 0.4, -0.1), 0.012, 0.004, 4)]);
  const mk = (sx0) => { const parts = []; for (const [x, z] of sx0) { const s = Math.sign(z); parts.push(limb(mo.accent, new V3(x, 0.15, 0), new V3(x + 0.04, 0.2, z * 0.09), 0.018, 0.012, 4), limb(mo.accent, new V3(x + 0.04, 0.2, z * 0.09), new V3(x + 0.02, 0, z * 0.2), 0.012, 0.006, 4)); } return merge(parts); };
  const mat = matFor(mo.key, mo.glow, false);
  const root = new THREE.Group(), bodyM = mesh(body, mat, false), ta = new THREE.Group(), tb = new THREE.Group();
  ta.position.y = 0.0; ta.add(mesh(mk([[-0.12, 1], [0.0, -1], [0.12, 1]]), mat, false)); tb.add(mesh(mk([[-0.12, -1], [0.0, 1], [0.12, -1]]), mat, false));
  root.add(bodyM, ta, tb);
  return { root, parts: { body: bodyM, ta, tb }, scale: 1, plan: 'skitter' };
}
function buildQuad(mo, titan) {
  const k = titan ? 4.6 : 1.0, c = mo.body, a = mo.accent, belly = mix(mo.body, [0.9, 0.85, 0.75], 0.45);
  const torso = [ell(c, 0.9 * k, 0.44 * k, 0.4 * k, 0, 0.98 * k, 0, 14), ell(mix(c, belly, 0.5), 0.75 * k, 0.3 * k, 0.34 * k, 0.05 * k, 0.86 * k, 0, 10),
    limb(c, new V3(-0.85 * k, 1.0 * k, 0), new V3(-1.55 * k, 0.82 * k, 0), 0.2 * k, 0.05 * k, 7), limb(a, new V3(-1.3 * k, 0.88 * k, 0), new V3(-1.7 * k, 0.74 * k, 0), 0.07 * k, 0.025 * k, 5)];
  if (mo.stripes) for (let i = 0; i < 5; i++) torso.push(ell(a, 0.04 * k, 0.45 * k, 0.405 * k, (-0.55 + i * 0.28) * k, 0.99 * k, 0, 6));
  const neck = [limb(c, new V3(0, 0, 0), new V3(0.5 * k, 0.55 * k, 0), 0.2 * k, 0.12 * k, 8), limb(c, new V3(0.5 * k, 0.55 * k, 0), new V3(0.85 * k, 1.05 * k, 0), 0.12 * k, 0.1 * k, 7),
    ell(c, 0.26 * k, 0.12 * k, 0.12 * k, 1.05 * k, 1.12 * k, 0, 9), ell(a, 0.07 * k, 0.07 * k, 0.07 * k, 1.17 * k, 1.17 * k, 0.1 * k, 6), ell(a, 0.07 * k, 0.07 * k, 0.07 * k, 1.17 * k, 1.17 * k, -0.1 * k, 6)];
  if (mo.crest) for (let i = 0; i < 4; i++) neck.push(tri(a, new V3((0.82 + i * 0.07) * k, 1.12 * k, 0), new V3((0.7 + i * 0.07) * k, (1.5 - i * 0.07) * k, 0.012 * k), new V3((0.9 + i * 0.07) * k, 1.12 * k, 0.012 * k)));
  const legGeo = (zs) => merge([limb(c, new V3(0, 0, 0), new V3(0.04 * k, -0.45 * k, 0.02 * zs * k), 0.14 * k, 0.075 * k, 7), limb(a, new V3(0.04 * k, -0.45 * k, 0.02 * zs * k), new V3(-0.03 * k, -0.96 * k, 0.0), 0.075 * k, 0.05 * k, 6), ell(a, 0.14 * k, 0.045 * k, 0.09 * k, 0.0, -0.98 * k, 0, 6)]);
  const mat = matFor(mo.key, false, true);
  const root = new THREE.Group(), body = mesh(merge(torso), mat), neckG = new THREE.Group(), legs = [];
  neckG.position.set(0.7 * k, 1.05 * k, 0); neckG.add((() => { const n = mesh(merge(neck), mat); n.position.set(-0.7 * k, -1.05 * k, 0); return n; })());
  root.add(body, neckG);
  const tail = new THREE.Group(); tail.position.set(-0.85 * k, 1.0 * k, 0); root.add(tail);
  tail.add((() => { const t = mesh(merge([limb(c, new V3(0, 0, 0), new V3(-0.7 * k, -0.08 * k, 0), 0.18 * k, 0.06 * k, 7), limb(a, new V3(-0.7 * k, -0.08 * k, 0), new V3(-1.3 * k, 0.1 * k, 0), 0.06 * k, 0.015 * k, 6)]), mat); return t; })());
  for (const [x, z] of [[0.62, 1], [0.62, -1], [-0.62, 1], [-0.62, -1]]) { const pv = new THREE.Group(); pv.position.set(x * k, 0.98 * k, z * 0.3 * k); pv.add(mesh(legGeo(z), mat)); root.add(pv); legs.push(pv); }
  return { root, parts: { body, neck: neckG, tail, legs }, scale: 1, plan: titan ? 'titan' : 'grazer', k };
}
function buildGlider(mo) {
  const c = mo.body, a = mo.accent, mem = mix(a, c, 0.4), W = 1.9;
  const body = merge([ell(c, 0.5, 0.14, 0.14, 0, 0, 0, 10), ell(c, 0.28, 0.1, 0.1, 0.62, 0.08, 0, 8), limb(a, new V3(0.8, 0.12, 0), new V3(1.18, 0.1, 0), 0.05, 0.015, 5), tri(a, new V3(0.7, 0.16, 0), new V3(0.45, 0.62, 0), new V3(0.4, 0.14, 0)), limb(c, new V3(-0.45, 0, 0), new V3(-1.1, -0.05, 0), 0.08, 0.02, 5), tri(a, new V3(-1.05, -0.04, 0.0), new V3(-1.5, 0.0, 0.18), new V3(-1.5, 0.0, -0.18))]);
  const mat = matFor(mo.key, mo.glow, true), matM = matFor(mo.key + 'm', mo.glow, true);
  const root = new THREE.Group(), bodyM = mesh(body, mat, false); root.add(bodyM);
  const wings = [];
  for (const s of [1, -1]) {
    const sh = new THREE.Group(); sh.position.set(0.15, 0.05, 0); const inner = mesh(merge([tri(mem, new V3(0.45, 0, 0), new V3(-0.45, 0, 0), new V3(0.1, 0, s * W * 0.5)), tri(mem, new V3(-0.45, 0, 0), new V3(-0.35, 0, s * W * 0.5), new V3(0.1, 0, s * W * 0.5)), limb(c, new V3(0.1, 0, 0), new V3(0.15, 0, s * W * 0.5), 0.04, 0.025, 4)]), matM, false);
    const el = new THREE.Group(); el.position.set(0.15, 0, s * W * 0.5);
    const outer = mesh(merge([tri(mem, new V3(0.0, 0, 0), new V3(-0.55, 0, s * 0.25), new V3(0.35, 0, s * W * 0.62)), tri(mem, new V3(0.0, 0, 0), new V3(-0.45, 0, 0.0), new V3(-0.55, 0, s * 0.25)), limb(c, new V3(0, 0, 0), new V3(0.35, 0, s * W * 0.62), 0.025, 0.008, 4)]), matM, false);
    el.add(outer); sh.add(inner, el); root.add(sh); wings.push({ sh, el, s });
  }
  return { root, parts: { body: bodyM, wings }, scale: 1, plan: 'glider' };
}
function buildPlan(f) {
  const key = f.key;
  if (planCache.has(key)) return planCache.get(key);
  let r;
  if (f.plan === 'skitter') r = buildSkitter(f.morph); else if (f.plan === 'grazer') r = buildQuad(f.morph, false); else if (f.plan === 'titan') r = buildQuad(f.morph, true); else r = buildGlider(f.morph);
  planCache.set(key, r); return r;
}
// ---- authored skinned creatures (assets/models/verdant/<plan>.glb): SkeletonUtils clone + AnimationMixer per animal, tinted per species
const KIT_OF = { skitter: 'skitter', grazer: 'grazer', titan: 'titan', glider: 'flyer' };
const NATURAL = { skitter: { scurry: 1.0, flee: 3.4 }, grazer: { walk: 1.4, run: 7.2 }, titan: { walk: 0.8 }, flyer: { flap: 10, glide: 12, bank: 11 } };
const kitMatCache = new Map();
function kitTinted(f, gltf) {
  const key = f.key; let tab = kitMatCache.get(key); if (tab) return tab;
  tab = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const src of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (tab.has(src.name)) continue;
      const m = src.clone(); m.envMapIntensity = 0.5;
      const mo = f.morph;
      if (/_skin$/.test(m.name)) { const b = mo.body, mx = Math.max(b[0], b[1], b[2], 1e-3), k = 0.55; m.color.setRGB(1 - k + k * b[0] / mx * 0.95, 1 - k + k * b[1] / mx * 0.95, 1 - k + k * b[2] / mx * 0.95, THREE.SRGBColorSpace); }
      if (/_glow$/.test(m.name) && mo.glow) { m.emissive.setRGB(mo.accent[0], mo.accent[1], mo.accent[2], THREE.SRGBColorSpace); m.emissiveIntensity = 1; m.userData.nightGlow = true; }
      if (/_skin$|_membrane$/.test(m.name) && mo.skinGlow) { m.emissive.setRGB(mo.accent[0], mo.accent[1], mo.accent[2], THREE.SRGBColorSpace); m.emissiveIntensity = mo.skinGlow; m.userData.nightGlow = true; m.userData.glow = true; }      // Nyth: whole body carries a faint glow
      if (/_glow$|_membrane$/.test(m.name)) m.userData.glow = true;
      m.userData.e0 = m.emissiveIntensity;
      setupMat(m, 'creature-kit:' + key + ':' + m.name);
      tab.set(m.name, m);
    }
  });
  kitMatCache.set(key, tab); return tab;
}
function kitInstantiate(f) {
  const gltf = GLB['verdant/' + KIT_OF[f.plan]]; if (!gltf) return null;
  const root = SkeletonUtils.clone(gltf.scene);
  const tab = kitTinted(f, gltf);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = true; o.castShadow = f.plan !== 'glider'; o.receiveShadow = true;
    o.geometry.boundingSphere = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere); if (o.isSkinnedMesh) { o.frustumCulled = false; }
    o.material = Array.isArray(o.material) ? o.material.map((m) => tab.get(m.name) || m) : (tab.get(o.material.name) || o.material);
  });
  const mixer = new THREE.AnimationMixer(root), act = {};
  for (const c of gltf.animations) { const a = mixer.clipAction(c); act[c.name] = a; if (['startle'].includes(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
  const kit = { mixer, act, cur: null, name: '', dist: 0, plan: f.plan };
  kitPlay(kit, act.idle ? 'idle' : Object.keys(act)[0], 1, 0);
  mixer.update(Math.random() * 3);
  return { root, parts: { kit }, k: 1 };
}
function kitPlay(kit, name, ts = 1, fade = 0.25) {
  const a = kit.act[name]; if (!a) return;
  if (kit.cur === a) { a.setEffectiveTimeScale(ts); return; }
  a.reset(); a.setEffectiveWeight(1); a.setEffectiveTimeScale(ts);
  if (kit.cur && fade > 0) { kit.cur.crossFadeTo(a, fade, false); }
  a.play(); kit.cur = a; kit.name = name;
}

const ox0 = (e) => e.t.origin.x, oz0 = (e) => e.t.origin.z;
function instantiate(f) {       // a fresh scene graph per creature sharing geometry/material (clone of the group with shared geometry)
  const kitInst = kitInstantiate(f); if (kitInst) return kitInst;
  const src = buildPlan(f), root = src.root.clone(true);
  const parts = { legs: [], wings: [] };
  const find = (o, depth) => o;
  // map parts onto the cloned hierarchy by traversal order (clone(true) keeps order)
  const a = [], b = []; src.root.traverse((o) => a.push(o)); root.traverse((o) => b.push(o));
  const lookup = (o) => b[a.indexOf(o)];
  const P = src.parts;
  if (f.plan === 'skitter') { parts.ta = lookup(P.ta); parts.tb = lookup(P.tb); parts.body = lookup(P.body); }
  else if (f.plan === 'glider') { parts.body = lookup(P.body); parts.wings = P.wings.map((w) => ({ sh: lookup(w.sh), el: lookup(w.el), s: w.s })); }
  else { parts.body = lookup(P.body); parts.neck = lookup(P.neck); parts.tail = lookup(P.tail); parts.legs = P.legs.map(lookup); }
  return { root, parts, k: src.k || 1 };
}

// ------------------------------------------------------------------ creatures
const PLAN = {
  skitter: { len: 0.45, walk: 0.9, run: 3.4, alert: 7, shadow: false },
  grazer: { len: 2.2, walk: 1.4, run: 7.2, alert: 34, shadow: true },
  titan: { len: 8, walk: 0.8, run: 2.2, alert: 14, shadow: true },
  glider: { len: 3, walk: 0, run: 0, alert: 0, shadow: false },
};
export class Ecology {
  constructor(terrain, rc, veg) {
    this.t = terrain; this.rc = rc; this.veg = veg; this.group = new THREE.Group();
    const WF = rc.WORLD && rc.WORLD.fauna; this.fauna = WF ? makeFauna(WF.morph, WF.blurb) : FAUNA; this.floraTab = WF ? WF.flora : null; this.glowMin = (rc.WORLD && rc.WORLD.glowMin) || 0;      // Nyth: own species table
    this.cells = new Map(); this.herds = []; this.fliers = []; this.frame = 0;
    this.known = new Set(); this.onSpecies = null; this.time = 0;
    this.tmpN = [0, 1, 0]; this.camPos = new V3();
  }
  reset() { for (const h of this.herds) this._free(h); for (const f of this.fliers) this._free(f); this.herds = []; this.fliers = []; this.cells.clear(); }
  _free(h) { for (const m of h.members) this.group.remove(m.root); }
  // ---- spawning (deterministic per cell)
  _spawnCell(kind, ix, iz, S, night, sunY) {
    const rc = this.rc; let x = (ix + 0.2 + 0.6 * hash(ix, iz, 3)) * S, z = (iz + 0.2 + 0.6 * hash(ix, iz, 4)) * S;
    if (kind === 'sky') {
      if (hash(ix, iz, 70) > 0.75) return;
      const pool = this.fauna.filter((f) => f.plan === 'glider');
      const f = pool[Math.floor(hash(ix, iz, 71) * pool.length)];
      const n = 3 + Math.floor(hash(ix, iz, 72) * 6);
      const fl = { kind: 'flock', f, members: [], cx: x, cz: z, rad: 120 + 260 * hash(ix, iz, 73), ang: hash(ix, iz, 74) * 6.28, dir: hash(ix, iz, 75) > 0.5 ? 1 : -1, alt: 60 + 90 * hash(ix, iz, 76), cell: ix + ',' + iz };
      for (let i = 0; i < n; i++) { const inst = instantiate(f); inst.root.scale.setScalar(inst.parts.kit ? 0.85 + 0.45 * hash(ix + i, iz, 77) : 1.4 + 0.7 * hash(ix + i, iz, 77)); this.group.add(inst.root); fl.members.push({ ...inst, kit: inst.parts.kit, off: new V3((hash(ix + i, iz, 78) - 0.5) * 36, (hash(ix + i, iz, 79) - 0.5) * 14, (hash(ix + i, iz, 80) - 0.5) * 36), ph: hash(ix + i, iz, 81) * 6.28, pos: new V3(), vel: new V3(), roll: 0, root: inst.root }); }
      this.fliers.push(fl); return;
    }
    const cur = kind === 'ground' && rc.curatedHerd && rc.curatedHerd(ix, iz, S); if (cur) { x = cur.x; z = cur.z; }      // Nyth: a guaranteed grazer herd on the overlook meadow
    const h = rc.heightAt(x, z); if (h < rc.LAKE + 1) return;
    const b = rc.biome(x, z, h, undefined, [0, 0, 0, 0]);
    const rr = hash(ix, iz, 10);
    const nearWater = (rc.riverDistance(x, z) < 90) || (h < rc.LAKE + 14);
    let plan = null;
    if (nearWater && rr < 0.2) plan = 'titan'; else if (b[0] > 0.2 && b[1] < 0.55 && rr < 0.5) plan = 'grazer'; else if (b[1] > 0.12 && rr < 0.85) plan = 'skitter'; else if (rr > 0.93 && b[0] > 0.3) plan = 'titan'; else if (rr < 0.7) plan = 'skitter';
    if (cur) plan = 'grazer';
    if (!plan) return;
    const pool = this.fauna.filter((f) => f.plan === plan && (f.morph.rule !== 'water' || nearWater) && (f.morph.rule !== 'forest' || b[1] > 0.1 || true));
    const f = pool[Math.floor(hash(ix, iz, 11) * pool.length)];
    if (f.morph.rule === 'night' && !night) return;
    const n = plan === 'grazer' ? 4 + Math.floor(hash(ix, iz, 12) * 6) : plan === 'skitter' ? 3 + Math.floor(hash(ix, iz, 13) * 4) : 1 + Math.floor(hash(ix, iz, 14) * 1.8);
    const herd = { kind: 'herd', plan, f, members: [], cx: x, cz: z, hx: x, hz: z, mode: 'graze', until: 3 + 10 * hash(ix, iz, 15), fleeDir: new V3(), thirst: hash(ix, iz, 16), cell: ix + ',' + iz, anchor: { x, z } };
    for (let i = 0; i < n; i++) {
      const a = hash(ix + i, iz, 17) * 6.28, d = (plan === 'skitter' ? 1.5 : plan === 'titan' ? 12 : 5) * (0.5 + Math.sqrt(hash(ix + i, iz, 18)) * 2);
      const inst = instantiate(f); const sc = (0.85 + 0.3 * hash(ix + i, iz, 19)) * (plan === 'titan' ? 1.0 : 1); inst.root.scale.setScalar(sc);
      const m = { ...inst.parts, root: inst.root, x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, yaw: hash(ix + i, iz, 20) * 6.28, speed: 0, phase: hash(ix + i, iz, 21) * 6.28, slot: new V3(Math.cos(a) * d, 0, Math.sin(a) * d), sc, state: 'graze', t: 2 + 8 * hash(ix + i, iz, 22), tx: x, tz: z, headDown: 0, y: 0, k: inst.k };
      m.y = rc.heightAt(m.x, m.z); this.group.add(m.root); herd.members.push(m);
    }
    this.herds.push(herd);
  }
  _shore(x, z) {          // nearest water edge within 260 m (cached per herd call site by direction sampling)
    const rc = this.rc; let best = null, bd = 1e9;
    for (let a = 0; a < 16; a++) {
      const ca = Math.cos(a / 16 * 6.283), sa = Math.sin(a / 16 * 6.283);
      for (let d = 20; d <= 260; d += 20) { const px = x + ca * d, pz = z + sa * d; if (rc.waterDepth(px, pz) > 0.25) { if (d < bd) { bd = d; best = { x: x + ca * (d - 5), z: z + sa * (d - 5) }; } break; } }
    }
    return best;
  }
  update(dt, focus, time, sun, camPos) {
    this.frame++; this.time = time; if (camPos) this.camPos.copy(camPos); else this.camPos.copy(focus);
    const rc = this.rc, ox = this.t.origin.x, oz = this.t.origin.z, px = focus.x + ox, pz = focus.z + oz;
    const night = sun.y < 0.0, activity = clamp((sun.y + 0.15) / 0.3, 0.25, 1);
    // spawn / despawn on a slow clock
    if (this.frame % 20 === 3) {
      const GS = 420, GR = 520, i0 = Math.floor((px - GR) / GS), i1 = Math.floor((px + GR) / GS), j0 = Math.floor((pz - GR) / GS), j1 = Math.floor((pz + GR) / GS);
      let built = 0;
      for (let j = j0; j <= j1 && built < 2; j++) for (let i = i0; i <= i1 && built < 2; i++) {
        const k = 'g' + i + ',' + j; if (this.cells.has(k)) continue;
        const dx = (i + 0.5) * GS - px, dz = (j + 0.5) * GS - pz; if (dx * dx + dz * dz > (GR + GS * 0.4) ** 2) continue;
        this.cells.set(k, 1); this._spawnCell('ground', i, j, GS, night, sun.y); built++;
      }
      const SS = 1500, SR = 2300, si0 = Math.floor((px - SR) / SS), si1 = Math.floor((px + SR) / SS), sj0 = Math.floor((pz - SR) / SS), sj1 = Math.floor((pz + SR) / SS);
      for (let j = sj0; j <= sj1; j++) for (let i = si0; i <= si1; i++) {
        const k = 's' + i + ',' + j + (night ? 'n' : 'd'); if (this.cells.has(k)) continue;
        const dx = (i + 0.5) * SS - px, dz = (j + 0.5) * SS - pz; if (dx * dx + dz * dz > (SR + SS * 0.4) ** 2) continue;
        this.cells.set(k, 1); this._spawnCell('sky', i, j, SS, night, sun.y);
      }
      // despawn far groups (their cells respawn identically on return)
      for (const h of [...this.herds]) if (Math.hypot(h.members[0].x - px, h.members[0].z - pz) > GR * 1.5) { this._free(h); this.herds.splice(this.herds.indexOf(h), 1); this.cells.delete('g' + h.cell); this.cells.delete(h.cell); this._dropCell(h.cell, 'g'); }
      for (const f of [...this.fliers]) if (Math.hypot(f.cx - px, f.cz - pz) > SR * 1.6) { this._free(f); this.fliers.splice(this.fliers.indexOf(f), 1); this._dropCell(f.cell, 's'); }
    }
    // threats: the player (faster = scarier) and whatever vehicle is near
    const thr = this.calm ? { x: px, z: pz, r: 0 } : (this.threat || { x: px, z: pz, r: 1 });      // calm: debug switch for photography
    for (const h of this.herds) this._herd(h, dt, px, pz, thr, activity, night);
    for (const f of this.fliers) this._flock(f, dt, activity, night, sun.y);
    // glow of night-active species
    const gl = Math.max(this.glowMin, clamp((0.12 - sun.y) / 0.3, 0, 1));
    for (const m of matCache.values()) if (m.emissiveIntensity !== undefined && m.emissive.getHex() !== 0) m.emissiveIntensity = 0.1 + 3.0 * gl;
    for (const tab of kitMatCache.values()) for (const m of tab.values()) if (m.userData.glow) m.emissiveIntensity = m.userData.e0 * (m.userData.nightGlow ? 0.15 + 3.2 * gl : 0.4 + 1.2 * gl);
  }
  _dropCell(cell, tag) { for (const k of [...this.cells.keys()]) if (k.startsWith(tag) && k.slice(1).split(/[dn]$/)[0] === cell) this.cells.delete(k); }
  setThreat(x, z, r) { this.threat = { x: x + this.t.origin.x, z: z + this.t.origin.z, r }; }
  // ---- herd / group behaviour
  _herd(h, dt, px, pz, thr, activity, night) {
    const rc = this.rc, spec = PLAN[h.plan];
    h.until -= dt;
    // startle: any member closer than alert radius (scaled by how loud the threat is)
    let minD = 1e9; for (const m of h.members) minD = Math.min(minD, Math.hypot(m.x - thr.x, m.z - thr.z));
    const alert = spec.alert * thr.r;
    if (h.mode !== 'flee' && minD < alert) {
      h.mode = 'flee'; h.until = 5 + Math.random() * 3;
      if (h.plan === 'grazer') for (const m of h.members) if (m.kit && m.kit.act.startle) m.startleT = 0.35 + 0.5 * Math.random();
      let dx = 0, dz = 0; for (const m of h.members) { dx += m.x - thr.x; dz += m.z - thr.z; } const l = Math.hypot(dx, dz) || 1; h.fleeDir.set(dx / l, 0, dz / l);
    }
    if (h.until <= 0) {
      if (h.mode === 'flee') { h.mode = 'graze'; h.until = 6 + Math.random() * 8; }
      else if (h.mode === 'graze') {
        h.thirst += 0.35 + 0.2 * Math.random();
        if (h.thirst > 1 && h.plan !== 'skitter') { const sh = this._shore(h.cx, h.cz); if (sh) { h.mode = 'drink'; h.hx = sh.x; h.hz = sh.z; h.until = 40; h.thirst = 0; } else { h.thirst = 0.3; h.mode = 'move'; h.until = 12; } }
        else { h.mode = 'move'; h.until = 10 + Math.random() * 10; const a = Math.random() * 6.283, d = (h.plan === 'skitter' ? 3 + Math.random() * 6 : h.plan === 'titan' ? 20 + Math.random() * 40 : 25 + Math.random() * 55); h.hx = h.cx + Math.cos(a) * d; h.hz = h.cz + Math.sin(a) * d; }
      } else if (h.mode === 'move') { h.mode = 'graze'; h.until = (h.plan === 'skitter' ? 1 + 3 * Math.random() : 8 + 14 * Math.random()) / activity; }
      else if (h.mode === 'drink') { h.mode = 'graze'; h.until = 8; }
    }
    let cx = 0, cz = 0;
    for (const m of h.members) {
      let tx, tz, spd = 0;
      const wantMove = h.mode === 'flee' || h.mode === 'move' || h.mode === 'drink';
      if (h.mode === 'flee') { tx = m.x + h.fleeDir.x * 40 + (m.slot.x * 0.3); tz = m.z + h.fleeDir.z * 40 + (m.slot.z * 0.3); spd = spec.run * (0.9 + 0.2 * Math.sin(m.phase)); }
      else if (wantMove) { tx = h.hx + m.slot.x; tz = h.hz + m.slot.z; spd = spec.walk * (h.mode === 'drink' ? 1.1 : 1); if (Math.hypot(tx - m.x, tz - m.z) < 2.5) spd = 0; }
      else { tx = h.cx + m.slot.x; tz = h.cz + m.slot.z; const d = Math.hypot(tx - m.x, tz - m.z); spd = d > 7 ? spec.walk * 0.8 : 0; if (h.plan === 'skitter' && d < 5 && Math.sin(this.time * 1.3 + m.phase * 5) > 0.82) { spd = spec.walk * 1.4; tx = m.x + Math.cos(m.phase * 7 + Math.floor(this.time * 0.6)) * 3; tz = m.z + Math.sin(m.phase * 7 + Math.floor(this.time * 0.6)) * 3; } }
      if (m.startleT > 0) { m.startleT -= dt; spd = 0; }
      this._move(m, dt, tx, tz, spd, h);
      if (m.kit) { const dd = Math.hypot(m.x - this.camPos.x - ox0(this), m.z - this.camPos.z - oz0(this)); m.root.visible = dd < (h.plan === 'skitter' ? 110 : h.plan === 'titan' ? 520 : 300); }
      { const near = Math.hypot(m.x - px, m.z - pz) < 55; if (m.shadowOn !== near) { m.shadowOn = near; m.root.traverse((o) => { if (o.isMesh) o.castShadow = near && spec.shadow; }); } }
      m.headDown += ((h.mode === 'graze' && spd < 0.05 ? 1 : 0) - m.headDown) * Math.min(1, dt * 2);
      this._anim(h.plan, m, dt, spd, h.mode === 'flee', h, px, pz);
      cx += m.x; cz += m.z;
    }
    h.cx += (cx / h.members.length - h.cx) * Math.min(1, dt * 0.5);
    h.cz += (cz / h.members.length - h.cz) * Math.min(1, dt * 0.5);
  }
  _move(m, dt, tx, tz, spd, h) {
    const rc = this.rc, ox = this.t.origin.x, oz = this.t.origin.z;
    const want = Math.atan2(tx - m.x, -(tz - m.z));
    let d = want - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    m.yaw += clamp(d, -3.2 * dt, 3.2 * dt) * (spd > 0 ? 1 : 0.2);
    const s = spd * clamp(1 - Math.abs(d) * 0.6, 0.2, 1);
    m.speed += (s - m.speed) * Math.min(1, dt * 3);
    if (m.speed > 0.01) {
      const nx = m.x + Math.sin(m.yaw) * m.speed * dt, nz = m.z - Math.cos(m.yaw) * m.speed * dt;
      const water = h && (h.f.morph.rule === 'water');
      const wd = rc.waterDepth(nx, nz);
      if (wd > (water ? 2.2 : (h.mode === 'drink' ? 0.45 : 0.5))) { m.yaw += 1.2; m.speed *= 0.3; }
      else { m.x = nx; m.z = nz; }
    }
    m.y += (rc.heightAt(m.x, m.z) - m.y) * Math.min(1, dt * 9);
    m.root.position.set(m.x - ox, m.y, m.z - oz);
  }
  _animKit(plan, m, dt, spd, h, px, pz) {
    const ck = m.kit, N = NATURAL[plan] || {};
    const d = Math.hypot(m.x - px, m.z - pz), rng = plan === 'skitter' ? 80 : plan === 'titan' ? 260 : 170;
    // pose + facing (forward is -Z in the authored rigs)
    m.root.rotation.order = 'YXZ'; m.root.rotation.y = -m.yaw;
    if (plan === 'grazer' || plan === 'titan') {
      const k = m.root.scale.x * (plan === 'titan' ? 4.5 : 1);
      const f = this.rc.heightAt(m.x + Math.sin(m.yaw) * 0.9 * k, m.z - Math.cos(m.yaw) * 0.9 * k), b = this.rc.heightAt(m.x - Math.sin(m.yaw) * 0.9 * k, m.z + Math.cos(m.yaw) * 0.9 * k);
      m.root.rotation.x = Math.atan2(f - b, 1.8 * k) * 0.8;
    }
    if (d > rng) return;                       // far: freeze the pose (no mixer update)
    let name = 'idle', ts = 1;
    if (plan === 'skitter') { if (spd > 0.05) { if (m.speed > 2.0) { name = 'flee'; ts = m.speed / 3.4; } else { name = 'scurry'; ts = Math.max(0.3, m.speed / 1.0); } } }
    else if (plan === 'grazer') {
      if (m.startleT > 0) name = 'startle';
      else if (m.speed > 0.1) { if (m.speed > 3.6) { name = 'run'; ts = m.speed / 7.2; } else { name = 'walk'; ts = Math.max(0.35, m.speed / 1.4); } }
      else if (h.mode === 'drink') name = 'drink';
      else if (m.headDown > 0.5) name = 'graze';
    } else if (plan === 'titan') {
      if (m.speed > 0.08) { name = 'walk'; ts = Math.max(0.3, m.speed / 0.8); }
      else if (m.headDown > 0.6) name = 'graze_high';
      else if (Math.sin(this.time * 0.05 + m.phase * 3) > 0.985) name = 'call';
    }
    if (!ck.act[name]) name = 'idle';
    kitPlay(ck, name, clamp(ts, 0.25, 2.2), name === 'startle' ? 0.08 : 0.28);
    ck.mixer.update(dt);
  }
  _anim(plan, m, dt, spd, fleeing, h, px, pz) {
    if (m.kit) return this._animKit(plan, m, dt, spd, h, px, pz);
    const r = m.root, P = m, sp = Math.min(1, m.speed / (plan === 'skitter' ? 3 : 7));
    m.phase += dt * (plan === 'skitter' ? 7 + 18 * sp : plan === 'titan' ? 1.6 + 1.5 * sp : 3.2 + 7.5 * sp) * (m.speed > 0.05 ? 1 : 0);
    const ph = m.phase, amp = m.speed > 0.05 ? (plan === 'skitter' ? 0.5 : plan === 'titan' ? 0.38 : 0.55 + 0.35 * sp) : 0;
    if (plan === 'skitter') {
      m.ta.rotation.z = Math.sin(ph) * amp; m.tb.rotation.z = Math.sin(ph + Math.PI) * amp;
      m.ta.position.y = Math.max(0, Math.sin(ph)) * 0.03; m.tb.position.y = Math.max(0, -Math.sin(ph)) * 0.03;
      m.body.position.y = Math.abs(Math.sin(ph)) * 0.015 * (amp > 0 ? 1 : 0);
      r.rotation.set(0, -m.yaw + Math.PI / 2, 0);
    } else {
      const lg = m.legs, k = m.k;
      const o = [0, Math.PI, Math.PI, 0];
      for (let i = 0; i < 4; i++) { lg[i].rotation.z = Math.sin(ph + o[i]) * amp * (i < 2 ? 1 : 1) * -1; lg[i].position.y = (0.98 * k) + Math.max(0, Math.sin(ph + o[i] + Math.PI / 2)) * 0.12 * k * (amp > 0 ? 1 : 0); }
      m.body.position.y = Math.sin(ph * 2) * 0.03 * k * (amp > 0 ? 1 : 0);
      const gz = m.headDown;
      m.neck.rotation.z = -gz * (plan === 'titan' ? 0.55 : 1.05) + Math.sin(this.time * 0.6 + m.phase) * 0.05 + (gz > 0.5 ? Math.sin(this.time * 3 + m.phase * 3) * 0.06 : 0) + (fleeing ? 0.12 : 0);
      m.tail.rotation.y = Math.sin(this.time * 1.4 + m.phase * 2) * 0.25;
      r.rotation.set(0, -m.yaw + Math.PI / 2, 0);
      const f = this.rc.heightAt(m.x + Math.sin(m.yaw) * 0.9 * k, m.z - Math.cos(m.yaw) * 0.9 * k), b = this.rc.heightAt(m.x - Math.sin(m.yaw) * 0.9 * k, m.z + Math.cos(m.yaw) * 0.9 * k);
      r.rotation.z = Math.atan2(f - b, 1.8 * k) * 0.8;
    }
  }
  // ---- flocks of gliders
  _flock(f, dt, activity, night, sunY) {
    const ox = this.t.origin.x, oz = this.t.origin.z, rc = this.rc;
    const on = f.f.morph.rule === 'night' ? night : !night || sunY > -0.05;
    f.ang += f.dir * dt * (12 / f.rad);
    f.cx += Math.cos(f.ang * 0.13) * dt * 1.2; f.cz += Math.sin(f.ang * 0.11) * dt * 1.2;
    for (const m of f.members) {
      m.root.visible = on;
      if (!on) continue;
      const a = f.ang + m.ph * 0.02;
      const tx = f.cx + Math.cos(a) * f.rad + m.off.x, tz = f.cz + Math.sin(a) * f.rad + m.off.z;
      const gh = rc.heightAt(tx, tz);
      const ty = Math.max(gh, rc.LAKE) + f.alt + m.off.y + 18 * Math.sin(this.time * 0.15 + f.ang * 2 + m.ph);   // thermals
      const np = new V3(tx - ox, ty, tz - oz);
      if (m.pos.lengthSq() === 0) m.pos.copy(np);
      const nv = np.clone().sub(m.pos);
      const vel = nv.clone().divideScalar(Math.max(dt, 1e-3)); if (vel.length() > 30) vel.setLength(30);
      m.vel.lerp(vel, Math.min(1, dt * 3)); m.pos.addScaledVector(m.vel, dt); m.pos.lerp(np, Math.min(1, dt * 0.35));
      const dir = m.vel.clone(); if (dir.lengthSq() < 0.01) dir.set(1, 0, 0); dir.normalize();
      const yaw = Math.atan2(dir.x, -dir.z), pitch = Math.asin(clamp(dir.y, -1, 1));
      const turn = f.dir * 0.5; m.roll += (-turn * 0.9 - m.roll) * Math.min(1, dt * 2);
      m.root.position.copy(m.pos); m.root.rotation.set(0, 0, 0);
      if (m.kit) {
        m.root.rotation.order = 'YXZ'; m.root.rotation.y = -yaw; m.root.rotation.x = pitch * 0.9; m.root.rotation.z = m.roll;
        const near = Math.hypot(m.pos.x - this.camPos.x, m.pos.z - this.camPos.z) < 700;
        m.root.visible = Math.hypot(m.pos.x - this.camPos.x, m.pos.z - this.camPos.z) < 1300;
        if (near) {
          const sp = m.vel.length(); const fl = Math.sin(this.time * 0.25 + m.ph) > -0.3;
          let name = fl ? 'flap' : 'glide', ts = fl ? sp / 10 : sp / 12;
          if (!fl && Math.abs(m.roll) > 0.28) { name = m.roll < 0 ? 'bank_right' : 'bank_left'; ts = sp / 11; }
          kitPlay(m.kit, name, clamp(ts, 0.5, 1.6), 0.4); m.kit.mixer.update(dt);
        }
        continue;
      }
      m.root.rotation.order = 'YZX'; m.root.rotation.y = -yaw + Math.PI / 2; m.root.rotation.z = pitch * 0.9; m.root.rotation.x = m.roll;
      const flapping = Math.sin(this.time * 0.25 + m.ph) > -0.3, fr = flapping ? 1 : 0.0;
      const fa = Math.sin(this.time * (flapping ? 6.2 : 0.8) + m.ph) * (flapping ? 0.7 : 0.08) + (flapping ? 0.12 : 0.2);
      for (const w of m.parts.wings) { w.sh.rotation.x = -w.s * fa * 0.5; w.el.rotation.x = -w.s * Math.sin(this.time * (flapping ? 6.2 : 0.8) + m.ph - 0.7) * (flapping ? 0.55 : 0.1); }
      m.root.visible = Math.hypot(m.pos.x, m.pos.z) < 6000;
    }
  }
  // ---- survey (F): nearest fauna / flora within range of true (x,z) -> species entry
  nearestFauna(x, z, r) {
    let best = null, bd = r * r;
    for (const h of this.herds) for (const m of h.members) { const d = (m.x - x) ** 2 + (m.z - z) ** 2; if (d < bd) { bd = d; best = { f: h.f }; } }
    for (const fl of this.fliers) for (const m of fl.members) { if (!m.root.visible) continue; const mx = m.pos.x + this.t.origin.x, mz = m.pos.z + this.t.origin.z; const d = (mx - x) ** 2 + (mz - z) ** 2 + (m.pos.y - 40) ** 2 * 0.1; if (d < bd * 4) { bd = d / 4; best = { f: fl.f }; } }
    return best;
  }
  /** returns list of newly logged entries */
  scan(x, z, r = 55) {
    const out = [];
    const log = (e) => { if (!e || this.known.has(e.key)) return; this.known.add(e.key); out.push(e); if (this.onSpecies) this.onSpecies(e); };
    const fa = this.nearestFauna(x, z, r); if (fa) log({ key: fa.f.key, name: fa.f.name, text: fa.f.text });
    if (this.veg) { const p = this.veg.nearest(x, z, Math.max(30, r)); if (p) log(floraEntry(p.sp, this.floraTab)); }
    return out;
  }
}
