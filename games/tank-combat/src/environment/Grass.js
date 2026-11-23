// Camera-following GPU grass / wheat / flower ring. One InstancedMesh holds a fixed lattice of cells; the vertex
// shader snaps it to the camera, jitters/keeps/sizes every blade from a hash of its WORLD cell (so nothing pops
// as the ring slides), reads terrain height from a height texture and type/density from the terrain control map.
import {
  InstancedMesh, MeshStandardMaterial, PlaneGeometry, Matrix4, Vector2, DoubleSide, ShaderChunk, Group,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATLAS_UV } from './ProcTextures.js';
import { patchMaterial, atmo } from './Atmosphere.js';

// two rings: the outer one (0.8 m cells out to 62 m) and a denser inner one (0.5 m cells out to ~28 m) so the
// meadow reads continuous near the camera instead of evenly spaced clumps
const RINGS = [
  { lattice: 156, spacing: 0.8, maxDist: 62, fadeA: 48, fadeB: 62, seed: 0, key: 'grassring' },
  { lattice: 120, spacing: 0.5, maxDist: 29, fadeA: 21, fadeB: 29, seed: 313, key: 'grassringInner' },
];

export class GrassRing {
  constructor(terrain, atlas) {
    const heightTex = terrain.createHeightTexture();
    const control = terrain.controlTexture;
    const planes = [];
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
      const g = new PlaneGeometry(0.6, 1, 1, 2);
      g.translate(0, 0.5, 0);
      g.rotateY(a);
      planes.push(g);
    }
    const geo = mergeGeometries(planes);

    this.camXZ = { value: new Vector2() };
    this.group = new Group();
    this.group.name = 'grassRing';
    this.rings = RINGS.map((P) => {
      const snapCell = { value: new Vector2() };
      const mesh = this._makeRing(geo, atlas, { uHeightTex: { value: heightTex }, uControl: { value: control }, uSnapCell: snapCell, uCamXZ: this.camXZ }, P);
      this.group.add(mesh);
      return { snapCell, P };
    });
    this.mesh = this.group; // Game adds `grass.mesh` to the scene
  }

  _makeRing(geo, atlas, uniforms, P) {
    const SPACING = P.spacing, LATTICE = P.lattice;
    const mat = new MeshStandardMaterial({
      map: atlas, alphaTest: 0.5, side: DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.4,
    });
    mat.alphaToCoverage = true;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = atmo.uTime;
      shader.uniforms.uHeightTex = uniforms.uHeightTex;
      shader.uniforms.uControl = uniforms.uControl;
      shader.uniforms.uSnapCell = uniforms.uSnapCell;
      shader.uniforms.uCamXZ = uniforms.uCamXZ;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform sampler2D uHeightTex; uniform sampler2D uControl;
uniform vec2 uSnapCell; uniform vec2 uCamXZ;
varying vec3 vTint; varying float vTipK;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 s2l(vec3 c) { return pow(c, vec3(2.2)); }`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
vec3 transformed = vec3(0.0);
vTint = vec3(1.0); vTipK = 0.0;
#ifdef USE_INSTANCING
{
  vec2 lo = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
  vec2 cell = floor(lo / ${SPACING.toFixed(2)} + 0.5) + uSnapCell;
  float seedO = ${P.seed.toFixed(1)};
  float h1 = hash21(cell + seedO), h2 = hash21(cell + 17.3 + seedO), h3 = hash21(cell + 5.1 + seedO), h4 = hash21(cell + 91.7 + seedO);
  vec2 wxz = cell * ${SPACING.toFixed(2)} + (vec2(h1, h2) - 0.5) * ${SPACING.toFixed(2)} * 1.8;
  float dist = length(wxz - uCamXZ);
  vec2 wuv = (wxz + 1000.0) / 2000.0;
  vec4 ctrl = texture2D(uControl, wuv);
  float roadD = ctrl.r * 40.0, gold = ctrl.g, soil = ctrl.b, meadow = ctrl.a;
  float dens = mix(0.85, 1.0, step(0.4, meadow));
  dens = mix(dens, 1.0, gold);
  dens *= 1.0 - soil * 0.75;
  dens *= smoothstep(3.4, 5.2, roadD);
  float keep = step(h3, dens) * (1.0 - step(${P.maxDist.toFixed(1)}, dist));
  float N = 801.0;
  float ground = texture2D(uHeightTex, vec2((wxz.x + 1000.0) / 2.5 + 0.5, (wxz.y + 1000.0) / 2.5 + 0.5) / N).r;
  // strip: 0 grass, 1 wheat, 2 flowers, 3 dry
  float strip = 0.0;
  if (gold > 0.5) strip = 1.0;
  else if (meadow > 0.4 && h4 < 0.22) strip = 2.0;
  else if (h4 > 0.88) strip = 3.0;
  float hgt = strip == 1.0 ? 0.9 + h2 * 0.25 : 0.5 + h2 * 0.42;
  float wid = strip == 1.0 ? 1.3 : 1.0;
  float fade = 1.0 - smoothstep(${P.fadeA.toFixed(1)}, ${P.fadeB.toFixed(1)}, dist);
  float ang = h4 * 6.283;
  vec2 lp = position.xz * wid;
  lp = vec2(cos(ang) * lp.x - sin(ang) * lp.y, sin(ang) * lp.x + cos(ang) * lp.y);
  float v = position.y;                       // 0..1 blade height
  float sway = (0.08 * sin(uTime * 2.1 + wxz.x * 0.35 + wxz.y * 0.2) + 0.05 * sin(uTime * 0.7 + wxz.x * 0.11)) * (strip == 1.0 ? 1.5 : 1.0);
  transformed.xz = lp + (wxz - lo) + vec2(sway, sway * 0.5) * v * v;
  transformed.y = ground + v * hgt * fade * keep - 0.03;
  if (keep < 0.5 || fade <= 0.001) transformed = vec3(0.0, -50.0, 0.0);
  // colour: terrain grass tones, darker roots / lighter tips
  vec3 lush = s2l(vec3(0.353, 0.416, 0.188)), dry = s2l(vec3(0.541, 0.502, 0.275)), wheat = s2l(vec3(0.69, 0.60, 0.36));
  vec3 tint = mix(lush, dry, h1 * 0.6 + (strip == 3.0 ? 0.5 : 0.0));
  tint = mix(tint, wheat, gold);
  tint *= mix(2.6, 1.95, gold) * (0.85 + 0.3 * h2);
  tint = mix(tint * 0.78, mix(tint, s2l(vec3(0.71, 0.66, 0.41)) * 1.6, 0.25), v);
  if (strip == 2.0) tint = mix(tint, vec3(1.15), 0.55);
  vTint = tint; vTipK = v;
  vec2 ar = vec2(${ATLAS_UV.grass[0]}, ${ATLAS_UV.grass[2]});
  float sw = ${((ATLAS_UV.grass[1] - ATLAS_UV.grass[0]) / 4).toFixed(5)};
  float sh = ${(ATLAS_UV.grass[3] - ATLAS_UV.grass[2]).toFixed(5)};
  vMapUv = vec2(ar.x + (strip + 0.06 + uv.x * 0.88) * sw, ar.y + 0.004 + uv.y * (sh - 0.008));
}
#endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint; varying float vTipK;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vTint;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float bl = pow(max(dot(normalize(vFogView), sunV), 0.0), 3.0);
  reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.85, 0.62) * 0.7 * bl * vTipK;
}`);
    };
    patchMaterial(mat);
    mat.customProgramCacheKey = () => P.key;

    const mesh = new InstancedMesh(geo, mat, LATTICE * LATTICE);
    const m = new Matrix4();
    let k = 0;
    for (let j = 0; j < LATTICE; j++) {
      for (let i = 0; i < LATTICE; i++) {
        m.makeTranslation((i - LATTICE / 2) * SPACING, 0, (j - LATTICE / 2) * SPACING);
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'grassRing_' + P.key;
    return mesh;
  }

  update(camera) {
    this.camXZ.value.set(camera.position.x, camera.position.z);
    for (const r of this.rings) r.snapCell.value.set(Math.floor(camera.position.x / r.P.spacing), Math.floor(camera.position.z / r.P.spacing));
  }
}

void ShaderChunk;
