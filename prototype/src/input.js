// Keyboard + mouse. Continuous inputs (rotation, throttle ramp) are applied in update();
// discrete key presses are forwarded to `on(action)` so main.js owns what they mean.
import { Vector3 } from 'three';
import { SAS_MODES } from './vessels.js';

const PREVENT = new Set(['Tab', 'F1', 'F5', 'F9', 'Backspace', 'Space', 'BracketLeft', 'BracketRight', 'Comma', 'Period', 'ArrowUp', 'ArrowDown']);

export class Input {
  constructor(canvas, cams, on) {
    this.keys = new Set();
    this.on = on;
    this.cams = cams; // { flight:{yaw,pitch,dist}, map:{yaw,pitch,dist}, isMap:()=>bool }
    this.rot = new Vector3();
    this.drag = null;
    addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.press(e);
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', (e) => { this.drag = null; canvas.releasePointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const c = this.cam;
      c.yaw -= (e.clientX - this.drag.x) * 0.0055;
      c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + (e.clientY - this.drag.y) * 0.0055));
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = this.cam;
      c.dist = Math.max(c.min, Math.min(c.max, c.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
  }
  get cam() { return this.cams.isMap() ? this.cams.map : this.cams.flight; }
  down(code) { return this.keys.has(code); }

  press(e) {
    const k = e.code;
    const a = (n, arg) => this.on(n, arg);
    if (k === 'KeyT') a('sas-toggle');
    else if (k.startsWith('Digit') && +k.slice(5) >= 1 && +k.slice(5) <= 9) a('sas-mode', SAS_MODES[+k.slice(5) - 1]);
    else if (k === 'BracketLeft') a('vessel', -1);
    else if (k === 'BracketRight') a('vessel', 1);
    else if (k === 'Comma') a('warp', -1);
    else if (k === 'Period') a('warp', 1);
    else if (k === 'KeyM') a('map');
    else if (k === 'Tab') a('map-focus');
    else if (k === 'F5') a('quicksave');
    else if (k === 'F9') a('quickload');
    else if (k === 'F1') a('help');
    else if (k === 'KeyP') a('pause');
    else if (k === 'KeyZ') a('throttle', 1);
    else if (k === 'KeyX') a('throttle', 0);
    else if (k === 'KeyU') a('undock');
    else if (k === 'KeyC') a('circ');
    else if (k === 'KeyH') a('xfer');
    else if (k === 'KeyL') a('land');
    else if (k === 'KeyB') a('asc');
    else if (k === 'KeyV') a('rdv');
    else if (k === 'KeyG') a('drill');
    else if (k === 'KeyR') a('refine');
    else if (k === 'KeyF') a('drive');
    else if (k === 'KeyY') a('refuel');
    else if (k === 'KeyI') a('offload');
    else if (k === 'KeyJ') a('panels');
    else if (k === 'KeyK') a('radiators');
    else if (k === 'KeyN') a('gear');
    else if (k === 'KeyO') a('autoret');
    else if (k === 'Backspace') a('cancel');
  }

  /** applies held keys. returns throttle delta for this frame (or 0) */
  update(dt) {
    const r = this.rot.set(0, 0, 0);
    if (this.down('KeyW')) r.x -= 1;
    if (this.down('KeyS')) r.x += 1;
    if (this.down('KeyA')) r.z += 1;
    if (this.down('KeyD')) r.z -= 1;
    if (this.down('KeyQ')) r.y -= 1;
    if (this.down('KeyE')) r.y += 1;
    this.drive = { fwd: (this.down('KeyW') ? 1 : 0) - (this.down('KeyS') ? 1 : 0), steer: (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0), brake: this.down('Space') };
    let thr = 0;
    if (this.down('ShiftLeft') || this.down('ShiftRight') || this.down('ArrowUp')) thr += 0.7 * dt;
    if (this.down('ControlLeft') || this.down('ControlRight') || this.down('ArrowDown')) thr -= 0.7 * dt;
    return thr;
  }
}
