// Renderer, post-processing (MSAA HDR -> bloom -> vignette/fade -> ACES+sRGB), cascaded shadows and the
// fake-curvature shader hook shared by terrain / scatter / depth materials.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { atmU, ATMO_PARS, FOG_FRAG } from './atmo.js';

export const curv = { cam: { value: new THREE.Vector3() }, k: { value: 1 / (2 * 320000) }, ri: { value: 0 } };      // ri > 0: concave sphere of that radius (Aethel interior) instead of the convex horizon drop

const CURV_PARS = 'uniform vec3 uCurvCam; uniform float uCurvK; uniform float uCurvRi;\n';
const CURV_VERT = `
#ifdef USE_INSTANCING
  vec4 cwp_ = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  float isy_ = length(instanceMatrix[1].xyz);
#else
  vec4 cwp_ = modelMatrix * vec4(transformed, 1.0);
  float isy_ = 1.0;
#endif
vec2 cdq_ = cwp_.xz - uCurvCam.xz;
float cd2_ = dot(cdq_, cdq_);
if (uCurvRi > 0.0) transformed.y += (uCurvRi - sqrt(uCurvRi * uCurvRi - min(cd2_, 0.9409 * uCurvRi * uCurvRi))) / isy_;
else transformed.y -= cd2_ * uCurvK / isy_;
`;
/** apply the planetary curvature drop (d^2 / 2R relative to the camera) in the vertex shader */
export function applyCurvature(shader) {
  shader.uniforms.uCurvCam = curv.cam;
  shader.uniforms.uCurvK = curv.k;
  shader.uniforms.uCurvRi = curv.ri;
  shader.vertexShader = CURV_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CURV_VERT);
}

export const gfx = { sunDir: new THREE.Vector3(0, 1, 0), mats: [] };

export function initGfx(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  const pr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 400000);
  const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  composer.addPass(renderPass);
  // sanitize HDR before bloom: a single NaN / Inf texel would otherwise smear into black blocks through the blur chain
  const sanitize = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uHeat: { value: 0 }, uHT: { value: 0 } },      // uHeat: heat shimmer strength (Pyra, near lava), 0 = off
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uHeat; uniform float uHT; varying vec2 vUv; void main(){ vec2 uv = vUv; if (uHeat > 0.0) { float k = uHeat * 0.0028 * smoothstep(1.0, 0.25, vUv.y); uv += vec2(sin(vUv.y * 120.0 + uHT * 4.1) + 0.6 * sin(vUv.y * 53.0 - uHT * 2.7), 0.5 * sin(vUv.x * 80.0 + uHT * 3.3)) * k; } vec4 c = texture2D(tDiffuse, uv); if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0); gl_FragColor = vec4(min(c.rgb, vec3(300.0)), c.a); }`,
  });
  composer.addPass(sanitize);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.7, 1.0);
  composer.addPass(bloom);
  const finalPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uFade: { value: 1 }, uVig: { value: 0.42 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uFade; uniform float uVig; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 p = (vUv - 0.5) * vec2(1.0, 0.82);
        float v = smoothstep(0.85, 0.2, length(p)); c.rgb *= mix(1.0 - uVig, 1.0, v) * uFade; gl_FragColor = c; }`,
  });
  composer.addPass(finalPass);
  composer.addPass(new OutputPass());

  // light rig (moved between scenes by main): CSM sun + Tamber-shine + hemisphere fill
  const rig = new THREE.Group();
  const csm = new CSM({
    camera, parent: rig, cascades: 4, maxFar: 1400, mode: 'custom', shadowMapSize: 2048,
    customSplitsCallback: (n, near, far, target) => { target.length = 0; target.push(0.02, 0.07, 0.25, 1); },
    lightDirection: new THREE.Vector3(-0.5, -0.5, -0.5).normalize(), lightIntensity: 5.4, lightNear: 1, lightFar: 3200, lightMargin: 300,
  });
  csm.fade = true;
  for (const l of csm.lights) { l.shadow.normalBias = 0.22; l.shadow.bias = -0.00006; }
  const fill = new THREE.DirectionalLight(0xff9a50, 0.7); fill.position.set(0, 1, 0); rig.add(fill); rig.add(fill.target);
  const hemi = new THREE.HemisphereLight(0x242b3c, 0x3a342c, 0.3); rig.add(hemi);

  Object.assign(gfx, { sanitize, renderer, camera, composer, renderPass, bloom, finalPass, rig, csm, fill, hemi, pr });

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    csm.updateFrustums();
  });
  return gfx;
}

/** set the sun (direction TOWARDS the sun in render space) */
export function setSun(dirToSun, intensity, color) {
  gfx.sunDir.copy(dirToSun);
  gfx.csm.lightDirection.copy(dirToSun).negate();
  for (const l of gfx.csm.lights) { l.intensity = intensity; if (color) l.color.copy(color); }
}
export function setFill(dirToGiant, intensity, color) {
  gfx.fill.position.copy(dirToGiant).multiplyScalar(100);
  gfx.fill.intensity = intensity; if (color) gfx.fill.color.copy(color);
}

/** register a lit material for cascaded shadows (+ optional extra vertex/fragment hook). `key` isolates the program cache. */
export function setupMat(mat, key = 'std', hook = null) {
  gfx.csm.setupMaterial(mat);
  const csmHook = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    csmHook(shader, r); if (hook) hook(shader, r);
    // aerial perspective + valley mist (inert unless the active world has an atmosphere)
    if (shader.fragmentShader.includes('#include <fog_fragment>')) {
      Object.assign(shader.uniforms, atmU);
      shader.fragmentShader = ATMO_PARS + shader.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>\n' + FOG_FRAG);
    }
  };
  mat.customProgramCacheKey = () => key;
  gfx.mats.push(mat);
  return mat;
}
