# Map objectives and ward facings: design spec

The problem: heavy play (especially the colossus) is a static frontal trade on shields. Both engines plant, nothing on the map is worth moving to, and the ward protects every side equally.

The goal: fights are decided by where you stand, which way you face, who flanks, and when you strike, and the map gives heavies reasons to move and contest ground.

Approved by the user: map objectives, plus shield facings with collapse. Battlegroup orders and fog of war were not chosen; do not add them.

Applies to the Harrow, Hierarch and Colossus, both player-piloted and AI. The Kestrel's veil is unchanged.
The Kestrel and infantry take part in objective capture.

Build in this order: 1 (facings), 2 (objectives), 3 (AI), 4 (HUD), 5 (tuning).

## 1. Ward facings and collapse

The heavy ward is split into four facings relative to the **torso** yaw (where the engine aims). The ward is strongest where you look.

| Facing | Arc (from torso forward) | Share of class shield |
|---|---|---|
| FRONT | ±60° | 0.60 |
| LEFT / RIGHT | 60° to 135° each side | 0.35 each |
| REAR | ±45° behind | 0.25 |

The shares add up to more than 1.0 on purpose. A frontal-only attacker faces only 60% of the old pool, so frontal duels break faster. Hitting the whole ward still costs more than before, which rewards attacking from more than one angle.

**Which facing a hit uses:** the bearing from the engine centre to the hit point. Use the source position when there is no point. Artillery from above (section 2) splits equally across all non-collapsed facings.

**Regen:** each facing regenerates independently. The existing WARD-capacitor regen rate is shared out in proportion to each facing's max. Collapsed facings get nothing, and the others don't receive their share either. Existing breakT pauses (3 s, 5 s for breakers) still apply to the whole ward.

**Planted:**
- The max-shield bonus (×1.15) now applies to FRONT only.
- Regen ×1.5 still applies to all facings.
- Leg damage ×0.5 is unchanged.
- Planting hardens what you point at, not your back.

**Collapse:**
- When a facing reaches 0 it collapses. The next hit through that arc goes to hull and is located as now.
- A collapsed facing stays down for its reboot time: Harrow 10 s, Hierarch 12 s, Colossus 15 s.
- It then returns at 30% of its max and regenerates normally.
- Damage beyond 0 does not carry into other facings.
- Feedback:
  - A visible flare and crackle on that side of the dome.
  - For the player, an announcement such as "WARD COLLAPSE - FRONT".
  - For an enemy heavy collapsing, "CINDERMAW - REAR WARD DOWN".

**Unchanged rules:**
- Sunspear ignores the ward.
- Melta teams inside 18 m bypass it.
- The Harrow fist puts 70% of its hull damage under the ward.
- The rear ×1.5 to REACTOR rule still applies to hull hits.
- WARD-capacitor spill from energy shots now removes shield from FRONT first, then the side facings, then REAR.

## 2. Map objectives

Five capturable sites along the midfield. They are indestructible: collision blocks like hero spires and a colossus cannot walk through them.

| Id | Type | Placement (exact coordinates are your call on clear, reachable ground) | Start owner |
|---|---|---|---|
| A | Reinforcement gate | Synod side, around z -320, offset from centre in x | Synod |
| B | Ward anchor | Synod-leaning, around z -150, on the opposite x side to A | neutral |
| C | Artillery manufactorum | Centre, around z 0 | neutral |
| D | Ward anchor | Vigil-leaning, around z +150 | neutral |
| E | Reinforcement gate | Vigil side, around z +320 | Vigil |

The sites should force lateral movement (not one straight lane), and every one must be reachable by a colossus walking through the city.

### Capture
- Each site has a 60 m capture ring.
- Presence weight per unit inside the ring:

| Unit | Weight |
|---|---|
| Colossus | 4 |
| Hierarch | 3 |
| Harrow | 2 |
| Kestrel or tank | 1 |
| Infantry squad (whole squad) | 0.5 |

- Progress runs from -100 (Synod) through 0 (neutral) to +100 (Vigil).
- With only one side present, progress moves toward that side at `2.5 × weight` per second, capped at 12 per second. A lone colossus therefore neutralises a site in 10 s and flips it in 20 s. A lone Kestrel takes 40 s and 80 s.
- With both sides present, the site is contested and progress freezes.
- A site belongs to a side at ±100. It stays owned (ownership has no decay) until progress crosses 0.

### Benefits while owned
- **Ward anchor (B, D).**
  - The owner's heavies within 300 m regenerate the ward ×1.5, stacking with planted.
  - Their facing reboot time drops by 40%.
  - Fighting near an anchor you hold is strong. Fighting at one you don't hold is weak.
- **Artillery manufactorum (C).**
  - Every 45 s it fires a 6-shell barrage.
  - Target: the enemy heavy nearest the front line, or, if the owner side includes the player and the player has a painted zone, the player's most recent zone.
  - Ground markers telegraph the impact 3 s ahead.
  - Each shell does S 120 / H 40 to heavies (split across facings as above) and kills infantry and tanks within 8 m.
- **Reinforcement gate (A, E).**
  - Every 60 s it spawns one extra tank and one infantry squad for the owner, at the gate.
  - Allied Kestrels of the owner (AI) respawn at the gate.
  - Taking the enemy's gate moves the front.

### Win gate
An enemy ward generator can only be damaged while your side holds at least 3 of the 5 sites. Otherwise its own shell is warded and hits only flare.
- The bastion rule is unchanged: the bastion stays immune while its generator stands.
- So the route to victory is to hold the majority, kill the generator, then the bastion.
- Bastion turrets keep firing either way.

## 3. AI

### Facings
- AI heavies already face their primary target with the torso. Keep that.
- When a facing collapses and the attacker is in that arc, the AI turns its torso to present a healthy facing if it can still shoot from there. Otherwise it keeps firing; it doesn't spin forever.
- AI weapons on a target with a collapsed facing get +0.3 target weight on that heavy if they have line of fire into the collapsed arc.
- **Flanking:**
  - Synod scouts' existing rear-arc flank on heavies now goes for the **weakest facing** (lowest current/max).
  - Allied (Vigil) AI Harrows and Hierarchs, when an enemy heavy is engaging the player, attack that heavy from a bearing at least 60° off the player's line where they can.
  - The goal is that a duel next to your allies naturally turns into a flank.

### Objectives
- Add a small per-side objective director.
- **Assigning goals:** every 10 s it gives each AI heavy, and each tank group, a goal site, by score:
  - Nearer is better.
  - Contested sites the side partly holds come first.
  - The win-gate count raises the value of the third site.
- **Moving and fighting:**
  - Units walk to their goal and engage targets of opportunity on the way (existing targeting).
  - They hold inside the ring until captured, then take the next goal.
  - If an owned site within 400 m becomes contested and the unit has no current heavy target, it diverts to defend.
- **Pushing the bastion:** once a side holds 3 or more sites, its great colossi and hierarchs may push the enemy generator and bastion. This replaces the existing "lane clear" push trigger.
- Infantry and tanks follow their nearest goal; no individual micro.

## 4. HUD

### Player's own ward
- Four arc segments around the existing paper-doll (or the ward bar area).
- Colour means fill level. A collapsed segment is a dark red outline with its reboot countdown.

### Enemy paper-doll (crosshair)
- Shows the target's four facings as an outline ring.
- The facing your shot would hit is highlighted.
- A collapsed facing is drawn broken.

### Objectives
- Top-centre strip with five pips, A to E: letter, owner colour, capture-progress fill, and a flash while contested.
- A small "3/5" win-gate counter for your side.
- Auspex and Tab tactical map: rings at the sites in owner colour, with a type icon (gate, anchor, artillery).
- On the Tab map, hovering the cursor over a site shows a one-line benefit.
- Announcements:
  - "WARD ANCHOR B TAKEN - SYNOD".
  - "ARTILLERY INBOUND", when you are the target.
  - "SYNOD WARD GENERATOR EXPOSED", when your side reaches 3/5.

## 5. Tuning targets (measure and report; retune the shares and reboot times in place to hit them)
- **Frontal duel:** colossus versus colossus, both planted, frontal only. The first FRONT collapse happens in 15-25 s.
- **Flank:** an allied Harrow (lascannon plus rockets) on an enemy colossus side facing collapses it in 10 s or less.
- **Exploiting a collapse:** within a 15 s colossus collapse window, a lance plus a battery volley through the gap is enough to take an arm or most of the reactor component.
- **Walking:** a colossus walks from E to C in about 60 s or less.
- **Overall:** a full AI-vs-AI match without the player still ends, with one side reaching 3/5 at least once within 10 minutes. Run it time-scaled headless if needed.

## 6. Engine speed pass (user request: titans are too slow)
Every titan must be able to keep up with the ground vehicles, and the Kestrel must be clearly the fastest.

1. **Measure first.** Find the actual tank top speed (`js/units.js` tank movement) and any APC or other ground vehicle, and call it V.
2. **Set new top speeds**, for the player CLASS table and the AI constants together (colossus.js `want` 6.2, hierarch.js TOP, harrow.js TOP, the CLASS table in player.js), so the AI and the player stay symmetrical:

| Class | Old top | New top |
|---|---|---|
| Colossus | 6 | max(10, 1.1 × V) |
| Hierarch | 11 | max(15, 1.4 × V) |
| Harrow | 16 | max(21, 1.9 × V), charge ×1.5 as now |
| Kestrel | 29 / 45 sprint | must stay at least 1.3 × the Harrow top. Raise it only if needed to keep that gap. |

3. **Scale the rest with speed:**
   - Raise accel, brake and leg turn rate for the three heavies by the same ratio as their top speed, at least ×1.5 for the colossus (turn 0.35 → ~0.55), so they don't feel like ships.
   - Leave twist and slew limits as they are.
   - Scale stride and step time so feet don't skate. Footstep weight and camera trauma stay heavy.
4. **Keep the existing levers working.** DRIVE-capacitor scaling, leg-component damage (×0.5 speed) and the planted threshold all still apply on top of the new speeds. Planted is still below 1.5 m/s.
5. **Rebalance what speed changes.** Re-check the section 5 walking target (with these speeds E→C should take about 40 s) and that AI heavies don't overshoot their hold lines or objective rings.

## Implementation notes
- Keep the Kestrel paths and controls unchanged.
- Put the facings in the shared `js/heavy.js` shield path (one shield value becomes four facing values plus collapse timers). Don't restructure the classes.
- Objectives go in a new `js/objectives.js`, following the pattern of `js/bastion.js`.
- Visuals come from `model/objectives-visual.md`, written in parallel by the designer. Build the systems first. If the file is missing when you reach visuals, check again; only then use plain primitive placeholders and say so.
- Performance: run capture checks and the director at 2-5 Hz, not every frame.
- Bump every `?v=` uniformly.
- Shots:
  - `?shot=objectives`: Tab view with the strip, rings and a contested site.
  - `?shot=facings&class=colossus`: an enemy colossus with a collapsed front facing flaring and the paper-doll visible.
