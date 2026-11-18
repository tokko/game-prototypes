// Bootstrap, world state, game phase flow and the main loop.
// game.phase: 'intro' -> 'battle' -> 'ended'. startBattle() is the single place the battle begins
// (a 'deployment' phase can be inserted between intro and startBattle).
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

const { renderer, scene, camera, updateSun } = createScene();
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

// ---- phase flow
const INTRO_LEN = 7;
rts.free = false;
game.skipIntro = () => { if (game.phase === 'intro') game.introT = INTRO_LEN; };
window.addEventListener('mousedown', () => game.skipIntro());
game.startBattle = () => {
  game.phase = 'battle'; rts.free = true;
  rts.set(0, 250, 0, 280);
  ui.banner('The battle begins', 3000);
};
function introUpdate(dt) {
  game.introT += dt;
  const k = Math.min(1, game.introT / INTRO_LEN), e = k * k * (3 - 2 * k);
  rts.set(-80 + 80 * e, -120 + 370 * e, 1.1 * (1 - e), 650 - 370 * e);
  if (k >= 1) game.startBattle();
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

game.step = step; // exposed for quick headless checks
let last = performance.now(), visTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
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
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
