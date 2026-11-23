// Shared 256^2 random texture used by sky/terrain shaders for cheap value noise (avoids huge integer-hash code that
// ANGLE/D3D compiles very slowly). R = noise, G = R shifted by (37,17) so 3D noise needs one fetch (iq's trick).
import * as THREE from 'three';
let tex = null;
export function noiseTexture() {
  if (tex) return tex;
  const N = 256, T = new Uint8Array(N * N);
  let s = 0x9e3779b9;
  for (let i = 0; i < T.length; i++) { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0; s ^= s >>> 12; T[i] = (s >>> 8) & 255; }
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = (y * N + x) * 4;
    d[k] = T[y * N + x]; d[k + 1] = T[((y + 17) & 255) * N + ((x + 37) & 255)];
    d[k + 2] = T[((y + 101) & 255) * N + ((x + 53) & 255)]; d[k + 3] = T[((y + 7) & 255) * N + ((x + 211) & 255)];
  }
  tex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}
export const NOISE_TEX_GLSL = `
uniform sampler2D uNoise;
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  vec2 uv = (i.xy + vec2(37.0, 17.0) * i.z + f.xy + 0.5) / 256.0; vec2 rg = texture2D(uNoise, uv).yx; return mix(rg.x, rg.y, f.z); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return texture2D(uNoise, (i + f + 0.5) / 256.0).b; }
`;
