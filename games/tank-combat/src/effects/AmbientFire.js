// Persistent fires and smoke columns at world.smokeAnchors (burning wrecks, burnt houses, the strongpoint).
// Wrecks with flame:true get flame sprites + embers + a tall black column drifting downwind (reference panel 2).
import { TILE } from './Particles.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class AmbientFire {
  constructor(world, smoke, glow) {
    this.anchors = world.smokeAnchors;
    this.smoke = smoke;
    this.glow = glow;
    this.acc = this.anchors.map(() => ({ flame: 0, smoke: 0, ember: 0 }));
  }

  update(dt, camera) {
    if (dt <= 0) return;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      const ac = this.acc[i] || (this.acc[i] = { flame: 0, smoke: 0, ember: 0 });
      const p = a.pos;
      const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      if (d > 2800) continue;
      const lod = d > 700 ? 0.6 : 1;
      const strength = (a.strength || 1) * lod;
      if (a.flame) {
        ac.flame += dt * 10 * lod;
        ac.dark = (ac.dark || 0) + dt * 3.5 * lod;
        while (ac.dark >= 1) {
          ac.dark -= 1;
          this.smoke.ps.emit({ x: p.x + rnd(-1, 1), y: p.y - 0.2, z: p.z + rnd(-1.4, 1.4), vx: rnd(-0.3, 0.3), vy: rnd(1.5, 3), vz: rnd(-0.3, 0.3), life: rnd(0.8, 1.3), size0: 1.6, size1: 0.8, alpha: 0.7, r: 0.35, g: 0.08, b: 0.02, tile: TILE.FIRE, drag: 1.2, grav: -2, fadeIn: 0.05, fadeOut: 0.5, ground: false });
        }
        while (ac.flame >= 1) {
          ac.flame -= 1;
          this.glow.emit({
            x: p.x + rnd(-1, 1), y: p.y + rnd(-0.3, 0.3), z: p.z + rnd(-1.4, 1.4), vx: rnd(-0.4, 0.4), vy: rnd(2.5, 4.5), vz: rnd(-0.4, 0.4),
            life: rnd(0.6, 1.0), size0: 2.2, size1: 0.8, alpha: 0.65, r: 1.5, g: rnd(0.5, 0.7), b: 0.12, tile: TILE.FIRE, drag: 1.2, grav: -3, fadeIn: 0.05, fadeOut: 0.35, rotSpeed: rnd(-1, 1),
          });
        }
        ac.ember += dt * 3 * lod;
        while (ac.ember >= 1) {
          ac.ember -= 1;
          this.glow.emit({ x: p.x + rnd(-1, 1), y: p.y, z: p.z + rnd(-1.4, 1.4), vx: rnd(-1.5, 1.5), vy: rnd(3, 6), vz: rnd(-1.5, 1.5), life: rnd(1.5, 2.5), size0: 0.08, size1: 0.05, alpha: 1, r: 2.6, g: 1.2, b: 0.4, tile: TILE.EMBER, grav: -1.5, drag: 0.8, fadeIn: 0, fadeOut: 0.5, wind: 1 });
        }
      }
      ac.smoke += dt * (a.flame ? 12 : 6 * strength) * lod;
      while (ac.smoke >= 1) {
        ac.smoke -= 1;
        const g = rnd(0.06, 0.12);
        this.smoke.ps.emit({
          x: p.x + rnd(-1, 1), y: p.y + 1.2 + rnd(0, 0.5), z: p.z + rnd(-1, 1), vx: rnd(-0.3, 0.3), vy: rnd(4, 6) * (a.flame ? 1 : 0.7), vz: rnd(-0.3, 0.3),
          life: rnd(14, 20), size0: 2.5, size1: (a.flame ? 15 : 10) * rnd(0.8, 1.1), alpha: a.flame ? 0.8 : 0.55, r: g * 1.1, g, b: g * 0.95,
          drag: 0.25, grav: -0.6, wind: 1.0, fadeIn: 0.006, fadeOut: 0.55, rotSpeed: rnd(-0.2, 0.2), tile: 1 + ((Math.random() * 2) | 0), ground: false,
        });
      }
    }
  }
}
