import * as THREE from 'three';
import { LANES } from './city.js?v=32';
import { flankPoint, HITR } from './heavy.js?v=32';

// Crosshair orders (model/princeps-spec.md section 1), for the heavy classes only. The player's allies form four groups; F issues the context order at the crosshair (or the Tab cursor),
// 1-4 held with F sends it to one group, R is ON ME, V stands down. Each group has at most one order and a new one replaces it; orders end on their own rules (KILL: target dead / crippled /
// beyond 900 m, CLEAR: 10 s with no foe within 60 m, TAKE and HOLD: 60 s after the capture); a group without an order follows the objective director. Orders never select individual units.
const GN = ['WING', 'LANCE', 'ARMOUR', 'COHORT'], GCOL = ['#6fd8ff', '#ffcf4a', '#ff8a50', '#b9ff7a'], GHDR = [[0.5, 1.7, 2.6], [2.6, 1.9, 0.4], [2.6, 1.1, 0.35], [1.5, 2.6, 0.5]];
const STAND = { colossus: 260, hierarch: 180, harrow: 45 };   // stand-off range of a LANCE engine ordered to KILL (reuses the ally flank logic: heavy.js flankPoint)
const KL = { kill: 'KILL', clear: 'CLEAR', take: 'TAKE', hold: 'HOLD', onme: 'ON ME' };
const _p = new THREE.Vector3();

export class Orders {
  constructor(G) {
    this.G = G; this.o = [null, null, null, null]; this.acc = 0; this.q = []; this.qT = 0;
    const rg = new THREE.RingGeometry(0.9, 1, 48); rg.rotateX(-Math.PI / 2); const bg = new THREE.CylinderGeometry(0.6, 0.6, 80, 6, 1, true); bg.translate(0, 40, 0);
    this.mk = GN.map((_, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...GHDR[i]), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const g = new THREE.Group(), ring = new THREE.Mesh(rg, mat), beam = new THREE.Mesh(bg, mat); g.add(ring, beam); g.visible = false; g.frustumCulled = false; G.scene.add(g); return { g, ring };
    });
    this.el = document.getElementById('ordp'); this.chips = GN.map((n, i) => { const d = document.createElement('div'); d.className = 'chip'; d.style.color = GCOL[i]; d.innerHTML = '<b></b><span></span>'; this.el.appendChild(d); return d; });
  }
  // ---- groups ----
  wing() { return this.G.scouts.list.filter(s => s.side === 0); }
  lance() { const G = this.G, r = []; for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side === 0 && !e.piloted) r.push(e); return r; }
  strength(g) {
    const u = this.G.units;
    if (g === 0) { const w = this.wing(); return [w.filter(s => s.state === 'alive').length, w.length]; }
    if (g === 1) { const l = this.lance(); return [l.filter(e => e.alive).length, l.length]; }
    if (g === 2) { const t = u.tanks.filter(k => k.side === 0 && !k.reserve); return [t.filter(k => k.alive).length, t.length]; }
    const q = u.squads.filter(k => k.side === 0 && !k.reserve); return [q.filter(k => k.alive > 0).length, q.length];
  }
  pt(o) { return o.tgt ? o.tgt.pos : o; }
  siteAt(x, z) { let b = null, bd = 68; for (const s of this.G.objectives.sites) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; b = s; } } return b; }
  heavyNear(x, z, r) { const G = this.G; let b = null, bd = r; for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side === 1 && e.alive) { const d = Math.hypot(e.pos.x - x, e.pos.z - z); if (d < bd) { bd = d; b = e; } } return b; }
  members(g, o) {   // ARMOUR: the two tank lane groups nearest the point plus the gate reserve; COHORT: the three infantry squads nearest it
    const u = this.G.units, P = o.kind === 'onme' ? this.G.player.pos : this.pt(o);
    if (g === 2) { const lanes = [...LANES].sort((a, b) => Math.abs(a - P.x) - Math.abs(b - P.x)).slice(0, 2); return u.tanks.filter(t => t.side === 0 && (t.reserve || lanes.includes(t.lane))); }
    return u.squads.filter(q => q.side === 0 && q.alive > 0).sort((a, b) => Math.hypot(a.lane - P.x, a.z - P.z) - Math.hypot(b.lane - P.x, b.z - P.z)).slice(0, 3);
  }
  // ---- giving and ending ----
  say(t) { if (this.qT <= 0 && !this.q.length) { this.G.announce(t); this.qT = 1.3; } else this.q.push(t); }
  issue(ctx, only) {
    const G = this.G, pl = G.player; if (!pl.heavy || pl._dead || G.over) return;
    const eng = ctx.eng && ctx.eng.alive && ctx.eng.side === 1 ? ctx.eng : this.heavyNear(ctx.x, ctx.z, 50), site = ctx.site || this.siteAt(ctx.x, ctx.z);
    const o = { x: ctx.x, z: ctx.z, tgt: null, site: null, kind: 'clear', t0: G.time, quietT: 0, capT: -1 }; let groups = [0, 2, 3];
    if (eng) { o.kind = 'kill'; o.tgt = eng; groups = [0, 1]; }
    else if (site) { o.kind = site.owner === 0 ? 'hold' : 'take'; o.site = site; o.x = site.x; o.z = site.z; groups = [2, 3]; if (this.heavyNear(site.x, site.z, 140)) groups.push(1); }
    if (only) groups = [only - 1];
    for (const g of groups) this.give(g, { ...o });
  }
  onMe() {
    const G = this.G, pl = G.player; if (!pl.heavy || pl._dead || G.over) return;
    for (const g of [0, 1, 2, 3]) this.give(g, { x: pl.pos.x, z: pl.pos.z, tgt: null, site: null, kind: 'onme', t0: G.time });
  }
  standDown() {
    const was = this.o.some(Boolean); for (let g = 0; g < 4; g++) this.end(g);
    if (was) this.say('ALL GROUPS: STAND DOWN');
  }
  give(g, o) {
    if (!this.strength(g)[0]) return;   // nobody left in the group
    this.end(g); o.mem = g >= 2 ? this.members(g, o) : null; if (o.kind === 'onme' && g === 3) o.hold = o.mem.map(q => q.z);
    this.o[g] = o; this.apply(g, o); this.bark(g, o);
  }
  end(g) {
    const o = this.o[g]; if (!o) return; this.o[g] = null;
    if (g === 0) for (const s of this.wing()) { s.ordTgt = null; s.ordPt = null; }
    else if (g === 1) for (const e of this.lance()) { e.ordered = false; e.ordTgt = null; if (e.goal && e.goal.ord) e.goal = null; }
    else for (const m of o.mem || []) m.ordered = false;
    const O = this.G.objectives; if (O) O.dirT = Math.min(O.dirT, 0.4);   // the director takes the units back at once
  }
  clearAll() { for (let g = 0; g < 4; g++) this.end(g); this.q.length = 0; }
  apply(g, o) {   // push the order onto its units (re-run each second: targets move, the player walks)
    const G = this.G, pl = G.player, P = o.kind === 'onme' ? pl.pos : this.pt(o), kill = o.kind === 'kill', me = o.kind === 'onme';
    if (g === 0) { for (const s of this.wing()) { s.ordTgt = kill ? o.tgt : null; s.ordPt = kill || me ? null : { x: P.x, z: P.z }; } }
    else if (g === 1) {
      const L = this.lance(); L.forEach((e, k) => {
        if (e.cl || e.ca || !e.alive) { e.ordered = false; e.ordTgt = null; return; }
        e.ordered = true; e.ordTgt = kill ? o.tgt : null;
        if (kill) { const t = o.tgt, range = STAND[e.hcls]; if (flankPoint(e, t, range, _p)) e.goal = { x: _p.x, z: _p.z, site: -1, ord: true }; else { const a = Math.atan2(e.pos.x - t.pos.x, e.pos.z - t.pos.z); e.goal = { x: t.pos.x + Math.sin(a) * range, z: t.pos.z + Math.cos(a) * range, site: -1, ord: true }; } }
        else if (me) { const d = 80 + 35 * (k % 3), a = pl.legYaw + Math.PI + (k % 2 ? 0.9 : -0.9); e.goal = { x: pl.pos.x + Math.sin(a) * d, z: pl.pos.z + Math.cos(a) * d, site: -1, ord: true }; }   // 80-150 m off the player's rear quarters
        else e.goal = { x: P.x + Math.cos(k * 2.4) * 36, z: P.z + Math.sin(k * 2.4) * 36, site: -1, ord: true };
      });
    } else if (g === 2) { let k = 0; for (const t of o.mem) { t.ordered = true; t.goalZ = me ? pl.pos.z + 90 + 14 * (k++ % 4) : P.z + 22 + 12 * (k++ % 3); } }   // Vigil advance toward -z: its own side of the point is +z
    else o.mem.forEach((q, k) => { q.ordered = true; q.goalZ = me ? o.hold[k] : P.z - (10 + 12 * (k % 3)); });
  }
  bark(g, o) {
    const P = this.pt(o), near = o.site || (() => { const s = this.G.objectives.sites.reduce((a, b) => Math.hypot(b.x - P.x, b.z - P.z) < Math.hypot(a.x - P.x, a.z - P.z) ? b : a); return Math.hypot(s.x - P.x, s.z - P.z) < 160 ? s : null; })(), at = near ? near.id : 'TARGET';
    const lead = g === 0 ? this.wing().find(s => s.state === 'alive') : g === 1 ? this.lance().find(e => e.alive) : null, nm = lead ? lead.name.replace(/^THE /, '').replace(/^VIGILANT /, '') : GN[g], k = o.kind;
    const T = {
      kill: [`${nm}: MOVING ON HIS FLANK`, `${nm}: ENGAGING`, 'ARMOUR: CLOSING ON TARGET', 'COHORT: CLOSING ON TARGET'],
      clear: [`${nm}: SWEEPING`, `${nm}: MOVING UP`, `ARMOUR: ROLLING ON ${at}`, `COHORT: ADVANCING ON ${at}`],
      take: [`${nm}: SWEEPING`, `${nm}: CONVERGING ON ${at}`, `ARMOUR: ROLLING ON ${at}`, `COHORT: STORMING ${at}`],
      hold: [`${nm}: SWEEPING`, `${nm}: STANDING GUARD AT ${at}`, `ARMOUR: HOLDING ${at}`, `COHORT: DIGGING IN AT ${at}`],
      onme: [`${nm}: SCREENING YOUR REAR`, `${nm}: FORMING ON YOU`, 'ARMOUR: FORMING UP', 'COHORT: HOLDING'],
    };
    this.say(T[k][g]);
  }
  // ---- per frame ----
  update(dt) {
    const G = this.G, pl = G.player; this.qT -= dt;
    if (!pl.heavy || pl._dead) { if (this.o.some(Boolean)) this.clearAll(); for (const m of this.mk) m.g.visible = false; return; }
    if (this.qT <= 0 && this.q.length) { G.announce(this.q.shift()); this.qT = 1.3; }
    this.acc += dt;
    if (this.acc >= 1) {
      const d1 = this.acc; this.acc = 0;
      for (let g = 0; g < 4; g++) {
        const o = this.o[g]; if (!o) continue; const P = this.pt(o);
        if (o.kind === 'kill') { const t = o.tgt; if (!t.alive || t.cl || t.ca || Math.hypot(t.pos.x - pl.pos.x, t.pos.z - pl.pos.z) > 900) { this.end(g); continue; } }
        else if (o.kind === 'clear') {
          let n = 0; const u = G.units;
          for (const q of u.squads) if (q.side === 1 && q.alive > 0 && Math.hypot(q.lane - P.x, q.z - P.z) < 60) n++;
          for (const t of u.tanks) if (t.side === 1 && t.alive && Math.hypot(t.x - P.x, t.z - P.z) < 60) n++;
          for (const s of G.scouts.list) if (s.side === 1 && s.state === 'alive' && Math.hypot(s.pos.x - P.x, s.pos.z - P.z) < 60) n++;
          for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side === 1 && e.alive && Math.hypot(e.pos.x - P.x, e.pos.z - P.z) < 60 + HITR[e.hcls]) n++;
          o.quietT = n ? 0 : o.quietT + d1; if (o.quietT >= 10) { this.end(g); continue; }
        } else if (o.kind === 'take' || o.kind === 'hold') {
          if (o.site.owner === 0) { if (o.capT < 0) o.capT = G.time; if (G.time - o.capT >= 60) { this.end(g); continue; } }
        }
        this.apply(g, o);
      }
    }
    // world markers: a ring and a beam at the order point or on the target, in the group's colour
    GN.forEach((n, g) => {
      const o = this.o[g], m = this.mk[g]; if (!o || o.kind === 'onme') { m.g.visible = false; return; }
      const P = this.pt(o), s = o.kind === 'kill' ? 26 : o.kind === 'clear' ? 20 : 14; m.g.visible = true; m.g.position.set(P.x, 0.8, P.z); m.ring.scale.setScalar(s * (1 + 0.1 * Math.sin(G.time * 5 + g)));
    });
  }
  hud() {
    const on = this.G.player.heavy; this.el.style.display = on ? 'flex' : 'none'; if (!on) return;
    this.chips.forEach((c, g) => { const [a, n] = this.strength(g), o = this.o[g]; c.children[0].textContent = `${GN[g]} ${a}/${n}`; c.children[1].textContent = o ? KL[o.kind] : '-'; c.style.opacity = o ? 1 : 0.6; c.style.borderColor = o ? GCOL[g] : 'rgba(255,255,255,0.18)'; });
  }
  // the auspex and Tab-map glyphs: a diamond with the group letter at the order point, and (Tab only) a line from the group to it
  centroid(g, o) {
    let x = 0, z = 0, n = 0; const add = (px, pz) => { x += px; z += pz; n++; };
    if (g === 0) for (const s of this.wing()) { if (s.state === 'alive') add(s.pos.x, s.pos.z); }
    else if (g === 1) for (const e of this.lance()) { if (e.alive) add(e.pos.x, e.pos.z); }
    else if (g === 2) for (const t of o.mem) { if (t.alive) add(t.x, t.z); }
    else for (const q of o.mem) { if (q.alive > 0) add(q.lane, q.z); }
    return n ? { x: x / n, z: z / n } : null;
  }
  drawMap(c, X, Y, h, big, gs, PX) {
    GN.forEach((nm, g) => {
      const o = this.o[g]; if (!o || o.kind === 'onme') return; const P = this.pt(o), col = GCOL[g];
      let x = X(P.x, P.z), y = Y(P.x, P.z); const dx = x - h, dy = y - h, d = Math.hypot(dx, dy), lim = h - 16; if (d > lim) { x = h + dx / d * lim; y = h + dy / d * lim; }
      c.save();
      if (big) { const m = this.centroid(g, o); if (m) { c.strokeStyle = col; c.globalAlpha = 0.8; c.lineWidth = 1.6 * PX * 0.6; c.setLineDash([6 * PX, 4 * PX]); c.beginPath(); c.moveTo(X(m.x, m.z), Y(m.x, m.z)); c.lineTo(x, y); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.beginPath(); c.arc(X(m.x, m.z), Y(m.x, m.z), 3 * PX, 0, 6.2832); c.fill(); } }
      const r = 7 * PX * gs; c.strokeStyle = col; c.fillStyle = 'rgba(2,14,8,0.78)'; c.lineWidth = 2 * PX * 0.6; c.beginPath(); c.moveTo(x, y - r * 1.3); c.lineTo(x + r, y); c.lineTo(x, y + r * 1.3); c.lineTo(x - r, y); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = col; c.font = 'bold ' + 8 * PX * gs + 'px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(nm[0], x, y + 1); c.restore();
    });
  }
}
