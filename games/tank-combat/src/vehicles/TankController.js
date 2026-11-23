// Simplified hull physics (no physics engine): throttle inertia, braking, slopes, neutral steer,
// terrain-following spring-damper suspension, gears/RPM for the HUD and collision resolution.
// heading h: forward = (sin h, cos h); increasing h turns left (counter-clockwise from above).
import { clamp, lerp, approach, damp } from '../util/math.js';

const MAX_FWD = 60 / 3.6;
const MAX_REV = 15 / 3.6;
const GEAR_TOPS = [12, 23, 34, 45, 55, 65]; // km/h at the top of each forward gear
const SUB_DT = 1 / 120;

export class TankController {
  constructor(world, x, z, heading, dims = { hx: 1.85, hz: 3.55 }) {
    this.world = world;
    this.terrain = world.terrain;
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.yawRate = 0; this.accel = 0;
    this.y = this.terrain.getHeight(x, z);
    this.yVel = 0;
    this.pitch = 0; this.pitchVel = 0; // pitch: nose-up positive
    this.roll = 0; this.rollVel = 0;   // roll: +ve lifts the left side
    this.slopeF = 0;
    this.gear = 0; this.rpm = 800;
    this.leftSpeed = 0; this.rightSpeed = 0;
    this.health = 100; this.maxHealth = 100;
    this.time = 0; this.bobPhase = 0;
    this.throttleCmd = 0;
    this._lastBump = 0; this._onClimb = false;
    this.onCrush = null; // optional (collider, speed) callback for FX
    this.box = { x, z, hx: dims.hx, hz: dims.hz, cos: 1, sin: 0 };
    this._hit = { hit: false, nx: 0, nz: 0, depth: 0 };
    this.collider = world.addBox(x, z, dims.hx, dims.hz, heading, { dynamic: true, owner: this, tag: 'tank', height: 1.5 });
  }

  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  get gearLabel() { return this.gear < 0 ? 'R' : this.gear === 0 ? 'N' : String(this.gear); }

  getForward(out) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  // input: { throttle: -1..1, steer: -1..1 (+1 = left), brake: bool }
  update(dt, input) {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, SUB_DT);
      this._step(h, input);
      left -= h;
    }
    this._gears(dt, input);
    this.leftSpeed = this.speed - this.yawRate * 1.48;
    this.rightSpeed = this.speed + this.yawRate * 1.48;
    this.world.moveCollider(this.collider, this.x, this.z, this.heading, this.y - 0.3);
  }

  // recoil / explosion shove: pitch & roll impulses (rad/s) and a speed change (m/s)
  kick(pitchImpulse, rollImpulse, speedImpulse) {
    this.pitchVel += pitchImpulse;
    this.rollVel += rollImpulse;
    this.speed += speedImpulse;
  }

  // solid obstacle contact: (nx, nz) is the push-out direction. Only the normal part of the velocity is removed: the
  // hull is nudged toward the surface tangent so it slides along it, and a head-on push stays free to pivot away.
  _contact(nx, nz, dt = SUB_DT) {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const dot = s * nx + c * nz;
    const sp = this.speed;
    const impact = Math.abs(sp * dot);
    if (sp * dot < 0) {
      const into = Math.abs(dot);
      this.speed *= 1 - Math.min(1, into * into * 4 * dt); // continuous: head-on stops in ~0.3 s, glancing barely slows
      const sg = sp > 0 ? 1 : -1;
      const al = -nz * s + nx * c, ts = al * sg >= 0 ? 1 : -1; // surface tangent pointing the way we travel
      const turn = sg * ts * (-nz * c - nx * s); // +ve: that tangent lies to the tank's left (heading increases to the left)
      this.heading += Math.max(-1, Math.min(1, turn * 3)) * (1 - into) * into * 6.6 * dt;
    }
    if (impact > 2.5 && this._lastBump <= 0) { this.pitchVel += Math.min(impact * 0.012, 0.12) * (this.speed >= 0 ? 1 : -1); this._lastBump = 0.4; }
    return impact;
  }

  _step(dt, input) {
    const T = this.terrain;
    this.time += dt;
    const h = this.heading, s = Math.sin(h), c = Math.cos(h);
    const hl = 3.0, hw = 1.6;
    const fx = s * hl, fz = c * hl, lx = c * hw, lz = -s * hw;
    const W = this.world;
    const gh = (px, pz) => T.getHeight(px, pz) + W.climbHeight(px, pz); // ground plus climbable low obstacles
    const hFL = gh(this.x + fx + lx, this.z + fz + lz);
    const hFR = gh(this.x + fx - lx, this.z + fz - lz);
    const hRL = gh(this.x - fx + lx, this.z - fz + lz);
    const hRR = gh(this.x - fx - lx, this.z - fz - lz);
    const slopeF = ((hFL + hFR) - (hRL + hRR)) / (4 * hl);
    const slopeS = ((hFL + hRL) - (hFR + hRR)) / (4 * hw);
    const groundY = (hFL + hFR + hRL + hRR) * 0.25;
    this.slopeF = slopeF;

    // ---- longitudinal ----
    let v = this.speed;
    const thr = input.throttle;
    const slopeAng = Math.atan(slopeF);
    const gravA = -9.81 * Math.sin(slopeAng) * 0.75;
    const vmaxUp = MAX_FWD * (1 - clamp(slopeF * 2.4, 0, 0.7));
    let a = 0;
    const prevV = v;
    if (input.brake) {
      const dec = 11;
      v = approach(v, 0, dec * dt);
      a = 0;
    } else if (thr > 0.01) {
      if (v < -0.4) a = 9;
      else {
        const k = clamp(v / MAX_FWD, 0, 1);
        a = v > vmaxUp ? -3 : lerp(3.4, 0.45, k) * thr;
      }
    } else if (thr < -0.01) {
      if (v > 0.4) a = -9;
      else a = v < -MAX_REV ? 2.5 : -lerp(2.2, 0.5, clamp(-v / MAX_REV, 0, 1)) * -thr;
    } else {
      // rolling friction / engine braking
      const fr = 1.3 + 0.025 * Math.abs(v);
      v = approach(v, 0, fr * dt);
    }
    v += (a + gravA) * dt;
    // static hold: coasting to a stop on gentle ground
    if (!input.brake && Math.abs(thr) < 0.01 && Math.abs(v) < 0.12 && Math.abs(slopeF) < 0.45) v = 0;
    if (input.brake && Math.abs(v) < 0.05) v = 0;
    v = clamp(v, -MAX_REV * 1.05, MAX_FWD * 1.12);
    // direction flip while braking (pressing opposite) should stop at zero before reversing
    if (a !== 0 && ((prevV > 0 && v < 0 && thr < 0 && prevV > 0.4) || (prevV < 0 && v > 0 && thr > 0 && prevV < -0.4))) v = 0;
    this.speed = v;
    this.accel += ((v - prevV) / dt - this.accel) * Math.min(1, dt * 6);

    // ---- yaw ----
    const sf = clamp(Math.abs(v) / MAX_FWD, 0, 1);
    const maxTurn = lerp(0.46, 0.17, sf);
    const target = input.steer * maxTurn;
    const rate = Math.abs(target) > 1e-3 ? 1.5 : 2.6;
    this.yawRate = approach(this.yawRate, target, rate * dt);
    this.speed -= Math.sign(this.speed) * Math.abs(this.yawRate) * sf * 1.2 * dt;
    this.heading += this.yawRate * dt;

    // ---- integrate ----
    const hs = Math.sin(this.heading), hc = Math.cos(this.heading);
    this.x += hs * this.speed * dt;
    this.z += hc * this.speed * dt;

    // ---- collisions + bounds ----
    const box = this.box;
    box.x = this.x; box.z = this.z; box.cos = hc; box.sin = hs; box.speed = this.speed;
    this._lastBump -= dt;
    if (this.world.collideOBB(box, this, this._hit)) {
      this.x = box.x; this.z = box.z;
      if (this._hit.hit) this._contact(this._hit.nx, this._hit.nz, dt);
      const cr = this._hit.crushed;
      if (cr.length) {
        const sg = this.speed >= 0 ? 1 : -1;
        for (let k = 0; k < cr.length; k++) {
          const o = cr[k];
          this.world.crushCollider(o, hs * sg, hc * sg, Math.abs(this.speed));
          this.speed *= o.slow;
          this.pitchVel += (o.jolt || 0.05) * sg; this.rollVel += (o.jolt || 0.05) * 0.5 * (Math.random() < 0.5 ? -1 : 1);
          if (this.onCrush) this.onCrush(o, Math.abs(this.speed));
        }
      }
    }
    // climbing: one speed loss when the hull gets onto an obstacle (a continuous drag would out-pull the engine and trap
    // the tank on a large pad); after that only the slope itself slows it
    if (this._hit.climb && !this._onClimb) this.speed *= 0.8;
    this._onClimb = this._hit.climb;
    const B = this.world.half;
    if (this.x > B) { this.x = B; this._contact(-1, 0); }
    else if (this.x < -B) { this.x = -B; this._contact(1, 0); }
    if (this.z > B) { this.z = B; this._contact(0, -1); }
    else if (this.z < -B) { this.z = -B; this._contact(0, 1); }

    // ---- suspension / hull attitude ----
    const moving = clamp(Math.abs(this.speed) / 8, 0, 1);
    this.bobPhase += Math.abs(this.speed) * dt * 1.9;
    const bobY = (Math.sin(this.bobPhase) * 0.012 + Math.sin(this.bobPhase * 2.31 + 1.0) * 0.006) * moving
      + Math.sin(this.time * 52) * 0.0012;
    const bobP = Math.sin(this.bobPhase * 1.3 + 0.5) * 0.004 * moving;
    const lat = this.speed * this.yawRate;
    const tgtPitch = Math.atan(slopeF) + clamp(this.accel * 0.011, -0.1, 0.07) + bobP;
    const tgtRoll = Math.atan(slopeS) + clamp(lat * 0.004, -0.05, 0.05);
    this.pitchVel += (45 * (tgtPitch - this.pitch) - 5.5 * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.rollVel += (55 * (tgtRoll - this.roll) - 6.5 * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.yVel += (120 * (groundY + bobY - this.y) - 16 * this.yVel) * dt;
    this.y += this.yVel * dt;
    if (this.y < groundY - 0.12) { this.y = groundY - 0.12; this.yVel = 0; }
  }

  _gears(dt, input) {
    const kmh = this.speedKmh;
    const thr = input.throttle;
    if (this.speed < -0.25) this.gear = -1;
    else {
      if (this.gear <= 0) this.gear = (kmh > 0.4 || Math.abs(thr) > 0.01) ? 1 : 0;
      if (this.gear > 0) {
        if (this.gear < 6 && kmh > GEAR_TOPS[this.gear - 1] * 0.93) this.gear++;
        else if (this.gear > 1 && kmh < GEAR_TOPS[this.gear - 2] * 0.72) this.gear--;
        if (kmh < 0.3 && Math.abs(thr) < 0.01) this.gear = 0;
      }
    }
    let tgt;
    if (this.gear < 0) tgt = 900 + (Math.abs(this.speed) / MAX_REV) * 1300;
    else if (this.gear === 0) tgt = 800;
    else tgt = 900 + clamp(kmh / GEAR_TOPS[this.gear - 1], 0, 1.05) * 1500;
    tgt += Math.abs(thr) * (kmh < 4 ? 650 : 120);
    this.rpm += (tgt - this.rpm) * damp(7, dt);
  }

  syncModel(model) {
    const r = model.root;
    r.rotation.order = 'YXZ';
    r.position.set(this.x, this.y, this.z);
    r.rotation.set(-this.pitch, this.heading, this.roll);
  }
}
