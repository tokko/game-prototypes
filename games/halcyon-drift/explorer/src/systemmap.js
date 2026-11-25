// System map overlay (M): sun, planets, giants and moons on their rails, SOI rings, the active craft's full predicted
// patched-conic chain (segments, SOI crossings, nodes, periapsis, closest approach), body info + transfer planning
// (dv needed vs available, launch-window phase angle, Plan transfer assist) and maneuver-node editing.
import { Vector3 } from 'three';
import * as S from './system.js';
import { BODIES, SUN, DESTINATIONS, orbitAngle, parkRadius, circSpeed } from './destinations.js';
import { planLeg } from './transfer.js';
import { planTransfer, planRendezvous } from './planner.js';
import { landerDv, planeDv, carrierDv, LANDER, PLANE } from './craft.js';
import { WARP, NODE_STEPS } from './world.js';
import { ascentReport } from './ascent.js';
import { nextPeriapsisTime, nextApoapsisTime } from './orbits.js';

const TAU = Math.PI * 2;
const COLORS = ['#7fd8ff', '#ffb347', '#b6ff9a', '#ff8cf0', '#ffffff', '#ffe27a'];
const fmtT = (s) => { if (!isFinite(s)) return '-'; const a = Math.abs(s), sg = s < 0 ? '-' : ''; if (a < 120) return sg + a.toFixed(0) + ' s'; if (a < 7200) return sg + (a / 60).toFixed(0) + ' min'; if (a < 172800) return sg + (a / 3600).toFixed(1) + ' h'; if (a < 3.2e7 * 1) return sg + (a / 86400).toFixed(0) + ' d'; return sg + (a / 3.156e7).toFixed(2) + ' y'; };
export const fmtUT = (t) => { const y = Math.floor(t / 3.156e7), d = Math.floor((t % 3.156e7) / 86400); return `Y${y + 1} D${d + 1}`; };
export const fmtDist = (m) => (Math.abs(m) >= 1e9 ? (m / 1e9).toFixed(2) + ' Gm' : Math.abs(m) >= 1e6 ? (m / 1e6).toFixed(1) + ' Mm' : (m / 1e3).toFixed(0) + ' km');

export class SystemMap {
  constructor(world, api) {
    this.w = world; this.api = api;
    this.cv = document.getElementById('mapCv'); this.ctx = this.cv.getContext('2d');
    this.side = document.getElementById('mapSide');
    this.view = S.ROOT; this.sel = 'kestrel'; this.pan = { x: 0, z: 0 }; this.zoom = 1; this.nodeSel = 0; this.step = 1; this.open = false;
    this.lastSide = 0; this.hit = []; this.plan = null; this.drag = null; this.caCache = null;
    this.stars = Array.from({ length: 180 }, () => [Math.random(), Math.random(), Math.random()]);
    this.cv.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, px: this.pan.x, pz: this.pan.z, moved: false }; });
    addEventListener('mousemove', (e) => { if (!this.drag || !this.open) return; const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true; this.pan.x = this.drag.px - dx / this.scale; this.pan.z = this.drag.pz - dy / this.scale; });
    addEventListener('mouseup', (e) => { if (this.drag && !this.drag.moved && this.open && e.target === this.cv) this.click(e.offsetX, e.offsetY, e.detail > 1); this.drag = null; });
    this.cv.addEventListener('wheel', (e) => {
      // zoom about the cursor so you can dive into whatever body or orbit you point at
      const W = this.cv.width / devicePixelRatio, H = this.cv.height / devicePixelRatio, s0 = this.scale;
      const wx = this.pan.x + (e.offsetX - W * 0.36) / s0, wz = this.pan.z + (e.offsetY - H / 2) / s0;
      this.zoom *= e.deltaY < 0 ? 1.2 : 1 / 1.2; this.zoom = Math.max(0.2, Math.min(200000, this.zoom));
      const s1 = this.scale; this.pan.x = wx - (e.offsetX - W * 0.36) / s1; this.pan.z = wz - (e.offsetY - H / 2) / s1;
      e.preventDefault();
      // the system view draws moons as fixed icons, so zooming onto a planet with moons drops into its local view
      if (this.view === S.ROOT && e.deltaY < 0) {
        const near = this.hit.find((h) => BODIES[h.id]?.children?.length && Math.hypot(h.x - e.offsetX, h.y - e.offsetY) < 40);
        if (near && Math.max(...BODIES[near.id].children.map((k) => BODIES[k].a)) * s1 > 60) { this.setView(near.id); this.sel = near.id; this.refreshSide(true); }
      } else if (this.view !== S.ROOT && e.deltaY > 0 && this.zoom < 0.3) this.setView(S.ROOT);
    }, { passive: false });
    this.side.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) this.action(b.dataset.a, b.dataset.v); });
    this.fitView();
  }
  fitView() {
    this.pan.x = 0; this.pan.z = 0; this.zoom = 1;
  }
  setView(id) { this.view = id; this.fitView(); }
  show(on) {
    this.open = on; document.getElementById('map').classList.toggle('hidden', !on);
    if (on) { this.resize(); this.refreshSide(true); }
  }
  resize() { this.cv.width = this.cv.clientWidth * devicePixelRatio; this.cv.height = this.cv.clientHeight * devicePixelRatio; }
  get scale() {
    const V = this.view; let R;
    if (V === S.ROOT) R = 1.65e11; else { const kids = BODIES[V].children || []; R = Math.max(...kids.map((k) => BODIES[k].a), BODIES[V].R * 4) * 1.35; }
    return (Math.min(this.cv.width, this.cv.height) / devicePixelRatio * 0.46 / R) * this.zoom;
  }
  toPx(x, z) { const s = this.scale, W = this.cv.width / devicePixelRatio, H = this.cv.height / devicePixelRatio; return [W * 0.36 + (x - this.pan.x) * s, H / 2 + (z - this.pan.z) * s]; }
  relPos(id, t) { return S.bodyIn(id, this.view, t); }

  click(px, py, dbl) {
    let best = null, bd = 18;
    for (const h of this.hit) { const d = Math.hypot(h.x - px, h.y - py); if (d < bd) { bd = d; best = h; } }
    if (best) {
      if (best.vessel) { this.action('target', best.id); return; }
      this.sel = best.id; this.plan = null; this.refreshSide(true);
      if (dbl && (BODIES[best.id]?.children?.length)) this.setView(best.id);
    }
  }

  // ---------------------------------------------------------------- drawing
  draw(t) {
    const c = this.ctx, W = this.cv.width / devicePixelRatio, H = this.cv.height / devicePixelRatio;
    c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    c.clearRect(0, 0, W, H);
    for (const s of this.stars) { c.fillStyle = `rgba(255,255,255,${0.15 + s[2] * 0.5})`; c.fillRect(s[0] * W, s[1] * H, 1.2, 1.2); }
    const V = this.view, sc = this.scale;
    this.hit = [];
    // orbits + SOI ring
    const kids = V === S.ROOT ? S.SUN_NODE.children : BODIES[V].children;
    c.lineWidth = 1;
    const [cx, cy] = this.toPx(...this.vecXZ(S.bodyIn(V, V, t)));
    for (const id of kids) { const b = BODIES[id]; c.strokeStyle = 'rgba(160,180,210,.22)'; c.beginPath(); c.arc(cx, cy, b.a * sc, 0, TAU); c.stroke(); }
    if (V !== S.ROOT) { c.strokeStyle = 'rgba(255,200,120,.25)'; c.setLineDash([4, 5]); c.beginPath(); c.arc(cx, cy, BODIES[V].soi * sc, 0, TAU); c.stroke(); c.setLineDash([]); }
    // central body
    const cen = V === S.ROOT ? SUN : BODIES[V];
    this.disc(cx, cy, Math.max(V === S.ROOT ? 9 : 7, (cen.R || 1) * sc), V === S.ROOT ? '#ffd890' : this.col(BODIES[V]), V === S.ROOT ? 'Halcyon' : cen.name, V, true, V !== S.ROOT);
    // bodies
    for (const id of kids) {
      const b = BODIES[id]; const p = this.relPos(id, t); const [x, y] = this.toPx(...this.vecXZ(p));
      this.disc(x, y, Math.max(3.2, b.R * sc), this.col(b), b.name, id, b.destination, false);
      if (V === S.ROOT && b.children?.length) for (const mid of b.children) {
        const m = BODIES[mid]; const a = Math.atan2(-S.bodyRel(mid, t).r.z, S.bodyRel(mid, t).r.x);
        const rr = 14 + 7 * b.children.indexOf(mid);
        const mx = x + Math.cos(a) * rr, my = y - Math.sin(a) * rr;
        c.strokeStyle = 'rgba(160,180,210,.18)'; c.beginPath(); c.arc(x, y, rr, 0, TAU); c.stroke();
        this.disc(mx, my, 2.6, this.col(m), m.name, mid, m.destination, false, true);
      }
    }
    // vessels + chain
    this.drawChain(c, t);
    this.drawFleet(c, t);
    // header
    c.fillStyle = '#cfe0f5'; c.font = '12px ui-monospace,monospace'; c.textAlign = 'left';
    c.fillText(`View: ${V === S.ROOT ? 'Halcyon system' : BODIES[V].name + ' system'}   UT ${fmtUT(t)}   warp ${WARP[this.w.warpIndex]}x`, 14, H - 14);
    c.fillStyle = '#8d9bb0'; c.fillText('wheel zoom - drag pan - click select - double-click a planet with moons to zoom in', 14, H - 32);
  }
  vecXZ(s) { return [s.r.x, s.r.z]; }
  fleetPosition(v, t) {
    const craft = v.docked ? this.w.carrier : v;
    const local = craft.status === 'surface' ? this.api.surfacePosition(craft) : craft.r;
    return S.bodyIn(craft.body, this.view, t).r.add(local);
  }
  drawFleet(c, t) {
    const occupied = [];
    for (const v of this.w.vessels) {
      const pos = this.fleetPosition(v, t), [x, y] = this.toPx(pos.x, pos.z);
      let row = y;
      while (occupied.some(p => Math.abs(p.x - x) < 95 && Math.abs(p.y - row) < 15)) row += 16;
      occupied.push({ x, y: row });
      const color = v === this.w.active.target ? '#ffb347' : v === this.w.active ? '#7fd8ff' : '#e2eaf3';
      c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 12, row - 9); c.stroke();
      c.fillRect(x + 10, row - 11, 5, 5);
      c.font = '600 11px system-ui'; c.textAlign = 'left'; c.fillText(v.name, x + 20, row - 5);
      this.hit.push({ id: v.id, vessel: true, x: x + 12, y: row - 9 });
      this.hit.push({ id: v.id, vessel: true, x: x + 40, y: row - 9 });
    }
  }
  col(b) { const p = b.palette?.c2 || [0.8, 0.8, 0.8]; return `rgb(${p.map((x) => Math.round(Math.min(1, x * 1.15) * 255)).join(',')})`; }
  disc(x, y, r, color, label, id, dest, isCenter, selectable = true) {
    const c = this.ctx;
    c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    if (dest) { c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.4; c.beginPath(); c.arc(x, y, r + 3, 0, TAU); c.stroke(); }
    if (this.sel === id) { c.strokeStyle = '#ffb347'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 7, 0, TAU); c.stroke(); }
    c.fillStyle = dest ? '#fff' : '#9fb0c8'; c.font = (dest ? '600 12px ' : '11px ') + 'system-ui,sans-serif'; c.textAlign = 'left';
    c.fillText(label, x + r + 8, y + 4);
    if (selectable) this.hit.push({ x, y, id });
  }
  drawChain(c, t) {
    const v = this.w.active;
    if (v.status !== 'orbit' || v.docked) {
      return;
    }
    const V = this.view;
    const pos = (patch, tt, out) => { const s = S.stateAt(patch.el, tt, { r: new Vector3(), v: new Vector3() }); const b = S.bodyAbs(patch.bodyId, tt); const f = S.bodyAbs(V, tt); return [s.r.x + b.r.x - f.r.x, s.r.z + b.r.z - f.r.z]; };
    const patches = this.w.patches(v);
    patches.forEach((p, i) => {
      const t0 = p.t0, t1 = isFinite(p.t1) ? Math.min(p.t1, t0 + 1.2e9) : t0 + 5e6;
      const N = 160; c.strokeStyle = COLORS[i % COLORS.length]; c.lineWidth = i === 0 ? 2.2 : 1.6; c.globalAlpha = i === 0 ? 1 : 0.85; c.beginPath();
      let started = false;
      for (let k = 0; k <= N; k++) {
        const tt = t0 + (t1 - t0) * k / N; const [x, z] = pos(p, tt); const [px, py] = this.toPx(x, z);
        if (!isFinite(px) || Math.abs(px) > 6000 || Math.abs(py) > 6000) { started = false; continue; }
        if (!started) { c.moveTo(px, py); started = true; } else c.lineTo(px, py);
      }
      c.stroke(); c.globalAlpha = 1;
      // transitions + nodes + periapsis
      if (p.type === 'enter' || p.type === 'exit') { const [x, z] = pos(p, p.t1); const [px, py] = this.toPx(x, z); c.strokeStyle = '#fff'; c.lineWidth = 1.4; c.beginPath(); c.arc(px, py, 5, 0, TAU); c.stroke(); c.fillStyle = '#cfe0f5'; c.font = '10px ui-monospace,monospace'; c.fillText((p.type === 'enter' ? 'SOI in ' + BODIES[p.body].name : 'SOI out ' + (BODIES[p.bodyId]?.name || '')), px + 8, py - 6); }
      if (p.type === 'impact') { const [x, z] = pos(p, p.t1); const [px, py] = this.toPx(x, z); c.strokeStyle = '#ff6a4a'; c.beginPath(); c.moveTo(px - 5, py - 5); c.lineTo(px + 5, py + 5); c.moveTo(px + 5, py - 5); c.lineTo(px - 5, py + 5); c.stroke(); }
      if (p.type === 'node' && p.node) this.nodeMark(c, pos(p, p.t1), p.node, v);
      if (p.el.hyper || p.el.e > 0.02) {
        const tp = p.el.hyper ? p.el.t0 - p.el.M0 / p.el.n : nextPeriapsisTime(p.el, p.t0);
        if (tp >= p.t0 && tp <= p.t1 && (p.el.hyper) && p.bodyId !== S.ROOT) { const [x, z] = pos(p, tp); const [px, py] = this.toPx(x, z); c.fillStyle = '#ffb347'; c.beginPath(); c.arc(px, py, 3.2, 0, TAU); c.fill(); c.font = '10px ui-monospace,monospace'; c.fillText('Pe ' + fmtDist(p.el.rp - (BODIES[p.bodyId]?.R || 0)), px + 6, py + 12); }
      }
    });
    // closest approach to the selected body
    if (this.sel && patches.length && BODIES[this.sel]) {
      const key = this.w.nodeRev + ':' + this.sel + ':' + patches.length;
      if (!this.caCache || this.caCache.key !== key) this.caCache = { key, ca: S.closestApproach(patches, this.sel, 220) };
      const ca = this.caCache.ca;
      if (ca && isFinite(ca.d) && ca.patch) {
        const [x1, z1] = pos(ca.patch, ca.t); const tb = S.bodyIn(this.sel, V, ca.t); const [p1x, p1y] = this.toPx(x1, z1), [p2x, p2y] = this.toPx(tb.r.x, tb.r.z);
        c.strokeStyle = '#b6ff9a'; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(p1x, p1y); c.lineTo(p2x, p2y); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#b6ff9a'; c.font = '10px ui-monospace,monospace'; c.fillText(`closest ${fmtDist(ca.d)} in ${fmtT(ca.t - t)}`, p1x + 8, p1y - 8);
        c.beginPath(); c.arc(p1x, p1y, 3, 0, TAU); c.fill();
      }
    }
  }
  nodeMark(c, [x, z], node, v) {
    const [px, py] = this.toPx(x, z); const idx = v.nodes.indexOf(node);
    c.save(); c.translate(px, py); c.rotate(Math.PI / 4); c.strokeStyle = idx === this.nodeSel ? '#ffb347' : '#ffe27a'; c.lineWidth = 2; c.strokeRect(-5, -5, 10, 10); c.restore();
    c.fillStyle = '#ffe27a'; c.font = '10px ui-monospace,monospace'; c.textAlign = 'left';
    c.fillText(`N${idx + 1} ${Math.hypot(node.dv.pro, node.dv.nrm, node.dv.rad).toFixed(0)} m/s`, px + 9, py + 3);
  }

  // ---------------------------------------------------------------- side panel
  refreshSide(force) {
    const now = performance.now(); if (!force && now - this.lastSide < 450) return; this.lastSide = now;
    const w = this.w, t = w.t, id = this.sel, b = BODIES[id], v = w.active;
    const esc = (s) => s;
    let h = '<h3>Fleet</h3><div class="btns">';
    for (const craft of w.vessels) {
      const status = craft.docked ? 'aboard Wayfarer' : craft.status === 'surface' ? 'surface' : 'orbit';
      h += `<button data-a="target" data-v="${craft.id}" ${craft === v ? 'disabled' : ''} class="${craft === v.target ? 'on' : ''}">${craft.name} · ${craft === v ? 'piloting' : status}</button>`;
    }
    h += '</div>';
    if (v.target) {
      const target = v.target, host = target.docked ? w.carrier : target;
      const range = this.fleetPosition(v, t).distanceTo(this.fleetPosition(target, t));
      h += `<p>Target: <b>${target.name}</b> · ${BODIES[host.body]?.name || SUN.name} · ${range < 10000 ? Math.round(range) + ' m' : fmtDist(range)}`;
      if (v.body === host.body && v.status === 'orbit' && host.status === 'orbit')
        h += ` · relative speed ${v.v.distanceTo(host.v).toFixed(1)} m/s`;
      h += '</p><div class="btns">';
      if (host !== v && v.body === host.body && v.status === 'orbit' && host.status === 'orbit') {
        h += `<button data-a="intercept">${v.nodes.length ? 'Replace nodes with rendezvous' : 'Plan rendezvous'}</button>`;
        if ((v === w.carrier || host === w.carrier) && range <= 12000)
          h += '<button data-a="dock">Dock</button>';
      }
      h += '<button data-a="untarget">Clear target</button></div>';
    }
    if (b) {
      h += `<h3>${b.name}</h3><div class="dim">${b.kind === 'moon' ? 'Moon of ' + BODIES[b.parent].name : b.kind === 'giant' ? 'Gas / ice giant' : 'Planet'}${b.destination ? ' - destination' : ''}</div><p>${b.blurb}</p>`;
      h += '<table>';
      h += `<tr><td>Radius</td><td>${(b.R / 1e3).toFixed(0)} km</td></tr><tr><td>Gravity</td><td>${b.g ? b.g.toFixed(2) + ' m/s2 (' + (b.g / 9.81).toFixed(2) + ' g)' : '-'}</td></tr>`;
      h += `<tr><td>Orbit radius</td><td>${fmtDist(b.a)}</td></tr><tr><td>Orbital period</td><td>${fmtT(b.orbit.period)}</td></tr><tr><td>Sphere of influence</td><td>${fmtDist(b.soi)}</td></tr>`;
      if (b.destination) {
        h += `<tr><td>Parking orbit</td><td>${(b.parkAlt / 1e3).toFixed(0)} km (${circSpeed(b).toFixed(0)} m/s)</td></tr><tr><td>Atmosphere</td><td>${b.atmosphere ? b.atmosphere.pressure + ', ' + b.atmosphere.note : 'none (airless)'}</td></tr>`;
        const est = 2 * (circSpeed(b) + b.g * 120 + 150);
        h += `<tr><td>Land + ascent dv (est.)</td><td>${est.toFixed(0)} m/s</td></tr>`;
      }
      h += '</table>';
      if (b.destination) {
        const lcap = landerDv(LANDER.fuelMax, LANDER.oxMax), pcap = planeDv({ fuel: PLANE.fuelMax, ox: PLANE.oxMax, h2: PLANE.h2Max }, 'rocket');
        const est = 2 * (circSpeed(b) + b.g * 120 + 150);
        if (b.recipe) h += `<p class="good">Surface survey complete. Landing: Prospector rover-lander (${lcap.toFixed(0)} m/s) or Albatross spaceplane tail-down (${pcap.toFixed(0)} m/s).</p>`;
        else if (b.airless) h += `<p class="dim">Surface survey data pending. Airless: Prospector needs ~${est.toFixed(0)} m/s for land + ascent (capacity ${lcap.toFixed(0)}): ${est < lcap * 0.85 ? '<span class="good">within reach</span>' : '<span class="bad">cannot make orbit again</span>'}.</p>`;
        else h += `<p class="dim">Surface survey data pending. Atmospheric world: ${b.landing}. Land + ascent ~${est.toFixed(0)} m/s: Prospector ${est < lcap * 0.85 ? 'could' : '<span class="bad">cannot</span>'} return to orbit; the spaceplane's air-breathing mode is the way up.</p>`;
        { const r = ascentReport(id); const yn = (o) => (o.ok ? `<span class="good">yes (+${Math.round(o.margin * 100)}%)</span>` : '<span class="bad">NO</span>');
          h += `<table><tr><td>Reach orbit after full surface refuel</td><td></td></tr><tr><td>&nbsp;Prospector (${r.lander.mode})</td><td>${yn(r.lander)}</td></tr><tr><td>&nbsp;Albatross (${r.plane.mode})</td><td>${yn(r.plane)}</td></tr></table>`; }
        // transfer panel
        const origin = v.status === 'orbit' && !v.docked ? v.body : null;
        if (origin && origin !== id && BODIES[origin].destination) {
          const leg = planLeg(origin, id, t);
          const cap = v.dvRemaining(w);
          h += `<hr><b>Transfer ${BODIES[origin].name} &rarr; ${b.name}</b><table>`;
          h += `<tr><td>Departure + capture (ideal)</td><td>${leg.dvDep.toFixed(0)} + ${leg.dvArr.toFixed(0)} m/s</td></tr>`;
          h += `<tr><td>Window phase angle (now / needed)</td><td>${(leg.phaseNow * 180 / Math.PI).toFixed(0)}&deg; / ${(leg.phaseReq * 180 / Math.PI).toFixed(0)}&deg;</td></tr>`;
          h += `<tr><td>Next window in</td><td>${fmtT(leg.windowIn)}</td></tr><tr><td>Hohmann flight time</td><td>${fmtT(leg.tof)}</td></tr>`;
          h += `<tr><td>${v.name} dv available</td><td class="${cap >= leg.dvTotalIdeal ? 'good' : 'bad'}">${cap.toFixed(0)} m/s</td></tr></table>`;
          if (this.plan) {
            const p = this.plan;
            h += p.ok ? `<p class="good">Plan ready: ${p.nodes.length} nodes, ${p.total.toFixed(0)} m/s total, departs in ${fmtT(p.tDep - t)}, arrives in ${fmtT(p.tArr - t)}, capture periapsis ${(p.periAlt / 1e3).toFixed(0)} km. ${p.total > cap ? '<span class="bad">Not enough dv!</span>' : ''}</p>` : `<p class="bad">Planner: ${p.error}</p>`;
          }
          h += `<div class="btns"><button data-a="plan">Plan transfer</button><button data-a="warpwin">Warp to window</button><button data-a="clear">Clear nodes</button></div>`;
        } else if (origin === id) h += `<p class="good">You are in orbit here.</p>`;
      }
      if (b.children?.length) h += `<div class="btns"><button data-a="view" data-v="${id}">Zoom into ${b.name} system</button></div>`;
    } else h += `<h3>${SUN.name}</h3><div class="dim">Star</div>`;
    h += `<div class="btns"><button data-a="view" data-v="${S.ROOT}">Sun view</button><button data-a="warp-">Warp -</button><button data-a="warp+">Warp +</button><button data-a="warp0">1x</button></div>`;
    // node editor
    if (v.status === 'orbit' && !v.docked) {
      h += `<hr><b>${v.name} maneuver nodes</b> <span class="dim">(${v.nodes.length})</span>`;
      if (!v.nodes.length) h += `<div class="dim">No nodes. Add one:</div>`;
      v.nodes.forEach((n, i) => { h += `<div class="jitem" style="padding:3px 0"><a style="cursor:pointer;${i === this.nodeSel ? 'color:#ffb347' : ''}" data-a="nsel" data-v="${i}">N${i + 1}</a> in ${fmtT(n.t - t)}: pro ${n.dv.pro.toFixed(0)} nrm ${n.dv.nrm.toFixed(0)} rad ${n.dv.rad.toFixed(0)} = ${w.nodeDvTotal(n).toFixed(0)} m/s</div>`; });
      const total = v.nodes.reduce((s, n) => s + w.nodeDvTotal(n), 0);
      if (v.nodes.length) h += `<div class="dim">Total ${total.toFixed(0)} m/s; dv available ${v.dvRemaining(w).toFixed(0)} m/s; burn ${fmtT(w.burnTime(v, total))} at full thrust (applied time-compressed)</div>`;
      h += `<div class="btns"><button data-a="addpe">+ at Pe</button><button data-a="addap">+ at Ap</button><button data-a="addnow">+ in 10 min</button><button data-a="ndel">Delete</button><button data-a="nwarp">Warp to node</button></div>`;
      if (v.nodes[this.nodeSel]) {
        h += `<div class="dim">Step ${this.step} m/s</div><div class="btns">` +
          ['pro', 'nrm', 'rad'].map((k) => `<button data-a="dv-${k}-m">${k}-</button><button data-a="dv-${k}-p">${k}+</button>`).join('') +
          `<button data-a="tm">&larr; time</button><button data-a="tp">time &rarr;</button><button data-a="step">step x10</button><button data-a="auto" class="${v.autoNodes !== false ? 'on' : ''}">Auto-burn ${v.autoNodes !== false ? 'ON' : 'OFF'}</button></div>`;
      }
    } else h += `<hr><div class="dim">Undock a craft (or stay on the carrier) in orbit to plan maneuvers. Docked craft ride with the carrier.</div>`;
    this.side.innerHTML = h;
  }
  action(a, val) {
    const w = this.w, v = w.active;
    const needOrbit = () => { if (v.status !== 'orbit' || v.docked) { this.api.toast('Pick a craft in orbit first', 'warn'); return false; } return true; };
    if (a === 'target') {
      const target = w.vessels.find(craft => craft.id === val);
      if (!target || target === v) return;
      v.target = target;
      const body = target.docked ? w.carrier.body : target.body;
      this.setView(body);
      const p = this.fleetPosition(target, w.t);
      this.pan.x = p.x; this.pan.z = p.z;
    } else if (a === 'untarget') v.target = null;
    else if (a === 'dock') this.api.dock();
    else if (a === 'intercept') {
      const result = planRendezvous(w, v, v.target?.docked ? w.carrier : v.target);
      if (result.error) this.api.toast(result.error, 'warn');
      else { v.nodes = result.nodes; w.touchNodes(); this.nodeSel = 0; this.api.toast(`Rendezvous with ${v.target.name} plotted: intercept and match velocity`, 'ok'); }
    } else if (a === 'view') this.setView(val);
    else if (a === 'warp-') w.setWarp(w.warpIndex - 1);
    else if (a === 'warp+') w.setWarp(w.warpIndex + 1);
    else if (a === 'warp0') { w.warpIndex = 0; w.warpTo = null; }
    else if (a === 'plan') {
      if (!needOrbit()) return;
      const r = planTransfer(w, v, this.sel);
      this.plan = r;
      if (r.ok) { v.nodes = r.nodes; w.touchNodes(); this.nodeSel = 0; this.api.toast(`Transfer planned: ${r.total.toFixed(0)} m/s`, 'ok'); } else this.api.toast('Plan failed: ' + r.error, 'warn');
    } else if (a === 'warpwin') {
      if (!needOrbit()) return;
      const origin = v.body; if (!BODIES[origin] || origin === this.sel) return;
      const leg = planLeg(origin, this.sel, w.t); w.warpTo = w.t + Math.max(0, leg.windowIn - 3600);
      this.api.toast(`Warping to the launch window (${fmtT(leg.windowIn)})`, 'info');
    } else if (a === 'clear') { v.nodes = []; w.touchNodes(); this.plan = null; }
    else if (!needOrbit()) return;
    else if (a === 'addpe' || a === 'addap' || a === 'addnow') {
      if (!v.el) return;
      let tt = w.t + 600;
      if (a === 'addpe') tt = nextPeriapsisTime(v.el, w.t); if (a === 'addap') { tt = nextApoapsisTime(v.el, w.t); if (!isFinite(tt)) tt = w.t + 600; }
      w.addNode(v, tt); this.nodeSel = v.nodes.length - 1;
    } else if (a === 'nsel') this.nodeSel = +val;
    else if (a === 'ndel') { v.nodes.splice(this.nodeSel, 1); this.nodeSel = Math.max(0, this.nodeSel - 1); w.touchNodes(); }
    else if (a === 'nwarp') { const n = v.nodes[this.nodeSel]; if (n) w.warpTo = n.t - 25; }
    else if (a === 'auto') v.autoNodes = v.autoNodes === false;
    else if (a === 'step') this.step = this.step >= 1000 ? 1 : this.step * 10;
    else if (a === 'tm' || a === 'tp') { const n = v.nodes[this.nodeSel]; if (n) { n.t += (a === 'tp' ? 1 : -1) * Math.max(60, this.step * 6); n.t = Math.max(w.t + 5, n.t); v.nodes.sort((x, y) => x.t - y.t); w.touchNodes(); } }
    else if (a.startsWith('dv-')) { const [, k, d] = a.split('-'); const n = v.nodes[this.nodeSel]; if (n) { n.dv[k] += (d === 'p' ? 1 : -1) * this.step; w.touchNodes(); } }
    this.refreshSide(true);
  }
}
