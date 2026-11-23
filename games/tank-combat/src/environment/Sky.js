// Sky dome (gradient matched to the shared fog, sun, cumulus, two ridge layers), sun/hemisphere lights,
// image based lighting and the camera-following shadow frustum. All colours are linear.
import {
  Mesh, SphereGeometry, ShaderMaterial, BackSide, Vector3, DirectionalLight, HemisphereLight,
  FogExp2, Scene, PMREMGenerator, CanvasTexture, NoColorSpace, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter,
} from 'three';
import { makeTileNoise, mulberry32 } from '../util/noise.js';
import { atmo, ATMO_FOG_COLOR_GLSL } from './Atmosphere.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uSunDir; uniform float uTime; uniform float uClouds; uniform float uSunDisk; uniform sampler2D uNoise;
${ATMO_FOG_COLOR_GLSL}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float vn1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float fb1(float x) { return vn1(x) * 0.5 + vn1(x * 2.03 + 1.7) * 0.3 + vn1(x * 4.1 + 3.1) * 0.2; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 fogC = atmoFogColor(d, uSunDir);
  vec3 mid = srgb(vec3(0.612, 0.698, 0.847));
  vec3 zen = srgb(vec3(0.416, 0.549, 0.769));
  float t1 = pow(clamp(h / 0.18, 0.0, 1.0), 0.6);
  float t2 = smoothstep(0.18, 0.6, h);
  vec3 col = mix(mix(fogC, mid, t1), zen, t2);
  col = mix(col, srgb(vec3(0.557, 0.588, 0.561)), smoothstep(0.0, -0.2, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += srgb(vec3(1.0, 0.824, 0.604)) * (0.35 * pow(sd, 64.0) + 0.12 * pow(sd, 8.0));
  col += srgb(vec3(1.0, 0.949, 0.847)) * 18.0 * smoothstep(0.9994, 0.9997, sd) * uSunDisk;
  if (h > 0.008 && uClouds > 0.5) {
    vec2 p = d.xz / h * 1500.0 + uTime * vec2(3.0, 0.8);
    float R1 = texture2D(uNoise, p / 6000.0).r, R2 = texture2D(uNoise, p / 2100.0).r, G1 = texture2D(uNoise, p / 5600.0).g;
    float n = R1 * 0.62 + R2 * 0.3 + G1 * 0.16;
    float cov = smoothstep(0.56, 0.84, n);
    vec2 p2 = p + uSunDir.xz * 120.0;
    float n2 = texture2D(uNoise, p2 / 6000.0).r * 0.62 + texture2D(uNoise, p2 / 2100.0).r * 0.3 + texture2D(uNoise, p2 / 5600.0).g * 0.16;
    float shade = clamp(1.0 - (n2 - n) * 3.0, 0.0, 1.0);
    vec3 cc = mix(srgb(vec3(0.561, 0.596, 0.678)), srgb(vec3(1.0, 0.953, 0.878)), shade);
    cc += srgb(vec3(1.0, 0.894, 0.749)) * 0.6 * pow(sd, 8.0) * (1.0 - cov);
    float fade = smoothstep(0.01, 0.12, h);
    float cir = smoothstep(0.55, 0.75, texture2D(uNoise, p / 9000.0 + 0.37).r) * 0.15;
    col = mix(col, srgb(vec3(0.788, 0.827, 0.902)), cir * fade);
    col = mix(col, cc, cov * 0.92 * fade);
  }
  float a = atan(d.x, -d.z);
  float hN1 = 0.018 + 0.014 * fb1(a * 2.0) + 0.003 * fb1(a * 7.0);
  float hN2 = 0.010 + 0.010 * fb1(a * 3.0 + 7.3);
  vec3 c1 = mix(fogC, srgb(vec3(0.498, 0.584, 0.722)), 0.45) * mix(0.92, 1.0, smoothstep(0.0, hN1, h));
  vec3 c2 = mix(fogC, srgb(vec3(0.427, 0.510, 0.639)), 0.6) * mix(0.92, 1.0, smoothstep(0.0, hN2, h));
  float hillOk = step(-0.05, h);
  col = mix(col, c1, smoothstep(hN1 + 0.002, hN1 - 0.002, h) * hillOk);
  col = mix(col, c2, smoothstep(hN2 + 0.002, hN2 - 0.002, h) * hillOk);
  gl_FragColor = vec4(col, 1.0);
}`;

function makeCloudNoise() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const octs = [];
  for (let o = 0; o < 6; o++) octs.push(makeTileNoise(900 + o * 13, 4 << o));
  // Worley: 8 cells per tile
  const rnd = mulberry32(31337);
  const C = 8, pts = [];
  for (let i = 0; i < C * C; i++) pts.push([rnd(), rnd()]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < 6; o++) { r += amp * octs[o]((x / S) * (4 << o), (y / S) * (4 << o)); norm += amp; amp *= 0.5; }
      r /= norm;
      const fx = (x / S) * C, fy = (y / S) * C, cx = Math.floor(fx), cy = Math.floor(fy);
      let best = 9;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const gx = (cx + i + C) % C, gy = (cy + j + C) % C, p = pts[gy * C + gx];
          const dx = cx + i + p[0] - fx, dy = cy + j + p[1] - fy;
          best = Math.min(best, Math.hypot(dx, dy));
        }
      }
      const g = 1 - Math.min(1, best);
      const k = (y * S + x) * 4;
      img.data[k] = Math.min(255, r * 255 * 1.1); img.data[k + 1] = g * 255; img.data[k + 2] = 0; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter;
  return t;
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.sunDir = atmo.uSunDir.value;
    // only enables Three's fog defines; every material uses the shared atmosphere function instead
    scene.fog = new FogExp2(0xb4c2d8, 0.00042);
    scene.background = null;

    const noise = makeCloudNoise();
    this.uniforms = {
      uSunDir: atmo.uSunDir, uTime: { value: 0 }, uClouds: { value: 1 }, uSunDisk: { value: 1 }, uNoise: { value: noise },
    };
    this.material = new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    });
    this.dome = new Mesh(new SphereGeometry(1, 40, 20), this.material);
    this.dome.scale.setScalar(4500);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // image based lighting baked once from the sky itself (clouds off, sun disk at 20%)
    const envScene = new Scene();
    const envMat = this.material.clone();
    envMat.uniforms.uClouds = { value: 0 };
    envMat.uniforms.uSunDisk = { value: 0.2 };
    const envDome = new Mesh(new SphereGeometry(1, 40, 20), envMat);
    envDome.scale.setScalar(50);
    envScene.add(envDome);
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0, 0.1, 200).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();

    this.sun = new DirectionalLight(0xffd8a8, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.shadowHalf = 90;
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowHalf; sc.right = this.shadowHalf; sc.top = this.shadowHalf; sc.bottom = -this.shadowHalf;
    sc.near = 1; sc.far = 900;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new HemisphereLight(0xa9bede, 0x7a6a4c, 0.5);
    scene.add(this.hemi);

    this._right = new Vector3();
    this._up = new Vector3();
    this._c = new Vector3();
    this._f = new Vector3();
  }

  // shadow frustum follows the camera (35 m ahead along the flattened forward), snapped to shadow texels
  update(focus, camera, time) {
    this.uniforms.uTime.value = time;
    this.dome.position.copy(camera.position);
    camera.getWorldDirection(this._f);
    this._f.y = 0;
    if (this._f.lengthSq() < 1e-4) this._f.set(0, 0, -1);
    this._f.normalize();
    const c = this._c.copy(camera.position).addScaledVector(this._f, 35);
    c.y = focus.y;
    const texel = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x;
    const s = this.sunDir;
    this._right.set(0, 1, 0).cross(s).normalize();
    this._up.copy(s).cross(this._right).normalize();
    const rx = c.dot(this._right), ry = c.dot(this._up);
    const sx = rx - Math.round(rx / texel) * texel, sy = ry - Math.round(ry / texel) * texel;
    c.addScaledVector(this._right, -sx).addScaledVector(this._up, -sy);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(s, 400);
    this.sun.target.updateMatrixWorld();
  }
}
