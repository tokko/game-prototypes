// Keyboard / mouse state with edge detection, pointer lock, wheel.
export const input = {
  keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, wheel: 0, locked: false, buttons: 0, drag: false, canvas: null,
  down(c) { return this.keys.has(c); },
  hit(c) { return this.pressed.has(c); },
  axis(neg, pos) { return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0); },
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; },
};
export function initInput(canvas, onLockChange) {
  input.canvas = canvas;
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Tab' || e.code.startsWith('F') && /^F\d+$/.test(e.code) || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
  });
  addEventListener('keyup', (e) => { input.keys.delete(e.code); });
  addEventListener('blur', () => input.keys.clear());
  canvas.addEventListener('mousedown', (e) => { input.buttons |= 1 << e.button; input.drag = true; if (e.button === 0 && document.pointerLockElement !== canvas && !input.noLock) canvas.requestPointerLock?.(); });
  addEventListener('mouseup', (e) => { input.buttons &= ~(1 << e.button); input.drag = false; });
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas || input.drag) { input.mouseDX += e.movementX || 0; input.mouseDY += e.movementY || 0; }
  });
  addEventListener('wheel', (e) => { input.wheel += Math.sign(e.deltaY); }, { passive: true });
  document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; onLockChange && onLockChange(input.locked); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
