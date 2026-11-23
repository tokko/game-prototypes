// Renderer, lighting, sky, fog. Look-and-grade lives here.
import * as THREE from 'three';
import { createPost } from './post.js';

// Horizon haze colour (linear). The sky dome's horizon and the scene fog share it so terrain fades seamlessly into sky.
const HORIZON_LIN = new THREE.Color().setRGB(0.86, 0.57, 0.28, THREE.LinearSRGBColorSpace);
export const HORIZON = HORIZON_LIN.getHex();

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  renderer.domElement.id = 'view';

  // soft vignette over the canvas, under the HUD
  const vig = document.createElement('div');
  vig.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 58%,rgba(40,24,8,0.30) 100%)';
  renderer.domElement.after(vig);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON_LIN.clone(), 380, 1700);

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1, 4500);

  // cool sky fill against a warm low sun
  const hemi = new THREE.HemisphereLight(0xb9cdea, 0x8c7746, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc88a, 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.35;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.82, 0.40, 0.28).normalize();   // late afternoon, ~22 deg, from the left

  // sky dome: gold at the horizon -> pale blue-grey above, soft sun glow + disc, a few warm clouds
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir.clone() }, uHor: { value: HORIZON_LIN.clone() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uSun; uniform vec3 uHor;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 mid = vec3(0.50,0.58,0.68), top = vec3(0.26,0.38,0.58);
        vec3 c = mix(uHor, mid, smoothstep(0.0,0.30,pow(h,0.7))); c = mix(c, top, smoothstep(0.22,0.95,h));
        float s = max(dot(d, normalize(uSun)), 0.0);
        // warm haze brightening toward the sun, fading out at the horizon line itself so it still matches the fog
        c += vec3(1.0,0.62,0.28) * pow(s,4.0) * 0.38 * smoothstep(0.0,0.12,h);
        vec2 q = d.xz / (d.y + 0.2) * 1.4;
        float cl = vn(q) * 0.55 + vn(q * 2.3) * 0.3 + vn(q * 5.1) * 0.15;
        cl = smoothstep(0.5, 0.8, cl) * smoothstep(0.03, 0.22, h);
        vec3 cc = mix(vec3(1.0,0.80,0.58), vec3(0.62,0.58,0.62), 1.0 - s);
        c = mix(c, cc, cl * 0.7);
        // sun glow + disc (HDR so bloom picks it up)
        c += vec3(1.0,0.80,0.50) * pow(s,60.0) * 0.9 + vec3(1.0,0.9,0.7) * pow(s,400.0) * 2.0;
        c += vec3(1.0,0.92,0.75) * smoothstep(0.99955, 0.99985, s) * 6.0;
        gl_FragColor = vec4(c,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 24, 12), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  const post = createPost(renderer, scene, camera, (lv) => { vig.style.display = lv === 0 ? '' : 'none'; });
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    post.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  // keep sun + shadow frustum on the camera focus
  const SM = 4096;
  function updateSun(fx, fy, fz, dist) {
    const half = Math.min(320, Math.max(70, dist * 0.7));
    const sc = sun.shadow.camera;
    if (Math.abs(sc.right - half) > 1) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 900;
      sc.updateProjectionMatrix();
    }
    const texel = (half * 2) / SM;
    const sx = Math.round(fx / texel) * texel, sz = Math.round(fz / texel) * texel;
    sun.target.position.set(sx, fy, sz);
    sun.position.set(sx + sunDir.x * 450, fy + sunDir.y * 450, sz + sunDir.z * 450);
  }

  const render = () => post.render();
  const setQuality = (lv) => { post.auto = false; post.setQuality(lv); };   // manual choice stops the auto-drop
  window.__post = post;   // for quick headless checks (post.auto = false to hold a level)
  return { renderer, scene, camera, sun, hemi, sky, updateSun, sunDir, composer: post.composer, render, setQuality };
}
