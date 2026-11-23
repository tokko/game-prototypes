// Procedural canvas textures for the tank: paint (with camo + grime), roughness/bump, track links.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, NoColorSpace } from 'three';
import { makeCanvas, fbmField, fieldCanvas, toTexture } from '../environment/Textures.js';
import { mulberry32 } from '../util/noise.js';

export const VARIANTS = {
  // single desaturated olive drab; camo blotches only +-4% so it never reads as plastic camo
  player: { base: '#5f5c45', camo: ['#5a5742', '#656249'], dust: 'rgba(150,130,95,0.12)', dustAmt: 0.55 },
  enemy: { base: '#a39a78', camo: ['#5f6848', '#6d5640'], dust: 'rgba(160,140,100,0.14)', dustAmt: 0.65, strongCamo: true },
  desert: { base: '#8c7a58', camo: ['#7a6a4a', '#9d8b66'], dust: 'rgba(190,170,125,0.14)', dustAmt: 0.6 },
};

let grimeShared = null;
const paintCache = new Map();

function getGrime() {
  if (grimeShared) return grimeShared;
  const S = 512, rnd = mulberry32(7);
  // grayscale grime: large blotches, rain streaks, fine pitting
  const f = fbmField(S, 3, 4, 5);
  const c = fieldCanvas(f, S, (v) => 0.72 + (v - 0.5) * 0.7);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S * 0.9, len = 20 + rnd() * 140, w = 0.8 + rnd() * 2.2;
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, 'rgba(20,18,14,0.0)'); g.addColorStop(0.3, `rgba(20,18,14,${0.08 + rnd() * 0.12})`); g.addColorStop(1, 'rgba(20,18,14,0.0)');
    ctx.fillStyle = g;
    for (const dx of [-S, 0, S]) ctx.fillRect(x + dx, y, w, len);
  }
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 1.8;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.20)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  }
  const rough = toTexture(c, { srgb: false });
  rough.userData.canvas = c;
  // bump from a different noise
  const f2 = fbmField(S, 91, 16, 4, 0.6);
  const bump = toTexture(fieldCanvas(f2, S, (v) => 0.5 + (v - 0.5) * 1.4));
  const map = toTexture(c, { srgb: true });
  grimeShared = { rough, bump, map };
  return grimeShared;
}

export function getGrimeTextures() { return getGrime(); }

export function getPaintTexture(name) {
  if (paintCache.has(name)) return paintCache.get(name);
  const v = VARIANTS[name] || VARIANTS.player;
  const S = 512;
  const c = makeCanvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = v.base; ctx.fillRect(0, 0, S, S);
  // camo blotches
  const f = fbmField(S, 17 + name.length, 3, 4, 0.55);
  const img = ctx.getImageData(0, 0, S, S);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const c1 = hex(v.camo[0]), c2 = hex(v.camo[1]);
  for (let i = 0; i < f.length; i++) {
    const a = f[i];
    let col = null, k = 0;
    const hi = v.strongCamo ? 0.54 : 0.57, lo = v.strongCamo ? 0.46 : 0.42;
    if (a > hi) { col = c2; k = Math.min(1, (a - hi) * 14); }
    else if (a < lo) { col = c1; k = Math.min(1, (lo - a) * 14); }
    if (col) {
      img.data[i * 4] += (col[0] - img.data[i * 4]) * k;
      img.data[i * 4 + 1] += (col[1] - img.data[i * 4 + 1]) * k;
      img.data[i * 4 + 2] += (col[2] - img.data[i * 4 + 2]) * k;
    }
  }
  ctx.putImageData(img, 0, 0);
  // grime multiply + dust overlay
  const grime = getGrime().rough.userData.canvas;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.6;
  ctx.drawImage(grime, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const rnd = mulberry32(55);
  ctx.fillStyle = v.dust;
  for (let i = 0; i < 220; i++) {
    const x = rnd() * S, y = rnd() * S, r = 4 + rnd() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, v.dust); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = toTexture(c, { srgb: true });
  paintCache.set(name, tex);
  return tex;
}

// Track link textures: 2 links per tile along u, link width across v.
export function makeTrackTextures() {
  const W = 256, H = 128, rnd = mulberry32(99);
  const mk = (bump) => {
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = bump ? '#505050' : '#2e2d29'; ctx.fillRect(0, 0, W, H);
    for (let l = 0; l < 2; l++) {
      const x0 = l * 128;
      // rubber/steel pad
      ctx.fillStyle = bump ? '#7a7a7a' : '#3b3a35';
      ctx.fillRect(x0 + 6, 12, 112, 104);
      // end connectors
      ctx.fillStyle = bump ? '#c8c8c8' : '#4b4a44';
      ctx.fillRect(x0 + 2, 6, 10, 116);
      ctx.fillRect(x0 + 116, 6, 10, 116);
      // grousers/cleats
      ctx.fillStyle = bump ? '#e6e6e6' : '#57554d';
      for (let k = 0; k < 3; k++) ctx.fillRect(x0 + 24 + k * 30, 14, 10, 100);
      // centre guide horn
      ctx.fillStyle = bump ? '#f4f4f4' : '#5a584f';
      ctx.fillRect(x0 + 40, 52, 48, 24);
      // grooves
      ctx.fillStyle = bump ? '#000' : '#14130f';
      ctx.fillRect(x0, 0, 3, H);
      // pins
      ctx.fillStyle = bump ? '#fff' : '#6c6a60';
      for (const y of [22, 106]) { ctx.beginPath(); ctx.arc(x0 + 12, y, 4, 0, 6.3); ctx.fill(); }
    }
    if (!bump) {
      // mud and wear
      for (let i = 0; i < 500; i++) {
        const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 5;
        ctx.fillStyle = rnd() > 0.45 ? `rgba(95,78,55,${0.16 + rnd() * 0.24})` : `rgba(130,128,118,${0.05 + rnd() * 0.1})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
      }
    }
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = bump ? NoColorSpace : SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(false), bump: mk(true) };
}

// packed mask texture for the paint shader: R = dust breakup noise, G = roughness, B = edge-chip clusters
let maskTex = null;
export function getMaskTexture() {
  if (maskTex) return maskTex;
  const S = 512, rnd = mulberry32(333);
  const f = fbmField(S, 401, 8, 3, 0.5);
  const c = makeCanvas(S), ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < f.length; i++) {
    img.data[i * 4] = Math.max(0, Math.min(255, (f[i] - 0.25) * 2.0 * 255));
    img.data[i * 4 + 1] = 205 + (f[i] - 0.5) * 70;
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = 255;
  }
  for (let n = 0; n < 380; n++) {
    const cx = rnd() * S, cy = rnd() * S, cnt = 3 + ((rnd() * 9) | 0);
    for (let k = 0; k < cnt; k++) {
      const x = (cx + (rnd() - 0.5) * 22) | 0, y = (cy + (rnd() - 0.5) * 22) | 0, r = 1 + ((rnd() * 3) | 0);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const xx = (x + dx + S) % S, yy = (y + dy + S) % S;
        img.data[(yy * S + xx) * 4 + 2] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  maskTex = toTexture(c, { srgb: false });
  return maskTex;
}
