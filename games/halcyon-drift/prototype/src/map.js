// Map view overlay: conic trajectory lines per patch, Ap/Pe markers, SOI circle,
// predicted encounter and DOM labels. Positions are physics-frame, relative to `origin`.
import * as THREE from 'three';
import { BODIES, isMoon, sitesOf, ventState } from './bodies.js';
import { sampleConic, stateAt } from './orbits.js';
import { nodeDvTotal } from './world.js';
import { fmtDist, fmtSpeed } from './hud.js';

const SEG = 200;
const _cd = new THREE.Vector3(), _mr = new THREE.Vector3(), _cp = new THREE.Vector3(), _sp2 = new THREE.Vector3(), _ds = new THREE.Vector3();
const COLORS = [new THREE.Color(0.3, 1.1, 1.8), new THREE.Color(1.8, 1.0, 0.3), new THREE.Color(0.5, 1.8, 0.6), new THREE.Color(1.5, 0.5, 1.5)];
const OTHER = new THREE.Color(1.1, 1.0, 0.45);
const POST = [new THREE.Color(1.9, 0.55, 1.7), new THREE.Color(1.5, 0.9, 1.9), new THREE.Color(1.2, 1.2, 1.9)]; // trajectory after the maneuver node

function iconTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff';
  if (kind === 'ring') { g.beginPath(); g.arc(32, 32, 24, 0, 7); g.stroke(); }
  else if (kind === 'ves') { g.beginPath(); g.moveTo(32, 8); g.lineTo(54, 52); g.lineTo(32, 42); g.lineTo(10, 52); g.closePath(); g.fill(); }
  else if (kind === 'ap' || kind === 'pe') { g.beginPath(); g.moveTo(32, 12); g.lineTo(52, 32); g.lineTo(32, 52); g.lineTo(12, 32); g.closePath(); g.stroke(); if (kind === 'ap') { g.beginPath(); g.arc(32, 32, 4, 0, 7); g.fill(); } }
  else if (kind === 'node') { g.beginPath(); g.arc(32, 32, 16, 0, 7); g.stroke(); g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 20); g.moveTo(32, 44); g.lineTo(32, 58); g.moveTo(6, 32); g.lineTo(20, 32); g.moveTo(44, 32); g.lineTo(58, 32); g.stroke(); }
  else if (kind === 'qmark') { g.font = 'bold 60px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 32, 36); g.beginPath(); g.arc(32, 32, 28, 0, 7); g.stroke(); }
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
    this.tex = { ring: iconTexture('ring'), ves: iconTexture('ves'), ap: iconTexture('ap'), pe: iconTexture('pe'), enc: iconTexture('enc'), node: iconTexture('node'), qmark: iconTexture('qmark') };
    this.pickables = []; this.moonInfo = {}; this.origin_ = null; // filled each frame, used by pick()
    this.ghostSoi = this.makeLine(new THREE.Color(1.8, 1.0, 0.3), 0.6, 120);
    this.moonLines = {}; this.soiLines = {}; this.moonPts = {}; this.soiPts = {};
    for (const id of BODIES.planet.children) { // orbit line + SOI circle per moon
      const M = BODIES[id];
      this.moonLines[id] = this.makeLine(new THREE.Color(0.35, 0.5, 0.8), 0.5, 360);
      this.soiLines[id] = this.makeLine(new THREE.Color(0.5, 0.65, 1.0), 0.35, 120);
      this.moonPts[id] = sampleConic(M.orbit, 0, M.orbit.period, 360);
      this.soiPts[id] = [];
      for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2; this.soiPts[id].push(new THREE.Vector3(Math.cos(a) * M.soi, Math.sin(a) * M.soi, 0)); }
    }
    this.ringLine = this.makeLine(new THREE.Color(0.6, 0.8, 1.2), 0.3, 64); // Wren's debris ring
    this.ringPts = [];
    const rr = (BODIES.wren.ring.inner + BODIES.wren.ring.outer) / 2;
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; this.ringPts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0)); }
  }
  /** what is under a right-click at screen (px, py): the nearest icon within 20 px (beacon/Spire preferred over a body), else a moon surface point */
  pick(camera, size, px, py) {
    const o = this.origin_;
    if (!o) return null;
    const proj = new THREE.Vector3();
    let best = null;
    for (const c of this.pickables) {
      proj.set(c.pos.x - o.x, c.pos.z - o.z, -(c.pos.y - o.y)).project(camera);
      if (proj.z > 1 || proj.z < -1) continue;
      const d = Math.hypot((proj.x * 0.5 + 0.5) * size.x - px, (-proj.y * 0.5 + 0.5) * size.y - py);
      const score = d - (c.kind === 'site' ? 6 : 0);
      if (d <= 20 && (!best || score < best.score)) best = { ...c, score };
    }
    if (best) return best;
    const ray = new THREE.Vector3((px / size.x) * 2 - 1, -(py / size.y) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    let hit = null;
    for (const id of ['planet', ...BODIES.planet.children]) {
      const mi = this.moonInfo[id];
      if (!mi) continue;
      const cen = new THREE.Vector3(mi.pos.x - o.x, mi.pos.z - o.z, -(mi.pos.y - o.y)).sub(camera.position);
      const b = cen.dot(ray), disc = b * b - cen.lengthSq() + mi.r * mi.r;
      if (disc < 0) continue;
      const t = b - Math.sqrt(disc);
      if (t <= 0 || (hit && t > hit.t)) continue;
      const pr = ray.clone().multiplyScalar(t).sub(cen); // render-space offset from the body centre
      hit = id === 'planet' ? { kind: 'body', id, t } : { kind: 'surface', body: id, dir: new THREE.Vector3(pr.x, -pr.z, pr.y).normalize(), t };
    }
    return hit;
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
    const moonAbs = {};
    for (const id of BODIES.planet.children) moonAbs[id] = world.moonState(world.UT, undefined, id).r;
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
    this.origin_ = origin.clone(); this.pickables.length = 0;
    this.moonInfo.planet = { pos: new THREE.Vector3(), r: BODIES.planet.radius };
    this.pickables.push({ kind: 'body', id: 'planet', pos: new THREE.Vector3() });
    nextSprite('ring', 0.045, 0x9fd0ff).position.copy(new THREE.Vector3().sub(origin));
    lab(BODIES.planet.name, 'body', new THREE.Vector3(0, 0, 0));
    for (const id of BODIES.planet.children) {
      const M = BODIES[id], mabs = moonAbs[id];
      this.moonInfo[id] = { pos: mabs.clone(), r: M.radius };
      this.pickables.push({ kind: 'body', id, pos: mabs.clone() });
      this._fillLine(this.moonLines[id], this.moonPts[id], new THREE.Vector3(), origin);
      nextSprite('ring', 0.032, id === 'moon' ? 0xcfd6e0 : 0xc4d8e8).position.copy(mabs).sub(origin);
      lab(M.name, 'body', mabs);
      if (id === 'wren') this._fillLine(this.ringLine, this.ringPts, mabs, origin);
      // ore beacons (when the moon is big enough on screen): easy to find from the map
      const mrel = _mr.set(mabs.x - origin.x, mabs.z - origin.z, -(mabs.y - origin.y));
      const pxMoon = M.radius * (size.y / 2) / (Math.max(1, mrel.distanceTo(camera.position)) * Math.tan((camera.fov * Math.PI / 180) / 2));
      if (pxMoon > 35) {
        const camPhys = _cp.set(camera.position.x, -camera.position.z, camera.position.y).add(origin);
        const near = (d) => _ds.copy(camPhys).sub(mabs).dot(d) >= M.radius; // not on the far side
        const tgt = world.targetSite(id);
        for (const s of sitesOf(id)) {
          const pos = _sp2.copy(s.dir).multiplyScalar(M.radius).add(mabs);
          if (!near(s.dir)) continue;
          nextSprite('enc', tgt === s ? 0.026 : 0.018, tgt === s ? 0xffe066 : 0x66d0ff).position.copy(pos).sub(origin);
          lab(s.name, 'ap', pos);
          this.pickables.push({ kind: 'site', body: id, site: s, pos: pos.clone() });
        }
        const cs = world.flags.tgtCustom; // a marked landing point
        if (cs && cs.body === id && near(_cd.fromArray(cs.dir))) {
          const pos = _sp2.copy(_cd).multiplyScalar(M.radius).add(mabs);
          nextSprite('node', 0.026, 0xff7ae0).position.copy(pos).sub(origin);
          lab('Marked point', 'enc', pos);
        }
        if (id === 'wren') {
          const now = performance.now() / 1000;
          for (const vt of M.vents) { // pulsing icon while a geyser erupts
            if (!ventState(vt, world.UT).active || !near(vt.dir)) continue;
            const pos = _sp2.copy(vt.dir).multiplyScalar(M.radius).add(mabs);
            const sz = 0.014 + 0.007 * (0.5 + 0.5 * Math.sin(now * 5 + vt.offset));
            nextSprite('enc', sz, 0x9fe8ff).position.copy(pos).sub(origin);
          }
          const S = M.spire;
          if (world.flags.spireSeen && near(S.dir)) { // the "?" appears once the signal is detected
            const pos = _sp2.copy(S.dir).multiplyScalar(M.radius).add(mabs), found = !!world.flags.spireFound;
            nextSprite(found ? 'ap' : 'qmark', found ? 0.026 : 0.03 + 0.012 * (0.5 + 0.5 * Math.sin(now * 3.2)), found ? 0xff8ae8 : 0xffe066).position.copy(pos).sub(origin);
            if (found) lab('The Spire', 'ap', pos);
            this.pickables.push({ kind: 'site', body: id, site: world.landingSites(id).find((s) => s.spire), pos: pos.clone() });
          }
        }
      }
      this._fillLine(this.soiLines[id], this.soiPts[id], mabs, origin); // moon SOI
    }
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
      const kNode = patches.findIndex((q) => q.type === 'node');
      patches.forEach((p, k) => {
        const B = BODIES[p.bodyId];
        const firstPost = p.post && k > 0 && patches[k - 1].type === 'node';
        const rLimit = isMoon(B.id) ? B.soi : 3e7;
        const tA = k === 0 ? world.UT : p.t0;
        const tB = (p.type === 'none' && !p.el.hyper) ? tA + p.el.period : p.t1;
        const pts = sampleConic(p.el, tA, tB, SEG, rLimit);
        // patch around a moon: attach to the moon where it will be (or is)
        const center = isMoon(p.bodyId) ? world.moonState(p.bodyId === v.body && k === 0 ? world.UT : p.t0, undefined, p.bodyId).r : new THREE.Vector3();
        const line = nextLine(active ? (p.post ? POST[Math.min(k - kNode - 1, 2)] : COLORS[Math.min(k, 3)]) : OTHER);
        line.material.opacity = active ? 1 : 0.55;
        this._fillLine(line, pts, center, origin);
        // Ap/Pe of the current orbit, of the first post-node orbit, and the periapsis at a moon encounter
        const moonPass = k > 0 && isMoon(p.bodyId) && patches[k - 1].type === 'enter';
        if (active && (k === 0 || firstPost || moonPass) && (p.el.hyper || p.el.a * pxPerM > 70)) {
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
        if (p.type === 'node' && active) {
          const where = stateAt(p.el, p.t1).r.add(center);
          const e = nextSprite('node', 0.032, 0xffd84d); e.position.copy(where).sub(origin);
          lab(`Node ${fmtSpeed(nodeDvTotal(p.node))}`, 'enc', where);
        }
        if (p.type === 'enter' || p.type === 'exit') {
          const st = stateAt(p.el, p.t1);
          const where = st.r.clone().add(center);
          if (active) {
            const e = nextSprite('enc', 0.03, 0xffb347); e.position.copy(where).sub(origin);
            lab(p.type === 'enter' ? `${BODIES[p.body].name} encounter` : 'SOI exit', 'enc', where);
          }
          if (p.type === 'enter' && active) {
            const ms = world.moonState(p.t1, undefined, p.body).r;
            this._fillLine(this.ghostSoi, this.soiPts[p.body], ms, origin);
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
