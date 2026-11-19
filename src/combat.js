// Ranged fire, cannon balls, melee, morale and routing.
import { SCALE, rangeTo, edgeDist, obbOverlap, wrapAngle } from './units.js';

const R = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const G = 14, BALL_V = 380;   // roundshot: ~500 units in ~1.3s, near-flat flight

export class Combat {
  constructor(world, fx) { this.w = world; this.fx = fx; this.balls = []; }

  update(dt) {
    const w = this.w;
    const regs = w.regs;
    for (const r of regs) if (r.state !== 'gone') { this.moraleUpdate(r, dt); this.rangedUpdate(r, dt); }
    this.meleeUpdate(dt);
    this.updateBalls(dt);
    this.fx.setBalls(this.balls);
  }

  // ---------------------------------------------------------------- casualties
  killMany(r, k, cause, src, bias = 1.7) {
    k = Math.min(k, r.men);
    for (let i = 0; i < k; i++) this.killIdx(r, Math.floor(Math.pow(R(), bias) * r.soldiers.length));
    if (k > 0) this.hurt(r, k, cause);
  }
  killIdx(r, idx) {
    const s = r.removeSoldier(idx), th = this.w.terrain;
    const y = th.heightAt(s.x, s.z);
    this.fx.addCorpse(r.side, s.x, y, s.z, s.yaw);
    if (r.def.cav) this.fx.addHorseCorpse(s.x + (R() - 0.5), y, s.z + (R() - 0.5), s.yaw);
    this.w.stats.lost[r.side]++;
  }
  hurt(r, k, cause) {
    const mult = cause === 'cannon' ? 1.4 : cause === 'charge' ? 1.2 : 1;
    r.morale -= k * (100 / r.maxMen) * r.def.frag * mult;
    r.lastHit = this.w.time;
    if (r.men <= 0 && r.state !== 'gone') {
      r.state = 'gone'; r.destroyed = true; r.selected = false;
      this.w.msg(`${r.name} destroyed`, r.side);
    }
  }

  // ---------------------------------------------------------------- morale
  moraleUpdate(r, dt) {
    const w = this.w, def = r.def, since = w.time - r.lastHit;
    if (r.men < r.maxMen * 0.12 && r.state !== 'routing') r.morale = Math.min(r.morale, 10);
    if (r.state === 'routing') {
      let near = 1e9;
      for (const t of w.regs) if (t.side !== r.side && t.state !== 'gone') near = Math.min(near, Math.hypot(t.x - r.x, t.z - r.z));
      if (near > 150 && r.men >= r.maxMen * 0.12) r.morale += 2.2 * dt;
      if (r.morale >= 45) { r.state = 'wavering'; r.order = { type: 'idle' }; r.run = false; w.msg(`${r.name} rallies`, r.side); }
      return;
    }
    let rec = 0;
    if (since > 6) rec += 0.5;
    if (since > 3) for (const g of w.generals) if (g.side === r.side && Math.hypot(g.x - r.x, g.z - r.z) < 120) rec += 0.7;
    r.morale = Math.min(def.morale, r.morale + rec * dt);
    if (r.morale < 20) this.startRout(r);
    else if (r.morale < 45) r.state = 'wavering';
    else if (r.morale > 55 || r.state === 'steady') r.state = 'steady';
  }
  startRout(r) {
    r.state = 'routing'; r.order = { type: 'idle' }; r.run = true; r.aimTarget = null;
    this.w.msg(`${r.name} routs!`, r.side);
    for (const f of this.w.regs) {
      if (f === r || f.side !== r.side || !f.active) continue;
      const d = Math.hypot(f.x - r.x, f.z - r.z);
      if (d < 160) { f.morale -= 12 * (1 - d / 160); f.lastHit = this.w.time; }
    }
  }

  // ---------------------------------------------------------------- ranged
  acquire(r) {
    r.aimTarget = null; r.canShoot = false; r.cands = null;
    const d = r.def;
    if (d.range <= 0 || r.state === 'routing' || (r.run && d.id !== 'artillery')) return;
    if (d.id === 'artillery' && r.deployT < d.deploy) return;
    const exp = r.order.type === 'attack' ? r.order.target : null;
    let best = null, bs = 1e9;
    for (const t of this.w.regs) {
      if (t.side === r.side || t.state === 'gone') continue;
      const dist = rangeTo(r, t);
      if (dist > d.range) continue;
      let score = dist;
      if (t === exp) score = -1;
      else if (!r.fireAtWill) continue;
      else { if (t.def.id === 'artillery') score *= 0.85; if (t.state === 'routing') score *= 1.4; }
      if (score < bs) { bs = score; best = t; }
      if (d.id === 'rifle') {   // candidate list for the riflemen's individual target picks
        (r.cands || (r.cands = [])).push({ t, dist, exp: t === exp, arc: Math.abs(wrapAngle(Math.atan2(t.x - r.x, t.z - r.z) - r.facing)) <= d.arc });
      }
    }
    if (!best) return;
    r.aimTarget = best;
    const ang = Math.atan2(best.x - r.x, best.z - r.z);
    r.canShoot = Math.abs(wrapAngle(ang - r.facing)) <= d.arc;
  }

  rangedUpdate(r, dt) {
    const def = r.def;
    if (def.range <= 0) return;
    r.reloadT = Math.max(0, r.reloadT - dt);
    r.aimT -= dt;
    if (r.aimT <= 0) { r.aimT = 0.3 + R() * 0.2; this.acquire(r); }
    if (def.id === 'rifle') { this.skirmish(r, dt); return; }   // riflemen fire individually, not in volleys
    const t = r.aimTarget;
    if (!t || !r.canShoot || r.reloadT > 0 || r.moving || r.engaged > 0) return;
    if (t.state === 'gone') { r.aimTarget = null; return; }
    if (def.id === 'artillery') this.fireGuns(r, t); else this.volley(r, t);
  }

  volley(r, t) {
    const def = r.def, w = this.w, th = w.terrain;
    const d = rangeTo(r, t);
    const shooters = def.formation === 'tercio' ? r.soldiers.filter(s => s.role === 'musk') : r.soldiers;
    const n = Math.max(1, Math.round(shooters.length * def.fireFrac));
    const fall = clamp(1 - 0.75 * d / def.range, 0.2, 1);
    const dens = clamp((t.men / (4 * t.halfW * t.halfD)) / 0.5, 0.5, 1.5);
    const f = Math.sin(t.facing) * (r.x - t.x) + Math.cos(t.facing) * (r.z - t.z);
    const fd = f / Math.max(1, Math.hypot(r.x - t.x, r.z - t.z));
    const flank = fd > 0.5 ? 1 : fd < -0.5 ? 1.3 : 1.15;
    const p = def.acc * fall * dens * flank * this.exposure(t) * (r.state === 'wavering' ? 0.7 : 1);
    let hits = 0;
    for (let i = 0; i < n; i++) if (R() < p) hits++;
    const dx = t.x - r.x, dz = t.z - r.z, dl = Math.max(1, Math.hypot(dx, dz)), ux = dx / dl, uz = dz / dl;
    const big = def.id === 'rifle' ? 0.8 : def.cav ? 0.7 : 1;
    const lift = def.cav ? 1.8 * SCALE : 1.3 * SCALE;
    for (let i = 0; i < n; i++) {
      const s = shooters[i];
      w.later(R() * 0.9, () => { if (r.state === 'gone') return; this.fx.musket(s.x, th.heightAt(s.x, s.z) + lift, s.z, ux, uz, big); });
    }
    for (let h = 0; h < hits; h++) {
      w.later(0.4 + R() * 1.0 + d / 250, () => { if (t.state !== 'gone' && t.men > 0) this.killMany(t, 1, 'shot', r); });
    }
    r.reloadT = def.reload * (0.9 + R() * 0.25);
  }

  // incoming musket/rifle fire vs skirmishers: loose order x0.7, prone in the open x0.5, kneeling in cover x0.3 (averaged over the men)
  exposure(t) {
    if (!t.def.loose) return 1;
    if (t._expT !== this.w.time) {
      let sum = 0; for (const s of t.soldiers) sum += s.pwant >= 2 ? 0.5 : s.pwant >= 1 ? 0.3 : 0.7;
      t._expT = this.w.time; t._exp = t.soldiers.length ? sum / t.soldiers.length : 0.7;
    }
    return t._exp;
  }
  // each rifleman runs his own reload timer, lines up his own shot (prefers guns and close targets) and fires alone
  skirmish(r, dt) {
    const def = r.def, w = this.w, th = w.terrain;
    const can = !!r.cands && r.cands.length > 0 && !r.moving && r.engaged === 0 && !r.evading && r.state !== 'routing';
    for (const s of r.soldiers) {
      s.fireT = Math.max(-1, s.fireT - dt);
      if (s.fireT > 1.2 || !can || s.mv) { s.aiming = false; if (!can || s.mv) s.tgt = null; continue; }
      const ok = (t) => t && t.state !== 'gone' && edgeDist(t, s.x, s.z) <= def.range * 1.05;
      if (!ok(s.tgt)) {
        let best = null, bs = 1e9;
        for (const c of r.cands) {
          if (!c.arc || c.t.state === 'gone') continue;
          let sc = c.dist * (0.8 + R() * 0.4);
          if (c.exp) sc *= 0.5; else if (c.t.def.id === 'artillery') sc *= 0.6; else if (c.t.state === 'routing') sc *= 1.4;
          if (sc < bs) { bs = sc; best = c.t; }
        }
        s.tgt = best;
      }
      const t = s.tgt;
      if (!ok(t)) { s.tgt = null; s.aiming = false; continue; }
      s.aiming = true; s.tyaw = Math.atan2(t.x - s.x, t.z - s.z);
      if (s.fireT > 0) continue;
      // fire
      const d = edgeDist(t, s.x, s.z);
      const fall = clamp(1 - 0.3 * d / def.range, 0.6, 1);
      const dens = clamp((t.men / (4 * t.halfW * t.halfD)) / 0.5, 0.5, 1.5);
      const f = Math.sin(t.facing) * (s.x - t.x) + Math.cos(t.facing) * (s.z - t.z);
      const fd = f / Math.max(1, Math.hypot(s.x - t.x, s.z - t.z));
      const flank = fd > 0.5 ? 1 : fd < -0.5 ? 1.3 : 1.15;
      const steady = s.pwant > 0 ? 1.15 : 0.85;
      const p = def.acc * fall * dens * flank * steady * this.exposure(t) * (r.state === 'wavering' ? 0.7 : 1);
      const dx = t.x - s.x, dz = t.z - s.z, dl = Math.max(1, Math.hypot(dx, dz)), ux = dx / dl, uz = dz / dl;
      const lift = (s.pwant >= 2 ? 0.35 : s.pwant >= 1 ? 0.8 : 1.3) * SCALE;
      const sx = s.x, sz = s.z;
      this.fx.musket(sx, th.heightAt(sx, sz) + lift, sz, ux, uz, 0.45);
      s.shots++; s.aiming = false; s.tgt = null;
      s.fireT = def.reload * (0.8 + R() * 0.45);
      if (R() < p) w.later(0.3 + R() * 0.4 + d / 250, () => { if (t.state !== 'gone' && t.men > 0) this.killMany(t, 1, 'shot', r); });
    }
  }

  gunPos(r, i) {
    const g = r.layout.guns, c = Math.cos(r.facing), s = Math.sin(r.facing);
    return [r.x + c * g[i * 2] + s * g[i * 2 + 1], r.z - s * g[i * 2] + c * g[i * 2 + 1]];
  }
  fireGuns(r, t) {
    const def = r.def, w = this.w, th = w.terrain;
    r.reloadT = def.reload * (0.95 + R() * 0.15);
    for (let g = 0; g < r.guns; g++) {
      w.later(g * 0.35 + R() * 0.5, () => {
        if (r.state === 'gone' || g >= r.guns || t.state === 'gone') return;
        const [gx, gz] = this.gunPos(r, g);
        const dx = t.x - gx, dz = t.z - gz, D = Math.max(5, Math.hypot(dx, dz)), ux = dx / D, uz = dz / D;
        const my = th.heightAt(gx, gz) + 1.4 * SCALE;
        const mx = gx + ux * 3, mz = gz + uz * 3;
        this.fx.cannon(mx, my, mz, ux, uz);
        if (rangeTo(r, t) < def.canister) {
          const kills = Math.max(1, Math.round((2 + R() * 5) * (1 - rangeTo(r, t) / (def.canister * 1.2))));
          w.later(0.15, () => { if (t.state !== 'gone') { this.killMany(t, kills, 'cannon', r, 1.2); this.fx.dustKick(t.x + (R() - 0.5) * t.halfW, th.heightAt(t.x, t.z), t.z, 4, 5); } });
          return;
        }
        const ang = (R() - 0.5) * 0.04, ca = Math.cos(ang), sa = Math.sin(ang);
        const dirx = ux * ca - uz * sa, dirz = ux * sa + uz * ca;
        const aimx = t.x + (R() - 0.5) * t.halfW * 0.8, aimz = t.z + (R() - 0.5) * t.halfD * 0.6;
        const Dl = Math.hypot(aimx - mx, aimz - mz) * (0.8 + R() * 0.1);
        const T = Dl / BALL_V;
        const gl = th.heightAt(mx + dirx * Dl, mz + dirz * Dl) + 0.2;
        this.balls.push({ x: mx, y: my, z: mz, vx: dirx * BALL_V, vz: dirz * BALL_V, vy: (gl - my + 0.5 * G * T * T) / T, side: r.side, src: r, b: 0 });
      });
    }
  }

  updateBalls(dt) {
    const w = this.w, th = w.terrain;
    for (const b of this.balls) {
      // sub-step by distance (<=1.2 units each) so a fast ball cannot tunnel past soldiers
      const sub = Math.min(160, Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy, b.vz) * dt / 1.2))), h = dt / sub;
      for (let k = 0; k < sub && b.alive !== false; k++) {
        let hs = Math.hypot(b.vx, b.vz);
        const ux = b.vx / hs, uz = b.vz / hs;
        if (b.roll) {   // rolling along the ground: grass drag, slowed going uphill
          const sl = (th.heightAt(b.x + ux * 2, b.z + uz * 2) - th.heightAt(b.x - ux * 2, b.z - uz * 2)) / 4;
          const nh = hs - (60 + 0.5 * hs + G * sl) * h, k = Math.max(0, nh) / hs;
          b.vx *= k; b.vz *= k; b.x += b.vx * h; b.z += b.vz * h; b.y = th.heightAt(b.x, b.z) + 0.2;
          if (nh < 5) b.alive = false;
        } else {
          b.vy -= G * h; b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
        }
        const gy = th.heightAt(b.x, b.z);
        if (!b.roll && b.y <= gy + 0.2) {
          b.y = gy + 0.2;
          if (b.vy < 0) {
            // impact angle against the ground along the line of flight (rising ground steepens it)
            const sl = (th.heightAt(b.x + ux * 2, b.z + uz * 2) - th.heightAt(b.x - ux * 2, b.z - uz * 2)) / 4;
            const ang = Math.atan2(-b.vy, hs) + Math.atan(sl);
            if (ang > 0.26) {   // ~15 degrees or steeper: the ball buries itself
              this.fx.dustKick(b.x, gy, b.z, 5, 6, ux, uz); b.alive = false;
            } else {            // graze: skip back up off the ground, losing speed
              const k = 0.72 - ang;
              b.vx *= k; b.vz *= k; hs *= k; b.b++;
              b.vy = Math.max(0, -b.vy * 0.55 + sl * hs);
              this.fx.dustKick(b.x, gy, b.z, 3, 4, ux, uz);
              if (b.vy < 1.2) { b.vy = 0; b.roll = true; }
            }
          }
        }
        if (b.y < gy + 2.6) {
          for (const r of w.regs) {
            if (r.side === b.side || r.state === 'gone') continue;
            if (Math.hypot(r.x - b.x, r.z - b.z) > r.radius + 3) continue;
            let hit = null;
            const pk = 0.45 * Math.min(1, Math.hypot(b.vx, b.vz) / 60);   // a slow rolling ball maims fewer
            for (const s of r.soldiers) {
              const dx = s.x - b.x, dz = s.z - b.z;
              if (dx * dx + dz * dz < 1.9 && R() < pk) { hit = s; break; }
            }
            if (hit) {
              const i = r.soldiers.indexOf(hit);
              this.killIdx(r, i); this.hurt(r, 1, 'cannon');
              b.vx *= 0.88; b.vz *= 0.88; b.vy *= 0.9;
              if (Math.hypot(b.vx, b.vz) < 8) b.alive = false;
            }
          }
        }
        if (Math.abs(b.x) > 620 || Math.abs(b.z) > 620) b.alive = false;
      }
    }
    this.balls = this.balls.filter(b => b.alive !== false);
  }

  // ---------------------------------------------------------------- melee
  meleeUpdate(dt) {
    const w = this.w;
    const regs = w.regs.filter(r => r.state !== 'gone');
    for (const r of regs) { r.prevContacts = new Set(r.contacts); r.contacts = []; }
    for (let i = 0; i < regs.length; i++) for (let j = i + 1; j < regs.length; j++) {
      const a = regs[i], b = regs[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > a.radius + b.radius + 4) continue;
      if (a.side !== b.side) {
        const m = obbOverlap(a, b, 1.2);
        if (!m) continue;
        a.contacts.push(b); b.contacts.push(a);
        const pen = m.depth - 1.2;
        if (pen > 0) { const k = Math.min(pen, 25 * dt) * 0.5; a.x -= m.nx * k; a.z -= m.nz * k; b.x += m.nx * k; b.z += m.nz * k; }
        if (!a.prevContacts.has(b)) { this.impact(a, b); this.impact(b, a); }
      } else if (a.state !== 'routing' && b.state !== 'routing') {
        const m = obbOverlap(a, b, 0);
        if (!m) continue;
        const wa = a.moving ? 0.3 : 1, wb = b.moving ? 0.3 : 1, k = Math.min(m.depth, 8 * dt) / (wa + wb);
        a.x -= m.nx * k * wa; a.z -= m.nz * k * wa; b.x += m.nx * k * wb; b.z += m.nz * k * wb;
      }
    }
    for (const r of regs) r.engaged = r.contacts.length;
    for (const a of regs) {
      if (a.state === 'routing' || a.state === 'gone') continue;
      for (const b of a.contacts) if (b.state !== 'gone') this.meleeHit(a, b, dt);
    }
  }
  relFront(b, a) { // dot(forward(b), unit(a-b)): >0.5 front, <-0.5 rear
    const d = Math.max(1, Math.hypot(a.x - b.x, a.z - b.z));
    return (Math.sin(b.facing) * (a.x - b.x) + Math.cos(b.facing) * (a.z - b.z)) / d;
  }
  impact(a, b) {
    const def = a.def;
    if (a.state === 'routing' || def.charge <= 0 || a.speedNow < def.run * 0.5) return;
    const eng = Math.min(a.men, a.files * 2);
    const bonus = eng * def.charge * (a.speedNow / def.run) * 0.5;
    const f = this.relFront(b, a);
    const th = this.w.terrain;
    this.fx.dustKick((a.x + b.x) / 2, th.heightAt(a.x, a.z), (a.z + b.z) / 2, 5, 6);
    if (b.def.antiCav && def.cav && f > 0.5) {
      this.killMany(a, Math.round(bonus * 0.8 + 2), 'melee', b);
      a.morale -= 12; return;
    }
    const mult = f < -0.5 ? 2 : f <= 0.5 ? 1.5 : (b.def.cav ? 1 : 0.65);
    this.killMany(b, Math.round(bonus * mult), 'charge', a);
    b.morale -= 8 * mult * (def.cav ? 1.5 : 0.6) * (b.state === 'wavering' ? 1.3 : 1);
  }
  meleeHit(a, b, dt) {
    const eng = Math.min(a.men, Math.max(6, a.files * (a.def.formation === 'tercio' ? 3 : 2))) / a.contacts.length;
    let atk = a.def.ma * (a.state === 'wavering' ? 0.8 : 1);
    const dfn = b.def.md * (b.state === 'routing' ? 0.35 : 1) * (b.state === 'wavering' ? 0.85 : 1);
    const f = this.relFront(b, a);
    const mult = f > 0.5 ? 1 : f < -0.5 ? 1.9 : 1.4;
    if (a.def.antiCav && b.def.cav && this.relFront(a, b) > 0.5) atk *= 2.6;
    b.meleeAcc += eng * 0.022 * atk / dfn * mult * dt;
    const k = Math.floor(b.meleeAcc);
    if (k > 0) { b.meleeAcc -= k; this.killMany(b, k, 'melee', a, 1.0); }
    if (mult > 1.5) b.morale -= 3 * dt; else if (mult > 1) b.morale -= 1.5 * dt;
    if (b.def.meleeMorale) b.morale -= b.def.meleeMorale * dt;
    b.lastHit = this.w.time;
    if (R() < dt * 1.5) this.fx.dustKick((a.x + b.x) / 2 + (R() - 0.5) * 20, this.w.terrain.heightAt(a.x, a.z), (a.z + b.z) / 2 + (R() - 0.5) * 20, 1, 2.5);
  }
}
