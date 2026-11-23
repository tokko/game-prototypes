// Glaciera living-ice layer: everything the generic terrain / scatter modules do not draw for a frozen moon.
//   - installs the ice terrain material and re-skins the scatter system (blue crystal spire clusters instead of hoodoos,
//     icy boulders from the verdant rocks.glb kit instead of dusty ones)
//   - frost shards: small crystal clusters streamed around the player
//   - landing-pad lamp posts at every survey pad in range
//   - cryo-geyser / cryovolcano plumes (ballistic vapour + ice grains through the shared particle system)
//   - spindrift: low ice-dust gusts skimming the ground around the player
// Created by main.js makeWorld for recipes flagged ICE; update() is called every surface frame.
import * as THREE from 'three';
import { hash2 } from './noise.js';
import { gfx, setupMat, applyCurvature } from './gfx.js';
import { noiseTexture, NOISE_TEX_GLSL } from './noisetex.js';
import { makeIceMaterial } from './terrain/iceterrain.js';
import { GLB } from './glbmodels.js';
import { Particles } from './fx.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ crystal geometry
/** a cluster of fractured ice shards, unit height (tallest = 1, base just underground), footprint radius about 0.55.
 *  Every shard has its own irregular 3..7 sided cross-section, a lateral kink at mid height (fracture), taper, lean and a slanted,
 *  broken-off top. lod 1 drops two rings' worth of detail and the smallest shards (far spires). */
export function crystalGeo(variant, lod = 0) {
  const R = (k) => hash2(variant, k, 77);
  const n = (9 + (variant % 4) * 2) - (lod ? 4 : 0);
  const pos = [];
  const tri = (a, b, c) => { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
  for (let k = 0; k < n; k++) {
    const q = k * 19, main = k === 0, tall = k === 1 || (k < 4 && R(q + 1) > 0.55);
    const ang = R(q + 2) * 6.283, off = main ? 0 : 0.1 + 0.3 * Math.sqrt(R(q + 3));
    const bx = Math.cos(ang) * off, bz = Math.sin(ang) * off;
    const h = main ? 1.0 : tall ? 0.62 + 0.3 * R(q + 4) : 0.14 + 0.46 * R(q + 4) * R(q + 5);
    const sides = 3 + Math.floor(R(q + 6) * 5);                                  // triangular .. heptagonal
    const rad = (main ? 0.17 : 0.07 + 0.09 * R(q + 7)) * (0.85 + 0.5 * h), asp = 0.55 + 0.9 * R(q + 8), rot = R(q + 9) * 6.283;
    const lean = main ? 0.05 + 0.1 * R(q + 10) : 0.14 + 0.5 * R(q + 10), la = main ? R(q + 11) * 6.283 : ang + (R(q + 11) - 0.5) * 1.6;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const kinkY = 0.45 + 0.2 * R(q + 12), kx = (R(q + 13) - 0.5) * 0.16 * h, kz = (R(q + 14) - 0.5) * 0.16 * h;   // fracture offset
    const taper = 0.45 + 0.4 * R(q + 15), cutX = (R(q + 16) - 0.5) * 2, cutZ = (R(q + 17) - 0.5) * 2, cutK = 0.04 + 0.2 * R(q + 18);
    const rings = [];
    const ring = (t, scale) => {                                                   // t = fraction of the shard height
      const y = -0.06 + (h + 0.06) * t, o = [];
      const sh = t > kinkY ? 1 : 0;
      for (let i = 0; i < sides; i++) {
        const a = rot + (i + 0.35 * (R(q * 3 + i * 5 + 1) - 0.5)) / sides * 6.2832;
        const rr = rad * scale * (0.6 + 0.8 * R(q * 5 + i * 7 + 2));
        const px = Math.cos(a) * rr * asp, pz = Math.sin(a) * rr;
        const slant = t >= 0.999 ? cutK * h * (px * cutX + pz * cutZ) / Math.max(rad, 0.02) : 0;   // slanted broken top
        o.push([bx + lx * y + sh * kx + px, y + slant, bz + lz * y + sh * kz + pz]);
      }
      return o;
    };
    rings.push(ring(0, 1.0));
    if (!lod) rings.push(ring(kinkY, 0.92));
    rings.push(ring(lod ? 0.9 : 0.97, taper));
    const top = rings[rings.length - 1];
    // cap: fan to a point lifted off the centroid so the break reads as a ridge
    let cx = 0, cy = 0, cz = 0; for (const v of top) { cx += v[0]; cy += v[1]; cz += v[2]; }
    cx /= sides; cy /= sides; cz /= sides;
    const apex = [cx + (R(q + 20) - 0.5) * rad * 0.8, cy + (0.04 + 0.22 * R(q + 21)) * h, cz + (R(q + 22) - 0.5) * rad * 0.8];
    for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides, a = rings[r], b = rings[r + 1];
      tri(a[i], b[i], a[i2]); tri(a[i2], b[i], b[i2]);
    }
    for (let i = 0; i < sides; i++) tri(top[i], apex, top[(i + 1) % sides]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();                                     // non-indexed: flat facets
  return g;
}

// ------------------------------------------------------------------ materials
const PROP_GLSL = NOISE_TEX_GLSL;
function hookProp(shader, crystal) {
  applyCurvature(shader);
  shader.uniforms.uNoise = { value: noiseTexture() }; shader.uniforms.uSunW = { value: gfx.sunDir };
  shader.vertexShader = 'varying vec3 vWP; varying vec3 vWN; varying float vLY;\n' + shader.vertexShader.replace('#include <begin_vertex>',
    `#include <begin_vertex>
  vLY = position.y;
#ifdef USE_INSTANCING
  vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);
#endif`);
  shader.fragmentShader = `varying vec3 vWP; varying vec3 vWN; varying float vLY; uniform vec3 uSunW;\n${PROP_GLSL}\n` + shader.fragmentShader
    .replace('#include <color_fragment>', crystal ? `#include <color_fragment>
  float cT = clamp(vLY, 0.0, 1.0);
  float cS = vnoise(vec3(vWP.x * 1.3 + vWP.z * 0.9, vWP.y * 0.18, vWP.z * 1.3 - vWP.x * 0.9)), cF = vnoise(vWP * 0.35 + 3.0);
  diffuseColor.rgb = mix(vec3(0.01, 0.07, 0.30), vec3(0.20, 0.52, 0.92), pow(cT, 0.7)) * (0.7 + 0.5 * cS) * (0.8 + 0.4 * cF);
` : `#include <color_fragment>
  float rA = vnoise(vWP * 0.9), rB = vnoise(vWP * 3.7 + 5.0);
  float up = smoothstep(0.35, 0.8, vWN.y + 0.25 * rB - 0.1);
  vec3 iceC = mix(vec3(0.20, 0.38, 0.72), vec3(0.50, 0.68, 0.92), rA) * (0.8 + 0.4 * rB);
  diffuseColor.rgb = mix(iceC, vec3(0.88, 0.93, 1.0) * (0.92 + 0.08 * rB), up * 0.85);       // snow settles on the upper faces
`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 Vw = normalize(cameraPosition - vWP); vec3 Nw = normalize(vWN);
    float fr = pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 2.4);
    float lit = clamp(dot(Nw, uSunW) * 0.5 + 0.5, 0.0, 1.0);
    float sunUp = smoothstep(-0.04, 0.14, uSunW.y);
    ${crystal ? `float cT2 = clamp(vLY, 0.0, 1.0);
    float ndv = clamp(dot(Nw, Vw), 0.0, 1.0);
    // translucent look: deep-blue light welling up from inside (strongest looking straight through, fading to the tips), bright
    // cyan fresnel on grazing faces, internal fracture veins, hard bright facet edges and a sun glint
    vec3 inner = vec3(0.03, 0.26, 1.0) * (0.35 + 0.9 * pow(ndv, 1.4)) * (0.55 + 0.6 * (1.0 - cT2 * 0.5)) * (0.45 + 0.55 * max(lit * sunUp, 0.35));
    float vein = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(vec3(vWP.x * 0.25 + vWP.z * 0.18, vWP.y * 0.07, vWP.z * 0.25 - vWP.x * 0.15) + 7.0) - 0.5));
    float edge = clamp(length(fwidth(Nw)) * 7.0, 0.0, 1.0);
    vec3 Rv = reflect(-uSunW, Nw); float glint = pow(max(dot(Rv, Vw), 0.0), 40.0) * sunUp;
    totalEmissiveRadiance += inner * 0.95 + vec3(0.30, 0.78, 1.0) * fr * 0.8 + vec3(0.3, 0.65, 1.0) * vein * 0.5 * (0.3 + ndv)
      + vec3(0.7, 0.92, 1.0) * edge * (0.35 + 0.65 * lit * sunUp) * 0.9 + vec3(0.85, 0.95, 1.0) * glint * 2.2;` : `totalEmissiveRadiance += vec3(0.05, 0.22, 0.6) * (0.15 + 0.6 * lit * lit) * sunUp * 0.35 * (1.0 - up) + vec3(0.2, 0.4, 0.9) * fr * 0.06;`}
  }`);
}
function propMaterial(crystal, key) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: crystal ? 0.2 : 0.36, metalness: 0.0, flatShading: false });
  setupMat(m, key, (sh) => hookProp(sh, crystal));
  m.envMapIntensity = crystal ? 1.4 : 0.8;
  return m;
}

// ------------------------------------------------------------------ the layer
export class IceWorld {
  constructor(terrain, rc, scatter, discovery) {
    this.t = terrain; this.rc = rc; this.sc = scatter; this.group = new THREE.Group();
    terrain.ice = this;                                   // handle for debugging / profiling
    terrain.mat = makeIceMaterial(); terrain.mat.envMapIntensity = rc.ENV ?? 0.85;
    this.matCrystal = propMaterial(true, 'ice-crystal'); this.matRock = propMaterial(false, 'ice-rock');
    this._reskinScatter();
    // frost shards
    this.shardGeo = [0, 1, 2, 3].map((v) => crystalGeo(30 + v, 1));
    this.shards = this.shardGeo.map((g) => { const m = new THREE.InstancedMesh(g, this.matCrystal, 900); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.customDepthMaterial = scatter.depthMat; this.group.add(m); return m; });
    this.lastShard = new THREE.Vector3(1e9, 0, 1e9);
    // pad lamp posts
    const pole = new THREE.BoxGeometry(0.14, 1.8, 0.14); pole.translate(0, 0.9, 0);
    const lamp = new THREE.SphereGeometry(0.22, 8, 6); lamp.translate(0, 1.95, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.6, metalness: 0.4 });
    poleMat.onBeforeCompile = applyCurvature; poleMat.customProgramCacheKey = () => 'ice-pole';
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.9, 0.45) });
    this.lampMat.onBeforeCompile = applyCurvature; this.lampMat.customProgramCacheKey = () => 'ice-lamp';
    this.poles = new THREE.InstancedMesh(pole, poleMat, 160); this.lamps = new THREE.InstancedMesh(lamp, this.lampMat, 160);
    for (const m of [this.poles, this.lamps]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
    this.padKey = '';
    // plumes
    this.gey = []; this.geyFrame = 0; this.acc = new Map(); this.spin = 0;
    this.pp = new Particles(14000); this.group.add(this.pp.points); this.pp.mat.uniforms.uNear.value = 70;
    this.pp.mat.vertexShader = this.pp.mat.vertexShader.replace('220.0', '90.0');      // cap sprite size: big plume sprites close to the camera cost fill rate       // plumes get their own particle pool (the shared one is for dust and sparks)
  }
  /** swap the scatter system's dusty look for ice: crystal pillars in the spire slots, icy kit rocks for boulders */
  _reskinScatter() {
    const sc = this.sc;
    this.crystalGeos = [0, 1].map((lod) => [0, 1, 2, 3, 4].map((v) => crystalGeo(v, lod)));
    [sc.spireNear, sc.spireFar].forEach((arr, lod) => arr.forEach((m, v) => { m.geometry.dispose(); m.geometry = this.crystalGeos[lod][v]; m.material = this.matCrystal; }));
    sc.nearSpire = 4200;
    for (const m of [...sc.bigB, ...sc.smallB, ...sc.arches]) m.material = this.matRock;
    const rg = GLB['verdant/rocks'];
    if (rg) {
      const part = (node) => { let g = null; rg.scene.getObjectByName(node).traverse((o) => { if (o.isMesh && !g) g = o.geometry; }); return g; };
      let src = null; rg.scene.traverse((o) => { if (o.isMesh && !src) src = o.material; });
      if (src && src.normalMap) { this.matRock.normalMap = src.normalMap; this.matRock.normalScale = new THREE.Vector2(0.8, 0.8); this.matRock.needsUpdate = true; }
      sc.kitRocks = ['a', 'b', 'c'].map((n) => ['LOD0', 'LOD1'].map((l, lod) => { const m = new THREE.InstancedMesh(part('rock_' + n + '_' + l), this.matRock, lod === 0 ? 1400 : 9000); m.count = 0; m.frustumCulled = false; m.castShadow = lod === 0; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.customDepthMaterial = sc.depthMat; sc.group.add(m); return m; }));
      sc.kitHalf = [1.5, 2.3, 0.95];
    }
  }

  reset() { this.lastShard.set(1e9, 0, 1e9); this.padKey = ''; this.gey = []; this.acc.clear(); }

  // ---------------------------------------------------------------- per-frame
  update(dt, cam, focus, sun, particles, time, g) {
    const o = this.t.origin, rc = this.rc, cx = focus.x + o.x, cz = focus.z + o.z;
    if (o.x !== this.ox || o.z !== this.oz || Math.hypot(cx - this.lastShard.x, cz - this.lastShard.z) > 28) { this.ox = o.x; this.oz = o.z; this._rebuildLocal(cx, cz, o); }       // also after a scene-origin shift
    this.lampMat.color.setRGB(4.2 + 1.4 * Math.sin(time * 1.6), 1.6 + 0.5 * Math.sin(time * 1.6), 0.4);
    this.pp.uScale.value = particles.uScale.value; this.pp.light.value.copy(particles.light.value);
    this._plumes(dt, cam, o, this.pp, time, g);
    this.pp.update(dt, g, null);
    this._spindrift(dt, focus, particles, time);
  }
  _rebuildLocal(cx, cz, o) {
    const rc = this.rc; this.lastShard.set(cx, 0, cz);
    // shards
    const CELL = 20, RAD = 170, counts = [0, 0, 0, 0];
    const i0 = Math.floor((cx - RAD) / CELL), i1 = Math.floor((cx + RAD) / CELL), j0 = Math.floor((cz - RAD) / CELL), j1 = Math.floor((cz + RAD) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const mx = (i + 0.5) * CELL - cx, mz = (j + 0.5) * CELL - cz; if (mx * mx + mz * mz > RAD * RAD) continue;
      const fr = rc.frostAt((i + 0.5) * CELL, (j + 0.5) * CELL);
      const n = Math.floor(fr * fr * 2.6 + hash2(i, j, 311));
      for (let k = 0; k < n; k++) {
        const x = (i + hash2(i * 7 + k, j, 312)) * CELL, z = (j + hash2(i, j * 7 + k, 313)) * CELL;
        const u = hash2(i + k, j, 314), v = Math.floor(hash2(i, j + k, 315) * 4);
        if (counts[v] >= 900) continue;
        const s = 0.35 + u * u * 2.1 * (0.5 + fr);
        tmpQ.setFromAxisAngle(UP, hash2(i + k, j + 5, 316) * 6.283); tmpP.set(x - o.x, rc.heightAt(x, z) - 0.05, z - o.z); tmpS.set(s * 0.8, s, s * 0.8);
        tmpM.compose(tmpP, tmpQ, tmpS); this.shards[v].setMatrixAt(counts[v]++, tmpM);
      }
    }
    this.shards.forEach((m, v) => { m.count = counts[v]; m.instanceMatrix.needsUpdate = true; });
    // pad lamp posts
    let np = 0;
    for (const p of rc.poisNear(cx, cz, 700)) {
      if (p.type !== 'pad') continue;
      for (let k = 0; k < 8 && np < 160; k++) {
        const a = k / 8 * 6.2832 + 0.2, x = p.x + Math.cos(a) * p.r * 0.97, z = p.z + Math.sin(a) * p.r * 0.97;
        tmpQ.identity(); tmpP.set(x - o.x, rc.heightAt(x, z), z - o.z); tmpS.set(1, 1, 1); tmpM.compose(tmpP, tmpQ, tmpS);
        this.poles.setMatrixAt(np, tmpM); this.lamps.setMatrixAt(np, tmpM); np++;
      }
    }
    this.poles.count = this.lamps.count = np; this.poles.instanceMatrix.needsUpdate = this.lamps.instanceMatrix.needsUpdate = true;
  }
  _plumes(dt, cam, o, particles, time, g) {
    const rc = this.rc, cx = cam.x + o.x, cz = cam.z + o.z;
    if (this.geyFrame++ % 30 === 0) this.gey = rc.poisNear(cx, cz, 6500).filter((p) => p.type === 'geyser' || p.type === 'cryo');
    for (const p of this.gey) {
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), range = p.type === 'cryo' ? 5000 : 2600;
      if (d > range) continue;
      const key = p.ix + ',' + p.iz; const sc = p.plume || 1;
      const pulse = 0.6 + 0.4 * Math.sin(time * 0.37 + p.seed * 0.01) * Math.sin(time * 0.91 + p.seed);
      let a = (this.acc.get(key) || 0) + (p.type === 'cryo' ? 200 : 320) * (p.type === 'cryo' ? 1 : sc) * pulse * dt * (1 - 0.4 * d / range);
      const vy0 = p.type === 'cryo' ? p.plume * 11.5 : 12 + 5 * sc;           // m/s: apex = vy^2 / 2g
      const baseY = rc.heightAt(p.x, p.z) + 0.3;
      while (a >= 1) {
        a -= 1;
        const th = Math.random() * 6.2832, hs = vy0 * 0.24 * Math.pow(Math.random(), 0.7);
        const vy = vy0 * (0.7 + 0.35 * Math.random()), life = Math.min(vy / g * 0.95, 26);
        const rad = Math.random() * (p.type === 'cryo' ? 7 : 1.2);
        const px = p.x - o.x + Math.cos(th) * rad, pz = p.z - o.z + Math.sin(th) * rad;
        particles.emit(px, baseY, pz, Math.cos(th) * hs, vy, Math.sin(th) * hs, 1.1 * Math.sqrt(sc), 5 * sc, life, 0.8, 0.93, 1.0, 0.13, 0.8);
        if (Math.random() < 0.12) {          // ice grains fall back as fresh frost: small, bright, wide
          const th2 = Math.random() * 6.2832, h2 = vy0 * (0.3 + 0.5 * Math.random());
          particles.emit(px, baseY + 2, pz, Math.cos(th2) * h2, vy * (0.4 + 0.5 * Math.random()), Math.sin(th2) * h2, 0.28, 0.2, Math.min(2 * vy / g, 22), 0.9, 0.95, 1.0, 0.45, 0);
        }
      }
      this.acc.set(key, a);
    }
  }
  _spindrift(dt, focus, particles, time) {
    // low gusts of ice dust skimming along the ground (electrostatic lofting on an airless moon), around the player
    const o = this.t.origin;
    this.spin += dt * 16;
    while (this.spin >= 1) {
      this.spin -= 1;
      const gust = 0.5 + 0.5 * Math.sin(time * 0.23 + 1.3) * Math.sin(time * 0.071);
      if (Math.random() > 0.25 + gust) continue;
      const a = Math.random() * 6.283, d = 10 + Math.random() * 90, x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
      const y = this.rc.heightAt(x + o.x, z + o.z) + 0.25;
      particles.emit(x, y, z, 5.2 + Math.random() * 2.5, 0.7 + Math.random() * 1.6, 3.0 + Math.random() * 1.6, 0.5, 1.6, 4 + Math.random() * 3, 0.85, 0.92, 1.0, 0.22, 0);
    }
  }
}
