// Post-processing: render -> one custom pass (grade + vignette + grain) -> output (tone map + sRGB).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    saturation: { value: 0.4 },   // 0 = monochrome
    vignette: { value: 0.75 },    // darkness at the corners
    grain: { value: 0.018 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 resolution;
    uniform float saturation; uniform float vignette; uniform float grain;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);                  // desaturate
      c *= vec3(0.80, 0.93, 1.12);                      // blue-black grade
      c += vec3(0.0015, 0.003, 0.006);                  // lifted blacks
      vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
      float v = smoothstep(0.95, 0.2, length(d));
      c *= mix(1.0 - vignette, 1.0, v);                 // vignette
      float g = hash(vUv * resolution + fract(time) * 97.0) - 0.5;
      c += g * grain * (0.4 + 0.6 * sqrt(max(l, 0.0)) * 2.0) ; // film grain
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  const setSize = (w, h) => {
    composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    grade.uniforms.resolution.value.set(w * pr, h * pr);
  };
  setSize(size.x, size.y);
  return {
    composer, uniforms: grade.uniforms, setSize,
    render(t) { grade.uniforms.time.value = t; composer.render(); },
  };
}
