// DOM/canvas HUD in the reference style: mission list, compass tape, gear/rpm/speed, ammo slots,
// minimap host, reticle + gun marker, gunner optics overlay, controls overlay.
import './hud.css';
import { AMMO } from '../combat/Ammo.js';
import { smoothstep } from '../util/math.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// ---- ammo icons (canvas drawn, white silhouettes like the reference) ----
export function drawAmmoIcon(canvas, id) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = 32, H = 36;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.clearRect(0, 0, W, H);
  const white = '#f2f2ec', mid = '#b9b9b0', dark = 'rgba(0,0,0,0.5)';
  const round = (x, w, topY, bodyEnd, tip) => {
    // projectile body: ogive nose from topY, straight to bodyEnd
    c.fillStyle = white;
    c.beginPath();
    c.moveTo(x - w, bodyEnd);
    c.lineTo(x - w, topY + tip);
    c.quadraticCurveTo(x - w, topY + tip * 0.35, x, topY);
    c.quadraticCurveTo(x + w, topY + tip * 0.35, x + w, topY + tip);
    c.lineTo(x + w, bodyEnd);
    c.closePath(); c.fill();
  };
  const casing = (x, w, y0, y1) => {
    c.fillStyle = mid; c.fillRect(x - w, y0, w * 2, y1 - y0);
    c.fillStyle = dark; c.fillRect(x - w, y0, w * 2, 1.2);
    c.fillStyle = white; c.fillRect(x - w - 1, y1 - 2.5, w * 2 + 2, 2.5);
  };
  if (id === 'APFSDS') {
    // long dart with fins, sabot ring and case
    c.fillStyle = white;
    c.beginPath(); c.moveTo(16, 1); c.lineTo(17.4, 14); c.lineTo(14.6, 14); c.closePath(); c.fill();
    c.fillRect(14.6, 13, 2.8, 12);
    c.beginPath(); c.moveTo(14.6, 24); c.lineTo(11, 29); c.lineTo(14.6, 27); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(17.4, 24); c.lineTo(21, 29); c.lineTo(17.4, 27); c.closePath(); c.fill();
    c.fillStyle = mid; c.fillRect(11.5, 14, 9, 3.5); c.fillRect(12, 17.5, 8, 1.5);
    casing(16, 5.5, 20, 35);
  } else if (id === 'HEAT') {
    c.fillStyle = white; c.fillRect(15.5, 0.5, 1, 6); // stand-off probe
    round(16, 5, 5.5, 22, 11);
    c.fillStyle = dark; c.fillRect(11, 17, 10, 1.2);
    casing(16, 5.5, 22, 35);
  } else if (id === 'HE') {
    round(16, 5.5, 2, 22, 13);
    c.fillStyle = dark; c.fillRect(10.5, 15, 11, 1.4); c.fillRect(10.5, 18, 11, 1.4);
    casing(16, 5.5, 22, 35);
  } else {
    // smoke: blunt nose + canister with puffs
    c.fillStyle = white;
    c.beginPath(); c.moveTo(10.5, 22); c.lineTo(10.5, 9); c.quadraticCurveTo(10.5, 4.5, 16, 4.5); c.quadraticCurveTo(21.5, 4.5, 21.5, 9); c.lineTo(21.5, 22); c.closePath(); c.fill();
    c.fillStyle = dark; for (let i = 0; i < 4; i++) c.fillRect(10.5, 10 + i * 3.4, 11, 1.1);
    c.fillStyle = mid;
    c.beginPath(); c.arc(7, 4.5, 3, 0, 6.3); c.arc(11, 2.2, 2.6, 0, 6.3); c.arc(24.5, 3.5, 3.2, 0, 6.3); c.fill();
    casing(16, 5.5, 22, 35);
  }
}

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class HUD {
  constructor(root) {
    this.root = root;
    const scale = () => document.documentElement.style.setProperty('--s', Math.min(2.2, Math.max(0.95, (window.innerHeight / 900) * 1.3)).toFixed(3));
    scale(); window.addEventListener('resize', scale);
    this.cache = {};
    this.toastTimer = 0;

    // mission
    this.missionEl = el('div', 'mission fade', root);
    // compass
    this.compassEl = el('div', 'compass fade', root);
    this.compassCanvas = el('canvas', '', this.compassEl);
    // gear block
    this.gearEl = el('div', 'gear fade', root);
    this.gearLine = el('div', '', this.gearEl);
    this.rpmLine = el('div', '', this.gearEl);
    this.spdLine = el('div', '', this.gearEl);
    const hull = el('div', 'hull', this.gearEl);
    el('span', '', hull, 'HULL');
    const bar = el('div', 'bar', hull);
    this.hullBar = el('i', '', bar);
    // ammo slots
    this.ammoEl = el('div', 'ammo fade', root);
    const slots = el('div', 'slots', this.ammoEl);
    this.slots = AMMO.map((a, i) => {
      const s = el('div', 'slot', slots);
      el('span', 'k', s, String(i + 1));
      const c = el('span', 'c', s, '0');
      const cv = el('canvas', '', s);
      drawAmmoIcon(cv, a.id);
      el('span', 'n', s, a.name);
      return { s, c };
    });
    const ld = el('div', 'loading', this.ammoEl);
    const lbar = el('div', 'bar', ld);
    this.loadBar = el('i', '', lbar);
    this.loadText = el('div', 'st', ld, 'READY');
    this.auxEl = el('div', 'aux', this.ammoEl);
    this.mgText = el('span', '', this.auxEl);
    this.smokeText = el('span', '', this.auxEl);
    // minimap host
    this.minimapEl = el('div', 'minimap fade', root);
    this.headingEl = el('div', 'hdg', this.minimapEl);
    // reticle + gun marker
    this.reticle = el('div', 'reticle', root);
    this.gunMark = el('div', 'gunmark off', root);
    // optics
    this.optics = el('div', 'optics', root);
    this.opticsCanvas = el('canvas', '', this.optics);
    el('div', 'vig', this.optics);
    this.rangeEl = el('div', 'range', this.optics, '----');
    this.magEl = el('div', 'mag', this.optics, '6.0x');
    const ol = el('div', 'olist', this.optics);
    this.orows = AMMO.map((a, i) => {
      const r = el('div', 'orow', ol);
      el('span', 'k', r, String(i + 1));
      el('span', 'nm', r, a.name);
      const ct = el('span', 'ct', r, '0');
      return { r, ct };
    });
    this.ostatus = el('div', 'ostatus', ol, 'READY');
    // toast
    this.toastEl = el('div', 'toast', root);
    // overlay
    this._buildOverlay();

    this.setMission({
      title: 'Operation Iron Meadow',
      primary: { text: 'Reach the observation hill', done: false },
      optional: [{ text: 'Optional: Scout the village', done: false }],
    });
  }

  _buildOverlay() {
    const ov = el('div', 'overlay', document.body);
    const card = el('div', 'card', ov);
    el('h1', '', card, 'Tank Combat Sim');
    this.playText = el('div', 'play wait', card, 'Generating terrain...');
    const grid = el('div', 'grid', card);
    const rows = [
      ['W / S', 'Throttle / reverse'], ['A / D', 'Steer hull'], ['Space', 'Hand brake'],
      ['Mouse', 'Aim turret and camera'], ['Left click', 'Fire cannon'], ['Right click', 'Gunner optics on / off'],
      ['Wheel', 'Magnification 3x - 12x'], ['1 - 4', 'Select ammunition'],
      ['Hold C', 'Coaxial machine gun'], ['X', 'Smoke launcher'], ['Esc', 'Release mouse / pause'],
    ];
    for (const [k, d] of rows) { const r = el('div', 'row', grid); el('kbd', '', r, k); el('span', '', r, d); }
    const roles = el('div', 'roles', card);
    for (const a of AMMO) { const r = el('div', '', roles); el('b', '', r, a.key + '  ' + a.name); el('span', '', r, a.good); }
    { const r = el('div', '', roles); el('b', '', r, 'C  COAX MG'); el('span', '', r, 'Infantry and missile teams. Useless against armour.'); }
    el('div', 'hint', card, 'Mouse is captured while playing');
    this.overlay = ov;
  }

  setOverlayReady() {
    this.playText.textContent = 'Click to play';
    this.playText.classList.remove('wait');
  }

  showOverlay(v) { this.overlay.classList.toggle('hidden', !v); }

  // mission = { title, primary: { text, done }, optional: [{ text, done }] }
  setMission(m, opts = {}) {
    this.mission = m;
    const e = this.missionEl;
    e.textContent = '';
    if (m.title) el('div', 'title', e, m.title);
    el('div', 'primary' + (m.primary.done ? ' done' : '') + (opts.isNew ? ' new' : ''), e, m.primary.text);
    for (const o of m.optional || []) {
      const r = el('div', 'opt' + (o.done ? ' done' : '') + (o.isNew && opts.newOptional ? ' new' : ''), e);
      el('span', 'box', r);
      el('span', '', r, o.text);
    }
  }

  toast(text, seconds = 2) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  _set(key, node, text) {
    if (this.cache[key] !== text) { this.cache[key] = text; node.textContent = text; }
  }

  _compass(deg) {
    const cv = this.compassCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 360, H = 34;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const pxPerDeg = 2.7;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 3; c.shadowOffsetY = 1;
    for (let k = -80; k <= 80; k++) {
      const d = Math.round(deg) + k;
      if (d % 5 !== 0) continue;
      const x = W / 2 + (d - deg) * pxPerDeg;
      const dd = ((d % 360) + 360) % 360;
      if (dd % 15 === 0) {
        const card = dd % 45 === 0;
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.font = card ? '600 13px "Segoe UI", Arial, sans-serif' : '12px "Segoe UI", Arial, sans-serif';
        c.fillText(card ? CARD[dd / 45] : String(dd), x, 11);
        c.fillRect(x - 0.5, 20, 1, 5);
      } else {
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(x - 0.5, 20, 1, 3);
      }
    }
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(W / 2 - 4, 28); c.lineTo(W / 2 + 4, 28); c.lineTo(W / 2, 33); c.closePath(); c.fill();
  }

  _crosshair(vFovDeg) {
    const cv = this.opticsCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    const pxPerMil = H / ((vFovDeg * Math.PI) / 180 * 1000);
    const gap = 9;
    const draw = (style, lw, extra) => {
      c.strokeStyle = style; c.lineWidth = lw; c.beginPath();
      c.moveTo(0, cy); c.lineTo(cx - gap, cy); c.moveTo(cx + gap, cy); c.lineTo(W, cy);
      c.moveTo(cx, 0); c.lineTo(cx, cy - gap); c.moveTo(cx, cy + gap); c.lineTo(cx, H);
      if (extra) {
        // mil ticks on both axes
        const maxMil = Math.max(W, H) / 2 / pxPerMil;
        for (let m = 5; m <= maxMil; m += 5) {
          const len = m % 10 === 0 ? 8 : 4.5;
          const o = m * pxPerMil;
          for (const s of [-1, 1]) {
            c.moveTo(cx + s * o, cy - len); c.lineTo(cx + s * o, cy + len);
            c.moveTo(cx - len, cy + s * o); c.lineTo(cx + len, cy + s * o);
          }
        }
        // centre dot
        c.moveTo(cx + 1.5, cy); c.arc(cx, cy, 1.5, 0, 6.3);
      }
      c.stroke();
    };
    draw('rgba(255,255,255,0.22)', 3.2, false);
    draw('rgba(8,8,8,0.88)', 1.1, true);
  }

  // s: state object filled by the game each frame
  update(dt, s) {
    this._set('gear', this.gearLine, 'GEAR ' + s.gear);
    this._set('rpm', this.rpmLine, 'RPM ' + (Math.round(s.rpm / 10) * 10));
    this._set('spd', this.spdLine, 'SPD ' + Math.round(s.speed) + ' km/h');
    const hp = Math.max(0, Math.round((s.hull / s.hullMax) * 100));
    if (this.cache.hp !== hp) {
      this.cache.hp = hp;
      this.hullBar.style.width = hp + '%';
      this.hullBar.className = hp < 25 ? 'crit' : hp < 55 ? 'low' : '';
    }
    this._set('hdg', this.headingEl, String(Math.round(s.hullHeading) % 360).padStart(3, '0') + '°');

    // ammo slots
    for (let i = 0; i < AMMO.length; i++) {
      const sl = this.slots[i], count = s.counts[i];
      this._set('c' + i, sl.c, String(count));
      const cls = 'slot' + (s.selected === i ? ' sel' : '') + (s.chambered === i ? ' loaded' : '') + (count <= 0 ? ' empty' : '');
      if (this.cache['sl' + i] !== cls) { this.cache['sl' + i] = cls; sl.s.className = cls; }
      const row = this.orows[i];
      this._set('oc' + i, row.ct, String(count));
      const rc = 'orow' + (s.chambered === i ? ' loaded' : '') + (s.selected === i ? ' sel' : '') + (count <= 0 ? ' empty' : '');
      if (this.cache['or' + i] !== rc) { this.cache['or' + i] = rc; row.r.className = rc; }
    }
    const ready = s.chambered >= 0;
    const frac = Math.round(s.loadFrac * 100);
    this.loadBar.style.width = frac + '%';
    const stText = ready ? 'READY' : s.loadingIdx >= 0 ? 'LOADING ' + AMMO[s.loadingIdx].name : 'NO AMMO';
    this._set('st', this.loadText, stText);
    this.loadText.className = 'st' + (ready ? ' ready' : '');
    const ost = ready ? 'READY' : s.loadingIdx >= 0 ? 'LOADING ' + frac + '%' : 'OUT OF AMMO';
    this._set('ost', this.ostatus, ost);
    this.ostatus.className = 'ostatus' + (ready ? ' ready' : '');
    this._set('mg', this.mgText, 'C  COAX MG ' + s.mgBelt);
    this._set('sm', this.smokeText, 'X  SMOKE ' + s.smokeCharges + (s.smokeCooldown > 0 ? ' (' + Math.ceil(s.smokeCooldown) + ')' : ''));

    // view heading tape
    const hd = Math.round(s.viewHeading * 4) / 4;
    if (this.cache.hd !== hd) { this.cache.hd = hd; this._compass(hd); }

    // optics visibility
    const o = smoothstep(0.45, 1.0, s.opticsAmount);
    const hudA = 1 - smoothstep(0.1, 0.6, s.opticsAmount);
    this.optics.style.opacity = o.toFixed(3);
    for (const e of [this.missionEl, this.compassEl, this.gearEl, this.ammoEl, this.minimapEl]) e.style.opacity = hudA.toFixed(3);
    this.reticle.style.opacity = (1 - smoothstep(0.1, 0.5, s.opticsAmount)).toFixed(3);
    if (o > 0.02) {
      this._set('mag', this.magEl, s.mag.toFixed(1) + 'x');
      this._set('rng', this.rangeEl, s.rangeText);
      const fk = Math.round(s.fov * 100);
      if (this.cache.fk !== fk || this.cache.sz !== window.innerWidth + 'x' + window.innerHeight) {
        this.cache.fk = fk; this.cache.sz = window.innerWidth + 'x' + window.innerHeight;
        this._crosshair(s.fov);
      }
    }

    // gun marker (predicted fall of shot)
    const gm = this.gunMark;
    if (s.marker.visible) {
      gm.classList.remove('off');
      gm.style.transform = 'translate3d(' + s.marker.x.toFixed(1) + 'px,' + s.marker.y.toFixed(1) + 'px,0)';
    } else gm.classList.add('off');

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
