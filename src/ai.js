// Enemy AI: holds a line around the village, advances when the player closes, cavalry hunts exposed targets.
import { rangeTo } from './units.js';
import { VILLAGE } from './terrain.js';

const R = Math.random;

export class EnemyAI {
  constructor(world) {
    this.w = world; this.advance = false;
    for (const r of world.regs) if (r.side === 'enemy') r.ai = { home: { x: r.x, z: r.z, f: r.facing }, next: R() * 1.5 };
  }
  update(dt) {
    const w = this.w;
    const foes = w.regs.filter(r => r.side === 'player' && r.state !== 'gone');
    if (!this.advance) {
      const near = foes.some(f => Math.hypot(f.x - VILLAGE.x, f.z - VILLAGE.z) < 260);
      const lost = w.stats.lost.enemy > 150;
      if (near || lost || w.time > 420) this.advance = true;
    }
    for (const r of w.regs) {
      if (r.side !== 'enemy' || r.state === 'gone' || r.state === 'routing') continue;
      r.ai.next -= dt;
      if (r.ai.next > 0) continue;
      r.ai.next = 1.0 + R() * 0.5;
      this.think(r, foes);
    }
  }
  nearest(r, foes) {
    let best = null, bd = 1e9;
    for (const f of foes) { const d = rangeTo(r, f); if (d < bd) { bd = d; best = f; } }
    return [best, bd];
  }
  goHome(r) {
    const h = r.ai.home;
    if (Math.hypot(r.x - h.x, r.z - h.z) > 8 && r.order.type !== 'move') r.cmdMove(h.x, h.z, h.f, null, false);
  }
  think(r, foes) {
    const def = r.def, id = def.id;
    const [near, nd] = this.nearest(r, foes);
    if (!near) return;
    r.fireAtWill = true;
    if (id === 'artillery') return;
    if (r.engaged > 0) return;
    const homeD = Math.hypot(r.x - r.ai.home.x, r.z - r.ai.home.z);
    if (id === 'line' || id === 'pike') {
      if (r.order.type === 'attack' && r.order.target && r.order.target.state !== 'gone' && nd < def.range * 2) return;
      if (nd < def.range * 1.3 || (this.advance && nd < 400)) r.cmdAttack(near, false);
      else if (homeD > 12 && r.order.type === 'idle') this.goHome(r);
      else if (nd > def.range * 2 && homeD > 40) this.goHome(r);
    } else if (id === 'rifle') {
      // skirmish screen: close in on the enemy line to long rifle range and hold there (they take cover / lie down when stationary and
      // fall back from close infantry and cavalry by themselves, see Regiment.evadeCheck); drift back to the screen position otherwise
      const lim = this.advance ? 300 : 200;
      if (nd < def.range * 1.5 && homeD < lim) r.cmdAttack(near, false);
      else if (homeD > 15 && r.order.type === 'idle') this.goHome(r);
      else if (homeD >= lim && r.order.type !== 'move') this.goHome(r);
    } else if (def.cav) {
      if (r.order.type === 'attack' && r.order.target && r.order.target.state !== 'gone' && r.run) return;
      let best = null, bs = 25;
      for (const f of foes) {
        const d = Math.hypot(f.x - r.x, f.z - r.z);
        if (d > 420 || d < 8) continue;
        let s = 0;
        const fd = (Math.sin(f.facing) * (r.x - f.x) + Math.cos(f.facing) * (r.z - f.z)) / d;
        if (f.state === 'routing') s += 60;
        if (f.def.id === 'artillery') s += 45;
        if (f.def.id === 'rifle') s += 35;
        if (fd < 0.2) s += 40; else s -= 30;
        if (f.def.antiCav) s -= 90;
        if (f.def.cav) s -= 10;
        s -= d * 0.06;
        if (s > bs) { bs = s; best = f; }
      }
      if (best && r.morale > 50) { r.cmdAttack(best, true); return; }
      if (id === 'lcav' && nd < def.range * 3 && r.order.type !== 'attack') { r.cmdAttack(near, false); return; }
      if (r.order.type === 'idle' || (r.order.type === 'attack' && !r.run)) { if (nd > def.range * 4) this.goHome(r); }
      if (r.order.type === 'attack' && r.run && r.order.target.state === 'gone') r.run = false;
    }
  }
}
