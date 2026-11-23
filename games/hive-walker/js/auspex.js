import * as THREE from 'three';
import { angDiff } from './util.js?v=32';
import { tpos, tAlive } from './loadout.js?v=32';
import { GLYPH, CSS, CSSN } from './objectives.js?v=32';

// Auspex: a round, heading-up tactical plot drawn on a 2D canvas a dozen times a second. "Up" is where the torso is aimed.
// Buildings are painted as footprints, everything else as glyphs: squads (dots), armour (squares), scout engines (diamonds),
// colossi (large chevrons with facing), aircraft (crosses). Threat pings ring whatever is about to hurt the player.
const PX = 2, SIZE = 224, R_SITE = 60;                 // metres shown to the rim; canvas pixels per CSS pixel; CSS size
const ALLY = '#7dffb8', FOE = '#ff5a36', BASE = 'rgba(96,255,160,';

export class Auspex {
  constructor(G, id = 'auspexCv', size = SIZE) {   // a second instance on #tacCv is the tactical view's large map
    this.G = G; this.t = 0; this.acc = 1; this.size = size; this.gs = size === SIZE ? 1 : 1.6; this.tf = null; this.big = size !== SIZE;
    this.cv = document.getElementById(id); this.cv.width = this.cv.height = size * PX;
    this.cx = this.cv.getContext('2d');
  }
  toWorld(X, Y) { const t = this.tf; if (!t) return null; const det = t.A * t.D - t.B * t.C, dx = X - t.E, dy = Y - t.F; return { x: (t.D * dx - t.C * dy) / det, z: (-t.B * dx + t.A * dy) / det }; }
  toMap(x, z) { const t = this.tf; return t ? { x: t.A * x + t.C * z + t.E, y: t.B * x + t.D * z + t.F } : null; }
  update(dt) {
    this.t += dt; this.acc += dt; if (this.acc < 0.08) return; this.acc = 0;
    const G = this.G, c = this.cx, pl = G.player, R = pl.C.auspex * (pl.headDead ? 0.5 : 1), W = this.size * PX, h = W / 2, gs = this.gs, s = (h - 6) / R, a = pl.aimYaw, ca = Math.cos(a), sa = Math.sin(a);
    const px = pl.pos.x, pz = pl.pos.z, blink3 = Math.sin(this.t * 18.85) > 0, blink4 = Math.sin(this.t * 25.1) > 0, blink = Math.sin(this.t * 14) > 0, pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, W);
    c.save(); c.beginPath(); c.arc(h, h, h - 2, 0, 6.2832); c.clip();
    c.fillStyle = 'rgba(2,14,8,0.78)'; c.fillRect(0, 0, W, W);
    // world -> plot, torso aim up
    const A = -ca * s, B = -sa * s, C = sa * s, D = -ca * s, E = h - (A * px + C * pz), F = h - (B * px + D * pz);
    const X = (x, z) => A * x + C * z + E, Y = (x, z) => B * x + D * z + F;
    // building footprints (standing: filled; fallen: faint outline)
    c.setTransform(A, B, C, D, E, F);
    c.fillStyle = BASE + '0.26)'; c.strokeStyle = BASE + '0.6)'; c.lineWidth = 1.2 / s;
    for (const b of G.city.buildings) {
      if (Math.abs(b.x - px) > R + 40 || Math.abs(b.z - pz) > R + 40) continue;
      if (b.alive) { c.fillRect(b.x - b.hw, b.z - b.hd, b.hw * 2, b.hd * 2); c.strokeRect(b.x - b.hw, b.z - b.hd, b.hw * 2, b.hd * 2); }
      else { c.save(); c.strokeStyle = BASE + '0.18)'; c.strokeRect(b.x - b.hw, b.z - b.hd, b.hw * 2, b.hd * 2); c.restore(); }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    // range rings + bearing ticks
    c.strokeStyle = BASE + '0.22)'; c.lineWidth = 1;
    for (const r of [R / 3, R * 2 / 3]) { c.beginPath(); c.arc(h, h, r * s, 0, 6.2832); c.stroke(); }
    c.beginPath(); for (let k = 0; k < 12; k++) { const t = k * Math.PI / 6; c.moveTo(h + Math.sin(t) * (h - 12), h - Math.cos(t) * (h - 12)); c.lineTo(h + Math.sin(t) * (h - 4), h - Math.cos(t) * (h - 4)); } c.stroke();
    // aim cone (always up) and leg heading
    c.fillStyle = BASE + '0.10)'; c.beginPath(); c.moveTo(h, h); c.arc(h, h, h - 4, -Math.PI / 2 - 0.2, -Math.PI / 2 + 0.2); c.closePath(); c.fill();
    c.strokeStyle = BASE + '0.5)'; c.beginPath(); c.moveTo(h, h); c.lineTo(h, 8); c.stroke();
    const glyph = (x, y, r, col, shape, rot = 0) => {
      r *= PX * gs; c.fillStyle = col; c.strokeStyle = col;
      if (shape === 0) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); }
      else if (shape === 1) c.fillRect(x - r, y - r, r * 2, r * 2);
      else if (shape === 2) { c.beginPath(); c.moveTo(x, y - r * 1.35); c.lineTo(x + r, y); c.lineTo(x, y + r * 1.35); c.lineTo(x - r, y); c.closePath(); c.fill(); }
      else if (shape === 3) { c.save(); c.translate(x, y); c.rotate(rot); c.beginPath(); c.moveTo(0, -r * 1.5); c.lineTo(r, r); c.lineTo(0, r * 0.45); c.lineTo(-r, r); c.closePath(); c.fill(); c.restore(); }
      else { c.lineWidth = 2; c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.stroke(); }
    };
    const ring = (x, y, r, col, w = 2) => { r *= PX * gs; c.strokeStyle = col; c.lineWidth = w * PX * 0.6; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.stroke(); };
    const tag = (x, y, r, e) => {   // a Synod heavy's battle plan letter (H / B / S) and a CRIPPLED / DISARMED status word
      const w = e.cl ? 'CRIPPLED' : e.ca ? 'DISARMED' : '', L = e.side === 1 && e.plan ? e.plan : ''; if (!w && !L) return;
      r *= PX * gs; c.fillStyle = e.side ? '#ffd0b8' : '#c8ffe0'; c.font = 'bold ' + 8 * PX * gs + 'px Consolas, monospace'; c.textBaseline = 'middle';
      if (L) { c.textAlign = 'left'; c.fillText(L, x + r * 1.15, y - r * 0.9); } if (w) { c.textAlign = 'center'; c.fillStyle = '#ffb040'; c.fillText(w, x, y + r * 1.9); }
    };
    const inR = (x, z) => (x - px) * (x - px) + (z - pz) * (z - pz) < R * R;
    const u = G.units;
    // objective sites (model/objectives-visual.md 8.3): the true 60 m ring in the owner's colour, a progress arc inside it, a glyph on a dark disc; anchors on the Tab map show their 300 m reach; live artillery markers
    const O = G.objectives, GP = {}; for (const k in GLYPH) GP[k] = new Path2D(GLYPH[k]);
    for (const o of O.sites) {
      const own = o.owner === null ? CSSN : CSS[o.owner], ring = o.contested ? (blink3 ? CSS[0] : CSS[1]) : own, f = Math.abs(o.p) / 100; let x = X(o.x, o.z), y = Y(o.x, o.z); const dx = x - h, dy = y - h, d = Math.hypot(dx, dy);
      if (d > h - 12) { if (!this.big) { x = h + dx / d * (h - 12 - 4 * PX); y = h + dy / d * (h - 12 - 4 * PX); c.fillStyle = own; c.font = 'bold ' + 9 * PX + 'px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.id, x, y); } continue; }
      c.save(); c.globalAlpha = 0.85; c.strokeStyle = ring; c.lineWidth = 2 * PX * 0.6; c.beginPath(); c.arc(x, y, R_SITE * s, 0, 6.2832); c.stroke();
      if (f > 0.003) { c.globalAlpha = f > 0.995 ? 0.5 : 0.85; c.strokeStyle = CSS[o.p > 0 ? 0 : 1]; c.lineWidth = 3 * PX * 0.6; c.beginPath(); c.arc(x, y, R_SITE * s - 3 * PX, -Math.PI / 2, -Math.PI / 2 + f * 6.2832); c.stroke(); }
      if (this.big && o.owner === pl.side && o.type === 'anchor') { c.globalAlpha = 0.35; c.lineWidth = 1 * PX; c.setLineDash([2 * PX, 6 * PX]); c.beginPath(); c.arc(x, y, 300 * s, 0, 6.2832); c.stroke(); }
      c.restore();
      const gk = 14 / 16 * PX * gs, rd = 9 * PX * gs; c.fillStyle = 'rgba(2,14,8,0.85)'; c.beginPath(); c.arc(x, y, rd, 0, 6.2832); c.fill();
      c.save(); c.translate(x, y); c.scale(gk, gk); c.translate(-8, -8); c.strokeStyle = own; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke(GP[o.type]); c.restore();
      c.fillStyle = own; c.font = 'bold ' + 8 * PX * gs + 'px Consolas, monospace'; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(o.id, x + rd * 0.8, y - rd * 0.6);
    }
    if (O.bar) for (const p of O.bar.pts) if (p.t0 !== undefined && !p.done && blink4 && inR(p.x, p.z)) { const x = X(p.x, p.z), y = Y(p.x, p.z), r = 5 * PX * gs / 2; c.strokeStyle = CSS[O.bar.side]; c.lineWidth = 2; c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.stroke(); }
    // infantry squads
    for (const q of u.squads) {
      if (q.alive <= 0 || !inR(q.lane, q.z)) continue; const x = X(q.lane, q.z), y = Y(q.lane, q.z);
      glyph(x, y, 2 + q.alive * 0.16, q.side ? FOE : ALLY, 0);
      if (q.melta && q.side === 1 && (q.lane - px) ** 2 + (q.z - pz) ** 2 < 110 * 110) ring(x, y, 7 + pulse * 5, G.meltaWarn > 0 && !blink ? '#fff0b0' : '#ffb040');   // fusion-lance team in reach
    }
    for (const t of u.tanks) if (t.alive && inR(t.x, t.z)) glyph(X(t.x, t.z), Y(t.x, t.z), 3.4, t.side ? FOE : ALLY, 1);
    for (const sc of G.scouts.list) {
      if (sc.state !== 'alive' || !inR(sc.pos.x, sc.pos.z)) continue; const x = X(sc.pos.x, sc.pos.z), y = Y(sc.pos.x, sc.pos.z);
      glyph(x, y, 5.5, sc.side ? FOE : ALLY, 2);
      if (sc.side === 1 && sc.tgt === pl) ring(x, y, 9 + pulse * 4, '#ff5a36');                                   // hunting you
    }
    for (const ac of G.air.list) if (ac.alive && !ac.falling && inR(ac.pos.x, ac.pos.z)) glyph(X(ac.pos.x, ac.pos.z), Y(ac.pos.x, ac.pos.z), 4, ac.side ? '#ff9a70' : '#b8ffe0', 4);
    // colossi: big, with facing; pinned to the rim when out of range
    for (const col of G.colossi) {
      if ((col.state !== 'alive' && col.state !== 'dying') || col.piloted) continue;
      let x = X(col.pos.x, col.pos.z), y = Y(col.pos.x, col.pos.z); const dx = x - h, dy = y - h, d = Math.hypot(dx, dy), out = d > h - 14;
      if (out) { x = h + dx / d * (h - 14); y = h + dy / d * (h - 14); }
      c.globalAlpha = out ? 0.55 : 1; glyph(x, y, out ? 7 : 11, col.side ? FOE : ALLY, 3, a - col.torsoYaw); c.globalAlpha = 1; tag(x, y, out ? 7 : 11, col);
      if (G.threat && G.threat.col === col) {                                                                    // it has seen you
        ring(x, y, 16 + pulse * 8, '#ff3018', 3); c.strokeStyle = blink ? '#ff3018' : 'rgba(255,48,24,0.3)'; c.lineWidth = 2; c.setLineDash([8, 6]); c.beginPath(); c.moveTo(x, y); c.lineTo(h, h); c.stroke(); c.setLineDash([]);
      }
    }
    // hierarchs: the colossus chevron at ~0.65x, with facing
    for (const hh of G.hierarchs) {
      if ((hh.state !== 'alive' && hh.state !== 'dying') || hh.piloted) continue;
      let x = X(hh.pos.x, hh.pos.z), y = Y(hh.pos.x, hh.pos.z); const dx = x - h, dy = y - h, d = Math.hypot(dx, dy), out = d > h - 14;
      if (out) { x = h + dx / d * (h - 14); y = h + dy / d * (h - 14); }
      c.globalAlpha = out ? 0.55 : 1; glyph(x, y, out ? 4.5 : 7, hh.side ? FOE : ALLY, 3, a - hh.torsoYaw); c.globalAlpha = 1; tag(x, y, out ? 4.5 : 7, hh);
      if (G.threat && G.threat.col === hh) {
        ring(x, y, 11 + pulse * 6, '#ff3018', 3); c.strokeStyle = blink ? '#ff3018' : 'rgba(255,48,24,0.3)'; c.lineWidth = 2; c.setLineDash([8, 6]); c.beginPath(); c.moveTo(x, y); c.lineTo(h, h); c.stroke(); c.setLineDash([]);
      }
    }
    // harrows: the colossus chevron at ~0.5x, with facing
    for (const hh of G.harrows) {
      if ((hh.state !== 'alive' && hh.state !== 'dying') || hh.piloted) continue;
      let x = X(hh.pos.x, hh.pos.z), y = Y(hh.pos.x, hh.pos.z); const dx = x - h, dy = y - h, d = Math.hypot(dx, dy), out = d > h - 14;
      if (out) { x = h + dx / d * (h - 14); y = h + dy / d * (h - 14); }
      c.globalAlpha = out ? 0.55 : 1; glyph(x, y, out ? 3.5 : 5.5, hh.side ? FOE : ALLY, 3, a - hh.torsoYaw); c.globalAlpha = 1; tag(x, y, out ? 3.5 : 5.5, hh);
      if (G.threat && G.threat.col === hh) {
        ring(x, y, 9 + pulse * 5, '#ff3018', 3); c.strokeStyle = blink ? '#ff3018' : 'rgba(255,48,24,0.3)'; c.lineWidth = 2; c.setLineDash([8, 6]); c.beginPath(); c.moveTo(x, y); c.lineTo(h, h); c.stroke(); c.setLineDash([]);
      }
    }
    // bastions, ward generators and guns, painted fire zones, and the arm locks
    const _v = this._v || (this._v = new THREE.Vector3()), un = pl.heavy ? pl.unit : null;
    for (const st of G.structs) { if (!st.alive || st.kind === 'site' || !inR(st.pos.x, st.pos.z)) continue; const sz = (st.kind === 'bastion' ? 7 : st.kind === 'gen' ? 5 : 2.4) * PX * gs, x = X(st.pos.x, st.pos.z), y = Y(st.pos.x, st.pos.z); c.strokeStyle = st.side ? FOE : ALLY; c.lineWidth = 2; c.strokeRect(x - sz, y - sz, 2 * sz, 2 * sz); }
    if (un) {
      c.strokeStyle = pl.side === 1 ? '#5cff6a' : '#ffb23c'; c.lineWidth = 2; c.setLineDash([6, 4]);   // the faction glow
      for (const z of G.zonePreview ? un.zones.concat([G.zonePreview]) : un.zones) { c.beginPath(); c.arc(X(z.x, z.z), Y(z.x, z.z), z.r * s, 0, 6.2832); c.stroke(); }
      c.setLineDash([]);
      for (const a of ['L', 'R']) { const l = un.lock[a]; if (!l || !tAlive(l)) continue; tpos(l, _v); const x = X(_v.x, _v.z), y = Y(_v.x, _v.z), col = a === 'L' ? '#ffc93c' : '#c59bff'; c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.moveTo(h, h); c.lineTo(x, y); c.stroke(); ring(x, y, 9, col, 2); }
    }
    if (un && G.orders) G.orders.drawMap(c, X, Y, h, this.big, gs, PX);   // order markers (and, on the Tab map, the lines from each group)
    this.tf = { A, B, C, D, E, F, W, s, px, pz, R };
    // own engine: leg heading arrow under the aim line
    c.save(); c.translate(h, h); c.rotate(angDiff(a, pl.legYaw)); c.fillStyle = '#ffe0a0'; c.beginPath(); c.moveTo(0, -15 * PX); c.lineTo(7 * PX, 8 * PX); c.lineTo(0, 3 * PX); c.lineTo(-7 * PX, 8 * PX); c.closePath(); c.fill(); c.restore();
    // north (the burning hive lies north, -Z)
    { const t = a - Math.PI, x = h + Math.sin(t) * (h - 20), y = h - Math.cos(t) * (h - 20); c.fillStyle = '#ffe0a0'; c.font = 'bold ' + (11 * PX) + 'px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', x, y); }
    c.restore();
  }
}
