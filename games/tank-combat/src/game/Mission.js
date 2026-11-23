// Mission "Advance to the village": ordered objectives with triggers, an optional objective, HUD/minimap/3D marker
// feedback, infantry advance and the mission-complete flow. Drives itself from Game.update().
import { Vector3, Mesh, CylinderGeometry, ShaderMaterial, AdditiveBlending, DoubleSide } from 'three';
import { clamp } from '../util/math.js';

const TITLE = 'Advance to the village';
const OPT_TEXT = 'Optional: Destroy the remaining enemy vehicles';

export class Mission {
  constructor(game) {
    this.g = game;
    const t = game.terrain, lm = game.world.landmarks;
    const road = t.roadPoints.find((p) => p.z <= 130) || t.roadPoints[Math.floor(t.roadPoints.length / 3)];
    this.zones = {
      road: { x: road.x, z: road.z, r: 28 },
      hill: { x: t.hill.x, z: t.hill.z, r: 24 },
      village: { x: -57, z: -492, r: 32 },
      extract: { x: 30, z: -662, r: 20 },
    };
    this.objectives = [
      { id: 'road', text: 'Drive along the country road', type: 'zone', zone: 'road' },
      { id: 'hill', text: 'Reach the observation position', type: 'zone', zone: 'hill' },
      { id: 'identify', text: 'Identify the enemy tank', type: 'identify', enemy: 'tank1' },
      { id: 'destroy', text: 'Engage and destroy the enemy tank', type: 'destroy', enemy: 'tank1' },
      { id: 'village', text: 'Advance towards the village', type: 'zone', zone: 'village' },
      { id: 'strong', text: 'Support the infantry: destroy the enemy strongpoint', type: 'strongpoint' },
      { id: 'extract', text: 'Reach the extraction area', type: 'zone', zone: 'extract' },
    ];
    this.index = 0;
    this.done = false;
    this.transition = null;
    this.identT = 0;
    this.completed = 0;
    this.optional = { text: OPT_TEXT, active: false, done: false, total: game.enemies.tanks.length - 1, killed: 0, isNew: false };
    this.routeT = 0;
    this.objPos = new Vector3();
    this.strongpoint = lm.strongpoint;
    this.log = []; // for headless sanity checks

    // 3D beam over the current zone objective: soft gradient (fades out by ~60 m), soft edges, hidden in optics / up close
    const beam = new Mesh(new CylinderGeometry(0.8, 0.8, 90, 12, 1, true), new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
      vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV;
        void main() { vH = (position.y + 45.0) / 90.0; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vH; varying vec3 vN; varying vec3 vV;
        void main() { float a = 0.25 * (1.0 - smoothstep(0.0, 0.67, vH)) * pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
          gl_FragColor = vec4(vec3(0.25, 0.55, 1.0) * 1.3, a); }`,
    }));
    beam.visible = false; beam.frustumCulled = false; beam.renderOrder = 6;
    game.scene.add(beam);
    this.beam = beam;
    this.beamWanted = false;
  }

  get current() { return this.objectives[this.index]; }

  start(first = true) {
    this._show(first, first);
    if (first) this.g.fx.notify('NEW OBJECTIVE', this.current.text);
    this._place();
    this.log.push('start:' + this.current.id);
  }

  _hudModel(doneFlag) {
    const o = this.current;
    const op = this.optional;
    const progress = op.active && !op.done ? ` (${op.killed}/${op.total})` : '';
    return {
      title: TITLE,
      primary: { text: o.text, done: !!doneFlag },
      optional: op.active ? [{ text: op.text + progress, done: op.done, isNew: op.isNew }] : [],
    };
  }

  _show(isNew, ignored, doneFlag = false) { void ignored; this.g.hud.setMission(this._hudModel(doneFlag), { isNew, newOptional: this.optional.isNew }); this.optional.isNew = false; }

  // target position for markers / beam / route of the current objective
  _place() {
    const o = this.current, g = this.g;
    if (o.type === 'zone') {
      const z = this.zones[o.zone];
      this.objPos.set(z.x, g.terrain.getHeight(z.x, z.z), z.z);
      this.beam.position.set(z.x, this.objPos.y + 40, z.z); this.beamWanted = true; this.beam.scale.set(1, 1, 1);
    } else if (o.type === 'strongpoint') {
      const s = this.strongpoint;
      this.objPos.set(s.x, s.y, s.z);
      this.beam.position.set(s.x, s.y + 40, s.z); this.beamWanted = true; this.beam.scale.set(1.6, 1, 1.6);
    } else {
      const e = g.enemies.get(o.enemy);
      this.objPos.set(e.ctrl.x, e.ctrl.y, e.ctrl.z);
      this.beamWanted = false;
    }
  }

  // ---- progress ----
  _complete() {
    const o = this.current;
    this.completed++;
    this.log.push('done:' + o.id);
    this.g.fx.notify('OBJECTIVE COMPLETE', o.text, 'complete');
    this._show(false, false, true);
    this.beamWanted = false;
    this.transition = { t: 2.0 };
    if (o.id === 'strong') this.g.squad.advance();
    if (this.index >= this.objectives.length - 1) { this.done = true; this.g.win(); }
  }

  _next() {
    this.index++;
    this.transition = null;
    const o = this.current;
    if (o.id === 'village') { // optional objective + infantry appear as the village comes into view
      this.optional.active = true; this.optional.isNew = true;
      this.g.squad.setVisible(true);
    }
    this._show(true, true);
    this.g.fx.notify('NEW OBJECTIVE', o.text);
    this._place();
    this.identT = 0;
    this.log.push('start:' + o.id);
  }

  // jump straight to objective n (1-based) for testing; earlier objectives count as done
  skipTo(n) {
    n = clamp(n, 1, this.objectives.length);
    const g = this.g;
    if (n >= 5) { const e = g.enemies.get('tank1'); if (e.alive) { e.hp = 1; e.takeDamage(999, { def: { id: 'HEAT' }, part: 'splash' }); } }
    if (n >= 5) { this.optional.active = true; g.squad.setVisible(true); }
    if (n >= 7) { g.world.damageTarget('strongpoint', 1e6); g.squad.advance(); }
    this.index = n - 1;
    this.completed = n - 1;
    this.transition = null;
    this._show(false, false);
    this._place();
    this.log.push('skip:' + n);
  }

  update(dt) {
    const g = this.g;
    if (this.done) return;
    // optional objective: remaining village tanks
    const op = this.optional;
    if (op.active && !op.done) {
      const list = g.enemies.tanks.filter((t) => t.id !== 'tank1'); // every other tank and IFV
      op.total = list.length;
      const killed = list.filter((t) => !t.alive).length;
      if (killed !== op.killed) { op.killed = killed; this._show(false, false, this.transition != null); }
      if (killed >= op.total) {
        op.done = true;
        g.fx.notify('OPTIONAL OBJECTIVE COMPLETE', 'Destroy the remaining enemy vehicles', 'complete');
        this._show(false, false, this.transition != null);
        this.log.push('done:optional');
      }
    }
    if (!this.beamWanted) this.beam.visible = false;
    if (this.transition) { this.transition.t -= dt; if (this.transition.t <= 0) this._next(); return; }

    const o = this.current, P = g.tank;
    this._place();
    this.beam.visible = this.beamWanted && g.optics.amount < 0.5 && Math.hypot(g.camera.position.x - this.beam.position.x, g.camera.position.z - this.beam.position.z) > 60;
    if (o.type === 'zone') {
      const z = this.zones[o.zone];
      if (Math.hypot(P.x - z.x, P.z - z.z) < z.r) this._complete();
    } else if (o.type === 'identify') {
      const e = g.enemies.get(o.enemy);
      if (!e.alive) { this._complete(); return; }
      if (this._seenInSight(e, dt)) {
        e.identified = true; e.spotted = true;
        g.hud.toast('TARGET IDENTIFIED', 2.5);
        this._complete();
      }
    } else if (o.type === 'destroy') {
      const e = g.enemies.get(o.enemy);
      e.spotted = true; e.identified = true;
      if (!e.alive) this._complete();
    } else if (o.type === 'strongpoint') {
      const t = g.world.targets.get('strongpoint');
      if (!t.alive) this._complete();
    }
  }

  // enemy held near the optics centre at useful magnification, in line of sight, for about a second
  _seenInSight(e, dt) {
    const g = this.g, cam = g.camera, op = g.optics;
    const tx = e.ctrl.x, ty = e.ctrl.y + 1.6, tz = e.ctrl.z;
    const dx = tx - cam.position.x, dy = ty - cam.position.y, dz = tz - cam.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const d = g._dir; // aim direction
    const cosA = (dx * d.x + dy * d.y + dz * d.z) / dist;
    const ang = Math.acos(clamp(cosA, -1, 1));
    const tol = 0.22 * ((cam.fov * Math.PI) / 360);
    let ok = op.amount > 0.9 && op.mag >= 4 && dist < 1600 && ang < tol;
    if (ok) {
      const hit = g._hit;
      const blocked = g.world.raycastSegment(cam.position.x, cam.position.y, cam.position.z, tx, ty, tz, g.tank, hit);
      ok = !blocked || (hit.collider && hit.collider.owner === e.ctrl);
      if (ok && g.smoke.isBlocked(cam.position.x, cam.position.y, cam.position.z, tx, ty, tz)) ok = false;
    }
    this.identT = clamp(this.identT + (ok ? dt : -dt * 0.5), 0, 1.2);
    return this.identT >= 1.0;
  }

  // markers for the HUD layer / minimap
  hudMarker() {
    const o = this.current;
    if (this.done || this.transition) return null;
    if (o.type === 'destroy') return null; // the red enemy marker does the job
    const p = this.objPos;
    return { id: 'objective', type: 'obj', x: p.x, y: p.y + (o.type === 'identify' ? 4 : 10), z: p.z, label: o.type === 'identify' ? 'Target area' : '' };
  }

  routePoints() {
    if (this.done || this.transition) return null;
    const g = this.g, P = g.tank, tgt = this.objPos;
    const road = g.terrain.roadPoints;
    const near = (x, z) => { let bi = 0, bd = 1e12; for (let i = 0; i < road.length; i += 2) { const d = (road[i].x - x) ** 2 + (road[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return { i: bi, d: Math.sqrt(bd) }; };
    const a = near(P.x, P.z), b = near(tgt.x, tgt.z);
    const pts = [{ x: P.x, z: P.z }];
    if (a.d < 60 && b.d < 90 && Math.abs(a.i - b.i) > 4) {
      const step = a.i < b.i ? 1 : -1;
      for (let i = a.i; step > 0 ? i <= b.i : i >= b.i; i += step * 4) pts.push({ x: road[i].x, z: road[i].z });
    }
    pts.push({ x: tgt.x, z: tgt.z });
    return pts;
  }

  stats() {
    const g = this.g, sec = Math.max(0, Math.round(g.time - g.startTime));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
    return { time: `${mm}:${ss}`, shots: g.stats.shots, hits: g.stats.hits, kills: g.stats.kills, objectives: `${this.completed}/${this.objectives.length}` };
  }
}
