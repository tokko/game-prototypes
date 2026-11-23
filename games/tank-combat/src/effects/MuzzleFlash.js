// Muzzle flash (star + axial flames + fireball sprites, light), dense muzzle smoke ring, ground blast dust and clods.
import { TILE } from './Particles.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class MuzzleFlash {
  constructor(terrain, smoke, explosions, lights) {
    this.terrain = terrain;
    this.smoke = smoke;
    this.glow = explosions.glow;
    this.lights = lights;
  }

  // main gun. pos = muzzle, dir = barrel direction. scale lowers the flash in the gunner's sight.
  fire(pos, dir, scale = 1) {
    const { x, y, z } = pos;
    const g = this.glow;
    const at = (k) => ({ x: x + dir.x * k, y: y + dir.y * k, z: z + dir.z * k });
    // core star
    const c0 = at(0.6);
    g.emit({ ...c0, life: 0.06, size0: 2.6 * scale, size1: 3.4 * scale, alpha: 1, r: 4, g: 3.7, b: 3.1, tile: TILE.STAR, fadeIn: 0, fadeOut: 0.3, ground: false });
    // axial flames along the barrel axis
    [[0.8, 1.6], [1.6, 1.3], [2.6, 0.9]].forEach(([k, sz]) => {
      const p = at(k);
      g.emit({ ...p, vx: dir.x * 25, vy: dir.y * 25, vz: dir.z * 25, life: rnd(0.07, 0.09), size0: sz * scale, size1: sz * 1.4 * scale, alpha: 0.95, r: 3, g: 2.3, b: 1.3, tile: TILE.FIRE, drag: 20, fadeIn: 0, fadeOut: 0.4, ground: false, rot: 0 });
    });
    // fireball sprites with a 12 degree cone
    for (let i = 0; i < 6; i++) {
      const sp = rnd(18, 30), j = 0.21;
      g.emit({
        ...at(0.3), vx: (dir.x + rnd(-j, j)) * sp, vy: (dir.y + rnd(-j, j)) * sp, vz: (dir.z + rnd(-j, j)) * sp,
        life: rnd(0.12, 0.18), size0: 0.8 * scale, size1: 2.2 * scale, alpha: 0.9, r: 3, g: 1.8, b: 0.8, tile: TILE.FIRE, drag: 12, grav: -1, fadeIn: 0, fadeOut: 0.4, ground: false,
      });
    }
    this.lights.flash(x + dir.x * 1.5, y + dir.y * 1.5 + 0.3, z + dir.z * 1.5, 1800 * scale, 0.1, 0xffb25a, 55);

    // dense propellant smoke rolling off the muzzle (pushed well forward and thinner when the camera is in the sight)
    const optics = scale < 0.9;
    for (let i = 0; i < 14; i++) {
      const k = optics ? rnd(2, 6) : rnd(0, 3), sp = optics ? rnd(16, 26) : rnd(6, 14), j = 0.45;
      this.smoke.ps.emit({
        x: x + dir.x * k, y: y + dir.y * k, z: z + dir.z * k, vx: (dir.x + rnd(-j, j)) * sp, vy: (dir.y + rnd(-j, j)) * sp + 0.5, vz: (dir.z + rnd(-j, j)) * sp,
        life: rnd(2.5, 4), size0: 0.6, size1: 4.5, alpha: optics ? 0.3 : 0.55, nearFade: true, r: 0.74, g: 0.71, b: 0.65, drag: 3, grav: -0.6, wind: 0.5,
        fadeIn: 0.05, fadeOut: 0.5, rotSpeed: rnd(-0.5, 0.5), tile: 1 + (i % 2), ground: false,
      });
    }
    // ground blast: dust arc ahead of the tank when the barrel is low, plus flung clods
    const gh = this.terrain.getHeight(x + dir.x * 6, z + dir.z * 6);
    const h = y + dir.y * 6 - gh;
    if (h < 8) {
      const az = Math.atan2(dir.x, dir.z);
      const dk = optics ? 0.25 : 1; // far less ground dust when the camera sits in the gunner sight
      for (let i = 0; i < Math.round(24 * dk); i++) {
        const a = az + rnd(-1.05, 1.05), d0 = rnd(1.5, 6), px = x + Math.sin(az) * 0 + Math.sin(a) * d0, pz = z + Math.cos(a) * d0;
        const sp = rnd(8, 16);
        this.smoke.ps.emit({
          x: px, y: this.terrain.getHeight(px, pz) + 0.3, z: pz, vx: Math.sin(a) * sp, vy: rnd(1, 3), vz: Math.cos(a) * sp,
          life: rnd(2, 3.5), size0: 1.0, size1: 5.5, alpha: 0.5 * dk, nearFade: true, r: 0.66, g: 0.59, b: 0.46, drag: 2.5, grav: -0.5, wind: 0.5, fadeIn: 0.05, fadeOut: 0.45, rotSpeed: rnd(-0.5, 0.5), tile: 1 + (i % 2),
        });
      }
      for (let i = 0; i < (optics ? 4 : 12); i++) {
        const a = az + rnd(-1.0, 1.0), d0 = rnd(1.5, 6), px = x + Math.sin(a) * d0, pz = z + Math.cos(a) * d0, sp = rnd(5, 9);
        this.smoke.ps.emit({
          x: px, y: this.terrain.getHeight(px, pz) + 0.3, z: pz, vx: Math.sin(a) * sp, vy: rnd(3, 6), vz: Math.cos(a) * sp,
          life: 0.8, size0: 0.3, size1: 0.5, alpha: 0.9, r: 0.2, g: 0.15, b: 0.1, drag: 0.5, grav: 9.81, tile: TILE.CLOD, fadeIn: 0, fadeOut: 0.5, rotSpeed: rnd(-6, 6),
        });
      }
    }
  }

  mg(pos, dir) {
    this.glow.emit({
      x: pos.x + dir.x * 0.5, y: pos.y + dir.y * 0.5, z: pos.z + dir.z * 0.5, life: 0.03, size0: 0.35, size1: 0.5,
      alpha: 1, r: 3.2, g: 2.4, b: 1.3, tile: TILE.STAR, fadeIn: 0, fadeOut: 0.8, ground: false,
    });
  }
}
