// HUD: strength bar + flags, timer, objectives, minimap, general panel, unit cards, order buttons, deployment panel, messages, end screen.
// All figures/icons are drawn on small canvases (no image assets). Layout/styling lives in style.css.
import { SIDE_COLOR, lightOut } from './units.js';
import { Orders } from './input.js';
import { MAP, HALF, VILLAGE } from './terrain.js';

const $ = (id) => document.getElementById(id);
const GOLD = '#f0d890';

// ---- tiny drawing helpers --------------------------------------------------------------
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}
const circle = (ctx, x, y, r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); };
const line = (ctx, x0, y0, x1, y1, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
function poly(ctx, pts, fill) { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); }

// ---- soldier figures (card art, logical canvas 64x84) -------------------------------------
// person(): origin at the feet, y up is negative, ~70 units tall, drawn facing the viewer.
function torso(ctx, o) {
  const c = o.coat;
  ctx.fillStyle = grad(ctx, -9, 0, 9, 0, [shade(c, 1.2), c, shade(c, 0.55)]);
  ctx.beginPath(); ctx.moveTo(-9.5, -45); ctx.quadraticCurveTo(0, -50, 9.5, -45); ctx.lineTo(8, -23); ctx.lineTo(-8, -23); ctx.closePath(); ctx.fill();
  if (o.armor) {
    ctx.fillStyle = grad(ctx, -8, 0, 8, 0, ['#e8ecf0', '#9aa4ae', '#4a525c']);
    ctx.beginPath(); ctx.moveTo(-7.5, -45); ctx.quadraticCurveTo(0, -49, 7.5, -45); ctx.lineTo(6, -26); ctx.quadraticCurveTo(0, -23, -6, -26); ctx.closePath(); ctx.fill();
    line(ctx, 0, -46, 0, -26, 1, '#3a4048'); circle(ctx, -3, -40, 0.9, '#d8b860'); circle(ctx, 3, -40, 0.9, '#d8b860');
  }
  if (o.belts) { line(ctx, -7, -45, 7, -26, 2.2, '#ebe4cc'); line(ctx, 7, -45, -7, -26, 2.2, '#ebe4cc'); circle(ctx, 0, -36, 1.8, '#d8b860'); }
  if (o.lace) for (let i = 0; i < 4; i++) { ctx.strokeStyle = '#e0c060'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-6, -43 + i * 4.5); ctx.lineTo(0, -41 + i * 4.5); ctx.lineTo(6, -43 + i * 4.5); ctx.stroke(); }
  if (!o.armor && !o.lace && !o.belts) for (let i = 0; i < 4; i++) circle(ctx, 0, -43 + i * 4.5, 0.9, '#d8b860');
  line(ctx, -8, -24, 8, -24, 2.2, '#2a2018'); // belt
}
function head(ctx) {
  ctx.fillStyle = grad(ctx, -5, -60, 5, -50, ['#f0c8a0', '#c48e66']);
  ctx.beginPath(); ctx.ellipse(0, -54.5, 4.8, 5.6, 0, 0, 6.3); ctx.fill();
  circle(ctx, -1.8, -55, 0.7, '#2a1c12'); circle(ctx, 1.8, -55, 0.7, '#2a1c12');
}
function hat(ctx, kind, coat) {
  if (kind === 'shako') {
    poly(ctx, [[-6, -58.5], [6, -58.5], [7.5, -75], [-7.5, -75]], '#1c1814'); ctx.fillStyle = '#0e0b09'; ctx.fillRect(-6.5, -60, 13, 2.2);
    circle(ctx, 0, -66, 2.2, '#d8b860'); circle(ctx, 0, -77, 2.4, '#f2eee0'); line(ctx, 0, -75, 0, -77, 1.4, '#f2eee0');
  } else if (kind === 'slouch') {
    ctx.fillStyle = '#26301f'; ctx.beginPath(); ctx.ellipse(0, -59, 10.5, 2.8, 0, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -63.5, 6, 6, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(-6, -63.5, 12, 4.5);
    ctx.strokeStyle = coat; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(4, -64); ctx.quadraticCurveTo(10, -72, 12, -66); ctx.stroke();
  } else if (kind === 'morion') {
    ctx.fillStyle = grad(ctx, -8, 0, 8, 0, ['#eef2f4', '#a0aab4', '#4e5660']);
    ctx.beginPath(); ctx.ellipse(0, -58.5, 7.4, 10, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -58.5, 11.5, 2.6, 0, 0, 6.3); ctx.fill();
    poly(ctx, [[-1.4, -68.5], [1.4, -68.5], [3.4, -61], [-3.4, -61]], '#6a7480');
  } else if (kind === 'busby') {
    ctx.fillStyle = '#2a1c14'; ctx.beginPath(); ctx.moveTo(-6, -58.5); ctx.lineTo(-7, -75); ctx.quadraticCurveTo(0, -78, 7, -75); ctx.lineTo(6, -58.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = coat; ctx.beginPath(); ctx.ellipse(6.5, -70, 3, 5.5, 0.2, 0, 6.3); ctx.fill();
    line(ctx, -6.5, -62, 6.5, -62, 1, '#d8b860'); line(ctx, 0, -76, 0, -84, 2, '#f2eee0'); circle(ctx, 0, -84, 2, '#f2eee0');
  } else if (kind === 'czapka') {
    poly(ctx, [[-5.5, -58.5], [5.5, -58.5], [8.5, -77], [-8.5, -77]], shade(coat, 0.45)); line(ctx, -6, -62, 6, -62, 1.6, '#d8b860');
    poly(ctx, [[-8.5, -77], [8.5, -77], [10, -80], [-10, -80]], '#e8e0c8'); line(ctx, 0, -80, 0, -88, 2, '#f2eee0'); circle(ctx, 0, -89, 2.4, '#d83030');
  }
}
function weapon(ctx, kind, coat) {
  const hand = (x, y) => circle(ctx, x, y, 2.2, '#d8a880');
  const arm = (x0, y0, x1, y1) => line(ctx, x0, y0, x1, y1, 4.6, shade(coat, 0.85));
  if (kind === 'musket' || kind === 'rifle') {
    const top = kind === 'musket' ? -70 : -62;
    line(ctx, 9, -14, 12, -40, 2.8, '#6a4424'); line(ctx, 12, -40, 15, top, 1.6, '#9aa0a8');
    if (kind === 'musket') poly(ctx, [[14.4, -70], [15.6, -70], [16, -80]], '#cfd6dc');
    arm(-8, -43, 3, -34); arm(8, -43, 11, -33); hand(3.5, -33.5); hand(11.5, -32);
  } else if (kind === 'pike') {
    line(ctx, 13, -2, 16, -74, 2, '#8a6a3a'); poly(ctx, [[14.6, -74], [17.4, -74], [16, -84]], '#dfe5ea');
    poly(ctx, [[16.2, -68], [26, -65], [16.2, -61]], '#c43030');
    arm(-8, -43, 4, -35); arm(8, -43, 13, -34); hand(4.5, -34.5); hand(13.5, -33);
  } else if (kind === 'sabre') {
    arm(8, -44, 17, -58); hand(17.5, -58.5);
    ctx.strokeStyle = '#dfe5ea'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(17.5, -58.5); ctx.quadraticCurveTo(26, -72, 34, -76); ctx.stroke(); line(ctx, 15, -61, 20, -56, 1.6, '#d8b860');
    arm(-8, -43, -12, -30);
  } else if (kind === 'lance') {
    line(ctx, 13, -16, 16, -92, 2, '#8a6a3a'); poly(ctx, [[14.6, -92], [17.4, -92], [16, -100]], '#dfe5ea');
    poly(ctx, [[16.4, -88], [28, -84], [16.4, -79]], '#d8d0b0');
    arm(8, -44, 13, -32); hand(13.5, -31); arm(-8, -43, -11, -30);
  }
}
function person(ctx, o) {
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(o.s, o.s);
  ctx.fillStyle = o.legs || '#ddd6c0'; ctx.fillRect(-6, -25, 5.2, 21); ctx.fillRect(0.8, -25, 5.2, 21);
  ctx.fillStyle = '#17120e'; ctx.fillRect(-7, -5, 7, 5); ctx.fillRect(0, -5, 7, 5);
  torso(ctx, o); head(ctx); hat(ctx, o.hat, o.coat); weapon(ctx, o.weapon, o.coat);
  ctx.restore();
}
function horse(ctx, team) {
  const body = grad(ctx, 0, 44, 0, 64, ['#7a4e2c', '#4a2c16']);
  ctx.lineCap = 'round'; ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 3.4;
  for (const [x0, y0, x1, y1] of [[16, 58, 13, 76], [23, 59, 24, 77], [40, 59, 41, 77], [46, 57, 50, 75]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  ctx.fillStyle = '#14100c'; for (const [x, y] of [[13, 77], [24, 78], [41, 78], [50, 76]]) ctx.fillRect(x - 2.2, y - 1, 4.4, 3.4);
  ctx.strokeStyle = '#2a1a0c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(12, 50); ctx.quadraticCurveTo(3, 58, 6, 72); ctx.stroke(); // tail
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(30, 54, 20, 9.5, 0, 0, 6.3); ctx.fill();
  ctx.beginPath(); ctx.moveTo(43, 52); ctx.lineTo(46, 33); ctx.lineTo(53, 31); ctx.lineTo(61, 44); ctx.lineTo(57, 47.5); ctx.lineTo(54, 42); ctx.lineTo(49, 58); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#1e1208'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(46, 33); ctx.quadraticCurveTo(42, 42, 44, 52); ctx.stroke(); // mane
  circle(ctx, 55, 38, 0.9, '#0a0705');
  ctx.fillStyle = team; ctx.fillRect(22, 45, 16, 8); ctx.strokeStyle = '#d8b860'; ctx.lineWidth = 1; ctx.strokeRect(22.5, 45.5, 15, 7); // saddle cloth
}
function cannon(ctx, team) {
  line(ctx, 30, 62, 6, 77, 4.6, '#4a2f18'); line(ctx, 30, 62, 6, 77, 1.4, team);
  circle(ctx, 53, 77, 3, '#22201e'); circle(ctx, 58, 77, 3, '#22201e'); circle(ctx, 55.5, 72, 3, '#22201e');
  ctx.save(); ctx.translate(26, 55); ctx.rotate(-0.2);
  ctx.fillStyle = grad(ctx, 0, -5, 0, 5, ['#d8aa54', '#8a6428', '#4a3416']);
  ctx.beginPath(); ctx.moveTo(-6, -2.5); ctx.lineTo(-6, 2.5); ctx.lineTo(31, 5); ctx.lineTo(31, -5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d8aa54'; ctx.fillRect(29, -6, 4, 12); circle(ctx, -7, 0, 3, '#8a6428'); line(ctx, 8, -4, 8, 4, 1.4, '#4a3416');
  ctx.restore();
  circle(ctx, 30, 65, 12, '#4a2f18'); circle(ctx, 30, 65, 10, '#17110a');
  ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 1.8; for (let i = 0; i < 6; i++) { const a = i * 1.047; ctx.beginPath(); ctx.moveTo(30, 65); ctx.lineTo(30 + Math.cos(a) * 10, 65 + Math.sin(a) * 10); ctx.stroke(); }
  circle(ctx, 30, 65, 2.6, '#d8b860');
}
const FIGURES = {
  line: (ctx, t) => person(ctx, { x: 30, y: 79, s: 0.92, coat: t, hat: 'shako', weapon: 'musket', belts: true }),
  rifle: (ctx, t) => person(ctx, { x: 30, y: 79, s: 0.92, coat: shade(t, 0.8), hat: 'slouch', weapon: 'rifle', legs: '#47493a' }),
  light: (ctx, t) => person(ctx, { x: 30, y: 79, s: 0.92, coat: t, hat: 'shako', weapon: 'musket', legs: '#47493a' }),
  pike: (ctx, t) => person(ctx, { x: 30, y: 79, s: 0.88, coat: t, hat: 'morion', weapon: 'pike', armor: true, legs: '#8a6a3a' }),
  lcav: (ctx, t) => { horse(ctx, t); person(ctx, { x: 30, y: 64, s: 0.62, coat: t, hat: 'busby', weapon: 'sabre', lace: true, legs: '#2a2e5a' }); },
  hcav: (ctx, t) => { horse(ctx, t); person(ctx, { x: 30, y: 64, s: 0.6, coat: t, hat: 'czapka', weapon: 'lance', belts: true }); },
  artillery: (ctx, t) => cannon(ctx, t),
};
function drawCardArt(cv, typeId, team) {
  const ctx = cv.getContext('2d'), k = cv.width / 64; ctx.save(); ctx.scale(k, k);
  ctx.fillStyle = grad(ctx, 0, 0, 0, 84, ['#3c382c', '#221c13', '#14100a']); ctx.fillRect(0, 0, 64, 84);
  ctx.fillStyle = shade(team, 0.55); ctx.fillRect(0, 0, 64, 4); ctx.fillStyle = 'rgba(240,216,144,.35)'; ctx.fillRect(0, 4, 64, 0.8);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(31, 79, 23, 3.6, 0, 0, 6.3); ctx.fill();
  (FIGURES[typeId] || FIGURES.line)(ctx, team);
  ctx.restore();
}

// ---- general portrait (logical 100x118) --------------------------------------------------------
function drawPortrait(cv) {
  const ctx = cv.getContext('2d'), k = cv.width / 100, red = SIDE_COLOR.player; ctx.save(); ctx.scale(k, k);
  ctx.fillStyle = grad(ctx, 0, 0, 0, 118, ['#5a4a38', '#2a2018', '#17110c']); ctx.fillRect(0, 0, 100, 118);
  ctx.fillStyle = 'rgba(180,140,70,.18)'; ctx.fillRect(0, 0, 14, 118); ctx.fillRect(86, 0, 14, 118);
  // coat
  ctx.fillStyle = grad(ctx, 0, 0, 100, 0, [shade(red, 0.6), shade(red, 1.15), shade(red, 0.6)]);
  ctx.beginPath(); ctx.moveTo(-2, 120); ctx.lineTo(4, 100); ctx.quadraticCurveTo(24, 84, 40, 80); ctx.lineTo(60, 80); ctx.quadraticCurveTo(76, 84, 96, 100); ctx.lineTo(102, 120); ctx.closePath(); ctx.fill();
  poly(ctx, [[34, 82], [50, 118], [28, 118], [18, 98]], shade(red, 1.35)); poly(ctx, [[66, 82], [50, 118], [72, 118], [82, 98]], shade(red, 1.35));
  for (let i = 0; i < 4; i++) { circle(ctx, 43 - i * 0.5, 94 + i * 6, 1.6, '#e0c060'); circle(ctx, 57 + i * 0.5, 94 + i * 6, 1.6, '#e0c060'); }
  line(ctx, 34, 82, 18, 98, 1.6, '#e0c060'); line(ctx, 66, 82, 82, 98, 1.6, '#e0c060');
  // cravat
  poly(ctx, [[41, 72], [59, 72], [56, 90], [50, 96], [44, 90]], '#f2eee0'); line(ctx, 50, 74, 50, 94, 1, '#c8c0a8');
  // epaulettes
  for (const sx of [1, -1]) {
    ctx.save(); ctx.translate(50 + sx * 38, 90); ctx.rotate(sx * 0.35);
    ctx.fillStyle = grad(ctx, 0, -5, 0, 5, ['#f6e3a0', '#b08a30']); ctx.beginPath(); ctx.ellipse(0, 0, 12, 5.2, 0, 0, 6.3); ctx.fill();
    for (let i = -10; i <= 10; i += 2.5) line(ctx, i, 3, i * 1.05, 11, 1.2, '#d8b860');
    ctx.restore();
  }
  circle(ctx, 70, 108, 4, '#e0c060'); circle(ctx, 70, 108, 2, '#3a5aa8');
  // face + powdered hair
  ctx.fillStyle = '#eceae2'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(50 + sx * 19, 60, 6, 10, sx * 0.15, 0, 6.3); ctx.fill(); }
  ctx.fillStyle = grad(ctx, 36, 40, 64, 76, ['#f0c8a0', '#d0a07a', '#b07c56']); ctx.beginPath(); ctx.ellipse(50, 57, 15.5, 19, 0, 0, 6.3); ctx.fill();
  line(ctx, 40, 53, 46, 52, 1.6, '#4a3a2c'); line(ctx, 54, 52, 60, 53, 1.6, '#4a3a2c');
  circle(ctx, 43.5, 57, 1.5, '#2a1c12'); circle(ctx, 56.5, 57, 1.5, '#2a1c12');
  line(ctx, 50, 58, 48.5, 66, 1.2, '#a8764e'); line(ctx, 45, 71, 55, 71, 1.4, '#8a4a3a');
  // tricorne
  ctx.fillStyle = '#15110d'; ctx.beginPath(); ctx.ellipse(50, 36, 23, 12, 0, Math.PI, 0); ctx.fill();
  poly(ctx, [[6, 45], [30, 30], [70, 30], [94, 45], [74, 47], [50, 42], [26, 47]], '#15110d');
  ctx.strokeStyle = '#e0c060'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(8, 45); ctx.lineTo(26, 47); ctx.lineTo(50, 42); ctx.lineTo(74, 47); ctx.lineTo(92, 45); ctx.stroke();
  circle(ctx, 33, 38, 4.5, '#f2eee0'); circle(ctx, 33, 38, 3, red);
  ctx.strokeStyle = '#f6f2e4'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(60, 26); ctx.quadraticCurveTo(76, 10, 84, 24); ctx.moveTo(62, 28); ctx.quadraticCurveTo(80, 18, 86, 32); ctx.stroke();
  ctx.restore();
}

// ---- flags + fleur emblem ------------------------------------------------------------------------
function drawFlag(cv, col) {
  const ctx = cv.getContext('2d');
  ctx.fillStyle = grad(ctx, 0, 0, 6, 0, ['#f6e3a0', '#8a6a24']); ctx.fillRect(8, 6, 4, 64); circle(ctx, 10, 5, 4.2, '#e0c060');
  ctx.fillStyle = grad(ctx, 12, 8, 56, 42, [shade(col, 1.3), col, shade(col, 0.6)]);
  ctx.beginPath(); ctx.moveTo(12, 9); ctx.bezierCurveTo(26, 2, 40, 18, 57, 9); ctx.lineTo(52, 24); ctx.lineTo(57, 40); ctx.bezierCurveTo(40, 49, 26, 33, 12, 41); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e0c060'; ctx.lineWidth = 1.6; ctx.stroke();
  poly(ctx, [[33, 17], [38, 25], [33, 33], [28, 25]], '#f2e6c0');
  poly(ctx, [[33, 20.5], [35.4, 25], [33, 29.5], [30.6, 25]], col);
}
function drawFleur(cv) {
  const ctx = cv.getContext('2d'), g = grad(ctx, 0, 0, 48, 48, ['#f6e3a0', '#c9a24b', '#8a6a24']);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(24, 3); ctx.bezierCurveTo(34, 12, 33, 26, 24, 34); ctx.bezierCurveTo(15, 26, 14, 12, 24, 3); ctx.fill();
  for (const s of [1, -1]) {
    ctx.save(); ctx.translate(24, 0); ctx.scale(s, 1); ctx.translate(-24, 0);
    ctx.beginPath(); ctx.moveTo(22, 28); ctx.bezierCurveTo(10, 8, -1, 26, 10, 33); ctx.bezierCurveTo(15, 36, 19, 34, 22, 31); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.fillRect(13, 34, 22, 4); poly(ctx, [[24, 46], [18, 39], [30, 39]], g);
}

// ---- order / command button icons (drawn in a 64x64 space) ---------------------------------------
function drawIcon(cv, name) {
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height); ctx.save(); ctx.scale(cv.width / 64, cv.height / 64);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = GOLD; ctx.fillStyle = GOLD; ctx.lineWidth = 5;
  const arrow = (x0, x1) => { const d = Math.sign(x1 - x0); ctx.beginPath(); ctx.moveTo(x0, 32); ctx.lineTo(x1, 32); ctx.moveTo(x1 - d * 10, 22); ctx.lineTo(x1, 32); ctx.lineTo(x1 - d * 10, 42); ctx.stroke(); };
  switch (name) {
    case 'halt': ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26); } ctx.closePath(); ctx.stroke(); ctx.fillRect(21, 21, 22, 22); break;
    case 'fire': line(ctx, 6, 46, 40, 34, 5, GOLD); poly(ctx, [[40, 22], [45, 29], [54, 24], [50, 33], [60, 36], [50, 40], [54, 48], [45, 43], [40, 50], [38, 40], [30, 37], [38, 33]], '#ffb040'); break;
    case 'hold': line(ctx, 6, 46, 50, 30, 5, GOLD); ctx.strokeStyle = '#e05050'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(32, 32, 24, 0, 6.3); ctx.moveTo(15, 15); ctx.lineTo(49, 49); ctx.stroke(); break;
    case 'run': for (const dx of [0, 16, 32]) { ctx.beginPath(); ctx.moveTo(8 + dx, 14); ctx.lineTo(22 + dx, 32); ctx.lineTo(8 + dx, 50); ctx.stroke(); } break;
    case 'tight': arrow(4, 24); arrow(60, 40); line(ctx, 32, 16, 32, 48, 5, GOLD); break;
    case 'loose': arrow(24, 4); arrow(40, 60); ctx.beginPath(); ctx.arc(32, 32, 3, 0, 6.3); ctx.fill(); break;
    case 'attack': ctx.lineWidth = 4.5; line(ctx, 10, 54, 52, 12, 4.5, '#e8ecf0'); line(ctx, 54, 54, 12, 12, 4.5, '#e8ecf0');
      line(ctx, 14, 40, 24, 50, 4.5, GOLD); line(ctx, 50, 40, 40, 50, 4.5, GOLD); circle(ctx, 8, 56, 3.4, GOLD); circle(ctx, 56, 56, 3.4, GOLD); break;
    case 'all': for (const [x, y] of [[10, 10], [36, 10], [10, 36], [36, 36]]) ctx.fillRect(x, y, 18, 18); break;
    case 'detach': for (const [x, y] of [[4, 18], [4, 34], [16, 26]]) ctx.fillRect(x, y, 9, 9); arrow(24, 42);
      for (const [x, y] of [[48, 12], [54, 28], [46, 40], [56, 50]]) ctx.fillRect(x, y, 8, 8); break;
    case 'recall': for (const [x, y] of [[4, 18], [4, 34], [16, 26]]) ctx.fillRect(x, y, 9, 9); arrow(46, 28);
      for (const [x, y] of [[48, 12], [54, 28], [46, 40], [56, 50]]) ctx.fillRect(x, y, 8, 8); break;
    case 'pause': ctx.fillRect(14, 10, 12, 44); ctx.fillRect(38, 10, 12, 44); break;
    case 'play': poly(ctx, [[16, 8], [54, 32], [16, 56]], GOLD); break;
    case 'speed1': poly(ctx, [[14, 10], [50, 32], [14, 54]], GOLD); break;
    case 'speed2': poly(ctx, [[6, 12], [32, 32], [6, 52]], GOLD); poly(ctx, [[32, 12], [58, 32], [32, 52]], GOLD); break;
    case 'speed4': poly(ctx, [[2, 14], [22, 32], [2, 50]], GOLD); poly(ctx, [[22, 14], [42, 32], [22, 50]], GOLD); poly(ctx, [[42, 14], [62, 32], [42, 50]], GOLD); break;
    case 'speedhalf': poly(ctx, [[50, 10], [14, 32], [50, 54]], GOLD); break;
  }
  ctx.restore();
}

export class UI {
  constructor(world, game, input, rts) {
    this.w = world; this.game = game; this.input = input; this.rts = rts; this.acc = 0; this.iconKey = {};
    this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
    this.base = world.terrain.minimapCanvas(200);
    // decorative canvases
    drawFlag($('flag-red'), SIDE_COLOR.player); drawFlag($('flag-blue'), SIDE_COLOR.enemy);
    drawFleur($('obj-emblem')); drawPortrait($('portrait'));
    // unit cards
    this.cards = new Map();
    const box = $('cards');
    const addCard = (r) => {
      if (r.side !== 'player') return;
      const el = document.createElement('div'); el.className = 'card';
      el.innerHTML = '<div class="men"></div><canvas width="96" height="126"></canvas><div class="nm"></div><div class="bar hp"><i></i></div><div class="bar mo"><i></i></div>';
      el.querySelector('.nm').textContent = r.def.short;
      el.title = r.name + ' (' + r.def.name + ')';
      drawCardArt(el.querySelector('canvas'), r.typeId, SIDE_COLOR.player);
      el.addEventListener('click', e => world.select([r], e.shiftKey));
      el.addEventListener('dblclick', () => { world.select([r], false); rts.focusOn(r.x, r.z); });
      const pc = r.parent && this.cards.get(r.parent);   // a light company's card sits right after its parent's
      if (pc) pc.el.after(el); else box.appendChild(el);
      this.cards.set(r, { el, hp: el.querySelector('.hp i'), mo: el.querySelector('.mo i'), men: el.querySelector('.men') });
    };
    for (const r of world.regs) addCard(r);
    (world.regHooks = world.regHooks || []).push({ add: addCard, remove: (r) => { const c = this.cards.get(r); if (c) { c.el.remove(); this.cards.delete(r); } } });
    // order buttons (only active in battle)
    const battle = (fn) => () => { if (game.phase === 'battle') fn(); };
    const bind = (id, icon, fn) => { const b = $(id); drawIcon(b.querySelector('canvas'), icon); b.onclick = battle(fn); };
    bind('o-halt', 'halt', () => Orders.halt(world.selection));
    bind('o-fire', 'fire', () => Orders.toggleFire(world.selection));
    bind('o-run', 'run', () => Orders.toggleRun(world.selection));
    bind('o-tight', 'tight', () => Orders.formation(world.selection, 'tight'));
    bind('o-loose', 'loose', () => Orders.formation(world.selection, 'loose'));
    bind('o-attack', 'attack', () => Orders.attack(world.selection, world.regs));
    drawIcon($('o-light').querySelector('canvas'), 'detach');
    $('o-light').onclick = () => input.lightOrder(world.selection.filter(r => r.state !== 'gone'));   // battle or deployment
    // general's command buttons
    drawIcon($('g-all').querySelector('canvas'), 'all');
    $('g-all').onclick = () => world.select(world.regs.filter(r => r.side === 'player'), false);
    $('g-pause').onclick = battle(() => { world.paused = !world.paused; });
    $('g-speed').onclick = battle(() => { world.speed = world.speed >= 4 ? 0.5 : world.speed * 2; });
    $('help-btn').onclick = () => $('help').classList.toggle('open');
    $('begin').onclick = () => { if (game.phase === 'deployment') game.startBattle(); };
    $('end-btn').onclick = () => location.reload();
    const mmMove = (e) => {
      const b = this.mm.getBoundingClientRect();
      rts.focusOn(((e.clientX - b.left) / b.width) * MAP - HALF, ((e.clientY - b.top) / b.height) * MAP - HALF);
    };
    this.mm.addEventListener('mousedown', e => { this.mmDrag = true; mmMove(e); });
    window.addEventListener('mousemove', e => { if (this.mmDrag) mmMove(e); });
    window.addEventListener('mouseup', () => { this.mmDrag = false; });
    this.mm.addEventListener('contextmenu', e => e.preventDefault());
  }
  banner(text, ms = 3000) { const b = $('banner'); b.textContent = text; if (ms) setTimeout(() => { if (b.textContent === text) b.textContent = ''; }, ms); }
  // redraw a button icon only when its state key changes
  setIcon(id, name) {
    if (this.iconKey[id] === name) return;
    this.iconKey[id] = name; drawIcon($(id).querySelector('canvas'), name);
  }

  update(dt) {
    // messages are cheap; flush every frame
    const w = this.w, phase = this.game.phase;
    $('deploy').style.display = phase === 'deployment' ? 'block' : 'none';
    while (w.messages.length) {
      const m = w.messages.shift(), d = document.createElement('div');
      d.className = m.side; d.textContent = m.text; $('messages').appendChild(d);
      setTimeout(() => d.remove(), 6200);
      while ($('messages').children.length > 5) $('messages').firstChild.remove();
    }
    this.acc += dt; if (this.acc < 0.12) return; this.acc = 0;
    // strength
    const str = (side) => w.regs.reduce((a, r) => a + (r.side === side && r.state !== 'gone' ? r.men * (r.state === 'routing' ? 0.35 : 1) : 0), 0);
    const p = str('player'), e = str('enemy');
    $('bal-red').style.width = (p / Math.max(1, p + e) * 100) + '%';
    $('str-red').textContent = Math.round(p); $('str-blue').textContent = Math.round(e);
    const t = Math.floor(w.time);
    $('timer').textContent = phase === 'deployment' || phase === 'intro' ? '--:--'
      : String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + (w.paused ? ' (paused)' : w.speed !== 1 ? ' x' + w.speed : '');
    // objectives
    const o = w.objectives;
    $('obj-village').classList.toggle('done', o.village);
    $('obj-guns').classList.toggle('done', o.guns);
    $('obj-rout').classList.toggle('done', o.rout);
    $('obj-hint').textContent = o.village ? 'Hold the village to win (' + Math.max(0, Math.ceil(75 - w.villageHold)) + 's)' : w.villageHold > 0 ? 'Capturing... ' + Math.floor(w.villageHold) + '/15s' : '';
    // cards
    for (const [r, c] of this.cards) {
      c.el.classList.toggle('selected', r.selected);
      c.el.classList.toggle('wavering', r.state === 'wavering'); c.el.classList.toggle('routing', r.state === 'routing'); c.el.classList.toggle('gone', r.state === 'gone');
      c.hp.style.width = (r.men / r.maxMen * 100) + '%'; c.mo.style.width = Math.max(0, r.morale / r.def.morale * 100) + '%';
      c.men.textContent = r.men;
    }
    const sel = w.selection, some = sel.length > 0;
    for (const [id, v] of [['o-fire', some && sel.every(r => r.fireAtWill)], ['o-run', some && sel.every(r => r.run)],
      ['o-tight', some && sel.every(r => r.formationMode === 'tight')], ['o-loose', some && sel.every(r => r.formationMode === 'loose')]]) $(id).classList.toggle('on', !!v);
    this.setIcon('o-fire', some && sel.every(r => !r.fireAtWill) ? 'hold' : 'fire');
    for (const id of ['o-halt', 'o-fire', 'o-run', 'o-tight', 'o-loose', 'o-attack']) $(id).classList.toggle('off', phase !== 'battle');
    // light company button: recall when a selected unit is a light company (or has one out), else detach (needs a selected line regiment with 60+ men)
    const recall = sel.some(r => r.def.light || lightOut(r));
    this.setIcon('o-light', recall ? 'recall' : 'detach');
    $('o-light').classList.toggle('on', sel.some(r => r.recall));
    $('o-light').classList.toggle('off', (phase !== 'battle' && phase !== 'deployment') || !(recall || sel.some(r => r.typeId === 'line' && r.men >= 60)));
    for (const id of ['g-pause', 'g-speed']) $(id).classList.toggle('off', phase !== 'battle');
    this.setIcon('g-pause', w.paused ? 'play' : 'pause');
    this.setIcon('g-speed', w.speed === 0.5 ? 'speedhalf' : w.speed >= 4 ? 'speed4' : w.speed >= 2 ? 'speed2' : 'speed1');
    this.drawMinimap();
  }

  drawMinimap() {
    const ctx = this.mctx, S = 200, k = S / MAP, w = this.w;
    ctx.drawImage(this.base, 0, 0);
    const X = (x) => (x + HALF) * k, Z = (z) => (z + HALF) * k;
    ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(VILLAGE.x), Z(VILLAGE.z), VILLAGE.r * k, 0, 6.3); ctx.stroke();
    const zn = this.game.zone;
    if (zn && this.game.phase === 'deployment') { ctx.strokeStyle = '#ffd060'; ctx.strokeRect(X(zn.x0), Z(zn.z0), (zn.x1 - zn.x0) * k, (zn.z1 - zn.z0) * k); }
    for (const r of w.regs) {
      if (r.state === 'gone') continue;
      ctx.fillStyle = r.state === 'routing' ? '#999' : SIDE_COLOR[r.side];
      const s = r.def.id === 'artillery' ? 3 : 4;
      ctx.fillRect(X(r.x) - s / 2, Z(r.z) - s / 2, s, s);
      if (r.selected) { ctx.strokeStyle = '#fff'; ctx.strokeRect(X(r.x) - 3.5, Z(r.z) - 3.5, 7, 7); }
    }
    // camera footprint
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => this.input.groundAtNDC(a, b));
    if (pts.every(Boolean)) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))); ctx.closePath(); ctx.stroke();
    }
  }

  showEnd(victory, text) {
    $('end-title').textContent = victory ? 'Victory' : 'Defeat';
    $('end-text').innerHTML = text;
    $('endscreen').style.display = 'flex';
    $('endscreen').style.pointerEvents = 'auto';
  }
}
