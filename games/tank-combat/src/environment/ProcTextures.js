// Canvas-generated textures for foliage cards, grass strips and buildings/props (seeded, no external assets).
import { CanvasTexture, SRGBColorSpace, NoColorSpace, ClampToEdgeWrapping, RepeatWrapping, LinearMipmapLinearFilter, LinearFilter } from 'three';
import { mulberry32 } from '../util/noise.js';
import { makeCanvas, toTexture, fbmField, fieldCanvas } from './Textures.js';

const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const jit = (rgb, rnd, a) => {
  const k = 1 + (rnd() - 0.5) * 2 * a;
  return `rgb(${Math.max(0, Math.min(255, rgb[0] * k)) | 0},${Math.max(0, Math.min(255, rgb[1] * k)) | 0},${Math.max(0, Math.min(255, rgb[2] * k)) | 0})`;
};

function wrapDraw(S, bx0, by0, bx1, by1, fn) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ox = dx * S, oy = dy * S;
      if (bx1 + ox < 0 || bx0 + ox > S || by1 + oy < 0 || by0 + oy > S) continue;
      fn(ox, oy);
    }
  }
}

// ---------- foliage atlas ----------
// UV rects [u0, u1, v0, v1] of each quadrant (v up)
export const ATLAS_UV = {
  bark: [0.0, 0.5, 0.5, 1.0],
  leaf: [0.5, 1.0, 0.5, 1.0],
  conifer: [0.0, 0.5, 0.0, 0.5],
  grass: [0.5, 1.0, 0.0, 0.5], // 4 vertical strips: grass, wheat, flowers, dry grass
};

export function makeFoliageAtlas() {
  const S = 1024, H = S / 2, rnd = mulberry32(2025);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  // --- bark (canvas top-left) ---
  {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, H, H); ctx.clip();
    ctx.fillStyle = '#4a4136'; ctx.fillRect(0, 0, H, H);
    for (let i = 0; i < 700; i++) {
      const x = rnd() * H, w = 1 + rnd() * 5, v = rnd();
      ctx.fillStyle = v < 0.35 ? 'rgba(46,40,34,0.55)' : v < 0.8 ? 'rgba(95,85,70,0.35)' : 'rgba(125,123,88,0.18)';
      const y0 = rnd() * H, len = 30 + rnd() * 220;
      ctx.fillRect(x, y0, w, len);
      if (y0 + len > H) ctx.fillRect(x, y0 - H, w, len);
    }
    ctx.restore();
  }

  // --- broadleaf cluster card (top-right) ---
  {
    const pal = ['#4a5a2a', '#56662f', '#3d4d24', '#606a32'].map(hexRGB);
    const cx = H + H / 2, cy = H / 2;
    for (let pass = 0; pass < 2; pass++) {
      const n = pass === 0 ? 60 : 130;
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283, r = Math.sqrt(rnd()) * (H * 0.4) * (pass === 0 ? 0.8 : 1);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        const len = 14 + rnd() * 14, wid = len * (0.5 + rnd() * 0.15), rot = rnd() * 6.283;
        const base = pal[(rnd() * pal.length) | 0];
        const dark = pass === 0 ? 0.62 : 1;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        const g = ctx.createLinearGradient(0, -wid, 0, wid);
        g.addColorStop(0, jit(base.map((v) => v * 1.28 * dark), rnd, 0.08));
        g.addColorStop(1, jit(base.map((v) => v * 0.82 * dark), rnd, 0.08));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, 0, len, wid, 0, 0, 6.283); ctx.fill();
        ctx.restore();
      }
    }
  }

  // --- conifer needle card (bottom-left): drooping spray hanging from the top centre ---
  {
    const pal = ['#4a5c38', '#506240', '#3d4e2f', '#566444'].map(hexRGB);
    ctx.lineCap = 'round';
    const cx = H / 2, top = H + 18;
    const twig = (x0, y0, x1, y1, w) => { ctx.strokeStyle = '#2a2a1c'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    twig(cx, top, cx, S - 20, 3);
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 150; i++) {
        const t = i / 150, y = top + t * (H - 42);
        const len = (18 + 85 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.12))) * (0.7 + rnd() * 0.5);
        const ang = (35 + rnd() * 20) * (Math.PI / 180);
        const ex = cx + side * Math.sin(ang) * len, ey = y + Math.cos(ang) * len * 0.8;
        ctx.strokeStyle = jit(pal[(rnd() * pal.length) | 0], rnd, 0.12);
        ctx.lineWidth = 1.5 + rnd() * 1.2;
        ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(ex, ey); ctx.stroke();
        // needles along the side branch
        for (let k = 0; k < 4; k++) {
          const u = 0.3 + k * 0.2, px = cx + (ex - cx) * u, py = y + (ey - y) * u;
          ctx.lineWidth = 1.2; ctx.strokeStyle = jit(pal[(rnd() * pal.length) | 0], rnd, 0.15);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + side * 6, py + 12); ctx.moveTo(px, py); ctx.lineTo(px - side * 3, py + 14); ctx.stroke();
        }
      }
    }
  }

  // --- grass / wheat / flowers / dry strips (bottom-right, 4 strips of 128 px) ---
  {
    const SW = H / 4;
    const blade = (x, base, h, lean, w, c0, c1) => {
      const g = ctx.createLinearGradient(0, base, 0, base - h);
      g.addColorStop(0, c0); g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - w, base);
      ctx.quadraticCurveTo(x + lean * 0.2 - w * 0.5, base - h * 0.55, x + lean, base - h);
      ctx.quadraticCurveTo(x + lean * 0.2 + w * 0.5, base - h * 0.55, x + w, base);
      ctx.closePath(); ctx.fill();
    };
    for (let strip = 0; strip < 4; strip++) {
      const x0 = H + strip * SW, base = S - 2;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, H, SW, H); ctx.clip();
      const mid = x0 + SW / 2;
      if (strip === 0) { // grass blades (neutral olive so the instance tint sets the hue)
        for (let i = 0; i < 34; i++) blade(mid + (rnd() - 0.5) * SW * 0.7, base, 190 + rnd() * 250, (rnd() - 0.5) * 70, 3 + rnd() * 3, '#6d7352', '#d8dcb0');
      } else if (strip === 1) { // wheat
        for (let i = 0; i < 16; i++) {
          const x = mid + (rnd() - 0.5) * SW * 0.7, h = 330 + rnd() * 140, lean = (rnd() - 0.5) * 36;
          ctx.strokeStyle = '#a89a5a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x + lean * 0.3, base - h * 0.5, x + lean, base - h); ctx.stroke();
          ctx.fillStyle = '#d8c27a';
          for (let e = 0; e < 7; e++) { ctx.beginPath(); ctx.ellipse(x + lean + (e % 2 ? 3 : -3), base - h + e * 9 + 6, 3.2, 8, (e % 2 ? 0.4 : -0.4), 0, 6.283); ctx.fill(); }
        }
        for (let i = 0; i < 10; i++) blade(mid + (rnd() - 0.5) * SW * 0.7, base, 150 + rnd() * 120, (rnd() - 0.5) * 40, 3, '#8a8348', '#c6b672');
      } else if (strip === 2) { // flowers (kept near-white/pink/yellow so tint does not recolour them)
        for (let i = 0; i < 12; i++) blade(mid + (rnd() - 0.5) * SW * 0.7, base, 130 + rnd() * 140, (rnd() - 0.5) * 40, 2.6, '#6d7352', '#b4b888');
        const cols = ['#f2efe6', '#c9a0c8', '#e6c84a', '#f2efe6', '#d9a6c8'];
        for (let i = 0; i < 9; i++) {
          const x = mid + (rnd() - 0.5) * SW * 0.62, h = 250 + rnd() * 180, lean = (rnd() - 0.5) * 36;
          ctx.strokeStyle = '#7a8458'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x + lean * 0.3, base - h * 0.5, x + lean, base - h); ctx.stroke();
          ctx.fillStyle = cols[(rnd() * cols.length) | 0];
          for (let p = 0; p < 6; p++) { const a = p * 1.047; ctx.beginPath(); ctx.arc(x + lean + Math.cos(a) * 7, base - h + Math.sin(a) * 7, 4.4, 0, 6.283); ctx.fill(); }
          ctx.fillStyle = '#d8b030'; ctx.beginPath(); ctx.arc(x + lean, base - h, 3.4, 0, 6.283); ctx.fill();
        }
      } else { // dry grass
        for (let i = 0; i < 30; i++) blade(mid + (rnd() - 0.5) * SW * 0.7, base, 160 + rnd() * 230, (rnd() - 0.5) * 80, 3 + rnd() * 2.5, '#8a7e56', '#e0d09a');
      }
      ctx.restore();
    }
  }

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  return t;
}

// ---------- building textures ----------
const STONE_PAL = ['#9a8e7a', '#857a68', '#a89c86', '#6f665a', '#b3a690'].map(hexRGB);

export function makeStoneWall() {
  const S = 512, rnd = mulberry32(11);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const b = makeCanvas(S), bx = b.getContext('2d');
  ctx.fillStyle = '#7d7566'; ctx.fillRect(0, 0, S, S);
  bx.fillStyle = '#242424'; bx.fillRect(0, 0, S, S);
  let y = 0;
  while (y < S - 6) {
    let rh = 26 + rnd() * 22;
    if (y + rh > S - 14) rh = S - y;
    let x = -rnd() * 40;
    while (x < S) {
      const w = 38 + rnd() * 90, ins = 3 + rnd() * 3;
      const x0 = x + ins, x1 = x + w - ins, y0 = y + ins, y1 = y + rh - ins;
      const pts = [];
      const nv = 7 + ((rnd() * 3) | 0);
      for (let i = 0; i < nv; i++) {
        const a = (i / nv) * 6.283, ex = Math.cos(a), ey = Math.sin(a);
        const px = (x0 + x1) / 2 + Math.sign(ex) * Math.pow(Math.abs(ex), 0.5) * (x1 - x0) / 2 * (0.9 + rnd() * 0.1);
        const py = (y0 + y1) / 2 + Math.sign(ey) * Math.pow(Math.abs(ey), 0.5) * (y1 - y0) / 2 * (0.88 + rnd() * 0.12);
        pts.push([px, py]);
      }
      const col = jit(STONE_PAL[(rnd() * STONE_PAL.length) | 0], rnd, 0.07);
      wrapDraw(S, x, y, x + w, y + rh, (ox, oy) => {
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + ox, p[1] + oy) : ctx.moveTo(p[0] + ox, p[1] + oy))); ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pts[0][0] + ox, y0 + ox * 0 + oy + 1); ctx.lineTo(pts[Math.floor(nv / 2)][0] + ox, y0 + oy + 1); ctx.stroke();
        ctx.strokeStyle = 'rgba(40,34,28,0.55)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x0 + ox, y1 + oy); ctx.lineTo(x1 + ox, y1 + oy); ctx.stroke();
        bx.beginPath(); pts.forEach((p, i) => (i ? bx.lineTo(p[0] + ox, p[1] + oy) : bx.moveTo(p[0] + ox, p[1] + oy))); bx.closePath();
        bx.fillStyle = `rgb(${190 + rnd() * 60 | 0},${190 + rnd() * 60 | 0},${190 + rnd() * 60 | 0})`; bx.fill();
      });
      // speckle
      for (let k = 0; k < 14; k++) {
        const sx = x0 + rnd() * (x1 - x0), sy = y0 + rnd() * (y1 - y0);
        ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.13)';
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
      x += w;
    }
    y += rh;
  }
  const map = toTexture(c, { srgb: true });
  const bump = toTexture(b, { srgb: false });
  return { map, bump };
}

export function makePlasterTall() {
  // 2 m wide x 8 m tall, clamped vertically; v = height / 8. Grayscale, tinted by vertex colour.
  const W = 512, H = 1024, rnd = mulberry32(21);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#e4e2dc'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() > 0.5 ? '255,255,255' : '90,84,70';
    g.addColorStop(0, `rgba(${v},0.07)`); g.addColorStop(1, `rgba(${v},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 40; i++) { // rain streaks from the top
    const x = rnd() * W, w = 1 + rnd() * 3, len = 80 + rnd() * 400, y0 = rnd() * 200;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, 'rgba(107,100,88,0.0)'); g.addColorStop(0.2, `rgba(107,100,88,${0.07 + rnd() * 0.06})`); g.addColorStop(1, 'rgba(107,100,88,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y0, w, len);
  }
  // damp / dirt band at the base (canvas bottom = ground)
  const band = ctx.createLinearGradient(0, H, 0, H - 90);
  band.addColorStop(0, 'rgba(70,62,46,0.62)'); band.addColorStop(1, 'rgba(70,62,46,0)');
  ctx.fillStyle = band; ctx.fillRect(0, H - 90, W, 90);
  for (let i = 0; i < 120; i++) {
    const x = rnd() * W, r = 2 + rnd() * 9;
    ctx.fillStyle = 'rgba(60,54,40,0.18)'; ctx.beginPath(); ctx.arc(x, H - rnd() * 100, r, 0, 6.283); ctx.fill();
  }
  // chipped patches revealing darker stone
  for (let i = 0; i < 0; i++) {
    const x = rnd() * W, y = 300 + rnd() * 650, rw = 20 + rnd() * 55, rh = 14 + rnd() * 40;
    ctx.fillStyle = 'rgba(120,112,100,0.4)'; ctx.beginPath(); ctx.ellipse(x, y, rw, rh, rnd() * 3, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(60,54,46,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  const t = toTexture(c, { srgb: true });
  t.wrapT = ClampToEdgeWrapping;
  return t;
}

function tiledRoof(rows, tileW, rowOffset, seed, opts = {}) {
  const S = 512, rnd = mulberry32(seed);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const b = makeCanvas(S), bx = b.getContext('2d');
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, 0, S, S);
  bx.fillStyle = '#202020'; bx.fillRect(0, 0, S, S);
  const rh = S / rows, cols = Math.round(S / tileW);
  const cw = S / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const x = k * cw + (r % 2 ? cw / 2 : 0), y = r * rh;
      const v = 0.78 + rnd() * 0.2;
      const rot = opts.rot ? (rnd() - 0.5) * 0.04 : 0;
      ctx.save(); ctx.translate(x + cw / 2, y + rh / 2); ctx.rotate(rot);
      const g = ctx.createLinearGradient(0, -rh / 2, 0, rh / 2);
      g.addColorStop(0, `rgb(${(v * 0.85 * 255) | 0},${(v * 0.85 * 255) | 0},${(v * 0.85 * 255) | 0})`);
      g.addColorStop(1, `rgb(${Math.min(255, v * 1.1 * 255) | 0},${Math.min(255, v * 1.1 * 255) | 0},${Math.min(255, v * 1.1 * 255) | 0})`);
      ctx.fillStyle = g; ctx.fillRect(-cw / 2 + 1, -rh / 2, cw - 2, rh - 1);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(-cw / 2 + 1, rh / 2 - 6, cw - 2, 6);
      ctx.restore();
      bx.fillStyle = `rgb(${150 + rnd() * 70 | 0},${150 + rnd() * 70 | 0},${150 + rnd() * 70 | 0})`;
      bx.fillRect(x + 1, y, cw - 2, rh - 1);
      bx.fillStyle = '#000'; bx.fillRect(x + 1, y + rh - 6, cw - 2, 6);
      if (rnd() < 0.06) { ctx.fillStyle = 'rgba(120,128,72,0.5)'; ctx.fillRect(x + rnd() * cw, y + rnd() * rh, 8 + rnd() * 10, 5); }
    }
  }
  return { map: toTexture(c, { srgb: true }), bump: toTexture(b, { srgb: false }) };
}

export const makeTileRoof = () => tiledRoof(7, 56, true, 31);
export const makeSlateRoof = () => tiledRoof(11, 70, true, 41, { rot: true });

export function makePlanks(vertical = true) {
  const S = 512, rnd = mulberry32(51);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const n = Math.round(S / 50);
  for (let p = 0; p < n; p++) {
    const w = S / n, x = p * w, v = 150 + rnd() * 70;
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, 0, w, S);
    for (let i = 0; i < 30; i++) {
      const gx = x + 2 + rnd() * (w - 4), g = 100 + rnd() * 130;
      ctx.strokeStyle = `rgba(${g},${g},${g},0.35)`; ctx.lineWidth = 0.7 + rnd() * 1.2;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.bezierCurveTo(gx + 3, S * 0.3, gx - 3, S * 0.7, gx + 1, S); ctx.stroke();
    }
    const knots = (rnd() * 3) | 0;
    for (let k = 0; k < knots; k++) {
      const kx = x + w / 2 + (rnd() - 0.5) * w * 0.4, ky = rnd() * S;
      for (let r = 0; r < 3; r++) { ctx.strokeStyle = `rgba(40,30,20,${0.5 - r * 0.12})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(kx, ky, 4 + r * 3, 7 + r * 5, 0, 0, 6.283); ctx.stroke(); }
    }
    ctx.fillStyle = '#1c1814'; ctx.fillRect(x, 0, 3, S);
  }
  if (!vertical) { const c2 = makeCanvas(S), x2 = c2.getContext('2d'); x2.translate(S, 0); x2.rotate(Math.PI / 2); x2.drawImage(c, 0, 0); return toTexture(c2, { srgb: true }); }
  return toTexture(c, { srgb: true });
}

export function makeAsphalt() {
  // covers the full 7 m road width in u; v repeats every 7 m
  const S = 512, rnd = mulberry32(61);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#48484a'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(93,92,90,0.6)' : 'rgba(53,53,55,0.7)';
    ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
  }
  // worn wheel paths
  for (const u of [0.28, 0.72]) {
    const g = ctx.createLinearGradient((u - 0.09) * S, 0, (u + 0.09) * S, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect((u - 0.09) * S, 0, 0.18 * S, S);
  }
  // patches and cracks
  for (let i = 0; i < 3; i++) {
    const x = rnd() * S * 0.7, y = rnd() * S, w = 80 + rnd() * 120, h = 40 + rnd() * 80;
    ctx.fillStyle = 'rgba(61,61,64,0.8)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(100,100,100,0.4)'; ctx.strokeRect(x, y, w, h);
  }
  ctx.strokeStyle = '#2a2a2c'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    let x = rnd() * S, y = rnd() * S; ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 40; k++) { x += (rnd() - 0.5) * 14; y += 4 + rnd() * 8; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // dusty edges
  for (const e of [0, 1]) {
    const g = ctx.createLinearGradient(e ? S : 0, 0, e ? S * 0.88 : S * 0.12, 0);
    g.addColorStop(0, 'rgba(107,101,92,0.5)'); g.addColorStop(1, 'rgba(107,101,92,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
  const t = toTexture(c, { srgb: true });
  t.wrapS = ClampToEdgeWrapping;
  return t;
}

export function makeCobble() {
  const S = 256, rnd = mulberry32(71);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#3f3a33'; ctx.fillRect(0, 0, S, S);
  const cell = 28;
  for (let y = 0; y < S; y += cell) {
    for (let x = 0; x < S; x += cell) {
      const jx = x + (rnd() - 0.5) * 4 + ((y / cell) % 2 ? cell / 2 : 0), jy = y + (rnd() - 0.5) * 4;
      const col = STONE_PAL[(rnd() * STONE_PAL.length) | 0].map((v) => v * 0.78);
      wrapDraw(S, jx, jy, jx + cell, jy + cell, (ox, oy) => {
        ctx.fillStyle = jit(col, rnd, 0.1);
        ctx.beginPath(); ctx.ellipse(jx + cell / 2 + ox, jy + cell / 2 + oy, cell / 2 - 2, cell / 2 - 3, 0, 0, 6.283); ctx.fill();
      });
    }
  }
  return toTexture(c, { srgb: true });
}

export function makeConcrete() {
  const S = 256, rnd = mulberry32(81);
  const f = fbmField(S, 91, 4, 3);
  const c = fieldCanvas(f, S, (v) => 0.62 + (v - 0.5) * 0.35);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(40,40,38,0.35)'; ctx.lineWidth = 1;
  for (let y = 0; y < S; y += 32) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(S, y + 0.5); ctx.stroke(); }
  for (let i = 0; i < 18; i++) {
    const x = rnd() * S, len = 40 + rnd() * 160;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(50,46,40,0.0)'); g.addColorStop(0.3, 'rgba(50,46,40,0.18)'); g.addColorStop(1, 'rgba(50,46,40,0)');
    ctx.save(); ctx.translate(x, rnd() * S * 0.5); ctx.fillStyle = g; ctx.fillRect(0, 0, 3, len); ctx.restore();
  }
  return toTexture(c, { srgb: true });
}

export function makeCamoNet() {
  const S = 512, rnd = mulberry32(91);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#3b3f2c'; ctx.lineWidth = 2;
  for (let i = 0; i <= S; i += 24) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
  const pal = ['#4d5236', '#5e5a3d', '#3b3f2c', '#6b6346'];
  for (let i = 0; i < 300; i++) {
    if (rnd() < 0.25) continue;
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 20, nv = 5 + ((rnd() * 4) | 0);
    ctx.fillStyle = pal[(rnd() * pal.length) | 0];
    ctx.beginPath();
    for (let k = 0; k < nv; k++) { const a = (k / nv) * 6.283, rr = r * (0.5 + rnd() * 0.6); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.7; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill();
  }
  return toTexture(c, { srgb: true });
}

export function makeBurnt() {
  const S = 512, rnd = mulberry32(101);
  const f = fbmField(S, 111, 8, 4);
  const c = fieldCanvas(f, S, (v) => 0.5 + (v - 0.5) * 1.2);
  const ctx = c.getContext('2d');
  // recolour: dark charred base with rust blotches and primer flakes
  const img = ctx.getImageData(0, 0, S, S);
  const rust = [138, 82, 50], char = [43, 39, 36];
  const f2 = fbmField(S, 121, 6, 3);
  for (let i = 0; i < f.length; i++) {
    const g = img.data[i * 4] / 255, r = f2[i] > 0.58 ? Math.min(1, (f2[i] - 0.58) * 6) : 0;
    const base = 0.55 + g * 0.6;
    img.data[i * 4] = (char[0] * (1 - r) + rust[0] * r) * base;
    img.data[i * 4 + 1] = (char[1] * (1 - r) + rust[1] * r) * base;
    img.data[i * 4 + 2] = (char[2] * (1 - r) + rust[2] * r) * base;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 220; i++) { ctx.fillStyle = 'rgba(125,119,104,0.25)'; ctx.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 7, 1 + rnd() * 3); }
  return toTexture(c, { srgb: true });
}

export function makeSandbagWeave() {
  const S = 128, c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#d6d6d6'; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(80,80,80,0.28)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < S; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
  return toTexture(c, { srgb: true });
}

export function makeSignTexture() {
  const c = makeCanvas(128, 96), ctx = c.getContext('2d');
  ctx.fillStyle = '#c9c4b6'; ctx.fillRect(0, 0, 128, 96);
  ctx.strokeStyle = '#8c1d18'; ctx.lineWidth = 6; ctx.strokeRect(5, 5, 118, 86);
  ctx.fillStyle = '#8c1d18'; ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', 64, 50);
  return toTexture(c, { srgb: true, repeat: false });
}

void RepeatWrapping; void NoColorSpace;
