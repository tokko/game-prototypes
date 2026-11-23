import * as THREE from 'three';
import { PAL, rnd, rr, pick, clamp, damp, angDiff } from './util.js?v=32';
import { Legs } from './legs.js?v=32';
import { makeColossus } from './walker.js?v=32';
import { setupHeavy, resetHeavy, strike, tickHeavy, armOk, speedMul, spendEnergy, chargeDrain, chargeDone, chargeCancel, aiMayFire, isTargeted, splashEngines, foeWeak, wardTurn, heavyDown, COST } from './heavy.js?v=32';

const _v = new THREE.Vector3(), _m = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
export const COL_HP = 2400, COL_SHIELD = 900, TOP = 10, RESPAWN = 150;   // RESPAWN: seconds from the kill until the next engine strides in (princeps spec: one great colossus a side)
const _sp = new THREE.Vector3();   // TOP: m/s (was 6.2; speed pass, model/objectives-facings-spec.md section 6)

// ward-shield bubble material (also used by the Hierarch class)
export function shieldMaterial(side) {
  return new THREE.ShaderMaterial({ uniforms: { uC: { value: new THREE.Color(...PAL[side].glow) }, uA: { value: 0 }, uF: { value: new THREE.Vector4() }, uT: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uC; uniform float uA, uT; uniform vec4 uF; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); vec3 c = uC * (0.01 + f * f) * 0.45 * uA;
        // collapsed / rebooting facing: a hot flare and crackle on that arc of the dome (uF = front, left, right, rear), local +z forward, +x the walker's left
        vec3 p = normalize(vP); float an = atan(p.x, p.z), aa = abs(an), wF = 1.0 - step(1.0472, aa), wR = step(2.3562, aa), wS = 1.0 - wF - wR;
        float k = uF.x * wF + wS * (an > 0.0 ? uF.y : uF.z) + uF.w * wR, cr = 0.5 + 0.5 * sin(p.y * 38.0 + p.x * 21.0 + uT * 46.0) * sin(p.z * 29.0 - uT * 37.0);
        c += vec3(1.0, 0.34, 0.12) * k * (0.3 + 0.5 * f + 1.1 * cr * cr); gl_FragColor = vec4(c, 1.0); }` });
}

export class Colossus {
  constructor(G, side, lane, startZ, holdZ, name) {
    this.G = G; this.side = side; this.dir = side === 0 ? -1 : 1; this.lane = lane; this.name = name; this.s = side ? 1.08 : 1.0;
    const scene = G.scene, s = this.s;
    this.lanceMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });   // per-instance lance charge tell (model/colossus.glb lance_glow)
    const rig = this.rig = makeColossus(side, { lance_glow: this.lanceMat });
    this.root = rig.root; this.root.scale.setScalar(s); scene.add(this.root);
    this.body = rig.body; this.torso = rig.torso; this.armL = rig.arm_L; this.armR = rig.arm_R; this.barrels = rig.barrels_L;
    this.mzL = rig.anchor_gatling; this.mzR = rig.anchor_lance; this.mzTop = rig.anchor_battery; this.head = rig.anchor_head;
    this.shield = new THREE.Mesh(new THREE.IcosahedronGeometry(46, 2), shieldMaterial(side));
    this.shield.position.y = 18; this.shield.scale.set(1, 1.15, 0.9); this.torso.add(this.shield); this.shieldA = 0;
    this.legs = new Legs(scene, { hipW: 14 * s, thighL: 25 * s, shinL: 27 * s, stride: 37 * s, stepTime: 1.4, stepH: 9 * s, footH: 5 * s, refSpeed: 11.7, knee: 1, makeParts: rig.legParts, onStep: f => this.onStep(f) });
    for (const f of this.legs.feet) { f.thigh.scale.setScalar(s); f.shin.scale.setScalar(s); f.foot.scale.setScalar(s); }
    const sg = new THREE.CircleGeometry(34, 20); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); scene.add(this.shadow);
    // hunting searchlight
    this.spot = new THREE.Mesh(G.city.beamGeo, new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(1.0, 0.25, 0.12) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uC; varying vec2 vUv; void main(){ float a = (0.25 + 0.75 * pow(vUv.y, 1.2)) * 0.5; gl_FragColor = vec4(uC * a, 1.0); }' }));
    this.spot.visible = false; this.spot.frustumCulled = false; this.spot.renderOrder = 9; scene.add(this.spot);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.aimLag = new THREE.Vector3(); this.lanceAim = new THREE.Vector3();
    // hit points (see rayHit): child empties along each arm and on the head, so the locational test and the shot test share one set
    const hpt = (par, x, y, z) => { const e = new THREE.Object3D(); e.position.set(x, y, z); par.add(e); return e; };
    setupHeavy(this, 'colossus', COL_HP, COL_SHIELD, TOP, { head: hpt(rig.head, 0, -1, 4), armL: [this.armL, hpt(this.armL, 0, -4, 12), hpt(this.armL, 0, -4, 28), hpt(this.armL, 0, -4, 40)], armR: [this.armR, hpt(this.armR, 0, -4, 12), hpt(this.armR, 0, -4, 28), hpt(this.armR, 0, -4, 44)],
      reactor: rig.anchor_reactor, mp: this.torso, rArm: 9.5 * s, rHead: 8 * s, legTop: 40 * s });
    this.holdBase = holdZ; this.enter(startZ);
  }
  enter(z) {
    this.pos.set(this.lane, 0, z); this.yaw = this.dir > 0 ? 0 : Math.PI; this.torsoYaw = this.yaw; this.pitch = 0;
    this.hp = COL_HP; this.shieldHP = COL_SHIELD; this.lastDmg = -99; this.firstDmg = -1; this.crippleT = 0; this.grudgeT = 0; this.grudge = 0; this.lastHunt = -99; this.hurtByPlayerT = -99; this.cdT = 0; this.klaxT = 0; this.rakeDead = false; this.state = 'alive'; this.t = 0; this.bob = 0; this.bobV = 0; this.speed = 0; this.sink = 0; this.lean = 0;
    this.holdZ = this.holdBase; this.holdT = rr(18, 30); this.goal = null; this.vel.set(0, 0, 0);
    this.lanceT = rr(5, 10); this.charge = 0; this.mode = null; this.rakeT = rr(3, 8); this.rakeLeft = 0; this.rakeAcc = 0; this.rakeN = 0;
    this.cannonT = rr(15, 60); this.huntT = rr(18, 30); this.anger = 0; this.alarmT = 0;
    this.root.visible = true; this.legs.setVisible(true); this.shadow.visible = true; this.legs.reset(this.pos, this.yaw); this.lanceMat.color.setRGB(0, 0, 0); resetHeavy(this);
  }
  get alive() { return this.state === 'alive'; }
  chest(out) { return out.set(this.pos.x, 66 * this.s - this.sink, this.pos.z); }
  get limp() { return this.crippleT > 0 || this.hp < COL_HP * 0.3; }
  onStep(f) { this.bobV -= this.limp && f.side > 0 ? 9 : 3.5; this.G.stomp(f.pos.x, f.pos.z, 12 * this.s, this); }
  damage(amt, byPlayer, bypass, pt, hAmt, under) {
    if (!this.alive) return;
    const G = this.G; this.lastDmg = G.time; if (this.firstDmg < 0) this.firstDmg = G.time;
    if (byPlayer) { this.anger += amt; this.hurtByPlayerT = G.time; G.stats.colDmg += amt; }
    if (byPlayer && this.side === 0) {   // keep shooting your own colossus and it holds a grudge
      this.grudge = (this.grudge || 0) + amt; G.ffKill('col', true);
      if (this.grudge > 110 && !(this.grudgeT > 0)) { this.grudgeT = 24; this.grudge = 0; this.lastHunt = -99; G.lastHunt = -99; G.announce(this.name + ' TURNS ITS GUNS ON YOU'); }
    }
    const r = strike(this, amt, hAmt === undefined ? amt : hAmt, pt, bypass, byPlayer, under);   // shield first, then a component
    if (r.ab > 0) this.shieldA = Math.min(0.9, this.shieldA + 0.14 + r.ab * 0.003);
    if (r.down) { this.shieldA = 2.2; G.fx.flash(this.pos.x, 66 * this.s, this.pos.z, 0.7, 0.9, 1, 9000, 0.5, 400); G.announce(this.name + ' - SHIELD DOWN'); }
    if (this.hp <= 0 || this.comp.reactor.hp <= 0) {
      this.state = 'dying'; this.t = 0; this.spot.visible = false; this.mode = null; this.rakeLeft = 0; G.stats.colKills[this.side]++; heavyDown(this, byPlayer);
      (G.stats.colTTK = G.stats.colTTK || []).push(+(G.time - this.firstDmg).toFixed(0));
      G.announce(this.name + ' - REACTOR CRITICAL');
    }
  }
  // the player's sunspear: shreds a strong shield, bypasses a weak one; legs and rear are the soft spots
  spearHit(d, leg, pt) {
    if (!this.alive) return;
    const G = this.G, rear = d.x * Math.sin(this.torsoYaw) + d.z * Math.cos(this.torsoYaw) > 0.3;
    let dmg = 520 * (leg || rear ? 1.6 : 1);
    if (!leg && this.shieldHP > 0) this.shieldA = 1.8;   // the lance passes straight through the ward (flare only, no absorb)
    this.damage(dmg, true, true, leg ? { x: pt.x, y: pt.y, z: pt.z, comp: 'legs', cap: 0.6 } : { x: pt.x, y: pt.y, z: pt.z, cap: 0.6 });   // the damage lands on the struck component
    if (leg || rear) { this.crippleT = 14; this.bobV -= 9; if (this.alive) G.announce(this.name + ' STAGGERS'); }
    G.fx.debris(pt.x, pt.y, pt.z, 8, 1.6, 22, 0.1); G.stats.spearCol = (G.stats.spearCol || 0) + 1;
  }
  // ray vs the two legs, measured on model/colossus.glb (thigh 14.2 x 15.9, shin 13 x 22.5, foot 15.6 x 9.8 x 34): per leg a capsule hip to ankle
  // (radius 8.5) and a foot capsule heel to toe (radius 5.5), sampled; returns {t} or null
  rayLeg(o, d, maxT) {
    if (this.state === 'gone' || this.state === 'wreck') return null;
    const s = this.s, lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw); let best = null;
    for (const f of this.legs.feet) {
      const hx = this.pos.x + lx * f.side * 11.5 * s, hz = this.pos.z + lz * f.side * 11.5 * s, hy = 45 * s - this.sink, fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      const ax = f.pos.x + fx * 2.5 * s, ay = f.pos.y + 5 * s, az = f.pos.z + fz * 2.5 * s;   // foot centre (GLB foot z -14.5..19.5, y 0..9.8)
      for (const [x0, y0, z0, x1, y1, z1, rr2, n] of [[ax, ay, az, hx, hy, hz, 72.25 * s * s, 6], [ax - fx * 14 * s, ay, az - fz * 14 * s, ax + fx * 14.5 * s, ay, az + fz * 14.5 * s, 30.25 * s * s, 4]]) for (let k = 0; k <= n; k++) {
        const u = k / n, px = x0 + (x1 - x0) * u - o.x, py = y0 + (y1 - y0) * u - o.y, pz = z0 + (z1 - z0) * u - o.z;
        const t = px * d.x + py * d.y + pz * d.z; if (t < 0 || t > maxT) continue;
        const qx = px - d.x * t, qy = py - d.y * t, qz = pz - d.z * t;
        if (qx * qx + qy * qy + qz * qz < rr2) { maxT = t; best = { t: Math.max(0, t - 5 * s) }; }
      }
    }
    return best;
  }
  // hit volumes measured on the GLB (root space, rest pose, unscaled metres): torso as stacked boxes in the torso-yaw frame (lat, y, fwd): lower hull
  // (+-17.5, y 48..60), main block with pauldrons and battery (+-35.6, y 58..90, z +-21.7), carapace (+-21.6, y 90..100, z -19.9..7.2), crossing spire
  // (+-9.5, y 100..110, z -14..4.5), mast (+-4.4, y 110..125); pelvis boxes in the leg-yaw frame; plus the locational spheres: head (r 8), arm points
  // (r 9.5: housing, barrel, muzzle). A ray hits the nearest of all of them.
  rayHit(o, d, maxT) {
    if (this.state === 'gone') return -1;
    const s = this.s, px = this.pos.x - o.x, pz = this.pos.z - o.z, py = 70 * s - this.sink - o.y, bs = px * d.x + py * d.y + pz * d.z, bc = px * px + py * py + pz * pz - 6400 * s * s;   // bounding sphere r 80 s
    if (bs * bs - bc < 0 || bs < -80 * s) return -1;
    let best = -1; const g = this.geo;
    const hit = t => { if (t >= 0 && t <= maxT && (best < 0 || t < best)) best = t; };
    const sph = (cx, cy, cz, r) => { const x = cx - o.x, y = cy - o.y, z = cz - o.z, b = x * d.x + y * d.y + z * d.z, c = x * x + y * y + z * z - r * r, disc = b * b - c; if (disc >= 0) hit(b - Math.sqrt(disc)); };
    const boxes = (ang, list) => {   // slab test per oriented box; box = [cx, cy, cz (lat, y, fwd), hx, hy, hz]
      const cs = Math.cos(ang), sn = Math.sin(ang), ox = o.x - this.pos.x, oz = o.z - this.pos.z, oy = o.y + this.sink;
      const qx = ox * cs - oz * sn, qy = oy, qz = ox * sn + oz * cs, vx = d.x * cs - d.z * sn, vy = d.y, vz = d.x * sn + d.z * cs;
      for (const [cx, cy, cz, hx, hy, hz] of list) {
        let t0 = 0, t1 = 1e9, ok = true;
        for (const [q, v, c, h] of [[qx, vx, cx * s, hx * s], [qy, vy, cy * s, hy * s], [qz, vz, cz * s, hz * s]]) {
          if (Math.abs(v) < 1e-9) { if (Math.abs(q - c) > h) { ok = false; break; } continue; }
          let a = (c - h - q) / v, b = (c + h - q) / v; if (a > b) { const w = a; a = b; b = w; }
          t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; }
        }
        if (ok) hit(t0);
      }
    };
    boxes(this.torsoYaw, [[0, 54, 0.15, 17.5, 6, 21.8], [0, 74, 0, 35.6, 16, 21.7], [0, 95, -6.35, 21.6, 5, 13.55], [0, 105, -4.75, 9.5, 5, 9.25], [0, 117.5, -9, 4.4, 7.5, 4]]);
    boxes(this.yaw, [[0, 45, 0.25, 21, 7, 9.9], [0, 26, 0, 5.5, 12, 9.6]]);
    _v.setFromMatrixPosition(g.head.matrixWorld); sph(_v.x, _v.y, _v.z, g.rHead);
    for (const k of ['armL', 'armR']) for (const n of g[k]) { _v.setFromMatrixPosition(n.matrixWorld); sph(_v.x, _v.y, _v.z, g.rArm); }
    return best;
  }
  // nearest enemy engine: a great colossus counts at its distance, a hierarch at distance / 0.7, a harrow at distance / 0.5
  enemyCol() {
    if (this.ordTgt && this.ordTgt.alive) return this.ordTgt;   // ordered to KILL it
    let best = null, bd = 900; const px = this.pos.x, pz = this.pos.z;   // foeWeak: +0.3 weight on an engine with a collapsed arc facing us
    for (const c of this.G.colossi) { if (c.side === this.side || !c.alive) continue; const d = c.pos.distanceTo(this.pos) / (1 + foeWeak(c, px, pz)); if (d < bd) { bd = d; best = c; } }
    for (const h of this.G.hierarchs) { if (h.side === this.side || !h.alive) continue; const d = h.pos.distanceTo(this.pos) / (0.7 + foeWeak(h, px, pz)); if (d < bd) { bd = d; best = h; } }
    for (const h of this.G.harrows) { if (h.side === this.side || !h.alive) continue; const d = h.pos.distanceTo(this.pos) / (0.5 + foeWeak(h, px, pz)); if (d < bd) { bd = d; best = h; } }   // a harrow weighs 0.5
    if (!best && (!this.G.objectives || this.G.objectives.holds(this.side) >= 3)) for (const b of this.G.bastions) { if (b.side === this.side || b.hp <= 0) continue; const st = b.gen.alive ? b.gen : b, d = Math.hypot(st.pos.x - this.pos.x, st.pos.z - this.pos.z); if (d < bd) { bd = d; best = st; } }   // nothing else to fight: the enemy ward generator, then the bastion
    return best;
  }

  fireLance() {
    const G = this.G, fx = G.fx, C = PAL[this.side].glow;
    if (this.mode === 'pilot') chargeDone(this); else spendEnergy(this, COST.lance);   // an energy shot: 100 from the ARMS bank
    this.mzR.getWorldPosition(_m); _d.subVectors(this.lanceAim, _m); const dist = _d.length(); _d.multiplyScalar(1 / dist);
    const hit = G.city.raycast(_m.x, _m.y, _m.z, _d.x, _d.y, _d.z, this.mode === 'duel' && this.miss ? 900 : dist);
    let end = _t, tgtHit = false; end.brk = true; end.lance = true;   // the lance is a breaker: it pauses that facing's regen for 11 s (about its cycle)
    if (hit && hit.b && hit.t < dist - 4) { end.copy(_m).addScaledVector(_d, hit.t); G.city.damage(hit.b, this.mode === 'hunt' || this.mode === 'pilot' ? 2500 : 250, _d.x, _d.z, false, this.mode === 'pilot'); fx.debris(end.x, end.y, end.z, 8, 2, 26, 0.09); }
    else if (hit && this.miss) { end.copy(_m).addScaledVector(_d, hit.t); if (hit.b) G.city.damage(hit.b, 250, _d.x, _d.z); }
    else if (this.mode === 'duel' && this.miss) end.copy(_m).addScaledVector(_d, 900);
    else { end.copy(this.lanceAim); tgtHit = true; }
    fx.beam(_m, end, 3.2 * this.s, C[0] * 1.3, C[1] * 1.3, C[2] * 1.3, 1.1); fx.beam(_m, end, 1.0, 3.5, 3.5, 3, 1.1);
    fx.flash(_m.x, _m.y, _m.z, C[0], C[1], C[2], 7000, 0.8, 400); fx.explosion(end.x, end.y, end.z, 3.2);
    G.sfx.lance(Math.min(fx.camDist(_m.x, _m.y, _m.z), fx.camDist(end.x, end.y, end.z)));
    G.skyFlash = Math.min(1.5, G.skyFlash + 0.6);
    if (this.mode === 'duel') { if (this.target && this.target.isHierarch) this.target.shotByColT = G.time; if (tgtHit && this.target && this.target.alive) { this.target._src = { x: this.pos.x, z: this.pos.z }; this.target.damage(300, false, false, { x: this.target.pos.x, y: end.y, z: this.target.pos.z, brk: true, lance: true }, 900); fx.debris(end.x, end.y, end.z, 4, 1.6, 30, 0.1); } }
    else if (this.mode === 'pilot') {   // the player's lance: blast at the crosshair point plus a direct hit on any engine there
      G.blast(end.x, end.y, end.z, 17, 300, -1, true);
      for (const e of G.colossi.concat(G.hierarchs, G.harrows)) if (e !== this && e.alive && Math.hypot(e.pos.x - end.x, e.pos.z - end.z) < 26 && end.y < 110) { e._src = { x: this.pos.x, z: this.pos.z }; e.damage(300, true, false, end, 900); }
      for (const st of G.structs) if (st.alive && st.side === 1 && Math.hypot(st.pos.x - end.x, st.pos.z - end.z) < 17 + st.radius) st.damage(300, true, false, end, 900);   // ward generators, turrets and the bastion itself
      for (let k = 0; k < 6; k++) fx.explosion(end.x + rr(-9, 9), 1, end.z + rr(-9, 9), 1.4, { silent: true });
    }
    else if (this.mode === 'hunt') {
      G.blast(end.x, end.y, end.z, 17, 300, this.side);
      if (tgtHit && !G.player.dead) { const d = Math.hypot(G.player.pos.x - end.x, G.player.pos.z - end.z); if (d < 8.5) G.player.damage(999); else if (d < 24) G.player.damage(45 * (1 - d / 24), rnd() < 0.5 ? 'leg' : 'hull'); }
      for (let k = 0; k < 6; k++) fx.explosion(end.x + rr(-9, 9), 1, end.z + rr(-9, 9), 1.4, { silent: true });
    }
  }

  update(dt) {
    const G = this.G, fx = G.fx, s = this.s, pl = G.player;
    this.t += dt;
    if (this.state === 'gone') { if (G.time - this.diedAt > RESPAWN) { this.enter(-this.dir * 760); G.announce(this.name + ' STRIDES INTO THE DISTRICT'); } return; }
    if (this.state !== 'alive') {
      if (this.state === 'dying') {
        // set piece: reactor goes critical (glow + klaxon), then the engine topples forward and detonates
        const fxx = Math.sin(this.torsoYaw), fzz = Math.cos(this.torsoYaw), cd = fx.camDist(this.pos.x, 60, this.pos.z);
        const rx = this.pos.x - fxx * 20 * s, rz = this.pos.z - fzz * 20 * s, ry = 62 * s - this.sink, pulse = 0.55 + 0.45 * Math.sin(this.t * 13);
        fx.fire(rx + rr(-3, 3), ry + rr(-3, 3), rz + rr(-3, 3), 0, 0, 0, 0.12, (12 + 34 * Math.min(1, this.t / 4)) * pulse, 4, 4, 2.0, 0.7, 1);
        this.klaxT -= dt; if (this.klaxT <= 0) { this.klaxT = 0.7; G.sfx.klaxon(Math.min(0.25, 50 / Math.max(60, cd))); fx.flash(rx, ry, rz, 1, 0.45, 0.15, 7000, 0.35, 320); }
        if (rnd() < dt * 5) { const y = rr(40, 95) * s; fx.explosion(this.pos.x + rr(-22, 22), y, this.pos.z + rr(-14, 14), rr(1.2, 2.8)); fx.debris(this.pos.x + rr(-20, 20), y, this.pos.z, 3, 1.8, 26, 0.08); }
        if (this.t > 4) { this.lean = Math.min(1.3, this.lean + dt * (0.15 + (this.t - 4) * 0.35)); this.sink = Math.min(24, this.sink + dt * 7.5); }
        if (this.t > 7.3) {
          this.state = 'wreck'; this.t = 0;
          const cx = this.pos.x + fxx * 34, cz = this.pos.z + fzz * 34;
          fx.explosion(this.pos.x, 30, this.pos.z, 6); fx.explosion(cx, 14, cz, 6, { silent: true }); fx.explosion(cx + fxx * 26, 8, cz + fzz * 26, 4.5, { silent: true });
          for (let k = 0; k < 44; k++) {   // shockwave ring
            const a = k / 44 * 6.283, c = Math.cos(a), sn = Math.sin(a);
            fx.smoke(cx + c * 14, 3, cz + sn * 14, c * rr(50, 75), rr(1, 6), sn * rr(50, 75), rr(2.5, 4.5), 12, 40, 0.15, 0.6, 1.1);
            if (k % 2) fx.fire(cx + c * 10, 2, cz + sn * 10, c * 90, 2, sn * 90, 0.5, 9, 3, 3.5, 1.6, 0.4, 1, 1.2);
          }
          fx.debris(cx, 12, cz, 18, 2.6, 34, 0.09);
          G.shakeAt(cx, 0, cz, 16); G.sfx.boom(cd, 4); G.skyFlash = 1.5;
          G.blast(cx, 0, cz, 62, 300, -1); G.blast(this.pos.x, 0, this.pos.z, 40, 300, -1);
          for (const dd of [30, 62]) { const b = G.city.lot(this.pos.x + fxx * dd, this.pos.z + fzz * dd); if (b) G.city.damage(b, 5000, fxx, fzz); }
          this.em = fx.addEmitter(cx, 22, cz, 7, 26); fx.addEmitter(this.pos.x, 30 * s, this.pos.z, 5, 26);
          G.announce(this.name + ' HAS FALLEN');
        }
      } else {
        if (this.t > 22) { this.sink += dt * 22; fx.smoke(this.pos.x + rr(-25, 25), rr(0, 20), this.pos.z + rr(-25, 25), rr(-6, 6), rr(2, 8), rr(-6, 6), rr(4, 8), 14, 44, 0.13, 0.6); }
        if (this.t > 28) { this.state = 'gone'; this.t = 0; this.root.visible = false; this.legs.setVisible(false); this.shadow.visible = false; return; }
      }
      this.applyPose(dt, 0, 0); return;
    }
    if (this.piloted) return;   // the player is driving this engine: see pilotUpdate
    // ----- walk to hold line -----
    this.holdT -= dt; if (this.holdT <= 0) { this.holdT = rr(16, 30); this.holdZ = this.holdBase + rr(-55, 55); }
    if (!this.target && !this.goal) this.holdBase = clamp(this.holdBase + this.dir * 2.5 * dt, -380, 380);   // no objective director: the lane is clear, push toward the enemy bastion
    this.crippleT = Math.max(0, this.crippleT - dt); this.grudgeT = Math.max(0, (this.grudgeT || 0) - dt); this.grudge = Math.max(0, (this.grudge || 0) - 4 * dt);
    tickHeavy(this, dt);   // capacitors, planting and shield regeneration
    const frac = this.hp / COL_HP, limp = this.limp; this.legs.o.stepTime = limp ? 2.0 : 1.4;
    // damage states: smoke, fires, sparking armour
    if (frac < 0.72 && rnd() < dt * (5 + 22 * (0.72 - frac))) fx.smoke(this.pos.x + rr(-20, 20) * s, rr(52, 92) * s, this.pos.z + rr(-12, 12) * s, rr(-2, 2) + 2, rr(4, 9), rr(-2, 2), rr(4, 8), 6, 24, 0.05, 0.6, 0.2);
    if (frac < 0.46 && rnd() < dt * 16) { const k = rnd() < 0.5 ? 1 : -1; fx.fire(this.pos.x + k * 18 * s + rr(-3, 3), (k > 0 ? 74 : 58) * s + rr(-2, 2), this.pos.z + rr(-6, 6), rr(-1, 1), rr(5, 10), rr(-1, 1), rr(0.5, 1.1), 9, 3, 3.4, rr(1, 1.6), 0.25, 0.9, 0.3); }
    if ((frac < 0.46 || this.crippleT > 0) && rnd() < dt * 2.5) { const lx = this.pos.x + rr(-22, 22) * s, ly = rr(20, 85) * s, lz2 = this.pos.z + rr(-12, 12) * s; fx.sparks(lx, ly, lz2, 12, 26); fx.flash(lx, ly, lz2, 1, 0.7, 0.3, 1500, 0.12, 120); }
    // legs: walk to the objective director's goal (a site slot or the enemy ward generator), else straight along the lane to the hold line; the legs turn at 0.55 rad/s
    const gx = this.goal ? this.goal.x : this.pos.x, gz = this.goal ? this.goal.z : this.holdZ, gdx = gx - this.pos.x, gdz = gz - this.pos.z, gd = Math.hypot(gdx, gdz), want = gd > 6 ? Math.atan2(gdx, gdz) : this.yaw;
    this.yaw += clamp(angDiff(want, this.yaw) * 3, -1, 1) * 0.55 * (limp ? 0.6 : 1) * this.legMul * dt;
    let spd = gd > 6 ? Math.min(TOP, 2 + gd * 0.2) * (limp ? 0.3 : 1) * speedMul(this) : 0; if (Math.abs(angDiff(want, this.yaw)) > 0.9) spd = Math.min(spd, 3);
    this.speed = damp(this.speed, spd, 1.3, dt); this.vel.set(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed);
    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -680, 680); this.pos.z = clamp(this.pos.z + this.vel.z * dt, -800, 800); if (G.objectives) G.objectives.collide(this.pos, 14);
    // ----- targeting -----
    this.foeT = (this.foeT || 0) - dt; if (this.foeT <= 0 || !this.target || !this.target.alive) { this.foeT = 0.4; this.target = this.enemyCol(); } const foe = this.target;
    let ax = this.pos.x, az = this.pos.z + this.dir * 300, ay = 50;
    if (this.mode === 'hunt') { ax = this.aimLag.x; az = this.aimLag.z; ay = 6; } else if (foe) { ax = foe.pos.x; az = foe.pos.z; ay = 66; }
    const aimA = Math.atan2(ax - this.pos.x, az - this.pos.z), wantYaw = clamp(angDiff(aimA, this.yaw), -1.5, 1.5) + this.yaw + (foe ? wardTurn(this, aimA, 0.3) : 0);   // wardTurn: swing a collapsed arc away from the attacker, within what still lets it shoot
    this.torsoYaw += clamp(angDiff(wantYaw, this.torsoYaw), -0.45 * dt, 0.45 * dt);
    const hd = Math.hypot(ax - this.pos.x, az - this.pos.z);
    this.pitch = damp(this.pitch, Math.atan2(ay - 58 * s, hd), 2, dt);
    this.applyPose(dt, 0, 0);
    this.barrels.rotation.z += dt * (this.rakeLeft > 0 ? 22 : 1.5);
    const C = PAL[this.side].glow, T = PAL[this.side].tracer;

    // ----- lance (duel / hunt) -----
    if (this.mode) {
      this.charge += dt; const dur = this.mode === 'hunt' ? 3.8 : 2.2, k = this.charge / dur;
      this.mzR.getWorldPosition(_m);
      const hunt = this.mode === 'hunt';
      fx.fire(_m.x + rr(-2, 2), _m.y + rr(-2, 2), _m.z + rr(-2, 2), 0, 0, 0, 0.12, (6 + 22 * k) * s, 2, hunt ? 4 : C[0], hunt ? 0.8 : C[1], hunt ? 0.3 : C[2], 1);
      if (rnd() < dt * 30) { const a = rnd() * 6.28, r = 16; fx.fire(_m.x + Math.cos(a) * r, _m.y + rr(-r, r), _m.z + Math.sin(a) * r, -Math.cos(a) * r * 3, 0, -Math.sin(a) * r * 3, 0.3, 2.5, 0.5, C[0], C[1], C[2], 1, 0); }
      if (hunt) {
        if (pl.dead) { this.mode = null; this.spot.visible = false; }
        else {
          this.aimLag.x = damp(this.aimLag.x, pl.pos.x, 2.6, dt); this.aimLag.z = damp(this.aimLag.z, pl.pos.z, 2.6, dt);
          this.head.getWorldPosition(_v); _d.set(this.aimLag.x - _v.x, 4 - _v.y, this.aimLag.z - _v.z); const L = _d.length(); _d.multiplyScalar(1 / L);
          this.spot.visible = true; this.spot.position.copy(_v); this.spot.quaternion.setFromUnitVectors(_y, _d); this.spot.scale.set(0.42, L / 520 * 1.02, 0.42);
          G.threat = { col: this, t: dur - this.charge, k };
          this.alarmT -= dt; if (this.alarmT <= 0) { this.alarmT = 0.55 - 0.3 * k; G.sfx.alarm(); }
          this.lanceAim.set(this.aimLag.x, 5, this.aimLag.z);
        }
      }
      if (this.mode && this.charge >= dur && Math.abs(angDiff(wantYaw, this.torsoYaw)) < 0.5 && aiMayFire(this, COST.lance, isTargeted(this))) { this.fireLance(); this.spot.visible = false; this.mode = null; this.lanceT = rr(8, 14); }
      else if (this.charge > dur + 4) { this.mode = null; this.spot.visible = false; }
    } else {
      this.lanceT -= dt * (this.crippleT > 0 ? 0.4 : 1); this.huntT -= dt;
      const pd = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      // threat weighting: an allied colossus comes first. The player is only worth a hunt when close, when he has hurt
      // this engine recently, or when no allied colossus is engaging it; never within 28 s of this engine's last hunt.
      const worth = pd < 120 || G.time - this.hurtByPlayerT < 12 || (!foe && this.huntT <= 0);
      if (armOk(this, 'armR') && (this.side === 1 ? worth : this.grudgeT > 0) && !pl.dead && !G.noHunt && pd < 520 && pd > 30 && G.time - this.lastHunt > 28 && G.time - (G.lastHunt || -99) > 16
        && G.city.los(this.pos.x, 62 * s, this.pos.z, pl.pos.x, 9, pl.pos.z)) {
        this.mode = 'hunt'; this.charge = 0; this.huntT = rr(20, 34); this.lastHunt = G.lastHunt = G.time; this.anger = 0; this.aimLag.copy(pl.pos); this.alarmT = 0; G.stats.hunts = (G.stats.hunts || 0) + 1;
        G.sfx.charge(3.8, Math.min(0.3, 60 / pd));
      } else if (this.lanceT <= 0 && foe && armOk(this, 'armR')) {
        this.mode = 'duel'; this.charge = 0; this.miss = rnd() < 0.3;
        foe.chest(this.lanceAim); if (this.miss) { this.lanceAim.x += (rnd() < 0.5 ? -1 : 1) * rr(34, 70); this.lanceAim.y += rr(-25, 20); }
        G.sfx.charge(2.2, Math.min(0.2, 30 / Math.max(30, fx.camDist(this.pos.x, 60, this.pos.z))));
      }
    }
    // ----- close-defence guns: anything walker-sized under the skirts gets hosed -----
    if ((this.side === 1 || this.grudgeT > 0) && !pl.dead && !G.godMode) {
      const pd2 = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      if (pd2 < 95) {
        this.cdT -= dt;
        if (this.cdT <= 0) {
          this.cdT = 0.3; const hx = pl.pos.x + rr(-6, 6), hz = pl.pos.z + rr(-6, 6), hy = rr(2, 14), ox = this.pos.x, oz = this.pos.z;
          fx.tracer(ox + rr(-10, 10), 40 * s, oz + rr(-6, 6), hx, hy, hz, 420, 18, 0.5, T[0] * 1.3, T[1] * 1.3, T[2] * 1.3, () => { fx.impact(hx, hy, hz, 0.8); if (!pl.dead && Math.hypot(pl.pos.x - hx, pl.pos.z - hz) < 5) pl.damage(2.2, rnd() < 0.4 ? 'leg' : 'hull', ox, oz); });
        }
      }
    }
    const rakeDead = frac < 0.35 || this.crippleT > 0 || !armOk(this, 'armL'); this.rakeDead = frac < 0.35 || !armOk(this, 'armL');
    // ----- mega-gatling rake -----
    if (this.rakeLeft > 0 && !rakeDead) {
      this.rakeLeft -= dt; this.rakeAcc += dt * 16; const k = 1 - this.rakeLeft / 2.8;
      this.mzL.getWorldPosition(_m);
      while (this.rakeAcc >= 1) {
        this.rakeAcc -= 1; this.rakeN++;
        const hx = this.rx0 + (this.rx1 - this.rx0) * k + rr(-5, 5), hz = this.rz0 + (this.rz1 - this.rz0) * k + rr(-5, 5), side = this.side, n = this.rakeN;
        fx.tracer(_m.x, _m.y, _m.z, hx, 0.3, hz, 560, 46, 1.3, T[0] * 1.5, T[1] * 1.5, T[2] * 1.5, () => {
          if (n % 3 === 0) fx.explosion(hx, 0.5, hz, 0.9, { silent: n % 6 !== 0, noDebris: true }); else fx.impact(hx, 0.3, hz, 1.8);
          G.blast(hx, 0.5, hz, 6.5, 45, side, false, 10);   // 10 a round against a Kestrel
        });
        _d.set(hx - _m.x, -_m.y, hz - _m.z).normalize(); fx.muzzle(_m, _d, 3.2 * s, T[0] * 1.3, T[1] * 1.3, T[2] * 1.3);
        if (n % 3 === 0) { fx.flash(_m.x, _m.y, _m.z, C[0], C[1], C[2], 3000, 0.1, 220); G.sfx.boom(fx.camDist(_m.x, _m.y, _m.z), 0.7); }
      }
    } else {
      this.rakeT -= dt;
      if (this.rakeT <= 0) {
        this.rakeT = rr(5, 10);
        const cl = G.units.findCluster(this.side, this.pos.x, this.pos.z + this.dir * 120, 380);
        this.mzL.getWorldPosition(_m);
        if (!rakeDead && cl && G.city.los(_m.x, _m.y, _m.z, cl.lane, 4, cl.z)) { this.rakeLeft = 2.8; this.rx0 = cl.lane + rr(-8, 8); this.rx1 = cl.lane + rr(-8, 8); this.rz0 = cl.z - 34; this.rz1 = cl.z + 34; }
      }
    }
    // ----- carapace battery vs architecture -----
    this.cannonT -= dt;
    if (this.cannonT <= 0 && frac > 0.2) {
      const siege = this.plan === 'S'; this.cannonT = siege ? rr(20, 28) : rr(110, 180);   // SIEGE plan: the battery shells the front every ~24 s
      let b = null;
      if (!(siege && this.siegeShell())) {
        const hs = G.city.heroes.filter(h => h.alive && Math.hypot(h.x - this.pos.x, h.z - this.pos.z) < 420 && (h.z - this.pos.z) * this.dir > 30);
        if (hs.length && rnd() < 0.8) b = pick(hs);
        else { const bs = G.city.buildings.filter(h => h.alive && Math.hypot(h.x - this.pos.x, h.z - this.pos.z) < 330 && (h.z - this.pos.z) * this.dir > 40); if (bs.length) b = pick(bs); }
        if (b) this.shellBuilding(b);
      }
    }
    // stacks
    if (rnd() < dt * 9) { const sx = Math.cos(this.torsoYaw) * 16 * s * (rnd() < 0.5 ? 1 : -1), szz = -Math.sin(this.torsoYaw) * 16 * s; fx.smoke(this.pos.x + sx - Math.sin(this.torsoYaw) * 11, 95 * s, this.pos.z + szz * (sx > 0 ? 1 : -1) - Math.cos(this.torsoYaw) * 11, rr(-1, 1) + 2, rr(5, 9), rr(-1, 1), rr(5, 9), 5, 22, 0.05, 0.55, 0.15); }
  }
  // ---- piloted by the player (PlayerClass 'colossus'): the Player owns movement; this runs the weapons and the pose ----
  pilotUpdate(dt, inp) {
    const G = this.G, fx = G.fx, s = this.s, aim = this.aimPt, frac = this.hp / COL_HP;
    this.t += dt; this.crippleT = Math.max(0, this.crippleT - dt); this.lanceT = Math.max(0, this.lanceT - dt); this.cannonT = Math.max(0, this.cannonT - dt);
    tickHeavy(this, dt);   // capacitors, planting and shield regeneration
    this.legs.o.stepTime = this.limp ? 2.0 : 1.4; this.rakeDead = frac < 0.35;
    if (frac < 0.72 && rnd() < dt * (5 + 22 * (0.72 - frac))) fx.smoke(this.pos.x + rr(-20, 20) * s, rr(52, 92) * s, this.pos.z + rr(-12, 12) * s, rr(-2, 2) + 2, rr(4, 9), rr(-2, 2), rr(4, 8), 6, 24, 0.05, 0.6, 0.2);
    if ((frac < 0.46 || this.crippleT > 0) && rnd() < dt * 2.5) fx.sparks(this.pos.x + rr(-22, 22) * s, rr(20, 85) * s, this.pos.z + rr(-12, 12) * s, 12, 26);
    // RMB: the charged lance, charge tell and the spotlight as the aim indicator, then fireLance at the crosshair point
    if (this.mode === 'pilot' && !inp.fire2) { chargeCancel(this); this.mode = null; this.spot.visible = false; this.charge = 0; }   // released early: cancelled, half refunded
    if (inp.fire2 && !this.mode && this.lanceT <= 0 && armOk(this, 'armR')) { this.mode = 'pilot'; this.charge = 0; G.sfx.charge(2.2, 0.3); }
    if (this.mode === 'pilot') {
      this.charge += dt * (this.ocT > 0 ? 2.2 / 1.2 : 1); chargeDrain(this, COST.lance * dt / 2.2); this.pending = COST.lance - this.spent; const k = this.charge / 2.2, C = PAL[this.side].glow;   // OVERCHARGE: the lance charges in 1.2 s
      this.mzR.getWorldPosition(_m); fx.fire(_m.x + rr(-2, 2), _m.y + rr(-2, 2), _m.z + rr(-2, 2), 0, 0, 0, 0.12, (6 + 22 * k) * s, 2, C[0], C[1], C[2], 1);
      if (rnd() < dt * 30) { const a = rnd() * 6.28, r = 16; fx.fire(_m.x + Math.cos(a) * r, _m.y + rr(-r, r), _m.z + Math.sin(a) * r, -Math.cos(a) * r * 3, 0, -Math.sin(a) * r * 3, 0.3, 2.5, 0.5, C[0], C[1], C[2], 1, 0); }
      const aR = this.aimR || aim; this.head.getWorldPosition(_v); _d.set(aR.x - _v.x, aR.y - _v.y, aR.z - _v.z); const L = _d.length() || 1; _d.multiplyScalar(1 / L);
      this.spot.visible = true; this.spot.position.copy(_v); this.spot.quaternion.setFromUnitVectors(_y, _d); this.spot.scale.set(0.42, L / 520 * 1.02, 0.42);
      if (this.charge >= 2.2) { this.lanceAim.copy(this.aimR || aim); this.fireLance(); this.spot.visible = false; this.mode = null; this.lanceT = rr(8, 14); }
    }
    // LMB: the gatling battery at the crosshair
    this.gLock = Math.max(0, (this.gLock || 0) - dt); this.gHeat = this.gHeat || 0;   // the gatling overheats after 6 s of fire and locks for 4 s
    const rake = inp.fire1 && !this.rakeDead && this.gLock <= 0; this.rakeLeft = rake ? 1 : 0;
    if (rake) { this.gHeat += dt / 6; if (this.ocT > 0) this.gHeat = 0; if (this.gHeat >= 1) { this.gHeat = 1; this.gLock = 4; G.announce('GATLING OVERHEAT'); } } else this.gHeat = Math.max(0, this.gHeat - dt / (this.gLock > 0 ? 4 : 3)); this.barrels.rotation.z += dt * (rake ? 22 : 1.5);
    if (rake) { this.rakeAcc += dt * 16; while (this.rakeAcc >= 1) { this.rakeAcc -= 1; this.rakeRound(); } }
    // Q: the carapace battery as a barrage on the crosshair
    if (inp.aa && !this.qHeld && this.cannonT <= 0 && frac > 0.2) { this.shellPoint(aim); this.cannonT = 12; }
    this.carapaceReady = this.cannonT <= 0 && frac > 0.2;
    this.qHeld = inp.aa;
    this.applyPose(dt);
  }
  rakeRound() {
    const G = this.G, fx = G.fx, T = PAL[this.side].tracer, aim = this.aimL || this.aimPt; this.mzL.getWorldPosition(_m);
    const sm = this.spreadMul; _d.set(aim.x - _m.x + rr(-5, 5) * sm, aim.y - _m.y + rr(-2, 2) * sm, aim.z - _m.z + rr(-5, 5) * sm).normalize();
    const h = G.shoot(_m, _d, 700, -1, { probe: true, radius: 1.4, byPlayer: true }), hx = h.x, hy = h.y, hz = h.z, type = h.type, ref = h.ref, ox = _m.x, oz = _m.z, dx = _d.x, dz = _d.z;
    this.rakeN++;
    fx.tracer(_m.x, _m.y, _m.z, hx, hy, hz, 560, 46, 1.3, T[0] * 1.5, T[1] * 1.5, T[2] * 1.5, () => {
      fx.impact(hx, Math.max(0.3, hy), hz, 1.8);
      if (type === 'tank') G.units.damageTank(ref, 60, true); else if (type === 'scout') G.scouts.damage(ref, 10, true, ox, oz);   // 10 a round against a Kestrel
      else if (type === 'col' || type === 'hier' || type === 'harrow' || type === 'struct') ref.damage(2, true, false, { x: hx, y: hy, z: hz }, 3);   // S 2, H 3 against engines
      else if (type === 'air') G.air.damage(ref, 40, true); else if (type === 'bld') G.city.damage(ref, 90, dx, dz, false, true);
      G.blast(hx, Math.max(0.5, hy), hz, 6.5, 45, -1, true, 10);
    });
    fx.muzzle(_m, _d, 3.2 * this.s, T[0] * 1.3, T[1] * 1.3, T[2] * 1.3);
    if (this.rakeN % 3 === 0) { const C = PAL[this.side].glow; fx.flash(_m.x, _m.y, _m.z, C[0], C[1], C[2], 3000, 0.1, 220); G.sfx.boom(fx.camDist(_m.x, _m.y, _m.z), 0.7); }
  }
  shellPoint(aim) {   // the carapace battery as a barrage on a point
    const G = this.G, fx = G.fx, T = PAL[this.side].tracer; this.mzTop.getWorldPosition(_m);
    for (let k = 0; k < 4; k++) {
      const hx = aim.x + rr(-12, 12), hy = aim.y, hz = aim.z + rr(-12, 12);
      fx.tracer(_m.x + (k % 2 ? 4 : -4), _m.y, _m.z, hx, hy, hz, 300 - k * 20, 60, 2.6, T[0] * 2, T[1] * 2, T[2] * 2, () => {
        fx.explosion(hx, hy, hz, 3.2); fx.debris(hx, hy, hz, 6, 2.2, 26, 0.09); G.blast(hx, hy, hz, 9, 200, -1, true); splashEngines(G, hx, hy, hz, 9, 160, 40, true, this, true);   // 9 m blast: 220 to a shield, 40 to bare hull
        const b = G.city.solid(hx, Math.max(hy, 2), hz); if (b) G.city.damage(b, 1500, 0, 0, false, true);
      });
    }
    fx.flash(_m.x, _m.y, _m.z, 1, 0.7, 0.4, 6000, 0.25, 300); _d.set(aim.x - _m.x, 0, aim.z - _m.z).normalize(); fx.muzzle(_m, _d, 5, 4, 2.6, 1); G.sfx.boom(fx.camDist(_m.x, _m.y, _m.z), 2.2);
  }
  pilotHud() {   // [fraction, text] for LMB, RMB, Q
    const f = (a, b) => [Math.max(0, Math.min(1, a)), b];
    return [this.rakeDead ? f(0, 'DEAD') : this.gLock > 0 ? f(1 - this.gHeat, 'HOT') : f(1 - (this.gHeat || 0), this.gHeat > 0.02 ? (this.gHeat * 100).toFixed(0) : 'RDY'), this.mode === 'pilot' ? f(this.charge / 2.2, 'CHG') : f(1 - this.lanceT / 11, this.lanceT > 0 ? this.lanceT.toFixed(0) : 'RDY'),
      f(1 - this.cannonT / 12, this.cannonT > 0 ? this.cannonT.toFixed(0) : 'RDY')];
  }
  // SIEGE plan: the battery on the nearest foe within 520 m (an engine, else an infantry cluster); false when there is none
  siegeShell() {
    const G = this.G; let x = 0, z = 0, ok = false; const f = this.target;
    if (f && f.pos && f.alive && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < 520) { x = f.pos.x; z = f.pos.z; ok = true; }
    else { const cl = G.units.findCluster(this.side, this.pos.x, this.pos.z, 520); if (cl) { x = cl.lane; z = cl.z; ok = true; } }
    if (!ok) return false;
    const fx = G.fx, T = PAL[this.side].tracer, side = this.side; this.mzTop.getWorldPosition(_m);
    for (let k = 0; k < 4; k++) {
      const hx = x + rr(-14, 14), hz = z + rr(-14, 14);
      fx.tracer(_m.x + (k % 2 ? 4 : -4), _m.y, _m.z, hx, 2, hz, 300 - k * 20, 60, 2.6, T[0] * 2, T[1] * 2, T[2] * 2, () => {
        fx.explosion(hx, 2, hz, 3.2); fx.debris(hx, 2, hz, 6, 2.2, 26, 0.09); G.blast(hx, 2, hz, 9, 200, side); splashEngines(G, hx, 2, hz, 9, 160, 40, false, this, true);
      });
    }
    fx.flash(_m.x, _m.y, _m.z, 1, 0.7, 0.4, 6000, 0.25, 300); _sp.set(x - _m.x, 0, z - _m.z).normalize(); fx.muzzle(_m, _sp, 5, 4, 2.6, 1); G.sfx.boom(fx.camDist(_m.x, _m.y, _m.z), 2.2);
    return true;
  }
  shellBuilding(b) {
    const G = this.G, fx = G.fx, T = PAL[this.side].tracer;
    this.mzTop.getWorldPosition(_m);
    const ty = Math.min(b.top * 0.55, 70), dx = b.x - _m.x, dz = b.z - _m.z, l = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 2; k++) {
      const last = k === 1, ox = rr(-6, 6), oy = rr(-6, 6);
      fx.tracer(_m.x + (k ? 4 : -4), _m.y, _m.z, b.x + ox, ty + oy, b.z + ox, 300 - k * 40, 60, 2.6, T[0] * 2, T[1] * 2, T[2] * 2, () => {
        fx.explosion(b.x + ox, ty + oy, b.z + ox, 3.2); fx.debris(b.x, ty, b.z, 6, 2.2, 26, 0.09);
        if (last) G.city.damage(b, 3000, dx / l, dz / l);
      });
    }
    fx.flash(_m.x, _m.y, _m.z, 1, 0.7, 0.4, 6000, 0.25, 300); _d.set(dx / l, 0, dz / l); fx.muzzle(_m, _d, 5, 4, 2.6, 1);
    G.sfx.boom(fx.camDist(_m.x, _m.y, _m.z), 2.2);
  }
  applyPose(dt) {
    const s = this.s;
    this.bobV += (-this.bob * 22 - this.bobV * 4) * dt; this.bob += this.bobV * dt;
    this.shieldA = Math.max(0, this.shieldA - dt * 0.9); this.shield.material.uniforms.uA.value = this.shieldA; this.shield.visible = this.shieldA > 0.01 || this.wardFx > 0.01;
    const hipY = 45 * s + this.bob - this.sink;
    this.root.position.set(this.pos.x, 0, this.pos.z); this.root.rotation.y = this.yaw;
    { const C = PAL[this.side].glow, e = this.mode ? Math.pow(clamp(this.charge / (this.mode === 'hunt' ? 3.8 : 2.2), 0, 1), 2) : 0; this.lanceMat.color.setRGB(C[0] * 2.4 * e, C[1] * 2.4 * e, C[2] * 2.4 * e); }   // lance charge tell: black at rest, ramps with the charge
    this.body.position.y = hipY / s; this.body.rotation.x = this.lean;
    this.torso.rotation.y = angDiff(this.torsoYaw, this.yaw);
    this.armR.rotation.x = -clamp(this.pitch, -0.6, 0.5); this.armL.rotation.x = this.rakeDead ? damp(this.armL.rotation.x, 1.05, 1.5, dt) : this.armR.rotation.x;
    if (!armOk(this, 'armR')) this.armR.rotation.x = 0.9;
    if (!armOk(this, 'armL')) this.armL.rotation.x = 1.05;   // a destroyed arm droops
    this.body.rotation.z = this.crippleT > 0 && this.alive ? Math.sin(this.t * 2.2) * 0.05 : 0;
    this.legs.update(dt, this.pos, this.yaw, this.piloted ? this.vel.x : Math.sin(this.yaw) * this.speed, this.piloted ? this.vel.z : Math.cos(this.yaw) * this.speed, hipY);   // piloted: free heading
    this.shadow.position.set(this.pos.x, 0.07, this.pos.z);
    this.root.updateMatrixWorld(true);
  }
}
