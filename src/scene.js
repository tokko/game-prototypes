// Renderer, lighting, sky, fog. Look-and-grade lives here.
import * as THREE from 'three';

export const HORIZON = 0xe9cf9f;

export function createScene() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  renderer.domElement.id = 'view';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 350, 1900);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 4500);

  const hemi = new THREE.HemisphereLight(0xffe4b8, 0x6a5a3a, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd7a0, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(-0.55, 0.5, 0.45).normalize();

  // sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir.clone() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 uSun;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 hor = vec3(0.91,0.78,0.55), mid = vec3(0.62,0.70,0.80), top = vec3(0.30,0.47,0.74);
        vec3 c = mix(hor, mid, smoothstep(0.0,0.25,h)); c = mix(c, top, smoothstep(0.2,0.9,h));
        float s = max(dot(normalize(vDir), normalize(uSun)), 0.0);
        c += vec3(1.0,0.75,0.4)*pow(s,6.0)*0.35 + vec3(1.0,0.9,0.7)*pow(s,64.0)*0.6;
        gl_FragColor = vec4(c,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 24, 12), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // keep sun + shadow frustum on the camera focus
  function updateSun(fx, fy, fz, dist) {
    const half = Math.min(260, Math.max(70, dist * 0.55));
    const sc = sun.shadow.camera;
    if (Math.abs(sc.right - half) > 1) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 700;
      sc.updateProjectionMatrix();
    }
    const texel = (half * 2) / 2048;
    const sx = Math.round(fx / texel) * texel, sz = Math.round(fz / texel) * texel;
    sun.target.position.set(sx, fy, sz);
    sun.position.set(sx + sunDir.x * 350, fy + sunDir.y * 350, sz + sunDir.z * 350);
  }

  return { renderer, scene, camera, sun, hemi, sky, updateSun, sunDir };
}
