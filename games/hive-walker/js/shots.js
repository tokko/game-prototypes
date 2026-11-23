import * as THREE from 'three';
import { angDiff } from './util.js?v=32';
import { zeroWard } from './heavy.js?v=32';

// ?shot=<name> presets: overview | gatling | duel | pip | aa | hierarch | harrow | tiers | pilot | bastion | locational | command | secondaries | objectives | facings | orders | nail
export function setupShot(G, name) {
  const { player, units, colossi, city, air } = G;
  G.godMode = true; G.noHunt = true; G.objectives.pause();   // the objective director and capture stay off (and the generator gate open) so the old presets keep their staging
  const hud = v => { document.getElementById('hud').style.display = v ? '' : 'none'; };
  const squads = (side, lane, zs) => { let k = 0; for (const sq of units.squads) if (sq.side === side && sq.lane === lane && k < zs.length) units.placeSquad(sq, zs[k++]); };
  const tanks = (side, lane, zs) => { let k = 0; for (const t of units.tanks) if (t.side === side && t.lane === lane && k < zs.length) { t.z = zs[k++]; t.alive = true; t.hp = 100; units.paintTank(t); } };
  const placeCol = (c, z) => { if (!c.alive) c.enter(z); c.pos.z = z; c.holdBase = c.holdZ = z; c.holdT = 99; c.speed = 0; c.legs.reset(c.pos, c.yaw); };
  const forceLance = (c, delay) => { const foe = c.enemyCol(); if (!foe) return; c.mode = 'duel'; c.target = foe; c.miss = false; foe.chest(c.lanceAim); c.charge = 2.2 - delay; c.torsoYaw = Math.atan2(foe.pos.x - c.pos.x, foe.pos.z - c.pos.z); };
  const forceCollapse = (b, prog, dx, dz) => { if (!b || !b.alive) return; const h = b.h; city.collapse(b, dx, dz); b.fall.topple = true; b.fall.pivot = Math.max(10, h * 0.8); b.fall.t = b.fall.dur * prog; };
  const tallNear = (x, z, r) => { let best = null, bt = 0; for (const b of city.buildings) if (b.alive && Math.hypot(b.x - x, b.z - z) < r && b.top > bt) { bt = b.top; best = b; } return best; };
  const S = G.shot = { name, t: 0, update(dt, inp) { this.t += dt; inp.fwd = inp.turn = inp.mdx = inp.mdy = 0; inp.fire1 = inp.fire2 = inp.aa = inp.sprint = inp.spear = false; if (this.tick) this.tick(inp, this.t, dt); } };

  if (name === 'gatling' || name === 'inferno') {
    player.spawn(4, 150); player.aimPitch = -0.36;
    for (const sq of units.squads) if (sq.side === 1 && Math.abs(sq.lane) === 28) sq.lane = sq.lane > 0 ? 7 : -7;
    squads(0, 28, [230, 260, 290]); squads(0, -28, [230, 260, 290]); squads(1, 7, [118, 100, 82]); squads(1, -7, [112, 94, 76]); tanks(1, 28, [20, 108, -60]); tanks(1, -28, [10, -40]); tanks(0, 28, [128, 200, 240]);
    placeCol(colossi[1], -260);
    S.tick = (inp, t) => { inp.fire1 = true; inp.mdx = Math.cos(t * 2.6) * 5; };
  } else if (name === 'overview') {
    hud(false); G.freeCam = { pos: new THREE.Vector3(44, 58, 318), look: new THREE.Vector3(-12, 38, 0), fov: 64 };
    player.spawn(36, 215); placeCol(colossi[0], 120); placeCol(colossi[1], -150);
    forceCollapse(tallNear(-90, -40, 110), 0.5, 1, 0.3);
    S.tick = (inp, t) => {
      inp.fire1 = true; inp.fwd = 0.5;
      if (!S.a && t > 0.3) { S.a = 1; forceLance(colossi[0], 1.3); forceLance(colossi[1], 1.6); colossi[1].rakeT = 0; air.strikeT[0] = 0; air.artT = 0.2; }
    };
  } else if (name === 'duel') {
    hud(false); G.freeCam = { pos: new THREE.Vector3(-150, 7, 14), look: new THREE.Vector3(0, 52, -6), fov: 74 };
    player.spawn(-70, 22); player.legYaw = player.aimYaw = Math.PI / 2; player.legs.reset(player.pos, player.legYaw); placeCol(colossi[0], 80); placeCol(colossi[1], -80);
    let b = null, bd = 1e9; for (const h of city.buildings) { if (!h.alive || Math.abs(h.i) !== 1 || h.top < 90) continue; if (h.x < 0) continue; const d = Math.abs(h.z + 40); if (d < bd) { bd = d; b = h; } }
    forceCollapse(tallNear(-72, -72, 30), 0.3, 1, 0.45);
    S.tick = (inp, t) => {
      if (!S.a && t > 0.2) { S.a = 1; forceLance(colossi[0], 1.25); forceLance(colossi[1], 1.55); colossi[0].rakeT = 0.1; air.artT = 0.3; }
    };
  } else if (name === 'pip') {
    player.spawn(-48, 0); player.legYaw = Math.PI / 2; player.aimYaw = Math.PI; player.speed = 24; player.aimPitch = -0.04; player.legs.reset(player.pos, player.legYaw);
    squads(1, 28, [-70, -105, -140]); squads(1, -28, [-60, -95, -130]); tanks(1, -28, [-85, -120]); squads(0, 28, [60, 95, 130]); squads(0, -28, [60, 95, 130]);
    placeCol(colossi[1], -250); placeCol(colossi[0], 240);
    S.tick = (inp, t) => { inp.fwd = 1; inp.fire1 = true; if (t > 1.5 && t < 1.6) inp.fire2 = true; };
  } else if (name === 'arm') {
    hud(false); player.spawn(4, 150); squads(1, 28, [-200, -230, -260]); squads(1, -28, [-200, -230, -260]);
    G.freeCam = { pos: new THREE.Vector3(-16, 21.5, 131), look: new THREE.Vector3(-1.5, 18.5, 141), fov: 38 };
    S.tick = (inp, t) => { inp.fire1 = t > 1.6; };
  } else if (name === 'infernoside') {
    hud(false); player.spawn(4, 150); player.aimPitch = -0.36;
    for (const sq of units.squads) if (sq.side === 1 && Math.abs(sq.lane) === 28) sq.lane = sq.lane > 0 ? 7 : -7;
    squads(0, 28, [230, 260, 290]); squads(0, -28, [230, 260, 290]); squads(1, 7, [118, 100, 82]); squads(1, -7, [112, 94, 76]);
    G.freeCam = { pos: new THREE.Vector3(-36, 10, 136), look: new THREE.Vector3(6, 9, 128), fov: 60 };
    S.tick = (inp, t) => { inp.fire1 = true; inp.mdx = Math.cos(t * 2.6) * 5; };
  } else if (name === 'skid') {
    player.spawn(8, 430); player.speed = 24; player.vel.set(0, 0, -24);
    S.tick = (inp, t) => { inp.fwd = 1; inp.turn = t > 0.9 && t < 1.55 ? 1 : 0; };
  } else if (name === 'lance') {
    const c = colossi[1]; placeCol(c, -60); placeCol(colossi[0], 200);
    player.spawn(50, -6); const v = new THREE.Vector3();
    S.tick = (inp, t) => {
      const f = c.legs.feet[0].pos.x > c.legs.feet[1].pos.x ? c.legs.feet[0] : c.legs.feet[1];
      v.set(f.pos.x, 20, f.pos.z).sub(G.camera.position);
      const yaw = Math.atan2(v.x, v.z), pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
      player.aimYaw += angDiff(yaw, player.aimYaw) * 0.3; player.aimPitch += (pitch - player.aimPitch) * 0.3;
      inp.spear = t > 0.1;
    };
  } else if (name === 'hunt') {
    player.spawn(22, 70); player.aimPitch = 0.22; placeCol(colossi[1], -120);
    squads(1, 28, [-10, -40, -70]);
    S.tick = (inp, t) => {
      const c = colossi[1];
      if (!S.a && t > 0.1) { S.a = 1; c.mode = 'hunt'; c.charge = 0.6; c.aimLag.copy(player.pos); c.torsoYaw = Math.atan2(player.pos.x - c.pos.x, player.pos.z - c.pos.z); }
      inp.fwd = -0.4;
    };
  } else if (name === 'walker') {
    // close-up of the player's Kestrel-class scout engine
    hud(false); player.spawn(4, 150); squads(1, 28, [-200, -230, -260]); squads(1, -28, [-200, -230, -260]);
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -520 : 520);
    G.freeCam = { pos: new THREE.Vector3(-19, 10, 119), look: new THREE.Vector3(4, 12.5, 150), fov: 42 };
    S.tick = (inp, t) => { player.aimYaw = Math.PI + Math.sin(t * 0.5) * 0.25; };
  } else if (name === 'scouts') {
    // two Pyre Synod scout engines closing on a Vigil scout and the player
    hud(false); player.spawn(10, 215); const L = G.scouts.list;
    G.scouts.place(L[0], -14, 100); G.scouts.place(L[1], 20, 84); G.scouts.place(L[2], -4, 172);
    squads(1, 28, [-60, -90, -120]); squads(1, -28, [-60, -90, -120]); squads(0, 28, [230, 260, 290]); squads(0, -28, [230, 260, 290]);
    G.freeCam = { pos: new THREE.Vector3(34, 7, 132), look: new THREE.Vector3(0, 12, 96), fov: 52 };
    S.tick = () => {};
  } else if (name === 'streets') {
    // civilian wrecks and debris down a lane, the player walking through them
    hud(false); player.spawn(21, 268); squads(1, 28, [-200, -230, -260]); squads(0, 28, [330, 360, 390]); tanks(0, 28, [340, 380, 420]);
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -520 : 520);
    G.freeCam = { pos: new THREE.Vector3(37, 17, 316), look: new THREE.Vector3(27, 2, 236), fov: 55 };
    S.tick = (inp, t) => { inp.fwd = t > 1.2 ? 0.6 : 0; };
  } else if (name === 'auspex') {
    // normal chase view with the HUD up: auspex plot, a colossus hunting, scouts and armour in range, smoke in the street
    player.spawn(22, 70); player.aimPitch = 0.05; placeCol(colossi[1], -120); placeCol(colossi[0], 230);
    const L = G.scouts.list; G.scouts.place(L[0], -30, -40); G.scouts.place(L[1], 110, 10); G.scouts.place(L[2], 30, 150);
    squads(1, 28, [-10, -40, -70]); squads(1, -28, [-30, -60, -90]); squads(0, 28, [150, 180, 210]); squads(0, -28, [140, 170, 200]); tanks(1, 28, [-60, -110]); tanks(0, -28, [130, 170]);
    S.tick = (inp, t) => {
      const c = colossi[1];
      if (!S.a && t > 0.1) { S.a = 1; c.mode = 'hunt'; c.charge = 0.4; c.aimLag.copy(player.pos); c.torsoYaw = Math.atan2(player.pos.x - c.pos.x, player.pos.z - c.pos.z); }
      inp.fire2 = t > 0.6 && t < 0.7;
    };
  } else if (name === 'hierarch') {
    // close duel between the player and an enemy hierarch (blaster charge tell, macro-cannon bursts, the player's cannon)
    hud(false); const hz = G.hierarchs[1]; hz.place(0, -52);
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -520 : 520);
    placeCol(colossi[0], 420); placeCol(colossi[1], -420); for (const c of colossi) c.lanceT = c.cannonT = c.rakeT = 999;   // keep the great colossi out of the duel
    player.spawn(14, 34); player.legYaw = player.aimYaw = Math.PI; player.legs.reset(player.pos, player.legYaw);
    G.freeCam = { pos: new THREE.Vector3(-44, 11, 66), look: new THREE.Vector3(4, 27, -12), fov: 68 };
    const v = new THREE.Vector3();
    S.tick = (inp, t) => {
      hz.tgt = player; hz.tgtKind = 3; hz.scanT = 99;   // it has seen you
      v.set(hz.pos.x - player.pos.x, 40 - 17, hz.pos.z - player.pos.z);
      player.aimYaw += angDiff(Math.atan2(v.x, v.z), player.aimYaw) * 0.3; player.aimPitch += (Math.atan2(v.y, Math.hypot(v.x, v.z)) - player.aimPitch) * 0.3;
      inp.fire2 = t > 0.5 && (t % 1.4) < 0.1;
    };
  } else if (name === 'harrow') {
    // the player against the enemy Harrow at close range, fist mid-swing (wind-up glow, then the hook)
    hud(false); const hr = G.harrows[1]; hr.place(0, -60);
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -520 : 520);
    G.hierarchs[0].place(108, 420); G.hierarchs[1].place(-108, -420); G.harrows[0].place(-70, 420);
    placeCol(colossi[0], 420); placeCol(colossi[1], -420); for (const c of colossi) c.lanceT = c.cannonT = c.rakeT = 999;
    player.spawn(10, -38); player.legYaw = player.aimYaw = Math.PI; player.legs.reset(player.pos, player.legYaw);
    G.freeCam = { pos: new THREE.Vector3(-17, 21, 0), look: new THREE.Vector3(3, 18, -52), fov: 68 };
    const v = new THREE.Vector3();
    S.tick = (inp, t) => {
      hr.tgt = player; hr.tgtKind = 3; hr.scanT = 99; hr.lasCd = hr.rackT = 999; hr.huntT = 99;   // it has seen you; fist only
      player.pos.set(10, 0, -38); player.vel.set(0, 0, 0); player.speed = 0;
      v.set(hr.pos.x - player.pos.x, 31 - 17, hr.pos.z - player.pos.z);
      player.aimYaw += angDiff(Math.atan2(v.x, v.z), player.aimYaw) * 0.3; player.aimPitch += (Math.atan2(v.y, Math.hypot(v.x, v.z)) - player.aimPitch) * 0.3;
    };
  } else if (name === 'pilot') {
    // third-person view of the piloted class (?class=kestrel|harrow|hierarch|colossus) mid-fight, HUD up
    const L = G.scouts.list, hz = G.hierarchs[1], hr = G.harrows[1]; player.spawn(0, 60);
    G.scouts.place(L[0], -26, -10); G.scouts.place(L[1], 30, -34); G.scouts.place(L[2], 400, 400);
    hr.place(-36, -90); hz.place(24, -160); placeCol(colossi[1], -240); if (!colossi[0].piloted) placeCol(colossi[0], 420); for (const c of colossi) if (!c.piloted) c.lanceT = c.cannonT = c.rakeT = 999;
    squads(1, 28, [-50, -80, -110]); squads(1, -28, [-60, -90, -120]); tanks(1, 28, [-40, -70]); tanks(1, -28, [-50, -90]);
    const v = new THREE.Vector3(), tgt = player.cls === 'kestrel' ? L[0] : player.cls === 'harrow' ? hr : hz;
    S.tick = (inp, t) => {
      hz.bCd = hz.cT = 999; hr.lasCd = hr.meleeCd = hr.rackT = 999;   // keep the opposition quiet; the pilot is the show
      const tp = tgt.pos; v.set(tp.x - player.pos.x, (player.cls === 'kestrel' ? 14 : 30) - 17, tp.z - player.pos.z);
      player.aimYaw += angDiff(Math.atan2(v.x, v.z), player.aimYaw) * 0.2; player.aimPitch += (Math.atan2(v.y, Math.hypot(v.x, v.z)) - player.aimPitch) * 0.2;
      inp.fire1 = true; inp.fire2 = (t % 4) < 2.2 && t > 0.8; inp.aa = (t % 6) > 0.4 && (t % 6) < 0.5;
      if (player.cls !== 'colossus') inp.fwd = t > 1 && t < 2 ? 1 : 0;
    };
  } else if (name === 'bastion') {
    // the Synod bastion and its ward generator under fire: a Vigil colossus lancing the generator while the bastion guns answer
    hud(false); const B = G.bastions[1], c = colossi[0];
    for (const bb of city.buildings) if (bb.alive && Math.abs(bb.x) < 230 && bb.z > -640 && bb.z < -300) city.damage(bb, 1e9, 0, 0, true);   // open ground for the view
    player.spawn(300, -200); for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -520 : 520);
    placeCol(c, -330); c.pos.x = 30; c.legs.reset(c.pos, c.yaw); for (const e of [colossi[1]]) { placeCol(e, -250); e.lanceT = e.cannonT = e.rakeT = 999; }
    G.freeCam = { pos: new THREE.Vector3(150, 45, -410), look: new THREE.Vector3(0, 70, -700), fov: 62 };
    S.tick = (inp, t) => {
      B.gen.hp = Math.max(B.gen.hp, 1100); c.cannonT = c.rakeT = 999; c.pos.x = 30;
      if (!c.mode && c.lanceT > 3 && t > 0.5) c.lanceT = 0.3;
      if (!c.mode && c.lanceT <= 0.35 && t > 0.3) { c.mode = 'duel'; c.target = B.gen; c.miss = false; B.gen.chest(c.lanceAim); c.charge = 1.5; c.torsoYaw = Math.atan2(B.gen.pos.x - c.pos.x, B.gen.pos.z - c.pos.z); }
    };
  } else if (name === 'locational') {
    // a colossus duel with the paper-doll up: you (colossus class) against Cindermaw with its shield down, crosshair on an arm
    G.nextClass = 'colossus'; const foe = colossi[1], aim = new THREE.Vector3(), cp = G.camera.position;
    for (const bb of city.buildings) if (bb.alive && Math.abs(bb.x) < 150 && bb.z > -320 && bb.z < 320) city.damage(bb, 1e9, 0, 0, true);
    player.spawn(0, 40); for (const c of colossi) if (!c.piloted) { c.lanceT = c.cannonT = c.rakeT = 999; c.huntT = 999; }
    for (const L of [G.hierarchs, G.harrows]) for (const e of L) e.place(e.lane, e.side ? -600 : 600);
    placeCol(foe, -160); foe.pos.x = 0; foe.legs.reset(foe.pos, foe.yaw); zeroWard(foe); foe.lastDmg = 1e9; foe.stillT = -1e9;
    for (const [k, f] of [['legs', 0.55], ['head', 0.4], ['armR', 0.7], ['armL', 0.3]]) foe.comp[k].hp = foe.comp[k].max * f; foe.hp = foe.hullMax - 1000;
    S.tick = (inp, t) => {
      zeroWard(foe); foe.lastDmg = G.time + 9999; foe.stillT = -1e9; aim.set(foe.pos.x + Math.cos(foe.torsoYaw) * 18, 62, foe.pos.z - Math.sin(foe.torsoYaw) * 18);   // the left arm's flank
      player.aimYaw = Math.atan2(aim.x - cp.x, aim.z - cp.z); player.aimPitch = Math.atan2(aim.y - cp.y, Math.hypot(aim.x - cp.x, aim.z - cp.z));
      inp.fire1 = t > 1.5;
    };
  } else if (name === 'command' || name === 'secondaries') {
    // ?class=colossus&shot=command: the tactical view open with an arm lock and a zone. ?class=hierarch&shot=secondaries: knee guns and bolters firing into a zone.
    const cmd = name === 'command'; if (!['harrow', 'hierarch', 'colossus'].includes(G.nextClass)) G.nextClass = cmd ? 'colossus' : 'hierarch';
    for (const bb of city.buildings) if (bb.alive && Math.abs(bb.x) < 170 && bb.z > -360 && bb.z < 320) city.damage(bb, 1e9, 0, 0, true);
    for (const L of [G.hierarchs, G.harrows]) for (const e of L) if (!e.piloted) e.place(e.lane, e.side ? -600 : 600);
    for (const c of colossi) if (!c.piloted) { c.lanceT = c.cannonT = c.rakeT = 999; c.huntT = 999; }
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -560 : 560);
    player.spawn(0, 90); const me = player.unit, foe = G.hierarchs[1];
    const around = (z, n) => { let k = 0; for (const sq of units.squads) if (sq.side === 1 && k < n) { units.placeSquad(sq, z - k * 30); for (const m of sq.members) units.x[m] += (k % 2 ? 18 : -14) - sq.lane; sq.lane = (k % 2 ? 18 : -14); k++; } };
    if (cmd) {
      foe.place(30, -200); foe.bCd = foe.cT = foe.podT = 999; around(-90, 3);
      S.tick = (inp, t) => {
        if (t > 0.4 && !me.zones.length) { me.zones.push({ x: -14, z: -90, r: 45 }); me.lock.L = { k: 'eng', r: foe }; me.lastLock = 'L'; }
        G.tacForce = t > 2.5; foe.bCd = foe.cT = foe.podT = 999;
      };
    } else {
      foe.place(0, -600); around(-70, 3); me.zones.push({ x: 0, z: -80, r: 60 });
      G.freeCam = { pos: new THREE.Vector3(-70, 34, 140), look: new THREE.Vector3(0, 18, 20), fov: 58 };
      S.tick = (inp, t) => { player.aimYaw = Math.PI; inp.fwd = 0; for (const sq of units.squads) if (sq.side === 1 && sq.alive < 6 && sq.z > -200) units.placeSquad(sq, sq.z); };
    }
  } else if (name === 'objectives') {
    // ?class=colossus&shot=objectives: the Tab view open with the objective strip: A held by the Synod, B contested (a Vigil hierarch against a Synod harrow in the ring), C leaning Vigil, D and E Vigil
    if (!['harrow', 'hierarch', 'colossus'].includes(G.nextClass)) G.nextClass = 'colossus';
    const O = G.objectives, [A, B, C, D, E] = O.sites;
    for (const L of [G.hierarchs, G.harrows]) for (const e of L) if (!e.piloted) e.place(e.lane, e.side ? -600 : 600);
    for (const c of colossi) if (!c.piloted) { c.lanceT = c.cannonT = c.rakeT = 999; c.huntT = 999; }
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -560 : 560);
    player.spawn(0, 120); const hv = G.hierarchs[0], hr = G.harrows[1];
    B.p = -35; B.owner = null; C.p = 45; C.owner = null; D.p = 100; D.owner = 0; O.recount();
    S.tick = (inp, t) => { hv.place(-100, -168); hr.place(-122, -196); hv.bCd = hv.cT = hv.podT = 999; hr.lasCd = hr.rackT = hr.meleeCd = 999; B.contested = true; G.tacForce = t > 1.5; };
  } else if (name === 'facings') {
    // ?class=colossus&shot=facings: an enemy colossus 150 m ahead with its FRONT ward collapsed (flaring dome), the crosshair on it so the paper-doll ring is up
    if (!['harrow', 'hierarch', 'colossus'].includes(G.nextClass)) G.nextClass = 'colossus';
    for (const bb of city.buildings) if (bb.alive && Math.abs(bb.x) < 150 && bb.z > -320 && bb.z < 320) city.damage(bb, 1e9, 0, 0, true);
    player.spawn(0, 40); for (const c of colossi) if (!c.piloted) { c.lanceT = c.cannonT = c.rakeT = 999; c.huntT = 999; }
    for (const L of [G.hierarchs, G.harrows]) for (const e of L) if (!e.piloted) e.place(e.lane, e.side ? -600 : 600);
    const foe = colossi[1], aim = new THREE.Vector3(), cp = G.camera.position;
    placeCol(foe, -150); foe.pos.x = 0; foe.legs.reset(foe.pos, foe.yaw); foe.fac.left.hp *= 0.45; foe.fac.rear.hp *= 0.8;
    S.tick = (inp, t) => {
      foe.fac.front.hp = 0; foe.fac.front.t = 14; if (t < 0.3) foe.fac.front.flare = 2.5; foe.lastDmg = G.time; foe.lanceT = foe.cannonT = foe.rakeT = 999;
      aim.set(foe.pos.x, 70, foe.pos.z); player.aimYaw = Math.atan2(aim.x - cp.x, aim.z - cp.z); player.aimPitch = Math.atan2(aim.y - cp.y, Math.hypot(aim.x - cp.x, aim.z - cp.z));
    };
  } else if (name === 'orders') {
    // ?class=colossus&shot=orders: the Tab view with three active orders (LANCE kill the enemy hierarch, ARMOUR take site B, COHORT clear a point) - markers, lines and the group panel
    if (!['harrow', 'hierarch', 'colossus'].includes(G.nextClass)) G.nextClass = 'colossus';
    for (const L of [G.hierarchs, G.harrows]) for (const e of L) if (!e.piloted) e.place(e.lane, e.side ? -600 : 600);
    for (const c of colossi) if (!c.piloted) { c.lanceT = c.cannonT = c.rakeT = 999; c.huntT = 999; }
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -560 : 560);
    player.spawn(0, 120); const hz = G.hierarchs[1], B = G.objectives.sites[1];
    S.tick = (inp, t) => {
      if (!S.p) { S.p = 1; hz.place(-30, -300); } hz.bCd = hz.cT = hz.podT = 999;
      if (!S.a && t > 0.6) { S.a = 1; const O = G.orders; O.issue({ eng: hz, x: hz.pos.x, z: hz.pos.z }, 2); O.issue({ x: B.x, z: B.z, site: B }, 3); O.issue({ x: 40, z: -60 }, 4); }
      G.tacForce = t > 1.5;
    };
  } else if (name === 'nail') {
    // ?class=colossus&shot=nail: Heaven's Nail mid-telegraph (pillar narrowing onto the ring) on an enemy hierarch, the Wrath bar full
    if (!['harrow', 'hierarch', 'colossus'].includes(G.nextClass)) G.nextClass = 'colossus';
    for (const bb of city.buildings) if (bb.alive && Math.abs(bb.x) < 150 && bb.z > -320 && bb.z < 320) city.damage(bb, 1e9, 0, 0, true);
    for (const L of [G.hierarchs, G.harrows]) for (const e of L) if (!e.piloted) e.place(e.lane, e.side ? -600 : 600);
    for (const c of colossi) if (!c.piloted) { c.lanceT = c.cannonT = c.rakeT = 999; c.huntT = 999; }
    for (const sc of G.scouts.list) G.scouts.place(sc, sc.lane, sc.side ? -560 : 560);
    player.spawn(0, 90); const hz = G.hierarchs[1];
    S.tick = (inp, t) => {
      if (!S.p) { S.p = 1; hz.place(-26, -150); } hz.bCd = hz.cT = hz.podT = 999; hz.speed = 0;
      player.aimYaw = Math.PI + 0.22; player.aimPitch = -0.16;
      if (!S.a && t > 0.4) { S.a = 1; G.wrath.v = 100; G.wrath.nail({ x: hz.pos.x, z: hz.pos.z }); G.wrath.v = 100; }
      G.wrath.idle = 0;
    };
  } else if (name === 'tiers') {
    // size read, all four tiers: Kestrel scout, Harrow, Hierarch and great colossus side by side (Synod engines, facing the camera)
    hud(false); const sc = G.scouts.list[0], hr = G.harrows[1], hz = G.hierarchs[1], c = colossi[1];
    for (const o of G.scouts.list) if (o !== sc) G.scouts.place(o, o.lane, o.side ? -520 : 520);
    G.hierarchs[0].place(108, 420); G.harrows[0].place(-70, 420); placeCol(colossi[0], 420);
    player.spawn(160, 330);
    hr.place(-66, -12); hz.place(-4, -30); placeCol(c, -50); c.pos.x = 80; c.legs.reset(c.pos, c.yaw);
    G.scouts.place(sc, -28, 44); sc.cd = 999;
    G.freeCam = { pos: new THREE.Vector3(-12, 75, 150), look: new THREE.Vector3(-8, 52, -40), fov: 74 };
    S.tick = () => { sc.pos.set(-28, 0, 44); sc.speed = 0; sc.vel.set(0, 0, 0); hz.tgt = null; hz.scanT = 99; hz.bCd = hz.cT = hz.podT = 999; hr.tgt = null; hr.scanT = 99; hr.lasCd = hr.rackT = hr.meleeCd = 999; c.lanceT = c.cannonT = c.rakeT = 999; };
  } else if (name === 'aa') {
    player.spawn(0, 200);
    const gs = air.list.filter(a => a.side === 1 && a.kind === 'gunship');
    gs.forEach((a, i) => { air.spawn(a); a.pos.set(-14 - i * 30, 56 + i * 24, 62 - i * 90); a.dir.set(0, 0, 1); a.runDir = 1; a.laneX = a.pos.x; a.alt = a.pos.y; a.speed = 20; a.hp = 400; });
    const v = new THREE.Vector3();
    S.tick = (inp, t) => {
      const a = gs[0]; v.subVectors(a.pos, G.camera.position);
      const yaw = Math.atan2(v.x, v.z), pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
      player.aimYaw += angDiff(yaw, player.aimYaw) * 0.25; player.aimPitch += (pitch - player.aimPitch) * 0.25;
      inp.aa = t > 0.15 && t < 1.15;
    };
  }
}
