# Harrow-class line engine: gameplay spec

Fills the gap between the Kestrel scout (~22.5 m) and the Hierarch battle colossus (~63 m).
It is an aggressive mid-weight brawler. Original design and names.
Built entirely from three.js primitives (no Blender, no GLB), in the same flat-shaded vertex-colour style as the rest of the game.

## Roster
- Vigil (side 0): THE PENITENT BLADE
- Synod (side 1): ASHTONGUE
- One per side, spawning on its side's half of the front.
- Respawn after 70 s.

## Scale and stats
- Height about 38-42 m to the top of the carapace; foot about 1.5 tank lengths.
- Hull 950, ward shield 350, using the same regeneration rules as the other shields, scaled.
- Top speed 16 m/s; quick torso slew, between the Kestrel and the Hierarch.

## Weapons
- **Right arm, lascannon beam:** charges 0.6 s, then an instant hitscan beam out to 260 m.
  Damage: 180 to scouts, 22 to the player's hull (the veil absorbs normally), 90 to a Hierarch, 40 to a great colossus, and it kills tanks. Cooldown 4.5 s.
- **Left arm, siege fist:** a melee swing at anything within 24 m, wind-up 0.7 s.
  Damage: 400 to scouts, 30 to the player plus a knockback shove (a strong lateral velocity push), 120 to a Hierarch.
  It demolishes small and medium buildings it swings into, and kills tanks and infantry in the arc. It walks up to a target to punch it.
- **Carapace rocket rack:** a ground barrage of 8 rockets every 10 s at the densest enemy infantry or tank cluster within 300 m. Each rocket has a 7 m blast.

## Targeting
- Target weights: enemy Harrow 1.0, enemy scout 0.9, player 0.85 (Synod only, within 240 m, needs line of sight), tanks 0.6, infantry 0.4, Hierarch 0.5.
- It never chooses a great colossus as a target.
- It closes to fist range against scouts and the player when it can, and otherwise uses the lascannon.
- Uses the existing hunt cooldown and grudge logic, with friendly-fire grudge on the Vigil Harrow.
- Other units target a Harrow at weight 0.75 (Hierarch), 0.8 (scouts) and 0.5 (great colossi).

## Damage rules
- Sunspear ignores the shield (all shields). A leg or rear hit adds 1.6x damage and staggers it for 10 s.
- Stomp kills infantry and tanks, and deals 120 to scouts.
- Death: the same fold-and-topple style as the scouts, but heavier, with a reactor explosion.

## Presentation
- HUD bar under the Hierarch bars.
- Auspex glyph at about 0.5x the colossus glyph size, with facing.
- The "HAS SEEN YOU" warning fires when the Synod Harrow targets the player.
- The siege-fist wind-up must read clearly (arm draws back, the fist glows) so the player can dodge it.

## Shots
- `?shot=harrow`: the player against the enemy Harrow at close range, with the fist mid-swing.
- `?shot=tiers`: extend it to show all four tiers.
