# Map objective sites: visual build spec

Companion to section 2 and section 4 of `model/objectives-facings-spec.md` (gameplay: five capturable sites A to E, 60 m
capture ring, progress -100..+100, benefits per type). This file is the complete visual build: every primitive, node,
colour state, ground marking, effect and HUD glyph. Build it with the `Builder` helper in `js/util.js` only (no GLB), in
the new `js/objectives.js`, the way `buildParts` in `js/bastion.js` builds the bastion. Original design; nothing here is
taken from any existing franchise. Triangle counts are estimates from the part lists (box 12, pyr 8, cyl 4 x seg), not
measured.

## 1. Design intent

Three site types, three silhouettes that cannot be confused with each other, with the bastion, or with the ward
generator (octagonal drum, four claws, floating star):

| type | sites | silhouette in one line | footprint | height |
|---|---|---|---|---|
| Reinforcement gate | A, E | a free-standing iron arch: two fat piers, a heavy lintel, a dark mouth with a glowing portcullis | 46 x 30 m | 58 m (mast to 86) |
| Ward anchor | B, D | a thin square needle on a stepped base, two floating octagonal halos round it, four small corner spikes | 40 x 40 m | 66 m (mast to 94) |
| Artillery manufactorum | C | a squat forge hall with two tall stacks and three huge mortar barrels raised at 60 degrees on the roof | 46 x 40 m | hall 33 m, barrels 71 m, stacks 75 m |

- **Scale.** A great colossus is about 125 m, a Hierarch 63 m, a city lot 46 m wide. Every site fits one lot, stands
  about half a colossus tall, and is topped by a mast so it breaks the roofline of the 24 to 90 m habs around it.
- **The sites themselves are neutral.** The body is unpainted iron-grey stone, the same for both factions. Ownership is
  shown only by the swappable elements in section 3, so one geometry set serves all owners.
- **Read at 170 m and above (colossus camera):** the silhouette, the standard block on the mast and its colour, the
  beacon, the ground rings. Nothing under 3 m is relied on.
- **Read from a Kestrel on the ground inside the ring:** the dashed ground ring and progress ring underfoot, the low
  owner lamps (gate portcullis, anchor shaft slits, manufactorum door bars), and the mast overhead.

## 2. Conventions

- **Site-local axes: x = the site's left, y = up, z = the site's front**, metres, origin on the ground at the centre.
- `Builder` signatures (unchanged): `box(w, h, d, x, y, z, color, rx, ry, rz)`,
  `cyl(rTop, rBottom, h, x, y, z, color, rx, ry, rz, seg = 8)`, `pyr(w, h, x, y, z, color, d)` (base at y, apex at
  y + h, cannot be rotated). A rotation turns the primitive about its own centre before it is moved. A `cyl` with
  `rx = hp` lies along z with `rTop` at the +z end; with `rz = hp` it lies along x.
- `hp = Math.PI / 2`, `q = Math.PI / 4`.
- `rx = -a` tips the top of an upright slab toward -z, `rx = +a` toward +z (as in `bastion-visual.md`).

### Placement and orientation

Exact coordinates are the implementer's call (gameplay spec). The visual constraints:

- Each site needs one cleared lot (lot pitch `P = 72`, lots 46 m wide). Add the chosen lots to the lot-skip condition
  in `js/city.js` and call `city.crush(x, z, 34)` once per site after the city is built. Do not stand a site in the
  middle of an avenue (`AVENUES`): it would plug the colossus road. A lot beside an avenue or boulevard is ideal.
- `root.rotation.y`: A and B `0`, D and E `Math.PI` (front faces the map centre, z = 0). C `Math.PI / 2` (its door
  faces along x, so it favours neither side).
- Because roots are rotated, convert every local anchor with `root.localToWorld` (after `root.updateMatrixWorld(true)`),
  not by hand.
- The capture ring (radius 60 m) reaches about 11 m into the neighbouring lots. That is accepted; the ground rings are
  depth-tested and simply disappear under buildings.

### Colours

```js
const _k = new THREE.Color();
const K = (hex, k) => { _k.set(hex); return [_k.r * k, _k.g * k, _k.b * k]; };
const N = K(0x5c5852, 1.2), N2 = K(0x5c5852, 0.8), ND = 0x1b1a1c, NT = K(0x8c8a80, 1.2);   // neutral stone, dark stone, dark iron, pewter trim
const S = 0x0b0a09, S2 = 0x121212, hot = [2.2, 0.3, 0.1], W = 0xffffff;
```

| var | colour | used for |
|---|---|---|
| `N` | iron-grey stone 0x5c5852 x 1.2 | walls, piers, shaft, hall |
| `N2` | the same x 0.8 | reserved for darker masonry (not used below; keep for tuning) |
| `ND` | dark iron 0x1b1a1c | bands, fins, feet, masts, breeches |
| `NT` | pewter 0x8c8a80 x 1.2 | string courses, caps, collars (deliberately not brass and not olive) |
| `S`, `S2` | soot 0x0b0a09, gunmetal 0x121212 | mouths, doors, stacks, barrels |
| `hot` | [2.2, 0.3, 0.1] | manufactorum furnace vents only |
| `W` | white | every vertex of the owner-coloured meshes (the colour comes from the material) |

**Owner colour table.** `o` = owner state: `-1` neutral, `0` Karnite Vigil, `1` Pyre Synod. All faction values come
from `PAL` in `js/util.js` and `ZC` in `js/main.js`.

| slot | neutral | Vigil (side 0) | Synod (side 1) | applied to |
|---|---|---|---|---|
| `LIV` (livery paint) | 0x2e2c2a bare iron | `K(PAL[0].trim, 1.5)` brass | `K(PAL[1].hull, 1.6)` oxblood | `livery` material colour, standard block |
| `OG` (owner glow) | [0.5, 0.48, 0.42] dim bone | `PAL[0].glow` amber [2.2, 1.3, 0.35] | `PAL[1].glow` green [0.4, 2.1, 0.35] | `ownerGlow`, halos, portcullis, beacon |
| `RC` (ground ring) | [0.75, 0.72, 0.62] | `ZC[0]` [2.0, 1.2, 0.35] | `ZC[1]` [0.45, 2.0, 0.4] | dashed ring, progress ring, anchor pulse, tethers, markers |
| HUD / auspex CSS | `#b8b0a0` | `#ffb23c` | `#5cff6a` | pips, auspex rings and glyphs |

Ownership is double-coded: plate colour (dark iron / light brass / dark red) and glow colour (pale / amber / green).

### Materials

- `body`: one shared `MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 })` (same recipe as the
  bastion body).
- `fixedGlow`: one shared `MeshBasicMaterial({ vertexColors: true, toneMapped: false })` (manufactorum vents only).
- **Per site instance**, no vertex colours needed in practice (all vertices are `W`):
  - `liveryMat`: `MeshStandardMaterial({ roughness: 0.8, metalness: 0.15 })`, colour = `LIV[o]`.
  - `glowMat`: `MeshBasicMaterial({ toneMapped: false })`, colour = `OG[o]`.
  - `stdMat` (standard block paint, standard recipe as `liveryMat`) and `stdGlowMat` (basic), colour by the sign of
    progress (section 3).
  - `beaconMat`: `MeshBasicMaterial({ toneMapped: false })`.
- Colour changes are lerped over 0.6 s, never snapped, except contested flashes.
- Geometries are built once and shared by every site of the same type.

## 3. Shared kit (every site)

State inputs from gameplay: `p` = progress (-100..+100), `o` = owner (-1, 0, 1), `contested` (bool).
`cs` = capturing side = `p > 0 ? 0 : 1` (Vigil is positive); `f = Math.abs(p) / 100`.

### 3.1 The standard (capture progress in 3D)

A mast with a square lantern block that climbs it. The block is four-sided, so it reads the same from every bearing.

Mast-local, origin at the mast foot. The mast itself is part of the site's `body` geometry (listed in each part list):
`box(1.8, 26, 1.8, mx, my + 13, mz, ND)`.

| node / mesh | parent | geometry (node-local) | material |
|---|---|---|---|
| `std` (Group) | site root, at mast foot + (0, 6.5 + 14 * f, 0) | - | - |
| `stdBlock` | `std` | `box(7, 11, 7, 0, 0, 0, W)` | `stdMat` |
| `stdGlow` | `std` | four lozenges: `box(4, 4, 0.5, 0, 0, +-3.6, W, 0, 0, q)` and `box(0.5, 4, 4, +-3.6, 0, 0, W, q, 0, 0)` | `stdGlowMat` |
| `beacon` | site root, at mast foot + (0, 27.5, 0) | `box(3.5, 3.5, 3.5, 0, 0, 0, W, q, 0, q)` (a cube on its corner) | `beaconMat` |

Mast foot per type: gate (0, 58.5, 0); anchor (0, 66, 0); manufactorum (-18, 33, 14).

| state | standard block | beacon |
|---|---|---|
| `p = 0`, neutral | at the foot (`f = 0`), `stdMat = LIV[-1]`, `stdGlowMat = OG[-1]` | `OG[-1] x 0.6`, steady |
| capturing or decaying (`0 < f < 1`) | height follows `f`; `stdMat = LIV[cs]`, `stdGlowMat = OG[cs] x (0.7 + 0.3 * sin(time * 6))`; while `f` is changing, the block shudders: `std.position.x = 0.15 * sin(time * 40)` | unchanged from its last owned / neutral state |
| owned (`o >= 0`, `f = 1`) | locked at the top, glow steady `OG[o]` | `OG[o] x (1.6 + 0.3 * sin(time * 2))` |
| contested | frozen where it is; glow steady | flashes white `[3, 3, 3]` and black at 3 Hz |

The block colour follows the sign of `p`, not the owner. A Vigil site being taken shows a brass block sinking to the
foot, then an oxblood block climbing.

### 3.2 Ground marking: the capture ring

All at unit radius, scaled by `CAP_R = 60` (use the gameplay constant), laid flat with `rotateX(-Math.PI / 2)`, children
of the site root. Material for all three: `MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending,
depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 })`, one
instance per mesh. Depth test stays on.

| mesh | geometry (shared) | y | idle look |
|---|---|---|---|
| `ringEven`, `ringOdd` | 24 dashes on the boundary: dash `k` = `RingGeometry(0.977, 1, 4, 1, k * PI / 12, PI / 18)` (10 degrees of arc, 5 degrees of gap, band 1.4 m). Merge the 12 even dashes into one geometry and the 12 odd into another. 96 tris each. | 0.45 | both `RC[o]`, opacity `0.75 + 0.15 * sin(time * 1.5)`, not rotating |
| `ringProg` | `RingGeometry(0.90, 0.94, 96, 1)` (band 54 to 56.4 m). Progress is shown with `geometry.setDrawRange(0, Math.round(96 * f) * 6)`; give each site its own clone of the geometry (or its own `drawRange`) so sites do not share the range. 192 tris. | 0.4 | colour `RC[cs]`; opacity 0.9 while `0 < f < 1`, 0.45 when owned (full ring), hidden at `f = 0` |

The dashed boundary with no fill is what separates a capture ring from the solid, filled fire-zone rings of
`hardpoints-visual.md` section 8.2.

### 3.3 Contested state (both sides inside the ring)

- `ringEven` takes `RC[0]` (Vigil amber) and `ringOdd` takes `RC[1]` (Synod green); both rotate together at
  0.6 rad/s (`rotation.y`), opacity `0.6 + 0.4 * (sin(time * 19) > 0)` (3 Hz hard blink).
- `ringProg` keeps its colour and length and blinks in antiphase.
- Beacon flashes white at 3 Hz (3.1). The standard block is frozen.
- Every 0.5 s, if `fx.camDist` to the beacon is under 400: `fx.sparks(bx, by - 4, bz, 4, 14, 3, 3, 3, 0.5)`.
- No sound, no announcement beyond the HUD (section 8).

### 3.4 Capture and loss moments

| event | effect |
|---|---|
| site taken (`f` reaches 1) | `fx.flash(beacon, OG[o], 5000, 0.4, 400)`; both dashed rings pop `scale` 60 -> 65 -> 60 over 0.4 s at opacity 1; livery and glow lerp to the owner over 0.6 s |
| site neutralised (`p` crosses 0) | livery and glow lerp back to neutral over 0.6 s; beacon to `OG[-1] x 0.6`; type effects stop (halos, smoke boost, lamps) |
| shot hits a site | sites are indestructible: `fx.sparks(pt, 5, 16)` only, no scorch, no damage state |

### 3.5 Collision (movers and shots)

Axis-aligned in site-local space; half-extents in metres. C is turned 90 degrees, so its box is square on purpose.

| type | ground footprint (half x, half z) | solid volumes for shots and line of sight |
|---|---|---|
| gate | 23, 15 | box x +-22, z +-13, y 0..58 (the mouth is solid: nothing walks through) |
| anchor | 20, 20 | box x +-15, z +-15, y 0..12; vertical cylinder radius 5, y 12..66 |
| manufactorum | 23, 23 | box x +-23, z +-19 (site-local), y 0..33; cylinder radius 14 at local (0, 2), y 33..52 |

Masts, halos, barrels and stacks do not block shots.

## 4. Reinforcement gate (A, E)

A muster arch over a lift shaft from the undercity. 46 primitives, about 590 tris, 11 draw calls with the rings.
Piers x 9..22, mouth x -9..9 and 40 m tall, lintel y 46..56, parapet band to 58.5, winch drums to 66.5, mast top 84.5,
beacon 86.

```js
// body (22 primitives, about 304 tris)
for (const s of [-1, 1]) gate.box(13, 46, 26, s * 15.5, 23, 0, N)        // piers, y 0..46
  .box(15, 8, 28, s * 15.5, 4, 0, ND)                                    // battered feet
  .box(13.6, 1.4, 26.6, s * 15.5, 30, 0, NT)                             // string course
  .box(4, 30, 5, s * 19.5, 15, 15.5, ND, -0.3)                           // front buttress fin
  .box(4, 30, 5, s * 19.5, 15, -15.5, ND, 0.3)                           // rear buttress fin
  .box(6, 4, 3, s * 19, 60.5, 12.5, N)                                   // merlons, top 62.5
  .box(6, 4, 3, s * 19, 60.5, -12.5, N)
  .cyl(4, 4, 12, s * 12, 62.5, 0, ND, 0, 0, hp, 8);                      // winch drums lying along x
gate.box(44, 10, 26, 0, 51, 0, N)                                        // lintel, y 46..56
  .box(46, 2.5, 28, 0, 57.25, 0, ND)                                     // parapet band, y 56..58.5
  .box(18, 6, 26, 0, 43, 0, N)                                           // mouth header, y 40..46
  .box(18, 40, 20, 0, 20, -2, S)                                         // soot slab filling the mouth, front face z 8
  .box(18, 0.8, 12, 0, 0.4, 19, ND)                                      // threshold apron
  .box(1.8, 26, 1.8, 0, 71.5, 0, ND);                                    // mast, y 58.5..84.5

// livery (6 primitives), liveryMat
for (const z of [13.3, -13.3]) gateLivery.box(9, 16, 0.8, 15.5, 36, z, W).box(9, 16, 0.8, -15.5, 36, z, W)   // pier shields
  .box(30, 5, 0.8, 0, 51, z, W);                                         // lintel frieze

// ownerGlow lamps (4 primitives), glowMat
for (const s of [-1, 1]) for (const z of [13.4, -13.4]) gateLamps.box(3.2, 3.2, 0.8, s * 15.5, 22, z, W, 0, 0, q);

// gateBars (7 primitives), glowMat, own node so it can rise
for (const x of [-6, -3, 0, 3, 6]) gateBars.box(1.2, 36, 0.5, x, 19, 8.4, W);   // portcullis bars, y 1..37
gateBars.box(17, 1, 0.5, 0, 12, 8.4, W).box(17, 1, 0.5, 0, 26, 8.4, W);

// gateFlood (1 primitive): box(17, 38, 0.3, 0, 19.5, 8.2, W)
```

- `gateFlood` material: `MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, toneMapped: false })`, colour `OG[o]`.
- Low read for a Kestrel: the portcullis is 17 x 36 m of glowing bars in the owner colour, 4.6 m back inside the
  mouth. Neutral gates show dim bone bars.
- Anchors (site-local): `anchor_spawn` (0, 0, 26), units leave heading +z; `anchor_mouth` (0, 12, 9) for effects.

### Spawn effect (every 60 s while owned; also used when an allied Kestrel respawns here)

`t` = seconds relative to the spawn instant.

| t | effect |
|---|---|
| -5 to 0 | warning: the four pier lamps blink (own mesh visibility, 4 Hz). Glow colour stays `OG[o]`. |
| -1.2 to 0 | `gateBars.position.y` 0 -> 20 (ease out). The top of the bars slides up inside the header and lintel and is hidden; a 21 m opening remains under them. `gateFlood` opacity 0 -> 0.8. |
| 0 | units appear at `anchor_spawn`. `fx.flash(mouth, OG[o], 3000, 0.3, 250)`, `fx.dust(sx, 1, sz, 5, 8)`, `fx.sparks(mouth, 6, 18, OG[o], 0.6)`. |
| 0 to 2.5 | bars held up, flood 0.8 with flicker `x (0.85 + 0.15 * sin(time * 30))`. |
| 2.5 to 3.3 | bars drop back to 0 (ease in), `fx.dust` at the threshold when they land, flood fades to 0. |

A neutral gate never opens.

## 5. Ward anchor (B, D)

A grounded needle that feeds the wards around it. 44 primitives, about 530 tris, up to 15 draw calls with rings, pulse
and tethers. Base 40 x 40, shaft y 12..62 (10.6 m square at the foot, 4.5 m at the top), collar to 66, mast top 92,
beacon 93.5. Halos at y 50 (14 m apothem) and y 58 (9 m apothem).

```js
// body (12 primitives, about 150 tris)
anchor.box(40, 5, 40, 0, 2.5, 0, ND)                                     // plinth, y 0..5
  .box(30, 7, 30, 0, 8.5, 0, N)                                          // second tier, y 5..12
  .box(31.2, 1.4, 31.2, 0, 12.7, 0, NT)                                  // tier cap
  .cyl(3.2, 7.5, 50, 0, 37, 0, N, 0, q, 0, 4)                            // the needle: square taper, flats on the axes, y 12..62
  .box(9.4, 1.2, 9.4, 0, 28, 0, NT)                                      // shaft bands
  .box(7.5, 1.2, 7.5, 0, 44, 0, NT)
  .box(5, 4, 5, 0, 64, 0, ND)                                            // collar, y 62..66
  .box(1.8, 26, 1.8, 0, 79, 0, ND);                                      // mast, y 66..92
for (const sx of [-1, 1]) for (const sz of [-1, 1]) anchor.pyr(6, 16, sx * 16, 5, sz * 16, N);   // corner spikes, apex 21

// livery (5 primitives), liveryMat
for (const s of [-1, 1]) anchorLivery.box(14, 5, 0.6, 0, 8.5, s * 15.2, W).box(0.6, 5, 14, s * 15.2, 8.5, 0, W);   // tier plates
anchorLivery.box(8.6, 8, 8.6, 0, 36, 0, W);                              // sleeve round the shaft, y 32..40

// ownerGlow (5 primitives), glowMat
for (const s of [-1, 1]) anchorGlow.box(2.4, 8, 0.5, 0, 18, s * 5.2, W).box(0.5, 8, 2.4, s * 5.2, 18, 0, W);   // shaft-foot slits, y 14..22
anchorGlow.box(5.6, 1.6, 5.6, 0, 64, 0, W);                              // collar ring

// halos (8 primitives each), own nodes, haloMat (per instance MeshBasicMaterial, toneMapped false)
for (let k = 0; k < 8; k++) { const a = k * q;
  halo1.box(11.6, 1.6, 1.6, Math.sin(a) * 14, 0, Math.cos(a) * 14, W, 0, a, 0);   // node at (0, 50, 0)
  halo2.box(7.5, 1.3, 1.3, Math.sin(a) * 9, 0, Math.cos(a) * 9, W, 0, a, 0);      // node at (0, 58, 0)
}
```

The halos float free of the shaft (no spokes); that gap is the type's signature.

| state | halos |
|---|---|
| neutral | parked, not turning, colour `OG[-1] x 0.5` (dull bone rings) |
| owned | `halo1.rotation.y += dt * 0.3`, `halo2.rotation.y -= dt * 0.5`; `halo1.position.y = 50 + 0.8 * sin(time * 1.1)`, `halo2.position.y = 58 + 0.6 * sin(time * 1.1 + 1.6)`; colour `OG[o] x (1.2 + 0.2 * sin(time * 3))` |
| contested | spin stops; colour flickers `x (0.4 + 0.6 * (sin(time * 37) > 0))` |

### Ward-boost pulse (owned only)

- **Ground pulse.** One mesh per anchor: shared `RingGeometry(0.985, 1, 96)` laid flat at y 0.5, ring material recipe
  from 3.2, colour `RC[o]`. Every 5 s, over 2.5 s with `k` 0 -> 1: `scale = 300 * k` (the gameplay boost radius),
  opacity `0.55 * (1 - k)`. Hidden between pulses. It runs down the streets and marks exactly how far the boost
  reaches. 192 tris.
- **Halo kick.** At each pulse start multiply the halo colour by 2.2 and damp back at rate 4; `fx.flash(0, 54, 0 in
  world, OG[o], 2500, 0.25, 300)`.
- **Tethers.** A pool of 3 per anchor: `CylinderGeometry(0.5, 0.5, 1, 5, 1, true)` with `rotateX(Math.PI / 2)` and
  `translate(0, 0, 0.5)`, in the scene, `frustumCulled = false`; material as the bastion `wardBeam` with colour
  `RC[o]`, opacity `0.22 + 0.08 * sin(time * 7)`. Each frame, for the three nearest owner heavies within 300 m: place
  at the anchor's world (0, 54, 0), `lookAt` the heavy's `chest()`, `scale.z` = distance. Hide unused ones. When that
  heavy has a facing rebooting, raise the tether's opacity to 0.6 so the faster reboot is visibly coming from here.
- An enemy heavy inside 300 m gets no tether and no other mark.

## 6. Artillery manufactorum (C)

A shell forge with its own siege battery. 53 primitives, about 830 tris, 14 draw calls with the rings (plus markers
while firing). Hall 44 x 36 to y 30, roof slab to 33, turntable to 38, stacks to 75. Battery pitch pivot at y 48;
barrels fixed at 60 degrees elevation, tips at y 71.

```js
// body (17 primitives, about 310 tris)
hall.box(44, 30, 36, 0, 15, 0, N)                                        // forge hall, y 0..30
  .box(46, 3, 38, 0, 31.5, 0, ND)                                        // roof slab and parapet band, y 30..33
  .box(44.8, 1.4, 36.8, 0, 18, 0, NT)                                    // string course
  .box(14, 18, 1, 0, 9, 18.2, S)                                         // loading door
  .box(17, 2.5, 1.6, 0, 19.2, 18.5, NT)                                  // door lintel
  .cyl(13, 14, 5, 0, 35.5, 2, ND, 0, 0, 0, 10)                           // battery turntable, y 33..38
  .box(1.8, 26, 1.8, -18, 46, 14, ND);                                   // signal mast, y 33..59
for (const x of [-21, -9.5, 9.5, 21]) hall.box(4, 26, 4, x, 14, 19.5, ND, -0.25);   // front fins
for (const x of [-12, 12]) hall.box(4, 26, 4, x, 14, -19.5, ND, 0.25);              // rear fins
for (const s of [-1, 1]) hall.cyl(3, 4.5, 42, s * 17, 54, -13, S, 0, 0, 0, 8)       // stacks, y 33..75
  .cyl(3.9, 3.9, 1.5, s * 17, 62, -13, NT, 0, 0, 0, 8);                             // stack bands

// livery (5 primitives), liveryMat
for (const s of [-1, 1]) hallLivery.box(7, 14, 0.8, s * 15.5, 10, 18.3, W)          // front plates beside the door
  .box(0.8, 12, 12, s * 22.3, 11, 6, W);                                            // side plates
hallLivery.box(14, 12, 0.8, 0, 10, -18.3, W);                                       // rear plate

// ownerGlow (9 primitives), glowMat
for (const x of [-4, 0, 4]) hallGlow.box(1.2, 14, 0.5, x, 8, 18.9, W);              // door bars
for (const s of [-1, 1]) hallGlow.box(0.5, 8, 2, s * 22.3, 24, 8, W).box(0.5, 8, 2, s * 22.3, 24, -8, W)   // side slits
  .box(2, 8, 0.5, s * 4, 24, -18.3, W);                                             // rear slits

// fixedGlow (2 primitives): furnace vents, always lit whatever the owner
for (const s of [-1, 1]) hallHot.box(0.6, 6, 8, s * 22.3, 8, -12, hot);

// batYaw (3 primitives), body material; node at (0, 38, 2), rotation.y = yaw
batYaw.box(20, 8, 14, 0, 4, 0, N)                                        // cradle, y 0..8
  .box(3, 12, 10, 11, 8, 0, ND).box(3, 12, 10, -11, 8, 0, ND);           // trunnion cheeks

// batPitch (7 primitives), body material; node on batYaw at (0, 10, 0), rotation.x = -1.05 (fixed)
batPitch.box(18, 8, 8, 0, 0, -2, ND);                                    // breech
for (const x of [-6, 0, 6]) batPitch.cyl(2.4, 3, 26, x, 0, 14, S2, hp, 0, 0, 8)     // three mortar barrels, z 1..27
  .cyl(3.4, 3.4, 2.5, x, 0, 26, NT, hp, 0, 0, 8);                                   // muzzle collars

// batGlow (3 primitives), chargeMat; on batPitch
for (const x of [-6, 0, 6]) batGlow.box(6.6, 6.6, 1, x, 0, 9, W);        // charge collars round each barrel
```

- `chargeMat`: `MeshBasicMaterial({ color: 0x000000, toneMapped: false })`, one per site.
- Muzzle anchors on `batPitch`: `anchor_mz0..2` at (-6, 0, 27.5), (0, 0, 27.5), (6, 0, 27.5).
- Battery yaw: free 360 degrees, slew 0.4 rad/s. Rest pose: yaw 0 when neutral; when owned, it idles pointing at the
  enemy bastion. Clearances checked on paper: cradle and cheeks sweep a 13.5 m radius, the mast block is 16.7 m out
  and the stacks 18 m out.
- **Ambient.** `fx.addEmitter(x, 77, z, 2.6, Infinity, true)` above each stack (world position from the local
  (+-17, 77, -13)), always on. While owned, raise both emitters' `size` to 3.4. The furnace vents stay hot in every
  state: the forge always runs, the guns answer to whoever holds it.

### Barrage (every 45 s while owned)

`t` = seconds from the first shot. Shell `i` (0..5) fires at `t = 0.25 * i` from barrel `i % 3` and lands exactly 3 s
later, so every marker is on the ground for the 3 s the gameplay spec asks for.

| t | effect |
|---|---|
| -4 to 0 | battery slews to the target bearing. `chargeMat.color = OG[o] x 1.4 * k * k` with `k` 0 -> 1. |
| 0 | announce `ARTILLERY INBOUND` if the player is the target (gameplay). |
| each shot | from `m` = that barrel's muzzle anchor, `d` = barrel direction: `fx.muzzle(m, d, 4, 3, 1.7, 0.6)`, `fx.flash(m.x, m.y, m.z, 3, 1.7, 0.6, 4000, 0.12, 300)`, three `fx.smoke` back-blast puffs at the breech, `G.sfx.boom(fx.camDist(m.x, m.y, m.z), 2)`. Outbound shell: `fx.tracer(m.x, m.y, m.z, m.x + d.x * 400, m.y + d.y * 400, m.z + d.z * 400, 300, 24, 1.6, 3, 1.7, 0.6)`. Recoil: push `batPitch` 2.5 m back along its own z and damp home at rate 5. `chargeMat` flashes `OG[o] x 4` and decays to black over 0.4 s after the sixth shot. The marker for shell `i` appears now. |
| impact - 0.6 | inbound shell: `fx.tracer(ix + rr(-30, 30), 400, iz + rr(-30, 30), ix, 0, iz, 650, 30, 1.8, 3, 1.7, 0.6)` so it arrives on time. |
| impact | `fx.explosion(ix, 1, iz, 3.5)`, `fx.dust(ix, 1, iz, 6, 8)`, `fx.debris(ix, 2, iz, 6, 1.4, 24, 0.08)`, `G.shakeAt(ix, 0, iz, 4)`. Remove the marker. |

If gameplay has not fixed the impact pattern: one shell on the target point and five on a ring of radius 22 m round it,
the ring turned by a random angle per barrage.

### Target marker (one per shell, pool of 6)

Colour is the **firing side's** `RC[o]`, so the player reads "ours" (amber) or "theirs" (green) at once. Ring material
recipe from 3.2. `u` = 0 -> 1 over the marker's 3 s.

| part | geometry | behaviour |
|---|---|---|
| kill ring | `RingGeometry(0.88, 1, 32)` flat at y 0.6, `scale = 8` (the 8 m kill radius) | opacity blinks 0.4 / 1.0, blink rate rising from 2 Hz to 8 Hz: `sin(time * (12 + 38 * u)) > 0` |
| closing ring | same geometry, `scale = 8 * (3 - 2 * u)` (24 m closing to 8 m) | opacity `0.3 + 0.5 * u`; it meets the kill ring at impact |
| cross | two flat boxes `box(16, 0.1, 0.8)` and `box(0.8, 0.1, 16)` at y 0.6 | steady, opacity 0.8 |
| drop line | `CylinderGeometry(0.4, 0.4, 120, 5, 1, true)` standing on the point (centre y 60), additive, `depthWrite: false` | opacity `0.15 + 0.35 * u`; this is what a colossus pilot sees over rooftops and a Kestrel sees from the street |
| last 0.5 s | - | everything turns white `[3, 3, 3]` |

About 100 tris per marker.

## 7. Budget

| site | primitives | tris (est.) | draw calls incl. 3 ring meshes |
|---|---|---|---|
| reinforcement gate | 46 | 590 | 11 (body, livery, lamps, bars, flood, std block, std glow, beacon, rings) |
| ward anchor | 44 | 530 | 12, plus pulse 1 and tethers up to 3 |
| artillery manufactorum | 53 | 830 | 14, plus up to 6 markers while firing |
| rings per site | - | 384 | (counted above) |

All five sites: about 3,070 tris of structure plus 1,920 of rings; about 60 draw calls. Under the 60-primitive limit per
site. Leave `frustumCulled` at its default on structure meshes; set it false only on tethers.

## 8. HUD and auspex

House style from `hardpoints-visual.md` section 8: Consolas, amber HUD `#ffb648` for chrome, phosphor for plots.
Objective colours are the faction colours, not ally / foe: neutral `#b8b0a0`, Vigil `#ffb23c`, Synod `#5cff6a`.

### 8.1 Type glyphs

Drawn on a 16 x 16 grid, stroke only, 1.5 px line at 16 px size, round joins, no fill. Use the same path data as an
inline SVG `path` in the strip and as canvas `moveTo` / `lineTo` on the auspex and Tab map.

| type | path (16 x 16) | reads as |
|---|---|---|
| gate | `M3 14 V3 H13 V14 M6 14 V7 H10 V14` | an arch: outer frame with a doorway |
| anchor | `M8 1 L11 12 H5 Z M3 6 H13 M4 14 H12` | a needle crossed by a halo bar, on a base line |
| artillery | `M3 13 L8 3 M6.5 13 L11.5 3 M10 13 L15 3 M1 14.5 H15` | three raised barrels on a base line |

### 8.2 Objective pip strip (top centre)

- Container: centred horizontally, top 12 px, a row of five pips in order A B C D E, 10 px gaps.
- **Pip:** 38 x 48 px plate, background `rgba(10,6,2,0.7)`, border 1.5 px. Inside: the type glyph at 20 px in the top
  30 px, the letter (12 px bold, letter-spacing 0.1em) in the bottom 16 px.
- **Progress fill:** a block rising from the bottom of the plate behind the glyph and letter, height `f x 100%`, colour
  of the capturing side at 0.35 alpha.

| state | border | glyph and letter | fill |
|---|---|---|---|
| neutral, untouched | `rgba(184,176,160,0.5)` | `#b8b0a0` | none |
| being captured / decaying | capturing side colour at 0.7 alpha | `#b8b0a0` if no owner, else owner colour | `f`, capturing side colour |
| owned | 2 px owner colour, 6 px outer glow in the same colour at 0.5 alpha | owner colour | full, owner colour at 0.28 alpha |
| contested | border and glow alternate `#ffb23c` / `#5cff6a` at 3 Hz (CSS keyframes, `steps(1)`) | unchanged | frozen |
| just flipped | plate flashes white for 0.15 s, scales 1.25 -> 1 over 0.3 s | - | - |

- **Timer bar:** under an owned gate or artillery pip, a 38 x 2 px bar in the owner colour filling left to right over
  the 60 s / 45 s cycle. Not shown for anchors or unowned sites.
- **Win-gate counters:** left of the strip, 14 px away: `VIGIL 2/5` (12 px, `#ffb23c`, letter-spacing 0.2em). Right of
  the strip: `SYNOD 1/5` in `#5cff6a` at 60% alpha. When a side holds 3 or more its counter goes to full alpha with a
  1 px border and 4 px padding in its colour; if that side is the enemy, the counter also blinks at 2 Hz (your
  generator is exposed).
- In the Tab tactical view the strip stays at full alpha (exempt from the 45% dim, like the armament panel).

### 8.3 Auspex and Tab tactical map

For each site in range:

- **Ring:** a solid 2 px circle at the true 60 m radius in plot scale, owner colour at 0.85 alpha, no fill.
- **Progress arc:** a 3 px arc 3 px inside the ring, starting at plot north and running clockwise through `f x 360`
  degrees, capturing side colour. Not drawn at `f = 0`; drawn full at 0.5 alpha when owned.
- **Centre:** a filled disc `rgba(2,14,8,0.85)` of radius 9 px with the type glyph at 14 px in the owner colour, and
  the letter (8 px bold) just outside the disc at its upper right.
- **Contested:** ring colour alternates `#ffb23c` / `#5cff6a` at 3 Hz.
- **Draw order:** above buildings, below units, locks and threat pings.
- **Out of range (small auspex only):** the letter alone (9 px bold, owner colour) pinned 10 px inside the rim on the
  site's bearing.
- **Tab map:** glyph, disc and letter x 1.6 as every other glyph there. Hovering the cursor within 14 px of a site
  centre shows a tooltip chip in the existing tooltip style, one line:

| type | tooltip |
|---|---|
| gate | `REINFORCEMENT GATE A  -  SYNOD  -  TANK + SQUAD EVERY 60 S, KESTRELS RESPAWN HERE` |
| anchor | `WARD ANCHOR B  -  NEUTRAL  -  WARD REGEN x1.5 AND REBOOT -40% WITHIN 300 M` |
| artillery | `ARTILLERY MANUFACTORUM C  -  VIGIL  -  6-SHELL BARRAGE EVERY 45 S` |

  The middle word is the current owner (`NEUTRAL`, `VIGIL`, `SYNOD`) or `CONTESTED`.

- **Anchor range on the Tab map only:** for anchors the player's side owns, a 1 px dashed (2/6) circle at 300 m in the
  owner colour at 0.35 alpha.
- **Artillery markers on both plots:** each live target marker is a 5 px cross in the firing side's colour, blinking at
  4 Hz.

## 9. Sketches (schematic, not to exact scale)

```
   m      GATE (front)               ANCHOR (any side)             MANUFACTORUM (front)
  94                                       <>  beacon
  86            <>  beacon                 |
  75            |                          |[#] standard                  ||          ||   stacks
  66       (==)[#](==)  winches, std       H    collar            //  //  //          ||
  58    n_______|_______n               -o-+-o-  halo 2          //  //  //   barrels ||   <> beacon
  50    |   [ frieze ]  |             --o--+--o--  halo 1       //  //  //  60 deg    ||   |
  40    |[]  .------. []|                 /#\  sleeve          [=========]  cradle    ||  [#] standard
  33    |[]  | |||| | []|                / | \                 _(_________)___________||___|_
  22    | <> | |||| | <>|     /\        / i \        /\       |  i    i   .----.   i    i   |
  12    |    | |||| |   |    /  \  ____/__i__\____  /  \      |  [#]      | ||| |      [#]  |
   0   /|____|_||||_|___|\  /____\|_______________|/____\     |/___/_____|_|||_|_____\___\_|
        x -22   mouth   +22        x -20         +20           x -23      door          +23
```

## 10. Build notes for the implementer

- One `buildParts()` in `js/objectives.js` returning the geometries named above (`gate`, `gateLivery`, `gateLamps`,
  `gateBars`, `gateFlood`, `anchor`, `anchorLivery`, `anchorGlow`, `halo1`, `halo2`, `hall`, `hallLivery`, `hallGlow`,
  `hallHot`, `batYaw`, `batPitch`, `batGlow`, plus the shared `stdBlock`, `stdGlow`, `beacon`, `ringEven`, `ringOdd`,
  `ringProg`, `pulse`, marker parts), built once. Sites are faction-neutral, so there is no per-side geometry.
- One function `applyOwner(site)` sets `liveryMat`, `glowMat`, halo and ring colours from the table in section 2 and is
  the only place colours are chosen; call it when `o`, `cs` or `contested` changes, and lerp toward its targets.
- Update visuals every frame (cheap), even though capture logic runs at 2 to 5 Hz: lerp the displayed `f` toward the
  gameplay value at rate 6 so the standard and the progress ring move smoothly.
- Nothing here needs a change to `Builder`, `PAL`, `Fx` or the bastion. The only edits outside the new module are the
  lot-skip condition and `crush` calls in `js/city.js`, and the HUD / auspex drawing.
- For `?shot=objectives`: Tab view open, with one site contested (rings alternating amber / green and turning), one
  Vigil-owned and one mid-capture, so the strip shows all four pip states.
