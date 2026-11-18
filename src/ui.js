// HUD: strength bar, timer, objectives, minimap, unit cards, order buttons, messages, end screen.
import { drawGlyph, SIDE_COLOR } from './units.js';
import { Orders } from './input.js';
import { MAP, HALF, VILLAGE } from './terrain.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(world, game, input, rts) {
    this.w = world; this.game = game; this.input = input; this.rts = rts; this.acc = 0;
    this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
    this.base = world.terrain.minimapCanvas(200);
    this.cards = new Map();
    const box = $('cards');
    for (const r of world.regs.filter(q => q.side === 'player')) {
      const el = document.createElement('div'); el.className = 'card';
      el.innerHTML = '<div class="men"></div><canvas width="44" height="44"></canvas><div class="nm"></div><div class="bar hp"><i></i></div><div class="bar mo"><i></i></div>';
      el.querySelector('.nm').textContent = r.def.short;
      el.title = r.name + ' (' + r.def.name + ')';
      const cv = el.querySelector('canvas'), cx = cv.getContext('2d');
      cx.fillStyle = '#12100c'; cx.fillRect(0, 0, 44, 44);
      cx.fillStyle = SIDE_COLOR.player; cx.fillRect(0, 0, 44, 6);
      drawGlyph(cx, r.typeId, 22, 26, 30, '#e8d7a8');
      el.addEventListener('click', e => world.select([r], e.shiftKey));
      el.addEventListener('dblclick', () => { world.select([r], false); rts.focusOn(r.x, r.z); });
      box.appendChild(el);
      this.cards.set(r, { el, hp: el.querySelector('.hp i'), mo: el.querySelector('.mo i'), men: el.querySelector('.men') });
    }
    $('o-halt').onclick = () => Orders.halt(world.selection);
    $('o-fire').onclick = () => Orders.toggleFire(world.selection);
    $('o-run').onclick = () => Orders.toggleRun(world.selection);
    $('o-tight').onclick = () => Orders.formation(world.selection, 'tight');
    $('o-loose').onclick = () => Orders.formation(world.selection, 'loose');
    $('end-btn').onclick = () => location.reload();
    const mmMove = (e) => {
      const b = this.mm.getBoundingClientRect();
      rts.focusOn(((e.clientX - b.left) / b.width) * MAP - HALF, ((e.clientY - b.top) / b.height) * MAP - HALF);
    };
    this.mm.addEventListener('mousedown', e => { this.mmDrag = true; mmMove(e); });
    window.addEventListener('mousemove', e => { if (this.mmDrag) mmMove(e); });
    window.addEventListener('mouseup', () => { this.mmDrag = false; });
    this.mm.addEventListener('contextmenu', e => e.preventDefault());
  }
  banner(text, ms = 3000) { const b = $('banner'); b.textContent = text; if (ms) setTimeout(() => { if (b.textContent === text) b.textContent = ''; }, ms); }

  update(dt) {
    // messages are cheap; flush every frame
    const w = this.w;
    while (w.messages.length) {
      const m = w.messages.shift(), d = document.createElement('div');
      d.className = m.side; d.textContent = m.text; $('messages').appendChild(d);
      setTimeout(() => d.remove(), 6200);
      while ($('messages').children.length > 5) $('messages').firstChild.remove();
    }
    this.acc += dt; if (this.acc < 0.12) return; this.acc = 0;
    // strength
    const str = (side) => w.regs.reduce((a, r) => a + (r.side === side && r.state !== 'gone' ? r.men * (r.state === 'routing' ? 0.35 : 1) : 0), 0);
    const p = str('player'), e = str('enemy');
    $('bal-red').style.width = (p / Math.max(1, p + e) * 100) + '%';
    $('str-red').textContent = Math.round(p); $('str-blue').textContent = Math.round(e);
    const t = Math.floor(w.time);
    $('timer').textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + (w.paused ? ' (paused)' : w.speed !== 1 ? ' x' + w.speed : '');
    // objectives
    const o = w.objectives;
    $('obj-village').classList.toggle('done', o.village);
    $('obj-guns').classList.toggle('done', o.guns);
    $('obj-rout').classList.toggle('done', o.rout);
    $('obj-hint').textContent = o.village ? 'Hold the village to win (' + Math.max(0, Math.ceil(75 - w.villageHold)) + 's)' : w.villageHold > 0 ? 'Capturing... ' + Math.floor(w.villageHold) + '/15s' : '';
    // cards
    for (const [r, c] of this.cards) {
      c.el.classList.toggle('selected', r.selected);
      c.el.classList.toggle('wavering', r.state === 'wavering'); c.el.classList.toggle('routing', r.state === 'routing'); c.el.classList.toggle('gone', r.state === 'gone');
      c.hp.style.width = (r.men / r.maxMen * 100) + '%'; c.mo.style.width = Math.max(0, r.morale / r.def.morale * 100) + '%';
      c.men.textContent = r.men;
    }
    for (const [id, v] of [['o-fire', w.selection.length && w.selection.every(r => r.fireAtWill)], ['o-run', w.selection.length && w.selection.every(r => r.run)],
      ['o-tight', w.selection.length && w.selection.every(r => r.formationMode === 'tight')], ['o-loose', w.selection.length && w.selection.every(r => r.formationMode === 'loose')]]) $(id).classList.toggle('on', !!v);
    $('o-fire').textContent = w.selection.length && w.selection.every(r => !r.fireAtWill) ? 'Hold' : 'Fire';
    this.drawMinimap();
  }

  drawMinimap() {
    const ctx = this.mctx, S = 200, k = S / MAP, w = this.w;
    ctx.drawImage(this.base, 0, 0);
    const X = (x) => (x + HALF) * k, Z = (z) => (z + HALF) * k;
    ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(VILLAGE.x), Z(VILLAGE.z), VILLAGE.r * k, 0, 6.3); ctx.stroke();
    for (const r of w.regs) {
      if (r.state === 'gone') continue;
      ctx.fillStyle = r.state === 'routing' ? '#999' : SIDE_COLOR[r.side];
      const s = r.def.id === 'artillery' ? 3 : 4;
      ctx.fillRect(X(r.x) - s / 2, Z(r.z) - s / 2, s, s);
      if (r.selected) { ctx.strokeStyle = '#fff'; ctx.strokeRect(X(r.x) - 3.5, Z(r.z) - 3.5, 7, 7); }
    }
    // camera footprint
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => this.input.groundAtNDC(a, b));
    if (pts.every(Boolean)) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))); ctx.closePath(); ctx.stroke();
    }
  }

  showEnd(victory, text) {
    $('end-title').textContent = victory ? 'Victory' : 'Defeat';
    $('end-text').innerHTML = text;
    $('endscreen').style.display = 'flex';
    $('endscreen').style.pointerEvents = 'auto';
  }
}
