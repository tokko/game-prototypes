# Harrow-class line engine: visual build spec

Companion to `model/harrow-spec.md` (gameplay). This file is the complete visual build: every primitive, pivot, anchor,
leg parameter and animation pose. Build it with the `Builder` helper in `js/util.js` only (no GLB, no Blender), in the same
way `buildParts` in `js/colossus.js` builds the great colossi. Original design; nothing here is taken from any existing
franchise.

## 1. Silhouette intent

- **A square, forward-hunched bruiser.** About 41 m wide across the arms and 40 m to the carapace, on a deep crouch with the
  knees thrust forward. The head is sunk under a carapace hood, below the shoulder line, behind a toothed chin plough (the
  "harrow").
- **Asymmetric.** The left side carries a huge box pauldron (the highest solid point) and a piston-driven siege fist almost
  twice the width of the head, hung low and forward like a knuckle-walker. The right side carries a long, thin, finned
  lascannon and, behind it, a tilted rocket rack. The carapace hump and twin exhaust stacks sit behind the left shoulder.
- **Versus the others.** The Kestrel is narrow, digitigrade and nose-forward with nothing above its back but a lance; the
  Hierarch is an upright box with a level deck, a spire cluster and symmetric gun arms. The Harrow has no spires and no
  level deck: it reads as a low wedge with one enormous arm, plantigrade two-bone legs bent far more than the Hierarch's.

## 2. Conventions

- Axes as the other walkers: **x = the walker's left, y = up, z = forward**, metres. So the fist arm (`arm_L`) is at +x
  and the lascannon (`arm_R`) at -x.
- `Builder` signatures (do not change them):
  `box(w, h, d, x, y, z, color, rx, ry, rz)`, `cyl(rTop, rBottom, h, x, y, z, color, rx, ry, rz, seg = 8)`,
  `pyr(w, h, x, y, z, color, d)`. A rotation turns the primitive about its own centre before it is moved to x, y, z.
  A `cyl` with `rx = hp` lies along z with `rTop` at the +z end; with `rz = hp` it lies along x. `pyr` has its base at y
  and its apex at y + h and cannot be rotated.
- `hp = Math.PI / 2`, `q = Math.PI / 4`.
- All coordinates in a part list are **local to that node's pivot**.
- Triangle cost: box 12, pyr 8, cyl 4 x seg (8-seg 32, 6-seg 24, 10-seg 40).

### Colours (livery slots)

Use the Kestrel's `LIVERY` table from `js/walker.js` unchanged. It is not exported, so copy the two rows into the Harrow
module. Resolved values:

| slot | var | Vigil (side 0) | Synod (side 1) | used for |
|---|---|---|---|---|
| `hull` | `H` | 0x46525e slate | 0x5a211a oxblood | main armour |
| `hull2` | `H2` | 0x9a947e bone | 0x17130f black | stripe panels: chin plough, knee guards, upper-arm plate |
| `dark` | `D` | 0x1d2228 | 0x191414 | frame, joints, carapace tier, gun body |
| `trim` | `T` | 0x9a7a3a brass | 0x6c7434 olive | edges, drums, tines, fins, knuckle plate |
| `bone` | `Bn` | 0x9a947e bone | 0x8a6a22 ochre | tabard, litany plates, pauldron boss, cuisse inset |
| `soot` | `S` | 0x0b0a09 | 0x0b0a09 | stacks, fist ram piston |
| `tank` | `Tk` | 0x7a2a1c red | 0x8a6a22 ochre | lascannon coolant flasks |
| `glow` | `g` | PAL[0].glow amber | PAL[1].glow green | visor, running lights, pauldron lozenge |
| `glow_hot` | `hot` | [2.2, 0.3, 0.1] | [2.2, 0.3, 0.1] | reactor vents, forearm vents, rocket tubes |
| `glow_charge` | `W` | 0xffffff | 0xffffff | lascannon glow and fist glow meshes (colour comes from the material) |

Body slots are passed to `Builder` as `[r, g, b]` arrays brightened by 1.3, exactly as `walker.js` does:
`const L = hex => { c.set(hex); return [c.r * 1.3, c.g * 1.3, c.b * 1.3]; }`. Glow slots are passed as plain arrays, unscaled.
The only per-side geometry difference is one lozenge on the tabard (`side ? T : H`).

### Materials and meshes

- Body: one shared `MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 })`.
- Faction and hot glow: one shared `MeshBasicMaterial({ vertexColors: true, toneMapped: false })`.
- `lascannon_glow` and `fist_glow`: one `MeshBasicMaterial({ color: 0x000000, toneMapped: false })` **per instance, per
  mesh**, no vertex colours. Black at rest; the animation writes `material.color`.
- One merged geometry per node per material: 20 draw calls for the whole engine. Build the geometries once per side and
  share them between instances, as `colossus.js` does with `shared.parts`.

## 3. Node tree and rest pivots

World positions are for the rest pose with no body lean applied.

| node | parent | pivot in parent | world pivot (x, y, z) | driven by |
|---|---|---|---|---|
| `harrow` | - | 0, 0, 0 | 0, 0, 0 | root: position, hull yaw |
| `pelvis` | harrow | 0, 19, 0 | 0, 19, 0 | hip height + bob; `rotation.x` = body lean (rest 0.10) |
| `torso` | pelvis | 0, 3, 0 | 0, 22, 0 | waist yaw (`rotation.y`) |
| `head` | torso | 0, 7.2, 11.5 | 0, 29.2, 11.5 | small yaw toward the target, +-0.35 |
| `arm_R` | torso | -12.5, 11, 1 | -12.5, 33, 1 | aim pitch, `rotation.x = -pitch`, +-0.5 |
| `lascannon_glow` | arm_R | 0, 0, 0 | as arm_R | charge tell (material colour) |
| `arm_L` | torso | 13, 11.5, 0.5 | 13, 33.5, 0.5 | shoulder swing, `rotation.x` (rest 0.15) |
| `forearm_L` | arm_L | 0, -9, 0 | 13, 24.6, -0.85 | elbow, `rotation.x` (rest 0.15) |
| `fist_L` | forearm_L | 2, 0, 10 | 15, 21.6, 8.7 | ram slide, `position.z = 10 + ram` |
| `fist_glow` | fist_L | 0, 0, 0 | as fist_L | wind-up tell (material colour) |
| `rocket_rack` | torso | -7.5, 16, -4.5 | -7.5, 38, -4.5 | static, fixed `rotation.x = -0.4` (tubes tilted up) |
| `thigh_L/R` | scene | hip | +-6.97, 19, 0 | `Legs` IK |
| `shin_L/R` | scene | knee | - | `Legs` IK |
| `foot_L/R` | scene | ground contact | +-8.5, 0, 0 | `Legs` |

Rotation signs, for a node with `rotation.x = a`: positive `a` swings a hanging arm (pointing -y) **backward**, and tips a
forward-pointing forearm or barrel (pointing +z) **down**. Positive torso `rotation.y` turns the chest toward +x, which
carries the left shoulder **back**.

### Anchors (empty `Object3D`s)

| anchor | parent | local position | world at rest | use |
|---|---|---|---|---|
| `anchor_lascannon` | arm_R | -3.5, -2, 23 | -16, 31, 24 | beam origin, charge sparks |
| `anchor_fist` | fist_L | 0, 0, 8.5 | 15, 19.1, 16.8 | knuckle face: hit test, impact effects |
| `anchor_rack` | rocket_rack | 0, 2.2, 3.4 | -7.5, 41.4, -2.2 | rocket launch point (front face of the tubes) |
| `anchor_reactor` | torso | 0, 8, -3 | 0, 30, -3 | death explosion, critical glow |

## 4. Part lists

### pelvis (176 tris)

```js
pelvis.box(13, 5, 10, 0, 0, 0, D)                        // core
  .cyl(3.2, 3.2, 4, 7, 0, 0, T, 0, 0, hp)                // hip drums
  .cyl(3.2, 3.2, 4, -7, 0, 0, T, 0, 0, hp)
  .box(7, 5, 8, 0, -3.5, 1, D)                           // groin block
  .box(5, 9, 0.5, 0, -6.5, 5.4, Bn)                      // front tabard
  .box(1.2, 7, 0.4, 0, -6.5, 5.7, D)                     // tabard stripe
  .box(2.6, 2.6, 0.4, 0, -4.5, 5.8, side ? T : H, 0, 0, q) // tabard lozenge
  .box(9, 6, 0.6, 0, -4, -5.3, H)                        // rear skirt plate
  .cyl(4.6, 5.2, 2.5, 0, 3, 0, D, 0, 0, 0, 10);          // waist ring (the torso turns on this)
```

### torso (body 372 tris, glow 60 tris)

The hunch is built from stepped tiers plus two tilted slabs (hood and plough). Top of the carapace hump is local y 18,
world 40.

```js
torso.box(15, 6, 14, 0, 3.5, 1, D)                       // belly
  .box(20, 8, 17, 0, 9, 2, H)                            // main hull
  .box(16, 1.6, 7, 0, 11.6, 13, H, 0.4)                  // hood slab over the head, front edge dips
  .box(14, 3, 6, 0, 2.6, 11.5, H2, -0.4)                 // chin plough, front edge rises
  .box(13, 1.2, 1.6, 0, 3.4, 14.2, D)                    // tine bar
  .box(24, 3.5, 19, 0, 14.25, -0.5, D)                   // carapace tier 1 (wide, low)
  .box(13, 2, 12, 3.5, 17, -3.5, H)                      // carapace tier 2: hump, offset to the left
  .box(5, 6, 9, -11, 11, 1, D)                           // right shoulder yoke
  .box(6, 7, 10, 11.5, 11.5, 0.5, D)                     // left shoulder yoke
  .box(13, 9, 5, 0, 8, -8.5, D)                          // rear reactor housing
  .box(9, 4, 10, -15, 14.5, 1, H)                        // right pauldron (small, flat)
  .box(9.4, 0.7, 10.4, -15, 16.85, 1, T)                 // right pauldron cap
  .box(11, 8, 14, 15.5, 14.5, 0.5, H)                    // LEFT GREAT PAULDRON
  .box(11.6, 1, 14.6, 15.5, 19, 0.5, T)                  // left pauldron cap (top at local 19.5, world 41.5)
  .box(5, 5, 0.5, 15.5, 14.5, 7.6, Bn)                   // pauldron boss plate
  .box(3.5, 5, 0.5, 7, 9, 10.7, Bn)                      // litany plates either side of the head
  .box(3.5, 5, 0.5, -7, 9, 10.7, Bn)
  .cyl(1.0, 1.3, 6, 5.5, 17, -8, S, -0.25, 0, 0, 6)      // twin exhaust stacks, raked back, behind the left shoulder
  .cyl(1.0, 1.3, 6, 8.5, 17, -8, S, -0.25, 0, 0, 6);
for (let i = -2; i <= 2; i++) torso.box(1.1, 4, 1.1, i * 2.8, 1.2, 14.4, T);   // five harrow tines under the plough
for (const x of [-5, 0, 5]) torso.box(1.2, 10, 1, x, 8, -11.3, T);             // three reactor ribs (rear)
for (const x of [0, 3.5, 7]) torso.pyr(1.4, 2, x, 18, 1.6, T);                 // low tine crest on the hump's front edge

torsoGlow.box(3, 5, 0.4, 2.5, 8, -11.05, hot)            // reactor vents between the ribs
  .box(3, 5, 0.4, -2.5, 8, -11.05, hot)
  .box(2.2, 2.2, 0.4, 15.5, 14.5, 7.95, g, 0, 0, q)      // pauldron lozenge
  .box(1.6, 0.6, 0.4, 7, 6, 10.7, g)                     // running lights under the litany plates
  .box(1.6, 0.6, 0.4, -7, 6, 10.7, g);
```

The left pauldron is part of the torso, not the arm, so it stays still while the arm swings beneath it.

### head (body 84 tris, glow 12 tris)

A squat ram-helm with one slit visor and a blank ram plate instead of a grille. It sits under the hood, between the plough
and the litany plates.

```js
head.box(6, 4, 6, 0, 0, 2.5, D)                          // skull
  .box(6.6, 1.4, 4, 0, 1.6, 4.4, H, 0.3)                 // brow wedge
  .box(4.4, 1.8, 1, 0, -1.5, 5.9, T)                     // ram plate
  .cyl(0.6, 0.6, 1.6, 3.4, 0, 3, T, hp, 0, 0, 6)         // cheek sensors
  .cyl(0.6, 0.6, 1.6, -3.4, 0, 3, T, hp, 0, 0, 6);
headGlow.box(4.6, 0.7, 0.4, 0, 0, 5.7, [g[0] * 1.5, g[1] * 1.5, g[2] * 1.5]);   // visor slit
```

### arm_R: lascannon (body 220 tris, charge glow 48 tris)

The barrel axis runs along z through local (-3.5, -2). Square cooling fins, not rings, so it does not read as the
Hierarch's blaster.

```js
armR.cyl(2.6, 2.6, 3, -2, 0, 0, T, 0, 0, hp)             // trunnion
  .box(6, 7, 12, -3.5, -2, 1, H)                         // receiver
  .box(6.4, 0.8, 8, -3.5, 1.8, 1, T)                     // top cover
  .box(5, 5, 5, -3.5, -2, -7, D)                         // capacitor bank (rear)
  .cyl(1.1, 1.1, 6, -7.1, -1, -2, Tk, hp, 0, 0, 6)       // coolant flasks, outboard
  .cyl(1.1, 1.1, 6, -7.1, -3.6, -2, Tk, hp, 0, 0, 6)
  .cyl(1.5, 1.8, 14, -3.5, -2, 14, D, hp)                // barrel, z 7..21
  .box(4, 4, 2.5, -3.5, -2, 21.5, D)                     // muzzle block
  .box(1.2, 2, 10, -3.5, -5, 12, D);                     // under-brace
for (const z of [9, 11.5, 14, 16.5]) armR.box(4.6, 4.6, 0.6, -3.5, -2, z, T);   // four square fins

for (const z of [10.25, 12.75, 15.25]) lasGlow.box(3.4, 3.4, 1.6, -3.5, -2, z, W);   // emitter blocks between the fins
lasGlow.box(2.2, 2.2, 0.4, -3.5, -2, 22.9, W);           // muzzle lens
```

### arm_L: upper arm (112 tris)

Hangs along local -y from the shoulder; the elbow is at local (0, -9, 0). The arm's centreline is at local x = 2.

```js
armL.cyl(3.4, 3.4, 7, 2, 0, 0, D, 0, 0, hp)              // shoulder drum (hidden under the pauldron at rest)
  .box(6, 9, 6.5, 2, -4.5, 0, H)                         // upper arm
  .box(1, 6, 5, 5.4, -4.5, 0, H2)                        // outer stripe plate
  .cyl(0.6, 0.6, 8, 2, -4.5, -3.8, T, 0, 0, 0, 6)        // rear piston
  .cyl(3.6, 3.6, 7.5, 2, -9, 0, T, 0, 0, hp);            // elbow drum
```

### forearm_L: ram sleeve (body 96 tris, glow 24 tris)

Runs along local +z from the elbow.

```js
foreL.box(7.5, 7.5, 9, 2, 0, 5, H)                       // sleeve, z 0.5..9.5
  .box(8.2, 1.2, 7, 2, 4.2, 5, T)                        // vambrace plate
  .box(4, 0.5, 5, 2, 4.9, 5, Bn)                         // vambrace inset
  .box(4, 4, 4, 2, 0, -2.5, D)                           // elbow counterweight
  .cyl(0.7, 0.7, 9, 6.3, -1, 5, D, hp, 0, 0, 6)          // ram guide rods
  .cyl(0.7, 0.7, 9, -2.3, -1, 5, D, hp, 0, 0, 6);
foreGlow.box(0.4, 1, 5, 6.0, 1.5, 5, hot)                // outboard vent slats
  .box(0.4, 1, 5, 6.0, -1.5, 5, hot);
```

### fist_L: siege fist (body 140 tris, fist glow 60 tris)

A blunt block fist on a piston. The piston sits inside the sleeve at rest and is exposed when the ram extends. Knuckle face
at local z 8.5 to 9.4.

```js
fist.cyl(2.4, 2.4, 7, 0, 0, -2.5, S, hp)                 // ram piston, z -6..1
  .box(7, 7, 1.5, 0, 0, 1, D)                            // wrist collar
  .box(9, 8.5, 5.5, 0, 0, 4.5, H)                        // fist block
  .box(9.6, 3, 1.2, 0, 1.8, 7.6, T)                      // knuckle plate
  .box(8.6, 4, 1.4, 0, -2, 7.7, D)                       // curled finger slab
  .box(2.2, 4, 4.5, -5.4, -1, 5, D);                     // thumb block (inboard)
for (const x of [-3.3, -1.1, 1.1, 3.3]) fist.box(1.6, 2.4, 1.6, x, 1.8, 8.6, D);   // four knuckle studs

for (const x of [-2.2, 0, 2.2]) fistGlow.box(0.5, 2.6, 0.5, x, 1.8, 8.5, W);       // seams between the studs
fistGlow.box(7, 0.5, 3, 0, 4.4, 4.5, W)                  // top grille
  .box(0.5, 5, 3, 4.7, 0, 4.5, W);                       // outboard grille
```

### rocket_rack (body 36 tris, glow 96 tris)

4 x 2 tubes, eight rockets. The node carries the tilt (`rotation.x = -0.4`), so the geometry is axis-aligned. It sits on
carapace tier 1 behind the right shoulder; its highest corner is at about world y 43.

```js
rack.box(6, 1.6, 4, 0, 0.4, 0, D)                        // cradle
  .box(8, 3.2, 6.4, 0, 2.2, 0, D)                        // launcher box
  .box(8.4, 0.5, 6.8, 0, 4.05, 0, T);                    // lid
for (const y of [1.5, 2.9]) for (const x of [-2.7, -0.9, 0.9, 2.7]) rackGlow.box(1.3, 1.1, 0.3, x, y, 3.3, hot);
```

### Legs (264 tris per leg, one mesh set shared by both sides)

Segments are modelled along local **+z from the proximal joint, armoured face on local +y**, like the Kestrel and the
great colossi. The foot's origin is the ground contact point with y up and z forward. There is no meta segment.

```js
thigh.box(5, 5.5, 11, 0, 0, 5.5, D)
  .box(6.6, 2, 8.5, 0, 3.4, 5, H)                        // cuisse
  .box(3.4, 0.6, 5.5, 0, 4.6, 5, Bn)                     // cuisse inset
  .cyl(0.7, 0.7, 8, 0, -3.3, 5.5, T, hp, 0, 0, 6)        // rear hydraulic
  .cyl(3.3, 3.3, 6.4, 0, 0, 11, T, 0, 0, hp);            // knee drum

shin.box(4.6, 5, 11.5, 0, 0, 5.75, D)
  .box(6.4, 2, 9, 0, 3.2, 6.5, H)                        // greave
  .box(6.4, 3, 5, 0, 3.8, 1, H2)                         // knee guard
  .pyr(2.4, 2.4, 0, 5.3, 1, T)                           // knee stud, points forward
  .cyl(0.6, 0.6, 8, 0, -3, 6, T, hp, 0, 0, 6)            // rear piston
  .cyl(2.6, 2.6, 5.4, 0, 0, 11.5, D, 0, 0, hp);          // ankle drum

foot.box(7.5, 1.8, 8, 0, 0.9, 0.5, D)                    // sole
  .box(3.2, 1.6, 3.6, 2.1, 0.8, 6.1, H)                  // two toes
  .box(3.2, 1.6, 3.6, -2.1, 0.8, 6.1, H)
  .box(3.6, 1.6, 2.6, 0, 0.8, -4.4, H)                   // heel spur
  .box(5.5, 2.2, 5, 0, 2.7, 0.3, H)                      // instep armour
  .box(7.9, 0.5, 8.4, 0, 1.9, 0.5, T);                   // trim band
```

The foot is 13.6 m heel to toe (about 1.5 tank lengths) and 7.9 m wide.

## 5. Legs parameters

```js
new Legs(scene, {
  hipW: 8.5, thighL: 11, shinL: 11.5, footH: 2.5, knee: 1,
  stride: 14, stepTime: 0.95, stepH: 3.5, refSpeed: 16,
  makeParts: sgn => ({ thigh: new THREE.Mesh(P.th, M), shin: new THREE.Mesh(P.sh, M), foot: new THREE.Mesh(P.ft, M) }),
  onStep: f => ...,
});
```

- No `metaL` and no `metaLean`: the existing two-bone path.
- Hip height **19** at rest, passed to `legs.update` as `hipY` (plus bob). The legs reach 22.5 + 2.5, so at 19 the knees
  sit about 7.6 m forward of the hips and 8 m below them: a deep crouch. Do not raise the hip above 21 or the crouch
  disappears; do not drop it below 16.
- `Legs` puts the hips at 0.82 x hipW = 6.97, which matches the pelvis hip drums at +-7.
- When staggered or limping, raise `stepTime` to 1.4.
- The fist at rest clears the left knee by about 2 m. If the rest pose in section 7 is changed, keep the bottom of the fist
  above world y 15.

## 6. Dimensions check

| measure | value |
|---|---|
| top of carapace hump | 40 m |
| top of left pauldron | 41.5 m |
| highest points (crest tines, stacks, rack corner) | 42 to 43 m |
| shoulder pivots | 33 m (right), 33.5 m (left) |
| visor | 29.2 m |
| hips | 19 m |
| width across the arms | about 41 m (x -20.7 to +21) |
| stance width, outside of the feet | about 25 m |
| lascannon muzzle | 24 m ahead of centre |
| foot length | 13.6 m |

Suggested hit volumes: torso sphere at y 31, radius 11; two leg capsules of radius 3.5 from hip to ankle; shield bubble of
radius 24 centred at y 26. Ground shadow disc radius 16.

## 7. Animation cues

All angles in radians. `A` = `arm_L.rotation.x`, `F` = `forearm_L.rotation.x`, `ram` = offset added to
`fist_L.position.z` (rest 10), `yawOff` = offset added to the torso yaw on top of its aim, `lean` = `pelvis.rotation.x`.

### Siege fist

| phase | duration | A | F | ram | yawOff | lean | fist glow k |
|---|---|---|---|---|---|---|---|
| rest | - | 0.15 | 0.15 | 0 | 0 | 0.10 | 0 |
| wind-up (ends here) | 0.70 s | 1.05 | -0.95 | -2.5 | +0.35 | 0.05 | 1 |
| strike (ends here) | 0.16 s | -0.55 | 1.00 | +3.0 | -0.45 | 0.18 | 1 |
| hold | 0.25 s | same | same | +3.0 | -0.45 | 0.18 | 1 to 0.6 |
| recover to rest | 0.90 s | 0.15 | 0.15 | 0 | 0 | 0.10 | 0.6 to 0 |

- **Wind-up read.** The elbow goes up and back behind the pauldron, the forearm comes level, and the fist is cocked beside
  the hull at shoulder height (about world y 28) while the whole torso twists to carry the left shoulder back and the body
  rocks back on its heels. Ease in-out (smoothstep) across the 0.7 s. The ram retracts 2.5 m into the sleeve. This pose is
  unmistakable from the front: the fist, normally low and forward, vanishes back beside the head and lights up.
- **Strike arc.** An overhand hook: the torso whips 0.8 rad from left-shoulder-back to left-shoulder-forward, the upper arm
  swings forward and the forearm drops 26 degrees below level, and the ram fires 5.5 m (from -2.5 to +3) in the last
  0.08 s. Ease-in (accelerating: `t * t`). At the end the knuckles are on the walker's centreline about 28 m ahead of the
  waist at about 14 m height, which is scout-hull height. The swept arc, seen from above, runs from about 60 degrees left
  of the torso's aim to about 5 degrees right of it, at 20 to 28 m radius. Apply the damage test at the end of the strike
  phase.
- On the strike landing: kick `bobV` down by 6, and add a camera shake.
- The right arm keeps aiming during the swing; the lascannon does not fire while the fist is in wind-up or strike.

### Fist glow

`fist_glow.material.color.setRGB(3.2 * e, 1.6 * e, 0.4 * e)` (furnace yellow-orange) where `k` is the wind-up fraction and
`e = Math.pow(k, 1.5) * (k > 0.5 ? 1 + 0.2 * Math.sin(time * 56) : 1)`. That is a smooth ramp for the first half, then a
9 Hz flutter. Hold full through the strike and hold, then decay to black over the recovery. Black at all other times.

### Lascannon charge glow

Over the 0.6 s charge, with `k` = charge fraction: `lascannon_glow.material.color.setRGB(2.8 * k * k, 0.35 * k * k, 0.3 * k * k)`
(crimson, deliberately unlike the Hierarch's blue-white and unlike either faction glow). In the last 0.1 s multiply by
`1 + 0.3 * Math.sin(time * 90)`. On firing, set it to (7, 0.9, 0.75) for 0.08 s, then decay to black over 0.3 s. Recoil:
push `arm_R.position.z` back 1.2 m on firing and damp it home at rate 6.

### Idle and walk

- Rest `lean` 0.10 (forward hunch) at all times; add `0.012 * Math.sin(time * 0.9)` as breathing.
- Idle torso sway: add `0.03 * Math.sin(time * 1.6)` to the torso yaw when it has no target.
- The fist arm swings like a pendulum: `A += 0.04 * Math.sin(time * 1.1)`, `F -= 0.03 * Math.sin(time * 1.1)`. While
  walking, replace that with a swing of amplitude 0.10 on `A` in time with the steps (forward as the right foot lands).
- Head: yaw toward the current target, clamped to +-0.35, damped at rate 4.
- Footfall (`onStep`): `bobV -= 5`; roll the pelvis 0.025 toward the landing foot and damp it out at rate 5. Use the same
  bob spring as the colossi (`bobV += (-bob * 22 - bobV * 4) * dt`) with stiffness 40 and damping 6 so it settles faster.
- Stagger (10 s): `lean` 0.22, `A` 0.3, `F` 0.5 (fist drags), `stepTime` 1.4.
- Death: fold as the scouts do, with `lean` rising to 1.2 over 2.5 s and the hip sinking 10 m, fist arm limp at `A` 0.4,
  `F` 0.9; reactor explosion at `anchor_reactor`.

## 8. Triangle budget

| part | tris |
|---|---|
| pelvis | 176 |
| torso body + glow | 372 + 60 |
| head body + glow | 84 + 12 |
| arm_R body + charge glow | 220 + 48 |
| arm_L upper | 112 |
| forearm_L body + glow | 96 + 24 |
| fist_L body + fist glow | 140 + 60 |
| rocket_rack body + glow | 36 + 96 |
| legs, 264 x 2 | 528 |
| **total on screen** | **2,064** |

Ceiling 2,500 if detail is added later; the hard limit is 4,000. 20 draw calls per engine.

## 9. Silhouette sketches

Front view (the viewer faces the engine, so its left arm, the fist, is on the viewer's right). One column is about 1 m
wide, one row about 2 m.

```
 m                    rack        tines  stacks
 43                  ._____.       ^ ^ ^  ||
 41                  |oooo |   .__________||_.______________.
 40                  |oooo_|___|     hump    |              |
 38        .________.|_______________________|    GREAT     |
 36        |pauldron|      carapace tier     |   PAULDRON   |
 34        |________|__.________________.____|    [<>]      |
 32    .______.  yoke  |    hood        |yoke|______________|
 30   o|      |        | [##] ==== [##] |       |      |
 28   o| LAS  |        |___ [visor] ____|       | arm  |
 26    | CAN  |          \__plough___/          |      |
 24    |______|           | | | | |  tines      (elbow)
 22                     .___waist___.          .________.
 20                  .__|___________|__.       |        |
 19  hips          (O)|    pelvis    |(O)      |  SIEGE |
 17                 | |    |tab|     | |       |  FIST  |
 15                 |  \   |ard|    /  |       |________|
 13                 |   |  |___|   |   |
 11               [knee]           [knee]
  9                 |   |          |   |
  6                 |   |          |   |
  3               .(ank).        .(ank).
  0             __|_____|__    __|_____|__
     x: -20    -12  -8.5    0    +8.5  +12      +20
     (its right: lascannon)              (its left: fist)
```

Side view from the engine's left (forward is to the right; the fist arm is nearest the viewer).

```
 m
 43      ||  _.-rack   ^^^
 41      ||_/_/ .______________.
 40     .|______|              |
 38     |  hump | GREAT        |
 36    .|_______| PAULDRON     |___
 34    |ribs    |______________|    \ hood
 32    |react.  |  (shoulder)   \____\__
 30    |  *     |   \            [head]=        ===#==#==#==#==[]  lascannon (far side)
 28    |________|    \ upper arm  [__]             muzzle at z +24
 26         |  belly  \         _/plough
 24         |_______(elbow)____/ ||||| tines
 22            |waist|  \_____________.
 20          .___________.|  sleeve   |_______.
 19  hip     |  pelvis (O)|___________| SIEGE |
 17          |__________|\            | FIST  |
 15              |tab|    \ thigh     |_______|   fist face at z +17
 13              |___|     \
 11                       [knee]>  knee 7.6 m ahead of the hip
  9                       /
  6                     / shin
  3                 (ank)
  0          [heel|__sole__|toes]
     z:  -12   -6    0    +6   +12   +18   +24
```

## 10. Build notes for the implementer

- One function `buildParts(side)` returning the geometries named above (`pelvis`, `torso`, `torsoGlow`, `head`,
  `headGlow`, `armR`, `lasGlow`, `armL`, `foreL`, `foreGlow`, `fist`, `fistGlow`, `rack`, `rackGlow`, `th`, `sh`, `ft`),
  cached per side.
- Assemble the groups with the pivots in section 3. `pelvis` holds its mesh and the `torso` group; set
  `pelvis.position.y` to the hip height each frame, as `colossus.js` does with `body`.
- Anchors are plain `Object3D`s added to the parents listed in section 3.
- Nothing in this design needs a change to `Builder`, `Legs` or `LIVERY`.

## Model notes (Harrow asset, as built in Blender)

Files: `model/harrow.glb` (244 kB), `model/harrow.blend`, source `model/build_harrow.py` (pulls in `build_scout.py` helpers if not already
loaded; run through the Blender MCP session), renders `model/renders/harrow_{front34,front,side_left,rear34,high}.png`, scale comparison
`model/renders/harrow_tiers.png` (Kestrel, Harrow, Hierarch GLBs side by side). Axes as the Kestrel and Hierarch: x = walker's left,
y = up, z = forward, metres; glTF export with the same settings as the Hierarch (`export_yup`, vertex colour ACTIVE, no textures, no
animations). Flat shaded, chamfered armour, `COLOR_0` = baked AO x plate jitter. Node names, pivots and anchor positions match
`js/harrow.js`.

**Triangles.** 2,680 unique, 3,250 with both legs (thigh/shin/foot share one mesh per side). Spec estimate was 2,064; the difference is
the chamfers (about 900) and 4-sided cones for `pyr`. Under the 4,000 hard limit.

**Size.** 43.3 m to the highest point (crest tines/rack corner), x -20.6 to +21.3 (about 42 m across the arms), z -11.8 to +24.1
(lascannon muzzle).

**Nodes and rest pivots (world, y up; verified by reading matrices back from Blender).**
| node | parent | pivot in parent | world pivot | rest rotation baked on the node |
|---|---|---|---|---|
| `harrow` | - | 0, 0, 0 | 0, 0, 0 | - |
| `pelvis` | harrow | 0, 19, 0 | 0, 19, 0 | none (lean 0.10 is a game pose; not baked) |
| `torso` | pelvis | 0, 3, 0 | 0, 22, 0 | - |
| `head` | torso | 0, 7.2, 11.5 | 0, 29.2, 11.5 | - |
| `arm_R` | torso | -12.5, 11, 1 | -12.5, 33, 1 | - |
| `lascannon_glow` | arm_R | 0, 0, 0 | as arm_R | - |
| `arm_L` | torso | 13, 11.5, 0.5 | 13, 33.5, 0.5 | rotation.x 0.15 |
| `forearm_L` | arm_L | 0, -9, 0 | 13, 24.6, -0.84 | rotation.x 0.15 |
| `fist_L` | forearm_L | 2, 0, 10 | 15, 21.65, 8.71 | - |
| `fist_glow` | fist_L | 0, 0, 0 | as fist_L | - |
| `rocket_rack` | torso | -7.5, 16, -4.5 | -7.5, 38, -4.5 | rotation.x -0.4 |
| `thigh_L/R` | harrow | hip | +-6.97, 19, 0 | IK rest pose (feet at +-8.5, 0, +-2.5) |
| `shin_L/R` | harrow | knee | +-7.6, 12.2, +-2.5 + 6.1 (L: 7.6, 12.2, 8.62) | IK rest pose |
| `foot_L/R` | harrow | ground contact | +-8.5, 0, +-2.5 (left +2.5, right -2.5) | - |

The game overwrites rotation on the driven nodes every frame, so the baked rest rotations only matter for a static view of the GLB; they are
the spec's own rest values (A = F = 0.15, rack tilt -0.4).

**Anchors (empties, world at rest, read back).** `anchor_lascannon` -16, 31, 24 (child of arm_R) · `anchor_fist` 15, 19.13, 16.83 (child of
fist_L) · `anchor_rack` -7.5, 41.35, -2.23 (child of rocket_rack) · `anchor_reactor` 0, 30, -3 (child of torso). All within 0.05 m of the
spec table.

**Livery slots.** `hull`, `hull2`, `dark`, `trim`, `bone`, `soot`, `tank`, `glow`, `glow_hot`, `glow_charge`. Body and faction/hot glow
slots share meshes per node (torso, head, forearm_L, rocket_rack carry `glow`/`glow_hot` faces), so a game loader splits by material slot
as it does for the Hierarch. `lascannon_glow` and `fist_glow` are separate nodes using only `glow_charge` (authored white; give each
instance its own black-at-rest `MeshBasicMaterial`). The side-1 tabard lozenge (`side ? T : H`) is the one per-faction geometry difference;
this GLB is the side-0 build (hull-coloured lozenge), so swap that one box's slot for Synod or leave it.

**Deviations from the spec (all additive; no node, pivot, anchor or primitive position changed).**
1. Chamfers (bmesh bevel, 1 segment) on the major armour boxes (hull, shoulders, fist block, forearm, cuisse and greave plates, belly,
   carapace tier 1, rack box), to match the Kestrel/Hierarch look. Not in the primitive spec.
2. Mild top-face tapers on the main hull, carapace tier 1 and reactor housing.
3. `pyr` is a 4-sided cone with a 0.02 m tip (10 tris) so it works with the Part helper; same base and height.
4. Rest feet are staggered z +2.5 (left) / -2.5 (right) with the IK re-solved (spec table had both at z 0).
5. `glow_charge` is black at rest (emission strength 0); the colour comes from the game material.
6. Visor glow is the plain `glow` slot; the spec's 1.5x brightening belongs in the game material.

**Correction pass (visual gate, all torso-local; pivots, anchors and node names unchanged).**
- Hunch: carapace tier 1 and the hump tilted rx +0.16 about the tier-1 centre; stacks and crest tines re-seated on the tilted surface; rack cradle
  lowered/thickened (the rack node keeps its spec pivot and tilt).
- Great pauldron: rx +0.16, top front edge back 2.0 m, top outboard edge in 1.2 m; flat cap replaced by two dark plates in a shallow gable
  (pitch 0.25 rad, ridge along z) inside a brass rim band 11.4 x 0.6 x 14.4 at y 18.2. Boss plate and lozenge re-seated on the slanted face
  (lozenge at 15.5, 13.5, 7.05).
- Right pauldron cap: dark gable roof (inset 0.6 m per side) with a 0.4 m brass strip at the front only. Rack lid: 7.2 x 5.6, dark, brass front strip.
  The gable was my one extra fix after the high view still read as a tabletop with a flat inset plate.
- Hood: 16 x 1.6 x 9 at (0, 11.2, 13.5), rx 0.5, front edge tapered to 13 wide and 0.6 thick. Belly bottom face inset to 11 wide (top 15).
- Legs: shin core and greave 0.8x width at the ankle, thigh core 0.85x at the knee.
- Vertex colour: AO floor 0.55, plate jitter +-6%. Reactor-housing taper was in fact applied before the first renders (my earlier report was wrong).

**Known limits.** No damage-state variants. The lean 0.10 pose is not baked, so a bare GLB looks more upright than the in-game rest pose
(renders in `model/renders/` apply the 0.10 lean to the pelvis for review only, then reset it). The model has not been loaded in three.js.
Hit volumes as in section 6.
