// Bootstrap, world state, game phase flow and the main loop.
// game.phase: 'intro' -> 'deployment' -> 'battle' -> 'ended'. startBattle() is the single place the battle begins
// (called by the Begin Battle button / Enter during deployment). No sim stepping happens before it.
import * as THREE from 'three';
import { createScene } from './scene.js';
import { createTerrain, VILLAGE } from './terrain.js';
import { RTSCamera } from './camera.js';
import { buildModels } from './models.js';
import { createArmies, UnitRenderer } from './units.js';
import { Effects } from './effects.js';
import { Combat } from './combat.js';
import { EnemyAI } from './ai.js';
import { Input } from './input.js';
import { UI } from './ui.js';

const { renderer, scene, camera, updateSun, render } = createScene();
const terrain = createTerrain(scene);

const world = {
  scene, terrain, regs: [], generals: [], selection: [], time: 0, paused: false, speed: 1,
  stats: { lost: { player: 0, enemy: 0 } }, messages: [], laters: [],
  objectives: { village: false, guns: false, rout: false }, villageHold: 0,
  later(delay, fn) { this.laters.push({ t: this.time + delay, fn }); },
  msg(text, side) { this.messages.push({ text, side }); },
};
const game = { phase: 'intro', introT: 0 };
window.game = game; window.world = world;

createArmies(world);
const models = buildModels();
const units = new UnitRenderer(scene, models, world);
const fx = new Effects(scene, world, models);
const combat = new Combat(world, fx);
const ai = new EnemyAI(world);
const rts = new RTSCamera(camera, terrain);
const input = new Input(renderer.domElement, camera, rts, world, game);
const ui = new UI(world, game, input, rts);
window.ui = ui; // exposed for quick headless checks (like game/world)

// ---- phase flow
const INTRO_LEN = 7;
rts.free = false;
game.skipIntro = () => { if (game.phase === 'intro') game.introT = INTRO_LEN; };
window.addEventListener('mousedown', () => game.skipIntro());
// Deployment zones (world XZ rectangles). The player's zone clamps repositioning; the enemy's is shown faintly.
const ZONE = { x0: -340, x1: 340, z0: 215, z1: 420 };
const ENEMY_ZONE = { x0: -340, x1: 340, z0: -265, z1: -30 };
let zoneGroup = null;
const DEPLOY_VIEW = { fz: 450, dist: 250 };   // default deployment/battle-start camera (frames the whole player line above the HUD)
// translucent rectangle draped over the terrain heights, plus a brighter edge strip
// fill alpha fades from fillOp at the zone edge down to 50% of it toward the centre (vertex alpha)
function makeZone(zn, color, fillOp, edgeColor, edgeOp) {
  const STEP = 8, LIFT = 0.8, T = 3.6, h = (x, z) => terrain.heightAt(x, z);
  const nx = Math.ceil((zn.x1 - zn.x0) / STEP), nz = Math.ceil((zn.z1 - zn.z0) / STEP), pos = [], idx = [], col = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = zn.x0 + (zn.x1 - zn.x0) * i / nx, z = zn.z0 + (zn.z1 - zn.z0) * j / nz;
    pos.push(x, h(x, z) + LIFT, z);
    const e = Math.max(0, 1 - Math.min(x - zn.x0, zn.x1 - x, z - zn.z0, zn.z1 - z) / 70);
    col.push(1, 1, 1, fillOp * (0.5 + 0.5 * e));
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const mk = (p, ix, op, color, order, offset, vc) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix);
    if (vc) g.setAttribute('color', new THREE.Float32BufferAttribute(vc, 4));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, vertexColors: !!vc, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }));
    m.frustumCulled = false; m.renderOrder = order; return m;
  };
  const ep = [], ei = [];
  const strip = (x0, z0, x1, z1, ix, iz) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4), base = ep.length / 3;
    for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
      ep.push(x, h(x, z) + LIFT + 0.2, z, x + ix * T, h(x + ix * T, z + iz * T) + LIFT + 0.2, z + iz * T);
      if (k < n) { const a = base + k * 2; ei.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  strip(zn.x0, zn.z0, zn.x1, zn.z0, 0, 1); strip(zn.x0, zn.z1, zn.x1, zn.z1, 0, -1);
  strip(zn.x0, zn.z0, zn.x0, zn.z1, 1, 0); strip(zn.x1, zn.z0, zn.x1, zn.z1, -1, 0);
  const grp = new THREE.Group(); grp.add(mk(pos, idx, 1, color, 3, -2, col), mk(ep, ei, edgeOp, edgeColor, 4, -3));
  return grp;
}
function clearZone() {
  if (!zoneGroup) return;
  scene.remove(zoneGroup);
  zoneGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  zoneGroup = null; game.zone = null;
}
game.startDeployment = () => {
  game.phase = 'deployment'; rts.free = true;
  rts.set(0, DEPLOY_VIEW.fz, 0, DEPLOY_VIEW.dist);
  zoneGroup = new THREE.Group();
  zoneGroup.add(makeZone(ZONE, 0xdcc890, 0.15, 0xffe080, 1), makeZone(ENEMY_ZONE, 0xb0c4f0, 0.06, 0x9ab4ff, 0.35));
  scene.add(zoneGroup); game.zone = ZONE;
  ui.banner('', 0);
};
game.startBattle = () => {
  if (game.phase === 'battle' || game.phase === 'ended') return;
  if (game.phase !== 'deployment') rts.set(0, DEPLOY_VIEW.fz, 0, DEPLOY_VIEW.dist); // keep the player's own camera when coming from deployment
  clearZone();
  game.phase = 'battle'; rts.free = true;
  ui.banner('The battle begins', 3000);
};
function introUpdate(dt) {
  game.introT += dt;
  const k = Math.min(1, game.introT / INTRO_LEN), e = k * k * (3 - 2 * k);
  rts.set(-80 + 80 * e, -120 + (DEPLOY_VIEW.fz + 120) * e, 1.1 * (1 - e), 600 + (DEPLOY_VIEW.dist - 600) * e);
  if (k >= 1) game.startDeployment();
}

// ---- simulation
function checkObjectives(dt) {
  let p = 0, e = 0;
  for (const r of world.regs) {
    if (!r.active || Math.hypot(r.x - VILLAGE.x, r.z - VILLAGE.z) > VILLAGE.r) continue;
    if (r.side === 'player') p++; else e++;
  }
  if (p > 0 && e === 0) world.villageHold += dt; else if (e > 0) world.villageHold = 0;
  const o = world.objectives;
  o.village = world.villageHold >= 15;
  o.guns = world.regs.filter(r => r.side === 'enemy' && r.typeId === 'artillery').every(r => !r.active);
  const act = (s) => world.regs.filter(r => r.side === s && r.active).length;
  o.rout = act('enemy') === 0;
  if (world.time < 5) return;
  if (o.rout || world.villageHold >= 75) endBattle(true, o.rout ? 'The enemy army is broken.' : 'You hold the village.');
  else if (act('player') === 0) endBattle(false, 'Your army has been routed.');
}
function endBattle(victory, why) {
  if (game.phase !== 'battle') return;
  game.phase = 'ended';
  const lp = world.stats.lost.player, le = world.stats.lost.enemy;
  ui.showEnd(victory, `${why}<br>Time ${Math.floor(world.time / 60)}m ${Math.floor(world.time % 60)}s<br>Your losses: ${lp} &nbsp; Enemy losses: ${le}`);
}
function step(dt) {
  world.time += dt;
  if (world.laters.length) {
    const due = world.laters.filter(l => l.t <= world.time);
    if (due.length) { world.laters = world.laters.filter(l => l.t > world.time); for (const l of due) l.fn(); }
  }
  ai.update(dt);
  for (const r of world.regs) r.update(dt, world);
  combat.update(dt);
  for (const g of world.generals) g.update(dt, world);
  checkObjectives(dt);
  world.selection = world.selection.filter(r => r.state !== 'gone' || (r.selected = false));
}

// exposed for quick headless checks; also advances soldier figures (normally done per frame) so footprint rings stay on the units
game.step = (dt) => { step(dt); for (const r of world.regs) r.updateSoldiers(dt, visTime); };
let last = performance.now(), visTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  visTime += dt;
  if (game.phase === 'intro') introUpdate(dt);
  input.update(dt);
  let sdt = 0;
  if (game.phase === 'battle' && !world.paused) {
    sdt = dt * world.speed;
    const n = Math.max(1, Math.ceil(sdt / 0.05));
    for (let i = 0; i < n; i++) step(sdt / n);
  }
  for (const r of world.regs) r.updateSoldiers(sdt, visTime);
  fx.update(sdt);
  units.update(visTime, camera, rts.s.dist);
  updateSun(rts.s.fx, terrain.heightAt(rts.s.fx, rts.s.fz), rts.s.fz, rts.s.dist);
  ui.update(dt);
  render();
}
requestAnimationFrame(frame);
