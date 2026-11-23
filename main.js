// Entry: renderer, scene, game loop, start/end overlays.
import * as THREE from 'three';
import * as P from './path.js';
import { buildWorld, FOG_COLOR } from './world.js';
import { createPlayer, isTouch } from './player.js';
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
const startS = parseFloat(params.get('s'));   // ?s=<metres along the path>: start there (tests, skipping ahead)
if (Number.isFinite(startS)) { player.place(Math.min(P.LENGTH, Math.max(0, startS))); player.zone = P.zoneAt(player.s); }
const post = createPost(renderer, scene, camera, isTouch ? 2 : 4);   // fewer MSAA samples on phones

// Shared handles for later modules.
export const game = { THREE, scene, camera, renderer, world, player, audio, post, path: P, state: 'title' };
director = game.director = createDirector(game);

const applySize = () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
};
window.addEventListener('resize', applySize);
window.addEventListener('orientationchange', () => { applySize(); setTimeout(applySize, 250); });   // iOS reports stale sizes at first

// ---- overlays ---------------------------------------------------------------------------
const startEl = document.getElementById('start'), endEl = document.getElementById('end'), fadeEl = document.getElementById('fade');
const msgEl = document.getElementById('startmsg');

// Touch: "tap to begin" / "tap to resume" (the tap also unlocks WebAudio, goes fullscreen and locks landscape where allowed).
const showTouchPause = (text) => { player.setTouchActive(false); msgEl.textContent = text; startEl.classList.remove('hidden'); };
if (isTouch) {
  msgEl.textContent = 'tap to begin';
  document.getElementById('hint').textContent = 'left thumb to walk · right thumb to look';
  document.addEventListener('gesturestart', (e) => e.preventDefault());   // iOS pinch zoom
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // a tap on the playfield re-wakes audio the OS interrupted (phone call etc.)
  renderer.domElement.addEventListener('touchend', () => { if (audio.ctx && audio.ctx.state !== 'running') Promise.resolve(audio.ctx.resume()).catch(() => {}); });
}
const beginTouch = () => {
  const lockLandscape = () => { try { Promise.resolve(screen.orientation?.lock?.('landscape')).catch(() => {}); } catch { /* unsupported */ } };
  try {
    const el = document.documentElement, rf = el.requestFullscreen || el.webkitRequestFullscreen;
    if (rf && !document.fullscreenElement && !document.webkitFullscreenElement) Promise.resolve(rf.call(el, { navigationUI: 'hide' })).then(lockLandscape, lockLandscape);
    else lockLandscape();
  } catch { lockLandscape(); }
  player.setTouchActive(true);
  if (game.state === 'title') game.state = 'walking';
  startEl.classList.add('hidden');
};
// Tab switch / lock screen: silence the audio; on touch also pause (no look/walk) until a tap resumes.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Promise.resolve(audio.ctx?.suspend()).catch(() => {});
    if (isTouch && game.state === 'walking') showTouchPause('tap to resume');
  } else {
    clock.getDelta();   // drop the time spent hidden
    if (!isTouch) Promise.resolve(audio.ctx?.resume()).catch(() => {});
  }
});

startEl.addEventListener('click', () => {
  audio.start();
  if (isTouch) { beginTouch(); return; }
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

// Touch only: if the average frame time over ~2 s is slower than ~40 fps, step the pixel ratio down (to 0.75); never back up.
const ADAPT_WINDOW = 2, ADAPT_MIN_FPS = 40, ADAPT_STEP = 0.25, ADAPT_FLOOR = 0.75;
let adaptT = 0, adaptN = 0, adaptWarm = true;   // the first window (shader compiles) is discarded
function adaptiveScale(raw) {
  if (game.state !== 'walking' || document.hidden || raw > 0.5) { adaptT = adaptN = 0; return; }
  adaptT += raw; adaptN++;
  if (adaptT < ADAPT_WINDOW) return;
  const pr = renderer.getPixelRatio();
  if (!adaptWarm && adaptN / adaptT < ADAPT_MIN_FPS && pr > ADAPT_FLOOR) {
    const next = Math.max(ADAPT_FLOOR, pr - ADAPT_STEP);
    renderer.setPixelRatio(next); post.setPixelRatio(next); applySize();
  }
  adaptWarm = false; adaptT = adaptN = 0;
}

function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta(), dt = Math.min(raw, 0.05), t = clock.elapsedTime;
  if (isTouch) adaptiveScale(raw);
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
      player.setTouchActive(false);
      endEl.classList.add('shown');
    }
  }
  fadeEl.style.opacity = fade;
  post.render(t);
}
frame();
