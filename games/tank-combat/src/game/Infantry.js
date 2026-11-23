// Cheap friendly infantry: low-detail procedural soldiers (about 8 boxes each). They crouch behind cover until the
// strongpoint falls, then run along a path toward the village. Non-combatant props.
import { Group, Mesh, BoxGeometry, SphereGeometry, MeshStandardMaterial, Color } from 'three';
import { patchMaterial } from '../environment/Atmosphere.js';
import { wrapPi } from '../util/math.js';

const lin = (hex) => `#${hex}`;
void lin;

function mat(hex, rough = 0.9) { return patchMaterial(new MeshStandardMaterial({ color: new Color(hex), roughness: rough, metalness: 0 })); }

const SHARED_BY = {};
function shared(enemy = false) {
  const key = enemy ? 'e' : 'f';
  if (SHARED_BY[key]) return SHARED_BY[key];
  const SHARED = SHARED_BY[key] = {
    uniform: mat(enemy ? '#5b564a' : '#5a5f40'), skin: mat('#9a7458'), helmet: mat(enemy ? '#2f3837' : '#3f4630'), gear: mat(enemy ? '#3f3f38' : '#4d4a36'), web: mat(enemy ? '#4d4a40' : '#6b6248'), rifle: mat('#262626', 0.6),
    torso: new BoxGeometry(0.4, 0.52, 0.24), head: new SphereGeometry(0.11, 8, 6), helm: new SphereGeometry(0.135, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    leg: new BoxGeometry(0.15, 0.55, 0.17), arm: new BoxGeometry(0.11, 0.42, 0.12), pack: new BoxGeometry(0.34, 0.4, 0.16), belt: new BoxGeometry(0.43, 0.1, 0.27), rifleG: new BoxGeometry(0.06, 0.07, 0.95),
  };
  return SHARED;
}

export class Soldier {
  constructor(scene, terrain, x, z, faceYaw, path, delay, enemy = false) {
    const S = shared(enemy);
    this.terrain = terrain;
    this.x = x; this.z = z; this.yaw = faceYaw;
    this.path = path; this.pi = 0; this.state = 'cover'; this.delay = delay; this.t = Math.random() * 6;
    const g = this.root = new Group();
    const add = (geo, m, x2, y, z2, parent = g) => { const o = new Mesh(geo, m); o.position.set(x2, y, z2); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
    this.body = new Group(); g.add(this.body);
    add(S.torso, S.uniform, 0, 1.0, 0, this.body);
    add(S.head, S.skin, 0, 1.4, 0.02, this.body);
    add(S.helm, S.helmet, 0, 1.42, 0.02, this.body);
    add(S.pack, S.gear, 0, 1.02, -0.2, this.body);
    add(S.belt, S.web, 0, 0.78, 0, this.body);
    g.scale.setScalar(1.05);
    this.legL = new Group(); this.legR = new Group();
    for (const [lg, sx] of [[this.legL, 0.1], [this.legR, -0.1]]) { lg.position.set(sx, 0.74, 0); add(S.leg, S.uniform, 0, -0.27, 0, lg); g.add(lg); }
    this.armL = new Group(); this.armR = new Group();
    for (const [ar, sx] of [[this.armL, 0.26], [this.armR, -0.26]]) { ar.position.set(sx, 1.2, 0); add(S.arm, S.uniform, 0, -0.18, 0.05, ar); this.body.add(ar); }
    add(S.rifleG, S.rifle, 0.04, 1.02, 0.35, this.body);
    scene.add(g);
    this.place();
  }

  place() {
    this.root.position.set(this.x, this.terrain.getHeight(this.x, this.z), this.z);
    this.root.rotation.y = this.yaw;
  }

  go() { if (this.state === 'cover') { this.state = 'wait'; } }

  update(dt, time) {
    this.t += dt;
    if (this.state === 'wait') { this.delay -= dt; if (this.delay <= 0) this.state = 'run'; }
    if (this.state === 'run') {
      const w = this.path[this.pi];
      const dx = w[0] - this.x, dz = w[1] - this.z, d = Math.hypot(dx, dz);
      if (d < 1.2) { this.pi++; if (this.pi >= this.path.length) { this.state = 'done'; } }
      else {
        const ty = Math.atan2(dx, dz);
        this.yaw += wrapPi(ty - this.yaw) * Math.min(1, dt * 8);
        const sp = 4.6 * dt;
        this.x += (dx / d) * sp; this.z += (dz / d) * sp;
      }
    }
    const running = this.state === 'run';
    const crouch = this.state === 'cover' || this.state === 'wait';
    this.body.position.y = crouch ? -0.28 + Math.sin(this.t * 1.7) * 0.01 : running ? Math.abs(Math.sin(this.t * 11)) * 0.06 : 0;
    this.body.rotation.x = crouch ? 0.35 : running ? 0.18 : 0;
    const sw = running ? Math.sin(this.t * 11) * 0.9 : 0;
    this.legL.rotation.x = crouch ? -1.0 : sw; this.legR.rotation.x = crouch ? -1.0 : -sw;
    this.armL.rotation.x = running ? -sw * 0.6 - 0.9 : -1.1; this.armR.rotation.x = running ? sw * 0.6 - 0.9 : -1.2;
    this.place();
  }
}

export class InfantrySquad {
  constructor(scene, terrain, spots, path) {
    this.soldiers = spots.map(([x, z, yaw], i) => new Soldier(scene, terrain, x, z, yaw, path.map(([px, pz]) => [px + (i % 3 - 1) * 2.2, pz + Math.floor(i / 3) * 3]), i * 0.45 + Math.random()));
    this.advancing = false;
  }

  setVisible(v) { for (const s of this.soldiers) s.root.visible = v; }

  advance() { this.advancing = true; for (const s of this.soldiers) s.go(); }

  update(dt, time) { for (const s of this.soldiers) s.update(dt, time); }

  get positions() { return this.soldiers.map((s) => ({ x: s.x, z: s.z })); }
}
