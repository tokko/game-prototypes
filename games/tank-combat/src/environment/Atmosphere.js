// Shared atmosphere: one set of uniforms + one GLSL fog function used by the sky horizon AND every material,
// so fog and horizon always match (no "game horizon line"). Colours are linear (composer + OutputPass pipeline).
import { Vector3, Matrix3 } from 'three';

export const atmo = {
  uSunDir: { value: new Vector3(-0.828, 0.407, 0.386).normalize() },
  uCamPos: { value: new Vector3() },
  uViewToWorld: { value: new Matrix3() },
  uFogDensity: { value: 0.00048 },
  uFogHeightFalloff: { value: 0.011 },
  uFogMax: { value: 0.8 },
  uTime: { value: 0 },
  uWind: { value: new Vector3(1.2, 0, 0.4) },
};

export const ATMO_UNIFORMS = {
  uSunDir: atmo.uSunDir, uCamPos: atmo.uCamPos, uViewToWorld: atmo.uViewToWorld,
  uFogDensity: atmo.uFogDensity, uFogHeightFalloff: atmo.uFogHeightFalloff, uFogMax: atmo.uFogMax,
};

export const ATMO_PARS_VERT = 'varying vec3 vFogView;';
export const ATMO_VERT = 'vFogView = mvPosition.xyz;';

export const ATMO_FOG_COLOR_GLSL = /* glsl */`
vec3 atmoFogColor(vec3 d, vec3 sunDir) {
  float s = pow(max(dot(d, sunDir), 0.0), 6.0);
  return mix(vec3(0.33, 0.41, 0.55), vec3(0.807, 0.624, 0.381), s);
}`;

export const ATMO_PARS_FRAG = /* glsl */`
varying vec3 vFogView;
uniform vec3 uSunDir; uniform vec3 uCamPos; uniform mat3 uViewToWorld;
uniform float uFogDensity; uniform float uFogHeightFalloff; uniform float uFogMax;
${ATMO_FOG_COLOR_GLSL}`;

export const ATMO_FRAG = /* glsl */`
{
  vec3 rayW = uViewToWorld * vFogView;
  float dist = length(rayW);
  vec3 dirW = rayW / max(dist, 1e-4);
  float hAvg = uCamPos.y + rayW.y * 0.5;
  float dens = uFogDensity * exp(-max(hAvg, 0.0) * uFogHeightFalloff);
  float f = min(1.0 - exp(-dist * dens), uFogMax);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, atmoFogColor(dirW, uSunDir), f);
}`;

export function injectAtmosphere(shader) {
  Object.assign(shader.uniforms, ATMO_UNIFORMS);
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', ATMO_PARS_VERT)
    .replace('#include <fog_vertex>', ATMO_VERT);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', ATMO_PARS_FRAG)
    .replace('#include <fog_fragment>', ATMO_FRAG);
}

// wraps any existing onBeforeCompile so the material uses the shared atmosphere fog
export function patchMaterial(mat) {
  const prev = mat.onBeforeCompile;
  // the default cache key is onBeforeCompile.toString(); make it depend on the wrapped hook too
  const prevKey = mat.customProgramCacheKey.call(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    injectAtmosphere(shader);
  };
  mat.customProgramCacheKey = () => 'atmo|' + prevKey;
  mat.fog = true;
  return mat;
}

// call once per frame
export function updateAtmosphere(camera, time) {
  atmo.uCamPos.value.copy(camera.position);
  atmo.uViewToWorld.value.setFromMatrix4(camera.matrixWorld);
  atmo.uTime.value = time;
}
