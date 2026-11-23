import * as THREE from 'three';
import { Builder, PAL, rnd, rr, pick, clamp } from './util.js?v=32';
import { AVENUES, LANES } from './city.js?v=32';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();

export class Air {
  constructor(G) {
    this.G = G; const scene = G.scene; this.list = []; this.missiles = []; this.shells = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
    mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 totalEmissiveRadiance += diffuseColor.rgb * 0.35;`); };
    const geo = side => {
      const C = PAL[side], f = new Builder(), g = new Builder(), hp = Math.PI / 2;
      f.box(1.8, 1.5, 13, 0, 0, 0, C.hull).box(15, 0.35, 4, 0, 0, -1.5, C.dark).box(7, 0.3, 2.4, 0, 0.1, 3.5, C.dark).box(0.3, 2.6, 2.6, 2.2, 1.2, -5.4, C.trim).box(0.3, 2.6, 2.6, -2.2, 1.2, -5.4, C.trim).pyr(1.6, 3, 0, 0, 0, C.dark).box(1.1, 0.7, 2.4, 0, 0.9, 2.5, C.dark);
      g.box(5.4, 4.2, 19, 0, 0, 0, C.hull).box(3.8, 2.8, 6, 0, -0.6, 11.5, C.dark).box(22, 0.9, 6.5, 0, 0.8, -1, C.dark).cyl(2, 2, 8, 10, 0.2, -1, C.hull, hp).cyl(2, 2, 8, -10, 0.2, -1, C.hull, hp)
        .box(1.6, 1.6, 9, 0, 1.4, -13, C.dark).box(0.4, 4.5, 3.4, 3, 3, -16, C.trim).box(0.4, 4.5, 3.4, -3, 3, -16, C.trim).box(8, 0.4, 3, 0, 1.6, -16.5, C.dark)
        .cyl(0.5, 0.5, 5, 0, -2.4, 12, 0x111111, hp).box(6, 1, 8, 0, 2.6, 1, C.trim).pyr(1.2, 2.4, 0, 3.1, 4, C.trim).box(2.4, 1.2, 3, 6, -1.2, 2, 0x111111).box(2.4, 1.2, 3, -6, -1.2, 2, 0x111111);
      return { fighter: f.build(), gunship: g.build() };
    };
    const geos = [geo(0), geo(1)];
    const add = (side, kind, scale = 1) => {
      const mesh = new THREE.Mesh(kind === 'fighter' ? geos[side].fighter : geos[side].gunship, mat); mesh.scale.setScalar(scale); scene.add(mesh);
      const a = { side, kind, mesh, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, side ? 1 : -1), speed: 60, hp: 60, alive: false, falling: false, respawnT: rnd() * 3, fireT: 0, scanT: 0, wp: new THREE.Vector3(), tgt: null, evade: 0, roll: 0, runDir: side ? 1 : -1, laneX: 0, alt: 60, rad: kind === 'fighter' ? 6 : 9 * scale, burst: 0 };
      mesh.visible = false; this.list.push(a); return a;
    };
    for (let i = 0; i < 4; i++) { add(0, 'fighter'); add(1, 'fighter'); }
    for (let i = 0; i < 3; i++) add(1, 'gunship', 1.35);
    for (let i = 0; i < 2; i++) add(0, 'gunship', 1.35);
    this.bombers = [[], []];
    for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) { const b = add(s, 'bomber', 1.5); b.respawnT = Infinity; this.bombers[s].push(b); }
    // missiles
    const mg = new THREE.BoxGeometry(0.5, 0.5, 2.8);
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.6), toneMapped: false })); m.visible = false; scene.add(m); this.missiles.push({ m, alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, tgt: null, life: 0 }); }
    this.strikeT = [14, 30]; this.artT = 5; this.ready = true;
  }
  spawn(a) {
    const G = this.G; a.alive = true; a.falling = false; a.mesh.visible = true; a.tgt = null; a.burst = 0;
    const rear = a.side === 0 ? 1 : -1;
    if (a.kind === 'fighter') { a.hp = 60; a.speed = rr(95, 120); a.pos.set(rr(-500, 500), rr(190, 320), rear * rr(700, 900)); a.dir.set(0, 0, -rear); a.wp.set(rr(-400, 400), rr(190, 300), rr(-300, 300)); a.evade = 3; }
    else if (a.kind === 'gunship') { a.hp = 150; a.speed = 40; a.runDir = -rear; a.laneX = pick(AVENUES) + rr(-22, 22); a.alt = rr(52, 74); a.pos.set(a.laneX, a.alt + 30, rear * rr(820, 900)); a.dir.set(0, 0, -rear); }
  }
  kill(a, byPlayer) {
    if (!a.alive || a.falling) return;
    const G = this.G; a.falling = true; a.vy = 0; a.spinR = rr(-3, 3);
    G.fx.explosion(a.pos.x, a.pos.y, a.pos.z, a.kind === 'fighter' ? 1.4 : 2.2); G.fx.debris(a.pos.x, a.pos.y, a.pos.z, 4, 0.8, 18, 0.1);
    G.stats.deadAir[a.side]++; if (byPlayer && a.side === 0) G.ffKill('air'); else if (byPlayer) { G.stats.kAir++; G.announce(a.kind === 'fighter' ? 'INTERCEPTOR DOWN' : a.kind === 'gunship' ? 'GUNSHIP DOWN' : 'BOMBER DOWN'); }
  }
  damage(a, dmg, byPlayer = true) { if (!a.alive || a.falling) return; a.hp -= dmg; this.G.fx.sparks(a.pos.x, a.pos.y, a.pos.z, 5, 14); if (a.hp <= 0) this.kill(a, byPlayer); }
  steer(a, tx, ty, tz, rate, dt) {
    _d.set(tx - a.pos.x, ty - a.pos.y, tz - a.pos.z).normalize();
    const ang = a.dir.angleTo(_d); if (ang < 1e-4) return 0;
    _t.copy(a.dir); a.dir.lerp(_d, Math.min(1, rate * dt / ang)).normalize();
    return (_t.x * a.dir.z - _t.z * a.dir.x) / Math.max(dt, 1e-3);   // signed turn for banking
  }
  lockCandidate(cp, cd) {
    let best = null, ba = 0.17;
    for (const a of this.list) {
      if (a.side !== 1 || !a.alive || a.falling) continue;
      _v.subVectors(a.pos, cp); const d = _v.length(); if (d > 800) continue;
      const ang = Math.acos(clamp(_v.dot(cd) / d, -1, 1)); if (ang < ba) { ba = ang; best = a; }
    }
    return best;
  }
  rayAir(o, d, maxT, side) {
    let best = null, bt = maxT;
    for (const a of this.list) {
      if (a.side === side || !a.alive || a.falling) continue;
      const px = a.pos.x - o.x, py = a.pos.y - o.y, pz = a.pos.z - o.z, t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > bt) continue;
      const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t; if (qx * qx + qy * qy + qz * qz < a.rad * a.rad) { bt = t; best = a; }
    }
    return best ? { t: bt, ac: best } : null;
  }
  launchMissile(p, d, tgt) {
    const m = this.missiles.find(x => !x.alive); if (!m) return;
    m.alive = true; m.pos.copy(p); m.dir.copy(d); m.speed = 55; m.tgt = tgt; m.life = 5.5; m.m.visible = true;
  }
  strike(side) {
    const G = this.G, rear = side === 0 ? 1 : -1;
    const cl = G.units.findCluster(side, 0, G.units.frontZ(1 - side), 900); if (!cl) return;
    this.bombers[side].forEach((b, i) => {
      if (b.alive) return;
      b.alive = true; b.falling = false; b.mesh.visible = true; b.hp = 150; b.speed = 88; b.dir.set(0, 0, -rear); b.runDir = -rear;
      b.pos.set(cl.lane + (i - 1) * 26, 165 + (i === 1 ? 0 : 8), rear * (960 + (i === 1 ? 0 : 45))); b.zc = cl.z - rear * 30; b.fireT = 0; b.dropped = 0;
    });
    if (side === 0) G.announce('VIGIL BOMBERS INBOUND');
  }

  update(dt) {
    const G = this.G, fx = G.fx, cam = G.camera.position, pl = G.player;
    for (const a of this.list) {
      if (!a.alive) { a.respawnT -= dt; if (a.respawnT <= 0 && a.kind !== 'bomber') this.spawn(a); continue; }
      if (a.falling) {
        a.vy -= 30 * dt; a.pos.addScaledVector(a.dir, a.speed * 0.8 * dt); a.pos.y += a.vy * dt; a.roll += a.spinR * dt;
        fx.fire(a.pos.x, a.pos.y, a.pos.z, rr(-2, 2), rr(-2, 2), rr(-2, 2), 0.5, 7, 3, 3.4, 1.4, 0.3, 1);
        fx.smoke(a.pos.x, a.pos.y, a.pos.z, rr(-2, 2), rr(0, 3), rr(-2, 2), rr(2.5, 4.5), 4, 15, 0.05, 0.7, 0.3);
        const b = G.city.solid(a.pos.x, a.pos.y, a.pos.z);
        if (a.pos.y <= 2 || b) {
          fx.explosion(a.pos.x, Math.max(1, a.pos.y), a.pos.z, 2.6); G.blast(a.pos.x, a.pos.y, a.pos.z, 12, 150, -1);
          if (b) G.city.damage(b, 200, a.dir.x, a.dir.z);
          a.alive = false; a.mesh.visible = false; a.respawnT = a.kind === 'bomber' ? Infinity : rr(8, 16);
        }
      } else if (a.kind === 'fighter') {
        a.evade -= dt; a.scanT -= dt;
        if (a.scanT <= 0 || (a.tgt && (!a.tgt.alive || a.tgt.falling))) { a.scanT = rr(5, 9); const foes = this.list.filter(o => o.side !== a.side && o.alive && !o.falling && o.kind === 'fighter'); a.tgt = foes.length ? pick(foes) : null; }
        let turn = 0;
        const out = Math.abs(a.pos.x) > 620 || Math.abs(a.pos.z) > 760;
        if (a.tgt && a.evade <= 0 && !out) {
          const dist = a.pos.distanceTo(a.tgt.pos);
          if (dist < 75) { a.evade = rr(2.5, 4.5); a.wp.set(rr(-450, 450), rr(190, 310), rr(-450, 450)); }
          turn = this.steer(a, a.tgt.pos.x, clamp(a.tgt.pos.y, 180, 330), a.tgt.pos.z, 0.95, dt);
          _v.subVectors(a.tgt.pos, a.pos).normalize();
          if (dist < 340 && _v.dot(a.dir) > 0.975) {
            a.fireT -= dt;
            if (a.fireT <= 0) {
              a.fireT = 0.07; const T = PAL[a.side].tracer, tp = a.tgt.pos;
              fx.tracer(a.pos.x, a.pos.y, a.pos.z, tp.x + rr(-9, 9), tp.y + rr(-9, 9), tp.z + rr(-9, 9), 520, 26, 0.7, T[0], T[1], T[2]);
              if (rnd() < 0.03) this.damage(a.tgt, 40, false);
            }
          }
        } else {
          if (out) a.wp.set(rr(-300, 300), rr(200, 300), rr(-300, 300));
          else if (a.pos.distanceTo(a.wp) < 80) a.wp.set(rr(-450, 450), rr(190, 310), rr(-450, 450));
          turn = this.steer(a, a.wp.x, a.wp.y, a.wp.z, 0.95, dt);
        }
        a.roll += (clamp(-turn * 1.6, -1.3, 1.3) - a.roll) * Math.min(1, 4 * dt);
        a.pos.addScaledVector(a.dir, a.speed * dt);
      } else if (a.kind === 'gunship') {
        if (a.pos.z * a.runDir > 860) { a.runDir *= -1; a.laneX = pick(AVENUES) + rr(-22, 22); a.alt = rr(52, 74); }
        const turn = this.steer(a, a.laneX, a.alt, a.pos.z + a.runDir * 160, 0.55, dt);
        a.roll += (clamp(-turn * 1.4, -0.7, 0.7) - a.roll) * Math.min(1, 3 * dt);
        // targets
        a.scanT -= dt;
        if (a.scanT <= 0) {
          a.scanT = 0.5; a.tgt = null; a.tp = false;
          if (a.dir.z * a.runDir > 0.8) {
            if (a.side === 1 && !pl.dead) { const dz = (pl.pos.z - a.pos.z) * a.runDir; if (dz > 30 && dz < 280 && Math.abs(pl.pos.x - a.pos.x) < 110 && rnd() < 0.7) a.tp = true; }
            if (!a.tp) { const cl = G.units.findCluster(a.side, a.pos.x, a.pos.z + a.runDir * 110, 120); if (cl && (cl.z - a.pos.z) * a.runDir > 20) a.tgt = cl; }
          }
        }
        const engaging = a.tp || a.tgt;
        a.speed += ((engaging ? 17 : 44) - a.speed) * Math.min(1, dt * 0.9);
        if (engaging) {
          a.fireT -= dt;
          if (a.fireT <= 0) {
            a.fireT = 0.085; const T = PAL[a.side].tracer, side = a.side, tp = a.tp;
            const hx = (tp ? pl.pos.x : a.tgt.lane) + rr(-7, 7), hz = (tp ? pl.pos.z : a.tgt.z) + rr(-9, 9), hy = tp ? rr(0, 14) : 0.3;
            _p.copy(a.pos).addScaledVector(a.dir, 12); _p.y -= 2.5;
            fx.tracer(_p.x, _p.y, _p.z, hx, hy, hz, 480, 24, 0.55, T[0] * 1.2, T[1] * 1.2, T[2] * 1.2, () => {
              fx.impact(hx, hy, hz, 0.9);
              if (tp) { if (!pl.dead && Math.hypot(pl.pos.x - hx, pl.pos.z - hz) < 5) pl.damage(0.9, rnd() < 0.3 ? 'leg' : 'hull'); }
              else G.blast(hx, 0.3, hz, 3.2, 20, side);
            });
            _d.set(hx - _p.x, hy - _p.y, hz - _p.z).normalize(); fx.muzzle(_p, _d, 1, T[0], T[1], T[2]);
            if ((a.burst++ % 5) === 0) G.sfx.crack(fx.camDist(_p.x, _p.y, _p.z) * 0.4);
          }
        }
        a.pos.addScaledVector(a.dir, a.speed * dt);
      } else { // bomber
        a.pos.addScaledVector(a.dir, a.speed * dt);
        if (Math.abs(a.pos.z - a.zc) < 95) {
          a.fireT -= dt;
          if (a.fireT <= 0) {
            a.fireT = 0.2; const side = a.side, hx = a.pos.x + rr(-9, 9), hz = a.pos.z + a.runDir * 70 + rr(-6, 6), near = fx.camDist(hx, 0, hz) < 300;
            fx.tracer(a.pos.x, a.pos.y - 3, a.pos.z, hx, 0.3, hz, 135, 5, 1.3, 1.2, 0.5, 0.2, () => { fx.explosion(hx, 0.5, hz, 2.1); G.blast(hx, 0.5, hz, 13, 160, side); const b = G.city.solid(hx, 6, hz); if (b) G.city.damage(b, 60); });
            if (near && a.dropped++ % 4 === 0) G.sfx.whistle(1.2, 0.07);
          }
        }
        if (a.pos.z * a.runDir > 1050) { a.alive = false; a.mesh.visible = false; a.respawnT = Infinity; }
      }
      a.mesh.position.copy(a.pos); _v.copy(a.pos).add(a.dir); a.mesh.lookAt(_v); a.mesh.rotateZ(a.roll);
      // engine glow
      if (!a.falling && Math.abs(a.pos.x - cam.x) + Math.abs(a.pos.z - cam.z) < 900) { const T = PAL[a.side].glow, e = a.kind === 'fighter' ? 7 : 11 * a.mesh.scale.x; fx.fire(a.pos.x - a.dir.x * e, a.pos.y - a.dir.y * e, a.pos.z - a.dir.z * e, 0, 0, 0, 0.09, a.kind === 'fighter' ? 6 : 13, 2, T[0], T[1], T[2], 1); }
    }
    // ---------- player AA missiles ----------
    for (const m of this.missiles) {
      if (!m.alive) continue;
      m.life -= dt; m.speed = Math.min(200, m.speed + 190 * dt);
      const t = m.tgt;
      if (t && t.alive && !t.falling && m.life < 5.2) {
        const dist = m.pos.distanceTo(t.pos), lead = Math.min(1.2, dist / m.speed);
        _d.copy(t.pos).addScaledVector(t.dir, t.speed * lead).sub(m.pos).normalize();
        const ang = m.dir.angleTo(_d);
        if (ang > 1.25) m.tgt = null;   // limited seeker: lock breaks off-boresight
        else if (ang > 1e-4) m.dir.lerp(_d, Math.min(1, 1.25 * dt / ang)).normalize();
        if (dist < 10) { this.damage(t, 55, true); m.life = 0; }
      }
      m.pos.addScaledVector(m.dir, m.speed * dt);
      for (let k = 0; k < 2; k++) fx.smoke(m.pos.x - m.dir.x * k * 1.5, m.pos.y - m.dir.y * k * 1.5, m.pos.z - m.dir.z * k * 1.5, rr(-1, 1), rr(-1, 1), rr(-1, 1), rr(1.5, 2.8), 1.6, 6.5, 0.55, 0.6, 0.5);
      fx.fire(m.pos.x - m.dir.x * 2, m.pos.y - m.dir.y * 2, m.pos.z - m.dir.z * 2, 0, 0, 0, 0.08, 5, 1.5, 4, 2.6, 1, 1);
      const hitB = G.city.solid(m.pos.x, m.pos.y, m.pos.z);
      if (m.life <= 0 || m.pos.y < 0.5 || hitB) {
        fx.explosion(m.pos.x, m.pos.y, m.pos.z, 1.1); G.blast(m.pos.x, m.pos.y, m.pos.z, 6, 60, 0, true);
        m.alive = false; m.m.visible = false; continue;
      }
      m.m.position.copy(m.pos); _v.copy(m.pos).add(m.dir); m.m.lookAt(_v);
    }
    // ---------- air strikes ----------
    for (let s = 0; s < 2; s++) { this.strikeT[s] -= dt; if (this.strikeT[s] <= 0) { this.strikeT[s] = s === 0 ? rr(30, 46) : rr(42, 64); this.strike(s); } }
    // ---------- artillery ----------
    this.artT -= dt;
    if (this.artT <= 0) {
      this.artT = rr(6, 12); const side = rnd() < 0.5 ? 0 : 1, rear = side === 0 ? 1 : -1;
      const cz = G.units.frontZ(1 - side) - rear * rr(0, 220), cx = pick(LANES) + rr(-60, 60), a = rnd() * 6.28, n = Math.floor(rr(5, 9));
      for (let k = 0; k < n; k++) this.shells.push({ t: 0.6 + k * 0.42, x: cx + Math.cos(a) * k * 24 + rr(-6, 6), z: cz + Math.sin(a) * k * 24 + rr(-6, 6), side, rear });
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]; s.t -= dt; if (s.t > 0) continue;
      this.shells.splice(i, 1);
      const d = fx.camDist(s.x, 0, s.z); if (d < 380) G.sfx.whistle(1.25, Math.min(0.16, 14 / Math.max(d, 60)));
      const x = s.x, z = s.z, side = s.side;
      fx.tracer(x + rr(-40, 40), 520, z + s.rear * 190, x, 0.3, z, 440, 60, 1.5, 3, 1.5, 0.6, () => {
        fx.explosion(x, 0.5, z, 2.4); G.blast(x, 0.5, z, 14, 200, side);
        const b = G.city.solid(x, 8, z); if (b) G.city.damage(b, 70);
      });
    }
  }
}
