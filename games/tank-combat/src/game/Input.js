// Keyboard / mouse / pointer-lock input. Edge events (pressed) are cleared by endFrame().
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDown = [false, false, false];
    this.mousePressed = [false, false, false];
    this.dx = 0; this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.locked) e.preventDefault(); return; }
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.down.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown[0] = this.mouseDown[1] = this.mouseDown[2] = false;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseDown[e.button] = true; this.mousePressed[e.button] = true;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { this.mouseDown[e.button] = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown[0] = this.mouseDown[1] = this.mouseDown[2] = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { /* browser refused (cooldown after Esc); user clicks again */ });
  }

  requestLock() {
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }

  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mousePressed[0] = this.mousePressed[1] = this.mousePressed[2] = false;
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
