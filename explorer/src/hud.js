// Minimal sci-fi HUD helpers (DOM): toasts, prompts, gauges, compass strip, dynamic button panels, overlays.
const $ = (id) => document.getElementById(id);
const sigs = new Map();

export const hud = {
  init() { this.compass = $('compassCv'); this.ctx = this.compass.getContext('2d'); },
  show(on) { $('hud').classList.toggle('hidden', !on); },
  toast(text, kind = 'info', big = false) {
    const box = $('toasts');
    for (const c of [...box.children]) if (c.dataset.t === text) c.remove();
    const d = document.createElement('div'); d.className = 'toast ' + kind + (big ? ' big' : ''); d.textContent = text; d.dataset.t = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), big ? 3600 : 3000); setTimeout(() => d.remove(), big ? 4500 : 3900);
  },
  mode(label, sub) { $('ml-mode').textContent = label; $('ml-sub').textContent = sub || ''; },
  prompts(list) {
    const sig = list.join('|'); if (sigs.get('prompt') === sig) return; sigs.set('prompt', sig);
    $('prompt').innerHTML = list.map((p) => { const [k, t] = p.split('|'); return `<div><kbd>${k}</kbd>${t}</div>`; }).join('');
  },
  gauges(rows) {
    // rows: [{l, v}] up to 3 + air row
    const ids = ['g1', 'g2', 'g3'];
    rows.slice(0, 3).forEach((r, i) => { $(ids[i] + 'l').textContent = r.l; $(ids[i]).textContent = r.v; });
    $('g3').parentElement.style.display = rows[2] ? '' : 'none';
  },
  /** Prospector ground-survey panel. d = null (hidden) | {stowed:true} | {here, best, dist, rel (rad clockwise from the nose, null = local maximum), kind} */
  survey(d) {
    const el = $('survey'); if (!d) { el.classList.add('hidden'); return; } el.classList.remove('hidden');
    if (d.stowed) { $('sv-fill').style.width = '0%'; $('sv-pct').textContent = 'MAST STOWED'; $('sv-text').textContent = 'Y raises the sensor mast (it rises when driving)'; $('sv-arrow').style.opacity = 0.2; return; }
    const pct = Math.round(d.here * 100); $('sv-fill').style.width = pct + '%'; $('sv-pct').textContent = `RICHNESS ${pct}%  ${d.kind === 'ice' ? 'ICE' : 'REGOLITH'}`;
    $('sv-arrow').style.opacity = d.rel == null ? 0.25 : 1; $('sv-arrow').style.transform = `rotate(${((d.rel ?? 0) - Math.PI / 2).toFixed(3)}rad)`;
    $('sv-text').textContent = d.rel == null ? 'Local maximum: drill here (V)' : `Richer ground ${d.dist.toFixed(0)} m this way (+${Math.max(1, Math.round((d.best - d.here) * 100))}%)`;
  },
  air(text) { const r = $('gAirRow'); r.style.display = text ? '' : 'none'; if (text) $('gAir').textContent = text; },
  bar(id, frac, show = true, label) {
    const el = $(id); const bar = el.parentElement; bar.style.display = show ? '' : 'none';
    el.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
    if (label) $(id + '-l').textContent = label;
  },
  dv(text) { $('gdv').textContent = text; },
  flags(list) { const sig = list.join('|'); if (sigs.get('flags') === sig) return; sigs.set('flags', sig); $('flags').innerHTML = list.map((f) => `<span>${f}</span>`).join(''); },
  inv(text) { $('inv-text').textContent = text; },
  /** dynamic buttons: defs [{k, label, title, on, disabled, fn}] re-rendered only when the signature changes */
  buttons(id, defs) {
    const el = $(id);
    el.classList.toggle('hidden', !defs.length);
    const sig = defs.map((d) => `${d.label}|${d.on ? 1 : 0}|${d.disabled ? 1 : 0}`).join(';');
    if (sigs.get(id) === sig) { sigs.set(id + ':defs', defs); return; }
    sigs.set(id, sig); sigs.set(id + ':defs', defs);
    el.innerHTML = '';
    defs.forEach((d, i) => {
      const b = document.createElement('button'); b.innerHTML = (d.k ? `<kbd>${d.k}</kbd>` : '') + d.label; b.title = d.title || '';
      if (d.on) b.classList.add('on'); if (d.disabled) b.disabled = true;
      b.onclick = () => { const cur = sigs.get(id + ':defs')[i]; cur.fn && cur.fn(); };
      el.appendChild(b);
    });
  },
  compassDraw(heading, pois) {
    const cv = this.compass, c = this.ctx, W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    const span = 150 * Math.PI / 180;
    const x = (b) => { let d = b - heading; d = Math.atan2(Math.sin(d), Math.cos(d)); return W / 2 + (d / span) * W; };
    c.font = '600 12px ui-monospace,monospace'; c.textAlign = 'center';
    const grad = c.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.2, 'rgba(255,255,255,.8)'); grad.addColorStop(0.8, 'rgba(255,255,255,.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.strokeStyle = grad; c.fillStyle = grad; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, 30); c.lineTo(W, 30); c.stroke();
    for (let d = 0; d < 360; d += 10) {
      const px = x(d * Math.PI / 180); if (px < 0 || px > W) continue;
      const major = d % 90 === 0, mid = d % 30 === 0;
      c.beginPath(); c.moveTo(px, 30); c.lineTo(px, 30 - (major ? 11 : mid ? 8 : 5)); c.stroke();
      if (major) { c.fillStyle = '#ffb347'; c.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d], px, 15); }
      else if (mid) { c.fillStyle = 'rgba(200,215,235,.8)'; c.fillText(String(d), px, 18); }
    }
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(W / 2, 33); c.lineTo(W / 2 - 5, 40); c.lineTo(W / 2 + 5, 40); c.fill();
    for (const p of pois) {
      const px = x(p.bearing); if (px < 6 || px > W - 6) continue;
      c.fillStyle = p.color; c.strokeStyle = p.color;
      c.beginPath(); c.moveTo(px, 24); c.lineTo(px + 5, 29); c.lineTo(px, 34); c.lineTo(px - 5, 29); c.closePath(); p.found ? c.fill() : c.stroke();
      c.fillStyle = 'rgba(230,240,255,.9)'; c.font = '10px ui-monospace,monospace'; c.fillText(p.label, px, 8);
    }
  },
  overlay(id, on) { $(id).classList.toggle('hidden', !on); },
  isOpen(id) { return !$(id).classList.contains('hidden'); },
};
export const $el = $;
