// Map view overlay: conic trajectory lines per patch, Ap/Pe markers, SOI circle,
// predicted encounter and DOM labels. Positions are physics-frame, relative to `origin`.
import * as THREE from 'three';
import { BODIES } from './bodies.js';
import { sampleConic, stateAt } from './orbits.js';
import { fmtDist } from './hud.js';

const SEG = 200;
const _mr = new THREE.Vector3(), _cp = new THREE.Vector3(), _sp2 = new THREE.Vector3(), _ds = new THREE.Vector3();
const COLORS = [new THREE.Color(0.3, 1.1, 1.8), new THREE.Color(1.8, 1.0, 0.3), new THREE.Color(0.5, 1.8, 0.6), new THREE.Color(1.5, 0.5, 1.5)];
const OTHER = new THREE.Color(1.1, 1.0, 0.45);

function iconTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff';
  if (kind === 'ring') { g.beginPath(); g.arc(32, 32, 24, 0, 7); g.stroke(); }
  else if (kind === 'ves') { g.beginPath(); g.moveTo(32, 8); g.lineTo(54, 52); g.lineTo(32, 42); g.lineTo(10, 52); g.closePath(); g.fill(); }
  else if (kind === 'ap' || kind === 'pe') { g.beginPath(); g.moveTo(32, 12); g.lineTo(52, 32); g.lineTo(32, 52); g.lineTo(12, 32); g.closePath(); g.stroke(); if (kind === 'ap') { g.beginPath(); g.arc(32, 32, 4, 0, 7); g.fill(); } }
  else if (kind === 'enc') { g.beginPath(); g.arc(32, 32, 20, 0, 7); g.stroke(); g.beginPath(); g.arc(32, 32, 6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class MapView {
  constructor(parent, labelRoot) {
    this.group = new THREE.Group();
    this.group.visible = false;
    parent.add(this.group);
    this.labelRoot = labelRoot;
    this.labels = [];
    this.lines = [];
    this.sprites = [];
    this.tex = { ring: iconTexture('ring'), ves: iconTexture('ves'), ap: iconTexture('ap'), pe: iconTexture('pe'), enc: iconTexture('enc') };
    this.moonLine = this.makeLine(new THREE.Color(0.35, 0.5, 0.8), 0.5, 360);
    this.soiLine = this.makeLine(new THREE.Color(0.5, 0.65, 1.0), 0.35, 120);
    this.ghostSoi = this.makeLine(new THREE.Color(1.8, 1.0, 0.3), 0.6, 120);
    this.moonPts = sampleConic(BODIES.moon.orbit, 0, BODIES.moon.orbit.period, 360);
  }
  makeLine(color, opacity = 1, n = SEG + 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    l.frustumCulled = false; l.visible = false;
    this.group.add(l);
    return l;
  }
  sprite(kind, size, color = 0xffffff) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[kind], color, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(size, size, 1); s.renderOrder = 10;
    this.group.add(s); return s;
  }
  setVisible(v) {
    this.group.visible = v;
    this.labelRoot.style.display = v ? 'block' : 'none';
  }
  _label(i, text, cls) {
    let el = this.labels[i];
    if (!el) { el = document.createElement('div'); this.labelRoot.appendChild(el); this.labels[i] = el; }
    if (el.textContent !== text) el.textContent = text;
    el.className = `maplabel ${cls}`;
    return el;
  }
  _fillLine(line, pts, center, origin) {
    const a = line.geometry.attributes.position;
    const n = Math.min(pts.length, a.count);
    for (let i = 0; i < n; i++) a.setXYZ(i, pts[i].x + center.x - origin.x, pts[i].y + center.y - origin.y, pts[i].z + center.z - origin.z);
    line.geometry.setDrawRange(0, n);
    a.needsUpdate = true;
    line.visible = true;
  }
  /** returns nothing; draws everything for this frame */
  update(world, origin, camera, size) {
    const used = { l: 0, line: 0, spr: 0 };
    const moonAbs = world.moonState(world.UT).r;
    const proj = new THREE.Vector3();
    const place = (el, p) => { // p physics -> render -> screen
      proj.set(p.x - origin.x, p.z - origin.z, -(p.y - origin.y)).project(camera);
      if (proj.z > 1 || proj.z < -1) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.left = `${(proj.x * 0.5 + 0.5) * size.x}px`;
      el.style.top = `${(-proj.y * 0.5 + 0.5) * size.y}px`;
    };
    const lab = (text, cls, p) => { place(this._label(used.l++, text, cls), p); };
    const pxPerM = (size.y / 2) / (Math.max(1, camera.position.length()) * Math.tan((camera.fov * Math.PI / 180) / 2));
    const nextSprite = (kind, sz, color) => {
      let s = this.sprites[used.spr];
      if (!s) { s = this.sprite(kind, sz, color); this.sprites[used.spr] = s; }
      s.material.map = this.tex[kind]; s.material.color.set(color); s.scale.set(sz, sz, 1); s.visible = true;
      used.spr++; return s;
    };
    const nextLine = (color) => {
      let l = this.lines[used.line];
      if (!l) { l = this.makeLine(color); this.lines[used.line] = l; }
      l.material.color.copy(color); used.line++; return l;
    };

    // bodies
    this._fillLine(this.moonLine, this.moonPts, new THREE.Vector3(), origin);
    nextSprite('ring', 0.045, 0x9fd0ff).position.copy(new THREE.Vector3().sub(origin));
    lab(BODIES.planet.name, 'body', new THREE.Vector3(0, 0, 0));
    nextSprite('ring', 0.032, 0xcfd6e0).position.copy(moonAbs).sub(origin);
    lab(BODIES.moon.name, 'body', moonAbs);
    // ore beacons (when the moon is big enough on screen): easy to find from the map
    {
      const mrel = _mr.set(moonAbs.x - origin.x, moonAbs.z - origin.z, -(moonAbs.y - origin.y));
      const pxMoon = BODIES.moon.radius * (size.y / 2) / (Math.max(1, mrel.distanceTo(camera.position)) * Math.tan((camera.fov * Math.PI / 180) / 2));
      if (pxMoon > 35) {
        const camPhys = _cp.set(camera.position.x, -camera.position.z, camera.position.y).add(origin);
        for (const s of BODIES.moon.sites) {
          const pos = _sp2.copy(s.dir).multiplyScalar(BODIES.moon.radius).add(moonAbs);
          if (_ds.copy(camPhys).sub(moonAbs).dot(s.dir) < BODIES.moon.radius) continue; // far side
          nextSprite('enc', 0.018, 0x66d0ff).position.copy(pos).sub(origin);
          lab(s.name, 'ap', pos);
        }
      }
    }
    // moon SOI
    const soiPts = [];
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2; soiPts.push(new THREE.Vector3(Math.cos(a) * BODIES.moon.soi, Math.sin(a) * BODIES.moon.soi, 0)); }
    this._fillLine(this.soiLine, soiPts, moonAbs, origin);
    this.ghostSoi.visible = false;

    // vessels
    for (const v of world.vessels) {
      if (v.status === 'docked' || v.status === 'crashed') continue;
      const active = v.id === world.activeId;
      const pos = world.absPos(v, new THREE.Vector3());
      const ic = nextSprite('ves', 0.03, active ? 0x7fe0ff : 0xffe58a);
      ic.position.copy(pos).sub(origin);
      const bigEnough = (v.orbit ? v.orbit.a : 0) * pxPerM > 70;
      if (bigEnough || v.status !== 'flying') lab(v.name, 'ves', pos);
      if (v.status !== 'flying') continue;
      const patches = world.getPatches(v);
      patches.forEach((p, k) => {
        const B = BODIES[p.bodyId];
        const rLimit = B.id === 'moon' ? B.soi : 3e7;
        const tA = k === 0 ? world.UT : p.t0;
        const tB = (p.type === 'none' && !p.el.hyper) ? tA + p.el.period : p.t1;
        const pts = sampleConic(p.el, tA, tB, SEG, rLimit);
        // patch around a moon: attach to the moon where it will be (or is)
        const center = p.bodyId === 'moon' ? world.moonState(p.bodyId === v.body && k === 0 ? world.UT : p.t0).r : new THREE.Vector3();
        const line = nextLine(active ? COLORS[Math.min(k, 3)] : OTHER);
        line.material.opacity = active ? 1 : 0.55;
        this._fillLine(line, pts, center, origin);
        if (active && k === 0 && (p.el.hyper || p.el.a * pxPerM > 70)) {
          const el = p.el, Bb = BODIES[p.bodyId];
          const pe = el.P.clone().multiplyScalar(el.rp).add(center);
          const a1 = nextSprite('pe', 0.022, 0x8fe8ff); a1.position.copy(pe).sub(origin);
          lab(`Pe ${fmtDist(el.rp - Bb.radius)}`, 'pe', pe);
          if (!el.hyper) {
            const ap = el.P.clone().multiplyScalar(-el.ra).add(center);
            const a2 = nextSprite('ap', 0.022, 0x8fe8ff); a2.position.copy(ap).sub(origin);
            lab(`Ap ${fmtDist(el.ra - Bb.radius)}`, 'ap', ap);
          }
        }
        if (p.type === 'enter' || p.type === 'exit') {
          const st = stateAt(p.el, p.t1);
          const where = st.r.clone().add(center);
          if (active) {
            const e = nextSprite('enc', 0.03, 0xffb347); e.position.copy(where).sub(origin);
            lab(p.type === 'enter' ? 'Pell encounter' : 'SOI exit', 'enc', where);
          }
          if (p.type === 'enter' && active) {
            const ms = world.moonState(p.t1).r;
            this._fillLine(this.ghostSoi, soiPts, ms, origin);
          }
        }
        if (p.type === 'impact' && active) {
          const st = stateAt(p.el, p.t1);
          const where = st.r.clone().add(center);
          const e = nextSprite('enc', 0.03, 0xff6b6b); e.position.copy(where).sub(origin);
          lab('Impact', 'enc', where);
        }
      });
    }
    for (let i = used.l; i < this.labels.length; i++) this.labels[i].style.display = 'none';
    for (let i = used.line; i < this.lines.length; i++) this.lines[i].visible = false;
    for (let i = used.spr; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }
}
