export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapPi = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
// frame-rate independent smoothing factor
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
// move 'cur' toward 'target' by at most 'maxStep'
export const approach = (cur, target, maxStep) =>
  cur < target ? Math.min(cur + maxStep, target) : Math.max(cur - maxStep, target);
