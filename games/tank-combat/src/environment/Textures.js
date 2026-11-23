// Canvas-generated procedural textures for the environment (no external assets).
import {
  CanvasTexture, RepeatWrapping, SRGBColorSpace, NoColorSpace, LinearMipmapLinearFilter, LinearFilter,
} from 'three';
import { makeTileNoise, mulberry32 } from '../util/noise.js';

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(canvas, { srgb = false, repeat = true, anisotropy = 8 } = {}) {
  const t = new CanvasTexture(canvas);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; }
  t.anisotropy = anisotropy;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  return t;
}

export function fbmField(size, seed, basePeriod, octaves, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const P = basePeriod << o;
    const nf = makeTileNoise(seed + o * 17, P);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) out[y * size + x] += amp * nf((x / size) * P, (y / size) * P);
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// grayscale canvas from a 0..1 field (optionally remapped)
export function fieldCanvas(field, size, map) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(1, map ? map(field[i], i) : field[i])) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function wrapDraw(size, x, y, r, fn) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const ox = dx * size, oy = dy * size;
      if (x + ox < -r || x + ox > size + r || y + oy < -r || y + oy > size + r) continue;
      fn(x + ox, y + oy);
    }
  }
}

// ---- terrain detail (data textures; multiplied with colours in the terrain shader) ----
export function makeGrassDetail() {
  const S = 512, rnd = mulberry32(11);
  const f = fbmField(S, 3, 8, 5);
  const c = fieldCanvas(f, S, (v) => 0.5 + (v - 0.5) * 1.1);
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  for (let i = 0; i < 6000; i++) {
    const x = rnd() * S, y = rnd() * S, len = 4 + rnd() * 9, a = (rnd() - 0.5) * 0.9;
    const light = rnd() > 0.5;
    ctx.strokeStyle = light ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 0.8 + rnd() * 0.9;
    wrapDraw(S, x, y, len, (px, py) => {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.sin(a) * len, py - Math.cos(a) * len); ctx.stroke();
    });
  }
  return toTexture(c);
}

export function makeClumpDetail() {
  const S = 256;
  const f = fbmField(S, 29, 4, 5, 0.55);
  return toTexture(fieldCanvas(f, S, (v) => 0.5 + (v - 0.5) * 1.8));
}

export function makeDirtDetail() {
  const S = 512, rnd = mulberry32(77);
  const f = fbmField(S, 41, 8, 4);
  const c = fieldCanvas(f, S, (v) => 0.5 + (v - 0.5) * 1.2);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.8 + rnd() * 2.6;
    const v = 150 + rnd() * 80 | 0;
    wrapDraw(S, x, y, r + 2, (px, py) => {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.arc(px + 0.8, py + 0.8, r, 0, 6.3); ctx.fill();
      ctx.fillStyle = `rgba(${v},${v},${v},0.7)`;
      ctx.beginPath(); ctx.arc(px, py, r, 0, 6.3); ctx.fill();
    });
  }
  // faint wheel ruts bands (horizontal; shader rotates nothing, kept subtle)
  return toTexture(c);
}

// ---- foliage / vegetation ----
export function makeFoliageTexture() {
  const S = 256, rnd = mulberry32(5);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#c9c9c9'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, r = 1.5 + rnd() * 4.5;
    const v = 90 + rnd() * 165 | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
    wrapDraw(S, x, y, r, (px, py) => {
      ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.55, rnd() * 3, 0, 6.3); ctx.fill();
    });
  }
  return toTexture(c, { srgb: true });
}

export function makeGrassTuftTexture() {
  const W = 128, H = 128, rnd = mulberry32(21);
  const c = makeCanvas(W, H), ctx = c.getContext('2d');
  for (let i = 0; i < 34; i++) {
    const bx = W / 2 + (rnd() - 0.5) * 46, lean = (rnd() - 0.5) * 70, h = 60 + rnd() * 64;
    const tx = bx + lean, ty = H - h;
    const g = ctx.createLinearGradient(0, H, 0, ty);
    g.addColorStop(0, '#3d4a1c'); g.addColorStop(0.6, '#7d9a3a'); g.addColorStop(1, '#b7c75c');
    ctx.fillStyle = g;
    const w = 2.2 + rnd() * 2.6;
    ctx.beginPath();
    ctx.moveTo(bx - w, H);
    ctx.quadraticCurveTo(bx + lean * 0.15 - w * 0.5, H - h * 0.55, tx, ty);
    ctx.quadraticCurveTo(bx + lean * 0.15 + w * 0.5, H - h * 0.55, bx + w, H);
    ctx.closePath(); ctx.fill();
  }
  const t = toTexture(c, { srgb: true, repeat: false });
  return t;
}

// ---- building textures (grayscale-ish; tinted by vertex colour) ----
export function makePlasterTexture() {
  // 3 m x 3 m module with a window; plaster with stains
  const S = 256, rnd = mulberry32(31);
  const f = fbmField(S, 61, 6, 4);
  const c = fieldCanvas(f, S, (v) => 0.82 + (v - 0.5) * 0.35);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 20; i++) {
    const x = rnd() * S, w = 8 + rnd() * 24;
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(60,55,45,0.0)'); g.addColorStop(1, 'rgba(60,55,45,0.10)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, S);
  }
  // window
  const wx = 88, wy = 56, ww = 80, wh = 120;
  ctx.fillStyle = 'rgba(40,40,40,0.5)'; ctx.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
  ctx.fillStyle = '#1e262c'; ctx.fillRect(wx, wy, ww, wh);
  const gg = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  gg.addColorStop(0, 'rgba(160,190,215,0.35)'); gg.addColorStop(0.5, 'rgba(60,80,100,0.05)'); gg.addColorStop(1, 'rgba(120,150,175,0.25)');
  ctx.fillStyle = gg; ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh); ctx.fillRect(wx, wy + wh * 0.4, ww, 4);
  // shutters
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(wx - 30, wy - 4, 22, wh + 8); ctx.fillRect(wx + ww + 8, wy - 4, 22, wh + 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const y = wy + i * 10;
    ctx.beginPath(); ctx.moveTo(wx - 30, y); ctx.lineTo(wx - 8, y); ctx.moveTo(wx + ww + 8, y); ctx.lineTo(wx + ww + 30, y); ctx.stroke();
  }
  return toTexture(c, { srgb: true });
}

export function makeRoofTexture() {
  // 2 m x 2 m of clay tiles
  const S = 256, rnd = mulberry32(37);
  const f = fbmField(S, 71, 8, 3);
  const c = fieldCanvas(f, S, (v) => 0.7 + (v - 0.5) * 0.5);
  const ctx = c.getContext('2d');
  const rows = 14, rh = S / rows, cols = 10, cw = S / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols + 1; k++) {
      const x = k * cw + (r % 2 ? cw / 2 : 0) - cw / 2, y = r * rh;
      const v = 140 + rnd() * 100 | 0;
      ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
      ctx.fillRect(x + 1, y, cw - 2, rh - 1);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 1, y + rh - 3, cw - 2, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, y, 1.5, rh);
    }
  }
  return toTexture(c, { srgb: true });
}

export function makeStoneTexture() {
  const S = 256, rnd = mulberry32(43);
  const f = fbmField(S, 81, 8, 4);
  const c = fieldCanvas(f, S, (v) => 0.62 + (v - 0.5) * 0.4);
  const ctx = c.getContext('2d');
  const rows = 8, rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 40;
    while (x < S) {
      const w = 36 + rnd() * 40, v = 120 + rnd() * 110 | 0;
      ctx.fillStyle = `rgba(${v},${v},${v},0.55)`; ctx.fillRect(x + 1.5, r * rh + 1.5, w - 3, rh - 3);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, r * rh + 1, w - 2, rh - 2);
      x += w;
    }
  }
  return toTexture(c, { srgb: true });
}

export function makeWoodTexture() {
  // vertical boards, 1 m wide tile with 5 boards
  const S = 256, rnd = mulberry32(53);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const boards = 5, bw = S / boards;
  for (let b = 0; b < boards; b++) {
    const base = 150 + rnd() * 60 | 0;
    ctx.fillStyle = `rgb(${base},${base},${base})`; ctx.fillRect(b * bw, 0, bw, S);
    for (let i = 0; i < 40; i++) {
      const x = b * bw + rnd() * bw, v = 90 + rnd() * 150 | 0;
      ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`; ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 3, S * 0.3, x - 3, S * 0.7, x + 1, S); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(b * bw, 0, 2.5, S);
  }
  return toTexture(c, { srgb: true });
}

export function makeMetalRoofTexture() {
  const S = 128, c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.5, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = g; ctx.fillRect(x, 0, 16, S);
  }
  return toTexture(c, { srgb: true });
}
