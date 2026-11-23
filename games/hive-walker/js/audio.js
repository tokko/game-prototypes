// Procedural Web Audio: everything is synthesised, no assets.
export class Sfx {
  constructor() { this.ctx = null; }
  slow(on) { if (this.lp) this.lp.frequency.setTargetAtTime(on ? 700 : 22000, this.ctx.currentTime, 0.05); }   // the tactical view: muffled
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 6;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 22000; this.master.connect(this.lp); this.lp.connect(this.comp); this.comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    // battlefield ambience: low rumble
    const amb = ctx.createBufferSource(); amb.buffer = this.brown; amb.loop = true;
    const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 160;
    const ag = ctx.createGain(); ag.gain.value = 0.5; amb.connect(af); af.connect(ag); ag.connect(this.master); amb.start();
    // inferno projector: roaring hiss
    const fn = ctx.createBufferSource(); fn.buffer = this.brown; fn.loop = true; const fb = ctx.createBiquadFilter(); fb.type = 'bandpass'; fb.frequency.value = 380; fb.Q.value = 0.5;
    const fw = ctx.createBufferSource(); fw.buffer = this.white; fw.loop = true; const fh = ctx.createBiquadFilter(); fh.type = 'bandpass'; fh.frequency.value = 2600; fh.Q.value = 0.4; const fhg = ctx.createGain(); fhg.gain.value = 0.22;
    this.fGain = ctx.createGain(); this.fGain.gain.value = 0; const flfo = ctx.createOscillator(); flfo.frequency.value = 9; const flg = ctx.createGain(); flg.gain.value = 0.12;
    fn.connect(fb); fb.connect(this.fGain); fw.connect(fh); fh.connect(fhg); fhg.connect(this.fGain); this.fGain.connect(this.master); flfo.connect(flg); flg.connect(this.fGain.gain); fn.start(); fw.start(); flfo.start();
    // skid: metal-on-stone screech = resonant noise + detuned saws
    const sn = ctx.createBufferSource(); sn.buffer = this.white; sn.loop = true;
    this.sF = ctx.createBiquadFilter(); this.sF.type = 'bandpass'; this.sF.frequency.value = 2400; this.sF.Q.value = 9;
    const sn2 = ctx.createBiquadFilter(); sn2.type = 'bandpass'; sn2.frequency.value = 520; sn2.Q.value = 2;
    this.sGain = ctx.createGain(); this.sGain.gain.value = 0;
    sn.connect(this.sF); this.sF.connect(this.sGain); sn.connect(sn2); sn2.connect(this.sGain);
    this.sOsc = ctx.createOscillator(); this.sOsc.type = 'sawtooth'; this.sOsc.frequency.value = 1730; const sog = ctx.createGain(); sog.gain.value = 0.12;
    this.sOsc.connect(sog); sog.connect(this.sGain); this.sGain.connect(this.master); sn.start(); this.sOsc.start();
  }
  get t() { return this.ctx.currentTime; }
  _noise(buf, dur, f0, f1, vol, type = 'lowpass', q = 0.7, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(type, f0, f1, dur, vol, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  cannon() {
    if (!this.ctx) return;
    this._tone('sine', 110, 26, 0.9, 1.1); this._tone('triangle', 60, 22, 1.2, 0.8);
    this._noise(this.white, 0.35, 3000, 200, 0.9); this._noise(this.brown, 1.4, 500, 40, 1.0);
  }
  missile() {
    if (!this.ctx) return;
    this._noise(this.white, 1.1, 500, 3600, 0.3, 'bandpass', 1.2); this._noise(this.brown, 0.7, 900, 150, 0.4);
  }
  footstep(v = 1) {
    if (!this.ctx) return;
    this._tone('sine', 70, 24, 0.5, 0.9 * v); this._noise(this.brown, 0.45, 420, 50, 0.9 * v);
    this._noise(this.white, 0.12, 2400, 700, 0.12 * v, 'bandpass', 3); // metal clank
    this._tone('square', 190, 120, 0.09, 0.05 * v, 0.03);
  }
  // generic explosion heard from dist metres; size ~0.3..4
  boom(dist, size = 1) {
    if (!this.ctx) return;
    const v = Math.min(1.3, size * 1.4 / (1 + Math.pow(dist / (70 * Math.sqrt(size)), 1.6)));
    if (v < 0.012) return;
    const delay = Math.min(1.2, dist / 900);
    const cut = 2600 / (1 + dist / 120);
    this._noise(this.brown, 0.8 + size * 0.5, 200 + cut, 35, v, 'lowpass', 0.7, delay);
    this._tone('sine', 55 + 30 / size, 20, 0.7 + size * 0.35, v * 0.9, delay);
    if (dist < 120) this._noise(this.white, 0.2, 5000, 600, v * 0.5, 'lowpass', 0.7, delay);
  }
  stomp(dist, size = 1) {
    if (!this.ctx) return;
    const v = Math.min(1.4, 2.2 * size / (1 + Math.pow(dist / 160, 1.5))); if (v < 0.02) return;
    this._tone('sine', 42, 16, 1.6, v); this._noise(this.brown, 1.5, 260, 30, v);
    this._noise(this.white, 0.3, 1500, 300, v * 0.12, 'bandpass', 2, 0.05);
  }
  whistle(dur = 1.4, vol = 0.12) { if (!this.ctx) return; this._tone('sine', 2100, 500, dur, vol); this._tone('sine', 2160, 520, dur, vol * 0.6); }
  alarm() { if (!this.ctx) return; this._tone('square', 620, 620, 0.16, 0.12); this._tone('square', 440, 440, 0.16, 0.12, 0.2); }
  melta(dist = 0) { if (!this.ctx) return; const v = 0.7 / (1 + dist / 60); this._noise(this.white, 0.6, 7000, 900, v, 'bandpass', 4); this._tone('sawtooth', 900, 90, 0.6, v * 0.35); }
  charge(dur, vol = 0.2) { if (!this.ctx) return; this._tone('sawtooth', 40, 420, dur, vol); this._noise(this.white, dur, 300, 5000, vol * 0.4, 'bandpass', 3); }
  lance(dist) { if (!this.ctx) return; const v = Math.min(1.2, 2.5 / (1 + dist / 150)); this._noise(this.white, 1.3, 6000, 300, v * 0.6, 'bandpass', 1.5); this._tone('sawtooth', 70, 30, 1.6, v * 0.6); this._noise(this.brown, 2.0, 700, 40, v); }
  hit() { if (!this.ctx) return; this._noise(this.white, 0.15, 3000, 500, 0.4, 'bandpass', 2); this._tone('square', 160, 60, 0.2, 0.25); }
  lockTone(ok) { if (!this.ctx) return; this._tone('square', ok ? 1320 : 880, ok ? 1320 : 880, 0.06, 0.06); }
  flame(v) { if (!this.ctx) return; this.fGain.gain.setTargetAtTime(v * 0.95, this.t, v ? 0.05 : 0.12); }
  flameStart() { if (!this.ctx) return; this._tone('square', 2400, 1800, 0.03, 0.12); this._tone('sine', 150, 42, 0.5, 0.8, 0.04); this._noise(this.brown, 0.55, 1400, 120, 0.9, 'lowpass', 0.7, 0.04); }
  flameStop() { if (!this.ctx) return; this._noise(this.brown, 0.7, 500, 60, 0.4); for (let i = 0; i < 3; i++) this._noise(this.white, 0.1, 1200, 300, 0.12, 'bandpass', 1, 0.12 + i * 0.16 + Math.random() * 0.06); }
  flameCrackle() { if (!this.ctx) return; this._noise(this.white, 0.03 + Math.random() * 0.04, 3000 + Math.random() * 3000, 1500, 0.09, 'bandpass', 3); }
  skid(v) {
    if (!this.ctx) return; const t = this.t;
    this.sGain.gain.setTargetAtTime(v * 0.5, t, 0.04); this.sF.frequency.setTargetAtTime(1900 + v * 1500, t, 0.05); this.sOsc.frequency.setTargetAtTime(1400 + v * 900, t, 0.05);
  }
  veilHit(a = 1) { if (!this.ctx) return; const v = Math.min(0.35, 0.08 + a * 0.02); this._tone('sine', 1500, 700, 0.25, v); this._noise(this.white, 0.18, 6000, 2500, v * 0.6, 'bandpass', 6); }
  veilBreak() {
    if (!this.ctx) return;
    for (let i = 0; i < 7; i++) this._tone('triangle', 2200 + Math.random() * 3800, 900 + Math.random() * 800, 0.25 + Math.random() * 0.3, 0.16, i * 0.025);   // glass
    this._noise(this.white, 0.5, 9000, 1800, 0.6, 'highpass', 1); this._tone('sine', 95, 28, 0.9, 0.9); this._noise(this.brown, 0.8, 600, 50, 0.8);
    for (let i = 0; i < 9; i++) this._tone('square', 60 + Math.random() * 50, 50, 0.05, 0.13, 0.25 + i * 0.07 + Math.random() * 0.03);                 // electric fizzle
    this._noise(this.white, 1.0, 5000, 7000, 0.12, 'bandpass', 12, 0.25);
  }
  veilUp() { if (!this.ctx) return; this._tone('sine', 110, 440, 5.5, 0.07); this._tone('triangle', 221, 884, 5.5, 0.035); }
  horn() { if (!this.ctx) return; this._tone('sawtooth', 58, 55, 1.8, 0.5); this._tone('sawtooth', 87, 82, 1.6, 0.32, 0.05); this._tone('square', 116, 110, 1.4, 0.16, 0.1); this._noise(this.brown, 1.2, 400, 60, 0.4); }   // WAR HORN: a low brass blare
  klaxon(v = 0.2) { if (!this.ctx) return; this._tone('sawtooth', 300, 420, 0.45, v); this._tone('sawtooth', 302, 424, 0.45, v * 0.7); }
  crunch(v = 1) {   // masonry giving way
    if (!this.ctx) return;
    this._noise(this.brown, 1.1, 900, 40, 1.0 * v); this._tone('sine', 80, 24, 0.7, 0.9 * v);
    for (let i = 0; i < 6; i++) this._noise(this.white, 0.09, 1800 + Math.random() * 1500, 500, 0.3 * v, 'bandpass', 2, i * 0.07 + Math.random() * 0.05);
  }
  crack(dist) { if (!this.ctx) return; const v = 0.25 / (1 + dist / 50); if (v < 0.01) return; this._noise(this.white, 0.07, 4000, 1200, v, 'bandpass', 1.5); }
}
