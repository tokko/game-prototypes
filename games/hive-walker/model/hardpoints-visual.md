# Hardpoints and command overlays: visual build spec

Companion to `model/loadouts-command-spec.md` (gameplay). This file is the complete visual build for the new secondary
mounts, their effects, and the command overlays (arm-lock brackets, fire-zone rings, tactical map). Original design;
nothing here is taken from any existing franchise.

**Amendment (user, after the loadouts spec was written): the Kestrel gets NO quad flak.** Its AA rack stays its only
anti-air. There is no Kestrel geometry in this file. Flak exists on the Harrow (1), Hierarch (2) and Colossus (3) only.

## 1. Conventions

- Axes as every walker: **x = the walker's left, y = up, z = forward**, metres. All coordinates are local to the named
  parent node.
- `Builder` signatures (unchanged): `box(w, h, d, x, y, z, color, rx, ry, rz)`,
  `cyl(rTop, rBottom, h, x, y, z, color, rx, ry, rz, seg = 8)`. A rotation turns the primitive about its own centre before
  it is moved. `hp = Math.PI / 2`, `q = Math.PI / 4`. Triangle cost: box 12, cyl 4 x seg.
- Barrels are **boxes with `rz = q`** (diamond section, 12 tris). This is deliberate: it is cheap and reads as a gothic
  square-forged barrel. Do not swap them for cylinders (budget).
- `rotation.y = +a` turns a part's +z toward +x (the walker's left). `rotation.x = -pitch` raises a +z barrel by `pitch`.

### 1.1 Mount anatomy and node names

Every mount is a `THREE.Group` named `<id>`, added to an existing rig node at the offset and rotation in the class
tables. Two kinds:

| kind | children | used by |
|---|---|---|
| **turret** | `<id>_yaw` (Group, `rotation.y`) holds the yaw mesh; its child `<id>_pitch` (Group, `rotation.x = -pitch`) holds the pitch mesh and the muzzle anchor(s) `<id>_mz` | quad flak, twin-autocannon turret |
| **ball** | optional static base mesh directly on `<id>`; `<id>_gun` (Group, `rotation.order = 'YXZ'`, `rotation.y = yaw`, `rotation.x = -pitch`) holds the gun mesh and `<id>_mz` | hull autogun, heavy bolter, knee gun, knee battery |
| **fixed** | static meshes on `<id>`, anchors only | missile spine |

One merged geometry per mesh, built once per class per side and shared by all instances (as `shared.parts` in
`colossus.js`). Mounts carry no glow meshes except the missile spine.

**Aim solve (all mounts, so a tilted parent such as a shin is handled for free).** Each target-pick tick, with `P` = the
node that owns the yaw (`<id>` itself): `v = P.worldToLocal(targetWorld)` minus the yaw pivot's local position;
`yaw = atan2(v.x, v.z)`, `pitch = atan2(v.y, hypot(v.x, v.z))`. Clamp both to the mount's arc, then slew the nodes toward
them at the mount's slew rate every frame. A mount may fire only when the unclamped solution is inside the arc and the
node is within 0.08 rad of it. **Yaw is stored unwrapped inside `[yawMin, yawMax]`** (arcs wider than 180 degrees have a
dead zone; the gun must go the long way round, never through it). With no target, slew back to the rest pose.

Arcs below are in the mount parent's frame, 0 = the parent's +z, positive toward +x. Right-side mounts are listed with
their own (mirrored) numbers; do not mirror by negative scale.

### 1.2 Colours (livery slots per faction)

| var | slot | Vigil (side 0) | Synod (side 1) | used for on mounts |
|---|---|---|---|---|
| `H` | hull | 0x46525e slate | 0x5a211a oxblood | trunnion cheeks, turret housings, sponsons |
| `H2` | hull2 (Colossus: `bone`) | 0x9a947e bone | 0x17130f black (Colossus: 0x3a3028) | gun shields: the faction read from the front |
| `D` | dark | 0x1d2228 | 0x191414 | pedestals, breeches, balls, spine slabs |
| `T` | trim | 0x9a7a3a brass | 0x6c7434 olive | caps, collar plates, spine ridge |
| `S` | soot / gunmetal | 0x0b0a09 (Colossus 0x121212) | same | every barrel |
| `hot` | glow_hot | [2.2, 0.3, 0.1] | same | missile cells only |

- **Harrow:** resolve through `col(k)` in `harrow.js buildParts` (LIVERY x 1.3 arrays); material `shared.mat`.
- **Hierarch:** the same LIVERY x 1.3 arrays; material = the walker `MAT` (export `MAT` from `js/walker.js` and reuse it,
  so the Builder parts get the same emissive lift as the GLB). They have no baked AO; that is accepted.
- **Colossus:** `PAL[side]` hex values directly, as `colossus.js buildParts` does (`H2 = C.bone`, `S = 0x121212`);
  material `shared.mat`; glow on `shared.glow`. Mounts inherit the root scale `s` (and the per-segment leg scale) by
  parenting; do not scale them again.

## 2. Shared kit geometry

### 2.1 Quad flak (turret, 120 tris, 2 draw calls)

Authored at unit size; **after `build()` call `geo.scale(k, k, k)`** and multiply the node offsets below by `k`.
`k`: Harrow 0.9, Hierarch 1.0 (shoulder) and 0.9 (tail), Colossus 1.5.

```js
// flakYaw: origin on the deck surface at the ring centre (48 tris)
fy.cyl(2.4, 2.8, 1.1, 0, 0.55, 0, D, 0, 0, 0, 6)         // flared pedestal ring, y 0..1.1
  .box(0.6, 2.6, 2.2, 1.7, 2.3, 0, H)                    // trunnion cheeks, y 1.0..3.6
  .box(0.6, 2.6, 2.2, -1.7, 2.3, 0, H);
// flakPitch: origin on the trunnion axis; barrels along +z (72 tris)
fp.box(2.6, 1.6, 2.2, 0, 0, 0.1, D)                      // breech block
  .box(2.7, 2.8, 0.3, 0, 0.5, 1.5, H2, -0.2);            // raked gun shield (barrels pass through it)
for (const x of [-0.62, 0.62]) for (const y of [-0.45, 0.45]) fp.box(0.42, 0.42, 5.6, x, y, 4.0, S, 0, 0, q);   // 2 x 2 barrels, z 1.2..6.8
```

| node | parent | local position (x k) |
|---|---|---|
| `<id>_yaw` | `<id>` | 0, 0, 0 |
| `<id>_pitch` | `<id>_yaw` | 0, 2.6, 0 |
| `<id>_mz` | `<id>_pitch` | 0, 0, 7.0 (per-barrel tracer origins: +-0.62, +-0.45, 6.9; cycle through the four) |

Pitch range **0.25 to 1.45** (flak never depresses; the 0.25 floor is what keeps the barrels above deck furniture).
Rest pose: arc centre, pitch 0.6. Slew 2.5 rad/s. Recoil: `<id>_pitch.position.z -= 0.35 k` per drawn shot, damp home
at rate 14. Overall size: 5.6 k wide, trunnion 2.6 k above the deck, barrels reach 6.8 k from the pivot.

### 2.2 Everything else

Class-specific; see the class sections. No other geometry is shared between classes.

## 3. Harrow (204 tris, 4 draw calls)

| id | kind | parent | mount position | mount rotation | arc (yaw) | pitch | rest |
|---|---|---|---|---|---|---|---|
| `flak_1` | turret, k 0.9 | `rig.torso` | 15.5, 19.5, -1.0 | none | free 360 (may wrap) | 0.25..1.45 | yaw 0, pitch 0.6 |
| `autogun` | ball | `rig.torso` | 0, 12.34, 13.3 | `rotation.x = 0.4` | -90..+90 deg | -0.4..+0.35 | yaw 0, pitch 0 |

**`flak_1`** stands on the trim cap of the left great pauldron (cap top is torso y 19.5), slightly aft of centre so the
resting barrels stay over the pauldron. It becomes the highest point of the engine (shield top about world y 45.5,
was 43) and exaggerates the existing left-heavy asymmetry. The pauldron belongs to the torso, so the fist arm swings
beneath it untouched.

**`autogun`** is a pintle gun on top of the hood slab over the head. The mount inherits the hood's 0.4 rad forward dip,
so at rest it looks about 23 degrees down the street in front of the engine. Carapace tier 1 rises directly behind it,
which is why the arc is exactly the forward 180 degrees.

```js
// autogun base, static mesh on the `autogun` group (24 tris). Mount frame: y = hood normal, z = down the hood
ab.box(3.6, 0.8, 3.6, 0, 0.4, 0, D)                      // bolted foot plate on the hood
  .box(1.4, 1.4, 1.4, 0, 1.3, 0, T);                     // pintle post
// autogun gun, on `autogun_gun` at mount-local (0, 2.2, 0) (60 tris)
ag.box(1.6, 1.6, 3.6, 0, 0, -0.2, H)                     // receiver, z -2.0..1.6
  .box(1.0, 1.0, 2.0, 0, 0, 2.6, D)                      // cooling jacket
  .box(0.6, 0.6, 4.4, 0, 0, 3.6, S, 0, 0, q)             // barrel, z 1.4..5.8
  .box(1.4, 1.6, 1.8, 1.4, -0.2, -0.4, T)                // ammunition box, on the gun's left
  .box(3.6, 2.4, 0.3, 0, 0.2, 1.5, H2, -0.15);           // gun shield
```

`autogun_mz` on `autogun_gun` at (0, 0, 6.0). Slew 3 rad/s. Recoil 0.25 m, rate 16.

Clearances (checked on paper): the gun's rear at yaw +-90 stays 3 m ahead of the tier-1 front face (z 9); the barrel at
yaw +90 reaches x 5.8, the fist arm's nearest part (thumb block) is at x 8.5; the head is fully under the hood.

## 4. Hierarch (468 tris, 13 draw calls)

The Hierarch is a GLB; all of this is Builder geometry parented to the GLB rig nodes (`rig.torso`, and each foot's
`f.shin` from `this.legs.feet`). `side` below is `f.side` (+1 = left leg).

| id | kind | parent | mount position | mount rotation | arc (yaw) | pitch | rest |
|---|---|---|---|---|---|---|---|
| `flak_1` | turret, k 1.0 | `rig.torso` | -13.6, 15.6, 0 | none | -195..+100 deg | 0.25..1.45 | yaw -40, pitch 0.6 |
| `flak_2` | turret, k 0.9 | `rig.torso` | 0, 15.1, -10.7 | none | +80..+280 deg | 0.25..1.45 | yaw 180, pitch 0.6 |
| `bolter_L` | ball | `rig.torso` | 22.4, 11, 0 | none | -45..+225 deg | -0.5..+0.5 | yaw 0 |
| `bolter_R` | ball | `rig.torso` | -22.4, 11, 0 | none | -225..+45 deg | -0.5..+0.5 | yaw 0 |
| `kneegun_L/R` | ball | `f.shin` | 0, 4.0, 6.5 | `rotation.x = -hp` | -100..+100 deg | -0.6..+0.6 | yaw 0, pitch 0 |

- **`flak_1`** sits on the trim cap of the **right** shoulder block, the mirror of the missile pod on the left, so the
  deck silhouette becomes balanced: pod left, flak right. Its dead zone (+100..+165) is the stack at (-9.9, -3.4).
- **`flak_2`** sits on a new tail platform over the reactor housing, pointing aft. Its dead zone is the nave and the
  central spire directly ahead of it. Tail platform, one static mesh on `rig.torso` (12 tris):
  `tp.box(6.4, 1.6, 5.6, 0, 14.3, -10.7, D)` (top at y 15.1, front edge buried in the deck's rear face).
- **Bolters** are stubby twin-barrel balls on a shelf bracket bolted to each shoulder skirt. Static bracket, one mesh
  per side on `rig.torso` (24 tris), `s` = +1 left, -1 right:

```js
bb.box(4.0, 1.0, 2.4, s * 20.6, 9.3, 0, D)               // shelf under the ball, x 18.6..22.6 (buried in the skirt)
  .box(0.6, 4.4, 3.0, s * 19.0, 10.4, 0, T);             // collar plate bolted to the skirt
// bolter gun, on `bolter_X_gun` at the mount origin (48 tris)
bg.box(2.6, 2.6, 2.6, 0, 0, 0, D)                        // ball housing (its bottom sits 0.1 into the shelf)
  .box(2.8, 0.5, 2.8, 0, 1.45, 0, T)                     // cap
  .box(0.7, 0.7, 2.2, 0.55, 0, 2.2, S, 0, 0, q)          // twin barrels, z 1.1..3.3
  .box(0.7, 0.7, 2.2, -0.55, 0, 2.2, S, 0, 0, q);
```

  `bolter_X_mz` at (0, 0, 3.4); alternate tracer origins (+-0.55, 0, 3.3). Slew 3 rad/s. Recoil 0.2 m, rate 18.
  The shelf is **below** the barrels on purpose: the barrels sweep over it through the whole 270 degrees.
- **Knee guns** are single-barrel balls on the front of each greave, just below the knee cop. With
  `rotation.x = -hp` the mount frame is: +z out of the shin's armoured face (the gun's forward), +y up the shin toward
  the knee, +x the walker's left. The shin leans about 28 degrees at rest, so the gun naturally looks 28 degrees down.

```js
// knee gun base, static on the `kneegun_X` group (12 tris)
kb.box(3.0, 2.6, 1.0, 0, 0, 0.5, H);                     // sponson plate on the greave
// knee gun, on `kneegun_X_gun` at mount-local (0, 0, 1.9) (24 tris)
kg.box(2.0, 1.8, 2.0, 0, 0, 0, D)                        // ball (its rear sits 0.1 into the sponson)
  .box(0.6, 0.6, 3.2, 0, 0, 2.4, S, 0, 0, q);            // barrel, z 0.8..4.0
```

  `kneegun_X_mz` at (0, 0, 4.1). Slew 4 rad/s. No recoil.

Budget: flak 240 + tail platform 12 + bolters 2 x 72 + knee guns 2 x 36 = **468**.

## 5. Colossus (760 tris, 16 draw calls)

Parents: `this.torso`, and each foot's `f.shin`.

| id | kind | parent | mount position | mount rotation | arc (yaw) | pitch | rest |
|---|---|---|---|---|---|---|---|
| `flak_1` | turret, k 1.5 | `torso` | 0, 27, 15 | none | -100..+100 deg | 0.25..1.45 | yaw 0, pitch 0.6 |
| `flak_2` | turret, k 1.5 | `torso` | 17, 29.5, 7 | none | -20..+220 deg | 0.25..1.45 | yaw +45, pitch 0.6 |
| `flak_3` | turret, k 1.5 | `torso` | -17, 29.5, 7 | none | -220..+20 deg | 0.25..1.45 | yaw -45, pitch 0.6 |
| `turret_L` | turret | `torso` | 28.5, 35, -2 | none | -80..+220 deg | -0.35..+0.9 | yaw 0, pitch 0 |
| `turret_R` | turret | `torso` | -28.5, 35, -2 | none | -220..+80 deg | -0.35..+0.9 | yaw 0, pitch 0 |
| `spine` | fixed | `torso` | 0, 0, 0 | none | - | - | - |
| `kneebat_L/R` | ball | `f.shin` | 0, 6.9, 13 | `rotation.x = -hp` | -100..+100 deg | -0.6..+0.6 | yaw 0, pitch 0 |

- **`flak_1`** stands on the brow plate above the head (the trim box whose top is torso y 27). **`flak_2/3`** stand on
  the front corners of the carapace deck, between the front towers and the pauldrons. Their inboard dead zones are the
  cathedral.
- **Shoulder turrets** are superfiring tower turrets on tall barbettes standing on the carapace-battery housings (top at
  torso y 35). The barbette lifts the barrels to y 40.8, above the small stacks, and still well below the tower spires
  (53), so the cathedral outline survives and the shoulders gain squared "ears".

```js
// turret yaw mesh: origin on top of the battery housing (56 tris)
ty.cyl(2.8, 3.2, 4, 0, 2, 0, D, 0, 0, 0, 8)              // barbette, y 0..4
  .box(5.6, 3.2, 6.4, 0, 5.6, -0.4, H)                   // gun house, y 4..7.2
  .box(6.0, 0.5, 6.8, 0, 7.45, -0.4, T);                 // roof cap
// turret pitch mesh, on `turret_X_pitch` at yaw-local (0, 5.8, 2.4) (36 tris)
tpm.box(4.4, 2.4, 1.6, 0, 0, 0.6, D)                     // mantlet
  .box(0.9, 0.9, 5.5, 1.2, 0, 4.0, S, 0, 0, q)           // twin barrels, z 1.25..6.75
  .box(0.9, 0.9, 5.5, -1.2, 0, 4.0, S, 0, 0, q);
```

  Muzzles `turret_X_mzA/B` on the pitch node at (+-1.2, 0, 6.9). Slew 1.6 rad/s. Recoil 1.0 m per round on the pitch
  node, damp rate 8 (alternate barrels within the 4-round burst).
- **Missile spine**: four louvred launch slabs climbing the back centreline like vertebrae, on a keel bolted through the
  rear edge of the deck, with a brass ridge that continues the existing centre reactor rib upward and splits each slab
  face into two cells (8 cells). Static, written in torso coordinates.

```js
// spine body (72 tris)
sp.box(6, 20, 3, 0, 29.6, -15.9, D)                      // keel, y 19.6..39.6, front face buried in the deck's rear edge
  .box(1.0, 19, 1.2, 0, 31, -19.3, T);                   // ridge
for (const y of [23.5, 28, 32.5, 37]) sp.box(10, 3.2, 5.5, 0, y, -16.5, D, 0.45);   // slabs, rear faces tilted 26 degrees up
// spine glow, on shared.glow (48 tris)
for (const y of [23.5, 28, 32.5, 37]) sg.box(7.6, 1.8, 0.4, 0, y + 1.24, -19.07, hot, 0.45);
```

  Cell anchors `spine_c0..c7` on `torso`: for i = 0..3 with y_i = 23.5, 28, 32.5, 37: `c(2i)` at (2.6, y_i + 1.25, -19.3),
  `c(2i+1)` at (-2.6, y_i + 1.25, -19.3). Launch order c0..c7 (bottom to top, alternating sides), 0.12 s apart.
  The existing rear reactor glow (y 10.5..15.5) stays fully visible below the spine.
- **Knee batteries**: twin-barrel balls on the front of each greave below the knee guard. Mount frame as the Hierarch
  knee gun; the shin leans about 38 degrees at rest.

```js
// knee battery base, static on the `kneebat_X` group (12 tris)
qb.box(3.6, 4, 1.6, 0, 0, 0.8, H);                       // sponson
// knee battery gun, on `kneebat_X_gun` at mount-local (0, 0, 3.0) (36 tris)
qg.box(3.2, 2.6, 3.2, 0, 0, 0, D)                        // ball (its rear sits 0.2 into the sponson)
  .box(0.7, 0.7, 5, 0.8, 0, 3.6, S, 0, 0, q)             // twin barrels, z 1.1..6.1
  .box(0.7, 0.7, 5, -0.8, 0, 3.6, S, 0, 0, q);
```

  `kneebat_X_mz` at (0, 0, 6.3); alternate origins (+-0.8, 0, 6.2). Slew 4 rad/s. Recoil 0.2 m, rate 18.

Budget: flak 3 x 120 + turrets 2 x 92 + spine 120 + knee batteries 2 x 48 = **760**.

## 6. Risky spots (verify these in a shot before calling it done)

| # | where | risk | built-in mitigation |
|---|---|---|---|
| 1 | Harrow `flak_1` | Barrels turned outboard poke about 4 m through the ward bubble (radius 24). | Accepted: the bubble only shows for a moment on hits. Do not shrink the mount. |
| 2 | Hierarch bolters | At the two arc ends (-45 / +225) the inner barrel passes about 0.3 m from the skirt's collar plate. | Collar plate is only 3.0 deep in z. If it grazes, pull the arc ends in by 5 degrees visually (keep the gameplay arc). |
| 3 | Hierarch `flak_2` | At the arc ends (+-80) the muzzles pass about 0.6 m outside the deck's rear corner and 1 m from the rear stacks. | Pitch floor 0.25 lifts the barrels above the deck top. |
| 4 | Hierarch bolters | Widen the engine from 37.4 m to 47.4 m at rest (51.4 m with both guns trained outboard). | Intended: they must stand off the skirt to sweep 270 degrees. |
| 5 | Colossus turrets | Depressed and trained inboard-rear, a barrel can graze the small stack at (+-20, -6) (stack top y 39.5, barrel underside 40.2 when level). | If visible, clamp pitch to >= 0 while the yaw is inboard of +-100 degrees. |
| 6 | Colossus `flak_1` | Partly hides the centre lancet window of the cathedral from low front views. | Accepted; side windows stay clear. |
| 7 | Colossus `flak_2/3` vs the battery barrel | The battery barrel top is at y 34.5, 9 m outboard of the flak pivot (y 33.4). | Pitch floor 0.25 clears it by 0.3 m. Do not lower the floor. |
| 8 | Knee guns / batteries | At full depression plus the resting shin lean the muzzle passes 0.6 m (Colossus) / 1.8 m (Hierarch) above the toe caps. | Pitch floor -0.6 in the mount frame. Check mid-stride and while limping. |
| 9 | Knee mounts vs tabard | Inboard barrels at yaw 100 reach x 5.4 (Colossus); the tabard edge is x 5.5, 7 m behind. | Clear at rest; check at extreme knee lift. |
| 10 | Colossus `spine` | The lowest slab overlaps the top of the existing centre rib (y 22..24). | Intended (reads as bolted on); faces are not coplanar. |

Nothing is mounted on an arm, so arm pitch, the Harrow fist swing and a drooping destroyed arm cannot touch a mount.
Nothing sits below torso y 2 or behind a knee, which is where the torso twist and knee flex sweep.

**Damage states.** When the engine is not `alive`, freeze every mount and let turrets sag to their pitch floor. When
`legs` is destroyed the knee mounts sag to pitch -0.6 and stop tracking. No wreck meshes.

## 7. Effects (existing `fx` calls only)

`T` = `PAL[side].tracer`, `C` = `PAL[side].glow`, `m` = muzzle world position, `d` = unit fire direction.
`fx.tracer(ax, ay, az, bx, by, bz, speed, len, w, r, g, b, cb)`; `fx.muzzle(m, d, s, r, g, b)`.

| weapon | rounds drawn | tracer (speed, len, w, colour) | muzzle | at the far end |
|---|---|---|---|---|
| quad flak (Harrow, Hierarch) | 8 per second, cycling the four barrels | 520, 14, 0.45, T x 1.2 | `muzzle(m, d, 1.0, T x 1.3)` | airburst puff (below) |
| quad flak (Colossus) | 8 per second | 520, 20, 0.65, T x 1.2 | `muzzle(m, d, 1.6, T x 1.3)` | airburst puff, sizes x 1.4 |
| hull autogun | every round (8/s) | 480, 12, 0.35, T x 1.3 | `muzzle(m, d, 0.8, T x 1.3)` | `impact(x, y, z, 0.6)` |
| heavy bolter | every round (10/s), alternating barrels | 420, 9, 0.6, T x 1.6 (short and fat: reads as a bolt) | `muzzle(m, d, 1.1, T x 1.3)` | `impact(.., 0.9)`; every 3rd round also `explosion(x, y, z, 0.45, { silent: true, noDebris: true })` |
| knee gun (Hierarch) | every 2nd round (6/s) | 380, 7, 0.3, T x 1.1 | `muzzle(m, d, 0.6, T x 1.3)` | `impact(.., 0.5)` on drawn rounds |
| knee battery (Colossus) | every 2nd round (10/s), alternating barrels | 420, 10, 0.45, T x 1.3 | `muzzle(m, d, 0.9, T x 1.3)` | `impact(.., 0.7)` on drawn rounds |
| twin autocannon | all 4 rounds of a burst, 0.12 s apart, alternating barrels | 500, 30, 1.0, T x 1.7 | `muzzle(m, d, 2.0, T x 1.3)`; first round also `flash(m.x, m.y, m.z, C[0], C[1], C[2], 1800, 0.08, 160)` and `G.sfx.boom(camDist, 0.5)` | `explosion(x, y, z, 0.8, { silent: n % 2, noDebris: true })` |
| spine missile | each of 8 | two legs, below; 1.0 wide, colour (3, 1.7, 0.6) | `muzzle(m, d, 2.2, 3, 2, 1)` plus 3 back-blast `smoke` puffs as `Harrow.launch` | `explosion(x, y, z, 1.5)` |

Reading at a glance: knee fire is thin and short, bolter fire is short and fat and pops, autocannon fire is long, bright
and arrives in fours, flak goes up and ends in dark puffs, missiles leave pale trails. All gun tracers are the faction
tracer colour; missiles are the fixed rocket orange.

**Flak airburst puff** at the burst point (the target position plus `rr(-9, 9), rr(-6, 6), rr(-9, 9)`; never below
world y 25, flak never reaches the ground):

```js
fx.fire(x, y, z, 0, 0, 0, 0.09, 3, 7, 3, 2.2, 1.0, 1);                                  // white-orange core, one frame or two
for (let i = 0; i < 3; i++) fx.smoke(x + rr(-1.5, 1.5), y + rr(-1, 1), z + rr(-1.5, 1.5),
  rr(-3, 3), rr(-1, 2), rr(-3, 3), rr(2.2, 3.0), 3, 11, rr(0.04, 0.07), 0.8, 1.5);     // near-black puff that hangs
if (fx.camDist(x, y, z) < 400) fx.sparks(x, y, z, 3, 18);
if (n % 4 === 0) fx.flash(x, y, z, 1, 0.6, 0.25, 900, 0.1, 90);
```

**Spine missile flight.** A straight tracer from the back of the engine would pass through its own hull, so each
missile flies two chained tracers: leg 1 from its cell anchor to an apex at
`torso.localToWorld((+-6, 80, -38))` (sign = the cell's side, plus `rr(-4, 4)` on each axis) at speed 90, len 9;
its callback starts leg 2 from the apex to the target at speed 170, len 12; leg 2's callback does the explosion and
damage. **Trail:** keep the live missiles in a small list (as `salvo`), and each frame, for each, with its current
interpolated position `p`: `if (rnd() < dt * 30) fx.smoke(p.x, p.y, p.z, rr(-1, 1), rr(0, 2), rr(-1, 1), 1.6, 1.2, 5, 0.5, 0.4, 0.8)`
(pale grey, unlike the black flak) and `fx.fire(p.x, p.y, p.z, 0, 0, 0, 0.08, 2, 1, 3, 1.6, 0.5, 1)` (exhaust dot).
The 8 cell faces stay lit (`hot`) at all times; no reload animation.

## 8. Command overlays

House style: the amber HUD (`#ffb648`, Consolas, amber text-shadow) for anything painted over the world; the auspex
green phosphor (`#58c98a` rim, `#a8ffcf` label, `rgba(2,14,8,0.78)` ground) for anything that is a plot. Four group
colours are used everywhere below and nowhere else in the HUD:

| group | key | colour | reason |
|---|---|---|---|
| left arm | 1 | `#ffc93c` gold | - |
| right arm | 2 | `#c59bff` violet | unused elsewhere; cannot be mistaken for ally green, foe red or shield blue |
| carapace weapon | 3 | `#fff0c8` bone white | - |
| secondaries / zones | 4 | zone colour: Vigil `#ffb23c`, Synod `#5cff6a` | the faction glow |

### 8.1 Arm-lock brackets (third person)

- Two DOM elements in `#hud`, `#lockL` and `#lockR`, each four corner pieces (`<i>` with two borders) and a label chip.
- **Position and size.** Project the target's centre; side length = 2.3 x the projected body radius (radius by kind:
  colossus 46, hierarch 30, harrow 24, scout 12, tank 5, squad 8, structure its `radius`), clamped to 36..220 px.
  Each corner arm is 28% of the side, 2 px solid in the arm colour, with `filter: drop-shadow(0 0 1px #000)` and a
  6 px glow in the same colour at 0.5 alpha.
- **Label chip.** A 14 x 14 px filled square in the arm colour with a black `L` or `R` (11 px, bold), outside the
  top-left corner for L and the top-right corner for R, followed by the range, e.g. `L 214 M` (10 px, letter-spacing
  0.2em, arm colour).
- **Both arms on one target.** The R bracket is drawn 6 px inside the L bracket.
- **States.**

| state | look |
|---|---|
| acquiring | starts at 2.2 x size and snaps in over 0.18 s |
| tracking, in arc, line of fire | solid, full alpha |
| firing | corners kick 3 px inward on each shot, decay 0.12 s |
| no line of fire | 50% alpha, steady |
| out of arc or out of range (lock breaking) | dashed corners (6/4), blinking at 4 Hz, chip reads `L 1.4` (seconds left) |
| overridden (that mouse button held) | 35% alpha, chip reads `L OVR` |
| lost / released | flashes white, expands to 1.3 x and fades over 0.25 s |
| target off screen | bracket replaced by a 16 px chevron pinned 28 px inside the screen edge on the target's bearing, with the chip |

- **Auspex.** A 1 px dashed (3/3) line from the centre to the target glyph and a 9 px square bracket round the glyph,
  both in the arm colour. Drawn above units, below threat pings.
- **Readiness bars.** The locked arm's bar text reads `LOCK` and its fill is tinted the arm colour.

### 8.2 Fire-zone ground rings

- **Geometry.** One unit `RingGeometry(0.975, 1, 64)` laid flat (rotate -hp about x), scaled by the radius, at y 0.3:
  the band is 2.5% of the radius wide (0.5 m at 20 m, 2.25 m at 90 m). Plus a unit `CircleGeometry(1, 48)` fill at
  y 0.25. Shared geometries; 176 tris per zone.
- **Material.** `MeshBasicMaterial`, zone colour as HDR (Vigil `[2.0, 1.2, 0.35]`, Synod `[0.45, 2.0, 0.4]`),
  `transparent`, `AdditiveBlending`, `depthWrite: false`, `toneMapped: false`, `polygonOffset` -4. Ring opacity pulses
  0.7..1.0 at 0.8 Hz; fill opacity 0.06. Depth test stays on, so buildings hide the ring behind them.
- **Furniture.** Eight radial ticks pointing inward (boxes 0.03 x 0.12 of the radius, same material) rotating at
  0.15 rad/s, and a centre cross 4 m across. The **most recent zone** (the one Alt+Q and the spine use) has a second
  ring at 0.93 of the radius; the older zone has none.
- **Painting (G held).** The preview ring is brighter (opacity 1.0, no pulse), its ticks do not rotate, and the fill
  is 0.12. Under the crosshair: `RADIUS 45 M` (13 px amber, letter-spacing 0.3em) and below it
  `RELEASE G TO PLACE` (9 px, 60% alpha). On release the ring flashes white for 0.1 s and settles.
- **Radius label.** A DOM chip projected at the point of the ring nearest the camera: `Z1  45 M` / `Z2  45 M`,
  11 px Consolas, letter-spacing 0.2em, zone colour, background `rgba(10,6,2,0.7)`, 1 px border in the zone colour.
  Hidden beyond 500 m or off screen. Removing a zone: the ring shrinks to 0 over 0.15 s.
- **Auspex.** A 1.5 px circle in the zone colour at 0.9 alpha with a 0.08 fill, and `Z1` / `Z2` at its top (8 px).
  The Synod colour is close to the phosphor, so Synod zone circles are drawn dashed (4/3).

### 8.3 Tactical map (Tab)

- **Layout.** A disc centred on the screen, diameter `min(78vh, 62vw)`, same chrome as the auspex (3 px double
  `#58c98a` rim, outer glow, inner shadow, scanlines, no sweep). Label tab on the top rim:
  `TACTICAL  700 M  TIME x0.3` (class range in place of 700). Heading-up on the torso aim, exactly as the auspex; the
  aim is frozen while Tab is held (the mouse drives the cursor), so the plot does not spin. Same glyph language with
  glyph sizes x 1.6. The small auspex is hidden while the map is open.
- **Canvas.** Backing store 2 x CSS, capped at 1400 px. Redraw at 20 Hz real time (not game time). The cursor and
  drag preview are DOM/overlay elements updated every frame, so they stay smooth.
- **Group selector.** A column of four plates to the left of the disc, 16 px from its rim, vertically centred, each
  168 x 46 px with 8 px gaps: a key cap (`1`..`4`, 20 px square), the group name and weapon
  (`LEFT ARM  GATLING`), and a state line (`FREE`, `LOCK  CINDERMAW`, `QUEUED`, `ZONE Z1`, `FOCUS  EMBERWRIGHT`).

| | unselected | selected |
|---|---|---|
| border | 1 px `rgba(88,201,138,0.45)` | 2 px in the group colour |
| background | `rgba(2,14,8,0.6)` | group colour at 22% alpha |
| key cap | outline, text `#7ad6a2` | filled in the group colour, black digit |
| text | `#7ad6a2` | `#ffffff` name, group colour state line |
| extra | - | a 10 px notch on the right edge pointing at the disc; the plate is offset 8 px toward the disc |

  A plate whose weapon is destroyed is drawn at 35% alpha with `DISABLED`.
- **On the map for the selected group.** Groups 1 and 2: the arm's arc as a wedge from the centre in the group colour
  at 0.12 alpha, out to weapon range. Group 3: a range ring, dashed. Group 4: one dashed ring at the longest secondary
  range. Orders of **all** groups are always drawn: arm locks as a solid 1.5 px line plus a square bracket in the arm
  colour; a queued carapace shot as a 12 px crossed circle with a `3` and a dashed line; zones as in 8.2; a secondaries
  focus as a double bracket in the zone colour.
- **Cursor.** A 22 px gapped cross with a centre dot, 2 px, in the selected group's colour with a 1 px black outline.
  It starts at the plot position of the current crosshair ground point, moves 1 px per unit of `movementX/Y`, and is
  clamped 6 px inside the rim. Over a valid target for the group (within 14 px) it snaps to the glyph and becomes four
  corner brackets, with a tooltip chip (`HIERARCH  EMBERWRIGHT  312 M`, 10 px). Over an invalid target it drops to
  40% alpha with a small `x`. Group 4 drag: a ring from the press point with a `45 M` chip, as the painting preview.
  A click flashes a 0.15 s expanding ring in the group colour.
- **Slowed-time vignette.** A full-screen overlay between the 3D canvas and the map: a wash `rgba(8,30,18,0.35)`
  plus a radial gradient from transparent at 35% to `rgba(2,14,8,0.78)` at the corners, plus scanlines (1 px black at
  0.18 alpha every 3 px). No CSS filter on the game canvas (cost). Two 28 px black bars, top and bottom: the top one
  reads `TACTICAL COGITATION` at the left and `TIME x0.3` at the right with a 12-segment bar whose lit segment steps
  once per 0.1 s of game time (so it visibly crawls); the bottom one reads
  `1-4 GROUP   LMB ORDER   RMB CLEAR   WASD WALK   RELEASE TAB`. The rest of `#hud` drops to 45% alpha, except the
  armament panel. Fade in over 120 ms real time; on release everything is removed at once (the spec restores instantly).

## 9. Triangle and draw-call budget

| class | additions | tris | draw calls |
|---|---|---|---|
| Kestrel | none | 0 | 0 |
| Harrow | flak, hull autogun | 204 | 4 |
| Hierarch | 2 flak, tail platform, 2 bolters, 2 knee guns | 468 | 13 |
| Colossus | 3 flak, 2 turrets, missile spine, 2 knee batteries | 760 | 16 |

Ceiling 800 per class. The Colossus has 40 tris to spare; do not add detail there. Overlays: 176 tris per zone ring
(at most 3 with the preview).

## 10. Build notes for the implementer

- One function per class returning the mount geometries, cached per side, next to the mount list in `js/heavy.js`.
- Mount groups and anchors are plain `Group` / `Object3D`s. Parent knee mounts to `f.shin` for each entry of
  `legs.feet`; hide them with the legs (`setVisible`).
- Nothing here needs a change to `Builder`, `Legs`, the GLBs or any existing part list. The only export added is
  `MAT` from `js/walker.js`.
