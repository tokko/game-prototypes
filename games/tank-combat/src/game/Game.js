// Game: owns the renderer, builds the world and wires input, vehicles, weapons, effects, cameras and UI.
import { Crush } from './Crush.js';
import {
  WebGLRenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3,
  WebGLRenderTarget, HalfFloatType, ShaderMaterial,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Terrain, createApron } from '../environment/Terrain.js';
import { Sky } from '../environment/Sky.js';
import { Vegetation } from '../environment/Vegetation.js';
import { buildSettlements } from '../environment/Buildings.js';
import { buildMilitary } from '../environment/Military.js';
import { GrassRing } from '../environment/Grass.js';
import { updateAtmosphere } from '../environment/Atmosphere.js';
import { World } from './World.js';
import { Input } from './Input.js';
import { TankModel } from '../vehicles/TankModel.js';
import { TankController } from '../vehicles/TankController.js';
import { TurretController } from '../vehicles/TurretController.js';
import { WeaponSystem } from '../combat/WeaponSystem.js';
import { ProjectilePool } from '../combat/Projectile.js';
import { AMMO } from '../combat/Ammo.js';
import { predictImpact } from '../combat/Ballistics.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { GunnerCamera } from '../camera/GunnerCamera.js';
import { FlashLights } from '../effects/Particles.js';
import { SmokeSystem } from '../effects/Smoke.js';
import { ExplosionSystem } from '../effects/Explosions.js';
import { MuzzleFlash } from '../effects/MuzzleFlash.js';
import { AmbientFire } from '../effects/AmbientFire.js';
import { EnemyManager, NestController } from '../enemies/EnemyController.js';
import { DamageSystem, ARMOR } from '../combat/DamageSystem.js';
import { burnModel } from '../enemies/Wreck.js';
import { InfantrySquad } from './Infantry.js';
import { Mission } from './Mission.js';
import { FxHud } from '../ui/FxHud.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { clamp, wrapPi } from '../util/math.js';

// final colour grade (display referred): saturation 0.90, contrast 1.06 about 0.45, split tone, vignette 0.22
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 0.90);
      c = (c - 0.45) * 1.06 + 0.45;
      float lm = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, vec3(0.227, 0.275, 0.376), 0.06 * (1.0 - smoothstep(0.0, 0.35, lm)));
      c = mix(c, vec3(1.0, 0.886, 0.722), 0.05 * smoothstep(0.65, 1.0, lm));
      c *= 1.0 - 0.22 * smoothstep(0.45, 1.05, length(vUv - 0.5) * 1.414);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

const BASE_FOV = 62;
const SENS = 0.0022;

export class Game {
  constructor(container, hudRoot) {
    const params = new URLSearchParams(location.search);
    this._t0 = performance.now();
    this.debugRun = params.has('run') || params.has('demo');
    this.demo = params.has('demo');
    this.warp = parseInt(params.get('warp') || '1', 10);
    this.until = parseFloat(params.get('until') || '0');
    this.provoke = params.has('provoke'); // dev: alert every enemy at t=1 s
    this.god = params.has('god'); // dev: the player's hull never drops below full (engagement tests)
    this.teamSmokeAt = params.has('teamsmoke') ? -1 : 0; // dev: smoke screens in front of every ATGM team 0.25 s after the first missile launch
    this.smokeAt = params.has('smoke') ? params.get('smoke').split(',').map(Number) : []; // dev: deploy smoke at these sim times
    this.dieAt = parseFloat(params.get('die') || '0'); // dev: destroy the player at sim time T (tests the end screen)
    this.elog = params.has('elog'); // dev: log enemy states / fire / hits on the player
    this.debugHud = params.has('debug'); // shows the frame/time toast

    // ---- renderer / scene ----
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.info.autoReset = false; // reset once per frame so calls/triangles cover every pass
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.3, 5200);
    this.camera.rotation.order = 'YXZ';

    // ---- environment ----
    this.terrain = new Terrain(1337);
    this.world = new World(this.terrain);
    this.crush = new Crush(this.world); // knock-down visuals for crushable obstacles (must exist before the builders run)
    this.scene.add(this.terrain.createMesh(), createApron());
    this.sky = new Sky(this.scene, renderer);
    const settlements = buildSettlements(this.world, this.terrain);
    const military = buildMilitary(settlements, this.world, this.terrain);
    settlements.finish(); // merge all static structures (one mesh per material)
    this.scene.add(settlements.group, military.group);
    this.vegetation = new Vegetation(this.world, this.terrain, settlements.footprints.concat(military.exclusions), renderer);
    this.scene.add(this.vegetation.group);
    this.terrain.stampTreeShadows(this.vegetation.trees);
    this.grass = new GrassRing(this.terrain, this.vegetation.atlas);
    this.scene.add(this.grass.mesh);

    // post: MSAA half-float scene -> tone map + sRGB (OutputPass) -> grade
    {
      const pr = renderer.getPixelRatio(), w = window.innerWidth, h = window.innerHeight;
      const target = new WebGLRenderTarget(Math.floor(w * pr), Math.floor(h * pr), { type: HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(renderer, target);
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new OutputPass());
      this.composer.addPass(new ShaderPass(new ShaderMaterial({ uniforms: GradeShader.uniforms, vertexShader: GradeShader.vertexShader, fragmentShader: GradeShader.fragmentShader, depthTest: false, depthWrite: false })));
    }

    // ---- player ----
    const start = { ...this.terrain.startPos };
    if (params.has('at')) { const a = params.get('at').split(',').map(Number); start.x = a[0]; start.z = a[1]; } // dev: ?at=x,z
    this.model = new TankModel('player');
    this.scene.add(this.model.root);
    this.tank = new TankController(this.world, start.x, start.z, Math.PI); // facing north
    this.turret = new TurretController(this.model);
    this.tank.syncModel(this.model);
    this.model.root.updateMatrixWorld(true);

    // ---- effects ----
    this.lights = new FlashLights(this.scene, 3);
    this.smoke = new SmokeSystem(this.scene, this.terrain);
    this.explosions = new ExplosionSystem(this.scene, this.world, this.smoke, this.lights);
    this.muzzleFx = new MuzzleFlash(this.terrain, this.smoke, this.explosions, this.lights);
    this.crush.onFx = (x, y, z, kind) => {
      if (kind === 'none') return;
      if (kind === 'thud') this.smoke.dust(x, y, z, 4, 1.6, 2.5, 1.4, 0.8, 0.3);
      else if (kind === 'leaf') this.smoke.dust(x, y, z, 6, 2.4, 3, 1.8, 1.2, 0.3, [0.3, 0.4, 0.2]);
      else if (kind === 'rubble') this.smoke.dust(x, y, z, 22, 5, 6, 3.5, 2, 0.6);
      else this.smoke.dust(x, y, z, 5, 1.8, 3, 1.6, 1, 0.35);
    };
    this.tank.onCrush = (o, sp) => this.addTrauma(Math.min(0.12, 0.03 + sp * 0.008));
    this.ambient = new AmbientFire(this.world, this.smoke, this.explosions.glow);
    for (let i = 0; i < 80; i++) { // pre-warm so wreck plumes already stand when the game starts
      this.ambient.update(0.25, this.camera); this.smoke.update(0.25); this.explosions.glow.update(0.25);
    }

    // ---- combat ----
    this.projectiles = new ProjectilePool(this.scene, this.world);
    this.projectiles.onImpact = (p, hit) => this.handleImpact(p, hit);
    this.projectiles.onTrail = (p, dt) => this.grenadeTrail(p, dt);
    this.weapons = new WeaponSystem({
      model: this.model, turret: this.turret, projectiles: this.projectiles, owner: this.tank,
      hooks: {
        onFire: (def, pos, dir) => this.onCannonFired(def, pos, dir),
        onMGShot: (pos, dir) => { this.muzzleFx.mg(pos, dir); this.addTrauma(0.025); },
        onSmokeLaunch: () => this.onSmokeLaunched(),
        onGrenadeLaunch: (pos, dir) => this.onGrenadeLaunched(pos, dir),
        onMessage: (t) => this.hud.toast(t),
      },
    });

    // ---- cameras ----
    this.tpCam = new ThirdPersonCamera(this.world);
    this.optics = new GunnerCamera(BASE_FOV);
    this.aimYaw = Math.PI;
    this.aimPitch = -0.04;
    // dev flags for inspecting the model: ?dist=9&yaw=2.4&pitch=0.15 (yaw offset from north, radians)
    if (params.has('dist')) this.tpCam.distance = parseFloat(params.get('dist'));
    if (params.has('yaw')) this.aimYaw = Math.PI + parseFloat(params.get('yaw'));
    if (params.has('pitch')) this.aimPitch = parseFloat(params.get('pitch'));
    // dev flag ?look=x,z,heightAboveGround,aimYawRad,pitchRad : free camera for inspecting the environment
    if (params.has('look')) { const l = params.get('look').split(',').map(Number); this.freeCam = { x: l[0], z: l[1], h: l[2], yaw: l[3], pitch: l[4] }; }
    this.aimPoint = new Vector3(0, 0, 0);
    this.aimHit = null;
    this.rangeM = 0;
    this.trauma = 0;
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: null, collider: null, dist: 0 };
    this._v = new Vector3(); this._v2 = new Vector3(); this._dir = new Vector3(); this._sight = new Vector3();
    this._gunDir = new Vector3(); this._muzzle = new Vector3();
    this._impact = { hit: false, x: 0, y: 0, z: 0, dist: 0 };

    // ---- UI ----
    this.hud = new HUD(hudRoot);
    this.minimap = new Minimap(this.hud.minimapEl, this.world);
    this.fx = new FxHud(hudRoot);
    this.stats = { shots: 0, hits: 0, kills: 0 };
    this.startTime = 0;
    this.ended = false;
    this.trackHitT = 0;

    // ---- enemies, damage, friendly infantry, mission ----
    this.efx = {
      scene: this.scene, world: this.world, terrain: this.terrain, projectiles: this.projectiles, smoke: this.smoke,
      explosions: this.explosions, muzzleFx: this.muzzleFx, lights: this.lights,
      log: params.has('elog'),
      shake: (x, z, amt, range) => this.shakeFrom({ x, z }, amt, range),
      onDestroyed: (e, info) => this.onEnemyDestroyed(e, info),
      onTeamDestroyed: (t) => this.onEnemyDestroyed(t, null),
      onMissileLaunch: (team) => { this.fx.missileLaunch(team.x - this.tank.x, team.z - this.tank.z); if (this.teamSmokeAt === -1) this.teamSmokeAt = this.time + 0.45; },
    };
    this.strongpoint = military.strongpoint;
    this.enemies = new EnemyManager(this.efx);
    this.enemies.nest = new NestController(this.strongpoint, this.efx);
    this.damage = new DamageSystem(this.world, {
      playerShot: (type, v, part) => { this.fx.hitMarker(type); if (this.mtest) console.info('[mtest] result', type, part); },
      stat: (n) => { if (n === 'hit') this.stats.hits++; },
      playerHit: (info) => { if (this.elog) console.info('[elog] player hit', info.type, info.part, 'dmg', info.damage ? info.damage.toFixed(0) : 0, 'hp', Math.round(this.tank.health)); this.onPlayerHit(info); },
    });
    this.playerVictim = {
      ctrl: this.tank, turret: this.turret, armor: ARMOR.player, isPlayer: true, alive: true,
      takeDamage: (d, info) => this.hurtPlayer(d, info),
      trackHit: () => { this.trackHitT = 10; this.hud.toast('TRACK DAMAGED', 2); },
      alert() {},
    };
    this.damage.setPlayer(this.playerVictim);
    for (const t of this.enemies.tanks) this.damage.addVictim(t);
    for (const t of this.enemies.teams) for (const q of t.soldiers) this.damage.addSoft(q);
    this.projectiles.onGuide = (p, dt) => this.enemies.guide(p, dt, this.tank);
    this.damage.bindTarget('strongpoint');
    this.world.onTarget((ev) => this.onTargetEvent(ev));
    this.world.onExplosion((info) => { if (info.owner === this.tank) this.enemies.alertNear(info.x, info.z, 70, this.tank); });
    {
      const S = this.world.landmarks.strongpoint;
      const spots = [[-84, -505], [-88, -509], [-80, -512], [-46, -506], [-42, -510], [-50, -513]].map(([x, z]) => [x, z, Math.atan2(S.x - x, S.z - z)]);
      this.squad = new InfantrySquad(this.scene, this.terrain, spots, [[-56, -536], [-58, -566], [-60, -592]]);
      this.squad.setVisible(false);
    }
    this.mission = new Mission(this);
    if (params.has('elog')) for (const t of this.enemies.teams) console.info('[elog] team', t.id, Math.round(t.x), Math.round(t.z), 'range', t.range, 'margin to hill zone', Math.round(Math.hypot(t.x - this.mission.zones.hill.x, t.z - this.mission.zones.hill.z) - this.mission.zones.hill.r - t.range), 'm');
    this.minimap.setMarkers([]);
    this.hudState = {
      gear: 'N', rpm: 800, speed: 0, hull: 100, hullMax: 100, hullHeading: 0, viewHeading: 0,
      counts: this.weapons.counts, selected: 0, chambered: 0, loadFrac: 1, loadingIdx: -1,
      mgBelt: 0, smokeCharges: 0, smokeCooldown: 0, opticsAmount: 0, mag: 6, fov: BASE_FOV, rangeText: '----',
      marker: { visible: false, x: 0, y: 0 },
    };

    // ---- input ----
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.hud.overlay.addEventListener('click', () => this.input.requestLock());
    window.addEventListener('resize', () => this.onResize());

    console.info('[tank] world built in ' + Math.round(performance.now() - this._t0) + ' ms');
    this.time = 0;
    this.last = performance.now();
    this._eCtx = { player: this.tank, world: this.world, smoke: this.smoke };
    this._mk = [];
    const skip = parseInt(params.get('skip') || '1', 10);
    if (skip > 1) this.mission.skipTo(skip);
    if (skip > 1) this._placeForObjective(skip);
    this.mission.start(skip <= 1);
    // dev flag ?ctest=tag[,approachAngle]: drives the tank at the nearest collider of that tag (tree/fence/wall/building/pole/lamp ...)
    // from 25 m away at full throttle and logs the outcome (crushed / climbed / slid) to the console
    if (params.has('ctest')) {
      const [tag, off, mode] = params.get('ctest').split(','); // mode 'rev': after the run-in, reverse back out the way we came
      const ref = { x: this.tank.x, z: this.tank.z }, cand = [];
      for (const c of this.world.statics) {
        if (c.tag !== tag) continue;
        if (tag === 'tree' && this.world.statics.some((o) => o !== c && o.tag === 'tree' && Math.hypot(o.x - c.x, o.z - c.z) < 14)) continue;
        cand.push(c);
      }
      cand.sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z));
      const best = cand[parseInt(params.get('nth') || '0', 10)] || null; // ?nth=N picks the N-th nearest
      if (best) {
        const a = Math.PI + (parseFloat(off) || 0), L = 25;
        this.teleport(best.x - Math.sin(a) * L, best.z - Math.cos(a) * L, a);
        this.ctest = { tag, rev: mode === 'rev', c: best, t: 0, maxPitch: 0, maxLift: 0, last: 0, crushed: 0 };
        this.tank.onCrush = (o, sp) => { this.ctest.crushed++; console.info('[ctest] crushed', o.tag, 'at speed', sp.toFixed(1)); };
        this.debugRun = true;
        console.info('[ctest] target', tag, cand.length + ' candidates', best.cls, best.x.toFixed(1), best.z.toFixed(1), 'start', this.tank.x.toFixed(1), this.tank.z.toFixed(1));
      } else console.info('[ctest] no collider with tag', tag);
    }
    if (params.has('mtest')) { this.mtest = { step: parseInt(params.get('mtest') || '0', 10) || 0, t: 0, wait: 0 }; this.debugRun = true; }
    this.hud.setOverlayReady();
    if (this.debugRun) this.hud.showOverlay(false);
  }

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      // dev flag ?warp=N: run N fixed 50 ms ticks per rendered frame (headless checks on slow software GL)
      // ?until=T freezes the simulation once the sim clock passes T seconds
      const frozen = () => this.until > 0 && this.time >= this.until;
      for (let i = 1; i < this.warp; i++) if (!frozen()) this.frame(0.05, false);
      this.frame(frozen() ? 0 : this.warp > 1 ? 0.05 : dt, true);
    };
    requestAnimationFrame(loop);
  }

  // ---- mission API for later stages ----
  setMission(m, opts) { this.hud.setMission(m, opts); }

  onLockChange(locked) {
    this.hud.showOverlay(!locked);
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  // ---- weapon / impact hooks ----
  onCannonFired(def, pos, dir) {
    this.stats.shots++;
    const inOptics = this.optics.amount > 0.5;
    this.muzzleFx.fire(pos, dir, inOptics ? 0.3 : 1);
    this.addTrauma(inOptics ? 0.4 : 0.6);
    const c = Math.cos(this.turret.yaw), s = Math.sin(this.turret.yaw);
    this.tank.kick(0.13 * c, -0.09 * s, -0.22 * c);
  }

  onSmokeLaunched() {
    this.hud.toast('SMOKE DEPLOYED', 1.5);
    // the dischargers screen the hull almost at once (the grenades' own cloud builds up later)
    this.smoke.volume(this.tank.x, this.tank.y + 2, this.tank.z, 3.5, 4, 0.7, 25, 0.35);
    this.model.turret.getWorldPosition(this._v);
    for (let i = 0; i < 6; i++) {
      this.smoke.puff(this._v.x + (Math.random() - 0.5) * 3, this._v.y + 1, this._v.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 4, 1.4, 1.8, 0.4);
    }
    this.addTrauma(0.15);
  }

  onGrenadeLaunched(pos) {
    this.smoke.puff(pos.x, pos.y, pos.z, 0, 1.2, 0, 1.2, 1.2, 0.45, 0.8);
    this.explosions.glow.emit({ x: pos.x, y: pos.y, z: pos.z, life: 0.05, size0: 0.4, size1: 0.6, alpha: 1, r: 3, g: 2.4, b: 1.4, tile: 4, fadeIn: 0, fadeOut: 0.8, ground: false });
  }

  grenadeTrail(p, dt) {
    p._tr = (p._tr || 0) + dt;
    const step = p.def.trailStep || 0.04;
    while (p._tr >= step) { p._tr -= step; this.smoke.trail(p.x, p.y, p.z); }
  }

  handleImpact(p, hit) {
    const def = p.def, onTerrain = hit.kind === 'terrain';
    if (this.mtest && p.owner === this.tank) { const e1 = this.enemies.get('tank1'); console.info('[mtest] impact', def.id, hit.kind, hit.collider ? hit.collider.tag : '-', 'dist to tank1', Math.round(Math.hypot(hit.x - e1.ctrl.x, hit.z - e1.ctrl.z)), 'at', hit.x.toFixed(0), hit.y.toFixed(1), hit.z.toFixed(0), 'tank', this.tank.x.toFixed(0), this.tank.y.toFixed(1), this.tank.z.toFixed(0), 'age', p.age.toFixed(2), 'gun', this._gunDir.x.toFixed(3), this._gunDir.y.toFixed(3), this._gunDir.z.toFixed(3)); }
    if (this.elog && p.owner !== this.tank && def.kind !== 'grenade') console.info('[elog] enemy round lands', def.id, hit.kind, hit.collider ? hit.collider.tag : '-', 'dist to player', Math.round(Math.hypot(hit.x - this.tank.x, hit.z - this.tank.z)), 'dy', (hit.y - this.tank.y).toFixed(1));
    if (p.owner === this.tank && def.kind !== 'grenade') this.enemies.alertNear(hit.x, hit.z, def.kind === 'mg' ? 25 : 60, this.tank);
    const e = this.explosions;
    switch (def.kind) {
      case 'kinetic': e.kineticImpact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, onTerrain); this.shakeFrom(hit, 0.25, 80); break;
      case 'explosive': {
        e.explosion(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, def.id, onTerrain);
        this.world.emitExplosion({ x: hit.x, y: hit.y, z: hit.z, radius: def.splash, damage: def.damage, owner: p.owner, ammo: def });
        this.shakeFrom(hit, 0.7, 220);
        break;
      }
      case 'smoke': this.smoke.cloud(hit.x, hit.y, hit.z); e.kineticImpact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, onTerrain); break;
      case 'grenade': this.smoke.grenadeBurst(hit.x, hit.y, hit.z); break;
      case 'mg': e.bulletImpact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, onTerrain); break;
      default: break;
    }
  }

  shakeFrom(hit, amount, range) {
    const d = Math.hypot(hit.x - this.tank.x, hit.z - this.tank.z);
    this.addTrauma(amount * clamp(1 - d / range, 0, 1));
  }

  // dev flag ?demo: scripted inputs to exercise every system without a pointer lock
  _demoInput(t, ctl) {
    ctl.throttle = t > 1 && t < 9 ? 1 : 0;
    ctl.steer = t > 5 && t < 6.5 ? 1 : 0;
    const d = this.demoState || (this.demoState = {});
    const once = (k, at, fn) => { if (!d[k] && t > at) { d[k] = true; fn(); } };
    once('fxdemo', 0.6, () => { // dev: exercise the combat HUD pieces
      this.fx.hitMarker('kill'); this.fx.damageDir(1, -0.4, true); this.fx.damageDir(-1, 0.1, false);
      const t2 = this.enemies.get('tank1'); t2.spotted = true; t2.revealT = 30;
      this.fx.notify('OBJECTIVE COMPLETE', 'Drive along the country road', 'complete');
    });
    once('boom', 1.0, () => { // dev: HE + HEAT detonations ahead of the tank to inspect the impact effects
      const t = this.tank, fx = Math.sin(t.heading), fz = Math.cos(t.heading);
      const hx = t.x + fx * 38, hz = t.z + fz * 38, ex = t.x + fx * 62 + 14, ez = t.z + fz * 62;
      this.explosions.explosion(hx, this.terrain.getHeight(hx, hz), hz, 0, 1, 0, 'HE', true);
      this.explosions.explosion(ex, this.terrain.getHeight(ex, ez), ez, 0, 1, 0, 'HEAT', true);
    });
    once('f1', 2, () => this.weapons.fireCannon());
    once('x', 3, () => this.weapons.deploySmoke());
    once('s3', 3.5, () => this.weapons.selectAmmo(2));
    once('opt', 4.5, () => this.optics.setActive(true));
    once('f2', 8, () => this.weapons.fireCannon());
    once('opt2', 7, () => this.optics.setActive(false));
    once('s4', 10.5, () => this.weapons.selectAmmo(1));
    ctl.fireMG = t > 5 && t < 6;
    this.aimYaw = Math.PI + Math.sin(t * 0.5) * 0.6;
    this.aimPitch = -0.03 + Math.sin(t * 0.3) * 0.03;
  }

  // ---- main frame ----
  frame(dt, render = true) {
    const input = this.input;
    this.frames = (this.frames || 0) + 1;
    if (this.elog && this.frames % 100 === 0) console.info('[elog] t=' + this.time.toFixed(1), this.enemies.tanks.map((t) => t.id + ':' + t.brain.state + ':' + t.brain.detection.toFixed(2) + ':hp' + Math.round(t.hp) + '@' + Math.round(t.ctrl.x) + ',' + Math.round(t.ctrl.z) + (t.brain.relocT > 0 ? ':' + t.brain.relocMode : '')).join(' '), 'nest', this.enemies.nest.detection.toFixed(2), 'player hp', Math.round(this.tank.health), 'pos', Math.round(this.tank.x), Math.round(this.tank.z));
    if (this.debugHud && this.frames % 20 === 0) this.hud.toast('frames=' + this.frames + ' t=' + this.time.toFixed(2) + ' v=' + this.tank.speedKmh.toFixed(1) + ' calls=' + this.renderer.info.render.calls + ' tris=' + Math.round(this.renderer.info.render.triangles / 1000) + 'k', 5);
    const running = (input.locked || this.debugRun) && !this.ended;
    const sdt = running ? dt : 0;
    const edt = running || this.ended ? dt : 0; // particles keep animating on the end screens
    this.time += sdt;
    const ctl = { throttle: 0, steer: 0, brake: false, fireMG: false };

    if (running) {
      // discrete actions
      for (let i = 0; i < 4; i++) if (input.wasPressed('Digit' + (i + 1))) this.weapons.selectAmmo(i);
      if (input.mousePressed[2]) this.optics.toggle();
      if (input.wheel !== 0) this.optics.stepMagnification(input.wheel < 0 ? 1 : -1);
      if (input.wasPressed('KeyX')) this.weapons.deploySmoke();
      if (input.mousePressed[0]) this.weapons.fireCannon();

      // mouse: aim
      {
        const sens = SENS * this.optics.sensitivityScale();
        this.aimYaw = wrapPi(this.aimYaw - input.dx * sens);
        this.aimPitch = clamp(this.aimPitch - input.dy * sens, -0.45, 0.8);
      }

      ctl.throttle = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      ctl.steer = (input.isDown('KeyA') ? 1 : 0) - (input.isDown('KeyD') ? 1 : 0);
      ctl.brake = input.isDown('Space');
      ctl.fireMG = input.isDown('KeyC');
      if (this.demo) this._demoInput(this.time, ctl);
      if (this.mtest) this._mtest(sdt, ctl);
      if (this.ctest) this._ctest(sdt, ctl);
    }
    if (this.trackHitT > 0) {
      this.trackHitT -= sdt;
      ctl.throttle = 0; ctl.steer = 0; ctl.brake = true;
      if (this.trackHitT <= 0) this.hud.toast('TRACK REPAIRED', 1.5);
    }

    if (this.god) this.tank.health = this.tank.maxHealth;
    if (this.teamSmokeAt > 0 && this.time > this.teamSmokeAt) {
      this.teamSmokeAt = 0;
      this.weapons.deploySmoke(); // the player reacts to the launch warning and fires the smoke dischargers
    }
    while (this.smokeAt.length && this.time > this.smokeAt[0]) { this.smokeAt.shift(); this.weapons.deploySmoke(); }
    if (this.mtest) this.tank.health = this.tank.maxHealth; // scripted playthrough is not about surviving
    if (this.provoke && this.time > 1) { this.provoke = false; for (const t of this.enemies.tanks) t.alert(this.tank.x, this.tank.z); for (const t of this.enemies.teams) t.alert(this.tank.x, this.tank.z, true); }
    if (this.dieAt > 0 && this.time > this.dieAt) { this.dieAt = 0; this.hurtPlayer(999, {}); }
    // ---- simulation ----
    const tank = this.tank, model = this.model;
    tank.update(sdt, ctl);
    this.crush.update(sdt);
    tank.syncModel(model);
    model.updateTracks(tank.leftSpeed, tank.rightSpeed, sdt);
    model.root.updateMatrixWorld(true);

    const w = this.weapons;
    const aimDef = AMMO[w.chambered >= 0 ? w.chambered : w.selected];
    this.turret.update(sdt, this.aimPoint, aimDef.speed);
    w.update(sdt, ctl);
    this.enemies.update(sdt, this._eCtx);
    this.squad.update(sdt, this.time);
    this.mission.update(sdt);

    if (this.ended && this.winOrbit) this.aimYaw = wrapPi(this.aimYaw + dt * 0.22);
    // ---- camera ----
    this.optics.update(sdt);
    const cam = this.camera;
    const tp = this.tpCam.update(sdt, this.aimYaw, this.aimPitch, tank);
    model.sightMount.getWorldPosition(this._sight);
    this.optics.apply(cam, tp, this._sight);
    cam.rotation.set(this.aimPitch, this.aimYaw + Math.PI, 0, 'YXZ');
    if (this.freeCam) {
      const f = this.freeCam;
      cam.position.set(f.x, this.terrain.getHeight(f.x, f.z) + f.h, f.z);
      this.aimYaw = f.yaw; this.aimPitch = f.pitch;
      cam.rotation.set(f.pitch, f.yaw + Math.PI, 0, 'YXZ');
    }
    const opticsAmt = this.optics.amount;
    model.root.visible = opticsAmt < 0.96;

    // aim point: ray from the camera through the screen centre
    ThirdPersonCamera.aimDir(this._dir, this.aimYaw, this.aimPitch);
    const d = this._dir;
    const hit = this._hit;
    if (this.world.raycast(cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z, 6000, tank, hit)) {
      this.aimPoint.set(hit.x, hit.y, hit.z);
      this.aimHit = hit.kind;
    } else {
      this.aimPoint.set(cam.position.x + d.x * 3500, cam.position.y + d.y * 3500, cam.position.z + d.z * 3500);
      this.aimHit = null;
    }
    model.gunPivot.getWorldPosition(this._v);
    this.rangeM = this._v.distanceTo(this.aimPoint);

    // ---- effects / projectiles ----
    this.projectiles.update(sdt, cam);
    this.ambient.update(edt, cam);
    this.smoke.update(edt);
    this.explosions.update(edt);
    this.lights.update(edt);

    // camera shake (applied after aiming so it never affects the aim ray)
    this.trauma = Math.max(0, this.trauma - edt * 1.7);
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * (0.25 + 0.75 * (cam.fov / BASE_FOV));
      const t = this.time * 38;
      cam.rotation.x += Math.sin(t * 1.3) * 0.018 * s;
      cam.rotation.y += Math.sin(t * 1.9 + 2) * 0.018 * s;
      cam.rotation.z += Math.sin(t * 1.1 + 4) * 0.012 * s;
      cam.position.y += Math.sin(t * 2.3) * 0.12 * s * (1 - opticsAmt);
    }
    cam.updateMatrixWorld(true);

    this.sky.update(this._v.set(tank.x, tank.y, tank.z), cam, this.time);
    this.vegetation.update(cam.position, this.time, cam.fov / BASE_FOV);
    this.grass.update(cam);
    updateAtmosphere(cam, this.time);

    // ---- UI ----
    this.updateFx(sdt, dt);
    this.updateHud(sdt, dt);
    if (render) {
      this.renderer.info.reset(); this.composer.render();
      if (this.debugHud && (this._sc = (this._sc || 0) + 1) % 4 === 0) console.log('[stats] calls=' + this.renderer.info.render.calls + ' tris=' + Math.round(this.renderer.info.render.triangles / 1000) + 'k');
    }
    input.endFrame();
  }

  // ---- combat/mission events ----
  hurtPlayer(d, info) {
    const t = this.tank;
    if (this.ended) return false;
    t.health = Math.max(0, t.health - d);
    if (t.health <= 0) { this.onPlayerDestroyed(info); return true; }
    return false;
  }

  onPlayerHit(info) {
    const pen = info.type === 'pen' || info.type === 'track' || info.type === 'kill';
    if (info.from) this.fx.damageDir(info.from.x, info.from.z, pen);
    this.addTrauma(pen ? 0.9 : 0.35);
    this.tank.kick(pen ? 0.18 : 0.06, (Math.random() - 0.5) * 0.15, 0);
    if (info.type === 'nopen' && !(info.soft > 0)) this.hud.toast('NO PENETRATION', 1.2);
  }

  onPlayerDestroyed(info) {
    if (this.ended) return;
    this.ended = true;
    this.playerVictim.alive = false;
    const t = this.tank;
    burnModel(this.model);
    this.explosions.explosion(t.x, t.y + 1.5, t.z, 0, 1, 0, 'HE', true);
    this.world.smokeAnchors.push({ pos: new Vector3(t.x, t.y + 1.9, t.z), flame: true, strength: 1 });
    this.addTrauma(1);
    document.body.classList.add('dead');
    this.mission.log.push('player-destroyed');
    this.fx.showEnd({ win: false, stats: this.mission.stats(), onRestart: () => this.restart() });
  }

  win() {
    if (this.ended) return;
    this.ended = true;
    // end screen: slow orbit around the player's tank
    this.winOrbit = true;
    this.optics.setActive(false); this.optics.t = 0;
    this.tpCam.distance = 14; this.aimPitch = -0.28;
    document.body.classList.add('won');
    this.mission.log.push('win');
    this.fx.showEnd({ win: true, stats: this.mission.stats(), onRestart: () => this.restart() });
  }

  // restart = reload the page (world generation is deterministic; keeps every system perfectly clean)
  restart() { location.reload(); }

  onEnemyDestroyed(e, info) {
    this.stats.kills++;
    this.mission.log.push('kill:' + e.id);
  }

  onTargetEvent(ev) {
    if (ev.type === 'destroyed' && ev.target.id === 'strongpoint') {
      const sp = this.strongpoint, p = sp.pos;
      sp.collapse();
      this.enemies.nest.disable();
      this.explosions.explosion(p.x, p.y + 0.5, p.z, 0, 1, 0, 'HE', true);
      this.explosions.explosion(p.x + 3, p.y, p.z + 2, 0, 1, 0, 'HEAT', true);
      this.smoke.plume(p.x, p.y + 1, p.z, { dur: 3, count: 40, life: 30, size1: 16, up: 4 });
      this.stats.kills++;
      this.fx.hitMarker('kill');
      this.shakeFrom({ x: p.x, z: p.z }, 0.6, 200);
      this.mission.log.push('strongpoint-destroyed');
    }
  }

  updateFx(sdt, rawDt) {
    const cam = this.camera, items = this._mk;
    items.length = 0;
    for (const t of this.enemies.tanks) {
      if (t.lastKnown) { t.lastKnown.t -= sdt; if (t.lastKnown.t <= 0) t.lastKnown = null; }
      const noLbl = this.optics.amount > 0.5; // the sight has its own range box
      if (t.alive && t.spotted) items.push({ id: t.id, type: 'enemy', x: t.ctrl.x, y: t.ctrl.y + 4.0, z: t.ctrl.z, noLabel: noLbl });
      else if (t.alive && t.lastKnown) items.push({ id: t.id + 'h', type: 'hollow', x: t.lastKnown.x, y: t.ctrl.y + 4.0, z: t.lastKnown.z, noLabel: noLbl });
    }
    for (const t of this.enemies.teams) {
      if (t.lastKnown) { t.lastKnown.t -= sdt; if (t.lastKnown.t <= 0) t.lastKnown = null; }
      const noLbl = this.optics.amount > 0.5;
      if (t.alive && t.spotted) items.push({ id: t.id, type: 'enemy', x: t.x, y: t.y + 2.4, z: t.z, noLabel: noLbl, label: noLbl ? '' : 'ATGM' });
      else if (t.alive && t.lastKnown) items.push({ id: t.id + 'h', type: 'hollow', x: t.lastKnown.x, y: t.y + 2.4, z: t.lastKnown.z, noLabel: noLbl });
    }
    const om = this.mission.hudMarker();
    if (om) items.push(om);
    const cp = cam.position;
    this.fx.setMarkers(items, cam, (it) => Math.hypot(it.x - cp.x, it.y - cp.y, it.z - cp.z));
    this.fx.update(rawDt, this.aimYaw);
    // minimap: spotted enemies, objective, friendly infantry, route
    const mm = [];
    for (const it of items) mm.push({ x: it.x, z: it.z, type: it.type === 'obj' ? 'objective' : it.type });
    if (this.squad.soldiers[0].root.visible) for (const p of this.squad.positions) mm.push({ x: p.x, z: p.z, type: 'friendly' });
    this.minimap.setMarkers(mm);
    this.routeT = (this.routeT || 0) - rawDt;
    if (this.routeT <= 0) { this.routeT = 0.4; this.minimap.setRoute(this.mission.routePoints()); }
  }

  // dev: put the tank where objective n begins
  _placeForObjective(n) {
    const Z = this.mission.zones, e1 = this.enemies.get('tank1');
    if (n === 2) this.teleport(Z.road.x, Z.road.z, Math.PI);
    else if (n === 3 || n === 4) this.teleport(Z.hill.x, Z.hill.z, Math.atan2(e1.ctrl.x - Z.hill.x, e1.ctrl.z - Z.hill.z));
    else if (n === 5) this.teleport(-52, -400, Math.PI);
    else if (n === 6) this.teleport(Z.village.x, Z.village.z, Math.PI);
    else if (n >= 7) this.teleport(-56, -440, Math.PI);
  }

  teleport(x, z, heading) {
    const t = this.tank;
    t.x = x; t.z = z; t.heading = heading; t.speed = 0; t.yawRate = 0; t.y = this.terrain.getHeight(x, z);
    t.pitch = t.roll = t.pitchVel = t.rollVel = 0;
    this.aimYaw = heading;
  }

  // dev flag ?mtest: scripted playthrough of every objective with teleports and real shots (logs to the console)
  _ctest(dt, ctl) {
    const m = this.ctest, k = this.tank;
    m.t += dt;
    ctl.throttle = m.t > 0.5 && m.t < (m.rev ? 6 : 14) ? 1 : 0;
    if (m.rev && m.t >= 6) ctl.throttle = m.t < 18 ? -1 : 0;
    m.maxPitch = Math.max(m.maxPitch, Math.abs(k.pitch));
    m.maxLift = Math.max(m.maxLift, k.y - this.terrain.getHeight(k.x, k.z));
    if (m.t - m.last >= 1) {
      m.last = m.t;
      console.info('[ctest] t=' + m.t.toFixed(0), 'pos', k.x.toFixed(1), k.z.toFixed(1), 'v', k.speed.toFixed(1), 'hdg', k.heading.toFixed(2), 'pitchMax', m.maxPitch.toFixed(2), 'liftMax', m.maxLift.toFixed(2), 'targetActive', m.c.active, 'dist', Math.hypot(k.x - m.c.x, k.z - m.c.z).toFixed(1));
    }
  }

  _mtest(dt, ctl) {
    const m = this.mtest, ms = this.mission, Z = ms.zones, w = this.weapons;
    m.t += dt; m.wait += dt;
    const log = (...a) => console.info('[mtest]', ...a);
    const aimAt = (x, y, z) => {
      const c = this.camera.position, dx = x - this.tank.x, dz = z - this.tank.z, dy = y - (this.tank.y + 2.5);
      this.aimYaw = Math.atan2(dx, dz); this.aimPitch = Math.atan2(dy, Math.hypot(dx, dz)); void c;
    };
    const next = (why) => { log('step', m.step, why, 'objective index', ms.index, 'hp', Math.round(this.tank.health)); m.step++; m.wait = 0; };
    const idx = () => ms.index + (ms.transition ? 0.5 : 0);
    const e1 = this.enemies.get('tank1');
    switch (m.step) {
      case 0: if (m.wait > 0.5) { this.teleport(Z.road.x, Z.road.z, Math.PI); next('teleported to the road waypoint'); } break;
      case 1: if (ms.index >= 1) next('obj1 triggered'); else if (m.wait > 6) { log('FAIL obj1'); ms.skipTo(2); next('forced'); } break;
      case 2: if (ms.index === 1 && !ms.transition) { this.teleport(Z.hill.x, Z.hill.z, Math.atan2(e1.ctrl.x - Z.hill.x, e1.ctrl.z - Z.hill.z)); next('teleported to the hill'); } break;
      case 3: if (ms.index >= 2) { this.optics.setActive(true); this.optics.magIndex = 2; next('obj2 triggered; optics on'); } else if (m.wait > 6) { log('FAIL obj2'); ms.skipTo(3); next('forced'); } break;
      case 4: aimAt(e1.ctrl.x, e1.ctrl.y + 1.6, e1.ctrl.z); if (ms.index >= 3) next('obj3 identified (' + (e1.identified ? 'marked' : 'no mark') + ')'); else if (m.wait > 10) { log('FAIL identify', 'identT', ms.identT.toFixed(2)); ms.skipTo(4); next('forced'); } break;
      case 5:
        aimAt(e1.ctrl.x, e1.ctrl.y + 1.4, e1.ctrl.z);
        if (e1.alive && w.ready && m.wait > 1) { w.selectAmmo(0); if (w.chambered === 0) w.fireCannon(); }
        if (!e1.alive && ms.index >= 4) next('obj4 destroyed enemy (shots ' + this.stats.shots + ', hits ' + this.stats.hits + ', enemy state ' + e1.brain.state + ')');
        else if (m.wait > 60) { log('FAIL destroy; forcing'); e1.takeDamage(999, { def: { id: 'HEAT' }, part: 'splash' }); }
        break;
      case 6: if (ms.index === 4 && !ms.transition) { this.optics.setActive(false); this.teleport(Z.village.x, Z.village.z + 6, Math.PI); next('teleported to the village edge'); } break;
      case 7: if (ms.index >= 5) { this.teleport(-30, -480, Math.atan2(40 + 30, -545 + 480)); next('obj5 triggered'); } else if (m.wait > 6) { log('FAIL obj5'); ms.skipTo(6); next('forced'); } break;
      case 8: {
        const t = this.world.targets.get('strongpoint');
        aimAt(40, 1.5 + this.terrain.getHeight(40, -545), -545);
        if (t.alive && w.ready && m.wait > 1.5) { w.selectAmmo(2); if (w.chambered === 2) w.fireCannon(); }
        if (!t.alive) next('strongpoint destroyed with HE (hp ' + Math.round(t.hp) + ', shots ' + this.stats.shots + ')');
        else if (m.wait > 120) { log('FAIL strongpoint; forcing'); this.world.damageTarget('strongpoint', 1e6); }
        break;
      }
      case 9: if (ms.index >= 6 && !ms.transition) { this.teleport(Z.extract.x, Z.extract.z + 30, Math.PI); this.tank.health = Math.max(this.tank.health, 30); next('teleported near extraction'); } break;
      case 10: this.teleport(Z.extract.x, Z.extract.z, Math.PI); if (ms.done) next('MISSION COMPLETE flow reached; log ' + ms.log.join(',')); break;
      default: break;
    }
    void ctl; void idx;
  }

  updateHud(sdt, rawDt) {
    const s = this.hudState, tank = this.tank, w = this.weapons, cam = this.camera;
    s.gear = tank.gearLabel; s.rpm = tank.rpm; s.speed = tank.speedKmh;
    s.hull = tank.health; s.hullMax = tank.maxHealth;
    const bearing = (a) => ((((Math.PI - a) * 180) / Math.PI) % 360 + 360) % 360;
    s.hullHeading = bearing(tank.heading);
    s.viewHeading = bearing(this.aimYaw);
    s.selected = w.selected; s.chambered = w.chambered; s.loadFrac = w.loadFraction; s.loadingIdx = w.loadingType;
    s.mgBelt = w.mgBelt; s.smokeCharges = w.smokeCharges; s.smokeCooldown = w.smokeCooldown;
    document.body.classList.toggle('optics-on', this.optics.amount > 0.5);
    s.opticsAmount = this.optics.amount; s.mag = this.optics.mag; s.fov = cam.fov;
    s.rangeText = this.aimHit && this.rangeM < 6000 ? Math.round(this.rangeM) + ' m' : '----';

    // predicted fall of shot -> screen
    const def = AMMO[w.chambered >= 0 ? w.chambered : w.selected];
    this.model.muzzle.getWorldPosition(this._muzzle);
    this.turret.getGunDirection(this._gunDir);
    const g = this._gunDir, m = this._muzzle, im = this._impact;
    predictImpact(this.world, m.x, m.y, m.z, g.x, g.y, g.z, def.speed, tank, im);
    const v = this._v2.set(im.x, im.y, im.z).project(cam);
    const mk = s.marker;
    mk.visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    mk.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    mk.y = (-v.y * 0.5 + 0.5) * window.innerHeight;

    this.hud.update(rawDt, s);
    this.minimap.update(tank.x, tank.z, tank.heading, this.aimYaw);
  }
}
