// Mouse/keyboard: camera control, selection, orders, formation drag preview.
import * as THREE from 'three';
import { pointInOBB, detachLight, recallLight, lightOut } from './units.js';
import { layout } from './formations.js';

export const Orders = {
  halt(sel) { for (const r of sel) r.cmdHalt(); },
  toggleFire(sel) { const v = !sel.every(r => r.fireAtWill); for (const r of sel) r.fireAtWill = v; },
  toggleRun(sel) { const v = !sel.every(r => r.run); for (const r of sel) if (r.active) r.run = v; },
  formation(sel, mode) { for (const r of sel) r.setSpacing(mode); },
  attack(sel, regs) {
    for (const r of sel) {
      let best = null, bd = 1e9;
      for (const t of regs) {
        if (t.side === r.side || t.state === 'gone') continue;
        const d = Math.hypot(t.x - r.x, t.z - r.z); if (d < bd) { bd = d; best = t; }
      }
      if (best) r.cmdAttack(best);
    }
  },
  // light company: on a line regiment with none out -> detach one; on a light company (or its parent) -> recall it. Returns new companies.
  light(sel, w, instant) {
    const made = [];
    for (const r of sel) {
      const l = r.def.light ? r : lightOut(r) ? r.light : null;
      if (l) recallLight(w, l, instant);
      else if (r.typeId === 'line') { const n = detachLight(w, r, instant); if (n) made.push(n); }
    }
    return made;
  },
};

export class Input {
  constructor(dom, camera, rts, world, game) {
    this.dom = dom; this.camera = camera; this.rts = rts; this.world = world; this.game = game;
    this.keys = new Set(); this.mouse = { x: -1, y: -1, over: false };
    this.ray = new THREE.Raycaster(); this.v = new THREE.Vector3();
    this.left = null; this.right = null; this.mid = null; this.lastClick = { t: 0, reg: null };
    this.groups = {};
    this.selBox = document.getElementById('selbox');
    world.select = (list, add = false) => this.select(list, add);
    this.ghost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), new THREE.MeshBasicMaterial({ color: 0xf0e4a0, transparent: true, opacity: 0.7, fog: false }), 800);
    this.ghost.count = 0; this.ghost.frustumCulled = false; this.ghost.renderOrder = 6;
    world.scene.add(this.ghost);
    this.bind();
  }

  get canOrder() { return this.game.phase === 'battle'; }
  get deploying() { return this.game.phase === 'deployment'; }

  select(list, add) {
    const w = this.world;
    if (!add) for (const r of w.selection) r.selected = false;
    const set = add ? new Set(w.selection) : new Set();
    for (const r of list) if (r.state !== 'gone' && r.side === 'player') set.add(r);
    w.selection = [...set];
    for (const r of w.selection) r.selected = true;
  }

  // ---- picking
  ndc(cx, cy) { return new THREE.Vector2(cx / window.innerWidth * 2 - 1, -(cy / window.innerHeight) * 2 + 1); }
  groundAtNDC(nx, ny) {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction, th = this.world.terrain;
    if (d.y >= 0) return null;
    let t = 0, prev = 0;
    for (; t < 4000; t += 6) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= th.heightAt(x, z)) {
        let a = prev, b = t;
        for (let i = 0; i < 10; i++) { const m = (a + b) / 2; (o.y + d.y * m <= th.heightAt(o.x + d.x * m, o.z + d.z * m)) ? b = m : a = m; }
        return { x: o.x + d.x * b, z: o.z + d.z * b, y: o.y + d.y * b };
      }
      prev = t;
    }
    return null;
  }
  pickGround(cx, cy) { const n = this.ndc(cx, cy); return this.groundAtNDC(n.x, n.y); }
  toScreen(x, y, z) {
    this.v.set(x, y, z).project(this.camera);
    return [(this.v.x * 0.5 + 0.5) * window.innerWidth, (-this.v.y * 0.5 + 0.5) * window.innerHeight, this.v.z];
  }
  pickReg(cx, cy, side) {
    const hit = this.pickGround(cx, cy), th = this.world.terrain;
    let best = null, bs = 1e9;
    for (const r of this.world.regs) {
      if (r.state === 'gone' || (side && r.side !== side)) continue;
      let s = 1e9;
      if (hit && pointInOBB(r, hit.x, hit.z, 3)) s = 30 + Math.hypot(hit.x - r.x, hit.z - r.z) * 0.1;
      const b = this.toScreen(r.x, th.heightAt(r.x, r.z) + 10, r.z);
      if (b[2] < 1) { const d = Math.hypot(b[0] + 14 - cx, b[1] - 12 - cy); if (d < 30) s = Math.min(s, d); }
      if (s < bs) { bs = s; best = r; }
    }
    return best;
  }

  // ---- events
  bind() {
    const dom = this.dom;
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', e => this.onUp(e));
    dom.addEventListener('wheel', e => { e.preventDefault(); const g = this.pickGround(e.clientX, e.clientY); g ? this.rts.zoom(e.deltaY, g.x, g.z) : this.rts.zoom(e.deltaY); }, { passive: false });
    dom.addEventListener('dblclick', e => this.onDbl(e));
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    document.addEventListener('mouseleave', () => { this.mouse.over = false; });
    window.addEventListener('blur', () => this.keys.clear());
  }
  onDown(e) {
    if (e.button === 0) this.left = { x: e.clientX, y: e.clientY, drag: false };
    else if (e.button === 2) {
      // second right press shortly after (and near) a right click = double-time order
      const lr = this.lastRight, dbl = !!lr && performance.now() - lr.t < 350 && Math.hypot(e.clientX - lr.x, e.clientY - lr.y) < 28;
      this.right = { x: e.clientX, y: e.clientY, drag: false, p0: this.pickGround(e.clientX, e.clientY), p1: null, dbl };
    }
    else if (e.button === 1) { e.preventDefault(); this.mid = { x: e.clientX }; }
  }
  onMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.over = e.target === this.dom;
    if (this.mid) { this.rts.rotate((e.clientX - this.mid.x) * 0.006); this.mid.x = e.clientX; }
    if (this.left) {
      const l = this.left;
      if (!l.drag && Math.hypot(e.clientX - l.x, e.clientY - l.y) > 6) l.drag = true;
      if (l.drag) {
        const s = this.selBox.style;
        s.display = 'block'; s.left = Math.min(l.x, e.clientX) + 'px'; s.top = Math.min(l.y, e.clientY) + 'px';
        s.width = Math.abs(e.clientX - l.x) + 'px'; s.height = Math.abs(e.clientY - l.y) + 'px';
      }
    }
    if (this.right) {
      const r = this.right;
      if (!r.drag && Math.hypot(e.clientX - r.x, e.clientY - r.y) > 12) r.drag = true;
      if (r.drag) r.p1 = this.pickGround(e.clientX, e.clientY);
    }
  }
  onUp(e) {
    if (e.button === 0 && this.left) {
      const l = this.left; this.left = null; this.selBox.style.display = 'none';
      if (this.game.phase === 'intro') return;
      if (l.drag) {
        const x0 = Math.min(l.x, e.clientX), x1 = Math.max(l.x, e.clientX), y0 = Math.min(l.y, e.clientY), y1 = Math.max(l.y, e.clientY);
        const th = this.world.terrain;
        const list = this.world.regs.filter(r => r.side === 'player' && r.state !== 'gone' && (() => {
          const s = this.toScreen(r.x, th.heightAt(r.x, r.z), r.z); return s[2] < 1 && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
        })());
        this.select(list, e.shiftKey);
      } else {
        const r = this.pickReg(e.clientX, e.clientY, 'player');
        if (r) this.select([r], e.shiftKey && true);
        else if (!e.shiftKey) this.select([], false);
      }
    } else if (e.button === 2 && this.right) {
      const r = this.right; this.right = null; this.ghost.count = 0;
      const clickOnly = !r.drag || !r.p1 || !r.p0;
      this.lastRight = (clickOnly && !r.dbl) ? { t: performance.now(), x: e.clientX, y: e.clientY } : null;
      if (this.canOrder && this.world.selection.length) this.issueRight(e, r);
      else if (this.deploying && this.world.selection.length) this.issueDeploy(r);
    } else if (e.button === 1) this.mid = null;
  }
  onDbl(e) {
    if (this.game.phase === 'intro') return;
    const r = this.pickReg(e.clientX, e.clientY, 'player');
    if (r) this.select(this.world.regs.filter(q => q.side === 'player' && q.typeId === r.typeId && q.state !== 'gone'), false);
  }
  issueRight(e, rd) {
    const sel = this.world.selection.filter(r => r.state !== 'gone');
    if (!sel.length) return;
    if (!rd.drag || !rd.p1 || !rd.p0) {
      const t = this.pickReg(e.clientX, e.clientY, 'enemy');
      if (t) { for (const r of sel) r.cmdAttack(t, rd.dbl ? true : undefined); return; }
      const p = rd.p0 || this.pickGround(e.clientX, e.clientY);
      if (!p) return;
      let cx = 0, cz = 0; for (const r of sel) { cx += r.x; cz += r.z; } cx /= sel.length; cz /= sel.length;
      if (sel.length === 1) sel[0].cmdMove(p.x, p.z, null, null, rd.dbl || sel[0].run);
      else for (const r of sel) r.cmdMove(p.x + (r.x - cx), p.z + (r.z - cz), null, null, rd.dbl || r.run);
      return;
    }
    for (const a of this.dragPlan(sel, rd.p0, rd.p1)) a.r.cmdMove(a.x, a.z, a.f, a.files, rd.dbl || a.r.run);
  }
  // ---- deployment: units snap instantly, clamped inside the player's zone; attack orders are ignored
  zoneClamp(p) { const z = this.game.zone; return { x: Math.max(z.x0, Math.min(z.x1, p.x)), z: Math.max(z.z0, Math.min(z.z1, p.z)) }; }
  issueDeploy(rd) {
    const sel = this.world.selection.filter(r => r.state !== 'gone');
    if (!sel.length || !this.game.zone || !rd.p0) return;
    if (!rd.drag || !rd.p1) {
      const p = this.zoneClamp(rd.p0);
      let cx = 0, cz = 0; for (const r of sel) { cx += r.x; cz += r.z; } cx /= sel.length; cz /= sel.length;
      for (const r of sel) this.placeUnit(r, p.x + (r.x - cx), p.z + (r.z - cz), r.facing, null);
      return;
    }
    for (const a of this.dragPlan(sel, this.zoneClamp(rd.p0), this.zoneClamp(rd.p1))) this.placeUnit(a.r, a.x, a.z, a.f, a.files);
  }
  placeUnit(r, x, z, f, files) {
    const zn = this.game.zone;
    r.facing = f; if (files) r.setFiles(files); r.updateLayout();
    const c = Math.abs(Math.cos(f)), sn = Math.abs(Math.sin(f)), ex = c * r.halfW + sn * r.halfD, ez = sn * r.halfW + c * r.halfD;
    const cl = (v, a, b) => a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v));
    r.x = cl(x, zn.x0 + ex, zn.x1 - ex); r.z = cl(z, zn.z0 + ez, zn.z1 - ez);
    r.order = { type: 'idle' }; r.run = false; r.speedNow = 0;
    for (const sd of r.soldiers) { const t = r.slotWorld(sd); sd.x = t[0]; sd.z = t[1]; sd.yaw = f; }
  }
  // compute per-regiment destinations for a drawn line
  dragPlan(sel, p0, p1) {
    const dx = p1.x - p0.x, dz = p1.z - p0.z, len = Math.max(1, Math.hypot(dx, dz)), ux = dx / len, uz = dz / len;
    let cx = 0, cz = 0; for (const r of sel) { cx += r.x; cz += r.z; } cx /= sel.length; cz /= sel.length;
    const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
    let nx = uz, nz = -ux;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const f = Math.atan2(nx, nz);
    const order = [...sel].sort((a, b) => ((a.x - cx) * ux + (a.z - cz) * uz) - ((b.x - cx) * ux + (b.z - cz) * uz));
    const seg = len / order.length, out = [];
    order.forEach((r, i) => {
      const t = seg * (i + 0.5);
      out.push({ r, x: p0.x + ux * t, z: p0.z + uz * t, f, files: seg / (r.def.sx * r.spacing) });
    });
    return out;
  }
  updateGhost() {
    const g = this.ghost, rd = this.right;
    g.count = 0;
    if (!rd || !rd.drag || !rd.p1 || !rd.p0 || !(this.canOrder || (this.deploying && this.game.zone))) return;
    const sel = this.world.selection.filter(r => r.state !== 'gone'), th = this.world.terrain, m = new THREE.Matrix4();
    if (!sel.length) return;
    const dep = this.deploying;
    for (const a of this.dragPlan(sel, dep ? this.zoneClamp(rd.p0) : rd.p0, dep ? this.zoneClamp(rd.p1) : rd.p1)) {
      const r = a.r, counts = { all: 0, pike: 0, musk: 0, guns: r.guns };
      for (const s of r.soldiers) counts[s.role]++;
      const [lo, hi] = [r.def.formation === 'grid' ? 6 : 4, r.maxMen];
      const files = r.def.formation === 'battery' ? 1 : Math.max(lo, Math.min(hi, Math.round(a.files)));
      const L = layout(r.def, counts, files, r.spacing);
      const c = Math.cos(a.f), s = Math.sin(a.f);
      for (const role of ['all', 'pike', 'musk']) {
        const arr = L[role];
        for (let i = 0; i < arr.length; i += 2) {
          if (g.count >= 800) return;
          const x = a.x + c * arr[i] + s * arr[i + 1], z = a.z - s * arr[i] + c * arr[i + 1];
          m.makeRotationY(a.f); m.setPosition(x, th.heightAt(x, z) + 0.4, z);
          g.setMatrixAt(g.count++, m);
        }
      }
    }
    g.instanceMatrix.needsUpdate = true;
  }
  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (e.target && e.target.tagName === 'INPUT') return;
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (this.game.phase === 'intro') { this.game.skipIntro && this.game.skipIntro(); return; }
    if (this.deploying && k === 'enter') { this.game.startBattle(); return; }
    const sel = this.world.selection.filter(r => r.state !== 'gone');
    if (e.ctrlKey && k === 'a') { e.preventDefault(); this.select(this.world.regs.filter(r => r.side === 'player'), false); return; }
    if (!this.deploying) {
      if (k === 'p') this.world.paused = !this.world.paused;
      if (k === '=' || k === '+') this.world.speed = Math.min(4, this.world.speed * 2);
      if (k === '-') this.world.speed = Math.max(0.5, this.world.speed / 2);
    }
    if (k === 'escape') this.select([], false);
    if (k === 'k') { this.lightOrder(sel); return; }
    if (!this.canOrder) return;
    if (k === ' ' || k === 'h') Orders.halt(sel);
    else if (k === 'f') Orders.toggleFire(sel);
    else if (k === 'r') Orders.toggleRun(sel);
    else if (k === 't') Orders.formation(sel, 'tight');
    else if (k === 'l') Orders.formation(sel, 'loose');
    else if (k === 'x') Orders.attack(sel, this.world.regs);
    else if (/^[1-9]$/.test(k)) {
      if (e.ctrlKey) { this.groups[k] = [...sel]; e.preventDefault(); }
      else if (this.groups[k]) { this.select(this.groups[k], false); if (e.detail === 2) this.focusSel(); }
    }
  }
  // detach / recall light companies (battle: walks out / back; deployment: instant, clamped into the zone)
  lightOrder(sel) {
    if (!this.canOrder && !this.deploying) return;
    for (const l of Orders.light(sel, this.world, this.deploying)) if (this.deploying) this.placeUnit(l, l.x, l.z, l.facing, null);
  }
  focusSel() {
    const s = this.world.selection; if (!s.length) return;
    this.rts.focusOn(s.reduce((a, r) => a + r.x, 0) / s.length, s.reduce((a, r) => a + r.z, 0) / s.length);
  }

  update(dt) {
    const k = this.keys, mv = { x: 0, y: 0 };
    if (k.has('w') || k.has('arrowup')) mv.y += 1;
    if (k.has('s') || k.has('arrowdown')) mv.y -= 1;
    if (k.has('d') || k.has('arrowright')) mv.x += 1;
    if (k.has('a') || k.has('arrowleft')) mv.x -= 1;
    if (this.mouse.over && !this.mid && !this.left) {
      const m = this.mouse, e = 6;
      if (m.x >= 0 && m.x < e) mv.x -= 1; else if (m.x > window.innerWidth - e) mv.x += 1;
      if (m.y >= 0 && m.y < e) mv.y += 1; else if (m.y > window.innerHeight - e) mv.y -= 1;
    }
    const rot = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    this.rts.update(dt, mv, rot, k.has('shift'));
    this.updateGhost();
    this.dom.style.cursor = (this.canOrder && this.world.selection.length && this.mouse.over && this.pickReg(this.mouse.x, this.mouse.y, 'enemy')) ? 'crosshair' : 'default';
  }
}
