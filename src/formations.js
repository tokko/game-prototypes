// Formation slot layouts in regiment-local space: x = along the line (side), z = forward.
// layout() returns flat [x0,z0,x1,z1,...] arrays per role plus bounding half extents.

export function defaultFiles(def, n) {
  if (def.formation === 'tercio') return Math.round(Math.sqrt(n * def.pikeFrac) * 1.05);
  if (def.formation === 'battery') return 1;
  return Math.ceil(n / def.ranks);
}
export function fileRange(def, n) {
  if (def.formation === 'tercio') return [4, Math.max(4, Math.round(n * def.pikeFrac))];
  if (def.formation === 'battery') return [1, 1];
  return [Math.min(6, n), Math.max(1, n)];
}

function grid(out, n, files, sx, sz) {
  const f = Math.max(1, Math.min(files, n));
  const ranks = Math.ceil(n / f);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / f), c = Math.min(f, n - r * f), fi = i - r * f;
    out.push((fi - (c - 1) / 2) * sx, ((ranks - 1) / 2 - r) * sz);
  }
  return { w: f * sx, d: ranks * sz };
}

const CREW = [[-1.8, -0.5], [1.8, -0.5], [-1.5, -2.8], [1.5, -2.8], [0, -4.5], [-2.5, -4.5], [2.5, -4.5]];

export function layout(def, counts, files, sm) {
  const out = { all: [], pike: [], musk: [], guns: [], halfW: 1, halfD: 1 };
  if (def.formation === 'grid') {
    const g = grid(out.all, counts.all, files, def.sx * sm, def.sz * (0.6 + 0.4 * sm));
    out.halfW = g.w / 2 + 1; out.halfD = g.d / 2 + 1;
  } else if (def.formation === 'tercio') {
    const sx = def.sx * sm, sz = def.sz * sm;
    const cols = Math.max(3, Math.min(files, Math.max(3, counts.pike)));
    const g = grid(out.pike, counts.pike, cols, sx, sz);
    const nm = counts.musk, msx = def.msx * sm, msz = def.msz * sm, mc = 5;
    const per = [0, 0, 0, 0];
    for (let i = 0; i < nm; i++) per[i % 4]++;
    const rows = Math.max(1, Math.ceil(Math.max(...per) / mc));
    const sw = mc * msx, sd = rows * msz;
    const idxIn = [0, 0, 0, 0];
    for (let i = 0; i < nm; i++) {
      const s = i % 4, k = idxIn[s]++;
      const r = Math.floor(k / mc), c = Math.min(mc, per[s] - r * mc), ci = k - r * mc;
      const left = s % 2 === 0 ? -1 : 1, front = s < 2 ? 1 : -1;
      const cx = left * (g.w / 2 + sw / 2 + 0.8), cz = front * (g.d / 2 - sd / 2);
      out.musk.push(cx + (ci - (c - 1) / 2) * msx, cz + front * ((rows - 1) / 2 - r) * msz);
    }
    out.halfW = g.w / 2 + sw + 1.8; out.halfD = g.d / 2 + 1.5;
  } else { // battery
    const G = counts.guns, sp = 10 * sm;
    for (let g = 0; g < G; g++) out.guns.push((g - (G - 1) / 2) * sp, 0);
    for (let i = 0; i < counts.all; i++) {
      const g = i % Math.max(1, G), k = Math.floor(i / Math.max(1, G));
      const o = CREW[k % CREW.length];
      out.all.push((g - (G - 1) / 2) * sp + o[0], o[1] - Math.floor(k / CREW.length) * 2);
    }
    out.halfW = (Math.max(1, G) - 1) * sp / 2 + 5; out.halfD = 7;
  }
  return out;
}
