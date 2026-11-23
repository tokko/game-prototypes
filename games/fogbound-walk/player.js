// First-person controller: mouse look, slow walk, brisk walk, clamped to the path corridor.
import * as THREE from 'three';
import * as P from './path.js';

export const WALK_SPEED = 1.3;   // m/s
export const BRISK_SPEED = 2.0;  // m/s (Shift), must stay <= 2.2
const EYE = 1.65;
const STRIDE = 0.72;             // metres per footstep

// ---- touch tuning (phones/tablets; ?touch=1 / ?touch=0 forces it on/off) ----------------------
const TOUCH_LOOK_SWEEP_DEG = 120;   // a swipe across the full screen width turns the view this far (yaw and pitch alike)
const STICK_RADIUS = 56;            // px, joystick travel
const STICK_DEAD = 0.12;            // fraction of the radius ignored
const STICK_FULL = 0.7;             // fraction of the radius that reaches full walk speed (never faster than WALK_SPEED)
const _touchQ = new URLSearchParams(location.search).get('touch');
export const isTouch = _touchQ === '1' ? true : _touchQ === '0' ? false
  : (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

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

  // Touch: left half = floating joystick (walk), right half = drag to look. Feeds the same yaw/pitch/locked state.
  let stickFwd = 0, stickStr = 0;
  pl.setTouchActive = () => {};
  if (isTouch) {
    const mk = (css) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;z-index:1;pointer-events:none;border-radius:50%;display:none;transform:translate(-50%,-50%);' + css;
      document.body.appendChild(d); return d;
    };
    const ring = mk(`width:${STICK_RADIUS * 2}px;height:${STICK_RADIUS * 2}px;border:1px solid rgba(185,196,208,0.2);box-sizing:border-box;`);
    const knob = mk('width:30px;height:30px;background:rgba(185,196,208,0.12);');
    const rest = () => ({ x: STICK_RADIUS + 36, y: window.innerHeight - STICK_RADIUS - 36 });
    const place = (x, y) => { ring.style.left = knob.style.left = x + 'px'; ring.style.top = knob.style.top = y + 'px'; };
    let jid = -1, ox = 0, oy = 0, lid = -1, lx = 0, ly = 0, active = false;
    const resetStick = () => { jid = -1; stickFwd = stickStr = 0; const r = rest(); place(r.x, r.y); };
    window.addEventListener('resize', () => { if (jid < 0) resetStick(); });
    pl.setTouchActive = (on) => {
      active = on; pl.locked = on; jid = lid = -1; resetStick();
      ring.style.display = knob.style.display = on ? 'block' : 'none';
    };
    const sens = () => (TOUCH_LOOK_SWEEP_DEG * Math.PI / 180) / window.innerWidth;   // rad per px
    const opts = { passive: false };
    dom.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!active) return;
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth / 2) { if (jid < 0) { jid = t.identifier; ox = t.clientX; oy = t.clientY; place(ox, oy); } }
        else if (lid < 0) { lid = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, opts);
    dom.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!active) return;
      for (const t of e.changedTouches) {
        if (t.identifier === jid) {
          let dx = t.clientX - ox, dy = t.clientY - oy;
          const len = Math.hypot(dx, dy), c = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
          dx *= c; dy *= c;
          knob.style.left = ox + dx + 'px'; knob.style.top = oy + dy + 'px';
          const m = Math.hypot(dx, dy) / STICK_RADIUS;
          const g = m < STICK_DEAD ? 0 : Math.min(1, (m - STICK_DEAD) / (STICK_FULL - STICK_DEAD));
          stickFwd = m ? (-dy / STICK_RADIUS / m) * g : 0; stickStr = m ? (dx / STICK_RADIUS / m) * g : 0;
        } else if (t.identifier === lid) {
          if (!pl.frozen) {
            const k = sens();
            pl.yaw -= (t.clientX - lx) * k;
            pl.pitch = Math.max(-1.3, Math.min(1.3, pl.pitch - (t.clientY - ly) * k));
          }
          lx = t.clientX; ly = t.clientY;
        }
      }
    }, opts);
    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === jid) resetStick();
        else if (t.identifier === lid) lid = -1;
      }
    };
    dom.addEventListener('touchend', end, opts);
    dom.addEventListener('touchcancel', end, opts);
  }

  pl.update = (dt) => {
    const k = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
    let fwd = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + stickFwd;
    let str = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + stickStr;
    if (!pl.locked || pl.frozen) fwd = str = 0;
    pl.brisk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const sp = pl.brisk ? BRISK_SPEED : WALK_SPEED;
    const l = Math.max(Math.hypot(fwd, str), 1);   // keys: unchanged (0 -> 1, 1, 1.41); analog stick below full deflection scales speed down, never up
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
