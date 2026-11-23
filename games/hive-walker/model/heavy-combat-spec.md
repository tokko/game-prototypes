# Heavy-engine combat depth: design spec

The problem: colossus play is a brawl, because holding the gatling (about 224 dps against a colossus, no heat, 700 m) beats everything.
The goal: heavy duels become slow, deliberate fights about power, shield-breaking, aim and positioning, with the small stuff mattering.

Scope:
- Applies to the three heavy classes (Harrow, Hierarch, Colossus), both player-piloted and AI.
- The Kestrel keeps its current coolant and veil and is unchanged, except as a target and an escort.
- The AI uses the same numbers, so the balance stays symmetrical.

Build in this order: 1, 2, 3, 4, 5.

## 1. Weapon roles
Every heavy weapon has one job. The tables are damage per hit: S = to shield, H = to bare hull, small = infantry, tanks, scouts and aircraft.

| Class | Anti-small | Shield-breaker | Engine-killer |
|---|---|---|---|
| Colossus | Gatling (LMB). 16 rds/s. Against engines: S 2, H 3. Against small: unchanged. Heat: overheats after 6 s of continuous fire and locks for 4 s. | Battery (Q). 4 shells. S 220, H 40 each. Cooldown 12 s. 9 m blast. | Lance (RMB). 2.2 s charge. S 300, H 900. Plus component damage (see 2). |
| Hierarch | Macro-cannon (LMB). Against engines: S 3, H 5 per round. Against small: unchanged. Existing heat. | Missile pod (Q). 6 missiles. S 90, H 15 each against engines. Against aircraft and small: unchanged. | Fusion blaster (RMB). S 120, H 420. |
| Harrow | Rocket rack (Q). Against engines: S 20, H 10. Against small: unchanged. | Lascannon (RMB). S 160, H 60. | Siege fist (LMB). S 60 (the fist mostly goes under the ward, see 4), H 380. |

- Shield regen rules stay as they are, apart from the capacitor modifiers in 3.
- The intended rhythm: strip the shield with the breaker, land the killer on a component, keep the small stuff off with the anti-small weapon.

## 2. Locational damage
Each heavy engine has five components, each with HP as a share of total hull.

| Component | Share of hull | Effect when destroyed |
|---|---|---|
| ARM L | 18% | That arm's weapon goes offline |
| ARM R | 18% | That arm's weapon goes offline |
| LEGS | 28% | Speed ×0.5, leg turn ×0.5 |
| HEAD | 12% | Aim spread ×3. For the player: auspex range halved and a screen-static overlay. |
| REACTOR | 24% | Reactor-critical, then the existing death sequence |

How hits are resolved:
- **Only bare hull is located.** While the shield is up, all damage goes to the shield. Once it is down, every hull hit is assigned to a component by its hit point.
  - Hit volumes per class: arm boxes around `arm_L` / `arm_R`, legs from hip to foot, head sphere, torso. The REACTOR is the rear half of the torso.
  - Torso-front hits split 50/50 between the reactor and the nearest arm.
- **Rear torso hits do ×1.5 to the REACTOR.**
- **Total hull still applies:** total HP = sum of the components. The engine dies when the reactor or total hull reaches 0.
- **Sunspear** keeps its rules (bypasses the shield; leg/rear ×1.6 plus stagger) and applies its damage to the struck component.

Feedback:
- Aiming at a hostile heavy within weapon range shows a small paper-doll of its five components near the crosshair, with the component under the crosshair highlighted. Shield state is shown as an outline.
- The player's own paper-doll replaces the HULL/ACTUATORS rows in the engine-integrity panel for heavy classes.
- A destroyed component smokes and sparks from that part of the rig, and the arm droops.
- Announcements: "CINDERMAW - ARM DISABLED" and similar.

## 3. Capacitors: implicit power management
- The reactor gives a constant output into three capacitor banks, each holding 0-100: WARD, DRIVE and ARMS.
- No new keys. Allocation follows what you do.
- Reactor output by class: Colossus 30/s, Hierarch 36/s, Harrow 42/s.

Each frame:
1. **DRIVE** draws first, at `output × 0.7 × (speed / top)`. Moving costs power, standing costs none.
2. **ARMS** gets what is left until it is full.
3. **WARD** gets the rest, which feeds shield regeneration.
   - Ward regen = the existing regen rate × (0.4 + 1.2 × the flow share reaching WARD).
   - Regen starts immediately when flow arrives. This replaces the 18 s no-damage delay for heavies, but only while planted (see below). Otherwise the existing delay applies.

**Planted (standing still).**
- Applies when speed is below 1.5 m/s for 1.0 s.
- WARD max shield ×1.3 and ward regen ×2.
- Leg-component damage taken ×0.5 (braced).
- HUD tag: PLANTED.

**Energy weapons draw from ARMS.**
- Cost per shot: Lance 100, Fusion blaster 55, Lascannon 35. The Harrow fist costs 20.
- If ARMS cannot cover the cost, the shortfall comes from DRIVE first, then from WARD.
  - Each WARD point lost removes shield at 6 HP per point for the Colossus, 4 for the Hierarch, 3 for the Harrow.
  - You can always fire, but you pay for it.
- Top speed scales with the DRIVE bank: `top × (0.35 + 0.65 × DRIVE / 100)`.
- After any energy shot, ward regen pauses for 2.5 s ("capacitor recovery").

**Lance charge.**
- ARMS drains continuously over the 2.2 s charge rather than all at the release.
- Releasing early (letting go of RMB) cancels the shot and refunds half of what was drained.

**Kinetic weapons (gatling, macro-cannon, battery, missiles, rockets)** use heat and cooldowns only. They are free of capacitor cost, so they stay usable when you are drained.

**HUD.**
- Three vertical capacitor bars: WARD in blue, DRIVE in bone, ARMS in amber, plus the PLANTED tag.
- While an energy weapon charges, a ghost segment shows the predicted drain spilling into DRIVE and WARD.

**Intended feel.** Plant your feet to turtle up and trade. Firing the big energy guns leaves you slow and exposed for a few seconds, so you pick your moment.

**AI.**
- Heavy AI follows the same banks.
- It plants while firing its engine-killer if no enemy heavy is inside 150 m.
- It will not fire an energy weapon if that would drop its WARD below 30 while an enemy heavy is targeting it.

## 4. The little things threaten heavies
- **Fusion-lance (melta) teams.**
  - Enemy infantry with the fusion-lance role prioritise heavy engines within 120 m, including the player's heavy.
  - Within 18 m of a heavy (inside its ward) their shots bypass the shield. Each shot does 45 to the LEGS component.
  - Use the existing melta warning for the player.
- **Enemy Kestrels (Synod scouts).** Against a heavy target they flank to its rear arc and use the flamer on the rear. Damage is ×1.5 to the REACTOR per the rear rule, and the flamer bypasses the ward at under 25 m.
- **Allied escort.** When the player pilots a heavy, VIGILANT THORN and any allied Kestrel switch to escort.
  - They stay within 60-110 m of the player and engage melta teams, tanks and enemy Kestrels within 150 m of the player first.
  - They peel to the player's rear if an enemy Kestrel is there.
- **Harrow fist under the ward.** The Harrow fist goes under the ward: on a bare or shielded target, 70% of its hull damage ignores the shield.

## 5. Something to win
- **Bastions.** Each side has a bastion fortress at the far end of its half of the map: Synod at about z -700, Vigil at about z +700. The exact placement is clear ground beyond the last city blocks.
  - Bastion: 8000 HP, primitive-built (see `model/bastion-visual.md`).
  - **Ward generator:** a separate structure 80-120 m in front of each bastion, 1600 HP. While it stands, a dome ward makes the bastion immune.
  - **Bastion guns:** 2 lance turrets and 4 autocannon turrets. They fire at enemy engines within 600 m (lances: 6 s cycle, S 200 / H 350) and at small units within 300 m.
  - Turrets are destructible: lance turret 600 HP, autocannon turret 300 HP.
- **Win and loss.**
  - Destroying the Synod bastion is VICTORY. Losing the Vigil bastion is DEFEAT.
  - The end screen shows stats (kills by class, damage, time) and a "deploy again" button that reloads with the class picker.
- **AI pressure.** Great colossi and hierarchs push toward the enemy bastion once their lane is clear, so the front line now moves: FRONT ADVANCE reflects that. Bastions do not respawn.
- **Shots.** `?shot=bastion` (Synod bastion and ward generator under fire) and `?shot=locational` (a colossus duel with the paper-doll visible).

## Implementation notes
- Keep the Kestrel paths untouched.
- Add the components and capacitors as a small shared helper used by colossus.js, hierarch.js, harrow.js and the piloted path in player.js. Don't restructure the classes.
- Retune existing numbers in place.
- Bump every `?v=` uniformly.
