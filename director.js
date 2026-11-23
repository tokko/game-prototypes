// The hidden attention director. Each frame it tracks the player's gaze (view cone, dwell on a
// target), turn-arounds and a decaying tension scalar with a short scare history. Every few seconds
// it considers one event from the EVENTS table. Audio events are common, visual ones rare; a visual
// event is cued by a related sound first, spawns only while its anchor is unobserved, and changes or
// vanishes only while it is unobserved. A long look is denied with a lamp flicker or a fog swell.
// On top of that random layer sits the authored BEATS table: one-shot set pieces at fixed places that
// carry the walk. They obey the same rules, take priority, and quiet the random events around them.
import * as THREE from 'three';
import * as P from './path.js';
import { createApparitions } from './apparitions.js';
import { createBeast } from './beast.js';

// ===== TUNING: every director constant lives here ===================================================
export const TUNING = {
  START_GRACE: 20,            // s of walking before the first event
  DECIDE_EVERY: [3, 5.5],     // s between considerations (random in range)
  AUDIO_CHANCE: 0.3,          // chance an audio event is attempted per consideration (before zone scale and tension damping)
  VISUAL_CHANCE: 0.1,         // chance a visual event is attempted per consideration (before zone scale)
  AUDIO_GLOBAL_CD: 10,        // s between any two audio events (before zone scale)
  VISUAL_GLOBAL_CD: 60,       // s between any two visual events
  VISUAL_MAX_TENSION: 0.35,   // visuals are withheld above this tension (events may set a lower max)
  AUDIO_MAX_TENSION: 0.8,     // audio events are withheld above this
  AUDIO_TENSION_DAMP: 0.6,    // audio chance is scaled by (1 - this * tension)
  TENSION_TAU: 28,            // s, exponential decay time constant of tension
  TENSION_AUDIO: 0.06,        // default tension added by an audio event
  TENSION_VISUAL: 0.3,        // added when a visual event spawns
  TENSION_NOTICE: 0.25,       // added when the player notices an apparition
  TENSION_TURN: 0.12,         // added by a turn-around
  VIEW_CONE_DEG: 52,          // half angle of "observed" (roughly the screen)
  GAZE_CONE_DEG: 18,          // half angle of "looking straight at it" (dwell accrues here)
  FOG_VISIBLE_MIN: 0.08,      // fog transmission below this counts as not visible
  LAMP_VISIBLE_MIN: 0.45,     // an associated lamp dimmer than this counts as not lit
  NOTICE_DWELL: 0.7,          // s of gaze before an apparition counts as noticed
  DWELL_FORGET: 2,            // dwell drains this many times faster than it builds once gaze leaves
  TURN_DEG: 120,              // yaw swing that counts as a turn-around ...
  TURN_WINDOW: 1.0,           // ... within this many seconds
  CUE_LEAD: [2.5, 5],         // s from the audio cue to the spawn attempt
  PENDING_TIMEOUT: 12,        // s a cued spawn waits for its anchor to be unobserved before giving up
  PENDING_STARE_MAX: 4,       // s of staring at the empty anchor region before the event is dropped
  SPAWN_LEAD: 14,             // m before an anchor's viewFrom range from which it may already spawn
  WINDOW_RANGE: [9, 60],      // m from a window at which its apparition may spawn
  ANCHOR_REUSE_CD: 150,       // s before the same anchor is used again
  CHANGE_CHANCE: 0.5,         // on look-away after being noticed: change (if it can) rather than vanish
  LIFETIME: 45,               // s an unnoticed apparition lingers, vanishing when next unobserved
  DENY_FLICKER_CHANCE: 0.7,   // when a lamp is available, chance to deny with a flicker rather than fog
  DENY_SWELL_MAX: 0.3,        // max fog density added by a fog swell
  HISTORY_N: 12,              // scare history length
  REPEAT_WINDOW: 150,         // s over which repeats of an event reduce its weight
  REPEAT_PENALTY: 1.0,        // weight divisor grows by this per recent repeat
  // beats (authored set pieces, see BEATS)
  BEAT_QUIET: 12,             // s of no random events after a beat fires or cues (with the lead below: about 20 s around a beat)
  BEAT_LEAD_M: 10,            // m before a beat window opens in which random events are already held back
  BEAT_CUE_LEAD: [1.5, 3],    // s from a visual beat's cue sound to its spawn attempt
  BEAT_FORCE: 5,              // s a beat target stays observed before a flicker/fog swell makes it unobserved
  // the fleshbeast (beast.js) has its own SCRIPTS; this is only the rare random glimpse between the hollow and the courtyard
  BEAST_GLIMPSE_CHANCE: 0.15, // per consideration, once the hollow set piece is done
  BEAST_GLIMPSE_CD: 120,      // s between glimpses
  BEAST_GLIMPSE_S: [296, 344], // arc length range where a glimpse may happen
  // round 2: the random-layer scripted visuals (EVENTS kind 'scripted': the forest wraith, the crossers), rare and short
  SCRIPTED_CHANCE: 0.1,       // per consideration (before the event's own cooldown); they ignore the per-zone visual scale (crossers also walk the village)
  SCRIPTED_GLOBAL_CD: 40,     // s between any two scripted visuals
  SCRIPTED_MAX_TENSION: 0.5,  // withheld above this (events may set a lower max)
  // escalation: how the random layer scales per zone. audio/visual multiply the chances, cd multiplies the
  // audio cooldown, ring multiplies the radius of random sounds, steps multiplies steps-behind weight.
  ZONE: {
    village: { audio: 0.6, visual: 0,   cd: 1.5, ring: 1.3,  steps: 0.5 },   // audio only, sparse
    forest:  { audio: 1.0, visual: 0.5, cd: 1.0, ring: 0.75, steps: 1 },     // closer sounds, rare creature
    estate:  { audio: 1.5, visual: 1,   cd: 0.8, ring: 0.5,  steps: 3 },     // densest, enclosed
  },
};

// ===== event library: plain data. `app`/`cue`/audio ids name implementations in apparitions.js ======
const ALL = ['village', 'forest', 'estate'];
export const EVENTS = [
  // audio only (common)
  { id: 'steps-behind',  kind: 'audio', zones: ALL,                       weight: 2, cooldown: 150, maxTension: 0.4, tension: 0.1, needsMoving: true, minS: 25 },
  { id: 'distant-steps', kind: 'audio', zones: ALL,                       weight: 3, cooldown: 45 },
  { id: 'branch-snap',   kind: 'audio', zones: ['forest'],                weight: 5, cooldown: 30 },
  { id: 'door-creak',    kind: 'audio', zones: ['village', 'estate'],     weight: 3, cooldown: 50 },
  { id: 'knock',         kind: 'audio', zones: ['village', 'estate'],     weight: 2, cooldown: 70 },
  { id: 'whisper',       kind: 'audio', zones: ALL,                       weight: 2, cooldown: 80, maxTension: 0.5, tension: 0.1 },
  { id: 'drag',          kind: 'audio', zones: ['forest', 'estate'],      weight: 2, cooldown: 70 },
  // visual (rare), each preceded by a related sound at its anchor
  { id: 'window-woman',   kind: 'visual', zones: ['village', 'estate'], anchors: 'windows', cue: 'knock',        weight: 1, cooldown: 120, maxTension: 0.3 },
  { id: 'forest-shadow',  kind: 'visual', zones: ['forest'],            anchors: 'covers',  cue: 'branch-snap',  weight: 1, cooldown: 100, maxTension: 0.3 },
  { id: 'distant-figure', kind: 'visual', zones: ['village', 'estate'], anchors: 'ends',    cue: 'door-creak',   weight: 1, cooldown: 120, maxTension: 0.3 },
  // scripted (rare): self-contained actors in apparitions.js with slots of their own (never the `active` one). cooldown may be [min, max].
  { id: 'wraith-drift',   kind: 'scripted', zones: ['forest'],      actor: 'wraith',  weight: 1, cooldown: 150, maxTension: 0.35 },       // a sigh crossing the path, a pale shape between the trunks
  { id: 'crosser',        kind: 'scripted', zones: ALL,             actor: 'crosser', weight: 2, cooldown: [60, 90], tension: 0.03 },    // a dash glimpsed at the edge of the view
];

// ===== beats: authored one-shot set pieces, plain data. Window `s` = [from, to] arc length (PLACES in path.js).
// kind: audio (one cue, `at` = {s, lat, y} on the path frame, lat > 0 right; default is a ring round the player),
// steps (steps-behind), lure (`cue` repeats at `place` every `every` s), toggle (set world.toggles[toggle] while
// unobserved, `cue` optional), visual (`cue` at the anchor, then `ev` spawns there while unobserved; ev, anchor
// and cue name EVENTS/world anchors/apparitions sounds), beast (run SCRIPTS[script] of beast.js; `force` interrupts an
// unseen beast already running), actor (start apparitions.js's r2 actor `actor`, which runs by its own rules and is released
// when the window closes; `after` waits for another beat to have fired, `anchor` reserves a window). A beat that is not done by
// `s[1]` is dropped (a running actor beat is only released there).
export const BEATS = [
  // village: sounds and one glimpse
  { id: 'side-door',        zone: 'village', s: [22, 46],   kind: 'toggle', toggle: 'sideDoor', value: true, cue: 'door-creak' },
  { id: 'square-woman',     zone: 'village', s: [84, 106],  kind: 'visual', ev: 'window-woman', anchor: 'village-square-window', cue: 'knock' },
  { id: 'shrine-candle',    zone: 'village', s: [106, 130], kind: 'toggle', toggle: 'shrineCandle', value: true },
  { id: 'alley-steps',      zone: 'village', s: [134, 146], kind: 'steps' },
  { id: 'angel',            zone: 'village', s: [48, 84],   kind: 'actor', actor: 'angel', tension: 0.03 },                      // behind you in the lane: closer each time you look back
  // forest: a creature to follow, then closer events
  { id: 'lure',             zone: 'forest',  s: [160, 200], kind: 'lure', cue: 'hum', place: 'forest-lantern', every: [8, 12], tension: 0.02 },
  { id: 'wraith',           zone: 'forest',  s: [166, 182], kind: 'actor', actor: 'wraith', tension: 0.03 },                     // a long sigh through the trees (overlaps only the lure's hum)
  { id: 'fence',            zone: 'forest',  s: [181, 196], kind: 'audio', cue: 'heavy-drag', at: { s: 184, lat: 4.4, y: 0.4 }, tension: 0.1 },
  { id: 'clearing-creature', zone: 'forest', s: [200, 238], kind: 'visual', ev: 'forest-shadow', anchor: 'forest-clearing-stone', cue: 'branch-snap' },
  { id: 'beast-warn',       zone: 'forest',  s: [240, 262], kind: 'beast', script: 'warn' },                    // distant moaning, nothing seen
  { id: 'hollow',           zone: 'forest',  s: [262, 280], kind: 'audio', cue: 'whisper', tension: 0.12 },
  { id: 'beast-hollow',     zone: 'forest',  s: [262, 296], kind: 'beast', script: 'hollow', force: true },  // first sighting
  // estate: densest, enclosed
  { id: 'lodge-sobbing',    zone: 'estate',  s: [316, 346], kind: 'actor', actor: 'sob', anchor: 'estate-window-lodge', tension: 0.03 },   // sobbing from the open lodge window; looked at, it stops
  { id: 'courtyard-figure', zone: 'estate',  s: [346, 366], kind: 'visual', ev: 'distant-figure', anchor: 'estate-courtyard-door', cue: 'door-creak' },
  { id: 'landing-light',    zone: 'estate',  s: [370, 388], kind: 'toggle', toggle: 'landingLamp', value: true, cue: 'click' },
  { id: 'corridor-door',    zone: 'estate',  s: [402, 414], kind: 'toggle', toggle: 'corridorDoor', value: true },
  { id: 'corridor-figure',  zone: 'estate',  s: [387, 399], kind: 'visual', ev: 'distant-figure', anchor: 'estate-corridor', cue: 'drag' },
  { id: 'landing-woman',    zone: 'estate',  s: [372, 394], kind: 'actor', actor: 'ceiling', after: 'landing-light' },            // in the lit corner above the landing, seen from the hall as you walk in
  { id: 'beast-courtyard',  zone: 'estate',  s: [356, 376], kind: 'beast', script: 'courtyard' },
  { id: 'beast-corridor',   zone: 'estate',  s: [394, 420], kind: 'beast', script: 'corridor', force: true }, // the payoff
];

const D2R = Math.PI / 180;
const cooldownOf = (ev, roll) => roll ?? (Array.isArray(ev.cooldown) ? ev.cooldown[0] : ev.cooldown);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export function createDirector(game) {
  const { camera, scene, player, world } = game;
  const K = TUNING;
  const cosView = Math.cos(K.VIEW_CONE_DEG * D2R), cosGaze = Math.cos(K.GAZE_CONE_DEG * D2R);

  let t = 0, tension = 0, nextDecide = K.START_GRACE;
  let lastAudioAt = -1e9, lastVisualAt = -1e9;
  const lastFired = {}, anchorUsed = {}, cdRoll = {};       // cdRoll: the rolled cooldown of an event whose cooldown is a [min, max] range
  const history = [];                       // scare history: { id, t }
  let last = null, active = null, pending = null, deny = null, turnCool = 0, focus = null;
  const yawLog = [];
  const fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
  const bst = Object.fromEntries(BEATS.map((b) => [b.id, { st: 'waiting', why: '', next: 0, obsT: 0 }])); // waiting | armed | pending | done
  let quietUntil = -1e9;
  const director = { fogSwell: 0, beatState: bst, update, onPlayerStep };

  // what the beast and the round-2 actors borrow: the "observed" test and the flicker / fog-swell denial of a long look
  const lend = {
    observe: (p, fogK = 1, lamp = null) => observedAt(p, fogK, lamp),
    tension: (v) => { tension = Math.min(1, tension + v); },
    deny(p, dist, lampId) {                     // lampId forces that lamp's flicker; otherwise the nearest lit lamp, else a fog swell
      if (deny) return false;
      const lamp = lampId ? world.lamps.find((l) => l.id === lampId) : world.lamps.filter((l) => l.level > 0.5 && Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < 14)
        .sort((a, b) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z) - Math.hypot(b.pos.x - p.x, b.pos.z - p.z))[0];
      startDeny({ lamp: lamp || null }, dist, !!lampId);
      return !!deny;
    },
    denyDark: () => !!deny && (deny.kind === 'flicker' ? deny.lamp.flicker < 0.3 : director.fogSwell > deny.amp * 0.5),
  };
  const host = {
    ...lend,
    log: (id) => { last = { id, t }; },
    ring: () => K.ZONE[player.zone]?.ring ?? 1,
    denying: () => !!deny,
    gaze: (o) => o.obs && o.cos > cosGaze,      // looking straight at it
    beatOwns: (id) => BEATS.some((b) => b.anchor === id && bst[b.id].st !== 'done'),
  };
  const apparitions = createApparitions(game, host);
  const r2 = apparitions.r2;
  director.apparitions = apparitions;
  const beast = director.beast = createBeast(game, lend);
  let lastGlimpse = -1e9, lastScriptedAt = -1e9;

  function record(id, bump) {
    history.push({ id, t }); if (history.length > K.HISTORY_N) history.shift();
    last = { id, t }; tension = Math.min(1, tension + bump);
  }

  // "Observed": inside the view cone, within fog visibility, and (if tied to a lamp) lit.
  function observedAt(point, fogK = 1, lamp = null) {
    tmp.subVectors(point, camera.position);
    const d = tmp.length();
    if (d < 0.05) return { obs: true, d, cos: 1 };
    const cos = tmp.dot(fwd) / d;
    const tr = Math.exp(-((d * scene.fog.density * fogK) ** 2));
    const lit = !lamp || lamp.flicker > K.LAMP_VISIBLE_MIN;
    return { obs: cos > cosView && tr > K.FOG_VISIBLE_MIN && lit, d, cos };
  }
  const lampFor = (a) => (a.lightPos ? world.lamps.find((l) => l.pos.distanceToSquared(a.lightPos) < 0.01) || null : null);

  // ---- anchors -------------------------------------------------------------------------------------
  function anchorOk(ev, a) {
    if (ev.anchors === 'windows') {
      if (a.zone !== player.zone || P.interiorAt(player.s) > 0.3) return false;
      const dx = camera.position.x - a.pos.x, dz = camera.position.z - a.pos.z, d = Math.hypot(dx, dz);
      return dx * a.normal.x + dz * a.normal.z > 0 && d >= K.WINDOW_RANGE[0] && d <= K.WINDOW_RANGE[1];
    }
    if (a.zone !== player.zone) return false;
    return player.s >= a.viewFrom[0] - K.SPAWN_LEAD && player.s <= a.viewFrom[1];
  }
  function pickAnchor(ev, app) {
    const c = [];
    for (const a of world.anchors[ev.anchors]) {
      if (a.reserved || t - (anchorUsed[a.id] ?? -1e9) < K.ANCHOR_REUSE_CD || !anchorOk(ev, a)) continue;   // reserved: an actor beat owns it (the open lodge window)
      if (BEATS.some((b) => b.anchor === a.id && bst[b.id].st !== 'done')) continue;   // a beat owns this anchor
      const lamp = lampFor(a);
      if (!observedAt(app.pointFor(a), app.fogK, lamp).obs) c.push({ a, lamp });
    }
    return c.length ? c[(Math.random() * c.length) | 0] : null;
  }

  // ---- event selection -----------------------------------------------------------------------------
  function eligible(ev) {
    if (!ev.zones.includes(player.zone)) return false;
    if (t - (lastFired[ev.id] ?? -1e9) < cooldownOf(ev, cdRoll[ev.id])) return false;
    if (tension > (ev.maxTension ?? 1)) return false;
    if (ev.needsMoving && player.speed < 0.4) return false;
    if (ev.minS && player.s < ev.minS) return false;
    return true;
  }
  function weightOf(ev) {
    const recent = history.filter((h) => h.id === ev.id && t - h.t < K.REPEAT_WINDOW).length;
    const zone = ev.id === 'steps-behind' ? K.ZONE[player.zone].steps : 1;
    return ev.weight * zone / (1 + recent * K.REPEAT_PENALTY) * (last && last.id === ev.id ? 0.25 : 1);
  }
  function pickWeighted(list) {
    const w = list.map((x) => weightOf(x.ev)), tot = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  const cueAt = (cue, a) => ({ x: a.pos.x, y: cue === 'door-creak' ? 1.2 : a.pos.y + 0.3, z: a.pos.z });
  function tryVisual() {
    const list = [];
    for (const ev of EVENTS) {
      if (ev.kind !== 'visual' || !eligible(ev)) continue;
      const pick = pickAnchor(ev, apparitions.visual[ev.id]);
      if (pick) list.push({ ev, ...pick });
    }
    if (!list.length) return false;
    const c = pickWeighted(list), ev = c.ev;
    lastFired[ev.id] = lastVisualAt = t;
    anchorUsed[c.a.id] = t;
    apparitions.audio[ev.cue](cueAt(ev.cue, c.a)); // sound before sight
    record(`${ev.id}:cue`, 0.03);
    pending = { ev, a: c.a, lamp: c.lamp, at: t + rand(...K.CUE_LEAD), expires: t + K.PENDING_TIMEOUT + K.CUE_LEAD[1], stare: 0 };
    return true;
  }
  function tryAudio() {
    const list = EVENTS.filter((ev) => ev.kind === 'audio' && eligible(ev)).map((ev) => ({ ev }));
    if (!list.length) return;
    const ev = pickWeighted(list).ev;
    lastFired[ev.id] = lastAudioAt = t;
    if (ev.id === 'steps-behind') apparitions.steps.start(); else apparitions.audio[ev.id]();
    record(ev.id, ev.tension ?? K.TENSION_AUDIO);
  }
  function tryScripted() {
    const list = EVENTS.filter((ev) => ev.kind === 'scripted' && eligible(ev)).map((ev) => ({ ev }));
    if (!list.length) return false;
    const ev = pickWeighted(list).ev;
    if (!r2.start(ev.actor, ev)) return false;                   // e.g. no open gap in the periphery just now: try again later
    lastFired[ev.id] = lastScriptedAt = t;
    if (Array.isArray(ev.cooldown)) cdRoll[ev.id] = rand(...ev.cooldown);
    record(ev.id, ev.tension ?? K.TENSION_AUDIO);
    return true;
  }
  function decide() {
    nextDecide = t + rand(...K.DECIDE_EVERY);
    if (t < K.START_GRACE || beatQuiet()) return;
    if (beast.busy || r2.busy) return;
    if (bst['beast-hollow'].st === 'done' && !active && !pending && player.s >= K.BEAST_GLIMPSE_S[0] && player.s <= K.BEAST_GLIMPSE_S[1] &&
        t - lastGlimpse > K.BEAST_GLIMPSE_CD && tension <= K.VISUAL_MAX_TENSION && Math.random() < K.BEAST_GLIMPSE_CHANCE && beast.start('glimpse')) {
      lastGlimpse = t; record('beast-glimpse', 0); return;
    }
    const busy = apparitions.steps.active, Z = K.ZONE[player.zone];
    if (!busy && !active && !pending && t - lastVisualAt > K.VISUAL_GLOBAL_CD && tension <= K.VISUAL_MAX_TENSION && Math.random() < K.VISUAL_CHANCE * Z.visual && tryVisual()) return;
    if (!busy && !active && !pending && t - lastScriptedAt > K.SCRIPTED_GLOBAL_CD && tension <= K.SCRIPTED_MAX_TENSION && Math.random() < K.SCRIPTED_CHANCE && tryScripted()) return;
    if (!busy && t - lastAudioAt > K.AUDIO_GLOBAL_CD * Z.cd && tension <= K.AUDIO_MAX_TENSION &&
        Math.random() < K.AUDIO_CHANCE * Z.audio * (1 - K.AUDIO_TENSION_DAMP * tension)) tryAudio();
  }

  // ---- beats: authored set pieces on top of the random layer ------------------------------------------
  // Random events are held back around a beat: while one is armed or pending, shortly before a window opens,
  // and for BEAT_QUIET seconds after a beat fires.
  function beatQuiet() {
    if (t < quietUntil || beast.busy) return true;
    return BEATS.some((b) => { const st = bst[b.id].st; return b.kind !== 'lure' && (st === 'armed' || st === 'pending' || (st === 'waiting' && player.s >= b.s[0] - K.BEAT_LEAD_M && player.s < b.s[0])); });
  }
  const endBeat = (b, why) => { bst[b.id].st = 'done'; bst[b.id].why = why; };
  function beatPos(b) {
    if (b.at) { const p = P.pointAt(b.at.s); return { x: p.x + p.rx * b.at.lat, y: b.at.y, z: p.z + p.rz * b.at.lat }; }
    if (b.place) { const p = world.places[b.place].pos; return { x: p.x, y: p.y || 1.2, z: p.z }; }
    return undefined;                                   // the sound's own default (a ring round the player)
  }
  function updateBeats(dt) {
    for (const b of BEATS) {
      const B = bst[b.id];
      if (b.kind === 'actor' && B.st === 'pending') {            // a running actor drives itself; release it when the window closes, finish when it ends
        if (!r2.running(b.actor)) endBeat(b, r2.result(b.actor) || 'done');
        else if (player.s > b.s[1] && !B.released) { B.released = true; r2.release(b.actor); }
        continue;
      }
      if (B.st === 'done' || B.st === 'pending') continue;       // a pending visual beat is driven by updatePending
      if (player.s > b.s[1]) { endBeat(b, b.kind === 'lure' && B.st === 'armed' ? 'ended' : 'missed'); continue; }
      if (player.zone !== b.zone || player.s < b.s[0]) continue;
      B.st = 'armed';
      const fire = () => { if (b.kind !== 'lure') quietUntil = t + K.BEAT_QUIET; record(b.id, b.tension ?? 0); };   // the lure repeats and sits under the random layer
      if (b.kind === 'audio') {
        apparitions.audio[b.cue](beatPos(b)); lastAudioAt = t; fire(); endBeat(b, 'fired');
      } else if (b.kind === 'steps') {
        if (apparitions.steps.active) continue;
        apparitions.steps.start(); lastAudioAt = t; fire(); endBeat(b, 'fired');
      } else if (b.kind === 'lure') {
        if (t >= B.next) { apparitions.audio[b.cue](beatPos(b)); B.next = t + rand(...b.every); fire(); }
      } else if (b.kind === 'toggle') {
        const tog = world.toggles[b.toggle], o = observedAt(tog.gaze);
        if (o.obs) {                                                      // wait for it to be unobserved; make it so if the player keeps watching
          B.obsT += dt;
          if (B.obsT > K.BEAT_FORCE && !deny) startDeny({ lamp: null }, o.d);
          continue;
        }
        if (b.cue) apparitions.audio[b.cue]({ x: tog.gaze.x, y: tog.gaze.y, z: tog.gaze.z });
        tog.set(b.value); fire(); endBeat(b, 'fired');
      } else if (b.kind === 'beast') {
        if ((active || pending) && player.s < b.s[0] + 4) continue;      // let a visible apparition finish first (but not for long)
        if (!beast.start(b.script, b.force)) continue;
        lastAudioAt = t; fire(); endBeat(b, 'fired');
      } else if (b.kind === 'actor') {
        if (b.after && bst[b.after].why !== 'fired') continue;
        if (!r2.start(b.actor, b)) continue;
        lastAudioAt = t; fire(); B.st = 'pending'; B.released = false;
      } else if (b.kind === 'visual') {
        if (active || (pending && pending.beat)) continue;
        const a = world.anchors[EVENTS.find((e) => e.id === b.ev).anchors].find((x) => x.id === b.anchor);
        apparitions.audio[b.cue](cueAt(b.cue, a)); anchorUsed[a.id] = t; fire(); record(`${b.ev}:cue`, 0.03);
        pending = { ev: EVENTS.find((e) => e.id === b.ev), a, lamp: lampFor(a), at: t + rand(...K.BEAT_CUE_LEAD), expires: Infinity, stare: 0, obsT: 0, beat: b };
        B.st = 'pending';
      }
    }
  }

  // ---- denying a long look: lamp flicker or fog swell, both read as "unobserved" --------------------
  function startDeny(app, dist, forceLamp = false) {
    if (deny) return;
    const base = P.fogDensity(player.s), useLamp = app.lamp && (forceLamp || Math.random() < K.DENY_FLICKER_CHANCE);
    deny = { app, t0: t, kind: useLamp ? 'flicker' : 'fog', lamp: app.lamp, amp: clamp(2.4 / Math.max(dist, 6) - base, 0.05, K.DENY_SWELL_MAX) };
    record('deny:' + deny.kind, 0);
  }
  function updateDeny() {
    if (!deny) { director.fogSwell = 0; return; }
    const e = t - deny.t0;
    if (deny.kind === 'flicker') {
      deny.lamp.flicker = e < 0.12 ? 1 : e < 0.3 ? 0.05 : e < 0.45 ? 0.55 : e < 0.75 ? 0.05 : 0.05 + 0.95 * smooth01((e - 0.75) / 0.35);
      if (e >= 1.1) { deny.lamp.flicker = 1; deny = null; }
    } else {
      director.fogSwell = deny.amp * (e < 0.45 ? smooth01(e / 0.45) : e < 1.4 ? 1 : Math.max(0, 1 - (e - 1.4) / 2.4));
      if (e > 3.8) { director.fogSwell = 0; deny = null; }
    }
  }

  // ---- the active apparition -----------------------------------------------------------------------
  function spawn(p) {
    const app = apparitions.visual[p.ev.id];
    app.spawn(p.a, p.lamp);
    app.lamp = p.lamp;
    active = { ev: p.ev, app, a: p.a, born: t, wasObs: false, dwell: 0, noticed: false, changes: 0, obs: false, d: 0, beat: p.beat };
    if (p.beat) { endBeat(p.beat, 'spawned'); anchorUsed[p.a.id] = t; }
    record(`${p.ev.id}:spawn`, K.TENSION_VISUAL);
  }
  function vanish(why) {
    active.app.vanish(); record(`${active.ev.id}:${why}`, 0); active = null;
  }
  function updateActive(dt) {
    const A = active, app = A.app;
    const o = observedAt(app.point, app.fogK, app.lamp);
    A.obs = o.obs; A.d = o.d;
    const gaze = o.obs && o.cos > cosGaze;
    A.dwell = gaze ? A.dwell + dt : o.obs ? Math.max(0, A.dwell - dt * K.DWELL_FORGET) : 0;
    if (!A.noticed && A.dwell >= K.NOTICE_DWELL) {
      A.noticed = true; app.noticed(); record(`${A.ev.id}:noticed`, K.TENSION_NOTICE);
    }
    app.update(dt, { observed: o.obs, gaze, dwell: A.dwell });
    if (o.obs && !deny && (A.dwell > app.maxDwell || o.d < app.minDist)) startDeny(app, o.d);   // too long or too close
    if (!o.obs) {
      // changes happen only here, while unobserved
      if (A.wasObs && A.noticed && !(deny && deny.app === app) && A.changes < app.maxChanges && Math.random() < (A.beat ? 1 : K.CHANGE_CHANCE) && app.change()) {
        A.changes++; A.noticed = false; A.dwell = 0; record(`${A.ev.id}:change`, 0);
      } else if ((deny && deny.app === app) || (A.wasObs && A.noticed)) {
        vanish(deny && deny.app === app ? 'denied' : 'gone'); return;
      } else if (t - A.born > K.LIFETIME || player.s > (A.beat ? A.beat.s[1] + 4 : (A.a.viewFrom ? A.a.viewFrom[1] : A.a.s) + 20) || o.d > 110) {
        vanish('expired'); return;
      }
    }
    A.wasObs = o.obs;
  }

  function updatePending(dt) {
    const p = pending, app = apparitions.visual[p.ev.id], b = p.beat;
    if (b ? player.s > b.s[1] : (t > p.expires || !anchorOk(p.ev, p.a))) { pending = null; if (b) endBeat(b, 'missed'); return; }  // a beat waits out its whole window
    if (t < p.at || (b && p.ev.anchors === 'windows' && !anchorOk(p.ev, p.a))) return;
    const o = observedAt(app.pointFor(p.a), app.fogK, p.lamp);
    if (o.obs) {
      if (b) { p.obsT += dt; if (p.obsT > K.BEAT_FORCE && !deny) startDeny({ lamp: p.lamp }, o.d); return; }   // a beat never drops on a stare: a flicker or swell unobserves it
      p.stare = o.cos > cosGaze ? p.stare + dt : 0;                  // staring at the empty spot: drop it
      if (p.stare > K.PENDING_STARE_MAX) pending = null;
      return;
    }
    if (!b && tension > (p.ev.maxTension ?? K.VISUAL_MAX_TENSION)) { pending = null; return; }
    spawn(p); pending = null;
  }

  // ---- turn-arounds -----------------------------------------------------------------------------------
  function trackTurn() {
    yawLog.push({ t, yaw: player.yaw });
    while (yawLog[0].t < t - K.TURN_WINDOW) yawLog.shift();
    let lo = Infinity, hi = -Infinity;
    for (const y of yawLog) { lo = Math.min(lo, y.yaw); hi = Math.max(hi, y.yaw); }
    const swing = Math.max(Math.abs(player.yaw - lo), Math.abs(player.yaw - hi)) / D2R;
    if (swing > K.TURN_DEG && t > turnCool) {
      turnCool = t + 1.5; record('turn-around', K.TENSION_TURN); apparitions.steps.onTurn();
    }
  }

  function onPlayerStep() { apparitions.onPlayerStep(); }

  // ---- per frame --------------------------------------------------------------------------------------
  function update(dt) {
    if (game.state !== 'walking') return;
    t += dt;
    camera.getWorldDirection(fwd);
    tension *= Math.exp(-dt / K.TENSION_TAU);
    trackTurn();
    updateDeny();
    beast.update(dt);
    if (active) updateActive(dt);
    if (pending && !active) updatePending(dt);
    updateBeats(dt);
    focus = active ? { id: active.a.id, dwell: active.dwell, d: active.d, obs: active.obs } : null;
    apparitions.update(dt);
    if (t >= nextDecide) decide();
    if (dbg.on) renderDebug();
  }

  // ---- debug overlay (` or F2), off by default ----------------------------------------------------------
  const dbg = { on: false, el: null };
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' && e.code !== 'F2') return;
    e.preventDefault();
    dbg.on = !dbg.on;
    if (!dbg.el) {
      dbg.el = document.createElement('pre');
      dbg.el.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:11px/1.35 monospace;color:#9fd;background:rgba(0,0,0,.6);pointer-events:none;z-index:20;white-space:pre';
      document.body.appendChild(dbg.el);
    }
    dbg.el.style.display = dbg.on ? 'block' : 'none';
    if (dbg.on) renderDebug();
  });
  function renderDebug() {
    const cd = (x) => Math.max(0, x).toFixed(0).padStart(3);
    const bar = '#'.repeat(Math.round(tension * 20)).padEnd(20, '.');
    const L = [
      `tension ${tension.toFixed(2)} [${bar}]`,
      `cooldown  audio ${cd(K.AUDIO_GLOBAL_CD - (t - lastAudioAt))}s  visual ${cd(K.VISUAL_GLOBAL_CD - (t - lastVisualAt))}s`,
      `last event ${last ? `${last.id} (${(t - last.t).toFixed(0)}s ago)` : '-'}`,
      `observed ${focus ? `${focus.id} ${focus.obs ? 'YES' : 'no'} dwell ${focus.dwell.toFixed(1)}s d ${focus.d.toFixed(0)}m` : (pending ? `pending ${pending.ev.id}` : '-')}`,
      `deny ${deny ? deny.kind : '-'}  steps-behind ${apparitions.steps.active ? 'ON' : '-'}`,
      `beast ${beast.status()}`,
      `r2 ${r2.status()}`,
      ...EVENTS.map((ev) => `  ${ev.id.padEnd(15)} ${cd(cooldownOf(ev, cdRoll[ev.id]) - (t - (lastFired[ev.id] ?? -1e9)))}s`),
      `beats (random quiet ${cd(quietUntil - t)}s)`,
      ...BEATS.map((b) => `  ${b.id.padEnd(17)} ${bst[b.id].st}${bst[b.id].why ? ` (${bst[b.id].why})` : ''}`),
    ];
    dbg.el.textContent = L.join('\n');
  }

  return director;
}
