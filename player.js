// First-person controller: mouse look, slow walk, brisk walk, clamped to the path corridor.
import * as THREE from 'three';
import * as P from './path.js';

export const WALK_SPEED = 1.3;   // m/s
export const BRISK_SPEED = 2.0;  // m/s (Shift), must stay <= 2.2
const EYE = 1.65;
const STRIDE = 0.72;             // metres per footstep

export function createPlayer(camera, dom, startZone, onStep) {
  const pl = {
    s: 0, idx: -1, zone: 'village', progress: 0,   // path progress: s in metres, progress 0..1
    x: 0, z: 0, yaw: 0, pitch: 0, speed: 0, brisk: false,
    locked: false, frozen: false,
  };
  const keys = new Set();
  let vx = 0, vz = 0, phase = 0;

  pl.place = (s) => {
    const p = P.pointAt(s);
    pl.x = p.x; pl.z = p.z; pl.s = s; pl.idx = -1;
    pl.yaw = Math.atan2(-p.tx, -p.tz);
    pl.pitch = 0; vx = vz = 0;
  };
  pl.place(P.zoneStart(startZone) + (startZone === 'village' ? 3 : 16));

  document.addEventListener('keydown', (e) => keys.add(e.code));
  document.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('mousemove', (e) => {
    if (!pl.locked || pl.frozen) return;
    pl.yaw -= e.movementX * 0.0021;
    pl.pitch = Math.max(-1.3, Math.min(1.3, pl.pitch - e.movementY * 0.0021));
  });
  document.addEventListener('pointerlockchange', () => { pl.locked = document.pointerLockElement === dom; });

  pl.update = (dt) => {
    const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
    let fwd = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
    let str = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
    if (!pl.locked || pl.frozen) fwd = str = 0;
    pl.brisk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const sp = pl.brisk ? BRISK_SPEED : WALK_SPEED;
    const l = Math.hypot(fwd, str) || 1;
    const sy = Math.sin(pl.yaw), cy = Math.cos(pl.yaw);
    const tx = ((-sy * fwd + cy * str) / l) * sp, tz = ((-cy * fwd - sy * str) / l) * sp;
    const a = 1 - Math.exp(-8 * dt);
    vx += (tx - vx) * a; vz += (tz - vz) * a;

    const c = P.clampToPath(pl.x + vx * dt, pl.z + vz * dt, pl.idx);
    pl.speed = Math.hypot(c.x - pl.x, c.z - pl.z) / Math.max(dt, 1e-4);
    pl.x = c.x; pl.z = c.z; pl.s = c.s; pl.idx = c.idx;
    pl.zone = P.zoneAt(pl.s);
    pl.progress = pl.s / P.LENGTH;

    const prev = Math.floor(phase);
    phase += (pl.speed * dt) / STRIDE;
    if (Math.floor(phase) !== prev && pl.speed > 0.25) onStep?.(P.surfaceAt(pl.s), pl.brisk);

    const amp = Math.min(1, pl.speed / BRISK_SPEED);
    camera.position.set(pl.x, EYE + Math.sin(phase * Math.PI) * 0.012 * amp, pl.z);
    camera.rotation.set(pl.pitch, pl.yaw, Math.sin(phase * Math.PI * 0.5) * 0.0025 * amp, 'YXZ');
  };

  return pl;
}
