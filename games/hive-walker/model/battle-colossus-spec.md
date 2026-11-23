# Hierarch-class battle colossus: gameplay spec

Middle tier between the Kestrel scout engine (~22.5 m) and the existing great colossi.
Original design and names; the archetype is a line battle walker, not a copy of any existing design.

## Roster
- Vigil (side 0): SAINT ORVANE'S FIST, THE IRON CANTOR
- Synod (side 1): EMBERWRIGHT, THE GRIEF-ENGINE
- One of each side at start, near the front line between the scouts and the great colossi.
  The second of each side enters as a reinforcement when the first dies, using the same respawn timing the great colossi use (or 90 s if they never respawn).

## Scale and stats
- Height about 0.55-0.6x a great colossus; foot about 2x a tank length.
- Hull 1300, ward shield 500, regenerating the same way as the great colossi' shield (same delay and rate scaled to 500).
- Top speed 11 m/s; torso slew about 1.6x a great colossus. It turns to face threats noticeably faster than the big ones.

## Weapons
- **Right arm, fusion blaster:** charge 1.2 s with a visible glow tell, then a slow, heavy bolt at 120 m/s.
  Damage: 260 to a scout, 35 hull to the player (veil absorbs normally), 60 to a great colossus, kills tanks, 8 m blast. Cooldown 6 s.
- **Left arm, rotary macro-cannon:** 6-round bursts every 3.5 s.
  Damage: 25 per round to scouts, 4 per round to the player, tank kill on 2 hits, splash kills infantry.
- **Carapace missile pod:** volleys of 6 at aircraft within 400 m (cooldown 8 s). With no aircraft, it fires a ground salvo at infantry clusters.

## Targeting
- Target weights: enemy battle colossus 1.0, enemy scout 0.9, player 0.8 (Synod only, within 220 m with line of sight), tanks 0.6, infantry squads 0.3.
- Use the existing hunt cooldown and grudge logic, including friendly-fire grudge for Vigil hierarchs.
- Great colossi treat a hierarch as a target with weight 0.7.
  A hierarch avoids engaging a great colossus unless it is being shot by one. It is meant to be the thing the player can actually duel.

## Damage rules
- Player Sunspear: ignores the shield (all shields, per the current rule).
  A leg or rear hit adds the existing 1.6x and staggers it for 10 s.
- Stomp kills infantry and tanks, and deals 250 to scouts. A great colossus stomp kills a hierarch's leg actuators: it limps at half speed for 15 s.
- Damage states follow the great colossi' visual progression. Reactor-critical topple and burning wreck as they have.

## Presentation
- HUD: listed under the great colossi bars with a smaller bar.
- Auspex: colossus glyph at about 0.65x size, with facing.
- "X HAS SEEN YOU" warning applies when a Synod hierarch targets the player.

## Shots
- `?shot=hierarch`: close duel between the player and an enemy hierarch.
- `?shot=tiers`: scout, hierarch and great colossus visible together for a size read.

## Model notes (Hierarch asset, as built)
Files: `model/hierarch.glb` (401 kB), `model/hierarch.blend`, source `model/build_hierarch.py` (run after `build_scout.py` in the same
namespace), renders `model/renders/hierarch_*.png`, tier comparison `model/renders/hierarch_tiers.png`.
Axes as the Kestrel: x = walker's left, y = up, z = forward, metres. Same scheme as `js/walker.js`: material slots are livery
keys, `COLOR_0` is baked AO x plate jitter, no textures. 5,512 triangles with both legs (4,676 unique).

**Size.** 65.7 m to the mast tip, 62.7 m to the top of the central spire, about 48.5 m to the carapace deck, 36 m across the
shoulders. Great colossi measure roughly 87 m to the carapace and 115 m to the spire, so the ratio is 0.55-0.57. Foot 17.6 m
heel to toe (two tanks).

**Nodes and rest pivots (world, y up).**
| node | parent | pivot (x, y, z) | driven by |
|---|---|---|---|
| `hierarch` | - | 0, 0, 0 | root |
| `pelvis` | hierarch | 0, 28, 0 | body bob / pitch / roll |
| `torso` | pelvis | 0, 31, 0 | waist yaw |
| `head` | torso | 0, 41.2, 9.6 | optional pitch / small yaw |
| `arm_L` (macro-cannon) | torso | 13.6, 37.4, 1.5 | aim pitch about x |
| `barrels_L` | arm_L | 13.6, 35.4, 1.5 | spin about local z (barrel axis passes through the origin) |
| `arm_R` (fusion blaster) | torso | -13.6, 37.4, 1.5 | aim pitch about x |
| `blaster_glow` | arm_R | same as arm_R | charge tell, see below |
| `missile_pod` | torso | 13.6, 46.6, -2 | static (on the left shoulder) |
| `thigh_L/R` | hierarch | +-7.4, 28, 0 | Legs IK |
| `shin_L/R` | hierarch | knee | Legs IK |
| `foot_L/R` | hierarch | +-9, 0, +-1.6 (ground contact) | Legs |

**Anchors (empties, world rest position).** `anchor_cannon` 13.6, 35.4, 24.1 (child of arm_L) · `anchor_blaster` -13.6, 35.4, 25.1
(child of arm_R) · `anchor_pod` 13.6, 51.2, 2.6 (child of missile_pod, front face of the tubes) · `anchor_reactor` 0, 40.5, -3
(child of torso, centre of the chest, for the death explosion).

**Legs (`legs.js`, existing two-bone path, no `metaL`).** `hipW: 9` (the class puts hips at 0.82 x hipW = 7.4), `thighL: 14`,
`shinL: 14.5`, `footH: 3`, `knee: 1`, hip height 28 at rest. Segments are modelled along local +z from the proximal joint with
the armoured face on local +y, exactly like the Kestrel, and both sides share one mesh. Supply them through `makeParts` as
`walker.js` does (thigh, shin, foot; no meta). Suggested gait to read heavier than the Kestrel and lighter than the great
colossi: `stride 17, stepTime 1.1, stepH 4.5, refSpeed 11`. At hip 28 the knees are visibly bent; do not raise the hip above
about 29.5 or the legs lock straight (max reach 28.5 + 3).

**Charge tell.** `blaster_glow` is its own node with one material slot, `glow_charge` (three coils between the focusing rings
and the throat of the muzzle bell). Give it a per-instance `MeshBasicMaterial` (toneMapped false) and ramp it from black to
about (0.6, 1.4, 2.6) x charge over the 1.2 s charge, then flash and drop. In the GLB it is authored lit, so set it to
black at rest.

**Livery slots.** `hull`, `hull2` (stripe panels), `dark`, `trim`, `bone` (tabards, shoulder bosses, cuisse insets), `soot`,
`tank` (plasma flasks on the blaster), `glow` (visor, lancet windows, shoulder bosses: faction glow), `glow_hot` (reactor
slits, missile tubes: fixed red-orange), `glow_charge` (above). Use the Kestrel's `LIVERY` table unchanged: Vigil slate / bone /
brass, Synod oxblood / black / olive with ochre in place of bone and tank red.

**Hit volumes (suggested).** Torso sphere at y 40 radius 13; legs two capsules radius 4.5 from hip to ankle; shield bubble
radius 30 centred y 34.

**Known limits.** No damage-state variants or wreck mesh are modelled (reuse tinting and emitters). The head has no separate
neck articulation beyond its node pivot. The knee spirelets point forward and will poke through nothing at rest, but check
them against the tabard at extreme knee lift. The model has not been loaded in three.js yet.
