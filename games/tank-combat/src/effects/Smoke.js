// Smoke, dust, plumes and smoke screens (soft billow sprites, normal blending) plus the CPU smoke volumes used for
// line-of-sight blocking. Visual particles and logical volumes are created together so they always agree.
import { ParticleSystem, TILE } from './Particles.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const BILLOW = () => 1 + (Math.random() < 0.5 ? 0 : 1);

export class SmokeSystem {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.ps = new ParticleSystem(scene, { max: 7000, renderOrder: 10, terrain });
    this.glow = null; // additive system, injected by the game (explosions.glow)
    this.clouds = []; // logical volumes: { x, y, z, r0, rg, tau, age, duration }
    this.emitters = []; // timed emitters: { x, y, z, t, dur, rate, acc, fn }
  }

  // ---- logical smoke volume (used by isBlocked / future AI) ----
  volume(x, y, z, r0, rg, tau, duration, ramp = 1.5) {
    this.clouds.push({ x, y, z, r0, rg, tau, age: 0, duration, ramp });
  }

  radiusOf(c) { return c.r0 + c.rg * (1 - Math.exp(-c.age / c.tau)); }

  // true when the segment passes through a smoke core (T = exp(-tau) < 0.15)
  isBlocked(ax, ay, az, bx, by, bz) {
    let tau = 0;
    for (const c of this.clouds) {
      const life = c.age / c.duration;
      const dens = Math.min(1, c.age / (c.ramp || 1.5)) * (life > 0.6 ? Math.max(0, 1 - (life - 0.6) / 0.4) : 1);
      if (dens <= 0.02) continue;
      const r = this.radiusOf(c);
      const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1;
      let t = ((c.x - ax) * dx + (c.y - ay) * dy + (c.z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - c.x, py = ay + dy * t - c.y, pz = az + dz * t - c.z;
      const d2 = px * px + py * py + pz * pz;
      if (d2 >= r * r) continue;
      tau += dens * 2 * Math.sqrt(r * r - d2) * 0.35;
    }
    return Math.exp(-tau) < 0.15;
  }

  _emitter(x, y, z, dur, rate, fn) { this.emitters.push({ x, y, z, t: 0, dur, rate, acc: 0, fn }); }

  // ---- SMOKE shell: big billow burst + a canister that keeps feeding the cloud for ~45 s ----
  cloud(x, y, z) {
    this.volume(x, y + 4, z, 3, 9, 4, 60);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.283, s = rnd(8, 14), g = rnd(0.86, 0.94);
      this.ps.emit({
        x: x + rnd(-2, 2), y: y + rnd(0.5, 4), z: z + rnd(-2, 2), vx: Math.cos(a) * s, vy: rnd(0, 4), vz: Math.sin(a) * s,
        life: rnd(26, 32), size0: 2, size1: rnd(8, 11), alpha: rnd(0.75, 0.9), r: g, g: g, b: g * 0.98, drag: 2.5, grav: -0.1, wind: 0.5,
        fadeIn: 0.03, fadeOut: 0.3, rotSpeed: rnd(-0.1, 0.1), tile: BILLOW(),
      });
    }
    this._emitter(x, y, z, 45, 3, (e) => {
      const g = rnd(0.88, 0.94);
      this.ps.emit({
        x: e.x + rnd(-2, 2), y: e.y + rnd(0, 2), z: e.z + rnd(-2, 2), vx: rnd(-0.5, 0.5), vy: 0.8, vz: rnd(-0.5, 0.5),
        life: 30, size0: 3, size1: 12, alpha: 0.7, r: g, g: g, b: g, drag: 0.5, grav: -0.1, wind: 0.6, fadeIn: 0.1, fadeOut: 0.3, rotSpeed: rnd(-0.08, 0.08), tile: BILLOW(),
      });
    });
  }

  // ---- vehicle smoke grenade air-burst (spec 6.7): pop + dense billows that join into a wall ----
  grenadeBurst(x, y, z) {
    this.volume(x, y, z, 2, 4.5, 2.5, 35);
    if (this.glow) this.glow.emit({ x, y, z, life: 0.09, size0: 1.5, size1: 2.8, alpha: 1, r: 3.2, g: 2.9, b: 2.4, tile: TILE.STAR, fadeIn: 0, fadeOut: 0.8, ground: false });
    for (let i = 0; i < 14; i++) {
      const d = [Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5];
      const l = Math.hypot(d[0], d[1], d[2]) || 1, s = rnd(6, 10);
      const g = 0.74 + 0.2 * Math.min(1, Math.max(0, (d[1] / l + 0.5) / 1.2));
      this.ps.emit({
        x: x + rnd(-0.5, 0.5), y: y + rnd(-0.5, 0.5), z: z + rnd(-0.5, 0.5), vx: (d[0] / l) * s, vy: (d[1] / l) * s * 0.7, vz: (d[2] / l) * s,
        life: rnd(25, 35), size0: 2.2, size1: rnd(8, 10), alpha: rnd(0.88, 0.95), r: g, g: g, b: g * 0.98, drag: 2.5, grav: -0.05, wind: 0.5,
        fadeIn: 0.03, fadeOut: 0.25, rotSpeed: rnd(-0.1, 0.1), tile: BILLOW(), ground: false,
      });
    }
    // settling feed: ~5/s for 3 s so the screen stays opaque as the first puffs drift
    this._emitter(x, y, z, 3, 5, (e) => {
      const g = rnd(0.62, 0.9);
      this.ps.emit({
        x: e.x + rnd(-2.5, 2.5), y: e.y + rnd(-2, 1.5), z: e.z + rnd(-2.5, 2.5), vx: rnd(-1, 1), vy: -0.3, vz: rnd(-1, 1),
        life: 25, size0: 4, size1: 9.5, alpha: 0.85, r: g, g: g, b: g, drag: 1, grav: 0.05, wind: 0.5, fadeIn: 0.1, fadeOut: 0.25, rotSpeed: rnd(-0.1, 0.1), tile: BILLOW(),
      });
    });
    if (this.glow) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * 6.283, s = rnd(4, 8);
        this.glow.emit({ x, y, z, vx: Math.cos(a) * s, vy: rnd(2, 5), vz: Math.sin(a) * s, life: 1.2, size0: 0.25, size1: 0.2, alpha: 1, r: 2.4, g: 1.6, b: 0.8, tile: TILE.EMBER, grav: 9.81, drag: 0.5, fadeIn: 0, fadeOut: 0.6, ground: false });
      }
    }
  }

  // tiny grey grenade-trail puff
  trail(x, y, z) {
    this.ps.emit({ x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0, 0.4), vz: rnd(-0.3, 0.3), life: 1.3, size0: 0.25, size1: 1.4, alpha: 0.45, r: 0.8, g: 0.8, b: 0.78, drag: 1, grav: -0.1, fadeIn: 0.05, fadeOut: 0.7, tile: TILE.PUFF, ground: false });
  }

  // Warm tan dust (muzzle blast, impacts, explosions). 'speed' = outward speed
  dust(x, y, z, count, size, speed, life = 2.2, up = 1.5, alpha = 0.55, col = [0.62, 0.55, 0.42]) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.283, s = speed * rnd(0.3, 1);
      const k = rnd(0.88, 1.06);
      this.ps.emit({
        x: x + rnd(-0.4, 0.4), y, z: z + rnd(-0.4, 0.4),
        vx: Math.cos(a) * s, vy: rnd(0.2, 1) * up, vz: Math.sin(a) * s,
        life: life * rnd(0.7, 1.2), size0: size * rnd(0.35, 0.6), size1: size * rnd(1.1, 1.8),
        alpha, r: col[0] * k, g: col[1] * k, b: col[2] * k, drag: 2.2, grav: -0.1, wind: 0.5,
        fadeIn: 0.08, fadeOut: 0.6, rotSpeed: rnd(-0.6, 0.6), tile: BILLOW(),
      });
    }
  }

  // Grey-white propellant smoke puff
  puff(x, y, z, vx, vy, vz, size, life = 2.5, alpha = 0.5, shade = 0.82) {
    this.ps.emit({
      x, y, z, vx, vy, vz, life, size0: size * 0.4, size1: size * 1.6, alpha,
      r: shade, g: shade, b: shade * 0.97, drag: 3, grav: -0.6, wind: 0.5, fadeIn: 0.05, fadeOut: 0.5, rotSpeed: rnd(-0.5, 0.5), tile: BILLOW(),
    });
  }

  // Dark rising smoke (explosions). shade ~0.1-0.2
  black(x, y, z, count, size, rise = 5, life = 5, alpha = 0.75) {
    for (let i = 0; i < count; i++) {
      const g = rnd(0.07, 0.2);
      this.ps.emit({
        x: x + rnd(-1.5, 1.5), y: y + rnd(0, 1.5), z: z + rnd(-1.5, 1.5),
        vx: rnd(-2.5, 2.5), vy: rnd(0.5, 1) * rise, vz: rnd(-2.5, 2.5),
        life: life * rnd(0.7, 1.3), size0: size * 0.5, size1: size * rnd(1.4, 2.4), alpha,
        r: g * 1.1, g: g, b: g * 0.95, drag: 1.5, grav: -0.8, wind: 0.7, fadeIn: 0.06, fadeOut: 0.55, rotSpeed: rnd(-0.4, 0.4), tile: BILLOW(),
      });
    }
  }

  // Tall black plume that persists after big explosions: ~30 particles over `dur` s, rising 3-5 m/s, drifting downwind
  plume(x, y, z, { dur = 2, count = 32, life = 28, size1 = 14, up = 4 } = {}) {
    this._emitter(x, y, z, dur, count / dur, (e) => {
      const g = rnd(0.05, 0.09);
      this.ps.emit({
        x: e.x + rnd(-1.2, 1.2), y: e.y + rnd(0, 1), z: e.z + rnd(-1.2, 1.2), vx: rnd(-0.6, 0.6), vy: rnd(0.75, 1.25) * up, vz: rnd(-0.6, 0.6),
        life: life * rnd(0.8, 1.2), size0: 1.5, size1: size1 * rnd(0.7, 1.1), alpha: 0.85, r: g * 1.1, g: g, b: g * 0.95,
        drag: 0.25, grav: -0.6, wind: 1.0, fadeIn: 0.006, fadeOut: 0.55, rotSpeed: rnd(-0.2, 0.2), tile: BILLOW(),
      });
    });
  }

  update(dt) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.age += dt;
      if (c.age > c.duration) this.clouds.splice(i, 1);
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt; e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; e.fn(e); }
      if (e.t >= e.dur) this.emitters.splice(i, 1);
    }
    this.ps.update(dt);
  }
}
