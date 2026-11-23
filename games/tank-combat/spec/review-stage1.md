# Visual Review: Stage 1 vs reference.png

Reviewer: read-only visual pass, 2026-11-22. Sources: `reference.png`, `spec/visual-*.md`, headless shots
(`shots1/01,02,06,07`), and live captures from `?demo` (radial, muzzle flash, smoke, optics, HE impact, side orbit).
Captures were taken at 800x600 and 1600x900.

**Overall verdict.** The game structure matches the reference: road toward a village, church spire, a tank framed
from behind, HUD layout, optics and radial menu. The rendering does not. Today it reads as a bright, saturated,
low-poly sandbox: lime-green grass, cone and blob trees, white plaster boxes, a toy-green tank with pale wheels,
and white additive explosions. Most of the gap comes from a few lighting and colour values that drift from the spec,
plus four content upgrades: grass ring, leaf-card trees, tank paint and shape, and smoke/fire sprites. Do the
P0 items in order. Each one is cheap and visible on every frame.

---

## P0: largest realism gain per effort

### P0-0 Dev-loop bug: negative first-frame dt (blocks reliable capture) [Game.js `start()`]
- Observed: after load, `game.time` is about -0.87 s. `this.last` is set after the synchronous world build, while
  the first rAF timestamp is older, so `dt` comes out negative. With `?demo`/`?run`, `optics.update(-0.87)` jumps
  optics to fully on (shot 03/04/05 "failed to advance" and the `?demo&until=0.9` frame showed 6.0x optics instead
  of the radial menu). `until` also fires late.
- Fix: `const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));`. Optionally gate the
  `frames=... t=...` toast behind `&debug`, since it sits in the middle of every capture.
- Impact: makes every later visual check reproducible. This is a one-line change.

### P0-1 Lighting values drifted from spec section 3 [Sky.js]
- Observed: sun elevation about 44° (`sunDir (-0.45,0.62,0.5)`), color `#fff0d8` at 3.6. Hemisphere light
  `#aecbe8/#6b6038` at **0.9** plus env at 0.5. The result is flat midday light, blue-tinted shadows, and low
  contrast on the tank's shadow side. The reference shows warm late-afternoon light with long raking shadows
  and darker, neutral shade.
- Fix (env spec 3.1/3.2): `sunDir = normalize(-0.828, 0.407, 0.386)` (24° elevation, WSW), sun `#ffd8a8`, intensity 3.0.
  Hemisphere `#a9bede / #6b5b40` at **0.35**, `environmentIntensity 0.55`. Bake the PMREM with clouds off and the sun
  disk at 20%.
- Shadows (env spec 3.3): `shadowHalf 70 -> 90`, mapSize 4096 (or keep 2048 with half 60 on low tier), centre =
  camera + 35 m along flattened forward (it currently centres on `focus`). Use bias -0.0003, normalBias 0.04 (0.35
  is large enough to detach contact shadows under the tank and trees). Use `PCFSoftShadowMap` if available.
- Impact: very high. Long tree shadows across the road and a modelled tank are what make panel 1 read as photographic.

### P0-2 Colour grading and aerial perspective [Game.js renderer, Sky.js fog]
- Observed: zenith `#3a6fb8` is too saturated. Fog is `FogExp2(0.00058)`, so trees at 600 m are still saturated green
  and the horizon has no blue layering. There is no grade pass. Greens are lime/yellow and the sky reads cartoon blue.
- Fix:
  1. Sky gradient per env spec 4.1 (zenith `#6a8cc4`, mid `#9cb2d8`). Horizon = fog colour with sun-side warm tint
     `mix(#b4c2d8, #e8cfa6, sunFactor)` (spec 5). Add a second distant-ridge layer (spec 4.3). The current single
     ridge is a thin flat strip.
  2. Raise fog to about 0.0010-0.0012 and tint it with view/sun direction (spec 5 shared function, injected via
     `fog_fragment` replacement), so terrain at 1 km is roughly 60% fog colour. Pull vegetation `maxDist 950` and
     terrain fade together so tree pop is hidden in the haze.
  3. Add the single GradePass from env spec 2: saturation 0.90, contrast 1.06 about 0.45, split tone (shadows toward
     `#3a4660` 6%, highlights toward `#ffe2b8` 5%), vignette 0.22. One full-screen pass is well within the 60 fps budget.
- Impact: very high. This is the cheapest way to move from "cartoon" to "filmic".

### P0-3 Vertex colours authored as sRGB but read as linear (pale wheels, white houses, glowing roofs)
- Observed: Three treats vertex colours as **linear**. Road-wheel hub `0.2` renders as about 48% grey, so it reads
  light blue-grey under the bluish fill (shot 02, side orbit). Building walls `0.68-0.70` render near-white
  (shot 06). Roofs `0.62,0.26,0.17` render bright orange-red.
- Fix: convert palettes to linear (`v^2.2`) or write target sRGB values through `Color.convertSRGBToLinear()`.
  - TrackAnimation.js `paint()` calls: tyre 0.02, hub 0.035-0.045 (dirty olive `0.045,0.045,0.03`), bolts 0.08.
  - Buildings.js `walls` palette: linear 0.22-0.42 (sRGB 0.52-0.70), using warm greys, ochre and sandstone.
    `roofs`: terracotta linear `0.25,0.07,0.04`, slate `0.05,0.055,0.06`, weathered `0.12,0.09,0.07`.
  - Also audit Vegetation `colorize` and rock colours (rock `k 0.55-0.75` linear is far too bright; use 0.12-0.2).
- Impact: high. It removes the toy look of the wheels and the "white blocks" village in one pass.

### P0-4 Grass ring around the camera (env spec 8.4) [Vegetation.js]
- Observed: tufts are sparse, isolated star-shaped clumps scattered on smooth green (shot 01/07). Normals are forced to
  (0,1,0), so every tuft is fully lit lime. Ground between tufts is a smeary low-frequency texture. The reference
  foreground is a continuous waist-high meadow with seed heads and pink/white flowers.
- Fix: replace the roadside-only scatter with a camera-following GPU ring. Use about 40-60k instanced cross-quads within
  60 m (density falls with distance, cut-off 90 m). Re-wrap positions in the vertex shader from
  `floor(camera.xz / cell)`. Sample the terrain height from a height `DataTexture`, and density/tint from the existing
  control texture (golden fields = wheat tint, soil = sparse). Per-blade colour: root dark `#2e3a1c`, tip `#8a8f4a`
  (dry `#b09a5c` in fields). Add 3-5% flower instances (`#d9a6c8`, `#f0ece0`) and a normal tilted toward the camera
  plus slight translucency (`+0.25 * sunFactor` back-light). No shadows cast. Keep the alphaTest material.
- Impact: very high. It is the single biggest difference in panel 1 and also hides terrain texture blur.

### P0-5 Tank paint and wheel materials [TankTextures.js, TankModel.js]
- Observed: blotchy saturated green camo (`#6a7046` with `#535a37/#7a7e55` patches) reads as plastic camo.
  Reference tanks are a single dusty olive-drab/tan tone with heavy dust on the lower hull, darker crevices and lighter
  top edges. The barrel matches the paint, so there is no material separation.
- Fix (tank spec 2.1/2.4):
  1. Base `#5f5c45` (olive drab, desaturated). Drop the two-tone camo or cut its contrast to ±4%.
  2. In `paint.onBeforeCompile` add a world/local-height dust gradient (below y 1.0 m lerp to `#7b6a52` up to 55%,
     with noise breakup), top-surface dust (`normal.y > 0.7` lerp to `#8a7c63` at 25%) and an edge wear term.
     Darken concave/low parts with a cheap AO: `ao = mix(0.55, 1.0, smoothstep(0.2, 1.2, localY))` times underside
     factor (`normal.y < -0.3`).
  3. Roughness 0.8-0.9 painted metal, metalness 0.05 (0.12 adds a grey sheen). `envMapIntensity 0.4`.
  4. Tracks: increase the mud colour (`rgba(95,78,55)`) and lower metalness to 0.25. Track texture contrast is fine.
- Impact: high. The player's tank is on screen 100% of the time.

---

## P1: important, moderate effort

### P1-1 Trees: replace blob and cone foliage with leaf cards (env spec 8.1/8.2) [Vegetation.js]
- Observed: oaks are icosphere blobs ("broccoli"), poplars are stacked balls (topiary), conifers are stacked smooth cones
  (Christmas tree). Shot 06's right foreground tree shows faceted blobs with stretched foliage texture.
- Fix: keep the trunk and branch geometry. Generate a 1024² canvas leaf atlas (alpha cut-out clusters, 4-6 variants).
  Build canopies as 40-80 alpha-tested quads per tree, oriented around each blob centre, with **spherical normals**
  from the canopy centre and inner darkening by depth (`0.45 -> 1.0`). For conifers, use 8-12 drooping branch cards per
  whorl with a ragged-edge alpha and a narrower, taller silhouette (radius 2.5 -> 1.8 at height 15). Add per-instance
  hue jitter (±6% hue, ±12% value) and back-light. Use `alphaToCoverage: true` with MSAA to avoid shimmering.
- LOD: cards within 250 m; beyond that, one crossed impostor billboard rendered from the card tree at load.
- Impact: high. Trees fill about 30% of every outdoor frame.

### P1-2 Terrain baked lighting and detail (env spec 6.4/6.5) [Terrain.js]
- Observed: beyond the 70 m shadow box, hills are evenly lit green with no AO, tree shadows or slope shading variance.
  The close-up ground looks smeared (shot 01 foreground).
- Fix: bake `aBake` per vertex at load: sun visibility via heightfield ray-march (16 steps toward `sunDir`), horizon
  AO (8 directions), and tree-canopy darkening by stamping a soft disc per tree into a 1024² shadow canvas offset along
  -sunDir. Multiply the diffuse in the shader. Add a high-frequency (p*1.3) grass-blade detail layer plus macro-variation
  `cM` at 0.0008 scale, so distant slopes show mottled dry and wet patches. Desaturate `grassHi` to about
  `0.30,0.37,0.15` and warm `gold` toward `0.66,0.55,0.30` (reference fields are tan, not yellow).
- Impact: high for long views (hill shot, village approach).

### P1-3 Tank silhouette and proportions (tank spec 1.1-1.8) [TankModel.js `buildParts`]
- Observed (shot 02, side orbit): the gun is short and stubby. The barrel ends 3.55 m ahead of the pivot, the whole tank
  is 9.5 m, and it carries a WWII-style **muzzle brake** (modern 120 mm smoothbores have none). The turret is a thin
  plate with separate "cheek" boxes that read as floating panels. Skirts are 9 cm boards with gaps. The hull reads tall
  and slab-sided. Antennas are thick and long (3.2 m, uniform black). Overall it looks like a tank destroyer rather than
  an Abrams/Leopard.
- Fix:
  1. Gun: barrel length 5.3 m from the mantlet face (`muzzleZ` about 5.6), radius 0.075 at the muzzle to 0.1 at the
     breech end. Thermal sleeve segments with 3 thin clamps, a bore evacuator at 40% length, a muzzle reference sensor
     box on top at the tip. Remove the muzzle-brake rings and side vents. Overall length should land around 9.8-10 m.
  2. Turret: one lofted outline (top 0.92 of base), height about 0.95 m, with the front as a **wedge** (two big planes
     meeting at the mantlet, 30-35° plan angle) instead of the box cheeks. Bustle 1.3 m long, same height as the turret,
     with a mesh-basket (`D` bars) full of `C` cloth bags and rolled tarp.
  3. Skirts: 0.06 m thick slabs with a 0.04 m bottom lip, 0.75 m tall, covering the top 40% of the wheels, no visible
     gaps (tiny 1 cm seams), front two panels thicker (0.12 m, ERA-like).
  4. Hull: lower the sponson top by 8 cm. Add a slanted glacis with a 0.05 m lip, lifting eyes, 2 rows of bolt heads
     on skirts (instanced tiny cylinders or bump-map dots).
  5. Antennas: radius 0.006, light olive, slight bend (2 segments). Use 2.2 m and 1.6 m.
  6. Wheels: 7 per side with tyre radius 0.36 is fine. Make the hub dished (inner cone) so it catches shading.
- Impact: high in close-ups and orbit views. Medium in the default chase view, where the turret back and gun dominate.

### P1-4 Main gun effects: muzzle flash, blast, explosion [MuzzleFlash.js, Explosions.js, Particles.js]
- Observed: (a) the third-person muzzle flash is a faint warm smudge at 2.06 s that is barely visible, followed by a
  thin grey haze. (b) The HE impact at about 100 m in optics fills half the screen with **solid white** and has a hard
  horizontal cut where sprites intersect the ground. It throws grey/brown cube debris. (c) The explosion leaves a small
  grey puff after 1.5 s. The reference shows orange fireballs inside dark brown/black smoke and tall black plumes that
  persist.
- Fix:
  1. Flash (tank spec 6.1): 3-5 additive sprites using a **star/flare tile** (not the round glow), colour
     `1.0,0.62,0.22` with alpha 0.85. Core 1.2 m, side lobes stretched 2.5x along the barrel, life 0.06 s, plus a ring
     shock-dust disc on the ground (12-16 tan puffs, radial 18 m/s) and a dense muzzle smoke ring (6 puffs at the
     muzzle, 0.75 grey, life 3-4 s). Flash light 900 -> 1500 for 0.08 s.
  2. Glow budget: cap additive sprite size to `min(size, 0.35 * distance)` so one sprite cannot exceed about 20% of
     the screen. Split the fireball into 6-10 smaller **orange-to-dark-red** sprites (`1.0,0.45,0.12`) with alpha 0.7,
     life 0.25-0.5 s, rising. Keep only one short white core (0.05 s, size R*1.2).
  3. Hard edges: lift each sprite centre by `0.45*size` above terrain, or add soft particles (depth pre-pass texture,
     fade `smoothstep(0, 1.5 m, sceneDepth - fragDepth)`). Lift-only is the cheap path.
  4. Smoke column: replace the 10+R grey puffs with a 20-40 s plume of 25-40 particles, colour 0.05-0.09, emitted over
     the first 2 s, rising 3-5 m/s, size growing to 10-18 m, and drifting with the wind. Add a brown dust skirt
     (`0.42,0.35,0.26`).
  5. Debris: use irregular dirt-clod geometry (low-poly icosahedron squashed) coloured by soil, plus 30-60 tiny dark
     sprites. Drop the cubes.
  6. Atlas (tank spec 5.2): raise smoke tiles to 256 px with Worley billows and a baked top-left light. Add
     flame and flare tiles.
- Impact: high. Combat moments are where the reference looks most "AAA".

### P1-5 Smoke grenade screen (tank spec 6.7) [WeaponSystem.js `deploySmoke`, Game.js `handleImpact` 'grenade']
- Observed: grenades fly as white dashes high in the sky for more than 2 s (shot at 3.6-4.6 s), then make a thin
  translucent haze (36 particles), and the tank drives through it at 6 s with the scene barely obscured.
- Fix: airburst after 0.7-0.9 s or at 30-40 m (whichever comes first) instead of on ground impact. Make the grenade
  body a tiny dark sprite with a short grey trail rather than a white tracer. On burst, emit about 12 puffs with a
  0.15 s white flash and expand to an arc **wall** 8 m tall and 50-60 m wide in front of the turret. Use 70-90
  particles, alpha 0.85-0.95, colour 0.86-0.92 tops and 0.62 bottoms (fake lighting by height), expansion over 2 s,
  life 25-35 s. The current `isBlocked` logic can stay.
- Impact: medium-high. Readability of the smoke mechanic depends on it.

### P1-6 Buildings and village (env spec 9.1-9.4) [Buildings.js, Textures.js]
- Observed (shot 06): uniform white two-storey blocks with a regular black window grid. Roofs are clean slabs, there is
  no window depth, gable ends are flat, and the village sits in an open field with almost no trees (village tree
  probability x0.12) and no walls, fences or gardens.
- Fix:
  1. Palette per P0-3. Use stone for 40% of houses (reference panel 4 is stone/rubble), plaster with a dirt band
     (darken the bottom 1 m by 30%) and rain streaks under windows.
  2. Window openings: inset quads 0.15 m deep with dark glass `#141a1e` and light frames, plus shutters on some
     (spec 9.3). This works as a separate thin box per window merged into the building bucket, so it stays at one
     draw call per material.
  3. Roofs: add tile-row bump, ridge caps, eave thickness of 0.25 m, ±1.5° sag, moss/darkening noise.
  4. Dressing: raise in-village tree probability to x0.5 with 10 m clearance from footprints. Add low stone walls
     (spec 9.5) and garden hedges between houses, and fence rows along the approach road like panel 1.
- Impact: medium-high. The village is the main landmark and is visible from the start.

---

## P2: polish

- **Road (env spec 7):** colour is reddish; move toward dusty grey-tan `#8a7a62` with lighter compacted wheel tracks
  and a grass median strip (0.6 m) between ruts. Add a narrow verge of taller grass. Road ribbons would allow sharper
  edges, but the shader mask is acceptable if the edge noise frequency is doubled.
- **Rocks:** too bright (P0-3) and too round. Use flatter and more angular shapes (`y *= 0.55`, stronger 2nd octave)
  and partially bury them.
- **Tracers:** the HE/HEAT tracer at 6x shows as a white rectangular slab right after firing (8.0 s optics capture).
  Do not draw tracers in the first 25 m, taper with a gradient texture, and use a hot orange-red core
  (`1.0,0.35,0.12`).
- **Optics muzzle flash:** the flash bleeds in as a white blob in the lower-left of the sight. Keep it, but tint it
  orange and add a 0.3 s dust obscuration in the sight (screen-space brown overlay at 25%), as in real sights.
- **HUD scale (hud spec 1.2):** all HUD text and slots are fixed px and about 55-65% of the reference's relative size
  (reference GEAR text is about 2.6% of the screen height, ours 15 px = 1.7% at 900p). Introduce
  `--u: clamp(0.85px, 0.1vh, 1.6px)` and express sizes in `calc(N * var(--u))`. Gear block about 24u bold-ish (600),
  ammo slots 76x84u, minimap 260u, mission text 16u. Spacing from edges 24u.
- **HUD weight:** reference text is heavier and higher-contrast with a soft shadow. Use font-weight 600 for gear and
  ammo labels, and `text-shadow: 0 1px 3px rgba(0,0,0,.9)`. Drop the "OPERATION IRON MEADOW" title or make it 10u at
  50% (the reference has none).
- **Minimap (hud spec 10):** the painted green/yellow terrain clashes with the reference's dark tactical map. Desaturate
  and darken the base (multiply 0.45, saturation 0.3), overlay a faint 100 m grid, draw roads as light lines, the route
  in bright blue `#3d8bff` 3u wide with diamond waypoints, and add the view cone. The frame is fine.
- **Ammo slot icons:** these are good. Make the selected slot border 2u and the loaded dot slightly larger.
  The reference shows slot number top-left and label bottom, which matches.
- **Optics vignette (hud spec 8.7):** the clear radius of 50vmin is too generous. The reference blackens corners hard.
  Use clear radius 42vmin, 0.9 alpha at 70vmin. Add a subtle optics tint (slight green-cyan lift
  `rgba(30,60,50,0.06)` multiply) and a very faint lens-edge chromatic darkening.
- **Radial menu:** layout, labels and hover state are correct and legible. P2 tweaks: shrink the outer radius about 10%,
  add a 0.12 s scale-in (0.92 -> 1), and slightly blur or darken the world behind (a `backdrop-filter` is not available
  on SVG paths, so use a 35% radial dark overlay behind the menu).
- **Track dust (tank spec 6.11):** none visible while driving at 40 km/h on dirt. Add 1-2 tan puffs per track per 0.1 s
  at speed > 8 km/h, alpha 0.25, life 2.5 s. This gives a big realism gain while moving.
- **Exhaust (tank spec 6.12):** a faint heat-haze-coloured puff from the rear deck at high RPM.

---

## Keep (already good)

- Scene composition and camera framing: chase cam height and offset match panel 1, and the road leads into the village.
- Church spire silhouette and the village layout along the street.
- Dirt road shader: ruts, noisy edge mask and soil wear are a solid base.
- Tone mapping choice (ACES, exposure 0.9) and the sRGB pipeline. Only the light and colour values need correcting.
- Shadow texel snapping (no shimmer) and the tank casting and receiving shadows.
- Cloud layer: soft and believable. Only the zenith colour needs work.
- Track geometry and texture with animated UV scrolling, the track-link bump detail, and the road-wheel count.
- Stowage idea: rear basket crates and cloth rolls read well from the chase view.
- Optics: the thin full-width crosshair with mil ticks, range box, bottom-left ammo list and 6.0x readout closely
  match the reference. The fade between third person and optics HUD is clean.
- Radial ammo menu: 4-sector layout, descriptions, counts, current-ammo highlight and centre readout.
- HUD element set and placement (objectives top-left, compass top-centre, gear bottom-left, ammo plus minimap
  bottom-right) match the reference. Ammo slot icons are clean.
- Particle system architecture (instanced, pooled, fogged and tone-mapped normal smoke). Only the recipes and atlas
  need upgrading.

---

## Suggested implementation order for the Sonnet implementer

1. P0-0 dt clamp (1 line). 2. P0-1 + P0-2 light/fog/grade values. 3. P0-3 linear palette fixes.
4. P0-5 tank paint shader. 5. P0-4 grass ring. 6. P1-4/P1-5 effects recipes. 7. P1-1 leaf-card trees.
8. P1-3 tank proportions. 9. P1-2 terrain bake. 10. P1-6 buildings. 11. P2 items.
Re-capture `?demo` at `until` = 0.9 / 2.06 / 6.2 / 7.5 / 8.35 and `?at=-60,-585` after steps 3, 5, 7 and 10.
