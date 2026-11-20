// HUD: DOM panels (objectives, flight data, actions, resources) + a WebGL navball drawn
// into the bottom-left corner of the main canvas.
import * as THREE from 'three';
import { BODIES } from './bodies.js';
import { OBJECTIVES, WARP } from './world.js';
import { nextApoapsisTime, nextPeriapsisTime } from './orbits.js';
import { AP_NAMES } from './autopilot.js';

const $ = (id) => document.getElementById(id);

export function fmtDist(m) {
  const a = Math.abs(m);
  if (a < 1000) return `${m.toFixed(a < 100 ? 1 : 0)} m`;
  if (a < 1e6) return `${(m / 1000).toFixed(a < 1e5 ? 1 : 0)} km`;
  return `${(m / 1e6).toFixed(2)} Mm`;
}
export function fmtSpeed(v) { return Math.abs(v) < 1000 ? `${v.toFixed(1)} m/s` : `${(v / 1000).toFixed(2)} km/s`; }
export function fmtDur(s) {
  if (!isFinite(s)) return '-';
  s = Math.max(0, s);
  if (s < 90) return `${s.toFixed(0)} s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
function fmtUT(t) {
  const d = Math.floor(t / 86400), h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60;
  return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const HINTS = {
  soi: 'Press H: transfer assist waits for the window, burns and coasts. Open the map (M) to watch the encounter.',
  orbit: 'Press C to circularize at the next apsis, or capture manually with SAS retrograde.',
  undock: 'Press U to undock the lander (a revert point is saved).',
  land: 'Lander: press L. The assist targets the nearest beacon and handles the suicide burn.',
  drill: 'Land inside a blue beacon ring (or press F after landing and drive in), then press G to drill.',
  refine: 'Press R to refine ore into fuel + oxidizer (1 : 1.2 mix, landed or in orbit). Extend radiators (K) and panels (J).',
  lift: 'Press B for an automatic ascent timed to the carrier, or fly it yourself (Z, SAS prograde).',
  dock: 'Press V for rendezvous assist. Within 50 m at under 2 m/s relative = auto-dock.',
  offload: 'Docked: I offloads ore to the carrier, R (carrier) refines it, Y refuels the lander.',
};

const ICONS = {
  carrier: `<svg viewBox="0 0 160 70"><g fill="none" stroke="#bfe6ff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M10 35 L36 24 L112 24 L150 35 L112 46 L36 46 Z"/><path d="M36 24 L28 8 L62 24 M36 46 L28 62 L62 46"/><path d="M12 29 L2 26 M12 41 L2 44"/><path d="M64 24 L64 46 M98 26 L98 44"/></g><circle cx="146" cy="35" r="2.6" fill="#7fd6ff"/></svg>`,
  lander: `<svg viewBox="0 0 160 70"><g fill="none" stroke="#bfe6ff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"><path d="M10 14 L134 14"/><path d="M20 14 L26 20 M60 14 L66 20 M100 14 L106 20"/><rect x="30" y="20" width="72" height="22" rx="2"/><rect x="102" y="26" width="26" height="16" rx="2"/><rect x="22" y="42" width="112" height="7" rx="2"/><path d="M62 20 L62 10 L74 10 L74 20"/><path d="M30 28 L8 24 L8 38 L30 36"/><path d="M128 44 L140 44 L140 58 L134 64 L128 58"/><circle cx="40" cy="57" r="8"/><circle cx="78" cy="57" r="8"/><circle cx="116" cy="57" r="8"/><ellipse cx="62" cy="31" rx="10" ry="5"/></g></svg>`,
};

// ------------------------------------------------------------------------------------- navball
function navTexture() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const TAU = Math.PI * 2;
  for (let py = 0; py < H; py++) {
    const theta = ((py + 0.5) / H) * Math.PI;
    const pitch = Math.PI / 2 - theta;                    // +90 up
    const pdeg = pitch * 180 / Math.PI;
    for (let px = 0; px < W; px++) {
      const phi = ((px + 0.5) / W) * TAU;
      const x = -Math.cos(phi) * Math.sin(theta), z = Math.sin(phi) * Math.sin(theta);
      const hdg = ((Math.atan2(x, -z) * 180 / Math.PI) + 360) % 360; // east=x, north=-z
      let r, gg, b;
      if (pdeg >= 0) { const k = pdeg / 90; r = 120 - 92 * k; gg = 192 - 110 * k; b = 245 - 80 * k; }
      else { const k = -pdeg / 90; r = 206 - 70 * k; gg = 118 - 66 * k; b = 36 - 18 * k; }
      let line = 0;
      const pm = Math.abs(pdeg) % 10, dp = Math.min(pm, 10 - pm);
      if (dp < 0.35) line = Math.max(line, 0.35);
      if (Math.abs(pdeg) < 0.7) line = 1;
      const hm = hdg % 30, dh = Math.min(hm, 30 - hm);
      if (dh < 0.45 && Math.abs(pdeg) < 3.5) line = Math.max(line, 0.7);
      if (dh < 0.3 && Math.abs(pdeg) < 82) line = Math.max(line, 0.12);
      const i = (py * W + px) * 4;
      d[i] = r + (255 - r) * line; d[i + 1] = gg + (255 - gg) * line; d[i + 2] = b + (255 - b) * line; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // labels (drawn mirrored: the ball is shown in pilot view)
  const posOf = (hdgDeg, pitchDeg) => {
    const h = hdgDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
    const e = Math.sin(h) * Math.cos(p), n = Math.cos(h) * Math.cos(p), u = Math.sin(p);
    const xl = e, yl = u, zl = -n;
    const phi = (Math.atan2(zl, -xl) + TAU) % TAU, th = Math.acos(yl);
    return [(phi / TAU) * W, (th / Math.PI) * H];
  };
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const txt = (s, hd, pt, size, col) => {
    const [x, y] = posOf(hd, pt);
    g.save(); g.translate(x, y); g.scale(-1, 1); g.fillStyle = col; g.font = `600 ${size}px Segoe UI, Arial`; g.fillText(s, 0, 0); g.restore();
  };
  for (let hd = 0; hd < 360; hd += 30) {
    const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[hd] || String(hd / 10).padStart(2, '0');
    txt(lab, hd, 7, hd % 90 === 0 ? 30 : 20, hd % 90 === 0 ? '#ffffff' : 'rgba(255,255,255,0.85)');
  }
  for (const p of [20, 40, 60]) for (const hd of [0, 90, 180, 270]) { txt(String(p), hd + 6, p, 15, 'rgba(255,255,255,0.8)'); txt(String(p), hd + 6, -p, 15, 'rgba(255,255,255,0.8)'); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function markerTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  const col = { pro: '#7dff9c', retro: '#7dff9c', normal: '#c58bff', antinormal: '#c58bff', radial: '#6fe3ff', antiradial: '#6fe3ff', target: '#ff7ad9', antitarget: '#ff7ad9' }[kind];
  g.strokeStyle = col; g.fillStyle = col;
  g.shadowColor = '#000'; g.shadowBlur = 4;
  if (kind === 'pro' || kind === 'retro') {
    g.beginPath(); g.arc(32, 32, 13, 0, 7); g.stroke();
    if (kind === 'pro') { g.beginPath(); g.arc(32, 32, 3.5, 0, 7); g.fill(); g.beginPath(); g.moveTo(32, 19); g.lineTo(32, 6); g.moveTo(19, 32); g.lineTo(6, 32); g.moveTo(45, 32); g.lineTo(58, 32); g.stroke(); }
    else { g.beginPath(); g.moveTo(22, 22); g.lineTo(42, 42); g.moveTo(42, 22); g.lineTo(22, 42); g.stroke(); }
  } else if (kind === 'normal' || kind === 'antinormal') {
    g.beginPath(); if (kind === 'normal') { g.moveTo(32, 12); g.lineTo(50, 46); g.lineTo(14, 46); } else { g.moveTo(32, 52); g.lineTo(50, 18); g.lineTo(14, 18); }
    g.closePath(); g.stroke();
    if (kind === 'antinormal') { g.beginPath(); g.moveTo(26, 30); g.lineTo(38, 30); g.stroke(); }
  } else if (kind === 'radial' || kind === 'antiradial') {
    g.beginPath(); g.arc(32, 32, 14, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(32, 18); g.lineTo(32, 46); g.moveTo(18, 32); g.lineTo(46, 32);
    if (kind === 'radial') { g.stroke(); } else { g.moveTo(32, 18); g.lineTo(32, 46); g.stroke(); }
  } else {
    g.beginPath(); g.moveTo(32, 10); g.lineTo(54, 32); g.lineTo(32, 54); g.lineTo(10, 32); g.closePath(); g.stroke();
    if (kind === 'target') { g.beginPath(); g.arc(32, 32, 3.5, 0, 7); g.fill(); } else { g.beginPath(); g.moveTo(24, 24); g.lineTo(40, 40); g.moveTo(40, 24); g.lineTo(24, 40); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const E = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3(), T = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
function enu(r, out) {
  U.copy(r).normalize();
  N.set(0, 0, 1).addScaledVector(U, -U.z);
  if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(U, -U.x);
  N.normalize();
  E.crossVectors(N, U);
  return out;
}

/** nearest ore beacon to a landed vessel: distance (m), relative bearing (rad, + = right) and compass bearing (deg) */
function nearestSite(v) {
  const B = BODIES.moon;
  if (v.body !== 'moon' || !v.landedDir) return null;
  let best = null;
  for (const s of B.sites) {
    const ang = Math.acos(Math.min(1, v.landedDir.dot(s.dir)));
    const d = ang * B.radius;
    if (!best || d < best.d) best = { s, d };
  }
  const up = v.landedDir;
  const to = best.s.dir.clone().addScaledVector(up, -best.s.dir.dot(up));
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(v.q); f.addScaledVector(up, -f.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(f, up); // pilot's right (body +X is the left)
  best.rel = to.lengthSq() > 1e-12 ? Math.atan2(to.dot(right), to.dot(f)) : 0;
  const N = new THREE.Vector3(0, 0, 1).addScaledVector(up, -up.z).normalize();
  const E = new THREE.Vector3().crossVectors(N, up);
  best.brg = ((Math.atan2(to.dot(E), to.dot(N)) * 180 / Math.PI) + 360) % 360;
  return best;
}

class Navball {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1.02, 1.02, 1.02, -1.02, 0.1, 10);
    this.cam.position.set(0, 0, 4);
    this.mirror = new THREE.Group(); this.mirror.scale.x = -1; this.scene.add(this.mirror);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.MeshBasicMaterial({ map: navTexture(), toneMapped: false }));
    this.mirror.add(this.ball);
    this.markers = {};
    for (const k of ['pro', 'retro', 'normal', 'antinormal', 'radial', 'antiradial', 'target', 'antitarget']) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(k), toneMapped: false, transparent: true }));
      s.scale.set(0.2, 0.2, 1); this.ball.add(s); this.markers[k] = s;
    }
    this.qS = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
    this.el = $('navball');
  }
  place(dir, sprite, ok) {
    if (!ok) { sprite.visible = false; return; }
    sprite.visible = true;
    // ENU components -> ball local frame (E, Up, -North)
    sprite.position.set(dir.dot(E), dir.dot(U), -dir.dot(N)).multiplyScalar(1.05);
  }
  render(renderer, world) {
    const v = world.active;
    if (!v) return;
    enu(v.r, null);
    const qL = _q.setFromRotationMatrix(_m.makeBasis(E, U, T.copy(N).negate()));
    this.ball.quaternion.copy(this.qS).multiply(v.q.clone().invert()).multiply(qL);
    const vel = v.v.clone();
    const hasV = vel.length() > 0.5 && v.status !== 'landed';
    if (hasV) vel.normalize();
    this.place(vel, this.markers.pro, hasV);
    this.place(vel.clone().negate(), this.markers.retro, hasV);
    const h = new THREE.Vector3().crossVectors(v.r, v.v);
    const hasH = hasV && h.lengthSq() > 1e-6; h.normalize();
    this.place(h, this.markers.normal, hasH); this.place(h.clone().negate(), this.markers.antinormal, hasH);
    this.place(U, this.markers.radial, v.status !== 'landed'); this.place(U.clone().negate(), this.markers.antiradial, v.status !== 'landed');
    const t = world.targetOf(v);
    const ok = t && t.body === v.body;
    const td = ok ? t.r.clone().sub(v.r).normalize() : null;
    this.place(td || U, this.markers.target, !!ok); this.place(td ? td.clone().negate() : U, this.markers.antitarget, !!ok);

    const rect = this.el.getBoundingClientRect();
    const size = renderer.getSize(new THREE.Vector2());
    const x = rect.left, y = size.y - rect.bottom;
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, rect.width, rect.height);
    renderer.setScissor(x, y, rect.width, rect.height);
    renderer.clearDepth();
    renderer.render(this.scene, this.cam);
    renderer.setScissorTest(false);
    renderer.autoClear = ac;
    renderer.setViewport(0, 0, size.x, size.y);
  }
}

// ------------------------------------------------------------------------------------- HUD
export class Hud {
  constructor() {
    this.nav = new Navball();
    this.objEls = [];
    const ul = $('objlist');
    for (const o of OBJECTIVES) { const li = document.createElement('li'); li.innerHTML = `<i></i><span>${o.text}</span>`; ul.appendChild(li); this.objEls.push(li); }
    this.vid = null;
    this.toastEls = [];
  }
  toast(text, kind = 'info') {
    const d = document.createElement('div');
    d.className = `toast ${kind}`; d.textContent = text;
    const box = $('toasts'); box.appendChild(d);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, kind === 'bad' ? 7000 : 4500);
  }
  update(world, ctx) {
    const v = world.active;
    const B = BODIES[v.body];
    // objectives
    let cur = -1;
    OBJECTIVES.forEach((o, i) => {
      const done = !!world.done[o.id];
      this.objEls[i].className = done ? 'done' : (cur < 0 ? (cur = i, 'cur') : '');
    });
    $('objhint').textContent = cur >= 0 ? HINTS[OBJECTIVES[cur].id] : 'All objectives complete. Fly free, or reload (F9) to run the loop again.';

    // flight data
    const landed = v.status === 'landed';
    const alt = world.altitude(v) - v.spec.groundOffset;
    $('f-alt').textContent = fmtDist(alt);
    const speed = v.v.length();
    $('f-vlabel').textContent = landed || (v.body === 'moon' && alt < 8000) ? 'Surface speed' : 'Velocity';
    $('f-vel').textContent = fmtSpeed(speed);
    const el = v.orbit;
    if (el && v.status === 'flying') {
      $('f-ap').textContent = el.hyper ? 'escape' : fmtDist(el.ra - B.radius);
      $('f-pe').textContent = fmtDist(el.rp - B.radius);
      const t = world.UT, tp = nextPeriapsisTime(el, t), ta = nextApoapsisTime(el, t);
      const useP = el.hyper || tp <= ta;
      $('f-tlabel').textContent = useP ? 'Time to Pe' : 'Time to Ap';
      $('f-t').textContent = (useP && tp < t) ? 'past' : fmtDur((useP ? tp : ta) - t);
    } else { $('f-ap').textContent = '-'; $('f-pe').textContent = '-'; $('f-tlabel').textContent = 'Next apsis'; $('f-t').textContent = '-'; }
    const rh = v.r.clone().normalize();
    const vs = v.v.dot(rh);
    $('r-vs').classList.toggle('hide', !(v.body === 'moon' && alt < 30000));
    $('f-vs').textContent = `${vs >= 0 ? '+' : ''}${fmtSpeed(vs)}`;
    const tg = world.targetOf(v);
    $('r-tgt').classList.toggle('hide', !(tg && tg.body === v.body));
    if (tg && tg.body === v.body) $('f-tgt').textContent = `${fmtDist(tg.r.distanceTo(v.r))} / ${fmtSpeed(tg.v.distanceTo(v.v))}`;
    $('f-soi').textContent = B.name;
    $('f-ut').textContent = fmtUT(world.UT);

    // navball labels
    $('n-mode').textContent = landed || (v.body === 'moon' && alt < 8000) ? 'Surface' : 'Orbit';
    $('n-speed').textContent = fmtSpeed(speed);
    enu(v.r, null);
    const nose = v.noseWorld(new THREE.Vector3());
    let hdg = Math.atan2(nose.dot(E), nose.dot(N)) * 180 / Math.PI; if (hdg < 0) hdg += 360;
    $('n-hdg').textContent = String(Math.round(hdg) % 360).padStart(3, '0');
    $('thr-fill').style.height = `${Math.round(v.throttle * 100)}%`;
    $('thr-txt').textContent = `${Math.round(v.throttle * 100)}%`;
    for (const b of document.querySelectorAll('#sas button')) {
      const m = b.dataset.sas;
      b.classList.toggle('on', m === 'toggle' ? v.sas.on : (v.sas.on && v.sas.mode === m));
    }

    // warp
    const w = WARP[world.warpIndex];
    $('warp-label').textContent = `${w}x`;
    $('warp-sub').textContent = w === 1 ? 'REAL TIME' : (w <= 5 ? 'PHYSICS WARP' : 'ON RAILS');
    $('warpbox').classList.toggle('fast', w > 1);

    // actions availability
    const C = world.carrier, L = world.lander;
    const can = {
      undock: v === C && L.status === 'docked' && C.status === 'flying',
      xfer: v.kind === 'carrier' && v.body === 'planet' && v.status === 'flying',
      circ: v.status === 'flying' && !!v.orbit,
      land: v.kind === 'lander' && v.body === 'moon' && v.status === 'flying',
      drill: v.kind === 'lander' && landed,
      refine: v.spec.refEC > 0 && v.status !== 'docked' && v.res.ore > 1,
      refuel: L.status === 'docked' && C.status === 'flying',
      offload: L.status === 'docked' && C.status === 'flying',
      asc: v.kind === 'lander' && v.body === 'moon' && (landed || v.status === 'flying'),
      rdv: !!tg && tg.body === v.body && v.status === 'flying',
      cancel: !!v.ap,
      drive: v.kind === 'lander' && (landed || v.driving),
    };
    for (const b of document.querySelectorAll('#actbtns button')) {
      const k = b.dataset.act;
      b.classList.toggle('off', !can[k]);
      b.classList.toggle('live', (k === 'drill' && v.drilling) || (k === 'drive' && v.driving) || (k === 'refine' && v.refining) || (world.pumps.length && ((k === 'refuel' && world.pumpKind === 'refuel') || (k === 'offload' && world.pumpKind === 'offload'))) || (v.ap && v.ap.type === k));
    }

    // status chip + prompts
    const chip = $('apchip');
    if (v.ap) { chip.style.display = 'block'; chip.textContent = `${AP_NAMES[v.ap.type]}${v.ap.phase ? ` - ${v.ap.phase}` : ''}`; } else chip.style.display = 'none';
    let prompt = '';
    const sp0 = v.spec;
    const nearest = landed ? nearestSite(v) : null;
    this.updateDrive(v, nearest);
    if (landed) {
      const site = world.siteNear(v);
      if (v.drilling) prompt = `Drilling at ${site ? site.name : '...'}: ore ${Math.round(v.res.ore)} / ${v.spec.oreCap} kg`;
      else if (v.refining) prompt = `Refining: ${Math.round(v.res.fuel + v.res.ox)} / ${Math.round(v.spec.fuelCap + v.spec.oxCap)} kg propellant`;
      else if (site) prompt = `${site.name}: rich ore beneath. G drill, R refine`;
      else if (nearest && nearest.d < 3000) prompt = `${nearest.s.name} beacon ${fmtDist(nearest.d)} away: F to drive there`;
      else prompt = 'Not on an ore site (blue beacons). R refine, B ascend';
    } else if (tg && tg.body === v.body && v.status === 'flying') {
      const d = tg.r.distanceTo(v.r);
      if (d < 600) prompt = `Docking: range ${fmtDist(d)}, relative ${fmtSpeed(tg.v.distanceTo(v.v))} (need < 50 m and < 2 m/s)`;
    }
    if (!prompt && !landed && v.refining) prompt = `Refining: ore ${Math.round(v.res.ore)} kg, propellant ${Math.round(v.res.fuel + v.res.ox)} / ${Math.round(sp0.fuelCap + sp0.oxCap)} kg`;
    if (!prompt && world.pumps.length) prompt = world.pumpKind === 'refuel' ? 'Pumping propellant to the lander...' : 'Pumping ore to the carrier...';
    if (!prompt && world.status === 'running' && ctx.paused) prompt = 'PAUSED';
    $('prompt').textContent = prompt;
    // always-visible key hints for the vehicle in use
    let hint = 'F1 help';
    if (v.kind === 'lander') hint = v.driving ? 'W/S drive  A/D steer  Space brake  F exit  G drill  J panels  K radiators' : (landed ? 'J panels  K radiators  N wheels  F drive  G drill  R refine' : 'J panels  K radiators  N gear  L land  B ascend');
    else hint = 'J panels  K radiators  U undock  H transfer  C circularize';
    $('keyhint').textContent = hint;

    // vehicle panel
    if (this.vid !== v.id) { this.vid = v.id; $('vicon').innerHTML = ICONS[v.kind]; $('vname').textContent = v.name; }
    const sp = v.spec;
    $('b-fuel').style.height = `${(v.res.fuel / sp.fuelCap) * 100}%`;
    $('b-ox').style.height = `${(v.res.ox / sp.oxCap) * 100}%`;
    $('b-ore').style.height = `${sp.oreCap ? (v.res.ore / sp.oreCap) * 100 : (v.res.ore > 0 ? 100 : 0)}%`;
    $('vmass').textContent = `${(world.massOf(v) / 1000).toFixed(1)} t`;
    // electricity / heat
    $('b-ec').style.height = `${(v.ec / sp.ecCap) * 100}%`;
    $('b-heat').style.height = `${(v.heat / sp.heatMax) * 100}%`;
    $('b-ec').parentElement.classList.toggle('warn', v.ec < 0.001);
    $('b-heat').parentElement.classList.toggle('warn', v.heat > sp.heatSoft);
    const sg = (x) => `${x >= 0 ? '+' : '-'}${Math.abs(x).toFixed(1)}`;
    const ecEl = $('r-ec'), heatEl = $('r-heat');
    ecEl.textContent = `EC ${Math.round(v.ec)} ${sg(v.ecNet)}/s${v.inSun ? '' : ' SHADE'}`;
    heatEl.textContent = `HEAT ${Math.round(v.heat / sp.heatMax * 100)}% ${sg(v.heatNet)}/s`;
    ecEl.title = `power: +${v.ecGen.toFixed(1)} generated, -${v.ecUse.toFixed(1)} used, ${v.inSun ? 'in sunlight' : 'in shadow'}`;
    heatEl.title = `heat: +${v.heatGen.toFixed(1)} made, -${v.heatDis.toFixed(1)} radiated`;
    ecEl.classList.toggle('neg', v.ecNet < -0.05); heatEl.classList.toggle('neg', v.heatNet > 0.05 && v.heat > sp.heatSoft * 0.5);
    for (const b of document.querySelectorAll('#vdep button')) {
      const k = b.dataset.dep;
      b.className = '';
      if (k === 'auto') { if (world.flags.autoRetract !== false) b.className = 'on'; continue; }
      const d = v.dep[k];
      if (!d) b.className = 'na';
      else if (!d.ok) b.className = 'broken';
      else if (Math.abs(d.p - d.t) > 0.001) b.className = 'moving';
      else if (d.p > 0.5) b.className = 'on';
    }
    const wc = $('warnchip');
    let warn = '';
    const busy = v.drilling || v.refining;
    const radOut = v.dep.radiators && v.dep.radiators.p > 0.9, panOut = v.dep.panels && v.dep.panels.p > 0.9;
    if (v.ec < 0.001) warn = 'Battery empty: weak SAS, drill/refinery off. Deploy panels (J)';
    else if (busy && v.heat > sp.heatSoft) warn = `Overheating: drill/refinery throttled${radOut ? '' : '. Deploy radiators (K)'}`;
    else if (busy && v.heat > sp.heatSoft * 0.7) warn = `Heat rising${radOut ? '' : ': deploy radiators (K)'}`;
    else if (busy && v.ecNet < -0.05 && v.ec < sp.ecCap * 0.25) warn = !v.inSun ? 'In shadow: no solar power, battery draining' : `Power draining${panOut ? '' : ': deploy solar panels (J)'}`;
    else if (busy && !v.inSun) warn = 'In shadow: running on battery';
    else if (v.stress > 0) warn = 'Panels/radiators: retract! (1.5 g limit)';
    wc.style.display = warn ? 'block' : 'none'; wc.textContent = warn;
  }
  updateDrive(v, nearest) {
    const box = $('drivebox');
    if (!v.driving || !nearest) { box.style.display = 'none'; return; }
    box.style.display = 'flex';
    $('drv-arrow').firstChild; // arrow is CSS (::after)
    $('drv-arrow').style.transform = `rotate(${(nearest.rel * 180 / Math.PI).toFixed(0)}deg)`;
    const inRing = nearest.d <= nearest.s.radius;
    $('drv-txt').innerHTML = `ROVER ${fmtSpeed(v.driveSpeed)}<br>${inRing ? `Inside ${nearest.s.name}: press G to drill` : `${nearest.s.name}: ${fmtDist(nearest.d)}, bearing ${String(Math.round(nearest.brg)).padStart(3, '0')}`}`;
  }
  showCrash(world, hasRevert) {
    const el = $('crash');
    if (world.status === 'crashed') {
      $('crash-title').textContent = `${world.vessel(world.crash.vesselId).name} lost`;
      $('crash-reason').textContent = world.crash.reason;
      $('cr-revert').disabled = !hasRevert;
      el.classList.remove('hidden');
    } else el.classList.add('hidden');
  }
}
