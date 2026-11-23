# Visual Review: Stage 2 vs reference.png

Reviewer: read-only second pass, 2026-11-22. Live captures at 1600x900 in the Vite dev build, stepped through
`game.frame(1/60)` with the rAF loop frozen (`until`). Scenes captured: start road (`?run`), road at z 250, hill
(`?skip=3/4`), 6x optics on tank1 (identify, APFSDS pen, kill), wreck close-up (free cam), village approach
(`?skip=6`), strongpoint before and after HE at 4x, village street (`?skip=7`), infantry, radial (`?demo` t=0.95),
banners, minimap, tank-destroyed (`?die`) and mission-complete screens, and a side orbit of the player tank.

**Verdict.** Big step up. The village (stone houses, terracotta roofs, church, ruins), the wheat fields, foreground
flowers in optics, fence lines, black wreck plumes, the wedge turret and long gun, and the HUD and banner set now read
like the reference's panels 1, 2 and 4. Three things still stop it reading as the reference:
(1) a **NaN bug makes every oak, fruit tree, poplar and bush invisible**, so the world is conifer-only;
(2) **distant vegetation** (low-LOD cones and blobs, haze) looks like paper cut-outs, especially at 4-6x zoom;
(3) **combat readability**: your own shot whites out the sight for about 3 s, and fire and fireballs render pale cream.

---

## P0: visibly broken or badly off the reference

### P0-1 Deciduous trees and bushes are never rendered (NaN geometry) [Vegetation.js `lump()` line 108]
- Observed: the console logs 36 x `computeBoundingSphere(): Computed radius is NaN`. Runtime check: vegetation sets
  0 (oak), 1 (fruit), 4 (poplar) and 5 (bush) have NaN vertices (126/72/108/54 floats) and **0 visible chunks**.
  `Math.asin(rnd() * 1.6 - 0.45)` gets arguments up to 1.15, so about 9% of cards are NaN. That makes the InstancedMesh
  bounding sphere NaN, so `LodInstances.update` sees `d = NaN` and hides the hi and lo meshes forever.
  Side effects: `terrain.stampTreeShadows(vegetation.trees)` still stamps soft shadows under the invisible trees
  (dark blotches visible from above near the extraction point). Tree colliders built from the same list are probably
  invisible obstacles too (not verified).
- Fix: `const e = Math.asin(clamp(rnd() * 1.45 - 0.45, -1, 1));`. Also make the LOD robust: compute each chunk's
  `center/r` from its items (mean x/z, max distance + 8 m) instead of `boundingSphere`.
- Verified in-browser by zeroing the NaN vertices and recomputing the spheres: oaks, poplar rows and orchard appear,
  and the road and hill views gain the mixed deciduous treeline from reference panel 1.
  Cost: tris went from 1.93 M to 3.16 M and draw calls from 471 to 516 (see P1-6).
- Impact: very high. It is the single largest gap to panel 1 and also a gameplay correctness issue.

### P0-2 Deciduous canopy cores dominate once visible [Vegetation.js `lump()`]
- Observed (after the P0-1 patch): oak and poplar crowns read as stacked, faceted, opaque olive icosahedron "boulders"
  with a thin fringe of leaf cards (road at z 250, right side). Poplars read as topiary lollipops.
- Fix: shrink the core to `0.6 *` (currently `0.88 *`) of rx/ry/rz and darken `coreTint` to about 45% of the card tint
  (it is the shadowed interior, not a surface). Raise `cardsN` 1.6x and `cardSize` 1.2x. Jitter card positions inward
  (`P = c + d * r * (0.75 + 0.3 * rnd())`) so cards overlap the core silhouette. Poplars: 5-6 narrower lumps, no gap
  between them.
- Impact: high. Without it, P0-1 trades "conifers only" for "broccoli".

### P0-3 Vegetation LOD ignores optics zoom; low-LOD trees are flat cones and blobs [Vegetation.js, Game.js]
- Observed: at 6x on the hill and at 4x on the strongpoint, every tree past 280 m is the low LOD: untextured
  blue-grey stacked cones ("paper Christmas trees") and smooth lollipop blobs (rim forest). This is the most
  "unrealistic" part of the reference panel 2 equivalent.
- Fix:
  1. `vegetation.update(cam.position, time, cam.fov / BASE_FOV)` and in `LodInstances.update` use `d * zoom` for the
     hi/lo switch (`maxDist` unchanged). Per-chunk cost only rises while zoomed, when the FOV culls most chunks anyway.
  2. Low LOD: replace the cone and blob meshes with 2-3 crossed alpha-tested quads that sample a per-kind impostor
     texture rendered once at load from the card tree (orthographic, 256x512, 2 views). Use the tree material (fog,
     back-light) and vertex AO. If impostors are too much for one pass, at least use the leaf atlas on the low
     meshes with `alphaTest` and ragged silhouettes, plus colour `lin('#2c3a1e')`, and add `tilt` jitter.
- Impact: very high for the hill view and all optics play.

### P0-4 Own-gun obscuration whites out the sight for about 3 s [MuzzleFlash.js `fire`, Smoke particle shader]
- Observed: APFSDS fired at 6x from the hill. At +0.4 s the sight is 70% milky. At +1.4 s it is **fully white**
  with nothing visible. It clears at about +4 s, so you cannot see the hit or kill (the reference shows the target
  clearly). Cause: 14 propellant puffs (alpha 0.55, size 4.5) plus 24 blast-dust puffs at 1.5-6 m around the sight,
  all lit and tone-mapped bright.
- Fix: in the smoke/dust fragment shader, fade particles near the camera:
  `alpha *= smoothstep(2.0, 9.0, -vViewPos.z)` (one varying). In optics (`scale < 1`), push propellant smoke forward
  (`sp 16-26`, `k 2-6`), alpha `0.3`, and dust count `round(24 * 0.25)`. Optional: a 0.35 s brown screen overlay in the
  sight (`rgba(90,75,55,0.25)`), as stage 1 P2 suggested.
- Impact: high. Shot feedback is the core loop.

### P0-5 Enemy marker range label sits on the reticle and the target [FxHud.js / hud.css `.mk span`]
- Observed: identifying and engaging tank1 at 6x, the red diamond is about 1.6 m above the tank and its "482 m" label
  (`top: 9px`, below the diamond) lands exactly on the crosshair centre and covers the tank.
- Fix: put the label above the diamond (`.mk span { top: -22px }`), or hide the distance text when optics > 0.5 (the
  sight already has a range box). Raise the marker anchor to `y + 4.0`, scaled by `1 / zoom` in screen space so it
  stays about 20 px above the hull.
- Impact: high for aiming. Cheap.

### P0-6 Fire and explosion cores render cream-white instead of orange [AmbientFire.js, Explosions.js]
- Observed: wreck fires are small pale cream "petals". HE on the strongpoint is a white-yellow ball. Reference panels
  2-4 show saturated orange flame with dark cores inside black smoke.
- Fix: additive HDR overlap saturates to white after ACES. Wreck flames: `r 1.5, g 0.5-0.7, b 0.12, alpha 0.65`,
  `size0 2.2, size1 0.8`, emission rate 14 -> 10, add 3-4 non-additive dark-red smoke-flame sprites at the base
  (`0.35,0.08,0.02`). Explosion `_flames`: cap tint to `r <= 1.8, g <= 0.8 * r`. Shorten the white core
  (`life 0.04`, `size * 0.7`).
- Wreck plume gap: `fadeIn: 0.05` is a **fraction of a 14-20 s life**, so smoke stays invisible for its first 4-5 m and
  the column starts in mid-air. Use `fadeIn: 0.006` (about 0.1 s) in AmbientFire and `smoke.plume`.
- Impact: high. Combat frames are where the reference looks most "AAA".

---

## P1: biggest realism gains per effort

### P1-1 Shade side too dark; backlit views crush to black [Sky.js]
- Observed: looking toward the sun (hill view, wreck, infantry, side orbit), the player tank, the soldiers and the trees
  are near-black silhouettes with no detail. Stage 1 asked for hemi 0.35 / env 0.55. That fixed flat midday light
  but overshot for backlit framing (the reference shade side is dark but readable).
- Fix: `scene.environmentIntensity 0.55 -> 0.85`, hemi `0.35 -> 0.5`, sky colour `#a9bede`, ground `#7a6a4c`. Keep the
  sun at 3.0. Optional: a weak (0.35) non-shadowing fill DirectionalLight from `-sunDir` with y flipped positive, colour
  `#9fb4d0`.
- Impact: high, every frame that faces west.

### P1-2 Aerial haze reads milky; distance loses colour [Atmosphere.js]
- Observed: at 400-1000 m everything is a uniform pale grey-blue wash (hill view, village from the hill). The reference
  keeps saturated greens to about 1.5 km and blue-shifts only the far ridges.
- Fix: fog colour base `vec3(0.456,0.539,0.687)` -> `vec3(0.33,0.41,0.55)` (darker, bluer), `uFogDensity 0.00068 ->
  0.00048`, `uFogMax 0.9 -> 0.8`, keep the height falloff. Re-check that the sky horizon still blends (it shares the
  function).
- Impact: high for long views.

### P1-3 Meadow grass reads as polka dots on dark ground [Grass.js, Terrain.js]
- Observed: wheat and flowers are great. Plain meadow tufts are evenly spaced clumps on dark green soil, and from above
  or at 30-60 m it looks dotted. The reference meadow is continuous.
- Fix: inside 25 m use spacing 0.55 (second inner lattice, 90x90). Or keep one lattice and draw 2 tufts per cell
  inside 25 m. Tint the terrain grass albedo near the camera toward the tuft mid-colour (`#5d6a34`) so gaps read as
  short grass, not soil. Remove wheat from the village interior: mask control-map wheat inside settlement footprints
  plus 6 m (the street at `?skip=7` grows wheat up to the house walls).
- Impact: medium-high on panel-1 style frames.

### P1-4 Conifer hi-LOD cards over hard cone cores [Vegetation.js conifer builder, line ~186]
- Observed: a close spruce at 4x shows horizontal opaque cone bands ("lampshades") under the drooping cards.
- Fix: core cone radius x0.55, colour x0.5, and tilt the card normals outward more (`sphereBlend 0.6`).
- Impact: medium. Close conifers are frequent.

### P1-5 Objective beam is a hard flat slab [Mission.js beam]
- Observed: a 90 m opaque-edged pale-blue rectangle in optics and third person. It covers houses at 4-6x and is not
  in the reference.
- Fix: a ShaderMaterial with a vertical gradient (alpha 0.25 at the ground to 0 at 60 m), fresnel edge fade
  (`pow(1 - abs(dot(N, V)), 1.5)`), width 0.5x. Hide when optics > 0.5 or when the camera is within 60 m.
- Impact: medium. Cheap.

### P1-6 Performance budget after P0-1 [Vegetation.js]
- Observed: 3.16 M tris / 516 calls at the road with all trees visible (shadow pass included). That is risky for
  60 fps on mid GPUs.
- Fix: `castShadow` only on hi chunks within 140 m (toggle in `update`), lower `loDist` 280 -> 220 when not zoomed
  (with P0-3's zoom factor), and cap `cardsN` growth from P0-2 by dropping trees beyond 600 m to impostors.

### P1-7 Infantry colouring and scale [Infantry.js]
- Observed: soldiers read as black box figures even in partial light, with no visible helmet or webbing contrast.
- Fix: after P1-1, raise uniform to `#5a5f40`, add a lighter webbing/belt box `#6b6248`, skin `#9a7458`, and give the
  pack `#4d4a36`. Add a 2-frame arm swing offset when running. Scale 1.05.

---

## P2: nice-to-have

- **Oil drums** at the strongpoint are saturated traffic-cone orange. Use `#6b4a2a` rust and olive `#4a4d34`, roughness 0.8.
- **Radial menu**: the hovered segment `rgba(235,238,230,0.26)` puts white text on a light fill, which is low contrast.
  Use fill `rgba(120,170,90,0.32)` with a bright stroke. FxHud markers and damage arcs draw **over** the radial
  (`z-index 10`). Hide `.fxhud` markers and arcs while the radial is open, or give `.radial` `z-index: 12`.
  The stage 1 items (scale-in, backdrop darkening) are still open.
- **Mission panel/HUD scale** (stage 1 P2): still about 13 px at 900p. The `--u` unit system is not done.
  The "ADVANCE TO THE VILLAGE" title is low contrast on sky. Add `text-shadow 0 1px 3px rgba(0,0,0,.9)`.
- **Minimap** (stage 1 P2): still saturated green/yellow paint. At the start position the bottom quarter of the frame
  is an empty dark band (map clipped at the world edge). Clamp the map centre so the frame stays filled.
- **End screens**: the mission-complete camera framed a ruin wall and the tank was not visible. Switch to a slow orbit
  (dist 14, pitch 0.3) on `ended`. The "VEHICLE"/"MISSION" eyebrow labels can go.
- **Banner vs optics**: "OBJECTIVE COMPLETE" (top 104 px) overlaps the optics range box and vertical stadia. Drop the
  banner to `top: 22vh` while optics > 0.5.
- **Wreck**: add a burnt ground decal (dark disc, 6 m) and 2-3 ember point sprites inside the hull.

---

## Stage 1 status

| Stage 1 item | Status |
|---|---|
| P0-0 dt clamp, toast behind `?debug` | Done |
| P0-1 sun 24°, shadows 90 m/4096, bias | Done. Shade now too dark (P1-1) |
| P0-2 grade pass, sky, view-dependent fog | Done. Haze too milky at range (P1-2) |
| P0-3 linear palettes (buildings, wheels) | Done. Stone/plaster village reads right |
| P0-4 grass ring | Done. Wheat and flowers excellent, meadow sparse (P1-3) |
| P0-5 tank paint/dust | Done. Olive-tan with dust, reads well when lit |
| P1-1 leaf-card trees | Partly. Conifer cards good; deciduous cards built but invisible (P0-1/2); low LOD still cones/blobs (P0-3) |
| P1-2 terrain bake / tree shadow stamps | Partly. Stamps present (also under invisible trees) |
| P1-3 tank silhouette | Done. Wedge turret, long gun, skirts |
| P1-4 gun/explosion effects | Partly. Black plumes and debris good; fire/fireball still pale (P0-6); obscuration (P0-4) |
| P1-5 smoke grenade wall | Not re-verified this pass |
| P1-6 village buildings, ruins, walls, fences | Done, the biggest visible win |
| P2 road, HUD scale, minimap, radial, optics vignette | Optics vignette done. HUD scale, minimap, radial still open |

## Gameplay-visible defects (separate from visuals)

1. **Invisible trees and bushes** (P0-1): all oak/fruit/poplar/bush instances are hidden. Their shadow stamps exist and
   their colliders probably do too (likely invisible obstacles).
2. **Sight whiteout** after firing (P0-4) blocks shot assessment for about 3 s.
3. **Marker label covers the target** at the reticle centre in optics (P0-5).
4. tank1 at 480 m, alerted, stayed in `engage` for 60 s (detection decays to 0 while LOS stays true, so it never goes
   back to search). It fired about 7 times (reload kept cycling) with **zero hits** on a stationary player on the hill.
   The cause could be terrain-crest impacts or dispersion. Worth an `?elog` check. Low confidence that it is a bug.
5. The strongpoint needs **5 HE hits** (1500 hp, about 360 per hit, about 60 s of reloads). This is long for a
   "support the infantry" beat. Consider 900 hp.
6. Dev only: `?skip=7` spawns the player at (-60,-590), 8 m from live tank2.
7. Mission flow 1->7 worked (identify triggered after about 1 s at 6x; kill, strongpoint, extraction and win fired;
   the optional counter showed 0/3). The death screen works with `?die`.

## Suggested order for one implementer pass

P0-1 (one line plus robust centres) -> P0-5 -> P0-4 -> P0-6 -> P1-1 + P1-2 (values) -> P0-2 -> P0-3 (zoom factor first,
impostors second) -> P1-6 -> P1-3 -> P1-5 -> P1-4 -> P2.
Re-capture: road z 250 (`?run&at=7,249`), hill 6x (`?skip=3`, aim at tank1, fire), wreck close-up, `?skip=6` village.
