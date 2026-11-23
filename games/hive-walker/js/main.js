import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { rnd, rr, clamp, damp, angDiff, PAL } from './util.js?v=32';
import { Sfx } from './audio.js?v=32';
import { Fx } from './fx.js?v=32';
import { City } from './city.js?v=32';
import { Units } from './units.js?v=32';
import { Player, CLASS } from './player.js?v=32';
import { Scouts } from './scouts.js?v=32';
import { Streets } from './streets.js?v=32';
import { Colossus, COL_HP, COL_SHIELD } from './colossus.js?v=32';
import { Hierarch, HIER_HP, HIER_SHIELD } from './hierarch.js?v=32';
import { Harrow, HARROW_HP, HARROW_SHIELD } from './harrow.js?v=32';
import { Air } from './air.js?v=32';
import { setupShot } from './shots.js?v=32';
import { Auspex } from './auspex.js?v=32';
import { dollSVG, locate, facingOf, wardFrac, FSUM, COST } from './heavy.js?v=32';
import { Bastion } from './bastion.js?v=32';
import { Objectives } from './objectives.js?v=32';
import { tpos, tAlive } from './loadout.js?v=32';
import { Orders } from './orders.js?v=32';
import { Wrath } from './wrath.js?v=32';

const qs = new URLSearchParams(location.search);
const SHOT = qs.get('shot'), TEST = qs.has('test'), NOFS = qs.has('nofs');
const $ = id => document.getElementById(id);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
// render at most ~1260 lines: bloom + particle overdraw at 4K was the main source of hitching
const calcPR = () => Math.min(devicePixelRatio, 1.25, Math.max(0.6, 1260 / innerHeight));
let basePR = calcPR(), curPR = basePR;
renderer.setPixelRatio(curPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.98;
renderer.autoClear = false;
document.body.prepend(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const fogColor = new THREE.Color(0.115, 0.046, 0.024), fogDensity = 0.00115;   // was 0.0017: targets at 150-300 m read clearly, the far city still drowns in haze
scene.fog = new THREE.FogExp2(fogColor, fogDensity);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 6000);
const pipCam = new THREE.PerspectiveCamera(72, 16 / 9, 0.5, 4000);

scene.add(new THREE.HemisphereLight(0x8a5c4a, 0x140d0a, 0.9));
const sun = new THREE.DirectionalLight(0xff6a28, 1.9); sun.position.set(-0.35, 0.4, -1); scene.add(sun);
const fill = new THREE.DirectionalLight(0x5a6e90, 0.6); fill.position.set(0.5, 0.8, 0.9); scene.add(fill);
const camLight = new THREE.PointLight(0xb4c0d8, 650, 120, 1.6); camera.add(camLight); scene.add(camera);

// ---------- sky ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uFog: { value: fogColor } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec3 vDir; uniform float uTime, uFlash; uniform vec3 uFog;
    float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      float az = atan(d.z, d.x);
      float glowAz = 0.5 + 0.5 * cos(az + 1.5708);            // the burning hive lies to the north (-Z)
      glowAz = 0.35 + 0.65 * glowAz * glowAz + 0.25 * n2(vec2(az * 3.0, 1.0));
      float band = exp(-max(h, 0.0) * 6.0);
      vec3 col = mix(vec3(0.016, 0.012, 0.016), vec3(1.25, 0.40, 0.07) * glowAz, band);
      vec2 uv = d.xz / (abs(h) + 0.16);
      float n = fbm(uv * 1.1 + vec2(uTime * 0.006, 0.0));
      float cl = smoothstep(0.38, 0.72, n) * smoothstep(0.0, 0.2, h);
      vec3 cloud = vec3(0.035, 0.022, 0.02) + vec3(0.55, 0.16, 0.035) * pow(n, 3.0) * glowAz * (0.4 + band * 2.0);
      col = mix(col, cloud, cl * 0.9);
      col += uFlash * vec3(0.55, 0.3, 0.14) * (0.15 + band + cl * 0.25);
      col = mix(uFog, col, smoothstep(-0.01, 0.06, h));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

// ---------- game context ----------
const G = window.game = {
  scene, camera, renderer, fogColor, fogDensity, time: 0, trauma: 0, skyFlash: 0, hurtFlash: 0, meltaWarn: 0, threat: null,
  aimPoint: new THREE.Vector3(0, 10, -100), camKick: 0, fovKick: 0, godMode: false, noHunt: false, freeCam: null, shot: null, fps: 60, started: false, pipAlpha: 0,
  stats: { dead: [0, 0], deadTanks: [0, 0], deadAir: [0, 0], colKills: [0, 0], kInf: 0, kTank: 0, kAir: 0, colDmg: 0, rounds: 0, shells: 0, missiles: 0, spires: 0, deaths: 0 },
  input: { fwd: 0, turn: 0, mdx: 0, mdy: 0, fire1: false, fire2: false, aa: false, sprint: false, spear: false },
  rumble: 0, camRollKick: 0, camRoll: 0, lastHunt: -99, cmd: [], timeScale: 1, tactical: false, zonePreview: null, tacForce: false, hornT: 0, stompK: false,
};
G.sfx = new Sfx();
G.addTrauma = v => { G.trauma = Math.min(1, G.trauma + v); };
G.shakeAt = (x, y, z, p) => { const c = camera.position, d = Math.hypot(x - c.x, y - c.y, z - c.z) / 42; G.trauma = Math.min(1, G.trauma + p * 0.55 / (1 + d * d)); };
G.kick = (p, f) => { G.camKick = Math.min(2, G.camKick + p); G.fovKick = Math.min(6, G.fovKick + f); };   // p: camera push-back (m), f: FOV pulse (deg). Never rotates the aim.
G.reinforceMul = side => { let own = 0, foe = 0; for (const c of G.colossi) if (c.alive) { if (c.side === side) own++; else foe++; } return clamp(1 + 0.45 * (foe - own), 0.6, 2.2); };
G.nextClass = CLASS[qs.get('class')] ? qs.get('class') : 'kestrel';   // ?class=kestrel|harrow|hierarch|colossus; the picker changes it
function endGame() {   // victory (Synod bastion down) or defeat (Vigil bastion down)
  G.over = true; const st = G.stats, v = G.endKind === 'victory', tm = Math.floor(G.time), dmg = Math.round((st.colDmg || 0) + (st.hierDmg || 0) + (st.harrowDmg || 0) + (st.structDmg || 0));
  $('endTitle').textContent = v ? 'VICTORY' : 'DEFEAT'; $('endTitle').style.color = v ? '#ffe08a' : '#ff6a40';
  $('endSub').textContent = v ? 'The Synod bastion has fallen. The Spire District is yours.' : 'The Vigil bastion has fallen. The district is lost.';
  const hk = (st.hierKills || [0, 0])[1], gk = st.colKills[1], rk = (st.harrowKills || [0, 0])[1];
  $('endStats').innerHTML = `Time ${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, '0')}<br>Kills: infantry ${st.kInf}, armour ${st.kTank}, air ${st.kAir}, scout engines ${st.kScout || 0}<br>Enemy engines downed: harrows ${rk}, hierarchs ${hk}, great colossi ${gk}; turrets ${st.turretKills || 0}<br>Damage dealt to engines and fortifications: ${dmg}<br>You fell ${st.deaths} time${st.deaths === 1 ? '' : 's'} as ${player.cls}`;
  $('endScreen').style.display = 'flex'; try { document.exitPointerLock(); } catch (e) { /* none */ }
}
$('deploy').addEventListener('click', () => location.reload());   // "deploy again": a fresh load, with the class picker
let msgT = 0, ffMsgT = -99;
const FF_LINES = ['CEASE FIRE, KARNITE ENGINE!', 'YOU ARE BURNING YOUR OWN, ENGINE!', 'CHECK YOUR FIRE - THOSE ARE VIGIL TROOPS!', 'ENGINE, THAT WAS ONE OF OURS!'];
G.ffKill = (kind, hitOnly) => { if (!hitOnly) G.stats.ff = (G.stats.ff || 0) + 1; if (G.time - ffMsgT > 6) { ffMsgT = G.time; G.announce(FF_LINES[Math.floor(Math.random() * FF_LINES.length)]); } };
G.announce = t => { $('msg').textContent = t; $('msg').style.opacity = 1; msgT = 3.2; };
G.fx = new Fx(G);
G.city = new City(G);
G.units = new Units(G);
G.player = new Player(G);
G.scouts = new Scouts(G);
// one great colossus a side (princeps spec; the second names, THE ASHEN MATRIARCH and THE PYRE-FATHER, left the spawn list)
G.colossi = [new Colossus(G, 0, -16, 420, 235, 'KARNAK THE PATIENT'), new Colossus(G, 1, 16, -420, -235, 'CINDERMAW')];
// Hierarch-class battle colossi: one per side near the front line; the second name of each side enters when the first falls
G.hierarchs = [new Hierarch(G, 0, 108, 380, 190), new Hierarch(G, 1, -108, -380, -190)];
// Harrow-class line engines: one per side on its half of the front, back 70 s after it falls
G.harrows = [new Harrow(G, 0, -70, 300, 120), new Harrow(G, 1, 70, -300, -120)];
// the two bastions (Vigil z +740, Synod z -740) with their ward generators and guns; destroying the Synod bastion wins, losing the Vigil one loses
G.structs = []; G.bastions = [new Bastion(G, 0), new Bastion(G, 1)];
G.objectives = new Objectives(G);   // five capturable midfield sites A-E (js/objectives.js)
G.orders = new Orders(G); G.wrath = new Wrath(G);   // crosshair orders and the Wrath meter (heavy classes only)
G.city.crush(0, 580, 30); G.city.crush(0, -580, 30);
G.bastionDown = side => { G.endAt = G.time + 6; G.endKind = side === 1 ? 'victory' : 'defeat'; };
G.air = new Air(G);
G.streets = new Streets(G);
const { fx, city, units, player, air, colossi, scouts, hierarchs, harrows } = G;

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _r = new THREE.Vector3(), _camPos = new THREE.Vector3(), _piv = new THREE.Vector3();
// hitscan through the whole world. side = shooter's side.
G.shoot = (o, d, max, side, opt) => {
  const bp = !!opt.byPlayer || side === 0;
  let t = max, type = 'none', ref = null;
  const c = city.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max); if (c) { t = c.t; type = c.b ? 'bld' : 'ground'; ref = c.b; }
  const tk = units.rayTanks(o, d, t, side); if (tk) { t = tk.t; type = 'tank'; ref = tk.tank; }
  const ac = air.rayAir(o, d, t, side); if (ac) { t = ac.t; type = 'air'; ref = ac.ac; }
  let legT = -1;   // set when the nearest hit is a heavy's leg capsule (rayLeg): the shot then lands on the legs component
  const engHit = (e, k) => { const tt = e.rayHit(o, d, t); if (tt >= 0) { t = tt; type = k; ref = e; } const lg = e.rayLeg(o, d, t); if (lg && lg.t < t) { t = lg.t; type = k; ref = e; legT = t; } };
  for (const col of colossi) { if (col.side === side || (col.piloted && side === -1)) continue; engHit(col, 'col'); }
  for (const hh of hierarchs) { if (hh.side === side || (hh.piloted && side === -1)) continue; engHit(hh, 'hier'); }
  for (const hh of harrows) { if (hh.side === side || (hh.piloted && side === -1)) continue; engHit(hh, 'harrow'); }
  const sc = scouts.ray(o, d, t, side); if (sc) { t = sc.t; type = 'scout'; ref = sc.s; }
  for (const st of G.structs) { if (!st.alive || st.side === side || (side === -1 && st.side === 0)) continue; const tt = st.rayHit(o, d, t); if (tt >= 0) { t = tt; type = 'struct'; ref = st; } }   // bastions, ward generators, turrets
  const ti = units.rayInfantry(o, d, t, side, opt.radius || 1.5, opt.pierce || 1, bp, !!opt.probe);
  if (opt.probe) { if (ti < t) { t = ti; type = 'inf'; } }
  else if (type === 'tank') units.damageTank(ref, opt.tank, bp);
  else if (type === 'air') air.damage(ref, opt.air, bp);
  else if (type === 'col') ref.damage(opt.col, bp, false, { x: o.x + d.x * (t + 1), y: o.y + d.y * (t + 1), z: o.z + d.z * (t + 1), comp: legT === t ? 'legs' : undefined });   // the actual hit point, 1 m inside the volume
  else if (type === 'hier') ref.damage(opt.col, bp, false, { x: o.x + d.x * (t + 1), y: o.y + d.y * (t + 1), z: o.z + d.z * (t + 1), comp: legT === t ? 'legs' : undefined });   // the actual hit point, 1 m inside the volume
  else if (type === 'harrow') ref.damage(opt.col, bp, false, { x: o.x + d.x * (t + 1), y: o.y + d.y * (t + 1), z: o.z + d.z * (t + 1), comp: legT === t ? 'legs' : undefined });   // the actual hit point, 1 m inside the volume
  else if (type === 'struct') ref.damage(opt.col, bp);
  else if (type === 'scout') scouts.damage(ref, (opt.tank || 0) * 1.2, bp, o.x, o.z);
  else if (type === 'bld') city.damage(ref, opt.struct, d.x, d.z, false, !!opt.byPlayer);
  return { x: o.x + d.x * t, y: Math.max(0.2, o.y + d.y * t), z: o.z + d.z * t, t, type, ref };
};
G.blast = (x, y, z, r, dmg, side, byPlayer, scoutDmg) => {   // scoutDmg: override for Kestrel walkers (the colossus gatling)
  if (side === 0 && !byPlayer && G.hornT > 0) { dmg *= 1.25; if (scoutDmg !== undefined) scoutDmg *= 1.25; }   // WAR HORN: allied units deal +25%
  units.blast(x, y, z, r, dmg, side, !!byPlayer); scouts.blast(x, y, z, r, scoutDmg === undefined ? dmg : scoutDmg, side, !!byPlayer);
  // friendly fire is total: your own side's bombs and shells hurt you too
  if (!byPlayer && !player.dead && y < 26) { const d = Math.hypot(player.pos.x - x, player.pos.z - z); if (d < r + 5) player.damage(dmg * 0.22 * (1 - d / (r + 5)), rnd() < 0.55 ? 'leg' : 'hull', x, z); }
  for (const a of air.list) if (a.alive && !a.falling && a.pos.distanceToSquared(_v.set(x, y, z)) < r * r) air.damage(a, dmg * 0.5, !!byPlayer);
  if (y < 5) city.crush(x, z, r * 0.6);
  for (const st of G.structs) if (st.alive && (byPlayer ? st.side === 1 : st.side !== side)) { const d = Math.hypot(st.pos.x - x, st.pos.z - z) - st.radius; if (d < r) st.damage(dmg * 0.5 * (1 - Math.max(0, d) / r), !!byPlayer, false, { x, y, z }); }
};
G.stomp = (x, z, r, col) => {
  const d = fx.camDist(x, 0, z);
  if (d < 900) { fx.dust(x, 1, z, r * 0.45, d < 400 ? 12 : 6, 0.15, 0.55); fx.decal(x, z, r * 1.1); if (d < 400) { fx.debris(x, 1, z, 5, 1.1, 16, 0.1); fx.sparks(x, 1, z, 10, 18); } }
  G.sfx.stomp(d, 1); G.shakeAt(x, 0, z, 9 * Math.min(1, r / 12));
  G.stompK = !!col.piloted; units.crush(x, z, r, -1, !!col.piloted); G.stompK = false; city.crush(x, z, r); scouts.stomp(x, z, r, col.isHierarch ? 250 : col.isHarrow ? 120 : 0);   // the player's stomp kills pay Wrath
  if (!col.isHierarch && !col.isHarrow) for (const h of hierarchs) h.stomped(x, z, r);   // a great colossus foot cripples a hierarch's legs
  if (!col.isHarrow) for (const h of harrows) h.stomped(x, z, r, col.isHierarch ? 150 : 300);   // heavier feet hurt a harrow
  if (!player.dead && Math.hypot(player.pos.x - x, player.pos.z - z) < r * 0.85) { player.damage(999); G.announce('CRUSHED UNDER ' + col.name); }
};

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.6, 0.92); composer.addPass(bloom);
composer.addPass(new OutputPass());
// picture-in-picture (leg heading view)
const pipRT = new THREE.WebGLRenderTarget(480, 270, { type: THREE.HalfFloatType });
const oScene = new THREE.Scene(), oCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
const pipQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: pipRT.texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
oScene.add(pipQuad);
let pipRect = { x: 0, y: 0, w: 1, h: 1 };
function layout() {
  const w = innerWidth, h = innerHeight;
  basePR = calcPR(); curPR = Math.min(curPR, basePR); renderer.setPixelRatio(curPR); composer.setPixelRatio(curPR);
  renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  oCam.right = w; oCam.top = h; oCam.updateProjectionMatrix();
  const pw = Math.round(clamp(w * 0.3, 260, 620)), ph = Math.round(pw * 9 / 16), px = w - pw - 26, py = 46;
  pipRect = { x: px, y: py, w: pw, h: ph };
  pipQuad.scale.set(pw, ph, 1); pipQuad.position.set(px + pw / 2, h - py - ph / 2, 0);
  const f = $('pipFrame').style; f.left = (px - 3) + 'px'; f.top = (py - 3) + 'px'; f.width = pw + 'px'; f.height = ph + 'px';
}
layout(); addEventListener('resize', layout);

// ---------- input ----------
const keys = {}; let tacToggle = false, tacCls = null; let mdx = 0, mdy = 0, lmb = false, rmb = false, hudOn = true;
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); if (G.tactical) { const m = /^Digit([1-4])$/.exec(e.code); if (m) G.tac.group = +m[1]; } if (e.code === 'KeyH') { hudOn = !hudOn; $('hud').style.display = hudOn ? '' : 'none'; } if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) tacToggle = !tacToggle; }
  if (!e.repeat && G.started && player.heavy && !player._dead && !G.over) {   // princeps keys (heavy classes only): F order (1-4 held: one group), R on me, V stand down, E horn, C overcharge, X Heaven's Nail
    if (e.code === 'KeyF') G.orders.issue(orderCtx(), [1, 2, 3, 4].find(n => keys['Digit' + n]) || 0); else if (e.code === 'KeyR') G.orders.onMe(); else if (e.code === 'KeyV') G.orders.standDown();
    else if (e.code === 'KeyE') G.wrath.horn(); else if (e.code === 'KeyC') G.wrath.overcharge(); else if (e.code === 'KeyX') G.wrath.nail(nailPoint());
  } });
addEventListener('keyup', e => { keys[e.code] = false; });
let lmx = null, lmy = 0;
addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; }
  else if (TEST) { if (lmx !== null) { mdx += e.clientX - lmx; mdy += e.clientY - lmy; } lmx = e.clientX; lmy = e.clientY; }
});
// raw (unaccelerated) mouse where the browser supports it; falls back to the plain lock
function lockPointer() {
  // fullscreen keeps a fast flick from carrying the cursor onto another monitor in windowed Chrome
  if (!document.fullscreenElement && !NOFS) { try { const f = document.documentElement.requestFullscreen({ navigationUI: 'hide' }); if (f && f.catch) f.catch(e => console.warn(e)); } catch (e) { console.warn(e); } }
  try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { const q = canvas.requestPointerLock(); if (q && q.catch) q.catch(e => console.warn(e)); } catch (e) { console.warn(e); } }); } catch (e) { console.warn(e); }
}
addEventListener('mousedown', e => { if (!G.started) return; if (G.tactical) { tacMouse(e, true); return; } if (e.button === 0) lmb = true; if (e.button === 2) rmb = true; if (e.button === 1) { keys.MMB = true; if (player.heavy) G.cmd.push({ t: 'mmb', time: performance.now() / 1000 }); } if (document.pointerLockElement !== canvas && !TEST) lockPointer(); });
addEventListener('mouseup', e => { if (G.tactical || G.tac.drag) tacMouse(e, false); if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; if (e.button === 1) keys.MMB = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { for (const k in keys) keys[k] = false; lmb = rmb = false; });
// if the lock is lost mid-fight, drop all held input and ask for a click instead of letting the walker run off
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) tacToggle = false;   // losing the lock closes the tactical view so time never stays slowed
  if (document.pointerLockElement === canvas) { if (G.started) $('overlay').style.display = 'none'; return; }   // lock came back by any route: clear the prompt
  if (!G.started || TEST || SHOT || G.over) return;
  for (const k in keys) keys[k] = false; lmb = rmb = false; mdx = mdy = 0;
  $('overlay').style.display = ''; const go = document.querySelector('#overlay .go'); if (go) go.textContent = 'Mouse released - click to resume';
});
// ---------- class picker (start overlay and respawn screen): cards, keys 1-4 ----------
const CLS = Object.keys(CLASS), ROLE = { kestrel: 'Fast scout engine. Sunspear, flamer, AA rack.', harrow: 'Brawler. Siege fist, lascannon, rocket barrage.', hierarch: 'Battle colossus. Macro-cannon, fusion blaster, missile pod.', colossus: 'Great colossus. Gatling, charged lance, carapace battery.' }, SIL = { kestrel: 22, harrow: 40, hierarch: 63, colossus: 115 };
const pickers = [$('picker'), $('pickerDead')];
function renderPickers() { for (const p of pickers) p.innerHTML = CLS.map((k, i) => `<div class="card${G.nextClass === k ? ' sel' : ''}" data-k="${k}"><div class="sil"><i style="height:${(SIL[k] / 115 * 100).toFixed(0)}%"></i></div><b>${i + 1} &middot; ${CLASS[k].label}</b><span>${ROLE[k]}</span></div>`).join(''); }
function pickClass(k) { if (!CLASS[k]) return; G.nextClass = k; renderPickers(); }
renderPickers();
for (const p of pickers) p.addEventListener('click', e => { const c = e.target.closest('.card'); if (c) pickClass(c.dataset.k); });
addEventListener('keydown', e => { const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code); if (m && (!G.started || player._dead)) pickClass(CLS[+m[1] - 1]); });
$('overlay').addEventListener('click', () => {
  if (!G.started) { $('picker').style.display = 'none'; if (G.nextClass !== player.cls) { player.spawn(40, 205); _piv.set(40, 15, 205); } }
  $('overlay').style.display = 'none'; G.started = true; try { G.sfx.init(); } catch (e) { console.warn(e); } if (!TEST) lockPointer(); });
{ const go = document.querySelector('#overlay .go'); if (go) go.textContent = 'Click to wake the engine'; }
if (SHOT || TEST) { $('overlay').style.display = 'none'; $('picker').style.display = 'none'; G.started = true; }

// ---------- simulation ----------
function step(dt, inp) {
  G.time += dt; G.threat = null; G.meltaWarn = Math.max(0, G.meltaWarn - dt);
  player.update(dt, inp); units.update(dt); scouts.update(dt); G.streets.update(dt);
  for (const c of colossi) c.update(dt);
  for (const h of hierarchs) h.update(dt);
  for (const h of harrows) h.update(dt);
  for (const b of G.bastions) b.update(dt);
  G.objectives.update(dt); G.orders.update(dt); G.wrath.update(dt);
  if (G.endAt && G.time > G.endAt && !G.over) endGame();
  air.update(dt); city.update(dt, G.time); fx.update(dt);
  G.hitMark = Math.max(0, (G.hitMark || 0) - 5 * dt); G.killTick = Math.max(0, (G.killTick || 0) - 3 * dt);
  G.skyFlash *= Math.exp(-5 * dt); G.trauma = Math.max(0, G.trauma - 2.3 * dt); G.hurtFlash = Math.max(0, G.hurtFlash - 1.6 * dt);
  G.camKick = damp(G.camKick, 0, 30, dt); G.fovKick = damp(G.fovKick, 0, 24, dt); G.rumble = damp(G.rumble, 0, 14, dt); G.camRollKick = damp(G.camRollKick, 0, 5, dt);
}
G.step = step;
let shakeT = 0, camSide = 10, camDist = 41, flameHold = 0;
// What the camera may not enter. Wider than the gameplay collision box: buildings carry corner turrets, buttresses, roof
// ledges and spirelets up to ~3 m outside and ~10 m above it, and with the raised chase pivot the camera rides at roof height.
function camSolid(x, y, z) {
  const b = city.lot(x, z); if (!b) return null;
  if (!b.alive) return city.solid(x, y, z);
  const dx = Math.abs(x - b.x), dz = Math.abs(z - b.z);
  if (dx < b.hw + 3.2 && dz < b.hd + 3.2 && y < b.h + 17) return b;
  if (dx < b.sw + 2 && dz < b.sd + 2 && y < b.top + 3) return b;
  return null;
}
function camRay(ox, oy, oz, dx, dy, dz, max) { for (let t = 1.5; t <= max; t += 1.5) if (camSolid(ox + dx * t, oy + dy * t, oz + dz * t)) return t - 1.5; return -1; }
function updateCamera(dt) {
  const ay = player.aimYaw, ap = player.aimPitch, cp = Math.cos(ap);
  _d.set(Math.sin(ay) * cp, Math.sin(ap), Math.cos(ay) * cp); _r.set(-Math.cos(ay), 0, Math.sin(ay));
  const PC = player.C, cs = PC.dist / 41;   // class camera: pivot height and distance (Kestrel 18 / 41, so cs = 1)
  _v.set(player.pos.x, PC.pivot + player.bob * 0.5, player.pos.z);
  _piv.x = damp(_piv.x, _v.x, 34, dt); _piv.z = damp(_piv.z, _v.z, 34, dt); _piv.y = damp(_piv.y, _v.y, 30, dt);   // slight positional lag only; rotation is never smoothed
  if (_piv.distanceTo(_v) > 40) _piv.copy(_v);
  // Default chase: the original over-the-right-shoulder offset. While the inferno (left arm) fires, the camera eases
  // across to the left shoulder in about a quarter second so the jet crosses the frame, and returns 0.4 s after release.
  if (G.input.fire1 && player.flaming) flameHold = 0.4; else flameHold -= dt;
  const wantSide = (flameHold > 0 && !player.dead ? -9 : 10) * cs;
  camSide = damp(camSide, wantSide, flameHold > 0 ? 14 : 7, dt);
  _camPos.copy(_piv).addScaledVector(_d, -(PC.dist - 1)).addScaledVector(_r, camSide).y += 8 * cs;
  if (_camPos.y < 3) _camPos.y = 3;
  // Collision: three rays (centre plus a feeler either side) from the head pivot to where the camera wants to be.
  // The camera stops 3 m short of the first wall. Pull-in is immediate, so it is never inside geometry; release is slow.
  _v.subVectors(_camPos, _piv); const full = _v.length(); _v.multiplyScalar(1 / full);
  let lim = full;
  if (!PC.noCamRay) for (const sOff of [0, 2.4, -2.4]) {   // the colossus camera skips the building rays and relies on height
    const tx = _camPos.x + _v.z * sOff - _piv.x, ty = _camPos.y - _piv.y, tz = _camPos.z - _v.x * sOff - _piv.z, tl = Math.hypot(tx, ty, tz);
    const ht = camRay(_piv.x, _piv.y, _piv.z, tx / tl, ty / tl, tz / tl, tl + 2);
    if (ht >= 0) lim = Math.min(lim, ht - 1.5);
  }
  lim = Math.max(2.5, lim);
  camDist = Math.min(lim, damp(camDist, lim, 2.5, dt));
  _camPos.copy(_piv).addScaledVector(_v, camDist);
  for (let i = 0; i < 20 && !PC.noCamRay && camDist > 1 && camSolid(_camPos.x, _camPos.y, _camPos.z); i++) { camDist = Math.max(1, camDist - 2); _camPos.copy(_piv).addScaledVector(_v, camDist); }   // belt and braces
  const k = camDist / full; G.camClear = lim;
  // aim point for the guns: where the reticle ray lands
  _o.copy(_camPos).addScaledVector(_d, 46 * cs * k + 4);
  const h = G.shoot(_o, _d, 900, -1, { probe: true, radius: 2.4 });
  G.aimPoint.set(h.x, h.y, h.z); G.aimHit = h;
  G.aimTarget = (h.type === 'col' || h.type === 'hier' || h.type === 'harrow') && h.ref.side === 1 && h.t < 700 ? h.ref : null;   // a hostile engine under the crosshair
  if (G.freeCam) { camera.position.copy(G.freeCam.pos); camera.lookAt(G.freeCam.look); camera.fov = G.freeCam.fov || 55; }
  else {
    camera.position.copy(_camPos); _v.copy(_camPos).addScaledVector(_d, 100); camera.lookAt(_v);
    camera.fov = 62 + G.fovKick + Math.min(24, Math.abs(player.speed)) * 0.22 + player.sprintK * 7;
    camera.position.addScaledVector(_d, -G.camKick * 0.9);      // recoil = dolly back along the aim axis
  }
  // Shake moves the camera body and rolls it about the aim axis. It never pitches or yaws, so the reticle ray stays put.
  // Total is capped, and capped much lower while a trigger is held.
  const inp = G.input, firing = inp.fire1 || inp.fire2 || inp.spear;
  shakeT += dt * 38; const tr = Math.min(G.trauma, firing ? 0.3 : 0.72), s = tr * tr, rm = G.rumble * 0.05;
  camera.position.x += Math.sin(shakeT * 1.3) * Math.cos(shakeT * 0.7) * s * 2.2 + Math.sin(shakeT * 3.1) * rm; camera.position.y += Math.sin(shakeT * 1.7 + 2) * s * 2.2 + Math.cos(shakeT * 2.7) * rm; camera.position.z += Math.cos(shakeT * 1.1 + 1) * s * 1.4;
  G.camRoll = damp(G.camRoll, clamp(-player.lat * 0.007 - player.turnVel * 0.012 * Math.min(1, Math.abs(player.speed) / 24), -0.14, 0.14), 8, dt);
  if (!G.freeCam) camera.rotateZ(Math.sin(shakeT * 0.9) * s * 0.035 + G.camRoll + G.camRollKick);
  camera.updateProjectionMatrix();
  // PiP: look where the legs are going
  const tw = Math.abs(player.twist), want = (tw > 0.52 && !player._dead && PC.pip && !G.freeCam) ? 1 : 0;
  G.pipAlpha = damp(G.pipAlpha, want, want ? 7 : 5, dt);
  const ly = player.legYaw, fxx = Math.sin(ly), fzz = Math.cos(ly);
  pipCam.position.set(player.pos.x - fxx * 27, 22 + player.bob * 0.8, player.pos.z - fzz * 27);
  if (city.solid(pipCam.position.x, pipCam.position.y, pipCam.position.z)) pipCam.position.set(player.pos.x - fxx * 9, 24, player.pos.z - fzz * 9);
  pipCam.lookAt(player.pos.x + fxx * 60, 7, player.pos.z + fzz * 60);
  sky.position.copy(camera.position);
}

// ---------- HUD ----------
const el = {}; for (const id of ['bVeil', 'tVeil', 'bCool', 'tCool', 'bSpear', 'tSpear', 'cols', 'bHull', 'bLegL', 'bLegR', 'bHeat', 'bCan', 'bAA', 'tHull', 'tLegL', 'tLegR', 'tHeat', 'tCan', 'tAA', 'gait', 'kills', 'frontTxt', 'threat', 'threatBar', 'melta', 'lock', 'lockTxt', 'twLegs', 'heatPath', 'hurt', 'dead', 'fps', 'pipFrame', 'msg']) el[id] = $(id);
const setBar = (b, v, bad) => { b.firstElementChild.style.width = (clamp(v, 0, 1) * 100).toFixed(0) + '%'; b.classList.toggle('bad', !!bad); };
let awShown = false;
let hudN = 0; const hitm = $('hitm');
function updateHUD(dt) {
  for (const a of ['L', 'R']) {   // a corner bracket on each locked target, in that arm's colour
    const el_ = a === 'L' ? lockL : lockR, l = player.heavy && !G.tactical ? player.unit.lock[a] : null;
    if (l && tAlive(l)) { tpos(l, _v); const rng = Math.round(_v.distanceTo(camera.position)); _v.project(camera); if (_v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1) { el_.style.display = 'block'; el_.style.left = ((_v.x * 0.5 + 0.5) * innerWidth) + 'px'; el_.style.top = ((-_v.y * 0.5 + 0.5) * innerHeight) + 'px'; el_.textContent = a + (l.ovr ? ' OVR' : ' ' + rng + ' M'); el_.style.opacity = l.ovr ? 0.35 : l.los === false ? 0.5 : 1; continue; } }
    el_.style.display = 'none';
  }
  if (G.tactical) {
    const u = player.unit, W = { harrow: ['FIST', 'LASCANNON', 'ROCKETS'], hierarch: ['MACRO-GUN', 'BLASTER', 'MISSILES'], colossus: ['GATLING', 'LANCE', 'BATTERY'] }[u.hcls], GC = ['#ffc93c', '#c59bff', '#fff0c8', u.side ? '#5cff6a' : '#ffb23c'];
    const st = ['L', 'R'].map(a => u.lock[a] ? 'LOCK ' + (u.lock[a].r.name || u.lock[a].k.toUpperCase()) : 'FREE'); st.push(u.queuedQ ? 'QUEUED' : 'READY'); st.push(u.focus ? 'FOCUS ' + (u.focus.name || '') : u.zones.length ? 'ZONE Z' + u.zones.length : 'AUTO');
    const nm = ['LEFT ARM  ' + W[0], 'RIGHT ARM  ' + W[1], 'CARAPACE  ' + W[2], 'SECONDARIES'];
    $('tacPlates').innerHTML = nm.map((n, i) => `<div class="plate${G.tac.group === i + 1 ? ' sel' : ''}" style="--gc:${GC[i]}"><b>${i + 1}</b><span>${n}</span><i>${st[i]}</i></div>`).join('');
    $('tacTop').textContent = 'TACTICAL  ' + player.C.auspex + ' M  TIME x0.3';
    const tf = tacAus.tf, tip = $('tacTip'); let hov = null;   // hovering a site on the Tab map shows its benefit
    if (tf) { const f = tf.W / tacSize; for (const o of G.objectives.sites) { const m = tacAus.toMap(o.x, o.z); if (Math.hypot(m.x - G.tac.cx * f, m.y - G.tac.cy * f) / f < Math.max(14, 60 * tf.s / f)) { hov = o; break; } } }
    tip.style.display = hov ? 'block' : 'none'; if (hov) tip.textContent = G.objectives.tip(hov);
  }
  msgT -= dt; if (msgT <= 0) el.msg.style.opacity = 0;
  el.hurt.style.opacity = Math.min(0.9, G.hurtFlash).toFixed(2);
  el.pipFrame.style.opacity = G.pipAlpha.toFixed(2);
  hitm.style.opacity = Math.min(1, G.hitMark * 1.4).toFixed(2); el.kills.style.color = G.killTick > 0.05 ? '#fff2c0' : '#c9773a';
  el.twLegs.setAttribute('transform', `rotate(${(player.twist * 57.3).toFixed(1)})`);
  // lock diamond
  const lt = player.lockT;
  if (lt && player.aaHeld) {
    _v.copy(lt.pos).project(camera);
    const x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight, ok = player.lockProg >= 1, sc = 2.2 - 1.2 * player.lockProg;
    el.lock.style.display = 'block'; el.lock.style.left = x + 'px'; el.lock.style.top = y + 'px'; el.lock.style.transform = `rotate(45deg) scale(${sc.toFixed(2)})`; el.lock.classList.toggle('ok', ok);
    el.lockTxt.style.display = 'block'; el.lockTxt.style.left = x + 'px'; el.lockTxt.style.top = y + 'px'; el.lockTxt.textContent = ok ? 'LOCK - RELEASE TO FIRE' : 'SEEKING ' + lt.kind.toUpperCase();
  } else { el.lock.style.display = 'none'; el.lockTxt.style.display = 'none'; }
  if ((hudN++ % 4) !== 0) return;
  G.objectives.hud(); G.wrath.hud(); G.orders.hud();
  setBar(el.bVeil, player.veilFrac, player.veilDown); el.tVeil.textContent = player.veil <= 0 ? 'DOWN' : (player.veilFrac * 100).toFixed(0);
  setBar(el.bCool, player.coolant, player.coolLock); el.tCool.textContent = player.coolLock ? 'LOCK' : player.sprinting ? 'RUN' : (player.coolant * 100).toFixed(0);
  setBar(el.bSpear, player.spearFrac, player.spearCd > 0); el.tSpear.textContent = player.spearCharge > 0 ? 'CHG' : player.spearCd > 0 ? player.spearCd.toFixed(0) : 'RDY';
  for (let i = 0; i < colossi.length; i++) {
    const c = colossi[i], row = colRows[i], show = !c.piloted && (c.state === 'alive' || c.state === 'dying') && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < 900;
    row.style.display = show ? '' : 'none'; if (!show) continue;
    row.children[1].firstElementChild.style.width = (clamp(wardFrac(c), 0, 1) * 100).toFixed(0) + '%';
    row.children[2].firstElementChild.style.width = (clamp(c.hp / COL_HP, 0, 1) * 100).toFixed(0) + '%';
    row.firstElementChild.textContent = c.name + (c.state === 'dying' ? ' - CRITICAL' : c.cl ? ' - CRIPPLED' : c.ca ? ' - DISARMED' : c.crippleT > 0 ? ' - STAGGERED' : c.hp < COL_HP * 0.3 ? ' - HULL FAILING' : '');
  }
  for (let i = 0; i < hierarchs.length; i++) {   // hierarchs: listed under the great colossi, smaller bars
    const c = hierarchs[i], row = hierRows[i], show = !c.piloted && (c.state === 'alive' || c.state === 'dying') && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < 900;
    row.style.display = show ? '' : 'none'; if (!show) continue;
    row.children[1].firstElementChild.style.width = (clamp(wardFrac(c), 0, 1) * 100).toFixed(0) + '%';
    row.children[2].firstElementChild.style.width = (clamp(c.hp / HIER_HP, 0, 1) * 100).toFixed(0) + '%';
    row.firstElementChild.textContent = c.name + (c.state === 'dying' ? ' - CRITICAL' : c.cl ? ' - CRIPPLED' : c.ca ? ' - DISARMED' : c.staggerT > 0 ? ' - STAGGERED' : c.limpT > 0 ? ' - LAMED' : c.hp < HIER_HP * 0.3 ? ' - HULL FAILING' : '');
  }
  for (let i = 0; i < harrows.length; i++) {   // harrows: under the hierarch bars
    const c = harrows[i], row = harRows[i], show = !c.piloted && (c.state === 'alive' || c.state === 'dying') && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < 900;
    row.style.display = show ? '' : 'none'; if (!show) continue;
    row.children[1].firstElementChild.style.width = (clamp(wardFrac(c), 0, 1) * 100).toFixed(0) + '%';
    row.children[2].firstElementChild.style.width = (clamp(c.hp / HARROW_HP, 0, 1) * 100).toFixed(0) + '%';
    row.firstElementChild.textContent = c.name + (c.state === 'dying' ? ' - CRITICAL' : c.cl ? ' - CRIPPLED' : c.ca ? ' - DISARMED' : c.staggerT > 0 ? ' - STAGGERED' : c.hp < HARROW_HP * 0.3 ? ' - HULL FAILING' : '');
  }
  setBar(el.bHull, player.hull / 100, player.hull < 35); setBar(el.bLegL, player.legL / 100, player.legL < 40); setBar(el.bLegR, player.legR / 100, player.legR < 40);
  el.tHull.textContent = player.hull.toFixed(0); el.tLegL.textContent = player.legL.toFixed(0); el.tLegR.textContent = player.legR.toFixed(0);
  const pu = player.heavy ? player.unit : null;
  el.gait.textContent = pu && pu.cl ? 'CRIPPLED - LEGS OUT, SPEED x0.25' : pu && pu.ca ? 'DISARMED - BOTH ARMS OUT' : player.limping ? 'GAIT: LIMPING - ACTUATOR BREACH' : `GAIT: ${Math.abs(player.speed * 3.6).toFixed(0)} KM/H  TWIST ${(player.twist * 57.3).toFixed(0)}°`;
  if (player.heavy) {   // capacitor banks, planted tag, paper-dolls, head-hit static
    const u = player.unit, c = u.cap, p = u.pending || 0, ga = Math.min(c.arms, p), gs = p - ga, gd = Math.min(c.drive, gs), gw = Math.min(c.ward, gs - gd);
    for (const [id, v, g] of [['capW', c.ward, gw], ['capD', c.drive, gd], ['capA', c.arms, ga]]) { const e = $(id); e.style.height = v.toFixed(0) + '%'; const gh = e.nextElementSibling; gh.style.bottom = Math.max(0, v - g).toFixed(0) + '%'; gh.style.height = g.toFixed(0) + '%'; }
    $('plantTag').style.display = u.planted ? 'block' : 'none';
    $('myDoll').innerHTML = dollSVG(u, null, null, true);
    const t = G.aimTarget; if (t && t.alive) { $('doll').style.display = 'block'; $('doll').innerHTML = dollSVG(t, locate(t, G.aimPoint, true), facingOf(t, G.aimPoint)); } else $('doll').style.display = 'none';
    $('static').style.display = player.headDead ? 'block' : 'none';
  } else { $('plantTag').style.display = 'none'; $('doll').style.display = 'none'; }
  if (player.heavy) {   // the piloted body's weapon readiness: LMB / RMB / Q
    const w = player.hudW || [[1, 'RDY'], [1, 'RDY'], [1, 'RDY']];
    if (player.unit.lock.L) w[0] = [w[0][0], 'LOCK']; if (player.unit.lock.R) w[1] = [w[1][0], 'LOCK'];
    setBar(el.bHeat, w[0][0], w[0][1] === 'HOT'); el.tHeat.textContent = w[0][1]; setBar(el.bCan, w[1][0]); el.tCan.textContent = w[1][1]; setBar(el.bAA, w[2][0]); el.tAA.textContent = w[2][1];
  } else {
  setBar(el.bHeat, player.fuel, player.fuelLock || player.fuel < 0.2); el.tHeat.textContent = player.fuelLock ? 'LOW' : (player.fuel * 100).toFixed(0);
  setBar(el.bCan, 1 - Math.max(0, player.cannonCd) / 0.85); el.tCan.textContent = player.cannonCd <= 0 ? 'RDY' : '...';
  setBar(el.bAA, 1 - player.aaReload / 7, player.aaReload > 0); el.tAA.textContent = player.aaReload > 0 ? player.aaReload.toFixed(1) : 'RDY';
  }
  const used = 1 - player.fuel, a = 0.75 * Math.PI * 2 * used, r = 34; el.heatPath.setAttribute('d', used > 0.02 ? `M38,${38 + r} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${(38 - Math.sin(a) * r).toFixed(1)},${(38 + Math.cos(a) * r).toFixed(1)}` : '');
  el.heatPath.setAttribute('stroke', player.fuelLock ? '#ff3010' : '#ff9a30');
  const aw = !!G.allyWarn; if (aw !== awShown) { awShown = aw; $('ret').classList.toggle('ally', aw); $('allyWarn').style.display = aw ? 'block' : 'none'; }
  const st = G.stats;
  el.kills.textContent = `KILLS  INF ${st.kInf}  ARMOUR ${st.kTank}  AIR ${st.kAir}  ENGINES ${st.kScout || 0}`;
  $('ffTxt').textContent = st.ff ? `ALLIED LOSSES TO YOU: ${st.ff}` : '';
  // the front follows the streets and, equally, which side's colossi are still standing
  let ca = 0, ce = 0; for (const c of colossi) if (c.alive) { const v = (c.hp + c.shieldHP / FSUM) / (COL_HP + COL_SHIELD); if (c.side === 0) ca += v; else ce += v; }
  // ...and on what is left standing on each side, whoever killed it
  const ua = units.count(0) + units.countTanks(0) * 8, ue = units.count(1) + units.countTanks(1) * 8;
  const bz = 0.5 + 0.5 * (G.bastions[0].hp - G.bastions[1].hp) / 8000;   // the line moves with the bastions' fortunes too
  const adv = 0.3 * clamp((300 - units.frontZ(0)) / 800, 0, 1) + 0.3 * (ca + ce > 0 ? ca / (ca + ce) : 0.5) + 0.1 * (ua + ue > 0 ? ua / (ua + ue) : 0.5) + 0.3 * clamp(bz, 0, 1);
  el.frontTxt.innerHTML = `FRONT ADVANCE ${(adv * 100).toFixed(0)}%<br>VIGIL  ${units.count(0)} inf / ${units.countTanks(0)} armour / ${scouts.count(0)} scouts / ${colossi.filter(c => c.side === 0 && c.alive).length} colossi<br>SYNOD  ${units.count(1)} inf / ${units.countTanks(1)} armour / ${scouts.count(1)} scouts / ${colossi.filter(c => c.side === 1 && c.alive).length} colossi`;
  if (G.threat) { el.threat.style.display = 'block'; el.threatBar.style.width = (G.threat.k * 100).toFixed(0) + '%'; el.threat.firstElementChild.textContent = G.threat.col.name + ' has seen you'; } else el.threat.style.display = 'none';
  el.melta.style.display = G.meltaWarn > 0 ? 'block' : 'none';
  el.dead.style.display = player._dead ? 'flex' : 'none';
  el.fps.textContent = `${G.fps.toFixed(0)} fps  x${curPR.toFixed(2)}\n${units.N} infantry  ${units.TN} tanks  ${air.list.length} aircraft\n${city.counts.buildings} buildings`;
}

// ---------- command: zone rings, lock brackets, the tactical view ----------
const lockL = $('lockL'), lockR = $('lockR'), tacEl = $('tac'), tacCur = $('tacCursor'), tacAus = new Auspex(G, 'tacCv', 600);
G.tac = { group: 1, cx: 300, cy: 300, drag: null }; G.tacAus = tacAus; let tacSize = 600;
const zg = new THREE.RingGeometry(0.975, 1, 64); zg.rotateX(-Math.PI / 2); const zf = new THREE.CircleGeometry(1, 48); zf.rotateX(-Math.PI / 2);
const ZC = [[2.0, 1.2, 0.35], [0.45, 2.0, 0.4]];   // faction glow as HDR: Vigil amber, Synod green
const zm = new THREE.MeshBasicMaterial({ color: new THREE.Color(...ZC[0]), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
const zfm = new THREE.MeshBasicMaterial({ color: new THREE.Color(...ZC[0]), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const zoneLines = [0, 1, 2].map(() => { const l = new THREE.Group(); const a = new THREE.Mesh(zg, zm), b = new THREE.Mesh(zf, zfm); b.position.y = -0.05; l.add(a, b); l.visible = false; l.frustumCulled = false; scene.add(l); return l; });
function updateZones() {
  let n = 0; const u = player.heavy ? player.unit : null, put = z => { const l = zoneLines[n++]; l.visible = true; l.position.set(z.x, 0.4, z.z); l.scale.set(z.r, 1, z.r); };
  zm.opacity = 0.7 + 0.3 * Math.sin(G.time * 5);   // the ring pulses
  if (u) { for (const z of u.zones) put(z); if (G.zonePreview) put(G.zonePreview); }
  for (; n < 3; n++) zoneLines[n].visible = false;
}
function tacOpen() { $('tacVig').style.display = 'block'; document.getElementById('hud').classList.add('tacOn'); document.getElementById('auspex').style.visibility = 'hidden'; tacSize = Math.min(640, Math.floor(innerHeight * 0.82)); tacEl.style.display = 'block'; tacEl.style.width = tacEl.style.height = tacSize + 'px'; $('tacCv').style.width = $('tacCv').style.height = tacSize + 'px'; G.tac.cx = G.tac.cy = tacSize / 2; G.tac.drag = null; tacMove(0, 0); tacAus.acc = 1; try { G.sfx.slow(true); } catch (e) { /* no audio */ } }
function tacClose() { $('tacTip').style.display = 'none'; $('tacVig').style.display = 'none'; document.getElementById('hud').classList.remove('tacOn'); document.getElementById('auspex').style.visibility = ''; tacEl.style.display = 'none'; G.tac.drag = null; G.zonePreview = null; try { G.sfx.slow(false); } catch (e) { /* no audio */ } }
function tacMove(dx, dy) {   // the virtual cursor: pointer lock stays on, the mouse deltas drive it
  const t = G.tac; t.cx = clamp(t.cx + dx, 0, tacSize); t.cy = clamp(t.cy + dy, 0, tacSize); tacCur.style.left = t.cx + 'px'; tacCur.style.top = t.cy + 'px';
  if (t.drag && tacAus.tf) { const f = tacAus.tf.W / tacSize, len = Math.hypot(t.cx - t.drag.px, t.cy - t.drag.py); G.zonePreview = { x: t.drag.x, z: t.drag.z, r: clamp(len * f / tacAus.tf.s, 20, 90) }; }
}
function tacPick() {   // the enemy glyph under the virtual cursor, as a lockable entity
  const t = G.tac, tf = tacAus.tf; if (!tf) return null; const f = tf.W / tacSize; let best = null, bd = 16; const px = t.cx * f, py = t.cy * f;
  const test = (k, r, x, z) => { const m = tacAus.toMap(x, z), d = Math.hypot(m.x - px, m.y - py) / f; if (d < bd) { bd = d; best = { k, r }; } };
  for (const s of G.scouts.list) if (s.side === 1 && s.state === 'alive') test('scout', s, s.pos.x, s.pos.z);
  for (const tk of G.units.tanks) if (tk.side === 1 && tk.alive) test('tank', tk, tk.x, tk.z);
  for (const q of G.units.squads) if (q.side === 1 && q.alive > 0) test('squad', q, q.lane, q.z);
  for (const L of [G.colossi, G.hierarchs, G.harrows]) for (const e of L) if (e.side === 1 && e.alive) test('eng', e, e.pos.x, e.pos.z);
  for (const st of G.structs) if (st.side === 1 && st.alive) test('struct', st, st.pos.x, st.pos.z);
  for (const a of G.air.list) if (a.side === 1 && a.alive && !a.falling) test('air', a, a.pos.x, a.pos.z);
  return best;
}
const _tq = new THREE.Vector3();
function tacWorld() { const tf = tacAus.tf; if (!tf) return null; const f = tf.W / tacSize; return tacAus.toWorld(G.tac.cx * f, G.tac.cy * f); }   // the Tab cursor on the ground
function orderCtx() {   // what is under the crosshair (or the Tab cursor): an enemy engine, an objective site, or ground
  if (G.tactical) { const w = tacWorld(), h = tacPick(); return { eng: h && h.k === 'eng' ? h.r : null, x: w ? w.x : player.pos.x, z: w ? w.z : player.pos.z }; }
  const p = G.aimPoint, h = G.aimHit; return { eng: G.aimTarget, site: h && h.type === 'struct' && h.ref.kind === 'site' ? h.ref : null, x: p.x, z: p.z };
}
function nailPoint() { if (G.tactical) return tacWorld(); return { x: G.aimPoint.x, z: G.aimPoint.z }; }
function tacMouse(e, down) {
  const t = G.tac, tf = tacAus.tf; if (!tf) return; const f = tf.W / tacSize, g = t.group;
  if (down) {
    if (e.button === 2) { if (g === 1) G.cmd.push({ t: 'unlock', arm: 'L' }); else if (g === 2) G.cmd.push({ t: 'unlock', arm: 'R' }); else if (g === 3) G.cmd.push({ t: 'queue', pt: null }); else G.cmd.push({ t: 'clearZones' }); return; }
    if (e.button !== 0) return;
    const hit = tacPick();
    if (g === 1 || g === 2) { if (hit) G.cmd.push({ t: 'lock', arm: g === 1 ? 'L' : 'R', ent: hit }); }
    else if (g === 3) { if (hit) { tpos(hit, _tq); G.cmd.push({ t: 'queue', pt: { x: _tq.x, y: _tq.y, z: _tq.z } }); } else { const w = tacAus.toWorld(t.cx * f, t.cy * f); G.cmd.push({ t: 'queue', pt: { x: w.x, y: 0.5, z: w.z } }); } }
    else if (hit && hit.k === 'eng') G.cmd.push({ t: 'focus', ref: hit.r });
    else { const w = tacAus.toWorld(t.cx * f, t.cy * f); t.drag = { x: w.x, z: w.z, px: t.cx, py: t.cy }; }
  } else if (e.button === 0 && t.drag) {
    const d = t.drag, len = Math.hypot(t.cx - d.px, t.cy - d.py); t.drag = null; G.zonePreview = null;
    if (len > 6) G.cmd.push({ t: 'zone', x: d.x, z: d.z, r: clamp(len * f / tf.s, 20, 90) });
  }
}

// ---------- boot ----------
const WARM = qs.has('warm') ? +qs.get('warm') : 20;
const colRows = colossi.map(c => { const d = document.createElement('div'); d.className = 'col ' + (c.side ? 'foe' : 'ally'); d.innerHTML = '<span></span><div class="cb sh"><i></i></div><div class="cb hp"><i></i></div>'; el.cols.appendChild(d); return d; });
const hierRows = hierarchs.map(c => { const d = document.createElement('div'); d.className = 'col sm ' + (c.side ? 'foe' : 'ally'); d.innerHTML = '<span></span><div class="cb sh"><i></i></div><div class="cb hp"><i></i></div>'; el.cols.appendChild(d); return d; });
const harRows = harrows.map(c => { const d = document.createElement('div'); d.className = 'col sm ' + (c.side ? 'foe' : 'ally'); d.innerHTML = '<span></span><div class="cb sh"><i></i></div><div class="cb hp"><i></i></div>'; el.cols.appendChild(d); return d; });
const idle = { fwd: 0, turn: 0, mdx: 0, mdy: 0, fire1: false, fire2: false, aa: false };
player.spawn(40, 205); G.noHunt = true;
camera.position.set(40, 30, 240);
for (let i = 0; i < WARM * 20; i++) step(0.05, idle);
G.noHunt = false; player.spawn(40, 205); _piv.set(40, 15, 205);   // spawns in the class chosen by ?class=
const auspex = G.auspex = new Auspex(G);
if (SHOT) setupShot(G, SHOT);
// compile every material up front (hidden beams, shields, searchlights) so first use does not hitch
{ const hid = []; scene.traverse(o => { if (!o.visible) { hid.push(o); o.visible = true; } }); renderer.setRenderTarget(pipRT); renderer.compile(scene, camera); renderer.setRenderTarget(null); renderer.compile(scene, camera); for (const o of hid) o.visible = false; }
G.frames = 0;
G.ready = true;

let last = performance.now(), fAcc = 0, fN = 0, resAcc = 0, resN = 0, goodT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
  fAcc += dt; fN++; if (fAcc > 0.5) { G.fps = fN / fAcc; fAcc = 0; fN = 0; }
  // dynamic resolution: shed pixels when the GPU cannot hold ~60, creep back when it can
  resAcc += dt; resN++;
  if (resAcc > 1 && !SHOT) {
    const f = resN / resAcc; resAcc = 0; resN = 0; let pr = curPR;
    if (f < 50) { pr = Math.max(basePR * 0.55, curPR * 0.87); goodT = 0; } else if (f > 57.5) { if (++goodT >= 5 && curPR < basePR) { pr = Math.min(basePR, curPR * 1.07); goodT = 2; } } else goodT = 0;
    if (pr !== curPR) { curPR = pr; renderer.setPixelRatio(pr); composer.setPixelRatio(pr); }
  }
  G.pr = curPR;
  const inp = G.input;
  if (G.over) { for (const k in keys) keys[k] = false; lmb = rmb = false; mdx = mdy = 0; }
  if (!SHOT && !G.scripted) {
    inp.fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0); inp.turn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
    inp.fire1 = lmb; inp.fire2 = rmb; inp.aa = !!(keys.KeyQ || (keys.KeyF && !player.heavy) || (keys.MMB && !player.heavy));   // heavies: MMB locks an arm instead, F gives an order
    inp.sprint = !!(keys.ShiftLeft || keys.ShiftRight); inp.spear = !!keys.KeyE && !player.heavy;   // heavies: E is the war horn
    inp.mdx = mdx; inp.mdy = mdy;
    if (!G.started) { inp.fwd = inp.turn = 0; inp.fire1 = inp.fire2 = inp.aa = inp.sprint = inp.spear = false; inp.mdx = inp.mdy = 0; }
  }
  mdx = mdy = 0;
  if (G.shot) G.shot.update(dt, inp);
  // command controls (heavy classes only): G paints a fire zone, Alt+Q fires the carapace weapon at it, a Tab tap toggles the tactical view at 0.3 timescale
  const wasTac = G.tactical; if (!(G.started && player.heavy && !player._dead && !G.over) || player.cls !== tacCls) tacToggle = false; tacCls = player.cls;   // death, end screen or a class switch closes it
  G.tactical = !!(G.started && player.heavy && !player._dead && !G.over && (tacToggle || G.tacForce));
  inp.zoneHeld = !!(player.heavy && !G.tactical && keys.KeyG); inp.rawdy = inp.mdy; inp.alt = !!(keys.AltLeft || keys.AltRight);
  if (G.tactical !== wasTac) { if (G.tactical) { lmb = rmb = false; tacOpen(); } else tacClose(); }
  if (G.tactical) { tacMove(inp.mdx, inp.mdy); inp.mdx = inp.mdy = 0; inp.fire1 = inp.fire2 = inp.aa = inp.zoneHeld = false; }
  G.timeScale = G.tactical ? 0.3 : 1;
  const c0 = performance.now();
  step(dt * G.timeScale, inp);
  const c1 = performance.now();
  updateCamera(dt);
  skyMat.uniforms.uTime.value = G.time; skyMat.uniforms.uFlash.value = G.skyFlash;
  // PiP pass
  if (G.pipAlpha > 0.01 && (G.frames & 1)) {      // inset renders at half rate
    fx.setScale(270 * 0.5 / Math.tan(pipCam.fov * Math.PI / 360));
    sky.position.copy(pipCam.position);
    renderer.setRenderTarget(pipRT); renderer.clear(); renderer.render(scene, pipCam); renderer.setRenderTarget(null);
    sky.position.copy(camera.position);
  }
  fx.setScale(renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360));
  composer.render();
  if (G.pipAlpha > 0.01) { pipQuad.material.opacity = G.pipAlpha; renderer.clearDepth(); renderer.render(oScene, oCam); }
  updateHUD(dt); if (hudOn) auspex.update(dt); if (G.tactical) tacAus.update(dt); updateZones();
  G.cpuSim = c1 - c0; G.cpuFrame = performance.now() - c0;
  G.frames = (G.frames || 0) + 1;
}
requestAnimationFrame(frame);
