// Post-processing: RenderPass -> GTAO (half-res) -> bloom -> grade/tilt-shift/vignette -> OutputPass (ACES + sRGB).
// Quality: 3 = all, 2 = no AO, 1 = no AO/bloom, 0 = plain renderer.render. Auto-drops one level when frames stay > 20 ms for 2 s.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv;
      // tilt-shift: soft blur toward top (hazy distance) and bottom screen edges
      float ey = uv.y - 0.5;
      float amt = smoothstep(0.26, 0.5, abs(ey)) * (ey > 0.0 ? 1.0 : 0.7);
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (amt > 0.01) {
        float r = amt * 0.0042;
        vec3 acc = c; float wsum = 1.0;
        for (int i = 1; i <= 10; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          float rr = r * sqrt(fi / 10.0);
          vec2 o = vec2(cos(a) / uAspect, sin(a)) * rr;
          float w = 1.0 - 0.5 * fi / 10.0;
          acc += texture2D(tDiffuse, uv + o).rgb * w; wsum += w;
        }
        c = acc / wsum;
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // lift shadows slightly warm
      c += vec3(0.020, 0.011, 0.003) * (1.0 - smoothstep(0.0, 0.30, l));
      // gentle S-curve about mid grey (ACES adds the toe/shoulder)
      vec3 x = max(c, vec3(1e-4)) / 0.18;
      c = 0.18 * pow(x, vec3(1.07));
      // warm highlights, saturation 1.1
      l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), smoothstep(0.25, 1.2, l));
      c = mix(vec3(l), c, 1.1);
      // warm vignette
      vec2 p = (uv - vec2(0.5, 0.49)) * vec2(1.0, 1.0);
      p.x *= min(uAspect, 1.6) / 1.6 + 0.4;
      float v = smoothstep(0.30, 0.80, length(p));
      c *= mix(vec3(1.0), vec3(0.62, 0.54, 0.44), v * 0.55);
      c += (hash(gl_FragCoord.xy) - 0.5) * 0.002;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

// AO normal/depth pre-pass re-renders the scene with an override material, so keep it to opaque geometry.
class SceneGTAOPass extends GTAOPass {
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse((o) => {
      if (o.isSprite || (o.material && (o.material.transparent || o.material.isShaderMaterial))) o.visible = false;
    });
  }
}

export function createPost(renderer, scene, camera, onLevel) {
  const pr = renderer.getPixelRatio();
  const w = window.innerWidth, h = window.innerHeight;
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);

  // the AO pre-pass renders the scene a second time; shadows are only (re)drawn once per frame, by the RenderPass
  renderer.shadowMap.autoUpdate = false;

  composer.addPass(new RenderPass(scene, camera));

  const ao = new SceneGTAOPass(scene, camera, Math.max(1, (w * pr) >> 1), Math.max(1, (h * pr) >> 1));
  const aoSetSize = ao.setSize.bind(ao);
  ao.setSize = (pw, ph) => aoSetSize(Math.max(1, pw >> 1), Math.max(1, ph >> 1));   // half-res AO
  ao.updateGtaoMaterial({ radius: 3.2, distanceExponent: 1.6, thickness: 2.5, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });
  ao.blendIntensity = 0.7;
  composer.addPass(ao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.55, 1.05);   // high threshold: only flashes / sun glints
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  const post = {
    composer, level: 3, auto: true,
    setQuality(level) {
      level = Math.max(0, Math.min(3, Math.round(level)));
      post.level = level;
      ao.enabled = level >= 3;
      bloom.enabled = level >= 2;
      if (onLevel) onLevel(level);
      slow = 0; ema = 0; settle = 1000;
    },
    resize(rw, rh) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(rw, rh);
      grade.uniforms.uAspect.value = rw / rh;
    },
    render() {
      const now = performance.now(), dt = now - lastT; lastT = now;
      renderer.shadowMap.needsUpdate = true;
      if (post.level === 0) renderer.render(scene, camera); else composer.render();
      if (post.auto && post.level > 1 && dt < 250) {
        if (settle > 0) { settle -= dt; return; }
        ema = ema ? ema * 0.9 + dt * 0.1 : dt;
        if (ema > 20) { slow += dt; if (slow > 2000) post.setQuality(post.level - 1); } else slow = 0;
      }
    },
  };
  let lastT = performance.now(), ema = 0, slow = 0, settle = 1500;
  grade.uniforms.uAspect.value = w / h;
  post.setQuality(3);
  return post;
}
