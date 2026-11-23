# Bastion, ward generator and bastion guns: visual build spec

Companion to section 5 of `model/heavy-combat-spec.md` (gameplay: 8000 HP bastion, 1600 HP ward generator, 2 lance turrets
at 600 HP, 4 autocannon turrets at 300 HP). This file is the complete visual build: every primitive, pivot, anchor,
destruction state and collision box. Build it with the `Builder` helper in `js/util.js` only (no GLB, no Blender), the way
`buildParts` in `js/colossus.js` builds the great colossi. Original design; nothing here is taken from any existing
franchise. Every part list below was run through a triangle and bounds counter; the numbers in section 11 are measured, not
estimated.

## 1. Silhouette intent

### Bastion

- **A stepped iron ziggurat, wider than it is tall.** 190 m across the corner towers, 116 m deep, three tiers: a 48 m
  curtain block, a 78 m inner ward, a 127 m keep, and a crown to 167 m (Synod) or 175 m (Vigil). The city is all narrow
  verticals (lots are 46 m wide; hero spires are 150 to 270 m tall but only 30 to 46 m wide). The bastion is four lots wide
  and reads as one horizontal mass. That is the main thing that separates it from "another city block".
- **Fortress cues the city never uses:** sloped glacis plates around the foot, four round drum towers at the corners (the
  city has only square piers), crenellated parapets on every tier, leaning buttress fins, one huge gate with a glowing
  portcullis, faction hull colour instead of grey stone, no window pattern (the city shader's lit windows are absent), and
  guns on the skyline.
- **Scale against the engines.** A Hierarch (63 m) can just look over the gatehouse parapet (61 m) and stands below the
  autocannon towers (turret tops 81 m). A great colossus (about 125 m) is level with the keep's mural crown (127 m). The
  bastion is three Hierarchs wide and two and a half tall.
- **Read at 700 m** (fog is about half strength there, 1 m is about 1 px): the stepped outline against the sky, the two-
  pronged or horned crown, the 20 x 30 m glowing gate grille with the 13 m lozenge above it, the dome rim and the ward beam.
  Nothing smaller than 8 m is relied on at that range.
- **Read at 100 to 300 m:** glacis, buttresses, merlons (8 m), litany plates, glow slits, turrets tracking.
- **Faction difference:** shared body, different crown and gate-pylon caps. Vigil: a twin-prong "watch fork" holding a lamp,
  pyramid pylon caps, two searchlights. Synod: a stepped pyre with a horned brazier bowl that burns permanently, brazier
  bowls on the gate pylons.

### Ward generator

- **A machine, not a building.** An octagonal stepped drum with four jointed claws that lean out and then curl in over a
  floating, spinning star of light. 46 m across, 61 m tall (Hierarch height, so a Hierarch can reach the core), open and
  spidery where the bastion is solid.
- A steady beam runs from its core up to the bastion's crown. That beam is the tell: kill the thing the beam comes from.
- It stands outside the dome it projects, 96 m in front of the gatehouse.

### Turrets

- **Lance turret (2):** a tall box housing on a round barbette at the front corners of tier 2, with a 42 m barrel carrying
  three large disc rings and a tuning-fork muzzle. The longest, thinnest thing on the fortress; visible in silhouette at
  700 m when it turns. Charge glow between the rings and in the fork.
- **Autocannon turret (4):** a squat flat-lidded cupola with twin 16 m barrels and a transverse ammunition drum behind, one
  on each corner tower. Reads as "small, fast, twin stubs" against the lance's "one long needle".

## 2. Conventions

- **Bastion-local axes: x = the bastion's left, y = up, z = forward (toward the enemy and the map centre)**, metres, origin
  on the ground at the centre of the curtain block. Same handedness as the walkers.
- `Builder` signatures (do not change them):
  `box(w, h, d, x, y, z, color, rx, ry, rz)`, `cyl(rTop, rBottom, h, x, y, z, color, rx, ry, rz, seg = 8)`,
  `pyr(w, h, x, y, z, color, d)`. A rotation turns the primitive about its own centre before it is moved to x, y, z.
  A `cyl` with `rx = hp` lies along z with `rTop` at the +z end; with `rz = hp` it lies along x. `pyr` has its base at y
  and its apex at y + h and cannot be rotated.
- Lean signs for a slab that stands along y: `rx = +a` tips its top toward +z, `rx = -a` toward -z; `rz = +a` tips its top
  toward -x, `rz = -a` toward +x.
- `hp = Math.PI / 2`, `q = Math.PI / 4`, `o = Math.PI / 8`.
- Triangle cost: box 12, pyr 8, cyl 4 x seg.

### Placement (the build assumes this)

| | origin (world x, z) | `root.rotation.y` | `s` | ward generator (world x, z) |
|---|---|---|---|---|
| Pyre Synod (side 1) | 0, -740 | 0 | +1 | 0, -580 |
| Karnite Vigil (side 0) | 0, +740 | `Math.PI` | -1 | 0, +580 |

- A bastion-local point (x, y, z) is at world `(s * x, y, originZ + s * z)`. Use this for emitters, effects and collision.
- Centre at 740 puts the gate face at |z| = 676 and the ramp foot at 658, which is the "about 700" of the gameplay spec.
- The generator is at bastion-local (0, 0, 160): its centre is 96 m in front of the gatehouse face and 48 m outside the
  dome's front edge.
- **Clear ground.** In the lot loop of `js/city.js`, skip lots with `|i| <= 2 && |j| >= 9`, and lots with
  `|i| <= 1 && |j| === 8`. That removes 14 lots per end and leaves a plaza 242 m wide at the generator and 386 m wide at
  the bastion. After the city is built, call `city.crush(x, z, 30)` once at each generator position to flatten lane clutter.

### Colours (livery slots)

Straight from `PAL[side]` in `js/util.js`, as `colossus.js` does. Body slots are brightened by 1.2 so the mass still reads
through 700 m of fog; `dark` is left as it is.

```js
const _k = new THREE.Color();
const K = (hex, k) => { _k.set(hex); return [_k.r * k, _k.g * k, _k.b * k]; };
const C = PAL[side];
const H = K(C.hull, 1.2), H2 = K(C.hull, 0.8), D = C.dark, T = K(C.trim, 1.2), Bn = K(C.bone, 1.2);
const S = 0x0b0a09, S2 = 0x121212, S3 = [0.06, 0.055, 0.05];
const g = C.glow, gB = [g[0] * 1.5, g[1] * 1.5, g[2] * 1.5], hot = [2.2, 0.3, 0.1], W = 0xffffff;
```

| slot | var | Vigil (side 0) | Synod (side 1) | used for |
|---|---|---|---|---|
| `hull` | `H` | slate 0x46525e x 1.2 | oxblood 0x5a211a x 1.2 | tier 2, keep, gatehouse, drum towers, merlons, buttresses, turret housings |
| `hull` (masonry) | `H2` | slate x 0.8 | oxblood x 0.8 | the curtain block, so tier 1 sits darker than the tiers above; ruin stumps |
| `dark` | `D` | 0x1d2228 | 0x191414 | glacis, parapet bands, fins, piers, pylons, gun bodies |
| `trim` | `T` | brass 0x9a7a3a x 1.2 | olive 0x6c7434 x 1.2 | string courses, lintel, caps, ribs, lance rings, claws |
| `bone` | `Bn` | bone 0x9a947e x 1.2 | umber 0x3a3028 x 1.2 | litany plates, gate sigil plate, keep banner |
| `soot` | `S` | 0x0b0a09 | same | gate recess, stacks, brazier bowls, scars |
| `barrel` | `S2` | 0x121212 | same | autocannon barrels |
| `rubble` | `S3` | [0.06, 0.055, 0.05] | same | rubble heaps (the city's rubble colour) |
| `glow` | `g` | PAL[0].glow amber | PAL[1].glow green | slits, portcullis, tower lights, generator conduits, dome, beam |
| `glow_bright` | `gB` | glow x 1.5 | glow x 1.5 | gate lozenge, Vigil crown lamp |
| `glow_hot` | `hot` | [2.2, 0.3, 0.1] | same | rear reactor vents, Synod brazier bed |
| `glow_charge` | `W` | 0xffffff | same | lance glow, generator core (colour comes from the material) |

The only per-side geometry differences are the gate-pylon caps, the crown, and the lozenge on the plates and banner
(`side ? T : H`, the same rule as the colossus tabard).

### Materials and meshes

- `body`: one shared `MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 })`.
- `scorch`: one shared `MeshStandardMaterial({ vertexColors: true, color: 0x8a8078, roughness: 0.95, metalness: 0.05 })`.
  The colour multiplies the vertex colours, so swapping a mesh's material from `body` to `scorch` burns it. Used for every
  destroyed state; no second set of geometry is needed.
- `glowMat`: one shared `MeshBasicMaterial({ vertexColors: true, toneMapped: false })`.
- `lanceGlow` and `genCore`: one `MeshBasicMaterial({ color: 0x000000, toneMapped: false })` **per instance**, no vertex
  colours. The animation writes `material.color`.
- Dome: `shieldMaterial(side)` imported from `js/colossus.js`, one instance per bastion (section 7).
- Build the geometries once per side and share them. One merged geometry per node per material.

## 3. Node tree, pivots and anchors

Positions are bastion-local unless a parent is named. Geometry for `gate`, `ward2` and `keep` is written in bastion-local
coordinates in section 4; after `build()`, call `geometry.translate(-px, -py, -pz)` with that node's bastion-local pivot so
the node can sink and tilt about its own base.

| node | parent | pivot in parent | bastion-local pivot | notes |
|---|---|---|---|---|
| `bastion` | scene | origin, see placement | 0, 0, 0 | `rotation.y` = 0 or pi |
| `base` (mesh) | bastion | 0, 0, 0 | 0, 0, 0 | curtain block; never moves |
| `glow` (mesh) | bastion | 0, 0, 0 | 0, 0, 0 | every fixed glow on the bastion in one mesh |
| `scar` (mesh) | bastion | 0, 0, 0 | 0, 0, 0 | hidden until 50% |
| `ruin` (mesh) | bastion | 0, 0, 0 | 0, 0, 0 | hidden until the collapse ends |
| `gate` | bastion | 0, 0, 53 | 0, 0, 53 | translate geometry by (0, 0, -53) |
| `towerFL` | bastion | 85, 0, 45 | same | `rotation.order = 'YXZ'`, `rotation.y = q` |
| `towerFR` | bastion | -85, 0, 45 | same | `rotation.order = 'YXZ'`, `rotation.y = -q` |
| `towerRL` | bastion | 85, 0, -45 | same | `rotation.order = 'YXZ'`, `rotation.y = 3 * q` |
| `towerRR` | bastion | -85, 0, -45 | same | `rotation.order = 'YXZ'`, `rotation.y = -3 * q` |
| `ac_yaw` (x4) | each tower | 0, 73, 0 | - | `rotation.y` = yaw; 0 = the tower's outward diagonal |
| `ac_pitch` | ac_yaw | 0, 4.5, 4 | - | `rotation.x = -pitch` |
| `ward2` | bastion | 0, 48, -6 | 0, 48, -6 | translate geometry by (0, -48, 6) |
| `lanceL_yaw` | ward2 | 50, 40, 20 | 50, 88, 14 | `rotation.y` = yaw; 0 = bastion forward |
| `lanceR_yaw` | ward2 | -50, 40, 20 | -50, 88, 14 | as above |
| `lance_pitch` | lance yaw | 0, 7, 4 | +-50, 95, 18 | `rotation.x = -pitch` |
| `lance_glow` (mesh) | lance_pitch | 0, 0, 0 | - | charge tell (material colour) |
| `keep` | ward2 | 0, 30, -6 | 0, 78, -12 | translate geometry by (0, -78, 12) |
| `crown` | keep | 0, 49, 0 | 0, 127, -12 | geometry is already crown-local; `rotation.order = 'YXZ'` |
| `crownGlow` (mesh) | crown | 0, 0, 0 | - | leaves with the crown |
| `ward` (mesh) | bastion | 0, 0, 6 | 0, 0, 6 | dome, `scale.set(138, 184, 106)` |
| `wardRing` (mesh) | bastion | 0, 0.4, 6 | - | ground ring, `scale.set(138, 1, 106)` |
| `generator` | scene | world, see placement | 0, 0, 160 | own root; no rotation needed (four-way symmetric) |
| `gen`, `genClaws`, `genGlow` (meshes) | generator | 0, 0, 0 | - | |
| `genCore` (mesh) | generator | 0, 47, 0 | 0, 47, 160 | spins: `rotation.y += dt * 0.8` |
| `wardBeam` (mesh) | scene | world | - | generator core to crown receptor (section 7) |

L is the bastion's left (+x), which is on the viewer's right when the viewer faces the gate.

Each tower carries its turret, and `ward2` carries the lances, the keep and the crown, so the collapse in section 9 moves
them together for free.

Rotation signs: positive `rotation.y` on a yaw node swings the barrel from +z toward +x. Positive `rotation.x` on a pitch
node tips the barrel down, so write `rotation.x = -pitch` with pitch positive upward (as the Harrow's `arm_R`). To aim,
convert the target into the yaw node's parent frame with `parent.worldToLocal`, because the tower nodes are rotated.

### Anchors (empty `Object3D`s)

| anchor | parent | local position | bastion-local at rest | use |
|---|---|---|---|---|
| `anchor_ac_a`, `anchor_ac_b` | ac_pitch | +2.2, 0, 21 and -2.2, 0, 21 | - | autocannon muzzles, fire alternately |
| `anchor_lance` | lance_pitch | 0, 0, 42 | +-50, 95, 60 | lance beam origin, charge sparks |
| `anchor_receptor` | crown | Vigil 0, 23, 0; Synod 0, 27, 0 | 0, 150, -12; 0, 154, -12 | far end of the ward beam |
| `anchor_emitter` | generator | 0, 47, 0 | 0, 47, 160 | near end of the ward beam, core explosion |
| `anchor_heart` | bastion | 0, 100, -12 | same | collapse explosions, target point for AI and HUD |

### Turret limits and motion

| | yaw range (rad) | pitch range (rad) | slew | rest pose |
|---|---|---|---|---|
| `lanceL` | -0.6 to +2.3 | -0.45 to +0.7 | 0.5 rad/s | yaw 0, pitch 0.05 |
| `lanceR` | -2.3 to +0.6 | -0.45 to +0.7 | 0.5 rad/s | yaw 0, pitch 0.05 |
| autocannon | -2.2 to +2.2 (tower-local) | -0.5 to +0.9 | 1.4 rad/s | yaw 0, pitch 0 |

- The lance limits keep the 42 m barrel out of the keep and above the gatehouse. The autocannon limits stop it firing back
  across its own fortress and keep the barrels clear of the tower collar.
- With -0.5 rad of depression from 77 m up, an autocannon cannot reach the ground closer than about 140 m from its own
  tower. That dead ground under the walls is intended; a turret that cannot bring its pitch within range does not fire.
- With no target, a turret returns to its rest pose at half slew.

## 4. Part lists: bastion

### base (612 tris)

The curtain block is solid (no courtyard). x -85 to +85, z -45 to +45, deck at y 48, merlon tops at 54. Glacis foot reaches
x +-98 and z +-58.

```js
base.box(170, 44, 90, 0, 22, 0, H2)                       // curtain block, y 0..44
  .box(176, 4, 96, 0, 46, 0, D)                           // overhanging parapet band, y 44..48
  .box(171.6, 1.6, 91.6, 0, 31, 0, T)                     // string course
  .box(62, 30, 5, 55, 13.5, 50.5, D, -0.35)               // front glacis, left of the gate
  .box(62, 30, 5, -55, 13.5, 50.5, D, -0.35)              // front glacis, right of the gate
  .box(172, 30, 5, 0, 13.5, -50.5, D, 0.35)               // rear glacis
  .box(5, 30, 92, 90.5, 13.5, 0, D, 0, 0, 0.35)           // side glacis
  .box(5, 30, 92, -90.5, 13.5, 0, D, 0, 0, -0.35);
for (const x of [-64, -48, -32, 32, 48, 64]) base.box(8, 6, 3, x, 51, 46.5, H);       // front merlons (gatehouse in the gap)
for (let x = -64; x <= 64; x += 16) base.box(8, 6, 3, x, 51, -46.5, H);               // rear merlons
for (const s of [-1, 1]) for (const z of [-16, 0, 16]) base.box(3, 6, 8, s * 86.5, 51, z, H);   // side merlons
for (const x of [-66, -38, 38, 66]) base.box(6, 26, 3, x, 31, 46.5, H);               // front buttresses, y 18..44
for (const x of [-60, -36, -12, 12, 36, 60]) base.box(6, 26, 3, x, 31, -46.5, H);     // rear buttresses
for (const s of [-1, 1]) for (const z of [-24, 0, 24]) base.box(3, 26, 6, s * 86.5, 31, z, H);  // side buttresses
for (const s of [-1, 1]) base.box(14, 20, 0.8, s * 52, 33, 45.4, Bn)                  // litany plates
  .box(3, 16, 0.5, s * 52, 33, 45.9, D)                                               // plate stripe
  .box(6, 6, 0.5, s * 52, 36, 46, side ? T : H, 0, 0, q);                             // plate lozenge
```

### gate (Vigil 172 tris, Synod 220 tris)

Gatehouse x -22 to +22, z 42 to 64, parapet at 61. Twin pylons to y 72, capped to 84 (Vigil) or 77 (Synod). Portal 24 m
wide, 34 m tall. Translate by (0, 0, -53) after building.

```js
gate.box(44, 58, 22, 0, 29, 53, H)                        // gatehouse block
  .box(48, 3, 26, 0, 59.5, 53, D)                         // parapet band, y 58..61
  .box(10, 72, 12, 22, 36, 60, D)                         // pylons
  .box(10, 72, 12, -22, 36, 60, D)
  .box(24, 34, 1, 0, 17, 64.2, S)                         // portal recess
  .box(28, 3, 1.6, 0, 35.5, 64.5, T)                      // lintel
  .box(3, 34, 1.6, 13.5, 17, 64.5, T)                     // jambs
  .box(3, 34, 1.6, -13.5, 17, 64.5, T)
  .box(18, 16, 0.8, 0, 47, 64.3, Bn)                      // sigil plate
  .box(26, 2, 18, 0, 1.2, 72.5, D, 0.14);                 // ramp, foot at z 81.5
for (const x of [-14, 0, 14]) gate.box(8, 5, 3, x, 63.5, 64.5, H);                    // merlons, top 66
for (const s of [-1, 1]) {
  if (side) gate.cyl(7, 4.5, 5, s * 22, 74.5, 60, S, 0, 0, 0, 8);                     // Synod: brazier bowls, y 72..77
  else gate.pyr(11, 12, s * 22, 72, 60, T, 13);                                       // Vigil: pyramid caps, apex 84
}
```

### tower (192 tris each, one geometry, four instances)

Tower-local, origin on the ground at the tower axis. Drum radius 18 at the foot to 16 at the top, deck at 67, turret
pedestal to 73. No merlons, so the turret can depress.

```js
tower.cyl(18, 22, 14, 0, 7, 0, D, 0, 0, 0, 10)            // battered foot, y 0..14
  .cyl(16, 18, 66, 0, 33, 0, H, 0, 0, 0, 10)              // drum, y 0..66
  .cyl(17, 17, 1.6, 0, 48, 0, T, 0, 0, 0, 10)             // band
  .cyl(18, 17, 4, 0, 65, 0, D, 0, 0, 0, 10)               // flared collar, y 63..67
  .cyl(7, 8, 6, 0, 70, 0, D, 0, 0, 0, 8);                 // turret pedestal, y 67..73
```

### ward2 (520 tris)

Tier 2: x -60 to +60, z -36 to +24, y 48 to 78, parapet at 81, merlons to 86. Two round barbettes for the lances at the
front corners. Translate by (0, -48, 6) after building.

```js
ward2.box(120, 30, 60, 0, 63, -6, H)                      // inner ward
  .box(124, 3, 64, 0, 79.5, -6, D)                        // parapet band, y 78..81
  .box(121.6, 1.6, 61.6, 0, 66, -6, T);                   // string course
for (const x of [-32, -16, 0, 16, 32]) ward2.box(8, 5, 3, x, 83.5, 24.5, H);          // front merlons
for (let x = -48; x <= 48; x += 16) ward2.box(8, 5, 3, x, 83.5, -36.5, H);            // rear merlons
for (const s of [-1, 1]) for (const z of [-26, -10]) ward2.box(3, 5, 8, s * 60.5, 83.5, z, H);  // side merlons
for (const x of [-34, -16, 16, 34]) ward2.box(5, 34, 5, x, 62, 29.5, D, -0.3);        // front buttress fins, y 45..79
for (const s of [-1, 1]) for (const z of [-24, -4]) ward2.box(5, 34, 5, s * 65.5, 62, z, D, 0, 0, s * 0.3);  // side fins
for (const x of [-40, 0, 40]) ward2.box(5, 34, 5, x, 62, -41.5, D, 0.3);              // rear fins
for (const s of [-1, 1]) ward2.cyl(10, 12, 10, s * 50, 83, 14, D, 0, 0, 0, 10)        // lance barbettes, y 78..88
  .cyl(10.6, 10.6, 1.2, s * 50, 87.4, 14, T, 0, 0, 0, 10);                            // barbette cap ring
```

### keep (352 tris)

x -28 to +28, z -34 to +10, y 78 to 122, mural crown to 127, corner piers to 132.4, merlons to 135, twin stacks to 154.
Translate by (0, -78, 12) after building.

```js
keep.box(56, 44, 44, 0, 100, -12, H)                      // keep
  .box(62, 5, 50, 0, 124.5, -12, D);                      // mural crown band, y 122..127
for (const sx of [-1, 1]) for (const z of [10, -34]) keep.box(8, 52, 8, sx * 28, 104, z, D)   // corner piers, y 78..130
  .box(9.6, 2.4, 9.6, sx * 28, 131.2, z, T);                                          // pier caps
for (const s of [-1, 1]) keep.box(10, 8, 4, s * 12, 131, 11, H)                       // front merlons (gap at x 0 for the beam)
  .box(10, 8, 4, s * 12, 131, -35, H)                                                 // rear merlons
  .box(4, 8, 10, s * 29, 131, -20, H)                                                 // side merlons
  .box(4, 8, 10, s * 29, 131, -4, H);
keep.box(20, 36, 0.8, 0, 100, 10.4, Bn)                   // great banner plate
  .box(4, 30, 0.5, 0, 100, 10.9, D)                       // banner stripe
  .box(10, 10, 0.5, 0, 108, 11, side ? T : H, 0, 0, q);   // banner lozenge
for (const x of [-16, 0, 16]) keep.box(3, 40, 2, x, 100, -35, T);                     // rear reactor ribs
for (const s of [-1, 1]) keep.cyl(3, 4, 32, s * 18, 138, -28, S, 0, 0, 0, 8);         // exhaust stacks, y 122..154
```

### crown (Vigil 64 + 12 tris, Synod 104 + 12 tris)

Crown-local: origin at bastion-local (0, 127, -12), the centre of the keep roof.

```js
if (!side) {                                              // KARNITE VIGIL: the watch fork, tips at 175 m
  crown.box(34, 4, 14, 0, 2, 0, D)                        // plinth
    .box(6, 34, 8, 12, 21, 0, D)                          // prongs, local y 4..38
    .box(6, 34, 8, -12, 21, 0, D)
    .pyr(6, 10, 12, 38, 0, T, 8)                          // prong tips
    .pyr(6, 10, -12, 38, 0, T, 8)
    .box(30, 3, 5, 0, 14, 0, T);                          // crossbar
  crownGlow.box(8, 8, 8, 0, 23, 0, gB, q, 0, q);          // the lamp: a cube on its corner, bastion y 150
} else {                                                  // PYRE SYNOD: the stepped pyre, horn tips at 167 m
  crown.box(30, 10, 30, 0, 5, 0, D)                       // lower step
    .box(20, 10, 20, 0, 15, 0, H)                         // upper step
    .cyl(13, 8, 6, 0, 23, 0, S, 0, 0, 0, 8)               // brazier bowl, local y 20..26
    .box(3, 20, 3, 12, 30, 0, T, 0, 0, -0.3)              // four horns leaning outward
    .box(3, 20, 3, -12, 30, 0, T, 0, 0, 0.3)
    .box(3, 20, 3, 0, 30, 12, T, 0.3)
    .box(3, 20, 3, 0, 30, -12, T, -0.3);
  crownGlow.box(16, 1.5, 16, 0, 25.6, 0, hot);            // ember bed in the bowl
}
```

### glow (468 tris, one mesh for the whole bastion, bastion-local)

```js
for (const x of [-8, -4, 0, 4, 8]) glow.box(1.2, 30, 0.5, x, 16, 64.9, g);            // portcullis bars
glow.box(22, 1, 0.5, 0, 10, 64.9, g)                      // portcullis crossbars
  .box(22, 1, 0.5, 0, 22, 64.9, g)
  .box(9, 9, 0.6, 0, 47, 64.9, gB, 0, 0, q);              // gate lozenge, 12.7 m point to point
for (const x of [-76, -31, 31, 76]) glow.box(1.6, 9, 0.5, x, 38, 45.3, g);            // curtain slits, front
for (const s of [-1, 1]) for (const z of [-12, 12]) glow.box(0.5, 9, 1.6, s * 85.3, 38, z, g);  // curtain slits, sides
for (const s of [-1, 1]) glow.box(14, 5, 0.6, s * 24, 37, -45.3, hot);                // rear wall vents
for (const x of [-25, 25]) glow.box(2.4, 14, 0.5, x, 64, 24.3, g);                    // tier 2 lancets
glow.box(2.4, 14, 0.5, -7, 64, 24.3, g)                   // tier 2 triple lancet over the gate
  .box(2.4, 14, 0.5, 7, 64, 24.3, g)
  .box(3, 18, 0.5, 0, 66, 24.3, g);
for (const s of [-1, 1]) glow.box(3, 26, 0.6, s * 16, 102, 10.3, g)                   // keep great lancets, front
  .box(0.6, 22, 3, s * 28.3, 102, -4, g)                                              // keep lancets, sides
  .box(0.6, 22, 3, s * 28.3, 102, -20, g)
  .box(10, 24, 0.6, s * 8, 100, -34.3, hot);                                          // keep rear reactor vents
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {     // one slit and one light on each tower, facing its outward diagonal
  const a = Math.atan2(sx, sz);
  glow.box(1.6, 10, 0.8, sx * 85 + Math.sin(a) * 16.9, 40, sz * 45 + Math.cos(a) * 16.9, g, 0, a, 0)
    .box(4, 4, 0.8, sx * 85 + Math.sin(a) * 16.6, 56, sz * 45 + Math.cos(a) * 16.6, g, 0, a, q);
}
```

The rear of the fortress (reactor ribs and hot vents on the keep, hot vents on the rear wall) echoes the engines' rear
reactor housings.

## 5. Part lists: turrets

### Autocannon turret (yaw 120 tris, pitch 84 tris; 204 each, 816 for four)

```js
acYaw.cyl(5.5, 5.5, 1.2, 0, 0.6, 0, D, 0, 0, 0, 10)       // turntable
  .box(11, 6, 12, 0, 4.2, -1, H)                          // cupola, y 1.2..7.2
  .box(11.6, 1, 12.6, 0, 7.7, -1, T)                      // flat lid
  .box(2, 5.5, 7, 6.3, 4.2, 1.5, D)                       // trunnion cheeks
  .box(2, 5.5, 7, -6.3, 4.2, 1.5, D)
  .cyl(2.6, 2.6, 9, 0, 4.5, -8.5, T, 0, 0, hp, 8);        // transverse ammunition drum at the rear

acPitch.box(8, 4.5, 3, 0, 0, 1.5, D)                      // mantlet (pivot is ac_yaw local 0, 4.5, 4)
  .cyl(0.9, 0.9, 16, 2.2, 0, 11, S2, hp, 0, 0, 6)         // twin barrels, z 3..19
  .cyl(0.9, 0.9, 16, -2.2, 0, 11, S2, hp, 0, 0, 6)
  .box(2.6, 2.6, 2.2, 2.2, 0, 19.6, D)                    // muzzle brakes, to z 20.7
  .box(2.6, 2.6, 2.2, -2.2, 0, 19.6, D);
```

- Firing: alternate `anchor_ac_a` and `anchor_ac_b`. Per shot `fx.muzzle(p, d, 1.6, ...PAL[side].tracer)` and
  `fx.tracer(..., 260, 10, 1.8, ...PAL[side].tracer)`. Kick `ac_pitch.position.z` back 0.6 and damp it home at rate 12.

### Lance turret (yaw 136 tris, pitch 212 tris, glow 36 tris; 384 each, 768 for two)

```js
lanceYaw.cyl(9, 9, 2, 0, 1, 0, D, 0, 0, 0, 10)            // turntable
  .box(14, 9, 16, 0, 6.5, -1, H)                          // housing, y 2..11
  .box(14.8, 1.2, 16.8, 0, 11.6, -1, T)                   // roof
  .box(3, 10, 9, 8.5, 7, 3, D)                            // trunnion cheeks
  .box(3, 10, 9, -8.5, 7, 3, D)
  .box(10, 7, 6, 0, 6, -12, D);                           // capacitor bank at the rear
for (const z of [-10.5, -12.5, -14.5]) lanceYaw.box(12, 8.5, 0.8, 0, 6.5, z, T);      // three cooling fins

lancePitch.box(7, 7, 9, 0, 0, 1.5, D)                     // breech (pivot is lance yaw local 0, 7, 4)
  .cyl(1.6, 2.2, 28, 0, 0, 20, D, hp)                     // barrel, z 6..34
  .box(1.4, 1.4, 9, 2.6, 0, 37, T)                        // fork prongs, z 32.5..41.5
  .box(1.4, 1.4, 9, -2.6, 0, 37, T)
  .box(6.6, 3, 3, 0, 0, 33.5, D)                          // fork yoke
  .box(2, 3, 14, 0, -3.4, 13, D);                         // under-brace
for (const z of [11, 18, 25]) lancePitch.cyl(4, 4, 1.2, 0, 0, z, T, hp, 0, 0, 10);    // three disc rings

lanceGlow.box(2.4, 1.6, 7, 0, 0, 37.5, W)                 // emitter core between the prongs
  .box(5, 5, 2.5, 0, 0, 14.5, W)                          // emitter blocks between the rings
  .box(5, 5, 2.5, 0, 0, 21.5, W);
```

- **Charge tell.** Over the last 1.5 s of the 6 s cycle, with `k` = charge fraction:
  `lance_glow.material.color.setRGB(g[0] * 1.4 * k * k, g[1] * 1.4 * k * k, g[2] * 1.4 * k * k)`. In the last 0.2 s
  multiply by `1 + 0.3 * Math.sin(time * 90)`. Black at all other times.
- **Firing.** Set the glow to `g x 4` for 0.1 s, then decay to black over 0.4 s. `fx.beam(muzzle, hit, 2.2, ...tracer x 1.5,
  0.25)`, `fx.muzzle(p, d, 3, ...tracer)`, `fx.flash(p.x, p.y, p.z, ...g, 5000, 0.3, 300)`. Recoil: push
  `lance_pitch.position.z` back 2 m and damp it home at rate 4.

## 6. Part lists: ward generator (504 tris)

Generator-local, origin on the ground at its axis. All drums are octagonal and turned by `o` so a flat faces each of the
four axes. Claw tips at y 61.

```js
gen.cyl(20, 23, 6, 0, 3, 0, D, 0, o, 0, 8)                // plinth, y 0..6
  .cyl(15, 17, 12, 0, 12, 0, H, 0, o, 0, 8)               // drum, y 6..18
  .cyl(17.5, 17.5, 1.6, 0, 18.6, 0, T, 0, o, 0, 8)        // ring
  .cyl(5, 7, 16, 0, 27, 0, D, 0, o, 0, 8)                 // core column, y 19..35
  .cyl(8, 5, 3, 0, 36.5, 0, T, 0, o, 0, 8)                // emitter dish, y 35..38
  .box(6, 26, 7, 15, 30, 0, H, 0, 0, -0.25)               // four legs leaning outward, y 17..43
  .box(6, 26, 7, -15, 30, 0, H, 0, 0, 0.25)
  .box(7, 26, 6, 0, 30, 15, H, 0.25)
  .box(7, 26, 6, 0, 30, -15, H, -0.25);                   // 208 tris

genClaws.cyl(3.6, 3.6, 8, 19, 42.5, 0, D, hp, 0, 0, 8)    // knuckle drums
  .cyl(3.6, 3.6, 8, -19, 42.5, 0, D, hp, 0, 0, 8)
  .cyl(3.6, 3.6, 8, 0, 42.5, 19, D, 0, 0, hp, 8)
  .cyl(3.6, 3.6, 8, 0, 42.5, -19, D, 0, 0, hp, 8)
  .box(4.5, 22, 6, 15.5, 51, 0, T, 0, 0, 0.55)            // four claws curling inward, y 42..61
  .box(4.5, 22, 6, -15.5, 51, 0, T, 0, 0, -0.55)
  .box(6, 22, 4.5, 0, 51, 15.5, T, -0.55)
  .box(6, 22, 4.5, 0, 51, -15.5, T, 0.55);                // 176 tris

genGlow.box(5, 3, 0.6, 0, 11, 15.1, g)                    // drum slits, one per face
  .box(5, 3, 0.6, 0, 11, -15.1, g)
  .box(0.6, 3, 5, 15.1, 11, 0, g)
  .box(0.6, 3, 5, -15.1, 11, 0, g)
  .box(1.2, 14, 0.6, 0, 27, 5.8, g)                       // conduits up the core column
  .box(1.2, 14, 0.6, 0, 27, -5.8, g)
  .box(0.6, 14, 1.2, 5.8, 27, 0, g)
  .box(0.6, 14, 1.2, -5.8, 27, 0, g);                     // 96 tris

genCore.box(9, 9, 9, 0, 0, 0, W, q, 0, q)                 // the star: two interlocked cubes, mesh at (0, 47, 0)
  .box(8, 8, 8, 0, 0, 0, W, 0, q, 0);                     // 24 tris
```

- **Core animation.** `genCore.rotation.y += dt * 0.8`, `genCore.position.y = 47 + 0.8 * Math.sin(time * 1.3)`, colour
  `g x (1.6 + 0.3 * Math.sin(time * 5))`. When the generator is hit, add 1.5 to the multiplier and damp it back at rate 4.
  Below 30% HP make it stutter: multiply by `0.5 + 0.5 * (Math.sin(time * 37) > 0)`.
- `genCore`, `genGlow`, `genClaws` and `gen` are four draw calls.

## 7. The ward: dome, ground ring and beam

`shieldMaterial(side)` from `js/colossus.js` is suitable and is reused unchanged: it is an additive fresnel rim in the
faction glow colour with one opacity uniform `uA`. On a dome this size it gives a bright outline that thins to nothing where
the surface faces the camera, so the fortress stays readable inside it. Two cheap additions make its extent and its source
clear: a ground ring and the beam.

- **Dome mesh `ward`.** `new THREE.Mesh(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  shieldMaterial(side))`. Child of the bastion root at (0, 0, 6), `scale.set(138, 184, 106)`, `renderOrder = 8`. On this
  one material instance set `side = THREE.DoubleSide` so the rim is also visible from inside. 532 tris. It encloses the
  glacis, all four towers and both crowns; the generator's centre at local z 160 is 48 m outside its front edge (z 112).
- **Containment test** for shots and for "is this point under the ward", in bastion-local coordinates:
  `(x / 138) ** 2 + (y / 184) ** 2 + ((z - 6) / 106) ** 2 < 1`.
- **`uA`.** Idle `1.0 + 0.15 * Math.sin(time * 1.3)`. On a hit: `wardA = Math.min(2.4, wardA + 0.25 + dmg * 0.003)`,
  damped back to idle at rate 3 (the colossus rule, scaled up). Also `fx.sparks(p.x, p.y, p.z, 6, 20, gB[0], gB[1], gB[2],
  0.5)` at the hit point.
- **Ground ring `wardRing`.** `new THREE.RingGeometry(0.985, 1, 64)` rotated flat with `rotateX(-Math.PI / 2)`, child of
  the bastion root at (0, 0.4, 6), `scale.set(138, 1, 106)`. `MeshBasicMaterial({ color: g x 0.6, transparent: true,
  opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })`.
  128 tris. Opacity follows `uA` (`0.8 * uA`, clamped to 1).
- **Beam `wardBeam`.** `new THREE.CylinderGeometry(1.2, 1.2, 1, 6, 1, true)` with `rotateX(Math.PI / 2)` and
  `translate(0, 0, 0.5)`, in the scene. Place it at `anchor_emitter` (world), `lookAt` `anchor_receptor` (world),
  `scale.z` = the distance (about 201 m). `MeshBasicMaterial({ color: g x 1.2, transparent: true, opacity: 0.7, blending:
  THREE.AdditiveBlending, depthWrite: false, toneMapped: false })`. Pulse `scale.x = scale.y = 1 + 0.25 * Math.sin(time * 9)`.
  12 tris. It clears the gate pylon caps by 20 m and passes through the gap between the keep's front merlons.

## 8. Ambient effects (all existing fx, all coordinates bastion-local)

| what | call | where | until |
|---|---|---|---|
| keep stack smoke (both sides) | `fx.addEmitter(x, y, z, 3.2, Infinity, true)` | (18, 157, -28) and (-18, 157, -28) | collapse starts |
| Synod crown pyre | `fx.addEmitter(x, y, z, 5, Infinity)` | (0, 156, -12) | 50% |
| Synod gate braziers | `fx.addEmitter(x, y, z, 2.6, Infinity)` | (22, 79, 60) and (-22, 79, 60) | collapse starts |
| Vigil searchlights | two `THREE.Mesh(G.city.beamGeo, G.city.beamMat)`, swept as the city's searchlights are | pylon tips (22, 84, 60) and (-22, 84, 60) | 50% |

Keep the handle each `addEmitter` returns; set `e.ttl = 0` to stop it.

## 9. Destruction states

Everything below reuses `fx.explosion`, `fx.debris`, `fx.dust`, `fx.smoke`, `fx.sparks`, `fx.flash`, `fx.addEmitter`,
`G.sfx.klaxon`, `G.sfx.boom` and `G.shakeAt`. No new effect code. Sizes are the `s` argument of `fx.explosion`.

### Turret destroyed

| | autocannon | lance |
|---|---|---|
| explosion at the pitch pivot | `fx.explosion(x, y, z, 2.5)` | `fx.explosion(x, y, z, 4)` |
| debris | `fx.debris(x, y, z, 5, 1.2, 22, 0.08)` | `fx.debris(x, y, z, 9, 1.8, 26, 0.08)` |
| pitch node | hidden (the barrels are blown off) | hidden; `lance_glow` hidden |
| yaw mesh | material `scorch`; `rotation.x = -0.18`, `rotation.z = 0.25`, yaw frozen | same, `rotation.z = -0.2` |
| fire | `fx.addEmitter(x, y + 3, z, 2.2, 40)` | `fx.addEmitter(x, y + 4, z, 3, 60)` |
| smoke | `fx.addEmitter(x, y + 4, z, 2, Infinity, true)` | `fx.addEmitter(x, y + 6, z, 2.6, Infinity, true)` |

Stop the turret's smoke emitter when the collapse starts.

### Ward generator destroyed (1.2 s)

1. At once: `fx.explosion(gx, 47, gz, 5)`, `fx.flash(gx, 47, gz, g[0], g[1], g[2], 9000, 0.5, 400)`,
   `fx.debris(gx, 45, gz, 12, 2.2, 28, 0.08)`. Hide `genCore`, `genGlow`, `genClaws` and `wardBeam`. `gen.material = scorch`.
2. The dome dies over 1.2 s, with `k` running 0 to 1: `uA = 2.6 * (1 - k) * (0.55 + 0.45 * Math.sin(t * 55))`; the ring's
   opacity takes the same factor. At `k = 1` hide `ward` and `wardRing`. At `k = 0` also
   `fx.flash(receptor, g[0], g[1], g[2], 6000, 0.4, 500)`.
3. Afterwards: `fx.addEmitter(gx, 24, gz, 4, 90)` (fire) and `fx.addEmitter(gx, 36, gz, 3, Infinity, true)` (smoke).

The stump (drum, column and four legs, top at 43 m) stays and still blocks movement.

### Bastion at 50% HP (the breach)

1. **The crown falls.** `fx.explosion(0, 130, -12, 4)` and `fx.debris(0, 132, -12, 10, 2.5, 26, 0.08)`. Over 2.2 s, with
   `k` running 0 to 1: `crown.rotation.y = 0.6`, `crown.rotation.x = 1.52 * Math.pow(k, 2.3)`,
   `crown.position.y = 49 - 20 * k * k`. At `k = 1` hide `crown` (and with it `crownGlow`), then
   `fx.explosion(25, 82, 22, 3, { silent: true })` and `fx.dust(25, 82, 22, 4, 8)` where it lands on tier 2. Stop the Synod
   crown pyre; hide the Vigil searchlights.
2. **Scars.** Show `scar`; set the keep mesh's material to `scorch`. `fx.explosion(52, 32, 50, 3.5)` at the wall breach.
3. **Glow flicker.** From now on the fixed glow stutters: each frame `glow.visible = rnd() > 0.08`.
4. **Fires**, kept until the collapse ends:

| id | position | size | kind |
|---|---|---|---|
| E1 | 52, 30, 51 (wall breach) | 4 | fire |
| E2 | -10, 114, 13 (keep face) | 3.5 | fire |
| E3 | 0, 130, -12 (where the crown stood) | 5 | fire |
| E4 | -31, 108, -14 (keep side) | 3 | smoke only |
| E5 | 40, 50, -30 (tier 1 deck, rear) | 3 | fire |
| E6 | -14, 63, 56 (gatehouse roof) | 2.5 | smoke only |

```js
scar.box(24, 20, 5, 52, 32, 47.5, S, 0, 0, 0.15)          // wall breach, left of the gate, over the litany plate
  .box(14, 12, 5, 62, 22, 47.5, S, 0, 0, -0.3)
  .box(12, 10, 5, 42, 42, 47.5, S, 0, 0, 0.5)
  .box(16, 6, 10, 54, 3, 62, S3, 0, 0.3, 0)               // rubble at the glacis foot
  .box(8, 5, 7, 44, 2.5, 64, S3, 0, -0.5, 0.1)
  .box(22, 18, 5, -10, 112, 10.5, S, 0, 0, -0.2)          // keep face scar, across the banner
  .box(5, 20, 24, -28.5, 110, -14, S, 0.15, 0, 0);        // keep side scar          (84 tris)
```

### Bastion at 0% HP (the collapse, 9 s)

`T` is seconds since the HP reached zero. Each stage has its own `k` running 0 to 1 over its window. While a node is
moving (0 < k < 1), add a jitter of `rr(-0.5, 0.5)` to its x and z each frame, as the city's collapsing blocks do.

| T | stage |
|---|---|
| 0 | `glow.visible = false`. Stop stack smoke, braziers and turret smoke. Klaxon every 0.7 s until T 9 (`G.sfx.klaxon`, as the colossus). |
| 0 to 2 | Every turret still alive goes to its destroyed state, one every 0.3 s. |
| 0 to 9 | Chain explosions: `if (rnd() < dt * 6)` then `fx.explosion(rr(-28, 28), rr(80, 125), rr(-34, 12), rr(1.5, 3))` and `fx.debris` of 3 pieces at the same point. |
| 2 to 9 | Dust: 26 puffs a second on an ellipse around the foot, using the city's collapse line: `fx.smoke(cos(a) * 95 * r, rr(0, 50), sin(a) * 55 * r, cos(a) * rr(4, 16), rr(1, 9), sin(a) * rr(4, 16), rr(4, 9), 14, 46, rr(0.1, 0.17), 0.65, 0.5)` with `r = rr(0.6, 1.2)`. |
| 2 to 5.5 | **Keep** sinks into tier 2: `keep.position.y = 30 - 44 * k * k`, `keep.rotation.x = 0.10 * k` (it pitches toward the gate). Hide at `k = 1`. |
| 4.5 to 8 | **Tier 2** sinks into the curtain block: `ward2.position.y = 48 - 30 * k * k`, `ward2.rotation.z = -0.04 * k`. The lance wrecks ride down with it. Hide at `k = 1`. |
| 5.5 to 8.5 | **Towers FL and RR topple outward**: `tower.rotation.x = 1.52 * Math.pow(k, 2.3)` (with order 'YXZ' this tips the tower along its own outward diagonal). At `k = 0.8`, along the fall line at 18, 34, 50 and 66 m from the tower foot: `fx.dust(x, 2, z, 5, 5, 0.14, 0.6)`, `fx.explosion(x, 2, z, 1.4, { silent: true })`, `fx.debris(x, 4, z, 2, 2.2, 20, 0.09)`, then one `G.sfx.boom` and `G.shakeAt(.., 5)`. Hide at `k = 1`. |
| 6 to 9 | **Towers FR and RL sink**: `tower.position.y = -42 * k * k`. Hide at `k = 1`. |
| 6.5 to 9 | **Gatehouse** sinks: `gate.position.y = -46 * k * k`, `gate.rotation.x = 0.08 * k`. Hide at `k = 1`. |
| 9 | **Final blast.** `fx.explosion(0, 60, -6, 6)`, then silent: `(-40, 30, 50, 5)`, `(40, 30, 50, 5)`, `(0, 20, -50, 4.5)`. The colossus shockwave ring (44 smoke puffs) at radius 60 around the centre. `fx.flash(0, 80, 0, 1, 0.55, 0.2, 9000, 0.6, 600)`, `G.shakeAt(0, 0, 0, 8)`, `G.sfx.boom(dist, 5)`. Then set the base mesh's material to `scorch`, hide `scar`, show `ruin`, stop E1 to E6, start R1 to R9. |

If the collapse blast should hurt nearby units, use the city's topple rule at each tower fall point:
`G.blast(x, 2, z, 14, 400, -1)`.

**Ruin state** (permanent): the scorched curtain block with its glacis still stands at 48 m, carrying a rubble heap, the
broken keep stump to about 90 m, four tower stumps and the gate stump.

```js
ruin.box(112, 12, 58, 0, 53, -6, S3, 0, 0, 0.03)          // rubble heap on the deck
  .box(46, 26, 34, -6, 66, -14, H2, 0.1, 0.2, -0.08)      // broken keep stump
  .box(20, 40, 6, 14, 70, 2, D, 0.5, 0, 0.2)              // leaning wall slab
  .box(8, 30, 8, -26, 68, -34, D, 0, 0, 0.15)             // one surviving pier
  .box(30, 8, 22, 30, 60, 10, S3, 0, 0.4, 0)              // heaps
  .box(26, 10, 20, -38, 58, 12, S3, 0, -0.3, 0.05)
  .box(44, 24, 22, 0, 12, 53, H2)                         // gate stump
  .box(10, 34, 12, -22, 17, 60, D, 0, 0, 0.1);            // one pylon stub
for (const sx of [-1, 1]) for (const sz of [-1, 1]) ruin.cyl(17.2, 18, 24, sx * 85, 12, sz * 45, H2, 0, 0, 0, 10)   // tower stumps
  .box(14, 10, 6, sx * 85, 27, sz * 45, D, 0.3, 0.5, 0.2);                            // jagged tops   (304 tris)
```

| id | position | size | kind | ttl |
|---|---|---|---|---|
| R1 | -6, 80, -14 (keep stump) | 6 | fire | 180 |
| R2 | 30, 64, 10 | 4.5 | fire | 150 |
| R3 | -38, 62, 12 | 4 | fire | 120 |
| R4 | 0, 30, 62 (gate stump) | 4 | fire | 120 |
| R5 to R8 | +-85, 26, +-45 (tower stumps) | 3.5 | smoke only | Infinity |
| R9 | 0, 66, -30 | 7 | smoke only | Infinity |

Emitters only run within 900 m of the camera, so the far bastion costs nothing.

## 10. Footprint and collision

All boxes are axis-aligned in bastion-local space, and stay axis-aligned in the world because the root yaw is 0 or pi.
Convert with the placement rule in section 2 (`s` negates both x and z).

### Ground footprint (movers: infantry, tanks, scouts, engines)

Push circles out of these exactly as `City.collideCircle` does for a lot (clamp to the box, push out by the radius).

| id | what | centre x, z | half-width x | half-depth z |
|---|---|---|---|---|
| F1 | curtain block and glacis | 0, 0 | 93 | 55 |
| F2 | gatehouse and pylons | 0, 61 | 28 | 6 |
| F3 | tower FL | 85, 45 | 19 | 19 |
| F4 | tower FR | -85, 45 | 19 | 19 |
| F5 | tower RL | 85, -45 | 19 | 19 |
| F6 | tower RR | -85, -45 | 19 | 19 |
| G1 | ward generator (generator-local) | 0, 0 | 21 | 21 |

- The gate ramp (z 67 to 81.5) is not solid; the gate itself is (it never opens).
- Overall keep-out rectangle for path planning: x -104 to +104, z -64 to +67. Lane 0 must stop or split at |world z| = 560
  (generator) and again at 655 (ramp foot).
- The footprint does not change in any destruction state, including the ruin and the generator stump.

### Solid volumes (shots, line of sight, aircraft)

| id | what | x | z | y | present |
|---|---|---|---|---|---|
| V1 | curtain block | -85 to 85 | -45 to 45 | 0 to 48 | always |
| V2 | gatehouse | -27 to 27 | 45 to 66 | 0 to 61 | until the collapse |
| V3 | gate pylons | 17 to 27 and -27 to -17 | 54 to 66 | 61 to 72 | until the collapse |
| V4 | tier 2 | -60 to 60 | -36 to 24 | 48 to 81 | until the collapse |
| V5 | keep | -32 to 32 | -38 to 14 | 78 to 130 | until the collapse |
| V6 | crown | -17 to 17 | -20 to -4 | 130 to 165 | until 50% |
| V7 to V10 | towers: vertical cylinders, radius 18 | axis +-85 | axis +-45 | 0 to 73 | until the collapse |
| V11, V12 | lance barbettes: cylinders, radius 12 | axis +-50 | axis 14 | 78 to 88 | until the collapse |
| V13 | ruin heap and keep stump | -56 to 56 | -35 to 23 | 48 to 80 | ruin only |
| V14 | gate stump | -22 to 22 | 42 to 64 | 0 to 24 | ruin only |
| V15 to V18 | tower stumps: cylinders, radius 18 | axis +-85 | axis +-45 | 0 to 24 | ruin only |
| GV1 | generator drum: cylinder, radius 21 (generator-local) | axis 0 | axis 0 | 0 to 19 | always |
| GV2 | generator claws and core: cylinder, radius 21 | axis 0 | axis 0 | 19 to 61 | until destroyed |
| GV3 | generator stump: cylinder, radius 16 | axis 0 | axis 0 | 19 to 43 | after destroyed |

The glacis slopes are not modelled as solids; V1 is enough.

### Damage volumes

- Bastion: any hit on V1 to V12. While the ward stands, the dome test in section 7 intercepts first.
- Lance turret: sphere of radius 11 at the pitch pivot. Autocannon turret: sphere of radius 8 at the pitch pivot.
- Ward generator: GV1 and GV2.

## 11. Dimensions and triangle budget

| measure | value |
|---|---|
| width across the tower feet | 214 m (x -107 to +107); across the drums 202 m |
| curtain block | 170 x 90 m, deck 48 m, merlons 54 m |
| depth, rear glacis foot to ramp foot | 140 m (z -58 to +81.5) |
| gatehouse | 44 m wide, parapet 61 m, pylons 72 m (caps 84 m Vigil, 77 m Synod); portal 24 x 34 m |
| corner towers | radius 16 to 18 m, deck 67 m, turret top 81 m |
| tier 2 | 120 x 60 m, deck 78 m, merlons 86 m |
| lance turrets | pitch pivot 95 m, roof 100 m, barrel 42 m from the pivot |
| keep | 56 x 44 m, roof 122 m, mural crown 127 m, merlons 135 m, stacks 154 m |
| crown | Vigil fork tips 175 m; Synod horn tips 167 m |
| ward dome | semi-axes 138 x 184 x 106 m, centred 6 m ahead of the origin |
| ward generator | 46 m across, 61 m tall, 160 m ahead of the origin |
| for comparison | Hierarch 63 m, great colossus about 125 m, city hab 24 to 90 m, cathedral towers 90 to 116 m, hero spires 150 to 270 m |

| part | tris |
|---|---|
| base | 612 |
| gate | 172 (Vigil), 220 (Synod) |
| towers, 192 x 4 | 768 |
| ward2 | 520 |
| keep | 352 |
| crown body + glow | 76 (Vigil), 116 (Synod) |
| glow | 468 |
| autocannon turrets, 204 x 4 | 816 |
| lance turrets, 384 x 2 | 768 |
| **bastion on screen, intact** | **4,552 (Vigil), 4,640 (Synod)** |
| with the 50% scar shown | 4,636 to 4,724 before the crown's triangles are removed |
| ruin state (base + ruin) | 916 |

Under the 6,000 limit with about 1,300 to spare. Outside that budget: ward generator 504, dome 532, ground ring 128, beam
12. Draw calls for an intact bastion: 9 fixed meshes (base, gate, four towers, ward2, keep, crown) + 2 glow meshes (glow,
crownGlow) + 8 for the autocannons + 6 for the lances = 25, plus dome and ring.

## 12. Sketches

Schematic, not to exact scale.

### Plan (rear at the top, enemy at the bottom; +x, the bastion's left, on the right)

```
   z                x -85    -60      -28    0    +28      +60    +85
 -100   . . . . . . . . . . . . . dome edge . . . . . . . . . . . . . . .
  -58        ._________________rear glacis_________________.
  -45      ( RR )===v=====v==rear wall, hot vents==v=====v===( RL )      (AC) on every tower
  -36       `--'  .-------------------------------------.    `--'
  -34         |   |      .---ribs+vents---.             |      |
  -28         |   |      | o stacks     o |             |      |
  -12         |   |      |   KEEP  [crown]|   TIER 2    |      |
    0         |   |      |                |             |      |         origin (0, 0)
  +10         |   |      '----[banner]----'             |      |
  +14         |   | (LR)                           (LL) |      |         lance barbettes at x +-50
  +24         |   '--/---/----i-i-I-i-i----\---\--------'      |         / \ = buttress fins
  +45      ( FR )====[#]=====.-----------.=====[#]=====( FL )            [#] = litany plates
  +54       `--'    glacis   |[]  GATE [] |   glacis     `--'            [] = pylons
  +66                        '--|||||||---'
  +81                           \ ramp /
 +112   . . . . . . . . . dome edge, ground ring . . . . . . . . . . . .
                                   ||
                                   ||  ward beam (overhead, rising to the crown)
                                   ||
 +160                           .-(  )-.
                               (  WARD  )   generator, radius 23 at the plinth
                                `-(  )-'
                                                 keep-out for movers: x +-104, z -64..+67
```

### Front elevation (viewer faces the gate; Vigil crown shown)

```
   m
 175                                 /\      /\                         Vigil watch fork, tips 175
 165                                 ||      ||                         (Synod: stepped pyre, bowl 147-153,
 150                                 ||  <>  ||                          four horns to 167, permanent fire)
 140                                 ||======||                         <> lamp and ward receptor, y 150
 135                      n  .n_.nn._||______||_.nn._n.  n              piers 132, merlons 135, stacks 154 behind
 127                      |[]__________________________[]|              mural crown 122-127
 115                      | |  |    .--------.    |  | | |
 105                      | |  I    | BANNER |    I  | | |              KEEP  x +-28, y 78-122
  95          ==O==O==O=[LR]|  I    |   <>   |    I  | |[LL]=O==O==O==   lance turrets, pitch pivot y 95
  86        n__n___n___n_|__|_|_____|________|_____|_|__|_n___n___n__n   tier 2 parapet 81, merlons 86
  75        |    /  /    i      i   I   i      i    \  \    |            TIER 2  x +-60, y 48-78
  73  =[AC]=|   /  /    _n______n_______n_     \  \   |=[AC]=           autocannons, pitch pivot y 77.5
  65  .====.|__/__/____|[]   .------.   []|_____\__\__|.====.           tower collars 63-67, gate parapet 61
  54  | <> n__n__n__n__| |   |  <>  |   | |__n__n__n__n <> |            curtain parapet 48, merlons 54
  40  | i  | i  [#]  i | |   '------'   | | i  [#]  i |  i |            i = glow slit, [#] = litany plate
  31  |----|===========| |  .--------.  | |===========|----|            string course 31
  20  |    | /         | |  ||||||||||  | |         \ |    |            portal 24 x 34, glowing portcullis
  10  |   /|/  glacis  | |  ||||||||||  | |  glacis  \|\   |
   0 /___/_/___________|_|__/  ramp  \__|_|___________\_\___\
       x -85      -60      -22     0     +22      +60      +85
```

### Side elevation (seen from the bastion's left; the enemy is to the right)

```
   m                          . - ' ' ' ' ' - .                               dome apex 184 over z +6
 175                    .  '   /\               '  .
 150                 .       <>||. . . . . . . . . . '. . . . . .             ward beam, 201 m
 135               .    o  n_|__|_n                    '          ' . . .
 127              .     |o|_______|                      .                 ' . . .
 105             .      | |  KEEP |                       .                        ' . .
  95                    | |       |[LL]==O=O=O==>          .                             ' . .
  81            .   n_n_|_|_______|__n_n                    .                                 '.
  73                |    TIER 2      |\    [AC]=>                                              .'<> core 47
  61           .  [AC]               | \  .====.  .-n-n-.    .                              /\ /\  claws 61
  48              .===.______________|__\_|    |__| GATE |                                  | \/ |
  30           .  |   |   CURTAIN BLOCK   | FL |  | [||] |    .                             |_/\_|
  10              | RL|                   |    |  | [||] |                                 /|_||_|\
   0  . . . . .__/____|\__________________|____|__|______|\_ramp_ . . . . . . . . . . . ._/________\_
      z  -100     -58 -45       -12   0  +24   +45     +66   +81  +112                      +160
```

## 13. Build notes for the implementer

- One function `buildParts(side)` returning the geometries named above (`base`, `gate`, `tower`, `ward2`, `keep`, `crown`,
  `crownGlow`, `glow`, `scar`, `ruin`, `acYaw`, `acPitch`, `lanceYaw`, `lancePitch`, `lanceGlow`, `gen`, `genClaws`,
  `genGlow`, `genCore`), cached per side. Apply the three `geometry.translate` calls from section 3 inside it.
- Assemble the groups with the pivots in section 3. Anchors are plain `Object3D`s.
- `scar` and `ruin` start with `visible = false`.
- The fixed meshes are large; leave `frustumCulled` at its default (true) so the far bastion is skipped when off screen.
- The bastion casts no blob shadow; the glacis grounds it.
- Nothing in this design needs a change to `Builder`, `PAL`, `shieldMaterial` or `Fx`. The only edit outside the new module
  is the lot-skip condition in `js/city.js` (section 2).
- For `?shot=bastion`: camera at bastion-local (150, 45, 330) looking at (0, 70, 40) shows the gate, both lances, the dome
  rim, the beam and the generator in one frame.
