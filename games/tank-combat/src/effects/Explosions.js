// Explosions (HEAT / HE), kinetic and MG impacts, dirt-clod debris and scorch decals (all pooled).
// Fireballs are many small orange-to-red flame sprites in dark smoke, not a solid white blob; HE leaves a plume.
import {
  InstancedMesh, IcosahedronGeometry, MeshStandardMaterial, InstancedBufferAttribute, DynamicDrawUsage,
  Matrix4, Quaternion, Euler, Vector3, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace,
} from 'three';
import { ParticleSystem, TILE } from './Particles.js';
import { Simplex2 } from '../util/noise.js';
import { patchMaterial } from '../environment/Atmosphere.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const DEBRIS_MAX = 128;
const DECAL_MAX = 28;

export function makeScorchTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n = new Simplex2(321);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const r = Math.sqrt(u * u + v * v);
      const f = 0.5 + 0.5 * n.fbm(u * 3, v * 3, 3);
      let a = Math.max(0, 1 - r * (0.85 + 0.45 * f));
      a = Math.pow(a, 0.6) * (0.65 + 0.35 * f);
      const k = (y * S + x) * 4;
      img.data[k] = 16; img.data[k + 1] = 13; img.data[k + 2] = 10;
      img.data[k + 3] = Math.min(1, a) * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class ExplosionSystem {
  constructor(scene, world, smoke, lights) {
    this.world = world;
    this.terrain = world.terrain;
    this.smoke = smoke;
    this.lights = lights;
    this.glow = new ParticleSystem(scene, { max: 2500, additive: true, renderOrder: 11, terrain: world.terrain });
    smoke.glow = this.glow;

    // ---- debris: irregular dirt clods ----
    const clod = new IcosahedronGeometry(1, 0);
    const cp = clod.attributes.position;
    for (let i = 0; i < cp.count; i++) { const k = 0.75 + 0.5 * Math.abs(Math.sin(i * 12.9898 + cp.getX(i) * 4)); cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * k * 0.8, cp.getZ(i) * k); }
    clod.computeVertexNormals();
    const dmat = patchMaterial(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
    this.dMesh = new InstancedMesh(clod, dmat, DEBRIS_MAX);
    this.dMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.dMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(DEBRIS_MAX * 3), 3).setUsage(DynamicDrawUsage);
    this.dMesh.frustumCulled = false;
    this.dMesh.count = 0;
    scene.add(this.dMesh);
    this.d = [];
    for (let i = 0; i < DEBRIS_MAX; i++) {
      this.d.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, life: 0, max: 0, s: 0, r: 0, g: 0, b: 0, rest: false });
    }
    this.dn = 0;

    // ---- decals ----
    const mat = new MeshBasicMaterial({
      map: makeScorchTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.decals = [];
    for (let i = 0; i < DECAL_MAX; i++) {
      const g = new PlaneGeometry(1, 1, 6, 6);
      g.rotateX(-Math.PI / 2);
      const m = new Mesh(g, mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 2;
      scene.add(m);
      this.decals.push(m);
    }
    this.decalIdx = 0;

    this._m = new Matrix4(); this._q = new Quaternion(); this._e = new Euler();
    this._p = new Vector3(); this._s = new Vector3();
  }

  _spawnDebris(x, y, z, vx, vy, vz, size, kind) {
    if (this.dn >= DEBRIS_MAX) return;
    const p = this.d[this.dn++];
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.rx = rnd(0, 6); p.ry = rnd(0, 6); p.rz = rnd(0, 6);
    p.wx = rnd(-8, 8); p.wy = rnd(-8, 8); p.wz = rnd(-8, 8);
    p.life = 0; p.max = rnd(3.5, 6); p.s = size; p.rest = false;
    const k = rnd(0.8, 1.2);
    // linear colours: dirt / stone / metal
    const c = kind === 'metal' ? [0.04, 0.04, 0.035] : kind === 'stone' ? [0.14, 0.135, 0.12] : [0.07, 0.052, 0.034];
    p.r = c[0] * k; p.g = c[1] * k; p.b = c[2] * k;
  }

  _scorch(x, z, size) {
    const m = this.decals[this.decalIdx++ % DECAL_MAX];
    const pos = m.geometry.attributes.position;
    let k = 0;
    for (let iy = 0; iy <= 6; iy++) {
      for (let ix = 0; ix <= 6; ix++) {
        const px = x + (ix / 6 - 0.5) * size, pz = z + (iy / 6 - 0.5) * size;
        pos.setXYZ(k++, px, this.terrain.getHeight(px, pz) + 0.07, pz);
      }
    }
    pos.needsUpdate = true;
    m.geometry.computeBoundingSphere();
    m.visible = true;
  }

  _flames(x, y, z, n, size0, size1, life, spread, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = rnd(0.4, 1) * spread, hot = Math.random();
      this.glow.emit({
        x: x + Math.cos(a) * rnd(0, 0.6), y: y + rnd(0.1, 0.6), z: z + Math.sin(a) * rnd(0, 0.6),
        vx: Math.cos(a) * s, vy: rnd(0.3, 1) * up, vz: Math.sin(a) * s,
        life: rnd(life * 0.7, life * 1.2), size0: size0 * rnd(0.7, 1.1), size1: size1 * rnd(0.8, 1.2), alpha: 0.75,
        r: hot > 0.5 ? 1.8 : 1.5, g: hot > 0.5 ? 1.0 : 0.5, b: hot > 0.5 ? 0.28 : 0.12,
        tile: TILE.FIRE, drag: 6, grav: -2, fadeIn: 0.0, fadeOut: 0.5, rotSpeed: rnd(-1.5, 1.5),
      });
    }
  }

  // kind: 'HEAT' | 'HE'. R scales the visuals slightly with the splash radius.
  explosion(x, y, z, nx, ny, nz, kind, onTerrain = true) {
    const he = kind === 'HE';
    const k = he ? 1.0 : 0.62;
    // one short white core flash plus the rising orange/red fireball
    this.glow.emit({ x, y: y + 0.4, z, life: 0.04, size0: (4 * k + 1) * 0.7, size1: (6 * k + 1.5) * 0.7, alpha: 1, r: 3.0, g: 2.4, b: 1.6, tile: TILE.STAR, fadeIn: 0, fadeOut: 0.8 });
    this._flames(x, y, z, he ? 20 : 14, he ? 1.5 : 1.0, he ? 5.5 : 3.6, he ? 0.42 : 0.34, he ? 9 : 7, he ? 7 : 5);
    // sparks (small ember sprites; fast, gravity)
    const ns = he ? 36 : 28;
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * 6.283, e = rnd(0.25, 1.4), s = rnd(14, 46);
      this.glow.emit({
        x, y: y + 0.4, z,
        vx: Math.cos(a) * Math.cos(e) * s * 0.7 + nx * 6, vy: Math.sin(e) * s + ny * 6, vz: Math.sin(a) * Math.cos(e) * s * 0.7 + nz * 6,
        life: rnd(0.3, 0.9), size0: rnd(0.12, 0.22), size1: 0.04, alpha: 1, r: 2.6, g: rnd(1.0, 1.7), b: 0.4, tile: TILE.EMBER,
        grav: 12, drag: 0.8, fadeIn: 0, fadeOut: 0.5,
      });
    }
    // dark smoke + persistent plume
    this.smoke.black(x, y, z, he ? 20 : 16, he ? 2.8 : 1.8, he ? 6 : 4, he ? 7 : 5, 0.8);
    if (he) this.smoke.plume(x, y + 0.5, z, { dur: 2, count: 30, life: 26, size1: 13, up: 4 });
    else this.smoke.plume(x, y + 0.5, z, { dur: 1.5, count: 14, life: 14, size1: 8, up: 3 });
    if (onTerrain) {
      this.smoke.dust(x, y + 0.3, z, he ? 20 : 14, he ? 3.4 : 2.2, he ? 7 : 5, he ? 5 : 3.5, 2, 0.6, [0.63, 0.56, 0.44]);
      // ground ring
      for (let i = 0; i < (he ? 20 : 16); i++) {
        const a = (i / (he ? 20 : 16)) * 6.283 + Math.random() * 0.2, s = rnd(he ? 14 : 12, he ? 22 : 18);
        this.smoke.ps.emit({ x: x + Math.cos(a) * 0.5, y: y + 0.4, z: z + Math.sin(a) * 0.5, vx: Math.cos(a) * s, vy: 0.3, vz: Math.sin(a) * s, life: 1.5, size0: 0.6, size1: 3.0, alpha: 0.45, r: 0.63, g: 0.56, b: 0.44, drag: 4, fadeIn: 0.02, fadeOut: 0.5, tile: TILE.PUFF, ground: false });
      }
      // dirt fountain: clods + a brown column (HE)
      const nc = he ? 50 : 20;
      for (let i = 0; i < nc; i++) {
        const a = Math.random() * 6.283, cone = rnd(0, he ? 0.45 : 0.75), s = rnd(he ? 10 : 8, he ? 28 : 18);
        this.smoke.ps.emit({
          x, y: y + 0.3, z, vx: Math.cos(a) * Math.sin(cone) * s, vy: Math.cos(cone) * s, vz: Math.sin(a) * Math.sin(cone) * s,
          life: rnd(0.8, he ? 2.0 : 1.4), size0: rnd(0.2, 0.5), size1: rnd(0.25, 0.55), alpha: 0.9, r: 0.2, g: 0.15, b: 0.1, drag: 0.4, grav: 9.81, tile: TILE.CLOD, fadeIn: 0, fadeOut: 0.3, rotSpeed: rnd(-6, 6),
        });
      }
      if (he) {
        for (let i = 0; i < 14; i++) {
          this.smoke.ps.emit({
            x: x + rnd(-1, 1), y: y + 0.5, z: z + rnd(-1, 1), vx: rnd(-2, 2), vy: rnd(10, 18), vz: rnd(-2, 2), life: rnd(3, 5), size0: 1.0, size1: 5.0, alpha: 0.85,
            r: 0.2, g: 0.16, b: 0.12, drag: 3, grav: 1, wind: 0.6, fadeIn: 0.05, fadeOut: 0.5, tile: 1 + (i % 2), rotSpeed: rnd(-0.4, 0.4),
          });
        }
      }
      this._scorch(x, z, he ? 7.5 : 4.5);
    } else {
      this.smoke.dust(x, y, z, 8, 2.2, 5, 2.5, 1, 0.5, [0.6, 0.57, 0.52]);
    }
    const nd = he ? 14 : 8;
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * 6.283, s = rnd(5, 12);
      this._spawnDebris(x, y + 0.5, z, Math.cos(a) * s + nx * 3, rnd(6, 14), Math.sin(a) * s + nz * 3, rnd(0.08, 0.3), onTerrain ? 'dirt' : (Math.random() < 0.5 ? 'metal' : 'stone'));
    }
    this.lights.flash(x, y + 2.5, z, he ? 15000 : 8000, he ? 0.3 : 0.25, 0xffa050, he ? 120 : 90);
  }

  // Kinetic penetrator / solid shot impact. onTerrain: dirt, otherwise hard surface
  kineticImpact(x, y, z, nx, ny, nz, onTerrain) {
    if (onTerrain) {
      this.smoke.dust(x, y + 0.2, z, 8, 2.6, 4, 2.6, 4, 0.6, [0.63, 0.56, 0.44]);
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * 6.283, s = rnd(6, 18);
        this.smoke.ps.emit({ x, y: y + 0.2, z, vx: nx * 5 + Math.cos(a) * s * 0.4, vy: rnd(4, 14), vz: nz * 5 + Math.sin(a) * s * 0.4, life: rnd(0.6, 1.2), size0: 0.25, size1: 0.35, alpha: 0.9, r: 0.2, g: 0.15, b: 0.1, drag: 0.4, grav: 9.81, tile: TILE.CLOD, fadeIn: 0, fadeOut: 0.3, rotSpeed: rnd(-6, 6) });
      }
      for (let i = 0; i < 4; i++) this._spawnDebris(x, y + 0.2, z, nx * 6 + rnd(-4, 4), rnd(5, 13), nz * 6 + rnd(-4, 4), rnd(0.08, 0.2), 'dirt');
      this._scorch(x, z, 2.2);
    } else {
      this.smoke.dust(x, y, z, 5, 1.2, 2, 1.4, 1, 0.4, [0.6, 0.57, 0.52]);
    }
    for (let i = 0; i < (onTerrain ? 14 : 36); i++) {
      const s = rnd(14, 44);
      this.glow.emit({
        x, y, z, vx: nx * s * 0.6 + rnd(-14, 14), vy: ny * s * 0.6 + rnd(2, 14), vz: nz * s * 0.6 + rnd(-14, 14),
        life: rnd(0.25, 0.7), size0: rnd(0.08, 0.15), size1: 0.03, alpha: 1, r: 2.8, g: rnd(1.3, 2.2), b: 0.7, tile: TILE.EMBER,
        grav: 12, drag: 1.2, fadeIn: 0, fadeOut: 0.5, ground: false,
      });
    }
    this.glow.emit({ x, y: y + 0.1, z, life: 0.05, size0: 1.8, size1: 2.4, alpha: 1, r: 3.4, g: 3.0, b: 2.5, tile: TILE.STAR, fadeIn: 0, fadeOut: 0.8 });
    this.lights.flash(x, y + 1, z, 1500, 0.1, 0xffc080, 30);
  }

  // machine-gun hit
  bulletImpact(x, y, z, nx, ny, nz, onTerrain) {
    if (onTerrain) this.smoke.dust(x, y + 0.1, z, 2, 0.7, 1.4, 1.0, 2, 0.4, [0.62, 0.55, 0.43]);
    for (let i = 0; i < 3; i++) {
      this.glow.emit({
        x, y, z, vx: nx * 6 + rnd(-3, 3), vy: ny * 6 + rnd(1, 4), vz: nz * 6 + rnd(-3, 3),
        life: rnd(0.15, 0.3), size0: 0.1, size1: 0.04, alpha: 0.9, r: 2.2, g: 1.4, b: 0.5, tile: TILE.EMBER, grav: 12, fadeIn: 0, fadeOut: 0.5, ground: false,
      });
    }
  }

  update(dt) {
    this.glow.update(dt);
    const T = this.terrain;
    let i = 0;
    while (i < this.dn) {
      const p = this.d[i];
      p.life += dt;
      if (p.life >= p.max) { const last = this.d[this.dn - 1]; this.d[i] = last; this.d[this.dn - 1] = p; this.dn--; continue; }
      if (!p.rest) {
        p.vy -= 24 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
        const gh = T.getHeight(p.x, p.z) + p.s * 0.4;
        if (p.y < gh) {
          p.y = gh;
          if (p.vy < -2.5) { p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; p.wx *= 0.6; p.wy *= 0.6; p.wz *= 0.6; }
          else { p.rest = true; p.vx = p.vy = p.vz = 0; }
        }
      }
      i++;
    }
    for (let k = 0; k < this.dn; k++) {
      const p = this.d[k];
      const fade = Math.min(1, (p.max - p.life) / 0.8);
      const sc = p.s * fade;
      this._q.setFromEuler(this._e.set(p.rx, p.ry, p.rz));
      this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(sc, sc, sc));
      this.dMesh.setMatrixAt(k, this._m);
      const a = this.dMesh.instanceColor.array;
      a[k * 3] = p.r; a[k * 3 + 1] = p.g; a[k * 3 + 2] = p.b;
    }
    this.dMesh.count = this.dn;
    this.dMesh.instanceMatrix.needsUpdate = true;
    this.dMesh.instanceColor.needsUpdate = true;
  }
}
