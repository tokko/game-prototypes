import * as THREE from 'three';
import { rr, clamp } from './util.js?v=32';
import { HITR } from './heavy.js?v=32';

// Wrath (model/princeps-spec.md section 2): a 0-100 meter for the player's heavy only (the AI never uses it), fed by smashing things, spent on three god-machine powers:
// WAR HORN (E, 30), OVERCHARGE (C, 50), HEAVEN'S NAIL (X, 100). Gains are called from the kill / damage code (G.wrath.gain). Decay: 0.5 / s after 15 s with no gain.
// Tuning note: the spec's gain table made a scripted colossus (gatling + auto secondaries at the front) hit a WAR HORN in 8 s and the Nail in 33 s; the gains at the call sites are the spec table
// x ~0.2 (infantry, stomp), x 0.25 (tank) and x ~0.5 (everything else): the same script now reaches 30 Wrath in ~34 s and 100 in ~93 s.
const COST = { horn: 30, oc: 50, nail: 100 }, NAIL_T = 4, NAIL_R = 30, NAIL_RANGE = 600;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const ringGeo = r0 => { const g = new THREE.RingGeometry(r0, 1, 96); g.rotateX(-Math.PI / 2); return g; };
const glowMat = (r, g, b, o) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });

export class Wrath {
  constructor(G) {
    this.G = G; this.v = 0; this.idle = 0; this.mute = false; this.nails = []; this.waves = []; this.ocFx = 0;
    this.geoRing = ringGeo(0.94); this.geoThin = ringGeo(0.985); this.geoThick = ringGeo(0.8); this.geoPillar = new THREE.CylinderGeometry(1, 1, 1400, 28, 1, true); this.geoPillar.translate(0, 700, 0);
    this.el = { box: document.getElementById('wrath'), fill: document.getElementById('wrFill'), txt: document.getElementById('wrTxt') }; this.ico = ['wrE', 'wrC', 'wrX'].map(id => document.getElementById(id));
  }
  on() { const pl = this.G.player; return pl.heavy && !pl._dead; }
  gain(n) { if (this.mute || !this.on()) return; this.v = Math.min(100, this.v + n); this.idle = 0; }
  // ---- powers (each on its own key; cannot be used without enough Wrath) ----
  spend(c, name) { if (!this.on() || this.G.over) return false; if (this.v < c) { this.G.announce(name + ' NEEDS ' + c + ' WRATH'); return false; } this.v -= c; this.idle = 0; return true; }
  horn() {   // WAR HORN: 250 m around the player; enemy infantry rout (8 s), enemy tanks' fire rate halved (6 s), allied units +25% damage (10 s)
    if (!this.spend(COST.horn, 'WAR HORN')) return;
    const G = this.G, pl = G.player, R = 250; G.hornT = 10;
    for (const q of G.units.squads) if (q.side === 1 && q.alive > 0 && Math.hypot(q.lane - pl.pos.x, q.z - pl.pos.z) < R) { q.panicT = Math.max(q.panicT || 0, 8); q.fleeT = 8; }
    for (const t of G.units.tanks) if (t.side === 1 && t.alive && Math.hypot(t.x - pl.pos.x, t.z - pl.pos.z) < R) t.slowT = 6;
    const m1 = new THREE.Mesh(this.geoRing, glowMat(2.4, 1.6, 0.5, 0.9)), m2 = new THREE.Mesh(this.geoThin, glowMat(2.4, 1.6, 0.5, 0.9));
    for (const m of [m1, m2]) { m.position.set(pl.pos.x, 0.6, pl.pos.z); m.frustumCulled = false; G.scene.add(m); }
    this.waves.push({ m1, m2, t: 0 }); G.fx.dust(pl.pos.x, 2, pl.pos.z, 14, 24, 0.2, 0.5); G.shakeAt(pl.pos.x, 0, pl.pos.z, 8); G.sfx.horn && G.sfx.horn(); G.announce('WAR HORN');
  }
  overcharge() {   // OVERCHARGE: 10 s of free energy weapons, a 1.2 s lance, no overheating, half the ward regen pause (the rules live in heavy.js and the class files, keyed on unit.ocT)
    if (!this.spend(COST.oc, 'OVERCHARGE')) return; this.G.player.unit.ocT = 10; this.G.announce('OVERCHARGE'); this.G.sfx.charge(1.2, 0.25);
  }
  nail(pt) {   // HEAVEN'S NAIL: an orbital beam at the aim point (<= 600 m), 4 s of telegraph, then 30 m of ruin
    if (!pt || !this.on() || this.G.over) return;
    const G = this.G, pl = G.player; let x = pt.x, z = pt.z; const d = Math.hypot(x - pl.pos.x, z - pl.pos.z);
    if (this.v < COST.nail) { G.announce("HEAVEN'S NAIL NEEDS 100 WRATH"); return; }
    if (d > NAIL_RANGE) { x = pl.pos.x + (x - pl.pos.x) / d * NAIL_RANGE; z = pl.pos.z + (z - pl.pos.z) / d * NAIL_RANGE; }
    this.v -= COST.nail; this.idle = 0;
    const ring = new THREE.Mesh(this.geoThick, glowMat(3, 2.2, 0.8, 0.95)), inner = new THREE.Mesh(this.geoRing, glowMat(3, 2.2, 0.8, 0.5)), pil = new THREE.Mesh(this.geoPillar, glowMat(2.2, 1.7, 0.7, 0.2)), core = new THREE.Mesh(this.geoPillar, glowMat(4, 3.4, 2.2, 0.5));
    ring.scale.set(NAIL_R, 1, NAIL_R); for (const m of [ring, inner, pil, core]) { m.position.set(x, m === pil || m === core ? 0 : 0.7, z); m.frustumCulled = false; G.scene.add(m); }
    this.nails.push({ x, z, t: 0, ring, inner, pil, core }); G.sfx.charge(NAIL_T, 0.3); G.announce("HEAVEN'S NAIL - 4 S");
  }
  resolve(n) {
    const G = this.G, fx = G.fx, x = n.x, z = n.z, pl = G.player; this.mute = true;
    G.units.crush(x, z, NAIL_R, -1, true);            // every trooper and tank in the ring, friend or foe
    G.scouts.blast(x, 0, z, NAIL_R, 9999, -1, true);   // Kestrels
    for (const b of G.city.buildings) if (b.alive && !b.hero && Math.hypot(b.x - x, b.z - z) < NAIL_R + Math.max(b.hw, b.hd)) G.city.damage(b, 99999, b.x - x, b.z - z, true, true);   // non-hero buildings
    this.mute = false;
    const pt = { x, y: 0.5, z, brk: true, split: true };   // S 600 / H 600 to each engine, the shield share spread over its standing facings, the hull located at the impact (ground = the legs)
    for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.alive && !e.piloted && Math.hypot(e.pos.x - x, e.pos.z - z) < NAIL_R + HITR[e.hcls]) { e._src = { x: pl.pos.x, z: pl.pos.z }; e.damage(600, true, false, pt, 600); e.breakT = Math.max(e.breakT || 0, 5); }
    fx.explosion(x, 4, z, 7); fx.flash(x, 40, z, 3, 2.4, 1.2, 12000, 0.9, 600); fx.debris(x, 8, z, 24, 3, 40, 0.08); fx.dust(x, 2, z, 26, 40, 0.2, 0.6);
    for (let k = 0; k < 36; k++) { const a = k / 36 * 6.283, c = Math.cos(a), s = Math.sin(a); fx.smoke(x + c * 20, 3, z + s * 20, c * rr(40, 70), rr(1, 6), s * rr(40, 70), rr(2.5, 4.5), 10, 34, 0.15, 0.6, 1.1); if (k % 2) fx.fire(x + c * 14, 2, z + s * 14, c * 80, 2, s * 80, 0.5, 8, 3, 3.5, 2.4, 0.8, 1, 1.2); }
    fx.addEmitter(x, 6, z, 6, 18); G.shakeAt(x, 0, z, 18); G.sfx.lance(fx.camDist(x, 20, z)); G.sfx.boom(fx.camDist(x, 10, z), 4); G.skyFlash = 1.6;
    n.core.material.opacity = 1; n.core.scale.set(14, 1, 14); n.done = true; n.fadeT = 0.6;
  }
  update(dt) {
    const G = this.G, pl = G.player, time = G.time;
    if (G.hornT > 0) G.hornT -= dt;
    if (!this.on()) this.v = 0; else { this.idle += dt; if (this.idle > 15) this.v = Math.max(0, this.v - 0.5 * dt); }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]; w.t += dt; const u = w.t / 0.9;
      if (u >= 1) { for (const m of [w.m1, w.m2]) { G.scene.remove(m); m.material.dispose(); } this.waves.splice(i, 1); continue; }
      const r = 12 + 238 * u; w.m1.scale.set(r, 1, r); w.m2.scale.set(r * 0.82, 1, r * 0.82); w.m1.material.opacity = 0.9 * (1 - u); w.m2.material.opacity = 0.6 * (1 - u);
    }
    for (let i = this.nails.length - 1; i >= 0; i--) {
      const n = this.nails[i]; n.t += dt;
      if (!n.done) {
        const u = clamp(n.t / NAIL_T, 0, 1), pr = NAIL_R + 50 * (1 - u) * (1 - u), cr = 3 + 5 * u;   // the pillar narrows onto the ring; a thin core brightens inside it
        n.pil.scale.set(pr, 1, pr); n.pil.material.opacity = 0.1 + 0.3 * u; n.core.scale.set(cr, 1, cr); n.core.material.opacity = 0.3 + 0.6 * u;
        n.inner.scale.setScalar(NAIL_R * (1 + 0.6 * (1 - u) * (0.5 + 0.5 * Math.sin(time * 8)))); n.inner.material.opacity = 0.2 + 0.4 * u;
        n.ring.material.opacity = Math.sin(time * (8 + 24 * u)) > -0.2 ? 0.95 : 0.35;
        if (n.t >= NAIL_T) this.resolve(n);
      } else {
        n.fadeT -= dt; const k = Math.max(0, n.fadeT / 0.6); n.core.material.opacity = k; n.pil.material.opacity = 0.4 * k; n.ring.material.opacity = k; n.inner.material.opacity = 0.5 * k;
        if (n.fadeT <= 0) { for (const m of [n.ring, n.inner, n.pil, n.core]) { G.scene.remove(m); m.material.dispose(); } this.nails.splice(i, 1); }
      }
    }
    // OVERCHARGE: the reactor glow brightens, arcs crawl over the hull
    const u = this.on() ? pl.unit : null;
    if (u && u.ocT > 0 && u.alive) {
      const fx = G.fx, R = { colossus: 40, hierarch: 22, harrow: 15 }[u.hcls], S = { colossus: 16, hierarch: 9, harrow: 6 }[u.hcls]; u.geo.reactor.getWorldPosition(_v);
      fx.fire(_v.x + rr(-1, 1), _v.y + rr(-1, 1), _v.z + rr(-1, 1), 0, 0, 0, 0.12, S * (1 + 0.2 * Math.sin(time * 30)), 3, 1.2, 2.6, 4.8, 1);
      if (Math.random() < dt * 22) { u.chest(_w); _v.set(_w.x + rr(-R, R), _w.y + rr(-R * 0.4, R * 0.6), _w.z + rr(-R, R)); const a = _v.clone(); _v.add(new THREE.Vector3(rr(-R * 0.4, R * 0.4), rr(-R * 0.3, R * 0.3), rr(-R * 0.4, R * 0.4))); fx.beam(a, _v, 0.45, 1.6, 3.2, 5, 0.09); }
    }
  }
  hud() {
    const e = this.el, on = this.on(), v = this.v; e.box.style.display = on ? 'block' : 'none'; if (!on) return;
    e.fill.style.height = v.toFixed(1) + '%';
    [COST.horn, COST.oc, COST.nail].forEach((c, i) => this.ico[i].classList.toggle('on', v >= c));
    const u = this.G.player.unit, a = []; if (this.G.hornT > 0) a.push('HORN ' + Math.ceil(this.G.hornT)); if (u && u.ocT > 0) a.push('OVERCHARGE ' + Math.ceil(u.ocT)); if (this.nails.some(n => !n.done)) a.push('NAIL');
    e.txt.textContent = a.length ? a.join('  ') : Math.floor(v);
  }
}
