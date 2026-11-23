# Kestrel-class scout engine: model brief

Original design for Hive Walker (Karnite Vigil player engine, also fielded by the Pyre Synod). Archetype: fast, hunched
scout walker. No third-party designs, names or iconography.

## Silhouette
- Hunched hull thrust forward over the hips; three overlapping carapace shells sloping down to a lip over the head.
- Head slung low in front of the torso: wedge skull, brow plate, slit lenses, portcullis grille.
- Digitigrade legs: thigh forward to a high knee, shin back to the hock, metatarsus down to a three-toed foot
  (two fore toes, one heel spur). Foot length 8.9 m = one tank.
- Big arm weapons on trunnions outboard of the carapace: inferno projector (left, tanks + hollow bell + igniter cage),
  autocannon (right, drum feed, shrouded barrel, muzzle brake). AA rack left-rear on the shell, Sunspear right-rear.
- Stance: hips 14.6 m, about 22.5 m to the top of the rack. Upper hull canted 0.16 rad nose-down; weapons and top mounts scaled 0.82 so they do not overpower the hull.

## Parts and pivots (GLB nodes; game axes x = left, y = up, z = forward)
| node | pivot | driven by |
|---|---|---|
| `walker` | ground origin | root |
| `pelvis` | hip centre (0, 14.6, 0) | body bob / pitch / roll |
| `torso` | waist, +1.2 above pelvis | waist yaw (twist) |
| `head` | neck | pitch follows aim |
| `arm_L` / `arm_R` | shoulder trunnions (about +-5.3, 2.9, 1.1 in torso space) | aim pitch |
| `barrel_R` | same origin as `arm_R` | recoil slide along -z |
| `aa_rack`, `sunspear` | mounts on the shell | static |
| `thigh_*`, `shin_*`, `meta_*`, `foot_*` | hip, knee, hock, ground contact; each segment modelled along local +z | Legs IK |
| empties | `anchor_nozzle` (bell lip), `anchor_pilot`, `anchor_muzzle`, `anchor_rack`, `anchor_lance`, `anchor_lamp` | weapon / fx anchors |

Leg lengths: thigh 6.6, shin 6.4, metatarsus 6.2, ankle 1.5 above the sole, hips +-3.28, feet +-4.0.

## Budget
- 5,768 triangles unique (6,668 with both legs instanced), flat shaded, chamfered armour only.
- No textures. Ten material slots act as livery keys (`hull`, `hull2`, `dark`, `trim`, `bone`, `soot`, `tank`, `glow`,
  `glow_hot`, `nozzle_inner`); COLOR_0 carries baked ambient occlusion x per-plate value jitter.
- In game each node is re-merged to one vertex-coloured geometry per faction (slot colour x AO): 15 opaque draw calls
  per walker plus a few glow meshes, one shared MeshStandardMaterial. GLB is 479 kB.

## Liveries
- Karnite Vigil: slate hull, bone stripe, brass trim, red fuel tanks, amber lenses.
- Pyre Synod: oxblood hull, black stripe, olive trim, ochre tanks, green lenses.

## Animation in game
- No baked clips. `legs.js` plants feet procedurally; the metatarsus rises from the ankle at a lean that follows the
  stride, then thigh + shin are solved hip -> hock with the knee forward. On over-reach the metatarsus swings toward the hip, and past that the rigid lower leg draws the foot in, so the joints never separate. Feet pitch toe-down at lift-off, toe-up to land.
- Torso yaw, arm and head pitch, barrel recoil and body bob/pitch/roll are set per frame by `player.js` / `scouts.js`.

## Source
`build_scout.py` (geometry, run inside the Blender MCP session), `scout_walker.blend`, `scout_walker.glb`, `renders/`.
