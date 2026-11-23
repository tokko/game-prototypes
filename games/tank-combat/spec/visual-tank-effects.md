# Visual Spec: Tank Model and Combat Effects

Scope: procedural tank models (player MBT, enemy variant, destroyed/disabled states) and all combat VFX. Environment and HUD are specified elsewhere. Target look: reference.png (dusty olive-drab modern MBT, heavy stowage, oily black smoke columns, bright short-lived fireballs, tan dust).

All geometry, textures and particles are procedural Three.js. No external assets. Numbers are meters, seconds, degrees unless stated.

---

## 0. Conventions

- Y up. Tank local frame: +X right, +Z forward, origin on the ground plane at the center of the track footprint.
- Gun elevation: `gunPivot.rotation.x = -elevationRad` (positive Three.js X rotation tilts +Z downward). Limits: -9 to +20 (player), -6 to +14 (enemy).
- Seeded RNG (mulberry32, fixed seed per texture) for every canvas texture so results are deterministic.
- Never create meshes, materials, lights or textures after load. All effects draw from pools created at init. Call `renderer.compile(scene, camera)` once at load with every effect material and the destroyed-tank materials present (hidden objects with `frustumCulled=false`, one frame) to avoid first-use hitches.

### 0.1 Scene graph and attach points

```
tankRoot            Group  position = ground contact, rotation.y = hull heading
 └ hullTilt         Group  terrain pitch/roll + visual springs (recoil rock, braking dive)
    ├ hull meshes (merged per material, identity transform)
    ├ wheelsRoad    InstancedMesh (28)   wheelsIdler (4)  wheelsSprocket (4)  rollers (6)
    ├ trackL, trackR
    ├ exhaustPoint  Object3D (0, 1.32, -3.92), emits toward -Z
    ├ dustL / dustR Object3D (±1.42, 0.15, -3.30)   dustFL / dustFR (±1.42, 0.15, 3.40)
    ├ fireAnchor    Object3D (0, 1.75, -2.20)  engine deck, used by wreck fire
    └ turretYaw     Group  (0, 1.64, 0.25)  rotation.y = turret azimuth relative to hull
        ├ turret meshes (merged per material)
        ├ detail     Group (stowage, antennas, cupola optics, RWS) - hidden beyond LOD1 distance
        ├ smokeTubes[12] Object3D, +Z of each = launch direction
        └ gunPivot   Group  (0, 0.42, 1.55)
            ├ mantlet
            ├ coaxMuzzle Object3D (0.30, -0.06, 0.72)
            └ recoil   Group (animated along -Z)
                ├ barrel
                └ muzzle  Object3D (0, 0, 4.70)
```

Overall player dimensions: hull 7.81 long (z -3.85..3.96), width 3.60 over skirts, turret roof at y 2.44, gun forward length 10.35 overall.

---

## 1. Player MBT ("M-class", Abrams/Leopard hybrid)

### 1.1 Hull

Two `ExtrudeGeometry` side profiles. Shape coordinates are (z, y). Build shape with x = z, extrude `depth = width`, then `rotateY(-PI/2)` and `translate(width/2, 0, 0)`. Extrude settings: `bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, steps: 1`.

Lower hull (between tracks), width 2.16:

| pt | z | y |
|---|---|---|
| L0 | -3.60 | 0.50 |
| L1 | 3.10 | 0.48 |
| L2 | 3.85 | 1.05 |
| L3 | 3.85 | 1.14 |
| L4 | -3.82 | 1.14 |
| L5 | -3.82 | 0.78 |

Upper hull (over tracks), width 3.44:

| pt | z | y | note |
|---|---|---|---|
| U0 | -3.85 | 1.14 | rear bottom |
| U1 | 3.88 | 1.14 | nose bottom |
| U2 | 3.96 | 1.24 | nose tip |
| U3 | 2.25 | 1.62 | glacis top (about 12.5 deg) |
| U4 | -1.20 | 1.64 | crew deck |
| U5 | -1.40 | 1.70 | engine deck step |
| U6 | -3.62 | 1.70 | engine deck rear |
| U7 | -3.85 | 1.56 | rear chamfer |

Hull details (all paint material unless noted; box sizes are w x h x d along X, Y, Z; positions are centers in hull space):

| part | geometry | position |
|---|---|---|
| Driver hatch | box 0.80 x 0.06 x 0.60 | (0, 1.66, 2.05), pitched to glacis slope |
| Driver periscopes x3 | box 0.12 x 0.06 x 0.04, glass | x -0.22/0/0.22, (y 1.70, z 2.36) |
| Engine grille panels x2 | box 1.10 x 0.02 x 2.00, grille texture | (±0.62, 1.71, -2.45) |
| Rear exhaust grille | box 1.70 x 0.50 x 0.03, grille texture rotated 90 | (0, 1.32, -3.865) |
| Headlight housings x2 | box 0.22 x 0.14 x 0.12 + glass face 0.16 x 0.09 | (±1.45, 1.32, 3.90) |
| Tail lights x2 | box 0.10 x 0.08 x 0.04, red lens | (±1.50, 1.46, -3.87) |
| Tow hooks x4 | box 0.10 x 0.14 x 0.14 + torus r0.06 tube 0.02 (metal) | front (±0.90, 1.05, 3.90), rear (±0.95, 1.05, -3.87) |
| Fenders front x2 | box 0.66 x 0.03 x 0.35 | (±1.43, 1.20, 3.98) |
| Tow cables x2 | TubeGeometry r 0.022, 48 tubular x 6 radial, metal-dark | see below |

Tow cable path (left; mirror X for right), CatmullRomCurve3 on the rear plate: (-1.55, 1.40, -3.88), (-1.25, 1.10, -3.90), (-0.70, 1.02, -3.90), (-0.25, 1.15, -3.89), (-0.18, 1.42, -3.88). Eye loops: torus r 0.06 tube 0.018 at both ends. Right cable is identical mirrored; the cables hang 2-4 cm proud of the plate and drape over the grille's outer edges (intended).

### 1.2 Running gear

Road wheels: 7 per side, double wheel = two discs. Disc `CylinderGeometry(0.36, 0.36, 0.20, 20)` rotated Z 90 deg. Disc X centers ±1.275 and ±1.575 (gap 0.10 shows track guide horns). Wheel centers y = 0.44, z = -2.85, -1.90, -0.95, 0, 0.95, 1.90, 2.85. One InstancedMesh, 28 instances, material array [rubber tread (side group), wheelFace (cap groups)].

| part | geometry | center (per side, x as above) |
|---|---|---|
| Sprocket (rear) | ExtrudeGeometry gear: 11 teeth, 44 verts alternating r 0.35 (tip, 2 verts) / 0.29 (root, 2 verts), depth 0.14; two discs at x 1.275/1.575 | z -3.55, y 0.68 |
| Sprocket hub | cylinder r 0.16, len 0.46, metal | same |
| Idler (front) | double disc like road wheel, r 0.32 | z 3.55, y 0.62 |
| Return rollers x3 | cylinder r 0.10, len 0.20, rubber + metal cap | z -1.60, 0, 1.60, y 0.94, x 1.425 |

Wheel animation: `angle += signedTrackSpeed * dt / radius` per side (road 0.36, idler 0.32, sprocket 0.33, roller 0.10). Update instance matrices every frame for visible tanks only.

### 1.3 Tracks

- Width 0.63, thickness 0.08, centerline x ±1.425 (outer edge ±1.74, inner ±1.11). Link pitch 0.19.
- Path (side view, z/y): 2D convex hull of circles sampled at 64 angles each: idler (3.55, 0.62, r 0.32+0.04), sprocket (-3.55, 0.68, r 0.33+0.04), front/rear road wheels (±2.85, 0.44, r 0.36+0.04), return rollers (z -1.60/0/1.60, y 0.94, r 0.10+0.04). Monotone-chain hull, then resample uniformly every 0.05 m. Optional sag: lower the upper run midpoints between rollers by 0.025.
- Mesh: ribbon BufferGeometry along the path: outer surface (offset +0.04 along path normal), inner surface (-0.04), two thin side walls. UV: u = 0..1 across width, v = arcLength / 0.19. Texture `wrapT = RepeatWrapping`, `repeat (1,1)`.
- Scroll: each side owns a cloned texture (shared image); `tex.offset.y = -(distanceTravelledSide / 0.19) % 1`.
- Track texture canvas 128 (across) x 64 (one link): fill #2A2826; two rubber pads x 10..56 and 72..118, y 8..56, #1B1A19 with 2 px #3A3733 worn rim; center guide horn x 58..70 #4A4741; end connectors x 0..8 and 120..128 #6D6A64 (worn steel, roughness 0.45 via separate roughness canvas); link gap row y 0..4 #0D0D0D; dust: overlay #8E7E62 alpha 0.30 gradient strongest at outer 20 px of each edge. Side walls use flat #24221F.

### 1.4 Side skirts

- 7 panels per side, each 0.95 (z) x 0.66 (y) x 0.05 (x), outer face at x ±1.80, y 0.56..1.22, panel z centers -3.00 + i*1.00 (i = 0..6), gaps 0.05 between panels.
- Front panel (i = 6) is 0.09 thick (heavier armor) and its front lower corner is cut: extrude a pentagon (z,y): (-0.475, 0), (0.25, 0), (0.475, 0.30), (0.475, 0.66), (-0.475, 0.66).
- Rubber flap strip under each panel: 0.95 x 0.10 x 0.02, rubber, y 0.51.
- Skirts cover the upper half of road wheels and the whole upper track run. They are the main source of the "slab-sided" modern silhouette in the reference.

### 1.5 Turret (lofted angular armor)

Turret is a custom non-indexed BufferGeometry lofted through three rings with identical vertex counts, flat-shaded (per-face normals, hard edges). Cap top and bottom with `THREE.ShapeUtils.triangulateShape`. Coordinates (x, z) in turretYaw space.

Middle ring (y = 0.30), 14 points, counter-clockwise from the right side of the gun slot:

| pt | x | z | note |
|---|---|---|---|
| M0 | 0.55 | 2.15 | slot recess (mantlet sits here) |
| M1 | 0.66 | 2.42 | cheek front inner |
| M2 | 1.45 | 2.12 | cheek front outer (arrowhead angle) |
| M3 | 1.78 | 1.20 | side front |
| M4 | 1.78 | -0.90 | side rear |
| M5 | 1.70 | -1.55 | bustle start |
| M6 | 1.58 | -2.60 | bustle rear corner |
| M7..M13 | mirror M6..M0 in x | | |

- Bottom ring (y = 0.00): M scaled (x 0.90, z 0.93). Gives an undercut so the turret reads as floating over the hull.
- Top ring (y = 0.80): M scaled (x 0.88, z 0.95), then z -= 0.06. Gives sloped cheeks and sides.
- Roof plates: two blow-out panels box 0.90 x 0.02 x 0.90 at (±0.55, 0.81, -1.85).
- Side stowage boxes: box 0.20 x 0.38 x 1.40 at (±1.84, 0.45, -1.35), lid seam via texture.

### 1.6 Gun

Gun pivot at turretYaw (0, 0.42, 1.55).

Mantlet: ExtrudeGeometry of an octagon in (x, y): (±0.475, ±0.25), (±0.40, ±0.31) ordered around, depth 0.45 along +Z, bevel 0.02. Placed so it spans pivot-local z 0.25..0.70. Dark recesses: coax port cylinder r 0.03 (black) at (0.30, -0.06, 0.70); aux sight glass 0.08 square at (-0.30, 0.10, 0.705). Dust cover: canvas truncated cone r 0.20 -> 0.14, length 0.14, z 0.70..0.84.

Barrel: single `LatheGeometry`, 24 segments, profile (r, z) then `rotateX(PI/2)` so lathe +Y maps to +Z. Lives under `recoil`.

```
(0.000,0.30) (0.125,0.30) (0.125,0.75) (0.112,0.80) (0.110,1.70)
(0.150,1.80) (0.158,1.88) (0.158,2.42) (0.150,2.50) (0.104,2.58)   fume extractor 1.80-2.50
(0.100,3.10) (0.106,3.12) (0.106,3.17) (0.098,3.19)                 thermal sleeve clamp
(0.094,3.90) (0.100,3.92) (0.100,3.97) (0.092,3.99)                 clamp
(0.088,4.62) (0.094,4.64) (0.094,4.70) (0.062,4.70) (0.062,4.66) (0.000,4.66)   muzzle crown, bore lip
```

- Bore: black disc `CircleGeometry(0.060, 16)` at z 4.665 facing +Z, color #050505, roughness 1.
- Muzzle reference sensor: box 0.09 x 0.07 x 0.14 at (0, 0.115, 4.55) plus thin strut box 0.02 x 0.05 x 0.02 at (0, 0.085, 4.55).
- Muzzle point (`muzzle`): (0, 0, 4.70).

### 1.7 Roof equipment (turretYaw space; roof at y 0.80)

| part | geometry | center |
|---|---|---|
| Commander cupola | cylinder r 0.42, h 0.16, 8 radial segments | (0.70, 0.88, -0.35) |
| Cupola vision blocks x8 | glass box 0.12 x 0.07 x 0.03 on each octagon face | ring y 0.88 |
| Cupola hatch | cylinder r 0.36 h 0.05, hinge at rear edge (pivot z -0.71) | (0.70, 0.985, -0.35) |
| RWS post | cylinder r 0.07 h 0.20 | (0.70, 1.11, -0.15) |
| RWS cradle | box 0.34 x 0.22 x 0.50 | (0.70, 1.32, -0.10) |
| RWS MG receiver | box 0.10 x 0.12 x 0.70; barrel cyl r 0.016 len 0.75; flash hider r 0.025 len 0.10 | right of cradle x 0.92, barrel to z 0.90 |
| RWS ammo box | box 0.22 x 0.22 x 0.30 | (0.47, 1.30, -0.12) |
| RWS sensor head | box 0.20 x 0.16 x 0.22 + glass 0.14 x 0.10 front | (0.70, 1.51, -0.05) |
| Loader hatch | box 0.75 x 0.07 x 0.70 + 1 periscope | (-0.65, 0.835, -0.30) |
| Gunner primary sight | box 0.46 x 0.40 x 0.62; two glass panes 0.17 x 0.22 on front face; two open armored doors 0.20 x 0.24 x 0.03 angled 60 deg outward | (0.95, 1.00, 1.20) |
| CITV | pedestal cyl r 0.15 h 0.25; head box 0.34 x 0.28 x 0.32 with glass 0.20 x 0.14 | pedestal (-0.35, 0.925, 0.70), head y 1.19 |
| Wind sensor mast | cyl r 0.012 h 0.55 + T-bar 0.20 | (0, 1.08, -1.20) |
| Antennas x2 | base cyl r 0.045 h 0.14 (#2E2F25); whip cyl r 0.008 -> 0.004, len 2.60, 4 radial x 8 height segs, tilted back 8 deg | (±1.25, 0.87, -2.10) |

Smoke dischargers: one bank per side, base plate box 0.12 x 0.30 x 0.50 at (±1.62, 0.55, 1.35). Six tubes per bank, `CylinderGeometry(0.045, 0.045, 0.28, 10, 1, true)` + black inner disc. Rows y offset +0.07 / +0.17, columns z offset -0.15 / 0 / +0.15. Tube axis: elevation 20 deg; azimuth from turret forward, right bank top row 15/35/55, bottom row 25/45/65 deg; left bank mirrored. Each tube gets a `smokeTubes[i]` Object3D at its mouth.

### 1.8 Bustle rack and stowage (turretYaw space)

Basket frame of cylinders r 0.018 (paint-dark): rear rail plane z -3.15, x -1.45..1.45, y 0.25..0.70 (3 horizontal rails, 7 vertical posts); side rails z -2.45..-3.15 at x ±1.45; bottom slats every 0.25 m.

| item | geometry | center | color |
|---|---|---|---|
| Duffel A | CapsuleGeometry r 0.20 len 0.65 along X, scaleY 0.75 | (-0.85, 0.50, -2.85) | #6B6448 |
| Duffel B | capsule r 0.22 len 0.80 | (0.05, 0.52, -2.88) | #3F4430 |
| Duffel C | capsule r 0.18 len 0.55 | (0.85, 0.48, -2.80) | #5C5A3E |
| Tarp roll | cylinder r 0.15 len 1.90 along X, 2 strap bands (box 0.04 wide, #23241A) | (0, 0.82, -3.00) | #4A4A36 |
| Ammo cans x2 | box 0.30 x 0.20 x 0.16 | (1.20, 0.36, -2.75), (1.20, 0.36, -3.00) | #4C5233 |
| Crate | box 0.50 x 0.30 x 0.35 | (-1.20, 0.40, -2.95) | #5B5E46 |
| Jerrycans x2 | box 0.165 x 0.47 x 0.345 upright, X-recess texture | (1.58, 0.45, -2.70), (1.58, 0.45, -3.00) | #4A5030 |

Jitter each bag: rotation ±6 deg on all axes, scale ±8 %. Canvas material is the single largest "lived-in" cue in the reference; do not skip the bags.

---

## 2. Materials and Textures

### 2.1 Palette

| name | hex | rough | metal | use |
|---|---|---|---|---|
| paintBase | #4E5232 | 0.78 | 0 | olive drab |
| paintDark | #2F321F | | | panel lines, recesses, rack frame |
| paintLight | #6E6F4C | | | sun-bleached tops, chip halos |
| dust | #9C8C6A | 0.95 | | dust overlay |
| mud | #5E4F3B | 0.9 | | lower hull splatter |
| bareMetal | #7A776E | 0.45 | 0.85 | chips, track connectors |
| steelDark | #3B3A35 | 0.6 | 0.7 | cables, hooks, sprocket hub |
| rubber | #1E1D1B | 0.95 | 0 | tyres, flaps |
| glass | #0E1A1E | 0.08 | 0.5 | optics; emissive #12332E x 0.4 (lens tint) |
| canvasA/B/C | #6B6448 / #3F4430 / #5C5A3E | 0.95 | 0 | stowage |
| bore | #050505 | 1.0 | 0 | gun bore, tube interiors |
| tailLight | #5A0E0A | 0.4 | 0 | emissive #FF2010 x 0.6 |

### 2.2 UVs

All paint geometry (boxes, extrudes, lofts, lathe) gets box-projected UVs in its group space after merging: dominant axis of the face normal picks the plane, `uv = position.(yz|xz|xy) * 0.4` (one texture tile = 2.5 m). Uniform texel density across parts is what makes the grime read as one surface.

### 2.3 Canvas textures (seeded)

paintAlbedo, 1024 x 1024, sRGB, RepeatWrapping, mipmaps:
1. Fill #4E5232.
2. 600 soft blotches: radial gradients r 40-160 px, alternating #57603A and #44482B, alpha 0.10-0.18.
3. 2500 specks r 1-3 px: #2F321F alpha 0.30 and #6E6F4C alpha 0.25.
4. 140 vertical grime runs: width 2-6 px, length 40-220 px, linear gradient #2F321F alpha 0.35 at top to 0.
5. Panel lines: lines every 256 px both axes, offset 37 px, 1.5 px #262817, with a 1 px #6A6C48 alpha 0.4 highlight 2 px below; bolt dots r 1.5 px #2F321F every 24 px along 30 % of lines (random choice).

paintMasks, 512 x 512, linear, same tiling, packed channels (assign as `roughnessMap`; Three reads G for roughness):
- R: dust breakup noise, value-noise fbm 3 octaves (scales 64/32/16 px), 0..255.
- G: roughness: base 200, blotches 170-230, grime runs 140 (oily, shinier).
- B: chip mask: 400 clusters of 3-12 specks r 1-4 px, value 255, rest 0.

grille, 256 x 256: alternating 8 px bands #1E1F16 / paintBase, 2 px #6E6F4C highlight on each band's top edge; roughness 0.85.

wheelFace, 256 x 256 (cap of each road wheel disc): outer ring r 0.42-0.50 of cell rubber #1E1D1B; painted disc r 0.15-0.42 #4E5232 darkening 15 % toward the rim; 6 elliptical recesses #23251A at r 0.28; hub r 0.15 #3E4128 with 10 bolt dots r 3 px #7A776E on circle r 0.11; dust overlay #9C8C6A alpha 0.35 radial, strongest at outer half.

jerrycan, 64 x 128: paint base with a recessed X (3 px #2F321F lines corner to corner on each half) and a 2 px rim.

### 2.4 Paint shader patch (MeshStandardMaterial.onBeforeCompile)

Applies to every paint material. Uniforms: `uYOffset` (group height above ground: hull 0, turret 1.64, gun 2.06), `uDust` (player 0.55, enemy 0.65), `uDustColor` #9C8C6A, `uMudColor` #5E4F3B, `uBurn` 0..1, `uEmber` 0..1, `uTime`. Set `customProgramCacheKey = () => 'tankPaint'` so per-tank clones share one program. Clone materials per tank (cheap) so burn uniforms are per tank.

Vertex: pass `vH = position.y + uYOffset` (merged geometry is in group space, so this is height above the tank's ground plane regardless of terrain tilt) and world normal.

Fragment, after `roughnessmap_fragment`, with `m = texture2D(roughnessMap, vRoughnessMapUv)`:
- `up = smoothstep(0.6, 0.95, worldNormal.y)`
- `dustAmt = uDust * (smoothstep(1.5, 0.25, vH) * (0.55 + 0.45*m.r) + 0.30*up*m.r)`
- `mudAmt = smoothstep(0.9, 0.2, vH) * step(0.58, m.r) * 0.6`
- `edge = clamp(length(fwidth(normal)) * 6.0, 0.0, 1.0) * m.b`; `chips = pow(m.b, 4.0) * 0.35`
- color: mix to #7D7A66 by `edge*0.7 + chips`, then to mud by `mudAmt`, then to dust by `dustAmt`.
- roughness: mix to 0.45 by `edge`, then to 0.95 by `max(dustAmt, mudAmt)`.
- burn (section 4): `char = mix(#1B1916, #2E2620, m.r)`; `ash = #5E5A53`; color = mix(color, mix(char, ash, up*0.6*m.r), uBurn * (0.7 + 0.3*smoothstep(0.3, 1.2, vH)))`; roughness mix to 0.95 by uBurn.
- embers: `emissive += vec3(1.0, 0.35, 0.10) * 2.5 * uEmber * step(0.82, m.r) * (0.5 + 0.5*sin(uTime*3.0 + m.r*20.0))`.

Edge wear is low priority (P8). Dust gradient is P1: it is what makes the tank look like it sits in the world.

---

## 3. Enemy Variant ("T-class", T-72/T-90 style)

Goal: distinguishable from the player's tank at 1-2 km through silhouette first, color second.

| aspect | player | enemy |
|---|---|---|
| Hull | as 1.1 | same profiles scaled (x 0.96, y 0.92, z 0.90), turret pivot (0, 1.52, 0.35) |
| Skirts | full panels to y 0.56 | thin rubber-steel strip y 0.92..1.22 only, so road wheels are visible |
| Road wheels | 7 double, r 0.36 | 6 double, r 0.38, z -2.55, -1.53, -0.51, 0.51, 1.53, 2.55; wheelFace variant with 8 spoke recesses |
| Turret | angular loft | low rounded dome |
| Gun | fume extractor at 1.80-2.50, length to 4.70 | longer thinner: lathe r 0.115 -> 0.085, to 5.40; fume extractor r 0.140 at 1.40-1.95; 4 sleeve clamps; no MRS |
| Rear | grille + rack | two fuel drums |
| Camo | olive drab | three-tone disruptive |

Dome turret: `LatheGeometry`, 16 segments (low count keeps it faceted and cast-armor looking), profile (r, y): (0, 0.62), (0.55, 0.60), (1.05, 0.50), (1.35, 0.32), (1.45, 0.12), (1.40, 0.00), (0, 0.00). Scale z 1.12, shift z +0.15.

Enemy details (enemy turretYaw space):
- ERA cheek wedges x2: ExtrudeGeometry top-view triangle (x, z) (0.40, 1.05), (1.30, 0.55), (0.40, 1.55), extruded 0.28 up from y 0.30; mirror for left. Six ERA bricks 0.35 x 0.10 x 0.25 in a chevron on roof front.
- Gun pivot (0, 0.35, 1.05); mantlet: half-cylinder r 0.30, len 0.50.
- Commander cupola left rear: cyl r 0.38 h 0.20 at (-0.55, 0.70, -0.25); 12.7 mm MG: receiver box 0.12 x 0.14 x 0.55, barrel r 0.02 len 1.10.
- IR searchlight right of gun: box 0.30 x 0.30 x 0.30 + glass disc r 0.12 at (0.75, 0.55, 0.85).
- Snorkel tube: cyl r 0.09 len 2.20 along X at (0, 0.40, -1.60).
- 12 smoke tubes in an arc on the turret front above the cheeks.
- Fuel drums (hull space): cyl r 0.28 len 0.95 along X at (±0.55, 1.95, -3.55), two thin steel bands each.

Camo albedo (replaces paintAlbedo for enemy; tile covers 4 m, so UV scale 0.25): fill #8A8263 (sand-grey); 35 % coverage blobs #4F5640 (grey-green) and 20 % blobs #5B4733 (brown), blob size 0.6-1.8 m equivalent, hard edges (2 px blur) built from unions of 5-9 overlapping circles; then layers 3-5 of paintAlbedo (specks, runs, panel lines). Average reads lighter and greyer than the player at range, against green fields.

---

## 4. Destroyed and Disabled States

### 4.1 Kill outcomes (roll on kill)

| outcome | chance (HEAT/HE kill) | chance (APFSDS kill) | turret | gun |
|---|---|---|---|---|
| Catastrophic cook-off | 30 % | 15 % | blown off | n/a |
| Knocked askew | 50 % | 50 % | yaw += ±(20-50), roll ±(3-6), lift +0.08 | pitch to -8 (drooped) or +14 |
| Intact burnout | 20 % | 35 % | unchanged | droops to -6 over 3 s |

Blown-off turret: detach turretYaw to world, initial velocity up 9-14 m/s, lateral 2-4 m/s random direction, angular velocity 1-3 rad/s random axis, gravity 9.81. When its base reaches terrain: stop, set rest roll/pitch 20-60 deg random, sink 0.15. Lands 3-8 m from hull. Hull keeps an open turret ring: black disc r 1.05 at (0, 1.645, 0.25), color #0A0908.

Common to all kills: hatches open (rotate 110 deg about hinge), hide one antenna whip (snapped) and 60 % of stowage items (random), hide 1-2 random skirt panels, wheels and track scroll stop.

### 4.2 Charring timeline

- Swap rubber to #121110 and track texture tint multiplied 0.5 at t = 0.
- `uBurn`: 0 -> 1 over 20 s (paint visibly chars while burning).
- `uEmber`: 1 at t = 0, holds until 60 s, decays to 0 by 120 s.
- Glass: emissive 0, color #050505 (smashed optics).

### 4.3 Mobility kill (disabled, not destroyed)

Thin grey smoke from fireAnchor (2 puffs/s, #77736C, life 8 s, size 0.8 -> 4); no fire. Thrown track: hide that side's track mesh, place a flat strip box 0.63 x 0.08 x 4.0 with the track texture on the ground behind that side, yawed 8 deg.

---

## 5. Particle System Architecture

### 5.1 Batches (one draw call each)

| batch | blending | content | capacity |
|---|---|---|---|
| smokeBatch | premultiplied normal (ONE, ONE_MINUS_SRC_ALPHA), depthWrite false, renderOrder 10 | smoke, dust, dirt clods, exhaust | 6000 |
| glowBatch | additive (ONE, ONE), depthWrite false, renderOrder 11 | fire, flash, sparks, embers, MG tracers | 2500 |
| shellTracers | additive InstancedMesh, CPU-updated | main gun tracers following projectiles | 64 |
| debris | InstancedMesh MeshStandardMaterial, opaque, CPU sim | chunks | 256 |
| decals | InstancedMesh, normal blend, depthWrite false, polygonOffset (-4, -4) | scorch, furrows | 64 |

Billboard particles are instanced quads (`InstancedBufferGeometry` of one quad) with GPU analytic motion. CPU only writes on spawn into a ring buffer (oldest slot overwritten) and uploads the dirty range once per frame (`attribute.addUpdateRange`; full upload on wrap). No sorting.

Per-instance interleaved Float32 (stride 28): `pos0 xyz, vel xyz, birth, life, size0, size1, rot0, rotSpeed, color0 rgba (a = peak alpha), color1 rgb, cell, drag, accelY, windFactor, fadeIn, fadeOutStart, stretch, glow, pad`.

Vertex shader:
- `t = uTime - birth; u = t / life`; if `u < 0 || u > 1` collapse the vertex off-screen.
- `k = max(drag, 1e-3)`; `pos = pos0 + vel * (1 - exp(-k*t)) / k + vec3(0, 0.5*accelY*t*t, 0) + uWind * windFactor * (t + 0.04*t*t)`.
- `size = size0 + (size1 - size0) * (1 - pow(1 - u, p))` with p = 3 for smoke/dust (cell 0-2), 1 otherwise.
- Rotation `rot0 + rotSpeed*t` in screen plane.
- Streak mode (`stretch > 0`): orient the quad along screen-projected current velocity; length = `min(|v| * stretch, |v| * t) + size`, width = size. Clamp width to at least 1.5 px (glow tracers 2.0 px) by computing world size per pixel at the particle's depth.
- Near and screen-fill fade: `alpha *= smoothstep(0.5, 3.0, viewDepth) * (1 - smoothstep(0.6, 1.2, projectedSize / screenHeight))`.

Fragment: sample atlas cell; `alpha = color0.a * tex.a * smoothstep(0, fadeIn, u) * (1 - smoothstep(fadeOutStart, 1, u))`; `rgb = mix(color0.rgb, color1, u) * tex.rgb * uLightTint + glow * vec3(1.0, 0.42, 0.12) * pow(1 - u, 4)`. smokeBatch outputs `(rgb*alpha, alpha)`, glowBatch outputs `(rgb*alpha*intensity, 0)`. Glow colors may exceed 1.0 (intensity multiplier per particle via color scale) so tone mapping and any bloom pick them up. `uLightTint` comes from the environment's sun/ambient (default 1,1,1); `uWind` from the environment wind (default (1.2, 0, 0.4) m/s).

Fallback for hard ground intersection lines (no soft particles): spawn smoke centers at least `0.3 * size1` above terrain. Optional P9: soft particles using a depth texture if the environment renderer provides one.

### 5.2 Atlas (canvas 1024 x 512, 4 x 2 cells of 256, linear alpha, not premultiplied)

| cell | name | recipe |
|---|---|---|
| 0 | softPuff | `a = (1 - smoothstep(0, 1, d))^1.5`, d = dist/128; rgb white |
| 1 | billowA | 12 soft circles (centers within 60 px, r 35-70 px, `(1-d_i)^2`), combined by max, times fbm (16/32/64 px) remapped 0.55..1, times `1 - smoothstep(0.75, 1, d)`; rgb luminance `0.72 + 0.28*(1 - y/256) + 0.1*(n - 0.5)` (lit from above) |
| 2 | billowB | as 1, different seed |
| 3 | fire | ellipse rx 0.38, ry 0.50, center y 0.58, times fbm (24 px) remapped 0.3..1 with contrast 1.6; luminance 1.0 core -> 0.6 edge |
| 4 | flashStar | 6-ray star: `r(th) = 0.25 + 0.25*|cos(3*th)|^8 * (0.7..1.3 per ray)`; `a = smoothstep(r, 0, d)^1.2 + gaussian(sigma 0.12)` |
| 5 | sparkStreak | `a = exp(-(y-128)^2 / 50) * (x/256)^0.6 * (1 - smoothstep(0.9, 1, x/256))`, head toward +x |
| 6 | dirtClod | 5-9 irregular 6-8 vertex polygons, filled white (tinted by color), plus 30 specks; 1 px soft edge |
| 7 | ember | gaussian sigma 0.06 + 0.3 x gaussian sigma 0.20 |

### 5.3 Shared systems

Point lights: create 4 PointLights at init and never add or remove lights. Two flash lights (round-robin, steal the one with lowest current intensity) and two wreck fire lights (assigned to the two burning wrecks nearest the camera). Idle intensity 0. `castShadow = false`. Skip flash lights for events more than 150 m from the camera. Intensities assume physically correct lighting; tune so the ground within 10 m of a muzzle flash visibly brightens about 60 % in daylight.

Camera shake (trauma model): `trauma = min(1, trauma + add)`, decays 1.6 per second. Offset = `trauma^2 * (0.12 m translation, 1.2 deg rotation per axis) * noise3(t * 18 Hz)`. Distance events: `add = base * clamp(1 - d/radius, 0, 1)^2`.

| event | base | radius |
|---|---|---|
| Player main gun fire | 0.55 | n/a |
| Player coax burst | 0.04 per round | n/a |
| HE impact | 0.70 | 60 |
| HEAT impact | 0.50 | 40 |
| APFSDS impact | 0.25 | 20 |
| Player tank hit | 0.90 | n/a |
| Cook-off | 0.80 | 120 |

Gunner sight view uses 0.6 x translation and adds a 0.8 deg pitch-up kick recovering over 0.35 s on main gun fire.

Visual springs on hullTilt and antennas: damped springs, `x'' = -w^2 x - 2*zeta*w*x' + impulse`.

| spring | freq | zeta | impulse |
|---|---|---|---|
| Hull rock on fire | 1.6 Hz | 0.35 | 1.2 deg about the axis perpendicular to turret azimuth (rear dips when firing forward) |
| Turret kick on fire | 3 Hz | 0.4 | 0.3 deg pitch |
| Hull braking/accel dive | 1.2 Hz | 0.5 | 0.15 deg per m/s^2 of longitudinal accel |
| Antenna sway | 1.2 Hz | 0.12 | 12 deg on fire; 0.5 deg per m/s^2 of hull accel |
| Hull hit (by enemy round) | 2 Hz | 0.3 | 0.8 deg away from impact |

---

## 6. Effect Recipes

Notation: `n` count; `life` s; `size a->b` m; `vel` m/s; `drag` 1/s; `aY` vertical accel (buoyancy positive, gravity -9.81); `c0->c1` color over life; `A` peak alpha; `fade in/out-start` fractions of life. "Fwd" means muzzle forward direction; "cone" is the half-angle.

### 6.1 Main gun fire (player and enemy)

Recoil: `recoil.position.z` 0 -> -0.32 in 0.035 s (ease-out quad), hold 0.04 s, return over 0.55 s (ease-in-out cubic). Enemy uses the same.

Light: flash light at muzzle + 1.5 m fwd, #FFB25A, peak 4000 cd, distance 40, `I = peak * exp(-t / 0.035)`, off at 0.12 s.

| layer | batch | n | spawn | vel | drag | aY | life | size | color | A | fade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Core star | glow | 1 | muzzle + 0.6 fwd | 0 | | | 0.06 | 2.6->3.4 | #FFF1C8 x4 -> #FF9A3C x2 | 1 | 0/0.3 |
| Axial flames | glow, cell 3 | 3 | 0.8, 1.6, 2.6 fwd | 25 fwd | 20 | | 0.07-0.09 | 1.6/1.3/0.9 -> x1.4 | #FFD27A x3 -> #FF6A1E | 1 | 0/0.4 |
| Fireball | glow, cell 3 | 6 | muzzle | 18-30 fwd, cone 12 | 12 | +1 | 0.12-0.18 | 0.8->2.2 | #FFC060 x3 -> #B83A10 | 0.9 | 0/0.4 |
| Muzzle smoke | smoke, cells 1/2 | 14 | along first 3 m fwd | 6-14 fwd, cone 25 | 3.0 | +0.6 | 2.5-4.0 | 0.6->4.5 | #B9B2A4 -> #8E8A82 | 0.55 | 0.05/0.4 |
| Blast dust (if muzzle < 4 m above ground) | smoke, cells 1/2 | 24 | ground arc ±60 around barrel azimuth, 1.5-6 m from the muzzle's ground projection | radial out 8-16 horizontal, up 1-3 | 2.5 | -0.5 | 2.0-3.5 | 1.0->5.5 | terrain dust (#A89676 default) -> x0.92 | 0.5 | 0.05/0.45 |
| Dirt clods | smoke, cell 6 | 12 | same arc | out 5-9, up 3-6 | 0.5 | -9.81 | 0.8 | 0.3->0.5 | #5A4B38 | 0.9 | 0/0.8 |

Gunner sight obscuration: the muzzle smoke and blast dust naturally cover the sight camera; with the near fade (0.5-3 m) this should give about 0.5 s heavy and 1.5 s partial obscuration, matching real tank firing. Do not suppress it.

### 6.2 Tracers

Main gun (shellTracers, follows the gameplay projectile each frame, so it matches any drag model):
- Core quad: velocity-aligned, length 10 m (clamped to distance travelled), width 0.15 m (min 2.0 px), head #FFF0D0 x4 fading to tail #FF5A1A, additive.
- Halo quad: same axis, width 0.60 m, #FF8A3A, alpha 0.25.
- Removed on impact.

Coax 7.62 MG (glowBatch streak mode, analytic):
- Fire rate 12 rounds/s; every 4th round spawns a tracer. vel = muzzle dir x 850, drag 0, aY -9.81, life = gameplay time-to-impact (cap 1.0 s burnout), stretch 0.006 (about 5 m), width 0.05 (min 1.2 px), c0 #FFB080 x3 -> c1 #FF4A20.
- Every round: muzzle star at coaxMuzzle, size 0.25, life 0.03, #FFD9A0 x3. Flash light only if a flash light is idle: 300 cd, tau 0.02.
- Ricochet: 10 % of hits on armor spawn a new tracer from the hit point, direction reflected and jittered 30 deg, speed 400, life 0.4.

RWS / enemy 12.7 mm: same as coax with width 0.07 and every 5th round.

### 6.3 Small arms impacts (coax, RWS)

| surface | layers |
|---|---|
| Dirt / grass | 1 puff (cell 1, size 0.3->1.4, life 0.9, #9C8C6E, A 0.6, vel up 2, drag 2); 2 clods (cell 6, size 0.15, vel up 3-5 + random 2, aY -9.81, life 0.5) |
| Stone / building | 1 puff #A6A29A as above; 2 chips (cell 6, #8A867E) |
| Armor | 4 sparks (cell 5 streak, vel reflected 15-30 cone 50, drag 1.5, aY -9.81, life 0.15-0.3, size 0.08, stretch 0.03, #FFE0A0 x3 -> #FF7A20) |

### 6.4 Main gun impacts

APFSDS on armor (hit or bounce):

| layer | batch | n | vel | drag | aY | life | size | color | A |
|---|---|---|---|---|---|---|---|---|---|
| Sparks | glow, cell 5, stretch 0.03 | 60 | 20-60 around reflect dir, cone 70 | 1.5 | -9.81 | 0.25-0.7 | 0.05-0.09 | #FFF4D0 x4 -> #FF4A10 | 1 |
| Flash | glow, cell 4 | 1 | 0 | | | 0.05 | 1.8->2.4 | #FFFFFF x4 -> #FFC070 | 1 |
| Metal dust | smoke, cell 0 | 6 | 1-3 random | 2 | +0.2 | 1.2-1.8 | 0.5->2.5 | #8A8580 | 0.4 |

Light 1500 cd, tau 0.03.

APFSDS on ground: 30 clods (cell 6, cone 35 around reflected dir biased up, 8-20, aY -9.81, life 0.6-1.2, size 0.2-0.5, #4E4232); 10 dust billows (up 3-8 plus 4 along shot dir, drag 2, aY +0.3, life 2.5-4, size 0.8->4.0, #A08E70, A 0.6); furrow decal 0.8 x 2.5 m along shot, #3E3428, A 0.6. If grazing (< 20 deg), continue as a ricochet tracer at 60 % speed, deflected 5-15 deg up, life 0.8.

HEAT (any surface):

| layer | batch | n | spawn / vel | drag | aY | life | size | color | A | fade |
|---|---|---|---|---|---|---|---|---|---|---|
| Fireball | glow, cell 3 | 14 | within 0.6 m sphere, out 4-10 | 6 | +2 | 0.25-0.45 | 1.0->3.6 | #FFE0A0 x3 -> #C2400F | 1 | 0/0.4 |
| Flash | glow, cell 4 | 1 | | | | 0.07 | 4.0->5.5 | #FFFFFF x4 -> #FFB060 | 1 | 0/0.3 |
| Jet sparks | glow, cell 5 | 25 | 30-80, cone 60 | 1.5 | -9.81 | 0.3-0.6 | 0.06-0.1 | as APFSDS sparks | 1 | |
| Dark smoke | smoke, cells 1/2, glow 0.6 | 16 | out 2-5, up 1-3 | 2 | +0.8 | 4-6 | 1.2->6.0 | #2E2B28 -> #6A655E | 0.75 | 0.08/0.5 |
| Ground ring (ground hits only) | smoke, cell 0 | 16 | circle r 0.5, out 12-18, up 0.3 | 4 | 0 | 1.5 | 0.6->3.0 | dust | 0.45 | 0.02/0.4 |
| Clods (ground) | smoke, cell 6 | 20 | cone 45 up, 8-18 | 0.5 | -9.81 | 0.7-1.4 | 0.2-0.5 | #4E4232 | 0.9 | |
| Debris chunks | debris | 8 | cone 50 up, 6-14 | | -9.81 | 4-8 | 0.05-0.25 | dirt/stone/metal | | |

Light 8000 cd, tau 0.06, off 0.25 s, #FFB060. Scorch decal r 2.2 on ground.

HE (larger, dirt fountain):

| layer | n | values (differences from HEAT) |
|---|---|---|
| Fireball | 20 | size 1.5->5.5, life 0.3-0.55 |
| Flash | 1 | size 6->8 |
| Dirt fountain clods | 50 | cone 25 straight up, 10-28, life 1.0-2.0 |
| Dirt column | 14 | cells 1/2, up 10-18, drag 3, aY -1, life 3-5, size 1.0->5.0, #4A3D2E, A 0.85 (reaches 5-8 m) |
| Dust billows | 20 | out 3-8, up 1-3, life 4-7, size 1.5->7, #A08E70, A 0.6 |
| Black-brown smoke | 20 | life 6-9, size 2->9, #2A2622 -> #6A645C, glow 0.6 |
| Ground ring | 20 | out 14-22 |
| Debris chunks | 14 | 30 % burning (below) |

Light 15000 cd, tau 0.08, off 0.3 s. Scorch decal r 3.5.

On armor, HEAT and HE skip the ground ring, clods and decal, and use metal debris color.

### 6.5 Debris chunks

InstancedMesh of `IcosahedronGeometry(1, 0)` with vertices jittered ±25 % (one shared geometry), instanceColor: dirt #4B3F30, stone #6E6A62, metal #3A3A36. CPU sim: gravity -9.81, angular velocity 2-8 rad/s. Terrain bounce: `vel.y *= -0.3; vel.xz *= 0.6; angVel *= 0.6`. Sleep after 2 bounces or 3 s. In the final 0.5 s of life, scale to 0. Burning chunks (30 % of HE/kill debris): for 1.2 s emit one ember (glow cell 7, size 0.15, life 0.3, #FFA040 x3) every 0.03 s and one smoke puff (cell 0, size 0.2->1.0, life 1.5, #3A3632, A 0.5) every 0.06 s.

### 6.6 Decals

Scorch canvas 256 x 256: radial gradient #141210 alpha 0.85 at center to 0 at r 0.5, rim multiplied by fbm, 24 random rays (length 0.3-0.5, width 4-10 px, alpha 0.4) for a spatter. Furrow canvas: elongated ellipse, #3E3428. Plane 1 x 1, laid on the terrain normal, lifted 0.05 m, size at most 4 m. Fade out over 10 s after 120 s; recycle oldest.

### 6.7 Smoke grenade screen (vehicle dischargers)

Salvo: one bank (6) or both (12), fired 0.06 s apart.
- Launch per tube: glow star size 0.4 life 0.05; 3 grey puffs (cell 0, size 0.3->1.5, life 1.2, #A9A7A0, A 0.5).
- Grenade: tiny dark sprite (smoke cell 0, #2A2A28, size 0.15, A 1) or a CPU point on tube axis, speed 30 m/s, gravity. Bursts at 0.9 s (about 25 m out, 5 m high). Fan covers about ±40 deg around turret forward, so 12 grenades form a wall about 60 m wide.

Per grenade burst:

| layer | batch | n | vel | drag | aY | life | size | color | A | fade |
|---|---|---|---|---|---|---|---|---|---|---|
| Pop | glow, cell 4 | 1 | | | | 0.08 | 1.5->2.5 | #FFF0D0 x2 | 1 | |
| Burst cloud | smoke, cells 1/2 | 12 | spherical 6-10 | 2.5 | +0.05 | 25-35 | 1.5->7.0 | #EDEDEA -> #D8D8D4 | 0.85 | 0.02/0.75 |
| Burning pellets | glow, cell 7 | 6 | out 4-8, up 2-5 | 0.5 | -9.81 | 1.2 | 0.25 | #FFE0B0 x3 | 1 | |
| Pellet trails | smoke, cell 0 | 6 x 8 | spawned along pellet path every 0.05 s for the first 0.4 s, vel 0 | | +0.1 | 20 | 0.4->3.0 | #E4E4E0 | 0.6 | 0.05/0.7 |
| Settling feed | smoke, cells 1/2 | 12 (4/s for 3 s) | at burst point, down 0.3 | 1 | -0.05 | 25 | 4->9 | #E8E8E4 | 0.7 | 0.1/0.7 |

Timeline: wall opaque at 2-3 s, full density 3-20 s, thinning 20-30 s, gone by 35-45 s, drifting with `uWind`. Salvo cost about 860 smokeBatch particles. Shadowed underside comes from the lit-from-top atlas shading.

### 6.8 SMOKE shell (main gun SMOKE round)

On impact: burst of 20 billows (radial 8-14, drag 2.5, life 30, size 2->10, #E8E8E4, A 0.8); continuous canister emitter at the impact point for 45 s at 3 puffs/s (vel up 0.8, drag 0.5, aY +0.1, life 30, size 3->12, A 0.7, fade 0.1/0.7). Cloud about 25 m wide, 12 m tall, drifting downwind. About 110 concurrent particles.

### 6.9 How smoke blocks line of sight

Visuals and logic must agree, so keep a CPU list of `SmokeVolume { center, r(t), density(t), birth, life, thermalBlock }`, drifting with the same `uWind` as the particles.

| source | r(t) | life | thermal |
|---|---|---|---|
| Each grenade | `2 + 4.5 * (1 - exp(-t/2.5))` | 35 s | blocks fully (multispectral) |
| SMOKE shell | `3 + 9 * (1 - exp(-t/4))` | 60 s | 50 % extinction |

`density(t)`: ramps 0 -> 1 over 1.5 s, holds, then falls linearly to 0 across the last 40 % of life.

LOS query (AI targeting, rangefinder, gunner sight lock): for segment A-B, `tau = sum(density * chordLength(segment, sphere) * 0.35)`; transmittance `T = exp(-tau)`. Thirteen meters of full-density smoke gives T of about 0.01. `T < 0.15` means blocked: AI cannot acquire or fire at targets behind it, and the laser rangefinder returns the smoke distance. The thermal view applies `tau * thermalFactor`.

Camera inside a volume: blend the scene fog toward color #C9CAC6, FogExp2 density `0.15 * density(t) * insideFactor` (insideFactor = 1 - distanceToCenter/r), and restore when outside. Combined with particle near fade, this prevents the screen from going see-through or flickering inside smoke. Smoke particles get no distance fade, so the screen stays opaque at 6x zoom from 2 km.

### 6.10 Burning wreck

Emitters attach to fireAnchor (or to the open turret ring after a cook-off). Phases: vigorous 0-20 s, steady 20-90 s, smoldering 90-180 s, embers-only smoke 180-600 s.

| layer | rate per s (vig / steady / smolder / late) | spawn | vel | drag | aY | life | size | color | A | fade |
|---|---|---|---|---|---|---|---|---|---|---|
| Flames | 30 / 14 / 4 / 0 | box 2.0 x 0.5 x 3.0 over deck | up 2.5-4.5 | 1.2 | +3 | 0.6-1.0 | 1.4->0.4 | #FFD890 x3 -> #FF5A10 | 0.9 | 0.05/0.35 |
| Smoke column | 8 / 5 / 3 / 1.5 | disc r 1.0, 1.5 m above deck | up 4-6 | 0.25 | +0.6 | 14-20 | 1.5->14 | #1A1816 -> #4A4642 | 0.85 | 0.04/0.55 |
| Embers | 6 / 3 / 1 / 0 | over deck | up 3-6, random 1.5 | 0.8 | +1.5 | 1.5-2.5 | 0.06 | #FFA040 x3 | 1 | |

- Flame particles: rotation random, rotSpeed ±1. Smoke column particles: glow 0.5 (fire-lit underside), windFactor 1.0. The `0.04*t*t` wind term bends the column. Column reaches 40-60 m and is the main 2 km landmark (reference panel 2). About 160 concurrent smoke particles per vigorous wreck.
- Non-catastrophic kill start: first 3 s the smoke is grey-white (#8A8580); blend to black over 6 s. Flames ramp from 0 to vigorous rate over 8 s. A puff of 10 flames shoots up from the commander hatch at t = 0.3 s (up 6).
- Fire light (if one of 2 is assigned): #FF7A2A, `800 cd * (0.75 + 0.25 * noise(t*8))`, distance 25, 2 m above deck. Scale by phase: 1 / 0.7 / 0.3 / 0.

Cook-off additions (catastrophic): t = 0 fireball at HE x 1.5 scale with turret toss. t = 0.2-6 s vertical fire jet from the ring: 60 flames/s (up 12-20, life 0.5-0.8, size 1.0->3.0, #FFE8B0 x4 -> #FF6A10) and 40 sparks/s (up 15-30, cell 5). 6-10 secondary pops at random times 1-12 s (HEAT fireball at 0.5 scale, no decal).

### 6.11 Track dust

Per side, rear emitter at dustL/dustR, front emitter at dustFL/dustFR (40 % rate).
- `speedF = clamp(|v| / 12, 0, 1)`; rate = `22 * speedF * surface` per side, x 1.5 while pivot turning. Surface: dirt road 1.0, field/grass 0.35, rubble 0.6, asphalt 0.1, wet 0.
- Particle: smoke cells 1/2, vel `-tankVel * 0.25` + lateral ±1 + up 0.6-1.4, drag 1.5, aY +0.15, windFactor 1, life 2.0-3.5, size 0.8 -> (3.0 + 0.25*|v|), color #A6957A (dirt), #8C8466 (grass), A `0.35 * (0.4 + 0.6*speedF)`, fade 0.1/0.5.
- Sprocket clods: 6/s x speedF, cell 6, up 2-4, back 1-3, aY -9.81, life 0.6, size 0.12, #4E4232.
- Distance LOD: beyond 600 m from the camera, emit at 4/s per tank with size x 2.5 (dust plumes reveal moving tanks at range; keep them).

### 6.12 Exhaust

At exhaustPoint, direction -Z hull.
- Rate `4 + 18*throttle` per s. Throttle spike (throttle up more than 0.4 within 0.3 s): burst of 10. Engine start: 30 over 1 s.
- Particle: cell 0/1, vel 3-5 back + up 1, drag 2, aY +0.5, windFactor 1, life 1.2-2.0, size 0.3->2.2, fade 0.05/0.4.
- Player (turbine): #6E6A64, A 0.25 (burst A 0.4). Enemy (diesel): #2C2A28, A 0.45 (burst A 0.7).

### 6.13 Thermal hooks (for the sights spec writer)

Heat value 0..1 per source: exhaust grille and exhaust particles 0.9; engine deck 0.6 while running; road wheels and tracks 0.4 after 30 s of driving; barrel 0.3 rising to 0.8 for 60 s after firing; flames, fireballs and embers 1.0; wreck hull follows `uEmber`; grenade smoke is opaque at the ambient value.

---

## 7. LOD and Performance Budgets

LOD by camera distance per tank (toggle visibility, not separate objects):
- LOD0 (< 250 m): everything.
- LOD1 (250-900 m): hide `detail` group, tow cables, return rollers and wheel instance updates (wheels freeze); skip the paint `fwidth` edge term (uniform switch).
- LOD2 (> 900 m): replace wheels and tracks with one dark slab per side (box 0.63 x 0.85 x 7.2, flat #2A2826 lower and wheelFace color upper); turret, gun and hull stay. When zoomed to 6x, set LOD distances x 6.

| budget | value |
|---|---|
| Player tank LOD0 | <= 40k triangles, <= 25 draw calls (merge static parts per material per rig group; wheels as InstancedMesh) |
| Enemy LOD0 / LOD1 / LOD2 | <= 35k / 10k / 2k triangles; <= 25 / 10 / 5 draw calls |
| Tanks on field | design for 10 |
| Shadows | hull, turret, gun, wheels, skirts cast; antennas, cables, MG barrels, particles do not; particles never receive |
| Particle draw calls | 5 total (smoke, glow, shell tracers, debris, decals) |
| Live particles typical / peak | 1500 / 6000 smoke, 300 / 2500 glow |
| GPU particle time | <= 3 ms at 1440p; overdraw controlled by screen-fill fade and near fade |
| CPU effects time | <= 1 ms per frame; zero per-frame allocation |
| Dynamic lights | exactly 4 extra point lights, constant |
| Textures | paintAlbedo 1024, camo 1024, masks 512, atlas 1024 x 512, others <= 256; about 10 MB GPU total |

---

## 8. Priority Order (realism per effort)

1. Hull, turret loft, gun, skirts, wheels and scrolling track with paint palette, box UVs, paintAlbedo and the dust/mud height patch (the silhouette and the dust gradient carry the look).
2. Particle core (smokeBatch, glowBatch, atlas) with main gun fire: flash, muzzle smoke, blast dust, recoil, camera shake, light flash.
3. HE/HEAT fireball, dark smoke and dirt fountain; APFSDS sparks; ground rings.
4. Enemy variant (needed for targets; reuses the builders).
5. Main gun and coax tracers with minimum pixel width; small arms impacts.
6. Burning wreck: flames, black smoke column, charring, turret askew or blown off.
7. Track dust and exhaust.
8. Smoke grenades, SMOKE shell, SmokeVolume LOS and in-smoke fog.
9. Stowage, cables, antennas and springs, jerrycans, roof optics detail, edge wear, debris chunks, decals, cook-off extras, soft particles.

---

## 9. Acceptance Look Checks

- From the default third-person camera (behind and above, as in reference panels 1, 3, 5), the tank reads as olive drab with a clearly lighter dusty lower third, slab skirts, a wedge-fronted turret and a full stowage rack.
- Each main gun shot produces a flash for about 2 frames, a smoke cloud that lingers about 3 s, and ground dust in front of the tank, with visible hull rock.
- An HE impact at 300 m shows a fireball under 0.5 s, then a dark cloud and dirt column that holds 5-8 s.
- A burning wreck at 1.8 km through the 6x sight shows a black column rising and bending downwind (reference panel 2).
- A 12-grenade salvo forms an opaque white wall within 3 s, and AI cannot target through it until it thins.
- 60 fps on a modern desktop with 10 tanks, 2 burning wrecks and a smoke screen active.
