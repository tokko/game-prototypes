# Heavy loadouts and command controls: design spec

Approved by the user:
- full strategic controls (arm locks, painted fire zones, Tab tactical view);
- the tactical view slows time to about 30%;
- every engine gets quad flak;
- larger engines carry more weapons.

Applies to the player-piloted and AI Harrow, Hierarch and Colossus. The Kestrel is unchanged (no flak: its AA missile rack is its anti-air).

## 0. Balance carry-over
- The colossus battery does 160 shield / 40 hull per shell (was 220 shield).
- Target: a planted colossus under steady battery and gatling fire loses its shield in about 25-35 s. Measure it and report the result.

## 1. Loadouts
Weapons that already exist keep their current numbers. The new weapons are listed below.

| Class | Arms (manual or locked) | Carapace weapon (Q) | Secondaries (automatic, zone-driven) | Quad flak (automatic) |
|---|---|---|---|---|
| Kestrel | flamer, autocannon | AA rack (Q), Sunspear (E) | none | none (the AA rack is its anti-air) |
| Harrow | siege fist, lascannon | rocket rack | 1 hull autogun | 1 |
| Hierarch | macro-cannon, fusion blaster | missile pod | 2 shoulder heavy bolters, 2 knee guns | 2 |
| Colossus | gatling, lance | battery | 2 shoulder twin-autocannon turrets, back missile spine, 2 knee batteries | 3 |

### New weapons
Damage is listed per hit unless stated. Engines take S to their shield and H to bare hull, with location applied as now. All are kinetic, so none cost capacitor.

- **Quad flak.**
  - Engages aircraft only, within 350 m (450 m on a colossus).
  - Proximity airbursts at about 60 dps against aircraft per quad. Never hits the ground.
  - Visual: dark flak puffs and tracer.
  - The Kestrel's AA rack stays as its manual heavy anti-air.
- **Hull autogun (Harrow).**
  - 120 m range, 8 rounds/s. Kills infantry.
  - Tanks 15, scouts 4, engines S1 / H1.
  - Forward 180° arc, relative to the torso.
- **Shoulder heavy bolters (Hierarch, x2).**
  - 150 m range, 10 rounds/s each. Kills infantry.
  - Tanks 20, scouts 6, engines S1 / H2.
  - 270° arc each, relative to the torso: the outer side and forward.
- **Knee guns (Hierarch, x2).**
  - 90 m range, 12 rounds/s. Kills infantry.
  - Tanks 10, scouts 4.
  - 200° arc, relative to the leg heading.
  - Fusion-lance teams within 60 m are always their first priority.
- **Shoulder twin-autocannon turrets (Colossus, x2).**
  - 300 m range, a 4-round burst every 1.5 s.
  - Tanks 40, scouts 25, aircraft 30, infantry 6 m splash, engines S2 / H4.
  - 300° arc each.
- **Back missile spine (Colossus).**
  - A salvo of 8 anti-armour missiles every 14 s at its order: a zone, a locked target or the auto target.
  - Tanks die, scouts 80, engines S30 / H20, structures 60.
- **Knee batteries (Colossus, x2).**
  - 120 m range, 20 rounds/s. Kills infantry.
  - Tanks 12, scouts 5.
  - 200° arc, relative to the leg heading.
  - Fusion-lance teams within 60 m are always their first priority.

### Secondary target priority when there is no zone
1. Fusion-lance teams within 60 m.
2. Enemy Kestrels in the rear arc.
3. The nearest small threat.

Secondaries never target an enemy heavy unless the player locks them onto it (see Tab group 4), or there is nothing else in range.

## 2. Arm target-locks (third person)
- **Firing.** LMB and RMB fire the left and right arm at the crosshair, as now.
- **Locking.** MMB on an enemy unit or structure under the crosshair locks the arm fired most recently. MMB with no recent fire locks the left arm first, then the right.
  - A locked arm tracks the target within its arc and slew limits.
  - It fires automatically whenever ready and with line of fire, so the crosshair stays free for the other arm.
- **Lock limits.**
  - A lock breaks when the target dies, leaves range for more than 3 s, or leaves the arm arc for more than 2 s.
  - Energy weapons on a lock only auto-fire when ARMS can cover the full cost, so they never spill into DRIVE or WARD. The lance auto-charges when ARMS is 100 and the target is in arc.
  - Holding the locked arm's mouse button overrides the lock back to the crosshair while held. The lock resumes on release.
- **Releasing.** MMB on empty ground releases the most recently locked arm. Double-tap MMB releases both.
- **HUD.**
  - A corner bracket on each locked target, labelled L or R in that arm's colour.
  - A small lock line in the auspex.
  - The arm readiness bars show LOCK.

## 3. Fire zones (third person)
- **Painting.** Hold G: a ground ring appears at the crosshair ground point. Drag the mouse forward or back to set the radius (20-90 m). Release to place it.
  - Up to 2 zones. A third replaces the oldest.
  - Tap G with the crosshair inside a zone to remove it.
- **Effect.** Secondaries in arc and range prioritise enemies inside the zone nearest to them, after the always-first priority on fusion-lance teams within 60 m.
- **Q fires at a zone.** Q fires the carapace weapon at the crosshair; Alt+Q fires it at the centre of the most recent zone. The back missile spine also uses the most recent zone when it has no locked order.
- **Display.** Zones show as faction-coloured ground rings, cheap decal or line loops, and on the auspex.
- Zones persist until removed, or until you die.

## 4. Tactical view (Tab, heavy classes only)
- **Entering.**
  - Hold Tab to open it. Game time scale drops to 0.3, and the audio is low-passed and slowed slightly.
  - The auspex expands to a large centred map at the class auspex range, with the same glyph language.
  - Pointer lock is kept: a virtual cursor is driven by `movementX/Y`. Do not exit pointer lock, because re-locking needs a user gesture.
- **Group keys.** While Tab is held, 1 / 2 / 3 / 4 select the group: left arm, right arm, carapace weapon, secondaries. The selected group is highlighted.
- **Clicks on the map.**
  - With group 1 or 2: click an enemy glyph to lock that arm (same rules as section 2).
  - With group 3: click a point or a glyph to queue one carapace shot there, fired as soon as it is ready.
  - With group 4: drag to paint a zone, or click an enemy heavy glyph to focus the secondaries on it.
  - Right-click clears the selected group's order.
- **Moving.** WASD still works in the tactical view, so you can keep walking while giving orders.
- **Leaving.** Releasing Tab restores time and the camera instantly.
- **Kestrel.** Tab does nothing in the Kestrel. It is not used anywhere else.

## 5. AI
- AI heavies fire their secondaries and flak automatically with the same priority rules.
- AI arms already target independently.
- The AI paints no zones.
- AI back spines fire at the AI's current target cluster.

## 6. Notes for the implementer
- Add the secondaries and flak as a small data-driven mount list per class, in the shared `js/heavy.js`, attached to existing rig nodes, and reuse existing tracer, blast and `G.shoot` paths.
- The new mount geometry comes from `model/hardpoints-visual.md`, written in parallel by the designer. Build the systems first. If that file is missing when you reach visuals, check again, and only then use plain Builder boxes as placeholders and say so.
- Keep the Kestrel paths and controls behaviourally identical. The Kestrel is not changed at all.
- Performance: secondaries pick targets at 5 Hz, not every frame, and they share the existing tracer pools.
- Shots:
  - `?class=colossus&shot=command`: the tactical view open, with an arm lock and a zone.
  - `?class=hierarch&shot=secondaries`: knee guns and bolters firing into a zone.
