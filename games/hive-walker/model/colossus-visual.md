# Great Colossus: visual build spec for the Blender rebuild

Target: `model/colossus.blend` + `model/colossus.glb`, replacing the primitive body in `js/colossus.js buildParts`.
One mesh set serves all four engines (Karnak the Patient, The Ashen Matriarch, Cindermaw, The Pyre-Father); faction
comes from the livery slots, and the game scales the Synod pair by 1.08 at the root. Author at scale 1.0.
Original design. Nothing here is taken from any existing franchise: no eagles, skulls-in-cogs, fleurs or borrowed
heraldry. The only heraldic device is the plain lozenge the game already uses.

This spec is meant to be executed without design judgement. Where a number is given, use it. Where the builder finds
two statements in conflict, section 4 (contract with the game) wins, then section 12 (tests), then the part lists.

## 1. What it is

A walking cathedral-fortress. The Hierarch (0.55x) carries a chapel on a box; this is the original it copies:

- **Fortress below the deck.** A keystone-shaped hull that is wider at the shoulders than the waist, a ship's-prow
  breastwork thrust forward, two crenellated bastion pauldrons raked forward over the gun arms, a caged furnace on
  the back.
- **Cathedral above the deck.** Twin west towers, a gabled nave with a lit west window, lean-to aisles, transepts,
  flying buttresses, and a great crossing tower with four pinnacles, an octagonal spire and a mast. Organ-pipe
  stacks behind the transepts.
- **Piers for legs.** Legs read as cathedral piers on stepped plinth feet: battered, heavier at the ankle than at
  the hip, each segment at least 12 m across.
- **Posture.** Guns and head forward, spire back: an S-curve in side view. The game applies no lean to a living
  colossus (`body.rotation.x` is only driven while dying), so **all posture is built into the mesh** (section 3).

## 2. Measured current model (the envelope to keep)

Measured from `buildParts` and the constructor, scale 1.0, rest pose (hip 45, torso pivot 50).

| measure | current | rebuild | change |
|---|---|---|---|
| spire apex (world y) | 116.0 | 119.0 | +2.6% |
| mast tip | 124.0 | 125.0 | +0.8% |
| carapace deck top | 79.5 | 79.5 | 0 |
| pauldron cap top | 79.0 | 79.0 | 0 |
| overall width (pauldron caps; arms are inside them) | 71.5 | 72.3 (arm shields) | +1.1% |
| stance width, outside of the feet | 43.0 | 43.6 | +1.4% |
| foot, heel to toe / width | 33.5 / 15.0 | 34.0 / 15.6 | +1.5% / +4.0% |
| body depth without arms (z) | -20.0 .. +21 | -21.6 .. +21.7 | +5% on 41 m |
| gatling muzzle / lance tip (z ahead of the hip axis) | 47 / 51.5 | 47.5 / 52.5 | +1% / +2% |
| hip height, knee thrust | 45, 16.5 m ahead | unchanged | 0 |
| shield | r 46 at torso (0, 18, 0), scale (1, 1.15, 0.9) | unchanged | 0 |
| ground shadow, stomp | r 34, r 12 | unchanged | 0 |

Everything is inside the +-5% allowance. Do not exceed these numbers during the build.

## 3. Posture built into the geometry

| # | device | value |
|---|---|---|
| P1 | Main hull is a keystone: 34 x 20 at the waist, 40 x 24 at the deck, top sheared 1 m forward | front face rakes 3 m forward over 22 m of height (7.8 degrees) |
| P2 | Breastwork (prow) tapers to the front in plan (front 0.8 of rear) and its top is sheared 1 m forward | overhanging chin |
| P3 | Pauldrons are battered (top 0.92) and their tops sheared 1.8 m forward | front face overhangs 1.3 m, rear face slopes forward 2.3 m |
| P4 | Head is carried under the brow canopy, 20 to 22 m ahead of the hip axis and 4 m below the deck | hunched cowl, jaw ahead of the canopy lip |
| P5 | Cathedral mass sits behind the axis: nave centre z +0.5, great spire z -9, stacks z -11.5 | spire is 30 m behind the jaw |
| P6 | Legs: knees 16.5 m ahead of the hips (from the IK rest pose), shins widening to the ankle | crouch, weight low |
| P7 | Arms hang below the pauldrons with the housings tapering toward the muzzle | guns read as thrust forward |

## 4. Contract with the game (do not change)

### 4.1 Axes, units, files

- Game frame: **x = the walker's left, y = up, z = forward**, metres. Blender: `X = x, Y = -z, Z = y` (the engine
  faces Blender -Y). Export `export_yup=True`. Check: `arm_L` must end up at +x in three.js, as in `hierarch.glb`.
- Build with the `Part` helper from `model/build_scout.py` (paste `g2b`, `C3`, `Part`, `empty`, `look_basis`, `place`,
  `MATNAMES`, `ensure_materials` and `pyr` from `build_scout.py` / `build_hierarch.py` into the MCP session). It takes
  game-frame arguments and converts. Authoring is through Blender MCP; save the `.blend` through MCP.
- `Part` signatures used below (all coordinates local to the node pivot, game frame):
  - `box(mat, w, h, d, x, y, z, rx, ry, rz, bev=, tx=, tz=, sx=, sz=, fz=)`. `w, h, d` are the **bottom** face and
    height. `tx, tz` scale the top face in x and z; `sx, sz` shift the top face; `fz` scales the x-width of the +z
    end; `bev` chamfers every edge (one segment).
  - `cyl(mat, rTop, rBottom, h, x, y, z, rx, ry, rz, seg=, caps=)`. Axis is local y. `rx = hp` lays it along z with
    `rTop` at +z; `rz = hp` lays it along x.
  - `pyr(p, mat, w, h, x, yBase, z)`: square spirelet, base at `yBase`.
  - Rotations are Euler XYZ about the primitive's own centre: `+rx` tips the +y end toward +z (and the +z end
    down); `+rz` tips the +y end toward -x (and the +x end up); `+ry` turns the +z end toward +x.
    `hp = pi/2`, `q = pi/4`.
- **Add one helper**, `lancet(p, mat, w, h, x, yBase, z, face)`: a pointed window. A five-sided prism 0.5 m thick
  standing 0.25 m proud of the wall. Outline in the wall plane: `(-w/2, 0), (w/2, 0), (w/2, h - 0.9w), (0, h),
  (-w/2, h - 0.9w)` from `yBase`. `face` is the wall normal: `'+z'`/`'-z'` (x, z given: x is the window centre,
  z the wall surface) or `'+x'`/`'-x'` (x is the wall surface, z the window centre). 16 tris.
- Flat shading everywhere. No modifiers, no textures, no UVs, no armature. One mesh object per node.

### 4.2 Nodes and rest pivots

Each node is an object whose origin is its pivot; mesh data is local to the pivot; rotation and scale are identity
except the six leg nodes (posed, see 4.5).

| node | parent | pivot in parent | world pivot | game field / driven by |
|---|---|---|---|---|
| `colossus` (empty) | - | 0, 0, 0 | 0, 0, 0 | `root` |
| `pelvis` | colossus | 0, 45, 0 | 0, 45, 0 | `body`: hip height + bob, death lean |
| `torso` | pelvis | 0, 5, 0 | 0, 50, 0 | `torso`: waist yaw |
| `head` | torso | 0, 20, 13 | 0, 70, 13 | new, static (head damage zone) |
| `arm_L` (gatling) | torso | 28, 12, 3 | 28, 62, 3 | `armL`: `rotation.x` = aim pitch, droop when destroyed |
| `barrels_L` | arm_L | 0, -4, 0 | 28, 58, 3 | `barrels`: spin about local z |
| `arm_R` (lance) | torso | -28, 12, 3 | -28, 62, 3 | `armR`: aim pitch, droop |
| `lance_glow` | arm_R | 0, 0, 0 | -28, 62, 3 | new, charge tell (slot `glow_charge` only) |
| `thigh_L/R` | colossus | hip | +-11.48, 45, 0 | `Legs` IK |
| `shin_L/R` | colossus | knee | +-12.66, 26.30, 16.55 | `Legs` IK |
| `foot_L/R` | colossus | ground contact | +-14, 0, 0 | `Legs` |

### 4.3 Anchors (empties, exported)

| anchor | parent | local position | world at rest | replaces |
|---|---|---|---|---|
| `anchor_gatling` | arm_L | 0, -4, 46 | 28, 58, 49 | `mzL` |
| `anchor_lance` | arm_R | 0, -4, 50 | -28, 58, 53 | `mzR` |
| `anchor_battery` | torso | 27.5, 33, 18 | 27.5, 83, 18 | `mzTop` |
| `anchor_head` | head | 0, 3, 8 | 0, 73, 21 | `head` (searchlight origin, head hit sphere r 12) |
| `anchor_reactor` | torso | 0, 12, -20 | 0, 62, -20 | reactor-critical glow, death fx |
| `anchor_shield` | torso | 0, 18, 0 | 0, 68, 0 | shield centre (reference) |
| `anchor_stack_L/R` | torso | +-16.5, 45.5, -11.5 | +-16.5, 95.5, -11.5 | stack smoke |

### 4.4 Mount pads and keep-clear volumes (hardpoints-visual.md section 5)

The mounts are built by the game, not by this model. The body must present these surfaces and leave these volumes
empty. At blockout, build the proxies in a collection `MountProxy` (never exported) and keep them to the end.

| mount | pad (torso-local unless noted) | surface the body provides | keep clear | proxy |
|---|---|---|---|---|
| `flak_1` | 0, 27, 15 | brow canopy top, flat at y 27, x +-7, z 10..20 | nothing above y 27 within 6.5 m of the pad axis; nothing above y 33 within 10.5 m, for yaw -100..+100 (forward half) | cyl r 4.2 h 6.5 on the pad; sphere r 10.5 at y 30.9 |
| `flak_2/3` | +-17, 29.5, 7 | deck top, flat at y 29.5 | ring r 4.3 on the pad; nothing above y 33 within 10.5 m on the outboard side and to the rear-inboard as far as yaw 220 | same |
| `turret_L/R` | +-28.5, 35, -2 | battery housing top, flat at y 35, at least 7 x 7 | nothing above y 37 within 9.5 m of the axis (so nothing tall outboard of x +-19.3 between z -11.5 and +7.5) | cyl r 3.2 h 4; box 5.6 x 3.2 x 6.4 above it; sphere r 9.5 at y 40.8 |
| `spine` | keel 6 x 20 x 3 at 0, 29.6, -15.9; slabs to z -19.6 | deck rear face at z -15; great-tower rear face no further back than z -14 | column x +-5.5, y 19.6..41, z -20..-14.4 empty (the centre reactor rib may rise to y 24 inside it: intended overlap) | box 11 x 21.5 x 6 at 0, 30.3, -17 |
| `kneebat_L/R` | shin-local 0, 6.9, 13, `rotation.x = -hp` | greave top face flat at shin y 6.9, bare for x +-2.5, z 10..16 | nothing above shin y 8.5 for x +-7, z 9..17; knee guard ends at z 8.25 | box 3.6 x 3 x 4 on the pad |

The carapace battery barrels (top at y 34.5, x +-27.5) are part of the keep-clear arithmetic for `flak_2/3`: do not
raise or thicken them.

### 4.5 Legs

`legs.js` parameters stay exactly as now:

```js
{ hipW: 14 * s, thighL: 25 * s, shinL: 27 * s, stride: 34 * s, stepTime: 2.3, stepH: 9 * s, footH: 5 * s,
  refSpeed: 7, knee: 1 }        // hip height 45 * s; stepTime 3.3 when limping
```

- Segments are modelled along local **+z from the proximal joint with the armoured face on local +y**. The foot's
  origin is the ground contact point, y up, z forward.
- **Thigh, shin and foot must each be symmetric about local x = 0**, because the loader shares one geometry between
  the left and right legs. `*_R` objects are linked duplicates of the `*_L` meshes.
- Rest pose for the file: hip (+-11.48, 45, 0), knee (+-12.66, 26.30, 16.55), ankle (+-14, 5, 0), foot (+-14, 0, 0).
  Place with `look_basis(from, to)` exactly as `build_hierarch.py` does (HH 45, hip x 11.48, foot x 14, thigh 25,
  shin 27, foot height 5, no fore-aft stagger). The shin then leans 38 degrees and its armoured face looks forward
  and down.
- The joint drums carry the articulation: knee drum on the thigh's far end, ankle drum on the shin's far end.

### 4.6 Game-side values that stay valid with this model

Torso ray cylinder r 21, y 34..100; leg spheres r 7; `rArm` 16, `rHead` 12, `legTop` 40; chest point y 66; shield and
shadow as section 2. No change is requested to any of them.

## 5. Livery slots

Material slot names are the livery keys of `LIVERY` in `js/walker.js`. **Use only these names**: the loader drops
any other slot.

| slot | Vigil | Synod | used for on the colossus |
|---|---|---|---|
| `hull` | slate 0x46525e | oxblood 0x5a211a | hull, breastwork, pauldrons, arm housings, cuisses, greaves, roofs, belfry |
| `hull2` | bone 0x9a947e | black 0x17130f | knee guards, arm top panels (the faction stripe) |
| `dark` | 0x1d2228 | 0x191414 | deck, cathedral walls and towers, frames, joints, reactor cage |
| `trim` | brass 0x9a7a3a | olive 0x6c7434 | spires, finials, edge bands, pilasters, collars. **Never a broad plate** |
| `bone` | bone 0x9a947e | ochre 0x8a6a22 | tabards, reliquary plates, shield panels, frieze |
| `soot` | 0x0b0a09 | same | gun barrels, stacks |
| `tank` | red 0x7a2a1c | ochre 0x8a6a22 | heraldic lozenges, lance flasks |
| `glow` | amber | green | every window, visor, lozenge cores, running light |
| `glow_hot` | (2.2, 0.3, 0.1) | same | **reactor furnace bays only** (hot orange = the reactor, and nothing else on the body) |
| `glow_charge` | per instance | per instance | `lance_glow` only |

Note for integration: the old Builder colossus used `PAL[1].bone` (umber 0x3a3028) for Synod tabards; with the
shared table they become ochre like the Hierarch. That is the intended look.

## 6. Part lists

Tags: **[B]** = part of the blockout (section 10). Tri counts are approximate (plain box 12, bevelled box 44,
`pyr` 10, `cyl` 4 x seg, `lancet` 16). `+-` means build both signs; where a rotation or shear sign flips for the -x
copy it is written `(-x: ...)`.

### 6.1 pelvis (about 380 tris), pivot world (0, 45, 0)

```
[B] box(dark, 24, 9, 17,  0, 0, 0,  bev=.4, tx=1.10)                    # core, keystone: 24 wide below, 26.4 above
[B] cyl(dark, 7, 7, 10,  +-14, 0, 0,  rz=hp, seg=10)                    # hip drums, x 9..19
[B] box(dark, 13, 8, 13,  0, -6.5, 0,  bev=.3, tx=1.23)                 # crypt block under the core, y -10.5..-2.5
[B] box(bone, 9, 26, 0.8,  0, -18, 9.2,  tx=.8)                         # front tabard, flares to the hem (world y 14..40)
    box(trim, 11, 3, 1.6,  0, -4, 9.3)                                  # tabard header bar
    box(dark, 2, 20, 0.5,  0, -17.5, 9.8)                               # tabard stripe
    box(tank, 5.5, 5.5, 0.5,  0, -12, 9.9,  rz=q)                       # tabard lozenge
    box(trim, 9.6, 1.4, 1.2,  0, -31, 9.2)                              # hem weight bar
    box(bone, 8, 20, 0.7,  0, -15, -9,  tx=.8)                          # rear tabard
    box(trim, 8.6, 1.2, 1.1,  0, -25, -9)                               # rear hem bar
[B] box(hull, 1.4, 13, 9.5,  +-19.7, -2.5, 0,  rz=+.12 (-x: -.12), bev=.3, tz=1.37)   # tassets: kite plates over the drum ends, hem kicked out
    box(bone, 0.5, 5, 5,  +-20.6, -2, 0,  rx=q)                         # tasset boss
    box(bone, 20, 2.6, 0.6,  0, 1.2, 8.8)                               # litany frieze across the front of the core
```

### 6.2 torso, fortress (about 1,950 tris), pivot world (0, 50, 0)

```
# --- hull and breastwork
[B] cyl(dark, 9, 10.5, 6,  0, 1, 0,  seg=10)                            # waist ring, y -2..4
[B] box(hull, 34, 22, 20,  0, 14, 0,  bev=.5, tx=1.18, tz=1.2, sz=1.0)  # MAIN HULL keystone: y 3..25; top x +-20, z -11..13
[B] box(dark, 30, 3, 12,  0, 4, 12,  fz=.75)                            # keel lip, y 2.5..5.5, z 6..18
[B] box(hull, 26, 9, 10,  0, 8.5, 15,  bev=.4, tx=.85, sz=1.0, fz=.8)   # BREASTWORK: y 4..13, z 10..21, front 20.8 wide
[B] box(hull, 7.5, 12, 8,  +-9.75, 19, 15.5,  bev=.35, tx=.88)          # flank piers either side of the head niche: y 13..25, z 11.5..19.5 (front face vertical)
[B] box(dark, 28, 2, 10,  0, 26, 15,  bev=.3, fz=.8)                    # BROW CANOPY = flak_1 pad: top flat at y 27, z 10..20
    box(trim, 22.6, 1.0, 0.8,  0, 26.3, 20.2)                           # canopy lip band
    box(dark, 2, 3, 2,  +-9.8, 28.5, 18,  bev=.15)                      # brow finial shafts, y 27..30
    pyr(trim, 2.4, 3,  +-9.8, 30, 18)                                   # brow finials, tips y 33 (must stay below 33.4)
    cyl(trim, 1.1, 1.1, 12,  +-6.3, 19, 20.2,  seg=6)                   # portal jamb columns under the canopy, y 13..25
    lancet(glow, 1.5, 5,  x, 15.5, 19.5, '+z')   for x in +-7.6, +-9.75, +-11.9      # six chest windows on the flank piers
# --- reliquary on the breastwork front (the face rakes forward: rx .1)
    box(bone, 9, 6.5, 0.8,  0, 8.5, 20.7,  rx=.1)                       # casket plate
    box(trim, 10.4, 0.8, 1.0,  0, 12.15, 21.05,  rx=.1)                 # casket top bar
    box(trim, 10.4, 0.8, 1.0,  0, 4.85, 20.35,  rx=.1)                  # casket bottom bar
    box(tank, 4.6, 4.6, 0.6,  0, 8.5, 21.2,  rx=.1, rz=q)               # heraldic lozenge
    box(glow, 1.8, 1.8, 0.5,  0, 8.5, 21.6,  rz=q)                      # lozenge core
    box(bone, 3, 5, 0.5,  +-6.9, 8, 20.6,  rx=.1)                       # litany plates
    box(glow, 12, 0.9, 0.5,  0, 4.2, 18.1)                              # running light on the keel lip
# --- carapace deck
[B] box(dark, 42, 5, 26,  0, 27, -1,  bev=.4, tx=1.071, tz=1.077)       # DECK, corbelled out: top x +-22.5, z -15..13, flat at y 29.5
    box(trim, 43.4, 0.8, 27,  0, 25.6, -1)                              # cornice band under the deck
    box(dark, 2.2, 1.6, 1.2,  x, 30.3, 12.3)   for x in +-7.5, +-11.2, +-14.9, +-18.6     # eight front merlons (none within x +-6.5)
# --- bastion pauldrons (static: the arms swing beneath them)
[B] box(hull, 15, 13, 27,  +-27.5, 21, 0,  bev=.5, tx=.92, tz=.96, sx=+.6 (-x: -.6), sz=1.8)
                                                                        # PAULDRON: y 14.5..27.5; outer face vertical at x +-35; top z -11.2..14.8
[B] box(dark, 15.2, 1.6, 27.4,  +-27.5, 28.2, 1.6)                      # cap slab, top flat at y 29
    box(trim, 0.8, 1.0, 27.6,  +-35.2, 28.5, 1.6)                       # cap rim, outer
    box(trim, 15.4, 1.0, 0.8,  +-27.5, 28.5, 15.4)                      # cap rim, front
    box(trim, 15.4, 1.0, 0.8,  +-27.5, 28.5, -12.2)                     # cap rim, rear
    box(bone, 9, 9, 0.6,  +-27.5, 21, 14.3,  rx=.1)                     # pauldron boss plate (front face)
    box(tank, 5, 5, 0.5,  +-27.5, 21, 14.7,  rx=.1, rz=q)               # boss lozenge
    box(glow, 2.4, 2.4, 0.5,  +-27.5, 21, 15.0,  rz=q)                  # lozenge core
    box(trim, 0.7, 12, 1.0,  +-35.2, 21, z)   for z in -10, -2.9, 4.1, 11.2      # four pilasters on the outer face
    lancet(glow, 1.8, 6.5,  +-35, 17.5, z, '+x' (-x: '-x'))   for z in -6.4, 0.6, 7.6   # blind arcade of three lit lancets per pauldron
[B] box(dark, 2.6, 5, 2.6,  +-33.4, 31.5, z,  bev=.15)   for z in 13.4, -10.4   # corner pinnacle shafts, y 29..34
[B] pyr(trim, 3.2, 5,  +-33.4, 34, z)   for z in 13.4, -10.4            # pinnacles, tips y 39
    box(dark, 1.2, 1.6, 2.4,  +-34.4, 29.8, z)   for z in -5.6, -1.6, 2.4, 6.4, 10.4   # five merlons along each outer edge
# --- carapace battery (positions fixed by the mounts)
[B] box(dark, 9, 6, 11,  +-27.5, 32, -2,  bev=.3, tz=.85)               # housing, y 29..35 (turret pad on top: keep bare)
[B] cyl(soot, 1.3, 1.5, 16,  +-27.5, 33, 9,  rx=hp, seg=8)              # siege barrel, z 1..17
    cyl(trim, 2, 2, 1.4,  +-27.5, 33, 16.2,  rx=hp, seg=8)              # muzzle collar
    box(dark, 3.6, 2.4, 6,  +-27.5, 30.2, 7.5)                          # barrel cradle
# --- rear reactor: the caged furnace (damage zone, see section 9)
[B] box(dark, 30, 16, 9,  0, 13, -15,  bev=.4, tx=.88)                  # furnace housing, y 5..21, rear face vertical at z -19.5
[B] box(dark, 2.4, 22, 2.6,  x, 13, -19.9)   for x in 0, +-7           # cage ribs, y 2..24, to z -21.2
[B] box(dark, 2.4, 22, 2.6,  +-13.7, 13, -19.9,  rz=+.11 (-x: -.11))    # outer ribs, battered inward at the top
    pyr(trim, 2.8, 4,  x, 24, -19.9)   for x in +-7, +-12.5            # rib finials, tips y 28 (none on the centre rib)
    box(trim, 3, 1.2, 3.2,  x, 2.6, -19.9)   for x in 0, +-7, +-14.9   # rib shoes
    box(glow_hot, 4.2, 11, 0.5,  +-3.5, 13, -19.6)                      # inner furnace bays, y 7.5..18.5
    box(glow_hot, 3.4, 9, 0.5,  +-10.3, 12.5, -19.6)                    # outer furnace bays
    box(dark, 4.8, 0.9, 1.0,  +-3.5, 13, -19.9)                         # bay transoms
    box(dark, 4.2, 0.9, 1.0,  +-10.3, 12.5, -19.9)
    box(bone, 5, 5, 0.6,  0, 13, -21.3,  rz=q)                          # reliquary seal on the centre rib
```

### 6.3 torso, cathedral (about 1,250 tris), same node

Everything stands on the deck top (y 29.5). Walls with windows stay vertical; their roofs and spires are their taper.

```
# --- west front: twin towers
[B] box(dark, 5, 17.5, 5,  +-9.5, 38.25, 4.5,  bev=.2, tx=.9, tz=.9)    # west tower shafts, y 29.5..47 (inner face x 7, outer x 12)
    box(trim, 5.4, 0.8, 5.4,  +-9.5, 40, 4.5)                           # string course
    box(dark, 5.2, 1, 5.2,  +-9.5, 47.5, 4.5)                           # parapet
[B] pyr(trim, 4.8, 9.5,  +-9.5, 48, 4.5)                                # west spires, tips y 57.5
    lancet(glow, 1.5, 4.8,  +-9.5, 41.5, 6.85, '+z')                    # belfry light, front
    lancet(glow, 1.5, 4.8,  +-11.85, 41.5, 4.5, '+x' (-x: '-x'))        # belfry light, outer
# --- nave
[B] box(dark, 14, 10.5, 10,  0, 34.75, 0.5)                             # nave: x +-7, y 29.5..40, z -4.5..5.5
[B] box(hull, 15, 6, 10.6,  0, 43, 0.5,  tx=.02)                        # gable roof, ridge along z at y 46
    box(trim, 0.8, 0.8, 10.8,  0, 46, 0.5)                              # ridge beam
    box(trim, 0.8, 3, 0.8,  0, 47.4, 5.5)                               # gable finial post, to y 48.9
    box(trim, 2.4, 0.7, 0.7,  0, 47.8, 5.5)                             # finial bar
    lancet(glow, 2.4, 8,  0, 31.5, 5.5, '+z')                           # great west window, centre light
    lancet(glow, 1.8, 6,  +-3.2, 31.5, 5.5, '+z')                       # great west window, side lights
    box(dark, 2.5, 4, 6.5,  +-8.25, 31.5, -1.25)                        # aisles: x 7..9.5, y 29.5..33.5, z -4.5..2
    box(hull, 3, 0.6, 6.7,  +-8.3, 34.2, -1.25,  rz=-.45 (-x: +.45))    # lean-to aisle roofs, outer edge low
    lancet(glow, 1.4, 4.2,  +-7, 35.2, z, '+x' (-x: '-x'))   for z in -3.2, -1.2, 0.8   # clerestory, three per side
# --- transepts
[B] box(dark, 3.5, 9.5, 8,  +-7.25, 34.25, -8.5)                        # transept arms: x 5.5..9, y 29.5..39, z -12.5..-4.5
    box(hull, 3.9, 4.5, 8.6,  +-7.3, 41.25, -8.5,  tz=.02)              # transept roofs, ridge along x at y 43.5
    lancet(glow, 2.4, 7,  +-9, 31.5, -8.5, '+x' (-x: '-x'))             # transept end windows
# --- crossing tower and great spire
[B] box(dark, 11, 15, 10,  0, 37, -9,  bev=.25, tx=.94, tz=.94)         # lower stage, y 29.5..44.5, rear face z -14
    box(trim, 11, 0.9, 10,  0, 44.5, -9)                                # string course
[B] box(hull, 10, 10, 9,  0, 49.5, -9,  bev=.2)                         # belfry stage, y 44.5..54.5, x +-5, z -13.5..-4.5
    box(dark, 10.8, 1.2, 9.8,  0, 55.1, -9)                             # parapet, top y 55.7
    lancet(glow, 1.6, 7,  +-2.2, 46, -4.5, '+z')                        # belfry lights: two per face, eight in all
    lancet(glow, 1.6, 7,  +-2.2, 46, -13.5, '-z')
    lancet(glow, 1.6, 7,  +-5, 46, z, '+x' (-x: '-x'))   for z in -11.2, -6.8
[B] box(dark, 1.8, 3.5, 1.8,  +-4.4, 57.45, z)   for z in -5.1, -12.9   # four corner pinnacle shafts, y 55.7..59.2
[B] pyr(trim, 2.2, 5,  +-4.4, 59.2, z)   for z in -5.1, -12.9           # corner pinnacles, tips y 64.2
[B] cyl(trim, 0.05, 4.0, 13.3,  0, 62.35, -9,  seg=8, caps=False)       # GREAT SPIRE, octagonal, y 55.7..69
[B] box(dark, 0.7, 7, 0.7,  0, 71.5, -9)                                # mast, y 68..75
    box(dark, 3, 0.5, 0.5,  0, 72.5, -9)                                # mast yard
# --- flying buttresses (behind the flak sweep, inboard of the turret sweep)
[B] box(dark, 2.4, 11.5, 2.4,  +-11.5, 35.25, z,  tx=.85, tz=.85)   for z in -6.5, -11.5   # piers, y 29.5..41
    pyr(trim, 2.8, 5,  +-11.5, 41, z)   for z in -6.5, -11.5            # pier pinnacles, tips y 46
    box(dark, 7.8, 0.9, 0.9,  +-7.8, 43.5, z,  rz=-.876 (-x: +.876))   for z in -6.5, -11.5   # flyers, rising from the pier to the belfry
# --- stacks
[B] cyl(soot, 2.4, 2.8, 15.5,  +-16.5, 37.25, -11.5,  seg=8)            # great stacks, y 29.5..45
    cyl(trim, 3.0, 3.0, 1.2,  +-16.5, 43, -11.5,  seg=8)                # stack collars
    cyl(soot, 1.8, 2.0, 10.5,  +-20, 34.75, -12.6,  seg=6)              # lesser stacks, y 29.5..40 (they fuse with the great stacks: intended)
```

### 6.4 head (about 200 tris), pivot torso (0, 20, 13)

A portcullis helm in the portal niche, under the brow canopy, between the lit flank piers.

```
[B] box(dark, 8, 7, 8,  0, 0, 3.5,  bev=.3, tz=.9, fz=.8)               # skull, narrowing to the snout
    box(hull, 8.6, 1.6, 5,  0, 3, 5.6,  rx=.3)                          # brow wedge (top stays under torso y 24.5)
[B] box(hull, 10, 3.5, 8,  0, -5.2, 3.5,  bev=.3, fz=.85)               # gorget, resting on the breastwork
    box(glow, 6, 1.1, 0.5,  0, 1.2, 7.6)                                # visor slit
    box(trim, 6.4, 3, 1,  0, -1.8, 7.8)                                 # jaw plate
    box(bone, 0.7, 3.4, 0.5,  x, -1.8, 8.4)   for x in -2.4, -0.8, 0.8, 2.4   # four portcullis bars (front at torso z 21.65)
    cyl(trim, 0.9, 0.9, 2,  +-4.3, 0.5, 5,  rx=hp, seg=6)               # cheek lamps
    box(glow, 1.2, 1.2, 0.4,  +-4.3, 0.5, 6.1)                          # lamp lenses
```

### 6.5 arm_L, gatling battery (about 230 tris), pivot torso (28, 12, 3)

```
[B] cyl(dark, 6.5, 6.5, 7,  -6.5, 0, 0,  rz=hp, seg=10)                 # trunnion into the hull
[B] box(hull, 12, 12, 22,  0, -4, 3,  bev=.5, tx=.9, fz=.85)            # housing, z -8..14
    box(hull2, 11, 1.2, 12,  0, 2.4, 3)                                 # top stripe panel
[B] box(dark, 8, 10, 9,  0, -5, -10,  bev=.3, tz=.85)                   # ammunition hopper (rear)
[B] box(dark, 10.5, 10.5, 3,  0, -4, 15.5,  bev=.3)                     # barrel bearing block
[B] cyl(dark, 4, 4, 9,  0, -11.5, 1,  rz=hp, seg=8)                     # belt drum slung under the housing
    cyl(trim, 4.3, 4.3, 1,  0, -11.5, 1,  rz=hp, seg=8)                 # drum band
[B] box(hull, 1.2, 14, 12,  6.7, -4, 3,  rz=+.08, bev=.3, tz=1.5)       # outboard kite shield, 18 deep at the top
    box(bone, 0.6, 7, 7,  7.5, -3, 3,  rx=q)                            # shield panel
    box(tank, 0.5, 3.5, 3.5,  7.9, -3, 3,  rx=q)                        # shield lozenge
```

### 6.6 barrels_L (about 290 tris), pivot arm_L (0, -4, 0); spins about local z

```
[B] cyl(soot, 1.3, 1.3, 27,  3.4 cos a, 3.4 sin a, 31,  rx=hp, seg=6)   for a = 0, 60, .. 300 degrees   # six barrels, z 17.5..44.5
    cyl(dark, 1.6, 1.6, 26,  0, 0, 31,  rx=hp, seg=6)                   # spindle
[B] cyl(dark, 5.2, 5.2, 1.6,  0, 0, z,  rx=hp, seg=10)   for z in 24, 33, 41   # three hoops
```

### 6.7 arm_R, the lance (about 380 tris), pivot torso (-28, 12, 3); and lance_glow (48 tris)

Deliberately unlike the gatling: one long tapered barrel with square collars set on the diamond and a three-pronged
emitter.

```
[B] cyl(dark, 6.5, 6.5, 7,  6.5, 0, 0,  rz=hp, seg=10)                  # trunnion
[B] box(hull, 12, 13, 24,  0, -4, 3,  bev=.5, tx=.9, fz=.8)             # receiver, z -9..15
    box(hull2, 11, 1.2, 12,  0, 3, 3)                                   # top stripe panel
[B] box(dark, 8, 10, 9,  0, -5, -10,  bev=.3, tz=.85)                   # capacitor bank (rear)
    cyl(tank, 1.5, 1.5, 7,  x, -11.6, -2,  rx=hp, seg=6)   for x in -3.5, 0, 3.5   # three coolant flasks under the receiver
[B] cyl(dark, 2.8, 3.6, 32,  0, -4, 30,  rx=hp, seg=8)                  # barrel, z 14..46, tapering to the muzzle
[B] box(trim, 6.2, 6.2, 1.2,  0, -4, z,  rz=q)   for z in 19, 25.5, 32, 38.5   # four diamond collars
[B] box(dark, 6.5, 6.5, 5,  0, -4, 45.5,  bev=.3)                       # emitter block, z 43..48
    box(trim, 1.2, 1.2, 5,  0, 0.2, 47)                                 # three prongs, z 44.5..49.5
    box(trim, 1.2, 1.2, 5,  +-3.6, -6.1, 47)
[B] box(hull, 1.2, 14, 12,  -6.7, -4, 3,  rz=-.08, bev=.3, tz=1.5)      # outboard kite shield
    box(bone, 0.6, 7, 7,  -7.5, -3, 3,  rx=q)
    box(tank, 0.5, 3.5, 3.5,  -7.9, -3, 3,  rx=q)

# lance_glow (own node, slot glow_charge, same pivot as arm_R)
    box(glow_charge, 4.4, 4.4, 3.6,  0, -4, z,  rz=q)   for z in 22.25, 28.75, 35.25   # coils between the collars
    box(glow_charge, 3, 3, 0.5,  0, -4, 48.2)                           # emitter lens
```

### 6.8 legs (about 1,000 tris per leg: thigh 300, shin 310, foot 390), local +z along the bone, +y the armoured face

```
# thigh (25 long)
[B] box(dark, 9.5, 10, 25,  0, 0, 12.5,  bev=.4, fz=.85)                # core
[B] box(hull, 12, 3.5, 19,  0, 6, 11,  bev=.35, tx=.9, fz=.8)           # cuisse, z 1.5..20.5
    box(bone, 6, 0.8, 11,  0, 8, 10.5,  fz=.8)                          # cuisse reliquary inset
    box(tank, 3.6, 0.6, 3.6,  0, 8.5, 10.5,  ry=q)                      # cuisse lozenge
    box(trim, 1.2, 8, 2.6,  +-5.0, 0.5, z)   for z in 5, 12             # pier pilasters on both flanks
    cyl(trim, 1.5, 1.5, 20,  +-2.8, -5.6, 12,  rx=hp, seg=6)            # rear hydraulics
[B] cyl(dark, 6.8, 6.8, 13,  0, 0, 25,  rz=hp, seg=10)                  # knee drum
    cyl(trim, 3, 3, 0.8,  +-6.7, 0, 25,  rz=hp, seg=6)                  # knee hub caps

# shin (27 long)
[B] box(dark, 8.5, 9, 27,  0, 0, 13.5,  bev=.4, fz=1.15)                # core, widening to the ankle
[B] box(hull, 11.5, 3, 20,  0, 5.4, 14,  bev=.3, fz=1.1)                # GREAVE, top flat at y 6.9 (knee-battery pad: bare for x +-2.5, z 10..16)
[B] box(hull, 1.2, 7, 16,  +-5.9, 1.5, 15,  tz=.85)                     # greave side skirts
    box(bone, 3, 0.5, 6,  0, 7.1, 20.5)                                 # greave stripe below the battery
[B] box(hull2, 12.5, 5.5, 8.5,  0, 6.25, 4,  bev=.35, tx=.8, tz=.8)     # knee guard, y 3.5..9, z -0.25..8.25
[B] pyr(trim, 4, 6,  0, 9, 4)                                           # knee spirelet, tip y 15
    cyl(trim, 1.3, 1.3, 20,  +-2.6, -5, 14,  rx=hp, seg=6)              # calf pistons
[B] box(dark, 5, 4, 11,  0, -5.5, 20,  bev=.3, fz=1.2)                  # calf block
[B] cyl(dark, 5, 5, 11.5,  0, 0, 27,  rz=hp, seg=10)                    # ankle drum

# foot (origin = ground contact; 34.0 long, 15.6 wide)
[B] box(dark, 15, 3, 21,  0, 1.5, 2,  bev=.3, tx=.94, tz=.96)           # plinth, z -8.5..12.5
[B] box(hull, 13, 2.6, 18,  0, 4.3, 1.5,  bev=.3, tx=.85, tz=.85)       # plinth step, y 3..5.6
    box(trim, 15.6, 0.9, 21.6,  0, 2.9, 2)                              # plinth band
[B] box(hull, 10.5, 4.4, 11,  0, 7.6, 0,  bev=.35, tx=.8, tz=.75)       # instep block round the ankle, y 5.4..9.8
[B] box(hull, 4.4, 3.6, 8,  x, 1.8, 15.5,  bev=.25, fz=.75)   for x in -5.3, 0, 5.3   # three toes, z 11.5..19.5
    box(trim, 4.2, 1.0, 3,  x, 3.9, 17.5,  fz=.8)   for x in -5.3, 0, 5.3             # toe caps
[B] box(hull, 7, 3.6, 7,  0, 1.8, -11,  bev=.25, tx=.85)                # heel spur, z -14.5..-7.5
    box(trim, 6.4, 1.0, 2.6,  0, 3.9, -12.6)                            # heel cap
    box(dark, 1.4, 6, 8,  +-6.1, 6.5, 0,  tz=.7)                        # ankle cheeks
```

## 7. Form rules (apply to every part, including any fix)

1. **No untapered slab.** Every `hull`, `hull2` or `dark` box longer than 8 m in any dimension carries a taper,
   shear or rake (`tx`, `tz`, `sx`, `sz`, `fz` or a rotation), as listed. Exempt, because their roofs and spires are
   their taper: the nave, the transept arms, the belfry stage, parapets, the cap slabs and thin plates under 1.7 m.
2. **Trim is line, never plate.** No exposed flat `trim` face over 40 m2. Trim appears only as bands at most 1.2 m in
   one dimension, pilasters, collars, finials and spires.
3. **Every broad face has its named secondary detail** (section 8). No exposed flat face over 160 m2 in any slot
   without at least one.
4. **Readable scale.** Nothing smaller than 0.7 m in two dimensions, except window relief (0.5), the mast and its
   yard. Windows are at least 1.4 m wide.
5. Windows and plates that sit on a raked face take the rake given in the list; do not leave them floating or sunk
   by more than 0.3 m.
6. Mirror by building both signs, never by negative scale.

## 8. Secondary detail per major surface

| major surface | named secondary detail (all listed in section 6) |
|---|---|
| main hull, front | breastwork, flank piers, six chest lancets, jamb columns |
| breastwork front | casket plate with two bars, lozenge with lit core, two litany plates, running light |
| brow canopy | lip band, two finials (the flak sits between them) |
| deck front edge | cornice band, eight merlons |
| pauldron front | boss plate, lozenge with lit core, cap rim |
| pauldron outer face | four pilasters, three lit lancets, five merlons, two corner pinnacles |
| pauldron top | battery housing, cradle, barrel and collar (turret pad left bare) |
| hull rear | furnace housing, five ribs with shoes and four finials, four hot bays with transoms, seal |
| nave west front | three-light west window, gable finial, twin towers with string courses and belfry lights |
| nave flanks | aisle with lean-to roof, three clerestory lancets per side |
| crossing tower | string course, eight belfry lancets, parapet, four pinnacles, spire, mast and yard |
| deck, rear quarters | transepts with end windows, four buttress piers with pinnacles and flyers, four stacks with collars |
| pelvis front | frieze, tabard with header, stripe, lozenge and hem bar |
| pelvis flanks / rear | tassets with bosses; rear tabard with hem bar |
| arm outer face | kite shield with panel and lozenge |
| arm top | stripe panel |
| thigh front | cuisse with reliquary inset and lozenge; pilasters on the flanks |
| shin front | knee guard with spirelet, greave with stripe (battery pad bare), side skirts |
| foot | plinth band, three toe caps, heel cap, ankle cheeks |

## 9. Damage-location zones

Each zone must be recognisable by shape and by a colour signature that occurs nowhere else.

| zone (`heavy.js` comp) | geometry | signature | world extent at rest |
|---|---|---|---|
| **head** | `head` node in the portal niche | the only visor slit; bone portcullis bars under a trim-lipped canopy between two lit window piers | y 65..74, z 12..22, x +-5 |
| **armL** | `arm_L` + `barrels_L` | six soot barrels in hoops, belt drum, kite shield | x 20..36, y 46..66, z -9..48 |
| **armR** | `arm_R` + `lance_glow` | one long barrel, four diamond collars, three prongs, tank flasks, kite shield | x -36..-20, y 47..66, z -10..53 |
| **reactor** | furnace cage on the hull rear | the only `glow_hot` on the body: four hot bays behind dark ribs, bone seal | x +-15, y 52..74 (finials 78), z -21.6..-10.5 |
| **legs** | thigh, shin, foot (everything under world y 40) | hull2 knee guards with trim spirelets; plinth feet | y 0..45 |

Rules that protect the read: no `glow_hot` anywhere but the furnace; no `hull2` anywhere but knee guards and arm top
panels; the arms carry no windows; the reactor bays (world y 57.5..68.5) must be unobstructed from directly behind,
with the missile spine starting above them at y 69.6.

No damage-state or wreck meshes are modelled. The game tints, droops arms and attaches emitters at the anchors.

## 10. Stage 1: major-shape blockout (stop and check before any detail)

Build only the parts tagged **[B]** (about 75 primitives), with their tapers, shears and bevels, in a single flat
grey material, plus the node tree, the anchors and the `MountProxy` collection. Pose the legs. Then run the
silhouette checkpoint:

1. Render the four orthographic silhouettes (section 11, set S) and the two perspective views.
2. Run the measurable tests of section 12 marked **(B)** by script (bounding boxes and vertex queries; return a dict).
3. Look for these specific blockout faults and fix them before going on:
   - the hull reads as a cube: the keystone taper or the forward shear is missing or reversed;
   - the pauldrons read as crates: batter, forward rake or cap overhang missing;
   - the cathedral reads as a lump: fewer than five skyline levels, towers the same height, spire not dominant;
   - the legs read as sticks or are thinner at the ankle than the knee;
   - the head is not visible from the front or does not project ahead of the canopy;
   - any body part intrudes into a `MountProxy` volume;
   - the lance and the gatling look alike in side silhouette.
4. Record the test table. Only when every (B) test passes, continue to stage 2 (all remaining parts, materials,
   AO bake).

## 11. Fixed render and bake settings

- **Plate jitter:** +-6%. In `Part._emit` use `jit = 0.94 + 0.12 * ((self.n * 0.6180339) % 1.0)`.
- **AO bake:** Cycles, CPU, 48 samples, vertex-colour target, as `bake_ao` in `build_scout.py`, with an **AO floor of
  0.55**: `v = jit * (0.55 + 0.45 * ao)`. World AO distance 14 m. Bake with the whole engine assembled in the rest
  pose and `MountProxy` hidden. Result goes in the single colour attribute `Color` (exported as `COLOR_0`).
  Glow slots are not baked.
- **Stage and lights:** `make_stage` from `build_hierarch.py` unchanged (three suns, grey ground, Standard view
  transform, denoise), resolution 1400 x 1000, lens 60 mm, 48 samples.
- **Cameras** (`shot(path, az, el, dist, tgt)`, target Blender (0, 0, 60)):

| name | az | el | dist | projection |
|---|---|---|---|---|
| `front` | 0 | 0.05 | 430 | perspective |
| `front34` | 0.6 | 0.12 | 430 | perspective |
| `side` | pi/2 | 0.05 | 430 | perspective |
| `rear34` | 2.6 | 0.15 | 430 | perspective |
| `pilot` | pi | 0.42 | 270 | perspective (the in-game piloting view: above and behind) |
| `tiers` | 0.5 | 0.1 | 520 | perspective, with `hierarch.glb` imported 70 m to the engine's right for scale |
| set S: `sil_front`, `sil_side`, `sil_rear`, `sil_top` | 0, pi/2, pi, top | 0 | - | orthographic, ortho scale 150, flat black override on a white world |

- **Review renders are made with every glow slot black** (emission strength 0, base colour black on `glow`,
  `glow_hot`, `glow_charge`), so the form has to read without lights. One extra `front34_lit` and `rear34_lit`
  with `glow` and `glow_hot` lit (and `glow_charge` still black) checks the windows and the furnace.
- Renders go to `model/renders/colossus_<name>.png`.
- **Export:** as `export_glb` in `build_scout.py` (`export_yup`, no UVs, normals, materials, active vertex colour,
  no animation), selection = the engine collection only. In the exported file `glow_charge` is authored lit, as in
  the Hierarch; the game blacks it at rest.

## 12. Measurable tests

Compute by script where possible; all values are world metres in the rest pose at scale 1. **(B)** = also run at
the blockout checkpoint.

**Front view**

| # | test | pass |
|---|---|---|
| F1 (B) | overall width | 70 .. 73.5 |
| F2 (B) | spire apex / mast tip height | 118 .. 120 / 124 .. 126 |
| F3 (B) | skyline levels, each at least 4 m above the next: mast 125, spire 119, crossing pinnacles 114, west spires 107.5, nave ridge 96, great stacks 95, pauldron pinnacles 89, battery 85, deck 79.5 | at least 7 distinct levels present |
| F4 (B) | waist (ring, 21 wide) to shoulder width ratio | 0.33 or less |
| F5 (B) | leg width: thigh at the cuisse, shin at the greave | each 11.5 or more |
| F6 (B) | clear gap between the knee guards | 10 .. 14 |
| F7 | lit lancets visible from the front (chest 6, west window 3, west towers 2, belfry 2) | 13, none hidden by another body part |
| F8 (B) | visor centre height; it lies below the canopy underside (75) and above the breastwork top (63) | 70.5 .. 72 |

**Side view**

| # | test | pass |
|---|---|---|
| S1 (B) | foremost point of the head ahead of the hip axis | 20 .. 22.5, and at least 0.8 ahead of the canopy lip |
| S2 (B) | knee axis ahead of the hip axis; knee spirelet tip is the foremost point of the leg above the foot | 15.5 .. 17.5 |
| S3 (B) | hull front face: top edge ahead of bottom edge | 2.5 or more |
| S4 (B) | pauldron front face: top edge ahead of bottom edge; rear face top ahead of bottom | 1.2 or more; 2.0 or more |
| S5 (B) | great spire axis behind the hip axis; jaw to spire axis | 8 .. 10; 29 or more |
| S6 (B) | body depth without arms | rear -22 or more, front +22.5 or less |
| S7 (B) | gatling barrel tip / lance prong tip ahead of the hip axis | 46.5 .. 48.5 / 51.5 .. 53.5 |
| S8 (B) | thigh and shin thickness front to back (armour to hydraulics) | each 13 or more |
| S9 (B) | foot length; ankle wider than the shin at the knee | 33 .. 35; yes |

**Rear and top**

| # | test | pass |
|---|---|---|
| R1 | four hot bays visible from directly behind, total lit area | 130 m2 or more, nothing in front of them |
| R2 (B) | spine column (x +-5.5, y 69.6..91, z -20..-14.4) empty except the centre rib below y 74 | empty |
| R3 (B) | every `MountProxy` volume free of body geometry (flak rings and sweeps, turret sweeps, knee pads) | no intersection |
| R4 (B) | top view: the cathedral plan is a cross (transept tips at x +-9 behind the nave) with the towers at the west end | yes |
| R5 (B) | stance width outside the feet | 42 .. 45 |

**Surface and budget**

| # | test | pass |
|---|---|---|
| Q1 | largest exposed flat `trim` face | 40 m2 or less |
| Q2 | boxes over 8 m with no taper, shear, rake or exemption (rule 1) | none |
| Q3 | exposed flat faces over 160 m2 without a section 8 detail | none |
| Q4 | material slots used | only the ten in section 5 |
| Q5 | triangles, whole engine with both legs, no mounts | 6,300 .. 7,300 expected; hard limit 9,000 |
| Q6 | node and anchor names, parents and pivots | exactly sections 4.2 and 4.3 (compare numerically, tolerance 0.01) |
| Q7 | thigh, shin, foot symmetric about local x = 0; `*_R` share the `*_L` mesh data | yes |
| Q8 | `tiers` render: the colossus reads as the grander original of the Hierarch (more tiers, twin towers, buttresses), not a scaled copy | builder states yes/no with one sentence of evidence |

The spare budget (about 2,000 tris) is not to be spent. It is reserved for a later design pass.

## 13. Mandatory builder self-review loop (once, before handoff)

1. Finish stage 2. Bake AO. Render the full set of section 11 with glow slots black, plus the two lit views.
2. Fill in the section 12 table with measured values and pass/fail. Read every render (open the image) and write,
   per view, the faults seen, checking at least this list:
   - boxiness: any mass that still reads as a plain crate;
   - flat, featureless area larger than a pauldron face;
   - z-fighting or coplanar faces (plates must stand 0.25 m or more proud);
   - floating or sunk details on raked faces;
   - windows hidden, clipped by roofs, or smaller than they should read at the `tiers` distance;
   - AO too dark (crushed black under the deck or between the legs) or absent;
   - the five damage zones not distinguishable in `front34` and `rear34`;
   - anything inside a mount keep-clear volume.
3. **Fix every fault listed, once**, within this spec (correct the part to its listed values, or adjust a position
   by at most 1 m / a taper by at most 0.1 where the listed value itself causes the fault). Do not add parts.
4. Re-bake, re-render the affected views, re-run the tests.
5. Hand off: the `.blend` saved through MCP, the `.glb`, the renders, the final test table, the list of faults found
   and fixed, and any fault still open with the reason. A result is a candidate for human review, not an approval.

## 14. Risky spots (check these in the renders)

| # | where | risk | built-in answer |
|---|---|---|---|
| 1 | west towers vs `flak_2/3` | tower face x 12, flak ring edge x 12.7 | 0.7 m clear; do not widen the towers |
| 2 | flyers over the transept roofs | a flyer passes about 0.5 m above the roof slope | accepted if it grazes; do not lower the piers |
| 3 | missile spine vs great tower | the slab fronts reach z -13.3 and bite 0.7 m into the tower's rear wall below y 90 | intended (bolted on); the rear belfry lights start at y 96 and stay clear |
| 4 | `flak_1` vs the west window | hides the lower third of the centre light from low front views | accepted (as hardpoints risk 6) |
| 5 | brow finials vs `flak_1` | tips at y 83, 10.25 m from the pivot | below and beyond the barrel sweep; do not raise them |
| 6 | arm rear vs pauldron | at full pitch the hopper rotates up into the pauldron underside | hidden inside the pauldron; accepted, as in the current model |
| 7 | drooped arm vs knee | a destroyed arm droops 1.05 rad; barrel tips reach world y 22 at x 23.4..32.6 | knee guard outer edge is x 19; 4 m clear |
| 8 | tassets vs thighs | tasset inner face x 19, thigh outer face x 17.5..18.7 | check at full stride in game |
| 9 | reactor seal depth | rearmost point z -21.6 | this is the +5% depth limit; nothing may go further back |
| 10 | head lamps vs jamb columns | lens edge x 5.2, column inner edge x 5.2 | touching is acceptable; do not move the columns inboard |

## 15. Dimensions summary (world, scale 1, rest pose)

| measure | value |
|---|---|
| mast tip / great spire apex | 125 / 119 |
| crossing pinnacles / west spires | 114.2 / 107.5 |
| nave ridge / great stacks | 96 / 95 |
| pauldron pinnacles / battery housings | 89 / 85 |
| deck top / pauldron caps / brow pad | 79.5 / 79 / 77 |
| visor / arm pivots / reactor centre | 71.2 / 62 / 63 |
| waist pivot / hips / knees | 50 / 45 / 26.3 |
| width: arm shields / pauldrons / deck / stance | 72.3 / 71.2 / 45 / 43.6 |
| depth: reactor seal to jaw | -21.6 .. +21.7 |
| reach: gatling / lance | +47.5 / +52.5 |

## 16. Silhouette sketches

Front view (the viewer faces the engine, so its left arm, the gatling, is on the viewer's right). One column is
about 1.5 m, one row about 5 m.

```
 m                              |
125                            -+-  mast
119                             ^
114                           ^/ \^          great spire, four pinnacles
107                    ^     |[] []|     ^    west spires / belfry
100                   / \    |[] []|    / \
 96             ||    |.|  __/^^^^^\__  |.|    ||     nave ridge, great stacks
 90        ^    ||  ^ | | /  roof    \ | | ^  ||    ^
 85      __|____||_/|\|#|/|# # # # #|\|#|/|\_||____|__     battery housings, piers, clerestory
 80     |n n n n|=========[ flak pad ]=========|n n n n|   deck 79.5, merlons, caps
 75     | |[]|  |  |##|##|  _______  |##|##|  |  |[]| |    pauldrons: boss, lit lozenge
 70     | |<>|  |  |##|##| [=visor=] |##|##|  |  |<>| |    chest windows, head in the portal
 65     |_|__|__|  |__|__|_[|||||||]_|__|__|  |__|__|_|
 62     (O)=====\    \   [ casket <> ]   /    /=====(O)    arm trunnions, breastwork
 58   |<>|LANCE  |    \_____===light===_/    |GATLING|<>|   kite shields
 54   |__|______|        \___waist___/       |_______|__|
 50      (flasks)      .__|=========|__.        (drum)
 45                 (O)|   frieze    |(O)                  hips, tassets
 40                 |  |___|=====|___|  |
 35                /cuisse\ | t |/cuisse\
 30               / [<>]   \| a |   [<>] \
 26              [knee^]    | b |    [^knee]               knee guards, spirelets
 20               |greave|  |<>|  |greave|
 14               |      |  |__|  |      |
  8               |skirt |        | skirt|
  5              (ankle  )        (  ankle)
  0          ___[_plinth__]___  ___[__plinth_]___
       x: -36   -28   -14      0      +14   +28   +36
          (its right: lance)            (its left: gatling)
```

Side view from the engine's left (forward is to the right; the gatling arm is nearest the viewer).

```
 m                 |
125               -+-
119                ^
114              ^/ \^
107              |[ ]|              ^          west spire
100              |[ ]|             / \
 96      ||   ___|___|____________ |.|          nave ridge 96
 90      ||  /pier\ transept  roof\|.|   ^
 85      ||_/__|___|[]__|#_#_#_|__|__|___|_==========>   battery barrel
 80   ___||______________deck 79.5___________|_.________   merlons, flak pad
 75  | ^ |  .----------------------------.   /canopy /
 70  |rib|  |   PAULDRON  (raked fwd)     \ [=head==]>     jaw ahead of the canopy lip
 65  |hot|  |  | [] | [] | [] |            \ |window|
 62  |hot|  '--(O)-------------------------'-[casket]
 58  |rib|   [hopper][==GATLING HOUSING==][#]====================>>   barrels to z +47.5
 54  |___|          (drum)       \breastwork_/
 50        \_______waist________/
 45          [tasset](O)pelvis
 40            |tab|  \
 35            |ard|   \ cuisse
 30            |   |    \
 26            |___|     [knee^>          knee 16.5 m ahead of the hip
 20                      / greave
 14                    /  (battery pad)
  8                  /
  5              (ankle)
  0         [heel|___plinth___|toes]
     z:  -21  -15   -9    0    +9   +16.5  +21         +47.5
         furnace  spire  hip  nave  knee   jaw          gatling
```

## 17. Notes for integration (no code is changed by this spec)

- Node set for the loader: `colossus, pelvis, torso, head, arm_L, barrels_L, arm_R, lance_glow, anchor_gatling,
  anchor_lance, anchor_battery, anchor_head, anchor_reactor, anchor_shield, anchor_stack_L, anchor_stack_R,
  thigh_L, shin_L, foot_L, thigh_R, shin_R, foot_R`.
- Field mapping: `body` = `pelvis`, `torso`, `armL` = `arm_L`, `barrels` = `barrels_L` (already at arm y -4),
  `armR` = `arm_R`, `mzL/mzR/mzTop/head` = the four anchors of section 4.3. The legs go through `makeParts`.
- The hardpoint mounts in `heavy.js` keep their existing offsets; every pad is at its old position.
- `lance_glow` is optional for the game: ramp its material with the lance charge, or leave it black.

## Model notes (Colossus asset, as built in Blender)

Files: `model/colossus.glb` (495 kB, 22 nodes, same export settings as the Hierarch: `export_yup`, no UVs, normals, materials, active
vertex colour `COLOR_0`, no animation, `glow_charge` authored lit), `model/colossus.blend` (scene `Colossus`: collections `Colossus`
(engine, exported), `MountProxy` (never exported), `Stage`), source `model/build_colossus.py` (self-contained: carries the
`build_scout.py`/`build_hierarch.py` Part helper family plus `lancet`, the part functions, `build_proxies`, stage/bake/render/export and
`run_tests`; run through the Blender MCP session with `exec(open(path).read(), globals())` then `build_colossus(blockout=False)`).
Renders in `model/renders/`: `colossus_front34.png`, `colossus_front.png`, `colossus_side_left.png`, `colossus_rear34.png`,
`colossus_high.png` (the `pilot` camera), `colossus_tiers.png` (Kestrel, Harrow, Hierarch GLBs to the engine's right), the two lit
views `colossus_front34_lit.png`, `colossus_rear34_lit.png`, and the blockout checkpoint `colossus_blockout_*.png`. All review
renders have the three glow slots black; the two `_lit` views light `glow` and `glow_hot`.

**Triangles.** 7,096 for the whole engine with both legs after the visual-gate pass (6,856 before; Q5 band 6,300 .. 7,300); 6,130 unique (legs share one mesh per segment).
None of the 2,000-tri reserve was spent.

**Size (measured).** Mast tip 125.0, spire apex 119.0, overall width 72.3 (arm shields), stance 43.6, depth -21.6 .. +21.85,
gatling muzzle +47.5, lance prong +52.5, foot 34.0 long.

**Nodes and rest pivots** (world, read back from Blender; max error 0.0075 m, knee rounding only).
| node | parent | pivot in parent | world pivot |
|---|---|---|---|
| `colossus` | - | 0, 0, 0 | 0, 0, 0 |
| `pelvis` | colossus | 0, 45, 0 | 0, 45, 0 |
| `torso` | pelvis | 0, 5, 0 | 0, 50, 0 |
| `head` | torso | 0, 20, 13 | 0, 70, 13 |
| `arm_L` / `arm_R` | torso | +-28, 12, 3 | +-28, 62, 3 |
| `barrels_L` | arm_L | 0, -4, 0 | 28, 58, 3 |
| `lance_glow` | arm_R | 0, 0, 0 | -28, 62, 3 |
| `thigh_L/R` | colossus | hip | +-11.48, 45, 0 |
| `shin_L/R` | colossus | knee | +-12.66, 26.30, 16.55 (IK solved 12.658, 26.295, 16.545) |
| `foot_L/R` | colossus | ground contact | +-14, 0, 0 |

Rotation and scale are identity except the six leg nodes (IK rest pose via `look_basis`). `*_R` legs are linked duplicates of the `*_L` mesh data.

**Anchors** (empties, world at rest, parent): `anchor_gatling` 28, 58, 49 (arm_L) Â· `anchor_lance` -28, 58, 53 (arm_R) Â·
`anchor_battery` 27.5, 83, 18 (torso) Â· `anchor_head` 0, 73, 21 (head) Â· `anchor_reactor` 0, 62, -20 (torso) Â· `anchor_shield` 0, 68, 0
(torso) Â· `anchor_stack_L/R` +-16.5, 95.5, -11.5 (torso).

**Livery slots.** All ten of section 5 (`hull, hull2, dark, trim, bone, soot, tank, glow, glow_hot, glow_charge`) are in every mesh's slot
list and all ten are used by faces. `glow_hot` only on the four furnace bays, `hull2` only on knee guards and arm top panels,
`glow_charge` only on `lance_glow`, `trim` only as bands, pilasters, collars, finials and spires. Vigil colours are the material
defaults; Synod swaps by slot in the game.

**Section 12 results** (script `run_tests`, final build; world metres).
| # | result | measured |
|---|---|---|
| F1 | PASS | width 72.3 |
| F2 | PASS | spire 119.0, mast 125.0 |
| F3 | PASS | 8 levels at least 4 m apart: mast 125, spire 119, crossing pinnacles 114.2, west spires 107.5, nave ridge 95.9 (stacks 95.0 are the same level), pauldron pinnacles 89.0, battery 85.0, deck 79.8 |
| F4 | PASS | 21 / 72.3 = 0.29 |
| F5 | PASS | cuisse hull 11.81, greave 13.0 |
| F6 | PASS | knee guard gap 13.31 |
| F7 | PASS | 13 of 13 lit lancets hit by front rays, none hidden (chest 6, west window 3, west towers 2, belfry 2) |
| F8 | PASS | visor centre y 71.2 |
| S1 | PASS | head front +21.65, canopy lip +20.6, 1.05 ahead |
| S2 | PASS | knee axis z 16.54; knee spirelet tip z 25.95 is the foremost point of the leg above the foot (25.96 incl. bevel) |
| S3 | PASS | hull front rake 3.0 (front face extrapolated through the bevel) |
| S4 | PASS | pauldron front 1.26, rear 2.34 |
| S5 | PASS | spire axis 9.0 behind the hip axis, jaw to spire 30.65 |
| S6 | PASS | rear -21.6, front +21.85 |
| S7 | PASS | gatling +47.5, lance prong +52.5 |
| S8 | PASS | thigh 15.9, shin 14.85 |
| S9 | PASS | foot 34.0; ankle drum 11.5 wide vs shin core 8.5 at the knee |
| R1 | PASS | 133.2 m2 of 153.6 m2 visible from behind (40 x 40 ray grid per bay; a 14 x 14 grid under-read it at 127.9) |
| R2 | PASS | spine column empty (deviations 1, 2) |
| R3 | PASS | no body sample inside any proxy volume (deviation 3); the flak_2/3 domes hold only the battery housing and barrel, which the spec fixes (347 / 356 surface samples, exempt) |
| R4 | PASS | transept tips x +-9.52 behind the nave (half width 7), towers at the west end |
| R5 | PASS | stance 43.6 |
| Q1 | PASS | largest exposed flat trim face 34.7 m2 (cornice band rear face) |
| Q2 | PASS | none after the self-review fix |
| Q3 | PASS (judged) | the largest flat faces (deck top, hull flanks, pauldron faces, pelvis core) carry their section 8 detail; confirmed by reading the renders |
| Q4 | PASS | only the ten section 5 slots |
| Q5 | PASS | 7,096 (after the visual-gate pass) |
| Q6 | PASS | 22 nodes, parents and pivots within 0.01 of 4.2 / 4.3 |
| Q7 | PASS | thigh, shin, foot symmetric about local x; `_R` share `_L` mesh data |
| Q8 | YES | in `colossus_tiers.png` the Colossus has twin west towers, a crossing tower with four pinnacles and a great spire, flying buttresses and stacks where the Hierarch has one chapel, plus a different hull and arm design, so it reads as the grander original, not a scaled copy |

**Blockout checkpoint (section 10).** Built only the [B] primitives (about 75) in one grey material (render override), with nodes, anchors
and `MountProxy`. Every (B) test that depends only on [B] parts passed (F1-F6, S2-S6, S9, R2-R5). F8, S1 (needs the canopy lip band), S7
(lance prongs) and S8 (cuisse inset, hydraulics) depend on non-[B] primitives and passed in stage 2. Blockout fault list, read from
`colossus_blockout_front34.png`, `_side.png` and the silhouettes: keystone taper and forward shear visible, pauldrons battered and raked,
at least seven skyline levels, legs wider at the ankle, gatling and lance differ in side silhouette, head projects ahead of the canopy.
Only fault found: the furnace housing top (y 21) intruded the spine column (deviation 1).

**Self-review loop (section 13), faults found and fixed.**
1. Furnace housing top at torso y 21 stood inside the spine column (starts y 19.55). Fixed at blockout: housing 15.5 tall at y 11.75 (was 16 at 13), top 19.5.
2. Q2: the three upright cage ribs (2.4 x 22 x 2.6) and the arm_L barrel bearing block (10.5 x 10.5 x 3) were untapered boxes over 8 m. Fixed: tx 0.92 on both.
3. R3 kneebat keep-clear: my first box height let the outer toe-cap corner inside; box reduced to shin-local y 8.5 .. 13.

Nothing else found when reading the five main views, the two lit views and the tiers render: no crushed AO, no coplanar flicker, windows
readable at the tiers distance, the five damage zones separable (head portal with bars and visor; gatling and lance arms; furnace cage
with bone seal in `rear34`; plinth feet with hull2 knee guards).
Open, cosmetic, not a spec fault: AO is soft on the slate so the hull flanks read slightly flat in `front`; the rear bone tabard is a pale
8 x 20 panel between the legs that is the brightest thing on the back (as specified).

**Deviations from the spec, with reasons.**
1. Furnace housing shortened 0.5 m and moved down 1.25 m. Reason: spec 4.4 / R2 need an empty spine column from y 19.55 while 6.2 builds the housing to y 21. Bays (y 7.5..18.5) and ribs unchanged. This exceeds the 1 m adjustment rule by 0.5 m because the spec's two numbers conflict.
2. R2 and the `spine_column` proxy ignore the deck's rear sliver (z -15.05 .. -14) and the centre rib below y 74. Reason: spec 4.4 puts the deck rear face at z -15 with the keel bolted into it, which overlaps the column's z -14.4 limit; the centre rib is the stated exemption.
3. R3 is evaluated analytically on 0.9 m surface samples: rings and spine as cylinders and a box; flak and turret keep-clear as the spec's spheres cut at y 33 / 37 (torso) with sector limits (flak_1 yaw +-100; flak_2/3 yaw -20..220, mirrored for flak_3); kneebat as a shin-local box x +-7, z 9..17, y 8.5..13 (the spec gives no upper bound). The battery housing, cradle and barrels are excluded from the flak_2/3 domes because the spec fixes them and counts them in its arithmetic.
4. `lancet` is centred on the wall plane (0.5 thick, 0.25 m proud), 16 tris each.
5. `pyr` is a 4-sided cone with a 0.02 m tip and no top cap (10 tris), as the spec counts it.
6. Silhouette set S used ortho scale 150 as specified, which clips the top of the mast at 1400 x 1000 (the frame is 107 m tall). The blockout silhouettes in `renders/` are cropped at the spire; not re-framed.
7. Stage helper names are prefixed `CC_` (camera, lights, ground, world) to avoid collisions in a shared Blender session; stage values are the Hierarch's.
8. 0.0075 m rounding difference at the knee pivot (IK gives 12.658, 26.295, 16.545; spec table 12.66, 26.30, 16.55).
9. `tiers` camera targets (-55, 0, 55) instead of (0, 0, 60) so all four engines fit; Hierarch at x -70, Harrow -112, Kestrel -146 (Blender -X is the engine's right).

**Known limits.** Not loaded in three.js. No damage-state meshes. `glow_charge` is authored lit in the GLB (the game blacks it at rest).
`MountProxy` is in the `.blend` only (hidden from render).

**Visual-gate correction pass (coordinator verdict: pass with one correction; the spec was designed from the front, the pilot camera sits behind and above).**
Applied: pauldron cap slabs and furnace housing moved from `dark` to `hull` (ribs, transoms, shoes stay dark); pauldron rear boss (bone plate, tank lozenge, glow core, rx .18 on the first two) mirrored from the front; bone cap-top plate 6 x 0.5 x 3 at (+-26.5, 29.25, -9.6); furnace housing flank plates (bone 0.6 x 8 x 5, rz +-.116, with a tank lozenge); three trim louvres on the rear face of the arm_L hopper and the arm_R capacitor; bone deck rear-edge plates 6.5 x 0.5 x 1.6 at (+-9.3, 29.6, -13.9); the mast yard and gable finial bar replaced by 1.6 x 1.6 x 0.5 trim diamonds (no Latin crosses). +240 tris. No pivot, anchor or mount pad changed.
Re-run after the pass (all PASS): R1 133.2 m2, R2 empty, R3 clean (battery exemption unchanged), Q1 34.7 m2, Q4 ten slots only, Q5 7,096, S6 rear -21.6 / front +21.85 (nothing behind z -21.6); the rest of the table is unchanged (F2 119.0 / 125.0, F7 13 of 13). AO re-baked, GLB re-exported, `.blend` saved, `high`, `rear34`, `side_left` and `front34` re-rendered.
Read of the views: `high` now has lit-material interest on the pauldron caps (hull slate with bone rear plates and the cap-top plates), pauldron rear lozenges and arm louvres, and the deck rear edge plates break the flat back; the furnace housing still reads dark in `high` and `rear34` because the deck shades it in the AO bake, so the cage is carried by the ribs, finials and bone flank plates. `side_left` shows the rear boss and flank plate; the pale rear tabard is still a thin line edge-on. `front34` shows diamonds instead of crosses on the nave and mast.
