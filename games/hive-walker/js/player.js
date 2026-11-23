import * as THREE from 'three';
import { rnd, rr, clamp, damp, angDiff, approach } from './util.js?v=32';
import { Legs } from './legs.js?v=32';
import { makeWalker, WALKER } from './walker.js?v=32';
import { HIER_HP, HIER_SHIELD } from './hierarch.js?v=32';
import { HARROW_HP, HARROW_SHIELD } from './harrow.js?v=32';
import { COL_HP, COL_SHIELD } from './colossus.js?v=32';
import { speedMul, FSUM } from './heavy.js?v=32';
import { updateLocks } from './loadout.js?v=32';
import { entityAt } from './loadout.js?v=32';

const TOP = 29, SPRINT = 1.55, STRIDE = 13;   // scout engine: quick and light on its feet (was 24 m/s, stride 9.5)
const MAXTW = 2.45;          // waist twist range (rad) either side
const VEIL_MAX = 24;         // ward veil capacity (one fusion-lance class hit)
// Playable engine classes (model/playable-classes-spec.md). The Kestrel row reproduces the constants above, so its handling is unchanged;
// the heavy rows pilot the matching Vigil AI unit (G.harrows[0] / G.hierarchs[0] / G.colossi[0]) for the life: its rig, damage model and weapon effects.
const HUD_K = { integ: ['VEIL', 'HULL', 'LEG - L', 'LEG - R'], arm: ['INFERNO', 'CANNON', 'AA RACK', 'SUNSPEAR', 'COOLANT'], threat: 'BREAK LINE OF SIGHT - GET BEHIND A BUILDING' };
export const CLASS = {
  kestrel: { label: 'KESTREL', top: TOP, sprint: SPRINT, coolant: 6, accel: 0, brake: 0, turn: 0, twist: MAXTW, slew: 0, brace: true, back: 16, corner: 14, stepK: 1, pivot: 18, dist: 41, pip: true, auspex: 300, hud: HUD_K },
  harrow: { label: 'HARROW', top: 21, sprint: 1.5, coolant: 3, accel: 11.8, brake: 18.4, turn: 2.1, twist: 1.9, slew: 3.5, brace: true, back: 12, corner: 13, stepK: 1.8, pivot: 30, dist: 62, pip: true, auspex: 400, rad: 8, hp: HARROW_HP, shield: HARROW_SHIELD,
    hud: { integ: ['WARD', null, null, null], arm: ['SIEGE FIST', 'LASCANNON', 'ROCKETS', null, 'CHARGE'], threat: 'ENGINE LOCKED ON - CLOSE IN OR BREAK LINE OF SIGHT' } },
  hierarch: { label: 'HIERARCH', top: 15, sprint: 1, coolant: 6, accel: 6.8, brake: 10.9, turn: 1.23, twist: 1.6, slew: 1.8, brace: false, back: 8, corner: 6.8, stepK: 2.6, pivot: 46, dist: 95, pip: false, auspex: 500, rad: 10, hp: HIER_HP, shield: HIER_SHIELD,
    hud: { integ: ['WARD', null, null, null], arm: ['MACRO-GUN', 'BLASTER', 'MISSILES', null, null], threat: 'FUSION BLASTER CHARGING AT YOU - BREAK LINE OF SIGHT' } },
  colossus: { label: 'COLOSSUS', top: 10, sprint: 1, coolant: 6, accel: 3.3, brake: 5, turn: 0.55, twist: 1.3, slew: 0.9, brace: false, back: 5, corner: 4.2, stepK: 3.5, pivot: 80, dist: 170, pip: false, auspex: 700, rad: 12, hp: COL_HP, shield: COL_SHIELD, noCamRay: true,
    hud: { integ: ['SHIELD', null, null, null], arm: ['GATLING', 'LANCE', 'BATTERY', null, null], threat: 'ENEMY COLOSSUS LANCE CHARGING - BREAK LINE OF SIGHT' } },
};
const BODY = { harrow: G => G.harrows && G.harrows[0], hierarch: G => G.hierarchs && G.hierarchs[0], colossus: G => G.colossi && G.colossi[0] };   // (none yet during construction: the first spawn is a Kestrel)
function relabelHud(C, name, heavy) {   // engine integrity / armament rows, auspex label, threat line
  const bl = document.querySelectorAll('#bl .row'), br = document.querySelectorAll('#br .row'), q = s => document.querySelector(s);
  q('#bl .ttl').textContent = heavy ? name : 'Engine integrity';
  C.hud.integ.forEach((t, i) => { bl[i].style.display = t ? '' : 'none'; if (t) bl[i].firstElementChild.textContent = t; });
  C.hud.arm.forEach((t, i) => { br[i].style.display = t ? '' : 'none'; if (t) br[i].firstElementChild.textContent = t; });
  q('#caps').style.display = heavy ? 'flex' : 'none'; q('#myDoll').style.display = heavy ? 'block' : 'none'; q('#static').style.display = 'none';
  q('#auspex .lbl').textContent = 'AUSPEX ' + C.auspex + ' M'; q('#threat .sub').textContent = C.hud.threat;
}
const SPEAR_RANGE = 78, SPEAR_CD = 20, SPEAR_CHARGE = 1.5;
const _v = new THREE.Vector3(), _m = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _e = new THREE.Vector3();

export class Player {
  constructor(G) {
    this.G = G; const scene = G.scene;
    // the engine itself: Kestrel-class scout walker (GLB), Vigil livery
    const rig = this.rig = makeWalker(0);
    this.root = rig.root; scene.add(this.root);
    this.body = rig.body; this.torso = rig.torso; this.head = rig.head;
    this.armL = rig.arm_L; this.armR = rig.arm_R; this.cannonBarrel = rig.barrel_R;
    this.muzzleL = rig.anchor_nozzle; this.pilot = rig.anchor_pilot; this.muzzleR = rig.anchor_muzzle;
    this.rack = rig.anchor_rack; this.spearMuzzle = rig.anchor_lance; this.nozzleGlowMat = rig.nozzleMat;
    this.lamp = new THREE.PointLight(0xffc890, 120, 80, 1.5); rig.anchor_lamp.add(this.lamp);

    // ward veil: invisible until struck
    this.veilMat = new THREE.ShaderMaterial({
      uniforms: { uHit: { value: new THREE.Vector3(0, 0, 1) }, uHitK: { value: 0 }, uBase: { value: 0 }, uT: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = normalize(position); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform vec3 uHit; uniform float uHitK, uBase, uT; varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main(){
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
          float d = acos(clamp(dot(vP, uHit), -1.0, 1.0));
          float ring = (0.5 + 0.5 * sin(d * 16.0 - uT * 26.0)) * exp(-d * 1.6);
          vec3 q = vP * 9.0; float cell = max(max(abs(sin(q.x + q.y * 0.5)), abs(sin(q.y * 1.1 - q.z * 0.5))), abs(sin(q.z + q.x * 0.5)));
          float hex = smoothstep(0.93, 1.0, cell);
          float a = uHitK * (ring * 1.3 + hex * exp(-d * 0.9) * 1.6 + fres * 0.25) + uBase * (fres * 0.6 + hex * 0.25);
          gl_FragColor = vec4(vec3(0.45, 0.8, 1.6) * a, 1.0);
        }` });
    this.veilMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(15.5, 3), this.veilMat); this.veilMesh.scale.set(1, 1.05, 1); this.veilMesh.renderOrder = 13; this.veilMesh.frustumCulled = false; scene.add(this.veilMesh);

    // legs
    this.kLegs = this.legs = new Legs(scene, {
      hipW: WALKER.hipW, thighL: WALKER.thighL, shinL: WALKER.shinL, metaL: WALKER.metaL, metaLean: WALKER.metaLean, footH: WALKER.footH,
      stride: STRIDE, stepTime: 0.4, stepH: 3.0, refSpeed: TOP, knee: 1, makeParts: rig.legParts, onStep: (f, sn) => this.onStep(f, sn),
    });
    // blob shadow
    const sg = new THREE.CircleGeometry(9, 20); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    scene.add(this.shadow);

    this.globs = []; this.globPool = []; this.spine = []; this.spinePool = [];
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.spawn(28, 300);
  }
  spawn(x, z) {
    // find the nearest spot clear of buildings (spiral search) so we never start inside a block
    const city = this.G && this.G.city, probe = new THREE.Vector3();
    if (city) {
      search: for (let r = 0; r <= 240; r += 8) {
        const n = r === 0 ? 1 : Math.ceil(2 * Math.PI * r / 8);
        for (let k = 0; k < n; k++) {
          const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          probe.set(px, 0, pz);
          if (!city.collideCircle(probe, 9)) { x = px; z = pz; break search; }
        }
      }
    }
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.legYaw = Math.PI; this.aimYaw = Math.PI; this.aimPitch = 0.02; this.twist = 0;
    this.speed = 0; this.turnVel = 0; this.bob = 0; this.bobV = 0; this.pitch = 0; this.roll = 0; this.rollKick = 0;
    this.lat = 0; this.slip = 0; this.bracing = false; this.braceK = 0; this.exitBoost = 0; this.skidAcc = 0;
    this.sprinting = false; this.sprintK = 0; this.coolant = 1; this.coolLock = false; this.sprintRest = 0;
    this.hull = 100; this.legL = 100; this.legR = 100; this.lastHit = -99; this.dead = false; this.deadT = 0;
    this.veil = VEIL_MAX; this.veilHitK = 0; this.veilBase = 0; this.veilDown = false; this.veilHum = false;
    this.fuel = 1; this.fuelLock = false; this.fuelRest = 0; this.flaming = false; this.fAcc = 0; this.lightT = 0; if (this.globs) { this.globs.length = 0; this.spine.length = 0; } this.dripT = 0;
    this.heat = 0; this.overheat = false; this.nozzleHeat = 0;
    this.cannonCd = 0; this.recoil = 0;
    this.spearCd = 0; this.spearCharge = 0; this.spearHits = 0;
    this.aaReload = 0; this.lockT = null; this.lockProg = 0; this.aaHeld = false; this.salvo = []; this.aaHold = 0;
    this.hitWall = false; this.stepCount = 0;
    this.applyClass();
  }
  get dead() { return this._dead || !!this.heavy; }   // a piloted heavy is not a Kestrel target: enemies see the body as the unit it is
  set dead(v) { this._dead = v; }
  // pick the class for this life (G.nextClass): the displaced Vigil AI unit is taken over by the player
  applyClass() {
    const G = this.G, want = G.nextClass && CLASS[G.nextClass] ? G.nextClass : 'kestrel', body = want !== 'kestrel' ? BODY[want](G) || null : null, name = body ? want : 'kestrel', C = CLASS[name], heavy = !!body;
    if (this.unit && this.unit !== body) { this.unit.piloted = false; this.unit.aimPt = this.unit.aimL = this.unit.aimR = null; }
    this.cls = name; this.C = C; this.unit = body; this.heavy = heavy; this.veilMax = heavy ? C.shield * FSUM : VEIL_MAX;   // a heavy's ward is the four facings together this.lastTot = 0; this.headDead = false;
    this.root.visible = !heavy; this.kLegs.setVisible(!heavy); this.shadow.visible = !heavy; if (heavy) this.veilMesh.visible = false;
    if (heavy) {
      body.piloted = true; body.enter(this.pos.z); body.pos.set(this.pos.x, 0, this.pos.z); body.yaw = body.torsoYaw = this.legYaw; body.legs.reset(body.pos, body.yaw);
      for (const k of ['lanceT', 'cannonT', 'podT', 'rackT', 'bCd', 'lasCd', 'meleeCd']) if (k in body) body[k] = 0;   // weapons ready at the start of a life
      body.aimPt = G.aimPoint; body.tgt = null; body.tgtKind = 0; this.legs = body.legs; this.name = body.name; this.lastTot = body.hp + body.shieldHP;
      if (!body.stepHooked) { body.stepHooked = true; const o = body.legs.o.onStep; body.legs.o.onStep = f => { o(f); if (body.piloted) this.heavyStep(f); }; }
    } else { this.legs = this.kLegs; this.kLegs.reset(this.pos, this.legYaw); this.name = 'KESTREL'; }
    relabelHud(C, this.name, heavy);
  }
  heavyStep(f) {   // footfall on top of the body's own stomp: class-scaled trauma, a dust ring and knocked-down infantry for the colossus
    const G = this.G, C = this.C, sn = clamp(Math.abs(this.speed) / C.top, 0, 1), v = 0.45 + 0.55 * sn;
    G.addTrauma(0.13 * v * C.stepK); G.sfx.footstep(Math.min(1.5, v * C.stepK * 0.5));
    if (this.cls === 'colossus') { G.fx.dust(f.pos.x, 1, f.pos.z, 9, 22, 0.16, 0.5); G.units.blast(f.pos.x, 0.5, f.pos.z, 28, 31, -1, true); }
  }
  // collision for a piloted heavy: a 8-12 m body walks through what its class may, and demolishes it; hero spires (and, for the
  // lighter classes, anything it cannot walk through) push it out
  heavyCollide() {
    const G = this.G, C = this.C, city = G.city;
    for (let it = 0; it < 3; it++) {
      _t.copy(this.pos); const b = city.collideCircle(_t, C.rad); if (!b) { this.pos.copy(_t); return null; }
      const small = !b.hero && b.hp0 <= 500 && b.h0 <= 46, walk = this.cls === 'colossus' ? !b.hero : this.cls === 'hierarch' ? small : this.sprintK > 0.5 && !b.hero && b.h0 <= 90;
      if (walk) { city.damage(b, 99999, this.vel.x, this.vel.z, true, true); G.blast(b.x, 0, b.z, b.hw + 5, 200, -1, true); this.ramFx(b, 1); G.stats.rams = (G.stats.rams || 0) + 1; continue; }
      this.pos.copy(_t); const nx = city.cnx || 0, nz = city.cnz || 0, into = -(this.vel.x * nx + this.vel.z * nz);
      if (into > 0) { this.vel.x += nx * into; this.vel.z += nz * into; this.speed = this.vel.x * Math.sin(this.legYaw) + this.vel.z * Math.cos(this.legYaw); }
      break;
    }
    return null;
  }
  // command orders: MMB locks, tactical-view clicks, fire-zone painting (G)
  commands(dt, inp) {
    const G = this.G, B = this.unit;
    for (const c of G.cmd.splice(0)) {
      if (c.t === 'mmb') {
        const ent = entityAt(G, G.aimHit);
        if (ent) { const arm = G.time - (B.lastArmT || -9) < 3 ? B.lastArm : (!B.lock.L ? 'L' : !B.lock.R ? 'R' : 'L'); B.lock[arm] = ent; B.lastLock = arm; }
        else if (c.time - (this.lastMmb || -9) < 0.3) B.lock.L = B.lock.R = null;   // double-tap releases both
        else if (B.lastLock) B.lock[B.lastLock] = null;                              // MMB on empty ground releases the latest
        this.lastMmb = c.time;
      } else if (c.t === 'lock') { B.lock[c.arm] = c.ent; B.lastLock = c.arm; }
      else if (c.t === 'unlock') B.lock[c.arm] = null;
      else if (c.t === 'queue') B.queuedQ = c.pt;
      else if (c.t === 'zone') this.addZone(c.x, c.z, c.r);
      else if (c.t === 'focus') B.focus = c.ref;
      else if (c.t === 'clearZones') { B.zones.length = 0; B.focus = null; }
    }
    if (inp.zoneHeld) { if (!this.zp) this.zp = { x: G.aimPoint.x, z: G.aimPoint.z, r: 40, t0: performance.now() }; this.zp.r = clamp(this.zp.r - inp.rawdy * 0.3, 20, 90); G.zonePreview = this.zp; }
    else if (this.zp) {
      const z = this.zp; this.zp = null; G.zonePreview = null; const i = B.zones.findIndex(q => Math.hypot(q.x - G.aimPoint.x, q.z - G.aimPoint.z) < q.r);
      if (performance.now() - z.t0 < 300 && Math.abs(z.r - 40) < 2 && i >= 0) B.zones.splice(i, 1);   // a tap inside a zone removes it
      else this.addZone(z.x, z.z, z.r);
    }
  }
  addZone(x, z, r) { const B = this.unit; B.zones.push({ x, z, r: clamp(r, 20, 90) }); if (B.zones.length > 2) B.zones.shift(); }
  // drive the piloted body: the legs/hull follow the movement above, the torso lags the mouse by the class slew limit, the body runs its weapons
  driveHeavy(dt, inp, tw) {
    const G = this.G, B = this.unit, C = this.C;
    B.pos.copy(this.pos); B.yaw = this.legYaw; B.speed = this.speed; B.vel.copy(this.vel);
    B.torsoYaw += clamp(angDiff(this.aimYaw, B.torsoYaw), -C.slew * dt, C.slew * dt);
    B.pitch = damp(B.pitch, clamp(this.aimPitch * 0.8, -0.5, 0.5), 5, dt);
    B.tgt = null; B.tgtKind = 0; this.commands(dt, inp);
    updateLocks(B, dt, inp);   // a locked arm tracks its target and auto-fires, leaving the crosshair to the other arm
    const e = this._e || (this._e = { zv: new THREE.Vector3(), qv: new THREE.Vector3() });
    e.fire1 = inp.fire1 || B.auto.L; e.fire2 = inp.fire2 || B.auto.R; e.aa = inp.aa; e.sprint = inp.sprint; e.spear = inp.spear; e.fwd = inp.fwd; e.turn = inp.turn;
    if (inp.fire1) { B.lastArm = 'L'; B.lastArmT = G.time; } if (inp.fire2) { B.lastArm = 'R'; B.lastArmT = G.time; }
    B.aimL = B.auto.L && !inp.fire1 ? B.lockPt.L : G.aimPoint; B.aimR = B.auto.R && !inp.fire2 ? B.lockPt.R : G.aimPoint;
    const zc = B.zones.length ? B.zones[B.zones.length - 1] : null;
    B.aimPt = inp.alt && zc ? e.zv.set(zc.x, 0.5, zc.z) : G.aimPoint;   // Alt+Q: the carapace weapon at the latest zone
    const cr = B.hcls === 'colossus' ? B.cannonT <= 0 && B.hp > B.hullMax * 0.2 : B.hcls === 'hierarch' ? B.podT <= 0 : B.rackT <= 0;
    if (B.queuedQ && cr) { B.aimPt = e.qv.set(B.queuedQ.x, B.queuedQ.y, B.queuedQ.z); e.aa = true; B.qHeld = false; B.queuedQ = null; }   // a shot queued from the tactical view
    B.pilotUpdate(dt, e);
    this.hudW = B.pilotHud(); this.twist = tw;
    this.veil = B.shieldHP; this.veilDown = B.shieldHP <= 0; this.hull = Math.max(0, 100 * B.hp / C.hp); this.headDead = B.comp.head.hp <= 0; this.legL = this.legR = B.staggerT > 0 || B.crippleT > 0 || B.limpT > 0 ? 35 : 100;
    const tot = B.hp + B.shieldHP;   // damage feedback from the body's own damage model
    if (tot < this.lastTot - 1) { const d = this.lastTot - tot; this.lastHit = G.time; G.hurtFlash = Math.min(1, G.hurtFlash + 0.2 + d * 0.004); G.addTrauma(Math.min(0.5, d * 0.01)); if (d > 8) G.sfx.hit(); }
    this.lastTot = tot;
    for (const e of G.hierarchs) if (e.side === 1 && e.alive && e.tgt === B && e.charge > 0) G.threat = G.threat || { col: e, t: 0, k: Math.min(1, e.charge / 1.2) };   // what is about to fire on you
    for (const e of G.harrows) if (e.side === 1 && e.alive && e.tgt === B && (e.charge > 0 || e.mp === 'wind')) G.threat = G.threat || { col: e, t: 0, k: e.mp === 'wind' ? e.mt / 0.7 : Math.min(1, e.charge / 0.6) };
    for (const e of G.colossi) if (e.side === 1 && e.alive && e.mode === 'duel' && e.target === B) G.threat = G.threat || { col: e, t: 0, k: Math.min(1, e.charge / 2.2) };
    if (!B.alive) { this._dead = true; this.deadT = 5; this.speed = 0; G.stats.deaths++; G.sfx.skid(0); }
  }

  get legFactor() { const l = Math.min(this.legL, this.legR) / 100; return l > 0.6 ? 1 : 0.32 + 0.68 * l / 0.6; }
  get limping() { return Math.min(this.legL, this.legR) < 40; }
  get veilFrac() { return this.veil / this.veilMax; }
  get spearFrac() { return this.spearCharge > 0 ? this.spearCharge / SPEAR_CHARGE : 1 - this.spearCd / SPEAR_CD; }
  torsoPos(out) { return out.set(this.pos.x, 16.5, this.pos.z); }

  onStep(f, sn) {
    const G = this.G; this.stepCount++;
    const hurt = (f.side > 0 ? this.legL : this.legR) < 40;
    const v = (0.45 + 0.55 * sn) * (1 + 0.5 * this.sprintK);
    this.bobV -= (hurt ? 9 : 4) * v; this.rollKick += f.side * (hurt ? 0.09 : 0.03) * v;
    G.addTrauma(0.13 * v + (hurt ? 0.12 : 0)); G.sfx.footstep(v);
    G.fx.dust(f.pos.x, 0.4, f.pos.z, 1.2 + 0.5 * this.sprintK, 5, 0.17, 0.4);
    G.fx.sparks(f.pos.x, 0.4, f.pos.z, 3, 8, 2.5, 1.6, 0.6, 0.4);
    if (rnd() < 0.6) G.fx.debris(f.pos.x, 0.5, f.pos.z, 2, 0.35, 7, 0.12);
    G.streets.crush(f.pos.x, f.pos.z, 3.6, this.vel.x, this.vel.z);   // kick the wreck along the stride
    G.city.crush(f.pos.x, f.pos.z, 3.6);
    G.units.crush(f.pos.x, f.pos.z, 3.6, -1, true);    // anything underfoot, friend or foe
  }

  // fx,fz: optional world position the hit came from (for the veil ripple)
  damage(amt, part = 'hull', fx = null, fz = null) {
    if (this.dead || this.G.godMode) return;
    const G = this.G;
    if (this.veil > 0) {
      const ab = Math.min(this.veil, amt); this.veil -= ab; amt -= ab; this.lastHit = G.time;
      let dx = fx === null ? rr(-1, 1) : fx - this.pos.x, dz = fz === null ? rr(-1, 1) : fz - this.pos.z; const l = Math.hypot(dx, dz) || 1;
      this.veilMat.uniforms.uHit.value.set(dx / l * 0.9, part === 'hull' ? 0.25 : -0.4, dz / l * 0.9).normalize();
      this.veilHitK = Math.min(1.6, this.veilHitK + 0.35 + ab * 0.06); G.sfx.veilHit(ab);
      if (this.veil <= 0) this.shatterVeil();
      if (amt < 0.05) return;
    }
    if (part === 'leg') part = rnd() < 0.5 ? 'legL' : 'legR';
    this[part] = Math.max(0, this[part] - amt);
    if (part !== 'hull') this.hull = Math.max(0, this.hull - amt * 0.25);
    this.lastHit = G.time; G.hurtFlash = Math.min(1, G.hurtFlash + 0.25 + amt * 0.02);
    if (amt > 3) { G.sfx.hit(); G.addTrauma(Math.min(0.6, amt * 0.02)); G.fx.sparks(this.pos.x, part === 'hull' ? 13 : 5, this.pos.z, 8, 16); }
    if (this.hull <= 0) this.die();
  }
  shatterVeil() {
    const G = this.G, fx = G.fx; this.veil = 0; this.veilDown = true; this.veilHitK = 0; this.veilHum = false;
    for (let i = 0; i < 70; i++) {   // shards
      const a = rnd() * 6.283, b = Math.acos(rr(-0.4, 1)), r = 15, sx = Math.sin(b) * Math.cos(a), sy = Math.cos(b), sz = Math.sin(b) * Math.sin(a);
      fx.fire(this.pos.x + sx * r, 11 + sy * r, this.pos.z + sz * r, sx * rr(14, 40), sy * rr(8, 30), sz * rr(14, 40), rr(0.35, 0.9), rr(1.2, 2.6), 0.3, 1.2, 2.4, 4.5, 1, 1.2, 16);
    }
    fx.fire(this.pos.x, 11, this.pos.z, 0, 0, 0, 0.22, 20, 46, 0.8, 1.7, 3.2, 0.8);
    fx.flash(this.pos.x, 14, this.pos.z, 0.5, 0.8, 1, 9000, 0.3, 140);
    G.sfx.veilBreak(); G.addTrauma(0.35); G.announce('WARD VEIL DOWN'); G.veilFlash = 1;
  }
  die() {
    const G = this.G; this.dead = true; this.deadT = 5; this.speed = 0;
    G.fx.explosion(this.pos.x, 10, this.pos.z, 3); G.fx.debris(this.pos.x, 10, this.pos.z, 14, 1.4, 26, 0.12);
    G.fx.addEmitter(this.pos.x, 4, this.pos.z, 3, 12);
    this.root.visible = false; this.legs.setVisible(false); this.veilMesh.visible = false; G.sfx.flame(0); G.sfx.skid(0); G.stats.deaths++;
  }

  update(dt, inp) {
    const G = this.G;
    if (this._dead) { this.deadT -= dt; if (this.deadT <= 0) this.spawn(28, Math.min(520, this.pos.z + 220)); return; }
    const C = this.C;
    // --- sprint (shares reactor coolant) ---
    const lf = this.legFactor;
    const st = -(inp.turn || 0), back = inp.fwd < 0, mag = Math.min(1, Math.hypot(inp.fwd, st)), moving = mag > 0.1;   // st: strafe, + = right
    const wantSprint = !!inp.sprint && moving && !back && !this.coolLock && lf > 0.6 && C.sprint > 1;
    this.sprinting = wantSprint;
    if (wantSprint) { this.coolant = Math.max(0, this.coolant - dt / C.coolant); this.sprintRest = 1; if (this.coolant <= 0) { this.coolLock = true; G.announce('COOLANT SPENT'); } }
    else { this.sprintRest -= dt; if (this.sprintRest <= 0) this.coolant = Math.min(1, this.coolant + dt / 8); if (this.coolLock && this.coolant > 0.35) this.coolLock = false; }
    this.sprintK = damp(this.sprintK, wantSprint ? 1 : 0, 4, dt);
    // --- aim (torso): raw mouse, applied the same frame ---
    this.aimYaw -= inp.mdx * 0.0021; this.aimPitch = clamp(this.aimPitch - (inp.zoneHeld ? 0 : inp.mdy) * 0.0017, -0.5, 1.05);   // painting a zone (G held) uses the mouse for its radius
    // --- legs: turn, brace, skid ---
    const sAbs = Math.abs(this.speed), sn = clamp(sAbs / C.top, 0, 1.6);
    const wMax = (C.turn || (3.7 - 1.1 * Math.min(1, sn))) * (0.55 + 0.45 * lf) * (this.heavy ? this.unit.legMul : 1);
    // WASD is relative to the torso aim: the legs swing to face the requested travel direction (D = strafe right,
    // W+D = forward-right diagonal) while the torso stays on the mouse. S walks backwards with the legs facing the aim.
    // Standing still, the legs step round to follow the mouse once the twist passes ~45 degrees.
    let alignErr = 0, legTarget = null;
    if (moving) legTarget = back ? this.aimYaw - Math.atan2(-st, -inp.fwd) : this.aimYaw - Math.atan2(st, Math.max(inp.fwd, 0));
    else {
      const tw0 = angDiff(this.aimYaw, this.legYaw);
      if (Math.abs(tw0) > 0.8) this.idleAlign = true; else if (Math.abs(tw0) < 0.07) this.idleAlign = false;
      if (this.idleAlign) legTarget = this.aimYaw;
    }
    let turnCmd = 0;
    if (legTarget !== null) { alignErr = angDiff(legTarget, this.legYaw); turnCmd = Math.abs(alignErr) > 0.07 ? clamp(alignErr * 4, -1, 1) : 0; }
    const turning = moving && Math.abs(alignErr) > 0.6;
    this.turnVel = approach(this.turnVel, turnCmd * wMax, (sAbs < 3 ? 22 : 14) * dt);
    if (Math.abs(alignErr) < 0.2) this.turnVel = clamp(this.turnVel, -Math.abs(alignErr) * 9, Math.abs(alignErr) * 9);   // settle without overshoot
    this.legYaw += this.turnVel * dt;
    const wasBracing = this.bracing;
    this.bracing = C.brace && turning && sAbs > (C.top < TOP ? 9 : 15);
    if (this.bracing && !wasBracing) { this.bobV -= 5; G.addTrauma(0.22); G.camRollKick = (G.camRollKick || 0) - Math.sign(turnCmd) * 0.05; }   // plant and dip
    if (wasBracing && !this.bracing) this.exitBoost = 0.9;
    this.exitBoost = Math.max(0, this.exitBoost - dt);
    this.braceK = damp(this.braceK, this.bracing ? 1 : 0, this.bracing ? 12 : 4, dt);
    const top = C.top * lf * (wantSprint ? C.sprint : 1) * (this.heavy ? speedMul(this.unit) : 1);   // heavies: DRIVE bank and destroyed legs scale it
    let target = !moving ? 0 : back ? -C.back * lf * mag : top * mag;
    if (turning && target > C.corner) target = C.corner;          // corner speed while the turn is held
    const braking = Math.abs(target) < sAbs || target * this.speed < 0;
    const prev = this.speed;
    const rate = C.accel ? (braking ? C.brake : C.accel) * (this.bracing ? 1.8 : 1) : this.bracing ? (this.sprintK > 0.5 ? 46 : 36) : braking ? 24 : this.exitBoost > 0 ? 24 : wantSprint ? 17 : 15;
    this.speed = approach(this.speed, target, rate * dt);
    let maxTw = C.twist - 1.1 * this.sprintK;
    let tw = angDiff(this.aimYaw, this.legYaw);
    // the mouse always wins: past the waist limit the torso drags the legs round instead of the aim stopping
    if (tw > maxTw) { this.legYaw = this.aimYaw - maxTw; tw = maxTw; } else if (tw < -maxTw) { this.legYaw = this.aimYaw + maxTw; tw = -maxTw; }
    this.twist = tw;
    const fx = Math.sin(this.legYaw), fz = Math.cos(this.legYaw), lx = fz, lz = -fx;
    // momentum carry: whatever the old velocity had sideways of the new heading bleeds off through grip
    const grip = this.sprintK > 0.5 || prev > 32 ? 2.3 : this.bracing ? 3.0 : 5.0;
    this.lat = (this.vel.x * lx + this.vel.z * lz) * Math.exp(-grip * dt);
    if (!C.brace) this.lat = 0;
    this.vel.set(fx * this.speed + lx * this.lat, 0, fz * this.speed + lz * this.lat);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.slip = Math.abs(this.lat);
    const hit = this.heavy ? this.heavyCollide() : G.city.collideCircle(this.pos, 5.6);
    if (hit) {
      // Walls: the walker slides along them. Only the velocity component INTO the wall is removed, once, with no
      // scrape slowdown. Low/medium hab-blocks are smashed (sprint) or pushed over (walk) only when the legs are
      // driving squarely into them; spires and cathedral-factories always hold.
      const b = hit, nx = G.city.cnx || 0, nz = G.city.cnz || 0, small = !b.hero && b.hp0 <= 500 && b.h0 <= 46;
      const sp = Math.hypot(this.vel.x, this.vel.z), into = -(this.vel.x * nx + this.vel.z * nz), head = into / (sp + 0.01), first = this.hitWall !== b;
      const facing = -(fx * nx + fz * nz) * (moving ? (back ? -1 : 1) : 0);
      if (small && sp > 33 && head > 0.6) {
        G.city.collapse(b, this.vel.x, this.vel.z, true); this.ramFx(b, 1); G.blast(b.x, 0, b.z, b.hw + 5, 200, -1, true); this.speed *= 0.65; this.vel.multiplyScalar(0.65); this.damage(5, 'hull'); G.kick(1.2, 3); G.stats.rams = (G.stats.rams || 0) + 1;
      } else {
        if (first && into > 9 && head > 0.6) { const down = G.city.damage(b, small ? into * 11 : into * 3, this.vel.x, this.vel.z, true); this.ramFx(b, down ? 1 : small ? 0.6 : 0.45); if (down) G.blast(b.x, 0, b.z, b.hw + 5, 200, -1, true); if (!small) this.damage(into * 0.12, 'hull'); }
        if (small && b.alive && facing > 0.6) {
          this.pushAcc = (this.pushAcc || 0) + dt;
          const down = G.city.damage(b, 330 * dt, fx, fz, true);
          if (down) { this.ramFx(b, 1); G.blast(b.x, 0, b.z, b.hw + 5, 200, -1, true); G.stats.rams = (G.stats.rams || 0) + 1; }
          else if (this.pushAcc > 0.28) { this.pushAcc = 0; this.ramFx(b, 0.25); }
        }
        if (b.alive && into > 0) { this.vel.x += nx * into; this.vel.z += nz * into; this.speed = this.vel.x * fx + this.vel.z * fz; }
      }
    }
    this.hitWall = hit;
    this.pos.x = clamp(this.pos.x, -690, 690); this.pos.z = clamp(this.pos.z, -800, 800);
    // skid: scrape dust + sparks under the planted feet, grinding screech
    const skid = clamp((this.slip - 3) / 9, 0, 1);
    G.sfx.skid(skid);
    if (skid > 0) {
      this.skidAcc += dt * (10 + 30 * skid);
      while (this.skidAcc > 1) {
        this.skidAcc -= 1; const f = this.legs.feet[rnd() < 0.5 ? 0 : 1]; if (!f.planted && rnd() < 0.7) continue;
        const px = f.pos.x + rr(-2, 2), pz = f.pos.z + rr(-2, 2), s = Math.sign(this.lat) || 1;
        G.fx.smoke(px, 0.6, pz, lx * s * rr(3, 9), rr(1, 4), lz * s * rr(3, 9), rr(1.2, 2.6), 2.5, 9, 0.18, 0.45, 0.9);
        G.fx.sparks(px, 0.3, pz, 3, 10 + 8 * skid, 3, 1.8, 0.6, 0.45);
      }
    }
    if (this.heavy) { this.driveHeavy(dt, inp, tw); return; }
    // --- body motion ---
    this.bobV += (-this.bob * 130 - this.bobV * 12) * dt; this.bob += this.bobV * dt;
    this.rollKick = damp(this.rollKick, 0, 6, dt);
    this.pitch = damp(this.pitch, clamp((this.speed - prev) / Math.max(dt, 1e-3), -20, 20) * 0.009 + this.speed * 0.0055, 6, dt);
    this.roll = damp(this.roll, clamp(-this.turnVel * 0.07 * (0.4 + sAbs / TOP) - this.lat * 0.02, -0.4, 0.4), 7, dt);
    const hipY = WALKER.hipY + this.bob - Math.min(sAbs, TOP) / TOP * 1.0 - this.braceK * 1.6 - this.sprintK * 0.6;
    this.root.position.set(this.pos.x, 0, this.pos.z); this.root.rotation.y = this.legYaw;
    this.body.position.y = hipY; this.body.rotation.set(this.pitch, 0, this.roll + this.rollKick);
    this.torso.rotation.y = tw;
    const ap = clamp(this.aimPitch, -0.4, 0.95);
    this.armL.rotation.x = -ap; this.armR.rotation.x = -ap; this.head.rotation.x = -ap * 0.5;
    this.legs.o.stride = STRIDE + 5 * this.sprintK;
    this.legs.update(dt, this.pos, this.legYaw, this.vel.x, this.vel.z, hipY, 0);
    this.shadow.position.set(this.pos.x, 0.08, this.pos.z);
    this.root.updateMatrixWorld(true);

    // --- ward veil ---
    this.veilHitK = Math.max(0, this.veilHitK - dt * 1.8);
    const since = G.time - this.lastHit;
    if (this.veil < VEIL_MAX && since > 4.5 && !wantSprint) {
      if (!this.veilHum) { this.veilHum = true; G.sfx.veilUp(); }
      this.veil = Math.min(VEIL_MAX, this.veil + VEIL_MAX / 5.5 * dt);
      this.veilBase = this.veil < VEIL_MAX ? (0.25 + 0.75 * rnd()) * 0.5 : 0;   // flickers back
      if (this.veil >= VEIL_MAX) { this.veilHum = false; if (this.veilDown) { this.veilDown = false; G.announce('WARD VEIL RESTORED'); } }
    } else { this.veilBase = 0; if (since <= 4.5) this.veilHum = false; }
    const vu = this.veilMat.uniforms; vu.uHitK.value = this.veilHitK; vu.uBase.value = this.veilBase; vu.uT.value = G.time;
    this.veilMesh.visible = this.veilHitK > 0.01 || this.veilBase > 0.01; this.veilMesh.position.set(this.pos.x, 13.5, this.pos.z);

    // --- inferno projector (LMB): short-range sticky fire, fed from a pressure tank ---
    this.fuelRest -= dt;
    const wantF = !!inp.fire1 && !this.fuelLock && this.fuel > 0;
    this.muzzleL.getWorldPosition(_m);
    _d.subVectors(G.aimPoint, _m); const ad = _d.length() || 1; _d.multiplyScalar(1 / ad);
    if (ad > 26) { _d.y += 0.12 * Math.min(1, (ad - 26) / 30); _d.normalize(); }      // loft the stream when reaching
    const alliesInCone = G.units.flame(_m, _d, 42, 0, true);                // who is standing in the cone (for the ally warning)
    this.reach = wantF ? Math.min(42, (this.reach || 0) + 55 * dt) : 0;     // the jet takes time to get there
    if (wantF) { G.units.flame(_m, _d, this.reach, dt, true); G.scouts.flame(_m, _d, this.reach, dt, true); for (const h of G.hierarchs) h.flame(_m, _d, this.reach, dt, true); for (const h of G.harrows) h.flame(_m, _d, this.reach, dt, true); }
    G.allyWarn = alliesInCone > 0 || G.units.allyNear(G.aimPoint.x, G.aimPoint.z, 5);
    if (wantF) {
      if (!this.flaming) { this.flaming = true; this.newJet = true; G.sfx.flameStart(); G.fx.fire(_m.x, _m.y, _m.z, _d.x * 12, 3, _d.z * 12, 0.22, 3, 9, 1.6, 0.8, 0.2, 0.7); for (let k = 0; k < 4; k++) G.fx.flame(_m.x + _d.x * (1 + k), _m.y + _d.y * (1 + k), _m.z + _d.z * (1 + k), 3.5, 0.2, rnd()); }   // ignition flare
      { const s = this.spinePool.pop() || {}; s.x = _m.x + _d.x * 1.2; s.y = _m.y + _d.y * 1.2; s.z = _m.z + _d.z * 1.2; s.vx = _d.x * 56; s.vy = _d.y * 56 + 2; s.vz = _d.z * 56; s.age = 0; s.seed = rnd(); s.brk = false; if (this.newJet) { this.newJet = false; } this.spine.push(s); }
      this.fuel = Math.max(0, this.fuel - dt / 5.5); this.fuelRest = 0.6; if (this.fuel <= 0) { this.fuelLock = true; G.announce('INFERNO PRESSURE SPENT'); }
      this.fAcc += dt * 46; while (this.fAcc >= 1) { this.fAcc -= 1; this.spawnGlob(_m, _d); }
      for (let k = 0; k < 5; k++) G.fx.flame(_m.x + _d.x * k * 0.55, _m.y + _d.y * k * 0.55, _m.z + _d.z * k * 0.55, 1.35, 0.0, 0.11 + k * 0.23);   // the rope starts at the nozzle lip
      G.rumble = Math.max(G.rumble, 0.45);
      for (const a of G.air.list) if (a.alive && !a.falling) { _v.subVectors(a.pos, _m); const t = _v.dot(_d); if (t > 2 && t < 44 && _v.lengthSq() - t * t < (3 + t * 0.17) * (3 + t * 0.17)) G.air.damage(a, 70 * dt, true); }
      if (rnd() < dt * 12) G.sfx.flameCrackle();
    } else {
      if (this.flaming) { this.flaming = false; G.sfx.flameStop(); this.dripT = 1.4; }
      if (this.dripT > 0) { this.dripT -= dt; if (rnd() < dt * 14) this.spawnGlob(_m, _d, true); }   // burning fuel dribbles off the nozzle
      if (this.fuelRest <= 0) this.fuel = Math.min(1, this.fuel + dt / 5); if (this.fuelLock && this.fuel > 0.25) this.fuelLock = false;
      this.pilot.getWorldPosition(_v);   // pilot flame burns in the igniter cage
      if (rnd() < dt * 40) G.fx.fire(_v.x, _v.y, _v.z, _d.x * 3, 2.5, _d.z * 3, 0.12, 0.9, 0.2, 0.5, 1.0, 2.6, 0.9);
      G.fx.flame(_v.x, _v.y + 0.45, _v.z, 1.0, 0.3, 0.37);
    }
    this.nozzleHeat = Math.max(0, Math.min(1, (this.nozzleHeat || 0) + (wantF ? dt * 0.9 : -dt * 0.22))); { const h = this.nozzleHeat * this.nozzleHeat; this.nozzleGlowMat.color.setRGB(2.2 * h, 0.6 * h, 0.1 * h); }
    G.sfx.flame(wantF ? 1 : 0);
    this.updateGlobs(dt);
    this.heat = Math.max(0, this.heat - 0.1 * dt); if (this.overheat && this.heat < 0.4) this.overheat = false;
    // --- autocannon ---
    this.cannonCd -= dt; this.recoil = damp(this.recoil, 0, 5, dt); this.cannonBarrel.position.z = -this.recoil * 2.4;
    if (inp.fire2 && this.cannonCd <= 0) this.fireCannon();
    // --- sunspear (close-range fusion projector) ---
    this.spearCd = Math.max(0, this.spearCd - dt);
    if (inp.spear && this.spearCd <= 0 && !this.overheat) {
      if (this.spearCharge === 0) G.sfx.charge(SPEAR_CHARGE, 0.22);
      this.spearCharge += dt; const k = this.spearCharge / SPEAR_CHARGE;
      this.spearMuzzle.getWorldPosition(_m);
      G.fx.fire(_m.x + rr(-0.5, 0.5), _m.y + rr(-0.5, 0.5), _m.z + rr(-0.5, 0.5), 0, 0, 0, 0.1, 2 + 7 * k, 1, 4, 1.8 + k, 0.4 + k, 1);
      if (rnd() < dt * 40) { const a = rnd() * 6.28, r = 5; G.fx.fire(_m.x + Math.cos(a) * r, _m.y + rr(-r, r), _m.z + Math.sin(a) * r, -Math.cos(a) * r * 4, 0, -Math.sin(a) * r * 4, 0.25, 1.4, 0.3, 4, 2, 0.5, 1, 0); }
      G.rumble = Math.max(G.rumble || 0, 0.6 * k);
      if (this.spearCharge >= SPEAR_CHARGE) this.fireSpear();
    } else this.spearCharge = 0;
    // --- AA missiles ---
    this.aaReload = Math.max(0, this.aaReload - dt);
    if (inp.aa && this.aaReload <= 0) {
      G.camera.getWorldDirection(_d);
      const c = G.air.lockCandidate(G.camera.position, _d);
      if (c !== this.lockT) { this.lockT = c; this.lockProg = 0; }
      else if (c) { const p0 = this.lockProg; this.lockProg = Math.min(1, this.lockProg + dt / 0.7); if (Math.floor(p0 * 5) !== Math.floor(this.lockProg * 5)) G.sfx.lockTone(this.lockProg >= 1); }
      this.aaHeld = true; this.aaHold += dt;
    } else if (this.aaHeld) {
      this.aaHeld = false; this.aaHold = 0;
      if (this.aaReload <= 0) {
        const tgt = this.lockProg >= 1 ? this.lockT : null;
        for (let i = 0; i < 6; i++) this.salvo.push({ t: i * 0.09, tgt });
        this.aaReload = 7;
      }
      this.lockT = null; this.lockProg = 0;
    }
    for (let i = this.salvo.length - 1; i >= 0; i--) {
      const s = this.salvo[i]; s.t -= dt;
      if (s.t <= 0) {
        this.salvo.splice(i, 1); this.rack.getWorldPosition(_m);
        const ay = this.aimYaw, p = Math.max(0.35, this.aimPitch + 0.25);
        _d.set(Math.sin(ay) * Math.cos(p) + rr(-0.12, 0.12), Math.sin(p) + rr(-0.05, 0.1), Math.cos(ay) * Math.cos(p) + rr(-0.12, 0.12)).normalize();
        G.air.launchMissile(_m, _d, s.tgt);
        G.fx.muzzle(_m, _d, 0.8, 3, 2, 1); G.fx.flash(_m.x, _m.y, _m.z, 1, 0.7, 0.4, 900, 0.2, 80);
        for (let k = 0; k < 4; k++) G.fx.smoke(_m.x, _m.y, _m.z, -_d.x * rr(4, 14), rr(0, 3), -_d.z * rr(4, 14), rr(1, 2.2), 2, 7, 0.4, 0.5);
        G.sfx.missile(); G.stats.missiles++;
      }
    }
    // --- field repair ---
    if (since > 9) { this.hull = Math.min(100, this.hull + 2.5 * dt); this.legL = Math.min(100, this.legL + 2.5 * dt); this.legR = Math.min(100, this.legR + 2.5 * dt); }
    if (this.hull < 40 && rnd() < dt * 14) G.fx.smoke(this.pos.x + rr(-2, 2), 15, this.pos.z + rr(-2, 2), rr(-1, 1), rr(3, 6), rr(-1, 1), 2.5, 2, 8, 0.07, 0.6);
    if (this.limping && rnd() < dt * 8) G.fx.sparks(this.pos.x, 6, this.pos.z, 2, 8);
  }

  ramFx(b, k) {
    const G = this.G, cx = Math.max(b.x - b.hw, Math.min(b.x + b.hw, this.pos.x)), cz = Math.max(b.z - b.hd, Math.min(b.z + b.hd, this.pos.z));
    G.fx.debris(cx, 6, cz, Math.ceil(12 * k), 1.9, 22, 0.1); G.fx.dust(cx, 4, cz, 3, Math.ceil(8 * k) + 2, 0.15, 0.55); G.fx.sparks(cx, 6, cz, Math.ceil(10 * k), 18);
    G.sfx.crunch(0.4 + 0.6 * k); G.addTrauma(0.2 + 0.3 * k);
  }
  spawnGlob(m, d, drip) {
    const g = this.globPool.pop() || {}; const sp = drip ? rr(2, 7) : rr(50, 62), c = drip ? 0.5 : 0.1;
    g.x = m.x + d.x * 2; g.y = m.y + d.y * 2; g.z = m.z + d.z * 2; g.age = 0; g.drip = !!drip; g.seed = rnd();
    g.vx = (d.x + rr(-c, c)) * sp; g.vy = (d.y + rr(-c, c) * 0.7) * sp + 2; g.vz = (d.z + rr(-c, c)) * sp;
    this.globs.push(g); if (!drip) this.G.stats.rounds++;
  }
  // The jet is drawn from a "spine": one point leaves the nozzle every frame with the nozzle's direction at that moment
  // and then flies ballistically, so swinging the arm makes the rope of fuel whip and trail like a hose.
  updateGlobs(dt) {
    const G = this.G, fx = G.fx, gl = this.globs, sp = this.spine; this.lightT -= dt; let far = null;
    // --- spine physics ---
    for (let i = sp.length - 1; i >= 0; i--) {
      const s = sp[i]; s.age += dt; const k = Math.max(0, 1 - 0.9 * dt);
      s.vx *= k; s.vz *= k; s.vy = s.vy * k - 15 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.age > 0.8 || s.y < 0.3 || (s.age > 0.12 && G.city.solid(s.x, s.y, s.z))) { if (i + 1 < sp.length) sp[i + 1].brk = true; sp.splice(i, 1); this.spinePool.push(s); }
    }
    // --- rope: dense chain of small hot sprites from the nozzle, widening and cooling along the arc ---
    for (let i = 0; i < sp.length; i++) {
      const s = sp[i], n = i + 1 < sp.length && !sp[i + 1].brk ? sp[i + 1] : null, a = s.age / 0.8;
      const sub = n ? (a < 0.3 ? 3 : 2) : 1;
      for (let j = 0; j < sub; j++) {
        const u = j / sub, x = n ? s.x + (n.x - s.x) * u : s.x, y = n ? s.y + (n.y - s.y) * u : s.y, z = n ? s.z + (n.z - s.z) * u : s.z, aa = n ? a + (n.age / 0.8 - a) * u : a;
        const w = aa * aa * 2.2, ph = s.seed * 40 + j * 1.7;                         // turbulence grows with distance
        fx.flame(x + Math.sin(ph + G.time * 9) * w, y + Math.cos(ph * 1.3 + G.time * 7) * w * 0.6, z + Math.sin(ph * 0.7 + G.time * 8) * w, 1.9 + aa * 4.5 + aa * aa * 4, Math.pow(aa, 1.7) * 0.62, s.seed + j * 0.37);
      }
      if (a > 0.3 && rnd() < dt * 3.5) fx.smoke(s.x, s.y + 1.5, s.z, s.vx * 0.12 + rr(-1, 1), rr(4, 8), s.vz * 0.12 + rr(-1, 1), rr(2, 4), 2.5, 11, 0.028, 0.75, 0.4);   // black smoke rolling off the top
    }
    // --- breakup: the stream frays into rolling fireballs, splashes and sticks where it lands ---
    for (let i = gl.length - 1; i >= 0; i--) {
      const g = gl[i]; g.age += dt; const k = Math.max(0, 1 - 0.9 * dt);
      g.vx *= k; g.vz *= k; g.vy = g.vy * k - 15 * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const a = Math.min(1, g.age / 0.8);
      if (g.drip) fx.flame(g.x, g.y, g.z, 1.1, 0.25 + a * 0.4, g.seed);
      else if (a > 0.28) fx.flame(g.x, g.y, g.z, 1.5 + a * 8.5, 0.3 + a * 0.55, g.seed);
      if (!g.drip && a > 0.4 && rnd() < dt * 4) fx.smoke(g.x, g.y + 2, g.z, g.vx * 0.12, rr(4, 8), g.vz * 0.12, rr(2, 4.5), 3, 13, 0.028, 0.75, 0.4);
      let done = g.age > (g.drip ? 2.5 : 0.85);
      if (g.y < 0.4) {
        if (!g.drip) { G.units.addPatch(g.x, g.z, true); for (let s = 0; s < 2; s++) fx.fire(g.x, 0.6, g.z, rr(-9, 9), rr(4, 10), rr(-9, 9), rr(0.25, 0.5), 1.4, 0.4, 1.6, 0.6, 0.1, 0.8, 0.5, 20); }   // splash
        else fx.decal(g.x, g.z, 1.2);
        done = true;
      } else if (!g.drip && g.age > 0.12) { const b = G.city.solid(g.x, g.y, g.z); if (b) { G.city.ignite(b, g.x, g.y, g.z); if (g.y < 7) G.units.addPatch(g.x - g.vx * 0.05, g.z - g.vz * 0.05, true); done = true; } }
      if (done) { gl[i] = gl[gl.length - 1]; gl.pop(); this.globPool.push(g); } else if (!g.drip && (!far || g.age > far.age)) far = g;
    }
    if (far && this.lightT <= 0) { this.lightT = 0.09; fx.flash(far.x, far.y + 3, far.z, 1, 0.5, 0.14, 1100, 0.22, 80); }   // warm light thrown down the street
  }
  fireCannon() {
    const G = this.G; this.cannonCd = 0.85; this.recoil = 1; G.stats.shells++;
    this.muzzleR.getWorldPosition(_m);
    _d.subVectors(G.aimPoint, _m).normalize();
    const h = G.shoot(_m, _d, 1200, -1, { probe: true, radius: 1.4, byPlayer: true });
    const dx = _d.x, dz = _d.z;
    G.fx.tracer(_m.x, _m.y, _m.z, h.x, h.y, h.z, 520, 34, 1.2, 5, 2.6, 0.8, () => {
      G.fx.explosion(h.x, h.y, h.z, 1.5);
      if (h.type === 'tank') G.units.damageTank(h.ref, 200, true);
      else if (h.type === 'air') G.air.damage(h.ref, 90);
      else if (h.type === 'col' || h.type === 'hier' || h.type === 'harrow') { h.ref.damage(h.type === 'col' ? 28 : h.type === 'hier' ? 45 : 55, true, false, { x: h.x, y: h.y, z: h.z }); h.ref.breakT = 3; }   // a Kestrel autocannon shell breaks the ward's regen pause
      else if (h.type === 'scout') G.scouts.damage(h.ref, 150, true, _m.x, _m.z);
      else if (h.type === 'struct') h.ref.damage(40, true, false, { x: h.x, y: h.y, z: h.z });
      else if (h.type === 'bld') { G.city.damage(h.ref, 100, dx, dz); G.fx.debris(h.x, h.y, h.z, 5, 1.2, 14, 0.1); G.fx.dust(h.x, h.y, h.z, 2.5, 5); }
      G.blast(h.x, h.y, h.z, 10, 120, 0, true);
    });
    G.fx.muzzle(_m, _d, 2.2, 4, 2.4, 0.8); G.fx.flash(_m.x, _m.y, _m.z, 1, 0.65, 0.3, 5000, 0.16, 160);
    for (let k = 0; k < 7; k++) G.fx.smoke(_m.x + _d.x * k, _m.y, _m.z + _d.z * k, _d.x * rr(4, 20) + rr(-3, 3), rr(0, 4), _d.z * rr(4, 20) + rr(-3, 3), rr(1.2, 2.6), 2.5, 9, 0.35, 0.45);
    G.fx.dust(this.pos.x, 0.5, this.pos.z, 2.2, 5, 0.17, 0.3);
    G.sfx.cannon(); G.kick(1, 3); this.bobV -= 3;
  }
  fireSpear() {
    const G = this.G, fx = G.fx; this.spearCharge = 0; this.spearCd = SPEAR_CD; this.heat = Math.min(1, this.heat + 0.55); if (this.heat >= 1) this.overheat = true;
    this.spearMuzzle.getWorldPosition(_m);
    _d.subVectors(G.aimPoint, _m).normalize();
    // colossus legs first (they are not part of the general hitscan), then the world
    let best = null, bt = SPEAR_RANGE;
    for (const c of G.colossi.concat(G.hierarchs, G.harrows)) { const r = c.rayLeg(_m, _d, bt); if (r) { bt = r.t; best = { col: c, leg: true }; } }
    const h = G.shoot(_m, _d, bt, -1, { probe: true, radius: 2.5, byPlayer: true });
    if (h.t < bt - 0.01 || !best) { best = h.type === 'col' || h.type === 'hier' || h.type === 'harrow' ? { col: h.ref, leg: false } : null; bt = h.t; }
    _e.copy(_m).addScaledVector(_d, bt);
    fx.beam(_m, _e, 2.2, 5, 2.2, 0.45, 0.55); fx.beam(_m, _e, 0.8, 7, 6, 4, 0.55);
    fx.flash(_e.x, _e.y, _e.z, 1, 0.55, 0.2, 9000, 0.5, 200); fx.flash(_m.x, _m.y, _m.z, 1, 0.6, 0.25, 5000, 0.3, 120);
    fx.explosion(_e.x, _e.y, _e.z, 2.4); fx.sparks(_e.x, _e.y, _e.z, 40, 34);
    for (let k = 0; k < 10; k++) { const t = rnd() * bt; fx.smoke(_m.x + _d.x * t, _m.y + _d.y * t, _m.z + _d.z * t, rr(-2, 2), rr(2, 6), rr(-2, 2), rr(1.5, 3), 2, 9, 0.3, 0.4); }
    if (best) { best.col.spearHit(_d, best.leg, _e); this.spearHits++; }
    else if (h.type === 'tank') G.units.damageTank(h.ref, 999, true);
    else if (h.type === 'struct') h.ref.damage(650, true, false, { x: _e.x, y: _e.y, z: _e.z });
    else if (h.type === 'bld') { G.city.damage(h.ref, 650, _d.x, _d.z); fx.debris(_e.x, _e.y, _e.z, 8, 1.6, 18, 0.1); }
    else if (h.type === 'air') G.air.damage(h.ref, 400);
    else if (h.type === 'scout') G.scouts.damage(h.ref, 700, true, _m.x, _m.z, true);   // ignores the veil
    G.blast(_e.x, _e.y, _e.z, 8, 250, 0, true);
    G.sfx.lance(0); G.kick(1.6, 5); this.bobV -= 5; G.stats.spears = (G.stats.spears || 0) + 1;
  }
}
