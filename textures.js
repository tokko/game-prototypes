// Procedural canvas textures. Everything is generated at load; no image assets.
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw, { repeat, data = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (!data) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, r, n, lo, hi, size, tint, alpha = 1) {
  for (let i = 0; i < n; i++) {
    const v = lo + r() * (hi - lo);
    ctx.fillStyle = `rgba(${(v * tint[0]) | 0},${(v * tint[1]) | 0},${(v * tint[2]) | 0},${alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * size, 1 + r() * size);
  }
}

// Wet cobbles: colour + bump from the same stone layout. Tile = 1.5 m.
export function cobbles() {
  const draw = (mode) => (ctx, w, h) => {
    const r = rng(11);
    ctx.fillStyle = mode === 'color' ? '#06080b' : '#000';
    ctx.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      const n = 6 + (j % 2);
      const ws = Array.from({ length: n }, () => 0.7 + r() * 0.6);
      const tot = ws.reduce((a, b) => a + b, 0);
      let x = 0;
      for (const wr of ws) {
        const sw = (wr / tot) * w, g = 40 + r() * 44, v = 130 + r() * 100;
        ctx.fillStyle = mode === 'color' ? `rgb(${g | 0},${(g + 5) | 0},${(g + 13) | 0})` : `rgb(${v | 0},${v | 0},${v | 0})`;
        ctx.beginPath();
        ctx.roundRect(x + 3, j * rh + 3, sw - 6, rh - 6, 16);
        ctx.fill();
        x += sw;
      }
    }
    if (mode === 'color') speckle(ctx, w, h, r, 900, 10, 70, 3, [1, 1.05, 1.2], 0.5);
  };
  return { map: canvasTex(512, 512, draw('color')), bump: canvasTex(512, 512, draw('bump'), { data: true }) };
}

export function dirt() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = rng(21);
    ctx.fillStyle = '#2a261c'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, r, 3500, 14, 70, 4, [1, 0.95, 0.8], 0.7);
    speckle(ctx, w, h, r, 300, 40, 90, 6, [0.9, 1, 0.9], 0.5);
  });
}

export function groundFloor() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = rng(31);
    ctx.fillStyle = '#18201c'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, r, 5000, 6, 40, 4, [0.85, 1, 0.95], 0.8);
    speckle(ctx, w, h, r, 400, 25, 60, 7, [0.8, 0.9, 0.8], 0.4);
  });
}

export function gravel() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = rng(41);
    ctx.fillStyle = '#23272d'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, r, 6000, 20, 100, 3, [1, 1.02, 1.1], 0.9);
  });
}

export function plaster() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = rng(51);
    ctx.fillStyle = '#5b6675'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, r, 4000, 30, 80, 3, [1, 1.05, 1.15], 0.35);
    for (let i = 0; i < 40; i++) { // rain stains
      ctx.fillStyle = `rgba(5,8,12,${0.05 + r() * 0.1})`;
      ctx.fillRect(r() * w, r() * h * 0.5, 1 + r() * 4, 60 + r() * 160);
    }
  });
}

export function slate() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = rng(61);
    ctx.fillStyle = '#0b0e12'; ctx.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      let x = (j % 2) * 16;
      while (x < w) {
        const sw = 28 + r() * 8, g = 22 + r() * 18;
        ctx.fillStyle = `rgb(${g | 0},${(g + 4) | 0},${(g + 10) | 0})`;
        ctx.fillRect(x + 1, j * rh + 1, sw - 2, rh - 2);
        x += sw;
      }
    }
  });
}

export function planks() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const r = rng(71);
    const n = 4, pw = w / n;
    for (let i = 0; i < n; i++) {
      const g = 30 + r() * 14;
      ctx.fillStyle = `rgb(${g | 0},${(g * 0.82) | 0},${(g * 0.7) | 0})`;
      ctx.fillRect(i * pw, 0, pw, h);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(i * pw, 0, 2, h);
      for (let k = 0; k < 14; k++) { ctx.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.1})`; ctx.fillRect(i * pw + r() * pw, 0, 1, h); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, r() * h, w, 2);
  });
}

export function bark() {
  return canvasTex(64, 128, (ctx, w, h) => {
    const r = rng(81);
    ctx.fillStyle = '#1a1713'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const v = 8 + r() * 40; ctx.fillStyle = `rgb(${v},${v * 0.9},${v * 0.8})`; ctx.fillRect(r() * w, 0, 1 + r() * 2, h); }
  });
}

// Window with frame. kind 'dark' (unlit pane) or 'lit' (amber).
export function windowTex(kind) {
  return canvasTex(128, 192, (ctx, w, h) => {
    const lit = kind === 'lit';
    if (lit) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffcf86'); g.addColorStop(1, '#b8631f');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0b1017'); g.addColorStop(1, '#04060a');
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = lit ? '#1b100a' : '#4a525b';
    ctx.lineWidth = 7; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h * 0.36); ctx.lineTo(w, h * 0.36); ctx.stroke();
  });
}

// Rain-streaked glass (transparent): dark tint, streaks, droplets.
export function rainGlass() {
  return canvasTex(128, 192, (ctx, w, h) => {
    const r = rng(91);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,13,20,0.5)'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const x = r() * w, y = r() * h * 0.6, l = 20 + r() * 110;
      const g = ctx.createLinearGradient(0, y, 0, y + l);
      g.addColorStop(0, 'rgba(140,165,190,0)'); g.addColorStop(0.3, `rgba(140,165,190,${0.12 + r() * 0.14})`); g.addColorStop(1, 'rgba(140,165,190,0)');
      ctx.fillStyle = g; ctx.fillRect(x, y, 1 + r() * 1.6, l);
    }
    for (let i = 0; i < 50; i++) { ctx.fillStyle = `rgba(170,190,210,${0.1 + r() * 0.15})`; ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.8 + r() * 1.6, 0, 7); ctx.fill(); }
  });
}

export function curtain() {
  return canvasTex(128, 192, (ctx, w, h) => {
    for (let x = 0; x < w; x++) {
      const f = 0.6 + 0.4 * Math.sin(x * 0.42) * Math.sin(x * 0.11 + 1);
      ctx.fillStyle = `rgb(${(110 * f) | 0},${(88 * f) | 0},${(80 * f) | 0})`;
      ctx.fillRect(x, 0, 1, h);
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

export function doorTex() {
  return canvasTex(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1b1411'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#0a0706'; ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, w - 16, h * 0.42); ctx.strokeRect(8, h * 0.5, w - 16, h * 0.42);
  });
}

// Laundry sheet: grey-white cloth with folds and old stains.
export function sheet() {
  return canvasTex(64, 96, (ctx, w, h) => {
    const r = rng(111);
    for (let x = 0; x < w; x++) { const f = 0.8 + 0.2 * Math.sin(x * 0.55) * Math.sin(x * 0.13 + 2); ctx.fillStyle = `rgb(${(150 * f) | 0},${(150 * f) | 0},${(146 * f) | 0})`; ctx.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(60,48,36,${0.08 + r() * 0.12})`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 3 + r() * 9, 3 + r() * 12, 0, 0, 7); ctx.fill(); }
  });
}

// Shrine icon: a dark panel, gilt halo, a hooded figure.
export function icon() {
  return canvasTex(64, 96, (ctx, w, h) => {
    ctx.fillStyle = '#1a120d'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h * 0.34, 3, w / 2, h * 0.34, w * 0.45);
    g.addColorStop(0, 'rgba(210,160,70,0.9)'); g.addColorStop(0.7, 'rgba(120,80,30,0.6)'); g.addColorStop(1, 'rgba(60,40,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0a0705';
    ctx.beginPath(); ctx.moveTo(w * 0.2, h); ctx.quadraticCurveTo(w * 0.22, h * 0.55, w * 0.38, h * 0.46); ctx.lineTo(w * 0.62, h * 0.46);
    ctx.quadraticCurveTo(w * 0.78, h * 0.55, w * 0.8, h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(w / 2, h * 0.34, w * 0.14, 0, 7); ctx.fill();
    ctx.strokeStyle = '#6b4a22'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
}

// Soft radial glow (lamp halos, light pools on the ground).
export function glow() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.15, 'rgba(255,255,255,0.4)'); g.addColorStop(0.45, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

// Long vertical reflection streak for wet ground under a lamp.
export function streak() {
  return canvasTex(64, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x / (w - 1)) * 2 - 1, v = y / (h - 1);
      const a = Math.exp(-u * u * 7) * Math.pow(1 - v, 1.6);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ---- apparition billboards (transparent, dark, low contrast) -------------------------------

// Pale woman behind glass: black hair hanging over the face, pale neck and chest, grey dress.
export function womanTex() {
  return canvasTex(160, 256, (ctx, w, h) => {
    const r = rng(101);
    ctx.clearRect(0, 0, w, h);
    const halo = ctx.createRadialGradient(w / 2, h * 0.36, 8, w / 2, h * 0.36, 90); // faint backlight from the room
    halo.addColorStop(0, 'rgba(110,120,132,0.35)'); halo.addColorStop(1, 'rgba(110,120,132,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(58,64,72)'; // shoulders and dress
    ctx.beginPath(); ctx.moveTo(4, h); ctx.quadraticCurveTo(10, h * 0.7, w * 0.34, h * 0.63); ctx.lineTo(w * 0.66, h * 0.63);
    ctx.quadraticCurveTo(w - 10, h * 0.7, w - 4, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgb(160,168,176)'; // neck, chest, face
    ctx.beginPath(); ctx.moveTo(w * 0.36, h * 0.63); ctx.lineTo(w * 0.5, h * 0.78); ctx.lineTo(w * 0.64, h * 0.63); ctx.closePath(); ctx.fill();
    ctx.fillRect(w / 2 - 10, h * 0.5, 20, h * 0.14);
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.36, 29, 42, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgb(3,3,5)'; // hair: cap over the crown, then curtains falling over the face and shoulders
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.26, 38, 34, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = 'rgb(3,3,5)'; ctx.lineCap = 'round';
    for (let i = 0; i < 110; i++) {
      const x0 = w / 2 + (r() - 0.5) * 76, y0 = h * 0.22 + r() * 10, y1 = h * (0.6 + r() * 0.36), sway = (r() - 0.5) * 30;
      ctx.lineWidth = 1.5 + r() * 3;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x0 + sway, y0 + (y1 - y0) * 0.35, x0 - sway * 0.6, y0 + (y1 - y0) * 0.7, x0 + sway * 0.5, y1); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(205,213,222,0.7)'; ctx.fillRect(w / 2 - 8, h * 0.395, 2, 2); ctx.fillRect(w / 2 + 6, h * 0.395, 2, 2); // glints through the hair
  });
}

// Shadow creature body: hunched near-black silhouette with ragged edges. Eyes are a separate plane.
export function creatureTex() {
  return canvasTex(128, 256, (ctx, w, h) => {
    const r = rng(111);
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8; ctx.fillStyle = 'rgb(2,3,5)';
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.27, 27, 33, 0, 0, 7); ctx.fill();            // head
    ctx.beginPath(); ctx.moveTo(w * 0.1, h); ctx.quadraticCurveTo(w * 0.04, h * 0.5, w * 0.3, h * 0.4);
    ctx.lineTo(w * 0.7, h * 0.4); ctx.quadraticCurveTo(w * 0.96, h * 0.5, w * 0.9, h); ctx.closePath(); ctx.fill(); // hunched body
    ctx.strokeStyle = 'rgb(2,3,5)'; ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) { // ragged strands
      const a = r() * 6.28, x = w / 2 + Math.cos(a) * 20, y = h * 0.27 + Math.sin(a) * 26, l = 8 + r() * 16;
      ctx.lineWidth = 1 + r() * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  });
}

// Pair of luminous eyes. draw(m): m = 0 round glows, m = 1 upward-bowed crescents (a smile).
export function eyesTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (m) => {
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 256, 64);
    for (const cx of [98, 158]) {
      const rx = 11 + 8 * m, hh = 10 * (1 - 0.7 * m), bow = 15 * m, N = 24;
      const path = () => {
        ctx.beginPath();
        for (let i = 0; i <= N; i++) { const u = -1 + (2 * i) / N, e = Math.sqrt(Math.max(0, 1 - u * u)); ctx[i ? 'lineTo' : 'moveTo'](cx + u * rx, 36 - hh * e - bow * (1 - u * u)); }
        for (let i = N; i >= 0; i--) { const u = -1 + (2 * i) / N, e = Math.sqrt(Math.max(0, 1 - u * u)); ctx.lineTo(cx + u * rx, 36 + hh * e - bow * (1 - u * u)); }
        ctx.closePath();
      };
      ctx.shadowColor = 'rgba(170,240,200,0.95)'; ctx.shadowBlur = 18; ctx.fillStyle = 'rgba(190,245,215,0.8)'; path(); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgb(232,255,240)'; path(); ctx.fill();
    }
    tex.needsUpdate = true;
  };
  draw(0);
  return { tex, draw };
}

// Distant figure: thin dark coat, faceless pale head, arms down.
export function figureTex() {
  return canvasTex(64, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    ctx.fillStyle = 'rgb(9,11,15)';
    ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.2); ctx.lineTo(w * 0.7, h * 0.2); ctx.lineTo(w * 0.8, h * 0.62); ctx.lineTo(w * 0.86, h);
    ctx.lineTo(w * 0.14, h); ctx.lineTo(w * 0.2, h * 0.62); ctx.closePath(); ctx.fill();
    ctx.fillRect(w * 0.16, h * 0.22, 7, h * 0.46); ctx.fillRect(w * 0.84 - 7, h * 0.22, 7, h * 0.46); // arms
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(70,82,98,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgb(98,107,118)'; ctx.beginPath(); ctx.ellipse(w / 2 + 1, h * 0.12, 8, 11, 0.12, 0, 7); ctx.fill();
  });
}
