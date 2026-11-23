// Chunked quadtree LOD terrain around the camera. Chunk geometry is generated in workers from the recipe's
// heightAt (the same function physics uses). Seams are hidden with skirts; planetary curvature is a vertex-shader drop.
import * as THREE from 'three';
import { gfx, applyCurvature, setupMat } from '../gfx.js';
import { noiseTexture, NOISE_TEX_GLSL } from '../noisetex.js';
import { NG } from '../nythfx.js';      // Nyth: shared glow uniforms

const N = 48, MIN = 48, ROOT = 12;       // 48 m chunks (1 m grid) up to 196 km
const SPLIT = 2.5;
const sizeOf = (l) => MIN * Math.pow(2, l);
const keyOf = (l, i, j) => l + ':' + i + ':' + j;

export const terrainUniforms = {
  uNoise: { value: noiseTexture() },
  uDust: { value: new THREE.Color().setRGB(0.88, 0.81, 0.69, THREE.SRGBColorSpace) },
  uDustDark: { value: new THREE.Color().setRGB(0.70, 0.62, 0.52, THREE.SRGBColorSpace) },
  uRock: { value: new THREE.Color().setRGB(0.30, 0.255, 0.22, THREE.SRGBColorSpace) },
  uRockLight: { value: new THREE.Color().setRGB(0.52, 0.45, 0.39, THREE.SRGBColorSpace) },
  uRust: { value: new THREE.Color().setRGB(0.58, 0.34, 0.22, THREE.SRGBColorSpace) },
  uBlue: { value: new THREE.Color().setRGB(0.66, 0.74, 0.82, THREE.SRGBColorSpace) },
  // lush-world palette (Verdant): uLush > 0.5 switches the shader to grass / mud / sand / moss-rock shading
  uLush: { value: 0 }, uCrackT: { value: 0 }, uSnowY: { value: 1950 },
  uGrassA: { value: new THREE.Color(0.17, 0.40, 0.09) }, uGrassB: { value: new THREE.Color(0.34, 0.54, 0.13) }, uDry: { value: new THREE.Color(0.58, 0.55, 0.24) },
  uMud: { value: new THREE.Color(0.2, 0.15, 0.1) }, uSand: { value: new THREE.Color(0.6, 0.54, 0.38) }, uMoss: { value: new THREE.Color(0.2, 0.34, 0.1) },
  ...NG,      // Nyth bioluminescence: uNyth (0 = off), uNyTint, uNyGlowA/B, uNyGround, uNyPl
  // AETHEL: circular window cut out of the terrain (the gate hole in the interior wall); uHoleR = 0 disables it
  uHoleR: { value: 0 }, uHoleC: { value: new THREE.Vector2() },
  uStrataTint: { value: new THREE.Vector3(1, 1, 1) }, uOutcK: { value: 1 },      // AETHEL: lush-mode rock tint and gravel-outcrop strength (1 = Verdant)
};

const NOISE_GLSL = NOISE_TEX_GLSL + `
float vn(vec2 p){ return vn2(p); }
float fb(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 3; k++){ s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s * 1.14; }
vec2 vor(vec2 p){ vec2 ip = floor(p), fp = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec4 r = texture2D(uNoise, (ip + g + 0.5) / 256.0); float d = length(g + 0.15 + 0.7 * r.gb - fp);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(d1, d2); }
vec2 craterGrad(vec2 p, float cell, float prob){
  vec2 q = p / cell; vec2 i = floor(q); vec2 g = vec2(0.0);
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    vec2 c = i + vec2(float(dx), float(dy));
    vec4 r = texture2D(uNoise, (c + 0.5) / 256.0);
    if (r.r > prob) continue;
    vec2 ctr = c + 0.25 + 0.5 * r.gb; float rad = 0.2 + 0.26 * r.a;
    vec2 d = (q - ctr) / rad; float dd = length(d);
    if (dd < 1.0) g += 2.0 * d / rad * 0.5;
    else if (dd < 1.7) g += d / max(dd, 1e-3) * (-0.35 * 28.0 * (dd - 1.0) * exp(-(dd - 1.0) * (dd - 1.0) * 14.0)) / rad * 0.5;
  }
  return g;
}
`;

function hookTerrain(shader) {
  applyCurvature(shader);
  Object.assign(shader.uniforms, terrainUniforms);
  shader.vertexShader = 'attribute vec4 aux; varying vec4 vAux; varying vec3 vWP; varying vec3 vWN;\n' + shader.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\n vAux = aux; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
  shader.fragmentShader = `varying vec4 vAux; varying vec3 vWP; varying vec3 vWN;
uniform vec3 uDust; uniform vec3 uDustDark; uniform vec3 uRock; uniform vec3 uRockLight; uniform vec3 uRust; uniform vec3 uBlue;
uniform float uHoleR; uniform vec2 uHoleC; uniform vec3 uStrataTint; uniform float uOutcK;
uniform float uLush; uniform float uCrackT; uniform float uSnowY; uniform vec3 uGrassA; uniform vec3 uGrassB; uniform vec3 uDry; uniform vec3 uMud; uniform vec3 uSand; uniform vec3 uMoss;
uniform float uNyth; uniform vec3 uNyTint; uniform vec3 uNyGlowA; uniform vec3 uNyGlowB; uniform float uNyGround; uniform vec4 uNyPl;
${NOISE_GLSL}
` + shader.fragmentShader
    .replace('#include <color_fragment>', `
  if (uHoleR > 0.0 && distance(vWP.xz, uHoleC) < uHoleR) discard;      // AETHEL gate window
  float dstV = length(vViewPosition);
  vec2 wp = vWP.xz;
  float nearW = 1.0 - smoothstep(30.0, 260.0, dstV), midW = 1.0 - smoothstep(500.0, 5000.0, dstV);
  float n1 = fb(wp * 0.33), n2 = fb(wp * 0.04 + 5.0), n4 = vn(wp * 0.011 + 3.0);
  float slope = sqrt(max(0.0, 1.0 - vWN.y * vWN.y));
  vec2 wpr = wp;                                                              // rock noise space: (along the face, height) on steep ground, (x, z) on flat ground
  { float ck = smoothstep(0.38, 0.72, slope); if (ck > 0.0) { vec2 tg = normalize(vec2(-vWN.z, vWN.x) + vec2(1e-4)); wpr = mix(wp, vec2(dot(wp, tg), vWP.y), ck); } }
  vec3 base; float rockSlope = smoothstep(0.30, 0.58, slope); float rockWn = 0.0, wetK = 0.0, bedF = 0.5; float glassK = 0.0; vec3 lavaEmit = vec3(0.0);
  if (uLush < 0.5) {
  base = mix(uDust, uDustDark, clamp(0.34 + 0.55 * (n2 - 0.5) + 0.35 * (n4 - 0.5), 0.0, 1.0));
  base *= 0.965 + 0.07 * mix(0.5, n1, nearW) + 0.035 * (vn(wp * 8.0) - 0.5) * nearW;
  float rockW = clamp(max(vAux.z * (1.0 - 0.35 * vAux.w) * 0.65, rockSlope) + 0.18 * smoothstep(0.64, 0.86, n2) * midW, 0.0, 1.0);
  vec3 rockC = mix(uRock, uRockLight, clamp(n1 * 1.15, 0.0, 1.0));
  rockC *= 0.86 + 0.28 * vn(vec2(wp.x * 0.16, wp.y * 1.2));   // faint strata streaks
  base = mix(base, rockC, rockW);
  float rustW = vAux.x * (0.5 + 0.6 * n2);
  base = mix(base, uRust * (0.85 + 0.3 * n1), clamp(rustW, 0.0, 0.8));
  base = mix(base, uBlue * (0.85 + 0.3 * n1), clamp(vAux.y * 0.9, 0.0, 0.92));
  } else if (uLush > 1.5) {
    // ---- volcanic mode (Pyra): aux = [heat, ash, rock, glass]. Dark basalt, ash drifts, scoria bands, obsidian glass, glowing crust cracks
    float warm = max(vAux.x, 0.0), streak = max(-vAux.x, 0.0), ash = vAux.y, rockA = vAux.z; glassK = vAux.w;
    float y = vWP.y;
    float hfK = 1.0 - smoothstep(50.0, 450.0, dstV);
    n1 = mix(0.5, n1, hfK);
    float n1r = mix(0.5, fb(wpr * 0.33), hfK), fineR = vn(wpr * 6.0);
    float macro = vn(wp * 0.0013 + 5.0), rope = vn(vec2(wp.x * 0.9 + 3.0 * vn(wp * 0.07), wp.y * 0.9)) ;
    vec3 basalt = mix(vec3(0.028, 0.025, 0.025), vec3(0.092, 0.08, 0.074), clamp(0.5 * n2 + 0.5 * macro + 0.3 * (n1 - 0.5), 0.0, 1.0));
    basalt *= 0.72 + 0.55 * mix(0.5, rope, nearW) + 0.25 * (n1 - 0.5);
    base = basalt;
    // iron-oxide and scoria staining
    float rustP = smoothstep(0.55, 0.8, fb(wp * 0.0035 + 21.0) + 0.2 * (n2 - 0.5));
    base = mix(base, vec3(0.14, 0.05, 0.03) * (0.7 + 0.6 * n1), rustP * 0.3 * (1.0 - ash * 0.5));
    // ash drifts on flatter ground
    float ashW = smoothstep(0.32, 0.72, ash + 0.35 * (n2 - 0.5) + 0.2 * (macro - 0.5)) * (1.0 - smoothstep(0.28, 0.55, slope));
    vec3 ashC = mix(vec3(0.075, 0.068, 0.064), vec3(0.15, 0.13, 0.115), clamp(n1r + 0.3 * (fineR - 0.5), 0.0, 1.0));
    base = mix(base, ashC * (0.8 + 0.4 * mix(0.5, vn(wp * 1.7), nearW)), ashW * 0.7);
    // bedded flows on scarps and cones: dark greys with red scoria and ochre ash layers
    float yw = y + 5.0 * (fb(wpr * 0.012 + 3.0) - 0.5) + 1.6 * (vn(wpr * 0.06) - 0.5);
    float bc = yw * 0.22 + 1.1 * sin(yw * 0.047 + 1.7) + 0.4 * sin(yw * 0.11 + 4.1);
    float bandId = floor(bc); float bf = fract(bc); bedF = bf;
    float bt = texture2D(uNoise, (vec2(bandId, 7.0) + 0.5) / 256.0).b;
    vec3 sc = bt < 0.4 ? vec3(0.05, 0.047, 0.046) : bt < 0.65 ? vec3(0.1, 0.085, 0.075) : bt < 0.8 ? vec3(0.22, 0.07, 0.04) : bt < 0.9 ? vec3(0.3, 0.2, 0.1) : vec3(0.03, 0.03, 0.034);
    sc *= (0.75 + 0.5 * vn(vec2(wpr.x * 0.06, bc * 2.1))) * (0.8 + 0.2 * smoothstep(0.0, 0.25, bf) * smoothstep(1.0, 0.8, bf));
    sc = mix(vec3(0.07, 0.06, 0.055), sc, 1.0 - smoothstep(300.0, 2500.0, dstV));
    float rockW = smoothstep(0.38, 0.55, clamp(max(rockA, smoothstep(0.32, 0.6, slope)), 0.0, 1.0) + 0.2 * (n1r - 0.5));
    base = mix(base, sc, rockW);
    // high flanks: pale ash and sulphur dusting
    float hi = smoothstep(500.0, 1500.0, y) * (1.0 - smoothstep(0.5, 0.8, slope));
    base = mix(base, vec3(0.34, 0.3, 0.24) * (0.8 + 0.3 * n1), hi * 0.5);
    float sulf = smoothstep(0.7, 0.85, fb(wp * 0.02 + 40.0)) * smoothstep(0.0, 0.3, ash) * (1.0 - rockW);
    base = mix(base, vec3(0.5, 0.42, 0.08), sulf * 0.55);
    // obsidian glass: nearly black, glossy, slightly violet
    float gl = smoothstep(0.3, 0.6, glassK + 0.2 * (n2 - 0.5)) * (1.0 - ashW * 0.7);
    base = mix(base, vec3(0.008, 0.009, 0.014), gl);
    glassK = gl;
    base *= 0.85;
    // lava crust: cooling plates with glowing cracks near the flows (heat comes from the recipe), streaks on the cone flanks
    vec2 wpw = wp + 0.9 * vec2(vn(wp * 0.6), vn(wp * 0.6 + 4.0)) + 4.0 * vec2(vn(wp * 0.11 + 2.0), vn(wp * 0.11 + 8.0));
    vec2 vv = vor(wpw / 2.4); float vfade = 1.0 - smoothstep(60.0, 400.0, dstV);
    float crack = (1.0 - smoothstep(0.0, 0.12, vv.y - vv.x)) * vfade + 0.5 * (1.0 - vfade);
    vec2 vv2 = vor(wp / 7.0); float crack2 = (1.0 - smoothstep(0.0, 0.1, vv2.y - vv2.x)) * (1.0 - smoothstep(300.0, 1800.0, dstV)) + 0.4 * smoothstep(300.0, 1800.0, dstV);
    // lava crust: plates with glowing cracks right at the flows; flank flows are continuous orange-to-red ribbons
    float hot = smoothstep(0.935, 0.985, warm);
    float glow = hot * hot * (0.1 + 0.9 * max(crack * smoothstep(0.1, 0.7, vn(wp * 0.23)), crack2 * 0.7)) + hot * hot * hot * hot * 0.7;
    float sk = clamp(streak, 0.0, 1.0);
    float skEdge = smoothstep(0.05, 0.85, sk), skCore = smoothstep(0.45, 1.0, sk);
    float skN = 0.8 + 0.4 * vn(vec2(wp.x * 0.05, wp.y * 0.05 + uCrackT * 0.02)) * mix(1.0, 0.6, smoothstep(2000.0, 8000.0, dstV));
    base = mix(base, vec3(0.02, 0.012, 0.01), clamp(hot * 1.4 + skEdge * 0.7, 0.0, 0.88));
    vec3 skCol = mix(vec3(0.5, 0.045, 0.008), vec3(1.0, 0.27, 0.035), skCore);              // dark red rims, orange core, no white-hot
    vec3 lavaCol = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.62, 0.15), clamp(glow, 0.0, 1.0));
    lavaEmit = lavaCol * (0.45 + 0.95 * glow) * glow * (0.85 + 0.3 * sin(uCrackT * 0.6 + wp.x * 0.07 + wp.y * 0.05)) + skCol * skEdge * (0.55 + 0.7 * skCore) * skN;
    // underglow: warm bounce from nearby lava lights the terrain that faces it (screen-space surface gradient of the warmth field)
    {
      vec3 dpx = dFdx(vWP), dpy = dFdy(vWP); vec3 nn = normalize(vWN);
      vec3 r1 = cross(dpy, nn), r2 = cross(nn, dpx); float det = dot(dpx, r1);
      vec3 gr = (dFdx(warm) * r1 + dFdy(warm) * r2) / (abs(det) > 1e-9 ? det : 1e-9);
      float gl2 = length(gr);
      vec3 toL = gl2 > 1e-7 ? gr / gl2 : vec3(0.0, 1.0, 0.0);
      float face = clamp(dot(nn, normalize(toL + vec3(0.0, 0.35, 0.0))) * 0.5 + 0.5, 0.0, 1.0);
      float ug = pow(warm, 3.2) * (0.25 + 1.0 * face) * (1.0 - 0.7 * hot);
      lavaEmit += vec3(1.0, 0.24, 0.04) * ug * (0.1 + 0.8 * dot(base, vec3(0.33))) * 0.55;
      base = mix(base, base * vec3(1.6, 1.0, 0.7), ug * 0.3);
    }
    rockWn = rockW * 0.8; wetK = 0.0;
  } else {
    float moist = vAux.x, shore = vAux.y, rockA = vAux.z, forest = vAux.w;
    float y = vWP.y;
    float hfK = 1.0 - smoothstep(50.0, 450.0, dstV);                        // fine noise fades with range (aliases into speckle otherwise)
    n1 = mix(0.5, n1, hfK);
    float n1r = mix(0.5, fb(wpr * 0.33), hfK), fineR = vn(wpr * 6.0);
    float macro = vn(wp * 0.0011 + 13.0), macro2 = vn(wp * 0.0042 + 2.0), patchN = fb(wp * 0.017 + 9.0), fine = vn(wp * 6.0);
    // meadow: greens, yellow-green dry patches, darker lush hollows near water
    vec3 grass = mix(uGrassA, uGrassB, smoothstep(0.22, 0.78, 0.55 * n2 + 0.55 * macro + 0.25 * (n4 - 0.5)));
    float dryW = smoothstep(0.44, 0.64, patchN + 0.5 * (macro2 - 0.5) - 0.25 * moist);
    grass = mix(grass, uDry * (0.82 + 0.36 * n1), dryW * 0.85 * (1.0 - 0.7 * forest));
    grass = mix(grass, uGrassA * vec3(0.55, 0.72, 0.55), smoothstep(0.4, 0.9, moist) * 0.65 * smoothstep(0.25, 0.6, n2));   // darker lush hollows
    float blades = vn(vec2(wp.x * 17.0, wp.y * 17.0)), clump = fb(wp * 1.9 + 4.0), tuft = vn(wp * 3.1 + 11.0);
    grass *= 0.78 + 0.42 * macro + 0.34 * (mix(0.5, n1, nearW) - 0.5) + (0.28 * (tuft - 0.5) + 0.22 * (blades - 0.5) + 0.38 * (clump - 0.5)) * nearW;
    grass = mix(grass, grass * vec3(1.2, 1.12, 0.62), smoothstep(0.6, 0.78, clump) * 0.6 * nearW);   // sun-bleached clumps
    // small flowers (near the camera): white / yellow / lilac dots
    { vec2 fc = floor(wp * 5.0); vec4 fr = texture2D(uNoise, (fc + 0.5) / 256.0);
      if (fr.a > 0.955) { float d = length(wp * 5.0 - (fc + 0.25 + 0.5 * fr.gb)); vec3 fcol = fr.r < 0.33 ? vec3(0.9, 0.9, 0.85) : fr.r < 0.66 ? vec3(0.95, 0.8, 0.2) : vec3(0.75, 0.5, 0.85);
        grass = mix(grass, fcol, smoothstep(0.2, 0.08, d) * nearW * (1.0 - forest) * 0.9); } }
    grass *= 1.0 - 0.38 * forest;
    // altitude: grass thins out to tundra on the upper flanks
    float lowF = 1.0 - smoothstep(200.0, 820.0, y);
    grass = mix(grass, uGrassA * vec3(0.55, 0.72, 0.5), lowF * smoothstep(0.1, 0.55, slope) * 0.65);      // dark forested lower flanks
    float alp = smoothstep(780.0, 1350.0, y + 160.0 * (n2 - 0.5));
    grass = mix(grass, mix(uGrassB * vec3(0.78, 0.74, 0.5), uDry * vec3(0.78, 0.72, 0.62), n1), alp * 0.85);
    // soil and mud: winding trails, shorelines, forest floor
    float tr = 1.0 - smoothstep(0.0, 0.017, abs(fb(wp * 0.011 + 31.0) - 0.5));
    float trailW = tr * (1.0 - forest) * (1.0 - alp) * (0.55 + 0.45 * nearW) * (1.0 - smoothstep(200.0, 700.0, dstV));
    float mudW = clamp(max(trailW * 1.0, shore * 0.65 + forest * 0.22 * smoothstep(0.35, 0.6, n2)), 0.0, 0.88);
    base = mix(grass, uMud * (0.75 + 0.5 * n1), mudW);
    float outc = smoothstep(0.66, 0.72, fb(wp * 0.011 + 57.0)) * (1.0 - forest) * (1.0 - alp);
    base = mix(base, vec3(0.42, 0.37, 0.30) * (0.7 + 0.6 * mix(0.5, vn(wp * 7.0), nearW)) * (0.8 + 0.4 * n1), outc * 0.7 * uOutcK);        // gravelly outcrop patches
    // layered sedimentary rock on slopes, cliffs, pinnacle bases and high ground
    float yw = y + 5.5 * (fb(wpr * 0.012 + 3.0) - 0.5) + 1.8 * (vn(wpr * 0.06) - 0.5) + 0.8 * (n1r - 0.5);                // warped height: bands undulate and break
    float bc = yw * 0.2 + 1.2 * sin(yw * 0.043 + 1.7) + 0.4 * sin(yw * 0.101 + 4.1);                                       // band coordinate with 3 to 9 m thickness
    float bandId = floor(bc); float bf = fract(bc); bedF = bf;
    float split = step(0.62, vn(vec2(wpr.x * 0.045, bc * 0.8 + 11.0)));                                                       // some beds change character sideways
    float bt = texture2D(uNoise, (vec2(bandId + split * 17.0, 7.0) + 0.5) / 256.0).b, bt2 = texture2D(uNoise, (vec2(bandId + 31.0, 3.0) + 0.5) / 256.0).g;
    vec3 tanR = vec3(0.40, 0.335, 0.265), greyR = vec3(0.30, 0.29, 0.275), brownR = vec3(0.335, 0.265, 0.21), rustR = vec3(0.37, 0.25, 0.18), paleR = vec3(0.50, 0.46, 0.40), darkR = vec3(0.17, 0.155, 0.145);
    vec3 strata = bt < 0.3 ? greyR : bt < 0.52 ? brownR : bt < 0.68 ? tanR : bt < 0.8 ? darkR : bt < 0.92 ? paleR : rustR;
    float along = vn(vec2(wpr.x * 0.05, bc * 2.3)) * 0.65 + vn(vec2(wpr.x * 0.19, y * 0.12)) * 0.35;                              // patchy tone along each bed
    strata *= (0.74 + 0.48 * bt2) * (0.78 + 0.22 * smoothstep(0.0, 0.25, bf) * smoothstep(1.0, 0.8, bf)) * (0.72 + 0.5 * along + 0.14 * (n1r - 0.5));
    strata *= 1.0 - 0.3 * smoothstep(0.62, 0.9, vn(vec2(wpr.x * 0.55, y * 0.03))) * smoothstep(0.35, 0.7, slope);      // faint water stains running down the face
    strata = mix(strata, strata * uRockLight * 2.4, 0.25) * 0.82;
    strata = mix(vec3(0.27, 0.235, 0.19) * (0.85 + 0.3 * n1), strata, 1.0 - smoothstep(250.0, 2200.0, dstV)) * uStrataTint;   // fine bedding fades to an average tone at range (no aliasing)
    float mossW = (1.0 - alp) * smoothstep(0.62, 0.2, slope) * (0.25 + 0.75 * moist) * smoothstep(0.3, 0.7, n1r + 0.3 * (fineR - 0.5));
    vec3 rockC = mix(strata, uMoss * (0.8 + 0.4 * n1r), clamp(mossW, 0.0, 0.85));
    // grass and moss gather on the ledge treads and lips of the bedded cliffs
    float ledgeG = smoothstep(0.8, 0.96, bf) * smoothstep(0.42, 0.7, n1r + 0.2 * (moist - 0.4)) * (1.0 - alp) * (1.0 - smoothstep(0.85, 1.0, slope));      // moss on ledge treads only
    rockC = mix(rockC, mix(uMoss, uGrassA * vec3(1.15, 1.35, 0.8), 0.45) * (0.75 + 0.5 * n1r), clamp(ledgeG * 0.8, 0.0, 0.7));
    // overgrown lip: moss and trailing growth hang down the top of the scarp in streaks
    float topK = smoothstep(150.0, 174.0, y) * smoothstep(0.42, 0.7, vn(vec2(wpr.x * 0.45, y * 0.12)) + 0.3 * (n1r - 0.5)) * (1.0 - smoothstep(190.0, 260.0, y));
    rockC = mix(rockC, mix(uMoss, uGrassA * vec3(1.1, 1.4, 0.8), 0.55) * (0.65 + 0.55 * n1r), clamp(topK, 0.0, 0.7));                         // moss on flatter rock and bed ledges
    float lowK = 1.0 - smoothstep(450.0, 1500.0, y);                                                   // green lower flanks: only steeper ground goes to rock low down
    float rockW = smoothstep(0.42, 0.58, clamp(max(rockA, smoothstep(0.30 + 0.34 * lowK, 0.58 + 0.34 * lowK, slope)), 0.0, 1.0) + 0.22 * (fineR - 0.5) * nearW + 0.2 * (n1r - 0.5));
    float scree = smoothstep(0.17, 0.3, slope) * (1.0 - smoothstep(0.46, 0.6, slope)) * (0.25 + 0.75 * alp) * (1.0 - forest);
    vec3 screeC = mix(greyR, tanR, 0.5 + 0.4 * (n1r - 0.5)) * (0.65 + 0.7 * mix(0.5, vn(wp * 3.3), nearW)) * 1.15;
    base = mix(base, screeC, scree * 0.85 * (1.0 - rockW));
    rockC = mix(rockC, uMoss * 0.85, 0.3 * (1.0 - smoothstep(300.0, 850.0, y)) * smoothstep(0.0, 0.5, n1r) * (1.0 - smoothstep(0.4, 0.65, slope)));      // scrubby growth on the lower rock
    base = mix(base, rockC, rockW);
    // canopy cover: beyond the near field (where real trees stand) forested ground reads as mottled crowns instead of bare soil
    {
      float cK = forest * (1.0 - smoothstep(0.38, 0.65, slope)) * (1.0 - alp) * smoothstep(35.0, 220.0, dstV);
      // cellular crowns (about 10 m): bright domed tops, dark gaps between; averaged out with range
      vec2 cp = wp / 10.0, ci = floor(cp), cf = fract(cp); float cb = 9.0; vec4 cR = vec4(0.5);
      for (int jy = -1; jy <= 1; jy++) for (int jx = -1; jx <= 1; jx++) {
        vec4 r = texture2D(uNoise, (ci + vec2(float(jx), float(jy)) + 0.5) / 256.0);
        float dd = length(cf - (vec2(float(jx), float(jy)) + 0.2 + 0.6 * r.gb)) / (0.5 + 0.38 * r.a);
        if (dd < cb) { cb = dd; cR = r; }
      }
      float crown = 1.0 - smoothstep(0.35, 1.0, cb);
      float cfade = 1.0 - smoothstep(1500.0, 4500.0, dstV);
      float cv = mix(0.55, crown * (0.75 + 0.5 * cR.r), cfade);
      vec3 canopyC = mix(vec3(0.03, 0.11, 0.035), mix(vec3(0.10, 0.27, 0.07), vec3(0.24, 0.45, 0.11), cR.r), clamp(cv * 1.15, 0.0, 1.0));
      base = mix(base, canopyC, clamp(cK * 0.93, 0.0, 0.95));
    }
    base = mix(base, uSand * (0.9 + 0.2 * n1), clamp(shore, 0.0, 1.0) * (1.0 - rockW) * 0.8);
    float sn = smoothstep(uSnowY - 90.0 + 220.0 * (n2 - 0.5), uSnowY + 70.0 + 220.0 * (n2 - 0.5), y) * (1.0 - smoothstep(0.55, 0.85, slope));
    sn = max(sn, 0.35 * smoothstep(uSnowY - 120.0, uSnowY + 200.0, y) * smoothstep(0.35, 0.7, fineR + 0.3 * n1r) * rockW);
    base = mix(base, vec3(0.9, 0.93, 0.97) * (0.9 + 0.1 * n1), clamp(sn, 0.0, 1.0));
    rockWn = max(rockW, scree * 0.5) * (1.0 - sn); wetK = shore * 0.7 * (1.0 - rockW);
  }
  diffuseColor.rgb = base;
  // ---- Nyth (uNyth > 0): cool grade over the lush palette + bioluminescent ground (root veins, moss patches, shoreline, glow that follows the player)
  vec3 nyEm = vec3(0.0);
  if (uNyth > 0.5) {
    float lumB = min(dot(base, vec3(0.3, 0.59, 0.11)), 0.19);      // palette luminance (capped: canopy / strata / snow stay dark), re-hued by the grade
    diffuseColor.rgb = lumB * uNyTint * 1.8;
    float hue = smoothstep(0.55, 0.75, 0.5 + 0.25 * sin(wp.x * 0.0041 + wp.y * 0.0049 + 1.3) + 0.25 * sin(wp.x * 0.0093 - wp.y * 0.0079 + 2.1) + 0.55 * (n4 - 0.5));
    vec3 gc = mix(uNyGlowA, uNyGlowB, hue);
    float land = (1.0 - rockWn) * (1.0 - smoothstep(0.55, 0.9, slope));
    float vein = 1.0 - smoothstep(0.0, 0.018, abs(fb(wp * 0.05 + 17.0) - 0.5));
    float web = 1.0 - smoothstep(0.0, 0.03, abs(fb(wp * 0.21 + 3.0) - 0.5));
    float patchG = smoothstep(0.55, 0.78, fb(wp * 0.011 + 5.0));
    float fadeFar = 1.0 - smoothstep(600.0, 3500.0, dstV);
    float g = (vein * 0.9 + web * 0.5 * nearW + patchG * 0.8 + 0.12 * vAux.w) * (0.35 + 0.65 * vAux.x) * land * (0.6 + 0.4 * fadeFar);
    nyEm = gc * g * uNyGround;
    nyEm += uNyGlowA * smoothstep(0.93, 1.0, vAux.y) * 0.16 * (0.7 + 0.3 * vn(wp * 0.4 + uNyPl.w * 0.15));      // glowing waterline only
    float pd = distance(vWP.xz, uNyPl.xz);
    float pk = 1.0 - smoothstep(2.0, 30.0, pd);
    float ring = 0.5 + 0.5 * sin(pd * 0.55 - uNyPl.w * 3.2);
    nyEm += gc * land * pk * (0.10 + 0.55 * (vein + 0.5 * patchG + 0.5 * web)) * (0.6 + 0.8 * ring) * 0.9;
  }
`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += nyEm;`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.97, 0.38, vAux.y * vAux.y * 0.9 * (1.0 - uLush));
  if (uLush > 0.5) roughnessFactor = mix(0.93, 0.5, wetK) * mix(1.0, 0.85, rockWn * 0.3);
  if (uLush > 1.5) roughnessFactor = mix(0.93, 0.5, glassK);`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += lavaEmit;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    // fine grain + craterlets as relief (normal only, no albedo spots)
    vec2 e = vec2(0.3, 0.0);
    float c0 = vn(wp * 2.7) + 0.5 * vn(wp * 8.3);
    float gx = (vn((wp + e.xy) * 2.7) + 0.5 * vn((wp + e.xy) * 8.3) - c0) / 0.3;
    float gz = (vn((wp + e.yx) * 2.7) + 0.5 * vn((wp + e.yx) * 8.3) - c0) / 0.3;
    vec2 g = vec2(gx, gz) * 0.035 * nearW;
    if (uLush < 0.5) {
    g += craterGrad(wp, 2.6, 0.30) * 0.05 * (1.0 - smoothstep(20.0, 120.0, dstV));
    g += craterGrad(wp + 17.0, 8.0, 0.22) * 0.05 * (1.0 - smoothstep(60.0, 350.0, dstV));
    }
    g += (vec2(vn(wp * 0.7 + e.xy), vn(wp * 0.7 + e.yx)) - vn(wp * 0.7)) / 0.3 * 0.05 * midW;
    g *= 1.0 - 0.6 * rockSlope;
    if (uLush < 0.5) normal = normalize(normal + mat3(viewMatrix) * vec3(-g.x, 0.0, -g.y));
  }
  if (uLush > 0.5 && dstV < 160.0) {      // triplanar detail relief: soft on meadow, strong bedded relief on rock
    vec3 P = vWP; float e = 0.2;
    vec3 nw = normalize(vWN); vec3 w = pow(abs(nw), vec3(4.0)); w /= (w.x + w.y + w.z);
    vec3 gw = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      float f = k == 0 ? 1.3 : 4.1; float wk = k == 0 ? 1.0 : 0.45;
      float hxz = vn2(P.xz * f), hxy = vn2(P.xy * f + 5.0), hzy = vn2(P.zy * f + 9.0);
      gw += wk * (vec3(vn2((P.xz + vec2(e, 0.0)) * f) - hxz, 0.0, vn2((P.xz + vec2(0.0, e)) * f) - hxz) * w.y
                + vec3(vn2((P.xy + vec2(e, 0.0)) * f + 5.0) - hxy, vn2((P.xy + vec2(0.0, e)) * f + 5.0) - hxy, 0.0) * w.z
                + vec3(0.0, vn2((P.zy + vec2(0.0, e)) * f + 9.0) - hzy, vn2((P.zy + vec2(e, 0.0)) * f + 9.0) - hzy) * w.x) / e;
    }
    gw.y += rockWn * (smoothstep(0.0, 0.2, bedF) - smoothstep(0.8, 1.0, bedF)) * 2.5;       // bedding ledges catch the light
    float amp = mix(0.012, 0.075, rockWn) * (1.0 - smoothstep(20.0, 150.0, dstV));
    vec3 gt = gw - nw * dot(gw, nw);
    normal = normalize(normal - mat3(viewMatrix) * gt * amp);
  }`);
}
function hookDepth(shader) { applyCurvature(shader); }

export function makeTerrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.0 });
  setupMat(m, 'terrain', hookTerrain);
  return m;
}

let sharedIndex = null;
function getIndex() {
  if (sharedIndex) return sharedIndex;
  const G = N + 1, nGrid = G * G;
  const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * G + i, b = (j + 1) * G + i, c = j * G + i + 1, d = (j + 1) * G + i + 1;
    idx.push(a, b, c, c, b, d);
  }
  const edge = (e, t) => (e === 0 ? t : e === 1 ? N * G + t : e === 2 ? t * G : t * G + N);
  for (let e = 0; e < 4; e++) for (let t = 0; t < N; t++) {
    const a = edge(e, t), b = edge(e, t + 1), as = nGrid + e * G + t, bs = nGrid + e * G + t + 1;
    idx.push(a, as, b, b, as, bs, a, b, as, b, bs, as);   // both windings
  }
  sharedIndex = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  return sharedIndex;
}

export class Terrain {
  constructor(recipeId, recipeModule) {
    this.recipeId = recipeId; this.rc = recipeModule;
    this.group = new THREE.Group();
    this.chunks = new Map();
    this.origin = { x: 0, z: 0 };
    this.mat = makeTerrainMaterial();
    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMat.onBeforeCompile = hookDepth; this.depthMat.customProgramCacheKey = () => 'terrain-depth';
    this.queue = []; this.frame = 0; this.desired = []; this.lastSel = { x: 1e9, z: 1e9, y: 1e9 };
    this.workers = [];
    const nw = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < nw; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = 0; w.onmessage = (e) => this._onChunk(w, e.data); w.onerror = (e) => console.error('terrain worker', e.message);
      this.workers.push(w);
    }
    this.jobs = new Map(); this.nextId = 1;
    this.pending = 0; this.builtCount = 0;
    this.inbox = []; this.msgCap = 0;      // AETHEL: msgCap > 0 limits finished chunks turned into meshes per frame
  }
  setOrigin(x, z) {
    this.origin.x = x; this.origin.z = z;
    for (const c of this.chunks.values()) this._dispose(c);
    this.chunks.clear(); this.queue.length = 0; this.jobs.clear(); this.lastSel.x = 1e9;
  }
  /** terrain height / normal in scene-local coordinates */
  h(x, z) { return this.rc.heightAt(x + this.origin.x, z + this.origin.z); }
  normal(x, z, out) { return this.rc.normalAt(x + this.origin.x, z + this.origin.z, 1.0, out); }
  setSunFacing() { }

  update(cam, force = false) {
    this.frame++;
    if (this.inbox.length) for (let n = 0; this.inbox.length && (n < this.msgCap || !this.msgCap); n++) this._chunkBuilt(this.inbox.shift());
    const L = this.lastSel;
    const moved = Math.hypot(cam.x - L.x, cam.z - L.z) + Math.abs(cam.y - L.y) * 0.5;
    // reselect when the camera has moved, when a chunk finished (visibility refresh), or periodically; never more often than every 3rd frame
    const since = this.frame - (this.selFrame || 0);
    if (force || ((moved > 12 && since >= 4) || (this.dirtySel && since >= 8)) || this.frame % 20 === 0) { this._select(cam); L.x = cam.x; L.z = cam.z; L.y = cam.y; this.selFrame = this.frame; this.dirtySel = false; }
    this._dispatch(cam);
  }

  _select(cam) {
    const cx = cam.x + this.origin.x, cz = cam.z + this.origin.z, cy = cam.y;
    const maxD = this.maxD || 160000;      // AETHEL: the interior caps the range at its cavity radius
    const desired = [];
    const rs = sizeOf(ROOT);
    const stack = [];
    for (let j = Math.floor((cz - maxD) / rs); j <= Math.floor((cz + maxD) / rs); j++)
      for (let i = Math.floor((cx - maxD) / rs); i <= Math.floor((cx + maxD) / rs); i++) stack.push([ROOT, i, j]);
    const dyc = Math.max(0, Math.abs(cy) - 450);
    while (stack.length) {
      const [l, i, j] = stack.pop();
      const s = sizeOf(l), x0 = i * s, z0 = j * s;
      const dx = Math.max(x0 - cx, 0, cx - (x0 + s)), dz = Math.max(z0 - cz, 0, cz - (z0 + s));
      const d = Math.hypot(dx, dz, dyc);
      if (d > maxD) continue;
      if (l > 0 && d < s * (this.split || SPLIT)) { for (let b = 0; b < 4; b++) stack.push([l - 1, i * 2 + (b & 1), j * 2 + (b >> 1)]); }
      else desired.push({ l, i, j, d });
    }
    this.desired = desired;
    // neighbour LOD ratios per edge (n, s, w, e) so coarse neighbours can be stitched without cracks
    const leafSet = new Set(desired.map((d) => keyOf(d.l, d.i, d.j)));
    const nbLevel = (l0, px, pz) => { for (let l = l0; l <= ROOT; l++) { const sz = sizeOf(l); if (leafSet.has(keyOf(l, Math.floor(px / sz), Math.floor(pz / sz)))) return l; } return l0; };
    for (const dn of desired) {
      const s = sizeOf(dn.l), cx0 = (dn.i + 0.5) * s, cz0 = (dn.j + 0.5) * s, e = s * 0.5 + 0.5;
      const r = [[0, -e], [0, e], [-e, 0], [e, 0]].map(([ox, oz]) => Math.min(8, 1 << (nbLevel(dn.l, cx0 + ox, cz0 + oz) - dn.l)));
      dn.edges = r.join(',');
    }
    // request missing
    let pend = 0;
    for (const dn of desired) {
      const k = keyOf(dn.l, dn.i, dn.j);
      let c = this.chunks.get(k);
      if (!c) {
        c = { key: k, l: dn.l, i: dn.i, j: dn.j, size: sizeOf(dn.l), mesh: null, ready: false, d: dn.d, last: this.frame, edges: null };
        this.chunks.set(k, c); this.queue.push(c);
      }
      c.d = dn.d; c.last = this.frame; c.wantEdges = dn.edges;
      if (c.ready && !c.rebuilding && c.edges !== c.wantEdges) { c.rebuilding = true; c.sent = false; this.queue.push(c); }
      if (!c.ready) pend++;
    }
    this.pending = pend;
    // visibility
    const vis = new Set();
    for (const dn of desired) {
      const k = keyOf(dn.l, dn.i, dn.j), c = this.chunks.get(k);
      if (c.ready) vis.add(k); else this._cover(dn.l, dn.i, dn.j, vis);
    }
    for (const c of this.chunks.values()) {
      if (!c.mesh) continue;
      const v = vis.has(c.key);
      c.mesh.visible = v;
      if (v) c.last = this.frame;
      c.mesh.castShadow = v && c.l <= (this.shadowLevel ?? 4);
    }
    if (this.chunks.size > 380) this._evict();
  }
  _cover(l, i, j, vis) {
    let ll = l, ii = i, jj = j;
    while (ll < ROOT) {
      ll++; ii = Math.floor(ii / 2); jj = Math.floor(jj / 2);
      const c = this.chunks.get(keyOf(ll, ii, jj));
      if (c && c.ready) { vis.add(c.key); return; }
    }
    for (const c of this.chunks.values()) {
      if (!c.ready || c.l >= l) continue;
      const f = Math.pow(2, l - c.l);
      if (Math.floor(c.i / f) === i && Math.floor(c.j / f) === j) vis.add(c.key);
    }
  }
  _evict() {
    const arr = [...this.chunks.values()].filter((c) => c.ready && !c.mesh?.visible && this.frame - c.last > 60).sort((a, b) => a.last - b.last);
    for (let n = 0; n < arr.length && this.chunks.size > 300; n++) { this._dispose(arr[n]); this.chunks.delete(arr[n].key); }
  }
  _dispose(c) { if (this.onChunkDispose) this.onChunkDispose(c); if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; } c.dead = true; }

  _dispatch(cam) {
    if (!this.queue.length) return;
    const cx = cam.x + this.origin.x, cz = cam.z + this.origin.z;
    this.queue = this.queue.filter((c) => !c.dead && (!c.ready || c.rebuilding) && !c.sent);
    this.queue.sort((a, b) => a.d - b.d);
    for (const w of this.workers) {
      while (w.busy < 2 && this.queue.length) {
        const c = this.queue.shift();
        const id = this.nextId++;
        c.sentEdges = c.wantEdges; this.jobs.set(id, c); c.sent = true; w.busy++;
        w.postMessage({ t: 'chunk', id, recipe: this.recipeId, cx: (c.i + 0.5) * c.size, cz: (c.j + 0.5) * c.size, size: c.size, N, edges: (c.sentEdges || '1,1,1,1').split(',').map(Number) });
      }
    }
  }
  _onChunk(w, m) {
    w.busy--;
    if (this.msgCap) { this.inbox.push(m); return; }
    this._chunkBuilt(m);
  }
  _chunkBuilt(m) {
    const c = this.jobs.get(m.id); this.jobs.delete(m.id);
    if (!c || c.dead) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('aux', new THREE.BufferAttribute(m.aux, 4));
    g.setIndex(getIndex());
    const half = c.size / 2, ym = (m.ymin + m.ymax) / 2, yr = (m.ymax - m.ymin) / 2 + 2 + 0.25 * (c.size / N);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, ym, 0), Math.sqrt(2 * half * half + yr * yr));
    if (c.ready && c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = g; c.edges = c.sentEdges; c.rebuilding = false; c.sent = false; if (this.onChunkReady) this.onChunkReady(c, m); return; }
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.position.set((c.i + 0.5) * c.size - this.origin.x, 0, (c.j + 0.5) * c.size - this.origin.z);
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.customDepthMaterial = this.depthMat;
    mesh.frustumCulled = c.l <= 3;
    mesh.visible = false;
    this.group.add(mesh);
    c.mesh = mesh; c.ready = true; c.edges = c.sentEdges; this.builtCount++;
    if (this.onChunkReady) this.onChunkReady(c, m);
    this.dirtySel = true; // reselect soon so visibility refreshes
    this.pending = Math.max(0, this.pending - 1);
  }
  /** all desired chunks built? */
  settled() { return this.pending === 0 && this.queue.length === 0 && this.jobs.size === 0; }
}
