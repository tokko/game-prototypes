// Ice terrain material (Glaciera): replaces the standard terrain material for recipes flagged ICE.
// Per-vertex channels from terrain/glaciera.js materialAt: aux = [snow, ice, lead, pad].
// Look: bright wind-scoured snow, pale blue ice sheet with a fine crack web, deep translucent-looking blue where the ice is
// exposed (crack walls, ridge faces; fake subsurface scattering = a sun-wrapped emissive term + fresnel), black glossy lead
// ice, stained regolith-rich ice, and a painted landing bullseye on the pads.
import * as THREE from 'three';
import { gfx, applyCurvature, setupMat } from '../gfx.js';
import { noiseTexture, NOISE_TEX_GLSL } from '../noisetex.js';

const GLSL = NOISE_TEX_GLSL + `
float vn(vec2 p){ return vn2(p); }
float fb(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 3; k++){ s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s * 1.14; }
`;

function hookIce(shader) {
  applyCurvature(shader);
  shader.uniforms.uNoise = { value: noiseTexture() };
  shader.uniforms.uSunW = { value: gfx.sunDir };         // same Vector3 object the sun setter updates in place
  shader.vertexShader = 'attribute vec4 aux; varying vec4 vAux; varying vec3 vWP; varying vec3 vWN;\n' + shader.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\n vAux = aux; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
  shader.fragmentShader = `varying vec4 vAux; varying vec3 vWP; varying vec3 vWN; uniform vec3 uSunW;
${GLSL}
` + shader.fragmentShader
    .replace('#include <color_fragment>', `
  float dstV = length(vViewPosition);
  vec2 wp = vWP.xz;
  float nearW = 1.0 - smoothstep(25.0, 220.0, dstV), midW = 1.0 - smoothstep(400.0, 4000.0, dstV);
  float n1 = fb(wp * 0.31), n2 = fb(wp * 0.035 + 5.0), n4 = vn(wp * 0.01 + 3.0);
  float slope = sqrt(max(0.0, 1.0 - vWN.y * vWN.y));
  float snow = vAux.x, ice = vAux.y, lead = vAux.z, pd = vAux.w;
  float blueK = smoothstep(0.58, 1.0, ice), dirtK = smoothstep(0.5, 0.2, ice);
  // frozen-ocean sheet: pale blue-white, mottled at plate scale, with a fine web of hairline cracks near the camera
  vec3 sheet = mix(vec3(0.38, 0.55, 0.80), vec3(0.62, 0.78, 0.95), clamp(0.5 + 1.3 * (n2 - 0.5) + 0.7 * (n4 - 0.5), 0.0, 1.0));
  sheet *= 0.92 + 0.16 * mix(0.5, n1, nearW);
  if (nearW > 0.01) {
    float web = 1.0 - smoothstep(0.0, 0.03, abs(vn(wp * 0.8 + 3.0) - 0.5)) * 0.7 - smoothstep(0.0, 0.025, abs(vn(wp * 2.1 + 8.0) - 0.5)) * 0.5;
    sheet *= mix(1.0, clamp(0.78 + 0.22 * web, 0.0, 1.0), nearW * (1.0 - snow));
  }
  vec3 deep = vec3(0.04, 0.17, 0.55) * (0.8 + 0.5 * n1);
  vec3 snowC = vec3(0.86, 0.92, 1.0) * (0.94 + 0.06 * n1);
  vec3 dirtC = vec3(0.30, 0.25, 0.21) * (0.8 + 0.4 * n1);
  vec3 base = mix(sheet, deep, blueK * (1.0 - 0.75 * snow) * 0.9);
  base = mix(base, mix(sheet, deep * 2.2, 0.68), smoothstep(0.42, 0.75, slope) * 0.9);           // steep faces: clean blue-white ice
  base = mix(base, dirtC, dirtK * 0.85 * (1.0 - 0.6 * snow));
  base = mix(base, snowC, snow * (1.0 - smoothstep(0.34, 0.62, slope)));
  base = mix(base, vec3(0.004, 0.012, 0.03), lead);
  float padK = 1.0 - smoothstep(1.0, 1.28, pd);
  float rough = mix(0.30, 0.88, snow);
  rough = mix(rough, 0.06, lead);
  rough = mix(rough, 0.34, blueK * (1.0 - snow));
  rough = mix(rough, 0.1, smoothstep(0.5, 0.8, slope) * (1.0 - snow));      // glassy faces
  rough = mix(rough, 0.6, padK);
  if (padK > 0.0) {                                                                      // landing pad: scraped grey-blue ice, orange and white bullseye
    vec3 padC = vec3(0.17, 0.23, 0.31) * (0.9 + 0.2 * vn(wp * 1.7));
    float ring1 = 1.0 - smoothstep(0.012, 0.026, abs(pd - 0.9));
    float ring2 = 1.0 - smoothstep(0.012, 0.026, abs(pd - 0.5));
    float ring3 = 1.0 - smoothstep(0.012, 0.026, abs(pd - 0.2));
    float bull = 1.0 - smoothstep(0.035, 0.06, pd);
    base = mix(base, padC, padK * 0.95);
    base = mix(base, vec3(0.95, 0.28, 0.04), clamp(ring1 + bull, 0.0, 1.0) * padK);
    base = mix(base, vec3(0.78, 0.84, 0.92), clamp(ring2 + ring3 * 0.8, 0.0, 1.0) * padK * (1.0 - bull));
    snow = snow * (1.0 - padK); blueK *= 1.0 - padK;
  }
  diffuseColor.rgb = base;
`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = rough;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (dstV < 1500.0) {
    // fine ice grain, wind-sculpted sastrugi (stretched along the drift direction) and chips as relief
    vec2 e = vec2(0.3, 0.0);
    vec2 wd = vec2(0.8525, 0.5227), wn = vec2(-0.5227, 0.8525);
    vec2 sp0 = vec2(dot(wp, wd) * 0.18, dot(wp, wn) * 1.1);
    float s0 = vn(sp0), gu = (vn(sp0 + vec2(0.06, 0.0)) - s0) / 0.06, gv = (vn(sp0 + vec2(0.0, 0.06)) - s0) / 0.06;
    vec2 gs = (wd * gu * 0.18 + wn * gv * 1.1) * 0.035 * snow * nearW;
    float h0 = vn(wp * 2.7), hx = vn((wp + e.xy) * 2.7), hz = vn((wp + e.yx) * 2.7);
    vec2 gg = vec2(hx - h0, hz - h0) / 0.3 * 0.03 * nearW * (1.0 - 0.6 * snow);
    float m0 = vn(wp * 0.7), mx = vn(wp * 0.7 + e.xy), mz = vn(wp * 0.7 + e.yx);
    gg += vec2(mx - m0, mz - m0) / 0.3 * 0.05 * midW;
    gg += gs;
    gg *= 1.0 - 0.9 * lead;
    normal = normalize(normal + mat3(viewMatrix) * vec3(-gg.x, 0.0, -gg.y));
  }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    // fake subsurface scattering: sun light wrapped into the ice and re-emitted blue, plus a cool fresnel rim
    vec3 Vw = normalize(cameraPosition - vWP); vec3 Nw = normalize(vWN);
    float fr = pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 3.0);
    float lit = clamp(dot(Nw, uSunW) * 0.5 + 0.5, 0.0, 1.0);
    float sunUp = smoothstep(-0.04, 0.14, uSunW.y);
    float thick = (0.06 + 0.4 * blueK + 0.12 * (1.0 - snow)) * (1.0 - lead) * (1.0 - padK);
    vec3 sss = vec3(0.05, 0.25, 0.72) * thick * (0.12 + 0.88 * lit * lit) * sunUp;
    vec3 rim = vec3(0.16, 0.36, 0.85) * fr * 0.10 * (1.0 - snow * 0.7);
    // frost glitter: sparse facets catching the sun, flickering with the view angle
    float glit = 0.0;
    if (dstV < 60.0) { vec2 gp = wp * 14.0, gc = floor(gp); float gh = texture2D(uNoise, (gc + floor(Vw.xz * 5.0) * 7.0 + 0.5) / 256.0).b;
      glit = smoothstep(0.985, 1.0, gh) * (1.0 - smoothstep(0.08, 0.34, length(fract(gp) - 0.5))) * (0.4 + 0.6 * snow) * (1.0 - smoothstep(6.0, 60.0, dstV)) * sunUp * clamp(dot(Nw, uSunW) + 0.2, 0.0, 1.0); }
    totalEmissiveRadiance += sss + rim + vec3(0.85, 0.92, 1.0) * glit * 1.4 + vec3(0.02, 0.05, 0.12) * thick * 0.4;
  }`);
}

export function makeIceMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.0 });
  setupMat(m, 'terrain-ice', hookIce);
  m.envMapIntensity = 0.85;
  return m;
}
