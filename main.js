// Entry: renderer, scene, game loop, start/end overlays.
import * as THREE from 'three';
import * as P from './path.js';
import { buildWorld, FOG_COLOR } from './world.js';
import { createPlayer } from './player.js';
import { createPost } from './post.js';
import { audio } from './audio.js';
import { createDirector } from './director.js';

const params = new URLSearchParams(location.search);
const startZone = P.ZONES.includes(params.get('zone')) ? params.get('zone') : 'village';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.04);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 260);

const world = buildWorld(scene);
let director = null;
const player = createPlayer(camera, renderer.domElement, startZone, (surface, brisk) => { audio.footstep(surface, brisk); director?.onPlayerStep(); });
const post = createPost(renderer, scene, camera);

// Shared handles for later modules.
export const game = { THREE, scene, camera, renderer, world, player, audio, post, path: P, state: 'title' };
director = game.director = createDirector(game);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

// ---- overlays ---------------------------------------------------------------------------
const startEl = document.getElementById('start'), endEl = document.getElementById('end'), fadeEl = document.getElementById('fade');
const msgEl = document.getElementById('startmsg');
startEl.addEventListener('click', () => {
  audio.start();
  const showResume = () => { msgEl.textContent = 'click to resume'; startEl.classList.remove('hidden'); };
  try { Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(showResume); } catch { showResume(); }
  if (game.state === 'title') game.state = 'walking';
});
document.addEventListener('pointerlockchange', () => {   // overlay hides only once the lock is held
  if (player.locked) startEl.classList.add('hidden');
  else if (game.state === 'walking') { msgEl.textContent = 'click to resume'; startEl.classList.remove('hidden'); }
});
document.getElementById('restart').addEventListener('click', () => { location.href = location.pathname; });

// ---- loop -------------------------------------------------------------------------------
const clock = new THREE.Clock();
let fade = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  if (game.state === 'walking') player.update(dt); else player.update(0.0001);
  director.update(dt);
  scene.fog.density = P.fogDensity(player.s) + director.fogSwell;
  world.update(camera.position, player.s, scene.fog.density, t);
  audio.update(dt, player.s, camera);

  // ending: past the corridor exit door the screen fades to black, then the end screen
  if (game.state === 'walking') {
    fade = THREE.MathUtils.clamp((player.s - P.END_S - 1) / (P.LENGTH - P.END_S - 3), 0, 1);
    if (fade >= 1) {
      game.state = 'ended'; player.frozen = true;
      document.exitPointerLock?.();
      endEl.classList.add('shown');
    }
  }
  fadeEl.style.opacity = fade;
  post.render(t);
}
frame();
