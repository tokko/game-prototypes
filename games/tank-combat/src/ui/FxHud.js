// Combat/mission HUD layer (DOM): world-anchored spotted/objective markers, outgoing hit markers with result text,
// incoming damage direction arcs + edge flash, objective banners (queued), and the mission-complete / tank-destroyed
// end screens (with working Restart). Visual rules follow spec/visual-hud.md sections 3.4, 11, 12 and 15.
import { Vector3 } from 'three';
import { wrapPi } from '../util/math.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const NS = 'http://www.w3.org/2000/svg';
const HIT_TEXT = { hit: 'HIT', nopen: 'NO PENETRATION', pen: 'PENETRATION', track: 'TRACK HIT', kill: 'TARGET DESTROYED' };

export class FxHud {
  constructor(root) {
    this.root = root;
    this.markerLayer = el('div', 'fx-markers', root);
    this.markers = new Map();
    this._v = new Vector3();

    // outgoing hit marker
    this.hm = el('div', 'hitmarker', root);
    this.hm.innerHTML = '<svg viewBox="-30 -30 60 60" width="60" height="60"><g stroke="currentColor" stroke-linecap="round"><path d="M-10,-10 L-18,-18"/><path d="M10,-10 L18,-18"/><path d="M-10,10 L-18,18"/><path d="M10,10 L18,18"/></g></svg>';
    this.hmText = el('div', 'hitmarker-text', root);
    this.hmT = 0;

    // incoming damage arcs
    this.edge = el('div', 'edgeflash', root);
    this.arcs = [];
    for (let i = 0; i < 4; i++) {
      const d = el('div', 'dmgarc', root);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '-200 -200 400 400'); svg.setAttribute('width', 400); svg.setAttribute('height', 400);
      const path = document.createElementNS(NS, 'path');
      const r = 180, a0 = (-25 * Math.PI) / 180, a1 = (25 * Math.PI) / 180;
      path.setAttribute('d', `M ${r * Math.sin(a0)} ${-r * Math.cos(a0)} A ${r} ${r} 0 0 1 ${r * Math.sin(a1)} ${-r * Math.cos(a1)}`);
      path.setAttribute('fill', 'none'); path.setAttribute('stroke-linecap', 'round');
      svg.appendChild(path); d.appendChild(svg);
      this.arcs.push({ el: d, path, t: 99, bearing: 0, pen: false });
    }
    this.arcIdx = 0;

    // missile launch warning (arrow points at the launcher relative to the view)
    this.warn = el('div', 'missilewarn', root);
    this.warnArrow = el('div', 'arrow', this.warn);
    el('div', 'txt', this.warn, 'MISSILE LAUNCH');
    this.warnT = 99; this.warnBearing = 0;

    // banner
    this.banner = el('div', 'banner', root);
    this.bLabel = el('div', 'bl', this.banner);
    el('div', 'br', this.banner);
    this.bText = el('div', 'bt', this.banner);
    this.bQueue = []; this.bT = -1; this.bGap = 0;

    // end screen
    el('div', 'deadvig', document.body);
    this.end = el('div', 'endscreen', document.body);
    this.ended = false;
  }

  // ---- markers: items { id, type: 'enemy' | 'hollow' | 'obj' | 'friend', x, y, z, label } ----
  setMarkers(items, camera, dist) {
    const W = window.innerWidth, H = window.innerHeight, seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let m = this.markers.get(it.id);
      if (!m) {
        const e = el('div', 'mk ' + it.type, this.markerLayer);
        el('i', '', e);
        const l = el('span', '', e);
        m = { e, l, type: it.type, born: performance.now() };
        this.markers.set(it.id, m);
      }
      if (m.type !== it.type) { m.e.className = 'mk ' + it.type; m.type = it.type; }
      const v = this._v.set(it.x, it.y, it.z).project(camera);
      let sx, sy, behind = v.z > 1;
      sx = (v.x * 0.5 + 0.5) * W; sy = (-v.y * 0.5 + 0.5) * H;
      let edge = false;
      if (it.type === 'obj') {
        if (behind) { sx = W - sx; sy = H - sy; }
        const mx = 70, my = 80;
        if (behind || sx < mx || sx > W - mx || sy < my || sy > H - my) {
          const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy;
          const k = Math.min((W / 2 - mx) / Math.max(1e-3, Math.abs(dx)), (H / 2 - my) / Math.max(1e-3, Math.abs(dy)));
          sx = cx + dx * Math.min(k, 1e6); sy = cy + dy * Math.min(k, 1e6);
          edge = true;
        }
      } else if (behind) { m.e.style.display = 'none'; continue; }
      m.e.style.display = '';
      m.e.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
      m.e.classList.toggle('edge', edge);
      const d = dist ? Math.round(dist(it)) : 0;
      const txt = it.noLabel ? '' : it.label ? it.label : d >= 50 ? d + ' m' : '';
      if (m.txt !== txt) { m.txt = txt; m.l.textContent = txt; }
      m.e.classList.toggle('fresh', performance.now() - m.born < 260);
    }
    for (const [id, m] of this.markers) if (!seen.has(id)) { m.e.remove(); this.markers.delete(id); }
  }

  // ---- outgoing hit marker ----
  hitMarker(type) {
    const cls = type === 'kill' ? 'kill' : type === 'pen' || type === 'track' ? 'pen' : 'hit';
    this.hm.className = 'hitmarker show ' + cls;
    this.hmText.className = 'hitmarker-text show ' + (type === 'kill' ? 'kill' : type === 'nopen' ? 'dim' : '');
    this.hmText.textContent = HIT_TEXT[type] || 'HIT';
    this.hmT = type === 'kill' ? 1.6 : 1.3;
    void this.hm.offsetWidth; // restart animation
    this.hm.classList.add('go'); this.hmText.classList.add('go');
  }

  missileLaunch(dx, dz) {
    this.warnBearing = Math.atan2(dx, dz); this.warnT = 0;
    this.warn.classList.remove('go'); void this.warn.offsetWidth; this.warn.classList.add('go');
  }

  // ---- incoming damage: direction from the player to the source (world x/z) ----
  damageDir(dx, dz, penetrating) {
    const bearing = Math.atan2(dx, dz);
    let a = this.arcs.find((q) => q.t < 0.5 && Math.abs(wrapPi(q.bearing - bearing)) < 0.35);
    if (!a) a = this.arcs[this.arcIdx++ % 4];
    a.t = 0; a.bearing = bearing; a.pen = penetrating;
    a.path.setAttribute('stroke', penetrating ? 'rgb(229,55,46)' : 'rgba(241,241,236,0.7)');
    a.path.setAttribute('stroke-width', penetrating ? 6 : 3);
    if (penetrating) { this.edge.classList.remove('go'); void this.edge.offsetWidth; this.edge.classList.add('go'); }
  }

  update(dt, camYaw) {
    if (this.hmT > 0) {
      this.hmT -= dt;
      if (this.hmT <= 0) { this.hm.className = 'hitmarker'; this.hmText.className = 'hitmarker-text'; }
    }
    for (const a of this.arcs) {
      if (a.t > 3) { if (a.el.style.opacity !== '0') a.el.style.opacity = '0'; continue; }
      a.t += dt;
      const op = a.t < 0.3 ? 1 : Math.max(0, 1 - (a.t - 0.3) / 1.3) ** 1.6;
      const rel = wrapPi(a.bearing - camYaw); // our yaw increases to the left; screen rotation is clockwise
      a.el.style.opacity = op.toFixed(3);
      a.el.style.transform = `translate(-50%,-50%) rotate(${(-rel).toFixed(4)}rad)`;
    }
    if (this.warnT < 4.5) {
      this.warnT += dt;
      if (this.warnT >= 4.5) this.warn.classList.remove('go');
      else this.warnArrow.style.transform = `rotate(${(-wrapPi(this.warnBearing - camYaw)).toFixed(4)}rad)`;
    }
    // banner queue
    if (this.bT >= 0) {
      this.bT += dt;
      if (this.bT > 0.25 + 3.5 + 0.4) { this.banner.classList.remove('show'); this.bT = -1; this.bGap = 0.2; }
    } else {
      this.bGap -= dt;
      if (this.bGap <= 0 && this.bQueue.length) {
        const b = this.bQueue.shift();
        this.bLabel.textContent = b.label; this.bText.textContent = b.text;
        this.banner.className = 'banner show ' + (b.kind || '');
        this.bT = 0;
      }
    }
  }

  notify(label, text, kind) { this.bQueue.push({ label, text, kind }); }

  // ---- end screens ----
  showEnd({ win, stats, onRestart }) {
    if (this.ended) return;
    this.ended = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const e = this.end;
    const rows = [['Time', stats.time], ['Shots fired', stats.shots], ['Hits', stats.hits], ['Enemies destroyed', stats.kills], ['Objectives', stats.objectives]];
    e.innerHTML = '';
    e.className = 'endscreen ' + (win ? 'win' : 'lose');
    const box = el('div', 'box', e);
    el('div', 'head', box, win ? 'MISSION COMPLETE' : 'TANK DESTROYED');
    el('div', 'rule', box);
    const tb = el('div', 'stats', box);
    rows.forEach((r, i) => { const row = el('div', 'row', tb); row.style.animationDelay = (0.9 + i * 0.06) + 's'; el('span', '', row, r[0]); el('b', '', row, String(r[1])); });
    const btn = el('button', 'restart', box, 'RESTART');
    btn.addEventListener('click', () => onRestart());
    const hint = el('div', 'hint', box); hint.innerHTML = '<kbd>Enter</kbd> to restart';
    this._key = (ev) => { if (ev.code === 'Enter') onRestart(); };
    window.addEventListener('keydown', this._key);
    requestAnimationFrame(() => e.classList.add('show'));
  }
}
